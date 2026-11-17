import { createHash } from 'node:crypto';

import {
  getCaseGraphPostingControlKeys,
  getCaseGraphPostingPartReceiptKey,
} from './archiveKeys';
import type { CaseGraphArchiveStorage } from './archiveTypes';
import { buildCaseGraphPostingFragments } from './candidateRouting';
import { decodeCaseGraphFeaturePart } from './featureArchiveCodec';
import { readVerifiedCaseGraphFeatureArchive } from './featureArchive';
import {
  buildCaseGraphPostingFragmentArchive,
  type CaseGraphPostingFragmentManifest,
} from './postingArchiveCodec';

export const CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION = 1 as const;
export const CASE_GRAPH_POSTING_UPLOAD_CONCURRENCY = 8 as const;
export const CASE_GRAPH_POSTING_VALIDATION_CONCURRENCY = 8 as const;

export type CaseGraphPostingMapPartReceipt = {
  record_type: 'case_graph_posting_map_part_receipt';
  schema_version: typeof CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION;
  corpus_version: string;
  input_part_number: number;
  feature_archive_sha256: string;
  feature_row_count: number;
  reducer_shard_count: number;
  minimum_term_rarity: number;
  fragment_count: number;
  record_replica_count: number;
  posting_count: number;
  fragments: CaseGraphPostingFragmentManifest[];
};

type PartReceiptPointer = {
  key: string;
  sha256: string;
  input_part_number: number;
  feature_row_count: number;
  fragment_count: number;
  posting_count: number;
};

type PostingMapCheckpoint = {
  record_type: 'case_graph_posting_map_checkpoint';
  schema_version: typeof CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION;
  corpus_version: string;
  feature_archive_set_sha256: string;
  reducer_shard_count: number;
  minimum_term_rarity: number;
  next_input_part_number: number;
  processed_case_count: number;
  fragment_count: number;
  posting_count: number;
  part_receipts: PartReceiptPointer[];
  updated_at: string;
};

export type CaseGraphPostingMapCompletion = {
  record_type: 'case_graph_posting_map_completion';
  schema_version: typeof CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION;
  corpus_version: string;
  feature_archive_set_sha256: string;
  reducer_shard_count: number;
  minimum_term_rarity: number;
  input_part_count: number;
  processed_case_count: number;
  fragment_count: number;
  posting_count: number;
  part_receipts: PartReceiptPointer[];
  receipt_set_sha256: string;
  completed_at: string;
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

const parseObject = (body: Buffer, label: string) => {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
};

const receiptSetSha = (receipts: readonly PartReceiptPointer[]) => createHash('sha256')
  .update(receipts.map((receipt) => `${receipt.input_part_number}:${receipt.sha256}`).join('\n'))
  .digest('hex');

const validatePointer = (value: unknown, corpusVersion: string, expectedPart: number): PartReceiptPointer => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('case_graph_posting_receipt_pointer_invalid');
  const pointer = value as Partial<PartReceiptPointer>;
  const expectedKey = getCaseGraphPostingPartReceiptKey(corpusVersion, expectedPart);
  if (
    pointer.key !== expectedKey
    || pointer.input_part_number !== expectedPart
    || !/^[a-f0-9]{64}$/.test(String(pointer.sha256 || ''))
    || !Number.isSafeInteger(pointer.feature_row_count)
    || Number(pointer.feature_row_count) < 1
    || !Number.isSafeInteger(pointer.fragment_count)
    || Number(pointer.fragment_count) < 0
    || !Number.isSafeInteger(pointer.posting_count)
    || Number(pointer.posting_count) < 0
  ) throw new Error('case_graph_posting_receipt_pointer_invalid');
  return pointer as PartReceiptPointer;
};

const validateCheckpoint = (
  body: Buffer,
  expected: Pick<PostingMapCheckpoint, 'corpus_version' | 'feature_archive_set_sha256' | 'reducer_shard_count' | 'minimum_term_rarity'>,
): PostingMapCheckpoint => {
  const raw = parseObject(body, 'case_graph_posting_checkpoint');
  if (
    raw.record_type !== 'case_graph_posting_map_checkpoint'
    || raw.schema_version !== CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION
    || raw.corpus_version !== expected.corpus_version
    || raw.feature_archive_set_sha256 !== expected.feature_archive_set_sha256
    || raw.reducer_shard_count !== expected.reducer_shard_count
    || raw.minimum_term_rarity !== expected.minimum_term_rarity
    || !Array.isArray(raw.part_receipts)
  ) throw new Error('case_graph_posting_checkpoint_identity_mismatch');
  const pointers = raw.part_receipts.map((pointer, index) => validatePointer(pointer, expected.corpus_version, index));
  const checkpoint = { ...raw, part_receipts: pointers } as unknown as PostingMapCheckpoint;
  if (
    checkpoint.next_input_part_number !== pointers.length
    || checkpoint.processed_case_count !== pointers.reduce((sum, pointer) => sum + pointer.feature_row_count, 0)
    || checkpoint.fragment_count !== pointers.reduce((sum, pointer) => sum + pointer.fragment_count, 0)
    || checkpoint.posting_count !== pointers.reduce((sum, pointer) => sum + pointer.posting_count, 0)
  ) throw new Error('case_graph_posting_checkpoint_counters_invalid');
  return checkpoint;
};

