import { createGunzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import csvParser from 'csv-parser';

export type SkyContextMode = 'live' | 'historical';
export type SkyContextLayer = 'meteors' | 'aurora' | 'balloons' | 'storms';

export type SkyContextBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  wraps: boolean;
};

export type StormEventCode =
  | 'tornado'
  | 'severe_thunderstorm'
  | 'flood'
  | 'winter'
  | 'fire'
  | 'wind'
  | 'coastal'
  | 'heat'
  | 'other';

export type SkyContextEvent = {
  id: string;
  kind: 'meteor' | 'aurora' | 'balloon' | 'storm';
  source: 'nasa_cneos' | 'noaa_swpc_ovation' | 'sondehub' | 'igra' | 'noaa_storm_events' | 'nws_alerts';
  label: string;
  description: string;
  lat: number;
  lon: number;
  occurred_at: string | null;
  forecast_at: string | null;
  strength: number | null;
  altitude_km: number | null;
  velocity_km_s: number | null;
  confidence: number;
  live: boolean;
  historical: boolean;
  event_code?: StormEventCode;
  severity?: 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
};

export type LoadSkyContextEventsParams = {
  bounds: SkyContextBounds;
  layers: SkyContextLayer[];
  mode: SkyContextMode;
  days: number;
  limit: number;
  now?: Date;
};

type FireballApiPayload = {
  fields?: unknown;
  data?: unknown;
};

type AuroraOvationPayload = {
  'Observation Time'?: unknown;
  'Forecast Time'?: unknown;
  coordinates?: unknown;
};

type CacheEntry<T> = {
  cachedAtMs: number;
  value: T;
};

const NASA_FIREBALL_URL = 'https://ssd-api.jpl.nasa.gov/fireball.api';
const NOAA_AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const NOAA_STORM_EVENTS_INDEX_URL = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual';
const FIREBALL_CACHE_TTL_MS = Math.max(60_000, Number(process.env.SKY_CONTEXT_FIREBALL_CACHE_TTL_MS || 900_000) || 900_000);
const AURORA_CACHE_TTL_MS = Math.max(60_000, Number(process.env.SKY_CONTEXT_AURORA_CACHE_TTL_MS || 180_000) || 180_000);
const STORM_EVENTS_CACHE_TTL_MS = Math.max(600_000, Number(process.env.SKY_CONTEXT_STORM_CACHE_TTL_MS || 86_400_000) || 86_400_000);
const STORM_EVENTS_MAX_YEARS = Math.max(1, Math.min(10, Number(process.env.SKY_CONTEXT_STORM_MAX_YEARS || 4) || 4));
const LIVE_STORM_FALLBACK_MIN = Math.max(1, Math.min(5000, Number(process.env.SKY_CONTEXT_LIVE_STORM_FALLBACK_MIN || 12) || 12));
const AURORA_SIGNAL_THRESHOLD = Math.max(1, Number(process.env.SKY_CONTEXT_AURORA_THRESHOLD || 12) || 12);
const NWS_ALERTS_CACHE_TTL_MS = Math.max(30_000, Number(process.env.SKY_CONTEXT_NWS_CACHE_TTL_MS || 60_000) || 60_000);
const NWS_ZONE_CACHE_TTL_MS = Math.max(3_600_000, Number(process.env.SKY_CONTEXT_NWS_ZONE_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000) || 7 * 24 * 60 * 60 * 1000);
const NWS_MAX_ZONE_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.SKY_CONTEXT_NWS_ZONE_CONCURRENCY || 6) || 6));
const NWS_MAX_ZONES_PER_REQUEST = Math.max(0, Math.min(400, Number(process.env.SKY_CONTEXT_NWS_MAX_ZONES || 80) || 80));
const NWS_FETCH_TIMEOUT_MS = Math.max(1000, Math.min(30_000, Number(process.env.SKY_CONTEXT_NWS_FETCH_TIMEOUT_MS || 6000) || 6000));
const NWS_OVERALL_TIMEOUT_MS = Math.max(2000, Math.min(30_000, Number(process.env.SKY_CONTEXT_NWS_OVERALL_TIMEOUT_MS || 9000) || 9000));
const SKY_CONTEXT_LAYER_TIMEOUT_MS = Math.max(1000, Math.min(30_000, Number(process.env.SKY_CONTEXT_LAYER_TIMEOUT_MS || 4500) || 4500));
const NWS_USER_AGENT = process.env.NWS_API_USER_AGENT || 'case-vortex-graph/0.1 (set NWS_API_USER_AGENT to identify your deployment)';
const STORM_EVENT_TYPES = new Set([
  'dust devil',
  'dust storm',
  'funnel cloud',
  'hail',
  'high wind',
  'lightning',
  'marine hail',
  'marine high wind',
  'marine thunderstorm wind',
  'thunderstorm wind',
  'tornado',
  'waterspout',
]);

