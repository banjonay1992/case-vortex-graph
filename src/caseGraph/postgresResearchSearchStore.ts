import {
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
  caseGraphResearchSearchPostgresBinding,
  decodeCaseGraphResearchSearchPostgresCompletionReceipt,
  inspectPostgresCaseGraphResearchSearchIndexDefinition,
  type PostgresCaseGraphResearchSearchQuery,
  type PostgresCaseGraphResearchSearchQueryOptions,
  type PostgresCaseGraphResearchSearchQueryResult,
} from './postgresResearchSearch';
import type {
  CaseGraphResearchSearchPostgresBuildStore,
  CaseGraphResearchSearchPostgresFinalRow,
  CaseGraphResearchSearchPostgresSourceShardReceipt,
} from './postgresResearchSearchBuilder';

export type PostgresCaseGraphResearchSearchTransaction = {
  query: PostgresCaseGraphResearchSearchQuery;
};

/**
 * Host-owned pool adapter. `transaction` must pin one connection and roll back
 * on throw. Final-row verification deliberately uses bounded keyset pages on
 * `query`, so a build worker is safe with a max-pool size of one. The adapter
 * must propagate AbortSignal to the database driver.
 */
export type PostgresCaseGraphResearchSearchBuildClient = {
  query: PostgresCaseGraphResearchSearchQuery;
  transaction: <T>(work: (transaction: PostgresCaseGraphResearchSearchTransaction) => Promise<T>) => Promise<T>;
  /** @deprecated Retained for host compatibility; the build store does not use it. */
  stream: (
    sql: string,
    params: readonly unknown[],
    options: PostgresCaseGraphResearchSearchQueryOptions,
  ) => AsyncIterable<Record<string, unknown>>;
};

const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_SECONDS = 300;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS = 10 * 60 * 1_000;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_PUBLISH_MARGIN_SECONDS = 5 * 60;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS = 20 * 60;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINAL_ROW_PAGE_SIZE = 10_000;
if (CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS
  <= Math.ceil(CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS / 1_000)
    + CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_PUBLISH_MARGIN_SECONDS) {
  throw new Error('case_graph_research_search_postgres_finalize_window_invalid');
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw new Error(code); };
const timeout = (signal?: AbortSignal): PostgresCaseGraphResearchSearchQueryOptions => ({
  queryTimeoutMs: MAX_TIMEOUT_MS,
  statementTimeoutMs: MAX_TIMEOUT_MS,
  signal,
});
const finalizeTimeout = (signal?: AbortSignal): PostgresCaseGraphResearchSearchQueryOptions => ({
  queryTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS,
  statementTimeoutMs: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_TIMEOUT_MS,
  signal,
});
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail('case_graph_research_aborted');
};
const count = (value: unknown, maximum = 10_000_000) => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0 || Number(numeric) > maximum) {
    fail('case_graph_research_search_postgres_store_count_invalid');
  }
  return Number(numeric);
};
const uuid = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !UUID.test(value)) fail(code);
  return value as string;
};
const digest = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code);
  return value as string;
};
const one = (result: PostgresCaseGraphResearchSearchQueryResult, code: string) => {
  if (result.rows.length !== 1) fail(code);
  return result.rows[0];
};
const leaseSeconds = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 30 || value > 3_600) {
    fail('case_graph_research_search_postgres_lease_duration_invalid');
  }
  return value;
};
const isBusyError = (error: unknown) => (
  error instanceof Error && error.message.includes('case_graph_research_search_build_busy')
);

const assertLease = async (params: {
  query: PostgresCaseGraphResearchSearchQuery;
  publicationId: string;
  leaseToken: string;
  leaseSeconds: number;
  signal?: AbortSignal;
}) => {
  abort(params.signal);
  const result = await params.query(`
    SELECT public.renew_case_graph_research_search_build_lease(
      $1::uuid, $2::uuid, $3::integer
    ) AS leased_until
  `, [
    params.publicationId,
    params.leaseToken,
    leaseSeconds(params.leaseSeconds),
  ], timeout(params.signal));
  const row = one(result, 'case_graph_research_search_postgres_build_lease_lost');
  if (typeof row.leased_until !== 'string' && !(row.leased_until instanceof Date)) {
    fail('case_graph_research_search_postgres_build_lease_lost');
  }
};

