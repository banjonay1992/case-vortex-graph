import {
  DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION,
  type DvidsPublisherMetadataReviewQueue,
} from './dvidsPublisherMetadataReviewQueue';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_PUBLISHER_CLAIM_REVIEW_ASSIGNMENT_VERSION =
  'case-vortex-dvids-publisher-claim-review-assignment-v1' as const;
export const DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION =
  'case-vortex-dvids-publisher-claim-review-draft-v1' as const;
export const DVIDS_PUBLISHER_CLAIM_ADJUDICATION_VERSION =
  'case-vortex-dvids-publisher-claim-adjudication-v1' as const;

export const DVIDS_PUBLISHER_CLAIM_REVIEW_DECISIONS = [
  'no_atomic_claims',
  'atomic_claims_proposed',
] as const;

type ReviewDecision = typeof DVIDS_PUBLISHER_CLAIM_REVIEW_DECISIONS[number];
type Confidence = 'low' | 'medium' | 'high';
type SourceField = 'title' | 'description';

export type DvidsPublisherClaimReviewAssignment = {
  recordType: 'dvids_publisher_claim_review_assignment';
  schemaVersion: typeof DVIDS_PUBLISHER_CLAIM_REVIEW_ASSIGNMENT_VERSION;
  createdAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    publisherQueueSchemaVersion:
      typeof DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION;
    publisherQueueDigest: string;
    publisherItemSetSha256: string;
  };
  protocol: {
    decisions: [...typeof DVIDS_PUBLISHER_CLAIM_REVIEW_DECISIONS];
    confidenceValues: ['low', 'medium', 'high'];
    quotationUnit: 'utf8_byte';
    maximumClaimsPerSurface: 64;
  };
  items: Array<{
    itemId: string;
    address: string;
    sourceField: SourceField;
    sourceText: string;
    sourceTextSha256: string;
    evidenceSemantics: 'publisher_supplied_metadata';
    publisherItemDigest: string;
    itemDigest: string;
  }>;
  itemSetSha256: string;
  guarantees: {
    exactPublisherQueueBinding: true;
    decisionsPrepopulated: 0;
    humanAdjudicationsCreated: 0;
    claimsAuthorizedForPublication: false;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  assignmentDigest: string;
};

export type DvidsPublisherClaimReviewDraft = {
  recordType: 'dvids_publisher_claim_review_draft';
  schemaVersion: typeof DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION;
  assignmentDigest: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  attestation: {
    humanPerformed: boolean | null;
    reviewedExactPublisherText: boolean | null;
    preservedPublisherMetadataOrigin: boolean | null;
    noExternalVerificationImplied: boolean | null;
  };
  reviews: Array<{
    itemId: string;
    decision: ReviewDecision | null;
    confidence: Confidence | null;
    rationale: string | null;
    claims: Array<{
      quoteStartByte: number;
      quoteEndByte: number;
      exactQuote: string;
      normalizedClaim: string;
      attribution: string;
    }>;
  }>;
};

