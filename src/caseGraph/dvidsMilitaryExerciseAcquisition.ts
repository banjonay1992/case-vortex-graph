import {
  buildDvidsMilitaryExerciseReferenceCollection,
  decodeDvidsMilitaryExerciseSearchPage,
  materializeAndPublishDvidsMilitaryExerciseArchive,
  verifyDvidsMilitaryExerciseReferenceCollection,
  type DvidsMilitaryExerciseCapturedSearchPage,
  type DvidsMilitaryExercisePublicationSighting,
  type DvidsMilitaryExerciseReferenceCollection,
} from './dvidsMilitaryExerciseProviderArchive';
import {
  createDecisionPacketGovernedExternalCorrelationProviderAdapter,
  type CaseGraphExternalCorrelationGovernanceInspector,
} from './externalCorrelationProviderAdapters';
import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import { normalizeCountry } from '../utils/metadataNormalizer';

export const DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION =
  'dvids-military-exercise-acquisition-v1' as const;

const MAX_NODES = 1_000_000;
const MAX_QUERIES = 1_000_000;
const MAX_QUERIES_PER_RUN = 10_000;
const MAX_ACCESSIBLE_RESULTS = 1_000;
const MAX_RESULTS_PER_PAGE = 50;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SEARCH_TERMS = [
  'exercise',
  'training',
  'drill',
  'gunnery',
  'readiness evaluation',
  'MCCRE',
  'war game',
] as const;
const PLAN_LIMITATIONS = [
  'DVIDS is an official public-media search surface, not a complete military-exercise schedule.',
  'Each query exposes at most 1,000 results; a checked query therefore cannot rule out unreturned activity.',
  'The plan uses exact named city, optional region/country, calendar month and explicit exercise-language searches; inconsistent producer metadata can prevent a match.',
  'Matching media remains contextual evidence and cannot identify a reported object or establish causation.',
  'This plan authorizes no provider call, archive write, database write, publication or deployment.',
] as const;
const PUBLICATION_KEYS = [
  'publicationId', 'corpusVersion', 'manifestSha256', 'snapshotId',
  'graphArtifactSetSha256', 'relationshipSchemaVersion',
  'relationshipPolicyVersion', 'relationshipPolicySha256',
  'relationshipModelId', 'relationshipModelVersion', 'relationshipModelSha256',
  'calibrationSetSha256',
] as const;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const exactKeys = (value: object, expected: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(compare);
  const wanted = [...expected].sort(compare);
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) fail(code);
};

const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !/(?:z|[+-]\d{2}:\d{2})$/iu.test(value)) {
    throw new Error(code);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return new Date(parsed).toISOString();
};

const text = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) fail(code);
  return normalized;
};

const publicationBinding = (value: CaseGraphResearchPublicationBinding) => {
  exactKeys(value, PUBLICATION_KEYS, 'dvids_military_acquisition_publication_invalid');
  if (!UUID.test(value.publicationId)
    || !SHA256.test(value.manifestSha256)
    || !SHA256.test(value.graphArtifactSetSha256)
    || !SHA256.test(value.relationshipPolicySha256)
    || !SHA256.test(value.relationshipModelSha256)
    || !SHA256.test(value.calibrationSetSha256)
    || Object.entries(value).some(([key, item]) => (
      !PUBLICATION_KEYS.includes(key as typeof PUBLICATION_KEYS[number])
      || item !== text(item, 500, 'dvids_military_acquisition_publication_invalid')
    ))) {
    fail('dvids_military_acquisition_publication_invalid');
  }
  return structuredClone(value);
};

const monthBounds = (eventAt: string) => {
  const date = new Date(eventAt);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { fromDate: start.toISOString(), toDate: end.toISOString() };
};

const requestUrl = (params: {
  term: string;
  city: string;
  region: string | null;
  countryCode: string | null;
  fromDate: string;
  toDate: string;
  page: number;
}) => {
  const url = new URL('https://api.dvidshub.net/search');
  url.searchParams.set('city', params.city);
  if (params.region) url.searchParams.set('state', params.region);
  if (params.countryCode) url.searchParams.set('country', params.countryCode);
  url.searchParams.set('from_date', params.fromDate);
  url.searchParams.set('max_results', String(MAX_RESULTS_PER_PAGE));
  url.searchParams.set('page', String(params.page));
  url.searchParams.set('q', params.term);
  url.searchParams.set('short_description_length', '300');
  url.searchParams.set('sort', 'date');
  url.searchParams.set('sortdir', 'asc');
  url.searchParams.set('to_date', params.toDate);
  url.searchParams.sort();
  return url.toString();
};

