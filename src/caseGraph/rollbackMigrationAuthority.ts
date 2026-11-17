import { createHash } from 'node:crypto';

import type { CaseVortexMigrationExecutionClient } from '../db/approvedCaseVortexMigrationExecutor';
import {
  caseVortexTransactionalStatements,
  mirrorCaseVortexMigrationTrackers,
  type PreparedCaseVortexMigration,
} from '../db/approvedCaseVortexMigrationExecutor';
import { splitSqlStatements } from '../db/sqlStatementSplitter';
import { inspectCaseVortexRollbackMigrationSignature } from '../cli/checkCaseVortexReadiness';
import { inspectCaseVortexRetainedInfluenceMigrationSignature } from '../cli/buildCaseVortexRetainedInfluenceMigrationRehearsal';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT = {
  version: '0217',
  fileName: '0217_case_vortex_publication_rollback_2026_07_26.sql',
  sha256: 'ef817f6068f1c9c7b09ab7bc35708e3374e4d613a98d45361c9ec92e9bf6c045',
  signature: 'publication_rollback:guard_function_privileges',
} as const;

export const CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT =
  'I explicitly approve applying only the frozen Case Vortex migration 0217 to the newly rehearsed database state. This does not approve a publication rollback, publication activation, R2 writes, Luna calls, or deployment.' as const;

export type CaseVortexRollbackMigrationState = {
  serverVersionNum: number;
  transactionReadOnly: boolean;
  appTrackerPresent: boolean;
  supabaseTrackerPresent: boolean;
  publicationsRelationPresent: boolean;
  baseAppTracked: boolean;
  baseSupabaseTracked: boolean;
  baseSignaturePresent: boolean;
  migrationAppTracked: boolean;
  migrationSupabaseTracked: boolean;
  migrationSignaturePresent: boolean;
  activePublicationCount: number;
};

export type CaseVortexRollbackMigrationRehearsal = {
  recordType: 'case_vortex_rollback_migration_rehearsal';
  schemaVersion: 'case-vortex-rollback-migration-rehearsal-v1';
  inspectedAt: string;
  localMigration: {
    version: '0217';
    fileName: typeof CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName;
    expectedSha256: typeof CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256;
    actualSha256: string;
    digestMatches: boolean;
    byteLength: number;
    statementCount: number;
    transactionMode: 'single-transaction';
  };
  remote: CaseVortexRollbackMigrationState;
  plannedMigrations: string[];
  readyForSeparateApproval: boolean;
  blockers: string[];
  approvalBoundary: {
    migrationApplicationApproved: false;
    publicationRollbackApproved: false;
    publicationActivationApproved: false;
    storageWriteApproved: false;
    lunaCallApproved: false;
    deploymentApproved: false;
    requiredBeforeAnyRemoteMutation: 'new_explicit_user_approval_for_0217_only';
  };
  guarantees: {
    databaseReads: 'bounded-read-only-transactions';
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  receiptSha256: string;
};

export type CaseVortexRollbackMigrationApproval = {
  recordType: 'case_vortex_rollback_migration_approval';
  schemaVersion: 'case-vortex-rollback-migration-approval-v1';
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: 'apply_case_vortex_migration_0217_only';
  rehearsalReceiptSha256: string;
  plannedMigrations: [typeof CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName];
  authorizationStatement: typeof CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT;
  publicationRollbackApproved: false;
  publicationActivationApproved: false;
  storageWriteApproved: false;
  lunaCallApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

type AppliedMigration = {
  version: '0217';
  fileName: typeof CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName;
  sha256: typeof CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256;
  statementCount: number;
  transactionMode: 'single-transaction';
};

export type CaseVortexRollbackMigrationReceipt = {
  recordType: 'case_vortex_rollback_migration_receipt';
  schemaVersion: 'case-vortex-rollback-migration-receipt-v1';
  approvalId: string;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  completedAt: string;
  applied: [AppliedMigration];
  postApplyVerification: {
    migrationSignaturePresent: true;
    appTrackerCount: 1;
    supabaseTrackerCount: 1;
    activePublicationCount: 0;
  };
  publicationRollbacks: 0;
  publicationActivations: 0;
  storageWrites: 0;
  lunaCalls: 0;
  deployments: 0;
  receiptSha256: string;
};

export type CaseVortexRollbackMigrationFailureReceipt = {
  recordType: 'case_vortex_rollback_migration_failure_receipt';
  schemaVersion: 'case-vortex-rollback-migration-failure-receipt-v1';
  approvalId: string;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  startedAt: string;
  failedAt: string;
  failureStage: 'advisory_lock' | 'remote_boundary' | 'transaction_begin'
    | 'migration_statement' | 'tracker_write' | 'transaction_commit'
    | 'transaction_rollback' | 'post_apply_verification';
  migrationCommitted: boolean;
  currentTransactionRolledBack: boolean;
  databaseMayBeMutated: boolean;
  reconciliationRequired: boolean;
  causeSha256: string;
  publicationRollbacks: 0;
  publicationActivations: 0;
  storageWrites: 0;
  lunaCalls: 0;
  deployments: 0;
  receiptSha256: string;
};

export class CaseVortexRollbackMigrationExecutionFailure extends Error {
  readonly receipt: CaseVortexRollbackMigrationFailureReceipt;

  constructor(message: string, receipt: CaseVortexRollbackMigrationFailureReceipt) {
    super(message);
    this.name = 'CaseVortexRollbackMigrationExecutionFailure';
    this.receipt = receipt;
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const BASE_FILE = '0216_case_vortex_retained_influence_search_2026_07_26.sql';
const stem = (value: string) => value.replace(/\.sql$/u, '');
const truthy = (value: unknown) => value === true || value === 't';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw new Error(code); };
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail('case_vortex_rollback_migration_artifact_invalid');
  }
};
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40) fail(code);
  try {
    if (new Date(value as string).toISOString() !== value) fail(code);
  } catch {
    fail(code);
  }
  return value as string;
};

