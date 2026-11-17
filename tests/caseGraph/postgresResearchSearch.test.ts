import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getCaseGraphResearchSearchPostgresReceiptKey } from '../../src/caseGraph/archiveKeys';
import type { CaseGraphConditionalWriteResult } from '../../src/caseGraph/archiveTypes';
import {
  buildPostgresCaseGraphResearchSearchIndex,
  caseGraphResearchSearchPostgresBatchBytes,
  caseGraphResearchSearchPostgresDocumentBytes,
  planCaseGraphResearchSearchPostgresBatchAction,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_ROWS,
  type CaseGraphResearchSearchPostgresBuildStore,
  type CaseGraphResearchSearchPostgresFinalRow,
  type CaseGraphResearchSearchPostgresSourceShardReceipt,
} from '../../src/caseGraph/postgresResearchSearchBuilder';
import {
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_NAME,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_TOKENIZER_VERSION_CHARACTERS,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
  caseGraphResearchSearchPostgresBinding,
  createPostgresCaseGraphResearchSearchRuntime,
  decodeCaseGraphResearchSearchPostgresCursor,
  decodeCaseGraphResearchSearchPostgresCompletionReceipt,
  encodeCaseGraphResearchSearchPostgresCompletionReceipt,
  normalizeCaseGraphResearchSearchPostgresText,
  projectCaseGraphResearchSearchPostgresDocument,
  tokenizeCaseGraphResearchSearchPostgresQuery,
  type CaseGraphResearchSearchPostgresCompletionReceipt,
  type PostgresCaseGraphResearchSearchQuery,
} from '../../src/caseGraph/postgresResearchSearch';
import {
  loadActiveCaseGraphPublication,
  type ActiveCaseGraphPublication,
  type CaseGraphPublicQuery,
} from '../../src/caseGraph/publicAccess';
import { decodeCaseGraphResearchToolRequest } from '../../src/caseGraph/researchToolContract';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from '../../src/caseGraph/relationshipInputSnapshot';
import type {
  FullCorpusPublicGraphShardSummary,
  FullCorpusPublicNode,
} from '../../src/caseGraph/typedRelationshipPublicGraph';
import { CASE_GRAPH_SOURCE_REGISTRY_VERSION } from '../../src/caseGraph/sourceRegistry';
import {
  FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION,
  FULL_CORPUS_SEARCH_TOKENIZER_VERSION,
  normalizeFullCorpusSearchText,
} from '../../src/caseGraph/fullCorpusProductionCompatibility';
import { fullCorpusRelationshipShard } from '../../src/caseGraph/typedRelationshipPipeline';
import {
  buildPublicationV2ActivationRow,
  buildPublicationV2Fixture,
} from './publicationV2TestSupport';

type Fixture = ReturnType<typeof buildPublicationV2Fixture>;

class MemoryStorage {
  readonly reads: string[] = [];
  readonly readCalls: Array<{
    key: string;
    options?: { maxBytes?: number; signal?: AbortSignal };
  }> = [];
  readonly conditionalUploads: Array<{ key: string; body: Buffer }> = [];

  constructor(readonly objects: Map<string, Buffer>) {}

  readObject = async (key: string, options?: { maxBytes?: number; signal?: AbortSignal }) => {
    this.reads.push(key);
    this.readCalls.push({ key, options });
    if (options?.signal?.aborted) throw new Error('case_graph_research_aborted');
    const body = this.objects.get(key);
    if (body && options?.maxBytes != null && body.length > options.maxBytes) {
      throw new Error('case_graph_research_search_postgres_receipt_too_large');
    }
    return body ? Buffer.from(body) : null;
  };

  uploadFileConditional = async (
    body: Buffer,
    key: string,
    _options: unknown,
    condition: unknown,
  ): Promise<CaseGraphConditionalWriteResult> => {
    this.conditionalUploads.push({ key, body: Buffer.from(body) });
    if (!condition || typeof condition !== 'object' || !('ifAbsent' in condition)) {
      throw new Error('unexpected_mutable_write');
    }
    if (this.objects.has(key)) return { status: 'precondition_failed' };
    this.objects.set(key, Buffer.from(body));
    return { status: 'written', key, version: `v:${key}` };
  };
}

let fixture: Fixture;
let active: ActiveCaseGraphPublication;
let nodes: FullCorpusPublicNode[];
let target: FullCorpusPublicNode;

const sha = (character: string) => character.repeat(64);

const completionReceipt = (): CaseGraphResearchSearchPostgresCompletionReceipt => ({
  recordType: 'case_graph_research_search_postgres_completion_receipt',
  schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
  binding: caseGraphResearchSearchPostgresBinding(active),
  tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
  rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
  indexDefinitionVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
  indexDefinitionSha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
  sourceShardSetSha256: sha('a'),
  dbNodeSetSha256: active.manifest.lineage.publicGraph.nodeSetSha256,
  searchContentSetSha256: sha('b'),
  accounting: {
    sourceShardCount: active.manifest.topology.nodeShardCount,
    indexedRecordCount: nodes.length,
  },
  sentinels: [...new Map(nodes.map((node) => [node.kind, node])).values()]
    .map((node) => ({ kind: node.kind, address: node.address, nodeDigest: node.nodeDigest }))
    .sort((left, right) => left.kind.localeCompare(right.kind)),
});

const installReceipt = (storage: MemoryStorage, receipt = completionReceipt()) => {
  const key = getCaseGraphResearchSearchPostgresReceiptKey(
    active.corpusVersion,
    active.publicationId,
    active.manifestSha256,
  );
  const body = encodeCaseGraphResearchSearchPostgresCompletionReceipt(receipt);
  storage.objects.set(key, body);
  return { key, body, sha256: createHash('sha256').update(body).digest('hex') };
};

const buildRow = (
  receipt: CaseGraphResearchSearchPostgresCompletionReceipt,
  receiptKey: string,
  receiptSha256: string,
) => ({
  publication_id: receipt.binding.publicationId,
  corpus_version: receipt.binding.corpusVersion,
  snapshot_id: receipt.binding.snapshotId,
  public_manifest_sha256: receipt.binding.publicManifestSha256,
  public_manifest_digest: receipt.binding.publicManifestDigest,
  graph_artifact_set_sha256: receipt.binding.graphArtifactSetSha256,
  public_node_set_sha256: receipt.binding.publicNodeSetSha256,
  expected_record_count: String(receipt.binding.expectedRecordCount),
  indexed_record_count: String(receipt.accounting.indexedRecordCount),
  schema_version: receipt.schemaVersion,
  tokenizer_version: receipt.tokenizerVersion,
  ranking_version: receipt.rankingVersion,
  index_definition_version: receipt.indexDefinitionVersion,
  index_definition_sha256: receipt.indexDefinitionSha256,
  source_shard_set_sha256: receipt.sourceShardSetSha256,
  db_node_set_sha256: receipt.dbNodeSetSha256,
  search_content_set_sha256: receipt.searchContentSetSha256,
  completion_receipt_key: receiptKey,
  completion_receipt_sha256: receiptSha256,
  actual_record_count: String(receipt.accounting.indexedRecordCount),
  source_shard_count: String(receipt.accounting.sourceShardCount),
  sentinels: receipt.sentinels,
  status: 'verified',
});