export type DvidsMilitaryExerciseAcquisitionExclusionReason =
  | 'sighting_time_missing'
  | 'sighting_city_missing'
  | 'future_dated';

export type DvidsMilitaryExerciseAcquisitionQuery = {
  ordinal: number;
  queryId: string;
  term: typeof SEARCH_TERMS[number];
  city: string;
  region: string | null;
  countryCode: string | null;
  fromDate: string;
  toDate: string;
  firstPageUrl: string;
  addresses: string[];
  queryDigest: string;
};

export type DvidsMilitaryExerciseAcquisitionPlan = {
  recordType: 'dvids_military_exercise_acquisition_plan';
  schemaVersion: typeof DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  plannedAt: string;
  checkedAt: string;
  queries: DvidsMilitaryExerciseAcquisitionQuery[];
  excluded: Array<{
    address: string;
    reason: DvidsMilitaryExerciseAcquisitionExclusionReason;
  }>;
  accounting: {
    inputAddressCount: number;
    plannedAddressCount: number;
    excludedAddressCount: number;
    locationMonthGroupCount: number;
    queryCount: number;
    maximumProviderCalls: number;
    maximumAccessibleResultsPerQuery: 1_000;
    maximumResultsPerPage: 50;
  };
  limitations: string[];
  planDigest: string;
};

export type DvidsMilitaryExerciseAcquisitionQueryReceipt = {
  ordinal: number;
  queryId: string;
  queryDigest: string;
  totalResults: number;
  accessibleResults: number;
  pageCount: number;
  responseSha256s: string[];
  receiptDigest: string;
};

export type DvidsMilitaryExerciseAcquisitionCompletion = {
  recordType: 'dvids_military_exercise_acquisition_completion';
  schemaVersion: typeof DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  planDigest: string;
  decisionPacketDigest: string;
  queryCount: number;
  providerCallCount: number;
  retainedReferenceCount: number;
  duplicateReferenceCount: number;
  excludedNonExerciseResults: number;
  queryReceipts: DvidsMilitaryExerciseAcquisitionQueryReceipt[];
  collection: DvidsMilitaryExerciseReferenceCollection;
  limitations: string[];
  completedAt: string;
  completionDigest: string;
};

export type DvidsMilitaryExerciseAcquisitionResult =
  | {
    status: 'blocked';
    planDigest: string;
    decisionPacketDigest: string;
    reasonCodes: string[];
    explanation: string;
    providerCallCount: 0;
  }
  | {
    status: 'complete';
    providerCallCount: number;
    completion: DvidsMilitaryExerciseAcquisitionCompletion;
  };

const queryCore = (
  value: Omit<DvidsMilitaryExerciseAcquisitionQuery, 'queryDigest'>
    | DvidsMilitaryExerciseAcquisitionQuery,
) => {
  const { queryDigest: _queryDigest, ...core } = value as DvidsMilitaryExerciseAcquisitionQuery;
  return core;
};

