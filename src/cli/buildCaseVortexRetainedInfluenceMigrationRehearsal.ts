import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeRetainedInfluenceServingBundle,
} from '../caseGraph/retainedInfluenceServing';
import {
  retainedInfluencePostgresSourceManifest,
} from '../caseGraph/postgresRetainedInfluence';
import {
  createBoundedReadOnlyPostgres,
  type BoundedReadOnlyPostgres,
} from '../db/boundedReadOnlyPostgres';
import { splitSqlStatements } from '../db/sqlStatementSplitter';
import { loadEnv } from '../env';
import { resolveCaseVortexRehearsalDatabaseConfig } from './buildCaseVortexRemoteRehearsal';

type QueryResult = { rows: Array<Record<string, unknown>> };
type Query = (sql: string, params?: readonly unknown[]) => Promise<QueryResult>;

export const CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT = {
  version: '0216',
  fileName: '0216_case_vortex_retained_influence_search_2026_07_26.sql',
  sha256: '2a69389068ad91ee8025ef2acd560c3280cd6d2f977be2ceac831d6eab6a888e',
  signature: 'retained_influence:builds_entries_functions_index_rls',
} as const;

const BASE_MIGRATION = {
  version: '0215',
  fileName: '0215_case_vortex_saved_claim_analyses_2026_07_23.sql',
} as const;

export const caseVortexRetainedInfluenceMigrationRehearsalUsage = `Usage:
  npm run case-vortex:retained-influence-migration-rehearsal -- \\
    --bundle <canonical-serving-bundle.json> [--check-db] [--strict]

Builds a deterministic rehearsal for frozen migration 0216 only. Database
inspection is bounded and read-only. It requires aligned migration 0215,
PostgreSQL 17, zero active publications, exact retained-source counts and no
partial 0216 schema. It never applies SQL, builds the index, writes R2, calls
Luna, activates a publication or deploys.
`;

type Dependencies = {
  env: NodeJS.ProcessEnv;
  migrationsDir?: string;
  readFileBytes?: (filePath: string) => Promise<Buffer>;
  query?: Query;
  loadQuery?: () => Promise<{ query: Query; close: () => Promise<void> }>;
};

const truthy = (value: unknown) => value === true || value === 't';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const stem = (fileName: string) => fileName.replace(/\.sql$/u, '');

const parseArguments = (argv: string[]) => {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true as const };
  let bundlePath = '';
  let checkDb = false;
  let strict = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check-db') checkDb = true;
    else if (argument === '--strict') strict = true;
    else if (argument === '--bundle' && argv[index + 1] && !argv[index + 1].startsWith('-')) {
      bundlePath = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`case_vortex_retained_influence_migration_rehearsal_argument_invalid:${argument}`);
    }
  }
  if (!bundlePath) {
    throw new Error('case_vortex_retained_influence_migration_rehearsal_bundle_required');
  }
  return { help: false as const, bundlePath, checkDb, strict };
};

