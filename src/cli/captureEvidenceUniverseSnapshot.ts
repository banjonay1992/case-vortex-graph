import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  capturePostgresEvidenceUniverseSnapshot,
  inspectPostgresEvidenceUniverseSourceReadiness,
  verifyEvidenceUniverseSourceCensusReceipt,
} from '../caseGraph/postgresEvidenceUniverseSnapshot';
import {
  verifyEvidenceUniverseSnapshotCaptureApproval,
} from '../caseGraph/evidenceUniverseSnapshotApproval';
import { loadEnv } from '../env';

const getArg = (name: string, argv: string[]) => {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const hasFlag = (name: string, argv: string[]) => argv.includes(name);

const parseSnapshotId = (raw: string | undefined) => {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new Error('--snapshot-id is required and must be a UUID');
  }
  return value;
};

const parseTimeout = (raw: string | undefined, defaultValue = 30 * 60_000) => {
  const value = raw == null ? defaultValue : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60 * 60_000) {
    throw new Error('--timeout-ms must be an integer between 1000 and 3600000');
  }
  return value;
};

export const evidenceUniverseSnapshotUsage = `Usage:
  npm run case-graph:universe:snapshot -- --inspect-source [--timeout-ms=600000] [--output=<census.json>]
  npm run case-graph:universe:snapshot -- --snapshot-id=<uuid>
  npm run case-graph:universe:snapshot -- --snapshot-id=<uuid> --write-snapshot --census-receipt=<census.json> --approval=<approval.json> [--timeout-ms=1800000]

--inspect-source performs a REPEATABLE READ READ ONLY census and reports exact
capturable counts and blockers. It performs zero database writes, R2 operations
or Luna calls. Without --inspect-source or --write-snapshot this command is
plan-only. The UUID is an idempotency key known before capture. The source time
and MVCC receipt are generated inside one serialized REPEATABLE READ transaction;
historical --snapshot-at cutoffs are intentionally unsupported.
`;

const MAX_CENSUS_RECEIPT_BYTES = 128 * 1024;
const MAX_SNAPSHOT_APPROVAL_BYTES = 64 * 1024;
const MAX_CENSUS_AGE_MS = 60 * 60 * 1000;

const writeCensusReceipt = async (outputPath: string, value: unknown) => {
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await link(temporaryPath, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('evidence_universe_source_census_output_exists');
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return path;
};

const readCensusReceipt = async (inputPath: string) => {
  const path = resolve(inputPath);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_CENSUS_RECEIPT_BYTES) {
    throw new Error('evidence_universe_source_census_file_invalid');
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size) throw new Error('evidence_universe_source_census_file_changed');
  try {
    return verifyEvidenceUniverseSourceCensusReceipt(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('evidence_universe_')) throw error;
    throw new Error('evidence_universe_source_census_json_invalid');
  }
};

const readSnapshotApproval = async (inputPath: string) => {
  const path = resolve(inputPath);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_SNAPSHOT_APPROVAL_BYTES) {
    throw new Error('evidence_universe_snapshot_approval_file_invalid');
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size) {
    throw new Error('evidence_universe_snapshot_approval_file_changed');
  }
  try {
    return verifyEvidenceUniverseSnapshotCaptureApproval(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('evidence_universe_')) throw error;
    throw new Error('evidence_universe_snapshot_approval_json_invalid');
  }
};

