import type { CaseGraphContentLocator, CaseGraphContentMediaKind, CaseGraphContentTextOrigin } from './contentResearchArchive';
import { parseCaseGraphEvidenceAddress } from './publicAccess';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_CONTENT_POSTGRES_SEARCH_VERSION = 'case-graph-content-postgres-search-v1' as const;
export const CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS = Object.freeze({
  maximumQueryCharacters: 500,
  maximumQueryTerms: 24,
  maximumResults: 50,
  timeoutMs: 5_000,
} as const);

export type CaseGraphContentServingBinding = {
  publication: CaseGraphResearchPublicationBinding;
  accountingReceiptDigest: string;
  indexManifestDigest: string;
  expectedEntryCount: number;
};

export type CaseGraphContentSearchCursorBoundary = { scoreMicros: number; chunkId: string };

export type CaseGraphContentSearchResultEntry = {
  chunkId: string;
  chunkDigest: string;
  address: string;
  assetId: string;
  assetDigest: string;
  extractionContractDigest: string;
  extractionReceiptDigest: string;
  extractionPointerDigest: string;
  mediaKind: CaseGraphContentMediaKind;
  textOrigin: CaseGraphContentTextOrigin;
  locator: CaseGraphContentLocator;
  text: string;
  language: string;
  confidence: number | null;
  scoreMicros: number;
};

export type CaseGraphContentPostgresQuery = (
  sql: string,
  params: readonly unknown[],
  options: { statementTimeoutMs: number; queryTimeoutMs: number; signal?: AbortSignal },
) => Promise<{ rows: Record<string, unknown>[] }>;

const fail = (code: string): never => { throw new Error(code); };
const SHA256 = /^[a-f0-9]{64}$/;
const CHUNK_ID = /^content-chunk:[a-f0-9]{64}$/;
const MEDIA_KINDS: readonly CaseGraphContentMediaKind[] = ['document', 'image', 'audio', 'video'];
const TEXT_ORIGINS: readonly CaseGraphContentTextOrigin[] = [
  'embedded_text', 'ocr', 'asr', 'human_transcript', 'machine_caption', 'frame_ocr', 'exif',
];

const queryValue = (value: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.maximumQueryCharacters
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('case_graph_content_search_query_invalid');
  const terms = value.trim().split(/\s+/u);
  if (terms.length > CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.maximumQueryTerms) {
    fail('case_graph_content_search_query_invalid');
  }
  return value.trim();
};

const safeInteger = (value: unknown, minimum: number, maximum: number, code: string) => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < minimum || Number(numeric) > maximum) fail(code);
  return Number(numeric);
};

const stringValue = (value: unknown, maximum: number, code: string): string => {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > maximum) fail(code);
  return value as string;
};

const digestValue = (value: unknown): string => {
  const result = stringValue(value, 64, 'case_graph_content_search_row_invalid');
  if (!SHA256.test(result)) fail('case_graph_content_search_row_invalid');
  return result;
};

const boundingBoxValue = (value: unknown): [number, number, number, number] | null => {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => typeof entry !== 'number')) {
    fail('case_graph_content_search_row_invalid');
  }
  const [x, y, width, height] = value as number[];
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > 1 || y + height > 1) fail('case_graph_content_search_row_invalid');
  return [x, y, width, height];
};

