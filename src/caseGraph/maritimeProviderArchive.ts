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

const PAGE_SIZE = 5_000;
const MAX_SOURCE_ROWS = 2_000_000;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const SOURCE = /^[A-Z0-9][A-Z0-9._:-]{0,239}$/;
const fail = (code: string): never => { throw new Error(code); };

export type MaritimeProviderArchiveMode = 'vessel_position' | 'zone_context';

const text = (value: unknown, maximum = 500) => {
  const normalized = String(value || '').trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) {
    fail('case_graph_maritime_provider_row_invalid');
  }
  return normalized;
};
const optionalText = (value: unknown, maximum = 240) => (
  value == null || String(value).trim() === '' ? null : text(value, maximum)
);
const finite = (value: unknown, nullable = false): number | null => {
  if (value == null && nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail('case_graph_maritime_provider_row_invalid');
  return number;
};
const timestamp = (value: unknown) => {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail('case_graph_maritime_provider_row_invalid');
  return date.toISOString();
};

type MaritimeRow = {
  address: string;
  nodeDigest: string;
  correlationId: string;
  source: string;
  mmsi: string;
  imo: string | null;
  callsign: string | null;
  vesselName: string | null;
  shipType: string | null;
  positionTime: string;
  latitude: number;
  longitude: number;
  distanceKm: number | null;
  timeDeltaSeconds: number | null;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  confidence: number | null;
  correlationReason: string | null;
  watchZoneId: string | null;
  watchZoneName: string | null;
  watchZoneType: string | null;
  watchZoneSource: string | null;
};

const decodeRow = (row: Record<string, unknown>, mode: MaritimeProviderArchiveMode, expectedSource: string): MaritimeRow => {
  const source = text(row.source, 240).toUpperCase();
  if (mode === 'zone_context' ? source !== 'MARITIME_ZONE_FALLBACK' : source !== expectedSource) {
    fail('case_graph_maritime_provider_source_invalid');
  }
  const latitude = finite(row.lat) as number;
  const longitude = finite(row.lon) as number;
  const distanceKm = finite(row.distance_km, true);
  const timeDeltaSeconds = finite(row.time_delta_seconds, true);
  const speedKnots = finite(row.sog_knots, true);
  const courseDegrees = finite(row.cog_deg, true);
  const headingDegrees = finite(row.heading_deg, true);
  const confidence = finite(row.correlation_confidence, true);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || distanceKm != null && distanceKm < 0 || timeDeltaSeconds != null && timeDeltaSeconds < 0
    || speedKnots != null && speedKnots < 0 || confidence != null && (confidence < 0 || confidence > 1)
    || courseDegrees != null && (courseDegrees < 0 || courseDegrees > 360)
    || headingDegrees != null && (headingDegrees < 0 || headingDegrees > 360)) {
    fail('case_graph_maritime_provider_row_invalid');
  }
  const decoded = {
    address: text(row.address, 250), nodeDigest: text(row.node_digest, 64),
    correlationId: text(row.correlation_id, 80), source, mmsi: text(row.mmsi, 80),
    imo: optionalText(row.imo, 80), callsign: optionalText(row.callsign, 80),
    vesselName: optionalText(row.vessel_name, 500), shipType: optionalText(row.ship_type, 120),
    positionTime: timestamp(row.position_time), latitude, longitude, distanceKm, timeDeltaSeconds,
    speedKnots, courseDegrees, headingDegrees, confidence,
    correlationReason: optionalText(row.correlation_reason, 1000),
    watchZoneId: optionalText(row.watch_zone_id, 80), watchZoneName: optionalText(row.watch_zone_name, 500),
    watchZoneType: optionalText(row.watch_zone_type, 80), watchZoneSource: optionalText(row.watch_zone_source, 240),
  };
  if (mode === 'zone_context' && (!decoded.watchZoneId || !decoded.watchZoneName || !decoded.watchZoneSource)) {
    fail('case_graph_maritime_provider_row_invalid');
  }
  return decoded;
};

