import { createHash } from 'node:crypto';

import {
  getCaseGraphPreliminaryReducerControlKeys,
} from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import {
  CASE_GRAPH_CANDIDATE_VERSION,
} from './candidateGeneration';
import {
  reduceCaseGraphPostingFragments,
  type CaseGraphPostingReduceResult,
} from './candidateRouting';
import {
  readVerifiedCaseGraphPostingMap,
} from './postingArchive';
import {
  decodeCaseGraphPostingFragmentArchive,
} from './postingArchiveCodec';
import {
  buildCaseGraphPreliminaryReducerArchive,
  type CaseGraphPreliminaryReducerManifest,
} from './reducerArchiveCodec';
import { CASE_GRAPH_POLICY_VERSION } from './relationshipPolicy';

export const CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION = 1 as const;

type ReducerReceipt = {
  reducer_shard: number;
  manifest_key: string;
  manifest_sha256: string;
  candidate_count: number;
  relationship_count: number;
  rejected_candidate_count: number;
};

type ReducerCheckpoint = {
  record_type: 'case_graph_preliminary_reducer_checkpoint';
  schema_version: typeof CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION;
  corpus_version: string;
  posting_receipt_set_sha256: string;
  reducer_shard_count: number;
  minimum_term_rarity: number;
  next_reducer_shard: number;
  candidate_count: number;
  relationship_count: number;
  rejected_candidate_count: number;
  reducers: ReducerReceipt[];
  updated_at: string;
};

export type CaseGraphPreliminaryReducerCompletion = {
  record_type: 'case_graph_preliminary_reducer_completion';
  schema_version: typeof CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION;
  corpus_version: string;
  posting_receipt_set_sha256: string;
  candidate_version: typeof CASE_GRAPH_CANDIDATE_VERSION;
  relationship_policy_version: typeof CASE_GRAPH_POLICY_VERSION;
  reducer_shard_count: number;
  minimum_term_rarity: number;
  candidate_count: number;
  preliminary_relationship_count: number;
  rejected_candidate_count: number;
  reducers: ReducerReceipt[];
  reducer_manifest_set_sha256: string;
  completed_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const setSha = (receipts: readonly ReducerReceipt[]) => createHash('sha256')
  .update(receipts.map((receipt) => `${receipt.reducer_shard}:${receipt.manifest_sha256}`).join('\n'))
  .digest('hex');

const parseObject = (body: Buffer, label: string) => {
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
};

const validateReceipt = (value: unknown, corpusVersion: string, reducerShard: number): ReducerReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_reducer_receipt_invalid');
  const receipt = value as Partial<ReducerReceipt>;
  if (
    receipt.reducer_shard !== reducerShard
    || typeof receipt.manifest_key !== 'string'
    || !receipt.manifest_key.includes(`/corpora/${corpusVersion}/`)
    || !/^[a-f0-9]{64}$/.test(String(receipt.manifest_sha256 || ''))
    || !Number.isSafeInteger(receipt.candidate_count)
    || Number(receipt.candidate_count) < 0
    || !Number.isSafeInteger(receipt.relationship_count)
    || Number(receipt.relationship_count) < 0
    || !Number.isSafeInteger(receipt.rejected_candidate_count)
    || Number(receipt.rejected_candidate_count) < 0
    || Number(receipt.candidate_count) !== Number(receipt.relationship_count) + Number(receipt.rejected_candidate_count)
  ) throw new Error('case_graph_reducer_receipt_invalid');
  return receipt as ReducerReceipt;
};

