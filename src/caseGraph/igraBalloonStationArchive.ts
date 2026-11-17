import type { CaseGraphExternalCorrelationCandidateInput } from './externalCorrelationProviderAdapters';
import {
  buildBalloonProviderArchiveObject,
} from './balloonProviderArchive';
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
const fail = (code: string): never => { throw new Error(code); };

const text = (value: unknown, maximum = 500) => {
  const normalized = String(value || '').trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) {
    fail('case_graph_igra_station_provider_row_invalid');
  }
  return normalized;
};

const optionalText = (value: unknown, maximum = 240) => (
  value == null || String(value).trim() === '' ? null : text(value, maximum)
);

const finite = (value: unknown, nullable = false): number | null => {
  if (value == null && nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail('case_graph_igra_station_provider_row_invalid');
  return number;
};

const integer = (value: unknown, nullable = false): number | null => {
  const number = finite(value, nullable);
  if (number == null) return null;
  if (!Number.isSafeInteger(number)) fail('case_graph_igra_station_provider_row_invalid');
  return number;
};

const timestamp = (value: unknown) => {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail('case_graph_igra_station_provider_row_invalid');
  return date.toISOString();
};

type IgraStationCandidateRow = {
  address: string;
  nodeDigest: string;
  matchId: string;
  observedAt: string;
  distanceKm: number;
  synopticDeltaMinutes: number;
  heuristicConfidence: number;
  stationId: string;
  stationName: string;
  stationSource: string;
  countryCode: string | null;
  stateCode: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  firstYear: number | null;
  lastYear: number | null;
  launchCount: number | null;
};

const decodeRow = (row: Record<string, unknown>): IgraStationCandidateRow => {
  if (text(row.match_source, 80) !== 'igra_station') {
    fail('case_graph_igra_station_provider_source_invalid');
  }
  const distanceKm = finite(row.distance_km) as number;
  const synopticDeltaMinutes = integer(row.time_delta_minutes) as number;
  const heuristicConfidence = finite(row.confidence) as number;
  const latitude = finite(row.lat) as number;
  const longitude = finite(row.lon) as number;
  const elevationM = finite(row.elevation_m, true);
  const firstYear = integer(row.first_year, true);
  const lastYear = integer(row.last_year, true);
  const launchCount = integer(row.launch_count, true);
  if (distanceKm < 0 || synopticDeltaMinutes < 0 || heuristicConfidence < 0 || heuristicConfidence > 100
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || launchCount != null && launchCount < 0 || firstYear != null && lastYear != null && firstYear > lastYear) {
    fail('case_graph_igra_station_provider_row_invalid');
  }
  return {
    address: text(row.address, 250), nodeDigest: text(row.node_digest, 64),
    matchId: text(row.match_id, 80), observedAt: timestamp(row.observed_at),
    distanceKm, synopticDeltaMinutes, heuristicConfidence,
    stationId: text(row.station_id, 240), stationName: text(row.station_name, 500),
    stationSource: text(row.station_source, 240), countryCode: optionalText(row.country_code, 20),
    stateCode: optionalText(row.state_code, 80), latitude, longitude, elevationM,
    firstYear, lastYear, launchCount,
  };
};

const candidate = (row: IgraStationCandidateRow): CaseGraphExternalCorrelationCandidateInput => ({
  sourceRecordId: `igra-station-match:${row.matchId}`,
  label: `Historical launch station ${row.stationName}`,
  observedAt: row.observedAt,
  measurements: {
    distance_km: row.distanceKm,
    synoptic_schedule_delta_minutes: row.synopticDeltaMinutes,
    heuristic_confidence_percent: row.heuristicConfidence,
    station_latitude: row.latitude,
    station_longitude: row.longitude,
    station_elevation_m: row.elevationM,
    station_first_year: row.firstYear,
    station_last_year: row.lastYear,
    historical_launch_count: row.launchCount,
    station_country_code: row.countryCode,
    station_state_code: row.stateCode,
  },
  reasonCodes: ['historical_launch_station_proximity', 'no_archived_flight_track'],
  explanation: `IGRA2 station ${row.stationId} (${row.stationName}) is ${row.distanceKm} km from the reported location and the report is ${row.synopticDeltaMinutes} minutes from a nominal 00/12 UTC sounding time. This establishes station context only; it does not establish that a balloon launched or travelled near the sighting.`,
  uncertainty: [
    'The matched time is a nominal synoptic schedule proxy, not an observed launch time.',
    'No archived balloon trajectory is attached to this station-only comparison.',
    'The confidence value is a deterministic proximity score, not the probability that the sighting was a balloon.',
  ],
});

export const loadIgraBalloonStationArchiveRecords = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  run: CaseGraphExternalProviderArchiveQuery;
  limitPerAddress: number;
  signal?: AbortSignal;
}): Promise<CaseGraphExternalProviderArchiveRecord[]> => {
  if (!Number.isSafeInteger(params.limitPerAddress) || params.limitPerAddress < 1 || params.limitPerAddress > 20) {
    fail('case_graph_igra_station_provider_plan_invalid');
  }
  const grouped = new Map<string, { nodeDigest: string; rows: IgraStationCandidateRow[] }>();
  let cursorAddress = '';
  let cursorMatchId = ZERO_UUID;
  let sourceRows = 0;
  for (;;) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const result = await params.run(
      `/* external-provider-archive:igra-station-page */
       SELECT node.address, node.node_digest, match.id::text AS match_id, match.match_source,
              match.observed_at, match.distance_km, match.time_delta_minutes, match.confidence,
              station.station_id, station.station_name, station.source AS station_source,
              station.country_code, station.state_code, station.lat, station.lon,
              station.elevation_m, station.first_year, station.last_year, station.launch_count
       FROM public.case_graph_research_search_publication_nodes node
       JOIN public.uap_balloon_sighting_matches match
         ON node.address = 'sighting:' || match.sighting_id::text
       JOIN public.uap_balloon_stations station ON station.station_id = match.station_id
       WHERE node.publication_id = $1::uuid AND match.match_source = 'igra_station'
         AND (node.address COLLATE "C" > $2 OR (node.address = $2 AND match.id > $3::uuid))
       ORDER BY node.address COLLATE "C", match.id
       LIMIT $4`,
      [params.publication.publicationId, cursorAddress, cursorMatchId, PAGE_SIZE],
    );
    if (!result.rows.length) break;
    sourceRows += result.rows.length;
    if (sourceRows > MAX_SOURCE_ROWS) fail('case_graph_igra_station_provider_source_too_large');
    for (const raw of result.rows) {
      const row = decodeRow(raw);
      const existing = grouped.get(row.address);
      if (existing && existing.nodeDigest !== row.nodeDigest) fail('case_graph_igra_station_provider_node_conflict');
      if (existing) existing.rows.push(row);
      else grouped.set(row.address, { nodeDigest: row.nodeDigest, rows: [row] });
    }
    const last = result.rows[result.rows.length - 1];
    cursorAddress = text(last.address, 250);
    cursorMatchId = text(last.match_id, 80);
    if (result.rows.length < PAGE_SIZE) break;
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([address, group]) => {
    const ranked = group.rows.sort((left, right) => (
      right.heuristicConfidence - left.heuristicConfidence || left.distanceKm - right.distanceKm
      || left.synopticDeltaMinutes - right.synopticDeltaMinutes || left.stationId.localeCompare(right.stationId)
      || left.matchId.localeCompare(right.matchId)
    ));
    const limited = ranked.slice(0, params.limitPerAddress);
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId,
      publicationId: params.publication.publicationId,
      address,
      nodeDigest: group.nodeDigest,
      availability: 'available',
      reasonCodes: ranked.length > limited.length
        ? ['candidate_limit_applied', 'sealed_igra_station_context_available']
        : ['sealed_igra_station_context_available'],
      explanation: `${limited.length} historical IGRA2 station comparison${limited.length === 1 ? '' : 's'} retained from ${ranked.length} nearby station row${ranked.length === 1 ? '' : 's'}. Station proximity is contextual evidence, not a balloon identification or flight track.`,
      candidates: limited.map(candidate),
    });
  });
};

