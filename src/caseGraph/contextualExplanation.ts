import { createHash } from 'node:crypto';

export const CONTEXTUAL_EXPLANATION_SCHEMA_VERSION = 'case-graph-contextual-explanation-v1' as const;
export const CONTEXTUAL_EXPLANATION_CANONICAL_VERSION = 'case-graph-canonical-json-v1' as const;
export const CONTEXTUAL_EXPLANATION_POLICY_VERSION = 'case-graph-contextual-correlation-policy-v2' as const;

export const CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE = Object.freeze({
  semantics: 'candidate_contextual_correlation_not_causal_attribution',
  causality: 'not_assessed',
  debunking: 'not_assessed',
  origin: 'not_assessed',
  extraordinaryOrigin: 'not_assessed',
  notice: 'A contextual edge records a bounded correlation candidate. It is not a causal attribution, debunking conclusion, or assessment of ordinary or extraordinary origin.',
} as const);

export type ContextualExplanationKind = 'aircraft' | 'satellite' | 'astronomy' | 'weather';
export type ContextualExplanationEdgeType =
  | 'context_aircraft_candidate'
  | 'context_satellite_candidate'
  | 'context_astronomy_candidate'
  | 'context_weather_candidate';
export type ContextualUncertaintyLevel = 'none' | 'low' | 'medium' | 'high' | 'unknown';
export type ContextualMissingStatus = 'unknown' | 'not_recorded' | 'unavailable' | 'withheld' | 'not_applicable';
export type ContextualProvenanceRole = 'subject_observation' | 'context_reference' | 'correlation_method';
export type ContextualEvidenceMethod = 'measured' | 'catalogue' | 'deterministic_rule' | 'model_output';

export type ContextualObservationWindow = {
  start: string;
  end: string;
  precisionSeconds: number;
};

export type ContextualGeoPosition = {
  lat: number;
  lon: number;
  precisionKm: number;
};

export type ContextualSkyPosition = {
  azimuthDeg: number;
  elevationDeg: number;
  precisionDeg: number;
};

export type ContextualObservation = {
  window: ContextualObservationWindow | null;
  location: ContextualGeoPosition | null;
  skyPosition: ContextualSkyPosition | null;
};

export type ContextualProvenanceDraft = {
  sourceRef: string;
  role: ContextualProvenanceRole;
  providerId: string;
  sourceRecordId: string;
  datasetVersion: string;
  retrievedAt: string;
  contentSha256: string;
  sourceUri: string | null;
};

export type ContextualProvenance = ContextualProvenanceDraft & {
  provenanceId: string;
};

export type AircraftDomainEvidenceCode = 'track_coverage_fraction';
export type SatelliteDomainEvidenceCode = 'track_coverage_fraction' | 'orbit_epoch_age_hours';
export type AstronomyDomainEvidenceCode = 'ephemeris_accuracy_deg';
export type WeatherDomainEvidenceCode = 'observation_coverage_fraction' | 'phenomenon_match_score';
export type ContextualDomainEvidenceCode =
  | AircraftDomainEvidenceCode
  | SatelliteDomainEvidenceCode
  | AstronomyDomainEvidenceCode
  | WeatherDomainEvidenceCode;

export type ContextualDomainEvidenceDraft<C extends ContextualDomainEvidenceCode = ContextualDomainEvidenceCode> = {
  code: C;
  value: number;
  precision: number;
  method: ContextualEvidenceMethod;
  methodVersion: string;
  sourceRefs: string[];
};

type ContextualCandidateShape<K extends ContextualExplanationKind, C extends ContextualDomainEvidenceCode> = {
  kind: K;
  subjectAddress: string;
  reference: {
    referenceId: string;
    label: string;
  };
  subjectObservation: ContextualObservation;
  referenceObservation: ContextualObservation;
  provenance: ContextualProvenanceDraft[];
  domainEvidence: ContextualDomainEvidenceDraft<C>[];
  missingness: Array<{
    field: string;
    status: ContextualMissingStatus;
    reason: string;
  }>;
  uncertainty: {
    level: ContextualUncertaintyLevel;
    reasons: string[];
  };
  model: {
    modelId: string;
    modelVersion: string;
    method: 'deterministic' | 'governed_model';
    inputSha256: string;
    outputSha256: string;
  };
};

export type AircraftContextCandidateDraft = ContextualCandidateShape<'aircraft', AircraftDomainEvidenceCode>;
export type SatelliteContextCandidateDraft = ContextualCandidateShape<'satellite', SatelliteDomainEvidenceCode>;
export type AstronomyContextCandidateDraft = ContextualCandidateShape<'astronomy', AstronomyDomainEvidenceCode>;
export type WeatherContextCandidateDraft = ContextualCandidateShape<'weather', WeatherDomainEvidenceCode>;
export type ContextualExplanationCandidateDraft =
  | AircraftContextCandidateDraft
  | SatelliteContextCandidateDraft
  | AstronomyContextCandidateDraft
  | WeatherContextCandidateDraft;

export type ContextualMatchingEvidenceCode =
  | 'temporal_gap_seconds'
  | 'surface_distance_km'
  | 'angular_separation_deg'
  | ContextualDomainEvidenceCode;

export type ContextualMatchingEvidence = {
  evidenceId: string;
  code: ContextualMatchingEvidenceCode;
  value: number;
  unit: 'seconds' | 'kilometres' | 'degrees' | 'hours' | 'ratio';
  precision: number;
  lowerBound: number;
  upperBound: number;
  derivation: 'derived_from_observations' | 'supplied_context_evidence';
  method: ContextualEvidenceMethod;
  methodVersion: string;
  provenanceIds: string[];
};

export type ContextualPolicyCheck = {
  code: string;
  status: 'pass' | 'fail';
  actual: number;
  operator: 'less_than_or_equal' | 'greater_than_or_equal';
  threshold: number;
  unit: 'seconds' | 'kilometres' | 'degrees' | 'hours' | 'ratio' | 'count' | 'rank';
  evidenceIds: string[];
};

export type ContextualExplanationReceipt = {
  recordType: 'contextual_explanation_evaluation';
  schemaVersion: typeof CONTEXTUAL_EXPLANATION_SCHEMA_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  receiptId: string;
  decision: 'emit_candidate_edge' | 'insufficient_evidence';
  kind: ContextualExplanationKind;
  subjectAddress: string;
  contextReferenceId: string;
  inputSha256: string;
  observationSha256: string;
  provenanceSetSha256: string;
  matchingEvidenceSetSha256: string;
  policyVersion: typeof CONTEXTUAL_EXPLANATION_POLICY_VERSION;
  policySha256: string;
  model: ContextualCandidateShape<ContextualExplanationKind, ContextualDomainEvidenceCode>['model'];
  checks: ContextualPolicyCheck[];
  failedChecks: string[];
  missingness: ContextualCandidateShape<ContextualExplanationKind, ContextualDomainEvidenceCode>['missingness'];
  claimDiscipline: typeof CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE;
  plainEnglish: string;
};

