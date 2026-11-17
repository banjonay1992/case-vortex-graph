import { createHash } from "node:crypto";

import { CASE_GRAPH_ARCHIVE_SCHEMA_VERSION, type CaseGraphFeatureCompletionManifest } from "./archiveTypes";
import { getAuthoritativeCalibrationHumanReviewEvidence } from "./calibrationHumanReview";
import { decodeCaseVortexAccountingPublicationBinding, type CaseVortexAccountingPublicationBinding } from "./corpusAccountingIntegration";
import { canonicalizeContextualExplanation } from "./contextualExplanation";
import { decodeContextualRelationshipCalibrationArtifact, decodeContextualRelationshipCalibrationTrustPolicy, serializeContextualRelationshipCalibrationArtifact, serializeContextualRelationshipCalibrationReceipt } from "./contextualRelationshipCalibration";
import {
  CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256,
  CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
  assertContextualRelationshipCompletionProductionEligible,
  serializeContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionAccounting,
  type ContextualRelationshipCompletionArtifact,
} from "./contextualRelationshipCompletion";
import { EVIDENCE_UNIVERSE_LAYOUT_VERSION, EVIDENCE_UNIVERSE_SCHEMA_VERSION } from "./evidenceUniverse";
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION, type EvidenceUniverseCompletion } from "./evidenceUniverseArchive";
import { CASE_GRAPH_FEATURE_SCHEMA_VERSION } from "./featureExtraction";
import { decodeFullCorpusProductionCompatibilityPointer, type FullCorpusProductionCompatibilityPointer } from "./fullCorpusProductionCompatibility";
import { CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION, serializeCaseGraphPublicationCalibrationSetReceipt, verifyCaseGraphPublicationCalibrationSetReceiptBodies, type CaseGraphPublicationCalibrationSetReceipt } from "./publicationCalibrationSet";
import { EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY } from "./postgresEvidenceMediaSource";
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from "./postgresEvidenceUniverseSnapshot";
import type { RelationshipInputSnapshotManifest } from "./relationshipInputArchive";
import { RELATIONSHIP_INPUT_CANONICAL_VERSION, RELATIONSHIP_INPUT_SNAPSHOT_VERSION, canonicalizeRelationshipInput, validateRelationshipInputBinding, type RelationshipInputUniverseBinding } from "./relationshipInputSnapshot";
import { TYPED_RELATIONSHIP_EDGE_TYPES, TYPED_RELATIONSHIP_MODEL_ID, TYPED_RELATIONSHIP_MODEL_SHA256, TYPED_RELATIONSHIP_MODEL_VERSION, TYPED_RELATIONSHIP_POLICY_SHA256, TYPED_RELATIONSHIP_POLICY_VERSION, TYPED_RELATIONSHIP_RARITY_VERSION, TYPED_RELATIONSHIP_SCHEMA_VERSION, type TypedRelationshipEdgeType } from "./typedRelationshipEngine";
import { FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION, type FullCorpusAddressKind, type FullCorpusRelationshipCompletion } from "./typedRelationshipPipeline";
import { FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION, decodeFullCorpusRelationshipRunIndexPointer, type FullCorpusRelationshipRunIndexPointer } from "./typedRelationshipPipelineArchive";
import {
  PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION,
  PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING,
  decodeFullCorpusPublicGraphManifest,
  type FullCorpusPublicGraphArchiveReceipt,
  type FullCorpusPublicContextualRelationshipCompletionBinding,
  type FullCorpusPublicGraphManifest,
  type FullCorpusPublicGraphShardKind,
  type FullCorpusPublicGraphShardSummary,
  type FullCorpusPublicRelationshipStatus,
} from "./typedRelationshipPublicGraph";
import { PUBLIC_TYPED_DENSITY_ARCHIVE_VERSION, PUBLIC_TYPED_DENSITY_VERSION, decodeFullCorpusPublicDensityArtifact, decodeFullCorpusPublicDensityPointer, type FullCorpusPublicDensityArtifact, type FullCorpusPublicDensityPointer } from "./typedPublicDensity";
import { decodeTypedRelationshipCalibrationArtifact, decodeTypedRelationshipCalibrationTrustPolicy, serializeTypedRelationshipCalibrationArtifact, serializeTypedRelationshipCalibrationReceipt } from "./typedRelationshipCalibration";

export const CASE_GRAPH_PUBLIC_MANIFEST_VERSION = "case-vortex-public-manifest-v3" as const;
export const CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION = "case-vortex-typed-graph-artifact-set-v2" as const;

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_SHARD_COMPRESSED_BYTES = 128 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CORPUS_VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const MVCC = /^\d+:\d+:(?:\d+(?:,\d+)*)?$/;
const PRECISE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,9})?Z$/;
const NODE_KINDS: FullCorpusAddressKind[] = ["sighting", "document", "photo", "video"];
const RELATIONSHIP_STATUSES: FullCorpusPublicRelationshipStatus[] = ["linked", "candidate_only", "isolated"];
const GRAPH_SHARD_KINDS: FullCorpusPublicGraphShardKind[] = ["edge", "ego", "evaluation", "node", "render"];

const parseCalibrationJsonBody = (body: Buffer, code: string): unknown => {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new Error(code);
  }
};

type AddressKindCounts = Record<FullCorpusAddressKind, number>;
type RelationshipStatusCounts = Record<FullCorpusPublicRelationshipStatus, number>;

export type CaseGraphPublicationSnapshotLineage = {
  snapshotId: string;
  snapshotPolicy: typeof EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY;
  capturePolicy: typeof EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY;
  snapshotAt: string;
  materializedAt: string;
  sourceMvccSnapshot: string;
};

export type CaseGraphPublicationUniverseLineage = {
  archiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
  schemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  layoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  corpusVersion: string;
  archiveSetSha256: string;
  recordCount: number;
};

/** Auxiliary sighting feature lineage retained for audit, never used as the full-corpus graph input. */
export type CaseGraphPublicationFeatureLineage = {
  scope: "publishable_sightings_auxiliary";
  archiveSchemaVersion: typeof CASE_GRAPH_ARCHIVE_SCHEMA_VERSION;
  featureSchemaVersion: typeof CASE_GRAPH_FEATURE_SCHEMA_VERSION;
  archiveSetSha256: string;
  recordCount: number;
};

export type CaseGraphPublicationRelationshipInputLineage = {
  schemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  archiveSetSha256: string;
  manifestDigest: string;
  recordCount: number;
};

export type CaseGraphPublicationRelationshipLineage = {
  policyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
  policySha256: typeof TYPED_RELATIONSHIP_POLICY_SHA256;
  modelId: typeof TYPED_RELATIONSHIP_MODEL_ID;
  modelVersion: typeof TYPED_RELATIONSHIP_MODEL_VERSION;
  modelSha256: typeof TYPED_RELATIONSHIP_MODEL_SHA256;
};

export type CaseGraphPublicationCalibrationReceiptPointer = {
  receiptId: string;
  receiptKey: string;
  receiptSha256: string;
  receiptBodySha256: string;
  lineageSha256: string;
};

export type CaseGraphPublicationCalibrationLineage = {
  set: {
    schemaVersion: typeof CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION;
    receiptKey: string;
    receiptSha256: string;
    receiptBodySha256: string;
    calibrationSetSha256: string;
  };
  pair: CaseGraphPublicationCalibrationReceiptPointer;
  contextual: CaseGraphPublicationCalibrationReceiptPointer;
};

export type CaseGraphPublicationCalibrationEvidencePointer = {
  artifactKey: string;
  artifactBodySha256: string;
  artifactDigest: string;
  trustPolicyKey: string;
  trustPolicyBodySha256: string;
  trustPolicyDigest: string;
};

export type CaseGraphPublicationCalibrationEvidenceLineage = {
  humanReview: {
    bundleKey: string;
    bundleBodySha256: string;
    bundleDigest: string;
    evidenceSetSha256: string;
    packDigest: string;
    adjudicationDigest: string;
  };
  pair: CaseGraphPublicationCalibrationEvidencePointer;
  contextual: CaseGraphPublicationCalibrationEvidencePointer;
};

export type CaseGraphPublicationContextualCompletionPointer = {
  key: string;
  bodySha256: string;
  completionId: string;
  completionDigest: string;
  sourceCompletionSetSha256: string;
  entrySetSha256: string;
  accounting: ContextualRelationshipCompletionAccounting;
};

export type CaseGraphPublicationPublicGraphLineage = {
  schemaVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
  archiveVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION;
  manifestDigest: string;
  manifestArtifactDigest: string;
  manifestArchiveKey: string;
  manifestReceiptKey: string;
  manifestCompressedBytes: number;
  manifestCompressedSha256: string;
  manifestReceiptDigest: string;
  shardSetSha256: string;
  universeNodeSetSha256: string;
  renderRowCount: number;
  renderAddressKindCounts: AddressKindCounts;
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
  fullNodeMetadataAccess: "on_demand_node_and_ego_shards";
  nodeSetSha256: string;
  typedEdgeIdSetSha256: string;
  pairReducerTypedEdgeCount: number;
  pairReducerTypedEdgeIdSetSha256: string;
  publicEdgeSetSha256: string;
  evaluationSetSha256: string;
  statusReceiptSetSha256: string;
  egoSetSha256: string;
  contextualRelationshipCompletion: FullCorpusPublicContextualRelationshipCompletionBinding;
};

export type CaseGraphPublicationGraphLineage = {
  artifactSetVersion: typeof CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION;
  artifactSetSha256: string;
};

