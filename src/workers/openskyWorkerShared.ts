export const OPENSKY_BASE_URL = 'https://opensky-network.org/api';
export const OPENSKY_TOKEN_URL = String(
  process.env.OPENSKY_TOKEN_URL
  || 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
).trim();

export type OpenSkyResponse = {
  time: number;
  states: OpenSkyStateVector[] | null;
};

export type OpenSkyAuthTokenResponse = {
  access_token: string;
  expires_in?: number;
};

export type OpenSkyStateVector = unknown[];

export type OpenSkyStateRow = {
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  time_position: Date | null;
  last_contact: Date | null;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean | null;
  position_source: number | null;
  category: number | null;
  snapshot_time: Date | null;
  source: string;
};

export type OpenSkyIngestMode = 'live' | 'history';

export type IngestOpenSkyStateVectorsOptions = {
  mode?: OpenSkyIngestMode;
  manageLogger?: boolean;
};

export type OpenSkyAuthMode = 'oauth' | 'basic' | 'anonymous' | 'anonymous_fallback';

export type OpenSkyFetchFailureSummary = {
  bounds_key: string;
  auth_mode: OpenSkyAuthMode | null;
  duration_ms: number;
  row_count: number;
  error_code: string;
  outcome: 'failed';
};

export type OpenSkyShardResult = {
  bounds_key: string;
  auth_mode: OpenSkyAuthMode | null;
  duration_ms: number;
  row_count: number;
  outcome: 'completed' | 'degraded' | 'failed';
  error_code?: string | null;
};

export type OpenSkyIngestResult = {
  mode: OpenSkyIngestMode;
  snapshotTime: string;
  stateCount: number;
  rawKey: string;
  authMode: OpenSkyAuthMode | null;
  degraded: boolean;
  fetchBoundsCount: number;
  successfulBoundsCount: number;
  failedBoundsCount: number;
  fetchFailures: OpenSkyFetchFailureSummary[];
  fetchOutcomes: OpenSkyShardResult[];
};

export type OpenSkyFetchBounds = {
  lamin?: number;
  lomin?: number;
  lamax?: number;
  lomax?: number;
};

export type FetchOpenSkyStateVectorsOptions = {
  bounds?: OpenSkyFetchBounds;
  extended?: boolean;
  timeSec?: number | null;
  timeoutMs?: number;
};

export type OpenSkyFetchSuccess = {
  data: OpenSkyResponse;
  meta: {
    boundsKey: string;
    authMode: OpenSkyAuthMode;
    durationMs: number;
    rowCount: number;
  };
};

export type OpenSkyLiveRecoveryProbeResult = {
  status: 'skipped' | 'recovered' | 'failed';
  skippedReason?: 'live_job_not_paused';
  liveJobPaused: boolean;
  boundsKey: string;
  authMode: OpenSkyAuthMode | null;
  durationMs: number;
  rowCount: number;
  errorCode?: string;
};

export const OPENSKY_LIVE_PROBE_HEARTBEAT_FEED = 'opensky_live_probe';

export const DEFAULT_GLOBAL_INGEST_BOUNDS: OpenSkyFetchBounds[] = [
  { lamin: -90, lamax: 0, lomin: -180, lomax: 0 },
  { lamin: -90, lamax: 0, lomin: 0, lomax: 180 },
  { lamin: 0, lamax: 90, lomin: -180, lomax: 0 },
  { lamin: 0, lamax: 90, lomin: 0, lomax: 180 },
];

export const DEFAULT_LIVE_RECOVERY_PROBE_BOUNDS: OpenSkyFetchBounds = {
  lamin: 42,
  lomin: -10,
  lamax: 55,
  lomax: 15,
};

const parseNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseIntNumber = (value: unknown) => {
  const num = parseNumber(value);
  return num === null ? null : Math.trunc(num);
};

const parseBoolean = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  return null;
};

const parseText = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

export const parseBooleanEnv = (value: unknown, fallback = false) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const hasFiniteNumber = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text.length > 0 && Number.isFinite(Number(text));
};

export const hasExplicitEnvBounds = (env: NodeJS.ProcessEnv = process.env) => {
  if (
    !hasFiniteNumber(env.OPENSKY_LAMIN)
    || !hasFiniteNumber(env.OPENSKY_LOMIN)
    || !hasFiniteNumber(env.OPENSKY_LAMAX)
    || !hasFiniteNumber(env.OPENSKY_LOMAX)
  ) return false;

  const lamin = Number(env.OPENSKY_LAMIN);
  const lomin = Number(env.OPENSKY_LOMIN);
  const lamax = Number(env.OPENSKY_LAMAX);
  const lomax = Number(env.OPENSKY_LOMAX);
  return lamin >= -90
    && lamax <= 90
    && lomin >= -180
    && lomax <= 180
    && lamin < lamax
    && lomin < lomax;
};