const createDefaultReadOnlyQuery = async (env: NodeJS.ProcessEnv) => {
  if (!String(env.DATABASE_URL || '').trim()) {
    throw new Error('case_vortex_retained_influence_migration_rehearsal_database_url_missing');
  }
  const databaseConfig = resolveCaseVortexRehearsalDatabaseConfig(env);
  const adapter: BoundedReadOnlyPostgres = createBoundedReadOnlyPostgres({
    workerPoolConfig: { ...databaseConfig, max: 1 },
    controlClientConfig: databaseConfig,
    limits: {
      maxConcurrent: 1,
      maxQueued: 1,
      acquireTimeoutMs: 8_000,
      setupTimeoutMs: 5_000,
      rollbackTimeoutMs: 5_000,
      cancelConnectTimeoutMs: 3_000,
      cancelQueryTimeoutMs: 3_000,
      cancelEndTimeoutMs: 3_000,
      cancelSettleTimeoutMs: 5_000,
    },
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

export const inspectCaseVortexRetainedInfluenceMigrationSignature = async (
  query: Query,
) => {
  const result = await query(`
    /* case_vortex_retained_influence_migration_rehearsal:signature */
    SELECT (
      to_regclass('public.case_vortex_retained_influence_builds') IS NOT NULL
      AND to_regclass('public.case_vortex_retained_influence_entries') IS NOT NULL
      AND to_regprocedure(
        'public.build_case_vortex_retained_influence_index(uuid,text,text,text,text,jsonb)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.search_case_vortex_retained_influence(uuid,text,text,text,text[],text[],timestamp with time zone,timestamp with time zone,integer)'
      ) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'case_vortex_retained_influence_builds'
          AND relation.relrowsecurity
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'case_vortex_retained_influence_entries'
          AND relation.relrowsecurity
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index AS index_record
        JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
        WHERE index_relation.relname = 'case_vortex_retained_influence_search_vector_gin_idx'
          AND index_record.indisvalid AND index_record.indisready AND index_record.indislive
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgname = 'case_vortex_retained_influence_builds_immutable'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgname = 'case_vortex_retained_influence_entries_immutable'
          AND NOT tgisinternal
      )
    ) AS present
  `);
  return truthy(result.rows[0]?.present);
};

export const runCaseVortexRetainedInfluenceMigrationRehearsalCli = async (
  argv = process.argv.slice(2),
  dependencies?: Dependencies,
) => {
  if (!dependencies) loadEnv({ quiet: true });
  const env = dependencies?.env || process.env;
  const args = parseArguments(argv);
  if (args.help) return { usage: caseVortexRetainedInfluenceMigrationRehearsalUsage };
  const read = dependencies?.readFileBytes || readFile;
  const migrationsDir = dependencies?.migrationsDir
    || path.join(process.cwd(), 'src', 'db', 'migrations');
  const [migrationBytes, bundleBytes] = await Promise.all([
    read(path.join(migrationsDir, CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT.fileName)),
    read(args.bundlePath),
  ]);
  const bundle = decodeRetainedInfluenceServingBundle(bundleBytes);
  const sourceManifest = retainedInfluencePostgresSourceManifest(bundle.influenceReceipt);
  const blockers: string[] = [];
  const actualSha256 = sha256(migrationBytes);
  const digestMatches = actualSha256
    === CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT.sha256;
  if (!digestMatches) blockers.push('local:digest_mismatch:0216');
  const localMigration = {
    ...CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT,
    actualSha256,
    digestMatches,
    byteLength: migrationBytes.byteLength,
    statementCount: splitSqlStatements(migrationBytes.toString('utf8')).length,
    transactionMode: 'single-transaction' as const,
  };

  let remote: null | {
    checked: true;
    serverVersionNum: number;
    appTrackerPresent: boolean;
    supabaseTrackerPresent: boolean;
    baseMigrationPresent: boolean;
    appLedger: string[];
    supabaseLedger: string[];
    migrationSignaturePresent: boolean;
    activePublicationCount: number;
    sourceProjectionReady: boolean;
    discoverySignalCount: number;
    metadataLeadCount: number;
  } = null;

  if (!args.checkDb) {
    blockers.push('remote:not_checked');
  } else if (!String(env.DATABASE_URL || '').trim() && !dependencies?.query) {
    blockers.push('remote:database_not_configured');
  } else {
    const loaded = dependencies?.query
      ? { query: dependencies.query, close: async () => {} }
      : await (dependencies?.loadQuery || (() => createDefaultReadOnlyQuery(env)))();
    try {
      const catalog = await loaded.query(`
        /* case_vortex_retained_influence_migration_rehearsal:catalog */
        SELECT current_setting('server_version_num')::integer AS server_version_num,
          to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
          to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase_tracker_present,
          to_regclass('public.uap_case_graph_publications') IS NOT NULL AS publications_present,
          to_regclass('public.uap_sightings') IS NOT NULL AS sightings_present,
          to_regclass('public.uap_sightings_source_stats') IS NOT NULL AS source_stats_present,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'uap_sightings'
              AND column_name = 'search_tsv' AND data_type = 'tsvector'
          ) AS search_tsv_present
      `);
      const row = catalog.rows[0] || {};
      const serverVersionNum = Number(row.server_version_num || 0);
      const appTrackerPresent = truthy(row.app_tracker_present);
      const supabaseTrackerPresent = truthy(row.supabase_tracker_present);
      const publicationsPresent = truthy(row.publications_present);
      const sightingsPresent = truthy(row.sightings_present);
      const sourceStatsPresent = truthy(row.source_stats_present);
      const searchTsvPresent = truthy(row.search_tsv_present);
      if (serverVersionNum < 170000) blockers.push('remote:postgres_17_required');
      if (!appTrackerPresent) blockers.push('remote:app_migration_tracker_missing');
      if (!supabaseTrackerPresent) blockers.push('remote:supabase_migration_tracker_missing');
      if (!publicationsPresent) blockers.push('remote:publications_relation_missing');
      if (!sightingsPresent) blockers.push('remote:sightings_relation_missing');
      if (!sourceStatsPresent) blockers.push('remote:source_stats_relation_missing');
      if (!searchTsvPresent) blockers.push('remote:search_tsv_missing');

      const appLedger = appTrackerPresent
        ? (await loaded.query(`
            /* case_vortex_retained_influence_migration_rehearsal:app_ledger */
            SELECT id FROM public.schema_migrations
            WHERE substring(id FROM 1 FOR 4) BETWEEN '0215' AND '0216'
            ORDER BY id
          `)).rows.map((entry) => String(entry.id))
        : [];
      const supabaseLedger = supabaseTrackerPresent
        ? (await loaded.query(`
            /* case_vortex_retained_influence_migration_rehearsal:supabase_ledger */
            SELECT version FROM supabase_migrations.schema_migrations
            WHERE substring(version FROM 1 FOR 4) BETWEEN '0215' AND '0216'
            ORDER BY version
          `)).rows.map((entry) => String(entry.version))
        : [];
      const baseApp = appLedger.includes(BASE_MIGRATION.fileName);
      const baseSupabase = supabaseLedger.includes(stem(BASE_MIGRATION.fileName));
      const baseMigrationPresent = baseApp && baseSupabase;
      if (baseApp !== baseSupabase) blockers.push('remote:base_tracker_disagreement:0215');
      else if (!baseMigrationPresent) blockers.push('remote:base_migration_0215_missing');

      const appApplied = appLedger.includes(
        CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT.fileName,
      );
      const supabaseApplied = supabaseLedger.includes(stem(
        CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT.fileName,
      ));
      const migrationSignaturePresent =
        await inspectCaseVortexRetainedInfluenceMigrationSignature(loaded.query);
      if (appApplied !== supabaseApplied) blockers.push('remote:tracker_disagreement:0216');
      else if (appApplied && !migrationSignaturePresent) blockers.push('remote:ledger_schema_drift:0216');
      else if (!appApplied && migrationSignaturePresent) blockers.push('remote:untracked_schema:0216');
      else if (appApplied) blockers.push('remote:migration_0216_already_applied');

      const activePublicationCount = publicationsPresent
        ? Number((await loaded.query(`
            /* case_vortex_retained_influence_migration_rehearsal:active_publication */
            SELECT count(*)::integer AS count
            FROM public.uap_case_graph_publications WHERE active = true
          `)).rows[0]?.count || 0)
        : 0;
      if (activePublicationCount !== 0) blockers.push('remote:active_publication_must_be_zero');

      const sourceRows = sourceStatsPresent
        ? (await loaded.query(`
            /* case_vortex_retained_influence_migration_rehearsal:source_counts */
            SELECT upper(trim(source)) AS source, total::bigint AS row_count
            FROM public.uap_sightings_source_stats
            WHERE upper(trim(source)) = ANY($1::text[])
            ORDER BY upper(trim(source))
          `, [sourceManifest.map(({ source }) => source)])).rows
        : [];
      const actualCounts = new Map(sourceRows.map((entry) => [
        String(entry.source),
        Number(entry.row_count),
      ]));
      const sourceProjectionReady = sourceManifest.every(({ source, rowCount }) => (
        actualCounts.get(source) === rowCount
      )) && actualCounts.size === sourceManifest.length;
      if (!sourceProjectionReady) blockers.push('remote:retained_source_counts_drift');
      const discoverySignalCount = sourceManifest
        .filter(({ lane }) => lane === 'discovery_signal')
        .reduce((sum, source) => sum + (actualCounts.get(source.source) || 0), 0);
      const metadataLeadCount = sourceManifest
        .filter(({ lane }) => lane === 'metadata_lead')
        .reduce((sum, source) => sum + (actualCounts.get(source.source) || 0), 0);
      remote = {
        checked: true,
        serverVersionNum,
        appTrackerPresent,
        supabaseTrackerPresent,
        baseMigrationPresent,
        appLedger,
        supabaseLedger,
        migrationSignaturePresent,
        activePublicationCount,
        sourceProjectionReady,
        discoverySignalCount,
        metadataLeadCount,
      };
    } finally {
      await loaded.close();
    }
  }

  const plannedMigrations = blockers.length === 0
    ? [CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT.fileName]
    : [];
  const readyForSeparateApproval = args.checkDb
    && blockers.length === 0
    && plannedMigrations.length === 1;
  const rehearsal = {
    recordType: 'case_vortex_retained_influence_migration_rehearsal' as const,
    schemaVersion: 'case-vortex-retained-influence-migration-rehearsal-v1' as const,
    localMigration,
    influenceBinding: {
      bundleSha256: sha256(bundleBytes),
      influenceReceiptSha256: bundle.influenceReceipt.receiptSha256,
      retainedRecordCount: bundle.influenceReceipt.accounting.retainedRecordCount,
      discoverySignalCount: bundle.influenceReceipt.influenceLaneCounts.discovery_signal,
      metadataLeadCount: bundle.influenceReceipt.influenceLaneCounts.metadata_lead,
      coverageGapCount: bundle.influenceReceipt.influenceLaneCounts.coverage_gap,
      sourceManifest,
    },
    remote,
    plannedMigrations,
    readyForSeparateApproval,
    blockers,
    approvalBoundary: {
      migrationApplicationApproved: false as const,
      indexBuildApproved: false as const,
      storageWriteApproved: false as const,
      publicationApproved: false as const,
      deploymentApproved: false as const,
      requiredBeforeAnyRemoteMutation: 'new_explicit_user_approval_for_0216_only' as const,
    },
    guarantees: {
      databaseReads: args.checkDb ? 'bounded-read-only-transactions' as const : 'none' as const,
      databaseWrites: 0 as const,
      storageReads: 0 as const,
      storageWrites: 0 as const,
      lunaCalls: 0 as const,
      publications: 0 as const,
      deployments: 0 as const,
    },
  };
  const result = { ...rehearsal, receiptSha256: sha256(JSON.stringify(rehearsal)) };
  if (args.strict && !readyForSeparateApproval) {
    throw new Error(
      `case_vortex_retained_influence_migration_rehearsal_blocked:${blockers.join(',')}`,
    );
  }
  return result;
};

if (require.main === module) {
  runCaseVortexRetainedInfluenceMigrationRehearsalCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
