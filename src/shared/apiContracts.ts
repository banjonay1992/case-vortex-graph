import type { VideoArchiveSection } from './videoArchiveSections';
export type { PublicDatasetMetrics } from './publicDatasetContracts';

export type ApiErrorPayload = {
  error: string;
  code: string;
  error_code?: string | null;
  details: Record<string, unknown> | null;
  request_id: string | null;
  user_message?: string | null;
  retry_after_seconds?: number | null;
};

export type RecoveryState = {
  error_code: string;
  retry_after_seconds: number | null;
  user_message: string;
};

export type EngagementState = {
  saved: boolean;
  following_region: boolean;
  view_streak_days: number;
  contributor_level: number;
  progress_to_next_level: number;
};

export type NotificationCadence = 'instant' | 'balanced' | 'digest';

export type NotificationPreferences = {
  push_enabled: boolean;
  cadence: NotificationCadence;
  max_per_hour: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  updated_at?: string | null;
};

export type TileMetadata = {
  name?: string;
  description?: string;
  version?: string;
  minzoom?: number;
  maxzoom?: number;
  raw_minzoom?: number;
  overview_maxzoom?: number;
  overview_features?: number;
  overview_features_by_zoom?: Record<string, number>;
  overview_bucket_zoom_offset?: number;
  tile_layout_version?: number;
  overview_strategy?: string;
  archive_sha256?: string;
  archive_md5?: string;
  archive_bytes?: number;
  bounds?: [number, number, number, number];
  center?: [number, number, number];
  format?: string;
  vector_layers?: Array<{
    id: string;
    description?: string;
    minzoom?: number;
    maxzoom?: number;
    fields?: Record<string, string>;
  }>;
  total_features?: number;
  expected_feature_count?: number;
  expected_stack_feature_count?: number;
  staged_stack_feature_upper_bound?: number;
  staged_stack_feature_count?: number;
  staging_write_reduction?: number;
  visibility_scope?: string;
  tiles_generated?: number;
  tiles_storage_prefix?: string;
  tiles_uploaded?: boolean;
  storage_provider?: string;
  distribution_mode?: string;
  public_tile_url_template?: string | null;
  tilejson_url?: string | null;
  globe_render_ready?: boolean;
  publication_snapshot_version?: number;
  projection_backfill_complete?: boolean;
  projection_source_total?: number;
  projection_total?: number;
  projection_retained_total?: number;
  projection_governance_revision?: number;
  projection_evidence_revision?: number;
  projection_backfill_completed_at?: string;
  projection_place_artifact_sha256?: string;
  projection_place_input_sha256?: string;
  projection_place_gazetteer_revision?: string;
  projection_place_import_row_count?: number;
  projection_place_import_completed_at?: string;
  projection_snapshot_calculated_at?: string;
  generated_at?: string | null;
  generated_at_iso?: string | null;
  source_max_updated_at?: string | null;
  source_last_ingested_at?: string | null;
  source_snapshot_generated_at?: string | null;
};

export type ArchivedVideoFeedItem = {
  id: string;
  provider: string;
  video_id: string;
  source_id: string | null;
  canonical_url: string | null;
  media_url: string | null;
  media_key: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  channel_title: string | null;
  channel_url: string | null;
  published_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  feed_timestamp: string | null;
  thumbnail_url: string | null;
  categories: string[] | null;
  tags: string[] | null;
  storage_policy: string;
  playback_policy: string;
  rights_status: string;
  content_class: string;
  footage_score: number;
  is_sighting_footage: boolean;
  archive_section: VideoArchiveSection;
};

export type ArchivedVideoFeedResponse = {
  items: ArchivedVideoFeedItem[];
  total: number | null;
  limit: number;
  offset: number;
};

export type PublicDatasetCoverage = {
  generated_at: string;
  completeness: {
    event_timestamp_pct: number;
    country_normalized_pct: number;
    mappable_pct: number;
  };
  freshness: {
    tier_a_sla_pass_pct: number;
    tier_b_sla_pass_pct: number;
    benchmark_age_hours: number;
  };
  provenance: {
    methodology_version: string;
    evidence_snapshot_id: string;
    public_rollup_generated_at?: string | null;
  };
  status?: {
    degraded: boolean;
    reasons: string[];
  };
};

export type PublicDatasetBenchmark = {
  generated_at: string;
  leaderboard: Array<{
    dataset: string;
    sightings_count: number;
    documents_count: number;
    photos_count: number;
    dedupe_method: string;
    measured_at: string;
    evidence_url: string | null;
  }>;
  our_rank: number;
  methodology_version: string;
};

export type PublicPhotosManifest = {
  generated_at: string | null;
  total: number;
  page_count: number;
  source_count: number;
};

