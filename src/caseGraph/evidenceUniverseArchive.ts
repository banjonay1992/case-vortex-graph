import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from './archiveKeys';
import type {
  CaseGraphArchiveStorage,
  CaseGraphConditionalArchiveStorage,
  CaseGraphCursor,
  CaseGraphFeatureSource,
} from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  projectSightingEvidenceUniverseNode,
  type EvidenceUniverseAccounting,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  type EvidenceMediaCursor,
  type EvidenceMediaPage,
  type EvidenceMediaSnapshot,
} from './postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from './postgresEvidenceUniverseSnapshot';

// v2 requires an enforced, backfilled catalogue mutation watermark for all
// media pages. A v1 completion can therefore never be mistaken for a frozen
// media snapshot after this policy becomes mandatory.
export const EVIDENCE_UNIVERSE_ARCHIVE_VERSION = 'evidence-universe-archive-v3' as const;
const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const MEDIA_KINDS = ['document', 'photo', 'video'] as const;

type EvidenceMediaSource = {
  inspectSnapshot: () => Promise<EvidenceMediaSnapshot>;
  fetchPage: (kind: string, cursor: EvidenceMediaCursor | null, limit: number) => Promise<EvidenceMediaPage>;
};

export type EvidenceUniversePart = {
  partNumber: number;
  kind: EvidenceUniverseNodeKind;
  rowCount: number;
  archiveKey: string;
  manifestKey: string;
  compressedBytes: number;
  uncompressedBytes: number;
  sha256: string;
  firstAddress: string;
  lastAddress: string;
  cursor: CaseGraphCursor | EvidenceMediaCursor;
  accounting: EvidenceUniverseAccounting;
};

export type EvidenceUniverseExpected = {
  snapshotId: string;
  snapshotAt: string;
  materializedAt: string;
  sourceMvccSnapshot: string;
  snapshotPolicy: typeof EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY;
  capturePolicies: Record<EvidenceUniverseNodeKind, string>;
  byKind: Record<EvidenceUniverseNodeKind, number>;
  total: number;
  sightingPolicy: string;
  mediaBackfillsComplete: Record<'document' | 'photo' | 'video', boolean>;
};

export type EvidenceUniverseCheckpoint = {
  recordType: 'evidence_universe_checkpoint';
  archiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
  schemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  layoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  corpusVersion: string;
  expected: EvidenceUniverseExpected;
  exportedByKind: Record<EvidenceUniverseNodeKind, number>;
  cursors: Record<EvidenceUniverseNodeKind, CaseGraphCursor | EvidenceMediaCursor | null>;
  parts: EvidenceUniversePart[];
  /**
   * Deterministic identity of a cross-corpus seed. Export checkpoints preserve
   * it so a seeder can reconcile an ambiguously acknowledged final CAS.
   */
  seedFingerprint?: string;
  updatedAt: string;
};

export type EvidenceUniverseCompletion = Omit<EvidenceUniverseCheckpoint, 'recordType' | 'updatedAt'> & {
  recordType: 'evidence_universe_completion';
  accounting: EvidenceUniverseAccounting;
  archiveSetSha256: string;
  completedAt: string;
};

const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const emptyCounts = (): Record<EvidenceUniverseNodeKind, number> => ({ sighting: 0, document: 0, photo: 0, video: 0 });
const emptyCursors = (): EvidenceUniverseCheckpoint['cursors'] => ({ sighting: null, document: null, photo: null, video: null });
const countTotal = (counts: Record<EvidenceUniverseNodeKind, number>) => KINDS.reduce((sum, kind) => sum + counts[kind], 0);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const failCheckpoint = (): never => {
  throw new Error('evidence_universe_checkpoint_invalid');
};

const failSourceCursor = (): never => {
  throw new Error('evidence_universe_source_cursor_invalid');
};

const timestampSortKey = (value: unknown, onInvalid: () => never) => {
  if (typeof value !== 'string') return onInvalid();
  const timestamp = value.trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) return onInvalid();
  const epochMs = Date.parse(timestamp);
  const fraction = timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] || '';
  if (!Number.isFinite(epochMs) || fraction.length > 9) return onInvalid();
  return { timestamp, epochMs, fraction: fraction.padEnd(9, '0') };
};

