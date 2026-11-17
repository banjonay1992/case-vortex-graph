import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  type ContextualExplanationKind,
  type ContextualExplanationReceipt,
  type ContextualPolicyCheck,
} from './contextualExplanation';
import {
  CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
  decodeContextualObservationArchiveCompletionManifest,
  decodeContextualObservationArchiveRecord,
  decodeGovernedContextualSourceSnapshot,
  type ContextualObservationArchiveCompletionManifest,
  type ContextualObservationArchiveRecord,
  type GovernedContextualSourceSnapshot,
} from './contextualObservationArchive';
import {
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  decodeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationReceipt,
} from './contextualRelationshipCalibration';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  assertRelationshipInputBinding,
  decodeRelationshipInputRecord,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  decodeTypedRelationshipEdge,
  evaluateTypedContextualRelationships,
  type TypedRelationshipEdge,
} from './typedRelationshipEngine';

export const CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION = 'case-graph-contextual-relationship-completion-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_INSUFFICIENT_RECEIPT_VERSION = 'case-graph-contextual-insufficient-receipt-v1' as const;

const KINDS = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;
type Kind = typeof KINDS[number];

export const CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY = Object.freeze({
  contextualPolicyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  contextualPolicySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  typedRelationshipSchemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
  typedRelationshipPolicyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
  typedRelationshipPolicySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
  typedRelationshipModel: TYPED_RELATIONSHIP_MODEL,
  typedRelationshipModelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
});
export const CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256 = contextualExplanationSha256(
  CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY,
);

export type ContextualRelationshipSourceCompletionReceipt = {
  snapshot: GovernedContextualSourceSnapshot;
  observationArchiveVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION;
  completionManifest: ContextualObservationArchiveCompletionManifest;
  completionManifestDigest: string;
  archiveSetSha256: string;
  sourcePageSetSha256: string;
  rowCount: number;
  emittedEdgeCount: number;
  insufficientEvidenceCount: number;
  completedAt: string;
  sourceCompletionDigest: string;
};

export type ContextualRelationshipInsufficientReceipt = {
  recordType: 'contextual_relationship_insufficient_receipt';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_INSUFFICIENT_RECEIPT_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  receiptId: string;
  binding: RelationshipInputUniverseBinding;
  address: string;
  relationshipRecordDigest: string;
  observationArchiveRecordDigest: string;
  sourceSnapshotDigest: string;
  adapterReceiptSha256: string;
  governedPayloadDigest: string;
  contextualEvaluation: ContextualExplanationReceipt;
  decision: 'insufficient_evidence';
  claimDiscipline: typeof CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE;
  receiptSha256: string;
};

type EntryBase = {
  recordType: 'contextual_relationship_completion_entry';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  entryId: string;
  address: string;
  relationshipRecordDigest: string;
  observationArchiveRecordDigest: string;
  sourceSnapshotDigest: string;
  adapterReceiptSha256: string;
  governedPayloadDigest: string;
};

type ContextualRelationshipAcceptedCompletionEntry = EntryBase & {
  status: 'accepted_edge';
  typedEdge: TypedRelationshipEdge;
  insufficientReceipt: null;
};

type ContextualRelationshipInsufficientCompletionEntry = EntryBase & {
  status: 'insufficient_evidence';
  typedEdge: null;
  insufficientReceipt: ContextualRelationshipInsufficientReceipt;
};

type ContextualRelationshipCompletionEntryWithoutDigest =
  | ContextualRelationshipAcceptedCompletionEntry
  | ContextualRelationshipInsufficientCompletionEntry;

export type ContextualRelationshipCompletionEntry = ContextualRelationshipCompletionEntryWithoutDigest & {
  entryDigest: string;
};

export type ContextualRelationshipCompletionAccounting = {
  sourceSnapshotCount: number;
  sourceKindCount: 4;
  sourceRecordCount: number;
  acceptedEdgeCount: number;
  insufficientEvidenceCount: number;
  uniqueAddressCount: number;
  addressStatusCounts: {
    accepted_only: number;
    insufficient_only: number;
    mixed: number;
  };
  sourceKindCounts: Record<Kind, {
    sourceSnapshotCount: number;
    sourceRecordCount: number;
    acceptedEdgeCount: number;
    insufficientEvidenceCount: number;
  }>;
};

export type ContextualRelationshipCompletionArtifact = {
  recordType: 'contextual_relationship_completion_artifact';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  completionId: string;
  status: 'unvalidated_local_demo' | 'production_eligible_complete';
  binding: RelationshipInputUniverseBinding;
  calibrationReceipt: ContextualRelationshipCalibrationReceipt;
  sources: ContextualRelationshipSourceCompletionReceipt[];
  sourceCompletionSetSha256: string;
  contextualIdentity: typeof CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY;
  contextualIdentitySha256: string;
  entries: ContextualRelationshipCompletionEntry[];
  entrySetSha256: string;
  accounting: ContextualRelationshipCompletionAccounting;
  zeroObservationState: boolean;
  completionDigest: string;
};

export type ContextualRelationshipCompletionEntryInput = {
  sourceSnapshotDigest: string;
  archiveRecord: ContextualObservationArchiveRecord;
  relationshipRecord: RelationshipInputRecord;
};

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function invalid(code: string): never { throw new Error(code); }
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!plain(value)) invalid(code);
  const actual = Object.keys(value).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};
const reqSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value;
};
const reqId = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !ID.test(value)) invalid(code);
  return value;
};
const reqFinite = (value: unknown, code: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(code);
  return Object.is(value, -0) ? 0 : value;
};

