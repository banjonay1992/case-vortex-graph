import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_EXTERNAL_CORRELATION_VERSION = 'case-graph-external-correlation-v1' as const;
export const CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES = [
  'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
  'military_exercise', 'launch', 'maritime', 'weather',
] as const;

export type CaseGraphExternalCorrelationCategory = typeof CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES[number];
export type CaseGraphExternalCorrelationAvailability = 'available' | 'insufficient_evidence' | 'unavailable' | 'stale';

export type CaseGraphExternalCorrelationSource = {
  snapshotId: string;
  providerId: string;
  datasetVersion: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  acquiredAt: string;
  sourceUrl: string | null;
  license: string | null;
  receiptSha256: string;
};

export type CaseGraphExternalCorrelationCandidate = {
  candidateId: string;
  category: CaseGraphExternalCorrelationCategory;
  sourceRecordId: string;
  label: string;
  observedAt: string | null;
  measurements: Record<string, string | number | boolean | null>;
  reasonCodes: string[];
  explanation: string;
  uncertainty: string[];
  candidateDigest: string;
};

export type CaseGraphExternalCorrelationAssessment = {
  category: CaseGraphExternalCorrelationCategory;
  availability: CaseGraphExternalCorrelationAvailability;
  reasonCodes: string[];
  explanation: string;
  source: CaseGraphExternalCorrelationSource | null;
  candidates: CaseGraphExternalCorrelationCandidate[];
  checkedAt: string;
  assessmentDigest: string;
};

export type CaseGraphExternalCorrelationResult = {
  recordType: 'case_graph_external_correlation_result';
  schemaVersion: typeof CASE_GRAPH_EXTERNAL_CORRELATION_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  assessments: CaseGraphExternalCorrelationAssessment[];
  limitations: string[];
  resultDigest: string;
};

export type CaseGraphExternalCorrelationProvider = {
  correlate: (params: {
    publication: CaseGraphResearchPublicationBinding;
    address: string;
    categories: CaseGraphExternalCorrelationCategory[];
    limitPerCategory: number;
    signal?: AbortSignal;
  }) => Promise<CaseGraphExternalCorrelationResult>;
};

const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE_ID = /^external-correlation:[a-f0-9]{64}$/;
const ADDRESS = /^(sighting|document|photo|video):[^:\s]{1,240}$/;
const CODE = /^[a-z0-9][a-z0-9_:-]{0,119}$/;
const invalid = (): never => { throw new Error('case_graph_external_correlation_integrity_failed'); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') invalid();
  const normalized = (value as string).trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) invalid();
  return normalized;
};
const nullableText = (value: unknown, maximum: number) => value == null ? null : text(value, maximum);
function timestamp(value: unknown): string;
function timestamp(value: unknown, nullable: true): string | null;
function timestamp(value: unknown, nullable = false): string | null {
  if (value == null && nullable) return null;
  const normalized = text(value, 80);
  if (!Number.isFinite(Date.parse(normalized))) invalid();
  return new Date(normalized).toISOString();
}
const digest = (value: unknown) => {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256.test(normalized)) invalid();
  return normalized;
};
const strings = (value: unknown, maximumItems: number, maximumBytes: number, codes = false): string[] => {
  if (!Array.isArray(value) || value.length > maximumItems) invalid();
  const result = (value as unknown[]).map((item) => text(item, maximumBytes));
  if (new Set(result).size !== result.length || (codes && result.some((item) => !CODE.test(item)))) invalid();
  return result.sort();
};
const category = (value: unknown): CaseGraphExternalCorrelationCategory => {
  const normalized = text(value, 40) as CaseGraphExternalCorrelationCategory;
  if (!CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.includes(normalized)) invalid();
  return normalized;
};
const measurements = (value: unknown) => {
  const raw = object(value);
  if (Object.keys(raw).length > 24) invalid();
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(raw).sort(([left], [right]) => left.localeCompare(right))) {
    if (!CODE.test(key) || !['string', 'number', 'boolean'].includes(typeof item) && item !== null
      || typeof item === 'string' && Buffer.byteLength(item, 'utf8') > 500
      || typeof item === 'number' && !Number.isFinite(item)) invalid();
    result[key] = item as string | number | boolean | null;
  }
  return result;
};

const normalizePublication = (value: unknown): CaseGraphResearchPublicationBinding => {
  const raw = object(value);
  return {
    publicationId: text(raw.publicationId, 100),
    corpusVersion: text(raw.corpusVersion, 240),
    manifestSha256: digest(raw.manifestSha256),
    snapshotId: text(raw.snapshotId, 240),
    graphArtifactSetSha256: digest(raw.graphArtifactSetSha256),
    relationshipSchemaVersion: text(raw.relationshipSchemaVersion, 240),
    relationshipPolicyVersion: text(raw.relationshipPolicyVersion, 240),
    relationshipPolicySha256: digest(raw.relationshipPolicySha256),
    relationshipModelId: text(raw.relationshipModelId, 240),
    relationshipModelVersion: text(raw.relationshipModelVersion, 240),
    relationshipModelSha256: digest(raw.relationshipModelSha256),
    calibrationSetSha256: digest(raw.calibrationSetSha256),
  };
};

