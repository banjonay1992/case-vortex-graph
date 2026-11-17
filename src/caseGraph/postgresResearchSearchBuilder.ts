import { createHash } from 'node:crypto';

import { getCaseGraphResearchSearchPostgresReceiptKey } from './archiveKeys';
import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphConditionalWriteResult,
} from './archiveTypes';
import type { ActiveCaseGraphPublication } from './publicAccess';
import {
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
  CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
  caseGraphResearchSearchPostgresBinding,
  caseGraphResearchSearchPostgresKinds,
  caseGraphResearchSearchPostgresRelationshipStatuses,
  encodeCaseGraphResearchSearchPostgresCompletionReceipt,
  projectCaseGraphResearchSearchPostgresDocument,
  type CaseGraphResearchSearchPostgresAccounting,
  type CaseGraphResearchSearchPostgresCompletionReceipt,
  type CaseGraphResearchSearchPostgresDocument,
  type CaseGraphResearchSearchPostgresSentinel,
} from './postgresResearchSearch';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import { fullCorpusRelationshipShard } from './typedRelationshipPipeline';
import type {
  FullCorpusPublicGraphShardSummary,
  FullCorpusPublicNode,
  FullCorpusPublicRelationshipStatus,
} from './typedRelationshipPublicGraph';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';

export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_ROWS = 400;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES = 4 * 1024 * 1024;
export const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_LEASE_SECONDS = 300;
const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BATCH_ENVELOPE_BYTES = 2;
const CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BATCH_SEPARATOR_BYTES = 1;

export type CaseGraphResearchSearchPostgresSourceShardReceipt = {
  nodeShard: number;
  sourceArtifactDigest: string;
  sourceItemSetSha256: string;
  itemCount: number;
  dbRowSetSha256: string;
  searchContentSha256: string;
  buildMode: 'cloned' | 'streamed';
  clonedFromPublicationId: string | null;
};

export type CaseGraphResearchSearchPostgresFinalRow = {
  address: string;
  nodeDigest: string;
  kind: EvidenceUniverseNodeKind;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  contentDigest: string;
  insertedByPublicationId: string;
};

export type CaseGraphResearchSearchPostgresBuildLease = {
  publicationId: string;
  leaseToken: string;
};

/**
 * Operational metrics are deliberately excluded from the immutable canonical
 * completion receipt: clone/reuse choices depend on build history. PostgreSQL
 * records this audit separately for the concrete attempt.
 */
export type CaseGraphResearchSearchPostgresAttemptAudit = {
  buildDeltaSha256: string;
  accounting: {
    sourceShardCount: number;
    clonedSourceShardCount: number;
    streamedSourceShardCount: number;
    clonedRecordCount: number;
    streamedRecordCount: number;
    indexedRecordCount: number;
    reusedDocumentCount: number;
    insertedDocumentCount: number;
  };
};

/**
 * The source adapter must stream one already archive-verified public node shard.
 * The builder independently rechecks ordering, routing, node digests, boundaries,
 * item count and the immutable item-set digest before accepting the shard.
 */
export type CaseGraphResearchSearchPostgresNodeSource = {
  openVerifiedNodeShard: (params: {
    active: ActiveCaseGraphPublication;
    summary: FullCorpusPublicGraphShardSummary;
    signal?: AbortSignal;
  }) => AsyncIterable<FullCorpusPublicNode>;
};

/**
 * Database port for the offline builder. Every mutating method must use a short
 * transaction, assert/renew the lease, and leave non-verified builds invisible
 * to serving queries. `streamFinalRows` must use one repeatable-read snapshot.
 */
