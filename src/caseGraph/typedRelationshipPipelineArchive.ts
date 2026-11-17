import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputBinding,
} from './relationshipInputSnapshot';
import {
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  buildFullCorpusRelationshipCompletion,
  decodeFullCorpusContextualCompletionReference,
  decodeFullCorpusCandidateFragment,
  decodeFullCorpusPairReducerResult,
  decodeFullCorpusPipelineLineage,
  decodeFullCorpusPostingFragment,
  decodeFullCorpusPostingMapManifest,
  decodeFullCorpusPostingShardReduction,
  decodeFullCorpusRelationshipCompletion,
  fullCorpusRelationshipArtifactSha256,
  fullCorpusRelationshipShard,
  type FullCorpusAddressLedgerShard,
  type FullCorpusCandidateFragment,
  type FullCorpusContextualCompletionReference,
  type FullCorpusPairReducerResult,
  type FullCorpusPipelineLineage,
  type FullCorpusPostingFragment,
  type FullCorpusPostingMapManifest,
  type FullCorpusPostingShardReduction,
  type FullCorpusRelationshipCompletion,
} from './typedRelationshipPipeline';
import {
  assertContextualRelationshipCompletionProductionEligible,
  type ContextualRelationshipCompletionArtifact,
} from './contextualRelationshipCompletion';

export const FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION = 'full-corpus-typed-relationship-archive-v2' as const;

export type FullCorpusRelationshipArtifactType =
  | 'posting_fragment'
  | 'posting_map'
  | 'posting_reduction'
  | 'candidate_fragment'
  | 'pair_reducer'
  | 'contextual_completion'
  | 'address_ledger'
  | 'completion'
  | 'run_index';

export type FullCorpusRelationshipArchiveValue =
  | FullCorpusPostingFragment
  | FullCorpusPostingMapManifest
  | FullCorpusPostingShardReduction
  | FullCorpusCandidateFragment
  | FullCorpusPairReducerResult
  | ContextualRelationshipCompletionArtifact
  | FullCorpusAddressLedgerShard
  | FullCorpusRelationshipCompletion
  | FullCorpusRelationshipRunIndex;

export type FullCorpusRelationshipArchiveReceipt = {
  recordType: 'full_corpus_relationship_archive_receipt';
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION;
  pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  artifactType: FullCorpusRelationshipArtifactType;
  artifactDigest: string;
  archiveKey: string;
  receiptKey: string;
  archiveContentType: 'application/json';
  archiveContentEncoding: 'gzip';
  uncompressedBytes: number;
  compressedBytes: number;
  compressedSha256: string;
  receiptDigest: string;
};

export type FullCorpusRelationshipArchiveObject<T extends FullCorpusRelationshipArchiveValue = FullCorpusRelationshipArchiveValue> = {
  value: T;
  archiveBody: Buffer;
  receipt: FullCorpusRelationshipArchiveReceipt;
  receiptBody: Buffer;
};

export type FullCorpusRelationshipRunIndexEntry = {
  artifactType: FullCorpusRelationshipArtifactType;
  artifactDigest: string;
  archiveKey: string;
  receiptKey: string;
  compressedSha256: string;
};

export type FullCorpusRelationshipRunIndex = {
  recordType: 'full_corpus_relationship_run_index';
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION;
  pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  postingMapDigest: string;
  completionDigest: string;
  contextualCompletion: FullCorpusContextualCompletionReference;
  objectCount: number;
  objectTypeCounts: Record<Exclude<FullCorpusRelationshipArtifactType, 'run_index'>, number>;
  objects: FullCorpusRelationshipRunIndexEntry[];
  artifactSetSha256: string;
  indexDigest: string;
};

export type FullCorpusRelationshipRunIndexPointer = {
  recordType: 'full_corpus_relationship_run_index_pointer';
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION;
  pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  indexDigest: string;
  artifactSetSha256: string;
  completionDigest: string;
  contextualCompletion: FullCorpusContextualCompletionReference;
  indexArtifactDigest: string;
  indexArchiveKey: string;
  indexReceiptKey: string;
  pointerDigest: string;
};

export type FullCorpusRelationshipArchiveWriteResult = {
  archiveKey: string;
  receiptKey: string;
  artifactDigest: string;
  archiveStatus: 'written' | 'reused';
  receiptStatus: 'written' | 'reused';
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const requireExactKeys = (value: unknown, keys: readonly string[], code: string): Record<string, unknown> => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};

const archiveByteSha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const lineageMatches = (left: FullCorpusPipelineLineage, right: FullCorpusPipelineLineage) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

const validateLineage = (lineage: FullCorpusPipelineLineage) => {
  try {
    return decodeFullCorpusPipelineLineage(lineage);
  } catch {
    return invalid('full_corpus_relationship_archive_lineage_invalid');
  }
};

const expectedRecordType: Record<FullCorpusRelationshipArtifactType, string> = {
  posting_fragment: 'full_corpus_relationship_posting_fragment',
  posting_map: 'full_corpus_relationship_posting_map_manifest',
  posting_reduction: 'full_corpus_relationship_posting_shard_reduction',
  candidate_fragment: 'full_corpus_relationship_candidate_fragment',
  pair_reducer: 'full_corpus_relationship_pair_reducer_result',
  contextual_completion: 'contextual_relationship_completion_artifact',
  address_ledger: '',
  completion: 'full_corpus_relationship_completion',
  run_index: 'full_corpus_relationship_run_index',
};

