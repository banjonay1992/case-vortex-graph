import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { getCaseGraphFeatureControlKeys, getCaseGraphFeatureKeys } from './archiveKeys';
import {
  CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
  type CaseGraphArchiveStorage,
  type CaseGraphConditionalArchiveStorage,
  type CaseGraphCursor,
  type CaseGraphFeatureArchiveBinding,
  type CaseGraphFeatureCheckpoint,
  type CaseGraphFeatureCompletionManifest,
  type CaseGraphFeaturePartManifest,
  type CaseGraphFeaturePartSummary,
  type CaseGraphFeatureSource,
  type CaseGraphFeatureUniverseBinding,
  type CaseGraphSourceStats,
} from './archiveTypes';
import {
  buildCaseGraphFeaturePart,
  compareCaseGraphCursors,
  decodeCaseGraphFeaturePart,
  getCaseGraphFeatureArchiveSetSha256,
  getCaseGraphFeatureRecordCursor,
} from './featureArchiveCodec';
import { CASE_GRAPH_FEATURE_SCHEMA_VERSION, type CaseGraphFeatureRecord } from './featureExtraction';
import {
  CASE_GRAPH_RARITY_VERSION,
  buildCaseGraphRarityFromDocumentFrequency,
  type CaseGraphCorpusRarity,
} from './corpusRarity';

const DEFAULT_PAGE_SIZE = 10_000;
const DEFAULT_MAX_PARTS_PER_RUN = 4;
const EXPECTED_SNAPSHOT_POLICY = 'evidence-universe-materialized-v1';
const EXPECTED_CAPTURE_POLICY = 'publishable-public-v2-materialized-v1';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MVCC_PATTERN = /^\d+:\d+:(?:\d+(?:,\d+)*)?$/;
const PRECISE_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$/;

type UploadOptions = {
  contentType: string;
  contentEncoding?: string;
  cacheControl: string;
  contentLength: number;
};

const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

const parseJson = (body: Buffer, label: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const iso = (value: unknown, label: string) => {
  const raw = String(value || '').trim();
  const parsed = new Date(raw);
  if (!raw || !Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
};

const preciseUtc = (value: unknown, label: string) => {
  const raw = String(value || '').trim();
  if (!PRECISE_UTC_PATTERN.test(raw) || !Number.isFinite(new Date(raw).getTime())) {
    throw new Error(`${label}_invalid`);
  }
  return raw;
};

const uuid = (value: unknown, label: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
};

const boundedText = (value: unknown, label: string, maximum = 1_024) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label}_invalid`);
  }
  return normalized;
};

const normalizeCursor = (value: unknown, label: string): CaseGraphCursor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_invalid`);
  const candidate = value as Record<string, unknown>;
  return {
    updated_at: iso(candidate.updated_at, `${label}_timestamp`),
    case_id: uuid(candidate.case_id, `${label}_case_id`),
  };
};

const normalizeCountMap = (value: unknown, label: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_invalid`);
  const output: Record<string, number> = {};
  for (const [rawKey, rawCount] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    const key = boundedText(rawKey, label, 256);
    const count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label}_invalid`);
    if (count > 0) output[key] = count;
  }
  return output;
};

const normalizeSourceStats = (value: CaseGraphSourceStats): CaseGraphSourceStats => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_source_receipt_required');
  const eligibleCount = Number(value.eligible_count);
  if (!Number.isSafeInteger(eligibleCount) || eligibleCount < 0) throw new Error('case_graph_source_count_invalid');
  const sourceCounts = normalizeCountMap(value.source_counts, 'case_graph_source_counts');
  if (Object.values(sourceCounts).reduce((sum, count) => sum + count, 0) !== eligibleCount) {
    throw new Error('case_graph_source_counts_mismatch');
  }
  const minCursor = value.min_cursor ? normalizeCursor(value.min_cursor, 'case_graph_source_min_cursor') : null;
  const maxCursor = value.max_cursor ? normalizeCursor(value.max_cursor, 'case_graph_source_max_cursor') : null;
  if ((eligibleCount === 0) !== (minCursor === null && maxCursor === null)) {
    throw new Error('case_graph_source_cursor_bounds_mismatch');
  }
  if (minCursor && maxCursor && compareCaseGraphCursors(minCursor, maxCursor) > 0) {
    throw new Error('case_graph_source_cursor_bounds_invalid');
  }
  const snapshotPolicy = boundedText(value.snapshot_policy, 'case_graph_source_snapshot_policy');
  const capturePolicy = boundedText(value.capture_policy, 'case_graph_source_capture_policy');
  if (snapshotPolicy !== EXPECTED_SNAPSHOT_POLICY || capturePolicy !== EXPECTED_CAPTURE_POLICY) {
    throw new Error('case_graph_source_not_materialized');
  }
  const sourceMvccSnapshot = boundedText(value.source_mvcc_snapshot, 'case_graph_source_mvcc', 4_096);
  if (!MVCC_PATTERN.test(sourceMvccSnapshot)) throw new Error('case_graph_source_mvcc_invalid');
  return {
    snapshot_id: uuid(value.snapshot_id, 'case_graph_source_snapshot_id'),
    snapshot_policy: snapshotPolicy,
    capture_policy: capturePolicy,
    materialized_at: preciseUtc(value.materialized_at, 'case_graph_source_materialized_at'),
    source_mvcc_snapshot: sourceMvccSnapshot,
    eligible_count: eligibleCount,
    min_cursor: minCursor,
    max_cursor: maxCursor,
    source_counts: sourceCounts,
    publishability_policy: boundedText(value.publishability_policy, 'case_graph_publishability_policy'),
    snapshot_at: iso(value.snapshot_at, 'case_graph_source_snapshot'),
  };
};

