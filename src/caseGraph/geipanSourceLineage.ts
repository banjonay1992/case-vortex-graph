export const GEIPAN_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-geipan-source-lineage-v1' as const;
export const GEIPAN_PUBLISHER = 'CNES GEIPAN' as const;
export const GEIPAN_LEGAL_NOTICE_URL = 'https://www.geipan.fr/en/mentions_legales' as const;
export const GEIPAN_CSV_PUBLICATION_URL = 'https://www.geipan.fr/fr/node/15' as const;
export const GEIPAN_CLASSIFICATION_URL = 'https://www.geipan.fr/en/node/58787' as const;
export const GEIPAN_CASES_CSV_URL = 'https://www.cnes-geipan.fr/sites/default/files/Base_de_donn%C3%A9es_des_cas.csv' as const;

export type GeipanReviewedLineagePolicy = {
  source: 'GEIPAN';
  lineageId: 'governance:cnes-geipan:official-case-catalogue';
  sourcePosition: 'mixed';
  originality: 'original';
  publisher: typeof GEIPAN_PUBLISHER;
  publicationMode: 'metadata_link_only';
  officialInvestigationAndClassification: true;
  underlyingWitnessClaimsMixed: true;
  classificationIsIdentificationOutcomeNotTruthScore: true;
  rawCatalogueStorageAllowed: false;
  narrativeSummaryStorageAllowed: false;
  witnessMediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly [
    typeof GEIPAN_LEGAL_NOTICE_URL,
    typeof GEIPAN_CSV_PUBLICATION_URL,
    typeof GEIPAN_CLASSIFICATION_URL,
  ];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveGeipanReviewedLineage = (
  sourceValue: string,
): GeipanReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source !== 'GEIPAN' && source !== 'FR_GEIPAN') return null;
  return {
    source: 'GEIPAN',
    lineageId: 'governance:cnes-geipan:official-case-catalogue',
    sourcePosition: 'mixed',
    originality: 'original',
    publisher: GEIPAN_PUBLISHER,
    publicationMode: 'metadata_link_only',
    officialInvestigationAndClassification: true,
    underlyingWitnessClaimsMixed: true,
    classificationIsIdentificationOutcomeNotTruthScore: true,
    rawCatalogueStorageAllowed: false,
    narrativeSummaryStorageAllowed: false,
    witnessMediaStorageAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [GEIPAN_LEGAL_NOTICE_URL, GEIPAN_CSV_PUBLICATION_URL, GEIPAN_CLASSIFICATION_URL],
  };
};
