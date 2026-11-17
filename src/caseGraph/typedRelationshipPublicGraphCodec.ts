import { gunzipSync, gzipSync } from 'node:zlib';

import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  type EvidenceUniverseNode,
} from './evidenceUniverse';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  canonicalizeRelationshipInput,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  decodeTypedRelationshipEdge,
  decodeTypedRelationshipPairEvaluation,
  type TypedRelationshipEdgeType,
} from './typedRelationshipEngine';
import {
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  FULL_CORPUS_TYPED_EDGE_TYPES,
  fullCorpusRelationshipArtifactSha256,
  fullCorpusRelationshipShard,
  type FullCorpusAddressKind,
  type FullCorpusCandidateReason,
  type FullCorpusPipelineLineage,
} from './typedRelationshipPipeline';
import {
  FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
  decodeFullCorpusRelationshipRunIndexPointer,
} from './typedRelationshipPipelineArchive';
import {
  PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION,
  PUBLIC_TYPED_RELATIONSHIP_GRAPH_CLAIM_DISCIPLINE,
  PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD,
  type FullCorpusPublicEdge,
  type FullCorpusPublicEgo,
  type FullCorpusPublicEvaluationReceipt,
  type FullCorpusPublicGraphArchiveObject,
  type FullCorpusPublicGraphArchiveReceipt,
  type FullCorpusPublicGraphArchiveWriteResult,
  type FullCorpusPublicGraphArtifacts,
  type FullCorpusPublicGraphManifest,
  type FullCorpusPublicGraphShard,
  type FullCorpusPublicGraphShardKind,
  type FullCorpusPublicGraphShardSummary,
  type FullCorpusPublicNode,
  type FullCorpusPublicRelationshipStatus,
  type FullCorpusPublicStatusReceipt,
  type FullCorpusPublicRenderPackingReceipt,
  type FullCorpusPublicRenderRow,
  ARCHIVE_RECEIPT_KEYS,
  BINDING_KEYS,
  compareText,
  CONTEXTUAL_COMPLETION_BINDING_KEYS,
  digestValue,
  EDGE_KEYS,
  emptyEdgeTypeCounts,
  EGO_KEYS,
  EVALUATION_KEYS,
  invalid,
  itemDigest,
  itemKey,
  LINEAGE_KEYS,
  MANIFEST_KEYS,
  NODE_KEYS,
  publicGraphArchivePrefix,
  rawSha256,
  RENDER_ROW_KEYS,
  requireExactKeys,
  safeCount,
  SHA256_PATTERN,
  SHARD_KEYS,
  SHARD_KINDS,
  shardSummary,
  SHARD_SUMMARY_KEYS,
  STATUS_RECEIPT_KEYS,
  validateContextualCompletionBinding,
  validateExactCounts,
  validatePublicLineage,
  validateSortedStrings,
  validateUniverseNode,
  withoutField,
} from './typedRelationshipPublicGraph';

const UINT32_MAX = 0xffff_ffff;
const UINT16_MAX = 0xffff;
const PACKED_RENDER_FIXED_BYTES_PER_ROW = 30;

export const fullCorpusPublicRenderTimestamp = (eventTimestamp: string | null): number => {
  if (eventTimestamp === null) return Number.NaN;
  const epochMilliseconds = Date.parse(eventTimestamp);
  if (!Number.isFinite(epochMilliseconds)) invalid('full_corpus_public_graph_render_timestamp_invalid');
  const fraction = eventTimestamp.match(/\.(\d+)Z$/)?.[1] || '';
  const subMillisecondDigits = fraction.slice(3);
  return epochMilliseconds + (subMillisecondDigits ? Number(`0.${subMillisecondDigits}`) : 0);
};

/**
 * Reproduces the browser's bounded packing receipt without retaining JS row
 * objects. Addresses stay bytewise sorted inside their hash shard, offsets
 * address the UTF-8 pool, and every LOD contains ascending row indices only.
 */
export const buildFullCorpusPublicRenderPackingReceipt = (
  rows: readonly FullCorpusPublicRenderRow[],
): FullCorpusPublicRenderPackingReceipt => {
  if (rows.length > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD) {
    invalid('full_corpus_public_graph_render_shard_row_limit_exceeded');
  }
  let previousAddress = '';
  let addressUtf8Bytes = 0;
  for (const rowInput of rows) {
    const row = validatePublicRenderRow(rowInput);
    if (previousAddress && previousAddress >= row.address) {
      invalid('full_corpus_public_graph_render_address_order_invalid');
    }
    previousAddress = row.address;
    fullCorpusPublicRenderTimestamp(row.eventTimestamp);
    addressUtf8Bytes += Buffer.byteLength(row.address, 'utf8');
    if (addressUtf8Bytes > UINT32_MAX) {
      invalid('full_corpus_public_graph_render_address_bytes_exceeded');
    }
  }
  const addressOffsetBody = Buffer.allocUnsafe((rows.length + 1) * 4);
  const addressBody = Buffer.allocUnsafe(addressUtf8Bytes);
  let addressOffset = 0;
  addressOffsetBody.writeUInt32LE(0, 0);
  for (let index = 0; index < rows.length; index += 1) {
    addressOffset += addressBody.write(rows[index].address, addressOffset, 'utf8');
    addressOffsetBody.writeUInt32LE(addressOffset, (index + 1) * 4);
  }
  if (addressOffset !== addressUtf8Bytes) {
    invalid('full_corpus_public_graph_render_address_bytes_mismatch');
  }
  const addressLookupSha256 = rawSha256(Buffer.concat([addressOffsetBody, addressBody]));

  const lodIndexBytes = PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY.levels.reduce((sum, { stride }) => (
    sum + 8 + (rows.length ? Math.floor((rows.length - 1) / stride) + 1 : 0) * 2
  ), 0);
  const lodBody = Buffer.allocUnsafe(lodIndexBytes);
  let lodOffset = 0;
  for (const { level, stride } of PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY.levels) {
    const count = rows.length ? Math.floor((rows.length - 1) / stride) + 1 : 0;
    lodBody.writeUInt32LE(level, lodOffset);
    lodBody.writeUInt32LE(count, lodOffset + 4);
    lodOffset += 8;
    for (let index = 0; index < rows.length; index += stride) {
      if (index > UINT16_MAX) invalid('full_corpus_public_graph_render_lod_invalid');
      lodBody.writeUInt16LE(index, lodOffset);
      lodOffset += 2;
    }
  }
  if (lodOffset !== lodIndexBytes) invalid('full_corpus_public_graph_render_lod_invalid');
  const packedBytes = addressOffsetBody.length + addressBody.length
    + rows.length * PACKED_RENDER_FIXED_BYTES_PER_ROW;
  if (!Number.isSafeInteger(packedBytes)) invalid('full_corpus_public_graph_render_packed_bytes_exceeded');
  return {
    rowCount: rows.length,
    addressLookupSha256,
    lodIndexSha256: rawSha256(lodBody),
    addressUtf8Bytes,
    packedBytes,
    lodIndexBytes,
  };
};

const validateStatusReceipt = (
  value: unknown,
  address: string,
  recordDigest: string,
  status: FullCorpusPublicRelationshipStatus,
): FullCorpusPublicStatusReceipt => {
  const receipt = requireExactKeys(value, STATUS_RECEIPT_KEYS, 'full_corpus_public_graph_status_receipt_invalid');
  const edgeIds = validateSortedStrings(receipt.edgeIds, 'full_corpus_public_graph_status_receipt_invalid');
  const evaluationIds = validateSortedStrings(
    receipt.candidateEvaluationIds,
    'full_corpus_public_graph_status_receipt_invalid',
  );
  const skippedIds = validateSortedStrings(
    receipt.skippedGroupReceiptIds,
    'full_corpus_public_graph_status_receipt_invalid',
  );
  const expectedDecision = status === 'linked'
    ? 'typed_edge_emitted'
    : status === 'candidate_only' ? 'evaluated_no_edge' : 'no_bounded_candidate_route';
  if (
    receipt.recordType !== 'full_corpus_public_status_receipt'
    || receipt.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || receipt.address !== address
    || receipt.relationshipInputRecordDigest !== recordDigest
    || receipt.relationshipStatus !== status
    || receipt.decisionCode !== expectedDecision
    || typeof receipt.plainEnglish !== 'string' || !receipt.plainEnglish.length
    || typeof receipt.receiptDigest !== 'string' || !SHA256_PATTERN.test(receipt.receiptDigest)
    || edgeIds.some((id) => !/^typed-edge:[a-f0-9]{64}$/.test(id))
    || evaluationIds.some((id) => !/^public-evaluation:[a-f0-9]{64}$/.test(id))
    || skippedIds.some((id) => !/^skip:[a-f0-9]{64}$/.test(id))
    || (status === 'linked' && edgeIds.length === 0)
    || (status === 'candidate_only' && (edgeIds.length !== 0 || evaluationIds.length === 0))
    || (status === 'isolated' && (edgeIds.length !== 0 || evaluationIds.length !== 0))
  ) invalid('full_corpus_public_graph_status_receipt_invalid');
  const { receiptDigest, ...withoutDigest } = receipt;
  if (receiptDigest !== digestValue(withoutDigest)) invalid('full_corpus_public_graph_status_receipt_digest_mismatch');
  return receipt as unknown as FullCorpusPublicStatusReceipt;
};

