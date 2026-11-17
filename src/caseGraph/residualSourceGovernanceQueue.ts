import {
  type HighVolumeSourceGovernanceReviewReceipt,
  verifyHighVolumeSourceGovernanceReviewReceipt,
} from './highVolumeSourceGovernanceReview';
import {
  type SourceGovernanceLedgerReceipt,
  verifySourceGovernanceLedgerReceipt,
} from './postgresSourceGovernanceLedger';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';

export const RESIDUAL_SOURCE_GOVERNANCE_QUEUE_VERSION = 'case-vortex-residual-source-governance-queue-v1' as const;

const PRIORITIES = ['critical-lineage-review', 'high-provenance-review', 'standard-policy-review'] as const;
type Priority = typeof PRIORITIES[number];

const RISK_FLAGS = [
  'ai-derived-label',
  'asserted-rights-label-needs-primary-proof',
  'exact-count-peer-needs-overlap-analysis',
  'missing-registry-evidence-url',
  'probable-secondary-compilation',
  'review-status-allows-full-ingest',
  'restricted-or-blocked',
] as const;
type RiskFlag = typeof RISK_FLAGS[number];

const REQUIRED_EVIDENCE = [
  'dataset-specific-rights-or-permission',
  'full-ingest-scope-approval',
  'model-input-output-lineage',
  'publisher-or-custodian-identity',
  'registry-evidence-url',
  'rights-claim-primary-document',
  'row-level-overlap-receipt',
  'upstream-provenance-chain',
  'witness-and-source-independence-map',
] as const;
type RequiredEvidence = typeof REQUIRED_EVIDENCE[number];

export type ResidualSourceGovernanceQueueReceipt = {
  schemaVersion: typeof RESIDUAL_SOURCE_GOVERNANCE_QUEUE_VERSION;
  builtAt: string;
  boundGovernanceLedger: {
    receiptSha256: string;
    inspectedAt: string;
    sourceMvccSnapshot: string;
  };
  boundHighVolumeReview: {
    receiptSha256: string;
    reviewedAt: string;
    sourceCount: number;
    rowCount: number;
  };
  summary: {
    sourceCount: number;
    rowCount: number;
    prioritySourceCounts: Record<Priority, number>;
    priorityRowCounts: Record<Priority, number>;
    missingEvidenceUrlSourceCount: number;
    missingEvidenceUrlRowCount: number;
    exactCountPeerSourceCount: number;
    exactCountPeerRowCount: number;
    fullIngestReviewSourceCount: number;
    fullIngestReviewRowCount: number;
  };
  items: Array<{
    source: string;
    rowCount: number;
    currentDecision: string;
    currentLegalStatus: string;
    currentAllowedContentModes: string[];
    evidenceUrlPresent: boolean;
    exactRowCountPeers: string[];
    riskFlags: RiskFlag[];
    priority: Priority;
    requiredEvidence: RequiredEvidence[];
  }>;
  guarantees: {
    proposalOnly: true;
    automaticApproval: false;
    governanceDecisions: 0;
    registryMutations: 0;
    databaseWrites: 0;
    r2Reads: 0;
    r2Writes: 0;
    lunaCalls: 0;
    networkDiscoveryCalls: 0;
  };
  receiptSha256: string;
};

const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const priorityIndex = (priority: Priority) => PRIORITIES.indexOf(priority);

const timestamp = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/u.test(raw)
    || !Number.isFinite(new Date(raw).getTime())) throw new Error('residual_source_queue_timestamp_invalid');
  return raw;
};

