import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_SOURCE_REGISTRY_PROPOSAL_VERSION =
  'case-vortex-contextual-source-registry-proposal-v1' as const;

const REQUIRED_APPROVAL_STATEMENT =
  'I approve adding ADSB_LOL and NOAA_NCEI_US_OBSERVATIONS to uap_source_legal_registry as approved for derived_only under the exact constraints and evidence bound by proposal <proposalDigest>. This does not approve provider calls, archival writes, publication, activation, or deployment.' as const;

const POLICIES = [
  {
    category: 'aircraft',
    canonicalSource: 'ADSB_LOL',
    providerId: 'adsb-lol',
    licenseType: 'odbl_1_0_attribution_share_alike',
    evidenceUrl: 'https://api.adsb.lol/',
    constraints: [
      'Preserve ODbL attribution, database notice and share-alike obligations for every public adapted database.',
      'Contact the operator before production traffic and treat the free service as having no contractual availability guarantee.',
      'Disclose receiver coverage, retention gaps and outages; a checked-no-match result cannot rule out an aircraft.',
      'Store and publish derived comparisons only; never redistribute raw provider snapshots through the public research interface.',
    ],
  },
  {
    category: 'weather',
    canonicalSource: 'NOAA_NCEI_US_OBSERVATIONS',
    providerId: 'noaa-ncei-us-observations',
    licenseType: 'us_government_public_domain_noaa_created_us_only',
    evidenceUrl: 'https://sos.noaa.gov/copyright/',
    constraints: [
      'Use only U.S. NOAA-created observation records whose dataset metadata carries no additional restriction.',
      'Exclude third-party and WMO-restricted non-U.S. material from this approval.',
      'Preserve NOAA acknowledgement and non-endorsement conditions in every display and export.',
      'Respect the documented token limits with bounded caching and backoff.',
      'Disclose station distance, observation cadence and missing variables; no record is not proof of clear weather.',
      'Store and publish derived comparisons only; never redistribute raw provider snapshots through the public research interface.',
    ],
  },
] as const;

type RegistryProposalPolicy = typeof POLICIES[number];

export type ContextualSourceRegistryProposal = {
  recordType: 'contextual_source_registry_proposal';
  schemaVersion: typeof CONTEXTUAL_SOURCE_REGISTRY_PROPOSAL_VERSION;
  createdAt: string;
  boundDecisionPacket: {
    packetDigest: string;
    referenceAt: string;
    providerCount: number;
    readyCategoryCount: number;
  };
  scope: {
    sourceCount: 2;
    categories: ['aircraft', 'weather'];
    operation: 'insert_only_if_still_missing_after_fresh_read_only_rehearsal';
  };
  changes: Array<{
    category: RegistryProposalPolicy['category'];
    canonicalSource: RegistryProposalPolicy['canonicalSource'];
    providerId: RegistryProposalPolicy['providerId'];
    boundDecisionEntryDigest: string;
    expectedCurrent: {
      legalStatus: 'missing';
      allowedContentModes: [];
    };
    proposedRegistryRow: {
      legalStatus: 'approved';
      licenseType: RegistryProposalPolicy['licenseType'];
      allowedContentModes: ['derived_only'];
      evidenceUrl: RegistryProposalPolicy['evidenceUrl'];
    };
    constraints: string[];
    requiresFreshEvidence: true;
    requiresHumanApproval: true;
  }>;
  requiredApprovalStatement: typeof REQUIRED_APPROVAL_STATEMENT;
  guarantees: {
    proposalOnly: true;
    automaticApproval: false;
    registryMutations: 0;
    databaseReads: 0;
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    providerCalls: 0;
    lunaCalls: 0;
    publicationActivations: 0;
    deployments: 0;
  };
  proposalDigest: string;
};

const invalid = (code: string): never => { throw new Error(code); };
const plain = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const exact = (
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> => {
  if (!plain(value)) invalid(code);
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) invalid(code);
  return object;
};
const iso = (value: unknown): string => {
  if (typeof value !== 'string') invalid('contextual_source_registry_proposal_time_invalid');
  const timestamp = value as string;
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    invalid('contextual_source_registry_proposal_time_invalid');
  }
  return timestamp;
};
const same = (left: unknown, right: unknown) => (
  relationshipInputSha256(left) === relationshipInputSha256(right)
);

