import {
  type EvidenceUniverseSourceCensusReceipt,
  verifyEvidenceUniverseSourceCensusReceipt,
} from './postgresEvidenceUniverseSnapshot';
import {
  type SourceGovernanceLedgerReceipt,
  verifySourceGovernanceLedgerReceipt,
} from './postgresSourceGovernanceLedger';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const RETAINED_CORPUS_INFLUENCE_VERSION =
  'case-vortex-retained-corpus-influence-v1' as const;

export const RETAINED_CORPUS_INFLUENCE_LANES = [
  'evidence',
  'discovery_signal',
  'metadata_lead',
  'coverage_gap',
] as const;

export type RetainedCorpusInfluenceLane =
  typeof RETAINED_CORPUS_INFLUENCE_LANES[number];

type InfluenceCapabilities = {
  searchableMaterial:
    | 'governed_public_content'
    | 'derived_features_only'
    | 'metadata_and_source_link_only'
    | 'presence_and_count_only';
  maySupportOrContradictClaims: boolean;
  mayShapeSimilarityAndDiscovery: boolean;
  mayIdentifyResearchLeads: boolean;
  mayIncreaseUncertaintyOrCoverageGaps: boolean;
  independentCorroborationCredit: boolean;
};

export type RetainedCorpusInfluenceReceipt = {
  schemaVersion: typeof RETAINED_CORPUS_INFLUENCE_VERSION;
  boundCensus: {
    receiptSha256: string;
    inspectedAt: string;
    sourceMvccSnapshot: string;
  };
  boundSourceGovernance: {
    receiptSha256: string;
    inspectedAt: string;
    sourceMvccSnapshot: string;
  };
  retainedByKind: {
    sighting: number;
    document: number;
    photo: number;
    video: number;
  };
  researchReadyByKind: {
    sighting: number;
    document: number;
    photo: number;
    video: number;
  };
  influenceLaneCounts: Record<RetainedCorpusInfluenceLane, number>;
  aggregateCoverageGaps: {
    approvedSourceQualityExclusions: number;
    nonPublicMedia: number;
  };
  sources: Array<{
    normalizedSource: string;
    canonicalSource: string;
    rowCount: number;
    governanceDecision: SourceGovernanceLedgerReceipt['sources'][number]['decision'];
    legalStatus: SourceGovernanceLedgerReceipt['sources'][number]['legalStatus'];
    allowedContentModes: string[];
    evidenceUrlPresent: boolean;
    influenceLane: RetainedCorpusInfluenceLane;
    capabilities: InfluenceCapabilities;
    reason:
      | 'approved_public_candidate'
      | 'approved_derived_material'
      | 'reviewable_source_reference'
      | 'restricted_or_unverified_presence';
  }>;
  accounting: {
    retainedRecordCount: number;
    researchReadyRecordCount: number;
    sourceGovernanceExcludedSightingCount: number;
    otherExcludedSightingCount: number;
    nonPublicMediaCount: number;
    influencedRecordCount: number;
    silentlyDiscardedRecordCount: 0;
  };
  guarantees: {
    everyRetainedRecordInfluencesAtLeastOneLane: true;
    derivedMaterialNeverReceivesIndependentCorroborationCredit: true;
    metadataOnlyMaterialNeverSupportsOrContradictsClaims: true;
    restrictedOrUnverifiedContentIsNeverExposed: true;
    rightsAndPrivacyBoundariesRemainEnforced: true;
  };
  receiptSha256: string;
};

