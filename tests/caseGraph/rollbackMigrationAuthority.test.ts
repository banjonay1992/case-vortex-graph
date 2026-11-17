import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCaseVortexRollbackMigrationApproval,
  buildCaseVortexRollbackMigrationRehearsal,
  CaseVortexRollbackMigrationExecutionFailure,
  CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT,
  CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT,
  executeApprovedCaseVortexRollbackMigration,
  verifyCaseVortexRollbackMigrationApproval,
  verifyCaseVortexRollbackMigrationReceipt,
  type CaseVortexRollbackMigrationState,
} from '../../src/caseGraph/rollbackMigrationAuthority';

const migrationBytes = () => readFile(join(
  process.cwd(),
  'src',
  'db',
  'migrations',
  CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName,
));

const readyState = (
  overrides: Partial<CaseVortexRollbackMigrationState> = {},
): CaseVortexRollbackMigrationState => ({
  serverVersionNum: 170010,
  transactionReadOnly: true,
  appTrackerPresent: true,
  supabaseTrackerPresent: true,
  publicationsRelationPresent: true,
  baseAppTracked: true,
  baseSupabaseTracked: true,
  baseSignaturePresent: true,
  migrationAppTracked: false,
  migrationSupabaseTracked: false,
  migrationSignaturePresent: false,
  activePublicationCount: 0,
  ...overrides,
});

const rehearsal = async (
  overrides: Partial<CaseVortexRollbackMigrationState> = {},
) => buildCaseVortexRollbackMigrationRehearsal({
  inspectedAt: '2026-07-26T20:00:00.000Z',
  migrationBytes: await migrationBytes(),
  remote: readyState(overrides),
});

const approval = async () => buildCaseVortexRollbackMigrationApproval({
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-26T20:01:00.000Z',
  rehearsal: await rehearsal(),
  authorizationStatement: CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT,
});

const executionHarness = (failure?: 'migration_statement' | 'post_apply_verification') => {
  let committed = false;
  let inTransaction = false;
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
    if (sql.trim() === 'BEGIN') { inTransaction = true; return { rows: [] }; }
    if (sql.trim() === 'COMMIT') { committed = true; inTransaction = false; return { rows: [] }; }
    if (sql.trim() === 'ROLLBACK') { inTransaction = false; return { rows: [] }; }
    if (sql.includes('case_vortex_rollback_migration_authority:catalog')) {
      return { rows: [{
        server_version_num: 170010,
        transaction_read_only: false,
        app_tracker_present: true,
        supabase_tracker_present: true,
        publications_relation_present: true,
      }] };
    }
    if (sql.includes('app_tracker_count')) {
      return { rows: [{
        app_tracker_count: 1,
        supabase_tracker_count: 1,
        active_publication_count: 0,
      }] };
    }
    if (sql.includes('FROM public.schema_migrations')) {
      return { rows: committed
        ? [{ id: '0216_case_vortex_retained_influence_search_2026_07_26.sql' },
          { id: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName }]
        : [{ id: '0216_case_vortex_retained_influence_search_2026_07_26.sql' }] };
    }
    if (sql.includes('FROM supabase_migrations.schema_migrations')) {
      return { rows: committed
        ? [{ version: '0216_case_vortex_retained_influence_search_2026_07_26' },
          { version: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName.replace(/\.sql$/u, '') }]
        : [{ version: '0216_case_vortex_retained_influence_search_2026_07_26' }] };
    }
    if (sql.includes('case_vortex_retained_influence_migration_rehearsal:signature')) {
      return { rows: [{ present: true }] };
    }
    if (sql.includes('case_vortex_publication_rollback:signature')) {
      return { rows: [{ present: committed && failure !== 'post_apply_verification' }] };
    }
    if (sql.includes('count(*)::integer AS count')) return { rows: [{ count: 0 }] };
    if (sql.startsWith('INSERT INTO public.schema_migrations')
      || sql.includes('INSERT INTO supabase_migrations.schema_migrations')) {
      expect(inTransaction).toBe(true);
      return { rows: [] };
    }
    expect(inTransaction).toBe(true);
    if (failure === 'migration_statement' && sql.includes('SET LOCAL lock_timeout')) {
      throw new Error('fixture migration statement failure');
    }
    return { rows: [] };
  });
  return {
    query,
    release,
    committed: () => committed,
    inTransaction: () => inTransaction,
  };
};

