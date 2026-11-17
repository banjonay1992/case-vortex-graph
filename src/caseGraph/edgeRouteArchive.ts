import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  getCaseGraphEdgeRouteControlKeys,
  getCaseGraphEdgeRouteFragmentKeys,
  getCaseGraphEdgeRoutePartReceiptKey,
} from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import { getCaseGraphReducerShard } from './candidateRouting';
import { readVerifiedCaseGraphPreliminaryReducers } from './reducerArchive';
import { decodeCaseGraphPreliminaryRelationships } from './reducerArchiveCodec';
import { CASE_GRAPH_POLICY_VERSION, type CaseGraphRelationship } from './relationshipPolicy';

export const CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION = 1 as const;
const MAX_EDGE_ROUTE_BYTES = 512 * 1024 * 1024;

export type CaseGraphEdgeRouteFragmentManifest = {
  record_type: 'case_graph_edge_route_fragment_manifest';
  schema_version: typeof CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION;
  corpus_version: string;
  relationship_policy_version: typeof CASE_GRAPH_POLICY_VERSION;
  source_reducer_shard: number;
  edge_shard: number;
  edge_shard_count: number;
  edge_count: number;
  first_edge_id: string;
  last_edge_id: string;
  archive_key: string;
  manifest_key: string;
  compressed_bytes: number;
  compressed_sha256: string;
};

export type CaseGraphEdgeRoutePartReceipt = {
  record_type: 'case_graph_edge_route_part_receipt';
  schema_version: typeof CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION;
  corpus_version: string;
  source_reducer_shard: number;
  source_relationships_sha256: string;
  source_relationship_count: number;
  edge_shard_count: number;
  fragment_count: number;
  routed_edge_count: number;
  fragments: CaseGraphEdgeRouteFragmentManifest[];
};

type RouteReceiptPointer = {
  source_reducer_shard: number;
  key: string;
  sha256: string;
  source_relationship_count: number;
  fragment_count: number;
  routed_edge_count: number;
};

export type CaseGraphEdgeRouteCompletion = {
  record_type: 'case_graph_edge_route_completion';
  schema_version: typeof CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION;
  corpus_version: string;
  preliminary_reducer_manifest_set_sha256: string;
  relationship_policy_version: typeof CASE_GRAPH_POLICY_VERSION;
  source_reducer_count: number;
  edge_shard_count: number;
  preliminary_relationship_count: number;
  routed_edge_count: number;
  fragment_count: number;
  part_receipts: RouteReceiptPointer[];
  receipt_set_sha256: string;
  completed_at: string;
};

type EdgeRouteCheckpoint = Omit<CaseGraphEdgeRouteCompletion,
  'record_type' | 'relationship_policy_version' | 'source_reducer_count' | 'preliminary_relationship_count' | 'receipt_set_sha256' | 'completed_at'
