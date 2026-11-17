import { createHash } from 'node:crypto';

import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from './evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  evidenceUniverseAddress,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';

export const RELATIONSHIP_INPUT_SNAPSHOT_VERSION = 'relationship-input-snapshot-v2' as const;
export const RELATIONSHIP_INPUT_CANONICAL_VERSION = 'case-graph-canonical-json-v1' as const;
export const RELATIONSHIP_INPUT_CLAIM_DISCIPLINE = {
  semantics: 'evidence_relationship_not_causality',
  extraordinaryOrigin: 'not_assessed',
  notice: 'Inputs describe evidence, provenance, similarity, and candidate contextual explanations; they do not establish causation or extraordinary origin.',
} as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const FACT_FAMILIES = [
  'provenance',
  'space_time',
  'visual',
  'behavioural',
  'sensory',
  'duration',
  'entity',
  'site',
  'narrative_pattern',
  'contextual_explanation',
] as const;
const NODE_KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;

export type RelationshipInputFactFamily = typeof FACT_FAMILIES[number];
export type RelationshipInputMissingStatus = 'present' | 'unknown' | 'not_recorded' | 'not_applicable' | 'withheld';
export type RelationshipInputUncertaintyLevel = 'none' | 'low' | 'medium' | 'high' | 'unknown';

export type RelationshipInputUniverseBinding = {
  snapshotId: string;
  corpusVersion: string;
  universeArchiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
  universeSchemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  universeLayoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  universeArchiveSetSha256: string;
  universeRecordCount: number;
};

export type RelationshipInputSpan = {
  unit: 'utf8_byte';
  start: number;
  end: number;
  text: string;
  textSha256: string;
};

export type RelationshipInputOrigin = {
  originId: string;
  sourceAddress: string;
  sourceField: string;
  sourceTextSha256: string | null;
  sourceTextBytes: number | null;
  supportingSpans: RelationshipInputSpan[];
  extraction: {
    method: 'structured' | 'deterministic_rule' | 'governed_model' | 'manual_review';
    version: string;
  };
};

export type RelationshipInputOriginDraft = Omit<RelationshipInputOrigin, 'originId'>;

export type RelationshipInputPrecision =
  | { kind: 'exact' }
  | { kind: 'bounded'; unit: string; lower: number; upper: number }
  | { kind: 'approximate'; unit: string; tolerance: number }
  | { kind: 'categorical'; vocabularyVersion: string }
  | { kind: 'unknown' };

export type RelationshipInputMissingness = {
  status: RelationshipInputMissingStatus;
  reasons: string[];
};

export type RelationshipInputUncertainty = {
  level: RelationshipInputUncertaintyLevel;
  reasons: string[];
};

export type RelationshipInputTermValue = {
  kind: 'term';
  termId: string;
  vocabularyVersion: string;
};

export type RelationshipInputTimestampValue = {
  kind: 'timestamp';
  timestamp: string;
  datePrecision: 'exact' | 'hour' | 'day' | 'month' | 'year' | 'unknown';
};

export type RelationshipInputGeoValue = {
  kind: 'geo_point';
  lat: number;
  lon: number;
  spatialPrecisionKm: number;
};

export type RelationshipInputDurationValue = {
  kind: 'duration';
  seconds: number;
};

export type RelationshipInputGovernedReferenceValue = {
  kind: 'governed_reference';
  governedId: string;
  registryVersion: string;
};

export type RelationshipInputProvenanceValue = {
  kind: 'provenance';
  code: 'source_record' | 'duplicate_cluster' | 'cross_reference' | 'ingestion_lineage' | 'media_attachment';
  referenceId: string;
};

export type RelationshipInputNarrativePatternValue = {
  kind: 'narrative_pattern';
  patternId: string;
  registryVersion: string;
};

export type RelationshipInputContextValue = {
  kind: 'contextual_explanation';
  explanationType: 'aircraft' | 'satellite' | 'astronomical' | 'meteorological' | 'balloon' | 'human_activity' | 'other';
  referenceId: string;
  matchStatus: 'candidate' | 'ruled_out' | 'unknown';
  interpretation: 'candidate_explanation_not_causal_attribution';
  metrics: Record<string, string | number | boolean | null>;
};

type RelationshipInputFactShape<F extends RelationshipInputFactFamily, V> = {
  factId: string;
  family: F;
  predicate: string;
  value: V | null;
  confidence: number | null;
  uncertainty: RelationshipInputUncertainty;
  precision: RelationshipInputPrecision;
  missingness: RelationshipInputMissingness;
  origins: RelationshipInputOrigin[];
};

export type RelationshipInputFact =
  | RelationshipInputFactShape<'provenance', RelationshipInputProvenanceValue>
  | RelationshipInputFactShape<'space_time', RelationshipInputTimestampValue | RelationshipInputGeoValue>
  | RelationshipInputFactShape<'visual' | 'behavioural' | 'sensory', RelationshipInputTermValue>
  | RelationshipInputFactShape<'duration', RelationshipInputDurationValue>
  | RelationshipInputFactShape<'entity' | 'site', RelationshipInputGovernedReferenceValue>
  | RelationshipInputFactShape<'narrative_pattern', RelationshipInputNarrativePatternValue>
  | RelationshipInputFactShape<'contextual_explanation', RelationshipInputContextValue>;

export type RelationshipInputFactDraft = RelationshipInputFact extends infer T
  ? T extends RelationshipInputFact
    ? Omit<T, 'factId' | 'origins'> & { origins: RelationshipInputOriginDraft[] }
    : never
  : never;

