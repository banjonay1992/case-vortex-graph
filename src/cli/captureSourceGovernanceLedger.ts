import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { verifyEvidenceUniverseSourceCensusReceipt } from '../caseGraph/postgresEvidenceUniverseSnapshot';
import {
  inspectPostgresSourceGovernanceLedger,
  verifySourceGovernanceLedgerReceipt,
} from '../caseGraph/postgresSourceGovernanceLedger';
import { loadEnv } from '../env';

const getArg = (name: string, argv: string[]) => {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const parseTimeout = (raw: string | undefined) => {
  const value = raw == null ? 10 * 60_000 : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60 * 60_000) {
    throw new Error('--timeout-ms must be an integer between 1000 and 3600000');
  }
  return value;
};

const readJson = async (pathValue: string, maxBytes: number) => {
  const path = resolve(pathValue);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > maxBytes) {
    throw new Error('source_governance_ledger_input_file_invalid');
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size) throw new Error('source_governance_ledger_input_file_changed');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('source_governance_ledger_input_json_invalid');
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
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('source_governance_ledger_output_exists');
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return path;
};

type DbClient = {
  query: (
    query: string | { text: string; values?: unknown[]; query_timeout?: number },
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  release: (error?: Error | boolean) => void;
};
type DbModule = { getClient: () => Promise<DbClient>; closePool: () => Promise<void> };

export const sourceGovernanceLedgerUsage = `Usage:
  npm run case-graph:source-governance:inspect -- \\
    --census-receipt=<source-census-v2.json> \\
    [--output=<source-governance-ledger.json>] [--timeout-ms=600000]

Performs one REPEATABLE READ READ ONLY source-level governance inspection bound
to a fresh sealed census-v2 receipt. It cannot approve sources, ingest records,
write the database, access R2, call Luna, or perform network discovery.
`;

export const runSourceGovernanceLedgerCli = async (
  argv = process.argv.slice(2),
  dependencies: {
    loadDb?: () => Promise<DbModule>;
    readJson?: typeof readJson;
    writeReceipt?: typeof writeReceipt;
    now?: () => Date;
  } = {},
) => {
  loadEnv({ quiet: true });
  if (argv.includes('--help')) return { usage: sourceGovernanceLedgerUsage };
  if (['--write', '--approve', '--ingest', '--discover', '--overwrite', '--delete'].some((flag) => argv.includes(flag))) {
    throw new Error('source governance ledger is inspection-only');
  }
  const censusPath = getArg('--census-receipt', argv);
  if (!censusPath) throw new Error('--census-receipt is required');
  const census = verifyEvidenceUniverseSourceCensusReceipt(
    await (dependencies.readJson || readJson)(censusPath, 128 * 1024),
  );
  const ageMs = (dependencies.now?.() || new Date()).getTime() - new Date(census.inspectedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60 * 60 * 1000) {
    throw new Error('source_governance_ledger_census_expired');
  }
  const expectedSourceUnapprovedRows = census.sightingAccounting?.exclusionReasons.sourceUnapproved;
  if (expectedSourceUnapprovedRows == null) throw new Error('source_governance_ledger_census_accounting_missing');
  const timeoutMs = parseTimeout(getArg('--timeout-ms', argv));
  const db = await (dependencies.loadDb || (() => import('../db') as Promise<unknown> as Promise<DbModule>))();
  let client: DbClient | null = null;
  try {
    client = await db.getClient();
    const receipt = await inspectPostgresSourceGovernanceLedger({
      query: async (sql, params) => {
        const result = await client!.query({ text: sql, values: params, query_timeout: timeoutMs });
        return { rows: result.rows };
      },
    }, {
      statementTimeoutMs: timeoutMs,
      boundCensus: {
        receiptSha256: census.receiptSha256,
        inspectedAt: census.inspectedAt,
        sourceMvccSnapshot: census.sourceMvccSnapshot,
        expectedSourceUnapprovedRows,
      },
    });
    const verified = verifySourceGovernanceLedgerReceipt(receipt);
    const output = getArg('--output', argv);
    const outputPath = output
      ? await (dependencies.writeReceipt || writeReceipt)(output, verified)
      : null;
    return { inspection_only: true, write_enabled: false, ...verified, output_path: outputPath };
  } finally {
    try {
      client?.release();
    } finally {
      await db.closePool();
    }
  }
};

if (require.main === module) {
  runSourceGovernanceLedgerCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
