import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  verifyCaseVortexClaimAnalysisMigrationRecoveryApproval,
  type CaseVortexClaimAnalysisMigrationRecoveryApproval,
} from '../caseGraph/claimAnalysisMigrationRecoveryApproval';
import type { CaseVortexClaimAnalysisMigrationRecoveryPlan } from '../caseGraph/claimAnalysisMigrationRecoveryPlan';
import { relationshipInputSha256 } from '../caseGraph/relationshipInputSnapshot';
import {
  CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS,
  inspectCaseVortexClaimAnalysisMigrationSignatures,
  type runCaseVortexClaimAnalysisMigrationRehearsalCli,
} from '../cli/buildCaseVortexClaimAnalysisMigrationRehearsal';
import {
  assertCaseVortexClaimAnalysisMigrationPostconditions,
  type CaseVortexClaimAnalysisMigrationPostApplyVerification,
} from './approvedCaseVortexClaimAnalysisMigrationExecutor';
import {
  caseVortexTransactionalStatements,
  type CaseVortexMigrationExecutionClient,
  type PreparedCaseVortexMigration,
} from './approvedCaseVortexMigrationExecutor';
import { splitSqlStatements } from './sqlStatementSplitter';

export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_RECEIPT_VERSION =
  'case-vortex-claim-analysis-migration-recovery-receipt-v1' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_FAILURE_RECEIPT_VERSION =
  'case-vortex-claim-analysis-migration-recovery-failure-receipt-v1' as const;

type Rehearsal = Exclude<
  Awaited<ReturnType<typeof runCaseVortexClaimAnalysisMigrationRehearsalCli>>,
  { usage: string }
>;
type Dependencies = {
  getClient: () => Promise<CaseVortexMigrationExecutionClient>;
  readMigration?: (filePath: string) => Promise<Buffer>;
  migrationsDir?: string;
  now?: () => Date;
  advisoryLockId?: number;
};
type AppliedAction = {
  ordinal: number;
  version: string;
  fileName: string;
  sha256: string;
  statementCount: number;
  appTrackerWrites: 0;
  supabaseTrackerWrites: 1;
};
type FailureStage = 'advisory_lock' | 'remote_boundary' | 'transaction_begin'
  | 'migration_statement' | 'supabase_tracker_write' | 'transaction_commit'
  | 'transaction_rollback' | 'post_apply_verification';

export type CaseVortexClaimAnalysisMigrationRecoveryReceipt = {
  recordType: 'case_vortex_claim_analysis_migration_recovery_receipt';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_RECEIPT_VERSION;
  approvalId: string;
  approvalSha256: string;
  planSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  completedAt: string;
  appliedActions: AppliedAction[];
  postApplyVerification: CaseVortexClaimAnalysisMigrationPostApplyVerification;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};
