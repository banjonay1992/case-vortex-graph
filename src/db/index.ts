import { randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { getDatabaseUrl, loadEnv } from '../env';
import { getRequestContext } from '../utils/requestContext';
import { quoteSqlIdentifierPath } from './sqlSafety';
import { isDbConnectionError, isDbQueryReadTimeoutError } from './errors';
import { parseDatabaseEndpoint, resolveDatabaseTlsPolicy } from './connectionSecurity';

loadEnv({ quiet: true });

const connectionString = getDatabaseUrl();
const databaseEndpoint = parseDatabaseEndpoint(connectionString);

const isLocalConnection = databaseEndpoint.isLocal;
const allowLocalDb = process.env.ALLOW_LOCAL_DB === '1' || process.env.ALLOW_LOCAL_DB === 'true';
if (isLocalConnection && !allowLocalDb) {
  throw new Error('Local Postgres connections are not supported. Set DATABASE_URL to your Supabase Postgres URL.');
}

const isSupabaseConnection = databaseEndpoint.isSupabase;
const allowNonSupabaseDb = process.env.ALLOW_NON_SUPABASE_DB === '1' || process.env.ALLOW_NON_SUPABASE_DB === 'true';
if (!isSupabaseConnection && !allowNonSupabaseDb) {
  throw new Error('Only Supabase Postgres is supported. Set DATABASE_URL to your Supabase Postgres URL.');
}
const requireSupabasePoolerInProd =
  process.env.REQUIRE_SUPABASE_POOLER_IN_PROD === undefined
    ? true
    : process.env.REQUIRE_SUPABASE_POOLER_IN_PROD === '1' || process.env.REQUIRE_SUPABASE_POOLER_IN_PROD === 'true';
const allowDirectSupabaseDbInProd =
  process.env.ALLOW_DIRECT_SUPABASE_DB_IN_PROD === '1' || process.env.ALLOW_DIRECT_SUPABASE_DB_IN_PROD === 'true';
if ((process.env.NODE_ENV || '').trim() === 'production' && isSupabaseConnection && requireSupabasePoolerInProd && !allowDirectSupabaseDbInProd) {
  if (!databaseEndpoint.isSupabasePooler) {
    throw new Error(
      'Production DATABASE_URL must use Supabase pooler endpoint (pooler.supabase.com). Set ALLOW_DIRECT_SUPABASE_DB_IN_PROD=true to override.'
    );
  }
}
const databaseTlsPolicy = resolveDatabaseTlsPolicy(databaseEndpoint);
if (databaseTlsPolicy.warning) {
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'db_tls_server_verification_disabled',
    code: databaseTlsPolicy.warning.code,
    message: databaseTlsPolicy.warning.message,
  }));
}
const effectiveConnectionString = databaseEndpoint.effectiveConnectionString;

const parsePoolNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOptionalPoolNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const poolMaxDefault = databaseEndpoint.isSupabasePooler ? 5 : 20;
const poolMax = parsePoolNumber(process.env.PG_POOL_MAX, poolMaxDefault);
const poolMaxWaitingClients = parsePoolNumber(
  process.env.PG_POOL_MAX_WAITING_CLIENTS,
  Math.max(10, poolMax * 4),
);
const idleTimeoutMs = parsePoolNumber(process.env.PG_POOL_IDLE_TIMEOUT_MS, 30000);
// Supabase pooler handshakes can take several seconds on cold paths.
// Use a safer default to avoid startup/request flapping in production.
const connectionTimeoutMs = parsePoolNumber(process.env.PG_POOL_CONN_TIMEOUT_MS, 12000);
const queryTimeoutMs = parseOptionalPoolNumber(process.env.PG_QUERY_TIMEOUT_MS);
const statementTimeoutMs = parseOptionalPoolNumber(process.env.PG_STATEMENT_TIMEOUT_MS);
const connectRetryAttempts = parsePoolNumber(process.env.PG_CONNECT_RETRY_ATTEMPTS, 3);
const connectRetryDelayMs = parsePoolNumber(process.env.PG_CONNECT_RETRY_DELAY_MS, 750);

let pool: Pool | null = null;
let poolGeneration = 0;
const clientSourcePools = new WeakMap<object, Pool>();

const isClosedPoolError = (err: unknown) => {
  const message = String((err as any)?.message || '').toLowerCase();
  return message.includes('after calling end on the pool') || message.includes('pool is draining');
};