export const planDvidsMilitaryExerciseAcquisition = (params: {
  publication: CaseGraphResearchPublicationBinding;
  sightings: DvidsMilitaryExercisePublicationSighting[];
  checkedAt: string;
  plannedAt: string;
}): DvidsMilitaryExerciseAcquisitionPlan => {
  if (!params.sightings.length || params.sightings.length > MAX_NODES
    || new Set(params.sightings.map(({ address }) => address)).size !== params.sightings.length) {
    fail('dvids_military_acquisition_plan_input_invalid');
  }
  const publication = publicationBinding(params.publication);
  const checkedAt = timestamp(params.checkedAt, 'dvids_military_acquisition_time_invalid');
  const plannedAt = timestamp(params.plannedAt, 'dvids_military_acquisition_time_invalid');
  if (plannedAt < checkedAt) fail('dvids_military_acquisition_time_invalid');
  const excluded: DvidsMilitaryExerciseAcquisitionPlan['excluded'] = [];
  const groups = new Map<string, {
    city: string;
    region: string | null;
    countryCode: string | null;
    fromDate: string;
    toDate: string;
    addresses: string[];
  }>();
  for (const sighting of [...params.sightings].sort((left, right) => compare(left.address, right.address))) {
    if (!sighting.eventTimestamp) {
      excluded.push({ address: sighting.address, reason: 'sighting_time_missing' });
      continue;
    }
    const eventAt = timestamp(sighting.eventTimestamp, 'dvids_military_acquisition_sighting_invalid');
    if (eventAt > checkedAt) {
      excluded.push({ address: sighting.address, reason: 'future_dated' });
      continue;
    }
    if (!sighting.city) {
      excluded.push({ address: sighting.address, reason: 'sighting_city_missing' });
      continue;
    }
    const city = text(sighting.city, 200, 'dvids_military_acquisition_sighting_invalid');
    const country = normalizeCountry(sighting.country, null);
    const region = sighting.region
      ? text(sighting.region, 200, 'dvids_military_acquisition_sighting_invalid')
      : null;
    const { fromDate, toDate } = monthBounds(eventAt);
    const key = [city.toLocaleLowerCase('en-US'), region || '', country.country_code || '', fromDate].join('\n');
    const group = groups.get(key);
    if (group) group.addresses.push(sighting.address);
    else groups.set(key, {
      city,
      region,
      countryCode: country.country_code,
      fromDate,
      toDate,
      addresses: [sighting.address],
    });
  }
  if (groups.size * SEARCH_TERMS.length > MAX_QUERIES) {
    fail('dvids_military_acquisition_plan_too_large');
  }
  const orderedGroups = [...groups.values()].sort((left, right) => (
    compare(left.fromDate, right.fromDate)
    || compare(left.countryCode || '', right.countryCode || '')
    || compare(left.region || '', right.region || '')
    || compare(left.city, right.city)
  ));
  const queries = orderedGroups.flatMap((group) => SEARCH_TERMS.map((term) => ({
    term,
    group,
  }))).map(({ term, group }, ordinal) => {
    const base = {
      ordinal,
      queryId: `dvids-query:${relationshipInputSha256({
        term,
        city: group.city,
        region: group.region,
        countryCode: group.countryCode,
        fromDate: group.fromDate,
        toDate: group.toDate,
      })}`,
      term,
      city: group.city,
      region: group.region,
      countryCode: group.countryCode,
      fromDate: group.fromDate,
      toDate: group.toDate,
      firstPageUrl: requestUrl({ ...group, term, page: 1 }),
      addresses: [...group.addresses].sort(compare),
    };
    return { ...base, queryDigest: relationshipInputSha256(queryCore(base)) };
  });
  const plannedAddresses = new Set(queries.flatMap(({ addresses }) => addresses));
  const core = {
    recordType: 'dvids_military_exercise_acquisition_plan' as const,
    schemaVersion: DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION,
    publication,
    plannedAt,
    checkedAt,
    queries,
    excluded: excluded.sort((left, right) => compare(left.address, right.address)),
    accounting: {
      inputAddressCount: params.sightings.length,
      plannedAddressCount: plannedAddresses.size,
      excludedAddressCount: excluded.length,
      locationMonthGroupCount: groups.size,
      queryCount: queries.length,
      maximumProviderCalls: queries.length * (MAX_ACCESSIBLE_RESULTS / MAX_RESULTS_PER_PAGE),
      maximumAccessibleResultsPerQuery: 1_000 as const,
      maximumResultsPerPage: 50 as const,
    },
    limitations: [...PLAN_LIMITATIONS],
  };
  if (core.accounting.plannedAddressCount + core.accounting.excludedAddressCount
    !== core.accounting.inputAddressCount) {
    fail('dvids_military_acquisition_accounting_invalid');
  }
  return { ...core, planDigest: relationshipInputSha256(core) };
};

