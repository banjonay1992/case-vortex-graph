import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadEnv } from '../env';
import {
  createBoundedReadOnlyPostgres,
  type BoundedReadOnlyPostgres,
} from '../db/boundedReadOnlyPostgres';
import { parseDatabaseEndpoint, resolveDatabaseTlsPolicy } from '../db/connectionSecurity';
import { splitSqlStatements } from '../db/sqlStatementSplitter';

type QueryResult = { rows: Array<Record<string, unknown>> };
export type CaseVortexMigrationSignatureQuery = (
  sql: string,
  params?: readonly unknown[],
) => Promise<QueryResult>;
type Query = CaseVortexMigrationSignatureQuery;

type MigrationContract = {
  version: string;
  fileName: string;
  sha256: string;
  signatures: readonly string[];
  reapplySafeWhenSchemaPresent?: boolean;
};

const CONTROL_PLANE_BASELINE_COLUMNS = {
  uap_case_graph_runs: [
    'id', 'corpus_version', 'publishability_policy', 'feature_schema_version',
    'rarity_version', 'candidate_version', 'relationship_policy_version', 'status',
    'source_snapshot_at', 'expected_eligible_count', 'processed_eligible_count',
    'excluded_count', 'candidate_count', 'edge_count', 'isolated_case_count',
    'shard_count', 'feature_cursor_updated_at', 'feature_cursor_sighting_id',
    'r2_prefix', 'completion_manifest_key', 'completion_manifest_sha256',
    'error_code', 'error_detail', 'metadata', 'created_at', 'updated_at', 'completed_at',
  ],
  uap_case_graph_shards: [
    'run_id', 'shard_id', 'stage', 'status', 'expected_case_count',
    'processed_case_count', 'output_record_count', 'first_cursor', 'last_cursor',
    'artifact_key', 'artifact_sha256', 'manifest_key', 'manifest_sha256',
    'checkpoint', 'audit', 'error_code', 'error_detail', 'started_at', 'completed_at',
    'created_at', 'updated_at',
  ],
  uap_case_graph_case_state: [
    'sighting_id', 'corpus_version', 'feature_schema_version', 'feature_digest',
    'source_updated_at', 'feature_shard_id', 'feature_artifact_key', 'feature_row_index',
    'graph_degree', 'ego_shard_id', 'ego_artifact_key', 'last_run_id', 'indexed_at',
    'updated_at',
  ],
  uap_case_graph_publications: [
    'id', 'run_id', 'corpus_version', 'public_manifest_key', 'public_manifest_sha256',
    'active', 'activated_at', 'deactivated_at', 'rollback_of_publication_id',
    'created_at',
  ],
} as const;

