import { createHash } from 'node:crypto';

import {
  getCaseGraphPublicationKeys,
  getEvidenceUniverseControlKeys,
} from './archiveKeys';
import type {
  CaseGraphArchiveStorage,
  CaseGraphConditionalArchiveStorage,
} from './archiveTypes';
import { getAuthoritativeCalibrationHumanReviewEvidence } from './calibrationHumanReview';
import type { CaseVortexCorpusAccountingReceipt } from './corpusAccounting';
import {
  caseVortexCorpusAccountingReceiptSha256,
  decodeCaseVortexAccountingPublicationBinding,
  decodeCaseVortexCorpusAccountingReceipt,
  type CaseVortexAccountingPublicationBinding,
} from './corpusAccountingIntegration';
import { canonicalizeContextualExplanation } from './contextualExplanation';
import {
  assertContextualRelationshipCompletionProductionEligible,
  serializeContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionAccounting,
} from './contextualRelationshipCompletion';
import { decodeEvidenceUniverseCompletion } from './evidenceUniversePublicAccess';
import { readVerifiedCaseGraphFeatureArchive } from './featureArchive';
import {
  readVerifiedFullCorpusProductionCompatibilityReceipt,
  type FullCorpusProductionCompatibilityPointer,
} from './fullCorpusProductionCompatibility';
import {
  buildCaseGraphPublicManifest,
  caseGraphPublicManifestSha256,
  decodeCaseGraphPublicManifest,
  encodeCaseGraphPublicManifest,
  CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION,
  CASE_GRAPH_PUBLIC_MANIFEST_VERSION,
  type CaseGraphPublicManifest,
} from './publicationManifest';
import {
  buildCaseGraphPublicationCalibrationSetReceipt,
  decodeCaseGraphPublicationCalibrationSetReceipt,
  serializeCaseGraphPublicationCalibrationSetReceipt,
  verifyCaseGraphPublicationCalibrationSetReceiptBodies,
} from './publicationCalibrationSet';
import {
  decodeRelationshipInputSnapshotManifest,
  getRelationshipInputControlKeys,
} from './relationshipInputArchive';
import {
  canonicalizeRelationshipInput,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_MODEL_ID,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_MODEL_VERSION,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
} from './typedRelationshipEngine';
import type { FullCorpusRelationshipCompletion } from './typedRelationshipPipeline';
import {
  readVerifiedFullCorpusRelationshipArchiveObject,
  readVerifiedFullCorpusRelationshipRunIndex,
  type FullCorpusRelationshipRunIndexPointer,
} from './typedRelationshipPipelineArchive';
import {
  buildFullCorpusPublicRenderPackingReceipt,
  readVerifiedFullCorpusPublicGraphArchiveObject,
  type FullCorpusPublicEdge,
  type FullCorpusPublicGraphShard,
  type FullCorpusPublicGraphManifest,
  type FullCorpusPublicRenderRow,
} from './typedRelationshipPublicGraph';
import {
  decodeFullCorpusPublicDensityArchiveObject,
  decodeFullCorpusPublicDensityPointer,
  type FullCorpusPublicDensityPointer,
} from './typedPublicDensity';
import {
  assertTypedRelationshipCalibrationReceiptProductionEligible,
  decodeTypedRelationshipCalibrationArtifact,
  decodeTypedRelationshipCalibrationTrustPolicy,
  serializeTypedRelationshipCalibrationArtifact,
  serializeTypedRelationshipCalibrationReceipt,
  type TypedRelationshipCalibrationLineage,
} from './typedRelationshipCalibration';
import {
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  decodeContextualRelationshipCalibrationArtifact,
  decodeContextualRelationshipCalibrationTrustPolicy,
  serializeContextualRelationshipCalibrationArtifact,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationLineage,
} from './contextualRelationshipCalibration';

export const CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION = 2 as const;

export type CaseGraphPublicationCandidateCompletion = {
  record_type: 'case_graph_publication_candidate_completion';
  schema_version: typeof CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION;
  public_manifest_version: typeof CASE_GRAPH_PUBLIC_MANIFEST_VERSION;
  graph_artifact_set_version: typeof CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION;
  corpus_version: string;
  snapshot_id: string;
  manifest_key: string;
  manifest_sha256: string;
  accounting_receipt_key: string;
  accounting_receipt_sha256: string;
  relationship_input_manifest_digest: string;
  relationship_policy_version: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
  relationship_policy_sha256: typeof TYPED_RELATIONSHIP_POLICY_SHA256;
  relationship_model_id: typeof TYPED_RELATIONSHIP_MODEL_ID;
  relationship_model_version: typeof TYPED_RELATIONSHIP_MODEL_VERSION;
  relationship_model_sha256: typeof TYPED_RELATIONSHIP_MODEL_SHA256;
  relationship_run_index_digest: string;
  relationship_run_artifact_set_sha256: string;
  relationship_completion_digest: string;
  public_graph_manifest_digest: string;
  density_artifact_digest: string;
  calibration_set_receipt_key: string;
  calibration_set_receipt_sha256: string;
  calibration_set_receipt_body_sha256: string;
  calibration_set_sha256: string;
  pair_calibration_receipt_id: string;
  pair_calibration_receipt_key: string;
  pair_calibration_receipt_sha256: string;
  pair_calibration_receipt_body_sha256: string;
  pair_calibration_lineage_sha256: string;
  contextual_calibration_receipt_id: string;
  contextual_calibration_receipt_key: string;
  contextual_calibration_receipt_sha256: string;
  contextual_calibration_receipt_body_sha256: string;
  contextual_calibration_lineage_sha256: string;
  pair_calibration_artifact_key: string;
  pair_calibration_artifact_body_sha256: string;
  pair_calibration_artifact_digest: string;
  pair_calibration_trust_policy_key: string;
  pair_calibration_trust_policy_body_sha256: string;
  pair_calibration_trust_policy_digest: string;
  contextual_calibration_artifact_key: string;
  contextual_calibration_artifact_body_sha256: string;
  contextual_calibration_artifact_digest: string;
  contextual_calibration_trust_policy_key: string;
  contextual_calibration_trust_policy_body_sha256: string;
  contextual_calibration_trust_policy_digest: string;
  contextual_relationship_completion_key: string;
  contextual_relationship_completion_body_sha256: string;
  contextual_relationship_completion_id: string;
  contextual_relationship_completion_digest: string;
  contextual_relationship_source_completion_set_sha256: string;
  contextual_relationship_entry_set_sha256: string;
  contextual_relationship_accounting: ContextualRelationshipCompletionAccounting;
  graph_artifact_set_sha256: string;
  eligible_case_count: number;
  indexed_case_count: number;
  candidate_pair_count: number;
  unique_edge_count: number;
  skipped_group_count: number;
  skipped_estimated_pair_count: number;
  generated_at: string;
};