const normalizeUniverseBinding = (
  value: CaseGraphFeatureUniverseBinding | null | undefined,
): CaseGraphFeatureUniverseBinding | null => {
  if (value == null) return null;
  const corpusVersion = String(value.corpus_version || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(corpusVersion)) {
    throw new Error('case_graph_universe_binding_corpus_invalid');
  }
  const archiveSetSha256 = String(value.archive_set_sha256 || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(archiveSetSha256)) throw new Error('case_graph_universe_binding_hash_invalid');
  return { corpus_version: corpusVersion, archive_set_sha256: archiveSetSha256 };
};

const buildBinding = (
  stats: CaseGraphSourceStats,
  universe: CaseGraphFeatureUniverseBinding | null,
): CaseGraphFeatureArchiveBinding => ({
  snapshot_id: stats.snapshot_id,
  snapshot_policy: stats.snapshot_policy,
  capture_policy: stats.capture_policy,
  materialized_at: stats.materialized_at,
  source_mvcc_snapshot: stats.source_mvcc_snapshot,
  universe,
});

const normalizeBinding = (value: unknown): CaseGraphFeatureArchiveBinding => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_binding_invalid');
  const binding = value as Record<string, unknown>;
  if (!exactKeys(binding, [
    'snapshot_id', 'snapshot_policy', 'capture_policy', 'materialized_at', 'source_mvcc_snapshot', 'universe',
  ])) throw new Error('case_graph_binding_invalid');
  const snapshotPolicy = boundedText(binding.snapshot_policy, 'case_graph_binding_snapshot_policy');
  const capturePolicy = boundedText(binding.capture_policy, 'case_graph_binding_capture_policy');
  const sourceMvccSnapshot = boundedText(binding.source_mvcc_snapshot, 'case_graph_binding_mvcc', 4_096);
  if (
    snapshotPolicy !== EXPECTED_SNAPSHOT_POLICY
    || capturePolicy !== EXPECTED_CAPTURE_POLICY
    || !MVCC_PATTERN.test(sourceMvccSnapshot)
  ) throw new Error('case_graph_binding_invalid');
  return {
    snapshot_id: uuid(binding.snapshot_id, 'case_graph_binding_snapshot_id'),
    snapshot_policy: snapshotPolicy,
    capture_policy: capturePolicy,
    materialized_at: preciseUtc(binding.materialized_at, 'case_graph_binding_materialized_at'),
    source_mvcc_snapshot: sourceMvccSnapshot,
    universe: normalizeUniverseBinding(binding.universe as CaseGraphFeatureUniverseBinding | null),
  };
};

const sourceStatsEqual = (left: CaseGraphSourceStats, right: CaseGraphSourceStats) => (
  JSON.stringify(normalizeSourceStats(left)) === JSON.stringify(normalizeSourceStats(right))
);

const bindingEqual = (left: CaseGraphFeatureArchiveBinding, right: CaseGraphFeatureArchiveBinding) => (
  JSON.stringify(normalizeBinding(left)) === JSON.stringify(normalizeBinding(right))
);

const PART_SUMMARY_KEYS = [
  'part_number', 'archive_key', 'manifest_key', 'row_count', 'first_cursor', 'last_cursor',
  'source_counts', 'term_document_frequency', 'completeness_sum', 'uncompressed_bytes',
  'uncompressed_sha256', 'compressed_bytes', 'compressed_sha256',
] as const;

