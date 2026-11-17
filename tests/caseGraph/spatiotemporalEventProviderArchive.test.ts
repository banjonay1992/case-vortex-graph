import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  buildSpatiotemporalEventArchiveRecords,
  createGovernedSpatiotemporalEventExternalCorrelationAdapter,
  loadPublicationSightingsForEventCorrelation,
  materializeAndPublishSpatiotemporalEventArchive,
  nasaCneosFireballsToProviderEvents,
  rocketLaunchesToProviderEvents,
  type SpatiotemporalProviderEvent,
} from '../../src/caseGraph/spatiotemporalEventProviderArchive';
import type { CaseGraphExternalProviderArchiveTransaction } from '../../src/caseGraph/providerArchiveExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'events-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1', relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const snapshotId = '00000000-0000-4000-8000-000000000099';
const nodes = [
  { address: 'sighting:case-a', nodeDigest: digest('6'), eventTimestamp: '2026-07-21T20:00:00.000Z', latitude: 51.5, longitude: -0.1 },
  { address: 'sighting:case-b', nodeDigest: digest('7'), eventTimestamp: '2026-07-20T20:00:00.000Z', latitude: 51.5, longitude: -0.1 },
  { address: 'sighting:case-c', nodeDigest: digest('8'), eventTimestamp: null, latitude: 51.5, longitude: -0.1 },
];
const events: SpatiotemporalProviderEvent[] = [{
  sourceRecordId: 'cneos:20260721-2005', label: 'NASA CNEOS fireball',
  occurredAt: '2026-07-21T20:05:00.000Z', latitude: 51.55, longitude: -0.1,
  measurements: { impact_energy_kt: 2.5, altitude_km: 35 },
  reasonCodes: ['observed_fireball_event'],
  explanation: 'NASA CNEOS records an atmospheric fireball at the supplied coordinates.',
  uncertainty: ['The public event location and time may be rounded.'],
}];