export type CaseGraphPublicationLineageReceipts = {
  /** Exact timestamp used when the accounting layer hashed publication bytes. */
  generatedAt: string;
  relationshipRun: FullCorpusRelationshipRunIndexPointer;
  productionCompatibility: FullCorpusProductionCompatibilityPointer;
  publicGraphManifestReceiptKey: string;
  density: FullCorpusPublicDensityPointer;
  calibration: {
    humanReviewBundleBody: Buffer;
    pairReceiptBody: Buffer;
    contextualReceiptBody: Buffer;
    pairLineage: TypedRelationshipCalibrationLineage;
    contextualLineage: ContextualRelationshipCalibrationLineage;
    pairArtifactBody: Buffer;
    pairTrustPolicyBody: Buffer;
    contextualArtifactBody: Buffer;
    contextualTrustPolicyBody: Buffer;
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
  contextualRelationshipCompletionBody: Buffer;
  accountingBinding: CaseVortexAccountingPublicationBinding;
  /** Canonical receipt bytes generated after hashing the exact public manifest. */
  accountingReceiptBody: Buffer;
};

type PublicationReadStorage = Pick<CaseGraphArchiveStorage, 'readObject'>;

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const exactKeys = (value: unknown, keys: readonly string[]) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const safeCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const CONTEXTUAL_SOURCE_KINDS = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;
const parseContextualCompletionAccounting = (
  input: unknown,
): ContextualRelationshipCompletionAccounting | null => {
  if (!exactKeys(input, [
    'sourceSnapshotCount', 'sourceKindCount', 'sourceRecordCount', 'acceptedEdgeCount',
    'insufficientEvidenceCount', 'uniqueAddressCount', 'addressStatusCounts', 'sourceKindCounts',
  ])) return null;
  const value = input as Record<string, unknown>;
  if (value.sourceKindCount !== 4
    || !safeCount(value.sourceSnapshotCount) || Number(value.sourceSnapshotCount) < 4
    || !safeCount(value.sourceRecordCount)
    || !safeCount(value.acceptedEdgeCount)
    || !safeCount(value.insufficientEvidenceCount)
    || !safeCount(value.uniqueAddressCount)
    || Number(value.sourceRecordCount)
      !== Number(value.acceptedEdgeCount) + Number(value.insufficientEvidenceCount)
    || !exactKeys(value.addressStatusCounts, ['accepted_only', 'insufficient_only', 'mixed'])
    || !exactKeys(value.sourceKindCounts, CONTEXTUAL_SOURCE_KINDS)) return null;
  const addressStatusCounts = value.addressStatusCounts as Record<string, unknown>;
  if (Object.values(addressStatusCounts).some((count) => !safeCount(count))
    || Number(value.uniqueAddressCount)
      !== Object.values(addressStatusCounts).reduce<number>((sum, count) => sum + Number(count), 0)) return null;
  const rawKindCounts = value.sourceKindCounts as Record<string, unknown>;
  const sourceKindCounts = {} as ContextualRelationshipCompletionAccounting['sourceKindCounts'];
  for (const kind of CONTEXTUAL_SOURCE_KINDS) {
    if (!exactKeys(rawKindCounts[kind], [
      'sourceSnapshotCount', 'sourceRecordCount', 'acceptedEdgeCount', 'insufficientEvidenceCount',
    ])) return null;
    const counts = rawKindCounts[kind] as Record<string, unknown>;
    if (Object.values(counts).some((count) => !safeCount(count))
      || Number(counts.sourceSnapshotCount) < 1
      || Number(counts.sourceRecordCount)
        !== Number(counts.acceptedEdgeCount) + Number(counts.insufficientEvidenceCount)) return null;
    sourceKindCounts[kind] = {
      sourceSnapshotCount: Number(counts.sourceSnapshotCount),
      sourceRecordCount: Number(counts.sourceRecordCount),
      acceptedEdgeCount: Number(counts.acceptedEdgeCount),
      insufficientEvidenceCount: Number(counts.insufficientEvidenceCount),
    };
  }
  const sumKind = (field: keyof ContextualRelationshipCompletionAccounting['sourceKindCounts']['aircraft']) => (
    CONTEXTUAL_SOURCE_KINDS.reduce((sum, kind) => sum + sourceKindCounts[kind][field], 0)
  );
  if (sumKind('sourceSnapshotCount') !== Number(value.sourceSnapshotCount)
    || sumKind('sourceRecordCount') !== Number(value.sourceRecordCount)
    || sumKind('acceptedEdgeCount') !== Number(value.acceptedEdgeCount)
    || sumKind('insufficientEvidenceCount') !== Number(value.insufficientEvidenceCount)) return null;
  return {
    sourceSnapshotCount: Number(value.sourceSnapshotCount),
    sourceKindCount: 4,
    sourceRecordCount: Number(value.sourceRecordCount),
    acceptedEdgeCount: Number(value.acceptedEdgeCount),
    insufficientEvidenceCount: Number(value.insufficientEvidenceCount),
    uniqueAddressCount: Number(value.uniqueAddressCount),
    addressStatusCounts: {
      accepted_only: Number(addressStatusCounts.accepted_only),
      insufficient_only: Number(addressStatusCounts.insufficient_only),
      mixed: Number(addressStatusCounts.mixed),
    },
    sourceKindCounts,
  };
};

const conditionalStorage = (storage: CaseGraphArchiveStorage): CaseGraphConditionalArchiveStorage => {
  const candidate = storage as Partial<CaseGraphConditionalArchiveStorage>;
  if (typeof candidate.readObjectVersioned !== 'function' || typeof candidate.uploadFileConditional !== 'function') {
    throw new Error('case_graph_publication_conditional_storage_required');
  }
  return storage as CaseGraphConditionalArchiveStorage;
};

const uploadImmutableAndVerify = async (
  storage: CaseGraphConditionalArchiveStorage,
  body: Buffer,
  key: string,
) => {
  const result = await storage.uploadFileConditional(body, key, {
    contentType: 'application/json',
    cacheControl: 'private, max-age=31536000, immutable',
    contentLength: body.length,
  }, { ifAbsent: true });
  if (result.status === 'precondition_failed') {
    const existing = await storage.readObject(key);
    if (!existing?.equals(body)) throw new Error(`case_graph_publication_immutable_object_conflict:${key}`);
  }
  const stored = await storage.readObject(key);
  if (!stored?.equals(body)) throw new Error(`case_graph_publication_read_after_write_failed:${key}`);
};

const parseJson = (body: Buffer, code: string) => {
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!isRecord(value)) throw new Error('not_object');
    return value;
  } catch (error) {
    throw new Error(`${code}:${error instanceof Error ? error.message : String(error)}`);
  }
};

const COMPLETION_KEYS = [
  'record_type', 'schema_version', 'public_manifest_version', 'graph_artifact_set_version',
  'corpus_version', 'snapshot_id', 'manifest_key', 'manifest_sha256', 'accounting_receipt_key',
  'accounting_receipt_sha256', 'relationship_input_manifest_digest', 'relationship_policy_version',
  'relationship_policy_sha256', 'relationship_model_id', 'relationship_model_version', 'relationship_model_sha256',
  'relationship_run_index_digest', 'relationship_run_artifact_set_sha256', 'relationship_completion_digest',
  'public_graph_manifest_digest', 'density_artifact_digest', 'calibration_set_receipt_key',
  'calibration_set_receipt_sha256', 'calibration_set_receipt_body_sha256', 'calibration_set_sha256',
  'pair_calibration_receipt_id', 'pair_calibration_receipt_key', 'pair_calibration_receipt_sha256',
  'pair_calibration_receipt_body_sha256', 'pair_calibration_lineage_sha256',
  'contextual_calibration_receipt_id', 'contextual_calibration_receipt_key',
  'contextual_calibration_receipt_sha256', 'contextual_calibration_receipt_body_sha256',
  'contextual_calibration_lineage_sha256', 'pair_calibration_artifact_key',
  'pair_calibration_artifact_body_sha256', 'pair_calibration_artifact_digest',
  'pair_calibration_trust_policy_key', 'pair_calibration_trust_policy_body_sha256',
  'pair_calibration_trust_policy_digest', 'contextual_calibration_artifact_key',
  'contextual_calibration_artifact_body_sha256', 'contextual_calibration_artifact_digest',
  'contextual_calibration_trust_policy_key', 'contextual_calibration_trust_policy_body_sha256',
  'contextual_calibration_trust_policy_digest', 'contextual_relationship_completion_key',
  'contextual_relationship_completion_body_sha256', 'contextual_relationship_completion_id',
  'contextual_relationship_completion_digest', 'contextual_relationship_source_completion_set_sha256',
  'contextual_relationship_entry_set_sha256', 'contextual_relationship_accounting',
  'graph_artifact_set_sha256', 'eligible_case_count',
  'indexed_case_count', 'candidate_pair_count', 'unique_edge_count', 'skipped_group_count',
  'skipped_estimated_pair_count', 'generated_at',
] as const;

export const encodeCaseGraphPublicationCandidateCompletion = (
  completion: CaseGraphPublicationCandidateCompletion,
) => Buffer.from(`${canonicalizeRelationshipInput(completion)}\n`, 'utf8');