export const verifyDvidsMilitaryExerciseAcquisitionPlan = (
  plan: DvidsMilitaryExerciseAcquisitionPlan,
) => {
  exactKeys(plan, [
    'recordType', 'schemaVersion', 'publication', 'plannedAt', 'checkedAt',
    'queries', 'excluded', 'accounting', 'limitations', 'planDigest',
  ], 'dvids_military_acquisition_plan_invalid');
  exactKeys(plan.accounting, [
    'inputAddressCount', 'plannedAddressCount', 'excludedAddressCount',
    'locationMonthGroupCount', 'queryCount', 'maximumProviderCalls',
    'maximumAccessibleResultsPerQuery', 'maximumResultsPerPage',
  ], 'dvids_military_acquisition_plan_invalid');
  publicationBinding(plan.publication);
  for (const entry of plan.excluded) {
    exactKeys(entry, ['address', 'reason'], 'dvids_military_acquisition_plan_invalid');
  }
  for (const query of plan.queries) {
    exactKeys(query, [
      'ordinal', 'queryId', 'term', 'city', 'region', 'countryCode',
      'fromDate', 'toDate', 'firstPageUrl', 'addresses', 'queryDigest',
    ], 'dvids_military_acquisition_plan_invalid');
  }
  const { planDigest, ...core } = plan;
  if (plan.recordType !== 'dvids_military_exercise_acquisition_plan'
    || plan.schemaVersion !== DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION
    || planDigest !== relationshipInputSha256(core)
    || plan.checkedAt !== timestamp(plan.checkedAt, 'dvids_military_acquisition_plan_invalid')
    || plan.plannedAt !== timestamp(plan.plannedAt, 'dvids_military_acquisition_plan_invalid')
    || plan.plannedAt < plan.checkedAt
    || JSON.stringify(plan.limitations) !== JSON.stringify(PLAN_LIMITATIONS)
    || plan.accounting.queryCount !== plan.queries.length
    || plan.accounting.maximumProviderCalls !== plan.queries.length
      * (MAX_ACCESSIBLE_RESULTS / MAX_RESULTS_PER_PAGE)
    || plan.accounting.maximumAccessibleResultsPerQuery !== MAX_ACCESSIBLE_RESULTS
    || plan.accounting.maximumResultsPerPage !== MAX_RESULTS_PER_PAGE
    || plan.accounting.plannedAddressCount + plan.accounting.excludedAddressCount
      !== plan.accounting.inputAddressCount
    || plan.excluded.length !== plan.accounting.excludedAddressCount
    || new Set(plan.excluded.map(({ address }) => address)).size !== plan.excluded.length
    || plan.excluded.some((entry) => (
      entry.address !== text(entry.address, 500, 'dvids_military_acquisition_plan_invalid')
      || !['sighting_time_missing', 'sighting_city_missing', 'future_dated'].includes(entry.reason)
    ))
    || plan.queries.some((query, ordinal) => {
      const expectedQueryId = `dvids-query:${relationshipInputSha256({
        term: query.term,
        city: query.city,
        region: query.region,
        countryCode: query.countryCode,
        fromDate: query.fromDate,
        toDate: query.toDate,
      })}`;
      return query.ordinal !== ordinal
      || !SEARCH_TERMS.includes(query.term)
      || query.city !== text(query.city, 200, 'dvids_military_acquisition_plan_invalid')
      || query.region != null
        && query.region !== text(query.region, 200, 'dvids_military_acquisition_plan_invalid')
      || query.countryCode != null && !/^[A-Z]{2}$/u.test(query.countryCode)
      || query.fromDate !== timestamp(query.fromDate, 'dvids_military_acquisition_plan_invalid')
      || query.toDate !== timestamp(query.toDate, 'dvids_military_acquisition_plan_invalid')
      || query.fromDate >= query.toDate
      || !query.addresses.length
      || new Set(query.addresses).size !== query.addresses.length
      || query.addresses.some((address) => (
        address !== text(address, 500, 'dvids_military_acquisition_plan_invalid')
      ))
      || query.queryId !== expectedQueryId
      || query.queryDigest !== relationshipInputSha256(queryCore(query))
      || query.firstPageUrl !== requestUrl({ ...query, page: 1 });
    })) {
    fail('dvids_military_acquisition_plan_invalid');
  }
  const plannedAddresses = new Set(plan.queries.flatMap(({ addresses }) => addresses));
  const excludedAddresses = new Set(plan.excluded.map(({ address }) => address));
  if (plannedAddresses.size !== plan.accounting.plannedAddressCount
    || [...plannedAddresses].some((address) => excludedAddresses.has(address))
    || plan.accounting.locationMonthGroupCount * SEARCH_TERMS.length !== plan.queries.length) {
    fail('dvids_military_acquisition_plan_invalid');
  }
  return plan;
};

