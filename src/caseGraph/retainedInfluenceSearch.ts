import {
  CASE_GRAPH_RESEARCH_LIMITS,
  type CaseGraphResearchPublicationPin,
  type CaseGraphResearchSearchCandidates,
  type CaseGraphResearchSearchProvider,
  type CaseGraphRetainedInfluenceSignal,
} from './researchToolContract';
import {
  type RetainedCorpusInfluenceReceipt,
  verifyRetainedCorpusInfluenceReceipt,
} from './retainedCorpusInfluence';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const RETAINED_INFLUENCE_SEARCH_VERSION =
  'case-vortex-retained-influence-search-v1' as const;

export type RetainedInfluenceIndexEntry = {
  opaqueRecordId: string;
  lane: 'discovery_signal' | 'metadata_lead';
  kind: 'sighting' | 'document' | 'photo' | 'video';
  source: string;
  eventTimestamp: string | null;
  generalizedLocation: string | null;
  searchTerms: string[];
  projectionPolicy:
    | 'derived_features_only'
    | 'metadata_and_source_link_only';
};

type RetainedInfluenceSearchIndex = {
  schemaVersion: 'case-vortex-retained-influence-search-index-v1';
  publication: CaseGraphResearchPublicationPin;
  influenceReceiptSha256: string;
  entries: Array<RetainedInfluenceIndexEntry & {
    signalId: string;
    projectionDigest: string;
    normalizedTerms: string[];
  }>;
  indexSha256: string;
};

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const normalizeText = (value: string) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/gu, ' ');
const normalizeSourceKey = (value: string) => String(value || '').trim().toLowerCase();
const tokens = (value: string) => [...new Set(normalizeText(value).split(' ').filter(Boolean))].sort(compareText);
const boundedText = (value: unknown, maximumBytes: number, code: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || Buffer.byteLength(text, 'utf8') > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(code);
  return text;
};
const nullableText = (value: unknown, maximumBytes: number, code: string) => {
  if (value === null) return null;
  return boundedText(value, maximumBytes, code);
};
const timestamp = (value: unknown) => {
  if (value === null) return null;
  const text = boundedText(value, 80, 'retained_influence_search_timestamp_invalid');
  if (!Number.isFinite(new Date(text).getTime())) {
    throw new Error('retained_influence_search_timestamp_invalid');
  }
  return new Date(text).toISOString();
};
const samePublication = (
  left: CaseGraphResearchPublicationPin,
  right: CaseGraphResearchPublicationPin,
) => left.publicationId === right.publicationId
  && left.corpusVersion === right.corpusVersion
  && left.manifestSha256 === right.manifestSha256;

export const buildRetainedInfluenceSearchIndex = (params: {
  publication: CaseGraphResearchPublicationPin;
  influenceReceiptValue: unknown;
  censusValue: unknown;
  sourceGovernanceValue: unknown;
  entries: RetainedInfluenceIndexEntry[];
}): RetainedInfluenceSearchIndex => {
  const receipt = verifyRetainedCorpusInfluenceReceipt(
    params.influenceReceiptValue,
    params.censusValue,
    params.sourceGovernanceValue,
  );
  if (!Array.isArray(params.entries)
    || params.entries.length > receipt.influenceLaneCounts.discovery_signal
      + receipt.influenceLaneCounts.metadata_lead) {
    throw new Error('retained_influence_search_entries_invalid');
  }
  const ids = new Set<string>();
  const entries = params.entries.map((raw) => {
    const opaqueRecordId = boundedText(
      raw.opaqueRecordId,
      240,
      'retained_influence_search_record_id_invalid',
    );
    const source = boundedText(raw.source, 250, 'retained_influence_search_source_invalid');
    if (ids.has(opaqueRecordId)
      || !['discovery_signal', 'metadata_lead'].includes(raw.lane)
      || !['sighting', 'document', 'photo', 'video'].includes(raw.kind)
      || raw.projectionPolicy !== (
        raw.lane === 'discovery_signal'
          ? 'derived_features_only'
          : 'metadata_and_source_link_only'
      )
      || !Array.isArray(raw.searchTerms)
      || raw.searchTerms.length > 64) {
      throw new Error('retained_influence_search_entries_invalid');
    }
    ids.add(opaqueRecordId);
    const normalizedTerms = [...new Set(raw.searchTerms.flatMap((term) => {
      const text = boundedText(term, 120, 'retained_influence_search_term_invalid');
      return tokens(text);
    }))].sort(compareText);
    if (!normalizedTerms.length) throw new Error('retained_influence_search_term_invalid');
    const entry = {
      opaqueRecordId,
      lane: raw.lane,
      kind: raw.kind,
      source,
      eventTimestamp: timestamp(raw.eventTimestamp),
      generalizedLocation: raw.lane === 'metadata_lead'
        ? nullableText(raw.generalizedLocation, 500, 'retained_influence_search_location_invalid')
        : null,
      searchTerms: [...raw.searchTerms],
      projectionPolicy: raw.projectionPolicy,
      normalizedTerms,
    };
    const projectionDigest = relationshipInputSha256(entry);
    return {
      ...entry,
      signalId: `retained-signal:${relationshipInputSha256({
        influenceReceiptSha256: receipt.receiptSha256,
        opaqueRecordId,
        projectionDigest,
      })}`,
      projectionDigest,
    };
  }).sort((left, right) => compareText(left.signalId, right.signalId));
  const body = {
    schemaVersion: 'case-vortex-retained-influence-search-index-v1' as const,
    publication: { ...params.publication },
    influenceReceiptSha256: receipt.receiptSha256,
    entries,
  };
  return { ...body, indexSha256: relationshipInputSha256(body) };
};

