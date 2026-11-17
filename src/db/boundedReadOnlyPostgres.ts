import {
  Client,
  Pool,
  type ClientConfig,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

export type BoundedReadOnlyPostgresQueryOptions = {
  queryTimeoutMs: number;
  statementTimeoutMs: number;
  signal?: AbortSignal;
};

export type BoundedReadOnlyPostgresLimits = {
  maxConcurrent: number;
  maxQueued: number;
  acquireTimeoutMs: number;
  setupTimeoutMs: number;
  rollbackTimeoutMs: number;
  cancelConnectTimeoutMs: number;
  cancelQueryTimeoutMs: number;
  cancelEndTimeoutMs: number;
  cancelSettleTimeoutMs: number;
};

export type BoundedReadOnlyPostgresCancellationCapability =
  | { status: 'unverified' }
  | {
    status: 'verified';
    databaseName: string;
    sessionUser: string;
    currentUser: string;
    verifiedAt: string;
  }
  | {
    status: 'failed';
    code: string;
    failedAt: string;
  };

export type BoundedReadOnlyPostgres = {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[],
    options: BoundedReadOnlyPostgresQueryOptions,
  ): Promise<QueryResult<Row>>;
  verifyCancellationCapability(): Promise<
    Extract<BoundedReadOnlyPostgresCancellationCapability, { status: 'verified' }>
  >;
  getCancellationCapability(): BoundedReadOnlyPostgresCancellationCapability;
  close(): Promise<void>;
};

type WorkerClient = {
  query<Row extends QueryResultRow = QueryResultRow>(
    query: string | { text: string; values?: unknown[]; query_timeout?: number },
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  release(error?: boolean | Error): void;
  end?(): Promise<void>;
  connection?: {
    stream?: {
      destroy(error?: Error): void;
    };
  };
};

type WorkerPool = {
  connect(): Promise<WorkerClient>;
  end(): Promise<void>;
};

type ControlClient = {
  connect(): Promise<void>;
  query<Row extends QueryResultRow = QueryResultRow>(
    query: string | { text: string; values?: unknown[]; query_timeout?: number },
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

export type BoundedReadOnlyPostgresDependencies = {
  workerPool: WorkerPool;
  createControlClient(): ControlClient;
};

type WorkerIdentity = {
  backendPid: number;
  databaseName: string;
  sessionUser: string;
  currentUser: string;
};

type CancellationOutcome = {
  proven: boolean;
  code: string;
  identity?: WorkerIdentity;
};

type InternalExecutionOptions = {
  allowUnverifiedCapability?: boolean;
  onMainQueryStarted?: () => void;
};

const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const SERVER_RESPONSE_GRACE_MS = 50;
const PROBE_ABORT_DELAY_MS = 25;
const DISCARD_ERROR_CODE = 'bounded_read_only_postgres_worker_discarded';

class BoundedPostgresError extends Error {
  readonly code: string;

  constructor(code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'BoundedPostgresError';
    this.code = code;
  }
}

const errorCode = (error: unknown) => (
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
);

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
);

const isServerCancellation = (error: unknown) => errorCode(error) === '57014';
const isClientQueryTimeout = (error: unknown) => (
  /query read timeout/i.test(errorMessage(error))
  || errorCode(error) === 'QUERY_TIMEOUT'
);

const positiveInteger = (value: number, code: string, maximum = MAX_TIMEOUT_MS) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BoundedPostgresError(code);
  }
  return value;
};

const nonnegativeInteger = (value: number, code: string, maximum = 10_000) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new BoundedPostgresError(code);
  }
  return value;
};

const abortError = () => new BoundedPostgresError('case_graph_research_aborted');

const timeoutError = (code: string) => new BoundedPostgresError(code);

