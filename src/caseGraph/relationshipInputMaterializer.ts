import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';

import { getEvidenceUniverseControlKeys } from './archiveKeys';
import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphFeatureCompletionManifest,
} from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
} from './evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  type EvidenceUniverseNode,
} from './evidenceUniverse';
import {
  decodeEvidenceUniverseCompletion,
  decodeEvidenceUniverseNodePart,
  readEvidenceUniversePart,
} from './evidenceUniversePublicAccess';
import {
  readCaseGraphFeatureArchiveDescriptor,
  readVerifiedCaseGraphFeaturePart,
} from './featureArchive';
import type { CaseGraphFeatureRecord } from './featureExtraction';
import {
  RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION,
  buildRelationshipInputFeatureEnrichment,
} from './relationshipInputFeatureAdapter';
import {
  RELATIONSHIP_INPUT_EXTRACTION_VERSION,
  extractRelationshipInputRecord,
  type RelationshipInputVectorPolicy,
} from './relationshipInputExtraction';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
  decodeRelationshipInputPart,
  decodeRelationshipInputPartManifest,
  decodeRelationshipInputSnapshotManifest,
  getRelationshipInputControlKeys,
  type RelationshipInputPartManifest,
  type RelationshipInputPartSummary,
} from './relationshipInputArchive';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const RELATIONSHIP_INPUT_MATERIALIZER_VERSION = 'relationship-input-materializer-v2' as const;
export const DEFAULT_RELATIONSHIP_INPUT_VECTOR_POLICY: RelationshipInputVectorPolicy = {
  modelId: 'narrative-vector-not-generated',
  modelVersion: 'unavailable-v1',
  dimensions: 1,
  normalization: 'none',
};

const DEFAULT_ROWS_PER_PART = 5_000;
// A full 466k-node relationship snapshot can legitimately require several
// hundred byte-bounded parts. Default to a single resumable pass; operators can
// lower this explicitly when they need a short maintenance window.
const DEFAULT_MAX_PARTS_PER_RUN = 1_000;
const DEFAULT_TARGET_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_TARGET_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;

type UploadOptions = {
  contentType: string;
  contentEncoding?: string;
  cacheControl: string;
  contentLength: number;
};

export type RelationshipInputFeatureReceipt = {
  corpusVersion: string;
  completionSha256: string;
  archiveSetSha256: string;
  recordCount: number;
  snapshotId: string;
  snapshotPolicy: string;
  capturePolicy: string;
  materializedAt: string;
  sourceMvccSnapshot: string;
  universeCorpusVersion: string;
  universeArchiveSetSha256: string;
};

export type RelationshipInputMaterializationCore = {
  materializerVersion: typeof RELATIONSHIP_INPUT_MATERIALIZER_VERSION;
  binding: RelationshipInputUniverseBinding;
  universeCompletionSha256: string;
  feature: RelationshipInputFeatureReceipt;
  extraction: {
    extractionVersion: typeof RELATIONSHIP_INPUT_EXTRACTION_VERSION;
    featureAdapterVersion: typeof RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION;
    vectorPolicy: RelationshipInputVectorPolicy;
  };
  partitioning: {
    rowsPerPart: number;
    targetUncompressedBytes: number;
    ordering: 'address-bytewise-v1';
    compression: 'gzip-level-6';
  };
};

export type RelationshipInputMaterializationIntent = RelationshipInputMaterializationCore & {
  recordType: 'relationship_input_materialization_intent';
  startedAt: string;
  inputIdentitySha256: string;
};

export type RelationshipInputSourceReceipts = {
  universeAddressSetSha256: string;
  sightingAddressSetSha256: string;
  featureAddressSetSha256: string;
  universeRecordCount: number;
  sightingRecordCount: number;
  featureRecordCount: number;
};

export type RelationshipInputMaterializationCheckpoint = {
  recordType: 'relationship_input_materialization_checkpoint';
  materializerVersion: typeof RELATIONSHIP_INPUT_MATERIALIZER_VERSION;
  inputIdentitySha256: string;
  binding: RelationshipInputUniverseBinding;
  exportedRowCount: number;
  nextPartNumber: number;
  lastAddress: string | null;
  parts: RelationshipInputPartManifest[];
  sourceReceipts: RelationshipInputSourceReceipts | null;
  finalizedAt: string | null;
  updatedAt: string;
};

export type RelationshipInputMaterializationCompletion = {
  recordType: 'relationship_input_materialization_completion';
  materializerVersion: typeof RELATIONSHIP_INPUT_MATERIALIZER_VERSION;
  inputIdentitySha256: string;
  binding: RelationshipInputUniverseBinding;
  feature: RelationshipInputFeatureReceipt;
  sourceReceipts: RelationshipInputSourceReceipts;
  relationshipSnapshotManifestKey: string;
  relationshipSnapshotManifestSha256: string;
  relationshipSnapshotManifestDigest: string;
  relationshipArchiveSetSha256: string;
  rowCount: number;
  partCount: number;
  completedAt: string;
  completionDigest: string;
};

type TempRun<T> = {
  path: string;
  count: number;
  firstKey: string;
  lastKey: string;
  ndjsonSha256: string;
  _type?: T;
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
};

const invalid = (code: string): never => { throw new Error(code); };
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const canonicalBody = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');

const parseJsonObject = (body: Buffer | string | unknown, code: string): Record<string, unknown> => {
  let value: unknown = body;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body);
    } catch {
      invalid(`${code}_json_invalid`);
    }
  }
  if (!isObject(value)) invalid(code);
  return value as Record<string, unknown>;
};

const requireSha = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(code);
  return value as string;
};

const requireId = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid(code);
  return value as string;
};

const requireText = (value: unknown, code: string, maximum = 4_096): string => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) invalid(code);
  return value as string;
};

const requireCount = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(code);
  return Number(value);
};

const requireIso = (value: unknown, code: string): string => {
  if (typeof value !== 'string') invalid(code);
  const exact = value as string;
  const parsed = new Date(exact);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return exact;
};

