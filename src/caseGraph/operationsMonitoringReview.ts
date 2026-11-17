import {
  evaluateCaseVortexOperationalHealth,
  type CaseVortexOperationalSnapshot,
} from './operationalHealth';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_OPERATIONS_MONITORING_VERSION =
  'case-vortex-operations-monitoring-review-v1' as const;

export const CASE_VORTEX_OPERATIONS_DRILLS = [
  'healthy_ready',
  'database_binding_unavailable',
  'storage_binding_unavailable',
  'cursor_secret_unavailable',
  'luna_provider_unavailable',
  'publication_activation_conflict',
  'active_lineage_unverified',
  'retained_influence_unverified',
  'incremental_job_failure',
  'expired_lease_degraded',
] as const;
export type CaseVortexOperationsDrill = typeof CASE_VORTEX_OPERATIONS_DRILLS[number];

export const CASE_VORTEX_TELEMETRY_PHASES = [
  'request_admitted',
  'tool_completed',
  'answer_completed',
  'request_denied',
  'provider_failed_closed',
] as const;
export type CaseVortexTelemetryPhase = typeof CASE_VORTEX_TELEMETRY_PHASES[number];

export type CaseVortexOperationsPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexOperationsMonitoringPlan = {
  recordType: 'case_vortex_operations_monitoring_plan';
  schemaVersion: typeof CASE_VORTEX_OPERATIONS_MONITORING_VERSION;
  planId: string;
  publication: CaseVortexOperationsPublication;
  requirements: {
    drillCount: 10;
    telemetryPhaseCount: 5;
    uniqueRetainedArtifacts: true;
    readOnly: true;
    testOnlyEvidenceAllowed: false;
  };
  drills: readonly CaseVortexOperationsDrill[];
  telemetryPhases: readonly CaseVortexTelemetryPhase[];
  planSha256: string;
};

