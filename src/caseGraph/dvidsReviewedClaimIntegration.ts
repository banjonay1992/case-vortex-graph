import {
  buildDvidsFrameOcrReviewDraft,
  verifyDvidsFrameOcrAdjudication,
  verifyDvidsFrameOcrReviewAssignment,
  type DvidsFrameOcrAdjudication,
  type DvidsFrameOcrReviewAssignment,
  type DvidsFrameOcrReviewDraft,
} from './dvidsFrameOcrHumanReview';
import {
  buildDvidsPublisherClaimReviewDraft,
  verifyDvidsPublisherClaimAdjudication,
  verifyDvidsPublisherClaimReviewAssignment,
  type DvidsPublisherClaimAdjudication,
  type DvidsPublisherClaimReviewAssignment,
  type DvidsPublisherClaimReviewDraft,
} from './dvidsPublisherClaimReview';
import {
  adjudicateClaimExtractionBatch,
  buildClaimExtractionBatch,
  buildClaimExtractionSourceSegment,
  verifyClaimAdjudicationReceipt,
  verifyClaimExtractionBatch,
  type ClaimAdjudicationReceipt,
  type ClaimExtractionBatch,
  type ClaimExtractionProposalDraft,
} from './claimEvidenceExtraction';
import type {
  ClaimEvidencePublicationBinding,
} from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  verifyDvidsPublicationBindingPreflight,
  type DvidsPublicationBindingPreflightBlocker,
} from './dvidsPublicationBindingPreflight';

export const DVIDS_REVIEWED_CLAIM_INTEGRATION_VERSION =
  'case-vortex-dvids-reviewed-claim-integration-v1' as const;
export const DVIDS_CLAIM_INTEGRATION_READINESS_VERSION =
  'case-vortex-dvids-claim-integration-readiness-v2' as const;

export type DvidsReviewedClaimIntegration = {
  recordType: 'dvids_reviewed_claim_integration';
  schemaVersion: typeof DVIDS_REVIEWED_CLAIM_INTEGRATION_VERSION;
  builtAt: string;
  binding: ClaimEvidencePublicationBinding;
  sourceReviews: {
    publisherAssignmentDigest: string;
    publisherAdjudicationDigest: string;
    frameOcrAssignmentDigest: string;
    frameOcrAdjudicationDigest: string;
  };
  claimExtractionBatch: ClaimExtractionBatch;
  claimAdjudicationReceipt: ClaimAdjudicationReceipt;
  accounting: {
    publisherReviewedSurfaceCount: number;
    publisherZeroClaimSurfaceCount: number;
    publisherClaimSurfaceCount: number;
    publisherReviewedCandidateCount: number;
    claimSourceSegmentCount: number;
    claimProposalCount: number;
    acceptedAtomicClaimCount: number;
    frameOcrReviewedItemCount: number;
    frameOcrRetainedTextCount: number;
    frameOcrClaimCount: 0;
  };
  guarantees: {
    exactPublicationBinding: true;
    exactHumanReviewBinding: true;
    publisherStatementsRemainAttributedNotVerifiedTruth: true;
    frameTextExcludedFromEventClaims: true;
    everyPublisherCandidateAdjudicated: true;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  integrationDigest: string;
};

export type DvidsClaimIntegrationReadiness = {
  recordType: 'dvids_claim_integration_readiness';
  schemaVersion: typeof DVIDS_CLAIM_INTEGRATION_READINESS_VERSION;
  assessedAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    publisherAssignmentDigest: string;
    publisherBlankDraftDigest: string;
    frameOcrAssignmentDigest: string;
    frameOcrBlankDraftDigest: string;
    publicationPreflightDigest: string;
  };
  accounting: {
    publisherReviewSurfaceCount: number;
    publisherCompletedReviewCount: 0;
    publisherReviewedCandidateCount: 0;
    frameOcrReviewItemCount: number;
    frameOcrCompletedReviewCount: 0;
    atomicClaimCount: 0;
  };
  ready: false;
  blockers: Array<
    | 'publisher_human_adjudication_missing'
    | 'frame_ocr_human_adjudication_missing'
    | `publication_binding:${DvidsPublicationBindingPreflightBlocker}`
  >;
  guarantees: {
    blankDraftsRebuiltExactly: true;
    exactPublicationPreflightVerified: true;
    syntheticHumanReviewCredit: 0;
    claimsCreated: 0;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  readinessDigest: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new Error(code); };
const timestamp = (value: string, code: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(code);
  }
  return value;
};
const binding = (
  value: ClaimEvidencePublicationBinding,
): ClaimEvidencePublicationBinding => {
  if (!UUID.test(value.publicationId)
    || !UUID.test(value.snapshotId)
    || typeof value.corpusVersion !== 'string'
    || !value.corpusVersion.trim()
    || value.corpusVersion !== value.corpusVersion.trim()
    || value.corpusVersion.length > 240
    || !SHA256.test(value.manifestSha256)
    || !SHA256.test(value.graphArtifactSetSha256)) {
    fail('dvids_claim_integration_publication_binding_invalid');
  }
  return { ...value };
};
const byteOffsetToCharacterOffset = (
  text: string,
  byteOffset: number,
) => {
  const bytes = Buffer.from(text, 'utf8');
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0
    || byteOffset > bytes.byteLength) {
    fail('dvids_claim_integration_quote_offset_invalid');
  }
  const prefix = bytes.subarray(0, byteOffset).toString('utf8');
  if (Buffer.byteLength(prefix, 'utf8') !== byteOffset) {
    fail('dvids_claim_integration_quote_offset_invalid');
  }
  return prefix.length;
};