const validateAddressLedger = (value: Record<string, unknown>) => {
  requireExactKeys(value, [
    'shard', 'shardCount', 'states', 'stateCount', 'linkedCount',
    'candidateOnlyCount', 'isolatedCount', 'stateSetSha256',
  ], 'full_corpus_relationship_address_ledger_archive_invalid');
  if (!Number.isSafeInteger(value.shard) || Number(value.shard) < 0
    || !Number.isSafeInteger(value.shardCount) || Number(value.shardCount) < 1
    || Number(value.shard) >= Number(value.shardCount)
    || !Array.isArray(value.states)
    || !Number.isSafeInteger(value.stateCount) || Number(value.stateCount) !== value.states.length
    || !Number.isSafeInteger(value.linkedCount) || Number(value.linkedCount) < 0
    || !Number.isSafeInteger(value.candidateOnlyCount) || Number(value.candidateOnlyCount) < 0
    || !Number.isSafeInteger(value.isolatedCount) || Number(value.isolatedCount) < 0
    || !SHA256_PATTERN.test(String(value.stateSetSha256))
  ) invalid('full_corpus_relationship_address_ledger_archive_invalid');
  let previous = '';
  let linked = 0;
  let candidateOnly = 0;
  let isolated = 0;
  const lines: string[] = [];
  for (const state of value.states) {
    requireExactKeys(state, ['address', 'recordDigest', 'kind', 'status'],
      'full_corpus_relationship_address_ledger_state_invalid');
    if (!isPlainObject(state)
      || typeof state.address !== 'string'
      || typeof state.recordDigest !== 'string' || !SHA256_PATTERN.test(state.recordDigest)
      || !['sighting', 'document', 'photo', 'video'].includes(String(state.kind))
      || !['linked', 'candidate_only', 'isolated'].includes(String(state.status))
      || fullCorpusRelationshipShard(state.address, Number(value.shardCount)) !== Number(value.shard)
      || (previous && previous >= state.address)
    ) invalid('full_corpus_relationship_address_ledger_state_invalid');
    previous = state.address;
    if (state.status === 'linked') linked += 1;
    else if (state.status === 'candidate_only') candidateOnly += 1;
    else isolated += 1;
    lines.push(`${state.address}:${state.recordDigest}:${state.status}`);
  }
  if (
    linked !== value.linkedCount
    || candidateOnly !== value.candidateOnlyCount
    || isolated !== value.isolatedCount
    || relationshipInputSha256(lines.join('\n')) !== value.stateSetSha256
  ) invalid('full_corpus_relationship_address_ledger_accounting_mismatch');
};

const RUN_INDEX_OBJECT_TYPES = [
  'posting_fragment', 'posting_map', 'posting_reduction', 'candidate_fragment',
  'pair_reducer', 'contextual_completion', 'address_ledger', 'completion',
] as const;

const validateRunIndex = (
  input: unknown,
  expectedLineage?: FullCorpusPipelineLineage,
): FullCorpusRelationshipRunIndex => {
  const value = requireExactKeys(input, [
    'recordType', 'schemaVersion', 'pipelineVersion', 'lineage', 'postingMapDigest',
    'completionDigest', 'contextualCompletion', 'objectCount', 'objectTypeCounts', 'objects',
    'artifactSetSha256', 'indexDigest',
  ], 'full_corpus_relationship_run_index_invalid');
  const lineage = validateLineage(value.lineage as FullCorpusPipelineLineage);
  const contextualCompletion = decodeFullCorpusContextualCompletionReference(
    value.contextualCompletion,
  );
  if (expectedLineage && !lineageMatches(lineage, expectedLineage)) {
    invalid('full_corpus_relationship_archive_lineage_mismatch');
  }
  requireExactKeys(value.objectTypeCounts, RUN_INDEX_OBJECT_TYPES,
    'full_corpus_relationship_run_index_type_counts_invalid');
  if (value.recordType !== 'full_corpus_relationship_run_index'
    || value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION
    || value.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION
    || !SHA256_PATTERN.test(String(value.postingMapDigest))
    || !SHA256_PATTERN.test(String(value.completionDigest))
    || !SHA256_PATTERN.test(String(value.artifactSetSha256))
    || !SHA256_PATTERN.test(String(value.indexDigest))
    || !Number.isSafeInteger(value.objectCount) || Number(value.objectCount) < 3
    || !Array.isArray(value.objects)
    || value.objects.length !== value.objectCount
  ) invalid('full_corpus_relationship_run_index_invalid');
  const counts = value.objectTypeCounts as Record<typeof RUN_INDEX_OBJECT_TYPES[number], number>;
  if (RUN_INDEX_OBJECT_TYPES.some((type) => !Number.isSafeInteger(counts[type]) || counts[type] < 0)
    || RUN_INDEX_OBJECT_TYPES.reduce((sum, type) => sum + counts[type], 0) !== value.objectCount
    || counts.posting_map !== 1
    || counts.contextual_completion !== 1
    || counts.completion !== 1) {
    invalid('full_corpus_relationship_run_index_type_counts_invalid');
  }
  const prefix = archivePrefix(lineage);
  let previous = '';
  const actualCounts = Object.fromEntries(
    RUN_INDEX_OBJECT_TYPES.map((type) => [type, 0]),
  ) as Record<typeof RUN_INDEX_OBJECT_TYPES[number], number>;
  const objects = value.objects.map((entryValue) => {
    const entry = requireExactKeys(entryValue, [
      'artifactType', 'artifactDigest', 'archiveKey', 'receiptKey', 'compressedSha256',
    ], 'full_corpus_relationship_run_index_entry_invalid');
    if (!RUN_INDEX_OBJECT_TYPES.includes(entry.artifactType as typeof RUN_INDEX_OBJECT_TYPES[number])
      || !SHA256_PATTERN.test(String(entry.artifactDigest))
      || !SHA256_PATTERN.test(String(entry.compressedSha256))
      || typeof entry.archiveKey !== 'string' || typeof entry.receiptKey !== 'string') {
      invalid('full_corpus_relationship_run_index_entry_invalid');
    }
    const artifactType = entry.artifactType as typeof RUN_INDEX_OBJECT_TYPES[number];
    const sortKey = `${artifactType}:${String(entry.artifactDigest)}`;
    if (previous && previous >= sortKey) invalid('full_corpus_relationship_run_index_entry_order_invalid');
    previous = sortKey;
    if (entry.archiveKey !== `${prefix}/${artifactType}/${String(entry.artifactDigest)}.json.gz`
      || entry.receiptKey !== `${prefix}/${artifactType}/${String(entry.artifactDigest)}.receipt.json`) {
      invalid('full_corpus_relationship_run_index_entry_key_invalid');
    }
    actualCounts[artifactType] += 1;
    return entry as unknown as FullCorpusRelationshipRunIndexEntry;
  });
  if (canonicalizeRelationshipInput(actualCounts) !== canonicalizeRelationshipInput(counts)
    || !objects.some((entry) => entry.artifactType === 'contextual_completion'
      && entry.artifactDigest === contextualCompletion.artifactDigest)
    || value.artifactSetSha256 !== relationshipInputSha256(objects.map((entry) => (
      `${entry.artifactType}:${entry.artifactDigest}:${entry.compressedSha256}`
    )).join('\n'))) invalid('full_corpus_relationship_run_index_accounting_mismatch');
  const { indexDigest, ...withoutDigest } = value;
  if (indexDigest !== relationshipInputSha256(withoutDigest)) {
    invalid('full_corpus_relationship_run_index_digest_mismatch');
  }
  return {
    ...value,
    lineage,
    contextualCompletion,
    objectTypeCounts: counts,
    objects,
  } as unknown as FullCorpusRelationshipRunIndex;
};

