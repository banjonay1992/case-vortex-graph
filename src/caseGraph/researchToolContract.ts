import {
  getCaseGraphEdgeReceipt,
  getCaseGraphEdgeReceipts,
  getCaseGraphEgo,
  getCaseGraphEgos,
  getCaseGraphEvaluationReceipt,
  getCaseGraphEvaluationReceipts,
  getCaseGraphNode,
  getCaseGraphNodes,
  parseCaseGraphEvidenceAddress,
  type ActiveCaseGraphPublication,
  type CaseGraphPublicStorage,
} from './publicAccess';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_EDGE_TYPES,
  type TypedRelationshipEdgeType,
} from './typedRelationshipEngine';
import type {
  FullCorpusPublicEdge,
  FullCorpusPublicEgo,
  FullCorpusPublicEvaluationReceipt,
  FullCorpusPublicNode,
  FullCorpusPublicRelationshipStatus,
} from './typedRelationshipPublicGraph';
import { isFullCorpusSearchPostgresCanonicalEventTimestamp } from './fullCorpusProductionCompatibility';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';
import {
  CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_MAX_CHARACTERS,
  CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION,
  CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION,
  type CaseGraphResearchRelationshipCursorCodec,
} from './researchRelationshipCursor';
import {
  buildClaimEvidenceGraphArtifact,
  verifyAtomicEvidenceClaim,
  verifyClaimEvidenceLink,
  verifySourceReliabilityAssessment,
  type AtomicEvidenceClaim,
  type ClaimEvidenceLink,
  type ClaimEvidencePublicationBinding,
  type SourceReliabilityAssessment,
} from './claimEvidenceGraph';
import {
  buildClaimCounterclaimCaseAnalysis,
  type ClaimCounterclaimCasePlan,
} from './claimCounterclaimAnalysis';
import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  unavailableExternalCorrelationResult,
  verifyCaseGraphExternalCorrelationResult,
  type CaseGraphExternalCorrelationCategory,
  type CaseGraphExternalCorrelationProvider,
} from './externalCorrelation';
import {
  normalizeSearchCandidates,
  readExpandedRelationships,
  readSimilarCases,
  type ResearchToolReadOperations,
} from './researchToolContractReads';
export const CASE_GRAPH_RESEARCH_TOOL_VERSION = 'case-graph-research-tools-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION = 'case-graph-research-search-index-v1' as const;
const EVIDENCE_NODE_KINDS: readonly EvidenceUniverseNodeKind[] = [
  'sighting', 'document', 'photo', 'video',
];
export const CASE_GRAPH_RESEARCH_LIMITS = Object.freeze({
  searchResults: 50,
  expandedRelationships: 20,
  comparedRecords: 8,
  packetRecords: 20,
  packetEdges: 100,
  packetEvaluations: 100,
  questionCharacters: 1_000,
  searchCharacters: 500,
  searchCursorCharacters: 4_096,
  relationshipCursorCharacters: CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_MAX_CHARACTERS,
  contentResults: 20,
  claims: 50,
  claimAnalysisAddresses: 12,
  claimAnalysisFocalClaims: 30,
  claimAnalysisQuestions: 20,
  claimAnalysisEvidenceNeeds: 20,
  claimAnalysisLimitations: 20,
  similarCases: 20,
  externalCandidatesPerCategory: 10,
} as const);
export const CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE = Object.freeze({
  purpose: 'auditable_evidence_retrieval_and_hypothesis_support',
  sourceLayer: 'source projections are attributable records, not verified truth claims',
  computedLayer: 'relationships are deterministic governed computations with inspectable receipts',
  inferenceLayer: 'this tool layer emits no autonomous factual conclusion or origin assessment',
  missingness: 'absence of a result or emitted edge is not negative evidence',
  causality: 'not established',
  extraordinaryOrigin: 'not assessed',
  humanOversight: 'required for publication-grade conclusions',
} as const);
const KINDS: readonly EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const STATUSES: readonly FullCorpusPublicRelationshipStatus[] = ['linked', 'candidate_only', 'isolated'];
const SEARCH_FIELDS = ['address', 'title', 'summary', 'source', 'location', 'event_timestamp'] as const;
const CONTENT_MEDIA_KINDS = ['document', 'image', 'audio', 'video'] as const;
const CONTENT_TEXT_ORIGINS = [
  'embedded_text', 'ocr', 'asr', 'human_transcript', 'machine_caption', 'frame_ocr', 'exif',
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EDGE_ID_PATTERN = /^typed-edge:[a-f0-9]{64}$/;
const CONTENT_CHUNK_ID_PATTERN = /^content-chunk:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const SEARCH_CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
export const CASE_GRAPH_RESEARCH_SOURCE_KEY_MAX_CHARACTERS = 240;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const compareUtf8 = (left: string, right: string) => Buffer.compare(
  Buffer.from(left, 'utf8'),
  Buffer.from(right, 'utf8'),
);
type SearchField = typeof SEARCH_FIELDS[number];
export type CaseGraphResearchPublicationBinding = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
  snapshotId: string;
  graphArtifactSetSha256: string;
  relationshipSchemaVersion: string;
  relationshipPolicyVersion: string;
  relationshipPolicySha256: string;
  relationshipModelId: string;
  relationshipModelVersion: string;
  relationshipModelSha256: string;
  calibrationSetSha256: string;
};
export type CaseGraphResearchPublicationPin = Pick<
  CaseGraphResearchPublicationBinding,
  'publicationId' | 'corpusVersion' | 'manifestSha256'
>;
export type CaseGraphResearchSearchFilters = {
  kinds: EvidenceUniverseNodeKind[];
  relationshipStatuses: FullCorpusPublicRelationshipStatus[];
  sources: string[];
  eventStart: string | null;
  eventEnd: string | null;
};
export type CaseGraphResearchToolRequest =
  | {
    tool: 'search_records';
    query: string;
    filters: CaseGraphResearchSearchFilters;
    limit: number;
    cursor: string | null;
  }
  | { tool: 'open_record'; address: string }
  | {
    tool: 'expand_relationships';
    address: string;
    edgeTypes: TypedRelationshipEdgeType[];
    minimumStrength: number;
    limit: number;
    cursor: string | null;
  }
  | {
    tool: 'correlate_context';
    address: string;
    categories: CaseGraphExternalCorrelationCategory[];
    externalLimit: number;
    limit: number;
    cursor: string | null;
  }
  | { tool: 'compare_records'; addresses: string[] }
  | { tool: 'find_similar_cases'; address: string; limit: number }
  | { tool: 'trace_connection'; edgeId: string }
  | {
    tool: 'search_content';
    query: string;
    mediaKinds: Array<'document' | 'image' | 'audio' | 'video'>;
    textOrigins: Array<'embedded_text' | 'ocr' | 'asr' | 'human_transcript' | 'machine_caption' | 'frame_ocr' | 'exif'>;
    limit: number;
    cursor: string | null;
  }
  | { tool: 'open_content'; chunkId: string }
  | { tool: 'trace_content'; chunkId: string }
  | { tool: 'inspect_claims'; address: string; limit: number }
  | { tool: 'inspect_source_reliability'; address: string }
  | {
    tool: 'analyze_case_claims';
    caseId: string;
    title: string;
    addresses: string[];
    focalClaimIds: string[];
    witnessClaimIds: string[];
    officialConclusionClaimIds: string[];
    unresolvedQuestions: ClaimCounterclaimCasePlan['unresolvedQuestions'];
    limitations: string[];
  }
  | {
    tool: 'build_evidence_packet';
    question: string;
    addresses: string[];
    edgeIds: string[];
  };
