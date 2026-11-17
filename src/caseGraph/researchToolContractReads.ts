import { parseCaseGraphEvidenceAddress } from './publicAccess';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION,
  CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION,
  type CaseGraphResearchRelationshipCursorCodec,
} from './researchRelationshipCursor';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';
import type { FullCorpusPublicEdge, FullCorpusPublicNode } from './typedRelationshipPublicGraph';
import type { TypedRelationshipEdgeType } from './typedRelationshipEngine';
import {
  CASE_GRAPH_RESEARCH_LIMITS,
  CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
  type CaseGraphResearchPublicationBinding,
  type CaseGraphResearchSearchHit,
  type CaseGraphResearchSearchProvider,
  type CaseGraphResearchSimilarityFactor,
  type CaseGraphResearchSimilarCase,
  type CaseGraphResearchToolRequest,
  type CaseGraphRetainedInfluenceSearchProjection,
  type CaseGraphRetainedInfluenceSignal,
  type ResearchReadContext,
} from './researchToolContract';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const SEARCH_CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const SEARCH_FIELDS = ['address', 'title', 'summary', 'source', 'location', 'event_timestamp'] as const;
const EVIDENCE_NODE_KINDS: readonly EvidenceUniverseNodeKind[] = [
  'sighting', 'document', 'photo', 'video',
];

type SearchField = typeof SEARCH_FIELDS[number];

const invalid = (code = 'case_graph_research_request_invalid'): never => { throw new Error(code); };
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const compareUtf8 = (left: string, right: string) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
const required = <T>(value: T | null | undefined, code: string): T => {
  if (value == null) throw new Error(code);
  return value;
};

const exact = (value: unknown, allowedKeys: readonly string[], requiredKeys: readonly string[], code = 'case_graph_research_request_invalid'): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.some((key) => !allowedKeys.includes(key)) || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(object, key))) throw new Error(code);
  return object;
};
const normalizeAddress = (value: unknown) => {
  if (typeof value !== 'string') invalid();
  return parseCaseGraphEvidenceAddress(value as string).address;
};
const sortedUniqueStrings = (value: unknown, maximum: number, normalize: (entry: unknown) => string): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const normalized = (value as unknown[]).map(normalize);
  if (new Set(normalized).size !== normalized.length) invalid();
  return normalized.sort(compareText);
};
const searchCursor = (value: unknown, code = 'case_graph_research_request_invalid'): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > CASE_GRAPH_RESEARCH_LIMITS.searchCursorCharacters || !SEARCH_CURSOR_PATTERN.test(value)) invalid(code);
  return value as string;
};

export type ResearchToolReadOperations = {
  readRecordBundle: (context: ResearchReadContext, address: string) => Promise<{ node: FullCorpusPublicNode; ego: { edgeReferences: Array<{ edgeId: string; edgeType: TypedRelationshipEdgeType; strength: number; receiptId: string; otherEndpoints: Array<{ kind: string; id: string }> }>; evaluationReceiptIds: string[] } }>;
  primeEdges: (context: ResearchReadContext, ids: readonly string[]) => Promise<void>;
  primeNodes: (context: ResearchReadContext, addresses: readonly string[]) => Promise<void>;
  readNode: (context: ResearchReadContext, address: string) => Promise<FullCorpusPublicNode>;
  readEdge: (context: ResearchReadContext, edgeId: string) => Promise<FullCorpusPublicEdge>;
  evidenceAddresses: (edge: FullCorpusPublicEdge) => string[];
  contextIds: (edge: FullCorpusPublicEdge) => string[];
};

const similarityFactorForReason = (family: FullCorpusPublicEdge['receipt']['reasons'][number]['family'], code: string): CaseGraphResearchSimilarityFactor['family'] => {
  if (code.includes('spatial') || family === 'site') return 'geographic';
  if (code.includes('temporal') || family === 'duration') return 'temporal';
  if (family === 'narrative_pattern') return 'semantic';
  if (family === 'provenance' || family === 'source_independence' || family === 'source_dependency') return 'source';
  return 'evidential';
};