const flagsFor = (
  source: SourceGovernanceLedgerReceipt['sources'][number],
  exactRowCountPeers: string[],
): RiskFlag[] => {
  const flags: RiskFlag[] = [];
  if (/OPENAI|\bGPT\b|\bLLM\b/iu.test(source.normalizedSource)) flags.push('ai-derived-label');
  if (/PUBLIC[ _-]?DOMAIN|GNU[ _-]?FDL|CREATIVE[ _-]?COMMONS|\bCC0\b/iu.test(source.normalizedSource)) {
    flags.push('asserted-rights-label-needs-primary-proof');
  }
  if (exactRowCountPeers.length) flags.push('exact-count-peer-needs-overlap-analysis');
  if (!source.evidenceUrlPresent) flags.push('missing-registry-evidence-url');
  if (/^RICH_GELREICH_/u.test(source.normalizedSource)) flags.push('probable-secondary-compilation');
  if (source.legalStatus === 'review' && source.allowedContentModes.includes('full_ingest')) {
    flags.push('review-status-allows-full-ingest');
  }
  if (source.legalStatus === 'restricted' || source.legalStatus === 'blocked') flags.push('restricted-or-blocked');
  return flags.sort(compareText);
};

const priorityFor = (flags: RiskFlag[]): Priority => {
  if (flags.some((flag) => [
    'ai-derived-label', 'asserted-rights-label-needs-primary-proof',
    'exact-count-peer-needs-overlap-analysis', 'review-status-allows-full-ingest',
  ].includes(flag))) return 'critical-lineage-review';
  if (flags.some((flag) => [
    'missing-registry-evidence-url', 'probable-secondary-compilation', 'restricted-or-blocked',
  ].includes(flag))) return 'high-provenance-review';
  return 'standard-policy-review';
};

const evidenceFor = (flags: RiskFlag[]): RequiredEvidence[] => {
  const evidence = new Set<RequiredEvidence>([
    'dataset-specific-rights-or-permission',
    'publisher-or-custodian-identity',
    'upstream-provenance-chain',
    'witness-and-source-independence-map',
  ]);
  if (flags.includes('missing-registry-evidence-url')) evidence.add('registry-evidence-url');
  if (flags.includes('exact-count-peer-needs-overlap-analysis')) evidence.add('row-level-overlap-receipt');
  if (flags.includes('ai-derived-label')) evidence.add('model-input-output-lineage');
  if (flags.includes('asserted-rights-label-needs-primary-proof')) evidence.add('rights-claim-primary-document');
  if (flags.includes('review-status-allows-full-ingest')) evidence.add('full-ingest-scope-approval');
  return [...evidence].sort(compareText);
};

