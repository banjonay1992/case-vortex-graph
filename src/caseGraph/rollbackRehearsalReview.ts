import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION =
  'case-vortex-publication-rollback-rehearsal-v1' as const;
export const CASE_VORTEX_ROLLBACK_MIGRATION_VERSION = '0217' as const;
export const CASE_VORTEX_ROLLBACK_MIGRATION_SHA256 =
  'ef817f6068f1c9c7b09ab7bc35708e3374e4d613a98d45361c9ec92e9bf6c045' as const;

export const CASE_VORTEX_ROLLBACK_STEPS = [
  'baseline_prior_active',
  'forward_candidate_activated',
  'fault_detected',
  'unexpected_current_rejected',
  'invalid_target_rejected',
  'rollback_prior_reactivated',
  'readiness_restored',
  'representative_journey_passed',
] as const;
export type CaseVortexRollbackStep = typeof CASE_VORTEX_ROLLBACK_STEPS[number];

export type CaseVortexRollbackPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexRollbackRehearsalPlan = {
  recordType: 'case_vortex_rollback_rehearsal_plan';
  schemaVersion: typeof CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION;
  planId: string;
  candidate: CaseVortexRollbackPublication;
  prior: CaseVortexRollbackPublication;
  migration: {
    version: typeof CASE_VORTEX_ROLLBACK_MIGRATION_VERSION;
    sha256: typeof CASE_VORTEX_ROLLBACK_MIGRATION_SHA256;
  };
  requirements: {
    ephemeralPostgresRequired: true;
    minimumPostgresVersionNum: 170000;
    exactStepCount: 8;
    expectedCurrentCompareAndSwapRequired: true;
    previouslyActivatedTargetRequired: true;
    directFlagMutationDenied: true;
    representativeJourneyRequired: true;
    externalMutationAllowed: false;
  };
  steps: readonly CaseVortexRollbackStep[];
  planSha256: string;
};

export type CaseVortexRollbackRehearsalInput = {
  recordType: 'case_vortex_rollback_rehearsal_input';
  schemaVersion: typeof CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION;
  planId: string;
  planSha256: string;
  candidate: CaseVortexRollbackPublication;
  prior: CaseVortexRollbackPublication;
  migrationVersion: typeof CASE_VORTEX_ROLLBACK_MIGRATION_VERSION;
  migrationSha256: string;
  completedAt: string;
  environmentId: string;
  postgresVersionNum: number;
  ephemeralDatabase: boolean;
  steps: Array<{
    step: CaseVortexRollbackStep;
    artifactSha256: string;
    activePublicationId: string;
    activeManifestSha256: string;
    activePublicationCount: number;
    rollbackOfPublicationId: string | null;
    readinessMode: 'ready' | 'blocked';
    servingRollbackRequired: boolean;
    transactionCommitted: boolean;
    expectedCurrentRejected: boolean;
    invalidTargetRejected: boolean;
    representativeJourneyPassed: boolean;
    publicationReceiptVerified: boolean;
    immutableR2ReadbackVerified: boolean;
    allRetainedInfluenceVerified: boolean;
  }>;
  accounting: {
    committedSwitchTransactionCount: number;
    rollbackLineageWriteCount: number;
    directFlagMutationCount: number;
    failedTransactionResidueCount: number;
    storageMutationCount: number;
    lunaCallCount: number;
    deploymentCount: number;
  };
  issues: Array<{
    issueId: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    resolved: boolean;
    resolutionReceiptSha256: string | null;
  }>;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };
const text = (value: unknown, code: string, maximum = 1_000) => {
  if (typeof value !== 'string' || !value.trim()
    || Buffer.byteLength(value, 'utf8') > maximum) return fail(code);
  return value.trim();
};
const digest = (value: unknown, code: string) => {
  const normalized = text(value, code, 64).toLowerCase();
  if (!SHA256.test(normalized)) return fail(code);
  return normalized;
};
const count = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(code);
  return Number(value);
};
const publication = (value: CaseVortexRollbackPublication) => {
  if (!value || !UUID.test(value.publicationId)
    || !VERSION.test(value.corpusVersion)
    || !SHA256.test(value.manifestSha256)) {
    return fail('case_vortex_rollback_rehearsal_publication_invalid');
  }
  return { ...value };
};
const exactTimestamp = (value: unknown) => {
  const candidate = text(value, 'case_vortex_rollback_rehearsal_completed_at_invalid', 40);
  try {
    if (new Date(candidate).toISOString() !== candidate) {
      fail('case_vortex_rollback_rehearsal_completed_at_invalid');
    }
  } catch {
    return fail('case_vortex_rollback_rehearsal_completed_at_invalid');
  }
  return candidate;
};
export const buildCaseVortexRollbackRehearsalPlan = (input: {
  planId: string;
  candidate: CaseVortexRollbackPublication;
  prior: CaseVortexRollbackPublication;
}): CaseVortexRollbackRehearsalPlan => {
  const candidate = publication(input.candidate);
  const prior = publication(input.prior);
  if (candidate.publicationId === prior.publicationId
    || candidate.corpusVersion === prior.corpusVersion
    || candidate.manifestSha256 === prior.manifestSha256) {
    fail('case_vortex_rollback_rehearsal_publications_not_distinct');
  }
  const body = {
    recordType: 'case_vortex_rollback_rehearsal_plan' as const,
    schemaVersion: CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
    planId: text(input.planId, 'case_vortex_rollback_rehearsal_plan_invalid', 200),
    candidate,
    prior,
    migration: {
      version: CASE_VORTEX_ROLLBACK_MIGRATION_VERSION,
      sha256: CASE_VORTEX_ROLLBACK_MIGRATION_SHA256,
    },
    requirements: {
      ephemeralPostgresRequired: true as const,
      minimumPostgresVersionNum: 170000 as const,
      exactStepCount: 8 as const,
      expectedCurrentCompareAndSwapRequired: true as const,
      previouslyActivatedTargetRequired: true as const,
      directFlagMutationDenied: true as const,
      representativeJourneyRequired: true as const,
      externalMutationAllowed: false as const,
    },
    steps: CASE_VORTEX_ROLLBACK_STEPS,
  };
  return { ...body, planSha256: relationshipInputSha256(body) };
};

type ExpectedStep = {
  active: 'candidate' | 'prior';
  rollbackOf: 'candidate' | null;
  mode: 'ready' | 'blocked';
  rollbackRequired: boolean;
  committed: boolean;
  casRejected: boolean;
  invalidTargetRejected: boolean;
  journeyPassed: boolean;
};

const EXPECTED_STEPS: Record<CaseVortexRollbackStep, ExpectedStep> = {
  baseline_prior_active: {
    active: 'prior', rollbackOf: null, mode: 'ready', rollbackRequired: false,
    committed: false, casRejected: false, invalidTargetRejected: false, journeyPassed: false,
  },
  forward_candidate_activated: {
    active: 'candidate', rollbackOf: null, mode: 'ready', rollbackRequired: false,
    committed: true, casRejected: false, invalidTargetRejected: false, journeyPassed: false,
  },
  fault_detected: {
    active: 'candidate', rollbackOf: null, mode: 'blocked', rollbackRequired: true,
    committed: false, casRejected: false, invalidTargetRejected: false, journeyPassed: false,
  },
  unexpected_current_rejected: {
    active: 'candidate', rollbackOf: null, mode: 'blocked', rollbackRequired: true,
    committed: false, casRejected: true, invalidTargetRejected: false, journeyPassed: false,
  },
  invalid_target_rejected: {
    active: 'candidate', rollbackOf: null, mode: 'blocked', rollbackRequired: true,
    committed: false, casRejected: false, invalidTargetRejected: true, journeyPassed: false,
  },
  rollback_prior_reactivated: {
    active: 'prior', rollbackOf: 'candidate', mode: 'ready', rollbackRequired: false,
    committed: true, casRejected: false, invalidTargetRejected: false, journeyPassed: false,
  },
  readiness_restored: {
    active: 'prior', rollbackOf: 'candidate', mode: 'ready', rollbackRequired: false,
    committed: false, casRejected: false, invalidTargetRejected: false, journeyPassed: false,
  },
  representative_journey_passed: {
    active: 'prior', rollbackOf: 'candidate', mode: 'ready', rollbackRequired: false,
    committed: false, casRejected: false, invalidTargetRejected: false, journeyPassed: true,
  },
};