const validateArtifactShape = (
  artifactType: FullCorpusRelationshipArtifactType,
  value: FullCorpusRelationshipArchiveValue,
  expectedLineage?: FullCorpusPipelineLineage,
  expectedContextualCompletion?: FullCorpusContextualCompletionReference,
) => {
  if (!isPlainObject(value)) invalid('full_corpus_relationship_archive_value_invalid');
  const objectValue = value as unknown as Record<string, unknown>;
  if (artifactType === 'address_ledger') {
    validateAddressLedger(objectValue);
    if (!expectedLineage) invalid('full_corpus_relationship_address_ledger_lineage_required');
    return expectedLineage;
  }
  if (objectValue.recordType !== expectedRecordType[artifactType]) {
    invalid('full_corpus_relationship_archive_artifact_type_mismatch');
  }
  switch (artifactType) {
    case 'posting_fragment': return decodeFullCorpusPostingFragment(value, expectedLineage).lineage;
    case 'posting_map': return decodeFullCorpusPostingMapManifest(value, expectedLineage).lineage;
    case 'posting_reduction': return decodeFullCorpusPostingShardReduction(value, {
      lineage: expectedLineage,
    }).lineage;
    case 'candidate_fragment': return decodeFullCorpusCandidateFragment(value, {
      lineage: expectedLineage,
    }).lineage;
    case 'pair_reducer': return decodeFullCorpusPairReducerResult(value, {
      lineage: expectedLineage,
    }).lineage;
    case 'contextual_completion': {
      if (!expectedLineage || !expectedContextualCompletion) {
        invalid('full_corpus_relationship_contextual_completion_identity_required');
      }
      const expected = decodeFullCorpusContextualCompletionReference(
        expectedContextualCompletion,
      );
      const artifact = assertContextualRelationshipCompletionProductionEligible(
        value,
        expectedLineage.binding,
        {
          receiptId: expected.calibrationReceiptId,
          receiptSha256: expected.calibrationReceiptSha256,
        },
      );
      const actual = decodeFullCorpusContextualCompletionReference({
        completionId: artifact.completionId,
        completionDigest: artifact.completionDigest,
        artifactDigest: fullCorpusRelationshipArtifactSha256(artifact),
        sourceCompletionSetSha256: artifact.sourceCompletionSetSha256,
        entrySetSha256: artifact.entrySetSha256,
        calibrationReceiptId: artifact.calibrationReceipt.receiptId,
        calibrationReceiptSha256: artifact.calibrationReceipt.receiptSha256,
        sourceSnapshotCount: artifact.accounting.sourceSnapshotCount,
        sourceRecordCount: artifact.accounting.sourceRecordCount,
        acceptedEdgeCount: artifact.accounting.acceptedEdgeCount,
        insufficientEvidenceCount: artifact.accounting.insufficientEvidenceCount,
        zeroObservationState: artifact.zeroObservationState,
      });
      if (canonicalizeRelationshipInput(actual) !== canonicalizeRelationshipInput(expected)) {
        invalid('full_corpus_relationship_contextual_completion_identity_mismatch');
      }
      return expectedLineage;
    }
    case 'completion': return decodeFullCorpusRelationshipCompletion(value, expectedLineage).lineage;
    case 'run_index': return validateRunIndex(value, expectedLineage).lineage;
    default: return invalid('full_corpus_relationship_archive_artifact_type_mismatch');
  }
};

const archivePrefix = (lineage: FullCorpusPipelineLineage) => {
  const binding = validateRelationshipInputBinding(lineage.binding);
  return [
    'case-vortex',
    'corpora',
    binding.corpusVersion,
    'typed-relationship-v2',
    binding.snapshotId,
    lineage.relationshipInputManifestDigest,
    lineage.rarityIndexDigest,
  ].join('/');
};

const receiptWithoutDigest = (
  receipt: Omit<FullCorpusRelationshipArchiveReceipt, 'receiptDigest'>,
) => receipt;

