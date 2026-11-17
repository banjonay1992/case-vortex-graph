import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
} from './contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
  decodeContextualRelationshipCalibrationArtifact,
  serializeContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationTrustPolicy,
} from './contextualRelationshipCalibration';
import type { RelationshipInputUniverseBinding } from './relationshipInputSnapshot';

export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION = 'case-graph-contextual-relationship-calibration-archive-v1' as const;

export type ContextualRelationshipCalibrationArchiveReceipt = {
  recordType: 'contextual_relationship_calibration_archive_receipt';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION;
  calibrationSchemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  binding: RelationshipInputUniverseBinding;
  calibrationReceiptId: string;
  calibrationReceiptSha256: string;
  artifactDigest: string;
  archiveKey: string;
  receiptKey: string;
  archiveContentType: 'application/json';
  archiveContentEncoding: 'gzip';
  uncompressedBytes: number;
  uncompressedSha256: string;
  compressedBytes: number;
  compressedSha256: string;
  archiveReceiptDigest: string;
};

export type ContextualRelationshipCalibrationArchiveObject = {
  artifact: ContextualRelationshipCalibrationArtifact;
  archiveBody: Buffer;
  receipt: ContextualRelationshipCalibrationArchiveReceipt;
  receiptBody: Buffer;
};

const SHA256 = /^[a-f0-9]{64}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function invalid(code: string): never { throw new Error(code); }
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!plain(value)) invalid(code);
  const actual = Object.keys(value).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};
const bytesSha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const receiptWithoutDigest = (
  receipt: Omit<ContextualRelationshipCalibrationArchiveReceipt, 'archiveReceiptDigest'>,
) => receipt;
const keysFromIdentity = (snapshotId: string, coreSha256: string) => {
  const prefix = `case-vortex/calibration/contextual/v1/${snapshotId}/${coreSha256}`;
  return { archiveKey: `${prefix}/artifact.json.gz`, receiptKey: `${prefix}/archive-receipt.json` };
};

export const getContextualRelationshipCalibrationArchiveKeys = (
  artifactInput: ContextualRelationshipCalibrationArtifact,
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy,
) => {
  const artifact = decodeContextualRelationshipCalibrationArtifact(
    artifactInput,
    artifactInput.lineage.binding,
    expectedTrustPolicy,
  );
  return keysFromIdentity(artifact.lineage.binding.snapshotId, artifact.calibrationCoreSha256);
};

export const buildContextualRelationshipCalibrationArchiveObject = (
  artifactInput: ContextualRelationshipCalibrationArtifact,
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy,
): ContextualRelationshipCalibrationArchiveObject => {
  const artifact = decodeContextualRelationshipCalibrationArtifact(
    artifactInput,
    artifactInput.lineage.binding,
    expectedTrustPolicy,
  );
  const keys = getContextualRelationshipCalibrationArchiveKeys(artifact, expectedTrustPolicy);
  const uncompressed = Buffer.from(serializeContextualRelationshipCalibrationArtifact(artifact, expectedTrustPolicy));
  const archiveBody = gzipSync(uncompressed, { level: 9 });
  const withoutDigest: Omit<ContextualRelationshipCalibrationArchiveReceipt, 'archiveReceiptDigest'> = {
    recordType: 'contextual_relationship_calibration_archive_receipt',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION,
    calibrationSchemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    binding: artifact.lineage.binding,
    calibrationReceiptId: artifact.receipt.receiptId,
    calibrationReceiptSha256: artifact.receipt.receiptSha256,
    artifactDigest: artifact.artifactDigest,
    ...keys,
    archiveContentType: 'application/json',
    archiveContentEncoding: 'gzip',
    uncompressedBytes: uncompressed.byteLength,
    uncompressedSha256: bytesSha256(uncompressed),
    compressedBytes: archiveBody.byteLength,
    compressedSha256: bytesSha256(archiveBody),
  };
  const receipt = {
    ...withoutDigest,
    archiveReceiptDigest: contextualExplanationSha256(receiptWithoutDigest(withoutDigest)),
  };
  return {
    artifact,
    archiveBody,
    receipt,
    receiptBody: Buffer.from(`${canonicalizeContextualExplanation(receipt)}\n`),
  };
};

