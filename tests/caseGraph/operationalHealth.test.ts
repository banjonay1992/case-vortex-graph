import { describe, expect, it } from 'vitest';

import { evaluateCaseVortexOperationalHealth } from '../../src/caseGraph/operationalHealth';

type MigrationState = 'aligned' | 'missing' | 'tracker_disagreement' | 'ledger_schema_drift' | 'untracked_schema';
const migrationState = (value: MigrationState): MigrationState => value;

const complete = () => ({
  configuration: { databaseUrl: true, r2Storage: true, researchCursorSecret: true, lunaApiKey: true },
  database: {
    serverVersionNum: 170006,
    relations: {
      uap_case_graph_publications: true,
      case_graph_research_search_builds: true,
      case_graph_research_search_publication_nodes: true,
      case_graph_content_search_builds: true,
      case_graph_claim_evidence_builds: true,
      case_graph_external_correlation_completions: true,
      case_vortex_workspaces: true,
      case_graph_external_provider_archives: true,
      uap_case_graph_runs: true,
      uap_case_graph_publication_receipts: true,
      uap_case_graph_incremental_plans: true,
      uap_case_graph_incremental_queue: true,
      case_vortex_retained_influence_builds: true,
      case_vortex_retained_influence_entries: true,
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
      migrations: {
        '0213': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0214': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0215': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0216': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0217': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0218': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0219': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
        '0220': { appTracked: true, supabaseTracked: true, schemaPresent: true, state: migrationState('aligned') },
      },
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
    incremental: { latestWatermarkSequence: 3, queuedJobs: 0, leasedJobs: 0, failedJobs: 0, expiredLeases: 0 },
  },
});

describe('Case Vortex operational health contract', () => {
  it('reports ready only for one complete, healthy serving generation', () => {
    expect(evaluateCaseVortexOperationalHealth(complete())).toMatchObject({
      mode: 'ready', alertCount: 0, criticalAlertCount: 0, servingRollbackRequired: false,
    });
  });

  it('keeps an inactive but otherwise healthy environment in explicit standby', () => {
    const snapshot = complete();
    snapshot.database.activePublicationCount = 0;
    snapshot.database.verifiedV2ActivePublicationCount = 0;
    expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
      mode: 'standby', criticalAlertCount: 0, servingRollbackRequired: false,
      alerts: [expect.objectContaining({ code: 'publication_not_active', severity: 'warning' })],
    });
  });

  it('requires rollback when an active publication lacks verified v2 lineage', () => {
    const snapshot = complete();
    snapshot.database.verifiedV2ActivePublicationCount = 0;
    expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
      mode: 'blocked', criticalAlertCount: 1, servingRollbackRequired: true,
      alerts: [expect.objectContaining({ code: 'publication_active_lineage_unverified', severity: 'critical' })],
    });
  });

  it('requires serving rollback for publication conflicts and broken active control planes', () => {
    const snapshot = complete();
    snapshot.database.activePublicationCount = 2;
    snapshot.database.relations.case_graph_content_search_builds = false;
    snapshot.database.incremental.failedJobs = 4;
    const health = evaluateCaseVortexOperationalHealth(snapshot);
    expect(health.mode).toBe('blocked');
    expect(health.servingRollbackRequired).toBe(true);
    expect(health.alerts.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'publication_activation_conflict',
      'database_relation_missing:case_graph_content_search_builds',
      'incremental_jobs_failed',
    ]));
  });

  it('blocks a verified publication when any publication-bound serving projection is incomplete', () => {
    const snapshot = complete();
    snapshot.database.servingProjections.claimEvidenceVerified = false;
    snapshot.database.servingProjections.externalCorrelationsComplete = false;
    expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
      mode: 'blocked', criticalAlertCount: 2, servingRollbackRequired: true,
      alerts: expect.arrayContaining([
        expect.objectContaining({ code: 'claim_evidence_projection_unverified' }),
        expect.objectContaining({ code: 'external_correlations_projection_incomplete' }),
      ]),
    });
  });

  it('blocks saved structured analysis when either current persistence migration is absent', () => {
    const snapshot = complete();
    snapshot.database.claimAnalysisToolReceiptSupported = false;
    snapshot.database.claimAnalysisPersistenceAvailable = false;
    snapshot.database.migrationReadiness.migrations['0214'] = {
      appTracked: false, supabaseTracked: false, schemaPresent: false, state: 'missing',
    };
    snapshot.database.migrationReadiness.migrations['0215'] = {
      appTracked: false, supabaseTracked: false, schemaPresent: false, state: 'missing',
    };
    expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
      schemaVersion: 'case-vortex-operational-health-v7',
      mode: 'blocked',
      criticalAlertCount: 2,
      servingRollbackRequired: true,
      alerts: expect.arrayContaining([
        expect.objectContaining({ code: 'migration_0214_missing' }),
        expect.objectContaining({ code: 'migration_0215_missing' }),
      ]),
    });
  });

  it('distinguishes tracker disagreement from missing or malformed schema', () => {
    const snapshot = complete();
    snapshot.database.activePublicationCount = 0;
    snapshot.database.verifiedV2ActivePublicationCount = 0;
    snapshot.database.claimAnalysisToolReceiptSupported = false;
    snapshot.database.migrationReadiness.migrations['0214'] = {
      appTracked: true, supabaseTracked: false, schemaPresent: true, state: 'tracker_disagreement',
    };
    const health = evaluateCaseVortexOperationalHealth(snapshot);
    expect(health).toMatchObject({
      mode: 'blocked',
      servingRollbackRequired: false,
      alerts: expect.arrayContaining([
        expect.objectContaining({
          code: 'migration_0214_tracker_disagreement',
          severity: 'critical',
        }),
        expect.objectContaining({ code: 'publication_not_active', severity: 'warning' }),
      ]),
    });
  });

  it('requires rollback when the all-retained influence projection is not verified', () => {
    const snapshot = complete();
    snapshot.database.servingProjections.retainedInfluenceVerified = false;
    expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
      mode: 'blocked',
      criticalAlertCount: 1,
      servingRollbackRequired: true,
      alerts: [
        expect.objectContaining({
          code: 'retained_influence_projection_unverified',
          severity: 'critical',
        }),
      ],
    });
  });

  it('requires serving rollback when the guarded rollback migration is missing', () => {
    const snapshot = complete();
    snapshot.database.publicationRollbackAvailable = false;
    snapshot.database.migrationReadiness.migrations['0217'] = {
      appTracked: false,
      supabaseTracked: false,
      schemaPresent: false,
      state: 'missing',
    };
    expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
      mode: 'blocked',
      criticalAlertCount: 1,
      servingRollbackRequired: true,
      alerts: [
        expect.objectContaining({
          code: 'migration_0217_missing',
          severity: 'critical',
        }),
      ],
    });
  });

  it('fails closed without inventing database or incremental health', () => {
    expect(evaluateCaseVortexOperationalHealth({
      configuration: { databaseUrl: false, r2Storage: false, researchCursorSecret: false, lunaApiKey: false },
      database: null,
    })).toMatchObject({ mode: 'unverified', servingRollbackRequired: false, criticalAlertCount: 3 });
  });

  it('requires serving rollback when an active publication loses a critical runtime binding', () => {
    for (const key of ['databaseUrl', 'r2Storage', 'researchCursorSecret'] as const) {
      const snapshot = complete();
      snapshot.configuration[key] = false;
      expect(evaluateCaseVortexOperationalHealth(snapshot)).toMatchObject({
        mode: 'blocked',
        criticalAlertCount: 1,
        servingRollbackRequired: true,
      });
    }
  });
});
