import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  getCaseGraphCorpusPrefix,
  getEvidenceUniverseControlKeys,
  getEvidenceUniversePartKeys,
} from './archiveKeys';
import type {
  CaseGraphArchiveStorage,
  CaseGraphCursor,
  CaseGraphListableConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCheckpoint,
  type EvidenceUniverseExpected,
  type EvidenceUniversePart,
} from './evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  evidenceUniverseAddress,
  type EvidenceUniverseAccounting,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  type EvidenceMediaCursor,
} from './postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from './postgresEvidenceUniverseSnapshot';

const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const MEDIA_KINDS = ['document', 'photo', 'video'] as const;

type UniverseCursor = CaseGraphCursor | EvidenceMediaCursor;

type VerifiedSourcePart = {
  source: EvidenceUniversePart;
  target: EvidenceUniversePart;
};

type EvidenceUniverseSeedIntent = {
  recordType: 'evidence_universe_seed_intent';
  intentVersion: 1;
  archiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
  schemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  layoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  sourceCorpusVersion: string;
  targetCorpusVersion: string;
  snapshotId: string;
  snapshotAt: string;
  selectedKinds: EvidenceUniverseNodeKind[];
  seedFingerprint: string;
};

type SeedCheckpointMaterial = Omit<
  EvidenceUniverseCheckpoint,
  'recordType' | 'seedFingerprint' | 'updatedAt'
>;

function fail(code: string): never {
  throw new Error(code);
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const normalizeCorpusVersion = (value: unknown, label: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(normalized)) fail(`${label}_invalid`);
  return normalized;
};

