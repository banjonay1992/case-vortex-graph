import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  accountRelationshipInputRecords,
  assertRelationshipInputBinding,
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputAccounting,
  type RelationshipInputFactFamily,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

const DEFAULT_MAX_ROWS = 25_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const FACT_FAMILIES: RelationshipInputFactFamily[] = [
  'provenance', 'space_time', 'visual', 'behavioural', 'sensory', 'duration',
  'entity', 'site', 'narrative_pattern', 'contextual_explanation',
];
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;

export type RelationshipInputPartLimits = {
  maxRows: number;
  maxUncompressedBytes: number;
  maxCompressedBytes: number;
};

export type RelationshipInputPartSummary = {
  partNumber: number;
  archiveKey: string;
  manifestKey: string;
  rowCount: number;
  firstAddress: string;
  lastAddress: string;
  uncompressedBytes: number;
  compressedBytes: number;
  compressedSha256: string;
  recordSetSha256: string;
  accounting: RelationshipInputAccounting;
};

export type RelationshipInputPartManifest = RelationshipInputPartSummary & {
  recordType: 'relationship_input_part_manifest';
  schemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  archiveContentType: 'application/x-ndjson';
  archiveContentEncoding: 'gzip';
  claimDiscipline: typeof RELATIONSHIP_INPUT_CLAIM_DISCIPLINE;
};

export type RelationshipInputSnapshotManifest = {
  recordType: 'relationship_input_snapshot_manifest';
  schemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  partCount: number;
  rowCount: number;
  parts: RelationshipInputPartSummary[];
  accounting: RelationshipInputAccounting;
  archiveSetSha256: string;
  generatedAt: string;
  claimDiscipline: typeof RELATIONSHIP_INPUT_CLAIM_DISCIPLINE;
  manifestDigest: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function invalid(code: string): never {
  throw new Error(code);
}

const requireSafeCount = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

const requireSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(code);
  return value;
};

const claimDisciplineMatches = (value: unknown) => (
  isPlainObject(value)
  && value.semantics === RELATIONSHIP_INPUT_CLAIM_DISCIPLINE.semantics
  && value.extraordinaryOrigin === RELATIONSHIP_INPUT_CLAIM_DISCIPLINE.extraordinaryOrigin
  && value.notice === RELATIONSHIP_INPUT_CLAIM_DISCIPLINE.notice
);

const normalizedPrefix = (binding: RelationshipInputUniverseBinding) => {
  const checked = validateRelationshipInputBinding(binding);
  return `case-vortex/corpora/${checked.corpusVersion}/relationship-input-v2/${checked.snapshotId}/${checked.universeArchiveSetSha256}`;
};

export const getRelationshipInputPartKeys = (
  binding: RelationshipInputUniverseBinding,
  partNumber: number,
) => {
  if (!Number.isSafeInteger(partNumber) || partNumber < 0 || partNumber > 999_999) {
    invalid('relationship_input_part_number_invalid');
  }
  const part = String(partNumber).padStart(6, '0');
  const prefix = `${normalizedPrefix(binding)}/parts`;
  return {
    archiveKey: `${prefix}/part-${part}.ndjson.gz`,
    manifestKey: `${prefix}/part-${part}.manifest.json`,
  };
};

