import { buildHighVolumeSourceGovernanceReview } from '../../src/caseGraph/highVolumeSourceGovernanceReview';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const source = (
  normalizedSource: string,
  totalRows: number,
  legalStatus: 'approved' | 'review' | 'restricted',
  allowedContentModes: string[],
  evidenceUrlPresent: boolean,
) => ({
  normalizedSource, canonicalSource: normalizedSource, aliasApplied: false, totalRows,
  decision: legalStatus === 'approved'
    ? (allowedContentModes.includes('full_ingest') ? 'approved_public' : 'source_governance_non_public_mode')
    : 'source_governance_not_approved',
  legalStatus, allowedContentModes, evidenceUrlPresent,
});

export const residualQueueLedgerBody = {
  schemaVersion: 'case-vortex-source-governance-ledger-v1' as const,
  inspectedAt: '2026-07-22T16:45:57.609298Z',
  sourceMvccSnapshot: '100:200:',
  transaction: { isolation: 'repeatable read' as const, readOnly: true as const },
  boundCensus: {
    receiptSha256: 'a'.repeat(64), inspectedAt: '2026-07-22T16:20:01.253485Z',
    sourceMvccSnapshot: '99:199:', expectedSourceUnapprovedRows: 900,
  },
  summary: {
    sourceCount: 12, totalRows: 910, approvedPublicRows: 10, excludedRows: 900,
    exclusionReasons: { missingRegistry: 0, notApproved: 573, nonPublicMode: 327 },
  },
  sources: [
    source('AARO', 10, 'approved', ['full_ingest'], true),
    source('ANONYMOUS PDF (PUBLIC DOMAIN)', 5, 'review', ['metadata_only'], false),
    source('CISU', 7, 'review', ['full_ingest'], true),
    source('CORGIS', 60, 'review', ['metadata_only'], false),
    source('EBERHART TIMELINE', 11, 'review', ['metadata_only'], false),
    source('HF_UFO_CLUSTERED', 327, 'approved', ['derived_only'], true),
    source('KAGGLE_WORLDWIDE', 132, 'review', ['metadata_only'], false),
    source('NUFORC', 147, 'restricted', ['metadata_only'], true),
    source('NUFORC_ENHANCED', 178, 'review', ['metadata_only'], false),
    source('RICH_GELREICH_EBERHART', 11, 'review', ['metadata_only'], false),
    source('RICH_GELREICH_OPENAI_RESULTS', 13, 'review', ['metadata_only'], false),
    source('SKYWATCH', 9, 'review', ['metadata_only'], true),
  ],
  guarantees: { databaseWrites: 0 as const, r2Reads: 0 as const, r2Writes: 0 as const, lunaCalls: 0 as const, networkDiscoveryCalls: 0 as const },
};

export const residualQueueLedger = {
  ...residualQueueLedgerBody,
  receiptSha256: relationshipInputSha256(residualQueueLedgerBody),
};

export const residualQueueReview = buildHighVolumeSourceGovernanceReview(residualQueueLedger, {
  reviewedAt: '2026-07-22T19:00:00.000000Z',
});