const parse = (input: unknown, jsonCode: string) => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try { value = JSON.parse(String(input)); } catch { invalid(jsonCode); }
  }
  return value;
};

const contextualReceiptWithoutId = (
  receipt: Omit<ContextualExplanationReceipt, 'receiptId'>,
) => receipt;

const normalizeContextualEvaluationReceipt = (
  value: unknown,
  expectedDecision: ContextualExplanationReceipt['decision'],
  expectedAddress: string,
  expectedKind: ContextualExplanationKind,
): ContextualExplanationReceipt => {
  const receipt = exact(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'receiptId', 'decision', 'kind',
    'subjectAddress', 'contextReferenceId', 'inputSha256', 'observationSha256',
    'provenanceSetSha256', 'matchingEvidenceSetSha256', 'policyVersion', 'policySha256',
    'model', 'checks', 'failedChecks', 'missingness', 'claimDiscipline', 'plainEnglish',
  ], 'contextual_completion_evaluation_invalid');
  if (receipt.recordType !== 'contextual_explanation_evaluation'
    || receipt.schemaVersion !== CONTEXTUAL_EXPLANATION_SCHEMA_VERSION
    || receipt.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || receipt.decision !== expectedDecision
    || receipt.kind !== expectedKind
    || receipt.subjectAddress !== expectedAddress
    || receipt.policyVersion !== CONTEXTUAL_EXPLANATION_POLICY_VERSION
    || receipt.policySha256 !== CONTEXTUAL_EXPLANATION_POLICY_SHA256
    || !Array.isArray(receipt.checks)
    || !Array.isArray(receipt.failedChecks)
    || !Array.isArray(receipt.missingness)
    || typeof receipt.plainEnglish !== 'string'
    || !receipt.plainEnglish.length
    || canonicalizeContextualExplanation(receipt.claimDiscipline)
      !== canonicalizeContextualExplanation(CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE)) {
    invalid('contextual_completion_evaluation_invalid');
  }
  const address = validateRelationshipInputAddress(receipt.subjectAddress);
  const contextReferenceId = reqId(receipt.contextReferenceId, 'contextual_completion_evaluation_invalid');
  const model = exact(receipt.model, [
    'modelId', 'modelVersion', 'method', 'inputSha256', 'outputSha256',
  ], 'contextual_completion_evaluation_model_invalid');
  if (!['deterministic', 'governed_model'].includes(String(model.method))) {
    invalid('contextual_completion_evaluation_model_invalid');
  }
  const normalizedModel: ContextualExplanationReceipt['model'] = {
    modelId: reqId(model.modelId, 'contextual_completion_evaluation_model_invalid'),
    modelVersion: reqId(model.modelVersion, 'contextual_completion_evaluation_model_invalid'),
    method: model.method as ContextualExplanationReceipt['model']['method'],
    inputSha256: reqSha(model.inputSha256, 'contextual_completion_evaluation_model_invalid'),
    outputSha256: reqSha(model.outputSha256, 'contextual_completion_evaluation_model_invalid'),
  };
  const checks = receipt.checks.map((raw): ContextualPolicyCheck => {
    const check = exact(raw, [
      'code', 'status', 'actual', 'operator', 'threshold', 'unit', 'evidenceIds',
    ], 'contextual_completion_evaluation_check_invalid');
    if (!['pass', 'fail'].includes(String(check.status))
      || !['less_than_or_equal', 'greater_than_or_equal'].includes(String(check.operator))
      || !['seconds', 'kilometres', 'degrees', 'hours', 'ratio', 'count', 'rank'].includes(String(check.unit))
      || !Array.isArray(check.evidenceIds)) {
      invalid('contextual_completion_evaluation_check_invalid');
    }
    const actual = reqFinite(check.actual, 'contextual_completion_evaluation_check_invalid');
    const threshold = reqFinite(check.threshold, 'contextual_completion_evaluation_check_invalid');
    const operator = check.operator as ContextualPolicyCheck['operator'];
    const expectedStatus = operator === 'less_than_or_equal'
      ? actual <= threshold ? 'pass' : 'fail'
      : actual >= threshold ? 'pass' : 'fail';
    if (check.status !== expectedStatus) invalid('contextual_completion_evaluation_check_status_mismatch');
    const evidenceIds = check.evidenceIds.map((id) => reqId(
      id,
      'contextual_completion_evaluation_check_invalid',
    )).sort(compare);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      invalid('contextual_completion_evaluation_check_invalid');
    }
    return {
      code: reqId(check.code, 'contextual_completion_evaluation_check_invalid'),
      status: expectedStatus,
      actual,
      operator,
      threshold,
      unit: check.unit as ContextualPolicyCheck['unit'],
      evidenceIds,
    };
  }).sort((left, right) => compare(left.code, right.code));
  if (new Set(checks.map((check) => check.code)).size !== checks.length) {
    invalid('contextual_completion_evaluation_duplicate_check');
  }
  const failedChecks = receipt.failedChecks.map((code) => reqId(
    code,
    'contextual_completion_evaluation_failed_checks_invalid',
  )).sort(compare);
  const computedFailedChecks = checks.filter((check) => check.status === 'fail').map((check) => check.code);
  if (new Set(failedChecks).size !== failedChecks.length
    || canonicalizeContextualExplanation(failedChecks) !== canonicalizeContextualExplanation(computedFailedChecks)
    || expectedDecision !== (computedFailedChecks.length ? 'insufficient_evidence' : 'emit_candidate_edge')) {
    invalid('contextual_completion_evaluation_failed_checks_invalid');
  }
  const missingness = receipt.missingness.map((raw) => {
    const item = exact(raw, ['field', 'status', 'reason'], 'contextual_completion_evaluation_missingness_invalid');
    if (!['unknown', 'not_recorded', 'unavailable', 'withheld', 'not_applicable'].includes(String(item.status))) {
      invalid('contextual_completion_evaluation_missingness_invalid');
    }
    return {
      field: reqId(item.field, 'contextual_completion_evaluation_missingness_invalid'),
      status: item.status as ContextualExplanationReceipt['missingness'][number]['status'],
      reason: reqId(item.reason, 'contextual_completion_evaluation_missingness_invalid'),
    };
  }).sort((left, right) => compare(left.field, right.field)
    || compare(left.status, right.status) || compare(left.reason, right.reason));
  if (new Set(missingness.map((item) => item.field)).size !== missingness.length) {
    invalid('contextual_completion_evaluation_missingness_invalid');
  }
  const withoutId: Omit<ContextualExplanationReceipt, 'receiptId'> = {
    recordType: 'contextual_explanation_evaluation',
    schemaVersion: CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    decision: expectedDecision,
    kind: expectedKind,
    subjectAddress: address,
    contextReferenceId,
    inputSha256: reqSha(receipt.inputSha256, 'contextual_completion_evaluation_invalid'),
    observationSha256: reqSha(receipt.observationSha256, 'contextual_completion_evaluation_invalid'),
    provenanceSetSha256: reqSha(receipt.provenanceSetSha256, 'contextual_completion_evaluation_invalid'),
    matchingEvidenceSetSha256: reqSha(receipt.matchingEvidenceSetSha256, 'contextual_completion_evaluation_invalid'),
    policyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
    policySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
    model: normalizedModel,
    checks,
    failedChecks,
    missingness,
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
    plainEnglish: receipt.plainEnglish,
  };
  const rebuilt: ContextualExplanationReceipt = {
    receiptId: `context-receipt:${contextualExplanationSha256(contextualReceiptWithoutId(withoutId))}`,
    ...withoutId,
  };
  if (canonicalizeContextualExplanation(receipt) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_completion_evaluation_noncanonical');
  }
  return rebuilt;
};