export const getRelationshipInputControlKeys = (binding: RelationshipInputUniverseBinding) => {
  const prefix = normalizedPrefix(binding);
  // Materialization control records are implementation-versioned separately
  // from the stable relationship-input-v2 snapshot. A failed earlier
  // materializer attempt must remain immutable without blocking a corrected
  // materializer from producing the same governed snapshot contract.
  const materializationPrefix = `${prefix}/materialization-v2`;
  return {
    materializationIntentKey: `${materializationPrefix}/_intent.json`,
    materializationCheckpointKey: `${materializationPrefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
    materializationCompletionManifestKey: `${materializationPrefix}/_complete.manifest.json`,
  };
};

const recordSetSha256 = (records: readonly RelationshipInputRecord[]) => relationshipInputSha256(
  records.map((record) => `${record.address}:${record.recordDigest}`).join('\n'),
);

const emptyAccounting = (): RelationshipInputAccounting => ({
  recordCount: 0,
  factCount: 0,
  factFamilyCounts: {
    provenance: 0,
    space_time: 0,
    visual: 0,
    behavioural: 0,
    sensory: 0,
    duration: 0,
    entity: 0,
    site: 0,
    narrative_pattern: 0,
    contextual_explanation: 0,
  },
  missingFactCount: 0,
  recordMissingFieldCount: 0,
  duplicateRecordCount: 0,
  crossReferenceCount: 0,
  sourceAssertionCounts: { independent: 0, dependent: 0, unknown: 0 },
  narrativeVectorCounts: { present: 0, missing: 0 },
  governedReferenceCounts: { entity: 0, site: 0 },
  contextualExplanationFactCount: 0,
});

const addAccounting = (
  target: RelationshipInputAccounting,
  value: RelationshipInputAccounting,
) => {
  target.recordCount += value.recordCount;
  target.factCount += value.factCount;
  target.missingFactCount += value.missingFactCount;
  target.recordMissingFieldCount += value.recordMissingFieldCount;
  target.duplicateRecordCount += value.duplicateRecordCount;
  target.crossReferenceCount += value.crossReferenceCount;
  target.contextualExplanationFactCount += value.contextualExplanationFactCount;
  for (const family of FACT_FAMILIES) target.factFamilyCounts[family] += value.factFamilyCounts[family];
  for (const classification of ['independent', 'dependent', 'unknown'] as const) {
    target.sourceAssertionCounts[classification] += value.sourceAssertionCounts[classification];
  }
  for (const status of ['present', 'missing'] as const) {
    target.narrativeVectorCounts[status] += value.narrativeVectorCounts[status];
  }
  for (const kind of ['entity', 'site'] as const) {
    target.governedReferenceCounts[kind] += value.governedReferenceCounts[kind];
  }
  return target;
};

const accountingMatches = (left: RelationshipInputAccounting, right: RelationshipInputAccounting) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

const validateAccounting = (value: unknown, code: string): RelationshipInputAccounting => {
  if (!isPlainObject(value) || !isPlainObject(value.factFamilyCounts)
    || !isPlainObject(value.sourceAssertionCounts) || !isPlainObject(value.narrativeVectorCounts)
    || !isPlainObject(value.governedReferenceCounts)) invalid(code);
  const accounting = emptyAccounting();
  accounting.recordCount = requireSafeCount(value.recordCount, code);
  accounting.factCount = requireSafeCount(value.factCount, code);
  accounting.missingFactCount = requireSafeCount(value.missingFactCount, code);
  accounting.recordMissingFieldCount = requireSafeCount(value.recordMissingFieldCount, code);
  accounting.duplicateRecordCount = requireSafeCount(value.duplicateRecordCount, code);
  accounting.crossReferenceCount = requireSafeCount(value.crossReferenceCount, code);
  accounting.contextualExplanationFactCount = requireSafeCount(value.contextualExplanationFactCount, code);
  for (const family of FACT_FAMILIES) accounting.factFamilyCounts[family] = requireSafeCount(value.factFamilyCounts[family], code);
  for (const classification of ['independent', 'dependent', 'unknown'] as const) {
    accounting.sourceAssertionCounts[classification] = requireSafeCount(value.sourceAssertionCounts[classification], code);
  }
  for (const status of ['present', 'missing'] as const) {
    accounting.narrativeVectorCounts[status] = requireSafeCount(value.narrativeVectorCounts[status], code);
  }
  for (const kind of ['entity', 'site'] as const) {
    accounting.governedReferenceCounts[kind] = requireSafeCount(value.governedReferenceCounts[kind], code);
  }
  if (
    Object.values(accounting.factFamilyCounts).reduce((sum, count) => sum + count, 0) !== accounting.factCount
    || accounting.contextualExplanationFactCount !== accounting.factFamilyCounts.contextual_explanation
    || Object.values(accounting.narrativeVectorCounts).reduce((sum, count) => sum + count, 0) !== accounting.recordCount
    || accounting.duplicateRecordCount > accounting.recordCount
    || accounting.missingFactCount > accounting.factCount
  ) invalid(code);
  return accounting;
};

const normalizePartSummary = (
  value: unknown,
  binding: RelationshipInputUniverseBinding,
): RelationshipInputPartSummary => {
  if (!isPlainObject(value)) invalid('relationship_input_part_manifest_invalid');
  const partNumber = requireSafeCount(value.partNumber, 'relationship_input_part_manifest_invalid');
  const expectedKeys = getRelationshipInputPartKeys(binding, partNumber);
  if (value.archiveKey !== expectedKeys.archiveKey || value.manifestKey !== expectedKeys.manifestKey) {
    invalid('relationship_input_part_keys_invalid');
  }
  const rowCount = requireSafeCount(value.rowCount, 'relationship_input_part_manifest_invalid', 1);
  const firstAddress = validateRelationshipInputAddress(value.firstAddress);
  const lastAddress = validateRelationshipInputAddress(value.lastAddress);
  if (!firstAddress || !lastAddress || firstAddress > lastAddress) invalid('relationship_input_part_address_bounds_invalid');
  const accounting = validateAccounting(value.accounting, 'relationship_input_part_accounting_invalid');
  if (accounting.recordCount !== rowCount) invalid('relationship_input_part_accounting_invalid');
  return {
    partNumber,
    archiveKey: expectedKeys.archiveKey,
    manifestKey: expectedKeys.manifestKey,
    rowCount,
    firstAddress,
    lastAddress,
    uncompressedBytes: requireSafeCount(value.uncompressedBytes, 'relationship_input_part_manifest_invalid', 1),
    compressedBytes: requireSafeCount(value.compressedBytes, 'relationship_input_part_manifest_invalid', 1),
    compressedSha256: requireSha(value.compressedSha256, 'relationship_input_part_manifest_invalid'),
    recordSetSha256: requireSha(value.recordSetSha256, 'relationship_input_part_manifest_invalid'),
    accounting,
  };
};

export const decodeRelationshipInputPartManifest = (
  input: Buffer | string | unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): RelationshipInputPartManifest => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      invalid('relationship_input_part_manifest_json_invalid');
    }
  }
  if (!isPlainObject(value)
    || value.recordType !== 'relationship_input_part_manifest'
    || value.schemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION
    || value.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || value.archiveContentType !== 'application/x-ndjson'
    || value.archiveContentEncoding !== 'gzip'
    || !claimDisciplineMatches(value.claimDiscipline)) {
    invalid('relationship_input_part_manifest_invalid');
  }
  const binding = validateRelationshipInputBinding(value.binding);
  if (expectedBinding) assertRelationshipInputBinding(binding, expectedBinding);
  const decoded: RelationshipInputPartManifest = {
    recordType: 'relationship_input_part_manifest',
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    ...normalizePartSummary(value, binding),
    archiveContentType: 'application/x-ndjson',
    archiveContentEncoding: 'gzip',
    claimDiscipline: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  };
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(decoded)) {
    invalid('relationship_input_part_manifest_non_canonical');
  }
  return decoded;
};

export const buildRelationshipInputPart = (params: {
  binding: RelationshipInputUniverseBinding;
  partNumber: number;
  records: readonly RelationshipInputRecord[];
  limits?: Partial<RelationshipInputPartLimits>;
}) => {
  const binding = validateRelationshipInputBinding(params.binding);
  const limits: RelationshipInputPartLimits = {
    maxRows: DEFAULT_MAX_ROWS,
    maxUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
    maxCompressedBytes: DEFAULT_MAX_COMPRESSED_BYTES,
    ...params.limits,
  };
  if (!params.records.length) invalid('relationship_input_part_empty');
  if (params.records.length > limits.maxRows) invalid('relationship_input_part_row_limit_exceeded');
  const records = params.records.map((record) => decodeRelationshipInputRecord(record, binding))
    .sort((left, right) => compareText(left.address, right.address));
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].address >= records[index].address) invalid('relationship_input_part_address_order_invalid');
  }
  const body = Buffer.from(records.map((record) => `${canonicalizeRelationshipInput(record)}\n`).join(''), 'utf8');
  if (body.length > limits.maxUncompressedBytes) invalid('relationship_input_part_uncompressed_limit_exceeded');
  const archiveBody = gzipSync(body, { level: 6 });
  if (archiveBody.length > limits.maxCompressedBytes) invalid('relationship_input_part_compressed_limit_exceeded');
  const keys = getRelationshipInputPartKeys(binding, params.partNumber);
  const manifest: RelationshipInputPartManifest = {
    recordType: 'relationship_input_part_manifest',
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    partNumber: params.partNumber,
    ...keys,
    archiveContentType: 'application/x-ndjson',
    archiveContentEncoding: 'gzip',
    rowCount: records.length,
    firstAddress: records[0].address,
    lastAddress: records[records.length - 1].address,
    uncompressedBytes: body.length,
    compressedBytes: archiveBody.length,
    compressedSha256: createHash('sha256').update(archiveBody).digest('hex'),
    recordSetSha256: recordSetSha256(records),
    accounting: accountRelationshipInputRecords(records, binding),
    claimDiscipline: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  };
  return {
    records,
    archiveBody,
    manifest,
    manifestBody: Buffer.from(`${canonicalizeRelationshipInput(manifest)}\n`, 'utf8'),
  };
};

export const decodeRelationshipInputPart = (
  archiveBody: Buffer,
  manifestInput: RelationshipInputPartManifest | Buffer | string,
  expectedBinding?: RelationshipInputUniverseBinding,
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
) => {
  const manifest = decodeRelationshipInputPartManifest(manifestInput, expectedBinding);
  if (archiveBody.length !== manifest.compressedBytes
    || createHash('sha256').update(archiveBody).digest('hex') !== manifest.compressedSha256) {
    invalid('relationship_input_part_compressed_receipt_mismatch');
  }
  let body: Buffer;
  try {
    body = gunzipSync(archiveBody, { maxOutputLength: maxUncompressedBytes });
  } catch {
    return invalid('relationship_input_part_gzip_invalid');
  }
  if (body.length !== manifest.uncompressedBytes || !body.length || body[body.length - 1] !== 0x0a) {
    invalid('relationship_input_part_uncompressed_receipt_mismatch');
  }
  const lines = body.toString('utf8').slice(0, -1).split('\n');
  if (lines.some((line) => !line.length)) invalid('relationship_input_part_ndjson_invalid');
  const records = lines.map((line) => decodeRelationshipInputRecord(line, manifest.binding));
  if (records.length !== manifest.rowCount) invalid('relationship_input_part_row_count_mismatch');
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].address >= records[index].address) invalid('relationship_input_part_address_order_invalid');
  }
  if (records[0]?.address !== manifest.firstAddress || records.at(-1)?.address !== manifest.lastAddress) {
    invalid('relationship_input_part_address_bounds_mismatch');
  }
  if (recordSetSha256(records) !== manifest.recordSetSha256) invalid('relationship_input_part_record_set_mismatch');
  const accounting = accountRelationshipInputRecords(records, manifest.binding);
  if (!accountingMatches(accounting, manifest.accounting)) invalid('relationship_input_part_accounting_mismatch');
  return { records, manifest, accounting };
};

const archiveSetSha256 = (parts: readonly RelationshipInputPartSummary[]) => relationshipInputSha256(
  [...parts].sort((left, right) => left.partNumber - right.partNumber)
    .map((part) => `${part.partNumber}:${part.compressedSha256}:${part.recordSetSha256}`)
    .join('\n'),
);

const validatePartSequence = (parts: readonly RelationshipInputPartSummary[]) => {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.partNumber !== index) invalid('relationship_input_part_sequence_invalid');
    if (index && parts[index - 1].lastAddress >= part.firstAddress) invalid('relationship_input_part_address_overlap');
  }
};

const manifestWithoutDigest = (manifest: Omit<RelationshipInputSnapshotManifest, 'manifestDigest'>) => manifest;

export const buildRelationshipInputSnapshotManifest = (params: {
  binding: RelationshipInputUniverseBinding;
  parts: readonly RelationshipInputPartManifest[];
  generatedAt: string;
}): RelationshipInputSnapshotManifest => {
  const binding = validateRelationshipInputBinding(params.binding);
  const generatedAt = new Date(params.generatedAt);
  if (!Number.isFinite(generatedAt.getTime()) || generatedAt.toISOString() !== params.generatedAt) {
    invalid('relationship_input_snapshot_generated_at_invalid');
  }
  const parts = params.parts.map((part) => {
    const decoded = decodeRelationshipInputPartManifest(part, binding);
    return normalizePartSummary(decoded, binding);
  }).sort((left, right) => left.partNumber - right.partNumber);
  validatePartSequence(parts);
  const accounting = parts.reduce((total, part) => addAccounting(total, part.accounting), emptyAccounting());
  if (accounting.recordCount !== binding.universeRecordCount) invalid('relationship_input_snapshot_incomplete');
  const withoutDigest: Omit<RelationshipInputSnapshotManifest, 'manifestDigest'> = {
    recordType: 'relationship_input_snapshot_manifest',
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    partCount: parts.length,
    rowCount: accounting.recordCount,
    parts,
    accounting,
    archiveSetSha256: archiveSetSha256(parts),
    generatedAt: params.generatedAt,
    claimDiscipline: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  };
  return { ...withoutDigest, manifestDigest: relationshipInputSha256(manifestWithoutDigest(withoutDigest)) };
};

export const decodeRelationshipInputSnapshotManifest = (
  input: Buffer | string | unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): RelationshipInputSnapshotManifest => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      invalid('relationship_input_snapshot_manifest_json_invalid');
    }
  }
  if (!isPlainObject(value)
    || value.recordType !== 'relationship_input_snapshot_manifest'
    || value.schemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION
    || value.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !Array.isArray(value.parts)
    || !claimDisciplineMatches(value.claimDiscipline)) {
    invalid('relationship_input_snapshot_manifest_invalid');
  }
  const binding = validateRelationshipInputBinding(value.binding);
  if (expectedBinding) assertRelationshipInputBinding(binding, expectedBinding);
  const rebuilt = buildRelationshipInputSnapshotManifest({
    binding,
    parts: value.parts.map((part) => ({
      recordType: 'relationship_input_part_manifest',
      schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
      binding,
      archiveContentType: 'application/x-ndjson',
      archiveContentEncoding: 'gzip',
      claimDiscipline: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
      ...normalizePartSummary(part, binding),
    })),
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
  });
  if (
    value.partCount !== rebuilt.partCount
    || value.rowCount !== rebuilt.rowCount
    || value.archiveSetSha256 !== rebuilt.archiveSetSha256
    || value.manifestDigest !== rebuilt.manifestDigest
    || !accountingMatches(validateAccounting(value.accounting, 'relationship_input_snapshot_accounting_invalid'), rebuilt.accounting)
    || canonicalizeRelationshipInput(value.parts) !== canonicalizeRelationshipInput(rebuilt.parts)
  ) invalid('relationship_input_snapshot_manifest_integrity_invalid');
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(rebuilt)) {
    invalid('relationship_input_snapshot_manifest_non_canonical');
  }
  return rebuilt;
};