const normalizePartSummary = (
  value: unknown,
  corpusVersion: string,
  requireExactKeys = true,
): CaseGraphFeaturePartSummary => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_part_manifest_invalid');
  const part = value as Record<string, unknown>;
  if (requireExactKeys && !exactKeys(part, PART_SUMMARY_KEYS)) throw new Error('case_graph_part_manifest_invalid');
  const partNumber = Number(part.part_number);
  const rowCount = Number(part.row_count);
  if (
    !Number.isSafeInteger(partNumber)
    || partNumber < 0
    || !Number.isSafeInteger(rowCount)
    || rowCount < 1
    || !SHA256_PATTERN.test(String(part.uncompressed_sha256 || ''))
    || !SHA256_PATTERN.test(String(part.compressed_sha256 || ''))
  ) throw new Error('case_graph_part_manifest_invalid');
  const expectedKeys = getCaseGraphFeatureKeys(corpusVersion, partNumber);
  if (part.archive_key !== expectedKeys.archiveKey || part.manifest_key !== expectedKeys.manifestKey) {
    throw new Error('case_graph_part_manifest_keys_invalid');
  }
  const summary: CaseGraphFeaturePartSummary = {
    part_number: partNumber,
    archive_key: expectedKeys.archiveKey,
    manifest_key: expectedKeys.manifestKey,
    row_count: rowCount,
    first_cursor: normalizeCursor(part.first_cursor, 'case_graph_part_first_cursor'),
    last_cursor: normalizeCursor(part.last_cursor, 'case_graph_part_last_cursor'),
    source_counts: normalizeCountMap(part.source_counts, 'case_graph_part_source_counts'),
    term_document_frequency: normalizeCountMap(part.term_document_frequency, 'case_graph_part_term_document_frequency'),
    completeness_sum: Number(part.completeness_sum),
    uncompressed_bytes: Number(part.uncompressed_bytes),
    uncompressed_sha256: String(part.uncompressed_sha256),
    compressed_bytes: Number(part.compressed_bytes),
    compressed_sha256: String(part.compressed_sha256),
  };
  if (
    compareCaseGraphCursors(summary.first_cursor, summary.last_cursor) > 0
    || Object.values(summary.source_counts).reduce((sum, count) => sum + count, 0) !== summary.row_count
    || Object.values(summary.term_document_frequency).some((count) => count > summary.row_count)
    || !Number.isFinite(summary.completeness_sum)
    || summary.completeness_sum < 0
    || summary.completeness_sum > summary.row_count
    || !Number.isSafeInteger(summary.uncompressed_bytes)
    || summary.uncompressed_bytes < 1
    || !Number.isSafeInteger(summary.compressed_bytes)
    || summary.compressed_bytes < 1
  ) throw new Error('case_graph_part_manifest_totals_invalid');
  return summary;
};

const normalizePartManifest = (value: unknown, corpusVersion: string): CaseGraphFeaturePartManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_part_manifest_invalid');
  const raw = value as Record<string, unknown>;
  if (!exactKeys(raw, [
    'record_type', 'schema_version', 'corpus_version', 'feature_schema_version',
    'archive_content_type', 'archive_content_encoding', ...PART_SUMMARY_KEYS,
  ])) throw new Error('case_graph_part_manifest_invalid');
  if (
    raw.record_type !== 'case_graph_feature_part_manifest'
    || raw.schema_version !== CASE_GRAPH_ARCHIVE_SCHEMA_VERSION
    || raw.corpus_version !== corpusVersion
    || raw.feature_schema_version !== CASE_GRAPH_FEATURE_SCHEMA_VERSION
    || raw.archive_content_type !== 'application/x-ndjson'
    || raw.archive_content_encoding !== 'gzip'
  ) throw new Error('case_graph_part_manifest_invalid');
  return {
    record_type: 'case_graph_feature_part_manifest',
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    feature_schema_version: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
    archive_content_type: 'application/x-ndjson',
    archive_content_encoding: 'gzip',
    ...normalizePartSummary(raw, corpusVersion, false),
  };
};

const validatePartSequence = (parts: readonly CaseGraphFeaturePartSummary[]) => {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.part_number !== index) throw new Error('case_graph_part_sequence_invalid');
    const previous = parts[index - 1];
    if (previous && compareCaseGraphCursors(previous.last_cursor, part.first_cursor) >= 0) {
      throw new Error('case_graph_part_cursor_overlap');
    }
  }
};

const assertBindingMatchesExpected = (
  binding: CaseGraphFeatureArchiveBinding,
  expected: CaseGraphSourceStats,
) => {
  if (!bindingEqual(binding, buildBinding(expected, binding.universe))) {
    throw new Error('case_graph_binding_source_mismatch');
  }
};

