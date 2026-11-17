import { createHash } from 'node:crypto';
import {
  buildFullCorpusPublicRenderPackingReceipt,
  encodeFullCorpusPublicGraphArchiveObject,
  verifyFullCorpusPublicGraphArtifacts,
} from './typedRelationshipPublicGraphCodec';

import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
} from './evidenceUniverse';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  decodeTypedRelationshipEdge,
  decodeTypedRelationshipPairEvaluation,
  type TypedRelationshipEdge,
  type TypedRelationshipEdgeType,
  type TypedRelationshipEndpoint,
  type TypedRelationshipPairEvaluation,
  type TypedRelationshipReceipt,
} from './typedRelationshipEngine';
import {
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  FULL_CORPUS_TYPED_EDGE_TYPES,
  buildFullCorpusRelationshipCompletion,
  decodeFullCorpusPipelineLineage,
  fullCorpusRelationshipArtifactSha256,
  fullCorpusRelationshipShard,
  type FullCorpusAddressKind,
  type FullCorpusAddressState,
  type FullCorpusCandidateReason,
  type FullCorpusPairReducerResult,
  type FullCorpusPipelineLineage,
  type FullCorpusPostingFragment,
  type FullCorpusPostingMapManifest,
  type FullCorpusPostingShardReduction,
  type FullCorpusRelationshipCompletion,
} from './typedRelationshipPipeline';
import {
  FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
  decodeFullCorpusRelationshipArchiveObject,
  decodeFullCorpusRelationshipArchiveReceipt,
  decodeFullCorpusRelationshipRunIndexPointer,
  type FullCorpusRelationshipArtifactType,
  type FullCorpusRelationshipArchiveReceipt,
  type FullCorpusRelationshipRunIndex,
  type FullCorpusRelationshipRunIndexPointer,
} from './typedRelationshipPipelineArchive';
import {
  CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256,
  CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
  assertContextualRelationshipCompletionProductionEligible,
  type ContextualRelationshipCompletionAccounting,
  type ContextualRelationshipCompletionArtifact,
} from './contextualRelationshipCompletion';

export const PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION = 'case-vortex-public-typed-relationship-graph-v2' as const;
export const PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION = 'case-vortex-public-typed-relationship-graph-archive-v2' as const;

export const PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT = 'canonical-json-items-array-stream-v1' as const;
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER = 'hash-shard-v1/address-bytewise-ascending-v1' as const;
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD = 25_000 as const;
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES = 41_943_040 as const;
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES = 16_777_216 as const;
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION = 'preallocate-from-manifest-no-growth-copy' as const;
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT = Object.freeze({
  version: 'case-vortex-render-packed-layout-v1',
  addressBytes: 'uint8-utf8-byte-pool',
  addressOffsets: 'uint32-le-count-plus-one',
  addressLookupHashPreimage: 'uint32-le-offsets-then-utf8-bytes',
  position: 'float32-le-xyz',
  eventTimestamp: 'float64-le-unix-ms-nan-missing',
  temporalMapping: 'linear-unix-ms-monotonic-unclipped-v1',
  degree: 'uint32-le',
  kind: 'uint8-enum-sighting-0-document-1-photo-2-video-3',
  relationshipStatus: 'uint8-enum-linked-0-candidate-only-1-isolated-2',
  nodeShard: 'uint16-le',
  egoShard: 'uint16-le',
  rowObjectRetention: 'discard-after-pack',
  bufferAllocation: PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION,
  datedState: 'derived-from-event-timestamp-nan-not-retained',
} as const);
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY = Object.freeze({
  version: 'case-vortex-render-address-stride-lod-v1',
  indexEncoding: 'uint16-le-render-row-index',
  hashPreimage: 'level-u32-count-u32-indices-u16-le-concatenated',
  maximumRowsPerShard: PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD,
  preservesRenderRowOrder: true,
  levels: Object.freeze([
    Object.freeze({ level: 0, stride: 64 }),
    Object.freeze({ level: 1, stride: 16 }),
    Object.freeze({ level: 2, stride: 4 }),
    Object.freeze({ level: 3, stride: 1 }),
  ]),
} as const);
export const PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING = Object.freeze({
  version: 'case-vortex-render-temporal-unix-ms-v1',
  source: 'iso-8601-event-timestamp',
  encoding: 'float64-le-unix-ms',
  missingValue: 'nan',
  ordering: 'linear-monotonic',
  clipping: 'none',
} as const);

export const PUBLIC_TYPED_RELATIONSHIP_GRAPH_CLAIM_DISCIPLINE = Object.freeze({
  semantics: 'public_evidence_navigation_not_causality_or_truth_assessment',
  isolation: 'no_emitted_or_bounded_route_is_not_negative_evidence',
  notice: 'This public graph exposes governed evidence relationships and explicit pipeline receipts. It does not establish causation, truth, independent corroboration unless the edge receipt says so, or ordinary or extraordinary origin.',
} as const);

export type FullCorpusPublicRelationshipStatus = 'linked' | 'candidate_only' | 'isolated';

export type FullCorpusPublicStatusReceipt = {
  recordType: 'full_corpus_public_status_receipt';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  address: string;
  relationshipInputRecordDigest: string;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  edgeIds: string[];
  candidateEvaluationIds: string[];
  skippedGroupReceiptIds: string[];
  decisionCode: 'typed_edge_emitted' | 'evaluated_no_edge' | 'no_bounded_candidate_route';
  plainEnglish: string;
  receiptDigest: string;
};

export type FullCorpusPublicNode = {
  recordType: 'full_corpus_public_node';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  universeSchemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  universeLayoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  address: string;
  kind: FullCorpusAddressKind;
  recordId: string;
  relationshipInputRecordDigest: string;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  source: string;
  sourceRecordId: string | null;
  title: string | null;
  summary: string | null;
  canonicalUrl: string | null;
  previewUrl: string | null;
  eventTimestamp: string | null;
  lat: number | null;
  lon: number | null;
  location: string | null;
  countryCode: string | null;
  linkedSightingId: string | null;
  updatedAt: string;
  position: [number, number, number];
  degree: number;
  neighbourCount: number;
  candidateEvaluationCount: number;
  edgeTypeCounts: Record<TypedRelationshipEdgeType, number>;
  statusReceipt: FullCorpusPublicStatusReceipt;
  nodeDigest: string;
};

/**
 * The browser boot payload. Full node metadata and ego receipts deliberately
 * remain in their own on-demand shards; this row only carries what is needed
 * to draw and route a selectable point.
 */
export type FullCorpusPublicRenderRow = {
  address: string;
  kind: FullCorpusAddressKind;
  eventTimestamp: string | null;
  position: [number, number, number];
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  degree: number;
  nodeShard: number;
  egoShard: number;
};

export type FullCorpusPublicEdge = {
  recordType: 'full_corpus_public_edge';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  edgeId: string;
  edgeType: TypedRelationshipEdgeType;
  endpoints: [TypedRelationshipEndpoint, TypedRelationshipEndpoint];
  strength: number;
  receipt: TypedRelationshipReceipt;
  edgeDigest: string;
};

export type FullCorpusPublicEvaluationReceipt = {
  recordType: 'full_corpus_public_evaluation_receipt';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  evaluationId: string;
  addresses: [string, string];
  candidateReasons: FullCorpusCandidateReason[];
  emittedEdgeIds: string[];
  evaluation: TypedRelationshipPairEvaluation;
  plainEnglish: string;
  receiptDigest: string;
};

export type FullCorpusPublicEgoEdgeReference = {
  edgeId: string;
  edgeType: TypedRelationshipEdgeType;
  strength: number;
  receiptId: string;
  otherEndpoints: TypedRelationshipEndpoint[];
};

export type FullCorpusPublicEgo = {
  recordType: 'full_corpus_public_ego';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  address: string;
  nodeDigest: string;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  statusReceiptDigest: string;
  edgeReferences: FullCorpusPublicEgoEdgeReference[];
  evaluationReceiptIds: string[];
  egoDigest: string;
};

export type FullCorpusPublicGraphShardKind = 'render' | 'node' | 'edge' | 'evaluation' | 'ego';