const sourceWithoutDigest = (
  source: Omit<ContextualRelationshipSourceCompletionReceipt, 'sourceCompletionDigest'>,
) => source;

const normalizeSource = (
  value: unknown,
  binding: RelationshipInputUniverseBinding,
): ContextualRelationshipSourceCompletionReceipt => {
  const source = exact(value, [
    'snapshot', 'observationArchiveVersion', 'completionManifest', 'completionManifestDigest',
    'archiveSetSha256', 'sourcePageSetSha256', 'rowCount', 'emittedEdgeCount',
    'insufficientEvidenceCount', 'completedAt', 'sourceCompletionDigest',
  ], 'contextual_completion_source_invalid');
  const snapshot = decodeGovernedContextualSourceSnapshot(source.snapshot, binding);
  const completionManifest = decodeContextualObservationArchiveCompletionManifest(
    source.completionManifest,
    snapshot,
  );
  if (source.observationArchiveVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION
    || source.completionManifestDigest !== completionManifest.manifestDigest
    || source.archiveSetSha256 !== completionManifest.archiveSetSha256
    || source.sourcePageSetSha256 !== completionManifest.sourcePageSetSha256
    || source.rowCount !== completionManifest.rowCount
    || source.emittedEdgeCount !== completionManifest.emittedEdgeCount
    || source.insufficientEvidenceCount !== completionManifest.insufficientEvidenceCount
    || source.completedAt !== completionManifest.completedAt
    || Date.parse(completionManifest.completedAt) < Date.parse(snapshot.materializedAt)) {
    invalid('contextual_completion_source_manifest_mismatch');
  }
  const withoutDigest: Omit<ContextualRelationshipSourceCompletionReceipt, 'sourceCompletionDigest'> = {
    snapshot,
    observationArchiveVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    completionManifest,
    completionManifestDigest: completionManifest.manifestDigest,
    archiveSetSha256: completionManifest.archiveSetSha256,
    sourcePageSetSha256: completionManifest.sourcePageSetSha256,
    rowCount: completionManifest.rowCount,
    emittedEdgeCount: completionManifest.emittedEdgeCount,
    insufficientEvidenceCount: completionManifest.insufficientEvidenceCount,
    completedAt: completionManifest.completedAt,
  };
  const sourceCompletionDigest = reqSha(source.sourceCompletionDigest, 'contextual_completion_source_invalid');
  if (sourceCompletionDigest !== contextualExplanationSha256(sourceWithoutDigest(withoutDigest))) {
    invalid('contextual_completion_source_digest_mismatch');
  }
  const rebuilt = { ...withoutDigest, sourceCompletionDigest };
  if (canonicalizeContextualExplanation(source) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_completion_source_noncanonical');
  }
  return rebuilt;
};

