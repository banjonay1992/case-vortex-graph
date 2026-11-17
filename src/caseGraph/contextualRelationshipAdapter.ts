import {
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  type ContextualDomainEvidenceDraft,
  type ContextualExplanationCandidateDraft,
  type ContextualExplanationEvaluation,
  type ContextualExplanationKind,
  type ContextualMissingStatus,
  type ContextualObservation,
  type ContextualProvenanceDraft,
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
} from './contextualExplanation';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  type RelationshipInputFact,
  type RelationshipInputContextValue,
  type RelationshipInputOrigin,
  type RelationshipInputOriginDraft,
  type RelationshipInputPrecision,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
  assertRelationshipInputBinding,
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  projectRelationshipInputOrigin,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION = 'contextual-relationship-adapter-v2' as const;
export const GOVERNED_CONTEXTUAL_OBSERVATION_VERSION = 'governed-contextual-observation-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE = 'contextual_explanation_candidate' as const;

const CONTEXTUAL_RECEIPT_METRIC_KEYS = Object.freeze([
  'adapter_version',
  'governed_payload_schema_version',
  'context_input_sha256',
  'context_policy_version',
  'context_policy_sha256',
  'model_input_sha256',
  'model_output_sha256',
] as const);

const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const FACT_ID_PATTERN = /^fact:[a-f0-9]{64}$/;
const ORIGIN_ID_PATTERN = /^origin:[a-f0-9]{64}$/;
const KINDS: readonly ContextualExplanationKind[] = ['aircraft', 'satellite', 'astronomy', 'weather'];

type CandidateModel = ContextualExplanationCandidateDraft['model'];
type CandidateMissingness = ContextualExplanationCandidateDraft['missingness'];

export type GovernedContextualOriginBinding = {
  originId: string;
  sourceRef: string;
};

export type GovernedContextualObservationCore = {
  kind: ContextualExplanationKind;
  binding: RelationshipInputUniverseBinding;
  address: string;
  originBindings: GovernedContextualOriginBinding[];
  reference: {
    referenceId: string;
    label: string;
  };
  subjectObservation: ContextualObservation;
  referenceObservation: ContextualObservation;
  provenance: ContextualProvenanceDraft[];
  domainEvidence: ContextualDomainEvidenceDraft[];
  missingness: CandidateMissingness;
  model: CandidateModel;
};

export type GovernedContextualObservationPayloadDraft = GovernedContextualObservationCore & {
  factId: string;
};

export type GovernedContextualOriginDraftBinding = {
  origin: RelationshipInputOriginDraft | RelationshipInputOrigin;
  sourceRef: string;
};

export type GovernedContextualObservationCoreDraft = Omit<
  GovernedContextualObservationCore,
  'originBindings'
> & {
  originDraftBindings: GovernedContextualOriginDraftBinding[];
};

export type ContextualRelationshipFactReceiptMetrics = {
  adapter_version: typeof CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION;
  governed_payload_schema_version: typeof GOVERNED_CONTEXTUAL_OBSERVATION_VERSION;
  context_input_sha256: string;
  context_policy_version: typeof CONTEXTUAL_EXPLANATION_POLICY_VERSION;
  context_policy_sha256: typeof CONTEXTUAL_EXPLANATION_POLICY_SHA256;
  model_input_sha256: string;
  model_output_sha256: string;
};

export type PreparedGovernedContextualObservation = {
  core: GovernedContextualObservationCore;
  factOrigins: RelationshipInputOriginDraft[];
  contextInputSha256: string;
  factReceiptMetrics: ContextualRelationshipFactReceiptMetrics;
};

export type GovernedContextualObservationPayload = GovernedContextualObservationPayloadDraft & {
  recordType: 'governed_contextual_observation';
  schemaVersion: typeof GOVERNED_CONTEXTUAL_OBSERVATION_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  contextInputSha256: string;
  payloadDigest: string;
};

export type ContextualRelationshipSourceFactReceipt = {
  factId: string;
  predicate: string;
  confidence: number;
  uncertainty: RelationshipInputFact['uncertainty'];
  precision: Exclude<RelationshipInputPrecision, { kind: 'unknown' }>;
  missingness: RelationshipInputFact['missingness'];
  originIds: string[];
  explanationType: 'aircraft' | 'satellite' | 'astronomical' | 'meteorological';
  referenceId: string;
  metrics: Record<string, string | number | boolean | null>;
};

