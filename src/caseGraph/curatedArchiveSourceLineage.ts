export const CURATED_ARCHIVE_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-curated-archive-lineage-v1' as const;
export const CURATED_ARCHIVE_LINEAGE_ID = 'governance:uapfiles:retired-curated-reference' as const;

export type CuratedArchiveReviewedLineagePolicy = {
  source: 'CURATED_ARCHIVE';
  lineageId: typeof CURATED_ARCHIVE_LINEAGE_ID;
  sourcePosition: 'secondary';
  originality: 'derived';
  publisher: 'UAPFiles';
  publicationMode: 'retired_editorial_reference';
  recordClass: 'retired_curated_reference';
  isSightingRecord: false;
  narrativeStorageAllowed: false;
  preciseCoordinatesAllowed: false;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
};

const normalize = (value: string) => String(value || '').trim().toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');

export const resolveCuratedArchiveReviewedLineage = (sourceValue: string): CuratedArchiveReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'CURATED_ARCHIVE') return null;
  return {
    source: 'CURATED_ARCHIVE', lineageId: CURATED_ARCHIVE_LINEAGE_ID,
    sourcePosition: 'secondary', originality: 'derived', publisher: 'UAPFiles',
    publicationMode: 'retired_editorial_reference', recordClass: 'retired_curated_reference',
    isSightingRecord: false, narrativeStorageAllowed: false, preciseCoordinatesAllowed: false,
    mediaStorageAllowed: false, independentCorroborationAllowed: false,
  };
};