const signalFor = (
  entry: RetainedInfluenceSearchIndex['entries'][number],
  queryTerms: string[],
): CaseGraphRetainedInfluenceSignal => {
  const matched = queryTerms.filter((term) => entry.normalizedTerms.includes(term));
  const score = Math.min(1, matched.length / Math.max(1, queryTerms.length));
  return {
    signalId: entry.signalId,
    lane: entry.lane,
    kind: entry.kind,
    source: entry.source,
    label: entry.lane === 'discovery_signal'
      ? `Derived pattern signal from ${entry.source}`
      : `${entry.source} ${entry.kind} research lead`,
    eventTimestamp: entry.eventTimestamp,
    location: entry.generalizedLocation,
    score,
    reasonCodes: [
      entry.lane === 'discovery_signal'
        ? 'derived_features_only'
        : 'metadata_and_source_link_only',
      'non_citable_retained_influence',
      'zero_independent_corroboration_credit',
      ...matched.map((term) => `matched_term_${relationshipInputSha256(term).slice(0, 12)}`),
    ].sort(compareText),
    projectionDigest: entry.projectionDigest,
  };
};

export const createRetainedInfluenceAugmentedSearchProvider = (params: {
  evidenceSearch: CaseGraphResearchSearchProvider;
  index: RetainedInfluenceSearchIndex;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
}): CaseGraphResearchSearchProvider => async (requestParams) => {
  const publication = {
    publicationId: requestParams.active.publicationId,
    corpusVersion: requestParams.active.corpusVersion,
    manifestSha256: requestParams.active.manifestSha256,
  };
  if (!samePublication(params.index.publication, publication)
    || params.index.influenceReceiptSha256 !== params.influenceReceipt.receiptSha256) {
    throw new Error('retained_influence_search_publication_binding_mismatch');
  }
  const evidence = await params.evidenceSearch(requestParams);
  const queryTerms = tokens(requestParams.request.query);
  const filters = requestParams.request.filters;
  const matches = params.index.entries.filter((entry) => {
    if (!queryTerms.some((term) => entry.normalizedTerms.includes(term))) return false;
    if (filters.kinds.length && !filters.kinds.includes(entry.kind)) return false;
    if (filters.sources.length && !filters.sources.includes(normalizeSourceKey(entry.source))) return false;
    if (filters.eventStart && (
      !entry.eventTimestamp || entry.eventTimestamp < filters.eventStart
    )) return false;
    if (filters.eventEnd && (
      !entry.eventTimestamp || entry.eventTimestamp >= filters.eventEnd
    )) return false;
    return true;
  }).map((entry) => signalFor(entry, queryTerms))
    .sort((left, right) => right.score - left.score || compareText(left.signalId, right.signalId));
  const signalLimit = Math.min(
    requestParams.request.limit,
    CASE_GRAPH_RESEARCH_LIMITS.searchResults,
  );
  const isInitialEvidencePage = requestParams.request.cursor === null;
  const signals = isInitialEvidencePage ? matches.slice(0, signalLimit) : [];
  const matchedDiscoverySignalCount = matches
    .filter(({ lane }) => lane === 'discovery_signal').length;
  const matchedMetadataLeadCount = matches
    .filter(({ lane }) => lane === 'metadata_lead').length;
  const retainedInfluence: NonNullable<CaseGraphResearchSearchCandidates['retainedInfluence']> = {
    schemaVersion: RETAINED_INFLUENCE_SEARCH_VERSION,
    influenceReceiptSha256: params.influenceReceipt.receiptSha256,
    indexSha256: params.index.indexSha256,
    signals,
    accounting: {
      retainedRecordCount: params.influenceReceipt.accounting.retainedRecordCount,
      evidenceRecordCount: params.influenceReceipt.influenceLaneCounts.evidence,
      discoverySignalRecordCount: params.influenceReceipt.influenceLaneCounts.discovery_signal,
      metadataLeadRecordCount: params.influenceReceipt.influenceLaneCounts.metadata_lead,
      coverageGapRecordCount: params.influenceReceipt.influenceLaneCounts.coverage_gap,
      matchedDiscoverySignalCount,
      matchedMetadataLeadCount,
      returnedSignalCount: signals.length,
      truncated: matches.length > signals.length,
    },
    limitations: [
      'Discovery signals and metadata leads are not evidence and cannot be cited.',
      'Derived or shared-lineage material receives zero independent-corroboration credit.',
      'Coverage-gap records affect uncertainty but expose no restricted or unverified content.',
      params.index.entries.length < (
        params.influenceReceipt.influenceLaneCounts.discovery_signal
        + params.influenceReceipt.influenceLaneCounts.metadata_lead
      )
        ? 'The retained influence index is incomplete; unmatched retained records still affect coverage accounting.'
        : 'The retained influence index covers every discovery-signal and metadata-lead record.',
      isInitialEvidencePage
        ? 'Query-matched retained influence signals are returned only on the first evidence-results page.'
        : 'Retained influence signals were omitted from this later evidence-results page to prevent duplicate research leads.',
    ],
  };
  return { ...evidence, retainedInfluence };
};
