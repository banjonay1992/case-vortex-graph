import { describe, expect, it, vi } from 'vitest';

import { createCaseGraphContentResearchCursorCodec } from '../../src/caseGraph/contentResearchCursor';
import { createCaseGraphContentResearchProvider } from '../../src/caseGraph/contentResearchToolProvider';
import type { CaseGraphContentServingBinding } from '../../src/caseGraph/postgresContentResearchSearch';
import type { CaseGraphResearchContentEntry } from '../../src/caseGraph/researchToolContract';

const d = (value: string) => value.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'v1', manifestSha256: d('1'),
  snapshotId: 'snapshot', graphArtifactSetSha256: d('2'), relationshipSchemaVersion: 'schema',
  relationshipPolicyVersion: 'policy', relationshipPolicySha256: d('3'), relationshipModelId: 'model',
  relationshipModelVersion: 'v1', relationshipModelSha256: d('4'), calibrationSetSha256: d('5'),
};
const binding: CaseGraphContentServingBinding = {
  publication, accountingReceiptDigest: d('6'), indexManifestDigest: d('7'), expectedEntryCount: 1,
};
const entry: CaseGraphResearchContentEntry = {
  chunkId: `content-chunk:${d('8')}`, chunkDigest: d('9'),
  address: 'document:00000000-0000-4000-8000-000000000010', assetId: `content-asset:${d('a')}`,
  assetDigest: d('b'), extractionContractDigest: d('c'), extractionReceiptDigest: d('d'),
  extractionPointerDigest: d('e'), mediaKind: 'document', textOrigin: 'embedded_text',
  locator: { locatorType: 'document_page', pageNumber: 2, characterStart: 0, characterEnd: 12,
    readingOrder: 0, boundingBox: null }, text: 'Roswell memo', language: 'en', confidence: null,
  scoreMicros: 900_000,
};
const request = {
  tool: 'search_content' as const, query: 'roswell memo', mediaKinds: ['document'] as ['document'],
  textOrigins: ['embedded_text'] as ['embedded_text'], limit: 1, cursor: null,
};

describe('signed publication-bound Luna content provider', () => {
  it('signs the deterministic boundary and restores it only for the exact query and filters', async () => {
    const search = vi.fn(async () => ({
      entries: [entry], hasMore: true,
      nextBoundary: { scoreMicros: entry.scoreMicros, chunkId: entry.chunkId },
    }));
    const open = vi.fn(async () => entry);
    const provider = createCaseGraphContentResearchProvider({
      search: { search, open }, binding,
      cursorCodec: createCaseGraphContentResearchCursorCodec('content-cursor-secret-at-least-32-bytes'),
    });
    const first = await provider.search({ publication, request });
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(first.indexManifestDigest).toBe(binding.indexManifestDigest);
    await provider.search({ publication, request: { ...request, cursor: first.nextCursor } });
    expect(search.mock.calls[1][0].after).toEqual({ scoreMicros: 900_000, chunkId: entry.chunkId });
    await expect(provider.search({
      publication, request: { ...request, query: 'different', cursor: first.nextCursor },
    })).rejects.toThrow('case_graph_research_content_cursor_invalid');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('rejects cursor tampering and publication drift before querying content', async () => {
    const search = vi.fn(async () => ({ entries: [entry], hasMore: false, nextBoundary: null }));
    const provider = createCaseGraphContentResearchProvider({
      search: { search, open: async () => entry }, binding,
      cursorCodec: createCaseGraphContentResearchCursorCodec('content-cursor-secret-at-least-32-bytes'),
    });
    const good = createCaseGraphContentResearchCursorCodec('content-cursor-secret-at-least-32-bytes').encode({
      version: 'case-graph-content-research-cursor-v1', sortVersion: 'score-micros-desc-chunk-id-asc-v1',
      publicationId: publication.publicationId, publicationManifestSha256: publication.manifestSha256,
      accountingReceiptDigest: binding.accountingReceiptDigest, indexManifestDigest: binding.indexManifestDigest,
      query: request.query, mediaKinds: request.mediaKinds, textOrigins: request.textOrigins,
      scoreMicros: entry.scoreMicros, chunkId: entry.chunkId,
    });
    await expect(provider.search({ publication, request: { ...request, cursor: `${good.slice(0, -1)}A` } }))
      .rejects.toThrow('case_graph_research_content_cursor_invalid');
    await expect(provider.open({ publication: { ...publication, manifestSha256: d('0') }, chunkId: entry.chunkId }))
      .rejects.toThrow('case_graph_research_publication_changed');
    expect(search).not.toHaveBeenCalled();
  });
});
