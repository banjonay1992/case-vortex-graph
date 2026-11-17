import {
  buildCaseVortexRollbackRehearsalPlan,
  buildCaseVortexRollbackRehearsalReport,
  caseVortexRollbackStepMatchesPlan,
  CASE_VORTEX_ROLLBACK_MIGRATION_SHA256,
  CASE_VORTEX_ROLLBACK_MIGRATION_VERSION,
  CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
  type CaseVortexRollbackRehearsalInput,
  type CaseVortexRollbackRehearsalPlan,
  type CaseVortexRollbackStep,
} from './rollbackRehearsalReview';

type StepEvidence = Omit<CaseVortexRollbackRehearsalInput['steps'][number], 'step'>;
type RehearsalAccounting = CaseVortexRollbackRehearsalInput['accounting'];

export type CaseVortexRollbackStepExecution = {
  evidence: StepEvidence;
  accounting: RehearsalAccounting;
};

type StepRunner = (
  plan: CaseVortexRollbackRehearsalPlan,
) => Promise<CaseVortexRollbackStepExecution>;

export type CaseVortexRollbackRehearsalExecutorDependencies = {
  captureBaseline: StepRunner;
  activateCandidate: StepRunner;
  detectFault: StepRunner;
  rejectUnexpectedCurrent: StepRunner;
  rejectInvalidTarget: StepRunner;
  rollbackPrior: StepRunner;
  verifyReadiness: StepRunner;
  runRepresentativeJourney: StepRunner;
  ensurePriorActive: (plan: CaseVortexRollbackRehearsalPlan) => Promise<void>;
  now?: () => Date;
};

export class CaseVortexRollbackRehearsalExecutionError extends Error {
  readonly failedStep: CaseVortexRollbackStep;
  readonly cleanupAttempted: boolean;
  readonly cleanupSucceeded: boolean;
  readonly originalCause: unknown;

