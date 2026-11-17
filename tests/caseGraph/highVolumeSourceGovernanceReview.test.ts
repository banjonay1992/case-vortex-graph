import { describe, expect, it } from 'vitest';

import {
  buildHighVolumeSourceGovernanceReview,
  resolveHighVolumeReviewedLineage,
  verifyHighVolumeSourceGovernanceReviewReceipt,
} from '../../src/caseGraph/highVolumeSourceGovernanceReview';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const sourceRows = [
  {
    normalizedSource: 'CORGIS', canonicalSource: 'CORGIS', aliasApplied: false, totalRows: 60,
    decision: 'source_governance_not_approved', legalStatus: 'review',
    allowedContentModes: ['metadata_only'], evidenceUrlPresent: false,
  },
  {
    normalizedSource: 'HF_UFO_CLUSTERED', canonicalSource: 'HF_UFO_CLUSTERED', aliasApplied: false, totalRows: 327,
    decision: 'source_governance_non_public_mode', legalStatus: 'approved',
    allowedContentModes: ['derived_only'], evidenceUrlPresent: true,
  },
  {
    normalizedSource: 'KAGGLE_WORLDWIDE', canonicalSource: 'KAGGLE_WORLDWIDE', aliasApplied: false, totalRows: 132,
    decision: 'source_governance_not_approved', legalStatus: 'review',
    allowedContentModes: ['metadata_only'], evidenceUrlPresent: false,
  },
  {
    normalizedSource: 'NUFORC', canonicalSource: 'NUFORC', aliasApplied: false, totalRows: 147,
    decision: 'source_governance_not_approved', legalStatus: 'restricted',
    allowedContentModes: ['metadata_only'], evidenceUrlPresent: true,
  },
  {
    normalizedSource: 'NUFORC_ENHANCED', canonicalSource: 'NUFORC_ENHANCED', aliasApplied: false, totalRows: 178,
    decision: 'source_governance_not_approved', legalStatus: 'review',
    allowedContentModes: ['metadata_only'], evidenceUrlPresent: false,
  },
] as const;

const ledgerBody = {
  schemaVersion: 'case-vortex-source-governance-ledger-v1' as const,
  inspectedAt: '2026-07-22T16:45:57.609298Z',
  sourceMvccSnapshot: '100:200:',
  transaction: { isolation: 'repeatable read' as const, readOnly: true as const },
  boundCensus: {
    receiptSha256: 'a'.repeat(64), inspectedAt: '2026-07-22T16:20:01.253485Z',
    sourceMvccSnapshot: '99:199:', expectedSourceUnapprovedRows: 844,
  },
  summary: {
    sourceCount: 5, totalRows: 844, approvedPublicRows: 0, excludedRows: 844,
    exclusionReasons: { missingRegistry: 0, notApproved: 517, nonPublicMode: 327 },
  },
  sources: sourceRows,
  guarantees: { databaseWrites: 0 as const, r2Reads: 0 as const, r2Writes: 0 as const, lunaCalls: 0 as const, networkDiscoveryCalls: 0 as const },
};
const ledger = { ...ledgerBody, receiptSha256: relationshipInputSha256(ledgerBody) };

const resealReview = (value: Record<string, unknown>, overrides: Record<string, unknown>) => {
  const { receiptSha256: _digest, ...body } = { ...value, ...overrides };
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

describe('high-volume source governance review', () => {
  it('resolves reviewed dataset labels to conservative lineage identities', () => {
    expect(resolveHighVolumeReviewedLineage(' nuforc_enhanced ')).toEqual({
      source: 'NUFORC_ENHANCED', lineageId: 'governance:nuforc-derived',
      sourcePosition: 'secondary', originality: 'derived',
    });
    expect(resolveHighVolumeReviewedLineage('NUFORC')).toMatchObject({
      lineageId: 'governance:nuforc-derived', sourcePosition: 'mixed', originality: 'unknown',
    });
    expect(resolveHighVolumeReviewedLineage('HF_UFO_CLUSTERED')).toMatchObject({
      lineageId: 'governance:mixed-kaggle-derived', originality: 'derived',
    });
    expect(resolveHighVolumeReviewedLineage('unreviewed')).toBeNull();
  });
  it('binds all five review decisions to the sealed ledger without granting publication authority', () => {
    const receipt = buildHighVolumeSourceGovernanceReview(ledger, {
      reviewedAt: '2026-07-22T19:00:00.000000Z',
    });
    expect(receipt.scope).toEqual({ sourceCount: 5, rowCount: 844, excludedLedgerRows: 844 });
    expect(receipt.sources.map((source) => source.source)).toEqual([
      'CORGIS', 'HF_UFO_CLUSTERED', 'KAGGLE_WORLDWIDE', 'NUFORC', 'NUFORC_ENHANCED',
    ]);
    expect(receipt.sources.find((source) => source.source === 'HF_UFO_CLUSTERED')).toMatchObject({
      publicationRecommendation: 'retain-derived-only-internal-analysis',
      corroborationRecommendation: 'never-independent-case-corroboration',
    });
    expect(receipt.sources.filter((source) => source.lineageFamily === 'nuforc-derived')).toHaveLength(4);
    expect(receipt.guarantees).toEqual({
      proposalOnly: true, automaticApproval: false, registryMutations: 0, databaseWrites: 0,
      r2Reads: 0, r2Writes: 0, lunaCalls: 0, networkDiscoveryCalls: 0,
    });
    expect(verifyHighVolumeSourceGovernanceReviewReceipt(receipt, ledger)).toEqual(receipt);
  });

  it('rejects a re-sealed promotion, independent-corroboration claim, or row-count drift', () => {
    const receipt = buildHighVolumeSourceGovernanceReview(ledger, {
      reviewedAt: '2026-07-22T19:00:00.000000Z',
    });
    const mutateSource = (name: string, values: Record<string, unknown>) => receipt.sources.map((source) => (
      source.source === name ? { ...source, ...values } : source
    ));
    expect(() => verifyHighVolumeSourceGovernanceReviewReceipt(resealReview(receipt, {
      sources: mutateSource('NUFORC', { publicationRecommendation: 'approved-public' }),
    }), ledger)).toThrow('source_governance_review_policy_drift');
    expect(() => verifyHighVolumeSourceGovernanceReviewReceipt(resealReview(receipt, {
      sources: mutateSource('CORGIS', { corroborationRecommendation: 'independent' }),
    }), ledger)).toThrow('source_governance_review_policy_drift');
    expect(() => verifyHighVolumeSourceGovernanceReviewReceipt(resealReview(receipt, {
      sources: mutateSource('KAGGLE_WORLDWIDE', { rowCount: 133 }),
      scope: { ...receipt.scope, rowCount: receipt.scope.rowCount + 1 },
    }), ledger)).toThrow('source_governance_review_ledger_source_drift');
  });

  it('requires the exact bound governance ledger', () => {
    const receipt = buildHighVolumeSourceGovernanceReview(ledger, {
      reviewedAt: '2026-07-22T19:00:00.000000Z',
    });
    const changedLedgerBody = {
      ...ledgerBody,
      inspectedAt: '2026-07-22T17:45:57.609298Z',
    };
    const changedLedger = { ...changedLedgerBody, receiptSha256: relationshipInputSha256(changedLedgerBody) };
    expect(() => verifyHighVolumeSourceGovernanceReviewReceipt(receipt, changedLedger))
      .toThrow('source_governance_review_binding_drift');
  });
});
