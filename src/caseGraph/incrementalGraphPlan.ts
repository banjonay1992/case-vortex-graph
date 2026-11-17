import { createHash } from 'node:crypto';

import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  evidenceUniverseAddress,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';

export const INCREMENTAL_GRAPH_PLAN_VERSION = 'case-vortex-incremental-plan-v1' as const;
export const INCREMENTAL_GRAPH_CANONICAL_VERSION = 'case-vortex-incremental-canonical-json-v1' as const;
// Deliberately pinned here: a universe archive format bump must also bump this
// contract instead of silently allowing an incremental run across formats.
export const INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION = 'evidence-universe-archive-v3' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;
const NODE_KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const MAX_CHANGES = 1_000_000;
const MAX_INCIDENT_EDGES_PER_CHANGE = 1_000_000;

export type IncrementalGraphUniverseBinding = {
  snapshotId: string;
  corpusVersion: string;
  universeArchiveVersion: typeof INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION;
  universeSchemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  universeLayoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  universeArchiveSetSha256: string;
  addressSetSha256: string;
  recordCount: number;
};

export type IncrementalGraphGenerationBinding = {
  activationId: string;
  universe: IncrementalGraphUniverseBinding;
  relationshipInputSetSha256: string;
  graphArchiveSetSha256: string;
  incidentIndexRootSha256: string;
};

export type IncrementalGraphIncidentEdge = {
  edgeId: string;
  edgeSha256: string;
  leftAddress: string;
  rightAddress: string;
};

export type IncrementalGraphDeleteTombstone = {
  recordType: 'case_vortex_delete_tombstone';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  tombstoneId: string;
  address: string;
  deletedRecordSha256: string;
  targetSnapshotId: string;
  targetUniverseArchiveSetSha256: string;
  reason: 'absent_from_target_snapshot';
};

export type IncrementalGraphChangeAction = 'insert' | 'update' | 'delete';

export type IncrementalGraphChangeDraft = {
  action: IncrementalGraphChangeAction;
  address: string;
  beforeRecordSha256: string | null;
  afterRecordSha256: string | null;
  priorIncidentEdges: IncrementalGraphIncidentEdge[];
  priorIncidentEdgesComplete: true;
};

export type IncrementalGraphChange = IncrementalGraphChangeDraft & {
  changeId: string;
  priorIncidentEdgeSetSha256: string;
  incidentLookupReceiptSha256: string;
  tombstone: IncrementalGraphDeleteTombstone | null;
};

export type IncrementalGraphWatermark = {
  recordType: 'case_vortex_incremental_watermark';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  canonicalVersion: typeof INCREMENTAL_GRAPH_CANONICAL_VERSION;
  watermarkId: string;
  source: 'evidence_universe_snapshot_diff';
  sequence: number;
  cursor: string;
  previousWatermarkId: string | null;
  base: IncrementalGraphUniverseBinding;
  target: IncrementalGraphUniverseBinding;
  targetRelationshipInputSetSha256: string;
  incidentIndexRootSha256: string;
  sourceDiffReceiptSha256: string;
  changeSetSha256: string;
  changeCount: number;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
};

export type IncrementalGraphThresholds = {
  batchSize: number;
  maximumChangedRecords: number;
  maximumChangedFraction: number;
  maximumInvalidatedEdges: number;
};

export type IncrementalGraphBatch = {
  ordinal: number;
  startOffset: number;
  endOffset: number;
  changeIds: string[];
  changeSetSha256: string;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  invalidatedNodeAddresses: string[];
  invalidatedNodeSetSha256: string;
  invalidatedEdgeIds: string[];
  invalidatedEdgeSetSha256: string;
  recomputeAddresses: string[];
  recomputeAddressSetSha256: string;
  tombstoneIds: string[];
  tombstoneSetSha256: string;
  batchId: string;
};

export type IncrementalGraphAccounting = {
  baseRecordCount: number;
  targetRecordCount: number;
  unchangedRecordCount: number;
  changeCount: number;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  changedRecordFraction: number;
  invalidatedNodeCount: number;
  invalidatedEdgeCount: number;
  recomputeNodeCount: number;
  tombstoneCount: number;
};

export type IncrementalGraphPlan = {
  recordType: 'case_vortex_incremental_plan';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  canonicalVersion: typeof INCREMENTAL_GRAPH_CANONICAL_VERSION;
  planId: string;
  baseGeneration: IncrementalGraphGenerationBinding;
  watermark: IncrementalGraphWatermark;
  mode: 'incremental' | 'full_rebuild';
  fallbackReasons: Array<'changed_record_limit' | 'changed_record_fraction' | 'invalidated_edge_limit'>;
  thresholds: IncrementalGraphThresholds;
  changes: IncrementalGraphChange[];
  invalidations: {
    nodeAddresses: string[];
    nodeSetSha256: string;
    edgeIds: string[];
    edgeSetSha256: string;
    recomputeAddresses: string[];
    recomputeAddressSetSha256: string;
  };
  accounting: IncrementalGraphAccounting;
  batches: IncrementalGraphBatch[];
};

export type IncrementalGraphBatchTransaction = {
  isolationLevel: 'serializable';
  idempotencyKey: string;
  transactionId: string;
  commitToken: string;
  committedAt: string;
  commitProofSha256: string;
  committed: true;
};

export type IncrementalGraphBatchReceipt = {
  recordType: 'case_vortex_incremental_batch_receipt';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  receiptId: string;
  planId: string;
  watermarkId: string;
  batchId: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  changeSetSha256: string;
  appliedChangeCount: number;
  appliedInsertCount: number;
  appliedUpdateCount: number;
  appliedDeleteCount: number;
  invalidatedNodeCount: number;
  invalidatedNodeSetSha256: string;
  invalidatedEdgeCount: number;
  invalidatedEdgeSetSha256: string;
  recomputeNodeCount: number;
  recomputeAddressSetSha256: string;
  tombstoneCount: number;
  tombstoneSetSha256: string;
  writtenNodeCount: number;
  writtenEdgeCount: number;
  nodeDeltaSetSha256: string;
  edgeDeltaSetSha256: string;
  transaction: IncrementalGraphBatchTransaction;
};

export type IncrementalGraphBatchReceiptReference = {
  ordinal: number;
  batchId: string;
  receiptId: string;
  transactionId: string;
  commitProofSha256: string;
};

export type IncrementalGraphCheckpoint = {
  recordType: 'case_vortex_incremental_checkpoint';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  planId: string;
  watermarkId: string;
  status: 'processing' | 'ready_to_activate';
  nextBatchOrdinal: number;
  nextChangeOffset: number;
  appliedChangeCount: number;
  appliedInsertCount: number;
  appliedUpdateCount: number;
  appliedDeleteCount: number;
  batchReceipts: IncrementalGraphBatchReceiptReference[];
  checkpointDigest: string;
};

export type IncrementalGraphOutputGeneration = {
  universe: IncrementalGraphUniverseBinding;
  relationshipInputSetSha256: string;
  graphArchiveSetSha256: string;
  graphManifestSha256: string;
  incidentIndexRootSha256: string;
  nodeAddressSetSha256: string;
  nodeCount: number;
  connectedNodeCount: number;
  isolatedNodeCount: number;
  edgeCount: number;
};

export type IncrementalGraphActivationIntent = {
  recordType: 'case_vortex_incremental_activation_intent';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  activationId: string;
  planId: string;
  watermarkId: string;
  checkpointDigest: string;
  batchReceiptSetSha256: string;
  expectedPreviousActivationId: string;
  expectedPreviousGraphArchiveSetSha256: string;
  output: IncrementalGraphOutputGeneration;
};

