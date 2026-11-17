import { createHash } from 'node:crypto';

import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from './archiveTypes';
import type { ContextualProviderPublicationSighting } from './aircraftWeatherProviderRecords';
import {
  buildNoaaNceiUsObservationUrl,
  type NoaaNceiUsObservationQuery,
  type NoaaNceiUsObservationResult,
} from './freeContextualProviderObservations';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const NOAA_CONTEXTUAL_ACQUISITION_VERSION = 'noaa-contextual-acquisition-v1' as const;

const DAY_MS = 86_400_000;
const NOAA_LCDV2_COVERAGE_START_MS = Date.parse('2005-01-01T00:00:00.000Z');
const MAX_PLAN_NODES = 1_000_000;
const MAX_PLAN_WINDOWS = 1_000_000;
const MAX_WINDOWS_PER_RUN = 10_000;
const MAX_WINDOW_ARTIFACT_BYTES = 16 * 1024 * 1024 + 1024 * 1024;
const NOAA_PROVIDER_DAILY_CALL_LIMIT = 10_000;
const NOAA_PROVIDER_MINIMUM_INTERVAL_MS = 200;
const NOAA_PROVIDER_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left.localeCompare(right);
const iso = (value: unknown, code: string) => {
  const source = String(value);
  if (!/(?:z|[+-]\d{2}:\d{2})$/i.test(source)) fail(code);
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
};
const finite = (value: unknown, code: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code);
  return number;
};
const canonicalBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
const sha256Bytes = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('case_graph_research_aborted'));
    return;
  }
  const timeout = setTimeout(() => {
    signal?.removeEventListener('abort', abort);
    resolve();
  }, milliseconds);
  const abort = () => {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    reject(new Error('case_graph_research_aborted'));
  };
  signal?.addEventListener('abort', abort, { once: true });
});

export type NoaaContextualAcquisitionExclusionReason =
  | 'sighting_time_missing'
  | 'sighting_location_missing'
  | 'outside_noaa_us_geography'
  | 'outside_lcdv2_period'
  | 'future_dated';

export type NoaaContextualAcquisitionWindow = {
  ordinal: number;
  windowId: string;
  query: NoaaNceiUsObservationQuery;
  sourceUrl: string;
  addresses: string[];
  windowDigest: string;
};

export type NoaaContextualAcquisitionPlan = {
  recordType: 'noaa_contextual_acquisition_plan';
  schemaVersion: typeof NOAA_CONTEXTUAL_ACQUISITION_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  plannedAt: string;
  checkedAt: string;
  windows: NoaaContextualAcquisitionWindow[];
  excluded: Array<{
    address: string;
    reason: NoaaContextualAcquisitionExclusionReason;
  }>;
  accounting: {
    inputAddressCount: number;
    plannedAddressCount: number;
    excludedAddressCount: number;
    windowCount: number;
    estimatedProviderCalls: number;
    minimumDaysAtDailyLimit: number;
    providerDailyLimit: 10_000;
    providerRequestsPerSecondLimit: 5;
  };
  limitations: string[];
  planDigest: string;
};

export type NoaaContextualAcquisitionWindowReceipt = {
  ordinal: number;
  windowId: string;
  windowDigest: string;
  artifactKey: string;
  artifactSha256: string;
  artifactBytes: number;
  observationCount: number;
  excludedNonUsRows: number;
  acquiredAt: string;
  receiptDigest: string;
};

export type NoaaContextualAcquisitionCheckpoint = {
  recordType: 'noaa_contextual_acquisition_checkpoint';
  schemaVersion: typeof NOAA_CONTEXTUAL_ACQUISITION_VERSION;
  planDigest: string;
  status: 'processing' | 'complete';
  nextOrdinal: number;
  providerCalls: number;
  observationCount: number;
  excludedNonUsRows: number;
  receipts: NoaaContextualAcquisitionWindowReceipt[];
  updatedAt: string;
  checkpointDigest: string;
};

export type NoaaContextualAcquisitionCompletion = {
  recordType: 'noaa_contextual_acquisition_completion';
  schemaVersion: typeof NOAA_CONTEXTUAL_ACQUISITION_VERSION;
  planDigest: string;
  checkpointDigest: string;
  windowCount: number;
  providerCalls: number;
  observationCount: number;
  excludedNonUsRows: number;
  receiptSetSha256: string;
  completedAt: string;
  completionDigest: string;
};

export type NoaaContextualAcquisitionRateLedger = {
  recordType: 'noaa_contextual_acquisition_rate_ledger';
  schemaVersion: typeof NOAA_CONTEXTUAL_ACQUISITION_VERSION;
  utcDate: string;
  callCount: number;
  lastReservedAt: string;
  updatedAt: string;
  ledgerDigest: string;
};

export type NoaaContextualAcquisitionWindowArtifact = {
  recordType: 'noaa_contextual_acquisition_window';
  schemaVersion: typeof NOAA_CONTEXTUAL_ACQUISITION_VERSION;
  planDigest: string;
  window: NoaaContextualAcquisitionWindow;
  result: NoaaNceiUsObservationResult;
  artifactDigest: string;
};