const CAPABILITIES: Record<RetainedCorpusInfluenceLane, InfluenceCapabilities> = {
  evidence: {
    searchableMaterial: 'governed_public_content',
    maySupportOrContradictClaims: true,
    mayShapeSimilarityAndDiscovery: true,
    mayIdentifyResearchLeads: true,
    mayIncreaseUncertaintyOrCoverageGaps: true,
    independentCorroborationCredit: true,
  },
  discovery_signal: {
    searchableMaterial: 'derived_features_only',
    maySupportOrContradictClaims: false,
    mayShapeSimilarityAndDiscovery: true,
    mayIdentifyResearchLeads: true,
    mayIncreaseUncertaintyOrCoverageGaps: true,
    independentCorroborationCredit: false,
  },
  metadata_lead: {
    searchableMaterial: 'metadata_and_source_link_only',
    maySupportOrContradictClaims: false,
    mayShapeSimilarityAndDiscovery: true,
    mayIdentifyResearchLeads: true,
    mayIncreaseUncertaintyOrCoverageGaps: true,
    independentCorroborationCredit: false,
  },
  coverage_gap: {
    searchableMaterial: 'presence_and_count_only',
    maySupportOrContradictClaims: false,
    mayShapeSimilarityAndDiscovery: false,
    mayIdentifyResearchLeads: false,
    mayIncreaseUncertaintyOrCoverageGaps: true,
    independentCorroborationCredit: false,
  },
};

const total = (counts: Record<string, number>) => (
  Object.values(counts).reduce((sum, count) => sum + count, 0)
);

const sourceInfluence = (
  source: SourceGovernanceLedgerReceipt['sources'][number],
): Pick<RetainedCorpusInfluenceReceipt['sources'][number], 'influenceLane' | 'reason'> => {
  if (source.decision === 'approved_public') {
    return { influenceLane: 'evidence', reason: 'approved_public_candidate' };
  }
  if (source.decision === 'source_governance_non_public_mode'
    && source.allowedContentModes.includes('derived_only')) {
    return { influenceLane: 'discovery_signal', reason: 'approved_derived_material' };
  }
  if (source.legalStatus !== 'blocked' && source.evidenceUrlPresent) {
    return { influenceLane: 'metadata_lead', reason: 'reviewable_source_reference' };
  }
  return { influenceLane: 'coverage_gap', reason: 'restricted_or_unverified_presence' };
};