export const CASE_VORTEX_MIGRATION_CONTRACTS: readonly MigrationContract[] = [
  { version: '0202', fileName: '0202_case_graph_control_plane_2026_07_17.sql', sha256: '5dd03fdfadf07b4d660dc8d0112b5721493e4f8c11216b3bc7b63641d48e83d1', signatures: ['relation:uap_case_graph_runs', 'relation:uap_case_graph_shards', 'relation:uap_case_graph_case_state', 'relation:uap_case_graph_publications', 'baseline-columns:case_graph_control_plane', 'security:case_graph_control_plane_rls'], reapplySafeWhenSchemaPresent: true },
  { version: '0203', fileName: '0203_case_graph_cursor_millisecond_index_2026_07_17.sql', sha256: '197b52a81a1539fa29ea605c496c04b72d4f6ad361938aac78159f69b2e811de', signatures: ['index:idx_uap_sightings_case_graph_source_cursor_ms', 'definition:idx_uap_sightings_case_graph_source_cursor_ms', 'absence:idx_uap_sightings_case_graph_source_cursor'], reapplySafeWhenSchemaPresent: true },
  { version: '0204', fileName: '0204_evidence_universe_materialized_snapshot_2026_07_17.sql', sha256: '871f8911028063e8d49e974b859e471c6009c7d2216dd51bd2101b52e6e458f5', signatures: ['relation:uap_evidence_universe_snapshots', 'relation:uap_evidence_universe_snapshot_components', 'relation:uap_evidence_universe_snapshot_rows', 'columns:uap_search_catalog_media_state.mutation_watermark_complete+mutation_watermark_completed_at', 'function:capture_uap_evidence_universe_media_snapshot', 'trigger:trg_uap_search_catalog_media_mutation_watermark'] },
  { version: '0205', fileName: '0205_case_graph_v2_lineage_and_incremental_control_2026_07_18.sql', sha256: '55cb2a3a88db91f73d64b0a96a6193b2863de667f34ab60c46a26c35ddc7297e', signatures: ['relation:uap_case_graph_incremental_plans', 'relation:uap_case_graph_incremental_queue', 'relation:uap_case_graph_publication_receipts', 'columns:uap_case_graph_runs.lineage_version+snapshot_id+corpus_accounting_digest+graph_artifact_set_sha256'] },
  { version: '0206', fileName: '0206_case_graph_research_search_postgres_2026_07_18.sql', sha256: '9666843421036adbd2b94db6aa9d6f9829f155700cab415d54b7c37c00f4ce25', signatures: ['relation:case_graph_research_search_builds', 'relation:case_graph_research_search_attempt_audits', 'relation:case_graph_research_search_source_shards', 'relation:case_graph_research_search_documents'] },
  { version: '0207', fileName: '0207_case_vortex_research_usage_limiter_2026_07_18.sql', sha256: '33a2bc26f1360a57c834c80f71db8825dc3417effd81f178a8d9c553aaaf9eaf', signatures: ['relation:case_vortex_research_usage_windows', 'relation:case_vortex_research_usage_leases', 'relation:case_vortex_research_usage_reservations'] },
  { version: '0208', fileName: '0208_case_graph_content_search_postgres_2026_07_19.sql', sha256: '57d93e8f96cdad3472f91f55d5fd029948e2aeda42d3accf05fd22e4e5b9e3b4', signatures: ['relation:case_graph_content_search_builds', 'relation:case_graph_content_search_chunks', 'relation:case_graph_content_search_source_shards'] },
  { version: '0209', fileName: '0209_case_graph_claim_evidence_ledger_2026_07_20.sql', sha256: 'b0e8bd026491aa88ca9ee8dfcfa80a484672b0cad23cbeb0d4d908cbebfbf4d1', signatures: ['relation:case_graph_claim_evidence_builds', 'relation:case_graph_atomic_claims', 'relation:case_graph_claim_links', 'relation:case_graph_source_reliability_assessments'] },
  { version: '0210', fileName: '0210_case_vortex_investigation_workspaces_2026_07_20.sql', sha256: '7cc26506ee90a945a88d48e2bdd77c7bdd55544e8d8fcd2a2747f22de7a12b73', signatures: ['relation:case_vortex_workspaces', 'relation:case_vortex_workspace_groups', 'relation:case_vortex_workspace_evidence', 'relation:case_vortex_workspace_hypotheses', 'relation:case_vortex_hypothesis_evidence', 'relation:case_vortex_luna_threads', 'relation:case_vortex_luna_turns', 'relation:case_vortex_workspace_dossiers', 'relation:case_vortex_workspace_audit'] },
  { version: '0211', fileName: '0211_case_vortex_external_correlations_2026_07_20.sql', sha256: 'dacdd4602e478797b60b0b4a5da7e933da8f7ca41e33a128647d7e42bd56f28a', signatures: ['relation:case_graph_external_source_snapshots', 'relation:case_graph_external_correlation_coverage', 'relation:case_graph_external_correlation_candidates', 'relation:case_graph_external_correlation_completions'] },
  { version: '0212', fileName: '0212_case_vortex_external_provider_archives_2026_07_21.sql', sha256: 'cc5e1b736127d0f687d30cf7166f15b40ce37ba5554ead3417ee80d16c18b9cf', signatures: ['relation:case_graph_external_provider_archives', 'relation:case_graph_external_provider_archive_records'] },
  { version: '0213', fileName: '0213_case_vortex_saved_report_replay_2026_07_22.sql', sha256: '9c9ecd762ccd3045e82fb369668debc3689a59e1c8c219aa985d9dfe04ce144e', signatures: ['columns:case_vortex_luna_turns.tool_receipts+provider_usage'] },
] as const;