const indexRow = () => ({
  index_name: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_NAME,
  access_method: 'gin',
  is_valid: true,
  is_ready: true,
  is_live: true,
  is_unique: false,
  has_no_predicate: true,
  has_no_expressions: true,
  total_attribute_count: 1,
  key_attribute_count: 1,
  indexes_search_vector: true,
  operator_class: 'tsvector_ops',
  table_schema: 'public',
  index_schema: 'public',
});

beforeAll(async () => {
  fixture = buildPublicationV2Fixture();
  const storage = new MemoryStorage(new Map(
    [...fixture.objects].map(([key, body]) => [key, Buffer.from(body)]),
  ));
  const query: CaseGraphPublicQuery = async () => ({ rows: [buildPublicationV2ActivationRow(fixture)] });
  const loaded = await loadActiveCaseGraphPublication({ query, storage });
  if (!loaded) throw new Error('postgres_search_test_active_missing');
  active = loaded;
  nodes = fixture.publicGraph.shards
    .filter((shard) => shard.shardKind === 'node')
    .flatMap((shard) => shard.items as FullCorpusPublicNode[])
    .sort((left, right) => left.address.localeCompare(right.address));
  target = nodes.find((node) => node.address === 'document:official-record-2') || nodes[0];
}, 240_000);

describe('publication-pinned PostgreSQL Case Graph research search', () => {
  it('stays exactly aligned with the full-corpus compatibility tokenizer contract', () => {
    expect(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION)
      .toBe(FULL_CORPUS_SEARCH_TOKENIZER_VERSION);
    expect(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION.length).toBeGreaterThan(120);
    expect(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION.length)
      .toBeLessThanOrEqual(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_TOKENIZER_VERSION_CHARACTERS);
    const fixtures: Array<string | null> = [
      null,
      '  Roswell FIELD  ',
      'Róswell café',
      'Cafe\u0301 and nai\u0308ve',
      'NUL\0and—punctuation!!! / spacing',
      '東京 УАП العربية',
    ];
    for (const value of fixtures) {
      expect(normalizeCaseGraphResearchSearchPostgresText(value))
        .toBe(normalizeFullCorpusSearchText(value));
    }
  });

  it('normalizes deterministically and enforces the bounded lexical query contract', () => {
    expect(normalizeCaseGraphResearchSearchPostgresText('  Róswell—FIELD  ')).toBe('roswell field');
    expect(tokenizeCaseGraphResearchSearchPostgresQuery('Field field Róswell')).toEqual({
      normalized: 'field field roswell',
      terms: ['field', 'roswell'],
    });
    expect(() => tokenizeCaseGraphResearchSearchPostgresQuery('!!!')).toThrow(
      'case_graph_research_search_query_invalid',
    );
    expect(() => tokenizeCaseGraphResearchSearchPostgresQuery(
      `roswell ${'x'.repeat(97)}`,
    )).toThrow('case_graph_research_search_query_term_too_long');
    expect(() => tokenizeCaseGraphResearchSearchPostgresQuery(
      Array.from({ length: 25 }, (_, index) => `term${index}`).join(' '),
    )).toThrow('case_graph_research_search_query_terms_exceeded');
  });

  it('enforces the ASCII address invariant before PostgreSQL C-order ingestion', () => {
    const { nodeDigest: _ignored, ...withoutDigest } = target;
    for (const address of ['document:unicode-\u{10000}', 'document:bad\0id', 'document:bad id']) {
      const invalidWithoutDigest = { ...withoutDigest, address };
      const invalidNode: FullCorpusPublicNode = {
        ...invalidWithoutDigest,
        nodeDigest: relationshipInputSha256(invalidWithoutDigest),
      };
      expect(() => projectCaseGraphResearchSearchPostgresDocument(invalidNode)).toThrow(
        'case_graph_research_search_postgres_source_node_invalid',
      );
    }
  });

  it('derives a filterable ASCII source key through the governed source registry', () => {
    const { nodeDigest: _ignored, ...withoutDigest } = target;
    const sourceWithoutDigest = { ...withoutDigest, source: 'İSTANBUL Archive' };
    const sourceNode: FullCorpusPublicNode = {
      ...sourceWithoutDigest,
      nodeDigest: relationshipInputSha256(sourceWithoutDigest),
    };
    const projected = projectCaseGraphResearchSearchPostgresDocument(sourceNode);
    expect(projected.sourceKey).toMatch(/^[a-z0-9][a-z0-9._:/-]{0,239}$/);
    expect(projected.sourceKey).not.toContain('İ');
    expect(projected.sourceNorm).toBe('istanbul archive');
  });

  it('accepts only PostgreSQL-preserving canonical event timestamps in projected nodes', () => {
    const { nodeDigest: _ignored, ...withoutDigest } = target;
    for (const eventTimestamp of [
      '0001-01-01T00:00:00.000Z',
      '9999-12-31T23:59:59.999999Z',
    ]) {
      const timestamped = { ...withoutDigest, eventTimestamp };
      const timestampedNode: FullCorpusPublicNode = {
        ...timestamped,
        nodeDigest: relationshipInputSha256(timestamped),
      };
      expect(projectCaseGraphResearchSearchPostgresDocument(timestampedNode).eventTimestamp)
        .toBe(eventTimestamp);
    }
    for (const eventTimestamp of [
      '0000-01-01T00:00:00.000Z',
      '-000001-01-01T00:00:00.000Z',
      '+010000-01-01T00:00:00.000Z',
      '2026-07-18T12:34:56.1234567Z',
      '2026-07-18T12:34:56.123456789Z',
      '9999-12-31T23:59:59.9999995Z',
      '9999-12-31T23:59:59.999999999Z',
    ]) {
      const timestamped = { ...withoutDigest, eventTimestamp };
      const timestampedNode: FullCorpusPublicNode = {
        ...timestamped,
        nodeDigest: relationshipInputSha256(timestamped),
      };
      expect(() => projectCaseGraphResearchSearchPostgresDocument(timestampedNode)).toThrow(
        'case_graph_research_search_postgres_source_node_invalid',
      );
    }
  });

  it('requires a canonical, exactly publication-bound completion receipt', () => {
    const receipt = completionReceipt();
    const body = encodeCaseGraphResearchSearchPostgresCompletionReceipt(receipt);
    expect(decodeCaseGraphResearchSearchPostgresCompletionReceipt(JSON.parse(body.toString('utf8'))))
      .toEqual(receipt);
    expect(() => decodeCaseGraphResearchSearchPostgresCompletionReceipt({
      ...receipt,
      unexpected: true,
    })).toThrow('case_graph_research_search_postgres_receipt_invalid');
    expect(() => decodeCaseGraphResearchSearchPostgresCompletionReceipt({
      ...receipt,
      dbNodeSetSha256: sha('d'),
    })).toThrow('case_graph_research_search_postgres_receipt_invalid');
    expect(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION).toContain(
      CASE_GRAPH_SOURCE_REGISTRY_VERSION,
    );
    expect(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION).toContain(
      FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION,
    );
    expect(() => decodeCaseGraphResearchSearchPostgresCompletionReceipt({
      ...receipt,
      tokenizerVersion: 'unicode-nfkd-simple-tsvector-v1',
    })).toThrow('case_graph_research_search_postgres_receipt_invalid');
  });

  it('preserves the longest canonical public address through projection and receipt decoding', () => {
    const address = `document:${'a'.repeat(240)}`;
    expect(address.length).toBe(249);
    expect(address.length).toBeLessThanOrEqual(
      CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
    );
    const { nodeDigest: _ignored, ...withoutDigest } = target;
    const longWithoutDigest = { ...withoutDigest, address, recordId: 'a'.repeat(240) };
    const longNode: FullCorpusPublicNode = {
      ...longWithoutDigest,
      nodeDigest: relationshipInputSha256(longWithoutDigest),
    };
    expect(projectCaseGraphResearchSearchPostgresDocument(longNode).address).toBe(address);

    const receipt = completionReceipt();
    const withLongSentinel = {
      ...receipt,
      sentinels: receipt.sentinels.map((sentinel) => sentinel.kind === 'document'
        ? { kind: 'document' as const, address, nodeDigest: longNode.nodeDigest }
        : sentinel),
    };
    expect(decodeCaseGraphResearchSearchPostgresCompletionReceipt(withLongSentinel).sentinels)
      .toContainEqual({ kind: 'document', address, nodeDigest: longNode.nodeDigest });

    const overBoundAddress = `document:${'a'.repeat(
      CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
    )}`;
    expect(() => decodeCaseGraphResearchSearchPostgresCompletionReceipt({
      ...receipt,
      sentinels: receipt.sentinels.map((sentinel) => sentinel.kind === 'document'
        ? { ...sentinel, address: overBoundAddress }
        : sentinel),
    })).toThrow('case_graph_research_search_postgres_receipt_invalid');
  });

  it('preflights R2 receipt, verified DB count, sentinels and the live GIN index before caching positive', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql, _params, options) => {
      expect(options.signal).toBeDefined();
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({
      query,
      storage,
      positivePreflightTtlMs: 30_000,
      now: () => 1_000,
    });
    const controller = new AbortController();
    await expect(runtime.preflight(active, controller.signal)).resolves.toMatchObject({
      verified: true,
      receiptKey: installed.key,
      receiptSha256: installed.sha256,
    });
    await runtime.preflight(active, controller.signal);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('singleflights concurrent cold preflight while keeping caller cancellation local', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const originalRead = storage.readObject;
    const read = vi.spyOn(storage, 'readObject').mockImplementation(async (...args) => {
      await readGate;
      return originalRead(...args);
    });
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => (
      sql.includes('FROM pg_catalog.pg_index')
        ? { rows: [indexRow()] }
        : { rows: [buildRow(receipt, installed.key, installed.sha256)] }
    ));
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const cancelled = new AbortController();
    const cancelledWaiter = runtime.preflight(active, cancelled.signal);
    const waiters = Array.from({ length: 19 }, () => runtime.preflight(active));
    expect(read).toHaveBeenCalledTimes(1);
    cancelled.abort();
    await expect(cancelledWaiter).rejects.toThrow('case_graph_research_aborted');
    releaseRead();
    const results = await Promise.all(waiters);
    expect(results.every((result) => result.verified)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    await expect(runtime.preflight(active)).resolves.toMatchObject({ verified: true });
    expect(read).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('clears a failed singleflight so a later bounded preflight can retry', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    let failFirst = true;
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => {
      if (failFirst) return { rows: [] };
      return sql.includes('FROM pg_catalog.pg_index')
        ? { rows: [indexRow()] }
        : { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const failures = await Promise.allSettled([
      runtime.preflight(active),
      runtime.preflight(active),
      runtime.preflight(active),
    ]);
    expect(failures.every((result) => result.status === 'rejected')).toBe(true);
    expect(storage.readCalls).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    failFirst = false;
    await expect(runtime.preflight(active)).resolves.toMatchObject({ verified: true });
    expect(storage.readCalls).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('expires and clears a stalled shared receipt read so later preflight can retry', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const originalRead = storage.readObject;
    let readAttempt = 0;
    let resolveFirst!: (value: Buffer | null) => void;
    const firstRead = new Promise<Buffer | null>((resolve) => { resolveFirst = resolve; });
    vi.spyOn(storage, 'readObject').mockImplementation(async (...args) => {
      readAttempt += 1;
      if (readAttempt === 1) return firstRead;
      return originalRead(...args);
    });
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => (
      sql.includes('FROM pg_catalog.pg_index')
        ? { rows: [indexRow()] }
        : { rows: [buildRow(receipt, installed.key, installed.sha256)] }
    ));
    const runtime = createPostgresCaseGraphResearchSearchRuntime({
      query,
      storage,
      sharedPreflightTimeoutMs: 20,
    });
    await expect(runtime.preflight(active)).rejects.toThrow(
      'case_graph_research_search_postgres_preflight_timeout',
    );
    await Promise.resolve();
    await expect(runtime.preflight(active)).resolves.toMatchObject({ verified: true });
    expect(readAttempt).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
    resolveFirst(Buffer.from('stale-read-that-must-not-populate-cache'));
    await Promise.resolve();
    await Promise.resolve();
    await expect(runtime.preflight(active)).resolves.toMatchObject({
      verified: true,
      receiptSha256: installed.sha256,
    });
    expect(readAttempt).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails closed for count, sentinel, index or publication drift', async () => {
    const cases = ['count', 'sentinel', 'index'] as const;
    for (const failure of cases) {
      const storage = new MemoryStorage(new Map(fixture.objects));
      const receipt = completionReceipt();
      const installed = installReceipt(storage, receipt);
      const query: PostgresCaseGraphResearchSearchQuery = async (sql) => {
        if (sql.includes('FROM pg_catalog.pg_index')) return {
          rows: [{ ...indexRow(), ...(failure === 'index' ? { is_ready: false } : {}) }],
        };
        return {
          rows: [{
            ...buildRow(receipt, installed.key, installed.sha256),
            ...(failure === 'count' ? { indexed_record_count: String(nodes.length - 1) } : {}),
            ...(failure === 'sentinel' ? { sentinels: [] } : {}),
          }],
        };
      };
      const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
      await expect(runtime.preflight(active)).rejects.toThrow(/case_graph_research_search_postgres/);
    }
    const missing = new MemoryStorage(new Map(fixture.objects));
    const runtime = createPostgresCaseGraphResearchSearchRuntime({
      query: async () => ({ rows: [] }),
      storage: missing,
    });
    await expect(runtime.preflight(active)).rejects.toThrow(
      'case_graph_research_search_postgres_receipt_missing',
    );
  });

  it('runs a publication- and receipt-pinned FTS query without downloading node shards', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const document = projectCaseGraphResearchSearchPostgresDocument(target);
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) return { rows: [{ candidate_count: '1' }] };
      if (sql.includes('ts_rank_cd')) return { rows: [{
        address: document.address,
        node_digest: document.nodeDigest,
        score_micros: 750_000,
        address_norm: document.addressNorm,
        title_norm: document.titleNorm,
        summary_norm: document.summaryNorm,
        source_norm: document.sourceNorm,
        location_norm: document.locationNorm,
        event_timestamp_norm: document.eventTimestampNorm,
      }] };
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const request = decodeCaseGraphResearchToolRequest({
      tool: 'search_records',
      query: 'official fixture',
      filters: { kinds: ['document'], sources: ['official'] },
      limit: 5,
    });
    if (request.tool !== 'search_records') throw new Error('unexpected_request');
    const result = await runtime.search({ active, request });
    expect(result.hits).toEqual([expect.objectContaining({
      address: target.address,
      score: 0.75,
      reasonCodes: ['publication_pinned_postgres_fts', 'publication_receipt_node_set_bound'],
    })]);
    const searchCall = query.mock.calls.find(([sql]) => sql.includes('ts_rank_cd'));
    expect(searchCall?.[1].slice(0, 3)).toEqual([
      active.publicationId,
      installed.sha256,
      'fixture & official',
    ]);
    expect(searchCall?.[2]).toMatchObject({
      queryTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
      statementTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
    });
    const nodeShardKeys = new Set(active.manifest.graphShards
      .filter((summary) => summary.shardKind === 'node')
      .map((summary) => summary.archiveKey));
    expect(storage.reads.filter((key) => nodeShardKeys.has(key))).toEqual([]);
  });

  it('returns 50 receipt-bound hits dispersed across 28 logical shards with zero node-shard reads', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const byShard = new Map<number, string>();
    for (let index = 0; byShard.size < 28 && index < 100_000; index += 1) {
      const address = `sighting:postgres-dispersed-${index}`;
      byShard.set(fullCorpusRelationshipShard(address, 28), address);
    }
    const addresses = [...byShard.values()];
    for (let index = 0; addresses.length < 50; index += 1) {
      addresses.push(`document:postgres-additional-${index}`);
    }
    expect(new Set(addresses.map((address) => fullCorpusRelationshipShard(address, 28))).size).toBe(28);
    const query: PostgresCaseGraphResearchSearchQuery = async (sql) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) return { rows: [{ candidate_count: '50' }] };
      if (sql.includes('ts_rank_cd')) return { rows: addresses.map((address, index) => ({
        address,
        node_digest: createHash('sha256').update(address).digest('hex'),
        score_micros: 1_000_000 - index * 10_000,
        address_norm: address,
        title_norm: '',
        summary_norm: 'official',
        source_norm: '',
        location_norm: '',
        event_timestamp_norm: '',
      })) };
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    };
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const request = decodeCaseGraphResearchToolRequest({ tool: 'search_records', query: 'official', limit: 50 });
    if (request.tool !== 'search_records') throw new Error('unexpected_request');
    const result = await runtime.search({ active, request });
    expect(result.hits).toHaveLength(50);
    const nodeShardKeys = new Set(active.manifest.graphShards
      .filter((summary) => summary.shardKind === 'node')
      .map((summary) => summary.archiveKey));
    expect(storage.reads.filter((key) => nodeShardKeys.has(key))).toEqual([]);
  });

  it('paginates 137 immutable hits as 50, 50 and 37 without duplicates or omissions', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const ranked = Array.from({ length: 137 }, (_, index) => {
      const address = `sighting:cursor-page-${String(index).padStart(3, '0')}`;
      return {
        address,
        node_digest: createHash('sha256').update(address).digest('hex'),
        score_micros: 1_000_000 - Math.floor(index / 7) * 10_000,
        address_norm: address,
        title_norm: '',
        summary_norm: 'lights',
        source_norm: '',
        location_norm: '',
        event_timestamp_norm: '',
      };
    });
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql, params, options) => {
      expect(options.signal).toBeDefined();
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) return { rows: [{ candidate_count: '137' }] };
      if (sql.includes('ranked_raw')) {
        expect(sql).toContain('ORDER BY score_micros DESC, address COLLATE "C" ASC');
        expect(sql).toContain('LIMIT $11');
        const scoreMicros = params[8] as number | null;
        const address = params[9] as string | null;
        const limit = params[10] as number;
        const eligible = scoreMicros === null ? ranked : ranked.filter((row) => (
          row.score_micros < scoreMicros
          || (row.score_micros === scoreMicros && row.address > String(address))
        ));
        return { rows: eligible.slice(0, limit) };
      }
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const signal = new AbortController().signal;
    const firstRequest = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'lights', limit: 50, cursor: null,
    });
    if (firstRequest.tool !== 'search_records') throw new Error('unexpected_request');
    const first = await runtime.search({ active, request: firstRequest, signal });
    expect(first.hits).toHaveLength(50);
    expect(first.page).toEqual({ hasMore: true, nextCursor: expect.any(String) });
    expect(decodeCaseGraphResearchSearchPostgresCursor({
      cursor: first.page.nextCursor!,
      active,
      request: firstRequest,
      completionReceiptSha256: installed.sha256,
    })).toEqual({ scoreMicros: ranked[49].score_micros, address: ranked[49].address });

    const alternateLimitRequest = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'lights', limit: 20, cursor: first.page.nextCursor,
    });
    if (alternateLimitRequest.tool !== 'search_records') throw new Error('unexpected_request');
    const alternateLimit = await runtime.search({ active, request: alternateLimitRequest, signal });
    expect(alternateLimit.hits.map((hit) => hit.address)).toEqual(
      ranked.slice(50, 70).map((row) => row.address),
    );

    const secondRequest = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'lights', limit: 50, cursor: first.page.nextCursor,
    });
    if (secondRequest.tool !== 'search_records') throw new Error('unexpected_request');
    const second = await runtime.search({ active, request: secondRequest, signal });
    expect(second.hits).toHaveLength(50);
    expect(second.page).toEqual({ hasMore: true, nextCursor: expect.any(String) });
    expect(decodeCaseGraphResearchSearchPostgresCursor({
      cursor: second.page.nextCursor!,
      active,
      request: secondRequest,
      completionReceiptSha256: installed.sha256,
    })).toEqual({ scoreMicros: ranked[99].score_micros, address: ranked[99].address });

    const thirdRequest = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'lights', limit: 50, cursor: second.page.nextCursor,
    });
    if (thirdRequest.tool !== 'search_records') throw new Error('unexpected_request');
    const third = await runtime.search({ active, request: thirdRequest, signal });
    expect(third.hits).toHaveLength(37);
    expect(third.page).toEqual({ hasMore: false, nextCursor: null });
    const all = [...first.hits, ...second.hits, ...third.hits].map((hit) => hit.address);
    expect(all).toEqual(ranked.map((row) => row.address));
    expect(new Set(all).size).toBe(137);
  });

  it('rejects tampered and cross-scope cursors before issuing a rank query', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const rows = Array.from({ length: 3 }, (_, index) => {
      const address = `sighting:cursor-scope-${index}`;
      return {
        address,
        node_digest: createHash('sha256').update(address).digest('hex'),
        score_micros: 900_000 - index,
        address_norm: address,
        title_norm: '',
        summary_norm: 'lights',
        source_norm: '',
        location_norm: '',
        event_timestamp_norm: '',
      };
    });
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) return { rows: [{ candidate_count: '3' }] };
      if (sql.includes('ranked_raw')) return { rows };
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const initialRequest = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'lights', limit: 2, cursor: null,
    });
    if (initialRequest.tool !== 'search_records') throw new Error('unexpected_request');
    const initial = await runtime.search({ active, request: initialRequest });
    const cursor = initial.page.nextCursor!;
    const separator = cursor.indexOf('.');
    const payloadTampered = `${cursor[0] === 'A' ? 'B' : 'A'}${cursor.slice(1)}`;
    const checksumTampered = `${cursor.slice(0, -1)}${cursor.at(-1) === 'A' ? 'B' : 'A'}`;
    const decodedPayload = JSON.parse(Buffer.from(cursor.slice(0, separator), 'base64url').toString('utf8'));
    decodedPayload.address = 'sighting:cursor-unicode-\u{10000}';
    const unicodeBody = Buffer.from(canonicalizeRelationshipInput(decodedPayload), 'utf8');
    const unicodeCursor = `${unicodeBody.toString('base64url')}.${createHash('sha256')
      .update('case-graph-research-search-postgres-cursor-v1\0')
      .update(unicodeBody)
      .digest('base64url')}`;
    expect(separator).toBeGreaterThan(0);
    const rankCallsBefore = query.mock.calls.filter(([sql]) => sql.includes('ranked_raw')).length;
    for (const invalidCursor of [payloadTampered, checksumTampered, unicodeCursor]) {
      const request = decodeCaseGraphResearchToolRequest({
        tool: 'search_records', query: 'lights', limit: 2, cursor: invalidCursor,
      });
      if (request.tool !== 'search_records') throw new Error('unexpected_request');
      await expect(runtime.search({ active, request })).rejects.toThrow(
        'case_graph_research_search_cursor_invalid',
      );
    }
    const changedQuery = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'roswell', limit: 2, cursor,
    });
    if (changedQuery.tool !== 'search_records') throw new Error('unexpected_request');
    expect(() => decodeCaseGraphResearchSearchPostgresCursor({
      cursor,
      active,
      request: changedQuery,
      completionReceiptSha256: installed.sha256,
    })).toThrow('case_graph_research_search_cursor_invalid');
    expect(() => decodeCaseGraphResearchSearchPostgresCursor({
      cursor,
      active: { ...active, publicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      request: initialRequest,
      completionReceiptSha256: installed.sha256,
    })).toThrow('case_graph_research_search_cursor_invalid');
    expect(() => decodeCaseGraphResearchSearchPostgresCursor({
      cursor,
      active,
      request: initialRequest,
      completionReceiptSha256: 'f'.repeat(64),
    })).toThrow('case_graph_research_search_cursor_invalid');
    const changedFilter = decodeCaseGraphResearchToolRequest({
      tool: 'search_records',
      query: 'lights',
      filters: { kinds: ['document'] },
      limit: 2,
      cursor,
    });
    if (changedFilter.tool !== 'search_records') throw new Error('unexpected_request');
    expect(() => decodeCaseGraphResearchSearchPostgresCursor({
      cursor,
      active,
      request: changedFilter,
      completionReceiptSha256: installed.sha256,
    })).toThrow('case_graph_research_search_cursor_invalid');
    expect(query.mock.calls.filter(([sql]) => sql.includes('ranked_raw'))).toHaveLength(rankCallsBefore);
  });

  it('keeps exact-address lookup single-query, cursor-free and independent of lexical term length', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const address = `document:${'a'.repeat(240)}`;
    expect(address.length).toBeLessThanOrEqual(
      CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_ADDRESS_CHARACTERS,
    );
    const exactRow = {
      address,
      node_digest: createHash('sha256').update(address).digest('hex'),
      score_micros: 1_000_000,
      address_norm: address,
      title_norm: '',
      summary_norm: '',
      source_norm: '',
      location_norm: '',
      event_timestamp_norm: '',
    };
    let exactRows: Record<string, unknown>[] = [exactRow];
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('pn.address = $3')) return { rows: exactRows };
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const request = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: address, limit: 5, cursor: null,
    });
    if (request.tool !== 'search_records') throw new Error('unexpected_request');
    const result = await runtime.search({ active, request });
    expect(result.hits).toEqual([expect.objectContaining({ address, score: 1 })]);
    expect(result.page).toEqual({ hasMore: false, nextCursor: null });
    expect(query.mock.calls.some(([sql]) => sql.includes('bounded_candidates'))).toBe(false);
    expect(query.mock.calls.filter(([sql]) => sql.includes('pn.address = $3'))).toHaveLength(1);
    const cursorRequest = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: address, limit: 5, cursor: `A.${'B'.repeat(43)}`,
    });
    if (cursorRequest.tool !== 'search_records') throw new Error('unexpected_request');
    await expect(runtime.search({ active, request: cursorRequest })).rejects.toThrow(
      'case_graph_research_search_cursor_invalid',
    );
    expect(query.mock.calls.filter(([sql]) => sql.includes('pn.address = $3'))).toHaveLength(1);
    const wrongAddress = 'document:wrong-exact-address';
    exactRows = [{
      ...exactRow,
      address: wrongAddress,
      node_digest: createHash('sha256').update(wrongAddress).digest('hex'),
      address_norm: wrongAddress,
    }];
    await expect(runtime.search({ active, request })).rejects.toThrow(
      'case_graph_research_search_postgres_result_invalid',
    );
    exactRows = [exactRow, { ...exactRow }];
    await expect(runtime.search({ active, request })).rejects.toThrow(
      'case_graph_research_search_postgres_result_invalid',
    );
  });

  it('stops a broad lexical query at threshold plus one before any rank-all query', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql, params) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) {
        expect(sql).toContain('LIMIT $9::integer');
        expect(sql).toContain('b.completion_receipt_sha256 = $2');
        expect(sql).toContain('d.search_vector @@ wanted.query');
        expect(params[8]).toBe(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES + 1);
        return { rows: [{
          candidate_count: String(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES + 1),
        }] };
      }
      if (sql.includes('ts_rank_cd')) throw new Error('rank_query_must_not_run');
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const request = decodeCaseGraphResearchToolRequest({
      tool: 'search_records',
      query: 'lights',
      filters: { kinds: ['sighting'], relationshipStatuses: ['linked'] },
      limit: 25,
    });
    if (request.tool !== 'search_records') throw new Error('unexpected_request');
    await expect(runtime.search({ active, request })).rejects.toThrow(
      'case_graph_research_search_query_too_broad',
    );
    expect(query.mock.calls.filter(([sql]) => sql.includes('bounded_candidates'))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => sql.includes('ts_rank_cd'))).toBe(false);
  });

  it('fails a timed-out cap probe as refinable too-broad without falling through to rank', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) {
        throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      }
      if (sql.includes('ranked_raw')) throw new Error('rank_query_must_not_run');
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const request = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: 'lights', limit: 25, cursor: null,
    });
    if (request.tool !== 'search_records') throw new Error('unexpected_request');
    await expect(runtime.search({ active, request })).rejects.toThrow(
      'case_graph_research_search_query_too_broad',
    );
    expect(query.mock.calls.some(([sql]) => sql.includes('ranked_raw'))).toBe(false);
  });

  it('allows the exact candidate cap and applies identical filters and finite budgets to probe and rank', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receipt = completionReceipt();
    const installed = installReceipt(storage, receipt);
    const controller = new AbortController();
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql) => {
      if (sql.includes('FROM pg_catalog.pg_index')) return { rows: [indexRow()] };
      if (sql.includes('bounded_candidates')) return {
        rows: [{ candidate_count: String(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_MAX_RANK_CANDIDATES) }],
      };
      if (sql.includes('ranked_raw')) return { rows: [] };
      return { rows: [buildRow(receipt, installed.key, installed.sha256)] };
    });
    const runtime = createPostgresCaseGraphResearchSearchRuntime({ query, storage });
    const request = decodeCaseGraphResearchToolRequest({
      tool: 'search_records',
      query: 'lights',
      filters: {
        kinds: ['sighting'],
        relationshipStatuses: ['linked'],
        sources: ['official'],
        eventStart: '2000-01-01T00:00:00.000Z',
        eventEnd: '2010-01-01T00:00:00.000Z',
      },
      limit: 25,
      cursor: null,
    });
    if (request.tool !== 'search_records') throw new Error('unexpected_request');
    await expect(runtime.search({ active, request, signal: controller.signal })).resolves.toMatchObject({
      hits: [], page: { hasMore: false, nextCursor: null },
    });
    const probe = query.mock.calls.find(([sql]) => sql.includes('bounded_candidates'))!;
    const rank = query.mock.calls.find(([sql]) => sql.includes('ranked_raw'))!;
    expect(probe[1].slice(0, 8)).toEqual(rank[1].slice(0, 8));
    for (const fragment of [
      'b.completion_receipt_sha256 = $2',
      'd.search_vector @@ wanted.query',
      'd.kind = ANY($4::text[])',
      'd.relationship_status = ANY($5::text[])',
      'd.source_key = ANY($6::text[])',
      'd.event_timestamp >= $7::timestamptz',
      'd.event_timestamp < $8::timestamptz',
    ]) {
      expect(probe[0]).toContain(fragment);
      expect(rank[0]).toContain(fragment);
    }
    expect(probe[2]).toEqual({
      queryTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
      statementTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_QUERY_TIMEOUT_MS,
      signal: controller.signal,
    });
    expect(rank[2]).toEqual(probe[2]);
  });
});

