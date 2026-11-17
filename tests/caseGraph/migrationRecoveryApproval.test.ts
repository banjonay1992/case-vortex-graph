import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexMigrationRecoveryApproval,
  verifyCaseVortexMigrationRecoveryApproval,
} from '../../src/caseGraph/migrationRecoveryApproval';
import {
  CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
  type CaseVortexMigrationRecoveryPlan,
} from '../../src/caseGraph/migrationRecoveryPlan';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const recoveryPlan = (): CaseVortexMigrationRecoveryPlan => {
  const withoutDigest: Omit<CaseVortexMigrationRecoveryPlan, 'planSha256'> = {
    recordType: 'case_vortex_migration_recovery_plan',
    schemaVersion: 'case-vortex-migration-recovery-plan-v1',
    planId: 'recovery-v1',
    createdAt: '2026-07-22T14:15:00.000Z',
    originalApprovalId: '123e4567-e89b-42d3-a456-426614174000',
    originalApprovalSha256: 'a'.repeat(64),
    failureReceiptSha256: 'b'.repeat(64),
    freshRehearsalReceiptSha256: 'c'.repeat(64),
    alreadyAppliedVersions: ['0202', '0203'],
    remainingMigrations: [{
      version: '0204',
      fileName: '0204_evidence_universe_materialized_snapshot_2026_07_17.sql',
      sha256: 'd'.repeat(64),
      transactionMode: 'single-transaction',
    }],
    recoveryBoundary: {
      alignedAppliedPrefixRequired: true,
      exactRemainingSuffixRequired: true,
      activePublicationCount: 0,
      freshReadOnlyRehearsalRequired: true,
      recoveryExecutionApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
      requiredApprovalStatement: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
    },
    guarantees: {
      databaseReadsDuringPlanning: 'bounded-read-only-transactions',
      databaseWritesDuringPlanning: 0,
      storageReadsDuringPlanning: 0,
      storageWritesDuringPlanning: 0,
      lunaCallsDuringPlanning: 0,
      publicationsDuringPlanning: 0,
      deploymentsDuringPlanning: 0,
    },
  };
  return { ...withoutDigest, planSha256: relationshipInputSha256(withoutDigest) };
};

const build = () => buildCaseVortexMigrationRecoveryApproval({
  approvalId: '223e4567-e89b-42d3-a456-426614174001',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-22T14:20:00.000Z',
  recoveryPlan: recoveryPlan(),
  authorizationStatement: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
  recoveryExecutionApproved: true,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

describe('Case Vortex migration recovery approval', () => {
  it('binds only the exact remaining suffix and keeps publication/deployment denied', () => {
    const approval = build();
    expect(approval.remainingMigrations).toEqual([
      '0204_evidence_universe_materialized_snapshot_2026_07_17.sql',
    ]);
    expect(approval.recoveryExecutionApproved).toBe(true);
    expect(approval.publicationActivationApproved).toBe(false);
    expect(approval.deploymentApproved).toBe(false);
    expect(verifyCaseVortexMigrationRecoveryApproval(approval, recoveryPlan()))
      .toEqual(approval);
  });

  it('rejects inferred authority, a changed plan and widened approval objects', () => {
    expect(() => buildCaseVortexMigrationRecoveryApproval({
      approvalId: '223e4567-e89b-42d3-a456-426614174001',
      approvedBy: 'owner:nathan',
      approvedAt: '2026-07-22T14:20:00.000Z',
      recoveryPlan: recoveryPlan(),
      authorizationStatement: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
      recoveryExecutionApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
    })).toThrow('case_vortex_migration_recovery_approval_scope_invalid');

    const approval = build();
    const changedPlan = recoveryPlan();
    changedPlan.remainingMigrations[0].fileName = '0213_unapproved.sql';
    expect(() => verifyCaseVortexMigrationRecoveryApproval(approval, changedPlan))
      .toThrow('case_vortex_migration_recovery_approval_plan_invalid');
    expect(() => verifyCaseVortexMigrationRecoveryApproval({
      ...approval,
      publicationApproved: true,
    }, recoveryPlan())).toThrow('case_vortex_migration_recovery_approval_invalid');
  });
});
