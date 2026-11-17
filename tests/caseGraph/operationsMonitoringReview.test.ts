import { describe, expect, it } from 'vitest';

import {
  verifyCaseVortexAuthoritativeEvidenceArtifact,
} from '../../src/caseGraph/authoritativeEvidenceArtifact';
import {
  buildCaseVortexOperationsMonitoringPlan,
  buildCaseVortexOperationsMonitoringReport,
  CASE_VORTEX_OPERATIONS_DRILLS,
  CASE_VORTEX_OPERATIONS_MONITORING_VERSION,
  CASE_VORTEX_TELEMETRY_PHASES,
  type CaseVortexOperationsMonitoringInput,
} from '../../src/caseGraph/operationsMonitoringReview';
import {
  type CaseVortexOperationalSnapshot,
} from '../../src/caseGraph/operationalHealth';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-26-v3',
  manifestSha256: 'a'.repeat(64),
};

const healthySnapshot = (): CaseVortexOperationalSnapshot => ({
  configuration: {
    databaseUrl: true,
    r2Storage: true,
    researchCursorSecret: true,
    lunaApiKey: true,
  },
  database: {
    serverVersionNum: 170_006,
    relations: {
      uap_case_graph_publications: true,
      case_graph_research_search_builds: true,
      case_graph_content_search_builds: true,
      case_graph_claim_evidence_builds: true,
      case_graph_external_correlation_completions: true,
      case_vortex_retained_influence_builds: true,
    },
    savedReportReplayColumns: true,
    claimAnalysisToolReceiptSupported: true,
    claimAnalysisPersistenceAvailable: true,
    claimAnalysisPrivilegeRepairAvailable: true,
    retainedInfluenceMigrationAvailable: true,
    publicationRollbackAvailable: true,
    sourceGovernanceCascadeRepairAvailable: true,
    sourceGovernanceMapQueueRepairAvailable: true,
    migrationReadiness: {
      appTrackerPresent: true,
      supabaseTrackerPresent: true,
      migrations: Object.fromEntries(['0213', '0214', '0215', '0216', '0217', '0218', '0219', '0220'].map((version) => [
        version,
        { appTracked: true, supabaseTracked: true, schemaPresent: true, state: 'aligned' },
      ])) as CaseVortexOperationalSnapshot['database'] extends infer Database
        ? Database extends { migrationReadiness: infer Readiness }
          ? Readiness extends { migrations: infer Migrations } ? Migrations : never
          : never
        : never,
    },
    activePublicationCount: 1,
    verifiedV2ActivePublicationCount: 1,
    servingProjections: {
      researchSearchVerified: true,
      retainedInfluenceVerified: true,
      contentSearchVerified: true,
      claimEvidenceVerified: true,
      externalCorrelationsComplete: true,
    },
    incremental: {
      latestWatermarkSequence: 4,
      queuedJobs: 0,
      leasedJobs: 0,
      failedJobs: 0,
      expiredLeases: 0,
    },
  },
});

const drillSnapshot = (
  drill: typeof CASE_VORTEX_OPERATIONS_DRILLS[number],
): CaseVortexOperationalSnapshot => {
  const snapshot = healthySnapshot();
  switch (drill) {
    case 'database_binding_unavailable':
      snapshot.configuration.databaseUrl = false;
      break;
    case 'storage_binding_unavailable':
      snapshot.configuration.r2Storage = false;
      break;
    case 'cursor_secret_unavailable':
      snapshot.configuration.researchCursorSecret = false;
      break;
    case 'luna_provider_unavailable':
      snapshot.configuration.lunaApiKey = false;
      break;
    case 'publication_activation_conflict':
      snapshot.database!.activePublicationCount = 2;
      break;
    case 'active_lineage_unverified':
      snapshot.database!.verifiedV2ActivePublicationCount = 0;
      break;
    case 'retained_influence_unverified':
      snapshot.database!.servingProjections!.retainedInfluenceVerified = false;
      break;
    case 'incremental_job_failure':
      snapshot.database!.incremental!.failedJobs = 1;
      break;
    case 'expired_lease_degraded':
      snapshot.database!.incremental!.expiredLeases = 1;
      break;
    case 'healthy_ready':
      break;
  }
  return snapshot;
};

const monitoringInput = (): CaseVortexOperationsMonitoringInput => {
  const plan = buildCaseVortexOperationsMonitoringPlan({
    planId: 'case-vortex-operations-monitoring-2026-07-26',
    publication,
  });
  return {
    recordType: 'case_vortex_operations_monitoring_input',
    schemaVersion: CASE_VORTEX_OPERATIONS_MONITORING_VERSION,
    planId: plan.planId,
    planSha256: plan.planSha256,
    publication,
    completedAt: '2026-07-26T20:00:00.000Z',
    environmentId: 'staging-operations-review-eu-west',
    monitorBuildId: 'case-vortex-monitor-build-2026-07-26.1',
    drills: CASE_VORTEX_OPERATIONS_DRILLS.map((drill) => ({
      drill,
      artifactSha256: relationshipInputSha256({ drill, artifact: 'trace' }),
      snapshot: drillSnapshot(drill),
      databaseMutationCount: 0,
      storageMutationCount: 0,
      publicationActivationCount: 0,
      deploymentCount: 0,
    })),
    telemetry: CASE_VORTEX_TELEMETRY_PHASES.map((phase) => ({
      phase,
      artifactSha256: relationshipInputSha256({ phase, artifact: 'telemetry' }),
      containsQuestion: false,
      containsEvidenceAddress: false,
      containsAccountIdentifier: false,
      containsCredential: false,
      containsStorageKey: false,
      containsRawToolPayload: false,
    })),
    issues: [],
  };
};

