import { describe, expect, it } from 'vitest';

import {
  SKYWATCH_EVIDENCE_URLS,
  SKYWATCH_SOURCE_LINEAGE_POLICY_VERSION,
  SKYWATCH_UPSTREAM_REVISION,
  resolveSkywatchReviewedLineage,
} from '../../src/caseGraph/skywatchSourceLineage';

describe('SKYWATCH reviewed source lineage', () => {
  it('classifies the collection as a pinned mixed secondary aggregator', () => {
    expect(SKYWATCH_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-skywatch-source-lineage-v1');
    expect(SKYWATCH_UPSTREAM_REVISION).toHaveLength(40);
    expect(SKYWATCH_EVIDENCE_URLS).toHaveLength(4);
    expect(resolveSkywatchReviewedLineage(' skywatch ')).toEqual({
      source: 'SKYWATCH',
      lineageId: 'governance:skywatch:mixed-aggregator',
      sourcePosition: 'secondary',
      originality: 'derived',
      upstreamRepository: 'https://github.com/MiChaelinzo/SKYWATCH_UAP_SIGTHINGS',
      upstreamRevision: SKYWATCH_UPSTREAM_REVISION,
      recordLevelUpstreamResolved: false,
      independentCorroborationAllowed: false,
      knownExactIdentityOverlap: {
        source: 'RICH_GELREICH_HATCH_UDB',
        rows: 1_000,
      },
      evidenceUrls: SKYWATCH_EVIDENCE_URLS,
    });
  });

  it('does not classify unrelated labels or flatten the mixed feed into Hatch', () => {
    expect(resolveSkywatchReviewedLineage('RICH_GELREICH_HATCH_UDB')).toBeNull();
    expect(resolveSkywatchReviewedLineage('unreviewed')).toBeNull();
  });
});
