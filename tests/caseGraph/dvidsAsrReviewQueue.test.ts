import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildDvidsAsrReviewQueue,
  DVIDS_ASR_POLICY,
  verifyDvidsAsrReviewQueue,
} from '../../src/caseGraph/dvidsAsrReviewQueue';
import {
  buildDvidsRetainedByteInspectionReceipt,
} from '../../src/caseGraph/dvidsRetainedContentByteInspection';
import {
  buildDvidsRetainedContentPreflight,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { dvidsPreflightFixture } from './dvidsRetainedContentFixtures';

const fixture = () => {
  const base = dvidsPreflightFixture();
  const objectBody = Buffer.from('xxxxftypisom');
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
      binaryBytes: 10,
      binarySha256: '1'.repeat(64),
    },
    whisper: {
      path: '/tools/whisper',
      packageVersion: '20250625',
      launcherBytes: 10,
      launcherSha256: '2'.repeat(64),
      pythonPath: '/tools/python',
      pythonVersion: '3.13.5',
      pythonBinaryBytes: 10,
      pythonBinarySha256: '3'.repeat(64),
      packageRoot: '/tools/site-packages/whisper',
      packageSourceFileCount: 20,
      packageSourceSetSha256: '4'.repeat(64),
    },
    model: {
      name: DVIDS_ASR_POLICY.modelName,
      path: `/models/${DVIDS_ASR_POLICY.modelName}.pt`,
      bytes: 100,
      sha256: DVIDS_ASR_POLICY.modelSha256,
    },
  };
  const toolchain = {
    ...toolchainCore,
    toolchainDigest: relationshipInputSha256(toolchainCore),
  };
  return {
    preflight,
    byteInspection,
    toolchain,
    result: {
      address: admitted.address,
      archiveKey: admitted.archiveKey,
      bytesSha256,
      durationMs: 70_000,
      audioWavSha256: '5'.repeat(64),
      whisperJsonSha256: '6'.repeat(64),
      detectedLanguage: 'en',
      rawSegmentCount: 1,
      noSpeechFilteredSegmentCount: 0,
      segments: [{
        ordinal: 0,
        startMs: 500,
        endMs: 2_000,
        text: 'Object overhead.',
        textSha256: relationshipInputSha256('Object overhead.'),
        wordCount: 2,
        confidence: 0.91,
        noSpeechProbability: 0.12,
      }],
    },
  };
};

describe('DVIDS ASR review queue', () => {
  it('binds every object and keeps machine transcript segments unreviewed', () => {
    const input = fixture();
    const queue = buildDvidsAsrReviewQueue({
      ...input,
      results: [input.result],
      builtAt: '2026-07-28T00:30:00.000Z',
    });
    expect(queue).toMatchObject({
      accounting: {
        expectedObjectCount: 1,
        processedObjectCount: 1,
        objectWithSpeechCount: 1,
        segmentCount: 1,
        rawSegmentCount: 1,
        noSpeechFilteredSegmentCount: 0,
        reviewedSegmentCount: 0,
        acceptedClaimCount: 0,
      },
      reviewItems: [{
        text: 'Object overhead.',
        evidenceSemantics: 'machine_asr_unreviewed',
        reviewStatus: 'unreviewed',
      }],
      guarantees: {
        exactToolAndModelBytesPinned: true,
        deterministicNoSpeechFilterApplied: true,
        machineAsrKeptUnreviewed: true,
        claimsAuthorized: false,
        providerCalls: 0,
        publicationMutations: 0,
      },
    });
    expect(verifyDvidsAsrReviewQueue({
      value: queue,
      preflight: input.preflight,
      byteInspection: input.byteInspection,
    })).toEqual(queue);
  });

  it('rejects missing objects, model drift and invalid segment timing', () => {
    const input = fixture();
    expect(() => buildDvidsAsrReviewQueue({
      ...input,
      results: [],
      builtAt: '2026-07-28T00:30:00.000Z',
    })).toThrow('dvids_asr_object_accounting_invalid');
    expect(() => buildDvidsAsrReviewQueue({
      ...input,
      toolchain: {
        ...input.toolchain,
        model: { ...input.toolchain.model, sha256: 'f'.repeat(64) as any },
      },
      results: [input.result],
      builtAt: '2026-07-28T00:30:00.000Z',
    })).toThrow('dvids_asr_toolchain_invalid');
    expect(() => buildDvidsAsrReviewQueue({
      ...input,
      results: [{
        ...input.result,
        segments: [{ ...input.result.segments[0], endMs: 80_000 }],
      }],
      builtAt: '2026-07-28T00:30:00.000Z',
    })).toThrow('dvids_asr_segment_invalid');
    expect(() => buildDvidsAsrReviewQueue({
      ...input,
      results: [{
        ...input.result,
        segments: [{
          ...input.result.segments[0],
          noSpeechProbability: 0.61,
        }],
      }],
      builtAt: '2026-07-28T00:30:00.000Z',
    })).toThrow('dvids_asr_segment_invalid');
  });
});