const validatePublicNode = (value: unknown): FullCorpusPublicNode => {
  const node = requireExactKeys(value, NODE_KEYS, 'full_corpus_public_graph_node_invalid');
  if (
    node.recordType !== 'full_corpus_public_node'
    || node.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || node.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || node.universeSchemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || node.universeLayoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || typeof node.address !== 'string'
    || !['sighting', 'document', 'photo', 'video'].includes(String(node.kind))
    || typeof node.recordId !== 'string'
    || typeof node.relationshipInputRecordDigest !== 'string'
    || !SHA256_PATTERN.test(node.relationshipInputRecordDigest)
    || !['linked', 'candidate_only', 'isolated'].includes(String(node.relationshipStatus))
    || !Array.isArray(node.position) || node.position.length !== 3 || node.position.some((item) => !Number.isFinite(item))
    || typeof node.nodeDigest !== 'string' || !SHA256_PATTERN.test(node.nodeDigest)
  ) invalid('full_corpus_public_graph_node_invalid');
  const degree = safeCount(node.degree, 'full_corpus_public_graph_node_invalid');
  const neighbourCount = safeCount(node.neighbourCount, 'full_corpus_public_graph_node_invalid');
  const evaluationCount = safeCount(node.candidateEvaluationCount, 'full_corpus_public_graph_node_invalid');
  if (neighbourCount > degree) invalid('full_corpus_public_graph_node_invalid');
  const edgeTypeCounts = validateExactCounts(
    node.edgeTypeCounts,
    FULL_CORPUS_TYPED_EDGE_TYPES,
    'full_corpus_public_graph_node_edge_type_counts_invalid',
  );
  if (Object.values(edgeTypeCounts).reduce((sum, count) => sum + count, 0) !== degree) {
    invalid('full_corpus_public_graph_node_degree_mismatch');
  }
  const status = node.relationshipStatus as FullCorpusPublicRelationshipStatus;
  const statusReceipt = validateStatusReceipt(
    node.statusReceipt,
    node.address,
    node.relationshipInputRecordDigest,
    status,
  );
  if (statusReceipt.edgeIds.length !== degree || statusReceipt.candidateEvaluationIds.length !== evaluationCount) {
    invalid('full_corpus_public_graph_node_status_accounting_mismatch');
  }
  const projected = validateUniverseNode({
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    address: node.address,
    kind: node.kind as FullCorpusAddressKind,
    recordId: node.recordId,
    source: node.source as string,
    sourceRecordId: node.sourceRecordId as string | null,
    title: node.title as string | null,
    summary: node.summary as string | null,
    canonicalUrl: node.canonicalUrl as string | null,
    previewUrl: node.previewUrl as string | null,
    eventTimestamp: node.eventTimestamp as string | null,
    lat: node.lat as number | null,
    lon: node.lon as number | null,
    location: node.location as string | null,
    countryCode: node.countryCode as string | null,
    linkedSightingId: node.linkedSightingId as string | null,
    updatedAt: node.updatedAt as string,
    position: node.position as [number, number, number],
  });
  const universeFields = {
    address: node.address, kind: node.kind, recordId: node.recordId, source: node.source,
    sourceRecordId: node.sourceRecordId, title: node.title, summary: node.summary,
    canonicalUrl: node.canonicalUrl, previewUrl: node.previewUrl,
    eventTimestamp: node.eventTimestamp, lat: node.lat, lon: node.lon, location: node.location,
    countryCode: node.countryCode, linkedSightingId: node.linkedSightingId,
    updatedAt: node.updatedAt, position: node.position,
  };
  const projectedFields = {
    address: projected.address, kind: projected.kind, recordId: projected.recordId, source: projected.source,
    sourceRecordId: projected.sourceRecordId, title: projected.title, summary: projected.summary,
    canonicalUrl: projected.canonicalUrl, previewUrl: projected.previewUrl,
    eventTimestamp: projected.eventTimestamp, lat: projected.lat, lon: projected.lon, location: projected.location,
    countryCode: projected.countryCode, linkedSightingId: projected.linkedSightingId,
    updatedAt: projected.updatedAt, position: projected.position,
  };
  if (canonicalizeRelationshipInput(universeFields) !== canonicalizeRelationshipInput(projectedFields)) {
    invalid('full_corpus_public_graph_node_universe_projection_mismatch');
  }
  const { nodeDigest, ...withoutDigest } = node;
  if (nodeDigest !== digestValue(withoutDigest)) invalid('full_corpus_public_graph_item_digest_mismatch');
  return { ...node, edgeTypeCounts, statusReceipt } as unknown as FullCorpusPublicNode;
};

const validatePublicRenderRow = (value: unknown): FullCorpusPublicRenderRow => {
  const row = requireExactKeys(value, RENDER_ROW_KEYS, 'full_corpus_public_graph_render_row_invalid');
  if (
    typeof row.address !== 'string' || !row.address.length
    || !['sighting', 'document', 'photo', 'video'].includes(String(row.kind))
    || !row.address.startsWith(`${String(row.kind)}:`)
    || (row.eventTimestamp !== null && (
      typeof row.eventTimestamp !== 'string'
      || !Number.isFinite(Date.parse(row.eventTimestamp))
    ))
    || !Array.isArray(row.position) || row.position.length !== 3
    || row.position.some((coordinate) => !Number.isFinite(coordinate))
    || !['linked', 'candidate_only', 'isolated'].includes(String(row.relationshipStatus))
  ) invalid('full_corpus_public_graph_render_row_invalid');
  safeCount(row.degree, 'full_corpus_public_graph_render_row_invalid');
  safeCount(row.nodeShard, 'full_corpus_public_graph_render_row_invalid');
  safeCount(row.egoShard, 'full_corpus_public_graph_render_row_invalid');
  if (Number(row.degree) > UINT32_MAX
    || Number(row.nodeShard) > UINT16_MAX
    || Number(row.egoShard) > UINT16_MAX) {
    invalid('full_corpus_public_graph_render_row_invalid');
  }
  return row as unknown as FullCorpusPublicRenderRow;
};

const validatePublicEdge = (value: unknown, lineage: FullCorpusPipelineLineage): FullCorpusPublicEdge => {
  const edge = requireExactKeys(value, EDGE_KEYS, 'full_corpus_public_graph_edge_invalid');
  if (
    edge.recordType !== 'full_corpus_public_edge'
    || edge.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || edge.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || typeof edge.edgeDigest !== 'string' || !SHA256_PATTERN.test(edge.edgeDigest)
  ) invalid('full_corpus_public_graph_edge_invalid');
  const typedEdge = decodeTypedRelationshipEdge({
    recordType: 'typed_relationship_edge',
    schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    edgeId: edge.edgeId,
    binding: lineage.binding,
    edgeType: edge.edgeType,
    endpoints: edge.endpoints,
    strength: edge.strength,
    receipt: edge.receipt,
  }, lineage.binding);
  const { edgeDigest, ...withoutDigest } = edge;
  if (edgeDigest !== digestValue(withoutDigest)) invalid('full_corpus_public_graph_item_digest_mismatch');
  return {
    ...edge,
    edgeId: typedEdge.edgeId,
    edgeType: typedEdge.edgeType,
    endpoints: typedEdge.endpoints,
    strength: typedEdge.strength,
    receipt: typedEdge.receipt,
  } as unknown as FullCorpusPublicEdge;
};

const validateCandidateReason = (value: unknown): FullCorpusCandidateReason => {
  const reason = requireExactKeys(
    value,
    ['reasonId', 'code', 'routeSignature', 'evidenceIds', 'plainEnglish'],
    'full_corpus_public_graph_candidate_reason_invalid',
  );
  const evidenceIds = validateSortedStrings(reason.evidenceIds, 'full_corpus_public_graph_candidate_reason_invalid');
  if (
    typeof reason.reasonId !== 'string' || !/^candidate-reason:[a-f0-9]{64}$/.test(reason.reasonId)
    || typeof reason.code !== 'string'
    || typeof reason.routeSignature !== 'string' || !/^route:[a-z_]+:[a-f0-9]{64}$/.test(reason.routeSignature)
    || typeof reason.plainEnglish !== 'string' || !reason.plainEnglish.length
  ) invalid('full_corpus_public_graph_candidate_reason_invalid');
  const withoutId = {
    code: reason.code,
    routeSignature: reason.routeSignature,
    evidenceIds,
    plainEnglish: reason.plainEnglish,
  };
  if (reason.reasonId !== `candidate-reason:${digestValue(withoutId)}`) {
    invalid('full_corpus_public_graph_candidate_reason_digest_mismatch');
  }
  return { ...reason, evidenceIds } as unknown as FullCorpusCandidateReason;
};

