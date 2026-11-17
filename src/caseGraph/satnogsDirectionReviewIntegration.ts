import {
  type SatnogsContextualCohort,
} from './satnogsContextualCohort';
import {
  buildSatnogsDirectionReviewAssignment,
  type SatnogsDirectionAdjudication,
  type SatnogsDirectionReviewAssignment,
  type SatnogsDirectionReviewDecision,
  verifySatnogsContextualCohortForReview,
  verifySatnogsDirectionAdjudication,
  verifySatnogsDirectionReviewAssignment,
} from './satnogsDirectionHumanReview';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const SATNOGS_DIRECTION_REVIEW_INTEGRATION_VERSION =
  'case-vortex-satnogs-direction-review-integration-v1' as const;

type SubjectDisposition =
  | 'confirmed_direction_available'
  | 'conflicting_confirmed_directions'
  | 'no_confirmed_direction';

type IntegratedSubject = {
  candidateId: string;
  subjectAddress: string;
  source: string;
  sourceRecordId: string | null;
  canonicalUrl: string | null;
  eventTimestamp: string;
  lat: number;
  lon: number;
  nodeDigest: string;
  sourceMaterialSha256: string;
  satelliteCoverage: SatnogsContextualCohort['candidates'][number]['satelliteCoverage'];
  disposition: SubjectDisposition;
  confirmedDirections: Array<{
    itemId: string;
    normalizedDirection: string;
    sourceField: 'title' | 'summary';
    span: SatnogsDirectionReviewAssignment['items'][number]['span'];
    confidence: 'low' | 'medium' | 'high';
    reviewDigest: string;
  }>;
  reviewAccounting: {
    reviewedPhraseCount: number;
    confirmedPhraseCount: number;
    byDecision: Record<SatnogsDirectionReviewDecision, number>;
    reviewSetSha256: string;
  };
  subjectDigest: string;
};

export type SatnogsDirectionReviewIntegration = {
  recordType: 'satnogs_direction_review_integration';
  schemaVersion: typeof SATNOGS_DIRECTION_REVIEW_INTEGRATION_VERSION;
  integratedAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    universeArchiveSetSha256: string;
    cohortDigest: string;
    candidateSetSha256: string;
    assignmentDigest: string;
    itemSetSha256: string;
    adjudicationDigest: string;
    reviewSetSha256: string;
    satnogsArchiveDigest: string;
    satnogsSnapshotSetSha256: string;
  };
  subjects: IntegratedSubject[];
  summary: {
    cohortSubjectCount: number;
    reviewedPhraseCount: number;
    confirmedPhraseCount: number;
    subjectsWithConfirmedDirectionCount: number;
    conflictingConfirmedDirectionCount: number;
    subjectsWithoutConfirmedDirectionCount: number;
  };
  subjectSetSha256: string;
  guarantees: {
    exactCohortAssignmentReplay: true;
    completeSubjectAccounting: true;
    humanAdjudicationsCreated: 0;
    automaticAzimuthAssignments: 0;
    automaticElevationAssignments: 0;
    propagatedSatelliteMatches: 0;
    contextualEdgesCreated: 0;
    providerCalls: 0;
    databaseWrites: 0;
    storageWrites: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  integrationDigest: string;
};

const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };
const required = <T>(value: T | undefined, code: string): T => (
  value === undefined ? invalid(code) : value
);
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value as string;
};

const assertExactAssignmentReplay = (
  cohort: SatnogsContextualCohort,
  assignment: SatnogsDirectionReviewAssignment,
) => {
  const rebuilt = buildSatnogsDirectionReviewAssignment({
    cohort,
    createdAt: assignment.createdAt,
  });
  if (canonicalizeRelationshipInput(rebuilt)
    !== canonicalizeRelationshipInput(assignment)) {
    invalid('satnogs_direction_integration_assignment_cohort_mismatch');
  }
};

