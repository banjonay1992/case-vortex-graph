import { hasGovernedPublicContentMode } from '../utils/dataQualityVisibility';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

type QueryResult = { rows: Record<string, unknown>[] };
export type SourceGovernanceLedgerClient = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
};

const DECISIONS = [
  'approved_public',
  'source_governance_missing',
  'source_governance_not_approved',
  'source_governance_non_public_mode',
] as const;
type GovernanceDecision = typeof DECISIONS[number];
type LegalStatus = 'approved' | 'review' | 'blocked' | 'restricted' | 'missing';

export type SourceGovernanceLedgerReceipt = {
  schemaVersion: 'case-vortex-source-governance-ledger-v1';
  inspectedAt: string;
  sourceMvccSnapshot: string;
  transaction: { isolation: 'repeatable read'; readOnly: true };
  boundCensus: {
    receiptSha256: string;
    inspectedAt: string;
    sourceMvccSnapshot: string;
    expectedSourceUnapprovedRows: number;
  };
  summary: {
    sourceCount: number;
    totalRows: number;
    approvedPublicRows: number;
    excludedRows: number;
    exclusionReasons: {
      missingRegistry: number;
      notApproved: number;
      nonPublicMode: number;
    };
  };
  sources: Array<{
    normalizedSource: string;
    canonicalSource: string;
    aliasApplied: boolean;
    totalRows: number;
    decision: GovernanceDecision;
    legalStatus: LegalStatus;
    allowedContentModes: string[];
    evidenceUrlPresent: boolean;
  }>;
  guarantees: { databaseWrites: 0; r2Reads: 0; r2Writes: 0; lunaCalls: 0; networkDiscoveryCalls: 0 };
  receiptSha256: string;
};

const beginSql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const sourceCountsSql = `
  SELECT source, COUNT(*)::bigint AS row_count
  FROM public.uap_sightings
  GROUP BY source
  ORDER BY source NULLS FIRST
`;
const aliasesSql = `
  SELECT alias, canonical_source
  FROM public.uap_source_alias_map
  WHERE COALESCE(active, true) = true
  ORDER BY alias
`;
const registrySql = `
  SELECT canonical_source, legal_status, allowed_content_modes, evidence_url
  FROM public.uap_source_legal_registry
  ORDER BY canonical_source
`;

const normalizeSource = (value: unknown) => {
  const source = String(value ?? '').trim().toUpperCase() || 'UNKNOWN';
  if (source.length > 500 || /[\u0000-\u001f\u007f]/u.test(source)) {
    throw new Error('source_governance_ledger_source_invalid');
  }
  return source;
};

const count = (value: unknown, code: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
};

const timestamp = (value: unknown, code: string) => {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/u.test(raw)
    || !Number.isFinite(new Date(raw).getTime())) throw new Error(code);
  return raw;
};

const sha = (value: unknown, code: string) => {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error(code);
  return digest;
};

const mvcc = (value: unknown) => {
  const snapshot = String(value || '').trim();
  if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/u.test(snapshot)) {
    throw new Error('source_governance_ledger_mvcc_invalid');
  }
  return snapshot;
};

const exactKeys = (value: Record<string, unknown>, expected: string[], code: string) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
};