export const decodeContextualRelationshipCalibrationArchiveReceipt = (
  input: unknown,
): ContextualRelationshipCalibrationArchiveReceipt => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try { value = JSON.parse(String(input)); } catch { invalid('contextual_calibration_archive_receipt_json_invalid'); }
  }
  const receipt = exact(value, [
    'recordType', 'schemaVersion', 'calibrationSchemaVersion', 'binding', 'calibrationReceiptId',
    'calibrationReceiptSha256', 'artifactDigest', 'archiveKey', 'receiptKey', 'archiveContentType',
    'archiveContentEncoding', 'uncompressedBytes', 'uncompressedSha256', 'compressedBytes',
    'compressedSha256', 'archiveReceiptDigest',
  ], 'contextual_calibration_archive_receipt_invalid');
  if (receipt.recordType !== 'contextual_relationship_calibration_archive_receipt'
    || receipt.schemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION
    || receipt.calibrationSchemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION
    || receipt.archiveContentType !== 'application/json'
    || receipt.archiveContentEncoding !== 'gzip'
    || typeof receipt.calibrationReceiptId !== 'string'
    || !/^contextual-calibration:[a-f0-9]{64}$/.test(receipt.calibrationReceiptId)
    || typeof receipt.archiveKey !== 'string' || !receipt.archiveKey.length
    || typeof receipt.receiptKey !== 'string' || !receipt.receiptKey.length) {
    invalid('contextual_calibration_archive_receipt_invalid');
  }
  for (const field of [
    'calibrationReceiptSha256', 'artifactDigest', 'uncompressedSha256', 'compressedSha256', 'archiveReceiptDigest',
  ] as const) if (typeof receipt[field] !== 'string' || !SHA256.test(receipt[field])) {
    invalid('contextual_calibration_archive_receipt_invalid');
  }
  for (const field of ['uncompressedBytes', 'compressedBytes'] as const) if (!Number.isSafeInteger(receipt[field])
    || Number(receipt[field]) < 1) invalid('contextual_calibration_archive_receipt_invalid');
  const typed = receipt as unknown as ContextualRelationshipCalibrationArchiveReceipt;
  const { archiveReceiptDigest: _digest, ...withoutDigest } = typed;
  if (typed.archiveReceiptDigest !== contextualExplanationSha256(receiptWithoutDigest(withoutDigest))) {
    invalid('contextual_calibration_archive_receipt_digest_mismatch');
  }
  const expectedKeys = keysFromIdentity(
    typed.binding.snapshotId,
    typed.calibrationReceiptId.slice('contextual-calibration:'.length),
  );
  if (typed.archiveKey !== expectedKeys.archiveKey || typed.receiptKey !== expectedKeys.receiptKey) {
    invalid('contextual_calibration_archive_key_mismatch');
  }
  return typed;
};

