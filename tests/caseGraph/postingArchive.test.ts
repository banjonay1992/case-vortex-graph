import { describe, expect, it } from 'vitest';

import { getCaseGraphPostingControlKeys } from '../../src/caseGraph/archiveKeys';
import type { CaseGraphCursor, CaseGraphFeatureSource, CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import {
  CASE_GRAPH_POSTING_UPLOAD_CONCURRENCY,
  CASE_GRAPH_POSTING_VALIDATION_CONCURRENCY,
  mapCaseGraphPostingArchive,
} from '../../src/caseGraph/postingArchive';
import { ConditionalMemoryStorage, materializedCaseGraphStats } from './featureArchiveTestSupport';

class MemoryStorage extends ConditionalMemoryStorage {}

class DelayedStorage extends MemoryStorage {
  activeUploads = 0;
  maximumActiveUploads = 0;
  activeReads = 0;
  maximumActiveReads = 0;

  override async uploadFile(body: Buffer, key: string) {
    this.activeUploads += 1;
    this.maximumActiveUploads = Math.max(this.maximumActiveUploads, this.activeUploads);
    await new Promise((resolve) => setTimeout(resolve, 2));
    try {
      return await super.uploadFile(body, key);
    } finally {
      this.activeUploads -= 1;
    }
  }

  override async readObject(key: string) {
    this.activeReads += 1;
    this.maximumActiveReads = Math.max(this.maximumActiveReads, this.activeReads);
    await new Promise((resolve) => setTimeout(resolve, 2));
    try {
      return await super.readObject(key);
    } finally {
      this.activeReads -= 1;
    }
  }
}

const row = (index: number): CaseGraphSourceRow => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const timestamp = new Date(Date.UTC(2026, 6, 17, 12, index)).toISOString();
  return {
    cursor: { updated_at: timestamp, case_id: id },
    sighting: {
      id,
      source: index % 2 ? 'archive-a' : 'archive-b',
      source_record_id: `record-${index}`,
      updated_at: timestamp,
      event_timestamp: timestamp,
      event_date_precision: 'exact',
      lat: 51.5,
      lon: -0.1,
      geo_precision: 'exact',
      description: 'Amber chevron hovered silently.',
    },
  };
};

const sourceFor = (rows: CaseGraphSourceRow[]): CaseGraphFeatureSource => ({
  inspectEligibleSnapshot: async () => materializedCaseGraphStats({
    eligible_count: rows.length,
    min_cursor: rows[0]?.cursor || null,
    max_cursor: rows.at(-1)?.cursor || null,
    source_counts: rows.reduce<Record<string, number>>((counts, item) => {
      const source = String(item.sighting.source);
      counts[source] = (counts[source] || 0) + 1;
      return counts;
    }, {}),
    publishability_policy: 'publishable_public_v2',
    snapshot_at: '2026-07-17T13:00:00Z',
  }),
  fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => rows
    .filter((item) => !cursor || compareCaseGraphCursors(item.cursor, cursor) > 0)
    .slice(0, limit),
});

describe('case graph posting map archive', () => {
  it('maps feature parts to resumable global reducer fragments and revalidates completion', async () => {
    const storage = new MemoryStorage();
    const rows = [row(1), row(2), row(3)];
    await archiveCaseGraphFeatures({
      corpusVersion: 'posting-map-v1', source: sourceFor(rows), storage, pageSize: 1, maxPartsPerRun: 3,
    });
    const first = await mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxInputPartsPerRun: 1,
    });
    expect(first).toMatchObject({ status: 'partial', remaining_input_parts: 2 });
    const second = await mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxInputPartsPerRun: 2,
    });
    expect(second).toMatchObject({
      status: 'complete',
      completion: { input_part_count: 3, processed_case_count: 3 },
    });
    const control = getCaseGraphPostingControlKeys('posting-map-v1');
    expect(storage.objects.has(control.completionManifestKey)).toBe(true);
    await expect(mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
    })).resolves.toMatchObject({ status: 'already_complete' });

    const completion = JSON.parse(String(storage.objects.get(control.completionManifestKey)));
    storage.objects.set(completion.part_receipts[0].key, Buffer.from('{"tampered":true}\n'));
    await expect(mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
    })).rejects.toThrow('case_graph_posting_part_receipt_mismatch');
  });

  it('fails closed when resume identity changes or a feature part is corrupt', async () => {
    const storage = new MemoryStorage();
    const rows = [row(1), row(2)];
    const feature = await archiveCaseGraphFeatures({
      corpusVersion: 'posting-map-fail-v1', source: sourceFor(rows), storage, pageSize: 1, maxPartsPerRun: 2,
    });
    await mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-fail-v1', storage, reducerShardCount: 2, maxInputPartsPerRun: 1,
    });
    await expect(mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-fail-v1', storage, reducerShardCount: 3,
    })).rejects.toThrow('case_graph_posting_checkpoint_identity_mismatch');
    if (feature.status !== 'complete') throw new Error('fixture incomplete');
    storage.objects.set(feature.completion.parts[1].archive_key, Buffer.from('corrupt'));
    await expect(mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-fail-v1', storage, reducerShardCount: 2,
    })).rejects.toThrow('case_graph_feature_archive_bytes_mismatch');
  });

  it('uploads posting fragments concurrently within the fixed R2 request bound', async () => {
    const storage = new DelayedStorage();
    const rows = Array.from({ length: 12 }, (_, index) => row(index + 1));
    await archiveCaseGraphFeatures({
      corpusVersion: 'posting-map-concurrency-v1', source: sourceFor(rows), storage, pageSize: 12, maxPartsPerRun: 1,
    });
    storage.maximumActiveUploads = 0;
    const result = await mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-concurrency-v1', storage, reducerShardCount: 16, minimumTermRarity: 0,
      maxInputPartsPerRun: 1,
    });
    expect(result).toMatchObject({ status: 'complete' });
    if (result.status !== 'complete') throw new Error('fixture did not complete');
    expect(result.completion.fragment_count).toBeGreaterThan(1);
    expect(storage.maximumActiveUploads).toBeGreaterThan(1);
    expect(storage.maximumActiveUploads).toBeLessThanOrEqual(CASE_GRAPH_POSTING_UPLOAD_CONCURRENCY);
  });

  it('revalidates completed part receipts concurrently within the fixed R2 request bound', async () => {
    const storage = new DelayedStorage();
    const rows = Array.from({ length: 12 }, (_, index) => row(index + 1));
    await archiveCaseGraphFeatures({
      corpusVersion: 'posting-map-validation-v1', source: sourceFor(rows), storage, pageSize: 1, maxPartsPerRun: 12,
    });
    await mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-validation-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
      maxInputPartsPerRun: 12,
    });
    storage.maximumActiveReads = 0;
    await expect(mapCaseGraphPostingArchive({
      corpusVersion: 'posting-map-validation-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
    })).resolves.toMatchObject({ status: 'already_complete' });
    expect(storage.maximumActiveReads).toBeGreaterThan(1);
    expect(storage.maximumActiveReads).toBeLessThanOrEqual(CASE_GRAPH_POSTING_VALIDATION_CONCURRENCY);
  });
});
