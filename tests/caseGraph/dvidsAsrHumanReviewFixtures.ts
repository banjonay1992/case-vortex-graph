import { createHash } from 'node:crypto';

import {
  buildDvidsAsrReviewQueue,
  DVIDS_ASR_POLICY,
} from '../../src/caseGraph/dvidsAsrReviewQueue';
import {
  buildDvidsRetainedByteInspectionReceipt,
} from '../../src/caseGraph/dvidsRetainedContentByteInspection';
import {
  buildDvidsRetainedContentPreflight,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { dvidsPreflightFixture } from './dvidsRetainedContentFixtures';

export const dvidsAsrHumanReviewFixture = () => {
  const base = dvidsPreflightFixture();
  const objectBody = Buffer.from('xxxxftypisom');
  const ffmpegBody = Buffer.from('ffmpeg-bin');
  const clipBody = Buffer.alloc(44, 7);
  base.objectHeads[0].contentLength = objectBody.byteLength;
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
  const bytesSha256 = createHash('sha256').update(objectBody).digest('hex');
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
      byteLength: objectBody.byteLength,
      bytesSha256,
      sniffedMimeType: 'video/mp4',
      durationMs: 70_000,
      safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
      safetyScanDigest: '2'.repeat(64),
    }],
  });
  const toolchainCore = {
    ffmpeg: {
      path: '/tools/ffmpeg',
      version: 'ffmpeg version 8.1.1',
      binaryBytes: ffmpegBody.byteLength,
      binarySha256: createHash('sha256').update(ffmpegBody).digest('hex'),
    },
    whisper: {
      path: '/tools/whisper', packageVersion: '20250625', launcherBytes: 10,
      launcherSha256: '2'.repeat(64), pythonPath: '/tools/python',
      pythonVersion: '3.13.5', pythonBinaryBytes: 10,
      pythonBinarySha256: '3'.repeat(64),
      packageRoot: '/tools/site-packages/whisper', packageSourceFileCount: 20,
      packageSourceSetSha256: '4'.repeat(64),
    },
    model: {
      name: DVIDS_ASR_POLICY.modelName,
      path: `/models/${DVIDS_ASR_POLICY.modelName}.pt`, bytes: 100,
      sha256: DVIDS_ASR_POLICY.modelSha256,
    },
  };
  const queue = buildDvidsAsrReviewQueue({
    builtAt: '2026-07-28T00:30:00.000Z',
    preflight,
    byteInspection,
    toolchain: {
      ...toolchainCore,
      toolchainDigest: relationshipInputSha256(toolchainCore),
    },
    results: [{
      address: admitted.address,
      archiveKey: admitted.archiveKey,
      bytesSha256,
      durationMs: 70_000,
      audioWavSha256: '5'.repeat(64),
      whisperJsonSha256: '6'.repeat(64),
      detectedLanguage: 'en',
      rawSegmentCount: 2,
      noSpeechFilteredSegmentCount: 0,
      segments: [
        ['Object overhead.', 500, 2_000],
        ['Light moves left.', 2_500, 4_000],
      ].map(([text, startMs, endMs], ordinal) => ({
        ordinal,
        startMs,
        endMs,
        text,
        textSha256: relationshipInputSha256(text),
        wordCount: text.split(' ').length,
        confidence: 0.91,
        noSpeechProbability: 0.12,
      })),
    }],
  });
  return { preflight, byteInspection, queue, objectBody, ffmpegBody, clipBody };
};