const validateReducerArtifacts = async (
  storage: CaseGraphArchiveStorage,
  receipts: readonly ReducerReceipt[],
  corpusVersion: string,
  shardCount: number,
) => {
  const manifests: CaseGraphPreliminaryReducerManifest[] = [];
  for (const receipt of receipts) {
    const body = await storage.readObject(receipt.manifest_key);
    if (!body || sha256(body) !== receipt.manifest_sha256) throw new Error('case_graph_reducer_manifest_mismatch');
    const manifest = parseObject(body, 'case_graph_reducer_manifest') as unknown as CaseGraphPreliminaryReducerManifest;
    if (
      manifest.record_type !== 'case_graph_preliminary_reducer_manifest'
      || manifest.corpus_version !== corpusVersion
      || manifest.reducer_shard !== receipt.reducer_shard
      || manifest.reducer_shard_count !== shardCount
      || manifest.candidate_count !== receipt.candidate_count
      || manifest.relationship_count !== receipt.relationship_count
      || manifest.rejected_candidate_count !== receipt.rejected_candidate_count
    ) throw new Error('case_graph_reducer_manifest_invalid');
    manifests.push(manifest);
  }
  return manifests;
};

export const readVerifiedCaseGraphPreliminaryReducers = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
}) => {
  const postingMap = await readVerifiedCaseGraphPostingMap({
    corpusVersion: params.corpusVersion,
    storage: params.storage,
    reducerShardCount: params.reducerShardCount,
    minimumTermRarity: params.minimumTermRarity,
  });
  const identity = {
    corpus_version: params.corpusVersion,
    posting_receipt_set_sha256: postingMap.completion.receipt_set_sha256,
    reducer_shard_count: params.reducerShardCount,
    minimum_term_rarity: params.minimumTermRarity,
  };
  const control = getCaseGraphPreliminaryReducerControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(control.completionManifestKey);
  if (!completionBody) throw new Error('case_graph_reducer_completion_missing');
  const completion = parseCompletion(completionBody, identity);
  const manifests = await validateReducerArtifacts(
    params.storage,
    completion.reducers,
    params.corpusVersion,
    params.reducerShardCount,
  );
  return { postingMap, completion, manifests };
};

const parseCheckpoint = (
  body: Buffer,
  identity: Pick<ReducerCheckpoint, 'corpus_version' | 'posting_receipt_set_sha256' | 'reducer_shard_count' | 'minimum_term_rarity'>,
) => {
  const raw = parseObject(body, 'case_graph_reducer_checkpoint');
  if (
    raw.record_type !== 'case_graph_preliminary_reducer_checkpoint'
    || raw.schema_version !== CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.posting_receipt_set_sha256 !== identity.posting_receipt_set_sha256
    || raw.reducer_shard_count !== identity.reducer_shard_count
    || raw.minimum_term_rarity !== identity.minimum_term_rarity
    || !Array.isArray(raw.reducers)
  ) throw new Error('case_graph_reducer_checkpoint_identity_mismatch');
  const reducers = raw.reducers.map((receipt, index) => validateReceipt(receipt, identity.corpus_version, index));
  const checkpoint = { ...raw, reducers } as unknown as ReducerCheckpoint;
  if (
    checkpoint.next_reducer_shard !== reducers.length
    || checkpoint.candidate_count !== reducers.reduce((sum, receipt) => sum + receipt.candidate_count, 0)
    || checkpoint.relationship_count !== reducers.reduce((sum, receipt) => sum + receipt.relationship_count, 0)
    || checkpoint.rejected_candidate_count !== reducers.reduce((sum, receipt) => sum + receipt.rejected_candidate_count, 0)
  ) throw new Error('case_graph_reducer_checkpoint_counters_invalid');
  return checkpoint;
};