type DbClient = {
  query: (
    query: string | { text: string; values?: any[]; query_timeout?: number },
    params?: any[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  release: (error?: Error | boolean) => void;
};
type DbModule = {
  getClient: () => Promise<DbClient>;
  closePool: () => Promise<void>;
};

export const runEvidenceUniverseSnapshotCli = async (
  argv = process.argv.slice(2),
  dependencies: {
    loadDb?: () => Promise<DbModule>;
    readCensusReceipt?: typeof readCensusReceipt;
    readSnapshotApproval?: typeof readSnapshotApproval;
    writeCensusReceipt?: typeof writeCensusReceipt;
    now?: () => Date;
  } = {},
) => {
  loadEnv({ quiet: true });
  if (hasFlag('--help', argv)) return { usage: evidenceUniverseSnapshotUsage };
  if (getArg('--snapshot-at', argv) !== undefined || hasFlag('--snapshot-at', argv)) {
    throw new Error('--snapshot-at is unsupported; snapshot time must be generated inside capture');
  }
  if (['--delete', '--drop', '--truncate', '--overwrite'].some((flag) => hasFlag(flag, argv))) {
    throw new Error('destructive evidence-universe snapshot operations are not implemented');
  }
  const inspectSource = hasFlag('--inspect-source', argv);
  const writeSnapshot = hasFlag('--write-snapshot', argv);
  if (inspectSource && (writeSnapshot || getArg('--snapshot-id', argv) !== undefined)) {
    throw new Error('--inspect-source cannot be combined with --write-snapshot or --snapshot-id');
  }
  if (inspectSource) {
    const timeoutMs = parseTimeout(getArg('--timeout-ms', argv), 10 * 60_000);
    const db = await (dependencies.loadDb || (() => import('../db') as Promise<unknown> as Promise<DbModule>))();
    let client: DbClient | null = null;
    try {
      client = await db.getClient();
      const receipt = await inspectPostgresEvidenceUniverseSourceReadiness({
        query: async (sql, params) => {
          const result = await client!.query({
            text: sql,
            values: params as any[] | undefined,
            query_timeout: timeoutMs,
          });
          return { rows: result.rows };
        },
      }, { statementTimeoutMs: timeoutMs });
      const output = getArg('--output', argv);
      const outputPath = output
        ? await (dependencies.writeCensusReceipt || writeCensusReceipt)(output, receipt)
        : null;
      return { write_enabled: false, inspection_only: true, ...receipt, output_path: outputPath };
    } finally {
      try {
        client?.release();
      } finally {
        await db.closePool();
      }
    }
  }
  const snapshotId = parseSnapshotId(getArg('--snapshot-id', argv));
  const timeoutMs = parseTimeout(getArg('--timeout-ms', argv));
  const censusPath = getArg('--census-receipt', argv);
  const census = censusPath
    ? verifyEvidenceUniverseSourceCensusReceipt(
      await (dependencies.readCensusReceipt || readCensusReceipt)(censusPath),
    )
    : null;
  if (!writeSnapshot) {
    if (census) {
      const censusAgeMs = (dependencies.now?.() || new Date()).getTime()
        - new Date(census.inspectedAt).getTime();
      const censusFresh = Number.isFinite(censusAgeMs)
        && censusAgeMs >= 0
        && censusAgeMs <= MAX_CENSUS_AGE_MS;
      const countsComplete = Object.values(census.counts).every((count) => count !== null);
      return {
        write_enabled: false,
        snapshot_id: snapshotId,
        transaction_isolation: 'repeatable read',
        components: ['sighting', 'document', 'photo', 'video'],
        census_receipt_sha256: census.receiptSha256,
        census_fresh: censusFresh,
        source_counts: census.counts,
        capture_ready: census.readyForSnapshotCapture
          && census.blockers.length === 0
          && censusFresh
          && countsComplete,
        note: 'Bound plan only. A write still requires --write-snapshot and exact in-transaction count reconciliation.',
      };
    }
    return {
      write_enabled: false,
      snapshot_id: snapshotId,
      transaction_isolation: 'repeatable read',
      components: ['sighting', 'document', 'photo', 'video'],
      note: 'Plan only. Re-run with --write-snapshot using the same caller-owned UUID.',
    };
  }

  if (!census) throw new Error('--census-receipt is required with --write-snapshot');
  const approvalPath = getArg('--approval', argv);
  if (!approvalPath) throw new Error('--approval is required with --write-snapshot');
  const approval = verifyEvidenceUniverseSnapshotCaptureApproval(
    await (dependencies.readSnapshotApproval || readSnapshotApproval)(approvalPath),
  );
  if (approval.snapshotId !== snapshotId
    || approval.censusReceiptSha256 !== census.receiptSha256
    || approval.censusInspectedAt !== census.inspectedAt) {
    throw new Error('evidence_universe_snapshot_approval_binding_mismatch');
  }
  const now = dependencies.now?.() || new Date();
  const approvedAtMs = new Date(approval.approvedAt).getTime();
  if (!Number.isFinite(approvedAtMs) || approvedAtMs > now.getTime()) {
    throw new Error('evidence_universe_snapshot_approval_timestamp_future');
  }
  if (!census.readyForSnapshotCapture || census.blockers.length) {
    throw new Error('evidence_universe_source_census_not_capture_ready');
  }
  const censusAgeMs = now.getTime()
    - new Date(census.inspectedAt).getTime();
  if (!Number.isFinite(censusAgeMs) || censusAgeMs < 0 || censusAgeMs > MAX_CENSUS_AGE_MS) {
    throw new Error('evidence_universe_source_census_expired');
  }
  if (Object.values(census.counts).some((count) => count === null)) {
    throw new Error('evidence_universe_source_census_counts_incomplete');
  }
  const expectedCounts = census.counts as Record<'sighting' | 'document' | 'photo' | 'video', number>;

  const db = await (dependencies.loadDb || (() => import('../db') as Promise<unknown> as Promise<DbModule>))();
  let client: DbClient | null = null;
  try {
    client = await db.getClient();
    const receipt = await capturePostgresEvidenceUniverseSnapshot({
      query: async (sql, params) => {
        const result = await client!.query({
          text: sql,
          values: params as any[] | undefined,
          query_timeout: timeoutMs,
        });
        return { rows: result.rows };
      },
    }, { snapshotId, statementTimeoutMs: timeoutMs, expectedCounts });
    return {
      write_enabled: true,
      approval_id: approval.approvalId,
      approval_sha256: approval.approvalSha256,
      census_receipt_sha256: census.receiptSha256,
      publication_activation_approved: false,
      deployment_approved: false,
      ...receipt,
    };
  } finally {
    try {
      client?.release();
    } finally {
      await db.closePool();
    }
  }
};

if (require.main === module) {
  runEvidenceUniverseSnapshotCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
