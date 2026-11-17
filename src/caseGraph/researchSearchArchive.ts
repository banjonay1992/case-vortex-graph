import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzipSync } from 'node:zlib';

import {
  getCaseGraphResearchSearchBlobKey,
  getCaseGraphResearchSearchControlKeys,
} from './archiveKeys';
import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphConditionalWriteResult,
} from './archiveTypes';
import {
  getCaseGraphNodes,
  parseCaseGraphEvidenceAddress,
  readCaseGraphPublicShard,
  type ActiveCaseGraphPublication,
  type CaseGraphPublicStorage,
} from './publicAccess';
import {
  CASE_GRAPH_RESEARCH_LIMITS,
  CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
  caseGraphResearchPublicationBinding,
  decodeCaseGraphResearchToolRequest,
  type CaseGraphResearchPublicationBinding,
  type CaseGraphResearchSearchCandidates,
  type CaseGraphResearchSearchFilters,
  type CaseGraphResearchSearchProvider,
} from './researchToolContract';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type {
  FullCorpusPublicNode,
  FullCorpusPublicRelationshipStatus,
} from './typedRelationshipPublicGraph';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';

export const CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION = 'case-graph-research-search-archive-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION = 'unicode-folded-word-v1' as const;
export const CASE_GRAPH_RESEARCH_SEARCH_RANKING_VERSION = 'field-coverage-v1' as const;

/**
 * The JSON-shard implementation is retained only as a deterministic fixture
 * and migration reference. It is not the production serving index: a caller
 * must opt in explicitly so an import or dependency-injection mistake cannot
 * make it public.
 */
export const CASE_GRAPH_RESEARCH_SEARCH_R2_JSON_PRODUCTION_READY = false as const;

export const CASE_GRAPH_RESEARCH_SEARCH_DEFAULT_TERM_SHARDS = 64;
export const CASE_GRAPH_RESEARCH_SEARCH_DEFAULT_DOCUMENT_SHARDS = 64;
export const CASE_GRAPH_RESEARCH_SEARCH_MAX_QUERY_TERMS = 24;

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_SHARD_BYTES = 128 * 1024 * 1024;
const MAX_UNCOMPRESSED_SHARD_BYTES = 512 * 1024 * 1024;
const MAX_INDEX_RECORDS = 10_000_000;
const MAX_INDEX_SHARDS = 4096;
const DOCUMENT_SCAN_WINDOW = 256;
const MAX_QUERY_TERM_POSTINGS = 100_000;
const MAX_QUERY_TERM_COMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_QUERY_TERM_UNCOMPRESSED_BYTES = 48 * 1024 * 1024;
const MAX_QUERY_DOCUMENT_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;
const DEFAULT_CACHE_ENTRIES = 128;
const SHA256 = /^[a-f0-9]{64}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;

const SEARCH_FIELDS = ['address', 'event_timestamp', 'location', 'source', 'summary', 'title'] as const;
type SearchField = typeof SEARCH_FIELDS[number];

const FIELD_BITS: Record<SearchField, number> = Object.freeze({
  address: 1 << 0,
  event_timestamp: 1 << 1,
  location: 1 << 2,
  source: 1 << 3,
  summary: 1 << 4,
  title: 1 << 5,
});

const FIELD_WEIGHTS: Record<SearchField, number> = Object.freeze({
  address: 1,
  title: 0.9,
  source: 0.82,
  location: 0.78,
  event_timestamp: 0.7,
  summary: 0.62,
});

const KINDS: readonly EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const STATUSES: readonly FullCorpusPublicRelationshipStatus[] = ['linked', 'candidate_only', 'isolated'];

export type CaseGraphResearchSearchSourceBinding = {
  corpusVersion: string;
  snapshotId: string;
  graphArtifactSetSha256: string;
  publicGraphManifestDigest: string;
  nodeSetSha256: string;
  recordCount: number;
};

export type CaseGraphResearchSearchDocument = {
  address: string;
  kind: EvidenceUniverseNodeKind;
  relationshipStatus: FullCorpusPublicRelationshipStatus;
  source: string;
  eventTimestamp: string | null;
  nodeDigest: string;
};

export type CaseGraphResearchSearchPosting = {
  address: string;
  fieldMask: number;
};

export type CaseGraphResearchSearchTerm = {
  term: string;
  postings: CaseGraphResearchSearchPosting[];
};

export type CaseGraphResearchSearchDocumentShard = {
  recordType: 'case_graph_research_search_document_shard';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION;
  archiveVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION;
  source: CaseGraphResearchSearchSourceBinding;
  shard: number;
  shardCount: number;
  documentCount: number;
  documents: CaseGraphResearchSearchDocument[];
  documentSetSha256: string;
  shardDigest: string;
};

export type CaseGraphResearchSearchTermShard = {
  recordType: 'case_graph_research_search_term_shard';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION;
  archiveVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION;
  tokenizerVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION;
  source: CaseGraphResearchSearchSourceBinding;
  shard: number;
  shardCount: number;
  termCount: number;
  postingCount: number;
  terms: CaseGraphResearchSearchTerm[];
  termSetSha256: string;
  shardDigest: string;
};

type CaseGraphResearchSearchShardKind = 'document' | 'term';

export type CaseGraphResearchSearchShardSummary = {
  kind: CaseGraphResearchSearchShardKind;
  shard: number;
  shardCount: number;
  itemCount: number;
  postingCount: number;
  firstKey: string | null;
  lastKey: string | null;
  artifactDigest: string;
  archiveKey: string;
  compressedBytes: number;
  uncompressedBytes: number;
  compressedSha256: string;
};

export type CaseGraphResearchSearchManifest = {
  recordType: 'case_graph_research_search_manifest';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION;
  archiveVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION;
  binding: CaseGraphResearchPublicationBinding;
  source: CaseGraphResearchSearchSourceBinding;
  tokenizerVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION;
  rankingVersion: typeof CASE_GRAPH_RESEARCH_SEARCH_RANKING_VERSION;
  indexedFields: SearchField[];
  termShardCount: number;
  documentShardCount: number;
  shards: CaseGraphResearchSearchShardSummary[];
  shardSetSha256: string;
  indexSha256: string;
};

export type CaseGraphResearchSearchArchiveArtifact = {
  kind: CaseGraphResearchSearchShardKind;
  shard: number;
  value: CaseGraphResearchSearchDocumentShard | CaseGraphResearchSearchTermShard;
  body: Buffer;
  archiveBody: Buffer;
  summary: CaseGraphResearchSearchShardSummary;
};

