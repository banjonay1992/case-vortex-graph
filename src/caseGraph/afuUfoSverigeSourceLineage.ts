export const AFU_UFO_SVERIGE_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-afu-ufo-sverige-uapcheck-lineage-v1' as const;
export const AFU_PUBLISHER = 'Archives for the Unexplained' as const;
export const UFO_SVERIGE_PUBLISHER = 'Riksorganisationen UFO-Sverige' as const;
export const UAPCHECK_EURO_UFO_INDEX_PUBLISHER = 'UAP Check Euro UFO Index' as const;
export const AFU_ROOT_URL = 'https://www.afu.se/' as const;
export const AFU_BYLAWS_URL = 'https://www.afu.se/about-afu/by-laws/' as const;
export const AFU_REPORT_FILES_URL = 'https://www.afu.se/collections/report-files/' as const;
export const UFO_SVERIGE_ABOUT_URL = 'https://www.ufo.se/index.php/9-om-ufo-sverige' as const;
export const UFO_SVERIGE_TERMS_URL = 'https://www.ufo.se/index.php/om-ufo-sverige/om-ufo-sverige/villkor' as const;
export const UFO_SVERIGE_PRIVACY_URL = 'https://www.ufo.se/index.php/om-ufo-sverige/gdpr' as const;
export const AFU_UFO_SVERIGE_EURO_UFO_INDEX_URL = 'https://www.uapcheck.org/services/tables/index.php?id=UAP-251922&type=uaps' as const;

export type AfuUfoSverigeReviewedLineagePolicy = {
  source: 'AFU_UFO_SVERIGE';
  lineageId: 'governance:uapcheck:euro-ufo-index-2024';
  sourcePosition: 'secondary';
  originality: 'derived';
  publisher: typeof UAPCHECK_EURO_UFO_INDEX_PUBLISHER;
  componentOrganisation: typeof UFO_SVERIGE_PUBLISHER;
  archiveCustodian: typeof AFU_PUBLISHER;
  publicationMode: 'metadata_link_only';
  storedLegacyRowsAreSharedIndex: true;
  legacyLabelCombinesDistinctOrganisations: true;
  afuArchiveIsNotTheStoredRowOrigin: true;
  componentOrganisationRequired: true;
  componentOrganisationIsIndependentSource: false;
  publicIndexEventAndGeneralLocationAllowed: true;
  preciseCoordinatesAllowed: false;
  narrativeStorageAllowed: false;
  witnessIdentityStorageAllowed: false;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly [
    typeof AFU_ROOT_URL,
    typeof AFU_BYLAWS_URL,
    typeof AFU_REPORT_FILES_URL,
    typeof UFO_SVERIGE_ABOUT_URL,
    typeof UFO_SVERIGE_TERMS_URL,
    typeof UFO_SVERIGE_PRIVACY_URL,
    typeof AFU_UFO_SVERIGE_EURO_UFO_INDEX_URL,
  ];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveAfuUfoSverigeReviewedLineage = (
  sourceValue: string,
): AfuUfoSverigeReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source !== 'AFU_UFO_SVERIGE' && source !== 'AFU' && source !== 'UFO_SVERIGE') return null;
  return {
    source: 'AFU_UFO_SVERIGE',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    sourcePosition: 'secondary',
    originality: 'derived',
    publisher: UAPCHECK_EURO_UFO_INDEX_PUBLISHER,
    componentOrganisation: UFO_SVERIGE_PUBLISHER,
    archiveCustodian: AFU_PUBLISHER,
    publicationMode: 'metadata_link_only',
    storedLegacyRowsAreSharedIndex: true,
    legacyLabelCombinesDistinctOrganisations: true,
    afuArchiveIsNotTheStoredRowOrigin: true,
    componentOrganisationRequired: true,
    componentOrganisationIsIndependentSource: false,
    publicIndexEventAndGeneralLocationAllowed: true,
    preciseCoordinatesAllowed: false,
    narrativeStorageAllowed: false,
    witnessIdentityStorageAllowed: false,
    mediaStorageAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [
      AFU_ROOT_URL,
      AFU_BYLAWS_URL,
      AFU_REPORT_FILES_URL,
      UFO_SVERIGE_ABOUT_URL,
      UFO_SVERIGE_TERMS_URL,
      UFO_SVERIGE_PRIVACY_URL,
      AFU_UFO_SVERIGE_EURO_UFO_INDEX_URL,
    ],
  };
};
