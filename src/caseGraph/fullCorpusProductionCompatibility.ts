import { createHash } from 'node:crypto';

import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  evidenceUniverseAddress,
  type EvidenceUniverseNode,
} from './evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from './evidenceUniverseArchive';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  CASE_GRAPH_SOURCE_REGISTRY_VERSION,
  resolveCaseGraphSource,
} from './sourceRegistry';

export const FULL_CORPUS_PRODUCTION_COMPATIBILITY_VERSION =
  'full-corpus-production-compatibility-v1' as const;
export const FULL_CORPUS_PRODUCTION_COMPATIBILITY_ARCHIVE_VERSION =
  'full-corpus-production-compatibility-archive-v1' as const;
export const FULL_CORPUS_SEARCH_PROJECTION_VERSION =
  'case-graph-research-search-postgres-v1' as const;
export const FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION =
  'postgres-timestamptz-canonical-utc-0001-9999-fraction-3-6-v1' as const;
const FULL_CORPUS_SEARCH_TOKENIZER_PREFIX = 'unicode-nfkd-simple-tsvector+' as const;
export const FULL_CORPUS_SEARCH_TOKENIZER_VERSION =
  `${FULL_CORPUS_SEARCH_TOKENIZER_PREFIX}${CASE_GRAPH_SOURCE_REGISTRY_VERSION}+printable-ascii-address-v2+${FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION}` as const;

// These are the PostgreSQL document-column constraints. The tokenizer version
// above binds normalization, address and timestamp semantics into one build
// fence instead of relying on a migration filename.
export const FULL_CORPUS_SEARCH_POSTGRES_LIMITS = Object.freeze({
  addressUtf8Bytes: 1_024,
  sourceKeyUtf8Bytes: 240,
  sourceNormUtf8Bytes: 4_096,
  addressNormUtf8Bytes: 2_048,
  titleNormUtf8Bytes: 16_384,
  locationNormUtf8Bytes: 8_192,
  summaryNormUtf8Bytes: 262_144,
  eventTimestampNormUtf8Bytes: 128,
  queryableTokenCharacters: 96,
  postgresLexemeUtf8Bytes: 2_047,
} as const);

export type FullCorpusProductionCompatibilityCounters = {
  totalNodesChecked: number;
  nonAsciiAddressCount: number;
  nulAddressCount: number;
  controlAddressCount: number;
  whitespaceAddressCount: number;
  nonPrintableAddressCount: number;
  nonCanonicalAddressCount: number;
  overlongAddressCount: number;
  addressOver240Utf8BytesCount: number;
  invalidSourceKeyCount: number;
  nonAsciiSourceKeyCount: number;
  whitespaceSourceKeyCount: number;
  overlongSourceKeyCount: number;
  unknownSourceCount: number;
  unknownSourceKeyCollisionCount: number;
  unknownSourceAliasCollisionCount: number;
  sourceNormOverLimitCount: number;
  addressNormEmptyCount: number;
  addressNormOverLimitCount: number;
  titleNormOverLimitCount: number;
  locationNormOverLimitCount: number;
  summaryNormOverLimitCount: number;
  eventTimestampNormOverLimitCount: number;
  eventTimestampNullMismatchCount: number;
  invalidEventTimestampCount: number;
  normalizedTokenOver96CharactersCount: number;
  normalizedTokenOver2047Utf8BytesCount: number;
};

export type FullCorpusProductionCompatibilityMaxUtf8Bytes = {
  address: number;
  title: number;
  summary: number;
  sourceKey: number;
  canonicalUrl: number;
  sourceNorm: number;
  addressNorm: number;
  titleNorm: number;
  locationNorm: number;
  summaryNorm: number;
  eventTimestampNorm: number;
  normalizedToken: number;
};

