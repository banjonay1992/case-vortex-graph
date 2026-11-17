export const BUFORA_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-bufora-investigation-lineage-v1' as const;
export const BUFORA_PUBLISHER = 'British UFO Research Association' as const;
export const BUFORA_REPORTS_URL = 'https://www.bufora.org.uk/ufo-reports' as const;
export const BUFORA_REPORTING_URL = 'https://www.bufora.org.uk/sightings/report-a-sighting' as const;
export const BUFORA_INVESTIGATIONS_URL = 'https://www.bufora.org.uk/investigations' as const;
export const BUFORA_PHOTO_ANALYSIS_URL = 'https://www.bufora.org.uk/sightings/analysis-of-ufo-photographs' as const;
export const BUFORA_ABOUT_URL = 'https://www.bufora.org.uk/about' as const;

export type BuforaReviewedLineagePolicy = {
  source: 'BUFORA';
  lineageId: 'governance:bufora:published-investigation-reports';
  sourcePosition: 'mixed';
  originality: 'original';
  publisher: typeof BUFORA_PUBLISHER;
  publicationMode: 'metadata_link_only';
  officialOrganisationInvestigation: true;
  underlyingWitnessClaimsMixed: true;
  witnessIdentityStorageAllowed: false;
  narrativeStorageAllowed: false;
  publicCaseDateAndGeneralLocationAllowed: true;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly [
    typeof BUFORA_REPORTS_URL,
    typeof BUFORA_REPORTING_URL,
    typeof BUFORA_INVESTIGATIONS_URL,
    typeof BUFORA_PHOTO_ANALYSIS_URL,
    typeof BUFORA_ABOUT_URL,
  ];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveBuforaReviewedLineage = (
  sourceValue: string,
): BuforaReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source !== 'BUFORA' && source !== 'BRITISH_UFO_RESEARCH_ASSOCIATION') return null;
  return {
    source: 'BUFORA',
    lineageId: 'governance:bufora:published-investigation-reports',
    sourcePosition: 'mixed',
    originality: 'original',
    publisher: BUFORA_PUBLISHER,
    publicationMode: 'metadata_link_only',
    officialOrganisationInvestigation: true,
    underlyingWitnessClaimsMixed: true,
    witnessIdentityStorageAllowed: false,
    narrativeStorageAllowed: false,
    publicCaseDateAndGeneralLocationAllowed: true,
    mediaStorageAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [
      BUFORA_REPORTS_URL,
      BUFORA_REPORTING_URL,
      BUFORA_INVESTIGATIONS_URL,
      BUFORA_PHOTO_ANALYSIS_URL,
      BUFORA_ABOUT_URL,
    ],
  };
};
