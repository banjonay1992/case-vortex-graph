export const HESSDALEN_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-hessdalen-source-lineage-v1' as const;
export const HESSDALEN_PUBLISHER = 'Project Hessdalen' as const;
export const HESSDALEN_OBSERVATIONS_URL = 'https://old.hessdalen.org/observations/' as const;
export const HESSDALEN_CURRENT_REPORTS_URL = 'https://www.hessdalen.org/reports' as const;
export const HESSDALEN_REPORTING_PRIVACY_URL = 'https://www.hessdalen.org/report-a-sighting' as const;
export const HESSDALEN_MISSION_URL = 'https://www.hessdalen.org/mission' as const;

export type HessdalenReviewedLineagePolicy = {
  source: 'HESSDALEN';
  lineageId: 'governance:project-hessdalen:registered-observations';
  sourcePosition: 'mixed';
  originality: 'original';
  publisher: typeof HESSDALEN_PUBLISHER;
  publicationMode: 'metadata_link_only';
  officialProjectRegistration: true;
  underlyingWitnessClaimsMixed: true;
  approximateCoordinatesAreEventLocation: false;
  witnessIdentityStorageAllowed: false;
  narrativeStorageAllowed: false;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  evidenceUrls: readonly [
    typeof HESSDALEN_OBSERVATIONS_URL,
    typeof HESSDALEN_CURRENT_REPORTS_URL,
    typeof HESSDALEN_REPORTING_PRIVACY_URL,
    typeof HESSDALEN_MISSION_URL,
  ];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveHessdalenReviewedLineage = (
  sourceValue: string,
): HessdalenReviewedLineagePolicy | null => {
  const source = normalize(sourceValue);
  if (source !== 'HESSDALEN' && source !== 'PROJECT_HESSDALEN') return null;
  return {
    source: 'HESSDALEN',
    lineageId: 'governance:project-hessdalen:registered-observations',
    sourcePosition: 'mixed',
    originality: 'original',
    publisher: HESSDALEN_PUBLISHER,
    publicationMode: 'metadata_link_only',
    officialProjectRegistration: true,
    underlyingWitnessClaimsMixed: true,
    approximateCoordinatesAreEventLocation: false,
    witnessIdentityStorageAllowed: false,
    narrativeStorageAllowed: false,
    mediaStorageAllowed: false,
    independentCorroborationAllowed: false,
    evidenceUrls: [
      HESSDALEN_OBSERVATIONS_URL,
      HESSDALEN_CURRENT_REPORTS_URL,
      HESSDALEN_REPORTING_PRIVACY_URL,
      HESSDALEN_MISSION_URL,
    ],
  };
};
