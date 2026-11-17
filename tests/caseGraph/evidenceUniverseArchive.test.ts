import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from '../../src/caseGraph/archiveKeys';
import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphFeatureSource,
  CaseGraphSourceRow,
} from '../../src/caseGraph/archiveTypes';
import { archiveEvidenceUniverse, type EvidenceUniverseCheckpoint } from '../../src/caseGraph/evidenceUniverseArchive';
import { projectEvidenceUniverseNode, type EvidenceUniverseNodeKind } from '../../src/caseGraph/evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
} from '../../src/caseGraph/postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';

const snapshotAt = '2026-07-17T18:00:00.000Z';
const materializedAt = '2026-07-17T17:59:59.999Z';
const sourceMvccSnapshot = '100:200:';
const universeSnapshotId = '33333333-3333-4333-8333-333333333333';
const sightingRows: CaseGraphSourceRow[] = [{
  cursor: { updated_at: '2026-07-17T17:00:00.000Z', case_id: '11111111-1111-4111-8111-111111111111' },
  sighting: { id: '11111111-1111-4111-8111-111111111111', source: 'AARO', event_timestamp: '2024-01-01', lat: 35, lon: -110 },
}];
const sightings: CaseGraphFeatureSource = {
  inspectEligibleSnapshot: async () => ({
    eligible_count: 1, min_cursor: sightingRows[0].cursor, max_cursor: sightingRows[0].cursor,
    source_counts: { aaro: 1 }, publishability_policy: 'governed-test', snapshot_at: snapshotAt,
    snapshot_id: universeSnapshotId,
    snapshot_policy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capture_policy: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    materialized_at: materializedAt,
    source_mvcc_snapshot: sourceMvccSnapshot,
  }),
  fetchEligiblePage: async (cursor) => cursor ? [] : sightingRows,
};

const mediaRows = (['document', 'photo', 'video'] as const).map((kind, index) => projectEvidenceUniverseNode({
  kind, recordId: `${kind}-${index}`, source: 'archive', sourceRecordId: null, title: kind, summary: null,
  canonicalUrl: null, previewUrl: null, eventTimestamp: `200${index}-01-01`, lat: null, lon: null,
  location: null, countryCode: null, linkedSightingId: kind === 'photo' ? sightingRows[0].cursor.case_id : null,
  updatedAt: `2026-07-17T17:0${index}:00Z`, public: true,
}));

const media = {
  inspectSnapshot: async () => ({
    snapshotId: universeSnapshotId,
    snapshotAt,
    materializedAt,
    sourceMvccSnapshot,
    snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capturePolicy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    counts: { document: 1, photo: 1, video: 1 },
    backfillsComplete: { document: true, photo: true, video: true },
  }),
  fetchPage: async (kind: string, cursor: unknown) => {
    const nodes = cursor ? [] : mediaRows.filter((row) => row.kind === kind);
    const last = nodes.at(-1);
    return { nodes, nextCursor: last ? { updatedAt: last.updatedAt, recordId: last.recordId } : null };
  },
};