const cache = new Map<string, CacheEntry<unknown>>();
const inFlightCache = new Map<string, Promise<unknown>>();

const getCached = <T>(key: string, ttlMs: number): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAtMs > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
};

const setCached = <T>(key: string, value: T) => {
  cache.set(key, { cachedAtMs: Date.now(), value });
  if (/^noaa-storm-events:\d{4}$/.test(key)) {
    const yearly = [...cache.keys()].filter(key => /^noaa-storm-events:\d{4}$/.test(key));
    for (const oldKey of yearly.slice(0, Math.max(0, yearly.length - 2))) cache.delete(oldKey);
  }
  if (cache.size <= 64) return;
  const oldest = Array.from(cache.entries()).sort((a, b) => a[1].cachedAtMs - b[1].cachedAtMs).slice(0, cache.size - 64);
  for (const [oldKey] of oldest) cache.delete(oldKey);
};

const loadCached = <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
  const cached = getCached<T>(key, ttlMs);
  if (cached !== null) return Promise.resolve(cached);
  const inFlight = inFlightCache.get(key) as Promise<T> | undefined;
  if (inFlight) return inFlight;
  let pending: Promise<T>;
  pending = load().then((value) => {
    if (inFlightCache.get(key) === pending && value != null) setCached(key, value);
    return value;
  }).finally(() => {
    if (inFlightCache.get(key) === pending) inFlightCache.delete(key);
  });
  inFlightCache.set(key, pending);
  return pending;
};

export const clearSkyContextEventsCache = () => {
  cache.clear();
  inFlightCache.clear();
};

export const normalizeLongitude = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && value > 0 ? 180 : wrapped;
};

export const normalizeSkyContextBounds = (params: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}): SkyContextBounds => {
  const minLat = Math.max(-90, Math.min(90, Math.min(params.minLat, params.maxLat)));
  const maxLat = Math.max(-90, Math.min(90, Math.max(params.minLat, params.maxLat)));
  if (Math.abs(params.maxLon - params.minLon) >= 359.5) {
    return { minLat, maxLat, minLon: -180, maxLon: 180, wraps: false };
  }
  const minLon = normalizeLongitude(params.minLon);
  const maxLon = normalizeLongitude(params.maxLon);
  return { minLat, maxLat, minLon, maxLon, wraps: minLon > maxLon };
};

export const isWithinSkyContextBounds = (lat: number, lon: number, bounds: SkyContextBounds) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < bounds.minLat || lat > bounds.maxLat) return false;
  const normalizedLon = normalizeLongitude(lon);
  if (!bounds.wraps) return normalizedLon >= bounds.minLon && normalizedLon <= bounds.maxLon;
  return normalizedLon >= bounds.minLon || normalizedLon <= bounds.maxLon;
};

const parseNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseDirectedCoordinate = (value: unknown, direction: unknown, axis: 'lat' | 'lon') => {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  const dir = String(direction || '').trim().toUpperCase();
  const signed = dir === 'S' || dir === 'W' ? -Math.abs(parsed) : Math.abs(parsed);
  if (axis === 'lat' && (signed < -90 || signed > 90)) return null;
  if (axis === 'lon' && (signed < -180 || signed > 180)) return null;
  return signed;
};

const getFieldIndex = (fields: string[], field: string) => fields.findIndex((candidate) => candidate === field);

const isoOrNull = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const parseCsvLine = (line: string) => {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
};

const parseNoaaStormDate = (value: string, timezone: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Storm Events history starts in 1950. A two-digit year must not turn a
  // 1970s observation into a future event (Date.parse has platform-dependent
  // two-digit-year rules, so expand it explicitly).
  const dated = trimmed.replace(/^(\d{1,2})-([A-Z]{3})-(\d{2})(?=\s|$)/i, (_match, day, month, shortYear) => {
    const year = Number(shortYear);
    return `${day} ${month} ${year >= 50 ? 1900 + year : 2000 + year}`;
  });
  const parsed = Date.parse(`${dated} GMT`);
  if (!Number.isFinite(parsed)) return null;
  // NOAA documents BEGIN_DATE_TIME as usually local standard time, with the
  // numeric UTC offset in CZ_TIMEZONE (for example CST-6). Interpret the
  // numeric offset rather than the abbreviation, whose meaning can vary.
  const zone = timezone.trim();
  if (!zone) return parsed;
  const offset = zone.match(/^[A-Z]{2,6}([+-]\d{1,2})(?::?(\d{2}))?$/i);
  if (!offset) return null;
  const hours = Number(offset[1]);
  const minutes = Number(offset[2] || 0);
  if (Math.abs(hours) > 14 || minutes >= 60) return null;
  const offsetSign = offset[1].startsWith('-') ? -1 : 1;
  return parsed - offsetSign * (Math.abs(hours) * 60 + minutes) * 60_000;
};