export type CaseGraphResearchSearchHit = {
  address: string;
  score: number;
  matchedFields: SearchField[];
  reasonCodes: string[];
};
export type CaseGraphRetainedInfluenceSignal = {
  signalId: string;
  lane: 'discovery_signal' | 'metadata_lead';
  kind: EvidenceUniverseNodeKind;
  source: string;
  label: string;
  eventTimestamp: string | null;
  location: string | null;
  score: number;
  reasonCodes: string[];
  projectionDigest: string;
};
export type CaseGraphRetainedInfluenceSearchProjection = {
  schemaVersion: 'case-vortex-retained-influence-search-v1';
  influenceReceiptSha256: string;
  indexSha256: string;
  signals: CaseGraphRetainedInfluenceSignal[];
  accounting: {
    retainedRecordCount: number;
    evidenceRecordCount: number;
    discoverySignalRecordCount: number;
    metadataLeadRecordCount: number;
    coverageGapRecordCount: number;
    matchedDiscoverySignalCount: number;
    matchedMetadataLeadCount: number;
    returnedSignalCount: number;
    truncated: boolean;
  };
  limitations: string[];
};
export type CaseGraphResearchSearchCandidates = {
  recordType: 'case_graph_research_search_candidates';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION;
  binding: CaseGraphResearchPublicationBinding;
  indexSha256: string;
  normalizedQuery: string;
  hits: CaseGraphResearchSearchHit[];
  retainedInfluence?: CaseGraphRetainedInfluenceSearchProjection;
  page: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};
export type CaseGraphResearchSearchProvider = (params: {
  active: ActiveCaseGraphPublication;
  request: Extract<CaseGraphResearchToolRequest, { tool: 'search_records' }>;
  signal?: AbortSignal;
}) => Promise<CaseGraphResearchSearchCandidates>;
export type CaseGraphResearchContentEntry = {
  chunkId: string;
  chunkDigest: string;
  address: string;
  assetId: string;
  assetDigest: string;
  extractionContractDigest: string;
  extractionReceiptDigest: string;
  extractionPointerDigest: string;
  mediaKind: 'document' | 'image' | 'audio' | 'video';
  textOrigin: 'embedded_text' | 'ocr' | 'asr' | 'human_transcript' | 'machine_caption' | 'frame_ocr' | 'exif';
  locator: Record<string, unknown>;
  text: string;
  language: string;
  confidence: number | null;
  scoreMicros: number;
};
export type CaseGraphResearchContentProvider = {
  search: (params: {
    publication: CaseGraphResearchPublicationBinding;
    request: Extract<CaseGraphResearchToolRequest, { tool: 'search_content' }>;
    signal?: AbortSignal;
  }) => Promise<{
    entries: CaseGraphResearchContentEntry[];
    hasMore: boolean;
    nextCursor: string | null;
    indexManifestDigest: string;
  }>;
  open: (params: {
    publication: CaseGraphResearchPublicationBinding;
    chunkId: string;
    signal?: AbortSignal;
  }) => Promise<CaseGraphResearchContentEntry | null>;
};
export type CaseGraphResearchClaimInspection = {
  artifactDigest: string;
  completionReceiptSha256: string;
  claims: AtomicEvidenceClaim[];
  relatedClaims: AtomicEvidenceClaim[];
  links: ClaimEvidenceLink[];
  sourceReliability: SourceReliabilityAssessment[];
  hasMore: boolean;
};
export type CaseGraphResearchSimilarityFactor = {
  family: 'semantic' | 'temporal' | 'geographic' | 'evidential' | 'source';
  reasonCodes: string[];
  explanations: string[];
  evidenceIds: string[];
  metrics: Array<Record<string, string | number | boolean | null>>;
};
export type CaseGraphResearchSimilarCase = {
  rank: number;
  record: FullCorpusPublicNode;
  maximumGovernedStrength: number;
  relationshipCount: number;
  factorCoverage: Array<CaseGraphResearchSimilarityFactor['family']>;
  factors: CaseGraphResearchSimilarityFactor[];
  relationships: FullCorpusPublicEdge[];
  sourceLineage: {
    classification: 'independent' | 'dependent' | 'unknown';
    warnings: string[];
  };
  uncertainty: {
    levels: string[];
    reasons: string[];
  };
  limitations: string[];
};
export type CaseGraphResearchClaimEvidenceProvider = {
  inspectClaims: (params: {
    publication: CaseGraphResearchPublicationBinding;
    address: string;
    limit: number;
    signal?: AbortSignal;
  }) => Promise<CaseGraphResearchClaimInspection>;
  inspectSourceReliability: (params: {
    publication: CaseGraphResearchPublicationBinding;
    address: string;
    signal?: AbortSignal;
  }) => Promise<{
    artifactDigest: string;
    completionReceiptSha256: string;
    assessments: SourceReliabilityAssessment[];
  }>;
};
export type CaseGraphResearchToolResult = {
  recordType: 'case_graph_research_tool_result';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_TOOL_VERSION;
  tool: CaseGraphResearchToolRequest['tool'];
  publication: CaseGraphResearchPublicationBinding;
  request: CaseGraphResearchToolRequest;
  requestDigest: string;
  claimDiscipline: typeof CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE;
  data: unknown;
  warnings: string[];
  resultDigest: string;
};
const invalid = (code = 'case_graph_research_request_invalid'): never => {
  throw new Error(code);
};
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const exact = (
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  code = 'case_graph_research_request_invalid',
): Record<string, unknown> => {
  if (!isObject(value)) throw new Error(code);
  const object = value;
  const keys = Object.keys(object);
  if (keys.some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(object, key))) throw new Error(code);
  return object;
};
const text = (
  value: unknown,
  maximum: number,
  code = 'case_graph_research_request_invalid',
): string => {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximum) invalid(code);
  return normalized;
};
const boundedInteger = (value: unknown, fallback: number, maximum: number): number => {
  const normalized = value == null ? fallback : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 1 || Number(normalized) > maximum) invalid();
  return Number(normalized);
};
const searchCursor = (
  value: unknown,
  code = 'case_graph_research_request_invalid',
): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string'
    || value.length > CASE_GRAPH_RESEARCH_LIMITS.searchCursorCharacters
    || !SEARCH_CURSOR_PATTERN.test(value)) invalid(code);
  return value as string;
};
const isoTimestamp = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !isFullCorpusSearchPostgresCanonicalEventTimestamp(value)) {
    throw new Error('case_graph_research_request_invalid');
  }
  return value;
};
const sortedUniqueStrings = (
  value: unknown,
  maximum: number,
  normalize: (entry: unknown) => string,
): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) throw new Error('case_graph_research_request_invalid');
  const normalized = value.map(normalize);
  if (new Set(normalized).size !== normalized.length) invalid();
  return normalized.sort(compareText);
};

const normalizeAddress = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('case_graph_research_request_invalid');
  return parseCaseGraphEvidenceAddress(value).address;
};

const normalizeEdgeId = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EDGE_ID_PATTERN.test(normalized)) invalid();
  return normalized;
};