export type CaseVortexClaimAnalysisMigrationRecoveryFailureReceipt = {
  recordType: 'case_vortex_claim_analysis_migration_recovery_failure_receipt';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_FAILURE_RECEIPT_VERSION;
  approvalId: string;
  approvalSha256: string;
  planSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  failedAt: string;
  failureStage: FailureStage;
  failedVersion: string | null;
  appliedActions: AppliedAction[];
  currentTransactionRolledBack: boolean;
  databaseMayBePartiallyMutated: boolean;
  reconciliationRequired: boolean;
  causeSha256: string;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

export class CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure extends Error {
  readonly receipt: CaseVortexClaimAnalysisMigrationRecoveryFailureReceipt;

  constructor(message: string, receipt: CaseVortexClaimAnalysisMigrationRecoveryFailureReceipt) {
    super(message);
    this.name = 'CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure';
    this.receipt = receipt;
  }
}

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const truthy = (value: unknown) => value === true || value === 't';
const stem = (fileName: string) => fileName.replace(/\.sql$/u, '');

const prepare = async (dependencies: Dependencies): Promise<PreparedCaseVortexMigration[]> => {
  const migrationsDir = dependencies.migrationsDir
    || path.join(process.cwd(), 'src', 'db', 'migrations');
  const readMigration = dependencies.readMigration || readFile;
  return Promise.all(CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(async (contract) => {
    const bytes = await readMigration(path.join(migrationsDir, contract.fileName));
    if (sha256(bytes) !== contract.sha256) {
      throw new Error(`case_vortex_claim_analysis_migration_recovery_digest_mismatch:${contract.version}`);
    }
    const statements = splitSqlStatements(bytes.toString('utf8'));
    const migration: PreparedCaseVortexMigration = {
      version: contract.version,
      fileName: contract.fileName,
      sha256: contract.sha256,
      sql: bytes.toString('utf8'),
      statements,
      transactionMode: 'single-transaction',
    };
    caseVortexTransactionalStatements(migration);
    return migration;
  }));
};

const assertBoundary = async (
  client: CaseVortexMigrationExecutionClient,
) => {
  const catalog = await client.query(`
    /* case_vortex_claim_analysis_recovery:boundary_catalog */
    SELECT current_setting('server_version_num')::integer AS server_version_num,
      to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
      to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase_tracker_present,
      to_regclass('public.case_vortex_luna_turns') IS NOT NULL AS turns_present,
      to_regclass('public.uap_case_graph_publications') IS NOT NULL AS publications_present
  `);
  const row = catalog.rows[0] || {};
  if (Number(row.server_version_num || 0) < 170000
    || !truthy(row.app_tracker_present) || !truthy(row.supabase_tracker_present)
    || !truthy(row.turns_present) || !truthy(row.publications_present)) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_boundary_invalid');
  }
  const files = CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(({ fileName }) => fileName);
  const app = await client.query(`
    /* case_vortex_claim_analysis_recovery:boundary_app_ledger */
    SELECT id FROM public.schema_migrations
    WHERE id = ANY($1::text[]) OR id = $2 ORDER BY id
  `, [files, '0213_case_vortex_saved_report_replay_2026_07_22.sql']);
  const supabase = await client.query(`
    /* case_vortex_claim_analysis_recovery:boundary_supabase_ledger */
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version = ANY($1::text[]) OR version = $2 ORDER BY version
  `, [
    files.map(stem),
    '0213_case_vortex_saved_report_replay_2026_07_22',
  ]);
  if (relationshipInputSha256(app.rows.map(({ id }) => String(id)))
      !== relationshipInputSha256([
        '0213_case_vortex_saved_report_replay_2026_07_22.sql',
        ...files,
      ])
    || relationshipInputSha256(supabase.rows.map(({ version }) => String(version)))
      !== relationshipInputSha256([
        '0213_case_vortex_saved_report_replay_2026_07_22',
      ])) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_ledger_drift');
  }
  const signatures = await inspectCaseVortexClaimAnalysisMigrationSignatures(
    client.query.bind(client),
  );
  if (signatures['function:save_case_vortex_luna_turn_allows_analyze_case_claims'] !== true
    || signatures.persistence_case_vortex_luna_turns_claim_analyses === true
    || signatures['persistence:case_vortex_luna_turns_claim_analyses'] !== false) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_schema_drift');
  }
  const active = await client.query(`
    /* case_vortex_claim_analysis_recovery:boundary_active_publication */
    SELECT count(*)::integer AS count
    FROM public.uap_case_graph_publications WHERE active = true
  `);
  if (Number(active.rows[0]?.count || 0) !== 0) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_active_publication');
  }
};

