import {
  SATNOGS_CONTEXTUAL_COHORT_VERSION,
  type SatnogsContextualCohort,
} from './satnogsContextualCohort';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const SATNOGS_DIRECTION_REVIEW_ASSIGNMENT_VERSION =
  'case-vortex-satnogs-direction-review-assignment-v1' as const;
export const SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION =
  'case-vortex-satnogs-direction-review-draft-v1' as const;
export const SATNOGS_DIRECTION_ADJUDICATION_VERSION =
  'case-vortex-satnogs-direction-adjudication-v1' as const;

export const SATNOGS_DIRECTION_REVIEW_DECISIONS = [
  'object_sky_position_confirmed',
  'object_motion_only',
  'observer_or_camera_direction',
  'geographic_or_place_reference',
  'ambiguous_or_insufficient',
  'unrelated_text',
] as const;

export type SatnogsDirectionReviewDecision =
  typeof SATNOGS_DIRECTION_REVIEW_DECISIONS[number];
export type SatnogsDirectionReviewConfidence = 'low' | 'medium' | 'high';

export type SatnogsDirectionReviewAssignment = {
  recordType: 'satnogs_direction_review_assignment';
  schemaVersion: typeof SATNOGS_DIRECTION_REVIEW_ASSIGNMENT_VERSION;
  createdAt: string;
  cohort: {
    schemaVersion: typeof SATNOGS_CONTEXTUAL_COHORT_VERSION;
    corpusVersion: string;
    snapshotId: string;
    universeArchiveSetSha256: string;
    satnogsArchiveDigest: string;
    candidateSetSha256: string;
    cohortDigest: string;
  };
  protocol: {
    mode: 'independent_human_source_text_review';
    blindedFields: [
      'satellite_object_identity',
      'satellite_propagation',
      'candidate_match_output',
      'contextual_edge_output',
    ];
    instruction: string;
    decisions: readonly SatnogsDirectionReviewDecision[];
  };
  items: Array<{
    itemId: string;
    candidateId: string;
    subjectAddress: string;
    source: string;
    sourceRecordId: string | null;
    canonicalUrl: string | null;
    sourceField: 'title' | 'summary';
    sourceText: string;
    sourceTextSha256: string;
    span: {
      unit: 'utf8_byte';
      start: number;
      end: number;
      text: string;
      textSha256: string;
    };
    normalizedDirection: string;
    nodeDigest: string;
    itemDigest: string;
  }>;
  itemSetSha256: string;
  guarantees: {
    satelliteOutputsExposed: 0;
    decisionsPrepopulated: 0;
    humanAdjudicationsCreated: 0;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  assignmentDigest: string;
};

export type SatnogsDirectionReviewDraft = {
  recordType: 'satnogs_direction_review_draft';
  schemaVersion: typeof SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION;
  assignmentDigest: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  attestation: {
    humanPerformed: boolean | null;
    reviewedExactSourceText: boolean | null;
    independentOfSatelliteOutputs: boolean | null;
  };
  reviews: Array<{
    itemId: string;
    decision: SatnogsDirectionReviewDecision | null;
    confidence: SatnogsDirectionReviewConfidence | null;
    rationale: string | null;
  }>;
};

export type SatnogsDirectionAdjudication = {
  recordType: 'satnogs_direction_adjudication';
  schemaVersion: typeof SATNOGS_DIRECTION_ADJUDICATION_VERSION;
  assignmentDigest: string;
  itemSetSha256: string;
  reviewerId: string;
  reviewedAt: string;
  sealedAt: string;
  attestation: {
    humanPerformed: true;
    reviewedExactSourceText: true;
    independentOfSatelliteOutputs: true;
  };
  reviews: Array<{
    itemId: string;
    decision: SatnogsDirectionReviewDecision;
    confidence: SatnogsDirectionReviewConfidence;
    rationale: string;
    reviewDigest: string;
  }>;
  summary: {
    reviewedItemCount: number;
    confirmedSkyPositionCount: number;
    rejectedOrNonPositionCount: number;
    byDecision: Record<SatnogsDirectionReviewDecision, number>;
  };
  reviewSetSha256: string;
  guarantees: {
    completeItemSet: true;
    syntheticHumanReviewCredit: 0;
    automaticAzimuthAssignments: 0;
    automaticElevationAssignments: 0;
    propagatedSatelliteMatches: 0;
    contextualEdgesCreated: 0;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  adjudicationDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const REVIEWER_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/u;
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
};
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid(code);
  return value as string;
};

export const verifySatnogsContextualCohortForReview = (
  value: unknown,
): SatnogsContextualCohort => {
  if (!isObject(value)
    || value.recordType !== 'satnogs_contextual_cohort'
    || value.schemaVersion !== SATNOGS_CONTEXTUAL_COHORT_VERSION
    || !Array.isArray(value.candidates)
    || typeof value.cohortDigest !== 'string'
    || !SHA256.test(value.cohortDigest)) {
    invalid('satnogs_direction_review_cohort_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { cohortDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== cohortDigest) {
    invalid('satnogs_direction_review_cohort_digest_mismatch');
  }
  const cohort = value as unknown as SatnogsContextualCohort;
  if (cohort.summary.selectedCandidateCount !== cohort.candidates.length
    || cohort.candidates.some((candidate) => {
      const { candidateDigest, ...candidateBody } = candidate;
      return !SHA256.test(candidateDigest)
        || relationshipInputSha256(candidateBody) !== candidateDigest
        || !Array.isArray(candidate.directionPhrases)
        || !candidate.directionPhrases.length;
    })) {
    invalid('satnogs_direction_review_candidate_invalid');
  }
  const candidateSetSha256 = relationshipInputSha256(
    cohort.candidates.map(({ candidateId, candidateDigest }) => (
      `${candidateId}:${candidateDigest}`
    )),
  );
  if (cohort.candidateSetSha256 !== candidateSetSha256) {
    invalid('satnogs_direction_review_candidate_set_mismatch');
  }
  return cohort;
};

export const buildSatnogsDirectionReviewAssignment = (params: {
  cohort: unknown;
  createdAt: string;
}): SatnogsDirectionReviewAssignment => {
  const cohort = verifySatnogsContextualCohortForReview(params.cohort);
  const items = cohort.candidates.flatMap((candidate) => (
    candidate.directionPhrases.map((phrase) => {
      const itemCore = {
        candidateId: candidate.candidateId,
        subjectAddress: candidate.address,
        source: candidate.source,
        sourceRecordId: candidate.sourceRecordId,
        canonicalUrl: candidate.canonicalUrl,
        sourceField: phrase.sourceField,
        sourceText: phrase.sourceText,
        sourceTextSha256: phrase.sourceTextSha256,
        span: phrase.span,
        normalizedDirection: phrase.normalizedDirection,
        nodeDigest: candidate.nodeDigest,
      };
      const itemDigest = relationshipInputSha256(itemCore);
      return {
        itemId: `satnogs-direction-review:${itemDigest}`,
        ...itemCore,
        itemDigest,
      };
    })
  )).sort((left, right) => lexical(left.itemId, right.itemId));
  if (!items.length || new Set(items.map(({ itemId }) => itemId)).size !== items.length) {
    invalid('satnogs_direction_review_item_set_invalid');
  }
  const itemSetSha256 = relationshipInputSha256(
    items.map(({ itemId, itemDigest }) => `${itemId}:${itemDigest}`),
  );
  const body: Omit<SatnogsDirectionReviewAssignment, 'assignmentDigest'> = {
    recordType: 'satnogs_direction_review_assignment',
    schemaVersion: SATNOGS_DIRECTION_REVIEW_ASSIGNMENT_VERSION,
    createdAt: timestamp(params.createdAt, 'satnogs_direction_review_created_at_invalid'),
    cohort: {
      schemaVersion: cohort.schemaVersion,
      corpusVersion: cohort.binding.corpusVersion,
      snapshotId: cohort.binding.snapshotId,
      universeArchiveSetSha256: cohort.binding.universeArchiveSetSha256,
      satnogsArchiveDigest: cohort.satnogs.archiveDigest,
      candidateSetSha256: cohort.candidateSetSha256,
      cohortDigest: cohort.cohortDigest,
    },
    protocol: {
      mode: 'independent_human_source_text_review',
      blindedFields: [
        'satellite_object_identity',
        'satellite_propagation',
        'candidate_match_output',
        'contextual_edge_output',
      ],
      instruction: 'Classify only what the highlighted phrase means in its exact source text. Confirm object_sky_position_confirmed only when the phrase locates the observed object in the sky; do not infer azimuth, elevation, satellite identity or causation.',
      decisions: SATNOGS_DIRECTION_REVIEW_DECISIONS,
    },
    items,
    itemSetSha256,
    guarantees: {
      satelliteOutputsExposed: 0,
      decisionsPrepopulated: 0,
      humanAdjudicationsCreated: 0,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, assignmentDigest: relationshipInputSha256(body) };
};

export const verifySatnogsDirectionReviewAssignment = (
  value: unknown,
): SatnogsDirectionReviewAssignment => {
  if (!isObject(value)
    || value.recordType !== 'satnogs_direction_review_assignment'
    || value.schemaVersion !== SATNOGS_DIRECTION_REVIEW_ASSIGNMENT_VERSION
    || typeof value.assignmentDigest !== 'string'
    || !SHA256.test(value.assignmentDigest)) {
    invalid('satnogs_direction_review_assignment_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { assignmentDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== assignmentDigest) {
    invalid('satnogs_direction_review_assignment_digest_mismatch');
  }
  if (!Array.isArray(raw.items) || !raw.items.length
    || typeof raw.itemSetSha256 !== 'string') {
    invalid('satnogs_direction_review_assignment_invalid');
  }
  const items = raw.items as SatnogsDirectionReviewAssignment['items'];
  if (new Set(items.map(({ itemId }) => itemId)).size !== items.length
    || items.some((item) => {
      if (!isObject(item)) return true;
      const { itemId, itemDigest, ...core } = item;
      return typeof itemId !== 'string'
        || itemId !== `satnogs-direction-review:${itemDigest}`
        || typeof itemDigest !== 'string'
        || relationshipInputSha256(core) !== itemDigest;
    })) {
    invalid('satnogs_direction_review_assignment_item_invalid');
  }
  const itemSetSha256 = relationshipInputSha256(
    items.map(({ itemId, itemDigest }) => `${itemId}:${itemDigest}`),
  );
  if (itemSetSha256 !== raw.itemSetSha256) {
    invalid('satnogs_direction_review_assignment_item_set_mismatch');
  }
  return value as unknown as SatnogsDirectionReviewAssignment;
};

export const buildSatnogsDirectionReviewDraft = (
  assignmentValue: unknown,
): SatnogsDirectionReviewDraft => {
  const assignment = verifySatnogsDirectionReviewAssignment(assignmentValue);
  return {
    recordType: 'satnogs_direction_review_draft',
    schemaVersion: SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    reviewerId: null,
    reviewedAt: null,
    attestation: {
      humanPerformed: null,
      reviewedExactSourceText: null,
      independentOfSatelliteOutputs: null,
    },
    reviews: assignment.items.map(({ itemId }) => ({
      itemId,
      decision: null,
      confidence: null,
      rationale: null,
    })),
  };
};

export const sealSatnogsDirectionAdjudication = (params: {
  assignment: unknown;
  draft: unknown;
  sealedAt: string;
}): SatnogsDirectionAdjudication => {
  const assignment = verifySatnogsDirectionReviewAssignment(params.assignment);
  if (!isObject(params.draft)
    || !exactKeys(params.draft, [
      'recordType', 'schemaVersion', 'assignmentDigest', 'reviewerId',
      'reviewedAt', 'attestation', 'reviews',
    ])
    || params.draft.recordType !== 'satnogs_direction_review_draft'
    || params.draft.schemaVersion !== SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION
    || params.draft.assignmentDigest !== assignment.assignmentDigest
    || !Array.isArray(params.draft.reviews)
    || !isObject(params.draft.attestation)) {
    invalid('satnogs_direction_review_draft_invalid');
  }
  const draftValue = params.draft as Record<string, unknown>;
  const reviewerId = String(draftValue.reviewerId || '').trim().toLowerCase();
  if (!REVIEWER_ID.test(reviewerId)) invalid('satnogs_direction_review_reviewer_invalid');
  const reviewedAt = timestamp(
    draftValue.reviewedAt,
    'satnogs_direction_review_reviewed_at_invalid',
  );
  const sealedAt = timestamp(params.sealedAt, 'satnogs_direction_review_sealed_at_invalid');
  if (Date.parse(reviewedAt) < Date.parse(assignment.createdAt)
    || Date.parse(sealedAt) < Date.parse(reviewedAt)) {
    invalid('satnogs_direction_review_timestamp_order_invalid');
  }
  const attestation = draftValue.attestation as Record<string, unknown>;
  if (!exactKeys(attestation, [
    'humanPerformed', 'reviewedExactSourceText', 'independentOfSatelliteOutputs',
  ])
    || attestation.humanPerformed !== true
    || attestation.reviewedExactSourceText !== true
    || attestation.independentOfSatelliteOutputs !== true) {
    invalid('satnogs_direction_review_attestation_invalid');
  }

  const expectedIds = assignment.items.map(({ itemId }) => itemId);
  const draftReviews = draftValue.reviews as unknown[];
  const reviews = draftReviews.map((value) => {
    if (!isObject(value)
      || !exactKeys(value, ['itemId', 'decision', 'confidence', 'rationale'])
      || typeof value.itemId !== 'string'
      || !SATNOGS_DIRECTION_REVIEW_DECISIONS.includes(
        value.decision as SatnogsDirectionReviewDecision,
      )
      || !['low', 'medium', 'high'].includes(String(value.confidence))
      || typeof value.rationale !== 'string') {
      invalid('satnogs_direction_review_response_invalid');
    }
    const rawReview = value as Record<string, unknown>;
    const rationale = (rawReview.rationale as string).trim();
    if (rationale.length < 12 || rationale.length > 2_000) {
      invalid('satnogs_direction_review_rationale_invalid');
    }
    const core = {
      itemId: rawReview.itemId as string,
      decision: rawReview.decision as SatnogsDirectionReviewDecision,
      confidence: rawReview.confidence as SatnogsDirectionReviewConfidence,
      rationale,
    };
    return { ...core, reviewDigest: relationshipInputSha256(core) };
  });
  const actualIds = reviews.map(({ itemId }) => itemId).sort(lexical);
  if (actualIds.length !== expectedIds.length
    || actualIds.some((itemId, index) => itemId !== [...expectedIds].sort(lexical)[index])) {
    invalid('satnogs_direction_review_response_set_mismatch');
  }
  reviews.sort((left, right) => lexical(left.itemId, right.itemId));
  const byDecision = Object.fromEntries(
    SATNOGS_DIRECTION_REVIEW_DECISIONS.map((decision) => [
      decision,
      reviews.filter((review) => review.decision === decision).length,
    ]),
  ) as Record<SatnogsDirectionReviewDecision, number>;
  const confirmedSkyPositionCount = byDecision.object_sky_position_confirmed;
  const reviewSetSha256 = relationshipInputSha256(
    reviews.map(({ itemId, reviewDigest }) => `${itemId}:${reviewDigest}`),
  );
  const body: Omit<SatnogsDirectionAdjudication, 'adjudicationDigest'> = {
    recordType: 'satnogs_direction_adjudication',
    schemaVersion: SATNOGS_DIRECTION_ADJUDICATION_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    itemSetSha256: assignment.itemSetSha256,
    reviewerId,
    reviewedAt,
    sealedAt,
    attestation: {
      humanPerformed: true,
      reviewedExactSourceText: true,
      independentOfSatelliteOutputs: true,
    },
    reviews,
    summary: {
      reviewedItemCount: reviews.length,
      confirmedSkyPositionCount,
      rejectedOrNonPositionCount: reviews.length - confirmedSkyPositionCount,
      byDecision,
    },
    reviewSetSha256,
    guarantees: {
      completeItemSet: true,
      syntheticHumanReviewCredit: 0,
      automaticAzimuthAssignments: 0,
      automaticElevationAssignments: 0,
      propagatedSatelliteMatches: 0,
      contextualEdgesCreated: 0,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, adjudicationDigest: relationshipInputSha256(body) };
};

export const verifySatnogsDirectionAdjudication = (params: {
  assignment: unknown;
  adjudication: unknown;
}) => {
  const assignment = verifySatnogsDirectionReviewAssignment(params.assignment);
  if (!isObject(params.adjudication)
    || params.adjudication.recordType !== 'satnogs_direction_adjudication'
    || params.adjudication.schemaVersion !== SATNOGS_DIRECTION_ADJUDICATION_VERSION
    || typeof params.adjudication.adjudicationDigest !== 'string') {
    invalid('satnogs_direction_adjudication_invalid');
  }
  const raw = params.adjudication as Record<string, unknown>;
  const { adjudicationDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== adjudicationDigest) {
    invalid('satnogs_direction_adjudication_digest_mismatch');
  }
  const adjudication = params.adjudication as unknown as SatnogsDirectionAdjudication;
  const draft: SatnogsDirectionReviewDraft = {
    recordType: 'satnogs_direction_review_draft',
    schemaVersion: SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION,
    assignmentDigest: adjudication.assignmentDigest,
    reviewerId: adjudication.reviewerId,
    reviewedAt: adjudication.reviewedAt,
    attestation: adjudication.attestation,
    reviews: adjudication.reviews.map((review) => ({
      itemId: review.itemId,
      decision: review.decision,
      confidence: review.confidence,
      rationale: review.rationale,
    })),
  };
  const rebuilt = sealSatnogsDirectionAdjudication({
    assignment,
    draft,
    sealedAt: adjudication.sealedAt,
  });
  if (canonicalizeRelationshipInput(rebuilt)
    !== canonicalizeRelationshipInput(adjudication)) {
    invalid('satnogs_direction_adjudication_mismatch');
  }
  return rebuilt;
};
