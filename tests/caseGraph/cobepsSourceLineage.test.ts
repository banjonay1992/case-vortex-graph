import { describe, expect, it } from 'vitest';
import {
  COBEPS_REPORT_LINEAGE_ID, COBEPS_SHARED_INDEX_LINEAGE_ID,
  COBEPS_SOURCE_LINEAGE_POLICY_VERSION, COBEPS_WEBSITE_LINEAGE_ID,
  resolveCobepsReviewedLineage,
} from '../../src/caseGraph/cobepsSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('COBEPS governed source lineages', () => {
  it('separates investigations, shared-index repetition and publication references', () => {
    expect(COBEPS_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-cobeps-source-lineage-v1');
    expect(resolveCobepsReviewedLineage('COBEPS')).toMatchObject({
      lineageId: COBEPS_REPORT_LINEAGE_ID, sourcePosition: 'mixed', originality: 'original',
      recordClass: 'published_investigation', isSightingRecord: true,
    });
    expect(resolveCobepsReviewedLineage('COBEPS_UAPCHECK')).toMatchObject({
      lineageId: COBEPS_SHARED_INDEX_LINEAGE_ID, sourcePosition: 'secondary', originality: 'derived',
      recordClass: 'shared_index_reference',
    });
    expect(resolveCobepsReviewedLineage('COBEPS_WEBSITE_REFERENCE')).toMatchObject({
      lineageId: COBEPS_WEBSITE_LINEAGE_ID, recordClass: 'website_publication_reference', isSightingRecord: false,
    });
  });

  it('shares only the UAPCheck variant with CISU', () => {
    expect(caseGraphSourcesShareLineage('COBEPS_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('COBEPS', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('COBEPS_WEBSITE_REFERENCE', 'COBEPS')).toBe(false);
    expect(resolveCaseGraphSource('COBEPS shared index')).toMatchObject({
      id: 'cobeps_uapcheck', lineageId: COBEPS_SHARED_INDEX_LINEAGE_ID,
    });
  });
});
