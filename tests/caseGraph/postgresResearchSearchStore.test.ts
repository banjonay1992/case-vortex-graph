import { describe, expect, it, vi } from 'vitest';

import {
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_NAME,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
  projectCaseGraphResearchSearchPostgresDocument,
  type PostgresCaseGraphResearchSearchQuery,
  type PostgresCaseGraphResearchSearchQueryResult,
} from '../../src/caseGraph/postgresResearchSearch';
import {
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_PUBLISH_MARGIN_SECONDS,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINAL_ROW_PAGE_SIZE,
  createPostgresCaseGraphResearchSearchBuildStore,
  type PostgresCaseGraphResearchSearchBuildClient,
} from '../../src/caseGraph/postgresResearchSearchStore';
import type { ActiveCaseGraphPublication } from '../../src/caseGraph/publicAccess';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import type {
  FullCorpusPublicGraphShardSummary,
  FullCorpusPublicNode,
} from '../../src/caseGraph/typedRelationshipPublicGraph';

const publicationId = '00000000-0000-4000-8000-000000000010';
const active = {
  publicationId,
  corpusVersion: 'case-graph-v2-test',
  manifestSha256: '1'.repeat(64),
  manifest: {
    lineage: {
      snapshot: { snapshotId: '10000000-0000-4000-8000-000000000001' },
      publicGraph: { manifestDigest: '2'.repeat(64), nodeSetSha256: '3'.repeat(64) },
      graph: { artifactSetSha256: '4'.repeat(64) },
    },
    accounting: { indexedRecordCount: 1 },
    topology: { nodeShardCount: 1 },
  },
} as ActiveCaseGraphPublication;

const nodeWithoutDigest = {
  recordType: 'full_corpus_public_node',
  schemaVersion: 'fixture',
  canonicalVersion: 'fixture',
  universeSchemaVersion: 'fixture',
  universeLayoutVersion: 'fixture',
  address: 'document:alpha',
  kind: 'document',
  recordId: 'alpha',
  relationshipInputRecordDigest: '5'.repeat(64),
  relationshipStatus: 'isolated',
  source: 'official',
  sourceRecordId: null,
  title: 'Alpha document',
  summary: 'Fixture summary',
  canonicalUrl: null,
  previewUrl: null,
  eventTimestamp: null,
  lat: null,
  lon: null,
  location: null,
  countryCode: null,
  linkedSightingId: null,
  updatedAt: '2026-07-18T00:00:00.000Z',
  position: [0, 0, 0],
  degree: 0,
  neighbourCount: 0,
  candidateEvaluationCount: 0,
  edgeTypeCounts: {},
  statusReceipt: {},
} as unknown as Omit<FullCorpusPublicNode, 'nodeDigest'>;
const node = {
  ...nodeWithoutDigest,
  nodeDigest: relationshipInputSha256(nodeWithoutDigest),
} as FullCorpusPublicNode;

const row = (values: Record<string, unknown> = {}): PostgresCaseGraphResearchSearchQueryResult => ({
  rows: [values],
  rowCount: 1,
});

const makeClient = (
  responder: (sql: string, params: readonly unknown[]) => PostgresCaseGraphResearchSearchQueryResult,
  streamRows: Record<string, unknown>[] = [],
) => {
  const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql, params, options) => {
    expect(options.queryTimeoutMs).toBeGreaterThan(0);
    expect(options.statementTimeoutMs).toBeGreaterThan(0);
    if (sql.includes('FROM public.case_graph_research_search_publication_nodes AS publication_node')) {
      const after = params[1];
      const maximum = Number(params[2]);
      return {
        rows: streamRows
          .filter((value) => after == null || String(value.address) > String(after))
          .slice(0, maximum),
      };
    }
    return responder(sql, params);
  });
  const client: PostgresCaseGraphResearchSearchBuildClient = {
    query,
    transaction: async (work) => work({ query }),
    stream: async function* () { throw new Error('unexpected_cursor_stream'); },
  };
  return { client, query };
};