export type DvidsPublisherClaimAdjudication = {
  recordType: 'dvids_publisher_claim_adjudication';
  schemaVersion: typeof DVIDS_PUBLISHER_CLAIM_ADJUDICATION_VERSION;
  assignmentDigest: string;
  itemSetSha256: string;
  reviewerId: string;
  reviewedAt: string;
  sealedAt: string;
  attestation: {
    humanPerformed: true;
    reviewedExactPublisherText: true;
    preservedPublisherMetadataOrigin: true;
    noExternalVerificationImplied: true;
  };
  reviews: Array<{
    itemId: string;
    decision: ReviewDecision;
    confidence: Confidence;
    rationale: string;
    claims: Array<{
      quoteStartByte: number;
      quoteEndByte: number;
      exactQuote: string;
      exactQuoteSha256: string;
      normalizedClaim: string;
      attribution: string;
      epistemicStatus: 'reviewed_publisher_assertion_unverified';
      claimDigest: string;
    }>;
    reviewDigest: string;
  }>;
  reviewedClaims: Array<{
    itemId: string;
    address: string;
    sourceField: SourceField;
    sourceTextSha256: string;
    quoteStartByte: number;
    quoteEndByte: number;
    exactQuote: string;
    exactQuoteSha256: string;
    normalizedClaim: string;
    attribution: string;
    epistemicStatus: 'reviewed_publisher_assertion_unverified';
    claimDigest: string;
  }>;
  summary: {
    reviewedSurfaceCount: number;
    noAtomicClaimsSurfaceCount: number;
    proposedClaimsSurfaceCount: number;
    reviewedCandidateClaimCount: number;
  };
  reviewSetSha256: string;
  reviewedClaimSetSha256: string;
  guarantees: {
    completeExactItemSet: true;
    exactQuotationSpansVerified: true;
    publisherOriginPreserved: true;
    syntheticHumanReviewCredit: 0;
    claimsAuthorizedForPublication: false;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  adjudicationDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const REVIEWER_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/u;
const fail = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);
const object = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort(lexical);
  const expected = [...keys].sort(lexical);
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};
const timestamp = (value: unknown, code: string) => {
  const textValue = typeof value === 'string' ? value : fail(code);
  const parsed = new Date(textValue);
  if (!Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== textValue) {
    fail(code);
  }
  return textValue;
};
const boundedText = (
  value: unknown,
  minimum: number,
  maximumBytes: number,
  code: string,
) => {
  const textValue = typeof value === 'string' ? value : fail(code);
  if (textValue !== textValue.normalize('NFC')
    || textValue.trim().length < minimum
    || Buffer.byteLength(textValue, 'utf8') > maximumBytes
    || /[\u0000]/u.test(textValue)) {
    fail(code);
  }
  return textValue.trim();
};

const verifyPublisherQueueEnvelope = (
  value: DvidsPublisherMetadataReviewQueue,
) => {
  if (!object(value)
    || value.recordType !== 'dvids_publisher_metadata_review_queue'
    || value.schemaVersion !== DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION
    || !SHA256.test(value.queueDigest)
    || !SHA256.test(value.itemSetSha256)
    || !Array.isArray(value.items)
    || value.items.length < 1) {
    fail('dvids_publisher_claim_review_queue_invalid');
  }
  const { queueDigest, ...body } = value;
  if (relationshipInputSha256(body) !== queueDigest
    || value.items.some((item) => (
      item.reviewStatus !== 'unreviewed'
      || item.evidenceSemantics !== 'publisher_supplied_metadata'
      || relationshipInputSha256(item.title) !== item.titleSha256
      || relationshipInputSha256(item.description) !== item.descriptionSha256
    ))) {
    fail('dvids_publisher_claim_review_queue_invalid');
  }
  return value;
};