export type CaseGraphResearchSearchBuild = {
  manifest: CaseGraphResearchSearchManifest;
  manifestBody: Buffer;
  artifacts: CaseGraphResearchSearchArchiveArtifact[];
};

export type CaseGraphResearchSearchArchiveStorage = CaseGraphPublicStorage & Pick<
  CaseGraphConditionalArchiveStorage,
  'uploadFileConditional'
>;

const fail = (code: string): never => { throw new Error(code); };
const requireExperimentalR2JsonIndex = (allowed: unknown) => {
  if (allowed !== true) fail('case_graph_research_search_r2_json_index_disabled');
};
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!isObject(value)) return fail(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
};
const sha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) return fail(code);
  return value;
};
const count = (value: unknown, maximum: number, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) return fail(code);
  return Number(value);
};
const digestBody = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const gunzipBody = promisify(gunzip);
const encode = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const artifactDigest = (value: unknown) => relationshipInputSha256(value);

const normalizeShardCount = (value: unknown, code: string) => {
  const result = count(value, MAX_INDEX_SHARDS, code);
  if (result < 1 || (result & (result - 1)) !== 0) fail(code);
  return result;
};

const shardFor = (value: string, shardCount: number) => (
  createHash('sha256').update(value).digest().readUInt32BE(0) & (shardCount - 1)
);

const normalizeSearchText = (value: string) => value
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLocaleLowerCase('en-US');

const lexicalTerms = (value: string) => {
  const matched = normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu);
  const terms: string[] = matched ? [...matched] : [];
  return terms.filter((term) => term.length <= 96);
};

const exactAddressTerm = (value: string) => {
  try {
    const address = parseCaseGraphEvidenceAddress(value).address;
    return `@address:${address}`;
  } catch {
    return null;
  }
};

export const tokenizeCaseGraphResearchSearchQuery = (value: string) => {
  const exactAddress = exactAddressTerm(value);
  const terms = [...new Set([
    ...lexicalTerms(value),
    ...(exactAddress ? [exactAddress] : []),
  ])].sort(compareText);
  if (!terms.length) fail('case_graph_research_search_query_invalid');
  if (terms.length > CASE_GRAPH_RESEARCH_SEARCH_MAX_QUERY_TERMS) {
    fail('case_graph_research_search_query_terms_exceeded');
  }
  return terms;
};

const fieldTerms = (field: SearchField, value: string | null) => {
  if (!value) return [];
  const terms = lexicalTerms(value);
  if (field === 'address') terms.push(`@address:${value}`);
  return [...new Set(terms)];
};

const searchSourceFor = (active: ActiveCaseGraphPublication): CaseGraphResearchSearchSourceBinding => ({
  corpusVersion: active.corpusVersion,
  snapshotId: active.manifest.lineage.snapshot.snapshotId,
  graphArtifactSetSha256: active.manifest.lineage.graph.artifactSetSha256,
  publicGraphManifestDigest: active.manifest.lineage.publicGraph.manifestDigest,
  nodeSetSha256: active.manifest.lineage.publicGraph.nodeSetSha256,
  recordCount: active.manifest.accounting.indexedRecordCount,
});

const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

const validateSourceBinding = (
  value: unknown,
  expected: CaseGraphResearchSearchSourceBinding,
  code = 'case_graph_research_search_integrity_failed',
) => {
  const object = exact(value, [
    'corpusVersion', 'snapshotId', 'graphArtifactSetSha256', 'publicGraphManifestDigest',
    'nodeSetSha256', 'recordCount',
  ], code);
  const parsed: CaseGraphResearchSearchSourceBinding = {
    corpusVersion: typeof object.corpusVersion === 'string' ? object.corpusVersion : fail(code),
    snapshotId: typeof object.snapshotId === 'string' ? object.snapshotId : fail(code),
    graphArtifactSetSha256: sha(object.graphArtifactSetSha256, code),
    publicGraphManifestDigest: sha(object.publicGraphManifestDigest, code),
    nodeSetSha256: sha(object.nodeSetSha256, code),
    recordCount: count(object.recordCount, MAX_INDEX_RECORDS, code),
  };
  if (!same(parsed, expected)) fail('case_graph_research_search_publication_mismatch');
  return parsed;
};

const documentFromNode = (node: FullCorpusPublicNode): CaseGraphResearchSearchDocument => ({
  address: node.address,
  kind: node.kind,
  relationshipStatus: node.relationshipStatus,
  source: node.source.toLowerCase(),
  eventTimestamp: node.eventTimestamp,
  nodeDigest: node.nodeDigest,
});

const assertNodeIntegrity = (node: FullCorpusPublicNode) => {
  const { nodeDigest, ...withoutDigest } = node;
  if (!SHA256.test(nodeDigest)
    || artifactDigest(withoutDigest) !== nodeDigest
    || parseCaseGraphEvidenceAddress(node.address).address !== node.address
    || !KINDS.includes(node.kind)
    || !STATUSES.includes(node.relationshipStatus)) {
    fail('case_graph_research_search_source_node_invalid');
  }
};

const buildDocumentArtifact = (params: {
  source: CaseGraphResearchSearchSourceBinding;
  shard: number;
  shardCount: number;
  documents: CaseGraphResearchSearchDocument[];
  corpusVersion: string;
}): CaseGraphResearchSearchArchiveArtifact => {
  const documents = [...params.documents].sort((left, right) => compareText(left.address, right.address));
  const withoutDigest = {
    recordType: 'case_graph_research_search_document_shard' as const,
    schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
    archiveVersion: CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION,
    source: params.source,
    shard: params.shard,
    shardCount: params.shardCount,
    documentCount: documents.length,
    documents,
    documentSetSha256: artifactDigest(documents.map((document) => `${document.address}:${document.nodeDigest}`)),
  };
  const value: CaseGraphResearchSearchDocumentShard = {
    ...withoutDigest,
    shardDigest: artifactDigest(withoutDigest),
  };
  const body = encode(value);
  const archiveBody = gzipSync(body, { level: 9 });
  const compressedSha256 = digestBody(archiveBody);
  const summary: CaseGraphResearchSearchShardSummary = {
    kind: 'document',
    shard: params.shard,
    shardCount: params.shardCount,
    itemCount: documents.length,
    postingCount: 0,
    firstKey: documents[0]?.address || null,
    lastKey: documents.at(-1)?.address || null,
    artifactDigest: value.shardDigest,
    archiveKey: getCaseGraphResearchSearchBlobKey(
      params.corpusVersion,
      'document',
      params.shard,
      compressedSha256,
    ),
    compressedBytes: archiveBody.length,
    uncompressedBytes: body.length,
    compressedSha256,
  };
  return { kind: 'document', shard: params.shard, value, body, archiveBody, summary };
};

