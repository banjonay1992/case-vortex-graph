export const REDDIT_UFO_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-reddit-ufo-source-lineage-v1' as const;
export const REDDIT_DATA_API_TERMS_URL = 'https://redditinc.com/policies/data-api-terms' as const;
export const REDDIT_PUBLIC_CONTENT_POLICY_URL = 'https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy' as const;

export type RedditUfoReviewedLineagePolicy = {
  source: 'REDDIT_UFO';
  lineageId: 'governance:reddit:platform-reference';
  sourcePosition: 'mixed';
  originality: 'unknown';
  publicationMode: 'platform_reference_only';
  eventTimeStatus: 'post_time_not_event_time';
  canonicalContentStorageAllowed: false;
  independentCorroborationAllowed: false;
  requiresLiveAvailability: true;
  requiresDeletionCompliance: true;
  evidenceUrls: readonly [typeof REDDIT_DATA_API_TERMS_URL, typeof REDDIT_PUBLIC_CONTENT_POLICY_URL];
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveRedditUfoReviewedLineage = (
  sourceValue: string,
): RedditUfoReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'REDDIT_UFO') return null;
  return {
    source: 'REDDIT_UFO',
    lineageId: 'governance:reddit:platform-reference',
    sourcePosition: 'mixed',
    originality: 'unknown',
    publicationMode: 'platform_reference_only',
    eventTimeStatus: 'post_time_not_event_time',
    canonicalContentStorageAllowed: false,
    independentCorroborationAllowed: false,
    requiresLiveAvailability: true,
    requiresDeletionCompliance: true,
    evidenceUrls: [REDDIT_DATA_API_TERMS_URL, REDDIT_PUBLIC_CONTENT_POLICY_URL],
  };
};
