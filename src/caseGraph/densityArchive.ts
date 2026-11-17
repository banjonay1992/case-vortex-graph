import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getCaseGraphDensityKeys } from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import {
  accumulateCaseGraphDensity,
  CASE_GRAPH_DENSITY_VERSION,
  createCaseGraphDensityState,
  finalizeCaseGraphDensity,
  type CaseGraphDensityArtifact,
  type CaseGraphDensityState,
} from './densityModel';
import {
  decodeCaseGraphPublicNodeShard,
  readVerifiedCaseGraphNodeIndex,
} from './nodeIndexArchive';

export const CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION = 1 as const;
const MAX_DENSITY_BYTES = 256 * 1024 * 1024;

type DensityCheckpoint = {
  record_type: 'case_graph_density_checkpoint';
  schema_version: typeof CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  node_manifest_set_sha256: string;
  next_node_shard: number;
  state: CaseGraphDensityState;
  updated_at: string;
};

export type CaseGraphDensityManifest = {
  record_type: 'case_graph_density_manifest';
  schema_version: typeof CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION;
  density_version: typeof CASE_GRAPH_DENSITY_VERSION;
  corpus_version: string;
  node_manifest_set_sha256: string;
  node_count: number;
  macro_cell_count: number;
  regional_cell_count: number;
  unknown_geo_node_count: number;
  unknown_time_node_count: number;
  archive_key: string;
  compressed_bytes: number;
  compressed_sha256: string;
  manifest_key: string;
  completed_at: string;
};

