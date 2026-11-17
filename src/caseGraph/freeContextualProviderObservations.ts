import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import type { AdsbLolArchiveTileResult } from '../workers/adsbLolSnapshotArchive';
import type { OpenSkyStateRow } from '../workers/openskyWorkerShared';
import type {
  CaseGraphExternalCorrelationGovernanceInspector,
} from './externalCorrelationProviderAdapters';
import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';

export const FREE_CONTEXTUAL_PROVIDER_OBSERVATIONS_VERSION =
  'free-contextual-provider-observations-v1' as const;

const ADSB_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const ADSB_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const ADSB_MAX_ROWS = 100_000;
const NOAA_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const NOAA_MAX_WINDOW_HOURS = 48;
const NOAA_MAX_LATITUDE_SPAN = 5;
const NOAA_MAX_LONGITUDE_SPAN = 5;
const NOAA_DATASET = 'local-climatological-data-v2';
const NOAA_DATA_TYPES = [
  'HourlyDryBulbTemperature',
  'HourlyDewPointTemperature',
  'HourlyRelativeHumidity',
  'HourlyWindDirection',
  'HourlyWindSpeed',
  'HourlyWindGustSpeed',
  'HourlyVisibility',
  'HourlyPresentWeatherType',
  'HourlySkyConditions',
  'HourlyPrecipitation',
  'HourlyStationPressure',
  'HourlySeaLevelPressure',
] as const;

const SHA256 = /^[a-f0-9]{64}$/;
const US_STATION = /^US[A-Z0-9]{9}$/;
const fail = (code: string): never => { throw new Error(code); };
const object = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') fail(code);
  const normalized = String(value).trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) fail(code);
  return normalized;
};
const optionalText = (value: unknown, maximum: number, code: string) => (
  value == null || String(value).trim() === '' ? null : text(String(value), maximum, code)
);
const finite = (value: unknown, code: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code);
  return number;
};
const iso = (value: unknown, code: string) => {
  const source = String(value);
  if (!/(?:z|[+-]\d{2}:\d{2})$/i.test(source)) fail(code);
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
};
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export type AdsbLolHistoricalArchiveCoverage = {
  snapshotTime: string;
  tileCount: number;
  successfulTileCount: number;
  failedTileCount: number;
  coverageFraction: number;
  complete: boolean;
  limitations: string[];
};

export type AdsbLolHistoricalArchive = {
  providerId: 'adsb-lol';
  datasetVersion: typeof FREE_CONTEXTUAL_PROVIDER_OBSERVATIONS_VERSION;
  sourceUrl: 'https://api.adsb.lol';
  license: 'ODbL-1.0';
  archiveSha256: string;
  rows: OpenSkyStateRow[];
  coverage: AdsbLolHistoricalArchiveCoverage;
};

const normalizeAdsbTileResult = (value: unknown): AdsbLolArchiveTileResult => {
  const raw = object(value, 'adsb_lol_archive_manifest_invalid');
  const label = text(raw.label, 240, 'adsb_lol_archive_manifest_invalid');
  if (typeof raw.ok !== 'boolean') fail('adsb_lol_archive_manifest_invalid');
  const rowCount = finite(raw.rowCount, 'adsb_lol_archive_manifest_invalid');
  const durationMs = finite(raw.durationMs, 'adsb_lol_archive_manifest_invalid');
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || !Number.isFinite(durationMs) || durationMs < 0) {
    fail('adsb_lol_archive_manifest_invalid');
  }
  return {
    label,
    ok: raw.ok as boolean,
    rowCount,
    durationMs,
    ...(raw.error == null ? {} : { error: text(raw.error, 1_000, 'adsb_lol_archive_manifest_invalid') }),
  };
};

const nullableFinite = (value: unknown, code: string): number | null => (
  value == null ? null : finite(value, code)
);

const nullableBoolean = (value: unknown, code: string): boolean | null => {
  if (value == null) return null;
  if (typeof value !== 'boolean') fail(code);
  return value as boolean;
};

const nullableDate = (value: unknown, code: string): Date | null => (
  value == null ? null : new Date(iso(value, code))
);

