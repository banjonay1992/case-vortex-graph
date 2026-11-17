import type { OpenSkyStateRow } from '../workers/openskyWorkerShared';
import type {
  CaseGraphExternalCorrelationCandidateInput,
} from './externalCorrelationProviderAdapters';
import {
  makeCaseGraphExternalProviderArchiveRecord,
  publishCaseGraphExternalProviderArchive,
  type CaseGraphExternalProviderArchiveRecord,
  type CaseGraphExternalProviderArchiveSnapshot,
  type CaseGraphExternalProviderArchiveTransaction,
} from './providerArchiveExternalCorrelation';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import { buildBalloonProviderArchiveObject } from './balloonProviderArchive';
import type {
  AdsbLolHistoricalArchive,
  NoaaNceiUsObservation,
  NoaaNceiUsObservationResult,
} from './freeContextualProviderObservations';

export type ContextualProviderPublicationSighting = {
  address: string;
  nodeDigest: string;
  eventTimestamp: string | null;
  latitude: number | null;
  longitude: number | null;
};

const MAX_NODES = 1_000_000;
const MAX_OBSERVATIONS = 2_000_000;
const SHA256 = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left.localeCompare(right);
const radians = (value: number) => value * Math.PI / 180;
const normalizeLongitude = (value: number) => ((value + 540) % 360) - 180;
const distanceKm = (leftLat: number, leftLon: number, rightLat: number, rightLon: number) => {
  const latitudeDelta = radians(rightLat - leftLat);
  const longitudeDelta = radians(normalizeLongitude(rightLon - leftLon));
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
};
const timestamp = (value: unknown, code: string) => {
  const source = String(value);
  if (!/(?:z|[+-]\d{2}:\d{2})$/i.test(source)) fail(code);
  const date = new Date(source);
  if (!Number.isFinite(date.getTime())) fail(code);
  return date.toISOString();
};
const finiteOrNull = (value: unknown, code: string): number | null => {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code);
  return number;
};
const validateNodes = (nodes: readonly ContextualProviderPublicationSighting[]) => {
  if (!nodes.length || nodes.length > MAX_NODES) fail('contextual_provider_record_plan_invalid');
  const addresses = new Set<string>();
  return nodes.map((node) => {
    if (!node.address.startsWith('sighting:') || !SHA256.test(node.nodeDigest)
      || addresses.has(node.address)) fail('contextual_provider_record_node_invalid');
    addresses.add(node.address);
    const latitude = finiteOrNull(node.latitude, 'contextual_provider_record_node_invalid');
    const longitude = finiteOrNull(node.longitude, 'contextual_provider_record_node_invalid');
    if (latitude != null && (latitude < -90 || latitude > 90)
      || longitude != null && (longitude < -180 || longitude > 180)) {
      fail('contextual_provider_record_node_invalid');
    }
    return {
      ...node,
      eventTimestamp: node.eventTimestamp == null
        ? null
        : timestamp(node.eventTimestamp, 'contextual_provider_record_node_invalid'),
      latitude,
      longitude,
    };
  }).sort((left, right) => compare(left.address, right.address));
};
const validateBounds = (params: {
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
}) => {
  if (!Number.isFinite(params.maxDistanceKm) || params.maxDistanceKm <= 0 || params.maxDistanceKm > 500
    || !Number.isFinite(params.maxTimeDeltaMinutes) || params.maxTimeDeltaMinutes <= 0
    || params.maxTimeDeltaMinutes > 24 * 60 || !Number.isSafeInteger(params.limitPerAddress)
    || params.limitPerAddress < 1 || params.limitPerAddress > 20) {
    fail('contextual_provider_record_plan_invalid');
  }
};
const missingNodeRecord = (params: {
  snapshotId: string;
  publication: CaseGraphResearchPublicationBinding;
  node: ContextualProviderPublicationSighting;
  category: 'aircraft' | 'weather';
}) => makeCaseGraphExternalProviderArchiveRecord({
  snapshotId: params.snapshotId,
  publicationId: params.publication.publicationId,
  address: params.node.address,
  nodeDigest: params.node.nodeDigest,
  availability: 'insufficient_evidence',
  reasonCodes: ['sighting_time_or_location_missing'],
  explanation: `The governed ${params.category} source is available, but this sighting lacks a usable event time or location for a bounded comparison.`,
  candidates: [],
});

const aircraftObservedAt = (row: OpenSkyStateRow, snapshotTime: string) => (
  row.time_position || row.last_contact || new Date(snapshotTime)
).toISOString();

