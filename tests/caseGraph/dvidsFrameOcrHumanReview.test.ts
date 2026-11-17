import { describe, expect, it } from 'vitest';

import {
  buildDvidsFrameOcrReviewAssignment,
  buildDvidsFrameOcrReviewDraft,
  sealDvidsFrameOcrAdjudication,
  verifyDvidsFrameOcrAdjudication,
} from '../../src/caseGraph/dvidsFrameOcrHumanReview';
import { dvidsFrameOcrReviewFixture } from './dvidsRetainedContentFixtures';

const prepared = () => {
  const fixture = dvidsFrameOcrReviewFixture();
  const expected = fixture.queue.frames.find(({ text }) => text !== null)!;
  const assignment = buildDvidsFrameOcrReviewAssignment({
    queue: fixture.queue,
    recoveredFrames: [{
      address: expected.address,
      keyframeOrdinal: expected.keyframeOrdinal,
      frameFileName: `frame-${expected.frameSha256}.png`,
      frameBytes: expected.frameBytes,
      frameSha256: expected.frameSha256,
      frameWidth: expected.frameWidth,
      frameHeight: expected.frameHeight,
    }],
    createdAt: '2026-07-27T22:10:00.000Z',
  });
  const draft = buildDvidsFrameOcrReviewDraft(assignment);
  return { fixture, assignment, draft };
};

describe('DVIDS frame OCR human review', () => {
  it('seals a complete rejection without converting frame text into a claim', () => {
    const { assignment, draft } = prepared();
    expect(assignment.items).toHaveLength(1);
    expect(draft.reviews[0].decision).toBeNull();
    draft.reviewerId = 'human-reviewer-01';
    draft.reviewedAt = '2026-07-27T22:20:00.000Z';
    draft.attestation = {
      humanPerformed: true,
      viewedExactRecoveredFrames: true,
      preservedMachineOcrOrigin: true,
      noEventClaimOrIdentityImplied: true,
    };
    draft.reviews[0] = {
      ...draft.reviews[0],
      decision: 'ocr_rejected',
      correctedText: null,
      confidence: 'high',
      rationale: 'The machine text does not correspond to legible frame text.',
    };
    const adjudication = sealDvidsFrameOcrAdjudication({
      assignment,
      draft,
      sealedAt: '2026-07-27T22:21:00.000Z',
    });
    expect(adjudication.summary).toEqual({
      reviewedItemCount: 1,
      exactOcrCount: 0,
      correctedOcrCount: 0,
      rejectedOcrCount: 1,
      retainedFrameTextCount: 0,
    });
    expect(adjudication.guarantees).toMatchObject({
      exactRecoveredFrameViewed: true,
      claimsAuthorized: false,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
    });
    expect(verifyDvidsFrameOcrAdjudication({
      assignment,
      adjudication,
    })).toEqual(adjudication);
  });

  it('fails on substituted frame receipts or invalid correction rules', () => {
    const first = prepared();
    expect(() => buildDvidsFrameOcrReviewAssignment({
      queue: first.fixture.queue,
      recoveredFrames: [{
        address: first.assignment.items[0].address,
        keyframeOrdinal: first.assignment.items[0].keyframeOrdinal,
        frameFileName: `frame-${'a'.repeat(64)}.png`,
        frameBytes: first.assignment.items[0].frameBytes,
        frameSha256: 'a'.repeat(64),
        frameWidth: 1280,
        frameHeight: 720,
      }],
      createdAt: '2026-07-27T22:10:00.000Z',
    })).toThrow('dvids_frame_ocr_human_review_frame_invalid');

    const second = prepared();
    second.draft.reviewerId = 'human-reviewer-01';
    second.draft.reviewedAt = '2026-07-27T22:20:00.000Z';
    second.draft.attestation = {
      humanPerformed: true,
      viewedExactRecoveredFrames: true,
      preservedMachineOcrOrigin: true,
      noEventClaimOrIdentityImplied: true,
    };
    second.draft.reviews[0] = {
      ...second.draft.reviews[0],
      decision: 'ocr_exact',
      correctedText: 'not allowed',
      confidence: 'high',
      rationale: 'This invalid fixture supplies a correction for exact OCR.',
    };
    expect(() => sealDvidsFrameOcrAdjudication({
      assignment: second.assignment,
      draft: second.draft,
      sealedAt: '2026-07-27T22:21:00.000Z',
    })).toThrow('dvids_frame_ocr_human_review_corrected_text_invalid');
  });
});
