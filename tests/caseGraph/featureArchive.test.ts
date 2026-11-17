import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { getCaseGraphFeatureControlKeys } from '../../src/caseGraph/archiveKeys';
import type {
  CaseGraphArchiveStorage,
  CaseGraphArchiveWriteCondition,
  CaseGraphConditionalArchiveStorage,
  CaseGraphCursor,
  CaseGraphFeatureSource,
  CaseGraphSourceRow,
  CaseGraphSourceStats,
} from '../../src/caseGraph/archiveTypes';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import {
  compareCaseGraphCursors,
  getCaseGraphFeatureArchiveSetSha256,
} from '../../src/caseGraph/featureArchiveCodec';

const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000123';

const makeRow = (index: number, source = index % 2 ? 'archive-b' : 'archive-a'): CaseGraphSourceRow => {
  const caseId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const updatedAt = new Date(Date.UTC(2026, 6, 17, 12, index)).toISOString();
  return {
    cursor: { updated_at: updatedAt, case_id: caseId },
    sighting: {
      id: caseId,
      source,
      updated_at: updatedAt,
      event_timestamp: updatedAt,
      event_date_precision: 'exact',
      lat: 50 + (index / 100),
      lon: -5,
      geo_precision: 'city',
      description: index === 1 ? 'Rare amber chevron hovered silently.' : 'An amber light moved east.',
    },
  };
};

const statsFor = (
  rows: CaseGraphSourceRow[],
  overrides: Partial<CaseGraphSourceStats> = {},
): CaseGraphSourceStats => {
  const ordered = [...rows].sort((left, right) => compareCaseGraphCursors(left.cursor, right.cursor));
  const sourceCounts: Record<string, number> = {};
  for (const row of ordered) {
    const source = String(row.sighting.source);
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  return {
    snapshot_id: SNAPSHOT_ID,
    snapshot_policy: 'evidence-universe-materialized-v1',
    capture_policy: 'publishable-public-v2-materialized-v1',
    materialized_at: '2026-07-18T00:29:59.999321Z',
    source_mvcc_snapshot: '100:200:150,175',
    eligible_count: ordered.length,
    min_cursor: ordered[0]?.cursor || null,
    max_cursor: ordered.at(-1)?.cursor || null,
    source_counts: Object.fromEntries(Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b))),
    publishability_policy: 'publishable_public_v2',
    snapshot_at: '2026-07-18T00:30:00.000Z',
    ...overrides,
  };
};

class MemoryStorage implements CaseGraphConditionalArchiveStorage {
  objects = new Map<string, Buffer>();
  versions = new Map<string, number>();
  conditionalAttempts: Array<{ key: string; condition: CaseGraphArchiveWriteCondition }> = [];
  corruptArchiveWrites = false;
  rejectNextCheckpointWrite = false;
  loseNextCheckpointResponse = false;
  unconditionalWrites = 0;

  async readObject(key: string) {
    const value = this.objects.get(key);
    return value ? Buffer.from(value) : null;
  }

  async readObjectVersioned(key: string) {
    const body = this.objects.get(key);
    const version = this.versions.get(key);
    return body && version ? { body: Buffer.from(body), version: `v${version}` } : null;
  }

  async uploadFile(_body: Buffer, _key: string): Promise<string> {
    this.unconditionalWrites += 1;
    throw new Error('unconditional_write_forbidden');
  }

  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: unknown,
    condition: CaseGraphArchiveWriteCondition,
  ) {
    this.conditionalAttempts.push({ key, condition });
    const currentVersion = this.versions.get(key);
    const isCheckpoint = key.endsWith('/_checkpoint.json');
    if (isCheckpoint && this.rejectNextCheckpointWrite) {
      this.rejectNextCheckpointWrite = false;
      return { status: 'precondition_failed' as const };
    }
    if (
      ('ifAbsent' in condition && currentVersion !== undefined)
      || ('ifVersion' in condition && condition.ifVersion !== `v${currentVersion}`)
    ) return { status: 'precondition_failed' as const };
    const version = (currentVersion || 0) + 1;
    const stored = this.corruptArchiveWrites && key.endsWith('.ndjson.gz')
      ? Buffer.from('corrupt')
      : Buffer.from(body);
    this.objects.set(key, stored);
    this.versions.set(key, version);
    if (isCheckpoint && this.loseNextCheckpointResponse) {
      this.loseNextCheckpointResponse = false;
      throw new Error('simulated_lost_checkpoint_response');
    }
    return { status: 'written' as const, key, version: `v${version}` };
  }
}