const modes = (value: unknown, code: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(code);
  const normalized = [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
  if (normalized.length > 32 || normalized.some((item) => item.length > 64)) throw new Error(code);
  return normalized;
};

const parseLegalStatus = (value: unknown): Exclude<LegalStatus, 'missing'> => {
  const status = String(value || '').trim().toLowerCase();
  if (!['approved', 'review', 'blocked', 'restricted'].includes(status)) {
    throw new Error('source_governance_ledger_legal_status_invalid');
  }
  return status as Exclude<LegalStatus, 'missing'>;
};

const decisionFor = (registry: { legalStatus: Exclude<LegalStatus, 'missing'>; allowedContentModes: string[] } | null) => {
  if (!registry) return 'source_governance_missing' as const;
  if (registry.legalStatus !== 'approved') return 'source_governance_not_approved' as const;
  if (!hasGovernedPublicContentMode(registry.allowedContentModes)) {
    return 'source_governance_non_public_mode' as const;
  }
  return 'approved_public' as const;
};

export const verifySourceGovernanceLedgerReceipt = (value: unknown): SourceGovernanceLedgerReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('source_governance_ledger_receipt_invalid');
  }
  const candidate = value as Record<string, unknown>;
  exactKeys(candidate, [
    'schemaVersion', 'inspectedAt', 'sourceMvccSnapshot', 'transaction', 'boundCensus',
    'summary', 'sources', 'guarantees', 'receiptSha256',
  ], 'source_governance_ledger_receipt_invalid');
  if (candidate.schemaVersion !== 'case-vortex-source-governance-ledger-v1') {
    throw new Error('source_governance_ledger_receipt_invalid');
  }
  const inspectedAt = timestamp(candidate.inspectedAt, 'source_governance_ledger_timestamp_invalid');
  const sourceMvccSnapshot = mvcc(candidate.sourceMvccSnapshot);
  const transaction = candidate.transaction as Record<string, unknown>;
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new Error('source_governance_ledger_transaction_invalid');
  }
  exactKeys(transaction, ['isolation', 'readOnly'], 'source_governance_ledger_transaction_invalid');
  if (transaction.isolation !== 'repeatable read' || transaction.readOnly !== true) {
    throw new Error('source_governance_ledger_transaction_invalid');
  }
  const bound = candidate.boundCensus as Record<string, unknown>;
  if (!bound || typeof bound !== 'object' || Array.isArray(bound)) {
    throw new Error('source_governance_ledger_census_binding_invalid');
  }
  exactKeys(
    bound,
    ['receiptSha256', 'inspectedAt', 'sourceMvccSnapshot', 'expectedSourceUnapprovedRows'],
    'source_governance_ledger_census_binding_invalid',
  );
  const boundCensus = {
    receiptSha256: sha(bound.receiptSha256, 'source_governance_ledger_census_binding_invalid'),
    inspectedAt: timestamp(bound.inspectedAt, 'source_governance_ledger_census_binding_invalid'),
    sourceMvccSnapshot: mvcc(bound.sourceMvccSnapshot),
    expectedSourceUnapprovedRows: count(
      bound.expectedSourceUnapprovedRows,
      'source_governance_ledger_census_binding_invalid',
    ),
  };
  if (!Array.isArray(candidate.sources) || candidate.sources.length > 10_000) {
    throw new Error('source_governance_ledger_sources_invalid');
  }
  let previousSource = '';
  const sources = candidate.sources.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('source_governance_ledger_source_invalid');
    }
    const item = raw as Record<string, unknown>;
    exactKeys(item, [
      'normalizedSource', 'canonicalSource', 'aliasApplied', 'totalRows', 'decision',
      'legalStatus', 'allowedContentModes', 'evidenceUrlPresent',
    ], 'source_governance_ledger_source_invalid');
    const normalizedSource = normalizeSource(item.normalizedSource);
    const canonicalSource = normalizeSource(item.canonicalSource);
    if (previousSource && previousSource >= normalizedSource) {
      throw new Error('source_governance_ledger_sources_order_invalid');
    }
    previousSource = normalizedSource;
    if (typeof item.aliasApplied !== 'boolean'
      || item.aliasApplied !== (normalizedSource !== canonicalSource)
      || !DECISIONS.includes(item.decision as GovernanceDecision)
      || !['approved', 'review', 'blocked', 'restricted', 'missing'].includes(String(item.legalStatus))
      || typeof item.evidenceUrlPresent !== 'boolean') {
      throw new Error('source_governance_ledger_source_invalid');
    }
    const legalStatus = item.legalStatus as LegalStatus;
    const allowedContentModes = modes(item.allowedContentModes, 'source_governance_ledger_source_invalid');
    const expectedDecision = decisionFor(legalStatus === 'missing' ? null : { legalStatus, allowedContentModes });
    if (item.decision !== expectedDecision
      || (legalStatus === 'missing' && (allowedContentModes.length > 0 || item.evidenceUrlPresent))) {
      throw new Error('source_governance_ledger_source_decision_invalid');
    }
    return {
      normalizedSource,
      canonicalSource,
      aliasApplied: item.aliasApplied,
      totalRows: count(item.totalRows, 'source_governance_ledger_source_count_invalid'),
      decision: item.decision as GovernanceDecision,
      legalStatus,
      allowedContentModes,
      evidenceUrlPresent: item.evidenceUrlPresent,
    };
  });
  if (sources.length === 0 || sources.some((source) => source.totalRows === 0)) {
    throw new Error('source_governance_ledger_sources_invalid');
  }
  const computed = {
    sourceCount: sources.length,
    totalRows: sources.reduce((sum, source) => sum + source.totalRows, 0),
    approvedPublicRows: sources.filter((source) => source.decision === 'approved_public')
      .reduce((sum, source) => sum + source.totalRows, 0),
    excludedRows: sources.filter((source) => source.decision !== 'approved_public')
      .reduce((sum, source) => sum + source.totalRows, 0),
    exclusionReasons: {
      missingRegistry: sources.filter((source) => source.decision === 'source_governance_missing')
        .reduce((sum, source) => sum + source.totalRows, 0),
      notApproved: sources.filter((source) => source.decision === 'source_governance_not_approved')
        .reduce((sum, source) => sum + source.totalRows, 0),
      nonPublicMode: sources.filter((source) => source.decision === 'source_governance_non_public_mode')
        .reduce((sum, source) => sum + source.totalRows, 0),
    },
  };
  if (relationshipInputSha256(candidate.summary) !== relationshipInputSha256(computed)
    || computed.excludedRows !== boundCensus.expectedSourceUnapprovedRows) {
    throw new Error('source_governance_ledger_reconciliation_invalid');
  }
  const guarantees = candidate.guarantees as Record<string, unknown>;
  if (!guarantees || typeof guarantees !== 'object' || Array.isArray(guarantees)) {
    throw new Error('source_governance_ledger_guarantees_invalid');
  }
  exactKeys(
    guarantees,
    ['databaseWrites', 'r2Reads', 'r2Writes', 'lunaCalls', 'networkDiscoveryCalls'],
    'source_governance_ledger_guarantees_invalid',
  );
  if (Object.values(guarantees).some((item) => item !== 0)) {
    throw new Error('source_governance_ledger_guarantees_invalid');
  }
  const body: Omit<SourceGovernanceLedgerReceipt, 'receiptSha256'> = {
    schemaVersion: 'case-vortex-source-governance-ledger-v1',
    inspectedAt,
    sourceMvccSnapshot,
    transaction: { isolation: 'repeatable read', readOnly: true },
    boundCensus,
    summary: computed,
    sources,
    guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0, networkDiscoveryCalls: 0 },
  };
  if (sha(candidate.receiptSha256, 'source_governance_ledger_receipt_invalid') !== relationshipInputSha256(body)) {
    throw new Error('source_governance_ledger_receipt_digest_invalid');
  }
  return { ...body, receiptSha256: candidate.receiptSha256 as string };
};

