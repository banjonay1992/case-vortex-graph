import {
  CASE_GRAPH_FEATURE_SCHEMA_VERSION,
  type CaseGraphFeatureOrigin,
  type CaseGraphDatePrecision,
  type CaseGraphFeatureRecord,
  type CaseGraphGeoPrecision,
} from './featureExtraction';
import { projectEvidenceUniverseNode, type EvidenceUniverseNode } from './evidenceUniverse';
import type {
  RelationshipInputExtractionEnrichment,
} from './relationshipInputExtraction';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  type RelationshipInputOriginDraft,
  type RelationshipInputPrecision,
  type RelationshipInputUncertainty,
} from './relationshipInputSnapshot';

export const RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION = 'relationship-input-feature-adapter-v2' as const;

function invalid(code: string): never {
  throw new Error(code);
}

const FEATURE_KEYS = [
  'status', 'schemaVersion', 'corpusVersion', 'caseId', 'source', 'sourceRecordId',
  'sourceUrl', 'ingestionJobId', 'event', 'durationSeconds', 'traits', 'narrative',
  'completeness', 'sourceUpdatedAt',
] as const;
const NODE_KEYS = [
  'schemaVersion', 'layoutVersion', 'address', 'kind', 'recordId', 'source',
  'sourceRecordId', 'title', 'summary', 'canonicalUrl', 'previewUrl', 'eventTimestamp',
  'lat', 'lon', 'location', 'countryCode', 'linkedSightingId', 'updatedAt', 'position',
] as const;
const FEATURE_ORIGIN_ORDER: readonly CaseGraphFeatureOrigin[] = [
  'structured', 'narrative', 'ai_keyword', 'ai_entity',
];
const DATE_PRECISIONS: readonly CaseGraphDatePrecision[] = ['exact', 'day', 'month', 'year', 'unknown'];
const GEO_PRECISIONS: readonly CaseGraphGeoPrecision[] = ['exact', 'city', 'region', 'country', 'unknown'];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value: unknown, expected: readonly string[]): value is Record<string, unknown> => {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const normalizeText = (value: unknown, maximum: number) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maximum);

const normalizeTerm = (value: unknown, maximum = 120) => normalizeText(value, maximum)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const canonicalOptionalText = (value: unknown, maximum: number) => {
  if (value === null) return true;
  return typeof value === 'string' && value.length > 0 && normalizeText(value, maximum) === value;
};

