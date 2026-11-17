import { createHash } from 'node:crypto';

import { buildBalloonProviderArchiveObject } from './balloonProviderArchive';
import {
  createPostgresExternalProviderArchiveAdapter,
  makeCaseGraphExternalProviderArchiveRecord,
  publishCaseGraphExternalProviderArchive,
  type CaseGraphExternalProviderArchiveQuery,
  type CaseGraphExternalProviderArchiveRecord,
  type CaseGraphExternalProviderArchiveSnapshot,
  type CaseGraphExternalProviderArchiveTransaction,
} from './providerArchiveExternalCorrelation';
import {
  createDecisionPacketGovernedExternalCorrelationProviderAdapter,
} from './externalCorrelationProviderAdapters';
import type {
  ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import {
  createPostgresCaseGraphExternalCorrelationGovernanceInspector,
  createPostgresGovernedExternalCorrelationProviderAdapter,
} from './postgresExternalCorrelation';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import { normalizeCountry, normalizeRegion } from '../utils/metadataNormalizer';

export const DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION =
  'dvids-military-exercise-reference-v1' as const;

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RESULTS_PER_PAGE = 50;
const MAX_TOTAL_RESULTS = 1_000;
const MAX_NODES = 1_000_000;
const PAGE_SIZE = 5_000;
const SHA256 = /^[a-f0-9]{64}$/u;
const ASSET_ID = /^(?:audio|graphics|image|news|publication_issue|video|webcast):[1-9]\d{0,15}$/u;
const ASSET_TYPE = /^(?:audio|graphics|image|news|publication_issue|video|webcast)$/u;
const NUMERIC_ASSET_ID = /^[1-9]\d{0,15}$/u;
const EXERCISE_LANGUAGE = /\b(?:exercise|training|drill|manoeuv(?:er|re)|war ?game|gunnery|readiness|field evaluation|combat readiness evaluation|mc?cre)\b/iu;
const fail = (code: string): never => { throw new Error(code); };

const plainObject = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
};
const exactKeys = (value: object, expected: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) fail(code);
};

const boundedText = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') {
    throw new Error(code);
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) fail(code);
  return normalized;
};

const optionalText = (value: unknown, maximum: number, code: string) => {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(code);
  return value.trim() === '' ? null : boundedText(value, maximum, code);
};

const count = (value: unknown, maximum: number, code: string) => {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) fail(code);
  return normalized;
};

const timestamp = (value: unknown, code: string) => {
  const normalized = boundedText(value, 80, code);
  if (!/(?:z|[+-]\d{2}:\d{2})$/iu.test(normalized)) fail(code);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) fail(code);
  return new Date(parsed).toISOString();
};

const assetUrl = (value: unknown, sourceRecordId: string) => {
  const normalized = boundedText(value, 2_000, 'dvids_military_reference_url_invalid');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return fail('dvids_military_reference_url_invalid');
  }
  const numericId = sourceRecordId.split(':')[1];
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.dvidshub.net'
    || !parsed.pathname.split('/').includes(numericId)) {
    fail('dvids_military_reference_url_invalid');
  }
  parsed.hash = '';
  return parsed.toString();
};

const sourceRecordIdentity = (raw: Record<string, unknown>) => {
  const rawId = boundedText(raw.id, 80, 'dvids_military_reference_invalid').toLowerCase();
  if (ASSET_ID.test(rawId)) return rawId;
  const assetType = optionalText(raw.type, 40, 'dvids_military_reference_invalid')?.toLowerCase();
  if (!NUMERIC_ASSET_ID.test(rawId) || !assetType || !ASSET_TYPE.test(assetType)) {
    fail('dvids_military_reference_invalid');
  }
  return `${assetType}:${rawId}`;
};