const runBounded = <T>(params: {
  operation: () => Promise<T>;
  timeoutMs: number;
  timeoutCode: string;
  signal?: AbortSignal;
}): Promise<T> => {
  if (params.signal?.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      work();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(
      () => finish(() => reject(timeoutError(params.timeoutCode))),
      params.timeoutMs,
    );
    timer.unref?.();
    params.signal?.addEventListener('abort', onAbort, { once: true });
    let pending: Promise<T>;
    try {
      pending = params.operation();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
};

class AdmissionGate {
  private active = 0;
  private readonly queue: Array<{
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort: () => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
  ) {}

  acquire(timeoutMs: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new BoundedPostgresError(
        'bounded_read_only_postgres_queue_full',
      ));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => undefined,
        timer: setTimeout(() => undefined, timeoutMs),
      };
      const remove = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        clearTimeout(waiter.timer);
        signal?.removeEventListener('abort', waiter.onAbort);
      };
      waiter.onAbort = () => {
        remove();
        reject(abortError());
      };
      clearTimeout(waiter.timer);
      waiter.timer = setTimeout(() => {
        remove();
        reject(timeoutError('bounded_read_only_postgres_acquire_timeout'));
      }, timeoutMs);
      waiter.timer.unref?.();
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.queue.push(waiter);
      if (signal?.aborted) waiter.onAbort();
    });
  }

  private releaseOnce() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.pulse();
    };
  }

  private pulse() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.active += 1;
      waiter.resolve(this.releaseOnce());
    }
  }
}

const parseWorkerIdentity = (result: QueryResult<QueryResultRow>): WorkerIdentity => {
  if (result.rows.length !== 1) {
    throw new BoundedPostgresError('bounded_read_only_postgres_setup_invalid');
  }
  const row = result.rows[0] as Record<string, unknown>;
  const backendPid = Number(row.backend_pid);
  if (!Number.isSafeInteger(backendPid) || backendPid < 1
    || row.transaction_read_only !== 'on'
    || typeof row.database_name !== 'string' || !row.database_name
    || typeof row.session_user !== 'string' || !row.session_user
    || typeof row.current_user !== 'string' || !row.current_user) {
    throw new BoundedPostgresError('bounded_read_only_postgres_setup_invalid');
  }
  return {
    backendPid,
    databaseName: row.database_name,
    sessionUser: row.session_user,
    currentUser: row.current_user,
  };
};

const cloneCapability = (
  capability: BoundedReadOnlyPostgresCancellationCapability,
): BoundedReadOnlyPostgresCancellationCapability => ({ ...capability });

