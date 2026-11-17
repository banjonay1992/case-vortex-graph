import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildDvidsAsrHumanReviewAssignment,
  buildDvidsAsrHumanReviewDraft,
  sealDvidsAsrHumanAdjudication,
  verifyDvidsAsrHumanAdjudication,
} from '../../src/caseGraph/dvidsAsrHumanReview';
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

const prepared = () => {
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
      path: '/tools/ffmpeg', version: 'ffmpeg version 8.1.1', binaryBytes: 10,
      binarySha256: '1'.repeat(64),
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
      rawSegmentCount: 3,
      noSpeechFilteredSegmentCount: 0,
      segments: [
        ['Object overhead.', 500, 2_000],
        ['Light moves left.', 2_500, 4_000],
        ['Unintelligible noise.', 4_500, 6_000],
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
  const assignment = buildDvidsAsrHumanReviewAssignment({
    queue,
    createdAt: '2026-07-28T00:40:00.000Z',
  });
  const draft = buildDvidsAsrHumanReviewDraft(assignment);
  return { queue, assignment, draft };
};

const completed = () => {
  const result = prepared();
  result.draft.reviewerId = 'human-reviewer-01';
  result.draft.reviewedAt = '2026-07-28T00:50:00.000Z';
  result.draft.attestation = {
    humanPerformed: true,
    listenedToExactChecksumBoundMediaIntervals: true,
    preservedTimecodeAndMachineOrigin: true,
    noEventClaimOrIdentityImplied: true,
  };
  result.draft.reviews = result.draft.reviews.map((review) => {
    const item = result.assignment.items.find(({ itemId }) => itemId === review.itemId)!;
    if (item.segmentOrdinal === 0) return {
      ...review,
      decision: 'exact' as const,
      confidence: 'high' as const,
      rationale: 'The exact checksum-bound interval supports the machine wording.',
    };
    if (item.segmentOrdinal === 1) return {
      ...review,
      decision: 'corrected' as const,
      correctedText: 'Light moved left.',
      confidence: 'high' as const,
      rationale: 'The checksum-bound interval uses past tense rather than present tense.',
    };
    return {
      ...review,
      decision: 'rejected' as const,
      confidence: 'medium' as const,
      rationale: 'The checksum-bound interval does not contain intelligible speech.',
    };
  });
  return result;
};

describe('DVIDS ASR human review', () => {
  it('requires complete human review and emits timecode-bound transcripts, not claims', () => {
    const { assignment, draft } = completed();
    expect(assignment.items).toHaveLength(3);
    expect(assignment.guarantees).toMatchObject({
      exactAsrQueueBinding: true,
      decisionsPrepopulated: 0,
      claimsAuthorized: false,
    });
    const adjudication = sealDvidsAsrHumanAdjudication({
      assignment,
      draft,
      sealedAt: '2026-07-28T00:51:00.000Z',
    });
    expect(adjudication.summary).toEqual({
      reviewedItemCount: 3,
      exactTranscriptCount: 1,
      correctedTranscriptCount: 1,
      rejectedTranscriptCount: 1,
      retainedTranscriptCount: 2,
    });
    expect(adjudication.reviewedTranscripts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        segmentOrdinal: 1,
        startMs: 2_500,
        endMs: 4_000,
        machineText: 'Light moves left.',
        reviewedTranscript: 'Light moved left.',
        evidenceSemantics: 'human_reviewed_asr_transcript_not_event_claim',
      }),
    ]));
    expect(adjudication.guarantees).toMatchObject({
      timecodeAndMachineOriginPreserved: true,
      claimsAuthorized: false,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
    });
    expect(verifyDvidsAsrHumanAdjudication({ assignment, adjudication }))
      .toEqual(adjudication);
  });

  it('fails closed on incomplete work, missing attestation, and invalid corrections', () => {
    const incomplete = completed();
    incomplete.draft.reviews.pop();
    expect(() => sealDvidsAsrHumanAdjudication({
      assignment: incomplete.assignment,
      draft: incomplete.draft,
      sealedAt: '2026-07-28T00:51:00.000Z',
    })).toThrow('dvids_asr_human_review_response_set_mismatch');

    const unattested = completed();
    unattested.draft.attestation.humanPerformed = false;
    expect(() => sealDvidsAsrHumanAdjudication({
      assignment: unattested.assignment,
      draft: unattested.draft,
      sealedAt: '2026-07-28T00:51:00.000Z',
    })).toThrow('dvids_asr_human_review_attestation_invalid');

    const invalidCorrection = completed();
    const exact = invalidCorrection.draft.reviews.find(
      ({ decision }) => decision === 'exact',
    )!;
    exact.correctedText = 'This must be rejected because exact has no correction.';
    expect(() => sealDvidsAsrHumanAdjudication({
      assignment: invalidCorrection.assignment,
      draft: invalidCorrection.draft,
      sealedAt: '2026-07-28T00:51:00.000Z',
    })).toThrow('dvids_asr_human_review_corrected_text_invalid');
  });
});
