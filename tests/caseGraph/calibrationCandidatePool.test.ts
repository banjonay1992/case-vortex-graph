import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildStreamingCalibrationPairCandidatePoolCore,
  finalizeCalibrationPairCandidatePool,
  loadCalibrationCandidateArchiveSource,
  loadCalibrationCandidateUniverseNodes,
  type CalibrationCandidateArchiveSource,
  type CalibrationPairCandidatePool,
} from '../../src/caseGraph/calibrationCandidatePool';
import { runBuildCalibrationPairCandidatePoolCli } from '../../src/cli/buildCalibrationPairCandidatePool';
import { buildPublicationV2Fixture } from './publicationV2TestSupport';

const topology = {
  postingShardCount: 1,
  pairShardCount: 1,
  maxPostingsPerRecord: 512,
  maxCandidatePairsPerPairShard: 1_000_000,
  postingCaps: {
    addressIdentity: 1,
    sourceIdentity: 1_000,
    sourceRecord: 1,
    sourceLineage: 1,
    duplicateCluster: 1,
    matchableValue: 1,
    spaceTime: 1,
    duration: 1,
    maxPairsPerGroup: 1_000,
    maxCandidatePairsPerPostingShard: 1_000,
  },
};

const fixture = buildPublicationV2Fixture();
const storage = {
  readObject: async (key: string) => {
    const body = fixture.objects.get(key);
    return body ? Buffer.from(body) : null;
  },
} as any;
let cachedSource: CalibrationCandidateArchiveSource;
let cachedPool: CalibrationPairCandidatePool;

beforeAll(async () => {
  cachedSource = await loadCalibrationCandidateArchiveSource({
    storage,
    corpusVersion: fixture.universeCompletion.corpusVersion,
  });
  const universeNodes = await loadCalibrationCandidateUniverseNodes({
    storage,
    universe: cachedSource.universe,
    addresses: cachedSource.relationshipInputParts.flatMap(({ records }) => (
      records.map(({ address }) => address)
    )),
  });
  const streamingCore = await buildStreamingCalibrationPairCandidatePoolCore({
    storage,
    header: {
      universe: cachedSource.universe,
      binding: cachedSource.binding,
      relationshipInputManifest: cachedSource.relationshipInputManifest,
    },
    targetCount: 1,
    seed: 'fixture-governed-review-v1',
    topology,
  });
  cachedPool = finalizeCalibrationPairCandidatePool({
    core: streamingCore,
    universeNodes: universeNodes.filter((node) => (
      streamingCore.selectedRecords.some(({ address }) => address === node.address)
    )),
  });
}, 300_000);

describe('current-corpus calibration pair candidate pool', () => {
  it('loads exact immutable inputs and emits a deterministic local review pool', async () => {
    expect(cachedPool).toMatchObject({
      corpusVersion: fixture.universeCompletion.corpusVersion,
      binding: { universeRecordCount: fixture.universeCompletion.expected.total },
      eligibleEvaluationCount: expect.any(Number),
      selection: { targetCount: 1, candidates: [expect.any(Object)] },
      sourceMaterials: { records: expect.any(Array) },
    });
    expect(cachedPool.eligibleEvaluationCount).toBeGreaterThanOrEqual(1);
    expect(cachedPool.sourceMaterials.records).toHaveLength(2);
    expect(cachedPool.pairLineage.relationshipInput).toMatchObject({
      archiveSetSha256: cachedSource.relationshipInputManifest.archiveSetSha256,
      manifestDigest: cachedSource.relationshipInputManifest.manifestDigest,
    });
  }, 300_000);

  it('writes only new local files and reports zero remote writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'calibration-pair-pool-'));
    const dependencies = {
      makeDirectory: async () => undefined,
      writeFileText: (await import('node:fs/promises')).writeFile,
      removePath: rm,
      createStorage: () => storage,
      loadHeader: async () => ({
        universe: cachedSource.universe,
        binding: cachedSource.binding,
        relationshipInputManifest: cachedSource.relationshipInputManifest,
      }),
      buildCore: () => ({
        pool: (({ sourceMaterials: _sourceMaterials, poolDigest: _poolDigest, ...pool }) => pool)(cachedPool),
        selectedRecords: cachedPool.sourceMaterials.records.map(({ relationshipRecord }) => relationshipRecord as any),
      }),
      loadUniverseNodes: async () => cachedPool.sourceMaterials.records.map(({ rawRecord }) => ({
        ...rawRecord,
        schemaVersion: 'evidence-universe-node-v1',
        layoutVersion: 'evidence-universe-layout-v1',
        address: `${rawRecord.kind}:${rawRecord.recordId}`,
      })) as any,
      finalizePool: () => cachedPool,
    };
    try {
      const result = await runBuildCalibrationPairCandidatePoolCli([
        `--corpus-version=${fixture.universeCompletion.corpusVersion}`,
        `--output-dir=${directory}`,
        '--target-count=1',
        '--seed=fixture-governed-review-v1',
      ], dependencies);
      expect(result).toMatchObject({
        valid: true,
        selected_pair_count: 1,
        selected_source_material_count: 2,
        database_writes: 0,
        storage_writes: 0,
        luna_calls: 0,
      });
      expect(JSON.parse(await readFile(result.outputs.selection, 'utf8')))
        .toMatchObject({ targetCount: 1 });
      await expect(runBuildCalibrationPairCandidatePoolCli([
        `--corpus-version=${fixture.universeCompletion.corpusVersion}`,
        `--output-dir=${directory}`,
        '--target-count=1',
      ], dependencies)).rejects.toThrow(/EEXIST/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);
});