export type CaseGraphPublicManifest = {
  recordType: "case_vortex_public_manifest";
  schemaVersion: typeof CASE_GRAPH_PUBLIC_MANIFEST_VERSION;
  publicationStatus: "candidate";
  corpusVersion: string;
  generatedAt: string;
  sourceSnapshotAt: string;
  lineage: {
    snapshot: CaseGraphPublicationSnapshotLineage;
    universe: CaseGraphPublicationUniverseLineage;
    features: CaseGraphPublicationFeatureLineage;
    relationshipInput: CaseGraphPublicationRelationshipInputLineage;
    relationship: CaseGraphPublicationRelationshipLineage;
    productionCompatibility: FullCorpusProductionCompatibilityPointer;
    relationshipRun: FullCorpusRelationshipRunIndexPointer;
    publicGraph: CaseGraphPublicationPublicGraphLineage;
    calibration: CaseGraphPublicationCalibrationLineage;
    calibrationEvidence: CaseGraphPublicationCalibrationEvidenceLineage;
    contextualCompletion: CaseGraphPublicationContextualCompletionPointer;
    graph: CaseGraphPublicationGraphLineage;
  };
  accountingBinding: CaseVortexAccountingPublicationBinding;
  models: {
    publishabilityPolicy: string;
    auxiliaryFeatureSchemaVersion: typeof CASE_GRAPH_FEATURE_SCHEMA_VERSION;
    relationshipInputSchemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
    canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
    rarityVersion: typeof TYPED_RELATIONSHIP_RARITY_VERSION;
    pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
    pipelineArchiveVersion: typeof FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION;
    relationshipSchemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
    relationshipPolicyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
    relationshipPolicySha256: typeof TYPED_RELATIONSHIP_POLICY_SHA256;
    relationshipModelId: typeof TYPED_RELATIONSHIP_MODEL_ID;
    relationshipModelVersion: typeof TYPED_RELATIONSHIP_MODEL_VERSION;
    relationshipModelSha256: typeof TYPED_RELATIONSHIP_MODEL_SHA256;
    publicGraphVersion: typeof PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION;
    densityVersion: typeof PUBLIC_TYPED_DENSITY_VERSION;
    edgeTypes: TypedRelationshipEdgeType[];
  };
  topology: {
    postingShardCount: number;
    pairShardCount: number;
    renderShardCount: number;
    nodeShardCount: number;
    edgeShardCount: number;
    evaluationShardCount: number;
    egoShardCount: number;
  };
  accounting: {
    universeRecordCount: number;
    indexedRecordCount: number;
    addressKindCounts: AddressKindCounts;
    relationshipStatusCounts: RelationshipStatusCounts;
    typedEdgeCount: number;
    typedEdgeTypeCounts: Record<TypedRelationshipEdgeType, number>;
    candidatePairCount: number;
    evaluationReceiptCount: number;
    skippedGroupReceiptCount: number;
    skippedEstimatedPairCount: number;
    unknownGeoRecordCount: number;
    unknownTimeRecordCount: number;
  };
  density: FullCorpusPublicDensityPointer;
  graphShards: FullCorpusPublicGraphShardSummary[];
  notices: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value: unknown, keys: readonly string[], code = "case_graph_public_manifest_invalid") => {
  if (!isRecord(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code);
  return value;
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("case_graph_public_manifest_non_finite");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new Error("case_graph_public_manifest_non_json_value");
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (entries.some(([, item]) => item === undefined)) throw new Error("case_graph_public_manifest_undefined");
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
};

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const safeCount = (value: unknown, code = "case_graph_public_manifest_count_invalid") => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(code);
  return Number(value);
};
const boundedCount = (value: unknown, maximum: number, code: string) => {
  const count = safeCount(value, code);
  if (count > maximum) throw new Error(code);
  return count;
};
const digest = (value: unknown, code = "case_graph_public_manifest_sha_invalid") => {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(code);
  return value;
};
const stableId = (value: unknown, code: string) => {
  if (typeof value !== "string" || !VERSION.test(value)) throw new Error(code);
  return value;
};
const corpusId = (value: unknown, code: string) => {
  if (typeof value !== "string" || !CORPUS_VERSION.test(value)) throw new Error(code);
  return value;
};
const canonicalTimestamp = (value: unknown, code: string) => {
  if (typeof value !== "string" || !PRECISE_UTC.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return value;
};
const exactMillisecondTimestamp = (value: unknown, code: string) => {
  const timestamp = canonicalTimestamp(value, code);
  if (new Date(timestamp).toISOString() !== timestamp) throw new Error(code);
  return timestamp;
};
const canonicalUuid = (value: unknown, code: string) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(code);
  return value;
};
const storageKey = (value: unknown, corpusVersion: string) => {
  if (typeof value !== "string" || !value.startsWith(`case-vortex/corpora/${corpusVersion}/`) || value.includes("..") || value.includes("\\")) throw new Error("case_graph_public_manifest_storage_key_invalid");
  return value;
};
const sumSafe = (values: readonly number[], code = "case_graph_public_manifest_count_overflow") =>
  values.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next)) throw new Error(code);
    return next;
  }, 0);

const validateNamedCounts = <T extends string>(value: unknown, keys: readonly T[], code: string) => {
  const record = exactKeys(value, keys, code);
  return Object.fromEntries(keys.map((key) => [key, safeCount(record[key], code)])) as Record<T, number>;
};

const CONTEXTUAL_SOURCE_KINDS = ["aircraft", "satellite", "astronomy", "weather"] as const;

const decodeContextualCompletionAccounting = (input: unknown): ContextualRelationshipCompletionAccounting => {
  const code = "case_graph_public_manifest_contextual_completion_invalid";
  const value = exactKeys(input, ["sourceSnapshotCount", "sourceKindCount", "sourceRecordCount", "acceptedEdgeCount", "insufficientEvidenceCount", "uniqueAddressCount", "addressStatusCounts", "sourceKindCounts"], code);
  const sourceSnapshotCount = safeCount(value.sourceSnapshotCount, code);
  const sourceRecordCount = safeCount(value.sourceRecordCount, code);
  const acceptedEdgeCount = safeCount(value.acceptedEdgeCount, code);
  const insufficientEvidenceCount = safeCount(value.insufficientEvidenceCount, code);
  const uniqueAddressCount = safeCount(value.uniqueAddressCount, code);
  const addressStatusCounts = validateNamedCounts(value.addressStatusCounts, ["accepted_only", "insufficient_only", "mixed"] as const, code);
  const rawSourceKindCounts = exactKeys(value.sourceKindCounts, CONTEXTUAL_SOURCE_KINDS, code);
  const sourceKindCounts = Object.fromEntries(
    CONTEXTUAL_SOURCE_KINDS.map((kind) => {
      const counts = exactKeys(rawSourceKindCounts[kind], ["sourceSnapshotCount", "sourceRecordCount", "acceptedEdgeCount", "insufficientEvidenceCount"], code);
      const normalized = {
        sourceSnapshotCount: safeCount(counts.sourceSnapshotCount, code),
        sourceRecordCount: safeCount(counts.sourceRecordCount, code),
        acceptedEdgeCount: safeCount(counts.acceptedEdgeCount, code),
        insufficientEvidenceCount: safeCount(counts.insufficientEvidenceCount, code),
      };
      if (normalized.sourceSnapshotCount < 1 || normalized.sourceRecordCount !== normalized.acceptedEdgeCount + normalized.insufficientEvidenceCount) {
        throw new Error(code);
      }
      return [kind, normalized];
    }),
  ) as ContextualRelationshipCompletionAccounting["sourceKindCounts"];
  if (
    value.sourceKindCount !== 4 ||
    sourceSnapshotCount < 4 ||
    sourceRecordCount !== acceptedEdgeCount + insufficientEvidenceCount ||
    uniqueAddressCount !== sumSafe(Object.values(addressStatusCounts), code) ||
    sourceSnapshotCount !==
      sumSafe(
        CONTEXTUAL_SOURCE_KINDS.map((kind) => sourceKindCounts[kind].sourceSnapshotCount),
        code,
      ) ||
    sourceRecordCount !==
      sumSafe(
        CONTEXTUAL_SOURCE_KINDS.map((kind) => sourceKindCounts[kind].sourceRecordCount),
        code,
      ) ||
    acceptedEdgeCount !==
      sumSafe(
        CONTEXTUAL_SOURCE_KINDS.map((kind) => sourceKindCounts[kind].acceptedEdgeCount),
        code,
      ) ||
    insufficientEvidenceCount !==
      sumSafe(
        CONTEXTUAL_SOURCE_KINDS.map((kind) => sourceKindCounts[kind].insufficientEvidenceCount),
        code,
      )
  ) {
    throw new Error(code);
  }
  return {
    sourceSnapshotCount,
    sourceKindCount: 4,
    sourceRecordCount,
    acceptedEdgeCount,
    insufficientEvidenceCount,
    uniqueAddressCount,
    addressStatusCounts,
    sourceKindCounts,
  };
};

export const canonicalizeCaseGraphPublicManifest = (manifest: CaseGraphPublicManifest) => canonicalJson(manifest);
export const encodeCaseGraphPublicManifest = (manifest: CaseGraphPublicManifest) => Buffer.from(`${canonicalizeCaseGraphPublicManifest(manifest)}\n`, "utf8");
export const caseGraphPublicManifestSha256 = (manifest: CaseGraphPublicManifest | Buffer) => sha256(Buffer.isBuffer(manifest) ? manifest : encodeCaseGraphPublicManifest(manifest));

export type CaseGraphArtifactSetInput = {
  corpusVersion: string;
  relationshipRun: FullCorpusRelationshipRunIndexPointer;
  productionCompatibility: FullCorpusProductionCompatibilityPointer;
  publicGraph: CaseGraphPublicationPublicGraphLineage;
  density: FullCorpusPublicDensityPointer;
  calibration: CaseGraphPublicationCalibrationLineage;
  calibrationEvidence: CaseGraphPublicationCalibrationEvidenceLineage;
  contextualCompletion: CaseGraphPublicationContextualCompletionPointer;
  graphShards: FullCorpusPublicGraphShardSummary[];
  graphAddressLedger: CaseVortexAccountingPublicationBinding["graphAddressLedger"];
};

export const getCaseGraphArtifactSetSha256 = (input: CaseGraphArtifactSetInput) =>
  sha256(
    canonicalJson({
      schemaVersion: CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION,
      corpusVersion: input.corpusVersion,
      relationshipRun: input.relationshipRun,
      productionCompatibility: input.productionCompatibility,
      publicGraph: input.publicGraph,
      density: input.density,
      calibration: input.calibration,
      calibrationEvidence: input.calibrationEvidence,
      contextualCompletion: input.contextualCompletion,
      graphShards: [...input.graphShards].sort((left, right) => left.shardKind.localeCompare(right.shardKind) || left.shard - right.shard),
      graphAddressLedger: input.graphAddressLedger,
    }),
  );

const requireSame = (left: unknown, right: unknown, code: string) => {
  if (left !== right) throw new Error(code);
};

const relationshipBindingFromUniverse = (universe: EvidenceUniverseCompletion): RelationshipInputUniverseBinding => ({
  snapshotId: universe.expected.snapshotId,
  corpusVersion: universe.corpusVersion,
  universeArchiveVersion: universe.archiveVersion,
  universeSchemaVersion: universe.schemaVersion,
  universeLayoutVersion: universe.layoutVersion,
  universeArchiveSetSha256: universe.archiveSetSha256,
  universeRecordCount: universe.expected.total,
});

const sameCanonical = (left: unknown, right: unknown) => canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right);

