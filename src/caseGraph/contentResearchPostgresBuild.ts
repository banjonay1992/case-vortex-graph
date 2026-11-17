import { createHash } from 'node:crypto';

import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  verifyCaseGraphContentSearchIndex,
  type CaseGraphContentSearchIndexEntry,
  type CaseGraphContentSearchIndexManifest,
  type CaseGraphContentSearchIndexShard,
} from './contentResearchSearchIndex';
import {
  verifyCaseGraphContentSearchArchivePointer,
  verifyCaseGraphContentSearchArchiveObjects,
  type CaseGraphContentSearchArchivePointer,
} from './contentResearchSearchIndexArchive';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  CASE_GRAPH_CONTENT_POSTGRES_SEARCH_VERSION,
  type CaseGraphContentPostgresQuery,
} from './postgresContentResearchSearch';

export const CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION = 'case-graph-content-postgres-build-v1' as const;
export const CASE_GRAPH_CONTENT_POSTGRES_MIGRATION_SHA256 = '57d93e8f96cdad3472f91f55d5fd029948e2aeda42d3accf05fd22e4e5b9e3b4' as const;
export const CASE_GRAPH_CONTENT_POSTGRES_RANKING_VERSION = 'postgres-simple-ts-rank-cd-32-micros-v1' as const;
export const CASE_GRAPH_CONTENT_POSTGRES_INDEX_DEFINITION_VERSION = 'postgres-generated-simple-tsvector-gin-v1' as const;

export type CaseGraphContentPostgresSourceShardReceipt = {
  shardNumber: number;
  shardDigest: string;
  sourceObjectKey: string;
  sourceObjectSha256: string;
  entrySetSha256: string;
  entryCount: number;
};

export type CaseGraphContentPostgresCompletionReceipt = {
  recordType: 'case_graph_content_postgres_completion_receipt';
  schemaVersion: typeof CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION;
  migrationSha256: typeof CASE_GRAPH_CONTENT_POSTGRES_MIGRATION_SHA256;
  searchVersion: typeof CASE_GRAPH_CONTENT_POSTGRES_SEARCH_VERSION;
  rankingVersion: typeof CASE_GRAPH_CONTENT_POSTGRES_RANKING_VERSION;
  indexDefinitionVersion: typeof CASE_GRAPH_CONTENT_POSTGRES_INDEX_DEFINITION_VERSION;
  publication: CaseGraphContentSearchIndexManifest['publication'];
  accountingReceiptDigest: string;
  indexManifestDigest: string;
  indexArchivePointerDigest: string;
  indexArchiveManifestObjectKey: string;
  indexArchiveManifestObjectSha256: string;
  entryCount: number;
  shardCount: number;
  entrySetSha256: string;
  shardSetSha256: string;
  dbEntrySetSha256: string;
  sourceShardSetSha256: string;
  sourceShards: CaseGraphContentPostgresSourceShardReceipt[];
  receiptDigest: string;
};

export type CaseGraphContentPostgresBuildClient = { query: CaseGraphContentPostgresQuery };
export type CaseGraphContentPostgresBuildLease = { publicationId: string; leaseToken: string };

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK_ID = /^content-chunk:[a-f0-9]{64}$/;
const ENTRY_ID = /^content-search-entry:[a-f0-9]{64}$/;
const MAX_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 10_000;
const MAX_COMPLETION_RECEIPT_BYTES = 4 * 1024 * 1024;

const fail = (code: string): never => { throw new Error(code); };
const options = (signal?: AbortSignal) => ({
  statementTimeoutMs: MAX_TIMEOUT_MS,
  queryTimeoutMs: MAX_TIMEOUT_MS,
  signal,
});
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail('case_graph_research_aborted');
};
const one = (rows: Record<string, unknown>[], code: string): Record<string, unknown> => {
  if (rows.length !== 1) return fail(code);
  return rows[0];
};
const digest = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) return fail(code);
  return value;
};
const count = (value: unknown, maximum: number, code: string): number => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0 || Number(numeric) > maximum) fail(code);
  return Number(numeric);
};
const leaseSeconds = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 30 || value > 900) {
    fail('case_graph_content_postgres_build_lease_duration_invalid');
  }
  return value;
};
const receiptBytes = (receipt: CaseGraphContentPostgresCompletionReceipt) => Buffer.from(
  `${canonicalizeRelationshipInput(receipt)}\n`, 'utf8',
);
const bodySha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const exactObject = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!isObject(value)) return fail('case_graph_content_postgres_completion_receipt_invalid');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return fail('case_graph_content_postgres_completion_receipt_invalid');
  }
  return value;
};
const boundedText = (value: unknown, maximum: number, code: string): string => {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/.test(value)) return fail(code);
  return value;
};