const validatePublicEvaluation = (
  value: unknown,
  lineage: FullCorpusPipelineLineage,
): FullCorpusPublicEvaluationReceipt => {
  const receipt = requireExactKeys(value, EVALUATION_KEYS, 'full_corpus_public_graph_evaluation_invalid');
  if (
    receipt.recordType !== 'full_corpus_public_evaluation_receipt'
    || receipt.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || !Array.isArray(receipt.addresses) || receipt.addresses.length !== 2
    || !Array.isArray(receipt.candidateReasons) || !receipt.candidateReasons.length
    || typeof receipt.plainEnglish !== 'string' || !receipt.plainEnglish.length
    || typeof receipt.receiptDigest !== 'string' || !SHA256_PATTERN.test(receipt.receiptDigest)
  ) invalid('full_corpus_public_graph_evaluation_invalid');
  const evaluation = decodeTypedRelationshipPairEvaluation(receipt.evaluation, lineage.binding);
  const addresses = [...evaluation.addresses].sort(compareText) as [string, string];
  if (
    canonicalizeRelationshipInput(receipt.addresses) !== canonicalizeRelationshipInput(addresses)
    || receipt.evaluationId !== `public-evaluation:${evaluation.evaluationDigest}`
  ) invalid('full_corpus_public_graph_evaluation_binding_mismatch');
  const reasons = receipt.candidateReasons.map(validateCandidateReason)
    .sort((left, right) => compareText(left.reasonId, right.reasonId));
  if (canonicalizeRelationshipInput(reasons) !== canonicalizeRelationshipInput(receipt.candidateReasons)) {
    invalid('full_corpus_public_graph_candidate_reason_order_invalid');
  }
  const emittedEdgeIds = validateSortedStrings(
    receipt.emittedEdgeIds,
    'full_corpus_public_graph_evaluation_invalid',
  );
  if (canonicalizeRelationshipInput(emittedEdgeIds)
    !== canonicalizeRelationshipInput(evaluation.edges.map((edge) => edge.edgeId).sort(compareText))) {
    invalid('full_corpus_public_graph_evaluation_edge_set_mismatch');
  }
  const { receiptDigest, ...withoutDigest } = receipt;
  if (receiptDigest !== digestValue(withoutDigest)) invalid('full_corpus_public_graph_item_digest_mismatch');
  return {
    ...receipt,
    addresses,
    candidateReasons: reasons,
    emittedEdgeIds,
    evaluation,
  } as unknown as FullCorpusPublicEvaluationReceipt;
};

const validatePublicEgo = (value: unknown): FullCorpusPublicEgo => {
  const ego = requireExactKeys(value, EGO_KEYS, 'full_corpus_public_graph_ego_invalid');
  if (
    ego.recordType !== 'full_corpus_public_ego'
    || ego.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || typeof ego.address !== 'string'
    || typeof ego.nodeDigest !== 'string' || !SHA256_PATTERN.test(ego.nodeDigest)
    || !['linked', 'candidate_only', 'isolated'].includes(String(ego.relationshipStatus))
    || typeof ego.statusReceiptDigest !== 'string' || !SHA256_PATTERN.test(ego.statusReceiptDigest)
    || !Array.isArray(ego.edgeReferences)
    || typeof ego.egoDigest !== 'string' || !SHA256_PATTERN.test(ego.egoDigest)
  ) invalid('full_corpus_public_graph_ego_invalid');
  let previousEdge = '';
  for (const referenceValue of ego.edgeReferences) {
    const reference = requireExactKeys(
      referenceValue,
      ['edgeId', 'edgeType', 'strength', 'receiptId', 'otherEndpoints'],
      'full_corpus_public_graph_ego_edge_reference_invalid',
    );
    if (
      typeof reference.edgeId !== 'string' || !/^typed-edge:[a-f0-9]{64}$/.test(reference.edgeId)
      || !FULL_CORPUS_TYPED_EDGE_TYPES.includes(reference.edgeType as TypedRelationshipEdgeType)
      || !Number.isSafeInteger(reference.strength) || Number(reference.strength) < 0 || Number(reference.strength) > 100
      || typeof reference.receiptId !== 'string' || !/^typed-receipt:[a-f0-9]{64}$/.test(reference.receiptId)
      || !Array.isArray(reference.otherEndpoints)
      || (previousEdge && previousEdge >= reference.edgeId)
    ) invalid('full_corpus_public_graph_ego_edge_reference_invalid');
    previousEdge = reference.edgeId;
    for (const endpoint of reference.otherEndpoints) {
      const endpointValue = requireExactKeys(endpoint, ['kind', 'id'], 'full_corpus_public_graph_ego_endpoint_invalid');
      if (!['evidence', 'context'].includes(String(endpointValue.kind))
        || typeof endpointValue.id !== 'string' || !endpointValue.id.length) {
        invalid('full_corpus_public_graph_ego_endpoint_invalid');
      }
    }
  }
  validateSortedStrings(ego.evaluationReceiptIds, 'full_corpus_public_graph_ego_invalid');
  const { egoDigest, ...withoutDigest } = ego;
  if (egoDigest !== digestValue(withoutDigest)) invalid('full_corpus_public_graph_item_digest_mismatch');
  return ego as unknown as FullCorpusPublicEgo;
};

const validateItem = (
  item: unknown,
  shardKind: FullCorpusPublicGraphShardKind,
  lineage: FullCorpusPipelineLineage,
) => {
  switch (shardKind) {
    case 'render': return validatePublicRenderRow(item);
    case 'node': return validatePublicNode(item);
    case 'edge': return validatePublicEdge(item, lineage);
    case 'evaluation': return validatePublicEvaluation(item, lineage);
    case 'ego': return validatePublicEgo(item);
  }
};

export const decodeFullCorpusPublicGraphShard = (
  input: Buffer | string | unknown,
  expected?: { lineage: FullCorpusPipelineLineage; completionDigest: string; runIndexPointerDigest: string },
): FullCorpusPublicGraphShard => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      invalid('full_corpus_public_graph_shard_json_invalid');
    }
  }
  const rawShard = requireExactKeys(value, SHARD_KEYS, 'full_corpus_public_graph_shard_invalid');
  const lineage = validatePublicLineage(rawShard.lineage);
  const shard = { ...rawShard, lineage } as unknown as FullCorpusPublicGraphShard;
  if (
    shard.recordType !== 'full_corpus_public_graph_shard'
    || shard.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || !SHARD_KINDS.includes(shard.shardKind)
    || !Number.isSafeInteger(shard.shard) || shard.shard < 0
    || !Number.isSafeInteger(shard.shardCount) || shard.shardCount < 1 || shard.shardCount > 4096
    || shard.shard >= shard.shardCount
    || !Array.isArray(shard.items)
    || shard.itemCount !== shard.items.length
    || !SHA256_PATTERN.test(shard.completionDigest)
    || !SHA256_PATTERN.test(shard.runIndexPointerDigest)
    || !SHA256_PATTERN.test(shard.itemSetSha256)
    || !SHA256_PATTERN.test(shard.shardDigest)
    || (shard.shardKind === 'render'
      && shard.itemCount > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD)
  ) invalid('full_corpus_public_graph_shard_invalid');
  if (expected && (
    canonicalizeRelationshipInput(shard.lineage) !== canonicalizeRelationshipInput(expected.lineage)
    || shard.completionDigest !== expected.completionDigest
    || shard.runIndexPointerDigest !== expected.runIndexPointerDigest
  )) invalid('full_corpus_public_graph_shard_lineage_mismatch');
  let previous = '';
  const items = shard.items.map((item) => validateItem(item, shard.shardKind, lineage));
  if (canonicalizeRelationshipInput(items) !== canonicalizeRelationshipInput(shard.items)) {
    invalid('full_corpus_public_graph_shard_item_noncanonical');
  }
  for (const item of items) {
    const key = itemKey(item);
    if ((previous && previous >= key) || fullCorpusRelationshipShard(key, shard.shardCount) !== shard.shard) {
      invalid('full_corpus_public_graph_shard_item_order_invalid');
    }
    previous = key;
  }
  if (
    shard.firstKey !== (shard.items.length ? itemKey(shard.items[0]) : null)
    || shard.lastKey !== (shard.items.length ? itemKey(shard.items[shard.items.length - 1]) : null)
    || shard.itemSetSha256 !== digestValue(shard.items.map((item) => `${itemKey(item)}:${itemDigest(item)}`).join('\n'))
    || shard.shardDigest !== digestValue(withoutField(shard as unknown as Record<string, unknown>, 'shardDigest'))
  ) invalid('full_corpus_public_graph_shard_integrity_mismatch');
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    const raw = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    const canonical = canonicalizeRelationshipInput(shard);
    if (raw !== canonical && raw !== `${canonical}\n`) invalid('full_corpus_public_graph_shard_noncanonical');
  }
  return { ...shard, items };
};