const validateCompletion = (
  body: Buffer,
  expected: Pick<PostingMapCheckpoint, 'corpus_version' | 'feature_archive_set_sha256' | 'reducer_shard_count' | 'minimum_term_rarity'>,
  expectedCaseCount: number,
  expectedPartCount: number,
): CaseGraphPostingMapCompletion => {
  const raw = parseObject(body, 'case_graph_posting_completion');
  if (
    raw.record_type !== 'case_graph_posting_map_completion'
    || raw.schema_version !== CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION
    || raw.corpus_version !== expected.corpus_version
    || raw.feature_archive_set_sha256 !== expected.feature_archive_set_sha256
    || raw.reducer_shard_count !== expected.reducer_shard_count
    || raw.minimum_term_rarity !== expected.minimum_term_rarity
    || !Array.isArray(raw.part_receipts)
  ) throw new Error('case_graph_posting_completion_identity_mismatch');
  const pointers = raw.part_receipts.map((pointer, index) => validatePointer(pointer, expected.corpus_version, index));
  const completion = { ...raw, part_receipts: pointers } as unknown as CaseGraphPostingMapCompletion;
  if (
    completion.input_part_count !== expectedPartCount
    || pointers.length !== expectedPartCount
    || completion.processed_case_count !== expectedCaseCount
    || completion.processed_case_count !== pointers.reduce((sum, pointer) => sum + pointer.feature_row_count, 0)
    || completion.fragment_count !== pointers.reduce((sum, pointer) => sum + pointer.fragment_count, 0)
    || completion.posting_count !== pointers.reduce((sum, pointer) => sum + pointer.posting_count, 0)
    || completion.receipt_set_sha256 !== receiptSetSha(pointers)
  ) throw new Error('case_graph_posting_completion_counters_invalid');
  return completion;
};

const uploadAndVerify = async (
  storage: CaseGraphArchiveStorage,
  key: string,
  body: Buffer,
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
  if (!stored || !stored.equals(body)) throw new Error('case_graph_posting_read_after_write_failed');
};

const validateReceiptArtifacts = async (
  storage: CaseGraphArchiveStorage,
  pointers: readonly PartReceiptPointer[],
  identity: Pick<PostingMapCheckpoint, 'corpus_version' | 'reducer_shard_count' | 'minimum_term_rarity'>,
) => {
  const receipts: CaseGraphPostingMapPartReceipt[] = [];
  for (let index = 0; index < pointers.length; index += CASE_GRAPH_POSTING_VALIDATION_CONCURRENCY) {
    const batch = pointers.slice(index, index + CASE_GRAPH_POSTING_VALIDATION_CONCURRENCY);
    const validated = await Promise.all(batch.map(async (pointer) => {
      const body = await storage.readObject(pointer.key);
      if (!body || sha256(body) !== pointer.sha256) throw new Error('case_graph_posting_part_receipt_mismatch');
      const raw = parseObject(body, 'case_graph_posting_part_receipt') as unknown as CaseGraphPostingMapPartReceipt;
      if (
        raw.record_type !== 'case_graph_posting_map_part_receipt'
        || raw.schema_version !== CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION
        || raw.corpus_version !== identity.corpus_version
        || raw.input_part_number !== pointer.input_part_number
        || raw.feature_row_count !== pointer.feature_row_count
        || raw.reducer_shard_count !== identity.reducer_shard_count
        || raw.minimum_term_rarity !== identity.minimum_term_rarity
        || raw.fragment_count !== pointer.fragment_count
        || raw.posting_count !== pointer.posting_count
        || !Array.isArray(raw.fragments)
        || raw.fragments.length !== raw.fragment_count
        || raw.fragments.reduce((sum, fragment) => sum + Number(fragment.posting_count), 0) !== raw.posting_count
        || raw.fragments.reduce((sum, fragment) => sum + Number(fragment.record_count), 0) !== raw.record_replica_count
      ) throw new Error('case_graph_posting_part_receipt_invalid');
      const shards = new Set<number>();
      for (const fragment of raw.fragments) {
        if (
          fragment.corpus_version !== identity.corpus_version
          || fragment.input_part_number !== pointer.input_part_number
          || fragment.reducer_shard_count !== identity.reducer_shard_count
          || fragment.reducer_shard < 0
          || fragment.reducer_shard >= identity.reducer_shard_count
          || shards.has(fragment.reducer_shard)
        ) throw new Error('case_graph_posting_part_receipt_fragment_invalid');
        shards.add(fragment.reducer_shard);
        const manifestBody = await storage.readObject(fragment.manifest_key);
        if (!manifestBody || !manifestBody.equals(jsonBody(fragment))) {
          throw new Error('case_graph_posting_fragment_manifest_mismatch');
        }
      }
      return raw;
    }));
    receipts.push(...validated);
  }
  return receipts;
};