const US_REGIONS = [
  { south: 24, north: 50, west: -125, east: -66 }, // contiguous states
  { south: 51, north: 72, west: -180, east: -129 }, // Alaska
  { south: 18, north: 23, west: -161, east: -154 }, // Hawaii
  { south: 17, north: 20, west: -68, east: -64 }, // Puerto Rico / USVI
  { south: 13, north: 22, west: 143, east: 146 }, // Guam / CNMI
  { south: -15, north: -10, west: -172, east: -168 }, // American Samoa
] as const;

const insideUsRegion = (latitude: number, longitude: number) => US_REGIONS.some((region) => (
  latitude >= region.south && latitude <= region.north
  && longitude >= region.west && longitude <= region.east
));

const cellBounds = (latitude: number, longitude: number) => {
  const cellSouth = Math.floor(latitude / 2) * 2;
  const cellWest = Math.floor(longitude / 2) * 2;
  return {
    south: Math.max(-90, cellSouth - 0.75),
    north: Math.min(90, cellSouth + 2.75),
    west: Math.max(-180, cellWest - 0.75),
    east: Math.min(180, cellWest + 2.75),
  };
};

const normalizePublication = (publication: CaseGraphResearchPublicationBinding) => {
  if (!UUID.test(publication.publicationId) || !SHA256.test(publication.manifestSha256)) {
    fail('noaa_acquisition_publication_invalid');
  }
  return structuredClone(publication);
};

const windowCore = (value: Omit<NoaaContextualAcquisitionWindow, 'windowDigest'>) => value;
const buildWindow = (
  value: Omit<NoaaContextualAcquisitionWindow, 'windowDigest'>,
): NoaaContextualAcquisitionWindow => ({
  ...value,
  windowDigest: relationshipInputSha256(windowCore(value)),
});

const planCore = (value: Omit<NoaaContextualAcquisitionPlan, 'planDigest'>) => value;
const checkpointCore = (
  value: Omit<NoaaContextualAcquisitionCheckpoint, 'checkpointDigest'>,
) => value;
const completionCore = (
  value: Omit<NoaaContextualAcquisitionCompletion, 'completionDigest'>,
) => value;
const rateLedgerCore = (
  value: Omit<NoaaContextualAcquisitionRateLedger, 'ledgerDigest'>,
) => value;
const artifactCore = (
  value: Omit<NoaaContextualAcquisitionWindowArtifact, 'artifactDigest'>,
) => value;

export const planNoaaContextualAcquisition = (params: {
  publication: CaseGraphResearchPublicationBinding;
  sightings: ContextualProviderPublicationSighting[];
  checkedAt: string;
  plannedAt: string;
}): NoaaContextualAcquisitionPlan => {
  if (!params.sightings.length || params.sightings.length > MAX_PLAN_NODES
    || new Set(params.sightings.map(({ address }) => address)).size !== params.sightings.length) {
    fail('noaa_acquisition_plan_input_invalid');
  }
  const publication = normalizePublication(params.publication);
  const checkedAt = iso(params.checkedAt, 'noaa_acquisition_plan_time_invalid');
  const plannedAt = iso(params.plannedAt, 'noaa_acquisition_plan_time_invalid');
  if (Date.parse(plannedAt) < Date.parse(checkedAt)) fail('noaa_acquisition_plan_time_invalid');
  const excluded: NoaaContextualAcquisitionPlan['excluded'] = [];
  const groups = new Map<string, {
    start: string;
    end: string;
    bounds: ReturnType<typeof cellBounds>;
    addresses: string[];
  }>();
  for (const sighting of [...params.sightings].sort((left, right) => compare(left.address, right.address))) {
    if (!sighting.eventTimestamp) {
      excluded.push({ address: sighting.address, reason: 'sighting_time_missing' });
      continue;
    }
    if (sighting.latitude == null || sighting.longitude == null) {
      excluded.push({ address: sighting.address, reason: 'sighting_location_missing' });
      continue;
    }
    const latitude = finite(sighting.latitude, 'noaa_acquisition_sighting_invalid');
    const longitude = finite(sighting.longitude, 'noaa_acquisition_sighting_invalid');
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      fail('noaa_acquisition_sighting_invalid');
    }
    const eventAt = iso(sighting.eventTimestamp, 'noaa_acquisition_sighting_invalid');
    const eventMs = Date.parse(eventAt);
    if (eventMs < NOAA_LCDV2_COVERAGE_START_MS) {
      excluded.push({ address: sighting.address, reason: 'outside_lcdv2_period' });
      continue;
    }
    if (eventMs > Date.parse(checkedAt)) {
      excluded.push({ address: sighting.address, reason: 'future_dated' });
      continue;
    }
    if (!insideUsRegion(latitude, longitude)) {
      excluded.push({ address: sighting.address, reason: 'outside_noaa_us_geography' });
      continue;
    }
    const dayStartMs = Math.floor(eventMs / DAY_MS) * DAY_MS;
    const start = new Date(dayStartMs).toISOString();
    const end = new Date(dayStartMs + DAY_MS).toISOString();
    const bounds = cellBounds(latitude, longitude);
    const key = `${start}:${bounds.south}:${bounds.west}`;
    const group = groups.get(key);
    if (group) group.addresses.push(sighting.address);
    else groups.set(key, { start, end, bounds, addresses: [sighting.address] });
  }
  if (groups.size > MAX_PLAN_WINDOWS) fail('noaa_acquisition_plan_too_large');
  const windows = [...groups.values()].sort((left, right) => (
    compare(left.start, right.start)
    || left.bounds.south - right.bounds.south
    || left.bounds.west - right.bounds.west
  )).map((group, ordinal) => {
    const query: NoaaNceiUsObservationQuery = {
      start: group.start,
      end: group.end,
      north: group.bounds.north,
      west: group.bounds.west,
      south: group.bounds.south,
      east: group.bounds.east,
    };
    const addresses = [...group.addresses].sort(compare);
    const identity = relationshipInputSha256({ query, addresses });
    return buildWindow({
      ordinal,
      windowId: `noaa-window:${identity}`,
      query,
      sourceUrl: buildNoaaNceiUsObservationUrl(query),
      addresses,
    });
  });
  const plannedAddressCount = windows.reduce((sum, window) => sum + window.addresses.length, 0);
  const accounting = {
    inputAddressCount: params.sightings.length,
    plannedAddressCount,
    excludedAddressCount: excluded.length,
    windowCount: windows.length,
    estimatedProviderCalls: windows.length,
    minimumDaysAtDailyLimit: Math.ceil(windows.length / 10_000),
    providerDailyLimit: 10_000 as const,
    providerRequestsPerSecondLimit: 5 as const,
  };
  if (plannedAddressCount + excluded.length !== params.sightings.length) {
    fail('noaa_acquisition_plan_accounting_invalid');
  }
  const core: Omit<NoaaContextualAcquisitionPlan, 'planDigest'> = {
    recordType: 'noaa_contextual_acquisition_plan',
    schemaVersion: NOAA_CONTEXTUAL_ACQUISITION_VERSION,
    publication,
    plannedAt,
    checkedAt,
    windows,
    excluded,
    accounting,
    limitations: [
      'The U.S. geography gate is a conservative region envelope; station rows are still filtered to U.S. GHCN identities.',
      'LCDv2 is primarily available from 2005 onward and cannot cover older sightings.',
      'Each planned request is one UTC day and one 3.5-degree cell; nearby station coverage can still be absent.',
      'The plan authorizes no provider, storage, database, Luna, publication or deployment operation.',
    ],
  };
  return { ...core, planDigest: relationshipInputSha256(planCore(core)) };
};

