import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  getCaseGraphFinalEdgeControlKeys,
  getCaseGraphFinalEdgeShardKeys,
} from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import { deduplicateCaseGraphRelationships } from './candidateRouting';
import {
  decodeCaseGraphEdgeRouteFragment,
  readVerifiedCaseGraphEdgeRoutes,
} from './edgeRouteArchive';
import {
  CASE_GRAPH_POLICY_VERSION,
  type CaseGraphIndependence,
  type CaseGraphRelationship,
  type CaseGraphRelationshipType,
} from './relationshipPolicy';

export const CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION = 1 as const;
const MAX_EDGE_SHARD_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

type CountMap<T extends string> = Record<T, number>;

export type CaseGraphFinalEdgeShardManifest = {
  record_type: 'case_graph_final_edge_shard_manifest';
  schema_version: typeof CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION;
  corpus_version: string;
  relationship_policy_version: typeof CASE_GRAPH_POLICY_VERSION;
  edge_shard: number;
  edge_shard_count: number;
  input_fragment_count: number;
  preliminary_edge_count: number;
  unique_edge_count: number;
  duplicate_edge_count: number;
  first_edge_id: string | null;
  last_edge_id: string | null;
  relationship_type_counts: CountMap<CaseGraphRelationshipType>;
  independence_counts: CountMap<CaseGraphIndependence>;
  degree_case_count: number;
  degree_contribution_total: number;
  edges_key: string;
  edges_compressed_bytes: number;
  edges_sha256: string;
  degree_contributions_key: string;
  degree_contributions_compressed_bytes: number;
  degree_contributions_sha256: string;
  manifest_key: string;
};

type EdgeShardReceipt = {
  edge_shard: number;
  manifest_key: string;
  manifest_sha256: string;
  preliminary_edge_count: number;
  unique_edge_count: number;
  duplicate_edge_count: number;
  degree_case_count: number;
  degree_contribution_total: number;
};

type FinalEdgeCheckpoint = {
  record_type: 'case_graph_final_edge_checkpoint';
  schema_version: typeof CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION;
  corpus_version: string;
  edge_route_receipt_set_sha256: string;
  edge_shard_count: number;
  next_edge_shard: number;
  preliminary_edge_count: number;
  unique_edge_count: number;
  duplicate_edge_count: number;
  degree_contribution_total: number;
  shards: EdgeShardReceipt[];
  updated_at: string;
};

