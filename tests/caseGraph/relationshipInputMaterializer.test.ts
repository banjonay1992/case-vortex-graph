import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from '../../src/caseGraph/archiveKeys';
import type {
  CaseGraphArchiveWriteCondition,
  CaseGraphConditionalArchiveStorage,
  CaseGraphCursor,
  CaseGraphFeatureSource,
  CaseGraphSourceRow,
  CaseGraphSourceStats,
} from '../../src/caseGraph/archiveTypes';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
  type EvidenceUniversePart,
} from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  projectEvidenceUniverseNode,
  projectSightingEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from '../../src/caseGraph/evidenceUniverse';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import {
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
} from '../../src/caseGraph/postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';
import {
  decodeRelationshipInputPart,
  getRelationshipInputControlKeys,
} from '../../src/caseGraph/relationshipInputArchive';
import {
  decodeRelationshipInputMaterializationCompletion,
  materializeRelationshipInputArchive,
} from '../../src/caseGraph/relationshipInputMaterializer';

const SNAPSHOT_ID = '40000000-0000-4000-8000-000000000001';
const SNAPSHOT_AT = '2026-07-18T00:30:00.000Z';
const MATERIALIZED_AT = '2026-07-18T00:29:59.999321Z';
const MVCC = '100:200:150,175';
const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

class MemoryStorage implements CaseGraphConditionalArchiveStorage {
  objects = new Map<string, Buffer>();
  versions = new Map<string, number>();
  loseAfterWrite = new Set<string>();
  unconditionalWrites = 0;

  async readObject(key: string) {
    const body = this.objects.get(key);
    return body ? Buffer.from(body) : null;
  }

  async readObjectVersioned(key: string) {
    const body = this.objects.get(key);
    const version = this.versions.get(key);
    return body && version ? { body: Buffer.from(body), version: `v${version}` } : null;
  }

  async uploadFile(): Promise<string> {
    this.unconditionalWrites += 1;
    throw new Error('unconditional_write_forbidden');
  }

  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: unknown,
    condition: CaseGraphArchiveWriteCondition,
  ) {
    const current = this.versions.get(key);
    if (
      ('ifAbsent' in condition && current !== undefined)
      || ('ifVersion' in condition && condition.ifVersion !== `v${current}`)
    ) return { status: 'precondition_failed' as const };
    const version = (current || 0) + 1;
    this.objects.set(key, Buffer.from(body));
    this.versions.set(key, version);
    const suffix = [...this.loseAfterWrite].find((candidate) => key.endsWith(candidate));
    if (suffix) {
      this.loseAfterWrite.delete(suffix);
      throw new Error(`simulated_lost_ack:${suffix}`);
    }
    return { status: 'written' as const, key, version: `v${version}` };
  }
}

