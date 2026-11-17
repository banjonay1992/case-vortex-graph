import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from '../../src/caseGraph/archiveKeys';
import type {
  CaseGraphArchiveStorage,
  CaseGraphConditionalArchiveStorage,
  CaseGraphCursor,
  CaseGraphFeatureSource,
  CaseGraphListableConditionalArchiveStorage,
  CaseGraphSourceRow,
} from '../../src/caseGraph/archiveTypes';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  archiveEvidenceUniverse,
  type EvidenceUniverseCheckpoint,
  type EvidenceUniversePart,
} from '../../src/caseGraph/evidenceUniverseArchive';
import { seedEvidenceUniverseCheckpoint } from '../../src/caseGraph/evidenceUniverseSeed';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from '../../src/caseGraph/evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  type EvidenceMediaCursor,
} from '../../src/caseGraph/postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';

const sourceCorpusVersion = '2026-07-17-vortex-v5';
const targetCorpusVersion = '2026-07-17-vortex-v6';
const snapshotAt = '2026-07-17T17:00:00.000Z';
const materializedAt = '2026-07-17T16:59:59.999Z';
const sourceMvccSnapshot = '100:200:';
const snapshotId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-17T23:00:00.000Z');
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const node = (kind: EvidenceUniverseNodeKind, recordId: string): EvidenceUniverseNode => projectEvidenceUniverseNode({
  kind,
  recordId,
  source: kind === 'sighting' ? 'NUFORC' : 'archive',
  sourceRecordId: `${recordId}-source`,
  title: `${kind} ${recordId}`,
  summary: null,
  canonicalUrl: `https://example.test/${kind}/${recordId}`,
  previewUrl: null,
  eventTimestamp: '2004-03-02T00:00:00Z',
  lat: 34.2,
  lon: -112.1,
  location: 'Arizona',
  countryCode: 'US',
  linkedSightingId: kind === 'sighting' ? null : 'sighting-1',
  updatedAt: '2026-07-17T16:00:00.000Z',
  public: true,
});

const cursorFor = (kind: EvidenceUniverseNodeKind, recordId: string): CaseGraphCursor | EvidenceMediaCursor => (
  kind === 'sighting'
    ? { updated_at: '2026-07-17T16:00:00.000Z', case_id: recordId }
    : { updatedAt: '2026-07-17T16:00:00.123456Z', recordId }
);

const partFor = (
  corpusVersion: string,
  kind: EvidenceUniverseNodeKind,
  partNumber: number,
  nodes: EvidenceUniverseNode[],
) => {
  const raw = Buffer.from(`${nodes.map((value) => JSON.stringify(value)).join('\n')}\n`);
  const archive = gzipSync(raw, { level: 9 });
  const keys = getEvidenceUniversePartKeys(corpusVersion, kind, partNumber);
  const part: EvidenceUniversePart = {
    partNumber,
    kind,
    rowCount: nodes.length,
    archiveKey: keys.archiveKey,
    manifestKey: keys.manifestKey,
    compressedBytes: archive.length,
    uncompressedBytes: raw.length,
    sha256: sha256(archive),
    firstAddress: nodes[0].address,
    lastAddress: nodes.at(-1)!.address,
    cursor: cursorFor(kind, nodes.at(-1)!.recordId),
    accounting: accountEvidenceUniverseNodes(nodes),
  };
  return { part, archive, manifest: Buffer.from(`${JSON.stringify(part)}\n`) };
};