export const buildContextualRelationshipSourceCompletionReceipt = (params: {
  snapshot: GovernedContextualSourceSnapshot;
  completionManifest: ContextualObservationArchiveCompletionManifest;
}): ContextualRelationshipSourceCompletionReceipt => {
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot);
  const completionManifest = decodeContextualObservationArchiveCompletionManifest(
    params.completionManifest,
    snapshot,
  );
  const withoutDigest: Omit<ContextualRelationshipSourceCompletionReceipt, 'sourceCompletionDigest'> = {
    snapshot,
    observationArchiveVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    completionManifest,
    completionManifestDigest: completionManifest.manifestDigest,
    archiveSetSha256: completionManifest.archiveSetSha256,
    sourcePageSetSha256: completionManifest.sourcePageSetSha256,
    rowCount: completionManifest.rowCount,
    emittedEdgeCount: completionManifest.emittedEdgeCount,
    insufficientEvidenceCount: completionManifest.insufficientEvidenceCount,
    completedAt: completionManifest.completedAt,
  };
  return normalizeSource({
    ...withoutDigest,
    sourceCompletionDigest: contextualExplanationSha256(sourceWithoutDigest(withoutDigest)),
  }, snapshot.binding);
};

export const decodeContextualRelationshipSourceCompletionReceipt = (
  input: unknown,
  binding: RelationshipInputUniverseBinding,
) => normalizeSource(parse(input, 'contextual_completion_source_json_invalid'), validateRelationshipInputBinding(binding));

const insufficientWithoutId = (receipt: Omit<
ContextualRelationshipInsufficientReceipt,
'receiptId' | 'receiptSha256'
>) => receipt;
const insufficientWithoutSha = (receipt: Omit<
ContextualRelationshipInsufficientReceipt,
'receiptSha256'
>) => receipt;

const buildInsufficientReceipt = (params: Omit<
ContextualRelationshipInsufficientReceipt,
'recordType' | 'schemaVersion' | 'canonicalVersion' | 'receiptId' | 'receiptSha256' | 'decision' | 'claimDiscipline'
>): ContextualRelationshipInsufficientReceipt => {
  const binding = validateRelationshipInputBinding(params.binding);
  const contextualEvaluation = normalizeContextualEvaluationReceipt(
    params.contextualEvaluation,
    'insufficient_evidence',
    params.address,
    params.contextualEvaluation.kind,
  );
  const core: Omit<ContextualRelationshipInsufficientReceipt, 'receiptId' | 'receiptSha256'> = {
    recordType: 'contextual_relationship_insufficient_receipt',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_INSUFFICIENT_RECEIPT_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding,
    address: validateRelationshipInputAddress(params.address),
    relationshipRecordDigest: reqSha(params.relationshipRecordDigest, 'contextual_completion_insufficient_receipt_invalid'),
    observationArchiveRecordDigest: reqSha(params.observationArchiveRecordDigest, 'contextual_completion_insufficient_receipt_invalid'),
    sourceSnapshotDigest: reqSha(params.sourceSnapshotDigest, 'contextual_completion_insufficient_receipt_invalid'),
    adapterReceiptSha256: reqSha(params.adapterReceiptSha256, 'contextual_completion_insufficient_receipt_invalid'),
    governedPayloadDigest: reqSha(params.governedPayloadDigest, 'contextual_completion_insufficient_receipt_invalid'),
    contextualEvaluation,
    decision: 'insufficient_evidence',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  const receiptId = `contextual-insufficient:${contextualExplanationSha256(insufficientWithoutId(core))}`;
  const withoutSha = { ...core, receiptId };
  return { ...withoutSha, receiptSha256: contextualExplanationSha256(insufficientWithoutSha(withoutSha)) };
};

const decodeInsufficientReceipt = (
  input: unknown,
  binding: RelationshipInputUniverseBinding,
  source: ContextualRelationshipSourceCompletionReceipt,
): ContextualRelationshipInsufficientReceipt => {
  const receipt = exact(input, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'receiptId', 'binding', 'address',
    'relationshipRecordDigest', 'observationArchiveRecordDigest', 'sourceSnapshotDigest',
    'adapterReceiptSha256', 'governedPayloadDigest', 'contextualEvaluation', 'decision',
    'claimDiscipline', 'receiptSha256',
  ], 'contextual_completion_insufficient_receipt_invalid');
  if (receipt.recordType !== 'contextual_relationship_insufficient_receipt'
    || receipt.schemaVersion !== CONTEXTUAL_RELATIONSHIP_INSUFFICIENT_RECEIPT_VERSION
    || receipt.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || receipt.decision !== 'insufficient_evidence'
    || receipt.sourceSnapshotDigest !== source.snapshot.snapshotDigest
    || canonicalizeContextualExplanation(receipt.claimDiscipline)
      !== canonicalizeContextualExplanation(CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE)) {
    invalid('contextual_completion_insufficient_receipt_invalid');
  }
  const receiptBinding = validateRelationshipInputBinding(receipt.binding);
  assertRelationshipInputBinding(receiptBinding, binding);
  const contextualEvaluation = normalizeContextualEvaluationReceipt(
    receipt.contextualEvaluation,
    'insufficient_evidence',
    String(receipt.address),
    source.snapshot.kind,
  );
  const rebuilt = buildInsufficientReceipt({
    binding: receiptBinding,
    address: validateRelationshipInputAddress(receipt.address),
    relationshipRecordDigest: reqSha(receipt.relationshipRecordDigest, 'contextual_completion_insufficient_receipt_invalid'),
    observationArchiveRecordDigest: reqSha(receipt.observationArchiveRecordDigest, 'contextual_completion_insufficient_receipt_invalid'),
    sourceSnapshotDigest: reqSha(receipt.sourceSnapshotDigest, 'contextual_completion_insufficient_receipt_invalid'),
    adapterReceiptSha256: reqSha(receipt.adapterReceiptSha256, 'contextual_completion_insufficient_receipt_invalid'),
    governedPayloadDigest: reqSha(receipt.governedPayloadDigest, 'contextual_completion_insufficient_receipt_invalid'),
    contextualEvaluation,
  });
  if (canonicalizeContextualExplanation(receipt) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_completion_insufficient_receipt_noncanonical');
  }
  return rebuilt;
};