export const inspectCaseVortexRollbackMigrationState = async (
  query: CaseVortexMigrationExecutionClient['query'],
): Promise<CaseVortexRollbackMigrationState> => {
  const catalog = await query(`
    /* case_vortex_rollback_migration_authority:catalog */
    SELECT current_setting('server_version_num')::integer AS server_version_num,
      current_setting('transaction_read_only') = 'on' AS transaction_read_only,
      to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
      to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
        AS supabase_tracker_present,
      to_regclass('public.uap_case_graph_publications') IS NOT NULL
        AS publications_relation_present
  `);
  const row = catalog.rows[0] || {};
  const appTrackerPresent = truthy(row.app_tracker_present);
  const supabaseTrackerPresent = truthy(row.supabase_tracker_present);
  const publicationsRelationPresent = truthy(row.publications_relation_present);
  const appRows = appTrackerPresent
    ? (await query(`
        SELECT id FROM public.schema_migrations
        WHERE id = ANY($1::text[]) ORDER BY id
      `, [[BASE_FILE, CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName]])).rows
    : [];
  const supabaseRows = supabaseTrackerPresent
    ? (await query(`
        SELECT version FROM supabase_migrations.schema_migrations
        WHERE version = ANY($1::text[]) ORDER BY version
      `, [[stem(BASE_FILE), stem(CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName)]])).rows
    : [];
  const app = new Set(appRows.map((entry) => String(entry.id)));
  const supabase = new Set(supabaseRows.map((entry) => String(entry.version)));
  const activePublicationCount = publicationsRelationPresent
    ? Number((await query(`
        SELECT count(*)::integer AS count
        FROM public.uap_case_graph_publications WHERE active = true
      `)).rows[0]?.count || 0)
    : 0;
  return {
    serverVersionNum: Number(row.server_version_num || 0),
    transactionReadOnly: truthy(row.transaction_read_only),
    appTrackerPresent,
    supabaseTrackerPresent,
    publicationsRelationPresent,
    baseAppTracked: app.has(BASE_FILE),
    baseSupabaseTracked: supabase.has(stem(BASE_FILE)),
    baseSignaturePresent: await inspectCaseVortexRetainedInfluenceMigrationSignature(query),
    migrationAppTracked: app.has(CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName),
    migrationSupabaseTracked: supabase.has(stem(
      CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
    )),
    migrationSignaturePresent: await inspectCaseVortexRollbackMigrationSignature(query),
    activePublicationCount,
  };
};

