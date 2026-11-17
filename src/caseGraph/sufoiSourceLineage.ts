export const SUFOI_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-sufoi-source-lineage-v1' as const;
export const SUFOI_PUBLISHER = 'Skandinavisk UFO Information' as const;
export const SUFOI_OBSERVATIONS_URL = 'https://sufoi.dk/obs/' as const;
export const SUFOI_REPORT_FORM_URL = 'https://sufoi.dk/obs-skema/' as const;
export const SUFOI_ABOUT_URL = 'https://sufoi.dk/om-sufoi/' as const;
export const SUFOI_HOME_URL = 'https://sufoi.dk/forside/' as const;
export const SUFOI_UAPCHECK_URL = 'https://www.uapcheck.org/services/tables/index.php?id=UAP-251922&type=uaps' as const;
export const SUFOI_SHARED_INDEX_LINEAGE_ID = 'governance:uapcheck:euro-ufo-index-2024' as const;
export const SUFOI_CATALOGUE_LINEAGE_ID = 'governance:sufoi:published-observation-catalogue' as const;
export const SUFOI_EDITORIAL_LINEAGE_ID = 'governance:sufoi:editorial-website' as const;

export type SufoiReviewedLineagePolicy = {
  source: 'SUFOI' | 'SUFOI_UAPCHECK' | 'SUFOI_EDITORIAL_REFERENCE';
  lineageId: typeof SUFOI_CATALOGUE_LINEAGE_ID | typeof SUFOI_SHARED_INDEX_LINEAGE_ID | typeof SUFOI_EDITORIAL_LINEAGE_ID;
  sourcePosition: 'mixed' | 'secondary';
  originality: 'original' | 'derived';
  publisher: string;
  publicationMode: 'metadata_link_only';
  recordClass: 'published_observation' | 'shared_index_reference' | 'editorial_reference';
  publicEventAndGeneralLocationAllowed: boolean;
  preciseCoordinatesAllowed: false;
  narrativeStorageAllowed: false;
  witnessIdentityStorageAllowed: false;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly string[];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveSufoiReviewedLineage = (sourceValue: string): SufoiReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source === 'SUFOI_UAPCHECK' || source === 'SUFOI_SHARED_INDEX') {
    return {
      source: 'SUFOI_UAPCHECK',
      lineageId: SUFOI_SHARED_INDEX_LINEAGE_ID,
      sourcePosition: 'secondary',
      originality: 'derived',
      publisher: 'UAP Check Euro UFO Index',
      publicationMode: 'metadata_link_only',
      recordClass: 'shared_index_reference',
      publicEventAndGeneralLocationAllowed: true,
      preciseCoordinatesAllowed: false,
      narrativeStorageAllowed: false,
      witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [SUFOI_OBSERVATIONS_URL, SUFOI_UAPCHECK_URL],
    };
  }
  if (source === 'SUFOI_EDITORIAL_REFERENCE' || source === 'SUFOI_EDITORIAL') {
    return {
      source: 'SUFOI_EDITORIAL_REFERENCE',
      lineageId: SUFOI_EDITORIAL_LINEAGE_ID,
      sourcePosition: 'secondary',
      originality: 'derived',
      publisher: SUFOI_PUBLISHER,
      publicationMode: 'metadata_link_only',
      recordClass: 'editorial_reference',
      publicEventAndGeneralLocationAllowed: false,
      preciseCoordinatesAllowed: false,
      narrativeStorageAllowed: false,
      witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [SUFOI_HOME_URL, SUFOI_ABOUT_URL],
    };
  }
  if (source !== 'SUFOI' && source !== 'SKANDINAVISK_UFO_INFORMATION') return null;
  return {
    source: 'SUFOI',
    lineageId: SUFOI_CATALOGUE_LINEAGE_ID,
    sourcePosition: 'mixed',
    originality: 'original',
    publisher: SUFOI_PUBLISHER,
    publicationMode: 'metadata_link_only',
    recordClass: 'published_observation',
    publicEventAndGeneralLocationAllowed: true,
    preciseCoordinatesAllowed: false,
    narrativeStorageAllowed: false,
    witnessIdentityStorageAllowed: false,
    mediaStorageAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [SUFOI_OBSERVATIONS_URL, SUFOI_REPORT_FORM_URL, SUFOI_HOME_URL, SUFOI_ABOUT_URL],
  };
};
