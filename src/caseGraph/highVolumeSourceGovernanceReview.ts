import {
  type SourceGovernanceLedgerReceipt,
  verifySourceGovernanceLedgerReceipt,
} from './postgresSourceGovernanceLedger';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

const REVIEWED_SOURCES = [
  'CORGIS',
  'HF_UFO_CLUSTERED',
  'KAGGLE_WORLDWIDE',
  'NUFORC',
  'NUFORC_ENHANCED',
] as const;

type ReviewedSource = typeof REVIEWED_SOURCES[number];

export const HIGH_VOLUME_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-reviewed-source-lineage-v1' as const;

export type HighVolumeReviewedLineagePolicy = {
  source: ReviewedSource;
  lineageId: 'governance:nuforc-derived' | 'governance:mixed-kaggle-derived';
  sourcePosition: 'mixed' | 'secondary';
  originality: 'unknown' | 'derived';
};

type ReviewPolicy = {
  lineageFamily: 'nuforc-derived' | 'mixed-kaggle-derived';
  rightsFinding: 'current-upstream-terms-restrict-harvesting' | 'mixed-upstream-rights-unresolved';
  publicationRecommendation:
    | 'retain-restricted-link-only'
    | 'retain-review-metadata-link-only'
    | 'retain-derived-only-internal-analysis';
  corroborationRecommendation: 'never-independent-of-nuforc' | 'never-independent-case-corroboration';
  evidenceUrls: string[];
  rationaleCodes: string[];
};

const POLICY: Record<ReviewedSource, ReviewPolicy> = {
  CORGIS: {
    lineageFamily: 'nuforc-derived',
    rightsFinding: 'current-upstream-terms-restrict-harvesting',
    publicationRecommendation: 'retain-review-metadata-link-only',
    corroborationRecommendation: 'never-independent-of-nuforc',
    evidenceUrls: [
      'https://corgis-edu.github.io/corgis/csv/ufo_sightings/',
      'https://github.com/rfordatascience/tidytuesday/tree/2e9bd5a67e09b14d01f616b00f7f7e0931515d24/data/2019/2019-06-25',
      'https://nuforc.org/terms/',
    ],
    rationaleCodes: ['corgis-points-to-tidytuesday', 'tidytuesday-identifies-nuforc-origin', 'upstream-report-rights-not-relicensed'],
  },
  HF_UFO_CLUSTERED: {
    lineageFamily: 'mixed-kaggle-derived',
    rightsFinding: 'mixed-upstream-rights-unresolved',
    publicationRecommendation: 'retain-derived-only-internal-analysis',
    corroborationRecommendation: 'never-independent-case-corroboration',
    evidenceUrls: [
      'https://huggingface.co/datasets/cjc0013/Ufo_data_clustered',
      'https://nuforc.org/terms/',
    ],
    rationaleCodes: ['merged-upstream-datasets', 'dataset-card-defers-to-upstream-licenses', 'text-clusters-are-not-events'],
  },
  KAGGLE_WORLDWIDE: {
    lineageFamily: 'nuforc-derived',
    rightsFinding: 'current-upstream-terms-restrict-harvesting',
    publicationRecommendation: 'retain-review-metadata-link-only',
    corroborationRecommendation: 'never-independent-of-nuforc',
    evidenceUrls: [
      'https://github.com/planetsig/ufo-reports',
      'https://www.kaggle.com/datasets/NUFORC/ufo-sightings',
      'https://nuforc.org/terms/',
    ],
    rationaleCodes: ['worker-imports-planetsig-mirror', 'mirror-identifies-nuforc-origin', 'mirror-has-no-visible-dataset-license'],
  },
  NUFORC: {
    lineageFamily: 'nuforc-derived',
    rightsFinding: 'current-upstream-terms-restrict-harvesting',
    publicationRecommendation: 'retain-restricted-link-only',
    corroborationRecommendation: 'never-independent-of-nuforc',
    evidenceUrls: [
      'https://nuforc.org/terms/',
      'https://nuforc.org/databank/',
    ],
    rationaleCodes: ['publisher-terms-require-written-consent', 'submitters-retain-ownership', 'existing-registry-restricted'],
  },
  NUFORC_ENHANCED: {
    lineageFamily: 'nuforc-derived',
    rightsFinding: 'current-upstream-terms-restrict-harvesting',
    publicationRecommendation: 'retain-review-metadata-link-only',
    corroborationRecommendation: 'never-independent-of-nuforc',
    evidenceUrls: [
      'https://github.com/timothyrenner/nuforc_sightings_data',
      'https://nuforc.org/terms/',
    ],
    rationaleCodes: ['enhancement-does-not-create-independent-source', 'maintainer-warns-against-scraping-and-distribution', 'inherits-upstream-rights-boundary'],
  },
};