export const readSimilarCases = async (params: { context: ResearchReadContext; address: string; limit: number; operations: ResearchToolReadOperations }) => {
  const { operations } = params;
  const { node, ego } = await operations.readRecordBundle(params.context, params.address);
  const candidates = new Map<string, typeof ego.edgeReferences>();
  for (const reference of ego.edgeReferences) for (const endpoint of reference.otherEndpoints) {
    if (endpoint.kind !== 'evidence' || endpoint.id === params.address) continue;
    const references = candidates.get(endpoint.id) || [];
    references.push(reference);
    candidates.set(endpoint.id, references);
  }
  const rankedCandidates = [...candidates.entries()].map(([address, references]) => ({
    address, references: [...references].sort((left, right) => right.strength - left.strength || compareText(left.edgeId, right.edgeId)),
    maximumGovernedStrength: Math.max(...references.map((reference) => reference.strength)),
  })).sort((left, right) => right.maximumGovernedStrength - left.maximumGovernedStrength || right.references.length - left.references.length || compareText(left.address, right.address));
  const selected = rankedCandidates.slice(0, params.limit);
  await Promise.all([
    operations.primeEdges(params.context, selected.flatMap((candidate) => candidate.references.map((reference) => reference.edgeId))),
    operations.primeNodes(params.context, selected.map((candidate) => candidate.address)),
  ]);
  const matches: CaseGraphResearchSimilarCase[] = await Promise.all(selected.map(async (candidate, index) => {
    const record = await operations.readNode(params.context, candidate.address);
    const relationships = await Promise.all(candidate.references.map(async (reference) => {
      const edge = await operations.readEdge(params.context, reference.edgeId);
      const addresses = operations.evidenceAddresses(edge);
      if (edge.edgeType !== reference.edgeType || edge.strength !== reference.strength || edge.receipt.receiptId !== reference.receiptId || !addresses.includes(params.address) || !addresses.includes(candidate.address)) invalid('case_graph_research_edge_reference_integrity_failed');
      return edge;
    }));
    const factorRows = new Map<CaseGraphResearchSimilarityFactor['family'], { reasonCodes: Set<string>; explanations: Set<string>; evidenceIds: Set<string>; metrics: Array<Record<string, string | number | boolean | null>> }>();
    const addFactor = (family: CaseGraphResearchSimilarityFactor['family'], reason: { code: string; plainEnglish: string; evidenceIds: string[]; metrics: Record<string, string | number | boolean | null> }) => {
      const row = factorRows.get(family) || { reasonCodes: new Set<string>(), explanations: new Set<string>(), evidenceIds: new Set<string>(), metrics: [] };
      row.reasonCodes.add(reason.code); row.explanations.add(reason.plainEnglish); reason.evidenceIds.forEach((id) => row.evidenceIds.add(id));
      if (Object.keys(reason.metrics).length) row.metrics.push(reason.metrics); factorRows.set(family, row);
    };
    for (const edge of relationships) { for (const reason of edge.receipt.reasons) addFactor(similarityFactorForReason(reason.family, reason.code), reason); for (const reason of edge.receipt.dependency.reasons) addFactor('source', { ...reason, metrics: {} }); }
    const factors = (['semantic', 'temporal', 'geographic', 'evidential', 'source'] as const).flatMap((family): CaseGraphResearchSimilarityFactor[] => {
      const row = factorRows.get(family); return row ? [{ family, reasonCodes: [...row.reasonCodes].sort(compareText), explanations: [...row.explanations].sort(compareText), evidenceIds: [...row.evidenceIds].sort(compareText), metrics: row.metrics }] : [];
    });
    const classifications = relationships.map((edge) => edge.receipt.dependency.classification);
    const classification = classifications.includes('dependent') ? 'dependent' as const : classifications.every((item) => item === 'independent') ? 'independent' as const : 'unknown' as const;
    const limitations = ['Similarity is an inspectable relationship between records, not evidence of causation, event identity, or extraordinary origin.', classification === 'dependent' ? 'At least one relationship has dependent source lineage and must not be counted as independent corroboration.' : classification === 'unknown' ? 'Source independence is not established for every relationship.' : 'Governed independence assertions exist, but similarity alone still does not establish corroboration or truth.'];
    return { rank: index + 1, record, maximumGovernedStrength: candidate.maximumGovernedStrength, relationshipCount: relationships.length, factorCoverage: factors.map((factor) => factor.family), factors, relationships, sourceLineage: { classification, warnings: limitations.slice(1) }, uncertainty: { levels: [...new Set(relationships.map((edge) => edge.receipt.uncertainty.level))].sort(compareText), reasons: [...new Set(relationships.flatMap((edge) => edge.receipt.uncertainty.reasons))].sort(compareText) }, limitations };
  }));
  return { anchor: node, matches, accounting: { governedNeighbourCount: rankedCandidates.length, returnedMatchCount: matches.length, limit: params.limit, truncated: rankedCandidates.length > matches.length }, ranking: { order: ['maximum_governed_strength_desc', 'relationship_count_desc', 'address_asc'], aggregateScore: null, explanation: 'No opaque composite score is used. Rank follows the strongest emitted governed relationship, then relationship count, then stable address order.' } };
};