export type CaseVortexOperationsMonitoringInput = {
  recordType: 'case_vortex_operations_monitoring_input';
  schemaVersion: typeof CASE_VORTEX_OPERATIONS_MONITORING_VERSION;
  planId: string;
  planSha256: string;
  publication: CaseVortexOperationsPublication;
  completedAt: string;
  environmentId: string;
  monitorBuildId: string;
  drills: Array<{
    drill: CaseVortexOperationsDrill;
    artifactSha256: string;
    snapshot: CaseVortexOperationalSnapshot;
    databaseMutationCount: number;
    storageMutationCount: number;
    publicationActivationCount: number;
    deploymentCount: number;
  }>;
  telemetry: Array<{
    phase: CaseVortexTelemetryPhase;
    artifactSha256: string;
    containsQuestion: boolean;
    containsEvidenceAddress: boolean;
    containsAccountIdentifier: boolean;
    containsCredential: boolean;
    containsStorageKey: boolean;
    containsRawToolPayload: boolean;
  }>;
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
const TEST_ONLY = /(?:synthetic|simulated|fixture|test[-_: ]only|never[-_: ]publication)/iu;
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
const publication = (value: CaseVortexOperationsPublication) => {
  if (!value || !UUID.test(value.publicationId)
    || !VERSION.test(value.corpusVersion)
    || !SHA256.test(value.manifestSha256)) {
    return fail('case_vortex_operations_monitoring_publication_invalid');
  }
  return { ...value };
};
const exactTimestamp = (value: unknown) => {
  const candidate = text(
    value,
    'case_vortex_operations_monitoring_completed_at_invalid',
    40,
  );
  try {
    if (new Date(candidate).toISOString() !== candidate) {
      fail('case_vortex_operations_monitoring_completed_at_invalid');
    }
  } catch {
    return fail('case_vortex_operations_monitoring_completed_at_invalid');
  }
  return candidate;
};

const EXPECTED_DRILLS: Record<CaseVortexOperationsDrill, {
  mode: 'ready' | 'blocked' | 'degraded';
  alertCode: string | null;
  rollback: boolean;
  sourceMatches: (snapshot: CaseVortexOperationalSnapshot) => boolean;
}> = {
  healthy_ready: {
    mode: 'ready',
    alertCode: null,
    rollback: false,
    sourceMatches: () => true,
  },
  database_binding_unavailable: {
    mode: 'blocked',
    alertCode: 'configuration_database_unavailable',
    rollback: true,
    sourceMatches: (snapshot) => snapshot.configuration.databaseUrl === false,
  },
  storage_binding_unavailable: {
    mode: 'blocked',
    alertCode: 'configuration_storage_unavailable',
    rollback: true,
    sourceMatches: (snapshot) => snapshot.configuration.r2Storage === false,
  },
  cursor_secret_unavailable: {
    mode: 'blocked',
    alertCode: 'configuration_cursor_secret_unavailable',
    rollback: true,
    sourceMatches: (snapshot) => snapshot.configuration.researchCursorSecret === false,
  },
  luna_provider_unavailable: {
    mode: 'degraded',
    alertCode: 'configuration_luna_unavailable',
    rollback: false,
    sourceMatches: (snapshot) => snapshot.configuration.lunaApiKey === false,
  },
  publication_activation_conflict: {
    mode: 'blocked',
    alertCode: 'publication_activation_conflict',
    rollback: true,
    sourceMatches: (snapshot) => (snapshot.database?.activePublicationCount ?? 0) > 1,
  },
  active_lineage_unverified: {
    mode: 'blocked',
    alertCode: 'publication_active_lineage_unverified',
    rollback: true,
    sourceMatches: (snapshot) => snapshot.database?.activePublicationCount === 1
      && snapshot.database.verifiedV2ActivePublicationCount !== 1,
  },
  retained_influence_unverified: {
    mode: 'blocked',
    alertCode: 'retained_influence_projection_unverified',
    rollback: true,
    sourceMatches: (snapshot) => snapshot.database?.servingProjections
      ?.retainedInfluenceVerified === false,
  },
  incremental_job_failure: {
    mode: 'blocked',
    alertCode: 'incremental_jobs_failed',
    rollback: true,
    sourceMatches: (snapshot) => (snapshot.database?.incremental?.failedJobs ?? 0) > 0,
  },
  expired_lease_degraded: {
    mode: 'degraded',
    alertCode: 'incremental_leases_expired',
    rollback: false,
    sourceMatches: (snapshot) => (snapshot.database?.incremental?.expiredLeases ?? 0) > 0,
  },
};

export const buildCaseVortexOperationsMonitoringPlan = (input: {
  planId: string;
  publication: CaseVortexOperationsPublication;
}): CaseVortexOperationsMonitoringPlan => {
  const body = {
    recordType: 'case_vortex_operations_monitoring_plan' as const,
    schemaVersion: CASE_VORTEX_OPERATIONS_MONITORING_VERSION,
    planId: text(input.planId, 'case_vortex_operations_monitoring_plan_invalid', 200),
    publication: publication(input.publication),
    requirements: {
      drillCount: 10 as const,
      telemetryPhaseCount: 5 as const,
      uniqueRetainedArtifacts: true as const,
      readOnly: true as const,
      testOnlyEvidenceAllowed: false as const,
    },
    drills: CASE_VORTEX_OPERATIONS_DRILLS,
    telemetryPhases: CASE_VORTEX_TELEMETRY_PHASES,
  };
  return { ...body, planSha256: relationshipInputSha256(body) };
};

export const buildCaseVortexOperationsMonitoringReport = (
  input: CaseVortexOperationsMonitoringInput,
) => {
  if (!input || input.recordType !== 'case_vortex_operations_monitoring_input'
    || input.schemaVersion !== CASE_VORTEX_OPERATIONS_MONITORING_VERSION
    || !Array.isArray(input.drills) || input.drills.length !== 10
    || !Array.isArray(input.telemetry) || input.telemetry.length !== 5
    || !Array.isArray(input.issues)) {
    fail('case_vortex_operations_monitoring_input_invalid');
  }
  const exactPublication = publication(input.publication);
  const planId = text(input.planId, 'case_vortex_operations_monitoring_plan_invalid', 200);
  const planSha256 = digest(
    input.planSha256,
    'case_vortex_operations_monitoring_plan_digest_invalid',
  );
  const plan = buildCaseVortexOperationsMonitoringPlan({
    planId,
    publication: exactPublication,
  });
  if (plan.planSha256 !== planSha256) {
    fail('case_vortex_operations_monitoring_plan_binding_invalid');
  }
  const completedAt = exactTimestamp(input.completedAt);
  const environmentId = text(
    input.environmentId,
    'case_vortex_operations_monitoring_environment_invalid',
    200,
  );
  const monitorBuildId = text(
    input.monitorBuildId,
    'case_vortex_operations_monitoring_environment_invalid',
    200,
  );
  if (TEST_ONLY.test(environmentId) || TEST_ONLY.test(monitorBuildId)) {
    fail('case_vortex_operations_monitoring_environment_invalid');
  }

  const drillNames = new Set<CaseVortexOperationsDrill>();
  const artifactDigests = new Set<string>();
  let passedDrillCount = 0;
  let mutationCount = 0;
  const drills = input.drills.map((drill) => {
    if (!CASE_VORTEX_OPERATIONS_DRILLS.includes(drill.drill)
      || drillNames.has(drill.drill)) {
      return fail('case_vortex_operations_monitoring_drill_coverage_invalid');
    }
    drillNames.add(drill.drill);
    const artifactSha256 = digest(
      drill.artifactSha256,
      'case_vortex_operations_monitoring_artifact_invalid',
    );
    artifactDigests.add(artifactSha256);
    const mutations = {
      databaseMutationCount: count(
        drill.databaseMutationCount,
        'case_vortex_operations_monitoring_drill_invalid',
      ),
      storageMutationCount: count(
        drill.storageMutationCount,
        'case_vortex_operations_monitoring_drill_invalid',
      ),
      publicationActivationCount: count(
        drill.publicationActivationCount,
        'case_vortex_operations_monitoring_drill_invalid',
      ),
      deploymentCount: count(
        drill.deploymentCount,
        'case_vortex_operations_monitoring_drill_invalid',
      ),
    };
    mutationCount += Object.values(mutations).reduce((sum, value) => sum + value, 0);
    let health: ReturnType<typeof evaluateCaseVortexOperationalHealth>;
    try {
      health = evaluateCaseVortexOperationalHealth(drill.snapshot);
    } catch {
      return fail('case_vortex_operations_monitoring_snapshot_invalid');
    }
    const expected = EXPECTED_DRILLS[drill.drill];
    const alertCodes = health.alerts.map(({ code }) => code);
    const expectedAlertCodes = expected.alertCode === null ? [] : [expected.alertCode];
    const passed = expected.sourceMatches(drill.snapshot)
      && health.mode === expected.mode
      && health.servingRollbackRequired === expected.rollback
      && alertCodes.length === expectedAlertCodes.length
      && alertCodes.every((code, index) => code === expectedAlertCodes[index])
      && Object.values(mutations).every((value) => value === 0);
    if (passed) passedDrillCount += 1;
    return {
      drill: drill.drill,
      artifactSha256,
      observed: {
        mode: health.mode,
        alertCodes,
        servingRollbackRequired: health.servingRollbackRequired,
      },
      ...mutations,
      passed,
    };
  });
  if (drillNames.size !== 10 || artifactDigests.size !== 10) {
    fail('case_vortex_operations_monitoring_drill_independence_invalid');
  }

  const telemetryPhases = new Set<CaseVortexTelemetryPhase>();
  let passedTelemetryCount = 0;
  const telemetry = input.telemetry.map((observation) => {
    if (!CASE_VORTEX_TELEMETRY_PHASES.includes(observation.phase)
      || telemetryPhases.has(observation.phase)) {
      return fail('case_vortex_operations_monitoring_telemetry_coverage_invalid');
    }
    telemetryPhases.add(observation.phase);
    const artifactSha256 = digest(
      observation.artifactSha256,
      'case_vortex_operations_monitoring_artifact_invalid',
    );
    artifactDigests.add(artifactSha256);
    const privacy = {
      containsQuestion: observation.containsQuestion,
      containsEvidenceAddress: observation.containsEvidenceAddress,
      containsAccountIdentifier: observation.containsAccountIdentifier,
      containsCredential: observation.containsCredential,
      containsStorageKey: observation.containsStorageKey,
      containsRawToolPayload: observation.containsRawToolPayload,
    };
    if (Object.values(privacy).some((value) => typeof value !== 'boolean')) {
      fail('case_vortex_operations_monitoring_telemetry_invalid');
    }
    const passed = Object.values(privacy).every((value) => value === false);
    if (passed) passedTelemetryCount += 1;
    return { phase: observation.phase, artifactSha256, ...privacy, passed };
  });
  if (telemetryPhases.size !== 5 || artifactDigests.size !== 15) {
    fail('case_vortex_operations_monitoring_artifact_independence_invalid');
  }

  const issueIds = new Set<string>();
  const issues = input.issues.map((issue) => {
    if (!['critical', 'high', 'medium', 'low'].includes(issue.severity)
      || typeof issue.resolved !== 'boolean') {
      return fail('case_vortex_operations_monitoring_issue_invalid');
    }
    const issueId = text(
      issue.issueId,
      'case_vortex_operations_monitoring_issue_invalid',
      200,
    );
    if (issueIds.has(issueId)) fail('case_vortex_operations_monitoring_issue_invalid');
    issueIds.add(issueId);
    const resolutionReceiptSha256 = issue.resolutionReceiptSha256 === null
      ? null
      : digest(
        issue.resolutionReceiptSha256,
        'case_vortex_operations_monitoring_issue_invalid',
      );
    if (issue.resolved !== (resolutionReceiptSha256 !== null)) {
      fail('case_vortex_operations_monitoring_issue_invalid');
    }
    return {
      ...issue,
      issueId,
      description: text(
        issue.description,
        'case_vortex_operations_monitoring_issue_invalid',
        4_000,
      ),
      resolutionReceiptSha256,
    };
  });
  const unresolvedCriticalOrHighIssueCount = issues.filter((issue) => (
    !issue.resolved && (issue.severity === 'critical' || issue.severity === 'high')
  )).length;
  const criteria = [
    { criterion: 'passed_operational_drills', actual: passedDrillCount, required: 10, passed: passedDrillCount === 10 },
    { criterion: 'privacy_safe_telemetry_phases', actual: passedTelemetryCount, required: 5, passed: passedTelemetryCount === 5 },
    { criterion: 'unique_retained_artifacts', actual: artifactDigests.size, required: 15, passed: artifactDigests.size === 15 },
    { criterion: 'mutations_from_monitoring', actual: mutationCount, required: 0, passed: mutationCount === 0 },
    { criterion: 'unresolved_critical_or_high_issues', actual: unresolvedCriticalOrHighIssueCount, required: 0, passed: unresolvedCriticalOrHighIssueCount === 0 },
  ];
  const body = {
    recordType: 'case_vortex_operations_monitoring_report' as const,
    schemaVersion: CASE_VORTEX_OPERATIONS_MONITORING_VERSION,
    planId,
    planSha256,
    publication: exactPublication,
    completedAt,
    environmentId,
    monitorBuildId,
    accounting: {
      drillCount: drills.length,
      passedDrillCount,
      telemetryPhaseCount: telemetry.length,
      passedTelemetryCount,
      artifactCount: artifactDigests.size,
      mutationCount,
      issueCount: issues.length,
      unresolvedCriticalOrHighIssueCount,
    },
    drills,
    telemetry,
    issues,
    criteria,
    operationsMonitoringPassed: criteria.every(({ passed }) => passed),
    limitations: [
      'This report proves only the named publication, environment, monitor build and retained drill artifacts.',
      'A passing pre-deployment review does not prove post-deployment availability or authorize activation.',
      'Monitoring and drill evaluation perform no database, storage, publication or deployment mutation.',
    ],
  };
  return { ...body, reportSha256: relationshipInputSha256(body) };
};
