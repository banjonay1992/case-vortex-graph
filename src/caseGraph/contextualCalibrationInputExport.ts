import { createHash } from 'node:crypto';

import type { CalibrationContextualCandidateInput } from './calibrationContextualCandidateSelection';
import {
  decodeContextualRelationshipCalibrationLineage,
  getContextualRelationshipCalibrationSampleId,
  type ContextualRelationshipCalibrationLineage,
} from './contextualRelationshipCalibration';
import {
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
} from './contextualExplanation';
import type {
  ContextualObservationArchiveCompletionManifest,
  ContextualObservationArchiveRecord,
  GovernedContextualSourceSnapshot,
} from './contextualObservationArchive';
import {
  CONTEXTUAL_SOURCE_FAMILIES,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
  type ContextualSourceFamily,
  type ContextualTargetRelationshipBinding,
} from './contextualSourceMaterializationCensus';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_CANDIDATE_POOL_EXPORT_VERSION =
  'case-vortex-contextual-candidate-pool-export-v1' as const;
export const CONTEXTUAL_SUBJECT_RECORD_EXPORT_VERSION =
  'case-vortex-contextual-subject-record-export-v1' as const;
export const CONTEXTUAL_EXPORT_RECEIPT_VERSION =
  'case-vortex-contextual-calibration-input-export-receipt-v1' as const;
export const CONTEXTUAL_ARCHIVE_RECEIPT_ATTESTATION_VERSION =
  'case-vortex-contextual-archive-receipt-attestation-v1' as const;
export const CONTEXTUAL_CANDIDATE_ORDER =
  'source_family_then_part_then_archive_sort_key_v1' as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: unknown, keys: readonly string[], code: string) => {
  const record = plain(value) ? value : invalid(code);
  const actual = Object.keys(record).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return record;
};
const digest = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value as string;
};
const count = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const safeSum = (values: readonly number[], code: string) => values.reduce((sum, value) => {
  const next = sum + value;
  if (!Number.isSafeInteger(next)) invalid(code);
  return next;
}, 0);
const text = (value: unknown, code: string, maximum = 2048): string => {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) invalid(code);
  return value as string;
};

export type ContextualArchiveExportPartReceipt = {
  partNumber: number;
  archiveKey: string;
  manifestKey: string;
  archiveBytes: number;
  archiveCanonicalSha256: string;
  manifestBytes: number;
  manifestCanonicalSha256: string;
  rowCount: number;
  recordSetSha256: string;
};

export type ContextualArchiveReceiptAttestation = {
  recordType: 'contextual_archive_operator_receipt_attestation';
  schemaVersion: typeof CONTEXTUAL_ARCHIVE_RECEIPT_ATTESTATION_VERSION;
  attestationId: string;
  operatorId: string;
  operatorKeyId: string;
  trustedRegistryDigest: string;
  attestedAt: string;
  receiptSha256: string;
  receiptCanonicalSha256: string;
  approvalSha256: string;
  executionAuthorizationSha256: string;
  targetBindingDigest: string;
  families: Array<{
    sourceFamily: ContextualSourceFamily;
    sourceSnapshotDigest: string;
    completionManifestDigest: string;
    archiveSetSha256: string;
    sourcePageCount: number;
    sourcePageSetSha256: string;
    sourceRowDigestSetSha256: string;
    coveredSubjectAddressSetSha256: string;
    verifiedRowCount: number;
  }>;
  signatureAlgorithm: 'ed25519';
  signatureBase64: string;
  attestationSha256: string;
};

export type ContextualArchiveExportSourceReceipt = {
  sourceFamily: ContextualSourceFamily;
  kind: 'aircraft' | 'satellite' | 'astronomy' | 'weather';
  snapshotDigest: string;
  snapshotCanonicalSha256: string;
  completionManifestDigest: string;
  completionCanonicalSha256: string;
  archiveSetSha256: string;
  sourcePageSetSha256: string;
  rowCount: number;
  emittedEdgeCount: number;
  insufficientEvidenceCount: number;
  parts: ContextualArchiveExportPartReceipt[];
};