export type CaseGraphResearchSearchPostgresBuildStore = {
  acquire: (params: {
    active: ActiveCaseGraphPublication;
    leaseSeconds: number;
    sourceShardCount: number;
    parentPublicationId: string | null;
    signal?: AbortSignal;
  }) => Promise<
    | { status: 'acquired'; phase: 'building' | 'receipt_pending'; leaseToken: string }
    | { status: 'busy' }
    | { status: 'verified' }
  >;
  readReceiptPending: (params: {
    active: ActiveCaseGraphPublication;
    lease: CaseGraphResearchSearchPostgresBuildLease;
    signal?: AbortSignal;
  }) => Promise<CaseGraphResearchSearchPostgresCompletionReceipt>;
  findCompletedShard: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    summary: FullCorpusPublicGraphShardSummary;
    signal?: AbortSignal;
  }) => Promise<CaseGraphResearchSearchPostgresSourceShardReceipt | null>;
  findClone: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    summary: FullCorpusPublicGraphShardSummary;
    signal?: AbortSignal;
  }) => Promise<CaseGraphResearchSearchPostgresSourceShardReceipt | null>;
  cloneShard: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    summary: FullCorpusPublicGraphShardSummary;
    source: CaseGraphResearchSearchPostgresSourceShardReceipt;
    leaseSeconds: number;
    signal?: AbortSignal;
  }) => Promise<CaseGraphResearchSearchPostgresSourceShardReceipt>;
  ingestBatch: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    nodeShard: number;
    documents: readonly CaseGraphResearchSearchPostgresDocument[];
    leaseSeconds: number;
    signal?: AbortSignal;
  }) => Promise<{ insertedDocumentCount: number; reusedDocumentCount: number }>;
  finishStreamedShard: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    receipt: CaseGraphResearchSearchPostgresSourceShardReceipt;
    leaseSeconds: number;
    signal?: AbortSignal;
  }) => Promise<void>;
  streamFinalRows: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    leaseSeconds: number;
    signal?: AbortSignal;
  }) => AsyncIterable<CaseGraphResearchSearchPostgresFinalRow>;
  inspectIndexDefinition: (params: {
    signal?: AbortSignal;
  }) => Promise<{ sha256: string }>;
  markReceiptPending: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    receipt: CaseGraphResearchSearchPostgresCompletionReceipt;
    attemptAudit: CaseGraphResearchSearchPostgresAttemptAudit;
    signal?: AbortSignal;
  }) => Promise<void>;
  markVerified: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    receiptKey: string;
    receiptSha256: string;
    signal?: AbortSignal;
  }) => Promise<void>;
  markFailed: (params: {
    lease: CaseGraphResearchSearchPostgresBuildLease;
    errorCode: string;
  }) => Promise<void>;
};

export type CaseGraphResearchSearchPostgresBuildResult = {
  status: 'written' | 'reused';
  receiptKey: string;
  receiptSha256: string;
  receipt: CaseGraphResearchSearchPostgresCompletionReceipt;
};

const fail = (code: string): never => { throw new Error(code); };
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail('case_graph_research_aborted');
};
const digestLines = () => {
  const hash = createHash('sha256');
  let count = 0;
  return {
    add: (line: string) => {
      if (count) hash.update('\n');
      hash.update(line);
      count += 1;
    },
    digest: () => hash.digest('hex'),
    count: () => count,
  };
};

const immutableUpload = async (params: {
  storage: Pick<CaseGraphConditionalArchiveStorage, 'readObject' | 'uploadFileConditional'>;
  key: string;
  body: Buffer;
  signal?: AbortSignal;
}) => {
  abort(params.signal);
  const result: CaseGraphConditionalWriteResult = await params.storage.uploadFileConditional(
    params.body,
    params.key,
    {
      contentType: 'application/json',
      cacheControl: 'private, max-age=31536000, immutable',
      contentLength: params.body.length,
    },
    { ifAbsent: true },
  );
  abort(params.signal);
  if (result.status === 'precondition_failed') {
    const existing = await params.storage.readObject(params.key, {
      maxBytes: params.body.length,
      signal: params.signal,
    });
    if (!existing || !existing.equals(params.body)) {
      fail('case_graph_research_search_postgres_receipt_immutable_conflict');
    }
    return 'reused' as const;
  }
  const stored = await params.storage.readObject(params.key, {
    maxBytes: params.body.length,
    signal: params.signal,
  });
  if (!stored || !stored.equals(params.body)) {
    fail('case_graph_research_search_postgres_receipt_read_after_write_failed');
  }
  return 'written' as const;
};