const stateBlockers = (
  state: CaseVortexRollbackMigrationState,
  requireReadOnly: boolean,
) => {
  const blockers: string[] = [];
  if (state.serverVersionNum < 170000) blockers.push('remote:postgres_17_required');
  if (requireReadOnly && !state.transactionReadOnly) blockers.push('remote:transaction_not_read_only');
  if (!state.appTrackerPresent) blockers.push('remote:app_migration_tracker_missing');
  if (!state.supabaseTrackerPresent) blockers.push('remote:supabase_migration_tracker_missing');
  if (!state.publicationsRelationPresent) blockers.push('remote:publications_relation_missing');
  if (state.baseAppTracked !== state.baseSupabaseTracked) {
    blockers.push('remote:base_tracker_disagreement:0216');
  } else if (!state.baseAppTracked) {
    blockers.push('remote:base_migration_0216_missing');
  } else if (!state.baseSignaturePresent) {
    blockers.push('remote:base_ledger_schema_drift:0216');
  }
  if (state.migrationAppTracked !== state.migrationSupabaseTracked) {
    blockers.push('remote:tracker_disagreement:0217');
  } else if (state.migrationAppTracked && !state.migrationSignaturePresent) {
    blockers.push('remote:ledger_schema_drift:0217');
  } else if (!state.migrationAppTracked && state.migrationSignaturePresent) {
    blockers.push('remote:untracked_schema:0217');
  } else if (state.migrationAppTracked) {
    blockers.push('remote:migration_0217_already_applied');
  }
  if (state.activePublicationCount !== 0) {
    blockers.push('remote:active_publication_must_be_zero');
  }
  return blockers;
};

export const buildCaseVortexRollbackMigrationRehearsal = (input: {
  inspectedAt: string;
  migrationBytes: Buffer;
  remote: CaseVortexRollbackMigrationState;
}): CaseVortexRollbackMigrationRehearsal => {
  const inspectedAt = timestamp(
    input.inspectedAt,
    'case_vortex_rollback_migration_rehearsal_timestamp_invalid',
  );
  const actualSha256 = sha256(input.migrationBytes);
  const digestMatches = actualSha256 === CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256;
  const statements = splitSqlStatements(input.migrationBytes.toString('utf8'));
  const blockers = stateBlockers(input.remote, true);
  if (!digestMatches) blockers.unshift('local:digest_mismatch:0217');
  if (!statements.length || statements.some((statement) => /\bCONCURRENTLY\b/iu.test(statement))) {
    blockers.unshift('local:transaction_boundary_invalid:0217');
  }
  const readyForSeparateApproval = blockers.length === 0;
  const body: Omit<CaseVortexRollbackMigrationRehearsal, 'receiptSha256'> = {
    recordType: 'case_vortex_rollback_migration_rehearsal',
    schemaVersion: 'case-vortex-rollback-migration-rehearsal-v1',
    inspectedAt,
    localMigration: {
      version: '0217',
      fileName: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
      expectedSha256: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256,
      actualSha256,
      digestMatches,
      byteLength: input.migrationBytes.byteLength,
      statementCount: statements.length,
      transactionMode: 'single-transaction',
    },
    remote: input.remote,
    plannedMigrations: readyForSeparateApproval
      ? [CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName] : [],
    readyForSeparateApproval,
    blockers,
    approvalBoundary: {
      migrationApplicationApproved: false,
      publicationRollbackApproved: false,
      publicationActivationApproved: false,
      storageWriteApproved: false,
      lunaCallApproved: false,
      deploymentApproved: false,
      requiredBeforeAnyRemoteMutation: 'new_explicit_user_approval_for_0217_only',
    },
    guarantees: {
      databaseReads: 'bounded-read-only-transactions',
      databaseWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      lunaCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

export const buildCaseVortexRollbackMigrationApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  rehearsal: CaseVortexRollbackMigrationRehearsal;
  authorizationStatement: string;
}): CaseVortexRollbackMigrationApproval => {
  if (!UUID.test(input.approvalId)) fail('case_vortex_rollback_migration_approval_id_invalid');
  if (!ID.test(input.approvedBy)) fail('case_vortex_rollback_migration_approval_identity_invalid');
  const approvedAt = timestamp(
    input.approvedAt,
    'case_vortex_rollback_migration_approval_timestamp_invalid',
  );
  if (!input.rehearsal.readyForSeparateApproval || input.rehearsal.blockers.length
    || input.authorizationStatement !== CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT) {
    fail('case_vortex_rollback_migration_approval_scope_invalid');
  }
  const body: Omit<CaseVortexRollbackMigrationApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_rollback_migration_approval',
    schemaVersion: 'case-vortex-rollback-migration-approval-v1',
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    scope: 'apply_case_vortex_migration_0217_only',
    rehearsalReceiptSha256: input.rehearsal.receiptSha256,
    plannedMigrations: [CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName],
    authorizationStatement: CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT,
    publicationRollbackApproved: false,
    publicationActivationApproved: false,
    storageWriteApproved: false,
    lunaCallApproved: false,
    deploymentApproved: false,
  };
  return { ...body, approvalSha256: relationshipInputSha256(body) };
};

