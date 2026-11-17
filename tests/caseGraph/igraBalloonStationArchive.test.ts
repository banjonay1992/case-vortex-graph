import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  createGovernedIgraBalloonStationExternalCorrelationAdapter,
  loadIgraBalloonStationArchiveRecords,
  materializeAndPublishIgraBalloonStationArchive,
} from '../../src/caseGraph/igraBalloonStationArchive';
import type { CaseGraphExternalProviderArchiveTransaction } from '../../src/caseGraph/providerArchiveExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'igra-archive-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1', relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const snapshotId = '00000000-0000-4000-8000-000000000099';
const rows = [
  {
    address: 'sighting:case-a', node_digest: digest('6'), match_id: '00000000-0000-4000-8000-000000000011',
    match_source: 'igra_station', observed_at: '2026-07-21T12:00:00.000Z', distance_km: 12.5,
    time_delta_minutes: 14, confidence: 77.25, station_id: 'UKM00003772', station_name: 'HEATHROW',
    station_source: 'IGRA2', country_code: 'UK', state_code: null, lat: 51.478, lon: -0.461,
    elevation_m: 25, first_year: 1948, last_year: 2026, launch_count: 48000,
  },
  {
    address: 'sighting:case-a', node_digest: digest('6'), match_id: '00000000-0000-4000-8000-000000000012',
    match_source: 'igra_station', observed_at: '2026-07-21T12:00:00.000Z', distance_km: 20,
    time_delta_minutes: 5, confidence: 80, station_id: 'UKM00003743', station_name: 'LARKHILL',
    station_source: 'IGRA2', country_code: 'UK', state_code: 'ENG', lat: 51.2, lon: -1.8,
    elevation_m: null, first_year: 1950, last_year: null, launch_count: null,
  },
];

describe('IGRA2 station-context provider archive', () => {
  it('separates station context from actual launches and trajectories while ranking deterministically', async () => {
    const run = vi.fn(async () => ({ rows }));
    const records = await loadIgraBalloonStationArchiveRecords({
      publication, snapshotId, run, limitPerAddress: 1,
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining("match.match_source = 'igra_station'"), [
      publication.publicationId, '', '00000000-0000-0000-0000-000000000000', 5000,
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      address: 'sighting:case-a', availability: 'available',
      reasonCodes: ['candidate_limit_applied', 'sealed_igra_station_context_available'],
      candidates: [{
        sourceRecordId: 'igra-station-match:00000000-0000-4000-8000-000000000012',
        label: 'Historical launch station LARKHILL',
        reasonCodes: ['historical_launch_station_proximity', 'no_archived_flight_track'],
      }],
    });
    expect(records[0].explanation).toContain('not a balloon identification or flight track');
    expect(records[0].candidates[0].explanation).toContain('does not establish that a balloon launched');
    expect(records[0].candidates[0].uncertainty).toEqual(expect.arrayContaining([
      expect.stringContaining('nominal synoptic schedule proxy'),
      expect.stringContaining('not the probability'),
    ]));
  });

  it('produces deterministic archive bytes and publishes only metadata-only IGRA2 plans', async () => {
    const loaded = await loadIgraBalloonStationArchiveRecords({
      publication, snapshotId, run: async () => ({ rows }), limitPerAddress: 5,
    });
    const order: string[] = [];
    let receiptDigest = '';
    let recordSetSha256 = '';
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => work(async (sql, params = []) => {
      if (sql.includes('external-provider-archive:existing')) return { rows: [] };
      if (sql.includes('external-provider-archive:governance')) return { rows: [{
        public_manifest_sha256: publication.manifestSha256,
        legal_status: 'approved', allowed_content_modes: ['metadata_only'],
      }] };
      if (sql.includes('external-provider-archive:nodes')) return { rows: loaded.map((record) => ({
        address: record.address, node_digest: record.nodeDigest,
      })) };
      if (sql.includes('external-provider-archive:finalize')) {
        recordSetSha256 = String(params[2]); receiptDigest = String(params[3]);
      }
      if (sql.includes('external-provider-archive:completion-check')) return { rows: [{
        status: 'complete', record_count: String(loaded.length),
        record_set_sha256: recordSetSha256, receipt_sha256: receiptDigest,
      }] };
      return { rows: [] };
    });
    let archiveBody = Buffer.alloc(0);
    const result = await materializeAndPublishIgraBalloonStationArchive({
      snapshot: {
        snapshotId, publication, category: 'balloon', canonicalSource: 'IGRA2',
        contentMode: 'metadata_only', providerId: 'igra2-station-history', datasetVersion: '2.2',
        coverageStart: null, coverageEnd: null, acquiredAt: '2026-07-22T01:00:00.000Z',
        sourceUrl: 'https://www.ncei.noaa.gov/products/weather-balloon/integrated-global-radiosonde-archive',
        license: 'fixture',
      },
      run: async () => ({ rows }), transaction,
      putArchiveObject: async ({ body }) => { order.push('put'); archiveBody = body; },
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => {
        order.push('verify'); return { sha256: expectedSha256, bytes: expectedBytes };
      },
      limitPerAddress: 5,
    });
    expect(result).toMatchObject({ status: 'written', receipt: { recordCount: 1, candidateCount: 2 } });
    expect(order).toEqual(['put', 'verify']);
    expect(gunzipSync(archiveBody).toString('utf8')).toContain('no_archived_flight_track');
    await expect(materializeAndPublishIgraBalloonStationArchive({
      snapshot: { ...result.receipt.snapshot, contentMode: 'full_ingest' },
      run: async () => ({ rows }), transaction,
      putArchiveObject: vi.fn(), verifyArchiveObject: vi.fn(), limitPerAddress: 5,
    })).rejects.toThrow('case_graph_igra_station_provider_plan_invalid');
  });

  it('rejects track rows, malformed values and cancellation', async () => {
    await expect(loadIgraBalloonStationArchiveRecords({
      publication, snapshotId, run: async () => ({ rows: [{ ...rows[0], match_source: 'sondehub_track' }] }),
      limitPerAddress: 5,
    })).rejects.toThrow('case_graph_igra_station_provider_source_invalid');
    await expect(loadIgraBalloonStationArchiveRecords({
      publication, snapshotId, run: async () => ({ rows: [{ ...rows[0], lat: 100 }] }), limitPerAddress: 5,
    })).rejects.toThrow('case_graph_igra_station_provider_row_invalid');
    const controller = new AbortController(); controller.abort();
    await expect(loadIgraBalloonStationArchiveRecords({
      publication, snapshotId, run: vi.fn(), limitPerAddress: 5, signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
  });

  it('fails closed while the exact IGRA2 registry entry remains review-only', async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('source-governance')) return { rows: [{
        canonical_source: 'IGRA2', legal_status: 'review', allowed_content_modes: ['metadata_only'],
      }] };
      throw new Error('provider_archive_should_not_be_read');
    });
    const adapter = createGovernedIgraBalloonStationExternalCorrelationAdapter({ publication, snapshotId, run });
    await expect(adapter.correlate({
      publication, address: 'sighting:case-a', nodeDigest: digest('6'), limit: 5,
      checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toMatchObject({
      availability: 'unavailable', reasonCodes: ['source_governance_not_approved'], source: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