const entryIdentity = (base: Omit<EntryBase, 'entryId'>) => base;
const entryWithoutDigest = (entry: ContextualRelationshipCompletionEntryWithoutDigest) => entry;

const validateAcceptedEdge = (
  edgeInput: unknown,
  entry: EntryBase,
  binding: RelationshipInputUniverseBinding,
  source: ContextualRelationshipSourceCompletionReceipt,
) => {
  const edge = decodeTypedRelationshipEdge(edgeInput, binding);
  if (edge.edgeType !== 'contextual_explanation_candidate'
    || edge.endpoints[0].kind !== 'evidence'
    || edge.endpoints[0].id !== entry.address
    || edge.endpoints[1].kind !== 'context'
    || edge.receipt.inputRecordDigests.length !== 1
    || edge.receipt.inputRecordDigests[0] !== entry.relationshipRecordDigest
    || edge.receipt.rarityIndexDigest !== null
    || !edge.receipt.contextualEvaluation) {
    invalid('contextual_completion_entry_typed_edge_mismatch');
  }
  const evaluation = normalizeContextualEvaluationReceipt(
    edge.receipt.contextualEvaluation,
    'emit_candidate_edge',
    entry.address,
    source.snapshot.kind,
  );
  const expectedContextNodeId = `context-node:${evaluation.kind}:${contextualExplanationSha256({
    kind: evaluation.kind,
    referenceId: evaluation.contextReferenceId,
  })}`;
  if (edge.endpoints[1].id !== expectedContextNodeId
    || !edge.receipt.reasons.some((reason) => reason.code === 'governed_contextual_policy_pass'
      && reason.evidenceIds.includes(entry.adapterReceiptSha256)
      && reason.evidenceIds.includes(evaluation.receiptId))) {
    invalid('contextual_completion_entry_typed_edge_mismatch');
  }
  return edge;
};

const makeEntryBase = (params: Omit<EntryBase, 'entryId'>): EntryBase => {
  const core = {
    recordType: 'contextual_relationship_completion_entry' as const,
    schemaVersion: CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    address: validateRelationshipInputAddress(params.address),
    relationshipRecordDigest: reqSha(params.relationshipRecordDigest, 'contextual_completion_entry_invalid'),
    observationArchiveRecordDigest: reqSha(params.observationArchiveRecordDigest, 'contextual_completion_entry_invalid'),
    sourceSnapshotDigest: reqSha(params.sourceSnapshotDigest, 'contextual_completion_entry_invalid'),
    adapterReceiptSha256: reqSha(params.adapterReceiptSha256, 'contextual_completion_entry_invalid'),
    governedPayloadDigest: reqSha(params.governedPayloadDigest, 'contextual_completion_entry_invalid'),
  };
  return {
    ...core,
    entryId: `contextual-completion-entry:${contextualExplanationSha256(entryIdentity(core))}`,
  };
};

const buildEntry = (
  input: ContextualRelationshipCompletionEntryInput,
  source: ContextualRelationshipSourceCompletionReceipt,
  binding: RelationshipInputUniverseBinding,
): ContextualRelationshipCompletionEntry => {
  if (input.sourceSnapshotDigest !== source.snapshot.snapshotDigest) invalid('contextual_completion_entry_source_mismatch');
  const archiveRecord = decodeContextualObservationArchiveRecord(input.archiveRecord, source.snapshot);
  const relationshipRecord = decodeRelationshipInputRecord(input.relationshipRecord, binding);
  if (archiveRecord.address !== relationshipRecord.address
    || archiveRecord.relationshipRecordDigest !== relationshipRecord.recordDigest
    || archiveRecord.sourceSnapshotDigest !== source.snapshot.snapshotDigest) {
    invalid('contextual_completion_entry_record_mismatch');
  }
  const base = makeEntryBase({
    recordType: 'contextual_relationship_completion_entry',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    address: relationshipRecord.address,
    relationshipRecordDigest: relationshipRecord.recordDigest,
    observationArchiveRecordDigest: archiveRecord.recordDigest,
    sourceSnapshotDigest: source.snapshot.snapshotDigest,
    adapterReceiptSha256: archiveRecord.result.adapterReceiptSha256,
    governedPayloadDigest: archiveRecord.payload.payloadDigest,
  });
  let withoutDigest: ContextualRelationshipCompletionEntryWithoutDigest;
  if (archiveRecord.result.evaluation.edge) {
    const edges = evaluateTypedContextualRelationships({
      record: relationshipRecord,
      adapterResults: [archiveRecord.result],
      expectedBinding: binding,
    });
    if (edges.length !== 1) invalid('contextual_completion_typed_edge_invalid');
    withoutDigest = {
      ...base,
      status: 'accepted_edge',
      typedEdge: validateAcceptedEdge(edges[0], base, binding, source),
      insufficientReceipt: null,
    };
  } else {
    withoutDigest = {
      ...base,
      status: 'insufficient_evidence',
      typedEdge: null,
      insufficientReceipt: buildInsufficientReceipt({
        binding,
        address: relationshipRecord.address,
        relationshipRecordDigest: relationshipRecord.recordDigest,
        observationArchiveRecordDigest: archiveRecord.recordDigest,
        sourceSnapshotDigest: source.snapshot.snapshotDigest,
        adapterReceiptSha256: archiveRecord.result.adapterReceiptSha256,
        governedPayloadDigest: archiveRecord.payload.payloadDigest,
        contextualEvaluation: archiveRecord.result.evaluation.receipt,
      }),
    };
  }
  return { ...withoutDigest, entryDigest: contextualExplanationSha256(entryWithoutDigest(withoutDigest)) };
};

