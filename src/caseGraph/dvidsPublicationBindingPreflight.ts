import type { ClaimEvidencePublicationBinding } from './claimEvidenceGraph';
import {
  verifyDvidsFrameOcrReviewAssignment,
} from './dvidsFrameOcrHumanReview';
import {
  verifyDvidsPublisherClaimReviewAssignment,
} from './dvidsPublisherClaimReview';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const DVIDS_PUBLICATION_BINDING_PREFLIGHT_VERSION =
  'case-vortex-dvids-publication-binding-preflight-v1' as const;

export type DvidsPublicationBindingPreflightBlocker =
  | 'database_transaction_not_read_only'
  | 'database_postgres_17_required'
  | 'database_active_publication_present'
  | 'database_candidate_missing'
  | 'database_candidate_ambiguous';

export type DvidsPublicationBindingInventoryRow = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
  active: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
  runStatus: string | null;
  lineageVersion: string | null;
  snapshotId: string | null;
  graphArtifactSetSha256: string | null;
  runCompletionManifestSha256: string | null;
  runCorpusAccountingDigest: string | null;
  receiptVersion: string | null;
  receiptSnapshotId: string | null;
  receiptManifestSha256: string | null;
  receiptCompletionManifestSha256: string | null;
  receiptCorpusAccountingDigest: string | null;
  receiptGraphArtifactSetSha256: string | null;
  verifiedV2: boolean;
};

export type DvidsPublicationBindingObservation = {
  serverVersionNum: number;
  transactionReadOnly: boolean;
  observedAt: string;
  publications: DvidsPublicationBindingInventoryRow[];
};

export type DvidsPublicationBindingPreflight = {
  recordType: 'dvids_publication_binding_preflight';
  schemaVersion: typeof DVIDS_PUBLICATION_BINDING_PREFLIGHT_VERSION;
  observedAt: string;
  reviewBinding: {
    corpusVersion: string;
    snapshotId: string;
    publisherAssignmentDigest: string;
    frameOcrAssignmentDigest: string;
  };
  database: {
    serverVersionNum: number;
    transactionReadOnly: boolean;
    publicationCount: number;
    activePublicationCount: number;
    verifiedV2PublicationCount: number;
    exactEligibleCandidateCount: number;
  };
  inventory: DvidsPublicationBindingInventoryRow[];
  candidate: ClaimEvidencePublicationBinding | null;
  ready: boolean;
  blockers: DvidsPublicationBindingPreflightBlocker[];
  guarantees: {
    completePublicationInventoryObserved: true;
    exactReviewBindingRequired: true;
    candidateMustBeInactiveAndNeverActivated: true;
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  preflightDigest: string;
};

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };

const timestamp = (value: string | null, code: string) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
};

const optional = (
  value: string | null,
  pattern: RegExp,
  code: string,
) => {
  if (value === null) return null;
  if (!pattern.test(value)) fail(code);
  return value;
};

