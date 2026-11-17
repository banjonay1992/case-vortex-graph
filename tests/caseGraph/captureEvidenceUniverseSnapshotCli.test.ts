import { describe, expect, it, vi } from 'vitest';

import { runEvidenceUniverseSnapshotCli } from '../../src/cli/captureEvidenceUniverseSnapshot';
import {
  EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT,
  buildEvidenceUniverseSnapshotCaptureApproval,
} from '../../src/caseGraph/evidenceUniverseSnapshotApproval';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const snapshotId = '00000000-0000-4000-8000-000000000123';
const censusBody = {
  schemaVersion: 'evidence-universe-source-census-v2' as const,
  inspectedAt: '2026-07-22T14:25:00.000000Z',
  sourceMvccSnapshot: '100:200:',
  transaction: { isolation: 'repeatable read' as const, readOnly: true as const },
  prerequisites: { missingBase: [], missingCapture: [] },
  counts: { sighting: 2, document: 3, photo: 4, video: 5 },
  total: 14,
  sightingAccounting: {
    total: 4,
    eligible: 2,
    excluded: 2,
    exclusionReasons: {
      sourceUnapproved: 1,
      registryBlocklist: 0,
      duplicateNonPrimary: 1,
      futureDated: 0,
      invalidGeography: 0,
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
  mediaState: {
    document: { backfillComplete: true, mutationWatermarkComplete: true, mutationWatermarkCompletedAt: '2026-07-22T14:20:00.000000Z' },
    photo: { backfillComplete: true, mutationWatermarkComplete: true, mutationWatermarkCompletedAt: '2026-07-22T14:20:00.000000Z' },
    video: { backfillComplete: true, mutationWatermarkComplete: true, mutationWatermarkCompletedAt: '2026-07-22T14:20:00.000000Z' },
  },
  invalidPublicMediaCursors: 0,
  readyForSnapshotCapture: true,
  blockers: [],
  guarantees: { databaseWrites: 0 as const, r2Reads: 0 as const, r2Writes: 0 as const, lunaCalls: 0 as const },
};
const readyCensus = { ...censusBody, receiptSha256: relationshipInputSha256(censusBody) };
const readyApproval = buildEvidenceUniverseSnapshotCaptureApproval({
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-22T14:29:00.000Z',
  snapshotId,
  censusReceiptSha256: readyCensus.receiptSha256,
  censusInspectedAt: readyCensus.inspectedAt,
  authorizationStatement: EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT,
  snapshotCaptureApproved: true,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

describe('evidence-universe snapshot CLI', () => {
  it('runs source inspection without a snapshot UUID and never enters a write transaction', async () => {
    const release = vi.fn();
    const closePool = vi.fn(async () => undefined);
    const query = vi.fn(async (
      input: string | { text: string; values?: unknown[]; query_timeout?: number },
      positionalParams?: unknown[],
    ) => {
      const sql = typeof input === 'string' ? input : input.text;
      const params = typeof input === 'string' ? positionalParams : input.values;
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        inspected_at: '2026-07-22T12:00:00.123456Z',
        source_mvcc_snapshot: '100:200:',
      }] };
      if (sql.includes('required_relations(scope')) {
        const rows: Record<string, unknown>[] = [];
        for (const [index, scope, kind] of [
          [0, 'base', 'relation'], [1, 'capture', 'relation'],
          [2, 'base', 'column'], [3, 'capture', 'column'],
        ] as const) {
          for (const name of params?.[index] as string[]) rows.push({
            requirement_kind: kind, scope, requirement_name: name, present: false,
          });
        }
        rows.push({
          requirement_kind: 'function', scope: 'capture',
          requirement_name: 'capture_uap_evidence_universe_media_snapshot(uuid)', present: false,
        });
        rows.push({
          requirement_kind: 'trigger', scope: 'capture',
          requirement_name: 'trg_uap_search_catalog_media_mutation_watermark', present: false,
        });
        return { rows };
      }
      return { rows: [] };
    });
    const loadDb = vi.fn(async () => ({
      getClient: async () => ({ query, release }),
      closePool,
    }));
    const writeCensusReceipt = vi.fn(async () => '/tmp/census.json');

    const result = await runEvidenceUniverseSnapshotCli([
      '--inspect-source', '--output=census.json',
    ], { loadDb, writeCensusReceipt });
    expect(result).toMatchObject({
      write_enabled: false,
      inspection_only: true,
      schemaVersion: 'evidence-universe-source-census-v2',
      counts: { sighting: null, document: null, photo: null, video: null },
      sightingAccounting: null,
      mediaAccounting: { document: null, photo: null, video: null },
      readyForSnapshotCapture: false,
      guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0 },
      output_path: '/tmp/census.json',
    });
    expect(writeCensusReceipt).toHaveBeenCalledWith(
      'census.json',
      expect.objectContaining({ receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    );
    expect(query.mock.calls.some(([input]) => (
      typeof input === 'object' && input.text === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
    ))).toBe(true);
    expect(query.mock.calls.some(([input]) => (
      (typeof input === 'string' ? input : input.text).includes('READ WRITE')
    ))).toBe(false);
    expect(query.mock.calls.every(([input]) => (
      typeof input === 'object' && input.query_timeout === 10 * 60_000
    ))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('is plan-only by default and rejects caller-selected historical time', async () => {
    const loadDb = vi.fn();
    await expect(runEvidenceUniverseSnapshotCli([
      `--snapshot-id=${snapshotId}`,
    ], { loadDb })).resolves.toEqual({
      write_enabled: false,
      snapshot_id: snapshotId,
      transaction_isolation: 'repeatable read',
      components: ['sighting', 'document', 'photo', 'video'],
      note: 'Plan only. Re-run with --write-snapshot using the same caller-owned UUID.',
    });
    expect(loadDb).not.toHaveBeenCalled();
    await expect(runEvidenceUniverseSnapshotCli([
      `--snapshot-id=${snapshotId}`,
      '--snapshot-at=2026-07-17T00:00:00Z',
    ], { loadDb })).rejects.toThrow('--snapshot-at is unsupported');

    await expect(runEvidenceUniverseSnapshotCli([
      `--snapshot-id=${snapshotId}`,
      '--census-receipt=census.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
      now: () => new Date('2026-07-22T14:30:00.000Z'),
    })).resolves.toMatchObject({
      write_enabled: false,
      census_receipt_sha256: readyCensus.receiptSha256,
      census_fresh: true,
      source_counts: censusBody.counts,
      capture_ready: true,
    });
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('runs the real coordinator through one owned client and releases resources', async () => {
    const release = vi.fn();
    const closePool = vi.fn(async () => undefined);
    const query = vi.fn(async (
      input: string | { text: string; values?: unknown[]; query_timeout?: number },
    ) => {
      const sql = typeof input === 'string' ? input : input.text;
      if (sql.includes('FROM public.uap_evidence_universe_snapshots AS snapshot')) return { rows: [{
        snapshot_id: snapshotId,
        source_snapshot_at: '2026-07-18T00:30:00Z',
        materialized_at: '2026-07-18T00:29:59.999Z',
        source_mvcc_snapshot: '100:200:',
        snapshot_policy: 'evidence-universe-materialized-v1',
      }] };
      if (sql.includes('COUNT(snapshot_row.entity_id)::bigint AS actual_count')) return { rows: [
        ['sighting', 'publishable-public-v2-materialized-v1', 2],
        ['document', 'catalogue-materialized-v1', 3],
        ['photo', 'catalogue-materialized-v1', 4],
        ['video', 'catalogue-materialized-v1', 5],
      ].map(([entity_kind, capture_policy, row_count]) => ({
        entity_kind, capture_policy, row_count, actual_count: row_count,
        status: 'complete', captured_at: '2026-07-18T00:30:01Z',
      })) };
      return { rows: [] };
    });
    const loadDb = vi.fn(async () => ({
      getClient: async () => ({ query, release }),
      closePool,
    }));

    const result = await runEvidenceUniverseSnapshotCli([
      '--write-snapshot',
      `--snapshot-id=${snapshotId}`,
      '--census-receipt=census.json',
      '--approval=approval.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
      readSnapshotApproval: vi.fn(async () => readyApproval),
      now: () => new Date('2026-07-22T14:30:00.000Z'),
    });
    expect(result).toMatchObject({
      write_enabled: true,
      census_receipt_sha256: readyCensus.receiptSha256,
      snapshotId,
      reused: true,
      total: 14,
    });
    expect(query.mock.calls.some(([input]) => (
      typeof input === 'object' && input.text === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE'
    ))).toBe(true);
    expect(query.mock.calls.every(([input]) => (
      typeof input === 'object' && input.query_timeout === 30 * 60_000
    ))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('closes the pool even when releasing the owned client fails', async () => {
    const releaseError = new Error('release failed');
    const closePool = vi.fn(async () => undefined);
    const loadDb = vi.fn(async () => ({
      getClient: async () => ({
        query: vi.fn(),
        release: () => { throw releaseError; },
      }),
      closePool,
    }));

    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot',
      `--snapshot-id=${snapshotId}`,
      '--census-receipt=census.json',
      '--approval=approval.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
      readSnapshotApproval: vi.fn(async () => readyApproval),
      now: () => new Date('2026-07-22T14:30:00.000Z'),
    })).rejects.toBe(releaseError);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('rejects missing IDs, destructive flags and unsafe timeouts before DB access', async () => {
    const loadDb = vi.fn();
    await expect(runEvidenceUniverseSnapshotCli([], { loadDb })).rejects.toThrow('--snapshot-id is required');
    await expect(runEvidenceUniverseSnapshotCli([
      `--snapshot-id=${snapshotId}`, '--delete',
    ], { loadDb })).rejects.toThrow('destructive evidence-universe snapshot operations are not implemented');
    await expect(runEvidenceUniverseSnapshotCli([
      `--snapshot-id=${snapshotId}`, '--timeout-ms=999',
    ], { loadDb })).rejects.toThrow('--timeout-ms must be an integer');
    await expect(runEvidenceUniverseSnapshotCli([
      '--inspect-source', '--write-snapshot', `--snapshot-id=${snapshotId}`,
    ], { loadDb })).rejects.toThrow('--inspect-source cannot be combined');
    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot', `--snapshot-id=${snapshotId}`,
    ], { loadDb })).rejects.toThrow('--census-receipt is required');
    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot', `--snapshot-id=${snapshotId}`, '--census-receipt=census.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
    })).rejects.toThrow('--approval is required');
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('rejects blocked or stale census artifacts before opening the database', async () => {
    const loadDb = vi.fn();
    const blockedBody = {
      ...censusBody,
      readyForSnapshotCapture: false,
      blockers: ['capture_prerequisite_missing:relation:test'],
    };
    const blockedReceiptSha256 = relationshipInputSha256(blockedBody);
    const blockedApproval = buildEvidenceUniverseSnapshotCaptureApproval({
      ...readyApproval,
      censusReceiptSha256: blockedReceiptSha256,
    });
    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot', `--snapshot-id=${snapshotId}`, '--census-receipt=census.json',
      '--approval=approval.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => ({
        ...blockedBody,
        receiptSha256: blockedReceiptSha256,
      })),
      readSnapshotApproval: vi.fn(async () => blockedApproval),
    })).rejects.toThrow('evidence_universe_source_census_not_capture_ready');
    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot', `--snapshot-id=${snapshotId}`, '--census-receipt=census.json',
      '--approval=approval.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
      readSnapshotApproval: vi.fn(async () => readyApproval),
      now: () => new Date('2026-07-22T16:30:00.000Z'),
    })).rejects.toThrow('evidence_universe_source_census_expired');
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('rejects mismatched and future-dated approvals before opening the database', async () => {
    const loadDb = vi.fn();
    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot', `--snapshot-id=${snapshotId}`, '--census-receipt=census.json',
      '--approval=approval.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
      readSnapshotApproval: vi.fn(async () => buildEvidenceUniverseSnapshotCaptureApproval({
        ...readyApproval,
        snapshotId: '00000000-0000-4000-8000-000000000124',
      })),
      now: () => new Date('2026-07-22T14:30:00.000Z'),
    })).rejects.toThrow('evidence_universe_snapshot_approval_binding_mismatch');

    await expect(runEvidenceUniverseSnapshotCli([
      '--write-snapshot', `--snapshot-id=${snapshotId}`, '--census-receipt=census.json',
      '--approval=approval.json',
    ], {
      loadDb,
      readCensusReceipt: vi.fn(async () => readyCensus),
      readSnapshotApproval: vi.fn(async () => buildEvidenceUniverseSnapshotCaptureApproval({
        ...readyApproval,
        approvedAt: '2026-07-22T14:31:00.000Z',
      })),
      now: () => new Date('2026-07-22T14:30:00.000Z'),
    })).rejects.toThrow('evidence_universe_snapshot_approval_timestamp_future');
    expect(loadDb).not.toHaveBeenCalled();
  });
});
