import { describe, expect, it } from 'vitest';

import {
  buildResidualSourceGovernanceQueue,
  verifyResidualSourceGovernanceQueue,
} from '../../src/caseGraph/residualSourceGovernanceQueue';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { residualQueueLedger, residualQueueReview } from './residualSourceGovernanceQueueTestSupport';

describe('residual source governance queue', () => {
  it('accounts every excluded row not covered by the bound high-volume review', () => {
    const queue = buildResidualSourceGovernanceQueue(residualQueueLedger, residualQueueReview, {
      builtAt: '2026-07-22T20:00:00.000000Z',
    });
    expect(queue.summary).toEqual({
      sourceCount: 6,
      rowCount: 56,
      prioritySourceCounts: {
        'critical-lineage-review': 5, 'high-provenance-review': 0, 'standard-policy-review': 1,
      },
      priorityRowCounts: {
        'critical-lineage-review': 47, 'high-provenance-review': 0, 'standard-policy-review': 9,
      },
      missingEvidenceUrlSourceCount: 4,
      missingEvidenceUrlRowCount: 40,
      exactCountPeerSourceCount: 2,
      exactCountPeerRowCount: 22,
      fullIngestReviewSourceCount: 1,
      fullIngestReviewRowCount: 7,
    });
    expect(queue.items.map(({ source: name }) => name)).toEqual([
      'RICH_GELREICH_OPENAI_RESULTS', 'EBERHART TIMELINE', 'RICH_GELREICH_EBERHART',
      'CISU', 'ANONYMOUS PDF (PUBLIC DOMAIN)', 'SKYWATCH',
    ]);
    expect(verifyResidualSourceGovernanceQueue(queue, residualQueueLedger, residualQueueReview)).toEqual(queue);
  });

  it('labels exact-count peers as review leads rather than duplicate findings', () => {
    const queue = buildResidualSourceGovernanceQueue(residualQueueLedger, residualQueueReview, {
      builtAt: '2026-07-22T20:00:00.000000Z',
    });
    const eberhart = queue.items.find(({ source: name }) => name === 'EBERHART TIMELINE');
    expect(eberhart).toMatchObject({
      exactRowCountPeers: ['RICH_GELREICH_EBERHART'],
      riskFlags: expect.arrayContaining(['exact-count-peer-needs-overlap-analysis']),
      requiredEvidence: expect.arrayContaining(['row-level-overlap-receipt']),
    });
    expect(queue.items.find(({ source: name }) => name === 'RICH_GELREICH_OPENAI_RESULTS')).toMatchObject({
      riskFlags: expect.arrayContaining(['ai-derived-label', 'probable-secondary-compilation']),
      requiredEvidence: expect.arrayContaining(['model-input-output-lineage']),
    });
    expect(queue.items.find(({ source: name }) => name === 'ANONYMOUS PDF (PUBLIC DOMAIN)')).toMatchObject({
      riskFlags: expect.arrayContaining(['asserted-rights-label-needs-primary-proof']),
      requiredEvidence: expect.arrayContaining(['rights-claim-primary-document']),
    });
  });

  it('rejects re-sealed priority, flag, accounting, or source removal tampering', () => {
    const queue = buildResidualSourceGovernanceQueue(residualQueueLedger, residualQueueReview, {
      builtAt: '2026-07-22T20:00:00.000000Z',
    });
    const reseal = (overrides: Record<string, unknown>) => {
      const { receiptSha256: _digest, ...body } = { ...queue, ...overrides };
      return { ...body, receiptSha256: relationshipInputSha256(body) };
    };
    expect(() => verifyResidualSourceGovernanceQueue(reseal({
      items: queue.items.map((item) => item.source === 'SKYWATCH'
        ? { ...item, priority: 'standard-policy-review', riskFlags: [] }
        : item).slice(1),
    }), residualQueueLedger, residualQueueReview)).toThrow('residual_source_queue_integrity_failed');
    expect(() => verifyResidualSourceGovernanceQueue(reseal({
      summary: { ...queue.summary, rowCount: 999 },
    }), residualQueueLedger, residualQueueReview)).toThrow('residual_source_queue_integrity_failed');
  });
});
