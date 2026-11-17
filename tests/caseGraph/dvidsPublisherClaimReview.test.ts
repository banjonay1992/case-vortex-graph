import { describe, expect, it } from 'vitest';

import {
  buildDvidsPublisherClaimReviewAssignment,
  buildDvidsPublisherClaimReviewDraft,
  sealDvidsPublisherClaimAdjudication,
  verifyDvidsPublisherClaimAdjudication,
} from '../../src/caseGraph/dvidsPublisherClaimReview';
import { dvidsPublisherReviewFixture } from './dvidsRetainedContentFixtures';

const completedDraft = () => {
  const { queue } = dvidsPublisherReviewFixture();
  const assignment = buildDvidsPublisherClaimReviewAssignment({
    queue,
    createdAt: '2026-07-27T22:00:00.000Z',
  });
  const draft = buildDvidsPublisherClaimReviewDraft(assignment);
  draft.reviewerId = 'human-reviewer-01';
  draft.reviewedAt = '2026-07-27T22:30:00.000Z';
  draft.attestation = {
    humanPerformed: true,
    reviewedExactPublisherText: true,
    preservedPublisherMetadataOrigin: true,
    noExternalVerificationImplied: true,
  };
  draft.reviews = draft.reviews.map((review) => {
    const item = assignment.items.find(({ itemId }) => itemId === review.itemId)!;
    if (item.sourceField === 'title') {
      return {
        ...review,
        decision: 'atomic_claims_proposed' as const,
        confidence: 'high' as const,
        rationale: 'The complete title is retained as one publisher assertion.',
        claims: [{
          quoteStartByte: 0,
          quoteEndByte: Buffer.byteLength(item.sourceText, 'utf8'),
          exactQuote: item.sourceText,
          normalizedClaim: 'The publisher labels this as an official DVIDS item.',
          attribution: 'DVIDS publisher metadata',
        }],
      };
    }
    return {
      ...review,
      decision: 'no_atomic_claims' as const,
      confidence: 'medium' as const,
      rationale: 'This fixture description adds no separately useful atomic claim.',
      claims: [],
    };
  });
  return { assignment, draft };
};

describe('DVIDS publisher claim review', () => {
  it('builds 2 exact review surfaces per object and seals reviewed candidates only', () => {
    const { assignment, draft } = completedDraft();
    expect(assignment.items).toHaveLength(2);
    expect(assignment.guarantees).toMatchObject({
      decisionsPrepopulated: 0,
      humanAdjudicationsCreated: 0,
      claimsAuthorizedForPublication: false,
    });
    const adjudication = sealDvidsPublisherClaimAdjudication({
      assignment,
      draft,
      sealedAt: '2026-07-27T22:31:00.000Z',
    });
    expect(adjudication.summary).toEqual({
      reviewedSurfaceCount: 2,
      noAtomicClaimsSurfaceCount: 1,
      proposedClaimsSurfaceCount: 1,
      reviewedCandidateClaimCount: 1,
    });
    expect(adjudication.reviewedClaims[0]).toMatchObject({
      sourceField: 'title',
      epistemicStatus: 'reviewed_publisher_assertion_unverified',
    });
    expect(adjudication.guarantees).toMatchObject({
      exactQuotationSpansVerified: true,
      claimsAuthorizedForPublication: false,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
    });
    expect(verifyDvidsPublisherClaimAdjudication({
      assignment,
      adjudication,
    })).toEqual(adjudication);
  });

  it('fails closed on incomplete review, false attestation, or quotation drift', () => {
    const first = completedDraft();
    first.draft.reviews.pop();
    expect(() => sealDvidsPublisherClaimAdjudication({
      ...first,
      sealedAt: '2026-07-27T22:31:00.000Z',
    })).toThrow('dvids_publisher_claim_review_response_set_mismatch');

    const second = completedDraft();
    second.draft.attestation.humanPerformed = false;
    expect(() => sealDvidsPublisherClaimAdjudication({
      ...second,
      sealedAt: '2026-07-27T22:31:00.000Z',
    })).toThrow('dvids_publisher_claim_review_attestation_invalid');

    const third = completedDraft();
    const claim = third.draft.reviews.flatMap(({ claims }) => claims)[0];
    claim.quoteEndByte -= 1;
    expect(() => sealDvidsPublisherClaimAdjudication({
      ...third,
      sealedAt: '2026-07-27T22:31:00.000Z',
    })).toThrow('dvids_publisher_claim_review_quote_mismatch');
  });
});