const storageFor = () => {
  const objects = new Map<string, Buffer>();
  const uploads: string[] = [];
  const versionOf = (body: Buffer) => `"${createHash('sha256').update(body).digest('hex')}"`;
  const storage: CaseGraphConditionalArchiveStorage = {
    readObject: async (key) => objects.get(key) || null,
    uploadFile: async (body, key) => { uploads.push(key); objects.set(key, Buffer.from(body)); return key; },
    readObjectVersioned: async (key) => {
      const body = objects.get(key);
      return body ? { body: Buffer.from(body), version: versionOf(body) } : null;
    },
    uploadFileConditional: async (body, key, _options, condition) => {
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
  return { storage, objects, uploads };
};

const checkpointFrom = (objects: Map<string, Buffer>, corpusVersion: string) => (
  JSON.parse(objects.get(getEvidenceUniverseControlKeys(corpusVersion).checkpointKey)!.toString('utf8')) as EvidenceUniverseCheckpoint
);

const storeCheckpoint = (
  objects: Map<string, Buffer>,
  corpusVersion: string,
  checkpoint: EvidenceUniverseCheckpoint,
) => {
  objects.set(
    getEvidenceUniverseControlKeys(corpusVersion).checkpointKey,
    Buffer.from(`${JSON.stringify(checkpoint)}\n`),
  );
};

describe('evidence universe R2 archive', () => {
  it('resumes across kinds and proves exact one-node-per-record accounting', async () => {
    const { storage, objects } = storageFor();
    const first = await archiveEvidenceUniverse({ corpusVersion: 'universe-test', sightings, media, storage, pageSize: 1, maxPartsPerRun: 2 });
    expect(first).toMatchObject({ status: 'partial', remainingNodes: 2 });
    expect(objects.has('case-vortex/corpora/universe-test/universe/nodes/_checkpoint.json')).toBe(true);
    const seedFingerprint = 'a'.repeat(64);
    const seededCheckpoint = checkpointFrom(objects, 'universe-test');
    seededCheckpoint.seedFingerprint = seedFingerprint;
    storeCheckpoint(objects, 'universe-test', seededCheckpoint);
    const second = await archiveEvidenceUniverse({ corpusVersion: 'universe-test', sightings, media, storage, pageSize: 1, maxPartsPerRun: 2 });
    expect(second.status).toBe('complete');
    if (second.status !== 'complete') throw new Error('expected completion');
    expect(second.completion.seedFingerprint).toBe(seedFingerprint);
    expect(second.completion.accounting).toEqual({
      total: 4, byKind: { sighting: 1, document: 1, photo: 1, video: 1 },
      attachedMedia: 1, unresolvedTime: 0, unresolvedLocation: 3,
    });
    expect(second.completion.parts).toHaveLength(4);
    for (const part of second.completion.parts) {
      const lines = gunzipSync(objects.get(part.archiveKey)!).toString('utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect((JSON.parse(lines[0]) as { kind: EvidenceUniverseNodeKind }).kind).toBe(part.kind);
    }
    const third = await archiveEvidenceUniverse({ corpusVersion: 'universe-test', sightings, media, storage });
    expect(third).toMatchObject({ status: 'already_complete', completion: { seedFingerprint } });
  });

  it('refuses mismatched media and sighting snapshots', async () => {
    const { storage } = storageFor();
    await expect(archiveEvidenceUniverse({
      corpusVersion: 'snapshot-mismatch', sightings,
      media: { ...media, inspectSnapshot: async () => ({ ...(await media.inspectSnapshot()), snapshotAt: '2026-07-17T19:00:00Z' }) },
      storage,
    })).rejects.toThrow('evidence_universe_snapshot_mismatch');
  });

  it.each([
    ['snapshot UUID', { snapshotId: '44444444-4444-4444-8444-444444444444' }],
    ['MVCC receipt', { sourceMvccSnapshot: '101:201:' }],
    ['materialization microsecond', { materializedAt: '2026-07-17T17:59:59.999001Z' }],
  ])('refuses a split frozen source identity: %s', async (_label, override) => {
    const { storage } = storageFor();
    await expect(archiveEvidenceUniverse({
      corpusVersion: `snapshot-identity-mismatch-${String(_label).replaceAll(' ', '-')}`,
      sightings,
      media: {
        ...media,
        inspectSnapshot: async () => ({ ...(await media.inspectSnapshot()), ...override }),
      },
      storage,
    })).rejects.toThrow('evidence_universe_snapshot_mismatch');
  });

  it('refuses a repeated stable address across separate immutable parts', async () => {
    const { storage } = storageFor();
    const duplicateNode = projectEvidenceUniverseNode({
      kind: 'document', recordId: 'repeated', source: 'archive', sourceRecordId: null, title: null, summary: null,
      canonicalUrl: null, previewUrl: null, eventTimestamp: null, lat: null, lon: null, location: null, countryCode: null,
      linkedSightingId: null, updatedAt: '2026-07-17T17:00:00Z', public: true,
    });
    let mediaPage = 0;
    await expect(archiveEvidenceUniverse({
      corpusVersion: 'duplicate-across-parts',
      sightings: {
        inspectEligibleSnapshot: async () => ({
          ...(await sightings.inspectEligibleSnapshot()),
          eligible_count: 0,
          min_cursor: null,
          max_cursor: null,
          source_counts: {},
        }),
        fetchEligiblePage: async () => [],
      },
      media: {
        inspectSnapshot: async () => ({
          ...(await media.inspectSnapshot()),
          counts: { document: 2, photo: 0, video: 0 },
        }),
        fetchPage: async () => ({
          nodes: [duplicateNode],
          nextCursor: { updatedAt: `2026-07-17T17:00:0${mediaPage++}Z`, recordId: duplicateNode.recordId },
        }),
      },
      storage,
      pageSize: 1,
      maxPartsPerRun: 2,
    })).rejects.toThrow('evidence_universe_duplicate_address_across_parts:document:repeated');
  });

  it('rejects same-total exported counts assigned to the wrong kind', async () => {
    const corpusVersion = 'checkpoint-kind-swap';
    const { storage, objects, uploads } = storageFor();
    await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 });
    const checkpoint = checkpointFrom(objects, corpusVersion);
    checkpoint.exportedByKind.sighting = 0;
    checkpoint.exportedByKind.document = 1;
    storeCheckpoint(objects, corpusVersion, checkpoint);
    const uploadsBeforeResume = uploads.length;

    await expect(archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 }))
      .rejects.toThrow('evidence_universe_checkpoint_invalid');
    expect(uploads).toHaveLength(uploadsBeforeResume);
  });

  it.each([
    ['out-of-order parts', (checkpoint: EvidenceUniverseCheckpoint) => checkpoint.parts.reverse()],
    ['non-sequential part number', (checkpoint: EvidenceUniverseCheckpoint) => { checkpoint.parts[1].partNumber = 1; }],
    ['non-canonical archive key', (checkpoint: EvidenceUniverseCheckpoint) => { checkpoint.parts[0].archiveKey += '.wrong'; }],
    ['checkpoint cursor not equal to last kind part', (checkpoint: EvidenceUniverseCheckpoint) => {
      checkpoint.cursors.document = { updatedAt: '2026-07-17T16:00:00Z', recordId: 'other' };
    }],
    ['part accounting assigned to another kind', (checkpoint: EvidenceUniverseCheckpoint) => {
      checkpoint.parts[0].accounting.byKind.sighting = 0;
      checkpoint.parts[0].accounting.byKind.document = 1;
    }],
    ['unsafe negative expected count', (checkpoint: EvidenceUniverseCheckpoint) => {
      checkpoint.expected.byKind.video = -1;
      checkpoint.expected.total -= 2;
    }],
    ['incomplete media backfill flag', (checkpoint: EvidenceUniverseCheckpoint) => {
      checkpoint.expected.mediaBackfillsComplete.video = false;
    }],
  ])('rejects invalid resumed checkpoint state: %s', async (_label, mutate) => {
    const corpusVersion = `checkpoint-invalid-${String(_label).replaceAll(' ', '-')}`;
    const { storage, objects, uploads } = storageFor();
    await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 2 });
    const checkpoint = checkpointFrom(objects, corpusVersion);
    mutate(checkpoint);
    storeCheckpoint(objects, corpusVersion, checkpoint);
    const uploadsBeforeResume = uploads.length;

    await expect(archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 }))
      .rejects.toThrow('evidence_universe_checkpoint_invalid');
    expect(uploads).toHaveLength(uploadsBeforeResume);
  });

  it('re-inspects every resume source invariant and writes nothing when it drifts', async () => {
    const shiftedSnapshot = '2026-07-17T19:00:00.000Z';
    const variants = [
      {
        label: 'count',
        resumeSightings: sightings,
        resumeMedia: { ...media, inspectSnapshot: async () => ({ ...(await media.inspectSnapshot()), counts: { document: 2, photo: 1, video: 1 } }) },
        error: 'evidence_universe_source_changed_during_export',
      },
      {
        label: 'snapshot',
        resumeSightings: {
          ...sightings,
          inspectEligibleSnapshot: async () => ({ ...(await sightings.inspectEligibleSnapshot()), snapshot_at: shiftedSnapshot }),
        },
        resumeMedia: { ...media, inspectSnapshot: async () => ({ ...(await media.inspectSnapshot()), snapshotAt: shiftedSnapshot }) },
        error: 'evidence_universe_source_changed_during_export',
      },
      {
        label: 'policy',
        resumeSightings: {
          ...sightings,
          inspectEligibleSnapshot: async () => ({ ...(await sightings.inspectEligibleSnapshot()), publishability_policy: 'changed-policy' }),
        },
        resumeMedia: media,
        error: 'evidence_universe_source_changed_during_export',
      },
      {
        label: 'backfill',
        resumeSightings: sightings,
        resumeMedia: {
          ...media,
          inspectSnapshot: async () => ({ ...(await media.inspectSnapshot()), backfillsComplete: { document: true, photo: true, video: false } }),
        },
        error: 'evidence_universe_expected_invalid',
      },
    ];

    for (const variant of variants) {
      const corpusVersion = `resume-source-drift-${variant.label}`;
      const { storage, uploads } = storageFor();
      await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 });
      const uploadsBeforeResume = uploads.length;
      await expect(archiveEvidenceUniverse({
        corpusVersion,
        sightings: variant.resumeSightings,
        media: variant.resumeMedia,
        storage,
        pageSize: 1,
        maxPartsPerRun: 1,
      })).rejects.toThrow(variant.error);
      expect(uploads, variant.label).toHaveLength(uploadsBeforeResume);
    }
  });

  it('rejects a non-advancing resumed cursor before uploading another immutable part', async () => {
    const repeatedCursorSightings: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => ({
        ...(await sightings.inspectEligibleSnapshot()),
        eligible_count: 2,
        min_cursor: sightingRows[0].cursor,
        max_cursor: sightingRows[0].cursor,
        source_counts: { aaro: 2 },
        publishability_policy: 'governed-test',
        snapshot_at: snapshotAt,
      }),
      fetchEligiblePage: async () => [sightingRows[0]],
    };
    const emptyMedia = {
      inspectSnapshot: async () => ({
        ...(await media.inspectSnapshot()),
        counts: { document: 0, photo: 0, video: 0 },
        backfillsComplete: { document: true, photo: true, video: true },
      }),
      fetchPage: async () => ({ nodes: [], nextCursor: null }),
    };
    const corpusVersion = 'non-advancing-resume-cursor';
    const { storage, uploads } = storageFor();
    await archiveEvidenceUniverse({
      corpusVersion,
      sightings: repeatedCursorSightings,
      media: emptyMedia,
      storage,
      pageSize: 1,
      maxPartsPerRun: 1,
    });
    const uploadsBeforeResume = uploads.length;

    await expect(archiveEvidenceUniverse({
      corpusVersion,
      sightings: repeatedCursorSightings,
      media: emptyMedia,
      storage,
      pageSize: 1,
      maxPartsPerRun: 1,
    })).rejects.toThrow('evidence_universe_source_cursor_did_not_advance');
    expect(uploads).toHaveLength(uploadsBeforeResume);
  });

  it('rejects a microsecond-regressing media cursor before immutable upload', async () => {
    const firstNode = mediaRows.find((row) => row.kind === 'document')!;
    const secondNode = projectEvidenceUniverseNode({
      kind: 'document', recordId: 'document-regressed', source: 'archive', sourceRecordId: null,
      title: null, summary: null, canonicalUrl: null, previewUrl: null, eventTimestamp: null,
      lat: null, lon: null, location: null, countryCode: null, linkedSightingId: null,
      updatedAt: '2026-07-17T17:00:00.123Z', public: true,
    });
    const noSightings: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => ({
        ...(await sightings.inspectEligibleSnapshot()),
        eligible_count: 0, min_cursor: null, max_cursor: null, source_counts: {},
        publishability_policy: 'governed-test', snapshot_at: snapshotAt,
      }),
      fetchEligiblePage: async () => [],
    };
    const regressingMedia = {
      inspectSnapshot: async () => ({
        ...(await media.inspectSnapshot()),
        counts: { document: 2, photo: 0, video: 0 },
        backfillsComplete: { document: true, photo: true, video: true },
      }),
      fetchPage: async (_kind: string, cursor: unknown) => cursor
        ? { nodes: [secondNode], nextCursor: { updatedAt: '2026-07-17T17:00:00.123455Z', recordId: 'document-regressed' } }
        : { nodes: [firstNode], nextCursor: { updatedAt: '2026-07-17T17:00:00.123456Z', recordId: firstNode.recordId } },
    };
    const corpusVersion = 'regressing-media-cursor';
    const { storage, uploads } = storageFor();
    await archiveEvidenceUniverse({
      corpusVersion, sightings: noSightings, media: regressingMedia, storage, pageSize: 1, maxPartsPerRun: 1,
    });
    const uploadsBeforeResume = uploads.length;

    await expect(archiveEvidenceUniverse({
      corpusVersion, sightings: noSightings, media: regressingMedia, storage, pageSize: 1, maxPartsPerRun: 1,
    })).rejects.toThrow('evidence_universe_source_cursor_did_not_advance');
    expect(uploads).toHaveLength(uploadsBeforeResume);
  });

  it('preserves exact media cursor bytes across a resumable C-collation boundary', async () => {
    const firstNode = projectEvidenceUniverseNode({
      kind: 'document', recordId: ' alpha ', source: 'archive', sourceRecordId: null,
      title: null, summary: null, canonicalUrl: null, previewUrl: null, eventTimestamp: null,
      lat: null, lon: null, location: null, countryCode: null, linkedSightingId: null,
      updatedAt: '2026-07-17T17:00:00.000Z', public: true,
    });
    const secondNode = projectEvidenceUniverseNode({
      kind: 'document', recordId: 'beta', source: 'archive', sourceRecordId: null,
      title: null, summary: null, canonicalUrl: null, previewUrl: null, eventTimestamp: null,
      lat: null, lon: null, location: null, countryCode: null, linkedSightingId: null,
      updatedAt: '2026-07-17T17:00:01.000Z', public: true,
    });
    const noSightings: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => ({
        ...(await sightings.inspectEligibleSnapshot()),
        eligible_count: 0,
        min_cursor: null,
        max_cursor: null,
        source_counts: {},
      }),
      fetchEligiblePage: async () => [],
    };
    let resumedCursor: string | null = null;
    const exactCursorMedia = {
      inspectSnapshot: async () => ({
        ...(await media.inspectSnapshot()),
        counts: { document: 2, photo: 0, video: 0 },
      }),
      fetchPage: async (_kind: string, cursor: { updatedAt: string; recordId: string } | null) => {
        if (!cursor) {
          return {
            nodes: [firstNode],
            nextCursor: { updatedAt: '2026-07-17T17:00:00.000000Z', recordId: ' alpha ' },
          };
        }
        resumedCursor = cursor.recordId;
        return {
          nodes: [secondNode],
          nextCursor: { updatedAt: '2026-07-17T17:00:01.000000Z', recordId: 'beta' },
        };
      },
    };
    const corpusVersion = 'exact-media-cursor-bytes';
    const { storage, objects } = storageFor();
    const first = await archiveEvidenceUniverse({
      corpusVersion,
      sightings: noSightings,
      media: exactCursorMedia,
      storage,
      pageSize: 1,
      maxPartsPerRun: 1,
    });
    expect(first.status).toBe('partial');
    expect((checkpointFrom(objects, corpusVersion).cursors.document as { recordId: string }).recordId).toBe(' alpha ');

    const second = await archiveEvidenceUniverse({
      corpusVersion,
      sightings: noSightings,
      media: exactCursorMedia,
      storage,
      pageSize: 1,
      maxPartsPerRun: 1,
    });
    expect(second.status).toBe('complete');
    expect(resumedCursor).toBe(' alpha ');
  });

  it('does not reuse a completion against a changed source contract', async () => {
    const corpusVersion = 'completed-source-drift';
    const { storage, uploads } = storageFor();
    const complete = await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 4 });
    expect(complete.status).toBe('complete');
    const uploadsBeforeReuse = uploads.length;

    await expect(archiveEvidenceUniverse({
      corpusVersion,
      sightings,
      media: { ...media, inspectSnapshot: async () => ({ ...(await media.inspectSnapshot()), counts: { document: 1, photo: 1, video: 2 } }) },
      storage,
    })).rejects.toThrow('evidence_universe_source_changed_during_export');
    expect(uploads).toHaveLength(uploadsBeforeReuse);
  });

  it('re-verifies every immutable manifest before reporting an existing corpus complete', async () => {
    const corpusVersion = 'completed-manifest-tamper';
    const { storage, objects } = storageFor();
    const result = await archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 4,
    });
    if (result.status !== 'complete') throw new Error('expected completion');
    objects.set(result.completion.parts[0].manifestKey, Buffer.from('{"attacker":"changed"}\n'));

    await expect(archiveEvidenceUniverse({ corpusVersion, sightings, media, storage }))
      .rejects.toThrow('evidence_universe_final_part_verification_failed');
  });

  it('recomputes uncompressed byte receipts instead of trusting a self-consistent manifest', async () => {
    const corpusVersion = 'completed-byte-receipt-tamper';
    const { storage, objects } = storageFor();
    const result = await archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 4,
    });
    if (result.status !== 'complete') throw new Error('expected completion');
    const completion = structuredClone(result.completion);
    completion.parts[0].uncompressedBytes += 1;
    objects.set(completion.parts[0].manifestKey, Buffer.from(`${JSON.stringify(completion.parts[0])}\n`));
    objects.set(
      getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey,
      Buffer.from(`${JSON.stringify(completion)}\n`),
    );

    await expect(archiveEvidenceUniverse({ corpusVersion, sightings, media, storage }))
      .rejects.toThrow('evidence_universe_final_part_bytes_mismatch');
  });

  it('rejects a checksummed shard whose node layout no longer matches the activated schema', async () => {
    const corpusVersion = 'completed-node-layout-tamper';
    const { storage, objects } = storageFor();
    const result = await archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 4,
    });
    if (result.status !== 'complete') throw new Error('expected completion');
    const completion = structuredClone(result.completion);
    const part = completion.parts[0];
    const raw = gunzipSync(objects.get(part.archiveKey)!).toString('utf8');
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    record.layoutVersion = 'evidence-universe-layout-v1';
    const tamperedRaw = Buffer.from(`${JSON.stringify(record)}\n`);
    const tamperedArchive = gzipSync(tamperedRaw, { level: 9 });
    part.compressedBytes = tamperedArchive.length;
    part.uncompressedBytes = tamperedRaw.length;
    part.sha256 = createHash('sha256').update(tamperedArchive).digest('hex');
    completion.archiveSetSha256 = createHash('sha256')
      .update(completion.parts.map((candidate) => `${candidate.kind}:${candidate.partNumber}:${candidate.sha256}`).join('\n'))
      .digest('hex');
    objects.set(part.archiveKey, tamperedArchive);
    objects.set(part.manifestKey, Buffer.from(`${JSON.stringify(part)}\n`));
    objects.set(
      getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey,
      Buffer.from(`${JSON.stringify(completion)}\n`),
    );

    await expect(archiveEvidenceUniverse({ corpusVersion, sightings, media, storage }))
      .rejects.toThrow('evidence_universe_final_node_layout_invalid');
  });

  it('never reports already-complete from a legacy completion missing the layout receipt', async () => {
    const corpusVersion = 'completed-layout-receipt-missing';
    const { storage, objects } = storageFor();
    const result = await archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 4,
    });
    if (result.status !== 'complete') throw new Error('expected completion');
    const completion = structuredClone(result.completion) as Record<string, unknown>;
    delete completion.layoutVersion;
    objects.set(
      getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey,
      Buffer.from(`${JSON.stringify(completion)}\n`),
    );

    await expect(archiveEvidenceUniverse({ corpusVersion, sightings, media, storage }))
      .rejects.toThrow('evidence_universe_completion_invalid');
  });

  it('fails closed when storage cannot provide atomic conditional writes', async () => {
    const { storage } = storageFor();
    await expect(archiveEvidenceUniverse({
      corpusVersion: 'unsafe-unconditional-storage',
      sightings,
      media,
      storage: { readObject: storage.readObject, uploadFile: storage.uploadFile },
    })).rejects.toThrow('evidence_universe_conditional_storage_required');
  });

  it('allows only one concurrent checkpoint transition from the same version', async () => {
    const corpusVersion = 'checkpoint-cas-race';
    const { storage, objects, uploads } = storageFor();
    await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 });

    const checkpointKey = getEvidenceUniverseControlKeys(corpusVersion).checkpointKey;
    const originalReadVersioned = storage.readObjectVersioned;
    let checkpointReads = 0;
    let releaseBoth!: () => void;
    const bothCheckpointReads = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const racingStorage: CaseGraphConditionalArchiveStorage = {
      ...storage,
      readObjectVersioned: async (key) => {
        const value = await originalReadVersioned(key);
        if (key === checkpointKey) {
          checkpointReads += 1;
          if (checkpointReads === 2) releaseBoth();
          await bothCheckpointReads;
        }
        return value;
      },
    };

    const results = await Promise.allSettled([
      archiveEvidenceUniverse({ corpusVersion, sightings, media, storage: racingStorage, pageSize: 1, maxPartsPerRun: 1 }),
      archiveEvidenceUniverse({ corpusVersion, sightings, media, storage: racingStorage, pageSize: 1, maxPartsPerRun: 1 }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: 'evidence_universe_concurrent_writer_detected',
    });

    const checkpoint = checkpointFrom(objects, corpusVersion);
    expect(checkpoint.exportedByKind).toMatchObject({ sighting: 1, document: 1 });
    expect(checkpoint.parts).toHaveLength(2);
    const documentKeys = getEvidenceUniversePartKeys(corpusVersion, 'document', 0);
    expect(uploads.filter((key) => key === documentKeys.archiveKey)).toHaveLength(1);
    expect(uploads.filter((key) => key === documentKeys.manifestKey)).toHaveLength(1);
  });

  it('recovers safely when checkpoint CAS fails after immutable part upload', async () => {
    const corpusVersion = 'checkpoint-cas-failure-recovery';
    const { storage, objects } = storageFor();
    await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 });

    const checkpointKey = getEvidenceUniverseControlKeys(corpusVersion).checkpointKey;
    let injectCasFailure = true;
    const failingStorage: CaseGraphConditionalArchiveStorage = {
      ...storage,
      uploadFileConditional: async (body, key, options, condition) => {
        if (injectCasFailure && key === checkpointKey && 'ifVersion' in condition) {
          injectCasFailure = false;
          return { status: 'precondition_failed' };
        }
        return storage.uploadFileConditional(body, key, options, condition);
      },
    };

    await expect(archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage: failingStorage, pageSize: 1, maxPartsPerRun: 1,
    })).rejects.toThrow('evidence_universe_concurrent_writer_detected');
    expect(checkpointFrom(objects, corpusVersion).exportedByKind.document).toBe(0);
    const documentKeys = getEvidenceUniversePartKeys(corpusVersion, 'document', 0);
    expect(objects.has(documentKeys.archiveKey)).toBe(true);
    expect(objects.has(documentKeys.manifestKey)).toBe(true);

    const retry = await archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1,
    });
    expect(retry).toMatchObject({ status: 'partial' });
    expect(checkpointFrom(objects, corpusVersion).exportedByKind.document).toBe(1);
  });

  it('never replaces a conflicting immutable part left outside the checkpoint', async () => {
    const corpusVersion = 'immutable-part-conflict';
    const { storage, objects } = storageFor();
    await archiveEvidenceUniverse({ corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1 });
    const checkpointBefore = Buffer.from(objects.get(getEvidenceUniverseControlKeys(corpusVersion).checkpointKey)!);
    const documentKeys = getEvidenceUniversePartKeys(corpusVersion, 'document', 0);
    objects.set(documentKeys.archiveKey, Buffer.from('different-writer-bytes'));

    await expect(archiveEvidenceUniverse({
      corpusVersion, sightings, media, storage, pageSize: 1, maxPartsPerRun: 1,
    })).rejects.toThrow(`evidence_universe_immutable_object_conflict:${documentKeys.archiveKey}`);
    expect(objects.get(documentKeys.archiveKey)).toEqual(Buffer.from('different-writer-bytes'));
    expect(objects.get(getEvidenceUniverseControlKeys(corpusVersion).checkpointKey)).toEqual(checkpointBefore);
  });
});