const canonicalIsoOrNull = (value: unknown) => {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const validateCanonicalNode = (node: EvidenceUniverseNode) => {
  if (!exactKeys(node, NODE_KEYS)) invalid('relationship_input_feature_node_invalid');
  try {
    const canonical = projectEvidenceUniverseNode({ ...node, public: true });
    if (canonicalizeRelationshipInput(node) !== canonicalizeRelationshipInput(canonical)) {
      invalid('relationship_input_feature_node_invalid');
    }
  } catch {
    invalid('relationship_input_feature_node_invalid');
  }
};

const validateFeatureTerms = (
  value: unknown,
  allowedOrigins: readonly CaseGraphFeatureOrigin[],
) => {
  if (!Array.isArray(value)) invalid('relationship_input_feature_record_invalid');
  const items = value as unknown[];
  let previousTerm: string | null = null;
  for (const item of items) {
    if (!exactKeys(item, ['term', 'origins'])
      || typeof item.term !== 'string'
      || !item.term.length
      || normalizeTerm(item.term) !== item.term
      || !Array.isArray(item.origins)
      || !item.origins.length) {
      invalid('relationship_input_feature_record_invalid');
    }
    const origins = item.origins as unknown[];
    if (origins.some((origin) => !FEATURE_ORIGIN_ORDER.includes(origin as CaseGraphFeatureOrigin)
      || !allowedOrigins.includes(origin as CaseGraphFeatureOrigin))) {
      invalid('relationship_input_feature_record_invalid');
    }
    const normalizedOrigins = [...origins].sort((left, right) => (
      FEATURE_ORIGIN_ORDER.indexOf(left as CaseGraphFeatureOrigin)
      - FEATURE_ORIGIN_ORDER.indexOf(right as CaseGraphFeatureOrigin)
    ));
    if (new Set(origins).size !== origins.length
      || canonicalizeRelationshipInput(origins) !== canonicalizeRelationshipInput(normalizedOrigins)
      || (previousTerm !== null && previousTerm.localeCompare(item.term) >= 0)) {
      invalid('relationship_input_feature_record_invalid');
    }
    previousTerm = item.term;
  }
};

const expectedCompleteness = (feature: CaseGraphFeatureRecord) => {
  const missing: string[] = [];
  let score = 0;
  if (feature.narrative.characterCount > 0) score += 0.25;
  else missing.push('narrative');
  if (feature.event.timestamp) score += 0.15;
  else missing.push('event_timestamp');
  if (feature.event.datePrecision !== 'unknown') score += 0.1;
  else missing.push('event_date_precision');
  if (feature.event.lat != null && feature.event.lon != null) score += 0.15;
  else missing.push('coordinates');
  if (feature.event.geoPrecision !== 'unknown') score += 0.1;
  else missing.push('geo_precision');
  if (feature.traits.visual.length) score += 0.1;
  else missing.push('visual_traits');
  if (feature.durationSeconds != null) score += 0.05;
  else missing.push('duration');
  if (feature.traits.entities.length) score += 0.1;
  else missing.push('entities');
  return { score: Number(score.toFixed(2)), missing: missing.sort() };
};

const validateFeatureRecord = (feature: CaseGraphFeatureRecord) => {
  if (!exactKeys(feature, FEATURE_KEYS)
    || feature.status !== 'included'
    || feature.schemaVersion !== CASE_GRAPH_FEATURE_SCHEMA_VERSION
    || typeof feature.corpusVersion !== 'string'
    || !feature.corpusVersion.length
    || normalizeText(feature.corpusVersion, 120) !== feature.corpusVersion
    || !ID_PATTERN.test(feature.corpusVersion)
    || typeof feature.caseId !== 'string'
    || !feature.caseId.length
    || normalizeText(feature.caseId, 120) !== feature.caseId
    || typeof feature.source !== 'string'
    || !feature.source.length
    || normalizeText(feature.source, 160).toLowerCase() !== feature.source
    || !canonicalOptionalText(feature.sourceRecordId, 240)
    || !canonicalOptionalText(feature.sourceUrl, 2_000)
    || !canonicalOptionalText(feature.ingestionJobId, 160)
    || !exactKeys(feature.event, [
      'timestamp', 'datePrecision', 'lat', 'lon', 'geoPrecision', 'spatialPrecisionKm', 'locationKey',
    ])
    || !canonicalIsoOrNull(feature.event.timestamp)
    || !DATE_PRECISIONS.includes(feature.event.datePrecision)
    || !GEO_PRECISIONS.includes(feature.event.geoPrecision)
    || !canonicalOptionalText(feature.event.locationKey, 500)
    || !exactKeys(feature.traits, ['visual', 'behaviour', 'sensory', 'entities', 'keywords'])
    || !exactKeys(feature.narrative, ['digest', 'characterCount', 'hasCleanDescription', 'hasAiSummary'])
    || !SHA256_PATTERN.test(String(feature.narrative.digest))
    || !Number.isSafeInteger(feature.narrative.characterCount)
    || feature.narrative.characterCount < 0
    || feature.narrative.characterCount > 28_002
    || typeof feature.narrative.hasCleanDescription !== 'boolean'
    || typeof feature.narrative.hasAiSummary !== 'boolean'
    || (feature.narrative.characterCount === 0
      && (feature.narrative.hasCleanDescription || feature.narrative.hasAiSummary))
    || !exactKeys(feature.completeness, ['score', 'missing'])
    || !Number.isFinite(feature.completeness.score)
    || !Array.isArray(feature.completeness.missing)
    || !canonicalIsoOrNull(feature.sourceUpdatedAt)) {
    invalid('relationship_input_feature_record_invalid');
  }

  const coordinatesPresent = feature.event.lat !== null || feature.event.lon !== null;
  if (coordinatesPresent && (
    typeof feature.event.lat !== 'number'
    || typeof feature.event.lon !== 'number'
    || !Number.isFinite(feature.event.lat)
    || !Number.isFinite(feature.event.lon)
    || feature.event.lat < -90
    || feature.event.lat > 90
    || feature.event.lon < -180
    || feature.event.lon > 180
  )) invalid('relationship_input_feature_record_invalid');

  const expectedSpatialPrecision = ({
    exact: 0.1,
    city: 25,
    region: 200,
    country: 1_000,
    unknown: null,
  } as const)[feature.event.geoPrecision];
  if (feature.event.spatialPrecisionKm !== expectedSpatialPrecision
    || (feature.durationSeconds !== null && (
      !Number.isSafeInteger(feature.durationSeconds) || feature.durationSeconds < 0
    ))) invalid('relationship_input_feature_record_invalid');

  validateFeatureTerms(feature.traits.visual, ['structured', 'narrative']);
  validateFeatureTerms(feature.traits.behaviour, ['narrative']);
  validateFeatureTerms(feature.traits.sensory, ['narrative']);
  validateFeatureTerms(feature.traits.entities, ['ai_entity']);
  validateFeatureTerms(feature.traits.keywords, ['ai_keyword']);

  const expected = expectedCompleteness(feature);
  if (feature.completeness.score !== expected.score
    || canonicalizeRelationshipInput(feature.completeness.missing) !== canonicalizeRelationshipInput(expected.missing)) {
    invalid('relationship_input_feature_record_invalid');
  }
};

export const relationshipInputFeatureRecordSha256 = (feature: CaseGraphFeatureRecord) => {
  validateFeatureRecord(feature);
  return relationshipInputSha256(feature);
};

const structuredOrigin = (
  node: EvidenceUniverseNode,
  field: string,
): RelationshipInputOriginDraft => ({
  sourceAddress: node.address,
  sourceField: `featureArchive.${field}`,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: RELATIONSHIP_INPUT_FEATURE_ADAPTER_VERSION },
});

