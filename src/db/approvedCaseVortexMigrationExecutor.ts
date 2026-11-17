import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS,
  CASE_VORTEX_MIGRATION_CONTRACTS,
  inspectCaseVortexMigrationSignatures,
} from '../cli/buildCaseVortexRemoteRehearsal';
import {
  verifyCaseVortexMigrationExecutionApproval,
  type CaseVortexMigrationExecutionApproval,
} from '../caseGraph/migrationExecutionApproval';
import { relationshipInputSha256 } from '../caseGraph/relationshipInputSnapshot';
import { splitSqlStatements } from './sqlStatementSplitter';

export const CASE_VORTEX_MIGRATION_EXECUTION_RECEIPT_VERSION =
  'case-vortex-migration-execution-receipt-v3' as const;
export const CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION =
  'case-vortex-migration-execution-failure-receipt-v2' as const;
const CASE_VORTEX_MIGRATION_EXECUTION_LEGACY_FAILURE_RECEIPT_VERSION =
  'case-vortex-migration-execution-failure-receipt-v1' as const;

type QueryResult = { rows: Array<Record<string, unknown>> };
export type CaseVortexMigrationExecutionClient = {
  query: (sql: string, params?: readonly unknown[]) => Promise<QueryResult>;
  release: () => void | Promise<void>;
};

type Dependencies = {
  getClient: () => Promise<CaseVortexMigrationExecutionClient>;
  readMigration?: (filePath: string) => Promise<Buffer>;
  migrationsDir?: string;
  now?: () => Date;
  advisoryLockId?: number;
};

export type PreparedCaseVortexMigration = {
  version: string;
  fileName: string;
  sql: string;
  statements: string[];
  transactionMode: 'autocommit-per-statement' | 'single-transaction';
  sha256: string;
};
type PreparedMigration = PreparedCaseVortexMigration;

export type CaseVortexMigrationPreparationDependencies = {
  readMigration?: (filePath: string) => Promise<Buffer>;
  migrationsDir?: string;
};

const transactionBoundary = (statement: string) => statement.trim().replace(/;$/u, '').toUpperCase();

export const caseVortexTransactionalStatements = (
  migration: PreparedCaseVortexMigration,
): string[] => {
  const firstIsBegin = transactionBoundary(migration.statements[0] || '') === 'BEGIN';
  const lastIsCommit = transactionBoundary(
    migration.statements[migration.statements.length - 1] || '',
  ) === 'COMMIT';
  if (firstIsBegin !== lastIsCommit) {
    throw new Error(`case_vortex_migration_execution_transaction_envelope_invalid:${migration.version}`);
  }
  // The executor owns the transaction and tracker write. A frozen migration may
  // already contain a matching outer BEGIN/COMMIT envelope; omit only those two
  // boundary statements so the tracker remains in the same atomic transaction.
  return firstIsBegin ? migration.statements.slice(1, -1) : migration.statements;
};

