import { getCaseGraphCorpusPrefix } from './archiveKeys';
import {
  decodeIncrementalGraphPlan,
  incrementalGraphSha256,
  type IncrementalGraphPlan,
  type IncrementalGraphUniverseBinding,
} from './incrementalGraphPlan';
import { evidenceUniverseAddress, type EvidenceUniverseNodeKind } from './evidenceUniverse';
import { NODE_KINDS, type CaseGraphV2IncrementalJob, type PostgresCaseGraphV2TransactionClient } from './postgresCaseGraphControlPlaneV2Types';
import { nullableText, nullableTimestamp, requiredSha, requiredText, requiredUuid, safeCount, timestamp } from './postgresCaseGraphControlPlaneV2Shared';
import { queryRows } from './postgresCaseGraphControlPlaneV2Run';

const ERROR_CODE = /^[a-z0-9][a-z0-9._:-]{0,239}$/;
const PLAN_ID = /^plan:[a-f0-9]{64}$/;
const BATCH_ID = /^batch:[a-f0-9]{64}$/;
const CHANGE_ID = /^change:[a-f0-9]{64}$/;
const WATERMARK_ID = /^watermark:[a-f0-9]{64}$/;

export const incrementalPlanArtifactKey = (plan: IncrementalGraphPlan) => (
  `case-vortex/incremental/case-vortex-incremental-archive-v1/`
  + `${plan.watermark.target.corpusVersion}/${plan.watermark.target.snapshotId}/`
  + `${plan.planId.slice('plan:'.length)}/plan.json`
);

export const assertIncrementalSnapshots = async (
  client: PostgresCaseGraphV2TransactionClient,
  plan: IncrementalGraphPlan,
  schema: string,
) => {
  const bindings = new Map<string, IncrementalGraphUniverseBinding>([
    [plan.baseGeneration.universe.snapshotId, plan.baseGeneration.universe],
    [plan.watermark.target.snapshotId, plan.watermark.target],
  ]);
  const rows = await queryRows(client, `
    SELECT
      snapshot.id::text AS snapshot_id,
      snapshot.snapshot_policy,
      snapshot.source_mvcc_snapshot,
      component.entity_kind,
      component.capture_policy,
      component.status AS component_status,
      component.row_count::text AS component_row_count
    FROM public.uap_evidence_universe_snapshots AS snapshot
    JOIN public.uap_evidence_universe_snapshot_components AS component
      ON component.snapshot_id = snapshot.id
    WHERE snapshot.id = ANY($1::uuid[])
    ORDER BY snapshot.id, component.entity_kind COLLATE "C"
    FOR SHARE OF snapshot, component
  `, [[...bindings.keys()]]);
  if (rows.length !== bindings.size * NODE_KINDS.length) {
    throw new Error('case_graph_v2_incremental_snapshot_components_incomplete');
  }
  const seen = new Map<string, Set<EvidenceUniverseNodeKind>>();
  const totals = new Map<string, number>();
  for (const row of rows) {
    const snapshotId = requiredUuid(row.snapshot_id, 'case_graph_v2_incremental_snapshot_invalid');
    const binding = bindings.get(snapshotId);
    const kind = requiredText(row.entity_kind, 'case_graph_v2_incremental_snapshot_invalid') as EvidenceUniverseNodeKind;
    const kinds = seen.get(snapshotId) ?? new Set<EvidenceUniverseNodeKind>();
    if (!binding || !NODE_KINDS.includes(kind) || kinds.has(kind)) {
      throw new Error('case_graph_v2_incremental_snapshot_invalid');
    }
    kinds.add(kind);
    seen.set(snapshotId, kinds);
    const expectedCapturePolicy = kind === 'sighting'
      ? 'publishable-public-v2-materialized-v1'
      : 'catalogue-materialized-v1';
    if (row.snapshot_policy !== 'evidence-universe-materialized-v1'
      || typeof row.source_mvcc_snapshot !== 'string'
      || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(row.source_mvcc_snapshot)
      || row.capture_policy !== expectedCapturePolicy
      || row.component_status !== 'complete') {
      throw new Error('case_graph_v2_incremental_snapshot_invalid');
    }
    totals.set(snapshotId, (totals.get(snapshotId) ?? 0)
      + safeCount(row.component_row_count, 'case_graph_v2_incremental_snapshot_count_invalid'));
  }
  for (const [snapshotId, binding] of bindings) {
    if (seen.get(snapshotId)?.size !== NODE_KINDS.length || totals.get(snapshotId) !== binding.recordCount) {
      throw new Error('case_graph_v2_incremental_snapshot_count_mismatch');
    }
  }
};