const parseNoaaStormRow = (get: (key: string) => string): SkyContextEvent | null => {
  const eventType = get('EVENT_TYPE').trim();
  const lat = parseNumber(get('BEGIN_LAT'));
  const lon = parseNumber(get('BEGIN_LON'));
  if (!eventType || !STORM_EVENT_TYPES.has(eventType.toLowerCase())) return null;
  if (lat == null || lon == null) return null;

  const beginDate = get('BEGIN_DATE_TIME').trim();
  const parsedTime = parseNoaaStormDate(beginDate, get('CZ_TIMEZONE'));

  const state = get('STATE').trim();
  const narrative = get('EVENT_NARRATIVE').trim();
  const magnitude = parseNumber(get('MAGNITUDE'));
  const eventId = get('EVENT_ID').trim();
  const occurredAt = parsedTime != null ? new Date(parsedTime).toISOString() : null;

  return {
    id: `noaa-storm-${eventId || `${occurredAt}-${lat}-${lon}`}`,
    kind: 'storm',
    source: 'noaa_storm_events',
    label: eventType,
    description: `${eventType}${state ? `, ${state}` : ''}${narrative ? `: ${narrative.slice(0, 180)}` : ''}`,
    lat,
    lon,
    occurred_at: occurredAt,
    forecast_at: null,
    strength: magnitude,
    altitude_km: null,
    velocity_km_s: null,
    confidence: 0.78,
    live: false,
    historical: true,
  };

};
const parseNoaaStormEventsCatalogue = (csvText: string): SkyContextEvent[] => {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  const headerIndex = new Map(parseCsvLine(lines[0] || '').map((field, index) => [field.trim(), index]));
  return lines.slice(1).flatMap(line => {
    const fields = parseCsvLine(line);
    const event = parseNoaaStormRow(key => fields[headerIndex.get(key) ?? -1] || '');
    return event ? [event] : [];
  }).sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
};

const filterNoaaStormEvents = (
  events: SkyContextEvent[],
  bounds: SkyContextBounds,
  sinceMs: number,
  limit: number,
  untilMs = Number.POSITIVE_INFINITY,
) => events
  .filter((event) => isWithinSkyContextBounds(event.lat, event.lon, bounds)
    && ((!Number.isFinite(sinceMs) && !Number.isFinite(untilMs)) || event.occurred_at != null)
    && (!Number.isFinite(sinceMs) || Date.parse(event.occurred_at!) >= sinceMs)
    && (!Number.isFinite(untilMs) || Date.parse(event.occurred_at!) <= untilMs))
  .slice(0, Math.max(1, limit));

export const parseNoaaStormEventsCsv = (
  csvText: string,
  bounds: SkyContextBounds,
  sinceMs: number,
  limit: number,
): SkyContextEvent[] => filterNoaaStormEvents(parseNoaaStormEventsCatalogue(csvText), bounds, sinceMs, limit);

export const parseNasaFireballEvents = (
  payload: FireballApiPayload,
  bounds: SkyContextBounds,
  mode: SkyContextMode,
): SkyContextEvent[] => {
  const fields = Array.isArray(payload.fields) ? payload.fields.map(String) : [];
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const idx = {
    date: getFieldIndex(fields, 'date'),
    energy: getFieldIndex(fields, 'energy'),
    impact: getFieldIndex(fields, 'impact-e'),
    lat: getFieldIndex(fields, 'lat'),
    latDir: getFieldIndex(fields, 'lat-dir'),
    lon: getFieldIndex(fields, 'lon'),
    lonDir: getFieldIndex(fields, 'lon-dir'),
    alt: getFieldIndex(fields, 'alt'),
    vel: getFieldIndex(fields, 'vel'),
  };
  if (idx.date < 0 || idx.lat < 0 || idx.latDir < 0 || idx.lon < 0 || idx.lonDir < 0) return [];

  return rows.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const lat = parseDirectedCoordinate(row[idx.lat], row[idx.latDir], 'lat');
    const lon = parseDirectedCoordinate(row[idx.lon], row[idx.lonDir], 'lon');
    if (lat == null || lon == null || !isWithinSkyContextBounds(lat, lon, bounds)) return [];
    const occurredAt = isoOrNull(row[idx.date]);
    const energy = parseNumber(row[idx.energy]);
    const impactEnergy = parseNumber(row[idx.impact]);
    const altitudeKm = parseNumber(row[idx.alt]);
    const velocityKmS = parseNumber(row[idx.vel]);
    const strength = impactEnergy ?? energy ?? null;
    const idDate = occurredAt ? occurredAt.replace(/[-:.TZ]/g, '').slice(0, 14) : 'unknown';
    const id = `nasa-cneos-${idDate}-${lat.toFixed(2)}-${lon.toFixed(2)}`;
    const strengthLabel = strength != null ? `${strength.toLocaleString('en-US', { maximumFractionDigits: 1 })} kt` : 'confirmed';

    return [{
      id,
      kind: 'meteor' as const,
      source: 'nasa_cneos' as const,
      label: 'Meteor / fireball',
      description: `NASA CNEOS fireball event, ${strengthLabel} impact energy estimate.`,
      lat,
      lon,
      occurred_at: occurredAt,
      forecast_at: null,
      strength,
      altitude_km: altitudeKm,
      velocity_km_s: velocityKmS,
      confidence: 0.92,
      live: mode === 'live',
      historical: true,
    }];
  });
};