const normalizeCountRecord = (value: unknown, onInvalid: () => never) => {
  if (!isObject(value)) return onInvalid();
  const counts = emptyCounts();
  for (const kind of KINDS) {
    const count = value[kind];
    if (!Number.isSafeInteger(count) || Number(count) < 0) return onInvalid();
    counts[kind] = Number(count);
  }
  return counts;
};

const normalizeExpected = (value: unknown, onInvalid: () => never): EvidenceUniverseExpected => {
  if (
    !isObject(value)
    || typeof value.snapshotId !== 'string'
    || typeof value.snapshotAt !== 'string'
    || typeof value.materializedAt !== 'string'
    || typeof value.sourceMvccSnapshot !== 'string'
    || value.snapshotPolicy !== EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY
    || typeof value.sightingPolicy !== 'string'
    || !isObject(value.capturePolicies)
  ) {
    return onInvalid();
  }
  const snapshot = timestampSortKey(value.snapshotAt, onInvalid);
  const materialized = timestampSortKey(value.materializedAt, onInvalid);
  const byKind = normalizeCountRecord(value.byKind, onInvalid);
  const total = value.total;
  const sightingPolicy = value.sightingPolicy.trim();
  const snapshotId = value.snapshotId.trim().toLowerCase();
  const sourceMvccSnapshot = value.sourceMvccSnapshot.trim();
  if (
    !Number.isSafeInteger(total)
    || Number(total) < 0
    || Number(total) !== countTotal(byKind)
    || !sightingPolicy
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(sourceMvccSnapshot)
  ) {
    return onInvalid();
  }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(snapshotId)) {
    return onInvalid();
  }
  const capturePolicies = {
    sighting: value.capturePolicies.sighting,
    document: value.capturePolicies.document,
    photo: value.capturePolicies.photo,
    video: value.capturePolicies.video,
  };
  if (
    capturePolicies.sighting !== EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY
    || MEDIA_KINDS.some((kind) => capturePolicies[kind] !== EVIDENCE_MEDIA_SNAPSHOT_POLICY)
  ) return onInvalid();
  if (!isObject(value.mediaBackfillsComplete)) return onInvalid();
  const mediaBackfillsComplete = {
    document: value.mediaBackfillsComplete.document,
    photo: value.mediaBackfillsComplete.photo,
    video: value.mediaBackfillsComplete.video,
  };
  if (MEDIA_KINDS.some((kind) => mediaBackfillsComplete[kind] !== true)) return onInvalid();
  return {
    snapshotId,
    snapshotAt: new Date(snapshot.epochMs).toISOString(),
    materializedAt: materialized.timestamp,
    sourceMvccSnapshot,
    snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capturePolicies: {
      sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
      document: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      photo: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      video: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    },
    byKind,
    total: Number(total),
    sightingPolicy,
    mediaBackfillsComplete: { document: true, photo: true, video: true },
  };
};

const normalizeCursor = (
  kind: EvidenceUniverseNodeKind,
  value: unknown,
  onInvalid: () => never,
): CaseGraphCursor | EvidenceMediaCursor => {
  if (!isObject(value)) return onInvalid();
  const timestampField = kind === 'sighting' ? 'updated_at' : 'updatedAt';
  const idField = kind === 'sighting' ? 'case_id' : 'recordId';
  const timestamp = timestampSortKey(value[timestampField], onInvalid).timestamp;
  const rawId = value[idField];
  if (typeof rawId !== 'string') return onInvalid();
  // Media entity IDs participate in PostgreSQL C-collation keyset ordering.
  // Preserve their exact bytes; trimming here can skip or duplicate a boundary
  // record when an upstream identifier contains significant whitespace.
  const id = rawId;
  if (!id.length || id.length > 512) return onInvalid();
  return kind === 'sighting' ? { updated_at: timestamp, case_id: id } : { updatedAt: timestamp, recordId: id };
};

const cursorSortKey = (
  kind: EvidenceUniverseNodeKind,
  value: CaseGraphCursor | EvidenceMediaCursor,
  onInvalid: () => never,
) => {
  const cursor = normalizeCursor(kind, value, onInvalid);
  const timestamp = timestampSortKey(
    kind === 'sighting' ? (cursor as CaseGraphCursor).updated_at : (cursor as EvidenceMediaCursor).updatedAt,
    onInvalid,
  );
  return {
    ...timestamp,
    id: kind === 'sighting' ? (cursor as CaseGraphCursor).case_id : (cursor as EvidenceMediaCursor).recordId,
  };
};

