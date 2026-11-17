export const COBEPS_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-cobeps-source-lineage-v1' as const;
export const COBEPS_PUBLISHER = 'COBEPS' as const;
export const COBEPS_HOME_URL = 'https://www.cobeps.org/' as const;
export const COBEPS_NOTIFICATIONS_URL = 'https://www.cobeps.org/en/notifications.html' as const;
export const COBEPS_DATABASE_URL = 'https://www.cobeps.org/fr/database.html' as const;
export const COBEPS_METHODOLOGY_URL = 'https://www.cobeps.org/fr/methodologie.html' as const;
export const COBEPS_UAPCHECK_URL = 'https://www.uapcheck.org/services/tables/index.php?id=UAP-251922&type=uaps' as const;
export const COBEPS_REPORT_LINEAGE_ID = 'governance:cobeps:published-investigation-reports' as const;
export const COBEPS_SHARED_INDEX_LINEAGE_ID = 'governance:uapcheck:euro-ufo-index-2024' as const;
export const COBEPS_WEBSITE_LINEAGE_ID = 'governance:cobeps:website-publication-reference' as const;

export type CobepsReviewedLineagePolicy = {
  source: 'COBEPS' | 'COBEPS_UAPCHECK' | 'COBEPS_WEBSITE_REFERENCE';
  lineageId: typeof COBEPS_REPORT_LINEAGE_ID | typeof COBEPS_SHARED_INDEX_LINEAGE_ID | typeof COBEPS_WEBSITE_LINEAGE_ID;
  sourcePosition: 'mixed' | 'secondary';
  originality: 'original' | 'derived';
  publisher: string;
  publicationMode: 'metadata_link_only';
  recordClass: 'published_investigation' | 'shared_index_reference' | 'website_publication_reference';
  isSightingRecord: boolean;
  preciseCoordinatesAllowed: false;
  narrativeStorageAllowed: false;
  witnessIdentityStorageAllowed: false;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly string[];
};

const normalize = (value: string) => String(value || '').trim().toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');

export const resolveCobepsReviewedLineage = (sourceValue: string): CobepsReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source === 'COBEPS_UAPCHECK' || source === 'COBEPS_SHARED_INDEX') {
    return {
      source: 'COBEPS_UAPCHECK', lineageId: COBEPS_SHARED_INDEX_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', publisher: 'UAP Check Euro UFO Index',
      publicationMode: 'metadata_link_only', recordClass: 'shared_index_reference', isSightingRecord: true,
      preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false, independentCorroborationAllowed: false,
      evidenceUrls: [COBEPS_NOTIFICATIONS_URL, COBEPS_UAPCHECK_URL],
    };
  }
  if (source === 'COBEPS_WEBSITE_REFERENCE' || source === 'COBEPS_PUBLICATION_REFERENCE') {
    return {
      source: 'COBEPS_WEBSITE_REFERENCE', lineageId: COBEPS_WEBSITE_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', publisher: COBEPS_PUBLISHER,
      publicationMode: 'metadata_link_only', recordClass: 'website_publication_reference', isSightingRecord: false,
      preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false, independentCorroborationAllowed: false,
      evidenceUrls: [COBEPS_HOME_URL, COBEPS_NOTIFICATIONS_URL, COBEPS_DATABASE_URL],
    };
  }
  if (source !== 'COBEPS') return null;
  return {
    source: 'COBEPS', lineageId: COBEPS_REPORT_LINEAGE_ID,
    sourcePosition: 'mixed', originality: 'original', publisher: COBEPS_PUBLISHER,
    publicationMode: 'metadata_link_only', recordClass: 'published_investigation', isSightingRecord: true,
    preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
    mediaStorageAllowed: false, independentCorroborationAllowed: false,
    evidenceUrls: [COBEPS_HOME_URL, COBEPS_NOTIFICATIONS_URL, COBEPS_DATABASE_URL, COBEPS_METHODOLOGY_URL],
  };
};
