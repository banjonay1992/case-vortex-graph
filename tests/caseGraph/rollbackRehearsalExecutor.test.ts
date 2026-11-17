import { describe, expect, it, vi } from 'vitest';

import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  CaseVortexRollbackRehearsalExecutionError,
  executeCaseVortexRollbackRehearsal,
  type CaseVortexRollbackRehearsalExecutorDependencies,
  type CaseVortexRollbackStepExecution,
} from '../../src/caseGraph/rollbackRehearsalExecutor';
import {
  buildCaseVortexRollbackRehearsalPlan,
  type CaseVortexRollbackRehearsalPlan,
  type CaseVortexRollbackStep,
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
const plan = buildCaseVortexRollbackRehearsalPlan({
  planId: 'case-vortex-rollback-executor-test',
  candidate,
  prior,
});
const zeroAccounting = () => ({
  committedSwitchTransactionCount: 0,
  rollbackLineageWriteCount: 0,
  directFlagMutationCount: 0,
  failedTransactionResidueCount: 0,
  storageMutationCount: 0,
  lunaCallCount: 0,
  deploymentCount: 0,
});
const priorSteps = new Set<CaseVortexRollbackStep>([
  'baseline_prior_active',
  'rollback_prior_reactivated',
  'readiness_restored',
  'representative_journey_passed',
]);
const blockedSteps = new Set<CaseVortexRollbackStep>([
  'fault_detected',
  'unexpected_current_rejected',
  'invalid_target_rejected',
]);
const rollbackSteps = new Set<CaseVortexRollbackStep>([
  'rollback_prior_reactivated',
  'readiness_restored',
  'representative_journey_passed',
]);
const execution = (step: CaseVortexRollbackStep): CaseVortexRollbackStepExecution => {
  const active = priorSteps.has(step) ? prior : candidate;
  return {
    evidence: {
      artifactSha256: relationshipInputSha256({ step, source: 'executed-test-trace' }),
      activePublicationId: active.publicationId,
      activeManifestSha256: active.manifestSha256,
      activePublicationCount: 1,
      rollbackOfPublicationId: rollbackSteps.has(step) ? candidate.publicationId : null,
      readinessMode: blockedSteps.has(step) ? 'blocked' : 'ready',
      servingRollbackRequired: blockedSteps.has(step),
      transactionCommitted: [
        'forward_candidate_activated',
        'rollback_prior_reactivated',
      ].includes(step),
      expectedCurrentRejected: step === 'unexpected_current_rejected',
      invalidTargetRejected: step === 'invalid_target_rejected',
      representativeJourneyPassed: step === 'representative_journey_passed',
      publicationReceiptVerified: true,
      immutableR2ReadbackVerified: true,
      allRetainedInfluenceVerified: true,
    },
    accounting: {
      ...zeroAccounting(),
      committedSwitchTransactionCount: [
        'forward_candidate_activated',
        'rollback_prior_reactivated',
      ].includes(step) ? 1 : 0,
      rollbackLineageWriteCount: step === 'rollback_prior_reactivated' ? 1 : 0,
    },
  };
};

const dependencies = () => {
  const order: string[] = [];
  const runner = (step: CaseVortexRollbackStep) => vi.fn(async (
    _plan: CaseVortexRollbackRehearsalPlan,
  ) => {
    order.push(step);
    return execution(step);
  });
  const value: CaseVortexRollbackRehearsalExecutorDependencies = {
    captureBaseline: runner('baseline_prior_active'),
    activateCandidate: runner('forward_candidate_activated'),
    detectFault: runner('fault_detected'),
    rejectUnexpectedCurrent: runner('unexpected_current_rejected'),
    rejectInvalidTarget: runner('invalid_target_rejected'),
    rollbackPrior: runner('rollback_prior_reactivated'),
    verifyReadiness: runner('readiness_restored'),
    runRepresentativeJourney: runner('representative_journey_passed'),
    ensurePriorActive: vi.fn(async () => undefined),
    now: () => new Date('2026-07-26T22:00:00.000Z'),
  };
  return { value, order };
};

describe('Case Vortex executable rollback rehearsal', () => {
  it('runs the exact eight steps and seals only independently verified evidence', async () => {
    const deps = dependencies();
    const result = await executeCaseVortexRollbackRehearsal({
      plan,
      environmentId: 'isolated-postgresql-17-executor-test',
      postgresVersionNum: 170_010,
      dependencies: deps.value,
    });
    expect(deps.order).toEqual([
      'baseline_prior_active',
      'forward_candidate_activated',
      'fault_detected',
      'unexpected_current_rejected',
      'invalid_target_rejected',
      'rollback_prior_reactivated',
      'readiness_restored',
      'representative_journey_passed',
    ]);
    expect(deps.value.ensurePriorActive).not.toHaveBeenCalled();
    expect(result.report).toMatchObject({
      rollbackRehearsalPassed: true,
      accounting: {
        stepCount: 8,
        artifactCount: 8,
        committedSwitchTransactionCount: 2,
        rollbackLineageWriteCount: 1,
        externalMutationCount: 0,
      },
    });
  });

  it('stops immediately and restores the prior publication after invalid evidence', async () => {
    const deps = dependencies();
    deps.value.detectFault = vi.fn(async () => ({
      ...execution('fault_detected'),
      evidence: {
        ...execution('fault_detected').evidence,
        activePublicationId: prior.publicationId,
      },
    }));
    const promise = executeCaseVortexRollbackRehearsal({
      plan,
      environmentId: 'isolated-postgresql-17-executor-test',
      postgresVersionNum: 170_010,
      dependencies: deps.value,
    });
    await expect(promise).rejects.toMatchObject({
      failedStep: 'fault_detected',
      cleanupAttempted: true,
      cleanupSucceeded: true,
    });
    expect(deps.value.ensurePriorActive).toHaveBeenCalledOnce();
    expect(deps.value.rejectUnexpectedCurrent).not.toHaveBeenCalled();
  });

  it('fails closed on external mutation accounting and reports cleanup failure', async () => {
    const deps = dependencies();
    deps.value.rejectUnexpectedCurrent = vi.fn(async () => ({
      ...execution('unexpected_current_rejected'),
      accounting: {
        ...zeroAccounting(),
        storageMutationCount: 1,
      },
    }));
    deps.value.ensurePriorActive = vi.fn(async () => {
      throw new Error('simulated_cleanup_failure');
    });
    try {
      await executeCaseVortexRollbackRehearsal({
        plan,
        environmentId: 'isolated-postgresql-17-executor-test',
        postgresVersionNum: 170_010,
        dependencies: deps.value,
      });
      throw new Error('expected executor failure');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseVortexRollbackRehearsalExecutionError);
      expect(error).toMatchObject({
        failedStep: 'unexpected_current_rejected',
        cleanupAttempted: true,
        cleanupSucceeded: false,
      });
      expect((error as CaseVortexRollbackRehearsalExecutionError).originalCause)
        .toMatchObject({
          message: 'case_vortex_rollback_rehearsal_step_accounting_mismatch:unexpected_current_rejected',
        });
    }
  });

  it('rejects a re-sealed or non-PostgreSQL-17 execution plan before any step runs', async () => {
    const deps = dependencies();
    await expect(executeCaseVortexRollbackRehearsal({
      plan: { ...plan, planSha256: 'f'.repeat(64) },
      environmentId: 'isolated-postgresql-17-executor-test',
      postgresVersionNum: 170_010,
      dependencies: deps.value,
    })).rejects.toThrow('case_vortex_rollback_rehearsal_execution_input_invalid');
    await expect(executeCaseVortexRollbackRehearsal({
      plan,
      environmentId: 'isolated-postgresql-16-executor-test',
      postgresVersionNum: 160_010,
      dependencies: deps.value,
    })).rejects.toThrow('case_vortex_rollback_rehearsal_execution_input_invalid');
    expect(deps.order).toEqual([]);
  });
});
