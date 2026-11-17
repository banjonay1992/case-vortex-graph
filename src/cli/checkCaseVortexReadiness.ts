import { loadEnv } from '../env';
import { evaluateCaseVortexOperationalHealth } from '../caseGraph/operationalHealth';
import {
  inspectCaseVortexRetainedInfluenceMigrationSignature,
} from './buildCaseVortexRetainedInfluenceMigrationRehearsal';

type QueryResult = { rows: Array<Record<string, unknown>> };
type Query = (sql: string, params?: readonly unknown[]) => Promise<QueryResult>;

const REQUIRED_RELATIONS = [
  'uap_case_graph_publications',
  'case_graph_research_search_builds',
  'case_graph_research_search_publication_nodes',
  'case_graph_content_search_builds',
  'case_graph_claim_evidence_builds',
  'case_graph_external_correlation_completions',
  'case_vortex_workspaces',
  'case_graph_external_provider_archives',
  'uap_case_graph_runs',
  'uap_case_graph_publication_receipts',
  'uap_case_graph_incremental_plans',
  'uap_case_graph_incremental_queue',
  'case_vortex_retained_influence_builds',
  'case_vortex_retained_influence_entries',
] as const;

export const caseVortexReadinessUsage = `Usage:
  npm run case-vortex:readiness
  npm run case-vortex:readiness -- --check-db [--strict]

Reports configuration and optional read-only PostgreSQL readiness. It never
applies migrations, writes database rows, accesses R2 objects, or calls Luna.
`;

type Dependencies = {
  env: NodeJS.ProcessEnv;
  query?: Query;
  loadQuery?: () => Promise<{ query: Query; close: () => Promise<void> }>;
};

type ServingProjections = {
  researchSearchVerified: boolean;
  retainedInfluenceVerified: boolean;
  contentSearchVerified: boolean;
  claimEvidenceVerified: boolean;
  externalCorrelationsComplete: boolean;
};

type CapabilityCheck = { ready: boolean; blockers: string[] };
type MigrationState =
  | 'aligned'
  | 'missing'
  | 'tracker_disagreement'
  | 'ledger_schema_drift'
  | 'untracked_schema';
type MigrationReadiness = {
  appTrackerPresent: boolean;
  supabaseTrackerPresent: boolean;
  migrations: Record<
  '0213' | '0214' | '0215' | '0216' | '0217' | '0218' | '0219' | '0220',
  {
    appTracked: boolean;
    supabaseTracked: boolean;
    schemaPresent: boolean;
    state: MigrationState;
  }>;
};

const MIGRATION_FILES = {
  '0213': '0213_case_vortex_saved_report_replay_2026_07_22.sql',
  '0214': '0214_case_vortex_claim_analysis_tool_receipts_2026_07_23.sql',
  '0215': '0215_case_vortex_saved_claim_analyses_2026_07_23.sql',
  '0216': '0216_case_vortex_retained_influence_search_2026_07_26.sql',
  '0217': '0217_case_vortex_publication_rollback_2026_07_26.sql',
  '0218': '0218_case_vortex_saved_claim_analyses_privileges_2026_07_27.sql',
  '0219': '0219_source_governance_zero_sighting_cascade_2026_07_27.sql',
  '0220': '0220_source_governance_zero_sighting_map_queue_2026_07_27.sql',
} as const;

export const classifyCaseVortexMigrationState = (
  appTracked: boolean,
  supabaseTracked: boolean,
  schemaPresent: boolean,
): MigrationState => {
  if (appTracked !== supabaseTracked) return 'tracker_disagreement';
  if (appTracked && !schemaPresent) return 'ledger_schema_drift';
  if (!appTracked && schemaPresent) return 'untracked_schema';
  return appTracked ? 'aligned' : 'missing';
};

const migrationBlocker = (version: keyof typeof MIGRATION_FILES, state: MigrationState) => (
  state === 'aligned' ? null : state === 'missing'
    ? `database:migration_${version}_missing`
    : `database:migration_${version}_${state}`
);