export const decodeContextualRelationshipCompletionEntry = (
  input: unknown,
  bindingInput: RelationshipInputUniverseBinding,
  sourceByDigest: ReadonlyMap<string, ContextualRelationshipSourceCompletionReceipt>,
): ContextualRelationshipCompletionEntry => {
  const binding = validateRelationshipInputBinding(bindingInput);
  const entry = exact(parse(input, 'contextual_completion_entry_json_invalid'), [
    'recordType', 'schemaVersion', 'canonicalVersion', 'entryId', 'address', 'relationshipRecordDigest',
    'observationArchiveRecordDigest', 'sourceSnapshotDigest', 'adapterReceiptSha256', 'governedPayloadDigest',
    'status', 'typedEdge', 'insufficientReceipt', 'entryDigest',
  ], 'contextual_completion_entry_invalid');
  if (entry.recordType !== 'contextual_relationship_completion_entry'
    || entry.schemaVersion !== CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION
    || entry.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !['accepted_edge', 'insufficient_evidence'].includes(String(entry.status))) {
    invalid('contextual_completion_entry_invalid');
  }
  const base = makeEntryBase({
    recordType: 'contextual_relationship_completion_entry',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    address: validateRelationshipInputAddress(entry.address),
    relationshipRecordDigest: reqSha(entry.relationshipRecordDigest, 'contextual_completion_entry_invalid'),
    observationArchiveRecordDigest: reqSha(entry.observationArchiveRecordDigest, 'contextual_completion_entry_invalid'),
    sourceSnapshotDigest: reqSha(entry.sourceSnapshotDigest, 'contextual_completion_entry_invalid'),
    adapterReceiptSha256: reqSha(entry.adapterReceiptSha256, 'contextual_completion_entry_invalid'),
    governedPayloadDigest: reqSha(entry.governedPayloadDigest, 'contextual_completion_entry_invalid'),
  });
  if (entry.entryId !== base.entryId) invalid('contextual_completion_entry_id_mismatch');
  const source = sourceByDigest.get(base.sourceSnapshotDigest);
  if (!source) invalid('contextual_completion_entry_source_missing');
  let withoutDigest: ContextualRelationshipCompletionEntryWithoutDigest;
  if (entry.status === 'accepted_edge') {
    if (entry.insufficientReceipt !== null || !entry.typedEdge) {
      invalid('contextual_completion_entry_invalid');
    }
    withoutDigest = {
      ...base,
      status: 'accepted_edge',
      typedEdge: validateAcceptedEdge(entry.typedEdge, base, binding, source),
      insufficientReceipt: null,
    };
  } else {
    if (entry.typedEdge !== null || !entry.insufficientReceipt) {
      invalid('contextual_completion_entry_invalid');
    }
    const insufficientReceipt = decodeInsufficientReceipt(
      entry.insufficientReceipt,
      binding,
      source,
    );
    if (insufficientReceipt.address !== base.address
      || insufficientReceipt.relationshipRecordDigest !== base.relationshipRecordDigest
      || insufficientReceipt.observationArchiveRecordDigest !== base.observationArchiveRecordDigest
      || insufficientReceipt.sourceSnapshotDigest !== base.sourceSnapshotDigest
      || insufficientReceipt.adapterReceiptSha256 !== base.adapterReceiptSha256
      || insufficientReceipt.governedPayloadDigest !== base.governedPayloadDigest) {
      invalid('contextual_completion_insufficient_receipt_entry_mismatch');
    }
    withoutDigest = {
      ...base,
      status: 'insufficient_evidence',
      typedEdge: null,
      insufficientReceipt,
    };
  }
  const rebuilt: ContextualRelationshipCompletionEntry = {
    ...withoutDigest,
    entryDigest: contextualExplanationSha256(entryWithoutDigest(withoutDigest)),
  };
  if (canonicalizeContextualExplanation(entry) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_completion_entry_noncanonical');
  }
  return rebuilt;
};

const emptySourceKindCounts = (): ContextualRelationshipCompletionAccounting['sourceKindCounts'] => ({
  aircraft: { sourceSnapshotCount: 0, sourceRecordCount: 0, acceptedEdgeCount: 0, insufficientEvidenceCount: 0 },
  satellite: { sourceSnapshotCount: 0, sourceRecordCount: 0, acceptedEdgeCount: 0, insufficientEvidenceCount: 0 },
  astronomy: { sourceSnapshotCount: 0, sourceRecordCount: 0, acceptedEdgeCount: 0, insufficientEvidenceCount: 0 },
  weather: { sourceSnapshotCount: 0, sourceRecordCount: 0, acceptedEdgeCount: 0, insufficientEvidenceCount: 0 },
});

