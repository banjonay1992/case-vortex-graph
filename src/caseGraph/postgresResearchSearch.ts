import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { getCaseGraphResearchSearchPostgresReceiptKey } from './archiveKeys';
import type { CaseGraphPublicStorage } from './publicAccess';
import {
  parseCaseGraphEvidenceAddress,
  type ActiveCaseGraphPublication,
} from './publicAccess';
import {
  CASE_GRAPH_RESEARCH_LIMITS,
  CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
  caseGraphResearchPublicationBinding,
  decodeCaseGraphResearchToolRequest,
  type CaseGraphResearchSearchCandidates,
  type CaseGraphResearchSearchProvider,
  type CaseGraphResearchToolRequest,
} from './researchToolContract';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';
import type {
  FullCorpusPublicNode,
  FullCorpusPublicRelationshipStatus,
} from './typedRelationshipPublicGraph';
import {
  resolveCaseGraphSource,
} from './sourceRegistry';
import {
  FULL_CORPUS_SEARCH_TOKENIZER_VERSION,
  isFullCorpusSearchPostgresCanonicalEventTimestamp,
} from './fullCorpusProductionCompatibility';

export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION = 'case-graph-research-search-postgres-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION = FULL_CORPUS_SEARCH_TOKENIZER_VERSION;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION = 'ts-rank-cd-field-weight-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION = 'case-graph-research-search-gin-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_NAME = 'case_graph_research_search_documents_search_vector_gin_idx' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_LOGICAL_DEFINITION = 'case_graph_research_search_documents.search_vector|using=gin|opclass=tsvector_ops|predicate=none|expressions=none' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256 = createHash('sha256')
  .update(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_LOGICAL_DEFINITION)
  .digest('hex');

export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RECEIPT_BYTES = 64 * 1024;
// Common lexical terms can legitimately touch much of the immutable corpus.
// Keep this distinct from the much cheaper preflight and still finitely bound.
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS = 10_000;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_PREFLIGHT_TIMEOUT_MS = 1_500;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SHARED_PREFLIGHT_TIMEOUT_MS = 5_000;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_QUERY_TERMS = 24;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES = 5_000;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_VERSION = 'case-graph-research-search-postgres-cursor-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SORT_VERSION = 'score-micros-desc-address-c-asc-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_CURSOR_BYTES = 4_096;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_TOKENIZER_VERSION_CHARACTERS = 256;
// Public record ids are bounded at 240 characters; the longest governed kind
// prefix adds nine more (`sighting:`/`document:`). Keep one explicit search
// address envelope above that canonical maximum and below PostgreSQL's wider
// defensive byte constraint.
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS = 256;
const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_HASH_DOMAIN = 'case-graph-research-search-postgres-cursor-v1\0';

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KINDS: readonly EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const STATUSES = ['linked', 'candidate_only', 'isolated'] as const;
const SEARCH_FIELDS = ['address', 'title', 'summary', 'source', 'location', 'event_timestamp'] as const;
type SearchField = typeof SEARCH_FIELDS[number];
type SearchRequest = Extract<CaseGraphResearchToolRequest, { tool: 'search_records' }>;

type CaseGraphResearchSearchPostgresCursorPayload = {
  schemaVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_VERSION;
  publicationBindingDigest: string;
  completionReceiptSha256: string;
  searchScopeDigest: string;
  sortVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SORT_VERSION;
  scoreMicros: number;
  address: string;
};

export type PostgresCaseGraphResearchSearchQueryOptions = {
  queryTimeoutMs: number;
  statementTimeoutMs: number;
  signal?: AbortSignal;
};

export type PostgresCaseGraphResearchSearchQueryResult = {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
};

/**
 * A deliberately narrow host adapter. Implementations must enforce
 * `statementTimeoutMs` inside PostgreSQL and propagate `signal` to real backend
 * cancellation. A node-postgres `query_timeout`/client read timer alone is not
 * sufficient: timed-out work must stop on the server before the connection is
 * reused. `queryTimeoutMs` remains an additional client-side ceiling.
 */
export type PostgresCaseGraphResearchSearchQuery = (
  sql: string,
  params: readonly unknown[],
  options: PostgresCaseGraphResearchSearchQueryOptions,
) => Promise<PostgresCaseGraphResearchSearchQueryResult>;

export type CaseGraphResearchSearchPostgresBinding = {
  publicationId: string;
  corpusVersion: string;
  snapshotId: string;
  publicManifestSha256: string;
  publicManifestDigest: string;
  graphArtifactSetSha256: string;
  publicNodeSetSha256: string;
  expectedRecordCount: number;
};

export type CaseGraphResearchSearchPostgresSentinel = {
  kind: EvidenceUniverseNodeKind;
  address: string;
  nodeDigest: string;
};

export type CaseGraphResearchSearchPostgresAccounting = {
  sourceShardCount: number;
  indexedRecordCount: number;
};

export type CaseGraphResearchSearchPostgresCompletionReceipt = {
  recordType: 'case_graph_research_search_postgres_completion_receipt';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION;
  binding: CaseGraphResearchSearchPostgresBinding;
  tokenizerVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION;
  rankingVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION;
  indexDefinitionVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION;
  indexDefinitionSha256: string;
  sourceShardSetSha256: string;
  dbNodeSetSha256: string;
  searchContentSetSha256: string;
  accounting: CaseGraphResearchSearchPostgresAccounting;
  sentinels: CaseGraphResearchSearchPostgresSentinel[];
};