export const decodeFullCorpusPublicGraphManifest = (
  input: Buffer | string | unknown,
): FullCorpusPublicGraphManifest => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      invalid('full_corpus_public_graph_manifest_json_invalid');
    }
  }
  const rawManifest = requireExactKeys(value, MANIFEST_KEYS, 'full_corpus_public_graph_manifest_invalid');
  const lineage = validatePublicLineage(rawManifest.lineage);
  const runIndexPointer = decodeFullCorpusRelationshipRunIndexPointer(rawManifest.runIndexPointer, lineage);
  const contextualRelationshipCompletion = validateContextualCompletionBinding(
    rawManifest.contextualRelationshipCompletion,
  );
  const manifest = {
    ...rawManifest,
    lineage,
    runIndexPointer,
    contextualRelationshipCompletion,
  } as unknown as FullCorpusPublicGraphManifest;
  const contextualRunReference = runIndexPointer.contextualCompletion;
  if (
    manifest.recordType !== 'full_corpus_public_graph_manifest'
    || manifest.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION
    || manifest.archiveVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION
    || manifest.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION
    || manifest.pipelineArchiveVersion !== FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION
    || !Array.isArray(manifest.shards)
    || !SHA256_PATTERN.test(manifest.completionDigest)
    || runIndexPointer.completionDigest !== manifest.completionDigest
    || contextualRelationshipCompletion.completionId !== contextualRunReference.completionId
    || contextualRelationshipCompletion.completionDigest !== contextualRunReference.completionDigest
    || contextualRelationshipCompletion.sourceCompletionSetSha256
      !== contextualRunReference.sourceCompletionSetSha256
    || contextualRelationshipCompletion.entrySetSha256 !== contextualRunReference.entrySetSha256
    || contextualRelationshipCompletion.calibrationReceiptId
      !== contextualRunReference.calibrationReceiptId
    || contextualRelationshipCompletion.calibrationReceiptSha256
      !== contextualRunReference.calibrationReceiptSha256
    || contextualRelationshipCompletion.accounting.sourceSnapshotCount
      !== contextualRunReference.sourceSnapshotCount
    || contextualRelationshipCompletion.accounting.sourceRecordCount
      !== contextualRunReference.sourceRecordCount
    || contextualRelationshipCompletion.accounting.acceptedEdgeCount
      !== contextualRunReference.acceptedEdgeCount
    || contextualRelationshipCompletion.accounting.insufficientEvidenceCount
      !== contextualRunReference.insufficientEvidenceCount
    || contextualRelationshipCompletion.zeroObservationState
      !== contextualRunReference.zeroObservationState
    || !SHA256_PATTERN.test(manifest.manifestDigest)
  ) invalid('full_corpus_public_graph_manifest_invalid');
  const universeNodeCount = safeCount(manifest.universeNodeCount, 'full_corpus_public_graph_manifest_invalid');
  const renderRowCount = safeCount(manifest.renderRowCount, 'full_corpus_public_graph_manifest_invalid');
  const renderUncompressedBytes = safeCount(
    manifest.renderUncompressedBytes,
    'full_corpus_public_graph_manifest_invalid',
  );
  const renderCompressedBytes = safeCount(
    manifest.renderCompressedBytes,
    'full_corpus_public_graph_manifest_invalid',
  );
  const renderAddressUtf8Bytes = safeCount(
    manifest.renderAddressUtf8Bytes,
    'full_corpus_public_graph_manifest_invalid',
  );
  const renderPackedBytes = safeCount(
    manifest.renderPackedBytes,
    'full_corpus_public_graph_manifest_invalid',
  );
  const renderLodIndexBytes = safeCount(
    manifest.renderLodIndexBytes,
    'full_corpus_public_graph_manifest_invalid',
  );
  const renderRetainedBytes = safeCount(
    manifest.renderRetainedBytes,
    'full_corpus_public_graph_manifest_invalid',
  );
  const typedEdgeCount = safeCount(manifest.typedEdgeCount, 'full_corpus_public_graph_manifest_invalid');
  const pairReducerTypedEdgeCount = safeCount(
    manifest.pairReducerTypedEdgeCount,
    'full_corpus_public_graph_manifest_invalid',
  );
  const evaluationReceiptCount = safeCount(
    manifest.evaluationReceiptCount,
    'full_corpus_public_graph_manifest_invalid',
  );
  safeCount(manifest.skippedGroupReceiptCount, 'full_corpus_public_graph_manifest_invalid');
  const addressKindCounts = validateExactCounts(
    manifest.addressKindCounts,
    ['sighting', 'document', 'photo', 'video'] as const,
    'full_corpus_public_graph_manifest_address_counts_invalid',
  );
  const renderAddressKindCounts = validateExactCounts(
    manifest.renderAddressKindCounts,
    ['sighting', 'document', 'photo', 'video'] as const,
    'full_corpus_public_graph_manifest_render_address_counts_invalid',
  );
  const relationshipStatusCounts = validateExactCounts(
    manifest.relationshipStatusCounts,
    ['linked', 'candidate_only', 'isolated'] as const,
    'full_corpus_public_graph_manifest_status_counts_invalid',
  );
  const typedEdgeTypeCounts = validateExactCounts(
    manifest.typedEdgeTypeCounts,
    FULL_CORPUS_TYPED_EDGE_TYPES,
    'full_corpus_public_graph_manifest_edge_counts_invalid',
  );
  for (const digest of [
    manifest.universeNodeSetSha256, manifest.nodeSetSha256, manifest.renderAddressSetSha256,
    manifest.renderSetSha256, manifest.typedEdgeIdSetSha256,
    manifest.publicEdgeSetSha256, manifest.evaluationSetSha256,
    manifest.statusReceiptSetSha256, manifest.egoSetSha256, manifest.shardSetSha256,
    manifest.renderPackedLayoutSha256, manifest.renderAddressLookupSetSha256,
    manifest.renderLodPolicySha256, manifest.renderLodIndexSetSha256,
    manifest.renderTemporalMappingSha256,
    manifest.pairReducerTypedEdgeIdSetSha256,
  ]) if (!SHA256_PATTERN.test(digest)) invalid('full_corpus_public_graph_manifest_digest_invalid');
  if (
    Object.values(addressKindCounts).reduce((sum, count) => sum + count, 0) !== universeNodeCount
    || renderRowCount !== universeNodeCount
    || Object.values(renderAddressKindCounts).reduce((sum, count) => sum + count, 0) !== renderRowCount
    || canonicalizeRelationshipInput(renderAddressKindCounts)
      !== canonicalizeRelationshipInput(addressKindCounts)
    || renderUncompressedBytes < 1
    || renderCompressedBytes < 1
    || manifest.renderFormat !== PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT
    || manifest.renderAddressOrder !== PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER
    || canonicalizeRelationshipInput(manifest.renderPackedLayout)
      !== canonicalizeRelationshipInput(PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT)
    || manifest.renderPackedLayoutSha256 !== digestValue(PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT)
    || canonicalizeRelationshipInput(manifest.renderLodPolicy)
      !== canonicalizeRelationshipInput(PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY)
    || manifest.renderLodPolicySha256 !== digestValue(PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY)
    || canonicalizeRelationshipInput(manifest.renderTemporalMapping)
      !== canonicalizeRelationshipInput(PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING)
    || manifest.renderTemporalMappingSha256 !== digestValue(
      PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING,
    )
    || renderPackedBytes < renderAddressUtf8Bytes
    || renderLodIndexBytes < 1
    || renderRetainedBytes !== renderPackedBytes + renderLodIndexBytes
    || renderRetainedBytes > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES
    || manifest.renderRetainedBudgetBytes !== PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES
    || manifest.renderInFlightDecodeBudgetBytes
      !== PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES
    || manifest.renderBufferAllocation !== PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION
    || manifest.fullNodeMetadataAccess !== 'on_demand_node_and_ego_shards'
    || Object.values(relationshipStatusCounts).reduce((sum, count) => sum + count, 0) !== universeNodeCount
    || Object.values(typedEdgeTypeCounts).reduce((sum, count) => sum + count, 0) !== typedEdgeCount
    || typedEdgeCount !== pairReducerTypedEdgeCount
      + contextualRelationshipCompletion.accounting.acceptedEdgeCount
    || typedEdgeTypeCounts.contextual_explanation_candidate
      !== contextualRelationshipCompletion.accounting.acceptedEdgeCount
    || canonicalizeRelationshipInput(manifest.claimDiscipline)
      !== canonicalizeRelationshipInput(PUBLIC_TYPED_RELATIONSHIP_GRAPH_CLAIM_DISCIPLINE)
  ) invalid('full_corpus_public_graph_manifest_accounting_invalid');
  const summaries = manifest.shards.map((summaryValue) => {
    const summary = requireExactKeys(
      summaryValue,
      SHARD_SUMMARY_KEYS,
      'full_corpus_public_graph_shard_summary_invalid',
    ) as unknown as FullCorpusPublicGraphShardSummary;
    if (
      !SHARD_KINDS.includes(summary.shardKind)
      || !Number.isSafeInteger(summary.shard) || summary.shard < 0
      || !Number.isSafeInteger(summary.shardCount) || summary.shardCount < 1 || summary.shardCount > 4096
      || summary.shard >= summary.shardCount
      || !Number.isSafeInteger(summary.itemCount) || summary.itemCount < 0
      || (summary.itemCount === 0 ? summary.firstKey !== null || summary.lastKey !== null
        : typeof summary.firstKey !== 'string' || typeof summary.lastKey !== 'string' || summary.firstKey > summary.lastKey)
      || !SHA256_PATTERN.test(summary.itemSetSha256)
      || !SHA256_PATTERN.test(summary.shardDigest)
      || !SHA256_PATTERN.test(summary.artifactDigest)
      || !SHA256_PATTERN.test(summary.compressedSha256)
      || !Number.isSafeInteger(summary.uncompressedBytes) || summary.uncompressedBytes < 1
      || !Number.isSafeInteger(summary.compressedBytes) || summary.compressedBytes < 1
      || typeof summary.archiveKey !== 'string' || typeof summary.receiptKey !== 'string'
      || (summary.shardKind === 'render'
        && (summary.itemCount > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD
          || summary.uncompressedBytes > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES))
    ) invalid('full_corpus_public_graph_shard_summary_invalid');
    const isRender = summary.shardKind === 'render';
    if (isRender) {
      if (!SHA256_PATTERN.test(String(summary.renderAddressLookupSha256))
        || !SHA256_PATTERN.test(String(summary.renderLodIndexSha256))
        || !Number.isSafeInteger(summary.renderAddressUtf8Bytes) || Number(summary.renderAddressUtf8Bytes) < 0
        || !Number.isSafeInteger(summary.renderPackedBytes) || Number(summary.renderPackedBytes) < 4
        || !Number.isSafeInteger(summary.renderLodIndexBytes) || Number(summary.renderLodIndexBytes) < 1) {
        invalid('full_corpus_public_graph_render_summary_invalid');
      }
    } else if (summary.renderAddressLookupSha256 !== null
      || summary.renderLodIndexSha256 !== null
      || summary.renderAddressUtf8Bytes !== null
      || summary.renderPackedBytes !== null
      || summary.renderLodIndexBytes !== null) {
      invalid('full_corpus_public_graph_render_summary_invalid');
    }
    const prefix = publicGraphArchivePrefix({
      lineage,
      completionDigest: manifest.completionDigest,
      runIndexPointerDigest: runIndexPointer.pointerDigest,
    });
    const artifactName = `shard-${String(summary.shard).padStart(6, '0')}-${summary.artifactDigest}`;
    if (
      summary.archiveKey !== `${prefix}/${summary.shardKind}/${artifactName}.json.gz`
      || summary.receiptKey !== `${prefix}/${summary.shardKind}/${artifactName}.receipt.json`
    ) invalid('full_corpus_public_graph_shard_summary_key_invalid');
    return summary;
  }).sort((left, right) => compareText(left.shardKind, right.shardKind) || left.shard - right.shard);
  if (canonicalizeRelationshipInput(summaries) !== canonicalizeRelationshipInput(manifest.shards)) {
    invalid('full_corpus_public_graph_shard_summary_order_invalid');
  }
  for (const kind of SHARD_KINDS) {
    const kindSummaries = summaries.filter((summary) => summary.shardKind === kind);
    if (!kindSummaries.length || kindSummaries.length !== kindSummaries[0].shardCount
      || kindSummaries.some((summary, index) => summary.shard !== index
        || summary.shardCount !== kindSummaries[0].shardCount)) {
      invalid('full_corpus_public_graph_shard_summary_sequence_invalid');
    }
  }
  const summaryCount = (kind: FullCorpusPublicGraphShardKind) => summaries
    .filter((summary) => summary.shardKind === kind)
    .reduce((sum, summary) => sum + summary.itemCount, 0);
  if (
    summaryCount('render') !== renderRowCount
    || summaryCount('node') !== universeNodeCount
    || summaryCount('ego') !== universeNodeCount
    || summaries.filter((summary) => summary.shardKind === 'render')
      .reduce((sum, summary) => sum + summary.uncompressedBytes, 0) !== renderUncompressedBytes
    || summaries.filter((summary) => summary.shardKind === 'render')
      .reduce((sum, summary) => sum + summary.compressedBytes, 0) !== renderCompressedBytes
    || summaries.filter((summary) => summary.shardKind === 'render')
      .reduce((sum, summary) => sum + Number(summary.renderAddressUtf8Bytes), 0) !== renderAddressUtf8Bytes
    || summaries.filter((summary) => summary.shardKind === 'render')
      .reduce((sum, summary) => sum + Number(summary.renderPackedBytes), 0) !== renderPackedBytes
    || summaries.filter((summary) => summary.shardKind === 'render')
      .reduce((sum, summary) => sum + Number(summary.renderLodIndexBytes), 0) !== renderLodIndexBytes
    || summaries.filter((summary) => summary.shardKind === 'render')
      .reduce((sum, summary) => (
        sum + Number(summary.renderPackedBytes) + Number(summary.renderLodIndexBytes)
      ), 0) !== renderRetainedBytes
    || manifest.renderAddressLookupSetSha256 !== digestValue(
      summaries.filter((summary) => summary.shardKind === 'render').map((summary) => (
        `${summary.shard}:${summary.renderAddressLookupSha256}`
      )).join('\n'),
    )
    || manifest.renderLodIndexSetSha256 !== digestValue(
      summaries.filter((summary) => summary.shardKind === 'render').map((summary) => (
        `${summary.shard}:${summary.renderLodIndexSha256}`
      )).join('\n'),
    )
    || summaryCount('edge') !== typedEdgeCount
    || summaryCount('evaluation') !== evaluationReceiptCount
    || manifest.shardSetSha256 !== digestValue(summaries.map((summary) => (
      `${summary.shardKind}:${summary.shard}:${summary.shardDigest}`
    )).join('\n'))
  ) invalid('full_corpus_public_graph_manifest_shard_accounting_invalid');
  const { manifestDigest, ...withoutDigest } = manifest;
  if (manifestDigest !== digestValue(withoutDigest)) invalid('full_corpus_public_graph_manifest_digest_mismatch');
  if ((Buffer.isBuffer(input) || typeof input === 'string')) {
    const raw = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    const canonical = canonicalizeRelationshipInput(manifest);
    if (raw !== canonical && raw !== `${canonical}\n`) invalid('full_corpus_public_graph_manifest_noncanonical');
  }
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(manifest)) {
    invalid('full_corpus_public_graph_manifest_noncanonical');
  }
  return {
    ...manifest,
    addressKindCounts,
    renderAddressKindCounts,
    relationshipStatusCounts,
    typedEdgeTypeCounts,
    contextualRelationshipCompletion,
    shards: summaries,
  };
};

