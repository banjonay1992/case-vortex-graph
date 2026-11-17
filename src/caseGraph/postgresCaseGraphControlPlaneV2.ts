import { createHash } from 'node:crypto';

import { getCaseGraphCorpusPrefix, getCaseGraphPublicationKeys } from './archiveKeys';
import type { CaseVortexRepresentedRecord } from './corpusAccounting';
import { evidenceUniverseAddress, type EvidenceUniverseNodeKind } from './evidenceUniverse';
import { TYPED_RELATIONSHIP_SCHEMA_VERSION } from './typedRelationshipEngine';
import { decodeIncrementalGraphPlan, incrementalGraphSha256, type IncrementalGraphPlan, type IncrementalGraphUniverseBinding } from './incrementalGraphPlan';
import {
  CaseGraphV2LineageReceipts,
  CaseGraphV2Run,
  CaseGraphV2RecordLedgerInsertResult,
  CaseGraphV2IncrementalJob,
  CaseGraphV2PublicationCandidate,
  CaseGraphV2PublicationCandidateRegistration,
  CaseGraphV2ActivePublication,
  KindCounts,
  PostgresCaseGraphV2QueryClient,
  PostgresCaseGraphV2QueryResult,
  PostgresCaseGraphV2TransactionClient,
} from './postgresCaseGraphControlPlaneV2Types';
import { NODE_KINDS } from './postgresCaseGraphControlPlaneV2Types';
import {
  assertPublicSchema,
  batchSize,
  isAmbiguousActivationOutcome,
  queryRows,
  assertRunReference,
  assertRunRow,
  assertSealedSnapshot,
  runMetadata,
  selectRun,
} from './postgresCaseGraphControlPlaneV2Run';
import {
  emptyKindCounts,
  isRecord,
  nullableText,
  nullableTimestamp,
  nullableUuid,
  parseRelationshipAccounting,
  requiredBoolean,
  requiredSha,
  requiredText,
  requiredUuid,
  safeCount,
  sameJson,
  sameKindCounts,
  timestamp,
  relationshipAccountingFor,
} from './postgresCaseGraphControlPlaneV2Shared';
import {
  assertLedgerAudit,
  inspectLedger,
  insertLedgerBatch,
  validateRepresentedRecord,
  type LedgerAudit,
  type LedgerRow,
  asyncValues,
} from './postgresCaseGraphControlPlaneV2Ledger';
import {
  assertIncrementalPlanRow,
  assertIncrementalSnapshots,
  incrementalPlanArtifactKey,
  incrementalPlanReceiptValues,
  insertIncrementalPlan,
  insertQueueBatch,
  parseQueueJob,
  type EnqueueRow,
} from './postgresCaseGraphControlPlaneV2Incremental';
import {
  validateCaseGraphV2LineageReceipts,
  requireLineage,
} from './postgresCaseGraphControlPlaneV2Lineage';
import {
  assertCaseVortexActivePublicationReconciliationReadiness,
  assertCaseVortexCandidateActivationReadiness,
} from './publicationActivationReadiness';

export type {
  CaseGraphV2ActivePublication,
  CaseGraphV2IncrementalJob,
  CaseGraphV2LineageReceipts,
  CaseGraphV2PublicationCandidate,
  CaseGraphV2PublicationCandidateRegistration,
  CaseGraphV2RecordLedgerInsertResult,
  CaseGraphV2Run,
  PostgresCaseGraphV2QueryClient,
  PostgresCaseGraphV2QueryResult,
  PostgresCaseGraphV2TransactionClient,
} from './postgresCaseGraphControlPlaneV2Types';
export { validateCaseGraphV2LineageReceipts } from './postgresCaseGraphControlPlaneV2Lineage';

const ERROR_CODE = /^[a-z0-9][a-z0-9._:-]{0,239}$/;

/** Shared with the activation, rollback, and first-publication recovery SQL. */
const acquirePublicationControlPlaneLock = async (
  client: PostgresCaseGraphV2TransactionClient,
) => {
  await queryRows(client, `
    SELECT pg_advisory_xact_lock(
      hashtextextended('uap-case-graph-publication-v2', 0)
    ) AS locked
  `);
};

const publicationReceiptValues = (receipts: CaseGraphV2LineageReceipts) => {
  const manifest = receipts.manifest;
  const accounting = receipts.accounting;
  const relationshipAccounting = relationshipAccountingFor(receipts);
  return {
    receipt_version: 'case-vortex-publication-receipt-v2',
    snapshot_id: manifest.lineage.snapshot.snapshotId,
    universe_archive_set_sha256: manifest.lineage.universe.archiveSetSha256,
    feature_archive_set_sha256: manifest.lineage.features.archiveSetSha256,
    relationship_input_archive_set_sha256: manifest.lineage.relationshipInput.archiveSetSha256,
    relationship_input_manifest_digest: manifest.lineage.relationshipInput.manifestDigest,
    relationship_policy_version: manifest.lineage.relationship.policyVersion,
    relationship_policy_sha256: manifest.lineage.relationship.policySha256,
    relationship_model_id: manifest.lineage.relationship.modelId,
    relationship_model_version: manifest.lineage.relationship.modelVersion,
    relationship_model_sha256: manifest.lineage.relationship.modelSha256,
    relationship_schema_version: manifest.models.relationshipSchemaVersion,
    relationship_completion_digest: manifest.lineage.relationshipRun.completionDigest,
    relationship_run_index_digest: manifest.lineage.relationshipRun.indexDigest,
    relationship_run_artifact_set_sha256: manifest.lineage.relationshipRun.artifactSetSha256,
    pair_calibration_id: manifest.lineage.calibration.pair.receiptId,
    pair_calibration_sha256: manifest.lineage.calibration.pair.receiptSha256,
    contextual_calibration_id: manifest.lineage.calibration.contextual.receiptId,
    contextual_calibration_sha256: manifest.lineage.calibration.contextual.receiptSha256,
    calibration_set_sha256: manifest.lineage.calibration.set.calibrationSetSha256,
    graph_artifact_set_sha256: manifest.lineage.graph.artifactSetSha256,
    corpus_accounting_digest: receipts.accountingReceiptSha256,
    public_manifest_sha256: receipts.publicManifestSha256,
    completion_manifest_key: getCaseGraphPublicationKeys(manifest.corpusVersion).completionManifestKey,
    completion_manifest_sha256: receipts.publicationCompletionSha256,
    universe_record_count: relationshipAccounting.universe_record_count,
    sighting_record_count: relationshipAccounting.address_kind_counts.sighting,
    document_record_count: relationshipAccounting.address_kind_counts.document,
    photo_record_count: relationshipAccounting.address_kind_counts.photo,
    video_record_count: relationshipAccounting.address_kind_counts.video,
    relationship_input_record_count: manifest.lineage.relationshipInput.recordCount,
    graph_record_count: manifest.lineage.universe.recordCount,
    user_interface_record_count: manifest.lineage.universe.recordCount,
    represented_record_count: accounting.representedTotal,
    excluded_record_count: accounting.excludedTotal,
    observed_record_count: accounting.observedTotal,
    candidate_pair_count: relationshipAccounting.candidate_pair_count,
    typed_edge_count: relationshipAccounting.typed_edge_count,
    skipped_group_count: relationshipAccounting.skipped_group_count,
    skipped_estimated_pair_count: relationshipAccounting.skipped_estimated_pair_count,
    linked_address_count: relationshipAccounting.relationship_status_counts.linked,
    candidate_only_address_count: relationshipAccounting.relationship_status_counts.candidate_only,
    isolated_address_count: relationshipAccounting.relationship_status_counts.isolated,
    typed_edge_type_counts: relationshipAccounting.typed_edge_type_counts,
    address_ledger_set_sha256: relationshipAccounting.address_ledger_set_sha256,
    relationship_accounting: relationshipAccounting,
  } as const;
};

const assertReceiptRow = (
  row: Record<string, unknown>,
  publicationId: string,
  receipts: CaseGraphV2LineageReceipts,
) => {
  if (requiredUuid(row.publication_id, 'case_graph_v2_publication_receipt_invalid') !== publicationId) {
    throw new Error('case_graph_v2_publication_receipt_invalid');
  }
  const expected = publicationReceiptValues(receipts);
  for (const [key, value] of Object.entries(expected)) {
    const actual = key.endsWith('_count') ? safeCount(row[key], 'case_graph_v2_publication_receipt_invalid') : row[key];
    const matches = value !== null && typeof value === 'object'
      ? sameJson(actual, value)
      : actual === value;
    if (!matches) throw new Error(`case_graph_v2_publication_receipt_immutable_conflict:${key}`);
  }
};

