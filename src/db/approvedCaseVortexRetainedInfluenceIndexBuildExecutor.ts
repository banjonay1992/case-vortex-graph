import { createHash } from 'node:crypto';

import {
  buildRetainedInfluencePostgresIndexForBinding,
  type RetainedInfluencePostgresBuildReceipt,
  type RetainedInfluencePostgresQuery,
} from '../caseGraph/postgresRetainedInfluence';
import {
  decodeRetainedInfluenceServingBundle,
} from '../caseGraph/retainedInfluenceServing';
import {
  verifyFreshCaseVortexRetainedInfluenceIndexApproval,
  type CaseVortexRetainedInfluenceIndexApproval,
} from '../caseGraph/retainedInfluenceIndexBuildApproval';
import { relationshipInputSha256 } from '../caseGraph/relationshipInputSnapshot';

export const CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_RECEIPT_VERSION =
  'case-vortex-retained-influence-index-build-receipt-v1' as const;
export const CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_FAILURE_VERSION =
  'case-vortex-retained-influence-index-build-failure-receipt-v1' as const;

export type CaseVortexRetainedInfluenceIndexBuildReceipt = {
  recordType: 'case_vortex_retained_influence_index_build_receipt';
  schemaVersion: typeof CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_RECEIPT_VERSION;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  bundleSha256: string;
  influenceReceiptSha256: string;
  discoverySignalCount: number;
  metadataLeadCount: number;
  entryCount: number;
  entrySetSha256: string;
  projectionSetSha256: string;
  completedAt: string;
  indexBuilds: 1;
  storageWrites: 0;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

export type CaseVortexRetainedInfluenceIndexBuildFailureReceipt = {
  recordType: 'case_vortex_retained_influence_index_build_failure_receipt';
  schemaVersion: typeof CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_FAILURE_VERSION;
  approvalSha256: string;
  rehearsalReceiptSha256: string;
  publicationId: string;
  failedAt: string;
  errorCode: string;
  observedBuildCount: number | null;
  observedEntryCount: number | null;
  rollbackVerified: boolean;
  reconciliationRequired: boolean;
  storageWrites: 0;
  publicationActivations: 0;
  deployments: 0;
  receiptSha256: string;
};

export type CaseVortexRetainedInfluenceIndexBuildExecutionResult =
  | { ok: true; receipt: CaseVortexRetainedInfluenceIndexBuildReceipt }
  | { ok: false; receipt: CaseVortexRetainedInfluenceIndexBuildFailureReceipt };

type RehearsalEvidence = {
  recordType: string;
  schemaVersion: string;
  publicationId: string;
  influenceBinding: {
    bundleSha256: string;
    influenceReceiptSha256: string;
    discoverySignalCount: number;
    metadataLeadCount: number;
  };
  remote: null | {
    corpusVersion: string | null;
    publicManifestSha256: string | null;
    migration0216AppTracked: boolean;
    migration0216SupabaseTracked: boolean;
    migrationSignaturePresent: boolean;
    publicationCandidateVerifiedV2: boolean;
    publicationCandidateInactive: boolean;
    publicationCandidateNeverActivated: boolean;
    activePublicationCount: number;
    retainedBuildCount: number;
    retainedEntryCount: number;
    sourceProjectionReady: boolean;
  };
  readyForSeparateApproval: boolean;
  blockers: string[];
  receiptSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const fail = (code: string): never => { throw new Error(code); };
const bundleSha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const errorCode = (error: unknown) => {
  const source = error instanceof Error ? error.message : String(error);
  const normalized = source.toLowerCase().replace(/[^a-z0-9:_-]+/gu, '_').slice(0, 200);
  return normalized || 'retained_influence_index_build_failed';
};

const verifyRehearsal = (
  value: unknown,
  approval: CaseVortexRetainedInfluenceIndexApproval,
): RehearsalEvidence => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_retained_influence_index_build_rehearsal_invalid');
  }
  const candidate = value as RehearsalEvidence & Record<string, unknown>;
  const { receiptSha256, ...body } = candidate;
  if (candidate.recordType !== 'case_vortex_retained_influence_index_rehearsal'
    || candidate.schemaVersion !== 'case-vortex-retained-influence-index-rehearsal-v1'
    || !SHA256.test(String(receiptSha256))
    || relationshipInputSha256(body) !== receiptSha256
    || candidate.publicationId !== approval.publicationId
    || candidate.readyForSeparateApproval !== true
    || !Array.isArray(candidate.blockers) || candidate.blockers.length !== 0
    || !candidate.remote
    || candidate.remote.corpusVersion !== approval.corpusVersion
    || candidate.remote.publicManifestSha256 !== approval.publicManifestSha256
    || candidate.remote.migration0216AppTracked !== true
    || candidate.remote.migration0216SupabaseTracked !== true
    || candidate.remote.migrationSignaturePresent !== true
    || candidate.remote.publicationCandidateVerifiedV2 !== true
    || candidate.remote.publicationCandidateInactive !== true
    || candidate.remote.publicationCandidateNeverActivated !== true
    || candidate.remote.activePublicationCount !== 0
    || candidate.remote.retainedBuildCount !== 0
    || candidate.remote.retainedEntryCount !== 0
    || candidate.remote.sourceProjectionReady !== true
    || candidate.influenceBinding.bundleSha256 !== approval.bundleSha256
    || candidate.influenceBinding.influenceReceiptSha256
      !== approval.influenceReceiptSha256
    || candidate.influenceBinding.discoverySignalCount
      !== approval.discoverySignalCount
    || candidate.influenceBinding.metadataLeadCount !== approval.metadataLeadCount
    || receiptSha256 !== approval.rehearsalReceiptSha256) {
    return fail('case_vortex_retained_influence_index_build_rehearsal_invalid');
  }
  return candidate;
};

