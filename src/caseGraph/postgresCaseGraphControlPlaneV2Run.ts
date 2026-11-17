import { getCaseGraphCorpusPrefix, getCaseGraphPublicationKeys } from './archiveKeys';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';
import { NODE_KINDS, type CaseGraphV2LineageReceipts, type CaseGraphV2Run, type PostgresCaseGraphV2TransactionClient } from './postgresCaseGraphControlPlaneV2Types';
import { isRecord, parseRelationshipAccounting, relationshipAccountingFor, requiredBoolean, requiredText, requiredUuid, safeCount, sameJson } from './postgresCaseGraphControlPlaneV2Shared';

const MAX_BATCH_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 400;

export const batchSize = (value: number | undefined) => {
  const resolved = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_BATCH_SIZE) {
    throw new Error('case_graph_v2_batch_size_invalid');
  }
  return resolved;
};

export const assertPublicSchema = (value: string | undefined) => {
  const schema = value ?? 'public';
  if (schema !== 'public') throw new Error('case_graph_v2_sql_identifier_invalid');
  return schema;
};

export const queryRows = async (
  client: PostgresCaseGraphV2TransactionClient,
  sql: string,
  params: unknown[] = [],
) => {
  const result = await client.query(sql, params);
  if (!result || !Array.isArray(result.rows)) throw new Error('case_graph_v2_query_result_invalid');
  return result.rows;
};

const AMBIGUOUS_CONNECTION_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08P01',
  '57P01', '57P02', '57P03', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
]);

/** Only an uncertain connection/commit outcome is eligible for post-error reconciliation. */
export const isAmbiguousActivationOutcome = (error: unknown) => {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code.toUpperCase() : '';
  if (AMBIGUOUS_CONNECTION_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return /(?:connection|socket|server).*(?:lost|closed|reset|terminated)/.test(message)
    || /(?:commit|transaction).*(?:unknown|uncertain|indeterminate)/.test(message)
    || message.includes('after_commit');
};

const expectedSnapshotCounts = (receipts: CaseGraphV2LineageReceipts) => receipts.universe.accounting.byKind;

export const assertSealedSnapshot = async (
  client: PostgresCaseGraphV2TransactionClient,
  receipts: CaseGraphV2LineageReceipts,
  schema: string,
) => {
  const { snapshot } = receipts.manifest.lineage;
  const rows = await queryRows(client, `
    SELECT
      snapshot.id::text AS snapshot_id,
      snapshot.snapshot_policy,
      snapshot.source_mvcc_snapshot,
      snapshot.source_snapshot_at = $2::timestamptz AS source_snapshot_matches,
      snapshot.materialized_at = $3::timestamptz AS materialized_at_matches,
      component.entity_kind,
      component.capture_policy,
      component.status AS component_status,
      component.row_count::text AS component_row_count
    FROM public.uap_evidence_universe_snapshots AS snapshot
    JOIN public.uap_evidence_universe_snapshot_components AS component
      ON component.snapshot_id = snapshot.id
    WHERE snapshot.id = $1::uuid
    ORDER BY component.entity_kind COLLATE "C"
    FOR SHARE OF snapshot, component
  `, [snapshot.snapshotId, snapshot.snapshotAt, snapshot.materializedAt]);
  if (rows.length !== NODE_KINDS.length) throw new Error('case_graph_v2_snapshot_components_incomplete');
  const expectedCounts = expectedSnapshotCounts(receipts);
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = requiredText(row.entity_kind, 'case_graph_v2_snapshot_component_invalid') as EvidenceUniverseNodeKind;
    if (!NODE_KINDS.includes(kind) || seen.has(kind)) throw new Error('case_graph_v2_snapshot_component_invalid');
    seen.add(kind);
    const expectedPolicy = kind === 'sighting'
      ? snapshot.capturePolicy
      : 'catalogue-materialized-v1';
    if (requiredUuid(row.snapshot_id, 'case_graph_v2_snapshot_mismatch') !== snapshot.snapshotId
      || row.snapshot_policy !== snapshot.snapshotPolicy
      || row.source_mvcc_snapshot !== snapshot.sourceMvccSnapshot
      || requiredBoolean(row.source_snapshot_matches, 'case_graph_v2_snapshot_mismatch') !== true
      || requiredBoolean(row.materialized_at_matches, 'case_graph_v2_snapshot_mismatch') !== true
      || row.capture_policy !== expectedPolicy
      || row.component_status !== 'complete'
      || safeCount(row.component_row_count, 'case_graph_v2_snapshot_component_count_invalid') !== expectedCounts[kind]) {
      throw new Error('case_graph_v2_snapshot_mismatch');
    }
  }
};