const compareCursors = (
  kind: EvidenceUniverseNodeKind,
  left: CaseGraphCursor | EvidenceMediaCursor,
  right: CaseGraphCursor | EvidenceMediaCursor,
  onInvalid: () => never = failCheckpoint,
) => {
  const leftKey = cursorSortKey(kind, left, onInvalid);
  const rightKey = cursorSortKey(kind, right, onInvalid);
  const fractionOrder = leftKey.fraction === rightKey.fraction ? 0 : leftKey.fraction < rightKey.fraction ? -1 : 1;
  const idOrder = leftKey.id === rightKey.id ? 0 : leftKey.id < rightKey.id ? -1 : 1;
  return leftKey.epochMs - rightKey.epochMs
    || fractionOrder
    || idOrder;
};

const normalizeAccounting = (
  value: unknown,
  partKind: EvidenceUniverseNodeKind,
  rowCount: number,
  onInvalid: () => never,
): EvidenceUniverseAccounting => {
  if (!isObject(value)) return onInvalid();
  const byKind = normalizeCountRecord(value.byKind, onInvalid);
  const total = value.total;
  const attachedMedia = value.attachedMedia;
  const unresolvedTime = value.unresolvedTime;
  const unresolvedLocation = value.unresolvedLocation;
  if (
    !Number.isSafeInteger(total)
    || !Number.isSafeInteger(attachedMedia)
    || !Number.isSafeInteger(unresolvedTime)
    || !Number.isSafeInteger(unresolvedLocation)
    || Number(total) !== rowCount
    || Number(total) !== countTotal(byKind)
    || KINDS.some((kind) => byKind[kind] !== (kind === partKind ? rowCount : 0))
    || Number(attachedMedia) < 0
    || Number(attachedMedia) > (partKind === 'sighting' ? 0 : rowCount)
    || Number(unresolvedTime) < 0
    || Number(unresolvedTime) > rowCount
    || Number(unresolvedLocation) < 0
    || Number(unresolvedLocation) > rowCount
  ) return onInvalid();
  return {
    total: Number(total),
    byKind,
    attachedMedia: Number(attachedMedia),
    unresolvedTime: Number(unresolvedTime),
    unresolvedLocation: Number(unresolvedLocation),
  };
};

type ArchiveUploadOptions = {
  contentType: string;
  contentEncoding?: string;
  cacheControl: string;
  contentLength: number;
};

const conditionalStorage = (storage: CaseGraphArchiveStorage): CaseGraphConditionalArchiveStorage => {
  const candidate = storage as Partial<CaseGraphConditionalArchiveStorage>;
  if (typeof candidate.readObjectVersioned !== 'function' || typeof candidate.uploadFileConditional !== 'function') {
    throw new Error('evidence_universe_conditional_storage_required');
  }
  return storage as CaseGraphConditionalArchiveStorage;
};

const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

const writeImmutable = async (
  storage: CaseGraphConditionalArchiveStorage,
  body: Buffer,
  key: string,
  options: ArchiveUploadOptions,
) => {
  const result = await storage.uploadFileConditional(body, key, options, { ifAbsent: true });
  if (result.status === 'written') return;
  const existing = await storage.readObject(key);
  if (!existing?.equals(body)) throw new Error(`evidence_universe_immutable_object_conflict:${key}`);
};

const writeCheckpoint = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  checkpoint: EvidenceUniverseCheckpoint,
  previousVersion: string | null,
) => {
  const body = jsonBody(checkpoint);
  const result = await storage.uploadFileConditional(
    body,
    key,
    { contentType: 'application/json', cacheControl: 'private, no-store', contentLength: body.length },
    previousVersion === null ? { ifAbsent: true } : { ifVersion: previousVersion },
  );
  if (result.status === 'precondition_failed') throw new Error('evidence_universe_concurrent_writer_detected');
  return { body, version: result.version };
};

const parseObject = <T>(body: Buffer, label: string): T => {
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not_object');
    return value as T;
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
};