export const parseNoaaAuroraEvents = (
  payload: AuroraOvationPayload,
  bounds: SkyContextBounds,
  limit: number,
): SkyContextEvent[] => {
  const rows = Array.isArray(payload.coordinates) ? payload.coordinates : [];
  const observedAt = isoOrNull(payload['Observation Time']);
  const forecastAt = isoOrNull(payload['Forecast Time']);

  return rows
    .flatMap((row) => {
      if (!Array.isArray(row) || row.length < 3) return [];
      const lonRaw = parseNumber(row[0]);
      const lat = parseNumber(row[1]);
      const strength = parseNumber(row[2]);
      if (lat == null || lonRaw == null || strength == null || strength < AURORA_SIGNAL_THRESHOLD) return [];
      const lon = normalizeLongitude(lonRaw);
      if (!isWithinSkyContextBounds(lat, lon, bounds)) return [];

      return [{
        id: `noaa-aurora-${forecastAt || observedAt || 'latest'}-${lat.toFixed(1)}-${lon.toFixed(1)}`,
        kind: 'aurora' as const,
        source: 'noaa_swpc_ovation' as const,
        label: 'Aurora / sky glow',
        description: `NOAA OVATION aurora probability ${Math.round(strength)}.`,
        lat,
        lon,
        occurred_at: observedAt,
        forecast_at: forecastAt,
        strength,
        altitude_km: null,
        velocity_km_s: null,
        confidence: 0.82,
        live: true,
        historical: false,
      }];
    })
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, Math.max(1, limit));
};

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

const fetchJson = async <T>(url: URL): Promise<T> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SKY_CONTEXT_LAYER_TIMEOUT_MS),
    headers: {
      accept: 'application/json',
      'user-agent': 'case-vortex-graph/0.1 sky-context',
    },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`Sky context provider returned ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const fetchText = async (url: URL, signal = AbortSignal.timeout(SKY_CONTEXT_LAYER_TIMEOUT_MS)) => {
  const response = await fetch(url, {
    signal,
    headers: {
      accept: 'text/html,text/plain,*/*',
      'user-agent': 'case-vortex-graph/0.1 sky-context',
    },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`Sky context provider returned ${response.status}`);
  }
  return response.text();
};

// Annual NOAA files contain large narratives. Never inflate or retain entire CSVs.
export const readNoaaStormCatalogue = async (response: Response, signal: AbortSignal): Promise<SkyContextEvent[]> => {
  if (!response.body) throw new Error('noaa_storm_body_missing');
  const fields = new Set(['BEGIN_DATE_TIME', 'CZ_TIMEZONE', 'EVENT_ID', 'STATE', 'EVENT_TYPE', 'BEGIN_LAT', 'BEGIN_LON', 'MAGNITUDE', 'EVENT_NARRATIVE']);
  const bound = (maximum: number) => {
    let bytes = 0;
    return new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maximum ? new Error('noaa_storm_body_oversized') : null, chunk);
    } });
  };
  const events: SkyContextEvent[] = [];
  let retainedBytes = 0;
  const parser = csvParser({ maxRowBytes: 1024 * 1024,
    mapHeaders: ({ header }) => fields.has(header.trim()) ? header.trim() : null,
    mapValues: ({ header, value }) => String(value).slice(0, header === 'EVENT_NARRATIVE' ? 180 : 256) });
  let validHeaders = false;
  parser.on('headers', (headers: Array<string | null>) => {
    validHeaders = ['BEGIN_DATE_TIME', 'EVENT_TYPE', 'BEGIN_LAT', 'BEGIN_LON'].every(field => headers.includes(field));
    if (!validHeaders) parser.destroy(new Error('noaa_storm_schema_invalid'));
  });
  await pipeline(
    Readable.fromWeb(response.body as any), bound(64 * 1024 * 1024), createGunzip(), bound(256 * 1024 * 1024),
    parser,
    async (rows) => {
      for await (const row of rows) {
        const event = parseNoaaStormRow(key => row[key] || '');
        if (!event) continue;
        retainedBytes += Buffer.byteLength(JSON.stringify(event));
        if (retainedBytes > 24 * 1024 * 1024 || events.length >= 75_000) throw new Error('noaa_storm_catalogue_oversized');
        events.push(event);
      }
    }, { signal },
  );
  if (!validHeaders) throw new Error('noaa_storm_schema_invalid');
  return events.sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
};

const fetchStormCatalogue = async (url: URL, signal: AbortSignal) => {
  const response = await fetch(url, { signal, headers: { accept: 'application/gzip', 'user-agent': 'case-vortex-graph/0.1 sky-context' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Sky context provider returned ${response.status}`); }
  return readNoaaStormCatalogue(response, signal);
};