const searchUrl = (value: unknown) => {
  const normalized = boundedText(value, 4_000, 'dvids_military_reference_request_url_invalid');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return fail('dvids_military_reference_request_url_invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.dvidshub.net'
    || parsed.pathname.replace(/\/+$/u, '') !== '/search'
    || parsed.username || parsed.password || parsed.hash) {
    fail('dvids_military_reference_request_url_invalid');
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (['api_key', 'apikey'].includes(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  return parsed.toString();
};

const normalizeMatchText = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const containsPhrase = (haystack: string, needle: string) => (
  Boolean(needle) && ` ${haystack} `.includes(` ${needle} `)
);
const compareText = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);

export type DvidsMilitaryExerciseReference = {
  sourceRecordId: string;
  label: string;
  occurredAt: string;
  publishedAt: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  unitName: string | null;
  branch: string | null;
  assetType: string;
  url: string;
  shortDescription: string | null;
  keywords: string | null;
};

export type DvidsMilitaryExerciseSearchPage = {
  recordType: 'dvids_military_exercise_search_page';
  schemaVersion: typeof DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION;
  acquiredAt: string;
  requestUrl: string;
  responseSha256: string;
  responseBytes: number;
  totalResults: number;
  resultsPerPage: number;
  retainedResults: DvidsMilitaryExerciseReference[];
  excludedNonExerciseResults: number;
};

export type DvidsMilitaryExerciseCapturedSearchPage = {
  body: Buffer | string;
  acquiredAt: string;
  requestUrl: string;
};

const decodeReference = (value: unknown): DvidsMilitaryExerciseReference | null => {
  const raw = plainObject(value, 'dvids_military_reference_invalid');
  const sourceRecordId = sourceRecordIdentity(raw);
  const label = boundedText(raw.title, 500, 'dvids_military_reference_invalid');
  const shortDescription = optionalText(raw.short_description, 2_000, 'dvids_military_reference_invalid');
  const keywords = optionalText(raw.keywords, 2_000, 'dvids_military_reference_invalid');
  const searchable = `${label} ${shortDescription || ''} ${keywords || ''}`;
  const reference: DvidsMilitaryExerciseReference = {
    sourceRecordId,
    label,
    occurredAt: timestamp(raw.date, 'dvids_military_reference_invalid'),
    publishedAt: raw.date_published == null
      ? raw.publishdate == null ? null : timestamp(raw.publishdate, 'dvids_military_reference_invalid')
      : timestamp(raw.date_published, 'dvids_military_reference_invalid'),
    city: optionalText(raw.city, 200, 'dvids_military_reference_invalid'),
    region: optionalText(raw.state, 200, 'dvids_military_reference_invalid'),
    country: optionalText(raw.country, 200, 'dvids_military_reference_invalid'),
    unitName: optionalText(raw.unit_name, 300, 'dvids_military_reference_invalid'),
    branch: optionalText(raw.branch, 120, 'dvids_military_reference_invalid'),
    assetType: sourceRecordId.split(':')[0],
    url: assetUrl(raw.url, sourceRecordId),
    shortDescription,
    keywords,
  };
  return EXERCISE_LANGUAGE.test(searchable) ? reference : null;
};

export const decodeDvidsMilitaryExerciseSearchPage = (
  params: DvidsMilitaryExerciseCapturedSearchPage,
): DvidsMilitaryExerciseSearchPage => {
  const body = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body, 'utf8');
  if (!body.length || body.length > MAX_RESPONSE_BYTES) fail('dvids_military_reference_response_size_invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return fail('dvids_military_reference_response_invalid');
  }
  const raw = plainObject(parsed, 'dvids_military_reference_response_invalid');
  const pageInfo = plainObject(raw.page_info, 'dvids_military_reference_response_invalid');
  const results = raw.results;
  if (!Array.isArray(results) || results.length > MAX_RESULTS_PER_PAGE) {
    throw new Error('dvids_military_reference_response_invalid');
  }
  const totalResults = count(pageInfo.total_results, MAX_TOTAL_RESULTS, 'dvids_military_reference_response_invalid');
  const resultsPerPage = count(pageInfo.results_per_page, MAX_RESULTS_PER_PAGE, 'dvids_military_reference_response_invalid');
  if (resultsPerPage < 1 || results.length > resultsPerPage || totalResults < results.length) {
    fail('dvids_military_reference_response_invalid');
  }
  const sourceRecordIds = results.map((value) => {
    const result = plainObject(value, 'dvids_military_reference_invalid');
    return sourceRecordIdentity(result);
  });
  if (new Set(sourceRecordIds).size !== sourceRecordIds.length) {
    fail('dvids_military_reference_duplicate_result');
  }
  const decoded = results.map(decodeReference);
  const retainedResults = decoded.filter((value): value is DvidsMilitaryExerciseReference => Boolean(value));
  return {
    recordType: 'dvids_military_exercise_search_page',
    schemaVersion: DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION,
    acquiredAt: timestamp(params.acquiredAt, 'dvids_military_reference_response_invalid'),
    requestUrl: searchUrl(params.requestUrl),
    responseSha256: createHash('sha256').update(body).digest('hex'),
    responseBytes: body.length,
    totalResults,
    resultsPerPage,
    retainedResults,
    excludedNonExerciseResults: decoded.length - retainedResults.length,
  };
};

export type DvidsMilitaryExerciseReferenceCollection = {
  recordType: 'dvids_military_exercise_reference_collection';
  schemaVersion: typeof DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION;
  pageCount: number;
  retainedReferenceCount: number;
  duplicateReferenceCount: number;
  excludedNonExerciseResults: number;
  pageReceipts: Array<{
    requestUrl: string;
    responseSha256: string;
    responseBytes: number;
    acquiredAt: string;
  }>;
  references: DvidsMilitaryExerciseReference[];
  collectionSha256: string;
};

export const buildDvidsMilitaryExerciseReferenceCollection = (
  pages: readonly DvidsMilitaryExerciseSearchPage[],
): DvidsMilitaryExerciseReferenceCollection => {
  if (!pages.length || pages.length > 1_000
    || pages.some((page) => (
      page.recordType !== 'dvids_military_exercise_search_page'
      || page.schemaVersion !== DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION
      || !SHA256.test(page.responseSha256)
      || !Number.isSafeInteger(page.responseBytes)
      || page.responseBytes < 1
      || page.responseBytes > MAX_RESPONSE_BYTES
      || page.requestUrl !== searchUrl(page.requestUrl)
      || page.acquiredAt !== timestamp(page.acquiredAt, 'dvids_military_reference_collection_invalid')
    ))) {
    fail('dvids_military_reference_collection_invalid');
  }
  const orderedPages = [...pages].sort((left, right) => (
    compareText(left.requestUrl, right.requestUrl)
    || compareText(left.responseSha256, right.responseSha256)
  ));
  if (new Set(orderedPages.map(({ requestUrl }) => requestUrl)).size !== orderedPages.length) {
    fail('dvids_military_reference_collection_duplicate_page');
  }
  const allReferences = orderedPages.flatMap(({ retainedResults }) => retainedResults)
    .sort((left, right) => compareText(left.sourceRecordId, right.sourceRecordId));
  const referencesById = new Map<string, DvidsMilitaryExerciseReference>();
  for (const reference of allReferences) {
    const previous = referencesById.get(reference.sourceRecordId);
    if (previous && relationshipInputSha256(previous) !== relationshipInputSha256(reference)) {
      fail('dvids_military_reference_conflicting_result');
    }
    referencesById.set(reference.sourceRecordId, reference);
  }
  const references = [...referencesById.values()];
  const pageReceipts = orderedPages.map((page) => ({
    requestUrl: page.requestUrl,
    responseSha256: page.responseSha256,
    responseBytes: page.responseBytes,
    acquiredAt: page.acquiredAt,
  }));
  const core = {
    recordType: 'dvids_military_exercise_reference_collection' as const,
    schemaVersion: DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION,
    pageCount: orderedPages.length,
    retainedReferenceCount: references.length,
    duplicateReferenceCount: allReferences.length - references.length,
    excludedNonExerciseResults: orderedPages.reduce(
      (sum, page) => sum + page.excludedNonExerciseResults,
      0,
    ),
    pageReceipts,
    references,
  };
  return { ...core, collectionSha256: relationshipInputSha256(core) };
};

export const verifyDvidsMilitaryExerciseReferenceCollection = (
  value: DvidsMilitaryExerciseReferenceCollection,
): DvidsMilitaryExerciseReferenceCollection => {
  exactKeys(value, [
    'recordType', 'schemaVersion', 'pageCount', 'retainedReferenceCount',
    'duplicateReferenceCount', 'excludedNonExerciseResults', 'pageReceipts',
    'references', 'collectionSha256',
  ], 'dvids_military_reference_collection_invalid');
  const { collectionSha256, ...core } = value;
  if (value.recordType !== 'dvids_military_exercise_reference_collection'
    || value.schemaVersion !== DVIDS_MILITARY_EXERCISE_REFERENCE_VERSION
    || !Number.isSafeInteger(value.pageCount) || value.pageCount < 1
    || value.pageCount !== value.pageReceipts.length
    || !Number.isSafeInteger(value.retainedReferenceCount)
    || value.retainedReferenceCount !== value.references.length
    || !Number.isSafeInteger(value.duplicateReferenceCount) || value.duplicateReferenceCount < 0
    || !Number.isSafeInteger(value.excludedNonExerciseResults)
    || value.excludedNonExerciseResults < 0
    || new Set(value.pageReceipts.map(({ requestUrl }) => requestUrl)).size !== value.pageCount
    || new Set(value.references.map(({ sourceRecordId }) => sourceRecordId)).size !== value.references.length
    || collectionSha256 !== relationshipInputSha256(core)) {
    fail('dvids_military_reference_collection_invalid');
  }
  for (const receipt of value.pageReceipts) {
    exactKeys(receipt, [
      'requestUrl', 'responseSha256', 'responseBytes', 'acquiredAt',
    ], 'dvids_military_reference_collection_invalid');
    if (receipt.requestUrl !== searchUrl(receipt.requestUrl)
      || !SHA256.test(receipt.responseSha256)
      || !Number.isSafeInteger(receipt.responseBytes)
      || receipt.responseBytes < 1
      || receipt.responseBytes > MAX_RESPONSE_BYTES
      || receipt.acquiredAt !== timestamp(
        receipt.acquiredAt,
        'dvids_military_reference_collection_invalid',
      )) {
      fail('dvids_military_reference_collection_invalid');
    }
  }
  for (const reference of value.references) {
    exactKeys(reference, [
      'sourceRecordId', 'label', 'occurredAt', 'publishedAt', 'city', 'region',
      'country', 'unitName', 'branch', 'assetType', 'url', 'shortDescription',
      'keywords',
    ], 'dvids_military_reference_collection_invalid');
    if (!ASSET_ID.test(reference.sourceRecordId)
      || reference.label !== boundedText(
        reference.label,
        500,
        'dvids_military_reference_collection_invalid',
      )
      || reference.occurredAt !== timestamp(
        reference.occurredAt,
        'dvids_military_reference_collection_invalid',
      )
      || reference.publishedAt != null && reference.publishedAt !== timestamp(
        reference.publishedAt,
        'dvids_military_reference_collection_invalid',
      )
      || reference.city !== optionalText(reference.city, 200, 'dvids_military_reference_collection_invalid')
      || reference.region !== optionalText(reference.region, 200, 'dvids_military_reference_collection_invalid')
      || reference.country !== optionalText(reference.country, 200, 'dvids_military_reference_collection_invalid')
      || reference.unitName !== optionalText(reference.unitName, 300, 'dvids_military_reference_collection_invalid')
      || reference.branch !== optionalText(reference.branch, 120, 'dvids_military_reference_collection_invalid')
      || reference.shortDescription !== optionalText(
        reference.shortDescription,
        2_000,
        'dvids_military_reference_collection_invalid',
      )
      || reference.keywords !== optionalText(
        reference.keywords,
        2_000,
        'dvids_military_reference_collection_invalid',
      )
      || reference.url !== assetUrl(reference.url, reference.sourceRecordId)
      || reference.assetType !== reference.sourceRecordId.split(':')[0]) {
      fail('dvids_military_reference_collection_invalid');
    }
  }
  return structuredClone(value);
};

export type DvidsMilitaryExercisePublicationSighting = {
  address: string;
  nodeDigest: string;
  eventTimestamp: string | null;
  locationLabel: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
};

export const loadPublicationSightingsForDvidsCorrelation = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  run: CaseGraphExternalProviderArchiveQuery;
  signal?: AbortSignal;
}): Promise<DvidsMilitaryExercisePublicationSighting[]> => {
  const nodes: DvidsMilitaryExercisePublicationSighting[] = [];
  let cursor = '';
  for (;;) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const result = await params.run(
      `/* external-provider-archive:dvids-sighting-page */
       SELECT node.address, node.node_digest, sighting.event_timestamp,
              NULLIF(BTRIM(sighting.city), '') AS city,
              NULLIF(BTRIM(sighting.region), '') AS region,
              NULLIF(BTRIM(sighting.country), '') AS country,
              COALESCE(NULLIF(BTRIM(sighting.location_normalized), ''),
                       NULLIF(BTRIM(sighting.location), ''),
                       NULLIF(BTRIM(sighting.location_raw), ''),
                       NULLIF(CONCAT_WS(', ', sighting.city, sighting.region, sighting.country), '')) AS location_label
       FROM public.case_graph_research_search_publication_nodes node
       JOIN public.uap_sightings sighting ON node.address = 'sighting:' || sighting.id::text
       WHERE node.publication_id = $1::uuid AND node.address COLLATE "C" > $2
       ORDER BY node.address COLLATE "C" LIMIT $3`,
      [params.publication.publicationId, cursor, PAGE_SIZE],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      nodes.push({
        address: boundedText(row.address, 250, 'dvids_military_reference_node_invalid'),
        nodeDigest: boundedText(row.node_digest, 64, 'dvids_military_reference_node_invalid'),
        eventTimestamp: row.event_timestamp == null
          ? null
          : timestamp(row.event_timestamp, 'dvids_military_reference_node_invalid'),
        locationLabel: row.location_label == null
          ? null
          : optionalText(row.location_label, 500, 'dvids_military_reference_node_invalid'),
        city: optionalText(row.city, 200, 'dvids_military_reference_node_invalid'),
        region: optionalText(row.region, 200, 'dvids_military_reference_node_invalid'),
        country: optionalText(row.country, 200, 'dvids_military_reference_node_invalid'),
      });
      if (!SHA256.test(nodes[nodes.length - 1].nodeDigest) || nodes.length > MAX_NODES) {
        fail('dvids_military_reference_node_invalid');
      }
    }
    cursor = nodes[nodes.length - 1].address;
    if (result.rows.length < PAGE_SIZE) break;
  }
  return nodes;
};

