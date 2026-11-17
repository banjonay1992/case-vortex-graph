import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  getCaseGraphNodeRouteControlKeys,
  getCaseGraphNodeRouteFragmentKeys,
  getCaseGraphNodeRoutePartReceiptKey,
} from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import {
  decodeCaseGraphFinalEdgeShard,
  readVerifiedCaseGraphFinalEdges,
} from './finalEdgeArchive';
import { readVerifiedCaseGraphFeatureArchive } from './featureArchive';
import { decodeCaseGraphFeaturePart } from './featureArchiveCodec';
import {
  buildCaseGraphIncidentRouteFragments,
  buildCaseGraphNodeRouteFragments,
  CASE_GRAPH_NODE_INDEX_VERSION,
  type CaseGraphIncidentRouteFragment,
  type CaseGraphNodeRouteFragment,
} from './nodeIndexRouting';

export const CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION = 1 as const;
const MAX_NODE_ROUTE_BYTES = 256 * 1024 * 1024;

type InputKind = 'feature' | 'edge';

export type CaseGraphNodeRouteFragmentManifest = {
  record_type: 'case_graph_node_route_fragment_manifest';
  schema_version: typeof CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION;
  node_index_version: typeof CASE_GRAPH_NODE_INDEX_VERSION;
  corpus_version: string;
  input_kind: InputKind;
  input_number: number;
  node_shard: number;
  node_shard_count: number;
  node_count: number;
  incident_count: number;
  archive_key: string;
  manifest_key: string;
  compressed_bytes: number;
  compressed_sha256: string;
};

export type CaseGraphNodeRoutePartReceipt = {
  record_type: 'case_graph_node_route_part_receipt';
  schema_version: typeof CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION;
  corpus_version: string;
  input_kind: InputKind;
  input_number: number;
  source_sha256: string;
  source_record_count: number;
  node_shard_count: number;
  fragment_count: number;
  node_count: number;
  incident_count: number;
  fragments: CaseGraphNodeRouteFragmentManifest[];
};

type NodeRoutePointer = {
  input_kind: InputKind;
  input_number: number;
  key: string;
  sha256: string;
  source_record_count: number;
  fragment_count: number;
  node_count: number;
  incident_count: number;
};

type NodeRouteCheckpoint = {
  record_type: 'case_graph_node_route_checkpoint';
  schema_version: typeof CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION;
  corpus_version: string;
  feature_archive_set_sha256: string;
  final_edge_manifest_set_sha256: string;
  node_shard_count: number;
  next_feature_part: number;
  next_edge_shard: number;
  node_count: number;
  incident_count: number;
  fragment_count: number;
  feature_receipts: NodeRoutePointer[];
  edge_receipts: NodeRoutePointer[];
  updated_at: string;
};