const inspectBuild = async (
  query: RetainedInfluencePostgresQuery,
  publicationId: string,
  signal?: AbortSignal,
) => {
  const result = await query(`
    /* case_vortex_retained_influence_index_build_execution:postcondition */
    SELECT build.corpus_version, build.public_manifest_sha256,
      build.influence_receipt_sha256,
      build.indexed_discovery_signal_count,
      build.indexed_metadata_lead_count,
      build.entry_set_sha256, build.projection_set_sha256,
      count(entry.signal_id)::bigint AS entry_count,
      count(entry.signal_id) FILTER (
        WHERE entry.lane = 'discovery_signal'
      )::bigint AS discovery_count,
      count(entry.signal_id) FILTER (
        WHERE entry.lane = 'metadata_lead'
      )::bigint AS metadata_count
    FROM public.case_vortex_retained_influence_builds AS build
    LEFT JOIN public.case_vortex_retained_influence_entries AS entry
      ON entry.publication_id = build.publication_id
    WHERE build.publication_id = $1::uuid
    GROUP BY build.publication_id, build.corpus_version,
      build.public_manifest_sha256, build.influence_receipt_sha256,
      build.indexed_discovery_signal_count,
      build.indexed_metadata_lead_count, build.entry_set_sha256,
      build.projection_set_sha256
  `, [publicationId], {
    statementTimeoutMs: 30_000,
    queryTimeoutMs: 35_000,
    signal,
  });
  return result.rows;
};

const verifyPostcondition = (
  rows: Record<string, unknown>[],
  approval: CaseVortexRetainedInfluenceIndexApproval,
  build: RetainedInfluencePostgresBuildReceipt,
) => {
  if (rows.length !== 1) {
    return fail('case_vortex_retained_influence_index_build_postcondition_failed');
  }
  const row = rows[0];
  const entryCount = Number(row.entry_count);
  const discoveryCount = Number(row.discovery_count);
  const metadataCount = Number(row.metadata_count);
  if (row.corpus_version !== approval.corpusVersion
    || row.public_manifest_sha256 !== approval.publicManifestSha256
    || row.influence_receipt_sha256 !== approval.influenceReceiptSha256
    || Number(row.indexed_discovery_signal_count) !== approval.discoverySignalCount
    || Number(row.indexed_metadata_lead_count) !== approval.metadataLeadCount
    || discoveryCount !== approval.discoverySignalCount
    || metadataCount !== approval.metadataLeadCount
    || entryCount !== approval.discoverySignalCount + approval.metadataLeadCount
    || row.entry_set_sha256 !== build.entrySetSha256
    || row.projection_set_sha256 !== build.projectionSetSha256) {
    return fail('case_vortex_retained_influence_index_build_postcondition_failed');
  }
  return entryCount;
};