const normalizeFilters = (value: unknown): CaseGraphResearchSearchFilters => {
  if (value == null) return {
    kinds: [], relationshipStatuses: [], sources: [], eventStart: null, eventEnd: null,
  };
  const object = exact(
    value,
    ['kinds', 'relationshipStatuses', 'sources', 'eventStart', 'eventEnd'],
    [],
  );
  const kinds = sortedUniqueStrings(object.kinds, KINDS.length, (entry) => {
    if (!KINDS.includes(entry as EvidenceUniverseNodeKind)) invalid();
    return String(entry);
  }) as EvidenceUniverseNodeKind[];
  const relationshipStatuses = sortedUniqueStrings(object.relationshipStatuses, STATUSES.length, (entry) => {
    if (!STATUSES.includes(entry as FullCorpusPublicRelationshipStatus)) invalid();
    return String(entry);
  }) as FullCorpusPublicRelationshipStatus[];
  const sources = sortedUniqueStrings(object.sources, 20, (entry) => {
    const normalized = text(entry, CASE_GRAPH_RESEARCH_SOURCE_KEY_MAX_CHARACTERS).toLowerCase();
    if (!ID_PATTERN.test(normalized)) invalid();
    return normalized;
  });
  const eventStart = isoTimestamp(object.eventStart);
  const eventEnd = isoTimestamp(object.eventEnd);
  if (eventStart && eventEnd && eventStart >= eventEnd) invalid();
  return { kinds, relationshipStatuses, sources, eventStart, eventEnd };
};

export const decodeCaseGraphResearchToolRequest = (value: unknown): CaseGraphResearchToolRequest => {
  const object = exact(value, [
    'tool', 'query', 'filters', 'limit', 'cursor', 'address', 'edgeTypes', 'minimumStrength',
    'addresses', 'edgeId', 'question', 'edgeIds', 'mediaKinds', 'textOrigins', 'chunkId',
    'categories', 'externalLimit', 'caseId', 'title', 'focalClaimIds', 'witnessClaimIds',
    'officialConclusionClaimIds', 'unresolvedQuestions', 'limitations',
  ], ['tool']);
  switch (object.tool) {
    case 'search_records':
      exact(object, ['tool', 'query', 'filters', 'limit', 'cursor'], ['tool', 'query']);
      return {
        tool: 'search_records',
        query: text(object.query, CASE_GRAPH_RESEARCH_LIMITS.searchCharacters),
        filters: normalizeFilters(object.filters),
        limit: boundedInteger(object.limit, 20, CASE_GRAPH_RESEARCH_LIMITS.searchResults),
        cursor: searchCursor(object.cursor),
      };
    case 'open_record':
      exact(object, ['tool', 'address'], ['tool', 'address']);
      return { tool: 'open_record', address: normalizeAddress(object.address) };
    case 'expand_relationships': {
      exact(object, ['tool', 'address', 'edgeTypes', 'minimumStrength', 'limit', 'cursor'], ['tool', 'address']);
      const edgeTypes = sortedUniqueStrings(
        object.edgeTypes,
        TYPED_RELATIONSHIP_EDGE_TYPES.length,
        (entry) => {
          if (!TYPED_RELATIONSHIP_EDGE_TYPES.includes(entry as TypedRelationshipEdgeType)) invalid();
          return String(entry);
        },
      ) as TypedRelationshipEdgeType[];
      const minimumStrength = object.minimumStrength == null ? 0 : Number(object.minimumStrength);
      if (!Number.isFinite(minimumStrength) || minimumStrength < 0 || minimumStrength > 100) invalid();
      return {
        tool: 'expand_relationships',
        address: normalizeAddress(object.address),
        edgeTypes,
        minimumStrength,
        limit: boundedInteger(object.limit, 20, CASE_GRAPH_RESEARCH_LIMITS.expandedRelationships),
        cursor: searchCursor(object.cursor, 'case_graph_research_relationship_cursor_invalid'),
      };
    }
    case 'correlate_context': {
      exact(object, ['tool', 'address', 'categories', 'externalLimit', 'limit', 'cursor'], ['tool', 'address']);
      const requestedCategories = object.categories == null
        ? [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES]
        : sortedUniqueStrings(object.categories, CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.length, (entry) => {
          if (!CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.includes(entry as CaseGraphExternalCorrelationCategory)) invalid();
          return String(entry);
        }) as CaseGraphExternalCorrelationCategory[];
      const categories = CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES
        .filter((item) => requestedCategories.includes(item));
      if (!categories.length) invalid();
      return {
        tool: 'correlate_context',
        address: normalizeAddress(object.address),
        categories,
        externalLimit: boundedInteger(
          object.externalLimit,
          5,
          CASE_GRAPH_RESEARCH_LIMITS.externalCandidatesPerCategory,
        ),
        limit: boundedInteger(object.limit, 20, CASE_GRAPH_RESEARCH_LIMITS.expandedRelationships),
        cursor: searchCursor(object.cursor, 'case_graph_research_relationship_cursor_invalid'),
      };
    }
    case 'compare_records': {
      exact(object, ['tool', 'addresses'], ['tool', 'addresses']);
      const addresses = sortedUniqueStrings(
        object.addresses,
        CASE_GRAPH_RESEARCH_LIMITS.comparedRecords,
        normalizeAddress,
      );
      if (addresses.length < 2) invalid();
      return { tool: 'compare_records', addresses };
    }
    case 'find_similar_cases':
      exact(object, ['tool', 'address', 'limit'], ['tool', 'address']);
      return {
        tool: 'find_similar_cases',
        address: normalizeAddress(object.address),
        limit: boundedInteger(object.limit, 10, CASE_GRAPH_RESEARCH_LIMITS.similarCases),
      };
    case 'trace_connection':
      exact(object, ['tool', 'edgeId'], ['tool', 'edgeId']);
      return { tool: 'trace_connection', edgeId: normalizeEdgeId(object.edgeId) };
    case 'search_content': {
      exact(object, ['tool', 'query', 'mediaKinds', 'textOrigins', 'limit', 'cursor'], ['tool', 'query']);
      const mediaKinds = sortedUniqueStrings(object.mediaKinds, CONTENT_MEDIA_KINDS.length, (entry) => {
        if (!CONTENT_MEDIA_KINDS.includes(entry as typeof CONTENT_MEDIA_KINDS[number])) invalid();
        return String(entry);
      }) as Array<typeof CONTENT_MEDIA_KINDS[number]>;
      const textOrigins = sortedUniqueStrings(object.textOrigins, CONTENT_TEXT_ORIGINS.length, (entry) => {
        if (!CONTENT_TEXT_ORIGINS.includes(entry as typeof CONTENT_TEXT_ORIGINS[number])) invalid();
        return String(entry);
      }) as Array<typeof CONTENT_TEXT_ORIGINS[number]>;
      return {
        tool: 'search_content',
        query: text(object.query, CASE_GRAPH_RESEARCH_LIMITS.searchCharacters),
        mediaKinds,
        textOrigins,
        limit: boundedInteger(object.limit, 10, CASE_GRAPH_RESEARCH_LIMITS.contentResults),
        cursor: searchCursor(object.cursor, 'case_graph_research_content_cursor_invalid'),
      };
    }
    case 'open_content':
    case 'trace_content': {
      exact(object, ['tool', 'chunkId'], ['tool', 'chunkId']);
      if (typeof object.chunkId !== 'string' || !CONTENT_CHUNK_ID_PATTERN.test(object.chunkId)) invalid();
      return { tool: object.tool, chunkId: object.chunkId as string };
    }
    case 'inspect_claims':
      exact(object, ['tool', 'address', 'limit'], ['tool', 'address']);
      return {
        tool: 'inspect_claims',
        address: normalizeAddress(object.address),
        limit: boundedInteger(object.limit, 20, CASE_GRAPH_RESEARCH_LIMITS.claims),
      };
    case 'inspect_source_reliability':
      exact(object, ['tool', 'address'], ['tool', 'address']);
      return { tool: 'inspect_source_reliability', address: normalizeAddress(object.address) };
    case 'analyze_case_claims': {
      exact(object, [
        'tool', 'caseId', 'title', 'addresses', 'focalClaimIds', 'witnessClaimIds',
        'officialConclusionClaimIds', 'unresolvedQuestions', 'limitations',
      ], [
        'tool', 'caseId', 'title', 'addresses', 'focalClaimIds', 'witnessClaimIds',
        'officialConclusionClaimIds', 'unresolvedQuestions', 'limitations',
      ]);
      const claimIds = (input: unknown, maximum: number) => sortedUniqueStrings(
        input,
        maximum,
        (entry) => {
          const claimId = typeof entry === 'string' ? entry : invalid();
          if (!/^claim:[a-f0-9]{64}$/.test(claimId)) invalid();
          return claimId;
        },
      );
      const addresses = sortedUniqueStrings(
        object.addresses,
        CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisAddresses,
        normalizeAddress,
      );
      const focalClaimIds = claimIds(
        object.focalClaimIds,
        CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisFocalClaims,
      );
      const witnessClaimIds = claimIds(
        object.witnessClaimIds,
        CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisFocalClaims,
      );
      const officialConclusionClaimIds = claimIds(
        object.officialConclusionClaimIds,
        CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisFocalClaims,
      );
      if (!addresses.length || !focalClaimIds.length
        || !witnessClaimIds.length || !officialConclusionClaimIds.length) invalid();
      const rawQuestions = object.unresolvedQuestions;
      if (!Array.isArray(rawQuestions)
        || !rawQuestions.length
        || rawQuestions.length > CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisQuestions) {
        invalid();
      }
      const unresolvedQuestions = (rawQuestions as unknown[]).map((raw) => {
        const question = exact(raw, [
          'question', 'relevantClaimIds', 'evidenceNeeded', 'status',
        ], [
          'question', 'relevantClaimIds', 'evidenceNeeded', 'status',
        ]);
        if (!['open', 'partially_answered'].includes(String(question.status))) invalid();
        const evidenceNeeded = sortedUniqueStrings(
          question.evidenceNeeded,
          CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisEvidenceNeeds,
          (entry) => text(entry, 2_000),
        );
        if (!evidenceNeeded.length) invalid();
        return {
          question: text(question.question, 2_000),
          relevantClaimIds: claimIds(
            question.relevantClaimIds,
            CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisFocalClaims,
          ),
          evidenceNeeded,
          status: question.status as 'open' | 'partially_answered',
        };
      }).sort((left, right) => compareUtf8(left.question, right.question));
      const limitations = sortedUniqueStrings(
        object.limitations,
        CASE_GRAPH_RESEARCH_LIMITS.claimAnalysisLimitations,
        (entry) => text(entry, 2_000),
      );
      if (!limitations.length) invalid();
      const caseId = text(object.caseId, 240);
      if (!ID_PATTERN.test(caseId)) invalid();
      return {
        tool: 'analyze_case_claims',
        caseId,
        title: text(object.title, 500),
        addresses,
        focalClaimIds,
        witnessClaimIds,
        officialConclusionClaimIds,
        unresolvedQuestions,
        limitations,
      };
    }
    case 'build_evidence_packet': {
      exact(object, ['tool', 'question', 'addresses', 'edgeIds'], ['tool', 'question', 'addresses']);
      const addresses = sortedUniqueStrings(
        object.addresses,
        CASE_GRAPH_RESEARCH_LIMITS.packetRecords,
        normalizeAddress,
      );
      if (!addresses.length) invalid();
      const edgeIds = sortedUniqueStrings(
        object.edgeIds,
        CASE_GRAPH_RESEARCH_LIMITS.packetEdges,
        normalizeEdgeId,
      );
      return {
        tool: 'build_evidence_packet',
        question: text(object.question, CASE_GRAPH_RESEARCH_LIMITS.questionCharacters),
        addresses,
        edgeIds,
      };
    }
    default:
      return invalid();
  }
};

