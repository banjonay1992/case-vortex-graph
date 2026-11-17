import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { CaseGraphExternalCorrelationCandidateInput } from './externalCorrelationProviderAdapters';
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
import { canonicalizeRelationshipInput } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

const PAGE_SIZE = 5_000;
const MAX_SOURCE_ROWS = 2_000_000;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const fail = (code: string): never => { throw new Error(code); };
const finite = (value: unknown, nullable = false): number | null => {
  if (value == null && nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail('case_graph_balloon_provider_row_invalid');
  return number;
};
const text = (value: unknown, maximum = 500) => {
  const normalized = String(value || '').trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) {
    fail('case_graph_balloon_provider_row_invalid');
  }
  return normalized;
};
const timestamp = (value: unknown) => {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail('case_graph_balloon_provider_row_invalid');
  return date.toISOString();
};

type BalloonCandidateRow = {
  address: string;
  nodeDigest: string;
  matchId: string;
  observedAt: string;
  distanceKm: number;
  timeDeltaMinutes: number;
  confidence: number;
  trackId: string;
  serial: string | null;
  trackSource: string;
  altitudeM: number | null;
  latitude: number;
  longitude: number;
};

const decodeRow = (row: Record<string, unknown>): BalloonCandidateRow => {
  const matchSource = text(row.match_source, 80);
  if (matchSource !== 'sondehub_track') fail('case_graph_balloon_provider_source_invalid');
  const confidence = finite(row.confidence) as number;
  const distanceKm = finite(row.distance_km) as number;
  const timeDeltaMinutes = finite(row.time_delta_minutes) as number;
  if (confidence < 0 || confidence > 100 || distanceKm < 0 || timeDeltaMinutes < 0) {
    fail('case_graph_balloon_provider_row_invalid');
  }
  return {
    address: text(row.address, 250),
    nodeDigest: text(row.node_digest, 64),
    matchId: text(row.match_id, 80),
    observedAt: timestamp(row.observed_at),
    distanceKm,
    timeDeltaMinutes,
    confidence,
    trackId: text(row.track_id, 500),
    serial: row.serial == null ? null : text(row.serial, 240),
    trackSource: text(row.track_source, 240),
    altitudeM: finite(row.altitude_m, true),
    latitude: finite(row.lat) as number,
    longitude: finite(row.lon) as number,
  };
};

const candidate = (row: BalloonCandidateRow): CaseGraphExternalCorrelationCandidateInput => ({
  sourceRecordId: `balloon-match:${row.matchId}`,
  label: row.serial ? `Balloon track ${row.serial}` : `Balloon track ${row.trackId}`,
  observedAt: row.observedAt,
  measurements: {
    distance_km: row.distanceKm,
    time_delta_minutes: row.timeDeltaMinutes,
    heuristic_confidence_percent: row.confidence,
    altitude_m: row.altitudeM,
    latitude: row.latitude,
    longitude: row.longitude,
  },
  reasonCodes: ['archived_balloon_track_candidate', 'bounded_time_distance_match'],
  explanation: `The stored SondeHub correlation places track ${row.serial || row.trackId} ${row.distanceKm} km and ${row.timeDeltaMinutes} minutes from the reported event. This is a candidate comparison, not an identification.`,
  uncertainty: [
    'The confidence value is a deterministic proximity score, not a probability that the sighting was a balloon.',
    'The result inherits the sighting time and location precision and the archived track coverage.',
  ],
});