export type CorrelatedEventCardV1 = {
  schema_version: 'correlated_event_card.v1';
  sighting: {
    id: string;
    public_id: string | null;
    source: string;
    source_type: string | null;
    event_timestamp: string | null;
    event_year: number | null;
    event_month: number | null;
    event_decade: number | null;
    event_date_precision: string | null;
    location: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    country_code: string | null;
    lat: number | null;
    lon: number | null;
    shape: string | null;
    duration_seconds: number | null;
    witness_count: number | null;
    confidence_score: number | null;
    summary_excerpt: string | null;
  };
  signals: {
    documents_count: number;
    photos_count: number;
    reference_count: number;
    opensky_count: number;
    maritime_count: number;
    balloon_count: number;
    text_cluster_count: number;
    link_count: number;
    trajectory_count: number;
    correlation_count: number;
    has_reference: boolean;
    has_opensky: boolean;
    has_maritime: boolean;
    has_balloon: boolean;
    has_text_cluster: boolean;
    has_links: boolean;
    has_trajectory: boolean;
    behavior_tags: string[];
    behavior_tag_count: number;
  };
  nearest: Record<string, unknown>;
  quality: {
    is_historical_record: boolean;
    timestamp_quality: string;
    publishable_modern_overlap: boolean;
  };
  scores: {
    conventional_explanation_score: number;
    novelty_score: number;
    evidence_strength_score: number;
    data_completeness_score: number;
    cross_source_disagreement_score: number;
    interesting_score: number;
  };
  computed_at: string;
};

export type PublicCorrelatedEventCardsResponse = {
  schema_version: 'correlated_event_card.v1';
  generated_at: string;
  total: number;
  count: number;
  limit: number;
  offset: number;
  filters: {
    min_signals: number;
    since_days: number;
    include_historical: boolean;
    sort: 'interesting' | 'newest';
    source: string | null;
    country_code: string | null;
  };
  cards: CorrelatedEventCardV1[];
};

export type PublicHookFeedItem = {
  id: string;
  hook_type: 'trajectory_wave' | 'tri_overlap_burst' | 'maritime_corridor' | 'spotlight_case';
  headline: string;
  why_it_matters: string;
  score: number;
  observed_at: string | null;
  cta: {
    label: string;
    path: string;
  };
  evidence: Array<{
    label: string;
    value: string;
  }>;
  related_sighting_ids?: string[];
};

export type PublicHookFeedResponse = {
  generated_at: string;
  lookback_years: number;
  methodology: string;
  items: PublicHookFeedItem[];
};

export type PublicVascoBaselineSummary = {
  flashDayCount: number;
  nonFlashDayCount: number;
  byRadius: Array<{
    radiusKm: number;
    flashDayCount: number;
    nonFlashDayCount: number;
    flashDaysWithSightings: number;
    nonFlashDaysWithSightings: number;
    flashDayRate: number | null;
    nonFlashDayRate: number | null;
    rateRatio: number | null;
  }>;
};

export type PublicVascoDistanceDecayPoint = {
  radiusKm: number;
  matchedSightings: number;
  matchedDays: number;
  flashDayRate: number | null;
  nonFlashDayRate: number | null;
  rateRatio: number | null;
};

export type PublicVascoWithinHoursClustering = {
  radiusKm: number;
  candidateSightings: number;
  flashDayCount: number;
  thresholds: Array<{
    thresholdHours: number;
    observedHits: number;
    observedRate: number | null;
    expectedHits: number | null;
    expectedRate: number | null;
    upperTailP: number | null;
  }>;
  medianNearestHours: number | null;
  expectedMedianNearestHours: number | null;
};

