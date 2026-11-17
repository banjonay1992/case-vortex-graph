import {
  CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
  verifyCaseVortexClaimAnalysisMigrationRecoveryPlan,
  type CaseVortexClaimAnalysisMigrationRecoveryPlan,
} from './claimAnalysisMigrationRecoveryPlan';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { runCaseVortexClaimAnalysisMigrationRehearsalCli } from '../cli/buildCaseVortexClaimAnalysisMigrationRehearsal';

export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_VERSION =
  'case-vortex-claim-analysis-migration-recovery-approval-v1' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_SCOPE =
  'repair_verified_case_vortex_0214_0215_migration_drift_only' as const;
const MAX_AGE_MS = 60 * 60 * 1_000;

type Rehearsal = Exclude<
  Awaited<ReturnType<typeof runCaseVortexClaimAnalysisMigrationRehearsalCli>>,
  { usage: string }
>;

export type CaseVortexClaimAnalysisMigrationRecoveryApproval = {
  recordType: 'case_vortex_claim_analysis_migration_recovery_approval';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  scope: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_SCOPE;
  planId: string;
  planSha256: string;
  rehearsalReceiptSha256: string;
  recoveryActionDigests: string[];
  authorizationStatement:
    typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new Error(code); };
const timestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_time_invalid');
  }
  try {
    if (new Date(value as string).toISOString() !== value) throw new Error();
  } catch {
    fail('case_vortex_claim_analysis_migration_recovery_approval_time_invalid');
  }
  return value as string;
};
const exactKeys = (value: object, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_invalid');
  }
};
const actionDigests = (plan: CaseVortexClaimAnalysisMigrationRecoveryPlan) => (
  plan.recoveryActions.map((action) => relationshipInputSha256(action))
);

export const buildCaseVortexClaimAnalysisMigrationRecoveryApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  plan: CaseVortexClaimAnalysisMigrationRecoveryPlan;
  freshRehearsal: Rehearsal;
  authorizationStatement: string;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexClaimAnalysisMigrationRecoveryApproval => {
  if (!UUID.test(input.approvalId)) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_id_invalid');
  }
  if (!ID.test(input.approvedBy)) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_identity_invalid');
  }
  const approvedAt = timestamp(input.approvedAt);
  const expiresAt = new Date(Date.parse(approvedAt) + MAX_AGE_MS).toISOString();
  const plan = verifyCaseVortexClaimAnalysisMigrationRecoveryPlan(input.plan, {
    freshRehearsal: input.freshRehearsal,
  });
  if (input.authorizationStatement
      !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT
    || input.publicationActivationApproved !== false
    || input.deploymentApproved !== false) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_scope_invalid');
  }
  const withoutDigest:
    Omit<CaseVortexClaimAnalysisMigrationRecoveryApproval, 'approvalSha256'> = {
      recordType: 'case_vortex_claim_analysis_migration_recovery_approval',
      schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_VERSION,
      approvalId: input.approvalId,
      approvedBy: input.approvedBy,
      approvedAt,
      expiresAt,
      scope: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_SCOPE,
      planId: plan.planId,
      planSha256: plan.planSha256,
      rehearsalReceiptSha256: input.freshRehearsal.receiptSha256,
      recoveryActionDigests: actionDigests(plan),
      authorizationStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
      publicationActivationApproved: false,
      deploymentApproved: false,
    };
  return { ...withoutDigest, approvalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexClaimAnalysisMigrationRecoveryApproval = (
  value: unknown,
  source: {
    plan: CaseVortexClaimAnalysisMigrationRecoveryPlan;
    freshRehearsal: Rehearsal;
    verifiedAt: string;
  },
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  exactKeys(candidate, [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'expiresAt', 'scope', 'planId', 'planSha256', 'rehearsalReceiptSha256',
    'recoveryActionDigests', 'authorizationStatement',
    'publicationActivationApproved', 'deploymentApproved', 'approvalSha256',
  ]);
  if (candidate.recordType !== 'case_vortex_claim_analysis_migration_recovery_approval'
    || candidate.schemaVersion !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_VERSION
    || candidate.scope !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_SCOPE
    || !SHA256.test(String(candidate.approvalSha256 || ''))) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_invalid');
  }
  const rebuilt = buildCaseVortexClaimAnalysisMigrationRecoveryApproval({
    approvalId: String(candidate.approvalId),
    approvedBy: String(candidate.approvedBy),
    approvedAt: String(candidate.approvedAt),
    plan: source.plan,
    freshRehearsal: source.freshRehearsal,
    authorizationStatement: String(candidate.authorizationStatement),
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  const verifiedAt = timestamp(source.verifiedAt);
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)
    || String(candidate.expiresAt) !== rebuilt.expiresAt
    || verifiedAt < rebuilt.approvedAt || verifiedAt > rebuilt.expiresAt) {
    fail('case_vortex_claim_analysis_migration_recovery_approval_invalid');
  }
  return rebuilt;
};