const failureReceipt = (input: {
  approval: CaseVortexRetainedInfluenceIndexApproval;
  failedAt: string;
  error: unknown;
  observedBuildCount: number | null;
  observedEntryCount: number | null;
}) => {
  const rollbackVerified = input.observedBuildCount === 0 && input.observedEntryCount === 0;
  const body: Omit<CaseVortexRetainedInfluenceIndexBuildFailureReceipt, 'receiptSha256'> = {
    recordType: 'case_vortex_retained_influence_index_build_failure_receipt',
    schemaVersion: CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_FAILURE_VERSION,
    approvalSha256: input.approval.approvalSha256,
    rehearsalReceiptSha256: input.approval.rehearsalReceiptSha256,
    publicationId: input.approval.publicationId,
    failedAt: input.failedAt,
    errorCode: errorCode(input.error),
    observedBuildCount: input.observedBuildCount,
    observedEntryCount: input.observedEntryCount,
    rollbackVerified,
    reconciliationRequired: !rollbackVerified,
    storageWrites: 0,
    publicationActivations: 0,
    deployments: 0,
  };
  return { ...body, receiptSha256: relationshipInputSha256(body) };
};

export const executeApprovedCaseVortexRetainedInfluenceIndexBuild = async (input: {
  approval: unknown;
  approvalSha256: string;
  freshRehearsal: unknown;
  bundleBytes: Buffer;
  query: RetainedInfluencePostgresQuery;
  now?: Date;
  signal?: AbortSignal;
}): Promise<CaseVortexRetainedInfluenceIndexBuildExecutionResult> => {
  const now = input.now || new Date();
  const approval = verifyFreshCaseVortexRetainedInfluenceIndexApproval(
    input.approval,
    now,
  );
  if (input.approvalSha256 !== approval.approvalSha256) {
    fail('case_vortex_retained_influence_index_build_approval_sha_mismatch');
  }
  verifyRehearsal(input.freshRehearsal, approval);
  const bundle = decodeRetainedInfluenceServingBundle(input.bundleBytes);
  if (bundleSha(input.bundleBytes) !== approval.bundleSha256
    || bundle.influenceReceipt.receiptSha256 !== approval.influenceReceiptSha256
    || bundle.influenceReceipt.influenceLaneCounts.discovery_signal
      !== approval.discoverySignalCount
    || bundle.influenceReceipt.influenceLaneCounts.metadata_lead
      !== approval.metadataLeadCount) {
    fail('case_vortex_retained_influence_index_build_bundle_mismatch');
  }
  let build: RetainedInfluencePostgresBuildReceipt | null = null;
  try {
    build = await buildRetainedInfluencePostgresIndexForBinding({
      binding: {
        publicationId: approval.publicationId,
        corpusVersion: approval.corpusVersion,
        publicManifestSha256: approval.publicManifestSha256,
      },
      influenceReceipt: bundle.influenceReceipt,
      query: input.query,
      signal: input.signal,
    });
    const rows = await inspectBuild(input.query, approval.publicationId, input.signal);
    const entryCount = verifyPostcondition(rows, approval, build);
    const body: Omit<CaseVortexRetainedInfluenceIndexBuildReceipt, 'receiptSha256'> = {
      recordType: 'case_vortex_retained_influence_index_build_receipt',
      schemaVersion: CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_RECEIPT_VERSION,
      approvalSha256: approval.approvalSha256,
      rehearsalReceiptSha256: approval.rehearsalReceiptSha256,
      publicationId: approval.publicationId,
      corpusVersion: approval.corpusVersion,
      publicManifestSha256: approval.publicManifestSha256,
      bundleSha256: approval.bundleSha256,
      influenceReceiptSha256: approval.influenceReceiptSha256,
      discoverySignalCount: build.discoverySignalCount,
      metadataLeadCount: build.metadataLeadCount,
      entryCount,
      entrySetSha256: build.entrySetSha256,
      projectionSetSha256: build.projectionSetSha256,
      completedAt: now.toISOString(),
      indexBuilds: 1,
      storageWrites: 0,
      publicationActivations: 0,
      deployments: 0,
    };
    return {
      ok: true,
      receipt: { ...body, receiptSha256: relationshipInputSha256(body) },
    };
  } catch (error) {
    let observedBuildCount: number | null = null;
    let observedEntryCount: number | null = null;
    try {
      const result = await input.query(`
        /* case_vortex_retained_influence_index_build_execution:reconcile */
        SELECT
          (SELECT count(*)::integer
            FROM public.case_vortex_retained_influence_builds
            WHERE publication_id = $1::uuid) AS build_count,
          (SELECT count(*)::integer
            FROM public.case_vortex_retained_influence_entries
            WHERE publication_id = $1::uuid) AS entry_count
      `, [approval.publicationId], {
        statementTimeoutMs: 10_000,
        queryTimeoutMs: 12_000,
        signal: input.signal,
      });
      if (result.rows.length === 1) {
        observedBuildCount = Number(result.rows[0].build_count);
        observedEntryCount = Number(result.rows[0].entry_count);
      }
    } catch {
      // Ambiguous outcomes remain explicitly reconciliation-required.
    }
    return {
      ok: false,
      receipt: failureReceipt({
        approval,
        failedAt: now.toISOString(),
        error,
        observedBuildCount,
        observedEntryCount,
      }),
    };
  }
};

