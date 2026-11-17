import { describe, expect, it, vi } from 'vitest';

import { createPostgresMaterializedCaseGraphFeatureSource } from '../../src/caseGraph/postgresMaterializedFeatureSource';
import { PUBLISHABLE_SIGHTING_POLICY_MODE } from '../../src/utils/dataQualityVisibility';

const snapshotId = '00000000-0000-4000-8000-000000000123';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

const snapshotRow = {
  snapshot_id: snapshotId,
  source_snapshot_at: '2026-07-18T00:30:00Z',
  materialized_at: '2026-07-18T00:29:59.999321Z',
  source_mvcc_snapshot: '100:200:150,175',
  snapshot_policy: 'evidence-universe-materialized-v1',
  capture_policy: 'publishable-public-v2-materialized-v1',
  status: 'complete',
  row_count: '2',
  actual_count: '2',
  source_counts: { nuforc: 2 },
  captured_at: '2026-07-18T00:31:00Z',
  immutability_enforced: true,
  min_cursor_at: '2026-07-17T12:01:00.000000Z',
  min_entity_id: firstId,
  max_cursor_at: '2026-07-17T12:02:00.000000Z',
  max_entity_id: secondId,
};

describe('materialized Postgres case-graph feature source', () => {
  it('inspects and pages only the immutable UUID-bound sighting component', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[], options?: unknown) => {
      expect(options).toEqual({ queryTimeoutMs: 60_000, statementTimeoutMs: 60_000 });
      if (sql.includes('bounds AS MATERIALIZED')) {
        expect(sql).toContain("snapshot_row.entity_kind = 'sighting'");
        expect(sql).toContain("'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'");
        expect(sql).not.toContain('FROM public.uap_sightings');
        expect(params).toEqual([snapshotId]);
        return { rows: [snapshotRow] };
      }
      expect(sql).toContain('FROM public.uap_evidence_universe_snapshot_rows AS snapshot_row');
      expect(sql).toContain('(snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C") > ($2::timestamptz, $3::text COLLATE "C")');
      expect(sql).not.toContain('uap_source_legal_registry');
      expect(params).toEqual([
        snapshotId,
        '2026-07-17T12:01:00.000Z',
        firstId,
        25,
      ]);
      return { rows: [{
        entity_id: secondId,
        cursor_at_text: '2026-07-17T12:02:00.000000Z',
        snapshot_payload: {
          case_id: secondId,
          source: 'NUFORC',
          source_record_id: 'N-2',
          event_timestamp: '2026-07-16T23:00:00Z',
          lat: 51.5,
          lon: -0.1,
          description_clean: 'Amber triangle hovered silently.',
          duration_seconds: 45,
          ai_keywords: ['triangle'],
          ai_entities: [{ name: 'London' }],
        },
      }] };
    });
    const source = createPostgresMaterializedCaseGraphFeatureSource(query, {
      snapshotId,
      timeoutMs: 60_000,
    });

    await expect(source.inspectEligibleSnapshot()).resolves.toEqual({
      snapshot_id: snapshotId,
      snapshot_policy: 'evidence-universe-materialized-v1',
      capture_policy: 'publishable-public-v2-materialized-v1',
      materialized_at: '2026-07-18T00:29:59.999321Z',
      source_mvcc_snapshot: '100:200:150,175',
      eligible_count: 2,
      min_cursor: { updated_at: '2026-07-17T12:01:00.000000Z', case_id: firstId },
      max_cursor: { updated_at: '2026-07-17T12:02:00.000000Z', case_id: secondId },
      source_counts: { nuforc: 2 },
      publishability_policy: PUBLISHABLE_SIGHTING_POLICY_MODE,
      snapshot_at: '2026-07-18T00:30:00.000Z',
    });
    await expect(source.fetchEligiblePage({
      updated_at: '2026-07-17T12:01:00.000Z', case_id: firstId,
    }, 25)).resolves.toEqual([{
      cursor: { updated_at: '2026-07-17T12:02:00.000000Z', case_id: secondId },
      sighting: expect.objectContaining({
        id: secondId,
        source: 'NUFORC',
        lat: 51.5,
        lon: -0.1,
        duration_seconds: 45,
        updated_at: '2026-07-17T12:02:00.000000Z',
      }),
    }]);
  });

  it('requires inspection before paging and rejects corrupt component receipts', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...snapshotRow, actual_count: '1' }] }));
    const source = createPostgresMaterializedCaseGraphFeatureSource(query, { snapshotId });
    await expect(source.fetchEligiblePage(null, 10))
      .rejects.toThrow('case_graph_materialized_snapshot_not_inspected');
    await expect(source.inspectEligibleSnapshot())
      .rejects.toThrow('case_graph_materialized_snapshot_invalid');
  });

  it('rejects malformed frozen payload identities and unsafe options', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('bounds AS MATERIALIZED')) return { rows: [snapshotRow] };
      return { rows: [{
        entity_id: secondId,
        cursor_at_text: '2026-07-17T12:02:00.000000Z',
        snapshot_payload: { case_id: firstId, source: 'NUFORC' },
      }] };
    });
    const source = createPostgresMaterializedCaseGraphFeatureSource(query, { snapshotId });
    await source.inspectEligibleSnapshot();
    await expect(source.fetchEligiblePage(null, 10))
      .rejects.toThrow('case_graph_materialized_snapshot_payload_invalid');
    expect(() => createPostgresMaterializedCaseGraphFeatureSource(query, { snapshotId: 'bad' }))
      .toThrow('case_graph_materialized_snapshot_id_invalid');
    expect(() => createPostgresMaterializedCaseGraphFeatureSource(query, { snapshotId, timeoutMs: 999 }))
      .toThrow('case_graph_materialized_snapshot_timeout_invalid');
  });
});