const inspectExpected = async (sightings: CaseGraphFeatureSource, media: EvidenceMediaSource): Promise<EvidenceUniverseExpected> => {
  const [sightingSnapshot, mediaSnapshot] = await Promise.all([sightings.inspectEligibleSnapshot(), media.inspectSnapshot()]);
  const sightingTime = new Date(sightingSnapshot.snapshot_at).toISOString();
  const mediaTime = new Date(mediaSnapshot.snapshotAt).toISOString();
  const materializedSighting = sightingSnapshot as typeof sightingSnapshot & {
    snapshot_id?: unknown;
    snapshot_policy?: unknown;
    capture_policy?: unknown;
    materialized_at?: unknown;
    source_mvcc_snapshot?: unknown;
  };
  const sightingMaterializedAt = String(materializedSighting.materialized_at || '').trim();
  const mediaMaterializedAt = String(mediaSnapshot.materializedAt || '').trim();
  if (
    sightingTime !== mediaTime
    || materializedSighting.snapshot_id !== mediaSnapshot.snapshotId
    || materializedSighting.snapshot_policy !== mediaSnapshot.snapshotPolicy
    || sightingMaterializedAt !== mediaMaterializedAt
    || materializedSighting.source_mvcc_snapshot !== mediaSnapshot.sourceMvccSnapshot
  ) throw new Error('evidence_universe_snapshot_mismatch');
  return normalizeExpected({
    snapshotId: mediaSnapshot.snapshotId,
    snapshotAt: sightingTime,
    materializedAt: mediaMaterializedAt,
    sourceMvccSnapshot: mediaSnapshot.sourceMvccSnapshot,
    snapshotPolicy: mediaSnapshot.snapshotPolicy,
    capturePolicies: {
      sighting: materializedSighting.capture_policy,
      document: mediaSnapshot.capturePolicy,
      photo: mediaSnapshot.capturePolicy,
      video: mediaSnapshot.capturePolicy,
    },
    byKind: {
      sighting: sightingSnapshot.eligible_count,
      document: mediaSnapshot.counts.document,
      photo: mediaSnapshot.counts.photo,
      video: mediaSnapshot.counts.video,
    },
    total: sightingSnapshot.eligible_count
      + mediaSnapshot.counts.document
      + mediaSnapshot.counts.photo
      + mediaSnapshot.counts.video,
    sightingPolicy: sightingSnapshot.publishability_policy,
    mediaBackfillsComplete: mediaSnapshot.backfillsComplete,
  }, () => { throw new Error('evidence_universe_expected_invalid'); });
};