export type FullCorpusPublicGraphReferenceIndex = {
  edgeIdsByAddress: Map<string, string[]>;
  evaluationIdsByAddress: Map<string, string[]>;
  edgeEndpointVisits: number;
  evaluationAddressVisits: number;
};

/**
 * The verifier's one-pass endpoint index. Exposed visit counters let the
 * scale test prove work tracks actual endpoints, not nodes multiplied by all
 * edges/evaluations.
 */
export const indexFullCorpusPublicGraphReferences = (params: {
  edges: readonly FullCorpusPublicEdge[];
  evaluations: readonly FullCorpusPublicEvaluationReceipt[];
}): FullCorpusPublicGraphReferenceIndex => {
  const edgeIdsByAddress = new Map<string, string[]>();
  const evaluationIdsByAddress = new Map<string, string[]>();
  let edgeEndpointVisits = 0;
  let evaluationAddressVisits = 0;
  for (const edge of params.edges) for (const endpoint of edge.endpoints) {
    if (endpoint.kind !== 'evidence') continue;
    edgeEndpointVisits += 1;
    const ids = edgeIdsByAddress.get(endpoint.id) || [];
    ids.push(edge.edgeId);
    edgeIdsByAddress.set(endpoint.id, ids);
  }
  for (const evaluation of params.evaluations) for (const address of evaluation.addresses) {
    evaluationAddressVisits += 1;
    const ids = evaluationIdsByAddress.get(address) || [];
    ids.push(evaluation.evaluationId);
    evaluationIdsByAddress.set(address, ids);
  }
  for (const ids of edgeIdsByAddress.values()) ids.sort(compareText);
  for (const ids of evaluationIdsByAddress.values()) ids.sort(compareText);
  return { edgeIdsByAddress, evaluationIdsByAddress, edgeEndpointVisits, evaluationAddressVisits };
};