const buildTermArtifact = (params: {
  source: CaseGraphResearchSearchSourceBinding;
  shard: number;
  shardCount: number;
  terms: CaseGraphResearchSearchTerm[];
  corpusVersion: string;
}): CaseGraphResearchSearchArchiveArtifact => {
  const terms = [...params.terms]
    .map((entry) => ({
      term: entry.term,
      postings: [...entry.postings].sort((left, right) => compareText(left.address, right.address)),
    }))
    .sort((left, right) => compareText(left.term, right.term));
  const postingCount = terms.reduce((sum, entry) => sum + entry.postings.length, 0);
  const withoutDigest = {
    recordType: 'case_graph_research_search_term_shard' as const,
    schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
    archiveVersion: CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION,
    tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION,
    source: params.source,
    shard: params.shard,
    shardCount: params.shardCount,
    termCount: terms.length,
    postingCount,
    terms,
    termSetSha256: artifactDigest(terms),
  };
  const value = {
    ...withoutDigest,
    shardDigest: artifactDigest(withoutDigest),
  } as CaseGraphResearchSearchTermShard;
  const body = encode(value);
  const archiveBody = gzipSync(body, { level: 9 });
  const compressedSha256 = digestBody(archiveBody);
  const summary: CaseGraphResearchSearchShardSummary = {
    kind: 'term',
    shard: params.shard,
    shardCount: params.shardCount,
    itemCount: terms.length,
    postingCount,
    firstKey: terms[0]?.term || null,
    lastKey: terms.at(-1)?.term || null,
    artifactDigest: value.shardDigest,
    archiveKey: getCaseGraphResearchSearchBlobKey(
      params.corpusVersion,
      'term',
      params.shard,
      compressedSha256,
    ),
    compressedBytes: archiveBody.length,
    uncompressedBytes: body.length,
    compressedSha256,
  };
  return { kind: 'term', shard: params.shard, value, body, archiveBody, summary };
};

export const buildImmutableCaseGraphResearchSearchIndex = (params: {
  active: ActiveCaseGraphPublication;
  nodes: readonly FullCorpusPublicNode[];
  termShardCount?: number;
  documentShardCount?: number;
}): CaseGraphResearchSearchBuild => {
  const termShardCount = normalizeShardCount(
    params.termShardCount ?? CASE_GRAPH_RESEARCH_SEARCH_DEFAULT_TERM_SHARDS,
    'case_graph_research_search_term_shard_count_invalid',
  );
  const documentShardCount = normalizeShardCount(
    params.documentShardCount ?? CASE_GRAPH_RESEARCH_SEARCH_DEFAULT_DOCUMENT_SHARDS,
    'case_graph_research_search_document_shard_count_invalid',
  );
  const binding = caseGraphResearchPublicationBinding(params.active);
  const source = searchSourceFor(params.active);
  const nodes = [...params.nodes].sort((left, right) => compareText(left.address, right.address));
  if (nodes.length !== source.recordCount || nodes.length > MAX_INDEX_RECORDS) {
    fail('case_graph_research_search_source_count_mismatch');
  }
  for (const node of nodes) assertNodeIntegrity(node);
  if (new Set(nodes.map((node) => node.address)).size !== nodes.length) {
    fail('case_graph_research_search_source_address_duplicate');
  }
  const sourceNodeSetSha256 = artifactDigest(
    nodes.map((node) => `${node.address}:${node.nodeDigest}`).join('\n'),
  );
  if (sourceNodeSetSha256 !== source.nodeSetSha256) {
    fail('case_graph_research_search_source_node_set_mismatch');
  }

  const documents = Array.from({ length: documentShardCount }, () => [] as CaseGraphResearchSearchDocument[]);
  const terms = Array.from({ length: termShardCount }, () => new Map<string, CaseGraphResearchSearchPosting[]>());
  for (const node of nodes) {
    documents[shardFor(node.address, documentShardCount)].push(documentFromNode(node));
    const nodeTerms = new Map<string, number>();
    const fields: Array<[SearchField, string | null]> = [
      ['address', node.address],
      ['event_timestamp', node.eventTimestamp],
      ['location', node.location],
      ['source', node.source],
      ['summary', node.summary],
      ['title', node.title],
    ];
    for (const [field, value] of fields) {
      for (const term of fieldTerms(field, value)) {
        nodeTerms.set(term, (nodeTerms.get(term) || 0) | FIELD_BITS[field]);
      }
    }
    for (const [term, fieldMask] of nodeTerms) {
      const shard = terms[shardFor(term, termShardCount)];
      const postings = shard.get(term) || [];
      postings.push({ address: node.address, fieldMask });
      shard.set(term, postings);
    }
  }

  const artifacts: CaseGraphResearchSearchArchiveArtifact[] = [];
  for (let shard = 0; shard < documentShardCount; shard += 1) {
    artifacts.push(buildDocumentArtifact({
      source,
      shard,
      shardCount: documentShardCount,
      documents: documents[shard],
      corpusVersion: params.active.corpusVersion,
    }));
  }
  for (let shard = 0; shard < termShardCount; shard += 1) {
    artifacts.push(buildTermArtifact({
      source,
      shard,
      shardCount: termShardCount,
      terms: [...terms[shard]].map(([term, postings]) => ({ term, postings })),
      corpusVersion: params.active.corpusVersion,
    }));
  }
  const summaries = artifacts.map((artifact) => artifact.summary)
    .sort((left, right) => compareText(left.kind, right.kind) || left.shard - right.shard);
  const withoutDigest = {
    recordType: 'case_graph_research_search_manifest' as const,
    schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
    archiveVersion: CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION,
    binding,
    source,
    tokenizerVersion: CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION,
    rankingVersion: CASE_GRAPH_RESEARCH_SEARCH_RANKING_VERSION,
    indexedFields: [...SEARCH_FIELDS],
    termShardCount,
    documentShardCount,
    shards: summaries,
    shardSetSha256: artifactDigest(summaries.map((summary) => (
      `${summary.kind}:${summary.shard}:${summary.artifactDigest}:${summary.compressedSha256}`
    ))),
  };
  const manifest: CaseGraphResearchSearchManifest = {
    ...withoutDigest,
    indexSha256: artifactDigest(withoutDigest),
  };
  return { manifest, manifestBody: encode(manifest), artifacts };
};