const parseCheckpoint = (body: Buffer, corpusVersion: string): CaseGraphFeatureCheckpoint => {
  const value = parseJson(body, 'case_graph_checkpoint');
  if (
    !exactKeys(value, [
      'record_type', 'schema_version', 'corpus_version', 'binding', 'expected', 'exported_row_count',
      'next_part_number', 'cursor', 'parts', 'updated_at',
    ])
    || value.record_type !== 'case_graph_feature_checkpoint'
    || value.schema_version !== CASE_GRAPH_ARCHIVE_SCHEMA_VERSION
    || value.corpus_version !== corpusVersion
    || !Array.isArray(value.parts)
  ) throw new Error('case_graph_checkpoint_invalid');
  const parts = value.parts.map((part) => normalizePartSummary(part, corpusVersion));
  validatePartSequence(parts);
  const checkpoint: CaseGraphFeatureCheckpoint = {
    record_type: 'case_graph_feature_checkpoint',
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    binding: normalizeBinding(value.binding),
    expected: normalizeSourceStats(value.expected as CaseGraphSourceStats),
    exported_row_count: Number(value.exported_row_count),
    next_part_number: Number(value.next_part_number),
    cursor: value.cursor ? normalizeCursor(value.cursor, 'case_graph_checkpoint_cursor') : null,
    parts,
    updated_at: iso(value.updated_at, 'case_graph_checkpoint_updated_at'),
  };
  assertBindingMatchesExpected(checkpoint.binding, checkpoint.expected);
  if (
    !Number.isSafeInteger(checkpoint.exported_row_count)
    || checkpoint.exported_row_count < 0
    || checkpoint.exported_row_count !== parts.reduce((sum, part) => sum + part.row_count, 0)
    || checkpoint.next_part_number !== parts.length
    || JSON.stringify(checkpoint.cursor) !== JSON.stringify(parts.at(-1)?.last_cursor || null)
  ) throw new Error('case_graph_checkpoint_counters_invalid');
  return checkpoint;
};

const sumCountMaps = (maps: ReadonlyArray<Readonly<Record<string, number>>>) => {
  const output: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, count] of Object.entries(map)) output[key] = (output[key] || 0) + count;
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
};

const parseCompletion = (body: Buffer, corpusVersion: string): CaseGraphFeatureCompletionManifest => {
  const value = parseJson(body, 'case_graph_completion');
  if (
    !exactKeys(value, [
      'record_type', 'schema_version', 'corpus_version', 'binding', 'expected', 'exported_row_count',
      'part_count', 'parts', 'archive_set_sha256', 'rarity_key', 'rarity_sha256', 'completed_at',
    ])
    || value.record_type !== 'case_graph_feature_completion_manifest'
    || value.schema_version !== CASE_GRAPH_ARCHIVE_SCHEMA_VERSION
    || value.corpus_version !== corpusVersion
    || !Array.isArray(value.parts)
  ) throw new Error('case_graph_completion_invalid');
  const parts = value.parts.map((part) => normalizePartSummary(part, corpusVersion));
  validatePartSequence(parts);
  const completion: CaseGraphFeatureCompletionManifest = {
    record_type: 'case_graph_feature_completion_manifest',
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    binding: normalizeBinding(value.binding),
    expected: normalizeSourceStats(value.expected as CaseGraphSourceStats),
    exported_row_count: Number(value.exported_row_count),
    part_count: Number(value.part_count),
    parts,
    archive_set_sha256: String(value.archive_set_sha256 || ''),
    rarity_key: String(value.rarity_key || ''),
    rarity_sha256: String(value.rarity_sha256 || ''),
    completed_at: iso(value.completed_at, 'case_graph_completion_completed_at'),
  };
  assertBindingMatchesExpected(completion.binding, completion.expected);
  const controlKeys = getCaseGraphFeatureControlKeys(corpusVersion);
  if (
    !Number.isSafeInteger(completion.exported_row_count)
    || completion.exported_row_count < 0
    || completion.exported_row_count !== parts.reduce((sum, part) => sum + part.row_count, 0)
    || completion.exported_row_count !== completion.expected.eligible_count
    || !Number.isSafeInteger(completion.part_count)
    || completion.part_count !== parts.length
    || completion.archive_set_sha256 !== getCaseGraphFeatureArchiveSetSha256(parts, completion.binding)
    || completion.rarity_key !== controlKeys.rarityKey
    || !SHA256_PATTERN.test(completion.rarity_sha256)
    || JSON.stringify(parts[0]?.first_cursor || null) !== JSON.stringify(completion.expected.min_cursor)
    || JSON.stringify(parts.at(-1)?.last_cursor || null) !== JSON.stringify(completion.expected.max_cursor)
    || JSON.stringify(sumCountMaps(parts.map((part) => part.source_counts)))
      !== JSON.stringify(completion.expected.source_counts)
  ) throw new Error('case_graph_completion_integrity_invalid');
  return completion;
};