export type CaseGraphNodeRouteCompletion = {
  record_type: 'case_graph_node_route_completion';
  schema_version: typeof CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION;
  node_index_version: typeof CASE_GRAPH_NODE_INDEX_VERSION;
  corpus_version: string;
  feature_archive_set_sha256: string;
  final_edge_manifest_set_sha256: string;
  node_shard_count: number;
  feature_part_count: number;
  edge_shard_count: number;
  node_count: number;
  incident_count: number;
  fragment_count: number;
  feature_receipts: NodeRoutePointer[];
  edge_receipts: NodeRoutePointer[];
  receipt_set_sha256: string;
  completed_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const receiptSetSha = (feature: readonly NodeRoutePointer[], edges: readonly NodeRoutePointer[]) => createHash('sha256')
  .update([...feature, ...edges].map((pointer) => `${pointer.input_kind}:${pointer.input_number}:${pointer.sha256}`).join('\n'))
  .digest('hex');

const buildFragmentArchive = (
  fragment: CaseGraphNodeRouteFragment | CaseGraphIncidentRouteFragment,
  inputKind: InputKind,
) => {
  const inputNumber = inputKind === 'feature'
    ? (fragment as CaseGraphNodeRouteFragment).inputFeaturePart
    : (fragment as CaseGraphIncidentRouteFragment).inputEdgeShard;
  const nodeCount = inputKind === 'feature' ? (fragment as CaseGraphNodeRouteFragment).nodes.length : 0;
  const incidentCount = inputKind === 'edge' ? (fragment as CaseGraphIncidentRouteFragment).incidents.length : 0;
  const raw = jsonBody(fragment);
  if (raw.length > MAX_NODE_ROUTE_BYTES) throw new Error('case_graph_node_route_size_limit_exceeded');
  const archiveBody = gzipSync(raw, { level: 6 });
  const keys = getCaseGraphNodeRouteFragmentKeys(
    fragment.corpusVersion,
    fragment.nodeShard,
    inputKind,
    inputNumber,
  );
  const manifest: CaseGraphNodeRouteFragmentManifest = {
    record_type: 'case_graph_node_route_fragment_manifest',
    schema_version: CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION,
    node_index_version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpus_version: fragment.corpusVersion,
    input_kind: inputKind,
    input_number: inputNumber,
    node_shard: fragment.nodeShard,
    node_shard_count: fragment.nodeShardCount,
    node_count: nodeCount,
    incident_count: incidentCount,
    archive_key: keys.archiveKey,
    manifest_key: keys.manifestKey,
    compressed_bytes: archiveBody.length,
    compressed_sha256: sha256(archiveBody),
  };
  return { archiveBody, manifest, manifestBody: jsonBody(manifest) };
};

export const decodeCaseGraphNodeRouteFragment = (
  body: Buffer,
  manifest: CaseGraphNodeRouteFragmentManifest,
) => {
  if (body.length !== manifest.compressed_bytes || sha256(body) !== manifest.compressed_sha256) {
    throw new Error('case_graph_node_route_checksum_mismatch');
  }
  const raw = gunzipSync(body, { maxOutputLength: MAX_NODE_ROUTE_BYTES }).toString('utf8');
  const fragment = JSON.parse(raw) as CaseGraphNodeRouteFragment | CaseGraphIncidentRouteFragment;
  const expected = buildFragmentArchive(fragment, manifest.input_kind).manifest;
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error('case_graph_node_route_manifest_mismatch');
  return fragment;
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

const validatePointer = (
  value: unknown,
  corpusVersion: string,
  inputKind: InputKind,
  inputNumber: number,
): NodeRoutePointer => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_node_route_pointer_invalid');
  const pointer = value as Partial<NodeRoutePointer>;
  if (
    pointer.input_kind !== inputKind
    || pointer.input_number !== inputNumber
    || pointer.key !== getCaseGraphNodeRoutePartReceiptKey(corpusVersion, inputKind, inputNumber)
    || !/^[a-f0-9]{64}$/.test(String(pointer.sha256 || ''))
    || !Number.isSafeInteger(pointer.source_record_count)
    || Number(pointer.source_record_count) < 0
    || !Number.isSafeInteger(pointer.fragment_count)
    || Number(pointer.fragment_count) < 0
    || !Number.isSafeInteger(pointer.node_count)
    || Number(pointer.node_count) < 0
    || !Number.isSafeInteger(pointer.incident_count)
    || Number(pointer.incident_count) < 0
  ) throw new Error('case_graph_node_route_pointer_invalid');
  return pointer as NodeRoutePointer;
};

const validateReceiptArtifacts = async (
  storage: CaseGraphArchiveStorage,
  pointers: readonly NodeRoutePointer[],
  corpusVersion: string,
  nodeShardCount: number,
) => {
  const receipts: CaseGraphNodeRoutePartReceipt[] = [];
  for (const pointer of pointers) {
    const body = await storage.readObject(pointer.key);
    if (!body || sha256(body) !== pointer.sha256) throw new Error('case_graph_node_route_receipt_mismatch');
    const receipt = parseObject(body, 'case_graph_node_route_receipt') as unknown as CaseGraphNodeRoutePartReceipt;
    if (
      receipt.record_type !== 'case_graph_node_route_part_receipt'
      || receipt.schema_version !== CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION
      || receipt.corpus_version !== corpusVersion
      || receipt.input_kind !== pointer.input_kind
      || receipt.input_number !== pointer.input_number
      || receipt.source_record_count !== pointer.source_record_count
      || receipt.node_shard_count !== nodeShardCount
      || receipt.fragment_count !== pointer.fragment_count
      || receipt.node_count !== pointer.node_count
      || receipt.incident_count !== pointer.incident_count
      || !Array.isArray(receipt.fragments)
      || receipt.fragments.length !== receipt.fragment_count
      || receipt.fragments.reduce((sum, fragment) => sum + fragment.node_count, 0) !== receipt.node_count
      || receipt.fragments.reduce((sum, fragment) => sum + fragment.incident_count, 0) !== receipt.incident_count
    ) throw new Error('case_graph_node_route_receipt_invalid');
    const shards = new Set<number>();
    for (const fragment of receipt.fragments) {
      if (
        fragment.input_kind !== pointer.input_kind
        || fragment.input_number !== pointer.input_number
        || fragment.node_shard_count !== nodeShardCount
        || shards.has(fragment.node_shard)
      ) throw new Error('case_graph_node_route_receipt_fragment_invalid');
      shards.add(fragment.node_shard);
      const manifestBody = await storage.readObject(fragment.manifest_key);
      if (!manifestBody || !manifestBody.equals(jsonBody(fragment))) {
        throw new Error('case_graph_node_route_fragment_manifest_mismatch');
      }
    }
    receipts.push(receipt);
  }
  return receipts;
};

const validateCheckpoint = (body: Buffer, identity: {
  corpus_version: string;
  feature_archive_set_sha256: string;
  final_edge_manifest_set_sha256: string;
  node_shard_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_node_route_checkpoint');
  if (
    raw.record_type !== 'case_graph_node_route_checkpoint'
    || raw.schema_version !== CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.feature_archive_set_sha256 !== identity.feature_archive_set_sha256
    || raw.final_edge_manifest_set_sha256 !== identity.final_edge_manifest_set_sha256
    || raw.node_shard_count !== identity.node_shard_count
    || !Array.isArray(raw.feature_receipts)
    || !Array.isArray(raw.edge_receipts)
  ) throw new Error('case_graph_node_route_checkpoint_identity_mismatch');
  const feature = raw.feature_receipts.map((pointer, index) => validatePointer(pointer, identity.corpus_version, 'feature', index));
  const edges = raw.edge_receipts.map((pointer, index) => validatePointer(pointer, identity.corpus_version, 'edge', index));
  const checkpoint = { ...raw, feature_receipts: feature, edge_receipts: edges } as unknown as NodeRouteCheckpoint;
  const all = [...feature, ...edges];
  if (
    checkpoint.next_feature_part !== feature.length
    || checkpoint.next_edge_shard !== edges.length
    || checkpoint.node_count !== all.reduce((sum, pointer) => sum + pointer.node_count, 0)
    || checkpoint.incident_count !== all.reduce((sum, pointer) => sum + pointer.incident_count, 0)
    || checkpoint.fragment_count !== all.reduce((sum, pointer) => sum + pointer.fragment_count, 0)
  ) throw new Error('case_graph_node_route_checkpoint_counters_invalid');
  return checkpoint;
};

const validateCompletion = (body: Buffer, identity: {
  corpus_version: string;
  feature_archive_set_sha256: string;
  final_edge_manifest_set_sha256: string;
  node_shard_count: number;
  feature_part_count: number;
  edge_shard_count: number;
  node_count: number;
  incident_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_node_route_completion');
  if (
    raw.record_type !== 'case_graph_node_route_completion'
    || raw.schema_version !== CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION
    || raw.node_index_version !== CASE_GRAPH_NODE_INDEX_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.feature_archive_set_sha256 !== identity.feature_archive_set_sha256
    || raw.final_edge_manifest_set_sha256 !== identity.final_edge_manifest_set_sha256
    || raw.node_shard_count !== identity.node_shard_count
    || raw.feature_part_count !== identity.feature_part_count
    || raw.edge_shard_count !== identity.edge_shard_count
    || raw.node_count !== identity.node_count
    || raw.incident_count !== identity.incident_count
    || !Array.isArray(raw.feature_receipts)
    || !Array.isArray(raw.edge_receipts)
  ) throw new Error('case_graph_node_route_completion_identity_mismatch');
  const feature = raw.feature_receipts.map((pointer, index) => validatePointer(pointer, identity.corpus_version, 'feature', index));
  const edges = raw.edge_receipts.map((pointer, index) => validatePointer(pointer, identity.corpus_version, 'edge', index));
  const completion = { ...raw, feature_receipts: feature, edge_receipts: edges } as unknown as CaseGraphNodeRouteCompletion;
  const all = [...feature, ...edges];
  if (
    feature.length !== identity.feature_part_count
    || edges.length !== identity.edge_shard_count
    || completion.node_count !== all.reduce((sum, pointer) => sum + pointer.node_count, 0)
    || completion.incident_count !== all.reduce((sum, pointer) => sum + pointer.incident_count, 0)
    || completion.fragment_count !== all.reduce((sum, pointer) => sum + pointer.fragment_count, 0)
    || completion.receipt_set_sha256 !== receiptSetSha(feature, edges)
  ) throw new Error('case_graph_node_route_completion_counters_invalid');
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
  if (!stored || !stored.equals(body)) throw new Error('case_graph_node_route_read_after_write_failed');
};

export const mapCaseGraphNodeRoutes = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
  nodeShardCount?: number;
  maxInputUnitsPerRun?: number;
  now?: () => Date;
}) => {
  const nodeShardCount = Math.trunc(params.nodeShardCount ?? 64);
  const maxInputUnitsPerRun = Math.trunc(params.maxInputUnitsPerRun ?? 4);
  if (!Number.isSafeInteger(nodeShardCount) || nodeShardCount < 1 || nodeShardCount > 4096) {
    throw new Error('case_graph_node_shard_count_invalid');
  }
  if (!Number.isSafeInteger(maxInputUnitsPerRun) || maxInputUnitsPerRun < 1 || maxInputUnitsPerRun > 100) {
    throw new Error('case_graph_node_route_max_units_invalid');
  }
  const [features, edges] = await Promise.all([
    readVerifiedCaseGraphFeatureArchive(params.storage, params.corpusVersion),
    readVerifiedCaseGraphFinalEdges(params),
  ]);
  const identity = {
    corpus_version: params.corpusVersion,
    feature_archive_set_sha256: features.completion.archive_set_sha256,
    final_edge_manifest_set_sha256: edges.completion.shard_manifest_set_sha256,
    node_shard_count: nodeShardCount,
    feature_part_count: features.completion.part_count,
    edge_shard_count: params.edgeShardCount,
    node_count: features.completion.exported_row_count,
    incident_count: edges.completion.unique_edge_count * 2,
  };
  const control = getCaseGraphNodeRouteControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(control.completionManifestKey);
  if (completionBody) {
    const completion = validateCompletion(completionBody, identity);
    const featureReceipts = await validateReceiptArtifacts(params.storage, completion.feature_receipts, params.corpusVersion, nodeShardCount);
    const edgeReceipts = await validateReceiptArtifacts(params.storage, completion.edge_receipts, params.corpusVersion, nodeShardCount);
    return { status: 'already_complete' as const, completion, featureReceipts, edgeReceipts };
  }
  const checkpointBody = await params.storage.readObject(control.checkpointKey);
  const now = params.now || (() => new Date());
  let checkpoint: NodeRouteCheckpoint = checkpointBody ? validateCheckpoint(checkpointBody, identity) : {
    record_type: 'case_graph_node_route_checkpoint',
    schema_version: CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    feature_archive_set_sha256: identity.feature_archive_set_sha256,
    final_edge_manifest_set_sha256: identity.final_edge_manifest_set_sha256,
    node_shard_count: nodeShardCount,
    next_feature_part: 0,
    next_edge_shard: 0,
    node_count: 0,
    incident_count: 0,
    fragment_count: 0,
    feature_receipts: [],
    edge_receipts: [],
    updated_at: now().toISOString(),
  };
  if (checkpointBody) {
    await validateReceiptArtifacts(params.storage, checkpoint.feature_receipts, params.corpusVersion, nodeShardCount);
    await validateReceiptArtifacts(params.storage, checkpoint.edge_receipts, params.corpusVersion, nodeShardCount);
  }
  let processed = 0;
  while (processed < maxInputUnitsPerRun && (
    checkpoint.next_feature_part < identity.feature_part_count
    || checkpoint.next_edge_shard < identity.edge_shard_count
  )) {
    const inputKind: InputKind = checkpoint.next_feature_part < identity.feature_part_count ? 'feature' : 'edge';
    const inputNumber = inputKind === 'feature' ? checkpoint.next_feature_part : checkpoint.next_edge_shard;
    let sourceSha: string;
    let sourceRecordCount: number;
    let fragments: Array<CaseGraphNodeRouteFragment | CaseGraphIncidentRouteFragment>;
    if (inputKind === 'feature') {
      const part = features.completion.parts[inputNumber];
      const body = await params.storage.readObject(part.archive_key);
      if (!body || sha256(body) !== part.compressed_sha256) throw new Error('case_graph_node_route_feature_archive_mismatch');
      const records = decodeCaseGraphFeaturePart(body);
      if (records.length !== part.row_count) throw new Error('case_graph_node_route_feature_count_mismatch');
      sourceSha = part.compressed_sha256;
      sourceRecordCount = records.length;
      fragments = buildCaseGraphNodeRouteFragments({ records, inputFeaturePart: inputNumber, nodeShardCount });
    } else {
      const manifest = edges.manifests[inputNumber];
      const body = await params.storage.readObject(manifest.edges_key);
      if (!body) throw new Error('case_graph_node_route_edge_archive_missing');
      const relationships = decodeCaseGraphFinalEdgeShard(body, manifest);
      sourceSha = manifest.edges_sha256;
      sourceRecordCount = relationships.length;
      fragments = buildCaseGraphIncidentRouteFragments({
        corpusVersion: params.corpusVersion,
        relationships,
        inputEdgeShard: inputNumber,
        nodeShardCount,
      });
    }
    const manifests: CaseGraphNodeRouteFragmentManifest[] = [];
    for (const fragment of fragments) {
      const built = buildFragmentArchive(fragment, inputKind);
      await uploadAndVerify(params.storage, built.archiveBody, built.manifest.archive_key, 'application/json', 'gzip');
      await uploadAndVerify(params.storage, built.manifestBody, built.manifest.manifest_key, 'application/json');
      manifests.push(built.manifest);
    }
    const receipt: CaseGraphNodeRoutePartReceipt = {
      record_type: 'case_graph_node_route_part_receipt',
      schema_version: CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION,
      corpus_version: params.corpusVersion,
      input_kind: inputKind,
      input_number: inputNumber,
      source_sha256: sourceSha,
      source_record_count: sourceRecordCount,
      node_shard_count: nodeShardCount,
      fragment_count: manifests.length,
      node_count: manifests.reduce((sum, manifest) => sum + manifest.node_count, 0),
      incident_count: manifests.reduce((sum, manifest) => sum + manifest.incident_count, 0),
      fragments: manifests,
    };
    if (
      (inputKind === 'feature' && receipt.node_count !== sourceRecordCount)
      || (inputKind === 'edge' && receipt.incident_count !== sourceRecordCount * 2)
    ) throw new Error('case_graph_node_route_input_accounting_mismatch');
    const receiptKey = getCaseGraphNodeRoutePartReceiptKey(params.corpusVersion, inputKind, inputNumber);
    const receiptBody = jsonBody(receipt);
    await uploadAndVerify(params.storage, receiptBody, receiptKey, 'application/json');
    const pointer: NodeRoutePointer = {
      input_kind: inputKind,
      input_number: inputNumber,
      key: receiptKey,
      sha256: sha256(receiptBody),
      source_record_count: sourceRecordCount,
      fragment_count: receipt.fragment_count,
      node_count: receipt.node_count,
      incident_count: receipt.incident_count,
    };
    checkpoint = {
      ...checkpoint,
      next_feature_part: checkpoint.next_feature_part + (inputKind === 'feature' ? 1 : 0),
      next_edge_shard: checkpoint.next_edge_shard + (inputKind === 'edge' ? 1 : 0),
      node_count: checkpoint.node_count + receipt.node_count,
      incident_count: checkpoint.incident_count + receipt.incident_count,
      fragment_count: checkpoint.fragment_count + receipt.fragment_count,
      feature_receipts: inputKind === 'feature' ? [...checkpoint.feature_receipts, pointer] : checkpoint.feature_receipts,
      edge_receipts: inputKind === 'edge' ? [...checkpoint.edge_receipts, pointer] : checkpoint.edge_receipts,
      updated_at: now().toISOString(),
    };
    const body = jsonBody(checkpoint);
    await params.storage.uploadFile(body, control.checkpointKey, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length,
    });
    const stored = await params.storage.readObject(control.checkpointKey);
    if (!stored || !stored.equals(body)) throw new Error('case_graph_node_route_checkpoint_read_after_write_failed');
    processed += 1;
  }
  const remaining = (identity.feature_part_count - checkpoint.next_feature_part)
    + (identity.edge_shard_count - checkpoint.next_edge_shard);
  if (remaining > 0) return { status: 'partial' as const, checkpoint, remaining_input_units: remaining };
  if (checkpoint.node_count !== identity.node_count || checkpoint.incident_count !== identity.incident_count) {
    throw new Error('case_graph_node_route_total_mismatch');
  }
  const completion: CaseGraphNodeRouteCompletion = {
    record_type: 'case_graph_node_route_completion',
    schema_version: CASE_GRAPH_NODE_ROUTE_SCHEMA_VERSION,
    node_index_version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpus_version: params.corpusVersion,
    feature_archive_set_sha256: identity.feature_archive_set_sha256,
    final_edge_manifest_set_sha256: identity.final_edge_manifest_set_sha256,
    node_shard_count: nodeShardCount,
    feature_part_count: identity.feature_part_count,
    edge_shard_count: identity.edge_shard_count,
    node_count: checkpoint.node_count,
    incident_count: checkpoint.incident_count,
    fragment_count: checkpoint.fragment_count,
    feature_receipts: checkpoint.feature_receipts,
    edge_receipts: checkpoint.edge_receipts,
    receipt_set_sha256: receiptSetSha(checkpoint.feature_receipts, checkpoint.edge_receipts),
    completed_at: now().toISOString(),
  };
  const body = jsonBody(completion);
  await uploadAndVerify(params.storage, body, control.completionManifestKey, 'application/json');
  const featureReceipts = await validateReceiptArtifacts(params.storage, completion.feature_receipts, params.corpusVersion, nodeShardCount);
  const edgeReceipts = await validateReceiptArtifacts(params.storage, completion.edge_receipts, params.corpusVersion, nodeShardCount);
  return { status: 'complete' as const, completion, featureReceipts, edgeReceipts };
};

