import { describe, expect, it, vi } from 'vitest';

import {
  EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
  EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
  capturePostgresEvidenceUniverseSnapshot,
  evidenceUniverseSourceCensusSightingSqlForTests,
  evidenceUniverseSightingCaptureSqlForTests,
  inspectPostgresEvidenceUniverseSnapshot,
  inspectPostgresEvidenceUniverseSourceReadiness,
  verifyEvidenceUniverseSourceCensusReceipt,
} from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const id = '00000000-0000-4000-8000-000000000123';
const at = '2026-07-18T00:30:00.000Z';
const materializedAt = '2026-07-18T00:29:59.999321Z';
const mvcc = '100:200:150,175';
const censusSightingRow = {
  total_count: '15',
  eligible_count: '10',
  source_unapproved_count: '1',
  registry_blocklist_count: '1',
  duplicate_non_primary_count: '1',
  future_dated_count: '1',
  invalid_geography_count: '1',
  cursor_missing_count: '0',
  after_cutoff_count: '0',
  unclassified_count: '0',
};
const censusMediaRows = [
  { entity_kind: 'document', total_count: '6', public_count: '3', invalid_public_cursor_count: '0' },
  { entity_kind: 'photo', total_count: '5', public_count: '4', invalid_public_cursor_count: '0' },
  { entity_kind: 'video', total_count: '5', public_count: '5', invalid_public_cursor_count: '0' },
];