const inventoryRow = (
  value: DvidsPublicationBindingInventoryRow,
): DvidsPublicationBindingInventoryRow => {
  if (!value || !UUID.test(value.publicationId)
    || !VERSION.test(value.corpusVersion)
    || !SHA256.test(value.manifestSha256)
    || typeof value.active !== 'boolean'
    || typeof value.verifiedV2 !== 'boolean') {
    fail('dvids_publication_binding_inventory_row_invalid');
  }
  const row = {
    publicationId: value.publicationId,
    corpusVersion: value.corpusVersion,
    manifestSha256: value.manifestSha256,
    active: value.active,
    activatedAt: timestamp(
      value.activatedAt,
      'dvids_publication_binding_inventory_timestamp_invalid',
    ),
    deactivatedAt: timestamp(
      value.deactivatedAt,
      'dvids_publication_binding_inventory_timestamp_invalid',
    ),
    runStatus: optional(
      value.runStatus,
      VERSION,
      'dvids_publication_binding_inventory_run_status_invalid',
    ),
    lineageVersion: optional(
      value.lineageVersion,
      VERSION,
      'dvids_publication_binding_inventory_lineage_invalid',
    ),
    snapshotId: optional(
      value.snapshotId,
      UUID,
      'dvids_publication_binding_inventory_snapshot_invalid',
    ),
    graphArtifactSetSha256: optional(
      value.graphArtifactSetSha256,
      SHA256,
      'dvids_publication_binding_inventory_graph_digest_invalid',
    ),
    runCompletionManifestSha256: optional(
      value.runCompletionManifestSha256,
      SHA256,
      'dvids_publication_binding_inventory_completion_digest_invalid',
    ),
    runCorpusAccountingDigest: optional(
      value.runCorpusAccountingDigest,
      SHA256,
      'dvids_publication_binding_inventory_accounting_digest_invalid',
    ),
    receiptVersion: optional(
      value.receiptVersion,
      VERSION,
      'dvids_publication_binding_inventory_receipt_invalid',
    ),
    receiptSnapshotId: optional(
      value.receiptSnapshotId,
      UUID,
      'dvids_publication_binding_inventory_receipt_snapshot_invalid',
    ),
    receiptManifestSha256: optional(
      value.receiptManifestSha256,
      SHA256,
      'dvids_publication_binding_inventory_receipt_manifest_invalid',
    ),
    receiptCompletionManifestSha256: optional(
      value.receiptCompletionManifestSha256,
      SHA256,
      'dvids_publication_binding_inventory_receipt_completion_invalid',
    ),
    receiptCorpusAccountingDigest: optional(
      value.receiptCorpusAccountingDigest,
      SHA256,
      'dvids_publication_binding_inventory_receipt_accounting_invalid',
    ),
    receiptGraphArtifactSetSha256: optional(
      value.receiptGraphArtifactSetSha256,
      SHA256,
      'dvids_publication_binding_inventory_receipt_graph_invalid',
    ),
    verifiedV2: value.verifiedV2,
  };
  const verifiedV2 = row.lineageVersion === 'case-vortex-lineage-v2'
    && row.runStatus === 'completed'
    && row.snapshotId !== null
    && row.graphArtifactSetSha256 !== null
    && row.runCompletionManifestSha256 !== null
    && row.runCorpusAccountingDigest !== null
    && row.receiptVersion === 'case-vortex-publication-receipt-v2'
    && row.receiptSnapshotId === row.snapshotId
    && row.receiptManifestSha256 === row.manifestSha256
    && row.receiptCompletionManifestSha256
      === row.runCompletionManifestSha256
    && row.receiptCorpusAccountingDigest === row.runCorpusAccountingDigest
    && row.receiptGraphArtifactSetSha256 === row.graphArtifactSetSha256;
  if (row.verifiedV2 !== verifiedV2) {
    fail('dvids_publication_binding_inventory_verification_mismatch');
  }
  return row;
};

