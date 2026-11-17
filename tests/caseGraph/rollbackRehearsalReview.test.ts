import { describe, expect, it } from 'vitest';

import {
  verifyCaseVortexAuthoritativeEvidenceArtifact,
} from '../../src/caseGraph/authoritativeEvidenceArtifact';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildCaseVortexRollbackRehearsalPlan,
  buildCaseVortexRollbackRehearsalReport,
  CASE_VORTEX_ROLLBACK_MIGRATION_SHA256,
  CASE_VORTEX_ROLLBACK_MIGRATION_VERSION,
  CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
  CASE_VORTEX_ROLLBACK_STEPS,
  type CaseVortexRollbackRehearsalInput,
} from '../../src/caseGraph/rollbackRehearsalReview';

const candidate = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-26-v3',
  manifestSha256: 'a'.repeat(64),
};
const prior = {
  publicationId: '223e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-24-v2',
  manifestSha256: 'b'.repeat(64),
};

const expected = {
  baseline_prior_active: ['prior', null, 'ready', false, false, false, false, false],
  forward_candidate_activated: ['candidate', null, 'ready', false, true, false, false, false],
  fault_detected: ['candidate', null, 'blocked', true, false, false, false, false],
  unexpected_current_rejected: ['candidate', null, 'blocked', true, false, true, false, false],
  invalid_target_rejected: ['candidate', null, 'blocked', true, false, false, true, false],
  rollback_prior_reactivated: ['prior', 'candidate', 'ready', false, true, false, false, false],
  readiness_restored: ['prior', 'candidate', 'ready', false, false, false, false, false],
  representative_journey_passed: ['prior', 'candidate', 'ready', false, false, false, false, true],
} as const;

const rehearsalInput = (): CaseVortexRollbackRehearsalInput => {
  const plan = buildCaseVortexRollbackRehearsalPlan({
    planId: 'case-vortex-rollback-rehearsal-2026-07-26',
    candidate,
    prior,
  });
  return {
    recordType: 'case_vortex_rollback_rehearsal_input',
    schemaVersion: CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
    planId: plan.planId,
    planSha256: plan.planSha256,
    candidate,
    prior,
    migrationVersion: CASE_VORTEX_ROLLBACK_MIGRATION_VERSION,
    migrationSha256: CASE_VORTEX_ROLLBACK_MIGRATION_SHA256,
    completedAt: '2026-07-26T21:00:00.000Z',
    environmentId: 'isolated-postgresql-17-rollback-rehearsal',
    postgresVersionNum: 170_010,
    ephemeralDatabase: true,
    steps: CASE_VORTEX_ROLLBACK_STEPS.map((step) => {
      const [
        active,
        rollbackOf,
        readinessMode,
        servingRollbackRequired,
        transactionCommitted,
        expectedCurrentRejected,
        invalidTargetRejected,
        representativeJourneyPassed,
      ] = expected[step];
      const activePublication = active === 'candidate' ? candidate : prior;
      return {
        step,
        artifactSha256: relationshipInputSha256({ step, artifact: 'retained-trace' }),
        activePublicationId: activePublication.publicationId,
        activeManifestSha256: activePublication.manifestSha256,
        activePublicationCount: 1,
        rollbackOfPublicationId: rollbackOf === 'candidate' ? candidate.publicationId : null,
        readinessMode,
        servingRollbackRequired,
        transactionCommitted,
        expectedCurrentRejected,
        invalidTargetRejected,
        representativeJourneyPassed,
        publicationReceiptVerified: true,
        immutableR2ReadbackVerified: true,
        allRetainedInfluenceVerified: true,
      };
    }),
    accounting: {
      committedSwitchTransactionCount: 2,
      rollbackLineageWriteCount: 1,
      directFlagMutationCount: 0,
      failedTransactionResidueCount: 0,
      storageMutationCount: 0,
      lunaCallCount: 0,
      deploymentCount: 0,
    },
    issues: [],
  };
};

