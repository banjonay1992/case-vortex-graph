import type { QueryResult } from 'pg';

import {
  verifyAdsbLolHistoricalAssetPreflight,
  type AdsbLolHistoricalAssetPreflight,
} from './adsbLolHistoricalAssetPreflight';
import type { AdsbLolHistoricalReleasePlan } from './adsbLolHistoricalReleasePlan';
import {
  verifyAdsbLolHistoricalTargetedExtraction,
  type AdsbLolHistoricalTargetedExtraction,
} from './adsbLolHistoricalTargetedExtraction';

const COLUMNS = [
  'icao24', 'callsign', 'origin_country', 'time_position', 'last_contact',
  'longitude', 'latitude', 'baro_altitude', 'on_ground', 'velocity',
  'true_track', 'vertical_rate', 'geo_altitude', 'squawk', 'spi',
  'position_source', 'category', 'snapshot_time', 'source', 'ingested_at',
] as const;
const MAX_ROWS_PER_BATCH = 1_000;

export type AdsbLolHistoricalReplayRow = {
  icao24: string;
  callsign: string | null;
  origin_country: null;
  time_position: string;
  last_contact: string;
  longitude: number;
  latitude: number;
  baro_altitude: number | null;
  on_ground: boolean;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: null;
  geo_altitude: number | null;
  squawk: null;
  spi: null;
  position_source: null;
  category: null;
  snapshot_time: string;
  source: 'adsblol_history';
  ingested_at: string;
};

type Query = (
  sql: string,
  values: unknown[],
  options: { queryTimeoutMs: number; statementTimeoutMs: number },
) => Promise<Pick<QueryResult, 'rowCount'>>;

const defaultQuery: Query = async (sql, values, options) => {
  const { queryWithOptions } = await import('../db');
  return queryWithOptions(sql, values, options);
};

export const buildAdsbLolHistoricalReplayRows = (params: {
  extraction: AdsbLolHistoricalTargetedExtraction;
  ingestedAt: string;
}): AdsbLolHistoricalReplayRow[] => {
  const ingestedAt = new Date(params.ingestedAt);
  if (!Number.isFinite(ingestedAt.getTime()) || ingestedAt.toISOString() !== params.ingestedAt) {
    throw new Error('adsb_lol_replay_history_ingested_at_invalid');
  }
  const rows = new Map<string, AdsbLolHistoricalReplayRow>();
  for (const result of params.extraction.results) {
    for (const candidate of result.candidates) {
      const key = `${candidate.positionAt}:${candidate.aircraftIcao}`;
      if (rows.has(key)) continue;
      const altitudeM = typeof candidate.altitudeFeet === 'number'
        ? Number((candidate.altitudeFeet * 0.3048).toFixed(3))
        : null;
      rows.set(key, {
        icao24: candidate.aircraftIcao,
        callsign: candidate.callsign,
        origin_country: null,
        time_position: candidate.positionAt,
        last_contact: candidate.positionAt,
        longitude: candidate.longitude,
        latitude: candidate.latitude,
        baro_altitude: altitudeM,
        on_ground: candidate.altitudeFeet === 'ground',
        velocity: candidate.groundSpeedKnots == null
          ? null : Number((candidate.groundSpeedKnots * 0.514444).toFixed(3)),
        true_track: candidate.trackDegrees,
        vertical_rate: null,
        geo_altitude: altitudeM,
        squawk: null,
        spi: null,
        position_source: null,
        category: null,
        snapshot_time: candidate.positionAt,
        source: 'adsblol_history',
        ingested_at: params.ingestedAt,
      });
    }
  }
  return [...rows.values()].sort((left, right) => (
    left.snapshot_time.localeCompare(right.snapshot_time)
    || left.icao24.localeCompare(right.icao24)
  ));
};

export const persistAdsbLolHistoricalReplayHistory = async (params: {
  releasePlan: AdsbLolHistoricalReleasePlan;
  preflight: AdsbLolHistoricalAssetPreflight;
  extraction: AdsbLolHistoricalTargetedExtraction;
  checkedAt: string;
  query?: Query;
  batchSize?: number;
}) => {
  const preflight = verifyAdsbLolHistoricalAssetPreflight(
    params.preflight,
    params.releasePlan,
    params.checkedAt,
  );
  const extraction = verifyAdsbLolHistoricalTargetedExtraction({
    value: params.extraction,
    releasePlan: params.releasePlan,
    preflight,
    checkedAt: params.checkedAt,
  });
  const batchSize = params.batchSize ?? MAX_ROWS_PER_BATCH;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_ROWS_PER_BATCH) {
    throw new Error('adsb_lol_replay_history_batch_size_invalid');
  }
  const rows = buildAdsbLolHistoricalReplayRows({
    extraction,
    ingestedAt: params.checkedAt,
  });
  const runQuery = params.query ?? defaultQuery;
  let insertedRows = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flatMap((row) => COLUMNS.map((column) => row[column]));
    const placeholders = batch.map((_, rowIndex) => {
      const base = rowIndex * COLUMNS.length;
      return `(${COLUMNS.map((__, columnIndex) => `$${base + columnIndex + 1}`).join(', ')})`;
    }).join(', ');
    const result = await runQuery(
      `INSERT INTO opensky_state_vectors_history (${COLUMNS.join(', ')})
       VALUES ${placeholders}
       ON CONFLICT (snapshot_time, icao24) DO NOTHING`,
      values,
      { queryTimeoutMs: 60_000, statementTimeoutMs: 55_000 },
    );
    insertedRows += Number(result.rowCount ?? 0);
  }
  const searchValues = extraction.results.flatMap((result) => {
    const sightingId = result.address.startsWith('sighting:')
      ? result.address.slice('sighting:'.length)
      : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sightingId)) {
      throw new Error('adsb_lol_replay_history_sighting_address_invalid');
    }
    return [
      sightingId,
      'adsblol_history',
      extraction.releaseDate,
      result.status,
      result.candidates.length,
      extraction.extractionDigest,
      params.checkedAt,
    ];
  });
  if (searchValues.length) {
    const width = 7;
    const placeholders = extraction.results.map((_, rowIndex) => {
      const base = rowIndex * width;
      return `(${Array.from({ length: width }, (__, columnIndex) => `$${base + columnIndex + 1}`).join(', ')})`;
    }).join(', ');
    await runQuery(
      `INSERT INTO public.uap_aircraft_archive_searches (
         sighting_id, provider, release_date, result_status, candidate_count,
         extraction_digest, searched_at
       ) VALUES ${placeholders}
       ON CONFLICT (sighting_id) DO UPDATE SET
         provider = EXCLUDED.provider,
         release_date = EXCLUDED.release_date,
         result_status = EXCLUDED.result_status,
         candidate_count = EXCLUDED.candidate_count,
         extraction_digest = EXCLUDED.extraction_digest,
         searched_at = EXCLUDED.searched_at,
         updated_at = now()`,
      searchValues,
      { queryTimeoutMs: 60_000, statementTimeoutMs: 55_000 },
    );
  }
  return {
    candidateRows: extraction.accounting.candidateCount,
    uniqueRows: rows.length,
    insertedRows,
    existingRows: rows.length - insertedRows,
    searchedTargets: extraction.results.length,
    emptyTargets: extraction.results.filter(({ status }) => status === 'checked_no_match').length,
    source: 'adsblol_history' as const,
    releaseDate: extraction.releaseDate,
    extractionDigest: extraction.extractionDigest,
  };
};