describe('PostgreSQL research-search build store', () => {
  it('acquires only through the guarded lifecycle RPC and maps an active foreign lease to busy', async () => {
    const leaseToken = '00000000-0000-4000-8000-000000000101';
    const acquired = makeClient((sql) => {
      if (sql.includes('create_or_acquire_case_graph_research_search_build')) return row({
        publication_id: active.publicationId,
        status: 'building',
        lease_token: leaseToken,
      });
      return { rows: [] };
    });
    const store = createPostgresCaseGraphResearchSearchBuildStore(acquired.client);
    await expect(store.acquire({
      active,
      leaseSeconds: 300,
      sourceShardCount: active.manifest.topology.nodeShardCount,
      parentPublicationId: null,
    })).resolves.toEqual({ status: 'acquired', phase: 'building', leaseToken });
    expect(acquired.query).toHaveBeenCalledTimes(1);
    expect(acquired.query.mock.calls[0][0]).toContain(
      'create_or_acquire_case_graph_research_search_build',
    );
    expect(acquired.query.mock.calls[0][0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);

    const busy = makeClient((sql) => {
      if (sql.includes('create_or_acquire_case_graph_research_search_build')) {
        throw new Error('case_graph_research_search_build_busy');
      }
      return { rows: [] };
    });
    await expect(createPostgresCaseGraphResearchSearchBuildStore(busy.client).acquire({
      active,
      leaseSeconds: 300,
      sourceShardCount: active.manifest.topology.nodeShardCount,
      parentPublicationId: null,
    })).resolves.toEqual({ status: 'busy' });
  });

  it('writes bounded parameterized batches and validates both document content and mappings', async () => {
    const document = projectCaseGraphResearchSearchPostgresDocument(node);
    const success = makeClient((sql, params) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      if (sql.includes('ingest_case_graph_research_search_batch')) {
        expect(params[3]).toBe(JSON.stringify([document]));
        return row({
          input_count: '1',
          inserted_document_count: '1',
          reused_document_count: '0',
        });
      }
      return { rows: [] };
    });
    const store = createPostgresCaseGraphResearchSearchBuildStore(success.client);
    await expect(store.ingestBatch({
      lease: {
        publicationId,
        leaseToken: '00000000-0000-4000-8000-000000000103',
      },
      nodeShard: 0,
      documents: [document],
      leaseSeconds: 300,
    })).resolves.toEqual({ insertedDocumentCount: 1, reusedDocumentCount: 0 });
    expect(success.query.mock.calls.every(([sql]) => !/\bINSERT INTO\b/.test(sql))).toBe(true);

    const collision = makeClient((sql) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      return row({
        input_count: '1',
        inserted_document_count: '0',
        reused_document_count: '0',
      });
    });
    await expect(createPostgresCaseGraphResearchSearchBuildStore(collision.client).ingestBatch({
      lease: {
        publicationId,
        leaseToken: '00000000-0000-4000-8000-000000000104',
      },
      nodeShard: 0,
      documents: [document],
      leaseSeconds: 300,
    })).rejects.toThrow('case_graph_research_search_postgres_batch_integrity_failed');
  });

  it('reads final rows through bounded keyset pages and checks the required live GIN state', async () => {
    const final = {
      address: 'document:alpha',
      node_digest: 'a'.repeat(64),
      kind: 'document',
      relationship_status: 'isolated',
      content_digest: 'b'.repeat(64),
      inserted_by_publication_id: publicationId,
    };
    const harness = makeClient((sql) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      if (sql.includes('FROM pg_catalog.pg_index')) return row({
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
      return { rows: [] };
    }, [final]);
    const store = createPostgresCaseGraphResearchSearchBuildStore(harness.client);
    const rows = [];
    for await (const value of store.streamFinalRows({
      lease: {
        publicationId: '00000000-0000-4000-8000-000000000010',
        leaseToken: '00000000-0000-4000-8000-000000000105',
      },
      leaseSeconds: 300,
    })) rows.push(value);
    expect(rows).toEqual([{
      address: final.address,
      nodeDigest: final.node_digest,
      kind: final.kind,
      relationshipStatus: final.relationship_status,
      contentDigest: final.content_digest,
      insertedByPublicationId: final.inserted_by_publication_id,
    }]);
    await expect(store.inspectIndexDefinition({})).resolves.toEqual(expect.objectContaining({
      sha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
    }));
  });

  it('preserves strict order without duplicates across a 10k keyset boundary on a max-pool-one client', async () => {
    const finalRows = Array.from(
      { length: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINAL_ROW_PAGE_SIZE + 1 },
      (_, index) => ({
        address: `document:page-${String(index).padStart(5, '0')}`,
        node_digest: 'a'.repeat(64),
        kind: 'document',
        relationship_status: 'isolated',
        content_digest: 'b'.repeat(64),
        inserted_by_publication_id: publicationId,
      }),
    );
    let queryInFlight = false;
    let renewCount = 0;
    let pageCount = 0;
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql, params) => {
      expect(queryInFlight).toBe(false);
      queryInFlight = true;
      try {
        if (sql.includes('renew_case_graph_research_search_build_lease')) {
          renewCount += 1;
          return row({ leased_until: '2026-07-18T12:00:00.000Z' });
        }
        if (sql.includes('FROM public.case_graph_research_search_publication_nodes AS publication_node')) {
          pageCount += 1;
          const after = params[1];
          return {
            rows: finalRows
              .filter((value) => after == null || value.address > String(after))
              .slice(0, Number(params[2])),
          };
        }
        return { rows: [] };
      } finally {
        queryInFlight = false;
      }
    });
    const client: PostgresCaseGraphResearchSearchBuildClient = {
      query,
      transaction: async (work) => work({ query }),
      stream: async function* () { throw new Error('cursor_would_deadlock_max_pool_one'); },
    };
    const store = createPostgresCaseGraphResearchSearchBuildStore(client);
    const addresses: string[] = [];
    for await (const value of store.streamFinalRows({
      lease: {
        publicationId,
        leaseToken: '00000000-0000-4000-8000-000000000108',
      },
      leaseSeconds: 300,
    })) addresses.push(value.address);
    expect(addresses).toEqual(finalRows.map((value) => value.address));
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(pageCount).toBe(2);
    expect(renewCount).toBe(2);
  });

  it('stops keyset paging on cancellation before yielding another row', async () => {
    const controller = new AbortController();
    const finalRows = [0, 1].map((index) => ({
      address: `document:cancel-${index}`,
      node_digest: 'a'.repeat(64),
      kind: 'document',
      relationship_status: 'isolated',
      content_digest: 'b'.repeat(64),
      inserted_by_publication_id: publicationId,
    }));
    const harness = makeClient((sql) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      return { rows: [] };
    }, finalRows);
    const iterator = createPostgresCaseGraphResearchSearchBuildStore(harness.client)
      .streamFinalRows({
        lease: {
          publicationId,
          leaseToken: '00000000-0000-4000-8000-000000000110',
        },
        leaseSeconds: 300,
        signal: controller.signal,
      })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { address: finalRows[0].address } });
    controller.abort();
    await expect(iterator.next()).rejects.toThrow('case_graph_research_aborted');
  });

  it('binds receipt-pending and verified transitions to one lease and exact receipt identity', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const harness = makeClient((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      if (sql.includes('prepare_case_graph_research_search_receipt')) {
        return row({ publication_id: publicationId, status: 'receipt_pending' });
      }
      if (sql.includes('verify_case_graph_research_search_build')) {
        return row({
          publication_id: publicationId,
          completion_receipt_key: params[2],
          completion_receipt_sha256: params[3],
        });
      }
      return { rows: [] };
    });
    const store = createPostgresCaseGraphResearchSearchBuildStore(harness.client);
    const lease = {
      publicationId: '00000000-0000-4000-8000-000000000010',
      leaseToken: '00000000-0000-4000-8000-000000000106',
    };
    const receipt = {
      recordType: 'case_graph_research_search_postgres_completion_receipt' as const,
      schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
      binding: {
        publicationId: lease.publicationId,
        corpusVersion: 'case-graph-v2-test',
        snapshotId: 'snapshot:test',
        publicManifestSha256: '1'.repeat(64),
        publicManifestDigest: '2'.repeat(64),
        graphArtifactSetSha256: '3'.repeat(64),
        publicNodeSetSha256: '4'.repeat(64),
        expectedRecordCount: 1,
      },
      tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
      rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
      indexDefinitionVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
      indexDefinitionSha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
      sourceShardSetSha256: '5'.repeat(64),
      dbNodeSetSha256: '4'.repeat(64),
      searchContentSetSha256: '6'.repeat(64),
      accounting: {
        sourceShardCount: 1,
        indexedRecordCount: 1,
      },
      sentinels: [{ kind: 'document' as const, address: 'document:alpha', nodeDigest: 'a'.repeat(64) }],
    };
    const attemptAudit = {
      buildDeltaSha256: '7'.repeat(64),
      accounting: {
        sourceShardCount: 1,
        clonedSourceShardCount: 0,
        streamedSourceShardCount: 1,
        clonedRecordCount: 0,
        streamedRecordCount: 1,
        indexedRecordCount: 1,
        reusedDocumentCount: 0,
        insertedDocumentCount: 1,
      },
    };
    await store.markReceiptPending({
      lease,
      receipt,
      attemptAudit,
    });
    const receiptKey = 'case-vortex/corpora/case-graph-v2-test/research-search/postgres-v1/publications/00000000-0000-4000-8000-000000000010/1111111111111111111111111111111111111111111111111111111111111111/_complete.receipt.json';
    await store.markVerified({
      lease,
      receiptKey,
      receiptSha256: '8'.repeat(64),
    });
    expect(calls.some(({ sql }) => sql.includes('prepare_case_graph_research_search_receipt'))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes('verify_case_graph_research_search_build'))).toBe(true);
    const prepare = calls.find(({ sql }) => sql.includes('prepare_case_graph_research_search_receipt'));
    expect(Object.keys(JSON.parse(String(prepare?.params[2]))).sort()).toEqual([
      'accounting',
      'buildDeltaSha256',
      'dbNodeSetSha256',
      'indexDefinitionSha256',
      'searchContentSetSha256',
      'sentinels',
      'sourceShardSetSha256',
    ]);
    const renewCall = harness.query.mock.calls.find(([sql]) => (
      sql.includes('renew_case_graph_research_search_build_lease')
    ));
    const prepareCall = harness.query.mock.calls.find(([sql]) => (
      sql.includes('prepare_case_graph_research_search_receipt')
    ));
    const finalizeRenewCalls = harness.query.mock.calls.filter(([sql]) => (
      sql.includes('renew_case_graph_research_search_build_lease')
    ));
    expect(renewCall?.[1][2]).toBe(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS);
    expect(prepareCall?.[2]).toMatchObject({
      queryTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS,
      statementTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS,
    });
    expect(finalizeRenewCalls).toHaveLength(1);
    expect(finalizeRenewCalls.every(([, params]) => (
      params[2] === CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS
    ))).toBe(true);
    expect(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS).toBeGreaterThan(
      Math.ceil(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS / 1_000)
        + CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_PUBLISH_MARGIN_SECONDS,
    );
    expect(calls.at(-1)?.params.slice(0, 4)).toEqual([
      lease.publicationId,
      lease.leaseToken,
      receiptKey,
      '8'.repeat(64),
    ]);
    expect(calls.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
  });

  it('rolls back a cancelled long finalize and permits a deterministic retry', async () => {
    let receiptPending = false;
    let prepareAttempts = 0;
    const query = vi.fn<PostgresCaseGraphResearchSearchQuery>(async (sql, _params, options) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:20:00.000Z' });
      }
      if (sql.includes('prepare_case_graph_research_search_receipt')) {
        expect(options.queryTimeoutMs).toBeGreaterThan(30_000);
        expect(options.statementTimeoutMs).toBe(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS);
        prepareAttempts += 1;
        receiptPending = true;
        if (prepareAttempts === 1) {
          throw new Error('case_graph_research_search_postgres_finalize_timeout');
        }
        return row({ publication_id: publicationId, status: 'receipt_pending' });
      }
      return { rows: [] };
    });
    const client: PostgresCaseGraphResearchSearchBuildClient = {
      query,
      transaction: async (work) => {
        const before = receiptPending;
        try {
          return await work({ query });
        } catch (error) {
          receiptPending = before;
          throw error;
        }
      },
      stream: async function* () { /* unused */ },
    };
    const store = createPostgresCaseGraphResearchSearchBuildStore(client);
    const lease = {
      publicationId,
      leaseToken: '00000000-0000-4000-8000-000000000109',
    };
    const receipt = {
      recordType: 'case_graph_research_search_postgres_completion_receipt' as const,
      schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
      binding: {
        publicationId,
        corpusVersion: active.corpusVersion,
        snapshotId: active.manifest.lineage.snapshot.snapshotId,
        publicManifestSha256: active.manifestSha256,
        publicManifestDigest: active.manifest.lineage.publicGraph.manifestDigest,
        graphArtifactSetSha256: active.manifest.lineage.graph.artifactSetSha256,
        publicNodeSetSha256: active.manifest.lineage.publicGraph.nodeSetSha256,
        expectedRecordCount: 1,
      },
      tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
      rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
      indexDefinitionVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
      indexDefinitionSha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
      sourceShardSetSha256: '5'.repeat(64),
      dbNodeSetSha256: active.manifest.lineage.publicGraph.nodeSetSha256,
      searchContentSetSha256: '6'.repeat(64),
      accounting: { sourceShardCount: 1, indexedRecordCount: 1 },
      sentinels: [{ kind: 'document' as const, address: node.address, nodeDigest: node.nodeDigest }],
    };
    const attemptAudit = {
      buildDeltaSha256: '7'.repeat(64),
      accounting: {
        sourceShardCount: 1,
        clonedSourceShardCount: 0,
        streamedSourceShardCount: 1,
        clonedRecordCount: 0,
        streamedRecordCount: 1,
        indexedRecordCount: 1,
        reusedDocumentCount: 0,
        insertedDocumentCount: 1,
      },
    };

    await expect(store.markReceiptPending({ lease, receipt, attemptAudit }))
      .rejects.toThrow('case_graph_research_search_postgres_finalize_timeout');
    expect(receiptPending).toBe(false);
    await expect(store.markReceiptPending({ lease, receipt, attemptAudit })).resolves.toBeUndefined();
    expect(receiptPending).toBe(true);
    expect(prepareAttempts).toBe(2);
  });

  it('does not expose a parent shard clone when any semantic build version differs', async () => {
    const lease = {
      publicationId,
      leaseToken: '00000000-0000-4000-8000-000000000111',
    };
    const summary = {
      shardKind: 'node',
      shard: 0,
      shardCount: 1,
      itemCount: 1,
      artifactDigest: '6'.repeat(64),
      itemSetSha256: '7'.repeat(64),
      firstKey: node.address,
      lastKey: node.address,
    } as FullCorpusPublicGraphShardSummary;
    const harness = makeClient((sql, params) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      if (sql.includes('source_shard.publication_id AS clone_publication_id')) {
        expect(sql).toContain(
          'source_build.schema_version = target_build.schema_version',
        );
        expect(sql).toContain(
          'source_build.tokenizer_version = target_build.tokenizer_version',
        );
        expect(sql).toContain(
          'source_build.ranking_version = target_build.ranking_version',
        );
        expect(sql).toContain(
          'source_build.index_definition_version = target_build.index_definition_version',
        );
        expect(sql).toContain(
          'source_build.index_definition_sha256 = target_build.index_definition_sha256',
        );
        expect(params).toEqual([
          summary.shard,
          summary.artifactDigest,
          summary.itemSetSha256,
          summary.itemCount,
          lease.publicationId,
          lease.leaseToken,
        ]);
        // PostgreSQL returns no row when even one of the exact version guards differs.
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(createPostgresCaseGraphResearchSearchBuildStore(harness.client).findClone({
      lease,
      summary,
    })).resolves.toBeNull();
    expect(harness.query.mock.calls.filter(([sql]) => (
      sql.includes('source_shard.publication_id AS clone_publication_id')
    ))).toHaveLength(1);
  });

  it('reads only token-bound resumable shard and prepared-receipt state', async () => {
    const lease = {
      publicationId,
      leaseToken: '00000000-0000-4000-8000-000000000107',
    };
    const sourceRow = {
      publication_id: publicationId,
      node_shard: 0,
      build_mode: 'streamed',
      cloned_from_publication_id: null,
      source_artifact_digest: '6'.repeat(64),
      source_item_set_sha256: '7'.repeat(64),
      item_count: '1',
      db_row_set_sha256: '7'.repeat(64),
      search_content_sha256: '8'.repeat(64),
    };
    const pendingRow = {
      publication_id: publicationId,
      corpus_version: active.corpusVersion,
      snapshot_id: active.manifest.lineage.snapshot.snapshotId,
      public_manifest_sha256: active.manifestSha256,
      public_manifest_digest: active.manifest.lineage.publicGraph.manifestDigest,
      graph_artifact_set_sha256: active.manifest.lineage.graph.artifactSetSha256,
      public_node_set_sha256: active.manifest.lineage.publicGraph.nodeSetSha256,
      expected_record_count: '1',
      indexed_record_count: '1',
      schema_version: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
      tokenizer_version: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
      ranking_version: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
      index_definition_version: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
      index_definition_sha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
      source_shard_count: '1',
      source_shard_set_sha256: '9'.repeat(64),
      db_node_set_sha256: active.manifest.lineage.publicGraph.nodeSetSha256,
      search_content_set_sha256: 'a'.repeat(64),
      build_delta_sha256: 'b'.repeat(64),
      cloned_source_shard_count: '0',
      streamed_source_shard_count: '1',
      cloned_record_count: '0',
      streamed_record_count: '1',
      reused_document_count: '0',
      inserted_document_count: '1',
      sentinels: [{ kind: 'document', address: node.address, nodeDigest: node.nodeDigest }],
    };
    const harness = makeClient((sql) => {
      if (sql.includes('renew_case_graph_research_search_build_lease')) {
        return row({ leased_until: '2026-07-18T12:00:00.000Z' });
      }
      if (sql.includes('read_case_graph_research_search_source_shard')) return row(sourceRow);
      if (sql.includes('read_case_graph_research_search_receipt_pending')) return row(pendingRow);
      return { rows: [] };
    });
    const store = createPostgresCaseGraphResearchSearchBuildStore(harness.client);
    await expect(store.findCompletedShard({
      lease,
      summary: {
        shardKind: 'node',
        shard: 0,
        shardCount: 1,
        itemCount: 1,
        artifactDigest: sourceRow.source_artifact_digest,
        itemSetSha256: sourceRow.source_item_set_sha256,
        firstKey: node.address,
        lastKey: node.address,
      } as FullCorpusPublicGraphShardSummary,
    })).resolves.toMatchObject({
      buildMode: 'streamed',
      sourceArtifactDigest: sourceRow.source_artifact_digest,
      searchContentSha256: sourceRow.search_content_sha256,
    });
    await expect(store.readReceiptPending({ active, lease })).resolves.toMatchObject({
      binding: { publicationId, publicManifestSha256: active.manifestSha256 },
      accounting: { sourceShardCount: 1, indexedRecordCount: 1 },
    });
    expect(harness.query.mock.calls.some(([sql]) => (
      sql.includes('read_case_graph_research_search_source_shard')
    ))).toBe(true);
    expect(harness.query.mock.calls.some(([sql]) => (
      sql.includes('read_case_graph_research_search_receipt_pending')
    ))).toBe(true);
  });
});