const tempParents: string[] = [];
const tempParent = async () => {
  const path = await mkdtemp(join(tmpdir(), 'relationship-input-materializer-test-'));
  tempParents.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(tempParents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const caseId = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

const makeRow = (suffix: number, minute: number): CaseGraphSourceRow => {
  const id = caseId(suffix);
  const updatedAt = new Date(Date.UTC(2026, 6, 18, 0, minute)).toISOString();
  return {
    cursor: { updated_at: updatedAt, case_id: id },
    sighting: {
      id,
      source: 'archive-a',
      source_record_id: `source-${suffix}`,
      source_url: `https://example.test/cases/${suffix}`,
      updated_at: updatedAt,
      event_timestamp: new Date(Date.UTC(2026, 6, 17, 23, minute)).toISOString(),
      event_date_precision: 'exact',
      lat: 50 + suffix / 100,
      lon: -5,
      geo_precision: 'city',
      duration_seconds: suffix * 10,
      shape: suffix % 2 ? 'triangle' : 'sphere',
      description: suffix % 2
        ? 'A silent amber triangle hovered for two minutes.'
        : 'A blue sphere moved east and then disappeared.',
    },
  };
};

const statsFor = (rows: CaseGraphSourceRow[]): CaseGraphSourceStats => {
  const ordered = [...rows].sort((left, right) => compareCaseGraphCursors(left.cursor, right.cursor));
  const sourceCounts: Record<string, number> = {};
  for (const row of ordered) {
    const source = String(row.sighting.source);
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  return {
    snapshot_id: SNAPSHOT_ID,
    snapshot_policy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capture_policy: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    materialized_at: MATERIALIZED_AT,
    source_mvcc_snapshot: MVCC,
    eligible_count: ordered.length,
    min_cursor: ordered[0]?.cursor || null,
    max_cursor: ordered.at(-1)?.cursor || null,
    source_counts: Object.fromEntries(Object.entries(sourceCounts).sort(([left], [right]) => left.localeCompare(right))),
    publishability_policy: 'publishable_public_v2',
    snapshot_at: SNAPSHOT_AT,
  };
};

const sourceFor = (rows: CaseGraphSourceRow[]): CaseGraphFeatureSource => {
  const ordered = [...rows].sort((left, right) => compareCaseGraphCursors(left.cursor, right.cursor));
  return {
    inspectEligibleSnapshot: async () => statsFor(ordered),
    fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => (
      ordered.filter((row) => !cursor || compareCaseGraphCursors(row.cursor, cursor) > 0).slice(0, limit)
    ),
  };
};

const mediaNode = (
  kind: Exclude<EvidenceUniverseNodeKind, 'sighting'>,
  recordId: string,
  linkedSightingId: string | null,
) => projectEvidenceUniverseNode({
  kind,
  recordId,
  source: 'official-records',
  sourceRecordId: `source-${recordId}`,
  title: `${kind} ${recordId}`,
  summary: kind === 'document' ? 'Official report describing a white light.' : null,
  canonicalUrl: `https://example.test/${kind}/${recordId}`,
  previewUrl: kind === 'document' ? null : `https://example.test/${kind}/${recordId}/preview`,
  eventTimestamp: '2026-07-17T22:00:00.000Z',
  lat: 51.5,
  lon: -0.1,
  location: 'London',
  countryCode: 'GB',
  linkedSightingId,
  updatedAt: '2026-07-18T00:20:00.000Z',
  public: true,
});

const buildUniverse = (
  storage: MemoryStorage,
  corpusVersion: string,
  nodes: EvidenceUniverseNode[],
  snapshotId = SNAPSHOT_ID,
) => {
  const parts: EvidenceUniversePart[] = [];
  const cursors: EvidenceUniverseCompletion['cursors'] = {
    sighting: null, document: null, photo: null, video: null,
  };
  for (const kind of KINDS) {
    const values = nodes.filter((node) => node.kind === kind);
    if (!values.length) continue;
    const raw = Buffer.from(values.map((node) => `${JSON.stringify(node)}\n`).join(''));
    const archive = gzipSync(raw);
    const keys = getEvidenceUniversePartKeys(corpusVersion, kind, 0);
    const last = values.at(-1)!;
    const cursor = kind === 'sighting'
      ? { updated_at: last.updatedAt, case_id: last.recordId }
      : { updatedAt: last.updatedAt, recordId: last.recordId };
    const part: EvidenceUniversePart = {
      partNumber: 0,
      kind,
      rowCount: values.length,
      ...keys,
      compressedBytes: archive.length,
      uncompressedBytes: raw.length,
      sha256: sha(archive),
      firstAddress: values[0].address,
      lastAddress: last.address,
      cursor,
      accounting: accountEvidenceUniverseNodes(values),
    };
    parts.push(part);
    cursors[kind] = cursor;
    storage.objects.set(keys.archiveKey, archive);
  }
  const byKind = Object.fromEntries(KINDS.map((kind) => [
    kind,
    nodes.filter((node) => node.kind === kind).length,
  ])) as Record<EvidenceUniverseNodeKind, number>;
  const completion: EvidenceUniverseCompletion = {
    recordType: 'evidence_universe_completion',
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion,
    expected: {
      snapshotId,
      snapshotAt: SNAPSHOT_AT,
      materializedAt: MATERIALIZED_AT,
      sourceMvccSnapshot: MVCC,
      snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      capturePolicies: {
        sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
        document: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        photo: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        video: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      },
      byKind,
      total: nodes.length,
      sightingPolicy: 'governed-test-v1',
      mediaBackfillsComplete: { document: true, photo: true, video: true },
    },
    exportedByKind: byKind,
    cursors,
    parts,
    accounting: accountEvidenceUniverseNodes(nodes),
    archiveSetSha256: sha(parts.map((part) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n')),
    completedAt: '2026-07-18T00:40:00.000Z',
  };
  storage.objects.set(
    getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey,
    Buffer.from(`${JSON.stringify(completion)}\n`),
  );
  return completion;
};

const setup = async (options: {
  universeRows?: CaseGraphSourceRow[];
  featureRows?: CaseGraphSourceRow[];
  snapshotId?: string;
} = {}) => {
  const storage = new MemoryStorage();
  // Cursor order is deliberately the reverse of address order.
  const universeRows = options.universeRows || [makeRow(2, 1), makeRow(1, 2)];
  const featureRows = options.featureRows || universeRows;
  const sightingNodes = universeRows
    .slice()
    .sort((left, right) => compareCaseGraphCursors(left.cursor, right.cursor))
    .map((row) => projectSightingEvidenceUniverseNode(row));
  const nodes = [
    ...sightingNodes,
    mediaNode('document', 'z-document', sightingNodes[0]?.recordId || null),
    mediaNode('photo', 'a-photo', sightingNodes[1]?.recordId || null),
    mediaNode('video', 'm-video', null),
  ];
  const universeCorpusVersion = 'universe-archive-v3-test';
  const featureCorpusVersion = 'feature-archive-v2-test';
  const universe = buildUniverse(storage, universeCorpusVersion, nodes, options.snapshotId);
  await archiveCaseGraphFeatures({
    corpusVersion: featureCorpusVersion,
    source: sourceFor(featureRows),
    storage,
    universeBinding: {
      corpus_version: universeCorpusVersion,
      archive_set_sha256: universe.archiveSetSha256,
    },
    pageSize: 1,
    maxPartsPerRun: 100,
    now: () => new Date('2026-07-18T00:45:00.000Z'),
  });
  return { storage, nodes, universe, universeCorpusVersion, featureCorpusVersion };
};

describe('relationship-input archive materializer', () => {
  it('externally sorts every node, joins each sighting once, resumes, and fully verifies completion', async () => {
    const fixture = await setup();
    const temp = await tempParent();
    fixture.storage.loseAfterWrite.add('materialization-v2/_intent.json');
    fixture.storage.loseAfterWrite.add('materialization-v2/_checkpoint.json');
    fixture.storage.loseAfterWrite.add('part-000000.ndjson.gz');
    fixture.storage.loseAfterWrite.add('_complete.manifest.json');
    fixture.storage.loseAfterWrite.add('materialization-v2/_complete.manifest.json');

    const first = await materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      rowsPerPart: 2,
      maxPartsPerRun: 1,
      targetUncompressedBytes: 128 * 1024,
      tempParent: temp,
      now: () => new Date('2026-07-18T01:00:00.000Z'),
    });
    expect(first).toMatchObject({ status: 'partial', remainingRows: 3 });
    expect(await readdir(temp)).toEqual([]);

    const second = await materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      rowsPerPart: 2,
      maxPartsPerRun: 10,
      targetUncompressedBytes: 128 * 1024,
      tempParent: temp,
      now: () => new Date('2026-07-18T01:05:00.000Z'),
    });
    expect(second).toMatchObject({
      status: 'complete',
      completion: {
        rowCount: 5,
        partCount: 3,
        feature: { recordCount: 2, universeArchiveSetSha256: fixture.universe.archiveSetSha256 },
      },
    });
    if (second.status !== 'complete') throw new Error('expected completion');
    const addresses: string[] = [];
    for (const summary of second.snapshot.parts) {
      const manifestBody = await fixture.storage.readObject(summary.manifestKey);
      const archiveBody = await fixture.storage.readObject(summary.archiveKey);
      const decoded = decodeRelationshipInputPart(archiveBody!, manifestBody!, second.intent.binding);
      addresses.push(...decoded.records.map((record) => record.address));
    }
    expect(addresses).toEqual(fixture.nodes.map((node) => node.address).sort());
    expect(new Set(addresses).size).toBe(fixture.nodes.length);
    expect(second.completion.feature.completionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.storage.unconditionalWrites).toBe(0);
    expect(fixture.storage.loseAfterWrite.size).toBe(0);
    expect(await readdir(temp)).toEqual([]);

    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: temp,
      rowsPerPart: 2,
      targetUncompressedBytes: 128 * 1024,
    })).resolves.toMatchObject({ status: 'already_complete', completion: { rowCount: 5 } });

    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: temp,
      rowsPerPart: 3,
      targetUncompressedBytes: 128 * 1024,
    })).rejects.toThrow('relationship_input_materialization_intent_conflict');
  });

  it('fails before writing an intent when snapshot receipts do not align', async () => {
    const fixture = await setup({ snapshotId: '40000000-0000-4000-8000-000000000002' });
    const temp = await tempParent();
    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: temp,
    })).rejects.toThrow('relationship_input_materialization_archive_alignment_mismatch');
    const wrongBinding = {
      snapshotId: '40000000-0000-4000-8000-000000000002',
      corpusVersion: fixture.universeCorpusVersion,
      universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
      universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      universeArchiveSetSha256: fixture.universe.archiveSetSha256,
      universeRecordCount: fixture.universe.expected.total,
    } as const;
    expect(fixture.storage.objects.has(getRelationshipInputControlKeys(wrongBinding).materializationIntentKey)).toBe(false);
  });

  it('detects equal-count feature substitutions instead of silently dropping a sighting', async () => {
    const fixture = await setup({
      universeRows: [makeRow(1, 1), makeRow(2, 2)],
      featureRows: [makeRow(1, 1), makeRow(3, 2)],
    });
    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: await tempParent(),
    })).rejects.toThrow(/relationship_input_materialization_(missing|orphan)_feature/);
  });

  it('requires the whole archived feature receipt to match its universe sighting', async () => {
    const universeRow = makeRow(1, 1);
    const featureRow = makeRow(1, 1);
    featureRow.sighting = { ...featureRow.sighting, source: 'archive-b' };
    const fixture = await setup({ universeRows: [universeRow], featureRows: [featureRow] });
    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: await tempParent(),
    })).rejects.toThrow('relationship_input_feature_join_mismatch');
  });

  it('accepts only the canonical case-folding difference used by the full corpus source labels', async () => {
    const universeRow = makeRow(1, 1);
    universeRow.sighting = { ...universeRow.sighting, source: 'ARCHIVE-A' };
    const featureRow = makeRow(1, 1);
    const fixture = await setup({ universeRows: [universeRow], featureRows: [featureRow] });
    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: await tempParent(),
    })).resolves.toMatchObject({ status: 'complete' });
  });

  it('revalidates immutable output bytes on an already-complete rerun', async () => {
    const fixture = await setup();
    const temp = await tempParent();
    const result = await materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      rowsPerPart: 10,
      maxPartsPerRun: 10,
      targetUncompressedBytes: 256 * 1024,
      tempParent: temp,
    });
    if (result.status !== 'complete') throw new Error('expected completion');
    const archiveKey = result.snapshot.parts[0].archiveKey;
    fixture.storage.objects.set(archiveKey, Buffer.from('corrupt'));
    await expect(materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: temp,
      rowsPerPart: 10,
      targetUncompressedBytes: 256 * 1024,
    })).rejects.toThrow('relationship_input_part_compressed_receipt_mismatch');
  });

  it('rejects a tampered feature-bound materialization completion', async () => {
    const fixture = await setup();
    const result = await materializeRelationshipInputArchive({
      storage: fixture.storage,
      universeCorpusVersion: fixture.universeCorpusVersion,
      featureCorpusVersion: fixture.featureCorpusVersion,
      tempParent: await tempParent(),
      maxPartsPerRun: 10,
    });
    if (result.status !== 'complete') throw new Error('expected completion');
    expect(() => decodeRelationshipInputMaterializationCompletion({
      ...result.completion,
      feature: { ...result.completion.feature, archiveSetSha256: 'f'.repeat(64) },
    }, result.intent)).toThrow(/completion_(digest|input)_mismatch/);
  });
});