const nodeShardSummaries = (active: ActiveCaseGraphPublication) => {
  const summaries = active.manifest.graphShards
    .filter((summary) => summary.shardKind === 'node')
    .sort((left, right) => left.shard - right.shard);
  if (summaries.length !== active.manifest.topology.nodeShardCount
    || summaries.some((summary, index) => (
      summary.shard !== index || summary.shardCount !== summaries.length
    ))
    || summaries.reduce((sum, summary) => sum + summary.itemCount, 0)
      !== active.manifest.accounting.indexedRecordCount) {
    fail('case_graph_research_search_postgres_source_shards_invalid');
  }
  return summaries;
};

export const caseGraphResearchSearchPostgresDocumentBytes = (
  document: CaseGraphResearchSearchPostgresDocument,
) => Buffer.byteLength(canonicalizeRelationshipInput(document), 'utf8');

export const caseGraphResearchSearchPostgresBatchBytes = (
  documentBytes: number,
  rowCount: number,
) => {
  if (!Number.isSafeInteger(documentBytes) || documentBytes < 0
    || !Number.isSafeInteger(rowCount) || rowCount < 0
    || (rowCount === 0 && documentBytes !== 0)) {
    fail('case_graph_research_search_postgres_batch_size_invalid');
  }
  return CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BATCH_ENVELOPE_BYTES
    + documentBytes
    + Math.max(0, rowCount - 1) * CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BATCH_SEPARATOR_BYTES;
};

export type CaseGraphResearchSearchPostgresBatchAction =
  | 'append'
  | 'flush_then_append'
  | 'document_too_large';

/**
 * O(1) batch decision over already-measured canonical document bytes. The
 * builder measures each document exactly once and never serializes the growing
 * JSON array merely to decide whether it still fits.
 */
export const planCaseGraphResearchSearchPostgresBatchAction = (params: {
  retainedDocumentBytes: number;
  retainedRowCount: number;
  nextDocumentBytes: number;
}): CaseGraphResearchSearchPostgresBatchAction => {
  const singletonBytes = caseGraphResearchSearchPostgresBatchBytes(params.nextDocumentBytes, 1);
  if (singletonBytes > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES) {
    return 'document_too_large';
  }
  const nextRows = params.retainedRowCount + 1;
  const nextBytes = caseGraphResearchSearchPostgresBatchBytes(
    params.retainedDocumentBytes + params.nextDocumentBytes,
    nextRows,
  );
  if (params.retainedRowCount > 0 && (
    nextRows > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_ROWS
    || nextBytes > CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES
  )) return 'flush_then_append';
  return 'append';
};

const validateFinalAccounting = (params: {
  active: ActiveCaseGraphPublication;
  indexedRecordCount: number;
  nodeSetSha256: string;
  byKind: Record<EvidenceUniverseNodeKind, number>;
  byStatus: Record<FullCorpusPublicRelationshipStatus, number>;
}) => {
  if (params.indexedRecordCount !== params.active.manifest.accounting.indexedRecordCount
    || params.nodeSetSha256 !== params.active.manifest.lineage.publicGraph.nodeSetSha256
    || canonicalizeRelationshipInput(params.byKind)
      !== canonicalizeRelationshipInput(params.active.manifest.accounting.addressKindCounts)
    || canonicalizeRelationshipInput(params.byStatus)
      !== canonicalizeRelationshipInput(params.active.manifest.accounting.relationshipStatusCounts)) {
    fail('case_graph_research_search_postgres_final_accounting_mismatch');
  }
};

const normalizeErrorCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'case_graph_research_search_postgres_build_failed';
  return /^[a-z0-9][a-z0-9._:-]{0,239}$/.test(message)
    ? message
    : 'case_graph_research_search_postgres_build_failed';
};