> & {
  record_type: 'case_graph_edge_route_checkpoint';
  next_source_reducer_shard: number;
  updated_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const receiptSetSha = (pointers: readonly RouteReceiptPointer[]) => createHash('sha256')
  .update(pointers.map((pointer) => `${pointer.source_reducer_shard}:${pointer.sha256}`).join('\n'))
  .digest('hex');

const validateRelationship = (relationship: CaseGraphRelationship) => {
  if (
    relationship.policyVersion !== CASE_GRAPH_POLICY_VERSION
    || !relationship.edgeId
    || !relationship.leftCaseId
    || !relationship.rightCaseId
    || relationship.leftCaseId >= relationship.rightCaseId
  ) throw new Error('case_graph_edge_route_relationship_invalid');
};

export const buildCaseGraphEdgeRouteFragments = (params: {
  corpusVersion: string;
  sourceReducerShard: number;
  edgeShardCount: number;
  relationships: CaseGraphRelationship[];
}) => {
  if (!Number.isSafeInteger(params.edgeShardCount) || params.edgeShardCount < 1 || params.edgeShardCount > 4096) {
    throw new Error('case_graph_edge_shard_count_invalid');
  }
  const seen = new Set<string>();
  const byShard = new Map<number, CaseGraphRelationship[]>();
  for (const relationship of [...params.relationships].sort((left, right) => left.edgeId.localeCompare(right.edgeId))) {
    validateRelationship(relationship);
    if (seen.has(relationship.edgeId)) throw new Error(`case_graph_duplicate_preliminary_edge:${relationship.edgeId}`);
    seen.add(relationship.edgeId);
    const shard = getCaseGraphReducerShard(relationship.edgeId, params.edgeShardCount);
    const rows = byShard.get(shard) || [];
    rows.push(relationship);
    byShard.set(shard, rows);
  }
  return [...byShard.entries()].sort(([left], [right]) => left - right).map(([edgeShard, relationships]) => {
    const raw = Buffer.from(relationships.map((relationship) => `${JSON.stringify(relationship)}\n`).join(''));
    if (raw.length > MAX_EDGE_ROUTE_BYTES) throw new Error('case_graph_edge_route_output_limit_exceeded');
    const archiveBody = gzipSync(raw, { level: 6 });
    const keys = getCaseGraphEdgeRouteFragmentKeys(params.corpusVersion, edgeShard, params.sourceReducerShard);
    const manifest: CaseGraphEdgeRouteFragmentManifest = {
      record_type: 'case_graph_edge_route_fragment_manifest',
      schema_version: CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION,
      corpus_version: params.corpusVersion,
      relationship_policy_version: CASE_GRAPH_POLICY_VERSION,
      source_reducer_shard: params.sourceReducerShard,
      edge_shard: edgeShard,
      edge_shard_count: params.edgeShardCount,
      edge_count: relationships.length,
      first_edge_id: relationships[0].edgeId,
      last_edge_id: relationships.at(-1)!.edgeId,
      archive_key: keys.archiveKey,
      manifest_key: keys.manifestKey,
      compressed_bytes: archiveBody.length,
      compressed_sha256: sha256(archiveBody),
    };
    return { archiveBody, manifest, manifestBody: jsonBody(manifest) };
  });
};

export const decodeCaseGraphEdgeRouteFragment = (
  body: Buffer,
  manifest: CaseGraphEdgeRouteFragmentManifest,
) => {
  if (body.length !== manifest.compressed_bytes || sha256(body) !== manifest.compressed_sha256) {
    throw new Error('case_graph_edge_route_checksum_mismatch');
  }
  const raw = gunzipSync(body, { maxOutputLength: MAX_EDGE_ROUTE_BYTES }).toString('utf8');
  const relationships = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as CaseGraphRelationship);
  for (const relationship of relationships) {
    validateRelationship(relationship);
    if (getCaseGraphReducerShard(relationship.edgeId, manifest.edge_shard_count) !== manifest.edge_shard) {
      throw new Error('case_graph_edge_routed_to_wrong_shard');
    }
  }
  if (
    relationships.length !== manifest.edge_count
    || relationships[0]?.edgeId !== manifest.first_edge_id
    || relationships.at(-1)?.edgeId !== manifest.last_edge_id
  ) throw new Error('case_graph_edge_route_manifest_mismatch');
  return relationships;
};

const parseObject = (body: Buffer, label: string) => {
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
};

const validatePointer = (value: unknown, corpusVersion: string, index: number): RouteReceiptPointer => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_edge_route_pointer_invalid');
  const pointer = value as Partial<RouteReceiptPointer>;
  if (
    pointer.source_reducer_shard !== index
    || pointer.key !== getCaseGraphEdgeRoutePartReceiptKey(corpusVersion, index)
    || !/^[a-f0-9]{64}$/.test(String(pointer.sha256 || ''))
    || !Number.isSafeInteger(pointer.source_relationship_count)
    || Number(pointer.source_relationship_count) < 0
    || !Number.isSafeInteger(pointer.fragment_count)
    || Number(pointer.fragment_count) < 0
    || !Number.isSafeInteger(pointer.routed_edge_count)
    || pointer.routed_edge_count !== pointer.source_relationship_count
  ) throw new Error('case_graph_edge_route_pointer_invalid');
  return pointer as RouteReceiptPointer;
};