const sourceShardsFor = (
  manifest: CaseGraphContentSearchIndexManifest,
  shards: CaseGraphContentSearchIndexShard[],
  pointer: CaseGraphContentSearchArchivePointer,
): CaseGraphContentPostgresSourceShardReceipt[] => shards.map((shard, index) => ({
  shardNumber: shard.shardNumber,
  shardDigest: shard.shardDigest,
  sourceObjectKey: pointer.shardObjects[index].objectKey,
  sourceObjectSha256: pointer.shardObjects[index].objectSha256,
  entrySetSha256: shard.entrySetSha256,
  entryCount: shard.entryCount,
}));

const receiptCore = (params: {
  manifest: CaseGraphContentSearchIndexManifest;
  pointer: CaseGraphContentSearchArchivePointer;
  sourceShards: CaseGraphContentPostgresSourceShardReceipt[];
  dbEntrySetSha256: string;
}) => ({
  recordType: 'case_graph_content_postgres_completion_receipt' as const,
  schemaVersion: CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION,
  migrationSha256: CASE_GRAPH_CONTENT_POSTGRES_MIGRATION_SHA256,
  searchVersion: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_VERSION,
  rankingVersion: CASE_GRAPH_CONTENT_POSTGRES_RANKING_VERSION,
  indexDefinitionVersion: CASE_GRAPH_CONTENT_POSTGRES_INDEX_DEFINITION_VERSION,
  publication: params.manifest.publication,
  accountingReceiptDigest: params.manifest.accountingReceiptDigest,
  indexManifestDigest: params.manifest.manifestDigest,
  indexArchivePointerDigest: params.pointer.pointerDigest,
  indexArchiveManifestObjectKey: params.pointer.manifestObjectKey,
  indexArchiveManifestObjectSha256: params.pointer.manifestObjectSha256,
  entryCount: params.manifest.entryCount,
  shardCount: params.manifest.shardCount,
  entrySetSha256: params.manifest.entrySetSha256,
  shardSetSha256: params.manifest.shardSetSha256,
  dbEntrySetSha256: params.dbEntrySetSha256,
  sourceShardSetSha256: relationshipInputSha256(params.sourceShards),
  sourceShards: params.sourceShards,
});

export const makeCaseGraphContentPostgresCompletionReceipt = (params: {
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
  pointer: CaseGraphContentSearchArchivePointer;
  dbEntrySetSha256: string;
}): CaseGraphContentPostgresCompletionReceipt => {
  const verified = verifyCaseGraphContentSearchIndex({ manifest: params.manifest, shards: params.shards });
  const pointer = verifyCaseGraphContentSearchArchivePointer({ value: params.pointer, ...verified });
  if (!SHA256.test(params.dbEntrySetSha256) || params.dbEntrySetSha256 !== verified.manifest.entrySetSha256) {
    fail('case_graph_content_postgres_completion_db_entry_set_mismatch');
  }
  const core = receiptCore({
    manifest: verified.manifest,
    pointer,
    sourceShards: sourceShardsFor(verified.manifest, verified.shards, pointer),
    dbEntrySetSha256: params.dbEntrySetSha256,
  });
  return { ...core, receiptDigest: relationshipInputSha256(core) };
};

export const verifyCaseGraphContentPostgresCompletionReceipt = (params: {
  value: CaseGraphContentPostgresCompletionReceipt;
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
  pointer: CaseGraphContentSearchArchivePointer;
}) => {
  const expected = makeCaseGraphContentPostgresCompletionReceipt({
    manifest: params.manifest,
    shards: params.shards,
    pointer: params.pointer,
    dbEntrySetSha256: params.value?.dbEntrySetSha256,
  });
  if (relationshipInputSha256(params.value) !== relationshipInputSha256(expected)) {
    fail('case_graph_content_postgres_completion_receipt_invalid');
  }
  return expected;
};