type ContextualRelationshipInputFact = Omit<RelationshipInputFact, 'family' | 'value'> & {
  family: 'contextual_explanation';
  value: RelationshipInputContextValue | null;
};

export type ContextualRelationshipAdapterResult = {
  recordType: 'contextual_relationship_adapter_result';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  address: string;
  sourceRecordDigest: string;
  governedPayloadDigest: string;
  contextInputSha256: string;
  sourceFact: ContextualRelationshipSourceFactReceipt;
  evaluation: ContextualExplanationEvaluation;
  claimDiscipline: {
    source: typeof RELATIONSHIP_INPUT_CLAIM_DISCIPLINE;
    output: typeof CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE;
  };
  adapterReceiptSha256: string;
};

const lexical = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function assertPlainObject(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) invalid(code);
}

function assertArray(value: unknown, code: string): asserts value is unknown[] {
  if (!Array.isArray(value)) invalid(code);
}

const requireExactKeys = (value: Record<string, unknown>, expected: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(lexical);
  const canonical = [...expected].sort(lexical);
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) invalid(code);
};

const requireString = (value: unknown, code: string, maximum = 500): string => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) invalid(code);
  return value as string;
};

const requireId = (value: unknown, code: string): string => {
  const id = requireString(value, code, 240);
  if (!ID_PATTERN.test(id)) invalid(code);
  return id;
};

const normalizeOriginBindings = (value: unknown) => {
  assertArray(value, 'contextual_adapter_origin_bindings_invalid');
  if (!value.length) invalid('contextual_adapter_origin_bindings_invalid');
  const bindings = value.map((item) => {
    assertPlainObject(item, 'contextual_adapter_origin_binding_invalid');
    requireExactKeys(item, ['originId', 'sourceRef'], 'contextual_adapter_origin_binding_invalid');
    const originId = requireString(item.originId, 'contextual_adapter_origin_id_invalid', 71);
    if (!ORIGIN_ID_PATTERN.test(originId)) invalid('contextual_adapter_origin_id_invalid');
    return {
      originId,
      sourceRef: requireId(item.sourceRef, 'contextual_adapter_origin_source_ref_invalid'),
    };
  }).sort((left, right) => lexical(left.originId, right.originId) || lexical(left.sourceRef, right.sourceRef));
  if (new Set(bindings.map((item) => `${item.originId}:${item.sourceRef}`)).size !== bindings.length) {
    invalid('contextual_adapter_duplicate_origin_binding');
  }
  return bindings;
};

const copyObservation = (value: unknown): ContextualObservation => structuredClone(value) as ContextualObservation;
const copyModel = (value: unknown): CandidateModel => structuredClone(value) as CandidateModel;

const normalizeProvenanceOrder = (value: unknown) => {
  assertArray(value, 'contextual_adapter_provenance_invalid');
  return value.map((item) => structuredClone(item) as ContextualProvenanceDraft)
    .sort((left, right) => lexical(String(left.sourceRef), String(right.sourceRef))
      || lexical(contextualExplanationSha256(left), contextualExplanationSha256(right)));
};

const normalizeDomainEvidenceOrder = (value: unknown) => {
  assertArray(value, 'contextual_adapter_domain_evidence_invalid');
  return value.map((item) => {
    const copied = structuredClone(item) as ContextualDomainEvidenceDraft;
    if (Array.isArray(copied.sourceRefs)) copied.sourceRefs.sort(lexical);
    return copied;
  }).sort((left, right) => lexical(String(left.code), String(right.code))
    || lexical(contextualExplanationSha256(left), contextualExplanationSha256(right)));
};

const normalizeMissingnessOrder = (value: unknown) => {
  assertArray(value, 'contextual_adapter_missingness_invalid');
  return value.map((item) => structuredClone(item) as {
    field: string;
    status: ContextualMissingStatus;
    reason: string;
  }).sort((left, right) => lexical(String(left.field), String(right.field))
    || lexical(String(left.status), String(right.status))
    || lexical(String(left.reason), String(right.reason)));
};