const vesselCandidate = (row: MaritimeRow): CaseGraphExternalCorrelationCandidateInput => ({
  sourceRecordId: `maritime-correlation:${row.correlationId}`,
  label: row.vesselName || row.callsign || `AIS vessel ${row.mmsi}`,
  observedAt: row.positionTime,
  measurements: {
    mmsi: row.mmsi, imo: row.imo, callsign: row.callsign, ship_type: row.shipType,
    distance_km: row.distanceKm, time_delta_seconds: row.timeDeltaSeconds,
    speed_over_ground_knots: row.speedKnots, course_over_ground_degrees: row.courseDegrees,
    heading_degrees: row.headingDegrees, correlation_confidence: row.confidence,
    latitude: row.latitude, longitude: row.longitude,
  },
  reasonCodes: ['archived_ais_position_candidate', 'bounded_time_distance_match'],
  explanation: `The archived ${row.source} position places ${row.vesselName || row.mmsi} near the reported event within the stored time-distance bounds. This is a traffic comparison, not proof that the vessel caused or observed the sighting.`,
  uncertainty: [
    'AIS coverage can be incomplete, delayed, duplicated, disabled or falsified.',
    'The comparison inherits uncertainty in the sighting time and location.',
    'Correlation confidence is a deterministic ranking score, not a causal probability.',
  ],
});

const zoneCandidate = (row: MaritimeRow): CaseGraphExternalCorrelationCandidateInput => ({
  sourceRecordId: `maritime-zone-correlation:${row.correlationId}`,
  label: `Maritime context: ${row.watchZoneName}`,
  observedAt: row.positionTime,
  measurements: {
    distance_km: row.distanceKm, watch_zone_type: row.watchZoneType,
    watch_zone_source: row.watchZoneSource, context_score: row.confidence,
    zone_latitude: row.latitude, zone_longitude: row.longitude,
  },
  reasonCodes: ['maritime_watch_zone_proximity', 'no_vessel_position'],
  explanation: `The reported location is near the ${row.watchZoneName} maritime watch zone derived from ${row.watchZoneSource}. This is geographic context only; it does not establish that any vessel was present at the event time.`,
  uncertainty: [
    'The stored event-time value was copied from the sighting for fallback ranking and is not a vessel observation time.',
    'No AIS vessel position, identity, course or speed supports this station-like zone comparison.',
    'The context score is a deterministic proximity score, not a probability of maritime involvement.',
  ],
});

export const loadMaritimeProviderArchiveRecords = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  run: CaseGraphExternalProviderArchiveQuery;
  mode: MaritimeProviderArchiveMode;
  source: string;
  limitPerAddress: number;
  signal?: AbortSignal;
}): Promise<CaseGraphExternalProviderArchiveRecord[]> => {
  const source = params.source.trim().toUpperCase();
  if (!SOURCE.test(source) || !Number.isSafeInteger(params.limitPerAddress)
    || params.limitPerAddress < 1 || params.limitPerAddress > 20
    || params.mode === 'zone_context' && source !== 'MARITIME_ZONE_FALLBACK'
    || params.mode === 'vessel_position' && source === 'MARITIME_ZONE_FALLBACK') {
    fail('case_graph_maritime_provider_plan_invalid');
  }
  const grouped = new Map<string, { nodeDigest: string; rows: MaritimeRow[] }>();
  let cursorAddress = '';
  let cursorId = ZERO_UUID;
  let sourceRows = 0;
  for (;;) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const result = await params.run(
      `/* external-provider-archive:maritime-page */
       SELECT node.address, node.node_digest, correlation.id::text AS correlation_id,
              correlation.source, correlation.mmsi, correlation.imo, correlation.callsign,
              correlation.vessel_name, correlation.ship_type, correlation.position_time,
              correlation.lat, correlation.lon, correlation.distance_km,
              correlation.time_delta_seconds, correlation.sog_knots, correlation.cog_deg,
              correlation.heading_deg, correlation.correlation_confidence,
              correlation.correlation_reason, correlation.watch_zone_id::text,
              zone.name AS watch_zone_name, zone.zone_type AS watch_zone_type,
              zone.source AS watch_zone_source
       FROM public.case_graph_research_search_publication_nodes node
       JOIN public.uap_maritime_correlations correlation
         ON node.address = 'sighting:' || correlation.sighting_id::text
       LEFT JOIN public.uap_maritime_watch_zones zone ON zone.id = correlation.watch_zone_id
       WHERE node.publication_id = $1::uuid AND upper(correlation.source) = $2
         AND (node.address COLLATE "C" > $3 OR (node.address = $3 AND correlation.id > $4::uuid))
       ORDER BY node.address COLLATE "C", correlation.id
       LIMIT $5`,
      [params.publication.publicationId, source, cursorAddress, cursorId, PAGE_SIZE],
    );
    if (!result.rows.length) break;
    sourceRows += result.rows.length;
    if (sourceRows > MAX_SOURCE_ROWS) fail('case_graph_maritime_provider_source_too_large');
    for (const raw of result.rows) {
      const row = decodeRow(raw, params.mode, source);
      const existing = grouped.get(row.address);
      if (existing && existing.nodeDigest !== row.nodeDigest) fail('case_graph_maritime_provider_node_conflict');
      if (existing) existing.rows.push(row); else grouped.set(row.address, { nodeDigest: row.nodeDigest, rows: [row] });
    }
    const last = result.rows[result.rows.length - 1];
    cursorAddress = text(last.address, 250); cursorId = text(last.correlation_id, 80);
    if (result.rows.length < PAGE_SIZE) break;
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([address, group]) => {
    const ranked = group.rows.sort((left, right) => (
      (right.confidence ?? -1) - (left.confidence ?? -1)
      || (left.distanceKm ?? Number.MAX_VALUE) - (right.distanceKm ?? Number.MAX_VALUE)
      || (left.timeDeltaSeconds ?? Number.MAX_VALUE) - (right.timeDeltaSeconds ?? Number.MAX_VALUE)
      || left.correlationId.localeCompare(right.correlationId)
    ));
    const limited = ranked.slice(0, params.limitPerAddress);
    const zone = params.mode === 'zone_context';
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId, publicationId: params.publication.publicationId,
      address, nodeDigest: group.nodeDigest, availability: 'available',
      reasonCodes: [
        ...(ranked.length > limited.length ? ['candidate_limit_applied'] : []),
        zone ? 'sealed_maritime_zone_context_available' : 'sealed_maritime_vessel_positions_available',
      ],
      explanation: zone
        ? `${limited.length} maritime watch-zone comparison${limited.length === 1 ? '' : 's'} retained. Zone proximity is contextual geography, not evidence that a vessel was present.`
        : `${limited.length} archived vessel-position candidate${limited.length === 1 ? '' : 's'} retained from ${ranked.length} bounded match${ranked.length === 1 ? '' : 'es'}; candidates are comparisons, not identifications.`,
      candidates: limited.map(zone ? zoneCandidate : vesselCandidate),
    });
  });
};

