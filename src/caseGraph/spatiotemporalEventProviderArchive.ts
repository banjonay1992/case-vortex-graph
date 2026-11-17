import type { CaseGraphExternalCorrelationCategory } from './externalCorrelation';
import type { CaseGraphExternalCorrelationCandidateInput } from './externalCorrelationProviderAdapters';
import { buildBalloonProviderArchiveObject } from './balloonProviderArchive';
import {
  createPostgresExternalProviderArchiveAdapter,
  makeCaseGraphExternalProviderArchiveRecord,
  publishCaseGraphExternalProviderArchive,
  type CaseGraphExternalProviderArchiveQuery,
  type CaseGraphExternalProviderArchiveRecord,
  type CaseGraphExternalProviderArchiveSnapshot,
  type CaseGraphExternalProviderArchiveTransaction,
} from './providerArchiveExternalCorrelation';
import { createPostgresGovernedExternalCorrelationProviderAdapter } from './postgresExternalCorrelation';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import type { RocketLaunchEvent } from '../services/rocketLaunches';
import type { SkyContextEvent } from '../services/skyContextEvents';

const PAGE_SIZE = 5_000;
const MAX_NODES = 1_000_000;
const MAX_EVENTS = 100_000;
const SOURCE = /^[A-Z0-9][A-Z0-9._:-]{0,239}$/;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left.localeCompare(right);

export type SpatiotemporalEventCategory = Extract<CaseGraphExternalCorrelationCategory, 'meteor' | 'launch' | 'military_exercise'>;

export type SpatiotemporalProviderEvent = {
  sourceRecordId: string;
  label: string;
  occurredAt: string;
  latitude: number;
  longitude: number;
  measurements: Record<string, string | number | boolean | null>;
  reasonCodes: string[];
  explanation: string;
  uncertainty: string[];
};

export const nasaCneosFireballsToProviderEvents = (
  events: readonly SkyContextEvent[],
): SpatiotemporalProviderEvent[] => events.filter((event) => (
  event.kind === 'meteor' && event.source === 'nasa_cneos' && event.occurred_at
)).map((event) => ({
  sourceRecordId: event.id,
  label: event.label,
  occurredAt: event.occurred_at!,
  latitude: event.lat,
  longitude: event.lon,
  measurements: {
    impact_or_radiated_energy: event.strength,
    altitude_km: event.altitude_km,
    velocity_km_s: event.velocity_km_s,
    source_confidence: event.confidence,
  },
  reasonCodes: ['nasa_cneos_fireball_event'],
  explanation: event.description,
  uncertainty: [
    'CNEOS public fireball coordinates, time and energy values may be rounded or absent.',
    'The public catalogue does not capture every meteor or fireball event.',
    'Geographic and temporal proximity does not prove the report observed this event.',
  ],
}));

export const rocketLaunchesToProviderEvents = (
  events: readonly RocketLaunchEvent[],
): SpatiotemporalProviderEvent[] => events.flatMap((event) => {
  const occurredAt = event.net || event.windowStart || event.windowEnd;
  if (!occurredAt) return [];
  return [{
    sourceRecordId: event.id,
    label: event.name,
    occurredAt,
    latitude: event.lat,
    longitude: event.lon,
    measurements: {
      status: event.status, provider: event.provider, vehicle: event.vehicle,
      mission: event.mission, launch_pad: event.padName, launch_location: event.locationName,
      country_code: event.countryCode, window_start: event.windowStart, window_end: event.windowEnd,
      live: event.live, upcoming: event.upcoming, recent: event.recent,
    },
    reasonCodes: ['rocket_launch_schedule_event'],
    explanation: `${event.name} is listed at ${event.padName || event.locationName || 'the supplied launch coordinates'} with status ${event.status}.`,
    uncertainty: [
      'Launch schedules and windows can change after this snapshot was acquired.',
      'Pad distance alone does not model the rocket trajectory, staging, plume visibility or re-entry path.',
      'Geographic and temporal proximity does not prove the report observed this launch.',
    ],
  }];
});

type PublicationSighting = {
  address: string;
  nodeDigest: string;
  eventTimestamp: string | null;
  latitude: number | null;
  longitude: number | null;
};