export type CaseGraphFinalEdgeCompletion = {
  record_type: 'case_graph_final_edge_completion';
  schema_version: typeof CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION;
  corpus_version: string;
  edge_route_receipt_set_sha256: string;
  relationship_policy_version: typeof CASE_GRAPH_POLICY_VERSION;
  edge_shard_count: number;
  preliminary_edge_count: number;
  unique_edge_count: number;
  duplicate_edge_count: number;
  degree_contribution_total: number;
  shards: EdgeShardReceipt[];
  shard_manifest_set_sha256: string;
  completed_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const shardSetSha = (receipts: readonly EdgeShardReceipt[]) => createHash('sha256')
  .update(receipts.map((receipt) => `${receipt.edge_shard}:${receipt.manifest_sha256}`).join('\n'))
  .digest('hex');

const emptyTypeCounts = (): CountMap<CaseGraphRelationshipType> => ({
  provenance: 0,
  same_incident_candidate: 0,
  shared_pattern: 0,
  shared_entity: 0,
});
const emptyIndependenceCounts = (): CountMap<CaseGraphIndependence> => ({
  independent: 0,
  dependent: 0,
  unknown: 0,
});

const gzipNdjson = (rows: readonly unknown[]) => {
  const raw = Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
  if (raw.length > MAX_EDGE_SHARD_UNCOMPRESSED_BYTES) {
    throw new Error('case_graph_final_edge_shard_size_limit_exceeded');
  }
  return gzipSync(raw, { level: 6 });
};

export const buildCaseGraphFinalEdgeShard = (params: {
  corpusVersion: string;
  edgeShard: number;
  edgeShardCount: number;
  inputFragmentCount: number;
  relationships: CaseGraphRelationship[];
  maxUniqueEdges?: number;
}) => {
  const maxUniqueEdges = Math.trunc(params.maxUniqueEdges ?? 2_000_000);
  if (!Number.isSafeInteger(maxUniqueEdges) || maxUniqueEdges < 1 || maxUniqueEdges > 10_000_000) {
    throw new Error('case_graph_final_edge_limit_invalid');
  }
  const unique = deduplicateCaseGraphRelationships(params.relationships);
  if (unique.length > maxUniqueEdges) throw new Error(`case_graph_final_edge_limit_exceeded:${maxUniqueEdges}`);
  const degree = new Map<string, number>();
  const relationshipTypeCounts = emptyTypeCounts();
  const independenceCounts = emptyIndependenceCounts();
  for (const relationship of unique) {
    relationshipTypeCounts[relationship.type] += 1;
    independenceCounts[relationship.independence] += 1;
    degree.set(relationship.leftCaseId, (degree.get(relationship.leftCaseId) || 0) + 1);
    degree.set(relationship.rightCaseId, (degree.get(relationship.rightCaseId) || 0) + 1);
  }
  const degreeRows = [...degree.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([case_id, degree_contribution]) => ({ case_id, degree_contribution }));
  const edgesBody = gzipNdjson(unique);
  const degreeBody = gzipNdjson(degreeRows);
  const keys = getCaseGraphFinalEdgeShardKeys(params.corpusVersion, params.edgeShard);
  const manifest: CaseGraphFinalEdgeShardManifest = {
    record_type: 'case_graph_final_edge_shard_manifest',
    schema_version: CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    relationship_policy_version: CASE_GRAPH_POLICY_VERSION,
    edge_shard: params.edgeShard,
    edge_shard_count: params.edgeShardCount,
    input_fragment_count: params.inputFragmentCount,
    preliminary_edge_count: params.relationships.length,
    unique_edge_count: unique.length,
    duplicate_edge_count: params.relationships.length - unique.length,
    first_edge_id: unique[0]?.edgeId || null,
    last_edge_id: unique.at(-1)?.edgeId || null,
    relationship_type_counts: relationshipTypeCounts,
    independence_counts: independenceCounts,
    degree_case_count: degreeRows.length,
    degree_contribution_total: degreeRows.reduce((sum, row) => sum + row.degree_contribution, 0),
    edges_key: keys.edgesKey,
    edges_compressed_bytes: edgesBody.length,
    edges_sha256: sha256(edgesBody),
    degree_contributions_key: keys.degreeContributionsKey,
    degree_contributions_compressed_bytes: degreeBody.length,
    degree_contributions_sha256: sha256(degreeBody),
    manifest_key: keys.manifestKey,
  };
  if (manifest.degree_contribution_total !== unique.length * 2) {
    throw new Error('case_graph_final_edge_degree_total_invalid');
  }
  return { edgesBody, degreeBody, manifest, manifestBody: jsonBody(manifest), relationships: unique, degreeRows };
};

export const decodeCaseGraphFinalEdgeShard = (
  body: Buffer,
  manifest: CaseGraphFinalEdgeShardManifest,
) => {
  if (body.length !== manifest.edges_compressed_bytes || sha256(body) !== manifest.edges_sha256) {
    throw new Error('case_graph_final_edge_archive_checksum_mismatch');
  }
  const raw = gunzipSync(body, { maxOutputLength: MAX_EDGE_SHARD_UNCOMPRESSED_BYTES }).toString('utf8');
  const relationships = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as CaseGraphRelationship);
  for (let index = 0; index < relationships.length; index += 1) {
    const relationship = relationships[index];
    if (
      relationship.policyVersion !== CASE_GRAPH_POLICY_VERSION
      || !relationship.edgeId
      || (index > 0 && relationships[index - 1].edgeId >= relationship.edgeId)
    ) throw new Error('case_graph_final_edge_archive_record_invalid');
  }
  if (
    relationships.length !== manifest.unique_edge_count
    || (relationships[0]?.edgeId || null) !== manifest.first_edge_id
    || (relationships.at(-1)?.edgeId || null) !== manifest.last_edge_id
  ) throw new Error('case_graph_final_edge_archive_manifest_mismatch');
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

const validateReceipt = (value: unknown, corpusVersion: string, edgeShard: number): EdgeShardReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_final_edge_receipt_invalid');
  const receipt = value as Partial<EdgeShardReceipt>;
  const expectedKey = getCaseGraphFinalEdgeShardKeys(corpusVersion, edgeShard).manifestKey;
  if (
    receipt.edge_shard !== edgeShard
    || receipt.manifest_key !== expectedKey
    || !/^[a-f0-9]{64}$/.test(String(receipt.manifest_sha256 || ''))
    || !Number.isSafeInteger(receipt.preliminary_edge_count)
    || Number(receipt.preliminary_edge_count) < 0
    || !Number.isSafeInteger(receipt.unique_edge_count)
    || Number(receipt.unique_edge_count) < 0
    || !Number.isSafeInteger(receipt.duplicate_edge_count)
    || Number(receipt.duplicate_edge_count) < 0
    || Number(receipt.preliminary_edge_count) !== Number(receipt.unique_edge_count) + Number(receipt.duplicate_edge_count)
    || !Number.isSafeInteger(receipt.degree_case_count)
    || Number(receipt.degree_case_count) < 0
    || !Number.isSafeInteger(receipt.degree_contribution_total)
    || Number(receipt.degree_contribution_total) !== Number(receipt.unique_edge_count) * 2
  ) throw new Error('case_graph_final_edge_receipt_invalid');
  return receipt as EdgeShardReceipt;
};

