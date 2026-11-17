import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  createGovernedMaritimeExternalCorrelationAdapter,
  loadMaritimeProviderArchiveRecords,
  materializeAndPublishMaritimeProviderArchive,
} from '../../src/caseGraph/maritimeProviderArchive';
import type { CaseGraphExternalProviderArchiveTransaction } from '../../src/caseGraph/providerArchiveExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'maritime-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1', relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const snapshotId = '00000000-0000-4000-8000-000000000099';
const base = {
  address: 'sighting:case-a', node_digest: digest('6'), correlation_id: '00000000-0000-4000-8000-000000000011',
  source: 'AISSTREAM', mmsi: '123456789', imo: 'IMO123', callsign: 'CALL', vessel_name: 'Researcher',
  ship_type: 'cargo', position_time: '2026-04-20T10:00:00.000Z', lat: 51.5, lon: -1.2,
  distance_km: 8.5, time_delta_seconds: 120, sog_knots: 12.4, cog_deg: 181, heading_deg: 180,
  correlation_confidence: 0.88, correlation_reason: 'bounded fixture', watch_zone_id: null,
  watch_zone_name: null, watch_zone_type: null, watch_zone_source: null,
};

describe('maritime provider archives', () => {
  it('maps genuine AIS positions without making a causal claim', async () => {
    const records = await loadMaritimeProviderArchiveRecords({
      publication, snapshotId, run: async () => ({ rows: [base] }), mode: 'vessel_position',
      source: 'AISSTREAM', limitPerAddress: 5,
    });
    expect(records[0]).toMatchObject({
      availability: 'available', reasonCodes: ['sealed_maritime_vessel_positions_available'],
      candidates: [{ label: 'Researcher', reasonCodes: ['archived_ais_position_candidate', 'bounded_time_distance_match'] }],
    });
    expect(records[0].candidates[0].explanation).toContain('not proof that the vessel caused');
    expect(records[0].candidates[0].uncertainty[0]).toContain('AIS coverage can be incomplete');
  });

  it('keeps watch-zone context visibly separate from vessel positions', async () => {
    const row = {
      ...base, source: 'MARITIME_ZONE_FALLBACK', mmsi: 'ZONE-1', vessel_name: 'English Channel',
      ship_type: 'watch_zone', time_delta_seconds: 0, sog_knots: null, cog_deg: null, heading_deg: null,
      correlation_confidence: 0.31, watch_zone_id: '00000000-0000-4000-8000-000000000091',
      watch_zone_name: 'English Channel', watch_zone_type: 'chokepoint', watch_zone_source: 'MARINECADASTRE',
    };
    const records = await loadMaritimeProviderArchiveRecords({
      publication, snapshotId, run: async () => ({ rows: [row] }), mode: 'zone_context',
      source: 'MARITIME_ZONE_FALLBACK', limitPerAddress: 5,
    });
    expect(records[0]).toMatchObject({
      reasonCodes: ['sealed_maritime_zone_context_available'],
      candidates: [{ reasonCodes: ['maritime_watch_zone_proximity', 'no_vessel_position'] }],
    });
    expect(records[0].explanation).toContain('not evidence that a vessel was present');
    expect(records[0].candidates[0].uncertainty).toEqual(expect.arrayContaining([
      expect.stringContaining('not a vessel observation time'),
      expect.stringContaining('No AIS vessel position'),
    ]));
  });

  it('publishes a deterministic metadata archive before the transaction', async () => {
    const rows = [base];
    let receiptDigest = ''; let recordSetSha256 = ''; let body = Buffer.alloc(0);
    const order: string[] = [];
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => {
      order.push('transaction');
      return work(async (sql, params = []) => {
        if (sql.includes('external-provider-archive:existing')) return { rows: [] };
        if (sql.includes('external-provider-archive:governance')) return { rows: [{
          public_manifest_sha256: publication.manifestSha256, legal_status: 'approved',
          allowed_content_modes: ['metadata_only'],
        }] };
        if (sql.includes('external-provider-archive:nodes')) return { rows: [{ address: base.address, node_digest: base.node_digest }] };
        if (sql.includes('external-provider-archive:finalize')) {
          recordSetSha256 = String(params[2]); receiptDigest = String(params[3]);
        }
        if (sql.includes('external-provider-archive:completion-check')) return { rows: [{
          status: 'complete', record_count: '1', record_set_sha256: recordSetSha256, receipt_sha256: receiptDigest,
        }] };
        return { rows: [] };
      });
    };
    const result = await materializeAndPublishMaritimeProviderArchive({
      snapshot: {
        snapshotId, publication, category: 'maritime', canonicalSource: 'AISSTREAM', contentMode: 'metadata_only',
        providerId: 'aisstream-history', datasetVersion: '2026-04', coverageStart: null, coverageEnd: null,
        acquiredAt: '2026-07-22T01:00:00.000Z', sourceUrl: 'https://aisstream.io/', license: 'fixture',
      },
      mode: 'vessel_position', correlationSource: 'AISSTREAM', run: async () => ({ rows }), transaction,
      putArchiveObject: async ({ body: value }) => { order.push('put'); body = value; },
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => {
        order.push('verify'); return { sha256: expectedSha256, bytes: expectedBytes };
      },
      limitPerAddress: 5,
    });
    expect(result).toMatchObject({ status: 'written', receipt: { recordCount: 1, candidateCount: 1 } });
    expect(order).toEqual(['put', 'verify', 'transaction']);
    expect(gunzipSync(body).toString('utf8')).toContain('archived_ais_position_candidate');
  });

  it('rejects source-class mixing, malformed data and cancellation', async () => {
    await expect(loadMaritimeProviderArchiveRecords({
      publication, snapshotId, run: async () => ({ rows: [base] }), mode: 'zone_context',
      source: 'MARITIME_ZONE_FALLBACK', limitPerAddress: 5,
    })).rejects.toThrow('case_graph_maritime_provider_source_invalid');
    await expect(loadMaritimeProviderArchiveRecords({
      publication, snapshotId, run: async () => ({ rows: [{ ...base, correlation_confidence: 2 }] }),
      mode: 'vessel_position', source: 'AISSTREAM', limitPerAddress: 5,
    })).rejects.toThrow('case_graph_maritime_provider_row_invalid');
    const controller = new AbortController(); controller.abort();
    await expect(loadMaritimeProviderArchiveRecords({
      publication, snapshotId, run: vi.fn(), mode: 'vessel_position', source: 'AISSTREAM',
      limitPerAddress: 5, signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
  });

  it('fails closed while zone-context governance remains review-only', async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('source-governance')) return { rows: [{
        canonical_source: 'MARITIME_ZONE_CONTEXT', legal_status: 'review', allowed_content_modes: ['metadata_only'],
      }] };
      throw new Error('provider_archive_should_not_be_read');
    });
    const adapter = createGovernedMaritimeExternalCorrelationAdapter({
      publication, snapshotId, canonicalSource: 'MARITIME_ZONE_CONTEXT', providerId: 'maritime-zone-context', run,
    });
    await expect(adapter.correlate({
      publication, address: base.address, nodeDigest: base.node_digest, limit: 5,
      checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toMatchObject({ availability: 'unavailable', reasonCodes: ['source_governance_not_approved'] });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
