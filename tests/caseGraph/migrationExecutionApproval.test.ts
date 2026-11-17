import { describe, expect, it } from 'vitest';

import {
  CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT,
  buildCaseVortexMigrationExecutionApproval,
  caseVortexMigrationApprovalPlannedMigrations,
  verifyCaseVortexMigrationExecutionApproval,
} from '../../src/caseGraph/migrationExecutionApproval';

const input = () => ({
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-22T14:00:00.000Z',
  rehearsalReceiptSha256: 'a'.repeat(64),
  plannedMigrations: caseVortexMigrationApprovalPlannedMigrations(),
  authorizationStatement: CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

describe('Case Vortex migration execution approval', () => {
  it('seals the exact twelve-file migration-only scope deterministically', () => {
    const approval = buildCaseVortexMigrationExecutionApproval(input());
    expect(approval).toEqual(buildCaseVortexMigrationExecutionApproval(input()));
    expect(approval.plannedMigrations).toHaveLength(12);
    expect(approval.publicationActivationApproved).toBe(false);
    expect(approval.deploymentApproved).toBe(false);
    expect(verifyCaseVortexMigrationExecutionApproval(approval)).toEqual(approval);
  });

  it('rejects widened scope, reordered plans and derived-field tampering', () => {
    expect(() => buildCaseVortexMigrationExecutionApproval({
      ...input(), publicationActivationApproved: true,
    })).toThrow('case_vortex_migration_approval_scope_invalid');
    expect(() => buildCaseVortexMigrationExecutionApproval({
      ...input(), plannedMigrations: [...input().plannedMigrations].reverse(),
    })).toThrow('case_vortex_migration_approval_plan_invalid');
    const approval = buildCaseVortexMigrationExecutionApproval(input());
    expect(() => verifyCaseVortexMigrationExecutionApproval({
      ...approval, approvedBy: 'owner:someone-else',
    })).toThrow('case_vortex_migration_approval_derived_fields_invalid');
  });
});
