import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createBoundedReadOnlyPostgres,
  type BoundedReadOnlyPostgres,
} from '../db/boundedReadOnlyPostgres';
import { splitSqlStatements } from '../db/sqlStatementSplitter';
import { loadEnv } from '../env';
import { resolveCaseVortexRehearsalDatabaseConfig } from './buildCaseVortexRemoteRehearsal';

type QueryResult = { rows: Array<Record<string, unknown>> };
type Query = (sql: string, params?: readonly unknown[]) => Promise<QueryResult>;

export const CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS = [
  {
    version: '0214',
    fileName: '0214_case_vortex_claim_analysis_tool_receipts_2026_07_23.sql',
    sha256: 'f8b9bfe9177b84bb4f7dde8dac5a0179fcdeefa6d046745c5c3b3a829080e366',
    signature: 'function:save_case_vortex_luna_turn_allows_analyze_case_claims',
  },
  {
    version: '0215',
    fileName: '0215_case_vortex_saved_claim_analyses_2026_07_23.sql',
    sha256: '02d6fd8eb4fe3b85fbe5ecb4e2b7e69b8c48b336be646bb350362ebf3cb60d1f',
    signature: 'persistence:case_vortex_luna_turns_claim_analyses',
  },
] as const;

const BASE_MIGRATION = {
  version: '0213',
  fileName: '0213_case_vortex_saved_report_replay_2026_07_22.sql',
} as const;

export const caseVortexClaimAnalysisMigrationRehearsalUsage = `Usage:
  npm run case-vortex:claim-analysis-migration-rehearsal
  npm run case-vortex:claim-analysis-migration-rehearsal -- --check-db [--strict]

Builds a deterministic, bounded read-only rehearsal for migrations 0214 and
0215 only. It requires the exact 0213 base in both migration trackers, zero
active publications, and no partial 0214/0215 schema. It performs no writes,
R2 access, Luna call, publication activation or deployment.
`;

type Dependencies = {
  env: NodeJS.ProcessEnv;
  migrationsDir?: string;
  readMigration?: (filePath: string) => Promise<Buffer>;
  query?: Query;
  loadQuery?: () => Promise<{ query: Query; close: () => Promise<void> }>;
};

const truthy = (value: unknown) => value === true || value === 't';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const stem = (fileName: string) => fileName.replace(/\.sql$/u, '');

const parseArguments = (argv: string[]) => {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true as const };
  let checkDb = false;
  let strict = false;
  for (const argument of argv) {
    if (argument === '--check-db') checkDb = true;
    else if (argument === '--strict') strict = true;
    else throw new Error(`case_vortex_claim_analysis_migration_rehearsal_argument_invalid:${argument}`);
  }
  return { help: false as const, checkDb, strict };
};