export const buildDvidsPublicationBindingPreflight = (params: {
  publisherAssignment: unknown;
  frameOcrAssignment: unknown;
  observation: DvidsPublicationBindingObservation;
}): DvidsPublicationBindingPreflight => {
  const publisherAssignment = verifyDvidsPublisherClaimReviewAssignment(
    params.publisherAssignment,
  );
  const frameOcrAssignment = verifyDvidsFrameOcrReviewAssignment(
    params.frameOcrAssignment,
  );
  if (publisherAssignment.binding.corpusVersion
      !== frameOcrAssignment.binding.corpusVersion
    || publisherAssignment.binding.snapshotId
      !== frameOcrAssignment.binding.snapshotId) {
    fail('dvids_publication_binding_review_binding_mismatch');
  }
  const observation = params.observation;
  if (!Number.isSafeInteger(observation.serverVersionNum)
    || observation.serverVersionNum < 1
    || typeof observation.transactionReadOnly !== 'boolean'
    || !Array.isArray(observation.publications)) {
    fail('dvids_publication_binding_observation_invalid');
  }
  const observedAt = timestamp(
    observation.observedAt,
    'dvids_publication_binding_observed_at_invalid',
  ) as string;
  const rows = observation.publications.map(inventoryRow);
  if (new Set(rows.map(({ publicationId }) => publicationId)).size
      !== rows.length) {
    fail('dvids_publication_binding_inventory_duplicate');
  }
  const activePublicationCount = rows.filter(({ active }) => active).length;
  const eligible = rows.filter((row) => (
    row.verifiedV2
    && row.active === false
    && row.activatedAt === null
    && row.deactivatedAt === null
    && row.runStatus === 'completed'
    && row.lineageVersion === 'case-vortex-lineage-v2'
    && row.receiptVersion === 'case-vortex-publication-receipt-v2'
    && row.corpusVersion === publisherAssignment.binding.corpusVersion
    && row.snapshotId === publisherAssignment.binding.snapshotId
    && row.graphArtifactSetSha256 !== null
  ));
  const blockers: DvidsPublicationBindingPreflightBlocker[] = [];
  if (!observation.transactionReadOnly) {
    blockers.push('database_transaction_not_read_only');
  }
  if (observation.serverVersionNum < 170_000) {
    blockers.push('database_postgres_17_required');
  }
  if (activePublicationCount !== 0) {
    blockers.push('database_active_publication_present');
  }
  if (eligible.length === 0) {
    blockers.push('database_candidate_missing');
  } else if (eligible.length > 1) {
    blockers.push('database_candidate_ambiguous');
  }
  const candidate = eligible.length === 1
    ? {
        publicationId: eligible[0].publicationId,
        corpusVersion: eligible[0].corpusVersion,
        manifestSha256: eligible[0].manifestSha256,
        snapshotId: eligible[0].snapshotId as string,
        graphArtifactSetSha256:
          eligible[0].graphArtifactSetSha256 as string,
      }
    : null;
  const body: Omit<DvidsPublicationBindingPreflight, 'preflightDigest'> = {
    recordType: 'dvids_publication_binding_preflight',
    schemaVersion: DVIDS_PUBLICATION_BINDING_PREFLIGHT_VERSION,
    observedAt,
    reviewBinding: {
      corpusVersion: publisherAssignment.binding.corpusVersion,
      snapshotId: publisherAssignment.binding.snapshotId,
      publisherAssignmentDigest: publisherAssignment.assignmentDigest,
      frameOcrAssignmentDigest: frameOcrAssignment.assignmentDigest,
    },
    database: {
      serverVersionNum: observation.serverVersionNum,
      transactionReadOnly: observation.transactionReadOnly,
      publicationCount: rows.length,
      activePublicationCount,
      verifiedV2PublicationCount:
        rows.filter(({ verifiedV2 }) => verifiedV2).length,
      exactEligibleCandidateCount: eligible.length,
    },
    inventory: rows,
    candidate,
    ready: blockers.length === 0,
    blockers,
    guarantees: {
      completePublicationInventoryObserved: true,
      exactReviewBindingRequired: true,
      candidateMustBeInactiveAndNeverActivated: true,
      databaseWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, preflightDigest: relationshipInputSha256(body) };
};

export const verifyDvidsPublicationBindingPreflight = (params: {
  value: unknown;
  publisherAssignment: unknown;
  frameOcrAssignment: unknown;
}) => {
  const value = params.value as DvidsPublicationBindingPreflight;
  const publications: DvidsPublicationBindingInventoryRow[] =
    Array.isArray(value?.inventory)
      ? value.inventory
      : fail('dvids_publication_binding_preflight_inventory_missing');
  const rebuilt = buildDvidsPublicationBindingPreflight({
    publisherAssignment: params.publisherAssignment,
    frameOcrAssignment: params.frameOcrAssignment,
    observation: {
      serverVersionNum: value?.database?.serverVersionNum,
      transactionReadOnly: value?.database?.transactionReadOnly,
      observedAt: value?.observedAt,
      publications,
    },
  });
  if (canonicalizeRelationshipInput(value)
      !== canonicalizeRelationshipInput(rebuilt)) {
    fail('dvids_publication_binding_preflight_integrity_failed');
  }
  return rebuilt;
};

export const assertFreshDvidsPublicationBinding = (params: {
  preflight: unknown;
  publisherAssignment: unknown;
  frameOcrAssignment: unknown;
  usedAt: string;
  maximumAgeMs?: number;
}): ClaimEvidencePublicationBinding => {
  const verified = verifyDvidsPublicationBindingPreflight({
    value: params.preflight,
    publisherAssignment: params.publisherAssignment,
    frameOcrAssignment: params.frameOcrAssignment,
  });
  const usedAt = timestamp(
    params.usedAt,
    'dvids_publication_binding_used_at_invalid',
  ) as string;
  const age = Date.parse(usedAt) - Date.parse(verified.observedAt);
  const maximumAgeMs = params.maximumAgeMs ?? 60 * 60 * 1_000;
  if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 1
    || age < -5 * 60 * 1_000 || age > maximumAgeMs) {
    fail('dvids_publication_binding_preflight_stale');
  }
  if (!verified.ready) {
    fail('dvids_publication_binding_candidate_unavailable');
  }
  return verified.candidate
    ?? fail('dvids_publication_binding_candidate_unavailable');
};