export const buildSatnogsDirectionReviewIntegration = (params: {
  cohort: unknown;
  assignment: unknown;
  adjudication: unknown;
  integratedAt: string;
}): SatnogsDirectionReviewIntegration => {
  const cohort = verifySatnogsContextualCohortForReview(params.cohort);
  const assignment = verifySatnogsDirectionReviewAssignment(params.assignment);
  assertExactAssignmentReplay(cohort, assignment);
  const adjudication = verifySatnogsDirectionAdjudication({
    assignment,
    adjudication: params.adjudication,
  });
  const integratedAt = timestamp(
    params.integratedAt,
    'satnogs_direction_integration_timestamp_invalid',
  );
  if (Date.parse(integratedAt) < Date.parse(adjudication.sealedAt)) {
    invalid('satnogs_direction_integration_timestamp_order_invalid');
  }

  const items = new Map(assignment.items.map((item) => [item.itemId, item]));
  const reviews = new Map(adjudication.reviews.map((review) => [review.itemId, review]));
  const decisions = assignment.protocol.decisions;
  const subjects = cohort.candidates.map((candidate) => {
    const candidateItems = assignment.items
      .filter(({ candidateId }) => candidateId === candidate.candidateId)
      .sort((left, right) => lexical(left.itemId, right.itemId));
    if (candidateItems.length !== candidate.directionPhrases.length) {
      invalid('satnogs_direction_integration_candidate_item_count_mismatch');
    }
    const candidateReviews = candidateItems.map(({ itemId }) => required(
      reviews.get(itemId),
      'satnogs_direction_integration_review_missing',
    ));
    const confirmedDirections = candidateReviews
      .filter(({ decision }) => decision === 'object_sky_position_confirmed')
      .map((review) => {
        const item = required(
          items.get(review.itemId),
          'satnogs_direction_integration_item_missing',
        );
        return {
          itemId: review.itemId,
          normalizedDirection: item.normalizedDirection,
          sourceField: item.sourceField,
          span: item.span,
          confidence: review.confidence,
          reviewDigest: review.reviewDigest,
        };
      })
      .sort((left, right) => lexical(left.itemId, right.itemId));
    const uniqueDirections = new Set(
      confirmedDirections.map(({ normalizedDirection }) => normalizedDirection),
    );
    const disposition: SubjectDisposition = confirmedDirections.length === 0
      ? 'no_confirmed_direction'
      : uniqueDirections.size === 1
        ? 'confirmed_direction_available'
        : 'conflicting_confirmed_directions';
    const byDecision = Object.fromEntries(decisions.map((decision) => [
      decision,
      candidateReviews.filter((review) => review.decision === decision).length,
    ])) as Record<SatnogsDirectionReviewDecision, number>;
    const reviewSetSha256 = relationshipInputSha256(candidateReviews.map(
      ({ itemId, reviewDigest }) => `${itemId}:${reviewDigest}`,
    ));
    const core = {
      candidateId: candidate.candidateId,
      subjectAddress: candidate.address,
      source: candidate.source,
      sourceRecordId: candidate.sourceRecordId,
      canonicalUrl: candidate.canonicalUrl,
      eventTimestamp: candidate.eventTimestamp,
      lat: candidate.lat,
      lon: candidate.lon,
      nodeDigest: candidate.nodeDigest,
      sourceMaterialSha256: candidate.sourceMaterialSha256,
      satelliteCoverage: candidate.satelliteCoverage,
      disposition,
      confirmedDirections,
      reviewAccounting: {
        reviewedPhraseCount: candidateReviews.length,
        confirmedPhraseCount: confirmedDirections.length,
        byDecision,
        reviewSetSha256,
      },
    };
    return { ...core, subjectDigest: relationshipInputSha256(core) };
  }).sort((left, right) => lexical(left.candidateId, right.candidateId));

  if (subjects.length !== cohort.candidates.length
    || new Set(subjects.map(({ candidateId }) => candidateId)).size !== subjects.length) {
    invalid('satnogs_direction_integration_subject_accounting_invalid');
  }
  const subjectSetSha256 = relationshipInputSha256(subjects.map(
    ({ candidateId, subjectDigest }) => `${candidateId}:${subjectDigest}`,
  ));
  const summary = {
    cohortSubjectCount: subjects.length,
    reviewedPhraseCount: subjects.reduce(
      (sum, subject) => sum + subject.reviewAccounting.reviewedPhraseCount,
      0,
    ),
    confirmedPhraseCount: subjects.reduce(
      (sum, subject) => sum + subject.reviewAccounting.confirmedPhraseCount,
      0,
    ),
    subjectsWithConfirmedDirectionCount: subjects.filter(
      ({ disposition }) => disposition === 'confirmed_direction_available',
    ).length,
    conflictingConfirmedDirectionCount: subjects.filter(
      ({ disposition }) => disposition === 'conflicting_confirmed_directions',
    ).length,
    subjectsWithoutConfirmedDirectionCount: subjects.filter(
      ({ disposition }) => disposition === 'no_confirmed_direction',
    ).length,
  };
  if (summary.reviewedPhraseCount !== adjudication.summary.reviewedItemCount
    || summary.confirmedPhraseCount !== adjudication.summary.confirmedSkyPositionCount
    || summary.cohortSubjectCount
      !== summary.subjectsWithConfirmedDirectionCount
      + summary.conflictingConfirmedDirectionCount
      + summary.subjectsWithoutConfirmedDirectionCount) {
    invalid('satnogs_direction_integration_summary_invalid');
  }
  const body: Omit<SatnogsDirectionReviewIntegration, 'integrationDigest'> = {
    recordType: 'satnogs_direction_review_integration',
    schemaVersion: SATNOGS_DIRECTION_REVIEW_INTEGRATION_VERSION,
    integratedAt,
    binding: {
      corpusVersion: cohort.binding.corpusVersion,
      snapshotId: cohort.binding.snapshotId,
      universeArchiveSetSha256: cohort.binding.universeArchiveSetSha256,
      cohortDigest: cohort.cohortDigest,
      candidateSetSha256: cohort.candidateSetSha256,
      assignmentDigest: assignment.assignmentDigest,
      itemSetSha256: assignment.itemSetSha256,
      adjudicationDigest: adjudication.adjudicationDigest,
      reviewSetSha256: adjudication.reviewSetSha256,
      satnogsArchiveDigest: cohort.satnogs.archiveDigest,
      satnogsSnapshotSetSha256: cohort.satnogs.snapshotSetSha256,
    },
    subjects,
    summary,
    subjectSetSha256,
    guarantees: {
      exactCohortAssignmentReplay: true,
      completeSubjectAccounting: true,
      humanAdjudicationsCreated: 0,
      automaticAzimuthAssignments: 0,
      automaticElevationAssignments: 0,
      propagatedSatelliteMatches: 0,
      contextualEdgesCreated: 0,
      providerCalls: 0,
      databaseWrites: 0,
      storageWrites: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, integrationDigest: relationshipInputSha256(body) };
};

export const verifySatnogsDirectionReviewIntegration = (params: {
  cohort: unknown;
  assignment: unknown;
  adjudication: unknown;
  integration: unknown;
}) => {
  if (!isObject(params.integration)
    || params.integration.recordType !== 'satnogs_direction_review_integration'
    || params.integration.schemaVersion !== SATNOGS_DIRECTION_REVIEW_INTEGRATION_VERSION
    || typeof params.integration.integratedAt !== 'string'
    || typeof params.integration.integrationDigest !== 'string') {
    invalid('satnogs_direction_integration_invalid');
  }
  const integration = params.integration as unknown as SatnogsDirectionReviewIntegration;
  const rebuilt = buildSatnogsDirectionReviewIntegration({
    cohort: params.cohort,
    assignment: params.assignment,
    adjudication: params.adjudication,
    integratedAt: integration.integratedAt,
  });
  if (canonicalizeRelationshipInput(rebuilt)
    !== canonicalizeRelationshipInput(integration)) {
    invalid('satnogs_direction_integration_mismatch');
  }
  return rebuilt;
};
