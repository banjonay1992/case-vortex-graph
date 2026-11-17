import { describe, expect, it } from 'vitest';

import type { CaseGraphCursor, CaseGraphFeatureSource, CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';
import { mapCaseGraphEdgeRoutes } from '../../src/caseGraph/edgeRouteArchive';
import { reduceCaseGraphFinalEdges } from '../../src/caseGraph/finalEdgeArchive';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import { mapCaseGraphPostingArchive } from '../../src/caseGraph/postingArchive';
import { reduceCaseGraphPostingArchive } from '../../src/caseGraph/reducerArchive';
import { ConditionalMemoryStorage, materializedCaseGraphStats } from './featureArchiveTestSupport';

class MemoryStorage extends ConditionalMemoryStorage {}

const rows: CaseGraphSourceRow[] = [1, 2, 3].map((index) => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const timestamp = new Date(Date.UTC(2026, 6, 17, 12, index)).toISOString();
  return { cursor: { updated_at: timestamp, case_id: id }, sighting: {
    id, source: `archive-${index}`, source_record_id: `record-${index}`, updated_at: timestamp,
    event_timestamp: timestamp, event_date_precision: 'exact', lat: 51.5 + index / 1000,
    lon: -0.1, geo_precision: 'exact', duration_seconds: 60,
    description: 'Amber chevron hovered silently.',
  } };
});
const source: CaseGraphFeatureSource = {
  inspectEligibleSnapshot: async () => materializedCaseGraphStats({
    eligible_count: 3, min_cursor: rows[0].cursor, max_cursor: rows[2].cursor,
    source_counts: { 'archive-1': 1, 'archive-2': 1, 'archive-3': 1 },
    publishability_policy: 'publishable_public_v2', snapshot_at: '2026-07-17T13:00:00Z',
  }),
  fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => rows
    .filter((item) => !cursor || compareCaseGraphCursors(item.cursor, cursor) > 0).slice(0, limit),
};

describe('case graph final edge archive', () => {
  it('deduplicates identical preliminary receipts and emits audited degree totals', async () => {
    const storage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'final-edge-v1', source, storage, pageSize: 1, maxPartsPerRun: 3 });
    await mapCaseGraphPostingArchive({
      corpusVersion: 'final-edge-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxInputPartsPerRun: 3,
    });
    await reduceCaseGraphPostingArchive({
      corpusVersion: 'final-edge-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxReducerShardsPerRun: 4,
    });
    await mapCaseGraphEdgeRoutes({
      corpusVersion: 'final-edge-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
      edgeShardCount: 3, maxSourceReducersPerRun: 4,
    });
    const first = await reduceCaseGraphFinalEdges({
      corpusVersion: 'final-edge-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
      edgeShardCount: 3, maxEdgeShardsPerRun: 1,
    });
    expect(first).toMatchObject({ status: 'partial', remaining_edge_shards: 2 });
    const second = await reduceCaseGraphFinalEdges({
      corpusVersion: 'final-edge-v1', storage, reducerShardCount: 4, minimumTermRarity: 0,
      edgeShardCount: 3, maxEdgeShardsPerRun: 2,
    });
    expect(second).toMatchObject({
      status: 'complete',
      completion: { edge_shard_count: 3, unique_edge_count: 3, degree_contribution_total: 6 },
    });
    if (second.status !== 'complete') throw new Error('fixture incomplete');
    expect(second.completion.preliminary_edge_count).toBeGreaterThan(second.completion.unique_edge_count);
    expect(second.completion.duplicate_edge_count)
      .toBe(second.completion.preliminary_edge_count - second.completion.unique_edge_count);
    await expect(reduceCaseGraphFinalEdges({
      corpusVersion: 'final-edge-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, edgeShardCount: 3,
    })).resolves.toMatchObject({ status: 'already_complete' });
  });
});