const normalizeVectorPolicy = (value: unknown): RelationshipInputVectorPolicy => {
  if (!isObject(value) || !hasExactKeys(value, ['modelId', 'modelVersion', 'dimensions', 'normalization'])) {
    invalid('relationship_input_materialization_vector_policy_invalid');
  }
  const record = value as Record<string, unknown>;
  const dimensions = requireCount(record.dimensions, 'relationship_input_materialization_vector_policy_invalid');
  if (dimensions < 1 || dimensions > 65_536 || !['l2', 'none'].includes(String(record.normalization))) {
    invalid('relationship_input_materialization_vector_policy_invalid');
  }
  return {
    modelId: requireId(record.modelId, 'relationship_input_materialization_vector_policy_invalid'),
    modelVersion: requireId(record.modelVersion, 'relationship_input_materialization_vector_policy_invalid'),
    dimensions,
    normalization: record.normalization as RelationshipInputVectorPolicy['normalization'],
  };
};

const normalizeFeatureReceipt = (value: unknown): RelationshipInputFeatureReceipt => {
  if (!isObject(value) || !hasExactKeys(value, [
    'corpusVersion', 'completionSha256', 'archiveSetSha256', 'recordCount',
    'snapshotId', 'snapshotPolicy', 'capturePolicy', 'materializedAt',
    'sourceMvccSnapshot', 'universeCorpusVersion', 'universeArchiveSetSha256',
  ])) invalid('relationship_input_materialization_feature_receipt_invalid');
  const record = value as Record<string, unknown>;
  return {
    corpusVersion: requireId(record.corpusVersion, 'relationship_input_materialization_feature_receipt_invalid'),
    completionSha256: requireSha(record.completionSha256, 'relationship_input_materialization_feature_receipt_invalid'),
    archiveSetSha256: requireSha(record.archiveSetSha256, 'relationship_input_materialization_feature_receipt_invalid'),
    recordCount: requireCount(record.recordCount, 'relationship_input_materialization_feature_receipt_invalid'),
    snapshotId: requireText(record.snapshotId, 'relationship_input_materialization_feature_receipt_invalid', 36),
    snapshotPolicy: requireText(record.snapshotPolicy, 'relationship_input_materialization_feature_receipt_invalid'),
    capturePolicy: requireText(record.capturePolicy, 'relationship_input_materialization_feature_receipt_invalid'),
    materializedAt: requireText(record.materializedAt, 'relationship_input_materialization_feature_receipt_invalid'),
    sourceMvccSnapshot: requireText(record.sourceMvccSnapshot, 'relationship_input_materialization_feature_receipt_invalid'),
    universeCorpusVersion: requireId(record.universeCorpusVersion, 'relationship_input_materialization_feature_receipt_invalid'),
    universeArchiveSetSha256: requireSha(
      record.universeArchiveSetSha256,
      'relationship_input_materialization_feature_receipt_invalid',
    ),
  };
};

const materializationCore = (value: RelationshipInputMaterializationCore) => ({
  materializerVersion: value.materializerVersion,
  binding: value.binding,
  universeCompletionSha256: value.universeCompletionSha256,
  feature: value.feature,
  extraction: value.extraction,
  partitioning: value.partitioning,
});

const decodeMaterializationCore = (value: unknown): RelationshipInputMaterializationCore => {
  if (!isObject(value)) invalid('relationship_input_materialization_core_invalid');
  const record = value as Record<string, unknown>;
  if (record.materializerVersion !== RELATIONSHIP_INPUT_MATERIALIZER_VERSION
    || !isObject(record.extraction)
    || !hasExactKeys(record.extraction, ['extractionVersion', 'featureAdapterVersion', 'vectorPolicy'])
    || !isObject(record.partitioning)
    || !hasExactKeys(record.partitioning, [
      'rowsPerPart', 'targetUncompressedBytes', 'ordering', 'compression',
    ])) {
    invalid('relationship_input_materialization_core_invalid');
  }
  const extraction = record.extraction as Record<string, unknown>;
  const partitioning = record.partitioning as Record<string, unknown>;
  if (
    extraction.extractionVersion !== RELATIONSHIP_INPUT_EXTRACTION_VERSION
    || extraction.featureAdapterVersion !== RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION
  ) invalid('relationship_input_materialization_extraction_version_invalid');
  const binding = validateRelationshipInputBinding(record.binding);
  const feature = normalizeFeatureReceipt(record.feature);
  const rowsPerPart = requireCount(
    partitioning.rowsPerPart,
    'relationship_input_materialization_partitioning_invalid',
  );
  const targetUncompressedBytes = requireCount(
    partitioning.targetUncompressedBytes,
    'relationship_input_materialization_partitioning_invalid',
  );
  if (
    rowsPerPart < 1 || rowsPerPart > 25_000
    || targetUncompressedBytes < 64 * 1024
    || targetUncompressedBytes > MAX_TARGET_UNCOMPRESSED_BYTES
    || partitioning.ordering !== 'address-bytewise-v1'
    || partitioning.compression !== 'gzip-level-6'
  ) invalid('relationship_input_materialization_partitioning_invalid');
  if (
    feature.snapshotId !== binding.snapshotId
    || feature.universeCorpusVersion !== binding.corpusVersion
    || feature.universeArchiveSetSha256 !== binding.universeArchiveSetSha256
    || feature.recordCount > binding.universeRecordCount
  ) invalid('relationship_input_materialization_feature_binding_mismatch');
  return {
    materializerVersion: RELATIONSHIP_INPUT_MATERIALIZER_VERSION,
    binding,
    universeCompletionSha256: requireSha(
      record.universeCompletionSha256,
      'relationship_input_materialization_universe_completion_sha_invalid',
    ),
    feature,
    extraction: {
      extractionVersion: RELATIONSHIP_INPUT_EXTRACTION_VERSION,
      featureAdapterVersion: RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION,
      vectorPolicy: normalizeVectorPolicy(extraction.vectorPolicy),
    },
    partitioning: {
      rowsPerPart,
      targetUncompressedBytes,
      ordering: 'address-bytewise-v1',
      compression: 'gzip-level-6',
    },
  };
};

export const decodeRelationshipInputMaterializationIntent = (
  input: Buffer | string | unknown,
): RelationshipInputMaterializationIntent => {
  const value = parseJsonObject(input, 'relationship_input_materialization_intent_invalid');
  if (!hasExactKeys(value, [
    'recordType', 'materializerVersion', 'binding', 'universeCompletionSha256',
    'feature', 'extraction', 'partitioning', 'startedAt', 'inputIdentitySha256',
  ]) || value.recordType !== 'relationship_input_materialization_intent') {
    invalid('relationship_input_materialization_intent_invalid');
  }
  const core = decodeMaterializationCore(value);
  const inputIdentitySha256 = requireSha(
    value.inputIdentitySha256,
    'relationship_input_materialization_identity_invalid',
  );
  if (inputIdentitySha256 !== relationshipInputSha256(materializationCore(core))) {
    invalid('relationship_input_materialization_identity_mismatch');
  }
  const intent: RelationshipInputMaterializationIntent = {
    recordType: 'relationship_input_materialization_intent',
    ...core,
    startedAt: requireIso(value.startedAt, 'relationship_input_materialization_started_at_invalid'),
    inputIdentitySha256,
  };
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(intent)) {
    invalid('relationship_input_materialization_intent_non_canonical');
  }
  return intent;
};

