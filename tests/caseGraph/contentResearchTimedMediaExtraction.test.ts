import { describe, expect, it } from 'vitest';

import {
  makeCaseGraphContentAsset,
  makeCaseGraphContentLimitsProfile,
  type CaseGraphContentExtractor,
} from '../../src/caseGraph/contentResearchArchive';
import { extractCaseGraphTimedMediaContent } from '../../src/caseGraph/contentResearchTimedMediaExtraction';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'timed-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-timed', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'timed-limits', maxAssetBytes: 100_000, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 10,
  maxTotalTextBytesPerAsset: 1_000, maxChunksPerAsset: 100,
});
const asset = (mediaKind: 'audio' | 'video' = 'video') => makeCaseGraphContentAsset({
  publication, address: 'video:00000000-0000-4000-8000-000000000010', nodeDigest: digest('6'),
  sourceAssetKey: 'canonical-url:https://example.test/media', mediaKind,
  claimedMimeType: 'application/octet-stream', sniffedMimeType: mediaKind === 'video' ? 'video/mp4' : 'audio/wav',
  byteLength: 100, bytesSha256: digest('7'), capturedObjectKey: 'captured/media.bin',
  capturedObjectSha256: digest('7'), searchableObjectKey: 'captured/media.bin', searchableBytesSha256: digest('7'),
  pageCount: null, imageWidth: null, imageHeight: null, durationMs: 10_000,
  sourceLocatorDigest: digest('8'), sourceLineageDigest: digest('9'), visibility: 'public',
  rightsPolicyVersion: 'rights-v1', rightsEvidenceDigest: digest('a'), safetyPolicyVersion: 'safety-v1',
  safetyScanDigest: digest('b'), redactionPolicyDigest: digest('c'), redactionStatus: 'not_required',
  redactionTransformationDigest: null, terminalStatus: 'extracted', terminalReason: 'fixture',
});
const extractor = <T extends 'asr' | 'ocr'>(extractorType: T, hash: string) => ({
  extractorType, extractorId: `${extractorType}-timed`, extractorVersion: '1.0.0',
  containerDigest: digest(hash), modelId: extractorType === 'asr' ? 'whisper-medium.en' : 'tesseract-eng',
  modelRevision: 'pinned-v1', configDigest: digest('e'), promptDigest: null,
  humanProvenanceDigest: null, languageDetectorVersion: 'fixed-en-v1',
} satisfies CaseGraphContentExtractor & { extractorType: T });

describe('governed timed-media extraction', () => {
  it('creates separate ASR and frame-OCR receipts with exact time and keyframe locators', () => {
    const bundles = extractCaseGraphTimedMediaContent({
      asset: asset(), limitsProfile, asrExtractor: extractor('asr', 'd'),
      frameOcrExtractor: extractor('ocr', 'f'),
      asrSegments: [{
        startMs: 100, endMs: 2_000, text: 'bright object overhead', language: 'en',
        confidence: 0.88, speaker: 'witness', channel: 'mono',
      }],
      frameText: [{
        startMs: 4_900, endMs: 5_100, keyframeMs: 5_000, text: 'JUL 1978', language: 'en', confidence: 0.9,
      }],
    });
    expect(bundles.map(({ contract }) => contract.textOrigin).sort()).toEqual(['asr', 'frame_ocr']);
    const asr = bundles.find(({ contract }) => contract.textOrigin === 'asr')!;
    expect(asr.chunks[0]).toMatchObject({
      text: 'bright obj',
      locator: { locatorType: 'timed_media', startMs: 100, endMs: 2_000, keyframeMs: null },
    });
    const frame = bundles.find(({ contract }) => contract.textOrigin === 'frame_ocr')!;
    expect(frame.chunks[0]).toMatchObject({
      text: 'JUL 1978',
      locator: { locatorType: 'timed_media', startMs: 4_900, endMs: 5_100, keyframeMs: 5_000 },
    });
    expect(frame.receipt.coverage).toEqual({
      coverageType: 'timed_media', totalDurationMs: 10_000, processedDurationMs: 10_000,
    });
  });

  it('rejects frame OCR on audio, missing extractors and empty output', () => {
    const frameText = [{
      startMs: 100, endMs: 200, keyframeMs: 150, text: 'frame', language: 'en', confidence: 0.8,
    }];
    expect(() => extractCaseGraphTimedMediaContent({
      asset: asset('audio'), limitsProfile, asrExtractor: extractor('asr', 'd'),
      frameOcrExtractor: extractor('ocr', 'f'), asrSegments: [], frameText,
    })).toThrow('case_graph_timed_media_extraction_input_invalid');
    expect(() => extractCaseGraphTimedMediaContent({
      asset: asset(), limitsProfile, asrExtractor: extractor('asr', 'd'), asrSegments: [], frameText,
    })).toThrow('case_graph_timed_media_extraction_input_invalid');
    expect(() => extractCaseGraphTimedMediaContent({
      asset: asset(), limitsProfile, asrExtractor: extractor('asr', 'd'), asrSegments: [], frameText: [],
    })).toThrow('case_graph_timed_media_has_no_searchable_content');
  });

  it('fails closed on invalid timecodes and aggregate text limits', () => {
    expect(() => extractCaseGraphTimedMediaContent({
      asset: asset(), limitsProfile, asrExtractor: extractor('asr', 'd'), frameText: [],
      asrSegments: [{ startMs: 9_000, endMs: 11_000, text: 'outside', language: 'en', confidence: 0.8 }],
    })).toThrow('case_graph_content_locator_limit_exceeded');
    const tinyLimits = makeCaseGraphContentLimitsProfile({
      profileId: 'timed-tiny', maxAssetBytes: 100_000, maxDocumentPages: 10,
      maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 10,
      maxTotalTextBytesPerAsset: 3, maxChunksPerAsset: 100,
    });
    expect(() => extractCaseGraphTimedMediaContent({
      asset: asset(), limitsProfile: tinyLimits, asrExtractor: extractor('asr', 'd'), frameText: [],
      asrSegments: [{ startMs: 0, endMs: 1_000, text: 'too long', language: 'en', confidence: 0.8 }],
    })).toThrow('case_graph_content_total_text_limit_exceeded');
  });
});