const normalizeReference = (value: unknown) => {
  assertPlainObject(value, 'contextual_adapter_reference_invalid');
  requireExactKeys(value, ['referenceId', 'label'], 'contextual_adapter_reference_invalid');
  return {
    referenceId: requireId(value.referenceId, 'contextual_adapter_reference_id_invalid'),
    label: requireString(value.label, 'contextual_adapter_reference_label_invalid', 240),
  };
};

const normalizeCore = (input: unknown): GovernedContextualObservationCore => {
  assertPlainObject(input, 'contextual_adapter_observation_core_invalid');
  requireExactKeys(input, [
    'kind',
    'binding',
    'address',
    'originBindings',
    'reference',
    'subjectObservation',
    'referenceObservation',
    'provenance',
    'domainEvidence',
    'missingness',
    'model',
  ], 'contextual_adapter_observation_core_invalid');
  if (!KINDS.includes(input.kind as ContextualExplanationKind)) invalid('contextual_adapter_kind_invalid');
  const kind = input.kind as ContextualExplanationKind;
  const binding = validateRelationshipInputBinding(input.binding);
  const address = validateRelationshipInputAddress(input.address);
  const reference = normalizeReference(input.reference);
  const originBindings = normalizeOriginBindings(input.originBindings);
  const subjectObservation = copyObservation(input.subjectObservation);
  const referenceObservation = copyObservation(input.referenceObservation);
  const provenance = normalizeProvenanceOrder(input.provenance);
  const domainEvidence = normalizeDomainEvidenceOrder(input.domainEvidence);
  const missingness = normalizeMissingnessOrder(input.missingness);
  const model = copyModel(input.model);

  // The contextual evaluator is the single structural validator for governed
  // observation, provenance, evidence, missingness, and model payloads. A
  // medium placeholder uncertainty validates structure without asserting that
  // the source fact has qualified for an edge; the real fact uncertainty is
  // supplied only by the adapter below.
  evaluateContextualExplanationCandidate({
    kind,
    subjectAddress: address,
    reference,
    subjectObservation,
    referenceObservation,
    provenance,
    domainEvidence,
    missingness,
    uncertainty: { level: 'medium', reasons: ['governed_payload_structure_validation'] },
    model,
  } as ContextualExplanationCandidateDraft);

  return {
    kind,
    binding,
    address,
    originBindings,
    reference,
    subjectObservation,
    referenceObservation,
    provenance,
    domainEvidence,
    missingness,
    model,
  };
};

export const governedContextualInputSha256 = (input: GovernedContextualObservationCore) => (
  contextualExplanationSha256(normalizeCore(input))
);

export const buildContextualRelationshipFactReceiptMetrics = (
  input: GovernedContextualObservationCore,
): ContextualRelationshipFactReceiptMetrics => {
  const core = normalizeCore(input);
  return {
    adapter_version: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
    governed_payload_schema_version: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
    context_input_sha256: contextualExplanationSha256(core),
    context_policy_version: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
    context_policy_sha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
    model_input_sha256: core.model.inputSha256,
    model_output_sha256: core.model.outputSha256,
  };
};