const parseCompletion = (
  body: Buffer,
  identity: Pick<ReducerCheckpoint, 'corpus_version' | 'posting_receipt_set_sha256' | 'reducer_shard_count' | 'minimum_term_rarity'>,
) => {
  const raw = parseObject(body, 'case_graph_reducer_completion');
  if (
    raw.record_type !== 'case_graph_preliminary_reducer_completion'
    || raw.schema_version !== CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION
    || raw.candidate_version !== CASE_GRAPH_CANDIDATE_VERSION
    || raw.relationship_policy_version !== CASE_GRAPH_POLICY_VERSION
    || raw.corpus_version !== identity.corpus_version
    || raw.posting_receipt_set_sha256 !== identity.posting_receipt_set_sha256
    || raw.reducer_shard_count !== identity.reducer_shard_count
    || raw.minimum_term_rarity !== identity.minimum_term_rarity
    || !Array.isArray(raw.reducers)
  ) throw new Error('case_graph_reducer_completion_identity_mismatch');
  const reducers = raw.reducers.map((receipt, index) => validateReceipt(receipt, identity.corpus_version, index));
  const completion = { ...raw, reducers } as unknown as CaseGraphPreliminaryReducerCompletion;
  if (
    reducers.length !== identity.reducer_shard_count
    || completion.candidate_count !== reducers.reduce((sum, receipt) => sum + receipt.candidate_count, 0)
    || completion.preliminary_relationship_count !== reducers.reduce((sum, receipt) => sum + receipt.relationship_count, 0)
    || completion.rejected_candidate_count !== reducers.reduce((sum, receipt) => sum + receipt.rejected_candidate_count, 0)
    || completion.reducer_manifest_set_sha256 !== setSha(reducers)
  ) throw new Error('case_graph_reducer_completion_counters_invalid');
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
  if (!stored || !stored.equals(body)) throw new Error('case_graph_reducer_read_after_write_failed');
};

