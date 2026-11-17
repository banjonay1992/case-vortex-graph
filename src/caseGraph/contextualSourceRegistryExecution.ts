import {
  verifyContextualSourceRegistryApproval,
  type ContextualSourceRegistryApproval,
} from './contextualSourceRegistryApproval';
import {
  verifyContextualSourceRegistryProposal,
  type ContextualSourceRegistryProposal,
} from './contextualSourceRegistryProposal';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_SOURCE_REGISTRY_EXECUTION_VERSION =
  'case-vortex-contextual-source-registry-execution-v1' as const;

type QueryResult = { rows: Record<string, unknown>[] };
export type ContextualSourceRegistryExecutionClient = {
  query: (
    query: string | { text: string; values?: unknown[]; query_timeout?: number },
    params?: unknown[],
  ) => Promise<QueryResult>;
  release: (error?: Error | boolean) => void;
};

export type ContextualSourceRegistryExecutionReceipt = {
  recordType: 'contextual_source_registry_execution_receipt';
  schemaVersion: typeof CONTEXTUAL_SOURCE_REGISTRY_EXECUTION_VERSION;
  executedAt: string;
  approvalDigest: string;
  proposalDigest: string;
  decisionPacketDigest: string;
  transaction: {
    isolation: 'serializable';
    atomic: true;
    advisoryLock: 'case-vortex-contextual-source-registry-v1';
  };
  inserted: Array<{
    canonicalSource: 'ADSB_LOL' | 'NOAA_NCEI_US_OBSERVATIONS';
    legalStatus: 'approved';
    licenseType: string;
    allowedContentModes: ['derived_only'];
    evidenceUrl: string;
    reviewedAt: string;
    reviewedBy: string;
  }>;
  postcondition: {
    insertedRowCount: 2;
    exactRowsVerified: true;
    activePublicationCount: 0;
  };
  guarantees: {
    registryRowsInserted: 2;
    registryRowsUpdated: 0;
    registryRowsDeleted: 0;
    providerCalls: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    publicationActivations: 0;
    deployments: 0;
  };
  receiptDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_APPROVAL_AGE_MS = 60 * 60 * 1000;
const LOCK_NAME = 'case-vortex-contextual-source-registry-v1' as const;
const invalid = (code: string): never => { throw new Error(code); };

const BEGIN_SQL = 'BEGIN ISOLATION LEVEL SERIALIZABLE';
const LOCK_SQL = `
  SELECT pg_advisory_xact_lock(
    hashtextextended('case-vortex-contextual-source-registry-v1', 0)
  )
`;
const PREREQUISITES_SQL = `
  SELECT
    to_regclass('public.uap_source_legal_registry') IS NOT NULL AS registry_present,
    to_regclass('public.uap_case_graph_publications') IS NOT NULL AS publications_present
`;
const ACTIVE_PUBLICATION_SQL = `
  SELECT COUNT(*)::integer AS active_count
  FROM public.uap_case_graph_publications
  WHERE active = true
`;
const CURRENT_ROWS_SQL = `
  SELECT
    canonical_source,
    legal_status,
    license_type,
    allowed_content_modes,
    evidence_url,
    reviewed_at,
    reviewed_by
  FROM public.uap_source_legal_registry
  WHERE canonical_source = ANY($1::text[])
  ORDER BY canonical_source
  FOR UPDATE
`;
const INSERT_SQL = `
  INSERT INTO public.uap_source_legal_registry (
    canonical_source,
    legal_status,
    license_type,
    allowed_content_modes,
    evidence_url,
    reviewed_at,
    reviewed_by
  )
  VALUES
    ($1, $2, $3, $4::text[], $5, $6::timestamptz, $7),
    ($8, $9, $10, $11::text[], $12, $13::timestamptz, $14)
  ON CONFLICT (canonical_source) DO NOTHING
  RETURNING canonical_source
`;
const EXECUTED_AT_SQL = `
  SELECT to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS executed_at
`;

const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== 'string') invalid(code);
  const normalized = value as string;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) invalid(code);
  return normalized;
};

const integer = (value: unknown, code: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid(code);
  return parsed;
};

const text = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 2_000) {
    invalid(code);
  }
  return value as string;
};

const exactObject = (
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) invalid(code);
  return object;
};

const reviewedBy = (approval: ContextualSourceRegistryApproval) => {
  const value = `case-vortex:${approval.approvalId}:${approval.approvedBy}`;
  if (Buffer.byteLength(value, 'utf8') > 500) {
    invalid('contextual_source_registry_execution_reviewer_invalid');
  }
  return value;
};

const compareCanonicalSource = (
  left: { canonicalSource: string },
  right: { canonicalSource: string },
) => (left.canonicalSource < right.canonicalSource
  ? -1
  : left.canonicalSource > right.canonicalSource ? 1 : 0);