export const buildDvidsClaimIntegrationReadiness = (params: {
  publisherAssignment: unknown;
  publisherDraft: unknown;
  frameOcrAssignment: unknown;
  frameOcrDraft: unknown;
  publicationPreflight: unknown;
  assessedAt: string;
}): DvidsClaimIntegrationReadiness => {
  const publisherAssignment = verifyDvidsPublisherClaimReviewAssignment(
    params.publisherAssignment,
  );
  const frameOcrAssignment = verifyDvidsFrameOcrReviewAssignment(
    params.frameOcrAssignment,
  );
  if (publisherAssignment.binding.corpusVersion
      !== frameOcrAssignment.binding.corpusVersion
    || publisherAssignment.binding.snapshotId
      !== frameOcrAssignment.binding.snapshotId) {
    fail('dvids_claim_integration_review_binding_mismatch');
  }
  const expectedPublisherDraft = buildDvidsPublisherClaimReviewDraft(
    publisherAssignment,
  );
  const expectedFrameDraft = buildDvidsFrameOcrReviewDraft(frameOcrAssignment);
  if (canonicalizeRelationshipInput(params.publisherDraft)
      !== canonicalizeRelationshipInput(expectedPublisherDraft)
    || canonicalizeRelationshipInput(params.frameOcrDraft)
      !== canonicalizeRelationshipInput(expectedFrameDraft)) {
    fail('dvids_claim_integration_blank_draft_invalid');
  }
  const publicationPreflight = verifyDvidsPublicationBindingPreflight({
    value: params.publicationPreflight,
    publisherAssignment,
    frameOcrAssignment,
  });
  const blockers: DvidsClaimIntegrationReadiness['blockers'] = [
    'publisher_human_adjudication_missing',
    'frame_ocr_human_adjudication_missing',
    ...publicationPreflight.blockers.map(
      (blocker) => `publication_binding:${blocker}` as const,
    ),
  ];
  const body: Omit<DvidsClaimIntegrationReadiness, 'readinessDigest'> = {
    recordType: 'dvids_claim_integration_readiness',
    schemaVersion: DVIDS_CLAIM_INTEGRATION_READINESS_VERSION,
    assessedAt: timestamp(
      params.assessedAt,
      'dvids_claim_integration_readiness_timestamp_invalid',
    ),
    binding: {
      corpusVersion: publisherAssignment.binding.corpusVersion,
      snapshotId: publisherAssignment.binding.snapshotId,
      publisherAssignmentDigest: publisherAssignment.assignmentDigest,
      publisherBlankDraftDigest: relationshipInputSha256(
        expectedPublisherDraft,
      ),
      frameOcrAssignmentDigest: frameOcrAssignment.assignmentDigest,
      frameOcrBlankDraftDigest: relationshipInputSha256(expectedFrameDraft),
      publicationPreflightDigest: publicationPreflight.preflightDigest,
    },
    accounting: {
      publisherReviewSurfaceCount: publisherAssignment.items.length,
      publisherCompletedReviewCount: 0,
      publisherReviewedCandidateCount: 0,
      frameOcrReviewItemCount: frameOcrAssignment.items.length,
      frameOcrCompletedReviewCount: 0,
      atomicClaimCount: 0,
    },
    ready: false,
    blockers,
    guarantees: {
      blankDraftsRebuiltExactly: true,
      exactPublicationPreflightVerified: true,
      syntheticHumanReviewCredit: 0,
      claimsCreated: 0,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, readinessDigest: relationshipInputSha256(body) };
};

export const verifyDvidsClaimIntegrationReadiness = (params: {
  value: unknown;
  publisherAssignment: unknown;
  publisherDraft: unknown;
  frameOcrAssignment: unknown;
  frameOcrDraft: unknown;
  publicationPreflight: unknown;
}) => {
  const value = params.value as DvidsClaimIntegrationReadiness;
  const rebuilt = buildDvidsClaimIntegrationReadiness({
    publisherAssignment: params.publisherAssignment,
    publisherDraft: params.publisherDraft,
    frameOcrAssignment: params.frameOcrAssignment,
    frameOcrDraft: params.frameOcrDraft,
    publicationPreflight: params.publicationPreflight,
    assessedAt: value?.assessedAt,
  });
  if (canonicalizeRelationshipInput(value)
    !== canonicalizeRelationshipInput(rebuilt)) {
    fail('dvids_claim_integration_readiness_integrity_failed');
  }
  return rebuilt;
};

export const buildDvidsReviewedClaimIntegration = (params: {
  publisherAssignment: unknown;
  publisherAdjudication: unknown;
  frameOcrAssignment: unknown;
  frameOcrAdjudication: unknown;
  publicationBinding: ClaimEvidencePublicationBinding;
  builtAt: string;
}): DvidsReviewedClaimIntegration => {
  const publisherAssignment = verifyDvidsPublisherClaimReviewAssignment(
    params.publisherAssignment,
  );
  const publisherAdjudication = verifyDvidsPublisherClaimAdjudication({
    assignment: publisherAssignment,
    adjudication: params.publisherAdjudication,
  });
  const frameOcrAssignment = verifyDvidsFrameOcrReviewAssignment(
    params.frameOcrAssignment,
  );
  const frameOcrAdjudication = verifyDvidsFrameOcrAdjudication({
    assignment: frameOcrAssignment,
    adjudication: params.frameOcrAdjudication,
  });
  const publicationBinding = binding(params.publicationBinding);
  if (publicationBinding.corpusVersion
      !== publisherAssignment.binding.corpusVersion
    || publicationBinding.snapshotId !== publisherAssignment.binding.snapshotId
    || publicationBinding.corpusVersion
      !== frameOcrAssignment.binding.corpusVersion
    || publicationBinding.snapshotId !== frameOcrAssignment.binding.snapshotId) {
    fail('dvids_claim_integration_review_binding_mismatch');
  }
  const publisherItemById = new Map(
    publisherAssignment.items.map((item) => [item.itemId, item]),
  );
  const reviewById = new Map(
    publisherAdjudication.reviews.map((review) => [review.itemId, review]),
  );
  const segmentByItemId = new Map<string, ReturnType<
    typeof buildClaimExtractionSourceSegment
  >>();
  for (const reviewedClaim of publisherAdjudication.reviewedClaims) {
    const item = publisherItemById.get(reviewedClaim.itemId)
      || fail('dvids_claim_integration_review_item_missing');
    const review = reviewById.get(reviewedClaim.itemId)
      || fail('dvids_claim_integration_review_item_missing');
    if (!segmentByItemId.has(item.itemId)) {
      segmentByItemId.set(item.itemId, buildClaimExtractionSourceSegment({
        binding: publicationBinding,
        address: item.address,
        sourceId: 'dvids-uap-related',
        sourceLabel: 'DVIDS publisher metadata',
        lineageId: 'official:dvids:publisher-metadata',
        mediaKind: 'video',
        textOrigin: 'structured',
        text: item.sourceText,
        locatorBase: {
          kind: 'record_field',
          field: item.sourceField === 'title'
            ? 'publisher_title'
            : 'publisher_description',
          characterOffset: 0,
        },
        provenance: {
          assetDigest: item.publisherItemDigest,
          extractionContractDigest: publisherAssignment.assignmentDigest,
          extractionReceiptDigest:
            publisherAdjudication.adjudicationDigest,
          extractionPointerDigest: review.reviewDigest,
        },
      }));
    }
  }
  const proposals: ClaimExtractionProposalDraft[] =
    publisherAdjudication.reviewedClaims.map((reviewedClaim) => {
      const item = publisherItemById.get(reviewedClaim.itemId)
        || fail('dvids_claim_integration_review_item_missing');
      const segment = segmentByItemId.get(reviewedClaim.itemId)
        || fail('dvids_claim_integration_review_item_missing');
      const quoteStart = byteOffsetToCharacterOffset(
        item.sourceText,
        reviewedClaim.quoteStartByte,
      );
      const quoteEnd = byteOffsetToCharacterOffset(
        item.sourceText,
        reviewedClaim.quoteEndByte,
      );
      if (item.sourceText.slice(quoteStart, quoteEnd)
        !== reviewedClaim.exactQuote) {
        fail('dvids_claim_integration_quote_offset_invalid');
      }
      return {
        segmentDigest: segment.segmentDigest,
        quoteStart,
        quoteEnd,
        subject: reviewedClaim.attribution,
        predicate: 'publisher_asserts',
        object: reviewedClaim.normalizedClaim,
        polarity: 'asserted',
        modality: 'reported',
        extraction: {
          method: 'deterministic_rule',
          version: DVIDS_REVIEWED_CLAIM_INTEGRATION_VERSION,
          confidence: null,
        },
      };
    });
  const claimExtractionBatch = buildClaimExtractionBatch({
    binding: publicationBinding,
    segments: [...segmentByItemId.values()],
    proposals,
  });
  const proposalByCore = new Map(claimExtractionBatch.proposals.map(
    (proposal) => [
      relationshipInputSha256({
        segmentDigest: proposal.segmentDigest,
        quoteStart: proposal.quoteStart,
        quoteEnd: proposal.quoteEnd,
        subject: proposal.subject,
        object: proposal.object,
      }),
      proposal,
    ],
  ));
  const decisions = publisherAdjudication.reviewedClaims.map(
    (reviewedClaim) => {
      const item = publisherItemById.get(reviewedClaim.itemId)
        || fail('dvids_claim_integration_review_item_missing');
      const segment = segmentByItemId.get(reviewedClaim.itemId)
        || fail('dvids_claim_integration_review_item_missing');
      const quoteStart = byteOffsetToCharacterOffset(
        item.sourceText,
        reviewedClaim.quoteStartByte,
      );
      const quoteEnd = byteOffsetToCharacterOffset(
        item.sourceText,
        reviewedClaim.quoteEndByte,
      );
      const proposal = proposalByCore.get(relationshipInputSha256({
        segmentDigest: segment.segmentDigest,
        quoteStart,
        quoteEnd,
        subject: reviewedClaim.attribution,
        object: reviewedClaim.normalizedClaim,
      })) || fail('dvids_claim_integration_proposal_missing');
      const review = reviewById.get(reviewedClaim.itemId)
        || fail('dvids_claim_integration_review_item_missing');
      return {
        proposalId: proposal.proposalId,
        decision: 'accept' as const,
        rationale: review.rationale,
        reviewerId: publisherAdjudication.reviewerId,
        reviewedAt: publisherAdjudication.reviewedAt,
      };
    },
  );
  const claimAdjudicationReceipt = adjudicateClaimExtractionBatch({
    batch: claimExtractionBatch,
    decisions,
  });
  const body: Omit<DvidsReviewedClaimIntegration, 'integrationDigest'> = {
    recordType: 'dvids_reviewed_claim_integration',
    schemaVersion: DVIDS_REVIEWED_CLAIM_INTEGRATION_VERSION,
    builtAt: timestamp(
      params.builtAt,
      'dvids_claim_integration_timestamp_invalid',
    ),
    binding: publicationBinding,
    sourceReviews: {
      publisherAssignmentDigest: publisherAssignment.assignmentDigest,
      publisherAdjudicationDigest:
        publisherAdjudication.adjudicationDigest,
      frameOcrAssignmentDigest: frameOcrAssignment.assignmentDigest,
      frameOcrAdjudicationDigest: frameOcrAdjudication.adjudicationDigest,
    },
    claimExtractionBatch,
    claimAdjudicationReceipt,
    accounting: {
      publisherReviewedSurfaceCount:
        publisherAdjudication.summary.reviewedSurfaceCount,
      publisherZeroClaimSurfaceCount:
        publisherAdjudication.summary.noAtomicClaimsSurfaceCount,
      publisherClaimSurfaceCount:
        publisherAdjudication.summary.proposedClaimsSurfaceCount,
      publisherReviewedCandidateCount:
        publisherAdjudication.summary.reviewedCandidateClaimCount,
      claimSourceSegmentCount: claimExtractionBatch.accounting.segmentCount,
      claimProposalCount: claimExtractionBatch.accounting.proposalCount,
      acceptedAtomicClaimCount:
        claimAdjudicationReceipt.accounting.accepted,
      frameOcrReviewedItemCount:
        frameOcrAdjudication.summary.reviewedItemCount,
      frameOcrRetainedTextCount:
        frameOcrAdjudication.summary.retainedFrameTextCount,
      frameOcrClaimCount: 0,
    },
    guarantees: {
      exactPublicationBinding: true,
      exactHumanReviewBinding: true,
      publisherStatementsRemainAttributedNotVerifiedTruth: true,
      frameTextExcludedFromEventClaims: true,
      everyPublisherCandidateAdjudicated: true,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, integrationDigest: relationshipInputSha256(body) };
};

export const verifyDvidsReviewedClaimIntegration = (params: {
  value: unknown;
  publisherAssignment: unknown;
  publisherAdjudication: unknown;
  frameOcrAssignment: unknown;
  frameOcrAdjudication: unknown;
}) => {
  const value = params.value as DvidsReviewedClaimIntegration;
  const rebuilt = buildDvidsReviewedClaimIntegration({
    publisherAssignment: params.publisherAssignment,
    publisherAdjudication: params.publisherAdjudication,
    frameOcrAssignment: params.frameOcrAssignment,
    frameOcrAdjudication: params.frameOcrAdjudication,
    publicationBinding: value?.binding,
    builtAt: value?.builtAt,
  });
  verifyClaimExtractionBatch(rebuilt.claimExtractionBatch);
  verifyClaimAdjudicationReceipt({
    batch: rebuilt.claimExtractionBatch,
    receipt: rebuilt.claimAdjudicationReceipt,
  });
  if (canonicalizeRelationshipInput(value)
    !== canonicalizeRelationshipInput(rebuilt)) {
    fail('dvids_claim_integration_integrity_failed');
  }
  return rebuilt;
};