const normalizeSourceReceipts = (value: unknown): RelationshipInputSourceReceipts => {
  if (!isObject(value) || !hasExactKeys(value, [
    'universeAddressSetSha256', 'sightingAddressSetSha256', 'featureAddressSetSha256',
    'universeRecordCount', 'sightingRecordCount', 'featureRecordCount',
  ])) invalid('relationship_input_source_receipts_invalid');
  const record = value as Record<string, unknown>;
  const receipts: RelationshipInputSourceReceipts = {
    universeAddressSetSha256: requireSha(record.universeAddressSetSha256, 'relationship_input_source_receipts_invalid'),
    sightingAddressSetSha256: requireSha(record.sightingAddressSetSha256, 'relationship_input_source_receipts_invalid'),
    featureAddressSetSha256: requireSha(record.featureAddressSetSha256, 'relationship_input_source_receipts_invalid'),
    universeRecordCount: requireCount(record.universeRecordCount, 'relationship_input_source_receipts_invalid'),
    sightingRecordCount: requireCount(record.sightingRecordCount, 'relationship_input_source_receipts_invalid'),
    featureRecordCount: requireCount(record.featureRecordCount, 'relationship_input_source_receipts_invalid'),
  };
  if (
    receipts.sightingRecordCount !== receipts.featureRecordCount
    || receipts.sightingAddressSetSha256 !== receipts.featureAddressSetSha256
    || receipts.sightingRecordCount > receipts.universeRecordCount
  ) invalid('relationship_input_source_receipts_mismatch');
  return receipts;
};

const partSummary = (manifest: RelationshipInputPartManifest): RelationshipInputPartSummary => ({
  partNumber: manifest.partNumber,
  archiveKey: manifest.archiveKey,
  manifestKey: manifest.manifestKey,
  rowCount: manifest.rowCount,
  firstAddress: manifest.firstAddress,
  lastAddress: manifest.lastAddress,
  uncompressedBytes: manifest.uncompressedBytes,
  compressedBytes: manifest.compressedBytes,
  compressedSha256: manifest.compressedSha256,
  recordSetSha256: manifest.recordSetSha256,
  accounting: manifest.accounting,
});

const decodeCheckpoint = (
  input: Buffer | string | unknown,
  intent: RelationshipInputMaterializationIntent,
): RelationshipInputMaterializationCheckpoint => {
  const value = parseJsonObject(input, 'relationship_input_materialization_checkpoint_invalid');
  if (!hasExactKeys(value, [
    'recordType', 'materializerVersion', 'inputIdentitySha256', 'binding',
    'exportedRowCount', 'nextPartNumber', 'lastAddress', 'parts', 'sourceReceipts',
    'finalizedAt', 'updatedAt',
  ])
    || value.recordType !== 'relationship_input_materialization_checkpoint'
    || value.materializerVersion !== RELATIONSHIP_INPUT_MATERIALIZER_VERSION
    || value.inputIdentitySha256 !== intent.inputIdentitySha256
    || !Array.isArray(value.parts)) {
    invalid('relationship_input_materialization_checkpoint_invalid');
  }
  const binding = validateRelationshipInputBinding(value.binding);
  if (canonicalizeRelationshipInput(binding) !== canonicalizeRelationshipInput(intent.binding)) {
    invalid('relationship_input_materialization_checkpoint_binding_mismatch');
  }
  const parts = (value.parts as unknown[]).map((part) => decodeRelationshipInputPartManifest(part, binding));
  let exportedRowCount = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.partNumber !== index || (index && parts[index - 1].lastAddress >= part.firstAddress)) {
      invalid('relationship_input_materialization_checkpoint_part_sequence_invalid');
    }
    exportedRowCount += part.rowCount;
    if (!Number.isSafeInteger(exportedRowCount)) invalid('relationship_input_materialization_checkpoint_count_invalid');
  }
  const declaredExported = requireCount(value.exportedRowCount, 'relationship_input_materialization_checkpoint_count_invalid');
  const nextPartNumber = requireCount(value.nextPartNumber, 'relationship_input_materialization_checkpoint_count_invalid');
  const lastAddress = value.lastAddress === null
    ? null
    : validateRelationshipInputAddress(value.lastAddress);
  if (
    declaredExported !== exportedRowCount
    || nextPartNumber !== parts.length
    || lastAddress !== (parts.at(-1)?.lastAddress || null)
    || declaredExported > binding.universeRecordCount
  ) invalid('relationship_input_materialization_checkpoint_count_invalid');
  const sourceReceipts = value.sourceReceipts === null ? null : normalizeSourceReceipts(value.sourceReceipts);
  const finalizedAt = value.finalizedAt === null
    ? null
    : requireIso(value.finalizedAt, 'relationship_input_materialization_checkpoint_finalized_at_invalid');
  if (finalizedAt !== null && (declaredExported !== binding.universeRecordCount || sourceReceipts === null)) {
    invalid('relationship_input_materialization_checkpoint_finalization_invalid');
  }
  return {
    recordType: 'relationship_input_materialization_checkpoint',
    materializerVersion: RELATIONSHIP_INPUT_MATERIALIZER_VERSION,
    inputIdentitySha256: intent.inputIdentitySha256,
    binding,
    exportedRowCount: declaredExported,
    nextPartNumber,
    lastAddress,
    parts,
    sourceReceipts,
    finalizedAt,
    updatedAt: requireIso(value.updatedAt, 'relationship_input_materialization_checkpoint_updated_at_invalid'),
  };
};

const completionWithoutDigest = (
  value: Omit<RelationshipInputMaterializationCompletion, 'completionDigest'>,
) => value;