export const caseVortexRollbackStepMatchesPlan = (input: {
  step: CaseVortexRollbackRehearsalInput['steps'][number];
  candidate: CaseVortexRollbackPublication;
  prior: CaseVortexRollbackPublication;
}) => {
  const expected = EXPECTED_STEPS[input.step.step];
  if (!expected) return false;
  const active = expected.active === 'candidate' ? input.candidate : input.prior;
  const expectedRollbackOf = expected.rollbackOf === 'candidate'
    ? input.candidate.publicationId
    : null;
  return input.step.activePublicationId === active.publicationId
    && input.step.activeManifestSha256 === active.manifestSha256
    && input.step.activePublicationCount === 1
    && input.step.rollbackOfPublicationId === expectedRollbackOf
    && input.step.readinessMode === expected.mode
    && input.step.servingRollbackRequired === expected.rollbackRequired
    && input.step.transactionCommitted === expected.committed
    && input.step.expectedCurrentRejected === expected.casRejected
    && input.step.invalidTargetRejected === expected.invalidTargetRejected
    && input.step.representativeJourneyPassed === expected.journeyPassed
    && input.step.publicationReceiptVerified === true
    && input.step.immutableR2ReadbackVerified === true
    && input.step.allRetainedInfluenceVerified === true;
};