const boundedText = (value: unknown, maximum = 500) => {
  const normalized = String(value || '').trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) fail('case_graph_event_provider_invalid');
  return normalized;
};
const optionalFinite = (value: unknown): number | null => {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail('case_graph_event_provider_invalid');
  return number;
};
const iso = (value: unknown) => {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail('case_graph_event_provider_invalid');
  return date.toISOString();
};
const normalizeLongitude = (value: number) => ((value + 540) % 360) - 180;
const radians = (value: number) => value * Math.PI / 180;
const distanceKm = (leftLat: number, leftLon: number, rightLat: number, rightLon: number) => {
  const latDelta = radians(rightLat - leftLat);
  const lonDelta = radians(normalizeLongitude(rightLon - leftLon));
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(lonDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
};

const normalizeEvent = (event: SpatiotemporalProviderEvent) => {
  const latitude = Number(event.latitude); const longitude = Number(event.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180 || !event.measurements || typeof event.measurements !== 'object'
    || Array.isArray(event.measurements) || !Array.isArray(event.reasonCodes) || !Array.isArray(event.uncertainty)) {
    fail('case_graph_event_provider_invalid');
  }
  return {
    ...event, sourceRecordId: boundedText(event.sourceRecordId, 500), label: boundedText(event.label, 500),
    occurredAt: iso(event.occurredAt), latitude, longitude,
    explanation: boundedText(event.explanation, 2000),
    reasonCodes: [...new Set(event.reasonCodes.map((code) => boundedText(code, 120)))].sort(compare),
    uncertainty: [...new Set(event.uncertainty.map((item) => boundedText(item, 1000)))].sort(compare),
  };
};

export const loadPublicationSightingsForEventCorrelation = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  run: CaseGraphExternalProviderArchiveQuery;
  signal?: AbortSignal;
}): Promise<PublicationSighting[]> => {
  const nodes: PublicationSighting[] = [];
  let cursor = '';
  for (;;) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const result = await params.run(
      `/* external-provider-archive:event-sighting-page */
       SELECT node.address, node.node_digest, sighting.event_timestamp,
              sighting.lat, sighting.lon
       FROM public.case_graph_research_search_publication_nodes node
       JOIN public.uap_sightings sighting ON node.address = 'sighting:' || sighting.id::text
       WHERE node.publication_id = $1::uuid AND node.address COLLATE "C" > $2
       ORDER BY node.address COLLATE "C" LIMIT $3`,
      [params.publication.publicationId, cursor, PAGE_SIZE],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      const latitude = optionalFinite(row.lat); const longitude = optionalFinite(row.lon);
      if (latitude != null && (latitude < -90 || latitude > 90) || longitude != null && (longitude < -180 || longitude > 180)) {
        fail('case_graph_event_provider_invalid');
      }
      nodes.push({
        address: boundedText(row.address, 250), nodeDigest: boundedText(row.node_digest, 64),
        eventTimestamp: row.event_timestamp == null ? null : iso(row.event_timestamp), latitude, longitude,
      });
      if (nodes.length > MAX_NODES) fail('case_graph_event_provider_source_too_large');
    }
    cursor = nodes[nodes.length - 1].address;
    if (result.rows.length < PAGE_SIZE) break;
  }
  return nodes;
};

const firstAtOrAfter = (events: Array<ReturnType<typeof normalizeEvent>>, timestampMs: number) => {
  let low = 0; let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Date.parse(events[middle].occurredAt) < timestampMs) low = middle + 1; else high = middle;
  }
  return low;
};

export const buildSpatiotemporalEventArchiveRecords = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  category: SpatiotemporalEventCategory;
  nodes: PublicationSighting[];
  events: SpatiotemporalProviderEvent[];
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
}): CaseGraphExternalProviderArchiveRecord[] => {
  if (!params.nodes.length || params.nodes.length > MAX_NODES || params.events.length > MAX_EVENTS
    || !Number.isFinite(params.maxDistanceKm) || params.maxDistanceKm <= 0 || params.maxDistanceKm > 20_000
    || !Number.isFinite(params.maxTimeDeltaMinutes) || params.maxTimeDeltaMinutes <= 0
    || params.maxTimeDeltaMinutes > 525_960 || !Number.isSafeInteger(params.limitPerAddress)
    || params.limitPerAddress < 1 || params.limitPerAddress > 20) fail('case_graph_event_provider_plan_invalid');
  const events = params.events.map(normalizeEvent).sort((left, right) => (
    compare(left.occurredAt, right.occurredAt) || compare(left.sourceRecordId, right.sourceRecordId)
  ));
  if (new Set(events.map(({ sourceRecordId }) => sourceRecordId)).size !== events.length) {
    fail('case_graph_event_provider_duplicate_event');
  }
  const maxDeltaMs = params.maxTimeDeltaMinutes * 60_000;
  return [...params.nodes].sort((left, right) => compare(left.address, right.address)).map((node) => {
    if (!node.eventTimestamp || node.latitude == null || node.longitude == null) {
      return makeCaseGraphExternalProviderArchiveRecord({
        snapshotId: params.snapshotId, publicationId: params.publication.publicationId,
        address: node.address, nodeDigest: node.nodeDigest, availability: 'insufficient_evidence',
        reasonCodes: ['sighting_time_or_location_missing'],
        explanation: `The ${params.category.replace(/_/g, ' ')} provider was available, but this sighting lacks a usable event time or location for bounded comparison.`,
        candidates: [],
      });
    }
    const nodeMs = Date.parse(node.eventTimestamp);
    const start = firstAtOrAfter(events, nodeMs - maxDeltaMs);
    const candidates: Array<{ event: ReturnType<typeof normalizeEvent>; distance: number; deltaMinutes: number }> = [];
    for (let index = start; index < events.length; index += 1) {
      const event = events[index];
      const deltaMs = Math.abs(Date.parse(event.occurredAt) - nodeMs);
      if (Date.parse(event.occurredAt) > nodeMs + maxDeltaMs) break;
      const distance = distanceKm(node.latitude, node.longitude, event.latitude, event.longitude);
      if (distance <= params.maxDistanceKm) candidates.push({ event, distance, deltaMinutes: deltaMs / 60_000 });
    }
    candidates.sort((left, right) => (
      left.deltaMinutes - right.deltaMinutes || left.distance - right.distance
      || compare(left.event.sourceRecordId, right.event.sourceRecordId)
    ));
    const limited = candidates.slice(0, params.limitPerAddress);
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId, publicationId: params.publication.publicationId,
      address: node.address, nodeDigest: node.nodeDigest, availability: 'available',
      reasonCodes: [
        ...(candidates.length > limited.length ? ['candidate_limit_applied'] : []),
        limited.length ? 'bounded_event_candidates_available' : 'bounded_event_window_checked_no_candidate',
      ],
      explanation: limited.length
        ? `${limited.length} ${params.category.replace(/_/g, ' ')} event comparison${limited.length === 1 ? '' : 's'} retained within the configured time and distance bounds; none is a causal identification.`
        : `The provider snapshot was checked within ${params.maxDistanceKm} km and ${params.maxTimeDeltaMinutes} minutes and contained no candidate. Coverage gaps mean the category is not ruled out.`,
      candidates: limited.map(({ event, distance, deltaMinutes }): CaseGraphExternalCorrelationCandidateInput => ({
        sourceRecordId: event.sourceRecordId, label: event.label, observedAt: event.occurredAt,
        measurements: { ...event.measurements, distance_km: Number(distance.toFixed(3)), time_delta_minutes: Number(deltaMinutes.toFixed(3)) },
        reasonCodes: [...new Set(['bounded_spatiotemporal_match', ...event.reasonCodes])].sort(compare),
        explanation: `${event.explanation} It is ${distance.toFixed(1)} km and ${deltaMinutes.toFixed(1)} minutes from the report; this is a comparison, not an identification.`,
        uncertainty: event.uncertainty,
      })),
    });
  });
};

