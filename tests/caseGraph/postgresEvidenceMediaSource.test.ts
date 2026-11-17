import { describe, expect, it, vi } from 'vitest';

import {
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  createPostgresEvidenceMediaSource,
} from '../../src/caseGraph/postgresEvidenceMediaSource';

const snapshotId = '11111111-1111-4111-8111-111111111111';
const inspectionRows = (overrides: Partial<Record<string, Record<string, unknown>>> = {}) => ([
  {
    snapshot_id: snapshotId,
    source_snapshot_at: '2026-07-17T18:00:00Z',
    materialized_at: '2026-07-17T17:59:59.999876Z',
    source_mvcc_snapshot: '123:456:124,125',
    entity_kind: 'document',
    capture_policy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    status: 'complete',
    row_count: '12',
    actual_count: '12',
    immutability_enforced: true,
    ...overrides.document,
  },
  {
    snapshot_id: snapshotId,
    source_snapshot_at: '2026-07-17T18:00:00Z',
    materialized_at: '2026-07-17T17:59:59.999876Z',
    source_mvcc_snapshot: '123:456:124,125',
    entity_kind: 'photo',
    capture_policy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    status: 'complete',
    row_count: '34',
    actual_count: '34',
    immutability_enforced: true,
    ...overrides.photo,
  },
  {
    snapshot_id: snapshotId,
    source_snapshot_at: '2026-07-17T18:00:00Z',
    materialized_at: '2026-07-17T17:59:59.999876Z',
    source_mvcc_snapshot: '123:456:124,125',
    entity_kind: 'video',
    capture_policy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    status: 'complete',
    row_count: '12626',
    actual_count: '12626',
    immutability_enforced: true,
    ...overrides.video,
  },
]);

