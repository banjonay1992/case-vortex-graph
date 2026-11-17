import { describe, expect, it } from 'vitest';

import {
  SUFOI_CATALOGUE_LINEAGE_ID,
  SUFOI_EDITORIAL_LINEAGE_ID,
  SUFOI_SHARED_INDEX_LINEAGE_ID,
  SUFOI_SOURCE_LINEAGE_POLICY_VERSION,
  resolveSufoiReviewedLineage,
} from '../../src/caseGraph/sufoiSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('SUFOI governed source lineages', () => {
  it('separates direct catalogue, shared index, and editorial records', () => {
    expect(SUFOI_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-sufoi-source-lineage-v1');
    expect(resolveSufoiReviewedLineage('SUFOI')).toMatchObject({
      source: 'SUFOI', lineageId: SUFOI_CATALOGUE_LINEAGE_ID,
      sourcePosition: 'mixed', originality: 'original', recordClass: 'published_observation',
      independentCorroborationAllowed: false,
    });
    expect(resolveSufoiReviewedLineage('SUFOI_UAPCHECK')).toMatchObject({
      source: 'SUFOI_UAPCHECK', lineageId: SUFOI_SHARED_INDEX_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', recordClass: 'shared_index_reference',
    });
    expect(resolveSufoiReviewedLineage('SUFOI_EDITORIAL')).toMatchObject({
      source: 'SUFOI_EDITORIAL_REFERENCE', lineageId: SUFOI_EDITORIAL_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', recordClass: 'editorial_reference',
      publicEventAndGeneralLocationAllowed: false,
    });
  });

  it('counts UAPCheck/CISU repetition as shared lineage without merging direct or editorial material', () => {
    expect(caseGraphSourcesShareLineage('SUFOI_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('SUFOI', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('SUFOI_EDITORIAL_REFERENCE', 'SUFOI')).toBe(false);
    expect(resolveCaseGraphSource('SUFOI shared index')).toMatchObject({
      id: 'sufoi_uapcheck', role: 'aggregator', lineageId: SUFOI_SHARED_INDEX_LINEAGE_ID,
    });
    expect(resolveCaseGraphSource('SUFOI editorial')).toMatchObject({
      id: 'sufoi_editorial_reference', role: 'editorial', lineageId: SUFOI_EDITORIAL_LINEAGE_ID,
    });
  });
});
