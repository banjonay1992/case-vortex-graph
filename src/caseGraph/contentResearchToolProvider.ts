import { canonicalizeRelationshipInput } from './relationshipInputSnapshot';
import type { CaseGraphResearchContentProvider } from './researchToolContract';
import type { CaseGraphContentServingBinding } from './postgresContentResearchSearch';
import type { CaseGraphContentResearchCursorCodec } from './contentResearchCursor';

type ContentSearch = {
  search: (params: {
    binding: CaseGraphContentServingBinding;
    query: string;
    mediaKinds?: Array<'document' | 'image' | 'audio' | 'video'>;
    textOrigins?: Array<'embedded_text' | 'ocr' | 'asr' | 'human_transcript' | 'machine_caption' | 'frame_ocr' | 'exif'>;
    limit?: number;
    after?: { scoreMicros: number; chunkId: string } | null;
    signal?: AbortSignal;
  }) => Promise<{
    entries: Awaited<ReturnType<ContentSearch['open']>>[];
    hasMore: boolean;
    nextBoundary: { scoreMicros: number; chunkId: string } | null;
  }>;
  open: (params: {
    binding: CaseGraphContentServingBinding;
    chunkId: string;
    signal?: AbortSignal;
  }) => Promise<import('./researchToolContract').CaseGraphResearchContentEntry | null>;
};

const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const invalid = (): never => { throw new Error('case_graph_research_content_cursor_invalid'); };

export const createCaseGraphContentResearchProvider = (params: {
  search: ContentSearch;
  binding: CaseGraphContentServingBinding;
  cursorCodec: CaseGraphContentResearchCursorCodec;
}): CaseGraphResearchContentProvider => {
  const assertPublication = (publication: CaseGraphContentServingBinding['publication']) => {
    if (!same(publication, params.binding.publication)) {
      throw new Error('case_graph_research_publication_changed');
    }
  };
  return {
    search: async ({ publication, request, signal }) => {
      assertPublication(publication);
      const mediaKinds = [...request.mediaKinds].sort();
      const textOrigins = [...request.textOrigins].sort();
      const decoded = request.cursor ? params.cursorCodec.decode(request.cursor) : null;
      if (decoded && (
        decoded.publicationId !== publication.publicationId
        || decoded.publicationManifestSha256 !== publication.manifestSha256
        || decoded.accountingReceiptDigest !== params.binding.accountingReceiptDigest
        || decoded.indexManifestDigest !== params.binding.indexManifestDigest
        || decoded.query !== request.query
        || !same(decoded.mediaKinds, mediaKinds)
        || !same(decoded.textOrigins, textOrigins)
      )) invalid();
      const result = await params.search.search({
        binding: params.binding,
        query: request.query,
        mediaKinds: mediaKinds.length ? mediaKinds : undefined,
        textOrigins: textOrigins.length ? textOrigins : undefined,
        limit: request.limit,
        after: decoded ? { scoreMicros: decoded.scoreMicros, chunkId: decoded.chunkId } : null,
        signal,
      });
      const boundary = result.nextBoundary;
      const nextCursor = result.hasMore && boundary ? params.cursorCodec.encode({
        version: 'case-graph-content-research-cursor-v1',
        sortVersion: 'score-micros-desc-chunk-id-asc-v1',
        publicationId: publication.publicationId,
        publicationManifestSha256: publication.manifestSha256,
        accountingReceiptDigest: params.binding.accountingReceiptDigest,
        indexManifestDigest: params.binding.indexManifestDigest,
        query: request.query,
        mediaKinds,
        textOrigins,
        scoreMicros: boundary.scoreMicros,
        chunkId: boundary.chunkId,
      }) : null;
      if (result.hasMore !== Boolean(nextCursor)) invalid();
      return {
        entries: result.entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        hasMore: result.hasMore,
        nextCursor,
        indexManifestDigest: params.binding.indexManifestDigest,
      };
    },
    open: async ({ publication, chunkId, signal }) => {
      assertPublication(publication);
      return params.search.open({ binding: params.binding, chunkId, signal });
    },
  };
};
