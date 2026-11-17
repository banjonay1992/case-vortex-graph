import { createHash } from 'node:crypto';

import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_FILE =
  '0218_case_vortex_saved_claim_analyses_privileges_2026_07_27.sql' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_VERSION = '0218' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_PLAN_VERSION =
  'case-vortex-claim-analysis-privilege-repair-plan-v1' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_VERSION =
  'case-vortex-claim-analysis-privilege-repair-approval-v1' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT =
  'I explicitly approve applying only the sealed 0218 Case Vortex function privilege repair in this exact plan. This does not approve publication activation or deployment.' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_SCOPE =
  'repair_case_vortex_0215_saved_claim_analysis_function_privileges_only' as const;

export type CaseVortexClaimAnalysisPrivilegeState = {
  serverVersionNum: number;
  app0214Present: boolean;
  supabase0214Present: boolean;
  app0215Present: boolean;
  supabase0215Present: boolean;
  appRepairPresent: boolean;
  supabaseRepairPresent: boolean;
  columnValid: boolean;
  constraintValid: boolean;
  functionPresent: boolean;
  anonExecute: boolean;
  authenticatedExecute: boolean;
  serviceRoleExecute: boolean;
  publicExecute: boolean;
  activePublicationCount: number;
};

export type CaseVortexClaimAnalysisPrivilegeRepairPlan = {
  recordType: 'case_vortex_claim_analysis_privilege_repair_plan';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_PLAN_VERSION;
  planId: string;
  createdAt: string;
  failedRecoveryReceiptSha256: string;
  observedState: CaseVortexClaimAnalysisPrivilegeState;
  repair: {
    version: typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_VERSION;
    fileName: typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_FILE;
    sha256: string;
    action: 'revoke_direct_execute_from_anon_and_authenticated';
    transactionMode: 'single-transaction';
    appTrackerWrite: 1;
    supabaseTrackerWrite: 1;
  };
  boundary: {
    exactObservedStateRequired: true;
    exactMigrationBytesRequired: true;
    activePublicationCount: 0;
    repairExecutionApproved: false;
    publicationActivationApproved: false;
    deploymentApproved: false;
    requiredApprovalStatement:
      typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT;
  };
  guarantees: {
    databaseReadsDuringPlanning: 'bounded-read-only-transaction';
    databaseWritesDuringPlanning: 0;
    storageReadsDuringPlanning: 0;
    storageWritesDuringPlanning: 0;
    lunaCallsDuringPlanning: 0;
    publicationsDuringPlanning: 0;
    deploymentsDuringPlanning: 0;
  };
  planSha256: string;
};

export type CaseVortexClaimAnalysisPrivilegeRepairApproval = {
  recordType: 'case_vortex_claim_analysis_privilege_repair_approval';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  scope: typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_SCOPE;
  planId: string;
  planSha256: string;
  repairSha256: string;
  authorizationStatement:
    typeof CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const fail = (code: string): never => { throw new Error(code); };
export const claimAnalysisPrivilegeRepairRawSha256 = (value: Buffer | string) => (
  createHash('sha256').update(value).digest('hex')
);
const timestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) {
    fail('case_vortex_claim_analysis_privilege_repair_timestamp_invalid');
  }
  try {
    if (new Date(value as string).toISOString() !== value) throw new Error();
  } catch {
    fail('case_vortex_claim_analysis_privilege_repair_timestamp_invalid');
  }
  return value as string;
};
const exactState = (state: CaseVortexClaimAnalysisPrivilegeState) => (
  Number.isSafeInteger(state.serverVersionNum) && state.serverVersionNum >= 170000
  && state.app0214Present && state.supabase0214Present
  && state.app0215Present && state.supabase0215Present
  && !state.appRepairPresent && !state.supabaseRepairPresent
  && state.columnValid && state.constraintValid && state.functionPresent
  && state.anonExecute && state.authenticatedExecute
  && state.serviceRoleExecute && !state.publicExecute
  && state.activePublicationCount === 0
);