export const getNoaaContextualAcquisitionKeys = (planDigest: string) => {
  if (!SHA256.test(planDigest)) fail('noaa_acquisition_plan_digest_invalid');
  const prefix = `case-vortex/external-providers/acquisition/noaa/${planDigest}/`;
  return {
    prefix,
    planKey: `${prefix}plan.json`,
    checkpointKey: `${prefix}checkpoint.json`,
    completionKey: `${prefix}completion.json`,
    rateLedgerKey: (utcDate: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) fail('noaa_acquisition_rate_date_invalid');
      return `case-vortex/external-providers/acquisition/noaa/rate/${utcDate}.json`;
    },
    windowKey: (window: NoaaContextualAcquisitionWindow) => (
      `${prefix}windows/${String(window.ordinal).padStart(6, '0')}-${window.windowDigest}.json`
    ),
  };
};

const buildCheckpoint = (params: Omit<
  NoaaContextualAcquisitionCheckpoint,
  'recordType' | 'schemaVersion' | 'checkpointDigest'
>): NoaaContextualAcquisitionCheckpoint => {
  const core: Omit<NoaaContextualAcquisitionCheckpoint, 'checkpointDigest'> = {
    recordType: 'noaa_contextual_acquisition_checkpoint',
    schemaVersion: NOAA_CONTEXTUAL_ACQUISITION_VERSION,
    ...params,
  };
  return { ...core, checkpointDigest: relationshipInputSha256(checkpointCore(core)) };
};

const buildArtifact = (params: {
  plan: NoaaContextualAcquisitionPlan;
  window: NoaaContextualAcquisitionWindow;
  result: NoaaNceiUsObservationResult;
}): NoaaContextualAcquisitionWindowArtifact => {
  if (params.result.providerId !== 'noaa-ncei-us-observations'
    || params.result.datasetVersion !== 'local-climatological-data-v2'
    || params.result.sourceUrl !== params.window.sourceUrl
    || params.result.observations.some((observation) => (
      Date.parse(observation.observedAt) < Date.parse(params.window.query.start)
      || Date.parse(observation.observedAt) > Date.parse(params.window.query.end)
      || observation.latitude < params.window.query.south
      || observation.latitude > params.window.query.north
      || observation.longitude < params.window.query.west
      || observation.longitude > params.window.query.east
    ))) {
    fail('noaa_acquisition_window_result_invalid');
  }
  const core: Omit<NoaaContextualAcquisitionWindowArtifact, 'artifactDigest'> = {
    recordType: 'noaa_contextual_acquisition_window',
    schemaVersion: NOAA_CONTEXTUAL_ACQUISITION_VERSION,
    planDigest: params.plan.planDigest,
    window: params.window,
    result: params.result,
  };
  return { ...core, artifactDigest: relationshipInputSha256(artifactCore(core)) };
};