const validateShardArtifacts = async (
  storage: CaseGraphArchiveStorage,
  receipts: readonly EdgeShardReceipt[],
  corpusVersion: string,
  edgeShardCount: number,
) => {
  const manifests: CaseGraphFinalEdgeShardManifest[] = [];
  for (const receipt of receipts) {
    const body = await storage.readObject(receipt.manifest_key);
    if (!body || sha256(body) !== receipt.manifest_sha256) throw new Error('case_graph_final_edge_manifest_mismatch');
    const manifest = parseObject(body, 'case_graph_final_edge_manifest') as unknown as CaseGraphFinalEdgeShardManifest;
    if (
      manifest.record_type !== 'case_graph_final_edge_shard_manifest'
      || manifest.schema_version !== CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION
      || manifest.corpus_version !== corpusVersion
      || manifest.relationship_policy_version !== CASE_GRAPH_POLICY_VERSION
      || manifest.edge_shard !== receipt.edge_shard
      || manifest.edge_shard_count !== edgeShardCount
      || manifest.preliminary_edge_count !== receipt.preliminary_edge_count
      || manifest.unique_edge_count !== receipt.unique_edge_count
      || manifest.duplicate_edge_count !== receipt.duplicate_edge_count
      || manifest.degree_case_count !== receipt.degree_case_count
      || manifest.degree_contribution_total !== receipt.degree_contribution_total
    ) throw new Error('case_graph_final_edge_manifest_invalid');
    manifests.push(manifest);
  }
  return manifests;
};

