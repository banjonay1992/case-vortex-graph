import { describe, expect, it } from 'vitest';

import {
  buildContextualSourceRegistryProposal,
  contextualSourceRegistryProposalApprovalStatement,
  verifyContextualSourceRegistryProposal,
} from '../../src/caseGraph/contextualSourceRegistryProposal';
import {
  buildContextualSourceGovernanceResearchPacket,
} from '../../src/caseGraph/contextualSourceGovernanceResearchCatalogue';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const packet = () => buildContextualSourceGovernanceResearchPacket({
  referenceAt: '2026-07-27T17:00:00.000Z',
  registryInspectedAt: '2026-07-27T16:59:00.000Z',
  registryRows: [
    { canonical_source: 'OPENSKY', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
    { canonical_source: 'SONDEHUB_ARCHIVE', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
    { canonical_source: 'NASA_CNEOS_FIREBALL', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
  ],
});

const reseal = (value: Record<string, unknown>, overrides: Record<string, unknown>) => {
  const { proposalDigest: _digest, ...body } = { ...value, ...overrides };
  return { ...body, proposalDigest: relationshipInputSha256(body) };
};

describe('contextual source registry proposal', () => {
  it('binds the two rights-complete alternatives without granting authority', () => {
    const decisionPacket = packet();
    const proposal = buildContextualSourceRegistryProposal({
      decisionPacket,
      createdAt: '2026-07-27T17:05:00.000Z',
    });

    expect(proposal.scope).toEqual({
      sourceCount: 2,
      categories: ['aircraft', 'weather'],
      operation: 'insert_only_if_still_missing_after_fresh_read_only_rehearsal',
    });
    expect(proposal.changes.map(({ canonicalSource }) => canonicalSource)).toEqual([
      'ADSB_LOL',
      'NOAA_NCEI_US_OBSERVATIONS',
    ]);
    expect(proposal.changes[0].proposedRegistryRow).toEqual({
      legalStatus: 'approved',
      licenseType: 'odbl_1_0_attribution_share_alike',
      allowedContentModes: ['derived_only'],
      evidenceUrl: 'https://api.adsb.lol/',
    });
    expect(proposal.changes[1].constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('U.S. NOAA-created'),
      expect.stringContaining('WMO-restricted non-U.S.'),
      expect.stringContaining('not proof of clear weather'),
    ]));
    expect(proposal.guarantees).toMatchObject({
      proposalOnly: true,
      automaticApproval: false,
      registryMutations: 0,
      databaseWrites: 0,
      providerCalls: 0,
      publicationActivations: 0,
      deployments: 0,
    });
    expect(verifyContextualSourceRegistryProposal(proposal, decisionPacket))
      .toEqual(proposal);
    expect(contextualSourceRegistryProposalApprovalStatement(proposal.proposalDigest))
      .toContain(proposal.proposalDigest);
  });

  it('rejects a re-sealed broadened mode, removed constraint, or packet substitution', () => {
    const decisionPacket = packet();
    const proposal = buildContextualSourceRegistryProposal({
      decisionPacket,
      createdAt: '2026-07-27T17:05:00.000Z',
    });
    const broadened = proposal.changes.map((change) => (
      change.canonicalSource === 'ADSB_LOL'
        ? {
          ...change,
          proposedRegistryRow: {
            ...change.proposedRegistryRow,
            allowedContentModes: ['full_ingest'],
          },
        }
        : change
    ));
    expect(() => verifyContextualSourceRegistryProposal(
      reseal(proposal, { changes: broadened }),
      decisionPacket,
    )).toThrow('contextual_source_registry_proposal_drift');

    const weakened = proposal.changes.map((change) => (
      change.canonicalSource === 'NOAA_NCEI_US_OBSERVATIONS'
        ? { ...change, constraints: change.constraints.slice(1) }
        : change
    ));
    expect(() => verifyContextualSourceRegistryProposal(
      reseal(proposal, { changes: weakened }),
      decisionPacket,
    )).toThrow('contextual_source_registry_proposal_drift');

    const substitutedPacket = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T17:01:00.000Z',
      registryInspectedAt: '2026-07-27T16:59:00.000Z',
      registryRows: [],
    });
    expect(() => verifyContextualSourceRegistryProposal(proposal, substitutedPacket))
      .toThrow('contextual_source_registry_proposal_drift');
  });

  it('refuses candidates that are already present or whose rights no longer match', () => {
    const present = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T17:00:00.000Z',
      registryInspectedAt: '2026-07-27T16:59:00.000Z',
      registryRows: [{
        canonical_source: 'ADSB_LOL',
        legal_status: 'review',
        allowed_content_modes: ['metadata_only'],
      }],
    });
    expect(() => buildContextualSourceRegistryProposal({
      decisionPacket: present,
      createdAt: '2026-07-27T17:05:00.000Z',
    })).toThrow('contextual_source_registry_proposal_candidate_not_ready');
  });
});
