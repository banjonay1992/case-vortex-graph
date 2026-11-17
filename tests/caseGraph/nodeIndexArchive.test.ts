import { describe, expect, it } from 'vitest';

import type { CaseGraphCursor, CaseGraphFeatureSource, CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';
import { mapCaseGraphEdgeRoutes } from '../../src/caseGraph/edgeRouteArchive';
import { reduceCaseGraphFinalEdges } from '../../src/caseGraph/finalEdgeArchive';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import { reduceCaseGraphNodeIndex } from '../../src/caseGraph/nodeIndexArchive';
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
    event_date_precision: 'exact', lat: index === 3 ? -33 : 51.5 + index / 1000,
    lon: index === 3 ? 151 : -0.1, geo_precision: 'exact', duration_seconds: 60,
    description: index === 3 ? 'A white light moved east.' : 'Amber chevron hovered silently.',
  } };
});
const source: CaseGraphFeatureSource = {
  inspectEligibleSnapshot: async () => materializedCaseGraphStats({ eligible_count: 3, min_cursor: rows[0].cursor, max_cursor: rows[2].cursor,
    source_counts: { 'archive-1': 1, 'archive-2': 1, 'archive-3': 1 }, publishability_policy: 'publishable_public_v2',
    snapshot_at: '2026-07-17T13:00:00Z' }),
  fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => rows
    .filter((item) => !cursor || compareCaseGraphCursors(item.cursor, cursor) > 0).slice(0, limit),
};

describe('case graph final node and ego index archive', () => {
  it('proves every eligible case is present and isolated cases remain addressable', async () => {
    const storage = new MemoryStorage();
    await archiveCaseGraphFeatures({ corpusVersion: 'node-index-v1', source, storage, pageSize: 1, maxPartsPerRun: 3 });
    await mapCaseGraphPostingArchive({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxInputPartsPerRun: 3 });
    await reduceCaseGraphPostingArchive({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, maxReducerShardsPerRun: 4 });
    await mapCaseGraphEdgeRoutes({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, edgeShardCount: 3, maxSourceReducersPerRun: 4 });
    const edges = await reduceCaseGraphFinalEdges({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4, minimumTermRarity: 0, edgeShardCount: 3, maxEdgeShardsPerRun: 3 });
    if (edges.status !== 'complete') throw new Error('fixture incomplete');
    await mapCaseGraphNodeRoutes({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2, maxInputUnitsPerRun: 6 });
    const first = await reduceCaseGraphNodeIndex({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2, maxNodeShardsPerRun: 1 });
    expect(first).toMatchObject({ status: 'partial', remaining_node_shards: 1 });
    const second = await reduceCaseGraphNodeIndex({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2, maxNodeShardsPerRun: 1 });
    expect(second).toMatchObject({
      status: 'complete',
      completion: { eligible_case_count: 3, node_count: 3, incident_count: edges.completion.unique_edge_count * 2 },
    });
    if (second.status !== 'complete') throw new Error('fixture incomplete');
    expect(second.completion.isolated_node_count).toBeGreaterThanOrEqual(1);
    expect(second.completion.connected_node_count + second.completion.isolated_node_count).toBe(3);
    await expect(reduceCaseGraphNodeIndex({ corpusVersion: 'node-index-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2 })).resolves.toMatchObject({ status: 'already_complete' });
  });
});