const normalizeAdsbRow = (value: unknown, snapshotTime: string): OpenSkyStateRow => {
  const raw = object(value, 'adsb_lol_archive_row_invalid');
  if (raw.record_type !== 'state') fail('adsb_lol_archive_row_invalid');
  const latitude = nullableFinite(raw.latitude, 'adsb_lol_archive_row_invalid');
  const longitude = nullableFinite(raw.longitude, 'adsb_lol_archive_row_invalid');
  if (latitude != null && (latitude < -90 || latitude > 90)
    || longitude != null && (longitude < -180 || longitude > 180)) {
    fail('adsb_lol_archive_row_invalid');
  }
  const rowSnapshot = nullableDate(raw.snapshot_time, 'adsb_lol_archive_row_invalid');
  if (!rowSnapshot || rowSnapshot.toISOString() !== snapshotTime) fail('adsb_lol_archive_row_invalid');
  const integerOrNull = (input: unknown) => {
    const value = nullableFinite(input, 'adsb_lol_archive_row_invalid');
    if (value != null && !Number.isSafeInteger(value)) fail('adsb_lol_archive_row_invalid');
    return value;
  };
  return {
    icao24: text(raw.icao24, 24, 'adsb_lol_archive_row_invalid').toLowerCase(),
    callsign: optionalText(raw.callsign, 80, 'adsb_lol_archive_row_invalid'),
    origin_country: optionalText(raw.origin_country, 160, 'adsb_lol_archive_row_invalid'),
    time_position: nullableDate(raw.time_position, 'adsb_lol_archive_row_invalid'),
    last_contact: nullableDate(raw.last_contact, 'adsb_lol_archive_row_invalid'),
    longitude,
    latitude,
    baro_altitude: nullableFinite(raw.baro_altitude, 'adsb_lol_archive_row_invalid'),
    on_ground: nullableBoolean(raw.on_ground, 'adsb_lol_archive_row_invalid'),
    velocity: nullableFinite(raw.velocity, 'adsb_lol_archive_row_invalid'),
    true_track: nullableFinite(raw.true_track, 'adsb_lol_archive_row_invalid'),
    vertical_rate: nullableFinite(raw.vertical_rate, 'adsb_lol_archive_row_invalid'),
    geo_altitude: nullableFinite(raw.geo_altitude, 'adsb_lol_archive_row_invalid'),
    squawk: optionalText(raw.squawk, 24, 'adsb_lol_archive_row_invalid'),
    spi: nullableBoolean(raw.spi, 'adsb_lol_archive_row_invalid'),
    position_source: integerOrNull(raw.position_source),
    category: integerOrNull(raw.category),
    snapshot_time: rowSnapshot,
    source: text(raw.source, 80, 'adsb_lol_archive_row_invalid'),
  };
};

/**
 * Decodes one immutable ADSB.lol snapshot produced by adsbLolSnapshotArchive.
 * It never calls the live API and refuses checksum, size, coverage and
 * timestamp drift so a current aircraft position cannot be applied to an old
 * sighting.
 */