export const buildAdsbLolAircraftProviderRecords = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  nodes: ContextualProviderPublicationSighting[];
  archive: AdsbLolHistoricalArchive;
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
}): CaseGraphExternalProviderArchiveRecord[] => {
  validateBounds(params);
  if (params.archive.providerId !== 'adsb-lol' || params.archive.rows.length > MAX_OBSERVATIONS) {
    fail('contextual_provider_aircraft_archive_invalid');
  }
  const nodes = validateNodes(params.nodes);
  const snapshotTime = timestamp(
    params.archive.coverage.snapshotTime,
    'contextual_provider_aircraft_archive_invalid',
  );
  const rows = params.archive.rows.map((row) => {
    if (!row.icao24 || !row.snapshot_time || row.snapshot_time.toISOString() !== snapshotTime) {
      fail('contextual_provider_aircraft_archive_invalid');
    }
    const latitude = finiteOrNull(row.latitude, 'contextual_provider_aircraft_archive_invalid');
    const longitude = finiteOrNull(row.longitude, 'contextual_provider_aircraft_archive_invalid');
    if (latitude == null || longitude == null) return null;
    return {
      row,
      latitude,
      longitude,
      observedAt: aircraftObservedAt(row, snapshotTime),
    };
  }).filter((value): value is NonNullable<typeof value> => value !== null);
  const maxDeltaMs = params.maxTimeDeltaMinutes * 60_000;
  return nodes.map((node) => {
    if (!node.eventTimestamp || node.latitude == null || node.longitude == null) {
      return missingNodeRecord({ ...params, node, category: 'aircraft' });
    }
    const eventMs = Date.parse(node.eventTimestamp);
    if (Math.abs(Date.parse(snapshotTime) - eventMs) > maxDeltaMs) {
      return makeCaseGraphExternalProviderArchiveRecord({
        snapshotId: params.snapshotId,
        publicationId: params.publication.publicationId,
        address: node.address,
        nodeDigest: node.nodeDigest,
        availability: 'stale',
        reasonCodes: ['adsb_snapshot_outside_event_window'],
        explanation: `The immutable ADSB.lol snapshot is outside the configured ${params.maxTimeDeltaMinutes}-minute event window. Live aircraft positions were not substituted for this historical sighting.`,
        candidates: [],
      });
    }
    const candidates = rows.flatMap((entry) => {
      const deltaMinutes = Math.abs(Date.parse(entry.observedAt) - eventMs) / 60_000;
      if (deltaMinutes > params.maxTimeDeltaMinutes) return [];
      const distance = distanceKm(node.latitude!, node.longitude!, entry.latitude, entry.longitude);
      if (distance > params.maxDistanceKm) return [];
      return [{ entry, distance, deltaMinutes }];
    }).sort((left, right) => (
      left.deltaMinutes - right.deltaMinutes
      || left.distance - right.distance
      || compare(left.entry.row.icao24, right.entry.row.icao24)
    ));
    const limited = candidates.slice(0, params.limitPerAddress);
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId,
      publicationId: params.publication.publicationId,
      address: node.address,
      nodeDigest: node.nodeDigest,
      availability: 'available',
      reasonCodes: [
        ...(candidates.length > limited.length ? ['candidate_limit_applied'] : []),
        ...(params.archive.coverage.complete ? [] : ['aircraft_receiver_coverage_incomplete']),
        limited.length ? 'bounded_aircraft_candidates_available' : 'bounded_aircraft_window_checked_no_candidate',
      ],
      explanation: limited.length
        ? `${limited.length} archived aircraft comparison${limited.length === 1 ? '' : 's'} retained within ${params.maxDistanceKm} km and ${params.maxTimeDeltaMinutes} minutes. These are candidates, not identifications.`
        : `The immutable ADSB.lol snapshot was checked within ${params.maxDistanceKm} km and ${params.maxTimeDeltaMinutes} minutes and contained no candidate. Receiver and tile gaps mean aircraft are not ruled out.`,
      candidates: limited.map(({ entry, distance, deltaMinutes }): CaseGraphExternalCorrelationCandidateInput => ({
        sourceRecordId: `adsb-lol:${params.archive.archiveSha256}:${entry.row.icao24}`,
        label: entry.row.callsign
          ? `${entry.row.callsign.trim()} (${entry.row.icao24.toUpperCase()})`
          : `Aircraft ${entry.row.icao24.toUpperCase()}`,
        observedAt: entry.observedAt,
        measurements: {
          distance_km: Number(distance.toFixed(3)),
          time_delta_minutes: Number(deltaMinutes.toFixed(3)),
          latitude: entry.latitude,
          longitude: entry.longitude,
          barometric_altitude_m: entry.row.baro_altitude,
          geometric_altitude_m: entry.row.geo_altitude,
          velocity_m_s: entry.row.velocity,
          true_track_deg: entry.row.true_track,
          vertical_rate_m_s: entry.row.vertical_rate,
          on_ground: entry.row.on_ground,
          coverage_fraction: params.archive.coverage.coverageFraction,
        },
        reasonCodes: ['archived_adsb_position', 'bounded_spatiotemporal_match'],
        explanation: `The archived ADSB.lol position is ${distance.toFixed(1)} km and ${deltaMinutes.toFixed(1)} minutes from the report. It is a comparison, not proof that the aircraft caused the sighting.`,
        uncertainty: params.archive.coverage.limitations,
      })),
    });
  });
};