const normalizeSource = (value: string) => String(value || '').trim().toUpperCase();

export const resolveHighVolumeReviewedLineage = (
  sourceValue: string,
): HighVolumeReviewedLineagePolicy | null => {
  const source = normalizeSource(sourceValue) as ReviewedSource;
  if (!REVIEWED_SOURCES.includes(source)) return null;
  return {
    source,
    lineageId: POLICY[source].lineageFamily === 'nuforc-derived'
      ? 'governance:nuforc-derived'
      : 'governance:mixed-kaggle-derived',
    sourcePosition: source === 'NUFORC' ? 'mixed' : 'secondary',
    originality: source === 'NUFORC' ? 'unknown' : 'derived',
  };
};

export type HighVolumeSourceGovernanceReviewReceipt = {
  schemaVersion: 'case-vortex-high-volume-source-governance-review-v1';
  reviewedAt: string;
  boundGovernanceLedger: {
    receiptSha256: string;
    inspectedAt: string;
    sourceMvccSnapshot: string;
  };
  scope: {
    sourceCount: 5;
    rowCount: number;
    excludedLedgerRows: number;
  };
  sources: Array<{
    source: ReviewedSource;
    boundLedgerEntrySha256: string;
    rowCount: number;
    currentDecision: string;
    currentLegalStatus: string;
    currentAllowedContentModes: string[];
    lineageFamily: ReviewPolicy['lineageFamily'];
    rightsFinding: ReviewPolicy['rightsFinding'];
    publicationRecommendation: ReviewPolicy['publicationRecommendation'];
    corroborationRecommendation: ReviewPolicy['corroborationRecommendation'];
    evidenceUrls: string[];
    rationaleCodes: string[];
    requiresHumanLegalApproval: true;
  }>;
  guarantees: {
    proposalOnly: true;
    automaticApproval: false;
    registryMutations: 0;
    databaseWrites: 0;
    r2Reads: 0;
    r2Writes: 0;
    lunaCalls: 0;
    networkDiscoveryCalls: 0;
  };
  receiptSha256: string;
};

const exactKeys = (value: Record<string, unknown>, expected: string[], code: string) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
};

const timestamp = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/u.test(raw)
    || !Number.isFinite(new Date(raw).getTime())) throw new Error('source_governance_review_timestamp_invalid');
  return raw;
};

const sha = (value: unknown, code: string) => {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error(code);
  return digest;
};

const sourceEntryDigest = (entry: SourceGovernanceLedgerReceipt['sources'][number]) => relationshipInputSha256(entry);

const assertPolicyMatches = (source: Record<string, unknown>, policy: ReviewPolicy) => {
  const policyFields = {
    lineageFamily: policy.lineageFamily,
    rightsFinding: policy.rightsFinding,
    publicationRecommendation: policy.publicationRecommendation,
    corroborationRecommendation: policy.corroborationRecommendation,
    evidenceUrls: policy.evidenceUrls,
    rationaleCodes: policy.rationaleCodes,
  };
  const actual = Object.fromEntries(Object.keys(policyFields).map((key) => [key, source[key]]));
  if (relationshipInputSha256(actual) !== relationshipInputSha256(policyFields)) {
    throw new Error('source_governance_review_policy_drift');
  }
};

