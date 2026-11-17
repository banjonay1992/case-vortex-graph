import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getCaseGraphFeatureKeys } from './archiveKeys';
import {
  CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
  type CaseGraphCursor,
  type CaseGraphFeatureArchiveBinding,
  type CaseGraphFeaturePartManifest,
  type CaseGraphSourceRow,
} from './archiveTypes';
import { CASE_GRAPH_FEATURE_SCHEMA_VERSION, extractCaseGraphFeatures, type CaseGraphFeatureRecord } from './featureExtraction';

const DEFAULT_MAX_ROWS = 25_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type CaseGraphFeaturePartLimits = {
  maxRows: number;
  maxUncompressedBytes: number;
  maxCompressedBytes: number;
};

const toIso = (value: string, label: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
};

const normalizeCursor = (cursor: CaseGraphCursor): CaseGraphCursor => {
  const caseId = String(cursor.case_id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(caseId)) {
    throw new Error('case_graph_cursor_case_id_invalid');
  }
  return { updated_at: toIso(cursor.updated_at, 'case_graph_cursor_updated_at'), case_id: caseId };
};

export const compareCaseGraphCursors = (left: CaseGraphCursor, right: CaseGraphCursor) => (
  left.updated_at.localeCompare(right.updated_at) || left.case_id.localeCompare(right.case_id)
);

const recordTerms = (record: CaseGraphFeatureRecord) => new Set([
  ...record.traits.visual,
  ...record.traits.behaviour,
  ...record.traits.sensory,
  ...record.traits.entities,
  ...record.traits.keywords,
].map((item) => item.term));

export const getCaseGraphFeatureArchiveSetSha256 = (
  parts: readonly (Pick<CaseGraphFeaturePartManifest, 'part_number' | 'compressed_sha256'>
    & Partial<Pick<CaseGraphFeaturePartManifest,
      'row_count' | 'first_cursor' | 'last_cursor' | 'uncompressed_sha256'>>)[],
  binding: CaseGraphFeatureArchiveBinding | null = null,
) => createHash('sha256')
  .update(JSON.stringify({
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    binding,
    parts: [...parts]
      .sort((a, b) => a.part_number - b.part_number)
      .map((part) => ({
        part_number: part.part_number,
        row_count: part.row_count ?? null,
        first_cursor: part.first_cursor ?? null,
        last_cursor: part.last_cursor ?? null,
        uncompressed_sha256: part.uncompressed_sha256 ?? null,
        compressed_sha256: part.compressed_sha256,
      })),
  }))
  .digest('hex');