const weatherCandidate = (
  observation: NoaaNceiUsObservation,
  distance: number,
  deltaMinutes: number,
  source: NoaaNceiUsObservationResult,
): CaseGraphExternalCorrelationCandidateInput => ({
  sourceRecordId: observation.sourceRecordId,
  label: observation.stationName
    ? `${observation.stationName} (${observation.stationId})`
    : `NOAA station ${observation.stationId}`,
  observedAt: observation.observedAt,
  measurements: {
    ...observation.measurements,
    distance_km: Number(distance.toFixed(3)),
    time_delta_minutes: Number(deltaMinutes.toFixed(3)),
    station_latitude: observation.latitude,
    station_longitude: observation.longitude,
  },
  reasonCodes: ['bounded_noaa_station_observation', 'historical_weather_context'],
  explanation: `NOAA station ${observation.stationId} is ${distance.toFixed(1)} km from the report and the observation is ${deltaMinutes.toFixed(1)} minutes from its event time. Station weather is contextual evidence, not a causal identification.`,
  uncertainty: source.limitations,
});

export const buildNoaaWeatherProviderRecords = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  nodes: ContextualProviderPublicationSighting[];
  source: NoaaNceiUsObservationResult;
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
}): CaseGraphExternalProviderArchiveRecord[] => {
  validateBounds(params);
  if (params.source.providerId !== 'noaa-ncei-us-observations'
    || params.source.datasetVersion !== 'local-climatological-data-v2'
    || params.source.observations.length > MAX_OBSERVATIONS) {
    fail('contextual_provider_weather_archive_invalid');
  }
  const nodes = validateNodes(params.nodes);
  const observations = [...params.source.observations].map((observation) => ({
    ...observation,
    observedAt: timestamp(observation.observedAt, 'contextual_provider_weather_archive_invalid'),
  })).sort((left, right) => (
    compare(left.observedAt, right.observedAt)
    || compare(left.stationId, right.stationId)
    || compare(left.sourceRecordId, right.sourceRecordId)
  ));
  const sourceUrl = new URL(params.source.sourceUrl);
  const coverageStart = timestamp(
    sourceUrl.searchParams.get('startDate'),
    'contextual_provider_weather_archive_invalid',
  );
  const coverageEnd = timestamp(
    sourceUrl.searchParams.get('endDate'),
    'contextual_provider_weather_archive_invalid',
  );
  const maxDeltaMs = params.maxTimeDeltaMinutes * 60_000;
  return nodes.map((node) => {
    if (!node.eventTimestamp || node.latitude == null || node.longitude == null) {
      return missingNodeRecord({ ...params, node, category: 'weather' });
    }
    const eventMs = Date.parse(node.eventTimestamp);
    if (eventMs < Date.parse(coverageStart) || eventMs > Date.parse(coverageEnd)) {
      return makeCaseGraphExternalProviderArchiveRecord({
        snapshotId: params.snapshotId,
        publicationId: params.publication.publicationId,
        address: node.address,
        nodeDigest: node.nodeDigest,
        availability: 'stale',
        reasonCodes: ['noaa_query_window_does_not_cover_sighting'],
        explanation: 'The sealed NOAA query window does not cover this sighting time. A current or unrelated station observation was not substituted.',
        candidates: [],
      });
    }
    const candidates = observations.flatMap((observation) => {
      const deltaMinutes = Math.abs(Date.parse(observation.observedAt) - eventMs) / 60_000;
      if (deltaMinutes > params.maxTimeDeltaMinutes) return [];
      const distance = distanceKm(
        node.latitude!,
        node.longitude!,
        observation.latitude,
        observation.longitude,
      );
      return distance <= params.maxDistanceKm ? [{ observation, distance, deltaMinutes }] : [];
    }).sort((left, right) => (
      left.deltaMinutes - right.deltaMinutes
      || left.distance - right.distance
      || compare(left.observation.stationId, right.observation.stationId)
      || compare(left.observation.sourceRecordId, right.observation.sourceRecordId)
    ));
    const limited = candidates.slice(0, params.limitPerAddress);
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId,
      publicationId: params.publication.publicationId,
      address: node.address,
      nodeDigest: node.nodeDigest,
      availability: 'available',
      reasonCodes: [
        ...(candidates.length > limited.length ? ['candidate_limit_applied'] : []),
        limited.length ? 'bounded_weather_candidates_available' : 'bounded_weather_window_checked_no_candidate',
      ],
      explanation: limited.length
        ? `${limited.length} NOAA station observation${limited.length === 1 ? '' : 's'} retained within ${params.maxDistanceKm} km and ${params.maxTimeDeltaMinutes} minutes. These describe nearby station conditions, not conditions at the sighting itself.`
        : `The bounded NOAA query contained no station observation within ${params.maxDistanceKm} km and ${params.maxTimeDeltaMinutes} minutes. Data gaps mean weather is not ruled out.`,
      candidates: limited.map(({ observation, distance, deltaMinutes }) => (
        weatherCandidate(observation, distance, deltaMinutes, params.source)
      )),
    });
  });
};