export const verifyFullCorpusPublicGraphArtifacts = (
  artifacts: FullCorpusPublicGraphArtifacts,
): FullCorpusPublicGraphArtifacts => {
  const manifest = decodeFullCorpusPublicGraphManifest(artifacts.manifest);
  const shards = artifacts.shards.map((shard) => decodeFullCorpusPublicGraphShard(shard, {
    lineage: manifest.lineage,
    completionDigest: manifest.completionDigest,
    runIndexPointerDigest: manifest.runIndexPointer.pointerDigest,
  })).sort((left, right) => compareText(left.shardKind, right.shardKind) || left.shard - right.shard);
  const summaries = shards.map(shardSummary);
  if (
    canonicalizeRelationshipInput(summaries) !== canonicalizeRelationshipInput(manifest.shards)
    || manifest.shardSetSha256 !== digestValue(summaries.map((summary) => (
      `${summary.shardKind}:${summary.shard}:${summary.shardDigest}`
    )).join('\n'))
  ) invalid('full_corpus_public_graph_manifest_shard_set_mismatch');
  const byKind = new Map<FullCorpusPublicGraphShardKind, FullCorpusPublicGraphShard[]>();
  for (const shard of shards) {
    const list = byKind.get(shard.shardKind) || [];
    list.push(shard);
    byKind.set(shard.shardKind, list);
  }
  for (const kind of SHARD_KINDS) {
    const kindShards = byKind.get(kind) || [];
    if (!kindShards.length || kindShards.length !== kindShards[0].shardCount
      || kindShards.some((shard, index) => shard.shard !== index)) {
      invalid('full_corpus_public_graph_shard_sequence_incomplete');
    }
  }
  const renderRows = (byKind.get('render') || [])
    .flatMap((shard) => shard.items as FullCorpusPublicRenderRow[])
    .sort((left, right) => compareText(left.address, right.address));
  const nodes = (byKind.get('node') || []).flatMap((shard) => shard.items as FullCorpusPublicNode[])
    .sort((left, right) => compareText(left.address, right.address));
  const edges = (byKind.get('edge') || []).flatMap((shard) => shard.items as FullCorpusPublicEdge[])
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  const evaluations = (byKind.get('evaluation') || [])
    .flatMap((shard) => shard.items as FullCorpusPublicEvaluationReceipt[])
    .sort((left, right) => compareText(left.evaluationId, right.evaluationId));
  const egos = (byKind.get('ego') || []).flatMap((shard) => shard.items as FullCorpusPublicEgo[])
    .sort((left, right) => compareText(left.address, right.address));
  const statusCounts = {
    linked: nodes.filter((node) => node.relationshipStatus === 'linked').length,
    candidate_only: nodes.filter((node) => node.relationshipStatus === 'candidate_only').length,
    isolated: nodes.filter((node) => node.relationshipStatus === 'isolated').length,
  };
  const edgeTypeCounts = emptyEdgeTypeCounts();
  for (const edge of edges) edgeTypeCounts[edge.edgeType] += 1;
  const contextualEdges = edges.filter((edge) => (
    edge.edgeType === 'contextual_explanation_candidate'
  ));
  const pairReducerEdges = edges.filter((edge) => (
    edge.edgeType !== 'contextual_explanation_candidate'
  ));
  if (
    new Set(renderRows.map((row) => row.address)).size !== renderRows.length
    || new Set(nodes.map((node) => node.address)).size !== nodes.length
    || new Set(edges.map((edge) => edge.edgeId)).size !== edges.length
    || new Set(evaluations.map((evaluation) => evaluation.evaluationId)).size !== evaluations.length
    || new Set(egos.map((ego) => ego.address)).size !== egos.length
  ) invalid('full_corpus_public_graph_duplicate_public_item');
  const contextualEndpointSignatures = new Set<string>();
  for (const edge of contextualEdges) {
    const evidenceEndpoints = edge.endpoints.filter((endpoint) => endpoint.kind === 'evidence');
    const contextEndpoints = edge.endpoints.filter((endpoint) => endpoint.kind === 'context');
    const signature = edge.endpoints.map((endpoint) => `${endpoint.kind}:${endpoint.id}`)
      .sort(compareText).join('\u0000');
    if (edge.endpoints.length !== 2
      || evidenceEndpoints.length !== 1
      || contextEndpoints.length !== 1
      || contextualEndpointSignatures.has(signature)) {
      invalid('full_corpus_public_graph_contextual_edge_endpoint_conflict');
    }
    contextualEndpointSignatures.add(signature);
  }
  const renderByAddress = new Map(renderRows.map((row) => [row.address, row]));
  const nodesByAddress = new Map(nodes.map((node) => [node.address, node]));
  const edgesById = new Map(edges.map((edge) => [edge.edgeId, edge]));
  const egosByAddress = new Map(egos.map((ego) => [ego.address, ego]));
  const addressKindCounts: Record<FullCorpusAddressKind, number> = {
    sighting: 0, document: 0, photo: 0, video: 0,
  };
  const skippedReceiptIds = new Set<string>();
  const referenceIndex = indexFullCorpusPublicGraphReferences({ edges, evaluations });
  const nodeShardCount = (byKind.get('node') || [])[0]?.shardCount;
  const egoShardCount = (byKind.get('ego') || [])[0]?.shardCount;
  if (!nodeShardCount || !egoShardCount) invalid('full_corpus_public_graph_metadata_shards_missing');
  for (const node of nodes) {
    addressKindCounts[node.kind] += 1;
    for (const receiptId of node.statusReceipt.skippedGroupReceiptIds) skippedReceiptIds.add(receiptId);
    const expectedEdgeIds = referenceIndex.edgeIdsByAddress.get(node.address) || [];
    const expectedEvaluationIds = referenceIndex.evaluationIdsByAddress.get(node.address) || [];
    if (
      canonicalizeRelationshipInput(node.statusReceipt.edgeIds) !== canonicalizeRelationshipInput(expectedEdgeIds)
      || canonicalizeRelationshipInput(node.statusReceipt.candidateEvaluationIds)
        !== canonicalizeRelationshipInput(expectedEvaluationIds)
    ) invalid('full_corpus_public_graph_node_reference_set_mismatch');
    const ego = egosByAddress.get(node.address);
    if (!ego
      || ego.nodeDigest !== node.nodeDigest
      || ego.relationshipStatus !== node.relationshipStatus
      || ego.statusReceiptDigest !== node.statusReceipt.receiptDigest
      || canonicalizeRelationshipInput(ego.evaluationReceiptIds)
        !== canonicalizeRelationshipInput(expectedEvaluationIds)
      || canonicalizeRelationshipInput(ego.edgeReferences.map((reference) => reference.edgeId))
        !== canonicalizeRelationshipInput(expectedEdgeIds)
    ) invalid('full_corpus_public_graph_ego_reference_set_mismatch');
    const render = renderByAddress.get(node.address);
    if (!render
      || render.kind !== node.kind
      || render.eventTimestamp !== node.eventTimestamp
      || canonicalizeRelationshipInput(render.position) !== canonicalizeRelationshipInput(node.position)
      || render.relationshipStatus !== node.relationshipStatus
      || render.degree !== node.degree
      || render.nodeShard !== fullCorpusRelationshipShard(node.address, nodeShardCount)
      || render.egoShard !== fullCorpusRelationshipShard(node.address, egoShardCount)) {
      invalid('full_corpus_public_graph_render_node_mismatch');
    }
    for (const reference of ego.edgeReferences) {
      const edge = edgesById.get(reference.edgeId);
      if (!edge
        || reference.edgeType !== edge.edgeType
        || reference.strength !== edge.strength
        || reference.receiptId !== edge.receipt.receiptId
        || canonicalizeRelationshipInput(reference.otherEndpoints)
          !== canonicalizeRelationshipInput(edge.endpoints.filter((endpoint) => (
            endpoint.kind !== 'evidence' || endpoint.id !== node.address
          )))
      ) invalid('full_corpus_public_graph_ego_edge_mismatch');
    }
  }
  for (const edge of edges) for (const endpoint of edge.endpoints) {
    if (endpoint.kind === 'evidence' && !nodesByAddress.has(endpoint.id)) {
      invalid('full_corpus_public_graph_edge_endpoint_missing');
    }
  }
  for (const evaluation of evaluations) {
    if (evaluation.addresses.some((address) => !nodesByAddress.has(address))
      || evaluation.emittedEdgeIds.some((edgeId) => !edgesById.has(edgeId))) {
      invalid('full_corpus_public_graph_evaluation_reference_missing');
    }
    for (const edgeId of evaluation.emittedEdgeIds) {
      const edge = edgesById.get(edgeId) as FullCorpusPublicEdge;
      if (!edge.endpoints.every((endpoint) => endpoint.kind !== 'evidence'
        || evaluation.addresses.includes(endpoint.id))) {
        invalid('full_corpus_public_graph_evaluation_edge_binding_mismatch');
      }
    }
  }
  const universeNodes = nodes.map((node): EvidenceUniverseNode => ({
    schemaVersion: node.universeSchemaVersion,
    layoutVersion: node.universeLayoutVersion,
    address: node.address,
    kind: node.kind,
    recordId: node.recordId,
    source: node.source,
    sourceRecordId: node.sourceRecordId,
    title: node.title,
    summary: node.summary,
    canonicalUrl: node.canonicalUrl,
    previewUrl: node.previewUrl,
    eventTimestamp: node.eventTimestamp,
    lat: node.lat,
    lon: node.lon,
    location: node.location,
    countryCode: node.countryCode,
    linkedSightingId: node.linkedSightingId,
    updatedAt: node.updatedAt,
    position: node.position,
  }));
  const universeNodeSetSha256 = digestValue(universeNodes.map((node) => (
    `${node.address}:${fullCorpusRelationshipArtifactSha256(node)}`
  )).join('\n'));
  if (
    renderRows.length !== manifest.renderRowCount
    || renderRows.length !== nodes.length
    || nodes.length !== manifest.universeNodeCount
    || edges.length !== manifest.typedEdgeCount
    || evaluations.length !== manifest.evaluationReceiptCount
    || egos.length !== nodes.length
    || skippedReceiptIds.size !== manifest.skippedGroupReceiptCount
    || canonicalizeRelationshipInput(addressKindCounts) !== canonicalizeRelationshipInput(manifest.addressKindCounts)
    || canonicalizeRelationshipInput(addressKindCounts)
      !== canonicalizeRelationshipInput(manifest.renderAddressKindCounts)
    || canonicalizeRelationshipInput(statusCounts) !== canonicalizeRelationshipInput(manifest.relationshipStatusCounts)
    || canonicalizeRelationshipInput(edgeTypeCounts) !== canonicalizeRelationshipInput(manifest.typedEdgeTypeCounts)
    || contextualEdges.length
      !== manifest.contextualRelationshipCompletion.accounting.acceptedEdgeCount
    || manifest.contextualRelationshipCompletion.acceptedEdgeIdSetSha256
      !== digestValue(contextualEdges.map((edge) => edge.edgeId).join('\n'))
    || pairReducerEdges.length !== manifest.pairReducerTypedEdgeCount
    || manifest.pairReducerTypedEdgeIdSetSha256
      !== digestValue(pairReducerEdges.map((edge) => edge.edgeId).join('\n'))
    || universeNodeSetSha256 !== manifest.universeNodeSetSha256
    || manifest.renderAddressSetSha256 !== digestValue(renderRows.map((row) => row.address).join('\n'))
    || manifest.renderSetSha256 !== digestValue(renderRows.map((row) => (
      `${row.address}:${digestValue(row)}`
    )).join('\n'))
    || manifest.nodeSetSha256 !== digestValue(nodes.map((node) => `${node.address}:${node.nodeDigest}`).join('\n'))
    || manifest.typedEdgeIdSetSha256 !== digestValue(edges.map((edge) => edge.edgeId).join('\n'))
    || manifest.publicEdgeSetSha256 !== digestValue(edges.map((edge) => `${edge.edgeId}:${edge.edgeDigest}`).join('\n'))
    || manifest.evaluationSetSha256 !== digestValue(evaluations.map((evaluation) => (
      `${evaluation.evaluationId}:${evaluation.receiptDigest}`
    )).join('\n'))
    || manifest.statusReceiptSetSha256 !== digestValue(nodes.map((node) => (
      `${node.address}:${node.statusReceipt.receiptDigest}`
    )).join('\n'))
    || manifest.egoSetSha256 !== digestValue(egos.map((ego) => `${ego.address}:${ego.egoDigest}`).join('\n'))
  ) invalid('full_corpus_public_graph_manifest_accounting_mismatch');
  return { manifest, shards };
};

