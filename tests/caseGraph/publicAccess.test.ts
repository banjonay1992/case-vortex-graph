import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getCaseGraphClusterCases,
  getCaseGraphDensityLevel,
  getCaseGraphEdgeReceipt,
  getCaseGraphEdgeReceipts,
  getCaseGraphEvaluationReceipt,
  getCaseGraphEvaluationReceipts,
  getCaseGraphEgo,
  getCaseGraphNode,
  getCaseGraphNodes,
  loadActiveCaseGraphPublication,
  parseCaseGraphDensityCellId,
  parseCaseGraphEvidenceAddress,
  projectCaseGraphPublicManifest,
  type CaseGraphPublicQuery,
  type CaseGraphPublicStorage,
} from '../../src/caseGraph/publicAccess';
import type {
  FullCorpusPublicEdge,
  FullCorpusPublicEvaluationReceipt,
} from '../../src/caseGraph/typedRelationshipPublicGraph';
import { fullCorpusRelationshipShard } from '../../src/caseGraph/typedRelationshipPipeline';
import {
  buildPublicationV2ActivationRow,
  buildPublicationV2Fixture,
  publicationCorpusVersion,
  publicationSnapshotId,
} from './publicationV2TestSupport';

const sightingId = '00000000-0000-4000-8000-000000000001';

const buildFixture = () => {
  const publication = buildPublicationV2Fixture();
  const objects = publication.objects;
  const storage: CaseGraphPublicStorage = {
    readObject: async (key) => objects.get(key) || null,
  };
  const activationRow = buildPublicationV2ActivationRow(publication);
  const query: CaseGraphPublicQuery = async () => ({ rows: [activationRow] });
  const photoAddress = publication.relationship.records
    .find((record) => record.address.startsWith('photo:'))?.address;
  const edge = publication.publicGraph.shards
    .filter((shard) => shard.shardKind === 'edge')
    .flatMap((shard) => shard.items as FullCorpusPublicEdge[])
    .at(0);
  const evaluation = publication.publicGraph.shards
    .filter((shard) => shard.shardKind === 'evaluation')
    .flatMap((shard) => shard.items as FullCorpusPublicEvaluationReceipt[])
    .at(0);
  const regionalCell = publication.densityArtifact.levels.regional
    .find((cell) => cell.count > 0);
  if (!photoAddress || !edge || !evaluation || !regionalCell) {
    throw new Error('publication_v2_public_access_fixture_incomplete');
  }
  return {
    publication,
    objects,
    storage,
    query,
    activationRow,
    photoAddress,
    edge,
    evaluation,
    regionalCell,
  };
};