const deriveBody = (
  censusValue: unknown,
  sourceGovernanceValue: unknown,
): Omit<RetainedCorpusInfluenceReceipt, 'receiptSha256'> => {
  const census = verifyEvidenceUniverseSourceCensusReceipt(censusValue);
  const governance = verifySourceGovernanceLedgerReceipt(sourceGovernanceValue);
  if (!census.sightingAccounting
    || !census.mediaAccounting.document
    || !census.mediaAccounting.photo
    || !census.mediaAccounting.video
    || census.total === null) {
    throw new Error('retained_corpus_influence_census_accounting_incomplete');
  }
  if (governance.boundCensus.receiptSha256 !== census.receiptSha256
    || governance.boundCensus.inspectedAt !== census.inspectedAt
    || governance.boundCensus.sourceMvccSnapshot !== census.sourceMvccSnapshot) {
    throw new Error('retained_corpus_influence_census_binding_mismatch');
  }
  if (governance.summary.totalRows !== census.sightingAccounting.total
    || governance.summary.excludedRows !== census.sightingAccounting.exclusionReasons.sourceUnapproved) {
    throw new Error('retained_corpus_influence_source_accounting_mismatch');
  }

  const sources = governance.sources.map((source) => {
    const influence = sourceInfluence(source);
    return {
      normalizedSource: source.normalizedSource,
      canonicalSource: source.canonicalSource,
      rowCount: source.totalRows,
      governanceDecision: source.decision,
      legalStatus: source.legalStatus,
      allowedContentModes: [...source.allowedContentModes],
      evidenceUrlPresent: source.evidenceUrlPresent,
      ...influence,
      capabilities: { ...CAPABILITIES[influence.influenceLane] },
    };
  });

  const sourceLaneCounts = Object.fromEntries(RETAINED_CORPUS_INFLUENCE_LANES.map((lane) => [
    lane,
    sources.filter((source) => source.influenceLane === lane)
      .reduce((sum, source) => sum + source.rowCount, 0),
  ])) as Record<RetainedCorpusInfluenceLane, number>;
  const otherExcludedSightingCount = census.sightingAccounting.excluded
    - census.sightingAccounting.exclusionReasons.sourceUnapproved;
  const nonPublicMediaCount = census.mediaAccounting.document.nonPublic
    + census.mediaAccounting.photo.nonPublic
    + census.mediaAccounting.video.nonPublic;
  const researchReadyByKind = {
    sighting: census.sightingAccounting.eligible,
    document: census.mediaAccounting.document.public,
    photo: census.mediaAccounting.photo.public,
    video: census.mediaAccounting.video.public,
  };
  const retainedByKind = {
    sighting: census.sightingAccounting.total,
    document: census.mediaAccounting.document.total,
    photo: census.mediaAccounting.photo.total,
    video: census.mediaAccounting.video.total,
  };
  const researchReadyRecordCount = total(researchReadyByKind);
  if (researchReadyRecordCount !== census.total
    || sourceLaneCounts.evidence !== governance.summary.approvedPublicRows
    || otherExcludedSightingCount < 0) {
    throw new Error('retained_corpus_influence_research_ready_accounting_mismatch');
  }

  // Approved/public source rows that fail record-level quality gates are moved
  // from evidentiary influence to coverage-gap influence. They still affect
  // completeness and uncertainty, but cannot support a claim.
  const influenceLaneCounts = {
    evidence: researchReadyRecordCount,
    discovery_signal: sourceLaneCounts.discovery_signal,
    metadata_lead: sourceLaneCounts.metadata_lead,
    coverage_gap: sourceLaneCounts.coverage_gap
      + otherExcludedSightingCount
      + nonPublicMediaCount,
  };
  const retainedRecordCount = total(retainedByKind);
  const influencedRecordCount = total(influenceLaneCounts);
  if (influencedRecordCount !== retainedRecordCount) {
    throw new Error('retained_corpus_influence_terminal_accounting_mismatch');
  }

  return {
    schemaVersion: RETAINED_CORPUS_INFLUENCE_VERSION,
    boundCensus: {
      receiptSha256: census.receiptSha256,
      inspectedAt: census.inspectedAt,
      sourceMvccSnapshot: census.sourceMvccSnapshot,
    },
    boundSourceGovernance: {
      receiptSha256: governance.receiptSha256,
      inspectedAt: governance.inspectedAt,
      sourceMvccSnapshot: governance.sourceMvccSnapshot,
    },
    retainedByKind,
    researchReadyByKind,
    influenceLaneCounts,
    aggregateCoverageGaps: {
      approvedSourceQualityExclusions: otherExcludedSightingCount,
      nonPublicMedia: nonPublicMediaCount,
    },
    sources,
    accounting: {
      retainedRecordCount,
      researchReadyRecordCount,
      sourceGovernanceExcludedSightingCount:
        census.sightingAccounting.exclusionReasons.sourceUnapproved,
      otherExcludedSightingCount,
      nonPublicMediaCount,
      influencedRecordCount,
      silentlyDiscardedRecordCount: 0,
    },
    guarantees: {
      everyRetainedRecordInfluencesAtLeastOneLane: true,
      derivedMaterialNeverReceivesIndependentCorroborationCredit: true,
      metadataOnlyMaterialNeverSupportsOrContradictsClaims: true,
      restrictedOrUnverifiedContentIsNeverExposed: true,
      rightsAndPrivacyBoundariesRemainEnforced: true,
    },
  };
};

export const buildRetainedCorpusInfluenceReceipt = (
  censusValue: unknown,
  sourceGovernanceValue: unknown,
): RetainedCorpusInfluenceReceipt => {
  const body = deriveBody(censusValue, sourceGovernanceValue);
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

export const verifyRetainedCorpusInfluenceReceipt = (
  value: unknown,
  censusValue: unknown,
  sourceGovernanceValue: unknown,
): RetainedCorpusInfluenceReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('retained_corpus_influence_receipt_invalid');
  }
  const expected = buildRetainedCorpusInfluenceReceipt(censusValue, sourceGovernanceValue);
  if (relationshipInputSha256(value) !== relationshipInputSha256(expected)) {
    throw new Error('retained_corpus_influence_receipt_mismatch');
  }
  return expected;
};