const expectedRows = (
  proposal: ContextualSourceRegistryProposal,
  approval: ContextualSourceRegistryApproval,
) => proposal.changes.map((change) => ({
  canonicalSource: change.canonicalSource,
  legalStatus: change.proposedRegistryRow.legalStatus,
  licenseType: change.proposedRegistryRow.licenseType,
  allowedContentModes: [...change.proposedRegistryRow.allowedContentModes] as ['derived_only'],
  evidenceUrl: change.proposedRegistryRow.evidenceUrl,
  reviewedAt: approval.approvedAt,
  reviewedBy: reviewedBy(approval),
})).sort(compareCanonicalSource);

const databaseTimestamp = (value: unknown) => {
  const parsed = value instanceof Date
    ? value
    : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    invalid('contextual_source_registry_execution_postcondition_failed');
  }
  return parsed.toISOString();
};

const normalizeDatabaseRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  if (!Array.isArray(row.allowed_content_modes)
    || row.allowed_content_modes.length !== 1
    || row.allowed_content_modes[0] !== 'derived_only') {
    invalid('contextual_source_registry_execution_postcondition_failed');
  }
  return {
    canonicalSource: text(
      row.canonical_source,
      'contextual_source_registry_execution_postcondition_failed',
    ),
    legalStatus: text(
      row.legal_status,
      'contextual_source_registry_execution_postcondition_failed',
    ),
    licenseType: text(
      row.license_type,
      'contextual_source_registry_execution_postcondition_failed',
    ),
    allowedContentModes: ['derived_only'],
    evidenceUrl: text(
      row.evidence_url,
      'contextual_source_registry_execution_postcondition_failed',
    ),
    reviewedAt: timestamp(
      databaseTimestamp(row.reviewed_at),
      'contextual_source_registry_execution_postcondition_failed',
    ),
    reviewedBy: text(
      row.reviewed_by,
      'contextual_source_registry_execution_postcondition_failed',
    ),
  };
}).sort(compareCanonicalSource);

const assertExactPostconditionRows = (
  actual: ReturnType<typeof normalizeDatabaseRows>,
  expected: ReturnType<typeof expectedRows>,
) => {
  if (actual.length !== expected.length) {
    invalid('contextual_source_registry_execution_postcondition_count_failed');
  }
  const fields = [
    'canonicalSource', 'legalStatus', 'licenseType', 'allowedContentModes',
    'evidenceUrl', 'reviewedAt', 'reviewedBy',
  ] as const;
  for (let index = 0; index < expected.length; index += 1) {
    for (const field of fields) {
      if (relationshipInputSha256(actual[index][field])
        !== relationshipInputSha256(expected[index][field])) {
        invalid(`contextual_source_registry_execution_postcondition_${field}_failed`);
      }
    }
  }
};

const buildReceipt = (params: {
  executedAt: string;
  approval: ContextualSourceRegistryApproval;
  proposal: ContextualSourceRegistryProposal;
  inserted: ReturnType<typeof expectedRows>;
}): ContextualSourceRegistryExecutionReceipt => {
  const withoutDigest: Omit<ContextualSourceRegistryExecutionReceipt, 'receiptDigest'> = {
    recordType: 'contextual_source_registry_execution_receipt',
    schemaVersion: CONTEXTUAL_SOURCE_REGISTRY_EXECUTION_VERSION,
    executedAt: timestamp(
      params.executedAt,
      'contextual_source_registry_execution_time_invalid',
    ),
    approvalDigest: params.approval.approvalDigest,
    proposalDigest: params.proposal.proposalDigest,
    decisionPacketDigest: params.proposal.boundDecisionPacket.packetDigest,
    transaction: {
      isolation: 'serializable',
      atomic: true,
      advisoryLock: LOCK_NAME,
    },
    inserted: params.inserted,
    postcondition: {
      insertedRowCount: 2,
      exactRowsVerified: true,
      activePublicationCount: 0,
    },
    guarantees: {
      registryRowsInserted: 2,
      registryRowsUpdated: 0,
      registryRowsDeleted: 0,
      providerCalls: 0,
      storageReads: 0,
      storageWrites: 0,
      lunaCalls: 0,
      publicationActivations: 0,
      deployments: 0,
    },
  };
  return {
    ...withoutDigest,
    receiptDigest: relationshipInputSha256(withoutDigest),
  };
};

