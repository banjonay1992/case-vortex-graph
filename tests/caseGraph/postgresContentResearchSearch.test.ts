import { describe, expect, it, vi } from 'vitest';

import {
  createCaseGraphContentPostgresSearch,
  type CaseGraphContentPostgresQuery,
  type CaseGraphContentServingBinding,
} from '../../src/caseGraph/postgresContentResearchSearch';

const d = (value: string) => value.repeat(64);
const binding: CaseGraphContentServingBinding = {
  publication: {
    publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'v1',
    manifestSha256: d('1'), snapshotId: 'snapshot', graphArtifactSetSha256: d('2'),
    relationshipSchemaVersion: 'schema', relationshipPolicyVersion: 'policy', relationshipPolicySha256: d('3'),
    relationshipModelId: 'model', relationshipModelVersion: 'v1', relationshipModelSha256: d('4'),
    calibrationSetSha256: d('5'),
  },
  accountingReceiptDigest: d('6'), indexManifestDigest: d('7'), expectedEntryCount: 100,
};
const row = (suffix = '8', score = 900_000): Record<string, unknown> => ({
  chunk_id: `content-chunk:${d(suffix)}`, chunk_digest: d('9'),
  address: 'document:00000000-0000-4000-8000-000000000010',
  asset_id: `content-asset:${d('a')}`, asset_digest: d('b'), extraction_contract_digest: d('c'),
  extraction_receipt_digest: d('d'), extraction_pointer_digest: d('e'), media_kind: 'document',
  text_origin: 'embedded_text', locator: {
    locatorType: 'document_page', pageNumber: 2, characterStart: 0, characterEnd: 13,
    readingOrder: 0, boundingBox: null,
  },
  text: 'exact evidence', language: 'en', confidence: null, score_micros: score,
});

describe('bounded publication-pinned PostgreSQL content search', () => {
  it('binds every query to a verified exact build and emits a deterministic boundary', async () => {
    const query = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [row('8'), row('f', 800_000)] }));
    const result = await createCaseGraphContentPostgresSearch(query).search({
      binding, query: 'roswell memorandum', mediaKinds: ['document'], textOrigins: ['embedded_text'], limit: 1,
    });
    expect(result).toMatchObject({
      hasMore: true,
      nextBoundary: { scoreMicros: 900_000, chunkId: `content-chunk:${d('8')}` },
    });
    expect(result.entries[0].locator).toEqual(row().locator);
    const [sql, values, options] = query.mock.calls[0];
    expect(sql).toContain("websearch_to_tsquery('pg_catalog.simple'::regconfig");
    expect(sql).toContain("build.status = 'verified'");
    expect(sql).toContain('build.index_manifest_digest = $4::text');
    expect(values.slice(0, 6)).toEqual([
      binding.publication.publicationId, binding.publication.manifestSha256,
      binding.accountingReceiptDigest, binding.indexManifestDigest, 100, 'roswell memorandum',
    ]);
    expect(values.at(-1)).toBe(2);
    expect(options).toMatchObject({ statementTimeoutMs: 5_000, queryTimeoutMs: 5_000 });
  });

  it('opens only an exact chunk through the same verified publication binding', async () => {
    const query = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [row()] }));
    const result = await createCaseGraphContentPostgresSearch(query).open({
      binding, chunkId: `content-chunk:${d('8')}`,
    });
    expect(result?.text).toBe('exact evidence');
    expect(query.mock.calls[0][0]).toContain('chunk.chunk_id = $6::text');
    expect(query.mock.calls[0][1].at(-1)).toBe(`content-chunk:${d('8')}`);
  });

  it('rejects abusive requests, invalid cursors and incompatible result locators', async () => {
    const query = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [] }));
    const provider = createCaseGraphContentPostgresSearch(query);
    await expect(provider.search({ binding, query: '   ' })).rejects.toThrow('case_graph_content_search_query_invalid');
    await expect(provider.search({ binding, query: 'x', mediaKinds: [] }))
      .rejects.toThrow('case_graph_content_search_filters_invalid');
    await expect(provider.search({
      binding, query: 'x', after: { scoreMicros: -1, chunkId: `content-chunk:${d('8')}` },
    })).rejects.toThrow('case_graph_content_search_cursor_invalid');
    expect(query).not.toHaveBeenCalled();

    const hostile = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [{
      ...row(), locator: { locatorType: 'timed_media', startMs: 0, endMs: 1, keyframeMs: null,
        speaker: null, channel: null },
    }] }));
    await expect(createCaseGraphContentPostgresSearch(hostile).search({ binding, query: 'x' }))
      .rejects.toThrow('case_graph_content_search_row_invalid');
  });
});