export type PublicVascoResearchSnapshot = {
  generated_at: string | null;
  catalog: {
    sourceName: string;
    eventCount: number;
    eventDays: number;
    startAt: string | null;
    endAt: string | null;
    maxDailyTransients: number;
  };
  studyWindow: {
    startDay: string;
    endDay: string;
    eventCount: number;
    eventDays: number;
    maxDailyTransients: number;
    geometryMatchCount: number;
    overlapByRadius: Array<{
      radiusKm: number;
      matchedSightings: number;
      matchedDays: number;
    }>;
  };
  baseline: PublicVascoBaselineSummary;
  controls: {
    permutation: {
      flashDayCount: number;
      iterations: number;
      byRadius: Array<{
        radiusKm: number;
        observedFlashHits: number;
        observedFlashRate: number | null;
        permutationExpectedHits: number | null;
        permutationExpectedRate: number | null;
        permutationUpperTailP: number | null;
        monthMatchedExpectedHits: number | null;
        monthMatchedExpectedRate: number | null;
        monthMatchedUpperTailP: number | null;
        iterations: number;
      }>;
    };
    observatories: Array<{
      key: string;
      name: string;
      region: string;
      lat: number;
      lon: number;
      baseline: PublicVascoBaselineSummary;
      permutation: {
        flashDayCount: number;
        iterations: number;
        byRadius: Array<{
          radiusKm: number;
          observedFlashHits: number;
          observedFlashRate: number | null;
          permutationExpectedHits: number | null;
          permutationExpectedRate: number | null;
          permutationUpperTailP: number | null;
          monthMatchedExpectedHits: number | null;
          monthMatchedExpectedRate: number | null;
          monthMatchedUpperTailP: number | null;
          iterations: number;
        }>;
      };
    }>;
    matchedRegionalControls: Array<{
      key: string;
      name: string;
      region: string;
      lat: number;
      lon: number;
      baseline: PublicVascoBaselineSummary;
      permutation: {
        flashDayCount: number;
        iterations: number;
        byRadius: Array<{
          radiusKm: number;
          observedFlashHits: number;
          observedFlashRate: number | null;
          permutationExpectedHits: number | null;
          permutationExpectedRate: number | null;
          permutationUpperTailP: number | null;
          monthMatchedExpectedHits: number | null;
          monthMatchedExpectedRate: number | null;
          monthMatchedUpperTailP: number | null;
          iterations: number;
        }>;
      };
    }>;
    subsets: {
      ufocatOnly: {
        sightingCount: number;
        baseline: PublicVascoBaselineSummary;
      };
      californiaOnly: {
        sightingCount: number;
        baseline: PublicVascoBaselineSummary;
      };
      southwest: {
        sightingCount: number;
        baseline: PublicVascoBaselineSummary;
      };
    };
  };
  analysis: {
    distanceDecay: PublicVascoDistanceDecayPoint[];
    observatoryControl: {
      radiusKm: number;
      palomarRateRatio: number | null;
      palomarRank: number | null;
      siteCount: number;
      controlSiteCount: number;
      outrankedControlSites: number;
      controlSitesAtOrAbovePalomar: number;
      empiricalUpperTailP: number | null;
      bestControlSite: {
        key: string;
        name: string;
        rateRatio: number | null;
      } | null;
    };
    matchedRegionalControl: {
      radiusKm: number;
      palomarRateRatio: number | null;
      palomarRank: number | null;
      siteCount: number;
      controlSiteCount: number;
      outrankedControlSites: number;
      controlSitesAtOrAbovePalomar: number;
      empiricalUpperTailP: number | null;
      bestControlSite: {
        key: string;
        name: string;
        rateRatio: number | null;
      } | null;
    };
    distanceDecayControl: {
      minimumMatchedDays: number;
      peakRadiusKm: number | null;
      peakRateRatio: number | null;
      farRadiusKm: number;
      farRateRatio: number | null;
      nearToFarRatio: number | null;
      palomarRank: number | null;
      controlSiteCount: number;
      siteCount: number;
      empiricalUpperTailP: number | null;
      bestControlSite: {
        key: string;
        name: string;
        nearToFarRatio: number | null;
      } | null;
    };
    exactTimeClustering: PublicVascoWithinHoursClustering | null;
  };
  overlap: {
    radiusKm: number;
    topDays: Array<{
      day: string;
      matchedSightings: number;
    }>;
    closestMatches: Array<{
      day: string;
      source: string;
      locationLabel: string;
      sightingPublicId: string | null;
      distanceKm: number;
    }>;
    yearSeries: Array<{
      year: number;
      transientEvents: number;
      transientDays: number;
      nearbySightings: number;
      nearbyDays: number;
    }>;
  };
  correlations: Array<{
    targetSeriesName: string;
    label: string;
    createdAt: string | null;
    bestDelayDays: number | null;
    bestPValueTwoTailed: number | null;
    inWindowMean: number | null;
    outWindowMean: number | null;
    relativeRisk: number | null;
    direction: 'lower_in_window' | 'higher_in_window' | null;
    predictedDelayDays: number | null;
    predictedPValueTwoTailed: number | null;
    predictedInWindowMean: number | null;
    predictedOutWindowMean: number | null;
    predictedRelativeRisk: number | null;
  }>;
};

export type MapSighting = {
  id: string;
  source: string;
  source_url?: string | null;
  source_label?: string | null;
  source_url_kind?: 'record' | 'collection' | 'unclassified' | 'unresolved' | null;
  attribution_notice?: string | null;
  detail_mode?: 'full' | 'attribution_only' | null;
  map_card_hydrated?: boolean;
  location_precision?: 'source' | 'approximate' | 'unlocated' | null;
  event_year?: number | null;
  title?: string | null;
  case_title?: string | null;
  case_rank?: number | null;
  event_timestamp: string | null;
  location: string | null;
  lat: number | null;
  lon: number | null;
  shape: string | null;
  witness_count?: number | null;
  media_url?: string | null;
  has_media?: boolean | null;
  summary?: string | null;
  case_pack?: Record<string, unknown> | null;
  photo_credit?: string | null;
  snippet_source?: string | null;
  balloon_match_count?: number | null;
  balloon_match_confidence?: number | null;
  confidence_level?: string | null;
  quality_score?: number | null;
  source_count?: number | null;
  investigation_priority_score?: number | null;
  top_explanation_type?: string | null;
  top_explanation_label?: string | null;
  quality_flags?: Record<string, unknown> | null;
  verification_notes?: string | null;
  moderation_state?: string | null;
  is_trending?: boolean | null;
  last_validated_at?: string | null;
};