const mergeWindowRecordSets = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  category: 'aircraft' | 'weather';
  nodes: ContextualProviderPublicationSighting[];
  recordSets: CaseGraphExternalProviderArchiveRecord[][];
  limitPerAddress: number;
}): CaseGraphExternalProviderArchiveRecord[] => {
  const nodes = validateNodes(params.nodes);
  if (!params.recordSets.length || params.recordSets.some((records) => records.length !== nodes.length)) {
    fail('contextual_provider_window_set_invalid');
  }
  const sets = params.recordSets.map((records) => new Map(records.map((record) => [record.address, record])));
  if (sets.some((records) => records.size !== nodes.length)) fail('contextual_provider_window_set_invalid');
  return nodes.map((node) => {
    const records = sets.map((set) => set.get(node.address)).filter(
      (record): record is CaseGraphExternalProviderArchiveRecord => Boolean(record),
    );
    if (records.length !== sets.length || records.some((record) => (
      record.publicationId !== params.publication.publicationId
      || record.nodeDigest !== node.nodeDigest
    ))) fail('contextual_provider_window_set_invalid');
    const candidates = records.flatMap((record) => record.candidates)
      .sort((left, right) => (
        Number(left.measurements.time_delta_minutes ?? Number.POSITIVE_INFINITY)
        - Number(right.measurements.time_delta_minutes ?? Number.POSITIVE_INFINITY)
        || Number(left.measurements.distance_km ?? Number.POSITIVE_INFINITY)
        - Number(right.measurements.distance_km ?? Number.POSITIVE_INFINITY)
        || compare(left.sourceRecordId, right.sourceRecordId)
      ));
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [
      `${candidate.sourceRecordId}\u0000${candidate.observedAt || ''}`,
      candidate,
    ])).values()];
    const limited = uniqueCandidates.slice(0, params.limitPerAddress);
    const available = records.filter((record) => record.availability === 'available');
    const missing = records.every((record) => record.availability === 'insufficient_evidence');
    const reasonCodes = [
      ...(uniqueCandidates.length > limited.length ? ['candidate_limit_applied'] : []),
      ...new Set(records.flatMap(({ reasonCodes: codes }) => codes).filter((code) => (
        available.length
          ? !code.endsWith('_outside_event_window') && code !== 'noaa_query_window_does_not_cover_sighting'
          : true
      ))),
      available.length
        ? limited.length
          ? `multi_window_${params.category}_candidates_available`
          : `multi_window_${params.category}_checked_no_candidate`
        : missing
          ? 'sighting_time_or_location_missing'
          : `multi_window_${params.category}_coverage_unavailable`,
    ].filter((code, index, values) => values.indexOf(code) === index).sort(compare);
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId,
      publicationId: params.publication.publicationId,
      address: node.address,
      nodeDigest: node.nodeDigest,
      availability: available.length ? 'available' : missing ? 'insufficient_evidence' : 'stale',
      reasonCodes,
      explanation: available.length
        ? limited.length
          ? `${limited.length} ${params.category} comparison${limited.length === 1 ? '' : 's'} retained from ${available.length} sealed in-window source snapshot${available.length === 1 ? '' : 's'}. They are candidates, not identifications or causal conclusions.`
          : `${available.length} sealed in-window ${params.category} snapshot${available.length === 1 ? '' : 's'} contained no bounded candidate. Provider coverage gaps mean the category is not ruled out.`
        : missing
          ? `The governed ${params.category} source windows are present, but this sighting lacks a usable event time or location.`
          : `None of the sealed ${params.category} source windows covers this sighting time; current or unrelated observations were not substituted.`,
      candidates: limited,
    });
  });
};

