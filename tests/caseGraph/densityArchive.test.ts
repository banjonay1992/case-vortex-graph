import { describe, expect, it } from 'vitest';

import type { CaseGraphCursor, CaseGraphFeatureSource, CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';
import { buildCaseGraphDensityArchive, decodeCaseGraphDensityArtifact } from '../../src/caseGraph/densityArchive';
import { mapCaseGraphEdgeRoutes } from '../../src/caseGraph/edgeRouteArchive';
import { reduceCaseGraphFinalEdges } from '../../src/caseGraph/finalEdgeArchive';
import { archiveCaseGraphFeatures } from '../../src/caseGraph/featureArchive';
import { compareCaseGraphCursors } from '../../src/caseGraph/featureArchiveCodec';
import { reduceCaseGraphNodeIndex } from '../../src/caseGraph/nodeIndexArchive';
import { mapCaseGraphNodeRoutes } from '../../src/caseGraph/nodeRouteArchive';
import { mapCaseGraphPostingArchive } from '../../src/caseGraph/postingArchive';
import { buildCaseGraphPublicationCandidate, readVerifiedCaseGraphPublicationCandidate } from '../../src/caseGraph/publicationArchive';
import { reduceCaseGraphPostingArchive } from '../../src/caseGraph/reducerArchive';
import { ConditionalMemoryStorage, materializedCaseGraphStats } from './featureArchiveTestSupport';

class MemoryStorage extends ConditionalMemoryStorage {}

const rows: CaseGraphSourceRow[] = [1, 2, 3].map((index) => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const timestamp = new Date(Date.UTC(2026, 6, 17, 12, index)).toISOString();
  return { cursor: { updated_at: timestamp, case_id: id }, sighting: {
    id, source: `archive-${index}`, updated_at: timestamp, event_timestamp: index === 3 ? null : timestamp,
    event_date_precision: index === 3 ? 'unknown' : 'exact', lat: index === 3 ? null : 51.5 + index / 1000,
    lon: index === 3 ? null : -0.1, geo_precision: index === 3 ? 'unknown' : 'exact', duration_seconds: 60,
    description: index === 3 ? 'A white light moved east.' : 'Amber chevron hovered silently.',
  } };
});

const source: CaseGraphFeatureSource = {
  inspectEligibleSnapshot: async () => materializedCaseGraphStats({ eligible_count: rows.length, min_cursor: rows[0].cursor, max_cursor: rows.at(-1)!.cursor,
    source_counts: { 'archive-1': 1, 'archive-2': 1, 'archive-3': 1 }, publishability_policy: 'publishable_public_v2',
    snapshot_at: '2026-07-17T13:00:00Z' }),
  fetchEligiblePage: async (cursor: CaseGraphCursor | null, limit: number) => rows
    .filter((item) => !cursor || compareCaseGraphCursors(item.cursor, cursor) > 0).slice(0, limit),
};

describe('case graph semantic zoom density archive', () => {
  it('resumes by node shard and proves every indexed node is represented at both LOD levels', async () => {
    const storage = new MemoryStorage();
    const topology = { corpusVersion: 'density-archive-v1', storage, reducerShardCount: 4,
      minimumTermRarity: 0, edgeShardCount: 3, nodeShardCount: 2 };
    await archiveCaseGraphFeatures({ corpusVersion: topology.corpusVersion, source, storage, pageSize: 1, maxPartsPerRun: 3 });
    await mapCaseGraphPostingArchive({ ...topology, maxInputPartsPerRun: 3 });
    await reduceCaseGraphPostingArchive({ ...topology, maxReducerShardsPerRun: 4 });
    await mapCaseGraphEdgeRoutes({ ...topology, maxSourceReducersPerRun: 4 });
    await reduceCaseGraphFinalEdges({ ...topology, maxEdgeShardsPerRun: 3 });
    await mapCaseGraphNodeRoutes({ ...topology, maxInputUnitsPerRun: 6 });
    await reduceCaseGraphNodeIndex({ ...topology, maxNodeShardsPerRun: 2 });

    await expect(buildCaseGraphDensityArchive({ ...topology, maxNodeShardsPerRun: 1 }))
      .resolves.toMatchObject({ status: 'partial', remaining_node_shards: 1 });
    const completed = await buildCaseGraphDensityArchive({ ...topology, maxNodeShardsPerRun: 1 });
    expect(completed).toMatchObject({ status: 'complete', artifact: {
      nodeCount: 3,
      accounting: { macroNodeCount: 3, regionalNodeCount: 3, unknownGeoNodeCount: 1, unknownTimeNodeCount: 1 },
    } });
    if (completed.status !== 'complete') throw new Error('fixture incomplete');
    const archiveBody = await storage.readObject(completed.manifest.archive_key);
    expect(archiveBody).not.toBeNull();
    expect(decodeCaseGraphDensityArtifact(archiveBody!, completed.manifest).nodeCount).toBe(3);
    await expect(buildCaseGraphDensityArchive(topology)).resolves.toMatchObject({ status: 'already_complete' });

    // A graph that has density/node/edge artifacts but no universe-v3,
    // relationship-input-v2, calibration, or full-corpus accounting receipts
    // is deliberately not publishable under the v2 activation contract.
    await expect(buildCaseGraphPublicationCandidate(topology))
      .rejects.toThrow('case_graph_publication_lineage_receipts_required');
    await expect(readVerifiedCaseGraphPublicationCandidate(storage, topology.corpusVersion))
      .rejects.toThrow('case_graph_publication_completion_missing');
  });
});
