import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
  decodeTypedRelationshipCalibrationArtifact,
  serializeTypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationReceipt,
  type TypedRelationshipCalibrationTrustPolicy,
} from './typedRelationshipCalibration';

export const TYPED_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION = 'case-graph-typed-relationship-calibration-archive-v1' as const;

export type TypedRelationshipCalibrationArchiveReceipt = {
  recordType: 'typed_relationship_calibration_archive_receipt';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION;
  calibrationSchemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
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

export type TypedRelationshipCalibrationArchiveObject = {
  artifact: TypedRelationshipCalibrationArtifact;
  archiveBody: Buffer;
  receipt: TypedRelationshipCalibrationArchiveReceipt;
  receiptBody: Buffer;
};

export type TypedRelationshipCalibrationArchiveWriteResult = {
  archiveKey: string;
  receiptKey: string;
  artifactDigest: string;
  calibrationReceipt: TypedRelationshipCalibrationReceipt;
  archiveStatus: 'written' | 'reused';
  receiptStatus: 'written' | 'reused';
};

const SHA256 = /^[a-f0-9]{64}$/;
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value: unknown, keys: readonly string[], code: string) => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};

const byteSha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const archiveReceiptWithoutDigest = (
  receipt: Omit<TypedRelationshipCalibrationArchiveReceipt, 'archiveReceiptDigest'>,
) => receipt;

export const getTypedRelationshipCalibrationArchiveKeys = (
  artifactInput: TypedRelationshipCalibrationArtifact,
  expectedTrustPolicy: TypedRelationshipCalibrationTrustPolicy,
) => {
  const artifact = decodeTypedRelationshipCalibrationArtifact(
    artifactInput,
    artifactInput.lineage.binding,
    expectedTrustPolicy,
  );
  const prefix = [
    'case-vortex',
    'calibration',
    'v1',
    artifact.lineage.binding.snapshotId,
    artifact.calibrationCoreSha256,
  ].join('/');
  return {
    archiveKey: `${prefix}/artifact.json.gz`,
    receiptKey: `${prefix}/archive-receipt.json`,
  };
};

export const buildTypedRelationshipCalibrationArchiveObject = (
  artifactInput: TypedRelationshipCalibrationArtifact,
  expectedTrustPolicy: TypedRelationshipCalibrationTrustPolicy,
): TypedRelationshipCalibrationArchiveObject => {
  const artifact = decodeTypedRelationshipCalibrationArtifact(
    artifactInput,
    artifactInput.lineage.binding,
    expectedTrustPolicy,
  );
  const { archiveKey, receiptKey } = getTypedRelationshipCalibrationArchiveKeys(artifact, expectedTrustPolicy);
  const uncompressed = Buffer.from(serializeTypedRelationshipCalibrationArtifact(artifact, expectedTrustPolicy), 'utf8');
  const archiveBody = gzipSync(uncompressed, { level: 9 });
  const withoutDigest: Omit<TypedRelationshipCalibrationArchiveReceipt, 'archiveReceiptDigest'> = {
    recordType: 'typed_relationship_calibration_archive_receipt',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION,
    calibrationSchemaVersion: TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    binding: artifact.lineage.binding,
    calibrationReceiptId: artifact.receipt.receiptId,
    calibrationReceiptSha256: artifact.receipt.receiptSha256,
    artifactDigest: artifact.artifactDigest,
    archiveKey,
    receiptKey,
    archiveContentType: 'application/json',
    archiveContentEncoding: 'gzip',
    uncompressedBytes: uncompressed.byteLength,
    uncompressedSha256: byteSha256(uncompressed),
    compressedBytes: archiveBody.byteLength,
    compressedSha256: byteSha256(archiveBody),
  };
  const receipt: TypedRelationshipCalibrationArchiveReceipt = {
    ...withoutDigest,
    archiveReceiptDigest: relationshipInputSha256(archiveReceiptWithoutDigest(withoutDigest)),
  };
  return {
    artifact,
    archiveBody,
    receipt,
    receiptBody: Buffer.from(`${canonicalizeRelationshipInput(receipt)}\n`, 'utf8'),
  };
};

