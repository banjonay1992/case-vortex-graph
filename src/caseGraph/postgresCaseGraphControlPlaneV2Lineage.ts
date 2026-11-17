
import { getCaseGraphCorpusPrefix, getCaseGraphPublicationKeys } from './archiveKeys';
import type { CaseGraphFeatureCompletionManifest } from './archiveTypes';
import type { CaseVortexCorpusAccountingReceipt, CaseVortexRepresentedRecord } from './corpusAccounting';
import {
  caseVortexCorpusAccountingReceiptSha256,
  decodeCaseVortexCorpusAccountingReceipt,
  encodeCaseVortexCorpusAccountingReceipt,
} from './corpusAccountingIntegration';
import { evidenceUniverseAddress, type EvidenceUniverseNodeKind } from './evidenceUniverse';
import type { EvidenceUniverseCompletion } from './evidenceUniverseArchive';
import { decodeEvidenceUniverseCompletion } from './evidenceUniversePublicAccess';
import { decodeCaseGraphFeatureCompletion } from './featureArchive';
import {
  decodeIncrementalGraphPlan,
  incrementalGraphSha256,
  type IncrementalGraphPlan,
  type IncrementalGraphUniverseBinding,
} from './incrementalGraphPlan';
import {
  caseGraphPublicManifestSha256,
  decodeCaseGraphPublicManifest,
  encodeCaseGraphPublicManifest,
  type CaseGraphPublicManifest,
} from './publicationManifest';
import {
  CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION,
  encodeCaseGraphPublicationCandidateCompletion,
  type CaseGraphPublicationCandidateCompletion,
} from './publicationArchive';
import {
  decodeCaseGraphPublicationCalibrationSetReceipt,
  serializeCaseGraphPublicationCalibrationSetReceipt,
  verifyCaseGraphPublicationCalibrationSetReceiptBodies,
  type CaseGraphPublicationCalibrationSetReceipt,
} from './publicationCalibrationSet';
import { canonicalizeContextualExplanation } from './contextualExplanation';
import {
  decodeContextualRelationshipCalibrationArtifact,
  decodeContextualRelationshipCalibrationTrustPolicy,
  serializeContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationTrustPolicy,
} from './contextualRelationshipCalibration';
import {
  assertContextualRelationshipCompletionProductionEligible,
  serializeContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionArtifact,
} from './contextualRelationshipCompletion';
import {
  decodeRelationshipInputSnapshotManifest,
  type RelationshipInputSnapshotManifest,
} from './relationshipInputArchive';
import {
  canonicalizeRelationshipInput,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  decodeTypedRelationshipCalibrationArtifact,
  decodeTypedRelationshipCalibrationTrustPolicy,
  serializeTypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationReceipt,
  type TypedRelationshipCalibrationTrustPolicy,
} from './typedRelationshipCalibration';
import {
  TYPED_RELATIONSHIP_EDGE_TYPES,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  type TypedRelationshipEdgeType,
} from './typedRelationshipEngine';
import {
  decodeFullCorpusRelationshipCompletion,
  fullCorpusRelationshipArtifactSha256,
  type FullCorpusRelationshipCompletion,
} from './typedRelationshipPipeline';
import {
  decodeFullCorpusRelationshipArchiveObject,
  decodeFullCorpusRelationshipArchiveReceipt,
  decodeFullCorpusRelationshipRunIndexPointer,
  type FullCorpusRelationshipArchiveReceipt,
  type FullCorpusRelationshipRunIndex,
  type FullCorpusRelationshipRunIndexPointer,
} from './typedRelationshipPipelineArchive';