const shouldRecyclePoolForError = (err: unknown) => isClosedPoolError(err) || isDbConnectionError(err);

const shouldDiscardClientForError = (err: unknown) =>
  shouldRecyclePoolForError(err)
  || isDbQueryReadTimeoutError(err)
  || String((err as { code?: unknown })?.code || '') === 'DB_QUERY_ABORTED';

const recyclePool = (reason: string, err?: unknown, sourcePool?: Pool | null) => {
  const activePool = pool;
  if (!activePool) return;
  if (sourcePool && sourcePool !== activePool) return;
  pool = null;
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'db_pool_recycled',
    generation: poolGeneration,
    reason,
    error: err instanceof Error ? err.message : (err ? String(err) : null),
  }));
  void activePool.end().catch((closeErr) => {
    console.error('[db] failed to recycle pool', closeErr);
  });
};

const attachPoolListeners = (target: Pool) => {
  target.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    if (shouldRecyclePoolForError(err)) {
      recyclePool('idle_client_error', err, target);
    }
    if (process.env.PG_EXIT_ON_ERROR === 'true' || process.env.PG_EXIT_ON_ERROR === '1') {
      process.exit(-1);
    }
  });
};

const createPool = () => {
  const nextPool = new Pool({
    connectionString: effectiveConnectionString,
    ssl: databaseTlsPolicy.ssl,
    max: poolMax,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: queryTimeoutMs,
    statement_timeout: statementTimeoutMs,
  });
  poolGeneration += 1;
  attachPoolListeners(nextPool);
  return nextPool;
};

const getPool = () => {
  if (!pool) {
    pool = createPool();
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'db_pool_initialized',
      generation: poolGeneration,
    }));
  }
  return pool;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetryableConnectionError = (err: unknown) => {
  return isClosedPoolError(err) || isDbConnectionError(err);
};

const isPoolWaitingLimitError = (err: unknown) => String((err as any)?.code || '') === 'DB_POOL_WAITING_LIMIT';

const acquireClient = async (): Promise<PoolClient> => {
  let attempt = 0;
  while (true) {
    let attemptedPool: Pool | null = null;
    try {
      attemptedPool = getPool();
      if (attemptedPool.waitingCount >= poolMaxWaitingClients) {
        const err = new Error(`Database pool is saturated: ${attemptedPool.waitingCount} queued clients`);
        (err as Error & { code?: string }).code = 'DB_POOL_WAITING_LIMIT';
        throw err;
      }
      const client = await attemptedPool.connect();
      clientSourcePools.set(client, attemptedPool);
      return client;
    } catch (err) {
      if (isPoolWaitingLimitError(err)) throw err;
      if (shouldRecyclePoolForError(err)) {
        recyclePool('connect_error', err, attemptedPool);
      }
      if (!isRetryableConnectionError(err) || attempt >= connectRetryAttempts) {
        throw err;
      }
      attempt += 1;
      const delayMs = connectRetryDelayMs * attempt;
      console.warn(`[db] pool.connect retry ${attempt}/${connectRetryAttempts} after transient error`);
      await sleep(delayMs);
    }
  }
};

// Query performance tracking
const slowQueryThresholdMs = process.env.SLOW_QUERY_MS ? Number(process.env.SLOW_QUERY_MS) : 0;
const explainAnalyzeEnabled = process.env.EXPLAIN_ANALYZE_SLOW_QUERIES === '1' || process.env.EXPLAIN_ANALYZE_SLOW_QUERIES === 'true';
const explainAnalyzeThresholdMs = process.env.EXPLAIN_ANALYZE_THRESHOLD_MS ? Number(process.env.EXPLAIN_ANALYZE_THRESHOLD_MS) : 500;
const explainAnalyzeMaxPerMinute = (() => {
  const raw = Number(process.env.EXPLAIN_ANALYZE_MAX_PER_MINUTE ?? 2);
  if (!Number.isFinite(raw)) return 2;
  if (raw <= 0) return 0;
  return Math.min(60, Math.floor(raw));
})();
let explainAnalyzeWindowStart = Date.now();
let explainAnalyzeRunsInWindow = 0;