const createDefaultReadOnlyQuery = async (env: NodeJS.ProcessEnv) => {
  if (!String(env.DATABASE_URL || '').trim()) {
    throw new Error('case_vortex_claim_analysis_migration_rehearsal_database_url_missing');
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

export const inspectCaseVortexClaimAnalysisMigrationSignatures = async (query: Query) => {
  const result = await query(`
    /* case_vortex_claim_analysis_migration_rehearsal:signatures */
    SELECT 'function:save_case_vortex_luna_turn_allows_analyze_case_claims' AS name,
      COALESCE(
        strpos(
          pg_get_functiondef(to_regprocedure(
            'public.save_case_vortex_luna_turn(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,varchar,uuid,varchar)'
          )),
          quote_literal('analyze_case_claims')
        ) > 0,
        false
      ) AS present
    UNION ALL
    SELECT 'persistence:case_vortex_luna_turns_claim_analyses',
      (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'case_vortex_luna_turns'
            AND column_name = 'claim_analyses' AND data_type = 'jsonb'
            AND is_nullable = 'NO'
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint AS constraint_record
          JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = 'case_vortex_luna_turns'
            AND constraint_record.conname = 'case_vortex_luna_turns_claim_analyses_shape'
            AND constraint_record.convalidated
        )
        AND to_regprocedure(
          'public.save_case_vortex_luna_turn(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,varchar,uuid,varchar)'
        ) IS NOT NULL
        AND (
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
        )
      ) AS present
  `);
  return Object.fromEntries(result.rows.map((row) => [String(row.name), truthy(row.present)]));
};

export const runCaseVortexClaimAnalysisMigrationRehearsalCli = async (
  argv = process.argv.slice(2),
  dependencies?: Dependencies,
) => {
  if (!dependencies) loadEnv({ quiet: true });
  const env = dependencies?.env || process.env;
  const args = parseArguments(argv);
  if (args.help) return { usage: caseVortexClaimAnalysisMigrationRehearsalUsage };
  const migrationsDir = dependencies?.migrationsDir
    || path.join(process.cwd(), 'src', 'db', 'migrations');
  const readMigration = dependencies?.readMigration || readFile;
  const blockers: string[] = [];
  const localChain = await Promise.all(CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(
    async (contract) => {
      const bytes = await readMigration(path.join(migrationsDir, contract.fileName));
      const actualSha256 = sha256(bytes);
      const statements = splitSqlStatements(bytes.toString('utf8'));
      const digestMatches = actualSha256 === contract.sha256;
      if (!digestMatches) blockers.push(`local:digest_mismatch:${contract.version}`);
      return {
        ...contract,
        actualSha256,
        digestMatches,
        byteLength: bytes.byteLength,
        statementCount: statements.length,
        transactionMode: 'single-transaction' as const,
      };
    },
  ));

  let remote: null | {
    checked: true;
    serverVersionNum: number;
    appTrackerPresent: boolean;
    supabaseTrackerPresent: boolean;
    baseMigrationPresent: boolean;
    appLedger: string[];
    supabaseLedger: string[];
    signatures: Record<string, boolean>;
    appliedVersions: string[];
    missingVersions: string[];
    activePublicationCount: number;
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
        /* case_vortex_claim_analysis_migration_rehearsal:catalog */
        SELECT current_setting('server_version_num')::integer AS server_version_num,
          to_regclass('public.schema_migrations') IS NOT NULL AS app_tracker_present,
          to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase_tracker_present,
          to_regclass('public.case_vortex_luna_turns') IS NOT NULL AS turns_present,
          to_regclass('public.uap_case_graph_publications') IS NOT NULL AS publications_present
      `);
      const catalogRow = catalog.rows[0] || {};
      const serverVersionNum = Number(catalogRow.server_version_num || 0);
      const appTrackerPresent = truthy(catalogRow.app_tracker_present);
      const supabaseTrackerPresent = truthy(catalogRow.supabase_tracker_present);
      const turnsPresent = truthy(catalogRow.turns_present);
      const publicationsPresent = truthy(catalogRow.publications_present);
      if (serverVersionNum < 170000) blockers.push('remote:postgres_17_required');
      if (!appTrackerPresent) blockers.push('remote:app_migration_tracker_missing');
      if (!supabaseTrackerPresent) blockers.push('remote:supabase_migration_tracker_missing');
      if (!turnsPresent) blockers.push('remote:case_vortex_luna_turns_missing');
      if (!publicationsPresent) blockers.push('remote:publications_relation_missing');

      const appLedger = appTrackerPresent
        ? (await loaded.query(`
            /* case_vortex_claim_analysis_migration_rehearsal:app_ledger */
            SELECT id FROM public.schema_migrations
            WHERE substring(id FROM 1 FOR 4) BETWEEN '0213' AND '0215'
            ORDER BY id
          `)).rows.map((row) => String(row.id))
        : [];
      const supabaseLedger = supabaseTrackerPresent
        ? (await loaded.query(`
            /* case_vortex_claim_analysis_migration_rehearsal:supabase_ledger */
            SELECT version FROM supabase_migrations.schema_migrations
            WHERE substring(version FROM 1 FOR 4) BETWEEN '0213' AND '0215'
            ORDER BY version
          `)).rows.map((row) => String(row.version))
        : [];

      const baseApp = appLedger.includes(BASE_MIGRATION.fileName);
      const baseSupabase = supabaseLedger.includes(stem(BASE_MIGRATION.fileName));
      const baseMigrationPresent = baseApp && baseSupabase;
      if (baseApp !== baseSupabase) blockers.push('remote:base_tracker_disagreement:0213');
      else if (!baseMigrationPresent) blockers.push('remote:base_migration_0213_missing');

      const signatures = turnsPresent
        ? await inspectCaseVortexClaimAnalysisMigrationSignatures(loaded.query)
        : Object.fromEntries(CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.map(
          ({ signature }) => [signature, false],
        ));
      const activePublication = publicationsPresent
        ? await loaded.query(`
            /* case_vortex_claim_analysis_migration_rehearsal:active_publication */
            SELECT count(*)::integer AS count
            FROM public.uap_case_graph_publications WHERE active = true
          `)
        : { rows: [{ count: 0 }] };
      const activePublicationCount = Number(activePublication.rows[0]?.count || 0);
      if (activePublicationCount !== 0) blockers.push('remote:active_publication_must_be_zero');

      const appSet = new Set(appLedger);
      const supabaseSet = new Set(supabaseLedger);
      const appliedVersions: string[] = [];
      const missingVersions: string[] = [];
      for (const contract of CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS) {
        const appApplied = appSet.has(contract.fileName);
        const supabaseApplied = supabaseSet.has(stem(contract.fileName));
        const schemaPresent = signatures[contract.signature] === true;
        if (appApplied !== supabaseApplied) {
          blockers.push(`remote:tracker_disagreement:${contract.version}`);
        } else if (appApplied && supabaseApplied) {
          if (schemaPresent) appliedVersions.push(contract.version);
          else blockers.push(`remote:ledger_schema_drift:${contract.version}`);
        } else if (schemaPresent) {
          blockers.push(`remote:untracked_schema:${contract.version}`);
        } else {
          missingVersions.push(contract.version);
        }
      }
      if (appliedVersions.length && missingVersions.length) {
        blockers.push('remote:claim_analysis_chain_partially_applied');
      }
      plannedMigrations = CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS
        .filter(({ version }) => missingVersions.includes(version))
        .map(({ fileName }) => fileName);
      remote = {
        checked: true,
        serverVersionNum,
        appTrackerPresent,
        supabaseTrackerPresent,
        baseMigrationPresent,
        appLedger,
        supabaseLedger,
        signatures,
        appliedVersions,
        missingVersions,
        activePublicationCount,
      };
    } finally {
      await loaded.close();
    }
  }

  const readyForSeparateApproval = args.checkDb
    && blockers.length === 0
    && plannedMigrations.length === CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.length;
  const alreadyFullyApplied = args.checkDb
    && blockers.length === 0
    && remote?.appliedVersions.length === CASE_VORTEX_CLAIM_ANALYSIS_MIGRATION_CONTRACTS.length
    && remote.missingVersions.length === 0;
  const rehearsal = {
    recordType: 'case_vortex_claim_analysis_migration_rehearsal' as const,
    schemaVersion: 'case-vortex-claim-analysis-migration-rehearsal-v1' as const,
    localChain,
    remote,
    plannedMigrations,
    readyForSeparateApproval,
    blockers,
    approvalBoundary: {
      migrationApplicationApproved: false as const,
      publicationApproved: false as const,
      deploymentApproved: false as const,
      requiredBeforeAnyRemoteMutation: 'new_explicit_user_approval_for_0214_0215' as const,
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
  if (args.strict && !readyForSeparateApproval && !alreadyFullyApplied) {
    throw new Error(`case_vortex_claim_analysis_migration_rehearsal_blocked:${blockers.join(',')}`);
  }
  return result;
};

if (require.main === module) {
  runCaseVortexClaimAnalysisMigrationRehearsalCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