class MemoryBuildStore implements CaseGraphResearchSearchPostgresBuildStore {
  readonly documents = new Map<string, ReturnType<typeof projectCaseGraphResearchSearchPostgresDocument>>();
  readonly finalRows = new Map<string, CaseGraphResearchSearchPostgresFinalRow>();
  readonly receipts: CaseGraphResearchSearchPostgresSourceShardReceipt[] = [];
  readonly events: string[] = [];
  pendingReceipt: CaseGraphResearchSearchPostgresCompletionReceipt | null = null;
  pendingAttemptAudit: Parameters<CaseGraphResearchSearchPostgresBuildStore['markReceiptPending']>[0]['attemptAudit'] | null = null;
  failed: string | null = null;

  acquire: CaseGraphResearchSearchPostgresBuildStore['acquire'] = async () => {
    this.events.push('acquire');
    return {
      status: 'acquired' as const,
      phase: 'building' as const,
      leaseToken: '00000000-0000-4000-8000-000000000111',
    };
  };
  readReceiptPending = async () => {
    if (!this.pendingReceipt) throw new Error('unexpected_pending_receipt');
    return this.pendingReceipt;
  };
  findCompletedShard = async () => null;
  findClone = async () => null;
  cloneShard = async () => { throw new Error('unexpected_clone'); };
  ingestBatch: CaseGraphResearchSearchPostgresBuildStore['ingestBatch'] = async ({ documents, lease }) => {
    let insertedDocumentCount = 0;
    let reusedDocumentCount = 0;
    for (const document of documents) {
      const existing = this.documents.get(document.nodeDigest);
      if (existing) {
        expect(existing).toEqual(document);
        reusedDocumentCount += 1;
      } else {
        this.documents.set(document.nodeDigest, document);
        insertedDocumentCount += 1;
      }
      const existingOrigin = this.finalRows.get(document.address)?.insertedByPublicationId;
      this.finalRows.set(document.address, {
        address: document.address,
        nodeDigest: document.nodeDigest,
        kind: document.kind,
        relationshipStatus: document.relationshipStatus,
        contentDigest: document.contentDigest,
        insertedByPublicationId: existingOrigin || lease.publicationId,
      });
    }
    this.events.push(`batch:${documents.length}`);
    return { insertedDocumentCount, reusedDocumentCount };
  };
  finishStreamedShard: CaseGraphResearchSearchPostgresBuildStore['finishStreamedShard'] = async ({ receipt }) => {
    this.receipts.push(receipt);
    this.events.push(`shard:${receipt.nodeShard}`);
  };
  streamFinalRows: CaseGraphResearchSearchPostgresBuildStore['streamFinalRows'] = async function* () {
    for (const row of [...this.finalRows.values()].sort((left, right) => left.address.localeCompare(right.address))) {
      yield row;
    }
  };
  inspectIndexDefinition = async () => ({ sha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256 });
  markReceiptPending: CaseGraphResearchSearchPostgresBuildStore['markReceiptPending'] = async ({ receipt, attemptAudit }) => {
    this.pendingReceipt = receipt;
    this.pendingAttemptAudit = attemptAudit;
    this.events.push('receipt_pending');
  };
  markVerified: CaseGraphResearchSearchPostgresBuildStore['markVerified'] = async () => {
    this.events.push('verified');
  };
  markFailed = async ({ errorCode }: { errorCode: string }) => { this.failed = errorCode; };
}