const consumeExplainAnalyzeBudget = (): boolean => {
  if (!explainAnalyzeEnabled || explainAnalyzeMaxPerMinute <= 0) return false;
  const now = Date.now();
  if (now - explainAnalyzeWindowStart >= 60_000) {
    explainAnalyzeWindowStart = now;
    explainAnalyzeRunsInWindow = 0;
  }
  if (explainAnalyzeRunsInWindow >= explainAnalyzeMaxPerMinute) return false;
  explainAnalyzeRunsInWindow += 1;
  return true;
};

// Track queries that can be analyzed (SELECT only, no CTEs with writes)
const canExplainAnalyze = (sql: string): boolean => {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) return false;
  if (/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(normalized)) return false;
  return true;
};

const DB_STATEMENT_TIMEOUT_MIN_MS = 0;
const DB_STATEMENT_TIMEOUT_MAX_MS = 60 * 60 * 1000;

export const normalizeStatementTimeoutMs = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(DB_STATEMENT_TIMEOUT_MIN_MS, Math.floor(fallback));
  }
  return Math.max(DB_STATEMENT_TIMEOUT_MIN_MS, Math.min(DB_STATEMENT_TIMEOUT_MAX_MS, Math.floor(parsed)));
};

type DbCallPath =
  | 'query'
  | 'querySafe'
  | 'queryIdentifier'
  | 'queryWithOptions'
  | 'queryStats'
  | 'resetQueryStats'
  | 'checkPoolHealth';

type DbQueryOptions = {
  callPath: DbCallPath;
  queryTimeoutMs?: number;
  statementTimeoutMs?: number;
  signal?: AbortSignal;
};

const createDbCallId = (callPath: DbCallPath) => `${callPath}-${randomUUID()}`;

const validateSqlIdentifierPath = (identifierPath: string, allowedIdentifierPaths: readonly string[]) => {
  const normalized = String(identifierPath || '').trim();
  if (!normalized) {
    throw new Error('Identifier path is required');
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(normalized)) {
    throw new Error(`Unsafe identifier path: ${normalized}`);
  }
  if (!allowedIdentifierPaths.includes(normalized)) {
    throw new Error(`Identifier path is not allowlisted: ${normalized}`);
  }
  return normalized;
};

export { validateSqlIdentifierPath };

const logDbQueryFailure = (ctx: {
  callId: string;
  callPath: DbCallPath;
  text: string;
  params: any[];
  waitMs: number;
  execMs: number;
  elapsedMs: number;
  err: unknown;
}) => {
  const requestContext = getRequestContext();
  console.error(JSON.stringify({
    level: 'error',
    msg: 'db_query_failed',
    db_call_id: ctx.callId,
    db_call_path: ctx.callPath,
    request_id: requestContext?.requestId ?? null,
    user_id: requestContext?.userId ?? null,
    duration_ms: Number(ctx.elapsedMs.toFixed(1)),
    wait_ms: Number(ctx.waitMs.toFixed(1)),
    exec_ms: Number(ctx.execMs.toFixed(1)),
    query: String(ctx.text || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    params_count: ctx.params?.length ?? 0,
    error: ctx.err instanceof Error ? ctx.err.message : String(ctx.err),
  }));
};

const logDbQuerySlow = (ctx: {
  callId: string;
  callPath: DbCallPath;
  text: string;
  params: any[];
  waitMs: number;
  execMs: number;
  elapsedMs: number;
  result: any;
}) => {
  const requestContext = getRequestContext();
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'slow_query',
    db_call_id: ctx.callId,
    db_call_path: ctx.callPath,
    request_id: requestContext?.requestId ?? null,
    user_id: requestContext?.userId ?? null,
    duration_ms: Number(ctx.elapsedMs.toFixed(1)),
    wait_ms: Number(ctx.waitMs.toFixed(1)),
    exec_ms: Number(ctx.execMs.toFixed(1)),
    threshold_ms: slowQueryThresholdMs,
    query: String(ctx.text || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    params_count: ctx.params?.length ?? 0,
    rows_returned: ctx.result?.rowCount ?? null,
  }));
};

