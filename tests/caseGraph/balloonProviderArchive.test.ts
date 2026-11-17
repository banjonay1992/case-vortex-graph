import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  buildBalloonProviderArchiveObject,
  createGovernedSondeHubBalloonExternalCorrelationAdapter,
  loadSondeHubBalloonProviderArchiveRecords,
  materializeAndPublishSondeHubBalloonProviderArchive,
} from '../../src/caseGraph/balloonProviderArchive';
import type { CaseGraphExternalProviderArchiveTransaction } from '../../src/caseGraph/providerArchiveExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'balloon-archive-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1', relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const snapshotId = '00000000-0000-4000-8000-000000000099';
const rows = [
  {
    address: 'sighting:case-a', node_digest: digest('6'), match_id: '00000000-0000-4000-8000-000000000011',
    match_source: 'sondehub_track', observed_at: '2026-07-21T20:00:00.000Z', distance_km: '12.5',
    time_delta_minutes: 8, confidence: '94.25', track_id: 'track-11', serial: 'RS41-11',
    track_source: 'SONDEHUB', altitude_m: 18250, lat: 51.5, lon: -0.1,
  },
  {
    address: 'sighting:case-a', node_digest: digest('6'), match_id: '00000000-0000-4000-8000-000000000012',
    match_source: 'sondehub_track', observed_at: '2026-07-21T19:50:00.000Z', distance_km: 20,
    time_delta_minutes: 18, confidence: 82, track_id: 'track-12', serial: null,
    track_source: 'SONDEHUB', altitude_m: null, lat: 51.6, lon: -0.2,
  },
  {
    address: 'sighting:case-b', node_digest: digest('7'), match_id: '00000000-0000-4000-8000-000000000013',
    match_source: 'sondehub_track', observed_at: '2026-07-21T21:00:00.000Z', distance_km: 5,
    time_delta_minutes: 2, confidence: 98, track_id: 'track-13', serial: 'RS41-13',
    track_source: 'SONDEHUB', altitude_m: 22000, lat: 52, lon: 0.1,
  },
];

describe('SondeHub balloon provider archive materialization', () => {
  it('groups, ranks and bounds stored track candidates without claiming identification', async () => {
    const run = vi.fn(async () => ({ rows }));
    const records = await loadSondeHubBalloonProviderArchiveRecords({
      publication, snapshotId, run, limitPerAddress: 1,
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining("match.match_source = 'sondehub_track'"), [
      publication.publicationId, '', '00000000-0000-0000-0000-000000000000', 5000,
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      address: 'sighting:case-a', availability: 'available',
      reasonCodes: ['candidate_limit_applied', 'sealed_sondehub_matches_available'],
      candidates: [{
        sourceRecordId: 'balloon-match:00000000-0000-4000-8000-000000000011',
        label: 'Balloon track RS41-11',
        measurements: { distance_km: 12.5, heuristic_confidence_percent: 94.25 },
      }],
    });
    expect(records[0].candidates[0].explanation).toContain('candidate comparison, not an identification');
    expect(records[0].candidates[0].uncertainty[0]).toContain('not a probability');
  });

  it('creates byte-deterministic compressed NDJSON for R2', async () => {
    const records = await loadSondeHubBalloonProviderArchiveRecords({
      publication, snapshotId, run: async () => ({ rows }), limitPerAddress: 5,
    });
    const first = buildBalloonProviderArchiveObject(records);
    const second = buildBalloonProviderArchiveObject([...records]);
    expect(second).toEqual(first);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(gunzipSync(first.body).toString('utf8')).toContain('candidate comparison, not an identification');
  });

  it('uploads the content-addressed object before atomically publishing an empty honest snapshot', async () => {
    const order: string[] = [];
    let receiptDigest = '';
    let recordSetSha256 = '';
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => {
      order.push('transaction');
      return work(async (sql, params = []) => {
        if (sql.includes('external-provider-archive:existing')) return { rows: [] };
        if (sql.includes('external-provider-archive:governance')) return { rows: [{
          public_manifest_sha256: publication.manifestSha256,
          legal_status: 'approved', allowed_content_modes: ['metadata_only'],
        }] };
        if (sql.includes('external-provider-archive:finalize')) {
          recordSetSha256 = String(params[2]);
          receiptDigest = String(params[3]);
          return { rows: [] };
        }
        if (sql.includes('external-provider-archive:completion-check')) return { rows: [{
          status: 'complete', record_count: '0', record_set_sha256: recordSetSha256, receipt_sha256: receiptDigest,
        }] };
        return { rows: [] };
      });
    };
    const putArchiveObject = vi.fn(async () => { order.push('put'); });
    const verifyArchiveObject = vi.fn(async ({ expectedSha256, expectedBytes }) => {
      order.push('verify');
      return { sha256: expectedSha256, bytes: expectedBytes };
    });
    const result = await materializeAndPublishSondeHubBalloonProviderArchive({
      snapshot: {
        snapshotId, publication, category: 'balloon', canonicalSource: 'SONDEHUB_ARCHIVE',
        contentMode: 'metadata_only', providerId: 'sondehub-archive', datasetVersion: '2026-07-21',
        coverageStart: null, coverageEnd: null, acquiredAt: '2026-07-22T01:00:00.000Z',
        sourceUrl: 'https://sondehub.org/', license: 'approved fixture',
      },
      run: async () => ({ rows: [] }), transaction, putArchiveObject, verifyArchiveObject,
      limitPerAddress: 5,
    });
    expect(result).toMatchObject({ status: 'written', receipt: { recordCount: 0, candidateCount: 0 } });
    expect(order).toEqual(['put', 'verify', 'transaction']);
    expect(putArchiveObject.mock.calls[0][0].key).toMatch(
      /^case-vortex\/external-providers\/balloon\/[a-f0-9]{64}\.ndjson\.gz$/,
    );
  });

  it('rejects weaker station-only rows, malformed confidence and cancellation', async () => {
    await expect(loadSondeHubBalloonProviderArchiveRecords({
      publication, snapshotId,
      run: async () => ({ rows: [{ ...rows[0], match_source: 'igra_station' }] }),
      limitPerAddress: 5,
    })).rejects.toThrow('case_graph_balloon_provider_source_invalid');
    await expect(loadSondeHubBalloonProviderArchiveRecords({
      publication, snapshotId,
      run: async () => ({ rows: [{ ...rows[0], confidence: 101 }] }),
      limitPerAddress: 5,
    })).rejects.toThrow('case_graph_balloon_provider_row_invalid');
    const controller = new AbortController();
    controller.abort();
    await expect(loadSondeHubBalloonProviderArchiveRecords({
      publication, snapshotId, run: vi.fn(), limitPerAddress: 5, signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
  });

  it('keeps the sealed SondeHub adapter inaccessible until its exact registry source is approved', async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('source-governance')) return { rows: [{
        canonical_source: 'SONDEHUB_ARCHIVE', legal_status: 'review', allowed_content_modes: ['metadata_only'],
      }] };
      throw new Error('provider_archive_should_not_be_read');
    });
    const adapter = createGovernedSondeHubBalloonExternalCorrelationAdapter({ publication, snapshotId, run });
    await expect(adapter.correlate({
      publication, address: 'sighting:case-a', nodeDigest: digest('6'),
      limit: 5, checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toMatchObject({
      availability: 'unavailable', reasonCodes: ['source_governance_not_approved'], source: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
