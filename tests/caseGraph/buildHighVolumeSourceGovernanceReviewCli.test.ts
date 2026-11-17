import { describe, expect, it, vi } from 'vitest';

import { runHighVolumeSourceGovernanceReviewCli } from '../../src/cli/buildHighVolumeSourceGovernanceReview';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const sources = [
  ['CORGIS', 60, 'source_governance_not_approved', 'review', ['metadata_only'], false],
  ['HF_UFO_CLUSTERED', 327, 'source_governance_non_public_mode', 'approved', ['derived_only'], true],
  ['KAGGLE_WORLDWIDE', 132, 'source_governance_not_approved', 'review', ['metadata_only'], false],
  ['NUFORC', 147, 'source_governance_not_approved', 'restricted', ['metadata_only'], true],
  ['NUFORC_ENHANCED', 178, 'source_governance_not_approved', 'review', ['metadata_only'], false],
].map(([name, count, decision, status, modes, evidence]) => ({
  normalizedSource: name, canonicalSource: name, aliasApplied: false, totalRows: count,
  decision, legalStatus: status, allowedContentModes: modes, evidenceUrlPresent: evidence,
}));
const body = {
  schemaVersion: 'case-vortex-source-governance-ledger-v1',
  inspectedAt: '2026-07-22T16:45:57.609298Z', sourceMvccSnapshot: '100:200:',
  transaction: { isolation: 'repeatable read', readOnly: true },
  boundCensus: {
    receiptSha256: 'a'.repeat(64), inspectedAt: '2026-07-22T16:20:01.253485Z',
    sourceMvccSnapshot: '99:199:', expectedSourceUnapprovedRows: 844,
  },
  summary: {
    sourceCount: 5, totalRows: 844, approvedPublicRows: 0, excludedRows: 844,
    exclusionReasons: { missingRegistry: 0, notApproved: 517, nonPublicMode: 327 },
  },
  sources,
  guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0, networkDiscoveryCalls: 0 },
};
const ledger = { ...body, receiptSha256: relationshipInputSha256(body) };

describe('high-volume source governance review CLI', () => {
  it('requires explicit local paths and rejects mutation authority', async () => {
    const readJson = vi.fn();
    await expect(runHighVolumeSourceGovernanceReviewCli([], { readJson }))
      .rejects.toThrow('--governance-ledger is required');
    await expect(runHighVolumeSourceGovernanceReviewCli([
      '--governance-ledger=ledger.json', '--output=review.json', '--approve',
    ], { readJson })).rejects.toThrow('proposal-only');
    expect(readJson).not.toHaveBeenCalled();
  });

  it('writes one sealed local proposal and performs no external operation', async () => {
    const writeReceipt = vi.fn(async () => '/tmp/review.json');
    const result = await runHighVolumeSourceGovernanceReviewCli([
      '--governance-ledger=ledger.json', '--output=review.json',
    ], {
      readJson: vi.fn(async () => ledger),
      writeReceipt,
      now: () => new Date('2026-07-22T19:00:00.000Z'),
    });
    expect(result).toMatchObject({
      proposal_only: true,
      approval_granted: false,
      scope: { sourceCount: 5, rowCount: 844 },
      output_path: '/tmp/review.json',
    });
    expect(writeReceipt).toHaveBeenCalledWith('review.json', expect.objectContaining({
      receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      guarantees: expect.objectContaining({ registryMutations: 0, databaseWrites: 0, lunaCalls: 0 }),
    }));
  });
});