export type CaseVortexMigrationExecutionFailureReceipt = {
  recordType: 'case_vortex_migration_execution_failure_receipt';
  schemaVersion: typeof CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION
    | typeof CASE_VORTEX_MIGRATION_EXECUTION_LEGACY_FAILURE_RECEIPT_VERSION;
  approvalId: string;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  failedAt: string;
  failureStage: 'advisory_lock' | 'remote_boundary' | 'transaction_begin'
    | 'migration_statement' | 'tracker_write' | 'transaction_commit' | 'transaction_rollback'
    | 'post_apply_verification';
  failedVersion: string | null;
  failedFileName: string | null;
  completedStatementCountInFailedMigration: number;
  currentTransactionRolledBack: boolean;
  applied: Array<{
    version: string;
    fileName: string;
    sha256: string;
    statementCount: number;
    transactionMode: PreparedMigration['transactionMode'];
  }>;
  databaseMayBePartiallyMutated: boolean;
  reconciliationRequired: boolean;
  causeSha256: string;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

export class CaseVortexMigrationExecutionFailure extends Error {
  readonly receipt: CaseVortexMigrationExecutionFailureReceipt;

  constructor(message: string, receipt: CaseVortexMigrationExecutionFailureReceipt) {
    super(message);
    this.name = 'CaseVortexMigrationExecutionFailure';
    this.receipt = receipt;
  }
}

export type CaseVortexMigrationPostApplyVerification = {
  schemaSignatureCount: number;
  schemaSignatureSetSha256: string;
  appTrackerCount: number;
  supabaseTrackerCount: number;
  activePublicationCount: 0;
};

export type CaseVortexMigrationExecutionReceipt = {
  recordType: 'case_vortex_migration_execution_receipt';
  schemaVersion: typeof CASE_VORTEX_MIGRATION_EXECUTION_RECEIPT_VERSION;
  approvalId: string;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  completedAt: string;
  applied: CaseVortexMigrationExecutionFailureReceipt['applied'];
  postApplyVerification: CaseVortexMigrationPostApplyVerification;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

const RECEIPT_SHA256 = /^[a-f0-9]{64}$/u;
const RECEIPT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const FAILURE_STAGES = new Set<CaseVortexMigrationExecutionFailureReceipt['failureStage']>([
  'advisory_lock', 'remote_boundary', 'transaction_begin', 'migration_statement',
  'tracker_write', 'transaction_commit', 'transaction_rollback', 'post_apply_verification',
]);

const receiptInvalid = (): never => { throw new Error('case_vortex_migration_execution_receipt_invalid'); };
const receiptRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) receiptInvalid();
  return value as Record<string, unknown>;
};
const exactReceiptKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const keys = Object.keys(value);
  if (keys.length !== expected.length
    || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) receiptInvalid();
};
const receiptTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) receiptInvalid();
  const candidate = value as string;
  try {
    if (new Date(candidate).toISOString() !== candidate) receiptInvalid();
  } catch {
    receiptInvalid();
  }
  return candidate;
};
const receiptSha = (value: unknown): string => {
  if (typeof value !== 'string' || !RECEIPT_SHA256.test(value)) receiptInvalid();
  return value as string;
};

export const verifyCaseVortexMigrationPostApplyVerification = (
  value: unknown,
): CaseVortexMigrationPostApplyVerification => {
  const postApply = receiptRecord(value);
  exactReceiptKeys(postApply, [
    'schemaSignatureCount', 'schemaSignatureSetSha256', 'appTrackerCount',
    'supabaseTrackerCount', 'activePublicationCount',
  ]);
  const expectedSignatureState = Object.fromEntries(
    [...CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS].sort().map((key) => [key, true]),
  );
  if (postApply.schemaSignatureCount !== CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS.length
    || postApply.schemaSignatureSetSha256 !== relationshipInputSha256(expectedSignatureState)
    || postApply.appTrackerCount !== CASE_VORTEX_MIGRATION_CONTRACTS.length
    || postApply.supabaseTrackerCount !== CASE_VORTEX_MIGRATION_CONTRACTS.length
    || postApply.activePublicationCount !== 0) receiptInvalid();
  return postApply as unknown as CaseVortexMigrationPostApplyVerification;
};

const verifyAppliedReceiptEntries = (value: unknown, complete: boolean) => {
  if (!Array.isArray(value) || value.length > CASE_VORTEX_MIGRATION_CONTRACTS.length
    || (complete && value.length !== CASE_VORTEX_MIGRATION_CONTRACTS.length)) receiptInvalid();
  return (value as unknown[]).map((entry: unknown, index: number) => {
    const candidate = receiptRecord(entry);
    exactReceiptKeys(candidate, [
      'version', 'fileName', 'sha256', 'statementCount', 'transactionMode',
    ]);
    const contract = CASE_VORTEX_MIGRATION_CONTRACTS[index];
    const expectedMode = index < 2 ? 'autocommit-per-statement' : 'single-transaction';
    if (!contract || candidate.version !== contract.version
      || candidate.fileName !== contract.fileName || candidate.sha256 !== contract.sha256
      || !Number.isSafeInteger(candidate.statementCount)
      || Number(candidate.statementCount) < 1 || candidate.transactionMode !== expectedMode) {
      receiptInvalid();
    }
    return {
      version: contract.version,
      fileName: contract.fileName,
      sha256: contract.sha256,
      statementCount: Number(candidate.statementCount),
      transactionMode: expectedMode as PreparedMigration['transactionMode'],
    };
  });
};