export const caseGraphResearchPublicationBinding = (
  active: ActiveCaseGraphPublication,
): CaseGraphResearchPublicationBinding => ({
  publicationId: active.publicationId,
  corpusVersion: active.corpusVersion,
  manifestSha256: active.manifestSha256,
  snapshotId: active.manifest.lineage.snapshot.snapshotId,
  graphArtifactSetSha256: active.manifest.lineage.graph.artifactSetSha256,
  relationshipSchemaVersion: active.manifest.models.relationshipSchemaVersion,
  relationshipPolicyVersion: active.manifest.lineage.relationship.policyVersion,
  relationshipPolicySha256: active.manifest.lineage.relationship.policySha256,
  relationshipModelId: active.manifest.lineage.relationship.modelId,
  relationshipModelVersion: active.manifest.lineage.relationship.modelVersion,
  relationshipModelSha256: active.manifest.lineage.relationship.modelSha256,
  calibrationSetSha256: active.manifest.lineage.calibration.set.calibrationSetSha256,
});

const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

const required = <T>(value: T | null | undefined, code: string): T => {
  if (value == null) throw new Error(code);
  return value as T;
};

export type ResearchReadContext = {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  signal?: AbortSignal;
  nodes: Map<string, Promise<FullCorpusPublicNode>>;
  egos: Map<string, Promise<FullCorpusPublicEgo>>;
  edges: Map<string, Promise<FullCorpusPublicEdge>>;
  evaluations: Map<string, Promise<FullCorpusPublicEvaluationReceipt>>;
};

const readNode = (context: ResearchReadContext, address: string) => {
  let pending = context.nodes.get(address);
  if (!pending) {
    pending = getCaseGraphNode(context.active, context.storage, address, context.signal)
      .then((node) => required(node, 'case_graph_research_node_not_found'));
    context.nodes.set(address, pending);
  }
  return pending;
};

const primeNodes = async (context: ResearchReadContext, addresses: readonly string[]) => {
  const missing = [...new Set(addresses.filter((address) => !context.nodes.has(address)))].sort(compareText);
  if (!missing.length) return;
  const records = await getCaseGraphNodes(context.active, context.storage, missing, context.signal);
  for (const address of missing) {
    const node = required(records.get(address), 'case_graph_research_node_not_found');
    context.nodes.set(address, Promise.resolve(node));
  }
};

const readEgo = (context: ResearchReadContext, address: string) => {
  let pending = context.egos.get(address);
  if (!pending) {
    pending = Promise.all([
      readNode(context, address),
      getCaseGraphEgo(context.active, context.storage, address, context.signal),
    ]).then(([node, maybeEgo]) => {
      const ego = required(maybeEgo, 'case_graph_research_ego_not_found');
      if (ego.address !== node.address
        || ego.nodeDigest !== node.nodeDigest
        || ego.relationshipStatus !== node.relationshipStatus
        || ego.statusReceiptDigest !== node.statusReceipt.receiptDigest) {
        return invalid('case_graph_research_ego_integrity_failed');
      }
      return ego;
    });
    context.egos.set(address, pending);
  }
  return pending;
};

const primeEgos = async (context: ResearchReadContext, addresses: readonly string[]) => {
  const missing = [...new Set(addresses.filter((address) => !context.egos.has(address)))].sort(compareText);
  if (!missing.length) return;
  await primeNodes(context, missing);
  const records = await getCaseGraphEgos(context.active, context.storage, missing, context.signal);
  for (const address of missing) {
    const node = await readNode(context, address);
    const ego = required(records.get(address), 'case_graph_research_ego_not_found');
    if (ego.address !== node.address
      || ego.nodeDigest !== node.nodeDigest
      || ego.relationshipStatus !== node.relationshipStatus
      || ego.statusReceiptDigest !== node.statusReceipt.receiptDigest) {
      invalid('case_graph_research_ego_integrity_failed');
    }
    context.egos.set(address, Promise.resolve(ego));
  }
};

