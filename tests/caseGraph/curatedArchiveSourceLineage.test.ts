import { describe, expect, it } from 'vitest';
import {
  CURATED_ARCHIVE_LINEAGE_ID,
  CURATED_ARCHIVE_SOURCE_LINEAGE_POLICY_VERSION,
  resolveCuratedArchiveReviewedLineage,
} from '../../src/caseGraph/curatedArchiveSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('retired curated archive lineage', () => {
  it('classifies retired showcase cards as editorial references rather than evidence', () => {
    expect(CURATED_ARCHIVE_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-curated-archive-lineage-v1');
    expect(resolveCuratedArchiveReviewedLineage('CURATED_ARCHIVE')).toMatchObject({
      lineageId: CURATED_ARCHIVE_LINEAGE_ID,
      sourcePosition: 'secondary',
      originality: 'derived',
      publicationMode: 'retired_editorial_reference',
      recordClass: 'retired_curated_reference',
      isSightingRecord: false,
      narrativeStorageAllowed: false,
      preciseCoordinatesAllowed: false,
      mediaStorageAllowed: false,
      independentCorroborationAllowed: false,
    });
    expect(resolveCuratedArchiveReviewedLineage('CURATED')).toBeNull();
    expect(resolveCaseGraphSource('retired curated reference')).toMatchObject({
      id: 'curated_archive', family: 'curated', role: 'editorial', dependencyRisk: 'high',
    });
    expect(caseGraphSourcesShareLineage('CURATED_ARCHIVE', 'CURATED')).toBe(false);
  });
});