export const readExpandedRelationships = async (params: { context: ResearchReadContext; publication: CaseGraphResearchPublicationBinding; tool: 'expand_relationships' | 'correlate_context'; cursor: string | null; cursorCodec?: CaseGraphResearchRelationshipCursorCodec; address: string; edgeTypes: readonly TypedRelationshipEdgeType[]; minimumStrength: number; limit: number; operations: ResearchToolReadOperations }) => {
  const { operations } = params;
  const { node, ego } = await operations.readRecordBundle(params.context, params.address);
  const matching = ego.edgeReferences.filter((reference) => (!params.edgeTypes.length || params.edgeTypes.includes(reference.edgeType)) && reference.strength >= params.minimumStrength).sort((left, right) => right.strength - left.strength || compareText(left.edgeId, right.edgeId));
  let offset = 0;
  if (params.cursor) {
    const cursor = required(params.cursorCodec, 'case_graph_research_relationship_cursor_unavailable').decode(params.cursor);
    const expected = { version: CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION, sortVersion: CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION, tool: params.tool, publicationId: params.publication.publicationId, corpusVersion: params.publication.corpusVersion, manifestSha256: params.publication.manifestSha256, address: params.address, edgeTypes: [...params.edgeTypes], minimumStrength: params.minimumStrength, nextOffset: cursor.nextOffset };
    if (!same(cursor, expected) || cursor.nextOffset >= matching.length) invalid('case_graph_research_relationship_cursor_invalid');
    offset = cursor.nextOffset;
  }
  const selected = matching.slice(offset, offset + params.limit);
  await operations.primeEdges(params.context, selected.map((reference) => reference.edgeId));
  const edges = await Promise.all(selected.map(async (reference) => {
    const edge = await operations.readEdge(params.context, reference.edgeId);
    if (edge.edgeType !== reference.edgeType || edge.strength !== reference.strength || edge.receipt.receiptId !== reference.receiptId || !operations.evidenceAddresses(edge).includes(params.address)) invalid('case_graph_research_edge_reference_integrity_failed');
    return edge;
  }));
  const neighbourAddresses = [...new Set(edges.flatMap(operations.evidenceAddresses).filter((address) => address !== params.address))].sort(compareText);
  await operations.primeNodes(params.context, neighbourAddresses);
  const neighbours = await Promise.all(neighbourAddresses.map((address) => operations.readNode(params.context, address)));
  const nextOffset = offset + edges.length;
  const hasMore = nextOffset < matching.length;
  const nextCursor = hasMore ? required(params.cursorCodec, 'case_graph_research_relationship_cursor_unavailable').encode({ version: CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION, sortVersion: CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION, tool: params.tool, publicationId: params.publication.publicationId, corpusVersion: params.publication.corpusVersion, manifestSha256: params.publication.manifestSha256, address: params.address, edgeTypes: [...params.edgeTypes], minimumStrength: params.minimumStrength, nextOffset }) : null;
  return { node, ego, relationships: edges, neighbours, contextIds: [...new Set(edges.flatMap(operations.contextIds))].sort(compareText), page: { offset, hasMore, nextCursor }, accounting: { matchingRelationshipCount: matching.length, returnedRelationshipCount: edges.length, returnedThroughOffset: nextOffset, truncated: hasMore } };
};

