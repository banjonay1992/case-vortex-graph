import { describe, expect, it } from 'vitest';

import {
  REDDIT_DATA_API_TERMS_URL,
  REDDIT_PUBLIC_CONTENT_POLICY_URL,
  REDDIT_UFO_SOURCE_LINEAGE_POLICY_VERSION,
  resolveRedditUfoReviewedLineage,
} from '../../src/caseGraph/redditUfoSourceLineage';

describe('Reddit platform-reference source lineage', () => {
  it('keeps Reddit records live-reference-only and ineligible for independent corroboration', () => {
    expect(REDDIT_UFO_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-reddit-ufo-source-lineage-v1');
    expect(resolveRedditUfoReviewedLineage(' reddit ufo ')).toEqual({
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
    });
  });

  it('does not classify unrelated community sources as Reddit', () => {
    expect(resolveRedditUfoReviewedLineage('UFO_FINDER')).toBeNull();
  });
});
