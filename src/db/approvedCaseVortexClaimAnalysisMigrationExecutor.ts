import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  verifyCaseVortexClaimAnalysisMigrationApproval,
  type CaseVortexClaimAnalysisMigrationApproval,
} from '../caseGraph/claimAnalysisMigrationApproval';
import { relationshipInputSha256 } from '../caseGraph/relationshipInputSnapshot';
import {
  CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS,
  inspectCaseVortexClaimAnalysisMigrationSignatures,
} from '../cli/buildCaseVortexClaimAnalysisMigrationRehearsal';
import {
  caseVortexTransactionalStatements,
  mirrorCaseVortexMigrationTrackers,
  type CaseVortexMigrationExecutionClient,
  type PreparedCaseVortexMigration,
} from './approvedCaseVortexMigrationExecutor';
import { splitSqlStatements } from './sqlStatementSplitter';

export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECEIPT_VERSION =
  'case-vortex-claim-analysis-migration-receipt-v1' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_FAILURE_RECEIPT_VERSION =
  'case-vortex-claim-analysis-migration-failure-receipt-v1' as const;

type Dependencies = {
  getClient: () => Promise<CaseVortexMigrationExecutionClient>;
  readMigration?: (filePath: string) => Promise<Buffer>;
  migrationsDir?: string;
  now?: () => Date;
  advisoryLockId?: number;
};

type AppliedMigration = {
  version: string;
  fileName: string;
  sha256: string;
  statementCount: number;
  transactionMode: 'single-transaction';
};

type FailureStage = 'advisory_lock' | 'remote_boundary' | 'transaction_begin'
  | 'migration_statement' | 'tracker_write' | 'transaction_commit'
  | 'transaction_rollback' | 'post_apply_verification';

export type CaseVortexClaimAnalysisMigrationPostApplyVerification = {
  schemaSignatureCount: 2;
  schemaSignatureSetSha256: string;
  appTrackerCount: 2;
  supabaseTrackerCount: 2;
  activePublicationCount: 0;
};

export type CaseVortexClaimAnalysisMigrationReceipt = {
  recordType: 'case_vortex_claim_analysis_migration_receipt';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECEIPT_VERSION;
  approvalId: string;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  completedAt: string;
  applied: AppliedMigration[];
  postApplyVerification: CaseVortexClaimAnalysisMigrationPostApplyVerification;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

export type CaseVortexClaimAnalysisMigrationFailureReceipt = {
  recordType: 'case_vortex_claim_analysis_migration_failure_receipt';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_FAILURE_RECEIPT_VERSION;
  approvalId: string;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  failedAt: string;
  failureStage: FailureStage;
  failedVersion: string | null;
  failedFileName: string | null;
  applied: AppliedMigration[];
  currentTransactionRolledBack: boolean;
  databaseMayBePartiallyMutated: boolean;
  reconciliationRequired: boolean;
  causeSha256: string;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

export class CaseVortexClaimAnalysisMigrationExecutionFailure extends Error {
  readonly receipt: CaseVortexClaimAnalysisMigrationFailureReceipt;

  constructor(message: string, receipt: CaseVortexClaimAnalysisMigrationFailureReceipt) {
    super(message);
    this.name = 'CaseVortexClaimAnalysisMigrationExecutionFailure';
    this.receipt = receipt;
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const truthy = (value: unknown) => value === true || value === 't';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const stem = (fileName: string) => fileName.replace(/\.sql$/u, '');
const invalid = (): never => {
  throw new Error('case_vortex_claim_analysis_migration_receipt_invalid');
};

const timestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40) invalid();
  try {
    if (new Date(value as string).toISOString() !== value) invalid();
  } catch {
    invalid();
  }
  return value as string;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) invalid();
};

const prepare = async (dependencies: Dependencies): Promise<PreparedCaseVortexMigration[]> => {
  const migrationsDir = dependencies.migrationsDir
    || path.join(process.cwd(), 'src', 'db', 'migrations');
  const readMigration = dependencies.readMigration || readFile;
  return Promise.all(CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(async (contract) => {
    const bytes = await readMigration(path.join(migrationsDir, contract.fileName));
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== contract.sha256) {
      throw new Error(`case_vortex_claim_analysis_migration_digest_mismatch:${contract.version}`);
    }
    const sql = bytes.toString('utf8');
    const statements = splitSqlStatements(sql);
    if (!statements.length || statements.some((statement) => /\bCONCURRENTLY\b/iu.test(statement))) {
      throw new Error(`case_vortex_claim_analysis_migration_boundary_drift:${contract.version}`);
    }
    const migration: PreparedCaseVortexMigration = {
      version: contract.version,
      fileName: contract.fileName,
      sql,
      statements,
      transactionMode: 'single-transaction',
      sha256: actualSha256,
    };
    caseVortexTransactionalStatements(migration);
    return migration;
  }));
};

