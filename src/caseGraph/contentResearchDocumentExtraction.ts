import {
  makeCaseGraphContentChunk,
  makeCaseGraphContentExtractionContract,
  makeCaseGraphContentExtractionReceipt,
  verifyCaseGraphContentAsset,
  verifyCaseGraphContentLimitsProfile,
  type CaseGraphContentAsset,
  type CaseGraphContentChunk,
  type CaseGraphContentExtractionContract,
  type CaseGraphContentExtractionReceipt,
  type CaseGraphContentExtractor,
  type CaseGraphContentLimitsProfile,
} from './contentResearchArchive';

export const CASE_GRAPH_DOCUMENT_EXTRACTION_POLICY = Object.freeze({
  version: 'case-graph-document-page-extraction-v1',
} as const);

export type CaseGraphDocumentPageText = {
  text: string;
  language: string;
  confidence: number | null;
  warnings?: string[];
};

export type CaseGraphDocumentExtractionBundle = {
  contract: CaseGraphContentExtractionContract;
  receipt: CaseGraphContentExtractionReceipt;
  chunks: CaseGraphContentChunk[];
};

const chunksOf = (text: string, maximumBytes: number) => {
  const chunks: Array<{ text: string; characterStart: number; characterEnd: number }> = [];
  let current = '';
  let characterStart = 0;
  let offset = 0;
  for (const character of text) {
    if (current && Buffer.byteLength(current + character, 'utf8') > maximumBytes) {
      chunks.push({ text: current, characterStart, characterEnd: offset });
      current = '';
      characterStart = offset;
    }
    if (Buffer.byteLength(character, 'utf8') > maximumBytes) {
      throw new Error('case_graph_document_character_exceeds_chunk_limit');
    }
    current += character;
    offset += character.length;
  }
  if (current) chunks.push({ text: current, characterStart, characterEnd: offset });
  return chunks;
};

const buildBundle = (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  extractor: CaseGraphContentExtractor;
  pages: Array<{ pageNumber: number; result: CaseGraphDocumentPageText }>;
  warnings: string[];
}) => {
  if (!params.pages.length) return null;
  const contract = makeCaseGraphContentExtractionContract({
    asset: params.asset,
    limitsProfile: params.limitsProfile,
    extractor: params.extractor,
  });
  const chunks: CaseGraphContentChunk[] = [];
  for (const page of params.pages) {
    for (const part of chunksOf(page.result.text, params.limitsProfile.maxChunkTextBytes)) {
      chunks.push(makeCaseGraphContentChunk({
        asset: params.asset,
        contract,
        textOrigin: contract.textOrigin,
        ordinal: chunks.length,
        locator: {
          locatorType: 'document_page',
          pageNumber: page.pageNumber,
          characterStart: part.characterStart,
          characterEnd: part.characterEnd,
          readingOrder: chunks.length,
          boundingBox: null,
        },
        text: part.text,
        language: page.result.language,
        confidence: page.result.confidence,
        warnings: page.result.warnings,
      }));
    }
  }
  if (!chunks.length) return null;
  const pageCount = params.asset.pageCount!;
  const receipt = makeCaseGraphContentExtractionReceipt({
    asset: params.asset,
    contract,
    chunks,
    coverage: {
      coverageType: 'document',
      totalPages: pageCount,
      processedPages: Array.from({ length: pageCount }, (_, index) => index + 1),
    },
    warnings: params.warnings,
  });
  return { contract, receipt, chunks } satisfies CaseGraphDocumentExtractionBundle;
};

export const extractCaseGraphDocumentPages = async (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  embeddedExtractor: CaseGraphContentExtractor & { extractorType: 'embedded' };
  ocrExtractor: CaseGraphContentExtractor & { extractorType: 'ocr' };
  extractEmbeddedPage: (pageNumber: number, signal?: AbortSignal) => Promise<CaseGraphDocumentPageText>;
  extractOcrPage: (pageNumber: number, signal?: AbortSignal) => Promise<CaseGraphDocumentPageText>;
  signal?: AbortSignal;
}): Promise<CaseGraphDocumentExtractionBundle[]> => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const limitsProfile = verifyCaseGraphContentLimitsProfile(params.limitsProfile);
  if (asset.mediaKind !== 'document' || asset.terminalStatus !== 'extracted' || asset.pageCount === null) {
    throw new Error('case_graph_document_asset_not_extractable');
  }
  const embeddedPages: Array<{ pageNumber: number; result: CaseGraphDocumentPageText }> = [];
  const ocrPages: Array<{ pageNumber: number; result: CaseGraphDocumentPageText }> = [];
  let totalTextBytes = 0;
  let totalChunks = 0;
  for (let pageNumber = 1; pageNumber <= asset.pageCount; pageNumber += 1) {
    if (params.signal?.aborted) throw new Error('case_graph_document_extraction_aborted');
    let result = await params.extractEmbeddedPage(pageNumber, params.signal);
    let destination = embeddedPages;
    if (!result.text.trim()) {
      result = await params.extractOcrPage(pageNumber, params.signal);
      destination = ocrPages;
    }
    if (!result.text.trim()) continue;
    const additions = chunksOf(result.text, limitsProfile.maxChunkTextBytes);
    totalTextBytes += Buffer.byteLength(result.text, 'utf8');
    totalChunks += additions.length;
    if (totalTextBytes > limitsProfile.maxTotalTextBytesPerAsset) {
      throw new Error('case_graph_content_total_text_limit_exceeded');
    }
    if (totalChunks > limitsProfile.maxChunksPerAsset) {
      throw new Error('case_graph_content_chunk_count_invalid');
    }
    destination.push({ pageNumber, result });
  }
  if (!embeddedPages.length && !ocrPages.length) {
    throw new Error('case_graph_document_has_no_searchable_text');
  }
  const bundles = [
    buildBundle({
      asset,
      limitsProfile,
      extractor: params.embeddedExtractor,
      pages: embeddedPages,
      warnings: ocrPages.length ? ['scanned pages are represented by a separate OCR receipt'] : [],
    }),
    buildBundle({
      asset,
      limitsProfile,
      extractor: params.ocrExtractor,
      pages: ocrPages,
      warnings: ['OCR applied only where embedded page text was absent'],
    }),
  ].filter((value): value is CaseGraphDocumentExtractionBundle => value !== null);
  return bundles;
};