const proposalBody = (
  packet: ContextualSourceGovernanceDecisionPacket,
  createdAt: string,
): Omit<ContextualSourceRegistryProposal, 'proposalDigest'> => {
  const changes = POLICIES.map((policy) => {
    const matches = packet.entries.filter((entry) => (
      entry.category === policy.category
      && entry.canonicalSource === policy.canonicalSource
      && entry.providerId === policy.providerId
    ));
    if (matches.length !== 1) invalid('contextual_source_registry_proposal_candidate_missing');
    const entry = matches[0];
    if (entry.decision !== 'review_required'
      || entry.usableNow
      || entry.registry.legalStatus !== 'missing'
      || entry.registry.allowedContentModes.length !== 0
      || entry.evidenceFresh !== true
      || entry.rights.commercialUse !== 'allowed'
      || entry.rights.automatedAccess !== 'allowed'
      || entry.rights.archivalUse !== 'allowed'
      || entry.rights.redistribution !== 'allowed'
      || entry.rights.accessConstraint !== 'none'
      || entry.rights.attributionRequired !== true
      || entry.reasonCodes.some((reason) => (
        reason !== 'source_registry_missing' && reason !== 'required_content_mode_not_approved'
      ))) {
      invalid('contextual_source_registry_proposal_candidate_not_ready');
    }
    return {
      category: policy.category,
      canonicalSource: policy.canonicalSource,
      providerId: policy.providerId,
      boundDecisionEntryDigest: entry.entryDigest,
      expectedCurrent: {
        legalStatus: 'missing' as const,
        allowedContentModes: [] as [],
      },
      proposedRegistryRow: {
        legalStatus: 'approved' as const,
        licenseType: policy.licenseType,
        allowedContentModes: ['derived_only'] as ['derived_only'],
        evidenceUrl: policy.evidenceUrl,
      },
      constraints: [...policy.constraints],
      requiresFreshEvidence: true as const,
      requiresHumanApproval: true as const,
    };
  });
  return {
    recordType: 'contextual_source_registry_proposal',
    schemaVersion: CONTEXTUAL_SOURCE_REGISTRY_PROPOSAL_VERSION,
    createdAt,
    boundDecisionPacket: {
      packetDigest: packet.packetDigest,
      referenceAt: packet.referenceAt,
      providerCount: packet.summary.providerCount,
      readyCategoryCount: packet.summary.readyCategoryCount,
    },
    scope: {
      sourceCount: 2,
      categories: ['aircraft', 'weather'],
      operation: 'insert_only_if_still_missing_after_fresh_read_only_rehearsal',
    },
    changes,
    requiredApprovalStatement: REQUIRED_APPROVAL_STATEMENT,
    guarantees: {
      proposalOnly: true,
      automaticApproval: false,
      registryMutations: 0,
      databaseReads: 0,
      databaseWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      providerCalls: 0,
      lunaCalls: 0,
      publicationActivations: 0,
      deployments: 0,
    },
  };
};

export const buildContextualSourceRegistryProposal = (params: {
  decisionPacket: unknown;
  createdAt: string;
}): ContextualSourceRegistryProposal => {
  const packet = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  const body = proposalBody(packet, iso(params.createdAt));
  return { ...body, proposalDigest: relationshipInputSha256(body) };
};

export const verifyContextualSourceRegistryProposal = (
  value: unknown,
  decisionPacket: unknown,
): ContextualSourceRegistryProposal => {
  const packet = verifyContextualSourceGovernanceDecisionPacket(decisionPacket);
  const proposal = exact(value, [
    'recordType', 'schemaVersion', 'createdAt', 'boundDecisionPacket', 'scope',
    'changes', 'requiredApprovalStatement', 'guarantees', 'proposalDigest',
  ], 'contextual_source_registry_proposal_invalid');
  if (proposal.recordType !== 'contextual_source_registry_proposal'
    || proposal.schemaVersion !== CONTEXTUAL_SOURCE_REGISTRY_PROPOSAL_VERSION) {
    invalid('contextual_source_registry_proposal_invalid');
  }
  const expected = buildContextualSourceRegistryProposal({
    decisionPacket: packet,
    createdAt: iso(proposal.createdAt),
  });
  if (!same(proposal, expected)) invalid('contextual_source_registry_proposal_drift');
  return expected;
};

export const contextualSourceRegistryProposalApprovalStatement =
  (proposalDigest: string) => {
    if (!/^[a-f0-9]{64}$/u.test(proposalDigest)) {
      invalid('contextual_source_registry_proposal_digest_invalid');
    }
    return REQUIRED_APPROVAL_STATEMENT.replace('<proposalDigest>', proposalDigest);
  };
