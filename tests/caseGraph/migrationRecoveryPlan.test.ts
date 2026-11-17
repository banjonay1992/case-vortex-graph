import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT,
  buildCaseVortexMigrationExecutionApproval,
  caseVortexMigrationApprovalPlannedMigrations,
} from '../../src/caseGraph/migrationExecutionApproval';
import {
  buildCaseVortexMigrationRecoveryPlan,
  CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
  verifyCaseVortexMigrationRecoveryPlan,
} from '../../src/caseGraph/migrationRecoveryPlan';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  CASE_VORTEX_MIGRATION_CONTRACTS,
  runCaseVortexRemoteRehearsalCli,
} from '../../src/cli/buildCaseVortexRemoteRehearsal';
import { CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION } from '../../src/db/approvedCaseVortexMigrationExecutor';

const rehearsalReceiptSha256 = 'a'.repeat(64);
const approval = buildCaseVortexMigrationExecutionApproval({
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-22T14:00:00.000Z',
  rehearsalReceiptSha256,
  plannedMigrations: caseVortexMigrationApprovalPlannedMigrations(),
  authorizationStatement: CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

const appliedEntry = (index: number) => {
  const contract = CASE_VORTEX_MIGRATION_CONTRACTS[index];
  return {
    version: contract.version,
    fileName: contract.fileName,
    sha256: contract.sha256,
    statementCount: 1,
    transactionMode: index < 2
      ? 'autocommit-per-statement' as const : 'single-transaction' as const,
  };
};

const failureReceipt = () => {
  const withoutDigest = {
    recordType: 'case_vortex_migration_execution_failure_receipt' as const,
    schemaVersion: CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION,
    approvalId: approval.approvalId,
    approvalSha256: approval.approvalSha256,
    rehearsalReceiptSha256,
    startedAt: '2026-07-22T14:10:00.000Z',
    failedAt: '2026-07-22T14:11:00.000Z',
    failureStage: 'migration_statement' as const,
    failedVersion: '0204',
    failedFileName: CASE_VORTEX_MIGRATION_CONTRACTS[2].fileName,
    completedStatementCountInFailedMigration: 0,
    currentTransactionRolledBack: true,
    applied: [appliedEntry(0), appliedEntry(1)],
    databaseMayBePartiallyMutated: true,
    reconciliationRequired: true,
    causeSha256: 'b'.repeat(64),
    publicationActivations: 0 as const,
    deployments: 0 as const,
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};

const postApplyFailureReceipt = () => {
  const withoutDigest = {
    recordType: 'case_vortex_migration_execution_failure_receipt' as const,
    schemaVersion: CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION,
    approvalId: approval.approvalId,
    approvalSha256: approval.approvalSha256,
    rehearsalReceiptSha256,
    startedAt: '2026-07-22T14:10:00.000Z',
    failedAt: '2026-07-22T14:11:00.000Z',
    failureStage: 'post_apply_verification' as const,
    failedVersion: null,
    failedFileName: null,
    completedStatementCountInFailedMigration: 0,
    currentTransactionRolledBack: false,
    applied: CASE_VORTEX_MIGRATION_CONTRACTS.map((_, index) => appliedEntry(index)),
    databaseMayBePartiallyMutated: true,
    reconciliationRequired: true,
    causeSha256: 'c'.repeat(64),
    publicationActivations: 0 as const,
    deployments: 0 as const,
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};

const signatureKey = (signature: string) => signature.startsWith('relation:')
  ? signature.slice('relation:'.length)
  : signature.startsWith('index:') ? signature.slice('index:'.length) : signature;

const remoteQuery = (appliedVersions: string[], supabaseVersions = appliedVersions) => {
  const presentKeys = new Set(CASE_VORTEX_MIGRATION_CONTRACTS
    .filter(({ version }) => appliedVersions.includes(version))
    .flatMap(({ signatures }) => signatures.map(signatureKey)));
  return vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes('case_vortex_remote_rehearsal:catalog')) return { rows: [{
      server_version_num: 170006,
      app_tracker_present: true,
      supabase_tracker_present: true,
    }] };
    if (sql.includes('case_vortex_remote_rehearsal:app_ledger')) return { rows: appliedVersions.map((version) => ({
      id: CASE_VORTEX_MIGRATION_CONTRACTS.find((item) => item.version === version)?.fileName,
    })) };
    if (sql.includes('case_vortex_remote_rehearsal:supabase_ledger')) return { rows: supabaseVersions.map((version) => ({
      version: CASE_VORTEX_MIGRATION_CONTRACTS.find((item) => item.version === version)
        ?.fileName.replace(/\.sql$/u, ''),
    })) };
    if (sql.includes('case_vortex_remote_rehearsal:signatures')) {
      const relationNames = params[0] as string[];
      const special = [
        'idx_uap_sightings_case_graph_source_cursor_ms',
        'absence:idx_uap_sightings_case_graph_source_cursor',
        'definition:idx_uap_sightings_case_graph_source_cursor_ms',
        'baseline-columns:case_graph_control_plane',
        'security:case_graph_control_plane_rls',
        'columns:uap_case_graph_runs.lineage_version+snapshot_id+corpus_accounting_digest+graph_artifact_set_sha256',
        'columns:uap_search_catalog_media_state.mutation_watermark_complete+mutation_watermark_completed_at',
        'function:capture_uap_evidence_universe_media_snapshot',
        'trigger:trg_uap_search_catalog_media_mutation_watermark',
        'columns:case_vortex_luna_turns.tool_receipts+provider_usage',
      ];
      return { rows: [...relationNames, ...special].map((name) => ({
        name, present: presentKeys.has(name),
      })) };
    }
    if (sql.includes('case_vortex_remote_rehearsal:active_publication')) {
      return { rows: [{ count: 0 }] };
    }
    throw new Error(`unexpected query:${sql}`);
  });
};

const rehearsal = async (applied = ['0202', '0203'], supabase = applied) => (
  runCaseVortexRemoteRehearsalCli(['--check-db'], {
    env: { DATABASE_URL: 'postgresql://read-only.invalid/database' },
    migrationsDir: path.join(process.cwd(), 'src', 'db', 'migrations'),
    query: remoteQuery(applied, supabase),
  })
);

describe('Case Vortex migration recovery plan', () => {
  it('binds an exact applied prefix and remaining suffix without granting retry authority', async () => {
    const freshRehearsal = await rehearsal();
    const plan = buildCaseVortexMigrationRecoveryPlan({
      planId: 'recovery-0204-v1',
      createdAt: '2026-07-22T14:15:00.000Z',
      approval,
      failureReceipt: failureReceipt(),
      freshRehearsal,
    });
    expect(plan.alreadyAppliedVersions).toEqual(['0202', '0203']);
    expect(plan.remainingMigrations.map(({ version }) => version))
      .toEqual(CASE_VORTEX_MIGRATION_CONTRACTS.slice(2).map(({ version }) => version));
    expect(plan.recoveryBoundary).toEqual({
      alignedAppliedPrefixRequired: true,
      exactRemainingSuffixRequired: true,
      activePublicationCount: 0,
      freshReadOnlyRehearsalRequired: true,
      recoveryExecutionApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
      requiredApprovalStatement: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
    });
    expect(plan.guarantees).toMatchObject({
      databaseWritesDuringPlanning: 0,
      storageReadsDuringPlanning: 0,
      storageWritesDuringPlanning: 0,
      lunaCallsDuringPlanning: 0,
      publicationsDuringPlanning: 0,
      deploymentsDuringPlanning: 0,
    });
    expect(verifyCaseVortexMigrationRecoveryPlan(plan, {
      approval, failureReceipt: failureReceipt(), freshRehearsal,
    })).toEqual(plan);
  });

  it('rejects non-prefix, tracker-disagreement and tampered recovery state', async () => {
    const gap = await rehearsal(['0202', '0204']);
    expect(() => buildCaseVortexMigrationRecoveryPlan({
      planId: 'recovery-gap', createdAt: '2026-07-22T14:15:00.000Z',
      approval, failureReceipt: failureReceipt(), freshRehearsal: gap,
    })).toThrow('case_vortex_migration_recovery_applied_prefix_invalid');

    const disagreement = await rehearsal(['0202', '0203'], ['0202']);
    expect(() => buildCaseVortexMigrationRecoveryPlan({
      planId: 'recovery-disagreement', createdAt: '2026-07-22T14:15:00.000Z',
      approval, failureReceipt: failureReceipt(), freshRehearsal: disagreement,
    })).toThrow('case_vortex_migration_recovery_rehearsal_invalid');

    const aligned = await rehearsal();
    const plan = buildCaseVortexMigrationRecoveryPlan({
      planId: 'recovery-tamper', createdAt: '2026-07-22T14:15:00.000Z',
      approval, failureReceipt: failureReceipt(), freshRehearsal: aligned,
    });
    expect(() => verifyCaseVortexMigrationRecoveryPlan({
      ...plan,
      recoveryBoundary: { ...plan.recoveryBoundary, deploymentApproved: true as never },
    }, { approval, failureReceipt: failureReceipt(), freshRehearsal: aligned }))
      .toThrow('case_vortex_migration_recovery_plan_tampered');
  });

  it('requires diagnosis instead of replaying a completed chain after post-apply verification fails', async () => {
    const freshRehearsal = await rehearsal();
    expect(() => buildCaseVortexMigrationRecoveryPlan({
      planId: 'recovery-post-apply',
      createdAt: '2026-07-22T14:15:00.000Z',
      approval,
      failureReceipt: postApplyFailureReceipt(),
      freshRehearsal,
    })).toThrow('case_vortex_migration_recovery_post_apply_diagnosis_required');
  });
});