export const executeApprovedCaseVortexClaimAnalysisMigrationRecovery = async (
  input: {
    plan: CaseVortexClaimAnalysisMigrationRecoveryPlan;
    freshRehearsal: Rehearsal;
    approval: CaseVortexClaimAnalysisMigrationRecoveryApproval;
    expectedApprovalSha256: string;
    verifiedAt: string;
  },
  dependencies: Dependencies,
): Promise<CaseVortexClaimAnalysisMigrationRecoveryReceipt> => {
  const approval = verifyCaseVortexClaimAnalysisMigrationRecoveryApproval(input.approval, {
    plan: input.plan,
    freshRehearsal: input.freshRehearsal,
    verifiedAt: input.verifiedAt,
  });
  if (approval.approvalSha256 !== input.expectedApprovalSha256) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_approval_sha_mismatch');
  }
  const migrations = await prepare(dependencies);
  if (relationshipInputSha256(migrations.map(({ sha256 }) => sha256))
    !== relationshipInputSha256(input.plan.recoveryActions.map(({ sha256 }) => sha256))) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_plan_mismatch');
  }
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  const client = await dependencies.getClient();
  const appliedActions: AppliedAction[] = [];
  const stagedActions: AppliedAction[] = [];
  let current: PreparedCaseVortexMigration | null = null;
  let stage: FailureStage = 'advisory_lock';
  let lockAcquired = false;
  let rolledBack = false;
  try {
    const lock = await client.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [dependencies.advisoryLockId ?? 93750235],
    );
    if (!truthy(lock.rows[0]?.locked)) {
      throw new Error('case_vortex_claim_analysis_migration_recovery_lock_unavailable');
    }
    lockAcquired = true;
    stage = 'remote_boundary';
    await assertBoundary(client);
    stage = 'transaction_begin';
    await client.query('BEGIN');
    for (const [ordinal, migration] of migrations.entries()) {
      current = migration;
      for (const statement of caseVortexTransactionalStatements(migration)) {
        stage = 'migration_statement';
        await client.query(statement);
      }
      stage = 'supabase_tracker_write';
      await client.query(`
        INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
        VALUES ($1, $1, $2::text[])
      `, [stem(migration.fileName), migration.statements]);
      stagedActions.push({
        ordinal,
        version: migration.version,
        fileName: migration.fileName,
        sha256: migration.sha256,
        statementCount: migration.statements.length,
        appTrackerWrites: 0,
        supabaseTrackerWrites: 1,
      });
    }
    stage = 'transaction_commit';
    await client.query('COMMIT');
    appliedActions.push(...stagedActions);
    current = null;
    stage = 'post_apply_verification';
    const postApplyVerification =
      await assertCaseVortexClaimAnalysisMigrationPostconditions(client);
    const withoutDigest:
      Omit<CaseVortexClaimAnalysisMigrationRecoveryReceipt, 'receiptSha256'> = {
        recordType: 'case_vortex_claim_analysis_migration_recovery_receipt',
        schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_RECEIPT_VERSION,
        approvalId: approval.approvalId,
        approvalSha256: approval.approvalSha256,
        planSha256: input.plan.planSha256,
        rehearsalReceiptSha256: input.freshRehearsal.receiptSha256,
        startedAt,
        completedAt: now().toISOString(),
        appliedActions,
        postApplyVerification,
        publicationActivations: 0,
        deployments: 0,
      };
    return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
  } catch (error) {
    const commitOutcomeUnknown = stage === 'transaction_commit';
    if (stage !== 'advisory_lock' && stage !== 'remote_boundary'
      && stage !== 'post_apply_verification') {
      try {
        await client.query('ROLLBACK');
        rolledBack = true;
        stagedActions.length = 0;
      } catch (rollbackError) {
        stage = 'transaction_rollback';
        error = rollbackError;
      }
    }
    const withoutDigest:
      Omit<CaseVortexClaimAnalysisMigrationRecoveryFailureReceipt, 'receiptSha256'> = {
        recordType: 'case_vortex_claim_analysis_migration_recovery_failure_receipt',
        schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_FAILURE_RECEIPT_VERSION,
        approvalId: approval.approvalId,
        approvalSha256: approval.approvalSha256,
        planSha256: input.plan.planSha256,
        rehearsalReceiptSha256: input.freshRehearsal.receiptSha256,
        startedAt,
        failedAt: now().toISOString(),
        failureStage: stage,
        failedVersion: current?.version || null,
        appliedActions,
        currentTransactionRolledBack: rolledBack,
        databaseMayBePartiallyMutated: commitOutcomeUnknown
          || stage === 'transaction_rollback' || appliedActions.length > 0,
        reconciliationRequired: commitOutcomeUnknown
          || stage === 'transaction_rollback' || appliedActions.length > 0,
        causeSha256: sha256(error instanceof Error ? `${error.name}:${error.message}` : String(error)),
        publicationActivations: 0,
        deployments: 0,
      };
    const receipt = { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
    throw new CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure(
      error instanceof Error ? error.message : String(error),
      receipt,
    );
  } finally {
    if (lockAcquired) {
      await client.query(
        'SELECT pg_advisory_unlock($1)',
        [dependencies.advisoryLockId ?? 93750235],
      ).catch(() => undefined);
    }
    await client.release();
  }
};