const fetchNwsJson = async <T>(url: URL, timeoutMs: number = NWS_FETCH_TIMEOUT_MS): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/geo+json,application/json',
        'user-agent': NWS_USER_AGENT,
      },
      signal: controller.signal,
    } as RequestInit);
    if (!response.ok) {
      throw new Error(`NWS provider returned ${response.status}`);
    }
    return await (response.json() as Promise<T>);
  } finally {
    clearTimeout(timer);
  }
};

const nwsInflight = new Map<string, Promise<unknown>>();

const fetchNwsJsonDeduped = async <T>(url: URL, timeoutMs?: number): Promise<T> => {
  const key = url.toString();
  const existing = nwsInflight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fetchNwsJson<T>(url, timeoutMs).finally(() => {
    nwsInflight.delete(key);
  });
  nwsInflight.set(key, pending);
  return pending;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

type NwsGeometry = {
  type?: string | null;
  coordinates?: unknown;
} | null;

type NwsAlertFeature = {
  id?: string;
  geometry?: NwsGeometry;
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    certainty?: string;
    urgency?: string;
    headline?: string | null;
    description?: string | null;
    sent?: string | null;
    effective?: string | null;
    onset?: string | null;
    expires?: string | null;
    areaDesc?: string | null;
    affectedZones?: string[] | null;
  };
};

type NwsAlertsResponse = {
  features?: NwsAlertFeature[] | null;
};

type NwsZoneResponse = {
  geometry?: NwsGeometry;
};

// Classify the NWS `event` string into a stable icon/severity bucket. Ordered —
// more specific matches first so "Severe Thunderstorm Warning" doesn't fall
// into the generic storm-warning bucket.
const NWS_EVENT_CLASSIFIERS: Array<{ test: RegExp; code: StormEventCode }> = [
  { test: /tornado/i, code: 'tornado' },
  { test: /severe thunderstorm|special marine warning|storm warning|thunderstorm/i, code: 'severe_thunderstorm' },
  { test: /flash flood|flood/i, code: 'flood' },
  { test: /blizzard|ice storm|winter storm|winter weather|heavy freezing spray|freeze|frost/i, code: 'winter' },
  { test: /red flag|fire weather/i, code: 'fire' },
  { test: /high wind|wind advisory|gale|brisk wind|lake wind|dust storm|dust advisory/i, code: 'wind' },
  { test: /coastal flood|high surf|rip current|storm surge|tsunami|beach hazard|small craft/i, code: 'coastal' },
  { test: /heat/i, code: 'heat' },
];

const classifyNwsEvent = (event: string): StormEventCode | null => {
  const trimmed = event.trim();
  if (!trimmed) return null;
  for (const entry of NWS_EVENT_CLASSIFIERS) {
    if (entry.test.test(trimmed)) return entry.code;
  }
  return null;
};

const SEVERITY_RANK: Record<StormEventCode, number> = {
  tornado: 10,
  severe_thunderstorm: 9,
  flood: 7,
  coastal: 6,
  winter: 5,
  fire: 5,
  heat: 4,
  wind: 3,
  other: 0,
};

const parseNwsSeverity = (value: unknown): 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'extreme' || normalized === 'severe' || normalized === 'moderate' || normalized === 'minor') return normalized;
  return 'unknown';
};

const SEVERITY_STRENGTH: Record<string, number> = {
  extreme: 100,
  severe: 80,
  moderate: 55,
  minor: 30,
  unknown: 40,
};