export type FullCorpusPublicGraphShard = {
  recordType: 'full_corpus_public_graph_shard';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  lineage: FullCorpusPipelineLineage;
  completionDigest: string;
  runIndexPointerDigest: string;
  shardKind: FullCorpusPublicGraphShardKind;
  shard: number;
  shardCount: number;
  itemCount: number;
  firstKey: string | null;
  lastKey: string | null;
  items: Array<FullCorpusPublicRenderRow | FullCorpusPublicNode | FullCorpusPublicEdge | FullCorpusPublicEvaluationReceipt | FullCorpusPublicEgo>;
  itemSetSha256: string;
  shardDigest: string;
};

export type FullCorpusPublicGraphShardSummary = {
  shardKind: FullCorpusPublicGraphShardKind;
  shard: number;
  shardCount: number;
  itemCount: number;
  firstKey: string | null;
  lastKey: string | null;
  itemSetSha256: string;
  shardDigest: string;
  artifactDigest: string;
  archiveKey: string;
  receiptKey: string;
  uncompressedBytes: number;
  compressedBytes: number;
  compressedSha256: string;
  renderAddressLookupSha256: string | null;
  renderLodIndexSha256: string | null;
  renderAddressUtf8Bytes: number | null;
  renderPackedBytes: number | null;
  renderLodIndexBytes: number | null;
};

export type FullCorpusPublicRenderPackingReceipt = {
  rowCount: number;
  addressLookupSha256: string;
  lodIndexSha256: string;
  addressUtf8Bytes: number;
  packedBytes: number;
  lodIndexBytes: number;
};

/**
 * The exact governed contextual-completion identity used to assemble this
 * public graph. The full immutable completion body remains a separately
 * archived object; this binding keeps the public manifest self-auditing while
 * avoiding a second copy of all completion entries.
 */
export type FullCorpusPublicContextualRelationshipCompletionBinding = {
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION;
  completionId: string;
  completionDigest: string;
  sourceCompletionSetSha256: string;
  contextualIdentitySha256: string;
  entrySetSha256: string;
  calibrationReceiptId: string;
  calibrationReceiptSha256: string;
  accounting: ContextualRelationshipCompletionAccounting;
  zeroObservationState: boolean;
  acceptedEdgeIdSetSha256: string;
};

export type FullCorpusPublicGraphManifest = {
  recordType: 'full_corpus_public_graph_manifest';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  archiveVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION;
  pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  pipelineArchiveVersion: typeof FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION;
  lineage: FullCorpusPipelineLineage;
  completionDigest: string;
  runIndexPointer: FullCorpusRelationshipRunIndexPointer;
  contextualRelationshipCompletion: FullCorpusPublicContextualRelationshipCompletionBinding;
  universeNodeCount: number;
  addressKindCounts: Record<FullCorpusAddressKind, number>;
  renderRowCount: number;
  renderAddressKindCounts: Record<FullCorpusAddressKind, number>;
  renderAddressSetSha256: string;
  renderSetSha256: string;
  renderUncompressedBytes: number;
  renderCompressedBytes: number;
  renderFormat: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT;
  renderAddressOrder: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER;
  renderPackedLayout: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT;
  renderPackedLayoutSha256: string;
  renderAddressLookupSetSha256: string;
  renderLodPolicy: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY;
  renderLodPolicySha256: string;
  renderLodIndexSetSha256: string;
  renderTemporalMapping: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING;
  renderTemporalMappingSha256: string;
  renderAddressUtf8Bytes: number;
  renderPackedBytes: number;
  renderLodIndexBytes: number;
  renderRetainedBytes: number;
  renderRetainedBudgetBytes: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES;
  renderInFlightDecodeBudgetBytes: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES;
  renderBufferAllocation: typeof PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION;
  fullNodeMetadataAccess: 'on_demand_node_and_ego_shards';
  relationshipStatusCounts: Record<FullCorpusPublicRelationshipStatus, number>;
  typedEdgeCount: number;
  typedEdgeTypeCounts: Record<TypedRelationshipEdgeType, number>;
  pairReducerTypedEdgeCount: number;
  pairReducerTypedEdgeIdSetSha256: string;
  evaluationReceiptCount: number;
  skippedGroupReceiptCount: number;
  universeNodeSetSha256: string;
  nodeSetSha256: string;
  typedEdgeIdSetSha256: string;
  publicEdgeSetSha256: string;
  evaluationSetSha256: string;
  statusReceiptSetSha256: string;
  egoSetSha256: string;
  shards: FullCorpusPublicGraphShardSummary[];
  shardSetSha256: string;
  claimDiscipline: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_CLAIM_DISCIPLINE;
  manifestDigest: string;
};

export type FullCorpusPublicGraphArtifacts = {
  manifest: FullCorpusPublicGraphManifest;
  shards: FullCorpusPublicGraphShard[];
};

export type FullCorpusPublicGraphArchiveReceipt = {
  recordType: 'full_corpus_public_graph_archive_receipt';
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION;
  lineage: FullCorpusPipelineLineage;
  completionDigest: string;
  runIndexPointerDigest: string;
  artifactKind: FullCorpusPublicGraphShardKind | 'manifest';
  artifactDigest: string;
  archiveKey: string;
  receiptKey: string;
  uncompressedBytes: number;
  compressedBytes: number;
  compressedSha256: string;
  receiptDigest: string;
};

export type FullCorpusPublicGraphArchiveObject<T extends FullCorpusPublicGraphShard | FullCorpusPublicGraphManifest> = {
  value: T;
  archiveBody: Buffer;
  receipt: FullCorpusPublicGraphArchiveReceipt;
  receiptBody: Buffer;
};