export type ContextualExplanationEdge = {
  recordType: 'contextual_explanation_edge';
  schemaVersion: typeof CONTEXTUAL_EXPLANATION_SCHEMA_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  edgeId: string;
  edgeType: ContextualExplanationEdgeType;
  kind: ContextualExplanationKind;
  subjectAddress: string;
  contextNodeId: string;
  reference: ContextualCandidateShape<ContextualExplanationKind, ContextualDomainEvidenceCode>['reference'];
  observations: {
    subject: ContextualObservation;
    reference: ContextualObservation;
  };
  provenance: ContextualProvenance[];
  matchingEvidence: ContextualMatchingEvidence[];
  missingness: ContextualCandidateShape<ContextualExplanationKind, ContextualDomainEvidenceCode>['missingness'];
  uncertainty: ContextualCandidateShape<ContextualExplanationKind, ContextualDomainEvidenceCode>['uncertainty'];
  model: ContextualCandidateShape<ContextualExplanationKind, ContextualDomainEvidenceCode>['model'];
  policy: {
    version: typeof CONTEXTUAL_EXPLANATION_POLICY_VERSION;
    sha256: string;
  };
  claimDiscipline: typeof CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE;
  explanation: {
    plainEnglish: string;
  };
  receipt: ContextualExplanationReceipt;
};

export type ContextualExplanationEvaluation = {
  edge: ContextualExplanationEdge | null;
  receipt: ContextualExplanationReceipt;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const ADDRESS_PATTERN = /^(sighting|document|photo|video):[^\s:][^\r\n]{0,510}$/;
const KINDS: readonly ContextualExplanationKind[] = ['aircraft', 'satellite', 'astronomy', 'weather'];
const UNCERTAINTY_RANK: Readonly<Record<ContextualUncertaintyLevel, number>> = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  unknown: 4,
});