export const encodeFullCorpusPublicGraphArchiveObject = <T extends FullCorpusPublicGraphShard | FullCorpusPublicGraphManifest>(
  value: T,
): FullCorpusPublicGraphArchiveObject<T> => {
  const artifactKind: FullCorpusPublicGraphArchiveReceipt['artifactKind'] = value.recordType === 'full_corpus_public_graph_manifest'
    ? 'manifest'
    : value.shardKind;
  const lineage = value.lineage;
  const completionDigest = value.completionDigest;
  const runIndexPointerDigest = value.recordType === 'full_corpus_public_graph_manifest'
    ? value.runIndexPointer.pointerDigest
    : value.runIndexPointerDigest;
  const artifactDigest = fullCorpusRelationshipArtifactSha256(value);
  const body = Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
  if (
    artifactKind === 'render'
    && body.length > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES
  ) invalid('full_corpus_public_graph_archive_render_decode_budget_exceeded');
  const archiveBody = gzipSync(body, { level: 6 });
  const prefix = publicGraphArchivePrefix({ lineage, completionDigest, runIndexPointerDigest });
  const artifactName = value.recordType === 'full_corpus_public_graph_manifest'
    ? artifactDigest
    : `shard-${String(value.shard).padStart(6, '0')}-${artifactDigest}`;
  const archiveKey = `${prefix}/${artifactKind}/${artifactName}.json.gz`;
  const receiptKey = `${prefix}/${artifactKind}/${artifactName}.receipt.json`;
  const withoutDigest = {
    recordType: 'full_corpus_public_graph_archive_receipt' as const,
    schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION,
    lineage,
    completionDigest,
    runIndexPointerDigest,
    artifactKind,
    artifactDigest,
    archiveKey,
    receiptKey,
    uncompressedBytes: body.length,
    compressedBytes: archiveBody.length,
    compressedSha256: rawSha256(archiveBody),
  };
  const receipt = { ...withoutDigest, receiptDigest: digestValue(withoutDigest) };
  return {
    value,
    archiveBody,
    receipt,
    receiptBody: Buffer.from(`${canonicalizeRelationshipInput(receipt)}\n`, 'utf8'),
  };
};

