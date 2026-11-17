import { describe, expect, it, vi } from 'vitest';

import {
  makeCaseGraphContentAsset,
  makeCaseGraphContentLimitsProfile,
  type CaseGraphContentExtractor,
} from '../../src/caseGraph/contentResearchArchive';
import { extractCaseGraphDocumentPages } from '../../src/caseGraph/contentResearchDocumentExtraction';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'document-extraction-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-document-extraction', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'document-extraction-limits', maxAssetBytes: 10_000, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 8,
  maxTotalTextBytesPerAsset: 1_000, maxChunksPerAsset: 100,
});
const asset = makeCaseGraphContentAsset({
  publication, address: 'document:00000000-0000-4000-8000-000000000010', nodeDigest: digest('6'),
  sourceAssetKey: 'canonical-url:https://example.test/document.pdf', mediaKind: 'document',
  claimedMimeType: 'application/octet-stream', sniffedMimeType: 'application/pdf', byteLength: 100,
  bytesSha256: digest('7'), capturedObjectKey: 'captured/document.bin', capturedObjectSha256: digest('7'),
  searchableObjectKey: 'captured/document.bin', searchableBytesSha256: digest('7'), pageCount: 3,
  imageWidth: null, imageHeight: null, durationMs: null, sourceLocatorDigest: digest('8'),
  sourceLineageDigest: digest('9'), visibility: 'public', rightsPolicyVersion: 'rights-v1',
  rightsEvidenceDigest: digest('a'), safetyPolicyVersion: 'safety-v1', safetyScanDigest: digest('b'),
  redactionPolicyDigest: digest('c'), redactionStatus: 'not_required', redactionTransformationDigest: null,
  terminalStatus: 'extracted', terminalReason: 'fixture',
});
const extractor = (
  extractorType: 'embedded' | 'ocr',
  suffix: string,
): CaseGraphContentExtractor & { extractorType: typeof extractorType } => ({
  extractorType, extractorId: `${extractorType}-page-extractor`, extractorVersion: '1.0.0',
  containerDigest: digest(suffix), modelId: extractorType === 'ocr' ? 'tesseract-eng' : null,
  modelRevision: extractorType === 'ocr' ? '5.x' : null, configDigest: digest('e'), promptDigest: null,
  humanProvenanceDigest: null, languageDetectorVersion: 'fixed-en-v1',
});

describe('page-exact governed PDF extraction', () => {
  it('keeps embedded and OCR pages in separate provenance receipts with exact locators', async () => {
    const extractEmbeddedPage = vi.fn(async (pageNumber: number) => ({
      text: pageNumber === 2 ? '   ' : pageNumber === 1 ? 'alpha beta' : 'gamma',
      language: 'en', confidence: null,
    }));
    const extractOcrPage = vi.fn(async () => ({
      text: 'scanned page', language: 'en', confidence: 0.91, warnings: ['ocr'],
    }));
    const bundles = await extractCaseGraphDocumentPages({
      asset, limitsProfile, embeddedExtractor: extractor('embedded', 'd'),
      ocrExtractor: extractor('ocr', 'f'), extractEmbeddedPage, extractOcrPage,
    });
    expect(bundles).toHaveLength(2);
    const embedded = bundles.find(({ contract }) => contract.textOrigin === 'embedded_text')!;
    const ocr = bundles.find(({ contract }) => contract.textOrigin === 'ocr')!;
    expect(embedded.chunks.map((chunk) => [chunk.locator, chunk.text])).toEqual([
      [expect.objectContaining({ pageNumber: 1, characterStart: 0, characterEnd: 8 }), 'alpha be'],
      [expect.objectContaining({ pageNumber: 1, characterStart: 8, characterEnd: 10 }), 'ta'],
      [expect.objectContaining({ pageNumber: 3, characterStart: 0, characterEnd: 5 }), 'gamma'],
    ]);
    expect(ocr.chunks.every((chunk) => chunk.confidence === 0.91 && chunk.locator.locatorType === 'document_page'))
      .toBe(true);
    expect(embedded.receipt.coverage).toEqual({ coverageType: 'document', totalPages: 3, processedPages: [1, 2, 3] });
    expect(ocr.receipt.coverage).toEqual({ coverageType: 'document', totalPages: 3, processedPages: [1, 2, 3] });
    expect(extractOcrPage).toHaveBeenCalledTimes(1);
    expect(extractOcrPage).toHaveBeenCalledWith(2, undefined);
  });

  it('rejects silent documents and enforces the aggregate text budget before receipts', async () => {
    await expect(extractCaseGraphDocumentPages({
      asset, limitsProfile, embeddedExtractor: extractor('embedded', 'd'), ocrExtractor: extractor('ocr', 'f'),
      extractEmbeddedPage: async () => ({ text: '', language: 'en', confidence: null }),
      extractOcrPage: async () => ({ text: '', language: 'en', confidence: 0 }),
    })).rejects.toThrow('case_graph_document_has_no_searchable_text');

    const tinyLimits = makeCaseGraphContentLimitsProfile({
      profileId: 'tiny-text-limit', maxAssetBytes: 10_000, maxDocumentPages: 10,
      maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 8,
      maxTotalTextBytesPerAsset: 5, maxChunksPerAsset: 100,
    });
    await expect(extractCaseGraphDocumentPages({
      asset, limitsProfile: tinyLimits, embeddedExtractor: extractor('embedded', 'd'),
      ocrExtractor: extractor('ocr', 'f'),
      extractEmbeddedPage: async () => ({ text: 'too much', language: 'en', confidence: null }),
      extractOcrPage: vi.fn(),
    })).rejects.toThrow('case_graph_content_total_text_limit_exceeded');
  });

  it('honours cancellation between pages', async () => {
    const controller = new AbortController();
    const extractEmbeddedPage = vi.fn(async () => {
      controller.abort();
      return { text: 'first', language: 'en', confidence: null };
    });
    await expect(extractCaseGraphDocumentPages({
      asset, limitsProfile, embeddedExtractor: extractor('embedded', 'd'), ocrExtractor: extractor('ocr', 'f'),
      extractEmbeddedPage, extractOcrPage: vi.fn(), signal: controller.signal,
    })).rejects.toThrow('case_graph_document_extraction_aborted');
  });
});