export const materializeAndPublishIgraBalloonStationArchive = async (params: {
  snapshot: Omit<CaseGraphExternalProviderArchiveSnapshot, 'archiveObjectKey' | 'archiveObjectSha256' | 'archiveObjectBytes'>;
  run: CaseGraphExternalProviderArchiveQuery;
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: (params: { key: string; body: Buffer; sha256: string; signal?: AbortSignal }) => Promise<void>;
  verifyArchiveObject: Parameters<typeof publishCaseGraphExternalProviderArchive>[0]['verifyArchiveObject'];
  limitPerAddress: number;
  signal?: AbortSignal;
}) => {
  if (params.snapshot.category !== 'balloon' || params.snapshot.providerId !== 'igra2-station-history'
    || params.snapshot.canonicalSource !== 'IGRA2' || params.snapshot.contentMode !== 'metadata_only') {
    fail('case_graph_igra_station_provider_plan_invalid');
  }
  const records = await loadIgraBalloonStationArchiveRecords({
    publication: params.snapshot.publication, snapshotId: params.snapshot.snapshotId,
    run: params.run, limitPerAddress: params.limitPerAddress, signal: params.signal,
  });
  const archive = buildBalloonProviderArchiveObject(records);
  const key = `case-vortex/external-providers/balloon/igra2/${archive.sha256}.ndjson.gz`;
  await params.putArchiveObject({ key, body: archive.body, sha256: archive.sha256, signal: params.signal });
  return publishCaseGraphExternalProviderArchive({
    snapshot: {
      ...params.snapshot, archiveObjectKey: key,
      archiveObjectSha256: archive.sha256, archiveObjectBytes: archive.bytes,
    },
    records, transaction: params.transaction,
    verifyArchiveObject: params.verifyArchiveObject, signal: params.signal,
  });
};

export const createGovernedIgraBalloonStationExternalCorrelationAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  run: CaseGraphExternalProviderArchiveQuery;
}) => {
  const archiveAdapter = createPostgresExternalProviderArchiveAdapter({
    publication: params.publication, snapshotId: params.snapshotId, category: 'balloon', run: params.run,
  });
  return createPostgresGovernedExternalCorrelationProviderAdapter({
    category: 'balloon', canonicalSource: 'IGRA2', providerId: 'igra2-station-history',
    allowedContentModes: ['metadata_only'], correlate: archiveAdapter.correlate, run: params.run,
  });
};