export type FullCorpusProductionCompatibilityReceipt = {
  recordType: 'full_corpus_production_compatibility_receipt';
  schemaVersion: typeof FULL_CORPUS_PRODUCTION_COMPATIBILITY_VERSION;
  corpusVersion: string;
  orchestrationRequest: {
    schemaVersion: string;
    requestDigest: string;
  };
  universe: RelationshipInputUniverseBinding;
  searchContract: {
    projectionVersion: typeof FULL_CORPUS_SEARCH_PROJECTION_VERSION;
    tokenizerVersion: typeof FULL_CORPUS_SEARCH_TOKENIZER_VERSION;
    eventTimestampVersion: typeof FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION;
    sourceRegistryVersion: typeof CASE_GRAPH_SOURCE_REGISTRY_VERSION;
    postgresLimits: typeof FULL_CORPUS_SEARCH_POSTGRES_LIMITS;
  };
  counters: FullCorpusProductionCompatibilityCounters;
  maxUtf8Bytes: FullCorpusProductionCompatibilityMaxUtf8Bytes;
  maxNormalizedTokenCharacters: number;
  unknownSourceKeys: string[];
  unknownSourceKeySetSha256: string;
  unknownSourceMappingSha256: string;
  compatible: boolean;
  receiptDigest: string;
};

export type FullCorpusProductionCompatibilityPointer = {
  recordType: 'full_corpus_production_compatibility_pointer';
  schemaVersion: typeof FULL_CORPUS_PRODUCTION_COMPATIBILITY_ARCHIVE_VERSION;
  corpusVersion: string;
  snapshotId: string;
  orchestrationRequestSchemaVersion: string;
  orchestrationRequestDigest: string;
  archiveKey: string;
  receiptDigest: string;
  bodySha256: string;
  bodyBytes: number;
};

type MutableCompatibility = {
  counters: FullCorpusProductionCompatibilityCounters;
  maxUtf8Bytes: FullCorpusProductionCompatibilityMaxUtf8Bytes;
  maxNormalizedTokenCharacters: number;
  unknownSources: Map<string, Set<string>>;
};

const SOURCE_KEY = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const PRINTABLE_ASCII_ADDRESS = /^[\x21-\x7e]+$/;
const NON_ASCII = /[^\x00-\x7f]/;
const CONTROL = /[\x00-\x1f\x7f]/;
const WHITESPACE = /\s/u;
// PostgreSQL timestamptz stores microseconds. Refuse 7-9 fractional digits
// instead of allowing PostgreSQL to round them, which can change an instant
// and can roll the maximum year into 10000.
const PRECISE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3,6})Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);
const hasExactKeys = (value: unknown, expected: readonly string[]) => {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
};
const isSafeCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

const utf8Bytes = (value: string | null) => Buffer.byteLength(value || '', 'utf8');
const increment = <K extends keyof FullCorpusProductionCompatibilityCounters>(
  counters: FullCorpusProductionCompatibilityCounters,
  key: K,
  condition = true,
) => {
  if (condition) counters[key] += 1;
};
const recordMaximum = <K extends keyof FullCorpusProductionCompatibilityMaxUtf8Bytes>(
  maxima: FullCorpusProductionCompatibilityMaxUtf8Bytes,
  key: K,
  value: string | null,
) => {
  maxima[key] = Math.max(maxima[key], utf8Bytes(value));
};

export const normalizeFullCorpusSearchText = (value: string | null) => (
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
);

export const isFullCorpusSearchPostgresCanonicalEventTimestamp = (value: string) => {
  const match = value.match(PRECISE_TIMESTAMP);
  if (!match || match[1].startsWith('0000-')) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return canonical.slice(0, -5) === match[1]
    && canonical.slice(-4, -1) === match[2].slice(0, 3);
};

const canonicalAddress = (node: EvidenceUniverseNode) => {
  try {
    return evidenceUniverseAddress(node.kind, node.recordId) === node.address;
  } catch {
    return false;
  }
};

