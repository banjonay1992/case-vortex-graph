import { describe, expect, it } from 'vitest';

import {
  makeCaseGraphContentLimitsProfile,
} from '../../src/caseGraph/contentResearchArchive';
import { extractCaseGraphImageContent } from '../../src/caseGraph/contentResearchImageExtraction';
import { imageAsset, imageExtractor, imageLimits } from './contentResearchImageFixtures';

describe('governed image metadata and OCR extraction', () => {
  it('creates separate metadata and OCR receipts with deterministic exact locators', () => {
    const bundles = extractCaseGraphImageContent({
      asset: imageAsset, limitsProfile: imageLimits,
      metadataExtractor: imageExtractor('metadata', 'd'), ocrExtractor: imageExtractor('ocr', 'f'),
      metadataFields: [
        { field: 'Model', text: 'Camera X' },
        { field: 'Make', text: 'Maker' },
      ],
      ocrRegions: [{
        text: 'LIGHT 1978', language: 'en', confidence: 0.92,
        boundingBox: [0.1, 0.2, 0.4, 0.2], regionLabel: 'ocr-line:1',
      }],
    });
    expect(bundles.map(({ contract }) => contract.textOrigin).sort()).toEqual(['exif', 'frame_ocr']);
    const metadata = bundles.find(({ contract }) => contract.textOrigin === 'exif')!;
    expect(metadata.chunks.map(({ locator, text }) => [locator, text])).toEqual([
      [{ locatorType: 'exif_field', field: 'Make' }, 'Maker'],
      [{ locatorType: 'exif_field', field: 'Model' }, 'Camera X'],
    ]);
    const ocr = bundles.find(({ contract }) => contract.textOrigin === 'frame_ocr')!;
    expect(ocr.chunks[0]).toMatchObject({
      text: 'LIGHT 19', confidence: 0.92,
      locator: { locatorType: 'image_region', boundingBox: [0.1, 0.2, 0.4, 0.2] },
    });
    expect(ocr.receipt.coverage).toEqual({ coverageType: 'image', totalPixels: 5_000, processedPixels: 5_000 });
  });

  it('rejects duplicate metadata, empty results and aggregate budget overflow', () => {
    const base = {
      asset: imageAsset, limitsProfile: imageLimits,
      metadataExtractor: imageExtractor('metadata', 'd'), ocrExtractor: imageExtractor('ocr', 'f'),
      ocrRegions: [],
    };
    expect(() => extractCaseGraphImageContent({
      ...base,
      metadataFields: [{ field: 'Make', text: 'A' }, { field: 'Make', text: 'B' }],
    })).toThrow('case_graph_image_metadata_field_duplicate');
    expect(() => extractCaseGraphImageContent({ ...base, metadataFields: [] }))
      .toThrow('case_graph_image_has_no_searchable_content');
    const tinyLimits = makeCaseGraphContentLimitsProfile({
      profileId: 'image-tiny', maxAssetBytes: 100_000, maxDocumentPages: 10,
      maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 8,
      maxTotalTextBytesPerAsset: 3, maxChunksPerAsset: 100,
    });
    expect(() => extractCaseGraphImageContent({
      ...base, limitsProfile: tinyLimits, metadataFields: [{ field: 'Make', text: 'too long' }],
    })).toThrow('case_graph_content_total_text_limit_exceeded');
  });
});
