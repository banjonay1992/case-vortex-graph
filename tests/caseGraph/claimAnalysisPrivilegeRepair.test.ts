import { describe, expect, it } from 'vitest';

import {
  CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT,
  buildCaseVortexClaimAnalysisPrivilegeRepairApproval,
  buildCaseVortexClaimAnalysisPrivilegeRepairPlan,
  verifyCaseVortexClaimAnalysisPrivilegeRepairApproval,
  verifyCaseVortexClaimAnalysisPrivilegeRepairPlan,
  type CaseVortexClaimAnalysisPrivilegeState,
} from '../../src/caseGraph/claimAnalysisPrivilegeRepair';

const state = (): CaseVortexClaimAnalysisPrivilegeState => ({
  serverVersionNum: 170006,
  app0214Present: true,
  supabase0214Present: true,
  app0215Present: true,
  supabase0215Present: true,
  appRepairPresent: false,
  supabaseRepairPresent: false,
  columnValid: true,
  constraintValid: true,
  functionPresent: true,
  anonExecute: true,
  authenticatedExecute: true,
  serviceRoleExecute: true,
  publicExecute: false,
  activePublicationCount: 0,
});

describe('Case Vortex claim-analysis privilege repair controls', () => {
  it('seals the exact observed defect and requires a separate narrow approval', () => {
    const plan = buildCaseVortexClaimAnalysisPrivilegeRepairPlan({
      planId: 'repair-2026-07-27',
      createdAt: '2026-07-27T13:00:00.000Z',
      failedRecoveryReceiptSha256: 'a'.repeat(64),
      observedState: state(),
      migrationSha256: 'b'.repeat(64),
    });
    expect(verifyCaseVortexClaimAnalysisPrivilegeRepairPlan(plan)).toEqual(plan);
    expect(plan.repair).toMatchObject({
      version: '0218',
      action: 'revoke_direct_execute_from_anon_and_authenticated',
      appTrackerWrite: 1,
      supabaseTrackerWrite: 1,
    });
    expect(plan.boundary).toMatchObject({
      publicationActivationApproved: false,
      deploymentApproved: false,
    });

    const approval = buildCaseVortexClaimAnalysisPrivilegeRepairApproval({
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-27T13:01:00.000Z',
      plan,
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(verifyCaseVortexClaimAnalysisPrivilegeRepairApproval(approval, {
      plan,
      verifiedAt: '2026-07-27T13:30:00.000Z',
    })).toEqual(approval);
  });

  it('rejects already repaired, published, incomplete, tampered, broad, and expired states', () => {
    for (const observedState of [
      { ...state(), anonExecute: false },
      { ...state(), appRepairPresent: true },
      { ...state(), serviceRoleExecute: false },
      { ...state(), activePublicationCount: 1 },
    ]) {
      expect(() => buildCaseVortexClaimAnalysisPrivilegeRepairPlan({
        planId: 'repair',
        createdAt: '2026-07-27T13:00:00.000Z',
        failedRecoveryReceiptSha256: 'a'.repeat(64),
        observedState,
        migrationSha256: 'b'.repeat(64),
      })).toThrow('case_vortex_claim_analysis_privilege_repair_boundary_invalid');
    }
    const plan = buildCaseVortexClaimAnalysisPrivilegeRepairPlan({
      planId: 'repair',
      createdAt: '2026-07-27T13:00:00.000Z',
      failedRecoveryReceiptSha256: 'a'.repeat(64),
      observedState: state(),
      migrationSha256: 'b'.repeat(64),
    });
    expect(() => verifyCaseVortexClaimAnalysisPrivilegeRepairPlan({
      ...plan,
      repair: { ...plan.repair, sha256: 'c'.repeat(64) },
    })).toThrow('case_vortex_claim_analysis_privilege_repair_plan_tampered');
    expect(() => buildCaseVortexClaimAnalysisPrivilegeRepairApproval({
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-27T13:01:00.000Z',
      plan,
      authorizationStatement: 'approve everything',
      publicationActivationApproved: false,
      deploymentApproved: false,
    })).toThrow('case_vortex_claim_analysis_privilege_repair_approval_scope_invalid');
    const approval = buildCaseVortexClaimAnalysisPrivilegeRepairApproval({
      approvalId: '123e4567-e89b-42d3-a456-426614174000',
      approvedBy: 'operator:test',
      approvedAt: '2026-07-27T13:01:00.000Z',
      plan,
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(() => verifyCaseVortexClaimAnalysisPrivilegeRepairApproval(approval, {
      plan,
      verifiedAt: '2026-07-27T14:01:00.001Z',
    })).toThrow('case_vortex_claim_analysis_privilege_repair_approval_invalid');
  });
});