const storageFor = () => {
  const objects = new Map<string, Buffer>();
  const uploads: string[] = [];
  const unconditionalUploads: string[] = [];
  const conditionalAttempts: Array<{
    key: string;
    condition: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[3];
  }> = [];
  const versionOf = (body: Buffer) => `"${sha256(body)}"`;
  const storage: CaseGraphListableConditionalArchiveStorage = {
    readObject: async (key) => {
      const value = objects.get(key);
      return value ? Buffer.from(value) : null;
    },
    uploadFile: async (body, key) => {
      unconditionalUploads.push(key);
      uploads.push(key);
      objects.set(key, Buffer.from(body));
      return key;
    },
    readObjectVersioned: async (key) => {
      const body = objects.get(key);
      return body ? { body: Buffer.from(body), version: versionOf(body) } : null;
    },
    listObjectKeys: async (prefix, cursor, limit = 1_000) => {
      const matching = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? matching.findIndex((key) => key > cursor) : 0;
      const offset = start < 0 ? matching.length : start;
      const keys = matching.slice(offset, offset + limit);
      const nextOffset = offset + keys.length;
      return { keys, cursor: nextOffset < matching.length ? keys.at(-1)! : null };
    },
    uploadFileConditional: async (body, key, _options, condition) => {
      conditionalAttempts.push({ key, condition: { ...condition } });
      const current = objects.get(key);
      const conditionMet = 'ifAbsent' in condition
        ? current === undefined
        : current !== undefined && versionOf(current) === condition.ifVersion;
      if (!conditionMet) return { status: 'precondition_failed' as const };
      const stored = Buffer.from(body);
      uploads.push(key);
      objects.set(key, stored);
      return { status: 'written' as const, key, version: versionOf(stored) };
    },
  };
  return { storage, objects, uploads, unconditionalUploads, conditionalAttempts };
};

const sourceFixture = (objects: Map<string, Buffer>) => {
  const built = [
    partFor(sourceCorpusVersion, 'sighting', 0, [node('sighting', 'sighting-1')]),
    partFor(sourceCorpusVersion, 'document', 0, [node('document', 'document-1')]),
    partFor(sourceCorpusVersion, 'photo', 0, [node('photo', 'photo-1')]),
    partFor(sourceCorpusVersion, 'video', 0, [node('video', 'video-1')]),
  ];
  for (const value of built) {
    objects.set(value.part.archiveKey, value.archive);
    objects.set(value.part.manifestKey, value.manifest);
  }
  const checkpoint: EvidenceUniverseCheckpoint = {
    recordType: 'evidence_universe_checkpoint',
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion: sourceCorpusVersion,
    expected: {
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
      byKind: { sighting: 1, document: 1, photo: 1, video: 2 },
      total: 5,
      sightingPolicy: 'publishable_public_v2',
      mediaBackfillsComplete: { document: true, photo: true, video: true },
    },
    exportedByKind: { sighting: 1, document: 1, photo: 1, video: 1 },
    cursors: {
      sighting: built[0].part.cursor,
      document: built[1].part.cursor,
      photo: built[2].part.cursor,
      video: built[3].part.cursor,
    },
    parts: built.map((value) => value.part),
    updatedAt: '2026-07-17T22:00:00.000Z',
  };
  objects.set(
    getEvidenceUniverseControlKeys(sourceCorpusVersion).checkpointKey,
    Buffer.from(`${JSON.stringify(checkpoint)}\n`),
  );
  return { checkpoint, built };
};

const seed = (storage: CaseGraphArchiveStorage) => seedEvidenceUniverseCheckpoint({
  sourceCorpusVersion,
  targetCorpusVersion,
  snapshotId,
  snapshotAt,
  selectedKinds: ['sighting', 'document', 'photo'],
  storage,
  now: () => now,
});

