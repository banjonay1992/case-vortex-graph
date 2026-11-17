import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_PLAN_VERSION =
  'case-vortex-contextual-calibration-source-registry-plan-v1' as const;
export const CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_RECEIPT_VERSION =
  'case-vortex-contextual-calibration-source-registry-receipt-v1' as const;
export const CONTEXTUAL_CALIBRATION_SOURCE_AUTHORIZATION =
  'I explicitly approve applying only the contextual calibration source registry changes bound in this exact plan. This does not approve publication.' as const;

const POLICIES = Object.freeze([
  {
    category: 'astronomy',
    canonicalSource: 'ASTRONOMY_ENGINE_LOCAL',
    providerId: 'astronomy-engine-local',
    licenseType: 'mit_astronomy_engine_2_1_19_attribution',
    evidenceUrl: 'https://github.com/cosinekitty/astronomy',
  },
  {
    category: 'satellite',
    canonicalSource: 'SATNOGS_DB_API',
    providerId: 'satnogs-db',
    licenseType: 'cc_by_sa_version_unspecified_attribution_share_alike',
    evidenceUrl: 'https://docs.satnogs.org/projects/satnogs-db/en/latest/api.html',
  },
] as const);

type Policy = typeof POLICIES[number];

export type ContextualCalibrationSourceRegistryPlan = {
  recordType: 'contextual_calibration_source_registry_plan';
  schemaVersion: typeof CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_PLAN_VERSION;
  createdAt: string;
  approvedBy: string;
  authorizationStatement: typeof CONTEXTUAL_CALIBRATION_SOURCE_AUTHORIZATION;
  decisionPacketDigest: string;
  changes: Array<{
    category: Policy['category'];
    canonicalSource: Policy['canonicalSource'];
    providerId: Policy['providerId'];
    decisionEntryDigest: string;
    legalStatus: 'approved';
    licenseType: Policy['licenseType'];
    allowedContentModes: ['derived_only'];
    evidenceUrl: Policy['evidenceUrl'];
  }>;
  constraints: {
    insertOnly: true;
    requireRowsMissing: true;
    requireNoActivePublication: true;
    providerCallsApproved: false;
    archivalWritesApproved: false;
    publicationActivationApproved: false;
    deploymentApproved: false;
  };
  planDigest: string;
};

export type ContextualCalibrationSourceRegistryReceipt = {
  recordType: 'contextual_calibration_source_registry_receipt';
  schemaVersion: typeof CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_RECEIPT_VERSION;
  executedAt: string;
  planDigest: string;
  decisionPacketDigest: string;
  inserted: Array<{
    canonicalSource: Policy['canonicalSource'];
    legalStatus: 'approved';
    licenseType: Policy['licenseType'];
    allowedContentModes: ['derived_only'];
    evidenceUrl: Policy['evidenceUrl'];
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
    archivalWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    publicationActivations: 0;
    deployments: 0;
  };
  receiptDigest: string;
};