export const buildDvidsPublisherClaimReviewAssignment = (params: {
  queue: DvidsPublisherMetadataReviewQueue;
  createdAt: string;
}): DvidsPublisherClaimReviewAssignment => {
  const queue = verifyPublisherQueueEnvelope(params.queue);
  const items = queue.items.flatMap((source) => (
    (['title', 'description'] as const).map((sourceField) => {
      const core = {
        address: source.address,
        sourceField,
        sourceText: source[sourceField],
        sourceTextSha256: source[`${sourceField}Sha256`],
        evidenceSemantics: 'publisher_supplied_metadata' as const,
        publisherItemDigest: source.itemDigest,
      };
      const itemDigest = relationshipInputSha256(core);
      return {
        itemId: `dvids-publisher-claim-review:${itemDigest}`,
        ...core,
        itemDigest,
      };
    })
  )).sort((left, right) => lexical(left.itemId, right.itemId));
  const itemSetSha256 = relationshipInputSha256(
    items.map(({ itemId, itemDigest }) => `${itemId}:${itemDigest}`),
  );
  const body: Omit<DvidsPublisherClaimReviewAssignment, 'assignmentDigest'> = {
    recordType: 'dvids_publisher_claim_review_assignment',
    schemaVersion: DVIDS_PUBLISHER_CLAIM_REVIEW_ASSIGNMENT_VERSION,
    createdAt: timestamp(
      params.createdAt,
      'dvids_publisher_claim_review_created_at_invalid',
    ),
    binding: {
      corpusVersion: queue.binding.corpusVersion,
      snapshotId: queue.binding.snapshotId,
      publisherQueueSchemaVersion: queue.schemaVersion,
      publisherQueueDigest: queue.queueDigest,
      publisherItemSetSha256: queue.itemSetSha256,
    },
    protocol: {
      decisions: [...DVIDS_PUBLISHER_CLAIM_REVIEW_DECISIONS],
      confidenceValues: ['low', 'medium', 'high'],
      quotationUnit: 'utf8_byte',
      maximumClaimsPerSurface: 64,
    },
    items,
    itemSetSha256,
    guarantees: {
      exactPublisherQueueBinding: true,
      decisionsPrepopulated: 0,
      humanAdjudicationsCreated: 0,
      claimsAuthorizedForPublication: false,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, assignmentDigest: relationshipInputSha256(body) };
};

export const verifyDvidsPublisherClaimReviewAssignment = (
  value: unknown,
): DvidsPublisherClaimReviewAssignment => {
  if (!object(value)
    || value.recordType !== 'dvids_publisher_claim_review_assignment'
    || value.schemaVersion !== DVIDS_PUBLISHER_CLAIM_REVIEW_ASSIGNMENT_VERSION
    || !SHA256.test(String(value.assignmentDigest))
    || !Array.isArray(value.items)) {
    fail('dvids_publisher_claim_review_assignment_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { assignmentDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== assignmentDigest) {
    fail('dvids_publisher_claim_review_assignment_digest_mismatch');
  }
  const assignment = value as unknown as DvidsPublisherClaimReviewAssignment;
  if (assignment.items.length < 1
    || new Set(assignment.items.map(({ itemId }) => itemId)).size
      !== assignment.items.length
    || assignment.items.some((item) => {
      const { itemId, itemDigest, ...core } = item;
      return itemId !== `dvids-publisher-claim-review:${itemDigest}`
        || !['title', 'description'].includes(item.sourceField)
        || relationshipInputSha256(item.sourceText) !== item.sourceTextSha256
        || relationshipInputSha256(core) !== itemDigest;
    })
    || relationshipInputSha256(assignment.items.map(
      ({ itemId, itemDigest }) => `${itemId}:${itemDigest}`,
    )) !== assignment.itemSetSha256) {
    fail('dvids_publisher_claim_review_assignment_item_invalid');
  }
  return assignment;
};

export const buildDvidsPublisherClaimReviewDraft = (
  assignmentValue: unknown,
): DvidsPublisherClaimReviewDraft => {
  const assignment = verifyDvidsPublisherClaimReviewAssignment(assignmentValue);
  return {
    recordType: 'dvids_publisher_claim_review_draft',
    schemaVersion: DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    reviewerId: null,
    reviewedAt: null,
    attestation: {
      humanPerformed: null,
      reviewedExactPublisherText: null,
      preservedPublisherMetadataOrigin: null,
      noExternalVerificationImplied: null,
    },
    reviews: assignment.items.map(({ itemId }) => ({
      itemId,
      decision: null,
      confidence: null,
      rationale: null,
      claims: [],
    })),
  };
};

export const sealDvidsPublisherClaimAdjudication = (params: {
  assignment: unknown;
  draft: unknown;
  sealedAt: string;
}): DvidsPublisherClaimAdjudication => {
  const assignment = verifyDvidsPublisherClaimReviewAssignment(
    params.assignment,
  );
  if (!object(params.draft)
    || !exactKeys(params.draft, [
      'recordType', 'schemaVersion', 'assignmentDigest', 'reviewerId',
      'reviewedAt', 'attestation', 'reviews',
    ])
    || params.draft.recordType !== 'dvids_publisher_claim_review_draft'
    || params.draft.schemaVersion !== DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION
    || params.draft.assignmentDigest !== assignment.assignmentDigest
    || !object(params.draft.attestation)
    || !Array.isArray(params.draft.reviews)) {
    fail('dvids_publisher_claim_review_draft_invalid');
  }
  const draft = params.draft as Record<string, unknown>;
  const attestation = draft.attestation as Record<string, unknown>;
  const draftReviews = draft.reviews as unknown[];
  const reviewerId = String(draft.reviewerId || '').trim().toLowerCase();
  if (!REVIEWER_ID.test(reviewerId)) {
    fail('dvids_publisher_claim_review_reviewer_invalid');
  }
  const reviewedAt = timestamp(
    draft.reviewedAt,
    'dvids_publisher_claim_review_reviewed_at_invalid',
  );
  const sealedAt = timestamp(
    params.sealedAt,
    'dvids_publisher_claim_review_sealed_at_invalid',
  );
  if (Date.parse(reviewedAt) < Date.parse(assignment.createdAt)
    || Date.parse(sealedAt) < Date.parse(reviewedAt)) {
    fail('dvids_publisher_claim_review_timestamp_order_invalid');
  }
  if (!exactKeys(attestation, [
    'humanPerformed', 'reviewedExactPublisherText',
    'preservedPublisherMetadataOrigin', 'noExternalVerificationImplied',
  ]) || Object.values(attestation).some((value) => value !== true)) {
    fail('dvids_publisher_claim_review_attestation_invalid');
  }
  const itemById = new Map(assignment.items.map((item) => [item.itemId, item]));
  const reviews = draftReviews.map((raw) => {
    if (!object(raw)
      || !exactKeys(raw, [
        'itemId', 'decision', 'confidence', 'rationale', 'claims',
      ])
      || typeof raw.itemId !== 'string'
      || !DVIDS_PUBLISHER_CLAIM_REVIEW_DECISIONS.includes(
        raw.decision as ReviewDecision,
      )
      || !['low', 'medium', 'high'].includes(String(raw.confidence))
      || !Array.isArray(raw.claims)) {
      fail('dvids_publisher_claim_review_response_invalid');
    }
    const review = raw as Record<string, unknown> & {
      itemId: string;
      claims: unknown[];
    };
    const item = itemById.get(review.itemId)
      || fail('dvids_publisher_claim_review_response_invalid');
    if (review.claims.length > assignment.protocol.maximumClaimsPerSurface) {
      fail('dvids_publisher_claim_review_response_invalid');
    }
    const rationale = boundedText(
      review.rationale,
      12,
      2_000,
      'dvids_publisher_claim_review_rationale_invalid',
    );
    const decision = review.decision as ReviewDecision;
    if ((decision === 'no_atomic_claims' && review.claims.length !== 0)
      || (decision === 'atomic_claims_proposed' && review.claims.length < 1)) {
      fail('dvids_publisher_claim_review_claim_accounting_invalid');
    }
    const claims = review.claims.map((claim) => {
      if (!object(claim)
        || !exactKeys(claim, [
          'quoteStartByte', 'quoteEndByte', 'exactQuote',
          'normalizedClaim', 'attribution',
        ])
        || !Number.isSafeInteger(claim.quoteStartByte)
        || !Number.isSafeInteger(claim.quoteEndByte)
        || (claim.quoteStartByte as number) < 0
        || (claim.quoteEndByte as number) <= (claim.quoteStartByte as number)) {
        fail('dvids_publisher_claim_review_claim_invalid');
      }
      const claimValue = claim as Record<string, unknown>;
      const exactQuote = boundedText(
        claimValue.exactQuote,
        1,
        10_000,
        'dvids_publisher_claim_review_claim_invalid',
      );
      const sourceBytes = Buffer.from(item.sourceText, 'utf8');
      const quoteStartByte = claimValue.quoteStartByte as number;
      const quoteEndByte = claimValue.quoteEndByte as number;
      if (quoteEndByte > sourceBytes.byteLength
        || sourceBytes.subarray(quoteStartByte, quoteEndByte).toString('utf8')
          !== exactQuote
        || Buffer.byteLength(exactQuote, 'utf8')
          !== quoteEndByte - quoteStartByte) {
        fail('dvids_publisher_claim_review_quote_mismatch');
      }
      const core = {
        quoteStartByte,
        quoteEndByte,
        exactQuote,
        exactQuoteSha256: relationshipInputSha256(exactQuote),
        normalizedClaim: boundedText(
          claimValue.normalizedClaim,
          3,
          2_000,
          'dvids_publisher_claim_review_claim_invalid',
        ),
        attribution: boundedText(
          claimValue.attribution,
          3,
          500,
          'dvids_publisher_claim_review_claim_invalid',
        ),
        epistemicStatus:
          'reviewed_publisher_assertion_unverified' as const,
      };
      return { ...core, claimDigest: relationshipInputSha256({
        itemId: item.itemId,
        ...core,
      }) };
    });
    if (new Set(claims.map(({ claimDigest }) => claimDigest)).size
      !== claims.length) {
      fail('dvids_publisher_claim_review_duplicate_claim');
    }
    const core = {
      itemId: review.itemId,
      decision,
      confidence: review.confidence as Confidence,
      rationale,
      claims,
    };
    return { ...core, reviewDigest: relationshipInputSha256(core) };
  }).sort((left, right) => lexical(left.itemId, right.itemId));
  const expectedIds = [...itemById.keys()].sort(lexical);
  if (reviews.length !== expectedIds.length
    || reviews.some(({ itemId }, index) => itemId !== expectedIds[index])) {
    fail('dvids_publisher_claim_review_response_set_mismatch');
  }
  const reviewedClaims = reviews.flatMap((review) => {
    const item = itemById.get(review.itemId)!;
    return review.claims.map((claim) => ({
      itemId: item.itemId,
      address: item.address,
      sourceField: item.sourceField,
      sourceTextSha256: item.sourceTextSha256,
      ...claim,
    }));
  });
  const reviewSetSha256 = relationshipInputSha256(
    reviews.map(({ itemId, reviewDigest }) => `${itemId}:${reviewDigest}`),
  );
  const reviewedClaimSetSha256 = relationshipInputSha256(
    reviewedClaims.map(({ claimDigest }) => claimDigest),
  );
  const body: Omit<DvidsPublisherClaimAdjudication, 'adjudicationDigest'> = {
    recordType: 'dvids_publisher_claim_adjudication',
    schemaVersion: DVIDS_PUBLISHER_CLAIM_ADJUDICATION_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    itemSetSha256: assignment.itemSetSha256,
    reviewerId,
    reviewedAt,
    sealedAt,
    attestation: {
      humanPerformed: true,
      reviewedExactPublisherText: true,
      preservedPublisherMetadataOrigin: true,
      noExternalVerificationImplied: true,
    },
    reviews,
    reviewedClaims,
    summary: {
      reviewedSurfaceCount: reviews.length,
      noAtomicClaimsSurfaceCount: reviews.filter(
        ({ decision }) => decision === 'no_atomic_claims',
      ).length,
      proposedClaimsSurfaceCount: reviews.filter(
        ({ decision }) => decision === 'atomic_claims_proposed',
      ).length,
      reviewedCandidateClaimCount: reviewedClaims.length,
    },
    reviewSetSha256,
    reviewedClaimSetSha256,
    guarantees: {
      completeExactItemSet: true,
      exactQuotationSpansVerified: true,
      publisherOriginPreserved: true,
      syntheticHumanReviewCredit: 0,
      claimsAuthorizedForPublication: false,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, adjudicationDigest: relationshipInputSha256(body) };
};

export const verifyDvidsPublisherClaimAdjudication = (params: {
  assignment: unknown;
  adjudication: unknown;
}) => {
  if (!object(params.adjudication)
    || params.adjudication.recordType
      !== 'dvids_publisher_claim_adjudication'
    || params.adjudication.schemaVersion
      !== DVIDS_PUBLISHER_CLAIM_ADJUDICATION_VERSION) {
    fail('dvids_publisher_claim_adjudication_invalid');
  }
  const value = params.adjudication as unknown as DvidsPublisherClaimAdjudication;
  const draft: DvidsPublisherClaimReviewDraft = {
    recordType: 'dvids_publisher_claim_review_draft',
    schemaVersion: DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION,
    assignmentDigest: value.assignmentDigest,
    reviewerId: value.reviewerId,
    reviewedAt: value.reviewedAt,
    attestation: value.attestation,
    reviews: value.reviews.map((review) => ({
      itemId: review.itemId,
      decision: review.decision,
      confidence: review.confidence,
      rationale: review.rationale,
      claims: review.claims.map((claim) => ({
        quoteStartByte: claim.quoteStartByte,
        quoteEndByte: claim.quoteEndByte,
        exactQuote: claim.exactQuote,
        normalizedClaim: claim.normalizedClaim,
        attribution: claim.attribution,
      })),
    })),
  };
  const rebuilt = sealDvidsPublisherClaimAdjudication({
    assignment: params.assignment,
    draft,
    sealedAt: value.sealedAt,
  });
  if (relationshipInputSha256(rebuilt)
    !== relationshipInputSha256(value)) {
    fail('dvids_publisher_claim_adjudication_integrity_failed');
  }
  return value;
};