const buildAccounting = (
  entries: readonly ContextualRelationshipCompletionEntry[],
  sources: readonly ContextualRelationshipSourceCompletionReceipt[],
  sourceByDigest: ReadonlyMap<string, ContextualRelationshipSourceCompletionReceipt>,
): ContextualRelationshipCompletionAccounting => {
  const sourceKindCounts = emptySourceKindCounts();
  for (const source of sources) sourceKindCounts[source.snapshot.kind].sourceSnapshotCount += 1;
  const addressStates = new Map<string, Set<ContextualRelationshipCompletionEntry['status']>>();
  for (const entry of entries) {
    const source = sourceByDigest.get(entry.sourceSnapshotDigest) || invalid('contextual_completion_entry_source_missing');
    const counts = sourceKindCounts[source.snapshot.kind];
    counts.sourceRecordCount += 1;
    if (entry.status === 'accepted_edge') counts.acceptedEdgeCount += 1;
    else counts.insufficientEvidenceCount += 1;
    const states = addressStates.get(entry.address) || new Set<ContextualRelationshipCompletionEntry['status']>();
    states.add(entry.status);
    addressStates.set(entry.address, states);
  }
  const addressStatusCounts = { accepted_only: 0, insufficient_only: 0, mixed: 0 };
  for (const states of addressStates.values()) {
    if (states.size > 1) addressStatusCounts.mixed += 1;
    else if (states.has('accepted_edge')) addressStatusCounts.accepted_only += 1;
    else addressStatusCounts.insufficient_only += 1;
  }
  return {
    sourceSnapshotCount: sources.length,
    sourceKindCount: KINDS.length,
    sourceRecordCount: entries.length,
    acceptedEdgeCount: entries.filter((entry) => entry.status === 'accepted_edge').length,
    insufficientEvidenceCount: entries.filter((entry) => entry.status === 'insufficient_evidence').length,
    uniqueAddressCount: addressStates.size,
    addressStatusCounts,
    sourceKindCounts,
  };
};

const completionWithoutDigest = (artifact: Omit<
ContextualRelationshipCompletionArtifact,
'completionId' | 'completionDigest'
>) => artifact;

const normalizeSourceSet = (
  sourceInputs: readonly unknown[],
  binding: RelationshipInputUniverseBinding,
) => {
  const sources = sourceInputs.map((source) => normalizeSource(source, binding)).sort((left, right) => (
    compare(left.snapshot.kind, right.snapshot.kind)
      || compare(left.snapshot.sourceId, right.snapshot.sourceId)
      || compare(left.snapshot.snapshotDigest, right.snapshot.snapshotDigest)
  ));
  const snapshotDigests = sources.map((source) => source.snapshot.snapshotDigest);
  const sourceIdentities = sources.map((source) => [
    source.snapshot.kind,
    source.snapshot.sourceId,
    source.snapshot.providerId,
    source.snapshot.datasetVersion,
  ].join('\u0000'));
  if (sources.length < KINDS.length
    || new Set(snapshotDigests).size !== sources.length
    || new Set(sourceIdentities).size !== sources.length
    || KINDS.some((kind) => !sources.some((source) => source.snapshot.kind === kind))) {
    invalid('contextual_completion_source_coverage_invalid');
  }
  return sources;
};

const validateEntrySet = (
  entries: readonly ContextualRelationshipCompletionEntry[],
  sources: readonly ContextualRelationshipSourceCompletionReceipt[],
) => {
  if (new Set(entries.map((entry) => entry.entryId)).size !== entries.length
    || new Set(entries.map((entry) => entry.observationArchiveRecordDigest)).size !== entries.length) {
    invalid('contextual_completion_duplicate_entry');
  }
  const acceptedEdges = entries.filter((entry): entry is ContextualRelationshipCompletionEntry & {
    status: 'accepted_edge'; typedEdge: TypedRelationshipEdge;
  } => entry.status === 'accepted_edge');
  if (new Set(acceptedEdges.map((entry) => entry.typedEdge.edgeId)).size !== acceptedEdges.length
    || new Set(acceptedEdges.map((entry) => entry.typedEdge.endpoints
      .map((endpoint) => `${endpoint.kind}:${endpoint.id}`).join('\u0000'))).size !== acceptedEdges.length) {
    invalid('contextual_completion_duplicate_typed_edge');
  }
  for (const source of sources) {
    const sourceEntries = entries.filter((entry) => entry.sourceSnapshotDigest === source.snapshot.snapshotDigest);
    if (sourceEntries.length !== source.rowCount
      || sourceEntries.filter((entry) => entry.status === 'accepted_edge').length !== source.emittedEdgeCount
      || sourceEntries.filter((entry) => entry.status === 'insufficient_evidence').length !== source.insufficientEvidenceCount) {
      invalid('contextual_completion_source_entry_accounting_mismatch');
    }
  }
};

const sourceCompletionSetSha256 = (
  sources: readonly ContextualRelationshipSourceCompletionReceipt[],
) => contextualExplanationSha256(sources.map((source) => ({
  kind: source.snapshot.kind,
  sourceSnapshotDigest: source.snapshot.snapshotDigest,
  completionManifestDigest: source.completionManifestDigest,
  sourceCompletionDigest: source.sourceCompletionDigest,
})));

const entrySetSha256 = (
  entries: readonly ContextualRelationshipCompletionEntry[],
) => contextualExplanationSha256(entries.map((entry) => ({
  entryId: entry.entryId,
  entryDigest: entry.entryDigest,
})));

const calibrationIsProductionEligible = (receipt: ContextualRelationshipCalibrationReceipt) => (
  receipt.decision === 'production_gates_passed'
  && receipt.evidenceClass === 'human_reviewed_locked_holdout'
  && receipt.authorizationScope === 'production_candidate'
);