export type CaseGraphDensityCompletion = {
  record_type: 'case_graph_density_completion';
  schema_version: typeof CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  node_manifest_set_sha256: string;
  density_manifest_key: string;
  density_manifest_sha256: string;
  node_count: number;
  completed_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

const parseObject = (body: Buffer, label: string) => {
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
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
  if (!stored || !stored.equals(body)) throw new Error('case_graph_density_read_after_write_failed');
};

const validateCheckpoint = (body: Buffer, corpusVersion: string, manifestSetSha: string) => {
  const raw = parseObject(body, 'case_graph_density_checkpoint') as unknown as DensityCheckpoint;
  if (
    raw.record_type !== 'case_graph_density_checkpoint'
    || raw.schema_version !== CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION
    || raw.corpus_version !== corpusVersion
    || raw.node_manifest_set_sha256 !== manifestSetSha
    || !Number.isSafeInteger(raw.next_node_shard)
    || raw.next_node_shard < 0
    || raw.state?.version !== CASE_GRAPH_DENSITY_VERSION
    || raw.state?.corpusVersion !== corpusVersion
  ) throw new Error('case_graph_density_checkpoint_invalid');
  return raw;
};

const validateManifest = (
  body: Buffer,
  corpusVersion: string,
  manifestSetSha: string,
  nodeCount: number,
) => {
  const manifest = parseObject(body, 'case_graph_density_manifest') as unknown as CaseGraphDensityManifest;
  const keys = getCaseGraphDensityKeys(corpusVersion);
  if (
    manifest.record_type !== 'case_graph_density_manifest'
    || manifest.schema_version !== CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION
    || manifest.density_version !== CASE_GRAPH_DENSITY_VERSION
    || manifest.corpus_version !== corpusVersion
    || manifest.node_manifest_set_sha256 !== manifestSetSha
    || manifest.node_count !== nodeCount
    || manifest.archive_key !== keys.archiveKey
    || manifest.manifest_key !== keys.manifestKey
    || !/^[a-f0-9]{64}$/.test(manifest.compressed_sha256)
  ) throw new Error('case_graph_density_manifest_invalid');
  return manifest;
};

export const decodeCaseGraphDensityArtifact = (body: Buffer, manifest: CaseGraphDensityManifest) => {
  if (body.length !== manifest.compressed_bytes || sha256(body) !== manifest.compressed_sha256) {
    throw new Error('case_graph_density_archive_checksum_mismatch');
  }
  const raw = gunzipSync(body, { maxOutputLength: MAX_DENSITY_BYTES }).toString('utf8');
  const artifact = JSON.parse(raw) as CaseGraphDensityArtifact;
  if (
    artifact.version !== CASE_GRAPH_DENSITY_VERSION
    || artifact.corpusVersion !== manifest.corpus_version
    || artifact.nodeCount !== manifest.node_count
    || artifact.levels.macro.length !== manifest.macro_cell_count
    || artifact.levels.regional.length !== manifest.regional_cell_count
  ) throw new Error('case_graph_density_archive_manifest_mismatch');
  return artifact;
};

export const buildCaseGraphDensityArchive = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
  nodeShardCount: number;
  maxNodeShardsPerRun?: number;
  now?: () => Date;
}) => {
  const maxNodeShardsPerRun = Math.trunc(params.maxNodeShardsPerRun ?? 4);
  if (!Number.isSafeInteger(maxNodeShardsPerRun) || maxNodeShardsPerRun < 1 || maxNodeShardsPerRun > 100) {
    throw new Error('case_graph_density_max_shards_invalid');
  }
  const nodeIndex = await readVerifiedCaseGraphNodeIndex(params);
  const manifestSetSha = nodeIndex.completion.shard_manifest_set_sha256;
  const keys = getCaseGraphDensityKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(keys.completionManifestKey);
  if (completionBody) {
    const completion = parseObject(completionBody, 'case_graph_density_completion') as unknown as CaseGraphDensityCompletion;
    if (
      completion.record_type !== 'case_graph_density_completion'
      || completion.schema_version !== CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION
      || completion.corpus_version !== params.corpusVersion
      || completion.node_manifest_set_sha256 !== manifestSetSha
      || completion.node_count !== nodeIndex.completion.node_count
      || completion.density_manifest_key !== keys.manifestKey
      || !/^[a-f0-9]{64}$/.test(completion.density_manifest_sha256)
    ) throw new Error('case_graph_density_completion_invalid');
    const manifestBody = await params.storage.readObject(keys.manifestKey);
    if (!manifestBody || sha256(manifestBody) !== completion.density_manifest_sha256) {
      throw new Error('case_graph_density_manifest_mismatch');
    }
    const manifest = validateManifest(
      manifestBody,
      params.corpusVersion,
      manifestSetSha,
      nodeIndex.completion.node_count,
    );
    return { status: 'already_complete' as const, completion, manifest };
  }
  const checkpointBody = await params.storage.readObject(keys.checkpointKey);
  const now = params.now || (() => new Date());
  let checkpoint: DensityCheckpoint = checkpointBody
    ? validateCheckpoint(checkpointBody, params.corpusVersion, manifestSetSha)
    : {
      record_type: 'case_graph_density_checkpoint',
      schema_version: CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION,
      corpus_version: params.corpusVersion,
      node_manifest_set_sha256: manifestSetSha,
      next_node_shard: 0,
      state: createCaseGraphDensityState(params.corpusVersion),
      updated_at: now().toISOString(),
    };
  let processed = 0;
  while (checkpoint.next_node_shard < params.nodeShardCount && processed < maxNodeShardsPerRun) {
    const manifest = nodeIndex.manifests[checkpoint.next_node_shard];
    if (!manifest || manifest.node_shard !== checkpoint.next_node_shard) {
      throw new Error('case_graph_density_node_manifest_missing');
    }
    const body = await params.storage.readObject(manifest.nodes_key);
    if (!body) throw new Error('case_graph_density_node_archive_missing');
    const nodes = decodeCaseGraphPublicNodeShard(body, manifest);
    accumulateCaseGraphDensity(checkpoint.state, nodes);
    checkpoint = {
      ...checkpoint,
      next_node_shard: checkpoint.next_node_shard + 1,
      updated_at: now().toISOString(),
    };
    const nextBody = jsonBody(checkpoint);
    await params.storage.uploadFile(nextBody, keys.checkpointKey, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: nextBody.length,
    });
    const stored = await params.storage.readObject(keys.checkpointKey);
    if (!stored || !stored.equals(nextBody)) throw new Error('case_graph_density_checkpoint_read_after_write_failed');
    processed += 1;
  }
  if (checkpoint.next_node_shard < params.nodeShardCount) return {
    status: 'partial' as const,
    checkpoint: { ...checkpoint, state: { ...checkpoint.state, macro: {}, regional: {} } },
    remaining_node_shards: params.nodeShardCount - checkpoint.next_node_shard,
  };
  const artifact = finalizeCaseGraphDensity(checkpoint.state);
  if (artifact.nodeCount !== nodeIndex.completion.node_count) throw new Error('case_graph_density_node_total_mismatch');
  const raw = jsonBody(artifact);
  if (raw.length > MAX_DENSITY_BYTES) throw new Error('case_graph_density_output_limit_exceeded');
  const archiveBody = gzipSync(raw, { level: 6 });
  const manifest: CaseGraphDensityManifest = {
    record_type: 'case_graph_density_manifest',
    schema_version: CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION,
    density_version: CASE_GRAPH_DENSITY_VERSION,
    corpus_version: params.corpusVersion,
    node_manifest_set_sha256: manifestSetSha,
    node_count: artifact.nodeCount,
    macro_cell_count: artifact.levels.macro.length,
    regional_cell_count: artifact.levels.regional.length,
    unknown_geo_node_count: artifact.accounting.unknownGeoNodeCount,
    unknown_time_node_count: artifact.accounting.unknownTimeNodeCount,
    archive_key: keys.archiveKey,
    compressed_bytes: archiveBody.length,
    compressed_sha256: sha256(archiveBody),
    manifest_key: keys.manifestKey,
    completed_at: now().toISOString(),
  };
  await uploadAndVerify(params.storage, archiveBody, keys.archiveKey, 'application/json', 'gzip');
  const manifestBody = jsonBody(manifest);
  await uploadAndVerify(params.storage, manifestBody, keys.manifestKey, 'application/json');
  const completion: CaseGraphDensityCompletion = {
    record_type: 'case_graph_density_completion',
    schema_version: CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION,
    corpus_version: params.corpusVersion,
    node_manifest_set_sha256: manifestSetSha,
    density_manifest_key: keys.manifestKey,
    density_manifest_sha256: sha256(manifestBody),
    node_count: artifact.nodeCount,
    completed_at: now().toISOString(),
  };
  const finalBody = jsonBody(completion);
  await uploadAndVerify(params.storage, finalBody, keys.completionManifestKey, 'application/json');
  return { status: 'complete' as const, completion, manifest, artifact };
};