export const verifyCaseVortexMigrationExecutionReceipt = (
  value: unknown,
): CaseVortexMigrationExecutionReceipt | CaseVortexMigrationExecutionFailureReceipt => {
  const candidate = receiptRecord(value);
  const success = candidate.recordType === 'case_vortex_migration_execution_receipt';
  const failure = candidate.recordType === 'case_vortex_migration_execution_failure_receipt';
  if (!success && !failure) receiptInvalid();
  const baseKeys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvalSha256',
    'rehearsalReceiptSha256', 'startedAt', 'applied', 'publicationActivations',
    'deployments', 'receiptSha256',
  ];
  exactReceiptKeys(candidate, success
    ? [...baseKeys, 'completedAt', 'postApplyVerification']
    : [...baseKeys, 'failedAt', 'failureStage', 'failedVersion', 'failedFileName',
      'completedStatementCountInFailedMigration', 'currentTransactionRolledBack',
      'databaseMayBePartiallyMutated', 'reconciliationRequired', 'causeSha256']);
  if (!RECEIPT_UUID.test(String(candidate.approvalId || ''))
    || candidate.publicationActivations !== 0 || candidate.deployments !== 0) receiptInvalid();
  receiptSha(candidate.approvalSha256);
  receiptSha(candidate.rehearsalReceiptSha256);
  receiptSha(candidate.receiptSha256);
  const startedAt = receiptTimestamp(candidate.startedAt);
  const applied = verifyAppliedReceiptEntries(candidate.applied, success);
  const { receiptSha256, ...withoutDigest } = candidate;
  if (relationshipInputSha256(withoutDigest) !== receiptSha256) receiptInvalid();

  if (success) {
    if (candidate.schemaVersion !== CASE_VORTEX_MIGRATION_EXECUTION_RECEIPT_VERSION) receiptInvalid();
    const completedAt = receiptTimestamp(candidate.completedAt);
    if (completedAt < startedAt) receiptInvalid();
    verifyCaseVortexMigrationPostApplyVerification(candidate.postApplyVerification);
    return candidate as unknown as CaseVortexMigrationExecutionReceipt;
  }

  const legacyFailureReceipt = candidate.schemaVersion
    === CASE_VORTEX_MIGRATION_EXECUTION_LEGACY_FAILURE_RECEIPT_VERSION;
  if ((!legacyFailureReceipt
      && candidate.schemaVersion !== CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION)
    || !FAILURE_STAGES.has(candidate.failureStage as CaseVortexMigrationExecutionFailureReceipt['failureStage'])
    || typeof candidate.currentTransactionRolledBack !== 'boolean'
    || typeof candidate.databaseMayBePartiallyMutated !== 'boolean'
    || typeof candidate.reconciliationRequired !== 'boolean'
    || !Number.isSafeInteger(candidate.completedStatementCountInFailedMigration)
    || Number(candidate.completedStatementCountInFailedMigration) < 0) receiptInvalid();
  receiptSha(candidate.causeSha256);
  const failedAt = receiptTimestamp(candidate.failedAt);
  if (failedAt < startedAt) receiptInvalid();
  const preMigrationFailure = ['advisory_lock', 'remote_boundary'].includes(String(candidate.failureStage));
  const postApplyFailure = candidate.failureStage === 'post_apply_verification';
  const expectedFailed = CASE_VORTEX_MIGRATION_CONTRACTS[applied.length];
  if (preMigrationFailure) {
    if (applied.length || candidate.failedVersion !== null || candidate.failedFileName !== null
      || candidate.completedStatementCountInFailedMigration !== 0
      || candidate.currentTransactionRolledBack !== false
      || candidate.databaseMayBePartiallyMutated !== false
      || candidate.reconciliationRequired !== false) receiptInvalid();
  } else if (postApplyFailure) {
    if (applied.length !== CASE_VORTEX_MIGRATION_CONTRACTS.length
      || candidate.failedVersion !== null || candidate.failedFileName !== null
      || candidate.completedStatementCountInFailedMigration !== 0
      || candidate.currentTransactionRolledBack !== false
      || candidate.databaseMayBePartiallyMutated !== true
      || candidate.reconciliationRequired !== true) receiptInvalid();
  } else if (!expectedFailed || candidate.failedVersion !== expectedFailed.version
    || candidate.failedFileName !== expectedFailed.fileName) receiptInvalid();
  const legacyExpectedMayBeMutated = applied.length > 0
    || (applied.length < 2 && Number(candidate.completedStatementCountInFailedMigration) > 0);
  const expectedMayBeMutated = legacyFailureReceipt
    ? legacyExpectedMayBeMutated
    : legacyExpectedMayBeMutated
      || (applied.length < 2 && candidate.failureStage === 'migration_statement');
  if (!preMigrationFailure && !postApplyFailure
    && (candidate.databaseMayBePartiallyMutated !== expectedMayBeMutated
    || candidate.reconciliationRequired !== expectedMayBeMutated)) receiptInvalid();
  if (applied.length >= 2 && Number(candidate.completedStatementCountInFailedMigration) > 0
    && candidate.currentTransactionRolledBack === true) receiptInvalid();
  return candidate as unknown as CaseVortexMigrationExecutionFailureReceipt;
};

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const truthy = (value: unknown) => value === true || value === 't';
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
const SQL_IDENTIFIER_PART = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const SQL_QUALIFIED_IDENTIFIER = String.raw`${SQL_IDENTIFIER_PART}(?:\s*\.\s*${SQL_IDENTIFIER_PART})?`;
const CREATE_INDEX_CONCURRENTLY_PATTERN = new RegExp(
  String.raw`^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(${SQL_QUALIFIED_IDENTIFIER})\s+ON\s+(?:ONLY\s+)?(${SQL_QUALIFIED_IDENTIFIER})(?=\s|\()`,
  'iu',
);
const SAFE_QUALIFIED_IDENTIFIER = new RegExp(
  String.raw`^(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\.(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)$`,
  'u',
);