export type FullCorpusPublicGraphArchiveWriteResult = {
  artifactDigest: string;
  archiveKey: string;
  receiptKey: string;
  archiveStatus: 'written' | 'reused';
  receiptStatus: 'written' | 'reused';
};

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const SHARD_KINDS: FullCorpusPublicGraphShardKind[] = ['render', 'node', 'edge', 'evaluation', 'ego'];
export const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export const LINEAGE_KEYS = [
  'binding', 'pipelineVersion', 'relationshipInputManifestDigest',
  'relationshipInputArchiveSetSha256', 'relationshipInputRecordSetSha256',
  'rarityIndexDigest', 'typedRelationshipSchemaVersion',
  'typedRelationshipRarityVersion', 'typedRelationshipPolicyVersion',
  'typedRelationshipPolicySha256', 'typedRelationshipModel',
  'typedRelationshipModelSha256',
] as const;
export const BINDING_KEYS = [
  'snapshotId', 'corpusVersion', 'universeArchiveVersion', 'universeSchemaVersion',
  'universeLayoutVersion', 'universeArchiveSetSha256', 'universeRecordCount',
] as const;
export const STATUS_RECEIPT_KEYS = [
  'recordType', 'schemaVersion', 'address', 'relationshipInputRecordDigest',
  'relationshipStatus', 'edgeIds', 'candidateEvaluationIds', 'skippedGroupReceiptIds',
  'decisionCode', 'plainEnglish', 'receiptDigest',
] as const;
export const NODE_KEYS = [
  'recordType', 'schemaVersion', 'canonicalVersion', 'universeSchemaVersion',
  'universeLayoutVersion', 'address', 'kind', 'recordId', 'relationshipInputRecordDigest',
  'relationshipStatus', 'source', 'sourceRecordId', 'title', 'summary', 'canonicalUrl',
  'previewUrl', 'eventTimestamp', 'lat', 'lon', 'location', 'countryCode',
  'linkedSightingId', 'updatedAt', 'position', 'degree', 'neighbourCount',
  'candidateEvaluationCount', 'edgeTypeCounts', 'statusReceipt', 'nodeDigest',
] as const;
export const RENDER_ROW_KEYS = [
  'address', 'kind', 'eventTimestamp', 'position', 'relationshipStatus', 'degree',
  'nodeShard', 'egoShard',
] as const;
export const EDGE_KEYS = [
  'recordType', 'schemaVersion', 'canonicalVersion', 'edgeId', 'edgeType',
  'endpoints', 'strength', 'receipt', 'edgeDigest',
] as const;
export const EVALUATION_KEYS = [
  'recordType', 'schemaVersion', 'evaluationId', 'addresses', 'candidateReasons',
  'emittedEdgeIds', 'evaluation', 'plainEnglish', 'receiptDigest',
] as const;
export const EGO_KEYS = [
  'recordType', 'schemaVersion', 'address', 'nodeDigest', 'relationshipStatus',
  'statusReceiptDigest', 'edgeReferences', 'evaluationReceiptIds', 'egoDigest',
] as const;
export const SHARD_KEYS = [
  'recordType', 'schemaVersion', 'lineage', 'completionDigest', 'runIndexPointerDigest',
  'shardKind', 'shard', 'shardCount', 'itemCount', 'firstKey', 'lastKey', 'items',
  'itemSetSha256', 'shardDigest',
] as const;
export const SHARD_SUMMARY_KEYS = [
  'shardKind', 'shard', 'shardCount', 'itemCount', 'firstKey', 'lastKey',
  'itemSetSha256', 'shardDigest', 'artifactDigest', 'archiveKey', 'receiptKey',
  'uncompressedBytes', 'compressedBytes', 'compressedSha256',
  'renderAddressLookupSha256', 'renderLodIndexSha256', 'renderAddressUtf8Bytes',
  'renderPackedBytes', 'renderLodIndexBytes',
] as const;
export const CONTEXTUAL_COMPLETION_BINDING_KEYS = [
  'schemaVersion', 'completionId', 'completionDigest', 'sourceCompletionSetSha256',
  'contextualIdentitySha256', 'entrySetSha256', 'calibrationReceiptId',
  'calibrationReceiptSha256', 'accounting', 'zeroObservationState',
  'acceptedEdgeIdSetSha256',
] as const;
const CONTEXTUAL_COMPLETION_ACCOUNTING_KEYS = [
  'sourceSnapshotCount', 'sourceKindCount', 'sourceRecordCount', 'acceptedEdgeCount',
  'insufficientEvidenceCount', 'uniqueAddressCount', 'addressStatusCounts',
  'sourceKindCounts',
] as const;
const CONTEXTUAL_COMPLETION_ADDRESS_STATUS_KEYS = [
  'accepted_only', 'insufficient_only', 'mixed',
] as const;
const CONTEXTUAL_COMPLETION_SOURCE_KINDS = [
  'aircraft', 'satellite', 'astronomy', 'weather',
] as const;
const CONTEXTUAL_COMPLETION_SOURCE_KIND_ACCOUNTING_KEYS = [
  'sourceSnapshotCount', 'sourceRecordCount', 'acceptedEdgeCount',
  'insufficientEvidenceCount',
] as const;
export const MANIFEST_KEYS = [
  'recordType', 'schemaVersion', 'archiveVersion', 'pipelineVersion',
  'pipelineArchiveVersion', 'lineage', 'completionDigest', 'runIndexPointer',
  'contextualRelationshipCompletion',
  'universeNodeCount', 'addressKindCounts', 'renderRowCount',
  'renderAddressKindCounts', 'renderAddressSetSha256', 'renderSetSha256',
  'renderUncompressedBytes', 'renderCompressedBytes', 'renderFormat',
  'renderAddressOrder', 'renderPackedLayout', 'renderPackedLayoutSha256',
  'renderAddressLookupSetSha256', 'renderLodPolicy', 'renderLodPolicySha256',
  'renderLodIndexSetSha256', 'renderTemporalMapping', 'renderTemporalMappingSha256',
  'renderAddressUtf8Bytes', 'renderPackedBytes',
  'renderLodIndexBytes', 'renderRetainedBytes', 'renderRetainedBudgetBytes',
  'renderInFlightDecodeBudgetBytes', 'renderBufferAllocation', 'fullNodeMetadataAccess',
  'relationshipStatusCounts',
  'typedEdgeCount', 'typedEdgeTypeCounts', 'pairReducerTypedEdgeCount',
  'pairReducerTypedEdgeIdSetSha256', 'evaluationReceiptCount',
  'skippedGroupReceiptCount', 'universeNodeSetSha256', 'nodeSetSha256',
  'typedEdgeIdSetSha256', 'publicEdgeSetSha256', 'evaluationSetSha256',
  'statusReceiptSetSha256', 'egoSetSha256', 'shards', 'shardSetSha256',
  'claimDiscipline', 'manifestDigest',
] as const;
export const ARCHIVE_RECEIPT_KEYS = [
  'recordType', 'schemaVersion', 'lineage', 'completionDigest', 'runIndexPointerDigest',
  'artifactKind', 'artifactDigest', 'archiveKey', 'receiptKey', 'uncompressedBytes',
  'compressedBytes', 'compressedSha256', 'receiptDigest',
] as const;

export function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const requireExactKeys = (value: unknown, keys: readonly string[], code: string): Record<string, unknown> => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};

export const safeCount = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(code);
  return Number(value);
};

export const validateSortedStrings = (value: unknown, code: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.length)) invalid(code);
  const strings = value as string[];
  if (strings.some((item, index) => index > 0 && strings[index - 1] >= item)) invalid(code);
  return strings;
};

export const validateExactCounts = <K extends string>(
  value: unknown,
  keys: readonly K[],
  code: string,
): Record<K, number> => {
  const record = requireExactKeys(value, keys, code);
  return Object.fromEntries(keys.map((key) => [key, safeCount(record[key], code)])) as Record<K, number>;
};