export type IncrementalGraphActivationTransaction = {
  isolationLevel: 'serializable';
  compareAndSwap: 'active_activation_and_graph_archive';
  idempotencyKey: string;
  expectedPreviousActivationId: string;
  observedPreviousActivationId: string;
  expectedPreviousGraphArchiveSetSha256: string;
  observedPreviousGraphArchiveSetSha256: string;
  committedActivationId: string;
  transactionId: string;
  commitToken: string;
  committedAt: string;
  commitProofSha256: string;
  committed: true;
};

export type IncrementalGraphActivationReceipt = {
  recordType: 'case_vortex_incremental_activation_receipt';
  schemaVersion: typeof INCREMENTAL_GRAPH_PLAN_VERSION;
  receiptId: string;
  intent: IncrementalGraphActivationIntent;
  transaction: IncrementalGraphActivationTransaction;
};

const lexicalCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalJsonValue = (value: unknown, seen: Set<object>): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('incremental_graph_canonical_non_finite');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') throw new Error('incremental_graph_canonical_value_invalid');
  if (seen.has(value)) throw new Error('incremental_graph_canonical_cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonValue(item, seen)).join(',')}]`;
    if (!isPlainObject(value)) throw new Error('incremental_graph_canonical_object_invalid');
    return `{${Object.keys(value).sort(lexicalCompare).map((key) => {
      const item = value[key];
      if (item === undefined) throw new Error('incremental_graph_canonical_undefined');
      return `${JSON.stringify(key)}:${canonicalJsonValue(item, seen)}`;
    }).join(',')}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalizeIncrementalGraph = (value: unknown) => canonicalJsonValue(value, new Set<object>());
export const incrementalGraphSha256 = (value: unknown) => createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalizeIncrementalGraph(value))
  .digest('hex');

function invalid(code: string): never {
  throw new Error(code);
}

const requireString = (value: unknown, code: string, maximum = 512) => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) invalid(code);
  return value;
};

const requireId = (value: unknown, code: string) => {
  const normalized = requireString(value, code);
  if (!ID_PATTERN.test(normalized)) invalid(code);
  return normalized;
};

const requireSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(code);
  return value;
};

const requireCount = (value: unknown, code: string, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) invalid(code);
  return Number(value);
};

const requirePositiveCount = (value: unknown, code: string, maximum = Number.MAX_SAFE_INTEGER) => {
  const normalized = requireCount(value, code, maximum);
  if (normalized < 1) invalid(code);
  return normalized;
};

const requireIso = (value: unknown, code: string) => {
  const normalized = requireString(value, code, 80);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) invalid(code);
  return normalized;
};

const requireAddress = (value: unknown, code: string) => {
  const address = requireString(value, code, 512);
  const separator = address.indexOf(':');
  if (separator < 1) invalid(code);
  const kind = address.slice(0, separator) as EvidenceUniverseNodeKind;
  const recordId = address.slice(separator + 1);
  if (!NODE_KINDS.includes(kind) || evidenceUniverseAddress(kind, recordId) !== address) invalid(code);
  return address;
};

const assertSame = (left: unknown, right: unknown, code: string) => {
  if (canonicalizeIncrementalGraph(left) !== canonicalizeIncrementalGraph(right)) invalid(code);
};

const setSha = (domain: string, values: readonly string[]) => incrementalGraphSha256(
  `${domain}\n${values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('\n')}`,
);

const parseValue = (input: string | Buffer | unknown, code: string) => {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) return input;
  try {
    return JSON.parse(input.toString());
  } catch {
    return invalid(code);
  }
};

export const validateIncrementalGraphUniverseBinding = (value: unknown): IncrementalGraphUniverseBinding => {
  if (!isPlainObject(value)) invalid('incremental_graph_universe_binding_invalid');
  const snapshotId = requireString(value.snapshotId, 'incremental_graph_snapshot_id_invalid', 36);
  if (!UUID_PATTERN.test(snapshotId)) invalid('incremental_graph_snapshot_id_invalid');
  if (
    value.universeArchiveVersion !== INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION
    || value.universeSchemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || value.universeLayoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
  ) invalid('incremental_graph_universe_version_invalid');
  return {
    snapshotId,
    corpusVersion: requireId(value.corpusVersion, 'incremental_graph_corpus_version_invalid'),
    universeArchiveVersion: INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: requireSha(value.universeArchiveSetSha256, 'incremental_graph_universe_archive_sha_invalid'),
    addressSetSha256: requireSha(value.addressSetSha256, 'incremental_graph_address_set_sha_invalid'),
    recordCount: requireCount(value.recordCount, 'incremental_graph_universe_record_count_invalid'),
  };
};

const normalizeGeneration = (value: unknown): IncrementalGraphGenerationBinding => {
  if (!isPlainObject(value)) invalid('incremental_graph_generation_binding_invalid');
  return {
    activationId: requireId(value.activationId, 'incremental_graph_activation_id_invalid'),
    universe: validateIncrementalGraphUniverseBinding(value.universe),
    relationshipInputSetSha256: requireSha(value.relationshipInputSetSha256, 'incremental_graph_relationship_input_sha_invalid'),
    graphArchiveSetSha256: requireSha(value.graphArchiveSetSha256, 'incremental_graph_archive_sha_invalid'),
    incidentIndexRootSha256: requireSha(value.incidentIndexRootSha256, 'incremental_graph_incident_index_sha_invalid'),
  };
};

const normalizeIncidentEdge = (value: unknown, address: string): IncrementalGraphIncidentEdge => {
  if (!isPlainObject(value)) invalid('incremental_graph_incident_edge_invalid');
  const leftAddress = requireAddress(value.leftAddress, 'incremental_graph_incident_edge_address_invalid');
  const rightAddress = requireAddress(value.rightAddress, 'incremental_graph_incident_edge_address_invalid');
  if (leftAddress >= rightAddress || (address !== leftAddress && address !== rightAddress)) {
    invalid('incremental_graph_incident_edge_endpoint_invalid');
  }
  return {
    edgeId: requireId(value.edgeId, 'incremental_graph_edge_id_invalid'),
    edgeSha256: requireSha(value.edgeSha256, 'incremental_graph_edge_sha_invalid'),
    leftAddress,
    rightAddress,
  };
};

const buildTombstone = (
  address: string,
  deletedRecordSha256: string,
  target: IncrementalGraphUniverseBinding,
): IncrementalGraphDeleteTombstone => {
  const identity = {
    recordType: 'case_vortex_delete_tombstone',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    address,
    deletedRecordSha256,
    targetSnapshotId: target.snapshotId,
    targetUniverseArchiveSetSha256: target.universeArchiveSetSha256,
    reason: 'absent_from_target_snapshot',
  } as const;
  return { ...identity, tombstoneId: `tombstone:${incrementalGraphSha256(identity)}` };
};

const normalizeChange = (
  value: unknown,
  target: IncrementalGraphUniverseBinding,
  incidentIndexRootSha256: string,
): IncrementalGraphChange => {
  if (!isPlainObject(value) || !['insert', 'update', 'delete'].includes(String(value.action))) {
    invalid('incremental_graph_change_invalid');
  }
  const action = value.action as IncrementalGraphChangeAction;
  const address = requireAddress(value.address, 'incremental_graph_change_address_invalid');
  const beforeRecordSha256 = value.beforeRecordSha256 === null
    ? null
    : requireSha(value.beforeRecordSha256, 'incremental_graph_before_record_sha_invalid');
  const afterRecordSha256 = value.afterRecordSha256 === null
    ? null
    : requireSha(value.afterRecordSha256, 'incremental_graph_after_record_sha_invalid');
  if (
    (action === 'insert' && (beforeRecordSha256 !== null || afterRecordSha256 === null))
    || (action === 'update' && (beforeRecordSha256 === null || afterRecordSha256 === null || beforeRecordSha256 === afterRecordSha256))
    || (action === 'delete' && (beforeRecordSha256 === null || afterRecordSha256 !== null))
  ) invalid('incremental_graph_change_transition_invalid');
  if (!Array.isArray(value.priorIncidentEdges) || value.priorIncidentEdges.length > MAX_INCIDENT_EDGES_PER_CHANGE) {
    invalid('incremental_graph_incident_edges_invalid');
  }
  if (value.priorIncidentEdgesComplete !== true) invalid('incremental_graph_incident_lookup_incomplete');
  const priorIncidentEdges = value.priorIncidentEdges
    .map((edge) => normalizeIncidentEdge(edge, address))
    .sort((left, right) => lexicalCompare(left.edgeId, right.edgeId));
  if (new Set(priorIncidentEdges.map((edge) => edge.edgeId)).size !== priorIncidentEdges.length) {
    invalid('incremental_graph_duplicate_incident_edge');
  }
  if (action === 'insert' && priorIncidentEdges.length) invalid('incremental_graph_insert_has_prior_edges');
  const priorIncidentEdgeSetSha256 = setSha(
    'case-vortex-prior-incident-edge-set-v1',
    priorIncidentEdges.map((edge) => `${edge.edgeId}:${edge.edgeSha256}:${edge.leftAddress}:${edge.rightAddress}`),
  );
  const incidentLookupReceiptSha256 = incrementalGraphSha256({
    domain: 'case-vortex-complete-incident-lookup-v1',
    incidentIndexRootSha256,
    address,
    priorIncidentEdgeSetSha256,
    priorIncidentEdgeCount: priorIncidentEdges.length,
    complete: true,
  });
  const core = {
    action,
    address,
    beforeRecordSha256,
    afterRecordSha256,
    priorIncidentEdges,
    priorIncidentEdgesComplete: true as const,
    priorIncidentEdgeSetSha256,
    incidentLookupReceiptSha256,
  };
  const changeId = `change:${incrementalGraphSha256(core)}`;
  const tombstone = action === 'delete' ? buildTombstone(address, beforeRecordSha256 as string, target) : null;
  if ('changeId' in value && value.changeId !== changeId) invalid('incremental_graph_change_id_mismatch');
  if ('priorIncidentEdgeSetSha256' in value && value.priorIncidentEdgeSetSha256 !== priorIncidentEdgeSetSha256) {
    invalid('incremental_graph_incident_edge_set_mismatch');
  }
  if ('incidentLookupReceiptSha256' in value && value.incidentLookupReceiptSha256 !== incidentLookupReceiptSha256) {
    invalid('incremental_graph_incident_lookup_receipt_mismatch');
  }
  if ('tombstone' in value) assertSame(value.tombstone, tombstone, 'incremental_graph_tombstone_mismatch');
  return { ...core, changeId, tombstone };
};

const normalizeThresholds = (value: Partial<IncrementalGraphThresholds> | undefined): IncrementalGraphThresholds => {
  const normalized = {
    batchSize: value?.batchSize ?? 1_000,
    maximumChangedRecords: value?.maximumChangedRecords ?? 50_000,
    maximumChangedFraction: value?.maximumChangedFraction ?? 0.15,
    maximumInvalidatedEdges: value?.maximumInvalidatedEdges ?? 2_000_000,
  };
  if (
    !Number.isSafeInteger(normalized.batchSize) || normalized.batchSize < 1 || normalized.batchSize > 100_000
    || !Number.isSafeInteger(normalized.maximumChangedRecords) || normalized.maximumChangedRecords < 1 || normalized.maximumChangedRecords > MAX_CHANGES
    || typeof normalized.maximumChangedFraction !== 'number' || !Number.isFinite(normalized.maximumChangedFraction)
    || normalized.maximumChangedFraction <= 0 || normalized.maximumChangedFraction > 1
    || !Number.isSafeInteger(normalized.maximumInvalidatedEdges) || normalized.maximumInvalidatedEdges < 1
  ) invalid('incremental_graph_thresholds_invalid');
  return normalized;
};

const normalizeWatermark = (value: unknown): IncrementalGraphWatermark => {
  if (!isPlainObject(value)) invalid('incremental_graph_watermark_invalid');
  if (
    value.recordType !== 'case_vortex_incremental_watermark'
    || value.schemaVersion !== INCREMENTAL_GRAPH_PLAN_VERSION
    || value.canonicalVersion !== INCREMENTAL_GRAPH_CANONICAL_VERSION
    || value.source !== 'evidence_universe_snapshot_diff'
  ) invalid('incremental_graph_watermark_version_invalid');
  const normalizedWithoutId = {
    recordType: 'case_vortex_incremental_watermark',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    canonicalVersion: INCREMENTAL_GRAPH_CANONICAL_VERSION,
    source: 'evidence_universe_snapshot_diff',
    sequence: requirePositiveCount(value.sequence, 'incremental_graph_watermark_sequence_invalid'),
    cursor: requireString(value.cursor, 'incremental_graph_watermark_cursor_invalid', 4_096),
    previousWatermarkId: value.previousWatermarkId === null
      ? null
      : requireId(value.previousWatermarkId, 'incremental_graph_previous_watermark_id_invalid'),
    base: validateIncrementalGraphUniverseBinding(value.base),
    target: validateIncrementalGraphUniverseBinding(value.target),
    targetRelationshipInputSetSha256: requireSha(value.targetRelationshipInputSetSha256, 'incremental_graph_relationship_input_sha_invalid'),
    incidentIndexRootSha256: requireSha(value.incidentIndexRootSha256, 'incremental_graph_incident_index_sha_invalid'),
    sourceDiffReceiptSha256: requireSha(value.sourceDiffReceiptSha256, 'incremental_graph_source_diff_receipt_sha_invalid'),
    changeSetSha256: requireSha(value.changeSetSha256, 'incremental_graph_change_set_sha_invalid'),
    changeCount: requireCount(value.changeCount, 'incremental_graph_change_count_invalid', MAX_CHANGES),
    insertCount: requireCount(value.insertCount, 'incremental_graph_change_count_invalid', MAX_CHANGES),
    updateCount: requireCount(value.updateCount, 'incremental_graph_change_count_invalid', MAX_CHANGES),
    deleteCount: requireCount(value.deleteCount, 'incremental_graph_change_count_invalid', MAX_CHANGES),
  } as const;
  if (normalizedWithoutId.changeCount !== normalizedWithoutId.insertCount + normalizedWithoutId.updateCount + normalizedWithoutId.deleteCount) {
    invalid('incremental_graph_watermark_accounting_invalid');
  }
  const watermarkId = `watermark:${incrementalGraphSha256(normalizedWithoutId)}`;
  if (value.watermarkId !== watermarkId) invalid('incremental_graph_watermark_id_mismatch');
  return { ...normalizedWithoutId, watermarkId };
};

export const classifyIncrementalGraphWatermark = (
  previousInput: IncrementalGraphWatermark,
  candidateInput: IncrementalGraphWatermark,
): 'replay' | 'advance' => {
  const previous = normalizeWatermark(previousInput);
  const candidate = normalizeWatermark(candidateInput);
  if (candidate.sequence === previous.sequence) {
    if (candidate.watermarkId === previous.watermarkId && canonicalizeIncrementalGraph(candidate) === canonicalizeIncrementalGraph(previous)) {
      return 'replay';
    }
    return invalid('incremental_graph_same_watermark_conflict');
  }
  if (candidate.sequence < previous.sequence) invalid('incremental_graph_watermark_out_of_order');
  if (candidate.sequence !== previous.sequence + 1) invalid('incremental_graph_watermark_gap');
  if (candidate.previousWatermarkId !== previous.watermarkId) invalid('incremental_graph_watermark_chain_mismatch');
  assertSame(candidate.base, previous.target, 'incremental_graph_snapshot_chain_mismatch');
  return 'advance';
};

const buildWatermark = (params: {
  base: IncrementalGraphUniverseBinding;
  target: IncrementalGraphUniverseBinding;
  targetRelationshipInputSetSha256: string;
  incidentIndexRootSha256: string;
  sourceDiffReceiptSha256: string;
  sourceSequence: number;
  sourceCursor: string;
  previousWatermarkId: string | null;
  changes: readonly IncrementalGraphChange[];
}): IncrementalGraphWatermark => {
  const insertCount = params.changes.filter((change) => change.action === 'insert').length;
  const updateCount = params.changes.filter((change) => change.action === 'update').length;
  const deleteCount = params.changes.filter((change) => change.action === 'delete').length;
  const withoutId = {
    recordType: 'case_vortex_incremental_watermark',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    canonicalVersion: INCREMENTAL_GRAPH_CANONICAL_VERSION,
    source: 'evidence_universe_snapshot_diff',
    sequence: requirePositiveCount(params.sourceSequence, 'incremental_graph_watermark_sequence_invalid'),
    cursor: requireString(params.sourceCursor, 'incremental_graph_watermark_cursor_invalid', 4_096),
    previousWatermarkId: params.previousWatermarkId,
    base: params.base,
    target: params.target,
    targetRelationshipInputSetSha256: requireSha(params.targetRelationshipInputSetSha256, 'incremental_graph_relationship_input_sha_invalid'),
    incidentIndexRootSha256: requireSha(params.incidentIndexRootSha256, 'incremental_graph_incident_index_sha_invalid'),
    sourceDiffReceiptSha256: requireSha(params.sourceDiffReceiptSha256, 'incremental_graph_source_diff_receipt_sha_invalid'),
    changeSetSha256: setSha('case-vortex-change-set-v1', params.changes.map((change) => change.changeId)),
    changeCount: params.changes.length,
    insertCount,
    updateCount,
    deleteCount,
  } as const;
  return { ...withoutId, watermarkId: `watermark:${incrementalGraphSha256(withoutId)}` };
};

const derivePlan = (params: {
  baseGeneration: IncrementalGraphGenerationBinding;
  watermark: IncrementalGraphWatermark;
  thresholds: IncrementalGraphThresholds;
  changes: IncrementalGraphChange[];
}): IncrementalGraphPlan => {
  const { baseGeneration, watermark, thresholds } = params;
  const changes = [...params.changes].sort((left, right) => lexicalCompare(left.address, right.address));
  if (changes.length > MAX_CHANGES) invalid('incremental_graph_change_limit_exceeded');
  if (new Set(changes.map((change) => change.address)).size !== changes.length) invalid('incremental_graph_duplicate_change_address');
  assertSame(baseGeneration.universe, watermark.base, 'incremental_graph_base_generation_snapshot_mismatch');
  if (baseGeneration.incidentIndexRootSha256 !== watermark.incidentIndexRootSha256) {
    invalid('incremental_graph_incident_index_generation_mismatch');
  }
  if (watermark.base.snapshotId === watermark.target.snapshotId) invalid('incremental_graph_snapshot_not_advanced');
  const changeSetSha256 = setSha('case-vortex-change-set-v1', changes.map((change) => change.changeId));
  if (
    watermark.changeSetSha256 !== changeSetSha256
    || watermark.changeCount !== changes.length
    || watermark.insertCount !== changes.filter((change) => change.action === 'insert').length
    || watermark.updateCount !== changes.filter((change) => change.action === 'update').length
    || watermark.deleteCount !== changes.filter((change) => change.action === 'delete').length
  ) invalid('incremental_graph_watermark_change_set_mismatch');

  const expectedTargetCount = watermark.base.recordCount + watermark.insertCount - watermark.deleteCount;
  if (expectedTargetCount !== watermark.target.recordCount) invalid('incremental_graph_target_count_mismatch');
  const unchangedRecordCount = watermark.base.recordCount - watermark.updateCount - watermark.deleteCount;
  if (unchangedRecordCount < 0) invalid('incremental_graph_base_count_underflow');

  const edgeById = new Map<string, IncrementalGraphIncidentEdge>();
  for (const change of changes) {
    for (const edge of change.priorIncidentEdges) {
      const existing = edgeById.get(edge.edgeId);
      if (existing && canonicalizeIncrementalGraph(existing) !== canonicalizeIncrementalGraph(edge)) {
        invalid('incremental_graph_incident_edge_conflict');
      }
      edgeById.set(edge.edgeId, edge);
    }
  }
  const nodeAddresses = changes.map((change) => change.address);
  const edgeIds = [...edgeById.keys()].sort(lexicalCompare);
  const deletedAddresses = new Set(changes.filter((change) => change.action === 'delete').map((change) => change.address));
  const recomputeSet = new Set(changes.filter((change) => change.action !== 'delete').map((change) => change.address));
  for (const edge of edgeById.values()) {
    if (!deletedAddresses.has(edge.leftAddress)) recomputeSet.add(edge.leftAddress);
    if (!deletedAddresses.has(edge.rightAddress)) recomputeSet.add(edge.rightAddress);
  }
  const recomputeAddresses = [...recomputeSet].sort(lexicalCompare);
  const changedRecordFraction = changes.length / Math.max(1, watermark.base.recordCount, watermark.target.recordCount);
  const fallbackReasons: IncrementalGraphPlan['fallbackReasons'] = [];
  if (changes.length > thresholds.maximumChangedRecords) fallbackReasons.push('changed_record_limit');
  if (changedRecordFraction > thresholds.maximumChangedFraction) fallbackReasons.push('changed_record_fraction');
  if (edgeIds.length > thresholds.maximumInvalidatedEdges) fallbackReasons.push('invalidated_edge_limit');
  const mode = fallbackReasons.length ? 'full_rebuild' : 'incremental';
  const invalidations = {
    nodeAddresses,
    nodeSetSha256: setSha('case-vortex-invalidated-node-set-v1', nodeAddresses),
    edgeIds,
    edgeSetSha256: setSha('case-vortex-invalidated-edge-set-v1', edgeIds),
    recomputeAddresses,
    recomputeAddressSetSha256: setSha('case-vortex-recompute-address-set-v1', recomputeAddresses),
  };
  const accounting: IncrementalGraphAccounting = {
    baseRecordCount: watermark.base.recordCount,
    targetRecordCount: watermark.target.recordCount,
    unchangedRecordCount,
    changeCount: changes.length,
    insertCount: watermark.insertCount,
    updateCount: watermark.updateCount,
    deleteCount: watermark.deleteCount,
    changedRecordFraction,
    invalidatedNodeCount: nodeAddresses.length,
    invalidatedEdgeCount: edgeIds.length,
    recomputeNodeCount: recomputeAddresses.length,
    tombstoneCount: watermark.deleteCount,
  };
  const planIdentity = {
    recordType: 'case_vortex_incremental_plan',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    canonicalVersion: INCREMENTAL_GRAPH_CANONICAL_VERSION,
    baseGeneration,
    watermark,
    mode,
    fallbackReasons,
    thresholds,
    changeIds: changes.map((change) => change.changeId),
    invalidations,
    accounting,
  } as const;
  const planId = `plan:${incrementalGraphSha256(planIdentity)}`;

  const edgeOwner = new Map<string, number>();
  const recomputeOwner = new Map<string, number>();
  changes.forEach((change, index) => {
    for (const edge of change.priorIncidentEdges) if (!edgeOwner.has(edge.edgeId)) edgeOwner.set(edge.edgeId, index);
    if (change.action !== 'delete' && !recomputeOwner.has(change.address)) recomputeOwner.set(change.address, index);
    for (const edge of change.priorIncidentEdges) {
      const neighbour = edge.leftAddress === change.address ? edge.rightAddress : edge.leftAddress;
      if (!deletedAddresses.has(neighbour) && !recomputeOwner.has(neighbour)) recomputeOwner.set(neighbour, index);
    }
  });
  const batches: IncrementalGraphBatch[] = [];
  for (let startOffset = 0; startOffset < changes.length; startOffset += thresholds.batchSize) {
    const endOffset = Math.min(changes.length, startOffset + thresholds.batchSize);
    const slice = changes.slice(startOffset, endOffset);
    const ordinal = batches.length;
    const changeIds = slice.map((change) => change.changeId);
    const invalidatedNodeAddresses = slice.map((change) => change.address);
    const invalidatedEdgeIds = edgeIds.filter((edgeId) => {
      const owner = edgeOwner.get(edgeId);
      return owner !== undefined && owner >= startOffset && owner < endOffset;
    });
    const batchRecomputeAddresses = recomputeAddresses.filter((address) => {
      const owner = recomputeOwner.get(address);
      return owner !== undefined && owner >= startOffset && owner < endOffset;
    });
    const tombstoneIds = slice.flatMap((change) => change.tombstone ? [change.tombstone.tombstoneId] : []);
    const batchWithoutId = {
      ordinal,
      startOffset,
      endOffset,
      changeIds,
      changeSetSha256: setSha('case-vortex-batch-change-set-v1', changeIds),
      insertCount: slice.filter((change) => change.action === 'insert').length,
      updateCount: slice.filter((change) => change.action === 'update').length,
      deleteCount: slice.filter((change) => change.action === 'delete').length,
      invalidatedNodeAddresses,
      invalidatedNodeSetSha256: setSha('case-vortex-batch-invalidated-node-set-v1', invalidatedNodeAddresses),
      invalidatedEdgeIds,
      invalidatedEdgeSetSha256: setSha('case-vortex-batch-invalidated-edge-set-v1', invalidatedEdgeIds),
      recomputeAddresses: batchRecomputeAddresses,
      recomputeAddressSetSha256: setSha('case-vortex-batch-recompute-address-set-v1', batchRecomputeAddresses),
      tombstoneIds,
      tombstoneSetSha256: setSha('case-vortex-batch-tombstone-set-v1', tombstoneIds),
    };
    batches.push({ ...batchWithoutId, batchId: `batch:${incrementalGraphSha256({ planId, ...batchWithoutId })}` });
  }
  return {
    recordType: 'case_vortex_incremental_plan',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    canonicalVersion: INCREMENTAL_GRAPH_CANONICAL_VERSION,
    planId,
    baseGeneration,
    watermark,
    mode,
    fallbackReasons,
    thresholds,
    changes,
    invalidations,
    accounting,
    batches,
  };
};

export const buildIncrementalGraphPlan = (params: {
  baseGeneration: IncrementalGraphGenerationBinding;
  targetUniverse: IncrementalGraphUniverseBinding;
  targetRelationshipInputSetSha256: string;
  incidentIndexRootSha256: string;
  sourceDiffReceiptSha256: string;
  sourceSequence: number;
  sourceCursor: string;
  previousWatermark?: IncrementalGraphWatermark | null;
  changes: IncrementalGraphChangeDraft[];
  thresholds?: Partial<IncrementalGraphThresholds>;
}): IncrementalGraphPlan => {
  const baseGeneration = normalizeGeneration(params.baseGeneration);
  const target = validateIncrementalGraphUniverseBinding(params.targetUniverse);
  const incidentIndexRootSha256 = requireSha(
    params.incidentIndexRootSha256,
    'incremental_graph_incident_index_sha_invalid',
  );
  if (incidentIndexRootSha256 !== baseGeneration.incidentIndexRootSha256) {
    invalid('incremental_graph_incident_index_generation_mismatch');
  }
  const previous = params.previousWatermark ? normalizeWatermark(params.previousWatermark) : null;
  if (previous) {
    if (params.sourceSequence <= previous.sequence) invalid('incremental_graph_watermark_out_of_order');
    if (params.sourceSequence !== previous.sequence + 1) invalid('incremental_graph_watermark_gap');
    assertSame(baseGeneration.universe, previous.target, 'incremental_graph_snapshot_chain_mismatch');
    if (baseGeneration.relationshipInputSetSha256 !== previous.targetRelationshipInputSetSha256) {
      invalid('incremental_graph_relationship_input_chain_mismatch');
    }
  } else if (params.sourceSequence !== 1) {
    invalid('incremental_graph_initial_watermark_sequence_invalid');
  }
  if (!Array.isArray(params.changes) || params.changes.length > MAX_CHANGES) invalid('incremental_graph_changes_invalid');
  const changes = params.changes
    .map((change) => normalizeChange(change, target, incidentIndexRootSha256))
    .sort((left, right) => lexicalCompare(left.address, right.address));
  const watermark = buildWatermark({
    base: baseGeneration.universe,
    target,
    targetRelationshipInputSetSha256: params.targetRelationshipInputSetSha256,
    incidentIndexRootSha256,
    sourceDiffReceiptSha256: params.sourceDiffReceiptSha256,
    sourceSequence: params.sourceSequence,
    sourceCursor: params.sourceCursor,
    previousWatermarkId: previous?.watermarkId || null,
    changes,
  });
  return derivePlan({ baseGeneration, watermark, thresholds: normalizeThresholds(params.thresholds), changes });
};

const normalizePlan = (value: unknown): IncrementalGraphPlan => {
  if (!isPlainObject(value) || !Array.isArray(value.changes)) invalid('incremental_graph_plan_invalid');
  if (
    value.recordType !== 'case_vortex_incremental_plan'
    || value.schemaVersion !== INCREMENTAL_GRAPH_PLAN_VERSION
    || value.canonicalVersion !== INCREMENTAL_GRAPH_CANONICAL_VERSION
  ) invalid('incremental_graph_plan_version_invalid');
  const baseGeneration = normalizeGeneration(value.baseGeneration);
  const watermark = normalizeWatermark(value.watermark);
  const changes = value.changes.map((change) => normalizeChange(
    change,
    watermark.target,
    watermark.incidentIndexRootSha256,
  ));
  const derived = derivePlan({
    baseGeneration,
    watermark,
    thresholds: normalizeThresholds(value.thresholds as IncrementalGraphThresholds),
    changes,
  });
  assertSame(value, derived, 'incremental_graph_plan_receipt_mismatch');
  return derived;
};

export const decodeIncrementalGraphPlan = (input: string | Buffer | unknown) => normalizePlan(
  parseValue(input, 'incremental_graph_plan_invalid_json'),
);

const normalizeBatchTransaction = (
  value: unknown,
  batchId: string,
): IncrementalGraphBatchTransaction => {
  if (!isPlainObject(value)) invalid('incremental_graph_batch_transaction_invalid');
  if (
    value.isolationLevel !== 'serializable'
    || value.idempotencyKey !== batchId
    || value.committed !== true
  ) invalid('incremental_graph_batch_transaction_invalid');
  return {
    isolationLevel: 'serializable',
    idempotencyKey: batchId,
    transactionId: requireId(value.transactionId, 'incremental_graph_transaction_id_invalid'),
    commitToken: requireString(value.commitToken, 'incremental_graph_commit_token_invalid', 4_096),
    committedAt: requireIso(value.committedAt, 'incremental_graph_commit_timestamp_invalid'),
    commitProofSha256: requireSha(value.commitProofSha256, 'incremental_graph_commit_proof_invalid'),
    committed: true,
  };
};

export const buildIncrementalGraphBatchReceipt = (params: {
  plan: IncrementalGraphPlan;
  batchOrdinal: number;
  appliedChangeSetSha256: string;
  deletedEdgeSetSha256: string;
  recomputedAddressSetSha256: string;
  committedTombstoneSetSha256: string;
  writtenNodeCount: number;
  writtenEdgeCount: number;
  nodeDeltaSetSha256: string;
  edgeDeltaSetSha256: string;
  transaction: IncrementalGraphBatchTransaction;
}): IncrementalGraphBatchReceipt => {
  const plan = normalizePlan(params.plan);
  if (plan.mode !== 'incremental') invalid('incremental_graph_full_rebuild_required');
  const ordinal = requireCount(params.batchOrdinal, 'incremental_graph_batch_ordinal_invalid');
  const batch = plan.batches[ordinal];
  if (!batch) invalid('incremental_graph_batch_ordinal_invalid');
  if (requireSha(params.appliedChangeSetSha256, 'incremental_graph_applied_change_set_sha_invalid') !== batch.changeSetSha256) {
    invalid('incremental_graph_applied_change_set_mismatch');
  }
  if (requireSha(params.deletedEdgeSetSha256, 'incremental_graph_deleted_edge_set_sha_invalid') !== batch.invalidatedEdgeSetSha256) {
    invalid('incremental_graph_deleted_edge_set_mismatch');
  }
  if (requireSha(params.recomputedAddressSetSha256, 'incremental_graph_recomputed_address_set_sha_invalid') !== batch.recomputeAddressSetSha256) {
    invalid('incremental_graph_recomputed_address_set_mismatch');
  }
  if (requireSha(params.committedTombstoneSetSha256, 'incremental_graph_committed_tombstone_set_sha_invalid') !== batch.tombstoneSetSha256) {
    invalid('incremental_graph_committed_tombstone_set_mismatch');
  }
  const withoutReceiptId = {
    recordType: 'case_vortex_incremental_batch_receipt',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    planId: plan.planId,
    watermarkId: plan.watermark.watermarkId,
    batchId: batch.batchId,
    ordinal: batch.ordinal,
    startOffset: batch.startOffset,
    endOffset: batch.endOffset,
    changeSetSha256: batch.changeSetSha256,
    appliedChangeCount: batch.changeIds.length,
    appliedInsertCount: batch.insertCount,
    appliedUpdateCount: batch.updateCount,
    appliedDeleteCount: batch.deleteCount,
    invalidatedNodeCount: batch.invalidatedNodeAddresses.length,
    invalidatedNodeSetSha256: batch.invalidatedNodeSetSha256,
    invalidatedEdgeCount: batch.invalidatedEdgeIds.length,
    invalidatedEdgeSetSha256: batch.invalidatedEdgeSetSha256,
    recomputeNodeCount: batch.recomputeAddresses.length,
    recomputeAddressSetSha256: batch.recomputeAddressSetSha256,
    tombstoneCount: batch.tombstoneIds.length,
    tombstoneSetSha256: batch.tombstoneSetSha256,
    writtenNodeCount: requireCount(params.writtenNodeCount, 'incremental_graph_written_node_count_invalid'),
    writtenEdgeCount: requireCount(params.writtenEdgeCount, 'incremental_graph_written_edge_count_invalid'),
    nodeDeltaSetSha256: requireSha(params.nodeDeltaSetSha256, 'incremental_graph_node_delta_sha_invalid'),
    edgeDeltaSetSha256: requireSha(params.edgeDeltaSetSha256, 'incremental_graph_edge_delta_sha_invalid'),
    transaction: normalizeBatchTransaction(params.transaction, batch.batchId),
  } as const;
  return { ...withoutReceiptId, receiptId: `batch-receipt:${incrementalGraphSha256(withoutReceiptId)}` };
};

const normalizeBatchReceipt = (value: unknown, plan: IncrementalGraphPlan): IncrementalGraphBatchReceipt => {
  if (!isPlainObject(value)) invalid('incremental_graph_batch_receipt_invalid');
  if (value.recordType !== 'case_vortex_incremental_batch_receipt' || value.schemaVersion !== INCREMENTAL_GRAPH_PLAN_VERSION) {
    invalid('incremental_graph_batch_receipt_version_invalid');
  }
  const rebuilt = buildIncrementalGraphBatchReceipt({
    plan,
    batchOrdinal: requireCount(value.ordinal, 'incremental_graph_batch_ordinal_invalid'),
    appliedChangeSetSha256: requireSha(value.changeSetSha256, 'incremental_graph_applied_change_set_sha_invalid'),
    deletedEdgeSetSha256: requireSha(value.invalidatedEdgeSetSha256, 'incremental_graph_deleted_edge_set_sha_invalid'),
    recomputedAddressSetSha256: requireSha(value.recomputeAddressSetSha256, 'incremental_graph_recomputed_address_set_sha_invalid'),
    committedTombstoneSetSha256: requireSha(value.tombstoneSetSha256, 'incremental_graph_committed_tombstone_set_sha_invalid'),
    writtenNodeCount: requireCount(value.writtenNodeCount, 'incremental_graph_written_node_count_invalid'),
    writtenEdgeCount: requireCount(value.writtenEdgeCount, 'incremental_graph_written_edge_count_invalid'),
    nodeDeltaSetSha256: requireSha(value.nodeDeltaSetSha256, 'incremental_graph_node_delta_sha_invalid'),
    edgeDeltaSetSha256: requireSha(value.edgeDeltaSetSha256, 'incremental_graph_edge_delta_sha_invalid'),
    transaction: value.transaction as IncrementalGraphBatchTransaction,
  });
  assertSame(value, rebuilt, 'incremental_graph_batch_receipt_mismatch');
  return rebuilt;
};

export const decodeIncrementalGraphBatchReceipt = (
  input: string | Buffer | unknown,
  planInput: IncrementalGraphPlan,
) => normalizeBatchReceipt(parseValue(input, 'incremental_graph_batch_receipt_invalid_json'), normalizePlan(planInput));

const checkpointWithoutDigest = (checkpoint: Omit<IncrementalGraphCheckpoint, 'checkpointDigest'>) => checkpoint;

const finalizeCheckpoint = (
  checkpoint: Omit<IncrementalGraphCheckpoint, 'checkpointDigest'>,
): IncrementalGraphCheckpoint => ({
  ...checkpoint,
  checkpointDigest: incrementalGraphSha256(checkpointWithoutDigest(checkpoint)),
});

export const createIncrementalGraphCheckpoint = (planInput: IncrementalGraphPlan): IncrementalGraphCheckpoint => {
  const plan = normalizePlan(planInput);
  if (plan.mode !== 'incremental') invalid('incremental_graph_full_rebuild_required');
  return finalizeCheckpoint({
    recordType: 'case_vortex_incremental_checkpoint',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    planId: plan.planId,
    watermarkId: plan.watermark.watermarkId,
    status: plan.batches.length ? 'processing' : 'ready_to_activate',
    nextBatchOrdinal: 0,
    nextChangeOffset: 0,
    appliedChangeCount: 0,
    appliedInsertCount: 0,
    appliedUpdateCount: 0,
    appliedDeleteCount: 0,
    batchReceipts: [],
  });
};

const normalizeCheckpoint = (value: unknown, plan: IncrementalGraphPlan): IncrementalGraphCheckpoint => {
  if (!isPlainObject(value) || !Array.isArray(value.batchReceipts)) invalid('incremental_graph_checkpoint_invalid');
  if (
    value.recordType !== 'case_vortex_incremental_checkpoint'
    || value.schemaVersion !== INCREMENTAL_GRAPH_PLAN_VERSION
    || value.planId !== plan.planId
    || value.watermarkId !== plan.watermark.watermarkId
  ) invalid('incremental_graph_checkpoint_binding_mismatch');
  if (plan.mode !== 'incremental') invalid('incremental_graph_full_rebuild_required');
  const batchReceipts = value.batchReceipts.map((item, index): IncrementalGraphBatchReceiptReference => {
    if (!isPlainObject(item)) invalid('incremental_graph_checkpoint_receipt_invalid');
    const batch = plan.batches[index];
    if (
      !batch || item.ordinal !== index || item.batchId !== batch.batchId
      || typeof item.receiptId !== 'string' || !/^batch-receipt:[a-f0-9]{64}$/.test(item.receiptId)
    ) invalid('incremental_graph_checkpoint_receipt_invalid');
    return {
      ordinal: index,
      batchId: batch.batchId,
      receiptId: item.receiptId,
      transactionId: requireId(item.transactionId, 'incremental_graph_transaction_id_invalid'),
      commitProofSha256: requireSha(item.commitProofSha256, 'incremental_graph_commit_proof_invalid'),
    };
  });
  const processedBatches = plan.batches.slice(0, batchReceipts.length);
  const appliedChangeCount = processedBatches.reduce((sum, batch) => sum + batch.changeIds.length, 0);
  const appliedInsertCount = processedBatches.reduce((sum, batch) => sum + batch.insertCount, 0);
  const appliedUpdateCount = processedBatches.reduce((sum, batch) => sum + batch.updateCount, 0);
  const appliedDeleteCount = processedBatches.reduce((sum, batch) => sum + batch.deleteCount, 0);
  const expectedWithoutDigest: Omit<IncrementalGraphCheckpoint, 'checkpointDigest'> = {
    recordType: 'case_vortex_incremental_checkpoint',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    planId: plan.planId,
    watermarkId: plan.watermark.watermarkId,
    status: batchReceipts.length === plan.batches.length ? 'ready_to_activate' : 'processing',
    nextBatchOrdinal: batchReceipts.length,
    nextChangeOffset: processedBatches.at(-1)?.endOffset || 0,
    appliedChangeCount,
    appliedInsertCount,
    appliedUpdateCount,
    appliedDeleteCount,
    batchReceipts,
  };
  const expected = finalizeCheckpoint(expectedWithoutDigest);
  assertSame(value, expected, 'incremental_graph_checkpoint_receipt_mismatch');
  return expected;
};

export const decodeIncrementalGraphCheckpoint = (
  input: string | Buffer | unknown,
  planInput: IncrementalGraphPlan,
) => normalizeCheckpoint(parseValue(input, 'incremental_graph_checkpoint_invalid_json'), normalizePlan(planInput));

export const advanceIncrementalGraphCheckpoint = (params: {
  plan: IncrementalGraphPlan;
  checkpoint: IncrementalGraphCheckpoint;
  receipt: IncrementalGraphBatchReceipt;
}): IncrementalGraphCheckpoint => {
  const plan = normalizePlan(params.plan);
  const checkpoint = normalizeCheckpoint(params.checkpoint, plan);
  const receipt = normalizeBatchReceipt(params.receipt, plan);
  if (receipt.ordinal < checkpoint.nextBatchOrdinal) {
    const existing = checkpoint.batchReceipts[receipt.ordinal];
    if (
      existing?.receiptId === receipt.receiptId
      && existing.transactionId === receipt.transaction.transactionId
      && existing.commitProofSha256 === receipt.transaction.commitProofSha256
    ) return checkpoint;
    return invalid('incremental_graph_batch_replay_conflict');
  }
  if (receipt.ordinal !== checkpoint.nextBatchOrdinal) invalid('incremental_graph_batch_out_of_order');
  const batchReceipts = [...checkpoint.batchReceipts, {
    ordinal: receipt.ordinal,
    batchId: receipt.batchId,
    receiptId: receipt.receiptId,
    transactionId: receipt.transaction.transactionId,
    commitProofSha256: receipt.transaction.commitProofSha256,
  }];
  return normalizeCheckpoint(finalizeCheckpoint({
    recordType: 'case_vortex_incremental_checkpoint',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    planId: plan.planId,
    watermarkId: plan.watermark.watermarkId,
    status: batchReceipts.length === plan.batches.length ? 'ready_to_activate' : 'processing',
    nextBatchOrdinal: batchReceipts.length,
    nextChangeOffset: receipt.endOffset,
    appliedChangeCount: checkpoint.appliedChangeCount + receipt.appliedChangeCount,
    appliedInsertCount: checkpoint.appliedInsertCount + receipt.appliedInsertCount,
    appliedUpdateCount: checkpoint.appliedUpdateCount + receipt.appliedUpdateCount,
    appliedDeleteCount: checkpoint.appliedDeleteCount + receipt.appliedDeleteCount,
    batchReceipts,
  }), plan);
};

const normalizeOutputShape = (value: unknown): IncrementalGraphOutputGeneration => {
  if (!isPlainObject(value)) invalid('incremental_graph_output_invalid');
  const universe = validateIncrementalGraphUniverseBinding(value.universe);
  const relationshipInputSetSha256 = requireSha(value.relationshipInputSetSha256, 'incremental_graph_relationship_input_sha_invalid');
  const nodeAddressSetSha256 = requireSha(value.nodeAddressSetSha256, 'incremental_graph_address_set_sha_invalid');
  if (nodeAddressSetSha256 !== universe.addressSetSha256) invalid('incremental_graph_output_address_set_mismatch');
  const nodeCount = requireCount(value.nodeCount, 'incremental_graph_output_node_count_invalid');
  const connectedNodeCount = requireCount(value.connectedNodeCount, 'incremental_graph_output_node_count_invalid');
  const isolatedNodeCount = requireCount(value.isolatedNodeCount, 'incremental_graph_output_node_count_invalid');
  const edgeCount = requireCount(value.edgeCount, 'incremental_graph_output_edge_count_invalid');
  if (nodeCount !== universe.recordCount || connectedNodeCount + isolatedNodeCount !== nodeCount) {
    invalid('incremental_graph_output_accounting_invalid');
  }
  return {
    universe,
    relationshipInputSetSha256,
    graphArchiveSetSha256: requireSha(value.graphArchiveSetSha256, 'incremental_graph_archive_sha_invalid'),
    graphManifestSha256: requireSha(value.graphManifestSha256, 'incremental_graph_manifest_sha_invalid'),
    incidentIndexRootSha256: requireSha(value.incidentIndexRootSha256, 'incremental_graph_incident_index_sha_invalid'),
    nodeAddressSetSha256,
    nodeCount,
    connectedNodeCount,
    isolatedNodeCount,
    edgeCount,
  };
};

const normalizeOutput = (
  value: unknown,
  plan: IncrementalGraphPlan,
): IncrementalGraphOutputGeneration => {
  const output = normalizeOutputShape(value);
  assertSame(output.universe, plan.watermark.target, 'incremental_graph_output_snapshot_mismatch');
  if (output.relationshipInputSetSha256 !== plan.watermark.targetRelationshipInputSetSha256) {
    invalid('incremental_graph_output_relationship_input_mismatch');
  }
  return output;
};

const receiptSetSha = (receipts: readonly IncrementalGraphBatchReceiptReference[]) => setSha(
  'case-vortex-batch-receipt-set-v1',
  receipts.map((receipt) => `${receipt.ordinal}:${receipt.receiptId}:${receipt.commitProofSha256}`),
);

export const buildIncrementalGraphActivationIntent = (params: {
  plan: IncrementalGraphPlan;
  checkpoint: IncrementalGraphCheckpoint;
  output: IncrementalGraphOutputGeneration;
}): IncrementalGraphActivationIntent => {
  const plan = normalizePlan(params.plan);
  const checkpoint = normalizeCheckpoint(params.checkpoint, plan);
  if (
    checkpoint.status !== 'ready_to_activate'
    || checkpoint.appliedChangeCount !== plan.accounting.changeCount
    || checkpoint.appliedInsertCount !== plan.accounting.insertCount
    || checkpoint.appliedUpdateCount !== plan.accounting.updateCount
    || checkpoint.appliedDeleteCount !== plan.accounting.deleteCount
  ) invalid('incremental_graph_checkpoint_incomplete');
  const output = normalizeOutput(params.output, plan);
  const withoutId = {
    recordType: 'case_vortex_incremental_activation_intent',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    planId: plan.planId,
    watermarkId: plan.watermark.watermarkId,
    checkpointDigest: checkpoint.checkpointDigest,
    batchReceiptSetSha256: receiptSetSha(checkpoint.batchReceipts),
    expectedPreviousActivationId: plan.baseGeneration.activationId,
    expectedPreviousGraphArchiveSetSha256: plan.baseGeneration.graphArchiveSetSha256,
    output,
  } as const;
  return { ...withoutId, activationId: `activation:${incrementalGraphSha256(withoutId)}` };
};

const normalizeActivationIntent = (value: unknown): IncrementalGraphActivationIntent => {
  if (!isPlainObject(value)) invalid('incremental_graph_activation_intent_invalid');
  if (
    value.recordType !== 'case_vortex_incremental_activation_intent'
    || value.schemaVersion !== INCREMENTAL_GRAPH_PLAN_VERSION
    || typeof value.planId !== 'string' || !/^plan:[a-f0-9]{64}$/.test(value.planId)
    || typeof value.watermarkId !== 'string' || !/^watermark:[a-f0-9]{64}$/.test(value.watermarkId)
    || typeof value.activationId !== 'string' || !/^activation:[a-f0-9]{64}$/.test(value.activationId)
  ) invalid('incremental_graph_activation_intent_invalid');
  const withoutId = {
    recordType: 'case_vortex_incremental_activation_intent',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    planId: value.planId,
    watermarkId: value.watermarkId,
    checkpointDigest: requireSha(value.checkpointDigest, 'incremental_graph_checkpoint_digest_invalid'),
    batchReceiptSetSha256: requireSha(value.batchReceiptSetSha256, 'incremental_graph_batch_receipt_set_sha_invalid'),
    expectedPreviousActivationId: requireId(value.expectedPreviousActivationId, 'incremental_graph_activation_id_invalid'),
    expectedPreviousGraphArchiveSetSha256: requireSha(
      value.expectedPreviousGraphArchiveSetSha256,
      'incremental_graph_archive_sha_invalid',
    ),
    output: normalizeOutputShape(value.output),
  } as const;
  const normalized = { ...withoutId, activationId: `activation:${incrementalGraphSha256(withoutId)}` };
  assertSame(value, normalized, 'incremental_graph_activation_intent_digest_mismatch');
  return normalized;
};

const normalizeActivationTransaction = (
  value: unknown,
  intent: IncrementalGraphActivationIntent,
): IncrementalGraphActivationTransaction => {
  if (!isPlainObject(value)) invalid('incremental_graph_activation_transaction_invalid');
  if (
    value.isolationLevel !== 'serializable'
    || value.compareAndSwap !== 'active_activation_and_graph_archive'
    || value.idempotencyKey !== intent.activationId
    || value.expectedPreviousActivationId !== intent.expectedPreviousActivationId
    || value.observedPreviousActivationId !== intent.expectedPreviousActivationId
    || value.expectedPreviousGraphArchiveSetSha256 !== intent.expectedPreviousGraphArchiveSetSha256
    || value.observedPreviousGraphArchiveSetSha256 !== intent.expectedPreviousGraphArchiveSetSha256
    || value.committedActivationId !== intent.activationId
    || value.committed !== true
  ) invalid('incremental_graph_activation_compare_and_swap_invalid');
  return {
    isolationLevel: 'serializable',
    compareAndSwap: 'active_activation_and_graph_archive',
    idempotencyKey: intent.activationId,
    expectedPreviousActivationId: intent.expectedPreviousActivationId,
    observedPreviousActivationId: intent.expectedPreviousActivationId,
    expectedPreviousGraphArchiveSetSha256: intent.expectedPreviousGraphArchiveSetSha256,
    observedPreviousGraphArchiveSetSha256: intent.expectedPreviousGraphArchiveSetSha256,
    committedActivationId: intent.activationId,
    transactionId: requireId(value.transactionId, 'incremental_graph_transaction_id_invalid'),
    commitToken: requireString(value.commitToken, 'incremental_graph_commit_token_invalid', 4_096),
    committedAt: requireIso(value.committedAt, 'incremental_graph_commit_timestamp_invalid'),
    commitProofSha256: requireSha(value.commitProofSha256, 'incremental_graph_commit_proof_invalid'),
    committed: true,
  };
};

export const buildIncrementalGraphActivationReceipt = (params: {
  intent: IncrementalGraphActivationIntent;
  transaction: IncrementalGraphActivationTransaction;
}): IncrementalGraphActivationReceipt => {
  const intent = normalizeActivationIntent(params.intent);
  const transaction = normalizeActivationTransaction(params.transaction, intent);
  const withoutReceiptId = {
    recordType: 'case_vortex_incremental_activation_receipt',
    schemaVersion: INCREMENTAL_GRAPH_PLAN_VERSION,
    intent,
    transaction,
  } as const;
  return { ...withoutReceiptId, receiptId: `activation-receipt:${incrementalGraphSha256(withoutReceiptId)}` };
};

export const decodeIncrementalGraphActivationReceipt = (
  input: string | Buffer | unknown,
  context?: { plan: IncrementalGraphPlan; checkpoint: IncrementalGraphCheckpoint },
): IncrementalGraphActivationReceipt => {
  const value = parseValue(input, 'incremental_graph_activation_receipt_invalid_json');
  if (!isPlainObject(value)) invalid('incremental_graph_activation_receipt_invalid');
  const rebuilt = buildIncrementalGraphActivationReceipt({
    intent: value.intent as IncrementalGraphActivationIntent,
    transaction: value.transaction as IncrementalGraphActivationTransaction,
  });
  if (context) {
    const expectedIntent = buildIncrementalGraphActivationIntent({
      plan: context.plan,
      checkpoint: context.checkpoint,
      output: rebuilt.intent.output,
    });
    assertSame(rebuilt.intent, expectedIntent, 'incremental_graph_activation_intent_binding_mismatch');
  }
  assertSame(value, rebuilt, 'incremental_graph_activation_receipt_mismatch');
  return rebuilt;
};

export const classifyIncrementalGraphActivationReceipt = (
  existingInput: IncrementalGraphActivationReceipt,
  candidateInput: IncrementalGraphActivationReceipt,
): 'replay' => {
  const existing = decodeIncrementalGraphActivationReceipt(existingInput);
  const candidate = decodeIncrementalGraphActivationReceipt(candidateInput);
  if (
    existing.intent.output.universe.snapshotId !== candidate.intent.output.universe.snapshotId
    || existing.intent.activationId !== candidate.intent.activationId
    || canonicalizeIncrementalGraph(existing) !== canonicalizeIncrementalGraph(candidate)
  ) invalid('incremental_graph_activation_replay_conflict');
  return 'replay';
};