const ringCentroid = (ring: unknown): [number, number] | null => {
  if (!Array.isArray(ring) || !ring.length) return null;
  let sumLon = 0;
  let sumLat = 0;
  let count = 0;
  for (const coord of ring) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    sumLon += lon;
    sumLat += lat;
    count += 1;
  }
  return count > 0 ? [sumLon / count, sumLat / count] : null;
};

export const geometryCentroid = (geometry: NwsGeometry | undefined): [number, number] | null => {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const lon = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return ringCentroid(geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const centroids = (geometry.coordinates as unknown[])
      .map((poly) => Array.isArray(poly) ? ringCentroid(poly[0]) : null)
      .filter((c): c is [number, number] => c !== null);
    if (!centroids.length) return null;
    const sum = centroids.reduce<[number, number]>(
      (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
      [0, 0],
    );
    return [sum[0] / centroids.length, sum[1] / centroids.length];
  }
  return null;
};

const runWithConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(Math.max(1, limit), items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    });
  await Promise.all(runners);
  return results;
};

const fetchNwsZoneCentroid = async (zoneUrl: string): Promise<[number, number] | null> => {
  const cacheKey = `nws-zone:${zoneUrl}`;
  const cached = getCached<[number, number] | 'missing'>(cacheKey, NWS_ZONE_CACHE_TTL_MS);
  if (cached === 'missing') return null;
  if (cached) return cached;
  try {
    const payload = await fetchNwsJsonDeduped<NwsZoneResponse>(new URL(zoneUrl));
    const centroid = geometryCentroid(payload.geometry);
    setCached(cacheKey, centroid || 'missing');
    return centroid;
  } catch {
    setCached(cacheKey, 'missing');
    return null;
  }
};

const buildNwsAlertEvent = (
  props: NonNullable<NwsAlertFeature['properties']>,
  lat: number,
  lon: number,
  code: StormEventCode,
): SkyContextEvent => {
  const occurredAt = typeof props.sent === 'string' ? new Date(props.sent).toISOString() : null;
  const expiresAt = typeof props.expires === 'string' ? new Date(props.expires).toISOString() : null;
  const severity = parseNwsSeverity(props.severity);
  const headline = String(props.headline || '').trim();
  const description = String(props.description || '').trim();
  const idSuffix = props.id || `${code}-${lat.toFixed(3)}-${lon.toFixed(3)}-${occurredAt || 'now'}`;
  return {
    id: `nws-${idSuffix}`,
    kind: 'storm',
    source: 'nws_alerts',
    label: props.event || 'Weather alert',
    description: (headline || description).slice(0, 260),
    lat,
    lon,
    occurred_at: occurredAt,
    forecast_at: expiresAt,
    strength: SEVERITY_STRENGTH[severity] ?? SEVERITY_STRENGTH.unknown,
    altitude_km: null,
    velocity_km_s: null,
    confidence: 0.92,
    live: true,
    historical: false,
    event_code: code,
    severity,
  };
};

export const parseNwsAlertsResponse = (
  payload: NwsAlertsResponse,
  bounds: SkyContextBounds,
): { withCentroid: SkyContextEvent[]; zoneDeferred: Array<{ zoneUrl: string; props: NonNullable<NwsAlertFeature['properties']>; code: StormEventCode }> } => {
  const features = Array.isArray(payload.features) ? payload.features : [];
  const withCentroid: SkyContextEvent[] = [];
  const zoneDeferred: Array<{ zoneUrl: string; props: NonNullable<NwsAlertFeature['properties']>; code: StormEventCode }> = [];
  for (const feature of features) {
    const props = feature.properties;
    if (!props || !props.event) continue;
    const code = classifyNwsEvent(props.event);
    if (!code) continue;
    const centroid = geometryCentroid(feature.geometry);
    if (centroid) {
      const [lon, lat] = centroid;
      if (!isWithinSkyContextBounds(lat, lon, bounds)) continue;
      withCentroid.push(buildNwsAlertEvent(props, lat, lon, code));
      continue;
    }
    const zoneUrl = Array.isArray(props.affectedZones) && typeof props.affectedZones[0] === 'string'
      ? props.affectedZones[0]
      : null;
    if (zoneUrl) zoneDeferred.push({ zoneUrl, props, code });
  }
  return { withCentroid, zoneDeferred };
};