const parseCompletion = (
  body: Buffer,
  corpusVersion: string,
  manifestKey: string,
  accountingReceiptKey: string,
  calibrationSetReceiptKey: string,
  pairCalibrationReceiptKey: string,
  contextualCalibrationReceiptKey: string,
  pairCalibrationArtifactKey: string,
  pairCalibrationTrustPolicyKey: string,
  contextualCalibrationArtifactKey: string,
  contextualCalibrationTrustPolicyKey: string,
  contextualRelationshipCompletionKey: string,
): CaseGraphPublicationCandidateCompletion => {
  const value = parseJson(body, 'case_graph_publication_completion_invalid_json');
  if (!exactKeys(value, COMPLETION_KEYS)
    || value.record_type !== 'case_graph_publication_candidate_completion'
    || value.schema_version !== CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION
    || value.public_manifest_version !== CASE_GRAPH_PUBLIC_MANIFEST_VERSION
    || value.graph_artifact_set_version !== CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION
    || value.corpus_version !== corpusVersion
    || value.manifest_key !== manifestKey
    || value.accounting_receipt_key !== accountingReceiptKey
    || value.calibration_set_receipt_key !== calibrationSetReceiptKey
    || value.pair_calibration_receipt_key !== pairCalibrationReceiptKey
    || value.contextual_calibration_receipt_key !== contextualCalibrationReceiptKey
    || value.pair_calibration_artifact_key !== pairCalibrationArtifactKey
    || value.pair_calibration_trust_policy_key !== pairCalibrationTrustPolicyKey
    || value.contextual_calibration_artifact_key !== contextualCalibrationArtifactKey
    || value.contextual_calibration_trust_policy_key !== contextualCalibrationTrustPolicyKey
    || value.contextual_relationship_completion_key !== contextualRelationshipCompletionKey
    || typeof value.snapshot_id !== 'string' || !UUID.test(value.snapshot_id)
    || typeof value.manifest_sha256 !== 'string' || !SHA256.test(value.manifest_sha256)
    || typeof value.accounting_receipt_sha256 !== 'string' || !SHA256.test(value.accounting_receipt_sha256)
    || typeof value.relationship_input_manifest_digest !== 'string' || !SHA256.test(value.relationship_input_manifest_digest)
    || value.relationship_policy_version !== TYPED_RELATIONSHIP_POLICY_VERSION
    || value.relationship_policy_sha256 !== TYPED_RELATIONSHIP_POLICY_SHA256
    || value.relationship_model_id !== TYPED_RELATIONSHIP_MODEL_ID
    || value.relationship_model_version !== TYPED_RELATIONSHIP_MODEL_VERSION
    || value.relationship_model_sha256 !== TYPED_RELATIONSHIP_MODEL_SHA256
    || typeof value.relationship_run_index_digest !== 'string' || !SHA256.test(value.relationship_run_index_digest)
    || typeof value.relationship_run_artifact_set_sha256 !== 'string'
    || !SHA256.test(value.relationship_run_artifact_set_sha256)
    || typeof value.relationship_completion_digest !== 'string' || !SHA256.test(value.relationship_completion_digest)
    || typeof value.public_graph_manifest_digest !== 'string' || !SHA256.test(value.public_graph_manifest_digest)
    || typeof value.density_artifact_digest !== 'string' || !SHA256.test(value.density_artifact_digest)
    || typeof value.calibration_set_receipt_sha256 !== 'string' || !SHA256.test(value.calibration_set_receipt_sha256)
    || typeof value.calibration_set_receipt_body_sha256 !== 'string'
    || !SHA256.test(value.calibration_set_receipt_body_sha256)
    || typeof value.calibration_set_sha256 !== 'string' || !SHA256.test(value.calibration_set_sha256)
    || typeof value.pair_calibration_receipt_id !== 'string' || !VERSION.test(value.pair_calibration_receipt_id)
    || typeof value.pair_calibration_receipt_sha256 !== 'string' || !SHA256.test(value.pair_calibration_receipt_sha256)
    || typeof value.pair_calibration_receipt_body_sha256 !== 'string'
    || !SHA256.test(value.pair_calibration_receipt_body_sha256)
    || typeof value.pair_calibration_lineage_sha256 !== 'string'
    || !SHA256.test(value.pair_calibration_lineage_sha256)
    || typeof value.contextual_calibration_receipt_id !== 'string' || !VERSION.test(value.contextual_calibration_receipt_id)
    || typeof value.contextual_calibration_receipt_sha256 !== 'string'
    || !SHA256.test(value.contextual_calibration_receipt_sha256)
    || typeof value.contextual_calibration_receipt_body_sha256 !== 'string'
    || !SHA256.test(value.contextual_calibration_receipt_body_sha256)
    || typeof value.contextual_calibration_lineage_sha256 !== 'string'
    || !SHA256.test(value.contextual_calibration_lineage_sha256)
    || typeof value.pair_calibration_artifact_body_sha256 !== 'string'
    || !SHA256.test(value.pair_calibration_artifact_body_sha256)
    || typeof value.pair_calibration_artifact_digest !== 'string'
    || !SHA256.test(value.pair_calibration_artifact_digest)
    || typeof value.pair_calibration_trust_policy_body_sha256 !== 'string'
    || !SHA256.test(value.pair_calibration_trust_policy_body_sha256)
    || typeof value.pair_calibration_trust_policy_digest !== 'string'
    || !SHA256.test(value.pair_calibration_trust_policy_digest)
    || typeof value.contextual_calibration_artifact_body_sha256 !== 'string'
    || !SHA256.test(value.contextual_calibration_artifact_body_sha256)
    || typeof value.contextual_calibration_artifact_digest !== 'string'
    || !SHA256.test(value.contextual_calibration_artifact_digest)
    || typeof value.contextual_calibration_trust_policy_body_sha256 !== 'string'
    || !SHA256.test(value.contextual_calibration_trust_policy_body_sha256)
    || typeof value.contextual_calibration_trust_policy_digest !== 'string'
    || !SHA256.test(value.contextual_calibration_trust_policy_digest)
    || typeof value.contextual_relationship_completion_body_sha256 !== 'string'
    || !SHA256.test(value.contextual_relationship_completion_body_sha256)
    || typeof value.contextual_relationship_completion_id !== 'string'
    || !VERSION.test(value.contextual_relationship_completion_id)
    || typeof value.contextual_relationship_completion_digest !== 'string'
    || !SHA256.test(value.contextual_relationship_completion_digest)
    || typeof value.contextual_relationship_source_completion_set_sha256 !== 'string'
    || !SHA256.test(value.contextual_relationship_source_completion_set_sha256)
    || typeof value.contextual_relationship_entry_set_sha256 !== 'string'
    || !SHA256.test(value.contextual_relationship_entry_set_sha256)
    || !parseContextualCompletionAccounting(value.contextual_relationship_accounting)
    || typeof value.graph_artifact_set_sha256 !== 'string' || !SHA256.test(value.graph_artifact_set_sha256)
    || !safeCount(value.eligible_case_count) || !safeCount(value.indexed_case_count)
    || !safeCount(value.candidate_pair_count) || !safeCount(value.unique_edge_count)
    || !safeCount(value.skipped_group_count) || !safeCount(value.skipped_estimated_pair_count)
    || typeof value.generated_at !== 'string' || new Date(value.generated_at).toISOString() !== value.generated_at) {
    throw new Error('case_graph_publication_completion_invalid');
  }
  const completion = value as unknown as CaseGraphPublicationCandidateCompletion;
  if (!body.equals(encodeCaseGraphPublicationCandidateCompletion(completion))) {
    throw new Error('case_graph_publication_completion_noncanonical');
  }
  return completion;
};

const sameCounts = (
  left: Record<'sighting' | 'document' | 'photo' | 'video', number>,
  right: Record<'sighting' | 'document' | 'photo' | 'video', number>,
) => (['sighting', 'document', 'photo', 'video'] as const).every((kind) => left[kind] === right[kind]);

const assertAccountingReceiptBinding = (
  receipt: CaseVortexCorpusAccountingReceipt,
  manifest: CaseGraphPublicManifest,
  manifestSha256: string,
) => {
  const binding = receipt.binding;
  const accountingBinding = manifest.accountingBinding;
  const relationship = manifest.lineage.relationshipInput;
  const universe = manifest.lineage.universe;
  if (binding.graphPublicationSha256 !== manifestSha256
    || binding.corpusVersion !== manifest.corpusVersion
    || binding.snapshotId !== manifest.lineage.snapshot.snapshotId
    || binding.universeArchiveVersion !== universe.archiveVersion
    || binding.universeSchemaVersion !== universe.schemaVersion
    || binding.universeLayoutVersion !== universe.layoutVersion
    || binding.universeArchiveSetSha256 !== universe.archiveSetSha256
    || binding.universeRecordCount !== universe.recordCount
    || binding.relationshipInputSchemaVersion !== relationship.schemaVersion
    || binding.relationshipInputArchiveSetSha256 !== relationship.archiveSetSha256
    || binding.relationshipInputManifestDigest !== relationship.manifestDigest
    || binding.relationshipInputRecordCount !== relationship.recordCount
    || binding.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION
    || receipt.representedTotal !== universe.recordCount
    || receipt.relationshipProcessedTotal !== universe.recordCount
    || !sameCounts(receipt.capturedByKind, accountingBinding.graphAddressLedger.byKind)) {
    throw new Error('case_graph_publication_accounting_receipt_binding_mismatch');
  }
  if (canonicalizeRelationshipInput(binding.relationshipInputBinding)
    !== canonicalizeRelationshipInput(relationship.binding)) {
    throw new Error('case_graph_publication_accounting_receipt_binding_mismatch');
  }
};