const localityMatches = (locationLabel: string, reference: DvidsMilitaryExerciseReference) => {
  if (!reference.city) return false;
  const location = normalizeMatchText(locationLabel);
  const city = normalizeMatchText(reference.city);
  if (!containsPhrase(location, city)) return false;
  const country = normalizeCountry(reference.country, null);
  const region = normalizeRegion(reference.region, country.country_code);
  if (reference.region) {
    const rawRegion = normalizeMatchText(reference.region);
    const normalizedRegion = normalizeMatchText(region);
    return containsPhrase(location, rawRegion) || containsPhrase(location, normalizedRegion);
  }
  if (reference.country) {
    return containsPhrase(location, normalizeMatchText(reference.country))
      || containsPhrase(location, normalizeMatchText(country.country_code));
  }
  return city.length >= 8;
};

export const buildDvidsMilitaryExerciseArchiveRecords = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  nodes: DvidsMilitaryExercisePublicationSighting[];
  references: DvidsMilitaryExerciseReference[];
  maxTimeDeltaDays: number;
  limitPerAddress: number;
}): CaseGraphExternalProviderArchiveRecord[] => {
  if (!params.nodes.length || params.nodes.length > MAX_NODES
    || !Number.isSafeInteger(params.maxTimeDeltaDays) || params.maxTimeDeltaDays < 1
    || params.maxTimeDeltaDays > 366 || !Number.isSafeInteger(params.limitPerAddress)
    || params.limitPerAddress < 1 || params.limitPerAddress > 20) {
    fail('dvids_military_reference_plan_invalid');
  }
  if (new Set(params.references.map(({ sourceRecordId }) => sourceRecordId)).size !== params.references.length) {
    fail('dvids_military_reference_duplicate_result');
  }
  const references = [...params.references].sort((left, right) => (
    compareText(left.occurredAt, right.occurredAt)
    || compareText(left.sourceRecordId, right.sourceRecordId)
  ));
  const maxDeltaMs = params.maxTimeDeltaDays * 86_400_000;
  return [...params.nodes].sort((left, right) => compareText(left.address, right.address)).map((node) => {
    if (!node.eventTimestamp || !node.locationLabel) {
      return makeCaseGraphExternalProviderArchiveRecord({
        snapshotId: params.snapshotId,
        publicationId: params.publication.publicationId,
        address: node.address,
        nodeDigest: node.nodeDigest,
        availability: 'insufficient_evidence',
        reasonCodes: ['sighting_time_or_named_location_missing'],
        explanation: 'The DVIDS reference snapshot was available, but this sighting lacks a usable event time or named location for bounded comparison.',
        candidates: [],
      });
    }
    const nodeMs = Date.parse(node.eventTimestamp);
    const candidates = references.flatMap((reference) => {
      const deltaMs = Math.abs(Date.parse(reference.occurredAt) - nodeMs);
      if (deltaMs > maxDeltaMs || !localityMatches(node.locationLabel!, reference)) return [];
      return [{ reference, deltaDays: deltaMs / 86_400_000 }];
    }).sort((left, right) => (
      left.deltaDays - right.deltaDays
      || compareText(left.reference.sourceRecordId, right.reference.sourceRecordId)
    ));
    const retained = candidates.slice(0, params.limitPerAddress);
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId,
      publicationId: params.publication.publicationId,
      address: node.address,
      nodeDigest: node.nodeDigest,
      availability: 'available',
      reasonCodes: [
        ...(candidates.length > retained.length ? ['candidate_limit_applied'] : []),
        retained.length
          ? 'dvids_named_locality_time_reference_available'
          : 'dvids_bounded_reference_search_no_candidate',
      ],
      explanation: retained.length
        ? `${retained.length} DVIDS exercise or training media reference${retained.length === 1 ? '' : 's'} retained within the configured named-locality and time bounds. A media reference is context, not an exercise schedule or identification.`
        : 'The bounded DVIDS reference snapshot contained no exercise or training media candidate at the same named locality and time window. DVIDS coverage is incomplete, so military activity is not ruled out.',
      candidates: retained.map(({ reference, deltaDays }) => ({
        sourceRecordId: reference.sourceRecordId,
        label: reference.label,
        observedAt: reference.occurredAt,
        measurements: {
          time_delta_days: Number(deltaDays.toFixed(3)),
          locality_match: 'named_city_and_region',
          city: reference.city,
          region: reference.region,
          country: reference.country,
          unit_name: reference.unitName,
          branch: reference.branch,
          asset_type: reference.assetType,
          published_at: reference.publishedAt,
          source_url: reference.url,
        },
        reasonCodes: [
          'bounded_time_match',
          'dvids_official_media_reference',
          'exercise_language_match',
          'named_locality_match',
        ],
        explanation: `${reference.shortDescription || reference.label} The DVIDS item is ${deltaDays.toFixed(1)} days from the report and shares the named locality; this is contextual media, not proof of the reported object's identity.`,
        uncertainty: [
          'DVIDS is an official media and announcement surface, not a complete military-exercise schedule.',
          'Absence of a DVIDS item cannot rule out an exercise, training activity or restricted operation.',
          'Named-locality and time proximity do not establish that the media item and sighting describe the same activity.',
          'Item-level rights, attribution, privacy, publicity, trademark and non-endorsement conditions still require review.',
        ],
      })),
    });
  });
};