const assertApproval = (input: {
  approval: unknown;
  expectedApprovalSha256: string;
  verifiedRehearsalReceiptSha256: string;
}) => {
  const approval = verifyCaseVortexClaimAnalysisMigrationApproval(input.approval);
  if (approval.approvalSha256 !== input.expectedApprovalSha256) {
    throw new Error('case_vortex_claim_analysis_migration_approval_sha_mismatch');
  }
  if (approval.rehearsalReceiptSha256 !== input.verifiedRehearsalReceiptSha256) {
    throw new Error('case_vortex_claim_analysis_migration_rehearsal_receipt_mismatch');
  }
  return approval;
};

const assertBoundary = async (
  client: CaseVortexMigrationExecutionClient,
  approval: CaseVortexClaimAnalysisMigrationApproval,
) => {
  const catalog = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:boundary_catalog */
    SELECT current_setting('server_version_num')::integer AS server_version_num,
      to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
      to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase_tracker_present,
      to_regclass('public.case_vortex_luna_turns') IS NOT NULL AS turns_present,
      to_regclass('public.uap_case_graph_publications') IS NOT NULL AS publications_present
  `);
  const row = catalog.rows[0] || {};
  if (Number(row.server_version_num || 0) < 170000
    || !truthy(row.app_tracker_present)
    || !truthy(row.supabase_tracker_present)
    || !truthy(row.turns_present)
    || !truthy(row.publications_present)) {
    throw new Error('case_vortex_claim_analysis_migration_remote_boundary_invalid');
  }
  const expectedFiles = approval.plannedMigrations;
  const app = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:boundary_app_ledger */
    SELECT id FROM public.schema_migrations
    WHERE id = ANY($1::text[]) OR id = $2
    ORDER BY id
  `, [expectedFiles, '0213_case_vortex_saved_report_replay_2026_07_22.sql']);
  const supabase = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:boundary_supabase_ledger */
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version = ANY($1::text[]) OR version = $2
    ORDER BY version
  `, [
    expectedFiles.map(stem),
    '0213_case_vortex_saved_report_replay_2026_07_22',
  ]);
  const appIds = app.rows.map((entry) => String(entry.id));
  const supabaseIds = supabase.rows.map((entry) => String(entry.version));
  if (relationshipInputSha256(appIds)
      !== relationshipInputSha256(['0213_case_vortex_saved_report_replay_2026_07_22.sql'])
    || relationshipInputSha256(supabaseIds)
      !== relationshipInputSha256(['0213_case_vortex_saved_report_replay_2026_07_22'])) {
    throw new Error('case_vortex_claim_analysis_migration_ledger_boundary_drift');
  }
  const signatures = await inspectCaseVortexClaimAnalysisMigrationSignatures(
    client.query.bind(client),
  );
  if (Object.values(signatures).some(Boolean)) {
    throw new Error('case_vortex_claim_analysis_migration_schema_boundary_drift');
  }
  const active = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:boundary_active_publication */
    SELECT count(*)::integer AS count
    FROM public.uap_case_graph_publications WHERE active = true
  `);
  if (Number(active.rows[0]?.count || 0) !== 0) {
    throw new Error('case_vortex_claim_analysis_migration_active_publication');
  }
};

export const assertCaseVortexClaimAnalysisMigrationPostconditions = async (
  client: CaseVortexMigrationExecutionClient,
): Promise<CaseVortexClaimAnalysisMigrationPostApplyVerification> => {
  const signatures = await inspectCaseVortexClaimAnalysisMigrationSignatures(
    client.query.bind(client),
  );
  const expectedSignatures = Object.fromEntries(
    CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(({ signature }) => [signature, true]),
  );
  if (relationshipInputSha256(signatures) !== relationshipInputSha256(expectedSignatures)) {
    throw new Error('case_vortex_claim_analysis_migration_post_apply_schema_drift');
  }
  const files = CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(({ fileName }) => fileName);
  const app = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:post_apply_app_ledger */
    SELECT id FROM public.schema_migrations WHERE id = ANY($1::text[]) ORDER BY id
  `, [files]);
  const supabase = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:post_apply_supabase_ledger */
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version = ANY($1::text[]) ORDER BY version
  `, [files.map(stem)]);
  const appIds = app.rows.map((entry) => String(entry.id));
  const supabaseIds = supabase.rows.map((entry) => String(entry.version));
  if (relationshipInputSha256(appIds) !== relationshipInputSha256([...files].sort())
    || relationshipInputSha256(supabaseIds)
      !== relationshipInputSha256(files.map(stem).sort())) {
    throw new Error('case_vortex_claim_analysis_migration_post_apply_ledger_drift');
  }
  const active = await client.query(`
    /* case_vortex_claim_analysis_migration_execution:post_apply_active_publication */
    SELECT count(*)::integer AS count
    FROM public.uap_case_graph_publications WHERE active = true
  `);
  if (Number(active.rows[0]?.count || 0) !== 0) {
    throw new Error('case_vortex_claim_analysis_migration_post_apply_publication_drift');
  }
  return {
    schemaSignatureCount: 2,
    schemaSignatureSetSha256: relationshipInputSha256(expectedSignatures),
    appTrackerCount: 2,
    supabaseTrackerCount: 2,
    activePublicationCount: 0,
  };
};