export const readVerifiedCaseGraphPublicationCandidate = async (
  storage: PublicationReadStorage,
  corpusVersion: string,
) => {
  const keys = getCaseGraphPublicationKeys(corpusVersion);
  const completionBody = await storage.readObject(keys.completionManifestKey);
  if (!completionBody) throw new Error('case_graph_publication_completion_missing');
  const completion = parseCompletion(
    completionBody,
    corpusVersion,
    keys.manifestKey,
    keys.accountingReceiptKey,
    keys.calibrationSetReceiptKey,
    keys.pairCalibrationReceiptKey,
    keys.contextualCalibrationReceiptKey,
    keys.pairCalibrationArtifactKey,
    keys.pairCalibrationTrustPolicyKey,
    keys.contextualCalibrationArtifactKey,
    keys.contextualCalibrationTrustPolicyKey,
    keys.contextualRelationshipCompletionKey,
  );
  const [
    manifestBody,
    accountingReceiptBody,
    calibrationSetReceiptBody,
    humanReviewBundleBody,
    pairCalibrationReceiptBody,
    contextualCalibrationReceiptBody,
    pairCalibrationArtifactBody,
    pairCalibrationTrustPolicyBody,
    contextualCalibrationArtifactBody,
    contextualCalibrationTrustPolicyBody,
    contextualRelationshipCompletionBody,
  ] = await Promise.all([
    storage.readObject(keys.manifestKey),
    storage.readObject(keys.accountingReceiptKey),
    storage.readObject(keys.calibrationSetReceiptKey),
    storage.readObject(keys.humanReviewBundleKey),
    storage.readObject(keys.pairCalibrationReceiptKey),
    storage.readObject(keys.contextualCalibrationReceiptKey),
    storage.readObject(keys.pairCalibrationArtifactKey),
    storage.readObject(keys.pairCalibrationTrustPolicyKey),
    storage.readObject(keys.contextualCalibrationArtifactKey),
    storage.readObject(keys.contextualCalibrationTrustPolicyKey),
    storage.readObject(keys.contextualRelationshipCompletionKey),
  ]);
  if (!manifestBody || sha256(manifestBody) !== completion.manifest_sha256) {
    throw new Error('case_graph_publication_manifest_checksum_mismatch');
  }
  if (!accountingReceiptBody
    || caseVortexCorpusAccountingReceiptSha256(accountingReceiptBody) !== completion.accounting_receipt_sha256) {
    throw new Error('case_graph_publication_accounting_receipt_checksum_mismatch');
  }
  if (!calibrationSetReceiptBody
    || sha256(calibrationSetReceiptBody) !== completion.calibration_set_receipt_body_sha256) {
    throw new Error('case_graph_publication_calibration_set_receipt_checksum_mismatch');
  }
  if (!pairCalibrationReceiptBody
    || sha256(pairCalibrationReceiptBody) !== completion.pair_calibration_receipt_body_sha256) {
    throw new Error('case_graph_publication_pair_calibration_receipt_checksum_mismatch');
  }
  if (!contextualCalibrationReceiptBody
    || sha256(contextualCalibrationReceiptBody) !== completion.contextual_calibration_receipt_body_sha256) {
    throw new Error('case_graph_publication_contextual_calibration_receipt_checksum_mismatch');
  }
  if (!pairCalibrationArtifactBody
    || sha256(pairCalibrationArtifactBody) !== completion.pair_calibration_artifact_body_sha256
    || !pairCalibrationTrustPolicyBody
    || sha256(pairCalibrationTrustPolicyBody) !== completion.pair_calibration_trust_policy_body_sha256) {
    throw new Error('case_graph_publication_pair_calibration_evidence_checksum_mismatch');
  }
  if (!contextualCalibrationArtifactBody
    || sha256(contextualCalibrationArtifactBody)
      !== completion.contextual_calibration_artifact_body_sha256
    || !contextualCalibrationTrustPolicyBody
    || sha256(contextualCalibrationTrustPolicyBody)
      !== completion.contextual_calibration_trust_policy_body_sha256) {
    throw new Error('case_graph_publication_contextual_calibration_evidence_checksum_mismatch');
  }
  if (!contextualRelationshipCompletionBody
    || sha256(contextualRelationshipCompletionBody)
      !== completion.contextual_relationship_completion_body_sha256) {
    throw new Error('case_graph_publication_contextual_relationship_completion_checksum_mismatch');
  }
  const manifest = decodeCaseGraphPublicManifest(manifestBody, corpusVersion);
  if (!humanReviewBundleBody
    || manifest.lineage.calibrationEvidence.humanReview.bundleKey !== keys.humanReviewBundleKey
    || sha256(humanReviewBundleBody)
      !== manifest.lineage.calibrationEvidence.humanReview.bundleBodySha256) {
    throw new Error('case_graph_publication_human_review_bundle_checksum_mismatch');
  }
  const humanReview = getAuthoritativeCalibrationHumanReviewEvidence({
    bundleBody: humanReviewBundleBody,
    pairReceiptBody: pairCalibrationReceiptBody,
    pairArtifactBody: pairCalibrationArtifactBody,
    pairTrustPolicyBody: pairCalibrationTrustPolicyBody,
    contextualReceiptBody: contextualCalibrationReceiptBody,
    contextualArtifactBody: contextualCalibrationArtifactBody,
    contextualTrustPolicyBody: contextualCalibrationTrustPolicyBody,
  });
  if (humanReview.bundleDigest
      !== manifest.lineage.calibrationEvidence.humanReview.bundleDigest
    || humanReview.evidenceSetSha256
      !== manifest.lineage.calibrationEvidence.humanReview.evidenceSetSha256
    || humanReview.packDigest
      !== manifest.lineage.calibrationEvidence.humanReview.packDigest
    || humanReview.adjudicationDigest
      !== manifest.lineage.calibrationEvidence.humanReview.adjudicationDigest) {
    throw new Error('case_graph_publication_human_review_bundle_identity_mismatch');
  }
  const productionCompatibility = await readVerifiedFullCorpusProductionCompatibilityReceipt({
    storage,
    pointer: manifest.lineage.productionCompatibility,
    expected: {
      corpusVersion,
      snapshotId: manifest.lineage.snapshot.snapshotId,
    },
  });
  const accountingReceipt = decodeCaseVortexCorpusAccountingReceipt(accountingReceiptBody);
  const calibrationSetReceipt = decodeCaseGraphPublicationCalibrationSetReceipt(
    calibrationSetReceiptBody,
    {
      receiptSha256: completion.calibration_set_receipt_sha256,
      calibrationSetSha256: completion.calibration_set_sha256,
    },
  );
  const canonicalCalibrationSetReceiptBody = Buffer.from(
    serializeCaseGraphPublicationCalibrationSetReceipt(calibrationSetReceipt),
    'utf8',
  );
  if (!calibrationSetReceiptBody.equals(canonicalCalibrationSetReceiptBody)) {
    throw new Error('case_graph_publication_calibration_set_receipt_noncanonical');
  }
  verifyCaseGraphPublicationCalibrationSetReceiptBodies({
    receipt: calibrationSetReceipt,
    pairReceiptBody: pairCalibrationReceiptBody,
    contextualReceiptBody: contextualCalibrationReceiptBody,
  });
  const pairTrustPolicy = decodeTypedRelationshipCalibrationTrustPolicy(parseJson(
    pairCalibrationTrustPolicyBody,
    'case_graph_publication_pair_calibration_trust_policy_invalid_json',
  ));
  const contextualTrustPolicy = decodeContextualRelationshipCalibrationTrustPolicy(
    parseJson(
      contextualCalibrationTrustPolicyBody,
      'case_graph_publication_contextual_calibration_trust_policy_invalid_json',
    ),
  );
  const pairCalibrationArtifact = decodeTypedRelationshipCalibrationArtifact(
    pairCalibrationArtifactBody,
    manifest.lineage.relationshipInput.binding,
    pairTrustPolicy,
  );
  const contextualCalibrationArtifact = decodeContextualRelationshipCalibrationArtifact(
    contextualCalibrationArtifactBody,
    manifest.lineage.relationshipInput.binding,
    contextualTrustPolicy,
  );
  assertTypedRelationshipCalibrationReceiptProductionEligible(pairCalibrationArtifact.receipt);
  assertContextualRelationshipCalibrationReceiptProductionEligible(contextualCalibrationArtifact.receipt);
  const canonicalPairTrustPolicyBody = Buffer.from(
    `${canonicalizeRelationshipInput(pairTrustPolicy)}\n`,
    'utf8',
  );
  const canonicalContextualTrustPolicyBody = Buffer.from(
    `${canonicalizeContextualExplanation(contextualTrustPolicy)}\n`,
    'utf8',
  );
  const canonicalPairCalibrationArtifactBody = Buffer.from(
    serializeTypedRelationshipCalibrationArtifact(pairCalibrationArtifact, pairTrustPolicy),
    'utf8',
  );
  const canonicalContextualCalibrationArtifactBody = Buffer.from(
    serializeContextualRelationshipCalibrationArtifact(
      contextualCalibrationArtifact,
      contextualTrustPolicy,
    ),
    'utf8',
  );
  if (!pairCalibrationTrustPolicyBody.equals(canonicalPairTrustPolicyBody)
    || !contextualCalibrationTrustPolicyBody.equals(canonicalContextualTrustPolicyBody)
    || !pairCalibrationArtifactBody.equals(canonicalPairCalibrationArtifactBody)
    || !contextualCalibrationArtifactBody.equals(canonicalContextualCalibrationArtifactBody)
    || !pairCalibrationReceiptBody.equals(Buffer.from(
      serializeTypedRelationshipCalibrationReceipt(pairCalibrationArtifact.receipt),
      'utf8',
    ))
    || !contextualCalibrationReceiptBody.equals(Buffer.from(
      serializeContextualRelationshipCalibrationReceipt(contextualCalibrationArtifact.receipt),
      'utf8',
    ))) {
    throw new Error('case_graph_publication_calibration_evidence_noncanonical');
  }
  const expectedContextualCalibration = {
    receiptId: calibrationSetReceipt.contextualCalibration.receiptId,
    receiptSha256: calibrationSetReceipt.contextualCalibration.receiptSha256,
  };
  const contextualRelationshipCompletion = assertContextualRelationshipCompletionProductionEligible(
    contextualRelationshipCompletionBody,
    manifest.lineage.relationshipInput.binding,
    expectedContextualCalibration,
  );
  const canonicalContextualRelationshipCompletionBody = Buffer.from(
    serializeContextualRelationshipCompletionArtifact(
      contextualRelationshipCompletion,
      expectedContextualCalibration,
    ),
    'utf8',
  );
  if (!contextualRelationshipCompletionBody.equals(canonicalContextualRelationshipCompletionBody)) {
    throw new Error('case_graph_publication_contextual_relationship_completion_noncanonical');
  }
  assertAccountingReceiptBinding(accountingReceipt, manifest, completion.manifest_sha256);
  if (manifest.lineage.snapshot.snapshotId !== completion.snapshot_id
    || manifest.lineage.relationshipInput.manifestDigest !== completion.relationship_input_manifest_digest
    || manifest.lineage.relationship.policyVersion !== completion.relationship_policy_version
    || manifest.lineage.relationship.policySha256 !== completion.relationship_policy_sha256
    || manifest.lineage.relationship.modelId !== completion.relationship_model_id
    || manifest.lineage.relationship.modelVersion !== completion.relationship_model_version
    || manifest.lineage.relationship.modelSha256 !== completion.relationship_model_sha256
    || manifest.lineage.relationshipRun.indexDigest !== completion.relationship_run_index_digest
    || manifest.lineage.relationshipRun.artifactSetSha256 !== completion.relationship_run_artifact_set_sha256
    || manifest.lineage.relationshipRun.completionDigest !== completion.relationship_completion_digest
    || manifest.lineage.publicGraph.manifestDigest !== completion.public_graph_manifest_digest
    || manifest.density.artifactDigest !== completion.density_artifact_digest
    || manifest.lineage.calibration.set.receiptKey !== completion.calibration_set_receipt_key
    || manifest.lineage.calibration.set.receiptSha256 !== completion.calibration_set_receipt_sha256
    || manifest.lineage.calibration.set.receiptBodySha256 !== completion.calibration_set_receipt_body_sha256
    || manifest.lineage.calibration.set.calibrationSetSha256 !== completion.calibration_set_sha256
    || manifest.lineage.calibration.set.receiptSha256 !== calibrationSetReceipt.receiptSha256
    || manifest.lineage.calibration.set.calibrationSetSha256 !== calibrationSetReceipt.calibrationSetSha256
    || manifest.lineage.calibration.pair.receiptId !== completion.pair_calibration_receipt_id
    || manifest.lineage.calibration.pair.receiptKey !== completion.pair_calibration_receipt_key
    || manifest.lineage.calibration.pair.receiptSha256 !== completion.pair_calibration_receipt_sha256
    || manifest.lineage.calibration.pair.receiptBodySha256 !== completion.pair_calibration_receipt_body_sha256
    || manifest.lineage.calibration.pair.lineageSha256 !== completion.pair_calibration_lineage_sha256
    || manifest.lineage.calibration.pair.receiptId !== calibrationSetReceipt.pairCalibration.receiptId
    || manifest.lineage.calibration.pair.receiptSha256 !== calibrationSetReceipt.pairCalibration.receiptSha256
    || manifest.lineage.calibration.pair.receiptBodySha256
      !== calibrationSetReceipt.pairCalibration.receiptBodySha256
    || manifest.lineage.calibration.pair.lineageSha256 !== calibrationSetReceipt.pairCalibration.lineageSha256
    || manifest.lineage.calibration.contextual.receiptId !== completion.contextual_calibration_receipt_id
    || manifest.lineage.calibration.contextual.receiptKey !== completion.contextual_calibration_receipt_key
    || manifest.lineage.calibration.contextual.receiptSha256 !== completion.contextual_calibration_receipt_sha256
    || manifest.lineage.calibration.contextual.receiptBodySha256
      !== completion.contextual_calibration_receipt_body_sha256
    || manifest.lineage.calibration.contextual.lineageSha256 !== completion.contextual_calibration_lineage_sha256
    || manifest.lineage.calibration.contextual.receiptId
      !== calibrationSetReceipt.contextualCalibration.receiptId
    || manifest.lineage.calibration.contextual.receiptSha256
      !== calibrationSetReceipt.contextualCalibration.receiptSha256
    || manifest.lineage.calibration.contextual.receiptBodySha256
      !== calibrationSetReceipt.contextualCalibration.receiptBodySha256
    || manifest.lineage.calibration.contextual.lineageSha256
      !== calibrationSetReceipt.contextualCalibration.lineageSha256
    || manifest.lineage.calibrationEvidence.pair.artifactKey
      !== completion.pair_calibration_artifact_key
    || manifest.lineage.calibrationEvidence.pair.artifactBodySha256
      !== completion.pair_calibration_artifact_body_sha256
    || manifest.lineage.calibrationEvidence.pair.artifactDigest
      !== completion.pair_calibration_artifact_digest
    || manifest.lineage.calibrationEvidence.pair.trustPolicyKey
      !== completion.pair_calibration_trust_policy_key
    || manifest.lineage.calibrationEvidence.pair.trustPolicyBodySha256
      !== completion.pair_calibration_trust_policy_body_sha256
    || manifest.lineage.calibrationEvidence.pair.trustPolicyDigest
      !== completion.pair_calibration_trust_policy_digest
    || manifest.lineage.calibrationEvidence.contextual.artifactKey
      !== completion.contextual_calibration_artifact_key
    || manifest.lineage.calibrationEvidence.contextual.artifactBodySha256
      !== completion.contextual_calibration_artifact_body_sha256
    || manifest.lineage.calibrationEvidence.contextual.artifactDigest
      !== completion.contextual_calibration_artifact_digest
    || manifest.lineage.calibrationEvidence.contextual.trustPolicyKey
      !== completion.contextual_calibration_trust_policy_key
    || manifest.lineage.calibrationEvidence.contextual.trustPolicyBodySha256
      !== completion.contextual_calibration_trust_policy_body_sha256
    || manifest.lineage.calibrationEvidence.contextual.trustPolicyDigest
      !== completion.contextual_calibration_trust_policy_digest
    || manifest.lineage.calibrationEvidence.pair.artifactDigest !== pairCalibrationArtifact.artifactDigest
    || manifest.lineage.calibrationEvidence.pair.trustPolicyDigest !== pairTrustPolicy.trustPolicyDigest
    || manifest.lineage.calibrationEvidence.contextual.artifactDigest
      !== contextualCalibrationArtifact.artifactDigest
    || manifest.lineage.calibrationEvidence.contextual.trustPolicyDigest
      !== contextualTrustPolicy.trustPolicyDigest
    || manifest.lineage.contextualCompletion.key
      !== completion.contextual_relationship_completion_key
    || manifest.lineage.contextualCompletion.bodySha256
      !== completion.contextual_relationship_completion_body_sha256
    || manifest.lineage.contextualCompletion.completionId
      !== completion.contextual_relationship_completion_id
    || manifest.lineage.contextualCompletion.completionDigest
      !== completion.contextual_relationship_completion_digest
    || manifest.lineage.contextualCompletion.sourceCompletionSetSha256
      !== completion.contextual_relationship_source_completion_set_sha256
    || manifest.lineage.contextualCompletion.entrySetSha256
      !== completion.contextual_relationship_entry_set_sha256
    || canonicalizeRelationshipInput(manifest.lineage.contextualCompletion.accounting)
      !== canonicalizeRelationshipInput(completion.contextual_relationship_accounting)
    || manifest.lineage.contextualCompletion.completionId
      !== contextualRelationshipCompletion.completionId
    || manifest.lineage.contextualCompletion.completionDigest
      !== contextualRelationshipCompletion.completionDigest
    || manifest.lineage.contextualCompletion.sourceCompletionSetSha256
      !== contextualRelationshipCompletion.sourceCompletionSetSha256
    || manifest.lineage.contextualCompletion.entrySetSha256
      !== contextualRelationshipCompletion.entrySetSha256
    || canonicalizeRelationshipInput(manifest.lineage.contextualCompletion.accounting)
      !== canonicalizeRelationshipInput(contextualRelationshipCompletion.accounting)
    || manifest.lineage.graph.artifactSetSha256 !== completion.graph_artifact_set_sha256
    || manifest.accounting.universeRecordCount !== completion.eligible_case_count
    || manifest.accounting.indexedRecordCount !== completion.indexed_case_count
    || manifest.accounting.candidatePairCount !== completion.candidate_pair_count
    || manifest.accounting.typedEdgeCount !== completion.unique_edge_count
    || manifest.accounting.skippedGroupReceiptCount !== completion.skipped_group_count
    || manifest.accounting.skippedEstimatedPairCount !== completion.skipped_estimated_pair_count
    || manifest.generatedAt !== completion.generated_at) {
    throw new Error('case_graph_publication_completion_binding_mismatch');
  }
  return {
    completion,
    manifest,
    manifestBody,
    accountingReceipt,
    accountingReceiptBody,
    calibrationSetReceipt,
    calibrationSetReceiptBody,
    pairCalibrationReceiptBody,
    contextualCalibrationReceiptBody,
    pairCalibrationArtifact,
    pairCalibrationArtifactBody,
    pairCalibrationTrustPolicy: pairTrustPolicy,
    pairCalibrationTrustPolicyBody,
    contextualCalibrationArtifact,
    contextualCalibrationArtifactBody,
    contextualCalibrationTrustPolicy: contextualTrustPolicy,
    contextualCalibrationTrustPolicyBody,
    productionCompatibility,
    contextualRelationshipCompletion,
    contextualRelationshipCompletionBody,
  };
};