const emptyCounters = (): FullCorpusProductionCompatibilityCounters => ({
  totalNodesChecked: 0,
  nonAsciiAddressCount: 0,
  nulAddressCount: 0,
  controlAddressCount: 0,
  whitespaceAddressCount: 0,
  nonPrintableAddressCount: 0,
  nonCanonicalAddressCount: 0,
  overlongAddressCount: 0,
  addressOver240Utf8BytesCount: 0,
  invalidSourceKeyCount: 0,
  nonAsciiSourceKeyCount: 0,
  whitespaceSourceKeyCount: 0,
  overlongSourceKeyCount: 0,
  unknownSourceCount: 0,
  unknownSourceKeyCollisionCount: 0,
  unknownSourceAliasCollisionCount: 0,
  sourceNormOverLimitCount: 0,
  addressNormEmptyCount: 0,
  addressNormOverLimitCount: 0,
  titleNormOverLimitCount: 0,
  locationNormOverLimitCount: 0,
  summaryNormOverLimitCount: 0,
  eventTimestampNormOverLimitCount: 0,
  eventTimestampNullMismatchCount: 0,
  invalidEventTimestampCount: 0,
  normalizedTokenOver96CharactersCount: 0,
  normalizedTokenOver2047Utf8BytesCount: 0,
});

const emptyMaxima = (): FullCorpusProductionCompatibilityMaxUtf8Bytes => ({
  address: 0,
  title: 0,
  summary: 0,
  sourceKey: 0,
  canonicalUrl: 0,
  sourceNorm: 0,
  addressNorm: 0,
  titleNorm: 0,
  locationNorm: 0,
  summaryNorm: 0,
  eventTimestampNorm: 0,
  normalizedToken: 0,
});

const addNode = (state: MutableCompatibility, node: EvidenceUniverseNode) => {
  const source = resolveCaseGraphSource(node.source);
  const sourceKey = source.id;
  const addressBytes = utf8Bytes(node.address);
  const sourceKeyBytes = utf8Bytes(sourceKey);
  const sourceNorm = normalizeFullCorpusSearchText(node.source);
  const addressNorm = normalizeFullCorpusSearchText(node.address);
  const titleNorm = normalizeFullCorpusSearchText(node.title);
  const locationNorm = normalizeFullCorpusSearchText(node.location);
  const summaryNorm = normalizeFullCorpusSearchText(node.summary);
  const eventTimestampNorm = normalizeFullCorpusSearchText(node.eventTimestamp);

  state.counters.totalNodesChecked += 1;
  increment(state.counters, 'nonAsciiAddressCount', NON_ASCII.test(node.address));
  increment(state.counters, 'nulAddressCount', node.address.includes('\0'));
  increment(state.counters, 'controlAddressCount', CONTROL.test(node.address));
  increment(state.counters, 'whitespaceAddressCount', WHITESPACE.test(node.address));
  increment(state.counters, 'nonPrintableAddressCount', !PRINTABLE_ASCII_ADDRESS.test(node.address));
  increment(state.counters, 'nonCanonicalAddressCount', !canonicalAddress(node));
  increment(state.counters, 'overlongAddressCount', addressBytes > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.addressUtf8Bytes);
  increment(state.counters, 'addressOver240Utf8BytesCount', addressBytes > 240);
  increment(state.counters, 'invalidSourceKeyCount', !SOURCE_KEY.test(sourceKey));
  increment(state.counters, 'nonAsciiSourceKeyCount', NON_ASCII.test(sourceKey));
  increment(state.counters, 'whitespaceSourceKeyCount', WHITESPACE.test(sourceKey));
  increment(state.counters, 'overlongSourceKeyCount', sourceKeyBytes > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.sourceKeyUtf8Bytes);

  if (source.family === 'unknown') {
    state.counters.unknownSourceCount += 1;
    const rawSources = state.unknownSources.get(sourceKey) || new Set<string>();
    rawSources.add(node.source);
    state.unknownSources.set(sourceKey, rawSources);
  }

  increment(state.counters, 'sourceNormOverLimitCount',
    utf8Bytes(sourceNorm) > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.sourceNormUtf8Bytes);
  increment(state.counters, 'addressNormEmptyCount', !addressNorm.length);
  increment(state.counters, 'addressNormOverLimitCount',
    utf8Bytes(addressNorm) > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.addressNormUtf8Bytes);
  increment(state.counters, 'titleNormOverLimitCount',
    utf8Bytes(titleNorm) > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.titleNormUtf8Bytes);
  increment(state.counters, 'locationNormOverLimitCount',
    utf8Bytes(locationNorm) > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.locationNormUtf8Bytes);
  increment(state.counters, 'summaryNormOverLimitCount',
    utf8Bytes(summaryNorm) > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.summaryNormUtf8Bytes);
  increment(state.counters, 'eventTimestampNormOverLimitCount',
    utf8Bytes(eventTimestampNorm) > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.eventTimestampNormUtf8Bytes);
  increment(state.counters, 'eventTimestampNullMismatchCount',
    (node.eventTimestamp === null) !== (eventTimestampNorm === ''));
  increment(state.counters, 'invalidEventTimestampCount',
    node.eventTimestamp !== null
      && !isFullCorpusSearchPostgresCanonicalEventTimestamp(node.eventTimestamp));

  recordMaximum(state.maxUtf8Bytes, 'address', node.address);
  recordMaximum(state.maxUtf8Bytes, 'title', node.title);
  recordMaximum(state.maxUtf8Bytes, 'summary', node.summary);
  recordMaximum(state.maxUtf8Bytes, 'sourceKey', sourceKey);
  recordMaximum(state.maxUtf8Bytes, 'canonicalUrl', node.canonicalUrl);
  recordMaximum(state.maxUtf8Bytes, 'sourceNorm', sourceNorm);
  recordMaximum(state.maxUtf8Bytes, 'addressNorm', addressNorm);
  recordMaximum(state.maxUtf8Bytes, 'titleNorm', titleNorm);
  recordMaximum(state.maxUtf8Bytes, 'locationNorm', locationNorm);
  recordMaximum(state.maxUtf8Bytes, 'summaryNorm', summaryNorm);
  recordMaximum(state.maxUtf8Bytes, 'eventTimestampNorm', eventTimestampNorm);

  for (const normalized of [sourceNorm, addressNorm, titleNorm, locationNorm, summaryNorm, eventTimestampNorm]) {
    if (!normalized) continue;
    for (const token of normalized.split(' ')) {
      const tokenBytes = utf8Bytes(token);
      state.maxNormalizedTokenCharacters = Math.max(state.maxNormalizedTokenCharacters, token.length);
      state.maxUtf8Bytes.normalizedToken = Math.max(state.maxUtf8Bytes.normalizedToken, tokenBytes);
      increment(state.counters, 'normalizedTokenOver96CharactersCount',
        token.length > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.queryableTokenCharacters);
      increment(state.counters, 'normalizedTokenOver2047Utf8BytesCount',
        tokenBytes > FULL_CORPUS_SEARCH_POSTGRES_LIMITS.postgresLexemeUtf8Bytes);
    }
  }
};