export const readVerifiedCaseGraphDensity = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
  edgeShardCount: number;
  nodeShardCount: number;
}) => {
  const nodeIndex = await readVerifiedCaseGraphNodeIndex(params);
  const keys = getCaseGraphDensityKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(keys.completionManifestKey);
  if (!completionBody) throw new Error('case_graph_density_completion_missing');
  const completion = parseObject(completionBody, 'case_graph_density_completion') as unknown as CaseGraphDensityCompletion;
  if (
    completion.record_type !== 'case_graph_density_completion'
    || completion.schema_version !== CASE_GRAPH_DENSITY_ARCHIVE_SCHEMA_VERSION
    || completion.corpus_version !== params.corpusVersion
    || completion.node_manifest_set_sha256 !== nodeIndex.completion.shard_manifest_set_sha256
    || completion.node_count !== nodeIndex.completion.node_count
    || completion.density_manifest_key !== keys.manifestKey
    || !/^[a-f0-9]{64}$/.test(completion.density_manifest_sha256)
  ) throw new Error('case_graph_density_completion_invalid');
  const manifestBody = await params.storage.readObject(keys.manifestKey);
  if (!manifestBody || sha256(manifestBody) !== completion.density_manifest_sha256) {
    throw new Error('case_graph_density_manifest_mismatch');
  }
  const manifest = validateManifest(
    manifestBody,
    params.corpusVersion,
    nodeIndex.completion.shard_manifest_set_sha256,
    nodeIndex.completion.node_count,
  );
  const archiveBody = await params.storage.readObject(manifest.archive_key);
  if (!archiveBody) throw new Error('case_graph_density_archive_missing');
  const artifact = decodeCaseGraphDensityArtifact(archiveBody, manifest);
  return { nodeIndex, completion, manifest, artifact };
};