export const decodeFullCorpusPublicGraphArchiveObject = <T extends FullCorpusPublicGraphShard | FullCorpusPublicGraphManifest>(params: {
  archiveBody: Buffer;
  receipt: FullCorpusPublicGraphArchiveReceipt | Buffer | string;
  maxUncompressedBytes?: number;
}): T => {
  let receiptInput: unknown = params.receipt;
  if (Buffer.isBuffer(params.receipt) || typeof params.receipt === 'string') {
    try {
      receiptInput = JSON.parse(Buffer.isBuffer(params.receipt) ? params.receipt.toString('utf8') : params.receipt);
    } catch {
      invalid('full_corpus_public_graph_archive_receipt_json_invalid');
    }
  }
  const rawReceipt = requireExactKeys(
    receiptInput,
    ARCHIVE_RECEIPT_KEYS,
    'full_corpus_public_graph_archive_receipt_invalid',
  );
  const lineage = validatePublicLineage(rawReceipt.lineage);
  const receipt = { ...rawReceipt, lineage } as unknown as FullCorpusPublicGraphArchiveReceipt;
  const { receiptDigest, ...withoutReceiptDigest } = receipt;
  if (
    receipt.recordType !== 'full_corpus_public_graph_archive_receipt'
    || receipt.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION
    || ![...SHARD_KINDS, 'manifest'].includes(receipt.artifactKind)
    || !SHA256_PATTERN.test(receipt.artifactDigest)
    || !SHA256_PATTERN.test(receipt.compressedSha256)
    || typeof receipt.archiveKey !== 'string'
    || typeof receipt.receiptKey !== 'string'
    || !SHA256_PATTERN.test(receipt.completionDigest)
    || !SHA256_PATTERN.test(receipt.runIndexPointerDigest)
    || !Number.isSafeInteger(receipt.uncompressedBytes) || receipt.uncompressedBytes < 1
    || !Number.isSafeInteger(receipt.compressedBytes) || receipt.compressedBytes < 1
    || receiptDigest !== digestValue(withoutReceiptDigest)
    || params.archiveBody.length !== receipt.compressedBytes
    || rawSha256(params.archiveBody) !== receipt.compressedSha256
  ) invalid('full_corpus_public_graph_archive_receipt_invalid');
  if ((Buffer.isBuffer(params.receipt) || typeof params.receipt === 'string')) {
    const raw = Buffer.isBuffer(params.receipt) ? params.receipt.toString('utf8') : params.receipt;
    const canonical = canonicalizeRelationshipInput(receipt);
    if (raw !== canonical && raw !== `${canonical}\n`) {
      invalid('full_corpus_public_graph_archive_receipt_noncanonical');
    }
  }
  if (
    receipt.artifactKind === 'render'
    && receipt.uncompressedBytes > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES
  ) invalid('full_corpus_public_graph_archive_render_decode_budget_exceeded');
  const configuredMaxUncompressedBytes = params.maxUncompressedBytes ?? 256 * 1024 * 1024;
  if (
    !Number.isSafeInteger(configuredMaxUncompressedBytes)
    || configuredMaxUncompressedBytes < 1
  ) invalid('full_corpus_public_graph_archive_decode_budget_invalid');
  const maxUncompressedBytes = receipt.artifactKind === 'render'
    ? Math.min(
      configuredMaxUncompressedBytes,
      PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES,
    )
    : configuredMaxUncompressedBytes;
  if (receipt.uncompressedBytes > maxUncompressedBytes) {
    invalid('full_corpus_public_graph_archive_decode_budget_exceeded');
  }
  const prefix = publicGraphArchivePrefix({
    lineage: receipt.lineage,
    completionDigest: receipt.completionDigest,
    runIndexPointerDigest: receipt.runIndexPointerDigest,
  });
  const artifactName = receipt.artifactKind === 'manifest'
    ? receipt.artifactDigest
    : (() => {
      // The shard number is authenticated by the decoded body below; the
      // prefix and content address are checked before decompression.
      const suffix = receipt.archiveKey.slice(`${prefix}/${receipt.artifactKind}/`.length);
      const match = /^shard-(\d{6})-([a-f0-9]{64})\.json\.gz$/.exec(suffix);
      if (!match || match[2] !== receipt.artifactDigest) invalid('full_corpus_public_graph_archive_key_invalid');
      return `shard-${match[1]}-${match[2]}`;
    })();
  if (
    receipt.archiveKey !== `${prefix}/${receipt.artifactKind}/${artifactName}.json.gz`
    || receipt.receiptKey !== `${prefix}/${receipt.artifactKind}/${artifactName}.receipt.json`
  ) invalid('full_corpus_public_graph_archive_key_invalid');
  let body: Buffer;
  try {
    body = gunzipSync(params.archiveBody, {
      maxOutputLength: maxUncompressedBytes,
    });
  } catch {
    return invalid('full_corpus_public_graph_archive_gzip_invalid');
  }
  if (body.length !== receipt.uncompressedBytes || body.at(-1) !== 0x0a) {
    invalid('full_corpus_public_graph_archive_size_mismatch');
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8').slice(0, -1));
  } catch {
    return invalid('full_corpus_public_graph_archive_json_invalid');
  }
  if (
    body.toString('utf8') !== `${canonicalizeRelationshipInput(value)}\n`
    || fullCorpusRelationshipArtifactSha256(value) !== receipt.artifactDigest
  ) invalid('full_corpus_public_graph_archive_artifact_mismatch');
  const decoded = receipt.artifactKind === 'manifest'
    ? decodeFullCorpusPublicGraphManifest(value)
    : decodeFullCorpusPublicGraphShard(value, {
      lineage: receipt.lineage,
      completionDigest: receipt.completionDigest,
      runIndexPointerDigest: receipt.runIndexPointerDigest,
    });
  if (decoded.recordType === 'full_corpus_public_graph_shard') {
    const expectedName = `shard-${String(decoded.shard).padStart(6, '0')}-${receipt.artifactDigest}`;
    if (
      receipt.archiveKey !== `${prefix}/${receipt.artifactKind}/${expectedName}.json.gz`
      || receipt.receiptKey !== `${prefix}/${receipt.artifactKind}/${expectedName}.receipt.json`
    ) invalid('full_corpus_public_graph_archive_shard_key_mismatch');
  }
  return decoded as T;
};

const writeImmutablePublicGraphObject = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  key: string;
  body: Buffer;
  contentType: string;
  contentEncoding?: string;
}) => {
  const result = await params.storage.uploadFileConditional(
    params.body,
    params.key,
    {
      contentType: params.contentType,
      ...(params.contentEncoding ? { contentEncoding: params.contentEncoding } : {}),
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: params.body.length,
    },
    { ifAbsent: true },
  );
  if (result.status === 'written') return 'written' as const;
  const existing = await params.storage.readObjectVersioned(params.key);
  if (!existing || !existing.body.equals(params.body)) {
    invalid('full_corpus_public_graph_archive_immutable_collision');
  }
  return 'reused' as const;
};

export const writeFullCorpusPublicGraphArchiveObject = async (
  storage: CaseGraphConditionalArchiveStorage,
  artifact: FullCorpusPublicGraphArchiveObject<FullCorpusPublicGraphShard | FullCorpusPublicGraphManifest>,
): Promise<FullCorpusPublicGraphArchiveWriteResult> => {
  decodeFullCorpusPublicGraphArchiveObject({ archiveBody: artifact.archiveBody, receipt: artifact.receipt });
  const archiveStatus = await writeImmutablePublicGraphObject({
    storage,
    key: artifact.receipt.archiveKey,
    body: artifact.archiveBody,
    contentType: 'application/json',
    contentEncoding: 'gzip',
  });
  const receiptStatus = await writeImmutablePublicGraphObject({
    storage,
    key: artifact.receipt.receiptKey,
    body: artifact.receiptBody,
    contentType: 'application/json',
  });
  const archiveBody = await storage.readObject(artifact.receipt.archiveKey);
  const receiptBody = await storage.readObject(artifact.receipt.receiptKey);
  if (!archiveBody || !receiptBody) invalid('full_corpus_public_graph_archive_read_after_write_missing');
  decodeFullCorpusPublicGraphArchiveObject({ archiveBody, receipt: receiptBody });
  return {
    artifactDigest: artifact.receipt.artifactDigest,
    archiveKey: artifact.receipt.archiveKey,
    receiptKey: artifact.receipt.receiptKey,
    archiveStatus,
    receiptStatus,
  };
};

export const readVerifiedFullCorpusPublicGraphArchiveObject = async <T extends FullCorpusPublicGraphShard | FullCorpusPublicGraphManifest>(params: {
  storage: CaseGraphConditionalArchiveStorage;
  receiptKey: string;
  maxUncompressedBytes?: number;
}): Promise<{ value: T; receipt: FullCorpusPublicGraphArchiveReceipt }> => {
  const receiptBody = await params.storage.readObject(params.receiptKey);
  if (!receiptBody) invalid('full_corpus_public_graph_archive_receipt_missing');
  let parsedReceipt: unknown;
  try {
    parsedReceipt = JSON.parse(receiptBody.toString('utf8'));
  } catch {
    return invalid('full_corpus_public_graph_archive_receipt_json_invalid');
  }
  if (!parsedReceipt || typeof parsedReceipt !== 'object' || Array.isArray(parsedReceipt)) {
    invalid('full_corpus_public_graph_archive_receipt_invalid');
  }
  const receipt = parsedReceipt as FullCorpusPublicGraphArchiveReceipt;
  if (receipt.receiptKey !== params.receiptKey) invalid('full_corpus_public_graph_archive_receipt_key_mismatch');
  const archiveBody = await params.storage.readObject(receipt.archiveKey);
  if (!archiveBody) invalid('full_corpus_public_graph_archive_object_missing');
  const value = decodeFullCorpusPublicGraphArchiveObject<T>({
    archiveBody,
    receipt,
    maxUncompressedBytes: params.maxUncompressedBytes,
  });
  return { value, receipt };
};

export const writeFullCorpusPublicGraphArtifacts = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  artifacts: FullCorpusPublicGraphArtifacts;
}): Promise<{
  manifestArtifact: FullCorpusPublicGraphArchiveObject<FullCorpusPublicGraphManifest>;
  writes: FullCorpusPublicGraphArchiveWriteResult[];
}> => {
  const artifacts = verifyFullCorpusPublicGraphArtifacts(params.artifacts);
  const writes: FullCorpusPublicGraphArchiveWriteResult[] = [];
  for (const shard of artifacts.shards) {
    writes.push(await writeFullCorpusPublicGraphArchiveObject(
      params.storage,
      encodeFullCorpusPublicGraphArchiveObject(shard),
    ));
  }
  const manifestArtifact = encodeFullCorpusPublicGraphArchiveObject(artifacts.manifest);
  writes.push(await writeFullCorpusPublicGraphArchiveObject(params.storage, manifestArtifact));
  return { manifestArtifact, writes };
};