export type PublicMapSightingCard = {
  id: string;
  detail_mode: 'full' | 'attribution_only';
  source: string;
  source_label: string;
  source_url: string | null;
  source_url_kind: 'record' | 'collection' | 'unclassified' | 'unresolved';
  attribution_notice: string;
  lat: number | null;
  lon: number | null;
  location_precision: 'source' | 'approximate' | 'unlocated';
  event_year: number | null;
  shape: string | null;
};

export type PublicMapStackCardsResponse = {
  stack_key: string;
  items: PublicMapSightingCard[];
  limit: number;
  next_cursor: string | null;
};

export type PublicMapUnlocatedCardsResponse = {
  items: PublicMapSightingCard[];
  limit: number;
  next_cursor: string | null;
};

export type MapSearchResponse = {
  items: MapSighting[];
  total?: number;
  limit: number;
  offset: number;
  truncated: boolean;
  bbox?: { west: number; south: number; east: number; north: number } | null;
  degraded?: boolean;
  degraded_reason?: string | null;
};

export type Sighting = {
  id: string;
  external_id: string;
  source: string;
  source_type: string;
  source_url: string | null;
  event_timestamp: string | null;
  date_posted: string | null;
  location: string;
  location_raw?: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  region?: string | null;
  country: string | null;
  country_code?: string | null;
  description: string;
  shape: string | null;
  duration: string | null;
  confidence_score: number | null;
  media_url: string | null;
  ingestion_job_id: string | null;
  event_date_precision?: string | null;
  geo_precision?: string | null;
  quality_flags?: Record<string, unknown> | null;
  created_at: string;
};

export type SightingSearchResponse = {
  items: Sighting[];
  limit: number;
  offset: number;
  total?: number;
  degraded?: boolean;
  degraded_reason?: string | null;
};

export type FootageUpload = {
  id: string;
  title: string | null;
  created_at: string;
  mime_type: string;
  file_size_bytes: number | null;
  metadata: Record<string, unknown> | null;
  thumbnail_url: string | null;
  moderation_status: string | null;
  comment_count: number | null;
  last_comment_at: string | null;
};

export type NewsThumbnailSource =
  | 'rss_media'
  | 'article_metadata'
  | 'article_body'
  | 'json_ld'
  | 'gdelt_social_image'
  | 'google_image'
  | 'previous_snapshot'
  | 'source_logo'
  | 'generated_source_tile'
  | 'none';

export type NewsThumbnail = {
  url: string | null;
  cached_url: string | null;
  source: NewsThumbnailSource;
  kind: 'article_image' | 'source_logo' | 'generated_source_tile' | 'none';
  confidence: number;
  is_placeholder: boolean;
  displayable: boolean;
};

export type NewsFeedItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  feed: string;
  category: string;
  published_at: string | null;
  fetched_at: string;
  summary: string;
  image_url: string | null;
  thumbnail_url?: string | null;
  thumbnail?: NewsThumbnail;
  tags: string[];
  score: number;
  source_tier?: 'official' | 'major' | 'established' | 'other';
  source_trust_score?: number;
  likely_mundane_score?: number;
  likely_mundane_flags?: string[];
  cluster_id?: string;
  cluster_count?: number;
  coverage_sources?: string[];
  explain_tags?: string[];
  story_lane?: 'breaking' | 'developing' | 'verified' | 'major' | 'context';
  ranking_reason?: string;
  freshness_score?: number;
  novelty_score?: number;
  impact_score?: number;
  public_interest_score?: number;
  rehash_penalty?: number;
  is_breaking: boolean;
};

export type NewsFeedResponse = {
  generated_at: string;
  stale_after: string;
  ttl_ms: number;
  item_count: number;
  duplicates_filtered: number;
  category_counts: Array<{ category: string; count: number }>;
  source_counts: Array<{ source: string; count: number }>;
  quality_metrics?: {
    official_source_items: number;
    major_source_items: number;
    established_source_items: number;
    other_source_items: number;
    tracker_linked_items: number;
    likely_mundane_items: number;
    likely_mundane_coverage: number;
    average_source_trust_score: number;
    high_impact_items?: number;
    rehash_limited_items?: number;
    developing_items?: number;
    image_coverage?: number;
    article_image_coverage?: number;
    source_logo_coverage?: number;
    ios_displayable_thumbnail_coverage?: number;
  };
  status?: {
    source_count: number;
    image_coverage: number;
    last_refreshed_at: string;
    served_from?: 'memory' | 'database' | 'refresh' | 'device_cache';
  };
  feeds: string[];
  items: NewsFeedItem[];
};