const RELATION_SIGNATURES = CASE_VORTEX_MIGRATION_CONTRACTS
  .flatMap(({ signatures }) => signatures)
  .filter((signature) => signature.startsWith('relation:'))
  .map((signature) => signature.slice('relation:'.length));

export const caseVortexMigrationSignatureKey = (signature: string) => (
  signature.startsWith('relation:')
    ? signature.slice('relation:'.length)
    : signature.startsWith('index:')
      ? signature.slice('index:'.length)
      : signature
);

export const CASE_VORTEX_EXPECTED_SCHEMA_SIGNATURE_KEYS = CASE_VORTEX_MIGRATION_CONTRACTS
  .flatMap(({ signatures }) => signatures)
  .map(caseVortexMigrationSignatureKey);

export const caseVortexRemoteRehearsalUsage = `Usage:
  npm run case-vortex:remote-rehearsal
  npm run case-vortex:remote-rehearsal -- --check-db [--strict]

Builds a deterministic migration rehearsal receipt. --check-db inspects the
remote migration ledgers and schema only through bounded READ ONLY transactions.
It never applies migrations, writes rows, accesses R2, calls Luna, or publishes.
`;

type Dependencies = {
  env: NodeJS.ProcessEnv;
  migrationsDir?: string;
  readMigration?: (filePath: string) => Promise<Buffer>;
  query?: Query;
  loadQuery?: () => Promise<{ query: Query; close: () => Promise<void> }>;
};

const parseArguments = (argv: string[]) => {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true as const };
  let checkDb = false;
  let strict = false;
  for (const argument of argv) {
    if (argument === '--check-db') checkDb = true;
    else if (argument === '--strict') strict = true;
    else throw new Error(`case_vortex_remote_rehearsal_argument_invalid:${argument}`);
  }
  return { help: false as const, checkDb, strict };
};

export const resolveCaseVortexRehearsalDatabaseConfig = (env: NodeJS.ProcessEnv) => {
  const endpoint = parseDatabaseEndpoint(String(env.DATABASE_URL || '').trim());
  const tlsPolicy = resolveDatabaseTlsPolicy(endpoint, env);
  return {
    connectionString: endpoint.effectiveConnectionString,
    ssl: tlsPolicy.ssl,
  };
};