const receiptSetSha256 = (receipts: NoaaContextualAcquisitionWindowReceipt[]) => (
  relationshipInputSha256(receipts.map(({ ordinal, receiptDigest }) => ({ ordinal, receiptDigest })))
);

const buildCompletion = (
  checkpoint: NoaaContextualAcquisitionCheckpoint,
  completedAt: string,
): NoaaContextualAcquisitionCompletion => {
  if (checkpoint.status !== 'complete') fail('noaa_acquisition_checkpoint_incomplete');
  const core: Omit<NoaaContextualAcquisitionCompletion, 'completionDigest'> = {
    recordType: 'noaa_contextual_acquisition_completion',
    schemaVersion: NOAA_CONTEXTUAL_ACQUISITION_VERSION,
    planDigest: checkpoint.planDigest,
    checkpointDigest: checkpoint.checkpointDigest,
    windowCount: checkpoint.receipts.length,
    providerCalls: checkpoint.providerCalls,
    observationCount: checkpoint.observationCount,
    excludedNonUsRows: checkpoint.excludedNonUsRows,
    receiptSetSha256: receiptSetSha256(checkpoint.receipts),
    completedAt: iso(completedAt, 'noaa_acquisition_completion_time_invalid'),
  };
  return { ...core, completionDigest: relationshipInputSha256(completionCore(core)) };
};

const immutableOptions = (body: Buffer) => ({
  contentType: 'application/json',
  cacheControl: 'private, max-age=31536000, immutable',
  contentLength: body.length,
});
const checkpointOptions = (body: Buffer) => ({
  contentType: 'application/json',
  cacheControl: 'private, no-store',
  contentLength: body.length,
});

const putImmutable = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
  body: Buffer,
) => {
  const result = await storage.uploadFileConditional(body, key, immutableOptions(body), { ifAbsent: true });
  if (result.status === 'precondition_failed') {
    const existing = await storage.readObject(key, { maxBytes: body.length + 1 });
    if (!existing?.equals(body)) fail('noaa_acquisition_immutable_conflict');
    return;
  }
  const stored = await storage.readObject(key, { maxBytes: body.length + 1 });
  if (!stored?.equals(body)) fail('noaa_acquisition_read_after_write_failed');
};

const putCheckpoint = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  key: string;
  checkpoint: NoaaContextualAcquisitionCheckpoint;
  priorVersion: string | null;
}): Promise<CaseGraphVersionedArchiveObject> => {
  const body = canonicalBody(params.checkpoint);
  const result = await params.storage.uploadFileConditional(
    body,
    params.key,
    checkpointOptions(body),
    params.priorVersion ? { ifVersion: params.priorVersion } : { ifAbsent: true },
  );
  if (result.status === 'precondition_failed') fail('noaa_acquisition_checkpoint_conflict');
  const written = result as Extract<typeof result, { status: 'written' }>;
  const current = await params.storage.readObjectVersioned(params.key);
  if (!current || current.version !== written.version || !current.body.equals(body)) {
    fail('noaa_acquisition_checkpoint_read_after_write_failed');
  }
  return current as CaseGraphVersionedArchiveObject;
};

const buildRateLedger = (params: Omit<
  NoaaContextualAcquisitionRateLedger,
  'recordType' | 'schemaVersion' | 'ledgerDigest'
>): NoaaContextualAcquisitionRateLedger => {
  const core: Omit<NoaaContextualAcquisitionRateLedger, 'ledgerDigest'> = {
    recordType: 'noaa_contextual_acquisition_rate_ledger',
    schemaVersion: NOAA_CONTEXTUAL_ACQUISITION_VERSION,
    ...params,
  };
  return { ...core, ledgerDigest: relationshipInputSha256(rateLedgerCore(core)) };
};

const decodeRateLedger = (
  body: Buffer,
  utcDate: string,
): NoaaContextualAcquisitionRateLedger => {
  if (body.length > 64 * 1024) fail('noaa_acquisition_rate_ledger_invalid');
  const raw = parseJson(body, 'noaa_acquisition_rate_ledger_invalid') as Partial<
    NoaaContextualAcquisitionRateLedger
  >;
  if (!raw || raw.recordType !== 'noaa_contextual_acquisition_rate_ledger'
    || raw.schemaVersion !== NOAA_CONTEXTUAL_ACQUISITION_VERSION
    || raw.utcDate !== utcDate || !Number.isSafeInteger(raw.callCount)
    || Number(raw.callCount) < 1 || Number(raw.callCount) > NOAA_PROVIDER_DAILY_CALL_LIMIT
    || typeof raw.lastReservedAt !== 'string' || typeof raw.updatedAt !== 'string') {
    fail('noaa_acquisition_rate_ledger_invalid');
  }
  const lastReservedAt = iso(raw.lastReservedAt, 'noaa_acquisition_rate_ledger_invalid');
  const updatedAt = iso(raw.updatedAt, 'noaa_acquisition_rate_ledger_invalid');
  if (lastReservedAt.slice(0, 10) !== utcDate || updatedAt !== lastReservedAt) {
    fail('noaa_acquisition_rate_ledger_invalid');
  }
  const rebuilt = buildRateLedger({
    utcDate,
    callCount: raw.callCount as number,
    lastReservedAt,
    updatedAt,
  });
  if (raw.ledgerDigest !== rebuilt.ledgerDigest || !body.equals(canonicalBody(rebuilt))) {
    fail('noaa_acquisition_rate_ledger_invalid');
  }
  return rebuilt;
};