const verifyApplied = (value: unknown, complete: boolean): AppliedMigration[] => {
  if (!Array.isArray(value)
    || value.length > CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.length
    || (complete && value.length !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.length)) {
    invalid();
  }
  return (value as unknown[]).map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid();
    const record = entry as Record<string, unknown>;
    exactKeys(record, ['version', 'fileName', 'sha256', 'statementCount', 'transactionMode']);
    const contract = CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS[index];
    if (!contract || record.version !== contract.version || record.fileName !== contract.fileName
      || record.sha256 !== contract.sha256 || record.transactionMode !== 'single-transaction'
      || !Number.isSafeInteger(record.statementCount) || Number(record.statementCount) < 1) invalid();
    return {
      version: contract.version,
      fileName: contract.fileName,
      sha256: contract.sha256,
      statementCount: Number(record.statementCount),
      transactionMode: 'single-transaction' as const,
    };
  });
};

export const verifyCaseVortexClaimAnalysisMigrationReceipt = (
  value: unknown,
): CaseVortexClaimAnalysisMigrationReceipt | CaseVortexClaimAnalysisMigrationFailureReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const candidate = value as Record<string, unknown>;
  const success = candidate.recordType === 'case_vortex_claim_analysis_migration_receipt';
  const failure = candidate.recordType === 'case_vortex_claim_analysis_migration_failure_receipt';
  if (!success && !failure) invalid();
  const common = [
    'recordType', 'schemaVersion', 'approvalId', 'approvalSha256',
    'rehearsalReceiptSha256', 'startedAt', 'applied',
    'publicationActivations', 'deployments', 'receiptSha256',
  ];
  exactKeys(candidate, success
    ? [...common, 'completedAt', 'postApplyVerification']
    : [...common, 'failedAt', 'failureStage', 'failedVersion', 'failedFileName',
      'currentTransactionRolledBack', 'databaseMayBePartiallyMutated',
      'reconciliationRequired', 'causeSha256']);
  if (!UUID.test(String(candidate.approvalId || ''))
    || !SHA256.test(String(candidate.approvalSha256 || ''))
    || !SHA256.test(String(candidate.rehearsalReceiptSha256 || ''))
    || !SHA256.test(String(candidate.receiptSha256 || ''))
    || candidate.publicationActivations !== 0 || candidate.deployments !== 0) invalid();
  const startedAt = timestamp(candidate.startedAt);
  const applied = verifyApplied(candidate.applied, success);
  const { receiptSha256, ...withoutDigest } = candidate;
  if (relationshipInputSha256(withoutDigest) !== receiptSha256) invalid();
  if (success) {
    if (candidate.schemaVersion !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECEIPT_VERSION
      || timestamp(candidate.completedAt) < startedAt) invalid();
    const post = candidate.postApplyVerification as Record<string, unknown>;
    exactKeys(post, [
      'schemaSignatureCount', 'schemaSignatureSetSha256', 'appTrackerCount',
      'supabaseTrackerCount', 'activePublicationCount',
    ]);
    const expectedSignatures = Object.fromEntries(
      CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(({ signature }) => [signature, true]),
    );
    if (post.schemaSignatureCount !== 2
      || post.schemaSignatureSetSha256 !== relationshipInputSha256(expectedSignatures)
      || post.appTrackerCount !== 2 || post.supabaseTrackerCount !== 2
      || post.activePublicationCount !== 0) invalid();
    return candidate as unknown as CaseVortexClaimAnalysisMigrationReceipt;
  }
  if (candidate.schemaVersion !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_FAILURE_RECEIPT_VERSION
    || ![
      'advisory_lock', 'remote_boundary', 'transaction_begin', 'migration_statement',
      'tracker_write', 'transaction_commit', 'transaction_rollback', 'post_apply_verification',
    ].includes(String(candidate.failureStage))
    || !SHA256.test(String(candidate.causeSha256 || ''))
    || timestamp(candidate.failedAt) < startedAt
    || typeof candidate.currentTransactionRolledBack !== 'boolean'
    || typeof candidate.databaseMayBePartiallyMutated !== 'boolean'
    || typeof candidate.reconciliationRequired !== 'boolean'
    || candidate.databaseMayBePartiallyMutated !== (applied.length > 0)
    || candidate.reconciliationRequired !== (applied.length > 0)) invalid();
  return candidate as unknown as CaseVortexClaimAnalysisMigrationFailureReceipt;
};