const validateSummary = (
  value: unknown,
  source: CaseGraphResearchSearchSourceBinding,
  termShardCount: number,
  documentShardCount: number,
) => {
  const code = 'case_graph_research_search_manifest_invalid';
  const object = exact(value, [
    'kind', 'shard', 'shardCount', 'itemCount', 'postingCount', 'firstKey', 'lastKey',
    'artifactDigest', 'archiveKey', 'compressedBytes', 'uncompressedBytes', 'compressedSha256',
  ], code);
  if (object.kind !== 'term' && object.kind !== 'document') fail(code);
  const kind = object.kind as CaseGraphResearchSearchShardKind;
  const expectedShardCount = kind === 'term' ? termShardCount : documentShardCount;
  const shard = count(object.shard, expectedShardCount - 1, code);
  if (object.shardCount !== expectedShardCount) fail(code);
  const compressedSha256 = sha(object.compressedSha256, code);
  const expectedKey = getCaseGraphResearchSearchBlobKey(source.corpusVersion, kind, shard, compressedSha256);
  const summary: CaseGraphResearchSearchShardSummary = {
    kind,
    shard,
    shardCount: expectedShardCount,
    itemCount: count(object.itemCount, MAX_INDEX_RECORDS * 100, code),
    postingCount: count(object.postingCount, MAX_INDEX_RECORDS * 100, code),
    firstKey: object.firstKey === null || typeof object.firstKey === 'string'
      ? object.firstKey as string | null
      : fail(code),
    lastKey: object.lastKey === null || typeof object.lastKey === 'string'
      ? object.lastKey as string | null
      : fail(code),
    artifactDigest: sha(object.artifactDigest, code),
    archiveKey: typeof object.archiveKey === 'string' ? object.archiveKey : fail(code),
    compressedBytes: count(object.compressedBytes, MAX_COMPRESSED_SHARD_BYTES, code),
    uncompressedBytes: count(object.uncompressedBytes, MAX_UNCOMPRESSED_SHARD_BYTES, code),
    compressedSha256,
  };
  const emptyBoundaries = summary.firstKey === null && summary.lastKey === null;
  const completeBoundaries = summary.firstKey !== null && summary.lastKey !== null;
  if (summary.archiveKey !== expectedKey
    || (summary.itemCount === 0 ? !emptyBoundaries : !completeBoundaries)
    || (completeBoundaries && compareText(summary.firstKey!, summary.lastKey!) > 0)
    || (kind === 'document' && summary.postingCount !== 0)) fail(code);
  return summary;
};

export const decodeCaseGraphResearchSearchManifest = (params: {
  body: Buffer;
  active: ActiveCaseGraphPublication;
}) => {
  const code = 'case_graph_research_search_manifest_invalid';
  if (params.body.length > MAX_MANIFEST_BYTES) fail(code);
  let raw: unknown;
  try { raw = JSON.parse(params.body.toString('utf8')); } catch { return fail(code); }
  const object = exact(raw, [
    'recordType', 'schemaVersion', 'archiveVersion', 'binding', 'source', 'tokenizerVersion',
    'rankingVersion', 'indexedFields', 'termShardCount', 'documentShardCount', 'shards',
    'shardSetSha256', 'indexSha256',
  ], code);
  const binding = caseGraphResearchPublicationBinding(params.active);
  if (object.recordType !== 'case_graph_research_search_manifest'
    || object.schemaVersion !== CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION
    || object.archiveVersion !== CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION
    || object.tokenizerVersion !== CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION
    || object.rankingVersion !== CASE_GRAPH_RESEARCH_SEARCH_RANKING_VERSION
    || !same(object.binding, binding)) {
    fail('case_graph_research_search_publication_mismatch');
  }
  const source = validateSourceBinding(object.source, searchSourceFor(params.active));
  const termShardCount = normalizeShardCount(object.termShardCount, code);
  const documentShardCount = normalizeShardCount(object.documentShardCount, code);
  if (!Array.isArray(object.indexedFields) || !same(object.indexedFields, SEARCH_FIELDS)) fail(code);
  const indexedFields = [...SEARCH_FIELDS];
  const rawShards = object.shards;
  if (!Array.isArray(rawShards)) fail(code);
  const shardValues = rawShards as unknown[];
  if (shardValues.length !== termShardCount + documentShardCount) fail(code);
  const shards = shardValues.map((summary) => validateSummary(
    summary, source, termShardCount, documentShardCount,
  )).sort((left, right) => compareText(left.kind, right.kind) || left.shard - right.shard);
  const expectedCoordinates = [
    ...Array.from({ length: documentShardCount }, (_, shard) => `document:${shard}`),
    ...Array.from({ length: termShardCount }, (_, shard) => `term:${shard}`),
  ].sort(compareText);
  if (!same(shards.map((summary) => `${summary.kind}:${summary.shard}`).sort(compareText), expectedCoordinates)) fail(code);
  const shardSetSha256 = sha(object.shardSetSha256, code);
  if (shardSetSha256 !== artifactDigest(shards.map((summary) => (
    `${summary.kind}:${summary.shard}:${summary.artifactDigest}:${summary.compressedSha256}`
  )))) fail(code);
  const withoutDigest = {
    recordType: object.recordType,
    schemaVersion: object.schemaVersion,
    archiveVersion: object.archiveVersion,
    binding,
    source,
    tokenizerVersion: object.tokenizerVersion,
    rankingVersion: object.rankingVersion,
    indexedFields,
    termShardCount,
    documentShardCount,
    shards,
    shardSetSha256,
  };
  const indexSha256 = sha(object.indexSha256, code);
  if (indexSha256 !== artifactDigest(withoutDigest)) fail(code);
  const manifest = { ...withoutDigest, indexSha256 } as CaseGraphResearchSearchManifest;
  if (!params.body.equals(encode(manifest))) fail(code);
  return manifest;
};

