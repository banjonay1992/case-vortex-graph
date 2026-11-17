export const GEP_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-gep-source-lineage-v1' as const;
export const GEP_PUBLISHER = 'Gesellschaft zur Erforschung des UFO-Phänomens e.V.' as const;
export const GEP_HOME_URL = 'https://www.uap-research.org/' as const;
export const GEP_ABOUT_URL = 'https://www.uap-research.org/ueber-die-gep/' as const;
export const GEP_RESEARCH_PRINCIPLES_URL = 'https://www.uap-research.org/grundsaetze-guter-wissenschaftliche-praxis/' as const;
export const GEP_DOWNLOADS_URL = 'https://www.uap-research.org/downloads/' as const;
export const GEP_JUFOF_URL = 'https://www.uap-research.org/jufof/' as const;
export const GEP_AFU_JUFOF_ARCHIVE_URL = 'https://files.afu.se/Downloads/?dir=Magazines%2FGermany%2FJUFOF%20%28GEP%29' as const;
export const GEP_UAPCHECK_URL = 'https://www.uapcheck.org/services/tables/index.php?id=UAP-251922&type=uaps' as const;
export const GEP_CASE_LINEAGE_ID = 'governance:gep:published-case-analysis' as const;
export const GEP_SHARED_INDEX_LINEAGE_ID = 'governance:uapcheck:euro-ufo-index-2024' as const;
export const GEP_PUBLICATION_ARCHIVE_LINEAGE_ID = 'governance:afu:gep-jufof-publication-archive' as const;

export type GepReviewedLineagePolicy = {
  source: 'GEP' | 'GEP_UAPCHECK' | 'GEP_PUBLICATION_ARCHIVE_REFERENCE';
  lineageId: typeof GEP_CASE_LINEAGE_ID | typeof GEP_SHARED_INDEX_LINEAGE_ID | typeof GEP_PUBLICATION_ARCHIVE_LINEAGE_ID;
  sourcePosition: 'mixed' | 'secondary';
  originality: 'original' | 'derived';
  publisher: string;
  publicationMode: 'metadata_link_only';
  recordClass: 'published_case_analysis' | 'shared_index_reference' | 'publication_archive_reference';
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

export const resolveGepReviewedLineage = (sourceValue: string): GepReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source === 'GEP_UAPCHECK' || source === 'GEP_SHARED_INDEX') {
    return {
      source: 'GEP_UAPCHECK', lineageId: GEP_SHARED_INDEX_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', publisher: 'UAP Check Euro UFO Index',
      publicationMode: 'metadata_link_only', recordClass: 'shared_index_reference', isSightingRecord: true,
      preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false, independentCorroborationAllowed: false,
      evidenceUrls: [GEP_HOME_URL, GEP_UAPCHECK_URL],
    };
  }
  if (source === 'GEP_PUBLICATION_ARCHIVE_REFERENCE' || source === 'GEP_ARCHIVE_REFERENCE') {
    return {
      source: 'GEP_PUBLICATION_ARCHIVE_REFERENCE', lineageId: GEP_PUBLICATION_ARCHIVE_LINEAGE_ID,
      sourcePosition: 'secondary', originality: 'derived', publisher: 'Archives for the Unexplained',
      publicationMode: 'metadata_link_only', recordClass: 'publication_archive_reference', isSightingRecord: false,
      preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false, independentCorroborationAllowed: false,
      evidenceUrls: [GEP_JUFOF_URL, GEP_AFU_JUFOF_ARCHIVE_URL],
    };
  }
  if (source !== 'GEP' && source !== 'GESELLSCHAFT_ZUR_ERFORSCHUNG_DES_UFO_PHANOMENS') return null;
  return {
    source: 'GEP', lineageId: GEP_CASE_LINEAGE_ID,
    sourcePosition: 'mixed', originality: 'original', publisher: GEP_PUBLISHER,
    publicationMode: 'metadata_link_only', recordClass: 'published_case_analysis', isSightingRecord: true,
    preciseCoordinatesAllowed: false, narrativeStorageAllowed: false, witnessIdentityStorageAllowed: false,
    mediaStorageAllowed: false, independentCorroborationAllowed: false,
    evidenceUrls: [GEP_HOME_URL, GEP_ABOUT_URL, GEP_RESEARCH_PRINCIPLES_URL, GEP_DOWNLOADS_URL],
  };
};
