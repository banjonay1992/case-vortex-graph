import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  getCaseGraphNodeIndexControlKeys,
  getCaseGraphNodeIndexShardKeys,
} from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import {
  CASE_GRAPH_NODE_INDEX_VERSION,
  reduceCaseGraphNodeIndexShard,
  type CaseGraphEgoIndexRecord,
  type CaseGraphIncidentRouteFragment,
  type CaseGraphNodeRouteFragment,
  type CaseGraphPublicNode,
} from './nodeIndexRouting';
import {
  decodeCaseGraphNodeRouteFragment,
  readVerifiedCaseGraphNodeRoutes,
} from './nodeRouteArchive';

export const CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION = 1 as const;
const MAX_NODE_SHARD_BYTES = 512 * 1024 * 1024;

export type CaseGraphNodeIndexShardManifest = {
  record_type: 'case_graph_node_index_shard_manifest';
  schema_version: typeof CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION;
  node_index_version: typeof CASE_GRAPH_NODE_INDEX_VERSION;
  corpus_version: string;
  node_shard: number;
  node_shard_count: number;
  input_node_fragment_count: number;
  input_incident_fragment_count: number;
  node_count: number;
  connected_node_count: number;
  isolated_node_count: number;
  incident_count: number;
  maximum_degree: number;
  first_case_id: string | null;
  last_case_id: string | null;
  nodes_key: string;
  nodes_compressed_bytes: number;
  nodes_sha256: string;
  ego_index_key: string;
  ego_index_compressed_bytes: number;
  ego_index_sha256: string;
  manifest_key: string;
};

type NodeShardReceipt = {
  node_shard: number;
  manifest_key: string;
  manifest_sha256: string;
  node_count: number;
  connected_node_count: number;
  isolated_node_count: number;
  incident_count: number;
  maximum_degree: number;
};

type NodeIndexCheckpoint = {
  record_type: 'case_graph_node_index_checkpoint';
  schema_version: typeof CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  node_route_receipt_set_sha256: string;
  node_shard_count: number;
  next_node_shard: number;
  node_count: number;
  connected_node_count: number;
  isolated_node_count: number;
  incident_count: number;
  maximum_degree: number;
  shards: NodeShardReceipt[];
  updated_at: string;
};