export const decodeContextualRelationshipCalibrationArchiveObject = (params: {
  archiveBody: Buffer;
  receiptInput: unknown;
  expectedBinding: RelationshipInputUniverseBinding;
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy;
}): ContextualRelationshipCalibrationArchiveObject => {
  const receipt = decodeContextualRelationshipCalibrationArchiveReceipt(params.receiptInput);
  if (params.archiveBody.byteLength !== receipt.compressedBytes
    || bytesSha256(params.archiveBody) !== receipt.compressedSha256) invalid('contextual_calibration_archive_compressed_mismatch');
  let uncompressed: Buffer;
  try { uncompressed = gunzipSync(params.archiveBody); } catch { invalid('contextual_calibration_archive_gzip_invalid'); }
  if (uncompressed.byteLength !== receipt.uncompressedBytes
    || bytesSha256(uncompressed) !== receipt.uncompressedSha256
    || uncompressed.at(-1) !== 0x0a) invalid('contextual_calibration_archive_uncompressed_mismatch');
  const artifact = decodeContextualRelationshipCalibrationArtifact(
    uncompressed,
    params.expectedBinding,
    params.expectedTrustPolicy,
  );
  const keys = getContextualRelationshipCalibrationArchiveKeys(artifact, params.expectedTrustPolicy);
  if (artifact.artifactDigest !== receipt.artifactDigest
    || artifact.receipt.receiptId !== receipt.calibrationReceiptId
    || artifact.receipt.receiptSha256 !== receipt.calibrationReceiptSha256
    || canonicalizeContextualExplanation(artifact.lineage.binding) !== canonicalizeContextualExplanation(receipt.binding)
    || keys.archiveKey !== receipt.archiveKey || keys.receiptKey !== receipt.receiptKey) {
    invalid('contextual_calibration_archive_artifact_mismatch');
  }
  const canonical = buildContextualRelationshipCalibrationArchiveObject(artifact, params.expectedTrustPolicy);
  if (!canonical.archiveBody.equals(params.archiveBody)
    || !canonical.receiptBody.equals(Buffer.from(`${canonicalizeContextualExplanation(receipt)}\n`))) {
    invalid('contextual_calibration_archive_noncanonical');
  }
  return canonical;
};

const writeImmutable = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  body: Buffer,
  options: { contentType: string; contentEncoding?: string },
) => {
  try {
    const result = await storage.uploadFileConditional(body, key, {
      ...options,
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: body.byteLength,
    }, { ifAbsent: true });
    if (result.status === 'written') return 'written' as const;
  } catch (error) {
    const existing = await storage.readObject(key);
    if (existing?.equals(body)) return 'reused' as const;
    throw error;
  }
  const existing = await storage.readObject(key);
  if (!existing?.equals(body)) invalid('contextual_calibration_archive_immutable_conflict');
  return 'reused' as const;
};

export const writeContextualRelationshipCalibrationArchive = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  artifact: ContextualRelationshipCalibrationArtifact;
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy;
}) => {
  const object = buildContextualRelationshipCalibrationArchiveObject(params.artifact, params.expectedTrustPolicy);
  const archiveStatus = await writeImmutable(params.storage, object.receipt.archiveKey, object.archiveBody, {
    contentType: 'application/json', contentEncoding: 'gzip',
  });
  const receiptStatus = await writeImmutable(params.storage, object.receipt.receiptKey, object.receiptBody, {
    contentType: 'application/json',
  });
  return {
    archiveKey: object.receipt.archiveKey,
    receiptKey: object.receipt.receiptKey,
    artifactDigest: object.artifact.artifactDigest,
    calibrationReceipt: object.artifact.receipt as ContextualRelationshipCalibrationReceipt,
    archiveStatus,
    receiptStatus,
  };
};

export const readContextualRelationshipCalibrationArchive = async (params: {
  storage: Pick<CaseGraphConditionalArchiveStorage, 'readObject'>;
  receiptKey: string;
  expectedBinding: RelationshipInputUniverseBinding;
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy;
}) => {
  const receiptBody = await params.storage.readObject(params.receiptKey);
  if (!receiptBody) invalid('contextual_calibration_archive_receipt_missing');
  const receipt = decodeContextualRelationshipCalibrationArchiveReceipt(receiptBody);
  if (receipt.receiptKey !== params.receiptKey) invalid('contextual_calibration_archive_key_mismatch');
  const archiveBody = await params.storage.readObject(receipt.archiveKey);
  if (!archiveBody) invalid('contextual_calibration_archive_artifact_missing');
  return decodeContextualRelationshipCalibrationArchiveObject({
    archiveBody,
    receiptInput: receipt,
    expectedBinding: params.expectedBinding,
    expectedTrustPolicy: params.expectedTrustPolicy,
  });
};