const relationshipBindingFromUniverse = (
  universe: ReturnType<typeof decodeEvidenceUniverseCompletion>,
): RelationshipInputUniverseBinding => ({
  snapshotId: universe.expected.snapshotId,
  corpusVersion: universe.corpusVersion,
  universeArchiveVersion: universe.archiveVersion,
  universeSchemaVersion: universe.schemaVersion,
  universeLayoutVersion: universe.layoutVersion,
  universeArchiveSetSha256: universe.archiveSetSha256,
  universeRecordCount: universe.expected.total,
});

const verifyPublicGraphShardCoverage = async (
  storage: CaseGraphConditionalArchiveStorage,
  manifest: FullCorpusPublicGraphManifest,
) => {
  const seen = new Set<string>();
  const publicEdges: FullCorpusPublicEdge[] = [];
  for (const summary of manifest.shards) {
    const identity = `${summary.shardKind}:${summary.shard}`;
    if (seen.has(identity)) throw new Error('case_graph_publication_public_graph_shard_duplicate');
    seen.add(identity);
    const archive = await readVerifiedFullCorpusPublicGraphArchiveObject<FullCorpusPublicGraphShard>({
      storage,
      receiptKey: summary.receiptKey,
      maxUncompressedBytes: summary.uncompressedBytes,
    });
    if (archive.value.shardKind !== summary.shardKind
      || archive.value.shard !== summary.shard
      || archive.value.shardCount !== summary.shardCount
      || archive.value.itemCount !== summary.itemCount
      || archive.value.itemSetSha256 !== summary.itemSetSha256
      || archive.value.shardDigest !== summary.shardDigest
      || archive.receipt.artifactDigest !== summary.artifactDigest
      || archive.receipt.archiveKey !== summary.archiveKey
      || archive.receipt.receiptKey !== summary.receiptKey
      || archive.receipt.uncompressedBytes !== summary.uncompressedBytes
      || archive.receipt.compressedBytes !== summary.compressedBytes
      || archive.receipt.compressedSha256 !== summary.compressedSha256) {
      throw new Error('case_graph_publication_public_graph_shard_mismatch');
    }
    if (summary.shardKind === 'render') {
      const packing = buildFullCorpusPublicRenderPackingReceipt(
        archive.value.items as FullCorpusPublicRenderRow[],
      );
      if (packing.rowCount !== summary.itemCount
        || packing.addressLookupSha256 !== summary.renderAddressLookupSha256
        || packing.lodIndexSha256 !== summary.renderLodIndexSha256
        || packing.addressUtf8Bytes !== summary.renderAddressUtf8Bytes
        || packing.packedBytes !== summary.renderPackedBytes
        || packing.lodIndexBytes !== summary.renderLodIndexBytes) {
        throw new Error('case_graph_publication_public_graph_render_packing_mismatch');
      }
    }
    if (summary.shardKind === 'edge') {
      publicEdges.push(...(archive.value.items as FullCorpusPublicEdge[]));
    }
  }
  publicEdges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const contextualEdgeIds = publicEdges
    .filter((edge) => edge.edgeType === 'contextual_explanation_candidate')
    .map((edge) => edge.edgeId);
  const pairEdgeIds = publicEdges
    .filter((edge) => edge.edgeType !== 'contextual_explanation_candidate')
    .map((edge) => edge.edgeId);
  if (new Set(publicEdges.map((edge) => edge.edgeId)).size !== publicEdges.length
    || publicEdges.length !== manifest.typedEdgeCount
    || sha256(publicEdges.map((edge) => edge.edgeId).join('\n')) !== manifest.typedEdgeIdSetSha256
    || pairEdgeIds.length !== manifest.pairReducerTypedEdgeCount
    || sha256(pairEdgeIds.join('\n')) !== manifest.pairReducerTypedEdgeIdSetSha256
    || contextualEdgeIds.length !== manifest.contextualRelationshipCompletion.accounting.acceptedEdgeCount
    || sha256(contextualEdgeIds.join('\n'))
      !== manifest.contextualRelationshipCompletion.acceptedEdgeIdSetSha256) {
    throw new Error('case_graph_publication_public_graph_edge_lineage_mismatch');
  }
};