export const buildFullCorpusRelationshipArchiveObject = <T extends FullCorpusRelationshipArchiveValue>(params: {
  artifactType: FullCorpusRelationshipArtifactType;
  value: T;
  lineage?: FullCorpusPipelineLineage;
  expectedContextualCompletion?: FullCorpusContextualCompletionReference;
}): FullCorpusRelationshipArchiveObject<T> => {
  const lineage = validateArtifactShape(
    params.artifactType,
    params.value,
    params.lineage,
    params.expectedContextualCompletion,
  );
  const canonicalBody = Buffer.from(`${canonicalizeRelationshipInput(params.value)}\n`, 'utf8');
  const artifactDigest = fullCorpusRelationshipArtifactSha256(params.value);
  const archiveBody = gzipSync(canonicalBody, { level: 6 });
  const prefix = archivePrefix(lineage);
  const archiveKey = `${prefix}/${params.artifactType}/${artifactDigest}.json.gz`;
  const receiptKey = `${prefix}/${params.artifactType}/${artifactDigest}.receipt.json`;
  const withoutDigest: Omit<FullCorpusRelationshipArchiveReceipt, 'receiptDigest'> = {
    recordType: 'full_corpus_relationship_archive_receipt',
    schemaVersion: FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
    pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    artifactType: params.artifactType,
    artifactDigest,
    archiveKey,
    receiptKey,
    archiveContentType: 'application/json',
    archiveContentEncoding: 'gzip',
    uncompressedBytes: canonicalBody.length,
    compressedBytes: archiveBody.length,
    compressedSha256: archiveByteSha256(archiveBody),
  };
  const receipt: FullCorpusRelationshipArchiveReceipt = {
    ...withoutDigest,
    receiptDigest: relationshipInputSha256(receiptWithoutDigest(withoutDigest)),
  };
  return {
    value: params.value,
    archiveBody,
    receipt,
    receiptBody: Buffer.from(`${canonicalizeRelationshipInput(receipt)}\n`, 'utf8'),
  };
};

const parseJson = (input: Buffer | string | unknown, code: string): unknown => {
  if (!Buffer.isBuffer(input) && typeof input !== 'string') return input;
  try {
    return JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  } catch {
    return invalid(code);
  }
};

export const decodeFullCorpusRelationshipArchiveReceipt = (
  input: Buffer | string | unknown,
  expectedLineage?: FullCorpusPipelineLineage,
): FullCorpusRelationshipArchiveReceipt => {
  const value = parseJson(input, 'full_corpus_relationship_archive_receipt_json_invalid');
  requireExactKeys(value, [
    'recordType', 'schemaVersion', 'pipelineVersion', 'lineage', 'artifactType',
    'artifactDigest', 'archiveKey', 'receiptKey', 'archiveContentType',
    'archiveContentEncoding', 'uncompressedBytes', 'compressedBytes',
    'compressedSha256', 'receiptDigest',
  ], 'full_corpus_relationship_archive_receipt_invalid');
  if (!isPlainObject(value)
    || value.recordType !== 'full_corpus_relationship_archive_receipt'
    || value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION
    || value.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION
    || !Object.hasOwn(expectedRecordType, String(value.artifactType))
    || !SHA256_PATTERN.test(String(value.artifactDigest))
    || !SHA256_PATTERN.test(String(value.compressedSha256))
    || !SHA256_PATTERN.test(String(value.receiptDigest))
    || typeof value.archiveKey !== 'string'
    || typeof value.receiptKey !== 'string'
    || value.archiveContentType !== 'application/json'
    || value.archiveContentEncoding !== 'gzip'
    || !Number.isSafeInteger(value.uncompressedBytes) || Number(value.uncompressedBytes) < 1
    || !Number.isSafeInteger(value.compressedBytes) || Number(value.compressedBytes) < 1
  ) invalid('full_corpus_relationship_archive_receipt_invalid');
  const lineage = validateLineage(value.lineage as FullCorpusPipelineLineage);
  if (expectedLineage && !lineageMatches(lineage, expectedLineage)) {
    invalid('full_corpus_relationship_archive_lineage_mismatch');
  }
  const receipt = { ...value, lineage } as unknown as FullCorpusRelationshipArchiveReceipt;
  const expectedPrefix = archivePrefix(lineage);
  if (
    receipt.archiveKey !== `${expectedPrefix}/${receipt.artifactType}/${receipt.artifactDigest}.json.gz`
    || receipt.receiptKey !== `${expectedPrefix}/${receipt.artifactType}/${receipt.artifactDigest}.receipt.json`
  ) invalid('full_corpus_relationship_archive_key_mismatch');
  const { receiptDigest, ...withoutDigest } = receipt;
  if (receiptDigest !== relationshipInputSha256(withoutDigest)) {
    invalid('full_corpus_relationship_archive_receipt_digest_mismatch');
  }
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(receipt)) {
    invalid('full_corpus_relationship_archive_receipt_noncanonical');
  }
  return receipt;
};

