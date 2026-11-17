import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
  buildCaseVortexClaimAnalysisMigrationRecoveryPlan,
  verifyCaseVortexClaimAnalysisMigrationRecoveryPlan,
} from '../../src/caseGraph/claimAnalysisMigrationRecoveryPlan';
import {
  buildCaseVortexClaimAnalysisMigrationRecoveryApproval,
  verifyCaseVortexClaimAnalysisMigrationRecoveryApproval,
} from '../../src/caseGraph/claimAnalysisMigrationRecoveryApproval';
import {
  runCaseVortexClaimAnalysisMigrationRehearsalCli,
} from '../../src/cli/buildCaseVortexClaimAnalysisMigrationRehearsal';
import {
  CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure,
  executeApprovedCaseVortexClaimAnalysisMigrationRecovery,
  verifyCaseVortexClaimAnalysisMigrationRecoveryReceipt,
} from '../../src/db/approvedCaseVortexClaimAnalysisMigrationRecoveryExecutor';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');
const file0214 = '0214_case_vortex_claim_analysis_tool_receipts_2026_07_23.sql';
const file0215 = '0215_case_vortex_saved_claim_analyses_2026_07_23.sql';
const stem0214 = file0214.replace(/\.sql$/u, '');

const rehearsal = async (overrides: {
  app0215?: boolean;
  supabase0214?: boolean;
  signature0215?: boolean;
  active?: number;
} = {}) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('claim_analysis_migration_rehearsal:catalog')) {
      return { rows: [{
        server_version_num: 170006,
        app_tracker_present: true,
        supabase_tracker_present: true,
        turns_present: true,
        publications_present: true,
      }] };
    }
    if (sql.includes('claim_analysis_migration_rehearsal:app_ledger')) {
      return { rows: [
        { id: '0213_case_vortex_saved_report_replay_2026_07_22.sql' },
        { id: file0214 },
        ...(overrides.app0215 === false ? [] : [{ id: file0215 }]),
      ] };
    }
    if (sql.includes('claim_analysis_migration_rehearsal:supabase_ledger')) {
      return { rows: [
        { version: '0213_case_vortex_saved_report_replay_2026_07_22' },
        ...(overrides.supabase0214 ? [{ version: stem0214 }] : []),
      ] };
    }
    if (sql.includes('claim_analysis_migration_rehearsal:signatures')) {
      return { rows: [{
        name: 'function:save_case_vortex_luna_turn_allows_analyze_case_claims',
        present: true,
      }, {
        name: 'persistence:case_vortex_luna_turns_claim_analyses',
        present: overrides.signature0215 === true,
      }] };
    }
    if (sql.includes('claim_analysis_migration_rehearsal:active_publication')) {
      return { rows: [{ count: overrides.active || 0 }] };
    }
    throw new Error(`unexpected query:${sql}`);
  });
  const result = await runCaseVortexClaimAnalysisMigrationRehearsalCli(['--check-db'], {
    env: { DATABASE_URL: 'postgresql://read-only.invalid/database' },
    migrationsDir,
    query,
  });
  if ('usage' in result) throw new Error('unexpected help');
  return result;
};