export type RelationshipInputDuplicateLineage = {
  clusterId: string;
  status: 'candidate' | 'confirmed';
  canonicalAddress: string;
  memberRole: 'canonical' | 'duplicate';
  origins: RelationshipInputOrigin[];
};

export type RelationshipInputCrossReference = {
  referenceId: string;
  targetAddress: string;
  relation: 'cites' | 'same_source_record' | 'duplicate_of' | 'derived_from' | 'media_attachment';
  origins: RelationshipInputOrigin[];
};

export type RelationshipInputCrossReferenceDraft = Omit<RelationshipInputCrossReference, 'referenceId' | 'origins'> & {
  origins: RelationshipInputOriginDraft[];
};

export type RelationshipInputSourceAssertion = {
  assertionId: string;
  counterpartySourceId: string;
  classification: 'independent' | 'dependent' | 'unknown';
  basis:
    | 'documented_separate_origin'
    | 'governed_review'
    | 'same_lineage'
    | 'explicit_upstream'
    | 'same_source_record'
    | 'insufficient_evidence';
  origins: RelationshipInputOrigin[];
};

export type RelationshipInputSourceAssertionDraft = Omit<RelationshipInputSourceAssertion, 'assertionId' | 'origins'> & {
  origins: RelationshipInputOriginDraft[];
};

export type RelationshipInputNarrativeVector =
  | {
    status: 'present';
    modelId: string;
    modelVersion: string;
    dimensions: number;
    normalization: 'l2' | 'none';
    inputSha256: string;
    vectorSha256: string;
  }
  | {
    status: 'missing';
    modelId: string;
    modelVersion: string;
    dimensions: number;
    normalization: 'l2' | 'none';
    inputSha256: string | null;
    vectorSha256: null;
    reason: 'no_narrative' | 'model_unavailable' | 'policy_excluded' | 'failed_validation';
  };

export type RelationshipInputGovernedReference = {
  governedId: string;
  kind: 'entity' | 'site';
  registryVersion: string;
  label: string;
  origins: RelationshipInputOrigin[];
};

export type RelationshipInputGovernedReferenceDraft = Omit<RelationshipInputGovernedReference, 'origins'> & {
  origins: RelationshipInputOriginDraft[];
};

export type RelationshipInputRecord = {
  recordType: 'relationship_input_record';
  schemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  address: string;
  source: {
    sourceId: string;
    sourceRecordId: string | null;
    registryVersion: string;
    lineageId: string;
    dependencyRisk: 'low' | 'medium' | 'high' | 'unknown';
  };
  facts: RelationshipInputFact[];
  recordMissingness: Array<{
    field: string;
    status: Exclude<RelationshipInputMissingStatus, 'present'>;
    reason: string;
  }>;
  duplicateLineage: RelationshipInputDuplicateLineage | null;
  crossReferences: RelationshipInputCrossReference[];
  sourceAssertions: RelationshipInputSourceAssertion[];
  narrativeVector: RelationshipInputNarrativeVector;
  governedReferences: RelationshipInputGovernedReference[];
  claimDiscipline: typeof RELATIONSHIP_INPUT_CLAIM_DISCIPLINE;
  recordDigest: string;
};

export type RelationshipInputRecordDraft = {
  binding: RelationshipInputUniverseBinding;
  address: string;
  source: RelationshipInputRecord['source'];
  facts: RelationshipInputFactDraft[];
  recordMissingness: RelationshipInputRecord['recordMissingness'];
  duplicateLineage: null | Omit<RelationshipInputDuplicateLineage, 'origins'> & {
    origins: RelationshipInputOriginDraft[];
  };
  crossReferences: RelationshipInputCrossReferenceDraft[];
  sourceAssertions: RelationshipInputSourceAssertionDraft[];
  narrativeVector: RelationshipInputNarrativeVector;
  governedReferences: RelationshipInputGovernedReferenceDraft[];
};