class VerifyRetryMemoryBuildStore extends MemoryBuildStore {
  acquisitionCount = 0;
  verificationCount = 0;

  acquire: CaseGraphResearchSearchPostgresBuildStore['acquire'] = async () => {
    this.acquisitionCount += 1;
    return {
      status: 'acquired',
      phase: this.pendingReceipt ? 'receipt_pending' : 'building',
      leaseToken: this.acquisitionCount === 1
        ? '00000000-0000-4000-8000-000000000121'
        : '00000000-0000-4000-8000-000000000122',
    };
  };

  markVerified: CaseGraphResearchSearchPostgresBuildStore['markVerified'] = async () => {
    this.verificationCount += 1;
    if (this.verificationCount === 1) {
      throw new Error('case_graph_research_search_postgres_verify_transient');
    }
    this.events.push('verified');
  };
}

class CompletedCloneMemoryBuildStore extends MemoryBuildStore {
  readonly completedByShard = new Map<number, CaseGraphResearchSearchPostgresSourceShardReceipt>();

  constructor(
    summaries: readonly FullCorpusPublicGraphShardSummary[],
    values: readonly FullCorpusPublicNode[],
    private readonly parentPublicationId: string,
  ) {
    super();
    for (const value of values) {
      const document = projectCaseGraphResearchSearchPostgresDocument(value);
      this.documents.set(document.nodeDigest, document);
      this.finalRows.set(document.address, {
        address: document.address,
        nodeDigest: document.nodeDigest,
        kind: document.kind,
        relationshipStatus: document.relationshipStatus,
        contentDigest: document.contentDigest,
        insertedByPublicationId: parentPublicationId,
      });
    }
    for (const summary of summaries) {
      const documents = values
        .filter((value) => value.address >= summary.firstKey && value.address <= summary.lastKey)
        .map(projectCaseGraphResearchSearchPostgresDocument)
        .sort((left, right) => left.address.localeCompare(right.address));
      this.completedByShard.set(summary.shard, {
        nodeShard: summary.shard,
        sourceArtifactDigest: summary.artifactDigest,
        sourceItemSetSha256: summary.itemSetSha256,
        itemCount: summary.itemCount,
        dbRowSetSha256: summary.itemSetSha256,
        searchContentSha256: createHash('sha256').update(
          documents.map((document) => `${document.address}:${document.contentDigest}`).join('\n'),
        ).digest('hex'),
        buildMode: 'cloned',
        clonedFromPublicationId: parentPublicationId,
      });
    }
  }

