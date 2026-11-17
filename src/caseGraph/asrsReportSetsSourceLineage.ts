export const ASRS_REPORT_SETS_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-asrs-report-sets-lineage-v1' as const;
export const ASRS_REPORT_SETS_LINEAGE_ID = 'governance:nasa-asrs:rotating-report-set' as const;
export const ASRS_HOME_URL = 'https://asrs.arc.nasa.gov/' as const;
export const ASRS_DATABASE_URL = 'https://asrs.arc.nasa.gov/overview/database.html' as const;
export const ASRS_ABOUT_DATA_URL = 'https://asrs.arc.nasa.gov/search/dbol/aboutdata.html' as const;
export const ASRS_REPORT_SETS_URL = 'https://asrs.arc.nasa.gov/search/reportsets.html' as const;
export const ASRS_UAS_REPORT_SET_URL = 'https://asrs.arc.nasa.gov/docs/rpsts/uas.pdf' as const;
export const ASRS_NMAC_REPORT_SET_URL = 'https://asrs.arc.nasa.gov/docs/rpsts/nmac.pdf' as const;

export type AsrsReportSetsReviewedLineagePolicy = {
  source: 'ASRS_REPORTSETS';
  lineageId: typeof ASRS_REPORT_SETS_LINEAGE_ID;
  sourcePosition: 'mixed';
  originality: 'original';
  publisher: 'NASA Aviation Safety Reporting System';
  publicationMode: 'metadata_link_only_until_immutable_source_receipt';
  recordClass: 'contextual_aviation_safety_report';
  isSightingRecord: false;
  narrativeStorageRequiresImmutableSourceReceipt: true;
  independentCorroborationAllowed: false;
  reportSetIsRotating: true;
  evidenceUrls: readonly string[];
};

const normalize = (value: string) => String(value || '').trim().toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');

export const resolveAsrsReportSetsReviewedLineage = (sourceValue: string): AsrsReportSetsReviewedLineagePolicy | null => {
  if (!['ASRS_REPORTSETS', 'NASA_ASRS', 'ASRS'].includes(normalize(sourceValue))) return null;
  return {
    source: 'ASRS_REPORTSETS', lineageId: ASRS_REPORT_SETS_LINEAGE_ID,
    sourcePosition: 'mixed', originality: 'original', publisher: 'NASA Aviation Safety Reporting System',
    publicationMode: 'metadata_link_only_until_immutable_source_receipt',
    recordClass: 'contextual_aviation_safety_report', isSightingRecord: false,
    narrativeStorageRequiresImmutableSourceReceipt: true, independentCorroborationAllowed: false,
    reportSetIsRotating: true,
    evidenceUrls: [ASRS_HOME_URL, ASRS_DATABASE_URL, ASRS_ABOUT_DATA_URL, ASRS_REPORT_SETS_URL],
  };
};