export const verifyHighVolumeSourceGovernanceReviewReceipt = (
  value: unknown,
  governanceLedgerValue: unknown,
): HighVolumeSourceGovernanceReviewReceipt => {
  const ledger = verifySourceGovernanceLedgerReceipt(governanceLedgerValue);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('source_governance_review_receipt_invalid');
  }
  const candidate = value as Record<string, unknown>;
  exactKeys(candidate, [
    'schemaVersion', 'reviewedAt', 'boundGovernanceLedger', 'scope', 'sources', 'guarantees', 'receiptSha256',
  ], 'source_governance_review_receipt_invalid');
  if (candidate.schemaVersion !== 'case-vortex-high-volume-source-governance-review-v1') {
    throw new Error('source_governance_review_receipt_invalid');
  }
  const reviewedAt = timestamp(candidate.reviewedAt);
  const bound = candidate.boundGovernanceLedger as Record<string, unknown>;
  if (!bound || typeof bound !== 'object' || Array.isArray(bound)) {
    throw new Error('source_governance_review_binding_invalid');
  }
  exactKeys(bound, ['receiptSha256', 'inspectedAt', 'sourceMvccSnapshot'], 'source_governance_review_binding_invalid');
  const boundGovernanceLedger = {
    receiptSha256: sha(bound.receiptSha256, 'source_governance_review_binding_invalid'),
    inspectedAt: timestamp(bound.inspectedAt),
    sourceMvccSnapshot: String(bound.sourceMvccSnapshot || '').trim(),
  };
  if (boundGovernanceLedger.receiptSha256 !== ledger.receiptSha256
    || boundGovernanceLedger.inspectedAt !== ledger.inspectedAt
    || boundGovernanceLedger.sourceMvccSnapshot !== ledger.sourceMvccSnapshot) {
    throw new Error('source_governance_review_binding_drift');
  }
  const scope = candidate.scope as Record<string, unknown>;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('source_governance_review_scope_invalid');
  }
  exactKeys(scope, ['sourceCount', 'rowCount', 'excludedLedgerRows'], 'source_governance_review_scope_invalid');
  if (scope.sourceCount !== 5 || scope.excludedLedgerRows !== ledger.summary.excludedRows) {
    throw new Error('source_governance_review_scope_invalid');
  }
  if (!Array.isArray(candidate.sources) || candidate.sources.length !== REVIEWED_SOURCES.length) {
    throw new Error('source_governance_review_sources_invalid');
  }
  const sources = candidate.sources.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('source_governance_review_source_invalid');
    const source = raw as Record<string, unknown>;
    exactKeys(source, [
      'source', 'boundLedgerEntrySha256', 'rowCount', 'currentDecision', 'currentLegalStatus',
      'currentAllowedContentModes', 'lineageFamily', 'rightsFinding', 'publicationRecommendation',
      'corroborationRecommendation', 'evidenceUrls', 'rationaleCodes', 'requiresHumanLegalApproval',
    ], 'source_governance_review_source_invalid');
    const sourceName = REVIEWED_SOURCES[index];
    if (source.source !== sourceName || source.requiresHumanLegalApproval !== true) {
      throw new Error('source_governance_review_source_invalid');
    }
    const ledgerEntry = ledger.sources.find((entry) => entry.normalizedSource === sourceName);
    if (!ledgerEntry) throw new Error('source_governance_review_ledger_source_missing');
    if (source.boundLedgerEntrySha256 !== sourceEntryDigest(ledgerEntry)
      || source.rowCount !== ledgerEntry.totalRows
      || source.currentDecision !== ledgerEntry.decision
      || source.currentLegalStatus !== ledgerEntry.legalStatus
      || relationshipInputSha256(source.currentAllowedContentModes) !== relationshipInputSha256(ledgerEntry.allowedContentModes)) {
      throw new Error('source_governance_review_ledger_source_drift');
    }
    assertPolicyMatches(source, POLICY[sourceName]);
    return source as HighVolumeSourceGovernanceReviewReceipt['sources'][number];
  });
  const rowCount = sources.reduce((sum, source) => sum + source.rowCount, 0);
  if (!Number.isSafeInteger(scope.rowCount) || scope.rowCount !== rowCount) {
    throw new Error('source_governance_review_scope_invalid');
  }
  const guarantees = candidate.guarantees as Record<string, unknown>;
  if (!guarantees || typeof guarantees !== 'object' || Array.isArray(guarantees)) {
    throw new Error('source_governance_review_guarantees_invalid');
  }
  exactKeys(guarantees, [
    'proposalOnly', 'automaticApproval', 'registryMutations', 'databaseWrites', 'r2Reads', 'r2Writes',
    'lunaCalls', 'networkDiscoveryCalls',
  ], 'source_governance_review_guarantees_invalid');
  if (guarantees.proposalOnly !== true || guarantees.automaticApproval !== false
    || Object.entries(guarantees).some(([key, item]) => !['proposalOnly', 'automaticApproval'].includes(key) && item !== 0)) {
    throw new Error('source_governance_review_guarantees_invalid');
  }
  const body = {
    schemaVersion: 'case-vortex-high-volume-source-governance-review-v1' as const,
    reviewedAt,
    boundGovernanceLedger,
    scope: { sourceCount: 5 as const, rowCount, excludedLedgerRows: ledger.summary.excludedRows },
    sources,
    guarantees: guarantees as HighVolumeSourceGovernanceReviewReceipt['guarantees'],
  };
  if (sha(candidate.receiptSha256, 'source_governance_review_digest_invalid') !== relationshipInputSha256(body)) {
    throw new Error('source_governance_review_digest_mismatch');
  }
  return { ...body, receiptSha256: candidate.receiptSha256 as string };
};