export const decodeAdsbLolHistoricalArchive = (params: {
  archiveBody: Buffer;
  manifestBody: Buffer | string;
}): AdsbLolHistoricalArchive => {
  if (!Buffer.isBuffer(params.archiveBody) || params.archiveBody.length < 1
    || params.archiveBody.length > ADSB_MAX_COMPRESSED_BYTES) {
    fail('adsb_lol_archive_compressed_size_invalid');
  }
  const manifest = object(
    JSON.parse(Buffer.isBuffer(params.manifestBody) ? params.manifestBody.toString('utf8') : params.manifestBody),
    'adsb_lol_archive_manifest_invalid',
  );
  if (manifest.record_type !== 'manifest' || manifest.schema_version !== 1
    || manifest.provider !== 'adsblol' || manifest.source_url !== 'https://api.adsb.lol'
    || manifest.license !== 'ODbL-1.0') {
    fail('adsb_lol_archive_manifest_invalid');
  }
  const archiveSha256 = text(manifest.compressed_sha256, 64, 'adsb_lol_archive_manifest_invalid');
  if (!SHA256.test(archiveSha256) || archiveSha256 !== sha256(params.archiveBody)
    || finite(manifest.compressed_bytes, 'adsb_lol_archive_manifest_invalid') !== params.archiveBody.length) {
    fail('adsb_lol_archive_checksum_mismatch');
  }
  const snapshotTime = iso(manifest.snapshot_time, 'adsb_lol_archive_manifest_invalid');
  const rowCount = finite(manifest.row_count, 'adsb_lol_archive_manifest_invalid');
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > ADSB_MAX_ROWS) {
    fail('adsb_lol_archive_row_count_invalid');
  }
  const uncompressed = gunzipSync(params.archiveBody, { maxOutputLength: ADSB_MAX_UNCOMPRESSED_BYTES });
  if (finite(manifest.uncompressed_bytes, 'adsb_lol_archive_manifest_invalid') !== uncompressed.length) {
    fail('adsb_lol_archive_uncompressed_size_mismatch');
  }
  const lines = uncompressed.toString('utf8').trim().split('\n');
  if (lines.length !== rowCount + 1) fail('adsb_lol_archive_row_count_invalid');
  const embeddedManifest = object(JSON.parse(lines[0]), 'adsb_lol_archive_manifest_invalid');
  if (embeddedManifest.snapshot_time !== manifest.snapshot_time
    || embeddedManifest.row_count !== manifest.row_count
    || embeddedManifest.tile_count !== manifest.tile_count) {
    fail('adsb_lol_archive_manifest_mismatch');
  }
  if (!Array.isArray(manifest.tile_results)) fail('adsb_lol_archive_manifest_invalid');
  const tileResults = (manifest.tile_results as unknown[]).map(normalizeAdsbTileResult);
  const tileCount = finite(manifest.tile_count, 'adsb_lol_archive_manifest_invalid');
  const successfulTileCount = tileResults.filter(({ ok }) => ok).length;
  const failedTileCount = tileResults.length - successfulTileCount;
  if (!Number.isSafeInteger(tileCount) || tileCount !== tileResults.length
    || manifest.tile_success_count !== successfulTileCount
    || manifest.tile_failure_count !== failedTileCount) {
    fail('adsb_lol_archive_tile_accounting_invalid');
  }
  const rows = lines.slice(1).map((line) => normalizeAdsbRow(JSON.parse(line), snapshotTime));
  if (new Set(rows.map(({ icao24 }) => icao24)).size !== rows.length) {
    fail('adsb_lol_archive_duplicate_aircraft');
  }
  const coverageFraction = tileCount ? successfulTileCount / tileCount : 0;
  return {
    providerId: 'adsb-lol',
    datasetVersion: FREE_CONTEXTUAL_PROVIDER_OBSERVATIONS_VERSION,
    sourceUrl: 'https://api.adsb.lol',
    license: 'ODbL-1.0',
    archiveSha256,
    rows,
    coverage: {
      snapshotTime,
      tileCount,
      successfulTileCount,
      failedTileCount,
      coverageFraction,
      complete: tileCount > 0 && failedTileCount === 0,
      limitations: [
        'This is an immutable live-position snapshot, not complete retrospective flight history.',
        'Receiver coverage, blocked aircraft, outages and failed tiles can hide aircraft.',
        'No candidate in this snapshot does not rule out an aircraft.',
        ...(failedTileCount ? [`${failedTileCount} of ${tileCount} requested tiles failed.`] : []),
      ],
    },
  };
};

export type NoaaNceiUsObservationQuery = {
  start: string;
  end: string;
  north: number;
  west: number;
  south: number;
  east: number;
  dataTypes?: string[];
};

export type NoaaNceiUsObservation = {
  sourceRecordId: string;
  stationId: string;
  stationName: string | null;
  observedAt: string;
  latitude: number;
  longitude: number;
  measurements: Record<string, string | number | null>;
  sourceSha256: string;
};

export type NoaaNceiUsObservationResult = {
  providerId: 'noaa-ncei-us-observations';
  datasetVersion: 'local-climatological-data-v2';
  sourceUrl: string;
  acquiredAt: string;
  observations: NoaaNceiUsObservation[];
  excludedNonUsRows: number;
  limitations: string[];
};