const validateReceiptArtifacts = async (
  storage: CaseGraphArchiveStorage,
  pointers: readonly RouteReceiptPointer[],
  corpusVersion: string,
  edgeShardCount: number,
) => {
  const receipts: CaseGraphEdgeRoutePartReceipt[] = [];
  for (const pointer of pointers) {
    const body = await storage.readObject(pointer.key);
    if (!body || sha256(body) !== pointer.sha256) throw new Error('case_graph_edge_route_receipt_mismatch');
    const receipt = parseObject(body, 'case_graph_edge_route_receipt') as unknown as CaseGraphEdgeRoutePartReceipt;
    if (
      receipt.record_type !== 'case_graph_edge_route_part_receipt'
      || receipt.schema_version !== CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION
      || receipt.corpus_version !== corpusVersion
      || receipt.source_reducer_shard !== pointer.source_reducer_shard
      || receipt.source_relationship_count !== pointer.source_relationship_count
      || receipt.edge_shard_count !== edgeShardCount
      || receipt.fragment_count !== pointer.fragment_count
      || receipt.routed_edge_count !== pointer.routed_edge_count
      || !Array.isArray(receipt.fragments)
      || receipt.fragments.length !== receipt.fragment_count
      || receipt.fragments.reduce((sum, fragment) => sum + fragment.edge_count, 0) !== receipt.routed_edge_count
    ) throw new Error('case_graph_edge_route_receipt_invalid');
    for (const fragment of receipt.fragments) {
      const manifestBody = await storage.readObject(fragment.manifest_key);
      if (!manifestBody || !manifestBody.equals(jsonBody(fragment))) {
        throw new Error('case_graph_edge_route_fragment_manifest_mismatch');
      }
    }
    receipts.push(receipt);
  }
  return receipts;
};