export const buildAdsbLolAircraftProviderRecordsFromArchives = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  nodes: ContextualProviderPublicationSighting[];
  archives: AdsbLolHistoricalArchive[];
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
}) => {
  if (!params.archives.length || params.archives.length > 100_000
    || new Set(params.archives.map(({ archiveSha256 }) => archiveSha256)).size !== params.archives.length) {
    fail('contextual_provider_window_set_invalid');
  }
  const recordSets = params.archives.map((archive) => buildAdsbLolAircraftProviderRecords({
    ...params,
    archive,
  }));
  return mergeWindowRecordSets({ ...params, category: 'aircraft', recordSets });
};

export const buildNoaaWeatherProviderRecordsFromWindows = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  nodes: ContextualProviderPublicationSighting[];
  sources: NoaaNceiUsObservationResult[];
  maxDistanceKm: number;
  maxTimeDeltaMinutes: number;
  limitPerAddress: number;
}) => {
  if (!params.sources.length || params.sources.length > 100_000
    || new Set(params.sources.map(({ sourceUrl }) => sourceUrl)).size !== params.sources.length) {
    fail('contextual_provider_window_set_invalid');
  }
  const recordSets = params.sources.map((source) => buildNoaaWeatherProviderRecords({
    ...params,
    source,
  }));
  return mergeWindowRecordSets({ ...params, category: 'weather', recordSets });
};

export const materializeAndPublishFreeContextualProviderArchive = async (params: {
  snapshot: Omit<
    CaseGraphExternalProviderArchiveSnapshot,
    'archiveObjectKey' | 'archiveObjectSha256' | 'archiveObjectBytes'
  >;
  records: CaseGraphExternalProviderArchiveRecord[];
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: (params: {
    key: string;
    body: Buffer;
    sha256: string;
    signal?: AbortSignal;
  }) => Promise<void>;
  verifyArchiveObject: Parameters<typeof publishCaseGraphExternalProviderArchive>[0]['verifyArchiveObject'];
  signal?: AbortSignal;
}) => {
  const identityValid = params.snapshot.contentMode === 'derived_only' && (
    params.snapshot.category === 'aircraft'
      && params.snapshot.canonicalSource === 'ADSB_LOL'
      && params.snapshot.providerId === 'adsb-lol'
    || params.snapshot.category === 'weather'
      && params.snapshot.canonicalSource === 'NOAA_NCEI_US_OBSERVATIONS'
      && params.snapshot.providerId === 'noaa-ncei-us-observations'
  );
  if (!identityValid || !params.records.length
    || params.records.some((record) => (
      record.snapshotId !== params.snapshot.snapshotId
      || record.publicationId !== params.snapshot.publication.publicationId
    ))) fail('contextual_provider_publication_plan_invalid');
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const archive = buildBalloonProviderArchiveObject(params.records);
  const category = params.snapshot.category;
  const provider = params.snapshot.providerId.replace(/[^a-z0-9-]/g, '-');
  const key = `case-vortex/external-providers/${category}/${provider}/${archive.sha256}.ndjson.gz`;
  await params.putArchiveObject({
    key,
    body: archive.body,
    sha256: archive.sha256,
    signal: params.signal,
  });
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  return publishCaseGraphExternalProviderArchive({
    snapshot: {
      ...params.snapshot,
      archiveObjectKey: key,
      archiveObjectSha256: archive.sha256,
      archiveObjectBytes: archive.bytes,
    },
    records: params.records,
    transaction: params.transaction,
    verifyArchiveObject: params.verifyArchiveObject,
    signal: params.signal,
  });
};