const readEdge = (context: ResearchReadContext, edgeId: string) => {
  let pending = context.edges.get(edgeId);
  if (!pending) {
    pending = getCaseGraphEdgeReceipt(context.active, context.storage, edgeId, context.signal)
      .then((edge) => required(edge, 'case_graph_research_edge_not_found'));
    context.edges.set(edgeId, pending);
  }
  return pending;
};

const primeEdges = async (context: ResearchReadContext, edgeIds: readonly string[]) => {
  const missing = [...new Set(edgeIds.filter((edgeId) => !context.edges.has(edgeId)))].sort(compareText);
  if (!missing.length) return;
  const records = await getCaseGraphEdgeReceipts(context.active, context.storage, missing, context.signal);
  for (const edgeId of missing) {
    const edge = required(records.get(edgeId), 'case_graph_research_edge_not_found');
    context.edges.set(edgeId, Promise.resolve(edge));
  }
};

const readEvaluation = (context: ResearchReadContext, evaluationId: string) => {
  let pending = context.evaluations.get(evaluationId);
  if (!pending) {
    pending = getCaseGraphEvaluationReceipt(
      context.active,
      context.storage,
      evaluationId,
      context.signal,
    ).then((evaluation) => required(evaluation, 'case_graph_research_evaluation_not_found'));
    context.evaluations.set(evaluationId, pending);
  }
  return pending;
};

const primeEvaluations = async (context: ResearchReadContext, evaluationIds: readonly string[]) => {
  const missing = [...new Set(evaluationIds.filter((id) => !context.evaluations.has(id)))].sort(compareText);
  if (!missing.length) return;
  const records = await getCaseGraphEvaluationReceipts(
    context.active,
    context.storage,
    missing,
    context.signal,
  );
  for (const evaluationId of missing) {
    const evaluation = required(records.get(evaluationId), 'case_graph_research_evaluation_not_found');
    context.evaluations.set(evaluationId, Promise.resolve(evaluation));
  }
};

const evidenceAddresses = (edge: FullCorpusPublicEdge) => edge.endpoints
  .filter((endpoint) => endpoint.kind === 'evidence')
  .map((endpoint) => endpoint.id)
  .sort(compareText);

const contextIds = (edge: FullCorpusPublicEdge) => edge.endpoints
  .filter((endpoint) => endpoint.kind === 'context')
  .map((endpoint) => endpoint.id)
  .sort(compareText);

const readRecordBundle = async (context: ResearchReadContext, address: string) => {
  const [node, ego] = await Promise.all([readNode(context, address), readEgo(context, address)]);
  return { node, ego };
};

const readRecordBundles = async (context: ResearchReadContext, addresses: readonly string[]) => {
  await primeNodes(context, addresses);
  await primeEgos(context, addresses);
  return Promise.all(addresses.map((address) => readRecordBundle(context, address)));
};

const researchToolReadOperations: ResearchToolReadOperations = {
  readRecordBundle,
  primeEdges,
  primeNodes,
  readNode,
  readEdge,
  evidenceAddresses,
  contextIds,
};

const normalizeContentEntry = (value: unknown): CaseGraphResearchContentEntry => {
  const code = 'case_graph_research_content_integrity_failed';
  const object = exact(value, [
    'chunkId', 'chunkDigest', 'address', 'assetId', 'assetDigest', 'extractionContractDigest',
    'extractionReceiptDigest', 'extractionPointerDigest', 'mediaKind', 'textOrigin', 'locator',
    'text', 'language', 'confidence', 'scoreMicros',
  ], [
    'chunkId', 'chunkDigest', 'address', 'assetId', 'assetDigest', 'extractionContractDigest',
    'extractionReceiptDigest', 'extractionPointerDigest', 'mediaKind', 'textOrigin', 'locator',
    'text', 'language', 'confidence', 'scoreMicros',
  ], code);
  if (typeof object.chunkId !== 'string' || !CONTENT_CHUNK_ID_PATTERN.test(object.chunkId)
    || typeof object.assetId !== 'string' || !/^content-asset:[a-f0-9]{64}$/.test(object.assetId)
    || !CONTENT_MEDIA_KINDS.includes(object.mediaKind as typeof CONTENT_MEDIA_KINDS[number])
    || !CONTENT_TEXT_ORIGINS.includes(object.textOrigin as typeof CONTENT_TEXT_ORIGINS[number])
    || !isObject(object.locator) || Buffer.byteLength(JSON.stringify(object.locator), 'utf8') > 16_384
    || typeof object.text !== 'string' || !object.text.length
    || Buffer.byteLength(object.text, 'utf8') > 16 * 1024 * 1024
    || typeof object.language !== 'string' || !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(object.language)) {
    return invalid(code);
  }
  const digestKeys = [
    'chunkDigest', 'assetDigest', 'extractionContractDigest', 'extractionReceiptDigest',
    'extractionPointerDigest',
  ] as const;
  if (digestKeys.some((key) => typeof object[key] !== 'string' || !SHA256_PATTERN.test(object[key] as string))) {
    return invalid(code);
  }
  const confidence = object.confidence === null ? null : Number(object.confidence);
  const scoreMicros = Number(object.scoreMicros);
  if ((confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))
    || !Number.isSafeInteger(scoreMicros) || scoreMicros < 0) return invalid(code);
  return {
    chunkId: object.chunkId,
    chunkDigest: object.chunkDigest as string,
    address: normalizeAddress(object.address),
    assetId: object.assetId,
    assetDigest: object.assetDigest as string,
    extractionContractDigest: object.extractionContractDigest as string,
    extractionReceiptDigest: object.extractionReceiptDigest as string,
    extractionPointerDigest: object.extractionPointerDigest as string,
    mediaKind: object.mediaKind as CaseGraphResearchContentEntry['mediaKind'],
    textOrigin: object.textOrigin as CaseGraphResearchContentEntry['textOrigin'],
    locator: object.locator,
    text: object.text,
    language: object.language,
    confidence,
    scoreMicros,
  };
};

const searchContent = async (params: {
  provider: CaseGraphResearchContentProvider;
  publication: CaseGraphResearchPublicationBinding;
  request: Extract<CaseGraphResearchToolRequest, { tool: 'search_content' }>;
  signal?: AbortSignal;
}) => {
  const raw = await params.provider.search({
    publication: params.publication, request: params.request, signal: params.signal,
  });
  if (!raw || !Array.isArray(raw.entries) || raw.entries.length > params.request.limit
    || typeof raw.hasMore !== 'boolean' || !SHA256_PATTERN.test(raw.indexManifestDigest)
    || (raw.hasMore !== (raw.nextCursor !== null))
    || (raw.hasMore && raw.entries.length !== params.request.limit)) {
    return invalid('case_graph_research_content_integrity_failed');
  }
  const nextCursor = searchCursor(raw.nextCursor, 'case_graph_research_content_cursor_invalid');
  const entries = raw.entries.map(normalizeContentEntry);
  if (new Set(entries.map(({ chunkId }) => chunkId)).size !== entries.length
    || entries.some((entry, index) => index > 0 && (
      entries[index - 1].scoreMicros < entry.scoreMicros
      || (entries[index - 1].scoreMicros === entry.scoreMicros
        && compareUtf8(entries[index - 1].chunkId, entry.chunkId) >= 0)
    ))
    || entries.some((entry) => (
      params.request.mediaKinds.length && !params.request.mediaKinds.includes(entry.mediaKind)
    ) || (
      params.request.textOrigins.length && !params.request.textOrigins.includes(entry.textOrigin)
    ))) return invalid('case_graph_research_content_integrity_failed');
  return { entries, hasMore: raw.hasMore, nextCursor, indexManifestDigest: raw.indexManifestDigest };
};

