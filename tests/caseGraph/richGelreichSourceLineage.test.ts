import { describe, expect, it } from 'vitest';

import {
  RICH_GELREICH_SOURCE_LINEAGE_POLICY_VERSION,
  RICH_GELREICH_UPSTREAM_REVISION,
  resolveRichGelreichReviewedLineage,
} from '../../src/caseGraph/richGelreichSourceLineage';

describe('Rich Gelreich reviewed source lineage', () => {
  it('binds every reviewed label to the pinned upstream revision without granting independence', () => {
    expect(RICH_GELREICH_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-rich-gelreich-source-lineage-v1');
    expect(RICH_GELREICH_UPSTREAM_REVISION).toHaveLength(40);
    expect(resolveRichGelreichReviewedLineage(' rich_gelreich_hatch_udb ')).toMatchObject({
      lineageId: 'governance:rich-gelreich:hatch-udb',
      sourcePosition: 'secondary',
      originality: 'derived',
      independentCorroborationAllowed: false,
      upstreamRevision: RICH_GELREICH_UPSTREAM_REVISION,
    });
  });

  it('keeps distinct upstream components separate but joins an AI transform to its input family', () => {
    expect(resolveRichGelreichReviewedLineage('RICH_GELREICH_EBERHART')?.lineageId)
      .toBe(resolveRichGelreichReviewedLineage('RICH_GELREICH_EBERHART_OPENAI')?.lineageId);
    expect(resolveRichGelreichReviewedLineage('RICH_GELREICH_HATCH_UDB')?.lineageId)
      .not.toBe(resolveRichGelreichReviewedLineage('RICH_GELREICH_EBERHART')?.lineageId);
    expect(resolveRichGelreichReviewedLineage('RICH_GELREICH_OPENAI_RESULTS')?.lineageId)
      .toBe('governance:rich-gelreich:mixed-openai-results');
    expect(resolveRichGelreichReviewedLineage('Eberhart Timeline')?.lineageId)
      .toBe(resolveRichGelreichReviewedLineage('RICH_GELREICH_EBERHART')?.lineageId);
    expect(resolveRichGelreichReviewedLineage('RR0 (GNU FDL)')?.lineageId)
      .toBe(resolveRichGelreichReviewedLineage('RICH_GELREICH_RR0')?.lineageId);
  });

  it('does not infer a reviewed lineage beyond the five row-identity-proven direct pairs', () => {
    expect(resolveRichGelreichReviewedLineage('JOHNSON TIMELINE')).toBeNull();
    expect(resolveRichGelreichReviewedLineage('unreviewed')).toBeNull();
  });
});
