import { describe, expect, it, vi } from 'vitest';

import { runSourceGovernanceLedgerCli } from '../../src/cli/captureSourceGovernanceLedger';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const censusBody = {
  schemaVersion: 'evidence-universe-source-census-v2' as const,
  inspectedAt: '2026-07-22T16:20:01.253485Z',
  sourceMvccSnapshot: '100:200:',
  transaction: { isolation: 'repeatable read' as const, readOnly: true as const },
  prerequisites: { missingBase: [], missingCapture: ['relation:test'] },
  counts: { sighting: 2, document: 3, photo: 4, video: 5 },
  total: 14,
  sightingAccounting: {
    total: 4,
    eligible: 2,
    excluded: 2,
    exclusionReasons: {
      sourceUnapproved: 2,
      registryBlocklist: 0,
      duplicateNonPrimary: 0,
      futureDated: 0,
      invalidGeography: 0,
      cursorMissing: 0,
      afterCutoff: 0,
      unclassified: 0,
    },
  },
  mediaAccounting: {
    document: { total: 3, public: 3, nonPublic: 0 },
    photo: { total: 4, public: 4, nonPublic: 0 },
    video: { total: 5, public: 5, nonPublic: 0 },
  },
  mediaState: { document: null, photo: null, video: null },
  invalidPublicMediaCursors: 0,
  readyForSnapshotCapture: false,
  blockers: ['capture_prerequisite_missing:relation:test'],
  guarantees: { databaseWrites: 0 as const, r2Reads: 0 as const, r2Writes: 0 as const, lunaCalls: 0 as const },
};
const census = { ...censusBody, receiptSha256: relationshipInputSha256(censusBody) };

describe('source-governance ledger CLI', () => {
  it('requires a fresh census and rejects mutation flags before database access', async () => {
    const loadDb = vi.fn();
    await expect(runSourceGovernanceLedgerCli([], { loadDb, readJson: vi.fn() }))
      .rejects.toThrow('--census-receipt is required');
    await expect(runSourceGovernanceLedgerCli([
      '--census-receipt=census.json', '--approve',
    ], { loadDb, readJson: vi.fn() })).rejects.toThrow('inspection-only');
    await expect(runSourceGovernanceLedgerCli([
      '--census-receipt=census.json',
    ], {
      loadDb,
      readJson: vi.fn(async () => census),
      now: () => new Date('2026-07-22T18:00:02.000Z'),
    })).rejects.toThrow('source_governance_ledger_census_expired');
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('runs through one owned read-only client and writes only the local sealed receipt', async () => {
    const release = vi.fn();
    const closePool = vi.fn(async () => undefined);
    const query = vi.fn(async (input: { text: string }) => {
      const sql = input.text;
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        inspected_at: '2026-07-22T16:30:00.123456Z', source_mvcc_snapshot: '101:201:',
      }] };
      if (sql.includes('COUNT(*)::bigint AS row_count')) return { rows: [
        { source: 'AARO', row_count: '3' },
        { source: 'MISSING', row_count: '2' },
      ] };
      if (sql.includes('FROM public.uap_source_alias_map')) return { rows: [] };
      if (sql.includes('FROM public.uap_source_legal_registry')) return { rows: [{
        canonical_source: 'AARO', legal_status: 'approved',
        allowed_content_modes: ['full_ingest'], evidence_url: 'https://aaro.mil',
      }] };
      return { rows: [] };
    });
    const writeReceipt = vi.fn(async () => '/tmp/source-ledger.json');
    const result = await runSourceGovernanceLedgerCli([
      '--census-receipt=census.json', '--output=source-ledger.json',
    ], {
      readJson: vi.fn(async () => census),
      loadDb: vi.fn(async () => ({ getClient: async () => ({ query, release }), closePool })),
      writeReceipt,
      now: () => new Date('2026-07-22T16:30:00.000Z'),
    });
    expect(result).toMatchObject({
      inspection_only: true,
      write_enabled: false,
      summary: { totalRows: 5, approvedPublicRows: 3, excludedRows: 2 },
      output_path: '/tmp/source-ledger.json',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      'source-ledger.json',
      expect.objectContaining({ receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    );
    expect(query.mock.calls.some(([input]) => input.text === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
      .toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
