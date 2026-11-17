import { createHash } from 'node:crypto';

import {
  CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS,
  CASE_VORTEX_MIGRATION_CONTRACTS,
  runCaseVortexRemoteRehearsalCli,
} from '../cli/buildCaseVortexRemoteRehearsal';
import { verifyCaseVortexMigrationExecutionReceipt } from '../db/approvedCaseVortexMigrationExecutor';
import { verifyCaseVortexMigrationExecutionApproval } from './migrationExecutionApproval';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_MIGRATION_POST_APPLY_DIAGNOSIS_VERSION =
  'case-vortex-migration-post-apply-diagnosis-v1' as const;

type Rehearsal = Exclude<
  Awaited<ReturnType<typeof runCaseVortexRemoteRehearsalCli>>,
  { usage: string }
>;

export type CaseVortexMigrationPostApplyDiagnosisClassification =
  | 'verification_restored'
  | 'schema_drift'
  | 'tracker_drift'
  | 'active_publication_conflict'
  | 'unresolved_remote_state';

export type CaseVortexMigrationPostApplyDiagnosis = {
  recordType: 'case_vortex_migration_post_apply_diagnosis';
  schemaVersion: typeof CASE_VORTEX_MIGRATION_POST_APPLY_DIAGNOSIS_VERSION;
  diagnosisId: string;
  createdAt: string;
  originalApprovalId: string;
  originalApprovalSha256: string;
  failureReceiptSha256: string;
  freshRehearsalReceiptSha256: string;
  freshRehearsal: Rehearsal;
  classification: CaseVortexMigrationPostApplyDiagnosisClassification;
  observed: {
    appliedVersions: string[];
    missingVersions: string[];
    reconciliationVersions: string[];
    failedSignatureKeys: string[];
    blockers: string[];
    activePublicationCount: number;
  };
  boundary: {
    allFrozenMigrationsApplied: boolean;
    exactSchemaVerified: boolean;
    exactTrackersVerified: boolean;
    verificationRestoredWithoutReplay: boolean;
    migrationReplayAllowed: false;
    remoteMutationRequired: boolean;
    publicationActivationApproved: false;
    deploymentApproved: false;
  };
  guarantees: {
    databaseReads: 'bounded-read-only-transactions';
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    publications: 0;
    deployments: 0;
  };
  diagnosisSha256: string;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const rawSha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => (
  relationshipInputSha256(left) === relationshipInputSha256(right)
);
const timestamp = (value: string) => {
  if (value.length > 40) throw new Error('case_vortex_migration_post_apply_diagnosis_timestamp_invalid');
  try {
    if (new Date(value).toISOString() !== value) throw new Error();
  } catch {
    throw new Error('case_vortex_migration_post_apply_diagnosis_timestamp_invalid');
  }
  return value;
};

const verifyFreshRehearsal = (rehearsal: Rehearsal) => {
  const { receiptSha256, ...body } = rehearsal || {} as Rehearsal;
  const expectedVersions = CASE_VORTEX_MIGRATION_CONTRACTS.map(({ version }) => version);
  const expectedFiles = CASE_VORTEX_MIGRATION_CONTRACTS.map(({ fileName }) => fileName);
  const expectedStems = expectedFiles.map((fileName) => fileName.replace(/\.sql$/u, ''));
  const signatureKeys = Object.keys(rehearsal?.remote?.signatures || {}).sort();
  if (!rehearsal || rehearsal.recordType !== 'case_vortex_remote_rehearsal'
    || rehearsal.schemaVersion !== 'case-vortex-remote-rehearsal-v1'
    || rawSha256(JSON.stringify(body)) !== receiptSha256
    || !rehearsal.remote || rehearsal.remote.checked !== true
    || rehearsal.localChain.length !== CASE_VORTEX_MIGRATION_CONTRACTS.length
    || rehearsal.localChain.some((entry, index) => {
      const contract = CASE_VORTEX_MIGRATION_CONTRACTS[index];
      return entry.version !== contract.version || entry.fileName !== contract.fileName
        || entry.sha256 !== contract.sha256 || entry.actualSha256 !== contract.sha256
        || entry.digestMatches !== true;
    })
    || !same(signatureKeys, [...CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS].sort())
    || rehearsal.approvalBoundary.migrationApplicationApproved !== false
    || rehearsal.approvalBoundary.publicationApproved !== false
    || rehearsal.guarantees.databaseWrites !== 0
    || rehearsal.guarantees.storageReads !== 0
    || rehearsal.guarantees.storageWrites !== 0
    || rehearsal.guarantees.lunaCalls !== 0
    || rehearsal.guarantees.publications !== 0) {
    throw new Error('case_vortex_migration_post_apply_diagnosis_rehearsal_invalid');
  }
  return { expectedVersions, expectedFiles, expectedStems };
};

export const buildCaseVortexMigrationPostApplyDiagnosis = (input: {
  diagnosisId: string;
  createdAt: string;
  approval: unknown;
  failureReceipt: unknown;
  freshRehearsal: Rehearsal;
}): CaseVortexMigrationPostApplyDiagnosis => {
  if (!ID.test(input.diagnosisId)) {
    throw new Error('case_vortex_migration_post_apply_diagnosis_id_invalid');
  }
  const createdAt = timestamp(input.createdAt);
  const approval = verifyCaseVortexMigrationExecutionApproval(input.approval);
  const failure = verifyCaseVortexMigrationExecutionReceipt(input.failureReceipt);
  if (failure.recordType !== 'case_vortex_migration_execution_failure_receipt'
    || failure.failureStage !== 'post_apply_verification'
    || failure.approvalId !== approval.approvalId
    || failure.approvalSha256 !== approval.approvalSha256
    || failure.rehearsalReceiptSha256 !== approval.rehearsalReceiptSha256
    || failure.reconciliationRequired !== true
    || failure.applied.length !== CASE_VORTEX_MIGRATION_CONTRACTS.length) {
    throw new Error('case_vortex_migration_post_apply_diagnosis_failure_binding_invalid');
  }
  const expected = verifyFreshRehearsal(input.freshRehearsal);
  const remote = input.freshRehearsal.remote!;
  const failedSignatureKeys = CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS
    .filter((key) => remote.signatures[key] !== true)
    .sort();
  const exactTrackersVerified = same(remote.appLedger, expected.expectedFiles)
    && same(remote.supabaseLedger, expected.expectedStems);
  const allFrozenMigrationsApplied = same(remote.appliedVersions, expected.expectedVersions)
    && remote.missingVersions.length === 0 && remote.reconciliationVersions.length === 0;
  const exactSchemaVerified = failedSignatureKeys.length === 0;
  const verificationRestored = allFrozenMigrationsApplied && exactSchemaVerified
    && exactTrackersVerified && remote.activePublicationCount === 0
    && input.freshRehearsal.blockers.length === 0
    && input.freshRehearsal.plannedMigrations.length === 0
    && input.freshRehearsal.readyForApprovedMigrationExecution === true;
  const blockers = [...input.freshRehearsal.blockers].sort();
  const classification: CaseVortexMigrationPostApplyDiagnosisClassification = verificationRestored
    ? 'verification_restored'
    : remote.activePublicationCount !== 0
      ? 'active_publication_conflict'
      : blockers.some((value) => value.startsWith('remote:tracker_disagreement:')
        || value.startsWith('remote:unexpected_')) || !exactTrackersVerified
        ? 'tracker_drift'
        : failedSignatureKeys.length > 0
          ? 'schema_drift'
          : 'unresolved_remote_state';
  const withoutDigest: Omit<CaseVortexMigrationPostApplyDiagnosis, 'diagnosisSha256'> = {
    recordType: 'case_vortex_migration_post_apply_diagnosis',
    schemaVersion: CASE_VORTEX_MIGRATION_POST_APPLY_DIAGNOSIS_VERSION,
    diagnosisId: input.diagnosisId,
    createdAt,
    originalApprovalId: approval.approvalId,
    originalApprovalSha256: approval.approvalSha256,
    failureReceiptSha256: failure.receiptSha256,
    freshRehearsalReceiptSha256: input.freshRehearsal.receiptSha256,
    freshRehearsal: input.freshRehearsal,
    classification,
    observed: {
      appliedVersions: [...remote.appliedVersions],
      missingVersions: [...remote.missingVersions],
      reconciliationVersions: [...remote.reconciliationVersions],
      failedSignatureKeys,
      blockers,
      activePublicationCount: remote.activePublicationCount,
    },
    boundary: {
      allFrozenMigrationsApplied,
      exactSchemaVerified,
      exactTrackersVerified,
      verificationRestoredWithoutReplay: verificationRestored,
      migrationReplayAllowed: false,
      remoteMutationRequired: !verificationRestored,
      publicationActivationApproved: false,
      deploymentApproved: false,
    },
    guarantees: {
      databaseReads: 'bounded-read-only-transactions',
      databaseWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      lunaCalls: 0,
      publications: 0,
      deployments: 0,
    },
  };
  return { ...withoutDigest, diagnosisSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexMigrationPostApplyDiagnosis = (
  value: unknown,
  source: {
    approval: unknown;
    failureReceipt: unknown;
  },
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('case_vortex_migration_post_apply_diagnosis_invalid');
  }
  const candidate = value as CaseVortexMigrationPostApplyDiagnosis;
  const rebuilt = buildCaseVortexMigrationPostApplyDiagnosis({
    diagnosisId: candidate.diagnosisId,
    createdAt: candidate.createdAt,
    approval: source.approval,
    failureReceipt: source.failureReceipt,
    freshRehearsal: candidate.freshRehearsal,
  });
  if (!same(candidate, rebuilt)) {
    throw new Error('case_vortex_migration_post_apply_diagnosis_tampered');
  }
  return rebuilt;
};