const decodeSourceReceipt = (
  row: Record<string, unknown>,
  clonedFromPublicationId: string | null,
): CaseGraphResearchSearchPostgresSourceShardReceipt => {
  const buildMode = clonedFromPublicationId ? 'cloned' : row.build_mode;
  if (buildMode !== 'cloned' && buildMode !== 'streamed') {
    fail('case_graph_research_search_postgres_source_receipt_invalid');
  }
  return {
    nodeShard: count(row.node_shard, 4_095),
    sourceArtifactDigest: digest(row.source_artifact_digest, 'case_graph_research_search_postgres_source_receipt_invalid'),
    sourceItemSetSha256: digest(row.source_item_set_sha256, 'case_graph_research_search_postgres_source_receipt_invalid'),
    itemCount: count(row.item_count),
    dbRowSetSha256: digest(row.db_row_set_sha256, 'case_graph_research_search_postgres_source_receipt_invalid'),
    searchContentSha256: digest(row.search_content_sha256, 'case_graph_research_search_postgres_source_receipt_invalid'),
    buildMode: buildMode as 'cloned' | 'streamed',
    clonedFromPublicationId,
  };
};

const completionForDatabase = (
  receipt: Parameters<CaseGraphResearchSearchPostgresBuildStore['markReceiptPending']>[0]['receipt'],
  attemptAudit: Parameters<CaseGraphResearchSearchPostgresBuildStore['markReceiptPending']>[0]['attemptAudit'],
) => ({
  indexDefinitionSha256: receipt.indexDefinitionSha256,
  sourceShardSetSha256: receipt.sourceShardSetSha256,
  dbNodeSetSha256: receipt.dbNodeSetSha256,
  searchContentSetSha256: receipt.searchContentSetSha256,
  buildDeltaSha256: attemptAudit.buildDeltaSha256,
  accounting: attemptAudit.accounting,
  sentinels: receipt.sentinels,
});

const decodeJson = (value: unknown, code: string): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fail(code); }
};

const decodePendingReceipt = (row: Record<string, unknown>) => (
  decodeCaseGraphResearchSearchPostgresCompletionReceipt({
    recordType: 'case_graph_research_search_postgres_completion_receipt',
    schemaVersion: row.schema_version,
    binding: {
      publicationId: row.publication_id,
      corpusVersion: row.corpus_version,
      snapshotId: row.snapshot_id,
      publicManifestSha256: row.public_manifest_sha256,
      publicManifestDigest: row.public_manifest_digest,
      graphArtifactSetSha256: row.graph_artifact_set_sha256,
      publicNodeSetSha256: row.public_node_set_sha256,
      expectedRecordCount: row.expected_record_count,
    },
    tokenizerVersion: row.tokenizer_version,
    rankingVersion: row.ranking_version,
    indexDefinitionVersion: row.index_definition_version,
    indexDefinitionSha256: row.index_definition_sha256,
    sourceShardSetSha256: row.source_shard_set_sha256,
    dbNodeSetSha256: row.db_node_set_sha256,
    searchContentSetSha256: row.search_content_set_sha256,
    accounting: {
      sourceShardCount: row.source_shard_count,
      indexedRecordCount: row.indexed_record_count,
    },
    sentinels: decodeJson(row.sentinels, 'case_graph_research_search_postgres_receipt_pending_invalid'),
  })
);

