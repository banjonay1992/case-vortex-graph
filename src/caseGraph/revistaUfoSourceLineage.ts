export const REVISTA_UFO_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-revista-ufo-editorial-lineage-v1' as const;
export const REVISTA_UFO_PUBLISHER = 'Revista UFO' as const;
export const REVISTA_UFO_CATEGORY_URL = 'https://ufo.com.br/category/avistamentos/' as const;
export const REVISTA_UFO_ABOUT_URL = 'https://ufo.com.br/sobre-a-revista-ufo/' as const;
export const REVISTA_UFO_TERMS_URL = 'https://ufo.com.br/termos-e-condicoes-de-uso-portal-da-revista-ufo/' as const;
export const REVISTA_UFO_PRIVACY_URL = 'https://ufo.com.br/politica-de-privacidade-e-seguranca/' as const;

export type RevistaUfoReviewedLineagePolicy = {
  source: 'REVISTA_UFO';
  lineageId: 'governance:revista-ufo:editorial-avistamentos-category';
  sourcePosition: 'secondary';
  originality: 'derived';
  publisher: typeof REVISTA_UFO_PUBLISHER;
  publicationMode: 'metadata_link_only';
  editorialArticleIsIndependentWitnessSource: false;
  articleContentStorageAllowed: false;
  embeddedMediaStorageAllowed: false;
  inferredEventFieldsAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly [
    typeof REVISTA_UFO_CATEGORY_URL,
    typeof REVISTA_UFO_ABOUT_URL,
    typeof REVISTA_UFO_TERMS_URL,
    typeof REVISTA_UFO_PRIVACY_URL,
  ];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveRevistaUfoReviewedLineage = (
  sourceValue: string,
): RevistaUfoReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source !== 'REVISTA_UFO' && source !== 'UFO_MAGAZINE_BRAZIL') return null;
  return {
    source: 'REVISTA_UFO',
    lineageId: 'governance:revista-ufo:editorial-avistamentos-category',
    sourcePosition: 'secondary',
    originality: 'derived',
    publisher: REVISTA_UFO_PUBLISHER,
    publicationMode: 'metadata_link_only',
    editorialArticleIsIndependentWitnessSource: false,
    articleContentStorageAllowed: false,
    embeddedMediaStorageAllowed: false,
    inferredEventFieldsAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [
      REVISTA_UFO_CATEGORY_URL,
      REVISTA_UFO_ABOUT_URL,
      REVISTA_UFO_TERMS_URL,
      REVISTA_UFO_PRIVACY_URL,
    ],
  };
};