const assertRunReadyForPublication = async (
  client: PostgresCaseGraphV2TransactionClient,
  run: CaseGraphV2Run,
  receipts: CaseGraphV2LineageReceipts,
  schema: string,
) => {
  const snapshot = receipts.manifest.lineage.snapshot;
  const rows = await queryRows(client, `
    SELECT
      run.id::text AS run_id,
      run.*,
      run.source_snapshot_at = $2::timestamptz AS source_snapshot_matches,
      run.snapshot_materialized_at = $3::timestamptz AS materialized_at_matches,
      ledger.total::text AS ledger_total,
      ledger.sighting::text AS ledger_sighting,
      ledger.document::text AS ledger_document,
      ledger.photo::text AS ledger_photo,
      ledger.video::text AS ledger_video,
      ledger.processed::text AS ledger_processed,
      ledger.not_applicable::text AS ledger_not_applicable
    FROM public.uap_case_graph_runs AS run
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE record_state.entity_kind = 'sighting')::bigint AS sighting,
        COUNT(*) FILTER (WHERE record_state.entity_kind = 'document')::bigint AS document,
        COUNT(*) FILTER (WHERE record_state.entity_kind = 'photo')::bigint AS photo,
        COUNT(*) FILTER (WHERE record_state.entity_kind = 'video')::bigint AS video,
        COUNT(*) FILTER (
          WHERE record_state.relationship_disposition = 'processed'
        )::bigint AS processed,
        COUNT(*) FILTER (
          WHERE record_state.relationship_disposition = 'not_applicable'
        )::bigint AS not_applicable
      FROM public.uap_case_graph_record_state AS record_state
      WHERE record_state.last_run_id = run.id
        AND record_state.corpus_version = run.corpus_version
    ) AS ledger
    WHERE run.id = $1::uuid
    FOR SHARE OF run
  `, [run.runId, snapshot.snapshotAt, snapshot.materializedAt]);
  if (rows.length !== 1) throw new Error('case_graph_v2_publication_run_missing');
  const row = rows[0];
  const exactRun = assertRunRow(row, receipts);
  const counts = relationshipAccountingFor(receipts).address_kind_counts;
  if (exactRun.runId !== run.runId
    || safeCount(row.ledger_total, 'case_graph_v2_publication_ledger_invalid') !== run.universeRecordCount
    || safeCount(row.ledger_sighting, 'case_graph_v2_publication_ledger_invalid') !== counts.sighting
    || safeCount(row.ledger_document, 'case_graph_v2_publication_ledger_invalid') !== counts.document
    || safeCount(row.ledger_photo, 'case_graph_v2_publication_ledger_invalid') !== counts.photo
    || safeCount(row.ledger_video, 'case_graph_v2_publication_ledger_invalid') !== counts.video
    || safeCount(row.ledger_processed, 'case_graph_v2_publication_ledger_invalid')
      !== receipts.accounting.relationshipProcessedTotal
    || safeCount(row.ledger_not_applicable, 'case_graph_v2_publication_ledger_invalid')
      !== receipts.accounting.relationshipNotApplicableTotal) {
    throw new Error('case_graph_v2_publication_run_or_ledger_mismatch');
  }
};

const selectPublicationCandidate = async (
  client: PostgresCaseGraphV2TransactionClient,
  run: CaseGraphV2Run,
  receipts: CaseGraphV2LineageReceipts,
  schema: string,
) => {
  const rows = await queryRows(client, `
    SELECT
      id::text AS publication_id,
      run_id::text AS run_id,
      corpus_version,
      public_manifest_key,
      public_manifest_sha256,
      active
    FROM public.uap_case_graph_publications
    WHERE run_id = $1::uuid OR corpus_version = $2
    ORDER BY id
  `, [run.runId, run.corpusVersion]);
  if (rows.length !== 1) throw new Error('case_graph_v2_publication_candidate_missing_or_ambiguous');
  const row = rows[0];
  const keys = getCaseGraphPublicationKeys(run.corpusVersion);
  if (row.run_id !== run.runId
    || row.corpus_version !== run.corpusVersion
    || row.public_manifest_key !== keys.manifestKey
    || row.public_manifest_sha256 !== receipts.publicManifestSha256
    || row.active !== false) {
    throw new Error('case_graph_v2_publication_candidate_immutable_conflict');
  }
  return {
    publicationId: requiredUuid(row.publication_id, 'case_graph_v2_publication_id_invalid'),
    runId: run.runId,
    corpusVersion: run.corpusVersion,
    publicManifestKey: keys.manifestKey,
    publicManifestSha256: receipts.publicManifestSha256,
  } satisfies CaseGraphV2PublicationCandidate;
};

const activePublicationSql = (schema: string) => `
  SELECT
    publication.id::text AS publication_id,
    publication.run_id::text AS run_id,
    publication.corpus_version,
    publication.public_manifest_key,
    publication.public_manifest_sha256 AS publication_manifest_sha256,
    publication.active,
    publication.activated_at,
    publication.deactivated_at,
    publication.rollback_of_publication_id::text,
    run.id IS NOT NULL AS run_present,
    snapshot.id IS NOT NULL AS snapshot_present,
    receipt.publication_id IS NOT NULL AS receipt_present,
    run.corpus_version AS run_corpus_version,
    run.status AS run_status,
    run.lineage_version,
    run.snapshot_id::text AS run_snapshot_id,
    run.snapshot_policy = snapshot.snapshot_policy AS snapshot_policy_matches,
    run.source_snapshot_at = snapshot.source_snapshot_at AS snapshot_at_matches,
    run.snapshot_materialized_at = snapshot.materialized_at AS materialized_at_matches,
    run.source_mvcc_snapshot = snapshot.source_mvcc_snapshot AS mvcc_matches,
    run.universe_archive_set_sha256 AS run_universe_sha256,
    run.feature_archive_set_sha256 AS run_feature_sha256,
    run.relationship_input_archive_set_sha256 AS run_relationship_input_sha256,
    run.relationship_input_manifest_digest AS run_relationship_manifest_digest,
    run.relationship_policy_version AS run_relationship_policy_version,
    run.relationship_policy_sha256 AS run_relationship_policy_sha256,
    run.relationship_model_id AS run_relationship_model_id,
    run.relationship_model_version AS run_relationship_model_version,
    run.relationship_model_sha256 AS run_relationship_model_sha256,
    run.relationship_schema_version AS run_relationship_schema_version,
    run.relationship_run_index_digest AS run_relationship_run_index_digest,
    run.relationship_run_artifact_set_sha256 AS run_relationship_run_artifact_set_sha256,
    run.relationship_completion_digest AS run_relationship_completion_digest,
    run.pair_calibration_id AS run_pair_calibration_id,
    run.pair_calibration_sha256 AS run_pair_calibration_sha256,
    run.contextual_calibration_id AS run_contextual_calibration_id,
    run.contextual_calibration_sha256 AS run_contextual_calibration_sha256,
    run.calibration_set_sha256 AS run_calibration_set_sha256,
    run.graph_artifact_set_sha256 AS run_graph_sha256,
    run.corpus_accounting_digest AS run_accounting_sha256,
    run.completion_manifest_key AS run_completion_manifest_key,
    run.completion_manifest_sha256 AS run_completion_manifest_sha256,
    run.universe_record_count::text AS run_universe_count,
    run.relationship_input_record_count::text AS run_relationship_input_count,
    run.expected_eligible_count::text AS run_expected_eligible_count,
    run.processed_eligible_count::text AS run_processed_eligible_count,
    run.excluded_count::text AS run_excluded_count,
    run.candidate_count::text AS run_legacy_candidate_count,
    run.edge_count::text AS run_legacy_edge_count,
    run.isolated_case_count::text AS run_legacy_isolated_count,
    run.candidate_pair_count::text AS run_candidate_pair_count,
    run.typed_edge_count::text AS run_typed_edge_count,
    run.skipped_group_count::text AS run_skipped_group_count,
    run.skipped_estimated_pair_count::text AS run_skipped_estimated_pair_count,
    run.linked_address_count::text AS run_linked_address_count,
    run.candidate_only_address_count::text AS run_candidate_only_address_count,
    run.isolated_address_count::text AS run_isolated_address_count,
    run.sighting_record_count::text AS run_sighting_record_count,
    run.document_record_count::text AS run_document_record_count,
    run.photo_record_count::text AS run_photo_record_count,
    run.video_record_count::text AS run_video_record_count,
    run.typed_edge_type_counts AS run_typed_edge_type_counts,
    run.address_ledger_set_sha256 AS run_address_ledger_set_sha256,
    run.relationship_accounting AS run_relationship_accounting,
    receipt.receipt_version,
    receipt.snapshot_id::text AS snapshot_id,
    receipt.universe_archive_set_sha256,
    receipt.feature_archive_set_sha256,
    receipt.relationship_input_archive_set_sha256,
    receipt.relationship_input_manifest_digest,
    receipt.relationship_policy_version,
    receipt.relationship_policy_sha256,
    receipt.relationship_model_id,
    receipt.relationship_model_version,
    receipt.relationship_model_sha256,
    receipt.relationship_schema_version,
    receipt.relationship_run_index_digest,
    receipt.relationship_run_artifact_set_sha256,
    receipt.relationship_completion_digest,
    receipt.pair_calibration_id,
    receipt.pair_calibration_sha256,
    receipt.contextual_calibration_id,
    receipt.contextual_calibration_sha256,
    receipt.calibration_set_sha256,
    receipt.graph_artifact_set_sha256,
    receipt.corpus_accounting_digest,
    receipt.public_manifest_sha256,
    receipt.completion_manifest_key,
    receipt.completion_manifest_sha256,
    receipt.universe_record_count::text AS universe_record_count,
    receipt.sighting_record_count::text AS sighting_record_count,
    receipt.document_record_count::text AS document_record_count,
    receipt.photo_record_count::text AS photo_record_count,
    receipt.video_record_count::text AS video_record_count,
    receipt.relationship_input_record_count::text AS relationship_input_record_count,
    receipt.graph_record_count::text AS graph_record_count,
    receipt.user_interface_record_count::text AS user_interface_record_count,
    receipt.represented_record_count::text AS represented_record_count,
    receipt.excluded_record_count::text AS excluded_record_count,
    receipt.observed_record_count::text AS observed_record_count,
    receipt.candidate_pair_count::text AS candidate_pair_count,
    receipt.typed_edge_count::text AS typed_edge_count,
    receipt.skipped_group_count::text AS skipped_group_count,
    receipt.skipped_estimated_pair_count::text AS skipped_estimated_pair_count,
    receipt.linked_address_count::text AS linked_address_count,
    receipt.candidate_only_address_count::text AS candidate_only_address_count,
    receipt.isolated_address_count::text AS isolated_address_count,
    receipt.typed_edge_type_counts,
    receipt.address_ledger_set_sha256,
    receipt.relationship_accounting,
    ledger.total::text AS ledger_total,
    ledger.sighting::text AS ledger_sighting,
    ledger.document::text AS ledger_document,
    ledger.photo::text AS ledger_photo,
    ledger.video::text AS ledger_video,
    ledger.processed::text AS ledger_processed,
    ledger.not_applicable::text AS ledger_not_applicable
  FROM public.uap_case_graph_publications AS publication
  LEFT JOIN public.uap_case_graph_runs AS run ON run.id = publication.run_id
  LEFT JOIN public.uap_evidence_universe_snapshots AS snapshot ON snapshot.id = run.snapshot_id
  LEFT JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  CROSS JOIN LATERAL (
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE entity_kind = 'sighting')::bigint AS sighting,
      COUNT(*) FILTER (WHERE entity_kind = 'document')::bigint AS document,
      COUNT(*) FILTER (WHERE entity_kind = 'photo')::bigint AS photo,
      COUNT(*) FILTER (WHERE entity_kind = 'video')::bigint AS video,
      COUNT(*) FILTER (
        WHERE relationship_disposition = 'processed'
      )::bigint AS processed,
      COUNT(*) FILTER (
        WHERE relationship_disposition = 'not_applicable'
      )::bigint AS not_applicable
    FROM public.uap_case_graph_record_state AS record_state
    WHERE record_state.corpus_version = publication.corpus_version
      AND record_state.last_run_id = run.id
  ) AS ledger
  WHERE publication.active = true
  ORDER BY publication.id
`;