export const buildHighVolumeSourceGovernanceReview = (
  governanceLedgerValue: unknown,
  options: { reviewedAt: string },
): HighVolumeSourceGovernanceReviewReceipt => {
  const ledger = verifySourceGovernanceLedgerReceipt(governanceLedgerValue);
  const reviewedAt = timestamp(options.reviewedAt);
  const sources = REVIEWED_SOURCES.map((source) => {
    const entry = ledger.sources.find((candidate) => candidate.normalizedSource === source);
    if (!entry) throw new Error('source_governance_review_ledger_source_missing');
    return {
      source,
      boundLedgerEntrySha256: sourceEntryDigest(entry),
      rowCount: entry.totalRows,
      currentDecision: entry.decision,
      currentLegalStatus: entry.legalStatus,
      currentAllowedContentModes: entry.allowedContentModes,
      ...POLICY[source],
      requiresHumanLegalApproval: true as const,
    };
  });
  const body: Omit<HighVolumeSourceGovernanceReviewReceipt, 'receiptSha256'> = {
    schemaVersion: 'case-vortex-high-volume-source-governance-review-v1',
    reviewedAt,
    boundGovernanceLedger: {
      receiptSha256: ledger.receiptSha256,
      inspectedAt: ledger.inspectedAt,
      sourceMvccSnapshot: ledger.sourceMvccSnapshot,
    },
    scope: {
      sourceCount: 5,
      rowCount: sources.reduce((sum, source) => sum + source.rowCount, 0),
      excludedLedgerRows: ledger.summary.excludedRows,
    },
    sources,
    guarantees: {
      proposalOnly: true,
      automaticApproval: false,
      registryMutations: 0,
      databaseWrites: 0,
      r2Reads: 0,
      r2Writes: 0,
      lunaCalls: 0,
      networkDiscoveryCalls: 0,
    },
  };
  return verifyHighVolumeSourceGovernanceReviewReceipt(
    { ...body, receiptSha256: relationshipInputSha256(body) },
    ledger,
  );
};