export const normalizeSearchCandidates = async (params: { context: ResearchReadContext; request: Extract<CaseGraphResearchToolRequest, { tool: 'search_records' }>; provider: CaseGraphResearchSearchProvider; binding: CaseGraphResearchPublicationBinding }) => {
  const raw = await params.provider({ active: params.context.active, request: params.request, signal: params.context.signal });
  exact(raw, ['recordType', 'schemaVersion', 'binding', 'indexSha256', 'normalizedQuery', 'hits', 'retainedInfluence', 'page'], ['recordType', 'schemaVersion', 'binding', 'indexSha256', 'normalizedQuery', 'hits', 'page'], 'case_graph_research_search_integrity_failed');
  if (raw.recordType !== 'case_graph_research_search_candidates' || raw.schemaVersion !== CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION || !same(raw.binding, params.binding) || !SHA256_PATTERN.test(raw.indexSha256) || raw.normalizedQuery !== params.request.query || !Array.isArray(raw.hits) || raw.hits.length > params.request.limit) invalid('case_graph_research_search_integrity_failed');
  const seen = new Set<string>(); const parsedHits: CaseGraphResearchSearchHit[] = [];
  for (const candidate of raw.hits) {
    const hit = exact(candidate, ['address', 'score', 'matchedFields', 'reasonCodes'], ['address', 'score', 'matchedFields', 'reasonCodes'], 'case_graph_research_search_integrity_failed'); const address = normalizeAddress(hit.address); const score = Number(hit.score);
    if (seen.has(address) || !Number.isFinite(score) || score < 0 || score > 1) invalid('case_graph_research_search_integrity_failed'); seen.add(address);
    const matchedFields = sortedUniqueStrings(hit.matchedFields, SEARCH_FIELDS.length, (entry) => { if (!SEARCH_FIELDS.includes(entry as SearchField)) invalid('case_graph_research_search_integrity_failed'); return String(entry); }) as SearchField[];
    const reasonCodes = sortedUniqueStrings(hit.reasonCodes, 20, (entry) => { const normalized = typeof entry === 'string' ? entry.trim().toLowerCase() : ''; if (!ID_PATTERN.test(normalized)) invalid('case_graph_research_search_integrity_failed'); return normalized; }); parsedHits.push({ address, score, matchedFields, reasonCodes });
  }
  if (!same(parsedHits, [...parsedHits].sort((left, right) => right.score - left.score || compareUtf8(left.address, right.address)))) invalid('case_graph_research_search_order_invalid');
  const page = exact(raw.page, ['hasMore', 'nextCursor'], ['hasMore', 'nextCursor'], 'case_graph_research_search_integrity_failed'); if (typeof page.hasMore !== 'boolean') invalid('case_graph_research_search_integrity_failed'); const nextCursor = searchCursor(page.nextCursor, 'case_graph_research_search_integrity_failed'); if (page.hasMore !== (nextCursor !== null) || (page.hasMore && parsedHits.length !== params.request.limit)) invalid('case_graph_research_search_integrity_failed');
  let retainedInfluence: CaseGraphRetainedInfluenceSearchProjection | null = null;
  if (raw.retainedInfluence !== undefined) {
    const influence = exact(raw.retainedInfluence, ['schemaVersion', 'influenceReceiptSha256', 'indexSha256', 'signals', 'accounting', 'limitations'], ['schemaVersion', 'influenceReceiptSha256', 'indexSha256', 'signals', 'accounting', 'limitations'], 'case_graph_research_retained_influence_integrity_failed');
    if (influence.schemaVersion !== 'case-vortex-retained-influence-search-v1' || typeof influence.influenceReceiptSha256 !== 'string' || !SHA256_PATTERN.test(influence.influenceReceiptSha256) || typeof influence.indexSha256 !== 'string' || !SHA256_PATTERN.test(influence.indexSha256) || !Array.isArray(influence.signals) || influence.signals.length > params.request.limit || !Array.isArray(influence.limitations)) invalid('case_graph_research_retained_influence_integrity_failed');
    const signalIds = new Set<string>(); const signals = (influence.signals as unknown[]).map((candidate) => { const signal = exact(candidate, ['signalId', 'lane', 'kind', 'source', 'label', 'eventTimestamp', 'location', 'score', 'reasonCodes', 'projectionDigest'], ['signalId', 'lane', 'kind', 'source', 'label', 'eventTimestamp', 'location', 'score', 'reasonCodes', 'projectionDigest'], 'case_graph_research_retained_influence_integrity_failed'); const signalId = typeof signal.signalId === 'string' ? signal.signalId : ''; const score = Number(signal.score);
      if (!/^retained-signal:[a-f0-9]{64}$/u.test(signalId) || signalIds.has(signalId) || !['discovery_signal', 'metadata_lead'].includes(String(signal.lane)) || !EVIDENCE_NODE_KINDS.includes(signal.kind as EvidenceUniverseNodeKind) || typeof signal.source !== 'string' || !(signal.source as string).trim() || Buffer.byteLength(signal.source as string, 'utf8') > 250 || typeof signal.label !== 'string' || !(signal.label as string).trim() || Buffer.byteLength(signal.label as string, 'utf8') > 500 || (signal.eventTimestamp !== null && (typeof signal.eventTimestamp !== 'string' || !Number.isFinite(new Date(signal.eventTimestamp).getTime()))) || (signal.location !== null && (typeof signal.location !== 'string' || Buffer.byteLength(signal.location, 'utf8') > 500)) || !Number.isFinite(score) || score < 0 || score > 1 || typeof signal.projectionDigest !== 'string' || !SHA256_PATTERN.test(signal.projectionDigest)) invalid('case_graph_research_retained_influence_integrity_failed');
      signalIds.add(signalId); const reasonCodes = sortedUniqueStrings(signal.reasonCodes, 20, (entry) => { const normalized = typeof entry === 'string' ? entry.trim().toLowerCase() : ''; if (!ID_PATTERN.test(normalized)) invalid('case_graph_research_retained_influence_integrity_failed'); return normalized; }); return { signalId, lane: signal.lane as CaseGraphRetainedInfluenceSignal['lane'], kind: signal.kind as EvidenceUniverseNodeKind, source: (signal.source as string).trim(), label: (signal.label as string).trim(), eventTimestamp: signal.eventTimestamp as string | null, location: signal.location === null ? null : String(signal.location).trim(), score, reasonCodes, projectionDigest: signal.projectionDigest as string };
    });
    if (!same(signals, [...signals].sort((left, right) => right.score - left.score || compareUtf8(left.signalId, right.signalId)))) invalid('case_graph_research_retained_influence_order_invalid');
    const accountingValue = exact(influence.accounting, ['retainedRecordCount', 'evidenceRecordCount', 'discoverySignalRecordCount', 'metadataLeadRecordCount', 'coverageGapRecordCount', 'matchedDiscoverySignalCount', 'matchedMetadataLeadCount', 'returnedSignalCount', 'truncated'], ['retainedRecordCount', 'evidenceRecordCount', 'discoverySignalRecordCount', 'metadataLeadRecordCount', 'coverageGapRecordCount', 'matchedDiscoverySignalCount', 'matchedMetadataLeadCount', 'returnedSignalCount', 'truncated'], 'case_graph_research_retained_influence_integrity_failed');
    const countKeys = ['retainedRecordCount', 'evidenceRecordCount', 'discoverySignalRecordCount', 'metadataLeadRecordCount', 'coverageGapRecordCount', 'matchedDiscoverySignalCount', 'matchedMetadataLeadCount', 'returnedSignalCount'] as const;
    const accounting = Object.fromEntries(countKeys.map((key) => { const value = Number(accountingValue[key]); if (!Number.isSafeInteger(value) || value < 0) invalid('case_graph_research_retained_influence_integrity_failed'); return [key, value]; })) as Omit<CaseGraphRetainedInfluenceSearchProjection['accounting'], 'truncated'>;
    if (typeof accountingValue.truncated !== 'boolean' || accounting.retainedRecordCount !== accounting.evidenceRecordCount + accounting.discoverySignalRecordCount + accounting.metadataLeadRecordCount + accounting.coverageGapRecordCount || accounting.returnedSignalCount !== signals.length || accounting.matchedDiscoverySignalCount < signals.filter(({ lane }) => lane === 'discovery_signal').length || accounting.matchedMetadataLeadCount < signals.filter(({ lane }) => lane === 'metadata_lead').length || accounting.matchedDiscoverySignalCount > accounting.discoverySignalRecordCount || accounting.matchedMetadataLeadCount > accounting.metadataLeadRecordCount) invalid('case_graph_research_retained_influence_integrity_failed');
    const limitations = sortedUniqueStrings(influence.limitations, 20, (entry) => { const text = typeof entry === 'string' ? entry.trim() : ''; if (!text || Buffer.byteLength(text, 'utf8') > 1_000) invalid('case_graph_research_retained_influence_integrity_failed'); return text; });
    retainedInfluence = { schemaVersion: 'case-vortex-retained-influence-search-v1', influenceReceiptSha256: influence.influenceReceiptSha256 as string, indexSha256: influence.indexSha256 as string, signals, accounting: { ...accounting, truncated: accountingValue.truncated as boolean }, limitations };
  }
  return { index: { schemaVersion: raw.schemaVersion, indexSha256: raw.indexSha256, candidateSetDigest: relationshipInputSha256(raw) }, hits: parsedHits, retainedInfluence, page: { hasMore: page.hasMore, nextCursor } };
};