export const inspectImmutableCaseGraphResearchSearchIndex = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const binding = caseGraphResearchPublicationBinding(params.active);
  const keys = getCaseGraphResearchSearchControlKeys(
    binding.corpusVersion,
    binding.publicationId,
    binding.manifestSha256,
  );
  const body = await params.storage.readObject(keys.manifestKey, {
    maxBytes: MAX_MANIFEST_BYTES,
    signal: params.signal,
  });
  if (body === null) return fail('case_graph_research_search_index_missing');
  return decodeCaseGraphResearchSearchManifest({ body, active: params.active });
};

const decodeDocument = (value: unknown, code: string): CaseGraphResearchSearchDocument => {
  const object = exact(value, [
    'address', 'kind', 'relationshipStatus', 'source', 'eventTimestamp', 'nodeDigest',
  ], code);
  const address = typeof object.address === 'string'
    ? parseCaseGraphEvidenceAddress(object.address).address
    : fail(code);
  if (!KINDS.includes(object.kind as EvidenceUniverseNodeKind)
    || !STATUSES.includes(object.relationshipStatus as FullCorpusPublicRelationshipStatus)
    || typeof object.source !== 'string'
    || object.source !== object.source.toLowerCase()
    || (object.eventTimestamp !== null && typeof object.eventTimestamp !== 'string')) fail(code);
  return {
    address,
    kind: object.kind as EvidenceUniverseNodeKind,
    relationshipStatus: object.relationshipStatus as FullCorpusPublicRelationshipStatus,
    source: object.source as string,
    eventTimestamp: object.eventTimestamp as string | null,
    nodeDigest: sha(object.nodeDigest, code),
  };
};

const decodeDocumentShard = (params: {
  raw: unknown;
  source: CaseGraphResearchSearchSourceBinding;
  summary: CaseGraphResearchSearchShardSummary;
}) => {
  const code = 'case_graph_research_search_shard_integrity_failed';
  const object = exact(params.raw, [
    'recordType', 'schemaVersion', 'archiveVersion', 'source', 'shard', 'shardCount',
    'documentCount', 'documents', 'documentSetSha256', 'shardDigest',
  ], code);
  const rawDocuments = object.documents;
  if (object.recordType !== 'case_graph_research_search_document_shard'
    || object.schemaVersion !== CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION
    || object.archiveVersion !== CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION
    || !same(object.source, params.source)
    || object.shard !== params.summary.shard
    || object.shardCount !== params.summary.shardCount) fail(code);
  if (!Array.isArray(rawDocuments)) fail(code);
  const documentValues = rawDocuments as unknown[];
  const documents = documentValues.map((document) => decodeDocument(document, code));
  if (object.documentCount !== documents.length
    || documents.length !== params.summary.itemCount
    || documents.some((document, index) => (
      shardFor(document.address, params.summary.shardCount) !== params.summary.shard
      || (index > 0 && compareText(documents[index - 1].address, document.address) >= 0)
    ))) fail(code);
  if ((documents[0]?.address || null) !== params.summary.firstKey
    || (documents.at(-1)?.address || null) !== params.summary.lastKey) fail(code);
  const documentSetSha256 = sha(object.documentSetSha256, code);
  if (documentSetSha256 !== artifactDigest(documents.map((document) => `${document.address}:${document.nodeDigest}`))) fail(code);
  const withoutDigest = {
    recordType: object.recordType,
    schemaVersion: object.schemaVersion,
    archiveVersion: object.archiveVersion,
    source: object.source,
    shard: object.shard,
    shardCount: object.shardCount,
    documentCount: object.documentCount,
    documents,
    documentSetSha256,
  };
  const shardDigest = sha(object.shardDigest, code);
  if (shardDigest !== artifactDigest(withoutDigest) || shardDigest !== params.summary.artifactDigest) fail(code);
  return { ...withoutDigest, shardDigest } as CaseGraphResearchSearchDocumentShard;
};

const decodePosting = (
  value: unknown,
  code: string,
): CaseGraphResearchSearchPosting => {
  const object = exact(value, ['address', 'fieldMask'], code);
  const address = typeof object.address === 'string'
    ? parseCaseGraphEvidenceAddress(object.address).address
    : fail(code);
  const maximumMask = Object.values(FIELD_BITS).reduce((mask, bit) => mask | bit, 0);
  const fieldMask = count(object.fieldMask, maximumMask, code);
  if (!fieldMask) fail(code);
  return { address, fieldMask };
};

const decodeTermShard = (params: {
  raw: unknown;
  source: CaseGraphResearchSearchSourceBinding;
  summary: CaseGraphResearchSearchShardSummary;
}) => {
  const code = 'case_graph_research_search_shard_integrity_failed';
  const object = exact(params.raw, [
    'recordType', 'schemaVersion', 'archiveVersion', 'tokenizerVersion', 'source', 'shard',
    'shardCount', 'termCount', 'postingCount', 'terms', 'termSetSha256', 'shardDigest',
  ], code);
  const rawTerms = object.terms;
  if (object.recordType !== 'case_graph_research_search_term_shard'
    || object.schemaVersion !== CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION
    || object.archiveVersion !== CASE_GRAPH_RESEARCH_SEARCH_ARCHIVE_VERSION
    || object.tokenizerVersion !== CASE_GRAPH_RESEARCH_SEARCH_TOKENIZER_VERSION
    || !same(object.source, params.source)
    || object.shard !== params.summary.shard
    || object.shardCount !== params.summary.shardCount) fail(code);
  if (!Array.isArray(rawTerms)) fail(code);
  const termValues = rawTerms as unknown[];
  const terms: CaseGraphResearchSearchTerm[] = termValues.map((rawTerm) => {
    const term = exact(rawTerm, ['term', 'postings'], code);
    const rawPostings = term.postings;
    const termValue = term.term;
    if (typeof termValue !== 'string'
      || !termValue
      || shardFor(termValue, params.summary.shardCount) !== params.summary.shard) fail(code);
    const normalizedTerm = termValue as string;
    if (!Array.isArray(rawPostings)) fail(code);
    const postingValues = rawPostings as unknown[];
    const postings = postingValues.map((posting) => decodePosting(posting, code));
    if (postings.some((posting, index) => (
      index > 0 && compareText(postings[index - 1].address, posting.address) >= 0
    ))) fail(code);
    return { term: normalizedTerm, postings };
  });
  const postingCount = terms.reduce((sum, term) => sum + term.postings.length, 0);
  if (object.termCount !== terms.length
    || object.postingCount !== postingCount
    || object.termCount !== params.summary.itemCount
    || object.postingCount !== params.summary.postingCount
    || terms.some((term, index) => index > 0 && compareText(terms[index - 1].term, term.term) >= 0)) fail(code);
  if ((terms[0]?.term || null) !== params.summary.firstKey
    || (terms.at(-1)?.term || null) !== params.summary.lastKey) fail(code);
  const termSetSha256 = sha(object.termSetSha256, code);
  if (termSetSha256 !== artifactDigest(terms)) fail(code);
  const withoutDigest = {
    recordType: object.recordType,
    schemaVersion: object.schemaVersion,
    archiveVersion: object.archiveVersion,
    tokenizerVersion: object.tokenizerVersion,
    source: object.source,
    shard: object.shard,
    shardCount: object.shardCount,
    termCount: object.termCount,
    postingCount,
    terms,
    termSetSha256,
  };
  const shardDigest = sha(object.shardDigest, code);
  if (shardDigest !== artifactDigest(withoutDigest) || shardDigest !== params.summary.artifactDigest) fail(code);
  return { ...withoutDigest, shardDigest } as CaseGraphResearchSearchTermShard;
};

