import { createHash } from 'node:crypto';

export const CASE_GRAPH_FEATURE_SCHEMA_VERSION = 'case-graph-features-v1' as const;

export type CaseGraphDatePrecision = 'exact' | 'day' | 'month' | 'year' | 'unknown';
export type CaseGraphGeoPrecision = 'exact' | 'city' | 'region' | 'country' | 'unknown';
export type CaseGraphFeatureOrigin = 'structured' | 'narrative' | 'ai_keyword' | 'ai_entity';

export type CaseGraphEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

export type CaseGraphRawSighting = {
  id: unknown;
  source?: unknown;
  source_record_id?: unknown;
  external_id?: unknown;
  source_url?: unknown;
  ingestion_job_id?: unknown;
  event_timestamp?: unknown;
  event_date_precision?: unknown;
  lat?: unknown;
  lon?: unknown;
  geo_precision?: unknown;
  location?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
  country_code?: unknown;
  description?: unknown;
  description_clean?: unknown;
  summary?: unknown;
  ai_summary?: unknown;
  shape?: unknown;
  shape_normalized?: unknown;
  duration_seconds?: unknown;
  ai_keywords?: unknown;
  ai_entities?: unknown;
  updated_at?: unknown;
};

export type CaseGraphExtractedTerm = {
  term: string;
  origins: CaseGraphFeatureOrigin[];
};

export type CaseGraphFeatureRecord = {
  status: 'included';
  schemaVersion: typeof CASE_GRAPH_FEATURE_SCHEMA_VERSION;
  corpusVersion: string;
  caseId: string;
  source: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  ingestionJobId: string | null;
  event: {
    timestamp: string | null;
    datePrecision: CaseGraphDatePrecision;
    lat: number | null;
    lon: number | null;
    geoPrecision: CaseGraphGeoPrecision;
    spatialPrecisionKm: number | null;
    locationKey: string | null;
  };
  durationSeconds: number | null;
  traits: {
    visual: CaseGraphExtractedTerm[];
    behaviour: CaseGraphExtractedTerm[];
    sensory: CaseGraphExtractedTerm[];
    entities: CaseGraphExtractedTerm[];
    keywords: CaseGraphExtractedTerm[];
  };
  narrative: {
    digest: string;
    characterCount: number;
    hasCleanDescription: boolean;
    hasAiSummary: boolean;
  };
  completeness: {
    score: number;
    missing: string[];
  };
  sourceUpdatedAt: string | null;
};

export type CaseGraphExcludedRecord = {
  status: 'excluded';
  schemaVersion: typeof CASE_GRAPH_FEATURE_SCHEMA_VERSION;
  corpusVersion: string;
  caseId: string | null;
  reason: string;
};

export type CaseGraphExtractionResult = CaseGraphFeatureRecord | CaseGraphExcludedRecord;

type TermRule = {
  term: string;
  patterns: RegExp[];
  allowNegativePhrase?: boolean;
};

const VISUAL_RULES: TermRule[] = [
  { term: 'amber', patterns: [/\bamber\b/g] },
  { term: 'black', patterns: [/\bblack\b/g] },
  { term: 'blue', patterns: [/\bblue\b/g] },
  { term: 'green', patterns: [/\bgreen\b/g] },
  { term: 'orange', patterns: [/\borange\b/g] },
  { term: 'red', patterns: [/\bred\b/g] },
  { term: 'silver', patterns: [/\bsilver\b/g] },
  { term: 'white', patterns: [/\bwhite\b/g] },
  { term: 'yellow', patterns: [/\byellow\b/g] },
  { term: 'boomerang', patterns: [/\bboomerang\b/g] },
  { term: 'chevron', patterns: [/\bchevron\b/g, /\bv[- ]shape(?:d)?\b/g] },
  { term: 'cigar', patterns: [/\bcigar(?:[- ]shape(?:d)?)?\b/g] },
  { term: 'diamond', patterns: [/\bdiamond(?:[- ]shape(?:d)?)?\b/g] },
  { term: 'disk', patterns: [/\bdisc\b/g, /\bdisk\b/g, /\bsaucer\b/g] },
  { term: 'fireball', patterns: [/\bfireball\b/g, /\bball of fire\b/g] },
  { term: 'formation', patterns: [/\bformation\b/g] },
  { term: 'rectangle', patterns: [/\brectang(?:le|ular)\b/g] },
  { term: 'sphere', patterns: [/\bspher(?:e|ical)\b/g, /\borb\b/g] },
  { term: 'triangle', patterns: [/\btriang(?:le|ular)\b/g] },
];