type QueryResult = { rows: Record<string, unknown>[] };
export type ContextualCalibrationSourceRegistryClient = {
  query(
    query: string | { text: string; values?: unknown[]; query_timeout?: number },
    params?: unknown[],
  ): Promise<QueryResult>;
  release(error?: Error | boolean): void;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const invalid = (code: string): never => { throw new Error(code); };

const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
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

const findReadyEntry = (
  packet: ContextualSourceGovernanceDecisionPacket,
  policy: Policy,
) => {
  const matches = packet.entries.filter((entry) => (
    entry.category === policy.category
    && entry.canonicalSource === policy.canonicalSource
    && entry.providerId === policy.providerId
  ));
  if (matches.length !== 1) {
    invalid('contextual_calibration_source_registry_candidate_missing');
  }
  const entry = matches[0];
  if (entry.decision !== 'review_required'
    || entry.usableNow
    || entry.registry.legalStatus !== 'missing'
    || entry.registry.allowedContentModes.length !== 0
    || !entry.evidenceFresh
    || entry.rights.commercialUse !== 'allowed'
    || entry.rights.automatedAccess !== 'allowed'
    || entry.rights.archivalUse !== 'allowed'
    || entry.rights.redistribution !== 'allowed'
    || entry.rights.accessConstraint !== 'none'
    || entry.rights.attributionRequired !== true
    || entry.reasonCodes.length !== 2
    || !entry.reasonCodes.includes('source_registry_missing')
    || !entry.reasonCodes.includes('required_content_mode_not_approved')) {
    invalid('contextual_calibration_source_registry_candidate_not_ready');
  }
  return entry;
};

export const buildContextualCalibrationSourceRegistryPlan = (params: {
  decisionPacket: unknown;
  createdAt: string;
  approvedBy: string;
  authorizationStatement: string;
}): ContextualCalibrationSourceRegistryPlan => {
  const packet = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  const createdAt = timestamp(
    params.createdAt,
    'contextual_calibration_source_registry_plan_time_invalid',
  );
  if (!IDENTITY.test(params.approvedBy)) {
    invalid('contextual_calibration_source_registry_plan_identity_invalid');
  }
  if (params.authorizationStatement !== CONTEXTUAL_CALIBRATION_SOURCE_AUTHORIZATION) {
    invalid('contextual_calibration_source_registry_authorization_invalid');
  }
  const body: Omit<ContextualCalibrationSourceRegistryPlan, 'planDigest'> = {
    recordType: 'contextual_calibration_source_registry_plan',
    schemaVersion: CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_PLAN_VERSION,
    createdAt,
    approvedBy: params.approvedBy,
    authorizationStatement: CONTEXTUAL_CALIBRATION_SOURCE_AUTHORIZATION,
    decisionPacketDigest: packet.packetDigest,
    changes: POLICIES.map((policy) => {
      const entry = findReadyEntry(packet, policy);
      return {
        category: policy.category,
        canonicalSource: policy.canonicalSource,
        providerId: policy.providerId,
        decisionEntryDigest: entry.entryDigest,
        legalStatus: 'approved',
        licenseType: policy.licenseType,
        allowedContentModes: ['derived_only'],
        evidenceUrl: policy.evidenceUrl,
      };
    }),
    constraints: {
      insertOnly: true,
      requireRowsMissing: true,
      requireNoActivePublication: true,
      providerCallsApproved: false,
      archivalWritesApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
    },
  };
  return { ...body, planDigest: relationshipInputSha256(body) };
};

export const verifyContextualCalibrationSourceRegistryPlan = (
  value: unknown,
  decisionPacket: unknown,
): ContextualCalibrationSourceRegistryPlan => {
  const plan = exactObject(value, [
    'recordType', 'schemaVersion', 'createdAt', 'approvedBy',
    'authorizationStatement', 'decisionPacketDigest', 'changes',
    'constraints', 'planDigest',
  ], 'contextual_calibration_source_registry_plan_invalid');
  if (plan.recordType !== 'contextual_calibration_source_registry_plan'
    || plan.schemaVersion !== CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_PLAN_VERSION
    || typeof plan.planDigest !== 'string'
    || !SHA256.test(plan.planDigest)) {
    invalid('contextual_calibration_source_registry_plan_invalid');
  }
  const rebuilt = buildContextualCalibrationSourceRegistryPlan({
    decisionPacket,
    createdAt: plan.createdAt as string,
    approvedBy: plan.approvedBy as string,
    authorizationStatement: plan.authorizationStatement as string,
  });
  if (relationshipInputSha256(plan) !== relationshipInputSha256(rebuilt)) {
    invalid('contextual_calibration_source_registry_plan_drift');
  }
  return rebuilt;
};

const reviewedBy = (plan: ContextualCalibrationSourceRegistryPlan) => (
  `case-vortex:${plan.approvedBy}:${plan.planDigest.slice(0, 16)}`
);

const expectedRows = (plan: ContextualCalibrationSourceRegistryPlan) => (
  plan.changes.map((change) => ({
    canonicalSource: change.canonicalSource,
    legalStatus: change.legalStatus,
    licenseType: change.licenseType,
    allowedContentModes: [...change.allowedContentModes] as ['derived_only'],
    evidenceUrl: change.evidenceUrl,
    reviewedAt: plan.createdAt,
    reviewedBy: reviewedBy(plan),
  })).sort((left, right) => left.canonicalSource.localeCompare(right.canonicalSource))
);

const normalizedDatabaseRows = (rows: Record<string, unknown>[]) => rows.map((row) => ({
  canonicalSource: String(row.canonical_source),
  legalStatus: String(row.legal_status),
  licenseType: String(row.license_type),
  allowedContentModes: row.allowed_content_modes,
  evidenceUrl: String(row.evidence_url),
  reviewedAt: timestamp(
    row.reviewed_at instanceof Date
      ? row.reviewed_at.toISOString()
      : new Date(String(row.reviewed_at)).toISOString(),
    'contextual_calibration_source_registry_postcondition_invalid',
  ),
  reviewedBy: String(row.reviewed_by),
})).sort((left, right) => left.canonicalSource.localeCompare(right.canonicalSource));

const buildReceipt = (params: {
  executedAt: string;
  plan: ContextualCalibrationSourceRegistryPlan;
}): ContextualCalibrationSourceRegistryReceipt => {
  const body: Omit<ContextualCalibrationSourceRegistryReceipt, 'receiptDigest'> = {
    recordType: 'contextual_calibration_source_registry_receipt',
    schemaVersion: CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_RECEIPT_VERSION,
    executedAt: timestamp(
      params.executedAt,
      'contextual_calibration_source_registry_receipt_time_invalid',
    ),
    planDigest: params.plan.planDigest,
    decisionPacketDigest: params.plan.decisionPacketDigest,
    inserted: expectedRows(params.plan),
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
      archivalWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      lunaCalls: 0,
      publicationActivations: 0,
      deployments: 0,
    },
  };
  return { ...body, receiptDigest: relationshipInputSha256(body) };
};