const validateCheckpoint = (input: unknown, corpusVersion: string): EvidenceUniverseCheckpoint => {
  if (!isObject(input)) return failCheckpoint();
  if (
    input.recordType !== 'evidence_universe_checkpoint'
    || input.archiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || input.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || input.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || input.corpusVersion !== corpusVersion
    || !Array.isArray(input.parts)
    || !isObject(input.cursors)
  ) return failCheckpoint();

  const expected = normalizeExpected(input.expected, failCheckpoint);
  const exportedByKind = normalizeCountRecord(input.exportedByKind, failCheckpoint);
  const parts: EvidenceUniversePart[] = [];
  const partCounts = emptyCounts();
  const partRows = emptyCounts();
  const lastPartCursors = emptyCursors();
  let lastKindIndex = -1;

  for (const value of input.parts) {
    if (!isObject(value) || !KINDS.includes(value.kind as EvidenceUniverseNodeKind)) return failCheckpoint();
    const kind = value.kind as EvidenceUniverseNodeKind;
    const kindIndex = KINDS.indexOf(kind);
    const partNumber = value.partNumber;
    const rowCount = value.rowCount;
    if (
      kindIndex < lastKindIndex
      || !Number.isSafeInteger(partNumber)
      || Number(partNumber) > 999_999
      || Number(partNumber) !== partCounts[kind]
      || !Number.isSafeInteger(rowCount)
      || Number(rowCount) < 1
      || !Number.isSafeInteger(value.compressedBytes)
      || Number(value.compressedBytes) < 1
      || !Number.isSafeInteger(value.uncompressedBytes)
      || Number(value.uncompressedBytes) < 1
      || !/^[a-f0-9]{64}$/.test(String(value.sha256 || ''))
    ) return failCheckpoint();
    const canonicalKeys = getEvidenceUniversePartKeys(corpusVersion, kind, Number(partNumber));
    const addressPrefix = `${kind}:`;
    if (
      value.archiveKey !== canonicalKeys.archiveKey
      || value.manifestKey !== canonicalKeys.manifestKey
      || typeof value.firstAddress !== 'string'
      || typeof value.lastAddress !== 'string'
      || value.firstAddress.length <= addressPrefix.length
      || value.lastAddress.length <= addressPrefix.length
      || !value.firstAddress.startsWith(addressPrefix)
      || !value.lastAddress.startsWith(addressPrefix)
    ) return failCheckpoint();
    const cursor = normalizeCursor(kind, value.cursor, failCheckpoint);
    const previousCursor = lastPartCursors[kind];
    if (previousCursor && compareCursors(kind, cursor, previousCursor) <= 0) return failCheckpoint();
    const accounting = normalizeAccounting(value.accounting, kind, Number(rowCount), failCheckpoint);
    parts.push({
      partNumber: Number(partNumber),
      kind,
      rowCount: Number(rowCount),
      archiveKey: canonicalKeys.archiveKey,
      manifestKey: canonicalKeys.manifestKey,
      compressedBytes: Number(value.compressedBytes),
      uncompressedBytes: Number(value.uncompressedBytes),
      sha256: String(value.sha256),
      firstAddress: value.firstAddress,
      lastAddress: value.lastAddress,
      cursor,
      accounting,
    });
    partCounts[kind] += 1;
    partRows[kind] += Number(rowCount);
    lastPartCursors[kind] = cursor;
    lastKindIndex = kindIndex;
  }

  const cursors = emptyCursors();
  for (const kind of KINDS) {
    if (
      exportedByKind[kind] !== partRows[kind]
      || exportedByKind[kind] > expected.byKind[kind]
    ) return failCheckpoint();
    const rawCursor = input.cursors[kind];
    const lastPartCursor = lastPartCursors[kind];
    if (!lastPartCursor) {
      if (rawCursor !== null) return failCheckpoint();
      cursors[kind] = null;
      continue;
    }
    if (rawCursor === null || rawCursor === undefined) return failCheckpoint();
    const cursor = normalizeCursor(kind, rawCursor, failCheckpoint);
    if (compareCursors(kind, cursor, lastPartCursor) !== 0) return failCheckpoint();
    cursors[kind] = cursor;
  }

  let foundIncompleteKind = false;
  for (const kind of KINDS) {
    if (foundIncompleteKind && exportedByKind[kind] !== 0) return failCheckpoint();
    if (exportedByKind[kind] < expected.byKind[kind]) foundIncompleteKind = true;
  }

  const seedFingerprint = input.seedFingerprint;
  if (seedFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(String(seedFingerprint))) {
    return failCheckpoint();
  }
  if (typeof input.updatedAt !== 'string') return failCheckpoint();
  timestampSortKey(input.updatedAt, failCheckpoint);
  return {
    recordType: 'evidence_universe_checkpoint',
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion,
    expected,
    exportedByKind,
    cursors,
    parts,
    ...(seedFingerprint === undefined ? {} : { seedFingerprint: String(seedFingerprint) }),
    updatedAt: input.updatedAt.trim(),
  };
};

export const decodeEvidenceUniverseCheckpoint = (body: Buffer, corpusVersion: string) => (
  validateCheckpoint(
    parseObject<unknown>(body, 'evidence_universe_checkpoint'),
    corpusVersion,
  )
);

const expectedEqual = (left: EvidenceUniverseExpected, right: EvidenceUniverseExpected) => (
  JSON.stringify(left) === JSON.stringify(right)
);

const combineAccounting = (parts: EvidenceUniversePart[]): EvidenceUniverseAccounting => {
  const byKind = emptyCounts();
  let attachedMedia = 0;
  let unresolvedTime = 0;
  let unresolvedLocation = 0;
  for (const part of parts) {
    for (const kind of KINDS) byKind[kind] += part.accounting.byKind[kind];
    attachedMedia += part.accounting.attachedMedia;
    unresolvedTime += part.accounting.unresolvedTime;
    unresolvedLocation += part.accounting.unresolvedLocation;
  }
  return { total: countTotal(byKind), byKind, attachedMedia, unresolvedTime, unresolvedLocation };
};

