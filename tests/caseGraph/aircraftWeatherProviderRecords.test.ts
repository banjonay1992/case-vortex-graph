import { describe, expect, it } from 'vitest';

import { buildAdsbLolSnapshotArchive } from '../../src/workers/adsbLolSnapshotArchive';
import { decodeAdsbLolHistoricalArchive } from '../../src/caseGraph/freeContextualProviderObservations';
import {
  buildAdsbLolAircraftProviderRecords,
  buildAdsbLolAircraftProviderRecordsFromArchives,
  buildNoaaWeatherProviderRecords,
  buildNoaaWeatherProviderRecordsFromWindows,
  materializeAndPublishFreeContextualProviderArchive,
} from '../../src/caseGraph/aircraftWeatherProviderRecords';
import type { CaseGraphExternalProviderArchiveTransaction } from '../../src/caseGraph/providerArchiveExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'provider-records-v1',
  manifestSha256: digest('1'),
  snapshotId: 'snapshot-v1',
  graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1',
  relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'),
  relationshipModelId: 'model-v1',
  relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};
const snapshotId = '00000000-0000-4000-8000-000000000099';
const nodes = [
  {
    address: 'sighting:matched',
    nodeDigest: digest('6'),
    eventTimestamp: '2026-07-24T12:00:00.000Z',
    latitude: 51.5,
    longitude: -0.1,
  },
  {
    address: 'sighting:no-match',
    nodeDigest: digest('7'),
    eventTimestamp: '2026-07-24T12:00:00.000Z',
    latitude: 55,
    longitude: -4,
  },
  {
    address: 'sighting:old',
    nodeDigest: digest('8'),
    eventTimestamp: '1997-03-13T20:00:00.000Z',
    latitude: 33.4,
    longitude: -112.1,
  },
  {
    address: 'sighting:missing',
    nodeDigest: digest('9'),
    eventTimestamp: null,
    latitude: null,
    longitude: null,
  },
];