describe('Case Vortex claim-analysis migration recovery plan', () => {
  it('binds only the exact observed dual-ledger drift to a zero-authority plan', async () => {
    const freshRehearsal = await rehearsal();
    const first = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'claim-analysis-recovery-2026-07-25',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal,
    });
    const second = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: first.planId,
      createdAt: first.createdAt,
      freshRehearsal,
    });
    expect(second).toEqual(first);
    expect(first.observedState).toEqual({
      appTrackerVersions: ['0213', '0214', '0215'],
      supabaseTrackerVersions: ['0213'],
      schemaSignatureVersions: ['0214'],
      activePublicationCount: 0,
    });
    expect(first.recoveryActions).toHaveLength(2);
    expect(first.recoveryActions.every((action) => (
      action.action === 'reapply_exact_migration_and_reconcile_missing_supabase_tracker'
      && action.existingAppTrackerRequired
      && action.missingSupabaseTrackerRequired
    ))).toBe(true);
    expect(first.recoveryBoundary).toMatchObject({
      recoveryExecutionApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
      requiredApprovalStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
    });
    expect(first.guarantees).toMatchObject({
      databaseWritesDuringPlanning: 0,
      storageWritesDuringPlanning: 0,
      lunaCallsDuringPlanning: 0,
      publicationsDuringPlanning: 0,
      deploymentsDuringPlanning: 0,
    });
  });

  it('rejects a different ledger, schema, publication or local-chain state', async () => {
    await expect(async () => buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal: await rehearsal({ app0215: false }),
    })).rejects.toThrow('case_vortex_claim_analysis_migration_recovery_rehearsal_invalid');
    await expect(async () => buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal: await rehearsal({ signature0215: true }),
    })).rejects.toThrow('case_vortex_claim_analysis_migration_recovery_rehearsal_invalid');
    await expect(async () => buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal: await rehearsal({ active: 1 }),
    })).rejects.toThrow('case_vortex_claim_analysis_migration_recovery_rehearsal_invalid');

    const changed = await rehearsal();
    changed.localChain[0].actualSha256 = 'a'.repeat(64);
    const { receiptSha256: _old, ...core } = changed;
    changed.receiptSha256 = (await import('node:crypto'))
      .createHash('sha256').update(JSON.stringify(core)).digest('hex');
    expect(() => buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal: changed,
    })).toThrow('case_vortex_claim_analysis_migration_recovery_local_chain_invalid');
  });

  it('detects plan tampering against the fresh rehearsal', async () => {
    const freshRehearsal = await rehearsal();
    const plan = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal,
    });
    expect(verifyCaseVortexClaimAnalysisMigrationRecoveryPlan(
      plan,
      { freshRehearsal },
    )).toEqual(plan);
    const changed = structuredClone(plan);
    changed.recoveryActions.reverse();
    expect(() => verifyCaseVortexClaimAnalysisMigrationRecoveryPlan(
      changed,
      { freshRehearsal },
    )).toThrow('case_vortex_claim_analysis_migration_recovery_plan_tampered');
  });

  it('binds exact recovery authority to the plan and expires it after one hour', async () => {
    const freshRehearsal = await rehearsal();
    const plan = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal,
    });
    const approval = buildCaseVortexClaimAnalysisMigrationRecoveryApproval({
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-25T14:05:00.000Z',
      plan,
      freshRehearsal,
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(approval).toMatchObject({
      planSha256: plan.planSha256,
      rehearsalReceiptSha256: freshRehearsal.receiptSha256,
      expiresAt: '2026-07-25T15:05:00.000Z',
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(verifyCaseVortexClaimAnalysisMigrationRecoveryApproval(approval, {
      plan,
      freshRehearsal,
      verifiedAt: '2026-07-25T14:30:00.000Z',
    })).toEqual(approval);
    expect(() => verifyCaseVortexClaimAnalysisMigrationRecoveryApproval(approval, {
      plan,
      freshRehearsal,
      verifiedAt: '2026-07-25T15:05:00.001Z',
    })).toThrow('case_vortex_claim_analysis_migration_recovery_approval_invalid');
  });

  it('rejects paraphrased, publication-bearing or re-sealed recovery authority', async () => {
    const freshRehearsal = await rehearsal();
    const plan = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal,
    });
    const base = {
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-25T14:05:00.000Z',
      plan,
      freshRehearsal,
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    };
    expect(() => buildCaseVortexClaimAnalysisMigrationRecoveryApproval({
      ...base,
      authorizationStatement: 'Please repair it.',
    })).toThrow('case_vortex_claim_analysis_migration_recovery_approval_scope_invalid');
    expect(() => buildCaseVortexClaimAnalysisMigrationRecoveryApproval({
      ...base,
      publicationActivationApproved: true,
    })).toThrow('case_vortex_claim_analysis_migration_recovery_approval_scope_invalid');

    const approval = buildCaseVortexClaimAnalysisMigrationRecoveryApproval(base);
    const changed = { ...approval, planSha256: 'f'.repeat(64) };
    const { approvalSha256: _old, ...core } = changed;
    changed.approvalSha256 = (await import(
      '../../src/caseGraph/relationshipInputSnapshot'
    )).relationshipInputSha256(core);
    expect(() => verifyCaseVortexClaimAnalysisMigrationRecoveryApproval(changed, {
      plan,
      freshRehearsal,
      verifiedAt: '2026-07-25T14:30:00.000Z',
    })).toThrow('case_vortex_claim_analysis_migration_recovery_approval_invalid');
  });

  it('reapplies exact bytes, writes only missing Supabase trackers and verifies the final state', async () => {
    const freshRehearsal = await rehearsal();
    const plan = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal,
    });
    const approval = buildCaseVortexClaimAnalysisMigrationRecoveryApproval({
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-25T14:05:00.000Z',
      plan,
      freshRehearsal,
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    const supabase = new Set<string>();
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sql.includes('claim_analysis_recovery:boundary_catalog')) {
          return { rows: [{
            server_version_num: 170006,
            app_tracker_present: true,
            supabase_tracker_present: true,
            turns_present: true,
            publications_present: true,
          }] };
        }
        if (sql.includes('claim_analysis_recovery:boundary_app_ledger')) {
          return { rows: [
            { id: '0213_case_vortex_saved_report_replay_2026_07_22.sql' },
            { id: file0214 },
            { id: file0215 },
          ] };
        }
        if (sql.includes('claim_analysis_recovery:boundary_supabase_ledger')) {
          return { rows: [{ version: '0213_case_vortex_saved_report_replay_2026_07_22' }] };
        }
        if (sql.includes('claim_analysis_migration_rehearsal:signatures')) {
          return { rows: [{
            name: 'function:save_case_vortex_luna_turn_allows_analyze_case_claims',
            present: true,
          }, {
            name: 'persistence:case_vortex_luna_turns_claim_analyses',
            present: supabase.has(file0215.replace(/\.sql$/u, '')),
          }] };
        }
        if (sql.includes('post_apply_app_ledger')) {
          return { rows: [{ id: file0214 }, { id: file0215 }] };
        }
        if (sql.includes('post_apply_supabase_ledger')) {
          return { rows: [...supabase].sort().map((version) => ({ version })) };
        }
        if (sql.includes('active_publication')) return { rows: [{ count: 0 }] };
        if (sql.includes('INSERT INTO supabase_migrations.schema_migrations')) {
          supabase.add(String(params?.[0]));
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(async () => undefined),
    };
    const times = [
      new Date('2026-07-25T14:10:00.000Z'),
      new Date('2026-07-25T14:11:00.000Z'),
    ];
    const receipt = await executeApprovedCaseVortexClaimAnalysisMigrationRecovery({
      plan,
      freshRehearsal,
      approval,
      expectedApprovalSha256: approval.approvalSha256,
      verifiedAt: '2026-07-25T14:10:00.000Z',
    }, {
      getClient: async () => client,
      now: () => times.shift() || new Date('2026-07-25T14:11:00.000Z'),
    });
    expect(receipt.appliedActions).toHaveLength(2);
    expect(receipt.appliedActions.every(({ appTrackerWrites, supabaseTrackerWrites }) => (
      appTrackerWrites === 0 && supabaseTrackerWrites === 1
    ))).toBe(true);
    expect(receipt.postApplyVerification).toMatchObject({
      appTrackerCount: 2,
      supabaseTrackerCount: 2,
      activePublicationCount: 0,
    });
    expect(calls.filter(({ sql }) => (
      sql.includes('INSERT INTO public.schema_migrations')
    ))).toHaveLength(0);
    expect(calls.filter(({ sql }) => (
      sql.includes('INSERT INTO supabase_migrations.schema_migrations')
    ))).toHaveLength(2);
    expect(verifyCaseVortexClaimAnalysisMigrationRecoveryReceipt(receipt)).toEqual(receipt);
    const substituted = structuredClone(receipt) as typeof receipt & { apiKey?: string };
    substituted.apiKey = 're-sealed-secret';
    const { receiptSha256: _receiptSha256, ...substitutedCore } = substituted;
    substituted.receiptSha256 = relationshipInputSha256(substitutedCore);
    expect(() => verifyCaseVortexClaimAnalysisMigrationRecoveryReceipt(substituted))
      .toThrow('case_vortex_claim_analysis_migration_recovery_receipt_invalid');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back the current action and seals partial recovery after a later failure', async () => {
    const freshRehearsal = await rehearsal();
    const plan = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
      planId: 'recovery',
      createdAt: '2026-07-25T14:00:00.000Z',
      freshRehearsal,
    });
    const approval = buildCaseVortexClaimAnalysisMigrationRecoveryApproval({
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-25T14:05:00.000Z',
      plan,
      freshRehearsal,
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    const supabase = new Set<string>();
    const client = {
      query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sql.includes('claim_analysis_recovery:boundary_catalog')) {
          return { rows: [{
            server_version_num: 170006,
            app_tracker_present: true,
            supabase_tracker_present: true,
            turns_present: true,
            publications_present: true,
          }] };
        }
        if (sql.includes('boundary_app_ledger')) return { rows: [
          { id: '0213_case_vortex_saved_report_replay_2026_07_22.sql' },
          { id: file0214 }, { id: file0215 },
        ] };
        if (sql.includes('boundary_supabase_ledger')) {
          return { rows: [{ version: '0213_case_vortex_saved_report_replay_2026_07_22' }] };
        }
        if (sql.includes('claim_analysis_migration_rehearsal:signatures')) {
          return { rows: [{
            name: 'function:save_case_vortex_luna_turn_allows_analyze_case_claims',
            present: true,
          }, {
            name: 'persistence:case_vortex_luna_turns_claim_analyses',
            present: false,
          }] };
        }
        if (sql.includes('active_publication')) return { rows: [{ count: 0 }] };
        if (sql === 'BEGIN') {
          return { rows: [] };
        }
        if (/ADD COLUMN IF NOT EXISTS claim_analyses/iu.test(sql)) {
          throw new Error('fixture-second-action-failed');
        }
        if (sql.includes('INSERT INTO supabase_migrations.schema_migrations')) {
          supabase.add(String(params?.[0]));
        }
        return { rows: [] };
      }),
      release: vi.fn(async () => undefined),
    };
    let failure: CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure | undefined;
    try {
      await executeApprovedCaseVortexClaimAnalysisMigrationRecovery({
        plan,
        freshRehearsal,
        approval,
        expectedApprovalSha256: approval.approvalSha256,
        verifiedAt: '2026-07-25T14:10:00.000Z',
      }, {
        getClient: async () => client,
        now: () => new Date('2026-07-25T14:10:00.000Z'),
      });
    } catch (error) {
      failure = error as CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure;
    }
    expect(failure).toBeInstanceOf(
      CaseVortexClaimAnalysisMigrationRecoveryExecutionFailure,
    );
    expect(failure?.receipt).toMatchObject({
      failureStage: 'migration_statement',
      failedVersion: '0215',
      currentTransactionRolledBack: true,
      databaseMayBePartiallyMutated: false,
      reconciliationRequired: false,
      publicationActivations: 0,
      deployments: 0,
    });
    expect(failure?.receipt.appliedActions).toHaveLength(0);
    expect(verifyCaseVortexClaimAnalysisMigrationRecoveryReceipt(failure?.receipt))
      .toEqual(failure?.receipt);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