export type NewsReaderPayload = {
  id: string;
  title: string;
  source: string;
  published_at: string | null;
  original_url: string;
  mode: 'embedded_iframe' | 'sanitized_extract' | 'preview_only';
  embed_url: string | null;
  extracted_html: string | null;
  summary: string;
  image_url: string | null;
  blocked_reason: string | null;
};

export type ReportDocument = {
  id: string;
  title: string | null;
  mime_type: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  download_url: string | null;
};

export type ReportSourceSummary = {
  source: string;
  total: number;
  latest_event: string | null;
  latest_ingested_at: string | null;
  visible_total?: number;
  mappable?: number;
  visible_mappable?: number;
};

export type DocumentSourceSummary = {
  source: string;
  total: number;
  media_count: number;
  latest_created_at: string | null;
  latest_ingested_at: string | null;
};

export type DocumentSectionSummary = {
  id: string;
  label: string;
  description: string;
  total: number;
  media_count: number;
};

export type DocumentSectionsResponse = {
  sections: DocumentSectionSummary[];
};

export type VideoArchiveSectionSummary = {
  id: VideoArchiveSection;
  label: string;
  description: string;
  total: number;
};

export type VideoArchiveSectionsResponse = {
  sections: VideoArchiveSectionSummary[];
};

export type FederatedResultKind = 'report' | 'photo' | 'footage' | 'document' | 'video';

export type SearchSuggestion = {
  text: string;
  kind: 'event' | 'title' | 'location' | 'alias' | 'source';
  score: number;
  source_kind?: FederatedResultKind | 'curated';
  reason?: string;
};

export type SearchSuggestionsResponse = {
  query: string;
  suggestions: SearchSuggestion[];
};

export type FederatedSearchResultItem = {
  id: string;
  kind: FederatedResultKind;
  entity_kind?: FederatedResultKind;
  title: string;
  subtitle: string;
  snippet: string;
  timestamp: string | null;
  location: string | null;
  source: string | null;
  source_type?: string | null;
  source_url?: string | null;
  confidence: 'verified' | 'corroborated' | 'single_source' | null;
  preview_url: string | null;
  deep_link?: string | null;
  score: number;
  match_reasons: string[];
  report_id?: string | null;
  lat?: number | null;
  lon?: number | null;
  shape?: string | null;
  event_timestamp?: string | null;
  source_count?: number | null;
  last_validated_at?: string | null;
  moderation_state?: 'visible' | 'review' | 'flagged' | 'removed' | null;
  linked_documents_count?: number;
  linked_photos_count?: number;
  linked_footage_count?: number;
};

export type FederatedSearchSection = {
  items: FederatedSearchResultItem[];
  total: number;
  has_more: boolean;
  took_ms: number;
  degraded: boolean;
  error?: string;
};

export type FederatedSearchSectionTotals = {
  reports: number;
  photos: number;
  footage: number;
  documents: number;
  videos: number;
};

export type FederatedSearchResponse = {
  query: string;
  took_ms: number;
  partial: boolean;
  suggestions?: SearchSuggestion[];
  section_totals: FederatedSearchSectionTotals;
  sections: {
    reports: FederatedSearchSection;
    photos: FederatedSearchSection;
    footage: FederatedSearchSection;
    documents: FederatedSearchSection;
    videos: FederatedSearchSection;
  };
};

export type ArchiveAskCitationKind = 'report' | 'document' | 'photo' | 'footage' | 'video';

export type ArchiveAskCitation = {
  key: string;
  id: string;
  kind: ArchiveAskCitationKind;
  title: string;
  source: string | null;
  snippet: string;
  timestamp: string | null;
};

export type ArchiveAskResponse = {
  question: string;
  answer: string;
  citations: ArchiveAskCitation[];
  follow_up_queries: string[];
  sections: {
    reports: number;
    documents: number;
    photos: number;
    footage: number;
    videos: number;
  };
  model: string;
};

export type TrackingSourceCoverage = {
  status: 'ok' | 'degraded' | 'unavailable';
  source: string;
  note: string | null;
};

export type TrackingContextObject = {
  object_type: 'aircraft' | 'satellite' | 'astronomy' | 'maritime' | 'other';
  object_source: string;
  object_key?: string | null;
  label: string;
  confidence_score?: number | null;
  bearing_deg?: number | null;
  relative_bearing_deg?: number | null;
  elevation_deg?: number | null;
  distance_km?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude_m?: number | null;
  velocity_m_s?: number | null;
  [key: string]: unknown;
};

export type TrackingWeatherContext = {
  status: 'ok' | 'none' | 'skipped' | 'error';
  source: string;
  source_url?: string | null;
  summary?: string | null;
  sampled_at?: string | null;
  matched?: boolean;
  reason?: string | null;
  conditions?: Record<string, unknown> | null;
};