export const decodeRelationshipInputMaterializationCompletion = (
  input: Buffer | string | unknown,
  intent?: RelationshipInputMaterializationIntent,
): RelationshipInputMaterializationCompletion => {
  const value = parseJsonObject(input, 'relationship_input_materialization_completion_invalid');
  if (!hasExactKeys(value, [
    'recordType', 'materializerVersion', 'inputIdentitySha256', 'binding', 'feature',
    'sourceReceipts', 'relationshipSnapshotManifestKey', 'relationshipSnapshotManifestSha256',
    'relationshipSnapshotManifestDigest', 'relationshipArchiveSetSha256', 'rowCount',
    'partCount', 'completedAt', 'completionDigest',
  ])
    || value.recordType !== 'relationship_input_materialization_completion'
    || value.materializerVersion !== RELATIONSHIP_INPUT_MATERIALIZER_VERSION) {
    invalid('relationship_input_materialization_completion_invalid');
  }
  const binding = validateRelationshipInputBinding(value.binding);
  const feature = normalizeFeatureReceipt(value.feature);
  const withoutDigest: Omit<RelationshipInputMaterializationCompletion, 'completionDigest'> = {
    recordType: 'relationship_input_materialization_completion',
    materializerVersion: RELATIONSHIP_INPUT_MATERIALIZER_VERSION,
    inputIdentitySha256: requireSha(value.inputIdentitySha256, 'relationship_input_materialization_completion_invalid'),
    binding,
    feature,
    sourceReceipts: normalizeSourceReceipts(value.sourceReceipts),
    relationshipSnapshotManifestKey: requireText(
      value.relationshipSnapshotManifestKey,
      'relationship_input_materialization_completion_invalid',
    ),
    relationshipSnapshotManifestSha256: requireSha(
      value.relationshipSnapshotManifestSha256,
      'relationship_input_materialization_completion_invalid',
    ),
    relationshipSnapshotManifestDigest: requireSha(
      value.relationshipSnapshotManifestDigest,
      'relationship_input_materialization_completion_invalid',
    ),
    relationshipArchiveSetSha256: requireSha(
      value.relationshipArchiveSetSha256,
      'relationship_input_materialization_completion_invalid',
    ),
    rowCount: requireCount(value.rowCount, 'relationship_input_materialization_completion_invalid'),
    partCount: requireCount(value.partCount, 'relationship_input_materialization_completion_invalid'),
    completedAt: requireIso(value.completedAt, 'relationship_input_materialization_completion_invalid'),
  };
  if (
    withoutDigest.rowCount !== binding.universeRecordCount
    || withoutDigest.sourceReceipts.universeRecordCount !== binding.universeRecordCount
  ) invalid('relationship_input_materialization_completion_count_mismatch');
  if (
    feature.snapshotId !== binding.snapshotId
    || feature.universeCorpusVersion !== binding.corpusVersion
    || feature.universeArchiveSetSha256 !== binding.universeArchiveSetSha256
  ) invalid('relationship_input_materialization_completion_input_mismatch');
  const completionDigest = requireSha(value.completionDigest, 'relationship_input_materialization_completion_invalid');
  if (completionDigest !== relationshipInputSha256(completionWithoutDigest(withoutDigest))) {
    invalid('relationship_input_materialization_completion_digest_mismatch');
  }
  const completion = { ...withoutDigest, completionDigest };
  const expectedSnapshotKey = getRelationshipInputControlKeys(binding).completionManifestKey;
  if (
    completion.relationshipSnapshotManifestKey !== expectedSnapshotKey
    || completion.sourceReceipts.featureRecordCount !== completion.feature.recordCount
  ) invalid('relationship_input_materialization_completion_input_mismatch');
  if (intent && (
    completion.inputIdentitySha256 !== intent.inputIdentitySha256
    || canonicalizeRelationshipInput(completion.binding) !== canonicalizeRelationshipInput(intent.binding)
    || canonicalizeRelationshipInput(completion.feature) !== canonicalizeRelationshipInput(intent.feature)
  )) invalid('relationship_input_materialization_completion_input_mismatch');
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(completion)) {
    invalid('relationship_input_materialization_completion_non_canonical');
  }
  return completion;
};

const writeImmutable = async (
  storage: CaseGraphConditionalArchiveStorage,
  body: Buffer,
  key: string,
  options: UploadOptions,
  conflictCode: string,
) => {
  let preconditionFailed = false;
  try {
    const result = await storage.uploadFileConditional(body, key, options, { ifAbsent: true });
    preconditionFailed = result.status === 'precondition_failed';
  } catch (error) {
    const existing = await storage.readObject(key);
    if (existing?.equals(body)) return;
    throw error;
  }
  const existing = await storage.readObject(key);
  if (!existing?.equals(body)) {
    throw new Error(preconditionFailed ? conflictCode : `${conflictCode}_read_after_write_failed`);
  }
};

const writeIntent = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  core: RelationshipInputMaterializationCore,
  now: () => Date,
) => {
  const existing = await storage.readObject(key);
  if (existing) {
    const intent = decodeRelationshipInputMaterializationIntent(existing);
    if (canonicalizeRelationshipInput(materializationCore(intent)) !== canonicalizeRelationshipInput(core)) {
      invalid('relationship_input_materialization_intent_conflict');
    }
    return intent;
  }
  const intent: RelationshipInputMaterializationIntent = {
    recordType: 'relationship_input_materialization_intent',
    ...core,
    startedAt: now().toISOString(),
    inputIdentitySha256: relationshipInputSha256(materializationCore(core)),
  };
  const body = canonicalBody(intent);
  try {
    const result = await storage.uploadFileConditional(body, key, {
      contentType: 'application/json', cacheControl: 'private, max-age=31536000, immutable', contentLength: body.length,
    }, { ifAbsent: true });
    if (result.status === 'written') {
      const stored = await storage.readObject(key);
      if (!stored?.equals(body)) invalid('relationship_input_materialization_intent_read_after_write_failed');
      return intent;
    }
  } catch (error) {
    const stored = await storage.readObject(key);
    if (!stored) throw error;
  }
  const winnerBody = await storage.readObject(key);
  if (!winnerBody) invalid('relationship_input_materialization_intent_write_failed');
  const winner = decodeRelationshipInputMaterializationIntent(winnerBody);
  if (canonicalizeRelationshipInput(materializationCore(winner)) !== canonicalizeRelationshipInput(core)) {
    invalid('relationship_input_materialization_intent_conflict');
  }
  return winner;
};