  constructor(input: {
    failedStep: CaseVortexRollbackStep;
    cleanupAttempted: boolean;
    cleanupSucceeded: boolean;
    cause: unknown;
  }) {
    super(
      `case_vortex_rollback_rehearsal_execution_failed:${input.failedStep}:cleanup_${
        input.cleanupAttempted
          ? (input.cleanupSucceeded ? 'succeeded' : 'failed')
          : 'not_required'
      }`,
    );
    this.name = 'CaseVortexRollbackRehearsalExecutionError';
    this.failedStep = input.failedStep;
    this.cleanupAttempted = input.cleanupAttempted;
    this.cleanupSucceeded = input.cleanupSucceeded;
    this.originalCause = input.cause;
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const ACCOUNTING_KEYS = [
  'committedSwitchTransactionCount',
  'rollbackLineageWriteCount',
  'directFlagMutationCount',
  'failedTransactionResidueCount',
  'storageMutationCount',
  'lunaCallCount',
  'deploymentCount',
] as const satisfies readonly (keyof RehearsalAccounting)[];

const zeroAccounting = (): RehearsalAccounting => ({
  committedSwitchTransactionCount: 0,
  rollbackLineageWriteCount: 0,
  directFlagMutationCount: 0,
  failedTransactionResidueCount: 0,
  storageMutationCount: 0,
  lunaCallCount: 0,
  deploymentCount: 0,
});

const expectedAccounting = (
  step: CaseVortexRollbackStep,
): RehearsalAccounting => ({
  ...zeroAccounting(),
  committedSwitchTransactionCount: [
    'forward_candidate_activated',
    'rollback_prior_reactivated',
  ].includes(step) ? 1 : 0,
  rollbackLineageWriteCount: step === 'rollback_prior_reactivated' ? 1 : 0,
});

const validateAccounting = (
  step: CaseVortexRollbackStep,
  value: RehearsalAccounting,
) => {
  if (!value || ACCOUNTING_KEYS.some((key) => (
    !Number.isSafeInteger(value[key]) || value[key] < 0
  ))) {
    throw new Error(`case_vortex_rollback_rehearsal_step_accounting_invalid:${step}`);
  }
  const expected = expectedAccounting(step);
  if (ACCOUNTING_KEYS.some((key) => value[key] !== expected[key])) {
    throw new Error(`case_vortex_rollback_rehearsal_step_accounting_mismatch:${step}`);
  }
};

const addAccounting = (
  total: RehearsalAccounting,
  value: RehearsalAccounting,
) => {
  for (const key of ACCOUNTING_KEYS) total[key] += value[key];
};

const EXECUTION_STEPS: ReadonlyArray<{
  step: CaseVortexRollbackStep;
  run: keyof Pick<
    CaseVortexRollbackRehearsalExecutorDependencies,
    | 'captureBaseline'
    | 'activateCandidate'
    | 'detectFault'
    | 'rejectUnexpectedCurrent'
    | 'rejectInvalidTarget'
    | 'rollbackPrior'
    | 'verifyReadiness'
    | 'runRepresentativeJourney'
  >;
}> = [
  { step: 'baseline_prior_active', run: 'captureBaseline' },
  { step: 'forward_candidate_activated', run: 'activateCandidate' },
  { step: 'fault_detected', run: 'detectFault' },
  { step: 'unexpected_current_rejected', run: 'rejectUnexpectedCurrent' },
  { step: 'invalid_target_rejected', run: 'rejectInvalidTarget' },
  { step: 'rollback_prior_reactivated', run: 'rollbackPrior' },
  { step: 'readiness_restored', run: 'verifyReadiness' },
  { step: 'representative_journey_passed', run: 'runRepresentativeJourney' },
];

export const executeCaseVortexRollbackRehearsal = async (input: {
  plan: CaseVortexRollbackRehearsalPlan;
  environmentId: string;
  postgresVersionNum: number;
  dependencies: CaseVortexRollbackRehearsalExecutorDependencies;
}) => {
  const rebuiltPlan = buildCaseVortexRollbackRehearsalPlan({
    planId: input.plan.planId,
    candidate: input.plan.candidate,
    prior: input.plan.prior,
  });
  if (rebuiltPlan.planSha256 !== input.plan.planSha256
    || input.postgresVersionNum < 170_000
    || !Number.isSafeInteger(input.postgresVersionNum)
    || !input.environmentId.trim()) {
    throw new Error('case_vortex_rollback_rehearsal_execution_input_invalid');
  }

  const steps: CaseVortexRollbackRehearsalInput['steps'] = [];
  const artifacts = new Set<string>();
  const accounting = zeroAccounting();
  let candidateMayBeActive = false;

  for (const definition of EXECUTION_STEPS) {
    try {
      if (definition.step === 'forward_candidate_activated') {
        candidateMayBeActive = true;
      }
      const result = await input.dependencies[definition.run](rebuiltPlan);
      const step = { step: definition.step, ...result.evidence };
      if (!SHA256.test(step.artifactSha256)
        || artifacts.has(step.artifactSha256)
        || !caseVortexRollbackStepMatchesPlan({
          step,
          candidate: rebuiltPlan.candidate,
          prior: rebuiltPlan.prior,
        })) {
        throw new Error(`case_vortex_rollback_rehearsal_step_evidence_invalid:${definition.step}`);
      }
      validateAccounting(definition.step, result.accounting);
      artifacts.add(step.artifactSha256);
      addAccounting(accounting, result.accounting);
      steps.push(step);
      if (definition.step === 'rollback_prior_reactivated') {
        candidateMayBeActive = false;
      }
    } catch (cause) {
      let cleanupSucceeded = false;
      if (candidateMayBeActive) {
        try {
          await input.dependencies.ensurePriorActive(rebuiltPlan);
          cleanupSucceeded = true;
        } catch {
          cleanupSucceeded = false;
        }
      }
      throw new CaseVortexRollbackRehearsalExecutionError({
        failedStep: definition.step,
        cleanupAttempted: candidateMayBeActive,
        cleanupSucceeded,
        cause,
      });
    }
  }

  const now = input.dependencies.now?.() || new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('case_vortex_rollback_rehearsal_execution_time_invalid');
  }
  const rehearsalInput: CaseVortexRollbackRehearsalInput = {
    recordType: 'case_vortex_rollback_rehearsal_input',
    schemaVersion: CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
    planId: rebuiltPlan.planId,
    planSha256: rebuiltPlan.planSha256,
    candidate: rebuiltPlan.candidate,
    prior: rebuiltPlan.prior,
    migrationVersion: CASE_VORTEX_ROLLBACK_MIGRATION_VERSION,
    migrationSha256: CASE_VORTEX_ROLLBACK_MIGRATION_SHA256,
    completedAt: now.toISOString(),
    environmentId: input.environmentId,
    postgresVersionNum: input.postgresVersionNum,
    ephemeralDatabase: true,
    steps,
    accounting,
    issues: [],
  };
  const report = buildCaseVortexRollbackRehearsalReport(rehearsalInput);
  if (!report.rollbackRehearsalPassed) {
    throw new Error('case_vortex_rollback_rehearsal_execution_report_failed');
  }
  return { input: rehearsalInput, report };
};