export const createBoundedReadOnlyPostgresFromDependencies = (args: {
  dependencies: BoundedReadOnlyPostgresDependencies;
  limits: BoundedReadOnlyPostgresLimits;
  requireVerifiedCancellationCapability?: boolean;
}): BoundedReadOnlyPostgres => {
  const limits = {
    maxConcurrent: positiveInteger(args.limits.maxConcurrent,
      'bounded_read_only_postgres_max_concurrent_invalid', 100),
    maxQueued: nonnegativeInteger(args.limits.maxQueued,
      'bounded_read_only_postgres_max_queued_invalid'),
    acquireTimeoutMs: positiveInteger(args.limits.acquireTimeoutMs,
      'bounded_read_only_postgres_acquire_timeout_invalid'),
    setupTimeoutMs: positiveInteger(args.limits.setupTimeoutMs,
      'bounded_read_only_postgres_setup_timeout_invalid'),
    rollbackTimeoutMs: positiveInteger(args.limits.rollbackTimeoutMs,
      'bounded_read_only_postgres_rollback_timeout_invalid'),
    cancelConnectTimeoutMs: positiveInteger(args.limits.cancelConnectTimeoutMs,
      'bounded_read_only_postgres_cancel_connect_timeout_invalid'),
    cancelQueryTimeoutMs: positiveInteger(args.limits.cancelQueryTimeoutMs,
      'bounded_read_only_postgres_cancel_query_timeout_invalid'),
    cancelEndTimeoutMs: positiveInteger(args.limits.cancelEndTimeoutMs,
      'bounded_read_only_postgres_cancel_end_timeout_invalid'),
    cancelSettleTimeoutMs: positiveInteger(args.limits.cancelSettleTimeoutMs,
      'bounded_read_only_postgres_cancel_settle_timeout_invalid'),
  };
  const gate = new AdmissionGate(limits.maxConcurrent, limits.maxQueued);
  const requireCapability = args.requireVerifiedCancellationCapability ?? true;
  let capability: BoundedReadOnlyPostgresCancellationCapability = {
    status: 'unverified',
  };
  let closed = false;

  const failCapability = (code: string) => {
    capability = { status: 'failed', code, failedAt: new Date().toISOString() };
  };

  const verifyCapability = (identity: WorkerIdentity) => {
    capability = {
      status: 'verified',
      databaseName: identity.databaseName,
      sessionUser: identity.sessionUser,
      currentUser: identity.currentUser,
      verifiedAt: new Date().toISOString(),
    };
  };

  const cancelBackend = async (identity: WorkerIdentity): Promise<CancellationOutcome> => {
    const controller = args.dependencies.createControlClient();
    let outcome: CancellationOutcome = {
      proven: false,
      code: 'bounded_read_only_postgres_cancel_unproven',
    };
    try {
      await runBounded({
        operation: () => controller.connect(),
        timeoutMs: limits.cancelConnectTimeoutMs,
        timeoutCode: 'bounded_read_only_postgres_cancel_connect_timeout',
      });
      const result = await runBounded({
        operation: () => controller.query<{
          cancelled: boolean;
          database_name: string;
          session_user: string;
          current_user: string;
        }>({
          text: `
            SELECT
              pg_catalog.current_database()::text AS database_name,
              session_user::text AS session_user,
              current_user::text AS current_user,
              pg_catalog.pg_cancel_backend($1::integer) AS cancelled
          `,
          values: [identity.backendPid],
          query_timeout: limits.cancelQueryTimeoutMs,
        }),
        timeoutMs: limits.cancelQueryTimeoutMs,
        timeoutCode: 'bounded_read_only_postgres_cancel_query_timeout',
      });
      const row = result.rows.length === 1 ? result.rows[0] : null;
      if (row?.cancelled === true
        && row.database_name === identity.databaseName
        && row.session_user === identity.sessionUser
        && row.current_user === identity.currentUser) {
        outcome = { proven: true, code: 'ok', identity };
      } else {
        outcome = {
          proven: false,
          code: row?.cancelled === true
            ? 'bounded_read_only_postgres_cancel_identity_mismatch'
            : 'bounded_read_only_postgres_cancel_false',
        };
      }
    } catch (error) {
      outcome = {
        proven: false,
        code: errorCode(error) === '42501'
          ? 'bounded_read_only_postgres_cancel_permission_denied'
          : errorCode(error) || errorMessage(error),
      };
    }
    try {
      await runBounded({
        operation: () => controller.end(),
        timeoutMs: limits.cancelEndTimeoutMs,
        timeoutCode: 'bounded_read_only_postgres_cancel_end_timeout',
      });
    } catch {
      outcome = {
        proven: false,
        code: 'bounded_read_only_postgres_cancel_end_timeout',
      };
    }
    return outcome;
  };

  const acquireWorker = async (
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WorkerClient> => {
    const pending = args.dependencies.workerPool.connect();
    try {
      return await runBounded({
        operation: () => pending,
        timeoutMs,
        timeoutCode: 'bounded_read_only_postgres_pool_connect_timeout',
        signal,
      });
    } catch (error) {
      pending.then(
        (lateClient) => lateClient.release(),
        () => undefined,
      );
      throw error;
    }
  };

  const execute = async <Row extends QueryResultRow>(
    sql: string,
    params: readonly unknown[],
    options: BoundedReadOnlyPostgresQueryOptions,
    internal: InternalExecutionOptions = {},
  ): Promise<QueryResult<Row>> => {
    if (closed) throw new BoundedPostgresError('bounded_read_only_postgres_closed');
    const queryTimeoutMs = positiveInteger(options.queryTimeoutMs,
      'bounded_read_only_postgres_query_timeout_invalid');
    const requestedStatementTimeoutMs = positiveInteger(options.statementTimeoutMs,
      'bounded_read_only_postgres_statement_timeout_invalid');
    if (options.signal?.aborted) throw abortError();
    if (capability.status === 'failed') {
      throw new BoundedPostgresError(
        'bounded_read_only_postgres_cancellation_capability_failed',
      );
    }
    if (requireCapability && capability.status !== 'verified'
      && !internal.allowUnverifiedCapability) {
      throw new BoundedPostgresError(
        'bounded_read_only_postgres_cancellation_capability_unverified',
      );
    }

    const deadline = Date.now() + queryTimeoutMs;
    const remaining = (phaseMaximum: number, code: string) => {
      const value = Math.min(phaseMaximum, deadline - Date.now());
      if (value < 1) throw timeoutError(code);
      return value;
    };
    const acquireLimit = remaining(limits.acquireTimeoutMs,
      'bounded_read_only_postgres_acquire_timeout');
    const releaseAdmission = await gate.acquire(acquireLimit, options.signal);
    let worker: WorkerClient | null = null;
    let releaseWorker = true;
    let transactionOpen = false;
    let identity: WorkerIdentity | null = null;
    let mainQuery: Promise<QueryResult<Row>> | null = null;
    let cancellation: Promise<CancellationOutcome> | null = null;
    let abortListenerInstalled = false;
    let workerDestroyStarted = false;

    const discardWorker = () => {
      releaseWorker = false;
      if (!worker || workerDestroyStarted) return;
      workerDestroyStarted = true;
      // pg-pool's public release(error) removes the client, but its callback
      // cleanup can lag an active server statement. With the pinned node-pg
      // 8.16 driver, destroying the underlying stream is the only synchronous
      // client-side fail-closed fallback. PostgreSQL may retain the orphaned
      // backend until the already-installed SET LOCAL statement_timeout fires;
      // the later release(error) reconciles pool accounting and the worker is
      // never reused. If a future driver hides the stream, Client.end() is the
      // public fallback and this adapter remains unwired until the live probe
      // proves the same bounded orphan behavior again.
      if (worker.connection?.stream?.destroy) {
        worker.connection.stream.destroy();
      } else {
        void worker.end?.().catch(() => undefined);
      }
    };
    const startCancellation = (): Promise<CancellationOutcome> | null => {
      if (identity && !cancellation) cancellation = cancelBackend(identity);
      return cancellation;
    };
    const onAbort = () => startCancellation();
    const rollback = async () => {
      if (!worker || !transactionOpen) return true;
      try {
        await runBounded({
          operation: () => worker!.query({
            text: 'ROLLBACK',
            query_timeout: limits.rollbackTimeoutMs,
          }),
          timeoutMs: limits.rollbackTimeoutMs,
          timeoutCode: 'bounded_read_only_postgres_rollback_timeout',
        });
        transactionOpen = false;
        return true;
      } catch {
        discardWorker();
        return false;
      }
    };

    try {
      worker = await acquireWorker(
        remaining(limits.acquireTimeoutMs,
          'bounded_read_only_postgres_pool_connect_timeout'),
        options.signal,
      );
      if (options.signal?.aborted) throw abortError();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      abortListenerInstalled = true;

      await runBounded({
        operation: () => worker!.query({
          text: 'BEGIN READ ONLY',
          query_timeout: limits.setupTimeoutMs,
        }),
        timeoutMs: remaining(limits.setupTimeoutMs,
          'bounded_read_only_postgres_setup_timeout'),
        timeoutCode: 'bounded_read_only_postgres_setup_timeout',
        signal: options.signal,
      });
      transactionOpen = true;

      const serverTimeoutMs = Math.max(1, Math.min(
        requestedStatementTimeoutMs,
        Math.max(1, deadline - Date.now() - SERVER_RESPONSE_GRACE_MS),
      ));
      const setup = await runBounded({
        operation: () => worker!.query({
          text: `
            SELECT
              pg_catalog.pg_backend_pid()::integer AS backend_pid,
              pg_catalog.current_database()::text AS database_name,
              session_user::text AS session_user,
              current_user::text AS current_user,
              pg_catalog.current_setting('transaction_read_only')::text
                AS transaction_read_only,
              pg_catalog.set_config('statement_timeout', $1, true)::text
                AS statement_timeout
          `,
          values: [`${serverTimeoutMs}ms`],
          query_timeout: limits.setupTimeoutMs,
        }),
        timeoutMs: remaining(limits.setupTimeoutMs,
          'bounded_read_only_postgres_setup_timeout'),
        timeoutCode: 'bounded_read_only_postgres_setup_timeout',
        signal: options.signal,
      });
      identity = parseWorkerIdentity(setup);
      if (options.signal?.aborted) {
        startCancellation();
        throw abortError();
      }

      mainQuery = worker.query<Row>({
        text: sql,
        values: [...params],
        query_timeout: remaining(queryTimeoutMs,
          'bounded_read_only_postgres_query_timeout'),
      });
      internal.onMainQueryStarted?.();
      const result = await runBounded({
        operation: () => mainQuery!,
        timeoutMs: remaining(queryTimeoutMs,
          'bounded_read_only_postgres_query_timeout'),
        timeoutCode: 'bounded_read_only_postgres_query_timeout',
        signal: options.signal,
      });

      if (abortListenerInstalled) {
        options.signal?.removeEventListener('abort', onAbort);
        abortListenerInstalled = false;
      }
      if (options.signal?.aborted || cancellation) throw abortError();
      if (!await rollback()) {
        throw new BoundedPostgresError(
          'bounded_read_only_postgres_rollback_timeout',
        );
      }
      return result;
    } catch (error) {
      const aborted = options.signal?.aborted
        || errorCode(error) === 'case_graph_research_aborted';
      if (aborted && worker) {
        const cancellationAttempt = startCancellation();
        if (!identity || !cancellationAttempt || !mainQuery) {
          discardWorker();
        } else {
          const [cancelOutcome, settlement] = await Promise.all([
            cancellationAttempt,
            runBounded({
              operation: async () => mainQuery!.then(
                () => ({ status: 'resolved' as const, error: null }),
                (queryError) => ({ status: 'rejected' as const, error: queryError }),
              ),
              timeoutMs: limits.cancelSettleTimeoutMs,
              timeoutCode: 'bounded_read_only_postgres_cancel_settle_timeout',
            }).catch((settleError) => ({
              status: 'timeout' as const,
              error: settleError,
            })),
          ]);
          const proven = cancelOutcome.proven
            && settlement.status === 'rejected'
            && isServerCancellation(settlement.error);
          if (proven) {
            verifyCapability(identity);
            if (!await rollback()) discardWorker();
          } else {
            failCapability(cancelOutcome.proven
              ? 'bounded_read_only_postgres_cancel_settlement_unproven'
              : cancelOutcome.code);
            discardWorker();
          }
        }
        throw abortError();
      }

      if (isClientQueryTimeout(error)
        || errorCode(error) === 'bounded_read_only_postgres_query_timeout'
        || errorCode(error) === 'bounded_read_only_postgres_setup_timeout') {
        if (identity) {
          const outcome = await cancelBackend(identity);
          if (!outcome.proven) failCapability(outcome.code);
        }
        discardWorker();
        throw error;
      }

      if (!await rollback()) discardWorker();
      throw error;
    } finally {
      if (abortListenerInstalled) {
        options.signal?.removeEventListener('abort', onAbort);
      }
      if (worker) {
        worker.release(releaseWorker
          ? undefined
          : new BoundedPostgresError(DISCARD_ERROR_CODE));
      }
      releaseAdmission();
    }
  };

  const api: BoundedReadOnlyPostgres = {
    query: (sql, params, options) => execute(sql, params, options),
    verifyCancellationCapability: async () => {
      if (closed) throw new BoundedPostgresError('bounded_read_only_postgres_closed');
      if (capability.status === 'failed') {
        throw new BoundedPostgresError(
          'bounded_read_only_postgres_cancellation_capability_failed',
        );
      }
      if (capability.status === 'verified') return cloneCapability(capability) as
        Extract<BoundedReadOnlyPostgresCancellationCapability, { status: 'verified' }>;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await execute(
          'SELECT pg_catalog.pg_sleep(10)',
          [],
          {
            queryTimeoutMs: Math.min(MAX_TIMEOUT_MS,
              limits.cancelSettleTimeoutMs + limits.cancelConnectTimeoutMs
                + limits.cancelQueryTimeoutMs + limits.cancelEndTimeoutMs + 2_000),
            statementTimeoutMs: Math.min(MAX_TIMEOUT_MS,
              limits.cancelSettleTimeoutMs + 500),
            signal: controller.signal,
          },
          {
            allowUnverifiedCapability: true,
            onMainQueryStarted: () => {
              timer = setTimeout(() => controller.abort(), PROBE_ABORT_DELAY_MS);
              timer.unref?.();
            },
          },
        );
        failCapability('bounded_read_only_postgres_probe_unexpected_success');
      } catch (error) {
        if (errorCode(error) !== 'case_graph_research_aborted') {
          const currentCapability = cloneCapability(capability);
          if (currentCapability.status !== 'failed') {
            failCapability('bounded_read_only_postgres_probe_failed');
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
      const currentCapability = cloneCapability(capability);
      if (currentCapability.status !== 'verified') {
        throw new BoundedPostgresError(
          'bounded_read_only_postgres_cancellation_capability_failed',
        );
      }
      return currentCapability;
    },
    getCancellationCapability: () => cloneCapability(capability),
    close: async () => {
      if (closed) return;
      closed = true;
      await runBounded({
        operation: () => args.dependencies.workerPool.end(),
        timeoutMs: limits.cancelEndTimeoutMs,
        timeoutCode: 'bounded_read_only_postgres_close_timeout',
      });
    },
  };
  return api;
};

type PgDriver = {
  Pool: typeof Pool;
  Client: typeof Client;
};

const controlStartupOptions = (existing: string | undefined, timeoutMs: number) => [
  existing?.trim(),
  `-c statement_timeout=${timeoutMs}`,
  `-c lock_timeout=${timeoutMs}`,
  `-c idle_in_transaction_session_timeout=${timeoutMs}`,
].filter(Boolean).join(' ');

/**
 * Creates an isolated read-only pool and a fresh control connection for every
 * backend cancellation. Do not wire this adapter until
 * `verifyCancellationCapability()` has passed against the exact production
 * database role and Supabase pooler path. Local-superuser proof is not enough.
 */
export const createBoundedReadOnlyPostgres = (args: {
  workerPoolConfig: PoolConfig;
  controlClientConfig: ClientConfig;
  limits: BoundedReadOnlyPostgresLimits;
  requireVerifiedCancellationCapability?: boolean;
  driver?: PgDriver;
}): BoundedReadOnlyPostgres => {
  const driver = args.driver ?? { Pool, Client };
  const workerConnectionTimeout = Math.min(
    typeof args.workerPoolConfig.connectionTimeoutMillis === 'number'
      ? args.workerPoolConfig.connectionTimeoutMillis
      : args.limits.acquireTimeoutMs,
    args.limits.acquireTimeoutMs,
  );
  const workerPool = new driver.Pool({
    ...args.workerPoolConfig,
    max: args.limits.maxConcurrent,
    connectionTimeoutMillis: workerConnectionTimeout,
  });
  return createBoundedReadOnlyPostgresFromDependencies({
    dependencies: {
      workerPool,
      createControlClient: () => new driver.Client({
        ...args.controlClientConfig,
        connectionTimeoutMillis: Math.min(
          typeof args.controlClientConfig.connectionTimeoutMillis === 'number'
            ? args.controlClientConfig.connectionTimeoutMillis
            : args.limits.cancelConnectTimeoutMs,
          args.limits.cancelConnectTimeoutMs,
        ),
        query_timeout: args.limits.cancelQueryTimeoutMs,
        statement_timeout: args.limits.cancelQueryTimeoutMs,
        options: controlStartupOptions(
          args.controlClientConfig.options,
          args.limits.cancelQueryTimeoutMs,
        ),
      }),
    },
    limits: args.limits,
    requireVerifiedCancellationCapability:
      args.requireVerifiedCancellationCapability,
  });
};