// The token counters are deliberately warning-only: >96 characters cannot be
// entered through the bounded lexical query contract and >2047 UTF-8 bytes is
// a PostgreSQL lexeme-loss risk. Neither makes the record row itself invalid;
// every column/domain constraint below remains fail-closed.
const fatalCounterTotal = (counters: FullCorpusProductionCompatibilityCounters) => (
  counters.nonPrintableAddressCount
  + counters.nonCanonicalAddressCount
  + counters.overlongAddressCount
  + counters.invalidSourceKeyCount
  + counters.sourceNormOverLimitCount
  + counters.addressNormEmptyCount
  + counters.addressNormOverLimitCount
  + counters.titleNormOverLimitCount
  + counters.locationNormOverLimitCount
  + counters.summaryNormOverLimitCount
  + counters.eventTimestampNormOverLimitCount
  + counters.eventTimestampNullMismatchCount
  + counters.invalidEventTimestampCount
);

export const createFullCorpusProductionCompatibilityAccumulator = (
  params: {
    universe: RelationshipInputUniverseBinding;
    orchestrationRequest: { schemaVersion: string; requestDigest: string };
  },
) => {
  const { universe, orchestrationRequest } = params;
  const state: MutableCompatibility = {
    counters: emptyCounters(),
    maxUtf8Bytes: emptyMaxima(),
    maxNormalizedTokenCharacters: 0,
    unknownSources: new Map(),
  };
  return {
    add: (node: EvidenceUniverseNode) => addNode(state, node),
    finish: (): FullCorpusProductionCompatibilityReceipt => {
      const unknownMappings = [...state.unknownSources.entries()]
        .map(([sourceKey, rawSources]) => ({
          sourceKey,
          rawSources: [...rawSources].sort(compareText),
        }))
        .sort((left, right) => compareText(left.sourceKey, right.sourceKey));
      state.counters.unknownSourceKeyCollisionCount = unknownMappings
        .filter(({ rawSources }) => rawSources.length > 1).length;
      state.counters.unknownSourceAliasCollisionCount = unknownMappings
        .reduce((sum, { rawSources }) => sum + Math.max(0, rawSources.length - 1), 0);
      const unknownSourceKeys = unknownMappings.map(({ sourceKey }) => sourceKey);
      const compatible = state.counters.totalNodesChecked === universe.universeRecordCount
        && fatalCounterTotal(state.counters) === 0;
      const withoutDigest = {
        recordType: 'full_corpus_production_compatibility_receipt' as const,
        schemaVersion: FULL_CORPUS_PRODUCTION_COMPATIBILITY_VERSION,
        corpusVersion: universe.corpusVersion,
        orchestrationRequest: { ...orchestrationRequest },
        universe: { ...universe },
        searchContract: {
          projectionVersion: FULL_CORPUS_SEARCH_PROJECTION_VERSION,
          tokenizerVersion: FULL_CORPUS_SEARCH_TOKENIZER_VERSION,
          eventTimestampVersion: FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION,
          sourceRegistryVersion: CASE_GRAPH_SOURCE_REGISTRY_VERSION,
          postgresLimits: FULL_CORPUS_SEARCH_POSTGRES_LIMITS,
        },
        counters: { ...state.counters },
        maxUtf8Bytes: { ...state.maxUtf8Bytes },
        maxNormalizedTokenCharacters: state.maxNormalizedTokenCharacters,
        unknownSourceKeys,
        unknownSourceKeySetSha256: relationshipInputSha256(unknownSourceKeys),
        unknownSourceMappingSha256: relationshipInputSha256(unknownMappings),
        compatible,
      };
      return {
        ...withoutDigest,
        receiptDigest: relationshipInputSha256(withoutDigest),
      };
    },
  };
};