export const encodeCaseGraphContentPostgresCompletionReceipt = (
  receipt: CaseGraphContentPostgresCompletionReceipt,
) => receiptBytes(receipt);

export const decodeCaseGraphContentPostgresCompletionReceipt = (
  value: unknown,
): CaseGraphContentPostgresCompletionReceipt => {
  const object = exactObject(value, [
    'recordType', 'schemaVersion', 'migrationSha256', 'searchVersion', 'rankingVersion',
    'indexDefinitionVersion', 'publication', 'accountingReceiptDigest', 'indexManifestDigest',
    'indexArchivePointerDigest', 'indexArchiveManifestObjectKey', 'indexArchiveManifestObjectSha256',
    'entryCount', 'shardCount', 'entrySetSha256', 'shardSetSha256', 'dbEntrySetSha256',
    'sourceShardSetSha256', 'sourceShards', 'receiptDigest',
  ]);
  if (object.recordType !== 'case_graph_content_postgres_completion_receipt'
    || object.schemaVersion !== CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION
    || object.migrationSha256 !== CASE_GRAPH_CONTENT_POSTGRES_MIGRATION_SHA256
    || object.searchVersion !== CASE_GRAPH_CONTENT_POSTGRES_SEARCH_VERSION
    || object.rankingVersion !== CASE_GRAPH_CONTENT_POSTGRES_RANKING_VERSION
    || object.indexDefinitionVersion !== CASE_GRAPH_CONTENT_POSTGRES_INDEX_DEFINITION_VERSION) {
    fail('case_graph_content_postgres_completion_receipt_invalid');
  }
  const publicationObject = exactObject(object.publication, [
    'publicationId', 'corpusVersion', 'manifestSha256', 'snapshotId', 'graphArtifactSetSha256',
    'relationshipSchemaVersion', 'relationshipPolicyVersion', 'relationshipPolicySha256',
    'relationshipModelId', 'relationshipModelVersion', 'relationshipModelSha256', 'calibrationSetSha256',
  ]);
  const publication: CaseGraphContentSearchIndexManifest['publication'] = {
    publicationId: boundedText(publicationObject.publicationId, 64,
      'case_graph_content_postgres_completion_receipt_invalid'),
    corpusVersion: boundedText(publicationObject.corpusVersion, 256,
      'case_graph_content_postgres_completion_receipt_invalid'),
    manifestSha256: boundedText(publicationObject.manifestSha256, 64,
      'case_graph_content_postgres_completion_receipt_invalid'),
    snapshotId: boundedText(publicationObject.snapshotId, 256,
      'case_graph_content_postgres_completion_receipt_invalid'),
    graphArtifactSetSha256: boundedText(publicationObject.graphArtifactSetSha256, 64,
      'case_graph_content_postgres_completion_receipt_invalid'),
    relationshipSchemaVersion: boundedText(publicationObject.relationshipSchemaVersion, 256,
      'case_graph_content_postgres_completion_receipt_invalid'),
    relationshipPolicyVersion: boundedText(publicationObject.relationshipPolicyVersion, 256,
      'case_graph_content_postgres_completion_receipt_invalid'),
    relationshipPolicySha256: boundedText(publicationObject.relationshipPolicySha256, 64,
      'case_graph_content_postgres_completion_receipt_invalid'),
    relationshipModelId: boundedText(publicationObject.relationshipModelId, 256,
      'case_graph_content_postgres_completion_receipt_invalid'),
    relationshipModelVersion: boundedText(publicationObject.relationshipModelVersion, 256,
      'case_graph_content_postgres_completion_receipt_invalid'),
    relationshipModelSha256: boundedText(publicationObject.relationshipModelSha256, 64,
      'case_graph_content_postgres_completion_receipt_invalid'),
    calibrationSetSha256: boundedText(publicationObject.calibrationSetSha256, 64,
      'case_graph_content_postgres_completion_receipt_invalid'),
  };
  if (!UUID.test(publication.publicationId) || !SHA256.test(publication.manifestSha256)
    || !SHA256.test(publication.graphArtifactSetSha256) || !SHA256.test(publication.relationshipPolicySha256)
    || !SHA256.test(publication.relationshipModelSha256) || !SHA256.test(publication.calibrationSetSha256)) {
    fail('case_graph_content_postgres_completion_receipt_invalid');
  }
  const digestFields = [
    'accountingReceiptDigest', 'indexManifestDigest', 'indexArchivePointerDigest',
    'indexArchiveManifestObjectSha256', 'entrySetSha256', 'shardSetSha256',
    'dbEntrySetSha256', 'sourceShardSetSha256', 'receiptDigest',
  ] as const;
  const decodedDigests = Object.fromEntries(digestFields.map((key) => [
    key, digest(object[key], 'case_graph_content_postgres_completion_receipt_invalid'),
  ])) as Record<(typeof digestFields)[number], string>;
  const indexArchiveManifestObjectKey = boundedText(
    object.indexArchiveManifestObjectKey, 4_096, 'case_graph_content_postgres_completion_receipt_invalid',
  );
  const sourceShardValues = object.sourceShards;
  if (!Array.isArray(sourceShardValues)) return fail('case_graph_content_postgres_completion_receipt_invalid');
  const entryCount = count(object.entryCount, Number.MAX_SAFE_INTEGER, 'case_graph_content_postgres_completion_receipt_invalid');
  const shardCount = count(object.shardCount, 1_000_000, 'case_graph_content_postgres_completion_receipt_invalid');
  const sourceShards = sourceShardValues.map((raw, index): CaseGraphContentPostgresSourceShardReceipt => {
    const source = exactObject(raw, [
      'shardNumber', 'shardDigest', 'sourceObjectKey', 'sourceObjectSha256', 'entrySetSha256', 'entryCount',
    ]);
    if (count(source.shardNumber, 1_000_000, 'case_graph_content_postgres_completion_receipt_invalid') !== index) {
      return fail('case_graph_content_postgres_completion_receipt_invalid');
    }
    return {
      shardNumber: index,
      shardDigest: digest(source.shardDigest, 'case_graph_content_postgres_completion_receipt_invalid'),
      sourceObjectKey: boundedText(source.sourceObjectKey, 4_096, 'case_graph_content_postgres_completion_receipt_invalid'),
      sourceObjectSha256: digest(source.sourceObjectSha256, 'case_graph_content_postgres_completion_receipt_invalid'),
      entrySetSha256: digest(source.entrySetSha256, 'case_graph_content_postgres_completion_receipt_invalid'),
      entryCount: count(source.entryCount, 4_096, 'case_graph_content_postgres_completion_receipt_invalid'),
    };
  });
  const core = {
    recordType: 'case_graph_content_postgres_completion_receipt' as const,
    schemaVersion: CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION,
    migrationSha256: CASE_GRAPH_CONTENT_POSTGRES_MIGRATION_SHA256,
    searchVersion: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_VERSION,
    rankingVersion: CASE_GRAPH_CONTENT_POSTGRES_RANKING_VERSION,
    indexDefinitionVersion: CASE_GRAPH_CONTENT_POSTGRES_INDEX_DEFINITION_VERSION,
    publication,
    accountingReceiptDigest: decodedDigests.accountingReceiptDigest,
    indexManifestDigest: decodedDigests.indexManifestDigest,
    indexArchivePointerDigest: decodedDigests.indexArchivePointerDigest,
    indexArchiveManifestObjectKey,
    indexArchiveManifestObjectSha256: decodedDigests.indexArchiveManifestObjectSha256,
    entryCount,
    shardCount,
    entrySetSha256: decodedDigests.entrySetSha256,
    shardSetSha256: decodedDigests.shardSetSha256,
    dbEntrySetSha256: decodedDigests.dbEntrySetSha256,
    sourceShardSetSha256: decodedDigests.sourceShardSetSha256,
    sourceShards,
  };
  if (sourceShards.length !== shardCount
    || sourceShards.reduce((total, source) => total + source.entryCount, 0) !== entryCount
    || core.dbEntrySetSha256 !== core.entrySetSha256
    || relationshipInputSha256(sourceShards) !== core.sourceShardSetSha256
    || relationshipInputSha256(core) !== decodedDigests.receiptDigest) {
    fail('case_graph_content_postgres_completion_receipt_invalid');
  }
  return { ...core, receiptDigest: decodedDigests.receiptDigest };
};