export const incrementalPlanReceiptValues = (plan: IncrementalGraphPlan) => ({
  plan_id: plan.planId,
  plan_sha256: incrementalGraphSha256(plan),
  schema_version: plan.schemaVersion,
  canonical_version: plan.canonicalVersion,
  plan_artifact_key: incrementalPlanArtifactKey(plan),
  from_snapshot_id: plan.baseGeneration.universe.snapshotId,
  to_snapshot_id: plan.watermark.target.snapshotId,
  from_corpus_version: plan.baseGeneration.universe.corpusVersion,
  to_corpus_version: plan.watermark.target.corpusVersion,
  base_activation_id: plan.baseGeneration.activationId,
  base_universe_archive_set_sha256: plan.baseGeneration.universe.universeArchiveSetSha256,
  base_address_set_sha256: plan.baseGeneration.universe.addressSetSha256,
  base_relationship_input_set_sha256: plan.baseGeneration.relationshipInputSetSha256,
  base_graph_archive_set_sha256: plan.baseGeneration.graphArchiveSetSha256,
  target_universe_archive_set_sha256: plan.watermark.target.universeArchiveSetSha256,
  target_address_set_sha256: plan.watermark.target.addressSetSha256,
  target_relationship_input_set_sha256: plan.watermark.targetRelationshipInputSetSha256,
  incident_index_root_sha256: plan.watermark.incidentIndexRootSha256,
  source_diff_receipt_sha256: plan.watermark.sourceDiffReceiptSha256,
  watermark_id: plan.watermark.watermarkId,
  watermark_sequence: plan.watermark.sequence,
  previous_watermark_id: plan.watermark.previousWatermarkId,
  source_cursor: plan.watermark.cursor,
  change_set_sha256: plan.watermark.changeSetSha256,
  base_record_count: plan.accounting.baseRecordCount,
  target_record_count: plan.accounting.targetRecordCount,
  change_count: plan.accounting.changeCount,
  insert_count: plan.accounting.insertCount,
  update_count: plan.accounting.updateCount,
  delete_count: plan.accounting.deleteCount,
  batch_count: plan.batches.length,
} as const);

export const assertIncrementalPlanRow = (row: Record<string, unknown>, plan: IncrementalGraphPlan) => {
  const expected = incrementalPlanReceiptValues(plan);
  for (const [key, value] of Object.entries(expected)) {
    const actual = key.endsWith('_count') || key === 'watermark_sequence'
      ? safeCount(row[key], 'case_graph_v2_incremental_plan_receipt_invalid')
      : row[key];
    if (actual !== value) throw new Error(`case_graph_v2_incremental_plan_immutable_conflict:${key}`);
  }
};

export const insertIncrementalPlan = async (
  client: PostgresCaseGraphV2TransactionClient,
  plan: IncrementalGraphPlan,
  schema: string,
) => {
  const value = incrementalPlanReceiptValues(plan);
  const params = [
    value.plan_id,
    value.plan_sha256,
    value.schema_version,
    value.canonical_version,
    value.plan_artifact_key,
    value.from_snapshot_id,
    value.to_snapshot_id,
    value.from_corpus_version,
    value.to_corpus_version,
    value.base_activation_id,
    value.base_universe_archive_set_sha256,
    value.base_address_set_sha256,
    value.base_relationship_input_set_sha256,
    value.base_graph_archive_set_sha256,
    value.target_universe_archive_set_sha256,
    value.target_address_set_sha256,
    value.target_relationship_input_set_sha256,
    value.incident_index_root_sha256,
    value.source_diff_receipt_sha256,
    value.watermark_id,
    value.watermark_sequence,
    value.previous_watermark_id,
    value.source_cursor,
    value.change_set_sha256,
    value.base_record_count,
    value.target_record_count,
    value.change_count,
    value.insert_count,
    value.update_count,
    value.delete_count,
    value.batch_count,
  ];
  await queryRows(client, `
    INSERT INTO public.uap_case_graph_incremental_plans (
      plan_id, plan_sha256, schema_version, canonical_version, plan_artifact_key,
      from_snapshot_id, to_snapshot_id, from_corpus_version, to_corpus_version,
      base_activation_id, base_universe_archive_set_sha256, base_address_set_sha256,
      base_relationship_input_set_sha256, base_graph_archive_set_sha256,
      target_universe_archive_set_sha256, target_address_set_sha256,
      target_relationship_input_set_sha256, incident_index_root_sha256,
      source_diff_receipt_sha256, watermark_id, watermark_sequence,
      previous_watermark_id, source_cursor, change_set_sha256, base_record_count,
      target_record_count, change_count, insert_count, update_count, delete_count,
      batch_count
    ) VALUES (
      $1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
      $25, $26, $27, $28, $29, $30, $31
    )
    ON CONFLICT (plan_id) DO NOTHING
  `, params);
  const rows = await queryRows(client, `
    SELECT *
    FROM public.uap_case_graph_incremental_plans
    WHERE plan_id = $1
  `, [plan.planId]);
  if (rows.length !== 1) throw new Error('case_graph_v2_incremental_plan_receipt_missing');
  assertIncrementalPlanRow(rows[0], plan);
  return value;
};

