import { describe, expect, it, vi } from 'vitest';

import { createPostgresClaimEvidenceBackfillContentSource } from '../../src/caseGraph/postgresClaimEvidenceBackfillSource';
import type {
  CaseGraphContentPostgresQuery,
  CaseGraphContentServingBinding,
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
  accountingReceiptDigest: d('6'), indexManifestDigest: d('7'), expectedEntryCount: 3,
};

const row = (suffix: string): Record<string, unknown> => ({
  chunk_id: `content-chunk:${d(suffix)}`, chunk_digest: d('9'),
  address: `document:${suffix}`, asset_id: `content-asset:${d('a')}`, asset_digest: d('b'),
  extraction_contract_digest: d('c'), extraction_receipt_digest: d('d'),
  extraction_pointer_digest: d('e'), media_kind: 'document', text_origin: 'embedded_text',
  locator: { locatorType: 'document_page', pageNumber: 1, characterStart: 0, characterEnd: 13, readingOrder: 0, boundingBox: null },
  text: 'exact evidence', language: 'en', confidence: null, score_micros: 0,
});

describe('publication-pinned Postgres claim backfill content source', () => {
  it('lists a verified build with bounded keyset pagination', async () => {
    const query = vi.fn<CaseGraphContentPostgresQuery>(async () => ({
      rows: [row('8'), row('9'), row('a')],
    }));
    const source = createPostgresClaimEvidenceBackfillContentSource({ query, binding });
    const page = await source.readPage({
      publication: binding.publication,
      cursor: null,
      limit: 2,
    });

    expect(page.entries.map(({ chunkId }) => chunkId)).toEqual([
      `content-chunk:${d('8')}`,
      `content-chunk:${d('9')}`,
    ]);
    expect(page.nextCursor).toBe(`content-chunk:${d('9')}`);
    expect(page).toMatchObject({ totalEntryCount: 3, indexManifestDigest: d('7') });
    const [sql, values, options] = query.mock.calls[0]!;
    expect(sql).toContain("build.status = 'verified'");
    expect(sql).toContain('chunk.chunk_id COLLATE "C" >');
    expect(values).toEqual([
      binding.publication.publicationId, binding.publication.manifestSha256,
      binding.accountingReceiptDigest, binding.indexManifestDigest, 3, null, 3,
    ]);
    expect(options).toMatchObject({ statementTimeoutMs: 5_000, queryTimeoutMs: 5_000 });
  });

  it('rejects publication drift, malformed cursors and invalid database rows', async () => {
    const query = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [] }));
    const source = createPostgresClaimEvidenceBackfillContentSource({ query, binding });
    await expect(source.readPage({
      publication: { ...binding.publication, manifestSha256: d('f') }, cursor: null, limit: 2,
    })).rejects.toThrow('claim_backfill_postgres_publication_mismatch');
    await expect(source.readPage({
      publication: binding.publication, cursor: 'not-a-chunk', limit: 2,
    })).rejects.toThrow('claim_backfill_postgres_cursor_invalid');
    expect(query).not.toHaveBeenCalled();

    const hostile = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [{ ...row('8'), text: '' }] }));
    await expect(createPostgresClaimEvidenceBackfillContentSource({ query: hostile, binding }).readPage({
      publication: binding.publication, cursor: null, limit: 2,
    })).rejects.toThrow('case_graph_content_search_row_invalid');
  });
});