const resealCensusReceipt = (receipt: Record<string, unknown>, overrides: Record<string, unknown>) => {
  const { receiptSha256: _previousDigest, ...body } = { ...receipt, ...overrides };
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

const componentRows = [
  ['sighting', EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY, 2],
  ['document', EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY, 3],
  ['photo', EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY, 4],
  ['video', EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY, 5],
].map(([entity_kind, capture_policy, row_count]) => ({
  entity_kind,
  capture_policy,
  status: 'complete',
  row_count,
  actual_count: row_count,
  captured_at: at,
}));

const prerequisiteRows = (params: unknown[], missing = new Set<string>()) => {
  const rows: Record<string, unknown>[] = [];
  for (const [index, scope] of [['0', 'base'], ['1', 'capture']] as const) {
    for (const name of params[Number(index)] as string[]) rows.push({
      requirement_kind: 'relation', scope, requirement_name: name,
      present: !missing.has(`${scope}:relation:${name}`),
    });
  }
  for (const [index, scope] of [['2', 'base'], ['3', 'capture']] as const) {
    for (const name of params[Number(index)] as string[]) rows.push({
      requirement_kind: 'column', scope, requirement_name: name,
      present: !missing.has(`${scope}:column:${name}`),
    });
  }
  rows.push({
    requirement_kind: 'function', scope: 'capture',
    requirement_name: 'capture_uap_evidence_universe_media_snapshot(uuid)',
    present: !missing.has('capture:function:capture_uap_evidence_universe_media_snapshot(uuid)'),
  });
  rows.push({
    requirement_kind: 'trigger', scope: 'capture',
    requirement_name: 'trg_uap_search_catalog_media_mutation_watermark',
    present: !missing.has('capture:trigger:trg_uap_search_catalog_media_mutation_watermark'),
  });
  return rows;
};

describe('Postgres evidence-universe snapshot coordinator', () => {
  it('captures all four components under one repeatable-read transaction and binds the caller-known UUID', async () => {
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [] };
      if (sql.includes('capture_uap_evidence_universe_media_snapshot')) return { rows: [{
        snapshot_id: id,
        source_snapshot_at: at,
        materialized_at: materializedAt,
        source_mvcc_snapshot: mvcc,
        document_count: '3',
        photo_count: '4',
        video_count: '5',
      }] };
      if (sql.includes('SELECT row_count FROM inserted_component')) return { rows: [{ row_count: '2' }] };
      if (sql.includes('COUNT(snapshot_row.entity_id)::bigint AS actual_count')) return { rows: componentRows };
      return { rows: [] };
    });

    await expect(capturePostgresEvidenceUniverseSnapshot({ query }, {
      snapshotId: id,
      statementTimeoutMs: 120_000,
    })).resolves.toEqual({
      snapshotId: id,
      snapshotAt: at,
      materializedAt,
      sourceMvccSnapshot: mvcc,
      snapshotPolicy: 'evidence-universe-materialized-v1',
      capturePolicies: {
        sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
        document: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
        photo: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
        video: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
      },
      counts: { sighting: 2, document: 3, photo: 4, video: 5 },
      total: 14,
      reused: false,
    });

    expect(statements.findIndex(({ sql }) => sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE'))
      .toBeGreaterThan(statements.findIndex(({ sql }) => sql.includes('pg_advisory_lock')));
    expect(statements.some(({ sql }) => sql.includes('statement_timestamp()'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('capture_uap_evidence_universe_media_snapshot'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('HH24:MI:SS.US'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('frozen_rows AS MATERIALIZED'))).toBe(true);
    expect(statements.some(({ sql }) => sql === 'COMMIT')).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(statements.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);
  });

  it('returns an already complete UUID-bound snapshot without recapturing it', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [{
        snapshot_id: id,
        source_snapshot_at: at,
        materialized_at: materializedAt,
        source_mvcc_snapshot: mvcc,
        snapshot_policy: 'evidence-universe-materialized-v1',
      }] };
      if (sql.includes('COUNT(snapshot_row.entity_id)::bigint AS actual_count')) return { rows: componentRows };
      return { rows: [] };
    });

    const receipt = await capturePostgresEvidenceUniverseSnapshot({ query }, { snapshotId: id });
    expect(receipt.reused).toBe(true);
    expect(receipt.total).toBe(14);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('capture_uap_evidence_universe_media_snapshot'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  });

  it('inspects a completed snapshot in a read-only transaction', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [{
        snapshot_id: id,
        source_snapshot_at: at,
        materialized_at: materializedAt,
        source_mvcc_snapshot: mvcc,
        snapshot_policy: 'evidence-universe-materialized-v1',
      }] };
      if (sql.includes('COUNT(snapshot_row.entity_id)::bigint AS actual_count')) {
        return { rows: componentRows };
      }
      return { rows: [] };
    });
    await expect(inspectPostgresEvidenceUniverseSnapshot({ query }, {
      snapshotId: id,
    })).resolves.toMatchObject({ snapshotId: id, total: 14, reused: true });
    expect(query.mock.calls.some(([sql]) => (
      sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
    ))).toBe(true);
    expect(query.mock.calls.some(([sql]) => (
      String(sql).includes('READ WRITE')
      || String(sql).includes('capture_uap_evidence_universe_media_snapshot')
    ))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  });

  it('fails closed on a partial existing snapshot and rolls back capture failures', async () => {
    const partialQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [{
        snapshot_id: id,
        source_snapshot_at: at,
        materialized_at: materializedAt,
        source_mvcc_snapshot: mvcc,
        snapshot_policy: 'evidence-universe-materialized-v1',
      }] };
      if (sql.includes('COUNT(snapshot_row.entity_id)::bigint AS actual_count')) return { rows: componentRows.slice(1) };
      return { rows: [] };
    });
    await expect(capturePostgresEvidenceUniverseSnapshot({ query: partialQuery }, { snapshotId: id }))
      .rejects.toThrow('evidence_universe_snapshot_component_set_incomplete');
    expect(partialQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);

    const captureQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [] };
      if (sql.includes('capture_uap_evidence_universe_media_snapshot')) throw new Error('media failed');
      return { rows: [] };
    });
    await expect(capturePostgresEvidenceUniverseSnapshot({ query: captureQuery }, { snapshotId: id }))
      .rejects.toThrow('media failed');
    expect(captureQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it('preserves the governed sighting policy and freezes every graph input field', () => {
    expect(evidenceUniverseSightingCaptureSqlForTests).toContain('uap_source_legal_registry');
    expect(evidenceUniverseSightingCaptureSqlForTests).toContain('uap_source_alias_map');
    expect(evidenceUniverseSightingCaptureSqlForTests).toContain('uap_sighting_duplicate_members');
    expect(evidenceUniverseSightingCaptureSqlForTests).toContain("sighting.event_timestamp <= $2::timestamptz + interval '365 days'");
    expect(evidenceUniverseSightingCaptureSqlForTests)
      .toContain("UPPER(COALESCE(NULLIF(TRIM(sighting.source), ''), ''))");
    expect(evidenceUniverseSightingCaptureSqlForTests).toContain("'description_clean', sighting.description_clean");
    expect(evidenceUniverseSightingCaptureSqlForTests).toContain("'ai_entities', sighting.ai_entities");
    expect(evidenceUniverseSightingCaptureSqlForTests).not.toContain('description_raw');
    expect(evidenceUniverseSightingCaptureSqlForTests).not.toContain('quality_flags');
  });

  it('rejects unsafe caller options before opening a transaction', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(capturePostgresEvidenceUniverseSnapshot({ query }, { snapshotId: 'bad' }))
      .rejects.toThrow('evidence_universe_snapshot_id_invalid');
    await expect(capturePostgresEvidenceUniverseSnapshot({ query }, { snapshotId: id, statementTimeoutMs: 999 }))
      .rejects.toThrow('evidence_universe_snapshot_timeout_invalid');
    expect(query).not.toHaveBeenCalled();
  });

  it('rolls back when captured component counts drift from the bound census', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [{
        snapshot_id: id,
        source_snapshot_at: at,
        materialized_at: materializedAt,
        source_mvcc_snapshot: mvcc,
        snapshot_policy: 'evidence-universe-materialized-v1',
      }] };
      if (sql.includes('COUNT(snapshot_row.entity_id)::bigint AS actual_count')) return { rows: componentRows };
      return { rows: [] };
    });
    await expect(capturePostgresEvidenceUniverseSnapshot({ query }, {
      snapshotId: id,
      expectedCounts: { sighting: 99, document: 3, photo: 4, video: 5 },
    })).rejects.toThrow('evidence_universe_snapshot_source_census_drift');
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });
});