export const materializeAndPublishSpatiotemporalEventArchive = async (params: {
  snapshot: Omit<CaseGraphExternalProviderArchiveSnapshot, 'archiveObjectKey' | 'archiveObjectSha256' | 'archiveObjectBytes'>;
  events: SpatiotemporalProviderEvent[];
  run: CaseGraphExternalProviderArchiveQuery;
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: (params: { key: string; body: Buffer; sha256: string; signal?: AbortSignal }) => Promise<void>;
  verifyArchiveObject: Parameters<typeof publishCaseGraphExternalProviderArchive>[0]['verifyArchiveObject'];
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
  signal?: AbortSignal;
}) => {
  if (!['meteor', 'launch', 'military_exercise'].includes(params.snapshot.category)
    || params.snapshot.contentMode !== 'metadata_only') fail('case_graph_event_provider_plan_invalid');
  const nodes = await loadPublicationSightingsForEventCorrelation({
    publication: params.snapshot.publication, run: params.run, signal: params.signal,
  });
  if (!nodes.length) fail('case_graph_event_provider_publication_empty');
  const records = buildSpatiotemporalEventArchiveRecords({
    publication: params.snapshot.publication, snapshotId: params.snapshot.snapshotId,
    category: params.snapshot.category as SpatiotemporalEventCategory, nodes, events: params.events,
    maxDistanceKm: params.maxDistanceKm, maxTimeDeltaMinutes: params.maxTimeDeltaMinutes,
    limitPerAddress: params.limitPerAddress,
  });
  const archive = buildBalloonProviderArchiveObject(records);
  const category = params.snapshot.category.replace(/_/g, '-');
  const key = `case-vortex/external-providers/${category}/${archive.sha256}.ndjson.gz`;
  await params.putArchiveObject({ key, body: archive.body, sha256: archive.sha256, signal: params.signal });
  return publishCaseGraphExternalProviderArchive({
    snapshot: { ...params.snapshot, archiveObjectKey: key, archiveObjectSha256: archive.sha256, archiveObjectBytes: archive.bytes },
    records, transaction: params.transaction, verifyArchiveObject: params.verifyArchiveObject, signal: params.signal,
  });
};

export const createGovernedSpatiotemporalEventExternalCorrelationAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  category: SpatiotemporalEventCategory;
  canonicalSource: string;
  providerId: string;
  run: CaseGraphExternalProviderArchiveQuery;
}) => {
  if (!SOURCE.test(params.canonicalSource)) fail('case_graph_event_provider_plan_invalid');
  const archiveAdapter = createPostgresExternalProviderArchiveAdapter({
    publication: params.publication, snapshotId: params.snapshotId, category: params.category, run: params.run,
  });
  return createPostgresGovernedExternalCorrelationProviderAdapter({
    category: params.category, canonicalSource: params.canonicalSource, providerId: params.providerId,
    allowedContentModes: ['metadata_only'], correlate: archiveAdapter.correlate, run: params.run,
  });
};
