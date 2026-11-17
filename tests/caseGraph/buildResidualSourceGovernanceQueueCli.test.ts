import { describe, expect, it, vi } from 'vitest';

import { runResidualSourceGovernanceQueueCli } from '../../src/cli/buildResidualSourceGovernanceQueue';
import { residualQueueLedger, residualQueueReview } from './residualSourceGovernanceQueueTestSupport';

describe('residual source governance queue CLI', () => {
  it('requires all explicit local paths and rejects mutation flags before reading', async () => {
    const readJson = vi.fn();
    await expect(runResidualSourceGovernanceQueueCli([], { readJson }))
      .rejects.toThrow('--governance-ledger is required');
    await expect(runResidualSourceGovernanceQueueCli([
      '--governance-ledger=ledger.json', '--high-volume-review=review.json',
      '--output=queue.json', '--approve',
    ], { readJson })).rejects.toThrow('proposal-only');
    expect(readJson).not.toHaveBeenCalled();
  });

  it('writes one sealed queue without external or governance operations', async () => {
    const readJson = vi.fn(async (path: string) => path.includes('ledger') ? residualQueueLedger : residualQueueReview);
    const writeReceipt = vi.fn(async () => '/tmp/residual-queue.json');
    const result = await runResidualSourceGovernanceQueueCli([
      '--governance-ledger=ledger.json', '--high-volume-review=review.json', '--output=queue.json',
    ], {
      readJson,
      writeReceipt,
      now: () => new Date('2026-07-22T20:00:00.000Z'),
    });
    expect(result).toMatchObject({
      proposal_only: true,
      approval_granted: false,
      summary: { sourceCount: 6, rowCount: 56 },
      guarantees: { governanceDecisions: 0, registryMutations: 0, databaseWrites: 0 },
      output_path: '/tmp/residual-queue.json',
    });
    expect(readJson).toHaveBeenCalledTimes(2);
    expect(writeReceipt).toHaveBeenCalledOnce();
  });
});