describe('Case Vortex rollback rehearsal review', () => {
  it('proves compare-and-swap rejection, exact rollback lineage and restored serving', () => {
    const input = rehearsalInput();
    const report = buildCaseVortexRollbackRehearsalReport(input);
    expect(report.rollbackRehearsalPassed).toBe(true);
    expect(report.accounting).toMatchObject({
      stepCount: 8,
      passedStepCount: 8,
      artifactCount: 8,
      committedSwitchTransactionCount: 2,
      rollbackLineageWriteCount: 1,
      directFlagMutationCount: 0,
      failedTransactionResidueCount: 0,
      externalMutationCount: 0,
    });
    expect(report.steps.find(({ step }) => step === 'rollback_prior_reactivated'))
      .toMatchObject({
        activePublicationId: prior.publicationId,
        rollbackOfPublicationId: candidate.publicationId,
        transactionCommitted: true,
        passed: true,
      });

    expect(verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'rollback_rehearsal',
      publication: candidate,
      verifiedAt: '2026-07-26T21:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(input)),
      artifactBody: Buffer.from(JSON.stringify(report)),
    })).toMatchObject({
      gate: 'rollback_rehearsal',
      artifactType: 'case_vortex_publication_rollback_rehearsal_evidence_set',
      publication: candidate,
    });
  });

  it('rejects missing, duplicated or reused step evidence', () => {
    const missing = rehearsalInput();
    missing.steps.pop();
    expect(() => buildCaseVortexRollbackRehearsalReport(missing))
      .toThrow('case_vortex_rollback_rehearsal_input_invalid');

    const duplicate = rehearsalInput();
    duplicate.steps[7] = {
      ...duplicate.steps[0]!,
      artifactSha256: relationshipInputSha256({ duplicate: 'rollback-step' }),
    };
    expect(() => buildCaseVortexRollbackRehearsalReport(duplicate))
      .toThrow('case_vortex_rollback_rehearsal_step_coverage_invalid');

    const reused = rehearsalInput();
    reused.steps[7]!.artifactSha256 = reused.steps[0]!.artifactSha256;
    expect(() => buildCaseVortexRollbackRehearsalReport(reused))
      .toThrow('case_vortex_rollback_rehearsal_step_independence_invalid');
  });

  it('fails closed for incorrect state, missing CAS proof, residue or external mutation', () => {
    const wrongState = rehearsalInput();
    wrongState.steps.find(({ step }) => step === 'rollback_prior_reactivated')!
      .activePublicationId = candidate.publicationId;
    expect(buildCaseVortexRollbackRehearsalReport(wrongState).rollbackRehearsalPassed)
      .toBe(false);

    const missingCas = rehearsalInput();
    missingCas.steps.find(({ step }) => step === 'unexpected_current_rejected')!
      .expectedCurrentRejected = false;
    expect(buildCaseVortexRollbackRehearsalReport(missingCas).rollbackRehearsalPassed)
      .toBe(false);

    const residue = rehearsalInput();
    residue.accounting.failedTransactionResidueCount = 1;
    expect(buildCaseVortexRollbackRehearsalReport(residue).rollbackRehearsalPassed)
      .toBe(false);

    const external = rehearsalInput();
    external.accounting.storageMutationCount = 1;
    const report = buildCaseVortexRollbackRehearsalReport(external);
    expect(report.rollbackRehearsalPassed).toBe(false);
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'rollback_rehearsal',
      publication: candidate,
      verifiedAt: '2026-07-26T21:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(external)),
      artifactBody: Buffer.from(JSON.stringify(report)),
    })).toThrow('case_vortex_authoritative_rollback_rehearsal_gate_failed');
  });

  it('rejects migration drift, non-ephemeral execution and re-sealed report drift', () => {
    const migrationDrift = rehearsalInput();
    migrationDrift.migrationSha256 = 'c'.repeat(64);
    expect(() => buildCaseVortexRollbackRehearsalReport(migrationDrift))
      .toThrow('case_vortex_rollback_rehearsal_plan_binding_invalid');

    const configuredDatabase = rehearsalInput();
    configuredDatabase.ephemeralDatabase = false;
    expect(() => buildCaseVortexRollbackRehearsalReport(configuredDatabase))
      .toThrow('case_vortex_rollback_rehearsal_environment_invalid');

    const input = rehearsalInput();
    const report = buildCaseVortexRollbackRehearsalReport(input);
    const changed = {
      ...report,
      limitations: [...report.limitations, 'Inserted after rehearsal completion.'],
    };
    const { reportSha256: _discarded, ...body } = changed;
    const resealed = { ...changed, reportSha256: relationshipInputSha256(body) };
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'rollback_rehearsal',
      publication: candidate,
      verifiedAt: '2026-07-26T21:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(input)),
      artifactBody: Buffer.from(JSON.stringify(resealed)),
    })).toThrow('case_vortex_authoritative_artifact_rebuild_mismatch');
  });
});