const parseCheckpoint = (body: Buffer, identity: {
  corpus_version: string;
  edge_route_receipt_set_sha256: string;
  edge_shard_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_final_edge_checkpoint');
  if (
    raw.record_type !== 'case_graph_final_edge_checkpoint'
    || raw.schema_version !== CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.edge_route_receipt_set_sha256 !== identity.edge_route_receipt_set_sha256
    || raw.edge_shard_count !== identity.edge_shard_count
    || !Array.isArray(raw.shards)
  ) throw new Error('case_graph_final_edge_checkpoint_identity_mismatch');
  const shards = raw.shards.map((receipt, index) => validateReceipt(receipt, identity.corpus_version, index));
  const checkpoint = { ...raw, shards } as unknown as FinalEdgeCheckpoint;
  if (
    checkpoint.next_edge_shard !== shards.length
    || checkpoint.preliminary_edge_count !== shards.reduce((sum, receipt) => sum + receipt.preliminary_edge_count, 0)
    || checkpoint.unique_edge_count !== shards.reduce((sum, receipt) => sum + receipt.unique_edge_count, 0)
    || checkpoint.duplicate_edge_count !== shards.reduce((sum, receipt) => sum + receipt.duplicate_edge_count, 0)
    || checkpoint.degree_contribution_total !== shards.reduce((sum, receipt) => sum + receipt.degree_contribution_total, 0)
  ) throw new Error('case_graph_final_edge_checkpoint_counters_invalid');
  return checkpoint;
};

const parseCompletion = (body: Buffer, identity: {
  corpus_version: string;
  edge_route_receipt_set_sha256: string;
  edge_shard_count: number;
  preliminary_edge_count: number;
}) => {
  const raw = parseObject(body, 'case_graph_final_edge_completion');
  if (
    raw.record_type !== 'case_graph_final_edge_completion'
    || raw.schema_version !== CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION
    || raw.relationship_policy_version !== CASE_GRAPH_POLICY_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.edge_route_receipt_set_sha256 !== identity.edge_route_receipt_set_sha256
    || raw.edge_shard_count !== identity.edge_shard_count
    || raw.preliminary_edge_count !== identity.preliminary_edge_count
    || !Array.isArray(raw.shards)
  ) throw new Error('case_graph_final_edge_completion_identity_mismatch');
  const shards = raw.shards.map((receipt, index) => validateReceipt(receipt, identity.corpus_version, index));
  const completion = { ...raw, shards } as unknown as CaseGraphFinalEdgeCompletion;
  if (
    shards.length !== identity.edge_shard_count
    || completion.unique_edge_count !== shards.reduce((sum, receipt) => sum + receipt.unique_edge_count, 0)
    || completion.duplicate_edge_count !== shards.reduce((sum, receipt) => sum + receipt.duplicate_edge_count, 0)
    || completion.preliminary_edge_count !== completion.unique_edge_count + completion.duplicate_edge_count
    || completion.degree_contribution_total !== completion.unique_edge_count * 2
    || completion.shard_manifest_set_sha256 !== shardSetSha(shards)
  ) throw new Error('case_graph_final_edge_completion_counters_invalid');
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
  if (!stored || !stored.equals(body)) throw new Error('case_graph_final_edge_read_after_write_failed');
};

export const reduceCaseGraphFinalEdges = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount?: number;
  minimumTermRarity?: number;
  edgeShardCount?: number;
  maxEdgeShardsPerRun?: number;
  maxUniqueEdgesPerShard?: number;
  now?: () => Date;
}) => {
  const reducerShardCount = Math.trunc(params.reducerShardCount ?? 64);
  const minimumTermRarity = Number(params.minimumTermRarity ?? 0.55);
  const edgeShardCount = Math.trunc(params.edgeShardCount ?? 64);
  const maxEdgeShardsPerRun = Math.trunc(params.maxEdgeShardsPerRun ?? 2);
  if (!Number.isSafeInteger(maxEdgeShardsPerRun) || maxEdgeShardsPerRun < 1 || maxEdgeShardsPerRun > 100) {
    throw new Error('case_graph_final_edge_max_shards_invalid');
  }
  const routes = await readVerifiedCaseGraphEdgeRoutes({
    corpusVersion: params.corpusVersion,
    storage: params.storage,
    reducerShardCount,
    minimumTermRarity,
    edgeShardCount,
  });
  const identity = {
    corpus_version: params.corpusVersion,
    edge_route_receipt_set_sha256: routes.completion.receipt_set_sha256,
    edge_shard_count: edgeShardCount,
    preliminary_edge_count: routes.completion.preliminary_relationship_count,
  };
  const control = getCaseGraphFinalEdgeControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(control.completionManifestKey);
  if (completionBody) {
    const completion = parseCompletion(completionBody, identity);
    const manifests = await validateShardArtifacts(params.storage, completion.shards, params.corpusVersion, edgeShardCount);
    return { status: 'already_complete' as const, completion, manifests };
  }
  const checkpointBody = await params.storage.readObject(control.checkpointKey);
  const now = params.now || (() => new Date());
  let checkpoint: FinalEdgeCheckpoint = checkpointBody ? parseCheckpoint(checkpointBody, identity) : {
    record_type: 'case_graph_final_edge_checkpoint',
    schema_version: CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    edge_route_receipt_set_sha256: identity.edge_route_receipt_set_sha256,
    edge_shard_count: edgeShardCount,
    next_edge_shard: 0,
    preliminary_edge_count: 0,
    unique_edge_count: 0,
    duplicate_edge_count: 0,
    degree_contribution_total: 0,
    shards: [],
    updated_at: now().toISOString(),
  };
  if (checkpointBody) await validateShardArtifacts(params.storage, checkpoint.shards, params.corpusVersion, edgeShardCount);
  let processed = 0;
  while (checkpoint.next_edge_shard < edgeShardCount && processed < maxEdgeShardsPerRun) {
    const edgeShard = checkpoint.next_edge_shard;
    const fragmentManifests = routes.receipts.flatMap((receipt) => receipt.fragments)
      .filter((manifest) => manifest.edge_shard === edgeShard)
      .sort((left, right) => left.source_reducer_shard - right.source_reducer_shard);
    const preliminary: CaseGraphRelationship[] = [];
    for (const manifest of fragmentManifests) {
      const body = await params.storage.readObject(manifest.archive_key);
      if (!body) throw new Error('case_graph_final_edge_route_archive_missing');
      preliminary.push(...decodeCaseGraphEdgeRouteFragment(body, manifest));
    }
    const built = buildCaseGraphFinalEdgeShard({
      corpusVersion: params.corpusVersion,
      edgeShard,
      edgeShardCount,
      inputFragmentCount: fragmentManifests.length,
      relationships: preliminary,
      maxUniqueEdges: params.maxUniqueEdgesPerShard,
    });
    await uploadAndVerify(params.storage, built.edgesBody, built.manifest.edges_key, 'application/x-ndjson', 'gzip');
    await uploadAndVerify(
      params.storage,
      built.degreeBody,
      built.manifest.degree_contributions_key,
      'application/x-ndjson',
      'gzip',
    );
    await uploadAndVerify(params.storage, built.manifestBody, built.manifest.manifest_key, 'application/json');
    const receipt: EdgeShardReceipt = {
      edge_shard: edgeShard,
      manifest_key: built.manifest.manifest_key,
      manifest_sha256: sha256(built.manifestBody),
      preliminary_edge_count: built.manifest.preliminary_edge_count,
      unique_edge_count: built.manifest.unique_edge_count,
      duplicate_edge_count: built.manifest.duplicate_edge_count,
      degree_case_count: built.manifest.degree_case_count,
      degree_contribution_total: built.manifest.degree_contribution_total,
    };
    checkpoint = {
      ...checkpoint,
      next_edge_shard: edgeShard + 1,
      preliminary_edge_count: checkpoint.preliminary_edge_count + receipt.preliminary_edge_count,
      unique_edge_count: checkpoint.unique_edge_count + receipt.unique_edge_count,
      duplicate_edge_count: checkpoint.duplicate_edge_count + receipt.duplicate_edge_count,
      degree_contribution_total: checkpoint.degree_contribution_total + receipt.degree_contribution_total,
      shards: [...checkpoint.shards, receipt],
      updated_at: now().toISOString(),
    };
    const body = jsonBody(checkpoint);
    await params.storage.uploadFile(body, control.checkpointKey, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length,
    });
    const stored = await params.storage.readObject(control.checkpointKey);
    if (!stored || !stored.equals(body)) throw new Error('case_graph_final_edge_checkpoint_read_after_write_failed');
    processed += 1;
  }
  if (checkpoint.next_edge_shard < edgeShardCount) return {
    status: 'partial' as const,
    checkpoint,
    remaining_edge_shards: edgeShardCount - checkpoint.next_edge_shard,
  };
  if (checkpoint.preliminary_edge_count !== identity.preliminary_edge_count) {
    throw new Error('case_graph_final_edge_preliminary_total_mismatch');
  }
  const completion: CaseGraphFinalEdgeCompletion = {
    record_type: 'case_graph_final_edge_completion',
    schema_version: CASE_GRAPH_FINAL_EDGE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    edge_route_receipt_set_sha256: identity.edge_route_receipt_set_sha256,
    relationship_policy_version: CASE_GRAPH_POLICY_VERSION,
    edge_shard_count: edgeShardCount,
    preliminary_edge_count: checkpoint.preliminary_edge_count,
    unique_edge_count: checkpoint.unique_edge_count,
    duplicate_edge_count: checkpoint.duplicate_edge_count,
    degree_contribution_total: checkpoint.degree_contribution_total,
    shards: checkpoint.shards,
    shard_manifest_set_sha256: shardSetSha(checkpoint.shards),
    completed_at: now().toISOString(),
  };
  const body = jsonBody(completion);
  await uploadAndVerify(params.storage, body, control.completionManifestKey, 'application/json');
  const manifests = await validateShardArtifacts(params.storage, completion.shards, params.corpusVersion, edgeShardCount);
  return { status: 'complete' as const, completion, manifests };
};

export const readVerifiedCaseGraphFinalEdges = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
}) => {
  const routes = await readVerifiedCaseGraphEdgeRoutes(params);
  const identity = {
    corpus_version: params.corpusVersion,
    edge_route_receipt_set_sha256: routes.completion.receipt_set_sha256,
    edge_shard_count: params.edgeShardCount,
    preliminary_edge_count: routes.completion.preliminary_relationship_count,
  };
  const control = getCaseGraphFinalEdgeControlKeys(params.corpusVersion);
  const body = await params.storage.readObject(control.completionManifestKey);
  if (!body) throw new Error('case_graph_final_edge_completion_missing');
  const completion = parseCompletion(body, identity);
  const manifests = await validateShardArtifacts(
    params.storage,
    completion.shards,
    params.corpusVersion,
    params.edgeShardCount,
  );
  return { routes, completion, manifests };
};
