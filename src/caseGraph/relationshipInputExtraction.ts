import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  evidenceUniverseAddress,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
} from './evidenceUniverse';
import { CASE_GRAPH_FEATURE_SCHEMA_VERSION } from './featureExtraction';
import {
  CASE_GRAPH_SOURCE_REGISTRY_VERSION,
  resolveCaseGraphSource,
} from './sourceRegistry';
import {
  buildRelationshipInputRecord,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputContextValue,
  type RelationshipInputCrossReferenceDraft,
  type RelationshipInputDuplicateLineage,
  type RelationshipInputFactDraft,
  type RelationshipInputFactFamily,
  type RelationshipInputGovernedReferenceDraft,
  type RelationshipInputNarrativeVector,
  type RelationshipInputOriginDraft,
  type RelationshipInputPrecision,
  type RelationshipInputRecord,
  type RelationshipInputSourceAssertionDraft,
  type RelationshipInputUncertainty,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const RELATIONSHIP_INPUT_EXTRACTION_VERSION = 'relationship-input-extraction-v2' as const;
export const RELATIONSHIP_INPUT_VISUAL_VOCABULARY_VERSION = 'relationship-visual-v2' as const;
export const RELATIONSHIP_INPUT_BEHAVIOURAL_VOCABULARY_VERSION = 'relationship-behavioural-v2' as const;
export const RELATIONSHIP_INPUT_SENSORY_VOCABULARY_VERSION = 'relationship-sensory-v2' as const;
export const RELATIONSHIP_INPUT_DURATION_VERSION = 'relationship-duration-v2' as const;

type EvidenceMetadata = {
  confidence: number;
  uncertainty: RelationshipInputUncertainty;
  precision: RelationshipInputPrecision;
  origins: RelationshipInputOriginDraft[];
};

export type RelationshipInputVectorPolicy = {
  modelId: string;
  modelVersion: string;
  dimensions: number;
  normalization: 'l2' | 'none';
};

export type RelationshipInputExtractionEnrichment = {
  eventPrecision?: EvidenceMetadata & {
    datePrecision: 'exact' | 'hour' | 'day' | 'month' | 'year' | 'unknown';
  };
  spatialPrecision?: EvidenceMetadata & { spatialPrecisionKm: number };
  duration?: EvidenceMetadata & { seconds: number };
  duplicateLineage?: Omit<RelationshipInputDuplicateLineage, 'origins'> & {
    origins: RelationshipInputOriginDraft[];
  };
  crossReferences?: RelationshipInputCrossReferenceDraft[];
  sourceAssertions?: RelationshipInputSourceAssertionDraft[];
  narrativeVector?: Extract<RelationshipInputNarrativeVector, { status: 'present' }>;
  governedMentions?: Array<EvidenceMetadata & {
    governedId: string;
    kind: 'entity' | 'site';
    registryVersion: string;
    label: string;
  }>;
  narrativePatterns?: Array<EvidenceMetadata & {
    patternId: string;
    registryVersion: string;
  }>;
  contextualInputs?: Array<EvidenceMetadata & Omit<RelationshipInputContextValue,
    'kind' | 'interpretation'>>;
  featureArchiveReceipt?: {
    featureSchemaVersion: typeof CASE_GRAPH_FEATURE_SCHEMA_VERSION;
    corpusVersion: string;
    recordSha256: string;
    origins: RelationshipInputOriginDraft[];
  };
};

export type RelationshipInputExtractionOptions = {
  binding: RelationshipInputUniverseBinding;
  vectorPolicy: RelationshipInputVectorPolicy;
  enrichment?: RelationshipInputExtractionEnrichment;
};

type NarrativeField = {
  sourceField: 'title' | 'summary';
  text: string;
};

type LexicalRule = {
  family: 'visual' | 'behavioural' | 'sensory';
  termId: string;
  patterns: readonly RegExp[];
  allowExplicitAbsence?: boolean;
};

const LEXICAL_RULES: readonly LexicalRule[] = [
  { family: 'visual', termId: 'amber', patterns: [/\bamber\b/giu] },
  { family: 'visual', termId: 'black', patterns: [/\bblack\b/giu] },
  { family: 'visual', termId: 'blue', patterns: [/\bblue\b/giu] },
  { family: 'visual', termId: 'green', patterns: [/\bgreen\b/giu] },
  { family: 'visual', termId: 'orange', patterns: [/\borange\b/giu] },
  { family: 'visual', termId: 'red', patterns: [/\bred\b/giu] },
  { family: 'visual', termId: 'silver', patterns: [/\bsilver\b/giu] },
  { family: 'visual', termId: 'white', patterns: [/\bwhite\b/giu] },
  { family: 'visual', termId: 'yellow', patterns: [/\byellow\b/giu] },
  { family: 'visual', termId: 'boomerang', patterns: [/\bboomerang\b/giu] },
  { family: 'visual', termId: 'chevron', patterns: [/\bchevron\b/giu, /\bv[- ]shape(?:d)?\b/giu] },
  { family: 'visual', termId: 'cigar', patterns: [/\bcigar(?:[- ]shape(?:d)?)?\b/giu] },
  { family: 'visual', termId: 'diamond', patterns: [/\bdiamond(?:[- ]shape(?:d)?)?\b/giu] },
  { family: 'visual', termId: 'disk', patterns: [/\bdisc\b/giu, /\bdisk\b/giu, /\bsaucer\b/giu] },
  { family: 'visual', termId: 'rectangle', patterns: [/\brectang(?:le|ular)\b/giu] },
  { family: 'visual', termId: 'sphere', patterns: [/\bspher(?:e|ical)\b/giu, /\borb\b/giu] },
  { family: 'visual', termId: 'triangle', patterns: [/\btriang(?:le|ular)\b/giu] },
  { family: 'behavioural', termId: 'ascend', patterns: [/\bascend(?:ed|ing)?\b/giu] },
  { family: 'behavioural', termId: 'descend', patterns: [/\bdescend(?:ed|ing)?\b/giu] },
  { family: 'behavioural', termId: 'disappear', patterns: [/\bdisappear(?:ed|ing)?\b/giu, /\bvanish(?:ed|ing)?\b/giu] },
  { family: 'behavioural', termId: 'hover', patterns: [/\bhover(?:ed|ing)?\b/giu] },
  { family: 'behavioural', termId: 'stationary', patterns: [/\bstationary\b/giu, /\bmotionless\b/giu] },
  { family: 'behavioural', termId: 'zig_zag', patterns: [/\bzig[ -]?zag(?:ged|ging)?\b/giu] },
  {
    family: 'behavioural',
    termId: 'instant_acceleration',
    patterns: [/\binstant(?:aneous(?:ly)?)? accelerat(?:e|ed|ion)\b/giu],
  },
  {
    family: 'sensory',
    termId: 'silent',
    patterns: [/\bsilent(?:ly)?\b/giu, /\bno (?:sound|noise)\b/giu, /\bwithout (?:a )?(?:sound|noise)\b/giu],
    allowExplicitAbsence: true,
  },
  { family: 'sensory', termId: 'buzzing_or_humming', patterns: [/\bbuzz(?:ed|ing)?\b/giu, /\bhumm?(?:ed|ing)\b/giu] },
  { family: 'sensory', termId: 'sonic_boom', patterns: [/\bsonic boom\b/giu] },
  { family: 'sensory', termId: 'radio_interference', patterns: [/\bradio (?:interference|static|failure)\b/giu] },
  { family: 'sensory', termId: 'power_interruption', patterns: [/\bpower (?:cut|outage|failure)\b/giu] },
  { family: 'sensory', termId: 'engine_interruption', patterns: [/\bengine (?:cut out|stalled|stopped|failed)\b/giu] },
  { family: 'sensory', termId: 'heat', patterns: [/\b(?:intense )?heat(?: sensation)?\b/giu] },
  { family: 'sensory', termId: 'vibration', patterns: [/\bvibrat(?:e|ed|ing|ion)\b/giu] },
  { family: 'sensory', termId: 'physical_trace', patterns: [/\bphysical trace\b/giu, /\bscorch marks?\b/giu] },
] as const;

const DURATION_PATTERN = /\bfor\s+(?:(about|approximately|approx\.?|roughly|nearly)\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/giu;
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const FACT_FAMILIES: readonly RelationshipInputFactFamily[] = [
  'provenance', 'space_time', 'visual', 'behavioural', 'sensory', 'duration',
  'entity', 'site', 'narrative_pattern', 'contextual_explanation',
];
const BINDING_KEYS = [
  'snapshotId', 'corpusVersion', 'universeArchiveVersion', 'universeSchemaVersion',
  'universeLayoutVersion', 'universeArchiveSetSha256', 'universeRecordCount',
] as const;
const NODE_KEYS = [
  'schemaVersion', 'layoutVersion', 'address', 'kind', 'recordId', 'source',
  'sourceRecordId', 'title', 'summary', 'canonicalUrl', 'previewUrl', 'eventTimestamp',
  'lat', 'lon', 'location', 'countryCode', 'linkedSightingId', 'updatedAt', 'position',
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> => {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
};

const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

const assertUncertaintyShape = (value: unknown) => {
  if (!exactKeys(value, ['level', 'reasons']) || !Array.isArray(value.reasons)) {
    invalid('relationship_input_extraction_enrichment_shape_invalid');
  }
};

const assertPrecisionShape = (value: unknown) => {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    invalid('relationship_input_extraction_enrichment_shape_invalid');
  }
  const keys = ({
    exact: ['kind'],
    bounded: ['kind', 'unit', 'lower', 'upper'],
    approximate: ['kind', 'unit', 'tolerance'],
    categorical: ['kind', 'vocabularyVersion'],
    unknown: ['kind'],
  } as const)[value.kind as RelationshipInputPrecision['kind']];
  if (!keys || !exactKeys(value, keys)) {
    invalid('relationship_input_extraction_enrichment_shape_invalid');
  }
};

const assertOriginShape = (origin: unknown) => {
  if (!isPlainObject(origin) || !exactKeys(origin, [
    'sourceAddress', 'sourceField', 'sourceTextSha256', 'sourceTextBytes', 'supportingSpans', 'extraction',
  ])) invalid('relationship_input_extraction_origin_shape_invalid');
  if (!Array.isArray(origin.supportingSpans)
    || origin.supportingSpans.some((span: unknown) => !exactKeys(span, ['unit', 'start', 'end', 'text', 'textSha256']))
    || !exactKeys(origin.extraction, ['method', 'version'])) {
    invalid('relationship_input_extraction_origin_shape_invalid');
  }
};

const assertEvidenceMetadataShape = (value: unknown, additional: readonly string[]) => {
  if (!isPlainObject(value)
    || !exactKeys(value, ['confidence', 'uncertainty', 'precision', 'origins', ...additional])) {
    invalid('relationship_input_extraction_enrichment_shape_invalid');
  }
  assertUncertaintyShape(value.uncertainty);
  assertPrecisionShape(value.precision);
  if (!Array.isArray(value.origins) || !value.origins.length) {
    invalid('relationship_input_extraction_enrichment_receipt_required');
  }
  value.origins.forEach(assertOriginShape);
};

const validateOptionsShape = (options: RelationshipInputExtractionOptions) => {
  if (!exactKeys(options, ['binding', 'vectorPolicy'], ['enrichment'])
    || !exactKeys(options.binding, BINDING_KEYS)
    || !exactKeys(options.vectorPolicy, ['modelId', 'modelVersion', 'dimensions', 'normalization'])) {
    invalid('relationship_input_extraction_options_shape_invalid');
  }
  if (!hasOwn(options, 'enrichment')) return;
  const enrichment = options.enrichment;
  if (!isPlainObject(enrichment)) invalid('relationship_input_extraction_enrichment_shape_invalid');
  if (!exactKeys(enrichment, [], [
    'eventPrecision', 'spatialPrecision', 'duration', 'duplicateLineage', 'crossReferences',
    'sourceAssertions', 'narrativeVector', 'governedMentions', 'narrativePatterns', 'contextualInputs',
    'featureArchiveReceipt',
  ])) invalid('relationship_input_extraction_enrichment_shape_invalid');
  if (hasOwn(enrichment, 'eventPrecision')) assertEvidenceMetadataShape(enrichment.eventPrecision, ['datePrecision']);
  if (hasOwn(enrichment, 'spatialPrecision')) assertEvidenceMetadataShape(enrichment.spatialPrecision, ['spatialPrecisionKm']);
  if (hasOwn(enrichment, 'duration')) assertEvidenceMetadataShape(enrichment.duration, ['seconds']);
  if (hasOwn(enrichment, 'duplicateLineage')) {
    const duplicateLineage: unknown = enrichment.duplicateLineage;
    if (!exactKeys(duplicateLineage, ['clusterId', 'status', 'canonicalAddress', 'memberRole', 'origins'])
      || !Array.isArray(duplicateLineage.origins)) invalid('relationship_input_extraction_enrichment_shape_invalid');
    duplicateLineage.origins.forEach(assertOriginShape);
  }
  if (hasOwn(enrichment, 'crossReferences')) {
    if (!Array.isArray(enrichment.crossReferences)) invalid('relationship_input_extraction_enrichment_shape_invalid');
    for (const item of enrichment.crossReferences) {
      if (!exactKeys(item, ['targetAddress', 'relation', 'origins']) || !Array.isArray(item.origins)) {
        invalid('relationship_input_extraction_enrichment_shape_invalid');
      }
      item.origins.forEach(assertOriginShape);
    }
  }
  if (hasOwn(enrichment, 'sourceAssertions')) {
    if (!Array.isArray(enrichment.sourceAssertions)) invalid('relationship_input_extraction_enrichment_shape_invalid');
    for (const item of enrichment.sourceAssertions) {
      if (!exactKeys(item, ['counterpartySourceId', 'classification', 'basis', 'origins']) || !Array.isArray(item.origins)) {
        invalid('relationship_input_extraction_enrichment_shape_invalid');
      }
      item.origins.forEach(assertOriginShape);
    }
  }
  if (hasOwn(enrichment, 'narrativeVector') && !exactKeys(enrichment.narrativeVector, [
    'status', 'modelId', 'modelVersion', 'dimensions', 'normalization', 'inputSha256', 'vectorSha256',
  ])) invalid('relationship_input_extraction_enrichment_shape_invalid');
  for (const key of ['governedMentions', 'narrativePatterns', 'contextualInputs'] as const) {
    if (hasOwn(enrichment, key) && !Array.isArray(enrichment[key])) {
      invalid('relationship_input_extraction_enrichment_shape_invalid');
    }
  }
  for (const item of enrichment.governedMentions || []) {
    assertEvidenceMetadataShape(item, ['governedId', 'kind', 'registryVersion', 'label']);
  }
  for (const item of enrichment.narrativePatterns || []) {
    assertEvidenceMetadataShape(item, ['patternId', 'registryVersion']);
  }
  for (const item of enrichment.contextualInputs || []) {
    assertEvidenceMetadataShape(item, ['explanationType', 'referenceId', 'matchStatus', 'metrics']);
  }
  if (hasOwn(enrichment, 'featureArchiveReceipt')) {
    const receipt: unknown = enrichment.featureArchiveReceipt;
    if (!exactKeys(receipt, ['featureSchemaVersion', 'corpusVersion', 'recordSha256', 'origins'])
      || receipt.featureSchemaVersion !== CASE_GRAPH_FEATURE_SCHEMA_VERSION
      || typeof receipt.corpusVersion !== 'string'
      || receipt.corpusVersion.length > 120
      || !ID_PATTERN.test(receipt.corpusVersion)
      || !SHA256_PATTERN.test(String(receipt.recordSha256))
      || !Array.isArray(receipt.origins)
      || !receipt.origins.length) {
      invalid('relationship_input_extraction_feature_receipt_invalid');
    }
    receipt.origins.forEach(assertOriginShape);
  }
};

const narrativeFields = (node: EvidenceUniverseNode): NarrativeField[] => {
  const fields: NarrativeField[] = [
    { sourceField: 'title', text: node.title || '' },
    { sourceField: 'summary', text: node.summary || '' },
  ];
  return fields.filter((field) => field.text.length > 0);
};

export const relationshipInputNarrativeSha256 = (node: EvidenceUniverseNode) => {
  const fields = narrativeFields(node);
  if (!fields.length) return null;
  return relationshipInputSha256(fields.map((field) => (
    `${field.sourceField}:${Buffer.byteLength(field.text, 'utf8')}:${field.text}`
  )).join('\n'));
};

const structuredOrigin = (node: EvidenceUniverseNode, sourceField: string): RelationshipInputOriginDraft => ({
  sourceAddress: node.address,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: RELATIONSHIP_INPUT_EXTRACTION_VERSION },
});

const narrativeOrigin = (
  node: EvidenceUniverseNode,
  field: NarrativeField,
  characterStart: number,
  characterEnd: number,
): RelationshipInputOriginDraft => {
  const text = field.text.slice(characterStart, characterEnd);
  const start = Buffer.byteLength(field.text.slice(0, characterStart), 'utf8');
  const end = start + Buffer.byteLength(text, 'utf8');
  return {
    sourceAddress: node.address,
    sourceField: field.sourceField,
    sourceTextSha256: relationshipInputSha256(field.text),
    sourceTextBytes: Buffer.byteLength(field.text, 'utf8'),
    supportingSpans: [{ unit: 'utf8_byte', start, end, text, textSha256: relationshipInputSha256(text) }],
    extraction: { method: 'deterministic_rule', version: RELATIONSHIP_INPUT_EXTRACTION_VERSION },
  };
};

const isNegated = (text: string, matchStart: number, matchText: string, allowExplicitAbsence = false) => {
  if (allowExplicitAbsence && /^(?:no|without)\b/iu.test(matchText)) return false;
  const prefix = text.slice(Math.max(0, matchStart - 120), matchStart);
  const clause = prefix.split(/(?:[.!?;:\n]|\bbut\b|\bhowever\b)/iu).at(-1) || '';
  const suffix = text.slice(matchStart + matchText.length, matchStart + matchText.length + 100)
    .split(/(?:[.!?;:\n]|\bbut\b|\bhowever\b)/iu)[0] || '';
  const precedingNegation = /\b(?:no|not|never|without|cannot|can['’]?t|didn['’]?t|doesn['’]?t|isn['’]?t|wasn['’]?t|weren['’]?t|denied|denies)\b(?:[\s"'’()-]+[\p{L}\p{N}_'’/-]+){0,6}[\s"'’()-]*$/iu.test(clause);
  const followingDenial = /^(?:[\s"'’()-]+[\p{L}\p{N}_'’/-]+){0,3}[\s"'’()-]+(?:was|were|is|are|has|have)?[\s"'’()-]*not[\s"'’()-]+(?:seen|observed|heard|reported|detected|described|present)\b/iu.test(suffix);
  return precedingNegation || followingDenial;
};

const vocabularyForFamily = (family: LexicalRule['family']) => ({
  visual: RELATIONSHIP_INPUT_VISUAL_VOCABULARY_VERSION,
  behavioural: RELATIONSHIP_INPUT_BEHAVIOURAL_VOCABULARY_VERSION,
  sensory: RELATIONSHIP_INPUT_SENSORY_VOCABULARY_VERSION,
}[family]);

type PresentFact = RelationshipInputFactDraft & { value: NonNullable<RelationshipInputFactDraft['value']> };

const factKey = (fact: PresentFact) => canonicalizeRelationshipInput({
  family: fact.family,
  predicate: fact.predicate,
  value: fact.value,
});

const mergeOrigins = (left: RelationshipInputOriginDraft[], right: RelationshipInputOriginDraft[]) => {
  const origins = new Map<string, RelationshipInputOriginDraft>();
  for (const origin of [...left, ...right]) origins.set(canonicalizeRelationshipInput(origin), origin);
  return [...origins.entries()].sort(([leftKey], [rightKey]) => compareText(leftKey, rightKey)).map(([, origin]) => origin);
};

const addPresentFact = (facts: Map<string, PresentFact>, fact: PresentFact) => {
  const key = factKey(fact);
  const existing = facts.get(key);
  if (!existing) {
    facts.set(key, { ...fact, origins: mergeOrigins([], fact.origins) });
    return;
  }
  const preferNewMetadata = Number(fact.confidence) > Number(existing.confidence);
  facts.set(key, {
    ...existing,
    ...(preferNewMetadata ? {
      confidence: fact.confidence,
      uncertainty: fact.uncertainty,
      precision: fact.precision,
    } : {}),
    origins: mergeOrigins(existing.origins, fact.origins),
  });
};

const lexicalFacts = (node: EvidenceUniverseNode, facts: Map<string, PresentFact>) => {
  for (const field of narrativeFields(node)) {
    for (const rule of LEXICAL_RULES) {
      for (const sourcePattern of rule.patterns) {
        const pattern = new RegExp(sourcePattern.source, sourcePattern.flags);
        for (const match of field.text.matchAll(pattern)) {
          if (match.index == null || isNegated(field.text, match.index, match[0], rule.allowExplicitAbsence)) continue;
          addPresentFact(facts, {
            family: rule.family,
            predicate: 'observed_trait',
            value: {
              kind: 'term',
              termId: rule.termId,
              vocabularyVersion: vocabularyForFamily(rule.family),
            },
            confidence: 0.82,
            uncertainty: { level: 'medium', reasons: ['lexical_rule_only'] },
            precision: { kind: 'categorical', vocabularyVersion: vocabularyForFamily(rule.family) },
            missingness: { status: 'present', reasons: [] },
            origins: [narrativeOrigin(node, field, match.index, match.index + match[0].length)],
          } as PresentFact);
        }
      }
    }
  }
};

const durationFacts = (node: EvidenceUniverseNode, facts: Map<string, PresentFact>) => {
  for (const field of narrativeFields(node)) {
    const pattern = new RegExp(DURATION_PATTERN.source, DURATION_PATTERN.flags);
    for (const match of field.text.matchAll(pattern)) {
      if (match.index == null || isNegated(field.text, match.index, match[0])) continue;
      const amount = NUMBER_WORDS[match[2].toLowerCase()] ?? Number(match[2]);
      const unit = match[3].toLowerCase();
      const multiplier = unit.startsWith('hour') || unit.startsWith('hr')
        ? 3_600
        : unit.startsWith('minute') || unit.startsWith('min') ? 60 : 1;
      const seconds = amount * multiplier;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 31 * 86_400) continue;
      addPresentFact(facts, {
        family: 'duration',
        predicate: 'observed_duration',
        value: { kind: 'duration', seconds },
        confidence: 0.76,
        uncertainty: { level: 'medium', reasons: ['narrative_duration'] },
        precision: { kind: 'approximate', unit: 'seconds', tolerance: multiplier },
        missingness: { status: 'present', reasons: [] },
        origins: [narrativeOrigin(node, field, match.index, match.index + match[0].length)],
      } as PresentFact);
    }
  }
};

const missingFact = (family: RelationshipInputFactFamily, reason: string): RelationshipInputFactDraft => ({
  family,
  predicate: `${family}_availability`,
  value: null,
  confidence: null,
  uncertainty: { level: 'unknown', reasons: [reason] },
  precision: { kind: 'unknown' },
  missingness: { status: 'not_recorded', reasons: [reason] },
  origins: [],
} as RelationshipInputFactDraft);

const validateNode = (node: EvidenceUniverseNode, binding: RelationshipInputUniverseBinding) => {
  if (!exactKeys(node, NODE_KEYS)) invalid('relationship_input_extraction_node_invalid');
  if (node.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || node.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || binding.universeSchemaVersion !== node.schemaVersion
    || binding.universeLayoutVersion !== node.layoutVersion) {
    invalid('relationship_input_extraction_universe_binding_mismatch');
  }
  try {
    accountEvidenceUniverseNodes([node]);
    const canonical = projectEvidenceUniverseNode({ ...node, public: true });
    if (canonicalizeRelationshipInput(node) !== canonicalizeRelationshipInput(canonical)) {
      invalid('relationship_input_extraction_node_invalid');
    }
  } catch {
    invalid('relationship_input_extraction_node_invalid');
  }
  if (node.kind === 'sighting' && node.linkedSightingId) invalid('relationship_input_extraction_sighting_link_invalid');
};

const enrichmentOrigins = (enrichment: RelationshipInputExtractionEnrichment) => [
  ...(enrichment.eventPrecision?.origins || []),
  ...(enrichment.spatialPrecision?.origins || []),
  ...(enrichment.duration?.origins || []),
  ...(enrichment.duplicateLineage?.origins || []),
  ...(enrichment.crossReferences || []).flatMap((item) => item.origins),
  ...(enrichment.sourceAssertions || []).flatMap((item) => item.origins),
  ...(enrichment.governedMentions || []).flatMap((item) => item.origins),
  ...(enrichment.narrativePatterns || []).flatMap((item) => item.origins),
  ...(enrichment.contextualInputs || []).flatMap((item) => item.origins),
  ...(enrichment.featureArchiveReceipt?.origins || []),
];

const validateCurrentNodeNarrativeReceipts = (
  node: EvidenceUniverseNode,
  enrichment: RelationshipInputExtractionEnrichment,
) => {
  for (const origin of enrichmentOrigins(enrichment)) {
    if (origin.sourceAddress !== node.address || (origin.sourceField !== 'title' && origin.sourceField !== 'summary')) {
      continue;
    }
    const sourceText = node[origin.sourceField];
    if (sourceText == null
      || origin.sourceTextSha256 !== relationshipInputSha256(sourceText)
      || origin.sourceTextBytes !== Buffer.byteLength(sourceText, 'utf8')
      || !origin.supportingSpans.length) {
      invalid('relationship_input_extraction_origin_source_mismatch');
    }
    const sourceBytes = Buffer.from(sourceText, 'utf8');
    for (const span of origin.supportingSpans) {
      if (sourceBytes.subarray(span.start, span.end).toString('utf8') !== span.text) {
        invalid('relationship_input_extraction_origin_source_mismatch');
      }
    }
  }
};

const mergeCrossReferences = (values: readonly RelationshipInputCrossReferenceDraft[]) => {
  const references = new Map<string, RelationshipInputCrossReferenceDraft>();
  for (const value of values) {
    const key = `${value.relation}:${value.targetAddress}`;
    const existing = references.get(key);
    references.set(key, existing
      ? { ...existing, origins: mergeOrigins(existing.origins, value.origins) }
      : { ...value, origins: mergeOrigins([], value.origins) });
  }
  return [...references.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value);
};

export const extractRelationshipInputRecord = (
  node: EvidenceUniverseNode,
  options: RelationshipInputExtractionOptions,
): RelationshipInputRecord => {
  validateOptionsShape(options);
  const binding = validateRelationshipInputBinding(options.binding);
  validateNode(node, binding);
  const enrichment = options.enrichment || {};
  validateCurrentNodeNarrativeReceipts(node, enrichment);
  const facts = new Map<string, PresentFact>();

  lexicalFacts(node, facts);
  durationFacts(node, facts);

  const provenanceOrigin = structuredOrigin(node, node.sourceRecordId ? 'sourceRecordId' : 'recordId');
  addPresentFact(facts, {
    family: 'provenance',
    predicate: 'governed_source_record',
    value: {
      kind: 'provenance',
      code: 'source_record',
      referenceId: `source-record:${relationshipInputSha256(`${node.source}\n${node.sourceRecordId || node.recordId}`)}`,
    },
    confidence: 1,
    uncertainty: { level: 'none', reasons: [] },
    precision: { kind: 'exact' },
    missingness: { status: 'present', reasons: [] },
    origins: [provenanceOrigin],
  } as PresentFact);

  if (node.eventTimestamp) {
    const metadata = enrichment.eventPrecision;
    addPresentFact(facts, {
      family: 'space_time',
      predicate: 'event_timestamp',
      value: {
        kind: 'timestamp',
        timestamp: node.eventTimestamp,
        datePrecision: metadata?.datePrecision || 'unknown',
      },
      confidence: metadata?.confidence ?? 0.5,
      uncertainty: metadata?.uncertainty || { level: 'unknown', reasons: ['date_precision_unknown'] },
      precision: metadata?.precision || { kind: 'unknown' },
      missingness: { status: 'present', reasons: [] },
      origins: mergeOrigins([structuredOrigin(node, 'eventTimestamp')], metadata?.origins || []),
    } as PresentFact);
  }
  if (node.lat != null && node.lon != null && enrichment.spatialPrecision) {
    addPresentFact(facts, {
      family: 'space_time',
      predicate: 'event_location',
      value: {
        kind: 'geo_point',
        lat: node.lat,
        lon: node.lon,
        spatialPrecisionKm: enrichment.spatialPrecision.spatialPrecisionKm,
      },
      confidence: enrichment.spatialPrecision.confidence,
      uncertainty: enrichment.spatialPrecision.uncertainty,
      precision: enrichment.spatialPrecision.precision,
      missingness: { status: 'present', reasons: [] },
      origins: mergeOrigins([
        structuredOrigin(node, 'lat'),
        structuredOrigin(node, 'lon'),
      ], enrichment.spatialPrecision.origins),
    } as PresentFact);
  }
  if (enrichment.duration) {
    addPresentFact(facts, {
      family: 'duration',
      predicate: 'observed_duration',
      value: { kind: 'duration', seconds: enrichment.duration.seconds },
      confidence: enrichment.duration.confidence,
      uncertainty: enrichment.duration.uncertainty,
      precision: enrichment.duration.precision,
      missingness: { status: 'present', reasons: [] },
      origins: enrichment.duration.origins,
    } as PresentFact);
  }

  const generatedCrossReferences: RelationshipInputCrossReferenceDraft[] = [];
  if (node.kind !== 'sighting' && node.linkedSightingId) {
    generatedCrossReferences.push({
      targetAddress: evidenceUniverseAddress('sighting', node.linkedSightingId),
      relation: 'media_attachment',
      origins: [structuredOrigin(node, 'linkedSightingId')],
    });
  }
  const crossReferences = mergeCrossReferences([
    ...generatedCrossReferences,
    ...(enrichment.crossReferences || []),
  ]);
  for (const reference of crossReferences) {
    addPresentFact(facts, {
      family: 'provenance',
      predicate: reference.relation === 'media_attachment' ? 'media_attachment' : 'explicit_cross_reference',
      value: {
        kind: 'provenance',
        code: reference.relation === 'media_attachment' ? 'media_attachment' : 'cross_reference',
        referenceId: reference.targetAddress,
      },
      confidence: 1,
      uncertainty: { level: 'none', reasons: [] },
      precision: { kind: 'exact' },
      missingness: { status: 'present', reasons: [] },
      origins: reference.origins,
    } as PresentFact);
  }
  if (enrichment.duplicateLineage) {
    addPresentFact(facts, {
      family: 'provenance',
      predicate: 'duplicate_cluster_membership',
      value: {
        kind: 'provenance',
        code: 'duplicate_cluster',
        referenceId: enrichment.duplicateLineage.clusterId,
      },
      confidence: enrichment.duplicateLineage.status === 'confirmed' ? 1 : 0.7,
      uncertainty: enrichment.duplicateLineage.status === 'confirmed'
        ? { level: 'none', reasons: [] }
        : { level: 'medium', reasons: ['candidate_duplicate'] },
      precision: { kind: 'exact' },
      missingness: { status: 'present', reasons: [] },
      origins: enrichment.duplicateLineage.origins,
    } as PresentFact);
  }
  if (enrichment.featureArchiveReceipt) {
    addPresentFact(facts, {
      family: 'provenance',
      predicate: 'archived_feature_record',
      value: {
        kind: 'provenance',
        code: 'ingestion_lineage',
        referenceId: `case-graph-feature:${enrichment.featureArchiveReceipt.corpusVersion}:${enrichment.featureArchiveReceipt.recordSha256}`,
      },
      confidence: 1,
      uncertainty: { level: 'none', reasons: [] },
      precision: { kind: 'exact' },
      missingness: { status: 'present', reasons: [] },
      origins: enrichment.featureArchiveReceipt.origins,
    } as PresentFact);
  }

  const governedReferenceMap = new Map<string, RelationshipInputGovernedReferenceDraft>();
  for (const mention of enrichment.governedMentions || []) {
    const key = `${mention.kind}:${mention.governedId}`;
    const existing = governedReferenceMap.get(key);
    if (existing && (existing.registryVersion !== mention.registryVersion || existing.label !== mention.label)) {
      invalid('relationship_input_extraction_governed_reference_conflict');
    }
    governedReferenceMap.set(key, {
      governedId: mention.governedId,
      kind: mention.kind,
      registryVersion: mention.registryVersion,
      label: mention.label,
      origins: mergeOrigins(existing?.origins || [], mention.origins),
    });
    addPresentFact(facts, {
      family: mention.kind,
      predicate: mention.kind === 'entity' ? 'mentions_entity' : 'mentions_site',
      value: {
        kind: 'governed_reference',
        governedId: mention.governedId,
        registryVersion: mention.registryVersion,
      },
      confidence: mention.confidence,
      uncertainty: mention.uncertainty,
      precision: mention.precision,
      missingness: { status: 'present', reasons: [] },
      origins: mention.origins,
    } as PresentFact);
  }

  for (const pattern of enrichment.narrativePatterns || []) {
    addPresentFact(facts, {
      family: 'narrative_pattern',
      predicate: 'governed_narrative_pattern',
      value: {
        kind: 'narrative_pattern',
        patternId: pattern.patternId,
        registryVersion: pattern.registryVersion,
      },
      confidence: pattern.confidence,
      uncertainty: pattern.uncertainty,
      precision: pattern.precision,
      missingness: { status: 'present', reasons: [] },
      origins: pattern.origins,
    } as PresentFact);
  }

  for (const context of enrichment.contextualInputs || []) {
    addPresentFact(facts, {
      family: 'contextual_explanation',
      predicate: 'contextual_explanation_candidate',
      value: {
        kind: 'contextual_explanation',
        explanationType: context.explanationType,
        referenceId: context.referenceId,
        matchStatus: context.matchStatus,
        interpretation: 'candidate_explanation_not_causal_attribution',
        metrics: context.metrics,
      },
      confidence: context.confidence,
      uncertainty: context.uncertainty,
      precision: context.precision,
      missingness: { status: 'present', reasons: [] },
      origins: context.origins,
    } as PresentFact);
  }

  const presentFacts = [...facts.entries()].sort(([left], [right]) => compareText(left, right)).map(([, fact]) => fact);
  const presentFamilies = new Set(presentFacts.map((fact) => fact.family));
  const missingFacts = FACT_FAMILIES.filter((family) => !presentFamilies.has(family)).map((family) => missingFact(
    family,
    narrativeFields(node).length ? 'no_supported_fact' : 'narrative_missing',
  ));

  const narrativeSha256 = relationshipInputNarrativeSha256(node);
  let narrativeVector: RelationshipInputNarrativeVector;
  if (enrichment.narrativeVector) {
    const vector = enrichment.narrativeVector;
    if (!narrativeSha256
      || vector.modelId !== options.vectorPolicy.modelId
      || vector.modelVersion !== options.vectorPolicy.modelVersion
      || vector.dimensions !== options.vectorPolicy.dimensions
      || vector.normalization !== options.vectorPolicy.normalization
      || vector.inputSha256 !== narrativeSha256) {
      invalid('relationship_input_extraction_vector_receipt_mismatch');
    }
    narrativeVector = vector;
  } else {
    narrativeVector = {
      status: 'missing',
      ...options.vectorPolicy,
      inputSha256: narrativeSha256,
      vectorSha256: null,
      reason: narrativeSha256 ? 'model_unavailable' : 'no_narrative',
    };
  }

  const recordMissingness: RelationshipInputRecord['recordMissingness'] = [];
  if (!narrativeFields(node).length) recordMissingness.push({ field: 'narrative', status: 'not_recorded', reason: 'narrative_missing' });
  if (!node.eventTimestamp) recordMissingness.push({ field: 'event_timestamp', status: 'not_recorded', reason: 'source_omitted' });
  if (node.lat == null || node.lon == null) recordMissingness.push({ field: 'coordinates', status: 'not_recorded', reason: 'source_omitted' });
  else if (!enrichment.spatialPrecision) recordMissingness.push({ field: 'spatial_precision', status: 'not_recorded', reason: 'precision_missing' });
  if (!presentFamilies.has('duration')) recordMissingness.push({ field: 'duration_seconds', status: 'not_recorded', reason: 'source_omitted' });
  if (!enrichment.narrativeVector) recordMissingness.push({ field: 'narrative_vector', status: 'not_recorded', reason: narrativeSha256 ? 'model_unavailable' : 'narrative_missing' });
  if (!node.sourceRecordId) recordMissingness.push({ field: 'source_record_id', status: 'not_recorded', reason: 'source_omitted' });
  if (node.kind !== 'sighting' && !node.linkedSightingId) {
    recordMissingness.push({ field: 'linked_sighting_id', status: 'not_recorded', reason: 'source_omitted' });
  }

  const source = resolveCaseGraphSource(node.source);
  return buildRelationshipInputRecord({
    binding,
    address: node.address,
    source: {
      sourceId: source.id,
      sourceRecordId: node.sourceRecordId,
      registryVersion: CASE_GRAPH_SOURCE_REGISTRY_VERSION,
      lineageId: source.lineageId,
      dependencyRisk: source.dependencyRisk,
    },
    facts: [...presentFacts, ...missingFacts],
    recordMissingness,
    duplicateLineage: enrichment.duplicateLineage || null,
    crossReferences,
    sourceAssertions: enrichment.sourceAssertions || [],
    narrativeVector,
    governedReferences: [...governedReferenceMap.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, reference]) => reference),
  });
};