export const prepareGovernedContextualObservation = (
  draft: GovernedContextualObservationCoreDraft,
): PreparedGovernedContextualObservation => {
  assertPlainObject(draft, 'contextual_adapter_observation_core_draft_invalid');
  requireExactKeys(draft, [
    'kind',
    'binding',
    'address',
    'originDraftBindings',
    'reference',
    'subjectObservation',
    'referenceObservation',
    'provenance',
    'domainEvidence',
    'missingness',
    'model',
  ], 'contextual_adapter_observation_core_draft_invalid');
  assertArray(draft.originDraftBindings, 'contextual_adapter_origin_draft_bindings_invalid');
  if (!draft.originDraftBindings.length) invalid('contextual_adapter_origin_draft_bindings_invalid');

  const projected = draft.originDraftBindings.map((item) => {
    assertPlainObject(item, 'contextual_adapter_origin_draft_binding_invalid');
    requireExactKeys(item, ['origin', 'sourceRef'], 'contextual_adapter_origin_draft_binding_invalid');
    return {
      origin: projectRelationshipInputOrigin(item.origin as RelationshipInputOriginDraft | RelationshipInputOrigin),
      sourceRef: requireId(item.sourceRef, 'contextual_adapter_origin_source_ref_invalid'),
    };
  }).sort((left, right) => lexical(left.origin.originId, right.origin.originId)
    || lexical(left.sourceRef, right.sourceRef));

  const originBySourceRef = new Map<string, string>();
  for (const item of projected) {
    const prior = originBySourceRef.get(item.sourceRef);
    if (prior && prior !== item.origin.originId) invalid('contextual_adapter_origin_source_ambiguous');
    originBySourceRef.set(item.sourceRef, item.origin.originId);
  }
  const provenance = Array.isArray(draft.provenance) ? draft.provenance : [];
  const provenanceByRef = new Map(provenance.map((source) => [source.sourceRef, source]));
  for (const sourceRef of originBySourceRef.keys()) {
    if (!provenanceByRef.has(sourceRef)) invalid('contextual_adapter_origin_source_unknown');
  }
  for (const sourceRef of provenanceByRef.keys()) {
    if (!originBySourceRef.has(sourceRef)) invalid('contextual_adapter_unbound_provenance');
  }

  const originBindings = projected.map((item) => ({
    originId: item.origin.originId,
    sourceRef: item.sourceRef,
  }));
  const core = normalizeCore({
    kind: draft.kind,
    binding: draft.binding,
    address: draft.address,
    originBindings,
    reference: draft.reference,
    subjectObservation: draft.subjectObservation,
    referenceObservation: draft.referenceObservation,
    provenance: draft.provenance,
    domainEvidence: draft.domainEvidence,
    missingness: draft.missingness,
    model: draft.model,
  });
  const originById = new Map(projected.map((item) => [item.origin.originId, item.origin]));
  const subjectRefs = new Set(core.provenance
    .filter((source) => source.role === 'subject_observation')
    .map((source) => source.sourceRef));
  if (!core.originBindings.some((binding) => {
    const origin = originById.get(binding.originId);
    return subjectRefs.has(binding.sourceRef) && origin?.sourceAddress === core.address;
  })) invalid('contextual_adapter_subject_origin_mismatch');

  const factOrigins = [...originById.values()].sort((left, right) => lexical(left.originId, right.originId))
    .map(({ originId: _originId, ...origin }) => origin);
  const factReceiptMetrics = buildContextualRelationshipFactReceiptMetrics(core);
  return {
    core,
    factOrigins,
    contextInputSha256: factReceiptMetrics.context_input_sha256,
    factReceiptMetrics,
  };
};

const payloadWithoutDigest = (
  draft: GovernedContextualObservationPayloadDraft,
): Omit<GovernedContextualObservationPayload, 'payloadDigest'> => {
  const factId = requireString(draft.factId, 'contextual_adapter_fact_id_invalid', 69);
  if (!FACT_ID_PATTERN.test(factId)) invalid('contextual_adapter_fact_id_invalid');
  const coreInput = { ...draft } as Record<string, unknown>;
  delete coreInput.factId;
  const core = normalizeCore(coreInput);
  return {
    recordType: 'governed_contextual_observation',
    schemaVersion: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    ...core,
    factId,
    contextInputSha256: contextualExplanationSha256(core),
  };
};

export const buildGovernedContextualObservationPayload = (
  draft: GovernedContextualObservationPayloadDraft,
): GovernedContextualObservationPayload => {
  const withoutDigest = payloadWithoutDigest(draft);
  return {
    ...withoutDigest,
    payloadDigest: contextualExplanationSha256(withoutDigest),
  };
};