const reserveNoaaProviderCall = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  keys: ReturnType<typeof getNoaaContextualAcquisitionKeys>;
  now: () => string;
  signal?: AbortSignal;
}): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    let reservedAt = iso(params.now(), 'noaa_acquisition_provider_clock_invalid');
    const utcDate = reservedAt.slice(0, 10);
    const key = params.keys.rateLedgerKey(utcDate);
    const current = await params.storage.readObjectVersioned(key);
    const ledger = current ? decodeRateLedger(current.body, utcDate) : null;
    if (ledger?.callCount === NOAA_PROVIDER_DAILY_CALL_LIMIT) {
      fail('noaa_acquisition_provider_daily_limit_reached');
    }
    if (ledger) {
      const elapsed = Date.parse(reservedAt) - Date.parse(ledger.lastReservedAt);
      if (!Number.isFinite(elapsed) || elapsed < 0) {
        fail('noaa_acquisition_provider_clock_invalid');
      }
      if (elapsed < NOAA_PROVIDER_MINIMUM_INTERVAL_MS) {
        await wait(NOAA_PROVIDER_MINIMUM_INTERVAL_MS - elapsed, params.signal);
        reservedAt = iso(params.now(), 'noaa_acquisition_provider_clock_invalid');
        if (reservedAt.slice(0, 10) !== utcDate) continue;
        if (Date.parse(reservedAt) - Date.parse(ledger.lastReservedAt)
          < NOAA_PROVIDER_MINIMUM_INTERVAL_MS) {
          fail('noaa_acquisition_provider_cadence_not_observed');
        }
      }
    }
    const next = buildRateLedger({
      utcDate,
      callCount: (ledger?.callCount || 0) + 1,
      lastReservedAt: reservedAt,
      updatedAt: reservedAt,
    });
    const body = canonicalBody(next);
    const result = await params.storage.uploadFileConditional(
      body,
      key,
      checkpointOptions(body),
      current ? { ifVersion: current.version } : { ifAbsent: true },
    );
    if (result.status === 'precondition_failed') continue;
    const stored = await params.storage.readObjectVersioned(key);
    if (!stored || stored.version !== result.version || !stored.body.equals(body)) {
      fail('noaa_acquisition_rate_ledger_read_after_write_failed');
    }
    decodeRateLedger((stored as CaseGraphVersionedArchiveObject).body, utcDate);
    return reservedAt;
  }
  return fail('noaa_acquisition_rate_ledger_conflict');
};

const parseJson = (body: Buffer, code: string): unknown => {
  try { return JSON.parse(body.toString('utf8')); } catch { fail(code); }
};

const decodeWindow = (value: unknown): NoaaContextualAcquisitionWindow => {
  const raw = value as Partial<NoaaContextualAcquisitionWindow>;
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.ordinal)
    || typeof raw.windowId !== 'string' || !Array.isArray(raw.addresses)
    || typeof raw.sourceUrl !== 'string' || !raw.query || typeof raw.windowDigest !== 'string') {
    fail('noaa_acquisition_window_invalid');
  }
  const ordinal = raw.ordinal as number;
  const windowId = raw.windowId as string;
  const query = raw.query as NoaaNceiUsObservationQuery;
  const sourceUrl = raw.sourceUrl as string;
  const addresses = raw.addresses as string[];
  const rebuilt = buildWindow({
    ordinal,
    windowId,
    query,
    sourceUrl,
    addresses,
  });
  if (rebuilt.windowDigest !== raw.windowDigest
    || rebuilt.sourceUrl !== buildNoaaNceiUsObservationUrl(rebuilt.query)) {
    fail('noaa_acquisition_window_invalid');
  }
  return rebuilt;
};