export const buildCaseVortexRollbackRehearsalReport = (
  input: CaseVortexRollbackRehearsalInput,
) => {
  if (!input || input.recordType !== 'case_vortex_rollback_rehearsal_input'
    || input.schemaVersion !== CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION
    || !Array.isArray(input.steps) || input.steps.length !== 8
    || !input.accounting || !Array.isArray(input.issues)) {
    fail('case_vortex_rollback_rehearsal_input_invalid');
  }
  const candidate = publication(input.candidate);
  const prior = publication(input.prior);
  const planId = text(input.planId, 'case_vortex_rollback_rehearsal_plan_invalid', 200);
  const plan = buildCaseVortexRollbackRehearsalPlan({ planId, candidate, prior });
  if (digest(input.planSha256, 'case_vortex_rollback_rehearsal_plan_digest_invalid')
      !== plan.planSha256
    || input.migrationVersion !== CASE_VORTEX_ROLLBACK_MIGRATION_VERSION
    || digest(input.migrationSha256, 'case_vortex_rollback_rehearsal_migration_invalid')
      !== CASE_VORTEX_ROLLBACK_MIGRATION_SHA256) {
    fail('case_vortex_rollback_rehearsal_plan_binding_invalid');
  }
  const completedAt = exactTimestamp(input.completedAt);
  const environmentId = text(
    input.environmentId,
    'case_vortex_rollback_rehearsal_environment_invalid',
    200,
  );
  if (input.ephemeralDatabase !== true
    || !Number.isSafeInteger(input.postgresVersionNum)
    || input.postgresVersionNum < 170_000) {
    fail('case_vortex_rollback_rehearsal_environment_invalid');
  }

  const names = new Set<CaseVortexRollbackStep>();
  const artifacts = new Set<string>();
  let passedStepCount = 0;
  const steps = input.steps.map((step) => {
    if (!CASE_VORTEX_ROLLBACK_STEPS.includes(step.step) || names.has(step.step)) {
      return fail('case_vortex_rollback_rehearsal_step_coverage_invalid');
    }
    names.add(step.step);
    const artifactSha256 = digest(
      step.artifactSha256,
      'case_vortex_rollback_rehearsal_artifact_invalid',
    );
    artifacts.add(artifactSha256);
    const passed = caseVortexRollbackStepMatchesPlan({ step, candidate, prior });
    if (passed) passedStepCount += 1;
    return { ...step, artifactSha256, passed };
  });
  if (names.size !== 8 || artifacts.size !== 8) {
    fail('case_vortex_rollback_rehearsal_step_independence_invalid');
  }

  const accounting = {
    committedSwitchTransactionCount: count(
      input.accounting.committedSwitchTransactionCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
    rollbackLineageWriteCount: count(
      input.accounting.rollbackLineageWriteCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
    directFlagMutationCount: count(
      input.accounting.directFlagMutationCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
    failedTransactionResidueCount: count(
      input.accounting.failedTransactionResidueCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
    storageMutationCount: count(
      input.accounting.storageMutationCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
    lunaCallCount: count(
      input.accounting.lunaCallCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
    deploymentCount: count(
      input.accounting.deploymentCount,
      'case_vortex_rollback_rehearsal_accounting_invalid',
    ),
  };

  const issueIds = new Set<string>();
  const issues = input.issues.map((issue) => {
    if (!['critical', 'high', 'medium', 'low'].includes(issue.severity)
      || typeof issue.resolved !== 'boolean') {
      return fail('case_vortex_rollback_rehearsal_issue_invalid');
    }
    const issueId = text(issue.issueId, 'case_vortex_rollback_rehearsal_issue_invalid', 200);
    if (issueIds.has(issueId)) fail('case_vortex_rollback_rehearsal_issue_invalid');
    issueIds.add(issueId);
    const resolutionReceiptSha256 = issue.resolutionReceiptSha256 === null
      ? null
      : digest(
        issue.resolutionReceiptSha256,
        'case_vortex_rollback_rehearsal_issue_invalid',
      );
    if (issue.resolved !== (resolutionReceiptSha256 !== null)) {
      fail('case_vortex_rollback_rehearsal_issue_invalid');
    }
    return {
      ...issue,
      issueId,
      description: text(
        issue.description,
        'case_vortex_rollback_rehearsal_issue_invalid',
        4_000,
      ),
      resolutionReceiptSha256,
    };
  });
  const unresolvedCriticalOrHighIssueCount = issues.filter((issue) => (
    !issue.resolved && (issue.severity === 'critical' || issue.severity === 'high')
  )).length;
  const externalMutationCount = accounting.storageMutationCount
    + accounting.lunaCallCount + accounting.deploymentCount;
  const criteria = [
    { criterion: 'passed_rollback_steps', actual: passedStepCount, required: 8, passed: passedStepCount === 8 },
    { criterion: 'committed_switch_transactions', actual: accounting.committedSwitchTransactionCount, required: 2, passed: accounting.committedSwitchTransactionCount === 2 },
    { criterion: 'rollback_lineage_writes', actual: accounting.rollbackLineageWriteCount, required: 1, passed: accounting.rollbackLineageWriteCount === 1 },
    { criterion: 'direct_flag_mutations', actual: accounting.directFlagMutationCount, required: 0, passed: accounting.directFlagMutationCount === 0 },
    { criterion: 'failed_transaction_residue', actual: accounting.failedTransactionResidueCount, required: 0, passed: accounting.failedTransactionResidueCount === 0 },
    { criterion: 'external_mutations', actual: externalMutationCount, required: 0, passed: externalMutationCount === 0 },
    { criterion: 'unresolved_critical_or_high_issues', actual: unresolvedCriticalOrHighIssueCount, required: 0, passed: unresolvedCriticalOrHighIssueCount === 0 },
  ];
  const body = {
    recordType: 'case_vortex_rollback_rehearsal_report' as const,
    schemaVersion: CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
    planId,
    planSha256: plan.planSha256,
    publication: candidate,
    candidate,
    prior,
    migration: plan.migration,
    completedAt,
    environmentId,
    postgresVersionNum: input.postgresVersionNum,
    ephemeralDatabase: true as const,
    accounting: {
      stepCount: steps.length,
      passedStepCount,
      artifactCount: artifacts.size,
      ...accounting,
      externalMutationCount,
      issueCount: issues.length,
      unresolvedCriticalOrHighIssueCount,
    },
    steps,
    issues,
    criteria,
    rollbackRehearsalPassed: criteria.every(({ passed }) => passed),
    limitations: [
      'This rehearsal proves the exact candidate, prior publication, migration and retained isolated-PostgreSQL artifacts only.',
      'It does not authorize rollback, publication activation, deployment or any configured-database mutation.',
      'Production rollback still requires explicit release authority and current-state compare-and-swap verification.',
    ],
  };
  return { ...body, reportSha256: relationshipInputSha256(body) };
};