const parseEpoch = (value: unknown) => {
  const seconds = parseIntNumber(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const buildRawKey = (snapshotTime: Date) => {
  const year = snapshotTime.getUTCFullYear();
  const month = String(snapshotTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(snapshotTime.getUTCDate()).padStart(2, '0');
  const timestamp = Math.floor(snapshotTime.getTime() / 1000);
  return `correlation/raw/opensky/${year}/${month}/${day}/states_${timestamp}.json`;
};

export const buildParams = (options: FetchOpenSkyStateVectorsOptions = {}) => {
  const params: Record<string, string | number> = {};
  const extended = options.extended ?? parseBooleanEnv(process.env.OPENSKY_EXTENDED, false);
  if (extended) {
    params.extended = 1;
  }
  const timeOverride = options.timeSec ?? Number(process.env.OPENSKY_TIME_SEC || NaN);
  if (Number.isFinite(timeOverride)) {
    params.time = Number(timeOverride);
  }
  const bounds = options.bounds ?? {
    lamin: process.env.OPENSKY_LAMIN ? Number(process.env.OPENSKY_LAMIN) : undefined,
    lomin: process.env.OPENSKY_LOMIN ? Number(process.env.OPENSKY_LOMIN) : undefined,
    lamax: process.env.OPENSKY_LAMAX ? Number(process.env.OPENSKY_LAMAX) : undefined,
    lomax: process.env.OPENSKY_LOMAX ? Number(process.env.OPENSKY_LOMAX) : undefined,
  };
  if (
    Number.isFinite(bounds.lamin)
    && Number.isFinite(bounds.lomin)
    && Number.isFinite(bounds.lamax)
    && Number.isFinite(bounds.lomax)
  ) {
    params.lamin = Number(bounds.lamin);
    params.lomin = Number(bounds.lomin);
    params.lamax = Number(bounds.lamax);
    params.lomax = Number(bounds.lomax);
  }
  return params;
};

export const getBoundsKey = (bounds?: OpenSkyFetchBounds) => {
  if (!bounds) return 'global';
  const values = [bounds.lamin, bounds.lomin, bounds.lamax, bounds.lomax];
  if (values.every((value) => Number.isFinite(value))) {
    return [
      Number(bounds.lamin).toFixed(1),
      Number(bounds.lomin).toFixed(1),
      Number(bounds.lamax).toFixed(1),
      Number(bounds.lomax).toFixed(1),
    ].join(':');
  }
  return 'global';
};

export const normalizeOpenSkyErrorCode = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '').trim().toUpperCase()
    : '';
  if (code) return code;
  const status = typeof error === 'object' && error !== null && 'response' in error
    ? Number((error as { response?: { status?: unknown } }).response?.status || 0)
    : 0;
  if (Number.isFinite(status) && status > 0) {
    return `HTTP_${status}`;
  }
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message || '').toLowerCase()
    : '';
  if (message.includes('timeout')) return 'TIMEOUT';
  return 'UNKNOWN';
};

export const summarizeOpenSkyFailure = (
  error: unknown,
  context: { boundsKey: string; authMode: OpenSkyAuthMode | null; durationMs: number },
): OpenSkyFetchFailureSummary => {
  const meta = typeof error === 'object' && error !== null && 'openskyFetchMeta' in error
    ? ((error as { openskyFetchMeta?: Record<string, unknown> }).openskyFetchMeta || {})
    : {};
  return {
    bounds_key: String(meta.boundsKey || context.boundsKey),
    auth_mode: (meta.authMode as OpenSkyAuthMode | null | undefined) ?? context.authMode,
    duration_ms: Number(meta.durationMs ?? context.durationMs),
    row_count: 0,
    error_code: String(meta.errorCode || normalizeOpenSkyErrorCode(error)),
    outcome: 'failed',
  };
};

export const buildOpenSkyIngestError = (message: string, details: Record<string, unknown>) => {
  const error = new Error(message) as Error & { details?: Record<string, unknown> };
  error.details = details;
  return error;
};

export const summarizeOpenSkyAuthMode = (modes: OpenSkyAuthMode[]): OpenSkyAuthMode | null => {
  if (!modes.length) return null;
  if (modes.includes('anonymous_fallback')) return 'anonymous_fallback';
  if (modes.includes('basic')) return 'basic';
  if (modes.includes('oauth')) return 'oauth';
  return 'anonymous';
};

export const shouldFallbackToAnonymous = (error: unknown) => {
  const status = typeof error === 'object' && error !== null && 'response' in error
    ? Number((error as { response?: { status?: unknown } }).response?.status || 0)
    : 0;
  if (status === 401 || status === 403) return true;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '').trim().toUpperCase()
    : '';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  if (status >= 500 && status < 600) return true;
  return false;
};