export const buildPostgresCaseGraphResearchSearchIndex = async (params: {
  active: ActiveCaseGraphPublication;
  source: CaseGraphResearchSearchPostgresNodeSource;
  store: CaseGraphResearchSearchPostgresBuildStore;
  storage: Pick<CaseGraphConditionalArchiveStorage, 'readObject' | 'uploadFileConditional'>;
  parentPublicationId?: string | null;
  signal?: AbortSignal;
}): Promise<CaseGraphResearchSearchPostgresBuildResult> => {
  abort(params.signal);
  const summaries = nodeShardSummaries(params.active);
  const acquisition = await params.store.acquire({
    active: params.active,
    leaseSeconds: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_LEASE_SECONDS,
    sourceShardCount: summaries.length,
    parentPublicationId: params.parentPublicationId ?? null,
    signal: params.signal,
  });
  if (acquisition.status !== 'acquired') {
    fail(acquisition.status === 'busy'
      ? 'case_graph_research_search_postgres_build_busy'
      : 'case_graph_research_search_postgres_build_already_verified');
  }
  const acquired = acquisition as Extract<typeof acquisition, { status: 'acquired' }>;
  const lease: CaseGraphResearchSearchPostgresBuildLease = {
    publicationId: params.active.publicationId,
    leaseToken: acquired.leaseToken,
  };

  const publishPreparedReceipt = async (
    receipt: CaseGraphResearchSearchPostgresCompletionReceipt,
  ): Promise<CaseGraphResearchSearchPostgresBuildResult> => {
    if (canonicalizeRelationshipInput(receipt.binding)
      !== canonicalizeRelationshipInput(caseGraphResearchSearchPostgresBinding(params.active))) {
      fail('case_graph_research_search_postgres_receipt_binding_mismatch');
    }
    const receiptBody = encodeCaseGraphResearchSearchPostgresCompletionReceipt(receipt);
    const receiptSha256 = createHash('sha256').update(receiptBody).digest('hex');
    const receiptKey = getCaseGraphResearchSearchPostgresReceiptKey(
      params.active.corpusVersion,
      params.active.publicationId,
      params.active.manifestSha256,
    );
    const status = await immutableUpload({
      storage: params.storage,
      key: receiptKey,
      body: receiptBody,
      signal: params.signal,
    });
    await params.store.markVerified({
      lease,
      receiptKey,
      receiptSha256,
      signal: params.signal,
    });
    return { status, receiptKey, receiptSha256, receipt };
  };

  let receiptPrepared = acquired.phase === 'receipt_pending';
  try {
    if (acquired.phase === 'receipt_pending') {
      return await publishPreparedReceipt(await params.store.readReceiptPending({
        active: params.active,
        lease,
        signal: params.signal,
      }));
    }
    const shardReceipts: CaseGraphResearchSearchPostgresSourceShardReceipt[] = [];
    let clonedSourceShardCount = 0;
    let streamedSourceShardCount = 0;
    let clonedRecordCount = 0;
    let streamedRecordCount = 0;

    for (const summary of summaries) {
      abort(params.signal);
      const completed = await params.store.findCompletedShard({
        lease,
        summary,
        signal: params.signal,
      });
      if (completed) {
        if (completed.nodeShard !== summary.shard
          || completed.sourceArtifactDigest !== summary.artifactDigest
          || completed.sourceItemSetSha256 !== summary.itemSetSha256
          || completed.itemCount !== summary.itemCount
          || completed.dbRowSetSha256 !== summary.itemSetSha256) {
          fail('case_graph_research_search_postgres_completed_shard_invalid');
        }
        shardReceipts.push(completed);
        if (completed.buildMode === 'cloned') {
          clonedSourceShardCount += 1;
          clonedRecordCount += completed.itemCount;
        } else {
          streamedSourceShardCount += 1;
          streamedRecordCount += completed.itemCount;
        }
        continue;
      }
      const clone = await params.store.findClone({ lease, summary, signal: params.signal });
      if (clone) {
        const receipt = await params.store.cloneShard({
          lease,
          summary,
          source: clone,
          leaseSeconds: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_LEASE_SECONDS,
          signal: params.signal,
        });
        if (receipt.buildMode !== 'cloned'
          || receipt.nodeShard !== summary.shard
          || receipt.sourceArtifactDigest !== summary.artifactDigest
          || receipt.sourceItemSetSha256 !== summary.itemSetSha256
          || receipt.itemCount !== summary.itemCount
          || receipt.dbRowSetSha256 !== summary.itemSetSha256) {
          fail('case_graph_research_search_postgres_clone_invalid');
        }
        shardReceipts.push(receipt);
        clonedSourceShardCount += 1;
        clonedRecordCount += receipt.itemCount;
        continue;
      }

      const dbRows = digestLines();
      const searchContent = digestLines();
      const documents: CaseGraphResearchSearchPostgresDocument[] = [];
      let retainedDocumentBytes = 0;
      let previousAddress: string | null = null;
      let firstAddress: string | null = null;
      let lastAddress: string | null = null;
      let itemCount = 0;
      const flush = async () => {
        if (!documents.length) return;
        const result = await params.store.ingestBatch({
          lease,
          nodeShard: summary.shard,
          documents: [...documents],
          leaseSeconds: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_LEASE_SECONDS,
          signal: params.signal,
        });
        if (result.insertedDocumentCount + result.reusedDocumentCount !== documents.length) {
          fail('case_graph_research_search_postgres_batch_accounting_invalid');
        }
        documents.length = 0;
        retainedDocumentBytes = 0;
      };

      for await (const node of params.source.openVerifiedNodeShard({
        active: params.active,
        summary,
        signal: params.signal,
      })) {
        abort(params.signal);
        const document = projectCaseGraphResearchSearchPostgresDocument(node);
        if (fullCorpusRelationshipShard(document.address, summary.shardCount) !== summary.shard
          || (previousAddress !== null && compareText(previousAddress, document.address) >= 0)) {
          fail('case_graph_research_search_postgres_source_shard_order_invalid');
        }
        previousAddress = document.address;
        firstAddress ??= document.address;
        lastAddress = document.address;
        itemCount += 1;
        if (itemCount > summary.itemCount) fail('case_graph_research_search_postgres_source_shard_count_mismatch');
        dbRows.add(`${document.address}:${document.nodeDigest}`);
        searchContent.add(`${document.address}:${document.contentDigest}`);
        const documentBytes = caseGraphResearchSearchPostgresDocumentBytes(document);
        const batchAction = planCaseGraphResearchSearchPostgresBatchAction({
          retainedDocumentBytes,
          retainedRowCount: documents.length,
          nextDocumentBytes: documentBytes,
        });
        if (batchAction === 'document_too_large') {
          fail('case_graph_research_search_postgres_document_too_large');
        }
        if (batchAction === 'flush_then_append') {
          await flush();
        }
        documents.push(document);
        retainedDocumentBytes += documentBytes;
        const retainedBatchBytes = caseGraphResearchSearchPostgresBatchBytes(
          retainedDocumentBytes,
          documents.length,
        );
        if (documents.length >= CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_ROWS
          || retainedBatchBytes === CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_BATCH_BYTES) {
          await flush();
        }
      }
      await flush();
      if (itemCount !== summary.itemCount
        || firstAddress !== summary.firstKey
        || lastAddress !== summary.lastKey
        || dbRows.digest() !== summary.itemSetSha256) {
        fail('case_graph_research_search_postgres_source_shard_integrity_failed');
      }
      const receipt: CaseGraphResearchSearchPostgresSourceShardReceipt = {
        nodeShard: summary.shard,
        sourceArtifactDigest: summary.artifactDigest,
        sourceItemSetSha256: summary.itemSetSha256,
        itemCount,
        dbRowSetSha256: summary.itemSetSha256,
        searchContentSha256: searchContent.digest(),
        buildMode: 'streamed',
        clonedFromPublicationId: null,
      };
      await params.store.finishStreamedShard({
        lease,
        receipt,
        leaseSeconds: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_LEASE_SECONDS,
        signal: params.signal,
      });
      shardReceipts.push(receipt);
      streamedSourceShardCount += 1;
      streamedRecordCount += itemCount;
    }

    const globalNodeSet = digestLines();
    const globalSearchContent = digestLines();
    const byKind = Object.fromEntries(caseGraphResearchSearchPostgresKinds.map((kind) => [kind, 0])) as Record<
      EvidenceUniverseNodeKind,
      number
    >;
    const byStatus = Object.fromEntries(
      caseGraphResearchSearchPostgresRelationshipStatuses.map((status) => [status, 0]),
    ) as Record<FullCorpusPublicRelationshipStatus, number>;
    const sentinelByKind = new Map<EvidenceUniverseNodeKind, CaseGraphResearchSearchPostgresSentinel>();
    let reusedDocumentCount = 0;
    let insertedDocumentCount = 0;
    let previousAddress: string | null = null;
    for await (const row of params.store.streamFinalRows({
      lease,
      leaseSeconds: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_BUILD_LEASE_SECONDS,
      signal: params.signal,
    })) {
      abort(params.signal);
      if (previousAddress !== null && compareText(previousAddress, row.address) >= 0) {
        fail('case_graph_research_search_postgres_final_rows_order_invalid');
      }
      if (!caseGraphResearchSearchPostgresKinds.includes(row.kind)
        || !caseGraphResearchSearchPostgresRelationshipStatuses.includes(row.relationshipStatus)
        || !/^[a-f0-9]{64}$/.test(row.nodeDigest)
        || !/^[a-f0-9]{64}$/.test(row.contentDigest)) {
        fail('case_graph_research_search_postgres_final_row_invalid');
      }
      previousAddress = row.address;
      globalNodeSet.add(`${row.address}:${row.nodeDigest}`);
      globalSearchContent.add(`${row.address}:${row.contentDigest}`);
      byKind[row.kind] += 1;
      byStatus[row.relationshipStatus] += 1;
      if (row.insertedByPublicationId === params.active.publicationId) insertedDocumentCount += 1;
      else reusedDocumentCount += 1;
      if (!sentinelByKind.has(row.kind)) {
        sentinelByKind.set(row.kind, { kind: row.kind, address: row.address, nodeDigest: row.nodeDigest });
      }
    }
    validateFinalAccounting({
      active: params.active,
      indexedRecordCount: globalNodeSet.count(),
      nodeSetSha256: globalNodeSet.digest(),
      byKind,
      byStatus,
    });
    const index = await params.store.inspectIndexDefinition({ signal: params.signal });
    if (index.sha256 !== CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256) {
      fail('case_graph_research_search_postgres_index_definition_mismatch');
    }
    const sourceShardSetSha256 = relationshipInputSha256(shardReceipts.map((receipt) => ({
      nodeShard: receipt.nodeShard,
      sourceArtifactDigest: receipt.sourceArtifactDigest,
      sourceItemSetSha256: receipt.sourceItemSetSha256,
      itemCount: receipt.itemCount,
      dbRowSetSha256: receipt.dbRowSetSha256,
      searchContentSha256: receipt.searchContentSha256,
    })));
    const buildDeltaSha256 = relationshipInputSha256(shardReceipts);
    const accounting: CaseGraphResearchSearchPostgresAccounting = {
      sourceShardCount: summaries.length,
      indexedRecordCount: globalNodeSet.count(),
    };
    const receipt: CaseGraphResearchSearchPostgresCompletionReceipt = {
      recordType: 'case_graph_research_search_postgres_completion_receipt',
      schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_SCHEMA_VERSION,
      binding: caseGraphResearchSearchPostgresBinding(params.active),
      tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_TOKENIZER_VERSION,
      rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_RANKING_VERSION,
      indexDefinitionVersion: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_VERSION,
      indexDefinitionSha256: CASE_GRAPH_RESEARCH_SEARCH_POSTGRES_INDEX_DEFINITION_SHA256,
      sourceShardSetSha256,
      dbNodeSetSha256: params.active.manifest.lineage.publicGraph.nodeSetSha256,
      searchContentSetSha256: globalSearchContent.digest(),
      accounting,
      sentinels: [...sentinelByKind.values()].sort((left, right) => compareText(left.kind, right.kind)),
    };
    await params.store.markReceiptPending({
      lease,
      receipt,
      attemptAudit: {
        buildDeltaSha256,
        accounting: {
          sourceShardCount: summaries.length,
          clonedSourceShardCount,
          streamedSourceShardCount,
          clonedRecordCount,
          streamedRecordCount,
          indexedRecordCount: globalNodeSet.count(),
          reusedDocumentCount,
          insertedDocumentCount,
        },
      },
      signal: params.signal,
    });
    receiptPrepared = true;
    return await publishPreparedReceipt(receipt);
  } catch (error) {
    if (!receiptPrepared) {
      await params.store.markFailed({ lease, errorCode: normalizeErrorCode(error) }).catch(() => undefined);
    }
    throw error;
  }
};