const decodeShardBody = async (params: {
  body: Buffer;
  manifest: CaseGraphResearchSearchManifest;
  summary: CaseGraphResearchSearchShardSummary;
}) => {
  const code = 'case_graph_research_search_shard_integrity_failed';
  if (params.body.length !== params.summary.compressedBytes
    || digestBody(params.body) !== params.summary.compressedSha256) fail(code);
  let plain: Buffer;
  try {
    plain = await gunzipBody(params.body, { maxOutputLength: Math.min(
      MAX_UNCOMPRESSED_SHARD_BYTES,
      params.summary.uncompressedBytes,
    ) }) as Buffer;
  } catch { return fail(code); }
  if (plain.length !== params.summary.uncompressedBytes) fail(code);
  let raw: unknown;
  try { raw = JSON.parse(plain.toString('utf8')); } catch { return fail(code); }
  const shard = params.summary.kind === 'term'
    ? decodeTermShard({ raw, source: params.manifest.source, summary: params.summary })
    : decodeDocumentShard({ raw, source: params.manifest.source, summary: params.summary });
  if (!plain.equals(encode(shard))) fail(code);
  return shard;
};

const readShard = async (params: {
  manifest: CaseGraphResearchSearchManifest;
  storage: CaseGraphPublicStorage;
  kind: CaseGraphResearchSearchShardKind;
  shard: number;
  signal?: AbortSignal;
}) => {
  const summaries = params.manifest.shards.filter((summary) => (
    summary.kind === params.kind && summary.shard === params.shard
  ));
  if (summaries.length !== 1) fail('case_graph_research_search_manifest_invalid');
  const summary = summaries[0];
  const body = await params.storage.readObject(summary.archiveKey, {
    maxBytes: summary.compressedBytes,
    signal: params.signal,
  });
  if (body === null) return fail('case_graph_research_search_shard_missing');
  return decodeShardBody({ body, manifest: params.manifest, summary });
};

const fieldsFromMask = (mask: number) => SEARCH_FIELDS.filter((field) => (mask & FIELD_BITS[field]) !== 0);
const strongestWeight = (mask: number) => Math.max(...fieldsFromMask(mask).map((field) => FIELD_WEIGHTS[field]));

const documentMatchesFilters = (
  document: CaseGraphResearchSearchDocument,
  filters: CaseGraphResearchSearchFilters,
) => {
  if (filters.kinds.length && !filters.kinds.includes(document.kind)) return false;
  if (filters.relationshipStatuses.length
    && !filters.relationshipStatuses.includes(document.relationshipStatus)) return false;
  if (filters.sources.length && !filters.sources.includes(document.source)) return false;
  if (filters.eventStart
    && (document.eventTimestamp === null || document.eventTimestamp < filters.eventStart)) return false;
  if (filters.eventEnd
    && (document.eventTimestamp === null || document.eventTimestamp >= filters.eventEnd)) return false;
  return true;
};

type RankedCandidate = {
  address: string;
  matchedTerms: number;
  weightSum: number;
  fieldMask: number;
  score: number;
};

const rankCandidates = (
  terms: readonly string[],
  shards: readonly CaseGraphResearchSearchTermShard[],
  signal?: AbortSignal,
) => {
  const byAddress = new Map<string, Omit<RankedCandidate, 'address' | 'score'>>();
  const requested = new Set(terms);
  let visited = 0;
  for (const shard of shards) {
    for (const term of shard.terms) {
      if (!requested.has(term.term)) continue;
      for (const posting of term.postings) {
        visited += 1;
        if ((visited & 4095) === 0 && signal?.aborted) fail('case_graph_research_aborted');
        const current = byAddress.get(posting.address) || { matchedTerms: 0, weightSum: 0, fieldMask: 0 };
        current.matchedTerms += 1;
        current.weightSum += strongestWeight(posting.fieldMask);
        current.fieldMask |= posting.fieldMask;
        byAddress.set(posting.address, current);
      }
    }
  }
  return [...byAddress].map(([address, candidate]) => {
    const coverage = candidate.matchedTerms / terms.length;
    const weighted = candidate.weightSum / terms.length;
    const score = Math.min(1, Math.round((coverage * 0.72 + weighted * 0.28) * 1_000_000) / 1_000_000);
    return { address, ...candidate, score };
  }).sort((left, right) => right.score - left.score || compareText(left.address, right.address));
};

const byteLru = <T>(maximumEntries: number, maximumBytes: number) => {
  const values = new Map<string, { value: T; bytes: number }>();
  let retainedBytes = 0;
  return {
    get: (key: string) => {
      const entry = values.get(key);
      if (entry === undefined) return undefined;
      values.delete(key);
      values.set(key, entry);
      return entry.value;
    },
    set: (key: string, value: T, bytes: number) => {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumBytes) return;
      const previous = values.get(key);
      if (previous) retainedBytes -= previous.bytes;
      values.delete(key);
      values.set(key, { value, bytes });
      retainedBytes += bytes;
      while (values.size > maximumEntries || retainedBytes > maximumBytes) {
        const oldest = values.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        const removed = values.get(oldest);
        values.delete(oldest);
        if (removed) retainedBytes -= removed.bytes;
      }
    },
  };
};

const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
) => {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await task(values[index]);
    }
  }));
  return results;
};