export const preflightCaseGraphContentPostgresProjection = async (params: {
  binding: import('./postgresContentResearchSearch').CaseGraphContentServingBinding;
  query: CaseGraphContentPostgresQuery;
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}) => {
  abort(params.signal);
  const result = await params.query(`
    SELECT public_manifest_sha256, accounting_receipt_digest, index_manifest_digest,
      expected_entry_count, expected_shard_count, expected_entry_set_sha256,
      expected_shard_set_sha256, indexed_entry_count, indexed_shard_count,
      db_entry_set_sha256, completion_receipt_key, completion_receipt_sha256
    FROM public.case_graph_content_search_builds
    WHERE publication_id = $1::uuid AND public_manifest_sha256 = $2::text
      AND accounting_receipt_digest = $3::text AND index_manifest_digest = $4::text
      AND expected_entry_count = $5::bigint AND status = 'verified'
    LIMIT 1
  `, [
    params.binding.publication.publicationId, params.binding.publication.manifestSha256,
    params.binding.accountingReceiptDigest, params.binding.indexManifestDigest,
    params.binding.expectedEntryCount,
  ], options(params.signal));
  const row = one(result.rows, 'case_graph_research_content_search_unavailable');
  const receiptKey = typeof row.completion_receipt_key === 'string' && row.completion_receipt_key.length <= 4_096
    ? row.completion_receipt_key : fail('case_graph_research_content_search_unavailable');
  const receiptSha256 = digest(row.completion_receipt_sha256, 'case_graph_research_content_search_unavailable');
  const body = await params.archive.readObject(receiptKey, {
    maxBytes: MAX_COMPLETION_RECEIPT_BYTES,
    signal: params.signal,
  });
  if (body === null) return fail('case_graph_research_content_search_unavailable');
  if (bodySha256(body) !== receiptSha256) fail('case_graph_research_content_search_unavailable');
  let raw: unknown;
  try { raw = JSON.parse(body.toString('utf8')); } catch { return fail('case_graph_research_content_search_unavailable'); }
  const receipt = decodeCaseGraphContentPostgresCompletionReceipt(raw);
  const expectedReceiptKey = [
    'case-vortex/content-search-postgres', receipt.publication.manifestSha256,
    receipt.indexManifestDigest, CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION,
    `${receipt.receiptDigest}.json`,
  ].join('/');
  if (!body.equals(receiptBytes(receipt))
    || receiptKey !== expectedReceiptKey
    || receiptSha256 !== bodySha256(receiptBytes(receipt))
    || canonicalizeRelationshipInput(receipt.publication) !== canonicalizeRelationshipInput(params.binding.publication)
    || receipt.accountingReceiptDigest !== params.binding.accountingReceiptDigest
    || receipt.indexManifestDigest !== params.binding.indexManifestDigest
    || receipt.entryCount !== params.binding.expectedEntryCount
    || digest(row.public_manifest_sha256, 'case_graph_research_content_search_unavailable') !== receipt.publication.manifestSha256
    || digest(row.accounting_receipt_digest, 'case_graph_research_content_search_unavailable') !== receipt.accountingReceiptDigest
    || digest(row.index_manifest_digest, 'case_graph_research_content_search_unavailable') !== receipt.indexManifestDigest
    || count(row.expected_entry_count, Number.MAX_SAFE_INTEGER, 'case_graph_research_content_search_unavailable') !== receipt.entryCount
    || count(row.indexed_entry_count, Number.MAX_SAFE_INTEGER, 'case_graph_research_content_search_unavailable') !== receipt.entryCount
    || count(row.expected_shard_count, 1_000_000, 'case_graph_research_content_search_unavailable') !== receipt.shardCount
    || count(row.indexed_shard_count, 1_000_000, 'case_graph_research_content_search_unavailable') !== receipt.shardCount
    || digest(row.expected_entry_set_sha256, 'case_graph_research_content_search_unavailable') !== receipt.entrySetSha256
    || digest(row.expected_shard_set_sha256, 'case_graph_research_content_search_unavailable') !== receipt.shardSetSha256
    || digest(row.db_entry_set_sha256, 'case_graph_research_content_search_unavailable') !== receipt.dbEntrySetSha256) {
    fail('case_graph_research_content_search_unavailable');
  }
  return { verified: true as const, binding: params.binding, receiptKey, receiptSha256, receipt };
};