export type RelationshipInputAccounting = {
  recordCount: number;
  factCount: number;
  factFamilyCounts: Record<RelationshipInputFactFamily, number>;
  missingFactCount: number;
  recordMissingFieldCount: number;
  duplicateRecordCount: number;
  crossReferenceCount: number;
  sourceAssertionCounts: Record<'independent' | 'dependent' | 'unknown', number>;
  narrativeVectorCounts: Record<'present' | 'missing', number>;
  governedReferenceCounts: Record<'entity' | 'site', number>;
  contextualExplanationFactCount: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalJsonValue = (value: unknown, seen: Set<object>): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('relationship_input_canonical_non_finite');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') throw new Error('relationship_input_canonical_value_invalid');
  if (seen.has(value)) throw new Error('relationship_input_canonical_cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonValue(item, seen)).join(',')}]`;
    if (!isPlainObject(value)) throw new Error('relationship_input_canonical_object_invalid');
    return `{${Object.keys(value).sort(compareText).map((key) => {
      const item = value[key];
      if (item === undefined) throw new Error('relationship_input_canonical_undefined');
      return `${JSON.stringify(key)}:${canonicalJsonValue(item, seen)}`;
    }).join(',')}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalizeRelationshipInput = (value: unknown) => canonicalJsonValue(value, new Set<object>());
export const relationshipInputSha256 = (value: unknown) => createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalizeRelationshipInput(value))
  .digest('hex');

function invalid(code: string): never {
  throw new Error(code);
}

const requireString = (value: unknown, code: string, maximum = 500) => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) invalid(code);
  return value;
};

const requireId = (value: unknown, code: string) => {
  const id = requireString(value, code, 240);
  if (!ID_PATTERN.test(id)) invalid(code);
  return id;
};

const requireSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(code);
  return value;
};

const requireSafeCount = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

const requireFinite = (value: unknown, code: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(code);
  return value;
};

const requireAddress = (value: unknown, code = 'relationship_input_address_invalid') => {
  const address = requireString(value, code, 512);
  const separator = address.indexOf(':');
  if (separator < 1) invalid(code);
  const kind = address.slice(0, separator) as EvidenceUniverseNodeKind;
  const recordId = address.slice(separator + 1);
  if (!NODE_KINDS.includes(kind) || evidenceUniverseAddress(kind, recordId) !== address) invalid(code);
  return address;
};

export const validateRelationshipInputAddress = (value: unknown) => requireAddress(value);

export const validateRelationshipInputBinding = (value: unknown): RelationshipInputUniverseBinding => {
  if (!isPlainObject(value)) invalid('relationship_input_binding_invalid');
  const snapshotId = requireString(value.snapshotId, 'relationship_input_snapshot_id_invalid', 36);
  if (!UUID_PATTERN.test(snapshotId)) invalid('relationship_input_snapshot_id_invalid');
  const corpusVersion = requireId(value.corpusVersion, 'relationship_input_corpus_version_invalid');
  if (
    value.universeArchiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || value.universeSchemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || value.universeLayoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
  ) invalid('relationship_input_universe_version_invalid');
  return {
    snapshotId,
    corpusVersion,
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: requireSha(
      value.universeArchiveSetSha256,
      'relationship_input_universe_archive_sha_invalid',
    ),
    universeRecordCount: requireSafeCount(value.universeRecordCount, 'relationship_input_universe_count_invalid'),
  };
};

export const assertRelationshipInputBinding = (
  actual: RelationshipInputUniverseBinding,
  expected: RelationshipInputUniverseBinding,
) => {
  const normalizedActual = validateRelationshipInputBinding(actual);
  const normalizedExpected = validateRelationshipInputBinding(expected);
  if (canonicalizeRelationshipInput(normalizedActual) !== canonicalizeRelationshipInput(normalizedExpected)) {
    invalid('relationship_input_snapshot_binding_mismatch');
  }
};

const normalizeSpan = (value: unknown): RelationshipInputSpan => {
  if (!isPlainObject(value) || value.unit !== 'utf8_byte') invalid('relationship_input_span_invalid');
  const start = requireSafeCount(value.start, 'relationship_input_span_invalid');
  const end = requireSafeCount(value.end, 'relationship_input_span_invalid', 1);
  const text = requireString(value.text, 'relationship_input_span_text_invalid', 20_000);
  if (end <= start || Buffer.byteLength(text, 'utf8') !== end - start) invalid('relationship_input_span_bounds_invalid');
  const textSha256 = requireSha(value.textSha256, 'relationship_input_span_digest_invalid');
  if (textSha256 !== relationshipInputSha256(text)) invalid('relationship_input_span_digest_mismatch');
  return { unit: 'utf8_byte', start, end, text, textSha256 };
};

const originIdentity = (origin: Omit<RelationshipInputOrigin, 'originId'>) => ({
  sourceAddress: origin.sourceAddress,
  sourceField: origin.sourceField,
  sourceTextSha256: origin.sourceTextSha256,
  sourceTextBytes: origin.sourceTextBytes,
  supportingSpans: origin.supportingSpans,
  extraction: origin.extraction,
});

const buildOrigin = (value: RelationshipInputOriginDraft | RelationshipInputOrigin): RelationshipInputOrigin => {
  if (!isPlainObject(value)) invalid('relationship_input_origin_invalid');
  const sourceAddress = requireAddress(value.sourceAddress, 'relationship_input_origin_address_invalid');
  const sourceField = requireString(value.sourceField, 'relationship_input_origin_field_invalid', 240);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:[\]-]{0,239}$/.test(sourceField)) invalid('relationship_input_origin_field_invalid');
  const sourceTextSha256 = value.sourceTextSha256 === null
    ? null
    : requireSha(value.sourceTextSha256, 'relationship_input_origin_text_digest_invalid');
  const sourceTextBytes = value.sourceTextBytes === null
    ? null
    : requireSafeCount(value.sourceTextBytes, 'relationship_input_origin_text_bytes_invalid');
  if ((sourceTextSha256 === null) !== (sourceTextBytes === null)) invalid('relationship_input_origin_text_receipt_incomplete');
  if (!Array.isArray(value.supportingSpans)) invalid('relationship_input_origin_spans_invalid');
  const supportingSpans = value.supportingSpans.map(normalizeSpan)
    .sort((left, right) => left.start - right.start || left.end - right.end || compareText(left.text, right.text));
  let previousEnd = -1;
  for (const span of supportingSpans) {
    if (sourceTextBytes === null || span.end > sourceTextBytes || span.start < previousEnd) {
      invalid('relationship_input_span_bounds_invalid');
    }
    previousEnd = span.end;
  }
  if (!isPlainObject(value.extraction)) invalid('relationship_input_origin_extraction_invalid');
  const method = value.extraction.method;
  if (!['structured', 'deterministic_rule', 'governed_model', 'manual_review'].includes(String(method))) {
    invalid('relationship_input_origin_extraction_invalid');
  }
  const version = requireId(value.extraction.version, 'relationship_input_origin_version_invalid');
  if (method !== 'structured' && !supportingSpans.length) invalid('relationship_input_origin_support_required');
  const withoutId = {
    sourceAddress,
    sourceField,
    sourceTextSha256,
    sourceTextBytes,
    supportingSpans,
    extraction: { method, version } as RelationshipInputOrigin['extraction'],
  };
  const originId = `origin:${relationshipInputSha256(originIdentity(withoutId))}`;
  if ('originId' in value && value.originId !== originId) invalid('relationship_input_origin_id_mismatch');
  return { originId, ...withoutId };
};

/**
 * Canonical public origin projector used by downstream coordinators before a
 * fact has been assembled. Keeping this as the only origin-ID entrypoint
 * prevents callers from copying the private identity/hash recipe.
 */
export const projectRelationshipInputOrigin = (
  value: RelationshipInputOriginDraft | RelationshipInputOrigin,
): RelationshipInputOrigin => buildOrigin(value);

export const relationshipInputOriginId = (
  value: RelationshipInputOriginDraft | RelationshipInputOrigin,
): string => projectRelationshipInputOrigin(value).originId;

const buildOrigins = (values: unknown, options: { required: boolean }) => {
  if (!Array.isArray(values)) invalid('relationship_input_origins_invalid');
  const origins = values.map((value) => buildOrigin(value as RelationshipInputOriginDraft | RelationshipInputOrigin))
    .sort((left, right) => compareText(left.originId, right.originId));
  if (options.required && !origins.length) invalid('relationship_input_origin_required');
  if (new Set(origins.map((origin) => origin.originId)).size !== origins.length) {
    invalid('relationship_input_duplicate_origin');
  }
  return origins;
};

const normalizeReasons = (value: unknown, code: string) => {
  if (!Array.isArray(value)) invalid(code);
  const reasons = value.map((reason) => requireId(reason, code)).sort(compareText);
  if (new Set(reasons).size !== reasons.length) invalid(code);
  return reasons;
};

const normalizeMissingness = (value: unknown): RelationshipInputMissingness => {
  if (!isPlainObject(value) || !['present', 'unknown', 'not_recorded', 'not_applicable', 'withheld'].includes(String(value.status))) {
    invalid('relationship_input_missingness_invalid');
  }
  const status = value.status as RelationshipInputMissingStatus;
  const reasons = normalizeReasons(value.reasons, 'relationship_input_missingness_invalid');
  if ((status === 'present') !== (reasons.length === 0)) invalid('relationship_input_missingness_reason_mismatch');
  return { status, reasons };
};

const normalizeUncertainty = (value: unknown): RelationshipInputUncertainty => {
  if (!isPlainObject(value) || !['none', 'low', 'medium', 'high', 'unknown'].includes(String(value.level))) {
    invalid('relationship_input_uncertainty_invalid');
  }
  const level = value.level as RelationshipInputUncertaintyLevel;
  const reasons = normalizeReasons(value.reasons, 'relationship_input_uncertainty_invalid');
  if ((level === 'none') !== (reasons.length === 0)) invalid('relationship_input_uncertainty_reason_mismatch');
  return { level, reasons };
};

const normalizePrecision = (value: unknown): RelationshipInputPrecision => {
  if (!isPlainObject(value)) invalid('relationship_input_precision_invalid');
  switch (value.kind) {
    case 'exact':
    case 'unknown':
      return { kind: value.kind };
    case 'bounded': {
      const lower = requireFinite(value.lower, 'relationship_input_precision_invalid');
      const upper = requireFinite(value.upper, 'relationship_input_precision_invalid');
      if (lower > upper) invalid('relationship_input_precision_invalid');
      return { kind: 'bounded', unit: requireId(value.unit, 'relationship_input_precision_invalid'), lower, upper };
    }
    case 'approximate': {
      const tolerance = requireFinite(value.tolerance, 'relationship_input_precision_invalid');
      if (tolerance < 0) invalid('relationship_input_precision_invalid');
      return { kind: 'approximate', unit: requireId(value.unit, 'relationship_input_precision_invalid'), tolerance };
    }
    case 'categorical':
      return { kind: 'categorical', vocabularyVersion: requireId(value.vocabularyVersion, 'relationship_input_precision_invalid') };
    default:
      return invalid('relationship_input_precision_invalid');
  }
};

const normalizeMetrics = (value: unknown) => {
  if (!isPlainObject(value)) invalid('relationship_input_context_metrics_invalid');
  const metrics: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(value).sort(compareText)) {
    if (!ID_PATTERN.test(key)) invalid('relationship_input_context_metrics_invalid');
    const metric = value[key];
    if (metric !== null && !['string', 'number', 'boolean'].includes(typeof metric)) {
      invalid('relationship_input_context_metrics_invalid');
    }
    if (typeof metric === 'number' && !Number.isFinite(metric)) invalid('relationship_input_context_metrics_invalid');
    if (typeof metric === 'string' && (metric.length > 500 || metric.trim() !== metric)) {
      invalid('relationship_input_context_metrics_invalid');
    }
    metrics[key] = metric as string | number | boolean | null;
  }
  return metrics;
};

export const isCanonicalPreciseTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const milliseconds = parsed.toISOString();
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1];
  if (!fraction || fraction.length <= 3) return milliseconds === value;
  if (fraction.length > 9 || !value.endsWith('Z')) return false;
  return `${milliseconds.slice(0, 19)}.${fraction}Z` === value;
};

const normalizeFactValue = (family: RelationshipInputFactFamily, value: unknown): RelationshipInputFact['value'] => {
  if (!isPlainObject(value)) invalid('relationship_input_fact_value_invalid');
  if (family === 'provenance') {
    if (value.kind !== 'provenance' || !['source_record', 'duplicate_cluster', 'cross_reference', 'ingestion_lineage', 'media_attachment'].includes(String(value.code))) {
      invalid('relationship_input_fact_value_invalid');
    }
    return { kind: 'provenance', code: value.code as RelationshipInputProvenanceValue['code'], referenceId: requireId(value.referenceId, 'relationship_input_fact_value_invalid') };
  }
  if (family === 'space_time') {
    if (value.kind === 'timestamp') {
      if (!['exact', 'hour', 'day', 'month', 'year', 'unknown'].includes(String(value.datePrecision))) {
        invalid('relationship_input_fact_value_invalid');
      }
      const timestamp = requireString(value.timestamp, 'relationship_input_fact_value_invalid', 80);
      // Evidence-universe v2 preserves PostgreSQL microsecond precision. Do
      // not silently truncate that evidence merely because JavaScript Date
      // exposes only milliseconds.
      if (!isCanonicalPreciseTimestamp(timestamp)) invalid('relationship_input_fact_value_invalid');
      return { kind: 'timestamp', timestamp, datePrecision: value.datePrecision as RelationshipInputTimestampValue['datePrecision'] };
    }
    if (value.kind === 'geo_point') {
      const lat = requireFinite(value.lat, 'relationship_input_fact_value_invalid');
      const lon = requireFinite(value.lon, 'relationship_input_fact_value_invalid');
      const spatialPrecisionKm = requireFinite(value.spatialPrecisionKm, 'relationship_input_fact_value_invalid');
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || spatialPrecisionKm < 0) {
        invalid('relationship_input_fact_value_invalid');
      }
      return { kind: 'geo_point', lat, lon, spatialPrecisionKm };
    }
    return invalid('relationship_input_fact_value_invalid');
  }
  if (['visual', 'behavioural', 'sensory'].includes(family)) {
    if (value.kind !== 'term') invalid('relationship_input_fact_value_invalid');
    return {
      kind: 'term',
      termId: requireId(value.termId, 'relationship_input_fact_value_invalid'),
      vocabularyVersion: requireId(value.vocabularyVersion, 'relationship_input_fact_value_invalid'),
    };
  }
  if (family === 'duration') {
    const seconds = value.kind === 'duration' ? requireFinite(value.seconds, 'relationship_input_fact_value_invalid') : -1;
    if (seconds < 0) invalid('relationship_input_fact_value_invalid');
    return { kind: 'duration', seconds };
  }
  if (family === 'entity' || family === 'site') {
    if (value.kind !== 'governed_reference') invalid('relationship_input_fact_value_invalid');
    return {
      kind: 'governed_reference',
      governedId: requireId(value.governedId, 'relationship_input_fact_value_invalid'),
      registryVersion: requireId(value.registryVersion, 'relationship_input_fact_value_invalid'),
    };
  }
  if (family === 'narrative_pattern') {
    if (value.kind !== 'narrative_pattern') invalid('relationship_input_fact_value_invalid');
    return {
      kind: 'narrative_pattern',
      patternId: requireId(value.patternId, 'relationship_input_fact_value_invalid'),
      registryVersion: requireId(value.registryVersion, 'relationship_input_fact_value_invalid'),
    };
  }
  if (family === 'contextual_explanation') {
    if (
      value.kind !== 'contextual_explanation'
      || !['aircraft', 'satellite', 'astronomical', 'meteorological', 'balloon', 'human_activity', 'other'].includes(String(value.explanationType))
      || !['candidate', 'ruled_out', 'unknown'].includes(String(value.matchStatus))
      || value.interpretation !== 'candidate_explanation_not_causal_attribution'
    ) invalid('relationship_input_context_claim_invalid');
    return {
      kind: 'contextual_explanation',
      explanationType: value.explanationType as RelationshipInputContextValue['explanationType'],
      referenceId: requireId(value.referenceId, 'relationship_input_fact_value_invalid'),
      matchStatus: value.matchStatus as RelationshipInputContextValue['matchStatus'],
      interpretation: 'candidate_explanation_not_causal_attribution',
      metrics: normalizeMetrics(value.metrics),
    };
  }
  return invalid('relationship_input_fact_family_invalid');
};

const factIdentity = (fact: Omit<RelationshipInputFact, 'factId'>, address: string) => ({
  address,
  family: fact.family,
  predicate: fact.predicate,
  value: fact.value,
  origins: fact.origins.map((origin) => origin.originId),
});

const buildFact = (
  value: RelationshipInputFactDraft | RelationshipInputFact,
  address: string,
): RelationshipInputFact => {
  if (!isPlainObject(value) || !FACT_FAMILIES.includes(value.family as RelationshipInputFactFamily)) {
    invalid('relationship_input_fact_family_invalid');
  }
  const family = value.family as RelationshipInputFactFamily;
  const predicate = requireId(value.predicate, 'relationship_input_fact_predicate_invalid');
  const missingness = normalizeMissingness(value.missingness);
  const confidence = value.confidence === null ? null : requireFinite(value.confidence, 'relationship_input_confidence_invalid');
  if (confidence !== null && (confidence < 0 || confidence > 1)) invalid('relationship_input_confidence_invalid');
  if ((missingness.status === 'present') !== (value.value !== null && confidence !== null)) {
    invalid('relationship_input_fact_missingness_mismatch');
  }
  const origins = buildOrigins(value.origins, { required: missingness.status === 'present' });
  const factWithoutId = {
    family,
    predicate,
    value: value.value === null ? null : normalizeFactValue(family, value.value),
    confidence,
    uncertainty: normalizeUncertainty(value.uncertainty),
    precision: normalizePrecision(value.precision),
    missingness,
    origins,
  } as Omit<RelationshipInputFact, 'factId'>;
  if (missingness.status !== 'present' && factWithoutId.precision.kind !== 'unknown') {
    invalid('relationship_input_missing_fact_precision_invalid');
  }
  if (missingness.status !== 'present' && factWithoutId.uncertainty.level === 'none') {
    invalid('relationship_input_missing_fact_uncertainty_invalid');
  }
  const factId = `fact:${relationshipInputSha256(factIdentity(factWithoutId, address))}`;
  if ('factId' in value && value.factId !== factId) invalid('relationship_input_fact_id_mismatch');
  return { factId, ...factWithoutId } as RelationshipInputFact;
};

const buildDuplicateLineage = (
  value: RelationshipInputRecordDraft['duplicateLineage'] | RelationshipInputDuplicateLineage,
  address: string,
): RelationshipInputDuplicateLineage | null => {
  if (value === null) return null;
  if (!isPlainObject(value) || !['candidate', 'confirmed'].includes(String(value.status)) || !['canonical', 'duplicate'].includes(String(value.memberRole))) {
    invalid('relationship_input_duplicate_lineage_invalid');
  }
  const canonicalAddress = requireAddress(value.canonicalAddress, 'relationship_input_duplicate_lineage_invalid');
  if ((value.memberRole === 'canonical') !== (canonicalAddress === address)) {
    invalid('relationship_input_duplicate_member_role_invalid');
  }
  return {
    clusterId: requireId(value.clusterId, 'relationship_input_duplicate_lineage_invalid'),
    status: value.status as RelationshipInputDuplicateLineage['status'],
    canonicalAddress,
    memberRole: value.memberRole as RelationshipInputDuplicateLineage['memberRole'],
    origins: buildOrigins(value.origins, { required: true }),
  };
};

const buildCrossReference = (
  value: RelationshipInputCrossReferenceDraft | RelationshipInputCrossReference,
  address: string,
): RelationshipInputCrossReference => {
  if (!isPlainObject(value) || !['cites', 'same_source_record', 'duplicate_of', 'derived_from', 'media_attachment'].includes(String(value.relation))) {
    invalid('relationship_input_cross_reference_invalid');
  }
  const targetAddress = requireAddress(value.targetAddress, 'relationship_input_cross_reference_invalid');
  if (targetAddress === address) invalid('relationship_input_cross_reference_self');
  const relation = value.relation as RelationshipInputCrossReference['relation'];
  const origins = buildOrigins(value.origins, { required: true });
  const referenceId = `xref:${relationshipInputSha256({ address, targetAddress, relation, origins: origins.map((origin) => origin.originId) })}`;
  if ('referenceId' in value && value.referenceId !== referenceId) invalid('relationship_input_cross_reference_id_mismatch');
  return { referenceId, targetAddress, relation, origins };
};

const buildSourceAssertion = (
  value: RelationshipInputSourceAssertionDraft | RelationshipInputSourceAssertion,
  sourceId: string,
): RelationshipInputSourceAssertion => {
  if (!isPlainObject(value) || !['independent', 'dependent', 'unknown'].includes(String(value.classification))) {
    invalid('relationship_input_source_assertion_invalid');
  }
  const classification = value.classification as RelationshipInputSourceAssertion['classification'];
  const basis = String(value.basis) as RelationshipInputSourceAssertion['basis'];
  const allowedBasis: Record<typeof classification, RelationshipInputSourceAssertion['basis'][]> = {
    independent: ['documented_separate_origin', 'governed_review'],
    dependent: ['same_lineage', 'explicit_upstream', 'same_source_record', 'governed_review'],
    unknown: ['insufficient_evidence'],
  };
  if (!allowedBasis[classification].includes(basis)) invalid('relationship_input_source_assertion_basis_invalid');
  const counterpartySourceId = requireId(value.counterpartySourceId, 'relationship_input_source_assertion_invalid');
  if (counterpartySourceId === sourceId) {
    if (classification !== 'dependent' || !['same_lineage', 'same_source_record'].includes(basis)) {
      invalid('relationship_input_same_source_independence_invalid');
    }
  }
  const origins = buildOrigins(value.origins, { required: classification !== 'unknown' });
  const assertionId = `source-assertion:${relationshipInputSha256({ sourceId, counterpartySourceId, classification, basis, origins: origins.map((origin) => origin.originId) })}`;
  if ('assertionId' in value && value.assertionId !== assertionId) invalid('relationship_input_source_assertion_id_mismatch');
  return { assertionId, counterpartySourceId, classification, basis, origins };
};

const normalizeNarrativeVector = (value: unknown): RelationshipInputNarrativeVector => {
  if (!isPlainObject(value) || !['present', 'missing'].includes(String(value.status))) {
    invalid('relationship_input_narrative_vector_invalid');
  }
  const modelId = requireId(value.modelId, 'relationship_input_narrative_vector_invalid');
  const modelVersion = requireId(value.modelVersion, 'relationship_input_narrative_vector_invalid');
  const dimensions = requireSafeCount(value.dimensions, 'relationship_input_narrative_vector_invalid', 1);
  if (dimensions > 65_536 || !['l2', 'none'].includes(String(value.normalization))) {
    invalid('relationship_input_narrative_vector_invalid');
  }
  const normalization = value.normalization as 'l2' | 'none';
  if (value.status === 'present') {
    return {
      status: 'present', modelId, modelVersion, dimensions, normalization,
      inputSha256: requireSha(value.inputSha256, 'relationship_input_narrative_vector_invalid'),
      vectorSha256: requireSha(value.vectorSha256, 'relationship_input_narrative_vector_invalid'),
    };
  }
  if (!['no_narrative', 'model_unavailable', 'policy_excluded', 'failed_validation'].includes(String(value.reason)) || value.vectorSha256 !== null) {
    invalid('relationship_input_narrative_vector_invalid');
  }
  return {
    status: 'missing', modelId, modelVersion, dimensions, normalization,
    inputSha256: value.inputSha256 === null ? null : requireSha(value.inputSha256, 'relationship_input_narrative_vector_invalid'),
    vectorSha256: null,
    reason: value.reason as Extract<RelationshipInputNarrativeVector, { status: 'missing' }>['reason'],
  };
};

const buildGovernedReference = (
  value: RelationshipInputGovernedReferenceDraft | RelationshipInputGovernedReference,
): RelationshipInputGovernedReference => {
  if (!isPlainObject(value) || !['entity', 'site'].includes(String(value.kind))) {
    invalid('relationship_input_governed_reference_invalid');
  }
  return {
    governedId: requireId(value.governedId, 'relationship_input_governed_reference_invalid'),
    kind: value.kind as 'entity' | 'site',
    registryVersion: requireId(value.registryVersion, 'relationship_input_governed_reference_invalid'),
    label: requireString(value.label, 'relationship_input_governed_reference_invalid', 500),
    origins: buildOrigins(value.origins, { required: true }),
  };
};

const normalizeRecordMissingness = (value: unknown): RelationshipInputRecord['recordMissingness'] => {
  if (!Array.isArray(value)) invalid('relationship_input_record_missingness_invalid');
  const normalized = value.map((item) => {
    if (!isPlainObject(item) || !['unknown', 'not_recorded', 'not_applicable', 'withheld'].includes(String(item.status))) {
      invalid('relationship_input_record_missingness_invalid');
    }
    return {
      field: requireString(item.field, 'relationship_input_record_missingness_invalid', 240),
      status: item.status as Exclude<RelationshipInputMissingStatus, 'present'>,
      reason: requireId(item.reason, 'relationship_input_record_missingness_invalid'),
    };
  }).sort((left, right) => compareText(left.field, right.field));
  if (new Set(normalized.map((item) => item.field)).size !== normalized.length) {
    invalid('relationship_input_record_missingness_duplicate');
  }
  return normalized;
};

const claimDisciplineMatches = (value: unknown) => (
  isPlainObject(value)
  && value.semantics === RELATIONSHIP_INPUT_CLAIM_DISCIPLINE.semantics
  && value.extraordinaryOrigin === RELATIONSHIP_INPUT_CLAIM_DISCIPLINE.extraordinaryOrigin
  && value.notice === RELATIONSHIP_INPUT_CLAIM_DISCIPLINE.notice
);

const recordWithoutDigest = (record: Omit<RelationshipInputRecord, 'recordDigest'>) => record;

const buildRecord = (
  input: RelationshipInputRecordDraft | RelationshipInputRecord,
  options: { verifyDigest: boolean; expectedBinding?: RelationshipInputUniverseBinding },
): RelationshipInputRecord => {
  if (!isPlainObject(input)) invalid('relationship_input_record_invalid');
  if ('recordType' in input && input.recordType !== 'relationship_input_record') invalid('relationship_input_record_type_invalid');
  if ('schemaVersion' in input && input.schemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION) invalid('relationship_input_schema_version_invalid');
  if ('canonicalVersion' in input && input.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION) invalid('relationship_input_canonical_version_invalid');
  if ('claimDiscipline' in input && !claimDisciplineMatches(input.claimDiscipline)) invalid('relationship_input_claim_discipline_invalid');
  const binding = validateRelationshipInputBinding(input.binding);
  if (options.expectedBinding) assertRelationshipInputBinding(binding, options.expectedBinding);
  const address = requireAddress(input.address);
  if (!isPlainObject(input.source)) invalid('relationship_input_source_invalid');
  const source = {
    sourceId: requireId(input.source.sourceId, 'relationship_input_source_invalid'),
    sourceRecordId: input.source.sourceRecordId === null
      ? null
      : requireString(input.source.sourceRecordId, 'relationship_input_source_invalid', 500),
    registryVersion: requireId(input.source.registryVersion, 'relationship_input_source_invalid'),
    lineageId: requireId(input.source.lineageId, 'relationship_input_source_invalid'),
    dependencyRisk: input.source.dependencyRisk,
  };
  if (!['low', 'medium', 'high', 'unknown'].includes(String(source.dependencyRisk))) invalid('relationship_input_source_invalid');
  if (!Array.isArray(input.facts)) invalid('relationship_input_facts_invalid');
  const facts = input.facts.map((fact) => buildFact(fact, address)).sort((left, right) => compareText(left.factId, right.factId));
  if (new Set(facts.map((fact) => fact.factId)).size !== facts.length) invalid('relationship_input_duplicate_fact');
  const duplicateLineage = buildDuplicateLineage(input.duplicateLineage, address);
  if (!Array.isArray(input.crossReferences) || !Array.isArray(input.sourceAssertions) || !Array.isArray(input.governedReferences)) {
    invalid('relationship_input_record_collections_invalid');
  }
  const crossReferences = input.crossReferences.map((reference) => buildCrossReference(reference, address))
    .sort((left, right) => compareText(left.referenceId, right.referenceId));
  const sourceAssertions = input.sourceAssertions.map((assertion) => buildSourceAssertion(assertion, source.sourceId))
    .sort((left, right) => compareText(left.assertionId, right.assertionId));
  const governedReferences = input.governedReferences.map(buildGovernedReference)
    .sort((left, right) => compareText(left.kind, right.kind) || compareText(left.governedId, right.governedId));
  if (new Set(crossReferences.map((item) => item.referenceId)).size !== crossReferences.length) invalid('relationship_input_duplicate_cross_reference');
  if (new Set(sourceAssertions.map((item) => item.assertionId)).size !== sourceAssertions.length) invalid('relationship_input_duplicate_source_assertion');
  if (new Set(governedReferences.map((item) => `${item.kind}:${item.governedId}`)).size !== governedReferences.length) {
    invalid('relationship_input_duplicate_governed_reference');
  }
  const governedById = new Map(governedReferences.map((item) => [item.governedId, item]));
  for (const fact of facts) {
    if ((fact.family === 'entity' || fact.family === 'site') && fact.value) {
      const reference = governedById.get(fact.value.governedId);
      if (!reference || reference.kind !== fact.family || reference.registryVersion !== fact.value.registryVersion) {
        invalid('relationship_input_fact_governed_reference_mismatch');
      }
    }
  }
  const duplicateProvenanceFacts = facts.filter((fact) => fact.family === 'provenance'
      && fact.value?.kind === 'provenance'
      && fact.value.code === 'duplicate_cluster');
  if (duplicateLineage) {
    const hasProvenance = duplicateProvenanceFacts.some((fact) => fact.value?.kind === 'provenance'
      && fact.value.referenceId === duplicateLineage.clusterId);
    if (!hasProvenance) invalid('relationship_input_duplicate_provenance_missing');
  } else if (duplicateProvenanceFacts.length) {
    invalid('relationship_input_orphan_duplicate_provenance');
  }
  const withoutDigest: Omit<RelationshipInputRecord, 'recordDigest'> = {
    recordType: 'relationship_input_record',
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    address,
    source,
    facts,
    recordMissingness: normalizeRecordMissingness(input.recordMissingness),
    duplicateLineage,
    crossReferences,
    sourceAssertions,
    narrativeVector: normalizeNarrativeVector(input.narrativeVector),
    governedReferences,
    claimDiscipline: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  };
  const recordDigest = relationshipInputSha256(recordWithoutDigest(withoutDigest));
  if (options.verifyDigest && (!('recordDigest' in input) || input.recordDigest !== recordDigest)) {
    invalid('relationship_input_record_digest_mismatch');
  }
  return { ...withoutDigest, recordDigest };
};

export const buildRelationshipInputRecord = (input: RelationshipInputRecordDraft): RelationshipInputRecord => (
  buildRecord(input, { verifyDigest: false })
);

export const decodeRelationshipInputRecord = (
  input: Buffer | string | unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): RelationshipInputRecord => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      invalid('relationship_input_record_json_invalid');
    }
  }
  const decoded = buildRecord(value as RelationshipInputRecord, { verifyDigest: true, expectedBinding });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(decoded)) {
    invalid('relationship_input_record_non_canonical');
  }
  return decoded;
};

const emptyFamilyCounts = (): Record<RelationshipInputFactFamily, number> => ({
  provenance: 0,
  space_time: 0,
  visual: 0,
  behavioural: 0,
  sensory: 0,
  duration: 0,
  entity: 0,
  site: 0,
  narrative_pattern: 0,
  contextual_explanation: 0,
});

export const accountRelationshipInputRecords = (
  records: readonly RelationshipInputRecord[],
  expectedBinding?: RelationshipInputUniverseBinding,
): RelationshipInputAccounting => {
  const factFamilyCounts = emptyFamilyCounts();
  const sourceAssertionCounts = { independent: 0, dependent: 0, unknown: 0 };
  const narrativeVectorCounts = { present: 0, missing: 0 };
  const governedReferenceCounts = { entity: 0, site: 0 };
  const addresses = new Set<string>();
  let factCount = 0;
  let missingFactCount = 0;
  let recordMissingFieldCount = 0;
  let duplicateRecordCount = 0;
  let crossReferenceCount = 0;
  let contextualExplanationFactCount = 0;
  for (const rawRecord of records) {
    const record = decodeRelationshipInputRecord(rawRecord, expectedBinding);
    if (addresses.has(record.address)) invalid(`relationship_input_duplicate_address:${record.address}`);
    addresses.add(record.address);
    factCount += record.facts.length;
    recordMissingFieldCount += record.recordMissingness.length;
    duplicateRecordCount += record.duplicateLineage ? 1 : 0;
    crossReferenceCount += record.crossReferences.length;
    narrativeVectorCounts[record.narrativeVector.status] += 1;
    for (const fact of record.facts) {
      factFamilyCounts[fact.family] += 1;
      if (fact.missingness.status !== 'present') missingFactCount += 1;
      if (fact.family === 'contextual_explanation') contextualExplanationFactCount += 1;
    }
    for (const assertion of record.sourceAssertions) sourceAssertionCounts[assertion.classification] += 1;
    for (const reference of record.governedReferences) governedReferenceCounts[reference.kind] += 1;
  }
  return {
    recordCount: records.length,
    factCount,
    factFamilyCounts,
    missingFactCount,
    recordMissingFieldCount,
    duplicateRecordCount,
    crossReferenceCount,
    sourceAssertionCounts,
    narrativeVectorCounts,
    governedReferenceCounts,
    contextualExplanationFactCount,
  };
};