const accountingEqual = (left: EvidenceUniverseAccounting, right: EvidenceUniverseAccounting) => (
  left.total === right.total
  && KINDS.every((kind) => left.byKind[kind] === right.byKind[kind])
  && left.attachedMedia === right.attachedMedia
  && left.unresolvedTime === right.unresolvedTime
  && left.unresolvedLocation === right.unresolvedLocation
);

const verifyStoredUniverseParts = async (
  storage: CaseGraphArchiveStorage,
  parts: EvidenceUniversePart[],
  expectedTotal: number,
) => {
  const seen = new Set<string>();
  for (const part of parts) {
    const [archive, manifest] = await Promise.all([
      storage.readObject(part.archiveKey),
      storage.readObject(part.manifestKey),
    ]);
    if (
      !archive
      || archive.length !== part.compressedBytes
      || sha256(archive) !== part.sha256
      || !manifest?.equals(jsonBody(part))
    ) throw new Error('evidence_universe_final_part_verification_failed');
    let raw: Buffer;
    try {
      raw = gunzipSync(archive);
    } catch {
      throw new Error('evidence_universe_final_part_compression_invalid');
    }
    if (raw.length !== part.uncompressedBytes) throw new Error('evidence_universe_final_part_bytes_mismatch');
    const rawText = raw.toString('utf8');
    if (!rawText.endsWith('\n')) throw new Error('evidence_universe_final_part_ndjson_invalid');
    const lines = rawText.slice(0, -1).split('\n');
    if (lines.some((line) => !line)) throw new Error('evidence_universe_final_part_ndjson_invalid');
    if (lines.length !== part.rowCount) throw new Error('evidence_universe_final_part_count_mismatch');
    const nodes = lines.map((line) => parseObject<EvidenceUniverseNode>(
      Buffer.from(line),
      'evidence_universe_final_node',
    ));
    if (
      nodes[0]?.address !== part.firstAddress
      || nodes.at(-1)?.address !== part.lastAddress
      || nodes.some((node) => node.kind !== part.kind)
    ) throw new Error('evidence_universe_final_node_kind_mismatch');
    let recomputedAccounting: EvidenceUniverseAccounting;
    try {
      recomputedAccounting = accountEvidenceUniverseNodes(nodes);
    } catch {
      throw new Error('evidence_universe_final_node_layout_invalid');
    }
    if (!accountingEqual(recomputedAccounting, part.accounting)) {
      throw new Error('evidence_universe_final_part_accounting_mismatch');
    }
    for (const node of nodes) {
      if (seen.has(node.address)) throw new Error(`evidence_universe_duplicate_address_across_parts:${node.address}`);
      seen.add(node.address);
    }
    const cursorId = part.kind === 'sighting'
      ? (part.cursor as CaseGraphCursor).case_id
      : (part.cursor as EvidenceMediaCursor).recordId;
    if (String(cursorId).trim().toLowerCase() !== nodes.at(-1)!.recordId) {
      throw new Error('evidence_universe_final_part_cursor_mismatch');
    }
  }
  if (seen.size !== expectedTotal) throw new Error('evidence_universe_final_unique_count_mismatch');
};

