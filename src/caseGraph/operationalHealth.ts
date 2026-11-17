export const CASE_VORTEX_OPERATIONAL_HEALTH_VERSION = 'case-vortex-operational-health-v7' as const;

export type CaseVortexOperationalSnapshot = {
  configuration: {
    databaseUrl: boolean;
    r2Storage: boolean;
    researchCursorSecret: boolean;
    lunaApiKey: boolean;
  };
  database: null | {
    serverVersionNum: number;
    relations: Record<string, boolean>;
    savedReportReplayColumns: boolean;
    claimAnalysisToolReceiptSupported: boolean;
    claimAnalysisPersistenceAvailable: boolean;
    claimAnalysisPrivilegeRepairAvailable: boolean;
    retainedInfluenceMigrationAvailable: boolean;
    publicationRollbackAvailable: boolean;
    sourceGovernanceCascadeRepairAvailable: boolean;
    sourceGovernanceMapQueueRepairAvailable: boolean;
    migrationReadiness: {
      appTrackerPresent: boolean;
      supabaseTrackerPresent: boolean;
      migrations: Record<
      '0213' | '0214' | '0215' | '0216' | '0217' | '0218' | '0219' | '0220',
      {
        appTracked: boolean;
        supabaseTracked: boolean;
        schemaPresent: boolean;
        state: 'aligned' | 'missing' | 'tracker_disagreement' | 'ledger_schema_drift' | 'untracked_schema';
      }>;
    };
    activePublicationCount: number;
    verifiedV2ActivePublicationCount: number;
    servingProjections: null | {
      researchSearchVerified: boolean;
      retainedInfluenceVerified: boolean;
      contentSearchVerified: boolean;
      claimEvidenceVerified: boolean;
      externalCorrelationsComplete: boolean;
    };
    incremental: null | {
      latestWatermarkSequence: number;
      queuedJobs: number;
      leasedJobs: number;
      failedJobs: number;
      expiredLeases: number;
    };
  };
};

export type CaseVortexOperationalAlert = {
  code: string;
  severity: 'warning' | 'critical';
  action: string;
};

const alert = (
  code: string,
  severity: CaseVortexOperationalAlert['severity'],
  action: string,
): CaseVortexOperationalAlert => ({ code, severity, action });

const MIGRATION_ACTIONS = {
  missing: 'Keep the affected capability disabled and apply only the reviewed migration path.',
  tracker_disagreement: 'Keep the affected capability disabled; reconcile the app and Supabase migration trackers through an exact approved recovery.',
  ledger_schema_drift: 'Keep the affected capability disabled; the ledgers claim completion but the exact schema signature is absent.',
  untracked_schema: 'Keep the affected capability disabled; schema exists without matching migration-ledger provenance.',
} as const;