const publicGraphLineageFrom = (graph: FullCorpusPublicGraphManifest, receipt: FullCorpusPublicGraphArchiveReceipt): CaseGraphPublicationPublicGraphLineage => ({
  schemaVersion: graph.schemaVersion,
  archiveVersion: graph.archiveVersion,
  manifestDigest: graph.manifestDigest,
  manifestArtifactDigest: receipt.artifactDigest,
  manifestArchiveKey: receipt.archiveKey,
  manifestReceiptKey: receipt.receiptKey,
  manifestCompressedBytes: receipt.compressedBytes,
  manifestCompressedSha256: receipt.compressedSha256,
  manifestReceiptDigest: receipt.receiptDigest,
  shardSetSha256: graph.shardSetSha256,
  universeNodeSetSha256: graph.universeNodeSetSha256,
  renderRowCount: graph.renderRowCount,
  renderAddressKindCounts: graph.renderAddressKindCounts,
  renderAddressSetSha256: graph.renderAddressSetSha256,
  renderSetSha256: graph.renderSetSha256,
  renderUncompressedBytes: graph.renderUncompressedBytes,
  renderCompressedBytes: graph.renderCompressedBytes,
  renderFormat: graph.renderFormat,
  renderAddressOrder: graph.renderAddressOrder,
  renderPackedLayout: graph.renderPackedLayout,
  renderPackedLayoutSha256: graph.renderPackedLayoutSha256,
  renderAddressLookupSetSha256: graph.renderAddressLookupSetSha256,
  renderLodPolicy: graph.renderLodPolicy,
  renderLodPolicySha256: graph.renderLodPolicySha256,
  renderLodIndexSetSha256: graph.renderLodIndexSetSha256,
  renderTemporalMapping: graph.renderTemporalMapping,
  renderTemporalMappingSha256: graph.renderTemporalMappingSha256,
  renderAddressUtf8Bytes: graph.renderAddressUtf8Bytes,
  renderPackedBytes: graph.renderPackedBytes,
  renderLodIndexBytes: graph.renderLodIndexBytes,
  renderRetainedBytes: graph.renderRetainedBytes,
  renderRetainedBudgetBytes: graph.renderRetainedBudgetBytes,
  renderInFlightDecodeBudgetBytes: graph.renderInFlightDecodeBudgetBytes,
  renderBufferAllocation: graph.renderBufferAllocation,
  fullNodeMetadataAccess: graph.fullNodeMetadataAccess,
  nodeSetSha256: graph.nodeSetSha256,
  typedEdgeIdSetSha256: graph.typedEdgeIdSetSha256,
  pairReducerTypedEdgeCount: graph.pairReducerTypedEdgeCount,
  pairReducerTypedEdgeIdSetSha256: graph.pairReducerTypedEdgeIdSetSha256,
  publicEdgeSetSha256: graph.publicEdgeSetSha256,
  evaluationSetSha256: graph.evaluationSetSha256,
  statusReceiptSetSha256: graph.statusReceiptSetSha256,
  egoSetSha256: graph.egoSetSha256,
  contextualRelationshipCompletion: graph.contextualRelationshipCompletion,
});

const shardCounts = (shards: readonly FullCorpusPublicGraphShardSummary[]) => Object.fromEntries(GRAPH_SHARD_KINDS.map((kind) => [kind, shards.filter((shard) => shard.shardKind === kind).length])) as Record<FullCorpusPublicGraphShardKind, number>;