export const decodeGovernedContextualObservationPayload = (
  input: Buffer | string | unknown,
): GovernedContextualObservationPayload => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      invalid('contextual_adapter_payload_json_invalid');
    }
  }
  assertPlainObject(value, 'contextual_adapter_payload_invalid');
  requireExactKeys(value, [
    'recordType',
    'schemaVersion',
    'canonicalVersion',
    'kind',
    'binding',
    'address',
    'originBindings',
    'reference',
    'subjectObservation',
    'referenceObservation',
    'provenance',
    'domainEvidence',
    'missingness',
    'model',
    'factId',
    'contextInputSha256',
    'payloadDigest',
  ], 'contextual_adapter_payload_invalid');
  if (value.recordType !== 'governed_contextual_observation'
    || value.schemaVersion !== GOVERNED_CONTEXTUAL_OBSERVATION_VERSION
    || value.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION) {
    invalid('contextual_adapter_payload_version_invalid');
  }
  const draft = {
    kind: value.kind,
    binding: value.binding,
    address: value.address,
    originBindings: value.originBindings,
    reference: value.reference,
    subjectObservation: value.subjectObservation,
    referenceObservation: value.referenceObservation,
    provenance: value.provenance,
    domainEvidence: value.domainEvidence,
    missingness: value.missingness,
    model: value.model,
    factId: value.factId,
  } as GovernedContextualObservationPayloadDraft;
  const rebuilt = buildGovernedContextualObservationPayload(draft);
  if (value.contextInputSha256 !== rebuilt.contextInputSha256) invalid('contextual_adapter_context_input_digest_mismatch');
  if (value.payloadDigest !== rebuilt.payloadDigest) invalid('contextual_adapter_payload_digest_mismatch');
  if (canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_adapter_payload_noncanonical');
  }
  return rebuilt;
};

const mapExplanationKind = (value: string): ContextualExplanationKind => {
  switch (value) {
    case 'aircraft': return 'aircraft';
    case 'satellite': return 'satellite';
    case 'astronomical': return 'astronomy';
    case 'meteorological': return 'weather';
    default: return invalid('contextual_adapter_explanation_type_unsupported');
  }
};

const EXPLANATION_TYPE_BY_KIND: Readonly<Record<
  ContextualExplanationKind,
  ContextualRelationshipSourceFactReceipt['explanationType']
>> = Object.freeze({
  aircraft: 'aircraft',
  satellite: 'satellite',
  astronomy: 'astronomical',
  weather: 'meteorological',
});

const requireMetric = (
  metrics: Readonly<Record<string, string | number | boolean | null>>,
  key: string,
  expected: string,
  code: string,
) => {
  if (metrics[key] !== expected) invalid(code);
};

const validateFactReceipt = (
  fact: ContextualRelationshipInputFact,
  payload: GovernedContextualObservationPayload,
): ContextualRelationshipSourceFactReceipt => {
  if (fact.family !== 'contextual_explanation'
    || !fact.value
    || fact.value.kind !== 'contextual_explanation'
    || fact.missingness.status !== 'present'
    || fact.confidence === null) {
    invalid('contextual_adapter_fact_not_present');
  }
  if (fact.predicate !== CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE) {
    invalid('contextual_adapter_fact_predicate_invalid');
  }
  if (fact.value.matchStatus !== 'candidate') invalid('contextual_adapter_fact_not_candidate');
  if (fact.value.interpretation !== 'candidate_explanation_not_causal_attribution') {
    invalid('contextual_adapter_fact_claim_invalid');
  }
  const explanationType = fact.value.explanationType as ContextualRelationshipSourceFactReceipt['explanationType'];
  const kind = mapExplanationKind(fact.value.explanationType);
  if (kind !== payload.kind) invalid('contextual_adapter_kind_mismatch');
  if (fact.value.referenceId !== payload.reference.referenceId) invalid('contextual_adapter_reference_mismatch');
  if (fact.precision.kind === 'unknown') invalid('contextual_adapter_fact_precision_unknown');
  const confidence = fact.confidence;
  const precision = fact.precision as Exclude<RelationshipInputPrecision, { kind: 'unknown' }>;

  const metrics = fact.value.metrics;
  const actualMetricKeys = Object.keys(metrics).sort(lexical);
  const expectedMetricKeys = [...CONTEXTUAL_RECEIPT_METRIC_KEYS].sort(lexical);
  if (actualMetricKeys.length !== expectedMetricKeys.length
    || actualMetricKeys.some((key, index) => key !== expectedMetricKeys[index])) {
    invalid('contextual_adapter_receipt_metrics_invalid');
  }
  requireMetric(metrics, 'adapter_version', CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION, 'contextual_adapter_version_receipt_mismatch');
  requireMetric(metrics, 'governed_payload_schema_version', GOVERNED_CONTEXTUAL_OBSERVATION_VERSION, 'contextual_adapter_payload_schema_receipt_mismatch');
  requireMetric(metrics, 'context_input_sha256', payload.contextInputSha256, 'contextual_adapter_context_input_receipt_mismatch');
  requireMetric(metrics, 'context_policy_version', CONTEXTUAL_EXPLANATION_POLICY_VERSION, 'contextual_adapter_policy_receipt_mismatch');
  requireMetric(metrics, 'context_policy_sha256', CONTEXTUAL_EXPLANATION_POLICY_SHA256, 'contextual_adapter_policy_receipt_mismatch');
  requireMetric(metrics, 'model_input_sha256', payload.model.inputSha256, 'contextual_adapter_model_receipt_mismatch');
  requireMetric(metrics, 'model_output_sha256', payload.model.outputSha256, 'contextual_adapter_model_receipt_mismatch');

  return {
    factId: fact.factId,
    predicate: fact.predicate,
    confidence,
    uncertainty: fact.uncertainty,
    precision,
    missingness: fact.missingness,
    originIds: fact.origins.map((origin) => origin.originId).sort(lexical),
    explanationType,
    referenceId: fact.value.referenceId,
    metrics: Object.fromEntries(Object.entries(metrics).sort(([left], [right]) => lexical(left, right))),
  };
};