export const createImmutableCaseGraphResearchSearchProvider = (params: {
  storage: CaseGraphPublicStorage;
  maxCachedShards?: number;
  maxCachedBytes?: number;
  allowExperimentalR2JsonIndex?: boolean;
}): CaseGraphResearchSearchProvider => {
  requireExperimentalR2JsonIndex(params.allowExperimentalR2JsonIndex);
  const maximum = count(
    params.maxCachedShards ?? DEFAULT_CACHE_ENTRIES,
    512,
    'case_graph_research_search_cache_limit_invalid',
  );
  const maximumBytes = count(
    params.maxCachedBytes ?? DEFAULT_CACHE_BYTES,
    512 * 1024 * 1024,
    'case_graph_research_search_cache_bytes_invalid',
  );
  if (maximum < 1 || maximumBytes < 1024 * 1024) fail('case_graph_research_search_cache_limit_invalid');
  const manifests = byteLru<CaseGraphResearchSearchManifest>(4, MAX_MANIFEST_BYTES * 4);
  const shards = byteLru<CaseGraphResearchSearchDocumentShard | CaseGraphResearchSearchTermShard>(
    maximum,
    maximumBytes,
  );
  const loadManifest = async (active: ActiveCaseGraphPublication, signal?: AbortSignal) => {
    const binding = caseGraphResearchPublicationBinding(active);
    const key = `${binding.publicationId}:${binding.manifestSha256}`;
    const cached = manifests.get(key);
    if (cached) return cached;
    const manifest = await inspectImmutableCaseGraphResearchSearchIndex({ active, storage: params.storage, signal });
    manifests.set(key, manifest, encode(manifest).length);
    return manifest;
  };
  const loadShard = async <K extends CaseGraphResearchSearchShardKind>(
    manifest: CaseGraphResearchSearchManifest,
    kind: K,
    shard: number,
    signal?: AbortSignal,
  ) => {
    const summary = manifest.shards.find((candidate) => candidate.kind === kind && candidate.shard === shard);
    if (!summary) return fail('case_graph_research_search_manifest_invalid');
    const cacheKey = `${manifest.indexSha256}:${summary.archiveKey}`;
    const cached = shards.get(cacheKey);
    if (cached) return cached as K extends 'term'
      ? CaseGraphResearchSearchTermShard
      : CaseGraphResearchSearchDocumentShard;
    const value = await readShard({ manifest, storage: params.storage, kind, shard, signal });
    shards.set(cacheKey, value, summary.uncompressedBytes);
    return value as K extends 'term' ? CaseGraphResearchSearchTermShard : CaseGraphResearchSearchDocumentShard;
  };

  return async ({ active, request: rawRequest, signal }): Promise<CaseGraphResearchSearchCandidates> => {
    if (signal?.aborted) fail('case_graph_research_aborted');
    const decoded = decodeCaseGraphResearchToolRequest(rawRequest);
    if (decoded.tool !== 'search_records') fail('case_graph_research_search_request_invalid');
    const request = decoded as Extract<typeof decoded, { tool: 'search_records' }>;
    if (request.limit > CASE_GRAPH_RESEARCH_LIMITS.searchResults
      || !same(request, rawRequest)) fail('case_graph_research_search_request_invalid');
    if (request.cursor !== null) fail('case_graph_research_search_cursor_invalid');
    const queryTerms = tokenizeCaseGraphResearchSearchQuery(request.query);
    const manifest = await loadManifest(active, signal);
    const termShardNumbers = [...new Set(queryTerms.map((term) => shardFor(term, manifest.termShardCount)))]
      .sort((left, right) => left - right);
    const termSummaries = termShardNumbers.map((shard) => manifest.shards.find((summary) => (
      summary.kind === 'term' && summary.shard === shard
    )) || fail('case_graph_research_search_manifest_invalid'));
    const aggregateTermBytes = termSummaries.reduce((sum, summary) => sum + summary.uncompressedBytes, 0);
    const aggregateCompressedBytes = termSummaries.reduce((sum, summary) => sum + summary.compressedBytes, 0);
    const aggregatePostings = termSummaries.reduce((sum, summary) => sum + summary.postingCount, 0);
    if (aggregateTermBytes > MAX_QUERY_TERM_UNCOMPRESSED_BYTES
      || aggregateCompressedBytes > MAX_QUERY_TERM_COMPRESSED_BYTES
      || aggregatePostings > MAX_QUERY_TERM_POSTINGS) {
      fail('case_graph_research_search_query_too_broad');
    }
    const termShards = await mapWithConcurrency(termShardNumbers, 4, (shard) => (
      loadShard(manifest, 'term', shard, signal)
    ));
    const candidates = rankCandidates(queryTerms, termShards, signal);
    const selected: Array<RankedCandidate & { document: CaseGraphResearchSearchDocument }> = [];
    const documentsByAddress = new Map<string, CaseGraphResearchSearchDocument>();
    const countedDocumentShards = new Set<number>();
    let loadedDocumentBytes = 0;
    for (let offset = 0; offset < candidates.length && selected.length < request.limit; offset += DOCUMENT_SCAN_WINDOW) {
      const window = candidates.slice(offset, offset + DOCUMENT_SCAN_WINDOW);
      const neededShards = [...new Set(window
        .filter((candidate) => !documentsByAddress.has(candidate.address))
        .map((candidate) => shardFor(candidate.address, manifest.documentShardCount)))]
        .sort((left, right) => left - right);
      for (const shard of neededShards) {
        if (countedDocumentShards.has(shard)) continue;
        const summary = manifest.shards.find((candidate) => (
          candidate.kind === 'document' && candidate.shard === shard
        )) || fail('case_graph_research_search_manifest_invalid');
        countedDocumentShards.add(shard);
        loadedDocumentBytes += summary.uncompressedBytes;
      }
      if (loadedDocumentBytes > MAX_QUERY_DOCUMENT_UNCOMPRESSED_BYTES) {
        fail('case_graph_research_search_query_too_broad');
      }
      const documentShards = await mapWithConcurrency(neededShards, 4, (shard) => (
        loadShard(manifest, 'document', shard, signal)
      ));
      for (const shard of documentShards) {
        for (const document of shard.documents) documentsByAddress.set(document.address, document);
      }
      for (const candidate of window) {
        const document = documentsByAddress.get(candidate.address);
        if (!document) return fail('case_graph_research_search_document_missing');
        if (!documentMatchesFilters(document, request.filters)) continue;
        selected.push({ ...candidate, document });
        if (selected.length === request.limit) break;
      }
    }
    return {
      recordType: 'case_graph_research_search_candidates',
      schemaVersion: CASE_GRAPH_RESEARCH_SEARCH_INDEX_VERSION,
      binding: caseGraphResearchPublicationBinding(active),
      indexSha256: manifest.indexSha256,
      normalizedQuery: request.query,
      hits: selected.map((candidate) => ({
        address: candidate.address,
        score: candidate.score,
        matchedFields: fieldsFromMask(candidate.fieldMask).sort(compareText),
        reasonCodes: [
          candidate.matchedTerms === queryTerms.length ? 'all_query_terms_matched' : 'partial_query_match',
          'immutable_lexical_index',
        ].sort(compareText),
      })),
      page: { hasMore: false, nextCursor: null },
    };
  };
};