export const decodeNoaaContextualAcquisitionPlan = (
  input: Buffer | string | NoaaContextualAcquisitionPlan,
): NoaaContextualAcquisitionPlan => {
  const raw = (Buffer.isBuffer(input) ? parseJson(input, 'noaa_acquisition_plan_invalid')
    : typeof input === 'string' ? JSON.parse(input) : input) as Partial<NoaaContextualAcquisitionPlan>;
  if (!raw || raw.recordType !== 'noaa_contextual_acquisition_plan'
    || raw.schemaVersion !== NOAA_CONTEXTUAL_ACQUISITION_VERSION || !Array.isArray(raw.windows)
    || !Array.isArray(raw.excluded) || !raw.accounting || !Array.isArray(raw.limitations)) {
    fail('noaa_acquisition_plan_invalid');
  }
  const windows = (raw.windows as unknown[]).map(decodeWindow);
  const core = {
    recordType: raw.recordType,
    schemaVersion: raw.schemaVersion,
    publication: normalizePublication(raw.publication!),
    plannedAt: iso(raw.plannedAt, 'noaa_acquisition_plan_invalid'),
    checkedAt: iso(raw.checkedAt, 'noaa_acquisition_plan_invalid'),
    windows,
    excluded: raw.excluded as NoaaContextualAcquisitionPlan['excluded'],
    accounting: raw.accounting as NoaaContextualAcquisitionPlan['accounting'],
    limitations: raw.limitations as string[],
  } as Omit<NoaaContextualAcquisitionPlan, 'planDigest'>;
  const rebuilt = { ...core, planDigest: relationshipInputSha256(planCore(core)) };
  if (raw.planDigest !== rebuilt.planDigest
    || windows.some((window, ordinal) => window.ordinal !== ordinal)
    || rebuilt.accounting.windowCount !== windows.length
    || rebuilt.accounting.plannedAddressCount
      !== windows.reduce((sum, window) => sum + window.addresses.length, 0)
    || rebuilt.accounting.excludedAddressCount !== rebuilt.excluded.length
    || rebuilt.accounting.inputAddressCount
      !== rebuilt.accounting.plannedAddressCount + rebuilt.accounting.excludedAddressCount) {
    fail('noaa_acquisition_plan_invalid');
  }
  return rebuilt;
};

const decodeReceipt = (value: unknown): NoaaContextualAcquisitionWindowReceipt => {
  const raw = value as Partial<NoaaContextualAcquisitionWindowReceipt>;
  if (!raw || !Number.isSafeInteger(raw.ordinal) || typeof raw.windowId !== 'string'
    || !SHA256.test(String(raw.windowDigest)) || typeof raw.artifactKey !== 'string'
    || !SHA256.test(String(raw.artifactSha256)) || !Number.isSafeInteger(raw.artifactBytes)
    || !Number.isSafeInteger(raw.observationCount) || !Number.isSafeInteger(raw.excludedNonUsRows)
    || !SHA256.test(String(raw.receiptDigest))) fail('noaa_acquisition_receipt_invalid');
  const core = {
    ordinal: raw.ordinal!,
    windowId: raw.windowId as string,
    windowDigest: raw.windowDigest!,
    artifactKey: raw.artifactKey as string,
    artifactSha256: raw.artifactSha256!,
    artifactBytes: raw.artifactBytes!,
    observationCount: raw.observationCount!,
    excludedNonUsRows: raw.excludedNonUsRows!,
    acquiredAt: iso(raw.acquiredAt, 'noaa_acquisition_receipt_invalid'),
  };
  if (raw.receiptDigest !== relationshipInputSha256(core)) fail('noaa_acquisition_receipt_invalid');
  return { ...core, receiptDigest: raw.receiptDigest as string };
};

const decodeCheckpoint = (
  input: Buffer,
  plan: NoaaContextualAcquisitionPlan,
): NoaaContextualAcquisitionCheckpoint => {
  const raw = parseJson(input, 'noaa_acquisition_checkpoint_invalid') as Partial<NoaaContextualAcquisitionCheckpoint>;
  if (!raw || raw.recordType !== 'noaa_contextual_acquisition_checkpoint'
    || raw.schemaVersion !== NOAA_CONTEXTUAL_ACQUISITION_VERSION
    || raw.planDigest !== plan.planDigest || !['processing', 'complete'].includes(String(raw.status))
    || !Array.isArray(raw.receipts)) fail('noaa_acquisition_checkpoint_invalid');
  const receipts = (raw.receipts as unknown[]).map(decodeReceipt);
  const rebuilt = buildCheckpoint({
    planDigest: plan.planDigest,
    status: raw.status as 'processing' | 'complete',
    nextOrdinal: Number(raw.nextOrdinal),
    providerCalls: Number(raw.providerCalls),
    observationCount: Number(raw.observationCount),
    excludedNonUsRows: Number(raw.excludedNonUsRows),
    receipts,
    updatedAt: iso(raw.updatedAt, 'noaa_acquisition_checkpoint_invalid'),
  });
  if (raw.checkpointDigest !== rebuilt.checkpointDigest
    || !Number.isSafeInteger(rebuilt.nextOrdinal) || rebuilt.nextOrdinal !== receipts.length
    || rebuilt.providerCalls !== receipts.length
    || receipts.some((receipt, ordinal) => (
      receipt.ordinal !== ordinal
      || receipt.windowId !== plan.windows[ordinal]?.windowId
      || receipt.windowDigest !== plan.windows[ordinal]?.windowDigest
    ))
    || rebuilt.observationCount !== receipts.reduce((sum, receipt) => sum + receipt.observationCount, 0)
    || rebuilt.excludedNonUsRows !== receipts.reduce((sum, receipt) => sum + receipt.excludedNonUsRows, 0)
    || (rebuilt.status === 'complete' && rebuilt.nextOrdinal !== plan.windows.length)) {
    fail('noaa_acquisition_checkpoint_invalid');
  }
  return rebuilt;
};