const assembleArtifact = (params: {
  binding: RelationshipInputUniverseBinding;
  calibrationReceipt: ContextualRelationshipCalibrationReceipt;
  sources: readonly ContextualRelationshipSourceCompletionReceipt[];
  entries: readonly ContextualRelationshipCompletionEntry[];
}): ContextualRelationshipCompletionArtifact => {
  const binding = validateRelationshipInputBinding(params.binding);
  const calibrationReceipt = decodeContextualRelationshipCalibrationReceipt(params.calibrationReceipt);
  const sources = normalizeSourceSet(params.sources, binding);
  const sourceByDigest = new Map(sources.map((source) => [source.snapshot.snapshotDigest, source]));
  const entries = params.entries.map((entry) => decodeContextualRelationshipCompletionEntry(
    entry,
    binding,
    sourceByDigest,
  )).sort((left, right) => compare(left.entryId, right.entryId));
  validateEntrySet(entries, sources);
  const summary = buildAccounting(entries, sources, sourceByDigest);
  const production = calibrationIsProductionEligible(calibrationReceipt);
  const zeroObservationState = sources.every((source) => source.rowCount === 0);
  if (zeroObservationState !== (entries.length === 0)) invalid('contextual_completion_zero_state_mismatch');
  const core: Omit<ContextualRelationshipCompletionArtifact, 'completionId' | 'completionDigest'> = {
    recordType: 'contextual_relationship_completion_artifact',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    status: production ? 'production_eligible_complete' : 'unvalidated_local_demo',
    binding,
    calibrationReceipt,
    sources,
    sourceCompletionSetSha256: sourceCompletionSetSha256(sources),
    contextualIdentity: CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY,
    contextualIdentitySha256: CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256,
    entries,
    entrySetSha256: entrySetSha256(entries),
    accounting: summary,
    zeroObservationState,
  };
  const coreSha = contextualExplanationSha256(completionWithoutDigest(core));
  const completionId = `contextual-completion:${coreSha}`;
  const withoutDigest = { ...core, completionId };
  return { ...withoutDigest, completionDigest: contextualExplanationSha256(withoutDigest) };
};

export const buildContextualRelationshipCompletionArtifact = (params: {
  binding: RelationshipInputUniverseBinding;
  calibrationReceipt: ContextualRelationshipCalibrationReceipt;
  sources: readonly ContextualRelationshipSourceCompletionReceipt[];
  entries: readonly ContextualRelationshipCompletionEntryInput[];
}): ContextualRelationshipCompletionArtifact => {
  const binding = validateRelationshipInputBinding(params.binding);
  const calibrationReceipt = decodeContextualRelationshipCalibrationReceipt(params.calibrationReceipt);
  const sources = normalizeSourceSet(params.sources, binding);
  const sourceByDigest = new Map(sources.map((source) => [source.snapshot.snapshotDigest, source]));
  const entries = params.entries.map((entry) => buildEntry(
    entry,
    sourceByDigest.get(entry.sourceSnapshotDigest) || invalid('contextual_completion_entry_source_missing'),
    binding,
  ));
  return assembleArtifact({ binding, calibrationReceipt, sources, entries });
};

export const decodeContextualRelationshipCompletionArtifact = (
  input: unknown,
  expectedBinding: RelationshipInputUniverseBinding,
  expectedCalibration: { receiptId: string; receiptSha256: string },
): ContextualRelationshipCompletionArtifact => {
  const value = parse(input, 'contextual_completion_json_invalid');
  const artifact = exact(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'completionId', 'status', 'binding',
    'calibrationReceipt', 'sources', 'sourceCompletionSetSha256', 'contextualIdentity',
    'contextualIdentitySha256', 'entries', 'entrySetSha256', 'accounting',
    'zeroObservationState', 'completionDigest',
  ], 'contextual_completion_artifact_invalid');
  if (artifact.recordType !== 'contextual_relationship_completion_artifact'
    || artifact.schemaVersion !== CONTEXTUAL_RELATIONSHIP_COMPLETION_SCHEMA_VERSION
    || artifact.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !Array.isArray(artifact.sources)
    || !Array.isArray(artifact.entries)) {
    invalid('contextual_completion_artifact_invalid');
  }
  const binding = validateRelationshipInputBinding(artifact.binding);
  assertRelationshipInputBinding(binding, expectedBinding);
  const calibrationReceipt = decodeContextualRelationshipCalibrationReceipt(
    artifact.calibrationReceipt,
    expectedCalibration,
  );
  const sources = normalizeSourceSet(artifact.sources, binding);
  const sourceByDigest = new Map(sources.map((source) => [source.snapshot.snapshotDigest, source]));
  const entries = artifact.entries.map((entry) => decodeContextualRelationshipCompletionEntry(
    entry,
    binding,
    sourceByDigest,
  ));
  const rebuilt = assembleArtifact({ binding, calibrationReceipt, sources, entries });
  if (canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_completion_noncanonical');
  }
  return rebuilt;
};

export const assertContextualRelationshipCompletionProductionEligible = (
  artifactInput: unknown,
  expectedBinding: RelationshipInputUniverseBinding,
  expectedCalibration: { receiptId: string; receiptSha256: string },
) => {
  const artifact = decodeContextualRelationshipCompletionArtifact(
    artifactInput,
    expectedBinding,
    expectedCalibration,
  );
  if (artifact.status !== 'production_eligible_complete') {
    invalid('contextual_completion_not_production_eligible');
  }
  assertContextualRelationshipCalibrationReceiptProductionEligible(artifact.calibrationReceipt);
  return artifact;
};

export const serializeContextualRelationshipCompletionArtifact = (
  artifact: ContextualRelationshipCompletionArtifact,
  expectedCalibration: { receiptId: string; receiptSha256: string },
) => `${canonicalizeContextualExplanation(decodeContextualRelationshipCompletionArtifact(
  artifact,
  artifact.binding,
  expectedCalibration,
))}\n`;
