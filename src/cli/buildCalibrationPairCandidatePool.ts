import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildStreamingCalibrationPairCandidatePoolCore,
  finalizeCalibrationPairCandidatePool,
  loadCalibrationCandidateArchiveHeader,
  loadCalibrationCandidateUniverseNodes,
} from '../caseGraph/calibrationCandidatePool';
import { canonicalizeRelationshipInput } from '../caseGraph/relationshipInputSnapshot';
import { loadEnv } from '../env';

const CORPUS = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const getArg = (name: string, argv: string[]) => {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

export const calibrationPairCandidatePoolUsage = `Usage:
  npm run case-graph:calibration:candidates -- --corpus-version=<version> --output-dir=<local-dir> [--target-count=1001] [--seed=current-corpus-human-review-v1]

Reads and validates the immutable universe and relationship-input archives from
R2, builds the bounded typed pair candidate pool, then writes a deterministic
selection, pair lineage and blinded source-material draft locally. It performs
no database writes, R2 writes, Luna calls, publication or deployment.
`;

type Dependencies = {
  makeDirectory: typeof mkdir;
  writeFileText: typeof writeFile;
  removePath: typeof rm;
  createStorage: () => ReturnType<typeof import('../storage/r2FetchStorage')['createR2FetchArchiveStorage']>;
  loadHeader: typeof loadCalibrationCandidateArchiveHeader;
  buildCore: typeof buildStreamingCalibrationPairCandidatePoolCore;
  loadUniverseNodes: typeof loadCalibrationCandidateUniverseNodes;
  finalizePool: typeof finalizeCalibrationPairCandidatePool;
};

const defaults: Dependencies = {
  makeDirectory: mkdir,
  writeFileText: writeFile,
  removePath: rm,
  createStorage: () => {
    const { createR2FetchArchiveStorage } = require('../storage/r2FetchStorage') as typeof import('../storage/r2FetchStorage');
    return createR2FetchArchiveStorage();
  },
  loadHeader: loadCalibrationCandidateArchiveHeader,
  buildCore: buildStreamingCalibrationPairCandidatePoolCore,
  loadUniverseNodes: loadCalibrationCandidateUniverseNodes,
  finalizePool: finalizeCalibrationPairCandidatePool,
};

const writeNew = async (path: string, body: string, dependencies: Dependencies) => {
  await dependencies.writeFileText(path, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
};

export const runBuildCalibrationPairCandidatePoolCli = async (
  argv = process.argv.slice(2),
  dependencies: Dependencies = defaults,
) => {
  if (argv.includes('--help') || argv.includes('-h')) return { usage: calibrationPairCandidatePoolUsage };
  if (argv.some((value) => ['--write-r2', '--publish', '--deploy', '--overwrite'].includes(value))) {
    throw new Error('remote writes, publication, deployment and overwrite are not implemented');
  }
  const corpusVersion = String(getArg('--corpus-version', argv) || '').trim().toLowerCase();
  const outputDir = resolve(String(getArg('--output-dir', argv) || '').trim());
  const seed = String(getArg('--seed', argv) || 'current-corpus-human-review-v1').trim();
  const targetCount = Number(getArg('--target-count', argv) || 1_001);
  if (!CORPUS.test(corpusVersion)) throw new Error('--corpus-version is invalid');
  if (!getArg('--output-dir', argv) || !STABLE_ID.test(seed)
    || !Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > 100_000) {
    throw new Error('calibration pair candidate arguments are invalid');
  }
  loadEnv({ quiet: true });
  const storage = dependencies.createStorage();
  const header = await dependencies.loadHeader({ storage, corpusVersion });
  const core = await dependencies.buildCore({ storage, header, targetCount, seed });
  const universeNodes = await dependencies.loadUniverseNodes({
    storage,
    universe: header.universe,
    addresses: core.selectedRecords.map(({ address }) => address),
  });
  const pool = dependencies.finalizePool({ core, universeNodes });
  const paths = {
    pool: resolve(outputDir, 'pair-candidate-pool.json'),
    selection: resolve(outputDir, 'pair-candidate-selection.json'),
    lineage: resolve(outputDir, 'pair-lineage.json'),
    materials: resolve(outputDir, 'pair-source-materials.json'),
  };
  await dependencies.makeDirectory(outputDir, { recursive: true, mode: 0o700 });
  const written: string[] = [];
  try {
    await writeNew(paths.pool, `${canonicalizeRelationshipInput(pool)}\n`, dependencies);
    written.push(paths.pool);
    await writeNew(paths.selection, `${canonicalizeRelationshipInput(pool.selection)}\n`, dependencies);
    written.push(paths.selection);
    await writeNew(paths.lineage, `${canonicalizeRelationshipInput(pool.pairLineage)}\n`, dependencies);
    written.push(paths.lineage);
    await writeNew(paths.materials, `${canonicalizeRelationshipInput(pool.sourceMaterials)}\n`, dependencies);
    written.push(paths.materials);
  } catch (error) {
    await Promise.all(written.map((path) => dependencies.removePath(path, { force: true })));
    throw error;
  }
  return {
    valid: true as const,
    corpus_version: corpusVersion,
    snapshot_id: pool.binding.snapshotId,
    universe_record_count: pool.binding.universeRecordCount,
    eligible_evaluation_count: pool.eligibleEvaluationCount,
    selected_pair_count: pool.selection.targetCount,
    selected_source_material_count: pool.sourceMaterials.records.length,
    selection_digest: pool.selection.selectionDigest,
    pool_digest: pool.poolDigest,
    outputs: paths,
    database_reads: 0 as const,
    database_writes: 0 as const,
    storage_reads: header.universe.parts.length
      + header.relationshipInputManifest.parts.length * 4 + 2,
    storage_writes: 0 as const,
    luna_calls: 0 as const,
  };
};

if (require.main === module) {
  runBuildCalibrationPairCandidatePoolCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