export const readVerifiedCaseGraphNodeRoutes = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
  nodeShardCount: number;
}) => {
  const [features, edges] = await Promise.all([
    readVerifiedCaseGraphFeatureArchive(params.storage, params.corpusVersion),
    readVerifiedCaseGraphFinalEdges(params),
  ]);
  const identity = {
    corpus_version: params.corpusVersion,
    feature_archive_set_sha256: features.completion.archive_set_sha256,
    final_edge_manifest_set_sha256: edges.completion.shard_manifest_set_sha256,
    node_shard_count: params.nodeShardCount,
    feature_part_count: features.completion.part_count,
    edge_shard_count: params.edgeShardCount,
    node_count: features.completion.exported_row_count,
    incident_count: edges.completion.unique_edge_count * 2,
  };
  const control = getCaseGraphNodeRouteControlKeys(params.corpusVersion);
  const body = await params.storage.readObject(control.completionManifestKey);
  if (!body) throw new Error('case_graph_node_route_completion_missing');
  const completion = validateCompletion(body, identity);
  const featureReceipts = await validateReceiptArtifacts(params.storage, completion.feature_receipts, params.corpusVersion, params.nodeShardCount);
  const edgeReceipts = await validateReceiptArtifacts(params.storage, completion.edge_receipts, params.corpusVersion, params.nodeShardCount);
  return { features, edges, completion, featureReceipts, edgeReceipts };
};