describe('case graph public access v2', () => {
  beforeAll(() => {
    buildPublicationV2Fixture();
  }, 240_000);

  it('serves only the exact active v2 candidate and resolves its real typed artifacts', async () => {
    const fixture = buildFixture();
    const active = await loadActiveCaseGraphPublication(fixture);
    expect(active).not.toBeNull();
    const projected = projectCaseGraphPublicManifest(active!);
    expect(projected).toMatchObject({
      active: true,
      corpusVersion: publicationCorpusVersion,
      accounting: { indexedRecordCount: 105 },
      lineage: {
        snapshot: { snapshotId: publicationSnapshotId },
        calibration: {
          pair: { receiptId: fixture.publication.manifest.lineage.calibration.pair.receiptId },
          contextual: { receiptId: fixture.publication.manifest.lineage.calibration.contextual.receiptId },
        },
      },
      corpusAccounting: { receipt: { complete: true, representedTotal: 105 } },
      renderIndex: { rowCount: 105, fullNodeMetadataAccess: 'on_demand_node_and_ego_shards' },
      sourceRegistry: {
        version: 'case-graph-sources-v1',
        sources: expect.arrayContaining([expect.objectContaining({ id: 'aaro', family: 'official' })]),
      },
    });
    await expect(getCaseGraphDensityLevel(active!, fixture.storage, 'macro'))
      .resolves.toMatchObject({ nodeCount: 105 });
    await expect(getCaseGraphNode(active!, fixture.storage, sightingId))
      .resolves.toMatchObject({ address: `sighting:${sightingId}`, kind: 'sighting' });
    await expect(getCaseGraphEgo(active!, fixture.storage, sightingId))
      .resolves.toMatchObject({ address: `sighting:${sightingId}` });
    await expect(getCaseGraphEdgeReceipt(active!, fixture.storage, fixture.edge.edgeId))
      .resolves.toMatchObject({ edgeId: fixture.edge.edgeId });
    await expect(getCaseGraphEvaluationReceipt(active!, fixture.storage, fixture.evaluation.evaluationId))
      .resolves.toMatchObject({ evaluationId: fixture.evaluation.evaluationId });
  }, 120_000);

  it('fails closed for missing activation, invalid identifiers and immutable-object drift', async () => {
    const fixture = buildFixture();
    await expect(loadActiveCaseGraphPublication({
      ...fixture,
      query: async () => ({ rows: [] }),
    })).resolves.toBeNull();
    const active = await loadActiveCaseGraphPublication(fixture);
    await expect(getCaseGraphNode(active!, fixture.storage, '../bad'))
      .rejects.toThrow('case_graph_case_id_invalid');
    await expect(getCaseGraphEdgeReceipt(active!, fixture.storage, 'bad'))
      .rejects.toThrow('case_graph_edge_id_invalid');
    await expect(getCaseGraphEvaluationReceipt(active!, fixture.storage, 'bad'))
      .rejects.toThrow('case_graph_evaluation_id_invalid');
    fixture.objects.set(fixture.publication.keys.manifestKey, Buffer.from('{}'));
    await expect(loadActiveCaseGraphPublication(fixture))
      .rejects.toThrow('case_graph_publication_manifest_checksum_mismatch');
  }, 120_000);

  it('uses canonical evidence addresses for all record kinds and keeps the sighting UUID alias', async () => {
    const fixture = buildFixture();
    expect(parseCaseGraphEvidenceAddress(sightingId)).toEqual({
      address: `sighting:${sightingId}`,
      kind: 'sighting',
      recordId: sightingId,
      legacySightingCaseId: sightingId,
    });
    expect(parseCaseGraphEvidenceAddress(fixture.photoAddress)).toEqual({
      address: fixture.photoAddress,
      kind: 'photo',
      recordId: fixture.photoAddress.slice('photo:'.length),
      legacySightingCaseId: null,
    });
    expect(() => parseCaseGraphEvidenceAddress('audio:record-1'))
      .toThrow('case_graph_case_id_invalid');
    expect(() => parseCaseGraphEvidenceAddress('photo:bad:id'))
      .toThrow('case_graph_case_id_invalid');

    const active = await loadActiveCaseGraphPublication(fixture);
    await expect(getCaseGraphNode(active!, fixture.storage, fixture.photoAddress))
      .resolves.toMatchObject({ address: fixture.photoAddress, kind: 'photo' });
    await expect(getCaseGraphEgo(active!, fixture.storage, fixture.photoAddress))
      .resolves.toMatchObject({ address: fixture.photoAddress });
  }, 120_000);

  it('requires schema, model, calibration and accounting joins to match the verified R2 candidate', async () => {
    const fixture = buildFixture();
    for (const rowPatch of [
      { corpus_accounting_digest: '0'.repeat(64) },
      { run_relationship_schema_version: 'wrong-schema-v2' },
      { receipt_relationship_schema_version: 'wrong-schema-v2' },
      { run_relationship_policy_version: 'wrong-policy-v2' },
      { receipt_relationship_policy_version: 'wrong-policy-v2' },
      { run_relationship_model_id: 'wrong-model-v2' },
      { receipt_relationship_model_sha256: '0'.repeat(64) },
      { receipt_pair_calibration_sha256: '0'.repeat(64) },
    ]) {
      const query: CaseGraphPublicQuery = async () => ({ rows: [{
        ...fixture.activationRow,
        ...rowPatch,
      }] });
      await expect(loadActiveCaseGraphPublication({ ...fixture, query }))
        .rejects.toThrow('case_graph_active_database_receipt_mismatch');
    }
  }, 120_000);

  it('turns a real semantic-zoom cell into a bounded all-evidence page', async () => {
    const fixture = buildFixture();
    const active = await loadActiveCaseGraphPublication(fixture);
    expect(parseCaseGraphDensityCellId('regional:t2025:g14:17')).toMatchObject({
      timeStart: '2025-01-01T00:00:00.000Z',
      timeEnd: '2030-01-01T00:00:00.000Z',
      minLat: 50,
      maxLat: 60,
      minLon: -10,
      maxLon: 0,
    });
    const page = await getCaseGraphClusterCases({
      active: active!,
      storage: fixture.storage,
      cellId: fixture.regionalCell.id,
      limit: 1,
    });
    expect(page.cell.id).toBe(fixture.regionalCell.id);
    expect(page.cases).toHaveLength(1);
    expect(page.cases[0]).toMatchObject({
      address: expect.stringMatching(/^(?:sighting|document|photo|video):/),
    });
    expect(() => parseCaseGraphDensityCellId('regional:t2026:g14:17'))
      .toThrow('case_graph_density_cell_id_invalid');
  }, 120_000);

  it('batches research traversal reads by immutable shard instead of issuing one R2 decode per record', async () => {
    const fixture = buildFixture();
    const active = await loadActiveCaseGraphPublication(fixture);
    const nodeAddresses = fixture.publication.publicGraph.shards
      .filter((shard) => shard.shardKind === 'node')
      .flatMap((shard) => shard.items)
      .map((item) => (item as { address: string }).address);
    const selectedEdges = fixture.publication.publicGraph.shards
      .filter((shard) => shard.shardKind === 'edge')
      .flatMap((shard) => shard.items as FullCorpusPublicEdge[])
      .slice(0, 20);
    const selectedEvaluations = fixture.publication.publicGraph.shards
      .filter((shard) => shard.shardKind === 'evaluation')
      .flatMap((shard) => shard.items as FullCorpusPublicEvaluationReceipt[])
      .slice(0, 20);
    const readObject = vi.fn(fixture.storage.readObject);
    const countedStorage = { readObject };

    const returnedNodes = await getCaseGraphNodes(active!, countedStorage, nodeAddresses);
    const nodeShardReads = new Set(nodeAddresses.map((address) => fullCorpusRelationshipShard(
      address,
      active!.manifest.topology.nodeShardCount,
    ))).size;
    expect(returnedNodes.size).toBe(nodeAddresses.length);
    expect(readObject).toHaveBeenCalledTimes(nodeShardReads * 2);

    readObject.mockClear();
    const returnedEdges = await getCaseGraphEdgeReceipts(
      active!, countedStorage, selectedEdges.map((edge) => edge.edgeId),
    );
    expect(returnedEdges.size).toBe(selectedEdges.length);
    expect(readObject.mock.calls.length).toBeLessThanOrEqual(selectedEdges.length * 2);

    readObject.mockClear();
    const returnedEvaluations = await getCaseGraphEvaluationReceipts(
      active!, countedStorage, selectedEvaluations.map((evaluation) => evaluation.evaluationId),
    );
    expect(returnedEvaluations.size).toBe(selectedEvaluations.length);
    expect(readObject.mock.calls.length).toBeLessThanOrEqual(selectedEvaluations.length * 2);
    await expect(getCaseGraphNodes(active!, countedStorage, Array.from({ length: 251 }, (_, index) => `photo:${index}`)))
      .rejects.toThrow('case_graph_public_batch_request_invalid');
  }, 120_000);
});
