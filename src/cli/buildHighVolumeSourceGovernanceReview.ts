import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildHighVolumeSourceGovernanceReview,
  verifyHighVolumeSourceGovernanceReviewReceipt,
} from '../caseGraph/highVolumeSourceGovernanceReview';
import { verifySourceGovernanceLedgerReceipt } from '../caseGraph/postgresSourceGovernanceLedger';

const getArg = (name: string, argv: string[]) => {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const readJson = async (pathValue: string, maxBytes = 512 * 1024) => {
  const path = resolve(pathValue);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > maxBytes) {
    throw new Error('source_governance_review_input_file_invalid');
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size) throw new Error('source_governance_review_input_file_changed');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('source_governance_review_input_json_invalid');
  }
};

const writeReceipt = async (pathValue: string, value: unknown) => {
  const path = resolve(pathValue);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await link(temporaryPath, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('source_governance_review_output_exists');
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return path;
};

export const highVolumeSourceGovernanceReviewUsage = `Usage:
  npm run case-graph:source-governance:review -- \\
    --governance-ledger=<source-governance-ledger.json> \\
    --output=<high-volume-source-review.json>

Builds a sealed, local proposal for the five highest-volume excluded sources.
It cannot approve a source, mutate the registry or database, access R2, call
Luna, perform network discovery, publish, or deploy.
`;

export const runHighVolumeSourceGovernanceReviewCli = async (
  argv = process.argv.slice(2),
  dependencies: {
    readJson?: typeof readJson;
    writeReceipt?: typeof writeReceipt;
    now?: () => Date;
  } = {},
) => {
  if (argv.includes('--help')) return { usage: highVolumeSourceGovernanceReviewUsage };
  if (['--write', '--approve', '--ingest', '--discover', '--publish', '--deploy', '--overwrite', '--delete']
    .some((flag) => argv.includes(flag))) throw new Error('source governance review is proposal-only');
  const ledgerPath = getArg('--governance-ledger', argv);
  const output = getArg('--output', argv);
  if (!ledgerPath) throw new Error('--governance-ledger is required');
  if (!output) throw new Error('--output is required');
  const ledger = verifySourceGovernanceLedgerReceipt(await (dependencies.readJson || readJson)(ledgerPath));
  const reviewedAt = (dependencies.now?.() || new Date()).toISOString().replace(/\.\d{3}Z$/u, '.000000Z');
  const receipt = buildHighVolumeSourceGovernanceReview(ledger, { reviewedAt });
  const verified = verifyHighVolumeSourceGovernanceReviewReceipt(receipt, ledger);
  const outputPath = await (dependencies.writeReceipt || writeReceipt)(output, verified);
  return { proposal_only: true, approval_granted: false, ...verified, output_path: outputPath };
};

if (require.main === module) {
  runHighVolumeSourceGovernanceReviewCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