const createDefaultReadOnlyQuery = async (env: NodeJS.ProcessEnv) => {
  if (!String(env.DATABASE_URL || '').trim()) {
    throw new Error('case_vortex_remote_rehearsal_database_url_missing');
  }
  const databaseConfig = resolveCaseVortexRehearsalDatabaseConfig(env);
  const limits = {
    maxConcurrent: 1,
    maxQueued: 1,
    acquireTimeoutMs: 8_000,
    setupTimeoutMs: 5_000,
    rollbackTimeoutMs: 5_000,
    cancelConnectTimeoutMs: 3_000,
    cancelQueryTimeoutMs: 3_000,
    cancelEndTimeoutMs: 3_000,
    cancelSettleTimeoutMs: 5_000,
  };
  const adapter: BoundedReadOnlyPostgres = createBoundedReadOnlyPostgres({
    workerPoolConfig: { ...databaseConfig, max: 1 },
    controlClientConfig: databaseConfig,
    limits,
    requireVerifiedCancellationCapability: false,
  });
  return {
    query: async (sql: string, params: readonly unknown[] = []) => {
      const result = await adapter.query(sql, params, {
        statementTimeoutMs: 8_000,
        queryTimeoutMs: 10_000,
      });
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    close: () => adapter.close(),
  };
};

const truthy = (value: unknown) => value === true || value === 't';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export const inspectCaseVortexMigrationSignatures = async (query: Query) => {
  const signatureRows = await query(`
        /* case_vortex_remote_rehearsal:signatures */
        SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
        FROM unnest($1::text[]) AS name
        UNION ALL
        SELECT 'idx_uap_sightings_case_graph_source_cursor_ms',
          to_regclass('public.idx_uap_sightings_case_graph_source_cursor_ms') IS NOT NULL
        UNION ALL
        SELECT 'absence:idx_uap_sightings_case_graph_source_cursor',
          to_regclass('public.idx_uap_sightings_case_graph_source_cursor') IS NULL
        UNION ALL
        SELECT 'definition:idx_uap_sightings_case_graph_source_cursor_ms',
          COALESCE(
            pg_get_indexdef(to_regclass('public.idx_uap_sightings_case_graph_source_cursor_ms'))
              ILIKE '%date_trunc(%milliseconds%AT TIME ZONE%UTC%',
            false
          )
        UNION ALL
        SELECT 'baseline-columns:case_graph_control_plane', NOT EXISTS (
          SELECT 1
          FROM jsonb_each($2::jsonb) AS expected(table_name, columns)
          CROSS JOIN LATERAL jsonb_array_elements_text(expected.columns) AS column_name
          WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns AS actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = expected.table_name
              AND actual.column_name = column_name
          )
        )
        UNION ALL
        SELECT 'security:case_graph_control_plane_rls',
          (SELECT count(*) = 4
           FROM pg_catalog.pg_class AS relation
           JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = 'public'
             AND relation.relname = ANY(ARRAY[
               'uap_case_graph_runs', 'uap_case_graph_shards',
               'uap_case_graph_case_state', 'uap_case_graph_publications'
             ]::text[])
             AND relation.relrowsecurity)
        UNION ALL
        SELECT 'columns:uap_case_graph_runs.lineage_version+snapshot_id+corpus_accounting_digest+graph_artifact_set_sha256',
          (SELECT count(*) = 4 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'uap_case_graph_runs'
             AND column_name = ANY(ARRAY[
               'lineage_version', 'snapshot_id', 'corpus_accounting_digest',
               'graph_artifact_set_sha256'
             ]::text[]))
        UNION ALL
        SELECT 'columns:uap_search_catalog_media_state.mutation_watermark_complete+mutation_watermark_completed_at',
          (SELECT count(*) = 2 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'uap_search_catalog_media_state'
             AND column_name = ANY(ARRAY[
               'mutation_watermark_complete', 'mutation_watermark_completed_at'
             ]::text[]))
        UNION ALL
        SELECT 'function:capture_uap_evidence_universe_media_snapshot',
          to_regprocedure('public.capture_uap_evidence_universe_media_snapshot(uuid)') IS NOT NULL
        UNION ALL
        SELECT 'trigger:trg_uap_search_catalog_media_mutation_watermark',
          EXISTS (
            SELECT 1
            FROM pg_catalog.pg_trigger AS trigger
            JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
            JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relname = 'uap_search_catalog_media'
              AND trigger.tgname = 'trg_uap_search_catalog_media_mutation_watermark'
              AND NOT trigger.tgisinternal
          )
        UNION ALL
        SELECT 'columns:case_vortex_luna_turns.tool_receipts+provider_usage',
          (SELECT count(*) = 2 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'case_vortex_luna_turns'
             AND column_name = ANY(ARRAY['tool_receipts', 'provider_usage']::text[]))
      `, [RELATION_SIGNATURES, JSON.stringify(CONTROL_PLANE_BASELINE_COLUMNS)]);
  return Object.fromEntries(signatureRows.rows.map((row) => [
    String(row.name), truthy(row.present),
  ]));
};

export const runCaseVortexRemoteRehearsalCli = async (
  argv = process.argv.slice(2),
  dependencies?: Dependencies,
) => {
  if (!dependencies) loadEnv({ quiet: true });
  const env = dependencies?.env || process.env;
  const args = parseArguments(argv);
  if (args.help) return { usage: caseVortexRemoteRehearsalUsage };

  const migrationsDir = dependencies?.migrationsDir
    || path.join(process.cwd(), 'src', 'db', 'migrations');
  const readMigration = dependencies?.readMigration || readFile;
  const blockers: string[] = [];
  const migrations = await Promise.all(CASE_VORTEX_MIGRATION_CONTRACTS.map(async (contract) => {
    const bytes = await readMigration(path.join(migrationsDir, contract.fileName));
    const actualSha256 = sha256(bytes);
    const sql = bytes.toString('utf8');
    const statements = splitSqlStatements(sql);
    const transactionMode = statements.some((statement) => /\bCONCURRENTLY\b/iu.test(statement))
      ? 'autocommit-per-statement' as const
      : 'single-transaction' as const;
    const digestMatches = actualSha256 === contract.sha256;
    if (!digestMatches) blockers.push(`local:digest_mismatch:${contract.version}`);
    return {
      ...contract,
      actualSha256,
      digestMatches,
      byteLength: bytes.byteLength,
      statementCount: statements.length,
      transactionMode,
    };
  }));

  let remote: null | {
    checked: true;
    serverVersionNum: number;
    appTrackerPresent: boolean;
    supabaseTrackerPresent: boolean;
    appLedger: string[];
    supabaseLedger: string[];
    signatures: Record<string, boolean>;
    activePublicationCount: number;
    missingVersions: string[];
    reconciliationVersions: string[];
    appliedVersions: string[];
  } = null;
  let plannedMigrations: string[] = [];

  if (!args.checkDb) {
    blockers.push('remote:not_checked');
  } else if (!String(env.DATABASE_URL || '').trim()) {
    blockers.push('remote:database_not_configured');
  } else {
    const loaded = dependencies?.query
      ? { query: dependencies.query, close: async () => {} }
      : await (dependencies?.loadQuery || (() => createDefaultReadOnlyQuery(env)))();
    try {
      const catalog = await loaded.query(`
        /* case_vortex_remote_rehearsal:catalog */
        SELECT current_setting('server_version_num')::integer AS server_version_num,
          to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
          to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase_tracker_present
      `);
      const catalogRow = catalog.rows[0] || {};
      const serverVersionNum = Number(catalogRow.server_version_num || 0);
      const appTrackerPresent = truthy(catalogRow.app_tracker_present);
      const supabaseTrackerPresent = truthy(catalogRow.supabase_tracker_present);
      if (serverVersionNum < 170000) blockers.push('remote:postgres_17_required');
      if (!appTrackerPresent) blockers.push('remote:app_migration_tracker_missing');
      if (!supabaseTrackerPresent) blockers.push('remote:supabase_migration_tracker_missing');

      const appLedger = appTrackerPresent
        ? (await loaded.query(`
            /* case_vortex_remote_rehearsal:app_ledger */
            SELECT id FROM public.schema_migrations
            WHERE substring(id FROM 1 FOR 4) >= '0202'
              AND substring(id FROM 1 FOR 4) <= '0213'
            ORDER BY id
          `)).rows.map((row) => String(row.id))
        : [];
      const supabaseLedger = supabaseTrackerPresent
        ? (await loaded.query(`
            /* case_vortex_remote_rehearsal:supabase_ledger */
            SELECT version FROM supabase_migrations.schema_migrations
            WHERE substring(version FROM 1 FOR 4) >= '0202'
              AND substring(version FROM 1 FOR 4) <= '0213'
            ORDER BY version
          `)).rows.map((row) => String(row.version))
        : [];

      const signatures = await inspectCaseVortexMigrationSignatures(loaded.query);
      const activePublication = signatures.uap_case_graph_publications
        ? await loaded.query(`
            /* case_vortex_remote_rehearsal:active_publication */
            SELECT count(*)::integer AS count
            FROM public.uap_case_graph_publications WHERE active = true
          `)
        : { rows: [{ count: 0 }] };
      const activePublicationCount = Number(activePublication.rows[0]?.count || 0);
      if (activePublicationCount !== 0) blockers.push('remote:active_publication_must_be_zero');

      const expectedApp = new Set(CASE_VORTEX_MIGRATION_CONTRACTS.map(({ fileName }) => fileName));
      const expectedSupabase = new Set(CASE_VORTEX_MIGRATION_CONTRACTS
        .map(({ fileName }) => fileName.replace(/\.sql$/u, '')));
      for (const id of appLedger) if (!expectedApp.has(id)) blockers.push(`remote:unexpected_app_ledger_entry:${id}`);
      for (const version of supabaseLedger) {
        if (!expectedSupabase.has(version)) blockers.push(`remote:unexpected_supabase_ledger_entry:${version}`);
      }

      const appSet = new Set(appLedger);
      const supabaseSet = new Set(supabaseLedger);
      const appliedVersions: string[] = [];
      const missingVersions: string[] = [];
      const reconciliationVersions: string[] = [];
      for (const contract of CASE_VORTEX_MIGRATION_CONTRACTS) {
        const appApplied = appSet.has(contract.fileName);
        const supabaseApplied = supabaseSet.has(contract.fileName.replace(/\.sql$/u, ''));
        const signatureStates = contract.signatures.map((signature) => {
          const signatureKey = signature.startsWith('relation:')
            ? signature.slice('relation:'.length)
            : signature.startsWith('index:')
              ? signature.slice('index:'.length)
              : signature;
          return signatures[signatureKey] === true;
        });
        const schemaPresent = signatureStates.every(Boolean);
        const anySchemaPresent = signatureStates.some(Boolean);
        // 0202's first concurrent statement can finish server-side after a
        // client-side timeout. In that exact state the millisecond index is
        // still valid, while the legacy index has been recreated. Replaying
        // frozen 0203 is the bounded repair: CREATE ... IF NOT EXISTS keeps the
        // millisecond index and DROP ... IF EXISTS removes only the legacy one.
        const repairableInterrupted0203 = contract.version === '0203'
          && signatures.idx_uap_sightings_case_graph_source_cursor_ms === true
          && signatures['definition:idx_uap_sightings_case_graph_source_cursor_ms'] === true
          && signatures['absence:idx_uap_sightings_case_graph_source_cursor'] === false;
        if (appApplied !== supabaseApplied) blockers.push(`remote:tracker_disagreement:${contract.version}`);
        if (appApplied && supabaseApplied) {
          if (schemaPresent) appliedVersions.push(contract.version);
          else blockers.push(`remote:ledger_schema_drift:${contract.version}`);
        } else if (!appApplied && !supabaseApplied) {
          if ((schemaPresent && contract.reapplySafeWhenSchemaPresent)
            || repairableInterrupted0203) {
            reconciliationVersions.push(contract.version);
          } else if (anySchemaPresent) {
            blockers.push(`remote:partial_schema_drift:${contract.version}`);
          } else {
            missingVersions.push(contract.version);
          }
        }
      }
      plannedMigrations = CASE_VORTEX_MIGRATION_CONTRACTS
        .filter(({ version }) => missingVersions.includes(version)
          || reconciliationVersions.includes(version))
        .map(({ fileName }) => fileName);
      remote = {
        checked: true,
        serverVersionNum,
        appTrackerPresent,
        supabaseTrackerPresent,
        appLedger,
        supabaseLedger,
        signatures,
        activePublicationCount,
        missingVersions,
        reconciliationVersions,
        appliedVersions,
      };
    } finally {
      await loaded.close();
    }
  }

  const rehearsal = {
    recordType: 'case_vortex_remote_rehearsal' as const,
    schemaVersion: 'case-vortex-remote-rehearsal-v1' as const,
    localChain: migrations,
    remote,
    plannedMigrations,
    readyForApprovedMigrationExecution: args.checkDb && blockers.length === 0,
    blockers,
    approvalBoundary: {
      migrationApplicationApproved: false as const,
      publicationApproved: false as const,
      requiredBeforeAnyRemoteMutation: 'explicit_user_approval' as const,
    },
    guarantees: {
      databaseReads: args.checkDb ? 'bounded-read-only-transactions' as const : 'none' as const,
      databaseWrites: 0 as const,
      storageReads: 0 as const,
      storageWrites: 0 as const,
      lunaCalls: 0 as const,
      publications: 0 as const,
    },
  };
  const receiptSha256 = sha256(JSON.stringify(rehearsal));
  const result = { ...rehearsal, receiptSha256 };
  if (args.strict && blockers.length) {
    throw new Error(`case_vortex_remote_rehearsal_blocked:${blockers.join(',')}`);
  }
  return result;
};

if (require.main === module) {
  runCaseVortexRemoteRehearsalCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