/**
 * Strict structural decoder for a completed feature archive receipt. Exported
 * so downstream control planes can recompute the archive-set binding instead
 * of accepting a free-standing feature digest from a caller.
 */
export const decodeCaseGraphFeatureCompletion = (
  body: Buffer,
  corpusVersion: string,
): CaseGraphFeatureCompletionManifest => parseCompletion(body, corpusVersion);

const partSummaryFromManifest = (manifest: CaseGraphFeaturePartManifest): CaseGraphFeaturePartSummary => ({
  part_number: manifest.part_number,
  archive_key: manifest.archive_key,
  manifest_key: manifest.manifest_key,
  row_count: manifest.row_count,
  first_cursor: manifest.first_cursor,
  last_cursor: manifest.last_cursor,
  source_counts: manifest.source_counts,
  term_document_frequency: manifest.term_document_frequency,
  completeness_sum: manifest.completeness_sum,
  uncompressed_bytes: manifest.uncompressed_bytes,
  uncompressed_sha256: manifest.uncompressed_sha256,
  compressed_bytes: manifest.compressed_bytes,
  compressed_sha256: manifest.compressed_sha256,
});

const featureTerms = (record: CaseGraphFeatureRecord) => {
  const groups = [
    record.traits.visual,
    record.traits.behaviour,
    record.traits.sensory,
    record.traits.entities,
    record.traits.keywords,
  ];
  const terms = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      if (!item || typeof item !== 'object' || typeof item.term !== 'string' || !item.term.trim()) {
        throw new Error('case_graph_feature_archive_record_invalid');
      }
      terms.add(item.term);
    }
  }
  return terms;
};

const verifyStoredPart = async (
  storage: CaseGraphArchiveStorage,
  summary: CaseGraphFeaturePartSummary,
  corpusVersion: string,
) => {
  const manifestBody = await storage.readObject(summary.manifest_key);
  if (!manifestBody) throw new Error('case_graph_feature_part_manifest_missing');
  const manifest = normalizePartManifest(parseJson(manifestBody, 'case_graph_part_manifest'), corpusVersion);
  if (JSON.stringify(partSummaryFromManifest(manifest)) !== JSON.stringify(summary)) {
    throw new Error('case_graph_feature_part_manifest_mismatch');
  }
  const archiveBody = await storage.readObject(summary.archive_key);
  if (
    !archiveBody
    || archiveBody.length !== summary.compressed_bytes
    || sha256(archiveBody) !== summary.compressed_sha256
  ) throw new Error('case_graph_feature_archive_bytes_mismatch');
  let uncompressed: Buffer;
  let features: CaseGraphFeatureRecord[];
  try {
    uncompressed = gunzipSync(archiveBody, { maxOutputLength: summary.uncompressed_bytes });
    features = decodeCaseGraphFeaturePart(archiveBody, summary.uncompressed_bytes, corpusVersion);
  } catch {
    throw new Error('case_graph_feature_archive_decode_failed');
  }
  if (
    uncompressed.length !== summary.uncompressed_bytes
    || sha256(uncompressed) !== summary.uncompressed_sha256
    || features.length !== summary.row_count
  ) throw new Error('case_graph_feature_archive_accounting_mismatch');

  const sourceCounts: Record<string, number> = {};
  const termFrequency: Record<string, number> = {};
  const cursors: CaseGraphCursor[] = [];
  let completenessSum = 0;
  for (const feature of features) {
    const cursor = getCaseGraphFeatureRecordCursor(feature);
    const previous = cursors.at(-1);
    if (previous && compareCaseGraphCursors(previous, cursor) >= 0) {
      throw new Error('case_graph_feature_archive_cursor_order_invalid');
    }
    cursors.push(cursor);
    sourceCounts[feature.source] = (sourceCounts[feature.source] || 0) + 1;
    completenessSum += feature.completeness.score;
    for (const term of featureTerms(feature)) termFrequency[term] = (termFrequency[term] || 0) + 1;
  }
  const sortedSources = Object.fromEntries(Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b)));
  const sortedTerms = Object.fromEntries(Object.entries(termFrequency).sort(([a], [b]) => a.localeCompare(b)));
  if (
    JSON.stringify(cursors[0] || null) !== JSON.stringify(summary.first_cursor)
    || JSON.stringify(cursors.at(-1) || null) !== JSON.stringify(summary.last_cursor)
    || JSON.stringify(sortedSources) !== JSON.stringify(summary.source_counts)
    || JSON.stringify(sortedTerms) !== JSON.stringify(summary.term_document_frequency)
    || Number(completenessSum.toFixed(4)) !== summary.completeness_sum
  ) throw new Error('case_graph_feature_archive_feature_receipt_mismatch');
  return { manifest, features };
};

