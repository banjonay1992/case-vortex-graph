import { describe, expect, it, vi } from 'vitest';

import { createPostgresCaseGraphFeatureSource } from '../../src/caseGraph/postgresFeatureSource';

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

describe('Postgres case graph feature source', () => {
  it('uses the governed publishability policy, a frozen snapshot and indexed keyset cursors', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[], options?: unknown) => {
      expect(options).toEqual({ queryTimeoutMs: 60_000, statementTimeoutMs: 60_000 });
      if (sql.includes('SELECT source_key FROM approved_source_keys')) {
        expect(sql).toContain('uap_source_legal_registry');
        expect(sql).toContain('approved_source_keys AS MATERIALIZED');
        expect(params).toEqual([]);
        return { rows: [{ source_key: 'NUFORC' }] };
      }
      expect(sql).toContain('FROM uap_sightings s');
      expect(sql).toContain('uap_sighting_duplicate_members');
      expect(sql).toContain('COALESCE(s.updated_at, s.event_timestamp, s.created_at, s.ingested_at) <= $1::timestamptz');
      expect(sql).toContain('s.event_timestamp <= $2::timestamptz');
      expect(sql).toContain("date_trunc('milliseconds', COALESCE(s.updated_at, s.event_timestamp, s.created_at, s.ingested_at) AT TIME ZONE 'UTC')");
      expect(sql).toContain("AT TIME ZONE 'UTC') AS cursor_ts");
      if (sql.includes('(SELECT COUNT(*)::bigint FROM eligible)')) {
        expect(params).toEqual(['2026-07-17T13:00:00.000Z', '2027-07-17T13:00:00.000Z', 'NUFORC']);
        return { rows: [{
          row_count: '2',
          min_cursor_ts: '2026-07-17T12:01:00Z', min_case_id: firstId,
          max_cursor_ts: '2026-07-17T12:02:00Z', max_case_id: secondId,
        }] };
      }
      if (sql.includes('s.source_record_id')) {
        expect(sql).toContain('CROSS JOIN LATERAL');
        expect(sql).toContain('eligible_page AS MATERIALIZED');
        expect(sql).toContain('WHERE dm.sighting_id = s.id::uuid');
        expect(sql).toContain("date_trunc('milliseconds', COALESCE(s.updated_at, s.event_timestamp, s.created_at, s.ingested_at) AT TIME ZONE 'UTC'), s.id) > (($3::timestamptz AT TIME ZONE 'UTC'), $4::uuid)");
        expect(params).toEqual([
          '2026-07-17T13:00:00.000Z',
          '2027-07-17T13:00:00.000Z',
          '2026-07-17T12:01:00.000Z',
          firstId,
          25,
        ]);
        return { rows: [{
          case_id: secondId,
          cursor_ts: '2026-07-17T12:02:00Z',
          source: 'NUFORC',
          source_record_id: 'N-2',
          event_timestamp: new Date('2026-07-16T23:00:00Z'),
          lat: '51.5',
          lon: '-0.1',
          description_clean: 'Amber triangle hovered silently.',
          duration_seconds: '45',
          ai_keywords: ['triangle'],
          ai_entities: [{ name: 'London' }],
        }] };
      }
      return { rows: [] };
    });
    const source = createPostgresCaseGraphFeatureSource(query, {
      snapshotAt: '2026-07-17T13:00:00Z',
      timeoutMs: 60_000,
    });

    await expect(source.inspectEligibleSnapshot()).resolves.toEqual({
      eligible_count: 2,
      min_cursor: { updated_at: '2026-07-17T12:01:00.000Z', case_id: firstId },
      max_cursor: { updated_at: '2026-07-17T12:02:00.000Z', case_id: secondId },
      source_counts: { nuforc: 2 },
      publishability_policy: 'publishable_public_v3_user_consent',
      snapshot_at: '2026-07-17T13:00:00.000Z',
    });
    const rows = await source.fetchEligiblePage({
      updated_at: '2026-07-17T12:01:00.000Z', case_id: firstId,
    }, 25);
    expect(rows).toEqual([{
      cursor: { updated_at: '2026-07-17T12:02:00.000Z', case_id: secondId },
      sighting: expect.objectContaining({
        id: secondId,
        source: 'NUFORC',
        lat: 51.5,
        lon: -0.1,
        duration_seconds: 45,
        updated_at: '2026-07-17T12:02:00Z',
      }),
    }]);
  });

  it('builds the first page without a cursor and rejects unsafe limits and options', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      expect(sql).not.toContain('> ($2::timestamptz, $3::uuid)');
      expect(sql).toContain('LIMIT $3::int');
      expect(params).toEqual(['2026-07-17T13:00:00.000Z', '2027-07-17T13:00:00.000Z', 10]);
      return { rows: [] };
    });
    const source = createPostgresCaseGraphFeatureSource(query, {
      snapshotAt: '2026-07-17T13:00:00Z',
    });
    await expect(source.fetchEligiblePage(null, 10)).resolves.toEqual([]);
    await expect(source.fetchEligiblePage(null, 0)).rejects.toThrow('case_graph_postgres_page_limit_invalid');
    expect(() => createPostgresCaseGraphFeatureSource(query, { timeoutMs: 999 }))
      .toThrow('case_graph_postgres_timeout_invalid');
    expect(() => createPostgresCaseGraphFeatureSource(query, { snapshotAt: 'not-a-date' }))
      .toThrow('case_graph_postgres_snapshot_invalid');
  });

  it('can use the global cursor index for full-universe exports without per-source lateral scans', async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain('JOIN approved_source_keys approved ON approved.source_key');
      expect(sql).not.toContain('CROSS JOIN LATERAL');
      expect(sql).toMatch(/ORDER BY\s+date_trunc/u);
      return { rows: [] };
    });
    const source = createPostgresCaseGraphFeatureSource(query, {
      snapshotAt: '2026-07-17T13:00:00Z', pageStrategy: 'global_cursor',
    });
    await expect(source.fetchEligiblePage(null, 10)).resolves.toEqual([]);
    expect(() => createPostgresCaseGraphFeatureSource(query, { pageStrategy: 'unsafe' as any }))
      .toThrow('case_graph_postgres_page_strategy_invalid');
  });
});