export const buildCaseGraphPublicManifest = (params: {
  corpusVersion: string;
  generatedAt: string;
  features: CaseGraphFeatureCompletionManifest;
  universe: EvidenceUniverseCompletion;
  relationshipInput: RelationshipInputSnapshotManifest;
  relationshipCompletion: FullCorpusRelationshipCompletion;
  relationshipRun: FullCorpusRelationshipRunIndexPointer;
  productionCompatibility: FullCorpusProductionCompatibilityPointer;
  publicGraph: FullCorpusPublicGraphManifest;
  publicGraphManifestReceipt: FullCorpusPublicGraphArchiveReceipt;
  density: FullCorpusPublicDensityPointer;
  densityArtifact: FullCorpusPublicDensityArtifact;
  calibration: {
    receipt: CaseGraphPublicationCalibrationSetReceipt;
    receiptBody: Buffer;
    receiptKey: string;
    pairReceiptKey: string;
    contextualReceiptKey: string;
    pairReceiptBody: Buffer;
    contextualReceiptBody: Buffer;
  };
  calibrationEvidence: {
    humanReviewBundleBody: Buffer;
    humanReviewBundleKey: string;
    pairArtifactBody: Buffer;
    pairTrustPolicyBody: Buffer;
    pairArtifactKey: string;
    pairTrustPolicyKey: string;
    contextualArtifactBody: Buffer;
    contextualTrustPolicyBody: Buffer;
    contextualArtifactKey: string;
    contextualTrustPolicyKey: string;
    pinned: {
      pair: {
        receiptId: string;
        receiptSha256: string;
        artifactDigest: string;
        trustPolicyDigest: string;
      };
      contextual: {
        receiptId: string;
        receiptSha256: string;
        artifactDigest: string;
        trustPolicyDigest: string;
      };
    };
  };
  contextualCompletion: {
    artifact: ContextualRelationshipCompletionArtifact;
    body: Buffer;
    key: string;
  };
  accountingBinding: CaseVortexAccountingPublicationBinding;
}): CaseGraphPublicManifest => {
  const corpusVersion = corpusId(params.corpusVersion, "case_graph_publication_corpus_invalid");
  const generatedAt = exactMillisecondTimestamp(params.generatedAt, "case_graph_publication_timestamp_invalid");
  const calibrationReceipt = verifyCaseGraphPublicationCalibrationSetReceiptBodies({
    receipt: params.calibration?.receipt,
    pairReceiptBody: params.calibration?.pairReceiptBody,
    contextualReceiptBody: params.calibration?.contextualReceiptBody,
  }).receipt;
  const canonicalCalibrationSetBody = Buffer.from(serializeCaseGraphPublicationCalibrationSetReceipt(calibrationReceipt), "utf8");
  if (!Buffer.isBuffer(params.calibration?.receiptBody) || !params.calibration.receiptBody.equals(canonicalCalibrationSetBody)) {
    throw new Error("case_graph_publication_calibration_set_receipt_noncanonical");
  }
  const calibration: CaseGraphPublicationCalibrationLineage = {
    set: {
      schemaVersion: calibrationReceipt.schemaVersion,
      receiptKey: storageKey(params.calibration?.receiptKey, corpusVersion),
      receiptSha256: calibrationReceipt.receiptSha256,
      receiptBodySha256: sha256(params.calibration.receiptBody),
      calibrationSetSha256: calibrationReceipt.calibrationSetSha256,
    },
    pair: {
      receiptId: stableId(calibrationReceipt.pairCalibration.receiptId, "case_graph_publication_pair_calibration_receipt_invalid"),
      receiptKey: storageKey(params.calibration?.pairReceiptKey, corpusVersion),
      receiptSha256: digest(calibrationReceipt.pairCalibration.receiptSha256, "case_graph_publication_pair_calibration_receipt_invalid"),
      receiptBodySha256: digest(calibrationReceipt.pairCalibration.receiptBodySha256, "case_graph_publication_pair_calibration_receipt_invalid"),
      lineageSha256: digest(calibrationReceipt.pairCalibration.lineageSha256, "case_graph_publication_pair_calibration_receipt_invalid"),
    },
    contextual: {
      receiptId: stableId(calibrationReceipt.contextualCalibration.receiptId, "case_graph_publication_contextual_calibration_receipt_invalid"),
      receiptKey: storageKey(params.calibration?.contextualReceiptKey, corpusVersion),
      receiptSha256: digest(calibrationReceipt.contextualCalibration.receiptSha256, "case_graph_publication_contextual_calibration_receipt_invalid"),
      receiptBodySha256: digest(calibrationReceipt.contextualCalibration.receiptBodySha256, "case_graph_publication_contextual_calibration_receipt_invalid"),
      lineageSha256: digest(calibrationReceipt.contextualCalibration.lineageSha256, "case_graph_publication_contextual_calibration_receipt_invalid"),
    },
  };
  if (!params.features.binding?.universe) throw new Error("case_graph_publication_universe_binding_required");
  if (params.universe.corpusVersion !== corpusVersion || params.features.corpus_version !== corpusVersion || params.relationshipInput.binding.corpusVersion !== corpusVersion) {
    throw new Error("case_graph_publication_corpus_mismatch");
  }

  const snapshot: CaseGraphPublicationSnapshotLineage = {
    snapshotId: params.features.binding.snapshot_id,
    snapshotPolicy: params.features.binding.snapshot_policy as typeof EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capturePolicy: params.features.binding.capture_policy as typeof EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    snapshotAt: params.features.expected.snapshot_at,
    materializedAt: params.features.binding.materialized_at,
    sourceMvccSnapshot: params.features.binding.source_mvcc_snapshot,
  };
  requireSame(snapshot.snapshotId, params.features.expected.snapshot_id, "case_graph_publication_feature_snapshot_mismatch");
  requireSame(snapshot.snapshotPolicy, params.features.expected.snapshot_policy, "case_graph_publication_feature_snapshot_mismatch");
  requireSame(snapshot.capturePolicy, params.features.expected.capture_policy, "case_graph_publication_feature_snapshot_mismatch");
  requireSame(snapshot.materializedAt, params.features.expected.materialized_at, "case_graph_publication_feature_snapshot_mismatch");
  requireSame(snapshot.sourceMvccSnapshot, params.features.expected.source_mvcc_snapshot, "case_graph_publication_feature_snapshot_mismatch");
  requireSame(snapshot.snapshotId, params.universe.expected.snapshotId, "case_graph_publication_snapshot_mismatch");
  requireSame(snapshot.snapshotPolicy, params.universe.expected.snapshotPolicy, "case_graph_publication_snapshot_policy_mismatch");
  requireSame(snapshot.capturePolicy, params.universe.expected.capturePolicies.sighting, "case_graph_publication_capture_policy_mismatch");
  requireSame(snapshot.snapshotAt, params.universe.expected.snapshotAt, "case_graph_publication_snapshot_time_mismatch");
  requireSame(snapshot.materializedAt, params.universe.expected.materializedAt, "case_graph_publication_materialized_time_mismatch");
  requireSame(snapshot.sourceMvccSnapshot, params.universe.expected.sourceMvccSnapshot, "case_graph_publication_mvcc_mismatch");
  requireSame(params.features.binding.universe.corpus_version, corpusVersion, "case_graph_publication_universe_corpus_mismatch");
  requireSame(params.features.binding.universe.archive_set_sha256, params.universe.archiveSetSha256, "case_graph_publication_universe_archive_mismatch");

  const relationshipBinding = validateRelationshipInputBinding(params.relationshipInput.binding);
  if (!sameCanonical(relationshipBinding, relationshipBindingFromUniverse(params.universe))) {
    throw new Error("case_graph_publication_relationship_input_binding_mismatch");
  }
  if (
    !sameCanonical(calibrationReceipt.binding, relationshipBinding) ||
    calibrationReceipt.relationshipInput.archiveSetSha256 !== params.relationshipInput.archiveSetSha256 ||
    calibrationReceipt.relationshipInput.manifestDigest !== params.relationshipInput.manifestDigest ||
    calibrationReceipt.relationshipInput.recordCount !== params.relationshipInput.rowCount
  ) {
    throw new Error("case_graph_publication_calibration_set_lineage_mismatch");
  }
  const productionCompatibility = decodeFullCorpusProductionCompatibilityPointer(params.productionCompatibility, { corpusVersion, snapshotId: snapshot.snapshotId });
  const evidence = params.calibrationEvidence;
  if (
    !Buffer.isBuffer(evidence?.humanReviewBundleBody) ||
    !Buffer.isBuffer(evidence?.pairArtifactBody) ||
    !Buffer.isBuffer(evidence?.pairTrustPolicyBody) ||
    !Buffer.isBuffer(evidence?.contextualArtifactBody) ||
    !Buffer.isBuffer(evidence?.contextualTrustPolicyBody) ||
    !evidence.humanReviewBundleBody.length ||
    !evidence.pairArtifactBody.length ||
    !evidence.pairTrustPolicyBody.length ||
    !evidence.contextualArtifactBody.length ||
    !evidence.contextualTrustPolicyBody.length
  ) {
    throw new Error("case_graph_publication_calibration_evidence_required");
  }
  const humanReview = getAuthoritativeCalibrationHumanReviewEvidence({
    bundleBody: evidence.humanReviewBundleBody,
    pairReceiptBody: params.calibration.pairReceiptBody,
    pairArtifactBody: evidence.pairArtifactBody,
    pairTrustPolicyBody: evidence.pairTrustPolicyBody,
    contextualReceiptBody: params.calibration.contextualReceiptBody,
    contextualArtifactBody: evidence.contextualArtifactBody,
    contextualTrustPolicyBody: evidence.contextualTrustPolicyBody,
  });
  const pairTrustPolicy = decodeTypedRelationshipCalibrationTrustPolicy(parseCalibrationJsonBody(evidence.pairTrustPolicyBody, "case_graph_publication_pair_calibration_trust_policy_invalid_json"));
  const canonicalPairTrustPolicyBody = Buffer.from(`${canonicalizeRelationshipInput(pairTrustPolicy)}\n`, "utf8");
  const contextualTrustPolicy = decodeContextualRelationshipCalibrationTrustPolicy(parseCalibrationJsonBody(evidence.contextualTrustPolicyBody, "case_graph_publication_contextual_calibration_trust_policy_invalid_json"));
  const canonicalContextualTrustPolicyBody = Buffer.from(`${canonicalizeContextualExplanation(contextualTrustPolicy)}\n`, "utf8");
  if (!evidence.pairTrustPolicyBody.equals(canonicalPairTrustPolicyBody) || !evidence.contextualTrustPolicyBody.equals(canonicalContextualTrustPolicyBody)) {
    throw new Error("case_graph_publication_calibration_trust_policy_noncanonical");
  }
  const pairArtifact = decodeTypedRelationshipCalibrationArtifact(evidence.pairArtifactBody, relationshipBinding, pairTrustPolicy);
  const contextualArtifact = decodeContextualRelationshipCalibrationArtifact(evidence.contextualArtifactBody, relationshipBinding, contextualTrustPolicy);
  const canonicalPairArtifactBody = Buffer.from(serializeTypedRelationshipCalibrationArtifact(pairArtifact, pairTrustPolicy), "utf8");
  const canonicalContextualArtifactBody = Buffer.from(serializeContextualRelationshipCalibrationArtifact(contextualArtifact, contextualTrustPolicy), "utf8");
  if (!evidence.pairArtifactBody.equals(canonicalPairArtifactBody) || !evidence.contextualArtifactBody.equals(canonicalContextualArtifactBody)) {
    throw new Error("case_graph_publication_calibration_artifact_noncanonical");
  }
  const pinnedPair = evidence.pinned?.pair;
  const pinnedContextual = evidence.pinned?.contextual;
  if (
    !pinnedPair ||
    !pinnedContextual ||
    pinnedPair.receiptId !== pairArtifact.receipt.receiptId ||
    pinnedPair.receiptSha256 !== pairArtifact.receipt.receiptSha256 ||
    pinnedPair.artifactDigest !== pairArtifact.artifactDigest ||
    pinnedPair.trustPolicyDigest !== pairTrustPolicy.trustPolicyDigest ||
    pinnedContextual.receiptId !== contextualArtifact.receipt.receiptId ||
    pinnedContextual.receiptSha256 !== contextualArtifact.receipt.receiptSha256 ||
    pinnedContextual.artifactDigest !== contextualArtifact.artifactDigest ||
    pinnedContextual.trustPolicyDigest !== contextualTrustPolicy.trustPolicyDigest ||
    pinnedPair.receiptId !== calibrationReceipt.pairCalibration.receiptId ||
    pinnedPair.receiptSha256 !== calibrationReceipt.pairCalibration.receiptSha256 ||
    pinnedContextual.receiptId !== calibrationReceipt.contextualCalibration.receiptId ||
    pinnedContextual.receiptSha256 !== calibrationReceipt.contextualCalibration.receiptSha256 ||
    !params.calibration.pairReceiptBody.equals(Buffer.from(serializeTypedRelationshipCalibrationReceipt(pairArtifact.receipt), "utf8")) ||
    !params.calibration.contextualReceiptBody.equals(Buffer.from(serializeContextualRelationshipCalibrationReceipt(contextualArtifact.receipt), "utf8"))
  ) {
    throw new Error("case_graph_publication_calibration_evidence_identity_mismatch");
  }
  const calibrationEvidence: CaseGraphPublicationCalibrationEvidenceLineage = {
    humanReview: {
      bundleKey: storageKey(evidence.humanReviewBundleKey, corpusVersion),
      bundleBodySha256: sha256(evidence.humanReviewBundleBody),
      bundleDigest: humanReview.bundleDigest,
      evidenceSetSha256: humanReview.evidenceSetSha256,
      packDigest: humanReview.packDigest,
      adjudicationDigest: humanReview.adjudicationDigest,
    },
    pair: {
      artifactKey: storageKey(evidence.pairArtifactKey, corpusVersion),
      artifactBodySha256: sha256(canonicalPairArtifactBody),
      artifactDigest: pairArtifact.artifactDigest,
      trustPolicyKey: storageKey(evidence.pairTrustPolicyKey, corpusVersion),
      trustPolicyBodySha256: sha256(canonicalPairTrustPolicyBody),
      trustPolicyDigest: pairTrustPolicy.trustPolicyDigest,
    },
    contextual: {
      artifactKey: storageKey(evidence.contextualArtifactKey, corpusVersion),
      artifactBodySha256: sha256(canonicalContextualArtifactBody),
      artifactDigest: contextualArtifact.artifactDigest,
      trustPolicyKey: storageKey(evidence.contextualTrustPolicyKey, corpusVersion),
      trustPolicyBodySha256: sha256(canonicalContextualTrustPolicyBody),
      trustPolicyDigest: contextualTrustPolicy.trustPolicyDigest,
    },
  };
  const expectedContextualCalibration = {
    receiptId: calibrationReceipt.contextualCalibration.receiptId,
    receiptSha256: calibrationReceipt.contextualCalibration.receiptSha256,
  };
  if (!Buffer.isBuffer(params.contextualCompletion?.body) || !params.contextualCompletion.body.length) {
    throw new Error("case_graph_publication_contextual_completion_body_required");
  }
  const contextualCompletionArtifact = assertContextualRelationshipCompletionProductionEligible(params.contextualCompletion.body, relationshipBinding, expectedContextualCalibration);
  const canonicalContextualCompletionBody = Buffer.from(serializeContextualRelationshipCompletionArtifact(contextualCompletionArtifact, expectedContextualCalibration), "utf8");
  if (!params.contextualCompletion.body.equals(canonicalContextualCompletionBody) || !sameCanonical(params.contextualCompletion.artifact, contextualCompletionArtifact)) {
    throw new Error("case_graph_publication_contextual_completion_noncanonical");
  }
  const contextualCompletion: CaseGraphPublicationContextualCompletionPointer = {
    key: storageKey(params.contextualCompletion.key, corpusVersion),
    bodySha256: sha256(canonicalContextualCompletionBody),
    completionId: contextualCompletionArtifact.completionId,
    completionDigest: contextualCompletionArtifact.completionDigest,
    sourceCompletionSetSha256: contextualCompletionArtifact.sourceCompletionSetSha256,
    entrySetSha256: contextualCompletionArtifact.entrySetSha256,
    accounting: contextualCompletionArtifact.accounting,
  };
  const universeRecordCount = params.universe.expected.total;
  if (params.relationshipInput.rowCount !== universeRecordCount || params.relationshipInput.accounting.recordCount !== universeRecordCount) {
    throw new Error("case_graph_publication_relationship_input_count_mismatch");
  }
  const completion = params.relationshipCompletion;
  const run = decodeFullCorpusRelationshipRunIndexPointer(params.relationshipRun, completion.lineage);
  const publicGraph = decodeFullCorpusPublicGraphManifest(params.publicGraph);
  const density = decodeFullCorpusPublicDensityPointer(params.density, {
    corpusVersion,
    snapshotId: snapshot.snapshotId,
    publicGraphManifestDigest: publicGraph.manifestDigest,
  });
  const densityArtifact = decodeFullCorpusPublicDensityArtifact(params.densityArtifact, density);
  if (
    !sameCanonical(completion.lineage.binding, relationshipBinding) ||
    completion.lineage.relationshipInputManifestDigest !== params.relationshipInput.manifestDigest ||
    completion.lineage.relationshipInputArchiveSetSha256 !== params.relationshipInput.archiveSetSha256 ||
    completion.lineage.typedRelationshipPolicyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION ||
    completion.lineage.typedRelationshipPolicySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256 ||
    completion.lineage.typedRelationshipModel.modelId !== TYPED_RELATIONSHIP_MODEL_ID ||
    completion.lineage.typedRelationshipModel.modelVersion !== TYPED_RELATIONSHIP_MODEL_VERSION ||
    completion.lineage.typedRelationshipModelSha256 !== TYPED_RELATIONSHIP_MODEL_SHA256 ||
    completion.completionDigest !== run.completionDigest ||
    !sameCanonical(completion.contextualCompletion, run.contextualCompletion) ||
    completion.contextualCompletion.completionId !== contextualCompletion.completionId ||
    completion.contextualCompletion.completionDigest !== contextualCompletion.completionDigest ||
    completion.contextualCompletion.artifactDigest !== contextualCompletion.bodySha256 ||
    completion.contextualCompletion.sourceCompletionSetSha256 !== contextualCompletion.sourceCompletionSetSha256 ||
    completion.contextualCompletion.entrySetSha256 !== contextualCompletion.entrySetSha256 ||
    completion.contextualCompletion.calibrationReceiptId !== calibration.contextual.receiptId ||
    completion.contextualCompletion.calibrationReceiptSha256 !== calibration.contextual.receiptSha256 ||
    completion.contextualCompletion.sourceSnapshotCount !== contextualCompletion.accounting.sourceSnapshotCount ||
    completion.contextualCompletion.sourceRecordCount !== contextualCompletion.accounting.sourceRecordCount ||
    completion.contextualCompletion.acceptedEdgeCount !== contextualCompletion.accounting.acceptedEdgeCount ||
    completion.contextualCompletion.insufficientEvidenceCount !== contextualCompletion.accounting.insufficientEvidenceCount ||
    completion.contextualCompletion.zeroObservationState !== (contextualCompletion.accounting.sourceRecordCount === 0) ||
    !sameCanonical(publicGraph.lineage, completion.lineage) ||
    !sameCanonical(publicGraph.runIndexPointer, run) ||
    publicGraph.completionDigest !== completion.completionDigest ||
    publicGraph.contextualRelationshipCompletion.completionId !== contextualCompletion.completionId ||
    publicGraph.contextualRelationshipCompletion.completionDigest !== contextualCompletion.completionDigest ||
    publicGraph.contextualRelationshipCompletion.sourceCompletionSetSha256 !== contextualCompletion.sourceCompletionSetSha256 ||
    publicGraph.contextualRelationshipCompletion.entrySetSha256 !== contextualCompletion.entrySetSha256 ||
    publicGraph.contextualRelationshipCompletion.calibrationReceiptId !== calibration.contextual.receiptId ||
    publicGraph.contextualRelationshipCompletion.calibrationReceiptSha256 !== calibration.contextual.receiptSha256 ||
    !sameCanonical(publicGraph.contextualRelationshipCompletion.accounting, contextualCompletion.accounting) ||
    publicGraph.pairReducerTypedEdgeCount !== completion.typedEdgeCount - contextualCompletion.accounting.acceptedEdgeCount
  ) {
    throw new Error("case_graph_publication_typed_relationship_lineage_mismatch");
  }
  if (
    completion.universeRecordCount !== universeRecordCount ||
    publicGraph.universeNodeCount !== universeRecordCount ||
    publicGraph.renderRowCount !== universeRecordCount ||
    density.nodeCount !== universeRecordCount ||
    densityArtifact.nodeCount !== universeRecordCount ||
    !sameCanonical(completion.addressKindCounts, params.universe.expected.byKind) ||
    !sameCanonical(publicGraph.addressKindCounts, completion.addressKindCounts) ||
    !sameCanonical(publicGraph.renderAddressKindCounts, completion.addressKindCounts) ||
    !sameCanonical(density.byKind, completion.addressKindCounts) ||
    !sameCanonical(densityArtifact.byKind, completion.addressKindCounts) ||
    completion.typedEdgeCount !== publicGraph.typedEdgeCount ||
    !sameCanonical(completion.typedEdgeTypeCounts, publicGraph.typedEdgeTypeCounts)
  ) {
    throw new Error("case_graph_publication_full_corpus_accounting_mismatch");
  }
  if (params.features.exported_row_count !== params.features.expected.eligible_count || params.features.exported_row_count > universeRecordCount) {
    throw new Error("case_graph_publication_auxiliary_feature_accounting_mismatch");
  }

  const manifestReceipt = params.publicGraphManifestReceipt;
  if (
    manifestReceipt.recordType !== "full_corpus_public_graph_archive_receipt" ||
    manifestReceipt.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION ||
    manifestReceipt.artifactKind !== "manifest" ||
    manifestReceipt.completionDigest !== completion.completionDigest ||
    manifestReceipt.runIndexPointerDigest !== run.pointerDigest ||
    !sameCanonical(manifestReceipt.lineage, completion.lineage)
  ) {
    throw new Error("case_graph_publication_public_graph_receipt_mismatch");
  }
  const publicGraphLineage = publicGraphLineageFrom(publicGraph, manifestReceipt);
  const accountingBinding = decodeCaseVortexAccountingPublicationBinding(params.accountingBinding);
  if (
    accountingBinding.corpusVersion !== corpusVersion ||
    accountingBinding.snapshotId !== snapshot.snapshotId ||
    accountingBinding.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION ||
    accountingBinding.graphAddressLedger.recordCount !== universeRecordCount ||
    !sameCanonical(accountingBinding.graphAddressLedger.byKind, completion.addressKindCounts)
  ) {
    throw new Error("case_graph_publication_accounting_binding_mismatch");
  }
  const counts = shardCounts(publicGraph.shards);
  const graphArtifactSetSha256 = getCaseGraphArtifactSetSha256({
    corpusVersion,
    relationshipRun: run,
    productionCompatibility,
    publicGraph: publicGraphLineage,
    density,
    calibration,
    calibrationEvidence,
    contextualCompletion,
    graphShards: publicGraph.shards,
    graphAddressLedger: accountingBinding.graphAddressLedger,
  });
  const manifest: CaseGraphPublicManifest = {
    recordType: "case_vortex_public_manifest",
    schemaVersion: CASE_GRAPH_PUBLIC_MANIFEST_VERSION,
    publicationStatus: "candidate",
    corpusVersion,
    generatedAt,
    sourceSnapshotAt: snapshot.snapshotAt,
    lineage: {
      snapshot,
      universe: {
        archiveVersion: params.universe.archiveVersion,
        schemaVersion: params.universe.schemaVersion,
        layoutVersion: params.universe.layoutVersion,
        corpusVersion,
        archiveSetSha256: params.universe.archiveSetSha256,
        recordCount: universeRecordCount,
      },
      features: {
        scope: "publishable_sightings_auxiliary",
        archiveSchemaVersion: params.features.schema_version,
        featureSchemaVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
        archiveSetSha256: params.features.archive_set_sha256,
        recordCount: params.features.exported_row_count,
      },
      relationshipInput: {
        schemaVersion: params.relationshipInput.schemaVersion,
        canonicalVersion: params.relationshipInput.canonicalVersion,
        binding: relationshipBinding,
        archiveSetSha256: params.relationshipInput.archiveSetSha256,
        manifestDigest: params.relationshipInput.manifestDigest,
        recordCount: params.relationshipInput.rowCount,
      },
      relationship: {
        policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
        policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
        modelId: TYPED_RELATIONSHIP_MODEL_ID,
        modelVersion: TYPED_RELATIONSHIP_MODEL_VERSION,
        modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
      },
      productionCompatibility,
      relationshipRun: run,
      publicGraph: publicGraphLineage,
      calibration,
      calibrationEvidence,
      contextualCompletion,
      graph: { artifactSetVersion: CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION, artifactSetSha256: graphArtifactSetSha256 },
    },
    accountingBinding,
    models: {
      publishabilityPolicy: params.features.expected.publishability_policy,
      auxiliaryFeatureSchemaVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
      relationshipInputSchemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
      rarityVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
      pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
      pipelineArchiveVersion: FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION,
      relationshipSchemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
      relationshipPolicyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
      relationshipPolicySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
      relationshipModelId: TYPED_RELATIONSHIP_MODEL_ID,
      relationshipModelVersion: TYPED_RELATIONSHIP_MODEL_VERSION,
      relationshipModelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
      publicGraphVersion: PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION,
      densityVersion: PUBLIC_TYPED_DENSITY_VERSION,
      edgeTypes: [...TYPED_RELATIONSHIP_EDGE_TYPES],
    },
    topology: {
      postingShardCount: completion.postingShardCount,
      pairShardCount: completion.pairShardCount,
      renderShardCount: counts.render,
      nodeShardCount: counts.node,
      edgeShardCount: counts.edge,
      evaluationShardCount: counts.evaluation,
      egoShardCount: counts.ego,
    },
    accounting: {
      universeRecordCount,
      indexedRecordCount: publicGraph.universeNodeCount,
      addressKindCounts: publicGraph.addressKindCounts,
      relationshipStatusCounts: publicGraph.relationshipStatusCounts,
      typedEdgeCount: publicGraph.typedEdgeCount,
      typedEdgeTypeCounts: publicGraph.typedEdgeTypeCounts,
      candidatePairCount: completion.candidatePairCount,
      evaluationReceiptCount: publicGraph.evaluationReceiptCount,
      skippedGroupReceiptCount: publicGraph.skippedGroupReceiptCount,
      skippedEstimatedPairCount: completion.skippedEstimatedPairCount,
      unknownGeoRecordCount: densityArtifact.accounting.unknownGeoNodeCount,
      unknownTimeRecordCount: densityArtifact.accounting.unknownTimeNodeCount,
    },
    density,
    graphShards: publicGraph.shards,
    notices: [
      "All public sightings, documents, photos and videos are retained as canonical evidence-address nodes, including isolated records.",
      "Typed edges are bounded evidence relationships with receipts, not claims of causation, truth or extraordinary origin.",
      "Candidate evaluations that emitted no edge remain explicit; absence of an edge is not negative evidence.",
      "The candidate manifest and separate corpus-accounting receipt must pass calibration and publication review before activation.",
    ],
  };
  return decodeCaseGraphPublicManifest(manifest, corpusVersion);
};