export const buildFullCorpusProductionCompatibilityReceipt = (params: {
  universe: RelationshipInputUniverseBinding;
  orchestrationRequest: { schemaVersion: string; requestDigest: string };
  nodes: readonly EvidenceUniverseNode[];
}) => {
  const accumulator = createFullCorpusProductionCompatibilityAccumulator({
    universe: params.universe,
    orchestrationRequest: params.orchestrationRequest,
  });
  for (const node of params.nodes) accumulator.add(node);
  return accumulator.finish();
};

export const assertFullCorpusProductionCompatibility = (
  receipt: FullCorpusProductionCompatibilityReceipt,
) => {
  if (!hasExactKeys(receipt, [
    'recordType',
    'schemaVersion',
    'corpusVersion',
    'orchestrationRequest',
    'universe',
    'searchContract',
    'counters',
    'maxUtf8Bytes',
    'maxNormalizedTokenCharacters',
    'unknownSourceKeys',
    'unknownSourceKeySetSha256',
    'unknownSourceMappingSha256',
    'compatible',
    'receiptDigest',
  ])
    || receipt.recordType !== 'full_corpus_production_compatibility_receipt'
    || receipt.schemaVersion !== FULL_CORPUS_PRODUCTION_COMPATIBILITY_VERSION
    || !SAFE_VERSION.test(receipt.corpusVersion)
    || !hasExactKeys(receipt.orchestrationRequest, ['schemaVersion', 'requestDigest'])
    || !hasExactKeys(receipt.universe, [
      'snapshotId',
      'corpusVersion',
      'universeArchiveVersion',
      'universeSchemaVersion',
      'universeLayoutVersion',
      'universeArchiveSetSha256',
      'universeRecordCount',
    ])
    || !hasExactKeys(receipt.searchContract, [
      'projectionVersion',
      'tokenizerVersion',
      'eventTimestampVersion',
      'sourceRegistryVersion',
      'postgresLimits',
    ])
    || !hasExactKeys(receipt.counters, Object.keys(emptyCounters()))
    || !hasExactKeys(receipt.maxUtf8Bytes, Object.keys(emptyMaxima()))
    || receipt.corpusVersion !== receipt.universe.corpusVersion
    || receipt.universe.universeArchiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION
    || receipt.universe.universeSchemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || receipt.universe.universeLayoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || !UUID.test(receipt.universe.snapshotId)
    || !SHA256.test(receipt.universe.universeArchiveSetSha256)
    || !isSafeCount(receipt.universe.universeRecordCount)
    || receipt.searchContract.projectionVersion !== FULL_CORPUS_SEARCH_PROJECTION_VERSION
    || receipt.searchContract.tokenizerVersion !== FULL_CORPUS_SEARCH_TOKENIZER_VERSION
    || receipt.searchContract.eventTimestampVersion !== FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION
    || receipt.searchContract.sourceRegistryVersion !== CASE_GRAPH_SOURCE_REGISTRY_VERSION
    || canonicalizeRelationshipInput(receipt.searchContract.postgresLimits)
      !== canonicalizeRelationshipInput(FULL_CORPUS_SEARCH_POSTGRES_LIMITS)
    || Object.values(receipt.counters).some((value) => !isSafeCount(value))
    || Object.values(receipt.maxUtf8Bytes).some((value) => !isSafeCount(value))
    || !isSafeCount(receipt.maxNormalizedTokenCharacters)
    || !Array.isArray(receipt.unknownSourceKeys)
    || receipt.unknownSourceKeys.some((key) => typeof key !== 'string' || !key.length)
    || receipt.unknownSourceKeys.some((key, index) => index > 0
      && compareText(receipt.unknownSourceKeys[index - 1], key) >= 0)
    || receipt.unknownSourceKeys.length > receipt.counters.unknownSourceCount
    || receipt.counters.unknownSourceKeyCollisionCount > receipt.counters.unknownSourceCount
    || receipt.counters.unknownSourceAliasCollisionCount > receipt.counters.unknownSourceCount
    || receipt.unknownSourceKeySetSha256 !== relationshipInputSha256(receipt.unknownSourceKeys)
    || !SHA256.test(receipt.unknownSourceMappingSha256)
    || typeof receipt.compatible !== 'boolean'
    || !SHA256.test(receipt.receiptDigest)) {
    throw new Error('full_corpus_production_compatibility_receipt_invalid');
  }
  const { receiptDigest, ...withoutDigest } = receipt;
  if (relationshipInputSha256(withoutDigest) !== receiptDigest) {
    throw new Error('full_corpus_production_compatibility_receipt_digest_mismatch');
  }
  if (!SAFE_VERSION.test(receipt.orchestrationRequest.schemaVersion)
    || !SHA256.test(receipt.orchestrationRequest.requestDigest)) {
    throw new Error('full_corpus_production_compatibility_orchestration_binding_invalid');
  }
  if (receipt.counters.totalNodesChecked !== receipt.universe.universeRecordCount) {
    throw new Error('full_corpus_production_compatibility_universe_count_mismatch');
  }
  if (receipt.compatible !== (
    receipt.counters.totalNodesChecked === receipt.universe.universeRecordCount
    && fatalCounterTotal(receipt.counters) === 0
  )) {
    throw new Error('full_corpus_production_compatibility_receipt_invalid');
  }
  if (receipt.counters.nonPrintableAddressCount
    || receipt.counters.nonCanonicalAddressCount
    || receipt.counters.overlongAddressCount) {
    throw new Error('full_corpus_production_compatibility_address_invalid');
  }
  if (receipt.counters.invalidSourceKeyCount) {
    throw new Error('full_corpus_production_compatibility_source_key_invalid');
  }
  if (receipt.counters.invalidEventTimestampCount
    || receipt.counters.eventTimestampNullMismatchCount
    || receipt.counters.eventTimestampNormOverLimitCount) {
    throw new Error('full_corpus_production_compatibility_event_timestamp_invalid');
  }
  if (receipt.counters.sourceNormOverLimitCount
    || receipt.counters.addressNormEmptyCount
    || receipt.counters.addressNormOverLimitCount
    || receipt.counters.titleNormOverLimitCount
    || receipt.counters.locationNormOverLimitCount
    || receipt.counters.summaryNormOverLimitCount) {
    throw new Error('full_corpus_production_compatibility_postgres_limit_exceeded');
  }
  if (!receipt.compatible) {
    throw new Error('full_corpus_production_compatibility_failed');
  }
  return receipt;
};