const parseActivePublication = (
  row: Record<string, unknown>,
  expected?: CaseGraphV2LineageReceipts,
): CaseGraphV2ActivePublication => {
  const invalidCode = 'case_graph_v2_active_publication_invalid';
  const publicationId = requiredUuid(row.publication_id, 'case_graph_v2_active_publication_invalid');
  const runId = requiredUuid(row.run_id, 'case_graph_v2_active_publication_invalid');
  const corpusVersion = requiredText(row.corpus_version, 'case_graph_v2_active_publication_invalid');
  const snapshotId = requiredUuid(row.run_snapshot_id, 'case_graph_v2_active_publication_invalid');
  const rollbackOfPublicationId = nullableUuid(
    row.rollback_of_publication_id,
    'case_graph_v2_active_publication_invalid',
  );
  const universeCount = safeCount(row.run_universe_count, invalidCode);
  const receiptUniverseCount = safeCount(row.universe_record_count, invalidCode);
  const receiptCounts: KindCounts = {
    sighting: safeCount(row.sighting_record_count, invalidCode),
    document: safeCount(row.document_record_count, invalidCode),
    photo: safeCount(row.photo_record_count, invalidCode),
    video: safeCount(row.video_record_count, invalidCode),
  };
  const receiptAccounting = parseRelationshipAccounting(row.relationship_accounting);
  const runAccounting = parseRelationshipAccounting(row.run_relationship_accounting);
  const receiptCandidatePairCount = safeCount(row.candidate_pair_count, invalidCode);
  const receiptTypedEdgeCount = safeCount(row.typed_edge_count, invalidCode);
  const receiptSkippedGroupCount = safeCount(row.skipped_group_count, invalidCode);
  const receiptSkippedEstimatedPairCount = safeCount(row.skipped_estimated_pair_count, invalidCode);
  const receiptLinkedCount = safeCount(row.linked_address_count, invalidCode);
  const receiptCandidateOnlyCount = safeCount(row.candidate_only_address_count, invalidCode);
  const receiptIsolatedCount = safeCount(row.isolated_address_count, invalidCode);
  const keys = getCaseGraphPublicationKeys(corpusVersion);
  if (row.active !== true
    || row.deactivated_at !== null
    || row.run_present !== true
    || row.snapshot_present !== true
    || row.receipt_present !== true
    || row.run_status !== 'completed'
    || row.lineage_version !== 'case-vortex-lineage-v2'
    || row.run_corpus_version !== corpusVersion
    || row.receipt_version !== 'case-vortex-publication-receipt-v2'
    || row.snapshot_id !== snapshotId
    || row.snapshot_policy_matches !== true
    || row.snapshot_at_matches !== true
    || row.materialized_at_matches !== true
    || row.mvcc_matches !== true
    || row.publication_manifest_sha256 !== row.public_manifest_sha256
    || row.run_universe_sha256 !== row.universe_archive_set_sha256
    || row.run_feature_sha256 !== row.feature_archive_set_sha256
    || row.run_relationship_input_sha256 !== row.relationship_input_archive_set_sha256
    || row.run_relationship_manifest_digest !== row.relationship_input_manifest_digest
    || row.run_relationship_policy_version !== row.relationship_policy_version
    || row.run_relationship_policy_sha256 !== row.relationship_policy_sha256
    || row.run_relationship_model_id !== row.relationship_model_id
    || row.run_relationship_model_version !== row.relationship_model_version
    || row.run_relationship_model_sha256 !== row.relationship_model_sha256
    || row.run_relationship_schema_version !== row.relationship_schema_version
    || row.relationship_schema_version !== TYPED_RELATIONSHIP_SCHEMA_VERSION
    || row.run_relationship_run_index_digest !== row.relationship_run_index_digest
    || row.run_relationship_run_artifact_set_sha256 !== row.relationship_run_artifact_set_sha256
    || row.run_relationship_completion_digest !== row.relationship_completion_digest
    || row.run_pair_calibration_id !== row.pair_calibration_id
    || row.run_pair_calibration_sha256 !== row.pair_calibration_sha256
    || row.run_contextual_calibration_id !== row.contextual_calibration_id
    || row.run_contextual_calibration_sha256 !== row.contextual_calibration_sha256
    || row.run_calibration_set_sha256 !== row.calibration_set_sha256
    || row.run_graph_sha256 !== row.graph_artifact_set_sha256
    || row.run_accounting_sha256 !== row.corpus_accounting_digest
    || row.run_completion_manifest_key !== row.completion_manifest_key
    || row.run_completion_manifest_sha256 !== row.completion_manifest_sha256
    || row.completion_manifest_key !== keys.completionManifestKey
    || receiptUniverseCount !== universeCount
    || safeCount(row.run_relationship_input_count, invalidCode) !== universeCount
    || safeCount(row.run_expected_eligible_count, invalidCode) !== universeCount
    || safeCount(row.run_processed_eligible_count, invalidCode) !== universeCount
    || safeCount(row.run_excluded_count, invalidCode) !== 0
    || safeCount(row.relationship_input_record_count, invalidCode) !== universeCount
    || safeCount(row.graph_record_count, invalidCode) !== universeCount
    || safeCount(row.user_interface_record_count, invalidCode) !== universeCount
    || safeCount(row.represented_record_count, invalidCode) !== universeCount
    || safeCount(row.excluded_record_count, invalidCode) !== 0
    || safeCount(row.observed_record_count, invalidCode) !== universeCount
    || NODE_KINDS.reduce((sum, kind) => sum + receiptCounts[kind], 0) !== universeCount
    || safeCount(row.ledger_total, invalidCode) !== universeCount
    || safeCount(row.ledger_sighting, invalidCode) !== receiptCounts.sighting
    || safeCount(row.ledger_document, invalidCode) !== receiptCounts.document
    || safeCount(row.ledger_photo, invalidCode) !== receiptCounts.photo
    || safeCount(row.ledger_video, invalidCode) !== receiptCounts.video
    || safeCount(row.ledger_processed, invalidCode) !== universeCount
    || safeCount(row.ledger_not_applicable, invalidCode) !== 0
    || receiptAccounting.universe_record_count !== universeCount
    || !sameKindCounts(receiptAccounting.address_kind_counts, receiptCounts)
    || receiptAccounting.candidate_pair_count !== receiptCandidatePairCount
    || receiptAccounting.typed_edge_count !== receiptTypedEdgeCount
    || receiptAccounting.skipped_group_count !== receiptSkippedGroupCount
    || receiptAccounting.skipped_estimated_pair_count !== receiptSkippedEstimatedPairCount
    || receiptAccounting.relationship_status_counts.linked !== receiptLinkedCount
    || receiptAccounting.relationship_status_counts.candidate_only !== receiptCandidateOnlyCount
    || receiptAccounting.relationship_status_counts.isolated !== receiptIsolatedCount
    || !sameJson(receiptAccounting.typed_edge_type_counts, row.typed_edge_type_counts)
    || receiptAccounting.address_ledger_set_sha256 !== row.address_ledger_set_sha256
    || !sameJson(runAccounting, receiptAccounting)
    || safeCount(row.run_legacy_candidate_count, invalidCode) !== receiptCandidatePairCount
    || safeCount(row.run_legacy_edge_count, invalidCode) !== receiptTypedEdgeCount
    || safeCount(row.run_legacy_isolated_count, invalidCode) !== receiptIsolatedCount
    || safeCount(row.run_candidate_pair_count, invalidCode) !== receiptCandidatePairCount
    || safeCount(row.run_typed_edge_count, invalidCode) !== receiptTypedEdgeCount
    || safeCount(row.run_skipped_group_count, invalidCode) !== receiptSkippedGroupCount
    || safeCount(row.run_skipped_estimated_pair_count, invalidCode) !== receiptSkippedEstimatedPairCount
    || safeCount(row.run_linked_address_count, invalidCode) !== receiptLinkedCount
    || safeCount(row.run_candidate_only_address_count, invalidCode) !== receiptCandidateOnlyCount
    || safeCount(row.run_isolated_address_count, invalidCode) !== receiptIsolatedCount
    || safeCount(row.run_sighting_record_count, invalidCode) !== receiptCounts.sighting
    || safeCount(row.run_document_record_count, invalidCode) !== receiptCounts.document
    || safeCount(row.run_photo_record_count, invalidCode) !== receiptCounts.photo
    || safeCount(row.run_video_record_count, invalidCode) !== receiptCounts.video
    || !sameJson(row.run_typed_edge_type_counts, receiptAccounting.typed_edge_type_counts)
    || row.run_address_ledger_set_sha256 !== receiptAccounting.address_ledger_set_sha256) {
    throw new Error('case_graph_v2_active_publication_inconsistent');
  }
  const active: CaseGraphV2ActivePublication = {
    publicationId,
    runId,
    corpusVersion,
    publicManifestKey: requiredText(row.public_manifest_key, 'case_graph_v2_active_publication_invalid'),
    publicManifestSha256: requiredSha(row.publication_manifest_sha256, 'case_graph_v2_active_publication_invalid'),
    activatedAt: timestamp(row.activated_at, 'case_graph_v2_active_publication_invalid'),
    rollbackOfPublicationId,
    accountingReceiptSha256: requiredSha(row.corpus_accounting_digest, 'case_graph_v2_active_publication_invalid'),
    snapshotId,
    universeRecordCount: universeCount,
    completionManifestKey: requiredText(row.completion_manifest_key, invalidCode),
    completionManifestSha256: requiredSha(row.completion_manifest_sha256, invalidCode),
  };
  if (active.publicManifestKey !== keys.manifestKey
    || active.completionManifestKey !== keys.completionManifestKey) {
    throw new Error('case_graph_v2_active_publication_inconsistent');
  }
  if (expected) {
    requireLineage(expected);
    const keys = getCaseGraphPublicationKeys(expected.manifest.corpusVersion);
    const values = publicationReceiptValues(expected);
    if (active.corpusVersion !== expected.manifest.corpusVersion
      || active.snapshotId !== expected.manifest.lineage.snapshot.snapshotId
      || active.publicManifestKey !== keys.manifestKey
      || active.publicManifestSha256 !== expected.publicManifestSha256
      || active.accountingReceiptSha256 !== expected.accountingReceiptSha256
      || active.universeRecordCount !== expected.manifest.lineage.universe.recordCount
      || active.completionManifestKey !== keys.completionManifestKey
      || active.completionManifestSha256 !== expected.publicationCompletionSha256) {
      throw new Error('case_graph_v2_active_publication_receipt_mismatch');
    }
    if (row.run_relationship_policy_version !== expected.manifest.lineage.relationship.policyVersion
      || row.run_relationship_policy_sha256 !== expected.manifest.lineage.relationship.policySha256
      || row.run_relationship_model_id !== expected.manifest.lineage.relationship.modelId
      || row.run_relationship_model_version !== expected.manifest.lineage.relationship.modelVersion
      || row.run_relationship_model_sha256 !== expected.manifest.lineage.relationship.modelSha256
      || row.run_relationship_schema_version !== expected.manifest.models.relationshipSchemaVersion
      || !sameJson(runAccounting, relationshipAccountingFor(expected))) {
      throw new Error('case_graph_v2_active_publication_receipt_mismatch');
    }
    assertReceiptRow(row, publicationId, expected);
    if (!sameKindCounts(receiptCounts, {
      sighting: values.sighting_record_count,
      document: values.document_record_count,
      photo: values.photo_record_count,
      video: values.video_record_count,
    })) throw new Error('case_graph_v2_active_publication_receipt_mismatch');
  }
  return active;
};