export type CaseGraphResearchSearchPostgresPreflight = {
  verified: true;
  receiptKey: string;
  receiptSha256: string;
  receipt: CaseGraphResearchSearchPostgresCompletionReceipt;
};

export type CaseGraphResearchSearchPostgresDocument = {
  nodeDigest: string;
  address: string;
  kind: EvidenceUniverseNodeKind;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  sourceKey: string;
  sourceNorm: string;
  eventTimestamp: string | null;
  eventTimestampNorm: string;
  addressNorm: string;
  titleNorm: string;
  locationNorm: string;
  summaryNorm: string;
  contentDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!isObject(value)) return fail(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
};
const text = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string' || !value.length || value.length > maximum) return fail(code);
  return value;
};
const digest = (value: unknown, code: string) => {
  const result = text(value, 64, code).toLowerCase();
  if (!SHA256.test(result)) fail(code);
  return result;
};
const uuid = (value: unknown, code: string) => {
  const result = text(value, 36, code).toLowerCase();
  if (!UUID.test(result)) fail(code);
  return result;
};
const safeCount = (value: unknown, maximum: number, code: string) => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0 || Number(numeric) > maximum) fail(code);
  return Number(numeric);
};
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const compareUtf8 = (left: string, right: string) => Buffer.compare(
  Buffer.from(left, 'utf8'),
  Buffer.from(right, 'utf8'),
);
const isAsciiAddress = (value: string) => /^[\x21-\x7e]+$/.test(value);
const isCanonicalSourceKey = (value: string) => /^[a-z0-9][a-z0-9._:/-]{0,239}$/.test(value);
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail('case_graph_research_aborted');
};
const isPostgresTimeout = (error: unknown) => {
  if (typeof error === 'object' && error !== null
    && 'code' in error && String((error as { code?: unknown }).code) === '57014') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:statement|query).*timeout|timeout.*(?:statement|query)|canceling statement/i.test(message);
};

