export const UFOCNS_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-ufocns-platform-lineage-v1' as const;
export const UFOCNS_HOME_URL = 'http://www.ufocns.com/' as const;
export const UFOCNS_ROBOTS_URL = 'http://www.ufocns.com/robots.txt' as const;
export const UFOCNS_LINEAGE_ID = 'governance:ufocns:platform-reference' as const;

export type UfocnsReviewedLineagePolicy = {
  source: 'UFOCNS';
  lineageId: typeof UFOCNS_LINEAGE_ID;
  sourcePosition: 'mixed';
  originality: 'unknown';
  publicationMode: 'platform_reference_only';
  eventTimeStatus: 'post_time_not_event_time';
  canonicalContentStorageAllowed: false;
  witnessIdentityStorageAllowed: false;
  mediaStorageAllowed: false;
  independentCorroborationAllowed: false;
  requiresLiveAvailability: true;
  evidenceUrls: readonly [typeof UFOCNS_HOME_URL, typeof UFOCNS_ROBOTS_URL];
};

const normalize = (value: string) => String(value || '').trim().toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');

export const resolveUfocnsReviewedLineage = (sourceValue: string): UfocnsReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'UFOCNS') return null;
  return {
    source: 'UFOCNS', lineageId: UFOCNS_LINEAGE_ID,
    sourcePosition: 'mixed', originality: 'unknown', publicationMode: 'platform_reference_only',
    eventTimeStatus: 'post_time_not_event_time', canonicalContentStorageAllowed: false,
    witnessIdentityStorageAllowed: false, mediaStorageAllowed: false,
    independentCorroborationAllowed: false, requiresLiveAvailability: true,
    evidenceUrls: [UFOCNS_HOME_URL, UFOCNS_ROBOTS_URL],
  };
};
