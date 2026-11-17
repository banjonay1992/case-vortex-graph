import { describe, expect, it } from 'vitest';

import {
  buildDvidsFrameOcrReviewQueue,
  DVIDS_FRAME_OCR_POLICY,
  verifyDvidsFrameOcrReviewQueue,
} from '../../src/caseGraph/dvidsFrameOcrReviewQueue';
import {
  buildDvidsRetainedByteInspectionReceipt,
} from '../../src/caseGraph/dvidsRetainedContentByteInspection';
import {
  buildDvidsRetainedContentPreflight,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import {
  caseGraphTimedMediaKeyframeTimes,
} from '../../src/caseGraph/contentResearchLocalTimedMediaExtraction';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { dvidsPreflightFixture } from './dvidsRetainedContentFixtures';

const fixture = () => {
  const base = dvidsPreflightFixture();
  base.objectHeads[0].contentLength = 12;
  const preflight = buildDvidsRetainedContentPreflight({
    builtAt: '2026-07-27T20:10:00.000Z',
    routeReceipt: base.availability.receipt,
    routes: base.availability.routes,
    completion: base.completion,
    universeNodes: [base.dvids],
    rightsSnapshot: base.rightsSnapshot,
    objectHeads: base.objectHeads,
  });
  const admitted = preflight.admitted[0];
  const byteInspection = buildDvidsRetainedByteInspectionReceipt({
    builtAt: '2026-07-27T21:00:00.000Z',
    preflight,
    inspections: [{
      address: admitted.address,
      admissionDigest: admitted.admissionDigest,
      archiveKey: admitted.archiveKey,
      expectedHeadDigest: admitted.objectHead.headDigest,
      expectedEtag: admitted.objectHead.etag,
      declaredContentType: admitted.objectHead.contentType,
      byteLength: 12,
      bytesSha256: '1'.repeat(64),
      sniffedMimeType: 'video/mp4',
      durationMs: 70_000,
      safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
      safetyScanDigest: '2'.repeat(64),
    }],
  });
  const toolchainBody = {
    ffmpeg: {
      path: '/tools/ffmpeg',
      version: 'ffmpeg version 8.1.1',
      binaryBytes: 100,
      binarySha256: '3'.repeat(64),
    },
    tesseract: {
      path: '/tools/tesseract',
      version: 'tesseract 5.5.2',
      binaryBytes: 200,
      binarySha256: '4'.repeat(64),
      trainedDataPath: '/models/eng.traineddata',
      trainedDataBytes: 300,
      trainedDataSha256: '5'.repeat(64),
      language: 'eng' as const,
    },
  };
  const toolchain = {
    ...toolchainBody,
    toolchainDigest: relationshipInputSha256(toolchainBody),
  };
  const frames = caseGraphTimedMediaKeyframeTimes(
    70_000,
    DVIDS_FRAME_OCR_POLICY.keyframesPerVideo,
  ).map((keyframeMs, keyframeOrdinal) => {
    const text = keyframeOrdinal === 1 ? 'OFFICIAL DATE' : null;
    return {
      address: admitted.address,
      archiveKey: admitted.archiveKey,
      bytesSha256: '1'.repeat(64),
      keyframeOrdinal,
      keyframeMs,
      frameBytes: 1_000,
      frameSha256: String((keyframeOrdinal % 8) + 1).repeat(64),
      frameWidth: 1280,
      frameHeight: 720,
      ocrTsvSha256: String((keyframeOrdinal % 8) + 1).repeat(64),
      text,
      textSha256: text === null ? null : relationshipInputSha256(text),
      wordCount: text === null ? 0 : 2,
      confidence: text === null ? null : 0.92,
      extractionStatus: text === null
        ? 'no_text' as const
        : 'text_found' as const,
    };
  });
  return { preflight, byteInspection, toolchain, frames };
};

describe('DVIDS frame OCR review queue', () => {
  it('binds all deterministic frames and keeps machine text unreviewed', () => {
    const input = fixture();
    const queue = buildDvidsFrameOcrReviewQueue({
      builtAt: '2026-07-27T22:00:00.000Z',
      ...input,
    });
    expect(queue.accounting).toEqual({
      expectedObjectCount: 1,
      processedObjectCount: 1,
      expectedFrameCount: 6,
      processedFrameCount: 6,
      textFrameCount: 1,
      emptyFrameCount: 5,
      reviewItemCount: 1,
      totalTextBytes: 13,
      totalWordCount: 2,
      reviewedItemCount: 0,
      acceptedClaimCount: 0,
    });
    expect(queue.reviewItems[0]).toMatchObject({
      text: 'OFFICIAL DATE',
      evidenceSemantics: 'machine_frame_ocr',
      reviewStatus: 'unreviewed',
    });
    expect(queue.guarantees).toMatchObject({
      exactToolAndLanguageModelBytesPinned: true,
      everyPlannedFrameAttempted: true,
      claimsAuthorized: false,
      providerCalls: 0,
      publicationMutations: 0,
    });
    expect(verifyDvidsFrameOcrReviewQueue({
      value: queue,
      preflight: input.preflight,
      byteInspection: input.byteInspection,
    })).toEqual(queue);
  });

  it('fails closed on schedule, checksum, missing frame, or toolchain drift', () => {
    const input = fixture();
    const build = (overrides: Record<string, unknown> = {}) => (
      buildDvidsFrameOcrReviewQueue({
        builtAt: '2026-07-27T22:00:00.000Z',
        ...input,
        ...overrides,
      } as any)
    );
    expect(() => build({ frames: input.frames.slice(1) }))
      .toThrow('dvids_frame_ocr_frame_accounting_invalid');
    expect(() => build({
      frames: [{ ...input.frames[0], keyframeMs: 1 }, ...input.frames.slice(1)],
    })).toThrow('dvids_frame_ocr_result_invalid');
    expect(() => build({
      frames: [{
        ...input.frames[0],
        bytesSha256: 'f'.repeat(64),
      }, ...input.frames.slice(1)],
    })).toThrow('dvids_frame_ocr_result_invalid');
    expect(() => build({
      toolchain: {
        ...input.toolchain,
        ffmpeg: { ...input.toolchain.ffmpeg, version: 'drift' },
      },
    })).toThrow('dvids_frame_ocr_toolchain_invalid');
  });
});