export type TrackingContextResponse = {
  captured_at: string;
  observer: {
    lat: number;
    lon: number;
    altitude_m?: number | null;
    heading_deg?: number | null;
    radius_km: number;
  };
  aircraft_snapshot_time: string | null;
  aircraft: TrackingContextObject[];
  satellites: TrackingContextObject[];
  /** Bounded geometric source scan; does not establish naked-eye visibility. */
  satellite_observer_scan?: {
    source_dataset: string;
    report_at: string;
    scan_status: 'bounded' | 'truncated';
    query_window_days: number;
    scanned_rows: number;
    fresh_rows: number;
    stale_rows: number;
    invalid_rows: number;
    above_horizon_rows: number;
    candidate_selection: 'highest_geometric_elevation';
    optical_visibility_assessed: false;
    geometric_candidates: Array<{
      norad_id: number;
      element_epoch: string;
      elevation_deg: number;
      azimuth_deg: number;
      range_km: number;
      element_age_days: number;
    }>;
  };
  astronomy: TrackingContextObject[];
  weather?: TrackingWeatherContext | null;
  summary: {
    aircraft_count: number;
    satellite_count: number;
    astronomy_count: number;
    weather_count?: number;
  };
  coverage?: {
    aircraft?: TrackingSourceCoverage;
    satellites?: TrackingSourceCoverage;
    astronomy?: TrackingSourceCoverage;
    weather?: TrackingSourceCoverage;
  };
};

export type CreateTrackingCaptureSessionPayload = {
  observer_lat?: number | null;
  observer_lon?: number | null;
  observer_altitude_m?: number | null;
  heading_deg?: number | null;
  pitch_deg?: number | null;
  roll_deg?: number | null;
  location_accuracy_m?: number | null;
  device_metadata?: Record<string, unknown> | null;
  session_metadata?: Record<string, unknown> | null;
};

export type CreateTrackingCaptureSessionResponse = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
  created_at: string;
};

export type CreateTrackingSnapshotPayload = {
  capture_session_id?: string | null;
  captured_at?: string | null;
  observer_lat: number;
  observer_lon: number;
  observer_altitude_m?: number | null;
  heading_deg?: number | null;
  pitch_deg?: number | null;
  roll_deg?: number | null;
  field_of_view_horizontal_deg?: number | null;
  field_of_view_vertical_deg?: number | null;
  context: TrackingContextResponse;
  raw_payload?: Record<string, unknown> | null;
};

export type CreateTrackingSnapshotResponse = {
  id: string;
  capture_session_id?: string | null;
  captured_at: string;
  object_count: number;
};

export type KnownObjectMatchSummary = {
  known_object_type?: string | null;
  known_object_source?: string | null;
  known_object_key?: string | null;
  known_object_label?: string | null;
  match_class?: string | null;
  confidence_score?: number | null;
  explanation?: string | null;
};

export type ReportTrackingAnalysis = {
  analysis_status?: string | null;
  capture_session_id?: string | null;
  tracking_snapshot_id?: string | null;
  top_match_class?: 'confirmed' | 'strong' | 'possible' | 'unknown' | string | null;
  top_match_label?: string | null;
  known_object_certainty_score?: number | null;
  anomaly_score?: number | null;
  known_matches?: KnownObjectMatchSummary[] | null;
  anomaly_events?: SkyAnomalyEventListItem[] | null;
};

export type SightingReplayStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'skipped';
export type SightingReplayAvailability = 'available' | 'degraded' | 'unavailable';

export type SightingReplayContextResponse = {
  sighting: {
    id: string;
    source: string | null;
    location: string | null;
    event_timestamp: string | null;
    event_date_precision: string | null;
    lat: number | null;
    lon: number | null;
  };
  replay: {
    status: SightingReplayStatus;
    availability: SightingReplayAvailability;
    replay_version: string;
    generated_at: string | null;
    failure_reason: string | null;
    approximate: boolean;
    persisted: boolean;
    tracking_snapshot_id: string | null;
  };
  context: TrackingContextResponse;
};

export type SightingSkyReplayFrame = {
  offset_seconds: number;
  captured_at: string;
  aircraft: TrackingContextObject[];
  satellites: TrackingContextObject[];
  summary: {
    aircraft_count: number;
    satellite_count: number;
  };
};

export type SightingSkyReplayResponse = {
  sighting_id: string;
  start_captured_at: string;
  duration_seconds: number;
  step_seconds: number;
  observer: {
    lat: number;
    lon: number;
    altitude_m: number | null;
    heading_deg: number | null;
  };
  frames: SightingSkyReplayFrame[];
};

export type SkyAnomalyReviewStatus = 'needs_review' | 'explained' | 'unexplained' | 'false_positive';