export const getIngestionFetchBoundsList = (
  mode: OpenSkyIngestMode,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (mode !== 'live') return [undefined];
  if (hasExplicitEnvBounds(env)) {
    return [{
      lamin: Number(env.OPENSKY_LAMIN),
      lomin: Number(env.OPENSKY_LOMIN),
      lamax: Number(env.OPENSKY_LAMAX),
      lomax: Number(env.OPENSKY_LOMAX),
    }];
  }
  const splitEnabled = parseBooleanEnv(env.OPENSKY_LIVE_TILE_SPLIT_ENABLED, true);
  return splitEnabled ? DEFAULT_GLOBAL_INGEST_BOUNDS : [undefined];
};

export const getLiveRecoveryProbeBounds = (env: NodeJS.ProcessEnv = process.env): OpenSkyFetchBounds => {
  if (
    hasFiniteNumber(env.OPENSKY_LIVE_PROBE_LAMIN)
    && hasFiniteNumber(env.OPENSKY_LIVE_PROBE_LOMIN)
    && hasFiniteNumber(env.OPENSKY_LIVE_PROBE_LAMAX)
    && hasFiniteNumber(env.OPENSKY_LIVE_PROBE_LOMAX)
  ) {
    return {
      lamin: Number(env.OPENSKY_LIVE_PROBE_LAMIN),
      lomin: Number(env.OPENSKY_LIVE_PROBE_LOMIN),
      lamax: Number(env.OPENSKY_LIVE_PROBE_LAMAX),
      lomax: Number(env.OPENSKY_LIVE_PROBE_LOMAX),
    };
  }
  return DEFAULT_LIVE_RECOVERY_PROBE_BOUNDS;
};

export const getLiveRecoveryProbeTimeoutMs = (env: NodeJS.ProcessEnv = process.env) => {
  return Math.max(2_000, Number(env.OPENSKY_LIVE_PROBE_TIMEOUT_MS || 6_000));
};

const getComparableRowFreshnessMs = (row: OpenSkyStateRow) => {
  const candidates = [
    row.last_contact?.getTime(),
    row.time_position?.getTime(),
    row.snapshot_time?.getTime(),
  ].filter((value): value is number => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : -1;
};

const mapStateRow = (state: OpenSkyStateVector, snapshotTime: Date): OpenSkyStateRow | null => {
  const icao24 = parseText(state[0]);
  if (!icao24) return null;
  return {
    icao24,
    callsign: parseText(state[1]),
    origin_country: parseText(state[2]),
    time_position: parseEpoch(state[3]),
    last_contact: parseEpoch(state[4]),
    longitude: parseNumber(state[5]),
    latitude: parseNumber(state[6]),
    baro_altitude: parseNumber(state[7]),
    on_ground: parseBoolean(state[8]),
    velocity: parseNumber(state[9]),
    true_track: parseNumber(state[10]),
    vertical_rate: parseNumber(state[11]),
    geo_altitude: parseNumber(state[13]),
    squawk: parseText(state[14]),
    spi: parseBoolean(state[15]),
    position_source: parseIntNumber(state[16]),
    category: parseIntNumber(state[17]),
    snapshot_time: snapshotTime,
    source: 'opensky',
  };
};

export const mapOpenSkyStateRows = (payload: OpenSkyResponse, snapshotOverride?: Date) => {
  const snapshotTime = snapshotOverride ?? (payload?.time ? new Date(payload.time * 1000) : new Date());
  const states = payload?.states || [];
  const rows: OpenSkyStateRow[] = [];
  for (const state of states) {
    if (!Array.isArray(state)) continue;
    const mapped = mapStateRow(state, snapshotTime);
    if (mapped) rows.push(mapped);
  }
  return { snapshotTime, rows };
};

export const mergeFetchedOpenSkyRows = (responses: OpenSkyResponse[]) => {
  const mergedByIcao = new Map<string, OpenSkyStateRow>();
  let latestSnapshotTimeMs = Number.NaN;

  for (const response of responses) {
    const { snapshotTime, rows } = mapOpenSkyStateRows(response);
    const snapshotTimeMs = snapshotTime.getTime();
    if (!Number.isFinite(latestSnapshotTimeMs) || snapshotTimeMs > latestSnapshotTimeMs) {
      latestSnapshotTimeMs = snapshotTimeMs;
    }
    for (const row of rows) {
      const existing = mergedByIcao.get(row.icao24);
      if (!existing || getComparableRowFreshnessMs(row) >= getComparableRowFreshnessMs(existing)) {
        mergedByIcao.set(row.icao24, row);
      }
    }
  }

  const snapshotTime = Number.isFinite(latestSnapshotTimeMs)
    ? new Date(latestSnapshotTimeMs)
    : new Date();

  return {
    snapshotTime,
    rows: Array.from(mergedByIcao.values()),
  };
};

export const getOpenSkyTimeoutMs = (override?: number) => {
  const envTimeout = Number(process.env.OPENSKY_TIMEOUT_MS || 15000);
  const timeout = Number.isFinite(override) ? Number(override) : envTimeout;
  return Math.max(1000, Number.isFinite(timeout) ? timeout : 15000);
};
