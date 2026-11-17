import { describe, expect, it, vi } from 'vitest';

import {
  inspectPostgresSourceGovernanceLedger,
  sourceGovernanceLedgerSqlForTests,
  verifySourceGovernanceLedgerReceipt,
} from '../../src/caseGraph/postgresSourceGovernanceLedger';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const boundCensus = {
  receiptSha256: 'a'.repeat(64),
  inspectedAt: '2026-07-22T16:20:01.253485Z',
  sourceMvccSnapshot: '100:200:',
  expectedSourceUnapprovedRows: 32,
};

const queryFor = (overrides: {
  sources?: Record<string, unknown>[];
  aliases?: Record<string, unknown>[];
  registry?: Record<string, unknown>[];
} = {}) => vi.fn(async (sql: string) => {
  if (sql.includes('pg_current_snapshot()')) return { rows: [{
    inspected_at: '2026-07-22T16:30:00.123456Z',
    source_mvcc_snapshot: '101:201:',
  }] };
  if (sql === sourceGovernanceLedgerSqlForTests.sourceCountsSql) return { rows: overrides.sources || [
    { source: 'AARO', row_count: '10' },
    { source: 'aaro_sightings', row_count: '5' },
    { source: 'Missing', row_count: '7' },
    { source: 'private', row_count: '13' },
    { source: 'review', row_count: '11' },
    { source: '_archive', row_count: '1' },
  ] };
  if (sql === sourceGovernanceLedgerSqlForTests.aliasesSql) return { rows: overrides.aliases || [
    { alias: 'AARO_SIGHTINGS', canonical_source: 'AARO' },
  ] };
  if (sql === sourceGovernanceLedgerSqlForTests.registrySql) return { rows: overrides.registry || [
    { canonical_source: 'AARO', legal_status: 'approved', allowed_content_modes: ['full_ingest'], evidence_url: 'https://aaro.mil' },
    { canonical_source: 'PRIVATE', legal_status: 'approved', allowed_content_modes: ['metadata_only'], evidence_url: 'https://example.test' },
    { canonical_source: 'REVIEW', legal_status: 'review', allowed_content_modes: ['full_ingest'], evidence_url: null },
  ] };
  return { rows: [] };
});

const reseal = (receipt: Record<string, unknown>, overrides: Record<string, unknown>) => {
  const { receiptSha256: _digest, ...body } = { ...receipt, ...overrides };
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

describe('Postgres source-governance ledger', () => {
  it('resolves aliases and reconciles every governed and excluded source row read-only', async () => {
    const query = queryFor();
    const receipt = await inspectPostgresSourceGovernanceLedger({ query }, { boundCensus });
    expect(receipt.summary).toEqual({
      sourceCount: 6,
      totalRows: 47,
      approvedPublicRows: 15,
      excludedRows: 32,
      exclusionReasons: { missingRegistry: 8, notApproved: 11, nonPublicMode: 13 },
    });
    expect(receipt.sources).toEqual([
      expect.objectContaining({ normalizedSource: 'AARO', canonicalSource: 'AARO', aliasApplied: false, decision: 'approved_public' }),
      expect.objectContaining({ normalizedSource: 'AARO_SIGHTINGS', canonicalSource: 'AARO', aliasApplied: true, decision: 'approved_public' }),
      expect.objectContaining({ normalizedSource: 'MISSING', legalStatus: 'missing', decision: 'source_governance_missing' }),
      expect.objectContaining({ normalizedSource: 'PRIVATE', legalStatus: 'approved', decision: 'source_governance_non_public_mode' }),
      expect.objectContaining({ normalizedSource: 'REVIEW', legalStatus: 'review', decision: 'source_governance_not_approved' }),
      expect.objectContaining({ normalizedSource: '_ARCHIVE', legalStatus: 'missing', decision: 'source_governance_missing' }),
    ]);
    expect(verifySourceGovernanceLedgerReceipt(receipt)).toEqual(receipt);
    expect(query.mock.calls[0]?.[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(query.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/iu.test(sql)))
      .toBe(false);
  });

  it('rejects a re-sealed source-count change and a false governance decision', async () => {
    const receipt = await inspectPostgresSourceGovernanceLedger({ query: queryFor() }, { boundCensus });
    expect(() => verifySourceGovernanceLedgerReceipt(reseal(receipt, {
      sources: receipt.sources.map((source) => (
        source.normalizedSource === 'MISSING' ? { ...source, totalRows: source.totalRows + 1 } : source
      )),
    }))).toThrow('source_governance_ledger_reconciliation_invalid');
    expect(() => verifySourceGovernanceLedgerReceipt(reseal(receipt, {
      sources: receipt.sources.map((source) => (
        source.normalizedSource === 'REVIEW' ? { ...source, decision: 'approved_public' } : source
      )),
    }))).toThrow('source_governance_ledger_source_decision_invalid');
  });

  it('rolls back census drift and normalized alias collisions', async () => {
    const driftQuery = queryFor();
    await expect(inspectPostgresSourceGovernanceLedger({ query: driftQuery }, {
      boundCensus: { ...boundCensus, expectedSourceUnapprovedRows: 31 },
    })).rejects.toThrow('source_governance_ledger_census_drift');
    expect(driftQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);

    const collisionQuery = queryFor({ aliases: [
      { alias: 'x', canonical_source: 'AARO' },
      { alias: ' X ', canonical_source: 'PRIVATE' },
    ] });
    await expect(inspectPostgresSourceGovernanceLedger({ query: collisionQuery }, { boundCensus }))
      .rejects.toThrow('source_governance_ledger_alias_collision');
    expect(collisionQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });
});
