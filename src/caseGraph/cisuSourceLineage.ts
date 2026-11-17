export const CISU_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-cisu-uapcheck-lineage-v1' as const;
export const CISU_PUBLISHER = 'Centro Italiano Studi Ufologici' as const;
export const CISU_CATALOGUE_URL = 'https://www.cisu.org/cisucat2/' as const;
export const EURO_UFO_INDEX_URL = 'https://www.uapcheck.org/services/tables/index.php?id=UAP-251922&type=uaps' as const;

export type CisuReviewedLineagePolicy = {
  source: 'CISU';
  lineageId: 'governance:uapcheck:euro-ufo-index-2024';
  sourcePosition: 'secondary';
  originality: 'derived';
  publisher: typeof CISU_PUBLISHER;
  publicationMode: 'metadata_link_only';
  storedLegacyRowsAreSharedIndex: true;
  componentOrganisationRequired: true;
  componentOrganisationIsIndependentSource: false;
  rawIndexStorageAllowed: false;
  normalizedIndexStorageAllowed: false;
  narrativeStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly [typeof CISU_CATALOGUE_URL, typeof EURO_UFO_INDEX_URL];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveCisuReviewedLineage = (sourceValue: string): CisuReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'CISU') return null;
  return {
    source: 'CISU',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    sourcePosition: 'secondary',
    originality: 'derived',
    publisher: CISU_PUBLISHER,
    publicationMode: 'metadata_link_only',
    storedLegacyRowsAreSharedIndex: true,
    componentOrganisationRequired: true,
    componentOrganisationIsIndependentSource: false,
    rawIndexStorageAllowed: false,
    normalizedIndexStorageAllowed: false,
    narrativeStorageAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [CISU_CATALOGUE_URL, EURO_UFO_INDEX_URL],
  };
};