export const inspectCaseVortexRollbackMigrationSignature = async (
  query: Query,
) => {
  const result = await query(`
    SELECT /* case_vortex_publication_rollback:signature */ COALESCE((
      SELECT
        procedure.prosecdef
        AND COALESCE(pg_catalog.array_to_string(procedure.proconfig, ','), '')
          LIKE '%search_path=pg_catalog, public%'
        AND pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure.oid),
          'pg_advisory_xact_lock'
        ) > 0
        AND pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure.oid),
          'v_current_count <> 1'
        ) > 0
        AND pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure.oid),
          'publication.id = p_expected_active_publication_id'
        ) > 0
        AND pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure.oid),
          'FROM public.activate_uap_case_graph_publication_v2'
        ) > 0
        AND pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure.oid),
          'rollback_of_publication_id = p_expected_active_publication_id'
        ) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )) AS privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname IN ('anon', 'authenticated')
            AND pg_catalog.has_function_privilege(
              role.oid,
              procedure.oid,
              'EXECUTE'
            )
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = 'service_role'
              AND pg_catalog.has_function_privilege(
                role.oid,
                procedure.oid,
                'EXECUTE'
              )
          )
        )
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = pg_catalog.to_regprocedure(
        'public.rollback_uap_case_graph_publication_v1(uuid,uuid,text,text,text)'
      )
    ), false)
    AND COALESCE((
      SELECT pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'NEW.rollback_of_publication_id IS DISTINCT FROM OLD.rollback_of_publication_id'
      ) > 0
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = pg_catalog.to_regprocedure(
        'public.uap_case_graph_publication_activation_guard()'
      )
    ), false) AS present
  `);
  return result.rows[0]?.present === true;
};

export const CASE_VORTEX_SERVING_PROJECTIONS_SQL = `
  SELECT
    EXISTS (
      SELECT 1 FROM public.case_graph_research_search_builds AS build
      JOIN public.uap_case_graph_publications AS publication ON publication.id = build.publication_id
      WHERE publication.active = true AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_record_count = build.expected_record_count
    ) AS research_search_verified,
    EXISTS (
      SELECT 1
      FROM public.case_vortex_retained_influence_builds AS build
      JOIN public.uap_case_graph_publications AS publication
        ON publication.id = build.publication_id
      WHERE publication.active = true
        AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_discovery_signal_count = (
          SELECT COALESCE(sum((entry ->> 'rowCount')::bigint), 0)
          FROM jsonb_array_elements(build.source_manifest) AS entry
          WHERE entry ->> 'lane' = 'discovery_signal'
        )
        AND build.indexed_metadata_lead_count = (
          SELECT COALESCE(sum((entry ->> 'rowCount')::bigint), 0)
          FROM jsonb_array_elements(build.source_manifest) AS entry
          WHERE entry ->> 'lane' = 'metadata_lead'
        )
    ) AS retained_influence_verified,
    EXISTS (
      SELECT 1 FROM public.case_graph_content_search_builds AS build
      JOIN public.uap_case_graph_publications AS publication ON publication.id = build.publication_id
      WHERE publication.active = true AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_entry_count = build.expected_entry_count
        AND build.indexed_shard_count = build.expected_shard_count
    ) AS content_search_verified,
    EXISTS (
      SELECT 1 FROM public.case_graph_claim_evidence_builds AS build
      JOIN public.uap_case_graph_publications AS publication ON publication.id = build.publication_id
      WHERE publication.active = true AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_claim_count = build.expected_claim_count
        AND build.indexed_link_count = build.expected_link_count
        AND build.indexed_assessment_count = build.expected_assessment_count
    ) AS claim_evidence_verified,
    EXISTS (
      SELECT 1 FROM public.case_graph_external_correlation_completions AS completion
      JOIN public.uap_case_graph_publications AS publication ON publication.id = completion.publication_id
      WHERE publication.active = true
        AND completion.manifest_sha256 = publication.public_manifest_sha256
        AND jsonb_array_length(completion.category_set) = 9
        AND completion.category_set ?& ARRAY[
          'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
          'military_exercise', 'launch', 'maritime', 'weather'
        ]::text[]
    ) AS external_correlations_complete
`;