export const decodeTypedRelationshipCalibrationArchiveReceipt = (
  input: unknown,
): TypedRelationshipCalibrationArchiveReceipt => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(String(input));
    } catch {
      invalid('typed_relationship_calibration_archive_receipt_json_invalid');
    }
  }
  const receipt = exactKeys(value, [
    'recordType', 'schemaVersion', 'calibrationSchemaVersion', 'binding',
    'calibrationReceiptId', 'calibrationReceiptSha256', 'artifactDigest', 'archiveKey',
    'receiptKey', 'archiveContentType', 'archiveContentEncoding', 'uncompressedBytes',
    'uncompressedSha256', 'compressedBytes', 'compressedSha256', 'archiveReceiptDigest',
  ], 'typed_relationship_calibration_archive_receipt_invalid');
  if (receipt.recordType !== 'typed_relationship_calibration_archive_receipt'
    || receipt.schemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_ARCHIVE_VERSION
    || receipt.calibrationSchemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION
    || receipt.archiveContentType !== 'application/json'
    || receipt.archiveContentEncoding !== 'gzip'
    || typeof receipt.calibrationReceiptId !== 'string'
    || !/^typed-calibration:[a-f0-9]{64}$/.test(receipt.calibrationReceiptId)
    || typeof receipt.archiveKey !== 'string'
    || !receipt.archiveKey.length
    || typeof receipt.receiptKey !== 'string'
    || !receipt.receiptKey.length
  ) invalid('typed_relationship_calibration_archive_receipt_invalid');
  for (const digest of [
    receipt.calibrationReceiptSha256,
    receipt.artifactDigest,
    receipt.uncompressedSha256,
    receipt.compressedSha256,
    receipt.archiveReceiptDigest,
  ]) if (typeof digest !== 'string' || !SHA256.test(digest)) {
    invalid('typed_relationship_calibration_archive_receipt_invalid');
  }
  for (const count of [receipt.uncompressedBytes, receipt.compressedBytes]) {
    if (!Number.isSafeInteger(count) || Number(count) < 1) {
      invalid('typed_relationship_calibration_archive_receipt_invalid');
    }
  }
  const typed = receipt as unknown as TypedRelationshipCalibrationArchiveReceipt;
  const { archiveReceiptDigest: _archiveReceiptDigest, ...withoutDigest } = typed;
  if (typed.archiveReceiptDigest !== relationshipInputSha256(archiveReceiptWithoutDigest(withoutDigest))) {
    invalid('typed_relationship_calibration_archive_receipt_digest_mismatch');
  }
  const artifactIdentity = {
    lineage: { binding: typed.binding },
    calibrationCoreSha256: typed.calibrationReceiptId.slice('typed-calibration:'.length),
  } as TypedRelationshipCalibrationArtifact;
  const expectedKeys = getKeysFromIdentity(
    typed.binding.snapshotId,
    artifactIdentity.calibrationCoreSha256,
  );
  if (typed.archiveKey !== expectedKeys.archiveKey || typed.receiptKey !== expectedKeys.receiptKey) {
    invalid('typed_relationship_calibration_archive_key_mismatch');
  }
  return typed;
};

const getKeysFromIdentity = (snapshotId: string, calibrationCoreSha256: string) => {
  const prefix = `case-vortex/calibration/v1/${snapshotId}/${calibrationCoreSha256}`;
  return { archiveKey: `${prefix}/artifact.json.gz`, receiptKey: `${prefix}/archive-receipt.json` };
};