export const parseQueueJob = (row: Record<string, unknown>): CaseGraphV2IncrementalJob => {
  const entityKind = requiredText(row.entity_kind, 'case_graph_v2_incremental_job_invalid') as EvidenceUniverseNodeKind;
  const action = requiredText(row.action, 'case_graph_v2_incremental_job_invalid') as CaseGraphV2IncrementalJob['action'];
  const status = requiredText(row.status, 'case_graph_v2_incremental_job_invalid') as CaseGraphV2IncrementalJob['status'];
  const entityId = requiredText(row.entity_id, 'case_graph_v2_incremental_job_invalid');
  const address = requiredText(row.address, 'case_graph_v2_incremental_job_invalid');
  if (!NODE_KINDS.includes(entityKind)
    || !['insert', 'update', 'delete'].includes(action)
    || !['queued', 'leased', 'completed', 'failed'].includes(status)
    || evidenceUniverseAddress(entityKind, entityId) !== address) {
    throw new Error('case_graph_v2_incremental_job_invalid');
  }
  const leaseToken = row.lease_token == null ? null : requiredUuid(row.lease_token, 'case_graph_v2_incremental_lease_invalid');
  const leasedUntil = nullableTimestamp(row.leased_until, 'case_graph_v2_incremental_lease_invalid');
  const errorCode = nullableText(row.error_code, 'case_graph_v2_incremental_job_invalid');
  if ((status === 'leased') !== Boolean(leaseToken && leasedUntil)) {
    throw new Error('case_graph_v2_incremental_lease_invalid');
  }
  if ((errorCode !== null && !ERROR_CODE.test(errorCode))
    || (status === 'failed' && errorCode === null)
    || (['leased', 'completed'].includes(status) && errorCode !== null)) {
    throw new Error('case_graph_v2_incremental_error_code_invalid');
  }
  const planId = requiredText(row.plan_id, 'case_graph_v2_incremental_plan_id_invalid');
  const batchId = requiredText(row.batch_id, 'case_graph_v2_incremental_batch_id_invalid');
  const changeId = requiredText(row.change_id, 'case_graph_v2_incremental_change_id_invalid');
  const targetCorpusVersion = requiredText(row.to_corpus_version, 'case_graph_v2_incremental_plan_receipt_invalid');
  const toSnapshotId = requiredUuid(row.to_snapshot_id, 'case_graph_v2_incremental_job_invalid');
  if (!PLAN_ID.test(planId) || !BATCH_ID.test(batchId) || !CHANGE_ID.test(changeId)
    || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(targetCorpusVersion)) {
    throw new Error('case_graph_v2_incremental_plan_receipt_invalid');
  }
  const planArtifactKey = requiredText(row.plan_artifact_key, 'case_graph_v2_incremental_plan_receipt_invalid');
  const exactArtifactKey = `case-vortex/incremental/case-vortex-incremental-archive-v1/`
    + `${targetCorpusVersion}/${toSnapshotId}/${planId.slice('plan:'.length)}/plan.json`;
  if (planArtifactKey !== exactArtifactKey) throw new Error('case_graph_v2_incremental_plan_receipt_invalid');
  const watermarkId = requiredText(row.watermark_id, 'case_graph_v2_incremental_plan_receipt_invalid');
  if (!WATERMARK_ID.test(watermarkId)) throw new Error('case_graph_v2_incremental_plan_receipt_invalid');
  return {
    id: requiredUuid(row.id, 'case_graph_v2_incremental_job_invalid'),
    planId,
    planSha256: requiredSha(row.plan_sha256, 'case_graph_v2_incremental_plan_receipt_invalid'),
    planArtifactKey,
    watermarkId,
    targetCorpusVersion,
    targetUniverseArchiveSetSha256: requiredSha(
      row.target_universe_archive_set_sha256,
      'case_graph_v2_incremental_plan_receipt_invalid',
    ),
    targetRelationshipInputSetSha256: requiredSha(
      row.target_relationship_input_set_sha256,
      'case_graph_v2_incremental_plan_receipt_invalid',
    ),
    sourceDiffReceiptSha256: requiredSha(
      row.source_diff_receipt_sha256,
      'case_graph_v2_incremental_plan_receipt_invalid',
    ),
    fromSnapshotId: requiredUuid(row.from_snapshot_id, 'case_graph_v2_incremental_job_invalid'),
    toSnapshotId,
    batchId,
    batchOrdinal: safeCount(row.batch_ordinal, 'case_graph_v2_incremental_job_invalid'),
    changeId,
    changeOrdinal: safeCount(row.change_ordinal, 'case_graph_v2_incremental_job_invalid'),
    address,
    entityKind,
    entityId,
    action,
    inputSha256: requiredSha(row.input_sha256, 'case_graph_v2_incremental_job_invalid'),
    status,
    attemptCount: safeCount(row.attempt_count, 'case_graph_v2_incremental_job_invalid'),
    nextAttemptAt: timestamp(row.next_attempt_at, 'case_graph_v2_incremental_job_invalid'),
    leaseToken,
    leasedUntil,
    errorCode,
  };
};