const BEHAVIOUR_RULES: TermRule[] = [
  { term: 'ascend', patterns: [/\bascend(?:ed|ing)?\b/g, /\brose (?:straight )?(?:up|vertically)\b/g] },
  { term: 'descend', patterns: [/\bdescend(?:ed|ing)?\b/g, /\bdropped (?:straight )?down\b/g] },
  { term: 'disappear', patterns: [/\bdisappear(?:ed|ing)?\b/g, /\bblink(?:ed)? out\b/g, /\bvanish(?:ed|ing)?\b/g] },
  { term: 'follow', patterns: [/\bfollow(?:ed|ing)?\b/g, /\bchased?\b/g, /\bshadowed\b/g] },
  { term: 'hover', patterns: [/\bhover(?:ed|ing)?\b/g] },
  { term: 'instant acceleration', patterns: [/\binstant(?:aneous(?:ly)?)? accelerat(?:e|ed|ion)\b/g, /\bshot away\b/g] },
  { term: 'stationary', patterns: [/\bstationary\b/g, /\bremained still\b/g, /\bmotionless\b/g] },
  { term: 'zig-zag movement', patterns: [/\bzig[ -]?zag(?:ged|ging)?\b/g, /\berratic movement\b/g] },
];

const SENSORY_RULES: TermRule[] = [
  { term: 'boom', patterns: [/\bsonic boom\b/g, /\bloud boom\b/g] },
  { term: 'buzzing or humming', patterns: [/\bbuzz(?:ed|ing)?\b/g, /\bhumm?(?:ed|ing)\b/g] },
  { term: 'engine interruption', patterns: [/\bengine (?:cut out|stalled|stopped|failed)\b/g] },
  { term: 'heat', patterns: [/\bintense heat\b/g, /\bheat sensation\b/g] },
  { term: 'physical trace', patterns: [/\bphysical trace\b/g, /\bscorch marks?\b/g, /\bburnt ground\b/g] },
  { term: 'power interruption', patterns: [/\bpower (?:cut|outage|failure)\b/g, /\blights? went out\b/g] },
  { term: 'radio interference', patterns: [/\bradio (?:interference|static|failure)\b/g] },
  {
    term: 'silent',
    patterns: [/\bsilent(?:ly)?\b/g, /\bno (?:sound|noise)\b/g, /\bwithout (?:a )?(?:sound|noise)\b/g],
    allowNegativePhrase: true,
  },
  { term: 'vibration', patterns: [/\bvibrat(?:e|ed|ing|ion)\b/g] },
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const DATE_PRECISIONS = new Set<CaseGraphDatePrecision>(['exact', 'day', 'month', 'year', 'unknown']);
const GEO_PRECISIONS = new Set<CaseGraphGeoPrecision>(['exact', 'city', 'region', 'country', 'unknown']);
const ORIGIN_ORDER: CaseGraphFeatureOrigin[] = ['structured', 'narrative', 'ai_keyword', 'ai_entity'];

const normalizeText = (value: unknown, maxLength = 20_000) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const normalizeTerm = (value: unknown, maxLength = 120) => normalizeText(value, maxLength)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeSource = (value: unknown) => normalizeText(value, 160).toLowerCase() || 'unknown';

const optionalText = (value: unknown, maxLength = 2_000) => normalizeText(value, maxLength) || null;

const parseFinite = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTimestamp = (value: unknown) => {
  const text = normalizeText(value, 100);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const parseUpdatedAt = (value: unknown) => parseTimestamp(value);

const parseDatePrecision = (value: unknown): CaseGraphDatePrecision => {
  const normalized = normalizeTerm(value) as CaseGraphDatePrecision;
  return DATE_PRECISIONS.has(normalized) ? normalized : 'unknown';
};

const parseGeoPrecision = (value: unknown): CaseGraphGeoPrecision => {
  const normalized = normalizeTerm(value) as CaseGraphGeoPrecision;
  return GEO_PRECISIONS.has(normalized) ? normalized : 'unknown';
};

const spatialPrecisionKm = (precision: CaseGraphGeoPrecision) => ({
  exact: 0.1,
  city: 25,
  region: 200,
  country: 1_000,
  unknown: null,
}[precision]);

const hasNearbyNegation = (text: string, index: number) => {
  const prefix = text.slice(Math.max(0, index - 28), index);
  return /\b(?:not|never|wasn['’]?t|isn['’]?t|weren['’]?t|without)\s+(?:(?:at all|a|an|any)\s+)?$/i.test(prefix);
};

const ruleMatches = (text: string, rule: TermRule) => rule.patterns.some((pattern) => {
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    const explicitAbsence = /^(?:no|without)\b/.test(match[0]);
    if (rule.allowNegativePhrase && explicitAbsence) return true;
    if (!hasNearbyNegation(text, match.index)) return true;
    match = pattern.exec(text);
  }
  return false;
});

const addTerm = (
  destination: Map<string, Set<CaseGraphFeatureOrigin>>,
  term: string,
  origin: CaseGraphFeatureOrigin,
) => {
  const normalized = normalizeTerm(term);
  if (!normalized) return;
  const origins = destination.get(normalized) || new Set<CaseGraphFeatureOrigin>();
  origins.add(origin);
  destination.set(normalized, origins);
};

const applyRules = (
  destination: Map<string, Set<CaseGraphFeatureOrigin>>,
  text: string,
  rules: TermRule[],
) => {
  for (const rule of rules) if (ruleMatches(text, rule)) addTerm(destination, rule.term, 'narrative');
};

const extractLightCount = (destination: Map<string, Set<CaseGraphFeatureOrigin>>, text: string) => {
  const pattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,2})\s+(?:(?:bright|dim|amber|orange|red|green|blue|white|yellow)\s+){0,2}lights?\b/g;
  for (const match of text.matchAll(pattern)) {
    const count = NUMBER_WORDS[match[1]] ?? Number(match[1]);
    if (Number.isInteger(count) && count >= 1 && count <= 50) addTerm(destination, `light count ${count}`, 'narrative');
  }
};

const extractDirections = (destination: Map<string, Set<CaseGraphFeatureOrigin>>, text: string) => {
  const directions = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];
  for (const direction of directions) {
    const compact = direction.replace(' ', '[- ]?');
    const pattern = new RegExp(`\\b(?:moving|travel(?:led|ing)?|headed|flew|flying|zig[ -]?zagged) (?:toward(?:s)? |due )?${compact}(?:ward|bound)?\\b`, 'g');
    if (pattern.test(text)) addTerm(destination, `movement ${direction}`, 'narrative');
  }
};