const executeQueryOnClient = async (
  client: PoolClient,
  text: string,
  params: any[],
  options: DbQueryOptions,
) => {
  const normalizedStatementTimeoutMs = normalizeStatementTimeoutMs(options.statementTimeoutMs, 0);
  const normalizedQueryTimeoutMs = options.queryTimeoutMs && options.queryTimeoutMs > 0
    ? Math.floor(options.queryTimeoutMs)
    : null;
  const queryTimeoutMsCandidates = [
    normalizedQueryTimeoutMs,
    normalizedStatementTimeoutMs > 0 ? Math.floor(normalizedStatementTimeoutMs) : null,
  ].filter((value): value is number => typeof value === 'number' && value > 0);

  let pending: Promise<any>;
  if (queryTimeoutMsCandidates.length > 0) {
    const effectiveTimeoutMs = Math.min(...queryTimeoutMsCandidates);
    pending = (client as any).query({
      text,
      values: params,
      query_timeout: effectiveTimeoutMs,
    });
  } else {
    pending = client.query(text, params);
  }
  if (!options.signal) return pending;
  const abortError = Object.assign(new Error('db_query_aborted'), { code: 'DB_QUERY_ABORTED' });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    const backendPid = Number((client as any).processID);
    if (!Number.isSafeInteger(backendPid) || backendPid < 1) return;
    const cancelClient = new Client({
      connectionString: effectiveConnectionString,
      ssl: databaseTlsPolicy.ssl,
      connectionTimeoutMillis: Math.min(connectionTimeoutMs, 2_000),
      query_timeout: 2_000,
    });
    void cancelClient.connect()
      .then(() => cancelClient.query({
        text: 'SELECT pg_catalog.pg_cancel_backend($1::integer) AS cancelled',
        values: [backendPid],
      }))
      .catch((error) => {
        console.error('[db] AbortSignal backend cancellation failed', error instanceof Error ? error.message : String(error));
      })
      .finally(() => cancelClient.end().catch(() => undefined));
  };
  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await pending;
  } catch (error) {
    if (aborted) throw abortError;
    throw error;
  } finally {
    options.signal.removeEventListener('abort', onAbort);
  }
};