const capability = (...checks: Array<[ready: boolean, blocker: string]>): CapabilityCheck => ({
  ready: checks.every(([ready]) => ready),
  blockers: checks.filter(([ready]) => !ready).map(([, blocker]) => blocker),
});

const evaluateCapabilities = (input: {
  configuration: { r2Storage: boolean; researchCursorSecret: boolean; lunaApiKey: boolean };
  database: null | {
    relations: Record<string, boolean>;
    savedReportReplayColumns: boolean;
    claimAnalysisToolReceiptSupported: boolean;
    claimAnalysisPersistenceAvailable: boolean;
    claimAnalysisPrivilegeRepairAvailable: boolean;
    migrationReadiness: MigrationReadiness;
    verifiedV2ActivePublicationCount: number;
    servingProjections: ServingProjections | null;
  };
}) => {
  const databaseChecked = input.database !== null;
  const publicationReady = input.database?.verifiedV2ActivePublicationCount === 1;
  const relation = (name: string): [boolean, string] => [
    input.database?.relations[name] === true,
    `database:missing_relation:${name}`,
  ];
  const projection = (name: keyof ServingProjections): [boolean, string] => [
    input.database?.servingProjections?.[name] === true,
    `database:serving_projection:${name}`,
  ];
  const base: Array<[boolean, string]> = [
    [databaseChecked, 'database:not_checked'],
    [publicationReady, 'publication:verified_v2_not_active'],
    [
      input.database?.migrationReadiness.migrations['0216'].state === 'aligned',
      migrationBlocker(
        '0216',
        input.database?.migrationReadiness.migrations['0216'].state || 'missing',
      ) || 'database:migration_0216_missing',
    ],
    projection('retainedInfluenceVerified'),
    [
      input.database?.migrationReadiness.migrations['0217'].state === 'aligned',
      migrationBlocker(
        '0217',
        input.database?.migrationReadiness.migrations['0217'].state || 'missing',
      ) || 'database:migration_0217_missing',
    ],
    [
      input.database?.migrationReadiness.migrations['0219'].state === 'aligned',
      migrationBlocker(
        '0219',
        input.database?.migrationReadiness.migrations['0219'].state || 'missing',
      ) || 'database:migration_0219_missing',
    ],
    [
      input.database?.migrationReadiness.migrations['0220'].state === 'aligned',
      migrationBlocker(
        '0220',
        input.database?.migrationReadiness.migrations['0220'].state || 'missing',
      ) || 'database:migration_0220_missing',
    ],
  ];
  const workspace: Array<[boolean, string]> = [
    relation('case_vortex_workspaces'),
    [input.database?.savedReportReplayColumns === true, 'database:migration_0213_missing'],
  ];
  const durableClaimAnalysis: Array<[boolean, string]> = [
    [
      input.database?.claimAnalysisToolReceiptSupported === true,
      migrationBlocker('0214', input.database?.migrationReadiness.migrations['0214'].state || 'missing')
        || 'database:migration_0214_missing',
    ],
    [
      input.database?.claimAnalysisPersistenceAvailable === true,
      migrationBlocker('0215', input.database?.migrationReadiness.migrations['0215'].state || 'missing')
        || 'database:migration_0215_missing',
    ],
    [
      input.database?.claimAnalysisPrivilegeRepairAvailable === true,
      migrationBlocker('0218', input.database?.migrationReadiness.migrations['0218'].state || 'missing')
        || 'database:migration_0218_missing',
    ],
  ];

  return {
    claimEvidenceGraph: capability(...base, relation('case_graph_claim_evidence_builds'), projection('claimEvidenceVerified')),
    sourceReliabilityLedger: capability(...base, relation('case_graph_claim_evidence_builds'), projection('claimEvidenceVerified')),
    claimCounterclaimAnalysis: capability(
      ...base,
      ...durableClaimAnalysis,
      relation('case_graph_claim_evidence_builds'),
      projection('claimEvidenceVerified'),
    ),
    similarCaseDiscovery: capability(...base, relation('case_graph_research_search_builds'), projection('researchSearchVerified')),
    investigationWorkspaces: capability(...base, ...workspace, ...durableClaimAnalysis),
    externalCorrelations: capability(...base, relation('case_graph_external_correlation_completions'), projection('externalCorrelationsComplete')),
    preciseSourceCitations: capability(...base, relation('case_graph_content_search_builds'), projection('contentSearchVerified')),
    interactiveEvidenceOrb: capability(...base, relation('case_graph_research_search_publication_nodes'), projection('researchSearchVerified')),
    livingCaseDossiers: capability(...base, ...workspace, projection('claimEvidenceVerified')),
    reproducibleResearchReports: capability(
      ...base,
      ...workspace,
      ...durableClaimAnalysis,
      projection('researchSearchVerified'),
      projection('contentSearchVerified'),
      projection('claimEvidenceVerified'),
      projection('externalCorrelationsComplete'),
    ),
    lunaResearchAgent: capability(
      ...base,
      ...durableClaimAnalysis,
      [input.configuration.r2Storage, 'configuration:r2Storage'],
      [input.configuration.researchCursorSecret, 'configuration:researchCursorSecret'],
      [input.configuration.lunaApiKey, 'configuration:lunaApiKey'],
      projection('researchSearchVerified'),
      projection('contentSearchVerified'),
      projection('claimEvidenceVerified'),
      projection('externalCorrelationsComplete'),
    ),
  } as const;
};