const parseEntityValues = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') output.push(item);
    else if (item && typeof item === 'object') {
      const candidate = (item as Record<string, unknown>).name
        ?? (item as Record<string, unknown>).text
        ?? (item as Record<string, unknown>).value
        ?? (item as Record<string, unknown>).entity;
      if (typeof candidate === 'string') output.push(candidate);
    }
  }
  return output;
};

const parseKeywordValues = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

const toTerms = (value: Map<string, Set<CaseGraphFeatureOrigin>>): CaseGraphExtractedTerm[] => (
  [...value.entries()]
    .map(([term, origins]) => ({
      term,
      origins: [...origins].sort((a, b) => ORIGIN_ORDER.indexOf(a) - ORIGIN_ORDER.indexOf(b)),
    }))
    .sort((a, b) => a.term.localeCompare(b.term))
);

const buildLocationKey = (input: CaseGraphRawSighting) => {
  const parts = [input.city, input.region, input.country_code || input.country]
    .map((value) => normalizeTerm(value, 120))
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join('|') : (normalizeTerm(input.location, 255) || null);
};

const digestNarrative = (parts: string[]) => createHash('sha256')
  .update(parts.join('\n'), 'utf8')
  .digest('hex');

const completeness = (record: Omit<CaseGraphFeatureRecord, 'completeness'>) => {
  const missing: string[] = [];
  let score = 0;
  if (record.narrative.characterCount > 0) score += 0.25;
  else missing.push('narrative');
  if (record.event.timestamp) score += 0.15;
  else missing.push('event_timestamp');
  if (record.event.datePrecision !== 'unknown') score += 0.1;
  else missing.push('event_date_precision');
  if (record.event.lat != null && record.event.lon != null) score += 0.15;
  else missing.push('coordinates');
  if (record.event.geoPrecision !== 'unknown') score += 0.1;
  else missing.push('geo_precision');
  if (record.traits.visual.length) score += 0.1;
  else missing.push('visual_traits');
  if (record.durationSeconds != null) score += 0.05;
  else missing.push('duration');
  if (record.traits.entities.length) score += 0.1;
  else missing.push('entities');
  return { score: Number(score.toFixed(2)), missing: missing.sort() };
};

