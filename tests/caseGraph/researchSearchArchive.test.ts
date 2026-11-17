import { beforeAll, describe, expect, it } from 'vitest';

import {
  getCaseGraphResearchSearchControlKeys,
} from '../../src/caseGraph/archiveKeys';
import {
  archiveImmutableCaseGraphResearchSearchIndex,
  buildImmutableCaseGraphResearchSearchIndex,
  createImmutableCaseGraphResearchSearchProvider,
  inspectImmutableCaseGraphResearchSearchIndex,
  tokenizeCaseGraphResearchSearchQuery,
  verifyImmutableCaseGraphResearchSearchIndex,
  type CaseGraphResearchSearchArchiveStorage,
  type CaseGraphResearchSearchBuild,
} from '../../src/caseGraph/researchSearchArchive';
import {
  decodeCaseGraphResearchToolRequest,
  executeCaseGraphResearchTool,
} from '../../src/caseGraph/researchToolContract';
import {
  loadActiveCaseGraphPublication,
  type ActiveCaseGraphPublication,
  type CaseGraphPublicQuery,
} from '../../src/caseGraph/publicAccess';
import type { FullCorpusPublicNode } from '../../src/caseGraph/typedRelationshipPublicGraph';
import {
  buildPublicationV2ActivationRow,
  buildPublicationV2Fixture,
} from './publicationV2TestSupport';

type Fixture = ReturnType<typeof buildPublicationV2Fixture>;

class MemoryStorage implements CaseGraphResearchSearchArchiveStorage {
  readonly readKeys: string[] = [];

  constructor(readonly objects: Map<string, Buffer>) {}

  readObject = async (key: string) => {
    this.readKeys.push(key);
    const body = this.objects.get(key);
    return body ? Buffer.from(body) : null;
  };

  uploadFileConditional: CaseGraphResearchSearchArchiveStorage['uploadFileConditional'] = async (
    body,
    key,
    _options,
    condition,
  ) => {
    if ('ifVersion' in condition) throw new Error('unexpected_mutable_write');
    if (this.objects.has(key)) return { status: 'precondition_failed' };
    this.objects.set(key, Buffer.from(body));
    return { status: 'written', key, version: `v:${key}` };
  };
}

let fixture: Fixture;
let active: ActiveCaseGraphPublication;
let nodes: FullCorpusPublicNode[];
let build: CaseGraphResearchSearchBuild;

const cloneObjects = () => new Map(
  [...fixture.objects].map(([key, body]) => [key, Buffer.from(body)]),
);

const installBuild = (storage: MemoryStorage, value = build) => {
  for (const artifact of value.artifacts) {
    storage.objects.set(artifact.summary.archiveKey, Buffer.from(artifact.archiveBody));
  }
  const keys = getCaseGraphResearchSearchControlKeys(
    active.corpusVersion,
    active.publicationId,
    active.manifestSha256,
  );
  storage.objects.set(keys.manifestKey, Buffer.from(value.manifestBody));
};

const searchRequest = (overrides: Record<string, unknown> = {}) => decodeCaseGraphResearchToolRequest({
  tool: 'search_records',
  query: 'official document fixture',
  filters: { kinds: ['document'], sources: ['official'] },
  limit: 5,
  ...overrides,
});

beforeAll(async () => {
  fixture = buildPublicationV2Fixture();
  const storage = new MemoryStorage(cloneObjects());
  const query: CaseGraphPublicQuery = async () => ({ rows: [buildPublicationV2ActivationRow(fixture)] });
  const loaded = await loadActiveCaseGraphPublication({ query, storage });
  if (!loaded) throw new Error('research_search_test_active_publication_missing');
  active = loaded;
  nodes = fixture.publicGraph.shards
    .filter((shard) => shard.shardKind === 'node')
    .flatMap((shard) => shard.items as FullCorpusPublicNode[]);
  build = buildImmutableCaseGraphResearchSearchIndex({
    active,
    nodes,
    termShardCount: 4,
    documentShardCount: 4,
  });
}, 240_000);