export const materializeAndPublishMaritimeProviderArchive = async (params: {
  snapshot: Omit<CaseGraphExternalProviderArchiveSnapshot, 'archiveObjectKey' | 'archiveObjectSha256' | 'archiveObjectBytes'>;
  mode: MaritimeProviderArchiveMode;
  correlationSource: string;
  run: CaseGraphExternalProviderArchiveQuery;
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: (params: { key: string; body: Buffer; sha256: string; signal?: AbortSignal }) => Promise<void>;
  verifyArchiveObject: Parameters<typeof publishCaseGraphExternalProviderArchive>[0]['verifyArchiveObject'];
  limitPerAddress: number;
  signal?: AbortSignal;
}) => {
  if (params.snapshot.category !== 'maritime' || params.snapshot.contentMode !== 'metadata_only') {
    fail('case_graph_maritime_provider_plan_invalid');
  }
  const records = await loadMaritimeProviderArchiveRecords({
    publication: params.snapshot.publication, snapshotId: params.snapshot.snapshotId,
    run: params.run, mode: params.mode, source: params.correlationSource,
    limitPerAddress: params.limitPerAddress, signal: params.signal,
  });
  const archive = buildBalloonProviderArchiveObject(records);
  const providerSegment = params.snapshot.providerId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const key = `case-vortex/external-providers/maritime/${providerSegment}/${archive.sha256}.ndjson.gz`;
  await params.putArchiveObject({ key, body: archive.body, sha256: archive.sha256, signal: params.signal });
  return publishCaseGraphExternalProviderArchive({
    snapshot: { ...params.snapshot, archiveObjectKey: key, archiveObjectSha256: archive.sha256, archiveObjectBytes: archive.bytes },
    records, transaction: params.transaction, verifyArchiveObject: params.verifyArchiveObject, signal: params.signal,
  });
};

export const createGovernedMaritimeExternalCorrelationAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  canonicalSource: string;
  providerId: string;
  run: CaseGraphExternalProviderArchiveQuery;
}) => {
  const archiveAdapter = createPostgresExternalProviderArchiveAdapter({
    publication: params.publication, snapshotId: params.snapshotId, category: 'maritime', run: params.run,
  });
  return createPostgresGovernedExternalCorrelationProviderAdapter({
    category: 'maritime', canonicalSource: params.canonicalSource, providerId: params.providerId,
    allowedContentModes: ['metadata_only'], correlate: archiveAdapter.correlate, run: params.run,
  });
};