export const materializeAndPublishDvidsMilitaryExerciseArchive = async (params: {
  snapshot: Omit<CaseGraphExternalProviderArchiveSnapshot, 'archiveObjectKey' | 'archiveObjectSha256' | 'archiveObjectBytes'>;
  collection: DvidsMilitaryExerciseReferenceCollection;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  run: CaseGraphExternalProviderArchiveQuery;
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: (params: { key: string; body: Buffer; sha256: string; signal?: AbortSignal }) => Promise<void>;
  verifyArchiveObject: Parameters<typeof publishCaseGraphExternalProviderArchive>[0]['verifyArchiveObject'];
  maxTimeDeltaDays: number;
  limitPerAddress: number;
  signal?: AbortSignal;
}) => {
  if (params.snapshot.category !== 'military_exercise'
    || params.snapshot.canonicalSource !== 'DVIDS'
    || params.snapshot.providerId !== 'dvids-exercise-reference'
    || params.snapshot.contentMode !== 'metadata_only') {
    fail('dvids_military_reference_plan_invalid');
  }
  const collection = verifyDvidsMilitaryExerciseReferenceCollection(params.collection);
  if (params.snapshot.datasetVersion !== `dvids-search:${collection.collectionSha256}`) {
    fail('dvids_military_reference_dataset_version_mismatch');
  }
  let authorized = false;
  const gate = createDecisionPacketGovernedExternalCorrelationProviderAdapter({
    category: 'military_exercise',
    canonicalSource: 'DVIDS',
    providerId: 'dvids-exercise-reference',
    requiredContentMode: 'metadata_only',
    decisionPacket: params.decisionPacket,
    inspectGovernance: createPostgresCaseGraphExternalCorrelationGovernanceInspector(params.run),
    correlate: async () => {
      authorized = true;
      return {
        availability: 'available',
        reasonCodes: ['dvids_archive_materialization_authorized'],
        explanation: 'The exact source decision and live legal registry approve this archive materialization.',
        source: null,
        candidates: [],
      };
    },
  });
  const gateResult = await gate.correlate({
    publication: params.snapshot.publication,
    address: 'governance:dvids-military-exercise-materialization',
    nodeDigest: collection.collectionSha256,
    limit: 1,
    checkedAt: params.snapshot.acquiredAt,
    signal: params.signal,
  });
  if (!authorized) {
    fail(`dvids_military_reference_${gateResult.reasonCodes[0] || 'governance_not_approved'}`);
  }
  const nodes = await loadPublicationSightingsForDvidsCorrelation({
    publication: params.snapshot.publication,
    run: params.run,
    signal: params.signal,
  });
  if (!nodes.length) fail('dvids_military_reference_publication_empty');
  const records = buildDvidsMilitaryExerciseArchiveRecords({
    publication: params.snapshot.publication,
    snapshotId: params.snapshot.snapshotId,
    nodes,
    references: collection.references,
    maxTimeDeltaDays: params.maxTimeDeltaDays,
    limitPerAddress: params.limitPerAddress,
  });
  const archive = buildBalloonProviderArchiveObject(records);
  const key = `case-vortex/external-providers/military-exercise/${archive.sha256}.ndjson.gz`;
  await params.putArchiveObject({
    key,
    body: archive.body,
    sha256: archive.sha256,
    signal: params.signal,
  });
  return publishCaseGraphExternalProviderArchive({
    snapshot: {
      ...params.snapshot,
      archiveObjectKey: key,
      archiveObjectSha256: archive.sha256,
      archiveObjectBytes: archive.bytes,
    },
    records,
    transaction: params.transaction,
    verifyArchiveObject: params.verifyArchiveObject,
    signal: params.signal,
  });
};

export const createGovernedDvidsMilitaryExerciseExternalCorrelationAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  run: CaseGraphExternalProviderArchiveQuery;
}) => {
  const archiveAdapter = createPostgresExternalProviderArchiveAdapter({
    publication: params.publication,
    snapshotId: params.snapshotId,
    category: 'military_exercise',
    run: params.run,
  });
  return createPostgresGovernedExternalCorrelationProviderAdapter({
    category: 'military_exercise',
    canonicalSource: 'DVIDS',
    providerId: 'dvids-exercise-reference',
    allowedContentModes: ['metadata_only'],
    correlate: archiveAdapter.correlate,
    run: params.run,
  });
};