export const createPostgresCaseGraphResearchSearchBuildStore = (
  client: PostgresCaseGraphResearchSearchBuildClient,
): CaseGraphResearchSearchPostgresBuildStore => ({
  acquire: async ({ active, leaseSeconds: requestedLeaseSeconds, sourceShardCount, parentPublicationId, signal }) => {
    abort(signal);
    const binding = caseGraphResearchSearchPostgresBinding(active);
    let result: PostgresCaseGraphResearchSearchQueryResult;
    try {
      result = await client.query(`
        SELECT *
        FROM public.create_or_acquire_case_graph_research_search_build(
          $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text,
          $7::text, $8::text, $9::bigint, $10::bigint, $11::text,
          $12::text, $13::text, $14::text, $15::text, $16::integer
        )
      `, [
        binding.publicationId,
        parentPublicationId,
        binding.corpusVersion,
        binding.snapshotId,
        binding.publicManifestSha256,
        binding.publicManifestDigest,
        binding.graphArtifactSetSha256,
        binding.publicNodeSetSha256,
        binding.expectedRecordCount,
        sourceShardCount,
        CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
        CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
        CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
        CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
        CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
        leaseSeconds(requestedLeaseSeconds),
      ], timeout(signal));
    } catch (error) {
      abort(signal);
      if (isBusyError(error)) return { status: 'busy' as const };
      throw error;
    }
    const row = one(result, 'case_graph_research_search_postgres_build_create_failed');
    if (uuid(row.publication_id, 'case_graph_research_search_postgres_build_create_failed')
      !== binding.publicationId) fail('case_graph_research_search_postgres_build_create_failed');
    if (row.status === 'verified') return { status: 'verified' as const };
    const phase: 'building' | 'receipt_pending' = row.status === 'building'
      || row.status === 'receipt_pending'
      ? row.status
      : fail('case_graph_research_search_postgres_build_create_failed');
    return {
      status: 'acquired' as const,
      phase,
      leaseToken: uuid(row.lease_token, 'case_graph_research_search_postgres_build_create_failed'),
    };
  },

  readReceiptPending: async ({ active, lease, signal }) => {
    await assertLease({
      query: client.query,
      publicationId: lease.publicationId,
      leaseToken: lease.leaseToken,
      leaseSeconds: DEFAULT_LEASE_SECONDS,
      signal,
    });
    const result = await client.query(`
      SELECT *
      FROM public.read_case_graph_research_search_receipt_pending(
        $1::uuid, $2::uuid
      )
    `, [lease.publicationId, lease.leaseToken], timeout(signal));
    const receipt = decodePendingReceipt(one(
      result,
      'case_graph_research_search_postgres_receipt_pending_invalid',
    ));
    const expected = caseGraphResearchSearchPostgresBinding(active);
    if (JSON.stringify(receipt.binding) !== JSON.stringify(expected)) {
      fail('case_graph_research_search_postgres_receipt_binding_mismatch');
    }
    return receipt;
  },

  findCompletedShard: async ({ lease, summary, signal }) => {
    await assertLease({
      query: client.query,
      publicationId: lease.publicationId,
      leaseToken: lease.leaseToken,
      leaseSeconds: DEFAULT_LEASE_SECONDS,
      signal,
    });
    const result = await client.query(`
      SELECT *
      FROM public.read_case_graph_research_search_source_shard(
        $1::uuid, $2::uuid, $3::integer
      )
    `, [lease.publicationId, lease.leaseToken, summary.shard], timeout(signal));
    if (!result.rows.length) return null;
    const row = one(result, 'case_graph_research_search_postgres_source_receipt_invalid');
    const clonedFrom = row.cloned_from_publication_id == null
      ? null
      : uuid(row.cloned_from_publication_id, 'case_graph_research_search_postgres_source_receipt_invalid');
    return decodeSourceReceipt(row, clonedFrom);
  },

  findClone: async ({ lease, summary, signal }) => {
    await assertLease({
      query: client.query,
      publicationId: lease.publicationId,
      leaseToken: lease.leaseToken,
      leaseSeconds: DEFAULT_LEASE_SECONDS,
      signal,
    });
    const result = await client.query(`
      SELECT source_shard.*, source_shard.publication_id AS clone_publication_id
      FROM public.case_graph_research_search_source_shards AS source_shard
      JOIN public.case_graph_research_search_builds AS source_build
        ON source_build.publication_id = source_shard.publication_id
      JOIN public.case_graph_research_search_builds AS target_build
        ON target_build.publication_id = $5::uuid
      WHERE source_build.status = 'verified'
        AND target_build.status = 'building'
        AND target_build.lease_token = $6::uuid
        AND target_build.parent_publication_id = source_shard.publication_id
        AND source_build.schema_version = target_build.schema_version
        AND source_build.tokenizer_version = target_build.tokenizer_version
        AND source_build.ranking_version = target_build.ranking_version
        AND source_build.index_definition_version = target_build.index_definition_version
        AND source_build.index_definition_sha256 = target_build.index_definition_sha256
        AND source_shard.node_shard = $1
        AND source_shard.source_artifact_digest = $2
        AND source_shard.source_item_set_sha256 = $3
        AND source_shard.item_count = $4
      LIMIT 1
    `, [
      summary.shard,
      summary.artifactDigest,
      summary.itemSetSha256,
      summary.itemCount,
      lease.publicationId,
      lease.leaseToken,
    ], timeout(signal));
    if (!result.rows.length) return null;
    const row = one(result, 'case_graph_research_search_postgres_clone_source_invalid');
    return decodeSourceReceipt(
      row,
      uuid(row.clone_publication_id, 'case_graph_research_search_postgres_clone_source_invalid'),
    );
  },

  cloneShard: async ({ lease, summary, source, leaseSeconds: requestedLeaseSeconds, signal }) => (
    client.transaction(async (transaction) => {
      await assertLease({
        query: transaction.query,
        publicationId: lease.publicationId,
        leaseToken: lease.leaseToken,
        leaseSeconds: requestedLeaseSeconds,
        signal,
      });
      if (!source.clonedFromPublicationId) {
        fail('case_graph_research_search_postgres_clone_source_invalid');
      }
      const copied = await transaction.query(`
        SELECT public.clone_case_graph_research_search_source_shard(
          $1::uuid, $2::uuid, $3::integer, $4::uuid, $5::text, $6::text, $7::bigint
        ) AS cloned_count
      `, [
        lease.publicationId,
        lease.leaseToken,
        summary.shard,
        source.clonedFromPublicationId,
        summary.artifactDigest,
        summary.itemSetSha256,
        summary.itemCount,
      ], timeout(signal));
      if (count(one(copied, 'case_graph_research_search_postgres_clone_failed').cloned_count)
        !== summary.itemCount) fail('case_graph_research_search_postgres_clone_count_mismatch');
      const stored = await transaction.query(`
        SELECT *
        FROM public.case_graph_research_search_source_shards
        WHERE publication_id = $1::uuid
          AND node_shard = $2
          AND build_mode = 'cloned'
          AND cloned_from_publication_id = $3::uuid
      `, [lease.publicationId, summary.shard, source.clonedFromPublicationId], timeout(signal));
      const receipt = decodeSourceReceipt(
        one(stored, 'case_graph_research_search_postgres_clone_receipt_missing'),
        source.clonedFromPublicationId,
      );
      if (receipt.sourceArtifactDigest !== summary.artifactDigest
        || receipt.sourceItemSetSha256 !== summary.itemSetSha256
        || receipt.itemCount !== summary.itemCount
        || receipt.dbRowSetSha256 !== source.dbRowSetSha256
        || receipt.searchContentSha256 !== source.searchContentSha256) {
        fail('case_graph_research_search_postgres_clone_receipt_mismatch');
      }
      return receipt;
    })
  ),

  ingestBatch: async ({ lease, nodeShard, documents, leaseSeconds: requestedLeaseSeconds, signal }) => (
    client.transaction(async (transaction) => {
      if (!documents.length || documents.length > 1_000) {
        fail('case_graph_research_search_postgres_batch_invalid');
      }
      await assertLease({
        query: transaction.query,
        publicationId: lease.publicationId,
        leaseToken: lease.leaseToken,
        leaseSeconds: requestedLeaseSeconds,
        signal,
      });
      const body = JSON.stringify(documents);
      const result = await transaction.query(`
        SELECT *
        FROM public.ingest_case_graph_research_search_batch(
          $1::uuid, $2::uuid, $3::integer, $4::jsonb
        )
      `, [lease.publicationId, lease.leaseToken, nodeShard, body], timeout(signal));
      const row = one(result, 'case_graph_research_search_postgres_batch_write_failed');
      const inputCount = count(row.input_count, 1_000);
      const insertedDocumentCount = count(row.inserted_document_count, 1_000);
      if (inputCount !== documents.length
        || insertedDocumentCount > inputCount
        || count(row.reused_document_count, 1_000) !== inputCount - insertedDocumentCount) {
        fail('case_graph_research_search_postgres_batch_integrity_failed');
      }
      return { insertedDocumentCount, reusedDocumentCount: inputCount - insertedDocumentCount };
    })
  ),

  finishStreamedShard: async ({ lease, receipt, leaseSeconds: requestedLeaseSeconds, signal }) => (
    client.transaction(async (transaction) => {
      await assertLease({
        query: transaction.query,
        publicationId: lease.publicationId,
        leaseToken: lease.leaseToken,
        leaseSeconds: requestedLeaseSeconds,
        signal,
      });
      const finished = await transaction.query(`
        SELECT public.finish_case_graph_research_search_streamed_shard(
          $1::uuid, $2::uuid, $3::integer, $4::text, $5::text,
          $6::bigint, $7::text, $8::text
        ) AS finished
      `, [
        lease.publicationId,
        lease.leaseToken,
        receipt.nodeShard,
        receipt.sourceArtifactDigest,
        receipt.sourceItemSetSha256,
        receipt.itemCount,
        receipt.dbRowSetSha256,
        receipt.searchContentSha256,
      ], timeout(signal));
      one(finished, 'case_graph_research_search_postgres_shard_receipt_failed');
    })
  ),

  streamFinalRows: ({ lease, leaseSeconds: requestedLeaseSeconds, signal }) => {
    const iterator = async function* (): AsyncIterable<CaseGraphResearchSearchPostgresFinalRow> {
      let afterAddress: string | null = null;
      while (true) {
        abort(signal);
        await assertLease({
          query: client.query,
          publicationId: lease.publicationId,
          leaseToken: lease.leaseToken,
          leaseSeconds: requestedLeaseSeconds,
          signal,
        });
        const page = await client.query(`
          SELECT publication_node.address, publication_node.node_digest,
            document.kind, document.relationship_status, document.content_digest,
            document.inserted_by_publication_id
          FROM public.case_graph_research_search_publication_nodes AS publication_node
          JOIN public.case_graph_research_search_documents AS document
            ON document.node_digest = publication_node.node_digest
          WHERE publication_node.publication_id = $1::uuid
            AND ($2::text IS NULL OR publication_node.address COLLATE "C" > $2::text COLLATE "C")
          ORDER BY publication_node.address COLLATE "C"
          LIMIT $3::integer
        `, [
          lease.publicationId,
          afterAddress,
          CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINAL_ROW_PAGE_SIZE,
        ], timeout(signal));
        if (page.rows.length > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINAL_ROW_PAGE_SIZE) {
          fail('case_graph_research_search_postgres_final_row_invalid');
        }
        for (const row of page.rows) {
          abort(signal);
          const address = row.address;
          if (typeof address !== 'string'
            || (afterAddress !== null && address <= afterAddress)) {
            return fail('case_graph_research_search_postgres_final_row_invalid');
          }
          afterAddress = address;
          yield {
            address,
            nodeDigest: digest(row.node_digest, 'case_graph_research_search_postgres_final_row_invalid'),
            kind: String(row.kind) as CaseGraphResearchSearchPostgresFinalRow['kind'],
            relationshipStatus: String(row.relationship_status) as CaseGraphResearchSearchPostgresFinalRow['relationshipStatus'],
            contentDigest: digest(row.content_digest, 'case_graph_research_search_postgres_final_row_invalid'),
            insertedByPublicationId: uuid(
              row.inserted_by_publication_id,
              'case_graph_research_search_postgres_final_row_invalid',
            ),
          };
        }
        if (page.rows.length < CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINAL_ROW_PAGE_SIZE) return;
      }
    };
    return iterator();
  },

  inspectIndexDefinition: ({ signal }) => inspectPostgresCaseGraphResearchSearchIndexDefinition({
    query: client.query,
    signal,
  }),

  markReceiptPending: async ({ lease, receipt, attemptAudit, signal }) => client.transaction(async (transaction) => {
    await assertLease({
      query: transaction.query,
      publicationId: lease.publicationId,
      leaseToken: lease.leaseToken,
      leaseSeconds: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_FINALIZE_LEASE_SECONDS,
      signal,
    });
    const result = await transaction.query(`
      SELECT *
      FROM public.prepare_case_graph_research_search_receipt(
        $1::uuid, $2::uuid, $3::jsonb
      )
    `, [
      lease.publicationId,
      lease.leaseToken,
      JSON.stringify(completionForDatabase(receipt, attemptAudit)),
    ], finalizeTimeout(signal));
    const row = one(result, 'case_graph_research_search_postgres_receipt_pending_failed');
    if (uuid(row.publication_id, 'case_graph_research_search_postgres_receipt_pending_failed')
        !== lease.publicationId
      || row.status !== 'receipt_pending') {
      fail('case_graph_research_search_postgres_receipt_pending_failed');
    }
  }),

  markVerified: async ({ lease, receiptKey, receiptSha256, signal }) => (
    client.transaction(async (transaction) => {
      const result = await transaction.query(`
        SELECT *
        FROM public.verify_case_graph_research_search_build(
          $1::uuid, $2::uuid, $3::text, $4::text
        )
      `, [lease.publicationId, lease.leaseToken, receiptKey, receiptSha256], timeout(signal));
      const row = one(result, 'case_graph_research_search_postgres_verify_failed');
      if (uuid(row.publication_id, 'case_graph_research_search_postgres_verify_failed')
          !== lease.publicationId
        || row.completion_receipt_key !== receiptKey
        || digest(row.completion_receipt_sha256, 'case_graph_research_search_postgres_verify_failed')
          !== receiptSha256) {
        fail('case_graph_research_search_postgres_verify_failed');
      }
    })
  ),

  markFailed: async ({ lease, errorCode }) => {
    await client.query(`
      SELECT public.fail_case_graph_research_search_build(
        $1::uuid, $2::uuid, $3::text, NULL::text
      )
    `, [lease.publicationId, lease.leaseToken, errorCode], timeout());
  },
});