const compatibilityArchiveKey = (receipt: FullCorpusProductionCompatibilityReceipt) => {
  if (!SAFE_VERSION.test(receipt.corpusVersion)
    || !UUID.test(receipt.universe.snapshotId)
    || !SAFE_VERSION.test(receipt.orchestrationRequest.schemaVersion)
    || !SHA256.test(receipt.orchestrationRequest.requestDigest)) {
    throw new Error('full_corpus_production_compatibility_archive_binding_invalid');
  }
  return [
    'case-vortex/corpora',
    receipt.corpusVersion,
    'production-compatibility',
    FULL_CORPUS_PRODUCTION_COMPATIBILITY_ARCHIVE_VERSION,
    'snapshots',
    receipt.universe.snapshotId,
    'orchestrations',
    receipt.orchestrationRequest.schemaVersion,
    receipt.orchestrationRequest.requestDigest,
    '_complete.receipt.json',
  ].join('/');
};

export const buildFullCorpusProductionCompatibilityArchive = (
  receipt: FullCorpusProductionCompatibilityReceipt,
) => {
  assertFullCorpusProductionCompatibility(receipt);
  const body = Buffer.from(`${canonicalizeRelationshipInput(receipt)}\n`, 'utf8');
  const pointer: FullCorpusProductionCompatibilityPointer = {
    recordType: 'full_corpus_production_compatibility_pointer',
    schemaVersion: FULL_CORPUS_PRODUCTION_COMPATIBILITY_ARCHIVE_VERSION,
    corpusVersion: receipt.corpusVersion,
    snapshotId: receipt.universe.snapshotId,
    orchestrationRequestSchemaVersion: receipt.orchestrationRequest.schemaVersion,
    orchestrationRequestDigest: receipt.orchestrationRequest.requestDigest,
    archiveKey: compatibilityArchiveKey(receipt),
    receiptDigest: receipt.receiptDigest,
    bodySha256: createHash('sha256').update(body).digest('hex'),
    bodyBytes: body.length,
  };
  return { pointer, body };
};