const deriveBody = (
  governanceLedgerValue: unknown,
  highVolumeReviewValue: unknown,
  builtAtValue: unknown,
): Omit<ResidualSourceGovernanceQueueReceipt, 'receiptSha256'> => {
  const ledger = verifySourceGovernanceLedgerReceipt(governanceLedgerValue);
  const review = verifyHighVolumeSourceGovernanceReviewReceipt(highVolumeReviewValue, ledger);
  const builtAt = timestamp(builtAtValue);
  const reviewed = new Set<string>(review.sources.map(({ source }) => source));
  const residual = ledger.sources.filter((source) => (
    source.decision !== 'approved_public' && !reviewed.has(source.normalizedSource)
  ));
  const byCount = new Map<number, string[]>();
  for (const source of residual) {
    const names = byCount.get(source.totalRows) || [];
    names.push(source.normalizedSource);
    byCount.set(source.totalRows, names);
  }
  const items = residual.map((source) => {
    const exactRowCountPeers = (byCount.get(source.totalRows) || [])
      .filter((name) => name !== source.normalizedSource)
      .sort(compareText);
    const riskFlags = flagsFor(source, exactRowCountPeers);
    return {
      source: source.normalizedSource,
      rowCount: source.totalRows,
      currentDecision: source.decision,
      currentLegalStatus: source.legalStatus,
      currentAllowedContentModes: [...source.allowedContentModes],
      evidenceUrlPresent: source.evidenceUrlPresent,
      exactRowCountPeers,
      riskFlags,
      priority: priorityFor(riskFlags),
      requiredEvidence: evidenceFor(riskFlags),
    };
  }).sort((left, right) => (
    priorityIndex(left.priority) - priorityIndex(right.priority)
    || right.rowCount - left.rowCount
    || compareText(left.source, right.source)
  ));
  const countSources = (priority: Priority) => items.filter((item) => item.priority === priority).length;
  const countRows = (priority: Priority) => items.filter((item) => item.priority === priority)
    .reduce((sum, item) => sum + item.rowCount, 0);
  const exactCountPeers = items.filter((item) => item.riskFlags.includes('exact-count-peer-needs-overlap-analysis'));
  const fullIngestReview = items.filter((item) => item.riskFlags.includes('review-status-allows-full-ingest'));
  const missingEvidenceUrl = items.filter((item) => item.riskFlags.includes('missing-registry-evidence-url'));
  return {
    schemaVersion: RESIDUAL_SOURCE_GOVERNANCE_QUEUE_VERSION,
    builtAt,
    boundGovernanceLedger: {
      receiptSha256: ledger.receiptSha256,
      inspectedAt: ledger.inspectedAt,
      sourceMvccSnapshot: ledger.sourceMvccSnapshot,
    },
    boundHighVolumeReview: {
      receiptSha256: review.receiptSha256,
      reviewedAt: review.reviewedAt,
      sourceCount: review.scope.sourceCount,
      rowCount: review.scope.rowCount,
    },
    summary: {
      sourceCount: items.length,
      rowCount: items.reduce((sum, item) => sum + item.rowCount, 0),
      prioritySourceCounts: Object.fromEntries(PRIORITIES.map((priority) => [priority, countSources(priority)])) as Record<Priority, number>,
      priorityRowCounts: Object.fromEntries(PRIORITIES.map((priority) => [priority, countRows(priority)])) as Record<Priority, number>,
      missingEvidenceUrlSourceCount: missingEvidenceUrl.length,
      missingEvidenceUrlRowCount: missingEvidenceUrl.reduce((sum, item) => sum + item.rowCount, 0),
      exactCountPeerSourceCount: exactCountPeers.length,
      exactCountPeerRowCount: exactCountPeers.reduce((sum, item) => sum + item.rowCount, 0),
      fullIngestReviewSourceCount: fullIngestReview.length,
      fullIngestReviewRowCount: fullIngestReview.reduce((sum, item) => sum + item.rowCount, 0),
    },
    items,
    guarantees: {
      proposalOnly: true,
      automaticApproval: false,
      governanceDecisions: 0,
      registryMutations: 0,
      databaseWrites: 0,
      r2Reads: 0,
      r2Writes: 0,
      lunaCalls: 0,
      networkDiscoveryCalls: 0,
    },
  };
};

export const buildResidualSourceGovernanceQueue = (
  governanceLedgerValue: unknown,
  highVolumeReviewValue: unknown,
  options: { builtAt: string },
): ResidualSourceGovernanceQueueReceipt => {
  const body = deriveBody(governanceLedgerValue, highVolumeReviewValue, options.builtAt);
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

export const verifyResidualSourceGovernanceQueue = (
  value: unknown,
  governanceLedgerValue: unknown,
  highVolumeReviewValue: unknown,
): ResidualSourceGovernanceQueueReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('residual_source_queue_receipt_invalid');
  }
  const candidate = value as ResidualSourceGovernanceQueueReceipt;
  const expectedBody = deriveBody(governanceLedgerValue, highVolumeReviewValue, candidate.builtAt);
  const { receiptSha256, ...candidateBody } = candidate;
  if (!/^[a-f0-9]{64}$/u.test(String(receiptSha256 || ''))
    || canonicalizeRelationshipInput(candidateBody) !== canonicalizeRelationshipInput(expectedBody)) {
    throw new Error('residual_source_queue_integrity_failed');
  }
  const expectedDigest = relationshipInputSha256(expectedBody);
  if (receiptSha256 !== expectedDigest) throw new Error('residual_source_queue_digest_mismatch');
  return { ...expectedBody, receiptSha256 };
};
