import { createHash } from 'node:crypto';

import {
  CASE_VORTEX_MIGRATION_CONTRACTS,
  runCaseVortexRemoteRehearsalCli,
} from '../cli/buildCaseVortexRemoteRehearsal';
import { verifyCaseVortexMigrationExecutionReceipt } from '../db/approvedCaseVortexMigrationExecutor';
import { verifyCaseVortexMigrationExecutionApproval } from './migrationExecutionApproval';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_MIGRATION_RECOVERY_PLAN_VERSION =
  'case-vortex-migration-recovery-plan-v1' as const;
export const CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT =
  'I explicitly approve resuming only the remaining frozen Case Vortex migrations in this verified recovery plan. This does not approve publication activation or deployment.' as const;

type Rehearsal = Exclude<
  Awaited<ReturnType<typeof runCaseVortexRemoteRehearsalCli>>,
  { usage: string }
>;

export type CaseVortexMigrationRecoveryPlan = {
  recordType: 'case_vortex_migration_recovery_plan';
  schemaVersion: typeof CASE_VORTEX_MIGRATION_RECOVERY_PLAN_VERSION;
  planId: string;
  createdAt: string;
  originalApprovalId: string;
  originalApprovalSha256: string;
  failureReceiptSha256: string;
  freshRehearsalReceiptSha256: string;
  alreadyAppliedVersions: string[];
  remainingMigrations: Array<{
    version: string;
    fileName: string;
    sha256: string;
    transactionMode: 'autocommit-per-statement' | 'single-transaction';
  }>;
  recoveryBoundary: {
    alignedAppliedPrefixRequired: true;
    exactRemainingSuffixRequired: true;
    activePublicationCount: 0;
    freshReadOnlyRehearsalRequired: true;
    recoveryExecutionApproved: false;
    publicationActivationApproved: false;
    deploymentApproved: false;
    requiredApprovalStatement: typeof CASE_VORTEX_MIGRATION_RECOVERY_APPROVAL_STATEMENT;
  };
  guarantees: {
    databaseReadsDuringPlanning: 'bounded-read-only-transactions';
    databaseWritesDuringPlanning: 0;
    storageReadsDuringPlanning: 0;
    storageWritesDuringPlanning: 0;
    lunaCallsDuringPlanning: 0;
    publicationsDuringPlanning: 0;
    deploymentsDuringPlanning: 0;
  };
  planSha256: string;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const canonicalTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) {
    throw new Error('case_vortex_migration_recovery_timestamp_invalid');
  }
  try {
    if (new Date(value).toISOString() !== value) throw new Error();
  } catch {
    throw new Error('case_vortex_migration_recovery_timestamp_invalid');
  }
  return value;
};
const same = (left: readonly string[], right: readonly string[]) => (
  relationshipInputSha256(left) === relationshipInputSha256(right)
);
const rawSha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const buildCaseVortexMigrationRecoveryPlan = (input: {
  planId: string;
  createdAt: string;
  approval: unknown;
  failureReceipt: unknown;
  freshRehearsal: Rehearsal;
}): CaseVortexMigrationRecoveryPlan => {
  if (!ID.test(input.planId)) throw new Error('case_vortex_migration_recovery_plan_id_invalid');
  const createdAt = canonicalTimestamp(input.createdAt);
  const approval = verifyCaseVortexMigrationExecutionApproval(input.approval);
  const receipt = verifyCaseVortexMigrationExecutionReceipt(input.failureReceipt);
  if (receipt.recordType !== 'case_vortex_migration_execution_failure_receipt'
    || receipt.approvalId !== approval.approvalId
    || receipt.approvalSha256 !== approval.approvalSha256
    || receipt.rehearsalReceiptSha256 !== approval.rehearsalReceiptSha256
    || receipt.reconciliationRequired !== true) {
    throw new Error('case_vortex_migration_recovery_failure_binding_invalid');
  }
  if (receipt.failureStage === 'post_apply_verification') {
    throw new Error('case_vortex_migration_recovery_post_apply_diagnosis_required');
  }
  const rehearsal = input.freshRehearsal;
  const { receiptSha256: rehearsalReceiptSha256, ...rehearsalBody } = rehearsal || {} as Rehearsal;
  if (!rehearsal || rehearsal.recordType !== 'case_vortex_remote_rehearsal'
    || rehearsal.schemaVersion !== 'case-vortex-remote-rehearsal-v1'
    || rawSha256(JSON.stringify(rehearsalBody)) !== rehearsalReceiptSha256
    || !rehearsal.remote || rehearsal.remote.checked !== true
    || rehearsal.remote.activePublicationCount !== 0 || rehearsal.blockers.length
    || rehearsal.readyForApprovedMigrationExecution !== true
    || rehearsal.approvalBoundary.migrationApplicationApproved !== false
    || rehearsal.approvalBoundary.publicationApproved !== false
    || rehearsal.guarantees.databaseWrites !== 0
    || rehearsal.guarantees.storageWrites !== 0 || rehearsal.guarantees.publications !== 0) {
    throw new Error('case_vortex_migration_recovery_rehearsal_invalid');
  }
  if (rehearsal.localChain.length !== CASE_VORTEX_MIGRATION_CONTRACTS.length
    || rehearsal.localChain.some((entry, index) => {
      const contract = CASE_VORTEX_MIGRATION_CONTRACTS[index];
      return entry.version !== contract.version || entry.fileName !== contract.fileName
        || entry.sha256 !== contract.sha256 || entry.actualSha256 !== contract.sha256
        || entry.digestMatches !== true;
    })) {
    throw new Error('case_vortex_migration_recovery_local_chain_invalid');
  }
  const expectedVersions = CASE_VORTEX_MIGRATION_CONTRACTS.map(({ version }) => version);
  const applied = rehearsal.remote.appliedVersions;
  if (!applied.length || applied.length >= expectedVersions.length
    || !same(applied, expectedVersions.slice(0, applied.length))) {
    throw new Error('case_vortex_migration_recovery_applied_prefix_invalid');
  }
  const expectedAppLedger = CASE_VORTEX_MIGRATION_CONTRACTS.slice(0, applied.length)
    .map(({ fileName }) => fileName);
  const expectedSupabaseLedger = expectedAppLedger.map((fileName) => fileName.replace(/\.sql$/u, ''));
  if (!same(rehearsal.remote.appLedger, expectedAppLedger)
    || !same(rehearsal.remote.supabaseLedger, expectedSupabaseLedger)
    || receipt.applied.length > applied.length
    || !same(receipt.applied.map(({ version }) => version), applied.slice(0, receipt.applied.length))) {
    throw new Error('case_vortex_migration_recovery_ledger_binding_invalid');
  }
  const remainingContracts = CASE_VORTEX_MIGRATION_CONTRACTS.slice(applied.length);
  const expectedRemainingFiles = remainingContracts.map(({ fileName }) => fileName);
  if (!same(rehearsal.plannedMigrations, expectedRemainingFiles)) {
    throw new Error('case_vortex_migration_recovery_remaining_suffix_invalid');
  }
  const unresolved = new Set([
    ...rehearsal.remote.missingVersions,
    ...rehearsal.remote.reconciliationVersions,
  ]);
  if (unresolved.size !== remainingContracts.length
    || remainingContracts.some(({ version }) => !unresolved.has(version))) {
    throw new Error('case_vortex_migration_recovery_remaining_suffix_invalid');
  }
  const remainingMigrations = remainingContracts.map((contract, index) => ({
    version: contract.version,
    fileName: contract.fileName,
    sha256: contract.sha256,
    transactionMode: applied.length + index < 2
      ? 'autocommit-per-statement' as const : 'single-transaction' as const,
  }));
  const withoutDigest: Omit<CaseVortexMigrationRecoveryPlan, 'planSha256'> = {
    recordType: 'case_vortex_migration_recovery_plan',
    schemaVersion: CASE_VORTEX_MIGRATION_RECOVERY_PLAN_VERSION,
    planId: input.planId,
    createdAt,
    originalApprovalId: approval.approvalId,
    originalApprovalSha256: approval.approvalSha256,
    failureReceiptSha256: receipt.receiptSha256,
    freshRehearsalReceiptSha256: rehearsal.receiptSha256,
    alreadyAppliedVersions: [...applied],
    remainingMigrations,
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

export const verifyCaseVortexMigrationRecoveryPlan = (
  value: CaseVortexMigrationRecoveryPlan,
  source: Omit<Parameters<typeof buildCaseVortexMigrationRecoveryPlan>[0], 'planId' | 'createdAt'>,
) => {
  if (!value || value.recordType !== 'case_vortex_migration_recovery_plan'
    || value.schemaVersion !== CASE_VORTEX_MIGRATION_RECOVERY_PLAN_VERSION) {
    throw new Error('case_vortex_migration_recovery_plan_invalid');
  }
  const rebuilt = buildCaseVortexMigrationRecoveryPlan({
    planId: value.planId,
    createdAt: value.createdAt,
    ...source,
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    throw new Error('case_vortex_migration_recovery_plan_tampered');
  }
  return rebuilt;
};