export const verifyCaseVortexRollbackMigrationApproval = (
  value: unknown,
): CaseVortexRollbackMigrationApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_rollback_migration_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'scope', 'rehearsalReceiptSha256', 'plannedMigrations',
    'authorizationStatement', 'publicationRollbackApproved',
    'publicationActivationApproved', 'storageWriteApproved', 'lunaCallApproved',
    'deploymentApproved', 'approvalSha256',
  ];
  exactKeys(candidate, keys);
  if (candidate.recordType !== 'case_vortex_rollback_migration_approval'
    || candidate.schemaVersion !== 'case-vortex-rollback-migration-approval-v1'
    || candidate.scope !== 'apply_case_vortex_migration_0217_only'
    || !UUID.test(String(candidate.approvalId || ''))
    || !ID.test(String(candidate.approvedBy || ''))
    || !SHA256.test(String(candidate.rehearsalReceiptSha256 || ''))
    || !SHA256.test(String(candidate.approvalSha256 || ''))
    || relationshipInputSha256(candidate.plannedMigrations)
      !== relationshipInputSha256([CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName])
    || candidate.authorizationStatement !== CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT
    || candidate.publicationRollbackApproved !== false
    || candidate.publicationActivationApproved !== false
    || candidate.storageWriteApproved !== false
    || candidate.lunaCallApproved !== false
    || candidate.deploymentApproved !== false) {
    return fail('case_vortex_rollback_migration_approval_invalid');
  }
  timestamp(candidate.approvedAt, 'case_vortex_rollback_migration_approval_timestamp_invalid');
  const { approvalSha256, ...body } = candidate;
  if (relationshipInputSha256(body) !== approvalSha256) {
    return fail('case_vortex_rollback_migration_approval_derived_fields_invalid');
  }
  return candidate as unknown as CaseVortexRollbackMigrationApproval;
};

const prepareMigration = (bytes: Buffer): PreparedCaseVortexMigration => {
  if (sha256(bytes) !== CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256) {
    fail('case_vortex_rollback_migration_digest_mismatch:0217');
  }
  const statements = splitSqlStatements(bytes.toString('utf8'));
  const migration: PreparedCaseVortexMigration = {
    version: '0217',
    fileName: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
    sql: bytes.toString('utf8'),
    statements,
    transactionMode: 'single-transaction',
    sha256: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256,
  };
  if (!caseVortexTransactionalStatements(migration).length
    || statements.some((statement) => /\bCONCURRENTLY\b/iu.test(statement))) {
    fail('case_vortex_rollback_migration_boundary_drift:0217');
  }
  return migration;
};