const waitForSharedPreflight = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  abort(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(new Error('case_graph_research_aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
};

const runSharedPreflightWithDeadline = async <T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('case_graph_research_search_postgres_preflight_timeout'));
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const caseGraphResearchSearchPostgresBinding = (
  active: ActiveCaseGraphPublication,
): CaseGraphResearchSearchPostgresBinding => ({
  publicationId: active.publicationId,
  corpusVersion: active.corpusVersion,
  snapshotId: active.manifest.lineage.snapshot.snapshotId,
  publicManifestSha256: active.manifestSha256,
  publicManifestDigest: active.manifest.lineage.publicGraph.manifestDigest,
  graphArtifactSetSha256: active.manifest.lineage.graph.artifactSetSha256,
  publicNodeSetSha256: active.manifest.lineage.publicGraph.nodeSetSha256,
  expectedRecordCount: active.manifest.accounting.indexedRecordCount,
});

export const normalizeCaseGraphResearchSearchPostgresText = (value: string | null) => (
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
);

/**
 * Projection rows are content-addressed by the immutable public node digest.
 * Any future change to this projection, source-registry semantics, or address
 * domain must change the bound tokenizer/projection version and use a deliberate
 * rebuild/table migration; old rows must never be silently cloned or reused.
 */
export const projectCaseGraphResearchSearchPostgresDocument = (
  node: FullCorpusPublicNode,
): CaseGraphResearchSearchPostgresDocument => {
  const { nodeDigest, ...withoutDigest } = node;
  const sourceKey = resolveCaseGraphSource(node.source).id;
  if (!SHA256.test(nodeDigest)
    || relationshipInputSha256(withoutDigest) !== nodeDigest
    || !isAsciiAddress(node.address)
    || parseCaseGraphEvidenceAddress(node.address).address !== node.address
    || !KINDS.includes(node.kind)
    || !STATUSES.includes(node.relationshipStatus)
    || !isCanonicalSourceKey(sourceKey)
    || (node.eventTimestamp !== null
      && !isFullCorpusSearchPostgresCanonicalEventTimestamp(node.eventTimestamp))) {
    fail('case_graph_research_search_postgres_source_node_invalid');
  }
  const withoutContentDigest = {
    nodeDigest,
    address: node.address,
    kind: node.kind,
    relationshipStatus: node.relationshipStatus,
    sourceKey,
    sourceNorm: normalizeCaseGraphResearchSearchPostgresText(node.source),
    eventTimestamp: node.eventTimestamp,
    eventTimestampNorm: normalizeCaseGraphResearchSearchPostgresText(node.eventTimestamp),
    addressNorm: normalizeCaseGraphResearchSearchPostgresText(node.address),
    titleNorm: normalizeCaseGraphResearchSearchPostgresText(node.title),
    locationNorm: normalizeCaseGraphResearchSearchPostgresText(node.location),
    summaryNorm: normalizeCaseGraphResearchSearchPostgresText(node.summary),
  };
  return {
    ...withoutContentDigest,
    contentDigest: relationshipInputSha256(withoutContentDigest),
  };
};

export const tokenizeCaseGraphResearchSearchPostgresQuery = (value: string) => {
  const normalized = normalizeCaseGraphResearchSearchPostgresText(value);
  const sourceTerms = normalized ? normalized.split(' ') : [];
  if (sourceTerms.some((term) => term.length > 96)) {
    fail('case_graph_research_search_query_term_too_long');
  }
  const terms = [...new Set(sourceTerms)].sort(compareText);
  if (!terms.length) fail('case_graph_research_search_query_invalid');
  if (terms.length > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_QUERY_TERMS) {
    fail('case_graph_research_search_query_terms_exceeded');
  }
  return { normalized, terms };
};

const decodeBinding = (value: unknown, code: string): CaseGraphResearchSearchPostgresBinding => {
  const object = exact(value, [
    'publicationId', 'corpusVersion', 'snapshotId', 'publicManifestSha256',
    'publicManifestDigest', 'graphArtifactSetSha256', 'publicNodeSetSha256',
    'expectedRecordCount',
  ], code);
  return {
    publicationId: uuid(object.publicationId, code),
    corpusVersion: text(object.corpusVersion, 240, code),
    snapshotId: text(object.snapshotId, 240, code),
    publicManifestSha256: digest(object.publicManifestSha256, code),
    publicManifestDigest: digest(object.publicManifestDigest, code),
    graphArtifactSetSha256: digest(object.graphArtifactSetSha256, code),
    publicNodeSetSha256: digest(object.publicNodeSetSha256, code),
    expectedRecordCount: safeCount(object.expectedRecordCount, 10_000_000, code),
  };
};

const decodeAccounting = (value: unknown, code: string): CaseGraphResearchSearchPostgresAccounting => {
  const object = exact(value, ['sourceShardCount', 'indexedRecordCount'], code);
  return {
    sourceShardCount: safeCount(object.sourceShardCount, 4096, code),
    indexedRecordCount: safeCount(object.indexedRecordCount, 10_000_000, code),
  };
};

const decodeSentinels = (value: unknown, code: string) => {
  if (!Array.isArray(value) || value.length > KINDS.length) fail(code);
  const sentinels = (value as unknown[]).map((entry): CaseGraphResearchSearchPostgresSentinel => {
    const object = exact(entry, ['kind', 'address', 'nodeDigest'], code);
    if (!KINDS.includes(object.kind as EvidenceUniverseNodeKind)) fail(code);
    const address = parseCaseGraphEvidenceAddress(text(
      object.address,
      CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
      code,
    )).address;
    return { kind: object.kind as EvidenceUniverseNodeKind, address, nodeDigest: digest(object.nodeDigest, code) };
  });
  if (sentinels.some((entry, index) => index > 0 && (
    compareText(sentinels[index - 1].kind, entry.kind) >= 0
  ))) fail(code);
  return sentinels;
};

export const decodeCaseGraphResearchSearchPostgresCompletionReceipt = (
  value: unknown,
): CaseGraphResearchSearchPostgresCompletionReceipt => {
  const code = 'case_graph_research_search_postgres_receipt_invalid';
  const object = exact(value, [
    'recordType', 'schemaVersion', 'binding', 'tokenizerVersion', 'rankingVersion',
    'indexDefinitionVersion', 'indexDefinitionSha256', 'sourceShardSetSha256',
    'dbNodeSetSha256', 'searchContentSetSha256', 'accounting', 'sentinels',
  ], code);
  if (object.recordType !== 'case_graph_research_search_postgres_completion_receipt'
    || object.schemaVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION
    || object.tokenizerVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION
    || object.rankingVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION
    || object.indexDefinitionVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION) fail(code);
  const receipt: CaseGraphResearchSearchPostgresCompletionReceipt = {
    recordType: 'case_graph_research_search_postgres_completion_receipt',
    schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
    binding: decodeBinding(object.binding, code),
    tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
    rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
    indexDefinitionVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
    indexDefinitionSha256: digest(object.indexDefinitionSha256, code),
    sourceShardSetSha256: digest(object.sourceShardSetSha256, code),
    dbNodeSetSha256: digest(object.dbNodeSetSha256, code),
    searchContentSetSha256: digest(object.searchContentSetSha256, code),
    accounting: decodeAccounting(object.accounting, code),
    sentinels: decodeSentinels(object.sentinels, code),
  };
  if (receipt.indexDefinitionSha256 !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256
    || receipt.accounting.indexedRecordCount !== receipt.binding.expectedRecordCount
    || receipt.dbNodeSetSha256 !== receipt.binding.publicNodeSetSha256) fail(code);
  return receipt;
};

export const encodeCaseGraphResearchSearchPostgresCompletionReceipt = (
  receipt: CaseGraphResearchSearchPostgresCompletionReceipt,
) => Buffer.from(`${canonicalizeRelationshipInput(
  decodeCaseGraphResearchSearchPostgresCompletionReceipt(receipt),
)}\n`, 'utf8');

export const inspectPostgresCaseGraphResearchSearchIndexDefinition = async (params: {
  query: PostgresCaseGraphResearchSearchQuery;
  signal?: AbortSignal;
  timeoutMs?: number;
}) => {
  abort(params.signal);
  const timeoutMs = params.timeoutMs ?? CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_PREFLIGHT_TIMEOUT_MS;
  const result = await params.query(`
    SELECT
      idx.relname AS index_name,
      am.amname AS access_method,
      i.indisvalid AS is_valid,
      i.indisready AS is_ready,
      i.indislive AS is_live,
      i.indisunique AS is_unique,
      i.indpred IS NULL AS has_no_predicate,
      i.indexprs IS NULL AS has_no_expressions,
      i.indnatts AS total_attribute_count,
      i.indnkeyatts AS key_attribute_count,
      i.indkey[0] = indexed_attribute.attnum AS indexes_search_vector,
      opc.opcname AS operator_class,
      table_namespace.nspname AS table_schema,
      index_namespace.nspname AS index_schema
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid = tbl.relnamespace
    JOIN pg_catalog.pg_namespace index_namespace ON index_namespace.oid = idx.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    JOIN pg_catalog.pg_opclass opc
      ON opc.oid = i.indclass[0] AND opc.opcmethod = am.oid
    JOIN pg_catalog.pg_attribute indexed_attribute
      ON indexed_attribute.attrelid = tbl.oid
     AND indexed_attribute.attname = 'search_vector'
    WHERE table_namespace.nspname = 'public'
      AND index_namespace.nspname = 'public'
      AND tbl.relname = 'case_graph_research_search_documents'
      AND idx.relname = $1
  `, [CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_NAME], {
    queryTimeoutMs: timeoutMs,
    statementTimeoutMs: timeoutMs,
    signal: params.signal,
  });
  if (result.rows.length !== 1) fail('case_graph_research_search_postgres_index_unavailable');
  const row = result.rows[0];
  if (row.index_name !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_NAME
    || row.access_method !== 'gin'
    || row.is_valid !== true
    || row.is_ready !== true
    || row.is_live !== true
    || row.is_unique !== false
    || row.has_no_predicate !== true
    || row.has_no_expressions !== true
    || Number(row.total_attribute_count) !== 1
    || Number(row.key_attribute_count) !== 1
    || row.indexes_search_vector !== true
    || row.operator_class !== 'tsvector_ops'
    || row.table_schema !== 'public'
    || row.index_schema !== 'public') {
    fail('case_graph_research_search_postgres_index_unavailable');
  }
  return {
    version: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
    logicalDefinition: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_LOGICAL_DEFINITION,
    sha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
  };
};

const decodeReceiptBody = (body: Buffer) => {
  if (!body.length || body.length > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RECEIPT_BYTES) {
    fail('case_graph_research_search_postgres_receipt_invalid');
  }
  let raw: unknown;
  try { raw = JSON.parse(body.toString('utf8')); } catch { return fail('case_graph_research_search_postgres_receipt_invalid'); }
  const receipt = decodeCaseGraphResearchSearchPostgresCompletionReceipt(raw);
  if (!body.equals(encodeCaseGraphResearchSearchPostgresCompletionReceipt(receipt))) {
    fail('case_graph_research_search_postgres_receipt_invalid');
  }
  return receipt;
};

const decodeVerifiedBuildRow = (row: Record<string, unknown>, code: string) => ({
  publicationId: uuid(row.publication_id, code),
  corpusVersion: text(row.corpus_version, 240, code),
  snapshotId: text(row.snapshot_id, 240, code),
  publicManifestSha256: digest(row.public_manifest_sha256, code),
  publicManifestDigest: digest(row.public_manifest_digest, code),
  graphArtifactSetSha256: digest(row.graph_artifact_set_sha256, code),
  publicNodeSetSha256: digest(row.public_node_set_sha256, code),
  expectedRecordCount: safeCount(row.expected_record_count, 10_000_000, code),
  indexedRecordCount: safeCount(row.indexed_record_count, 10_000_000, code),
  schemaVersion: text(row.schema_version, 120, code),
  tokenizerVersion: text(
    row.tokenizer_version,
    CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_TOKENIZER_VERSION_CHARACTERS,
    code,
  ),
  rankingVersion: text(row.ranking_version, 120, code),
  indexDefinitionVersion: text(row.index_definition_version, 120, code),
  indexDefinitionSha256: digest(row.index_definition_sha256, code),
  sourceShardSetSha256: digest(row.source_shard_set_sha256, code),
  dbNodeSetSha256: digest(row.db_node_set_sha256, code),
  searchContentSetSha256: digest(row.search_content_set_sha256, code),
  completionReceiptKey: text(row.completion_receipt_key, 1_024, code),
  completionReceiptSha256: digest(row.completion_receipt_sha256, code),
  accounting: decodeAccounting({
    sourceShardCount: row.source_shard_count,
    indexedRecordCount: row.indexed_record_count,
  }, code),
  sentinels: decodeSentinels(row.sentinels, code),
});

const preflightDatabase = async (params: {
  active: ActiveCaseGraphPublication;
  query: PostgresCaseGraphResearchSearchQuery;
  receipt: CaseGraphResearchSearchPostgresCompletionReceipt;
  receiptKey: string;
  receiptSha256: string;
  signal?: AbortSignal;
  timeoutMs: number;
}) => {
  const binding = caseGraphResearchSearchPostgresBinding(params.active);
  const buildResult = await params.query(`
      SELECT *
      FROM public.preflight_case_graph_research_search_build(
        $1::uuid, $2::text, $3::text, $4::text, $5::text,
        $6::text, $7::bigint, $8::text, $9::text
      )
    `, [
      binding.publicationId,
      binding.corpusVersion,
      binding.publicManifestSha256,
      binding.publicManifestDigest,
      binding.graphArtifactSetSha256,
      binding.publicNodeSetSha256,
      binding.expectedRecordCount,
      params.receiptKey,
      params.receiptSha256,
    ], {
      queryTimeoutMs: params.timeoutMs,
      statementTimeoutMs: params.timeoutMs,
      signal: params.signal,
    }).catch(() => {
    abort(params.signal);
    return fail('case_graph_research_search_postgres_unavailable');
  });
  if (buildResult.rows.length !== 1) fail('case_graph_research_search_postgres_unavailable');
  const row = decodeVerifiedBuildRow(
    buildResult.rows[0],
    'case_graph_research_search_postgres_build_invalid',
  );
  if (!same({
      publicationId: row.publicationId,
      corpusVersion: row.corpusVersion,
      snapshotId: row.snapshotId,
      publicManifestSha256: row.publicManifestSha256,
      publicManifestDigest: row.publicManifestDigest,
      graphArtifactSetSha256: row.graphArtifactSetSha256,
      publicNodeSetSha256: row.publicNodeSetSha256,
      expectedRecordCount: row.expectedRecordCount,
    }, binding)
    || row.indexedRecordCount !== binding.expectedRecordCount
    || row.schemaVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION
    || row.tokenizerVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION
    || row.rankingVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION
    || row.indexDefinitionVersion !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION
    || row.indexDefinitionSha256 !== params.receipt.indexDefinitionSha256
    || row.sourceShardSetSha256 !== params.receipt.sourceShardSetSha256
    || row.dbNodeSetSha256 !== params.receipt.dbNodeSetSha256
    || row.searchContentSetSha256 !== params.receipt.searchContentSetSha256
    || row.completionReceiptKey !== params.receiptKey
    || row.completionReceiptSha256 !== params.receiptSha256
    || !same(row.accounting, params.receipt.accounting)
    || !same(row.sentinels, params.receipt.sentinels)) {
    fail('case_graph_research_search_postgres_build_mismatch');
  }
  const index = await inspectPostgresCaseGraphResearchSearchIndexDefinition({
    query: params.query,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
  });
  if (index.sha256 !== params.receipt.indexDefinitionSha256) {
    fail('case_graph_research_search_postgres_index_mismatch');
  }
};

const tryExactAddress = (query: string) => {
  try { return parseCaseGraphEvidenceAddress(query).address; } catch { return null; }
};

export type CaseGraphResearchSearchPostgresCursorBoundary = {
  scoreMicros: number;
  address: string;
};

const cursorContext = (params: {
  active: ActiveCaseGraphPublication;
  request: SearchRequest;
  completionReceiptSha256: string;
}) => ({
  publicationBindingDigest: relationshipInputSha256(
    caseGraphResearchPublicationBinding(params.active),
  ),
  completionReceiptSha256: params.completionReceiptSha256,
  searchScopeDigest: relationshipInputSha256({
    query: params.request.query,
    filters: params.request.filters,
    tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
    rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
    sortVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SORT_VERSION,
  }),
});

const encodeCaseGraphResearchSearchPostgresCursor = (params: {
  active: ActiveCaseGraphPublication;
  request: SearchRequest;
  completionReceiptSha256: string;
  boundary: CaseGraphResearchSearchPostgresCursorBoundary;
}) => {
  const context = cursorContext(params);
  const payload: CaseGraphResearchSearchPostgresCursorPayload = {
    schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_VERSION,
    ...context,
    sortVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SORT_VERSION,
    scoreMicros: params.boundary.scoreMicros,
    address: params.boundary.address,
  };
  const body = Buffer.from(canonicalizeRelationshipInput(payload), 'utf8');
  const encoded = body.toString('base64url');
  const checksum = createHash('sha256')
    .update(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_HASH_DOMAIN)
    .update(body)
    .digest('base64url');
  const cursor = `${encoded}.${checksum}`;
  if (Buffer.byteLength(cursor) > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_CURSOR_BYTES) {
    fail('case_graph_research_search_cursor_invalid');
  }
  return cursor;
};

export const decodeCaseGraphResearchSearchPostgresCursor = (params: {
  cursor: string;
  active: ActiveCaseGraphPublication;
  request: SearchRequest;
  completionReceiptSha256: string;
}): CaseGraphResearchSearchPostgresCursorBoundary => {
  const code = 'case_graph_research_search_cursor_invalid';
  if (typeof params.cursor !== 'string'
    || !params.cursor.length
    || Buffer.byteLength(params.cursor) > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_CURSOR_BYTES) fail(code);
  const parts = params.cursor.split('.');
  if (parts.length !== 2 || !parts[0] || !/^[A-Za-z0-9_-]+$/.test(parts[0])
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) fail(code);
  let body: Buffer;
  let raw: unknown;
  try {
    body = Buffer.from(parts[0], 'base64url');
    if (!body.length || body.toString('base64url') !== parts[0]) fail(code);
    if (createHash('sha256')
      .update(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_HASH_DOMAIN)
      .update(body)
      .digest('base64url') !== parts[1]) fail(code);
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return fail(code);
  }
  const object = exact(raw, [
    'schemaVersion', 'publicationBindingDigest', 'completionReceiptSha256',
    'searchScopeDigest', 'sortVersion', 'scoreMicros', 'address',
  ], code);
  const payload: CaseGraphResearchSearchPostgresCursorPayload = {
    schemaVersion: object.schemaVersion === CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_VERSION
      ? CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_CURSOR_VERSION
      : fail(code),
    publicationBindingDigest: digest(object.publicationBindingDigest, code),
    completionReceiptSha256: digest(object.completionReceiptSha256, code),
    searchScopeDigest: digest(object.searchScopeDigest, code),
    sortVersion: object.sortVersion === CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SORT_VERSION
      ? CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SORT_VERSION
      : fail(code),
    scoreMicros: safeCount(object.scoreMicros, 1_000_000, code),
    address: (() => {
      try {
        const address = parseCaseGraphEvidenceAddress(text(
          object.address,
          CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
          code,
        )).address;
        return isAsciiAddress(address) ? address : fail(code);
      } catch { return fail(code); }
    })(),
  };
  if (canonicalizeRelationshipInput(payload) !== new TextDecoder('utf-8', { fatal: true }).decode(body)) fail(code);
  const context = cursorContext(params);
  if (payload.publicationBindingDigest !== context.publicationBindingDigest
    || payload.completionReceiptSha256 !== context.completionReceiptSha256
    || payload.searchScopeDigest !== context.searchScopeDigest) fail(code);
  return { scoreMicros: payload.scoreMicros, address: payload.address };
};

const lexicalTerms = (value: unknown) => (
  normalizeCaseGraphResearchSearchPostgresText(typeof value === 'string' ? value : null)
    .split(' ')
    .filter(Boolean)
);

const matchedFieldsFor = (row: Record<string, unknown>, terms: readonly string[]) => {
  const fields: Array<[SearchField, unknown]> = [
    ['address', row.address_norm],
    ['title', row.title_norm],
    ['summary', row.summary_norm],
    ['source', row.source_norm],
    ['location', row.location_norm],
    ['event_timestamp', row.event_timestamp_norm],
  ];
  return fields.filter(([, value]) => {
    const fieldTerms = new Set(lexicalTerms(value));
    return terms.some((term) => fieldTerms.has(term));
  }).map(([field]) => field).sort(compareText);
};

const decodeSearchRow = (
  row: Record<string, unknown>,
  terms: readonly string[],
  exactAddress: string | null,
) => {
  const code = 'case_graph_research_search_postgres_result_invalid';
  const address = parseCaseGraphEvidenceAddress(text(
    row.address,
    CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
    code,
  )).address;
  if (!isAsciiAddress(address)) fail(code);
  const nodeDigest = digest(row.node_digest, code);
  const scoreMicros = safeCount(row.score_micros, 1_000_000, code);
  if (exactAddress && (scoreMicros !== 1_000_000 || address !== exactAddress)) fail(code);
  const score = scoreMicros / 1_000_000;
  const matchedFields = exactAddress ? ['address' as const] : matchedFieldsFor(row, terms);
  if (!matchedFields.length) fail(code);
  return { address, nodeDigest, score, scoreMicros, matchedFields };
};

export const createPostgresCaseGraphResearchSearchRuntime = (params: {
  query: PostgresCaseGraphResearchSearchQuery;
  storage: CaseGraphPublicStorage;
  positivePreflightTtlMs?: number;
  sharedPreflightTimeoutMs?: number;
  now?: () => number;
}) => {
  const ttl = params.positivePreflightTtlMs ?? 30_000;
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 60_000) {
    fail('case_graph_research_search_postgres_preflight_cache_invalid');
  }
  const sharedPreflightTimeoutMs = params.sharedPreflightTimeoutMs
    ?? CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SHARED_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(sharedPreflightTimeoutMs)
    || sharedPreflightTimeoutMs < 1
    || sharedPreflightTimeoutMs > 30_000) {
    fail('case_graph_research_search_postgres_preflight_timeout_invalid');
  }
  const now = params.now ?? Date.now;
  const positives = new Map<string, { fullKey: string; value: CaseGraphResearchSearchPostgresPreflight; expires: number }>();
  const inFlight = new Map<string, Promise<CaseGraphResearchSearchPostgresPreflight>>();

  const preflight = async (
    active: ActiveCaseGraphPublication,
    signal?: AbortSignal,
  ): Promise<CaseGraphResearchSearchPostgresPreflight> => {
    abort(signal);
    const binding = caseGraphResearchSearchPostgresBinding(active);
    const bindingKey = relationshipInputSha256(binding);
    const cached = positives.get(bindingKey);
    if (cached && cached.expires > now()
      && cached.fullKey === `${bindingKey}:${cached.value.receiptSha256}`) return cached.value;
    positives.delete(bindingKey);
    let pending = inFlight.get(bindingKey);
    if (!pending) {
      pending = runSharedPreflightWithDeadline(sharedPreflightTimeoutMs, async (sharedSignal) => {
        const receiptKey = getCaseGraphResearchSearchPostgresReceiptKey(
          active.corpusVersion,
          active.publicationId,
          active.manifestSha256,
        );
        const body = await params.storage.readObject(receiptKey, {
          maxBytes: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RECEIPT_BYTES,
          signal: sharedSignal,
        });
        abort(sharedSignal);
        const receiptBody = body === null
          ? fail('case_graph_research_search_postgres_receipt_missing')
          : body;
        const receipt = decodeReceiptBody(receiptBody);
        const receiptSha256 = createHash('sha256').update(receiptBody).digest('hex');
        if (!same(receipt.binding, binding)) fail('case_graph_research_search_postgres_publication_mismatch');
        await preflightDatabase({
          active,
          query: params.query,
          receipt,
          receiptKey,
          receiptSha256,
          signal: sharedSignal,
          timeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_PREFLIGHT_TIMEOUT_MS,
        });
        abort(sharedSignal);
        const value: CaseGraphResearchSearchPostgresPreflight = {
          verified: true,
          receiptKey,
          receiptSha256,
          receipt,
        };
        positives.set(bindingKey, {
          fullKey: `${bindingKey}:${receiptSha256}`,
          value,
          expires: now() + ttl,
        });
        return value;
      });
      inFlight.set(bindingKey, pending);
      const clear = () => {
        if (inFlight.get(bindingKey) === pending) inFlight.delete(bindingKey);
      };
      void pending.then(clear, clear);
    }
    return waitForSharedPreflight(pending, signal);
  };

  const search: CaseGraphResearchSearchProvider = async ({ active, request: rawRequest, signal }) => {
    abort(signal);
    const decoded = decodeCaseGraphResearchToolRequest(rawRequest);
    if (decoded.tool !== 'search_records') fail('case_graph_research_search_request_invalid');
    const request = decoded as Extract<typeof decoded, { tool: 'search_records' }>;
    const verified = await preflight(active, signal);
    const exactAddress = tryExactAddress(request.query);
    if (exactAddress && request.cursor !== null) fail('case_graph_research_search_cursor_invalid');
    const tokenized = exactAddress
      ? { normalized: normalizeCaseGraphResearchSearchPostgresText(request.query), terms: [] }
      : tokenizeCaseGraphResearchSearchPostgresQuery(request.query);
    const cursorBoundary = request.cursor === null ? null : decodeCaseGraphResearchSearchPostgresCursor({
      cursor: request.cursor,
      active,
      request,
      completionReceiptSha256: verified.receiptSha256,
    });
    const filters = request.filters;
    const queryValue = exactAddress || tokenized.terms.join(' & ');
    const commonParams = [
      active.publicationId,
      verified.receiptSha256,
      queryValue,
      filters.kinds,
      filters.relationshipStatuses,
      filters.sources,
      filters.eventStart,
      filters.eventEnd,
    ] as const;
    if (!exactAddress) {
      const probe = await params.query(`
          WITH wanted AS (
            SELECT pg_catalog.to_tsquery('pg_catalog.simple'::pg_catalog.regconfig, $3) AS query
          ), bounded_candidates AS (
            SELECT 1
            FROM public.case_graph_research_search_builds b
            JOIN public.case_graph_research_search_publication_nodes pn
              ON pn.publication_id = b.publication_id
            JOIN public.case_graph_research_search_documents d ON d.node_digest = pn.node_digest
            CROSS JOIN wanted
            WHERE b.publication_id = $1 AND b.status = 'verified'
              AND b.completion_receipt_sha256 = $2
              AND d.search_vector @@ wanted.query
              AND (pg_catalog.cardinality($4::text[]) = 0 OR d.kind = ANY($4::text[]))
              AND (pg_catalog.cardinality($5::text[]) = 0 OR d.relationship_status = ANY($5::text[]))
              AND (pg_catalog.cardinality($6::text[]) = 0 OR d.source_key = ANY($6::text[]))
              AND ($7::timestamptz IS NULL OR d.event_timestamp >= $7::timestamptz)
              AND ($8::timestamptz IS NULL OR d.event_timestamp < $8::timestamptz)
            LIMIT $9::integer
          )
          SELECT pg_catalog.count(*)::bigint AS candidate_count
          FROM bounded_candidates
        `, [
          ...commonParams,
          CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES + 1,
        ], {
          queryTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
          statementTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
          signal,
        }).catch((error: unknown) => {
        abort(signal);
        if (isPostgresTimeout(error)) return fail('case_graph_research_search_query_too_broad');
        return fail('case_graph_research_search_postgres_unavailable');
      });
      abort(signal);
      if (probe.rows.length !== 1) fail('case_graph_research_search_postgres_result_invalid');
      const candidateCount = safeCount(
        probe.rows[0].candidate_count,
        CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES + 1,
        'case_graph_research_search_postgres_result_invalid',
      );
      if (candidateCount > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES) {
        fail('case_graph_research_search_query_too_broad');
      }
    }
    const sql = exactAddress ? `
      SELECT pn.address, pn.node_digest, 1000000::bigint AS score_micros,
        d.address_norm, d.title_norm, d.summary_norm, d.source_norm,
        d.location_norm, d.event_timestamp_norm
      FROM public.case_graph_research_search_builds b
      JOIN public.case_graph_research_search_publication_nodes pn ON pn.publication_id = b.publication_id
      JOIN public.case_graph_research_search_documents d ON d.node_digest = pn.node_digest
      WHERE b.publication_id = $1 AND b.status = 'verified'
        AND b.completion_receipt_sha256 = $2 AND pn.address = $3
        AND (pg_catalog.cardinality($4::text[]) = 0 OR d.kind = ANY($4::text[]))
        AND (pg_catalog.cardinality($5::text[]) = 0 OR d.relationship_status = ANY($5::text[]))
        AND (pg_catalog.cardinality($6::text[]) = 0 OR d.source_key = ANY($6::text[]))
        AND ($7::timestamptz IS NULL OR d.event_timestamp >= $7::timestamptz)
        AND ($8::timestamptz IS NULL OR d.event_timestamp < $8::timestamptz)
      ORDER BY pn.address COLLATE "C"
      LIMIT $9
    ` : `
      WITH wanted AS (
        SELECT pg_catalog.to_tsquery('pg_catalog.simple'::pg_catalog.regconfig, $3) AS query
      ), ranked_raw AS MATERIALIZED (
        SELECT pn.address, pn.node_digest,
          pg_catalog.ts_rank_cd(d.search_vector, wanted.query)::double precision AS raw_score,
          d.address_norm, d.title_norm, d.summary_norm, d.source_norm,
          d.location_norm, d.event_timestamp_norm
        FROM public.case_graph_research_search_builds b
        JOIN public.case_graph_research_search_publication_nodes pn ON pn.publication_id = b.publication_id
        JOIN public.case_graph_research_search_documents d ON d.node_digest = pn.node_digest
        CROSS JOIN wanted
        WHERE b.publication_id = $1 AND b.status = 'verified'
          AND b.completion_receipt_sha256 = $2
          AND d.search_vector @@ wanted.query
          AND (pg_catalog.cardinality($4::text[]) = 0 OR d.kind = ANY($4::text[]))
          AND (pg_catalog.cardinality($5::text[]) = 0 OR d.relationship_status = ANY($5::text[]))
          AND (pg_catalog.cardinality($6::text[]) = 0 OR d.source_key = ANY($6::text[]))
          AND ($7::timestamptz IS NULL OR d.event_timestamp >= $7::timestamptz)
          AND ($8::timestamptz IS NULL OR d.event_timestamp < $8::timestamptz)
      ), ranked AS (
        SELECT address, node_digest,
          pg_catalog.round((raw_score / (1 + raw_score)) * 1000000)::bigint AS score_micros,
          address_norm, title_norm, summary_norm, source_norm, location_norm, event_timestamp_norm
        FROM ranked_raw
      )
      SELECT address, node_digest, score_micros,
        address_norm, title_norm, summary_norm, source_norm, location_norm, event_timestamp_norm
      FROM ranked
      WHERE ($9::bigint IS NULL OR score_micros < $9::bigint
        OR (score_micros = $9::bigint AND address COLLATE "C" > $10::text COLLATE "C"))
      ORDER BY score_micros DESC, address COLLATE "C" ASC
      LIMIT $11
    `;
    const searchParams = exactAddress ? [
      ...commonParams,
      request.limit + 1,
    ] : [
      ...commonParams,
      cursorBoundary?.scoreMicros ?? null,
      cursorBoundary?.address ?? null,
      request.limit + 1,
    ];
    const result = await params.query(sql, searchParams, {
        queryTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
        statementTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
        signal,
      }).catch(() => {
      abort(signal);
      return fail('case_graph_research_search_postgres_unavailable');
    });
    abort(signal);
    if (result.rows.length > request.limit + 1) fail('case_graph_research_search_postgres_result_invalid');
    const decodedRows = result.rows.map((row) => decodeSearchRow(row, tokenized.terms, exactAddress));
    if ((exactAddress !== null && decodedRows.length > 1)
      || new Set(decodedRows.map((row) => row.address)).size !== decodedRows.length
      || decodedRows.some((row, index) => index > 0 && (
        decodedRows[index - 1].scoreMicros < row.scoreMicros
        || (decodedRows[index - 1].scoreMicros === row.scoreMicros
          && compareUtf8(decodedRows[index - 1].address, row.address) >= 0)
      ))
      || (cursorBoundary !== null && decodedRows.some((row) => (
        row.scoreMicros > cursorBoundary.scoreMicros
        || (row.scoreMicros === cursorBoundary.scoreMicros
          && compareUtf8(row.address, cursorBoundary.address) <= 0)
      )))) fail('case_graph_research_search_postgres_result_invalid');
    const hasMore = decodedRows.length > request.limit;
    const rows = decodedRows.slice(0, request.limit);
    const last = rows.at(-1);
    const nextCursor = hasMore && last ? encodeCaseGraphResearchSearchPostgresCursor({
      active,
      request,
      completionReceiptSha256: verified.receiptSha256,
      boundary: { scoreMicros: last.scoreMicros, address: last.address },
    }) : null;
    const candidates: CaseGraphResearchSearchCandidates = {
      recordType: 'case_graph_research_search_candidates',
      schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
      binding: caseGraphResearchPublicationBinding(active),
      indexSha256: verified.receiptSha256,
      normalizedQuery: request.query,
      hits: rows.map((row) => ({
        address: row.address,
        score: row.score,
        matchedFields: row.matchedFields,
        reasonCodes: [
          exactAddress ? 'exact_address_match' : 'publication_pinned_postgres_fts',
          'publication_receipt_node_set_bound',
        ].sort(compareText),
      })),
      page: { hasMore, nextCursor },
    };
    return candidates;
  };

  return {
    search,
    preflight,
    inspect: preflight,
  };
};

export type PostgresCaseGraphResearchSearchRuntime = ReturnType<
  typeof createPostgresCaseGraphResearchSearchRuntime
>;

export const caseGraphResearchSearchPostgresKinds = KINDS;
export const caseGraphResearchSearchPostgresRelationshipStatuses = STATUSES;