const decodeInput = (input: Buffer | string | unknown) => {
  let value = input;
  if (Buffer.isBuffer(input) || typeof input === "string") {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
    if (bytes.length < 2 || bytes.length > MAX_MANIFEST_BYTES) throw new Error("case_graph_public_manifest_size_invalid");
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("case_graph_public_manifest_invalid_json");
    }
  }
  return value;
};

const decodeGraphShardSummary = (input: unknown, corpusVersion: string): FullCorpusPublicGraphShardSummary => {
  const value = exactKeys(
    input,
    ["shardKind", "shard", "shardCount", "itemCount", "firstKey", "lastKey", "itemSetSha256", "shardDigest", "artifactDigest", "archiveKey", "receiptKey", "uncompressedBytes", "compressedBytes", "compressedSha256", "renderAddressLookupSha256", "renderLodIndexSha256", "renderAddressUtf8Bytes", "renderPackedBytes", "renderLodIndexBytes"],
    "case_graph_public_manifest_graph_shard_invalid",
  );
  if (
    !GRAPH_SHARD_KINDS.includes(value.shardKind as FullCorpusPublicGraphShardKind) ||
    !Number.isSafeInteger(value.shard) ||
    Number(value.shard) < 0 ||
    !Number.isSafeInteger(value.shardCount) ||
    Number(value.shardCount) < 1 ||
    Number(value.shardCount) > 4096 ||
    Number(value.shard) >= Number(value.shardCount) ||
    !Number.isSafeInteger(value.itemCount) ||
    Number(value.itemCount) < 0 ||
    (value.firstKey !== null && (typeof value.firstKey !== "string" || !value.firstKey.length)) ||
    (value.lastKey !== null && (typeof value.lastKey !== "string" || !value.lastKey.length)) ||
    (Number(value.itemCount) === 0) !== (value.firstKey === null && value.lastKey === null)
  ) {
    throw new Error("case_graph_public_manifest_graph_shard_invalid");
  }
  digest(value.itemSetSha256, "case_graph_public_manifest_graph_shard_invalid");
  digest(value.shardDigest, "case_graph_public_manifest_graph_shard_invalid");
  digest(value.artifactDigest, "case_graph_public_manifest_graph_shard_invalid");
  digest(value.compressedSha256, "case_graph_public_manifest_graph_shard_invalid");
  storageKey(value.archiveKey, corpusVersion);
  storageKey(value.receiptKey, corpusVersion);
  boundedCount(value.uncompressedBytes, MAX_SHARD_COMPRESSED_BYTES * 8, "case_graph_public_manifest_graph_shard_invalid");
  boundedCount(value.compressedBytes, MAX_SHARD_COMPRESSED_BYTES, "case_graph_public_manifest_graph_shard_invalid");
  if (value.shardKind === "render") {
    if (Number(value.itemCount) > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD) {
      throw new Error("case_graph_public_manifest_render_shard_row_limit_exceeded");
    }
    if (Number(value.uncompressedBytes) > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES) {
      throw new Error("case_graph_public_manifest_render_shard_decode_budget_exceeded");
    }
    digest(value.renderAddressLookupSha256, "case_graph_public_manifest_graph_shard_invalid");
    digest(value.renderLodIndexSha256, "case_graph_public_manifest_graph_shard_invalid");
    safeCount(value.renderAddressUtf8Bytes, "case_graph_public_manifest_graph_shard_invalid");
    safeCount(value.renderPackedBytes, "case_graph_public_manifest_graph_shard_invalid");
    safeCount(value.renderLodIndexBytes, "case_graph_public_manifest_graph_shard_invalid");
  } else if (value.renderAddressLookupSha256 !== null || value.renderLodIndexSha256 !== null || value.renderAddressUtf8Bytes !== null || value.renderPackedBytes !== null || value.renderLodIndexBytes !== null) {
    throw new Error("case_graph_public_manifest_graph_shard_invalid");
  }
  return value as unknown as FullCorpusPublicGraphShardSummary;
};