const decodeArtifact = (
  body: Buffer,
  plan: NoaaContextualAcquisitionPlan,
  window: NoaaContextualAcquisitionWindow,
) => {
  const raw = parseJson(body, 'noaa_acquisition_window_artifact_invalid') as NoaaContextualAcquisitionWindowArtifact;
  const rebuilt = buildArtifact({ plan, window, result: raw.result });
  if (raw.recordType !== rebuilt.recordType || raw.schemaVersion !== rebuilt.schemaVersion
    || raw.planDigest !== rebuilt.planDigest || raw.artifactDigest !== rebuilt.artifactDigest
    || relationshipInputSha256(raw.window) !== relationshipInputSha256(rebuilt.window)) {
    fail('noaa_acquisition_window_artifact_invalid');
  }
  return rebuilt;
};

const buildReceipt = (params: {
  window: NoaaContextualAcquisitionWindow;
  artifactKey: string;
  artifactBody: Buffer;
  artifact: NoaaContextualAcquisitionWindowArtifact;
}): NoaaContextualAcquisitionWindowReceipt => {
  const core = {
    ordinal: params.window.ordinal,
    windowId: params.window.windowId,
    windowDigest: params.window.windowDigest,
    artifactKey: params.artifactKey,
    artifactSha256: sha256Bytes(params.artifactBody),
    artifactBytes: params.artifactBody.length,
    observationCount: params.artifact.result.observations.length,
    excludedNonUsRows: params.artifact.result.excludedNonUsRows,
    acquiredAt: params.artifact.result.acquiredAt,
  };
  return {
    ...core,
    receiptDigest: relationshipInputSha256(core),
  };
};

const verifyReceipts = async (
  storage: CaseGraphConditionalArchiveStorage,
  plan: NoaaContextualAcquisitionPlan,
  checkpoint: NoaaContextualAcquisitionCheckpoint,
) => {
  for (const receipt of checkpoint.receipts) {
    const body = await storage.readObject(receipt.artifactKey, {
      maxBytes: Math.min(MAX_WINDOW_ARTIFACT_BYTES, receipt.artifactBytes + 1),
    });
    if (!body || body.length !== receipt.artifactBytes
      || sha256Bytes(body) !== receipt.artifactSha256) {
      fail('noaa_acquisition_window_artifact_missing');
    }
    const artifact = decodeArtifact(
      body as Buffer,
      plan,
      plan.windows[receipt.ordinal],
    );
    if (artifact.result.observations.length !== receipt.observationCount
      || artifact.result.excludedNonUsRows !== receipt.excludedNonUsRows
      || artifact.result.acquiredAt !== receipt.acquiredAt) {
      fail('noaa_acquisition_window_receipt_mismatch');
    }
  }
};