const loadNwsActiveAlertsInner = async (params: LoadSkyContextEventsParams): Promise<SkyContextEvent[]> => {
  if (params.mode !== 'live') return [];
  const cacheKey = 'nws-alerts:active';
  let payload = getCached<NwsAlertsResponse>(cacheKey, NWS_ALERTS_CACHE_TTL_MS);
  if (!payload) {
    payload = await fetchNwsJsonDeduped<NwsAlertsResponse>(new URL(NWS_ALERTS_URL));
    setCached(cacheKey, payload);
  }

  const { withCentroid, zoneDeferred } = parseNwsAlertsResponse(payload, params.bounds);
  const boundedZones = zoneDeferred.slice(0, NWS_MAX_ZONES_PER_REQUEST);
  const zoneResolved = await runWithConcurrency(boundedZones, NWS_MAX_ZONE_CONCURRENCY, async (task) => {
    const centroid = await fetchNwsZoneCentroid(task.zoneUrl);
    if (!centroid) return null;
    const [lon, lat] = centroid;
    if (!isWithinSkyContextBounds(lat, lon, params.bounds)) return null;
    return buildNwsAlertEvent(task.props, lat, lon, task.code);
  });

  const events: SkyContextEvent[] = [...withCentroid];
  for (const event of zoneResolved) if (event) events.push(event);

  events.sort((a, b) => {
    const rankDiff = (SEVERITY_RANK[b.event_code || 'other'] || 0) - (SEVERITY_RANK[a.event_code || 'other'] || 0);
    if (rankDiff !== 0) return rankDiff;
    return String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''));
  });
  return events.slice(0, Math.min(Math.max(1, params.limit), 1500));
};

const loadNwsActiveAlerts = async (params: LoadSkyContextEventsParams): Promise<SkyContextEvent[]> => {
  try {
    return await withTimeout(loadNwsActiveAlertsInner(params), NWS_OVERALL_TIMEOUT_MS, 'nws_active_alerts');
  } catch {
    return [];
  }
};

const loadFireballs = async (params: LoadSkyContextEventsParams) => {
  const now = params.now || new Date();
  const start = new Date(now.getTime() - params.days * 24 * 60 * 60 * 1000);
  const cacheKey = `fireballs:${dateOnly(start)}:${dateOnly(now)}:${params.limit}`;
  const cached = getCached<FireballApiPayload>(cacheKey, FIREBALL_CACHE_TTL_MS);
  const payload = cached || await (async () => {
    const url = new URL(NASA_FIREBALL_URL);
    url.searchParams.set('date-min', dateOnly(start));
    url.searchParams.set('date-max', dateOnly(now));
    url.searchParams.set('req-loc', 'true');
    url.searchParams.set('limit', String(Math.min(2000, Math.max(params.limit, 200))));
    const next = await fetchJson<FireballApiPayload>(url);
    setCached(cacheKey, next);
    return next;
  })();
  return parseNasaFireballEvents(payload, params.bounds, params.mode).slice(0, params.limit);
};

const loadAurora = async (params: LoadSkyContextEventsParams) => {
  if (params.mode !== 'live') return [];
  const cacheKey = 'aurora:latest';
  const cached = getCached<AuroraOvationPayload>(cacheKey, AURORA_CACHE_TTL_MS);
  const payload = cached || await (async () => {
    const next = await fetchJson<AuroraOvationPayload>(new URL(NOAA_AURORA_URL));
    setCached(cacheKey, next);
    return next;
  })();
  return parseNoaaAuroraEvents(payload, params.bounds, Math.min(params.limit, 2500));
};

const loadStormEventsIndex = async (signal: AbortSignal) => {
  const cacheKey = 'noaa-storm-events:index';
  return loadCached(cacheKey, STORM_EVENTS_CACHE_TTL_MS,
    () => fetchText(new URL(NOAA_STORM_EVENTS_INDEX_URL), signal));
};

const findNoaaStormEventsFileForYear = (indexHtml: string, year: number) => {
  const pattern = new RegExp(`StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`, 'g');
  const matches = Array.from(indexHtml.matchAll(pattern)).map((match) => match[0]);
  const sorted = matches.sort();
  return sorted[sorted.length - 1] || null;
};

const loadStormEventsCatalogueForYear = async (year: number, indexHtml: string, signal: AbortSignal) => {
  const cacheKey = `noaa-storm-events:${year}`;
  const fileName = findNoaaStormEventsFileForYear(indexHtml, year);
  if (!fileName) return null;
  return loadCached(cacheKey, STORM_EVENTS_CACHE_TTL_MS, async () => {
    if ([...inFlightCache.keys()].filter(key => /^noaa-storm-events:\d{4}$/.test(key)).length >= 2) throw new Error('noaa_storm_catalogue_busy');
    return fetchStormCatalogue(new URL(fileName, NOAA_STORM_EVENTS_INDEX_URL), signal);
  });
};

