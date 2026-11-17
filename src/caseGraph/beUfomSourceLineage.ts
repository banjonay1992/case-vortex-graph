export const BE_UFOM_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-be-ufom-source-lineage-v1' as const;
export const BE_UFOM_PUBLISHER = 'Belgisch UFO-meldpunt' as const;
export const BE_UFOM_HOME_URL = 'https://www.ufomeldpunt.be/' as const;
export const BE_UFOM_RECENT_REPORTS_URL = 'https://www.ufomeldpunt.be/recent/' as const;
export const BE_UFOM_CONTACT_RIGHTS_URL = 'https://www.ufomeldpunt.be/contact/' as const;
export const BE_UFOM_REPORT_FORM_URL = 'https://www.ufomeldpunt.be/ufo-melden/' as const;
export const BE_UFOM_UAPCHECK_URL = 'https://www.uapcheck.org/services/tables/index.php?id=UAP-251922&type=uaps' as const;
export const BE_UFOM_REPORT_LINEAGE_ID = 'governance:be-ufom:published-report-catalogue' as const;
export const BE_UFOM_SHARED_INDEX_LINEAGE_ID = 'governance:uapcheck:euro-ufo-index-2024' as const;
export const BE_UFOM_WEBSITE_LINEAGE_ID = 'governance:be-ufom:website-reference' as const;

export type BeUfomReviewedLineagePolicy = {
  source: 'BE_UFOM' | 'BE_UFOM_UAPCHECK' | 'BE_UFOM_WEBSITE_REFERENCE';
  lineageId: typeof BE_UFOM_REPORT_LINEAGE_ID | typeof BE_UFOM_SHARED_INDEX_LINEAGE_ID | typeof BE_UFOM_WEBSITE_LINEAGE_ID;
  sourcePosition: 'mixed' | 'secondary';
  originality: 'original' | 'derived';
  publisher: string;
  publicationMode: 'metadata_link_only';
  recordClass: 'published_report' | 'shared_index_reference' | 'website_reference';
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

export const resolveBeUfomReviewedLineage = (sourceValue: string): BeUfomReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source === 'BE_UFOM_UAPCHECK' || source === 'BE_UFOM_SHARED_INDEX') {
    return {
      source: 'BE_UFOM_UAPCHECK', lineageId: BE_UFOM_SHARED_INDEX_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', publisher: 'UAP Check Euro UFO Index',
      publicationMode: 'metadata_link_only', recordClass: 'shared_index_reference', isSightingRecord: true,
      preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false, independentCorroborationAllowed: false,
      evidenceUrls: [BE_UFOM_HOME_URL, BE_UFOM_UAPCHECK_URL],
    };
  }
  if (source === 'BE_UFOM_WEBSITE_REFERENCE' || source === 'BE_UFOM_EDITORIAL_REFERENCE') {
    return {
      source: 'BE_UFOM_WEBSITE_REFERENCE', lineageId: BE_UFOM_WEBSITE_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', publisher: BE_UFOM_PUBLISHER,
      publicationMode: 'metadata_link_only', recordClass: 'website_reference', isSightingRecord: false,
      preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false, independentCorroborationAllowed: false,
      evidenceUrls: [BE_UFOM_HOME_URL, BE_UFOM_CONTACT_RIGHTS_URL],
    };
  }
  if (source !== 'BE_UFOM' && source !== 'BE_UFOMELDPUNT' && source !== 'BELGISCH_UFO_MELDPUNT') return null;
  return {
    source: 'BE_UFOM', lineageId: BE_UFOM_REPORT_LINEAGE_ID,
    sourcePosition: 'mixed', originality: 'original', publisher: BE_UFOM_PUBLISHER,
    publicationMode: 'metadata_link_only', recordClass: 'published_report', isSightingRecord: true,
    preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
    mediaStorageAllowed: false, independentCorroborationAllowed: false,
    evidenceUrls: [BE_UFOM_HOME_URL, BE_UFOM_RECENT_REPORTS_URL, BE_UFOM_CONTACT_RIGHTS_URL, BE_UFOM_REPORT_FORM_URL],
  };
};