export type SkyAnomalyEvidenceAsset = {
  id: string;
  asset_kind: 'screenshot' | 'clip' | 'manifest' | 'track';
  storage_key: string | null;
  public_url: string | null;
  mime_type: string | null;
  capture_timestamp: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
};

export type SkyAnomalyExplanation = {
  id: string;
  explainer_key: string;
  explanation_type: string;
  match_confidence: number | null;
  decision: 'matched' | 'rejected' | 'degraded' | 'unknown';
  reason: string | null;
  metadata: Record<string, unknown> | null;
};

export type SkyAnomalyEventListItem = {
  id: string;
  review_status: SkyAnomalyReviewStatus;
  event_status: string;
  source_kind: string;
  source_ref: string | null;
  tracking_snapshot_id: string | null;
  capture_session_id: string | null;
  sighting_id: string | null;
  video_source_id: string | null;
  detected_at: string;
  explainability_score: number | null;
  track_quality_score: number | null;
  event_anomaly_score_v1: number | null;
  weather_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type SkyAnomalyEventDetail = SkyAnomalyEventListItem & {
  notes: string | null;
  review_reason: string | null;
  review_updated_at: string | null;
  source_metadata: Record<string, unknown> | null;
  scoring_breakdown: Record<string, unknown> | null;
  track_summary: Record<string, unknown> | null;
  explanations: SkyAnomalyExplanation[];
  evidence_assets: SkyAnomalyEvidenceAsset[];
};

export type SkyAnomalyEventListResponse = {
  items: SkyAnomalyEventListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type UpdateSkyAnomalyReviewPayload = {
  review_status: SkyAnomalyReviewStatus;
  review_reason?: string | null;
  notes?: string | null;
};

export type ReplaySkyVideoSourcePayload = {
  start_at?: string | null;
  end_at?: string | null;
  source_ref?: string | null;
  force?: boolean;
  trigger_kind?: 'manual_replay' | 'live_scan';
};

export type ReplaySkyVideoSourceResponse = {
  queued: boolean;
  detection_run_id: string;
  video_source_id: string;
  source_ref: string | null;
  status: string;
  reused_existing?: boolean;
};

export type SkyVideoSourceSummary = {
  video_source_id: string;
  name: string;
  source_kind: string;
  source_uri: string;
  adapter_type: string;
  enabled: boolean;
  capture_policy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  latest_detection_run_status: string | null;
  latest_detection_run_at: string | null;
  latest_feed_run_status: string | null;
  latest_feed_run_at: string | null;
};

export type PublicSkyVideoSourceSummary = {
  video_source_id: string;
  name: string;
  source_kind: 'youtube_live' | 'hls' | 'public_stream';
  adapter_type: string;
  playback_url: string;
  official_page_url: string | null;
  preview_image_url: string | null;
  animated_preview_url: string | null;
  live: boolean;
  replayable: boolean;
  cadence_seconds: number | null;
  freshness_ttl_seconds: number | null;
  presentation: {
    mode: 'tracked_live' | 'live_embed' | 'rolling_timelapse';
    label: string | null;
    notice: string | null;
  };
};

export type SkyOverlayPreview = {
  track_id: string;
  stage: 'idle' | 'tracking' | 'correlating' | 'explained' | 'anomaly' | 'review_only' | 'reset' | 'failed' | 'backoff';
  observed_at: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  normalized_bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  frame_size: {
    width: number;
    height: number;
  } | null;
  top_explainer_status: 'checking' | 'matched' | 'unmatched' | 'rejected';
  top_explainer_type: string | null;
  top_explainer_confidence: number | null;
  motion?: {
    speed_px_s: number | null;
    acceleration_px_s2: number | null;
  };
};

export type SkyLiveDecisionSummary = {
  decision: 'idle' | 'explained' | 'anomaly' | 'review_only' | 'ignore' | 'failed';
  summary: string;
  detected_at: string | null;
  anomaly_event_id: string | null;
  anomaly_score: number | null;
  anomaly_propensity_score: number | null;
  promotion_confidence_score: number | null;
  explanation_type: string | null;
  explanation_confidence: number | null;
};

export type SkyLiveRunProgress = {
  track_count: number | null;
  triaged_track_count: number | null;
  suppressed_track_count: number | null;
  processed_track_count: number;
  anomaly_event_count: number;
  current_track_index: number | null;
  current_track_id: string | null;
  updated_at: string | null;
};

export type SkyFeedHealthItem = {
  feed_id: string;
  feed_name: string;
  source_kind: string;
  enabled: boolean;
  cadence_seconds: number;
  freshness_ttl_seconds: number;
  latest_status: string | null;
  latest_observed_at: string | null;
  latest_completed_at: string | null;
  latest_coverage_status: string | null;
  latest_error_message: string | null;
  freshness_lag_seconds: number | null;
  is_stale: boolean;
};

export type SkyQueueHealth = {
  queue_name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
};

export type SkyAnomalyQueueQuality = {
  reviewed: number;
  explained: number;
  unexplained: number;
  false_positive: number;
  analyst_acceptance_rate: number | null;
  queue_precision: number | null;
  false_positive_rate_per_hour: number | null;
  avg_time_to_triage_minutes: number | null;
  reviewed_span_hours: number | null;
  latest_reviewed_at: string | null;
};

export type SkyHealthResponse = {
  generated_at: string;
  feeds: SkyFeedHealthItem[];
  queue: SkyQueueHealth | null;
  detection_runs: {
    queued: number;
    processing: number;
    failed_24h: number;
    completed_24h: number;
  };
  anomaly_events: {
    needs_review: number;
    unexplained: number;
    false_positive: number;
    explained: number;
  };
  queue_quality: SkyAnomalyQueueQuality;
  satellite_snapshots: {
    snapshot_count: number;
    object_count: number;
    latest_epoch: string | null;
    latest_archive_at: string | null;
  };
};

export type SkyDetectionRunListItem = {
  id: string;
  video_source_id: string | null;
  video_source_name: string | null;
  feed_run_id: string | null;
  status: string;
  source_ref: string | null;
  analysis_window_start_at: string | null;
  analysis_window_end_at: string | null;
  frame_rate_fps: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type SkyDetectionRunDetail = SkyDetectionRunListItem & {
  input_payload: Record<string, unknown>;
  result_payload: Record<string, unknown>;
  video_source: SkyVideoSourceSummary | null;
  track_count: number;
  anomaly_event_count: number;
  evidence_asset_count: number;
  anomaly_event_ids: string[];
};

export type SkyVideoSourceLiveStatus = {
  video_source: SkyVideoSourceSummary;
  runtime: {
    loop_status: 'idle' | 'scheduled' | 'running' | 'backoff' | 'error' | 'disabled';
    current_phase: 'idle' | 'tracking' | 'correlating' | 'explained' | 'anomaly' | 'review_only' | 'reset' | 'failed' | 'backoff';
    lease_owner: string | null;
    lease_expires_at: string | null;
    last_window_start_at: string | null;
    last_window_end_at: string | null;
    next_scan_after_at: string | null;
    backoff_until_at: string | null;
    last_detection_run_id: string | null;
    lag_seconds: number | null;
    consecutive_failures: number;
    last_error_message: string | null;
    updated_at: string | null;
  };
  playback: {
    url: string | null;
    mime_type: string | null;
    expires_at: string | null;
  };
  latest_run: SkyDetectionRunListItem | null;
  overlay_preview: SkyOverlayPreview | null;
  latest_decision: SkyLiveDecisionSummary | null;
  progress: SkyLiveRunProgress | null;
};

export type PublicSkyAnomalyEvent = {
  id: string;
  detected_at: string;
  review_status: 'unexplained';
  event_status: string;
  summary: string | null;
  anomaly_score: number | null;
  track_quality_score: number | null;
  clip: {
    url: string;
    mime_type: string | null;
    duration_seconds: number | null;
    capture_timestamp: string | null;
  } | null;
  thumbnail_url: string | null;
};

export type PublicSkyFeedItem = {
  video_source_id: string;
  name: string;
  source_kind: 'youtube_live' | 'hls' | 'public_stream';
  adapter_type: string;
  presentation: {
    mode: 'tracked_live' | 'live_embed' | 'rolling_timelapse';
    label: string;
    notice: string | null;
    source_window_minutes: number | null;
    refresh_interval_seconds: number | null;
    time_compressed: boolean;
    automated_analysis_enabled: boolean;
    derived_media_publishing_allowed: boolean;
  };
  attribution: {
    label: string;
    url: string | null;
  };
  observer: {
    lat: number;
    lon: number;
    altitude_m: number | null;
    heading_deg: number | null;
    radius_km: number;
    field_of_view_calibrated: boolean;
  } | null;
  playback: {
    url: string | null;
    mime_type: string | null;
    expires_at: string | null;
  };
  status: {
    state: 'live' | 'degraded' | 'offline' | 'idle';
    phase: SkyVideoSourceLiveStatus['runtime']['current_phase'] | null;
    last_processed_at: string | null;
    coverage_status: string | null;
    lag_seconds: number | null;
    is_stale: boolean;
  };
  overlay_preview: SkyOverlayPreview | null;
  latest_decision: SkyLiveDecisionSummary | null;
  progress: SkyLiveRunProgress | null;
  recent_events: PublicSkyAnomalyEvent[];
};

export type PublicSkyFeedResponse = {
  generated_at: string;
  feeds: PublicSkyFeedItem[];
};

export type SkyVideoSourceRunListResponse = {
  items: SkyDetectionRunListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type {
  MobileNewsFeedParams,
  MobileSurfaceConfig,
  MobileVideoFeedParams,
} from './mobileSurfaceConfig';