const RECEIPT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const RECEIPT_SHA256 = /^[a-f0-9]{64}$/u;
const EXPECTED_STATEMENT_COUNTS = [5, 8] as const;
const receiptInvalid = (): never => {
  throw new Error('case_vortex_claim_analysis_migration_recovery_receipt_invalid');
};
const receiptTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) receiptInvalid();
  try {
    if (new Date(value as string).toISOString() !== value) receiptInvalid();
  } catch {
    receiptInvalid();
  }
  return value as string;
};
const receiptObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) receiptInvalid();
  return value as Record<string, unknown>;
};
const receiptExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    receiptInvalid();
  }
};
const verifyReceiptActions = (value: unknown, complete: boolean): AppliedAction[] => {
  if (!Array.isArray(value) || value.length !== (complete ? 2 : 0)) receiptInvalid();
  return (value as unknown[]).map((entry, ordinal) => {
    const action = receiptObject(entry);
    receiptExactKeys(action, [
      'ordinal', 'version', 'fileName', 'sha256', 'statementCount',
      'appTrackerWrites', 'supabaseTrackerWrites',
    ]);
    const contract = CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS[ordinal];
    if (!contract || action.ordinal !== ordinal || action.version !== contract.version
      || action.fileName !== contract.fileName || action.sha256 !== contract.sha256
      || action.statementCount !== EXPECTED_STATEMENT_COUNTS[ordinal]
      || action.appTrackerWrites !== 0 || action.supabaseTrackerWrites !== 1) {
      receiptInvalid();
    }
    return action as unknown as AppliedAction;
  });
};

