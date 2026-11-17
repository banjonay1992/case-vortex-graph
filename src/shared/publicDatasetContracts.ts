export type SourceLegalStatus = 'approved' | 'review' | 'blocked' | 'restricted';

export type PublicSourceSummaryRow = {
  source: string;
  total: number;
  visible_total: number;
  mappable: number;
  visible_mappable: number;
  latest_event: string | null;
  latest_ingested_at: string | null;
};

export type PublishableFilterAudit = {
  excluded_total: number;
  exclusions_by_reason: Record<string, number>;
  reason_breakdown_available?: boolean;
};

export type PublicMapCoverage = {
  calculated_at: string;
  retained_total: number;
  located_total: number;
  direct_coordinate_total: number;
  approximate_total: number;
  unlocated_total: number;
  protected_total: number;
  full_detail_total: number;
  attribution_only_total: number;
};

export type PublicDatasetMetrics = {
  generated_at: string;
  freshness: {
    snapshot_age_minutes: number;
    latest_ingested_at: string | null;
    photos_index_generated_at: string | null;
  };
  photos_manifest?: {
    page_count: number;
    source_count: number;
  };
  layers?: {
    raw_ingested_records: number;
    canonical_normalized_records: number;
    publishable_records: number;
    mappable_records: number;
    derived_records_separated: boolean;
  };
  counts: {
    sightings_total: number;
    sightings_public: number;
    sightings_mappable: number;
    documents_total: number;
    photos_total_db: number;
    photos_total_public_index: number;
    videos_total: number;
    sources_total: number;
  };
  map_coverage?: PublicMapCoverage;
  quality: {
    mappable_pct: number;
    geocode_confident_mappable_pct?: number;
    invalid_date_open: number;
    invalid_geo_open: number;
    quarantined_open_total: number;
    geocode_review_queue_open?: number;
    photos_index_drift_count?: number;
    photos_index_drift_ratio?: number;
    photos_index_drift_threshold?: number;
  };
  filtering?: {
    policy_mode: string;
    excluded_from_public_total: number;
    exclusions_by_reason: Record<string, number>;
    reason_breakdown_available: boolean;
  };
  status?: {
    degraded: boolean;
    reasons: string[];
  };
  provenance: {
    snapshot_id: string;
    methodology_version: string;
    schema_version?: string;
    release_version?: string | null;
    source_watermark_updated_at?: string | null;
    policy_mode?: string;
  };
};

export type DatasetReleaseSourceRow = {
  source: string;
  raw_records: number;
  publishable_records: number;
  mappable_records: number;
  latest_ingested_at: string | null;
  legal_status: string;
  allowed_content_modes: string[];
};

export type DatasetReleaseSourceWatermark = {
  watermark_key: string;
  source: string | null;
  updated_at: string;
  watermark_checksum: string;
};

export type DatasetReleaseArtifactDescriptor = {
  file_name: string;
  format: 'json' | 'ndjson';
  sha256: string;
  bytes: number;
  record_count: number | null;
};

export type DatasetReleaseSnapshotPayload = {
  release_version: string;
  generated_at: string;
  schema_version: string;
  methodology_version: string;
  policy_mode: string;
  manifest: {
    sources: DatasetReleaseSourceRow[];
    source_count: number;
    source_watermarks: DatasetReleaseSourceWatermark[];
  };
  counts: {
    raw_ingested_records: number;
    canonical_normalized_records: number;
    publishable_records: number;
    mappable_records: number;
  };
  checksums: {
    manifest_sha256: string;
    sources_sha256: string;
    source_watermarks_sha256: string;
  };
  artifacts: {
    export_scope: string;
    files: DatasetReleaseArtifactDescriptor[];
  };
  provenance: {
    dataset_truth_snapshot_id: string | null;
  };
};

export type DatasetReleaseSnapshotRow = {
  id: string;
  release_version: string;
  generated_at: string;
  schema_version: string;
  policy_mode: string;
  manifest_checksum: string;
  payload: DatasetReleaseSnapshotPayload;
  created_at: string;
};
