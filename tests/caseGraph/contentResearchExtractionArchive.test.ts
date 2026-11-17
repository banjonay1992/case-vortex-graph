import { describe, expect, it, vi } from 'vitest';

import {
  makeCaseGraphContentAsset,
  makeCaseGraphContentChunk,
  makeCaseGraphContentExtractionContract,
  makeCaseGraphContentExtractionReceipt,
  makeCaseGraphContentLimitsProfile,
} from '../../src/caseGraph/contentResearchArchive';
import { archiveCaseGraphContentExtraction } from '../../src/caseGraph/contentResearchExtractionArchive';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'archive-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-archive', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'archive-limits', maxAssetBytes: 10_000, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 1_000,
  maxTotalTextBytesPerAsset: 10_000, maxChunksPerAsset: 100,
});
const asset = makeCaseGraphContentAsset({
  publication, address: 'document:00000000-0000-4000-8000-000000000010', nodeDigest: digest('6'),
  sourceAssetKey: 'canonical-url:https://example.test/document.pdf', mediaKind: 'document',
  claimedMimeType: 'application/octet-stream', sniffedMimeType: 'application/pdf', byteLength: 100,
  bytesSha256: digest('7'), capturedObjectKey: 'captured/document.bin', capturedObjectSha256: digest('7'),
  searchableObjectKey: 'captured/document.bin', searchableBytesSha256: digest('7'), pageCount: 1,
  imageWidth: null, imageHeight: null, durationMs: null, sourceLocatorDigest: digest('8'),
  sourceLineageDigest: digest('9'), visibility: 'public', rightsPolicyVersion: 'rights-v1',
  rightsEvidenceDigest: digest('a'), safetyPolicyVersion: 'safety-v1', safetyScanDigest: digest('b'),
  redactionPolicyDigest: digest('c'), redactionStatus: 'not_required', redactionTransformationDigest: null,
  terminalStatus: 'extracted', terminalReason: 'fixture',
});
const contract = makeCaseGraphContentExtractionContract({
  asset, limitsProfile,
  extractor: {
    extractorType: 'embedded', extractorId: 'pdftotext', extractorVersion: '26.04.0',
    containerDigest: digest('d'), modelId: null, modelRevision: null, configDigest: digest('e'),
    promptDigest: null, humanProvenanceDigest: null, languageDetectorVersion: 'fixed-en-v1',
  },
});
const chunk = makeCaseGraphContentChunk({
  asset, contract, textOrigin: 'embedded_text', ordinal: 0,
  locator: {
    locatorType: 'document_page', pageNumber: 1, characterStart: 0, characterEnd: 13,
    readingOrder: 0, boundingBox: null,
  },
  text: 'exact evidence', language: 'en', confidence: null,
});
const receipt = makeCaseGraphContentExtractionReceipt({
  asset, contract, chunks: [chunk],
  coverage: { coverageType: 'document', totalPages: 1, processedPages: [1] },
});

const memoryArchive = () => {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    putIfAbsent: vi.fn(async ({ key, body }: { key: string; body: Buffer }) => {
      if (objects.has(key)) return 'exists' as const;
      objects.set(key, Buffer.from(body));
      return 'written' as const;
    }),
    readObject: vi.fn(async (key: string) => objects.get(key) || null),
  };
};

describe('immutable extraction artifact archive', () => {
  it('writes canonical contract/chunks/receipt objects and verifies exact stored bytes', async () => {
    const archive = memoryArchive();
    const pointer = await archiveCaseGraphContentExtraction({ asset, contract, receipt, chunks: [chunk], archive });
    expect(pointer).toMatchObject({
      assetId: asset.assetId, assetDigest: asset.assetDigest,
      extractionContractDigest: contract.contractDigest, chunkCount: 1,
      chunkSetSha256: receipt.chunkSetSha256, pointerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect([...archive.objects.keys()].sort()).toEqual([
      pointer.chunksObjectKey, pointer.contractObjectKey, pointer.receiptObjectKey,
    ].sort());
    expect(archive.putIfAbsent).toHaveBeenCalledTimes(3);
    expect(archive.readObject).toHaveBeenCalledTimes(3);
  });

  it('is byte-deterministic on replay and fails closed on stored-byte mismatch', async () => {
    const archive = memoryArchive();
    const first = await archiveCaseGraphContentExtraction({ asset, contract, receipt, chunks: [chunk], archive });
    const second = await archiveCaseGraphContentExtraction({ asset, contract, receipt, chunks: [chunk], archive });
    expect(second).toEqual(first);
    expect(archive.objects.size).toBe(3);

    const corruptArchive = memoryArchive();
    corruptArchive.readObject.mockImplementation(async () => Buffer.from('tampered'));
    await expect(archiveCaseGraphContentExtraction({
      asset, contract, receipt, chunks: [chunk], archive: corruptArchive,
    })).rejects.toThrow('case_graph_content_extraction_archive_read_after_write_mismatch');
  });

  it('rejects tampered receipts before writing and honours pre-abort', async () => {
    const archive = memoryArchive();
    await expect(archiveCaseGraphContentExtraction({
      asset, contract, receipt: { ...receipt, chunkCount: 2 }, chunks: [chunk], archive,
    })).rejects.toThrow('case_graph_content_extraction_receipt_integrity_failed');
    expect(archive.putIfAbsent).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    await expect(archiveCaseGraphContentExtraction({
      asset, contract, receipt, chunks: [chunk], archive, signal: controller.signal,
    })).rejects.toThrow('case_graph_content_extraction_archive_aborted');
  });
});