const normalizeNoaaQuery = (input: NoaaNceiUsObservationQuery) => {
  const start = iso(input.start, 'noaa_ncei_query_invalid');
  const end = iso(input.end, 'noaa_ncei_query_invalid');
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const north = finite(input.north, 'noaa_ncei_query_invalid');
  const west = finite(input.west, 'noaa_ncei_query_invalid');
  const south = finite(input.south, 'noaa_ncei_query_invalid');
  const east = finite(input.east, 'noaa_ncei_query_invalid');
  if (startMs >= endMs || endMs - startMs > NOAA_MAX_WINDOW_HOURS * 3_600_000
    || south < -90 || north > 90 || west < -180 || east > 180
    || south >= north || west >= east || north - south > NOAA_MAX_LATITUDE_SPAN
    || east - west > NOAA_MAX_LONGITUDE_SPAN) {
    fail('noaa_ncei_query_invalid');
  }
  const allowed = new Set<string>(NOAA_DATA_TYPES);
  const dataTypes = [...new Set(input.dataTypes || NOAA_DATA_TYPES)].sort();
  if (!dataTypes.length || dataTypes.some((item) => !allowed.has(item))) fail('noaa_ncei_data_types_invalid');
  return { start, end, north, west, south, east, dataTypes };
};

export const buildNoaaNceiUsObservationUrl = (input: NoaaNceiUsObservationQuery) => {
  const query = normalizeNoaaQuery(input);
  const url = new URL('https://www.ncei.noaa.gov/access/services/data/v1');
  url.searchParams.set('dataset', NOAA_DATASET);
  url.searchParams.set('startDate', query.start);
  url.searchParams.set('endDate', query.end);
  url.searchParams.set('bbox', `${query.north},${query.west},${query.south},${query.east}`);
  url.searchParams.set('dataTypes', query.dataTypes.join(','));
  url.searchParams.set('format', 'json');
  url.searchParams.set('units', 'metric');
  url.searchParams.set('includeAttributes', 'true');
  url.searchParams.set('includeStationName', 'true');
  url.searchParams.set('includeStationLocation', 'true');
  return url.toString();
};

const noaaField = (
  row: Record<string, unknown>,
  ...names: string[]
) => names.map((name) => row[name]).find((value) => value != null);

const parseNoaaMeasurement = (value: unknown): string | number | null => {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : normalized.slice(0, 500);
};

export const decodeNoaaNceiUsObservationResponse = (params: {
  body: string;
  sourceUrl: string;
  acquiredAt: string;
}): NoaaNceiUsObservationResult => {
  if (Buffer.byteLength(params.body, 'utf8') > NOAA_MAX_RESPONSE_BYTES) {
    fail('noaa_ncei_response_too_large');
  }
  const parsed = JSON.parse(params.body) as unknown;
  if (!Array.isArray(parsed)) fail('noaa_ncei_response_invalid');
  const acquiredAt = iso(params.acquiredAt, 'noaa_ncei_response_invalid');
  const observations: NoaaNceiUsObservation[] = [];
  let excludedNonUsRows = 0;
  for (const value of parsed as unknown[]) {
    const row = object(value, 'noaa_ncei_response_invalid');
    const stationId = text(
      noaaField(row, 'STATION', 'station') as unknown,
      80,
      'noaa_ncei_response_invalid',
    ).toUpperCase();
    if (!US_STATION.test(stationId)) {
      excludedNonUsRows += 1;
      continue;
    }
    const observedAt = iso(
      noaaField(row, 'DATE', 'date'),
      'noaa_ncei_response_invalid',
    );
    const latitude = finite(
      noaaField(row, 'LATITUDE', 'latitude'),
      'noaa_ncei_response_invalid',
    );
    const longitude = finite(
      noaaField(row, 'LONGITUDE', 'longitude'),
      'noaa_ncei_response_invalid',
    );
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      fail('noaa_ncei_response_invalid');
    }
    const measurements = Object.fromEntries(NOAA_DATA_TYPES.map((name) => [
      name,
      parseNoaaMeasurement(row[name]),
    ]));
    const sourceSha256 = sha256(JSON.stringify(row));
    observations.push({
      sourceRecordId: `noaa-lcdv2:${stationId}:${observedAt}:${sourceSha256.slice(0, 16)}`,
      stationId,
      stationName: optionalText(noaaField(row, 'NAME', 'name'), 500, 'noaa_ncei_response_invalid'),
      observedAt,
      latitude,
      longitude,
      measurements,
      sourceSha256,
    });
  }
  observations.sort((left, right) => (
    left.observedAt.localeCompare(right.observedAt)
    || left.stationId.localeCompare(right.stationId)
    || left.sourceRecordId.localeCompare(right.sourceRecordId)
  ));
  if (new Set(observations.map(({ sourceRecordId }) => sourceRecordId)).size !== observations.length) {
    fail('noaa_ncei_response_duplicate_observation');
  }
  return {
    providerId: 'noaa-ncei-us-observations',
    datasetVersion: NOAA_DATASET,
    sourceUrl: params.sourceUrl,
    acquiredAt,
    observations,
    excludedNonUsRows,
    limitations: [
      'LCDv2 is station-based and does not provide complete conditions at the sighting location.',
      'LCDv2 coverage is primarily 2005 onward; older sightings are not covered by this adapter.',
      'Stations have different variables, observation cadence, periods of record and data gaps.',
      'No matching observation is not proof of clear weather or absence of a weather explanation.',
      ...(excludedNonUsRows ? [`${excludedNonUsRows} non-U.S. station row(s) were excluded.`] : []),
    ],
  };
};

