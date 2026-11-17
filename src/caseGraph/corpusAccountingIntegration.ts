import { createHash } from 'node:crypto';

import {
  CASE_VORTEX_CORPUS_ACCOUNTING_VERSION,
  CASE_VORTEX_EXCLUSION_REASONS,
  auditCaseVortexCorpusAccounting,
  type CaseVortexCorpusAccountingInput,
  type CaseVortexCorpusAccountingReceipt,
  type CaseVortexCorpusBinding,
  type CaseVortexCorpusRecord,
  type CaseVortexExcludedRecord,
  type CaseVortexKindCounts,
  type CaseVortexRepresentedRecord,
} from './corpusAccounting';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
  type EvidenceUniversePart,
} from './evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  evidenceUniverseAddress,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import {
  decodeEvidenceUniverseCompletion,
  decodeEvidenceUniverseNodePart,
} from './evidenceUniversePublicAccess';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  canonicalizeRelationshipInput,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  decodeRelationshipInputPart,
  decodeRelationshipInputSnapshotManifest,
  type RelationshipInputPartManifest,
  type RelationshipInputSnapshotManifest,
} from './relationshipInputArchive';

export const CASE_VORTEX_ADDRESS_LEDGER_VERSION = 'case-vortex-address-ledger-v1' as const;
export const CASE_VORTEX_ACCOUNTING_PUBLICATION_BINDING_VERSION =
  'case-vortex-accounting-publication-binding-v1' as const;

export type CaseVortexAddressLedgerStage = 'observation' | 'graph' | 'user_interface';

export type CaseVortexAccountingLedgerBinding = {
  corpusVersion: string;
  snapshotId: string;
  universeArchiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
  universeSchemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  universeLayoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  universeArchiveSetSha256: string;
  universeRecordCount: number;
  relationshipInputSchemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
  relationshipInputArchiveSetSha256: string;
  relationshipInputManifestDigest: string;
  relationshipInputRecordCount: number;
  policyVersion: string;
};

export type CaseVortexCapturedObservationRecord = {
  recordType: 'case_vortex_observation_address';
  status: 'captured';
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  address: string;
};

export type CaseVortexExcludedObservationRecord = {
  recordType: 'case_vortex_observation_address';
  status: 'excluded';
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  address: string;
  exclusion: CaseVortexExcludedRecord['exclusion'];
};

export type CaseVortexObservationAddressRecord =
  | CaseVortexCapturedObservationRecord
  | CaseVortexExcludedObservationRecord;

export type CaseVortexStageAddressRecord = {
  recordType: 'case_vortex_stage_address';
  stage: 'graph' | 'user_interface';
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  address: string;
  /**
   * The immutable address descriptor emitted by the stage. The accounting
   * layer hashes this value itself; a producer cannot provide its own pointer
   * digest and have it trusted.
   */
  artifact: unknown;
};

export type CaseVortexAddressLedgerRecord =
  | CaseVortexObservationAddressRecord
  | CaseVortexStageAddressRecord;

export type CaseVortexAddressLedgerPartSummary = {
  partNumber: number;
  rowCount: number;
  byKind: CaseVortexKindCounts;
  firstAddress: string;
  lastAddress: string;
  uncompressedBytes: number;
  uncompressedSha256: string;
  recordSetSha256: string;
};

export type CaseVortexAddressLedgerManifest = {
  recordType: 'case_vortex_address_ledger_manifest';
  schemaVersion: typeof CASE_VORTEX_ADDRESS_LEDGER_VERSION;
  stage: CaseVortexAddressLedgerStage;
  binding: CaseVortexAccountingLedgerBinding;
  /** Null until the UI ledger is generated from exact publication bytes. */
  publicationSha256: string | null;
  partCount: number;
  recordCount: number;
  byKind: CaseVortexKindCounts;
  parts: CaseVortexAddressLedgerPartSummary[];
  archiveSetSha256: string;
  generatedAt: string;
  manifestDigest: string;
};

export type CaseVortexAccountingPublicationBinding = {
  schemaVersion: typeof CASE_VORTEX_ACCOUNTING_PUBLICATION_BINDING_VERSION;
  corpusVersion: string;
  snapshotId: string;
  universe: {
    archiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
    schemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
    layoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
    archiveSetSha256: string;
    recordCount: number;
  };
  relationshipInput: {
    schemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
    archiveSetSha256: string;
    manifestDigest: string;
    recordCount: number;
  };
  policyVersion: string;
  graphAddressLedger: {
    schemaVersion: typeof CASE_VORTEX_ADDRESS_LEDGER_VERSION;
    stage: 'graph';
    manifestSha256: string;
    archiveSetSha256: string;
    recordCount: number;
    byKind: CaseVortexKindCounts;
  };
};

export type CaseVortexLedgerPartRecords<T extends CaseVortexAddressLedgerRecord> = {
  partNumber: number;
  records: Iterable<T> | AsyncIterable<T>;
};

export type CaseVortexEvidenceUniversePartArtifact = {
  kind: EvidenceUniverseNodeKind;
  partNumber: number;
  archiveBody: Buffer;
};

export type CaseVortexRelationshipInputPartArtifact = {
  partNumber: number;
  archiveBody: Buffer;
};

export type CaseVortexCorpusAccountingArtifactInput = {
  corpusVersion: string;
  universe: {
    completionBody: Buffer;
    parts: Iterable<CaseVortexEvidenceUniversePartArtifact>
      | AsyncIterable<CaseVortexEvidenceUniversePartArtifact>;
  };
  relationshipInput: {
    snapshotManifestBody: Buffer;
    parts: Iterable<CaseVortexRelationshipInputPartArtifact>
      | AsyncIterable<CaseVortexRelationshipInputPartArtifact>;
  };
  observationLedger: {
    manifestBody: Buffer;
    parts: Iterable<CaseVortexLedgerPartRecords<CaseVortexObservationAddressRecord>>
      | AsyncIterable<CaseVortexLedgerPartRecords<CaseVortexObservationAddressRecord>>;
  };
  graphPublicationManifestBody: Buffer;
  graphLedger: {
    manifestBody: Buffer;
    parts: Iterable<CaseVortexLedgerPartRecords<CaseVortexStageAddressRecord>>
      | AsyncIterable<CaseVortexLedgerPartRecords<CaseVortexStageAddressRecord>>;
  };
  userInterfaceLedger: {
    manifestBody: Buffer;
    parts: Iterable<CaseVortexLedgerPartRecords<CaseVortexStageAddressRecord>>
      | AsyncIterable<CaseVortexLedgerPartRecords<CaseVortexStageAddressRecord>>;
  };
};

export type CaseVortexCorpusAccountingArtifactResult = {
  input: CaseVortexCorpusAccountingInput;
  receipt: CaseVortexCorpusAccountingReceipt;
  receiptBody: Buffer;
  receiptSha256: string;
  graphPublicationSha256: string;
};

const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const REFERENCE = /^[^\u0000-\u001f\u007f]{1,500}$/;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value: unknown, required: readonly string[], optional: readonly string[] = []) => {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => hasOwn(value, key)) && keys.every((key) => allowed.has(key));
};