const identifierName = (value: string) => {
  const parts = value.match(new RegExp(SQL_IDENTIFIER_PART, 'gu')) || [];
  const raw = parts[parts.length - 1]?.trim();
  if (!raw) return null;
  return raw.startsWith('"') ? raw.slice(1, -1).replace(/""/gu, '"') : raw.toLowerCase();
};

export const removeInvalidCaseVortexConcurrentIndexTarget = async (
  client: CaseVortexMigrationExecutionClient,
  statement: string,
) => {
  const match = CREATE_INDEX_CONCURRENTLY_PATTERN.exec(stripSqlComments(statement));
  if (!match) return;
  const indexName = identifierName(match[1]);
  if (!indexName) throw new Error('case_vortex_migration_execution_concurrent_index_invalid');
  const result = await client.query(`
    /* case_vortex_approved_migration_execution:concurrent_index_state */
    SELECT state.indisvalid AS is_valid,
      format('%I.%I', namespace.nspname, index_relation.relname) AS qualified_name
    FROM pg_catalog.pg_index AS state
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = state.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = state.indrelid
    WHERE table_relation.oid = pg_catalog.to_regclass($2)
      AND namespace.oid = table_relation.relnamespace
      AND index_relation.relname = $1
    LIMIT 1
  `, [indexName, match[2]]);
  const existing = result.rows[0];
  if (!existing || truthy(existing.is_valid)) return;
  // The legacy 0202 cursor is deliberately removed by frozen migration 0203.
  // If an interrupted reconciliation left that obsolete index invalid, keep
  // the placeholder so 0202's IF NOT EXISTS is a bounded no-op; 0203 then
  // drops it. Rebuilding a large obsolete index only to drop it in the next
  // migration wastes time and can repeatedly hit hosted statement limits.
  if (indexName === 'idx_uap_sightings_case_graph_source_cursor') return;
  const qualifiedName = String(existing.qualified_name || '');
  if (!SAFE_QUALIFIED_IDENTIFIER.test(qualifiedName)) {
    throw new Error('case_vortex_migration_execution_concurrent_index_invalid');
  }
  await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${qualifiedName}`);
};

export const prepareCaseVortexMigrations = async (
  dependencies: CaseVortexMigrationPreparationDependencies,
  contracts: ReadonlyArray<{
    version: string;
    fileName: string;
    sha256: string;
  }> = CASE_VORTEX_MIGRATION_CONTRACTS,
): Promise<PreparedMigration[]> => {
  const migrationsDir = dependencies.migrationsDir
    || path.join(process.cwd(), 'src', 'db', 'migrations');
  const readMigration = dependencies.readMigration || readFile;
  return Promise.all(contracts.map(async (contract) => {
    const bytes = await readMigration(path.join(migrationsDir, contract.fileName));
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== contract.sha256) {
      throw new Error(`case_vortex_migration_execution_digest_mismatch:${contract.version}`);
    }
    const sql = bytes.toString('utf8');
    const statements = splitSqlStatements(sql);
    if (!statements.length) throw new Error(`case_vortex_migration_execution_empty:${contract.version}`);
    const transactionMode = statements.some((statement) => /\bCONCURRENTLY\b/iu.test(statement))
      ? 'autocommit-per-statement' as const
      : 'single-transaction' as const;
    const expectedMode = ['0202', '0203'].includes(contract.version)
      ? 'autocommit-per-statement' : 'single-transaction';
    if (transactionMode !== expectedMode) {
      throw new Error(`case_vortex_migration_execution_boundary_drift:${contract.version}`);
    }
    return {
      version: contract.version,
      fileName: contract.fileName,
      sql,
      statements,
      transactionMode,
      sha256: actualSha256,
    };
  }));
};

const assertApproval = (input: {
  approval: unknown;
  expectedApprovalSha256: string;
  verifiedRehearsalReceiptSha256: string;
}) => {
  const approval = verifyCaseVortexMigrationExecutionApproval(input.approval);
  if (approval.approvalSha256 !== input.expectedApprovalSha256) {
    throw new Error('case_vortex_migration_execution_approval_sha_mismatch');
  }
  if (approval.rehearsalReceiptSha256 !== input.verifiedRehearsalReceiptSha256) {
    throw new Error('case_vortex_migration_execution_rehearsal_receipt_mismatch');
  }
  return approval;
};

const assertRemoteStillAtApprovedBoundary = async (
  client: CaseVortexMigrationExecutionClient,
  expectedFiles: string[],
) => {
  const active = await client.query(`
    /* case_vortex_approved_migration_execution:active_publication */
    SELECT count(*)::integer AS count
    FROM public.uap_case_graph_publications WHERE active = true
  `);
  if (Number(active.rows[0]?.count || 0) !== 0) {
    throw new Error('case_vortex_migration_execution_active_publication');
  }
  const app = await client.query(`
    /* case_vortex_approved_migration_execution:app_ledger */
    SELECT id FROM public.schema_migrations WHERE id = ANY($1::text[]) ORDER BY id
  `, [expectedFiles]);
  const stems = expectedFiles.map((fileName) => fileName.replace(/\.sql$/u, ''));
  const supabase = await client.query(`
    /* case_vortex_approved_migration_execution:supabase_ledger */
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version = ANY($1::text[]) ORDER BY version
  `, [stems]);
  if (app.rows.length || supabase.rows.length) {
    throw new Error('case_vortex_migration_execution_ledger_drift');
  }
};

export const assertCaseVortexMigrationPostconditions = async (
  client: CaseVortexMigrationExecutionClient,
) => {
  const signatures = await inspectCaseVortexMigrationSignatures(client.query.bind(client));
  const missingSignatures = CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS
    .filter((key) => signatures[key] !== true);
  if (missingSignatures.length) {
    throw new Error(`case_vortex_migration_execution_post_apply_schema_drift:${missingSignatures.join(',')}`);
  }

  const expectedAppEntries = CASE_VORTEX_MIGRATION_CONTRACTS.map(({ fileName }) => fileName);
  const expectedSupabaseEntries = expectedAppEntries.map((fileName) => fileName.replace(/\.sql$/u, ''));
  const app = await client.query(`
    /* case_vortex_approved_migration_execution:post_apply_app_ledger */
    SELECT id FROM public.schema_migrations
    WHERE id = ANY($1::text[]) ORDER BY id
  `, [expectedAppEntries]);
  const supabase = await client.query(`
    /* case_vortex_approved_migration_execution:post_apply_supabase_ledger */
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version = ANY($1::text[]) ORDER BY version
  `, [expectedSupabaseEntries]);
  const actualAppEntries = app.rows.map((row) => String(row.id)).sort();
  const actualSupabaseEntries = supabase.rows.map((row) => String(row.version)).sort();
  if (relationshipInputSha256(actualAppEntries) !== relationshipInputSha256([...expectedAppEntries].sort())
    || relationshipInputSha256(actualSupabaseEntries)
      !== relationshipInputSha256([...expectedSupabaseEntries].sort())) {
    throw new Error('case_vortex_migration_execution_post_apply_ledger_drift');
  }

  const active = await client.query(`
    /* case_vortex_approved_migration_execution:post_apply_active_publication */
    SELECT count(*)::integer AS count
    FROM public.uap_case_graph_publications WHERE active = true
  `);
  if (Number(active.rows[0]?.count || 0) !== 0) {
    throw new Error('case_vortex_migration_execution_post_apply_publication_drift');
  }
  const verifiedSignatureState = Object.fromEntries(
    [...CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS].sort().map((key) => [key, true]),
  );
  return {
    schemaSignatureCount: CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS.length,
    schemaSignatureSetSha256: relationshipInputSha256(verifiedSignatureState),
    appTrackerCount: actualAppEntries.length,
    supabaseTrackerCount: actualSupabaseEntries.length,
    activePublicationCount: 0 as const,
  };
};

export const mirrorCaseVortexMigrationTrackers = async (
  client: CaseVortexMigrationExecutionClient,
  migration: PreparedMigration,
) => {
  await client.query(
    'INSERT INTO public.schema_migrations (id) VALUES ($1)',
    [migration.fileName],
  );
  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ($1, $1, $2::text[])
  `, [migration.fileName.replace(/\.sql$/u, ''), migration.statements]);
};