const writeCheckpoint = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  checkpoint: RelationshipInputMaterializationCheckpoint,
  version: string | null,
) => {
  const body = canonicalBody(checkpoint);
  try {
    const result = await storage.uploadFileConditional(body, key, {
      contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length,
    }, version === null ? { ifAbsent: true } : { ifVersion: version });
    if (result.status === 'precondition_failed') {
      const winner = await storage.readObjectVersioned(key);
      if (winner?.body.equals(body)) return winner.version;
      invalid('relationship_input_materialization_concurrent_writer_detected');
    }
  } catch (error) {
    const stored = await storage.readObjectVersioned(key);
    if (stored?.body.equals(body)) return stored.version;
    throw error;
  }
  const stored = await storage.readObjectVersioned(key);
  if (!stored?.body.equals(body)) invalid('relationship_input_materialization_checkpoint_read_after_write_failed');
  return (stored as NonNullable<typeof stored>).version;
};

const validateAlignment = (
  universe: EvidenceUniverseCompletion,
  feature: CaseGraphFeatureCompletionManifest,
) => {
  const featureUniverse = feature.binding.universe;
  if (
    !featureUniverse
    || featureUniverse.corpus_version !== universe.corpusVersion
    || featureUniverse.archive_set_sha256 !== universe.archiveSetSha256
    || feature.binding.snapshot_id !== universe.expected.snapshotId
    || feature.binding.snapshot_policy !== universe.expected.snapshotPolicy
    || feature.binding.capture_policy !== universe.expected.capturePolicies.sighting
    || feature.binding.materialized_at !== universe.expected.materializedAt
    || feature.binding.source_mvcc_snapshot !== universe.expected.sourceMvccSnapshot
    || feature.expected.snapshot_at !== universe.expected.snapshotAt
    || feature.expected.eligible_count !== universe.expected.byKind.sighting
    || feature.exported_row_count !== universe.expected.byKind.sighting
  ) invalid('relationship_input_materialization_archive_alignment_mismatch');
};

const buildCore = (params: {
  universe: EvidenceUniverseCompletion;
  universeCompletionBody: Buffer;
  feature: CaseGraphFeatureCompletionManifest;
  featureCompletionBody: Buffer;
  vectorPolicy: RelationshipInputVectorPolicy;
  rowsPerPart: number;
  targetUncompressedBytes: number;
}): RelationshipInputMaterializationCore => {
  validateAlignment(params.universe, params.feature);
  const binding: RelationshipInputUniverseBinding = validateRelationshipInputBinding({
    snapshotId: params.universe.expected.snapshotId,
    corpusVersion: params.universe.corpusVersion,
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: params.universe.archiveSetSha256,
    universeRecordCount: params.universe.expected.total,
  });
  return {
    materializerVersion: RELATIONSHIP_INPUT_MATERIALIZER_VERSION,
    binding,
    universeCompletionSha256: sha256(params.universeCompletionBody),
    feature: {
      corpusVersion: params.feature.corpus_version,
      completionSha256: sha256(params.featureCompletionBody),
      archiveSetSha256: params.feature.archive_set_sha256,
      recordCount: params.feature.exported_row_count,
      snapshotId: params.feature.binding.snapshot_id,
      snapshotPolicy: params.feature.binding.snapshot_policy,
      capturePolicy: params.feature.binding.capture_policy,
      materializedAt: params.feature.binding.materialized_at,
      sourceMvccSnapshot: params.feature.binding.source_mvcc_snapshot,
      universeCorpusVersion: params.feature.binding.universe!.corpus_version,
      universeArchiveSetSha256: params.feature.binding.universe!.archive_set_sha256,
    },
    extraction: {
      extractionVersion: RELATIONSHIP_INPUT_EXTRACTION_VERSION,
      featureAdapterVersion: RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION,
      vectorPolicy: normalizeVectorPolicy(params.vectorPolicy),
    },
    partitioning: {
      rowsPerPart: params.rowsPerPart,
      targetUncompressedBytes: params.targetUncompressedBytes,
      ordering: 'address-bytewise-v1',
      compression: 'gzip-level-6',
    },
  };
};

const writeRun = async <T>(
  root: string,
  prefix: string,
  index: number,
  values: readonly T[],
  keyOf: (value: T) => string,
): Promise<TempRun<T>> => {
  if (!values.length) invalid('relationship_input_materialization_empty_temp_run');
  const ordered = [...values].sort((left, right) => compareText(keyOf(left), keyOf(right)));
  for (let cursor = 1; cursor < ordered.length; cursor += 1) {
    if (keyOf(ordered[cursor - 1]) >= keyOf(ordered[cursor])) {
      invalid('relationship_input_materialization_temp_run_duplicate');
    }
  }
  const path = join(root, `${prefix}-${String(index).padStart(6, '0')}.ndjson.gz`);
  const raw = Buffer.from(ordered.map((value) => `${JSON.stringify(value)}\n`).join(''), 'utf8');
  await writeFile(path, gzipSync(raw, { level: 6 }), { flag: 'wx' });
  return {
    path,
    count: ordered.length,
    firstKey: keyOf(ordered[0]),
    lastKey: keyOf(ordered[ordered.length - 1]),
    ndjsonSha256: sha256(raw),
  };
};

async function* readRun<T>(run: TempRun<T>): AsyncGenerator<T> {
  const stream = createReadStream(run.path).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  const digest = createHash('sha256');
  try {
    for await (const line of lines) {
      if (!line) invalid('relationship_input_materialization_temp_run_invalid');
      let value!: T;
      try {
        value = JSON.parse(line) as T;
      } catch {
        invalid('relationship_input_materialization_temp_run_invalid');
      }
      count += 1;
      digest.update(`${line}\n`);
      yield value;
    }
  } finally {
    lines.close();
  }
  if (count !== run.count || digest.digest('hex') !== run.ndjsonSha256) {
    invalid('relationship_input_materialization_temp_run_count_mismatch');
  }
}

type HeapItem<T> = { run: number; value: T; key: string };

const heapPush = <T>(heap: HeapItem<T>[], item: HeapItem<T>) => {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareText(heap[parent].key, heap[index].key) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
};

const heapPop = <T>(heap: HeapItem<T>[]) => {
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length || !last) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareText(heap[left].key, heap[smallest].key) < 0) smallest = left;
    if (right < heap.length && compareText(heap[right].key, heap[smallest].key) < 0) smallest = right;
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
  return first;
};