describe('Case Vortex operations monitoring review', () => {
  it('proves ten exact drills, five privacy-safe telemetry phases and zero mutations', () => {
    const input = monitoringInput();
    const report = buildCaseVortexOperationsMonitoringReport(input);
    expect(report.operationsMonitoringPassed).toBe(true);
    expect(report.accounting).toMatchObject({
      drillCount: 10,
      passedDrillCount: 10,
      telemetryPhaseCount: 5,
      passedTelemetryCount: 5,
      artifactCount: 15,
      mutationCount: 0,
      unresolvedCriticalOrHighIssueCount: 0,
    });
    expect(report.drills.find(({ drill }) => drill === 'database_binding_unavailable'))
      .toMatchObject({
        observed: {
          mode: 'blocked',
          alertCodes: ['configuration_database_unavailable'],
          servingRollbackRequired: true,
        },
      });

    expect(verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'operations_monitoring',
      publication,
      verifiedAt: '2026-07-26T20:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(input)),
      artifactBody: Buffer.from(JSON.stringify(report)),
    })).toMatchObject({
      gate: 'operations_monitoring',
      artifactType: 'case_vortex_operations_monitoring_evidence_set',
      publication,
    });
  });

  it('rejects omitted, duplicated or reused retained drill evidence', () => {
    const omitted = monitoringInput();
    omitted.drills.pop();
    expect(() => buildCaseVortexOperationsMonitoringReport(omitted))
      .toThrow('case_vortex_operations_monitoring_input_invalid');

    const duplicated = monitoringInput();
    duplicated.drills[9] = {
      ...duplicated.drills[0]!,
      artifactSha256: relationshipInputSha256({ duplicate: 'drill' }),
    };
    expect(() => buildCaseVortexOperationsMonitoringReport(duplicated))
      .toThrow('case_vortex_operations_monitoring_drill_coverage_invalid');

    const reused = monitoringInput();
    reused.telemetry[0]!.artifactSha256 = reused.drills[0]!.artifactSha256;
    expect(() => buildCaseVortexOperationsMonitoringReport(reused))
      .toThrow('case_vortex_operations_monitoring_artifact_independence_invalid');
  });

  it('fails closed for a wrong drill result, privacy leak, mutation or unresolved high issue', () => {
    const wrongDrill = monitoringInput();
    wrongDrill.drills.find(({ drill }) => drill === 'retained_influence_unverified')!.snapshot =
      healthySnapshot();
    expect(buildCaseVortexOperationsMonitoringReport(wrongDrill).operationsMonitoringPassed)
      .toBe(false);

    const leaked = monitoringInput();
    leaked.telemetry[0]!.containsQuestion = true;
    expect(buildCaseVortexOperationsMonitoringReport(leaked).operationsMonitoringPassed)
      .toBe(false);

    const mutated = monitoringInput();
    mutated.drills[0]!.databaseMutationCount = 1;
    expect(buildCaseVortexOperationsMonitoringReport(mutated).operationsMonitoringPassed)
      .toBe(false);

    const unresolved = monitoringInput();
    unresolved.issues.push({
      issueId: 'OPS-001',
      severity: 'high',
      description: 'A retained unresolved operational issue.',
      resolved: false,
      resolutionReceiptSha256: null,
    });
    const report = buildCaseVortexOperationsMonitoringReport(unresolved);
    expect(report.operationsMonitoringPassed).toBe(false);
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'operations_monitoring',
      publication,
      verifiedAt: '2026-07-26T20:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(unresolved)),
      artifactBody: Buffer.from(JSON.stringify(report)),
    })).toThrow('case_vortex_authoritative_operations_monitoring_gate_failed');
  });

  it('rejects test-only environments and a re-sealed report that differs from its input', () => {
    const invalidEnvironment = monitoringInput();
    invalidEnvironment.environmentId = 'synthetic-test-only-monitor';
    expect(() => buildCaseVortexOperationsMonitoringReport(invalidEnvironment))
      .toThrow('case_vortex_operations_monitoring_environment_invalid');

    const input = monitoringInput();
    const report = buildCaseVortexOperationsMonitoringReport(input);
    const changed = {
      ...report,
      limitations: [...report.limitations, 'Inserted after monitoring completed.'],
    };
    const { reportSha256: _discarded, ...body } = changed;
    const resealed = { ...changed, reportSha256: relationshipInputSha256(body) };
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'operations_monitoring',
      publication,
      verifiedAt: '2026-07-26T20:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(input)),
      artifactBody: Buffer.from(JSON.stringify(resealed)),
    })).toThrow('case_vortex_authoritative_artifact_rebuild_mismatch');
  });
});