/**
 * Verifies and decodes one immutable feature shard. Downstream archive
 * materializers use this instead of reimplementing the feature receipts.
 */
export const readVerifiedCaseGraphFeaturePart = verifyStoredPart;

const verifyStoredParts = async (
  storage: CaseGraphArchiveStorage,
  parts: readonly CaseGraphFeaturePartSummary[],
  corpusVersion: string,
) => {
  validatePartSequence(parts);
  for (const part of parts) await verifyStoredPart(storage, part, corpusVersion);
};

const validateRarity = async (
  storage: CaseGraphArchiveStorage,
  completion: CaseGraphFeatureCompletionManifest,
) => {
  const rarityBody = await storage.readObject(completion.rarity_key);
  if (!rarityBody || sha256(rarityBody) !== completion.rarity_sha256) {
    throw new Error('case_graph_completion_rarity_mismatch');
  }
  const raw = parseJson(rarityBody, 'case_graph_rarity') as Partial<CaseGraphCorpusRarity>;
  if (
    raw.version !== CASE_GRAPH_RARITY_VERSION
    || raw.corpusVersion !== completion.corpus_version
    || raw.documentCount !== completion.exported_row_count
    || !raw.documentFrequency
    || typeof raw.documentFrequency !== 'object'
    || Array.isArray(raw.documentFrequency)
  ) throw new Error('case_graph_rarity_invalid');
  const expectedFrequency = sumCountMaps(completion.parts.map((part) => part.term_document_frequency));
  if (JSON.stringify(normalizeCountMap(raw.documentFrequency, 'case_graph_rarity_frequency')) !== JSON.stringify(expectedFrequency)) {
    throw new Error('case_graph_rarity_invalid');
  }
  const rarity = buildCaseGraphRarityFromDocumentFrequency(
    raw.documentFrequency,
    raw.documentCount,
    raw.corpusVersion,
  );
  if (JSON.stringify(rarity) !== JSON.stringify(raw)) throw new Error('case_graph_rarity_invalid');
  return rarity;
};

/**
 * Reads only the authenticated archive descriptor. Callers which consume each
 * feature part themselves can then verify every shard exactly once.
 */
export const readCaseGraphFeatureArchiveDescriptor = async (
  storage: CaseGraphArchiveStorage,
  corpusVersion: string,
): Promise<{
  completion: CaseGraphFeatureCompletionManifest;
  completionBody: Buffer;
  rarity: CaseGraphCorpusRarity;
}> => {
  const keys = getCaseGraphFeatureControlKeys(corpusVersion);
  const completionBody = await storage.readObject(keys.completionManifestKey);
  if (!completionBody) throw new Error('case_graph_feature_completion_missing');
  const completion = parseCompletion(completionBody, corpusVersion);
  const rarity = await validateRarity(storage, completion);
  return { completion, completionBody, rarity };
};

const validateCompletionArtifacts = async (
  storage: CaseGraphArchiveStorage,
  completion: CaseGraphFeatureCompletionManifest,
) => {
  await verifyStoredParts(storage, completion.parts, completion.corpus_version);
  return validateRarity(storage, completion);
};

const conditionalStorage = (storage: CaseGraphArchiveStorage): CaseGraphConditionalArchiveStorage => {
  const candidate = storage as Partial<CaseGraphConditionalArchiveStorage>;
  if (typeof candidate.readObjectVersioned !== 'function' || typeof candidate.uploadFileConditional !== 'function') {
    throw new Error('case_graph_feature_conditional_storage_required');
  }
  return storage as CaseGraphConditionalArchiveStorage;
};

const writeImmutable = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  body: Buffer,
  options: UploadOptions,
  conflictCode: string,
) => {
  const result = await storage.uploadFileConditional(body, key, options, { ifAbsent: true });
  if (result.status === 'precondition_failed') {
    const existing = await storage.readObject(key);
    if (!existing || !existing.equals(body)) throw new Error(conflictCode);
  }
  const stored = await storage.readObject(key);
  if (!stored || !stored.equals(body)) throw new Error(`${conflictCode}_read_after_write_failed`);
};

const writeCheckpoint = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  checkpoint: CaseGraphFeatureCheckpoint,
  version: string | null,
) => {
  const body = jsonBody(checkpoint);
  const result = await storage.uploadFileConditional(body, key, {
    contentType: 'application/json',
    cacheControl: 'private, no-store',
    contentLength: body.length,
  }, version === null ? { ifAbsent: true } : { ifVersion: version });
  if (result.status === 'precondition_failed') throw new Error('case_graph_checkpoint_write_conflict');
  const stored = await storage.readObjectVersioned(key);
  if (!stored || !stored.body.equals(body) || stored.version !== result.version) {
    throw new Error('case_graph_checkpoint_read_after_write_failed');
  }
  return result.version;
};