export const decodeFullCorpusRelationshipArchiveObject = <T extends FullCorpusRelationshipArchiveValue>(params: {
  archiveBody: Buffer;
  receipt: FullCorpusRelationshipArchiveReceipt | Buffer | string;
  expectedLineage?: FullCorpusPipelineLineage;
  expectedContextualCompletion?: FullCorpusContextualCompletionReference;
  maxUncompressedBytes?: number;
}): T => {
  const receipt = decodeFullCorpusRelationshipArchiveReceipt(params.receipt, params.expectedLineage);
  if (
    params.archiveBody.length !== receipt.compressedBytes
    || archiveByteSha256(params.archiveBody) !== receipt.compressedSha256
  ) invalid('full_corpus_relationship_archive_compressed_receipt_mismatch');
  const maxUncompressedBytes = Math.trunc(params.maxUncompressedBytes ?? 256 * 1024 * 1024);
  if (!Number.isSafeInteger(maxUncompressedBytes) || maxUncompressedBytes < 1) {
    invalid('full_corpus_relationship_archive_output_limit_invalid');
  }
  let canonicalBody: Buffer;
  try {
    canonicalBody = gunzipSync(params.archiveBody, { maxOutputLength: maxUncompressedBytes });
  } catch {
    return invalid('full_corpus_relationship_archive_gzip_invalid');
  }
  if (
    canonicalBody.length !== receipt.uncompressedBytes
    || !canonicalBody.length
    || canonicalBody[canonicalBody.length - 1] !== 0x0a
  ) invalid('full_corpus_relationship_archive_uncompressed_receipt_mismatch');
  let value: unknown;
  try {
    value = JSON.parse(canonicalBody.toString('utf8').slice(0, -1));
  } catch {
    return invalid('full_corpus_relationship_archive_json_invalid');
  }
  if (canonicalBody.toString('utf8') !== `${canonicalizeRelationshipInput(value)}\n`) {
    invalid('full_corpus_relationship_archive_noncanonical');
  }
  if (fullCorpusRelationshipArtifactSha256(value) !== receipt.artifactDigest) {
    invalid('full_corpus_relationship_archive_artifact_digest_mismatch');
  }
  validateArtifactShape(
    receipt.artifactType,
    value as FullCorpusRelationshipArchiveValue,
    receipt.lineage,
    params.expectedContextualCompletion,
  );
  return value as T;
};

const writeImmutable = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  key: string;
  body: Buffer;
  contentType: string;
  contentEncoding?: string;
}) => {
  const result = await params.storage.uploadFileConditional(
    params.body,
    params.key,
    {
      contentType: params.contentType,
      ...(params.contentEncoding ? { contentEncoding: params.contentEncoding } : {}),
      cacheControl: 'private, max-age=31536000, immutable',
      contentLength: params.body.length,
    },
    { ifAbsent: true },
  );
  if (result.status === 'written') return { status: 'written' as const, version: result.version };
  const existing = await params.storage.readObjectVersioned(params.key);
  if (!existing || !existing.body.equals(params.body)) {
    invalid('full_corpus_relationship_archive_immutable_collision');
  }
  return { status: 'reused' as const, version: existing.version };
};

export const writeFullCorpusRelationshipArchiveObject = async (
  storage: CaseGraphConditionalArchiveStorage,
  artifact: FullCorpusRelationshipArchiveObject,
  expectedContextualCompletion?: FullCorpusContextualCompletionReference,
): Promise<FullCorpusRelationshipArchiveWriteResult> => {
  decodeFullCorpusRelationshipArchiveObject({
    archiveBody: artifact.archiveBody,
    receipt: artifact.receipt,
    expectedLineage: artifact.receipt.lineage,
    expectedContextualCompletion,
  });
  const archive = await writeImmutable({
    storage,
    key: artifact.receipt.archiveKey,
    body: artifact.archiveBody,
    contentType: artifact.receipt.archiveContentType,
    contentEncoding: artifact.receipt.archiveContentEncoding,
  });
  const receipt = await writeImmutable({
    storage,
    key: artifact.receipt.receiptKey,
    body: artifact.receiptBody,
    contentType: 'application/json',
  });
  const storedArchive = await storage.readObject(artifact.receipt.archiveKey);
  const storedReceipt = await storage.readObject(artifact.receipt.receiptKey);
  if (!storedArchive || !storedReceipt) invalid('full_corpus_relationship_archive_read_after_write_missing');
  decodeFullCorpusRelationshipArchiveObject({
    archiveBody: storedArchive,
    receipt: storedReceipt,
    expectedLineage: artifact.receipt.lineage,
    expectedContextualCompletion,
  });
  return {
    archiveKey: artifact.receipt.archiveKey,
    receiptKey: artifact.receipt.receiptKey,
    artifactDigest: artifact.receipt.artifactDigest,
    archiveStatus: archive.status,
    receiptStatus: receipt.status,
  };
};

const emptyTypeCounts = (): FullCorpusRelationshipRunIndex['objectTypeCounts'] => ({
  posting_fragment: 0,
  posting_map: 0,
  posting_reduction: 0,
  candidate_fragment: 0,
  pair_reducer: 0,
  contextual_completion: 0,
  address_ledger: 0,
  completion: 0,
});

const indexWithoutDigest = (value: Omit<FullCorpusRelationshipRunIndex, 'indexDigest'>) => value;

const pointerWithoutDigest = (
  value: Omit<FullCorpusRelationshipRunIndexPointer, 'pointerDigest'>,
) => value;

export const buildFullCorpusRelationshipRunIndexPointer = (
  indexArtifact: FullCorpusRelationshipArchiveObject<FullCorpusRelationshipRunIndex>,
): FullCorpusRelationshipRunIndexPointer => {
  const index = indexArtifact.value;
  const lineage = validateLineage(index.lineage);
  const contextualCompletion = decodeFullCorpusContextualCompletionReference(
    index.contextualCompletion,
  );
  const { indexDigest, ...indexWithoutIndexDigest } = index;
  if (
    index.recordType !== 'full_corpus_relationship_run_index'
    || index.schemaVersion !== FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION
    || index.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION
    || indexDigest !== relationshipInputSha256(indexWithoutIndexDigest)
    || indexArtifact.receipt.artifactType !== 'run_index'
    || indexArtifact.receipt.artifactDigest !== fullCorpusRelationshipArtifactSha256(index)
    || !lineageMatches(indexArtifact.receipt.lineage, lineage)
  ) invalid('full_corpus_relationship_run_index_pointer_source_invalid');
  const withoutDigest: Omit<FullCorpusRelationshipRunIndexPointer, 'pointerDigest'> = {
    recordType: 'full_corpus_relationship_run_index_pointer',
    schemaVersion: FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
    pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    indexDigest,
    artifactSetSha256: index.artifactSetSha256,
    completionDigest: index.completionDigest,
    contextualCompletion,
    indexArtifactDigest: indexArtifact.receipt.artifactDigest,
    indexArchiveKey: indexArtifact.receipt.archiveKey,
    indexReceiptKey: indexArtifact.receipt.receiptKey,
  };
  return { ...withoutDigest, pointerDigest: relationshipInputSha256(pointerWithoutDigest(withoutDigest)) };
};