export const verifyContextualSourceRegistryExecutionReceipt = (
  value: unknown,
  approvalValue: unknown,
  proposalValue: unknown,
  decisionPacket: unknown,
): ContextualSourceRegistryExecutionReceipt => {
  const approval = verifyContextualSourceRegistryApproval(
    approvalValue,
    proposalValue,
    decisionPacket,
  );
  const proposal = verifyContextualSourceRegistryProposal(proposalValue, decisionPacket);
  const receipt = exactObject(value, [
    'recordType', 'schemaVersion', 'executedAt', 'approvalDigest',
    'proposalDigest', 'decisionPacketDigest', 'transaction', 'inserted',
    'postcondition', 'guarantees', 'receiptDigest',
  ], 'contextual_source_registry_execution_receipt_invalid');
  if (receipt.recordType !== 'contextual_source_registry_execution_receipt'
    || receipt.schemaVersion !== CONTEXTUAL_SOURCE_REGISTRY_EXECUTION_VERSION
    || typeof receipt.receiptDigest !== 'string'
    || !SHA256.test(receipt.receiptDigest)) {
    invalid('contextual_source_registry_execution_receipt_invalid');
  }
  const rebuilt = buildReceipt({
    executedAt: receipt.executedAt as string,
    approval,
    proposal,
    inserted: expectedRows(proposal, approval),
  });
  if (relationshipInputSha256(receipt) !== relationshipInputSha256(rebuilt)) {
    invalid('contextual_source_registry_execution_receipt_drift');
  }
  return rebuilt;
};

export const executeApprovedContextualSourceRegistryChange = async (params: {
  approval: unknown;
  proposal: unknown;
  decisionPacket: unknown;
  timeoutMs?: number;
}, dependencies: {
  getClient: () => Promise<ContextualSourceRegistryExecutionClient>;
}): Promise<ContextualSourceRegistryExecutionReceipt> => {
  const proposal = verifyContextualSourceRegistryProposal(
    params.proposal,
    params.decisionPacket,
  );
  const approval = verifyContextualSourceRegistryApproval(
    params.approval,
    proposal,
    params.decisionPacket,
  );
  const timeoutMs = params.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    invalid('contextual_source_registry_execution_timeout_invalid');
  }
  const client = await dependencies.getClient();
  let open = false;
  try {
    await client.query(BEGIN_SQL);
    open = true;
    await client.query("SELECT set_config('statement_timeout', $1::text, true)", [
      `${timeoutMs}ms`,
    ]);
    await client.query(LOCK_SQL);
    const prerequisites = await client.query(PREREQUISITES_SQL);
    if (prerequisites.rows.length !== 1
      || prerequisites.rows[0].registry_present !== true
      || prerequisites.rows[0].publications_present !== true) {
      invalid('contextual_source_registry_execution_prerequisite_missing');
    }
    const identity = await client.query(EXECUTED_AT_SQL);
    if (identity.rows.length !== 1) {
      invalid('contextual_source_registry_execution_identity_invalid');
    }
    const executedAt = timestamp(
      identity.rows[0].executed_at,
      'contextual_source_registry_execution_identity_invalid',
    );
    const approvalAgeMs = new Date(executedAt).getTime()
      - new Date(approval.approvedAt).getTime();
    if (!Number.isFinite(approvalAgeMs)
      || approvalAgeMs < 0
      || approvalAgeMs > MAX_APPROVAL_AGE_MS) {
      invalid('contextual_source_registry_execution_approval_stale');
    }
    const active = await client.query(ACTIVE_PUBLICATION_SQL);
    if (active.rows.length !== 1
      || integer(
        active.rows[0].active_count,
        'contextual_source_registry_execution_active_publication_invalid',
      ) !== 0) {
      invalid('contextual_source_registry_execution_active_publication_present');
    }
    const rows = expectedRows(proposal, approval);
    const sources = rows.map(({ canonicalSource }) => canonicalSource);
    const current = await client.query(CURRENT_ROWS_SQL, [sources]);
    if (current.rows.length !== 0) {
      invalid('contextual_source_registry_execution_row_no_longer_missing');
    }
    const values = rows.flatMap((row) => [
      row.canonicalSource,
      row.legalStatus,
      row.licenseType,
      row.allowedContentModes,
      row.evidenceUrl,
      row.reviewedAt,
      row.reviewedBy,
    ]);
    const inserted = await client.query({ text: INSERT_SQL, values, query_timeout: timeoutMs });
    if (inserted.rows.length !== 2
      || relationshipInputSha256(
        inserted.rows.map((row) => row.canonical_source).sort(),
      ) !== relationshipInputSha256(sources)) {
      invalid('contextual_source_registry_execution_insert_failed');
    }
    const post = await client.query(CURRENT_ROWS_SQL, [sources]);
    const normalized = normalizeDatabaseRows(post.rows);
    assertExactPostconditionRows(normalized, rows);
    const receipt = buildReceipt({ executedAt, approval, proposal, inserted: rows });
    await client.query('COMMIT');
    open = false;
    return receipt;
  } catch (error) {
    if (open) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const contextualSourceRegistryExecutionSqlForTests = {
  beginSql: BEGIN_SQL,
  lockSql: LOCK_SQL,
  prerequisitesSql: PREREQUISITES_SQL,
  activePublicationSql: ACTIVE_PUBLICATION_SQL,
  currentRowsSql: CURRENT_ROWS_SQL,
  insertSql: INSERT_SQL,
  executedAtSql: EXECUTED_AT_SQL,
};