const assertOriginBindings = (
  record: RelationshipInputRecord,
  fact: ContextualRelationshipInputFact,
  payload: GovernedContextualObservationPayload,
) => {
  const originsById = new Map(fact.origins.map((origin) => [origin.originId, origin]));
  const factOriginIds = [...originsById.keys()].sort(lexical);
  const payloadOriginIds = [...new Set(payload.originBindings.map((binding) => binding.originId))].sort(lexical);
  if (canonicalizeRelationshipInput(factOriginIds) !== canonicalizeRelationshipInput(payloadOriginIds)) {
    invalid('contextual_adapter_origin_set_mismatch');
  }
  const provenanceByRef = new Map(payload.provenance.map((source) => [source.sourceRef, source]));
  const originIdBySourceRef = new Map<string, string>();
  for (const binding of payload.originBindings) {
    if (!originsById.has(binding.originId)) invalid('contextual_adapter_origin_set_mismatch');
    if (!provenanceByRef.has(binding.sourceRef)) invalid('contextual_adapter_origin_source_unknown');
    const priorOriginId = originIdBySourceRef.get(binding.sourceRef);
    if (priorOriginId && priorOriginId !== binding.originId) {
      invalid('contextual_adapter_origin_source_ambiguous');
    }
    originIdBySourceRef.set(binding.sourceRef, binding.originId);
  }
  for (const sourceRef of provenanceByRef.keys()) {
    if (!payload.originBindings.some((binding) => binding.sourceRef === sourceRef)) {
      invalid('contextual_adapter_unbound_provenance');
    }
  }
  const hasSubjectOrigin = payload.originBindings.some((binding) => {
    const source = provenanceByRef.get(binding.sourceRef);
    const origin = originsById.get(binding.originId);
    return source?.role === 'subject_observation' && origin?.sourceAddress === record.address;
  });
  if (!hasSubjectOrigin) invalid('contextual_adapter_subject_origin_mismatch');
};

const resultWithoutDigest = (
  record: RelationshipInputRecord,
  payload: GovernedContextualObservationPayload,
  sourceFact: ContextualRelationshipSourceFactReceipt,
  evaluation: ContextualExplanationEvaluation,
): Omit<ContextualRelationshipAdapterResult, 'adapterReceiptSha256'> => ({
  recordType: 'contextual_relationship_adapter_result',
  schemaVersion: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
  binding: record.binding,
  address: record.address,
  sourceRecordDigest: record.recordDigest,
  governedPayloadDigest: payload.payloadDigest,
  contextInputSha256: payload.contextInputSha256,
  sourceFact,
  evaluation,
  claimDiscipline: {
    source: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
    output: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  },
});

