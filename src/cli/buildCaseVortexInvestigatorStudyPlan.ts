import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildCaseVortexInvestigatorStudyPlan } from '../caseGraph/investigatorStudyPlan';

export const caseVortexInvestigatorStudyPlanUsage = `Usage:
  npm run case-vortex:investigator-plan -- \\
    --plan-id <id> --publication-id <id> --corpus-version <version> \\
    --manifest-sha256 <sha256> --output <plan.json>

Creates the deterministic 200-query/50-reconstruction human study plan. It
does not generate answers, count fixtures as reviews, call Luna, use a network,
mutate the publication or claim that the benchmark passed.
`;

type Dependencies = {
  makeDirectory: typeof mkdir;
  writeFileBytes: typeof writeFile;
  renameFile: typeof rename;
  unlinkFile: typeof unlink;
};

const defaults: Dependencies = {
  makeDirectory: mkdir,
  writeFileBytes: writeFile,
  renameFile: rename,
  unlinkFile: unlink,
};

const parseArguments = (argv: string[]) => {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true as const };
  const values: Record<string, string> = {};
  const allowed = new Set([
    '--plan-id', '--publication-id', '--corpus-version', '--manifest-sha256', '--output',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || value.startsWith('-') || values[key]) {
      throw new Error(`case_vortex_investigator_study_argument_invalid:${key}`);
    }
    values[key] = value;
  }
  for (const key of allowed) {
    if (!values[key]) throw new Error(`case_vortex_investigator_study_argument_required:${key}`);
  }
  return {
    help: false as const,
    planId: values['--plan-id'],
    publicationId: values['--publication-id'],
    corpusVersion: values['--corpus-version'],
    manifestSha256: values['--manifest-sha256'],
    outputPath: resolve(values['--output']),
  };
};

export const runCaseVortexInvestigatorStudyPlanCli = async (
  argv = process.argv.slice(2),
  dependencies: Dependencies = defaults,
) => {
  const args = parseArguments(argv);
  if (args.help) return { usage: caseVortexInvestigatorStudyPlanUsage };
  const plan = buildCaseVortexInvestigatorStudyPlan(args);
  const bytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await dependencies.makeDirectory(dirname(args.outputPath), { recursive: true });
  const temporaryPath = `${args.outputPath}.tmp-${process.pid}`;
  try {
    await dependencies.writeFileBytes(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    await dependencies.renameFile(temporaryPath, args.outputPath);
  } catch (error) {
    await dependencies.unlinkFile(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    valid: true as const,
    plan_sha256: plan.planSha256,
    publication_id: plan.publication.publicationId,
    query_slot_count: plan.accounting.querySlotCount,
    source_reconstruction_slot_count: plan.accounting.sourceReconstructionSlotCount,
    output_path: args.outputPath,
    synthetic_answers: 0 as const,
    network_requests: 0 as const,
    luna_calls: 0 as const,
    publication_mutations: 0 as const,
  };
};

if (require.main === module) {
  runCaseVortexInvestigatorStudyPlanCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