describe('immutable Case Graph research search index', () => {
  it('keeps the JSON-shard implementation hard-disabled unless a fixture opts in explicitly', async () => {
    const storage = new MemoryStorage(cloneObjects());
    expect(() => createImmutableCaseGraphResearchSearchProvider({ storage }))
      .toThrow('case_graph_research_search_r2_json_index_disabled');
    await expect(archiveImmutableCaseGraphResearchSearchIndex({ active, storage }))
      .rejects.toThrow('case_graph_research_search_r2_json_index_disabled');
  });

  it('builds byte-identical, address-stable shards regardless of source order', () => {
    const reversed = buildImmutableCaseGraphResearchSearchIndex({
      active,
      nodes: [...nodes].reverse(),
      termShardCount: 4,
      documentShardCount: 4,
    });
    expect(reversed.manifestBody.equals(build.manifestBody)).toBe(true);
    expect(reversed.artifacts.map((artifact) => ({
      key: artifact.summary.archiveKey,
      body: artifact.archiveBody.toString('base64'),
    }))).toEqual(build.artifacts.map((artifact) => ({
      key: artifact.summary.archiveKey,
      body: artifact.archiveBody.toString('base64'),
    })));
    expect(build.manifest.source.nodeSetSha256).toBe(active.manifest.lineage.publicGraph.nodeSetSha256);
    expect(build.manifest.binding).toMatchObject({
      publicationId: active.publicationId,
      corpusVersion: active.corpusVersion,
      manifestSha256: active.manifestSha256,
    });
  });

  it('archives immutable shards before completion and safely reuses exact bytes', async () => {
    const storage = new MemoryStorage(cloneObjects());
    const first = await archiveImmutableCaseGraphResearchSearchIndex({
      active,
      storage,
      allowExperimentalR2JsonIndex: true,
      termShardCount: 4,
      documentShardCount: 4,
    });
    expect(first).toMatchObject({ manifestStatus: 'written', writtenShardCount: 8, reusedShardCount: 0 });
    await expect(verifyImmutableCaseGraphResearchSearchIndex({ active, storage }))
      .resolves.toMatchObject({ indexSha256: first.manifest.indexSha256 });
    const second = await archiveImmutableCaseGraphResearchSearchIndex({
      active,
      storage,
      allowExperimentalR2JsonIndex: true,
      termShardCount: 4,
      documentShardCount: 4,
    });
    expect(second).toMatchObject({ manifestStatus: 'reused', writtenShardCount: 0, reusedShardCount: 8 });
  }, 120_000);

  it('answers from the pinned index and lets the research contract rehydrate the verified node', async () => {
    const storage = new MemoryStorage(cloneObjects());
    installBuild(storage);
    const provider = createImmutableCaseGraphResearchSearchProvider({
      storage,
      allowExperimentalR2JsonIndex: true,
    });
    const result = await executeCaseGraphResearchTool({
      active,
      storage,
      search: provider,
      request: searchRequest(),
      expectedPublication: {
        publicationId: active.publicationId,
        corpusVersion: active.corpusVersion,
        manifestSha256: active.manifestSha256,
      },
    });
    const hits = (result.data as { hits: Array<{ address: string }> }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      address: 'document:official-record-2',
    });
    expect(hits[0]).not.toHaveProperty('node');
    const opened = await executeCaseGraphResearchTool({
      active,
      storage,
      request: { tool: 'open_record', address: hits[0].address },
    });
    expect(opened.data).toMatchObject({
      node: {
        address: 'document:official-record-2',
        source: 'official',
        nodeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(result.publication.manifestSha256).toBe(active.manifestSha256);
    expect((result.data as { index: { indexSha256: string } }).index.indexSha256)
      .toBe(build.manifest.indexSha256);
  }, 120_000);

  it('never reads an older completion for a different active publication', async () => {
    const storage = new MemoryStorage(cloneObjects());
    installBuild(storage);
    const provider = createImmutableCaseGraphResearchSearchProvider({
      storage,
      allowExperimentalR2JsonIndex: true,
    });
    const changed: ActiveCaseGraphPublication = {
      ...active,
      publicationId: '00000000-0000-4000-8000-000000000099',
    };
    await expect(provider({ active: changed, request: searchRequest() as any }))
      .rejects.toThrow('case_graph_research_search_index_missing');
    const oldKey = getCaseGraphResearchSearchControlKeys(
      active.corpusVersion,
      active.publicationId,
      active.manifestSha256,
    ).manifestKey;
    expect(storage.readKeys).not.toContain(oldKey);
    expect(storage.readKeys.at(-1)).toContain(changed.publicationId);
  });

  it('rejects malformed requests and a query that exceeds the lexical term budget', async () => {
    const storage = new MemoryStorage(cloneObjects());
    installBuild(storage);
    const provider = createImmutableCaseGraphResearchSearchProvider({
      storage,
      allowExperimentalR2JsonIndex: true,
    });
    await expect(provider({
      active,
      request: { ...searchRequest(), limit: 51 } as any,
    })).rejects.toThrow('case_graph_research_request_invalid');
    const excessive = Array.from({ length: 25 }, (_, index) => `term${index}`).join(' ');
    const request = decodeCaseGraphResearchToolRequest({
      tool: 'search_records', query: excessive, limit: 5,
    });
    await expect(provider({ active, request: request as any }))
      .rejects.toThrow('case_graph_research_search_query_terms_exceeded');
    expect(() => tokenizeCaseGraphResearchSearchQuery('!!!'))
      .toThrow('case_graph_research_search_query_invalid');
  });

  it('fails closed when the completion is missing or a query-relevant shard is tampered', async () => {
    const missing = new MemoryStorage(cloneObjects());
    await expect(inspectImmutableCaseGraphResearchSearchIndex({ active, storage: missing }))
      .rejects.toThrow('case_graph_research_search_index_missing');

    const storage = new MemoryStorage(cloneObjects());
    installBuild(storage);
    const relevant = build.artifacts.find((artifact) => (
      artifact.kind === 'term'
      && artifact.value.recordType === 'case_graph_research_search_term_shard'
      && artifact.value.terms.some((term) => term.term === 'official')
    ));
    if (!relevant) throw new Error('research_search_test_term_shard_missing');
    const tampered = Buffer.from(relevant.archiveBody);
    tampered[tampered.length - 1] ^= 1;
    storage.objects.set(relevant.summary.archiveKey, tampered);
    const provider = createImmutableCaseGraphResearchSearchProvider({
      storage,
      allowExperimentalR2JsonIndex: true,
    });
    await expect(provider({ active, request: searchRequest() as any }))
      .rejects.toThrow('case_graph_research_search_shard_integrity_failed');
  });

  it('keeps a search hit as a candidate and rejects it when open_record finds node-shard drift', async () => {
    const storage = new MemoryStorage(cloneObjects());
    installBuild(storage);
    const target = nodes.find((node) => node.address === 'document:official-record-2');
    if (!target) throw new Error('research_search_test_target_missing');
    const summary = active.manifest.graphShards.find((candidate) => (
      candidate.shardKind === 'node'
      && fixture.publicGraph.shards.some((shard) => (
        shard.shardKind === 'node'
        && shard.shard === candidate.shard
        && (shard.items as FullCorpusPublicNode[]).some((node) => node.address === target.address)
      ))
    ));
    if (!summary) throw new Error('research_search_test_node_shard_missing');
    const body = storage.objects.get(summary.archiveKey);
    if (!body) throw new Error('research_search_test_node_archive_missing');
    const tampered = Buffer.from(body);
    tampered[Math.max(0, tampered.length - 2)] ^= 1;
    storage.objects.set(summary.archiveKey, tampered);
    const searched = await executeCaseGraphResearchTool({
      active,
      storage,
      search: createImmutableCaseGraphResearchSearchProvider({
        storage,
        allowExperimentalR2JsonIndex: true,
      }),
      request: searchRequest(),
    });
    const hits = (searched.data as { hits: Array<{ address: string }> }).hits;
    expect(hits).toContainEqual(expect.objectContaining({ address: target.address }));
    await expect(executeCaseGraphResearchTool({
      active,
      storage,
      request: { tool: 'open_record', address: target.address },
    })).rejects.toThrow();
  }, 120_000);
});