const lexical = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalJsonValue = (value: unknown, seen: Set<object>): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('contextual_explanation_canonical_non_finite');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') throw new Error('contextual_explanation_canonical_value_invalid');
  if (seen.has(value)) throw new Error('contextual_explanation_canonical_cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJsonValue(item, seen)).join(',')}]`;
    }
    if (!isPlainObject(value)) throw new Error('contextual_explanation_canonical_object_invalid');
    return `{${Object.keys(value).sort(lexical).map((key) => {
      const item = value[key];
      if (item === undefined) throw new Error('contextual_explanation_canonical_undefined');
      return `${JSON.stringify(key)}:${canonicalJsonValue(item, seen)}`;
    }).join(',')}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalizeContextualExplanation = (value: unknown) => canonicalJsonValue(value, new Set<object>());
export const contextualExplanationSha256 = (value: unknown) => createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalizeContextualExplanation(value))
  .digest('hex');

type PolicyThresholds = {
  maxSubjectTimePrecisionSeconds: number;
  maxReferenceTimePrecisionSeconds: number;
  maxSubjectWindowSpanSeconds: number;
  maxReferenceWindowSpanSeconds: number;
  maxSubjectLocationPrecisionKm: number;
  maxReferenceLocationPrecisionKm: number | null;
  maxSubjectSkyPrecisionDeg: number | null;
  maxReferenceSkyPrecisionDeg: number | null;
  minimumSubjectElevationLowerDeg: number | null;
  maxTemporalGapUpperSeconds: number;
  maxSurfaceDistanceUpperKm: number | null;
  maxAngularSeparationUpperDeg: number | null;
  minimumReferenceElevationLowerDeg: number | null;
  maximumUncertaintyRank: number;
  domain: Partial<Record<ContextualDomainEvidenceCode, { operator: 'max' | 'min'; threshold: number }>>;
};

const freezePolicy = (thresholds: PolicyThresholds): Readonly<PolicyThresholds> => {
  const domain = Object.fromEntries(Object.entries(thresholds.domain).map(([code, threshold]) => [
    code,
    threshold ? Object.freeze({ ...threshold }) : threshold,
  ])) as PolicyThresholds['domain'];
  return Object.freeze({
    ...thresholds,
    domain: Object.freeze(domain),
  });
};

const POLICY_THRESHOLDS: Readonly<Record<ContextualExplanationKind, Readonly<PolicyThresholds>>> = Object.freeze({
  aircraft: freezePolicy({
    maxSubjectTimePrecisionSeconds: 60,
    maxReferenceTimePrecisionSeconds: 30,
    maxSubjectWindowSpanSeconds: 1_800,
    maxReferenceWindowSpanSeconds: 1_800,
    maxSubjectLocationPrecisionKm: 10,
    maxReferenceLocationPrecisionKm: 2,
    maxSubjectSkyPrecisionDeg: 3,
    maxReferenceSkyPrecisionDeg: 1,
    minimumSubjectElevationLowerDeg: 0,
    maxTemporalGapUpperSeconds: 300,
    maxSurfaceDistanceUpperKm: 50,
    maxAngularSeparationUpperDeg: 8,
    minimumReferenceElevationLowerDeg: 0,
    maximumUncertaintyRank: 2,
    domain: { track_coverage_fraction: { operator: 'min', threshold: 0.8 } },
  }),
  satellite: freezePolicy({
    maxSubjectTimePrecisionSeconds: 60,
    maxReferenceTimePrecisionSeconds: 10,
    maxSubjectWindowSpanSeconds: 900,
    maxReferenceWindowSpanSeconds: 900,
    maxSubjectLocationPrecisionKm: 10,
    maxReferenceLocationPrecisionKm: null,
    maxSubjectSkyPrecisionDeg: 3,
    maxReferenceSkyPrecisionDeg: 0.5,
    minimumSubjectElevationLowerDeg: 0,
    maxTemporalGapUpperSeconds: 120,
    maxSurfaceDistanceUpperKm: null,
    maxAngularSeparationUpperDeg: 5,
    minimumReferenceElevationLowerDeg: 0,
    maximumUncertaintyRank: 2,
    domain: {
      track_coverage_fraction: { operator: 'min', threshold: 0.8 },
      orbit_epoch_age_hours: { operator: 'max', threshold: 72 },
    },
  }),
  astronomy: freezePolicy({
    maxSubjectTimePrecisionSeconds: 300,
    maxReferenceTimePrecisionSeconds: 60,
    maxSubjectWindowSpanSeconds: 3_600,
    maxReferenceWindowSpanSeconds: 3_600,
    maxSubjectLocationPrecisionKm: 25,
    maxReferenceLocationPrecisionKm: null,
    maxSubjectSkyPrecisionDeg: 3,
    maxReferenceSkyPrecisionDeg: 0.25,
    minimumSubjectElevationLowerDeg: 0,
    maxTemporalGapUpperSeconds: 600,
    maxSurfaceDistanceUpperKm: null,
    maxAngularSeparationUpperDeg: 5,
    minimumReferenceElevationLowerDeg: 0,
    maximumUncertaintyRank: 2,
    domain: { ephemeris_accuracy_deg: { operator: 'max', threshold: 0.25 } },
  }),
  weather: freezePolicy({
    maxSubjectTimePrecisionSeconds: 300,
    maxReferenceTimePrecisionSeconds: 900,
    maxSubjectWindowSpanSeconds: 10_800,
    maxReferenceWindowSpanSeconds: 10_800,
    maxSubjectLocationPrecisionKm: 25,
    maxReferenceLocationPrecisionKm: 25,
    maxSubjectSkyPrecisionDeg: null,
    maxReferenceSkyPrecisionDeg: null,
    minimumSubjectElevationLowerDeg: null,
    maxTemporalGapUpperSeconds: 900,
    maxSurfaceDistanceUpperKm: 75,
    maxAngularSeparationUpperDeg: null,
    minimumReferenceElevationLowerDeg: null,
    maximumUncertaintyRank: 2,
    domain: {
      observation_coverage_fraction: { operator: 'min', threshold: 0.5 },
      phenomenon_match_score: { operator: 'min', threshold: 0.8 },
    },
  }),
});

export const CONTEXTUAL_EXPLANATION_POLICY = Object.freeze({
  version: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  thresholds: POLICY_THRESHOLDS,
  comparison: 'conservative_uncertainty_bound',
  output: 'candidate_context_only',
} as const);
export const CONTEXTUAL_EXPLANATION_POLICY_SHA256 = contextualExplanationSha256(CONTEXTUAL_EXPLANATION_POLICY);

function invalid(code: string): never {
  throw new Error(code);
}

function assertPlainObject(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) invalid(code);
}

function assertArray(value: unknown, code: string): asserts value is unknown[] {
  if (!Array.isArray(value)) invalid(code);
}

const requireExactKeys = (value: Record<string, unknown>, expected: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(lexical);
  const normalizedExpected = [...expected].sort(lexical);
  if (actual.length !== normalizedExpected.length || actual.some((key, index) => key !== normalizedExpected[index])) {
    invalid(code);
  }
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

const requireSha = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(code);
  return value as string;
};

const requireFinite = (value: unknown, code: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(code);
  return Object.is(value, -0) ? 0 : value as number;
};

const requireNonNegative = (value: unknown, code: string): number => {
  const number = requireFinite(value, code);
  if (number < 0) invalid(code);
  return number;
};

const requireTimestamp = (value: unknown, code: string): string => {
  const timestamp = requireString(value, code, 40);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) invalid(code);
  return timestamp;
};

const normalizeWindow = (value: unknown): ContextualObservationWindow | null => {
  if (value === null) return null;
  assertPlainObject(value, 'contextual_explanation_window_invalid');
  requireExactKeys(value, ['start', 'end', 'precisionSeconds'], 'contextual_explanation_window_invalid');
  const start = requireTimestamp(value.start, 'contextual_explanation_window_invalid');
  const end = requireTimestamp(value.end, 'contextual_explanation_window_invalid');
  if (new Date(end).getTime() < new Date(start).getTime()) invalid('contextual_explanation_window_order_invalid');
  return {
    start,
    end,
    precisionSeconds: requireNonNegative(value.precisionSeconds, 'contextual_explanation_time_precision_invalid'),
  };
};

const normalizeLocation = (value: unknown): ContextualGeoPosition | null => {
  if (value === null) return null;
  assertPlainObject(value, 'contextual_explanation_location_invalid');
  requireExactKeys(value, ['lat', 'lon', 'precisionKm'], 'contextual_explanation_location_invalid');
  const lat = requireFinite(value.lat, 'contextual_explanation_location_invalid');
  const lon = requireFinite(value.lon, 'contextual_explanation_location_invalid');
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) invalid('contextual_explanation_location_invalid');
  return { lat, lon, precisionKm: requireNonNegative(value.precisionKm, 'contextual_explanation_location_precision_invalid') };
};

const normalizeSkyPosition = (value: unknown): ContextualSkyPosition | null => {
  if (value === null) return null;
  assertPlainObject(value, 'contextual_explanation_sky_position_invalid');
  requireExactKeys(value, ['azimuthDeg', 'elevationDeg', 'precisionDeg'], 'contextual_explanation_sky_position_invalid');
  const azimuthDeg = requireFinite(value.azimuthDeg, 'contextual_explanation_sky_position_invalid');
  const elevationDeg = requireFinite(value.elevationDeg, 'contextual_explanation_sky_position_invalid');
  if (azimuthDeg < 0 || azimuthDeg >= 360 || elevationDeg < -90 || elevationDeg > 90) {
    invalid('contextual_explanation_sky_position_invalid');
  }
  return {
    azimuthDeg,
    elevationDeg,
    precisionDeg: requireNonNegative(value.precisionDeg, 'contextual_explanation_sky_precision_invalid'),
  };
};

const normalizeObservation = (value: unknown): ContextualObservation => {
  assertPlainObject(value, 'contextual_explanation_observation_invalid');
  requireExactKeys(value, ['window', 'location', 'skyPosition'], 'contextual_explanation_observation_invalid');
  return {
    window: normalizeWindow(value.window),
    location: normalizeLocation(value.location),
    skyPosition: normalizeSkyPosition(value.skyPosition),
  };
};

const normalizeUri = (value: unknown): string | null => {
  if (value === null) return null;
  const sourceUri = requireString(value, 'contextual_explanation_source_uri_invalid', 2_000);
  let parsed: URL;
  try {
    parsed = new URL(sourceUri);
  } catch {
    return invalid('contextual_explanation_source_uri_invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) invalid('contextual_explanation_source_uri_invalid');
  return sourceUri;
};

const normalizeProvenance = (value: unknown): ContextualProvenance => {
  assertPlainObject(value, 'contextual_explanation_provenance_invalid');
  const hasId = 'provenanceId' in value;
  requireExactKeys(
    value,
    hasId
      ? ['provenanceId', 'sourceRef', 'role', 'providerId', 'sourceRecordId', 'datasetVersion', 'retrievedAt', 'contentSha256', 'sourceUri']
      : ['sourceRef', 'role', 'providerId', 'sourceRecordId', 'datasetVersion', 'retrievedAt', 'contentSha256', 'sourceUri'],
    'contextual_explanation_provenance_invalid',
  );
  const role = value.role;
  if (!['subject_observation', 'context_reference', 'correlation_method'].includes(String(role))) {
    invalid('contextual_explanation_provenance_role_invalid');
  }
  const draft: ContextualProvenanceDraft = {
    sourceRef: requireId(value.sourceRef, 'contextual_explanation_source_ref_invalid'),
    role: role as ContextualProvenanceRole,
    providerId: requireId(value.providerId, 'contextual_explanation_provider_invalid'),
    sourceRecordId: requireId(value.sourceRecordId, 'contextual_explanation_source_record_invalid'),
    datasetVersion: requireId(value.datasetVersion, 'contextual_explanation_dataset_version_invalid'),
    retrievedAt: requireTimestamp(value.retrievedAt, 'contextual_explanation_retrieved_at_invalid'),
    contentSha256: requireSha(value.contentSha256, 'contextual_explanation_content_digest_invalid'),
    sourceUri: normalizeUri(value.sourceUri),
  };
  const provenanceId = `context-source:${contextualExplanationSha256(draft)}`;
  if (hasId && value.provenanceId !== provenanceId) invalid('contextual_explanation_provenance_id_mismatch');
  return { provenanceId, ...draft };
};

const normalizeProvenanceSet = (value: unknown) => {
  assertArray(value, 'contextual_explanation_provenance_invalid');
  const provenance = value.map(normalizeProvenance).sort((left, right) => lexical(left.provenanceId, right.provenanceId));
  if (provenance.length < 2) invalid('contextual_explanation_provenance_incomplete');
  if (new Set(provenance.map((item) => item.provenanceId)).size !== provenance.length) {
    invalid('contextual_explanation_duplicate_provenance');
  }
  if (new Set(provenance.map((item) => item.sourceRef)).size !== provenance.length) {
    invalid('contextual_explanation_duplicate_source_ref');
  }
  if (!provenance.some((item) => item.role === 'subject_observation')
    || !provenance.some((item) => item.role === 'context_reference')) {
    invalid('contextual_explanation_provenance_incomplete');
  }
  return provenance;
};

const DOMAIN_EVIDENCE_SPEC: Readonly<Record<ContextualDomainEvidenceCode, {
  unit: ContextualMatchingEvidence['unit'];
  minimum: number;
  maximum: number;
}>> = Object.freeze({
  track_coverage_fraction: { unit: 'ratio', minimum: 0, maximum: 1 },
  orbit_epoch_age_hours: { unit: 'hours', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  ephemeris_accuracy_deg: { unit: 'degrees', minimum: 0, maximum: 180 },
  observation_coverage_fraction: { unit: 'ratio', minimum: 0, maximum: 1 },
  phenomenon_match_score: { unit: 'ratio', minimum: 0, maximum: 1 },
});

const ALLOWED_EVIDENCE_BY_KIND: Readonly<Record<ContextualExplanationKind, readonly ContextualDomainEvidenceCode[]>> = Object.freeze({
  aircraft: ['track_coverage_fraction'],
  satellite: ['track_coverage_fraction', 'orbit_epoch_age_hours'],
  astronomy: ['ephemeris_accuracy_deg'],
  weather: ['observation_coverage_fraction', 'phenomenon_match_score'],
});

const roundMetric = (value: number) => {
  const rounded = Number(value.toFixed(9));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const normalizeDomainEvidenceSet = (
  value: unknown,
  kind: ContextualExplanationKind,
  provenanceByRef: ReadonlyMap<string, ContextualProvenance>,
): ContextualMatchingEvidence[] => {
  assertArray(value, 'contextual_explanation_domain_evidence_invalid');
  const allowed = new Set(ALLOWED_EVIDENCE_BY_KIND[kind]);
  const normalized = value.map((item): ContextualMatchingEvidence => {
    assertPlainObject(item, 'contextual_explanation_domain_evidence_invalid');
    requireExactKeys(
      item,
      ['code', 'value', 'precision', 'method', 'methodVersion', 'sourceRefs'],
      'contextual_explanation_domain_evidence_invalid',
    );
    const code = item.code as ContextualDomainEvidenceCode;
    if (!allowed.has(code)) invalid('contextual_explanation_domain_evidence_code_invalid');
    const method = item.method;
    if (!['measured', 'catalogue', 'deterministic_rule', 'model_output'].includes(String(method))) {
      invalid('contextual_explanation_evidence_method_invalid');
    }
    const spec = DOMAIN_EVIDENCE_SPEC[code];
    const valueNumber = requireFinite(item.value, 'contextual_explanation_evidence_value_invalid');
    const precision = requireNonNegative(item.precision, 'contextual_explanation_evidence_precision_invalid');
    const lowerBound = roundMetric(valueNumber - precision);
    const upperBound = roundMetric(valueNumber + precision);
    if (lowerBound < spec.minimum || upperBound > spec.maximum) {
      invalid('contextual_explanation_evidence_bounds_invalid');
    }
    if (!Array.isArray(item.sourceRefs) || !item.sourceRefs.length) {
      invalid('contextual_explanation_evidence_source_invalid');
    }
    const sourceRefs = item.sourceRefs.map((sourceRef) => requireId(sourceRef, 'contextual_explanation_evidence_source_invalid'))
      .sort(lexical);
    if (new Set(sourceRefs).size !== sourceRefs.length) invalid('contextual_explanation_evidence_source_invalid');
    const sources = sourceRefs.map((sourceRef) => provenanceByRef.get(sourceRef)
      || invalid('contextual_explanation_evidence_source_unknown'));
    if (!sources.some((source) => source.role === 'context_reference')) {
      invalid('contextual_explanation_evidence_context_source_required');
    }
    if (method === 'model_output' && !sources.some((source) => source.role === 'correlation_method')) {
      invalid('contextual_explanation_model_provenance_required');
    }
    const withoutId: Omit<ContextualMatchingEvidence, 'evidenceId'> = {
      code,
      value: roundMetric(valueNumber),
      unit: spec.unit,
      precision: roundMetric(precision),
      lowerBound,
      upperBound,
      derivation: 'supplied_context_evidence',
      method: method as ContextualEvidenceMethod,
      methodVersion: requireId(item.methodVersion, 'contextual_explanation_evidence_method_version_invalid'),
      provenanceIds: sources.map((source) => source.provenanceId).sort(lexical),
    };
    return { evidenceId: `context-evidence:${contextualExplanationSha256(withoutId)}`, ...withoutId };
  }).sort((left, right) => lexical(left.code, right.code) || lexical(left.evidenceId, right.evidenceId));
  if (new Set(normalized.map((item) => item.code)).size !== normalized.length) {
    invalid('contextual_explanation_duplicate_evidence_code');
  }
  return normalized;
};

const normalizeMissingness = (value: unknown) => {
  assertArray(value, 'contextual_explanation_missingness_invalid');
  const missingness = value.map((item) => {
    assertPlainObject(item, 'contextual_explanation_missingness_invalid');
    requireExactKeys(item, ['field', 'status', 'reason'], 'contextual_explanation_missingness_invalid');
    const field = requireId(item.field, 'contextual_explanation_missing_field_invalid');
    const status = item.status;
    if (!['unknown', 'not_recorded', 'unavailable', 'withheld', 'not_applicable'].includes(String(status))) {
      invalid('contextual_explanation_missing_status_invalid');
    }
    return {
      field,
      status: status as ContextualMissingStatus,
      reason: requireId(item.reason, 'contextual_explanation_missing_reason_invalid'),
    };
  }).sort((left, right) => lexical(left.field, right.field) || lexical(left.status, right.status) || lexical(left.reason, right.reason));
  if (new Set(missingness.map((item) => item.field)).size !== missingness.length) {
    invalid('contextual_explanation_duplicate_missing_field');
  }
  return missingness;
};

const normalizeUncertainty = (value: unknown) => {
  assertPlainObject(value, 'contextual_explanation_uncertainty_invalid');
  requireExactKeys(value, ['level', 'reasons'], 'contextual_explanation_uncertainty_invalid');
  const level = value.level;
  if (!['none', 'low', 'medium', 'high', 'unknown'].includes(String(level)) || !Array.isArray(value.reasons)) {
    invalid('contextual_explanation_uncertainty_invalid');
  }
  const reasons = value.reasons.map((reason) => requireId(reason, 'contextual_explanation_uncertainty_invalid')).sort(lexical);
  if (new Set(reasons).size !== reasons.length || ((level === 'none') !== (reasons.length === 0))) {
    invalid('contextual_explanation_uncertainty_reason_mismatch');
  }
  return { level: level as ContextualUncertaintyLevel, reasons };
};

const normalizeModel = (value: unknown) => {
  assertPlainObject(value, 'contextual_explanation_model_invalid');
  requireExactKeys(value, ['modelId', 'modelVersion', 'method', 'inputSha256', 'outputSha256'], 'contextual_explanation_model_invalid');
  if (!['deterministic', 'governed_model'].includes(String(value.method))) invalid('contextual_explanation_model_invalid');
  return {
    modelId: requireId(value.modelId, 'contextual_explanation_model_invalid'),
    modelVersion: requireId(value.modelVersion, 'contextual_explanation_model_invalid'),
    method: value.method as 'deterministic' | 'governed_model',
    inputSha256: requireSha(value.inputSha256, 'contextual_explanation_model_input_digest_invalid'),
    outputSha256: requireSha(value.outputSha256, 'contextual_explanation_model_output_digest_invalid'),
  };
};

type NormalizedCandidate = {
  kind: ContextualExplanationKind;
  subjectAddress: string;
  reference: { referenceId: string; label: string };
  subjectObservation: ContextualObservation;
  referenceObservation: ContextualObservation;
  provenance: ContextualProvenance[];
  domainEvidence: ContextualMatchingEvidence[];
  missingness: ContextualExplanationReceipt['missingness'];
  uncertainty: ContextualExplanationEdge['uncertainty'];
  model: ContextualExplanationEdge['model'];
};

const normalizeCandidate = (input: unknown): NormalizedCandidate => {
  assertPlainObject(input, 'contextual_explanation_candidate_invalid');
  requireExactKeys(
    input,
    ['kind', 'subjectAddress', 'reference', 'subjectObservation', 'referenceObservation', 'provenance', 'domainEvidence', 'missingness', 'uncertainty', 'model'],
    'contextual_explanation_candidate_invalid',
  );
  if (!KINDS.includes(input.kind as ContextualExplanationKind)) invalid('contextual_explanation_kind_invalid');
  const kind = input.kind as ContextualExplanationKind;
  const subjectAddress = requireString(input.subjectAddress, 'contextual_explanation_subject_address_invalid', 512);
  if (!ADDRESS_PATTERN.test(subjectAddress)) invalid('contextual_explanation_subject_address_invalid');
  assertPlainObject(input.reference, 'contextual_explanation_reference_invalid');
  requireExactKeys(input.reference, ['referenceId', 'label'], 'contextual_explanation_reference_invalid');
  const provenance = normalizeProvenanceSet(input.provenance);
  const provenanceByRef = new Map(provenance.map((item) => [item.sourceRef, item]));
  const subjectObservation = normalizeObservation(input.subjectObservation);
  const referenceObservation = normalizeObservation(input.referenceObservation);
  const domainEvidence = normalizeDomainEvidenceSet(input.domainEvidence, kind, provenanceByRef);
  const missingness = normalizeMissingness(input.missingness);
  const uncertainty = normalizeUncertainty(input.uncertainty);
  const model = normalizeModel(input.model);

  const hasModelOutputEvidence = domainEvidence.some((item) => item.method === 'model_output');
  if ((model.method === 'governed_model') !== hasModelOutputEvidence) {
    invalid('contextual_explanation_model_method_mismatch');
  }

  const presence: Record<string, boolean> = {
    'subject.window': subjectObservation.window !== null,
    'subject.location': subjectObservation.location !== null,
    'subject.sky_position': subjectObservation.skyPosition !== null,
    'reference.window': referenceObservation.window !== null,
    'reference.location': referenceObservation.location !== null,
    'reference.sky_position': referenceObservation.skyPosition !== null,
  };
  for (const code of ALLOWED_EVIDENCE_BY_KIND[kind]) {
    presence[`domain_evidence.${code}`] = domainEvidence.some((item) => item.code === code);
  }
  const missingByField = new Map(missingness.map((item) => [item.field, item]));
  for (const [field, present] of Object.entries(presence)) {
    if (!present && !missingByField.has(field)) invalid('contextual_explanation_missingness_required');
    if (present && missingByField.has(field)) invalid('contextual_explanation_missingness_contradiction');
  }

  return {
    kind,
    subjectAddress,
    reference: {
      referenceId: requireId(input.reference.referenceId, 'contextual_explanation_reference_id_invalid'),
      label: requireString(input.reference.label, 'contextual_explanation_reference_label_invalid', 240),
    },
    subjectObservation,
    referenceObservation,
    provenance,
    domainEvidence,
    missingness,
    uncertainty,
    model,
  };
};

const toRadians = (degrees: number) => degrees * (Math.PI / 180);
const toDegrees = (radians: number) => radians * (180 / Math.PI);

const intervalGapSeconds = (left: ContextualObservationWindow, right: ContextualObservationWindow) => {
  const leftStart = new Date(left.start).getTime();
  const leftEnd = new Date(left.end).getTime();
  const rightStart = new Date(right.start).getTime();
  const rightEnd = new Date(right.end).getTime();
  if (leftEnd < rightStart) return (rightStart - leftEnd) / 1_000;
  if (rightEnd < leftStart) return (leftStart - rightEnd) / 1_000;
  return 0;
};

const windowSpanUpperSeconds = (window: ContextualObservationWindow) => (
  ((new Date(window.end).getTime() - new Date(window.start).getTime()) / 1_000) + (window.precisionSeconds * 2)
);

const surfaceDistanceKm = (left: ContextualGeoPosition, right: ContextualGeoPosition) => {
  const earthRadiusKm = 6_371.0088;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lon - left.lon);
  const leftLat = toRadians(left.lat);
  const rightLat = toRadians(right.lat);
  const a = (Math.sin(dLat / 2) ** 2)
    + (Math.cos(leftLat) * Math.cos(rightLat) * (Math.sin(dLon / 2) ** 2));
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
};

const angularSeparationDeg = (left: ContextualSkyPosition, right: ContextualSkyPosition) => {
  const leftElevation = toRadians(left.elevationDeg);
  const rightElevation = toRadians(right.elevationDeg);
  const deltaAzimuth = toRadians(right.azimuthDeg - left.azimuthDeg);
  const cosine = (Math.sin(leftElevation) * Math.sin(rightElevation))
    + (Math.cos(leftElevation) * Math.cos(rightElevation) * Math.cos(deltaAzimuth));
  return toDegrees(Math.acos(Math.max(-1, Math.min(1, cosine))));
};

const buildDerivedEvidence = (
  candidate: NormalizedCandidate,
  subjectSourceIds: string[],
  contextSourceIds: string[],
): ContextualMatchingEvidence[] => {
  const provenanceIds = [...new Set([...subjectSourceIds, ...contextSourceIds])].sort(lexical);
  const build = (
    code: ContextualMatchingEvidenceCode,
    value: number,
    unit: ContextualMatchingEvidence['unit'],
    precision: number,
  ): ContextualMatchingEvidence => {
    const normalizedValue = roundMetric(value);
    const normalizedPrecision = roundMetric(precision);
    const withoutId: Omit<ContextualMatchingEvidence, 'evidenceId'> = {
      code,
      value: normalizedValue,
      unit,
      precision: normalizedPrecision,
      lowerBound: roundMetric(Math.max(0, normalizedValue - normalizedPrecision)),
      upperBound: roundMetric(normalizedValue + normalizedPrecision),
      derivation: 'derived_from_observations',
      method: 'deterministic_rule',
      methodVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
      provenanceIds,
    };
    return { evidenceId: `context-evidence:${contextualExplanationSha256(withoutId)}`, ...withoutId };
  };
  const evidence: ContextualMatchingEvidence[] = [];
  if (candidate.subjectObservation.window && candidate.referenceObservation.window) {
    evidence.push(build(
      'temporal_gap_seconds',
      intervalGapSeconds(candidate.subjectObservation.window, candidate.referenceObservation.window),
      'seconds',
      candidate.subjectObservation.window.precisionSeconds + candidate.referenceObservation.window.precisionSeconds,
    ));
  }
  if (candidate.subjectObservation.location && candidate.referenceObservation.location) {
    evidence.push(build(
      'surface_distance_km',
      surfaceDistanceKm(candidate.subjectObservation.location, candidate.referenceObservation.location),
      'kilometres',
      candidate.subjectObservation.location.precisionKm + candidate.referenceObservation.location.precisionKm,
    ));
  }
  if (candidate.subjectObservation.skyPosition && candidate.referenceObservation.skyPosition) {
    evidence.push(build(
      'angular_separation_deg',
      angularSeparationDeg(candidate.subjectObservation.skyPosition, candidate.referenceObservation.skyPosition),
      'degrees',
      candidate.subjectObservation.skyPosition.precisionDeg + candidate.referenceObservation.skyPosition.precisionDeg,
    ));
  }
  return evidence;
};

const check = (
  code: string,
  actual: number,
  operator: ContextualPolicyCheck['operator'],
  threshold: number,
  unit: ContextualPolicyCheck['unit'],
  evidenceIds: string[] = [],
): ContextualPolicyCheck => ({
  code,
  status: operator === 'less_than_or_equal'
    ? (actual <= threshold ? 'pass' : 'fail')
    : (actual >= threshold ? 'pass' : 'fail'),
  actual: roundMetric(actual),
  operator,
  threshold,
  unit,
  evidenceIds: [...evidenceIds].sort(lexical),
});

const buildChecks = (candidate: NormalizedCandidate, evidence: ContextualMatchingEvidence[]) => {
  const policy = POLICY_THRESHOLDS[candidate.kind];
  const byCode = new Map(evidence.map((item) => [item.code, item]));
  const checks: ContextualPolicyCheck[] = [];
  const availability = (code: string, present: boolean) => checks.push(check(code, present ? 1 : 0, 'greater_than_or_equal', 1, 'count'));
  availability('subject_window_available', candidate.subjectObservation.window !== null);
  availability('reference_window_available', candidate.referenceObservation.window !== null);
  availability('subject_location_available', candidate.subjectObservation.location !== null);
  if (policy.maxReferenceLocationPrecisionKm !== null) {
    availability('reference_location_available', candidate.referenceObservation.location !== null);
  }
  if (policy.maxSubjectSkyPrecisionDeg !== null) {
    availability('subject_sky_position_available', candidate.subjectObservation.skyPosition !== null);
  }
  if (policy.maxReferenceSkyPrecisionDeg !== null) {
    availability('reference_sky_position_available', candidate.referenceObservation.skyPosition !== null);
  }

  const subjectWindow = candidate.subjectObservation.window;
  if (subjectWindow) {
    checks.push(check('subject_time_precision', subjectWindow.precisionSeconds, 'less_than_or_equal', policy.maxSubjectTimePrecisionSeconds, 'seconds'));
    checks.push(check('subject_window_span_upper', windowSpanUpperSeconds(subjectWindow), 'less_than_or_equal', policy.maxSubjectWindowSpanSeconds, 'seconds'));
  }
  const referenceWindow = candidate.referenceObservation.window;
  if (referenceWindow) {
    checks.push(check('reference_time_precision', referenceWindow.precisionSeconds, 'less_than_or_equal', policy.maxReferenceTimePrecisionSeconds, 'seconds'));
    checks.push(check('reference_window_span_upper', windowSpanUpperSeconds(referenceWindow), 'less_than_or_equal', policy.maxReferenceWindowSpanSeconds, 'seconds'));
  }
  const subjectLocation = candidate.subjectObservation.location;
  if (subjectLocation) {
    checks.push(check('subject_location_precision', subjectLocation.precisionKm, 'less_than_or_equal', policy.maxSubjectLocationPrecisionKm, 'kilometres'));
  }
  const referenceLocation = candidate.referenceObservation.location;
  if (referenceLocation && policy.maxReferenceLocationPrecisionKm !== null) {
    checks.push(check('reference_location_precision', referenceLocation.precisionKm, 'less_than_or_equal', policy.maxReferenceLocationPrecisionKm, 'kilometres'));
  }
  const subjectSky = candidate.subjectObservation.skyPosition;
  if (subjectSky && policy.maxSubjectSkyPrecisionDeg !== null) {
    checks.push(check('subject_sky_precision', subjectSky.precisionDeg, 'less_than_or_equal', policy.maxSubjectSkyPrecisionDeg, 'degrees'));
  }
  if (subjectSky && policy.minimumSubjectElevationLowerDeg !== null) {
    checks.push(check(
      'subject_elevation_visible',
      subjectSky.elevationDeg - subjectSky.precisionDeg,
      'greater_than_or_equal',
      policy.minimumSubjectElevationLowerDeg,
      'degrees',
    ));
  }
  const referenceSky = candidate.referenceObservation.skyPosition;
  if (referenceSky && policy.maxReferenceSkyPrecisionDeg !== null) {
    checks.push(check('reference_sky_precision', referenceSky.precisionDeg, 'less_than_or_equal', policy.maxReferenceSkyPrecisionDeg, 'degrees'));
  }
  if (referenceSky && policy.minimumReferenceElevationLowerDeg !== null) {
    checks.push(check(
      'reference_elevation_visible',
      referenceSky.elevationDeg - referenceSky.precisionDeg,
      'greater_than_or_equal',
      policy.minimumReferenceElevationLowerDeg,
      'degrees',
    ));
  }

  const temporal = byCode.get('temporal_gap_seconds');
  availability('temporal_match_available', Boolean(temporal));
  if (temporal) checks.push(check('temporal_gap_upper', temporal.upperBound, 'less_than_or_equal', policy.maxTemporalGapUpperSeconds, 'seconds', [temporal.evidenceId]));
  if (policy.maxSurfaceDistanceUpperKm !== null) {
    const spatial = byCode.get('surface_distance_km');
    availability('surface_match_available', Boolean(spatial));
    if (spatial) checks.push(check('surface_distance_upper', spatial.upperBound, 'less_than_or_equal', policy.maxSurfaceDistanceUpperKm, 'kilometres', [spatial.evidenceId]));
  }
  if (policy.maxAngularSeparationUpperDeg !== null) {
    const angular = byCode.get('angular_separation_deg');
    availability('angular_match_available', Boolean(angular));
    if (angular) checks.push(check('angular_separation_upper', angular.upperBound, 'less_than_or_equal', policy.maxAngularSeparationUpperDeg, 'degrees', [angular.evidenceId]));
  }
  for (const code of ALLOWED_EVIDENCE_BY_KIND[candidate.kind]) {
    const domainEvidence = byCode.get(code);
    availability(`domain_${code}_available`, Boolean(domainEvidence));
    if (!domainEvidence) continue;
    const threshold = policy.domain[code] || invalid('contextual_explanation_policy_invalid');
    checks.push(check(
      `domain_${code}_${threshold.operator === 'max' ? 'upper' : 'lower'}`,
      threshold.operator === 'max' ? domainEvidence.upperBound : domainEvidence.lowerBound,
      threshold.operator === 'max' ? 'less_than_or_equal' : 'greater_than_or_equal',
      threshold.threshold,
      domainEvidence.unit,
      [domainEvidence.evidenceId],
    ));
  }
  checks.push(check(
    'declared_uncertainty_rank',
    UNCERTAINTY_RANK[candidate.uncertainty.level],
    'less_than_or_equal',
    policy.maximumUncertaintyRank,
    'rank',
  ));
  const hasRecordedPrecision = [
    candidate.subjectObservation.window?.precisionSeconds,
    candidate.referenceObservation.window?.precisionSeconds,
    candidate.subjectObservation.location?.precisionKm,
    candidate.referenceObservation.location?.precisionKm,
    candidate.subjectObservation.skyPosition?.precisionDeg,
    candidate.referenceObservation.skyPosition?.precisionDeg,
    ...candidate.domainEvidence.map((item) => item.precision),
  ].some((value) => value !== undefined && value > 0);
  checks.push(check(
    'declared_uncertainty_consistent',
    candidate.uncertainty.level === 'none' && hasRecordedPrecision ? 0 : 1,
    'greater_than_or_equal',
    1,
    'count',
  ));
  return checks.sort((left, right) => lexical(left.code, right.code));
};

const EDGE_TYPE: Readonly<Record<ContextualExplanationKind, ContextualExplanationEdgeType>> = Object.freeze({
  aircraft: 'context_aircraft_candidate',
  satellite: 'context_satellite_candidate',
  astronomy: 'context_astronomy_candidate',
  weather: 'context_weather_candidate',
});

const PLAIN_ENGLISH: Readonly<Record<ContextualExplanationKind, string>> = Object.freeze({
  aircraft: 'An aircraft reference met the declared time, location, sky-position, coverage, and uncertainty bounds. This is a candidate contextual correlation only—not a causal attribution, debunking conclusion, or origin assessment.',
  satellite: 'A satellite reference met the declared time, sky-position, orbit-age, coverage, and uncertainty bounds. This is a candidate contextual correlation only—not a causal attribution, debunking conclusion, or origin assessment.',
  astronomy: 'An astronomical reference met the declared time, visible-sky, ephemeris, and uncertainty bounds. This is a candidate contextual correlation only—not a causal attribution, debunking conclusion, or origin assessment.',
  weather: 'A weather reference met the declared time, location, observation-coverage, phenomenon-match, and uncertainty bounds. This is a candidate contextual correlation only—not a causal attribution, debunking conclusion, or origin assessment.',
});

const REJECTED_PLAIN_ENGLISH = 'No contextual edge was emitted because the available observations, precision, provenance-backed matching evidence, or uncertainty did not meet the declared policy. This is not evidence for or against any cause or origin.';

const candidateIdentity = (candidate: NormalizedCandidate) => ({
  kind: candidate.kind,
  subjectAddress: candidate.subjectAddress,
  reference: candidate.reference,
  subjectObservation: candidate.subjectObservation,
  referenceObservation: candidate.referenceObservation,
  provenance: candidate.provenance,
  domainEvidence: candidate.domainEvidence,
  missingness: candidate.missingness,
  uncertainty: candidate.uncertainty,
  model: candidate.model,
});

export const evaluateContextualExplanationCandidate = (
  input: ContextualExplanationCandidateDraft,
): ContextualExplanationEvaluation => {
  const candidate = normalizeCandidate(input);
  const subjectSourceIds = candidate.provenance
    .filter((item) => item.role === 'subject_observation')
    .map((item) => item.provenanceId);
  const contextSourceIds = candidate.provenance
    .filter((item) => item.role === 'context_reference')
    .map((item) => item.provenanceId);
  const matchingEvidence = [
    ...buildDerivedEvidence(candidate, subjectSourceIds, contextSourceIds),
    ...candidate.domainEvidence,
  ].sort((left, right) => lexical(left.code, right.code) || lexical(left.evidenceId, right.evidenceId));
  const checks = buildChecks(candidate, matchingEvidence);
  const failedChecks = checks.filter((item) => item.status === 'fail').map((item) => item.code).sort(lexical);
  const decision = failedChecks.length ? 'insufficient_evidence' : 'emit_candidate_edge';
  const observationIdentity = {
    subject: candidate.subjectObservation,
    reference: candidate.referenceObservation,
  };
  const receiptWithoutId: Omit<ContextualExplanationReceipt, 'receiptId'> = {
    recordType: 'contextual_explanation_evaluation',
    schemaVersion: CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    decision,
    kind: candidate.kind,
    subjectAddress: candidate.subjectAddress,
    contextReferenceId: candidate.reference.referenceId,
    inputSha256: contextualExplanationSha256(candidateIdentity(candidate)),
    observationSha256: contextualExplanationSha256(observationIdentity),
    provenanceSetSha256: contextualExplanationSha256(candidate.provenance),
    matchingEvidenceSetSha256: contextualExplanationSha256(matchingEvidence),
    policyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
    policySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
    model: candidate.model,
    checks,
    failedChecks,
    missingness: candidate.missingness,
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
    plainEnglish: decision === 'emit_candidate_edge' ? PLAIN_ENGLISH[candidate.kind] : REJECTED_PLAIN_ENGLISH,
  };
  const receipt: ContextualExplanationReceipt = {
    receiptId: `context-receipt:${contextualExplanationSha256(receiptWithoutId)}`,
    ...receiptWithoutId,
  };
  if (decision === 'insufficient_evidence') return { edge: null, receipt };

  const contextNodeId = `context-node:${candidate.kind}:${contextualExplanationSha256({
    kind: candidate.kind,
    referenceId: candidate.reference.referenceId,
  })}`;
  const edgeWithoutId: Omit<ContextualExplanationEdge, 'edgeId'> = {
    recordType: 'contextual_explanation_edge',
    schemaVersion: CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    edgeType: EDGE_TYPE[candidate.kind],
    kind: candidate.kind,
    subjectAddress: candidate.subjectAddress,
    contextNodeId,
    reference: candidate.reference,
    observations: observationIdentity,
    provenance: candidate.provenance,
    matchingEvidence,
    missingness: candidate.missingness,
    uncertainty: candidate.uncertainty,
    model: candidate.model,
    policy: {
      version: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
      sha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
    },
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
    explanation: { plainEnglish: PLAIN_ENGLISH[candidate.kind] },
    receipt,
  };
  return {
    edge: {
      edgeId: `context-edge:${contextualExplanationSha256(edgeWithoutId)}`,
      ...edgeWithoutId,
    },
    receipt,
  };
};

export const buildContextualExplanationEdge = (input: ContextualExplanationCandidateDraft) => (
  evaluateContextualExplanationCandidate(input).edge
);

const draftFromEdge = (edge: ContextualExplanationEdge): ContextualExplanationCandidateDraft => {
  const sourceRefById = new Map(edge.provenance.map((item) => [item.provenanceId, item.sourceRef]));
  const domainEvidence = edge.matchingEvidence
    .filter((item) => item.derivation === 'supplied_context_evidence')
    .map((item) => ({
      code: item.code as ContextualDomainEvidenceCode,
      value: item.value,
      precision: item.precision,
      method: item.method,
      methodVersion: item.methodVersion,
      sourceRefs: item.provenanceIds.map((id) => sourceRefById.get(id)
        || invalid('contextual_explanation_edge_provenance_reference_invalid')),
    }));
  return {
    kind: edge.kind,
    subjectAddress: edge.subjectAddress,
    reference: edge.reference,
    subjectObservation: edge.observations.subject,
    referenceObservation: edge.observations.reference,
    provenance: edge.provenance.map(({ provenanceId: _provenanceId, ...source }) => source),
    domainEvidence,
    missingness: edge.missingness,
    uncertainty: edge.uncertainty,
    model: edge.model,
  } as ContextualExplanationCandidateDraft;
};

export const decodeContextualExplanationEdge = (input: unknown): ContextualExplanationEdge => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(String(input));
    } catch {
      return invalid('contextual_explanation_edge_json_invalid');
    }
  }
  assertPlainObject(value, 'contextual_explanation_edge_invalid');
  const candidate = draftFromEdge(value as ContextualExplanationEdge);
  const rebuilt = buildContextualExplanationEdge(candidate);
  if (!rebuilt) invalid('contextual_explanation_edge_noncanonical');
  if (canonicalizeContextualExplanation(rebuilt) !== canonicalizeContextualExplanation(value)) {
    invalid('contextual_explanation_edge_noncanonical');
  }
  return rebuilt;
};

export const serializeContextualExplanationEdge = (input: ContextualExplanationEdge) => (
  `${canonicalizeContextualExplanation(decodeContextualExplanationEdge(input))}\n`
);