const dateMetadata = (precision: CaseGraphDatePrecision): {
  confidence: number;
  uncertainty: RelationshipInputUncertainty;
  precision: RelationshipInputPrecision;
} => {
  switch (precision) {
    case 'exact':
      return { confidence: 1, uncertainty: { level: 'none', reasons: [] }, precision: { kind: 'exact' } };
    case 'day':
      return {
        confidence: 0.95,
        uncertainty: { level: 'low', reasons: ['date_precision_day'] },
        precision: { kind: 'categorical', vocabularyVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION },
      };
    case 'month':
      return {
        confidence: 0.8,
        uncertainty: { level: 'medium', reasons: ['date_precision_month'] },
        precision: { kind: 'categorical', vocabularyVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION },
      };
    case 'year':
      return {
        confidence: 0.65,
        uncertainty: { level: 'high', reasons: ['date_precision_year'] },
        precision: { kind: 'categorical', vocabularyVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION },
      };
    case 'unknown':
      return {
        confidence: 0.5,
        uncertainty: { level: 'unknown', reasons: ['date_precision_unknown'] },
        precision: { kind: 'unknown' },
      };
  }
};

const geoMetadata = (precision: CaseGraphGeoPrecision, spatialPrecisionKm: number): {
  confidence: number;
  uncertainty: RelationshipInputUncertainty;
  precision: RelationshipInputPrecision;
} => {
  const approximate = { kind: 'approximate', unit: 'kilometres', tolerance: spatialPrecisionKm } as const;
  switch (precision) {
    case 'exact':
      return { confidence: 0.99, uncertainty: { level: 'low', reasons: ['coordinate_precision_bound'] }, precision: approximate };
    case 'city':
      return { confidence: 0.9, uncertainty: { level: 'low', reasons: ['geo_precision_city'] }, precision: approximate };
    case 'region':
      return { confidence: 0.75, uncertainty: { level: 'medium', reasons: ['geo_precision_region'] }, precision: approximate };
    case 'country':
      return { confidence: 0.55, uncertainty: { level: 'high', reasons: ['geo_precision_country'] }, precision: approximate };
    case 'unknown':
      return { confidence: 0.5, uncertainty: { level: 'unknown', reasons: ['geo_precision_unknown'] }, precision: approximate };
  }
};