export type CaseGraphNodeIndexCompletion = {
  record_type: 'case_graph_node_index_completion';
  schema_version: typeof CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION;
  node_index_version: typeof CASE_GRAPH_NODE_INDEX_VERSION;
  corpus_version: string;
  node_route_receipt_set_sha256: string;
  node_shard_count: number;
  eligible_case_count: number;
  node_count: number;
  connected_node_count: number;
  isolated_node_count: number;
  incident_count: number;
  unique_edge_count: number;
  maximum_degree: number;
  shards: NodeShardReceipt[];
  shard_manifest_set_sha256: string;
  completed_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const shardSetSha = (receipts: readonly NodeShardReceipt[]) => createHash('sha256')
  .update(receipts.map((receipt) => `${receipt.node_shard}:${receipt.manifest_sha256}`).join('\n'))
  .digest('hex');

const gzipNdjson = (rows: readonly unknown[]) => {
  const raw = Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
  if (raw.length > MAX_NODE_SHARD_BYTES) throw new Error('case_graph_node_index_shard_size_limit_exceeded');
  return gzipSync(raw, { level: 6 });
};

export const buildCaseGraphNodeIndexShardArchive = (result: ReturnType<typeof reduceCaseGraphNodeIndexShard>) => {
  if (
    result.manifest.nodeCount !== result.nodes.length
    || result.egoIndex.length !== result.nodes.length
    || result.manifest.connectedNodeCount + result.manifest.isolatedNodeCount !== result.nodes.length
    || result.manifest.incidentCount !== result.egoIndex.reduce((sum, record) => sum + record.degree, 0)
  ) throw new Error('case_graph_node_index_result_invalid');
  const nodesBody = gzipNdjson(result.nodes);
  const egoBody = gzipNdjson(result.egoIndex);
  const keys = getCaseGraphNodeIndexShardKeys(result.corpusVersion, result.nodeShard);
  const manifest: CaseGraphNodeIndexShardManifest = {
    record_type: 'case_graph_node_index_shard_manifest',
    schema_version: CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION,
    node_index_version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpus_version: result.corpusVersion,
    node_shard: result.nodeShard,
    node_shard_count: result.nodeShardCount,
    input_node_fragment_count: 0,
    input_incident_fragment_count: 0,
    node_count: result.manifest.nodeCount,
    connected_node_count: result.manifest.connectedNodeCount,
    isolated_node_count: result.manifest.isolatedNodeCount,
    incident_count: result.manifest.incidentCount,
    maximum_degree: result.manifest.maximumDegree,
    first_case_id: result.nodes[0]?.caseId || null,
    last_case_id: result.nodes.at(-1)?.caseId || null,
    nodes_key: keys.nodesKey,
    nodes_compressed_bytes: nodesBody.length,
    nodes_sha256: sha256(nodesBody),
    ego_index_key: keys.egoIndexKey,
    ego_index_compressed_bytes: egoBody.length,
    ego_index_sha256: sha256(egoBody),
    manifest_key: keys.manifestKey,
  };
  return { nodesBody, egoBody, manifest, manifestBody: jsonBody(manifest) };
};

const decodeNdjson = <T>(body: Buffer, expectedBytes: number, expectedSha: string): T[] => {
  if (body.length !== expectedBytes || sha256(body) !== expectedSha) {
    throw new Error('case_graph_node_index_archive_checksum_mismatch');
  }
  const raw = gunzipSync(body, { maxOutputLength: MAX_NODE_SHARD_BYTES }).toString('utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
};

export const decodeCaseGraphPublicNodeShard = (body: Buffer, manifest: CaseGraphNodeIndexShardManifest) => {
  const nodes = decodeNdjson<CaseGraphPublicNode>(body, manifest.nodes_compressed_bytes, manifest.nodes_sha256);
  if (
    nodes.length !== manifest.node_count
    || (nodes[0]?.caseId || null) !== manifest.first_case_id
    || (nodes.at(-1)?.caseId || null) !== manifest.last_case_id
  ) throw new Error('case_graph_node_index_nodes_manifest_mismatch');
  return nodes;
};

export const decodeCaseGraphEgoIndexShard = (body: Buffer, manifest: CaseGraphNodeIndexShardManifest) => {
  const records = decodeNdjson<CaseGraphEgoIndexRecord>(body, manifest.ego_index_compressed_bytes, manifest.ego_index_sha256);
  if (
    records.length !== manifest.node_count
    || records.reduce((sum, record) => sum + record.degree, 0) !== manifest.incident_count
  ) throw new Error('case_graph_node_index_ego_manifest_mismatch');
  return records;
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

const validateReceipt = (value: unknown, corpusVersion: string, nodeShard: number): NodeShardReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_node_index_receipt_invalid');
  const receipt = value as Partial<NodeShardReceipt>;
  if (
    receipt.node_shard !== nodeShard
    || receipt.manifest_key !== getCaseGraphNodeIndexShardKeys(corpusVersion, nodeShard).manifestKey
    || !/^[a-f0-9]{64}$/.test(String(receipt.manifest_sha256 || ''))
    || !Number.isSafeInteger(receipt.node_count)
    || Number(receipt.node_count) < 0
    || !Number.isSafeInteger(receipt.connected_node_count)
    || !Number.isSafeInteger(receipt.isolated_node_count)
    || Number(receipt.connected_node_count) + Number(receipt.isolated_node_count) !== Number(receipt.node_count)
    || !Number.isSafeInteger(receipt.incident_count)
    || Number(receipt.incident_count) < 0
    || !Number.isSafeInteger(receipt.maximum_degree)
    || Number(receipt.maximum_degree) < 0
  ) throw new Error('case_graph_node_index_receipt_invalid');
  return receipt as NodeShardReceipt;
};

const validateShardArtifacts = async (
  storage: CaseGraphArchiveStorage,
  receipts: readonly NodeShardReceipt[],
  corpusVersion: string,
  nodeShardCount: number,
) => {
  const manifests: CaseGraphNodeIndexShardManifest[] = [];
  for (const receipt of receipts) {
    const body = await storage.readObject(receipt.manifest_key);
    if (!body || sha256(body) !== receipt.manifest_sha256) throw new Error('case_graph_node_index_manifest_mismatch');
    const manifest = parseObject(body, 'case_graph_node_index_manifest') as unknown as CaseGraphNodeIndexShardManifest;
    if (
      manifest.record_type !== 'case_graph_node_index_shard_manifest'
      || manifest.schema_version !== CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION
      || manifest.node_index_version !== CASE_GRAPH_NODE_INDEX_VERSION
      || manifest.corpus_version !== corpusVersion
      || manifest.node_shard !== receipt.node_shard
      || manifest.node_shard_count !== nodeShardCount
      || manifest.node_count !== receipt.node_count
      || manifest.connected_node_count !== receipt.connected_node_count
      || manifest.isolated_node_count !== receipt.isolated_node_count
      || manifest.incident_count !== receipt.incident_count
      || manifest.maximum_degree !== receipt.maximum_degree
    ) throw new Error('case_graph_node_index_manifest_invalid');
    manifests.push(manifest);
  }
  return manifests;
};

const parseCheckpoint = (body: Buffer, identity: {
  corpus_version: string;
  node_route_receipt_set_sha256: string;
  node_shard_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_node_index_checkpoint');
  if (
    raw.record_type !== 'case_graph_node_index_checkpoint'
    || raw.schema_version !== CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.node_route_receipt_set_sha256 !== identity.node_route_receipt_set_sha256
    || raw.node_shard_count !== identity.node_shard_count
    || !Array.isArray(raw.shards)
  ) throw new Error('case_graph_node_index_checkpoint_identity_mismatch');
  const shards = raw.shards.map((receipt, index) => validateReceipt(receipt, identity.corpus_version, index));
  const checkpoint = { ...raw, shards } as unknown as NodeIndexCheckpoint;
  if (
    checkpoint.next_node_shard !== shards.length
    || checkpoint.node_count !== shards.reduce((sum, receipt) => sum + receipt.node_count, 0)
    || checkpoint.connected_node_count !== shards.reduce((sum, receipt) => sum + receipt.connected_node_count, 0)
    || checkpoint.isolated_node_count !== shards.reduce((sum, receipt) => sum + receipt.isolated_node_count, 0)
    || checkpoint.incident_count !== shards.reduce((sum, receipt) => sum + receipt.incident_count, 0)
    || checkpoint.maximum_degree !== shards.reduce((maximum, receipt) => Math.max(maximum, receipt.maximum_degree), 0)
  ) throw new Error('case_graph_node_index_checkpoint_counters_invalid');
  return checkpoint;
};

const parseCompletion = (body: Buffer, identity: {
  corpus_version: string;
  node_route_receipt_set_sha256: string;
  node_shard_count: number;
  eligible_case_count: number;
  unique_edge_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_node_index_completion');
  if (
    raw.record_type !== 'case_graph_node_index_completion'
    || raw.schema_version !== CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION
    || raw.node_index_version !== CASE_GRAPH_NODE_INDEX_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.node_route_receipt_set_sha256 !== identity.node_route_receipt_set_sha256
    || raw.node_shard_count !== identity.node_shard_count
    || raw.eligible_case_count !== identity.eligible_case_count
    || raw.unique_edge_count !== identity.unique_edge_count
    || !Array.isArray(raw.shards)
  ) throw new Error('case_graph_node_index_completion_identity_mismatch');
  const shards = raw.shards.map((receipt, index) => validateReceipt(receipt, identity.corpus_version, index));
  const completion = { ...raw, shards } as unknown as CaseGraphNodeIndexCompletion;
  if (
    shards.length !== identity.node_shard_count
    || completion.node_count !== identity.eligible_case_count
    || completion.node_count !== completion.connected_node_count + completion.isolated_node_count
    || completion.incident_count !== identity.unique_edge_count * 2
    || completion.node_count !== shards.reduce((sum, receipt) => sum + receipt.node_count, 0)
    || completion.incident_count !== shards.reduce((sum, receipt) => sum + receipt.incident_count, 0)
    || completion.maximum_degree !== shards.reduce((maximum, receipt) => Math.max(maximum, receipt.maximum_degree), 0)
    || completion.shard_manifest_set_sha256 !== shardSetSha(shards)
  ) throw new Error('case_graph_node_index_completion_counters_invalid');
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
  if (!stored || !stored.equals(body)) throw new Error('case_graph_node_index_read_after_write_failed');
};

export const reduceCaseGraphNodeIndex = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
  nodeShardCount?: number;
  maxNodeShardsPerRun?: number;
  now?: () => Date;
}) => {
  const nodeShardCount = Math.trunc(params.nodeShardCount ?? 64);
  const maxNodeShardsPerRun = Math.trunc(params.maxNodeShardsPerRun ?? 2);
  if (!Number.isSafeInteger(maxNodeShardsPerRun) || maxNodeShardsPerRun < 1 || maxNodeShardsPerRun > 100) {
    throw new Error('case_graph_node_index_max_shards_invalid');
  }
  const routes = await readVerifiedCaseGraphNodeRoutes({ ...params, nodeShardCount });
  const identity = {
    corpus_version: params.corpusVersion,
    node_route_receipt_set_sha256: routes.completion.receipt_set_sha256,
    node_shard_count: nodeShardCount,
    eligible_case_count: routes.completion.node_count,
    unique_edge_count: routes.edges.completion.unique_edge_count,
  };
  const control = getCaseGraphNodeIndexControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(control.completionManifestKey);
  if (completionBody) {
    const completion = parseCompletion(completionBody, identity);
    const manifests = await validateShardArtifacts(params.storage, completion.shards, params.corpusVersion, nodeShardCount);
    return { status: 'already_complete' as const, completion, manifests };
  }
  const checkpointBody = await params.storage.readObject(control.checkpointKey);
  const now = params.now || (() => new Date());
  let checkpoint: NodeIndexCheckpoint = checkpointBody ? parseCheckpoint(checkpointBody, identity) : {
    record_type: 'case_graph_node_index_checkpoint',
    schema_version: CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    node_route_receipt_set_sha256: identity.node_route_receipt_set_sha256,
    node_shard_count: nodeShardCount,
    next_node_shard: 0,
    node_count: 0,
    connected_node_count: 0,
    isolated_node_count: 0,
    incident_count: 0,
    maximum_degree: 0,
    shards: [],
    updated_at: now().toISOString(),
  };
  if (checkpointBody) await validateShardArtifacts(params.storage, checkpoint.shards, params.corpusVersion, nodeShardCount);
  let processed = 0;
  while (checkpoint.next_node_shard < nodeShardCount && processed < maxNodeShardsPerRun) {
    const nodeShard = checkpoint.next_node_shard;
    const nodeManifests = routes.featureReceipts.flatMap((receipt) => receipt.fragments)
      .filter((manifest) => manifest.node_shard === nodeShard)
      .sort((left, right) => left.input_number - right.input_number);
    const incidentManifests = routes.edgeReceipts.flatMap((receipt) => receipt.fragments)
      .filter((manifest) => manifest.node_shard === nodeShard)
      .sort((left, right) => left.input_number - right.input_number);
    const nodeFragments: CaseGraphNodeRouteFragment[] = [];
    const incidentFragments: CaseGraphIncidentRouteFragment[] = [];
    for (const manifest of nodeManifests) {
      const body = await params.storage.readObject(manifest.archive_key);
      if (!body) throw new Error('case_graph_node_index_route_archive_missing');
      nodeFragments.push(decodeCaseGraphNodeRouteFragment(body, manifest) as CaseGraphNodeRouteFragment);
    }
    for (const manifest of incidentManifests) {
      const body = await params.storage.readObject(manifest.archive_key);
      if (!body) throw new Error('case_graph_node_index_route_archive_missing');
      incidentFragments.push(decodeCaseGraphNodeRouteFragment(body, manifest) as CaseGraphIncidentRouteFragment);
    }
    const result = reduceCaseGraphNodeIndexShard({
      corpusVersion: params.corpusVersion,
      nodeShard,
      nodeShardCount,
      nodeFragments,
      incidentFragments,
    });
    const built = buildCaseGraphNodeIndexShardArchive(result);
    built.manifest.input_node_fragment_count = nodeManifests.length;
    built.manifest.input_incident_fragment_count = incidentManifests.length;
    built.manifestBody = jsonBody(built.manifest);
    await uploadAndVerify(params.storage, built.nodesBody, built.manifest.nodes_key, 'application/x-ndjson', 'gzip');
    await uploadAndVerify(params.storage, built.egoBody, built.manifest.ego_index_key, 'application/x-ndjson', 'gzip');
    await uploadAndVerify(params.storage, built.manifestBody, built.manifest.manifest_key, 'application/json');
    const receipt: NodeShardReceipt = {
      node_shard: nodeShard,
      manifest_key: built.manifest.manifest_key,
      manifest_sha256: sha256(built.manifestBody),
      node_count: built.manifest.node_count,
      connected_node_count: built.manifest.connected_node_count,
      isolated_node_count: built.manifest.isolated_node_count,
      incident_count: built.manifest.incident_count,
      maximum_degree: built.manifest.maximum_degree,
    };
    checkpoint = {
      ...checkpoint,
      next_node_shard: nodeShard + 1,
      node_count: checkpoint.node_count + receipt.node_count,
      connected_node_count: checkpoint.connected_node_count + receipt.connected_node_count,
      isolated_node_count: checkpoint.isolated_node_count + receipt.isolated_node_count,
      incident_count: checkpoint.incident_count + receipt.incident_count,
      maximum_degree: Math.max(checkpoint.maximum_degree, receipt.maximum_degree),
      shards: [...checkpoint.shards, receipt],
      updated_at: now().toISOString(),
    };
    const body = jsonBody(checkpoint);
    await params.storage.uploadFile(body, control.checkpointKey, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length,
    });
    const stored = await params.storage.readObject(control.checkpointKey);
    if (!stored || !stored.equals(body)) throw new Error('case_graph_node_index_checkpoint_read_after_write_failed');
    processed += 1;
  }
  if (checkpoint.next_node_shard < nodeShardCount) return {
    status: 'partial' as const,
    checkpoint,
    remaining_node_shards: nodeShardCount - checkpoint.next_node_shard,
  };
  if (checkpoint.node_count !== identity.eligible_case_count || checkpoint.incident_count !== identity.unique_edge_count * 2) {
    throw new Error('case_graph_node_index_total_mismatch');
  }
  const completion: CaseGraphNodeIndexCompletion = {
    record_type: 'case_graph_node_index_completion',
    schema_version: CASE_GRAPH_NODE_ARCHIVE_SCHEMA_VERSION,
    node_index_version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpus_version: params.corpusVersion,
    node_route_receipt_set_sha256: identity.node_route_receipt_set_sha256,
    node_shard_count: nodeShardCount,
    eligible_case_count: identity.eligible_case_count,
    node_count: checkpoint.node_count,
    connected_node_count: checkpoint.connected_node_count,
    isolated_node_count: checkpoint.isolated_node_count,
    incident_count: checkpoint.incident_count,
    unique_edge_count: identity.unique_edge_count,
    maximum_degree: checkpoint.maximum_degree,
    shards: checkpoint.shards,
    shard_manifest_set_sha256: shardSetSha(checkpoint.shards),
    completed_at: now().toISOString(),
  };
  const body = jsonBody(completion);
  await uploadAndVerify(params.storage, body, control.completionManifestKey, 'application/json');
  const manifests = await validateShardArtifacts(params.storage, completion.shards, params.corpusVersion, nodeShardCount);
  return { status: 'complete' as const, completion, manifests };
};

export const readVerifiedCaseGraphNodeIndex = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
  nodeShardCount: number;
}) => {
  const routes = await readVerifiedCaseGraphNodeRoutes(params);
  const identity = {
    corpus_version: params.corpusVersion,
    node_route_receipt_set_sha256: routes.completion.receipt_set_sha256,
    node_shard_count: params.nodeShardCount,
    eligible_case_count: routes.completion.node_count,
    unique_edge_count: routes.edges.completion.unique_edge_count,
  };
  const control = getCaseGraphNodeIndexControlKeys(params.corpusVersion);
  const body = await params.storage.readObject(control.completionManifestKey);
  if (!body) throw new Error('case_graph_node_index_completion_missing');
  const completion = parseCompletion(body, identity);
  const manifests = await validateShardArtifacts(
    params.storage,
    completion.shards,
    params.corpusVersion,
    params.nodeShardCount,
  );
  return { routes, completion, manifests };
};