export const buildCaseGraphFeaturePart = (params: {
  corpusVersion: string;
  partNumber: number;
  rows: readonly CaseGraphSourceRow[];
  limits?: Partial<CaseGraphFeaturePartLimits>;
}) => {
  const limits: CaseGraphFeaturePartLimits = {
    maxRows: DEFAULT_MAX_ROWS,
    maxUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
    maxCompressedBytes: DEFAULT_MAX_COMPRESSED_BYTES,
    ...params.limits,
  };
  if (!params.rows.length) throw new Error('case_graph_feature_part_empty');
  if (params.rows.length > limits.maxRows) throw new Error('case_graph_feature_part_row_limit_exceeded');
  const rows = params.rows.map((row) => ({ ...row, cursor: normalizeCursor(row.cursor) }))
    .sort((left, right) => compareCaseGraphCursors(left.cursor, right.cursor));
  const features: CaseGraphFeatureRecord[] = [];
  const sourceCounts: Record<string, number> = {};
  const termDocumentFrequency: Record<string, number> = {};
  let completenessSum = 0;
  let previousCursor: CaseGraphCursor | null = null;
  for (const row of rows) {
    if (previousCursor && compareCaseGraphCursors(previousCursor, row.cursor) >= 0) {
      throw new Error('case_graph_feature_part_cursor_not_strictly_increasing');
    }
    previousCursor = row.cursor;
    if (String(row.sighting.id || '').trim().toLowerCase() !== row.cursor.case_id) {
      throw new Error('case_graph_feature_part_cursor_id_mismatch');
    }
    const extracted = extractCaseGraphFeatures(row.sighting, {
      corpusVersion: params.corpusVersion,
      eligibility: { eligible: true },
    });
    if (extracted.status !== 'included') throw new Error(`case_graph_eligible_row_excluded:${extracted.reason}`);
    features.push(extracted);
    sourceCounts[extracted.source] = (sourceCounts[extracted.source] || 0) + 1;
    completenessSum += extracted.completeness.score;
    for (const term of recordTerms(extracted)) {
      termDocumentFrequency[term] = (termDocumentFrequency[term] || 0) + 1;
    }
  }
  const lines = features.map((feature) => `${JSON.stringify(feature)}\n`).join('');
  const uncompressedBytes = Buffer.byteLength(lines, 'utf8');
  if (uncompressedBytes > limits.maxUncompressedBytes) {
    throw new Error('case_graph_feature_part_uncompressed_limit_exceeded');
  }
  const archiveBody = gzipSync(Buffer.from(lines, 'utf8'), { level: 6 });
  if (archiveBody.length > limits.maxCompressedBytes) {
    throw new Error('case_graph_feature_part_compressed_limit_exceeded');
  }
  const { archiveKey, manifestKey } = getCaseGraphFeatureKeys(params.corpusVersion, params.partNumber);
  const manifest: CaseGraphFeaturePartManifest = {
    record_type: 'case_graph_feature_part_manifest',
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    feature_schema_version: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
    part_number: params.partNumber,
    archive_key: archiveKey,
    manifest_key: manifestKey,
    archive_content_type: 'application/x-ndjson',
    archive_content_encoding: 'gzip',
    row_count: features.length,
    first_cursor: rows[0].cursor,
    last_cursor: rows[rows.length - 1].cursor,
    source_counts: Object.fromEntries(Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b))),
    term_document_frequency: Object.fromEntries(
      Object.entries(termDocumentFrequency).sort(([a], [b]) => a.localeCompare(b)),
    ),
    completeness_sum: Number(completenessSum.toFixed(4)),
    uncompressed_bytes: uncompressedBytes,
    uncompressed_sha256: createHash('sha256').update(lines, 'utf8').digest('hex'),
    compressed_bytes: archiveBody.length,
    compressed_sha256: createHash('sha256').update(archiveBody).digest('hex'),
  };
  return {
    archiveBody,
    manifest,
    manifestBody: Buffer.from(`${JSON.stringify(manifest)}\n`),
    features,
  };
};

export const decodeCaseGraphFeaturePart = (
  body: Buffer,
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
  expectedCorpusVersion?: string,
): CaseGraphFeatureRecord[] => {
  const uncompressed = gunzipSync(body, { maxOutputLength: maxUncompressedBytes });
  return uncompressed.toString('utf8').split('\n').filter(Boolean).map((line) => {
    let value: CaseGraphFeatureRecord;
    try {
      value = JSON.parse(line) as CaseGraphFeatureRecord;
    } catch {
      throw new Error('case_graph_feature_archive_record_invalid');
    }
    const traitGroups = value?.traits && typeof value.traits === 'object'
      ? Object.values(value.traits)
      : [];
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || value.status !== 'included'
      || value.schemaVersion !== CASE_GRAPH_FEATURE_SCHEMA_VERSION
      || (expectedCorpusVersion !== undefined && value.corpusVersion !== expectedCorpusVersion)
      || !UUID_PATTERN.test(String(value.caseId || '').toLowerCase())
      || typeof value.source !== 'string'
      || !value.source.trim()
      || typeof value.sourceUpdatedAt !== 'string'
      || toIso(value.sourceUpdatedAt, 'case_graph_feature_source_updated_at') !== value.sourceUpdatedAt
      || !value.completeness
      || typeof value.completeness !== 'object'
      || !Number.isFinite(value.completeness.score)
      || value.completeness.score < 0
      || value.completeness.score > 1
      || !Array.isArray(value.completeness.missing)
      || traitGroups.length !== 5
      || traitGroups.some((group) => !Array.isArray(group))
    ) {
      throw new Error('case_graph_feature_archive_record_invalid');
    }
    return value;
  });
};

export const getCaseGraphFeatureRecordCursor = (record: CaseGraphFeatureRecord): CaseGraphCursor => ({
  updated_at: toIso(String(record.sourceUpdatedAt || ''), 'case_graph_feature_source_updated_at'),
  case_id: String(record.caseId || '').trim().toLowerCase(),
});