export const decodeFullCorpusRelationshipRunIndexPointer = (
  input: Buffer | string | unknown,
  expectedLineage?: FullCorpusPipelineLineage,
): FullCorpusRelationshipRunIndexPointer => {
  const value = parseJson(input, 'full_corpus_relationship_run_index_pointer_json_invalid');
  requireExactKeys(value, [
    'recordType', 'schemaVersion', 'pipelineVersion', 'lineage', 'indexDigest',
    'artifactSetSha256', 'completionDigest', 'contextualCompletion', 'indexArtifactDigest',
    'indexArchiveKey', 'indexReceiptKey', 'pointerDigest',
  ], 'full_corpus_relationship_run_index_pointer_invalid');
  if (!isPlainObject(value)
    || value.recordType !== 'full_corpus_relationship_run_index_pointer'
    || value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION
    || value.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION
    || !SHA256_PATTERN.test(String(value.indexDigest))
    || !SHA256_PATTERN.test(String(value.artifactSetSha256))
    || !SHA256_PATTERN.test(String(value.completionDigest))
    || !SHA256_PATTERN.test(String(value.indexArtifactDigest))
    || !SHA256_PATTERN.test(String(value.pointerDigest))
    || typeof value.indexArchiveKey !== 'string'
    || typeof value.indexReceiptKey !== 'string'
  ) invalid('full_corpus_relationship_run_index_pointer_invalid');
  const lineage = validateLineage(value.lineage as FullCorpusPipelineLineage);
  const contextualCompletion = decodeFullCorpusContextualCompletionReference(
    value.contextualCompletion,
  );
  if (expectedLineage && !lineageMatches(lineage, expectedLineage)) {
    invalid('full_corpus_relationship_archive_lineage_mismatch');
  }
  const pointer = {
    ...value,
    lineage,
    contextualCompletion,
  } as unknown as FullCorpusRelationshipRunIndexPointer;
  const prefix = archivePrefix(lineage);
  if (
    pointer.indexArchiveKey !== `${prefix}/run_index/${pointer.indexArtifactDigest}.json.gz`
    || pointer.indexReceiptKey !== `${prefix}/run_index/${pointer.indexArtifactDigest}.receipt.json`
  ) invalid('full_corpus_relationship_run_index_pointer_key_mismatch');
  const { pointerDigest, ...withoutDigest } = pointer;
  if (pointerDigest !== relationshipInputSha256(withoutDigest)) {
    invalid('full_corpus_relationship_run_index_pointer_digest_mismatch');
  }
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(pointer)) {
    invalid('full_corpus_relationship_run_index_pointer_noncanonical');
  }
  return pointer;
};

export const decodeFullCorpusRelationshipRunIndex = (
  input: Buffer | string | unknown,
  expectedLineage?: FullCorpusPipelineLineage,
): FullCorpusRelationshipRunIndex => {
  const parsed = parseJson(input, 'full_corpus_relationship_run_index_json_invalid');
  const index = validateRunIndex(parsed, expectedLineage);
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    const raw = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    const canonical = canonicalizeRelationshipInput(index);
    if (raw !== canonical && raw !== `${canonical}\n`) {
      invalid('full_corpus_relationship_run_index_noncanonical');
    }
  }
  return index;
};

export const buildFullCorpusRelationshipRunIndex = (params: {
  postingMap: FullCorpusPostingMapManifest;
  completion: FullCorpusRelationshipCompletion;
  contextualCompletion: ContextualRelationshipCompletionArtifact;
  receipts: readonly FullCorpusRelationshipArchiveReceipt[];
}): FullCorpusRelationshipRunIndex => {
  const postingMap = decodeFullCorpusPostingMapManifest(params.postingMap);
  const lineage = validateLineage(postingMap.lineage);
  const completion = decodeFullCorpusRelationshipCompletion(params.completion, lineage);
  if (
    !lineageMatches(lineage, completion.lineage)
    || completion.postingMapDigest !== postingMap.mapDigest
  ) invalid('full_corpus_relationship_run_index_completion_mismatch');
  validateArtifactShape(
    'contextual_completion',
    params.contextualCompletion,
    lineage,
    completion.contextualCompletion,
  );
  const receipts = params.receipts.map((receipt) => decodeFullCorpusRelationshipArchiveReceipt(receipt, lineage))
    .sort((left, right) => compareText(left.artifactType, right.artifactType)
      || compareText(left.artifactDigest, right.artifactDigest));
  if (receipts.some((receipt) => receipt.artifactType === 'run_index')) {
    invalid('full_corpus_relationship_run_index_recursive_entry');
  }
  if (new Set(receipts.map((receipt) => receipt.archiveKey)).size !== receipts.length) {
    invalid('full_corpus_relationship_run_index_duplicate_object');
  }
  const postingMapReceipt = receipts.find((receipt) => receipt.artifactType === 'posting_map'
    && receipt.artifactDigest === fullCorpusRelationshipArtifactSha256(postingMap));
  const completionReceipt = receipts.find((receipt) => receipt.artifactType === 'completion'
    && receipt.artifactDigest === fullCorpusRelationshipArtifactSha256(completion));
  const contextualCompletionReceipt = receipts.find((receipt) => (
    receipt.artifactType === 'contextual_completion'
    && receipt.artifactDigest === completion.contextualCompletion.artifactDigest
  ));
  if (!postingMapReceipt || !completionReceipt || !contextualCompletionReceipt) {
    invalid('full_corpus_relationship_run_index_required_object_missing');
  }
  const objectTypeCounts = emptyTypeCounts();
  const objects = receipts.map((receipt): FullCorpusRelationshipRunIndexEntry => {
    objectTypeCounts[receipt.artifactType as keyof typeof objectTypeCounts] += 1;
    return {
      artifactType: receipt.artifactType,
      artifactDigest: receipt.artifactDigest,
      archiveKey: receipt.archiveKey,
      receiptKey: receipt.receiptKey,
      compressedSha256: receipt.compressedSha256,
    };
  });
  const artifactSetSha256 = relationshipInputSha256(objects.map((entry) => (
    `${entry.artifactType}:${entry.artifactDigest}:${entry.compressedSha256}`
  )).join('\n'));
  const withoutDigest: Omit<FullCorpusRelationshipRunIndex, 'indexDigest'> = {
    recordType: 'full_corpus_relationship_run_index',
    schemaVersion: FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
    pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    postingMapDigest: postingMap.mapDigest,
    completionDigest: completion.completionDigest,
    contextualCompletion: completion.contextualCompletion,
    objectCount: objects.length,
    objectTypeCounts,
    objects,
    artifactSetSha256,
  };
  return { ...withoutDigest, indexDigest: relationshipInputSha256(indexWithoutDigest(withoutDigest)) };
};

