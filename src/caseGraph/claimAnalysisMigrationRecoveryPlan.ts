import { createHash } from 'node:crypto';

import {
  CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS,
  runCaseVortexClaimAnalysisMigrationRehearsalCli,
} from '../cli/buildCaseVortexClaimAnalysisMigrationRehearsal';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_PLAN_VERSION =
  'case-vortex-claim-analysis-migration-recovery-plan-v1' as const;
export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT =
  'I explicitly approve repairing only the verified Case Vortex 0214-0215 migration drift in this exact recovery plan. This does not approve publication activation or deployment.' as const;

type Rehearsal = Exclude<
  Awaited<ReturnType<typeof runCaseVortexClaimAnalysisMigrationRehearsalCli>>,
  { usage: string }
>;

type RecoveryAction = {
  ordinal: number;
  version: string;
  fileName: string;
  sha256: string;
  action: 'reapply_exact_migration_and_reconcile_missing_supabase_tracker';
  existingAppTrackerRequired: true;
  missingSupabaseTrackerRequired: true;
  transactionMode: 'single-transaction';
};

export type CaseVortexClaimAnalysisMigrationRecoveryPlan = {
  recordType: 'case_vortex_claim_analysis_migration_recovery_plan';
  schemaVersion: typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_PLAN_VERSION;
  planId: string;
  createdAt: string;
  freshRehearsalReceiptSha256: string;
  observedState: {
    appTrackerVersions: ['0213', '0214', '0215'];
    supabaseTrackerVersions: ['0213'];
    schemaSignatureVersions: ['0214'];
    activePublicationCount: 0;
  };
  recoveryActions: RecoveryAction[];
  recoveryBoundary: {
    exactObservedDriftRequired: true;
    exactLocalMigrationBytesRequired: true;
    freshReadOnlyRehearsalRequired: true;
    activePublicationCount: 0;
    recoveryExecutionApproved: false;
    publicationActivationApproved: false;
    deploymentApproved: false;
    requiredApprovalStatement:
      typeof CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT;
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
const rawSha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => (
  relationshipInputSha256(left) === relationshipInputSha256(right)
);
const timestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_timestamp_invalid');
  }
  try {
    if (new Date(value).toISOString() !== value) throw new Error();
  } catch {
    throw new Error('case_vortex_claim_analysis_migration_recovery_timestamp_invalid');
  }
  return value;
};

const expectedAppLedger = [
  '0213_case_vortex_saved_report_replay_2026_07_22.sql',
  ...CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(({ fileName }) => fileName),
];
const expectedSupabaseLedger = [
  '0213_case_vortex_saved_report_replay_2026_07_22',
];
const expectedSignatures = {
  function: true,
  persistence: false,
};
const expectedBlockers = [
  'remote:tracker_disagreement:0214',
  'remote:tracker_disagreement:0215',
];

export const buildCaseVortexClaimAnalysisMigrationRecoveryPlan = (input: {
  planId: string;
  createdAt: string;
  freshRehearsal: Rehearsal;
}): CaseVortexClaimAnalysisMigrationRecoveryPlan => {
  if (!ID.test(input.planId)) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_plan_id_invalid');
  }
  const createdAt = timestamp(input.createdAt);
  const rehearsal = input.freshRehearsal;
  const { receiptSha256, ...rehearsalCore } = rehearsal;
  const remote = rehearsal.remote;
  if (rehearsal.recordType !== 'case_vortex_claim_analysis_migration_rehearsal'
    || rehearsal.schemaVersion !== 'case-vortex-claim-analysis-migration-rehearsal-v1'
    || rawSha256(JSON.stringify(rehearsalCore)) !== receiptSha256
    || !remote || remote.checked !== true
    || remote.serverVersionNum < 170000
    || remote.baseMigrationPresent !== true
    || remote.activePublicationCount !== 0
    || rehearsal.readyForSeparateApproval !== false
    || rehearsal.plannedMigrations.length !== 0
    || !same(rehearsal.blockers, expectedBlockers)
    || !same(remote.appLedger, expectedAppLedger)
    || !same(remote.supabaseLedger, expectedSupabaseLedger)
    || remote.appliedVersions.length !== 0
    || remote.missingVersions.length !== 0
    || !same({
      function: remote.signatures.function_save_case_vortex_luna_turn_allows_analyze_case_claims
        ?? remote.signatures['function:save_case_vortex_luna_turn_allows_analyze_case_claims'],
      persistence: remote.signatures.persistence_case_vortex_luna_turns_claim_analyses
        ?? remote.signatures['persistence:case_vortex_luna_turns_claim_analyses'],
    }, expectedSignatures)
    || rehearsal.approvalBoundary.migrationApplicationApproved !== false
    || rehearsal.approvalBoundary.publicationApproved !== false
    || rehearsal.approvalBoundary.deploymentApproved !== false
    || rehearsal.guarantees.databaseWrites !== 0
    || rehearsal.guarantees.storageReads !== 0
    || rehearsal.guarantees.storageWrites !== 0
    || rehearsal.guarantees.lunaCalls !== 0
    || rehearsal.guarantees.publications !== 0
    || rehearsal.guarantees.deployments !== 0) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_rehearsal_invalid');
  }
  if (rehearsal.localChain.length !== CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.length
    || rehearsal.localChain.some((entry, index) => {
      const contract = CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS[index];
      return entry.version !== contract.version || entry.fileName !== contract.fileName
        || entry.sha256 !== contract.sha256 || entry.actualSha256 !== contract.sha256
        || entry.digestMatches !== true || entry.transactionMode !== 'single-transaction';
    })) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_local_chain_invalid');
  }
  const recoveryActions: RecoveryAction[] =
    CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map((contract, ordinal) => ({
      ordinal,
      version: contract.version,
      fileName: contract.fileName,
      sha256: contract.sha256,
      action: 'reapply_exact_migration_and_reconcile_missing_supabase_tracker',
      existingAppTrackerRequired: true,
      missingSupabaseTrackerRequired: true,
      transactionMode: 'single-transaction',
    }));
  const withoutDigest: Omit<CaseVortexClaimAnalysisMigrationRecoveryPlan, 'planSha256'> = {
    recordType: 'case_vortex_claim_analysis_migration_recovery_plan',
    schemaVersion: CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_PLAN_VERSION,
    planId: input.planId,
    createdAt,
    freshRehearsalReceiptSha256: receiptSha256,
    observedState: {
      appTrackerVersions: ['0213', '0214', '0215'],
      supabaseTrackerVersions: ['0213'],
      schemaSignatureVersions: ['0214'],
      activePublicationCount: 0,
    },
    recoveryActions,
    recoveryBoundary: {
      exactObservedDriftRequired: true,
      exactLocalMigrationBytesRequired: true,
      freshReadOnlyRehearsalRequired: true,
      activePublicationCount: 0,
      recoveryExecutionApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
      requiredApprovalStatement:
        CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_RECOVERY_APPROVAL_STATEMENT,
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

export const verifyCaseVortexClaimAnalysisMigrationRecoveryPlan = (
  value: CaseVortexClaimAnalysisMigrationRecoveryPlan,
  source: { freshRehearsal: Rehearsal },
) => {
  const rebuilt = buildCaseVortexClaimAnalysisMigrationRecoveryPlan({
    planId: value.planId,
    createdAt: value.createdAt,
    freshRehearsal: source.freshRehearsal,
  });
  if (!same(value, rebuilt)) {
    throw new Error('case_vortex_claim_analysis_migration_recovery_plan_tampered');
  }
  return rebuilt;
};