const assertCurrentSource = (
  expected: CaseGraphSourceStats,
  binding: CaseGraphFeatureArchiveBinding,
  current: CaseGraphSourceStats,
  currentBinding: CaseGraphFeatureArchiveBinding,
  code: string,
) => {
  if (!sourceStatsEqual(expected, current) || !bindingEqual(binding, currentBinding)) throw new Error(code);
};

export const readVerifiedCaseGraphFeatureArchive = async (
  storage: CaseGraphArchiveStorage,
  corpusVersion: string,
): Promise<{ completion: CaseGraphFeatureCompletionManifest; rarity: CaseGraphCorpusRarity }> => {
  const keys = getCaseGraphFeatureControlKeys(corpusVersion);
  const completionBody = await storage.readObject(keys.completionManifestKey);
  if (!completionBody) throw new Error('case_graph_feature_completion_missing');
  const completion = parseCompletion(completionBody, corpusVersion);
  const rarity = await validateCompletionArtifacts(storage, completion);
  return { completion, rarity };
};

export const archiveCaseGraphFeatures = async (params: {
  corpusVersion: string;
  source: CaseGraphFeatureSource;
  storage: CaseGraphConditionalArchiveStorage;
  universeBinding?: CaseGraphFeatureUniverseBinding | null;
  pageSize?: number;
  maxPartsPerRun?: number;
  now?: () => Date;
}) => {
  const pageSize = Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE);
  const maxPartsPerRun = Math.trunc(params.maxPartsPerRun ?? DEFAULT_MAX_PARTS_PER_RUN);
  if (pageSize < 1 || pageSize > 25_000) throw new Error('case_graph_page_size_invalid');
  if (maxPartsPerRun < 1 || maxPartsPerRun > 100) throw new Error('case_graph_max_parts_invalid');
  const storage = conditionalStorage(params.storage);
  const now = params.now || (() => new Date());
  const keys = getCaseGraphFeatureControlKeys(params.corpusVersion);
  const universeBinding = normalizeUniverseBinding(params.universeBinding);

  // Inspect before consulting resumable/publication state. A completion may only
  // be reused while the immutable database receipt still matches byte-for-byte.
  const currentStats = normalizeSourceStats(await params.source.inspectEligibleSnapshot());
  const currentBinding = buildBinding(currentStats, universeBinding);
  const completionBody = await storage.readObject(keys.completionManifestKey);
  if (completionBody) {
    const completion = parseCompletion(completionBody, params.corpusVersion);
    assertCurrentSource(
      completion.expected,
      completion.binding,
      currentStats,
      currentBinding,
      'case_graph_source_changed_since_completion',
    );
    await validateCompletionArtifacts(storage, completion);
    return { status: 'already_complete' as const, completion };
  }

  const checkpointObject = await storage.readObjectVersioned(keys.checkpointKey);
  let checkpointVersion = checkpointObject?.version || null;
  let checkpoint: CaseGraphFeatureCheckpoint;
  if (checkpointObject) {
    checkpoint = parseCheckpoint(checkpointObject.body, params.corpusVersion);
    assertCurrentSource(
      checkpoint.expected,
      checkpoint.binding,
      currentStats,
      currentBinding,
      'case_graph_source_changed_during_export',
    );
    await verifyStoredParts(storage, checkpoint.parts, params.corpusVersion);
  } else {
    checkpoint = {
      record_type: 'case_graph_feature_checkpoint',
      schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
      corpus_version: params.corpusVersion,
      binding: currentBinding,
      expected: currentStats,
      exported_row_count: 0,
      next_part_number: 0,
      cursor: null,
      parts: [],
      updated_at: now().toISOString(),
    };
  }

  let partsWritten = 0;
  while (checkpoint.exported_row_count < checkpoint.expected.eligible_count && partsWritten < maxPartsPerRun) {
    const page = await params.source.fetchEligiblePage(checkpoint.cursor, pageSize);
    if (!page.length) throw new Error('case_graph_source_ended_before_expected_count');
    if (page.length > pageSize) throw new Error('case_graph_source_page_limit_exceeded');
    let previous = checkpoint.cursor;
    for (const row of page) {
      const cursor = normalizeCursor(row.cursor, 'case_graph_source_page_cursor');
      if (previous && compareCaseGraphCursors(previous, cursor) >= 0) {
        throw new Error('case_graph_source_cursor_did_not_advance');
      }
      previous = cursor;
    }
    const built = buildCaseGraphFeaturePart({
      corpusVersion: params.corpusVersion,
      partNumber: checkpoint.next_part_number,
      rows: page,
      limits: { maxRows: pageSize },
    });
    if (checkpoint.exported_row_count + built.manifest.row_count > checkpoint.expected.eligible_count) {
      throw new Error('case_graph_source_exceeded_expected_count');
    }
    await writeImmutable(storage, built.manifest.archive_key, built.archiveBody, {
      contentType: built.manifest.archive_content_type,
      contentEncoding: built.manifest.archive_content_encoding,
      cacheControl: 'private, max-age=31536000, immutable',
      contentLength: built.archiveBody.length,
    }, 'case_graph_feature_archive_immutable_conflict');
    await writeImmutable(storage, built.manifest.manifest_key, built.manifestBody, {
      contentType: 'application/json',
      cacheControl: 'private, max-age=31536000, immutable',
      contentLength: built.manifestBody.length,
    }, 'case_graph_feature_manifest_immutable_conflict');
    const partSummary = normalizePartSummary(partSummaryFromManifest(built.manifest), params.corpusVersion);
    await verifyStoredPart(storage, partSummary, params.corpusVersion);
    checkpoint = {
      ...checkpoint,
      exported_row_count: checkpoint.exported_row_count + built.manifest.row_count,
      next_part_number: checkpoint.next_part_number + 1,
      cursor: built.manifest.last_cursor,
      parts: [...checkpoint.parts, partSummary],
      updated_at: now().toISOString(),
    };
    checkpointVersion = await writeCheckpoint(storage, keys.checkpointKey, checkpoint, checkpointVersion);
    partsWritten += 1;
  }

  const finalStats = normalizeSourceStats(await params.source.inspectEligibleSnapshot());
  const finalBinding = buildBinding(finalStats, universeBinding);
  assertCurrentSource(
    checkpoint.expected,
    checkpoint.binding,
    finalStats,
    finalBinding,
    'case_graph_source_changed_during_export',
  );
  if (checkpoint.exported_row_count < checkpoint.expected.eligible_count) {
    return {
      status: 'partial' as const,
      checkpoint,
      remaining_rows: checkpoint.expected.eligible_count - checkpoint.exported_row_count,
    };
  }

  await verifyStoredParts(storage, checkpoint.parts, params.corpusVersion);
  const sourceCounts = sumCountMaps(checkpoint.parts.map((part) => part.source_counts));
  if (JSON.stringify(sourceCounts) !== JSON.stringify(checkpoint.expected.source_counts)) {
    throw new Error('case_graph_exported_source_counts_mismatch');
  }
  if (
    JSON.stringify(checkpoint.parts[0]?.first_cursor || null) !== JSON.stringify(checkpoint.expected.min_cursor)
    || JSON.stringify(checkpoint.parts.at(-1)?.last_cursor || null) !== JSON.stringify(checkpoint.expected.max_cursor)
  ) throw new Error('case_graph_exported_cursor_bounds_mismatch');

  const termFrequency = sumCountMaps(checkpoint.parts.map((part) => part.term_document_frequency));
  const rarity = buildCaseGraphRarityFromDocumentFrequency(
    termFrequency,
    checkpoint.exported_row_count,
    params.corpusVersion,
  );
  const rarityBody = jsonBody(rarity);
  await writeImmutable(storage, keys.rarityKey, rarityBody, {
    contentType: 'application/json',
    cacheControl: 'private, max-age=31536000, immutable',
    contentLength: rarityBody.length,
  }, 'case_graph_rarity_immutable_conflict');

  const completion: CaseGraphFeatureCompletionManifest = {
    record_type: 'case_graph_feature_completion_manifest',
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    binding: checkpoint.binding,
    expected: checkpoint.expected,
    exported_row_count: checkpoint.exported_row_count,
    part_count: checkpoint.parts.length,
    parts: checkpoint.parts,
    archive_set_sha256: getCaseGraphFeatureArchiveSetSha256(checkpoint.parts, checkpoint.binding),
    rarity_key: keys.rarityKey,
    rarity_sha256: sha256(rarityBody),
    completed_at: now().toISOString(),
  };
  const completionOutput = jsonBody(completion);
  await writeImmutable(storage, keys.completionManifestKey, completionOutput, {
    contentType: 'application/json',
    cacheControl: 'private, max-age=31536000, immutable',
    contentLength: completionOutput.length,
  }, 'case_graph_completion_immutable_conflict');
  const storedCompletion = await storage.readObject(keys.completionManifestKey);
  if (!storedCompletion || !storedCompletion.equals(completionOutput)) {
    throw new Error('case_graph_completion_read_after_write_failed');
  }
  const verifiedCompletion = parseCompletion(storedCompletion, params.corpusVersion);
  await validateCompletionArtifacts(storage, verifiedCompletion);
  return { status: 'complete' as const, completion: verifiedCompletion };
};