const immutableUpload = async (params: {
  storage: CaseGraphResearchSearchArchiveStorage;
  key: string;
  body: Buffer;
  contentType: string;
  contentEncoding?: string;
}) => {
  const result: CaseGraphConditionalWriteResult = await params.storage.uploadFileConditional(
    params.body,
    params.key,
    {
      contentType: params.contentType,
      ...(params.contentEncoding ? { contentEncoding: params.contentEncoding } : {}),
      cacheControl: 'private, max-age=31536000, immutable',
      contentLength: params.body.length,
    },
    { ifAbsent: true },
  );
  if (result.status === 'precondition_failed') {
    const existing = await params.storage.readObject(params.key, { maxBytes: params.body.length });
    if (!existing || !existing.equals(params.body)) fail('case_graph_research_search_immutable_conflict');
    return 'reused' as const;
  }
  const stored = await params.storage.readObject(params.key, { maxBytes: params.body.length });
  if (!stored || !stored.equals(params.body)) fail('case_graph_research_search_read_after_write_failed');
  return 'written' as const;
};

export const archiveImmutableCaseGraphResearchSearchIndex = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphResearchSearchArchiveStorage;
  termShardCount?: number;
  documentShardCount?: number;
  signal?: AbortSignal;
  allowExperimentalR2JsonIndex?: boolean;
}) => {
  requireExperimentalR2JsonIndex(params.allowExperimentalR2JsonIndex);
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const nodes: FullCorpusPublicNode[] = [];
  for (let shard = 0; shard < params.active.manifest.topology.nodeShardCount; shard += 1) {
    const value = await readCaseGraphPublicShard({
      active: params.active,
      storage: params.storage,
      kind: 'node',
      shard,
      signal: params.signal,
    });
    nodes.push(...value.items);
  }
  const build = buildImmutableCaseGraphResearchSearchIndex({
    active: params.active,
    nodes,
    termShardCount: params.termShardCount,
    documentShardCount: params.documentShardCount,
  });
  const statuses = [];
  for (const artifact of build.artifacts) {
    statuses.push(await immutableUpload({
      storage: params.storage,
      key: artifact.summary.archiveKey,
      body: artifact.archiveBody,
      contentType: 'application/json',
      contentEncoding: 'gzip',
    }));
  }
  const keys = getCaseGraphResearchSearchControlKeys(
    params.active.corpusVersion,
    params.active.publicationId,
    params.active.manifestSha256,
  );
  const manifestStatus = await immutableUpload({
    storage: params.storage,
    key: keys.manifestKey,
    body: build.manifestBody,
    contentType: 'application/json',
  });
  await inspectImmutableCaseGraphResearchSearchIndex({
    active: params.active,
    storage: params.storage,
    signal: params.signal,
  });
  return {
    manifest: build.manifest,
    manifestStatus,
    writtenShardCount: statuses.filter((status) => status === 'written').length,
    reusedShardCount: statuses.filter((status) => status === 'reused').length,
  };
};

/**
 * Optional stronger preflight used by tests/operations after a completion is
 * created. The request path intentionally reads only query-relevant shards.
 */
export const verifyImmutableCaseGraphResearchSearchIndex = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  signal?: AbortSignal;
}) => {
  const manifest = await inspectImmutableCaseGraphResearchSearchIndex(params);
  const indexedDocuments = new Map<string, CaseGraphResearchSearchDocument>();
  for (const summary of manifest.shards) {
    const shard = await readShard({
      manifest,
      storage: params.storage,
      kind: summary.kind,
      shard: summary.shard,
      signal: params.signal,
    });
    if (shard.recordType !== 'case_graph_research_search_document_shard') continue;
    for (const document of shard.documents) {
      if (indexedDocuments.has(document.address)) {
        fail('case_graph_research_search_document_duplicate');
      }
      indexedDocuments.set(document.address, document);
    }
  }
  if (indexedDocuments.size !== manifest.source.recordCount) {
    fail('case_graph_research_search_document_count_mismatch');
  }
  let verifiedNodeCount = 0;
  for (let shard = 0; shard < params.active.manifest.topology.nodeShardCount; shard += 1) {
    const graphShard = await readCaseGraphPublicShard({
      active: params.active,
      storage: params.storage,
      kind: 'node',
      shard,
      signal: params.signal,
    });
    for (const node of graphShard.items) {
      const document = indexedDocuments.get(node.address);
      if (!document || !same(document, documentFromNode(node))) {
        fail('case_graph_research_search_document_graph_mismatch');
      }
      indexedDocuments.delete(node.address);
      verifiedNodeCount += 1;
    }
  }
  if (indexedDocuments.size || verifiedNodeCount !== manifest.source.recordCount) {
    fail('case_graph_research_search_document_graph_mismatch');
  }
  return manifest;
};

/** Revalidates a bounded set against the active public graph outside the tool loop. */
export const revalidateImmutableCaseGraphResearchSearchAddresses = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  addresses: readonly string[];
  signal?: AbortSignal;
}) => {
  if (params.addresses.length > CASE_GRAPH_RESEARCH_LIMITS.searchResults) {
    fail('case_graph_research_search_revalidation_limit_exceeded');
  }
  const addresses = params.addresses.map((address) => parseCaseGraphEvidenceAddress(address).address);
  if (new Set(addresses).size !== addresses.length) fail('case_graph_research_search_revalidation_invalid');
  const nodes = await getCaseGraphNodes(params.active, params.storage, addresses, params.signal);
  if (nodes.size !== addresses.length) fail('case_graph_research_search_revalidation_failed');
  return addresses.map((address) => nodes.get(address) || fail('case_graph_research_search_revalidation_failed'));
};