export const createPostgresCaseGraphControlPlaneV2 = (
  client: PostgresCaseGraphV2QueryClient,
  options: { schema?: string } = {},
) => {
  if (!client || typeof client.query !== 'function' || typeof client.transaction !== 'function') {
    throw new Error('case_graph_v2_query_client_invalid');
  }
  const schema = assertPublicSchema(options.schema);

  const readActivePublicationFrom = async (
    queryClient: PostgresCaseGraphV2TransactionClient,
    receipts?: CaseGraphV2LineageReceipts,
  ) => {
    if (receipts) requireLineage(receipts);
    const rows = await queryRows(queryClient, activePublicationSql(schema));
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new Error('case_graph_v2_multiple_active_publications');
    return parseActivePublication(rows[0], receipts);
  };

  const readActivePublication = async (receipts?: CaseGraphV2LineageReceipts) => (
    readActivePublicationFrom(client, receipts)
  );

  const readPublicationCandidate = async (params: {
    publicationId: string;
    receipts: CaseGraphV2LineageReceipts;
  }): Promise<CaseGraphV2PublicationCandidate> => {
    const receipts = requireLineage(params.receipts);
    const publicationId = requiredUuid(
      params.publicationId,
      'case_graph_v2_publication_candidate_id_invalid',
    );
    const rows = await queryRows(client, `
      SELECT
        publication.id::text AS publication_id,
        publication.run_id::text AS run_id,
        publication.corpus_version,
        publication.public_manifest_key,
        publication.public_manifest_sha256
      FROM public.uap_case_graph_publications AS publication
      JOIN public.uap_case_graph_runs AS run ON run.id = publication.run_id
      JOIN public.uap_case_graph_publication_receipts AS receipt
        ON receipt.publication_id = publication.id
      WHERE publication.id = $1::uuid
        AND run.lineage_version = 'case-vortex-lineage-v2'
        AND run.status = 'completed'
        AND receipt.receipt_version = 'case-vortex-publication-receipt-v2'
    `, [publicationId]);
    if (rows.length !== 1) throw new Error('case_graph_v2_publication_candidate_missing');
    const row = rows[0];
    const keys = getCaseGraphPublicationKeys(receipts.manifest.corpusVersion);
    if (row.corpus_version !== receipts.manifest.corpusVersion
      || row.public_manifest_key !== keys.manifestKey
      || row.public_manifest_sha256 !== receipts.publicManifestSha256) {
      throw new Error('case_graph_v2_publication_candidate_immutable_conflict');
    }
    return {
      publicationId,
      runId: requiredUuid(row.run_id, 'case_graph_v2_publication_candidate_run_invalid'),
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: keys.manifestKey,
      publicManifestSha256: receipts.publicManifestSha256,
    };
  };

  return {
    async createOrValidateRun(receiptsInput: CaseGraphV2LineageReceipts): Promise<CaseGraphV2Run> {
      const receipts = requireLineage(receiptsInput);
      return client.transaction(async (transaction) => {
        await assertSealedSnapshot(transaction, receipts, schema);
        const manifest = receipts.manifest;
        const lineage = manifest.lineage;
        const keys = getCaseGraphPublicationKeys(manifest.corpusVersion);
        const shardCount = manifest.topology.nodeShardCount + manifest.topology.edgeShardCount + 1;
        const relationshipAccounting = relationshipAccountingFor(receipts);
        await queryRows(transaction, `
          INSERT INTO public.uap_case_graph_runs (
            corpus_version, publishability_policy, feature_schema_version, rarity_version,
            candidate_version, relationship_policy_version, relationship_model_id, status, source_snapshot_at,
            expected_eligible_count, processed_eligible_count, excluded_count, candidate_count,
            edge_count, isolated_case_count, shard_count, r2_prefix, completion_manifest_key,
            completion_manifest_sha256, metadata, completed_at, lineage_version, snapshot_id,
            snapshot_policy, snapshot_materialized_at, source_mvcc_snapshot,
            universe_archive_version, universe_schema_version, universe_layout_version,
            universe_archive_set_sha256, universe_record_count, feature_archive_set_sha256,
            relationship_input_schema_version, relationship_input_archive_set_sha256,
            relationship_input_manifest_digest, relationship_input_record_count,
            relationship_model_sha256, pair_calibration_id, pair_calibration_sha256,
            contextual_calibration_id, contextual_calibration_sha256, graph_artifact_set_sha256,
            corpus_accounting_digest, relationship_policy_sha256, relationship_model_version,
            relationship_run_index_digest, relationship_run_artifact_set_sha256,
            relationship_completion_digest, candidate_pair_count, typed_edge_count,
            skipped_group_count, skipped_estimated_pair_count, linked_address_count,
            candidate_only_address_count, isolated_address_count, sighting_record_count,
            document_record_count, photo_record_count, video_record_count,
            typed_edge_type_counts, address_ledger_set_sha256, calibration_set_sha256,
            relationship_accounting, relationship_schema_version
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, 'completed', $8::timestamptz,
            $9, $9, 0, $10, $11, $12, $13, $14, $15, $16, $17::jsonb,
            $18::timestamptz, 'case-vortex-lineage-v2', $19::uuid, $20, $21::timestamptz,
            $22, $23, $24, $25, $26, $9, $27, $28, $29, $30, $9,
            $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42,
            $10, $11, $43, $44, $45, $46, $12, $47, $48, $49, $50,
            $51::jsonb, $52, $53, $54::jsonb, $55
          )
          ON CONFLICT (corpus_version) DO NOTHING
        `, [
          manifest.corpusVersion,
          manifest.models.publishabilityPolicy,
          manifest.models.auxiliaryFeatureSchemaVersion,
          manifest.models.rarityVersion,
          manifest.models.pipelineVersion,
          lineage.relationship.policyVersion,
          lineage.relationship.modelId,
          lineage.snapshot.snapshotAt,
          lineage.universe.recordCount,
          relationshipAccounting.candidate_pair_count,
          relationshipAccounting.typed_edge_count,
          relationshipAccounting.relationship_status_counts.isolated,
          shardCount,
          getCaseGraphCorpusPrefix(manifest.corpusVersion),
          keys.completionManifestKey,
          receipts.publicationCompletionSha256,
          JSON.stringify(runMetadata(receipts)),
          receipts.completion.generated_at,
          lineage.snapshot.snapshotId,
          lineage.snapshot.snapshotPolicy,
          lineage.snapshot.materializedAt,
          lineage.snapshot.sourceMvccSnapshot,
          lineage.universe.archiveVersion,
          lineage.universe.schemaVersion,
          lineage.universe.layoutVersion,
          lineage.universe.archiveSetSha256,
          lineage.features.archiveSetSha256,
          lineage.relationshipInput.schemaVersion,
          lineage.relationshipInput.archiveSetSha256,
          lineage.relationshipInput.manifestDigest,
          lineage.relationship.modelSha256,
          lineage.calibration.pair.receiptId,
          lineage.calibration.pair.receiptSha256,
          lineage.calibration.contextual.receiptId,
          lineage.calibration.contextual.receiptSha256,
          lineage.graph.artifactSetSha256,
          receipts.accountingReceiptSha256,
          lineage.relationship.policySha256,
          lineage.relationship.modelVersion,
          lineage.relationshipRun.indexDigest,
          lineage.relationshipRun.artifactSetSha256,
          lineage.relationshipRun.completionDigest,
          relationshipAccounting.skipped_group_count,
          relationshipAccounting.skipped_estimated_pair_count,
          relationshipAccounting.relationship_status_counts.linked,
          relationshipAccounting.relationship_status_counts.candidate_only,
          relationshipAccounting.address_kind_counts.sighting,
          relationshipAccounting.address_kind_counts.document,
          relationshipAccounting.address_kind_counts.photo,
          relationshipAccounting.address_kind_counts.video,
          JSON.stringify(relationshipAccounting.typed_edge_type_counts),
          relationshipAccounting.address_ledger_set_sha256,
          lineage.calibration.set.calibrationSetSha256,
          JSON.stringify(relationshipAccounting),
          manifest.models.relationshipSchemaVersion,
        ]);
        return selectRun(transaction, receipts, schema);
      });
    },

    async insertAllRecordLedger(params: {
      run: CaseGraphV2Run;
      receipts: CaseGraphV2LineageReceipts;
      /** Called twice so the complete receipt can be validated before writes. */
      records: () => Iterable<CaseVortexRepresentedRecord> | AsyncIterable<CaseVortexRepresentedRecord>;
      batchSize?: number;
    }): Promise<CaseGraphV2RecordLedgerInsertResult> {
      const receipts = requireLineage(params.receipts);
      assertRunReference(params.run, receipts);
      if (typeof params.records !== 'function') throw new Error('case_graph_v2_record_ledger_factory_required');
      const size = batchSize(params.batchSize);
      const audit = await inspectLedger(params.records(), params.run);
      assertLedgerAudit(audit, receipts);
      return client.transaction(async (transaction) => {
        let pending: LedgerRow[] = [];
        let batchCount = 0;
        let previousAddress: string | null = null;
        const secondPassCounts = emptyKindCounts();
        let secondPassCount = 0;
        let secondPassProcessedCount = 0;
        let secondPassNotApplicableCount = 0;
        const addressHash = createHash('sha256');
        const universeHash = createHash('sha256');
        const relationshipHash = createHash('sha256');
        const graphHash = createHash('sha256');
        const userInterfaceHash = createHash('sha256');
        const flush = async () => {
          if (!pending.length) return;
          const exact = pending;
          pending = [];
          await insertLedgerBatch(transaction, exact, schema);
          batchCount += 1;
        };
        for await (const record of asyncValues(params.records())) {
          const row = validateRepresentedRecord(record, params.run);
          if (previousAddress !== null && previousAddress >= row.address) {
            throw new Error('case_graph_v2_record_ledger_order_or_duplicate_invalid');
          }
          previousAddress = row.address;
          secondPassCount += 1;
          secondPassCounts[row.entityKind] += 1;
          if (row.relationshipDisposition === 'processed') secondPassProcessedCount += 1;
          else secondPassNotApplicableCount += 1;
          addressHash.update(`${row.address}\n`);
          universeHash.update(`${row.address}:${row.universeRecordSha256}\n`);
          relationshipHash.update(`${row.address}:${row.relationshipInputSha256}\n`);
          graphHash.update(`${row.address}:${row.graphRecordSha256}\n`);
          userInterfaceHash.update(`${row.address}:${row.userInterfaceRecordSha256}\n`);
          pending.push(row);
          if (pending.length >= size) await flush();
        }
        await flush();
        const secondAudit: LedgerAudit = {
          count: secondPassCount,
          byKind: secondPassCounts,
          relationshipProcessedCount: secondPassProcessedCount,
          relationshipNotApplicableCount: secondPassNotApplicableCount,
          representedAddressSetSha256: addressHash.digest('hex'),
          universePointerSetSha256: universeHash.digest('hex'),
          relationshipInputPointerSetSha256: relationshipHash.digest('hex'),
          graphPointerSetSha256: graphHash.digest('hex'),
          userInterfacePointerSetSha256: userInterfaceHash.digest('hex'),
        };
        assertLedgerAudit(secondAudit, receipts);
        const finalRows = await queryRows(transaction, `
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE entity_kind = 'sighting')::text AS sighting,
            COUNT(*) FILTER (WHERE entity_kind = 'document')::text AS document,
            COUNT(*) FILTER (WHERE entity_kind = 'photo')::text AS photo,
            COUNT(*) FILTER (WHERE entity_kind = 'video')::text AS video,
            COUNT(*) FILTER (WHERE relationship_disposition = 'processed')::text AS processed,
            COUNT(*) FILTER (
              WHERE relationship_disposition = 'not_applicable'
            )::text AS not_applicable,
            COUNT(*) FILTER (WHERE last_run_id = $2::uuid)::text AS matching_run
          FROM public.uap_case_graph_record_state
          WHERE corpus_version = $1
        `, [params.run.corpusVersion, params.run.runId]);
        if (finalRows.length !== 1) throw new Error('case_graph_v2_record_ledger_final_count_invalid');
        const final = finalRows[0];
        if (safeCount(final.total, 'case_graph_v2_record_ledger_final_count_invalid') !== audit.count
          || safeCount(final.matching_run, 'case_graph_v2_record_ledger_final_count_invalid') !== audit.count
          || safeCount(final.sighting, 'case_graph_v2_record_ledger_final_count_invalid') !== audit.byKind.sighting
          || safeCount(final.document, 'case_graph_v2_record_ledger_final_count_invalid') !== audit.byKind.document
          || safeCount(final.photo, 'case_graph_v2_record_ledger_final_count_invalid') !== audit.byKind.photo
          || safeCount(final.video, 'case_graph_v2_record_ledger_final_count_invalid') !== audit.byKind.video
          || safeCount(final.processed, 'case_graph_v2_record_ledger_final_count_invalid')
            !== audit.relationshipProcessedCount
          || safeCount(final.not_applicable, 'case_graph_v2_record_ledger_final_count_invalid')
            !== audit.relationshipNotApplicableCount) {
          throw new Error('case_graph_v2_record_ledger_final_count_mismatch');
        }
        return {
          runId: params.run.runId,
          corpusVersion: params.run.corpusVersion,
          recordCount: audit.count,
          byKind: audit.byKind,
          batchCount,
        };
      });
    },

    async enqueueSnapshotDiff(
      planInput: IncrementalGraphPlan,
      enqueueOptions: { batchSize?: number } = {},
    ) {
      const plan = decodeIncrementalGraphPlan(planInput);
      if (plan.mode !== 'incremental') throw new Error('case_graph_v2_incremental_plan_requires_full_rebuild');
      const size = batchSize(enqueueOptions.batchSize);
      const fromSnapshotId = plan.baseGeneration.universe.snapshotId;
      const toSnapshotId = plan.watermark.target.snapshotId;
      const batchByChangeId = new Map<string, { batchId: string; batchOrdinal: number }>();
      for (const batch of plan.batches) {
        for (const changeId of batch.changeIds) {
          if (batchByChangeId.has(changeId)) {
            throw new Error('case_graph_v2_incremental_batch_membership_invalid');
          }
          batchByChangeId.set(changeId, { batchId: batch.batchId, batchOrdinal: batch.ordinal });
        }
      }
      const rows: EnqueueRow[] = plan.changes.map((change, changeOrdinal) => {
        const separator = change.address.indexOf(':');
        const entityKind = change.address.slice(0, separator) as EvidenceUniverseNodeKind;
        const entityId = change.address.slice(separator + 1);
        const batch = batchByChangeId.get(change.changeId);
        if (separator < 1 || !NODE_KINDS.includes(entityKind)
          || evidenceUniverseAddress(entityKind, entityId) !== change.address
          || !batch) {
          throw new Error('case_graph_v2_incremental_change_address_invalid');
        }
        return {
          planId: plan.planId,
          fromSnapshotId,
          toSnapshotId,
          batchId: batch.batchId,
          batchOrdinal: batch.batchOrdinal,
          changeId: change.changeId,
          changeOrdinal,
          address: change.address,
          entityKind,
          entityId,
          action: change.action,
          inputSha256: incrementalGraphSha256(change),
        };
      });
      if (batchByChangeId.size !== rows.length) {
        throw new Error('case_graph_v2_incremental_batch_membership_invalid');
      }
      return client.transaction(async (transaction) => {
        await assertIncrementalSnapshots(transaction, plan, schema);
        const planReceipt = await insertIncrementalPlan(transaction, plan, schema);
        for (let offset = 0; offset < rows.length; offset += size) {
          await insertQueueBatch(transaction, rows.slice(offset, offset + size), schema);
        }
        const countRows = await queryRows(transaction, `
          SELECT COUNT(*)::text AS total
          FROM public.uap_case_graph_incremental_queue
          WHERE plan_id = $1
        `, [plan.planId]);
        if (countRows.length !== 1
          || safeCount(countRows[0].total, 'case_graph_v2_incremental_queue_count_invalid') !== rows.length) {
          throw new Error('case_graph_v2_incremental_queue_count_mismatch');
        }
        return {
          planId: plan.planId,
          planSha256: planReceipt.plan_sha256,
          planArtifactKey: planReceipt.plan_artifact_key,
          fromSnapshotId,
          toSnapshotId,
          jobCount: rows.length,
        };
      });
    },

    async claimIncrementalJobs(claimOptions: { limit?: number; leaseSeconds?: number } = {}) {
      const limit = claimOptions.limit ?? 100;
      const leaseSeconds = claimOptions.leaseSeconds ?? 300;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('case_graph_v2_incremental_claim_limit_invalid');
      }
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
        throw new Error('case_graph_v2_incremental_lease_seconds_invalid');
      }
      const rows = await queryRows(client, `
        SELECT *
        FROM public.claim_uap_case_graph_incremental_jobs($1::integer, $2::integer)
        ORDER BY batch_ordinal, change_ordinal, address COLLATE "C"
      `, [limit, leaseSeconds]);
      if (rows.length > limit) throw new Error('case_graph_v2_incremental_claim_overflow');
      if (new Set(rows.map((row) => row.id)).size !== rows.length) {
        throw new Error('case_graph_v2_incremental_claim_duplicate');
      }
      return rows.map(parseQueueJob);
    },

    async finishIncrementalJob(params: {
      job: CaseGraphV2IncrementalJob;
      outcome:
        | { status: 'completed' }
        | { status: 'failed'; errorCode: string }
        | { status: 'retry'; errorCode: string; retryAfterMs: number };
    }) {
      const job = params.job;
      if (job.status !== 'leased' || !job.leaseToken || !job.leasedUntil) {
        throw new Error('case_graph_v2_incremental_active_lease_required');
      }
      const exactJobId = requiredUuid(job.id, 'case_graph_v2_incremental_job_invalid');
      const exactLeaseToken = requiredUuid(job.leaseToken, 'case_graph_v2_incremental_lease_invalid');
      timestamp(job.leasedUntil, 'case_graph_v2_incremental_lease_invalid');
      const status = params.outcome.status === 'retry' ? 'queued' : params.outcome.status;
      const errorCode = params.outcome.status === 'completed' ? null : params.outcome.errorCode;
      if (errorCode !== null && !/^[a-z0-9][a-z0-9._:-]{0,239}$/.test(errorCode)) {
        throw new Error('case_graph_v2_incremental_error_code_invalid');
      }
      const retryAfterMs = params.outcome.status === 'retry' ? params.outcome.retryAfterMs : 0;
      if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 86_400_000
        || (params.outcome.status === 'retry' && retryAfterMs < 1_000)) {
        throw new Error('case_graph_v2_incremental_retry_delay_invalid');
      }
      const rows = await queryRows(client, `
        WITH finished AS (
          UPDATE public.uap_case_graph_incremental_queue
          SET
            status = $3,
            lease_token = NULL,
            leased_until = NULL,
            error_code = $4,
            next_attempt_at = CASE
              WHEN $3 = 'queued' THEN clock_timestamp() + ($5::integer * interval '1 millisecond')
              ELSE next_attempt_at
            END,
            updated_at = clock_timestamp()
          WHERE id = $1::uuid
            AND lease_token = $2::uuid
            AND status = 'leased'
            AND leased_until > clock_timestamp()
          RETURNING *
        )
        SELECT
          finished.*,
          plan.plan_sha256,
          plan.plan_artifact_key,
          plan.watermark_id,
          plan.to_corpus_version,
          plan.target_universe_archive_set_sha256,
          plan.target_relationship_input_set_sha256,
          plan.source_diff_receipt_sha256
        FROM finished
        JOIN public.uap_case_graph_incremental_plans AS plan
          ON plan.plan_id = finished.plan_id
      `, [exactJobId, exactLeaseToken, status, errorCode, retryAfterMs]);
      if (rows.length !== 1) throw new Error('case_graph_v2_incremental_lease_fence_lost');
      const finished = parseQueueJob(rows[0]);
      if (finished.id !== exactJobId
        || finished.status !== status
        || finished.leaseToken !== null
        || finished.errorCode !== errorCode) {
        throw new Error('case_graph_v2_incremental_finish_mismatch');
      }
      return finished;
    },

    async insertPublicationCandidate(params: {
      run: CaseGraphV2Run;
      receipts: CaseGraphV2LineageReceipts;
    }): Promise<CaseGraphV2PublicationCandidateRegistration> {
      const receipts = requireLineage(params.receipts);
      assertRunReference(params.run, receipts);
      return client.transaction(async (transaction) => {
        // The 0235 trigger takes this same lock for every direct INSERT.  Take
        // it here as well so the application path serializes before it reads
        // run/ledger state and before a first-publication recovery can count.
        await acquirePublicationControlPlaneLock(transaction);
        await assertRunReadyForPublication(transaction, params.run, receipts, schema);
        const keys = getCaseGraphPublicationKeys(params.run.corpusVersion);
        const inserted = await queryRows(transaction, `
          INSERT INTO public.uap_case_graph_publications (
            run_id, corpus_version, public_manifest_key, public_manifest_sha256, active
          ) VALUES ($1::uuid, $2, $3, $4, false)
          ON CONFLICT DO NOTHING
          RETURNING id::text AS publication_id
        `, [params.run.runId, params.run.corpusVersion, keys.manifestKey, receipts.publicManifestSha256]);
        if (inserted.length > 1) {
          throw new Error('case_graph_v2_publication_candidate_insert_invalid');
        }
        if (inserted.length === 1) {
          requiredUuid(inserted[0].publication_id, 'case_graph_v2_publication_id_invalid');
        }
        const candidate = await selectPublicationCandidate(transaction, params.run, receipts, schema);
        const receipt = publicationReceiptValues(receipts);
        await queryRows(transaction, `
          INSERT INTO public.uap_case_graph_publication_receipts (
            publication_id, receipt_version, snapshot_id, universe_archive_set_sha256,
            feature_archive_set_sha256, relationship_input_archive_set_sha256,
            relationship_input_manifest_digest, relationship_policy_version,
            relationship_policy_sha256, relationship_model_id, relationship_model_version,
            relationship_model_sha256, relationship_run_index_digest,
            relationship_run_artifact_set_sha256, relationship_completion_digest,
            pair_calibration_id, pair_calibration_sha256, contextual_calibration_id,
            contextual_calibration_sha256, calibration_set_sha256, graph_artifact_set_sha256,
            corpus_accounting_digest, public_manifest_sha256, completion_manifest_key,
            completion_manifest_sha256,
            universe_record_count, sighting_record_count, document_record_count,
            photo_record_count, video_record_count, relationship_input_record_count,
            graph_record_count, user_interface_record_count, represented_record_count,
            excluded_record_count, observed_record_count, candidate_pair_count,
            typed_edge_count, skipped_group_count, skipped_estimated_pair_count,
            linked_address_count, candidate_only_address_count, isolated_address_count,
            typed_edge_type_counts, address_ledger_set_sha256, relationship_accounting,
            relationship_schema_version
          ) VALUES (
            $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
            $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36,
            $37, $38, $39, $40, $41, $42, $43, $44::jsonb, $45, $46::jsonb,
            $47
          )
          ON CONFLICT (publication_id) DO NOTHING
        `, [
          candidate.publicationId,
          receipt.receipt_version,
          receipt.snapshot_id,
          receipt.universe_archive_set_sha256,
          receipt.feature_archive_set_sha256,
          receipt.relationship_input_archive_set_sha256,
          receipt.relationship_input_manifest_digest,
          receipt.relationship_policy_version,
          receipt.relationship_policy_sha256,
          receipt.relationship_model_id,
          receipt.relationship_model_version,
          receipt.relationship_model_sha256,
          receipt.relationship_run_index_digest,
          receipt.relationship_run_artifact_set_sha256,
          receipt.relationship_completion_digest,
          receipt.pair_calibration_id,
          receipt.pair_calibration_sha256,
          receipt.contextual_calibration_id,
          receipt.contextual_calibration_sha256,
          receipt.calibration_set_sha256,
          receipt.graph_artifact_set_sha256,
          receipt.corpus_accounting_digest,
          receipt.public_manifest_sha256,
          receipt.completion_manifest_key,
          receipt.completion_manifest_sha256,
          receipt.universe_record_count,
          receipt.sighting_record_count,
          receipt.document_record_count,
          receipt.photo_record_count,
          receipt.video_record_count,
          receipt.relationship_input_record_count,
          receipt.graph_record_count,
          receipt.user_interface_record_count,
          receipt.represented_record_count,
          receipt.excluded_record_count,
          receipt.observed_record_count,
          receipt.candidate_pair_count,
          receipt.typed_edge_count,
          receipt.skipped_group_count,
          receipt.skipped_estimated_pair_count,
          receipt.linked_address_count,
          receipt.candidate_only_address_count,
          receipt.isolated_address_count,
          JSON.stringify(receipt.typed_edge_type_counts),
          receipt.address_ledger_set_sha256,
          JSON.stringify(receipt.relationship_accounting),
          receipt.relationship_schema_version,
        ]);
        const receiptRows = await queryRows(transaction, `
          SELECT *
          FROM public.uap_case_graph_publication_receipts
          WHERE publication_id = $1::uuid
        `, [candidate.publicationId]);
        if (receiptRows.length !== 1) throw new Error('case_graph_v2_publication_receipt_missing');
        assertReceiptRow(receiptRows[0], candidate.publicationId, receipts);
        return {
          ...candidate,
          registrationStatus: inserted.length === 1 ? 'created' : 'already_exists',
        };
      });
    },

    readActivePublication,
    readPublicationCandidate,

    async activatePublication(params: {
      candidate: CaseGraphV2PublicationCandidate;
      receipts: CaseGraphV2LineageReceipts;
    }) {
      const receipts = requireLineage(params.receipts);
      const candidate = params.candidate;
      if (requiredUuid(candidate?.publicationId, 'case_graph_v2_publication_activation_candidate_mismatch')
          !== candidate.publicationId
        || requiredUuid(candidate.runId, 'case_graph_v2_publication_activation_candidate_mismatch')
          !== candidate.runId
        || candidate.corpusVersion !== receipts.manifest.corpusVersion
        || candidate.publicManifestSha256 !== receipts.publicManifestSha256
        || candidate.publicManifestKey !== getCaseGraphPublicationKeys(candidate.corpusVersion).manifestKey) {
        throw new Error('case_graph_v2_publication_activation_candidate_mismatch');
      }
      const existing = await readActivePublication(receipts).catch((error) => {
        if (error instanceof Error && error.message === 'case_graph_v2_active_publication_receipt_mismatch') return null;
        throw error;
      });
      if (existing?.publicationId === candidate.publicationId) {
        return client.transaction(async (transaction) => {
          await acquirePublicationControlPlaneLock(transaction);
          await assertCaseVortexActivePublicationReconciliationReadiness(transaction, candidate);
          const reconciled = await readActivePublicationFrom(transaction, receipts);
          if (!reconciled || reconciled.publicationId !== candidate.publicationId) {
            throw new Error('case_graph_v2_publication_activation_not_observed');
          }
          return { status: 'already_active' as const, publication: reconciled };
        });
      }
      const relationshipAccounting = relationshipAccountingFor(receipts);
      try {
        return await client.transaction(async (transaction) => {
          // There is no caller-provided readiness escape hatch. Every real
          // activation passes the same concrete gate under this lock.
          await acquirePublicationControlPlaneLock(transaction);
          await assertCaseVortexCandidateActivationReadiness(transaction, candidate);
          const activationRows = await queryRows(transaction, `
            SELECT *
            FROM public.activate_uap_case_graph_publication_v2(
              $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16::jsonb
            )
          `, [
            candidate.publicationId,
            receipts.publicManifestSha256,
            receipts.publicationCompletionSha256,
            receipts.accountingReceiptSha256,
            receipts.manifest.lineage.relationshipRun.completionDigest,
            receipts.manifest.lineage.relationshipRun.indexDigest,
            receipts.manifest.lineage.relationshipRun.artifactSetSha256,
            receipts.manifest.lineage.relationship.policySha256,
            receipts.manifest.lineage.relationship.modelVersion,
            receipts.manifest.lineage.calibration.pair.receiptId,
            receipts.manifest.lineage.calibration.pair.receiptSha256,
            receipts.manifest.lineage.calibration.contextual.receiptId,
            receipts.manifest.lineage.calibration.contextual.receiptSha256,
            receipts.manifest.lineage.calibration.set.calibrationSetSha256,
            receipts.manifest.lineage.graph.artifactSetSha256,
            JSON.stringify(relationshipAccounting),
          ]);
          const activation = activationRows[0];
          const completionKeys = getCaseGraphPublicationKeys(candidate.corpusVersion);
          if (activationRows.length !== 1
            || activation?.publication_id !== candidate.publicationId
            || activation.corpus_version !== candidate.corpusVersion
            || activation.completion_manifest_key !== completionKeys.completionManifestKey
            || activation.completion_manifest_sha256 !== receipts.publicationCompletionSha256
            || activation.relationship_completion_digest
              !== receipts.manifest.lineage.relationshipRun.completionDigest
            || activation.relationship_run_index_digest !== receipts.manifest.lineage.relationshipRun.indexDigest
            || activation.relationship_run_artifact_set_sha256
              !== receipts.manifest.lineage.relationshipRun.artifactSetSha256
            || activation.pair_calibration_id !== receipts.manifest.lineage.calibration.pair.receiptId
            || activation.pair_calibration_sha256 !== receipts.manifest.lineage.calibration.pair.receiptSha256
            || activation.contextual_calibration_id !== receipts.manifest.lineage.calibration.contextual.receiptId
            || activation.contextual_calibration_sha256
              !== receipts.manifest.lineage.calibration.contextual.receiptSha256
            || activation.calibration_set_sha256 !== receipts.manifest.lineage.calibration.set.calibrationSetSha256
            || !sameJson(parseRelationshipAccounting(activation.relationship_accounting), relationshipAccounting)) {
            throw new Error('case_graph_v2_publication_activation_result_invalid');
          }
          timestamp(activation.activated_at, 'case_graph_v2_publication_activation_result_invalid');
          const active = await readActivePublicationFrom(transaction, receipts);
          if (!active || active.publicationId !== candidate.publicationId) {
            throw new Error('case_graph_v2_publication_activation_not_observed');
          }
          return { status: 'activated' as const, publication: active };
        });
      } catch (error) {
        if (!isAmbiguousActivationOutcome(error)) throw error;
        const reconciled = await readActivePublication(receipts).catch(() => null);
        if (reconciled?.publicationId === candidate.publicationId) {
          return { status: 'reconciled' as const, publication: reconciled };
        }
        throw error;
      }
    },

    /**
     * Emergency-only first-generation kill switch.  This deliberately cannot
     * select a replacement: the database function accepts only the exact
     * active publication and leaves the public surface fail-closed.
     */
    async deactivateFirstPublication(params: {
      expectedActivePublicationId: string;
      expectedActiveManifestSha256: string;
      reasonSha256: string;
    }) {
      const expectedPublicationId = requiredUuid(
        params.expectedActivePublicationId,
        'case_graph_v2_first_publication_deactivation_expected_id_invalid',
      );
      const expectedManifestSha256 = requiredSha(
        params.expectedActiveManifestSha256,
        'case_graph_v2_first_publication_deactivation_expected_manifest_invalid',
      );
      const reasonSha256 = requiredSha(
        params.reasonSha256,
        'case_graph_v2_first_publication_deactivation_reason_invalid',
      );
      const current = await readActivePublication();
      if (!current
        || current.publicationId !== expectedPublicationId
        || current.publicManifestSha256 !== expectedManifestSha256) {
        throw new Error('case_graph_v2_first_publication_deactivation_compare_and_swap_failed');
      }
      try {
        return await client.transaction(async (transaction) => {
          const rows = await queryRows(transaction, `
            SELECT *
            FROM public.deactivate_first_uap_case_graph_publication_v1(
              $1::uuid, $2, $3
            )
          `, [expectedPublicationId, expectedManifestSha256, reasonSha256]);
          const deactivation = rows[0];
          if (rows.length !== 1
            || deactivation?.publication_id !== expectedPublicationId
            || deactivation.corpus_version !== current.corpusVersion
            || deactivation.public_manifest_sha256 !== expectedManifestSha256
            || deactivation.reason_sha256 !== reasonSha256
            || safeCount(deactivation.active_publication_count,
              'case_graph_v2_first_publication_deactivation_result_invalid') !== 0
            || safeCount(deactivation.total_publication_count,
              'case_graph_v2_first_publication_deactivation_result_invalid') !== 1) {
            throw new Error('case_graph_v2_first_publication_deactivation_result_invalid');
          }
          timestamp(
            deactivation.deactivated_at,
            'case_graph_v2_first_publication_deactivation_result_invalid',
          );
          if (await readActivePublicationFrom(transaction)) {
            throw new Error('case_graph_v2_first_publication_deactivation_still_active');
          }
          return {
            status: 'deactivated' as const,
            publication: current,
            deactivatedAt: String(deactivation.deactivated_at),
            reasonSha256,
          };
        });
      } catch (error) {
        if (!isAmbiguousActivationOutcome(error)) throw error;
        const reconciled = await readActivePublication().catch(() => null);
        if (!reconciled) {
          return {
            status: 'reconciled' as const,
            publication: current,
            deactivatedAt: null,
            reasonSha256,
          };
        }
        throw error;
      }
    },

    async rollbackPublication(params: {
      expectedActivePublicationId: string;
      expectedActiveManifestSha256: string;
      target: CaseGraphV2PublicationCandidate;
      targetReceipts: CaseGraphV2LineageReceipts;
      reasonSha256: string;
    }) {
      const targetReceipts = requireLineage(params.targetReceipts);
      const expectedActivePublicationId = requiredUuid(
        params.expectedActivePublicationId,
        'case_graph_v2_publication_rollback_input_invalid',
      );
      const expectedActiveManifestSha256 = requiredSha(
        params.expectedActiveManifestSha256,
        'case_graph_v2_publication_rollback_input_invalid',
      );
      const reasonSha256 = requiredSha(
        params.reasonSha256,
        'case_graph_v2_publication_rollback_input_invalid',
      );
      const target = params.target;
      if (requiredUuid(target?.publicationId, 'case_graph_v2_publication_rollback_target_mismatch')
          !== target.publicationId
        || requiredUuid(target.runId, 'case_graph_v2_publication_rollback_target_mismatch')
          !== target.runId
        || target.publicationId === expectedActivePublicationId
        || target.corpusVersion !== targetReceipts.manifest.corpusVersion
        || target.publicManifestSha256 !== targetReceipts.publicManifestSha256
        || target.publicManifestKey !== getCaseGraphPublicationKeys(target.corpusVersion).manifestKey) {
        throw new Error('case_graph_v2_publication_rollback_target_mismatch');
      }

      const reconcile = async () => {
        const active = await readActivePublication(targetReceipts).catch(() => null);
        return active?.publicationId === target.publicationId
          && active.rollbackOfPublicationId === expectedActivePublicationId
          ? active
          : null;
      };

      try {
        return await client.transaction(async (transaction) => {
          const rollbackRows = await queryRows(transaction, `
            SELECT *
            FROM public.rollback_uap_case_graph_publication_v1(
              $1::uuid, $2::uuid, $3, $4, $5
            )
          `, [
            expectedActivePublicationId,
            target.publicationId,
            expectedActiveManifestSha256,
            targetReceipts.publicManifestSha256,
            reasonSha256,
          ]);
          const rollback = rollbackRows[0];
          if (rollbackRows.length !== 1
            || rollback?.previous_publication_id !== expectedActivePublicationId
            || rollback.target_publication_id !== target.publicationId
            || rollback.previous_manifest_sha256 !== expectedActiveManifestSha256
            || rollback.target_manifest_sha256 !== targetReceipts.publicManifestSha256
            || rollback.reason_sha256 !== reasonSha256
            || safeCount(
              rollback.active_publication_count,
              'case_graph_v2_publication_rollback_result_invalid',
            ) !== 1
            || rollback.rollback_of_publication_id !== expectedActivePublicationId) {
            throw new Error('case_graph_v2_publication_rollback_result_invalid');
          }
          const rolledBackAt = timestamp(
            rollback.rolled_back_at,
            'case_graph_v2_publication_rollback_result_invalid',
          );
          const active = await readActivePublicationFrom(transaction, targetReceipts);
          if (!active
            || active.publicationId !== target.publicationId
            || active.rollbackOfPublicationId !== expectedActivePublicationId
            || active.activatedAt !== rolledBackAt) {
            throw new Error('case_graph_v2_publication_rollback_not_observed');
          }
          return {
            status: 'rolled_back' as const,
            previousPublicationId: expectedActivePublicationId,
            reasonSha256,
            rolledBackAt,
            publication: active,
          };
        });
      } catch (error) {
        if (!isAmbiguousActivationOutcome(error)) throw error;
        const reconciled = await reconcile();
        if (reconciled) {
          return {
            status: 'reconciled' as const,
            previousPublicationId: expectedActivePublicationId,
            reasonSha256,
            rolledBackAt: reconciled.activatedAt,
            publication: reconciled,
          };
        }
        throw error;
      }
    },
  };
};