export const loadSondeHubBalloonProviderArchiveRecords = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  run: CaseGraphExternalProviderArchiveQuery;
  limitPerAddress: number;
  signal?: AbortSignal;
}): Promise<CaseGraphExternalProviderArchiveRecord[]> => {
  if (!Number.isSafeInteger(params.limitPerAddress) || params.limitPerAddress < 1 || params.limitPerAddress > 20) {
    fail('case_graph_balloon_provider_plan_invalid');
  }
  const grouped = new Map<string, { nodeDigest: string; rows: BalloonCandidateRow[] }>();
  let cursorAddress = '';
  let cursorMatchId = ZERO_UUID;
  let sourceRows = 0;
  for (;;) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const result = await params.run(
      `/* external-provider-archive:sondehub-balloon-page */
       SELECT node.address, node.node_digest, match.id::text AS match_id, match.match_source,
              match.observed_at, match.distance_km, match.time_delta_minutes, match.confidence,
              track.track_id, track.serial, track.source AS track_source,
              track.altitude_m, track.lat, track.lon
       FROM public.case_graph_research_search_publication_nodes node
       JOIN public.uap_balloon_sighting_matches match
         ON node.address = 'sighting:' || match.sighting_id::text
       JOIN public.uap_balloon_tracks track ON track.id = match.balloon_track_id
       WHERE node.publication_id = $1::uuid AND match.match_source = 'sondehub_track'
         AND (node.address COLLATE "C" > $2 OR (node.address = $2 AND match.id > $3::uuid))
       ORDER BY node.address COLLATE "C", match.id
       LIMIT $4`,
      [params.publication.publicationId, cursorAddress, cursorMatchId, PAGE_SIZE],
    );
    if (!result.rows.length) break;
    sourceRows += result.rows.length;
    if (sourceRows > MAX_SOURCE_ROWS) fail('case_graph_balloon_provider_source_too_large');
    for (const raw of result.rows) {
      const row = decodeRow(raw);
      const existing = grouped.get(row.address);
      if (existing && existing.nodeDigest !== row.nodeDigest) fail('case_graph_balloon_provider_node_conflict');
      if (existing) existing.rows.push(row);
      else grouped.set(row.address, { nodeDigest: row.nodeDigest, rows: [row] });
    }
    const last = result.rows[result.rows.length - 1];
    cursorAddress = text(last.address, 250);
    cursorMatchId = text(last.match_id, 80);
    if (result.rows.length < PAGE_SIZE) break;
  }
  return [...grouped.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([address, group]) => {
      const ranked = group.rows.sort((left, right) => (
        right.confidence - left.confidence || left.distanceKm - right.distanceKm
        || left.timeDeltaMinutes - right.timeDeltaMinutes || left.matchId.localeCompare(right.matchId)
      ));
      const limited = ranked.slice(0, params.limitPerAddress);
      return makeCaseGraphExternalProviderArchiveRecord({
        snapshotId: params.snapshotId,
        publicationId: params.publication.publicationId,
        address,
        nodeDigest: group.nodeDigest,
        availability: 'available',
        reasonCodes: ranked.length > limited.length
          ? ['candidate_limit_applied', 'sealed_sondehub_matches_available']
          : ['sealed_sondehub_matches_available'],
        explanation: `${limited.length} stored SondeHub track candidate${limited.length === 1 ? '' : 's'} retained from ${ranked.length} matched row${ranked.length === 1 ? '' : 's'}; candidates are comparisons, not identifications.`,
        candidates: limited.map(candidate),
      });
    });
};

export const buildBalloonProviderArchiveObject = (records: readonly CaseGraphExternalProviderArchiveRecord[]) => {
  const body = Buffer.from(`${records.map((record) => canonicalizeRelationshipInput(record)).join('\n')}${records.length ? '\n' : ''}`, 'utf8');
  const compressedBody = gzipSync(body, { level: 9 });
  return {
    body: compressedBody,
    sha256: createHash('sha256').update(compressedBody).digest('hex'),
    bytes: compressedBody.byteLength,
    uncompressedBytes: body.byteLength,
  };
};

export const materializeAndPublishSondeHubBalloonProviderArchive = async (params: {
  snapshot: Omit<CaseGraphExternalProviderArchiveSnapshot, 'archiveObjectKey' | 'archiveObjectSha256' | 'archiveObjectBytes'>;
  run: CaseGraphExternalProviderArchiveQuery;
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: (params: { key: string; body: Buffer; sha256: string; signal?: AbortSignal }) => Promise<void>;
  verifyArchiveObject: Parameters<typeof publishCaseGraphExternalProviderArchive>[0]['verifyArchiveObject'];
  limitPerAddress: number;
  signal?: AbortSignal;
}) => {
  if (params.snapshot.category !== 'balloon' || params.snapshot.providerId !== 'sondehub-archive') {
    fail('case_graph_balloon_provider_plan_invalid');
  }
  const records = await loadSondeHubBalloonProviderArchiveRecords({
    publication: params.snapshot.publication,
    snapshotId: params.snapshot.snapshotId,
    run: params.run,
    limitPerAddress: params.limitPerAddress,
    signal: params.signal,
  });
  const archive = buildBalloonProviderArchiveObject(records);
  const key = `case-vortex/external-providers/balloon/${archive.sha256}.ndjson.gz`;
  await params.putArchiveObject({ key, body: archive.body, sha256: archive.sha256, signal: params.signal });
  const snapshot: CaseGraphExternalProviderArchiveSnapshot = {
    ...params.snapshot,
    archiveObjectKey: key,
    archiveObjectSha256: archive.sha256,
    archiveObjectBytes: archive.bytes,
  };
  return publishCaseGraphExternalProviderArchive({
    snapshot,
    records,
    transaction: params.transaction,
    verifyArchiveObject: params.verifyArchiveObject,
    signal: params.signal,
  });
};

export const createGovernedSondeHubBalloonExternalCorrelationAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  run: CaseGraphExternalProviderArchiveQuery;
}) => {
  const archiveAdapter = createPostgresExternalProviderArchiveAdapter({
    publication: params.publication,
    snapshotId: params.snapshotId,
    category: 'balloon',
    run: params.run,
  });
  return createPostgresGovernedExternalCorrelationProviderAdapter({
    category: 'balloon',
    canonicalSource: 'SONDEHUB_ARCHIVE',
    providerId: 'sondehub-archive',
    allowedContentModes: ['metadata_only'],
    correlate: archiveAdapter.correlate,
    run: params.run,
  });
};
