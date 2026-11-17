import {
  buildDvidsFrameOcrReviewAssignment,
  buildDvidsFrameOcrReviewDraft,
  sealDvidsFrameOcrAdjudication,
} from '../../src/caseGraph/dvidsFrameOcrHumanReview';
import {
  buildDvidsPublisherClaimReviewAssignment,
  buildDvidsPublisherClaimReviewDraft,
  sealDvidsPublisherClaimAdjudication,
} from '../../src/caseGraph/dvidsPublisherClaimReview';
import {
  buildDvidsPublicationBindingPreflight,
} from '../../src/caseGraph/dvidsPublicationBindingPreflight';
import {
  dvidsFrameOcrReviewFixture,
  dvidsPublisherReviewFixture,
} from './dvidsRetainedContentFixtures';

export const dvidsReviewedIntegrationFixture = () => {
  const publisher = dvidsPublisherReviewFixture();
  const publisherAssignment = buildDvidsPublisherClaimReviewAssignment({
    queue: publisher.queue,
    createdAt: '2026-07-27T22:00:00.000Z',
  });
  const publisherBlankDraft = buildDvidsPublisherClaimReviewDraft(
    publisherAssignment,
  );
  const publisherDraft = structuredClone(publisherBlankDraft);
  publisherDraft.reviewerId = 'human-reviewer-01';
  publisherDraft.reviewedAt = '2026-07-27T22:20:00.000Z';
  publisherDraft.attestation = {
    humanPerformed: true,
    reviewedExactPublisherText: true,
    preservedPublisherMetadataOrigin: true,
    noExternalVerificationImplied: true,
  };
  publisherDraft.reviews = publisherDraft.reviews.map((review) => {
    const item = publisherAssignment.items.find(
      ({ itemId }) => itemId === review.itemId,
    )!;
    if (item.sourceField === 'title') {
      return {
        ...review,
        decision: 'atomic_claims_proposed' as const,
        confidence: 'high' as const,
        rationale: 'The exact title supports this attributed publisher statement.',
        claims: [{
          quoteStartByte: 0,
          quoteEndByte: Buffer.byteLength(item.sourceText, 'utf8'),
          exactQuote: item.sourceText,
          normalizedClaim: 'The item is titled Official DVIDS title.',
          attribution: 'DVIDS',
        }],
      };
    }
    return {
      ...review,
      decision: 'no_atomic_claims' as const,
      confidence: 'medium' as const,
      rationale: 'No additional atomic statement is retained from this field.',
      claims: [],
    };
  });
  const publisherAdjudication = sealDvidsPublisherClaimAdjudication({
    assignment: publisherAssignment,
    draft: publisherDraft,
    sealedAt: '2026-07-27T22:21:00.000Z',
  });

  const frame = dvidsFrameOcrReviewFixture();
  const expectedFrame = frame.queue.frames.find(({ text }) => text !== null)!;
  const frameAssignment = buildDvidsFrameOcrReviewAssignment({
    queue: frame.queue,
    recoveredFrames: [{
      address: expectedFrame.address,
      keyframeOrdinal: expectedFrame.keyframeOrdinal,
      frameFileName: `frame-${expectedFrame.frameSha256}.png`,
      frameBytes: expectedFrame.frameBytes,
      frameSha256: expectedFrame.frameSha256,
      frameWidth: expectedFrame.frameWidth,
      frameHeight: expectedFrame.frameHeight,
    }],
    createdAt: '2026-07-27T22:10:00.000Z',
  });
  const frameBlankDraft = buildDvidsFrameOcrReviewDraft(frameAssignment);
  const frameDraft = structuredClone(frameBlankDraft);
  frameDraft.reviewerId = 'human-reviewer-01';
  frameDraft.reviewedAt = '2026-07-27T22:20:00.000Z';
  frameDraft.attestation = {
    humanPerformed: true,
    viewedExactRecoveredFrames: true,
    preservedMachineOcrOrigin: true,
    noEventClaimOrIdentityImplied: true,
  };
  frameDraft.reviews[0] = {
    ...frameDraft.reviews[0],
    decision: 'ocr_rejected',
    correctedText: null,
    confidence: 'high',
    rationale: 'The exact frame does not contain legible matching text.',
  };
  const frameAdjudication = sealDvidsFrameOcrAdjudication({
    assignment: frameAssignment,
    draft: frameDraft,
    sealedAt: '2026-07-27T22:21:00.000Z',
  });
  const publicationBinding = {
    publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
    corpusVersion: publisherAssignment.binding.corpusVersion,
    manifestSha256: 'a'.repeat(64),
    snapshotId: publisherAssignment.binding.snapshotId,
    graphArtifactSetSha256: 'b'.repeat(64),
  };
  const publicationPreflight = buildDvidsPublicationBindingPreflight({
    publisherAssignment,
    frameOcrAssignment: frameAssignment,
    observation: {
      serverVersionNum: 170_006,
      transactionReadOnly: true,
      observedAt: '2026-07-27T22:25:00.000Z',
      publications: [{
        publicationId: publicationBinding.publicationId,
        corpusVersion: publicationBinding.corpusVersion,
        manifestSha256: publicationBinding.manifestSha256,
        active: false,
        activatedAt: null,
        deactivatedAt: null,
        runStatus: 'completed',
        lineageVersion: 'case-vortex-lineage-v2',
        snapshotId: publicationBinding.snapshotId,
        graphArtifactSetSha256: publicationBinding.graphArtifactSetSha256,
        runCompletionManifestSha256: 'c'.repeat(64),
        runCorpusAccountingDigest: 'd'.repeat(64),
        receiptVersion: 'case-vortex-publication-receipt-v2',
        receiptSnapshotId: publicationBinding.snapshotId,
        receiptManifestSha256: publicationBinding.manifestSha256,
        receiptCompletionManifestSha256: 'c'.repeat(64),
        receiptCorpusAccountingDigest: 'd'.repeat(64),
        receiptGraphArtifactSetSha256:
          publicationBinding.graphArtifactSetSha256,
        verifiedV2: true,
      }],
    },
  });
  const missingPublicationPreflight = buildDvidsPublicationBindingPreflight({
    publisherAssignment,
    frameOcrAssignment: frameAssignment,
    observation: {
      serverVersionNum: 170_006,
      transactionReadOnly: true,
      observedAt: '2026-07-27T22:25:00.000Z',
      publications: [],
    },
  });
  return {
    publisherAssignment,
    publisherBlankDraft,
    publisherAdjudication,
    frameAssignment,
    frameBlankDraft,
    frameAdjudication,
    publicationBinding,
    publicationPreflight,
    missingPublicationPreflight,
  };
};