describe('spatiotemporal event provider archives', () => {
  it('retains bounded meteor matches, explicit checked-no-match and insufficient-input states', () => {
    const records = buildSpatiotemporalEventArchiveRecords({
      publication, snapshotId, category: 'meteor', nodes, events,
      maxDistanceKm: 100, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    });
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      address: 'sighting:case-a', availability: 'available', reasonCodes: ['bounded_event_candidates_available'],
      candidates: [{ sourceRecordId: 'cneos:20260721-2005', measurements: { time_delta_minutes: 5 } }],
    });
    expect(records[0].candidates[0].explanation).toContain('comparison, not an identification');
    expect(records[1]).toMatchObject({
      address: 'sighting:case-b', availability: 'available',
      reasonCodes: ['bounded_event_window_checked_no_candidate'], candidates: [],
    });
    expect(records[1].explanation).toContain('Coverage gaps mean the category is not ruled out');
    expect(records[2]).toMatchObject({
      address: 'sighting:case-c', availability: 'insufficient_evidence',
      reasonCodes: ['sighting_time_or_location_missing'], candidates: [],
    });
  });

  it('loads publication-bound sighting coordinates in deterministic pages', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ rows: nodes.map((node) => ({
        address: node.address, node_digest: node.nodeDigest,
        event_timestamp: node.eventTimestamp, lat: node.latitude, lon: node.longitude,
      })) });
    const loaded = await loadPublicationSightingsForEventCorrelation({ publication, run });
    expect(loaded).toEqual(nodes);
    expect(run).toHaveBeenCalledWith(expect.stringContaining("node.address = 'sighting:' || sighting.id::text"), [
      publication.publicationId, '', 5000,
    ]);
  });

  it('normalizes the existing CNEOS and rocket feeds without hiding provider limitations', () => {
    const meteors = nasaCneosFireballsToProviderEvents([{
      id: 'nasa-cneos-1', kind: 'meteor', source: 'nasa_cneos', label: 'Meteor / fireball',
      description: 'NASA CNEOS fireball event.', lat: 40, lon: -105,
      occurred_at: '2026-07-21T20:00:00.000Z', forecast_at: null, strength: 2.5,
      altitude_km: 30, velocity_km_s: 15, confidence: 0.92, live: false, historical: true,
    }]);
    expect(meteors[0]).toMatchObject({
      sourceRecordId: 'nasa-cneos-1', reasonCodes: ['nasa_cneos_fireball_event'],
      measurements: { altitude_km: 30, velocity_km_s: 15 },
    });
    expect(meteors[0].uncertainty).toEqual(expect.arrayContaining([expect.stringContaining('does not capture every')]));

    const launches = rocketLaunchesToProviderEvents([{
      id: 'launch-1', slug: 'launch-1', name: 'Example mission', status: 'Scheduled', provider: 'Agency',
      vehicle: 'Rocket', mission: 'Payload', padName: 'Pad 1', locationName: 'Spaceport', countryCode: 'US',
      lat: 28.5, lon: -80.6, net: '2026-07-21T20:00:00.000Z', windowStart: null, windowEnd: null,
      imageUrl: null, infoUrl: null, webcastUrl: null, upcoming: true, recent: false, live: false,
      source: 'rocketlaunch_live',
    }]);
    expect(launches[0]).toMatchObject({
      sourceRecordId: 'launch-1', reasonCodes: ['rocket_launch_schedule_event'],
      measurements: { launch_pad: 'Pad 1', status: 'Scheduled' },
    });
    expect(launches[0].uncertainty).toEqual(expect.arrayContaining([expect.stringContaining('trajectory')]));
  });

  it('is deterministic across event input order and dateline-aware', () => {
    const datelineNodes = [{
      address: 'sighting:dateline', nodeDigest: digest('9'), eventTimestamp: '2026-07-21T20:00:00.000Z',
      latitude: 0, longitude: 179.9,
    }];
    const second = { ...events[0], sourceRecordId: 'cneos:dateline', latitude: 0, longitude: -179.9 };
    const first = buildSpatiotemporalEventArchiveRecords({
      publication, snapshotId, category: 'meteor', nodes: datelineNodes, events: [events[0], second],
      maxDistanceKm: 50, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    });
    const reversed = buildSpatiotemporalEventArchiveRecords({
      publication, snapshotId, category: 'meteor', nodes: datelineNodes, events: [second, events[0]],
      maxDistanceKm: 50, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    });
    expect(reversed).toEqual(first);
    expect(first[0].candidates).toHaveLength(1);
    expect(first[0].candidates[0].sourceRecordId).toBe('cneos:dateline');
  });

  it('archives and publishes every publication sighting only after object upload', async () => {
    let receiptDigest = ''; let recordSetSha256 = ''; let body = Buffer.alloc(0);
    const order: string[] = [];
    const expectedRecords = buildSpatiotemporalEventArchiveRecords({
      publication, snapshotId, category: 'meteor', nodes, events,
      maxDistanceKm: 100, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    });
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => {
      order.push('transaction');
      return work(async (sql, params = []) => {
        if (sql.includes('external-provider-archive:existing')) return { rows: [] };
        if (sql.includes('external-provider-archive:governance')) return { rows: [{
          public_manifest_sha256: publication.manifestSha256, legal_status: 'approved', allowed_content_modes: ['metadata_only'],
        }] };
        if (sql.includes('external-provider-archive:nodes')) return { rows: expectedRecords.map((record) => ({
          address: record.address, node_digest: record.nodeDigest,
        })) };
        if (sql.includes('external-provider-archive:finalize')) {
          recordSetSha256 = String(params[2]); receiptDigest = String(params[3]);
        }
        if (sql.includes('external-provider-archive:completion-check')) return { rows: [{
          status: 'complete', record_count: String(expectedRecords.length),
          record_set_sha256: recordSetSha256, receipt_sha256: receiptDigest,
        }] };
        return { rows: [] };
      });
    };
    const result = await materializeAndPublishSpatiotemporalEventArchive({
      snapshot: {
        snapshotId, publication, category: 'meteor', canonicalSource: 'NASA_CNEOS_FIREBALL',
        contentMode: 'metadata_only', providerId: 'nasa-cneos-fireball', datasetVersion: '2026-07-21',
        coverageStart: '2026-07-20T00:00:00.000Z', coverageEnd: '2026-07-22T00:00:00.000Z',
        acquiredAt: '2026-07-22T01:00:00.000Z', sourceUrl: 'https://ssd-api.jpl.nasa.gov/fireball.api',
        license: 'fixture',
      },
      events,
      run: async () => ({ rows: nodes.map((node) => ({
        address: node.address, node_digest: node.nodeDigest,
        event_timestamp: node.eventTimestamp, lat: node.latitude, lon: node.longitude,
      })) }),
      transaction,
      putArchiveObject: async ({ body: value }) => { order.push('put'); body = value; },
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => {
        order.push('verify'); return { sha256: expectedSha256, bytes: expectedBytes };
      },
      maxDistanceKm: 100, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    });
    expect(result).toMatchObject({ status: 'written', receipt: { recordCount: 3, candidateCount: 1 } });
    expect(order).toEqual(['put', 'verify', 'transaction']);
    expect(gunzipSync(body).toString('utf8')).toContain('bounded_event_window_checked_no_candidate');
  });

  it('rejects duplicates, malformed bounds, cancellation and review-only governance', async () => {
    expect(() => buildSpatiotemporalEventArchiveRecords({
      publication, snapshotId, category: 'launch', nodes, events: [events[0], events[0]],
      maxDistanceKm: 100, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    })).toThrow('case_graph_event_provider_duplicate_event');
    expect(() => buildSpatiotemporalEventArchiveRecords({
      publication, snapshotId, category: 'launch', nodes, events,
      maxDistanceKm: 0, maxTimeDeltaMinutes: 60, limitPerAddress: 5,
    })).toThrow('case_graph_event_provider_plan_invalid');
    const controller = new AbortController(); controller.abort();
    await expect(loadPublicationSightingsForEventCorrelation({
      publication, run: vi.fn(), signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('source-governance')) return { rows: [{
        canonical_source: 'NASA_CNEOS_FIREBALL', legal_status: 'review', allowed_content_modes: ['metadata_only'],
      }] };
      throw new Error('provider_archive_should_not_be_read');
    });
    const adapter = createGovernedSpatiotemporalEventExternalCorrelationAdapter({
      publication, snapshotId, category: 'meteor', canonicalSource: 'NASA_CNEOS_FIREBALL',
      providerId: 'nasa-cneos-fireball', run,
    });
    await expect(adapter.correlate({
      publication, address: nodes[0].address, nodeDigest: nodes[0].nodeDigest,
      limit: 5, checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toMatchObject({ availability: 'unavailable', reasonCodes: ['source_governance_not_approved'] });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