export type ContextualCandidatePoolExportManifest = {
  recordType: 'contextual_candidate_pool_export_manifest';
  schemaVersion: typeof CONTEXTUAL_CANDIDATE_POOL_EXPORT_VERSION;
  purpose: 'unlabelled_contextual_calibration_candidate_pool_only';
  authorizationCeiling: 'no_labels_no_inference_no_evidence_credit';
  binding: RelationshipInputUniverseBinding;
  targetBinding: ContextualTargetRelationshipBinding;
  targetBindingDigest: string;
  targetBindingCanonicalSha256: string;
  lineageDigest: string;
  lineageCanonicalSha256: string;
  authority: {
    trustedRegistryDigest: string;
    censusDigest: string;
    censusCanonicalSha256: string;
    approvalSha256: string;
    approvalCanonicalSha256: string;
    executionAuthorizationSha256: string;
    executionAuthorizationCanonicalSha256: string;
    operatorReceiptSha256: string;
    operatorReceiptCanonicalSha256: string;
    operatorReceiptAttestationSha256: string;
    operatorReceiptAttestationCanonicalSha256: string;
  };
  candidateOrder: typeof CONTEXTUAL_CANDIDATE_ORDER;
  sources: ContextualArchiveExportSourceReceipt[];
  candidatePool: {
    canonicalSha256: string;
    byteLength: number;
    candidateCount: number;
    candidateSetSha256: string;
    subjectAddressSetSha256: string;
    subjectCount: number;
  };
  guarantees: {
    labelsCreated: 0;
    modelInferences: 0;
    providerCalls: 0;
    databaseReads: 0;
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    evidenceCredit: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  manifestDigest: string;
};

export type ContextualSubjectRecordExportManifest = {
  recordType: 'contextual_subject_record_export_manifest';
  schemaVersion: typeof CONTEXTUAL_SUBJECT_RECORD_EXPORT_VERSION;
  purpose: 'address_selective_subject_material_only';
  authorizationCeiling: 'no_labels_no_inference_no_evidence_credit';
  binding: RelationshipInputUniverseBinding;
  relationship: {
    completionDigest: string;
    completionCanonicalSha256: string;
    snapshotManifestDigest: string;
    snapshotManifestCanonicalSha256: string;
    archiveSetSha256: string;
    rowCount: number;
    partCount: number;
    scannedPartCount: number;
    scannedParts: Array<{
      partNumber: number;
      archiveCanonicalSha256: string;
      manifestCanonicalSha256: string;
    }>;
  };
  candidatePool: {
    manifestDigest: string;
    manifestCanonicalSha256: string;
    receiptDigest: string;
    receiptCanonicalSha256: string;
    canonicalSha256: string;
    candidateCount: number;
    subjectAddressSetSha256: string;
    subjectCount: number;
  };
  subjectRecords: {
    canonicalSha256: string;
    byteLength: number;
    recordSetSha256: string;
    recordCount: number;
  };
  guarantees: ContextualCandidatePoolExportManifest['guarantees'];
  manifestDigest: string;
};

export type ContextualCalibrationInputExportReceipt = {
  recordType: 'contextual_calibration_input_export_receipt';
  schemaVersion: typeof CONTEXTUAL_EXPORT_RECEIPT_VERSION;
  artifactType: 'candidate_pool' | 'subject_records';
  manifestDigest: string;
  manifestCanonicalSha256: string;
  outputCanonicalSha256: string;
  outputByteLength: number;
  outputItemCount: number;
  verified: true;
  guarantees: ContextualCandidatePoolExportManifest['guarantees'];
  receiptDigest: string;
};

export const zeroContextualExportGuarantees = (): ContextualCandidatePoolExportManifest['guarantees'] => ({
  labelsCreated: 0,
  modelInferences: 0,
  providerCalls: 0,
  databaseReads: 0,
  databaseWrites: 0,
  storageReads: 0,
  storageWrites: 0,
  lunaCalls: 0,
  evidenceCredit: 0,
  publicationMutations: 0,
  deployments: 0,
});

const normalizeArchivePartReceipt = (value: unknown, expectedPartNumber: number): ContextualArchiveExportPartReceipt => {
  const part = exact(value, [
    'partNumber', 'archiveKey', 'manifestKey', 'archiveBytes', 'archiveCanonicalSha256',
    'manifestBytes', 'manifestCanonicalSha256', 'rowCount', 'recordSetSha256',
  ], 'contextual_candidate_export_source_part_invalid');
  const partNumber = count(part.partNumber, 'contextual_candidate_export_source_part_invalid');
  if (partNumber !== expectedPartNumber) invalid('contextual_candidate_export_source_part_sequence_invalid');
  return {
    partNumber,
    archiveKey: text(part.archiveKey, 'contextual_candidate_export_source_part_invalid'),
    manifestKey: text(part.manifestKey, 'contextual_candidate_export_source_part_invalid'),
    archiveBytes: count(part.archiveBytes, 'contextual_candidate_export_source_part_invalid', 2),
    archiveCanonicalSha256: digest(part.archiveCanonicalSha256, 'contextual_candidate_export_source_part_invalid'),
    manifestBytes: count(part.manifestBytes, 'contextual_candidate_export_source_part_invalid', 2),
    manifestCanonicalSha256: digest(part.manifestCanonicalSha256, 'contextual_candidate_export_source_part_invalid'),
    rowCount: count(part.rowCount, 'contextual_candidate_export_source_part_invalid', 1),
    recordSetSha256: digest(part.recordSetSha256, 'contextual_candidate_export_source_part_invalid'),
  };
};

const normalizeArchiveSourceReceipt = (value: unknown): ContextualArchiveExportSourceReceipt => {
  const source = exact(value, [
    'sourceFamily', 'kind', 'snapshotDigest', 'snapshotCanonicalSha256',
    'completionManifestDigest', 'completionCanonicalSha256', 'archiveSetSha256',
    'sourcePageSetSha256', 'rowCount', 'emittedEdgeCount', 'insufficientEvidenceCount', 'parts',
  ], 'contextual_candidate_export_source_invalid');
  if (!CONTEXTUAL_SOURCE_FAMILIES.includes(source.sourceFamily as ContextualSourceFamily)
    || !Array.isArray(source.parts)) invalid('contextual_candidate_export_source_invalid');
  const sourceFamily = source.sourceFamily as ContextualSourceFamily;
  const expectedKind = ({
    aircraft_adsb_history: 'aircraft', satellite_tle_sgp4_history: 'satellite',
    astronomy_ephemeris_history: 'astronomy', weather_observation_history: 'weather',
  } as const)[sourceFamily];
  if (source.kind !== expectedKind) invalid('contextual_candidate_export_source_invalid');
  const parts = (source.parts as unknown[]).map(normalizeArchivePartReceipt);
  const rowCount = count(source.rowCount, 'contextual_candidate_export_source_invalid');
  const emittedEdgeCount = count(source.emittedEdgeCount, 'contextual_candidate_export_source_invalid');
  const insufficientEvidenceCount = count(source.insufficientEvidenceCount, 'contextual_candidate_export_source_invalid');
  if (safeSum(parts.map((part) => part.rowCount), 'contextual_candidate_export_count_overflow') !== rowCount
    || emittedEdgeCount + insufficientEvidenceCount !== rowCount) {
    invalid('contextual_candidate_export_source_accounting_mismatch');
  }
  return {
    sourceFamily,
    kind: expectedKind,
    snapshotDigest: digest(source.snapshotDigest, 'contextual_candidate_export_source_invalid'),
    snapshotCanonicalSha256: digest(source.snapshotCanonicalSha256, 'contextual_candidate_export_source_invalid'),
    completionManifestDigest: digest(source.completionManifestDigest, 'contextual_candidate_export_source_invalid'),
    completionCanonicalSha256: digest(source.completionCanonicalSha256, 'contextual_candidate_export_source_invalid'),
    archiveSetSha256: digest(source.archiveSetSha256, 'contextual_candidate_export_source_invalid'),
    sourcePageSetSha256: digest(source.sourcePageSetSha256, 'contextual_candidate_export_source_invalid'),
    rowCount,
    emittedEdgeCount,
    insufficientEvidenceCount,
    parts,
  };
};

export const decodeContextualExportTargetBinding = (value: unknown): ContextualTargetRelationshipBinding => {
  const body = exact(value, [
    'universe', 'relationshipInputSnapshotDigest', 'relationshipInputRecordSetSha256',
    'relationshipInputRecordCount', 'subjectCohortPolicyVersion', 'subjectCohortPolicyDigest',
    'subjectAddressSetSha256', 'subjectCount', 'requiredCoverageWindow',
  ], 'contextual_candidate_export_target_binding_invalid');
  const universe = validateRelationshipInputBinding(body.universe);
  const window = exact(body.requiredCoverageWindow, ['start', 'end'], 'contextual_candidate_export_target_binding_invalid');
  const start: string = typeof window.start === 'string' ? window.start : invalid('contextual_candidate_export_target_binding_invalid');
  const end: string = typeof window.end === 'string' ? window.end : invalid('contextual_candidate_export_target_binding_invalid');
  if (new Date(start).toISOString() !== start || new Date(end).toISOString() !== end || start > end) {
    invalid('contextual_candidate_export_target_binding_invalid');
  }
  const relationshipInputRecordCount = count(body.relationshipInputRecordCount, 'contextual_candidate_export_target_binding_invalid', 1);
  const subjectCount = count(body.subjectCount, 'contextual_candidate_export_target_binding_invalid', 1);
  if (relationshipInputRecordCount !== universe.universeRecordCount || subjectCount > relationshipInputRecordCount
    || body.subjectCohortPolicyVersion !== CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION
    || body.subjectCohortPolicyDigest !== CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST) {
    invalid('contextual_candidate_export_target_binding_mismatch');
  }
  return {
    universe,
    relationshipInputSnapshotDigest: digest(body.relationshipInputSnapshotDigest, 'contextual_candidate_export_target_binding_invalid'),
    relationshipInputRecordSetSha256: digest(body.relationshipInputRecordSetSha256, 'contextual_candidate_export_target_binding_invalid'),
    relationshipInputRecordCount,
    subjectCohortPolicyVersion: CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
    subjectCohortPolicyDigest: CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
    subjectAddressSetSha256: digest(body.subjectAddressSetSha256, 'contextual_candidate_export_target_binding_invalid'),
    subjectCount,
    requiredCoverageWindow: { start, end },
  };
};

export const contextualCandidateFromArchiveRecord = (params: {
  record: ContextualObservationArchiveRecord;
  snapshot: GovernedContextualSourceSnapshot;
  lineage: ContextualRelationshipCalibrationLineage;
}): CalibrationContextualCandidateInput => {
  const lineage = decodeContextualRelationshipCalibrationLineage(params.lineage);
  const source = lineage.sourceArchives.find(({ sourceSnapshotDigest }) => (
    sourceSnapshotDigest === params.snapshot.snapshotDigest
  ));
  if (!source || source.kind !== params.snapshot.kind || params.record.sourceSnapshotDigest !== source.sourceSnapshotDigest) {
    invalid('contextual_candidate_export_source_lineage_mismatch');
  }
  const candidate = {
    kind: params.record.payload.kind,
    subjectAddress: params.record.payload.address,
    reference: params.record.payload.reference,
    subjectObservation: params.record.payload.subjectObservation,
    referenceObservation: params.record.payload.referenceObservation,
    provenance: params.record.payload.provenance,
    domainEvidence: params.record.payload.domainEvidence,
    missingness: params.record.payload.missingness,
    uncertainty: params.record.result.sourceFact.uncertainty,
    model: params.record.payload.model,
  } as CalibrationContextualCandidateInput['candidate'];
  const evaluation = evaluateContextualExplanationCandidate(candidate);
  if (canonicalizeContextualExplanation(evaluation)
    !== canonicalizeContextualExplanation(params.record.result.evaluation)) {
    invalid('contextual_candidate_export_evaluation_mismatch');
  }
  return {
    sampleId: getContextualRelationshipCalibrationSampleId({
      candidate,
      sourceSnapshotDigest: params.snapshot.snapshotDigest,
      observationArchiveRecordDigest: params.record.recordDigest,
    }),
    evaluationDigest: contextualExplanationSha256(evaluation),
    candidate,
    evaluation,
    sourceSnapshotDigest: params.snapshot.snapshotDigest,
    observationArchiveRecordDigest: params.record.recordDigest,
  };
};

export const buildContextualCandidatePoolExportManifest = (params: Omit<
  ContextualCandidatePoolExportManifest,
  'recordType' | 'schemaVersion' | 'purpose' | 'authorizationCeiling' | 'candidateOrder' | 'guarantees' | 'manifestDigest'
>): ContextualCandidatePoolExportManifest => {
  const binding = validateRelationshipInputBinding(params.binding);
  const sources = params.sources.map(normalizeArchiveSourceReceipt).sort((left, right) => (
    CONTEXTUAL_SOURCE_FAMILIES.indexOf(left.sourceFamily) - CONTEXTUAL_SOURCE_FAMILIES.indexOf(right.sourceFamily)
  ));
  if (sources.length !== 4 || sources.some((source, index) => source.sourceFamily !== CONTEXTUAL_SOURCE_FAMILIES[index])) {
    invalid('contextual_candidate_export_source_coverage_invalid');
  }
  for (const field of ['snapshotDigest', 'completionManifestDigest', 'archiveSetSha256'] as const) {
    if (new Set(sources.map((source) => source[field])).size !== sources.length) {
      invalid('contextual_candidate_export_source_digest_duplicate');
    }
  }
  const targetBinding = decodeContextualExportTargetBinding(params.targetBinding);
  if (!same(binding, targetBinding.universe)
    || params.targetBindingDigest !== relationshipInputSha256(targetBinding)) {
    invalid('contextual_candidate_export_target_binding_mismatch');
  }
  const authorityInput = exact(params.authority, [
    'trustedRegistryDigest', 'censusDigest', 'censusCanonicalSha256', 'approvalSha256',
    'approvalCanonicalSha256', 'executionAuthorizationSha256',
    'executionAuthorizationCanonicalSha256', 'operatorReceiptSha256',
    'operatorReceiptCanonicalSha256', 'operatorReceiptAttestationSha256',
    'operatorReceiptAttestationCanonicalSha256',
  ], 'contextual_candidate_export_authority_invalid');
  const authority: ContextualCandidatePoolExportManifest['authority'] = {
    trustedRegistryDigest: digest(authorityInput.trustedRegistryDigest, 'contextual_candidate_export_authority_invalid'),
    censusDigest: digest(authorityInput.censusDigest, 'contextual_candidate_export_authority_invalid'),
    censusCanonicalSha256: digest(authorityInput.censusCanonicalSha256, 'contextual_candidate_export_authority_invalid'),
    approvalSha256: digest(authorityInput.approvalSha256, 'contextual_candidate_export_authority_invalid'),
    approvalCanonicalSha256: digest(authorityInput.approvalCanonicalSha256, 'contextual_candidate_export_authority_invalid'),
    executionAuthorizationSha256: digest(authorityInput.executionAuthorizationSha256, 'contextual_candidate_export_authority_invalid'),
    executionAuthorizationCanonicalSha256: digest(authorityInput.executionAuthorizationCanonicalSha256, 'contextual_candidate_export_authority_invalid'),
    operatorReceiptSha256: digest(authorityInput.operatorReceiptSha256, 'contextual_candidate_export_authority_invalid'),
    operatorReceiptCanonicalSha256: digest(authorityInput.operatorReceiptCanonicalSha256, 'contextual_candidate_export_authority_invalid'),
    operatorReceiptAttestationSha256: digest(authorityInput.operatorReceiptAttestationSha256, 'contextual_candidate_export_authority_invalid'),
    operatorReceiptAttestationCanonicalSha256: digest(authorityInput.operatorReceiptAttestationCanonicalSha256, 'contextual_candidate_export_authority_invalid'),
  };
  const body: Omit<ContextualCandidatePoolExportManifest, 'manifestDigest'> = {
    recordType: 'contextual_candidate_pool_export_manifest',
    schemaVersion: CONTEXTUAL_CANDIDATE_POOL_EXPORT_VERSION,
    purpose: 'unlabelled_contextual_calibration_candidate_pool_only',
    authorizationCeiling: 'no_labels_no_inference_no_evidence_credit',
    binding,
    targetBinding,
    targetBindingDigest: digest(params.targetBindingDigest, 'contextual_candidate_export_manifest_invalid'),
    targetBindingCanonicalSha256: digest(params.targetBindingCanonicalSha256, 'contextual_candidate_export_manifest_invalid'),
    lineageDigest: digest(params.lineageDigest, 'contextual_candidate_export_manifest_invalid'),
    lineageCanonicalSha256: digest(params.lineageCanonicalSha256, 'contextual_candidate_export_manifest_invalid'),
    authority,
    candidateOrder: CONTEXTUAL_CANDIDATE_ORDER,
    sources,
    candidatePool: {
      canonicalSha256: digest(params.candidatePool.canonicalSha256, 'contextual_candidate_export_manifest_invalid'),
      byteLength: count(params.candidatePool.byteLength, 'contextual_candidate_export_manifest_invalid', 3),
      candidateCount: count(params.candidatePool.candidateCount, 'contextual_candidate_export_manifest_invalid'),
      candidateSetSha256: digest(params.candidatePool.candidateSetSha256, 'contextual_candidate_export_manifest_invalid'),
      subjectAddressSetSha256: digest(params.candidatePool.subjectAddressSetSha256, 'contextual_candidate_export_manifest_invalid'),
      subjectCount: count(params.candidatePool.subjectCount, 'contextual_candidate_export_manifest_invalid'),
    },
    guarantees: zeroContextualExportGuarantees(),
  };
  if (safeSum(sources.map(({ rowCount }) => rowCount), 'contextual_candidate_export_count_overflow')
    !== body.candidatePool.candidateCount || body.candidatePool.subjectCount > body.candidatePool.candidateCount
    || body.candidatePool.subjectCount !== targetBinding.subjectCount
    || body.candidatePool.subjectAddressSetSha256 !== targetBinding.subjectAddressSetSha256) {
    invalid('contextual_candidate_export_accounting_mismatch');
  }
  return { ...body, manifestDigest: relationshipInputSha256(body) };
};

export const buildContextualSubjectRecordExportManifest = (params: Omit<
  ContextualSubjectRecordExportManifest,
  'recordType' | 'schemaVersion' | 'purpose' | 'authorizationCeiling' | 'guarantees' | 'manifestDigest'
>): ContextualSubjectRecordExportManifest => {
  const binding = validateRelationshipInputBinding(params.binding);
  const relationshipInput = exact(params.relationship, [
    'completionDigest', 'completionCanonicalSha256', 'snapshotManifestDigest',
    'snapshotManifestCanonicalSha256', 'archiveSetSha256', 'rowCount', 'partCount',
    'scannedPartCount', 'scannedParts',
  ], 'contextual_subject_export_relationship_invalid');
  if (!Array.isArray(relationshipInput.scannedParts)) invalid('contextual_subject_export_relationship_invalid');
  const scannedParts = (relationshipInput.scannedParts as unknown[]).map((value, index) => {
    const part = exact(value, [
      'partNumber', 'archiveCanonicalSha256', 'manifestCanonicalSha256',
    ], 'contextual_subject_export_relationship_part_invalid');
    const partNumber = count(part.partNumber, 'contextual_subject_export_relationship_part_invalid');
    if (partNumber !== index) invalid('contextual_subject_export_relationship_part_sequence_invalid');
    return {
      partNumber,
      archiveCanonicalSha256: digest(part.archiveCanonicalSha256, 'contextual_subject_export_relationship_part_invalid'),
      manifestCanonicalSha256: digest(part.manifestCanonicalSha256, 'contextual_subject_export_relationship_part_invalid'),
    };
  });
  const relationship: ContextualSubjectRecordExportManifest['relationship'] = {
    completionDigest: digest(relationshipInput.completionDigest, 'contextual_subject_export_relationship_invalid'),
    completionCanonicalSha256: digest(relationshipInput.completionCanonicalSha256, 'contextual_subject_export_relationship_invalid'),
    snapshotManifestDigest: digest(relationshipInput.snapshotManifestDigest, 'contextual_subject_export_relationship_invalid'),
    snapshotManifestCanonicalSha256: digest(relationshipInput.snapshotManifestCanonicalSha256, 'contextual_subject_export_relationship_invalid'),
    archiveSetSha256: digest(relationshipInput.archiveSetSha256, 'contextual_subject_export_relationship_invalid'),
    rowCount: count(relationshipInput.rowCount, 'contextual_subject_export_relationship_invalid', 1),
    partCount: count(relationshipInput.partCount, 'contextual_subject_export_relationship_invalid', 1),
    scannedPartCount: count(relationshipInput.scannedPartCount, 'contextual_subject_export_relationship_invalid', 1),
    scannedParts,
  };
  if (relationship.scannedPartCount !== scannedParts.length
    || relationship.scannedPartCount !== relationship.partCount) {
    invalid('contextual_subject_export_relationship_accounting_mismatch');
  }
  const poolInput = exact(params.candidatePool, [
    'manifestDigest', 'manifestCanonicalSha256', 'receiptDigest', 'receiptCanonicalSha256',
    'canonicalSha256', 'candidateCount', 'subjectAddressSetSha256', 'subjectCount',
  ], 'contextual_subject_export_pool_invalid');
  const candidatePool: ContextualSubjectRecordExportManifest['candidatePool'] = {
    manifestDigest: digest(poolInput.manifestDigest, 'contextual_subject_export_pool_invalid'),
    manifestCanonicalSha256: digest(poolInput.manifestCanonicalSha256, 'contextual_subject_export_pool_invalid'),
    receiptDigest: digest(poolInput.receiptDigest, 'contextual_subject_export_pool_invalid'),
    receiptCanonicalSha256: digest(poolInput.receiptCanonicalSha256, 'contextual_subject_export_pool_invalid'),
    canonicalSha256: digest(poolInput.canonicalSha256, 'contextual_subject_export_pool_invalid'),
    candidateCount: count(poolInput.candidateCount, 'contextual_subject_export_pool_invalid'),
    subjectAddressSetSha256: digest(poolInput.subjectAddressSetSha256, 'contextual_subject_export_pool_invalid'),
    subjectCount: count(poolInput.subjectCount, 'contextual_subject_export_pool_invalid'),
  };
  const subjectsInput = exact(params.subjectRecords, [
    'canonicalSha256', 'byteLength', 'recordSetSha256', 'recordCount',
  ], 'contextual_subject_export_output_invalid');
  const subjectRecords: ContextualSubjectRecordExportManifest['subjectRecords'] = {
    canonicalSha256: digest(subjectsInput.canonicalSha256, 'contextual_subject_export_output_invalid'),
    byteLength: count(subjectsInput.byteLength, 'contextual_subject_export_output_invalid', 3),
    recordSetSha256: digest(subjectsInput.recordSetSha256, 'contextual_subject_export_output_invalid'),
    recordCount: count(subjectsInput.recordCount, 'contextual_subject_export_output_invalid'),
  };
  const body: Omit<ContextualSubjectRecordExportManifest, 'manifestDigest'> = {
    recordType: 'contextual_subject_record_export_manifest',
    schemaVersion: CONTEXTUAL_SUBJECT_RECORD_EXPORT_VERSION,
    purpose: 'address_selective_subject_material_only',
    authorizationCeiling: 'no_labels_no_inference_no_evidence_credit',
    binding,
    relationship,
    candidatePool,
    subjectRecords,
    guarantees: zeroContextualExportGuarantees(),
  };
  if (body.subjectRecords.recordCount !== body.candidatePool.subjectCount
    || body.candidatePool.subjectCount > body.candidatePool.candidateCount
    || body.relationship.rowCount !== binding.universeRecordCount
    || body.subjectRecords.byteLength >= 64 * 1024 * 1024) {
    invalid('contextual_subject_export_accounting_mismatch');
  }
  return { ...body, manifestDigest: relationshipInputSha256(body) };
};

export const buildContextualCalibrationInputExportReceipt = (params: Omit<
  ContextualCalibrationInputExportReceipt,
  'recordType' | 'schemaVersion' | 'verified' | 'guarantees' | 'receiptDigest'
>): ContextualCalibrationInputExportReceipt => {
  const body: Omit<ContextualCalibrationInputExportReceipt, 'receiptDigest'> = {
    recordType: 'contextual_calibration_input_export_receipt',
    schemaVersion: CONTEXTUAL_EXPORT_RECEIPT_VERSION,
    artifactType: params.artifactType,
    manifestDigest: digest(params.manifestDigest, 'contextual_export_receipt_invalid'),
    manifestCanonicalSha256: digest(params.manifestCanonicalSha256, 'contextual_export_receipt_invalid'),
    outputCanonicalSha256: digest(params.outputCanonicalSha256, 'contextual_export_receipt_invalid'),
    outputByteLength: count(params.outputByteLength, 'contextual_export_receipt_invalid', 3),
    outputItemCount: count(params.outputItemCount, 'contextual_export_receipt_invalid'),
    verified: true,
    guarantees: zeroContextualExportGuarantees(),
  };
  return { ...body, receiptDigest: relationshipInputSha256(body) };
};

export const decodeContextualCandidatePoolExportManifest = (value: unknown) => {
  const body = exact(value, [
    'recordType', 'schemaVersion', 'purpose', 'authorizationCeiling', 'binding', 'targetBinding',
    'targetBindingDigest', 'targetBindingCanonicalSha256', 'lineageDigest',
    'lineageCanonicalSha256', 'authority', 'candidateOrder', 'sources', 'candidatePool',
    'guarantees', 'manifestDigest',
  ], 'contextual_candidate_export_manifest_invalid');
  if (body.recordType !== 'contextual_candidate_pool_export_manifest'
    || body.schemaVersion !== CONTEXTUAL_CANDIDATE_POOL_EXPORT_VERSION
    || body.purpose !== 'unlabelled_contextual_calibration_candidate_pool_only'
    || body.authorizationCeiling !== 'no_labels_no_inference_no_evidence_credit'
    || body.candidateOrder !== CONTEXTUAL_CANDIDATE_ORDER || !Array.isArray(body.sources)) {
    invalid('contextual_candidate_export_manifest_invalid');
  }
  const rebuilt = buildContextualCandidatePoolExportManifest({
    binding: body.binding as RelationshipInputUniverseBinding,
    targetBinding: body.targetBinding as ContextualTargetRelationshipBinding,
    targetBindingDigest: body.targetBindingDigest as string,
    targetBindingCanonicalSha256: body.targetBindingCanonicalSha256 as string,
    lineageDigest: body.lineageDigest as string,
    lineageCanonicalSha256: body.lineageCanonicalSha256 as string,
    authority: body.authority as ContextualCandidatePoolExportManifest['authority'],
    sources: body.sources as ContextualArchiveExportSourceReceipt[],
    candidatePool: body.candidatePool as ContextualCandidatePoolExportManifest['candidatePool'],
  });
  if (!same(body.guarantees, zeroContextualExportGuarantees()) || !same(body, rebuilt)) {
    invalid('contextual_candidate_export_manifest_digest_mismatch');
  }
  return rebuilt;
};

export const decodeContextualSubjectRecordExportManifest = (value: unknown) => {
  const body = exact(value, [
    'recordType', 'schemaVersion', 'purpose', 'authorizationCeiling', 'binding',
    'relationship', 'candidatePool', 'subjectRecords', 'guarantees', 'manifestDigest',
  ], 'contextual_subject_export_manifest_invalid');
  if (body.recordType !== 'contextual_subject_record_export_manifest'
    || body.schemaVersion !== CONTEXTUAL_SUBJECT_RECORD_EXPORT_VERSION
    || body.purpose !== 'address_selective_subject_material_only'
    || body.authorizationCeiling !== 'no_labels_no_inference_no_evidence_credit') {
    invalid('contextual_subject_export_manifest_invalid');
  }
  const rebuilt = buildContextualSubjectRecordExportManifest({
    binding: body.binding as RelationshipInputUniverseBinding,
    relationship: body.relationship as ContextualSubjectRecordExportManifest['relationship'],
    candidatePool: body.candidatePool as ContextualSubjectRecordExportManifest['candidatePool'],
    subjectRecords: body.subjectRecords as ContextualSubjectRecordExportManifest['subjectRecords'],
  });
  if (!same(body.guarantees, zeroContextualExportGuarantees()) || !same(body, rebuilt)) {
    invalid('contextual_subject_export_manifest_digest_mismatch');
  }
  return rebuilt;
};

export const decodeContextualCalibrationInputExportReceipt = (value: unknown) => {
  const body = exact(value, [
    'recordType', 'schemaVersion', 'artifactType', 'manifestDigest', 'manifestCanonicalSha256',
    'outputCanonicalSha256', 'outputByteLength', 'outputItemCount', 'verified', 'guarantees',
    'receiptDigest',
  ], 'contextual_export_receipt_invalid');
  if (body.recordType !== 'contextual_calibration_input_export_receipt'
    || body.schemaVersion !== CONTEXTUAL_EXPORT_RECEIPT_VERSION
    || !['candidate_pool', 'subject_records'].includes(String(body.artifactType))
    || body.verified !== true || !same(body.guarantees, zeroContextualExportGuarantees())) {
    invalid('contextual_export_receipt_invalid');
  }
  const rebuilt = buildContextualCalibrationInputExportReceipt({
    artifactType: body.artifactType as ContextualCalibrationInputExportReceipt['artifactType'],
    manifestDigest: body.manifestDigest as string,
    manifestCanonicalSha256: body.manifestCanonicalSha256 as string,
    outputCanonicalSha256: body.outputCanonicalSha256 as string,
    outputByteLength: body.outputByteLength as number,
    outputItemCount: body.outputItemCount as number,
  });
  if (!same(body, rebuilt)) invalid('contextual_export_receipt_digest_mismatch');
  return rebuilt;
};

export const contextualCandidateSetSha256 = (sampleIds: readonly string[]) => (
  relationshipInputSha256([...sampleIds].sort(compare))
);
export const contextualSubjectAddressSetSha256 = (addresses: readonly string[]) => (
  relationshipInputSha256([...new Set(addresses.map(validateRelationshipInputAddress))].sort(compare))
);
export const contextualSubjectRecordSetSha256 = (records: readonly RelationshipInputRecord[]) => (
  relationshipInputSha256(records.map(({ address, recordDigest }) => `${address}:${recordDigest}`).join('\n'))
);
export const rawSha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
export const canonicalContextualExportBody = (value: unknown) => Buffer.from(
  `${canonicalizeContextualExplanation(value)}\n`, 'utf8',
);
export const canonicalRelationshipExportBody = (value: unknown) => Buffer.from(
  `${canonicalizeRelationshipInput(value)}\n`, 'utf8',
);