export const archiveEvidenceUniverse = async (params: {
  corpusVersion: string;
  sightings: CaseGraphFeatureSource;
  media: EvidenceMediaSource;
  storage: CaseGraphArchiveStorage;
  pageSize?: number;
  maxPartsPerRun?: number;
  now?: () => Date;
}) => {
  const pageSize = Math.trunc(params.pageSize ?? 10_000);
  const maxParts = Math.trunc(params.maxPartsPerRun ?? 4);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 25_000) throw new Error('evidence_universe_page_size_invalid');
  if (!Number.isSafeInteger(maxParts) || maxParts < 1 || maxParts > 100) throw new Error('evidence_universe_max_parts_invalid');
  const now = params.now || (() => new Date());
  const storage = conditionalStorage(params.storage);
  const keys = getEvidenceUniverseControlKeys(params.corpusVersion);
  const existingCompletion = await storage.readObject(keys.completionManifestKey);
  if (existingCompletion) {
    const { decodeEvidenceUniverseCompletion } = await import('./evidenceUniversePublicAccess');
    let completion: EvidenceUniverseCompletion;
    try {
      completion = decodeEvidenceUniverseCompletion(existingCompletion, params.corpusVersion);
    } catch {
      throw new Error('evidence_universe_completion_invalid');
    }
    const currentExpected = await inspectExpected(params.sightings, params.media);
    if (!expectedEqual(currentExpected, completion.expected)) {
      throw new Error('evidence_universe_source_changed_during_export');
    }
    await verifyStoredUniverseParts(storage, completion.parts, completion.expected.total);
    return { status: 'already_complete' as const, completion };
  }

  const checkpointObject = await storage.readObjectVersioned(keys.checkpointKey);
  const checkpointBody = checkpointObject?.body || null;
  let checkpointVersion = checkpointObject?.version || null;
  let checkpoint: EvidenceUniverseCheckpoint;
  if (checkpointBody) {
    checkpoint = validateCheckpoint(
      parseObject<unknown>(checkpointBody, 'evidence_universe_checkpoint'),
      params.corpusVersion,
    );
    const currentExpected = await inspectExpected(params.sightings, params.media);
    if (!expectedEqual(currentExpected, checkpoint.expected)) {
      throw new Error('evidence_universe_source_changed_during_export');
    }
  } else {
    checkpoint = {
      recordType: 'evidence_universe_checkpoint' as const,
      archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
      schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      corpusVersion: params.corpusVersion,
      expected: await inspectExpected(params.sightings, params.media),
      exportedByKind: emptyCounts(),
      cursors: emptyCursors(),
      parts: [],
      updatedAt: now().toISOString(),
    };
  }
  if (!checkpointBody) {
    const initialCheckpoint = await writeCheckpoint(storage, keys.checkpointKey, checkpoint, null);
    checkpointVersion = initialCheckpoint.version;
    if (!(await storage.readObject(keys.checkpointKey))?.equals(initialCheckpoint.body)) {
      throw new Error('evidence_universe_checkpoint_read_after_write_failed');
    }
  }
  if (!checkpointVersion) throw new Error('evidence_universe_checkpoint_version_missing');

  let written = 0;
  while (countTotal(checkpoint.exportedByKind) < checkpoint.expected.total && written < maxParts) {
    const kind = KINDS.find((candidate) => checkpoint.exportedByKind[candidate] < checkpoint.expected.byKind[candidate]);
    if (!kind) throw new Error('evidence_universe_accounting_dead_end');
    let nodes: EvidenceUniverseNode[];
    let cursor: CaseGraphCursor | EvidenceMediaCursor;
    if (kind === 'sighting') {
      const rows = await params.sightings.fetchEligiblePage(checkpoint.cursors.sighting as CaseGraphCursor | null, pageSize);
      if (!rows.length) throw new Error('evidence_universe_source_ended_early');
      let previousCursor = checkpoint.cursors.sighting as CaseGraphCursor | null;
      for (const row of rows) {
        const rowCursor = normalizeCursor('sighting', row.cursor, failSourceCursor) as CaseGraphCursor;
        if (previousCursor && compareCursors('sighting', rowCursor, previousCursor, failSourceCursor) <= 0) {
          throw new Error('evidence_universe_source_cursor_did_not_advance');
        }
        previousCursor = rowCursor;
      }
      cursor = previousCursor!;
      nodes = rows.map(projectSightingEvidenceUniverseNode);
    } else {
      const page = await params.media.fetchPage(kind, checkpoint.cursors[kind] as EvidenceMediaCursor | null, pageSize);
      nodes = page.nodes;
      if (!nodes.length || !page.nextCursor) throw new Error('evidence_universe_source_ended_early');
      cursor = normalizeCursor(kind, page.nextCursor, failSourceCursor);
      const previousCursor = checkpoint.cursors[kind];
      if (previousCursor && compareCursors(kind, cursor, previousCursor, failSourceCursor) <= 0) {
        throw new Error('evidence_universe_source_cursor_did_not_advance');
      }
    }
    if (!nodes.length || nodes.length > pageSize) throw new Error('evidence_universe_page_invalid');
    if (checkpoint.exportedByKind[kind] + nodes.length > checkpoint.expected.byKind[kind]) {
      throw new Error('evidence_universe_source_exceeded_expected_count');
    }
    const partNumber = checkpoint.parts.filter((part) => part.kind === kind).length;
    const partKeys = getEvidenceUniversePartKeys(params.corpusVersion, kind, partNumber);
    const raw = Buffer.from(`${nodes.map((node) => JSON.stringify(node)).join('\n')}\n`);
    const archive = gzipSync(raw, { level: 9 });
    const accounting = accountEvidenceUniverseNodes(nodes);
    const part: EvidenceUniversePart = {
      partNumber,
      kind,
      rowCount: nodes.length,
      archiveKey: partKeys.archiveKey,
      manifestKey: partKeys.manifestKey,
      compressedBytes: archive.length,
      uncompressedBytes: raw.length,
      sha256: sha256(archive),
      firstAddress: nodes[0].address,
      lastAddress: nodes.at(-1)!.address,
      cursor,
      accounting,
    };
    await writeImmutable(storage, archive, part.archiveKey, {
      contentType: 'application/x-ndjson', contentEncoding: 'gzip',
      cacheControl: 'public, max-age=31536000, immutable', contentLength: archive.length,
    });
    const partManifest = jsonBody(part);
    await writeImmutable(storage, partManifest, part.manifestKey, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: partManifest.length,
    });
    const [storedArchive, storedManifest] = await Promise.all([
      storage.readObject(part.archiveKey), storage.readObject(part.manifestKey),
    ]);
    if (!storedArchive || sha256(storedArchive) !== part.sha256 || !storedManifest?.equals(partManifest)) {
      throw new Error('evidence_universe_part_read_after_write_failed');
    }
    checkpoint = {
      ...checkpoint,
      exportedByKind: { ...checkpoint.exportedByKind, [kind]: checkpoint.exportedByKind[kind] + nodes.length },
      cursors: { ...checkpoint.cursors, [kind]: cursor },
      parts: [...checkpoint.parts, part],
      updatedAt: now().toISOString(),
    };
    const checkpointWritten = await writeCheckpoint(storage, keys.checkpointKey, checkpoint, checkpointVersion);
    checkpointVersion = checkpointWritten.version;
    if (!(await storage.readObject(keys.checkpointKey))?.equals(checkpointWritten.body)) {
      throw new Error('evidence_universe_checkpoint_read_after_write_failed');
    }
    written += 1;
  }

  if (countTotal(checkpoint.exportedByKind) < checkpoint.expected.total) {
    return { status: 'partial' as const, checkpoint, remainingNodes: checkpoint.expected.total - countTotal(checkpoint.exportedByKind) };
  }
  const finalExpected = await inspectExpected(params.sightings, params.media);
  if (!expectedEqual(finalExpected, checkpoint.expected)) throw new Error('evidence_universe_source_changed_during_export');
  const accounting = combineAccounting(checkpoint.parts);
  if (accounting.total !== checkpoint.expected.total || JSON.stringify(accounting.byKind) !== JSON.stringify(checkpoint.expected.byKind)) {
    throw new Error('evidence_universe_final_accounting_mismatch');
  }
  await verifyStoredUniverseParts(storage, checkpoint.parts, checkpoint.expected.total);
  const completedAt = now().toISOString();
  const completion: EvidenceUniverseCompletion = {
    recordType: 'evidence_universe_completion',
    archiveVersion: checkpoint.archiveVersion,
    schemaVersion: checkpoint.schemaVersion,
    layoutVersion: checkpoint.layoutVersion,
    corpusVersion: checkpoint.corpusVersion,
    expected: checkpoint.expected,
    exportedByKind: checkpoint.exportedByKind,
    cursors: checkpoint.cursors,
    parts: checkpoint.parts,
    ...(checkpoint.seedFingerprint ? { seedFingerprint: checkpoint.seedFingerprint } : {}),
    accounting,
    archiveSetSha256: sha256(checkpoint.parts.map((part) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n')),
    completedAt,
  };
  const completionWritten = jsonBody(completion);
  await writeImmutable(storage, completionWritten, keys.completionManifestKey, {
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable',
    contentLength: completionWritten.length,
  });
  if (!(await storage.readObject(keys.completionManifestKey))?.equals(completionWritten)) {
    throw new Error('evidence_universe_completion_read_after_write_failed');
  }
  return { status: 'complete' as const, completion };
};
