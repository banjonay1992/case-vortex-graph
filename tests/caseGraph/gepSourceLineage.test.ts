import { describe, expect, it } from 'vitest';
import {
  GEP_CASE_LINEAGE_ID, GEP_PUBLICATION_ARCHIVE_LINEAGE_ID, GEP_SHARED_INDEX_LINEAGE_ID,
  GEP_SOURCE_LINEAGE_POLICY_VERSION, resolveGepReviewedLineage,
} from '../../src/caseGraph/gepSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('GEP governed source lineages', () => {
  it('separates direct analysis, shared-index repetition, and publication archives', () => {
    expect(GEP_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-gep-source-lineage-v1');
    expect(resolveGepReviewedLineage('GEP')).toMatchObject({
      source: 'GEP', lineageId: GEP_CASE_LINEAGE_ID, sourcePosition: 'mixed', originality: 'original',
      recordClass: 'published_case_analysis', isSightingRecord: true,
    });
    expect(resolveGepReviewedLineage('GEP_UAPCHECK')).toMatchObject({
      source: 'GEP_UAPCHECK', lineageId: GEP_SHARED_INDEX_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', recordClass: 'shared_index_reference',
    });
    expect(resolveGepReviewedLineage('GEP_ARCHIVE_REFERENCE')).toMatchObject({
      source: 'GEP_PUBLICATION_ARCHIVE_REFERENCE', lineageId: GEP_PUBLICATION_ARCHIVE_LINEAGE_ID,
      recordClass: 'publication_archive_reference', isSightingRecord: false,
    });
  });

  it('shares only the UAPCheck variant with CISU', () => {
    expect(caseGraphSourcesShareLineage('GEP_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('GEP', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('GEP_PUBLICATION_ARCHIVE_REFERENCE', 'GEP')).toBe(false);
    expect(resolveCaseGraphSource('GEP shared index')).toMatchObject({
      id: 'gep_uapcheck', lineageId: GEP_SHARED_INDEX_LINEAGE_ID,
    });
  });
});