const readBoundedResponse = async (response: Response) => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > NOAA_MAX_RESPONSE_BYTES) {
    fail('noaa_ncei_response_too_large');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > NOAA_MAX_RESPONSE_BYTES) fail('noaa_ncei_response_too_large');
  return body;
};

/**
 * Performs the NOAA request only after both the signed research decision and
 * live legal-registry row approve the exact derived-only source. Tests inject
 * fetch; production callers cannot bypass the two checks through this entry.
 */
export const fetchGovernedNoaaNceiUsObservations = async (params: {
  query: NoaaNceiUsObservationQuery;
  checkedAt: string;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<NoaaNceiUsObservationResult> => {
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const checkedAt = iso(params.checkedAt, 'noaa_ncei_query_invalid');
  const packet = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  const decision = packet.entries.find((entry) => (
    entry.category === 'weather'
    && entry.canonicalSource === 'NOAA_NCEI_US_OBSERVATIONS'
    && entry.providerId === 'noaa-ncei-us-observations'
    && entry.requiredContentMode === 'derived_only'
  ));
  const checkedAtMs = Date.parse(checkedAt);
  const referenceAtMs = Date.parse(packet.referenceAt);
  if (!decision || !decision.usableNow || checkedAtMs < referenceAtMs
    || checkedAtMs - referenceAtMs > packet.maximumEvidenceAgeDays * 86_400_000) {
    fail('noaa_ncei_source_decision_not_approved');
  }
  const governance = await params.inspectGovernance({
    canonicalSource: 'NOAA_NCEI_US_OBSERVATIONS',
    category: 'weather',
    signal: params.signal,
  });
  if (!governance.present
    || governance.canonicalSource.trim().toUpperCase() !== 'NOAA_NCEI_US_OBSERVATIONS'
    || governance.legalStatus.trim().toLowerCase() !== 'approved'
    || !(governance.allowedContentModes || []).map((mode) => mode.toLowerCase()).includes('derived_only')) {
    fail('noaa_ncei_source_registry_not_approved');
  }
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const sourceUrl = buildNoaaNceiUsObservationUrl(params.query);
  const timeoutMs = Math.max(1_000, Math.min(30_000, params.timeoutMs ?? 10_000));
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (params.fetchImpl || fetch)(sourceUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'UAPFilesLive/1.0 (+https://uapfileslive.com)',
      },
      signal,
    });
  } catch (error) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    if (timeout.aborted) fail('noaa_ncei_request_timeout');
    throw error;
  }
  if (!response.ok) fail(`noaa_ncei_http_${response.status}`);
  return decodeNoaaNceiUsObservationResponse({
    body: await readBoundedResponse(response),
    sourceUrl,
    acquiredAt: checkedAt,
  });
};
