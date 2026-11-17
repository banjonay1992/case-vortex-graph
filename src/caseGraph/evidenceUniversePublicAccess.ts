import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from './archiveKeys';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
  type EvidenceUniversePart,
} from './evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  projectEvidenceUniverseNode,
  type EvidenceUniverseAccounting,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
} from './postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from './postgresEvidenceUniverseSnapshot';
import type { CaseGraphPublicStorage } from './publicAccess';

const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const MEDIA_KINDS = ['document', 'photo', 'video'] as const;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_PART_BYTES = 128 * 1024 * 1024;
const MAX_PART_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_PART_NUMBER = 999_999;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOP_LEVEL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PRECISE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/;
const CURSOR_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;

const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const invalidManifest = (): never => { throw new Error('evidence_universe_public_manifest_invalid'); };
const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const parse = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new Error(`evidence_universe_public_manifest_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
};

const safeCount = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidManifest();
  return Number(value);
};

const safeSum = (values: number[]) => {
  let sum = 0;
  for (const value of values) {
    sum += value;
    if (!Number.isSafeInteger(sum)) invalidManifest();
  }
  return sum;
};

const validateKindCounts = (value: unknown) => {
  if (!isRecord(value)) invalidManifest();
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, KINDS)) invalidManifest();
  return {
    sighting: safeCount(record.sighting),
    document: safeCount(record.document),
    photo: safeCount(record.photo),
    video: safeCount(record.video),
  } satisfies Record<EvidenceUniverseNodeKind, number>;
};

const validateTopLevelTimestamp = (value: unknown) => {
  if (typeof value !== 'string') invalidManifest();
  const timestamp = value as string;
  if (!TOP_LEVEL_TIMESTAMP_PATTERN.test(timestamp)) invalidManifest();
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) invalidManifest();
  return parsed.getTime();
};

const validatePreciseTimestamp = (value: unknown) => {
  if (typeof value !== 'string') invalidManifest();
  const timestamp = value as string;
  if (!PRECISE_TIMESTAMP_PATTERN.test(timestamp)) invalidManifest();
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) invalidManifest();
  return parsed.getTime();
};

type ValidatedCursor = {
  timestamp: string;
  sortableTimestamp: string;
  recordId: string;
};

const validateCursor = (
  value: unknown,
  kind: EvidenceUniverseNodeKind,
  snapshotMs: number,
): ValidatedCursor => {
  if (!isRecord(value)) invalidManifest();
  const record = value as Record<string, unknown>;
  const isSighting = kind === 'sighting';
  const timestampKey = isSighting ? 'updated_at' : 'updatedAt';
  const idKey = isSighting ? 'case_id' : 'recordId';
  if (!hasExactKeys(record, [timestampKey, idKey])) invalidManifest();
  const timestamp = record[timestampKey];
  const recordId = record[idKey];
  if (typeof timestamp !== 'string' || typeof recordId !== 'string' || !recordId.trim() || recordId.length > 2_048) {
    invalidManifest();
  }
  const exactTimestamp = timestamp as string;
  const exactRecordId = recordId as string;
  const match = exactTimestamp.match(CURSOR_TIMESTAMP_PATTERN);
  const exactMatch = match || invalidManifest();
  const milliseconds = (exactMatch[2] || '').padEnd(3, '0').slice(0, 3);
  const normalized = `${exactMatch[1]}.${milliseconds}Z`;
  const parsed = new Date(normalized);
  const sortableTimestamp = `${exactMatch[1]}.${(exactMatch[2] || '').padEnd(6, '0')}Z`;
  const sortableSnapshot = new Date(snapshotMs).toISOString()
    .replace(/\.(\d{3})Z$/, (_match, millisecondsPart: string) => `.${millisecondsPart}000Z`);
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== normalized
    || sortableTimestamp > sortableSnapshot
  ) {
    invalidManifest();
  }
  return {
    timestamp: exactTimestamp,
    sortableTimestamp,
    recordId: exactRecordId,
  };
};

const cursorsEqual = (left: ValidatedCursor, right: ValidatedCursor) => (
  left.timestamp === right.timestamp && left.recordId === right.recordId
);

const validateAccounting = (value: unknown, expectedTotal?: number, expectedKind?: EvidenceUniverseNodeKind) => {
  if (!isRecord(value)) invalidManifest();
  const record = value as Record<string, unknown>;
  const total = safeCount(record.total);
  const byKind = validateKindCounts(record.byKind);
  const attachedMedia = safeCount(record.attachedMedia);
  const unresolvedTime = safeCount(record.unresolvedTime);
  const unresolvedLocation = safeCount(record.unresolvedLocation);
  if (
    total !== safeSum(KINDS.map((kind) => byKind[kind]))
    || (expectedTotal != null && total !== expectedTotal)
    || attachedMedia > safeSum(MEDIA_KINDS.map((kind) => byKind[kind]))
    || unresolvedTime > total
    || unresolvedLocation > total
    || (expectedKind && KINDS.some((kind) => byKind[kind] !== (kind === expectedKind ? total : 0)))
  ) invalidManifest();
  return { total, byKind, attachedMedia, unresolvedTime, unresolvedLocation };
};

const validatePart = (
  value: unknown,
  corpusVersion: string,
  expectedKind: EvidenceUniverseNodeKind,
  expectedPart: number,
  snapshotMs: number,
) => {
  if (!isRecord(value)) throw new Error('evidence_universe_public_part_invalid');
  const part = value as unknown as EvidenceUniversePart;
  if (
    part.kind !== expectedKind
    || part.partNumber !== expectedPart
    || !Number.isSafeInteger(part.partNumber)
    || part.partNumber < 0
    || part.partNumber > MAX_PART_NUMBER
    || !Number.isSafeInteger(part.rowCount)
    || part.rowCount < 1
    || !Number.isSafeInteger(part.compressedBytes)
    || part.compressedBytes < 1
    || part.compressedBytes > MAX_PART_BYTES
    || !Number.isSafeInteger(part.uncompressedBytes)
    || part.uncompressedBytes < 1
    || !SHA256_PATTERN.test(String(part.sha256 || ''))
    || typeof part.firstAddress !== 'string'
    || !part.firstAddress.startsWith(`${part.kind}:`)
    || typeof part.lastAddress !== 'string'
    || !part.lastAddress.startsWith(`${part.kind}:`)
  ) throw new Error('evidence_universe_public_part_invalid');
  const keys = getEvidenceUniversePartKeys(corpusVersion, part.kind, part.partNumber);
  if (part.archiveKey !== keys.archiveKey || part.manifestKey !== keys.manifestKey) {
    throw new Error('evidence_universe_public_part_key_invalid');
  }
  validateAccounting(part.accounting, part.rowCount, part.kind);
  return { part, cursor: validateCursor(part.cursor, part.kind, snapshotMs) };
};

export const decodeEvidenceUniverseCompletion = (body: Buffer, corpusVersion: string) => {
  if (body.length < 2 || body.length > MAX_MANIFEST_BYTES) throw new Error('evidence_universe_public_manifest_size_invalid');
  const parsed = parse(body);
  if (!isRecord(parsed)) invalidManifest();
  const completion = parsed as unknown as EvidenceUniverseCompletion;
  if (
    completion.recordType !== 'evidence_universe_completion'
    || completion.archiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || completion.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || completion.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || completion.corpusVersion !== corpusVersion
    || !Array.isArray(completion.parts)
    || !isRecord(completion.expected)
    || !isRecord(completion.cursors)
    || !hasExactKeys(completion.cursors, KINDS)
  ) invalidManifest();
  if (completion.seedFingerprint !== undefined && !SHA256_PATTERN.test(completion.seedFingerprint)) {
    invalidManifest();
  }

  const snapshotMs = validateTopLevelTimestamp(completion.expected.snapshotAt);
  const materializedMs = validatePreciseTimestamp(completion.expected.materializedAt);
  const completedMs = validateTopLevelTimestamp(completion.completedAt);
  if (completedMs < snapshotMs || completedMs < materializedMs) invalidManifest();
  if (!hasExactKeys(completion.expected, [
    'snapshotId',
    'snapshotAt',
    'materializedAt',
    'sourceMvccSnapshot',
    'snapshotPolicy',
    'capturePolicies',
    'byKind',
    'total',
    'sightingPolicy',
    'mediaBackfillsComplete',
  ])) invalidManifest();
  if (typeof completion.expected.snapshotId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      completion.expected.snapshotId,
    )) invalidManifest();
  if (completion.expected.snapshotPolicy !== EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY) invalidManifest();
  if (typeof completion.expected.sourceMvccSnapshot !== 'string'
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(completion.expected.sourceMvccSnapshot)) invalidManifest();
  if (!isRecord(completion.expected.capturePolicies)
    || !hasExactKeys(completion.expected.capturePolicies, KINDS)
    || completion.expected.capturePolicies.sighting !== EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY
    || MEDIA_KINDS.some((kind) => completion.expected.capturePolicies[kind] !== EVIDENCE_MEDIA_SNAPSHOT_POLICY)) {
    invalidManifest();
  }
  if (typeof completion.expected.sightingPolicy !== 'string'
    || !completion.expected.sightingPolicy.trim()
    || completion.expected.sightingPolicy.length > 1_024) invalidManifest();
  if (!isRecord(completion.expected.mediaBackfillsComplete)
    || !hasExactKeys(completion.expected.mediaBackfillsComplete, MEDIA_KINDS)
    || MEDIA_KINDS.some((kind) => completion.expected.mediaBackfillsComplete[kind] !== true)) invalidManifest();

  const expected = validateKindCounts(completion.expected.byKind);
  const expectedTotal = safeCount(completion.expected.total);
  const exported = validateKindCounts(completion.exportedByKind);
  const accounting = validateAccounting(completion.accounting, expectedTotal);
  if (
    expectedTotal !== safeSum(KINDS.map((kind) => expected[kind]))
    || KINDS.some((kind) => exported[kind] !== expected[kind] || accounting.byKind[kind] !== expected[kind])
  ) invalidManifest();

  const nextPart: Record<EvidenceUniverseNodeKind, number> = { sighting: 0, document: 0, photo: 0, video: 0 };
  const rows: Record<EvidenceUniverseNodeKind, number> = { sighting: 0, document: 0, photo: 0, video: 0 };
  const finalPartCursors: Partial<Record<EvidenceUniverseNodeKind, ValidatedCursor>> = {};
  let previousKindIndex = -1;
  for (const value of completion.parts) {
    if (!isRecord(value) || !KINDS.includes(value.kind as EvidenceUniverseNodeKind)) {
      throw new Error('evidence_universe_public_part_invalid');
    }
    const kind = value.kind as EvidenceUniverseNodeKind;
    const kindIndex = KINDS.indexOf(kind);
    if (kindIndex < previousKindIndex) throw new Error('evidence_universe_public_part_order_invalid');
    previousKindIndex = kindIndex;
    const { part, cursor } = validatePart(value, corpusVersion, kind, nextPart[kind], snapshotMs);
    const previousCursor = finalPartCursors[kind];
    if (previousCursor && (
      previousCursor.sortableTimestamp > cursor.sortableTimestamp
      || (previousCursor.sortableTimestamp === cursor.sortableTimestamp && previousCursor.recordId >= cursor.recordId)
    )) {
      throw new Error('evidence_universe_public_part_order_invalid');
    }
    nextPart[kind] += 1;
    rows[kind] = safeSum([rows[kind], part.rowCount]);
    finalPartCursors[kind] = cursor;
  }

  for (const kind of KINDS) {
    if (rows[kind] !== expected[kind]) throw new Error('evidence_universe_public_part_accounting_mismatch');
    const finalCursor = finalPartCursors[kind];
    const completionCursor = completion.cursors[kind];
    if (expected[kind] === 0) {
      if (completionCursor !== null || finalCursor) invalidManifest();
      continue;
    }
    const exactFinalCursor = finalCursor || invalidManifest();
    const validatedCompletionCursor = validateCursor(completionCursor, kind, snapshotMs);
    if (!cursorsEqual(exactFinalCursor, validatedCompletionCursor)) invalidManifest();
  }

  const exactArchiveSetSha256 = sha256(
    completion.parts.map((part) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n'),
  );
  if (completion.archiveSetSha256 !== exactArchiveSetSha256) invalidManifest();
  return completion;
};

export const loadEvidenceUniverseCompletion = async (
  storage: CaseGraphPublicStorage,
  corpusVersion: string,
  signal?: AbortSignal,
) => {
  const key = getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey;
  const body = await storage.readObject(key, { maxBytes: MAX_MANIFEST_BYTES, signal });
  if (!body) return null;
  return decodeEvidenceUniverseCompletion(body, corpusVersion);
};

export const readEvidenceUniversePart = async (
  storage: CaseGraphPublicStorage,
  completion: EvidenceUniverseCompletion,
  kind: EvidenceUniverseNodeKind,
  partNumber: number,
  signal?: AbortSignal,
) => {
  if (!KINDS.includes(kind) || !Number.isSafeInteger(partNumber) || partNumber < 0) {
    throw new Error('evidence_universe_public_part_request_invalid');
  }
  const part = completion.parts.find((candidate) => candidate.kind === kind && candidate.partNumber === partNumber);
  if (!part) return null;
  const body = await storage.readObject(part.archiveKey, { maxBytes: part.compressedBytes, signal });
  if (!body || body.length !== part.compressedBytes || sha256(body) !== part.sha256) {
    throw new Error('evidence_universe_public_part_checksum_mismatch');
  }
  return { part, body };
};

const accountingEqual = (
  left: EvidenceUniverseAccounting,
  right: EvidenceUniverseAccounting,
) => left.total === right.total
  && left.attachedMedia === right.attachedMedia
  && left.unresolvedTime === right.unresolvedTime
  && left.unresolvedLocation === right.unresolvedLocation
  && KINDS.every((kind) => left.byKind[kind] === right.byKind[kind]);

/**
 * Fully verifies a stored universe shard before downstream relationship work.
 *
 * The public HTTP path only needs to authenticate compressed bytes. Graph
 * generation has a stronger obligation: every decompressed record must be the
 * canonical projection declared by archive-v3, including its deterministic
 * position and exact per-part accounting receipt.
 */
export const decodeEvidenceUniverseNodePart = (
  archiveBody: Buffer,
  part: EvidenceUniversePart,
  maxUncompressedBytes = MAX_PART_UNCOMPRESSED_BYTES,
): { part: EvidenceUniversePart; nodes: EvidenceUniverseNode[]; accounting: EvidenceUniverseAccounting } => {
  if (
    !Number.isSafeInteger(maxUncompressedBytes)
    || maxUncompressedBytes < 1
    || maxUncompressedBytes > MAX_PART_UNCOMPRESSED_BYTES
    || archiveBody.length !== part.compressedBytes
    || sha256(archiveBody) !== part.sha256
    || part.uncompressedBytes > maxUncompressedBytes
  ) throw new Error('evidence_universe_node_part_compressed_receipt_mismatch');

  let body: Buffer;
  try {
    body = gunzipSync(archiveBody, { maxOutputLength: maxUncompressedBytes });
  } catch {
    throw new Error('evidence_universe_node_part_gzip_invalid');
  }
  if (
    body.length !== part.uncompressedBytes
    || body.length < 2
    || body[body.length - 1] !== 0x0a
  ) throw new Error('evidence_universe_node_part_uncompressed_receipt_mismatch');

  const lines = body.toString('utf8').slice(0, -1).split('\n');
  if (lines.length !== part.rowCount || lines.some((line) => !line.length)) {
    throw new Error('evidence_universe_node_part_row_count_mismatch');
  }

  const nodes = lines.map((line): EvidenceUniverseNode => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('evidence_universe_node_part_record_invalid');
    }
    if (!isRecord(parsed) || parsed.kind !== part.kind) {
      throw new Error('evidence_universe_node_part_record_invalid');
    }
    let normalized: EvidenceUniverseNode;
    try {
      normalized = projectEvidenceUniverseNode({
        ...(parsed as unknown as EvidenceUniverseNode),
        public: true,
      });
    } catch {
      throw new Error('evidence_universe_node_part_record_invalid');
    }
    if (JSON.stringify(normalized) !== line) {
      throw new Error('evidence_universe_node_part_record_non_canonical');
    }
    return normalized;
  });

  if (
    nodes[0]?.address !== part.firstAddress
    || nodes.at(-1)?.address !== part.lastAddress
  ) throw new Error('evidence_universe_node_part_address_bounds_mismatch');

  let accounting: EvidenceUniverseAccounting;
  try {
    accounting = accountEvidenceUniverseNodes(nodes);
  } catch {
    throw new Error('evidence_universe_node_part_accounting_invalid');
  }
  if (!accountingEqual(accounting, part.accounting)) {
    throw new Error('evidence_universe_node_part_accounting_mismatch');
  }
  return { part, nodes, accounting };
};

export const projectEvidenceUniverseManifest = (completion: EvidenceUniverseCompletion) => ({
  active: true,
  corpusVersion: completion.corpusVersion,
  snapshotId: completion.expected.snapshotId,
  snapshotAt: completion.expected.snapshotAt,
  materializedAt: completion.expected.materializedAt,
  snapshotPolicy: completion.expected.snapshotPolicy,
  capturePolicies: completion.expected.capturePolicies,
  schemaVersion: completion.schemaVersion,
  layoutVersion: completion.layoutVersion,
  accounting: completion.accounting,
  archiveSetSha256: completion.archiveSetSha256,
  parts: completion.parts.map((part) => ({
    kind: part.kind,
    partNumber: part.partNumber,
    rowCount: part.rowCount,
    compressedBytes: part.compressedBytes,
    sha256: part.sha256,
    url: `/api/public/case-vortex/universe/corpora/${completion.corpusVersion}/shards/${part.kind}/${part.partNumber}/${part.sha256}`,
  })),
  notices: [
    'Every public record is represented by one addressable node; overview labels may aggregate but do not replace nodes.',
    'Media-to-sighting filaments are shown only when a stored sighting_id or governed relationship receipt supports them.',
  ],
});