export const buildCaseGraphPublicationCandidate = async (params: {
  corpusVersion: string;
  storage: CaseGraphArchiveStorage;
  lineage?: CaseGraphPublicationLineageReceipts;
}) => {
  const keys = getCaseGraphPublicationKeys(params.corpusVersion);
  const existing = await params.storage.readObject(keys.completionManifestKey);
  if (existing) {
    const verified = await readVerifiedCaseGraphPublicationCandidate(params.storage, params.corpusVersion);
    return { status: 'already_complete' as const, ...verified };
  }
  if (!params.lineage
    || !Buffer.isBuffer(params.lineage.accountingReceiptBody)
    || !params.lineage.accountingReceiptBody.length
    || !Buffer.isBuffer(params.lineage.calibration?.pairReceiptBody)
    || !params.lineage.calibration.pairReceiptBody.length
    || !Buffer.isBuffer(params.lineage.calibration?.contextualReceiptBody)
    || !params.lineage.calibration.contextualReceiptBody.length
    || !Buffer.isBuffer(params.lineage.calibration?.pairArtifactBody)
    || !params.lineage.calibration.pairArtifactBody.length
    || !Buffer.isBuffer(params.lineage.calibration?.pairTrustPolicyBody)
    || !params.lineage.calibration.pairTrustPolicyBody.length
    || !Buffer.isBuffer(params.lineage.calibration?.contextualArtifactBody)
    || !params.lineage.calibration.contextualArtifactBody.length
    || !Buffer.isBuffer(params.lineage.calibration?.contextualTrustPolicyBody)
    || !params.lineage.calibration.contextualTrustPolicyBody.length
    || !params.lineage.calibration?.pinned?.pair
    || !params.lineage.calibration?.pinned?.contextual
    || !Buffer.isBuffer(params.lineage.contextualRelationshipCompletionBody)
    || !params.lineage.contextualRelationshipCompletionBody.length
    || !params.lineage.productionCompatibility
    || typeof params.lineage.publicGraphManifestReceiptKey !== 'string'
    || !params.lineage.publicGraphManifestReceiptKey.length) {
    throw new Error('case_graph_publication_lineage_receipts_required');
  }
  const accountingBinding = decodeCaseVortexAccountingPublicationBinding(params.lineage.accountingBinding);
  const accountingReceipt = decodeCaseVortexCorpusAccountingReceipt(params.lineage.accountingReceiptBody);
  const densityPointer = decodeFullCorpusPublicDensityPointer(params.lineage.density, {
    corpusVersion: params.corpusVersion,
  });
  const storage = conditionalStorage(params.storage);

  const universeBody = await storage.readObject(
    getEvidenceUniverseControlKeys(params.corpusVersion).completionManifestKey,
  );
  if (!universeBody) throw new Error('case_graph_publication_universe_completion_missing');
  const universe = decodeEvidenceUniverseCompletion(universeBody, params.corpusVersion);
  const relationshipBinding = relationshipBindingFromUniverse(universe);
  const relationshipInputBody = await storage.readObject(
    getRelationshipInputControlKeys(relationshipBinding).completionManifestKey,
  );
  if (!relationshipInputBody) throw new Error('case_graph_publication_relationship_input_completion_missing');
  const relationshipInput = decodeRelationshipInputSnapshotManifest(relationshipInputBody, relationshipBinding);
  const productionCompatibility = await readVerifiedFullCorpusProductionCompatibilityReceipt({
    storage,
    pointer: params.lineage.productionCompatibility,
    expected: {
      corpusVersion: params.corpusVersion,
      snapshotId: relationshipBinding.snapshotId,
    },
  });
  if (canonicalizeRelationshipInput(productionCompatibility.receipt.universe)
    !== canonicalizeRelationshipInput(relationshipBinding)) {
    throw new Error('case_graph_publication_production_compatibility_universe_mismatch');
  }
  const calibrationSetReceipt = buildCaseGraphPublicationCalibrationSetReceipt({
    pairReceiptBody: params.lineage.calibration.pairReceiptBody,
    contextualReceiptBody: params.lineage.calibration.contextualReceiptBody,
    pairLineage: params.lineage.calibration.pairLineage,
    contextualLineage: params.lineage.calibration.contextualLineage,
  });
  const calibrationSetReceiptBody = Buffer.from(
    serializeCaseGraphPublicationCalibrationSetReceipt(calibrationSetReceipt),
    'utf8',
  );
  const expectedContextualCalibration = {
    receiptId: calibrationSetReceipt.contextualCalibration.receiptId,
    receiptSha256: calibrationSetReceipt.contextualCalibration.receiptSha256,
  };
  const contextualRelationshipCompletion = assertContextualRelationshipCompletionProductionEligible(
    params.lineage.contextualRelationshipCompletionBody,
    relationshipBinding,
    expectedContextualCalibration,
  );
  const canonicalContextualRelationshipCompletionBody = Buffer.from(
    serializeContextualRelationshipCompletionArtifact(
      contextualRelationshipCompletion,
      expectedContextualCalibration,
    ),
    'utf8',
  );
  if (!params.lineage.contextualRelationshipCompletionBody.equals(
    canonicalContextualRelationshipCompletionBody,
  )) {
    throw new Error('case_graph_publication_contextual_relationship_completion_noncanonical');
  }

  const [features, run, publicGraphArchive, densityBody] = await Promise.all([
    readVerifiedCaseGraphFeatureArchive(storage, params.corpusVersion),
    readVerifiedFullCorpusRelationshipRunIndex({ storage, pointer: params.lineage.relationshipRun }),
    readVerifiedFullCorpusPublicGraphArchiveObject<FullCorpusPublicGraphManifest>({
      storage,
      receiptKey: params.lineage.publicGraphManifestReceiptKey,
    }),
    storage.readObject(densityPointer.archiveKey),
  ]);
  if (!densityBody) throw new Error('case_graph_publication_density_missing');
  const densityArtifact = decodeFullCorpusPublicDensityArchiveObject({ pointer: densityPointer, body: densityBody });
  const completionEntry = run.index.objects.find((object) => object.artifactType === 'completion');
  if (!completionEntry) throw new Error('case_graph_publication_relationship_completion_missing');
  const contextualCompletionEntry = run.index.objects.find((object) => (
    object.artifactType === 'contextual_completion'
  ));
  if (!contextualCompletionEntry) {
    throw new Error('case_graph_publication_contextual_relationship_run_artifact_missing');
  }
  const relationshipCompletionArchive = await readVerifiedFullCorpusRelationshipArchiveObject<FullCorpusRelationshipCompletion>({
    storage,
    receiptKey: completionEntry.receiptKey,
    expectedLineage: run.pointer.lineage,
  });
  const relationshipCompletion = relationshipCompletionArchive.value;
  if (relationshipCompletion.completionDigest !== run.pointer.completionDigest
    || relationshipCompletionArchive.receipt.artifactDigest !== completionEntry.artifactDigest) {
    throw new Error('case_graph_publication_relationship_completion_mismatch');
  }
  const contextualCompletionArchive = await readVerifiedFullCorpusRelationshipArchiveObject<
  typeof contextualRelationshipCompletion
  >({
    storage,
    receiptKey: contextualCompletionEntry.receiptKey,
    expectedLineage: run.pointer.lineage,
    expectedContextualCompletion: run.pointer.contextualCompletion,
  });
  if (contextualCompletionArchive.receipt.artifactDigest !== contextualCompletionEntry.artifactDigest
    || canonicalizeRelationshipInput(contextualCompletionArchive.value)
      !== canonicalizeRelationshipInput(contextualRelationshipCompletion)
    || run.pointer.contextualCompletion.artifactDigest
      !== sha256(canonicalContextualRelationshipCompletionBody)) {
    throw new Error('case_graph_publication_contextual_relationship_run_artifact_mismatch');
  }
  await verifyPublicGraphShardCoverage(storage, publicGraphArchive.value);

  const manifest = buildCaseGraphPublicManifest({
    corpusVersion: params.corpusVersion,
    generatedAt: params.lineage.generatedAt,
    features: features.completion,
    universe,
    relationshipInput,
    relationshipCompletion,
    relationshipRun: run.pointer,
    productionCompatibility: productionCompatibility.pointer,
    publicGraph: publicGraphArchive.value,
    publicGraphManifestReceipt: publicGraphArchive.receipt,
    density: densityPointer,
    densityArtifact,
    calibration: {
      receipt: calibrationSetReceipt,
      receiptBody: calibrationSetReceiptBody,
      receiptKey: keys.calibrationSetReceiptKey,
      pairReceiptKey: keys.pairCalibrationReceiptKey,
      contextualReceiptKey: keys.contextualCalibrationReceiptKey,
      pairReceiptBody: params.lineage.calibration.pairReceiptBody,
      contextualReceiptBody: params.lineage.calibration.contextualReceiptBody,
    },
    calibrationEvidence: {
      humanReviewBundleBody: params.lineage.calibration.humanReviewBundleBody,
      humanReviewBundleKey: keys.humanReviewBundleKey,
      pairArtifactBody: params.lineage.calibration.pairArtifactBody,
      pairTrustPolicyBody: params.lineage.calibration.pairTrustPolicyBody,
      pairArtifactKey: keys.pairCalibrationArtifactKey,
      pairTrustPolicyKey: keys.pairCalibrationTrustPolicyKey,
      contextualArtifactBody: params.lineage.calibration.contextualArtifactBody,
      contextualTrustPolicyBody: params.lineage.calibration.contextualTrustPolicyBody,
      contextualArtifactKey: keys.contextualCalibrationArtifactKey,
      contextualTrustPolicyKey: keys.contextualCalibrationTrustPolicyKey,
      pinned: params.lineage.calibration.pinned,
    },
    contextualCompletion: {
      artifact: contextualRelationshipCompletion,
      body: canonicalContextualRelationshipCompletionBody,
      key: keys.contextualRelationshipCompletionKey,
    },
    accountingBinding,
  });
  const manifestBody = encodeCaseGraphPublicManifest(manifest);
  const manifestSha256 = caseGraphPublicManifestSha256(manifestBody);
  assertAccountingReceiptBinding(accountingReceipt, manifest, manifestSha256);
  const accountingReceiptSha256 = caseVortexCorpusAccountingReceiptSha256(params.lineage.accountingReceiptBody);

  await uploadImmutableAndVerify(storage, manifestBody, keys.manifestKey);
  await uploadImmutableAndVerify(storage, params.lineage.accountingReceiptBody, keys.accountingReceiptKey);
  await uploadImmutableAndVerify(storage, params.lineage.calibration.pairReceiptBody, keys.pairCalibrationReceiptKey);
  await uploadImmutableAndVerify(
    storage,
    params.lineage.calibration.contextualReceiptBody,
    keys.contextualCalibrationReceiptKey,
  );
  await uploadImmutableAndVerify(storage, calibrationSetReceiptBody, keys.calibrationSetReceiptKey);
  await uploadImmutableAndVerify(
    storage,
    params.lineage.calibration.humanReviewBundleBody,
    keys.humanReviewBundleKey,
  );
  await uploadImmutableAndVerify(
    storage,
    params.lineage.calibration.pairArtifactBody,
    keys.pairCalibrationArtifactKey,
  );
  await uploadImmutableAndVerify(
    storage,
    params.lineage.calibration.pairTrustPolicyBody,
    keys.pairCalibrationTrustPolicyKey,
  );
  await uploadImmutableAndVerify(
    storage,
    params.lineage.calibration.contextualArtifactBody,
    keys.contextualCalibrationArtifactKey,
  );
  await uploadImmutableAndVerify(
    storage,
    params.lineage.calibration.contextualTrustPolicyBody,
    keys.contextualCalibrationTrustPolicyKey,
  );
  await uploadImmutableAndVerify(
    storage,
    canonicalContextualRelationshipCompletionBody,
    keys.contextualRelationshipCompletionKey,
  );
  const completion: CaseGraphPublicationCandidateCompletion = {
    record_type: 'case_graph_publication_candidate_completion',
    schema_version: CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION,
    public_manifest_version: CASE_GRAPH_PUBLIC_MANIFEST_VERSION,
    graph_artifact_set_version: CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION,
    corpus_version: params.corpusVersion,
    snapshot_id: manifest.lineage.snapshot.snapshotId,
    manifest_key: keys.manifestKey,
    manifest_sha256: manifestSha256,
    accounting_receipt_key: keys.accountingReceiptKey,
    accounting_receipt_sha256: accountingReceiptSha256,
    relationship_input_manifest_digest: manifest.lineage.relationshipInput.manifestDigest,
    relationship_policy_version: manifest.lineage.relationship.policyVersion,
    relationship_policy_sha256: manifest.lineage.relationship.policySha256,
    relationship_model_id: manifest.lineage.relationship.modelId,
    relationship_model_version: manifest.lineage.relationship.modelVersion,
    relationship_model_sha256: manifest.lineage.relationship.modelSha256,
    relationship_run_index_digest: manifest.lineage.relationshipRun.indexDigest,
    relationship_run_artifact_set_sha256: manifest.lineage.relationshipRun.artifactSetSha256,
    relationship_completion_digest: manifest.lineage.relationshipRun.completionDigest,
    public_graph_manifest_digest: manifest.lineage.publicGraph.manifestDigest,
    density_artifact_digest: manifest.density.artifactDigest,
    calibration_set_receipt_key: manifest.lineage.calibration.set.receiptKey,
    calibration_set_receipt_sha256: manifest.lineage.calibration.set.receiptSha256,
    calibration_set_receipt_body_sha256: manifest.lineage.calibration.set.receiptBodySha256,
    calibration_set_sha256: manifest.lineage.calibration.set.calibrationSetSha256,
    pair_calibration_receipt_id: manifest.lineage.calibration.pair.receiptId,
    pair_calibration_receipt_key: manifest.lineage.calibration.pair.receiptKey,
    pair_calibration_receipt_sha256: manifest.lineage.calibration.pair.receiptSha256,
    pair_calibration_receipt_body_sha256: manifest.lineage.calibration.pair.receiptBodySha256,
    pair_calibration_lineage_sha256: manifest.lineage.calibration.pair.lineageSha256,
    contextual_calibration_receipt_id: manifest.lineage.calibration.contextual.receiptId,
    contextual_calibration_receipt_key: manifest.lineage.calibration.contextual.receiptKey,
    contextual_calibration_receipt_sha256: manifest.lineage.calibration.contextual.receiptSha256,
    contextual_calibration_receipt_body_sha256: manifest.lineage.calibration.contextual.receiptBodySha256,
    contextual_calibration_lineage_sha256: manifest.lineage.calibration.contextual.lineageSha256,
    pair_calibration_artifact_key: manifest.lineage.calibrationEvidence.pair.artifactKey,
    pair_calibration_artifact_body_sha256: manifest.lineage.calibrationEvidence.pair.artifactBodySha256,
    pair_calibration_artifact_digest: manifest.lineage.calibrationEvidence.pair.artifactDigest,
    pair_calibration_trust_policy_key: manifest.lineage.calibrationEvidence.pair.trustPolicyKey,
    pair_calibration_trust_policy_body_sha256:
      manifest.lineage.calibrationEvidence.pair.trustPolicyBodySha256,
    pair_calibration_trust_policy_digest: manifest.lineage.calibrationEvidence.pair.trustPolicyDigest,
    contextual_calibration_artifact_key: manifest.lineage.calibrationEvidence.contextual.artifactKey,
    contextual_calibration_artifact_body_sha256:
      manifest.lineage.calibrationEvidence.contextual.artifactBodySha256,
    contextual_calibration_artifact_digest: manifest.lineage.calibrationEvidence.contextual.artifactDigest,
    contextual_calibration_trust_policy_key:
      manifest.lineage.calibrationEvidence.contextual.trustPolicyKey,
    contextual_calibration_trust_policy_body_sha256:
      manifest.lineage.calibrationEvidence.contextual.trustPolicyBodySha256,
    contextual_calibration_trust_policy_digest:
      manifest.lineage.calibrationEvidence.contextual.trustPolicyDigest,
    contextual_relationship_completion_key: manifest.lineage.contextualCompletion.key,
    contextual_relationship_completion_body_sha256: manifest.lineage.contextualCompletion.bodySha256,
    contextual_relationship_completion_id: manifest.lineage.contextualCompletion.completionId,
    contextual_relationship_completion_digest: manifest.lineage.contextualCompletion.completionDigest,
    contextual_relationship_source_completion_set_sha256:
      manifest.lineage.contextualCompletion.sourceCompletionSetSha256,
    contextual_relationship_entry_set_sha256: manifest.lineage.contextualCompletion.entrySetSha256,
    contextual_relationship_accounting: manifest.lineage.contextualCompletion.accounting,
    graph_artifact_set_sha256: manifest.lineage.graph.artifactSetSha256,
    eligible_case_count: manifest.accounting.universeRecordCount,
    indexed_case_count: manifest.accounting.indexedRecordCount,
    candidate_pair_count: manifest.accounting.candidatePairCount,
    unique_edge_count: manifest.accounting.typedEdgeCount,
    skipped_group_count: manifest.accounting.skippedGroupReceiptCount,
    skipped_estimated_pair_count: manifest.accounting.skippedEstimatedPairCount,
    generated_at: manifest.generatedAt,
  };
  const completionBody = encodeCaseGraphPublicationCandidateCompletion(completion);
  // Completion is the final fence. Readers ignore partial candidate objects
  // until this exact receipt has been written and verified.
  await uploadImmutableAndVerify(storage, completionBody, keys.completionManifestKey);
  return {
    status: 'complete' as const,
    completion,
    manifest,
    manifestBody,
    accountingReceipt,
    accountingReceiptBody: params.lineage.accountingReceiptBody,
    contextualRelationshipCompletion,
    contextualRelationshipCompletionBody: canonicalContextualRelationshipCompletionBody,
    productionCompatibility,
  };
};