const pageUrl = (query: DvidsMilitaryExerciseAcquisitionQuery, page: number) => (
  requestUrl({ ...query, page })
);

export const acquireDvidsMilitaryExerciseReferences = async (params: {
  plan: DvidsMilitaryExerciseAcquisitionPlan;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  apiKey: string | (() => string);
  fetchPage: (params: {
    requestUrl: string;
    apiKey: string;
    signal?: AbortSignal;
  }) => Promise<{ body: Buffer | string; acquiredAt: string }>;
  completedAt: string;
  signal?: AbortSignal;
}): Promise<DvidsMilitaryExerciseAcquisitionResult> => {
  const plan = verifyDvidsMilitaryExerciseAcquisitionPlan(params.plan);
  const decisionPacket = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  if (plan.queries.length > MAX_QUERIES_PER_RUN) fail('dvids_military_acquisition_run_too_large');
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  let authorized = false;
  const adapter = createDecisionPacketGovernedExternalCorrelationProviderAdapter({
    category: 'military_exercise',
    canonicalSource: 'DVIDS',
    providerId: 'dvids-exercise-reference',
    requiredContentMode: 'metadata_only',
    decisionPacket,
    inspectGovernance: params.inspectGovernance,
    correlate: async () => {
      authorized = true;
      return {
        availability: 'available',
        reasonCodes: ['dvids_acquisition_authorized'],
        explanation: 'The exact source decision and live legal registry approve this acquisition identity.',
        source: null,
        candidates: [],
      };
    },
  });
  const gate = await adapter.correlate({
    publication: plan.publication,
    address: 'governance:dvids-military-exercise-acquisition',
    nodeDigest: relationshipInputSha256({
      planDigest: plan.planDigest,
      decisionPacketDigest: decisionPacket.packetDigest,
    }),
    limit: 1,
    checkedAt: plan.checkedAt,
    signal: params.signal,
  });
  if (!authorized) return {
    status: 'blocked',
    planDigest: plan.planDigest,
    decisionPacketDigest: decisionPacket.packetDigest,
    reasonCodes: gate.reasonCodes,
    explanation: gate.explanation,
    providerCallCount: 0,
  };
  const apiKey = text(
    typeof params.apiKey === 'function' ? params.apiKey() : params.apiKey,
    500,
    'dvids_military_acquisition_api_key_invalid',
  );

  const capturedPages: DvidsMilitaryExerciseCapturedSearchPage[] = [];
  const queryReceipts: DvidsMilitaryExerciseAcquisitionQueryReceipt[] = [];
  let providerCallCount = 0;
  for (const query of plan.queries) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const firstRequestUrl = pageUrl(query, 1);
    const firstCapture = await params.fetchPage({
      requestUrl: firstRequestUrl,
      apiKey,
      signal: params.signal,
    });
    providerCallCount += 1;
    const first = decodeDvidsMilitaryExerciseSearchPage({
      ...firstCapture,
      requestUrl: firstRequestUrl,
    });
    if (first.resultsPerPage !== MAX_RESULTS_PER_PAGE) {
      fail('dvids_military_acquisition_page_size_mismatch');
    }
    const accessibleResults = Math.min(first.totalResults, MAX_ACCESSIBLE_RESULTS);
    const pageCount = Math.max(1, Math.ceil(accessibleResults / first.resultsPerPage));
    if (pageCount > MAX_ACCESSIBLE_RESULTS) fail('dvids_military_acquisition_page_count_invalid');
    const decodedPages = [first];
    const firstExpected = pageCount === 1
      ? accessibleResults
      : first.resultsPerPage;
    if (first.retainedResults.length + first.excludedNonExerciseResults !== firstExpected) {
      fail('dvids_military_acquisition_pagination_incomplete');
    }
    capturedPages.push({ ...firstCapture, requestUrl: firstRequestUrl });
    for (let page = 2; page <= pageCount; page += 1) {
      if (params.signal?.aborted) fail('case_graph_research_aborted');
      const nextRequestUrl = pageUrl(query, page);
      const capture = await params.fetchPage({
        requestUrl: nextRequestUrl,
        apiKey,
        signal: params.signal,
      });
      providerCallCount += 1;
      const decoded = decodeDvidsMilitaryExerciseSearchPage({
        ...capture,
        requestUrl: nextRequestUrl,
      });
      if (decoded.totalResults !== first.totalResults
        || decoded.resultsPerPage !== first.resultsPerPage) {
        fail('dvids_military_acquisition_pagination_drift');
      }
      const expectedResults = page === pageCount
        ? accessibleResults - (page - 1) * first.resultsPerPage
        : first.resultsPerPage;
      if (decoded.retainedResults.length + decoded.excludedNonExerciseResults
        !== expectedResults) {
        fail('dvids_military_acquisition_pagination_incomplete');
      }
      decodedPages.push(decoded);
      capturedPages.push({ ...capture, requestUrl: nextRequestUrl });
    }
    const receiptCore = {
      ordinal: query.ordinal,
      queryId: query.queryId,
      queryDigest: query.queryDigest,
      totalResults: first.totalResults,
      accessibleResults,
      pageCount,
      responseSha256s: decodedPages.map(({ responseSha256 }) => responseSha256),
    };
    queryReceipts.push({
      ...receiptCore,
      receiptDigest: relationshipInputSha256(receiptCore),
    });
  }
  const collection = buildDvidsMilitaryExerciseReferenceCollection(
    capturedPages.map(decodeDvidsMilitaryExerciseSearchPage),
  );
  const completedAt = timestamp(params.completedAt, 'dvids_military_acquisition_time_invalid');
  const completionCore = {
    recordType: 'dvids_military_exercise_acquisition_completion' as const,
    schemaVersion: DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION,
    publication: plan.publication,
    planDigest: plan.planDigest,
    decisionPacketDigest: decisionPacket.packetDigest,
    queryCount: plan.queries.length,
    providerCallCount,
    retainedReferenceCount: collection.retainedReferenceCount,
    duplicateReferenceCount: collection.duplicateReferenceCount,
    excludedNonExerciseResults: collection.excludedNonExerciseResults,
    queryReceipts,
    collection,
    limitations: [...plan.limitations],
    completedAt,
  };
  return {
    status: 'complete',
    providerCallCount,
    completion: {
      ...completionCore,
      completionDigest: relationshipInputSha256(completionCore),
    },
  };
};