export type EnqueueRow = {
  planId: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  batchId: string;
  batchOrdinal: number;
  changeId: string;
  changeOrdinal: number;
  address: string;
  entityKind: EvidenceUniverseNodeKind;
  entityId: string;
  action: 'insert' | 'update' | 'delete';
  inputSha256: string;
};

export const insertQueueBatch = async (
  client: PostgresCaseGraphV2TransactionClient,
  rows: EnqueueRow[],
  schema: string,
) => {
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 12;
    values.push(
      row.planId,
      row.fromSnapshotId,
      row.toSnapshotId,
      row.batchId,
      row.batchOrdinal,
      row.changeId,
      row.changeOrdinal,
      row.address,
      row.entityKind,
      row.entityId,
      row.action,
      row.inputSha256,
    );
    return `(${Array.from({ length: 12 }, (_item, field) => `$${offset + field + 1}`).join(', ')})`;
  });
  await queryRows(client, `
    INSERT INTO public.uap_case_graph_incremental_queue (
      plan_id, from_snapshot_id, to_snapshot_id, batch_id, batch_ordinal,
      change_id, change_ordinal, address, entity_kind, entity_id, action, input_sha256
    ) VALUES ${tuples.join(', ')}
    ON CONFLICT (plan_id, change_id) DO NOTHING
  `, values);
  const stored = await queryRows(client, `
    SELECT
      plan_id, from_snapshot_id::text, to_snapshot_id::text, batch_id, batch_ordinal,
      change_id, change_ordinal::text, address, entity_kind, entity_id, action, input_sha256
    FROM public.uap_case_graph_incremental_queue
    WHERE plan_id = $1
      AND change_id = ANY($2::text[])
    ORDER BY change_ordinal, address COLLATE "C"
  `, [rows[0].planId, rows.map((row) => row.changeId)]);
  if (stored.length !== rows.length) throw new Error('case_graph_v2_incremental_enqueue_incomplete');
  for (let index = 0; index < rows.length; index += 1) {
    const actual = stored[index];
    const expected = rows[index];
    if (actual.plan_id !== expected.planId
      || actual.from_snapshot_id !== expected.fromSnapshotId
      || actual.to_snapshot_id !== expected.toSnapshotId
      || actual.batch_id !== expected.batchId
      || safeCount(actual.batch_ordinal, 'case_graph_v2_incremental_enqueue_invalid') !== expected.batchOrdinal
      || actual.change_id !== expected.changeId
      || safeCount(actual.change_ordinal, 'case_graph_v2_incremental_enqueue_invalid') !== expected.changeOrdinal
      || actual.address !== expected.address
      || actual.entity_kind !== expected.entityKind
      || actual.entity_id !== expected.entityId
      || actual.action !== expected.action
      || actual.input_sha256 !== expected.inputSha256) {
      throw new Error(`case_graph_v2_incremental_immutable_conflict:${expected.address}`);
    }
  }
};