export const readVerifiedCaseGraphPostingMap = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount: number;
  minimumTermRarity: number;
}) => {
  const featureArchive = await readVerifiedCaseGraphFeatureArchive(params.storage, params.corpusVersion);
  const identity = {
    corpus_version: params.corpusVersion,
    feature_archive_set_sha256: featureArchive.completion.archive_set_sha256,
    reducer_shard_count: params.reducerShardCount,
    minimum_term_rarity: params.minimumTermRarity,
  };
  const controlKeys = getCaseGraphPostingControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(controlKeys.completionManifestKey);
  if (!completionBody) throw new Error('case_graph_posting_completion_missing');
  const completion = validateCompletion(
    completionBody,
    identity,
    featureArchive.completion.exported_row_count,
    featureArchive.completion.part_count,
  );
  const receipts = await validateReceiptArtifacts(params.storage, completion.part_receipts, identity);
  return { featureArchive, completion, receipts };
};

export const mapCaseGraphPostingArchive = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  reducerShardCount?: number;
  minimumTermRarity?: number;
  maxInputPartsPerRun?: number;
  now?: () => Date;
}) => {
  const reducerShardCount = Math.trunc(params.reducerShardCount ?? 64);
  const minimumTermRarity = Number(params.minimumTermRarity ?? 0.55);
  const maxInputPartsPerRun = Math.trunc(params.maxInputPartsPerRun ?? 4);
  if (!Number.isSafeInteger(reducerShardCount) || reducerShardCount < 1 || reducerShardCount > 4096) {
    throw new Error('case_graph_posting_shard_count_invalid');
  }
  if (!Number.isFinite(minimumTermRarity) || minimumTermRarity < 0 || minimumTermRarity > 1) {
    throw new Error('case_graph_posting_rarity_threshold_invalid');
  }
  if (!Number.isSafeInteger(maxInputPartsPerRun) || maxInputPartsPerRun < 1 || maxInputPartsPerRun > 100) {
    throw new Error('case_graph_posting_max_parts_invalid');
  }
  const now = params.now || (() => new Date());
  const featureArchive = await readVerifiedCaseGraphFeatureArchive(params.storage, params.corpusVersion);
  const identity = {
    corpus_version: params.corpusVersion,
    feature_archive_set_sha256: featureArchive.completion.archive_set_sha256,
    reducer_shard_count: reducerShardCount,
    minimum_term_rarity: minimumTermRarity,
  };
  const controlKeys = getCaseGraphPostingControlKeys(params.corpusVersion);
  const completionBody = await params.storage.readObject(controlKeys.completionManifestKey);
  if (completionBody) {
    const completion = validateCompletion(
      completionBody,
      identity,
      featureArchive.completion.exported_row_count,
      featureArchive.completion.part_count,
    );
    await validateReceiptArtifacts(params.storage, completion.part_receipts, identity);
    return { status: 'already_complete' as const, completion };
  }

  const checkpointBody = await params.storage.readObject(controlKeys.checkpointKey);
  let checkpoint: PostingMapCheckpoint = checkpointBody
    ? validateCheckpoint(checkpointBody, identity)
    : {
      record_type: 'case_graph_posting_map_checkpoint',
      schema_version: CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION,
      ...identity,
      next_input_part_number: 0,
      processed_case_count: 0,
      fragment_count: 0,
      posting_count: 0,
      part_receipts: [],
      updated_at: now().toISOString(),
    };
  if (checkpointBody) await validateReceiptArtifacts(params.storage, checkpoint.part_receipts, identity);
  let processedParts = 0;
  while (
    checkpoint.next_input_part_number < featureArchive.completion.part_count
    && processedParts < maxInputPartsPerRun
  ) {
    const featurePart = featureArchive.completion.parts[checkpoint.next_input_part_number];
    const featureBody = await params.storage.readObject(featurePart.archive_key);
    if (!featureBody || sha256(featureBody) !== featurePart.compressed_sha256) {
      throw new Error('case_graph_posting_feature_archive_mismatch');
    }
    const records = decodeCaseGraphFeaturePart(featureBody);
    if (
      records.length !== featurePart.row_count
      || records.some((record) => record.corpusVersion !== params.corpusVersion)
    ) throw new Error('case_graph_posting_feature_rows_mismatch');
    const fragments = buildCaseGraphPostingFragments({
      records,
      rarity: featureArchive.rarity,
      inputPartNumber: featurePart.part_number,
      reducerShardCount,
      minimumTermRarity,
    });
    const fragmentManifests: CaseGraphPostingFragmentManifest[] = [];
    for (let index = 0; index < fragments.length; index += CASE_GRAPH_POSTING_UPLOAD_CONCURRENCY) {
      const batch = fragments.slice(index, index + CASE_GRAPH_POSTING_UPLOAD_CONCURRENCY);
      const manifests = await Promise.all(batch.map(async (fragment) => {
        const built = buildCaseGraphPostingFragmentArchive(fragment);
        await uploadAndVerify(
          params.storage,
          built.manifest.archive_key,
          built.archiveBody,
          'application/json',
          'gzip',
        );
        await uploadAndVerify(
          params.storage,
          built.manifest.manifest_key,
          built.manifestBody,
          'application/json',
        );
        return built.manifest;
      }));
      fragmentManifests.push(...manifests);
    }
    const receipt: CaseGraphPostingMapPartReceipt = {
      record_type: 'case_graph_posting_map_part_receipt',
      schema_version: CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION,
      corpus_version: params.corpusVersion,
      input_part_number: featurePart.part_number,
      feature_archive_sha256: featurePart.compressed_sha256,
      feature_row_count: featurePart.row_count,
      reducer_shard_count: reducerShardCount,
      minimum_term_rarity: minimumTermRarity,
      fragment_count: fragmentManifests.length,
      record_replica_count: fragmentManifests.reduce((sum, manifest) => sum + manifest.record_count, 0),
      posting_count: fragmentManifests.reduce((sum, manifest) => sum + manifest.posting_count, 0),
      fragments: fragmentManifests,
    };
    const receiptKey = getCaseGraphPostingPartReceiptKey(params.corpusVersion, featurePart.part_number);
    const receiptBody = jsonBody(receipt);
    await uploadAndVerify(params.storage, receiptKey, receiptBody, 'application/json');
    const pointer: PartReceiptPointer = {
      key: receiptKey,
      sha256: sha256(receiptBody),
      input_part_number: featurePart.part_number,
      feature_row_count: featurePart.row_count,
      fragment_count: receipt.fragment_count,
      posting_count: receipt.posting_count,
    };
    checkpoint = {
      ...checkpoint,
      next_input_part_number: checkpoint.next_input_part_number + 1,
      processed_case_count: checkpoint.processed_case_count + featurePart.row_count,
      fragment_count: checkpoint.fragment_count + receipt.fragment_count,
      posting_count: checkpoint.posting_count + receipt.posting_count,
      part_receipts: [...checkpoint.part_receipts, pointer],
      updated_at: now().toISOString(),
    };
    const nextCheckpointBody = jsonBody(checkpoint);
    await params.storage.uploadFile(nextCheckpointBody, controlKeys.checkpointKey, {
      contentType: 'application/json',
      cacheControl: 'private, no-store',
      contentLength: nextCheckpointBody.length,
    });
    const storedCheckpoint = await params.storage.readObject(controlKeys.checkpointKey);
    if (!storedCheckpoint || !storedCheckpoint.equals(nextCheckpointBody)) {
      throw new Error('case_graph_posting_checkpoint_read_after_write_failed');
    }
    processedParts += 1;
  }
  if (checkpoint.next_input_part_number < featureArchive.completion.part_count) return {
    status: 'partial' as const,
    checkpoint,
    remaining_input_parts: featureArchive.completion.part_count - checkpoint.next_input_part_number,
  };
  if (checkpoint.processed_case_count !== featureArchive.completion.exported_row_count) {
    throw new Error('case_graph_posting_processed_case_count_mismatch');
  }
  const completion: CaseGraphPostingMapCompletion = {
    record_type: 'case_graph_posting_map_completion',
    schema_version: CASE_GRAPH_POSTING_MAP_SCHEMA_VERSION,
    ...identity,
    input_part_count: featureArchive.completion.part_count,
    processed_case_count: checkpoint.processed_case_count,
    fragment_count: checkpoint.fragment_count,
    posting_count: checkpoint.posting_count,
    part_receipts: checkpoint.part_receipts,
    receipt_set_sha256: receiptSetSha(checkpoint.part_receipts),
    completed_at: now().toISOString(),
  };
  const body = jsonBody(completion);
  await uploadAndVerify(params.storage, controlKeys.completionManifestKey, body, 'application/json');
  return { status: 'complete' as const, completion };
};
