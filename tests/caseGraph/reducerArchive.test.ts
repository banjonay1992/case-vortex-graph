import { describe, expect, it } from 'vitest';

import type { CaseGraphCursor, CaseGraphFeatureSource, CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import { mapCaseGraphPostingArchive } from '../../src/caseGraph/postingArchive';
import { reduceCaseGraphPostingArchive } from '../../src/caseGraph/reducerArchive';
import { ConditionalMemoryStorage, materializedCaseGraphStats } from './featureArchiveTestSupport';

class MemoryStorage extends ConditionalMemoryStorage {}

const rows: CaseGraphSourceRow[] = [1, 2, 3].map((index) => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const timestamp = new Date(Date.UTC(2026, 6, 17, 12, index)).toISOString();
  return {
    cursor: { updated_at: timestamp, case_id: id },
    sighting: {
      id,
      source: `archive-${index}`,
      source_record_id: `record-${index}`,
      updated_at: timestamp,
      event_timestamp: timestamp,
      event_date_precision: 'exact',
      lat: 51.5 + index / 1000,
      lon: -0.1,
      geo_precision: 'exact',
      duration_seconds: 60,
      description: 'Amber chevron hovered silently.',
    },
  };
});

const source: CaseGraphFeatureSource = {
  inspectEligibleSnapshot: async () => materializedCaseGraphStats({
    eligible_count: rows.length,
    min_cursor: rows[0].cursor,
    max_cursor: rows.at(-1)!.cursor,
    source_counts: { 'archive-1': 1, 'archive-2': 1, 'archive-3': 1 },
    publishability_policy: 'publishable_public_v2',
    snapshot_at: '2026-07-17T13:00:00Z',
  }),
  fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => rows
    .filter((item) => !cursor || compareCaseGraphCursors(item.cursor, cursor) > 0)
    .slice(0, limit),
};

describe('case graph preliminary reducer archive', () => {
  it('reduces global posting shards resumably and produces relationship receipts', async () => {
    const storage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'reduce-v1', source, storage, pageSize: 1, maxPartsPerRun: 3 });
    await mapCaseGraphPostingArchive({
      corpusVersion: 'reduce-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxInputPartsPerRun: 3,
    });
    const first = await reduceCaseGraphPostingArchive({
      corpusVersion: 'reduce-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxReducerShardsPerRun: 2,
    });
    expect(first).toMatchObject({ status: 'partial', remaining_reducer_shards: 2 });
    const second = await reduceCaseGraphPostingArchive({
      corpusVersion: 'reduce-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxReducerShardsPerRun: 2,
    });
    expect(second).toMatchObject({
      status: 'complete',
      completion: { reducer_shard_count: 4 },
    });
    if (second.status !== 'complete') throw new Error('fixture incomplete');
    expect(second.completion.candidate_count).toBeGreaterThanOrEqual(3);
    expect(second.completion.preliminary_relationship_count).toBeGreaterThanOrEqual(3);
    await expect(reduceCaseGraphPostingArchive({
      corpusVersion: 'reduce-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
    })).resolves.toMatchObject({ status: 'already_complete' });
  });
});