export const decodeCaseGraphPublicManifest = (input: Buffer | string | unknown, expectedCorpusVersion?: string): CaseGraphPublicManifest => {
  const rawInput = input;
  const value = exactKeys(decodeInput(input), ["recordType", "schemaVersion", "publicationStatus", "corpusVersion", "generatedAt", "sourceSnapshotAt", "lineage", "accountingBinding", "models", "topology", "accounting", "density", "graphShards", "notices"]);
  if (value.recordType !== "case_vortex_public_manifest" || value.schemaVersion !== CASE_GRAPH_PUBLIC_MANIFEST_VERSION || value.publicationStatus !== "candidate") throw new Error("case_graph_public_manifest_invalid");
  const corpusVersion = corpusId(value.corpusVersion, "case_graph_public_manifest_corpus_invalid");
  if (expectedCorpusVersion && corpusVersion !== expectedCorpusVersion) throw new Error("case_graph_public_manifest_corpus_mismatch");
  const generatedAt = exactMillisecondTimestamp(value.generatedAt, "case_graph_public_manifest_generated_at_invalid");
  const sourceSnapshotAt = exactMillisecondTimestamp(value.sourceSnapshotAt, "case_graph_public_manifest_snapshot_at_invalid");

  const lineage = exactKeys(value.lineage, ["snapshot", "universe", "features", "relationshipInput", "relationship", "productionCompatibility", "relationshipRun", "publicGraph", "calibration", "calibrationEvidence", "contextualCompletion", "graph"]);
  const snapshot = exactKeys(lineage.snapshot, ["snapshotId", "snapshotPolicy", "capturePolicy", "snapshotAt", "materializedAt", "sourceMvccSnapshot"]);
  canonicalUuid(snapshot.snapshotId, "case_graph_public_manifest_snapshot_id_invalid");
  if (snapshot.snapshotPolicy !== EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY || snapshot.capturePolicy !== EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY || snapshot.snapshotAt !== sourceSnapshotAt || typeof snapshot.sourceMvccSnapshot !== "string" || !MVCC.test(snapshot.sourceMvccSnapshot)) {
    throw new Error("case_graph_public_manifest_snapshot_invalid");
  }
  exactMillisecondTimestamp(snapshot.snapshotAt, "case_graph_public_manifest_snapshot_invalid");
  canonicalTimestamp(snapshot.materializedAt, "case_graph_public_manifest_snapshot_invalid");

  const universe = exactKeys(lineage.universe, ["archiveVersion", "schemaVersion", "layoutVersion", "corpusVersion", "archiveSetSha256", "recordCount"]);
  if (universe.archiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION || universe.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION || universe.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION || universe.corpusVersion !== corpusVersion) throw new Error("case_graph_public_manifest_universe_invalid");
  digest(universe.archiveSetSha256);
  const universeRecordCount = safeCount(universe.recordCount);

  const features = exactKeys(lineage.features, ["scope", "archiveSchemaVersion", "featureSchemaVersion", "archiveSetSha256", "recordCount"]);
  if (features.scope !== "publishable_sightings_auxiliary" || features.archiveSchemaVersion !== CASE_GRAPH_ARCHIVE_SCHEMA_VERSION || features.featureSchemaVersion !== CASE_GRAPH_FEATURE_SCHEMA_VERSION) {
    throw new Error("case_graph_public_manifest_feature_lineage_invalid");
  }
  digest(features.archiveSetSha256);
  if (safeCount(features.recordCount) > universeRecordCount) throw new Error("case_graph_public_manifest_feature_count_mismatch");

  const relationshipInput = exactKeys(lineage.relationshipInput, ["schemaVersion", "canonicalVersion", "binding", "archiveSetSha256", "manifestDigest", "recordCount"]);
  if (relationshipInput.schemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION || relationshipInput.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION) {
    throw new Error("case_graph_public_manifest_relationship_input_invalid");
  }
  const relationshipBinding = validateRelationshipInputBinding(relationshipInput.binding);
  if (
    relationshipBinding.snapshotId !== snapshot.snapshotId ||
    relationshipBinding.corpusVersion !== corpusVersion ||
    relationshipBinding.universeArchiveVersion !== universe.archiveVersion ||
    relationshipBinding.universeSchemaVersion !== universe.schemaVersion ||
    relationshipBinding.universeLayoutVersion !== universe.layoutVersion ||
    relationshipBinding.universeArchiveSetSha256 !== universe.archiveSetSha256 ||
    relationshipBinding.universeRecordCount !== universeRecordCount ||
    safeCount(relationshipInput.recordCount) !== universeRecordCount
  ) {
    throw new Error("case_graph_public_manifest_relationship_input_binding_mismatch");
  }
  digest(relationshipInput.archiveSetSha256);
  digest(relationshipInput.manifestDigest);

  const relationship = exactKeys(lineage.relationship, ["policyVersion", "policySha256", "modelId", "modelVersion", "modelSha256"]);
  if (relationship.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION || relationship.policySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256 || relationship.modelId !== TYPED_RELATIONSHIP_MODEL_ID || relationship.modelVersion !== TYPED_RELATIONSHIP_MODEL_VERSION || relationship.modelSha256 !== TYPED_RELATIONSHIP_MODEL_SHA256) {
    throw new Error("case_graph_public_manifest_relationship_model_invalid");
  }
  const productionCompatibility = decodeFullCorpusProductionCompatibilityPointer(lineage.productionCompatibility, { corpusVersion, snapshotId: String(snapshot.snapshotId) });
  const relationshipRun = decodeFullCorpusRelationshipRunIndexPointer(lineage.relationshipRun);
  if (
    !sameCanonical(relationshipRun.lineage.binding, relationshipBinding) ||
    relationshipRun.lineage.relationshipInputManifestDigest !== relationshipInput.manifestDigest ||
    relationshipRun.lineage.relationshipInputArchiveSetSha256 !== relationshipInput.archiveSetSha256 ||
    relationshipRun.lineage.typedRelationshipPolicyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION ||
    relationshipRun.lineage.typedRelationshipPolicySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256
  ) {
    throw new Error("case_graph_public_manifest_relationship_run_invalid");
  }

  const publicGraph = exactKeys(lineage.publicGraph, [
    "schemaVersion",
    "archiveVersion",
    "manifestDigest",
    "manifestArtifactDigest",
    "manifestArchiveKey",
    "manifestReceiptKey",
    "manifestCompressedBytes",
    "manifestCompressedSha256",
    "manifestReceiptDigest",
    "shardSetSha256",
    "universeNodeSetSha256",
    "renderRowCount",
    "renderAddressKindCounts",
    "renderAddressSetSha256",
    "renderSetSha256",
    "renderUncompressedBytes",
    "renderCompressedBytes",
    "renderFormat",
    "renderAddressOrder",
    "renderPackedLayout",
    "renderPackedLayoutSha256",
    "renderAddressLookupSetSha256",
    "renderLodPolicy",
    "renderLodPolicySha256",
    "renderLodIndexSetSha256",
    "renderTemporalMapping",
    "renderTemporalMappingSha256",
    "renderAddressUtf8Bytes",
    "renderPackedBytes",
    "renderLodIndexBytes",
    "renderRetainedBytes",
    "renderRetainedBudgetBytes",
    "renderInFlightDecodeBudgetBytes",
    "renderBufferAllocation",
    "fullNodeMetadataAccess",
    "nodeSetSha256",
    "typedEdgeIdSetSha256",
    "pairReducerTypedEdgeCount",
    "pairReducerTypedEdgeIdSetSha256",
    "publicEdgeSetSha256",
    "evaluationSetSha256",
    "statusReceiptSetSha256",
    "egoSetSha256",
    "contextualRelationshipCompletion",
  ]);
  if (publicGraph.schemaVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION || publicGraph.archiveVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_ARCHIVE_VERSION) {
    throw new Error("case_graph_public_manifest_public_graph_invalid");
  }
  for (const field of [
    "manifestDigest",
    "manifestArtifactDigest",
    "manifestCompressedSha256",
    "manifestReceiptDigest",
    "shardSetSha256",
    "universeNodeSetSha256",
    "renderAddressSetSha256",
    "renderSetSha256",
    "nodeSetSha256",
    "typedEdgeIdSetSha256",
    "publicEdgeSetSha256",
    "evaluationSetSha256",
    "statusReceiptSetSha256",
    "egoSetSha256",
    "renderPackedLayoutSha256",
    "pairReducerTypedEdgeIdSetSha256",
    "renderAddressLookupSetSha256",
    "renderLodPolicySha256",
    "renderLodIndexSetSha256",
    "renderTemporalMappingSha256",
  ])
    digest(publicGraph[field], "case_graph_public_manifest_public_graph_invalid");
  storageKey(publicGraph.manifestArchiveKey, corpusVersion);
  storageKey(publicGraph.manifestReceiptKey, corpusVersion);
  boundedCount(publicGraph.manifestCompressedBytes, MAX_SHARD_COMPRESSED_BYTES, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderRowCount = safeCount(publicGraph.renderRowCount, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphPairReducerTypedEdgeCount = safeCount(publicGraph.pairReducerTypedEdgeCount, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderAddressKindCounts = validateNamedCounts(publicGraph.renderAddressKindCounts, NODE_KINDS, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderUncompressedBytes = boundedCount(publicGraph.renderUncompressedBytes, MAX_SHARD_COMPRESSED_BYTES * 8, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderCompressedBytes = boundedCount(publicGraph.renderCompressedBytes, MAX_SHARD_COMPRESSED_BYTES, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderAddressUtf8Bytes = safeCount(publicGraph.renderAddressUtf8Bytes, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderPackedBytes = safeCount(publicGraph.renderPackedBytes, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderLodIndexBytes = safeCount(publicGraph.renderLodIndexBytes, "case_graph_public_manifest_public_graph_invalid");
  const publicGraphRenderRetainedBytes = safeCount(publicGraph.renderRetainedBytes, "case_graph_public_manifest_public_graph_invalid");
  if (
    publicGraphRenderRowCount !== universeRecordCount ||
    sumSafe(Object.values(publicGraphRenderAddressKindCounts)) !== universeRecordCount ||
    publicGraphRenderUncompressedBytes < 1 ||
    publicGraphRenderCompressedBytes < 1 ||
    publicGraph.renderFormat !== PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT ||
    publicGraph.renderAddressOrder !== PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER ||
    !sameCanonical(publicGraph.renderPackedLayout, PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT) ||
    publicGraph.renderPackedLayoutSha256 !== sha256(canonicalJson(PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT)) ||
    !sameCanonical(publicGraph.renderLodPolicy, PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY) ||
    publicGraph.renderLodPolicySha256 !== sha256(canonicalJson(PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY)) ||
    !sameCanonical(publicGraph.renderTemporalMapping, PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING) ||
    publicGraph.renderTemporalMappingSha256 !== sha256(canonicalJson(PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING)) ||
    publicGraphRenderAddressUtf8Bytes < publicGraphRenderRowCount ||
    publicGraphRenderPackedBytes < publicGraphRenderAddressUtf8Bytes ||
    publicGraphRenderLodIndexBytes < 1 ||
    publicGraphRenderRetainedBytes !== publicGraphRenderPackedBytes + publicGraphRenderLodIndexBytes ||
    publicGraphRenderRetainedBytes > PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES ||
    publicGraph.renderRetainedBudgetBytes !== PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES ||
    publicGraph.renderInFlightDecodeBudgetBytes !== PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES ||
    publicGraph.renderBufferAllocation !== PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION ||
    publicGraph.fullNodeMetadataAccess !== "on_demand_node_and_ego_shards"
  ) {
    throw new Error("case_graph_public_manifest_public_graph_invalid");
  }
  const calibration = exactKeys(lineage.calibration, ["set", "pair", "contextual"]);
  const calibrationSet = exactKeys(calibration.set, ["schemaVersion", "receiptKey", "receiptSha256", "receiptBodySha256", "calibrationSetSha256"], "case_graph_public_manifest_calibration_invalid");
  if (calibrationSet.schemaVersion !== CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION) {
    throw new Error("case_graph_public_manifest_calibration_invalid");
  }
  storageKey(calibrationSet.receiptKey, corpusVersion);
  digest(calibrationSet.receiptSha256, "case_graph_public_manifest_calibration_invalid");
  digest(calibrationSet.receiptBodySha256, "case_graph_public_manifest_calibration_invalid");
  digest(calibrationSet.calibrationSetSha256, "case_graph_public_manifest_calibration_invalid");
  for (const name of ["pair", "contextual"] as const) {
    const receipt = exactKeys(calibration[name], ["receiptId", "receiptKey", "receiptSha256", "receiptBodySha256", "lineageSha256"], "case_graph_public_manifest_calibration_invalid");
    stableId(receipt.receiptId, "case_graph_public_manifest_calibration_invalid");
    storageKey(receipt.receiptKey, corpusVersion);
    digest(receipt.receiptSha256, "case_graph_public_manifest_calibration_invalid");
    digest(receipt.receiptBodySha256, "case_graph_public_manifest_calibration_invalid");
    digest(receipt.lineageSha256, "case_graph_public_manifest_calibration_invalid");
  }
  const normalizedCalibration = calibration as unknown as CaseGraphPublicationCalibrationLineage;
  const rawCalibrationEvidence = exactKeys(lineage.calibrationEvidence, ["humanReview", "pair", "contextual"], "case_graph_public_manifest_calibration_evidence_invalid");
  const humanReview = exactKeys(rawCalibrationEvidence.humanReview, ["bundleKey", "bundleBodySha256", "bundleDigest", "evidenceSetSha256", "packDigest", "adjudicationDigest"], "case_graph_public_manifest_calibration_evidence_invalid");
  const calibrationBodies = Object.fromEntries(
    (["pair", "contextual"] as const).map((name) => {
      const pointer = exactKeys(rawCalibrationEvidence[name], ["artifactKey", "artifactBodySha256", "artifactDigest", "trustPolicyKey", "trustPolicyBodySha256", "trustPolicyDigest"], "case_graph_public_manifest_calibration_evidence_invalid");
      return [
        name,
        {
          artifactKey: storageKey(pointer.artifactKey, corpusVersion),
          artifactBodySha256: digest(pointer.artifactBodySha256, "case_graph_public_manifest_calibration_evidence_invalid"),
          artifactDigest: digest(pointer.artifactDigest, "case_graph_public_manifest_calibration_evidence_invalid"),
          trustPolicyKey: storageKey(pointer.trustPolicyKey, corpusVersion),
          trustPolicyBodySha256: digest(pointer.trustPolicyBodySha256, "case_graph_public_manifest_calibration_evidence_invalid"),
          trustPolicyDigest: digest(pointer.trustPolicyDigest, "case_graph_public_manifest_calibration_evidence_invalid"),
        },
      ];
    }),
  ) as Pick<CaseGraphPublicationCalibrationEvidenceLineage, "pair" | "contextual">;
  const calibrationEvidence: CaseGraphPublicationCalibrationEvidenceLineage = {
    humanReview: {
      bundleKey: storageKey(humanReview.bundleKey, corpusVersion),
      bundleBodySha256: digest(humanReview.bundleBodySha256, "case_graph_public_manifest_calibration_evidence_invalid"),
      bundleDigest: digest(humanReview.bundleDigest, "case_graph_public_manifest_calibration_evidence_invalid"),
      evidenceSetSha256: digest(humanReview.evidenceSetSha256, "case_graph_public_manifest_calibration_evidence_invalid"),
      packDigest: digest(humanReview.packDigest, "case_graph_public_manifest_calibration_evidence_invalid"),
      adjudicationDigest: digest(humanReview.adjudicationDigest, "case_graph_public_manifest_calibration_evidence_invalid"),
    },
    ...calibrationBodies,
  };
  const contextualCompletionInput = exactKeys(lineage.contextualCompletion, ["key", "bodySha256", "completionId", "completionDigest", "sourceCompletionSetSha256", "entrySetSha256", "accounting"], "case_graph_public_manifest_contextual_completion_invalid");
  const contextualCompletion: CaseGraphPublicationContextualCompletionPointer = {
    key: storageKey(contextualCompletionInput.key, corpusVersion),
    bodySha256: digest(contextualCompletionInput.bodySha256, "case_graph_public_manifest_contextual_completion_invalid"),
    completionId: stableId(contextualCompletionInput.completionId, "case_graph_public_manifest_contextual_completion_invalid"),
    completionDigest: digest(contextualCompletionInput.completionDigest, "case_graph_public_manifest_contextual_completion_invalid"),
    sourceCompletionSetSha256: digest(contextualCompletionInput.sourceCompletionSetSha256, "case_graph_public_manifest_contextual_completion_invalid"),
    entrySetSha256: digest(contextualCompletionInput.entrySetSha256, "case_graph_public_manifest_contextual_completion_invalid"),
    accounting: decodeContextualCompletionAccounting(contextualCompletionInput.accounting),
  };
  const graphContextualInput = exactKeys(
    publicGraph.contextualRelationshipCompletion,
    ["schemaVersion", "completionId", "completionDigest", "sourceCompletionSetSha256", "contextualIdentitySha256", "entrySetSha256", "calibrationReceiptId", "calibrationReceiptSha256", "accounting", "zeroObservationState", "acceptedEdgeIdSetSha256"],
    "case_graph_public_manifest_contextual_completion_invalid",
  );
  const graphContextualAccounting = decodeContextualCompletionAccounting(graphContextualInput.accounting);
  if (
    graphContextualInput.schemaVersion !== CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION ||
    stableId(graphContextualInput.completionId, "case_graph_public_manifest_contextual_completion_invalid") !== contextualCompletion.completionId ||
    digest(graphContextualInput.completionDigest, "case_graph_public_manifest_contextual_completion_invalid") !== contextualCompletion.completionDigest ||
    digest(graphContextualInput.sourceCompletionSetSha256, "case_graph_public_manifest_contextual_completion_invalid") !== contextualCompletion.sourceCompletionSetSha256 ||
    digest(graphContextualInput.entrySetSha256, "case_graph_public_manifest_contextual_completion_invalid") !== contextualCompletion.entrySetSha256 ||
    digest(graphContextualInput.contextualIdentitySha256, "case_graph_public_manifest_contextual_completion_invalid") !== CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256 ||
    stableId(graphContextualInput.calibrationReceiptId, "case_graph_public_manifest_contextual_completion_invalid") !== normalizedCalibration.contextual.receiptId ||
    digest(graphContextualInput.calibrationReceiptSha256, "case_graph_public_manifest_contextual_completion_invalid") !== normalizedCalibration.contextual.receiptSha256 ||
    !sameCanonical(graphContextualAccounting, contextualCompletion.accounting) ||
    graphContextualInput.zeroObservationState !== (contextualCompletion.accounting.sourceRecordCount === 0) ||
    !digest(graphContextualInput.acceptedEdgeIdSetSha256, "case_graph_public_manifest_contextual_completion_invalid")
  ) {
    throw new Error("case_graph_public_manifest_contextual_completion_invalid");
  }
  const graph = exactKeys(lineage.graph, ["artifactSetVersion", "artifactSetSha256"]);
  if (graph.artifactSetVersion !== CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION) {
    throw new Error("case_graph_public_manifest_graph_lineage_invalid");
  }
  digest(graph.artifactSetSha256);

  const models = exactKeys(value.models, [
    "publishabilityPolicy",
    "auxiliaryFeatureSchemaVersion",
    "relationshipInputSchemaVersion",
    "canonicalVersion",
    "rarityVersion",
    "pipelineVersion",
    "pipelineArchiveVersion",
    "relationshipSchemaVersion",
    "relationshipPolicyVersion",
    "relationshipPolicySha256",
    "relationshipModelId",
    "relationshipModelVersion",
    "relationshipModelSha256",
    "publicGraphVersion",
    "densityVersion",
    "edgeTypes",
  ]);
  stableId(models.publishabilityPolicy, "case_graph_public_manifest_model_invalid");
  if (
    models.auxiliaryFeatureSchemaVersion !== CASE_GRAPH_FEATURE_SCHEMA_VERSION ||
    models.relationshipInputSchemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION ||
    models.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION ||
    models.rarityVersion !== TYPED_RELATIONSHIP_RARITY_VERSION ||
    models.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    models.pipelineArchiveVersion !== FULL_CORPUS_RELATIONSHIP_ARCHIVE_VERSION ||
    models.relationshipSchemaVersion !== TYPED_RELATIONSHIP_SCHEMA_VERSION ||
    models.relationshipPolicyVersion !== relationship.policyVersion ||
    models.relationshipPolicySha256 !== relationship.policySha256 ||
    models.relationshipModelId !== relationship.modelId ||
    models.relationshipModelVersion !== relationship.modelVersion ||
    models.relationshipModelSha256 !== relationship.modelSha256 ||
    models.publicGraphVersion !== PUBLIC_TYPED_RELATIONSHIP_GRAPH_VERSION ||
    models.densityVersion !== PUBLIC_TYPED_DENSITY_VERSION ||
    !Array.isArray(models.edgeTypes) ||
    !sameCanonical(models.edgeTypes, TYPED_RELATIONSHIP_EDGE_TYPES)
  ) {
    throw new Error("case_graph_public_manifest_model_invalid");
  }

  const topology = exactKeys(value.topology, ["postingShardCount", "pairShardCount", "renderShardCount", "nodeShardCount", "edgeShardCount", "evaluationShardCount", "egoShardCount"]);
  for (const field of Object.keys(topology)) {
    if (boundedCount(topology[field], 4096, "case_graph_public_manifest_topology_invalid") < 1) {
      throw new Error("case_graph_public_manifest_topology_invalid");
    }
  }

  const accounting = exactKeys(value.accounting, ["universeRecordCount", "indexedRecordCount", "addressKindCounts", "relationshipStatusCounts", "typedEdgeCount", "typedEdgeTypeCounts", "candidatePairCount", "evaluationReceiptCount", "skippedGroupReceiptCount", "skippedEstimatedPairCount", "unknownGeoRecordCount", "unknownTimeRecordCount"]);
  if (safeCount(accounting.universeRecordCount) !== universeRecordCount || safeCount(accounting.indexedRecordCount) !== universeRecordCount) {
    throw new Error("case_graph_public_manifest_accounting_invalid");
  }
  const addressKindCounts = validateNamedCounts(accounting.addressKindCounts, NODE_KINDS, "case_graph_public_manifest_kind_counts_invalid");
  const relationshipStatusCounts = validateNamedCounts(accounting.relationshipStatusCounts, RELATIONSHIP_STATUSES, "case_graph_public_manifest_status_counts_invalid");
  const typedEdgeTypeCounts = validateNamedCounts(accounting.typedEdgeTypeCounts, TYPED_RELATIONSHIP_EDGE_TYPES, "case_graph_public_manifest_edge_type_counts_invalid");
  const typedEdgeCount = safeCount(accounting.typedEdgeCount);
  const candidatePairCount = safeCount(accounting.candidatePairCount);
  const evaluationReceiptCount = safeCount(accounting.evaluationReceiptCount);
  safeCount(accounting.skippedGroupReceiptCount);
  safeCount(accounting.skippedEstimatedPairCount);
  if (
    sumSafe(Object.values(addressKindCounts)) !== universeRecordCount ||
    !sameCanonical(publicGraphRenderAddressKindCounts, addressKindCounts) ||
    sumSafe(Object.values(relationshipStatusCounts)) !== universeRecordCount ||
    sumSafe(Object.values(typedEdgeTypeCounts)) !== typedEdgeCount ||
    publicGraphPairReducerTypedEdgeCount + contextualCompletion.accounting.acceptedEdgeCount !== typedEdgeCount ||
    candidatePairCount !== evaluationReceiptCount ||
    safeCount(accounting.unknownGeoRecordCount) > universeRecordCount ||
    safeCount(accounting.unknownTimeRecordCount) > universeRecordCount
  ) {
    throw new Error("case_graph_public_manifest_accounting_invalid");
  }

  const density = decodeFullCorpusPublicDensityPointer(value.density, {
    corpusVersion,
    snapshotId: String(snapshot.snapshotId),
    publicGraphManifestDigest: String(publicGraph.manifestDigest),
  });
  if (density.nodeCount !== universeRecordCount || !sameCanonical(density.byKind, addressKindCounts) || density.artifactSchemaVersion !== PUBLIC_TYPED_DENSITY_VERSION || density.schemaVersion !== PUBLIC_TYPED_DENSITY_ARCHIVE_VERSION) {
    throw new Error("case_graph_public_manifest_density_invalid");
  }

  if (!Array.isArray(value.graphShards) || !value.graphShards.length) {
    throw new Error("case_graph_public_manifest_graph_shards_invalid");
  }
  const graphShards = value.graphShards.map((shard) => decodeGraphShardSummary(shard, corpusVersion));
  if (graphShards.some((shard, index) => index > 0 && (graphShards[index - 1].shardKind.localeCompare(shard.shardKind) > 0 || (graphShards[index - 1].shardKind === shard.shardKind && graphShards[index - 1].shard >= shard.shard)))) throw new Error("case_graph_public_manifest_graph_shard_order_invalid");
  const counts = shardCounts(graphShards);
  for (const kind of GRAPH_SHARD_KINDS) {
    const kindShards = graphShards.filter((shard) => shard.shardKind === kind);
    if (!kindShards.length || kindShards.length !== kindShards[0].shardCount || kindShards.some((shard, index) => shard.shard !== index || shard.shardCount !== kindShards.length)) {
      throw new Error("case_graph_public_manifest_graph_shard_sequence_invalid");
    }
  }
  if (
    counts.node !== topology.nodeShardCount ||
    counts.render !== topology.renderShardCount ||
    counts.edge !== topology.edgeShardCount ||
    counts.evaluation !== topology.evaluationShardCount ||
    counts.ego !== topology.egoShardCount ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "node").map((shard) => shard.itemCount)) !== universeRecordCount ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "render").map((shard) => shard.itemCount)) !== universeRecordCount ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "ego").map((shard) => shard.itemCount)) !== universeRecordCount ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "render").map((shard) => shard.uncompressedBytes)) !== publicGraphRenderUncompressedBytes ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "render").map((shard) => shard.compressedBytes)) !== publicGraphRenderCompressedBytes ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "render").map((shard) => Number(shard.renderAddressUtf8Bytes))) !== publicGraphRenderAddressUtf8Bytes ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "render").map((shard) => Number(shard.renderPackedBytes))) !== publicGraphRenderPackedBytes ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "render").map((shard) => Number(shard.renderLodIndexBytes))) !== publicGraphRenderLodIndexBytes ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "edge").map((shard) => shard.itemCount)) !== typedEdgeCount ||
    sumSafe(graphShards.filter((shard) => shard.shardKind === "evaluation").map((shard) => shard.itemCount)) !== evaluationReceiptCount
  ) {
    throw new Error("case_graph_public_manifest_graph_shard_accounting_invalid");
  }
  const expectedShardSetSha256 = sha256(graphShards.map((summary) => `${summary.shardKind}:${summary.shard}:${summary.shardDigest}`).join("\n"));
  if (publicGraph.shardSetSha256 !== expectedShardSetSha256) {
    throw new Error("case_graph_public_manifest_public_graph_shard_set_mismatch");
  }
  const renderShards = graphShards.filter((shard) => shard.shardKind === "render");
  const expectedRenderAddressLookupSetSha256 = sha256(renderShards.map((summary) => `${summary.shard}:${summary.renderAddressLookupSha256}`).join("\n"));
  const expectedRenderLodIndexSetSha256 = sha256(renderShards.map((summary) => `${summary.shard}:${summary.renderLodIndexSha256}`).join("\n"));
  if (publicGraph.renderAddressLookupSetSha256 !== expectedRenderAddressLookupSetSha256 || publicGraph.renderLodIndexSetSha256 !== expectedRenderLodIndexSetSha256) {
    throw new Error("case_graph_public_manifest_render_packing_set_mismatch");
  }

  if (!Array.isArray(value.notices) || !value.notices.length || value.notices.some((notice) => typeof notice !== "string" || !notice || notice.length > 2_048 || /[\u0000-\u001f\u007f]/.test(notice))) throw new Error("case_graph_public_manifest_notices_invalid");

  const accountingBinding = decodeCaseVortexAccountingPublicationBinding(value.accountingBinding);
  if (
    accountingBinding.corpusVersion !== corpusVersion ||
    accountingBinding.snapshotId !== snapshot.snapshotId ||
    accountingBinding.universe.archiveVersion !== universe.archiveVersion ||
    accountingBinding.universe.schemaVersion !== universe.schemaVersion ||
    accountingBinding.universe.layoutVersion !== universe.layoutVersion ||
    accountingBinding.universe.archiveSetSha256 !== universe.archiveSetSha256 ||
    accountingBinding.universe.recordCount !== universeRecordCount ||
    accountingBinding.relationshipInput.schemaVersion !== relationshipInput.schemaVersion ||
    accountingBinding.relationshipInput.archiveSetSha256 !== relationshipInput.archiveSetSha256 ||
    accountingBinding.relationshipInput.manifestDigest !== relationshipInput.manifestDigest ||
    accountingBinding.relationshipInput.recordCount !== universeRecordCount ||
    accountingBinding.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION ||
    accountingBinding.graphAddressLedger.recordCount !== universeRecordCount ||
    !sameCanonical(accountingBinding.graphAddressLedger.byKind, addressKindCounts)
  ) {
    throw new Error("case_graph_public_manifest_accounting_binding_mismatch");
  }

  const decoded = value as unknown as CaseGraphPublicManifest;
  const expectedArtifactSetSha256 = getCaseGraphArtifactSetSha256({
    corpusVersion,
    relationshipRun,
    productionCompatibility,
    publicGraph: decoded.lineage.publicGraph,
    density,
    calibration: normalizedCalibration,
    calibrationEvidence,
    contextualCompletion,
    graphShards,
    graphAddressLedger: accountingBinding.graphAddressLedger,
  });
  if (graph.artifactSetSha256 !== expectedArtifactSetSha256) {
    throw new Error("case_graph_public_manifest_graph_artifact_set_mismatch");
  }
  const normalized: CaseGraphPublicManifest = {
    ...decoded,
    generatedAt,
    sourceSnapshotAt,
    accountingBinding,
    density,
    graphShards,
    lineage: {
      ...decoded.lineage,
      relationshipInput: { ...decoded.lineage.relationshipInput, binding: relationshipBinding },
      productionCompatibility,
      relationshipRun,
      calibrationEvidence,
      contextualCompletion,
    },
  };
  if (Buffer.isBuffer(rawInput) || typeof rawInput === "string") {
    const exactBody = Buffer.isBuffer(rawInput) ? rawInput : Buffer.from(rawInput, "utf8");
    if (!exactBody.equals(encodeCaseGraphPublicManifest(normalized))) {
      throw new Error("case_graph_public_manifest_non_canonical");
    }
  }
  return normalized;
};
