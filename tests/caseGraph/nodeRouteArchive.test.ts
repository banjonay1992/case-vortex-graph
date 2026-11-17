import { describe, expect, it } from 'vitest';

import type { CaseGraphCursor, CaseGraphFeatureSource, CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';
import { mapCaseGraphEdgeRoutes } from '../../src/caseGraph/edgeRouteArchive';
import { reduceCaseGraphFinalEdges } from '../../src/caseGraph/finalEdgeArchive';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import { mapCaseGraphNodeRoutes } from '../../src/caseGraph/nodeRouteArchive';
import { mapCaseGraphPostingArchive } from '../../src/caseGraph/postingArchive';
import { reduceCaseGraphPostingArchive } from '../../src/caseGraph/reducerArchive';
import { ConditionalMemoryStorage, materializedCaseGraphStats } from './featureArchiveTestSupport';

class MemoryStorage extends ConditionalMemoryStorage {}
const rows: CaseGraphSourceRow[] = [1, 2, 3].map((index) => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const timestamp = new Date(Date.UTC(2026, 6, 17, 12, index)).toISOString();
  return { cursor: { updated_at: timestamp, case_id: id }, sighting: {
    id, source: `archive-${index}`, updated_at: timestamp, event_timestamp: timestamp,
    event_date_precision: 'exact', lat: 51.5 + index / 1000, lon: -0.1,
    geo_precision: 'exact', duration_seconds: 60, description: index === 3
      ? 'A white light moved east.' : 'Amber chevron hovered silently.',
  } };
});
const source: CaseGraphFeatureSource = {
  inspectEligibleSnapshot: async () => materializedCaseGraphStats({ eligible_count: 3, min_cursor: rows[0].cursor, max_cursor: rows[2].cursor,
    source_counts: { 'archive-1': 1, 'archive-2': 1, 'archive-3': 1 }, publishability_policy: 'publishable_public_v2',
    snapshot_at: '2026-07-17T13:00:00Z' }),
  fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => rows
    .filter((item) => !cursor || compareCaseGraphCursors(item.cursor, cursor) > 0).slice(0, limit),
};

describe('case graph node route archive', () => {
  it('routes every feature node and both sides of every final edge with resume receipts', async () => {
    const storage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'node-route-v1', source, storage, pageSize: 1, maxPartsPerRun: 3 });
    await mapCaseGraphPostingArchive({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxInputPartsPerRun: 3 });
    await reduceCaseGraphPostingArchive({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxReducerShardsPerRun: 4 });
    await mapCaseGraphEdgeRoutes({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, edgeShardCount: 3, maxSourceReducersPerRun: 4 });
    const edges = await reduceCaseGraphFinalEdges({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, edgeShardCount: 3, maxEdgeShardsPerRun: 3 });
    if (edges.status !== 'complete') throw new Error('fixture incomplete');
    const first = await mapCaseGraphNodeRoutes({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2, maxInputUnitsPerRun: 2 });
    expect(first).toMatchObject({ status: 'partial', remaining_input_units: 4 });
    const second = await mapCaseGraphNodeRoutes({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2, maxInputUnitsPerRun: 4 });
    expect(second).toMatchObject({ status: 'complete', completion: { node_count: 3 } });
    if (second.status !== 'complete') throw new Error('fixture incomplete');
    expect(second.completion.incident_count).toBe(edges.completion.unique_edge_count * 2);
    await expect(mapCaseGraphNodeRoutes({ corpusVersion: 'node-route-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2 })).resolves.toMatchObject({ status: 'already_complete' });
  });
});