describe('Case Vortex rollback migration authority', () => {
  it('rehearses exact 0217 bytes without granting rollback or publication authority', async () => {
    const result = await rehearsal();
    expect(result).toMatchObject({
      readyForSeparateApproval: true,
      blockers: [],
      plannedMigrations: [CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName],
      approvalBoundary: {
        migrationApplicationApproved: false,
        publicationRollbackApproved: false,
        publicationActivationApproved: false,
        storageWriteApproved: false,
        lunaCallApproved: false,
        deploymentApproved: false,
      },
      guarantees: {
        databaseWrites: 0,
        storageWrites: 0,
        lunaCalls: 0,
        publicationMutations: 0,
        deployments: 0,
      },
    });
    expect(result.localMigration.digestMatches).toBe(true);
    expect(result.localMigration.statementCount).toBeGreaterThan(1);
  });

  it.each([
    [{ transactionReadOnly: false }, 'remote:transaction_not_read_only'],
    [{ baseAppTracked: false }, 'remote:base_tracker_disagreement:0216'],
    [{ baseSignaturePresent: false }, 'remote:base_ledger_schema_drift:0216'],
    [{ migrationAppTracked: true }, 'remote:tracker_disagreement:0217'],
    [{ migrationSignaturePresent: true }, 'remote:untracked_schema:0217'],
    [{ activePublicationCount: 1 }, 'remote:active_publication_must_be_zero'],
  ] as const)('fails the rehearsal boundary for %j', async (overrides, blocker) => {
    const result = await rehearsal(overrides);
    expect(result.readyForSeparateApproval).toBe(false);
    expect(result.plannedMigrations).toEqual([]);
    expect(result.blockers).toContain(blocker);
  });

  it('requires the exact 0217-only statement and rejects broadened approval fields', async () => {
    const valid = await approval();
    const rehearsed = await rehearsal();
    expect(verifyCaseVortexRollbackMigrationApproval(valid)).toEqual(valid);
    expect(() => buildCaseVortexRollbackMigrationApproval({
      approvalId: valid.approvalId,
      approvedBy: valid.approvedBy,
      approvedAt: valid.approvedAt,
      rehearsal: rehearsed,
      authorizationStatement: `${CASE_VORTEX_ROLLBACK_MIGRATION_APPROVAL_STATEMENT} deploy`,
    })).toThrow('case_vortex_rollback_migration_approval_scope_invalid');
    expect(() => verifyCaseVortexRollbackMigrationApproval({
      ...valid,
      publicationRollbackApproved: true,
    })).toThrow('case_vortex_rollback_migration_approval_invalid');
  });

  it('executes exactly one migration atomically and observes no publication action', async () => {
    const approved = await approval();
    const freshRehearsal = await rehearsal();
    let committed = false;
    let inTransaction = false;
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      if (sql.trim() === 'BEGIN') { inTransaction = true; return { rows: [] }; }
      if (sql.trim() === 'COMMIT') { committed = true; inTransaction = false; return { rows: [] }; }
      if (sql.trim() === 'ROLLBACK') { inTransaction = false; return { rows: [] }; }
      if (sql.includes('case_vortex_rollback_migration_authority:catalog')) {
        return { rows: [{
          server_version_num: 170010,
          transaction_read_only: false,
          app_tracker_present: true,
          supabase_tracker_present: true,
          publications_relation_present: true,
        }] };
      }
      if (sql.includes('app_tracker_count')) {
        return { rows: [{
          app_tracker_count: 1,
          supabase_tracker_count: 1,
          active_publication_count: 0,
        }] };
      }
      if (sql.includes('FROM public.schema_migrations')) {
        return { rows: committed
          ? [{ id: '0216_case_vortex_retained_influence_search_2026_07_26.sql' },
            { id: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName }]
          : [{ id: '0216_case_vortex_retained_influence_search_2026_07_26.sql' }] };
      }
      if (sql.includes('FROM supabase_migrations.schema_migrations')) {
        return { rows: committed
          ? [{ version: '0216_case_vortex_retained_influence_search_2026_07_26' },
            { version: CASE_VORTEX_ROLLBACK_MIGRATION_CONTRACT.fileName.replace(/\.sql$/u, '') }]
          : [{ version: '0216_case_vortex_retained_influence_search_2026_07_26' }] };
      }
      if (sql.includes('case_vortex_retained_influence_migration_rehearsal:signature')) {
        return { rows: [{ present: true }] };
      }
      if (sql.includes('case_vortex_publication_rollback:signature')) {
        return { rows: [{ present: committed }] };
      }
      if (sql.includes('count(*)::integer AS count')) return { rows: [{ count: 0 }] };
      if (sql.startsWith('INSERT INTO public.schema_migrations')
        || sql.includes('INSERT INTO supabase_migrations.schema_migrations')) {
        expect(inTransaction).toBe(true);
        return { rows: [] };
      }
      expect(inTransaction).toBe(true);
      return { rows: [] };
    });

    const result = await executeApprovedCaseVortexRollbackMigration({
      approval: approved,
      expectedApprovalSha256: approved.approvalSha256,
      freshRehearsal,
      migrationBytes: await migrationBytes(),
      getClient: async () => ({ query, release }),
      now: (() => {
        const values = [
          new Date('2026-07-26T20:02:00.000Z'),
          new Date('2026-07-26T20:02:01.000Z'),
        ];
        return () => values.shift() || values[values.length - 1];
      })(),
    });

    expect(verifyCaseVortexRollbackMigrationReceipt(result)).toEqual(result);
    expect(result).toMatchObject({
      applied: [{ version: '0217' }],
      publicationRollbacks: 0,
      publicationActivations: 0,
      storageWrites: 0,
      lunaCalls: 0,
      deployments: 0,
    });
    expect(committed).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects receipt tampering even when safety counts look plausible', async () => {
    const approved = await approval();
    expect(() => verifyCaseVortexRollbackMigrationReceipt({
      recordType: 'case_vortex_rollback_migration_receipt',
      schemaVersion: 'case-vortex-rollback-migration-receipt-v1',
      approvalId: approved.approvalId,
      approvalSha256: approved.approvalSha256,
      rehearsalReceiptSha256: approved.rehearsalReceiptSha256,
      startedAt: '2026-07-26T20:02:00.000Z',
      completedAt: '2026-07-26T20:02:01.000Z',
      applied: [],
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
      receiptSha256: 'a'.repeat(64),
    })).toThrow('case_vortex_rollback_migration_receipt_invalid');
  });

  it('seals a clean rollback receipt when a migration statement fails', async () => {
    const approved = await approval();
    const freshRehearsal = await rehearsal();
    const harness = executionHarness('migration_statement');
    let failure: CaseVortexRollbackMigrationExecutionFailure | null = null;
    try {
      await executeApprovedCaseVortexRollbackMigration({
        approval: approved,
        expectedApprovalSha256: approved.approvalSha256,
        freshRehearsal,
        migrationBytes: await migrationBytes(),
        getClient: async () => ({
          query: harness.query,
          release: harness.release,
        }),
        now: () => new Date('2026-07-26T20:10:00.000Z'),
      });
    } catch (error) {
      failure = error as CaseVortexRollbackMigrationExecutionFailure;
    }
    expect(failure).toBeInstanceOf(CaseVortexRollbackMigrationExecutionFailure);
    expect(verifyCaseVortexRollbackMigrationReceipt(failure?.receipt)).toMatchObject({
      failureStage: 'migration_statement',
      migrationCommitted: false,
      currentTransactionRolledBack: true,
      databaseMayBeMutated: false,
      reconciliationRequired: false,
    });
    expect(harness.committed()).toBe(false);
    expect(harness.inTransaction()).toBe(false);
    expect(harness.release).toHaveBeenCalledOnce();
  });

  it('seals a reconciliation-required receipt after a committed postcondition failure', async () => {
    const approved = await approval();
    const freshRehearsal = await rehearsal();
    const harness = executionHarness('post_apply_verification');
    let failure: CaseVortexRollbackMigrationExecutionFailure | null = null;
    try {
      await executeApprovedCaseVortexRollbackMigration({
        approval: approved,
        expectedApprovalSha256: approved.approvalSha256,
        freshRehearsal,
        migrationBytes: await migrationBytes(),
        getClient: async () => ({
          query: harness.query,
          release: harness.release,
        }),
        now: () => new Date('2026-07-26T20:11:00.000Z'),
      });
    } catch (error) {
      failure = error as CaseVortexRollbackMigrationExecutionFailure;
    }
    expect(failure).toBeInstanceOf(CaseVortexRollbackMigrationExecutionFailure);
    expect(verifyCaseVortexRollbackMigrationReceipt(failure?.receipt)).toMatchObject({
      failureStage: 'post_apply_verification',
      migrationCommitted: true,
      currentTransactionRolledBack: false,
      databaseMayBeMutated: true,
      reconciliationRequired: true,
    });
    expect(harness.committed()).toBe(true);
    expect(harness.release).toHaveBeenCalledOnce();
  });
});