const validateCheckpoint = (body: Buffer, identity: {
  corpus_version: string;
  preliminary_reducer_manifest_set_sha256: string;
  edge_shard_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_edge_route_checkpoint');
  if (
    raw.record_type !== 'case_graph_edge_route_checkpoint'
    || raw.schema_version !== CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.preliminary_reducer_manifest_set_sha256 !== identity.preliminary_reducer_manifest_set_sha256
    || raw.edge_shard_count !== identity.edge_shard_count
    || !Array.isArray(raw.part_receipts)
  ) throw new Error('case_graph_edge_route_checkpoint_identity_mismatch');
  const pointers = raw.part_receipts.map((pointer, index) => validatePointer(pointer, identity.corpus_version, index));
  const checkpoint = { ...raw, part_receipts: pointers } as unknown as EdgeRouteCheckpoint;
  if (
    checkpoint.next_source_reducer_shard !== pointers.length
    || checkpoint.routed_edge_count !== pointers.reduce((sum, pointer) => sum + pointer.routed_edge_count, 0)
    || checkpoint.fragment_count !== pointers.reduce((sum, pointer) => sum + pointer.fragment_count, 0)
  ) throw new Error('case_graph_edge_route_checkpoint_counters_invalid');
  return checkpoint;
};

const validateCompletion = (body: Buffer, identity: {
  corpus_version: string;
  preliminary_reducer_manifest_set_sha256: string;
  edge_shard_count: number;
  source_reducer_count: number;
  preliminary_relationship_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_edge_route_completion');
  if (
    raw.record_type !== 'case_graph_edge_route_completion'
    || raw.schema_version !== CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION
    || raw.relationship_policy_version !== CASE_GRAPH_POLICY_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.preliminary_reducer_manifest_set_sha256 !== identity.preliminary_reducer_manifest_set_sha256
    || raw.edge_shard_count !== identity.edge_shard_count
    || raw.source_reducer_count !== identity.source_reducer_count
    || raw.preliminary_relationship_count !== identity.preliminary_relationship_count
    || !Array.isArray(raw.part_receipts)
  ) throw new Error('case_graph_edge_route_completion_identity_mismatch');
  const pointers = raw.part_receipts.map((pointer, index) => validatePointer(pointer, identity.corpus_version, index));
  const completion = { ...raw, part_receipts: pointers } as unknown as CaseGraphEdgeRouteCompletion;
  if (
    pointers.length !== identity.source_reducer_count
    || completion.routed_edge_count !== identity.preliminary_relationship_count
    || completion.routed_edge_count !== pointers.reduce((sum, pointer) => sum + pointer.routed_edge_count, 0)
    || completion.fragment_count !== pointers.reduce((sum, pointer) => sum + pointer.fragment_count, 0)
    || completion.receipt_set_sha256 !== receiptSetSha(pointers)
  ) throw new Error('case_graph_edge_route_completion_counters_invalid');
  return completion;
};

const uploadAndVerify = async (
  storage: CaseGraphArchiveStorage,
  body: Buffer,
  key: string,
  contentType: string,
  contentEncoding?: string,
) => {
  await storage.uploadFile(body, key, {
    contentType,
    ...(contentEncoding ? { contentEncoding } : {}),
    cacheControl: 'private, max-age=31536000, immutable',
    contentLength: body.length,
  });
  const stored = await storage.readObject(key);
  if (!stored || !stored.equals(body)) throw new Error('case_graph_edge_route_read_after_write_failed');
};

export const mapCaseGraphEdgeRoutes = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount?: number;
  minimumTermRarity?: number;
  edgeShardCount?: number;
  maxSourceReducersPerRun?: number;
  now?: () => Date;
}) => {
  const reducerShardCount = Math.trunc(params.reducerShardCount ?? 64);
  const minimumTermRarity = Number(params.minimumTermRarity ?? 0.55);
  const edgeShardCount = Math.trunc(params.edgeShardCount ?? 64);
  const maxSourceReducersPerRun = Math.trunc(params.maxSourceReducersPerRun ?? 2);
  if (!Number.isSafeInteger(edgeShardCount) || edgeShardCount < 1 || edgeShardCount > 4096) {
    throw new Error('case_graph_edge_shard_count_invalid');
  }
  if (!Number.isSafeInteger(maxSourceReducersPerRun) || maxSourceReducersPerRun < 1 || maxSourceReducersPerRun > 100) {
    throw new Error('case_graph_edge_route_max_reducers_invalid');
  }
  const preliminary = await readVerifiedCaseGraphPreliminaryReducers({
    corpusVersion: params.corpusVersion,
    storage: params.storage,
    reducerShardCount,
    minimumTermRarity,
  });
  const identity = {
    corpus_version: params.corpusVersion,
    preliminary_reducer_manifest_set_sha256: preliminary.completion.reducer_manifest_set_sha256,
    edge_shard_count: edgeShardCount,
    source_reducer_count: reducerShardCount,
    preliminary_relationship_count: preliminary.completion.preliminary_relationship_count,
  };
  const control = getCaseGraphEdgeRouteControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(control.completionManifestKey);
  if (completionBody) {
    const completion = validateCompletion(completionBody, identity);
    const receipts = await validateReceiptArtifacts(params.storage, completion.part_receipts, params.corpusVersion, edgeShardCount);
    return { status: 'already_complete' as const, completion, receipts };
  }
  const checkpointBody = await params.storage.readObject(control.checkpointKey);
  const now = params.now || (() => new Date());
  let checkpoint: EdgeRouteCheckpoint = checkpointBody ? validateCheckpoint(checkpointBody, identity) : {
    record_type: 'case_graph_edge_route_checkpoint',
    schema_version: CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    preliminary_reducer_manifest_set_sha256: identity.preliminary_reducer_manifest_set_sha256,
    edge_shard_count: edgeShardCount,
    next_source_reducer_shard: 0,
    routed_edge_count: 0,
    fragment_count: 0,
    part_receipts: [],
    updated_at: now().toISOString(),
  };
  if (checkpointBody) await validateReceiptArtifacts(
    params.storage,
    checkpoint.part_receipts,
    params.corpusVersion,
    edgeShardCount,
  );
  let processed = 0;
  while (checkpoint.next_source_reducer_shard < reducerShardCount && processed < maxSourceReducersPerRun) {
    const sourceReducerShard = checkpoint.next_source_reducer_shard;
    const sourceManifest = preliminary.manifests[sourceReducerShard];
    if (!sourceManifest || sourceManifest.reducer_shard !== sourceReducerShard) {
      throw new Error('case_graph_edge_route_source_manifest_missing');
    }
    const sourceBody = await params.storage.readObject(sourceManifest.relationships_key);
    if (!sourceBody) throw new Error('case_graph_edge_route_source_archive_missing');
    const relationships = decodeCaseGraphPreliminaryRelationships(sourceBody, sourceManifest);
    if (relationships.length !== sourceManifest.relationship_count) {
      throw new Error('case_graph_edge_route_source_count_mismatch');
    }
    const builtFragments = buildCaseGraphEdgeRouteFragments({
      corpusVersion: params.corpusVersion,
      sourceReducerShard,
      edgeShardCount,
      relationships,
    });
    const fragmentManifests: CaseGraphEdgeRouteFragmentManifest[] = [];
    for (const built of builtFragments) {
      await uploadAndVerify(params.storage, built.archiveBody, built.manifest.archive_key, 'application/x-ndjson', 'gzip');
      await uploadAndVerify(params.storage, built.manifestBody, built.manifest.manifest_key, 'application/json');
      fragmentManifests.push(built.manifest);
    }
    const receipt: CaseGraphEdgeRoutePartReceipt = {
      record_type: 'case_graph_edge_route_part_receipt',
      schema_version: CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION,
      corpus_version: params.corpusVersion,
      source_reducer_shard: sourceReducerShard,
      source_relationships_sha256: sourceManifest.relationships_sha256,
      source_relationship_count: relationships.length,
      edge_shard_count: edgeShardCount,
      fragment_count: fragmentManifests.length,
      routed_edge_count: fragmentManifests.reduce((sum, manifest) => sum + manifest.edge_count, 0),
      fragments: fragmentManifests,
    };
    const receiptKey = getCaseGraphEdgeRoutePartReceiptKey(params.corpusVersion, sourceReducerShard);
    const receiptBody = jsonBody(receipt);
    await uploadAndVerify(params.storage, receiptBody, receiptKey, 'application/json');
    const pointer: RouteReceiptPointer = {
      source_reducer_shard: sourceReducerShard,
      key: receiptKey,
      sha256: sha256(receiptBody),
      source_relationship_count: relationships.length,
      fragment_count: receipt.fragment_count,
      routed_edge_count: receipt.routed_edge_count,
    };
    checkpoint = {
      ...checkpoint,
      next_source_reducer_shard: sourceReducerShard + 1,
      routed_edge_count: checkpoint.routed_edge_count + receipt.routed_edge_count,
      fragment_count: checkpoint.fragment_count + receipt.fragment_count,
      part_receipts: [...checkpoint.part_receipts, pointer],
      updated_at: now().toISOString(),
    };
    const body = jsonBody(checkpoint);
    await params.storage.uploadFile(body, control.checkpointKey, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length,
    });
    const stored = await params.storage.readObject(control.checkpointKey);
    if (!stored || !stored.equals(body)) throw new Error('case_graph_edge_route_checkpoint_read_after_write_failed');
    processed += 1;
  }
  if (checkpoint.next_source_reducer_shard < reducerShardCount) return {
    status: 'partial' as const,
    checkpoint,
    remaining_source_reducers: reducerShardCount - checkpoint.next_source_reducer_shard,
  };
  if (checkpoint.routed_edge_count !== identity.preliminary_relationship_count) {
    throw new Error('case_graph_edge_route_total_mismatch');
  }
  const completion: CaseGraphEdgeRouteCompletion = {
    record_type: 'case_graph_edge_route_completion',
    schema_version: CASE_GRAPH_EDGE_ROUTE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    preliminary_reducer_manifest_set_sha256: identity.preliminary_reducer_manifest_set_sha256,
    relationship_policy_version: CASE_GRAPH_POLICY_VERSION,
    source_reducer_count: reducerShardCount,
    edge_shard_count: edgeShardCount,
    preliminary_relationship_count: identity.preliminary_relationship_count,
    routed_edge_count: checkpoint.routed_edge_count,
    fragment_count: checkpoint.fragment_count,
    part_receipts: checkpoint.part_receipts,
    receipt_set_sha256: receiptSetSha(checkpoint.part_receipts),
    completed_at: now().toISOString(),
  };
  const body = jsonBody(completion);
  await uploadAndVerify(params.storage, body, control.completionManifestKey, 'application/json');
  const receipts = await validateReceiptArtifacts(params.storage, completion.part_receipts, params.corpusVersion, edgeShardCount);
  return { status: 'complete' as const, completion, receipts };
};

export const readVerifiedCaseGraphEdgeRoutes = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
}) => {
  const preliminary = await readVerifiedCaseGraphPreliminaryReducers(params);
  const identity = {
    corpus_version: params.corpusVersion,
    preliminary_reducer_manifest_set_sha256: preliminary.completion.reducer_manifest_set_sha256,
    edge_shard_count: params.edgeShardCount,
    source_reducer_count: params.reducerShardCount,
    preliminary_relationship_count: preliminary.completion.preliminary_relationship_count,
  };
  const control = getCaseGraphEdgeRouteControlKeys(params.corpusVersion);
  const body = await params.storage.readObject(control.completionManifestKey);
  if (!body) throw new Error('case_graph_edge_route_completion_missing');
  const completion = validateCompletion(body, identity);
  const receipts = await validateReceiptArtifacts(
    params.storage,
    completion.part_receipts,
    params.corpusVersion,
    params.edgeShardCount,
  );
  return { preliminary, completion, receipts };
};