export const reduceCaseGraphPostingArchive = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount?: number;
  minimumTermRarity?: number;
  maxReducerShardsPerRun?: number;
  maxTermPostings?: number;
  maxSpatialPostings?: number;
  maxSourceRecordPostings?: number;
  maxCandidatesPerShard?: number;
  now?: () => Date;
}) => {
  const reducerShardCount = Math.trunc(params.reducerShardCount ?? 64);
  const minimumTermRarity = Number(params.minimumTermRarity ?? 0.55);
  const maxReducerShardsPerRun = Math.trunc(params.maxReducerShardsPerRun ?? 2);
  if (!Number.isSafeInteger(maxReducerShardsPerRun) || maxReducerShardsPerRun < 1 || maxReducerShardsPerRun > 100) {
    throw new Error('case_graph_reducer_max_shards_invalid');
  }
  const postingMap = await readVerifiedCaseGraphPostingMap({
    corpusVersion: params.corpusVersion,
    storage: params.storage,
    reducerShardCount,
    minimumTermRarity,
  });
  const identity = {
    corpus_version: params.corpusVersion,
    posting_receipt_set_sha256: postingMap.completion.receipt_set_sha256,
    reducer_shard_count: reducerShardCount,
    minimum_term_rarity: minimumTermRarity,
  };
  const control = getCaseGraphPreliminaryReducerControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(control.completionManifestKey);
  if (completionBody) {
    const completion = parseCompletion(completionBody, identity);
    await validateReducerArtifacts(params.storage, completion.reducers, params.corpusVersion, reducerShardCount);
    return { status: 'already_complete' as const, completion };
  }
  const checkpointBody = await params.storage.readObject(control.checkpointKey);
  let checkpoint: ReducerCheckpoint = checkpointBody ? parseCheckpoint(checkpointBody, identity) : {
    record_type: 'case_graph_preliminary_reducer_checkpoint',
    schema_version: CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION,
    ...identity,
    next_reducer_shard: 0,
    candidate_count: 0,
    relationship_count: 0,
    rejected_candidate_count: 0,
    reducers: [],
    updated_at: (params.now || (() => new Date()))().toISOString(),
  };
  if (checkpointBody) await validateReducerArtifacts(
    params.storage,
    checkpoint.reducers,
    params.corpusVersion,
    reducerShardCount,
  );
  const now = params.now || (() => new Date());
  let processed = 0;
  while (checkpoint.next_reducer_shard < reducerShardCount && processed < maxReducerShardsPerRun) {
    const shard = checkpoint.next_reducer_shard;
    const manifests = postingMap.receipts.flatMap((receipt) => receipt.fragments)
      .filter((manifest) => manifest.reducer_shard === shard)
      .sort((left, right) => left.input_part_number - right.input_part_number);
    const fragments = [];
    for (const manifest of manifests) {
      const archiveBody = await params.storage.readObject(manifest.archive_key);
      if (!archiveBody) throw new Error('case_graph_posting_fragment_archive_missing');
      fragments.push(decodeCaseGraphPostingFragmentArchive(archiveBody, manifest));
    }
    const emptyResult: CaseGraphPostingReduceResult = {
      version: CASE_GRAPH_CANDIDATE_VERSION,
      corpusVersion: params.corpusVersion,
      reducerShard: shard,
      reducerShardCount,
      candidates: [],
      relationships: [],
      manifest: {
        fragmentCount: 0,
        postingCount: 0,
        postingGroupCount: 0,
        candidateCount: 0,
        relationshipCount: 0,
        rejectedCandidateCount: 0,
        skippedGroups: [],
      },
    };
    const result = fragments.length ? reduceCaseGraphPostingFragments({
      fragments,
      rarity: postingMap.featureArchive.rarity,
      maxTermPostings: params.maxTermPostings,
      maxSpatialPostings: params.maxSpatialPostings,
      maxSourceRecordPostings: params.maxSourceRecordPostings,
      maxCandidates: params.maxCandidatesPerShard,
    }) : emptyResult;
    const built = buildCaseGraphPreliminaryReducerArchive(result);
    await uploadAndVerify(params.storage, built.candidatesBody, built.manifest.candidates_key, 'application/x-ndjson', 'gzip');
    await uploadAndVerify(params.storage, built.relationshipsBody, built.manifest.relationships_key, 'application/x-ndjson', 'gzip');
    await uploadAndVerify(params.storage, built.manifestBody, built.manifest.manifest_key, 'application/json');
    const receipt: ReducerReceipt = {
      reducer_shard: shard,
      manifest_key: built.manifest.manifest_key,
      manifest_sha256: sha256(built.manifestBody),
      candidate_count: built.manifest.candidate_count,
      relationship_count: built.manifest.relationship_count,
      rejected_candidate_count: built.manifest.rejected_candidate_count,
    };
    checkpoint = {
      ...checkpoint,
      next_reducer_shard: shard + 1,
      candidate_count: checkpoint.candidate_count + receipt.candidate_count,
      relationship_count: checkpoint.relationship_count + receipt.relationship_count,
      rejected_candidate_count: checkpoint.rejected_candidate_count + receipt.rejected_candidate_count,
      reducers: [...checkpoint.reducers, receipt],
      updated_at: now().toISOString(),
    };
    const body = jsonBody(checkpoint);
    await params.storage.uploadFile(body, control.checkpointKey, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length,
    });
    const stored = await params.storage.readObject(control.checkpointKey);
    if (!stored || !stored.equals(body)) throw new Error('case_graph_reducer_checkpoint_read_after_write_failed');
    processed += 1;
  }
  if (checkpoint.next_reducer_shard < reducerShardCount) return {
    status: 'partial' as const,
    checkpoint,
    remaining_reducer_shards: reducerShardCount - checkpoint.next_reducer_shard,
  };
  const completion: CaseGraphPreliminaryReducerCompletion = {
    record_type: 'case_graph_preliminary_reducer_completion',
    schema_version: CASE_GRAPH_REDUCER_RUN_SCHEMA_VERSION,
    ...identity,
    candidate_version: CASE_GRAPH_CANDIDATE_VERSION,
    relationship_policy_version: CASE_GRAPH_POLICY_VERSION,
    candidate_count: checkpoint.candidate_count,
    preliminary_relationship_count: checkpoint.relationship_count,
    rejected_candidate_count: checkpoint.rejected_candidate_count,
    reducers: checkpoint.reducers,
    reducer_manifest_set_sha256: setSha(checkpoint.reducers),
    completed_at: now().toISOString(),
  };
  const body = jsonBody(completion);
  await uploadAndVerify(params.storage, body, control.completionManifestKey, 'application/json');
  return { status: 'complete' as const, completion };
};