async function* mergeRuns<T>(
  runs: readonly TempRun<T>[],
  keyOf: (value: T) => string,
): AsyncGenerator<T> {
  const iterators = runs.map((run) => readRun(run)[Symbol.asyncIterator]());
  const heap: HeapItem<T>[] = [];
  for (let index = 0; index < iterators.length; index += 1) {
    const next = await iterators[index].next();
    if (!next.done) heapPush(heap, { run: index, value: next.value, key: keyOf(next.value) });
  }
  let previous: string | null = null;
  while (heap.length) {
    const item = heapPop(heap);
    if (!item) break;
    if (previous !== null && previous >= item.key) invalid('relationship_input_materialization_global_order_invalid');
    previous = item.key;
    yield item.value;
    const next = await iterators[item.run].next();
    if (!next.done) heapPush(heap, { run: item.run, value: next.value, key: keyOf(next.value) });
  }
}

const prepareRuns = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  universe: EvidenceUniverseCompletion;
  feature: CaseGraphFeatureCompletionManifest;
  tempRoot: string;
}) => {
  const universeRuns: TempRun<EvidenceUniverseNode>[] = [];
  for (const part of params.universe.parts) {
    const stored = await readEvidenceUniversePart(
      params.storage,
      params.universe,
      part.kind,
      part.partNumber,
    );
    if (!stored) invalid('relationship_input_materialization_universe_part_missing');
    const decoded = decodeEvidenceUniverseNodePart((stored as NonNullable<typeof stored>).body, part);
    universeRuns.push(await writeRun(
      params.tempRoot,
      'universe',
      universeRuns.length,
      decoded.nodes,
      (node) => node.address,
    ));
  }

  const featureRuns: TempRun<CaseGraphFeatureRecord>[] = [];
  for (const part of params.feature.parts) {
    const decoded = await readVerifiedCaseGraphFeaturePart(
      params.storage,
      part,
      params.feature.corpus_version,
    );
    featureRuns.push(await writeRun(
      params.tempRoot,
      'feature',
      featureRuns.length,
      decoded.features,
      (feature) => `sighting:${feature.caseId}`,
    ));
  }
  return { universeRuns, featureRuns };
};

const verifyStoredPart = async (
  storage: CaseGraphConditionalArchiveStorage,
  manifest: RelationshipInputPartManifest,
) => {
  const manifestBody = await storage.readObject(manifest.manifestKey);
  if (!manifestBody) invalid('relationship_input_materialization_part_manifest_missing');
  const storedManifest = decodeRelationshipInputPartManifest(manifestBody as Buffer, manifest.binding);
  if (canonicalizeRelationshipInput(storedManifest) !== canonicalizeRelationshipInput(manifest)) {
    invalid('relationship_input_materialization_part_manifest_mismatch');
  }
  const archiveBody = await storage.readObject(manifest.archiveKey);
  if (!archiveBody) invalid('relationship_input_materialization_part_archive_missing');
  return decodeRelationshipInputPart(archiveBody as Buffer, storedManifest, manifest.binding);
};

const verifyStoredSnapshot = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  completion: RelationshipInputMaterializationCompletion;
  expectedReceipts: RelationshipInputSourceReceipts;
}) => {
  if (canonicalizeRelationshipInput(params.completion.sourceReceipts)
    !== canonicalizeRelationshipInput(params.expectedReceipts)) {
    invalid('relationship_input_materialization_source_receipts_changed');
  }
  const body = await params.storage.readObject(params.completion.relationshipSnapshotManifestKey);
  if (!body || sha256(body) !== params.completion.relationshipSnapshotManifestSha256) {
    invalid('relationship_input_materialization_snapshot_manifest_receipt_mismatch');
  }
  const snapshot = decodeRelationshipInputSnapshotManifest(body as Buffer, params.completion.binding);
  if (
    snapshot.manifestDigest !== params.completion.relationshipSnapshotManifestDigest
    || snapshot.archiveSetSha256 !== params.completion.relationshipArchiveSetSha256
    || snapshot.rowCount !== params.completion.rowCount
    || snapshot.partCount !== params.completion.partCount
  ) invalid('relationship_input_materialization_snapshot_manifest_mismatch');
  const outputAddresses = createHash('sha256');
  let outputCount = 0;
  for (const summary of snapshot.parts) {
    const manifestBody = await params.storage.readObject(summary.manifestKey);
    if (!manifestBody) invalid('relationship_input_materialization_part_manifest_missing');
    const manifest = decodeRelationshipInputPartManifest(manifestBody as Buffer, snapshot.binding);
    if (canonicalizeRelationshipInput(partSummary(manifest)) !== canonicalizeRelationshipInput(summary)) {
      invalid('relationship_input_materialization_part_manifest_mismatch');
    }
    const decoded = await verifyStoredPart(params.storage, manifest);
    for (const record of decoded.records) {
      outputAddresses.update(`${record.address}\n`);
      outputCount += 1;
    }
  }
  if (
    outputCount !== params.expectedReceipts.universeRecordCount
    || outputAddresses.digest('hex') !== params.expectedReceipts.universeAddressSetSha256
  ) invalid('relationship_input_materialization_output_address_receipt_mismatch');
  return snapshot;
};

const readInputs = async (
  storage: CaseGraphConditionalArchiveStorage,
  universeCorpusVersion: string,
  featureCorpusVersion: string,
) => {
  const universeKey = getEvidenceUniverseControlKeys(universeCorpusVersion).completionManifestKey;
  const universeCompletionBody = await storage.readObject(universeKey);
  if (!universeCompletionBody) invalid('relationship_input_materialization_universe_completion_missing');
  const universe = decodeEvidenceUniverseCompletion(universeCompletionBody as Buffer, universeCorpusVersion);
  const featureDescriptor = await readCaseGraphFeatureArchiveDescriptor(storage, featureCorpusVersion);
  return {
    universe,
    universeCompletionBody: universeCompletionBody as Buffer,
    feature: featureDescriptor.completion,
    featureCompletionBody: featureDescriptor.completionBody,
  };
};

const emptyCheckpoint = (
  intent: RelationshipInputMaterializationIntent,
  now: () => Date,
): RelationshipInputMaterializationCheckpoint => ({
  recordType: 'relationship_input_materialization_checkpoint',
  materializerVersion: RELATIONSHIP_INPUT_MATERIALIZER_VERSION,
  inputIdentitySha256: intent.inputIdentitySha256,
  binding: intent.binding,
  exportedRowCount: 0,
  nextPartNumber: 0,
  lastAddress: null,
  parts: [],
  sourceReceipts: null,
  finalizedAt: null,
  updatedAt: now().toISOString(),
});