const executeDbQuery = async (
  text: string,
  params: any[] = [],
  options: DbQueryOptions,
) => {
  const callId = createDbCallId(options.callPath);
  const totalStart = process.hrtime.bigint();
  const waitStart = process.hrtime.bigint();
  let client: PoolClient | null = null;
  let clientReleased = false;
  let waitMs = 0;
  let execMs = 0;
  let result: any;
  try {
    if (options.signal?.aborted) throw new Error('db_query_aborted');
    client = await acquireClient();
    if (options.signal?.aborted) throw new Error('db_query_aborted');
    waitMs = Number(process.hrtime.bigint() - waitStart) / 1_000_000;
    const execStart = process.hrtime.bigint();
    result = await executeQueryOnClient(client, text, params, options);
    execMs = Number(process.hrtime.bigint() - execStart) / 1_000_000;
    return result;
  } catch (err) {
    execMs = execMs || Number(process.hrtime.bigint() - waitStart) / 1_000_000;
    const elapsedMs = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    if (client && shouldDiscardClientForError(err)) {
      clientReleased = true;
      try {
        (client as any).release(err instanceof Error ? err : true);
      } catch {
        // The client is already considered unusable; do not return it again.
      }
    }
    if (client && shouldRecyclePoolForError(err)) {
      const sourcePool = clientSourcePools.get(client);
      recyclePool('query_error', err, sourcePool);
    }
    logDbQueryFailure({ callId, callPath: options.callPath, text, params, waitMs, execMs, elapsedMs, err });
    throw err;
  } finally {
    if (client && !clientReleased) client.release();
    const elapsedMs = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    if (Number.isFinite(slowQueryThresholdMs) && slowQueryThresholdMs > 0 && elapsedMs >= slowQueryThresholdMs) {
      logDbQuerySlow({ callId, callPath: options.callPath, text, params, waitMs, execMs, elapsedMs, result });
      if (execMs >= explainAnalyzeThresholdMs && canExplainAnalyze(text) && consumeExplainAnalyzeBudget()) {
        try {
          const explainResult = await getPool().query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${text}`, params);
          const requestContext = getRequestContext();
          console.warn(JSON.stringify({
            level: 'warn',
            msg: 'slow_query_explain',
            db_call_id: callId,
            db_call_path: options.callPath,
            request_id: requestContext?.requestId ?? null,
            user_id: requestContext?.userId ?? null,
            duration_ms: Number(elapsedMs.toFixed(1)),
            wait_ms: Number(waitMs.toFixed(1)),
            exec_ms: Number(execMs.toFixed(1)),
            query: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            explain_plan: formatExplainOutput(explainResult.rows),
          }));
        } catch (explainErr) {
          console.error('[db] EXPLAIN ANALYZE failed:', explainErr);
        }
      }
    }
  }
};

// Format EXPLAIN ANALYZE output for logging
const formatExplainOutput = (rows: any[]): string => {
  return rows.map(row => row['QUERY PLAN'] || JSON.stringify(row)).join('\n');
};

export const querySafe = async (text: string, params: any[] = []) =>
  executeDbQuery(text, params, { callPath: 'querySafe' });

export const query = querySafe;

export const queryIdentifier = async (
  text: string,
  params: any[] = [],
  options: {
    identifierPath: string;
    allowedIdentifierPaths: readonly string[];
    queryTimeoutMs?: number;
    statementTimeoutMs?: number;
  },
) => {
  const identifierPath = validateSqlIdentifierPath(options.identifierPath, options.allowedIdentifierPaths);
  if (!String(text || '').includes('__IDENTIFIER__')) {
    throw new Error('queryIdentifier requires a __IDENTIFIER__ placeholder');
  }
  const safeSql = String(text).split('__IDENTIFIER__').join(quoteSqlIdentifierPath(identifierPath));
  return executeDbQuery(safeSql, params, {
    callPath: 'queryIdentifier',
    queryTimeoutMs: options.queryTimeoutMs,
    statementTimeoutMs: normalizeStatementTimeoutMs(options.statementTimeoutMs, 0),
  });
};

type QueryOptions = {
  queryTimeoutMs?: number;
  statementTimeoutMs?: number;
  signal?: AbortSignal;
};

export const queryWithOptions = async (text: string, params: any[] = [], options: QueryOptions = {}) => {
  return executeDbQuery(text, params, {
    callPath: 'queryWithOptions',
    queryTimeoutMs: options.queryTimeoutMs,
    statementTimeoutMs: normalizeStatementTimeoutMs(options.statementTimeoutMs, 0),
    signal: options.signal,
  });
};

export const getClient = () => acquireClient();

// Pool-level statement_timeout startup parameters do not survive the pooled
// connection, so callers whose queries legitimately exceed the server's default
// statement_timeout opt in here: the declared budget is applied with SET LOCAL
// inside a transaction, which self-reverts on COMMIT/ROLLBACK.
export const queryWithServerStatementBudget = async (
  text: string,
  params: any[] = [],
  options: { statementTimeoutMs?: number; queryTimeoutMs?: number } = {},
) => {
  const serverBudgetMs = Number.isFinite(options.statementTimeoutMs) && Number(options.statementTimeoutMs) > 0
    ? Math.floor(Number(options.statementTimeoutMs))
    : 0;
  if (serverBudgetMs <= 0) {
    return queryWithOptions(text, params, options);
  }
  const client = await acquireClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout TO ${serverBudgetMs}`);
    const queryTimeoutMs = Number.isFinite(options.queryTimeoutMs) && Number(options.queryTimeoutMs) > 0
      ? Math.floor(Number(options.queryTimeoutMs))
      : null;
    const result = queryTimeoutMs
      ? await (client as any).query({ text, values: params, query_timeout: queryTimeoutMs })
      : await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const closePool = async () => {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'db_pool_close_requested',
    generation: poolGeneration,
    stack: new Error().stack?.split('\n').slice(1, 5).map(line => line.trim()) ?? [],
  }));
  await activePool.end();
};

const pgStatStatementsRelationCandidates = ['pg_stat_statements', 'extensions.pg_stat_statements'] as const;
const pgStatStatementsResetCandidates = ['pg_stat_statements_reset', 'extensions.pg_stat_statements_reset'] as const;
let pgStatStatementsRelationCache: string | null = null;
let pgStatStatementsResetCache: string | null = null;
type QueryStatsError = { error: string; hint: string };
type ResetQueryStatsResult = { success: true } | { error: string };

const isPgStatStatementsMissingRelationError = (err: any) =>
  err?.code === '42P01' || String(err?.message || '').includes('pg_stat_statements');

const isPgStatStatementsMissingFunctionError = (err: any) =>
  err?.code === '42883' || String(err?.message || '').includes('pg_stat_statements_reset');

const queryStatsFromRelation = async (relationName: string, limit: number) => {
  const result = await queryIdentifier(
    `
      SELECT
        queryid,
        LEFT(query, 200) as query_preview,
        calls,
        total_exec_time::numeric(12,2) as total_time_ms,
        mean_exec_time::numeric(12,2) as mean_time_ms,
        min_exec_time::numeric(12,2) as min_time_ms,
        max_exec_time::numeric(12,2) as max_time_ms,
        stddev_exec_time::numeric(12,2) as stddev_time_ms,
        rows,
        shared_blks_hit,
        shared_blks_read,
        CASE WHEN shared_blks_hit + shared_blks_read > 0
          THEN ROUND(100.0 * shared_blks_hit / (shared_blks_hit + shared_blks_read), 2)
          ELSE 100
        END as cache_hit_ratio
      FROM __IDENTIFIER__
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC
      LIMIT $1
    `,
    [limit],
    { identifierPath: relationName, allowedIdentifierPaths: pgStatStatementsRelationCandidates },
  );
  return result.rows;
};

// Query statistics helper - requires pg_stat_statements extension
export const getQueryStats = async (limit = 20): Promise<any[] | QueryStatsError> => {
  const relationCandidates = pgStatStatementsRelationCache
    ? [pgStatStatementsRelationCache]
    : [...pgStatStatementsRelationCandidates];
  let sawMissingRelation = false;

  for (const relationName of relationCandidates) {
    try {
      const rows = await queryStatsFromRelation(relationName, limit);
      pgStatStatementsRelationCache = relationName;
      return rows;
    } catch (err: any) {
      if (isPgStatStatementsMissingRelationError(err)) {
        sawMissingRelation = true;
        continue;
      }
      throw err;
    }
  }

  if (pgStatStatementsRelationCache) {
    pgStatStatementsRelationCache = null;
    return getQueryStats(limit);
  }

  if (sawMissingRelation) {
    return { error: 'pg_stat_statements extension not enabled', hint: 'Run: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' };
  }
  return { error: 'pg_stat_statements extension not enabled', hint: 'Run: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' };
};

// Reset query statistics (admin only)
export const resetQueryStats = async (): Promise<ResetQueryStatsResult> => {
  const fnCandidates = pgStatStatementsResetCache
    ? [pgStatStatementsResetCache]
    : [...pgStatStatementsResetCandidates];
  let sawMissingFunction = false;

  for (const fnName of fnCandidates) {
    try {
      await queryIdentifier(`SELECT __IDENTIFIER__()`, [], {
        identifierPath: fnName,
        allowedIdentifierPaths: pgStatStatementsResetCandidates,
      });
      pgStatStatementsResetCache = fnName;
      return { success: true };
    } catch (err: any) {
      if (isPgStatStatementsMissingFunctionError(err)) {
        sawMissingFunction = true;
        continue;
      }
      throw err;
    }
  }

  if (pgStatStatementsResetCache) {
    pgStatStatementsResetCache = null;
    return resetQueryStats();
  }

  if (sawMissingFunction) {
    return { error: 'pg_stat_statements extension not enabled or insufficient permissions' };
  }
  return { error: 'pg_stat_statements extension not enabled or insufficient permissions' };
};

// Pool health monitoring
export type PoolStats = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
  utilizationPercent: number;
};

export const getPoolStats = (): PoolStats => {
  const activePool = getPool();
  const total = activePool.totalCount;
  const idle = activePool.idleCount;
  const waiting = activePool.waitingCount;
  const utilization = poolMax > 0 ? Math.round((total / poolMax) * 100) : 0;
  return {
    totalCount: total,
    idleCount: idle,
    waitingCount: waiting,
    maxConnections: poolMax,
    utilizationPercent: utilization,
  };
};

// Health check with connection test
export const checkPoolHealth = async (): Promise<{
  healthy: boolean;
  latencyMs: number;
  stats: PoolStats;
  error?: string;
}> => {
  const stats = getPoolStats();
  const start = process.hrtime.bigint();
  try {
    await querySafe('SELECT 1');
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return {
      healthy: true,
      latencyMs: Number(latencyMs.toFixed(2)),
      stats,
    };
  } catch (err: any) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return {
      healthy: false,
      latencyMs: Number(latencyMs.toFixed(2)),
      stats,
      error: err?.message || 'Connection failed',
    };
  }
};