export const verifyDvidsMilitaryExerciseAcquisitionCompletion = (params: {
  plan: DvidsMilitaryExerciseAcquisitionPlan;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  completion: DvidsMilitaryExerciseAcquisitionCompletion;
}): DvidsMilitaryExerciseAcquisitionCompletion => {
  const plan = verifyDvidsMilitaryExerciseAcquisitionPlan(params.plan);
  const decisionPacket = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  const completion = params.completion;
  exactKeys(completion, [
    'recordType', 'schemaVersion', 'publication', 'planDigest',
    'decisionPacketDigest', 'queryCount', 'providerCallCount',
    'retainedReferenceCount', 'duplicateReferenceCount',
    'excludedNonExerciseResults', 'queryReceipts', 'collection', 'limitations',
    'completedAt', 'completionDigest',
  ], 'dvids_military_acquisition_completion_invalid');
  publicationBinding(completion.publication);
  for (const receipt of completion.queryReceipts) {
    exactKeys(receipt, [
      'ordinal', 'queryId', 'queryDigest', 'totalResults', 'accessibleResults',
      'pageCount', 'responseSha256s', 'receiptDigest',
    ], 'dvids_military_acquisition_completion_invalid');
  }
  const { completionDigest, ...completionCore } = completion;
  const collection = verifyDvidsMilitaryExerciseReferenceCollection(completion.collection);
  if (completion.recordType !== 'dvids_military_exercise_acquisition_completion'
    || completion.schemaVersion !== DVIDS_MILITARY_EXERCISE_ACQUISITION_VERSION
    || relationshipInputSha256(completion.publication) !== relationshipInputSha256(plan.publication)
    || completion.planDigest !== plan.planDigest
    || completion.decisionPacketDigest !== decisionPacket.packetDigest
    || completion.queryCount !== plan.queries.length
    || completion.queryReceipts.length !== plan.queries.length
    || completion.retainedReferenceCount !== collection.retainedReferenceCount
    || completion.duplicateReferenceCount !== collection.duplicateReferenceCount
    || completion.excludedNonExerciseResults !== collection.excludedNonExerciseResults
    || JSON.stringify(completion.limitations) !== JSON.stringify(plan.limitations)
    || completionDigest !== relationshipInputSha256(completionCore)) {
    fail('dvids_military_acquisition_completion_invalid');
  }
  const pageReceipts = new Map(collection.pageReceipts.map((receipt) => [
    receipt.requestUrl,
    receipt,
  ]));
  let providerCallCount = 0;
  for (const [ordinal, receipt] of completion.queryReceipts.entries()) {
    const query = plan.queries[ordinal];
    const { receiptDigest, ...receiptCore } = receipt;
    const accessibleResults = Math.min(receipt.totalResults, MAX_ACCESSIBLE_RESULTS);
    const pageCount = Math.max(1, Math.ceil(accessibleResults / MAX_RESULTS_PER_PAGE));
    if (receipt.ordinal !== ordinal
      || receipt.queryId !== query.queryId
      || receipt.queryDigest !== query.queryDigest
      || !Number.isSafeInteger(receipt.totalResults)
      || receipt.totalResults < 0
      || receipt.totalResults > MAX_ACCESSIBLE_RESULTS
      || receipt.accessibleResults !== accessibleResults
      || receipt.pageCount !== pageCount
      || receipt.responseSha256s.length !== pageCount
      || receipt.responseSha256s.some((sha256) => !SHA256.test(sha256))
      || receiptDigest !== relationshipInputSha256(receiptCore)) {
      fail('dvids_military_acquisition_completion_invalid');
    }
    for (let page = 1; page <= pageCount; page += 1) {
      const expectedUrl = pageUrl(query, page);
      const pageReceipt = pageReceipts.get(expectedUrl);
      if (!pageReceipt || pageReceipt.responseSha256 !== receipt.responseSha256s[page - 1]) {
        fail('dvids_military_acquisition_completion_page_mismatch');
      }
      pageReceipts.delete(expectedUrl);
    }
    providerCallCount += pageCount;
  }
  const completedAt = timestamp(
    completion.completedAt,
    'dvids_military_acquisition_completion_invalid',
  );
  if (pageReceipts.size
    || collection.pageCount !== providerCallCount
    || completion.providerCallCount !== providerCallCount
    || completedAt < plan.plannedAt
    || collection.pageReceipts.some(({ acquiredAt }) => (
      acquiredAt < plan.plannedAt || acquiredAt > completedAt
    ))) {
    fail('dvids_military_acquisition_completion_invalid');
  }
  return structuredClone(completion);
};

export const materializeVerifiedDvidsMilitaryExerciseAcquisition = async (
  params: {
    plan: DvidsMilitaryExerciseAcquisitionPlan;
    decisionPacket: ContextualSourceGovernanceDecisionPacket;
    completion: DvidsMilitaryExerciseAcquisitionCompletion;
    materialize?: typeof materializeAndPublishDvidsMilitaryExerciseArchive;
  } & Omit<
    Parameters<typeof materializeAndPublishDvidsMilitaryExerciseArchive>[0],
    'collection' | 'decisionPacket'
  >,
) => {
  const {
    plan,
    decisionPacket,
    completion,
    materialize = materializeAndPublishDvidsMilitaryExerciseArchive,
    ...archiveParams
  } = params;
  const verified = verifyDvidsMilitaryExerciseAcquisitionCompletion({
    plan,
    decisionPacket,
    completion,
  });
  return materialize({
    ...archiveParams,
    collection: verified.collection,
    decisionPacket,
  });
};