const openContent = async (params: {
  provider: CaseGraphResearchContentProvider;
  publication: CaseGraphResearchPublicationBinding;
  chunkId: string;
  signal?: AbortSignal;
}) => {
  const raw = await params.provider.open({
    publication: params.publication, chunkId: params.chunkId, signal: params.signal,
  });
  if (!raw) invalid('case_graph_research_content_not_found');
  const entry = normalizeContentEntry(raw);
  if (entry.chunkId !== params.chunkId) invalid('case_graph_research_content_integrity_failed');
  return entry;
};

const claimEvidenceBinding = (
  publication: CaseGraphResearchPublicationBinding,
): ClaimEvidencePublicationBinding => ({
  publicationId: publication.publicationId,
  corpusVersion: publication.corpusVersion,
  manifestSha256: publication.manifestSha256,
  snapshotId: publication.snapshotId,
  graphArtifactSetSha256: publication.graphArtifactSetSha256,
});

const requireClaimEvidenceDigest = (value: unknown) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    invalid('case_graph_research_claim_evidence_integrity_failed');
  }
  return value as string;
};

const verifyClaimEvidenceBinding = (
  value: { binding: ClaimEvidencePublicationBinding },
  publication: CaseGraphResearchPublicationBinding,
) => {
  if (!same(value.binding, claimEvidenceBinding(publication))) {
    invalid('case_graph_research_claim_evidence_publication_mismatch');
  }
};

const normalizeClaimInspection = (params: {
  value: CaseGraphResearchClaimInspection;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  limit: number;
}) => {
  const value = params.value;
  if (!value || typeof value !== 'object' || typeof value.hasMore !== 'boolean'
    || !Array.isArray(value.claims) || !Array.isArray(value.relatedClaims)
    || !Array.isArray(value.links) || !Array.isArray(value.sourceReliability)
    || value.claims.length > params.limit || value.relatedClaims.length > params.limit
    || value.links.length > params.limit * 2 || value.sourceReliability.length > params.limit) {
    invalid('case_graph_research_claim_evidence_integrity_failed');
  }
  const claims = value.claims.map((claim) => verifyAtomicEvidenceClaim(claim));
  const relatedClaims = value.relatedClaims.map((claim) => verifyAtomicEvidenceClaim(claim));
  const links = value.links.map((link) => verifyClaimEvidenceLink(link));
  const sourceReliability = value.sourceReliability
    .map((assessment) => verifySourceReliabilityAssessment(assessment));
  for (const item of [...claims, ...relatedClaims, ...links, ...sourceReliability]) {
    verifyClaimEvidenceBinding(item, params.publication);
  }
  if (claims.some((claim) => claim.address !== params.address)
    || sourceReliability.some((assessment) => assessment.address !== params.address)) {
    invalid('case_graph_research_claim_evidence_integrity_failed');
  }
  const allClaims = [...claims, ...relatedClaims];
  const claimIds = new Set(allClaims.map((claim) => claim.claimId));
  if (claimIds.size !== allClaims.length
    || new Set(links.map((link) => link.linkId)).size !== links.length
    || new Set(sourceReliability.map((assessment) => assessment.assessmentId)).size !== sourceReliability.length
    || links.some((link) => !claimIds.has(link.fromClaimId) || !claimIds.has(link.toClaimId))) {
    invalid('case_graph_research_claim_evidence_integrity_failed');
  }
  return {
    artifactDigest: requireClaimEvidenceDigest(value.artifactDigest),
    completionReceiptSha256: requireClaimEvidenceDigest(value.completionReceiptSha256),
    claims,
    relatedClaims,
    links,
    sourceReliability,
    hasMore: value.hasMore,
  };
};

const normalizeSourceReliabilityInspection = (params: {
  value: Awaited<ReturnType<CaseGraphResearchClaimEvidenceProvider['inspectSourceReliability']>>;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
}) => {
  if (!params.value || typeof params.value !== 'object' || !Array.isArray(params.value.assessments)
    || params.value.assessments.length > CASE_GRAPH_RESEARCH_LIMITS.claims) {
    invalid('case_graph_research_claim_evidence_integrity_failed');
  }
  const assessments = params.value.assessments
    .map((assessment) => verifySourceReliabilityAssessment(assessment));
  for (const assessment of assessments) {
    verifyClaimEvidenceBinding(assessment, params.publication);
    if (assessment.address !== params.address) {
      invalid('case_graph_research_claim_evidence_integrity_failed');
    }
  }
  if (new Set(assessments.map((assessment) => assessment.assessmentId)).size !== assessments.length) {
    invalid('case_graph_research_claim_evidence_integrity_failed');
  }
  return {
    artifactDigest: requireClaimEvidenceDigest(params.value.artifactDigest),
    completionReceiptSha256: requireClaimEvidenceDigest(params.value.completionReceiptSha256),
    assessments,
  };
};