export const buildCaseVortexClaimAnalysisPrivilegeRepairPlan = (input: {
  planId: string;
  createdAt: string;
  failedRecoveryReceiptSha256: string;
  observedState: CaseVortexClaimAnalysisPrivilegeState;
  migrationSha256: string;
}) => {
  if (!ID.test(input.planId)) fail('case_vortex_claim_analysis_privilege_repair_plan_id_invalid');
  const createdAt = timestamp(input.createdAt);
  if (!SHA256.test(input.failedRecoveryReceiptSha256)
    || !SHA256.test(input.migrationSha256)
    || !exactState(input.observedState)) {
    fail('case_vortex_claim_analysis_privilege_repair_boundary_invalid');
  }
  const body: Omit<CaseVortexClaimAnalysisPrivilegeRepairPlan, 'planSha256'> = {
    recordType: 'case_vortex_claim_analysis_privilege_repair_plan',
    schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_PLAN_VERSION,
    planId: input.planId,
    createdAt,
    failedRecoveryReceiptSha256: input.failedRecoveryReceiptSha256,
    observedState: { ...input.observedState },
    repair: {
      version: CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_VERSION,
      fileName: CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_FILE,
      sha256: input.migrationSha256,
      action: 'revoke_direct_execute_from_anon_and_authenticated',
      transactionMode: 'single-transaction',
      appTrackerWrite: 1,
      supabaseTrackerWrite: 1,
    },
    boundary: {
      exactObservedStateRequired: true,
      exactMigrationBytesRequired: true,
      activePublicationCount: 0,
      repairExecutionApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
      requiredApprovalStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT,
    },
    guarantees: {
      databaseReadsDuringPlanning: 'bounded-read-only-transaction',
      databaseWritesDuringPlanning: 0,
      storageReadsDuringPlanning: 0,
      storageWritesDuringPlanning: 0,
      lunaCallsDuringPlanning: 0,
      publicationsDuringPlanning: 0,
      deploymentsDuringPlanning: 0,
    },
  };
  return { ...body, planSha256: relationshipInputSha256(body) };
};

export const verifyCaseVortexClaimAnalysisPrivilegeRepairPlan = (
  value: CaseVortexClaimAnalysisPrivilegeRepairPlan,
) => {
  const rebuilt = buildCaseVortexClaimAnalysisPrivilegeRepairPlan({
    planId: value.planId,
    createdAt: value.createdAt,
    failedRecoveryReceiptSha256: value.failedRecoveryReceiptSha256,
    observedState: value.observedState,
    migrationSha256: value.repair.sha256,
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    fail('case_vortex_claim_analysis_privilege_repair_plan_tampered');
  }
  return rebuilt;
};

export const buildCaseVortexClaimAnalysisPrivilegeRepairApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  plan: CaseVortexClaimAnalysisPrivilegeRepairPlan;
  authorizationStatement: string;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}) => {
  if (!UUID.test(input.approvalId) || !ID.test(input.approvedBy)) {
    fail('case_vortex_claim_analysis_privilege_repair_approval_identity_invalid');
  }
  const approvedAt = timestamp(input.approvedAt);
  const plan = verifyCaseVortexClaimAnalysisPrivilegeRepairPlan(input.plan);
  if (input.authorizationStatement
      !== CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT
    || input.publicationActivationApproved !== false
    || input.deploymentApproved !== false) {
    fail('case_vortex_claim_analysis_privilege_repair_approval_scope_invalid');
  }
  const body: Omit<CaseVortexClaimAnalysisPrivilegeRepairApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_claim_analysis_privilege_repair_approval',
    schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    expiresAt: new Date(Date.parse(approvedAt) + ONE_HOUR_MS).toISOString(),
    scope: CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_SCOPE,
    planId: plan.planId,
    planSha256: plan.planSha256,
    repairSha256: plan.repair.sha256,
    authorizationStatement: CASE_VORTEX_CLAIM_ANALYSIS_PRIVILEGE_REPAIR_APPROVAL_STATEMENT,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return { ...body, approvalSha256: relationshipInputSha256(body) };
};

export const verifyCaseVortexClaimAnalysisPrivilegeRepairApproval = (
  value: CaseVortexClaimAnalysisPrivilegeRepairApproval,
  source: { plan: CaseVortexClaimAnalysisPrivilegeRepairPlan; verifiedAt: string },
) => {
  const rebuilt = buildCaseVortexClaimAnalysisPrivilegeRepairApproval({
    approvalId: value.approvalId,
    approvedBy: value.approvedBy,
    approvedAt: value.approvedAt,
    plan: source.plan,
    authorizationStatement: value.authorizationStatement,
    publicationActivationApproved: value.publicationActivationApproved,
    deploymentApproved: value.deploymentApproved,
  });
  const verifiedAt = timestamp(source.verifiedAt);
  if (verifiedAt < rebuilt.approvedAt || verifiedAt > rebuilt.expiresAt
    || relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    fail('case_vortex_claim_analysis_privilege_repair_approval_invalid');
  }
  return rebuilt;
};