export const verifyCaseVortexRetainedInfluenceIndexBuildReceipt = (
  value: unknown,
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_retained_influence_index_build_receipt_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const receiptSha256 = candidate.receiptSha256;
  if (typeof receiptSha256 !== 'string' || !SHA256.test(receiptSha256)) {
    return fail('case_vortex_retained_influence_index_build_receipt_invalid');
  }
  const { receiptSha256: _ignored, ...body } = candidate;
  if (relationshipInputSha256(body) !== receiptSha256) {
    return fail('case_vortex_retained_influence_index_build_receipt_invalid');
  }
  const exactKeys = (keys: string[]) => {
    const actual = Object.keys(candidate).sort();
    const expected = [...keys, 'receiptSha256'].sort();
    return actual.length === expected.length
      && actual.every((key, index) => key === expected[index]);
  };
  const safeCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const validTimestamp = (value: unknown) => {
    if (typeof value !== 'string') return false;
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  };
  if (candidate.recordType === 'case_vortex_retained_influence_index_build_receipt'
    && candidate.schemaVersion === CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_RECEIPT_VERSION
    && exactKeys([
      'recordType', 'schemaVersion', 'approvalSha256', 'rehearsalReceiptSha256',
      'publicationId', 'corpusVersion', 'publicManifestSha256', 'bundleSha256',
      'influenceReceiptSha256', 'discoverySignalCount', 'metadataLeadCount',
      'entryCount', 'entrySetSha256', 'projectionSetSha256', 'completedAt',
      'indexBuilds', 'storageWrites', 'publicationActivations', 'deployments',
    ])
    && UUID.test(String(candidate.publicationId))
    && [
      candidate.approvalSha256, candidate.rehearsalReceiptSha256,
      candidate.publicManifestSha256, candidate.bundleSha256,
      candidate.influenceReceiptSha256, candidate.entrySetSha256,
      candidate.projectionSetSha256,
    ].every((value) => SHA256.test(String(value)))
    && validTimestamp(candidate.completedAt)
    && safeCount(candidate.discoverySignalCount)
    && safeCount(candidate.metadataLeadCount)
    && safeCount(candidate.entryCount)
    && Number(candidate.entryCount) === 490_933
    && candidate.indexBuilds === 1
    && candidate.storageWrites === 0
    && candidate.publicationActivations === 0
    && candidate.deployments === 0
    && Number(candidate.entryCount)
      === Number(candidate.discoverySignalCount) + Number(candidate.metadataLeadCount)) {
    return candidate as unknown as CaseVortexRetainedInfluenceIndexBuildReceipt;
  }
  if (candidate.recordType === 'case_vortex_retained_influence_index_build_failure_receipt'
    && candidate.schemaVersion === CASE_VORTEX_RETAINED_INFLUENCE_INDEX_BUILD_FAILURE_VERSION
    && exactKeys([
      'recordType', 'schemaVersion', 'approvalSha256', 'rehearsalReceiptSha256',
      'publicationId', 'failedAt', 'errorCode', 'observedBuildCount',
      'observedEntryCount', 'rollbackVerified', 'reconciliationRequired',
      'storageWrites', 'publicationActivations', 'deployments',
    ])
    && UUID.test(String(candidate.publicationId))
    && SHA256.test(String(candidate.approvalSha256))
    && SHA256.test(String(candidate.rehearsalReceiptSha256))
    && validTimestamp(candidate.failedAt)
    && typeof candidate.errorCode === 'string'
    && /^[a-z0-9][a-z0-9:_-]{0,199}$/u.test(candidate.errorCode)
    && (candidate.observedBuildCount === null || safeCount(candidate.observedBuildCount))
    && (candidate.observedEntryCount === null || safeCount(candidate.observedEntryCount))
    && candidate.storageWrites === 0
    && candidate.publicationActivations === 0
    && candidate.deployments === 0
    && candidate.rollbackVerified === !candidate.reconciliationRequired) {
    return candidate as unknown as CaseVortexRetainedInfluenceIndexBuildFailureReceipt;
  }
  return fail('case_vortex_retained_influence_index_build_receipt_invalid');
};
