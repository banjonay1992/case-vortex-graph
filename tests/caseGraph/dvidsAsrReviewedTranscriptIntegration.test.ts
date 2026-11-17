import { describe, expect, it } from 'vitest';

import {
  buildDvidsAsrHumanReviewAssignment,
  buildDvidsAsrHumanReviewDraft,
  sealDvidsAsrHumanAdjudication,
} from '../../src/caseGraph/dvidsAsrHumanReview';
import {
  buildDvidsAsrReviewedTranscriptIntegration,
  verifyDvidsAsrReviewedTranscriptIntegration,
} from '../../src/caseGraph/dvidsAsrReviewedTranscriptIntegration';
import { dvidsAsrHumanReviewFixture } from './dvidsAsrHumanReviewFixtures';

const completed = () => {
  const fixture = dvidsAsrHumanReviewFixture();
  const assignment = buildDvidsAsrHumanReviewAssignment({
    queue: fixture.queue,
    createdAt: '2026-07-28T00:40:00.000Z',
  });
  const draft = buildDvidsAsrHumanReviewDraft(assignment);
  draft.reviewerId = 'human-reviewer-01';
  draft.reviewedAt = '2026-07-28T00:50:00.000Z';
  draft.attestation = {
    humanPerformed: true,
    listenedToExactChecksumBoundMediaIntervals: true,
    preservedTimecodeAndMachineOrigin: true,
    noEventClaimOrIdentityImplied: true,
  };
  draft.reviews = draft.reviews.map((review) => ({
    ...review,
    decision: 'exact' as const,
    confidence: 'high' as const,
    rationale: 'The exact checksum-bound interval supports the machine transcript.',
  }));
  const adjudication = sealDvidsAsrHumanAdjudication({
    assignment,
    draft,
    sealedAt: '2026-07-28T00:51:00.000Z',
  });
  return { assignment, adjudication };
};

describe('DVIDS ASR reviewed transcript integration', () => {
  it('carries only reviewed timecode-bound non-claim transcripts forward', () => {
    const { assignment, adjudication } = completed();
    const integration = buildDvidsAsrReviewedTranscriptIntegration({
      assignment,
      adjudication,
      builtAt: '2026-07-28T00:52:00.000Z',
    });
    expect(integration).toMatchObject({
      binding: {
        corpusVersion: assignment.binding.corpusVersion,
        snapshotId: assignment.binding.snapshotId,
        asrQueueDigest: assignment.binding.asrQueueDigest,
        adjudicationDigest: adjudication.adjudicationDigest,
      },
      accounting: {
        assignedSegmentCount: 2,
        reviewedSegmentCount: 2,
        retainedTranscriptCount: 2,
        eventClaimCount: 0,
      },
      guarantees: {
        timecodesAndMachineOriginPreserved: true,
        reviewedTranscriptsRemainNotEventClaims: true,
        claimSegmentsCreated: 0,
        publicationMutations: 0,
      },
    });
    expect(integration.reviewedTranscripts[0]).toMatchObject({
      startMs: expect.any(Number),
      endMs: expect.any(Number),
      evidenceSemantics: 'human_reviewed_asr_transcript_not_event_claim',
    });
    expect(verifyDvidsAsrReviewedTranscriptIntegration({
      value: integration,
      assignment,
      adjudication,
    })).toEqual(integration);
  });

  it('fails closed on tampered records or a mismatched review proof', () => {
    const { assignment, adjudication } = completed();
    const integration = buildDvidsAsrReviewedTranscriptIntegration({
      assignment,
      adjudication,
      builtAt: '2026-07-28T00:52:00.000Z',
    });
    const tampered = structuredClone(integration);
    tampered.reviewedTranscripts[0].startMs += 1;
    expect(() => verifyDvidsAsrReviewedTranscriptIntegration({
      value: tampered,
      assignment,
      adjudication,
    })).toThrow('dvids_asr_reviewed_transcript_integration_integrity_failed');
    const mismatched = structuredClone(adjudication);
    mismatched.assignmentDigest = 'f'.repeat(64);
    expect(() => buildDvidsAsrReviewedTranscriptIntegration({
      assignment,
      adjudication: mismatched,
      builtAt: '2026-07-28T00:52:00.000Z',
    })).toThrow('dvids_asr_human_review_draft_invalid');
  });
});