export const executeApprovedCaseVortexClaimAnalysisMigrationPlan = async (
  input: {
    approval: unknown;
    expectedApprovalSha256: string;
    verifiedRehearsalReceiptSha256: string;
  },
  dependencies: Dependencies,
) => {
  const approval = assertApproval(input);
  const migrations = await prepare(dependencies);
  if (relationshipInputSha256(migrations.map(({ fileName }) => fileName))
    !== relationshipInputSha256(approval.plannedMigrations)) {
    throw new Error('case_vortex_claim_analysis_migration_plan_mismatch');
  }
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  const client = await dependencies.getClient();
  const lockId = dependencies.advisoryLockId ?? 93750234;
  let lockAcquired = false;
  let stage: FailureStage = 'advisory_lock';
  let current: PreparedCaseVortexMigration | null = null;
  let rolledBack = false;
  const applied: AppliedMigration[] = [];
  let postApplyVerification: CaseVortexClaimAnalysisMigrationPostApplyVerification | null = null;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockId]);
    if (!truthy(lock.rows[0]?.locked)) {
      throw new Error('case_vortex_claim_analysis_migration_lock_unavailable');
    }
    lockAcquired = true;
    stage = 'remote_boundary';
    await assertBoundary(client, approval);
    for (const migration of migrations) {
      current = migration;
      rolledBack = false;
      stage = 'transaction_begin';
      await client.query('BEGIN');
      try {
        for (const statement of caseVortexTransactionalStatements(migration)) {
          stage = 'migration_statement';
          await client.query(statement);
        }
        stage = 'tracker_write';
        await mirrorCaseVortexMigrationTrackers(client, migration);
        stage = 'transaction_commit';
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
          rolledBack = true;
        } catch (rollbackError) {
          stage = 'transaction_rollback';
          throw rollbackError;
        }
        throw error;
      }
      applied.push({
        version: migration.version,
        fileName: migration.fileName,
        sha256: migration.sha256,
        statementCount: migration.statements.length,
        transactionMode: 'single-transaction',
      });
    }
    current = null;
    rolledBack = false;
    stage = 'post_apply_verification';
    postApplyVerification = await assertCaseVortexClaimAnalysisMigrationPostconditions(client);
  } catch (error) {
    const databaseMayBePartiallyMutated = applied.length > 0;
    const withoutDigest: Omit<CaseVortexClaimAnalysisMigrationFailureReceipt, 'receiptSha256'> = {
      recordType: 'case_vortex_claim_analysis_migration_failure_receipt',
      schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_FAILURE_RECEIPT_VERSION,
      approvalId: approval.approvalId,
      approvalSha256: approval.approvalSha256,
      rehearsalReceiptSha256: input.verifiedRehearsalReceiptSha256,
      startedAt,
      failedAt: now().toISOString(),
      failureStage: stage,
      failedVersion: current?.version || null,
      failedFileName: current?.fileName || null,
      applied: [...applied],
      currentTransactionRolledBack: rolledBack,
      databaseMayBePartiallyMutated,
      reconciliationRequired: databaseMayBePartiallyMutated,
      causeSha256: sha256(error instanceof Error ? `${error.name}:${error.message}` : String(error)),
      publicationActivations: 0,
      deployments: 0,
    };
    const receipt = { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
    throw new CaseVortexClaimAnalysisMigrationExecutionFailure(
      error instanceof Error ? error.message : String(error),
      receipt,
    );
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => undefined);
    }
    await client.release();
  }
  if (!postApplyVerification) {
    throw new Error('case_vortex_claim_analysis_migration_post_apply_verification_missing');
  }
  const withoutDigest: Omit<CaseVortexClaimAnalysisMigrationReceipt, 'receiptSha256'> = {
    recordType: 'case_vortex_claim_analysis_migration_receipt',
    schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECEIPT_VERSION,
    approvalId: approval.approvalId,
    approvalSha256: approval.approvalSha256,
    rehearsalReceiptSha256: input.verifiedRehearsalReceiptSha256,
    startedAt,
    completedAt: now().toISOString(),
    applied,
    postApplyVerification,
    publicationActivations: 0,
    deployments: 0,
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};