const sourceReceiptsEqual = (
  left: RelationshipInputSourceReceipts | null,
  right: RelationshipInputSourceReceipts,
) => left !== null && canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right);

export const materializeRelationshipInputArchive = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  universeCorpusVersion: string;
  featureCorpusVersion: string;
  vectorPolicy?: RelationshipInputVectorPolicy;
  rowsPerPart?: number;
  maxPartsPerRun?: number;
  targetUncompressedBytes?: number;
  tempParent?: string;
  now?: () => Date;
}) => {
  if (
    typeof params.storage?.readObject !== 'function'
    || typeof params.storage?.readObjectVersioned !== 'function'
    || typeof params.storage?.uploadFileConditional !== 'function'
  ) invalid('relationship_input_materialization_conditional_storage_required');
  const rowsPerPart = Math.trunc(params.rowsPerPart ?? DEFAULT_ROWS_PER_PART);
  const maxPartsPerRun = Math.trunc(params.maxPartsPerRun ?? DEFAULT_MAX_PARTS_PER_RUN);
  const targetUncompressedBytes = Math.trunc(
    params.targetUncompressedBytes ?? DEFAULT_TARGET_UNCOMPRESSED_BYTES,
  );
  if (rowsPerPart < 1 || rowsPerPart > 25_000) invalid('relationship_input_materialization_rows_per_part_invalid');
  if (maxPartsPerRun < 1 || maxPartsPerRun > 1_000) invalid('relationship_input_materialization_max_parts_invalid');
  if (targetUncompressedBytes < 64 * 1024 || targetUncompressedBytes > MAX_TARGET_UNCOMPRESSED_BYTES) {
    invalid('relationship_input_materialization_part_bytes_invalid');
  }
  const now = params.now || (() => new Date());
  const inputs = await readInputs(params.storage, params.universeCorpusVersion, params.featureCorpusVersion);
  const core = buildCore({
    ...inputs,
    vectorPolicy: params.vectorPolicy || DEFAULT_RELATIONSHIP_INPUT_VECTOR_POLICY,
    rowsPerPart,
    targetUncompressedBytes,
  });
  const keys = getRelationshipInputControlKeys(core.binding);
  const preexistingSnapshot = await params.storage.readObject(keys.completionManifestKey);
  const preexistingIntent = await params.storage.readObject(keys.materializationIntentKey);
  if (preexistingSnapshot && !preexistingIntent) {
    invalid('relationship_input_materialization_unbound_snapshot_conflict');
  }
  const intent = await writeIntent(params.storage, keys.materializationIntentKey, core, now);

  const parent = params.tempParent || tmpdir();
  await mkdir(parent, { recursive: true });
  const tempRoot = await mkdtemp(join(parent, 'case-vortex-relationship-input-'));
  try {
    const runs = await prepareRuns({
      storage: params.storage,
      universe: inputs.universe,
      feature: inputs.feature,
      tempRoot,
    });
    const completionBody = await params.storage.readObject(keys.materializationCompletionManifestKey);
    const completion = completionBody
      ? decodeRelationshipInputMaterializationCompletion(completionBody, intent)
      : null;

    const checkpointObject = completion
      ? null
      : await params.storage.readObjectVersioned(keys.materializationCheckpointKey);
    let checkpointVersion = checkpointObject?.version || null;
    let checkpoint = checkpointObject
      ? decodeCheckpoint(checkpointObject.body, intent)
      : emptyCheckpoint(intent, now);
    const resumeExportedRowCount = checkpoint.exportedRowCount;
    const resumeLastAddress = checkpoint.lastAddress;
    if (!completion) {
      for (const part of checkpoint.parts) await verifyStoredPart(params.storage, part);
    }

    const universeHash = createHash('sha256');
    const sightingHash = createHash('sha256');
    const featureHash = createHash('sha256');
    let universeCount = 0;
    let sightingCount = 0;
    let featureCount = 0;
    let skipped = 0;
    let sawCheckpointBoundary = resumeLastAddress === null;
    let partsWritten = 0;
    let records: RelationshipInputRecord[] = [];
    let recordBytes = 0;
    const featureIterator = mergeRuns(runs.featureRuns, (feature) => `sighting:${feature.caseId}`)[Symbol.asyncIterator]();
    let nextFeature = await featureIterator.next();

    const flush = async () => {
      if (!records.length) return;
      if (partsWritten >= maxPartsPerRun || completion) {
        records = [];
        recordBytes = 0;
        return;
      }
      const built = buildRelationshipInputPart({
        binding: intent.binding,
        partNumber: checkpoint.nextPartNumber,
        records,
        limits: {
          maxRows: rowsPerPart,
          maxUncompressedBytes: targetUncompressedBytes,
          maxCompressedBytes: 32 * 1024 * 1024,
        },
      });
      await writeImmutable(params.storage, built.archiveBody, built.manifest.archiveKey, {
        contentType: built.manifest.archiveContentType,
        contentEncoding: built.manifest.archiveContentEncoding,
        cacheControl: 'private, max-age=31536000, immutable',
        contentLength: built.archiveBody.length,
      }, 'relationship_input_materialization_archive_immutable_conflict');
      await writeImmutable(params.storage, built.manifestBody, built.manifest.manifestKey, {
        contentType: 'application/json',
        cacheControl: 'private, max-age=31536000, immutable',
        contentLength: built.manifestBody.length,
      }, 'relationship_input_materialization_manifest_immutable_conflict');
      await verifyStoredPart(params.storage, built.manifest);
      checkpoint = {
        ...checkpoint,
        exportedRowCount: checkpoint.exportedRowCount + built.manifest.rowCount,
        nextPartNumber: checkpoint.nextPartNumber + 1,
        lastAddress: built.manifest.lastAddress,
        parts: [...checkpoint.parts, built.manifest],
        updatedAt: now().toISOString(),
      };
      checkpointVersion = await writeCheckpoint(
        params.storage,
        keys.materializationCheckpointKey,
        checkpoint,
        checkpointVersion,
      );
      partsWritten += 1;
      records = [];
      recordBytes = 0;
    };

    for await (const node of mergeRuns(runs.universeRuns, (value) => value.address)) {
      universeHash.update(`${node.address}\n`);
      universeCount += 1;
      let enrichment: ReturnType<typeof buildRelationshipInputFeatureEnrichment> | undefined;
      if (node.kind === 'sighting') {
        if (nextFeature.done) invalid('relationship_input_materialization_missing_feature');
        const expectedFeatureAddress = `sighting:${nextFeature.value.caseId}`;
        if (expectedFeatureAddress !== node.address) {
          invalid(expectedFeatureAddress < node.address
            ? 'relationship_input_materialization_orphan_feature'
            : 'relationship_input_materialization_missing_feature');
        }
        enrichment = buildRelationshipInputFeatureEnrichment(
          node,
          nextFeature.value,
          inputs.feature.corpus_version,
        );
        sightingHash.update(`${node.address}\n`);
        featureHash.update(`${node.address}\n`);
        sightingCount += 1;
        featureCount += 1;
        nextFeature = await featureIterator.next();
      }

      if (resumeLastAddress && node.address <= resumeLastAddress) {
        skipped += 1;
        if (node.address === resumeLastAddress) sawCheckpointBoundary = true;
        continue;
      }
      if (resumeLastAddress && !sawCheckpointBoundary) {
        invalid('relationship_input_materialization_checkpoint_address_missing');
      }
      if (completion || partsWritten >= maxPartsPerRun) continue;
      const record = extractRelationshipInputRecord(node, {
        binding: intent.binding,
        vectorPolicy: intent.extraction.vectorPolicy,
        ...(enrichment ? { enrichment } : {}),
      });
      const bytes = Buffer.byteLength(canonicalizeRelationshipInput(record), 'utf8') + 1;
      if (bytes > targetUncompressedBytes) invalid('relationship_input_materialization_record_too_large');
      if (records.length && (records.length >= rowsPerPart || recordBytes + bytes > targetUncompressedBytes)) {
        await flush();
      }
      if (partsWritten < maxPartsPerRun) {
        records.push(record);
        recordBytes += bytes;
      }
    }
    await flush();
    if (!nextFeature.done) invalid('relationship_input_materialization_orphan_feature');
    if (skipped !== resumeExportedRowCount || !sawCheckpointBoundary) {
      invalid('relationship_input_materialization_checkpoint_prefix_mismatch');
    }
    if (
      universeCount !== inputs.universe.expected.total
      || sightingCount !== inputs.universe.expected.byKind.sighting
      || featureCount !== inputs.feature.exported_row_count
    ) invalid('relationship_input_materialization_source_count_mismatch');

    const sourceReceipts: RelationshipInputSourceReceipts = normalizeSourceReceipts({
      universeAddressSetSha256: universeHash.digest('hex'),
      sightingAddressSetSha256: sightingHash.digest('hex'),
      featureAddressSetSha256: featureHash.digest('hex'),
      universeRecordCount: universeCount,
      sightingRecordCount: sightingCount,
      featureRecordCount: featureCount,
    });
    if (completion) {
      const snapshot = await verifyStoredSnapshot({
        storage: params.storage,
        completion,
        expectedReceipts: sourceReceipts,
      });
      return { status: 'already_complete' as const, intent, completion, snapshot };
    }
    if (checkpoint.sourceReceipts && !sourceReceiptsEqual(checkpoint.sourceReceipts, sourceReceipts)) {
      invalid('relationship_input_materialization_source_receipts_changed');
    }

    const isComplete = checkpoint.exportedRowCount === intent.binding.universeRecordCount;
    checkpoint = {
      ...checkpoint,
      sourceReceipts,
      finalizedAt: isComplete ? (checkpoint.finalizedAt || now().toISOString()) : null,
      updatedAt: now().toISOString(),
    };
    checkpointVersion = await writeCheckpoint(
      params.storage,
      keys.materializationCheckpointKey,
      checkpoint,
      checkpointVersion,
    );
    void checkpointVersion;
    if (!isComplete) {
      return {
        status: 'partial' as const,
        intent,
        checkpoint,
        remainingRows: intent.binding.universeRecordCount - checkpoint.exportedRowCount,
      };
    }

    const snapshot = buildRelationshipInputSnapshotManifest({
      binding: intent.binding,
      parts: checkpoint.parts,
      generatedAt: checkpoint.finalizedAt!,
    });
    const snapshotBody = canonicalBody(snapshot);
    await writeImmutable(params.storage, snapshotBody, keys.completionManifestKey, {
      contentType: 'application/json',
      cacheControl: 'private, max-age=31536000, immutable',
      contentLength: snapshotBody.length,
    }, 'relationship_input_materialization_snapshot_immutable_conflict');

    const withoutDigest: Omit<RelationshipInputMaterializationCompletion, 'completionDigest'> = {
      recordType: 'relationship_input_materialization_completion',
      materializerVersion: RELATIONSHIP_INPUT_MATERIALIZER_VERSION,
      inputIdentitySha256: intent.inputIdentitySha256,
      binding: intent.binding,
      feature: intent.feature,
      sourceReceipts,
      relationshipSnapshotManifestKey: keys.completionManifestKey,
      relationshipSnapshotManifestSha256: sha256(snapshotBody),
      relationshipSnapshotManifestDigest: snapshot.manifestDigest,
      relationshipArchiveSetSha256: snapshot.archiveSetSha256,
      rowCount: snapshot.rowCount,
      partCount: snapshot.partCount,
      completedAt: checkpoint.finalizedAt!,
    };
    const materializationCompletion: RelationshipInputMaterializationCompletion = {
      ...withoutDigest,
      completionDigest: relationshipInputSha256(completionWithoutDigest(withoutDigest)),
    };
    const materializationCompletionBody = canonicalBody(materializationCompletion);
    await writeImmutable(
      params.storage,
      materializationCompletionBody,
      keys.materializationCompletionManifestKey,
      {
        contentType: 'application/json',
        cacheControl: 'private, max-age=31536000, immutable',
        contentLength: materializationCompletionBody.length,
      },
      'relationship_input_materialization_completion_immutable_conflict',
    );
    const decodedCompletion = decodeRelationshipInputMaterializationCompletion(
      materializationCompletionBody,
      intent,
    );
    await verifyStoredSnapshot({
      storage: params.storage,
      completion: decodedCompletion,
      expectedReceipts: sourceReceipts,
    });
    return { status: 'complete' as const, intent, completion: decodedCompletion, snapshot };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};