const loadStormEvents = async (params: LoadSkyContextEventsParams) => {
  const signal = AbortSignal.timeout(SKY_CONTEXT_LAYER_TIMEOUT_MS);
  const now = params.now || new Date();
  const requestedSinceMs = now.getTime() - params.days * 24 * 60 * 60 * 1000;
  const currentYear = now.getUTCFullYear();
  const years: number[] = [];
  const earliestRelevantYear = params.mode === 'historical'
    ? Math.max(new Date(requestedSinceMs).getUTCFullYear(), currentYear - STORM_EVENTS_MAX_YEARS + 1)
    : currentYear - STORM_EVENTS_MAX_YEARS + 1;
  for (let year = currentYear; year >= earliestRelevantYear; year -= 1) {
    years.push(year);
  }

  const indexHtml = await loadStormEventsIndex(signal);
  const perYearLimit = Math.max(100, Math.ceil(params.limit / Math.max(1, years.length)));
  // NOAA storm-events CSVs lag real time by ~2–3 months, so the current-year
  // file is typically missing. In live mode, surface the most recent available
  // events even if they fall outside the requested `days` window — otherwise
  // the layer looks empty for the first quarter of every year.
  const parseSinceMs = params.mode === 'live' ? Number.NEGATIVE_INFINITY : requestedSinceMs;
  const yearResults: SkyContextEvent[][] = [];
  let failures = 0;
  for (const year of years) {
    signal.throwIfAborted();
    try {
      const events = await loadStormEventsCatalogueForYear(year, indexHtml, signal);
      if (!events) continue;
      yearResults.push(filterNoaaStormEvents(
        events, params.bounds, parseSinceMs, perYearLimit,
        params.mode === 'historical' ? now.getTime() : Number.POSITIVE_INFINITY,
      ));
    } catch { failures++; }
  }
  if (failures) throw new Error('noaa_storm_catalogue_unavailable');
  return yearResults
    .flat()
    .sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')))
    .slice(0, Math.max(1, params.limit));
};

const dedupeSkyContextEvents = (items: SkyContextEvent[]) => {
  const seen = new Set<string>();
  const out: SkyContextEvent[] = [];
  for (const item of items) {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const loadLiveStormEvents = async (params: LoadSkyContextEventsParams) => {
  const liveAlerts = await loadNwsActiveAlerts(params).catch(() => [] as SkyContextEvent[]);
  if (liveAlerts.length >= Math.min(params.limit, LIVE_STORM_FALLBACK_MIN)) {
    return liveAlerts.slice(0, params.limit);
  }

  const historicalFallback = await loadStormEvents({ ...params, mode: 'live' }).catch(() => [] as SkyContextEvent[]);
  return dedupeSkyContextEvents([...liveAlerts, ...historicalFallback])
    .sort((a, b) => {
      const strengthDiff = (b.strength || 0) - (a.strength || 0);
      if (strengthDiff !== 0) return strengthDiff;
      return String(b.occurred_at || b.forecast_at || '').localeCompare(String(a.occurred_at || a.forecast_at || ''));
    })
    .slice(0, params.limit);
};

export const loadSkyContextEvents = async (params: LoadSkyContextEventsParams) => {
  const layerSet = new Set(params.layers);
  const tasks: Array<Promise<SkyContextEvent[]>> = [];
  const taskNames: SkyContextLayer[] = [];

  if (layerSet.has('meteors')) {
    taskNames.push('meteors');
    tasks.push(withTimeout(loadFireballs(params), SKY_CONTEXT_LAYER_TIMEOUT_MS, 'sky_context_meteors'));
  }
  if (layerSet.has('aurora')) {
    taskNames.push('aurora');
    tasks.push(withTimeout(loadAurora(params), SKY_CONTEXT_LAYER_TIMEOUT_MS, 'sky_context_aurora'));
  }
  if (layerSet.has('storms')) {
    if (params.mode === 'live') {
      taskNames.push('storms');
      tasks.push(withTimeout(loadLiveStormEvents(params), SKY_CONTEXT_LAYER_TIMEOUT_MS, 'sky_context_storms'));
    } else {
      taskNames.push('storms');
      tasks.push(withTimeout(loadStormEvents(params), SKY_CONTEXT_LAYER_TIMEOUT_MS, 'sky_context_storms'));
    }
  }

  const settled = await Promise.allSettled(tasks);
  const degraded: string[] = [];
  const items: SkyContextEvent[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      degraded.push(taskNames[index]);
    }
  });

  return {
    items: items
      .sort((a, b) => {
        const strengthDiff = (b.strength || 0) - (a.strength || 0);
        if (strengthDiff !== 0) return strengthDiff;
        return String(b.occurred_at || b.forecast_at || '').localeCompare(String(a.occurred_at || a.forecast_at || ''));
      })
      .slice(0, params.limit),
    degraded,
  };
};