const normalizeSource = (value: unknown): CaseGraphExternalCorrelationSource => {
  const raw = object(value);
  const source: CaseGraphExternalCorrelationSource = {
    snapshotId: text(raw.snapshotId, 240), providerId: text(raw.providerId, 240),
    datasetVersion: text(raw.datasetVersion, 240), coverageStart: timestamp(raw.coverageStart, true),
    coverageEnd: timestamp(raw.coverageEnd, true), acquiredAt: timestamp(raw.acquiredAt),
    sourceUrl: nullableText(raw.sourceUrl, 2_000), license: nullableText(raw.license, 500),
    receiptSha256: digest(raw.receiptSha256),
  };
  if (source.sourceUrl) {
    try { if (!['https:', 'http:'].includes(new URL(source.sourceUrl).protocol)) invalid(); } catch { invalid(); }
  }
  if (source.coverageStart && source.coverageEnd && source.coverageStart > source.coverageEnd) invalid();
  return source;
};

const normalizeCandidate = (value: unknown, expectedCategory: CaseGraphExternalCorrelationCategory) => {
  const raw = object(value);
  const candidateId = text(raw.candidateId, 90).toLowerCase();
  const core = {
    category: category(raw.category),
    sourceRecordId: text(raw.sourceRecordId, 500), label: text(raw.label, 500),
    observedAt: timestamp(raw.observedAt, true), measurements: measurements(raw.measurements),
    reasonCodes: strings(raw.reasonCodes, 24, 120, true), explanation: text(raw.explanation, 4_000),
    uncertainty: strings(raw.uncertainty, 24, 2_000),
  };
  if (core.category !== expectedCategory || !CANDIDATE_ID.test(candidateId)) invalid();
  const candidateDigest = digest(raw.candidateDigest);
  if (candidateDigest !== relationshipInputSha256(core)
    || candidateId !== `external-correlation:${candidateDigest}`) invalid();
  return { candidateId, ...core, candidateDigest } satisfies CaseGraphExternalCorrelationCandidate;
};

const normalizeAssessment = (value: unknown, limit: number) => {
  const raw = object(value);
  const normalizedCategory = category(raw.category);
  const availability = text(raw.availability, 40) as CaseGraphExternalCorrelationAvailability;
  if (!['available', 'insufficient_evidence', 'unavailable', 'stale'].includes(availability)) invalid();
  if (!Array.isArray(raw.candidates) || raw.candidates.length > limit) invalid();
  const candidateValues = raw.candidates as unknown[];
  const withoutDigest = {
    category: normalizedCategory,
    availability,
    reasonCodes: strings(raw.reasonCodes, 24, 120, true),
    explanation: text(raw.explanation, 4_000),
    source: raw.source == null ? null : normalizeSource(raw.source),
    candidates: candidateValues.map((candidateValue) => normalizeCandidate(candidateValue, normalizedCategory)),
    checkedAt: timestamp(raw.checkedAt),
  };
  if (new Set(withoutDigest.candidates.map((candidateValue) => candidateValue.candidateId)).size !== withoutDigest.candidates.length
    || availability !== 'available' && withoutDigest.candidates.length
    || availability === 'available' && !withoutDigest.source) invalid();
  const assessmentDigest = digest(raw.assessmentDigest);
  if (assessmentDigest !== relationshipInputSha256(withoutDigest)) invalid();
  return { ...withoutDigest, assessmentDigest } satisfies CaseGraphExternalCorrelationAssessment;
};

export const verifyCaseGraphExternalCorrelationResult = (params: {
  value: unknown;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  categories: CaseGraphExternalCorrelationCategory[];
  limitPerCategory: number;
}) => {
  const raw = object(params.value);
  const normalizedAddress = text(raw.address, 250).toLowerCase();
  if (!ADDRESS.test(normalizedAddress) || normalizedAddress !== params.address) invalid();
  const publication = normalizePublication(raw.publication);
  if (JSON.stringify(publication) !== JSON.stringify(params.publication)
    || raw.recordType !== 'case_graph_external_correlation_result'
    || raw.schemaVersion !== CASE_GRAPH_EXTERNAL_CORRELATION_VERSION
    || !Array.isArray(raw.assessments)
    || raw.assessments.length !== params.categories.length) invalid();
  const assessments = (raw.assessments as unknown[]).map((item) => normalizeAssessment(item, params.limitPerCategory));
  if (assessments.map((item) => item.category).join('\n') !== params.categories.join('\n')) invalid();
  const withoutDigest = {
    recordType: 'case_graph_external_correlation_result' as const,
    schemaVersion: CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
    publication, address: normalizedAddress, assessments,
    limitations: strings(raw.limitations, 24, 2_000),
  };
  const resultDigest = digest(raw.resultDigest);
  if (resultDigest !== relationshipInputSha256(withoutDigest)) invalid();
  return { ...withoutDigest, resultDigest } satisfies CaseGraphExternalCorrelationResult;
};

export const unavailableExternalCorrelationResult = (params: {
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  categories: CaseGraphExternalCorrelationCategory[];
  checkedAt?: string;
  reasonCode?: string;
}) => {
  const checkedAt = params.checkedAt || new Date().toISOString();
  const assessments = params.categories.map((item) => {
    const withoutDigest = {
      category: item, availability: 'unavailable' as const,
      reasonCodes: [params.reasonCode || 'governed_provider_unavailable'],
      explanation: `No publication-pinned ${item.replace(/_/g, ' ')} correlation provider is available for this record. Absence of a candidate is not evidence that the category was ruled out.`,
      source: null, candidates: [], checkedAt,
    };
    return { ...withoutDigest, assessmentDigest: relationshipInputSha256(withoutDigest) };
  });
  const withoutDigest = {
    recordType: 'case_graph_external_correlation_result' as const,
    schemaVersion: CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
    publication: params.publication,
    address: params.address,
    assessments,
    limitations: ['External correlations are candidate comparisons, not identifications, causal explanations, debunking conclusions, or origin assessments.'],
  };
  return { ...withoutDigest, resultDigest: relationshipInputSha256(withoutDigest) } satisfies CaseGraphExternalCorrelationResult;
};