const entryPayload = (entry: CaseGraphContentSearchIndexEntry) => ({
  chunk_id: entry.chunkId,
  chunk_digest: entry.chunkDigest,
  entry_id: entry.entryId,
  entry_digest: entry.entryDigest,
  address: entry.address,
  node_digest: entry.nodeDigest,
  asset_id: entry.assetId,
  asset_digest: entry.assetDigest,
  extraction_contract_digest: entry.extractionContractDigest,
  extraction_receipt_digest: entry.extractionReceiptDigest,
  extraction_pointer_digest: entry.extractionPointerDigest,
  chunks_object_key: entry.chunksObjectKey,
  chunks_object_sha256: entry.chunksObjectSha256,
  media_kind: entry.mediaKind,
  text_origin: entry.textOrigin,
  locator: entry.locator,
  text: entry.text,
  language: entry.language,
  confidence: entry.confidence,
});

export const createPostgresCaseGraphContentBuildStore = (client: CaseGraphContentPostgresBuildClient) => ({
  acquire: async (manifest: CaseGraphContentSearchIndexManifest, seconds = 300, signal?: AbortSignal) => {
    abort(signal);
    const result = await client.query(`
      SELECT * FROM public.create_case_graph_content_search_build(
        $1::uuid, $2::text, $3::text, $4::text, $5::bigint, $6::integer,
        $7::text, $8::text, $9::integer
      )
    `, [
      manifest.publication.publicationId, manifest.publication.manifestSha256,
      manifest.accountingReceiptDigest, manifest.manifestDigest, manifest.entryCount,
      manifest.shardCount, manifest.entrySetSha256, manifest.shardSetSha256,
      leaseSeconds(seconds),
    ], options(signal));
    const row = one(result.rows, 'case_graph_content_postgres_build_acquire_failed');
    const leaseToken = row.lease_token;
    if (typeof leaseToken !== 'string' || !UUID.test(leaseToken)
      || (typeof row.leased_until !== 'string' && !(row.leased_until instanceof Date))) {
      fail('case_graph_content_postgres_build_acquire_failed');
    }
    return { publicationId: manifest.publication.publicationId, leaseToken: leaseToken as string };
  },

  renew: async (lease: CaseGraphContentPostgresBuildLease, seconds = 300, signal?: AbortSignal) => {
    abort(signal);
    const result = await client.query(`
      SELECT public.renew_case_graph_content_search_build(
        $1::uuid, $2::uuid, $3::integer
      ) AS leased_until
    `, [lease.publicationId, lease.leaseToken, leaseSeconds(seconds)], options(signal));
    const row = one(result.rows, 'case_graph_content_postgres_build_lease_lost');
    if (typeof row.leased_until !== 'string' && !(row.leased_until instanceof Date)) {
      fail('case_graph_content_postgres_build_lease_lost');
    }
  },

  findShard: async (lease: CaseGraphContentPostgresBuildLease, shardNumber: number, signal?: AbortSignal) => {
    abort(signal);
    const result = await client.query(`
      SELECT source.* FROM public.case_graph_content_search_source_shards AS source
      JOIN public.case_graph_content_search_builds AS build USING (publication_id)
      WHERE source.publication_id = $1::uuid AND source.shard_number = $2::integer
        AND build.status = 'building' AND build.lease_token = $3::uuid
        AND build.leased_until > pg_catalog.clock_timestamp()
      LIMIT 1
    `, [lease.publicationId, shardNumber, lease.leaseToken], options(signal));
    return result.rows.length ? one(result.rows, 'case_graph_content_postgres_source_shard_invalid') : null;
  },

  ingestShard: async (params: {
    lease: CaseGraphContentPostgresBuildLease;
    shard: CaseGraphContentSearchIndexShard;
    sourceObjectSha256: string;
    signal?: AbortSignal;
  }) => {
    abort(params.signal);
    const result = await client.query(`
      SELECT public.ingest_case_graph_content_search_shard(
        $1::uuid, $2::uuid, $3::integer, $4::text, $5::text, $6::text, $7::jsonb
      ) AS ingested_count
    `, [
      params.lease.publicationId, params.lease.leaseToken, params.shard.shardNumber,
      params.shard.shardDigest, params.sourceObjectSha256, params.shard.entrySetSha256,
      JSON.stringify(params.shard.entries.map(entryPayload)),
    ], options(params.signal));
    const observed = count(
      one(result.rows, 'case_graph_content_postgres_shard_ingest_failed').ingested_count,
      4_096,
      'case_graph_content_postgres_shard_ingest_failed',
    );
    if (observed !== params.shard.entryCount) fail('case_graph_content_postgres_shard_count_mismatch');
  },

  inspectExactProjection: async (params: {
    lease: CaseGraphContentPostgresBuildLease;
    manifest: CaseGraphContentSearchIndexManifest;
    sourceShards: CaseGraphContentPostgresSourceShardReceipt[];
    signal?: AbortSignal;
  }) => {
    const hash = createHash('sha256');
    hash.update('[');
    let after: string | null = null;
    let observedEntries = 0;
    while (true) {
      abort(params.signal);
      const result = await client.query(`
        SELECT chunk.chunk_id, chunk.entry_id, chunk.entry_digest
        FROM public.case_graph_content_search_chunks AS chunk
        JOIN public.case_graph_content_search_builds AS build USING (publication_id)
        WHERE chunk.publication_id = $1::uuid AND build.status = 'building'
          AND build.lease_token = $2::uuid AND build.leased_until > pg_catalog.clock_timestamp()
          AND ($3::text IS NULL OR chunk.chunk_id COLLATE "C" > $3::text COLLATE "C")
        ORDER BY chunk.chunk_id COLLATE "C" LIMIT $4::integer
      `, [params.lease.publicationId, params.lease.leaseToken, after, PAGE_SIZE], options(params.signal));
      if (result.rows.length > PAGE_SIZE) fail('case_graph_content_postgres_projection_invalid');
      for (const row of result.rows) {
        const chunkId = row.chunk_id;
        if (typeof chunkId !== 'string' || !CHUNK_ID.test(chunkId)
          || typeof row.entry_id !== 'string' || !ENTRY_ID.test(row.entry_id)) {
          fail('case_graph_content_postgres_projection_invalid');
        }
        const validChunkId = chunkId as string;
        const item = { entryId: row.entry_id, entryDigest: digest(row.entry_digest, 'case_graph_content_postgres_projection_invalid') };
        if (after !== null && validChunkId <= after) fail('case_graph_content_postgres_projection_invalid');
        hash.update(observedEntries ? ',' : '');
        hash.update(canonicalizeRelationshipInput(item));
        after = validChunkId;
        observedEntries += 1;
      }
      if (result.rows.length < PAGE_SIZE) break;
    }
    hash.update(']');
    const dbEntrySetSha256 = hash.digest('hex');
    if (observedEntries !== params.manifest.entryCount || dbEntrySetSha256 !== params.manifest.entrySetSha256) {
      fail('case_graph_content_postgres_projection_accounting_mismatch');
    }
    const shardResult = await client.query(`
      SELECT shard_number, shard_digest, source_object_sha256, entry_set_sha256, entry_count
      FROM public.case_graph_content_search_source_shards
      WHERE publication_id = $1::uuid ORDER BY shard_number ASC
    `, [params.lease.publicationId], options(params.signal));
    if (shardResult.rows.length !== params.sourceShards.length) {
      fail('case_graph_content_postgres_projection_accounting_mismatch');
    }
    shardResult.rows.forEach((row, index) => {
      const expected = params.sourceShards[index];
      if (count(row.shard_number, 1_000_000, 'case_graph_content_postgres_projection_invalid') !== expected.shardNumber
        || digest(row.shard_digest, 'case_graph_content_postgres_projection_invalid') !== expected.shardDigest
        || digest(row.source_object_sha256, 'case_graph_content_postgres_projection_invalid') !== expected.sourceObjectSha256
        || digest(row.entry_set_sha256, 'case_graph_content_postgres_projection_invalid') !== expected.entrySetSha256
        || count(row.entry_count, 4_096, 'case_graph_content_postgres_projection_invalid') !== expected.entryCount) {
        fail('case_graph_content_postgres_projection_accounting_mismatch');
      }
    });
    return dbEntrySetSha256;
  },

  verify: async (params: {
    lease: CaseGraphContentPostgresBuildLease;
    manifest: CaseGraphContentSearchIndexManifest;
    dbEntrySetSha256: string;
    receiptKey: string;
    receiptSha256: string;
    signal?: AbortSignal;
  }) => {
    abort(params.signal);
    const result = await client.query(`
      SELECT public.verify_case_graph_content_search_build(
        $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text
      ) AS verified
    `, [
      params.lease.publicationId, params.lease.leaseToken,
      params.manifest.entrySetSha256, params.manifest.shardSetSha256,
      digest(params.dbEntrySetSha256, 'case_graph_content_postgres_completion_receipt_invalid'),
      params.receiptKey, digest(params.receiptSha256, 'case_graph_content_postgres_completion_receipt_invalid'),
    ], options(params.signal));
    one(result.rows, 'case_graph_content_postgres_verify_failed');
  },

  fail: async (lease: CaseGraphContentPostgresBuildLease, errorCode: string, signal?: AbortSignal) => {
    if (!/^[a-z0-9][a-z0-9._:-]{0,239}$/.test(errorCode)) {
      fail('case_graph_content_postgres_failure_code_invalid');
    }
    const result = await client.query(`
      SELECT public.fail_case_graph_content_search_build($1::uuid, $2::uuid, $3::text) AS failed
    `, [lease.publicationId, lease.leaseToken, errorCode], options(signal));
    one(result.rows, 'case_graph_content_postgres_fail_failed');
  },
});