export const executeApprovedCaseVortexRollbackMigration = async (input: {
  approval: unknown;
  expectedApprovalSha256: string;
  freshRehearsal: CaseVortexRollbackMigrationRehearsal;
  migrationBytes: Buffer;
  getClient: () => Promise<CaseVortexMigrationExecutionClient>;
  now?: () => Date;
  advisoryLockId?: number;
}): Promise<CaseVortexRollbackMigrationReceipt> => {
  const approval = verifyCaseVortexRollbackMigrationApproval(input.approval);
  if (approval.approvalSha256 !== input.expectedApprovalSha256
    || approval.rehearsalReceiptSha256 !== input.freshRehearsal.receiptSha256
    || !input.freshRehearsal.readyForSeparateApproval
    || input.freshRehearsal.blockers.length) {
    fail('case_vortex_rollback_migration_execution_approval_or_rehearsal_invalid');
  }
  const migration = prepareMigration(input.migrationBytes);
  const now = input.now || (() => new Date());
  const startedAt = now().toISOString();
  const client = await input.getClient();
  let lockAcquired = false;
  let failureStage: CaseVortexRollbackMigrationFailureReceipt['failureStage'] =
    'advisory_lock';
  let currentTransactionRolledBack = false;
  let migrationCommitted = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
      input.advisoryLockId ?? 93750217,
    ]);
    if (!truthy(lock.rows[0]?.locked)) {
      fail('case_vortex_rollback_migration_execution_lock_unavailable');
    }
    lockAcquired = true;
    failureStage = 'remote_boundary';
    const boundary = await inspectCaseVortexRollbackMigrationState(client.query.bind(client));
    const blockers = stateBlockers(boundary, false);
    if (blockers.length) {
      fail(`case_vortex_rollback_migration_execution_boundary_invalid:${blockers.join(',')}`);
    }
    failureStage = 'transaction_begin';
    await client.query('BEGIN');
    try {
      for (const statement of caseVortexTransactionalStatements(migration)) {
        failureStage = 'migration_statement';
        await client.query(statement);
      }
      failureStage = 'tracker_write';
      await mirrorCaseVortexMigrationTrackers(client, migration);
      failureStage = 'transaction_commit';
      await client.query('COMMIT');
      migrationCommitted = true;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
        currentTransactionRolledBack = true;
      } catch (rollbackError) {
        failureStage = 'transaction_rollback';
        throw rollbackError;
      }
      throw error;
    }
    failureStage = 'post_apply_verification';
    const signature = await inspectCaseVortexRollbackMigrationSignature(
      client.query.bind(client),
    );
    const post = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM public.schema_migrations
          WHERE id = $1) AS app_tracker_count,
        (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
          WHERE version = $2) AS supabase_tracker_count,
        (SELECT count(*)::integer FROM public.uap_case_graph_publications
          WHERE active = true) AS active_publication_count
    `, [
      CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
      stem(CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName),
    ]);
    const row = post.rows[0] || {};
    if (!signature || Number(row.app_tracker_count) !== 1
      || Number(row.supabase_tracker_count) !== 1
      || Number(row.active_publication_count) !== 0) {
      fail('case_vortex_rollback_migration_execution_postcondition_failed');
    }
    const body: Omit<CaseVortexRollbackMigrationReceipt, 'receiptSha256'> = {
      recordType: 'case_vortex_rollback_migration_receipt',
      schemaVersion: 'case-vortex-rollback-migration-receipt-v1',
      approvalId: approval.approvalId,
      approvalSha256: approval.approvalSha256,
      rehearsalReceiptSha256: input.freshRehearsal.receiptSha256,
      startedAt,
      completedAt: now().toISOString(),
      applied: [{
        version: '0217',
        fileName: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
        sha256: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256,
        statementCount: migration.statements.length,
        transactionMode: 'single-transaction',
      }],
      postApplyVerification: {
        migrationSignaturePresent: true,
        appTrackerCount: 1,
        supabaseTrackerCount: 1,
        activePublicationCount: 0,
      },
      publicationRollbacks: 0,
      publicationActivations: 0,
      storageWrites: 0,
      lunaCalls: 0,
      deployments: 0,
    };
    return { ...body, receiptSha256: relationshipInputSha256(body) };
  } catch (error) {
    const databaseMayBeMutated = migrationCommitted
      || ['transaction_commit', 'transaction_rollback', 'post_apply_verification']
        .includes(failureStage);
    const body: Omit<CaseVortexRollbackMigrationFailureReceipt, 'receiptSha256'> = {
      recordType: 'case_vortex_rollback_migration_failure_receipt',
      schemaVersion: 'case-vortex-rollback-migration-failure-receipt-v1',
      approvalId: approval.approvalId,
      approvalSha256: approval.approvalSha256,
      rehearsalReceiptSha256: input.freshRehearsal.receiptSha256,
      startedAt,
      failedAt: now().toISOString(),
      failureStage,
      migrationCommitted,
      currentTransactionRolledBack,
      databaseMayBeMutated,
      reconciliationRequired: databaseMayBeMutated,
      causeSha256: sha256(error instanceof Error ? error.message : String(error)),
      publicationRollbacks: 0,
      publicationActivations: 0,
      storageWrites: 0,
      lunaCalls: 0,
      deployments: 0,
    };
    const receipt = { ...body, receiptSha256: relationshipInputSha256(body) };
    throw new CaseVortexRollbackMigrationExecutionFailure(
      'case_vortex_rollback_migration_execution_failed',
      receipt,
    );
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [
        input.advisoryLockId ?? 93750217,
      ]).catch(() => undefined);
    }
    await client.release();
  }
};

export const verifyCaseVortexRollbackMigrationReceipt = (
  value: unknown,
): CaseVortexRollbackMigrationReceipt | CaseVortexRollbackMigrationFailureReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_rollback_migration_receipt_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const success = candidate.recordType === 'case_vortex_rollback_migration_receipt';
  const failure =
    candidate.recordType === 'case_vortex_rollback_migration_failure_receipt';
  if (!success && !failure) {
    return fail('case_vortex_rollback_migration_receipt_invalid');
  }
  const commonKeys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvalSha256',
    'rehearsalReceiptSha256', 'startedAt', 'publicationRollbacks',
    'publicationActivations', 'storageWrites', 'lunaCalls', 'deployments',
    'receiptSha256',
  ];
  exactKeys(candidate, success
    ? [...commonKeys, 'completedAt', 'applied', 'postApplyVerification']
    : [...commonKeys, 'failedAt', 'failureStage', 'migrationCommitted',
      'currentTransactionRolledBack', 'databaseMayBeMutated',
      'reconciliationRequired', 'causeSha256']);
  if (!UUID.test(String(candidate.approvalId || ''))
    || !SHA256.test(String(candidate.approvalSha256 || ''))
    || !SHA256.test(String(candidate.rehearsalReceiptSha256 || ''))
    || !SHA256.test(String(candidate.receiptSha256 || ''))
    || candidate.publicationRollbacks !== 0
    || candidate.publicationActivations !== 0
    || candidate.storageWrites !== 0
    || candidate.lunaCalls !== 0
    || candidate.deployments !== 0) {
    return fail('case_vortex_rollback_migration_receipt_invalid');
  }
  const startedAt = timestamp(
    candidate.startedAt,
    'case_vortex_rollback_migration_receipt_invalid',
  );
  const { receiptSha256, ...body } = candidate;
  if (relationshipInputSha256(body) !== receiptSha256) {
    fail('case_vortex_rollback_migration_receipt_invalid');
  }

  if (failure) {
    const stages = new Set<CaseVortexRollbackMigrationFailureReceipt['failureStage']>([
      'advisory_lock', 'remote_boundary', 'transaction_begin',
      'migration_statement', 'tracker_write', 'transaction_commit',
      'transaction_rollback', 'post_apply_verification',
    ]);
    const failedAt = timestamp(
      candidate.failedAt,
      'case_vortex_rollback_migration_receipt_invalid',
    );
    const stage = candidate.failureStage as
      CaseVortexRollbackMigrationFailureReceipt['failureStage'];
    if (candidate.schemaVersion !== 'case-vortex-rollback-migration-failure-receipt-v1'
      || failedAt < startedAt || !stages.has(stage)
      || typeof candidate.migrationCommitted !== 'boolean'
      || typeof candidate.currentTransactionRolledBack !== 'boolean'
      || typeof candidate.databaseMayBeMutated !== 'boolean'
      || typeof candidate.reconciliationRequired !== 'boolean'
      || !SHA256.test(String(candidate.causeSha256 || ''))) {
      return fail('case_vortex_rollback_migration_receipt_invalid');
    }
    const mayBeMutated = candidate.migrationCommitted === true
      || ['transaction_commit', 'transaction_rollback', 'post_apply_verification']
        .includes(stage);
    if (candidate.databaseMayBeMutated !== mayBeMutated
      || candidate.reconciliationRequired !== mayBeMutated
      || (candidate.currentTransactionRolledBack === true
        && !['migration_statement', 'tracker_write', 'transaction_commit']
          .includes(stage))) {
      return fail('case_vortex_rollback_migration_receipt_invalid');
    }
    return candidate as unknown as CaseVortexRollbackMigrationFailureReceipt;
  }

  const applied = candidate.applied;
  const post = candidate.postApplyVerification;
  if (candidate.schemaVersion !== 'case-vortex-rollback-migration-receipt-v1'
    || !Array.isArray(applied) || applied.length !== 1
    || relationshipInputSha256(applied[0]) !== relationshipInputSha256({
      version: '0217',
      fileName: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
      sha256: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.sha256,
      statementCount: Number((applied[0] as Record<string, unknown>)?.statementCount),
      transactionMode: 'single-transaction',
    })
    || !Number.isSafeInteger(Number((applied[0] as Record<string, unknown>)?.statementCount))
    || Number((applied[0] as Record<string, unknown>)?.statementCount) < 1
    || !post || typeof post !== 'object' || Array.isArray(post)
    || relationshipInputSha256(post) !== relationshipInputSha256({
      migrationSignaturePresent: true,
      appTrackerCount: 1,
      supabaseTrackerCount: 1,
      activePublicationCount: 0,
    })
  ) {
    return fail('case_vortex_rollback_migration_receipt_invalid');
  }
  const completedAt = timestamp(
    candidate.completedAt,
    'case_vortex_rollback_migration_receipt_invalid',
  );
  if (completedAt < startedAt) fail('case_vortex_rollback_migration_receipt_invalid');
  return candidate as unknown as CaseVortexRollbackMigrationReceipt;
};