const canonicalJson = (value: unknown, seen: Set<object>): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('case_vortex_accounting_artifact_non_finite');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object' || Buffer.isBuffer(value)) {
    throw new Error('case_vortex_accounting_artifact_value_invalid');
  }
  if (seen.has(value)) throw new Error('case_vortex_accounting_artifact_cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
    if (!isPlainObject(value)) throw new Error('case_vortex_accounting_artifact_object_invalid');
    return `{${Object.keys(value).sort(compareText).map((key) => {
      const item = value[key];
      if (item === undefined) throw new Error('case_vortex_accounting_artifact_undefined');
      return `${JSON.stringify(key)}:${canonicalJson(item, seen)}`;
    }).join(',')}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalizeCaseVortexAccountingArtifact = (value: unknown) => canonicalJson(value, new Set<object>());

export const caseVortexAccountingArtifactSha256 = (value: unknown): string => createHash('sha256')
  .update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonicalizeCaseVortexAccountingArtifact(value))
  .digest('hex');

const emptyCounts = (): CaseVortexKindCounts => ({ sighting: 0, document: 0, photo: 0, video: 0 });
const countTotal = (counts: CaseVortexKindCounts) => KINDS.reduce((sum, kind) => sum + counts[kind], 0);
const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

const normalizeCounts = (value: unknown, code: string): CaseVortexKindCounts => {
  if (!exactKeys(value, KINDS)) throw new Error(code);
  const counts = value as unknown as CaseVortexKindCounts;
  if (KINDS.some((kind) => !validCount(counts[kind]))) throw new Error(code);
  return { sighting: counts.sighting, document: counts.document, photo: counts.photo, video: counts.video };
};

const normalizeTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') throw new Error(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(code);
  return value;
};

const parseJsonObject = (body: Buffer, code: string) => {
  if (!Buffer.isBuffer(body) || body.length < 2 || body.length > MAX_MANIFEST_BYTES) throw new Error(code);
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!isPlainObject(parsed)) throw new Error(code);
    return parsed;
  } catch {
    throw new Error(code);
  }
};

const normalizeAddressIdentity = (value: {
  kind: unknown;
  recordId: unknown;
  address: unknown;
}, code: string) => {
  if (!KINDS.includes(value.kind as EvidenceUniverseNodeKind)
    || typeof value.recordId !== 'string'
    || typeof value.address !== 'string') throw new Error(code);
  const kind = value.kind as EvidenceUniverseNodeKind;
  let address: string;
  try {
    address = evidenceUniverseAddress(kind, value.recordId);
  } catch {
    throw new Error(code);
  }
  if (address !== value.address || value.recordId !== address.slice(kind.length + 1)) throw new Error(code);
  return { kind, recordId: value.recordId, address };
};

export const decodeCaseVortexAccountingLedgerBinding = (value: unknown): CaseVortexAccountingLedgerBinding => {
  if (!exactKeys(value, [
    'corpusVersion', 'snapshotId', 'universeArchiveVersion', 'universeSchemaVersion',
    'universeLayoutVersion', 'universeArchiveSetSha256', 'universeRecordCount',
    'relationshipInputSchemaVersion', 'relationshipInputArchiveSetSha256',
    'relationshipInputManifestDigest', 'relationshipInputRecordCount', 'policyVersion',
  ])) throw new Error('case_vortex_accounting_ledger_binding_invalid');
  const binding = value as unknown as CaseVortexAccountingLedgerBinding;
  if (!VERSION.test(binding.corpusVersion)
    || !UUID.test(binding.snapshotId)
    || binding.universeArchiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || binding.universeSchemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || binding.universeLayoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || !SHA256.test(binding.universeArchiveSetSha256)
    || !validCount(binding.universeRecordCount)
    || binding.relationshipInputSchemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION
    || !SHA256.test(binding.relationshipInputArchiveSetSha256)
    || !SHA256.test(binding.relationshipInputManifestDigest)
    || !validCount(binding.relationshipInputRecordCount)
    || !VERSION.test(binding.policyVersion)
    || binding.universeRecordCount !== binding.relationshipInputRecordCount) {
    throw new Error('case_vortex_accounting_ledger_binding_invalid');
  }
  return {
    ...binding,
  };
};

const sameLedgerBinding = (
  left: CaseVortexAccountingLedgerBinding,
  right: CaseVortexAccountingLedgerBinding,
) => canonicalizeCaseVortexAccountingArtifact(left) === canonicalizeCaseVortexAccountingArtifact(right);

const normalizeExclusion = (value: unknown): CaseVortexExcludedRecord['exclusion'] => {
  if (!exactKeys(value, ['reason', 'policyRule', 'evidenceReference'])) {
    throw new Error('case_vortex_observation_exclusion_invalid');
  }
  const exclusion = value as unknown as CaseVortexExcludedRecord['exclusion'];
  if (!CASE_VORTEX_EXCLUSION_REASONS.includes(exclusion.reason)
    || !VERSION.test(exclusion.policyRule)
    || !REFERENCE.test(exclusion.evidenceReference)) {
    throw new Error('case_vortex_observation_exclusion_invalid');
  }
  return { ...exclusion };
};

const normalizeLedgerRecord = (
  value: unknown,
  stage: CaseVortexAddressLedgerStage,
): CaseVortexAddressLedgerRecord => {
  if (!isPlainObject(value)) throw new Error('case_vortex_address_ledger_record_invalid');
  if (stage === 'observation') {
    if (value.recordType !== 'case_vortex_observation_address'
      || !['captured', 'excluded'].includes(String(value.status))) {
      throw new Error('case_vortex_address_ledger_stage_record_mismatch');
    }
    if (value.status === 'captured') {
      if (!exactKeys(value, ['recordType', 'status', 'kind', 'recordId', 'address'])) {
        throw new Error('case_vortex_address_ledger_record_invalid');
      }
      return {
        recordType: 'case_vortex_observation_address',
        status: 'captured',
        ...normalizeAddressIdentity(value as never, 'case_vortex_address_ledger_record_identity_invalid'),
      };
    }
    if (!exactKeys(value, ['recordType', 'status', 'kind', 'recordId', 'address', 'exclusion'])) {
      throw new Error('case_vortex_address_ledger_record_invalid');
    }
    return {
      recordType: 'case_vortex_observation_address',
      status: 'excluded',
      ...normalizeAddressIdentity(value as never, 'case_vortex_address_ledger_record_identity_invalid'),
      exclusion: normalizeExclusion(value.exclusion),
    };
  }
  if (!exactKeys(value, ['recordType', 'stage', 'kind', 'recordId', 'address', 'artifact'])
    || value.recordType !== 'case_vortex_stage_address'
    || value.stage !== stage) {
    throw new Error('case_vortex_address_ledger_stage_record_mismatch');
  }
  // Canonicalization validates the complete nested artifact and rejects class
  // instances, undefined values, non-finite numbers, and cycles.
  canonicalizeCaseVortexAccountingArtifact(value.artifact);
  return {
    recordType: 'case_vortex_stage_address',
    stage,
    ...normalizeAddressIdentity(value as never, 'case_vortex_address_ledger_record_identity_invalid'),
    artifact: value.artifact,
  } as CaseVortexStageAddressRecord;
};

const recordLine = (record: CaseVortexAddressLedgerRecord) => (
  `${canonicalizeCaseVortexAccountingArtifact(record)}\n`
);

export const buildCaseVortexAddressLedgerPart = <T extends CaseVortexAddressLedgerRecord>(params: {
  stage: CaseVortexAddressLedgerStage;
  partNumber: number;
  records: readonly T[];
}) => {
  if (!Number.isSafeInteger(params.partNumber) || params.partNumber < 0 || !params.records.length) {
    throw new Error('case_vortex_address_ledger_part_invalid');
  }
  const records = params.records.map((record) => normalizeLedgerRecord(record, params.stage) as T);
  const counts = emptyCounts();
  const payloadHash = createHash('sha256');
  const recordSetHash = createHash('sha256');
  let bytes = 0;
  let previousAddress = '';
  for (const record of records) {
    if (previousAddress && previousAddress >= record.address) {
      throw new Error('case_vortex_address_ledger_part_order_invalid');
    }
    previousAddress = record.address;
    counts[record.kind] += 1;
    const line = recordLine(record);
    bytes += Buffer.byteLength(line);
    payloadHash.update(line);
    recordSetHash.update(`${record.address}:${caseVortexAccountingArtifactSha256(record)}\n`);
  }
  const summary: CaseVortexAddressLedgerPartSummary = {
    partNumber: params.partNumber,
    rowCount: records.length,
    byKind: counts,
    firstAddress: records[0].address,
    lastAddress: records.at(-1)!.address,
    uncompressedBytes: bytes,
    uncompressedSha256: payloadHash.digest('hex'),
    recordSetSha256: recordSetHash.digest('hex'),
  };
  return { records, summary };
};

const normalizePartSummary = (value: unknown, partNumber: number): CaseVortexAddressLedgerPartSummary => {
  if (!exactKeys(value, [
    'partNumber', 'rowCount', 'byKind', 'firstAddress', 'lastAddress', 'uncompressedBytes',
    'uncompressedSha256', 'recordSetSha256',
  ])) throw new Error('case_vortex_address_ledger_part_manifest_invalid');
  const part = value as unknown as CaseVortexAddressLedgerPartSummary;
  const byKind = normalizeCounts(part.byKind, 'case_vortex_address_ledger_part_manifest_invalid');
  if (part.partNumber !== partNumber
    || !validCount(part.rowCount)
    || part.rowCount < 1
    || countTotal(byKind) !== part.rowCount
    || typeof part.firstAddress !== 'string'
    || typeof part.lastAddress !== 'string'
    || part.firstAddress > part.lastAddress
    || !validCount(part.uncompressedBytes)
    || part.uncompressedBytes < 1
    || !SHA256.test(part.uncompressedSha256)
    || !SHA256.test(part.recordSetSha256)) {
    throw new Error('case_vortex_address_ledger_part_manifest_invalid');
  }
  return { ...part, byKind };
};

const addressLedgerArchiveSetSha256 = (parts: readonly CaseVortexAddressLedgerPartSummary[]) => (
  caseVortexAccountingArtifactSha256(parts.map((part) => (
    `${part.partNumber}:${part.rowCount}:${part.uncompressedSha256}:${part.recordSetSha256}\n`
  )).join(''))
);

const manifestWithoutDigest = (
  manifest: Omit<CaseVortexAddressLedgerManifest, 'manifestDigest'>,
) => manifest;

export const buildCaseVortexAddressLedgerManifest = (params: {
  stage: CaseVortexAddressLedgerStage;
  binding: CaseVortexAccountingLedgerBinding;
  publicationSha256: string | null;
  parts: readonly CaseVortexAddressLedgerPartSummary[];
  generatedAt: string;
}): CaseVortexAddressLedgerManifest => {
  const binding = decodeCaseVortexAccountingLedgerBinding(params.binding);
  if (!['observation', 'graph', 'user_interface'].includes(params.stage)) {
    throw new Error('case_vortex_address_ledger_stage_invalid');
  }
  if ((params.stage === 'user_interface') !== (typeof params.publicationSha256 === 'string')) {
    throw new Error('case_vortex_address_ledger_publication_binding_invalid');
  }
  if (params.publicationSha256 !== null && !SHA256.test(params.publicationSha256)) {
    throw new Error('case_vortex_address_ledger_publication_binding_invalid');
  }
  const generatedAt = normalizeTimestamp(params.generatedAt, 'case_vortex_address_ledger_generated_at_invalid');
  const parts = [...params.parts].sort((left, right) => left.partNumber - right.partNumber)
    .map((part, index) => normalizePartSummary(part, index));
  const byKind = emptyCounts();
  for (const part of parts) for (const kind of KINDS) byKind[kind] += part.byKind[kind];
  const withoutDigest: Omit<CaseVortexAddressLedgerManifest, 'manifestDigest'> = {
    recordType: 'case_vortex_address_ledger_manifest',
    schemaVersion: CASE_VORTEX_ADDRESS_LEDGER_VERSION,
    stage: params.stage,
    binding,
    publicationSha256: params.publicationSha256,
    partCount: parts.length,
    recordCount: countTotal(byKind),
    byKind,
    parts,
    archiveSetSha256: addressLedgerArchiveSetSha256(parts),
    generatedAt,
  };
  return {
    ...withoutDigest,
    manifestDigest: caseVortexAccountingArtifactSha256(manifestWithoutDigest(withoutDigest)),
  };
};

export const encodeCaseVortexAddressLedgerManifest = (manifest: CaseVortexAddressLedgerManifest) => {
  const decoded = decodeCaseVortexAddressLedgerManifest(manifest);
  return Buffer.from(`${canonicalizeCaseVortexAccountingArtifact(decoded)}\n`, 'utf8');
};

export const decodeCaseVortexAddressLedgerManifest = (
  input: Buffer | string | unknown,
): CaseVortexAddressLedgerManifest => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
    value = parseJsonObject(body, 'case_vortex_address_ledger_manifest_json_invalid');
  }
  if (!exactKeys(value, [
    'recordType', 'schemaVersion', 'stage', 'binding', 'publicationSha256', 'partCount',
    'recordCount', 'byKind', 'parts', 'archiveSetSha256', 'generatedAt', 'manifestDigest',
  ])) throw new Error('case_vortex_address_ledger_manifest_invalid');
  const raw = value as unknown as CaseVortexAddressLedgerManifest;
  if (raw.recordType !== 'case_vortex_address_ledger_manifest'
    || raw.schemaVersion !== CASE_VORTEX_ADDRESS_LEDGER_VERSION
    || !['observation', 'graph', 'user_interface'].includes(raw.stage)
    || !Array.isArray(raw.parts)) throw new Error('case_vortex_address_ledger_manifest_invalid');
  const rebuilt = buildCaseVortexAddressLedgerManifest({
    stage: raw.stage,
    binding: raw.binding,
    publicationSha256: raw.publicationSha256,
    parts: raw.parts,
    generatedAt: raw.generatedAt,
  });
  if (canonicalizeCaseVortexAccountingArtifact(raw) !== canonicalizeCaseVortexAccountingArtifact(rebuilt)) {
    throw new Error('case_vortex_address_ledger_manifest_integrity_invalid');
  }
  if (Buffer.isBuffer(input)) {
    const canonicalBody = Buffer.from(`${canonicalizeCaseVortexAccountingArtifact(rebuilt)}\n`);
    if (!input.equals(canonicalBody)) throw new Error('case_vortex_address_ledger_manifest_non_canonical');
  }
  return rebuilt;
};

const deriveLedgerBinding = (params: {
  universe: EvidenceUniverseCompletion;
  relationshipInput: RelationshipInputSnapshotManifest;
  policyVersion: string;
}): CaseVortexAccountingLedgerBinding => {
  const relationshipBinding = validateRelationshipInputBinding(params.relationshipInput.binding);
  const value: CaseVortexAccountingLedgerBinding = {
    corpusVersion: params.universe.corpusVersion,
    snapshotId: params.universe.expected.snapshotId,
    universeArchiveVersion: params.universe.archiveVersion,
    universeSchemaVersion: params.universe.schemaVersion,
    universeLayoutVersion: params.universe.layoutVersion,
    universeArchiveSetSha256: params.universe.archiveSetSha256,
    universeRecordCount: params.universe.accounting.total,
    relationshipInputSchemaVersion: params.relationshipInput.schemaVersion,
    relationshipInputArchiveSetSha256: params.relationshipInput.archiveSetSha256,
    relationshipInputManifestDigest: params.relationshipInput.manifestDigest,
    relationshipInputRecordCount: params.relationshipInput.rowCount,
    policyVersion: params.policyVersion,
  };
  const expectedRelationshipBinding: RelationshipInputUniverseBinding = {
    snapshotId: value.snapshotId,
    corpusVersion: value.corpusVersion,
    universeArchiveVersion: value.universeArchiveVersion,
    universeSchemaVersion: value.universeSchemaVersion,
    universeLayoutVersion: value.universeLayoutVersion,
    universeArchiveSetSha256: value.universeArchiveSetSha256,
    universeRecordCount: value.universeRecordCount,
  };
  if (canonicalizeRelationshipInput(relationshipBinding) !== canonicalizeRelationshipInput(expectedRelationshipBinding)) {
    throw new Error('case_vortex_accounting_relationship_universe_binding_mismatch');
  }
  return decodeCaseVortexAccountingLedgerBinding(value);
};

const graphLedgerSummary = (
  manifest: CaseVortexAddressLedgerManifest,
  manifestBody: Buffer,
): CaseVortexAccountingPublicationBinding['graphAddressLedger'] => ({
  schemaVersion: CASE_VORTEX_ADDRESS_LEDGER_VERSION,
  stage: 'graph',
  manifestSha256: caseVortexAccountingArtifactSha256(manifestBody),
  archiveSetSha256: manifest.archiveSetSha256,
  recordCount: manifest.recordCount,
  byKind: { ...manifest.byKind },
});

export const buildCaseVortexAccountingPublicationBinding = (params: {
  ledgerBinding: CaseVortexAccountingLedgerBinding;
  graphLedgerManifest: CaseVortexAddressLedgerManifest;
  graphLedgerManifestBody: Buffer;
}): CaseVortexAccountingPublicationBinding => {
  const binding = decodeCaseVortexAccountingLedgerBinding(params.ledgerBinding);
  const graph = decodeCaseVortexAddressLedgerManifest(params.graphLedgerManifestBody);
  if (canonicalizeCaseVortexAccountingArtifact(graph)
      !== canonicalizeCaseVortexAccountingArtifact(params.graphLedgerManifest)
    || graph.stage !== 'graph'
    || !sameLedgerBinding(graph.binding, binding)
    || graph.recordCount !== binding.universeRecordCount
    || KINDS.some((kind) => graph.byKind[kind] < 0)) {
    throw new Error('case_vortex_accounting_graph_ledger_binding_mismatch');
  }
  return {
    schemaVersion: CASE_VORTEX_ACCOUNTING_PUBLICATION_BINDING_VERSION,
    corpusVersion: binding.corpusVersion,
    snapshotId: binding.snapshotId,
    universe: {
      archiveVersion: binding.universeArchiveVersion,
      schemaVersion: binding.universeSchemaVersion,
      layoutVersion: binding.universeLayoutVersion,
      archiveSetSha256: binding.universeArchiveSetSha256,
      recordCount: binding.universeRecordCount,
    },
    relationshipInput: {
      schemaVersion: binding.relationshipInputSchemaVersion,
      archiveSetSha256: binding.relationshipInputArchiveSetSha256,
      manifestDigest: binding.relationshipInputManifestDigest,
      recordCount: binding.relationshipInputRecordCount,
    },
    policyVersion: binding.policyVersion,
    graphAddressLedger: graphLedgerSummary(graph, params.graphLedgerManifestBody),
  };
};

export const decodeCaseVortexAccountingPublicationBinding = (
  value: unknown,
): CaseVortexAccountingPublicationBinding => {
  if (!exactKeys(value, [
    'schemaVersion', 'corpusVersion', 'snapshotId', 'universe', 'relationshipInput',
    'policyVersion', 'graphAddressLedger',
  ])) throw new Error('case_vortex_accounting_publication_binding_invalid');
  const raw = value as unknown as CaseVortexAccountingPublicationBinding;
  if (raw.schemaVersion !== CASE_VORTEX_ACCOUNTING_PUBLICATION_BINDING_VERSION
    || !VERSION.test(raw.corpusVersion)
    || !UUID.test(raw.snapshotId)
    || !VERSION.test(raw.policyVersion)
    || !exactKeys(raw.universe, ['archiveVersion', 'schemaVersion', 'layoutVersion', 'archiveSetSha256', 'recordCount'])
    || raw.universe.archiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || raw.universe.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || raw.universe.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || !SHA256.test(raw.universe.archiveSetSha256)
    || !validCount(raw.universe.recordCount)
    || !exactKeys(raw.relationshipInput, ['schemaVersion', 'archiveSetSha256', 'manifestDigest', 'recordCount'])
    || raw.relationshipInput.schemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION
    || !SHA256.test(raw.relationshipInput.archiveSetSha256)
    || !SHA256.test(raw.relationshipInput.manifestDigest)
    || !validCount(raw.relationshipInput.recordCount)
    || raw.relationshipInput.recordCount !== raw.universe.recordCount
    || !exactKeys(raw.graphAddressLedger, [
      'schemaVersion', 'stage', 'manifestSha256', 'archiveSetSha256', 'recordCount', 'byKind',
    ])
    || raw.graphAddressLedger.schemaVersion !== CASE_VORTEX_ADDRESS_LEDGER_VERSION
    || raw.graphAddressLedger.stage !== 'graph'
    || !SHA256.test(raw.graphAddressLedger.manifestSha256)
    || !SHA256.test(raw.graphAddressLedger.archiveSetSha256)
    || !validCount(raw.graphAddressLedger.recordCount)
    || raw.graphAddressLedger.recordCount !== raw.universe.recordCount) {
    throw new Error('case_vortex_accounting_publication_binding_invalid');
  }
  const byKind = normalizeCounts(
    raw.graphAddressLedger.byKind,
    'case_vortex_accounting_publication_binding_invalid',
  );
  if (countTotal(byKind) !== raw.graphAddressLedger.recordCount) {
    throw new Error('case_vortex_accounting_publication_binding_invalid');
  }
  return {
    ...raw,
    universe: { ...raw.universe },
    relationshipInput: { ...raw.relationshipInput },
    graphAddressLedger: { ...raw.graphAddressLedger, byKind },
  };
};

const publicationBindingToLedgerBinding = (
  binding: CaseVortexAccountingPublicationBinding,
): CaseVortexAccountingLedgerBinding => decodeCaseVortexAccountingLedgerBinding({
  corpusVersion: binding.corpusVersion,
  snapshotId: binding.snapshotId,
  universeArchiveVersion: binding.universe.archiveVersion,
  universeSchemaVersion: binding.universe.schemaVersion,
  universeLayoutVersion: binding.universe.layoutVersion,
  universeArchiveSetSha256: binding.universe.archiveSetSha256,
  universeRecordCount: binding.universe.recordCount,
  relationshipInputSchemaVersion: binding.relationshipInput.schemaVersion,
  relationshipInputArchiveSetSha256: binding.relationshipInput.archiveSetSha256,
  relationshipInputManifestDigest: binding.relationshipInput.manifestDigest,
  relationshipInputRecordCount: binding.relationshipInput.recordCount,
  policyVersion: binding.policyVersion,
});

const samePartSummary = (
  left: CaseVortexAddressLedgerPartSummary,
  right: CaseVortexAddressLedgerPartSummary,
) => canonicalizeCaseVortexAccountingArtifact(left) === canonicalizeCaseVortexAccountingArtifact(right);

type WorkingRecord = {
  observation: CaseVortexObservationAddressRecord;
  universe?: { sha256: string };
  relationshipInput?: { sha256: string; record: RelationshipInputRecord };
  graph?: { sha256: string };
  userInterface?: { sha256: string };
};

const consumeAddressLedger = async <T extends CaseVortexAddressLedgerRecord>(params: {
  manifest: CaseVortexAddressLedgerManifest;
  parts: Iterable<CaseVortexLedgerPartRecords<T>> | AsyncIterable<CaseVortexLedgerPartRecords<T>>;
  onRecord: (record: T, pointerSha256: string) => void;
}) => {
  const seenParts = new Set<number>();
  const observedCounts = emptyCounts();
  let observedRows = 0;
  for await (const partSource of params.parts) {
    if (!exactKeys(partSource, ['partNumber', 'records'])
      || !Number.isSafeInteger(partSource.partNumber)
      || partSource.partNumber < 0
      || seenParts.has(partSource.partNumber)) {
      throw new Error('case_vortex_address_ledger_part_source_invalid');
    }
    const expected = params.manifest.parts[partSource.partNumber];
    if (!expected) throw new Error('case_vortex_address_ledger_unexpected_part');
    seenParts.add(partSource.partNumber);
    const payloadHash = createHash('sha256');
    const recordSetHash = createHash('sha256');
    const partCounts = emptyCounts();
    let bytes = 0;
    let rows = 0;
    let firstAddress = '';
    let lastAddress = '';
    for await (const rawRecord of partSource.records) {
      const record = normalizeLedgerRecord(rawRecord, params.manifest.stage) as T;
      if (lastAddress && lastAddress >= record.address) {
        throw new Error('case_vortex_address_ledger_part_order_invalid');
      }
      firstAddress ||= record.address;
      lastAddress = record.address;
      rows += 1;
      observedRows += 1;
      partCounts[record.kind] += 1;
      observedCounts[record.kind] += 1;
      const line = recordLine(record);
      bytes += Buffer.byteLength(line);
      payloadHash.update(line);
      const pointerSha256 = caseVortexAccountingArtifactSha256(record);
      recordSetHash.update(`${record.address}:${pointerSha256}\n`);
      params.onRecord(record, pointerSha256);
    }
    const actual: CaseVortexAddressLedgerPartSummary = {
      partNumber: partSource.partNumber,
      rowCount: rows,
      byKind: partCounts,
      firstAddress,
      lastAddress,
      uncompressedBytes: bytes,
      uncompressedSha256: payloadHash.digest('hex'),
      recordSetSha256: recordSetHash.digest('hex'),
    };
    if (!samePartSummary(actual, expected)) {
      throw new Error('case_vortex_address_ledger_part_receipt_mismatch');
    }
  }
  if (seenParts.size !== params.manifest.partCount
    || params.manifest.parts.some((part) => !seenParts.has(part.partNumber))
    || observedRows !== params.manifest.recordCount
    || KINDS.some((kind) => observedCounts[kind] !== params.manifest.byKind[kind])) {
    throw new Error('case_vortex_address_ledger_incomplete');
  }
};

/**
 * Public streaming verifier used by archive writers/readers before a ledger is
 * admitted to a publication. It retains only the current part and aggregate
 * counters; callers may supply async record streams backed by R2 bodies.
 */
export const verifyCaseVortexAddressLedger = async <T extends CaseVortexAddressLedgerRecord>(params: {
  manifestBody: Buffer;
  parts: Iterable<CaseVortexLedgerPartRecords<T>> | AsyncIterable<CaseVortexLedgerPartRecords<T>>;
}) => {
  const manifest = decodeCaseVortexAddressLedgerManifest(params.manifestBody);
  await consumeAddressLedger({ manifest, parts: params.parts, onRecord: () => undefined });
  return manifest;
};

const universeRecordSha256 = (node: EvidenceUniverseNode) => (
  caseVortexAccountingArtifactSha256(JSON.stringify(node))
);

const relationshipInputRecordSha256 = (record: RelationshipInputRecord) => (
  caseVortexAccountingArtifactSha256(canonicalizeRelationshipInput(record))
);

const expectedUniversePart = (
  completion: EvidenceUniverseCompletion,
  kind: EvidenceUniverseNodeKind,
  partNumber: number,
): EvidenceUniversePart | null => completion.parts.find((part) => (
  part.kind === kind && part.partNumber === partNumber
)) || null;

const consumeUniverse = async (params: {
  completion: EvidenceUniverseCompletion;
  parts: CaseVortexCorpusAccountingArtifactInput['universe']['parts'];
  records: Map<string, WorkingRecord>;
}) => {
  const seenParts = new Set<string>();
  let rows = 0;
  for await (const source of params.parts) {
    if (!exactKeys(source, ['kind', 'partNumber', 'archiveBody'])
      || !KINDS.includes(source.kind)
      || !Number.isSafeInteger(source.partNumber)
      || source.partNumber < 0
      || !Buffer.isBuffer(source.archiveBody)) {
      throw new Error('case_vortex_accounting_universe_part_source_invalid');
    }
    const key = `${source.kind}:${source.partNumber}`;
    if (seenParts.has(key)) throw new Error('case_vortex_accounting_universe_part_duplicate');
    const expected = expectedUniversePart(params.completion, source.kind, source.partNumber);
    if (!expected) throw new Error('case_vortex_accounting_universe_part_unexpected');
    seenParts.add(key);
    const decoded = decodeEvidenceUniverseNodePart(source.archiveBody, expected);
    for (const node of decoded.nodes) {
      const working = params.records.get(node.address);
      if (!working || working.observation.status !== 'captured') {
        throw new Error(`case_vortex_accounting_universe_address_not_captured:${node.address}`);
      }
      if (working.universe) throw new Error(`case_vortex_accounting_universe_address_duplicate:${node.address}`);
      if (working.observation.kind !== node.kind || working.observation.recordId !== node.recordId) {
        throw new Error(`case_vortex_accounting_universe_kind_mismatch:${node.address}`);
      }
      working.universe = { sha256: universeRecordSha256(node) };
      rows += 1;
    }
  }
  if (seenParts.size !== params.completion.parts.length
    || params.completion.parts.some((part) => !seenParts.has(`${part.kind}:${part.partNumber}`))
    || rows !== params.completion.accounting.total) {
    throw new Error('case_vortex_accounting_universe_incomplete');
  }
};

const reconstructRelationshipPartManifest = (
  snapshot: RelationshipInputSnapshotManifest,
  partNumber: number,
): RelationshipInputPartManifest => {
  const summary = snapshot.parts[partNumber];
  if (!summary || summary.partNumber !== partNumber) {
    throw new Error('case_vortex_accounting_relationship_part_unexpected');
  }
  return {
    recordType: 'relationship_input_part_manifest',
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding: snapshot.binding,
    ...summary,
    archiveContentType: 'application/x-ndjson',
    archiveContentEncoding: 'gzip',
    claimDiscipline: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  };
};

const consumeRelationshipInput = async (params: {
  snapshot: RelationshipInputSnapshotManifest;
  parts: CaseVortexCorpusAccountingArtifactInput['relationshipInput']['parts'];
  records: Map<string, WorkingRecord>;
}) => {
  const seenParts = new Set<number>();
  let rows = 0;
  for await (const source of params.parts) {
    if (!exactKeys(source, ['partNumber', 'archiveBody'])
      || !Number.isSafeInteger(source.partNumber)
      || source.partNumber < 0
      || !Buffer.isBuffer(source.archiveBody)
      || seenParts.has(source.partNumber)) {
      throw new Error('case_vortex_accounting_relationship_part_source_invalid');
    }
    const manifest = reconstructRelationshipPartManifest(params.snapshot, source.partNumber);
    seenParts.add(source.partNumber);
    const decoded = decodeRelationshipInputPart(source.archiveBody, manifest, params.snapshot.binding);
    for (const record of decoded.records) {
      const working = params.records.get(record.address);
      if (!working || working.observation.status !== 'captured' || !working.universe) {
        throw new Error(`case_vortex_accounting_relationship_address_not_captured:${record.address}`);
      }
      if (working.relationshipInput) {
        throw new Error(`case_vortex_accounting_relationship_address_duplicate:${record.address}`);
      }
      working.relationshipInput = { sha256: relationshipInputRecordSha256(record), record };
      rows += 1;
    }
  }
  if (seenParts.size !== params.snapshot.partCount
    || params.snapshot.parts.some((part) => !seenParts.has(part.partNumber))
    || rows !== params.snapshot.rowCount) {
    throw new Error('case_vortex_accounting_relationship_incomplete');
  }
};

const buildCorpusBinding = (params: {
  ledger: CaseVortexAccountingLedgerBinding;
  graphPublicationSha256: string;
}): CaseVortexCorpusBinding => ({
  corpusVersion: params.ledger.corpusVersion,
  snapshotId: params.ledger.snapshotId,
  universeArchiveVersion: params.ledger.universeArchiveVersion,
  universeArchiveSetSha256: params.ledger.universeArchiveSetSha256,
  universeSchemaVersion: params.ledger.universeSchemaVersion,
  universeLayoutVersion: params.ledger.universeLayoutVersion,
  universeRecordCount: params.ledger.universeRecordCount,
  relationshipInputSchemaVersion: params.ledger.relationshipInputSchemaVersion,
  relationshipInputBinding: {
    snapshotId: params.ledger.snapshotId,
    corpusVersion: params.ledger.corpusVersion,
    universeArchiveVersion: params.ledger.universeArchiveVersion,
    universeSchemaVersion: params.ledger.universeSchemaVersion,
    universeLayoutVersion: params.ledger.universeLayoutVersion,
    universeArchiveSetSha256: params.ledger.universeArchiveSetSha256,
    universeRecordCount: params.ledger.universeRecordCount,
  },
  relationshipInputArchiveSetSha256: params.ledger.relationshipInputArchiveSetSha256,
  relationshipInputManifestDigest: params.ledger.relationshipInputManifestDigest,
  relationshipInputRecordCount: params.ledger.relationshipInputRecordCount,
  graphPublicationSha256: params.graphPublicationSha256,
  policyVersion: params.ledger.policyVersion,
});

const buildCorpusRecords = (records: Map<string, WorkingRecord>): CaseVortexCorpusRecord[] => (
  [...records.entries()].sort(([left], [right]) => compareText(left, right)).map(([address, working]) => {
    const observation = working.observation;
    if (observation.status === 'excluded') {
      if (working.universe || working.relationshipInput || working.graph || working.userInterface) {
        throw new Error(`case_vortex_accounting_excluded_address_represented:${address}`);
      }
      return {
        status: 'excluded',
        kind: observation.kind,
        recordId: observation.recordId,
        address,
        exclusion: { ...observation.exclusion },
      } satisfies CaseVortexExcludedRecord;
    }
    if (!working.universe) throw new Error(`case_vortex_accounting_universe_address_missing:${address}`);
    if (!working.relationshipInput) throw new Error(`case_vortex_accounting_relationship_address_missing:${address}`);
    if (!working.graph) throw new Error(`case_vortex_accounting_graph_address_missing:${address}`);
    if (!working.userInterface) throw new Error(`case_vortex_accounting_ui_address_missing:${address}`);
    const duplicate = working.relationshipInput.record.duplicateLineage;
    return {
      status: 'represented',
      kind: observation.kind,
      recordId: observation.recordId,
      address,
      universe: { address, sha256: working.universe.sha256 },
      relationshipInput: {
        address,
        sha256: working.relationshipInput.sha256,
        disposition: 'processed',
      },
      graph: { address, sha256: working.graph.sha256 },
      userInterface: { address, sha256: working.userInterface.sha256 },
      ...(duplicate ? {
        duplicateLineage: {
          status: duplicate.status,
          clusterId: duplicate.clusterId,
          canonicalAddress: duplicate.canonicalAddress,
          memberRole: duplicate.memberRole,
        },
      } : {}),
    } satisfies CaseVortexRepresentedRecord;
  })
);

const assertLedgerBinding = (
  manifest: CaseVortexAddressLedgerManifest,
  expected: CaseVortexAccountingLedgerBinding,
  stage: CaseVortexAddressLedgerStage,
) => {
  if (manifest.stage !== stage || !sameLedgerBinding(manifest.binding, expected)) {
    throw new Error(`case_vortex_accounting_${stage}_ledger_binding_mismatch`);
  }
};

export const encodeCaseVortexCorpusAccountingReceipt = (
  receipt: CaseVortexCorpusAccountingReceipt,
) => Buffer.from(`${canonicalizeCaseVortexAccountingArtifact(receipt)}\n`, 'utf8');

export const caseVortexCorpusAccountingReceiptSha256 = (
  receipt: CaseVortexCorpusAccountingReceipt | Buffer,
) => caseVortexAccountingArtifactSha256(
  Buffer.isBuffer(receipt) ? receipt : encodeCaseVortexCorpusAccountingReceipt(receipt),
);

/**
 * Strictly decodes a receipt artifact. This authenticates its canonical bytes
 * and internal totals; the production builder below remains responsible for
 * recomputing it from all address ledgers before publication activation.
 */
export const decodeCaseVortexCorpusAccountingReceipt = (
  body: Buffer,
): CaseVortexCorpusAccountingReceipt => {
  const value = parseJsonObject(body, 'case_vortex_corpus_accounting_receipt_json_invalid');
  if (!exactKeys(value, [
    'accountingVersion', 'complete', 'binding', 'observedByKind', 'capturedByKind', 'excludedByKind',
    'observedTotal', 'representedTotal', 'excludedTotal', 'relationshipProcessedTotal',
    'relationshipNotApplicableTotal', 'duplicateCandidateTotal', 'duplicateConfirmedTotal',
    'exclusionsByReason', 'recordLedgerSha256', 'representedAddressSetSha256',
    'excludedAddressSetSha256', 'universePointerSetSha256', 'relationshipInputPointerSetSha256',
    'graphPointerSetSha256', 'userInterfacePointerSetSha256',
  ])) throw new Error('case_vortex_corpus_accounting_receipt_invalid');
  const receipt = value as unknown as CaseVortexCorpusAccountingReceipt;
  const observed = normalizeCounts(receipt.observedByKind, 'case_vortex_corpus_accounting_receipt_invalid');
  const captured = normalizeCounts(receipt.capturedByKind, 'case_vortex_corpus_accounting_receipt_invalid');
  const excluded = normalizeCounts(receipt.excludedByKind, 'case_vortex_corpus_accounting_receipt_invalid');
  const bindingShape = receipt.binding;
  if (receipt.accountingVersion !== CASE_VORTEX_CORPUS_ACCOUNTING_VERSION
    || receipt.complete !== true
    || !isPlainObject(bindingShape)
    || !validCount(receipt.observedTotal)
    || !validCount(receipt.representedTotal)
    || !validCount(receipt.excludedTotal)
    || !validCount(receipt.relationshipProcessedTotal)
    || !validCount(receipt.relationshipNotApplicableTotal)
    || !validCount(receipt.duplicateCandidateTotal)
    || !validCount(receipt.duplicateConfirmedTotal)
    || countTotal(observed) !== receipt.observedTotal
    || countTotal(captured) !== receipt.representedTotal
    || countTotal(excluded) !== receipt.excludedTotal
    || KINDS.some((kind) => observed[kind] !== captured[kind] + excluded[kind])
    || receipt.observedTotal !== receipt.representedTotal + receipt.excludedTotal
    || receipt.relationshipProcessedTotal !== receipt.representedTotal
    || receipt.relationshipNotApplicableTotal !== 0
    || !exactKeys(receipt.exclusionsByReason, CASE_VORTEX_EXCLUSION_REASONS)
    || CASE_VORTEX_EXCLUSION_REASONS.some((reason) => !validCount(receipt.exclusionsByReason[reason]))
    || CASE_VORTEX_EXCLUSION_REASONS.reduce((sum, reason) => sum + receipt.exclusionsByReason[reason], 0)
      !== receipt.excludedTotal
    || [
      receipt.recordLedgerSha256,
      receipt.representedAddressSetSha256,
      receipt.excludedAddressSetSha256,
      receipt.universePointerSetSha256,
      receipt.relationshipInputPointerSetSha256,
      receipt.graphPointerSetSha256,
      receipt.userInterfacePointerSetSha256,
    ].some((digest) => !SHA256.test(digest))) {
    throw new Error('case_vortex_corpus_accounting_receipt_invalid');
  }
  // Reuse the ledger-binding validator for the fields it shares, then enforce
  // the complete receipt binding's exact schema separately.
  if (!exactKeys(bindingShape, [
    'corpusVersion', 'snapshotId', 'universeArchiveVersion', 'universeArchiveSetSha256',
    'universeSchemaVersion', 'universeLayoutVersion', 'universeRecordCount',
    'relationshipInputSchemaVersion', 'relationshipInputBinding',
    'relationshipInputArchiveSetSha256', 'relationshipInputManifestDigest',
    'relationshipInputRecordCount', 'graphPublicationSha256', 'policyVersion',
  ])
    || !SHA256.test(String(bindingShape.graphPublicationSha256 || ''))
    || bindingShape.universeRecordCount !== receipt.representedTotal
    || bindingShape.relationshipInputRecordCount !== receipt.representedTotal) {
    throw new Error('case_vortex_corpus_accounting_receipt_invalid');
  }
  decodeCaseVortexAccountingLedgerBinding({
    corpusVersion: bindingShape.corpusVersion,
    snapshotId: bindingShape.snapshotId,
    universeArchiveVersion: bindingShape.universeArchiveVersion,
    universeSchemaVersion: bindingShape.universeSchemaVersion,
    universeLayoutVersion: bindingShape.universeLayoutVersion,
    universeArchiveSetSha256: bindingShape.universeArchiveSetSha256,
    universeRecordCount: bindingShape.universeRecordCount,
    relationshipInputSchemaVersion: bindingShape.relationshipInputSchemaVersion,
    relationshipInputArchiveSetSha256: bindingShape.relationshipInputArchiveSetSha256,
    relationshipInputManifestDigest: bindingShape.relationshipInputManifestDigest,
    relationshipInputRecordCount: bindingShape.relationshipInputRecordCount,
    policyVersion: bindingShape.policyVersion,
  });
  const relationshipBinding = validateRelationshipInputBinding(bindingShape.relationshipInputBinding);
  if (canonicalizeRelationshipInput(relationshipBinding) !== canonicalizeRelationshipInput({
    snapshotId: bindingShape.snapshotId,
    corpusVersion: bindingShape.corpusVersion,
    universeArchiveVersion: bindingShape.universeArchiveVersion,
    universeSchemaVersion: bindingShape.universeSchemaVersion,
    universeLayoutVersion: bindingShape.universeLayoutVersion,
    universeArchiveSetSha256: bindingShape.universeArchiveSetSha256,
    universeRecordCount: bindingShape.universeRecordCount,
  })) throw new Error('case_vortex_corpus_accounting_receipt_invalid');
  const canonicalBody = encodeCaseVortexCorpusAccountingReceipt(receipt);
  if (!body.equals(canonicalBody)) throw new Error('case_vortex_corpus_accounting_receipt_non_canonical');
  return receipt;
};

export const buildCaseVortexCorpusAccountingFromArtifacts = async (
  artifacts: CaseVortexCorpusAccountingArtifactInput,
): Promise<CaseVortexCorpusAccountingArtifactResult> => {
  if (!exactKeys(artifacts, [
    'corpusVersion', 'universe', 'relationshipInput', 'observationLedger',
    'graphPublicationManifestBody', 'graphLedger', 'userInterfaceLedger',
  ])
    || !VERSION.test(artifacts.corpusVersion)
    || !exactKeys(artifacts.universe, ['completionBody', 'parts'])
    || !Buffer.isBuffer(artifacts.universe.completionBody)
    || !exactKeys(artifacts.relationshipInput, ['snapshotManifestBody', 'parts'])
    || !Buffer.isBuffer(artifacts.relationshipInput.snapshotManifestBody)
    || !exactKeys(artifacts.observationLedger, ['manifestBody', 'parts'])
    || !Buffer.isBuffer(artifacts.observationLedger.manifestBody)
    || !Buffer.isBuffer(artifacts.graphPublicationManifestBody)
    || !exactKeys(artifacts.graphLedger, ['manifestBody', 'parts'])
    || !Buffer.isBuffer(artifacts.graphLedger.manifestBody)
    || !exactKeys(artifacts.userInterfaceLedger, ['manifestBody', 'parts'])
    || !Buffer.isBuffer(artifacts.userInterfaceLedger.manifestBody)) {
    throw new Error('case_vortex_accounting_artifact_input_invalid');
  }
  const universe = decodeEvidenceUniverseCompletion(
    artifacts.universe.completionBody,
    artifacts.corpusVersion,
  );
  const relationshipInput = decodeRelationshipInputSnapshotManifest(
    artifacts.relationshipInput.snapshotManifestBody,
  );
  const observation = decodeCaseVortexAddressLedgerManifest(artifacts.observationLedger.manifestBody);
  const graph = decodeCaseVortexAddressLedgerManifest(artifacts.graphLedger.manifestBody);
  const graphPublication = parseJsonObject(
    artifacts.graphPublicationManifestBody,
    'case_vortex_accounting_graph_publication_invalid',
  );
  if (!hasOwn(graphPublication, 'accountingBinding')) {
    throw new Error('case_vortex_accounting_graph_publication_binding_missing');
  }
  const publicationBinding = decodeCaseVortexAccountingPublicationBinding(graphPublication.accountingBinding);
  const derivedBinding = deriveLedgerBinding({
    universe,
    relationshipInput,
    policyVersion: observation.binding.policyVersion,
  });
  assertLedgerBinding(observation, derivedBinding, 'observation');
  assertLedgerBinding(graph, derivedBinding, 'graph');
  if (observation.publicationSha256 !== null || graph.publicationSha256 !== null) {
    throw new Error('case_vortex_accounting_prepublication_ledger_invalid');
  }
  const expectedPublicationBinding = buildCaseVortexAccountingPublicationBinding({
    ledgerBinding: derivedBinding,
    graphLedgerManifest: graph,
    graphLedgerManifestBody: artifacts.graphLedger.manifestBody,
  });
  if (canonicalizeCaseVortexAccountingArtifact(publicationBinding)
      !== canonicalizeCaseVortexAccountingArtifact(expectedPublicationBinding)) {
    throw new Error('case_vortex_accounting_graph_publication_binding_mismatch');
  }
  if (!sameLedgerBinding(publicationBindingToLedgerBinding(publicationBinding), derivedBinding)) {
    throw new Error('case_vortex_accounting_graph_publication_binding_mismatch');
  }
  const graphPublicationSha256 = caseVortexAccountingArtifactSha256(artifacts.graphPublicationManifestBody);
  const userInterface = decodeCaseVortexAddressLedgerManifest(artifacts.userInterfaceLedger.manifestBody);
  assertLedgerBinding(userInterface, derivedBinding, 'user_interface');
  if (userInterface.publicationSha256 !== graphPublicationSha256) {
    throw new Error('case_vortex_accounting_ui_publication_binding_mismatch');
  }

  const working = new Map<string, WorkingRecord>();
  const observedByKind = emptyCounts();
  const capturedByKind = emptyCounts();
  await consumeAddressLedger({
    manifest: observation,
    parts: artifacts.observationLedger.parts,
    onRecord: (record) => {
      if (working.has(record.address)) {
        throw new Error(`case_vortex_accounting_observation_address_duplicate:${record.address}`);
      }
      working.set(record.address, { observation: record });
      observedByKind[record.kind] += 1;
      if (record.status === 'captured') capturedByKind[record.kind] += 1;
    },
  });
  if (KINDS.some((kind) => observedByKind[kind] !== observation.byKind[kind]
    || capturedByKind[kind] !== universe.accounting.byKind[kind])) {
    throw new Error('case_vortex_accounting_observation_universe_count_mismatch');
  }

  await consumeUniverse({ completion: universe, parts: artifacts.universe.parts, records: working });
  await consumeRelationshipInput({
    snapshot: relationshipInput,
    parts: artifacts.relationshipInput.parts,
    records: working,
  });
  await consumeAddressLedger({
    manifest: graph,
    parts: artifacts.graphLedger.parts,
    onRecord: (record, pointerSha256) => {
      if (record.stage !== 'graph') throw new Error('case_vortex_accounting_graph_stage_mismatch');
      const item = working.get(record.address);
      if (!item || item.observation.status !== 'captured' || !item.universe || !item.relationshipInput) {
        throw new Error(`case_vortex_accounting_graph_address_not_captured:${record.address}`);
      }
      if (item.observation.kind !== record.kind || item.graph) {
        throw new Error(`case_vortex_accounting_graph_address_duplicate_or_kind_mismatch:${record.address}`);
      }
      item.graph = { sha256: pointerSha256 };
    },
  });
  await consumeAddressLedger({
    manifest: userInterface,
    parts: artifacts.userInterfaceLedger.parts,
    onRecord: (record, pointerSha256) => {
      if (record.stage !== 'user_interface') throw new Error('case_vortex_accounting_ui_stage_mismatch');
      const item = working.get(record.address);
      if (!item || item.observation.status !== 'captured' || !item.graph) {
        throw new Error(`case_vortex_accounting_ui_address_not_captured:${record.address}`);
      }
      if (item.observation.kind !== record.kind || item.userInterface) {
        throw new Error(`case_vortex_accounting_ui_address_duplicate_or_kind_mismatch:${record.address}`);
      }
      item.userInterface = { sha256: pointerSha256 };
    },
  });

  const input: CaseVortexCorpusAccountingInput = {
    binding: buildCorpusBinding({ ledger: derivedBinding, graphPublicationSha256 }),
    observedByKind,
    capturedByKind,
    records: buildCorpusRecords(working),
  };
  const audited = auditCaseVortexCorpusAccounting(input);
  if (audited.status !== 'complete') {
    throw new Error(`case_vortex_corpus_accounting_incomplete:${audited.issues.map((issue) => issue.code).join(',')}`);
  }
  const receiptBody = encodeCaseVortexCorpusAccountingReceipt(audited.receipt);
  // Decode our own final artifact once. This catches accidental differences
  // between builder and activation-reader contracts before anything is stored.
  decodeCaseVortexCorpusAccountingReceipt(receiptBody);
  return {
    input,
    receipt: audited.receipt,
    receiptBody,
    receiptSha256: caseVortexCorpusAccountingReceiptSha256(receiptBody),
    graphPublicationSha256,
  };
};
