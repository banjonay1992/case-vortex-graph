import {
  CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS,
  decodeCaseGraphContentSearchRow,
  type CaseGraphContentPostgresQuery,
  type CaseGraphContentServingBinding,
} from './postgresContentResearchSearch';
import type { ClaimEvidenceBackfillContentSource } from './claimEvidenceFullCorpusBackfill';
import { canonicalizeRelationshipInput } from './relationshipInputSnapshot';

export const CLAIM_EVIDENCE_POSTGRES_BACKFILL_SOURCE_VERSION = 'case-graph-claim-evidence-postgres-backfill-source-v1' as const;

const CHUNK_ID = /^content-chunk:[a-f0-9]{64}$/;
const fail = (code: string): never => { throw new Error(code); };

const SQL = `
SELECT chunk.*, 0::bigint AS score_micros
FROM public.case_graph_content_search_chunks AS chunk
JOIN public.case_graph_content_search_builds AS build ON build.publication_id = chunk.publication_id
WHERE build.publication_id = $1::uuid
  AND build.public_manifest_sha256 = $2::text
  AND build.accounting_receipt_digest = $3::text
  AND build.index_manifest_digest = $4::text
  AND build.expected_entry_count = $5::bigint
  AND build.status = 'verified'
  AND ($6::text IS NULL OR chunk.chunk_id COLLATE "C" > $6::text COLLATE "C")
ORDER BY chunk.chunk_id COLLATE "C" ASC
LIMIT $7::integer`;

export const createPostgresClaimEvidenceBackfillContentSource = (params: {
  query: CaseGraphContentPostgresQuery;
  binding: CaseGraphContentServingBinding;
}): ClaimEvidenceBackfillContentSource => ({
  readPage: async ({ publication, cursor, limit, signal }) => {
    if (signal?.aborted) fail('claim_backfill_postgres_aborted');
    if (canonicalizeRelationshipInput(publication)
      !== canonicalizeRelationshipInput(params.binding.publication)) {
      fail('claim_backfill_postgres_publication_mismatch');
    }
    if (cursor !== null && !CHUNK_ID.test(cursor)) fail('claim_backfill_postgres_cursor_invalid');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) fail('claim_backfill_postgres_limit_invalid');
    const result = await params.query(SQL, [
      params.binding.publication.publicationId,
      params.binding.publication.manifestSha256,
      params.binding.accountingReceiptDigest,
      params.binding.indexManifestDigest,
      params.binding.expectedEntryCount,
      cursor,
      limit + 1,
    ], {
      statementTimeoutMs: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.timeoutMs,
      queryTimeoutMs: CASE_GRAPH_CONTENT_POSTGRES_SEARCH_LIMITS.timeoutMs,
      signal,
    });
    if (!result || !Array.isArray(result.rows) || result.rows.length > limit + 1) {
      fail('claim_backfill_postgres_result_invalid');
    }
    const decoded = result.rows.map(decodeCaseGraphContentSearchRow);
    const hasMore = decoded.length > limit;
    const entries = decoded.slice(0, limit);
    const nextCursor = hasMore
      ? entries[entries.length - 1]?.chunkId ?? fail('claim_backfill_postgres_result_invalid')
      : null;
    return {
      entries,
      nextCursor,
      totalEntryCount: params.binding.expectedEntryCount,
      indexManifestDigest: params.binding.indexManifestDigest,
    };
  },
});