describe('evidence universe cross-corpus seeding', () => {
  it('copies verified complete kind shards and publishes a resumable target checkpoint last', async () => {
    const { storage, objects, uploads, unconditionalUploads, conditionalAttempts } = storageFor();
    const { built } = sourceFixture(objects);

    const result = await seed(storage);

    expect(result).toMatchObject({
      status: 'seeded',
      sourceCorpusVersion,
      targetCorpusVersion,
      selectedKinds: ['sighting', 'document', 'photo'],
      copiedPartCount: 3,
      copiedNodeCount: 3,
    });
    expect(result.checkpoint).toMatchObject({
      corpusVersion: targetCorpusVersion,
      expected: { byKind: { sighting: 1, document: 1, photo: 1, video: 2 }, total: 5 },
      exportedByKind: { sighting: 1, document: 1, photo: 1, video: 0 },
      cursors: { video: null },
      updatedAt: now.toISOString(),
    });
    expect(result.checkpoint.parts.map((part) => part.kind)).toEqual(['sighting', 'document', 'photo']);
    for (const [index, kind] of (['sighting', 'document', 'photo'] as const).entries()) {
      const targetKeys = getEvidenceUniversePartKeys(targetCorpusVersion, kind, 0);
      expect(objects.get(targetKeys.archiveKey)).toEqual(built[index].archive);
      const targetManifest = JSON.parse(objects.get(targetKeys.manifestKey)!.toString('utf8')) as EvidenceUniversePart;
      expect(targetManifest).toMatchObject({
        kind,
        partNumber: 0,
        archiveKey: targetKeys.archiveKey,
        manifestKey: targetKeys.manifestKey,
        sha256: built[index].part.sha256,
      });
    }
    expect(objects.has(getEvidenceUniversePartKeys(targetCorpusVersion, 'video', 0).archiveKey)).toBe(false);
    const checkpointKey = getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey;
    expect(uploads.at(-1)).toBe(checkpointKey);
    expect(unconditionalUploads).toEqual([]);
    expect(conditionalAttempts).toHaveLength(8);
    expect(conditionalAttempts.slice(0, -1).every(({ condition }) => (
      'ifAbsent' in condition && condition.ifAbsent === true
    ))).toBe(true);
    expect(conditionalAttempts.at(-1)?.condition).toEqual({
      ifVersion: expect.stringMatching(/^"[a-f0-9]{64}"$/),
    });
    expect(result.checkpoint.seedFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(objects.get(checkpointKey)!.toString('utf8'))).toEqual(result.checkpoint);
  });

  it('fails closed without publishing a target checkpoint when a source archive is corrupt', async () => {
    const { storage, objects } = storageFor();
    const { built } = sourceFixture(objects);
    objects.set(built[1].part.archiveKey, Buffer.from('not-the-declared-gzip'));

    await expect(seed(storage)).rejects.toThrow('evidence_universe_seed_source_archive_invalid');

    expect(objects.has(getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey)).toBe(false);
  });

  it('rejects mismatched source identity, schema and snapshot before target publication', async () => {
    const mutations: Array<[string, (checkpoint: Record<string, any>) => void, string]> = [
      ['identity', (checkpoint) => { checkpoint.corpusVersion = 'some-other-corpus'; }, 'source_checkpoint_invalid'],
      ['schema', (checkpoint) => { checkpoint.schemaVersion = 'evidence-universe-v0'; }, 'source_checkpoint_invalid'],
      ['layout', (checkpoint) => { checkpoint.layoutVersion = 'evidence-universe-layout-v1'; }, 'source_checkpoint_invalid'],
      ['snapshot', (checkpoint) => { checkpoint.expected.snapshotAt = '2026-07-17T18:00:00.000Z'; }, 'source_snapshot_mismatch'],
      ['snapshot id', (checkpoint) => { checkpoint.expected.snapshotId = '44444444-4444-4444-8444-444444444444'; }, 'source_snapshot_mismatch'],
    ];
    for (const [, mutate, error] of mutations) {
      const { storage, objects } = storageFor();
      sourceFixture(objects);
      const key = getEvidenceUniverseControlKeys(sourceCorpusVersion).checkpointKey;
      const checkpoint = JSON.parse(objects.get(key)!.toString('utf8')) as Record<string, any>;
      mutate(checkpoint);
      objects.set(key, Buffer.from(`${JSON.stringify(checkpoint)}\n`));

      await expect(seed(storage)).rejects.toThrow(error);
      expect(objects.has(getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey)).toBe(false);
    }
  });

  it.each(['checkpoint', 'unexpected-part', 'unprobed-part'] as const)(
    'rejects a nonempty target (%s) before copying',
    async (existing) => {
    const { storage, objects, uploads } = storageFor();
    sourceFixture(objects);
    if (existing === 'checkpoint') {
      objects.set(getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey, Buffer.from('{}\n'));
    } else if (existing === 'unprobed-part') {
      objects.set(getEvidenceUniversePartKeys(targetCorpusVersion, 'video', 731).manifestKey, Buffer.from('orphan'));
    } else {
      objects.set(getEvidenceUniversePartKeys(targetCorpusVersion, 'video', 0).archiveKey, Buffer.from('orphan'));
    }

    await expect(seed(storage)).rejects.toThrow('evidence_universe_seed_target_not_empty');

    expect(uploads).toEqual([]);
    },
  );

  it('fails closed when storage cannot provide atomic conditional writes', async () => {
    const { storage, objects } = storageFor();
    sourceFixture(objects);

    await expect(seed({
      readObject: storage.readObject,
      uploadFile: storage.uploadFile,
    })).rejects.toThrow('evidence_universe_conditional_storage_required');
  });

  it('resumes an interrupted fenced seed by reusing only byte-identical immutable objects', async () => {
    const { storage, objects, uploads, unconditionalUploads } = storageFor();
    sourceFixture(objects);
    const checkpointKey = getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey;
    const interruptedKey = getEvidenceUniversePartKeys(targetCorpusVersion, 'document', 0).manifestKey;
    let failFirstTargetManifest = true;
    const interruptedStorage: CaseGraphListableConditionalArchiveStorage = {
      ...storage,
      uploadFileConditional: async (body, key, options, condition) => {
        if (failFirstTargetManifest && key === interruptedKey) {
          failFirstTargetManifest = false;
          throw new Error('simulated_seed_process_exit_during_copy');
        }
        return storage.uploadFileConditional(body, key, options, condition);
      },
    };

    await expect(seed(interruptedStorage)).rejects.toThrow('simulated_seed_process_exit_during_copy');
    expect(JSON.parse(objects.get(checkpointKey)!.toString('utf8'))).toMatchObject({
      recordType: 'evidence_universe_seed_intent',
      targetCorpusVersion,
      seedFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const copiedKeys = uploads.slice();
    expect(copiedKeys).toContain(checkpointKey);
    expect(copiedKeys).toContain(getEvidenceUniversePartKeys(targetCorpusVersion, 'sighting', 0).archiveKey);
    expect(copiedKeys).toContain(getEvidenceUniversePartKeys(targetCorpusVersion, 'document', 0).archiveKey);
    const copiedBodies = new Map(copiedKeys.map((key) => [key, Buffer.from(objects.get(key)!)]));

    const resumed = await seed(storage);

    expect(resumed.status).toBe('seeded');
    expect(JSON.parse(objects.get(checkpointKey)!.toString('utf8'))).toEqual(resumed.checkpoint);
    expect(unconditionalUploads).toEqual([]);
    for (const [key, body] of copiedBodies) {
      if (key !== checkpointKey) expect(objects.get(key)).toEqual(body);
    }
  });

  it('never replaces a conflicting immutable shard left by another writer', async () => {
    const { storage, objects, unconditionalUploads } = storageFor();
    sourceFixture(objects);
    const conflictKey = getEvidenceUniversePartKeys(targetCorpusVersion, 'sighting', 0).archiveKey;
    const conflictingBody = Buffer.from('another-writer-owned-these-bytes');
    objects.set(conflictKey, conflictingBody);

    await expect(seed(storage)).rejects.toThrow(`evidence_universe_immutable_object_conflict:${conflictKey}`);

    expect(objects.get(conflictKey)).toEqual(conflictingBody);
    expect(objects.has(getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey)).toBe(false);
    expect(unconditionalUploads).toEqual([]);
  });

  it('does not publish when a legacy writer appends an unexpected tail after the fence', async () => {
    const { storage, objects } = storageFor();
    sourceFixture(objects);
    const checkpointKey = getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey;
    const namespacePrefix = checkpointKey.slice(0, -'_checkpoint.json'.length);
    const lateTailKey = getEvidenceUniversePartKeys(targetCorpusVersion, 'video', 731).manifestKey;
    let namespaceScans = 0;
    const lateTailStorage: CaseGraphListableConditionalArchiveStorage = {
      ...storage,
      listObjectKeys: async (prefix, cursor, limit) => {
        if (prefix === namespacePrefix && !cursor) {
          namespaceScans += 1;
          if (namespaceScans === 3) objects.set(lateTailKey, Buffer.from('legacy-writer-tail'));
        }
        return storage.listObjectKeys(prefix, cursor, limit);
      },
    };

    await expect(seed(lateTailStorage)).rejects.toThrow('evidence_universe_seed_target_not_empty');

    expect(namespaceScans).toBe(3);
    expect(objects.has(lateTailKey)).toBe(true);
    expect(JSON.parse(objects.get(checkpointKey)!.toString('utf8'))).toMatchObject({
      recordType: 'evidence_universe_seed_intent',
      targetCorpusVersion,
    });
  });

  it('fences divergent concurrent seeds before the losing tail can write', async () => {
    const { storage, objects } = storageFor();
    sourceFixture(objects);
    const checkpointKey = getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey;
    type PendingWrite = {
      body: Buffer;
      key: string;
      options: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[2];
      condition: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[3];
      resolve: (value: Awaited<ReturnType<CaseGraphConditionalArchiveStorage['uploadFileConditional']>>) => void;
      reject: (error: unknown) => void;
    };
    const pending: PendingWrite[] = [];
    const racingStorage: CaseGraphListableConditionalArchiveStorage = {
      ...storage,
      uploadFileConditional: async (body, key, options, condition) => {
        const recordType = key === checkpointKey
          ? JSON.parse(body.toString('utf8')).recordType as string
          : '';
        if (key !== checkpointKey || !('ifAbsent' in condition) || recordType !== 'evidence_universe_seed_intent') {
          return storage.uploadFileConditional(body, key, options, condition);
        }
        return new Promise((resolve, reject) => {
          pending.push({ body: Buffer.from(body), key, options, condition, resolve, reject });
          if (pending.length !== 2) return;
          const ordered = pending.splice(0).sort((left, right) => {
            const leftKinds = JSON.parse(left.body.toString('utf8')).selectedKinds.length as number;
            const rightKinds = JSON.parse(right.body.toString('utf8')).selectedKinds.length as number;
            return leftKinds - rightKinds;
          });
          void (async () => {
            for (const write of ordered) {
              try {
                write.resolve(await storage.uploadFileConditional(
                  write.body, write.key, write.options, write.condition,
                ));
              } catch (error) {
                write.reject(error);
              }
            }
          })();
        });
      },
    };
    const runSeed = (selectedKinds: readonly EvidenceUniverseNodeKind[]) => seedEvidenceUniverseCheckpoint({
      sourceCorpusVersion,
      targetCorpusVersion,
      snapshotId,
      snapshotAt,
      selectedKinds,
      storage: racingStorage,
      now: () => now,
    });

    const [shortSeed, longSeed] = await Promise.allSettled([
      runSeed(['sighting']),
      runSeed(['sighting', 'document', 'photo']),
    ]);

    expect(shortSeed).toMatchObject({ status: 'fulfilled', value: { status: 'seeded' } });
    expect(longSeed).toMatchObject({
      status: 'rejected',
      reason: { message: 'evidence_universe_seed_concurrent_writer_detected' },
    });
    expect(objects.has(getEvidenceUniversePartKeys(targetCorpusVersion, 'sighting', 0).archiveKey)).toBe(true);
    expect(objects.has(getEvidenceUniversePartKeys(targetCorpusVersion, 'document', 0).archiveKey)).toBe(false);
    expect(objects.has(getEvidenceUniversePartKeys(targetCorpusVersion, 'photo', 0).archiveKey)).toBe(false);
    expect(JSON.parse(objects.get(checkpointKey)!.toString('utf8'))).toMatchObject({
      recordType: 'evidence_universe_checkpoint',
      exportedByKind: { sighting: 1, document: 0, photo: 0, video: 0 },
    });
  });

  it('reconciles a committed checkpoint after its acknowledgement is lost and a fresh retry starts', async () => {
    const { storage, objects, uploads } = storageFor();
    sourceFixture(objects);
    const checkpointKey = getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey;
    let finalCheckpointCommitted = false;
    let failImmediateReconciliationRead = true;
    const lostAckStorage: CaseGraphListableConditionalArchiveStorage = {
      ...storage,
      readObjectVersioned: async (key) => {
        if (key === checkpointKey && finalCheckpointCommitted && failImmediateReconciliationRead) {
          failImmediateReconciliationRead = false;
          throw new Error('simulated_process_exit_after_checkpoint_commit');
        }
        return storage.readObjectVersioned(key);
      },
      uploadFileConditional: async (body, key, options, condition) => {
        if (key === checkpointKey && 'ifVersion' in condition) {
          await storage.uploadFileConditional(body, key, options, condition);
          finalCheckpointCommitted = true;
          throw new Error('simulated_lost_checkpoint_acknowledgement');
        }
        return storage.uploadFileConditional(body, key, options, condition);
      },
    };

    await expect(seed(lostAckStorage)).rejects.toThrow('simulated_lost_checkpoint_acknowledgement');
    const committed = JSON.parse(objects.get(checkpointKey)!.toString('utf8')) as EvidenceUniverseCheckpoint;
    expect(committed.recordType).toBe('evidence_universe_checkpoint');
    expect(committed.seedFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const uploadsAfterCommit = uploads.slice();

    const retried = await seed(storage);

    expect(retried.status).toBe('already_seeded');
    expect(retried.checkpoint).toEqual(committed);
    expect(uploads).toEqual(uploadsAfterCommit);
  });

  it('fully verifies referenced shards before treating a matching fingerprint as already seeded', async () => {
    const { storage, objects } = storageFor();
    sourceFixture(objects);
    await seed(storage);
    const archiveKey = getEvidenceUniversePartKeys(targetCorpusVersion, 'document', 0).archiveKey;
    objects.set(archiveKey, Buffer.from('corrupt-after-checkpoint'));

    await expect(seed(storage)).rejects.toThrow('evidence_universe_seed_target_checkpoint_verification_failed');
  });

  it('loses safely to a racing exporter checkpoint and never clobbers its CAS lineage', async () => {
    const { storage, objects, unconditionalUploads } = storageFor();
    const raceSightingRows: CaseGraphSourceRow[] = [{
      cursor: { updated_at: '2026-07-17T16:00:00.000Z', case_id: 'race-sighting-1' },
      sighting: {
        id: 'race-sighting-1',
        source: 'NUFORC',
        source_record_id: 'race-source-1',
        shape: 'light',
        description: 'A deterministic fixture for the seed and exporter race.',
        source_url: 'https://example.test/race-sighting-1',
        event_timestamp: '2004-03-02T00:00:00Z',
        lat: 34.2,
        lon: -112.1,
        location: 'Arizona',
        country_code: 'US',
      },
    }];
    const raceSightings: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => ({
        eligible_count: 1,
        min_cursor: raceSightingRows[0].cursor,
        max_cursor: raceSightingRows[0].cursor,
        source_counts: { nuforc: 1 },
        publishability_policy: 'publishable_public_v2',
        snapshot_at: snapshotAt,
        snapshot_id: '44444444-4444-4444-8444-444444444444',
        snapshot_policy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
        capture_policy: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
        materialized_at: materializedAt,
        source_mvcc_snapshot: sourceMvccSnapshot,
      }),
      fetchEligiblePage: async (cursor) => cursor ? [] : raceSightingRows,
    };
    const raceMedia = {
      inspectSnapshot: async () => ({
        snapshotId: '44444444-4444-4444-8444-444444444444',
        snapshotAt,
        materializedAt,
        sourceMvccSnapshot,
        snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
        capturePolicy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        counts: { document: 0, photo: 0, video: 0 },
        backfillsComplete: { document: true, photo: true, video: true },
      }),
      fetchPage: async () => ({ nodes: [], nextCursor: null }),
    };
    await archiveEvidenceUniverse({
      corpusVersion: sourceCorpusVersion,
      sightings: raceSightings,
      media: raceMedia,
      storage,
      pageSize: 1,
      maxPartsPerRun: 1,
      now: () => new Date('2026-07-17T22:00:00.000Z'),
    });

    const targetCheckpointKey = getEvidenceUniverseControlKeys(targetCorpusVersion).checkpointKey;
    type PendingWrite = {
      body: Buffer;
      key: string;
      options: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[2];
      condition: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[3];
      resolve: (value: Awaited<ReturnType<CaseGraphConditionalArchiveStorage['uploadFileConditional']>>) => void;
      reject: (error: unknown) => void;
    };
    const pending: PendingWrite[] = [];
    const racingStorage: CaseGraphListableConditionalArchiveStorage = {
      ...storage,
      uploadFileConditional: async (body, key, options, condition) => {
        if (key !== targetCheckpointKey || !('ifAbsent' in condition)) {
          return storage.uploadFileConditional(body, key, options, condition);
        }
        return new Promise((resolve, reject) => {
          pending.push({ body: Buffer.from(body), key, options, condition, resolve, reject });
          if (pending.length !== 2) return;
          const ordered = pending.splice(0).sort((left, right) => {
            const leftType = JSON.parse(left.body.toString('utf8')).recordType as string;
            const rightType = JSON.parse(right.body.toString('utf8')).recordType as string;
            return Number(leftType === 'evidence_universe_seed_intent')
              - Number(rightType === 'evidence_universe_seed_intent');
          });
          void (async () => {
            for (const write of ordered) {
              try {
                write.resolve(await storage.uploadFileConditional(
                  write.body, write.key, write.options, write.condition,
                ));
              } catch (error) {
                write.reject(error);
              }
            }
          })();
        });
      },
    };

    const [seedResult, exportResult] = await Promise.allSettled([
      seedEvidenceUniverseCheckpoint({
        sourceCorpusVersion,
        targetCorpusVersion,
        snapshotId: '44444444-4444-4444-8444-444444444444',
        snapshotAt,
        selectedKinds: ['sighting'],
        storage: racingStorage,
        now: () => now,
      }),
      archiveEvidenceUniverse({
        corpusVersion: targetCorpusVersion,
        sightings: raceSightings,
        media: raceMedia,
        storage: racingStorage,
        pageSize: 1,
        maxPartsPerRun: 1,
        now: () => new Date('2026-07-17T23:30:00.000Z'),
      }),
    ]);

    expect(seedResult).toMatchObject({
      status: 'rejected',
      reason: { message: 'evidence_universe_seed_concurrent_writer_detected' },
    });
    expect(exportResult).toMatchObject({ status: 'fulfilled', value: { status: 'complete' } });
    const storedCheckpoint = JSON.parse(objects.get(targetCheckpointKey)!.toString('utf8')) as EvidenceUniverseCheckpoint;
    expect(storedCheckpoint.updatedAt).toBe('2026-07-17T23:30:00.000Z');
    expect(storedCheckpoint.exportedByKind).toEqual({ sighting: 1, document: 0, photo: 0, video: 0 });
    expect(objects.has(getEvidenceUniverseControlKeys(targetCorpusVersion).completionManifestKey)).toBe(true);
    expect(unconditionalUploads).toEqual([]);
  });
});