import { LINEAGE_BRAND, type CaseGraphV2LineageReceipts } from './postgresCaseGraphControlPlaneV2Types';
import { deepFreeze, exactKeys, parseJsonBody, requiredText, sameJson, sameKindCounts, sha256 } from './postgresCaseGraphControlPlaneV2Shared';
const assertCompletion = (
  completion: CaseGraphPublicationCandidateCompletion,
  manifest: CaseGraphPublicManifest,
  manifestSha256: string,
  accountingSha256: string,
) => {
  if (!exactKeys(completion, [
    'record_type', 'schema_version', 'public_manifest_version', 'graph_artifact_set_version',
    'corpus_version', 'snapshot_id', 'manifest_key', 'manifest_sha256', 'accounting_receipt_key',
    'accounting_receipt_sha256', 'relationship_input_manifest_digest',
    'relationship_policy_version', 'relationship_policy_sha256', 'relationship_model_id',
    'relationship_model_version', 'relationship_model_sha256', 'relationship_run_index_digest',
    'relationship_run_artifact_set_sha256', 'relationship_completion_digest',
    'public_graph_manifest_digest', 'density_artifact_digest',
    'calibration_set_receipt_key', 'calibration_set_receipt_sha256',
    'calibration_set_receipt_body_sha256', 'calibration_set_sha256',
    'pair_calibration_receipt_id', 'pair_calibration_receipt_key',
    'pair_calibration_receipt_sha256', 'pair_calibration_receipt_body_sha256',
    'pair_calibration_lineage_sha256', 'contextual_calibration_receipt_id',
    'contextual_calibration_receipt_key', 'contextual_calibration_receipt_sha256',
    'contextual_calibration_receipt_body_sha256', 'contextual_calibration_lineage_sha256',
    'pair_calibration_artifact_key', 'pair_calibration_artifact_body_sha256',
    'pair_calibration_artifact_digest', 'pair_calibration_trust_policy_key',
    'pair_calibration_trust_policy_body_sha256', 'pair_calibration_trust_policy_digest',
    'contextual_calibration_artifact_key', 'contextual_calibration_artifact_body_sha256',
    'contextual_calibration_artifact_digest', 'contextual_calibration_trust_policy_key',
    'contextual_calibration_trust_policy_body_sha256', 'contextual_calibration_trust_policy_digest',
    'contextual_relationship_completion_key', 'contextual_relationship_completion_body_sha256',
    'contextual_relationship_completion_id', 'contextual_relationship_completion_digest',
    'contextual_relationship_source_completion_set_sha256',
    'contextual_relationship_entry_set_sha256', 'contextual_relationship_accounting',
    'graph_artifact_set_sha256', 'eligible_case_count', 'indexed_case_count',
    'candidate_pair_count', 'unique_edge_count', 'skipped_group_count',
    'skipped_estimated_pair_count', 'generated_at',
  ])) throw new Error('case_graph_v2_publication_completion_invalid');
  const keys = getCaseGraphPublicationKeys(manifest.corpusVersion);
  if (completion.record_type !== 'case_graph_publication_candidate_completion'
    || completion.schema_version !== CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION
    || completion.public_manifest_version !== manifest.schemaVersion
    || completion.graph_artifact_set_version !== manifest.lineage.graph.artifactSetVersion
    || completion.corpus_version !== manifest.corpusVersion
    || completion.snapshot_id !== manifest.lineage.snapshot.snapshotId
    || completion.manifest_key !== keys.manifestKey
    || completion.accounting_receipt_key !== keys.accountingReceiptKey
    || completion.calibration_set_receipt_key !== keys.calibrationSetReceiptKey
    || completion.pair_calibration_receipt_key !== keys.pairCalibrationReceiptKey
    || completion.contextual_calibration_receipt_key !== keys.contextualCalibrationReceiptKey
    || completion.pair_calibration_artifact_key !== keys.pairCalibrationArtifactKey
    || completion.pair_calibration_trust_policy_key !== keys.pairCalibrationTrustPolicyKey
    || completion.contextual_calibration_artifact_key !== keys.contextualCalibrationArtifactKey
    || completion.contextual_calibration_trust_policy_key
      !== keys.contextualCalibrationTrustPolicyKey
    || completion.contextual_relationship_completion_key
      !== keys.contextualRelationshipCompletionKey
    || completion.manifest_sha256 !== manifestSha256
    || completion.accounting_receipt_sha256 !== accountingSha256
    || completion.relationship_input_manifest_digest !== manifest.lineage.relationshipInput.manifestDigest
    || completion.relationship_policy_version !== manifest.lineage.relationship.policyVersion
    || completion.relationship_policy_sha256 !== manifest.lineage.relationship.policySha256
    || completion.relationship_model_id !== manifest.lineage.relationship.modelId
    || completion.relationship_model_version !== manifest.lineage.relationship.modelVersion
    || completion.relationship_model_sha256 !== manifest.lineage.relationship.modelSha256
    || completion.relationship_run_index_digest !== manifest.lineage.relationshipRun.indexDigest
    || completion.relationship_run_artifact_set_sha256 !== manifest.lineage.relationshipRun.artifactSetSha256
    || completion.relationship_completion_digest !== manifest.lineage.relationshipRun.completionDigest
    || completion.public_graph_manifest_digest !== manifest.lineage.publicGraph.manifestDigest
    || completion.density_artifact_digest !== manifest.density.artifactDigest
    || completion.calibration_set_receipt_key !== manifest.lineage.calibration.set.receiptKey
    || completion.calibration_set_receipt_sha256 !== manifest.lineage.calibration.set.receiptSha256
    || completion.calibration_set_receipt_body_sha256 !== manifest.lineage.calibration.set.receiptBodySha256
    || completion.calibration_set_sha256 !== manifest.lineage.calibration.set.calibrationSetSha256
    || completion.pair_calibration_receipt_id !== manifest.lineage.calibration.pair.receiptId
    || completion.pair_calibration_receipt_key !== manifest.lineage.calibration.pair.receiptKey
    || completion.pair_calibration_receipt_sha256 !== manifest.lineage.calibration.pair.receiptSha256
    || completion.pair_calibration_receipt_body_sha256 !== manifest.lineage.calibration.pair.receiptBodySha256
    || completion.pair_calibration_lineage_sha256 !== manifest.lineage.calibration.pair.lineageSha256
    || completion.contextual_calibration_receipt_id !== manifest.lineage.calibration.contextual.receiptId
    || completion.contextual_calibration_receipt_key !== manifest.lineage.calibration.contextual.receiptKey
    || completion.contextual_calibration_receipt_sha256 !== manifest.lineage.calibration.contextual.receiptSha256
    || completion.contextual_calibration_receipt_body_sha256
      !== manifest.lineage.calibration.contextual.receiptBodySha256
    || completion.contextual_calibration_lineage_sha256 !== manifest.lineage.calibration.contextual.lineageSha256
    || completion.pair_calibration_artifact_key
      !== manifest.lineage.calibrationEvidence.pair.artifactKey
    || completion.pair_calibration_artifact_body_sha256
      !== manifest.lineage.calibrationEvidence.pair.artifactBodySha256
    || completion.pair_calibration_artifact_digest
      !== manifest.lineage.calibrationEvidence.pair.artifactDigest
    || completion.pair_calibration_trust_policy_key
      !== manifest.lineage.calibrationEvidence.pair.trustPolicyKey
    || completion.pair_calibration_trust_policy_body_sha256
      !== manifest.lineage.calibrationEvidence.pair.trustPolicyBodySha256
    || completion.pair_calibration_trust_policy_digest
      !== manifest.lineage.calibrationEvidence.pair.trustPolicyDigest
    || completion.contextual_calibration_artifact_key
      !== manifest.lineage.calibrationEvidence.contextual.artifactKey
    || completion.contextual_calibration_artifact_body_sha256
      !== manifest.lineage.calibrationEvidence.contextual.artifactBodySha256
    || completion.contextual_calibration_artifact_digest
      !== manifest.lineage.calibrationEvidence.contextual.artifactDigest
    || completion.contextual_calibration_trust_policy_key
      !== manifest.lineage.calibrationEvidence.contextual.trustPolicyKey
    || completion.contextual_calibration_trust_policy_body_sha256
      !== manifest.lineage.calibrationEvidence.contextual.trustPolicyBodySha256
    || completion.contextual_calibration_trust_policy_digest
      !== manifest.lineage.calibrationEvidence.contextual.trustPolicyDigest
    || completion.contextual_relationship_completion_key
      !== manifest.lineage.contextualCompletion.key
    || completion.contextual_relationship_completion_body_sha256
      !== manifest.lineage.contextualCompletion.bodySha256
    || completion.contextual_relationship_completion_id
      !== manifest.lineage.contextualCompletion.completionId
    || completion.contextual_relationship_completion_digest
      !== manifest.lineage.contextualCompletion.completionDigest
    || completion.contextual_relationship_source_completion_set_sha256
      !== manifest.lineage.contextualCompletion.sourceCompletionSetSha256
    || completion.contextual_relationship_entry_set_sha256
      !== manifest.lineage.contextualCompletion.entrySetSha256
    || !sameJson(
      completion.contextual_relationship_accounting,
      manifest.lineage.contextualCompletion.accounting,
    )
    || completion.graph_artifact_set_sha256 !== manifest.lineage.graph.artifactSetSha256
    || completion.eligible_case_count !== manifest.accounting.universeRecordCount
    || completion.indexed_case_count !== manifest.accounting.indexedRecordCount
    || completion.candidate_pair_count !== manifest.accounting.candidatePairCount
    || completion.unique_edge_count !== manifest.accounting.typedEdgeCount
    || completion.skipped_group_count !== manifest.accounting.skippedGroupReceiptCount
    || completion.skipped_estimated_pair_count !== manifest.accounting.skippedEstimatedPairCount
    || completion.generated_at !== manifest.generatedAt) {
    throw new Error('case_graph_v2_publication_completion_binding_mismatch');
  }
};