const validateContextualCompletionAccounting = (
  value: unknown,
): ContextualRelationshipCompletionAccounting => {
  const accounting = requireExactKeys(
    value,
    CONTEXTUAL_COMPLETION_ACCOUNTING_KEYS,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const sourceSnapshotCount = safeCount(
    accounting.sourceSnapshotCount,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const sourceKindCount = safeCount(
    accounting.sourceKindCount,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const sourceRecordCount = safeCount(
    accounting.sourceRecordCount,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const acceptedEdgeCount = safeCount(
    accounting.acceptedEdgeCount,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const insufficientEvidenceCount = safeCount(
    accounting.insufficientEvidenceCount,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const uniqueAddressCount = safeCount(
    accounting.uniqueAddressCount,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const addressStatusCounts = validateExactCounts(
    accounting.addressStatusCounts,
    CONTEXTUAL_COMPLETION_ADDRESS_STATUS_KEYS,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const sourceKindCountsRecord = requireExactKeys(
    accounting.sourceKindCounts,
    CONTEXTUAL_COMPLETION_SOURCE_KINDS,
    'full_corpus_public_graph_contextual_completion_accounting_invalid',
  );
  const sourceKindCounts = Object.fromEntries(CONTEXTUAL_COMPLETION_SOURCE_KINDS.map((kind) => [
    kind,
    validateExactCounts(
      sourceKindCountsRecord[kind],
      CONTEXTUAL_COMPLETION_SOURCE_KIND_ACCOUNTING_KEYS,
      'full_corpus_public_graph_contextual_completion_accounting_invalid',
    ),
  ])) as ContextualRelationshipCompletionAccounting['sourceKindCounts'];
  const sourceKindTotals = CONTEXTUAL_COMPLETION_SOURCE_KINDS.reduce((totals, kind) => {
    const counts = sourceKindCounts[kind];
    totals.sourceSnapshotCount += counts.sourceSnapshotCount;
    totals.sourceRecordCount += counts.sourceRecordCount;
    totals.acceptedEdgeCount += counts.acceptedEdgeCount;
    totals.insufficientEvidenceCount += counts.insufficientEvidenceCount;
    return totals;
  }, {
    sourceSnapshotCount: 0,
    sourceRecordCount: 0,
    acceptedEdgeCount: 0,
    insufficientEvidenceCount: 0,
  });
  if (
    sourceKindCount !== CONTEXTUAL_COMPLETION_SOURCE_KINDS.length
    || sourceSnapshotCount < CONTEXTUAL_COMPLETION_SOURCE_KINDS.length
    || CONTEXTUAL_COMPLETION_SOURCE_KINDS.some((kind) => (
      sourceKindCounts[kind].sourceSnapshotCount < 1
    ))
    || sourceRecordCount !== acceptedEdgeCount + insufficientEvidenceCount
    || uniqueAddressCount > sourceRecordCount
    || Object.values(addressStatusCounts).reduce((sum, count) => sum + count, 0)
      !== uniqueAddressCount
    || sourceKindTotals.sourceSnapshotCount !== sourceSnapshotCount
    || sourceKindTotals.sourceRecordCount !== sourceRecordCount
    || sourceKindTotals.acceptedEdgeCount !== acceptedEdgeCount
    || sourceKindTotals.insufficientEvidenceCount !== insufficientEvidenceCount
  ) invalid('full_corpus_public_graph_contextual_completion_accounting_invalid');
  return {
    sourceSnapshotCount,
    sourceKindCount: CONTEXTUAL_COMPLETION_SOURCE_KINDS.length,
    sourceRecordCount,
    acceptedEdgeCount,
    insufficientEvidenceCount,
    uniqueAddressCount,
    addressStatusCounts,
    sourceKindCounts,
  };
};

export const validateContextualCompletionBinding = (
  value: unknown,
): FullCorpusPublicContextualRelationshipCompletionBinding => {
  const binding = requireExactKeys(
    value,
    CONTEXTUAL_COMPLETION_BINDING_KEYS,
    'full_corpus_public_graph_contextual_completion_binding_invalid',
  );
  const accounting = validateContextualCompletionAccounting(binding.accounting);
  if (
    binding.schemaVersion !== CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION
    || typeof binding.completionId !== 'string'
    || !/^contextual-completion:[a-f0-9]{64}$/.test(binding.completionId)
    || typeof binding.calibrationReceiptId !== 'string'
    || !/^contextual-calibration:[a-f0-9]{64}$/.test(binding.calibrationReceiptId)
    || typeof binding.zeroObservationState !== 'boolean'
    || binding.zeroObservationState !== (accounting.sourceRecordCount === 0)
    || binding.contextualIdentitySha256
      !== CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256
  ) invalid('full_corpus_public_graph_contextual_completion_binding_invalid');
  for (const digest of [
    binding.completionDigest,
    binding.sourceCompletionSetSha256,
    binding.contextualIdentitySha256,
    binding.entrySetSha256,
    binding.calibrationReceiptSha256,
    binding.acceptedEdgeIdSetSha256,
  ]) if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
    invalid('full_corpus_public_graph_contextual_completion_binding_invalid');
  }
  return {
    schemaVersion: CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
    completionId: binding.completionId,
    completionDigest: binding.completionDigest as string,
    sourceCompletionSetSha256: binding.sourceCompletionSetSha256 as string,
    contextualIdentitySha256: binding.contextualIdentitySha256 as string,
    entrySetSha256: binding.entrySetSha256 as string,
    calibrationReceiptId: binding.calibrationReceiptId,
    calibrationReceiptSha256: binding.calibrationReceiptSha256 as string,
    accounting,
    zeroObservationState: binding.zeroObservationState,
    acceptedEdgeIdSetSha256: binding.acceptedEdgeIdSetSha256 as string,
  };
};

export const validatePublicLineage = (value: unknown): FullCorpusPipelineLineage => {
  const lineage = requireExactKeys(value, LINEAGE_KEYS, 'full_corpus_public_graph_lineage_invalid');
  requireExactKeys(lineage.binding, BINDING_KEYS, 'full_corpus_public_graph_lineage_binding_invalid');
  try {
    return decodeFullCorpusPipelineLineage(lineage as unknown as FullCorpusPipelineLineage);
  } catch {
    return invalid('full_corpus_public_graph_lineage_invalid');
  }
};

export const digestValue = (value: unknown) => relationshipInputSha256(value);
export const rawSha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export const publicGraphArchivePrefix = (params: {
  lineage: FullCorpusPipelineLineage;
  completionDigest: string;
  runIndexPointerDigest: string;
}) => [
  'case-vortex',
  'corpora',
  params.lineage.binding.corpusVersion,
  'public-typed-relationship-graph-v2',
  params.lineage.binding.snapshotId,
  params.completionDigest,
  params.runIndexPointerDigest,
].join('/');

export const emptyEdgeTypeCounts = (): Record<TypedRelationshipEdgeType, number> => Object.fromEntries(
  FULL_CORPUS_TYPED_EDGE_TYPES.map((edgeType) => [edgeType, 0]),
) as Record<TypedRelationshipEdgeType, number>;

export const itemKey = (
  item: FullCorpusPublicRenderRow | FullCorpusPublicNode | FullCorpusPublicEdge | FullCorpusPublicEvaluationReceipt | FullCorpusPublicEgo,
) => {
  if (!('recordType' in item)) return item.address;
  switch (item.recordType) {
    case 'full_corpus_public_node': return item.address;
    case 'full_corpus_public_edge': return item.edgeId;
    case 'full_corpus_public_evaluation_receipt': return item.evaluationId;
    case 'full_corpus_public_ego': return item.address;
  }
};

export const itemDigest = (
  item: FullCorpusPublicRenderRow | FullCorpusPublicNode | FullCorpusPublicEdge | FullCorpusPublicEvaluationReceipt | FullCorpusPublicEgo,
) => {
  if (!('recordType' in item)) return digestValue(item);
  switch (item.recordType) {
    case 'full_corpus_public_node': return item.nodeDigest;
    case 'full_corpus_public_edge': return item.edgeDigest;
    case 'full_corpus_public_evaluation_receipt': return item.receiptDigest;
    case 'full_corpus_public_ego': return item.egoDigest;
  }
};

export const withoutField = <T extends Record<string, unknown>>(value: T, field: keyof T) => {
  const clone = { ...value };
  delete clone[field];
  return clone;
};

export const validateUniverseNode = (node: EvidenceUniverseNode) => {
  const projected = projectEvidenceUniverseNode({
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
    public: true,
  });
  if (canonicalizeRelationshipInput(projected) !== canonicalizeRelationshipInput(node)) {
    invalid('full_corpus_public_graph_universe_node_invalid');
  }
  return projected;
};

const buildStatusReceipt = (params: {
  state: FullCorpusAddressState;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  edgeIds: string[];
  evaluationIds: string[];
  skippedReceiptIds: string[];
}): FullCorpusPublicStatusReceipt => {
  const relationshipStatus = params.relationshipStatus;
  const decisionCode: FullCorpusPublicStatusReceipt['decisionCode'] = relationshipStatus === 'linked'
    ? 'typed_edge_emitted'
    : relationshipStatus === 'candidate_only' ? 'evaluated_no_edge' : 'no_bounded_candidate_route';
  const skipped = params.skippedReceiptIds.length
    ? ` ${params.skippedReceiptIds.length} oversized or unresolved candidate group receipt(s) remain explicit and unresolved.`
    : '';
  const plainEnglish = relationshipStatus === 'linked'
    ? `This evidence address has ${params.edgeIds.length} governed typed edge(s). Each edge must be read with its own receipt.`
    : relationshipStatus === 'candidate_only'
      ? `This evidence address entered ${params.evaluationIds.length} bounded candidate evaluation(s), but no typed edge passed the frozen policy.${skipped}`
      : `This evidence address remains visible with no bounded candidate evaluation. This is an explicit graph state, not negative evidence.${skipped}`;
  const withoutDigest = {
    recordType: 'full_corpus_public_status_receipt' as const,
    schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
    address: params.state.address,
    relationshipInputRecordDigest: params.state.recordDigest,
    relationshipStatus,
    edgeIds: [...params.edgeIds].sort(compareText),
    candidateEvaluationIds: [...params.evaluationIds].sort(compareText),
    skippedGroupReceiptIds: [...params.skippedReceiptIds].sort(compareText),
    decisionCode,
    plainEnglish,
  };
  return { ...withoutDigest, receiptDigest: digestValue(withoutDigest) };
};

const buildPublicEdge = (edge: TypedRelationshipEdge): FullCorpusPublicEdge => {
  const withoutDigest = {
    recordType: 'full_corpus_public_edge' as const,
    schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    edgeId: edge.edgeId,
    edgeType: edge.edgeType,
    endpoints: edge.endpoints,
    strength: edge.strength,
    receipt: edge.receipt,
  };
  return { ...withoutDigest, edgeDigest: digestValue(withoutDigest) };
};

const pairKeyFromAddresses = (addresses: [string, string]) => `pair:${digestValue([...addresses].sort(compareText))}`;

const buildCandidateReasonIndex = (reductions: readonly FullCorpusPostingShardReduction[]) => {
  const byPair = new Map<string, Map<string, FullCorpusCandidateReason>>();
  for (const reduction of reductions) for (const fragment of reduction.candidateFragments) {
    for (const candidate of fragment.candidates) {
      const addresses = [
        fragment.records[candidate.leftRecordIndex].address,
        fragment.records[candidate.rightRecordIndex].address,
      ].sort(compareText) as [string, string];
      const pairKey = pairKeyFromAddresses(addresses);
      if (candidate.pairKey !== pairKey) invalid('full_corpus_public_graph_candidate_pair_mismatch');
      const reasons = byPair.get(pairKey) || new Map<string, FullCorpusCandidateReason>();
      for (const reason of candidate.reasons) reasons.set(reason.reasonId, reason);
      byPair.set(pairKey, reasons);
    }
  }
  return byPair;
};

const buildEvaluationReceipts = (params: {
  reducers: readonly FullCorpusPairReducerResult[];
  recordDigestToAddress: Map<string, string>;
  candidateReasons: Map<string, Map<string, FullCorpusCandidateReason>>;
}) => {
  const receipts: FullCorpusPublicEvaluationReceipt[] = [];
  for (const reducer of params.reducers) for (const evaluation of reducer.evaluations) {
    const mapped = evaluation.inputRecordDigests.map((digest) => params.recordDigestToAddress.get(digest));
    if (mapped.length !== 2 || !mapped[0] || !mapped[1] || mapped[0] === mapped[1]) {
      invalid('full_corpus_public_graph_evaluation_address_missing');
    }
    const addresses = [mapped[0], mapped[1]].sort(compareText) as [string, string];
    const pairKey = pairKeyFromAddresses(addresses);
    const candidateReasons = [...(params.candidateReasons.get(pairKey)?.values() || [])]
      .sort((left, right) => compareText(left.reasonId, right.reasonId));
    if (!candidateReasons.length) invalid('full_corpus_public_graph_candidate_reason_missing');
    const emittedEdgeIds = evaluation.edges.map((edge) => edge.edgeId).sort(compareText);
    const withoutDigest = {
      recordType: 'full_corpus_public_evaluation_receipt' as const,
      schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
      evaluationId: `public-evaluation:${evaluation.evaluationDigest}`,
      addresses,
      candidateReasons,
      emittedEdgeIds,
      evaluation,
      plainEnglish: emittedEdgeIds.length
        ? `The frozen typed evaluator emitted ${emittedEdgeIds.length} governed edge(s) for this bounded candidate pair.`
        : 'The pair entered the frozen typed evaluator, but no edge passed. The machine-readable rejection reasons are retained; this is not evidence that the records are unrelated.',
    };
    receipts.push({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
  }
  return receipts.sort((left, right) => compareText(left.evaluationId, right.evaluationId));
};

const buildSkippedAddressIndex = (
  postingFragments: readonly FullCorpusPostingFragment[],
  reductions: readonly FullCorpusPostingShardReduction[],
) => {
  const skippedByRoute = new Map<string, string>();
  for (const reduction of reductions) for (const receipt of reduction.skippedGroups) {
    skippedByRoute.set(`${receipt.postingShard}:${receipt.routeSignature}`, receipt.receiptId);
  }
  const byAddress = new Map<string, Set<string>>();
  for (const fragment of postingFragments) for (const posting of fragment.postings) {
    const receiptId = skippedByRoute.get(`${fragment.postingShard}:${posting.signature}`);
    if (!receiptId) continue;
    const address = fragment.records[posting.recordIndex].address;
    const ids = byAddress.get(address) || new Set<string>();
    ids.add(receiptId);
    byAddress.set(address, ids);
  }
  return byAddress;
};

const shardWithoutDigest = (value: Omit<FullCorpusPublicGraphShard, 'shardDigest'>) => value;

const buildShards = <T extends FullCorpusPublicRenderRow | FullCorpusPublicNode | FullCorpusPublicEdge | FullCorpusPublicEvaluationReceipt | FullCorpusPublicEgo>(params: {
  lineage: FullCorpusPipelineLineage;
  completionDigest: string;
  runIndexPointerDigest: string;
  shardKind: FullCorpusPublicGraphShardKind;
  shardCount: number;
  items: readonly T[];
}): FullCorpusPublicGraphShard[] => {
  if (!Number.isSafeInteger(params.shardCount) || params.shardCount < 1 || params.shardCount > 4096) {
    invalid('full_corpus_public_graph_shard_count_invalid');
  }
  const groups = new Map<number, T[]>();
  for (const item of params.items) {
    const shard = fullCorpusRelationshipShard(itemKey(item), params.shardCount);
    const list = groups.get(shard) || [];
    list.push(item);
    groups.set(shard, list);
  }
  const result: FullCorpusPublicGraphShard[] = [];
  for (let shard = 0; shard < params.shardCount; shard += 1) {
    const items = (groups.get(shard) || []).sort((left, right) => compareText(itemKey(left), itemKey(right)));
    if (params.shardKind === 'render'
      && items.length > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD) {
      invalid('full_corpus_public_graph_render_shard_row_limit_exceeded');
    }
    const withoutDigest: Omit<FullCorpusPublicGraphShard, 'shardDigest'> = {
      recordType: 'full_corpus_public_graph_shard',
      schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
      lineage: params.lineage,
      completionDigest: params.completionDigest,
      runIndexPointerDigest: params.runIndexPointerDigest,
      shardKind: params.shardKind,
      shard,
      shardCount: params.shardCount,
      itemCount: items.length,
      firstKey: items.length ? itemKey(items[0]) : null,
      lastKey: items.length ? itemKey(items[items.length - 1]) : null,
      items,
      itemSetSha256: digestValue(items.map((item) => `${itemKey(item)}:${itemDigest(item)}`).join('\n')),
    };
    result.push({ ...withoutDigest, shardDigest: digestValue(shardWithoutDigest(withoutDigest)) });
  }
  return result;
};

export const shardSummary = (shard: FullCorpusPublicGraphShard): FullCorpusPublicGraphShardSummary => {
  const archive = encodeFullCorpusPublicGraphArchiveObject(shard);
  const renderPacking = shard.shardKind === 'render'
    ? buildFullCorpusPublicRenderPackingReceipt(shard.items as FullCorpusPublicRenderRow[])
    : null;
  return {
    shardKind: shard.shardKind,
    shard: shard.shard,
    shardCount: shard.shardCount,
    itemCount: shard.itemCount,
    firstKey: shard.firstKey,
    lastKey: shard.lastKey,
    itemSetSha256: shard.itemSetSha256,
    shardDigest: shard.shardDigest,
    artifactDigest: archive.receipt.artifactDigest,
    archiveKey: archive.receipt.archiveKey,
    receiptKey: archive.receipt.receiptKey,
    uncompressedBytes: archive.receipt.uncompressedBytes,
    compressedBytes: archive.receipt.compressedBytes,
    compressedSha256: archive.receipt.compressedSha256,
    renderAddressLookupSha256: renderPacking?.addressLookupSha256 ?? null,
    renderLodIndexSha256: renderPacking?.lodIndexSha256 ?? null,
    renderAddressUtf8Bytes: renderPacking?.addressUtf8Bytes ?? null,
    renderPackedBytes: renderPacking?.packedBytes ?? null,
    renderLodIndexBytes: renderPacking?.lodIndexBytes ?? null,
  };
};

const manifestWithoutDigest = (value: Omit<FullCorpusPublicGraphManifest, 'manifestDigest'>) => value;

const verifyRunIndexCoverage = (params: {
  index: FullCorpusRelationshipRunIndex;
  receipts: readonly (FullCorpusRelationshipArchiveReceipt | Buffer | string)[];
  lineage: FullCorpusPipelineLineage;
  postingFragments: readonly FullCorpusPostingFragment[];
  postingMap: FullCorpusPostingMapManifest;
  postingReductions: readonly FullCorpusPostingShardReduction[];
  pairReducers: readonly FullCorpusPairReducerResult[];
  contextualCompletion: ContextualRelationshipCompletionArtifact;
  completion: FullCorpusRelationshipCompletion;
}) => {
  const expectedValues: Array<{
    artifactType: Exclude<FullCorpusRelationshipArtifactType, 'run_index'>;
    value: unknown;
  }> = [
    ...params.postingFragments.map((value) => ({ artifactType: 'posting_fragment' as const, value })),
    { artifactType: 'posting_map', value: params.postingMap },
    ...params.postingReductions.flatMap((reduction) => [
      { artifactType: 'posting_reduction' as const, value: reduction },
      ...reduction.candidateFragments.map((value) => ({ artifactType: 'candidate_fragment' as const, value })),
    ]),
    ...params.pairReducers.map((value) => ({ artifactType: 'pair_reducer' as const, value })),
    { artifactType: 'contextual_completion', value: params.contextualCompletion },
    ...params.completion.addressLedgerShards.map((value) => ({ artifactType: 'address_ledger' as const, value })),
    { artifactType: 'completion', value: params.completion },
  ];
  const expected = expectedValues.map(({ artifactType, value }) => ({
    artifactType,
    artifactDigest: fullCorpusRelationshipArtifactSha256(value),
  })).sort((left, right) => compareText(left.artifactType, right.artifactType)
    || compareText(left.artifactDigest, right.artifactDigest));
  if (new Set(expected.map((entry) => `${entry.artifactType}:${entry.artifactDigest}`)).size !== expected.length) {
    invalid('full_corpus_public_graph_run_index_expected_artifact_duplicate');
  }
  const receipts = params.receipts.map((receipt) => decodeFullCorpusRelationshipArchiveReceipt(
    receipt,
    params.lineage,
  )).sort((left, right) => compareText(left.artifactType, right.artifactType)
    || compareText(left.artifactDigest, right.artifactDigest));
  if (receipts.some((receipt) => receipt.artifactType === 'run_index')
    || receipts.length !== expected.length
    || new Set(receipts.map((receipt) => receipt.archiveKey)).size !== receipts.length) {
    invalid('full_corpus_public_graph_run_index_receipt_coverage_mismatch');
  }
  const indexEntries = [...params.index.objects].sort((left, right) => compareText(left.artifactType, right.artifactType)
    || compareText(left.artifactDigest, right.artifactDigest));
  if (indexEntries.length !== expected.length) invalid('full_corpus_public_graph_run_index_coverage_mismatch');
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const receipt = receipts[index];
    const entry = indexEntries[index];
    if (!receipt || !entry
      || receipt.artifactType !== wanted.artifactType
      || receipt.artifactDigest !== wanted.artifactDigest
      || entry.artifactType !== wanted.artifactType
      || entry.artifactDigest !== wanted.artifactDigest
      || entry.archiveKey !== receipt.archiveKey
      || entry.receiptKey !== receipt.receiptKey
      || entry.compressedSha256 !== receipt.compressedSha256) {
      invalid('full_corpus_public_graph_run_index_coverage_mismatch');
    }
  }
};

export const buildFullCorpusPublicGraphArtifacts = (params: {
  universeNodes: readonly EvidenceUniverseNode[];
  postingFragments: readonly FullCorpusPostingFragment[];
  postingMap: FullCorpusPostingMapManifest;
  postingReductions: readonly FullCorpusPostingShardReduction[];
  pairReducers: readonly FullCorpusPairReducerResult[];
  contextualRelationshipCompletion: ContextualRelationshipCompletionArtifact | Buffer | string;
  expectedContextualCalibrationReceiptId: string;
  expectedContextualCalibrationReceiptSha256: string;
  completion: FullCorpusRelationshipCompletion;
  runIndexPointer: FullCorpusRelationshipRunIndexPointer;
  runIndexArchiveBody: Buffer;
  runIndexReceipt: FullCorpusRelationshipArchiveReceipt | Buffer | string;
  runArtifactReceipts: readonly (FullCorpusRelationshipArchiveReceipt | Buffer | string)[];
  renderShardCount?: number;
  nodeShardCount?: number;
  edgeShardCount?: number;
  evaluationShardCount?: number;
  egoShardCount?: number;
}): FullCorpusPublicGraphArtifacts => {
  const ledgerShardCount = params.completion.addressLedgerShards[0]?.shardCount;
  if (!ledgerShardCount) invalid('full_corpus_public_graph_address_ledger_missing');
  if (!params.contextualRelationshipCompletion
    || !params.expectedContextualCalibrationReceiptId
    || !params.expectedContextualCalibrationReceiptSha256) {
    invalid('full_corpus_public_graph_contextual_completion_required');
  }
  const pairReducerTypedEdges = params.pairReducers.flatMap((reducer) => reducer.edges);
  if (pairReducerTypedEdges.some((edge) => (
    edge.edgeType === 'contextual_explanation_candidate'
    || edge.endpoints.some((endpoint) => endpoint.kind === 'context')
  ))) invalid('full_corpus_public_graph_pair_reducer_contextual_edge_forbidden');
  if (new Set(pairReducerTypedEdges.map((edge) => edge.edgeId)).size !== pairReducerTypedEdges.length) {
    invalid('full_corpus_public_graph_duplicate_edge_id');
  }
  const expectedContextualCalibration = {
    receiptId: params.expectedContextualCalibrationReceiptId,
    receiptSha256: params.expectedContextualCalibrationReceiptSha256,
  };
  const contextualCompletion = assertContextualRelationshipCompletionProductionEligible(
    params.contextualRelationshipCompletion,
    params.postingMap.lineage.binding,
    expectedContextualCalibration,
  );
  const rebuiltCompletion = buildFullCorpusRelationshipCompletion({
    postingMap: params.postingMap,
    postingReductions: params.postingReductions,
    pairReducers: params.pairReducers,
    contextualCompletion,
    expectedContextualCalibration,
    addressLedgerShardCount: ledgerShardCount,
  });
  if (canonicalizeRelationshipInput(rebuiltCompletion) !== canonicalizeRelationshipInput(params.completion)) {
    invalid('full_corpus_public_graph_completion_mismatch');
  }
  const runIndexPointer = decodeFullCorpusRelationshipRunIndexPointer(
    params.runIndexPointer,
    params.completion.lineage,
  );
  const runIndexReceipt = decodeFullCorpusRelationshipArchiveReceipt(
    params.runIndexReceipt,
    params.completion.lineage,
  );
  const runIndex = decodeFullCorpusRelationshipArchiveObject<FullCorpusRelationshipRunIndex>({
    archiveBody: params.runIndexArchiveBody,
    receipt: runIndexReceipt,
    expectedLineage: params.completion.lineage,
  });
  if (runIndexPointer.completionDigest !== params.completion.completionDigest
    || runIndexReceipt.artifactType !== 'run_index'
    || runIndexReceipt.artifactDigest !== runIndexPointer.indexArtifactDigest
    || runIndexReceipt.archiveKey !== runIndexPointer.indexArchiveKey
    || runIndexReceipt.receiptKey !== runIndexPointer.indexReceiptKey
    || runIndex.indexDigest !== runIndexPointer.indexDigest
    || runIndex.artifactSetSha256 !== runIndexPointer.artifactSetSha256
    || runIndex.completionDigest !== runIndexPointer.completionDigest
    || canonicalizeRelationshipInput(runIndex.contextualCompletion)
      !== canonicalizeRelationshipInput(runIndexPointer.contextualCompletion)
    || canonicalizeRelationshipInput(runIndex.contextualCompletion)
      !== canonicalizeRelationshipInput(params.completion.contextualCompletion)
    || runIndex.postingMapDigest !== params.postingMap.mapDigest) {
    invalid('full_corpus_public_graph_run_index_mismatch');
  }
  verifyRunIndexCoverage({
    index: runIndex,
    receipts: params.runArtifactReceipts,
    lineage: params.completion.lineage,
    postingFragments: params.postingFragments,
    postingMap: params.postingMap,
    postingReductions: params.postingReductions,
    pairReducers: params.pairReducers,
    contextualCompletion,
    completion: params.completion,
  });

  const universeNodes = params.universeNodes.map(validateUniverseNode)
    .sort((left, right) => compareText(left.address, right.address));
  const universeAccounting = accountEvidenceUniverseNodes(universeNodes);
  if (
    universeAccounting.total !== params.completion.universeRecordCount
    || canonicalizeRelationshipInput(universeAccounting.byKind)
      !== canonicalizeRelationshipInput(params.completion.addressKindCounts)
  ) invalid('full_corpus_public_graph_universe_accounting_mismatch');
  const stateByAddress = new Map(params.completion.addressLedgerShards
    .flatMap((shard) => shard.states).map((state) => [state.address, state]));
  if (stateByAddress.size !== universeNodes.length
    || universeNodes.some((node) => !stateByAddress.has(node.address))) {
    invalid('full_corpus_public_graph_universe_address_mismatch');
  }
  const recordDigestToAddress = new Map<string, string>();
  for (const state of stateByAddress.values()) {
    if (recordDigestToAddress.has(state.recordDigest)) invalid('full_corpus_public_graph_record_digest_collision');
    recordDigestToAddress.set(state.recordDigest, state.address);
  }

  const pairEdges = [...pairReducerTypedEdges]
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  const contextualEndpointSignatures = new Set<string>();
  const contextualEdges = contextualCompletion.entries
    .filter((entry) => entry.status === 'accepted_edge')
    .map((entry) => {
      const edge = entry.typedEdge;
      const evidenceEndpoints = edge.endpoints.filter((endpoint) => endpoint.kind === 'evidence');
      const contextEndpoints = edge.endpoints.filter((endpoint) => endpoint.kind === 'context');
      if (
        edge.edgeType !== 'contextual_explanation_candidate'
        || edge.endpoints.length !== 2
        || evidenceEndpoints.length !== 1
        || contextEndpoints.length !== 1
        || evidenceEndpoints[0]?.id !== entry.address
        || !stateByAddress.has(entry.address)
      ) invalid('full_corpus_public_graph_contextual_edge_endpoint_conflict');
      const endpointSignature = edge.endpoints
        .map((endpoint) => `${endpoint.kind}:${endpoint.id}`)
        .sort(compareText)
        .join('\u0000');
      if (contextualEndpointSignatures.has(endpointSignature)) {
        invalid('full_corpus_public_graph_contextual_edge_endpoint_conflict');
      }
      contextualEndpointSignatures.add(endpointSignature);
      return edge;
    })
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  if (contextualEdges.length !== contextualCompletion.accounting.acceptedEdgeCount) {
    invalid('full_corpus_public_graph_contextual_edge_accounting_mismatch');
  }
  const typedEdges = [...pairEdges, ...contextualEdges]
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  if (
    typedEdges.length !== params.completion.typedEdgeCount
    || new Set(typedEdges.map((edge) => edge.edgeId)).size !== typedEdges.length
    || digestValue(typedEdges.map((edge) => edge.edgeId).join('\n')) !== params.completion.edgeSetSha256
  ) invalid(new Set(typedEdges.map((edge) => edge.edgeId)).size !== typedEdges.length
    ? 'full_corpus_public_graph_duplicate_edge_id'
    : 'full_corpus_public_graph_edge_set_mismatch');
  for (const edge of typedEdges) for (const endpoint of edge.endpoints) {
    if (endpoint.kind === 'evidence' && !stateByAddress.has(endpoint.id)) {
      invalid('full_corpus_public_graph_edge_endpoint_missing');
    }
  }
  const publicEdges = typedEdges.map(buildPublicEdge);
  const candidateReasons = buildCandidateReasonIndex(params.postingReductions);
  const evaluations = buildEvaluationReceipts({
    reducers: params.pairReducers,
    recordDigestToAddress,
    candidateReasons,
  });
  if (
    evaluations.length !== params.completion.candidatePairCount
    || new Set(evaluations.map((evaluation) => evaluation.evaluationId)).size !== evaluations.length
  ) invalid('full_corpus_public_graph_evaluation_set_mismatch');

  const edgesByAddress = new Map<string, FullCorpusPublicEdge[]>();
  for (const edge of publicEdges) for (const endpoint of edge.endpoints) {
    if (endpoint.kind !== 'evidence') continue;
    const list = edgesByAddress.get(endpoint.id) || [];
    list.push(edge);
    edgesByAddress.set(endpoint.id, list);
  }
  const evaluationsByAddress = new Map<string, FullCorpusPublicEvaluationReceipt[]>();
  for (const evaluation of evaluations) for (const address of evaluation.addresses) {
    const list = evaluationsByAddress.get(address) || [];
    list.push(evaluation);
    evaluationsByAddress.set(address, list);
  }
  const skippedByAddress = buildSkippedAddressIndex(params.postingFragments, params.postingReductions);

  const publicNodes: FullCorpusPublicNode[] = universeNodes.map((universeNode) => {
    const state = stateByAddress.get(universeNode.address) as FullCorpusAddressState;
    const edges = (edgesByAddress.get(universeNode.address) || []).sort((left, right) => compareText(left.edgeId, right.edgeId));
    const nodeEvaluations = (evaluationsByAddress.get(universeNode.address) || [])
      .sort((left, right) => compareText(left.evaluationId, right.evaluationId));
    // Contextual insufficient-evidence entries are retained in the completion
    // accounting only. They do not turn a public address into a candidate or a
    // link; only an accepted contextual edge can affect the public graph.
    const relationshipStatus: FullCorpusPublicRelationshipStatus = edges.length
      ? 'linked'
      : nodeEvaluations.length ? 'candidate_only' : 'isolated';
    const neighbours = new Set(edges.flatMap((edge) => edge.endpoints
      .filter((endpoint) => endpoint.kind === 'evidence' && endpoint.id !== universeNode.address)
      .map((endpoint) => endpoint.id)));
    const edgeTypeCounts = emptyEdgeTypeCounts();
    for (const edge of edges) edgeTypeCounts[edge.edgeType] += 1;
    const statusReceipt = buildStatusReceipt({
      state,
      relationshipStatus,
      edgeIds: edges.map((edge) => edge.edgeId),
      evaluationIds: nodeEvaluations.map((evaluation) => evaluation.evaluationId),
      skippedReceiptIds: [...(skippedByAddress.get(universeNode.address) || [])],
    });
    const withoutDigest = {
      recordType: 'full_corpus_public_node' as const,
      schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
      canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
      universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      address: universeNode.address,
      kind: universeNode.kind,
      recordId: universeNode.recordId,
      relationshipInputRecordDigest: state.recordDigest,
      relationshipStatus,
      source: universeNode.source,
      sourceRecordId: universeNode.sourceRecordId,
      title: universeNode.title,
      summary: universeNode.summary,
      canonicalUrl: universeNode.canonicalUrl,
      previewUrl: universeNode.previewUrl,
      eventTimestamp: universeNode.eventTimestamp,
      lat: universeNode.lat,
      lon: universeNode.lon,
      location: universeNode.location,
      countryCode: universeNode.countryCode,
      linkedSightingId: universeNode.linkedSightingId,
      updatedAt: universeNode.updatedAt,
      position: universeNode.position,
      degree: edges.length,
      neighbourCount: neighbours.size,
      candidateEvaluationCount: nodeEvaluations.length,
      edgeTypeCounts,
      statusReceipt,
    };
    return { ...withoutDigest, nodeDigest: digestValue(withoutDigest) };
  });

  const publicEgos: FullCorpusPublicEgo[] = publicNodes.map((node) => {
    const edges = (edgesByAddress.get(node.address) || []).sort((left, right) => compareText(left.edgeId, right.edgeId));
    const withoutDigest = {
      recordType: 'full_corpus_public_ego' as const,
      schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
      address: node.address,
      nodeDigest: node.nodeDigest,
      relationshipStatus: node.relationshipStatus,
      statusReceiptDigest: node.statusReceipt.receiptDigest,
      edgeReferences: edges.map((edge): FullCorpusPublicEgoEdgeReference => ({
        edgeId: edge.edgeId,
        edgeType: edge.edgeType,
        strength: edge.strength,
        receiptId: edge.receipt.receiptId,
        otherEndpoints: edge.endpoints.filter((endpoint) => endpoint.kind !== 'evidence' || endpoint.id !== node.address),
      })),
      evaluationReceiptIds: (evaluationsByAddress.get(node.address) || [])
        .map((evaluation) => evaluation.evaluationId).sort(compareText),
    };
    return { ...withoutDigest, egoDigest: digestValue(withoutDigest) };
  });

  const renderShardCount = params.renderShardCount ?? 64;
  const nodeShardCount = params.nodeShardCount ?? 64;
  const egoShardCount = params.egoShardCount ?? 64;
  const publicRenderRows: FullCorpusPublicRenderRow[] = publicNodes.map((node) => ({
    address: node.address,
    kind: node.kind,
    eventTimestamp: node.eventTimestamp,
    position: node.position,
    relationshipStatus: node.relationshipStatus,
    degree: node.degree,
    nodeShard: fullCorpusRelationshipShard(node.address, nodeShardCount),
    egoShard: fullCorpusRelationshipShard(node.address, egoShardCount),
  }));

  const shards = [
    ...buildShards({
      lineage: params.completion.lineage,
      completionDigest: params.completion.completionDigest,
      runIndexPointerDigest: runIndexPointer.pointerDigest,
      shardKind: 'render',
      shardCount: renderShardCount,
      items: publicRenderRows,
    }),
    ...buildShards({
      lineage: params.completion.lineage,
      completionDigest: params.completion.completionDigest,
      runIndexPointerDigest: runIndexPointer.pointerDigest,
      shardKind: 'node',
      shardCount: nodeShardCount,
      items: publicNodes,
    }),
    ...buildShards({
      lineage: params.completion.lineage,
      completionDigest: params.completion.completionDigest,
      runIndexPointerDigest: runIndexPointer.pointerDigest,
      shardKind: 'edge',
      shardCount: params.edgeShardCount ?? 64,
      items: publicEdges,
    }),
    ...buildShards({
      lineage: params.completion.lineage,
      completionDigest: params.completion.completionDigest,
      runIndexPointerDigest: runIndexPointer.pointerDigest,
      shardKind: 'evaluation',
      shardCount: params.evaluationShardCount ?? 64,
      items: evaluations,
    }),
    ...buildShards({
      lineage: params.completion.lineage,
      completionDigest: params.completion.completionDigest,
      runIndexPointerDigest: runIndexPointer.pointerDigest,
      shardKind: 'ego',
      shardCount: egoShardCount,
      items: publicEgos,
    }),
  ].sort((left, right) => compareText(left.shardKind, right.shardKind) || left.shard - right.shard);
  const summaries = shards.map(shardSummary);
  const renderSummaries = summaries.filter((summary) => summary.shardKind === 'render');
  const statusCounts: Record<FullCorpusPublicRelationshipStatus, number> = {
    linked: publicNodes.filter((node) => node.relationshipStatus === 'linked').length,
    candidate_only: publicNodes.filter((node) => node.relationshipStatus === 'candidate_only').length,
    isolated: publicNodes.filter((node) => node.relationshipStatus === 'isolated').length,
  };
  const typedEdgeTypeCounts = emptyEdgeTypeCounts();
  for (const edge of publicEdges) typedEdgeTypeCounts[edge.edgeType] += 1;
  const contextualRelationshipCompletion: FullCorpusPublicContextualRelationshipCompletionBinding = {
    schemaVersion: CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
    completionId: contextualCompletion.completionId,
    completionDigest: contextualCompletion.completionDigest,
    sourceCompletionSetSha256: contextualCompletion.sourceCompletionSetSha256,
    contextualIdentitySha256: contextualCompletion.contextualIdentitySha256,
    entrySetSha256: contextualCompletion.entrySetSha256,
    calibrationReceiptId: contextualCompletion.calibrationReceipt.receiptId,
    calibrationReceiptSha256: contextualCompletion.calibrationReceipt.receiptSha256,
    accounting: contextualCompletion.accounting,
    zeroObservationState: contextualCompletion.zeroObservationState,
    acceptedEdgeIdSetSha256: digestValue(contextualEdges.map((edge) => edge.edgeId).join('\n')),
  };
  validateContextualCompletionBinding(contextualRelationshipCompletion);
  const universeNodeSetSha256 = digestValue(universeNodes.map((node) => (
    `${node.address}:${fullCorpusRelationshipArtifactSha256(node)}`
  )).join('\n'));
  const withoutManifestDigest: Omit<FullCorpusPublicGraphManifest, 'manifestDigest'> = {
    recordType: 'full_corpus_public_graph_manifest',
    schemaVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
    archiveVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION,
    pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    pipelineArchiveVersion: FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
    lineage: params.completion.lineage,
    completionDigest: params.completion.completionDigest,
    runIndexPointer,
    contextualRelationshipCompletion,
    universeNodeCount: publicNodes.length,
    addressKindCounts: params.completion.addressKindCounts,
    renderRowCount: publicRenderRows.length,
    renderAddressKindCounts: params.completion.addressKindCounts,
    renderAddressSetSha256: digestValue(publicRenderRows.map((row) => row.address).join('\n')),
    renderSetSha256: digestValue(publicRenderRows.map((row) => `${row.address}:${digestValue(row)}`).join('\n')),
    renderUncompressedBytes: renderSummaries.reduce((sum, summary) => sum + summary.uncompressedBytes, 0),
    renderCompressedBytes: renderSummaries.reduce((sum, summary) => sum + summary.compressedBytes, 0),
    renderFormat: PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT,
    renderAddressOrder: PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER,
    renderPackedLayout: PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT,
    renderPackedLayoutSha256: digestValue(PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT),
    renderAddressLookupSetSha256: digestValue(renderSummaries.map((summary) => (
      `${summary.shard}:${summary.renderAddressLookupSha256}`
    )).join('\n')),
    renderLodPolicy: PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY,
    renderLodPolicySha256: digestValue(PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY),
    renderLodIndexSetSha256: digestValue(renderSummaries.map((summary) => (
      `${summary.shard}:${summary.renderLodIndexSha256}`
    )).join('\n')),
    renderTemporalMapping: PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING,
    renderTemporalMappingSha256: digestValue(PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING),
    renderAddressUtf8Bytes: renderSummaries.reduce((sum, summary) => (
      sum + (summary.renderAddressUtf8Bytes || 0)
    ), 0),
    renderPackedBytes: renderSummaries.reduce((sum, summary) => (
      sum + (summary.renderPackedBytes || 0)
    ), 0),
    renderLodIndexBytes: renderSummaries.reduce((sum, summary) => (
      sum + (summary.renderLodIndexBytes || 0)
    ), 0),
    renderRetainedBytes: renderSummaries.reduce((sum, summary) => (
      sum + (summary.renderPackedBytes || 0) + (summary.renderLodIndexBytes || 0)
    ), 0),
    renderRetainedBudgetBytes: PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES,
    renderInFlightDecodeBudgetBytes: PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES,
    renderBufferAllocation: PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION,
    fullNodeMetadataAccess: 'on_demand_node_and_ego_shards',
    relationshipStatusCounts: statusCounts,
    typedEdgeCount: publicEdges.length,
    typedEdgeTypeCounts,
    pairReducerTypedEdgeCount: pairEdges.length,
    pairReducerTypedEdgeIdSetSha256: digestValue(pairEdges.map((edge) => edge.edgeId).join('\n')),
    evaluationReceiptCount: evaluations.length,
    skippedGroupReceiptCount: params.completion.skippedGroupCount,
    universeNodeSetSha256,
    nodeSetSha256: digestValue(publicNodes.map((node) => `${node.address}:${node.nodeDigest}`).join('\n')),
    typedEdgeIdSetSha256: digestValue(publicEdges.map((edge) => edge.edgeId).join('\n')),
    publicEdgeSetSha256: digestValue(publicEdges.map((edge) => `${edge.edgeId}:${edge.edgeDigest}`).join('\n')),
    evaluationSetSha256: digestValue(evaluations.map((evaluation) => (
      `${evaluation.evaluationId}:${evaluation.receiptDigest}`
    )).join('\n')),
    statusReceiptSetSha256: digestValue(publicNodes.map((node) => (
      `${node.address}:${node.statusReceipt.receiptDigest}`
    )).join('\n')),
    egoSetSha256: digestValue(publicEgos.map((ego) => `${ego.address}:${ego.egoDigest}`).join('\n')),
    shards: summaries,
    shardSetSha256: digestValue(summaries.map((summary) => (
      `${summary.shardKind}:${summary.shard}:${summary.shardDigest}`
    )).join('\n')),
    claimDiscipline: PUBLIC_TYPED_RELATIONSHIP_GRAPH_CLAIM_DISCIPLINE,
  };
  const manifest = {
    ...withoutManifestDigest,
    manifestDigest: digestValue(manifestWithoutDigest(withoutManifestDigest)),
  };
  const artifacts = { manifest, shards };
  verifyFullCorpusPublicGraphArtifacts(artifacts);
  return artifacts;
};
export {
  buildFullCorpusPublicRenderPackingReceipt,
  decodeFullCorpusPublicGraphArchiveObject,
  decodeFullCorpusPublicGraphManifest,
  decodeFullCorpusPublicGraphShard,
  encodeFullCorpusPublicGraphArchiveObject,
  fullCorpusPublicRenderTimestamp,
  indexFullCorpusPublicGraphReferences,
  readVerifiedFullCorpusPublicGraphArchiveObject,
  verifyFullCorpusPublicGraphArtifacts,
  writeFullCorpusPublicGraphArchiveObject,
  writeFullCorpusPublicGraphArtifacts,
} from './typedRelationshipPublicGraphCodec';
export type { FullCorpusPublicGraphReferenceIndex } from './typedRelationshipPublicGraphCodec';
