import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT,
  buildCaseVortexMigrationExecutionApproval,
  caseVortexMigrationApprovalPlannedMigrations,
} from '../../src/caseGraph/migrationExecutionApproval';
import {
  buildCaseVortexMigrationPostApplyDiagnosis,
  verifyCaseVortexMigrationPostApplyDiagnosis,
} from '../../src/caseGraph/migrationPostApplyDiagnosis';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS,
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

const applied = CASE_VORTEX_MIGRATION_CONTRACTS.map((contract, index) => ({
  version: contract.version,
  fileName: contract.fileName,
  sha256: contract.sha256,
  statementCount: 1,
  transactionMode: index < 2
    ? 'autocommit-per-statement' as const : 'single-transaction' as const,
}));
const failureReceipt = (stage: 'post_apply_verification' | 'migration_statement' = 'post_apply_verification') => {
  const postApply = stage === 'post_apply_verification';
  const withoutDigest = {
    recordType: 'case_vortex_migration_execution_failure_receipt' as const,
    schemaVersion: CASE_VORTEX_MIGRATION_EXECUTION_FAILURE_RECEIPT_VERSION,
    approvalId: approval.approvalId,
    approvalSha256: approval.approvalSha256,
    rehearsalReceiptSha256,
    startedAt: '2026-07-22T14:10:00.000Z',
    failedAt: '2026-07-22T14:11:00.000Z',
    failureStage: stage,
    failedVersion: postApply ? null : '0204',
    failedFileName: postApply ? null : CASE_VORTEX_MIGRATION_CONTRACTS[2].fileName,
    completedStatementCountInFailedMigration: 0,
    currentTransactionRolledBack: !postApply,
    applied: postApply ? applied : applied.slice(0, 2),
    databaseMayBePartiallyMutated: true,
    reconciliationRequired: true,
    causeSha256: 'b'.repeat(64),
    publicationActivations: 0 as const,
    deployments: 0 as const,
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};

const freshRehearsal = async (options: {
  missingSignature?: string;
  supabaseMissingLast?: boolean;
  activePublicationCount?: number;
} = {}) => {
  const appFiles = CASE_VORTEX_MIGRATION_CONTRACTS.map(({ fileName }) => fileName);
  const supabaseStems = appFiles.map((fileName) => fileName.replace(/\.sql$/u, ''));
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('case_vortex_remote_rehearsal:catalog')) return { rows: [{
      server_version_num: 170006,
      app_tracker_present: true,
      supabase_tracker_present: true,
    }] };
    if (sql.includes('case_vortex_remote_rehearsal:app_ledger')) {
      return { rows: appFiles.map((id) => ({ id })) };
    }
    if (sql.includes('case_vortex_remote_rehearsal:supabase_ledger')) {
      return { rows: supabaseStems
        .slice(0, options.supabaseMissingLast ? -1 : supabaseStems.length)
        .map((version) => ({ version })) };
    }
    if (sql.includes('case_vortex_remote_rehearsal:signatures')) return {
      rows: CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS.map((name) => ({
        name,
        present: name !== options.missingSignature,
      })),
    };
    if (sql.includes('case_vortex_remote_rehearsal:active_publication')) {
      return { rows: [{ count: options.activePublicationCount || 0 }] };
    }
    throw new Error(`unexpected query:${sql}`);
  });
  const result = await runCaseVortexRemoteRehearsalCli(['--check-db'], {
    env: { DATABASE_URL: 'postgresql://read-only.invalid/database' },
    migrationsDir: path.join(process.cwd(), 'src', 'db', 'migrations'),
    query,
  });
  if ('usage' in result) throw new Error('unexpected rehearsal usage');
  return result;
};

const build = async (fresh: Awaited<ReturnType<typeof freshRehearsal>>) => (
  buildCaseVortexMigrationPostApplyDiagnosis({
    diagnosisId: 'post-apply-diagnosis-v1',
    createdAt: '2026-07-22T14:15:00.000Z',
    approval,
    failureReceipt: failureReceipt(),
    freshRehearsal: fresh,
  })
);

describe('Case Vortex migration post-apply diagnosis', () => {
  it('closes a transient verification failure without replay or write authority', async () => {
    const fresh = await freshRehearsal();
    const diagnosis = await build(fresh);
    expect(diagnosis.classification).toBe('verification_restored');
    expect(diagnosis.observed.failedSignatureKeys).toEqual([]);
    expect(diagnosis.boundary).toEqual({
      allFrozenMigrationsApplied: true,
      exactSchemaVerified: true,
      exactTrackersVerified: true,
      verificationRestoredWithoutReplay: true,
      migrationReplayAllowed: false,
      remoteMutationRequired: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(diagnosis.guarantees).toMatchObject({
      databaseWrites: 0, storageReads: 0, storageWrites: 0,
      lunaCalls: 0, publications: 0, deployments: 0,
    });
    expect(verifyCaseVortexMigrationPostApplyDiagnosis(diagnosis, {
      approval, failureReceipt: failureReceipt(),
    })).toEqual(diagnosis);
  });

  it('distinguishes schema, tracker and active-publication drift without authorizing replay', async () => {
    const missing = 'function:capture_uap_evidence_universe_media_snapshot';
    const schema = await build(await freshRehearsal({ missingSignature: missing }));
    expect(schema.classification).toBe('schema_drift');
    expect(schema.observed.failedSignatureKeys).toContain(missing);
    expect(schema.boundary.migrationReplayAllowed).toBe(false);
    expect(schema.boundary.remoteMutationRequired).toBe(true);

    const tracker = await build(await freshRehearsal({ supabaseMissingLast: true }));
    expect(tracker.classification).toBe('tracker_drift');
    expect(tracker.boundary.exactTrackersVerified).toBe(false);

    const active = await build(await freshRehearsal({ activePublicationCount: 1 }));
    expect(active.classification).toBe('active_publication_conflict');
    expect(active.observed.activePublicationCount).toBe(1);
  });

  it('rejects the wrong failure stage and tampered diagnosis evidence', async () => {
    const fresh = await freshRehearsal();
    expect(() => buildCaseVortexMigrationPostApplyDiagnosis({
      diagnosisId: 'wrong-stage',
      createdAt: '2026-07-22T14:15:00.000Z',
      approval,
      failureReceipt: failureReceipt('migration_statement'),
      freshRehearsal: fresh,
    })).toThrow('case_vortex_migration_post_apply_diagnosis_failure_binding_invalid');
    const diagnosis = await build(fresh);
    expect(() => verifyCaseVortexMigrationPostApplyDiagnosis({
      ...diagnosis,
      boundary: { ...diagnosis.boundary, migrationReplayAllowed: true as never },
    }, { approval, failureReceipt: failureReceipt() }))
      .toThrow('case_vortex_migration_post_apply_diagnosis_tampered');
    expect(() => verifyCaseVortexMigrationPostApplyDiagnosis({
      ...diagnosis,
      freshRehearsal: {
        ...diagnosis.freshRehearsal,
        blockers: ['remote:invented'],
      },
    }, { approval, failureReceipt: failureReceipt() }))
      .toThrow();
  });
});