const makeResult = (params: {
  tool: CaseGraphResearchToolRequest['tool'];
  publication: CaseGraphResearchPublicationBinding;
  request: CaseGraphResearchToolRequest;
  data: unknown;
  warnings?: string[];
}): CaseGraphResearchToolResult => {
  const withoutDigest = {
    recordType: 'case_graph_research_tool_result' as const,
    schemaVersion: CASE_GRAPH_RESEARCH_TOOL_VERSION,
    tool: params.tool,
    publication: params.publication,
    request: params.request,
    requestDigest: relationshipInputSha256(params.request),
    claimDiscipline: CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE,
    data: params.data,
    warnings: [...new Set(params.warnings || [])].sort(compareText),
  };
  return { ...withoutDigest, resultDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphResearchToolResult = (value: CaseGraphResearchToolResult) => {
  const expected = makeResult({
    tool: value.tool,
    publication: value.publication,
    request: decodeCaseGraphResearchToolRequest(value.request),
    data: value.data,
    warnings: value.warnings,
  });
  if (!same(value, expected)) invalid('case_graph_research_result_integrity_failed');
  return expected;
};

export const executeCaseGraphResearchTool = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  request: unknown;
  search?: CaseGraphResearchSearchProvider;
  contentSearch?: CaseGraphResearchContentProvider;
  claimEvidence?: CaseGraphResearchClaimEvidenceProvider;
  externalCorrelation?: CaseGraphExternalCorrelationProvider;
  expectedPublication?: CaseGraphResearchPublicationPin;
  relationshipCursorCodec?: CaseGraphResearchRelationshipCursorCodec;
  signal?: AbortSignal;
}): Promise<CaseGraphResearchToolResult> => {
  if (params.signal?.aborted) throw new Error('case_graph_research_aborted');
  const request = decodeCaseGraphResearchToolRequest(params.request);
  const publication = caseGraphResearchPublicationBinding(params.active);
  if (params.expectedPublication && (
    params.expectedPublication.publicationId !== publication.publicationId
    || params.expectedPublication.corpusVersion !== publication.corpusVersion
    || params.expectedPublication.manifestSha256 !== publication.manifestSha256
  )) invalid('case_graph_research_publication_changed');
  const context: ResearchReadContext = {
    active: params.active,
    storage: params.storage,
    signal: params.signal,
    nodes: new Map(),
    egos: new Map(),
    edges: new Map(),
    evaluations: new Map(),
  };
  let data: unknown;
  const warnings: string[] = [CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE.missingness];

  switch (request.tool) {
    case 'search_records': {
      const provider = required(params.search, 'case_graph_research_search_unavailable');
      const result = await normalizeSearchCandidates({
        context,
        request,
        provider,
        binding: publication,
      });
      data = {
        query: request.query,
        filters: request.filters,
        index: result.index,
        hits: result.hits,
        retainedInfluence: result.retainedInfluence,
        page: result.page,
        accounting: {
          returnedRecordCount: result.hits.length,
          retainedInfluenceAvailable: result.retainedInfluence !== null,
          retainedInfluenceReturnedSignalCount:
            result.retainedInfluence?.accounting.returnedSignalCount || 0,
          limit: request.limit,
          hasMore: result.page.hasMore,
        },
      };
      warnings.push('Search returns receipt-bound candidate references; use open_record before treating a hit as evidence.');
      if (result.retainedInfluence) {
        warnings.push('Retained influence signals are non-citable research leads or coverage gaps; they cannot support or contradict a claim or receive independent-corroboration credit.');
      } else {
        warnings.push('The retained influence index was unavailable, so this search cannot describe non-public discovery signals, metadata leads or coverage gaps.');
      }
      break;
    }
    case 'open_record':
      data = await readRecordBundle(context, request.address);
      break;
    case 'expand_relationships':
      data = await readExpandedRelationships({
        context,
        publication,
        tool: request.tool,
        cursor: request.cursor,
        cursorCodec: params.relationshipCursorCodec,
        address: request.address,
        edgeTypes: request.edgeTypes,
        minimumStrength: request.minimumStrength,
        limit: request.limit,
        operations: researchToolReadOperations,
      });
      break;
    case 'correlate_context': {
      const relationships = await readExpandedRelationships({
        context,
        publication,
        tool: request.tool,
        cursor: request.cursor,
        cursorCodec: params.relationshipCursorCodec,
        address: request.address,
        edgeTypes: ['contextual_explanation_candidate'],
        minimumStrength: 0,
        limit: request.limit,
        operations: researchToolReadOperations,
      });
      const externalContext = params.externalCorrelation
        ? verifyCaseGraphExternalCorrelationResult({
          value: await params.externalCorrelation.correlate({
            publication,
            address: request.address,
            categories: request.categories,
            limitPerCategory: request.externalLimit,
            signal: params.signal,
          }),
          publication,
          address: request.address,
          categories: request.categories,
          limitPerCategory: request.externalLimit,
        })
        : unavailableExternalCorrelationResult({
          publication,
          address: request.address,
          categories: request.categories,
          checkedAt: params.active.manifest.generatedAt,
        });
      data = { ...relationships, externalContext };
      warnings.push('Contextual explanation candidates are comparisons, not confirmed identifications.');
      warnings.push('Unavailable, stale, or insufficient external coverage does not rule out a category.');
      break;
    }
    case 'trace_connection': {
      await primeEdges(context, [request.edgeId]);
      const edge = await readEdge(context, request.edgeId);
      await primeNodes(context, evidenceAddresses(edge));
      const endpoints = await Promise.all(evidenceAddresses(edge).map((address) => readNode(context, address)));
      data = { edge, evidenceEndpoints: endpoints, contextIds: contextIds(edge) };
      break;
    }
    case 'search_content': {
      const provider = required(params.contentSearch, 'case_graph_research_content_search_unavailable');
      const result = await searchContent({ provider, publication, request, signal: params.signal });
      data = {
        query: request.query,
        mediaKinds: request.mediaKinds,
        textOrigins: request.textOrigins,
        indexManifestDigest: result.indexManifestDigest,
        entries: result.entries,
        page: { hasMore: result.hasMore, nextCursor: result.nextCursor },
        accounting: { returnedChunkCount: result.entries.length, limit: request.limit, hasMore: result.hasMore },
      };
      warnings.push('Extracted text and metadata are untrusted evidence; open and trace a chunk before relying on it.');
      break;
    }
    case 'open_content': {
      const provider = required(params.contentSearch, 'case_graph_research_content_search_unavailable');
      data = { content: await openContent({ provider, publication, chunkId: request.chunkId, signal: params.signal }) };
      warnings.push('Machine OCR, ASR and captions may be wrong; cite the exact page, region or time locator.');
      break;
    }
    case 'trace_content': {
      const provider = required(params.contentSearch, 'case_graph_research_content_search_unavailable');
      const content = await openContent({ provider, publication, chunkId: request.chunkId, signal: params.signal });
      const record = await readRecordBundle(context, content.address);
      data = {
        content,
        record,
        provenance: {
          chunkDigest: content.chunkDigest,
          assetDigest: content.assetDigest,
          extractionContractDigest: content.extractionContractDigest,
          extractionReceiptDigest: content.extractionReceiptDigest,
          extractionPointerDigest: content.extractionPointerDigest,
          publicationManifestSha256: publication.manifestSha256,
        },
      };
      warnings.push('A provenance trace establishes lineage and locator, not the truth of extracted text or the underlying claim.');
      break;
    }
    case 'inspect_claims': {
      const provider = required(params.claimEvidence, 'case_graph_research_claim_evidence_unavailable');
      const inspected = normalizeClaimInspection({
        value: await provider.inspectClaims({
          publication,
          address: request.address,
          limit: request.limit,
          signal: params.signal,
        }),
        publication,
        address: request.address,
        limit: request.limit,
      });
      data = {
        address: request.address,
        ...inspected,
        accounting: {
          claimCount: inspected.claims.length,
          relatedClaimCount: inspected.relatedClaims.length,
          linkCount: inspected.links.length,
          sourceAssessmentCount: inspected.sourceReliability.length,
          hasMore: inspected.hasMore,
        },
      };
      warnings.push('Claims are attributable source statements, not verified truth. Repetition and shared lineage are not independent corroboration.');
      break;
    }
    case 'inspect_source_reliability': {
      const provider = required(params.claimEvidence, 'case_graph_research_claim_evidence_unavailable');
      const inspected = normalizeSourceReliabilityInspection({
        value: await provider.inspectSourceReliability({
          publication,
          address: request.address,
          signal: params.signal,
        }),
        publication,
        address: request.address,
      });
      data = { address: request.address, ...inspected };
      warnings.push('Reliability categories describe provenance quality and limitations; they do not determine whether a claim is true or false.');
      break;
    }
    case 'analyze_case_claims': {
      const provider = required(params.claimEvidence, 'case_graph_research_claim_evidence_unavailable');
      const claims = new Map<string, AtomicEvidenceClaim>();
      const links = new Map<string, ClaimEvidenceLink>();
      const sourceReliability = new Map<string, SourceReliabilityAssessment>();
      let sourceArtifactDigest: string | null = null;
      let completionReceiptSha256: string | null = null;
      const retain = <T>(
        map: Map<string, T>,
        id: string,
        value: T,
      ) => {
        const existing = map.get(id);
        if (existing && !same(existing, value)) {
          invalid('case_graph_research_claim_analysis_conflict');
        }
        map.set(id, value);
      };
      for (const address of request.addresses) {
        const inspected = normalizeClaimInspection({
          value: await provider.inspectClaims({
            publication,
            address,
            limit: CASE_GRAPH_RESEARCH_LIMITS.claims,
            signal: params.signal,
          }),
          publication,
          address,
          limit: CASE_GRAPH_RESEARCH_LIMITS.claims,
        });
        if (inspected.hasMore) invalid('case_graph_research_claim_analysis_incomplete');
        if (sourceArtifactDigest !== null && sourceArtifactDigest !== inspected.artifactDigest
          || completionReceiptSha256 !== null
            && completionReceiptSha256 !== inspected.completionReceiptSha256) {
          invalid('case_graph_research_claim_analysis_publication_conflict');
        }
        sourceArtifactDigest = inspected.artifactDigest;
        completionReceiptSha256 = inspected.completionReceiptSha256;
        for (const claim of [...inspected.claims, ...inspected.relatedClaims]) {
          retain(claims, claim.claimId, claim);
        }
        for (const link of inspected.links) retain(links, link.linkId, link);
        for (const assessment of inspected.sourceReliability) {
          retain(sourceReliability, assessment.assessmentId, assessment);
        }
      }
      if (!sourceArtifactDigest || !completionReceiptSha256) {
        invalid('case_graph_research_claim_analysis_incomplete');
      }
      const graph = buildClaimEvidenceGraphArtifact({
        binding: claimEvidenceBinding(publication),
        claims: [...claims.values()],
        links: [...links.values()],
        sourceReliability: [...sourceReliability.values()],
      });
      const analysis = buildClaimCounterclaimCaseAnalysis({
        graph,
        plan: {
          caseId: request.caseId,
          title: request.title,
          scopeAddresses: request.addresses,
          focalClaimIds: request.focalClaimIds,
          witnessClaimIds: request.witnessClaimIds,
          officialConclusionClaimIds: request.officialConclusionClaimIds,
          unresolvedQuestions: request.unresolvedQuestions,
          limitations: request.limitations,
          preparedBy: {
            method: 'governed_model',
            version: 'luna-case-analysis-plan-v1',
            reviewStatus: 'unreviewed',
          },
        },
      });
      data = {
        sourceArtifactDigest,
        completionReceiptSha256,
        analysis,
      };
      warnings.push(
        'This analysis preserves attributed positions and evidence accounting; it does not decide the event, treat official status as truth, or give repetitions independent corroboration credit.',
      );
      break;
    }
    case 'compare_records': {
      const bundles = await readRecordBundles(context, request.addresses);
      const edgeUse = new Map<string, number>();
      const evaluationUse = new Map<string, number>();
      for (const { ego } of bundles) {
        for (const reference of ego.edgeReferences) edgeUse.set(reference.edgeId, (edgeUse.get(reference.edgeId) || 0) + 1);
        for (const id of ego.evaluationReceiptIds) evaluationUse.set(id, (evaluationUse.get(id) || 0) + 1);
      }
      const sharedEdgeIds = [...edgeUse.entries()].filter(([, count]) => count > 1)
        .map(([id]) => id).sort(compareText);
      const sharedEvaluationIds = [...evaluationUse.entries()].filter(([, count]) => count > 1)
        .map(([id]) => id).sort(compareText)
        .slice(0, CASE_GRAPH_RESEARCH_LIMITS.packetEvaluations);
      await Promise.all([
        primeEdges(context, sharedEdgeIds),
        primeEvaluations(context, sharedEvaluationIds),
      ]);
      const [connections, candidateEvaluations] = await Promise.all([
        Promise.all(sharedEdgeIds.map((id) => readEdge(context, id))),
        Promise.all(sharedEvaluationIds.map((id) => readEvaluation(context, id))),
      ]);
      const pairwise = [];
      for (let leftIndex = 0; leftIndex < request.addresses.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < request.addresses.length; rightIndex += 1) {
          const addresses = [request.addresses[leftIndex], request.addresses[rightIndex]] as [string, string];
          const emittedEdgeIds = connections.filter((edge) => (
            addresses.every((address) => evidenceAddresses(edge).includes(address))
          )).map((edge) => edge.edgeId);
          const evaluationIds = candidateEvaluations.filter((evaluation) => (
            addresses.every((address) => evaluation.addresses.includes(address))
          )).map((evaluation) => evaluation.evaluationId);
          pairwise.push({
            addresses,
            emittedEdgeIds,
            evaluationIds,
            interpretation: emittedEdgeIds.length
              ? 'One or more governed evidence relationships were emitted.'
              : 'No emitted edge was found in this active graph; this is not negative evidence.',
          });
        }
      }
      data = {
        records: bundles.map(({ node }) => node),
        directConnections: connections,
        candidateEvaluations,
        pairwise,
        accounting: {
          recordCount: bundles.length,
          directConnectionCount: connections.length,
          returnedCandidateEvaluationCount: candidateEvaluations.length,
          candidateEvaluationsTruncated: [...evaluationUse.entries()].filter(([, count]) => count > 1).length
            > candidateEvaluations.length,
        },
      };
      break;
    }
    case 'find_similar_cases':
      data = await readSimilarCases({
        context,
        address: request.address,
        limit: request.limit,
        operations: researchToolReadOperations,
      });
      warnings.push('Similarity ranks emitted governed relationships only; it does not establish causation, event identity, truth, or extraordinary origin.');
      warnings.push('Dependent or unknown source lineage must not be counted as independent corroboration.');
      break;
    case 'build_evidence_packet': {
      const bundles = await readRecordBundles(context, request.addresses);
      const selectedAddressSet = new Set(request.addresses);
      const discoveredEdgeIds = request.edgeIds.length ? request.edgeIds : [...new Set(bundles.flatMap(({ ego }) => (
        ego.edgeReferences
          .filter((reference) => reference.edgeType === 'contextual_explanation_candidate'
            || reference.otherEndpoints.some((endpoint) => endpoint.kind === 'evidence' && selectedAddressSet.has(endpoint.id)))
          .map((reference) => reference.edgeId)
      )))].sort(compareText);
      if (discoveredEdgeIds.length > CASE_GRAPH_RESEARCH_LIMITS.packetEdges) {
        invalid('case_graph_research_packet_edge_limit_exceeded');
      }
      const evaluationIds = [...new Set(bundles.flatMap(({ ego }) => ego.evaluationReceiptIds))]
        .sort(compareText);
      const selectedEvaluationIds = evaluationIds.slice(0, CASE_GRAPH_RESEARCH_LIMITS.packetEvaluations);
      await Promise.all([
        primeEdges(context, discoveredEdgeIds),
        primeEvaluations(context, selectedEvaluationIds),
      ]);
      const [edges, evaluations] = await Promise.all([
        Promise.all(discoveredEdgeIds.map((id) => readEdge(context, id))),
        Promise.all(selectedEvaluationIds.map((id) => readEvaluation(context, id))),
      ]);
      for (const edge of edges) {
        if (!evidenceAddresses(edge).some((address) => selectedAddressSet.has(address))) {
          invalid('case_graph_research_packet_edge_out_of_scope');
        }
      }
      data = {
        recordType: 'case_graph_research_evidence_packet',
        schemaVersion: CASE_GRAPH_RESEARCH_TOOL_VERSION,
        question: request.question,
        answer: null,
        answerStatus: 'evidence_packet_only_human_or_grounded_agent_conclusion_required',
        records: bundles.map(({ node }) => node),
        statusReceipts: bundles.map(({ node }) => node.statusReceipt),
        relationships: edges,
        candidateEvaluations: evaluations,
        unresolved: {
          candidateEvaluationReceiptsTruncated: evaluationIds.length > evaluations.length,
          omittedCandidateEvaluationCount: Math.max(0, evaluationIds.length - evaluations.length),
        },
        reproducibility: publication,
      };
      break;
    }
    default:
      return invalid();
  }

  return makeResult({ tool: request.tool, publication, request, data, warnings });
};