const locatorValue = (value: unknown): CaseGraphContentLocator => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('case_graph_content_search_row_invalid');
  const locator = value as Record<string, unknown>;
  if (locator.locatorType === 'document_page') {
    return {
      locatorType: 'document_page',
      pageNumber: safeInteger(locator.pageNumber, 1, 1_000_000, 'case_graph_content_search_row_invalid'),
      characterStart: safeInteger(locator.characterStart, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_row_invalid'),
      characterEnd: safeInteger(locator.characterEnd, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_row_invalid'),
      readingOrder: safeInteger(locator.readingOrder, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_row_invalid'),
      boundingBox: boundingBoxValue(locator.boundingBox),
    };
  }
  if (locator.locatorType === 'image_region') return {
    locatorType: 'image_region',
    regionLabel: locator.regionLabel === null ? null
      : stringValue(locator.regionLabel, 1_024, 'case_graph_content_search_row_invalid'),
    boundingBox: boundingBoxValue(locator.boundingBox),
  };
  if (locator.locatorType === 'timed_media') {
    const startMs = safeInteger(locator.startMs, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_row_invalid');
    const endMs = safeInteger(locator.endMs, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_row_invalid');
    if (endMs <= startMs) fail('case_graph_content_search_row_invalid');
    const keyframeMs = locator.keyframeMs === null ? null
      : safeInteger(locator.keyframeMs, startMs, endMs, 'case_graph_content_search_row_invalid');
    return {
      locatorType: 'timed_media', startMs, endMs, keyframeMs,
      speaker: locator.speaker === null ? null
        : stringValue(locator.speaker, 1_024, 'case_graph_content_search_row_invalid'),
      channel: locator.channel === null ? null
        : stringValue(locator.channel, 1_024, 'case_graph_content_search_row_invalid'),
    };
  }
  if (locator.locatorType === 'exif_field' && typeof locator.field === 'string' && locator.field.length) {
    return { locatorType: 'exif_field', field: locator.field };
  }
  return fail('case_graph_content_search_row_invalid');
};

export const decodeCaseGraphContentSearchRow = (row: Record<string, unknown>): CaseGraphContentSearchResultEntry => {
  const chunkId = stringValue(row.chunk_id, 128, 'case_graph_content_search_row_invalid');
  if (!CHUNK_ID.test(chunkId)) fail('case_graph_content_search_row_invalid');
  if (!MEDIA_KINDS.includes(row.media_kind as CaseGraphContentMediaKind)
    || !TEXT_ORIGINS.includes(row.text_origin as CaseGraphContentTextOrigin)
    || typeof row.locator !== 'object' || row.locator === null || Array.isArray(row.locator)) {
    fail('case_graph_content_search_row_invalid');
  }
  const confidence = row.confidence === null ? null : Number(row.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    fail('case_graph_content_search_row_invalid');
  }
  const mediaKind = row.media_kind as CaseGraphContentMediaKind;
  const textOrigin = row.text_origin as CaseGraphContentTextOrigin;
  const locator = locatorValue(row.locator);
  const compatible = ((mediaKind === 'document' && ['embedded_text', 'ocr'].includes(textOrigin)
    && locator.locatorType === 'document_page')
    || (mediaKind === 'image' && ['machine_caption', 'frame_ocr'].includes(textOrigin)
      && locator.locatorType === 'image_region')
    || (mediaKind === 'image' && textOrigin === 'exif' && locator.locatorType === 'exif_field')
    || (['audio', 'video'].includes(mediaKind) && ['asr', 'human_transcript'].includes(textOrigin)
      && locator.locatorType === 'timed_media')
    || (mediaKind === 'video' && ['machine_caption', 'frame_ocr'].includes(textOrigin)
      && locator.locatorType === 'timed_media' && locator.keyframeMs !== null));
  if (!compatible) fail('case_graph_content_search_row_invalid');
  return {
    chunkId,
    chunkDigest: digestValue(row.chunk_digest),
    address: parseCaseGraphEvidenceAddress(
      stringValue(row.address, 1_024, 'case_graph_content_search_row_invalid'),
    ).address,
    assetId: stringValue(row.asset_id, 128, 'case_graph_content_search_row_invalid'),
    assetDigest: digestValue(row.asset_digest),
    extractionContractDigest: digestValue(row.extraction_contract_digest),
    extractionReceiptDigest: digestValue(row.extraction_receipt_digest),
    extractionPointerDigest: digestValue(row.extraction_pointer_digest),
    mediaKind,
    textOrigin,
    locator,
    text: stringValue(row.text, 16 * 1024 * 1024, 'case_graph_content_search_row_invalid'),
    language: stringValue(row.language, 64, 'case_graph_content_search_row_invalid'),
    confidence,
    scoreMicros: safeInteger(row.score_micros, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_row_invalid'),
  };
};

const bindingValues = (binding: CaseGraphContentServingBinding) => {
  if (!SHA256.test(binding.publication.manifestSha256)
    || !SHA256.test(binding.accountingReceiptDigest) || !SHA256.test(binding.indexManifestDigest)) {
    fail('case_graph_content_search_binding_invalid');
  }
  return [
    binding.publication.publicationId,
    binding.publication.manifestSha256,
    binding.accountingReceiptDigest,
    binding.indexManifestDigest,
    safeInteger(binding.expectedEntryCount, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_search_binding_invalid'),
  ] as const;
};

const SEARCH_SQL = `
WITH query_input AS (
  SELECT pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig, $6::text) AS query
), ranked AS (
  SELECT chunk.*,
    pg_catalog.floor(pg_catalog.ts_rank_cd(chunk.search_vector, query_input.query, 32) * 1000000)::bigint AS score_micros
  FROM public.case_graph_content_search_chunks AS chunk
  JOIN public.case_graph_content_search_builds AS build ON build.publication_id = chunk.publication_id
  CROSS JOIN query_input
  WHERE build.publication_id = $1::uuid AND build.public_manifest_sha256 = $2::text
    AND build.accounting_receipt_digest = $3::text AND build.index_manifest_digest = $4::text
    AND build.expected_entry_count = $5::bigint AND build.status = 'verified'
    AND chunk.search_vector @@ query_input.query
    AND chunk.media_kind = ANY($7::text[]) AND chunk.text_origin = ANY($8::text[])
)
SELECT * FROM ranked
WHERE ($9::bigint IS NULL OR score_micros < $9::bigint OR (score_micros = $9::bigint AND chunk_id > $10::text))
ORDER BY score_micros DESC, chunk_id COLLATE "C" ASC
LIMIT $11::integer`;

export const createCaseGraphContentPostgresSearch = (query: CaseGraphContentPostgresQuery) => ({
  search: async (params: {
    binding: CaseGraphContentServingBinding;
    query: string;
    mediaKinds?: CaseGraphContentMediaKind[];
    textOrigins?: CaseGraphContentTextOrigin[];
    limit?: number;
    after?: CaseGraphContentSearchCursorBoundary | null;
    signal?: AbortSignal;
  }) => {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const binding = bindingValues(params.binding);
    const mediaKinds = params.mediaKinds || [...MEDIA_KINDS];
    const textOrigins = params.textOrigins || [...TEXT_ORIGINS];
    if (!mediaKinds.length || mediaKinds.some((value) => !MEDIA_KINDS.includes(value))
      || !textOrigins.length || textOrigins.some((value) => !TEXT_ORIGINS.includes(value))) {
      fail('case_graph_content_search_filters_invalid');
    }
    const limit = safeInteger(params.limit ?? 20, 1, CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.maximumResults,
      'case_graph_content_search_limit_invalid');
    const after = params.after || null;
    if (after && (!CHUNK_ID.test(after.chunkId)
      || !Number.isSafeInteger(after.scoreMicros) || after.scoreMicros < 0)) {
      fail('case_graph_content_search_cursor_invalid');
    }
    const result = await query(SEARCH_SQL, [
      ...binding, queryValue(params.query), mediaKinds, textOrigins,
      after?.scoreMicros ?? null, after?.chunkId ?? null, limit + 1,
    ], {
      statementTimeoutMs: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.timeoutMs,
      queryTimeoutMs: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.timeoutMs,
      signal: params.signal,
    });
    const entries = result.rows.map(decodeCaseGraphContentSearchRow);
    const hasMore = entries.length > limit;
    const page = entries.slice(0, limit);
    const last = page.at(-1);
    return {
      entries: page,
      hasMore,
      nextBoundary: hasMore && last ? { scoreMicros: last.scoreMicros, chunkId: last.chunkId } : null,
    };
  },
  open: async (params: {
    binding: CaseGraphContentServingBinding;
    chunkId: string;
    signal?: AbortSignal;
  }) => {
    if (!CHUNK_ID.test(params.chunkId)) fail('case_graph_content_search_chunk_id_invalid');
    const result = await query(`
SELECT chunk.*, 0::bigint AS score_micros
FROM public.case_graph_content_search_chunks AS chunk
JOIN public.case_graph_content_search_builds AS build ON build.publication_id = chunk.publication_id
WHERE build.publication_id = $1::uuid AND build.public_manifest_sha256 = $2::text
  AND build.accounting_receipt_digest = $3::text AND build.index_manifest_digest = $4::text
  AND build.expected_entry_count = $5::bigint AND build.status = 'verified'
  AND chunk.chunk_id = $6::text
LIMIT 1`, [...bindingValues(params.binding), params.chunkId], {
      statementTimeoutMs: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.timeoutMs,
      queryTimeoutMs: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.timeoutMs,
      signal: params.signal,
    });
    return result.rows.length === 1 ? decodeCaseGraphContentSearchRow(result.rows[0]) : null;
  },
});