export const acquireNoaaContextualWindows = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  plan: NoaaContextualAcquisitionPlan;
  acquire: (
    window: NoaaContextualAcquisitionWindow,
    signal?: AbortSignal,
  ) => Promise<NoaaNceiUsObservationResult>;
  maxWindowsPerRun: number;
  now: () => string;
  signal?: AbortSignal;
}) => {
  const plan = decodeNoaaContextualAcquisitionPlan(params.plan);
  if (!Number.isSafeInteger(params.maxWindowsPerRun) || params.maxWindowsPerRun < 1
    || params.maxWindowsPerRun > MAX_WINDOWS_PER_RUN) fail('noaa_acquisition_run_budget_invalid');
  const keys = getNoaaContextualAcquisitionKeys(plan.planDigest);
  await putImmutable(params.storage, keys.planKey, canonicalBody(plan));
  let checkpointObject = await params.storage.readObjectVersioned(keys.checkpointKey);
  const resumed = Boolean(checkpointObject);
  let checkpoint = checkpointObject
    ? decodeCheckpoint(checkpointObject.body, plan)
    : buildCheckpoint({
      planDigest: plan.planDigest,
      status: plan.windows.length ? 'processing' : 'complete',
      nextOrdinal: 0,
      providerCalls: 0,
      observationCount: 0,
      excludedNonUsRows: 0,
      receipts: [],
      updatedAt: iso(params.now(), 'noaa_acquisition_checkpoint_time_invalid'),
    });
  if (!checkpointObject) {
    checkpointObject = await putCheckpoint({
      storage: params.storage,
      key: keys.checkpointKey,
      checkpoint,
      priorVersion: null,
    });
  } else {
    await verifyReceipts(params.storage, plan, checkpoint);
  }
  let acquiredThisRun = 0;
  let recoveredThisRun = 0;
  let processedThisRun = 0;
  while (checkpoint.status === 'processing' && processedThisRun < params.maxWindowsPerRun) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const window = plan.windows[checkpoint.nextOrdinal];
    if (!window) fail('noaa_acquisition_checkpoint_invalid');
    const artifactKey = keys.windowKey(window);
    const existingArtifactBody = await params.storage.readObject(artifactKey, {
      maxBytes: MAX_WINDOW_ARTIFACT_BYTES,
    });
    let artifact: NoaaContextualAcquisitionWindowArtifact;
    let artifactBody: Buffer;
    if (existingArtifactBody) {
      artifactBody = existingArtifactBody;
      artifact = decodeArtifact(artifactBody, plan, window);
      if (!artifactBody.equals(canonicalBody(artifact))) {
        fail('noaa_acquisition_window_artifact_invalid');
      }
      recoveredThisRun += 1;
    } else {
      const requestStartedAt = await reserveNoaaProviderCall({
        storage: params.storage,
        keys,
        now: params.now,
        signal: params.signal,
      });
      const result = await params.acquire(window, params.signal);
      if (params.signal?.aborted) fail('case_graph_research_aborted');
      const resultAcquiredAtMs = Date.parse(result.acquiredAt);
      if (!Number.isFinite(resultAcquiredAtMs)
        || Math.abs(resultAcquiredAtMs - Date.parse(requestStartedAt)) > NOAA_PROVIDER_CLOCK_SKEW_MS) {
        fail('noaa_acquisition_provider_clock_invalid');
      }
      artifact = buildArtifact({ plan, window, result });
      artifactBody = canonicalBody(artifact);
      if (artifactBody.length > MAX_WINDOW_ARTIFACT_BYTES) {
        fail('noaa_acquisition_window_artifact_too_large');
      }
      await putImmutable(params.storage, artifactKey, artifactBody);
      acquiredThisRun += 1;
    }
    const receipt = buildReceipt({ window, artifactKey, artifactBody, artifact });
    const receipts = [...checkpoint.receipts, receipt];
    const nextOrdinal = checkpoint.nextOrdinal + 1;
    const nextCheckpoint = buildCheckpoint({
      planDigest: plan.planDigest,
      status: nextOrdinal === plan.windows.length ? 'complete' : 'processing',
      nextOrdinal,
      providerCalls: checkpoint.providerCalls + 1,
      observationCount: checkpoint.observationCount + receipt.observationCount,
      excludedNonUsRows: checkpoint.excludedNonUsRows + receipt.excludedNonUsRows,
      receipts,
      updatedAt: iso(params.now(), 'noaa_acquisition_checkpoint_time_invalid'),
    });
    checkpointObject = await putCheckpoint({
      storage: params.storage,
      key: keys.checkpointKey,
      checkpoint: nextCheckpoint,
      priorVersion: checkpointObject.version,
    });
    checkpoint = nextCheckpoint;
    processedThisRun += 1;
  }
  if (checkpoint.status !== 'complete') {
    return {
      status: 'partial' as const,
      resumed,
      acquiredThisRun,
      recoveredThisRun,
      remainingWindows: plan.windows.length - checkpoint.nextOrdinal,
      plan,
      checkpoint,
      completion: null,
    };
  }
  const completion = buildCompletion(
    checkpoint,
    iso(params.now(), 'noaa_acquisition_completion_time_invalid'),
  );
  await putImmutable(params.storage, keys.completionKey, canonicalBody(completion));
  return {
    status: resumed ? 'resumed' as const : 'completed' as const,
    resumed,
    acquiredThisRun,
    recoveredThisRun,
    remainingWindows: 0,
    plan,
    checkpoint,
    completion,
  };
};

export const readCompletedNoaaContextualAcquisition = async (params: {
  storage: Pick<CaseGraphConditionalArchiveStorage, 'readObject'>;
  plan: NoaaContextualAcquisitionPlan;
}) => {
  const plan = decodeNoaaContextualAcquisitionPlan(params.plan);
  const keys = getNoaaContextualAcquisitionKeys(plan.planDigest);
  const [storedPlan, checkpointBody, completionBody] = await Promise.all([
    params.storage.readObject(keys.planKey),
    params.storage.readObject(keys.checkpointKey),
    params.storage.readObject(keys.completionKey),
  ]);
  if (!storedPlan || !checkpointBody || !completionBody
    || !storedPlan.equals(canonicalBody(plan))) fail('noaa_acquisition_incomplete');
  const checkpoint = decodeCheckpoint(checkpointBody as Buffer, plan);
  if (checkpoint.status !== 'complete') fail('noaa_acquisition_incomplete');
  const rawCompletion = parseJson(
    completionBody as Buffer,
    'noaa_acquisition_completion_invalid',
  ) as NoaaContextualAcquisitionCompletion;
  const completion = buildCompletion(checkpoint, rawCompletion.completedAt);
  if (rawCompletion.completionDigest !== completion.completionDigest
    || relationshipInputSha256(rawCompletion) !== relationshipInputSha256(completion)) {
    fail('noaa_acquisition_completion_invalid');
  }
  const results: NoaaNceiUsObservationResult[] = [];
  for (const receipt of checkpoint.receipts) {
    const body = await params.storage.readObject(receipt.artifactKey, {
      maxBytes: receipt.artifactBytes + 1,
    });
    if (!body || body.length !== receipt.artifactBytes
      || sha256Bytes(body) !== receipt.artifactSha256) {
      fail('noaa_acquisition_window_artifact_missing');
    }
    results.push(decodeArtifact(
      body as Buffer,
      plan,
      plan.windows[receipt.ordinal],
    ).result);
  }
  return { plan, checkpoint, completion, results };
};
