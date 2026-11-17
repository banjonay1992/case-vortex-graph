import { describe, expect, it } from 'vitest';
import {
  BE_UFOM_REPORT_LINEAGE_ID, BE_UFOM_SHARED_INDEX_LINEAGE_ID,
  BE_UFOM_SOURCE_LINEAGE_POLICY_VERSION, BE_UFOM_WEBSITE_LINEAGE_ID,
  resolveBeUfomReviewedLineage,
} from '../../src/caseGraph/beUfomSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('BE-UFOM governed source lineages', () => {
  it('separates direct reports, shared-index repetition and website references', () => {
    expect(BE_UFOM_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-be-ufom-source-lineage-v1');
    expect(resolveBeUfomReviewedLineage('BE_UFOM')).toMatchObject({
      lineageId: BE_UFOM_REPORT_LINEAGE_ID, sourcePosition: 'mixed', originality: 'original',
      recordClass: 'published_report', isSightingRecord: true,
    });
    expect(resolveBeUfomReviewedLineage('BE_UFOM_UAPCHECK')).toMatchObject({
      lineageId: BE_UFOM_SHARED_INDEX_LINEAGE_ID, sourcePosition: 'secondary', originality: 'derived',
      recordClass: 'shared_index_reference',
    });
    expect(resolveBeUfomReviewedLineage('BE_UFOM_WEBSITE_REFERENCE')).toMatchObject({
      lineageId: BE_UFOM_WEBSITE_LINEAGE_ID, recordClass: 'website_reference', isSightingRecord: false,
    });
  });

  it('shares only the UAPCheck variant with CISU', () => {
    expect(caseGraphSourcesShareLineage('BE_UFOM_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('BE_UFOM', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('BE_UFOM_WEBSITE_REFERENCE', 'BE_UFOM')).toBe(false);
    expect(resolveCaseGraphSource('BE UFOM shared index')).toMatchObject({
      id: 'be_ufom_uapcheck', lineageId: BE_UFOM_SHARED_INDEX_LINEAGE_ID,
    });
  });
});