export const archiveFullCorpusRelationshipRun = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  postingFragments: readonly FullCorpusPostingFragment[];
  postingMap: FullCorpusPostingMapManifest;
  postingReductions: readonly FullCorpusPostingShardReduction[];
  pairReducers: readonly FullCorpusPairReducerResult[];
  contextualCompletion: ContextualRelationshipCompletionArtifact;
  expectedContextualCalibration: { receiptId: string; receiptSha256: string };
  completion: FullCorpusRelationshipCompletion;
}): Promise<{
  index: FullCorpusRelationshipRunIndex;
  indexArtifact: FullCorpusRelationshipArchiveObject<FullCorpusRelationshipRunIndex>;
  indexPointer: FullCorpusRelationshipRunIndexPointer;
  writes: FullCorpusRelationshipArchiveWriteResult[];
}> => {
  const postingMap = decodeFullCorpusPostingMapManifest(params.postingMap);
  const lineage = validateLineage(postingMap.lineage);
  const postingFragments = params.postingFragments.map((fragment) => decodeFullCorpusPostingFragment(
    fragment,
    lineage,
    postingMap.postingShardCount,
  )).sort((left, right) => left.inputPartNumber - right.inputPartNumber || left.postingShard - right.postingShard);
  const fragmentSummaries = postingFragments.map((fragment) => ({
    inputPartNumber: fragment.inputPartNumber,
    postingShard: fragment.postingShard,
    recordReplicaCount: fragment.records.length,
    postingCount: fragment.postings.length,
    identityCount: fragment.postings.filter((posting) => posting.routeKind === 'address_identity'
      && posting.reasonCode === null).length,
    fragmentDigest: fragment.fragmentDigest,
  }));
  if (canonicalizeRelationshipInput(fragmentSummaries) !== canonicalizeRelationshipInput(postingMap.fragments)) {
    invalid('full_corpus_relationship_archive_posting_fragment_set_mismatch');
  }
  const postingReductions = params.postingReductions.map((reduction) => decodeFullCorpusPostingShardReduction(
    reduction,
    {
      lineage,
      postingMapDigest: postingMap.mapDigest,
      postingShardCount: postingMap.postingShardCount,
    },
  )).sort((left, right) => left.postingShard - right.postingShard);
  for (const reduction of postingReductions) {
    const sourceFragments = postingFragments.filter((fragment) => fragment.postingShard === reduction.postingShard);
    const postings = sourceFragments.flatMap((fragment) => fragment.postings);
    const expectedPresence = sourceFragments.flatMap((fragment) => fragment.postings.flatMap((posting) => {
      if (posting.routeKind !== 'address_identity' || posting.reasonCode !== null) return [];
      const record = fragment.records[posting.recordIndex];
      return [{
        address: record.address,
        recordDigest: record.recordDigest,
        kind: record.address.slice(0, record.address.indexOf(':')),
      }];
    })).sort((left, right) => compareText(left.address, right.address));
    if (reduction.inputFragmentCount !== sourceFragments.length
      || reduction.postingCount !== postings.length
      || reduction.postingGroupCount !== new Set(postings.map((posting) => posting.signature)).size
      || canonicalizeRelationshipInput(reduction.presenceRecords)
        !== canonicalizeRelationshipInput(expectedPresence)) {
      invalid('full_corpus_relationship_archive_posting_reduction_source_mismatch');
    }
  }
  const pairShardCount = postingReductions[0]?.pairShardCount;
  if (!pairShardCount) invalid('full_corpus_relationship_archive_pair_shards_missing');
  const candidateFragments = postingReductions.flatMap((reduction) => reduction.candidateFragments);
  const pairReducers = params.pairReducers.map((reducer) => decodeFullCorpusPairReducerResult(reducer, {
    lineage,
    postingMapDigest: postingMap.mapDigest,
    pairShardCount,
    fragments: candidateFragments.filter((fragment) => fragment.pairShard === reducer.pairShard),
  })).sort((left, right) => left.pairShard - right.pairShard);
  const ledgerShardCount = params.completion.addressLedgerShards[0]?.shardCount;
  if (!ledgerShardCount) invalid('full_corpus_relationship_archive_address_ledger_missing');
  const completion = decodeFullCorpusRelationshipCompletion(params.completion, lineage);
  const contextualCompletion = assertContextualRelationshipCompletionProductionEligible(
    params.contextualCompletion,
    lineage.binding,
    params.expectedContextualCalibration,
  );
  const rebuiltCompletion = buildFullCorpusRelationshipCompletion({
    postingMap,
    postingReductions,
    pairReducers,
    contextualCompletion,
    expectedContextualCalibration: params.expectedContextualCalibration,
    addressLedgerShardCount: ledgerShardCount,
  });
  if (canonicalizeRelationshipInput(rebuiltCompletion) !== canonicalizeRelationshipInput(completion)) {
    invalid('full_corpus_relationship_archive_completion_mismatch');
  }
  const artifacts: FullCorpusRelationshipArchiveObject[] = [
    ...postingFragments.map((value) => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'posting_fragment', value, lineage,
    })),
    buildFullCorpusRelationshipArchiveObject({ artifactType: 'posting_map', value: postingMap, lineage }),
    ...postingReductions.flatMap((reduction) => [
      buildFullCorpusRelationshipArchiveObject({ artifactType: 'posting_reduction', value: reduction, lineage }),
      ...reduction.candidateFragments.map((value) => buildFullCorpusRelationshipArchiveObject({
        artifactType: 'candidate_fragment', value, lineage,
      })),
    ]),
    ...pairReducers.map((value) => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'pair_reducer', value, lineage,
    })),
    buildFullCorpusRelationshipArchiveObject({
      artifactType: 'contextual_completion',
      value: contextualCompletion,
      lineage,
      expectedContextualCompletion: completion.contextualCompletion,
    }),
    ...completion.addressLedgerShards.map((value) => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'address_ledger', value, lineage,
    })),
    buildFullCorpusRelationshipArchiveObject({ artifactType: 'completion', value: completion, lineage }),
  ];
  if (new Set(artifacts.map((artifact) => artifact.receipt.archiveKey)).size !== artifacts.length) {
    invalid('full_corpus_relationship_archive_run_duplicate_artifact');
  }
  const writes: FullCorpusRelationshipArchiveWriteResult[] = [];
  for (const artifact of artifacts) writes.push(await writeFullCorpusRelationshipArchiveObject(
    params.storage,
    artifact,
    completion.contextualCompletion,
  ));
  const index = buildFullCorpusRelationshipRunIndex({
    postingMap,
    completion,
    contextualCompletion,
    receipts: artifacts.map((artifact) => artifact.receipt),
  });
  const indexArtifact = buildFullCorpusRelationshipArchiveObject({ artifactType: 'run_index', value: index, lineage });
  writes.push(await writeFullCorpusRelationshipArchiveObject(params.storage, indexArtifact));
  const indexPointer = buildFullCorpusRelationshipRunIndexPointer(indexArtifact);
  return { index, indexArtifact, indexPointer, writes };
};