export const inspectPostgresSourceGovernanceLedger = async (
  client: SourceGovernanceLedgerClient,
  options: {
    statementTimeoutMs?: number;
    boundCensus: SourceGovernanceLedgerReceipt['boundCensus'];
  },
): Promise<SourceGovernanceLedgerReceipt> => {
  const timeoutMs = Math.trunc(options.statementTimeoutMs ?? 10 * 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60_000) {
    throw new Error('source_governance_ledger_timeout_invalid');
  }
  const boundCensus = {
    receiptSha256: sha(options.boundCensus.receiptSha256, 'source_governance_ledger_census_binding_invalid'),
    inspectedAt: timestamp(options.boundCensus.inspectedAt, 'source_governance_ledger_census_binding_invalid'),
    sourceMvccSnapshot: mvcc(options.boundCensus.sourceMvccSnapshot),
    expectedSourceUnapprovedRows: count(
      options.boundCensus.expectedSourceUnapprovedRows,
      'source_governance_ledger_census_binding_invalid',
    ),
  };
  let open = false;
  try {
    await client.query(beginSql);
    open = true;
    await client.query("SELECT set_config('statement_timeout', $1::text, true)", [`${timeoutMs}ms`]);
    const identityResult = await client.query(`
      SELECT
        to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS inspected_at,
        pg_current_snapshot()::text AS source_mvcc_snapshot
    `);
    if (identityResult.rows.length !== 1) throw new Error('source_governance_ledger_identity_invalid');
    const inspectedAt = timestamp(identityResult.rows[0].inspected_at, 'source_governance_ledger_timestamp_invalid');
    const sourceMvccSnapshot = mvcc(identityResult.rows[0].source_mvcc_snapshot);
    const sourceResult = await client.query(sourceCountsSql);
    const aliasResult = await client.query(aliasesSql);
    const registryResult = await client.query(registrySql);
    const sourceCounts = new Map<string, number>();
    for (const row of sourceResult.rows) {
      const source = normalizeSource(row.source);
      sourceCounts.set(source, (sourceCounts.get(source) || 0)
        + count(row.row_count, 'source_governance_ledger_source_count_invalid'));
    }
    const aliases = new Map<string, string>();
    for (const row of aliasResult.rows) {
      const alias = normalizeSource(row.alias);
      const canonical = normalizeSource(row.canonical_source);
      const prior = aliases.get(alias);
      if (prior && prior !== canonical) throw new Error('source_governance_ledger_alias_collision');
      aliases.set(alias, canonical);
    }
    const registry = new Map<string, {
      legalStatus: Exclude<LegalStatus, 'missing'>;
      allowedContentModes: string[];
      evidenceUrlPresent: boolean;
    }>();
    for (const row of registryResult.rows) {
      const canonical = normalizeSource(row.canonical_source);
      if (registry.has(canonical)) throw new Error('source_governance_ledger_registry_collision');
      registry.set(canonical, {
        legalStatus: parseLegalStatus(row.legal_status),
        allowedContentModes: modes(row.allowed_content_modes ?? [], 'source_governance_ledger_registry_modes_invalid'),
        evidenceUrlPresent: Boolean(String(row.evidence_url || '').trim()),
      });
    }
    const sources: SourceGovernanceLedgerReceipt['sources'] = [...sourceCounts.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([normalizedSource, totalRows]) => {
        const canonicalSource = aliases.get(normalizedSource) || normalizedSource;
        const legal = registry.get(canonicalSource) || null;
        return {
          normalizedSource,
          canonicalSource,
          aliasApplied: canonicalSource !== normalizedSource,
          totalRows,
          decision: decisionFor(legal),
          legalStatus: legal?.legalStatus || 'missing',
          allowedContentModes: legal?.allowedContentModes || [],
          evidenceUrlPresent: legal?.evidenceUrlPresent || false,
        };
      });
    const summary = {
      sourceCount: sources.length,
      totalRows: sources.reduce((sum, source) => sum + source.totalRows, 0),
      approvedPublicRows: sources.filter((source) => source.decision === 'approved_public')
        .reduce((sum, source) => sum + source.totalRows, 0),
      excludedRows: sources.filter((source) => source.decision !== 'approved_public')
        .reduce((sum, source) => sum + source.totalRows, 0),
      exclusionReasons: {
        missingRegistry: sources.filter((source) => source.decision === 'source_governance_missing')
          .reduce((sum, source) => sum + source.totalRows, 0),
        notApproved: sources.filter((source) => source.decision === 'source_governance_not_approved')
          .reduce((sum, source) => sum + source.totalRows, 0),
        nonPublicMode: sources.filter((source) => source.decision === 'source_governance_non_public_mode')
          .reduce((sum, source) => sum + source.totalRows, 0),
      },
    };
    if (summary.excludedRows !== boundCensus.expectedSourceUnapprovedRows) {
      throw new Error('source_governance_ledger_census_drift');
    }
    const body: Omit<SourceGovernanceLedgerReceipt, 'receiptSha256'> = {
      schemaVersion: 'case-vortex-source-governance-ledger-v1',
      inspectedAt,
      sourceMvccSnapshot,
      transaction: { isolation: 'repeatable read', readOnly: true },
      boundCensus,
      summary,
      sources,
      guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0, networkDiscoveryCalls: 0 },
    };
    const receipt = { ...body, receiptSha256: relationshipInputSha256(body) };
    const verified = verifySourceGovernanceLedgerReceipt(receipt);
    await client.query('COMMIT');
    open = false;
    return verified;
  } catch (error) {
    if (open) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

export const sourceGovernanceLedgerSqlForTests = { sourceCountsSql, aliasesSql, registrySql };