export const runMetadata = (receipts: CaseGraphV2LineageReceipts) => ({
  controlPlaneVersion: 'case-vortex-lineage-v2',
  publicManifestVersion: receipts.manifest.schemaVersion,
  relationshipPolicyVersion: receipts.manifest.lineage.relationship.policyVersion,
  relationshipPolicySha256: receipts.manifest.lineage.relationship.policySha256,
  relationshipModelId: receipts.manifest.lineage.relationship.modelId,
  relationshipModelVersion: receipts.manifest.lineage.relationship.modelVersion,
  relationshipModelSha256: receipts.manifest.lineage.relationship.modelSha256,
  relationshipSchemaVersion: receipts.manifest.models.relationshipSchemaVersion,
  relationshipCompletionDigest: receipts.manifest.lineage.relationshipRun.completionDigest,
  relationshipRunIndexDigest: receipts.manifest.lineage.relationshipRun.indexDigest,
  relationshipRunArtifactSetSha256: receipts.manifest.lineage.relationshipRun.artifactSetSha256,
  calibrationSetSha256: receipts.manifest.lineage.calibration.set.calibrationSetSha256,
  accountingReceiptSha256: receipts.accountingReceiptSha256,
});

export const assertRunRow = (
  row: Record<string, unknown>,
  receipts: CaseGraphV2LineageReceipts,
): CaseGraphV2Run => {
  const manifest = receipts.manifest;
  const lineage = manifest.lineage;
  const relationshipAccounting = relationshipAccountingFor(receipts);
  const publicationKeys = getCaseGraphPublicationKeys(manifest.corpusVersion);
  const expectedShardCount = manifest.topology.nodeShardCount + manifest.topology.edgeShardCount + 1;
  const expected = {
    corpus_version: manifest.corpusVersion,
    publishability_policy: manifest.models.publishabilityPolicy,
    feature_schema_version: manifest.models.auxiliaryFeatureSchemaVersion,
    rarity_version: manifest.models.rarityVersion,
    candidate_version: manifest.models.pipelineVersion,
    relationship_policy_version: lineage.relationship.policyVersion,
    relationship_policy_sha256: lineage.relationship.policySha256,
    relationship_model_id: lineage.relationship.modelId,
    relationship_model_version: lineage.relationship.modelVersion,
    relationship_model_sha256: lineage.relationship.modelSha256,
    relationship_schema_version: manifest.models.relationshipSchemaVersion,
    status: 'completed',
    snapshot_id: lineage.snapshot.snapshotId,
    snapshot_policy: lineage.snapshot.snapshotPolicy,
    source_mvcc_snapshot: lineage.snapshot.sourceMvccSnapshot,
    universe_archive_version: lineage.universe.archiveVersion,
    universe_schema_version: lineage.universe.schemaVersion,
    universe_layout_version: lineage.universe.layoutVersion,
    universe_archive_set_sha256: lineage.universe.archiveSetSha256,
    feature_archive_set_sha256: lineage.features.archiveSetSha256,
    relationship_input_schema_version: lineage.relationshipInput.schemaVersion,
    relationship_input_archive_set_sha256: lineage.relationshipInput.archiveSetSha256,
    relationship_input_manifest_digest: lineage.relationshipInput.manifestDigest,
    relationship_run_index_digest: lineage.relationshipRun.indexDigest,
    relationship_run_artifact_set_sha256: lineage.relationshipRun.artifactSetSha256,
    relationship_completion_digest: lineage.relationshipRun.completionDigest,
    pair_calibration_id: lineage.calibration.pair.receiptId,
    pair_calibration_sha256: lineage.calibration.pair.receiptSha256,
    contextual_calibration_id: lineage.calibration.contextual.receiptId,
    contextual_calibration_sha256: lineage.calibration.contextual.receiptSha256,
    calibration_set_sha256: lineage.calibration.set.calibrationSetSha256,
    graph_artifact_set_sha256: lineage.graph.artifactSetSha256,
    corpus_accounting_digest: receipts.accountingReceiptSha256,
    address_ledger_set_sha256: relationshipAccounting.address_ledger_set_sha256,
  } as const;
  for (const [key, value] of Object.entries(expected)) {
    const matches = value !== null && typeof value === 'object'
      ? sameJson(row[key], value)
      : row[key] === value;
    if (!matches) throw new Error(`case_graph_v2_run_lineage_mismatch:${key}`);
  }
  if (row.lineage_version !== 'case-vortex-lineage-v2'
    || row.r2_prefix !== getCaseGraphCorpusPrefix(manifest.corpusVersion)
    || row.completion_manifest_key !== publicationKeys.completionManifestKey
    || row.completion_manifest_sha256 !== receipts.publicationCompletionSha256
    || !sameJson(row.metadata, runMetadata(receipts))
    || row.source_snapshot_matches !== true
    || row.materialized_at_matches !== true
    || safeCount(row.expected_eligible_count, 'case_graph_v2_run_count_invalid') !== lineage.universe.recordCount
    || safeCount(row.processed_eligible_count, 'case_graph_v2_run_count_invalid') !== lineage.universe.recordCount
    || safeCount(row.universe_record_count, 'case_graph_v2_run_count_invalid') !== lineage.universe.recordCount
    || safeCount(row.relationship_input_record_count, 'case_graph_v2_run_count_invalid') !== lineage.universe.recordCount
    || safeCount(row.excluded_count, 'case_graph_v2_run_count_invalid') !== 0
    || safeCount(row.candidate_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.candidate_pair_count
    || safeCount(row.edge_count, 'case_graph_v2_run_count_invalid') !== relationshipAccounting.typed_edge_count
    || safeCount(row.isolated_case_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.relationship_status_counts.isolated
    || safeCount(row.candidate_pair_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.candidate_pair_count
    || safeCount(row.typed_edge_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.typed_edge_count
    || safeCount(row.skipped_group_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.skipped_group_count
    || safeCount(row.skipped_estimated_pair_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.skipped_estimated_pair_count
    || safeCount(row.linked_address_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.relationship_status_counts.linked
    || safeCount(row.candidate_only_address_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.relationship_status_counts.candidate_only
    || safeCount(row.isolated_address_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.relationship_status_counts.isolated
    || safeCount(row.sighting_record_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.address_kind_counts.sighting
    || safeCount(row.document_record_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.address_kind_counts.document
    || safeCount(row.photo_record_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.address_kind_counts.photo
    || safeCount(row.video_record_count, 'case_graph_v2_run_count_invalid')
      !== relationshipAccounting.address_kind_counts.video
    || !sameJson(row.typed_edge_type_counts, relationshipAccounting.typed_edge_type_counts)
    || !sameJson(parseRelationshipAccounting(row.relationship_accounting), relationshipAccounting)
    || safeCount(row.shard_count, 'case_graph_v2_run_count_invalid') !== expectedShardCount) {
    throw new Error('case_graph_v2_run_lineage_mismatch');
  }
  return {
    runId: requiredUuid(row.run_id, 'case_graph_v2_run_id_invalid'),
    corpusVersion: manifest.corpusVersion,
    snapshotId: lineage.snapshot.snapshotId,
    universeRecordCount: lineage.universe.recordCount,
    completionManifestKey: publicationKeys.completionManifestKey,
    completionManifestSha256: receipts.publicationCompletionSha256,
    status: 'completed',
  };
};

export const selectRun = async (
  client: PostgresCaseGraphV2TransactionClient,
  receipts: CaseGraphV2LineageReceipts,
  schema: string,
) => {
  const snapshot = receipts.manifest.lineage.snapshot;
  const rows = await queryRows(client, `
    SELECT
      run.id::text AS run_id,
      run.*,
      run.source_snapshot_at = $2::timestamptz AS source_snapshot_matches,
      run.snapshot_materialized_at = $3::timestamptz AS materialized_at_matches
    FROM public.uap_case_graph_runs AS run
    WHERE run.corpus_version = $1
  `, [receipts.manifest.corpusVersion, snapshot.snapshotAt, snapshot.materializedAt]);
  if (rows.length !== 1) throw new Error('case_graph_v2_run_missing_or_ambiguous');
  return assertRunRow(rows[0], receipts);
};

export const assertRunReference = (run: CaseGraphV2Run, receipts: CaseGraphV2LineageReceipts) => {
  if (requiredUuid(run?.runId, 'case_graph_v2_run_reference_invalid') !== run.runId
    || run.corpusVersion !== receipts.manifest.corpusVersion
    || run.snapshotId !== receipts.manifest.lineage.snapshot.snapshotId
    || run.universeRecordCount !== receipts.manifest.lineage.universe.recordCount
    || run.completionManifestKey !== getCaseGraphPublicationKeys(run.corpusVersion).completionManifestKey
    || run.completionManifestSha256 !== receipts.publicationCompletionSha256
    || run.status !== 'completed') throw new Error('case_graph_v2_run_reference_mismatch');
};
