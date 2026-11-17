import {
  CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
  CASE_VORTEX_MIGRATION_RECOVERY_PLAN_VERSION,
  type CaseVortexMigrationRecoveryPlan,
} from './migrationRecoveryPlan';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_VERSION =
  'case-vortex-migration-recovery-approval-v1' as const;
export const CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_SCOPE =
  'resume_only_the_exact_remaining_case_vortex_migration_suffix' as const;

export type CaseVortexMigrationRecoveryApproval = {
  recordType: 'case_vortex_migration_recovery_approval';
  schemaVersion: typeof CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_SCOPE;
  recoveryPlanId: string;
  recoveryPlanSha256: string;
  originalApprovalSha256: string;
  failureReceiptSha256: string;
  freshRehearsalReceiptSha256: string;
  remainingMigrations: string[];
  authorizationStatement: typeof CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT;
  recoveryExecutionApproved: true;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const invalid = (code: string): never => { throw new Error(code); };

const canonicalTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) {
    invalid('case_vortex_migration_recovery_approval_timestamp_invalid');
  }
  const candidate = value as string;
  try {
    if (new Date(candidate).toISOString() !== candidate) invalid('case_vortex_migration_recovery_approval_timestamp_invalid');
  } catch {
    invalid('case_vortex_migration_recovery_approval_timestamp_invalid');
  }
  return candidate;
};

const verifyPlanEnvelope = (value: CaseVortexMigrationRecoveryPlan) => {
  if (!value || value.recordType !== 'case_vortex_migration_recovery_plan'
    || value.schemaVersion !== CASE_VORTEX_MIGRATION_RECOVERY_PLAN_VERSION
    || !SHA256.test(value.planSha256)
    || value.recoveryBoundary.recoveryExecutionApproved !== false
    || value.recoveryBoundary.publicationActivationApproved !== false
    || value.recoveryBoundary.deploymentApproved !== false
    || !value.remainingMigrations.length) {
    invalid('case_vortex_migration_recovery_approval_plan_invalid');
  }
  const { planSha256, ...withoutDigest } = value;
  if (relationshipInputSha256(withoutDigest) !== planSha256) {
    invalid('case_vortex_migration_recovery_approval_plan_invalid');
  }
  return value;
};

export const buildCaseVortexMigrationRecoveryApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  recoveryPlan: CaseVortexMigrationRecoveryPlan;
  authorizationStatement: string;
  recoveryExecutionApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexMigrationRecoveryApproval => {
  if (!UUID.test(input.approvalId)) invalid('case_vortex_migration_recovery_approval_id_invalid');
  if (!ID.test(input.approvedBy)) invalid('case_vortex_migration_recovery_approval_identity_invalid');
  const approvedAt = canonicalTimestamp(input.approvedAt);
  const plan = verifyPlanEnvelope(input.recoveryPlan);
  if (input.authorizationStatement !== CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT
    || input.recoveryExecutionApproved !== true
    || input.publicationActivationApproved !== false || input.deploymentApproved !== false) {
    invalid('case_vortex_migration_recovery_approval_scope_invalid');
  }
  const withoutDigest: Omit<CaseVortexMigrationRecoveryApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_migration_recovery_approval',
    schemaVersion: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    scope: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_SCOPE,
    recoveryPlanId: plan.planId,
    recoveryPlanSha256: plan.planSha256,
    originalApprovalSha256: plan.originalApprovalSha256,
    failureReceiptSha256: plan.failureReceiptSha256,
    freshRehearsalReceiptSha256: plan.freshRehearsalReceiptSha256,
    remainingMigrations: plan.remainingMigrations.map(({ fileName }) => fileName),
    authorizationStatement: CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
    recoveryExecutionApproved: true,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return { ...withoutDigest, approvalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexMigrationRecoveryApproval = (
  value: unknown,
  recoveryPlan: CaseVortexMigrationRecoveryPlan,
): CaseVortexMigrationRecoveryApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('case_vortex_migration_recovery_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt', 'scope',
    'recoveryPlanId', 'recoveryPlanSha256', 'originalApprovalSha256',
    'failureReceiptSha256', 'freshRehearsalReceiptSha256', 'remainingMigrations',
    'authorizationStatement', 'recoveryExecutionApproved',
    'publicationActivationApproved', 'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
    || candidate.recordType !== 'case_vortex_migration_recovery_approval'
    || candidate.schemaVersion !== CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_VERSION
    || candidate.scope !== CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_SCOPE
    || typeof candidate.approvalSha256 !== 'string' || !SHA256.test(candidate.approvalSha256)) {
    invalid('case_vortex_migration_recovery_approval_invalid');
  }
  const rebuilt = buildCaseVortexMigrationRecoveryApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    recoveryPlan,
    authorizationStatement: candidate.authorizationStatement as string,
    recoveryExecutionApproved: candidate.recoveryExecutionApproved as boolean,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    invalid('case_vortex_migration_recovery_approval_derived_fields_invalid');
  }
  return rebuilt;
};