export const verifyContextualCalibrationSourceRegistryReceipt = (
  value: unknown,
  planValue: unknown,
  decisionPacket: unknown,
): ContextualCalibrationSourceRegistryReceipt => {
  const plan = verifyContextualCalibrationSourceRegistryPlan(planValue, decisionPacket);
  const receipt = exactObject(value, [
    'recordType', 'schemaVersion', 'executedAt', 'planDigest',
    'decisionPacketDigest', 'inserted', 'postcondition', 'guarantees',
    'receiptDigest',
  ], 'contextual_calibration_source_registry_receipt_invalid');
  if (receipt.recordType !== 'contextual_calibration_source_registry_receipt'
    || receipt.schemaVersion !== CONTEXTUAL_CALIBRATION_SOURCE_REGISTRY_RECEIPT_VERSION
    || typeof receipt.receiptDigest !== 'string'
    || !SHA256.test(receipt.receiptDigest)) {
    invalid('contextual_calibration_source_registry_receipt_invalid');
  }
  const rebuilt = buildReceipt({ executedAt: receipt.executedAt as string, plan });
  if (relationshipInputSha256(receipt) !== relationshipInputSha256(rebuilt)) {
    invalid('contextual_calibration_source_registry_receipt_drift');
  }
  return rebuilt;
};

export const executeContextualCalibrationSourceRegistryPlan = async (
  params: {
    plan: unknown;
    decisionPacket: unknown;
    timeoutMs?: number;
  },
  dependencies: {
    getClient(): Promise<ContextualCalibrationSourceRegistryClient>;
  },
): Promise<ContextualCalibrationSourceRegistryReceipt> => {
  const plan = verifyContextualCalibrationSourceRegistryPlan(
    params.plan,
    params.decisionPacket,
  );
  const timeoutMs = params.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    invalid('contextual_calibration_source_registry_timeout_invalid');
  }
  const client = await dependencies.getClient();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await client.query("SELECT set_config('statement_timeout', $1::text, true)", [
      `${timeoutMs}ms`,
    ]);
    await client.query(`
      SELECT pg_advisory_xact_lock(
        hashtextextended('case-vortex-contextual-calibration-source-registry-v1', 0)
      )
    `);
    const active = await client.query(`
      SELECT COUNT(*)::integer AS active_count
      FROM public.uap_case_graph_publications
      WHERE active = true
    `);
    if (Number(active.rows[0]?.active_count) !== 0) {
      invalid('contextual_calibration_source_registry_active_publication');
    }
    const sources = plan.changes.map(({ canonicalSource }) => canonicalSource);
    const current = await client.query(`
      SELECT canonical_source
      FROM public.uap_source_legal_registry
      WHERE canonical_source = ANY($1::text[])
      ORDER BY canonical_source
      FOR UPDATE
    `, [sources]);
    if (current.rows.length !== 0) {
      invalid('contextual_calibration_source_registry_rows_not_missing');
    }
    const first = plan.changes[0];
    const second = plan.changes[1];
    const reviewer = reviewedBy(plan);
    const inserted = await client.query(`
      INSERT INTO public.uap_source_legal_registry (
        canonical_source, legal_status, license_type, allowed_content_modes,
        evidence_url, reviewed_at, reviewed_by
      )
      VALUES
        ($1, $2, $3, $4::text[], $5, $6::timestamptz, $7),
        ($8, $9, $10, $11::text[], $12, $13::timestamptz, $14)
      ON CONFLICT (canonical_source) DO NOTHING
      RETURNING canonical_source
    `, [
      first.canonicalSource, first.legalStatus, first.licenseType,
      first.allowedContentModes, first.evidenceUrl, plan.createdAt, reviewer,
      second.canonicalSource, second.legalStatus, second.licenseType,
      second.allowedContentModes, second.evidenceUrl, plan.createdAt, reviewer,
    ]);
    if (inserted.rows.length !== 2) {
      invalid('contextual_calibration_source_registry_insert_failed');
    }
    const postcondition = await client.query(`
      SELECT canonical_source, legal_status, license_type, allowed_content_modes,
             evidence_url, reviewed_at, reviewed_by
      FROM public.uap_source_legal_registry
      WHERE canonical_source = ANY($1::text[])
      ORDER BY canonical_source
    `, [sources]);
    const actual = normalizedDatabaseRows(postcondition.rows);
    const expected = expectedRows(plan);
    if (relationshipInputSha256(actual) !== relationshipInputSha256(expected)) {
      invalid('contextual_calibration_source_registry_postcondition_invalid');
    }
    const executed = await client.query(`
      SELECT to_char(
        clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS executed_at
    `);
    const receipt = buildReceipt({
      executedAt: String(executed.rows[0]?.executed_at),
      plan,
    });
    await client.query('COMMIT');
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
