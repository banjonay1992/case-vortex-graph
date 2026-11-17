import type { CaseGraphRawSighting, CaseGraphFeatureRecord } from './featureExtraction';

/**
 * Version 2 is intentionally incompatible with the original live-query feature
 * archive. It requires an immutable database snapshot receipt and binds every
 * resumable/publication object to that receipt.
 */
export const CASE_GRAPH_ARCHIVE_SCHEMA_VERSION = 2 as const;

export type CaseGraphCursor = {
  updated_at: string;
  case_id: string;
};

export type CaseGraphSourceRow = {
  cursor: CaseGraphCursor;
  sighting: CaseGraphRawSighting;
};

export type CaseGraphSourceCensus = {
  eligible_count: number;
  min_cursor: CaseGraphCursor | null;
  max_cursor: CaseGraphCursor | null;
  source_counts: Record<string, number>;
  publishability_policy: string;
  snapshot_at: string;
};

export type CaseGraphSourceStats = CaseGraphSourceCensus & {
  snapshot_id: string;
  snapshot_policy: string;
  capture_policy: string;
  materialized_at: string;
  source_mvcc_snapshot: string;
};

export type CaseGraphFeatureUniverseBinding = {
  corpus_version: string;
  archive_set_sha256: string;
};

export type CaseGraphFeatureArchiveBinding = {
  snapshot_id: string;
  snapshot_policy: string;
  capture_policy: string;
  materialized_at: string;
  source_mvcc_snapshot: string;
  universe: CaseGraphFeatureUniverseBinding | null;
};

export type CaseGraphFeaturePartSummary = {
  part_number: number;
  archive_key: string;
  manifest_key: string;
  row_count: number;
  first_cursor: CaseGraphCursor;
  last_cursor: CaseGraphCursor;
  source_counts: Record<string, number>;
  term_document_frequency: Record<string, number>;
  completeness_sum: number;
  uncompressed_bytes: number;
  uncompressed_sha256: string;
  compressed_bytes: number;
  compressed_sha256: string;
};

export type CaseGraphFeaturePartManifest = CaseGraphFeaturePartSummary & {
  record_type: 'case_graph_feature_part_manifest';
  schema_version: typeof CASE_GRAPH_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  feature_schema_version: CaseGraphFeatureRecord['schemaVersion'];
  archive_content_type: 'application/x-ndjson';
  archive_content_encoding: 'gzip';
};

export type CaseGraphFeatureCheckpoint = {
  record_type: 'case_graph_feature_checkpoint';
  schema_version: typeof CASE_GRAPH_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  binding: CaseGraphFeatureArchiveBinding;
  expected: CaseGraphSourceStats;
  exported_row_count: number;
  next_part_number: number;
  cursor: CaseGraphCursor | null;
  parts: CaseGraphFeaturePartSummary[];
  updated_at: string;
};

export type CaseGraphFeatureCompletionManifest = {
  record_type: 'case_graph_feature_completion_manifest';
  schema_version: typeof CASE_GRAPH_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  binding: CaseGraphFeatureArchiveBinding;
  expected: CaseGraphSourceStats;
  exported_row_count: number;
  part_count: number;
  parts: CaseGraphFeaturePartSummary[];
  archive_set_sha256: string;
  rarity_key: string;
  rarity_sha256: string;
  completed_at: string;
};

export type CaseGraphArchiveStorage = {
  readObject: (
    key: string,
    options?: { maxBytes?: number; signal?: AbortSignal },
  ) => Promise<Buffer | null>;
  uploadFile: (
    body: Buffer,
    key: string,
    options: {
      contentType: string;
      contentEncoding?: string;
      cacheControl: string;
      contentLength: number;
    },
  ) => Promise<string>;
};

export type CaseGraphVersionedArchiveObject = {
  body: Buffer;
  /**
   * Opaque storage version suitable for a subsequent conditional write. R2's
   * S3 transport supplies the object's quoted ETag here.
   */
  version: string;
};

export type CaseGraphArchiveWriteCondition =
  | { ifAbsent: true }
  | { ifVersion: string };

export type CaseGraphConditionalWriteResult =
  | { status: 'written'; key: string; version: string }
  | { status: 'precondition_failed' };

/**
 * Stronger storage contract used by writers which publish resumable state.
 *
 * `ifAbsent` protects immutable artifacts from replacement. `ifVersion`
 * provides compare-and-swap for mutable checkpoints. Implementations must make
 * the condition and write atomic at the backing object store.
 */
export type CaseGraphConditionalArchiveStorage = CaseGraphArchiveStorage & {
  readObjectVersioned: (key: string) => Promise<CaseGraphVersionedArchiveObject | null>;
  uploadFileConditional: (
    body: Buffer,
    key: string,
    options: {
      contentType: string;
      contentEncoding?: string;
      cacheControl: string;
      contentLength: number;
    },
    condition: CaseGraphArchiveWriteCondition,
  ) => Promise<CaseGraphConditionalWriteResult>;
};

export type CaseGraphArchiveObjectKeyPage = {
  keys: string[];
  /** Opaque continuation token. Null means the prefix has been exhausted. */
  cursor: string | null;
};

/**
 * Storage contract for writers which must inspect an entire object-key prefix.
 *
 * Callers must continue with the returned opaque cursor until it is null. The
 * implementation must not derive or reinterpret continuation tokens.
 */
export type CaseGraphListableConditionalArchiveStorage = CaseGraphConditionalArchiveStorage & {
  listObjectKeys: (
    prefix: string,
    cursor?: string | null,
    limit?: number,
  ) => Promise<CaseGraphArchiveObjectKeyPage>;
};

export type CaseGraphFeatureSource = {
  inspectEligibleSnapshot: () => Promise<CaseGraphSourceStats>;
  fetchEligiblePage: (cursor: CaseGraphCursor | null, limit: number) => Promise<CaseGraphSourceRow[]>;
};

/**
 * Kept only for diagnostics/tests of the retired live-query implementation.
 * This type is deliberately not accepted by `archiveCaseGraphFeatures`.
 */
export type CaseGraphUnmaterializedFeatureSource = {
  inspectEligibleSnapshot: () => Promise<CaseGraphSourceCensus>;
  fetchEligiblePage: (cursor: CaseGraphCursor | null, limit: number) => Promise<CaseGraphSourceRow[]>;
};