const normalizeTimestamp = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label}_invalid`);
  const raw = value.trim();
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) fail(`${label}_invalid`);
  return { raw, iso: parsed.toISOString() };
};

const timestampSortKey = (value: unknown, label: string) => {
  const { raw } = normalizeTimestamp(value, label);
  const match = raw.match(/^(.*?:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i);
  if (!match) fail(`${label}_invalid`);
  const epochMs = Date.parse(raw);
  return {
    epochMs,
    fraction: (match[2] || '').padEnd(9, '0'),
  };
};

const emptyCounts = (): Record<EvidenceUniverseNodeKind, number> => ({
  sighting: 0,
  document: 0,
  photo: 0,
  video: 0,
});

const emptyCursors = (): EvidenceUniverseCheckpoint['cursors'] => ({
  sighting: null,
  document: null,
  photo: null,
  video: null,
});

const countTotal = (counts: Record<EvidenceUniverseNodeKind, number>) => (
  KINDS.reduce((sum, kind) => sum + counts[kind], 0)
);

const normalizeCounts = (value: unknown, label: string) => {
  if (!isObject(value)) fail(`${label}_invalid`);
  const counts = emptyCounts();
  for (const kind of KINDS) {
    const count = value[kind];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) fail(`${label}_invalid`);
    counts[kind] = count;
  }
  return counts;
};

const normalizeExpected = (value: unknown): EvidenceUniverseExpected => {
  if (!isObject(value)) fail('evidence_universe_seed_source_checkpoint_invalid');
  const snapshotId = typeof value.snapshotId === 'string' ? value.snapshotId.trim().toLowerCase() : '';
  const snapshotAt = normalizeTimestamp(value.snapshotAt, 'evidence_universe_seed_source_snapshot').iso;
  const materializedAt = normalizeTimestamp(
    value.materializedAt,
    'evidence_universe_seed_source_materialized_snapshot',
  ).raw;
  timestampSortKey(materializedAt, 'evidence_universe_seed_source_materialized_snapshot');
  const byKind = normalizeCounts(value.byKind, 'evidence_universe_seed_source_expected_counts');
  const total = value.total;
  const sightingPolicy = typeof value.sightingPolicy === 'string' ? value.sightingPolicy.trim() : '';
  const sourceMvccSnapshot = typeof value.sourceMvccSnapshot === 'string'
    ? value.sourceMvccSnapshot.trim()
    : '';
  const capturePolicies = value.capturePolicies;
  const mediaBackfillsComplete = value.mediaBackfillsComplete;
  if (
    typeof total !== 'number'
    || !Number.isSafeInteger(total)
    || total < 0
    || total !== countTotal(byKind)
    || !sightingPolicy
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(snapshotId)
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(sourceMvccSnapshot)
    || value.snapshotPolicy !== EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY
    || !isObject(capturePolicies)
    || capturePolicies.sighting !== EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY
    || MEDIA_KINDS.some((kind) => capturePolicies[kind] !== EVIDENCE_MEDIA_SNAPSHOT_POLICY)
    || !isObject(mediaBackfillsComplete)
  ) fail('evidence_universe_seed_source_checkpoint_invalid');
  if (MEDIA_KINDS.some((kind) => mediaBackfillsComplete[kind] !== true)) {
    fail('evidence_universe_seed_source_checkpoint_invalid');
  }
  return {
    snapshotId,
    snapshotAt,
    materializedAt,
    sourceMvccSnapshot,
    snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capturePolicies: {
      sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
      document: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      photo: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      video: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    },
    byKind,
    total,
    sightingPolicy,
    mediaBackfillsComplete: { document: true, photo: true, video: true },
  };
};

const normalizeCursor = (
  kind: EvidenceUniverseNodeKind,
  value: unknown,
  label = 'evidence_universe_seed_source_checkpoint_invalid',
): UniverseCursor => {
  if (!isObject(value)) fail(label);
  if (kind === 'sighting') {
    const updatedAt = normalizeTimestamp(value.updated_at, label).raw;
    const caseId = typeof value.case_id === 'string' ? value.case_id : '';
    if (!caseId || caseId.length > 512) fail(label);
    return { updated_at: updatedAt, case_id: caseId };
  }
  const updatedAt = normalizeTimestamp(value.updatedAt, label).raw;
  const recordId = typeof value.recordId === 'string' ? value.recordId : '';
  if (!recordId || recordId.length > 512) fail(label);
  return { updatedAt, recordId };
};

const compareCursors = (kind: EvidenceUniverseNodeKind, left: UniverseCursor, right: UniverseCursor) => {
  const leftTimestamp = kind === 'sighting'
    ? (left as CaseGraphCursor).updated_at
    : (left as EvidenceMediaCursor).updatedAt;
  const rightTimestamp = kind === 'sighting'
    ? (right as CaseGraphCursor).updated_at
    : (right as EvidenceMediaCursor).updatedAt;
  const leftKey = timestampSortKey(leftTimestamp, 'evidence_universe_seed_source_checkpoint_invalid');
  const rightKey = timestampSortKey(rightTimestamp, 'evidence_universe_seed_source_checkpoint_invalid');
  const leftId = kind === 'sighting' ? (left as CaseGraphCursor).case_id : (left as EvidenceMediaCursor).recordId;
  const rightId = kind === 'sighting' ? (right as CaseGraphCursor).case_id : (right as EvidenceMediaCursor).recordId;
  return leftKey.epochMs - rightKey.epochMs
    || leftKey.fraction.localeCompare(rightKey.fraction)
    || leftId.localeCompare(rightId);
};

const normalizeAccounting = (
  value: unknown,
  kind: EvidenceUniverseNodeKind,
  rowCount: number,
): EvidenceUniverseAccounting => {
  if (!isObject(value)) fail('evidence_universe_seed_source_checkpoint_invalid');
  const byKind = normalizeCounts(value.byKind, 'evidence_universe_seed_source_checkpoint');
  const total = value.total;
  const attachedMedia = value.attachedMedia;
  const unresolvedTime = value.unresolvedTime;
  const unresolvedLocation = value.unresolvedLocation;
  if (
    typeof total !== 'number'
    || typeof attachedMedia !== 'number'
    || typeof unresolvedTime !== 'number'
    || typeof unresolvedLocation !== 'number'
    || ![total, attachedMedia, unresolvedTime, unresolvedLocation].every(Number.isSafeInteger)
    || total !== rowCount
    || total !== countTotal(byKind)
    || KINDS.some((candidate) => byKind[candidate] !== (candidate === kind ? rowCount : 0))
    || attachedMedia < 0
    || attachedMedia > (kind === 'sighting' ? 0 : rowCount)
    || unresolvedTime < 0
    || unresolvedTime > rowCount
    || unresolvedLocation < 0
    || unresolvedLocation > rowCount
  ) fail('evidence_universe_seed_source_checkpoint_invalid');
  return { total, byKind, attachedMedia, unresolvedTime, unresolvedLocation };
};

const parseSourceCheckpoint = (
  body: Buffer,
  sourceCorpusVersion: string,
  requiredSnapshotId: string,
  requiredSnapshotAt: string,
): EvidenceUniverseCheckpoint => {
  let input: unknown;
  try {
    input = JSON.parse(body.toString('utf8'));
  } catch {
    fail('evidence_universe_seed_source_checkpoint_invalid');
  }
  if (
    !isObject(input)
    || input.recordType !== 'evidence_universe_checkpoint'
    || input.archiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || input.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || input.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || input.corpusVersion !== sourceCorpusVersion
    || !Array.isArray(input.parts)
    || !isObject(input.cursors)
  ) fail('evidence_universe_seed_source_checkpoint_invalid');

  const expected = normalizeExpected(input.expected);
  if (expected.snapshotId !== requiredSnapshotId) fail('evidence_universe_seed_source_snapshot_mismatch');
  if (expected.snapshotAt !== requiredSnapshotAt) fail('evidence_universe_seed_source_snapshot_mismatch');
  const exportedByKind = normalizeCounts(input.exportedByKind, 'evidence_universe_seed_source_exported_counts');
  const partCounts = emptyCounts();
  const partRows = emptyCounts();
  const lastCursors = emptyCursors();
  const parts: EvidenceUniversePart[] = [];
  let lastKindIndex = -1;

  for (const rawPart of input.parts) {
    if (!isObject(rawPart) || !KINDS.includes(rawPart.kind as EvidenceUniverseNodeKind)) {
      fail('evidence_universe_seed_source_checkpoint_invalid');
    }
    const kind = rawPart.kind as EvidenceUniverseNodeKind;
    const kindIndex = KINDS.indexOf(kind);
    const partNumber = rawPart.partNumber;
    const rowCount = rawPart.rowCount;
    const compressedBytes = rawPart.compressedBytes;
    const uncompressedBytes = rawPart.uncompressedBytes;
    if (
      kindIndex < lastKindIndex
      || typeof partNumber !== 'number'
      || !Number.isSafeInteger(partNumber)
      || partNumber !== partCounts[kind]
      || typeof rowCount !== 'number'
      || !Number.isSafeInteger(rowCount)
      || rowCount < 1
      || typeof compressedBytes !== 'number'
      || !Number.isSafeInteger(compressedBytes)
      || compressedBytes < 1
      || typeof uncompressedBytes !== 'number'
      || !Number.isSafeInteger(uncompressedBytes)
      || uncompressedBytes < 1
      || !/^[a-f0-9]{64}$/.test(String(rawPart.sha256 || ''))
    ) fail('evidence_universe_seed_source_checkpoint_invalid');
    const keys = getEvidenceUniversePartKeys(sourceCorpusVersion, kind, partNumber);
    const prefix = `${kind}:`;
    if (
      rawPart.archiveKey !== keys.archiveKey
      || rawPart.manifestKey !== keys.manifestKey
      || typeof rawPart.firstAddress !== 'string'
      || typeof rawPart.lastAddress !== 'string'
      || rawPart.firstAddress.length <= prefix.length
      || rawPart.lastAddress.length <= prefix.length
      || !rawPart.firstAddress.startsWith(prefix)
      || !rawPart.lastAddress.startsWith(prefix)
    ) fail('evidence_universe_seed_source_checkpoint_invalid');
    const cursor = normalizeCursor(kind, rawPart.cursor);
    if (lastCursors[kind] && compareCursors(kind, cursor, lastCursors[kind]!) <= 0) {
      fail('evidence_universe_seed_source_checkpoint_invalid');
    }
    const accounting = normalizeAccounting(rawPart.accounting, kind, rowCount);
    const part: EvidenceUniversePart = {
      partNumber,
      kind,
      rowCount,
      archiveKey: keys.archiveKey,
      manifestKey: keys.manifestKey,
      compressedBytes,
      uncompressedBytes,
      sha256: String(rawPart.sha256),
      firstAddress: rawPart.firstAddress,
      lastAddress: rawPart.lastAddress,
      cursor,
      accounting,
    };
    parts.push(part);
    partCounts[kind] += 1;
    partRows[kind] += rowCount;
    lastCursors[kind] = cursor;
    lastKindIndex = kindIndex;
  }

  const cursors = emptyCursors();
  for (const kind of KINDS) {
    if (partRows[kind] !== exportedByKind[kind] || exportedByKind[kind] > expected.byKind[kind]) {
      fail('evidence_universe_seed_source_checkpoint_invalid');
    }
    const rawCursor = input.cursors[kind];
    const lastCursor = lastCursors[kind];
    if (!lastCursor) {
      if (rawCursor !== null) fail('evidence_universe_seed_source_checkpoint_invalid');
      continue;
    }
    const cursor = normalizeCursor(kind, rawCursor);
    if (compareCursors(kind, cursor, lastCursor) !== 0) fail('evidence_universe_seed_source_checkpoint_invalid');
    cursors[kind] = cursor;
  }

  let foundIncompleteKind = false;
  for (const kind of KINDS) {
    if (foundIncompleteKind && exportedByKind[kind] !== 0) fail('evidence_universe_seed_source_checkpoint_invalid');
    if (exportedByKind[kind] < expected.byKind[kind]) foundIncompleteKind = true;
  }
  const seedFingerprint = input.seedFingerprint;
  if (seedFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(String(seedFingerprint))) {
    fail('evidence_universe_seed_source_checkpoint_invalid');
  }
  const updatedAt = normalizeTimestamp(input.updatedAt, 'evidence_universe_seed_source_checkpoint').raw;
  return {
    recordType: 'evidence_universe_checkpoint',
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion: sourceCorpusVersion,
    expected,
    exportedByKind,
    cursors,
    parts,
    ...(seedFingerprint === undefined ? {} : { seedFingerprint: String(seedFingerprint) }),
    updatedAt,
  };
};

const normalizeSelectedKinds = (value: readonly EvidenceUniverseNodeKind[]) => {
  if (!Array.isArray(value) || value.length < 1) fail('evidence_universe_seed_kinds_invalid');
  const selected = new Set<EvidenceUniverseNodeKind>();
  for (const kind of value) {
    if (!KINDS.includes(kind) || selected.has(kind)) fail('evidence_universe_seed_kinds_invalid');
    selected.add(kind);
  }
  return selected;
};

const verifySelection = (
  checkpoint: EvidenceUniverseCheckpoint,
  selected: Set<EvidenceUniverseNodeKind>,
) => {
  for (const kind of selected) {
    if (checkpoint.exportedByKind[kind] !== checkpoint.expected.byKind[kind]) {
      fail(`evidence_universe_seed_kind_not_complete:${kind}`);
    }
  }
  let foundIncompleteKind = false;
  for (const kind of KINDS) {
    const targetCount = selected.has(kind) ? checkpoint.exportedByKind[kind] : 0;
    if (foundIncompleteKind && targetCount !== 0) fail('evidence_universe_seed_selection_not_resumable');
    if (targetCount < checkpoint.expected.byKind[kind]) foundIncompleteKind = true;
  }
};

const expectedManifestBody = (part: EvidenceUniversePart) => Buffer.from(`${JSON.stringify(part)}\n`);

type ArchiveUploadOptions = Parameters<CaseGraphArchiveStorage['uploadFile']>[2];

const conditionalStorage = (storage: CaseGraphArchiveStorage): CaseGraphListableConditionalArchiveStorage => {
  const candidate = storage as Partial<CaseGraphListableConditionalArchiveStorage>;
  if (
    typeof candidate.readObjectVersioned !== 'function'
    || typeof candidate.uploadFileConditional !== 'function'
    || typeof candidate.listObjectKeys !== 'function'
  ) {
    fail('evidence_universe_conditional_storage_required');
  }
  return storage as CaseGraphListableConditionalArchiveStorage;
};

const verifyArchive = (
  body: Buffer,
  part: EvidenceUniversePart,
  seenAddresses: Set<string>,
) => {
  if (body.length !== part.compressedBytes || sha256(body) !== part.sha256) {
    fail('evidence_universe_seed_source_archive_invalid');
  }
  let raw: Buffer;
  try {
    raw = gunzipSync(body);
  } catch {
    fail('evidence_universe_seed_source_archive_invalid');
  }
  if (raw.length !== part.uncompressedBytes) fail('evidence_universe_seed_source_archive_invalid');
  const text = raw.toString('utf8');
  if (!text.endsWith('\n')) fail('evidence_universe_seed_source_archive_invalid');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== part.rowCount || lines.some((line) => !line)) {
    fail('evidence_universe_seed_source_archive_invalid');
  }
  const nodes: EvidenceUniverseNode[] = [];
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      fail('evidence_universe_seed_source_archive_invalid');
    }
    if (
      !isObject(value)
      || value.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
      || value.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
      || value.kind !== part.kind
      || typeof value.recordId !== 'string'
      || typeof value.address !== 'string'
      || value.address !== evidenceUniverseAddress(part.kind, value.recordId)
      || !Array.isArray(value.position)
      || value.position.length !== 3
      || !value.position.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      || seenAddresses.has(value.address)
    ) fail('evidence_universe_seed_source_archive_invalid');
    seenAddresses.add(value.address);
    nodes.push(value as unknown as EvidenceUniverseNode);
  }
  if (nodes[0].address !== part.firstAddress || nodes.at(-1)?.address !== part.lastAddress) {
    fail('evidence_universe_seed_source_archive_invalid');
  }
  let accounting: EvidenceUniverseAccounting;
  try {
    accounting = accountEvidenceUniverseNodes(nodes);
  } catch {
    fail('evidence_universe_seed_source_archive_invalid');
  }
  if (JSON.stringify(accounting) !== JSON.stringify(part.accounting)) {
    fail('evidence_universe_seed_source_archive_invalid');
  }
  const cursorId = part.kind === 'sighting'
    ? (part.cursor as CaseGraphCursor).case_id
    : (part.cursor as EvidenceMediaCursor).recordId;
  if (String(cursorId).trim().toLowerCase() !== nodes.at(-1)!.recordId) {
    fail('evidence_universe_seed_source_archive_invalid');
  }
};

const targetPrefix = (corpusVersion: string) => (
  `${getCaseGraphCorpusPrefix(corpusVersion)}/universe/nodes/`
);

const listAllObjectKeys = async (
  storage: CaseGraphListableConditionalArchiveStorage,
  prefix: string,
) => {
  const keys: string[] = [];
  const seenKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await storage.listObjectKeys(prefix, cursor, 1_000);
    if (!page || !Array.isArray(page.keys) || (page.cursor !== null && typeof page.cursor !== 'string')) {
      fail('evidence_universe_seed_target_listing_invalid');
    }
    for (const key of page.keys) {
      if (typeof key !== 'string' || !key.startsWith(prefix) || seenKeys.has(key)) {
        fail('evidence_universe_seed_target_listing_invalid');
      }
      seenKeys.add(key);
      keys.push(key);
    }
    if (page.cursor === null) break;
    if (!page.cursor || seenCursors.has(page.cursor)) fail('evidence_universe_seed_target_listing_invalid');
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (true);
  return keys;
};

const assertTargetNamespace = async (
  storage: CaseGraphListableConditionalArchiveStorage,
  targetCorpusVersion: string,
  allowedKeys: Set<string>,
) => {
  const keys = await listAllObjectKeys(storage, targetPrefix(targetCorpusVersion));
  if (keys.some((key) => !allowedKeys.has(key))) fail('evidence_universe_seed_target_not_empty');
};

const targetPartFor = (targetCorpusVersion: string, sourcePart: EvidenceUniversePart) => {
  const keys = getEvidenceUniversePartKeys(targetCorpusVersion, sourcePart.kind, sourcePart.partNumber);
  return { ...sourcePart, archiveKey: keys.archiveKey, manifestKey: keys.manifestKey };
};

const targetPartKeys = (parts: EvidenceUniversePart[]) => {
  const keys = new Set<string>();
  for (const part of parts) {
    keys.add(part.archiveKey);
    keys.add(part.manifestKey);
  }
  return keys;
};

const checkpointMaterial = (checkpoint: EvidenceUniverseCheckpoint): SeedCheckpointMaterial => ({
  archiveVersion: checkpoint.archiveVersion,
  schemaVersion: checkpoint.schemaVersion,
  layoutVersion: checkpoint.layoutVersion,
  corpusVersion: checkpoint.corpusVersion,
  expected: checkpoint.expected,
  exportedByKind: checkpoint.exportedByKind,
  cursors: checkpoint.cursors,
  parts: checkpoint.parts,
});

const seedFingerprintFor = (params: {
  sourceCorpusVersion: string;
  selectedKinds: EvidenceUniverseNodeKind[];
  material: SeedCheckpointMaterial;
}) => sha256(Buffer.from(JSON.stringify({
  recordType: 'evidence_universe_seed_fingerprint',
  sourceCorpusVersion: params.sourceCorpusVersion,
  selectedKinds: params.selectedKinds,
  ...params.material,
})));

const seedIntentBody = (intent: EvidenceUniverseSeedIntent) => Buffer.from(`${JSON.stringify(intent)}\n`);

const verifySourcePartsAndReusableTargets = async (
  storage: CaseGraphListableConditionalArchiveStorage,
  parts: VerifiedSourcePart[],
) => {
  const seenAddresses = new Set<string>();
  for (const { source, target } of parts) {
    const [archiveBody, manifestBody] = await Promise.all([
      storage.readObject(source.archiveKey),
      storage.readObject(source.manifestKey),
    ]);
    if (!archiveBody || !manifestBody || !manifestBody.equals(expectedManifestBody(source))) {
      fail('evidence_universe_seed_source_manifest_invalid');
    }
    verifyArchive(archiveBody, source, seenAddresses);
    const targetManifest = expectedManifestBody(target);
    const [existingArchive, existingManifest] = await Promise.all([
      storage.readObject(target.archiveKey),
      storage.readObject(target.manifestKey),
    ]);
    if (existingArchive && !existingArchive.equals(archiveBody)) {
      fail(`evidence_universe_immutable_object_conflict:${target.archiveKey}`);
    }
    if (existingManifest && !existingManifest.equals(targetManifest)) {
      fail(`evidence_universe_immutable_object_conflict:${target.manifestKey}`);
    }
  }
};

const verifyStoredTargetParts = async (
  storage: CaseGraphListableConditionalArchiveStorage,
  parts: EvidenceUniversePart[],
) => {
  const seenAddresses = new Set<string>();
  for (const part of parts) {
    const [archiveBody, manifestBody] = await Promise.all([
      storage.readObject(part.archiveKey),
      storage.readObject(part.manifestKey),
    ]);
    if (!archiveBody || !manifestBody || !manifestBody.equals(expectedManifestBody(part))) {
      fail('evidence_universe_seed_target_checkpoint_verification_failed');
    }
    try {
      verifyArchive(archiveBody, part, seenAddresses);
    } catch {
      fail('evidence_universe_seed_target_checkpoint_verification_failed');
    }
  }
};

const reconcileTargetCheckpoint = async (params: {
  storage: CaseGraphListableConditionalArchiveStorage;
  object: CaseGraphVersionedArchiveObject;
  targetCorpusVersion: string;
  snapshotId: string;
  snapshotAt: string;
  seedFingerprint: string;
  material: SeedCheckpointMaterial;
}) => {
  let checkpoint: EvidenceUniverseCheckpoint;
  try {
    checkpoint = parseSourceCheckpoint(
      params.object.body,
      params.targetCorpusVersion,
      params.snapshotId,
      params.snapshotAt,
    );
  } catch {
    return null;
  }
  if (
    checkpoint.seedFingerprint !== params.seedFingerprint
    || JSON.stringify(checkpointMaterial(checkpoint)) !== JSON.stringify(params.material)
  ) return null;
  await verifyStoredTargetParts(params.storage, checkpoint.parts);
  const allowed = targetPartKeys(checkpoint.parts);
  allowed.add(getEvidenceUniverseControlKeys(params.targetCorpusVersion).checkpointKey);
  await assertTargetNamespace(params.storage, params.targetCorpusVersion, allowed);
  return checkpoint;
};

type SeedIntentClaim =
  | { status: 'claimed'; version: string }
  | { status: 'occupied'; object: CaseGraphVersionedArchiveObject };

const claimSeedIntent = async (
  storage: CaseGraphListableConditionalArchiveStorage,
  body: Buffer,
  key: string,
): Promise<SeedIntentClaim> => {
  const reconcileWrite = async (): Promise<SeedIntentClaim | null> => {
    const stored = await storage.readObjectVersioned(key);
    if (!stored) return null;
    return stored.body.equals(body)
      ? { status: 'claimed', version: stored.version }
      : { status: 'occupied', object: stored };
  };
  let result;
  try {
    result = await storage.uploadFileConditional(body, key, {
      contentType: 'application/json',
      cacheControl: 'private, no-store',
      contentLength: body.length,
    }, { ifAbsent: true });
  } catch (error) {
    try {
      const reconciled = await reconcileWrite();
      if (reconciled) return reconciled;
    } catch {
      // Preserve the original ambiguous write error when reconciliation cannot
      // itself reach storage. A fresh invocation can still recover the intent.
    }
    throw error;
  }
  if (result.status === 'precondition_failed') {
    const reconciled = await reconcileWrite();
    if (reconciled) return reconciled;
    fail('evidence_universe_seed_concurrent_writer_detected');
  }
  if (result.key !== key || !String(result.version || '').trim()) {
    const reconciled = await reconcileWrite();
    if (reconciled) return reconciled;
    fail('evidence_universe_seed_intent_write_failed');
  }
  const reconciled = await reconcileWrite();
  if (!reconciled) fail('evidence_universe_seed_intent_write_failed');
  return reconciled;
};

const writeImmutable = async (
  storage: CaseGraphListableConditionalArchiveStorage,
  body: Buffer,
  key: string,
  options: ArchiveUploadOptions,
  errorCode: string,
) => {
  const result = await storage.uploadFileConditional(body, key, options, { ifAbsent: true });
  if (result.status === 'precondition_failed') {
    const existing = await storage.readObject(key);
    if (!existing?.equals(body)) fail(`evidence_universe_immutable_object_conflict:${key}`);
    return 'reused' as const;
  }
  if (result.key !== key || !String(result.version || '').trim()) fail(errorCode);
  const stored = await storage.readObject(key);
  if (!stored || !stored.equals(body)) fail(errorCode);
  return 'written' as const;
};

const publishSeedCheckpoint = async (params: {
  storage: CaseGraphListableConditionalArchiveStorage;
  body: Buffer;
  key: string;
  intentVersion: string;
  targetCorpusVersion: string;
  snapshotId: string;
  snapshotAt: string;
  seedFingerprint: string;
  material: SeedCheckpointMaterial;
}) => {
  const reconcileWrite = async () => {
    const object = await params.storage.readObjectVersioned(params.key);
    if (!object) return null;
    return reconcileTargetCheckpoint({
      storage: params.storage,
      object,
      targetCorpusVersion: params.targetCorpusVersion,
      snapshotId: params.snapshotId,
      snapshotAt: params.snapshotAt,
      seedFingerprint: params.seedFingerprint,
      material: params.material,
    });
  };
  let result;
  try {
    result = await params.storage.uploadFileConditional(params.body, params.key, {
      contentType: 'application/json',
      cacheControl: 'private, no-store',
      contentLength: params.body.length,
    }, { ifVersion: params.intentVersion });
  } catch (error) {
    try {
      const checkpoint = await reconcileWrite();
      if (checkpoint) return { status: 'already_seeded' as const, checkpoint };
    } catch {
      // As above, preserve the original ambiguous write error. The durable
      // fingerprint makes the next invocation safe to reconcile.
    }
    throw error;
  }
  if (result.status === 'precondition_failed') {
    const checkpoint = await reconcileWrite();
    if (checkpoint) return { status: 'already_seeded' as const, checkpoint };
    fail('evidence_universe_seed_concurrent_writer_detected');
  }
  const stored = await params.storage.readObjectVersioned(params.key);
  if (stored?.body.equals(params.body)) {
    return { status: 'seeded' as const, checkpoint: null };
  }
  const checkpoint = stored && await reconcileTargetCheckpoint({
    storage: params.storage,
    object: stored,
    targetCorpusVersion: params.targetCorpusVersion,
    snapshotId: params.snapshotId,
    snapshotAt: params.snapshotAt,
    seedFingerprint: params.seedFingerprint,
    material: params.material,
  });
  if (checkpoint) return { status: 'already_seeded' as const, checkpoint };
  fail('evidence_universe_seed_target_checkpoint_write_failed');
};

export const seedEvidenceUniverseCheckpoint = async (params: {
  sourceCorpusVersion: string;
  targetCorpusVersion: string;
  snapshotId: string;
  snapshotAt: string | Date;
  selectedKinds: readonly EvidenceUniverseNodeKind[];
  storage: CaseGraphArchiveStorage;
  now?: () => Date;
}) => {
  const sourceCorpusVersion = normalizeCorpusVersion(params.sourceCorpusVersion, 'evidence_universe_seed_source_corpus');
  const targetCorpusVersion = normalizeCorpusVersion(params.targetCorpusVersion, 'evidence_universe_seed_target_corpus');
  if (sourceCorpusVersion === targetCorpusVersion) fail('evidence_universe_seed_corpora_must_differ');
  const snapshotId = String(params.snapshotId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(snapshotId)) {
    fail('evidence_universe_seed_snapshot_id_invalid');
  }
  const snapshotAt = normalizeTimestamp(
    params.snapshotAt instanceof Date ? params.snapshotAt.toISOString() : params.snapshotAt,
    'evidence_universe_seed_snapshot',
  ).iso;
  const storage = conditionalStorage(params.storage);
  const selected = normalizeSelectedKinds(params.selectedKinds);
  const sourceControl = getEvidenceUniverseControlKeys(sourceCorpusVersion);
  const sourceBody = await storage.readObject(sourceControl.checkpointKey);
  if (!sourceBody) fail('evidence_universe_seed_source_checkpoint_missing');
  const sourceCheckpoint = parseSourceCheckpoint(sourceBody, sourceCorpusVersion, snapshotId, snapshotAt);
  verifySelection(sourceCheckpoint, selected);
  const selectedSourceParts = sourceCheckpoint.parts.filter((part) => selected.has(part.kind));
  const selectedKinds = KINDS.filter((kind) => selected.has(kind));
  const verified: VerifiedSourcePart[] = selectedSourceParts.map((source) => ({
    source,
    target: targetPartFor(targetCorpusVersion, source),
  }));
  const exportedByKind = emptyCounts();
  const cursors = emptyCursors();
  for (const kind of KINDS) {
    if (!selected.has(kind)) continue;
    exportedByKind[kind] = sourceCheckpoint.exportedByKind[kind];
    cursors[kind] = sourceCheckpoint.cursors[kind];
  }
  const material: SeedCheckpointMaterial = {
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion: targetCorpusVersion,
    expected: sourceCheckpoint.expected,
    exportedByKind,
    cursors,
    parts: verified.map(({ target }) => target),
  };
  const seedFingerprint = seedFingerprintFor({ sourceCorpusVersion, selectedKinds, material });
  const intent: EvidenceUniverseSeedIntent = {
    recordType: 'evidence_universe_seed_intent',
    intentVersion: 1,
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    sourceCorpusVersion,
    targetCorpusVersion,
    snapshotId,
    snapshotAt,
    selectedKinds,
    seedFingerprint,
  };
  const intentBody = seedIntentBody(intent);
  const targetControl = getEvidenceUniverseControlKeys(targetCorpusVersion);
  const resultFor = (status: 'seeded' | 'already_seeded', checkpoint: EvidenceUniverseCheckpoint) => ({
    status,
    sourceCorpusVersion,
    targetCorpusVersion,
    selectedKinds,
    copiedPartCount: verified.length,
    copiedNodeCount: countTotal(exportedByKind),
    checkpoint,
  });

  const [checkpointObject, completion] = await Promise.all([
    storage.readObjectVersioned(targetControl.checkpointKey),
    storage.readObject(targetControl.completionManifestKey),
  ]);
  if (completion) fail('evidence_universe_seed_target_not_empty');

  let intentVersion: string | null = null;
  if (checkpointObject) {
    if (checkpointObject.body.equals(intentBody)) {
      intentVersion = checkpointObject.version;
    } else {
      const reconciled = await reconcileTargetCheckpoint({
        storage,
        object: checkpointObject,
        targetCorpusVersion,
        snapshotId,
        snapshotAt,
        seedFingerprint,
        material,
      });
      if (reconciled) return resultFor('already_seeded', reconciled);
      fail('evidence_universe_seed_target_not_empty');
    }
  } else {
    await assertTargetNamespace(storage, targetCorpusVersion, targetPartKeys(material.parts));
  }

  // Validate every source shard and any legacy resumable target object before
  // reserving a previously empty target. A corrupt source therefore cannot
  // strand a new corpus behind a durable seed intent.
  await verifySourcePartsAndReusableTargets(storage, verified);

  if (intentVersion === null) {
    const claim = await claimSeedIntent(storage, intentBody, targetControl.checkpointKey);
    if (claim.status === 'occupied') {
      const reconciled = await reconcileTargetCheckpoint({
        storage,
        object: claim.object,
        targetCorpusVersion,
        snapshotId,
        snapshotAt,
        seedFingerprint,
        material,
      });
      if (reconciled) return resultFor('already_seeded', reconciled);
      fail('evidence_universe_seed_concurrent_writer_detected');
    }
    intentVersion = claim.version;
  }

  const fencedKeys = targetPartKeys(material.parts);
  fencedKeys.add(targetControl.checkpointKey);
  await assertTargetNamespace(storage, targetCorpusVersion, fencedKeys);

  const copySeenAddresses = new Set<string>();
  for (const { source, target } of verified) {
    const [archiveBody, manifestBody] = await Promise.all([
      storage.readObject(source.archiveKey),
      storage.readObject(source.manifestKey),
    ]);
    if (!archiveBody || !manifestBody || !manifestBody.equals(expectedManifestBody(source))) {
      fail('evidence_universe_seed_source_manifest_invalid');
    }
    verifyArchive(archiveBody, source, copySeenAddresses);
    await writeImmutable(storage, archiveBody, target.archiveKey, {
      contentType: 'application/x-ndjson',
      contentEncoding: 'gzip',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: archiveBody.length,
    }, 'evidence_universe_seed_target_archive_write_failed');
    const targetManifestBody = expectedManifestBody(target);
    await writeImmutable(storage, targetManifestBody, target.manifestKey, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: targetManifestBody.length,
    }, 'evidence_universe_seed_target_manifest_write_failed');
  }
  const targetCheckpoint: EvidenceUniverseCheckpoint = {
    recordType: 'evidence_universe_checkpoint',
    ...material,
    seedFingerprint,
    updatedAt: (params.now || (() => new Date()))().toISOString(),
  };
  // Close the pre-publication window for any non-cooperating legacy writer
  // which began before the checkpoint fence became visible. Compliant seeders
  // cannot reach shard writes without owning this exact intent.
  await assertTargetNamespace(storage, targetCorpusVersion, fencedKeys);
  const lateCompletion = await storage.readObject(targetControl.completionManifestKey);
  if (lateCompletion) fail('evidence_universe_seed_target_not_empty');
  const checkpointBody = Buffer.from(`${JSON.stringify(targetCheckpoint)}\n`);
  const published = await publishSeedCheckpoint({
    storage,
    body: checkpointBody,
    key: targetControl.checkpointKey,
    intentVersion,
    targetCorpusVersion,
    snapshotId,
    snapshotAt,
    seedFingerprint,
    material,
  });
  return resultFor(published.status, published.checkpoint || targetCheckpoint);
};