export const decodeTypedRelationshipCalibrationArchiveObject = (params: {
  archiveBody: Buffer;
  receiptInput: unknown;
  expectedBinding?: RelationshipInputUniverseBinding;
  expectedTrustPolicy: TypedRelationshipCalibrationTrustPolicy;
}): TypedRelationshipCalibrationArchiveObject => {
  const receipt = decodeTypedRelationshipCalibrationArchiveReceipt(params.receiptInput);
  if (params.archiveBody.byteLength !== receipt.compressedBytes
    || byteSha256(params.archiveBody) !== receipt.compressedSha256) {
    invalid('typed_relationship_calibration_archive_compressed_mismatch');
  }
  let uncompressed: Buffer;
  try {
    uncompressed = gunzipSync(params.archiveBody);
  } catch {
    return invalid('typed_relationship_calibration_archive_gzip_invalid');
  }
  if (uncompressed.byteLength !== receipt.uncompressedBytes
    || byteSha256(uncompressed) !== receipt.uncompressedSha256) {
    invalid('typed_relationship_calibration_archive_uncompressed_mismatch');
  }
  if (uncompressed.at(-1) !== 0x0a) invalid('typed_relationship_calibration_archive_newline_missing');
  const artifact = decodeTypedRelationshipCalibrationArtifact(
    uncompressed,
    params.expectedBinding,
    params.expectedTrustPolicy,
  );
  const keys = getTypedRelationshipCalibrationArchiveKeys(artifact, params.expectedTrustPolicy);
  if (artifact.artifactDigest !== receipt.artifactDigest
    || artifact.receipt.receiptId !== receipt.calibrationReceiptId
    || artifact.receipt.receiptSha256 !== receipt.calibrationReceiptSha256
    || canonicalizeRelationshipInput(artifact.lineage.binding) !== canonicalizeRelationshipInput(receipt.binding)
    || keys.archiveKey !== receipt.archiveKey
    || keys.receiptKey !== receipt.receiptKey) {
    invalid('typed_relationship_calibration_archive_artifact_mismatch');
  }
  const canonical = buildTypedRelationshipCalibrationArchiveObject(artifact, params.expectedTrustPolicy);
  if (!canonical.archiveBody.equals(params.archiveBody)
    || !canonical.receiptBody.equals(Buffer.from(`${canonicalizeRelationshipInput(receipt)}\n`, 'utf8'))) {
    invalid('typed_relationship_calibration_archive_noncanonical');
  }
  return canonical;
};

const writeImmutable = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  body: Buffer,
  options: { contentType: string; contentEncoding?: string },
) => {
  const upload = async () => storage.uploadFileConditional(body, key, {
    ...options,
    cacheControl: 'public, max-age=31536000, immutable',
    contentLength: body.byteLength,
  }, { ifAbsent: true });
  try {
    const result = await upload();
    if (result.status === 'written') return 'written' as const;
  } catch (error) {
    const existingAfterError = await storage.readObject(key);
    if (existingAfterError?.equals(body)) return 'reused' as const;
    throw error;
  }
  const existing = await storage.readObject(key);
  if (!existing?.equals(body)) invalid('typed_relationship_calibration_archive_immutable_conflict');
  return 'reused' as const;
};

export const writeTypedRelationshipCalibrationArchive = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  artifact: TypedRelationshipCalibrationArtifact;
  expectedTrustPolicy: TypedRelationshipCalibrationTrustPolicy;
}): Promise<TypedRelationshipCalibrationArchiveWriteResult> => {
  const object = buildTypedRelationshipCalibrationArchiveObject(params.artifact, params.expectedTrustPolicy);
  const archiveStatus = await writeImmutable(
    params.storage,
    object.receipt.archiveKey,
    object.archiveBody,
    { contentType: 'application/json', contentEncoding: 'gzip' },
  );
  const receiptStatus = await writeImmutable(
    params.storage,
    object.receipt.receiptKey,
    object.receiptBody,
    { contentType: 'application/json' },
  );
  return {
    archiveKey: object.receipt.archiveKey,
    receiptKey: object.receipt.receiptKey,
    artifactDigest: object.artifact.artifactDigest,
    calibrationReceipt: object.artifact.receipt,
    archiveStatus,
    receiptStatus,
  };
};

export const readTypedRelationshipCalibrationArchive = async (params: {
  storage: Pick<CaseGraphConditionalArchiveStorage, 'readObject'>;
  receiptKey: string;
  expectedBinding?: RelationshipInputUniverseBinding;
  expectedTrustPolicy: TypedRelationshipCalibrationTrustPolicy;
}) => {
  const receiptBody = await params.storage.readObject(params.receiptKey);
  if (!receiptBody) invalid('typed_relationship_calibration_archive_receipt_missing');
  const receipt = decodeTypedRelationshipCalibrationArchiveReceipt(receiptBody);
  if (receipt.receiptKey !== params.receiptKey) invalid('typed_relationship_calibration_archive_key_mismatch');
  const archiveBody = await params.storage.readObject(receipt.archiveKey);
  if (!archiveBody) invalid('typed_relationship_calibration_archive_artifact_missing');
  return decodeTypedRelationshipCalibrationArchiveObject({
    archiveBody,
    receiptInput: receipt,
    expectedBinding: params.expectedBinding,
    expectedTrustPolicy: params.expectedTrustPolicy,
  });
};