export const adaptContextualRelationship = (
  recordInput: Buffer | string | RelationshipInputRecord,
  payloadInput: Buffer | string | GovernedContextualObservationPayload,
  expectedBinding: RelationshipInputUniverseBinding,
): ContextualRelationshipAdapterResult => {
  const binding = validateRelationshipInputBinding(expectedBinding);
  const record = decodeRelationshipInputRecord(recordInput, binding);
  const payload = decodeGovernedContextualObservationPayload(payloadInput);
  assertRelationshipInputBinding(payload.binding, binding);
  assertRelationshipInputBinding(payload.binding, record.binding);
  if (payload.address !== record.address) invalid('contextual_adapter_address_mismatch');
  const rawFact = record.facts.find((fact) => fact.factId === payload.factId);
  if (!rawFact) invalid('contextual_adapter_fact_not_found');
  if (rawFact.family !== 'contextual_explanation') invalid('contextual_adapter_fact_type_invalid');
  const fact = rawFact as ContextualRelationshipInputFact;
  const sourceFact = validateFactReceipt(fact, payload);
  assertOriginBindings(record, fact, payload);

  const evaluation = evaluateContextualExplanationCandidate({
    kind: payload.kind,
    subjectAddress: payload.address,
    reference: payload.reference,
    subjectObservation: payload.subjectObservation,
    referenceObservation: payload.referenceObservation,
    provenance: payload.provenance,
    domainEvidence: payload.domainEvidence,
    missingness: payload.missingness,
    uncertainty: sourceFact.uncertainty,
    model: payload.model,
  } as ContextualExplanationCandidateDraft);
  const withoutDigest = resultWithoutDigest(record, payload, sourceFact, evaluation);
  return {
    ...withoutDigest,
    adapterReceiptSha256: contextualExplanationSha256(withoutDigest),
  };
};

/**
 * Completes the second coordinator pass after the relationship-input record
 * has assigned the contextual fact ID. The fact is selected by its complete
 * governed receipt and exact origin set, never by array position.
 */
export const buildGovernedContextualObservationPayloadForRecord = (
  recordInput: Buffer | string | RelationshipInputRecord,
  coreInput: GovernedContextualObservationCore,
  expectedBinding: RelationshipInputUniverseBinding,
): GovernedContextualObservationPayload => {
  const binding = validateRelationshipInputBinding(expectedBinding);
  const record = decodeRelationshipInputRecord(recordInput, binding);
  const core = normalizeCore(coreInput);
  assertRelationshipInputBinding(core.binding, binding);
  if (record.address !== core.address) invalid('contextual_adapter_address_mismatch');
  const metrics = buildContextualRelationshipFactReceiptMetrics(core);
  const expectedOriginIds = [...new Set(core.originBindings.map((item) => item.originId))].sort(lexical);
  const matchingFacts = record.facts.filter((fact): fact is ContextualRelationshipInputFact => {
    if (fact.family !== 'contextual_explanation'
      || fact.predicate !== CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE
      || !fact.value
      || fact.value.kind !== 'contextual_explanation'
      || fact.value.explanationType !== EXPLANATION_TYPE_BY_KIND[core.kind]
      || fact.value.referenceId !== core.reference.referenceId
      || canonicalizeRelationshipInput(fact.value.metrics) !== canonicalizeRelationshipInput(metrics)) return false;
    const originIds = fact.origins.map((origin) => origin.originId).sort(lexical);
    return canonicalizeRelationshipInput(originIds) === canonicalizeRelationshipInput(expectedOriginIds);
  });
  if (!matchingFacts.length) invalid('contextual_adapter_prepared_fact_not_found');
  if (matchingFacts.length > 1) invalid('contextual_adapter_prepared_fact_ambiguous');
  const payload = buildGovernedContextualObservationPayload({ ...core, factId: matchingFacts[0].factId });
  // Reuse the full adapter verifier so the returned payload is guaranteed to
  // bind the record, origins, receipt metrics, policy, and model.
  adaptContextualRelationship(record, payload, binding);
  return payload;
};

export const verifyContextualRelationshipAdapterResult = (
  resultInput: Buffer | string | unknown,
  recordInput: Buffer | string | RelationshipInputRecord,
  payloadInput: Buffer | string | GovernedContextualObservationPayload,
  expectedBinding: RelationshipInputUniverseBinding,
): ContextualRelationshipAdapterResult => {
  let value: unknown = resultInput;
  if (Buffer.isBuffer(resultInput) || typeof resultInput === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(resultInput) ? resultInput.toString('utf8') : resultInput);
    } catch {
      invalid('contextual_adapter_result_json_invalid');
    }
  }
  assertPlainObject(value, 'contextual_adapter_result_invalid');
  const expected = adaptContextualRelationship(recordInput, payloadInput, expectedBinding);
  if (canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(expected)) {
    invalid('contextual_adapter_result_mismatch');
  }
  return expected;
};
