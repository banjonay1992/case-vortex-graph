import { describe, expect, it } from 'vitest';

import {
  buildDvidsClaimIntegrationReadiness,
  buildDvidsReviewedClaimIntegration,
  verifyDvidsReviewedClaimIntegration,
} from '../../src/caseGraph/dvidsReviewedClaimIntegration';
import {
  dvidsReviewedIntegrationFixture,
} from './dvidsReviewedClaimIntegrationFixtures';

describe('DVIDS reviewed claim integration', () => {
  it('bridges reviewed publisher statements into attributed atomic claims only', () => {
    const fixture = dvidsReviewedIntegrationFixture();
    const integration = buildDvidsReviewedClaimIntegration({
      ...fixture,
      frameOcrAssignment: fixture.frameAssignment,
      frameOcrAdjudication: fixture.frameAdjudication,
      builtAt: '2026-07-27T22:30:00.000Z',
    });
    expect(integration.accounting).toMatchObject({
      publisherReviewedSurfaceCount: 2,
      publisherReviewedCandidateCount: 1,
      claimSourceSegmentCount: 1,
      claimProposalCount: 1,
      acceptedAtomicClaimCount: 1,
      frameOcrReviewedItemCount: 1,
      frameOcrClaimCount: 0,
    });
    expect(integration.claimAdjudicationReceipt.claims[0]).toMatchObject({
      sourceId: 'dvids-uap-related',
      subject: 'DVIDS',
      predicate: 'publisher_asserts',
      object: 'The item is titled Official DVIDS title.',
      modality: 'reported',
      sourceText: 'Official DVIDS title',
      locator: {
        kind: 'record_field',
        field: 'publisher_title',
        characterStart: 0,
        characterEnd: 20,
      },
      extraction: {
        method: 'deterministic_rule',
        reviewStatus: 'reviewed',
      },
    });
    expect(integration.guarantees).toMatchObject({
      publisherStatementsRemainAttributedNotVerifiedTruth: true,
      frameTextExcludedFromEventClaims: true,
      publicationMutations: 0,
    });
    expect(verifyDvidsReviewedClaimIntegration({
      value: integration,
      publisherAssignment: fixture.publisherAssignment,
      publisherAdjudication: fixture.publisherAdjudication,
      frameOcrAssignment: fixture.frameAssignment,
      frameOcrAdjudication: fixture.frameAdjudication,
    })).toEqual(integration);
  });

  it('records the current blank state without manufacturing review credit', () => {
    const fixture = dvidsReviewedIntegrationFixture();
    const readiness = buildDvidsClaimIntegrationReadiness({
      publisherAssignment: fixture.publisherAssignment,
      publisherDraft: fixture.publisherBlankDraft,
      frameOcrAssignment: fixture.frameAssignment,
      frameOcrDraft: fixture.frameBlankDraft,
      publicationPreflight: fixture.missingPublicationPreflight,
      assessedAt: '2026-07-27T22:30:00.000Z',
    });
    expect(readiness).toMatchObject({
      ready: false,
      accounting: {
        publisherReviewSurfaceCount: 2,
        publisherCompletedReviewCount: 0,
        publisherReviewedCandidateCount: 0,
        frameOcrReviewItemCount: 1,
        frameOcrCompletedReviewCount: 0,
        atomicClaimCount: 0,
      },
      blockers: [
        'publisher_human_adjudication_missing',
        'frame_ocr_human_adjudication_missing',
        'publication_binding:database_candidate_missing',
      ],
      guarantees: {
        syntheticHumanReviewCredit: 0,
        claimsCreated: 0,
      },
    });
  });

  it('fails closed on publication drift or nonblank readiness drafts', () => {
    const fixture = dvidsReviewedIntegrationFixture();
    expect(() => buildDvidsReviewedClaimIntegration({
      ...fixture,
      frameOcrAssignment: fixture.frameAssignment,
      frameOcrAdjudication: fixture.frameAdjudication,
      publicationBinding: {
        ...fixture.publicationBinding,
        corpusVersion: 'different-corpus',
      },
      builtAt: '2026-07-27T22:30:00.000Z',
    })).toThrow('dvids_claim_integration_review_binding_mismatch');
    const nonblank = structuredClone(fixture.frameBlankDraft);
    nonblank.reviewerId = 'fabricated-reviewer';
    expect(() => buildDvidsClaimIntegrationReadiness({
      publisherAssignment: fixture.publisherAssignment,
      publisherDraft: fixture.publisherBlankDraft,
      frameOcrAssignment: fixture.frameAssignment,
      frameOcrDraft: nonblank,
      publicationPreflight: fixture.missingPublicationPreflight,
      assessedAt: '2026-07-27T22:30:00.000Z',
    })).toThrow('dvids_claim_integration_blank_draft_invalid');
  });
});