export const verifyCaseVortexClaimAnalysisMigrationRecoveryReceipt = (
  value: unknown,
): CaseVortexClaimAnalysisMigrationRecoveryReceipt
  | CaseVortexClaimAnalysisMigrationRecoveryFailureReceipt => {
  const candidate = receiptObject(value);
  const success = candidate.recordType
    === 'case_vortex_claim_analysis_migration_recovery_receipt';
  const failure = candidate.recordType
    === 'case_vortex_claim_analysis_migration_recovery_failure_receipt';
  if (!success && !failure) receiptInvalid();
  const common = [
    'recordType', 'schemaVersion', 'approvalId', 'approvalSha256', 'planSha256',
    'rehearsalReceiptSha256', 'startedAt', 'appliedActions',
    'publicationActivations', 'deployments', 'receiptSha256',
  ];
  receiptExactKeys(candidate, success
    ? [...common, 'completedAt', 'postApplyVerification']
    : [...common, 'failedAt', 'failureStage', 'failedVersion',
      'currentTransactionRolledBack', 'databaseMayBePartiallyMutated',
      'reconciliationRequired', 'causeSha256']);
  if (!RECEIPT_UUID.test(String(candidate.approvalId || ''))
    || !RECEIPT_SHA256.test(String(candidate.approvalSha256 || ''))
    || !RECEIPT_SHA256.test(String(candidate.planSha256 || ''))
    || !RECEIPT_SHA256.test(String(candidate.rehearsalReceiptSha256 || ''))
    || !RECEIPT_SHA256.test(String(candidate.receiptSha256 || ''))
    || candidate.publicationActivations !== 0 || candidate.deployments !== 0) {
    receiptInvalid();
  }
  const startedAt = receiptTimestamp(candidate.startedAt);
  const { receiptSha256, ...core } = candidate;
  if (relationshipInputSha256(core) !== receiptSha256) receiptInvalid();
  if (success) {
    if (candidate.schemaVersion
      !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_RECEIPT_VERSION
      || receiptTimestamp(candidate.completedAt) < startedAt) receiptInvalid();
    const actions = verifyReceiptActions(candidate.appliedActions, true);
    const post = receiptObject(candidate.postApplyVerification);
    receiptExactKeys(post, [
      'schemaSignatureCount', 'schemaSignatureSetSha256', 'appTrackerCount',
      'supabaseTrackerCount', 'activePublicationCount',
    ]);
    const expectedSignatures = Object.fromEntries(
      CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(
        ({ signature }) => [signature, true],
      ),
    );
    if (post.schemaSignatureCount !== 2
      || post.schemaSignatureSetSha256 !== relationshipInputSha256(expectedSignatures)
      || post.appTrackerCount !== 2 || post.supabaseTrackerCount !== 2
      || post.activePublicationCount !== 0) receiptInvalid();
    return {
      ...candidate,
      appliedActions: actions,
    } as unknown as CaseVortexClaimAnalysisMigrationRecoveryReceipt;
  }
  if (candidate.schemaVersion
    !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_FAILURE_RECEIPT_VERSION
    || ![
      'advisory_lock', 'remote_boundary', 'transaction_begin',
      'migration_statement', 'supabase_tracker_write', 'transaction_commit',
      'transaction_rollback', 'post_apply_verification',
    ].includes(String(candidate.failureStage))
    || !RECEIPT_SHA256.test(String(candidate.causeSha256 || ''))
    || receiptTimestamp(candidate.failedAt) < startedAt
    || typeof candidate.currentTransactionRolledBack !== 'boolean'
    || typeof candidate.databaseMayBePartiallyMutated !== 'boolean'
    || typeof candidate.reconciliationRequired !== 'boolean'
    || candidate.databaseMayBePartiallyMutated !== candidate.reconciliationRequired) {
    receiptInvalid();
  }
  const stage = candidate.failureStage as FailureStage;
  const postApplyFailure = stage === 'post_apply_verification';
  const actions = verifyReceiptActions(candidate.appliedActions, postApplyFailure);
  const preBoundary = stage === 'advisory_lock' || stage === 'remote_boundary';
  const uncertain = stage === 'transaction_commit'
    || stage === 'transaction_rollback' || postApplyFailure;
  const failedVersionValid = stage === 'transaction_begin'
    ? candidate.failedVersion === null
    : postApplyFailure
      ? candidate.failedVersion === null
      : stage === 'transaction_commit'
        ? candidate.failedVersion === '0215'
        : ['0214', '0215'].includes(String(candidate.failedVersion));
  if (preBoundary
    ? candidate.failedVersion !== null
      || candidate.currentTransactionRolledBack !== false
      || candidate.databaseMayBePartiallyMutated !== false
    : !failedVersionValid
      || candidate.databaseMayBePartiallyMutated !== uncertain
      || (!uncertain && candidate.currentTransactionRolledBack !== true)) {
    receiptInvalid();
  }
  return {
    ...candidate,
    appliedActions: actions,
  } as unknown as CaseVortexClaimAnalysisMigrationRecoveryFailureReceipt;
};