export const evaluateCaseVortexOperationalHealth = (snapshot: CaseVortexOperationalSnapshot) => {
  const alerts: CaseVortexOperationalAlert[] = [];
  if (!snapshot.configuration.databaseUrl) {
    alerts.push(alert('configuration_database_unavailable', 'critical', 'Keep research and publication activation disabled; restore the approved database binding.'));
  }
  if (!snapshot.configuration.r2Storage) {
    alerts.push(alert('configuration_storage_unavailable', 'critical', 'Keep publication activation and source replay disabled; restore the approved immutable storage binding.'));
  }
  if (!snapshot.configuration.researchCursorSecret) {
    alerts.push(alert('configuration_cursor_secret_unavailable', 'critical', 'Disable relationship and content traversal until a 32-character-or-longer server secret is configured.'));
  }
  if (!snapshot.configuration.lunaApiKey) {
    alerts.push(alert('configuration_luna_unavailable', 'warning', 'Keep deterministic evidence browsing available but disable Luna investigations.'));
  }

  const database = snapshot.database;
  if (!database) {
    alerts.push(alert('database_not_checked', 'warning', 'Run the read-only database readiness check before build, activation, or rollback decisions.'));
  } else {
    if (database.serverVersionNum < 170000) {
      alerts.push(alert('postgres_version_unsupported', 'critical', 'Do not build or serve the publication; restore the approved PostgreSQL 17 path.'));
    }
    for (const [relation, present] of Object.entries(database.relations).sort(([left], [right]) => left.localeCompare(right))) {
      if (!present) alerts.push(alert(`database_relation_missing:${relation}`, 'critical', 'Keep the affected capability fail-closed and apply only the reviewed migration path.'));
    }
    for (const version of [
      '0213', '0214', '0215', '0216', '0217', '0218', '0219', '0220',
    ] as const) {
      const state = database.migrationReadiness.migrations[version].state;
      if (state !== 'aligned') {
        alerts.push(alert(`migration_${version}_${state}`, 'critical', MIGRATION_ACTIONS[state]));
      }
    }
    if (database.activePublicationCount === 0) {
      alerts.push(alert('publication_not_active', 'warning', 'Remain in standby; do not manufacture or infer an active publication.'));
    } else if (database.activePublicationCount !== 1) {
      alerts.push(alert('publication_activation_conflict', 'critical', 'Stop serving the graph and restore one previously verified activation receipt.'));
    } else if (database.verifiedV2ActivePublicationCount !== 1) {
      alerts.push(alert('publication_active_lineage_unverified', 'critical', 'Stop serving the graph; an active row is not bound to one completed v2 run and immutable publication receipt.'));
    }
    if (database.activePublicationCount === 1 && database.verifiedV2ActivePublicationCount === 1) {
      const projections = database.servingProjections;
      if (!projections) {
        alerts.push(alert('serving_projections_unverified', 'critical', 'Keep Case Vortex and Luna fail-closed until every publication-bound serving projection is checked.'));
      } else {
        if (!projections.researchSearchVerified) {
          alerts.push(alert('research_search_projection_unverified', 'critical', 'Disable record search, the orb and similar-case traversal until the active publication search projection is verified.'));
        }
        if (!projections.retainedInfluenceVerified) {
          alerts.push(alert('retained_influence_projection_unverified', 'critical', 'Disable Luna and every research capability until all queryable retained discovery signals and metadata leads are bound to the active publication.'));
        }
        if (!projections.contentSearchVerified) {
          alerts.push(alert('content_search_projection_unverified', 'critical', 'Disable full-content search and precise source replay until the active publication content projection is verified.'));
        }
        if (!projections.claimEvidenceVerified) {
          alerts.push(alert('claim_evidence_projection_unverified', 'critical', 'Disable claims, counterclaims and reliability analysis until the active publication claim projection is verified.'));
        }
        if (!projections.externalCorrelationsComplete) {
          alerts.push(alert('external_correlations_projection_incomplete', 'critical', 'Disable external-correlation conclusions until the active publication coverage completion is verified.'));
        }
      }
    }
    if (!database.incremental) {
      alerts.push(alert('incremental_control_unavailable', 'critical', 'Do not start or resume an incremental run until its control-plane relations are verified.'));
    } else {
      if (database.incremental.failedJobs > 0) {
        alerts.push(alert('incremental_jobs_failed', 'critical', 'Pause the watermark, retain failed receipts, and investigate before retry or full-rebuild fallback.'));
      }
      if (database.incremental.expiredLeases > 0) {
        alerts.push(alert('incremental_leases_expired', 'warning', 'Reclaim only through the lease-aware control path and verify idempotent batch receipts.'));
      }
    }
  }

  const critical = alerts.some((entry) => entry.severity === 'critical');
  const hasActivePublication = Boolean(database && database.activePublicationCount > 0);
  const active = database?.activePublicationCount === 1 && database.verifiedV2ActivePublicationCount === 1;
  const mode = !database
    ? 'unverified'
    : critical
      ? 'blocked'
      : !active
        ? 'standby'
        : alerts.length
          ? 'degraded'
          : 'ready';
  const servingRollbackRequired = Boolean(hasActivePublication && alerts.some((entry) => (
    entry.severity === 'critical'
    && (entry.code === 'configuration_database_unavailable'
      || entry.code === 'configuration_storage_unavailable'
      || entry.code === 'configuration_cursor_secret_unavailable'
      || entry.code.startsWith('database_')
      || entry.code.startsWith('postgres_')
      || entry.code.startsWith('migration_')
      || entry.code === 'publication_active_lineage_unverified'
      || entry.code === 'serving_projections_unverified'
      || entry.code.endsWith('_projection_unverified')
      || entry.code === 'external_correlations_projection_incomplete'
      || entry.code.startsWith('incremental_'))
  ))) || Boolean(database && database.activePublicationCount > 1);

  return {
    schemaVersion: CASE_VORTEX_OPERATIONAL_HEALTH_VERSION,
    mode,
    alertCount: alerts.length,
    criticalAlertCount: alerts.filter((entry) => entry.severity === 'critical').length,
    servingRollbackRequired,
    alerts,
  } as const;
};