export const readVerifiedFullCorpusRelationshipArchiveObject = async <T extends FullCorpusRelationshipArchiveValue>(params: {
  storage: CaseGraphConditionalArchiveStorage;
  receiptKey: string;
  expectedLineage?: FullCorpusPipelineLineage;
  expectedContextualCompletion?: FullCorpusContextualCompletionReference;
  maxUncompressedBytes?: number;
}): Promise<{ value: T; receipt: FullCorpusRelationshipArchiveReceipt }> => {
  const receiptBody = await params.storage.readObject(params.receiptKey);
  if (!receiptBody) invalid('full_corpus_relationship_archive_receipt_missing');
  const receipt = decodeFullCorpusRelationshipArchiveReceipt(receiptBody, params.expectedLineage);
  if (receipt.receiptKey !== params.receiptKey) invalid('full_corpus_relationship_archive_receipt_key_mismatch');
  const archiveBody = await params.storage.readObject(receipt.archiveKey);
  if (!archiveBody) invalid('full_corpus_relationship_archive_object_missing');
  const value = decodeFullCorpusRelationshipArchiveObject<T>({
    archiveBody,
    receipt,
    expectedLineage: params.expectedLineage,
    expectedContextualCompletion: params.expectedContextualCompletion,
    maxUncompressedBytes: params.maxUncompressedBytes,
  });
  return { value, receipt };
};

export const readVerifiedFullCorpusRelationshipRunIndex = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  pointer: FullCorpusRelationshipRunIndexPointer | Buffer | string;
}): Promise<{
  pointer: FullCorpusRelationshipRunIndexPointer;
  index: FullCorpusRelationshipRunIndex;
  receipt: FullCorpusRelationshipArchiveReceipt;
}> => {
  const pointer = decodeFullCorpusRelationshipRunIndexPointer(params.pointer);
  const { value: index, receipt } = await readVerifiedFullCorpusRelationshipArchiveObject<FullCorpusRelationshipRunIndex>({
    storage: params.storage,
    receiptKey: pointer.indexReceiptKey,
    expectedLineage: pointer.lineage,
  });
  if (
    receipt.archiveKey !== pointer.indexArchiveKey
    || receipt.artifactDigest !== pointer.indexArtifactDigest
    || index.indexDigest !== pointer.indexDigest
    || index.artifactSetSha256 !== pointer.artifactSetSha256
    || index.completionDigest !== pointer.completionDigest
    || canonicalizeRelationshipInput(index.contextualCompletion)
      !== canonicalizeRelationshipInput(pointer.contextualCompletion)
  ) invalid('full_corpus_relationship_run_index_pointer_target_mismatch');
  return { pointer, index, receipt };
};

// Kept exported for storage adapters which need a stable raw-byte receipt.
export const fullCorpusRelationshipArchiveByteSha256 = archiveByteSha256;