  findCompletedShard: CaseGraphResearchSearchPostgresBuildStore['findCompletedShard'] = async ({ summary }) => (
    this.completedByShard.get(summary.shard) || null
  );
  ingestBatch: CaseGraphResearchSearchPostgresBuildStore['ingestBatch'] = async () => {
    throw new Error('unexpected_ingest_on_completed_shard');
  };
}

describe('streaming incremental PostgreSQL search builder', () => {
  it('uses exact canonical array bytes at limit minus one, limit, and limit plus one', () => {
    expect(caseGraphResearchSearchPostgresDocumentBytes(
      projectCaseGraphResearchSearchPostgresDocument(target),
    )).toBeGreaterThan(0);
    const batchLimit = CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES;
    const totalBytes = (canonicalDocumentBytes: number) => (
      caseGraphResearchSearchPostgresBatchBytes(canonicalDocumentBytes, 1)
    );
    expect(totalBytes(batchLimit - 3)).toBe(batchLimit - 1);
    expect(totalBytes(batchLimit - 2)).toBe(batchLimit);
    expect(totalBytes(batchLimit - 1)).toBe(batchLimit + 1);
    expect(planCaseGraphResearchSearchPostgresBatchAction({
      retainedDocumentBytes: 0,
      retainedRowCount: 0,
      nextDocumentBytes: batchLimit - 3,
    })).toBe('append');
    expect(planCaseGraphResearchSearchPostgresBatchAction({
      retainedDocumentBytes: 0,
      retainedRowCount: 0,
      nextDocumentBytes: batchLimit - 2,
    })).toBe('append');
    expect(planCaseGraphResearchSearchPostgresBatchAction({
      retainedDocumentBytes: 0,
      retainedRowCount: 0,
      nextDocumentBytes: batchLimit - 1,
    })).toBe('document_too_large');
  });

  it('plans a large fixture in one bounded decision per document plus flush boundaries', () => {
    const documentByteSizes = Array.from({ length: 100_000 }, (_, index) => 240 + (index % 2_048));
    let retainedDocumentBytes = 0;
    let retainedRowCount = 0;
    let decisions = 0;
    let batchCount = 0;
    let maximumObservedRows = 0;
    let maximumObservedBytes = 0;
    let invalidAction: string | null = null;
    for (const nextDocumentBytes of documentByteSizes) {
      let action = planCaseGraphResearchSearchPostgresBatchAction({
        retainedDocumentBytes,
        retainedRowCount,
        nextDocumentBytes,
      });
      decisions += 1;
      if (action === 'flush_then_append') {
        batchCount += 1;
        retainedDocumentBytes = 0;
        retainedRowCount = 0;
        action = planCaseGraphResearchSearchPostgresBatchAction({
          retainedDocumentBytes,
          retainedRowCount,
          nextDocumentBytes,
        });
        decisions += 1;
      }
      if (action !== 'append') invalidAction = action;
      retainedDocumentBytes += nextDocumentBytes;
      retainedRowCount += 1;
      const retainedBatchBytes = caseGraphResearchSearchPostgresBatchBytes(
        retainedDocumentBytes,
        retainedRowCount,
      );
      maximumObservedRows = Math.max(maximumObservedRows, retainedRowCount);
      maximumObservedBytes = Math.max(maximumObservedBytes, retainedBatchBytes);
      if (retainedRowCount === CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_ROWS
        || retainedBatchBytes === CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES) {
        batchCount += 1;
        retainedDocumentBytes = 0;
        retainedRowCount = 0;
      }
    }
    if (retainedRowCount) batchCount += 1;
    expect(invalidAction).toBeNull();
    expect(maximumObservedRows).toBeLessThanOrEqual(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_ROWS);
    expect(maximumObservedBytes).toBeLessThanOrEqual(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES);
    expect(batchCount).toBeGreaterThan(1);
    expect(decisions).toBeLessThanOrEqual(documentByteSizes.length + batchCount);
  });

  it('streams and verifies every immutable node shard before publishing one deterministic receipt', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const controller = new AbortController();
    const store = new MemoryBuildStore();
    const byShard = new Map<number, FullCorpusPublicNode[]>(fixture.publicGraph.shards
      .filter((shard) => shard.shardKind === 'node')
      .map((shard) => [shard.shard, shard.items as FullCorpusPublicNode[]]));
    const source = {
      openVerifiedNodeShard: async function* ({ summary }: { summary: FullCorpusPublicGraphShardSummary }) {
        for (const node of byShard.get(summary.shard) || []) yield node;
      },
    };
    const result = await buildPostgresCaseGraphResearchSearchIndex({
      active,
      source,
      store,
      storage,
      signal: controller.signal,
    });
    expect(result.status).toBe('written');
    expect(result.receipt.binding).toEqual(caseGraphResearchSearchPostgresBinding(active));
    expect(result.receipt.dbNodeSetSha256).toBe(active.manifest.lineage.publicGraph.nodeSetSha256);
    expect(result.receipt.accounting).toMatchObject({
      indexedRecordCount: nodes.length,
      sourceShardCount: active.manifest.topology.nodeShardCount,
    });
    expect(store.pendingAttemptAudit?.accounting).toMatchObject({
      streamedRecordCount: nodes.length,
      insertedDocumentCount: nodes.length,
      clonedRecordCount: 0,
    });
    expect(store.events.at(-2)).toBe('receipt_pending');
    expect(store.events.at(-1)).toBe('verified');
    expect(storage.objects.get(result.receiptKey)?.equals(
      encodeCaseGraphResearchSearchPostgresCompletionReceipt(result.receipt),
    )).toBe(true);
    expect(storage.readCalls.find(({ key }) => key === result.receiptKey)?.options).toEqual({
      maxBytes: encodeCaseGraphResearchSearchPostgresCompletionReceipt(result.receipt).length,
      signal: controller.signal,
    });
  });

  it('emits the identical canonical key, body, and SHA across fresh, reused-DB, parent, and shard-order histories', async () => {
    const byShard = new Map<number, FullCorpusPublicNode[]>(fixture.publicGraph.shards
      .filter((shard) => shard.shardKind === 'node')
      .map((shard) => [shard.shard, shard.items as FullCorpusPublicNode[]]));
    const source = {
      openVerifiedNodeShard: async function* ({ summary }: { summary: FullCorpusPublicGraphShardSummary }) {
        for (const value of byShard.get(summary.shard) || []) yield value;
      },
    };

    const freshStorage = new MemoryStorage(new Map(fixture.objects));
    const freshStore = new MemoryBuildStore();
    const fresh = await buildPostgresCaseGraphResearchSearchIndex({
      active,
      source,
      store: freshStore,
      storage: freshStorage,
    });

    const reusedStorage = new MemoryStorage(new Map(fixture.objects));
    const reusedStore = new MemoryBuildStore();
    for (const value of nodes) {
      const document = projectCaseGraphResearchSearchPostgresDocument(value);
      reusedStore.documents.set(document.nodeDigest, document);
      reusedStore.finalRows.set(document.address, {
        address: document.address,
        nodeDigest: document.nodeDigest,
        kind: document.kind,
        relationshipStatus: document.relationshipStatus,
        contentDigest: document.contentDigest,
        insertedByPublicationId: '00000000-0000-4000-8000-000000000098',
      });
    }
    const reused = await buildPostgresCaseGraphResearchSearchIndex({
      active,
      source,
      store: reusedStore,
      storage: reusedStorage,
      parentPublicationId: '00000000-0000-4000-8000-000000000098',
    });
    expect(freshStore.pendingAttemptAudit?.accounting.insertedDocumentCount).toBe(nodes.length);
    expect(reusedStore.pendingAttemptAudit?.accounting.reusedDocumentCount).toBe(nodes.length);

    const reorderedActive: ActiveCaseGraphPublication = {
      ...active,
      manifest: {
        ...active.manifest,
        graphShards: [...active.manifest.graphShards].reverse(),
      },
    };
    const reorderedStorage = new MemoryStorage(new Map(fixture.objects));
    const reordered = await buildPostgresCaseGraphResearchSearchIndex({
      active: reorderedActive,
      source,
      store: new MemoryBuildStore(),
      storage: reorderedStorage,
    });

    const canonicalBodies = [fresh, reused, reordered].map((result) => (
      encodeCaseGraphResearchSearchPostgresCompletionReceipt(result.receipt)
    ));
    expect(new Set([fresh.receiptKey, reused.receiptKey, reordered.receiptKey]).size).toBe(1);
    expect(new Set([fresh.receiptSha256, reused.receiptSha256, reordered.receiptSha256]).size).toBe(1);
    expect(canonicalBodies[1].equals(canonicalBodies[0])).toBe(true);
    expect(canonicalBodies[2].equals(canonicalBodies[0])).toBe(true);
  });

  it('fails closed and never marks verified when source ordering or item-set integrity drifts', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const store = new MemoryBuildStore();
    let tampered = false;
    const source = {
      openVerifiedNodeShard: async function* ({ summary }: { summary: FullCorpusPublicGraphShardSummary }) {
        const shard = fixture.publicGraph.shards.find((candidate) => (
          candidate.shardKind === 'node' && candidate.shard === summary.shard
        ));
        const values = [...((shard?.items || []) as FullCorpusPublicNode[])];
        if (!tampered && values.length) {
          values.pop();
          tampered = true;
        }
        for (const node of values) yield node;
      },
    };
    await expect(buildPostgresCaseGraphResearchSearchIndex({
      active,
      source,
      store,
      storage,
    })).rejects.toThrow(/case_graph_research_search_postgres_source_shard/);
    expect(store.events).not.toContain('verified');
    expect(store.failed).toMatch(/case_graph_research_search_postgres_source_shard/);
  });

  it('retries after receipt upload/DB verify failure with the identical immutable body and key', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const store = new VerifyRetryMemoryBuildStore();
    let openedShardCount = 0;
    const byShard = new Map<number, FullCorpusPublicNode[]>(fixture.publicGraph.shards
      .filter((shard) => shard.shardKind === 'node')
      .map((shard) => [shard.shard, shard.items as FullCorpusPublicNode[]]));
    const source = {
      openVerifiedNodeShard: async function* ({ summary }: { summary: FullCorpusPublicGraphShardSummary }) {
        openedShardCount += 1;
        for (const value of byShard.get(summary.shard) || []) yield value;
      },
    };

    await expect(buildPostgresCaseGraphResearchSearchIndex({
      active,
      source,
      store,
      storage,
    })).rejects.toThrow('case_graph_research_search_postgres_verify_transient');
    expect(store.failed).toBeNull();
    expect(storage.conditionalUploads).toHaveLength(1);
    const firstUpload = storage.conditionalUploads[0];
    const firstOpenedShardCount = openedShardCount;

    const retried = await buildPostgresCaseGraphResearchSearchIndex({
      active,
      source,
      store,
      storage,
    });
    expect(retried.status).toBe('reused');
    expect(openedShardCount).toBe(firstOpenedShardCount);
    expect(storage.conditionalUploads).toHaveLength(2);
    expect(storage.conditionalUploads[1].key).toBe(firstUpload.key);
    expect(storage.conditionalUploads[1].body.equals(firstUpload.body)).toBe(true);
    expect(retried.receiptSha256).toBe(
      createHash('sha256').update(firstUpload.body).digest('hex'),
    );
    expect(store.verificationCount).toBe(2);
  });

  it('bounds a conflicting immutable receipt read instead of loading an oversized R2 object', async () => {
    const storage = new MemoryStorage(new Map(fixture.objects));
    const receiptKey = getCaseGraphResearchSearchPostgresReceiptKey(
      active.corpusVersion,
      active.publicationId,
      active.manifestSha256,
    );
    storage.objects.set(receiptKey, Buffer.alloc(128 * 1024, 1));
    const store = new MemoryBuildStore();
    const byShard = new Map<number, FullCorpusPublicNode[]>(fixture.publicGraph.shards
      .filter((shard) => shard.shardKind === 'node')
      .map((shard) => [shard.shard, shard.items as FullCorpusPublicNode[]]));
    await expect(buildPostgresCaseGraphResearchSearchIndex({
      active,
      source: {
        openVerifiedNodeShard: async function* ({ summary }: { summary: FullCorpusPublicGraphShardSummary }) {
          for (const value of byShard.get(summary.shard) || []) yield value;
        },
      },
      store,
      storage,
    })).rejects.toThrow('case_graph_research_search_postgres_receipt_too_large');
    const conflictingRead = storage.readCalls.find(({ key }) => key === receiptKey);
    expect(conflictingRead?.options?.maxBytes).toBeLessThan(128 * 1024);
    expect(store.events).not.toContain('verified');
  });

  it('resumes completed cloned shards without reopening sources and accounts every mapped document as reused', async () => {
    const summaries = active.manifest.graphShards
      .filter((summary): summary is FullCorpusPublicGraphShardSummary => summary.shardKind === 'node');
    const parentPublicationId = '00000000-0000-4000-8000-000000000099';
    const storage = new MemoryStorage(new Map(fixture.objects));
    const store = new CompletedCloneMemoryBuildStore(summaries, nodes, parentPublicationId);
    const result = await buildPostgresCaseGraphResearchSearchIndex({
      active,
      source: {
        openVerifiedNodeShard: async function* () {
          throw new Error('unexpected_source_open_on_completed_shard');
        },
      },
      store,
      storage,
      parentPublicationId,
    });
    expect(store.pendingAttemptAudit?.accounting).toMatchObject({
      clonedSourceShardCount: summaries.length,
      streamedSourceShardCount: 0,
      clonedRecordCount: nodes.length,
      streamedRecordCount: 0,
      reusedDocumentCount: nodes.length,
      insertedDocumentCount: 0,
      indexedRecordCount: nodes.length,
    });
  });
});
