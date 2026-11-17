export const UK_AIRPROX_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-uk-airprox-source-lineage-v1' as const;
export const UK_AIRPROX_PUBLISHER = 'UK Airprox Board' as const;
export const UK_AIRPROX_REPORT_INDEX_URL = 'https://www.airproxboard.org.uk/reports-and-analysis/individual-airprox-reports/' as const;
export const UK_AIRPROX_COPYRIGHT_URL = 'https://www.airproxboard.org.uk/learn-more-about-airprox/copyright/' as const;

export type UkAirproxReviewedLineagePolicy = {
  source: 'UK_AIRPROX';
  lineageId: 'governance:uk-airprox-board:official-air-safety-reports';
  sourcePosition: 'mixed';
  originality: 'original';
  publisher: typeof UK_AIRPROX_PUBLISHER;
  publicationMode: 'metadata_link_only';
  officialInvestigationAndAssessment: true;
  underlyingReporterClaimsMixed: true;
  assignsBlameOrLiability: false;
  independentCorroborationAllowed: false;
  eventTimestampSource: 'official_catalogue_date_and_utc_time';
  legacyDateRepairRequiredForCatalogueYears: readonly ['2017', '2018'];
  evidenceUrls: readonly [typeof UK_AIRPROX_REPORT_INDEX_URL, typeof UK_AIRPROX_COPYRIGHT_URL];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveUkAirproxReviewedLineage = (
  sourceValue: string,
): UkAirproxReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'UK_AIRPROX') return null;
  return {
    source: 'UK_AIRPROX',
    lineageId: 'governance:uk-airprox-board:official-air-safety-reports',
    sourcePosition: 'mixed',
    originality: 'original',
    publisher: UK_AIRPROX_PUBLISHER,
    publicationMode: 'metadata_link_only',
    officialInvestigationAndAssessment: true,
    underlyingReporterClaimsMixed: true,
    assignsBlameOrLiability: false,
    independentCorroborationAllowed: false,
    eventTimestampSource: 'official_catalogue_date_and_utc_time',
    legacyDateRepairRequiredForCatalogueYears: ['2017', '2018'],
    evidenceUrls: [UK_AIRPROX_REPORT_INDEX_URL, UK_AIRPROX_COPYRIGHT_URL],
  };
};