describe('Postgres evidence-universe source census', () => {
  it('counts the exact source universe in one repeatable-read read-only transaction', async () => {
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        inspected_at: materializedAt,
        source_mvcc_snapshot: mvcc,
      }] };
      if (sql.includes('required_relations(scope')) return { rows: prerequisiteRows(params || []) };
      if (sql.includes('eligible_sightings AS MATERIALIZED')) return { rows: [censusSightingRow] };
      if (sql.includes('invalid_public_cursor_count')) return { rows: censusMediaRows };
      if (sql.includes('mutation_watermark_completed_at')) return { rows: [
        { entity_kind: 'document', backfill_complete: true, mutation_watermark_complete: true, mutation_watermark_completed_at: materializedAt },
        { entity_kind: 'photo', backfill_complete: true, mutation_watermark_complete: true, mutation_watermark_completed_at: materializedAt },
        { entity_kind: 'video', backfill_complete: true, mutation_watermark_complete: true, mutation_watermark_completed_at: materializedAt },
      ] };
      return { rows: [] };
    });

    const receipt = await inspectPostgresEvidenceUniverseSourceReadiness({ query }, {
      statementTimeoutMs: 120_000,
    });
    expect(receipt).toMatchObject({
      schemaVersion: 'evidence-universe-source-census-v2',
      transaction: { isolation: 'repeatable read', readOnly: true },
      counts: { sighting: 10, document: 3, photo: 4, video: 5 },
      total: 22,
      sightingAccounting: {
        total: 15,
        eligible: 10,
        excluded: 5,
        exclusionReasons: {
          sourceUnapproved: 1,
          registryBlocklist: 1,
          duplicateNonPrimary: 1,
          futureDated: 1,
          invalidGeography: 1,
          cursorMissing: 0,
          afterCutoff: 0,
          unclassified: 0,
        },
      },
      mediaAccounting: {
        document: { total: 6, public: 3, nonPublic: 3 },
        photo: { total: 5, public: 4, nonPublic: 1 },
        video: { total: 5, public: 5, nonPublic: 0 },
      },
      invalidPublicMediaCursors: 0,
      readyForSnapshotCapture: true,
      blockers: [],
      guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0 },
    });
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyEvidenceUniverseSourceCensusReceipt(receipt)).toEqual(receipt);
    expect(() => verifyEvidenceUniverseSourceCensusReceipt({ ...receipt, total: 23 }))
      .toThrow('evidence_universe_source_census_total_invalid');
    expect(() => verifyEvidenceUniverseSourceCensusReceipt(resealCensusReceipt(receipt, {
      sightingAccounting: { ...receipt.sightingAccounting!, eligible: 11 },
    }))).toThrow('evidence_universe_source_census_sighting_reconciliation_invalid');
    expect(() => verifyEvidenceUniverseSourceCensusReceipt(resealCensusReceipt(receipt, {
      sightingAccounting: {
        ...receipt.sightingAccounting!,
        exclusionReasons: { ...receipt.sightingAccounting!.exclusionReasons, unclassified: 1 },
      },
    }))).toThrow('evidence_universe_source_census_sighting_reconciliation_invalid');
    expect(() => verifyEvidenceUniverseSourceCensusReceipt(resealCensusReceipt(receipt, {
      mediaAccounting: {
        ...receipt.mediaAccounting,
        document: { total: 7, public: 3, nonPublic: 3 },
      },
    }))).toThrow('evidence_universe_source_census_media_reconciliation_invalid');
    expect(statements[0]?.sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(statements.at(-1)?.sql).toBe('COMMIT');
    expect(statements.some(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i.test(sql)))
      .toBe(false);
    expect(statements.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);
  });

  it('reports absent capture migration assets as blockers while retaining source counts', async () => {
    const missing = new Set([
      'capture:relation:uap_evidence_universe_snapshots',
      'capture:relation:uap_evidence_universe_snapshot_components',
      'capture:relation:uap_evidence_universe_snapshot_rows',
      'capture:column:uap_search_catalog_media_state.mutation_watermark_complete',
      'capture:column:uap_search_catalog_media_state.mutation_watermark_completed_at',
      'capture:function:capture_uap_evidence_universe_media_snapshot(uuid)',
      'capture:trigger:trg_uap_search_catalog_media_mutation_watermark',
    ]);
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        inspected_at: materializedAt, source_mvcc_snapshot: mvcc,
      }] };
      if (sql.includes('required_relations(scope')) return { rows: prerequisiteRows(params || [], missing) };
      if (sql.includes('eligible_sightings AS MATERIALIZED')) return { rows: [censusSightingRow] };
      if (sql.includes('invalid_public_cursor_count')) return { rows: censusMediaRows };
      return { rows: [] };
    });

    const result = await inspectPostgresEvidenceUniverseSourceReadiness({ query });
    expect(result.counts).toEqual({ sighting: 10, document: 3, photo: 4, video: 5 });
    expect(result.readyForSnapshotCapture).toBe(false);
    expect(result.blockers).toContain('capture_prerequisite_missing:relation:uap_evidence_universe_snapshots');
    expect(result.blockers).toContain('media_state_missing:document');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('mutation_watermark_completed_at AT TIME ZONE')))
      .toBe(false);
  });

  it('fails closed on corrupt accounting and rolls back', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        inspected_at: materializedAt, source_mvcc_snapshot: mvcc,
      }] };
      if (sql.includes('required_relations(scope')) return { rows: prerequisiteRows(params || []) };
      if (sql.includes('eligible_sightings AS MATERIALIZED')) return { rows: [{
        ...censusSightingRow,
        eligible_count: '-1',
      }] };
      return { rows: [] };
    });
    await expect(inspectPostgresEvidenceUniverseSourceReadiness({ query }))
      .rejects.toThrow('evidence_universe_source_census_sighting_count_invalid');
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });

  it('rejects an unclassified source row instead of hiding it in the eligible total', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        inspected_at: materializedAt, source_mvcc_snapshot: mvcc,
      }] };
      if (sql.includes('required_relations(scope')) return { rows: prerequisiteRows(params || []) };
      if (sql.includes('eligible_sightings AS MATERIALIZED')) return { rows: [{
        ...censusSightingRow,
        total_count: '16',
        unclassified_count: '1',
      }] };
      return { rows: [] };
    });
    await expect(inspectPostgresEvidenceUniverseSourceReadiness({ query }))
      .rejects.toThrow('evidence_universe_source_census_sighting_unclassified');
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });

  it('shares the governed sighting eligibility predicate with snapshot capture', () => {
    for (const clause of [
      'uap_source_legal_registry',
      'uap_source_alias_map',
      'uap_sighting_duplicate_members',
      "UPPER(COALESCE(NULLIF(TRIM(sighting.source), ''), ''))",
      "sighting.event_timestamp <= $1::timestamptz + interval '365 days'",
      "classification = 'source_unapproved'",
      "classification = 'registry_blocklist'",
      "classification = 'duplicate_non_primary'",
      "classification = 'future_dated'",
      "classification = 'invalid_geography'",
      "classification = 'cursor_missing'",
      "classification = 'after_cutoff'",
      "classification = 'unclassified'",
    ]) expect(evidenceUniverseSourceCensusSightingSqlForTests).toContain(clause);
    expect(evidenceUniverseSightingCaptureSqlForTests)
      .toContain("sighting.event_timestamp <= $2::timestamptz + interval '365 days'");
  });
});