const configured = (value: string | undefined) => Boolean(String(value || '').trim());

const parseArguments = (argv: string[]) => {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true as const };
  let checkDb = false;
  let strict = false;
  for (const argument of argv) {
    if (argument === '--check-db') checkDb = true;
    else if (argument === '--strict') strict = true;
    else throw new Error(`case_vortex_readiness_argument_invalid:${argument}`);
  }
  return { help: false as const, checkDb, strict };
};

const defaultLoadQuery = async () => {
  const db = await import('../db');
  return {
    query: async (sql: string, params: readonly unknown[] = []) => {
      const result = await db.queryWithOptions(sql, [...params], {
        statementTimeoutMs: 10_000,
        queryTimeoutMs: 12_000,
      });
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    close: db.closePool,
  };
};

export const runCaseVortexReadinessCli = async (
  argv = process.argv.slice(2),
  dependencies?: Dependencies,
) => {
  if (!dependencies) loadEnv({ quiet: true });
  const resolvedDependencies = dependencies || { env: process.env, loadQuery: defaultLoadQuery };
  const args = parseArguments(argv);
  if (args.help) return { usage: caseVortexReadinessUsage };
  const env = resolvedDependencies.env;
  const configuration = {
    databaseUrl: configured(env.DATABASE_URL),
    r2Storage: ['STORAGE_BUCKET', 'STORAGE_ENDPOINT', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']
      .every((key) => configured(env[key])),
    researchCursorSecret: String(env.CASE_VORTEX_RESEARCH_CURSOR_SECRET || '').trim().length >= 32,
    lunaApiKey: configured(env.CASE_VORTEX_LUNA_OPENAI_API_KEY) || configured(env.OPENAI_API_KEY),
  };
  const blockers: string[] = [];
  for (const [name, ready] of Object.entries(configuration)) {
    if (!ready) blockers.push(`configuration:${name}`);
  }

  let database: null | {
    checked: true;
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
    migrationReadiness: MigrationReadiness;
    activePublicationCount: number;
    verifiedV2ActivePublicationCount: number;
    servingProjections: ServingProjections | null;
    incremental: null | {
      latestWatermarkSequence: number;
      queuedJobs: number;
      leasedJobs: number;
      failedJobs: number;
      expiredLeases: number;
    };
  } = null;
  let close: () => Promise<void> = async () => {};
  if (args.checkDb) {
    if (!configuration.databaseUrl) {
      blockers.push('database:not_configured');
    } else {
      const loaded = resolvedDependencies.query
        ? { query: resolvedDependencies.query, close }
        : await (resolvedDependencies.loadQuery || defaultLoadQuery)();
      close = loaded.close;
      try {
        const catalog = await loaded.query(`
          SELECT current_setting('server_version_num')::integer AS server_version_num,
            name, to_regclass('public.' || name) IS NOT NULL AS present,
            to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
            to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase_tracker_present
          FROM unnest($1::text[]) AS name ORDER BY name
        `, [REQUIRED_RELATIONS]);
        const relations = Object.fromEntries(catalog.rows.map((row) => [String(row.name), row.present === true]));
        const serverVersionNum = Number(catalog.rows[0]?.server_version_num || 0);
        const appTrackerPresent = catalog.rows[0]?.app_tracker_present === true;
        const supabaseTrackerPresent = catalog.rows[0]?.supabase_tracker_present === true;
        const appLedger = appTrackerPresent
          ? (await loaded.query(`
              SELECT id FROM public.schema_migrations
              WHERE substring(id FROM 1 FOR 4) BETWEEN '0213' AND '0220'
              ORDER BY id
            `)).rows.map((row) => String(row.id))
          : [];
        const supabaseLedger = supabaseTrackerPresent
          ? (await loaded.query(`
              SELECT version FROM supabase_migrations.schema_migrations
              WHERE substring(version FROM 1 FOR 4) BETWEEN '0213' AND '0220'
              ORDER BY version
            `)).rows.map((row) => String(row.version))
          : [];
        const replaySchema = relations.case_vortex_workspaces
          ? await loaded.query(`
              SELECT
                (count(*) FILTER (
                  WHERE column_name IN ('tool_receipts', 'provider_usage')
                ) = 2) AS saved_report_replay_columns,
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'case_vortex_luna_turns'
                    AND column_name = 'claim_analyses' AND data_type = 'jsonb'
                    AND is_nullable = 'NO'
                ) AS claim_analysis_column_exact,
                EXISTS (
                  SELECT 1 FROM pg_catalog.pg_constraint AS constraint_record
                  JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
                  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                  WHERE namespace.nspname = 'public'
                    AND relation.relname = 'case_vortex_luna_turns'
                    AND constraint_record.conname = 'case_vortex_luna_turns_claim_analyses_shape'
                    AND constraint_record.convalidated
                ) AS claim_analysis_constraint,
                to_regprocedure(
                  'public.save_case_vortex_luna_turn(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,varchar,uuid,varchar)'
                ) IS NOT NULL AS claim_analysis_save_function,
                COALESCE((
                  SELECT count(*) = 1
                  FROM pg_catalog.pg_proc AS procedure
                  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
                  WHERE namespace.nspname = 'public'
                    AND procedure.oid = to_regprocedure(
                      'public.save_case_vortex_luna_turn(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,varchar,uuid,varchar)'
                    )
                    AND NOT pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
                    AND NOT pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
                    AND pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
                ), false) AS claim_analysis_save_privileges,
                COALESCE(
                  strpos(
                    pg_get_functiondef(to_regprocedure(
                      'public.save_case_vortex_luna_turn(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,varchar,uuid,varchar)'
                    )),
                    quote_literal('analyze_case_claims')
                  ) > 0,
                  false
                ) AS claim_analysis_tool_receipt_supported
                ,
                COALESCE((
                  SELECT
                    strpos(
                      pg_get_functiondef(procedure.oid),
                      'uap_source_governance_zero_sighting_guard:v1'
                    ) > 0
                    AND strpos(
                      pg_get_functiondef(procedure.oid),
                      'uap_sightings_recompute_is_publishable_mappable_by_sources'
                    ) > 0
                    AND NOT EXISTS (
                      SELECT 1
                      FROM pg_catalog.aclexplode(COALESCE(
                        procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner)
                      )) AS privilege
                      WHERE privilege.grantee = 0
                        AND privilege.privilege_type = 'EXECUTE'
                    )
                  FROM pg_catalog.pg_proc AS procedure
                  WHERE procedure.oid = to_regprocedure(
                    'public.uap_source_legal_registry_cascade_is_publishable_mappable()'
                  )
                ), false) AS source_governance_zero_sighting_guard,
                COALESCE((
                  SELECT
                    procedure.prosecdef
                    AND strpos(
                      pg_get_functiondef(procedure.oid),
                      'uap_source_governance_zero_sighting_map_queue_guard:v1'
                    ) > 0
                    AND strpos(
                      pg_get_functiondef(procedure.oid),
                      'uap_map_invalidate_coordinate_reuse'
                    ) > 0
                    AND NOT EXISTS (
                      SELECT 1
                      FROM pg_catalog.aclexplode(COALESCE(
                        procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner)
                      )) AS privilege
                      WHERE privilege.grantee = 0
                        AND privilege.privilege_type = 'EXECUTE'
                    )
                  FROM pg_catalog.pg_proc AS procedure
                  WHERE procedure.oid = to_regprocedure(
                    'public.uap_sighting_map_projection_enqueue_governance_source()'
                  )
                ), false) AS source_governance_zero_sighting_map_queue_guard
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'case_vortex_luna_turns'
                AND column_name IN ('tool_receipts', 'provider_usage', 'claim_analyses')
            `)
          : { rows: [{
              saved_report_replay_columns: false,
              claim_analysis_column_exact: false,
              claim_analysis_constraint: false,
              claim_analysis_save_function: false,
              claim_analysis_save_privileges: false,
              claim_analysis_tool_receipt_supported: false,
              source_governance_zero_sighting_guard: false,
              source_governance_zero_sighting_map_queue_guard: false,
            }] };
        const active = relations.uap_case_graph_publications
          ? relations.uap_case_graph_runs && relations.uap_case_graph_publication_receipts
            ? await loaded.query(`
              SELECT
                count(*)::integer AS count,
                count(*) FILTER (
                  WHERE run.lineage_version = 'case-vortex-lineage-v2'
                    AND run.status = 'completed'
                    AND run.snapshot_id IS NOT NULL
                    AND publication.activated_at IS NOT NULL
                    AND receipt.receipt_version = 'case-vortex-publication-receipt-v2'
                    AND receipt.snapshot_id = run.snapshot_id
                    AND receipt.public_manifest_sha256 = publication.public_manifest_sha256
                    AND receipt.completion_manifest_sha256 = run.completion_manifest_sha256
                    AND receipt.corpus_accounting_digest = run.corpus_accounting_digest
                    AND receipt.graph_artifact_set_sha256 = run.graph_artifact_set_sha256
                )::integer AS verified_v2_count
              FROM public.uap_case_graph_publications AS publication
              LEFT JOIN public.uap_case_graph_runs AS run
                ON run.id = publication.run_id
              LEFT JOIN public.uap_case_graph_publication_receipts AS receipt
                ON receipt.publication_id = publication.id
              WHERE publication.active = true
            `)
            : await loaded.query(`
                SELECT count(*)::integer AS count, 0::integer AS verified_v2_count
                FROM public.uap_case_graph_publications WHERE active = true
              `)
          : { rows: [{ count: 0, verified_v2_count: 0 }] };
        const incremental = relations.uap_case_graph_incremental_plans && relations.uap_case_graph_incremental_queue
          ? await loaded.query(`
              SELECT
                COALESCE(max(plan.watermark_sequence), 0)::integer AS latest_watermark_sequence,
                count(*) FILTER (WHERE queue.status = 'queued')::integer AS queued_jobs,
                count(*) FILTER (WHERE queue.status = 'leased')::integer AS leased_jobs,
                count(*) FILTER (WHERE queue.status = 'failed')::integer AS failed_jobs,
                count(*) FILTER (
                  WHERE queue.status = 'leased' AND queue.leased_until < clock_timestamp()
                )::integer AS expired_leases
              FROM public.uap_case_graph_incremental_plans AS plan
              LEFT JOIN public.uap_case_graph_incremental_queue AS queue ON queue.plan_id = plan.plan_id
            `)
          : null;
        const canCheckServingProjections = [
          'case_graph_research_search_builds',
          'case_graph_content_search_builds',
          'case_graph_claim_evidence_builds',
          'case_graph_external_correlation_completions',
          'case_vortex_retained_influence_builds',
          'uap_case_graph_publications',
        ].every((name) => relations[name]);
        const servingProjectionResult = canCheckServingProjections
          && Number(active.rows[0]?.count || 0) === 1
          && Number(active.rows[0]?.verified_v2_count || 0) === 1
          ? await loaded.query(CASE_VORTEX_SERVING_PROJECTIONS_SQL)
          : null;
        const servingProjectionRow = servingProjectionResult?.rows[0];
        const servingProjections = servingProjectionRow ? {
          researchSearchVerified: servingProjectionRow.research_search_verified === true,
          contentSearchVerified: servingProjectionRow.content_search_verified === true,
          claimEvidenceVerified: servingProjectionRow.claim_evidence_verified === true,
          externalCorrelationsComplete: servingProjectionRow.external_correlations_complete === true,
          retainedInfluenceVerified: servingProjectionRow.retained_influence_verified === true,
        } : null;
        const replaySchemaRow = replaySchema.rows[0] || {};
        const retainedInfluenceSchemaPresent =
          relations.case_vortex_retained_influence_builds
          && relations.case_vortex_retained_influence_entries
          ? await inspectCaseVortexRetainedInfluenceMigrationSignature(loaded.query)
          : false;
        const rollbackSchemaPresent = appTrackerPresent || supabaseTrackerPresent
          ? await inspectCaseVortexRollbackMigrationSignature(loaded.query)
          : false;
        const schemaPresence = {
          '0213': replaySchemaRow.saved_report_replay_columns === true,
          '0214': replaySchemaRow.claim_analysis_tool_receipt_supported === true,
          '0215': replaySchemaRow.claim_analysis_column_exact === true
            && replaySchemaRow.claim_analysis_constraint === true
            && replaySchemaRow.claim_analysis_save_function === true,
          '0216': retainedInfluenceSchemaPresent,
          '0217': rollbackSchemaPresent,
          '0218': replaySchemaRow.claim_analysis_save_function === true
            && replaySchemaRow.claim_analysis_save_privileges === true,
          '0219': replaySchemaRow.source_governance_zero_sighting_guard === true,
          '0220': replaySchemaRow.source_governance_zero_sighting_map_queue_guard === true,
        };
        const appSet = new Set(appLedger);
        const supabaseSet = new Set(supabaseLedger);
        const migrationReadiness: MigrationReadiness = {
          appTrackerPresent,
          supabaseTrackerPresent,
          migrations: Object.fromEntries(Object.entries(MIGRATION_FILES).map(([version, fileName]) => {
            const appTracked = appSet.has(fileName);
            const supabaseTracked = supabaseSet.has(fileName.replace(/\.sql$/u, ''));
            const schemaPresent = schemaPresence[version as keyof typeof MIGRATION_FILES];
            return [version, {
              appTracked,
              supabaseTracked,
              schemaPresent,
              state: classifyCaseVortexMigrationState(appTracked, supabaseTracked, schemaPresent),
            }];
          })) as MigrationReadiness['migrations'],
        };
        database = {
          checked: true,
          serverVersionNum,
          relations,
          savedReportReplayColumns: migrationReadiness.migrations['0213'].state === 'aligned',
          claimAnalysisToolReceiptSupported: migrationReadiness.migrations['0214'].state === 'aligned',
          claimAnalysisPersistenceAvailable: migrationReadiness.migrations['0215'].state === 'aligned',
          claimAnalysisPrivilegeRepairAvailable:
            migrationReadiness.migrations['0218'].state === 'aligned',
          retainedInfluenceMigrationAvailable:
            migrationReadiness.migrations['0216'].state === 'aligned',
          publicationRollbackAvailable:
            migrationReadiness.migrations['0217'].state === 'aligned',
          sourceGovernanceCascadeRepairAvailable:
            migrationReadiness.migrations['0219'].state === 'aligned',
          sourceGovernanceMapQueueRepairAvailable:
            migrationReadiness.migrations['0220'].state === 'aligned',
          migrationReadiness,
          activePublicationCount: Number(active.rows[0]?.count || 0),
          verifiedV2ActivePublicationCount: Number(active.rows[0]?.verified_v2_count || 0),
          servingProjections,
          incremental: incremental ? {
            latestWatermarkSequence: Number(incremental.rows[0]?.latest_watermark_sequence || 0),
            queuedJobs: Number(incremental.rows[0]?.queued_jobs || 0),
            leasedJobs: Number(incremental.rows[0]?.leased_jobs || 0),
            failedJobs: Number(incremental.rows[0]?.failed_jobs || 0),
            expiredLeases: Number(incremental.rows[0]?.expired_leases || 0),
          } : null,
        };
        if (serverVersionNum < 170000) blockers.push('database:postgres_17_required');
        for (const name of REQUIRED_RELATIONS) if (!relations[name]) blockers.push(`database:missing_relation:${name}`);
        for (const version of Object.keys(MIGRATION_FILES) as Array<keyof typeof MIGRATION_FILES>) {
          const blocker = migrationBlocker(version, database.migrationReadiness.migrations[version].state);
          if (blocker) blockers.push(blocker);
        }
        if (database.activePublicationCount !== 1) blockers.push('database:active_publication_count');
        if (database.activePublicationCount === 1 && database.verifiedV2ActivePublicationCount !== 1) {
          blockers.push('database:active_publication_v2_unverified');
        }
        if (database.activePublicationCount === 1 && database.verifiedV2ActivePublicationCount === 1) {
          if (!database.servingProjections) blockers.push('database:serving_projections_unverified');
          else for (const [name, ready] of Object.entries(database.servingProjections)) {
            if (!ready) blockers.push(`database:serving_projection:${name}`);
          }
        }
        if (database.incremental?.failedJobs) blockers.push('database:incremental_failed_jobs');
        if (database.incremental?.expiredLeases) blockers.push('database:incremental_expired_leases');
      } finally {
        await close();
      }
    }
  }

  const operations = evaluateCaseVortexOperationalHealth({ configuration, database });
  const capabilities = evaluateCapabilities({ configuration, database });
  const guardedMigrationBlockers = !args.checkDb
    ? ['database:not_checked']
    : database === null
      ? ['database:not_configured']
      : [
        ...(database.serverVersionNum >= 170000 ? [] : ['database:postgres_17_required']),
        ...Object.entries(database.relations)
          .filter(([, present]) => !present)
          .map(([name]) => `database:missing_relation:${name}`),
        ...Object.entries(database.migrationReadiness.migrations)
          .flatMap(([version, migration]) => {
            const blocker = migrationBlocker(
              version as keyof typeof MIGRATION_FILES,
              migration.state,
            );
            return blocker ? [blocker] : [];
          }),
      ];
  const result = {
    recordType: 'case_vortex_operational_readiness' as const,
    schemaVersion: 'case-vortex-operational-readiness-v7' as const,
    configuration,
    database,
    guardedMigrationPrerequisitesReady:
      args.checkDb && guardedMigrationBlockers.length === 0,
    guardedMigrationBlockers,
    readyForAuthoritativeBuild: args.checkDb && blockers.length === 0,
    blockers,
    capabilities,
    operations,
    guarantees: { databaseWrites: 0 as const, storageReads: 0 as const, storageWrites: 0 as const, lunaCalls: 0 as const },
  };
  if (args.strict && blockers.length) throw new Error(`case_vortex_readiness_blocked:${blockers.join(',')}`);
  return result;
};

if (require.main === module) {
  runCaseVortexReadinessCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