/**
 * Re-decodes canonical receipt bytes and binds the decoded values to the final
 * R2 candidate completion. No standalone lineage digest is accepted here.
 */
export const validateCaseGraphV2LineageReceipts = (input: {
  completion: CaseGraphPublicationCandidateCompletion;
  completionBody: Buffer;
  universeCompletionBody: Buffer;
  featureCompletionBody: Buffer;
  relationshipInputManifestBody: Buffer;
  relationshipCompletionBody: Buffer;
  relationshipRunIndexArchiveBody: Buffer;
  relationshipRunIndexReceiptBody: Buffer;
  relationshipRunIndexPointerBody: Buffer;
  contextualCompletionBody: Buffer;
  calibrationSetReceiptBody: Buffer;
  pairCalibrationReceiptBody: Buffer;
  contextualCalibrationReceiptBody: Buffer;
  pairCalibrationArtifactBody: Buffer;
  pairCalibrationTrustPolicyBody: Buffer;
  contextualCalibrationArtifactBody: Buffer;
  contextualCalibrationTrustPolicyBody: Buffer;
  manifest: CaseGraphPublicManifest;
  manifestBody: Buffer;
  accountingReceipt: CaseVortexCorpusAccountingReceipt;
  accountingReceiptBody: Buffer;
}): CaseGraphV2LineageReceipts => {
  if (!Buffer.isBuffer(input.completionBody)
    || !Buffer.isBuffer(input.universeCompletionBody)
    || !Buffer.isBuffer(input.featureCompletionBody)
    || !Buffer.isBuffer(input.relationshipInputManifestBody)
    || !Buffer.isBuffer(input.relationshipCompletionBody)
    || !Buffer.isBuffer(input.relationshipRunIndexArchiveBody)
    || !Buffer.isBuffer(input.relationshipRunIndexReceiptBody)
    || !Buffer.isBuffer(input.relationshipRunIndexPointerBody)
    || !Buffer.isBuffer(input.contextualCompletionBody)
    || !Buffer.isBuffer(input.calibrationSetReceiptBody)
    || !Buffer.isBuffer(input.pairCalibrationReceiptBody)
    || !Buffer.isBuffer(input.contextualCalibrationReceiptBody)
    || !Buffer.isBuffer(input.pairCalibrationArtifactBody)
    || !Buffer.isBuffer(input.pairCalibrationTrustPolicyBody)
    || !Buffer.isBuffer(input.contextualCalibrationArtifactBody)
    || !Buffer.isBuffer(input.contextualCalibrationTrustPolicyBody)
    || !Buffer.isBuffer(input.manifestBody)
    || !Buffer.isBuffer(input.accountingReceiptBody)) {
    throw new Error('case_graph_v2_lineage_receipt_bytes_required');
  }
  const corpusVersion = requiredText(input.completion?.corpus_version, 'case_graph_v2_corpus_version_invalid');
  const universe = decodeEvidenceUniverseCompletion(input.universeCompletionBody, corpusVersion);
  const features = decodeCaseGraphFeatureCompletion(input.featureCompletionBody, corpusVersion);
  const relationshipBinding: RelationshipInputUniverseBinding = {
    snapshotId: universe.expected.snapshotId,
    corpusVersion: universe.corpusVersion,
    universeArchiveVersion: universe.archiveVersion,
    universeSchemaVersion: universe.schemaVersion,
    universeLayoutVersion: universe.layoutVersion,
    universeArchiveSetSha256: universe.archiveSetSha256,
    universeRecordCount: universe.expected.total,
  };
  const relationshipInput = decodeRelationshipInputSnapshotManifest(
    input.relationshipInputManifestBody,
    relationshipBinding,
  );
  const relationshipCompletion = decodeFullCorpusRelationshipCompletion(
    input.relationshipCompletionBody,
  );
  const manifest = decodeCaseGraphPublicManifest(input.manifestBody, corpusVersion);
  const accounting = decodeCaseVortexCorpusAccountingReceipt(input.accountingReceiptBody);
  const canonicalRelationshipCompletionBody = Buffer.from(
    `${canonicalizeRelationshipInput(relationshipCompletion)}\n`,
    'utf8',
  );
  if (!input.relationshipCompletionBody.equals(canonicalRelationshipCompletionBody)) {
    throw new Error('case_graph_v2_relationship_completion_noncanonical');
  }
  const relationshipRunIndexReceipt = decodeFullCorpusRelationshipArchiveReceipt(
    input.relationshipRunIndexReceiptBody,
    relationshipCompletion.lineage,
  );
  const canonicalRelationshipRunIndexReceiptBody = Buffer.from(
    `${canonicalizeRelationshipInput(relationshipRunIndexReceipt)}\n`,
    'utf8',
  );
  if (!input.relationshipRunIndexReceiptBody.equals(canonicalRelationshipRunIndexReceiptBody)) {
    throw new Error('case_graph_v2_relationship_run_index_receipt_noncanonical');
  }
  const relationshipRunIndex = decodeFullCorpusRelationshipArchiveObject<FullCorpusRelationshipRunIndex>({
    archiveBody: input.relationshipRunIndexArchiveBody,
    receipt: relationshipRunIndexReceipt,
    expectedLineage: relationshipCompletion.lineage,
    expectedContextualCompletion: relationshipCompletion.contextualCompletion,
  });
  const relationshipRunIndexPointer = decodeFullCorpusRelationshipRunIndexPointer(
    input.relationshipRunIndexPointerBody,
    relationshipCompletion.lineage,
  );
  const canonicalRelationshipRunIndexPointerBody = Buffer.from(
    `${canonicalizeRelationshipInput(relationshipRunIndexPointer)}\n`,
    'utf8',
  );
  if (!input.relationshipRunIndexPointerBody.equals(canonicalRelationshipRunIndexPointerBody)) {
    throw new Error('case_graph_v2_relationship_run_index_pointer_noncanonical');
  }
  if (!encodeCaseGraphPublicManifest(input.manifest).equals(input.manifestBody)
    || !encodeCaseVortexCorpusAccountingReceipt(input.accountingReceipt).equals(input.accountingReceiptBody)) {
    throw new Error('case_graph_v2_decoded_receipt_mismatch');
  }
  const publicManifestSha256 = caseGraphPublicManifestSha256(input.manifestBody);
  const accountingReceiptSha256 = caseVortexCorpusAccountingReceiptSha256(input.accountingReceiptBody);
  assertCompletion(input.completion, manifest, publicManifestSha256, accountingReceiptSha256);
  if (!encodeCaseGraphPublicationCandidateCompletion(input.completion).equals(input.completionBody)) {
    throw new Error('case_graph_v2_publication_completion_bytes_mismatch');
  }
  const calibrationSet = decodeCaseGraphPublicationCalibrationSetReceipt(
    input.calibrationSetReceiptBody,
    {
      receiptSha256: manifest.lineage.calibration.set.receiptSha256,
      calibrationSetSha256: manifest.lineage.calibration.set.calibrationSetSha256,
    },
  );
  const canonicalCalibrationSetBody = Buffer.from(
    serializeCaseGraphPublicationCalibrationSetReceipt(calibrationSet),
    'utf8',
  );
  if (!input.calibrationSetReceiptBody.equals(canonicalCalibrationSetBody)) {
    throw new Error('case_graph_v2_calibration_set_receipt_noncanonical');
  }
  const verifiedCalibration = verifyCaseGraphPublicationCalibrationSetReceiptBodies({
    receipt: calibrationSet,
    pairReceiptBody: input.pairCalibrationReceiptBody,
    contextualReceiptBody: input.contextualCalibrationReceiptBody,
  });
  const pairCalibrationTrustPolicy = decodeTypedRelationshipCalibrationTrustPolicy(
    parseJsonBody(input.pairCalibrationTrustPolicyBody, 'case_graph_v2_pair_calibration_trust_json_invalid'),
  );
  const contextualCalibrationTrustPolicy = decodeContextualRelationshipCalibrationTrustPolicy(
    parseJsonBody(
      input.contextualCalibrationTrustPolicyBody,
      'case_graph_v2_contextual_calibration_trust_json_invalid',
    ),
  );
  const canonicalPairTrustPolicyBody = Buffer.from(
    `${canonicalizeRelationshipInput(pairCalibrationTrustPolicy)}\n`,
    'utf8',
  );
  const canonicalContextualTrustPolicyBody = Buffer.from(
    `${canonicalizeContextualExplanation(contextualCalibrationTrustPolicy)}\n`,
    'utf8',
  );
  const pairCalibrationArtifact = decodeTypedRelationshipCalibrationArtifact(
    input.pairCalibrationArtifactBody,
    relationshipBinding,
    pairCalibrationTrustPolicy,
  );
  const contextualCalibrationArtifact = decodeContextualRelationshipCalibrationArtifact(
    input.contextualCalibrationArtifactBody,
    relationshipBinding,
    contextualCalibrationTrustPolicy,
  );
  const canonicalPairCalibrationArtifactBody = Buffer.from(
    serializeTypedRelationshipCalibrationArtifact(
      pairCalibrationArtifact,
      pairCalibrationTrustPolicy,
    ),
    'utf8',
  );
  const canonicalContextualCalibrationArtifactBody = Buffer.from(
    serializeContextualRelationshipCalibrationArtifact(
      contextualCalibrationArtifact,
      contextualCalibrationTrustPolicy,
    ),
    'utf8',
  );
  if (!input.pairCalibrationTrustPolicyBody.equals(canonicalPairTrustPolicyBody)
    || !input.contextualCalibrationTrustPolicyBody.equals(canonicalContextualTrustPolicyBody)
    || !input.pairCalibrationArtifactBody.equals(canonicalPairCalibrationArtifactBody)
    || !input.contextualCalibrationArtifactBody.equals(canonicalContextualCalibrationArtifactBody)
    || !sameJson(pairCalibrationArtifact.receipt, verifiedCalibration.pairReceipt)
    || !sameJson(contextualCalibrationArtifact.receipt, verifiedCalibration.contextualReceipt)
    || !sameJson(pairCalibrationArtifact.lineage, calibrationSet.pairLineage)
    || !sameJson(contextualCalibrationArtifact.lineage, calibrationSet.contextualLineage)) {
    throw new Error('case_graph_v2_calibration_evidence_binding_mismatch');
  }
  const contextualCalibrationIdentity = {
    receiptId: verifiedCalibration.contextualReceipt.receiptId,
    receiptSha256: verifiedCalibration.contextualReceipt.receiptSha256,
  };
  const contextualCompletion = assertContextualRelationshipCompletionProductionEligible(
    input.contextualCompletionBody,
    relationshipBinding,
    contextualCalibrationIdentity,
  );
  const canonicalContextualCompletionBody = Buffer.from(
    serializeContextualRelationshipCompletionArtifact(
      contextualCompletion,
      contextualCalibrationIdentity,
    ),
    'utf8',
  );
  if (!input.contextualCompletionBody.equals(canonicalContextualCompletionBody)) {
    throw new Error('case_graph_v2_contextual_completion_noncanonical');
  }
  const manifestUniverse = manifest.lineage.universe;
  const manifestFeatures = manifest.lineage.features;
  const manifestRelationshipInput = manifest.lineage.relationshipInput;
  const snapshot = manifest.lineage.snapshot;
  const accountingBinding = accounting.binding;
  const calibrationLineage = manifest.lineage.calibration;
  const calibrationEvidence = manifest.lineage.calibrationEvidence;
  if (sha256(input.calibrationSetReceiptBody) !== calibrationLineage.set.receiptBodySha256
    || calibrationSet.receiptSha256 !== calibrationLineage.set.receiptSha256
    || calibrationSet.calibrationSetSha256 !== calibrationLineage.set.calibrationSetSha256
    || verifiedCalibration.pairReceipt.receiptId !== calibrationLineage.pair.receiptId
    || verifiedCalibration.pairReceipt.receiptSha256 !== calibrationLineage.pair.receiptSha256
    || sha256(input.pairCalibrationReceiptBody) !== calibrationLineage.pair.receiptBodySha256
    || verifiedCalibration.pairReceipt.lineageSha256 !== calibrationLineage.pair.lineageSha256
    || verifiedCalibration.contextualReceipt.receiptId !== calibrationLineage.contextual.receiptId
    || verifiedCalibration.contextualReceipt.receiptSha256 !== calibrationLineage.contextual.receiptSha256
    || sha256(input.contextualCalibrationReceiptBody) !== calibrationLineage.contextual.receiptBodySha256
    || verifiedCalibration.contextualReceipt.lineageSha256 !== calibrationLineage.contextual.lineageSha256
    || sha256(canonicalPairCalibrationArtifactBody) !== calibrationEvidence.pair.artifactBodySha256
    || pairCalibrationArtifact.artifactDigest !== calibrationEvidence.pair.artifactDigest
    || sha256(canonicalPairTrustPolicyBody) !== calibrationEvidence.pair.trustPolicyBodySha256
    || pairCalibrationTrustPolicy.trustPolicyDigest !== calibrationEvidence.pair.trustPolicyDigest
    || sha256(canonicalContextualCalibrationArtifactBody)
      !== calibrationEvidence.contextual.artifactBodySha256
    || contextualCalibrationArtifact.artifactDigest !== calibrationEvidence.contextual.artifactDigest
    || sha256(canonicalContextualTrustPolicyBody)
      !== calibrationEvidence.contextual.trustPolicyBodySha256
    || contextualCalibrationTrustPolicy.trustPolicyDigest
      !== calibrationEvidence.contextual.trustPolicyDigest
    || !sameJson(calibrationSet.binding, relationshipInput.binding)
    || calibrationSet.relationshipInput.archiveSetSha256 !== relationshipInput.archiveSetSha256
    || calibrationSet.relationshipInput.manifestDigest !== relationshipInput.manifestDigest
    || calibrationSet.relationshipInput.recordCount !== relationshipInput.rowCount
    || calibrationSet.relationshipEngine.policyVersion !== manifest.lineage.relationship.policyVersion
    || calibrationSet.relationshipEngine.policySha256 !== manifest.lineage.relationship.policySha256
    || calibrationSet.relationshipEngine.modelId !== manifest.lineage.relationship.modelId
    || calibrationSet.relationshipEngine.modelVersion !== manifest.lineage.relationship.modelVersion
    || calibrationSet.relationshipEngine.modelSha256 !== manifest.lineage.relationship.modelSha256) {
    throw new Error('case_graph_v2_calibration_set_binding_mismatch');
  }
  const contextualCompletionReference = {
    completionId: contextualCompletion.completionId,
    completionDigest: contextualCompletion.completionDigest,
    artifactDigest: fullCorpusRelationshipArtifactSha256(contextualCompletion),
    sourceCompletionSetSha256: contextualCompletion.sourceCompletionSetSha256,
    entrySetSha256: contextualCompletion.entrySetSha256,
    calibrationReceiptId: contextualCompletion.calibrationReceipt.receiptId,
    calibrationReceiptSha256: contextualCompletion.calibrationReceipt.receiptSha256,
    sourceSnapshotCount: contextualCompletion.accounting.sourceSnapshotCount,
    sourceRecordCount: contextualCompletion.accounting.sourceRecordCount,
    acceptedEdgeCount: contextualCompletion.accounting.acceptedEdgeCount,
    insufficientEvidenceCount: contextualCompletion.accounting.insufficientEvidenceCount,
    zeroObservationState: contextualCompletion.zeroObservationState,
  };
  const completionIndexEntry = relationshipRunIndex.objects.find((entry) => (
    entry.artifactType === 'completion'
  ));
  const contextualIndexEntry = relationshipRunIndex.objects.find((entry) => (
    entry.artifactType === 'contextual_completion'
  ));
  if (relationshipRunIndexReceipt.artifactType !== 'run_index'
    || relationshipRunIndexReceipt.artifactDigest !== relationshipRunIndexPointer.indexArtifactDigest
    || relationshipRunIndexReceipt.archiveKey !== relationshipRunIndexPointer.indexArchiveKey
    || relationshipRunIndexReceipt.receiptKey !== relationshipRunIndexPointer.indexReceiptKey
    || relationshipRunIndex.indexDigest !== relationshipRunIndexPointer.indexDigest
    || relationshipRunIndex.artifactSetSha256 !== relationshipRunIndexPointer.artifactSetSha256
    || relationshipRunIndex.completionDigest !== relationshipRunIndexPointer.completionDigest
    || relationshipRunIndex.indexDigest !== manifest.lineage.relationshipRun.indexDigest
    || relationshipRunIndex.artifactSetSha256 !== manifest.lineage.relationshipRun.artifactSetSha256
    || relationshipRunIndex.completionDigest !== manifest.lineage.relationshipRun.completionDigest
    || !sameJson(relationshipRunIndexPointer, manifest.lineage.relationshipRun)
    || !sameJson(relationshipCompletion.contextualCompletion, contextualCompletionReference)
    || !sameJson(relationshipRunIndex.contextualCompletion, contextualCompletionReference)
    || !sameJson(relationshipRunIndexPointer.contextualCompletion, contextualCompletionReference)
    || completionIndexEntry?.artifactDigest !== fullCorpusRelationshipArtifactSha256(relationshipCompletion)
    || contextualIndexEntry?.artifactDigest !== contextualCompletionReference.artifactDigest) {
    throw new Error('case_graph_v2_relationship_run_index_binding_mismatch');
  }
  const manifestContextualCompletion = manifest.lineage.contextualCompletion;
  if (manifestContextualCompletion.bodySha256 !== sha256(canonicalContextualCompletionBody)
    || manifestContextualCompletion.completionId !== contextualCompletion.completionId
    || manifestContextualCompletion.completionDigest !== contextualCompletion.completionDigest
    || manifestContextualCompletion.sourceCompletionSetSha256 !== contextualCompletion.sourceCompletionSetSha256
    || manifestContextualCompletion.entrySetSha256 !== contextualCompletion.entrySetSha256
    || !sameJson(manifestContextualCompletion.accounting, contextualCompletion.accounting)) {
    throw new Error('case_graph_v2_contextual_completion_binding_mismatch');
  }
  const relationshipLineage = relationshipCompletion.lineage;
  if (!sameJson(relationshipLineage.binding, relationshipBinding)
    || relationshipLineage.relationshipInputManifestDigest !== relationshipInput.manifestDigest
    || relationshipLineage.relationshipInputArchiveSetSha256 !== relationshipInput.archiveSetSha256
    || relationshipLineage.relationshipInputRecordSetSha256 !== calibrationSet.relationshipInput.recordSetSha256
    || relationshipLineage.rarityIndexDigest !== calibrationSet.pairLineage.rarity.indexDigest
    || relationshipLineage.typedRelationshipSchemaVersion !== calibrationSet.relationshipEngine.schemaVersion
    || relationshipLineage.typedRelationshipPolicyVersion !== calibrationSet.relationshipEngine.policyVersion
    || relationshipLineage.typedRelationshipPolicySha256 !== calibrationSet.relationshipEngine.policySha256
    || relationshipLineage.typedRelationshipModel.modelId !== calibrationSet.relationshipEngine.modelId
    || relationshipLineage.typedRelationshipModel.modelVersion !== calibrationSet.relationshipEngine.modelVersion
    || relationshipLineage.typedRelationshipModelSha256 !== calibrationSet.relationshipEngine.modelSha256
    || relationshipCompletion.completionDigest !== manifest.lineage.relationshipRun.completionDigest
    || relationshipCompletion.universeRecordCount !== manifest.accounting.universeRecordCount
    || !sameJson(relationshipCompletion.addressKindCounts, manifest.accounting.addressKindCounts)
    || !sameJson(relationshipCompletion.addressKindCounts, universe.accounting.byKind)
    || !sameJson(relationshipCompletion.addressKindCounts, accounting.capturedByKind)
    || relationshipCompletion.candidatePairCount !== manifest.accounting.candidatePairCount
    || relationshipCompletion.typedEdgeCount !== manifest.accounting.typedEdgeCount
    || !sameJson(relationshipCompletion.typedEdgeTypeCounts, manifest.accounting.typedEdgeTypeCounts)
    || relationshipCompletion.skippedGroupCount !== manifest.accounting.skippedGroupReceiptCount
    || relationshipCompletion.skippedEstimatedPairCount !== manifest.accounting.skippedEstimatedPairCount
    || relationshipCompletion.linkedAddressCount !== manifest.accounting.relationshipStatusCounts.linked
    || relationshipCompletion.candidateOnlyAddressCount !== manifest.accounting.relationshipStatusCounts.candidate_only
    || relationshipCompletion.isolatedAddressCount !== manifest.accounting.relationshipStatusCounts.isolated) {
    throw new Error('case_graph_v2_relationship_completion_binding_mismatch');
  }
  if (universe.corpusVersion !== manifest.corpusVersion
    || universe.expected.snapshotId !== snapshot.snapshotId
    || universe.expected.snapshotPolicy !== snapshot.snapshotPolicy
    || universe.expected.capturePolicies.sighting !== snapshot.capturePolicy
    || universe.expected.snapshotAt !== snapshot.snapshotAt
    || universe.expected.materializedAt !== snapshot.materializedAt
    || universe.expected.sourceMvccSnapshot !== snapshot.sourceMvccSnapshot
    || universe.archiveVersion !== manifestUniverse.archiveVersion
    || universe.schemaVersion !== manifestUniverse.schemaVersion
    || universe.layoutVersion !== manifestUniverse.layoutVersion
    || universe.archiveSetSha256 !== manifestUniverse.archiveSetSha256
    || universe.expected.total !== manifestUniverse.recordCount
    || features.corpus_version !== manifest.corpusVersion
    || features.schema_version !== manifestFeatures.archiveSchemaVersion
    || features.expected.snapshot_id !== snapshot.snapshotId
    || features.expected.snapshot_policy !== snapshot.snapshotPolicy
    || features.expected.capture_policy !== snapshot.capturePolicy
    || features.expected.snapshot_at !== snapshot.snapshotAt
    || features.expected.materialized_at !== snapshot.materializedAt
    || features.expected.source_mvcc_snapshot !== snapshot.sourceMvccSnapshot
    || features.expected.publishability_policy !== manifest.models.publishabilityPolicy
    || features.binding.snapshot_id !== snapshot.snapshotId
    || features.binding.universe?.corpus_version !== manifest.corpusVersion
    || features.binding.universe?.archive_set_sha256 !== manifestUniverse.archiveSetSha256
    || features.archive_set_sha256 !== manifestFeatures.archiveSetSha256
    || features.exported_row_count !== manifestFeatures.recordCount
    || relationshipInput.binding.snapshotId !== snapshot.snapshotId
    || relationshipInput.binding.universeArchiveSetSha256 !== manifestUniverse.archiveSetSha256
    || relationshipInput.schemaVersion !== manifestRelationshipInput.schemaVersion
    || relationshipInput.canonicalVersion !== manifestRelationshipInput.canonicalVersion
    || relationshipInput.archiveSetSha256 !== manifestRelationshipInput.archiveSetSha256
    || relationshipInput.manifestDigest !== manifestRelationshipInput.manifestDigest
    || relationshipInput.rowCount !== manifestRelationshipInput.recordCount) {
    throw new Error('case_graph_v2_structural_lineage_receipt_mismatch');
  }
  if (accountingBinding.graphPublicationSha256 !== publicManifestSha256
    || accountingBinding.corpusVersion !== manifest.corpusVersion
    || accountingBinding.snapshotId !== manifest.lineage.snapshot.snapshotId
    || accountingBinding.universeArchiveVersion !== manifestUniverse.archiveVersion
    || accountingBinding.universeSchemaVersion !== manifestUniverse.schemaVersion
    || accountingBinding.universeLayoutVersion !== manifestUniverse.layoutVersion
    || accountingBinding.universeArchiveSetSha256 !== manifestUniverse.archiveSetSha256
    || accountingBinding.universeRecordCount !== manifestUniverse.recordCount
    || accountingBinding.relationshipInputSchemaVersion !== manifestRelationshipInput.schemaVersion
    || accountingBinding.relationshipInputArchiveSetSha256 !== manifestRelationshipInput.archiveSetSha256
    || accountingBinding.relationshipInputManifestDigest !== manifestRelationshipInput.manifestDigest
    || accountingBinding.relationshipInputRecordCount !== manifestRelationshipInput.recordCount
    || accountingBinding.policyVersion !== manifest.lineage.relationship.policyVersion
    || accounting.representedTotal !== manifestUniverse.recordCount
    || accounting.relationshipProcessedTotal !== manifestUniverse.recordCount
    || accounting.relationshipNotApplicableTotal !== 0
    || !sameKindCounts(accounting.capturedByKind, manifest.accountingBinding.graphAddressLedger.byKind)) {
    throw new Error('case_graph_v2_lineage_receipt_binding_mismatch');
  }
  const completion = deepFreeze({ ...input.completion });
  const frozenManifest = deepFreeze(manifest);
  const frozenAccounting = deepFreeze(accounting);
  return Object.freeze({
    [LINEAGE_BRAND]: true as const,
    completion,
    universe: deepFreeze(universe),
    features: deepFreeze(features),
    relationshipInput: deepFreeze(relationshipInput),
    relationshipCompletion: deepFreeze(relationshipCompletion),
    relationshipRunIndex: deepFreeze(relationshipRunIndex),
    relationshipRunIndexReceipt: deepFreeze(relationshipRunIndexReceipt),
    relationshipRunIndexPointer: deepFreeze(relationshipRunIndexPointer),
    contextualCompletion: deepFreeze(contextualCompletion),
    calibrationSet: deepFreeze(calibrationSet),
    pairCalibration: deepFreeze(verifiedCalibration.pairReceipt),
    contextualCalibration: deepFreeze(verifiedCalibration.contextualReceipt),
    pairCalibrationArtifact: deepFreeze(pairCalibrationArtifact),
    pairCalibrationTrustPolicy: deepFreeze(pairCalibrationTrustPolicy),
    contextualCalibrationArtifact: deepFreeze(contextualCalibrationArtifact),
    contextualCalibrationTrustPolicy: deepFreeze(contextualCalibrationTrustPolicy),
    manifest: frozenManifest,
    accounting: frozenAccounting,
    publicManifestSha256,
    accountingReceiptSha256,
    publicationCompletionSha256: sha256(input.completionBody),
  });
};

export const requireLineage = (value: CaseGraphV2LineageReceipts) => {
  if (!value || value[LINEAGE_BRAND] !== true || !Object.isFrozen(value)) {
    throw new Error('case_graph_v2_validated_lineage_receipts_required');
  }
  return value;
};