describe('Postgres evidence-universe media source', () => {
  it('requires three sealed immutable components and preserves exact counts', async () => {
    const query = vi.fn(async () => ({
      rows: inspectionRows().map((row) => ({
        ...row,
        // node-postgres returns timestamptz columns as Date objects. Preserve
        // their milliseconds rather than round-tripping through Date#toString.
        source_snapshot_at: new Date(String(row.source_snapshot_at)),
      })),
    }));
    const source = createPostgresEvidenceMediaSource(query, { snapshotId });

    await expect(source.inspectSnapshot()).resolves.toEqual({
      snapshotId,
      snapshotAt: '2026-07-17T18:00:00.000Z',
      materializedAt: '2026-07-17T17:59:59.999876Z',
      sourceMvccSnapshot: '123:456:124,125',
      snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      capturePolicy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      counts: { document: 12, photo: 34, video: 12_626 },
      backfillsComplete: { document: true, photo: true, video: true },
    });

    expect(query.mock.calls[0][0]).toContain('uap_evidence_universe_snapshot_components');
    expect(query.mock.calls[0][0]).toContain('uap_evidence_universe_snapshot_rows');
    expect(query.mock.calls[0][0]).toContain('trg_uap_evidence_universe_snapshot_row_guard');
    expect(query.mock.calls[0][0]).toContain('trg_uap_evidence_universe_snapshot_component_guard');
    expect(query.mock.calls[0][0]).toContain('trg_uap_evidence_universe_snapshot_header_guard');
    expect(query.mock.calls[0][0]).toContain('BOOL_AND(relation.relrowsecurity)');
    expect(query.mock.calls[0][0]).toContain("grantee.rolname IS DISTINCT FROM 'service_role'");
    expect(query.mock.calls[0][0]).toContain("capture_function.proname = 'capture_uap_evidence_universe_media_snapshot'");
    expect(query.mock.calls[0][0]).toContain('privilege.grantee <> protected_function.proowner');
    expect(query.mock.calls[0][0]).toContain('trigger_row.tgtype = 31');
    expect(query.mock.calls[0][0]).toContain('trigger_row.tgtype = 27');
    expect(query.mock.calls[0][1]).toEqual([
      snapshotId,
      EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      ['document', 'photo', 'video'],
    ]);
    expect(query.mock.calls[0][0]).not.toContain('uap_search_catalog_media c');
  });

  it('fails closed for a missing, unsealed, or mutable component set', async () => {
    const missing = createPostgresEvidenceMediaSource(
      vi.fn(async () => ({ rows: inspectionRows().slice(0, 2) })),
      { snapshotId },
    );
    await expect(missing.inspectSnapshot()).rejects.toThrow('evidence_media_materialized_snapshot_unavailable');

    const building = createPostgresEvidenceMediaSource(
      vi.fn(async () => ({ rows: inspectionRows({ photo: { status: 'building' } }) })),
      { snapshotId },
    );
    await expect(building.inspectSnapshot()).rejects.toThrow('evidence_media_materialized_snapshot_unavailable');

    const mutable = createPostgresEvidenceMediaSource(
      vi.fn(async () => ({ rows: inspectionRows({ video: { immutability_enforced: false } }) })),
      { snapshotId },
    );
    await expect(mutable.inspectSnapshot()).rejects.toThrow('evidence_media_materialized_snapshot_unavailable');
  });

  it('rejects a component receipt whose frozen row count has drifted', async () => {
    const query = vi.fn(async () => ({ rows: inspectionRows({ photo: { actual_count: '33' } }) }));
    await expect(createPostgresEvidenceMediaSource(query, { snapshotId }).inspectSnapshot())
      .rejects.toThrow('evidence_media_materialized_snapshot_count_mismatch');
  });

  it('rejects a malformed MVCC receipt or noncanonical server snapshot boundary', async () => {
    const invalidMvcc = createPostgresEvidenceMediaSource(
      vi.fn(async () => ({ rows: inspectionRows({ video: { source_mvcc_snapshot: 'not-an-mvcc-snapshot' } }) })),
      { snapshotId },
    );
    await expect(invalidMvcc.inspectSnapshot())
      .rejects.toThrow('evidence_media_materialized_snapshot_mvcc_invalid');

    const invalidBoundary = createPostgresEvidenceMediaSource(
      vi.fn(async () => ({ rows: inspectionRows({ document: { source_snapshot_at: '2026-07-17T18:00:00.001Z' } }) })),
      { snapshotId },
    );
    await expect(invalidBoundary.inspectSnapshot())
      .rejects.toThrow('evidence_media_materialized_snapshot_timestamp_invalid');
  });

  it('pages only frozen payload rows with exact microsecond cursors', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: inspectionRows() })
      .mockResolvedValueOnce({ rows: [{
        entity_id: 'PHOTO-9',
        snapshot_payload: {
          entity_id: 'PHOTO-9', source: 'AARO', title: 'Frame', description: 'Still frame',
          canonical_url: 'https://example.test/frame', preview_url: 'https://example.test/thumb',
          event_timestamp: '2004-03-02T00:00:00Z', lat: 34.2, lon: -112.1,
          location_normalized: 'Arizona', country_code: 'US',
          sighting_id: '22222222-2222-4222-8222-222222222222', is_public: true,
        },
        cursor_updated_at: '2026-07-17T17:00:00.123456Z',
        cursor_record_id: 'PHOTO-9',
      }] });
    const source = createPostgresEvidenceMediaSource(query, { snapshotId });
    await source.inspectSnapshot();

    const page = await source.fetchPage('photo', {
      updatedAt: '2026-07-17T16:00:00Z',
      recordId: ' Photo-1-Mixed ',
    }, 100);

    expect(page.nodes[0]).toMatchObject({
      address: 'photo:photo-9',
      linkedSightingId: '22222222-2222-4222-8222-222222222222',
      lat: 34.2,
      lon: -112.1,
    });
    expect(page.nextCursor).toEqual({ updatedAt: '2026-07-17T17:00:00.123456Z', recordId: 'PHOTO-9' });
    expect(query.mock.calls[1][0]).toContain('FROM public.uap_evidence_universe_snapshot_rows AS snapshot_row');
    expect(query.mock.calls[1][0]).toContain('HH24:MI:SS.US');
    expect(query.mock.calls[1][0]).toContain('AND (snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C") >');
    expect(query.mock.calls[1][0]).toContain('ORDER BY snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C"');
    expect(query.mock.calls[1][0]).not.toContain('uap_photos');
    expect(query.mock.calls[1][1]).toEqual([
      snapshotId,
      'photo',
      '2026-07-17T16:00:00Z',
      ' Photo-1-Mixed ',
      100,
    ]);
  });

  it('keeps all 12,626 catalogue videos without requiring a legacy source row', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: inspectionRows() })
      .mockResolvedValueOnce({ rows: [{
        entity_id: 'VIDEO-CATALOGUE-ONLY',
        snapshot_payload: {
          entity_id: 'VIDEO-CATALOGUE-ONLY', source: 'youtube', title: 'Catalogue video',
          canonical_url: 'https://example.test/watch/receipt-123',
          preview_url: 'https://example.test/thumb/receipt-123.jpg',
          sighting_id: null, lat: null, lon: null, is_public: true,
        },
        cursor_updated_at: '2026-07-17T17:00:00.654321Z',
        cursor_record_id: 'VIDEO-CATALOGUE-ONLY',
      }] });
    const source = createPostgresEvidenceMediaSource(query, { snapshotId });
    const inspected = await source.inspectSnapshot();
    const page = await source.fetchPage('video', null, 25_000);

    expect(inspected.counts.video).toBe(12_626);
    expect(page.nodes[0]).toMatchObject({
      address: 'video:video-catalogue-only',
      linkedSightingId: null,
      canonicalUrl: 'https://example.test/watch/receipt-123',
    });
    expect(query.mock.calls[1][0]).not.toContain('uap_videos');
  });

  it('requires inspection before paging and rejects unsupported kinds and bounds', async () => {
    const source = createPostgresEvidenceMediaSource(vi.fn(), { snapshotId });
    await expect(source.fetchPage('sighting', null, 10)).rejects.toThrow('evidence_media_kind_invalid');
    await expect(source.fetchPage('video', null, 25_001)).rejects.toThrow('evidence_media_page_limit_invalid');
    await expect(source.fetchPage('video', null, 10)).rejects.toThrow('evidence_media_materialized_snapshot_not_inspected');
  });

  it('rejects a payload whose identity or publication receipt does not match its frozen row', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: inspectionRows() })
      .mockResolvedValueOnce({ rows: [{
        entity_id: 'PHOTO-9',
        snapshot_payload: { entity_id: 'PHOTO-OTHER', is_public: true },
        cursor_updated_at: '2026-07-17T17:00:00.123456Z',
        cursor_record_id: 'PHOTO-9',
      }] });
    const source = createPostgresEvidenceMediaSource(query, { snapshotId });
    await source.inspectSnapshot();
    await expect(source.fetchPage('photo', null, 10)).rejects.toThrow('evidence_media_snapshot_payload_invalid');
  });

  it('requires a coordinator-issued materialized snapshot UUID before any query', () => {
    const query = vi.fn();
    expect(() => createPostgresEvidenceMediaSource(query, {
      snapshotId: '',
    })).toThrow('evidence_media_materialized_snapshot_id_required');
    expect(query).not.toHaveBeenCalled();
  });
});