const equalNullable = (left: unknown, right: unknown) => (left ?? null) === (right ?? null);

/**
 * Converts the already archived sighting feature record into conservative
 * metadata for relationship-input v2. Every exact feature path is bound by a
 * whole-record receipt, while AI keywords/entities remain unpromoted until a
 * governed model or registry can supply their own inspectable receipt.
 */
export const buildRelationshipInputFeatureEnrichment = (
  node: EvidenceUniverseNode,
  feature: CaseGraphFeatureRecord,
  expectedCorpusVersion: string,
): RelationshipInputExtractionEnrichment => {
  validateCanonicalNode(node);
  const featureRecordSha256 = relationshipInputFeatureRecordSha256(feature);
  if (!expectedCorpusVersion.length
    || normalizeText(expectedCorpusVersion, 120) !== expectedCorpusVersion
    || !ID_PATTERN.test(expectedCorpusVersion)) {
    invalid('relationship_input_feature_corpus_version_invalid');
  }
  if (
    node.kind !== 'sighting'
    || feature.status !== 'included'
    || feature.schemaVersion !== CASE_GRAPH_FEATURE_SCHEMA_VERSION
    || feature.corpusVersion !== expectedCorpusVersion
    || feature.caseId !== node.recordId
    // The universe retains the source label as captured while the feature
    // archive stores its canonical lowercase form. Source identity is
    // case-insensitive, but every other join field remains exact.
    || feature.source !== normalizeText(node.source, 160).toLowerCase()
    || !equalNullable(feature.sourceRecordId, node.sourceRecordId)
    || !equalNullable(feature.sourceUrl, node.canonicalUrl)
    || feature.sourceUpdatedAt !== node.updatedAt
    || !equalNullable(feature.event.timestamp, node.eventTimestamp)
    || !equalNullable(feature.event.lat, node.lat)
    || !equalNullable(feature.event.lon, node.lon)
  ) invalid('relationship_input_feature_join_mismatch');

  const enrichment: RelationshipInputExtractionEnrichment = {
    featureArchiveReceipt: {
      featureSchemaVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
      corpusVersion: feature.corpusVersion,
      recordSha256: featureRecordSha256,
      origins: [structuredOrigin(node, 'record')],
    },
  };
  if (node.eventTimestamp) {
    enrichment.eventPrecision = {
      ...dateMetadata(feature.event.datePrecision),
      datePrecision: feature.event.datePrecision,
      origins: [structuredOrigin(node, 'event.datePrecision')],
    };
  }
  if (node.lat != null && node.lon != null) {
    if (feature.event.spatialPrecisionKm != null) {
      const spatialPrecisionKm = feature.event.spatialPrecisionKm;
      enrichment.spatialPrecision = {
        ...geoMetadata(feature.event.geoPrecision, spatialPrecisionKm),
        spatialPrecisionKm,
        origins: [structuredOrigin(node, 'event.spatialPrecisionKm')],
      };
    }
  }
  if (feature.durationSeconds != null) {
    if (!Number.isFinite(feature.durationSeconds) || feature.durationSeconds < 0) {
      invalid('relationship_input_feature_duration_invalid');
    }
    enrichment.duration = {
      seconds: feature.durationSeconds,
      confidence: 0.9,
      uncertainty: { level: 'low', reasons: ['duration_precision_unspecified'] },
      precision: {
        kind: 'approximate',
        unit: 'seconds',
        tolerance: Math.max(1, Number((feature.durationSeconds * 0.05).toFixed(3))),
      },
      origins: [structuredOrigin(node, 'durationSeconds')],
    };
  }
  return enrichment;
};