describe('aircraft and weather provider records', () => {
  it('uses only time-aligned immutable ADSB positions and preserves receiver gaps', async () => {
    const snapshotTime = new Date('2026-07-24T12:01:00.000Z');
    const built = await buildAdsbLolSnapshotArchive({
      snapshotTime,
      rows: [{
        icao24: 'abc123',
        callsign: 'TEST1',
        origin_country: 'United Kingdom',
        time_position: new Date('2026-07-24T12:00:30.000Z'),
        last_contact: new Date('2026-07-24T12:00:40.000Z'),
        longitude: -0.1,
        latitude: 51.51,
        baro_altitude: 1_000,
        on_ground: false,
        velocity: 80,
        true_track: 180,
        vertical_rate: 0,
        geo_altitude: 1_050,
        squawk: '7000',
        spi: false,
        position_source: 0,
        category: 1,
        snapshot_time: snapshotTime,
        source: 'adsblol',
      }],
      tileResults: [
        { label: 'tile-a', ok: true, rowCount: 1, durationMs: 50 },
        { label: 'tile-b', ok: false, rowCount: 0, durationMs: 50, error: 'timeout' },
      ],
    });
    const archive = decodeAdsbLolHistoricalArchive({
      archiveBody: built.archiveBody,
      manifestBody: built.manifestBody,
    });
    const records = buildAdsbLolAircraftProviderRecords({
      publication,
      snapshotId,
      nodes,
      archive,
      maxDistanceKm: 100,
      maxTimeDeltaMinutes: 5,
      limitPerAddress: 5,
    });
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      address: 'sighting:matched',
      availability: 'available',
      reasonCodes: [
        'aircraft_receiver_coverage_incomplete',
        'bounded_aircraft_candidates_available',
      ],
      candidates: [{
        sourceRecordId: expect.stringContaining('adsb-lol:'),
        measurements: { time_delta_minutes: 0.5 },
      }],
    });
    expect(records[2]).toMatchObject({
      address: 'sighting:no-match',
      availability: 'available',
      reasonCodes: [
        'aircraft_receiver_coverage_incomplete',
        'bounded_aircraft_window_checked_no_candidate',
      ],
      candidates: [],
    });
    expect(records[3]).toMatchObject({
      address: 'sighting:old',
      availability: 'stale',
      reasonCodes: ['adsb_snapshot_outside_event_window'],
    });
    expect(records[3].explanation).toContain('Live aircraft positions were not substituted');
  });

  it('builds bounded NOAA station candidates, checked-no-match, stale and missing-input states', () => {
    const sourceUrl = new URL('https://www.ncei.noaa.gov/access/services/data/v1');
    sourceUrl.searchParams.set('startDate', '2026-07-24T10:00:00.000Z');
    sourceUrl.searchParams.set('endDate', '2026-07-24T14:00:00.000Z');
    const records = buildNoaaWeatherProviderRecords({
      publication,
      snapshotId,
      nodes,
      source: {
        providerId: 'noaa-ncei-us-observations',
        datasetVersion: 'local-climatological-data-v2',
        sourceUrl: sourceUrl.toString(),
        acquiredAt: '2026-07-25T00:00:00.000Z',
        excludedNonUsRows: 0,
        observations: [{
          sourceRecordId: 'noaa-lcdv2:USW00000001:2026-07-24T12:05:00.000Z:abc',
          stationId: 'USW00000001',
          stationName: 'LONDON FIXTURE',
          observedAt: '2026-07-24T12:05:00.000Z',
          latitude: 51.51,
          longitude: -0.1,
          measurements: {
            HourlyVisibility: 10,
            HourlySkyConditions: 'BKN',
          },
          sourceSha256: digest('a'),
        }],
        limitations: [
          'Station coverage is incomplete.',
          'No observation is not proof of clear weather.',
        ],
      },
      maxDistanceKm: 100,
      maxTimeDeltaMinutes: 30,
      limitPerAddress: 5,
    });
    expect(records[0]).toMatchObject({
      address: 'sighting:matched',
      availability: 'available',
      reasonCodes: ['bounded_weather_candidates_available'],
      candidates: [{
        label: 'LONDON FIXTURE (USW00000001)',
        measurements: { time_delta_minutes: 5, HourlyVisibility: 10 },
      }],
    });
    expect(records[0].candidates[0].explanation).toContain('not a causal identification');
    expect(records[1]).toMatchObject({
      address: 'sighting:missing',
      availability: 'insufficient_evidence',
      reasonCodes: ['sighting_time_or_location_missing'],
    });
    expect(records[2]).toMatchObject({
      address: 'sighting:no-match',
      availability: 'available',
      reasonCodes: ['bounded_weather_window_checked_no_candidate'],
    });
    expect(records[3]).toMatchObject({
      address: 'sighting:old',
      availability: 'stale',
      reasonCodes: ['noaa_query_window_does_not_cover_sighting'],
    });
  });

  it('rejects duplicate nodes and unsafe correlation bounds', async () => {
    const snapshotTime = new Date('2026-07-24T12:01:00.000Z');
    const built = await buildAdsbLolSnapshotArchive({
      snapshotTime,
      rows: [],
      tileResults: [{ label: 'tile-a', ok: true, rowCount: 0, durationMs: 50 }],
    });
    const archive = decodeAdsbLolHistoricalArchive({
      archiveBody: built.archiveBody,
      manifestBody: built.manifestBody,
    });
    expect(() => buildAdsbLolAircraftProviderRecords({
      publication,
      snapshotId,
      nodes: [nodes[0], nodes[0]],
      archive,
      maxDistanceKm: 100,
      maxTimeDeltaMinutes: 5,
      limitPerAddress: 5,
    })).toThrow('contextual_provider_record_node_invalid');
    expect(() => buildAdsbLolAircraftProviderRecords({
      publication,
      snapshotId,
      nodes,
      archive,
      maxDistanceKm: 50_000,
      maxTimeDeltaMinutes: 5,
      limitPerAddress: 5,
    })).toThrow('contextual_provider_record_plan_invalid');
  });

  it('merges sealed windows into one deterministic record per publication sighting', async () => {
    const archiveAt = async (time: string, icao24: string, latitude: number, complete = true) => {
      const snapshotTime = new Date(time);
      const built = await buildAdsbLolSnapshotArchive({
        snapshotTime,
        rows: [{
          icao24,
          callsign: icao24.toUpperCase(),
          origin_country: null,
          time_position: snapshotTime,
          last_contact: snapshotTime,
          longitude: -0.1,
          latitude,
          baro_altitude: 1_000,
          on_ground: false,
          velocity: 80,
          true_track: 180,
          vertical_rate: 0,
          geo_altitude: 1_050,
          squawk: null,
          spi: false,
          position_source: 0,
          category: 1,
          snapshot_time: snapshotTime,
          source: 'adsblol',
        }],
        tileResults: complete
          ? [{ label: 'tile-a', ok: true, rowCount: 1, durationMs: 10 }]
          : [
            { label: 'tile-a', ok: true, rowCount: 1, durationMs: 10 },
            { label: 'tile-b', ok: false, rowCount: 0, durationMs: 10, error: 'timeout' },
          ],
      });
      return decodeAdsbLolHistoricalArchive({
        archiveBody: built.archiveBody,
        manifestBody: built.manifestBody,
      });
    };
    const archives = await Promise.all([
      archiveAt('2026-07-24T12:00:30.000Z', 'abc123', 51.51, false),
      archiveAt('2026-07-24T12:02:00.000Z', 'def456', 51.52),
    ]);
    const forward = buildAdsbLolAircraftProviderRecordsFromArchives({
      publication,
      snapshotId,
      nodes,
      archives,
      maxDistanceKm: 100,
      maxTimeDeltaMinutes: 5,
      limitPerAddress: 5,
    });
    const reverse = buildAdsbLolAircraftProviderRecordsFromArchives({
      publication,
      snapshotId,
      nodes,
      archives: [...archives].reverse(),
      maxDistanceKm: 100,
      maxTimeDeltaMinutes: 5,
      limitPerAddress: 5,
    });
    expect(reverse).toEqual(forward);
    expect(forward[0]).toMatchObject({
      address: 'sighting:matched',
      availability: 'available',
      candidates: [
        { sourceRecordId: expect.stringContaining(':abc123') },
        { sourceRecordId: expect.stringContaining(':def456') },
      ],
    });
    expect(forward[0].reasonCodes).toContain('multi_window_aircraft_candidates_available');
    expect(forward[3]).toMatchObject({
      address: 'sighting:old',
      availability: 'stale',
      candidates: [],
    });
  });

  it('merges NOAA windows and publishes the exact immutable archive only after upload', async () => {
    const source = (start: string, end: string, observations: any[]) => {
      const url = new URL('https://www.ncei.noaa.gov/access/services/data/v1');
      url.searchParams.set('startDate', start);
      url.searchParams.set('endDate', end);
      return {
        providerId: 'noaa-ncei-us-observations' as const,
        datasetVersion: 'local-climatological-data-v2' as const,
        sourceUrl: url.toString(),
        acquiredAt: '2026-07-25T00:00:00.000Z',
        excludedNonUsRows: 0,
        observations,
        limitations: ['Station coverage is incomplete.'],
      };
    };
    const sources = [
      source('2026-07-24T10:00:00.000Z', '2026-07-24T13:00:00.000Z', [{
        sourceRecordId: 'noaa:one',
        stationId: 'USW00000001',
        stationName: 'ONE',
        observedAt: '2026-07-24T12:05:00.000Z',
        latitude: 51.51,
        longitude: -0.1,
        measurements: { HourlyVisibility: 10 },
        sourceSha256: digest('a'),
      }]),
      source('2026-07-24T11:00:00.000Z', '2026-07-24T14:00:00.000Z', [{
        sourceRecordId: 'noaa:two',
        stationId: 'USW00000002',
        stationName: 'TWO',
        observedAt: '2026-07-24T12:10:00.000Z',
        latitude: 51.52,
        longitude: -0.1,
        measurements: { HourlyVisibility: 8 },
        sourceSha256: digest('b'),
      }]),
    ];
    const records = buildNoaaWeatherProviderRecordsFromWindows({
      publication,
      snapshotId,
      nodes,
      sources,
      maxDistanceKm: 100,
      maxTimeDeltaMinutes: 30,
      limitPerAddress: 5,
    });
    expect(records[0].candidates.map(({ sourceRecordId }) => sourceRecordId)).toEqual([
      'noaa:one',
      'noaa:two',
    ]);
    const order: string[] = [];
    let receiptDigest = '';
    let recordSetSha256 = '';
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => {
      order.push('transaction');
      return work(async (sql, values = []) => {
        if (sql.includes('external-provider-archive:existing')) return { rows: [] };
        if (sql.includes('external-provider-archive:governance')) return { rows: [{
          public_manifest_sha256: publication.manifestSha256,
          legal_status: 'approved',
          allowed_content_modes: ['derived_only'],
        }] };
        if (sql.includes('external-provider-archive:nodes')) return { rows: records.map((record) => ({
          address: record.address,
          node_digest: record.nodeDigest,
        })) };
        if (sql.includes('external-provider-archive:finalize')) {
          recordSetSha256 = String(values[2]);
          receiptDigest = String(values[3]);
        }
        if (sql.includes('external-provider-archive:completion-check')) return { rows: [{
          status: 'complete',
          record_count: String(records.length),
          record_set_sha256: recordSetSha256,
          receipt_sha256: receiptDigest,
        }] };
        return { rows: [] };
      });
    };
    const result = await materializeAndPublishFreeContextualProviderArchive({
      snapshot: {
        snapshotId,
        publication,
        category: 'weather',
        canonicalSource: 'NOAA_NCEI_US_OBSERVATIONS',
        contentMode: 'derived_only',
        providerId: 'noaa-ncei-us-observations',
        datasetVersion: 'local-climatological-data-v2',
        coverageStart: '2026-07-24T10:00:00.000Z',
        coverageEnd: '2026-07-24T14:00:00.000Z',
        acquiredAt: '2026-07-25T00:00:00.000Z',
        sourceUrl: 'https://www.ncei.noaa.gov/access/services/data/v1',
        license: 'NOAA-created U.S. observations; acknowledgement required',
      },
      records,
      transaction,
      putArchiveObject: async () => { order.push('put'); },
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => {
        order.push('verify');
        return { sha256: expectedSha256, bytes: expectedBytes };
      },
    });
    expect(result).toMatchObject({
      status: 'written',
      receipt: { recordCount: 4, candidateCount: 2 },
    });
    expect(order).toEqual(['put', 'verify', 'transaction']);
  });
});