export const buildCaseGraphContentPostgresProjection = async (params: {
  client: CaseGraphContentPostgresBuildClient;
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
  pointer: CaseGraphContentSearchArchivePointer;
  archive: CaseGraphContentImmutableArchive;
  leaseSeconds?: number;
  signal?: AbortSignal;
}) => {
  const verified = verifyCaseGraphContentSearchIndex({ manifest: params.manifest, shards: params.shards });
  const pointer = await verifyCaseGraphContentSearchArchiveObjects({
    value: params.pointer, ...verified, archive: params.archive, signal: params.signal,
  });
  const sourceShards = sourceShardsFor(verified.manifest, verified.shards, pointer);
  const store = createPostgresCaseGraphContentBuildStore(params.client);
  const seconds = params.leaseSeconds ?? 300;
  const lease = await store.acquire(verified.manifest, seconds, params.signal);
  for (const [index, shard] of verified.shards.entries()) {
    await store.renew(lease, seconds, params.signal);
    const existing = await store.findShard(lease, shard.shardNumber, params.signal);
    const source = sourceShards[index];
    if (existing) {
      if (digest(existing.shard_digest, 'case_graph_content_postgres_source_shard_invalid') !== source.shardDigest
        || digest(existing.source_object_sha256, 'case_graph_content_postgres_source_shard_invalid') !== source.sourceObjectSha256
        || digest(existing.entry_set_sha256, 'case_graph_content_postgres_source_shard_invalid') !== source.entrySetSha256
        || count(existing.entry_count, 4_096, 'case_graph_content_postgres_source_shard_invalid') !== source.entryCount) {
        fail('case_graph_content_postgres_source_shard_mismatch');
      }
      continue;
    }
    await store.ingestShard({ lease, shard, sourceObjectSha256: source.sourceObjectSha256, signal: params.signal });
  }
  await store.renew(lease, seconds, params.signal);
  const dbEntrySetSha256 = await store.inspectExactProjection({
    lease, manifest: verified.manifest, sourceShards, signal: params.signal,
  });
  const receipt = makeCaseGraphContentPostgresCompletionReceipt({
    manifest: verified.manifest, shards: verified.shards, pointer, dbEntrySetSha256,
  });
  const body = receiptBytes(receipt);
  const receiptSha256 = bodySha256(body);
  const receiptKey = [
    'case-vortex/content-search-postgres', verified.manifest.publication.manifestSha256,
    verified.manifest.manifestDigest, CASE_GRAPH_CONTENT_POSTGRES_BUILD_VERSION,
    `${receipt.receiptDigest}.json`,
  ].join('/');
  await params.archive.putIfAbsent({
    key: receiptKey, body, contentType: 'application/json', signal: params.signal,
  });
  const observed = await params.archive.readObject(receiptKey, { maxBytes: body.byteLength, signal: params.signal });
  if (!observed || !observed.equals(body) || bodySha256(observed) !== receiptSha256) {
    fail('case_graph_content_postgres_completion_read_after_write_mismatch');
  }
  await store.verify({
    lease, manifest: verified.manifest, dbEntrySetSha256,
    receiptKey, receiptSha256, signal: params.signal,
  });
  return { lease, receipt, receiptKey, receiptSha256 };
};