export const decodeFullCorpusProductionCompatibilityPointer = (
  input: unknown,
  expected: Partial<Pick<
  FullCorpusProductionCompatibilityPointer,
  'corpusVersion' | 'snapshotId' | 'orchestrationRequestSchemaVersion' | 'orchestrationRequestDigest'
  >> = {},
): FullCorpusProductionCompatibilityPointer => {
  if (!hasExactKeys(input, [
    'recordType', 'schemaVersion', 'corpusVersion', 'snapshotId',
    'orchestrationRequestSchemaVersion', 'orchestrationRequestDigest',
    'archiveKey', 'receiptDigest', 'bodySha256', 'bodyBytes',
  ])) {
    throw new Error('full_corpus_production_compatibility_pointer_invalid');
  }
  const value = input as Record<string, unknown>;
  if (value.recordType !== 'full_corpus_production_compatibility_pointer'
    || value.schemaVersion !== FULL_CORPUS_PRODUCTION_COMPATIBILITY_ARCHIVE_VERSION
    || typeof value.corpusVersion !== 'string' || !SAFE_VERSION.test(value.corpusVersion)
    || typeof value.snapshotId !== 'string' || !UUID.test(value.snapshotId)
    || typeof value.orchestrationRequestSchemaVersion !== 'string'
    || !SAFE_VERSION.test(value.orchestrationRequestSchemaVersion)
    || typeof value.orchestrationRequestDigest !== 'string'
    || !SHA256.test(value.orchestrationRequestDigest)
    || typeof value.receiptDigest !== 'string' || !SHA256.test(value.receiptDigest)
    || typeof value.bodySha256 !== 'string' || !SHA256.test(value.bodySha256)
    || !Number.isSafeInteger(value.bodyBytes) || Number(value.bodyBytes) < 1
    || Number(value.bodyBytes) > 64 * 1024 * 1024) {
    throw new Error('full_corpus_production_compatibility_pointer_invalid');
  }
  const pointer = value as unknown as FullCorpusProductionCompatibilityPointer;
  const expectedArchiveKey = [
    'case-vortex/corpora', pointer.corpusVersion, 'production-compatibility',
    FULL_CORPUS_PRODUCTION_COMPATIBILITY_ARCHIVE_VERSION, 'snapshots', pointer.snapshotId,
    'orchestrations', pointer.orchestrationRequestSchemaVersion,
    pointer.orchestrationRequestDigest, '_complete.receipt.json',
  ].join('/');
  if (pointer.archiveKey !== expectedArchiveKey
    || Object.entries(expected).some(([key, expectedValue]) => (
      expectedValue !== undefined
      && pointer[key as keyof FullCorpusProductionCompatibilityPointer] !== expectedValue
    ))) {
    throw new Error('full_corpus_production_compatibility_pointer_binding_mismatch');
  }
  return { ...pointer };
};