export const executeApprovedCaseVortexMigrationPlan = async (
  input: {
    approval: unknown;
    expectedApprovalSha256: string;
    verifiedRehearsalReceiptSha256: string;
  },
  dependencies: Dependencies,
) => {
  const approval: CaseVortexMigrationExecutionApproval = assertApproval(input);
  // All files are read and byte-verified before a client is acquired or a
  // database statement can execute.
  const migrations = await prepareCaseVortexMigrations(dependencies);
  if (relationshipInputSha256(migrations.map(({ fileName }) => fileName))
    !== relationshipInputSha256(approval.plannedMigrations)) {
    throw new Error('case_vortex_migration_execution_plan_mismatch');
  }
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  const client = await dependencies.getClient();
  const lockId = dependencies.advisoryLockId ?? 93750232;
  let lockAcquired = false;
  let failureStage: CaseVortexMigrationExecutionFailureReceipt['failureStage'] = 'advisory_lock';
  let currentMigration: PreparedMigration | null = null;
  let completedStatementCountInFailedMigration = 0;
  let currentTransactionRolledBack = false;
  const applied: Array<{
    version: string;
    fileName: string;
    sha256: string;
    statementCount: number;
    transactionMode: PreparedMigration['transactionMode'];
  }> = [];
  let postApplyVerification: CaseVortexMigrationExecutionReceipt['postApplyVerification'] | null = null;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockId]);
    if (!truthy(lock.rows[0]?.locked)) {
      throw new Error('case_vortex_migration_execution_lock_unavailable');
    }
    lockAcquired = true;
    failureStage = 'remote_boundary';
    await assertRemoteStillAtApprovedBoundary(client, approval.plannedMigrations);
    for (const migration of migrations) {
      currentMigration = migration;
      completedStatementCountInFailedMigration = 0;
      currentTransactionRolledBack = false;
      if (migration.transactionMode === 'autocommit-per-statement') {
        for (const statement of migration.statements) {
          failureStage = 'migration_statement';
          await removeInvalidCaseVortexConcurrentIndexTarget(client, statement);
          await client.query(statement);
          completedStatementCountInFailedMigration += 1;
        }
        failureStage = 'tracker_write';
        await mirrorCaseVortexMigrationTrackers(client, migration);
      } else {
        failureStage = 'transaction_begin';
        await client.query('BEGIN');
        try {
          for (const statement of caseVortexTransactionalStatements(migration)) {
            failureStage = 'migration_statement';
            await client.query(statement);
            completedStatementCountInFailedMigration += 1;
          }
          failureStage = 'tracker_write';
          await mirrorCaseVortexMigrationTrackers(client, migration);
          failureStage = 'transaction_commit';
          await client.query('COMMIT');
        } catch (error) {
          try {
            await client.query('ROLLBACK');
            currentTransactionRolledBack = true;
            completedStatementCountInFailedMigration = 0;
          } catch (rollbackError) {
            failureStage = 'transaction_rollback';
            throw rollbackError;
          }
          throw error;
        }
      }
      applied.push({
        version: migration.version,
        fileName: migration.fileName,
        sha256: migration.sha256,
        statementCount: migration.statements.length,
        transactionMode: migration.transactionMode,
      });
    }
    currentMigration = null;
    completedStatementCountInFailedMigration = 0;
    currentTransactionRolledBack = false;
    failureStage = 'post_apply_verification';
    postApplyVerification = await assertCaseVortexMigrationPostconditions(client);
  } catch (error) {
    const databaseMayBePartiallyMutated = applied.length > 0
      || (currentMigration?.transactionMode === 'autocommit-per-statement'
        && (completedStatementCountInFailedMigration > 0
          || failureStage === 'migration_statement'));
    const withoutDigest: Omit<CaseVortexMigrationExecutionFailureReceipt, 'receiptSha256'> = {
      recordType: 'case_vortex_migration_execution_failure_receipt',
      schemaVersion: CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION,
      approvalId: approval.approvalId,
      approvalSha256: approval.approvalSha256,
      rehearsalReceiptSha256: input.verifiedRehearsalReceiptSha256,
      startedAt,
      failedAt: now().toISOString(),
      failureStage,
      failedVersion: currentMigration?.version || null,
      failedFileName: currentMigration?.fileName || null,
      completedStatementCountInFailedMigration,
      currentTransactionRolledBack,
      applied: [...applied],
      databaseMayBePartiallyMutated,
      reconciliationRequired: databaseMayBePartiallyMutated,
      causeSha256: sha256(error instanceof Error ? `${error.name}:${error.message}` : String(error)),
      publicationActivations: 0,
      deployments: 0,
    };
    const receipt = {
      ...withoutDigest,
      receiptSha256: relationshipInputSha256(withoutDigest),
    };
    throw new CaseVortexMigrationExecutionFailure(
      error instanceof Error ? error.message : String(error), receipt,
    );
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => undefined);
    }
    await client.release();
  }
  const completedAt = now().toISOString();
  if (!postApplyVerification) {
    throw new Error('case_vortex_migration_execution_post_apply_verification_missing');
  }
  const withoutDigest = {
    recordType: 'case_vortex_migration_execution_receipt' as const,
    schemaVersion: CASE_VORTEX_MIGRATION_EXECUTION_RECEIPT_VERSION,
    approvalId: approval.approvalId,
    approvalSha256: approval.approvalSha256,
    rehearsalReceiptSha256: input.verifiedRehearsalReceiptSha256,
    startedAt,
    completedAt,
    applied,
    postApplyVerification,
    publicationActivations: 0 as const,
    deployments: 0 as const,
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};