const sourceFor = (rows: CaseGraphSourceRow[]) => {
  const ordered = [...rows].sort((left, right) => compareCaseGraphCursors(left.cursor, right.cursor));
  const state = {
    receipt: statsFor(ordered),
    inspections: 0,
    fetches: [] as Array<CaseGraphCursor | null>,
  };
  const source: CaseGraphFeatureSource = {
    async inspectEligibleSnapshot() {
      state.inspections += 1;
      return state.receipt;
    },
    async fetchEligiblePage(cursor: CaseGraphCursor | null, limit: number) {
      state.fetches.push(cursor);
      return ordered.filter((row) => !cursor || compareCaseGraphCursors(row.cursor, cursor) > 0).slice(0, limit);
    },
  };
  return { source, state };
};

describe('case graph feature archive coordinator v2', () => {
  it('CAS-checkpoints, resumes and strictly revalidates a snapshot-bound completion', async () => {
    const { source, state } = sourceFor([makeRow(1), makeRow(2), makeRow(3)]);
    const storage = new MemoryStorage();
    const universeBinding = { corpus_version: 'universe-v3', archive_set_sha256: 'a'.repeat(64) };
    const first = await archiveCaseGraphFeatures({
      corpusVersion: 'corpus-run-v2', source, storage, universeBinding, pageSize: 2, maxPartsPerRun: 1,
      now: () => new Date('2026-07-18T01:00:00Z'),
    });
    expect(first).toMatchObject({
      status: 'partial',
      remaining_rows: 1,
      checkpoint: {
        schema_version: 2,
        binding: { snapshot_id: SNAPSHOT_ID, universe: universeBinding },
      },
    });

    const second = await archiveCaseGraphFeatures({
      corpusVersion: 'corpus-run-v2', source, storage, universeBinding, pageSize: 2, maxPartsPerRun: 2,
      now: () => new Date('2026-07-18T01:05:00Z'),
    });
    expect(second).toMatchObject({
      status: 'complete',
      completion: {
        schema_version: 2,
        exported_row_count: 3,
        part_count: 2,
        binding: { source_mvcc_snapshot: '100:200:150,175', universe: universeBinding },
      },
    });
    const keys = getCaseGraphFeatureControlKeys('corpus-run-v2');
    expect(storage.objects.has(keys.rarityKey)).toBe(true);
    expect(storage.objects.has(keys.completionManifestKey)).toBe(true);
    expect(storage.unconditionalWrites).toBe(0);
    expect(storage.conditionalAttempts.filter(({ key }) => !key.endsWith('/_checkpoint.json')))
      .toSatisfy((attempts: unknown[]) => attempts.every((attempt: any) => attempt.condition.ifAbsent === true));
    expect(storage.conditionalAttempts.filter(({ key }) => key.endsWith('/_checkpoint.json')).map(({ condition }) => condition))
      .toEqual([{ ifAbsent: true }, { ifVersion: 'v1' }]);

    const inspectionsBefore = state.inspections;
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-run-v2', source, storage, universeBinding, pageSize: 2,
    })).resolves.toMatchObject({ status: 'already_complete', completion: { exported_row_count: 3 } });
    expect(state.inspections).toBe(inspectionsBefore + 1);
  });

  it('rejects a live/unmaterialized source before any archive object is written', async () => {
    const row = makeRow(1);
    const storage = new MemoryStorage();
    const liveSource = {
      inspectEligibleSnapshot: async () => ({
        eligible_count: 1,
        min_cursor: row.cursor,
        max_cursor: row.cursor,
        source_counts: { 'archive-b': 1 },
        publishability_policy: 'publishable_public_v2',
        snapshot_at: '2026-07-18T00:30:00Z',
      }),
      fetchEligiblePage: async () => [row],
    } as unknown as CaseGraphFeatureSource;
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-live-rejected-v2', source: liveSource, storage,
    })).rejects.toThrow('case_graph_source_snapshot_policy_invalid');
    expect(storage.objects.size).toBe(0);
  });

  it('fails closed when a resume points at a different global snapshot or universe archive', async () => {
    const { source, state } = sourceFor([makeRow(1), makeRow(2)]);
    const storage = new MemoryStorage();
    await archiveCaseGraphFeatures({
      corpusVersion: 'corpus-split-v2', source, storage, pageSize: 1, maxPartsPerRun: 1,
      universeBinding: { corpus_version: 'universe-v3', archive_set_sha256: 'a'.repeat(64) },
    });
    state.receipt = statsFor([makeRow(1), makeRow(2)], {
      snapshot_id: '00000000-0000-4000-8000-000000000124',
    });
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-split-v2', source, storage, pageSize: 1,
      universeBinding: { corpus_version: 'universe-v3', archive_set_sha256: 'a'.repeat(64) },
    })).rejects.toThrow('case_graph_source_changed_during_export');

    state.receipt = statsFor([makeRow(1), makeRow(2)]);
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-split-v2', source, storage, pageSize: 1,
      universeBinding: { corpus_version: 'universe-v3', archive_set_sha256: 'b'.repeat(64) },
    })).rejects.toThrow('case_graph_source_changed_during_export');
  });

  it('detects source receipt drift within a single invocation before completion', async () => {
    const rows = [makeRow(1)];
    let inspections = 0;
    const source: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => {
        inspections += 1;
        return statsFor(rows, inspections === 1 ? {} : { source_mvcc_snapshot: '101:201:' });
      },
      fetchEligiblePage: async () => rows,
    };
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-drift-v2', source, storage: new MemoryStorage(), pageSize: 1,
    })).rejects.toThrow('case_graph_source_changed_during_export');
  });

  it('recovers from a lost checkpoint response and reuses immutable byte-identical parts', async () => {
    const { source, state } = sourceFor([makeRow(1), makeRow(2), makeRow(3)]);
    const storage = new MemoryStorage();
    storage.loseNextCheckpointResponse = true;
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-lost-checkpoint-v2', source, storage, pageSize: 1, maxPartsPerRun: 1,
    })).rejects.toThrow('simulated_lost_checkpoint_response');

    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-lost-checkpoint-v2', source, storage, pageSize: 1, maxPartsPerRun: 1,
    })).resolves.toMatchObject({ status: 'partial', checkpoint: { exported_row_count: 2 } });
    expect(state.fetches.at(-1)).toEqual(makeRow(1).cursor);
  });

  it('fails a racing checkpoint CAS, then safely reuses an orphaned immutable part', async () => {
    const { source } = sourceFor([makeRow(1), makeRow(2)]);
    const storage = new MemoryStorage();
    storage.rejectNextCheckpointWrite = true;
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-race-v2', source, storage, pageSize: 1, maxPartsPerRun: 1,
    })).rejects.toThrow('case_graph_checkpoint_write_conflict');
    const partAttemptsBefore = storage.conditionalAttempts.filter(({ key }) => key.endsWith('.ndjson.gz')).length;
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-race-v2', source, storage, pageSize: 1, maxPartsPerRun: 1,
    })).resolves.toMatchObject({ status: 'partial', checkpoint: { exported_row_count: 1 } });
    expect(storage.conditionalAttempts.filter(({ key }) => key.endsWith('.ndjson.gz')))
      .toHaveLength(partAttemptsBefore + 1);
  });

  it('never replaces a conflicting orphaned immutable part', async () => {
    const { source } = sourceFor([makeRow(1)]);
    const storage = new MemoryStorage();
    const key = 'case-vortex/corpora/corpus-orphan-conflict-v2/features/parts/part-000000.ndjson.gz';
    storage.objects.set(key, Buffer.from('foreign-bytes'));
    storage.versions.set(key, 1);
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-orphan-conflict-v2', source, storage, pageSize: 1,
    })).rejects.toThrow('case_graph_feature_archive_immutable_conflict');
    expect(storage.objects.get(key)?.toString()).toBe('foreign-bytes');
  });

  it('verifies stored compressed bytes, manifests and decoded features before completion reuse', async () => {
    const { source, state } = sourceFor([makeRow(1)]);
    const storage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'corpus-corrupt-v2', source, storage, pageSize: 1 });
    const keys = getCaseGraphFeatureControlKeys('corpus-corrupt-v2');
    const completion = JSON.parse(String(storage.objects.get(keys.completionManifestKey)));

    storage.objects.set(completion.parts[0].archive_key, Buffer.from('corrupt'));
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-corrupt-v2', source, storage,
    })).rejects.toThrow('case_graph_feature_archive_bytes_mismatch');
    expect(state.inspections).toBeGreaterThan(2);

    const semanticStorage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'corpus-semantic-corrupt-v2', source, storage: semanticStorage, pageSize: 1 });
    const semanticKeys = getCaseGraphFeatureControlKeys('corpus-semantic-corrupt-v2');
    const semanticCompletion = JSON.parse(String(semanticStorage.objects.get(semanticKeys.completionManifestKey)));
    const part = semanticCompletion.parts[0];
    const archive = semanticStorage.objects.get(part.archive_key)!;
    const decoded = gunzipSync(archive).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    decoded[0].corpusVersion = 'different-corpus';
    const uncompressed = Buffer.from(`${decoded.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const recompressed = gzipSync(uncompressed, { level: 6 });
    const newSummary = {
      ...part,
      uncompressed_bytes: uncompressed.length,
      uncompressed_sha256: createHash('sha256').update(uncompressed).digest('hex'),
      compressed_bytes: recompressed.length,
      compressed_sha256: createHash('sha256').update(recompressed).digest('hex'),
    };
    semanticStorage.objects.set(part.archive_key, recompressed);
    const manifest = JSON.parse(String(semanticStorage.objects.get(part.manifest_key)));
    semanticStorage.objects.set(part.manifest_key, Buffer.from(`${JSON.stringify({ ...manifest, ...newSummary })}\n`));
    semanticCompletion.parts[0] = newSummary;
    semanticCompletion.archive_set_sha256 = getCaseGraphFeatureArchiveSetSha256(
      semanticCompletion.parts,
      semanticCompletion.binding,
    );
    semanticStorage.objects.set(
      semanticKeys.completionManifestKey,
      Buffer.from(`${JSON.stringify(semanticCompletion)}\n`),
    );
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-semantic-corrupt-v2', source, storage: semanticStorage,
    })).rejects.toThrow('case_graph_feature_archive_decode_failed');
  });

  it('rejects tampered completion accounting and rarity receipts', async () => {
    const { source } = sourceFor([makeRow(1)]);
    const counterStorage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'corpus-counter-tamper-v2', source, storage: counterStorage });
    const counterKeys = getCaseGraphFeatureControlKeys('corpus-counter-tamper-v2');
    const completion = JSON.parse(String(counterStorage.objects.get(counterKeys.completionManifestKey)));
    completion.exported_row_count = 2;
    counterStorage.objects.set(counterKeys.completionManifestKey, Buffer.from(`${JSON.stringify(completion)}\n`));
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-counter-tamper-v2', source, storage: counterStorage,
    })).rejects.toThrow('case_graph_completion_integrity_invalid');

    const rarityStorage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'corpus-rarity-tamper-v2', source, storage: rarityStorage });
    const rarityKeys = getCaseGraphFeatureControlKeys('corpus-rarity-tamper-v2');
    rarityStorage.objects.set(rarityKeys.rarityKey, Buffer.from('{"tampered":true}\n'));
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-rarity-tamper-v2', source, storage: rarityStorage,
    })).rejects.toThrow('case_graph_completion_rarity_mismatch');
  });

  it('rejects non-advancing pages and inconsistent source accounting', async () => {
    const rows = [makeRow(1), makeRow(2)];
    const outOfOrder: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => statsFor(rows),
      fetchEligiblePage: async () => [...rows].reverse(),
    };
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-order-v2', source: outOfOrder, storage: new MemoryStorage(), pageSize: 2,
    })).rejects.toThrow('case_graph_source_cursor_did_not_advance');

    const badCounts: CaseGraphFeatureSource = {
      inspectEligibleSnapshot: async () => ({ ...statsFor([rows[0]]), source_counts: { wrong: 2 } }),
      fetchEligiblePage: async () => [rows[0]],
    };
    const storage = new MemoryStorage();
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-count-v2', source: badCounts, storage,
    })).rejects.toThrow('case_graph_source_counts_mismatch');
    expect(storage.objects.size).toBe(0);
  });

  it('requires an atomic conditional-storage implementation', async () => {
    const { source } = sourceFor([]);
    const unsafeStorage: CaseGraphArchiveStorage = {
      readObject: async () => null,
      uploadFile: async (_body, key) => key,
    };
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-unsafe-storage-v2', source,
      storage: unsafeStorage as CaseGraphConditionalArchiveStorage,
    })).rejects.toThrow('case_graph_feature_conditional_storage_required');
  });

  it('rejects schema-v1 completion state instead of reusing the retired live-query archive', async () => {
    const { source } = sourceFor([]);
    const storage = new MemoryStorage();
    const key = getCaseGraphFeatureControlKeys('corpus-old-schema-v2').completionManifestKey;
    storage.objects.set(key, Buffer.from(`${JSON.stringify({
      record_type: 'case_graph_feature_completion_manifest',
      schema_version: 1,
      corpus_version: 'corpus-old-schema-v2',
      parts: [],
    })}\n`));
    storage.versions.set(key, 1);
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-old-schema-v2', source, storage,
    })).rejects.toThrow('case_graph_completion_invalid');
  });

  it('completes and revalidates an empty immutable snapshot', async () => {
    const { source } = sourceFor([]);
    const storage = new MemoryStorage();
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-empty-v2', source, storage, pageSize: 1,
    })).resolves.toMatchObject({
      status: 'complete',
      completion: { exported_row_count: 0, part_count: 0, parts: [], binding: { snapshot_id: SNAPSHOT_ID } },
    });
    await expect(archiveCaseGraphFeatures({
      corpusVersion: 'corpus-empty-v2', source, storage, pageSize: 1,
    })).resolves.toMatchObject({ status: 'already_complete' });
  });
});