export const readVerifiedFullCorpusProductionCompatibilityReceipt = async (params: {
  storage: Pick<CaseGraphConditionalArchiveStorage, 'readObject'>;
  pointer: unknown;
  expected?: Parameters<typeof decodeFullCorpusProductionCompatibilityPointer>[1];
}) => {
  const pointer = decodeFullCorpusProductionCompatibilityPointer(params.pointer, params.expected);
  const body = await params.storage.readObject(pointer.archiveKey);
  if (!body) throw new Error('full_corpus_production_compatibility_archive_missing');
  if (body.length !== pointer.bodyBytes
    || createHash('sha256').update(body).digest('hex') !== pointer.bodySha256) {
    throw new Error('full_corpus_production_compatibility_archive_pointer_mismatch');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('full_corpus_production_compatibility_archive_json_invalid');
  }
  const receipt = assertFullCorpusProductionCompatibility(
    decoded as FullCorpusProductionCompatibilityReceipt,
  );
  const archive = buildFullCorpusProductionCompatibilityArchive(receipt);
  if (!archive.body.equals(body)
    || canonicalizeRelationshipInput(archive.pointer) !== canonicalizeRelationshipInput(pointer)) {
    throw new Error('full_corpus_production_compatibility_archive_noncanonical');
  }
  return { pointer, receipt, body };
};

export const writeFullCorpusProductionCompatibilityReceipt = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  receipt: FullCorpusProductionCompatibilityReceipt;
}) => {
  const archive = buildFullCorpusProductionCompatibilityArchive(params.receipt);
  const write = await params.storage.uploadFileConditional(
    archive.body,
    archive.pointer.archiveKey,
    {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: archive.body.length,
    },
    { ifAbsent: true },
  );
  if (write.status === 'precondition_failed') {
    const existing = await params.storage.readObject(archive.pointer.archiveKey);
    if (!existing || !existing.equals(archive.body)) {
      throw new Error('full_corpus_production_compatibility_archive_immutable_conflict');
    }
  }
  const stored = await params.storage.readObject(archive.pointer.archiveKey);
  if (!stored || !stored.equals(archive.body)
    || createHash('sha256').update(stored).digest('hex') !== archive.pointer.bodySha256) {
    throw new Error('full_corpus_production_compatibility_archive_read_after_write_mismatch');
  }
  return {
    pointer: archive.pointer,
    status: write.status === 'written' ? 'written' as const : 'reused' as const,
  };
};
