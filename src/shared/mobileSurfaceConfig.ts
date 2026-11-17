export type MobileVideoFeedParams = {
  limit: number;
  include_total: boolean;
  scope: 'sightings' | 'all_playable';
  source_scope?: 'official' | 'official_archives' | 'all';
  window?: 'today' | '24h' | 'all';
  exclude_context?: boolean;
};

export type MobileNewsFeedParams = {
  force?: boolean;
};

export type MobileSurfaceConfig = {
  version: 1;
  generated_at?: string;
  official_videos: {
    enabled: boolean;
    feed_params: MobileVideoFeedParams;
    stale_ms: number;
  };
  today: {
    video_feed_params: MobileVideoFeedParams;
    news_feed_params: MobileNewsFeedParams;
    sky_live: {
      enabled: boolean;
      limit: number;
    };
  };
  news: {
    feed_params: MobileNewsFeedParams;
    curated_refetch_ms: number;
    live_radar: {
      enabled: boolean;
      lookback_minutes: number;
      limit: number;
      max_results: number;
      min_score: number;
      refetch_ms: number;
    };
  };
};

export const DEFAULT_MOBILE_SURFACE_CONFIG: MobileSurfaceConfig = {
  version: 1,
  official_videos: {
    enabled: true,
    feed_params: {
      limit: 100,
      include_total: false,
      scope: 'all_playable',
      source_scope: 'official_archives',
    },
    stale_ms: 10 * 60_000,
  },
  today: {
    video_feed_params: {
      limit: 100,
      include_total: false,
      scope: 'sightings',
    },
    news_feed_params: {},
    sky_live: {
      enabled: true,
      limit: 12_000,
    },
  },
  news: {
    feed_params: {},
    curated_refetch_ms: 5 * 60_000,
    live_radar: {
      enabled: true,
      lookback_minutes: 1440,
      limit: 25,
      max_results: 20,
      min_score: 0,
      refetch_ms: 30_000,
    },
  },
};