export const extractCaseGraphFeatures = (
  input: CaseGraphRawSighting,
  options: { corpusVersion: string; eligibility: CaseGraphEligibility },
): CaseGraphExtractionResult => {
  const corpusVersion = normalizeText(options.corpusVersion, 120);
  if (!corpusVersion) throw new Error('case_graph_corpus_version_required');
  const caseId = normalizeText(input.id, 120) || null;
  if (!options.eligibility.eligible) {
    return {
      status: 'excluded',
      schemaVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
      corpusVersion,
      caseId,
      reason: normalizeTerm(options.eligibility.reason, 160) || 'unspecified_exclusion',
    };
  }
  if (!caseId) {
    return {
      status: 'excluded',
      schemaVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
      corpusVersion,
      caseId: null,
      reason: 'invalid_case_id',
    };
  }

  const description = normalizeText(input.description_clean || input.description);
  const summary = normalizeText(input.summary, 4_000);
  const aiSummary = normalizeText(input.ai_summary, 4_000);
  const narrativeText = [description, summary, aiSummary].filter(Boolean).join(' ').toLowerCase();
  const visual = new Map<string, Set<CaseGraphFeatureOrigin>>();
  const behaviour = new Map<string, Set<CaseGraphFeatureOrigin>>();
  const sensory = new Map<string, Set<CaseGraphFeatureOrigin>>();
  const entities = new Map<string, Set<CaseGraphFeatureOrigin>>();
  const keywords = new Map<string, Set<CaseGraphFeatureOrigin>>();

  const structuredShape = normalizeTerm(input.shape_normalized || input.shape, 80);
  if (structuredShape && structuredShape !== 'unknown') addTerm(visual, structuredShape, 'structured');
  applyRules(visual, narrativeText, VISUAL_RULES);
  applyRules(behaviour, narrativeText, BEHAVIOUR_RULES);
  applyRules(sensory, narrativeText, SENSORY_RULES);
  extractLightCount(visual, narrativeText);
  extractDirections(behaviour, narrativeText);

  for (const keyword of parseKeywordValues(input.ai_keywords)) addTerm(keywords, keyword, 'ai_keyword');
  for (const entity of parseEntityValues(input.ai_entities)) addTerm(entities, entity, 'ai_entity');

  const lat = parseFinite(input.lat);
  const lon = parseFinite(input.lon);
  const validGeoPair = lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  const duration = parseFinite(input.duration_seconds);
  const datePrecision = parseDatePrecision(input.event_date_precision);
  const geoPrecision = parseGeoPrecision(input.geo_precision);
  const narrativeParts = [description, summary, aiSummary];
  const joinedNarrative = narrativeParts.filter(Boolean).join(' ');
  const recordWithoutCompleteness: Omit<CaseGraphFeatureRecord, 'completeness'> = {
    status: 'included',
    schemaVersion: CASE_GRAPH_FEATURE_SCHEMA_VERSION,
    corpusVersion,
    caseId,
    source: normalizeSource(input.source),
    sourceRecordId: optionalText(input.source_record_id || input.external_id, 240),
    sourceUrl: optionalText(input.source_url, 2_000),
    ingestionJobId: optionalText(input.ingestion_job_id, 160),
    event: {
      timestamp: parseTimestamp(input.event_timestamp),
      datePrecision,
      lat: validGeoPair ? lat : null,
      lon: validGeoPair ? lon : null,
      geoPrecision,
      spatialPrecisionKm: spatialPrecisionKm(geoPrecision),
      locationKey: buildLocationKey(input),
    },
    durationSeconds: duration != null && duration >= 0 ? Math.round(duration) : null,
    traits: {
      visual: toTerms(visual),
      behaviour: toTerms(behaviour),
      sensory: toTerms(sensory),
      entities: toTerms(entities),
      keywords: toTerms(keywords),
    },
    narrative: {
      digest: digestNarrative(narrativeParts),
      characterCount: joinedNarrative.length,
      hasCleanDescription: Boolean(normalizeText(input.description_clean)),
      hasAiSummary: Boolean(aiSummary),
    },
    sourceUpdatedAt: parseUpdatedAt(input.updated_at),
  };
  return {
    ...recordWithoutCompleteness,
    completeness: completeness(recordWithoutCompleteness),
  };
};
