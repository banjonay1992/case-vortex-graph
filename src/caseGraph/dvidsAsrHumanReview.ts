import {
  DVIDS_ASR_REVIEW_QUEUE_VERSION,
  type DvidsAsrReviewQueue,
} from './dvidsAsrReviewQueue';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_ASR_HUMAN_REVIEW_ASSIGNMENT_VERSION =
  'case-vortex-dvids-asr-human-review-assignment-v1' as const;
export const DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION =
  'case-vortex-dvids-asr-human-review-draft-v1' as const;
export const DVIDS_ASR_HUMAN_ADJUDICATION_VERSION =
  'case-vortex-dvids-asr-human-adjudication-v1' as const;

export const DVIDS_ASR_HUMAN_REVIEW_DECISIONS = [
  'exact',
  'corrected',
  'rejected',
] as const;

type Decision = typeof DVIDS_ASR_HUMAN_REVIEW_DECISIONS[number];
type Confidence = 'low' | 'medium' | 'high';

export type DvidsAsrHumanReviewAssignment = {
  recordType: 'dvids_asr_human_review_assignment';
  schemaVersion: typeof DVIDS_ASR_HUMAN_REVIEW_ASSIGNMENT_VERSION;
  createdAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    asrQueueSchemaVersion: typeof DVIDS_ASR_REVIEW_QUEUE_VERSION;
    asrQueueDigest: string;
    asrReviewItemSetSha256: string;
    toolchainDigest: string;
  };
  protocol: {
    decisions: [...typeof DVIDS_ASR_HUMAN_REVIEW_DECISIONS];
    confidenceValues: ['low', 'medium', 'high'];
    requiredReviewRequirements: [
      'listen_to_exact_checksum_bound_media_interval',
      'correct_or_reject_machine_transcript',
      'preserve_timecode_and_machine_origin',
      'do_not_treat_transcript_as_verified_event_claim',
    ];
  };
  items: Array<{
    itemId: string;
    address: string;
    segmentOrdinal: number;
    startMs: number;
    endMs: number;
    machineText: string;
    machineTextSha256: string;
    machineConfidence: number;
    objectResultDigest: string;
    reviewItemDigest: string;
    evidenceSemantics: 'machine_asr_unreviewed';
    itemDigest: string;
  }>;
  itemSetSha256: string;
  guarantees: {
    exactAsrQueueBinding: true;
    exactChecksumBoundMediaIntervalsRequired: true;
    decisionsPrepopulated: 0;
    humanAdjudicationsCreated: 0;
    claimsAuthorized: false;
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

export type DvidsAsrHumanReviewDraft = {
  recordType: 'dvids_asr_human_review_draft';
  schemaVersion: typeof DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION;
  assignmentDigest: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  attestation: {
    humanPerformed: boolean | null;
    listenedToExactChecksumBoundMediaIntervals: boolean | null;
    preservedTimecodeAndMachineOrigin: boolean | null;
    noEventClaimOrIdentityImplied: boolean | null;
  };
  reviews: Array<{
    itemId: string;
    decision: Decision | null;
    correctedText: string | null;
    confidence: Confidence | null;
    rationale: string | null;
  }>;
};

export type DvidsAsrHumanAdjudication = {
  recordType: 'dvids_asr_human_adjudication';
  schemaVersion: typeof DVIDS_ASR_HUMAN_ADJUDICATION_VERSION;
  assignmentDigest: string;
  itemSetSha256: string;
  reviewerId: string;
  reviewedAt: string;
  sealedAt: string;
  attestation: {
    humanPerformed: true;
    listenedToExactChecksumBoundMediaIntervals: true;
    preservedTimecodeAndMachineOrigin: true;
    noEventClaimOrIdentityImplied: true;
  };
  reviews: Array<{
    itemId: string;
    decision: Decision;
    correctedText: string | null;
    correctedTextSha256: string | null;
    reviewedTranscript: string | null;
    reviewedTranscriptSha256: string | null;
    confidence: Confidence;
    rationale: string;
    evidenceSemantics: 'human_reviewed_asr_transcript_not_event_claim';
    reviewDigest: string;
  }>;
  reviewedTranscripts: Array<{
    itemId: string;
    address: string;
    segmentOrdinal: number;
    startMs: number;
    endMs: number;
    machineText: string;
    machineTextSha256: string;
    objectResultDigest: string;
    reviewItemDigest: string;
    decision: Exclude<Decision, 'rejected'>;
    reviewedTranscript: string;
    reviewedTranscriptSha256: string;
    evidenceSemantics: 'human_reviewed_asr_transcript_not_event_claim';
    transcriptDigest: string;
  }>;
  summary: {
    reviewedItemCount: number;
    exactTranscriptCount: number;
    correctedTranscriptCount: number;
    rejectedTranscriptCount: number;
    retainedTranscriptCount: number;
  };
  reviewSetSha256: string;
  reviewedTranscriptSetSha256: string;
  guarantees: {
    completeExactItemSet: true;
    exactChecksumBoundMediaIntervalsListened: true;
    timecodeAndMachineOriginPreserved: true;
    syntheticHumanReviewCredit: 0;
    claimsAuthorized: false;
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
const object = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const lexical = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort(lexical);
  const expected = [...keys].sort(lexical);
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};
const timestamp = (value: unknown, code: string) => {
  const text = typeof value === 'string' ? value : fail(code);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) {
    fail(code);
  }
  return text;
};
const boundedText = (
  value: unknown,
  minimum: number,
  maximumBytes: number,
  code: string,
) => {
  const text = typeof value === 'string' ? value.trim() : fail(code);
  if (text.length < minimum || text !== text.normalize('NFC')
    || Buffer.byteLength(text, 'utf8') > maximumBytes
    || text.includes('\u0000')) {
    fail(code);
  }
  return text;
};

const verifyQueueEnvelope = (queue: DvidsAsrReviewQueue) => {
  if (!object(queue)
    || queue.recordType !== 'dvids_asr_review_queue'
    || queue.schemaVersion !== DVIDS_ASR_REVIEW_QUEUE_VERSION
    || !SHA256.test(queue.queueDigest)
    || !SHA256.test(queue.reviewItemSetSha256)
    || !SHA256.test(queue.toolchain.toolchainDigest)
    || !Array.isArray(queue.reviewItems)
    || queue.reviewItems.length < 1) {
    fail('dvids_asr_human_review_queue_invalid');
  }
  const { queueDigest, ...body } = queue;
  if (relationshipInputSha256(body) !== queueDigest
    || queue.reviewItems.some((item) => (
      item.reviewStatus !== 'unreviewed'
      || item.evidenceSemantics !== 'machine_asr_unreviewed'
      || relationshipInputSha256(item.text) !== item.textSha256
      || !Number.isSafeInteger(item.segmentOrdinal)
      || !Number.isSafeInteger(item.startMs)
      || !Number.isSafeInteger(item.endMs)
      || item.startMs < 0
      || item.endMs <= item.startMs
    ))) {
    fail('dvids_asr_human_review_queue_invalid');
  }
  return queue;
};

export const buildDvidsAsrHumanReviewAssignment = (params: {
  queue: DvidsAsrReviewQueue;
  createdAt: string;
}): DvidsAsrHumanReviewAssignment => {
  const queue = verifyQueueEnvelope(params.queue);
  const items = queue.reviewItems.map((reviewItem) => {
    const core = {
      address: reviewItem.address,
      segmentOrdinal: reviewItem.segmentOrdinal,
      startMs: reviewItem.startMs,
      endMs: reviewItem.endMs,
      machineText: reviewItem.text,
      machineTextSha256: reviewItem.textSha256,
      machineConfidence: reviewItem.confidence,
      objectResultDigest: reviewItem.objectResultDigest,
      reviewItemDigest: reviewItem.reviewItemDigest,
      evidenceSemantics: 'machine_asr_unreviewed' as const,
    };
    const itemDigest = relationshipInputSha256(core);
    return {
      itemId: `dvids-asr-human-review:${itemDigest}`,
      ...core,
      itemDigest,
    };
  }).sort((left, right) => lexical(left.itemId, right.itemId));
  const itemSetSha256 = relationshipInputSha256(items.map(
    ({ itemId, itemDigest }) => `${itemId}:${itemDigest}`,
  ));
  const body: Omit<DvidsAsrHumanReviewAssignment, 'assignmentDigest'> = {
    recordType: 'dvids_asr_human_review_assignment',
    schemaVersion: DVIDS_ASR_HUMAN_REVIEW_ASSIGNMENT_VERSION,
    createdAt: timestamp(
      params.createdAt,
      'dvids_asr_human_review_created_at_invalid',
    ),
    binding: {
      corpusVersion: queue.binding.corpusVersion,
      snapshotId: queue.binding.snapshotId,
      asrQueueSchemaVersion: queue.schemaVersion,
      asrQueueDigest: queue.queueDigest,
      asrReviewItemSetSha256: queue.reviewItemSetSha256,
      toolchainDigest: queue.toolchain.toolchainDigest,
    },
    protocol: {
      decisions: [...DVIDS_ASR_HUMAN_REVIEW_DECISIONS],
      confidenceValues: ['low', 'medium', 'high'],
      requiredReviewRequirements: [
        'listen_to_exact_checksum_bound_media_interval',
        'correct_or_reject_machine_transcript',
        'preserve_timecode_and_machine_origin',
        'do_not_treat_transcript_as_verified_event_claim',
      ],
    },
    items,
    itemSetSha256,
    guarantees: {
      exactAsrQueueBinding: true,
      exactChecksumBoundMediaIntervalsRequired: true,
      decisionsPrepopulated: 0,
      humanAdjudicationsCreated: 0,
      claimsAuthorized: false,
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

export const verifyDvidsAsrHumanReviewAssignment = (
  value: unknown,
): DvidsAsrHumanReviewAssignment => {
  if (!object(value)
    || value.recordType !== 'dvids_asr_human_review_assignment'
    || value.schemaVersion !== DVIDS_ASR_HUMAN_REVIEW_ASSIGNMENT_VERSION
    || !SHA256.test(String(value.assignmentDigest))
    || !Array.isArray(value.items)) {
    fail('dvids_asr_human_review_assignment_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { assignmentDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== assignmentDigest) {
    fail('dvids_asr_human_review_assignment_digest_mismatch');
  }
  const assignment = value as unknown as DvidsAsrHumanReviewAssignment;
  if (assignment.items.length < 1
    || new Set(assignment.items.map(({ itemId }) => itemId)).size
      !== assignment.items.length
    || assignment.items.some((item) => {
      const { itemId, itemDigest, ...core } = item;
      return itemId !== `dvids-asr-human-review:${itemDigest}`
        || !SHA256.test(item.machineTextSha256)
        || !SHA256.test(item.objectResultDigest)
        || !SHA256.test(item.reviewItemDigest)
        || relationshipInputSha256(item.machineText) !== item.machineTextSha256
        || !Number.isSafeInteger(item.segmentOrdinal)
        || !Number.isSafeInteger(item.startMs)
        || !Number.isSafeInteger(item.endMs)
        || item.segmentOrdinal < 0
        || item.startMs < 0
        || item.endMs <= item.startMs
        || item.evidenceSemantics !== 'machine_asr_unreviewed'
        || relationshipInputSha256(core) !== itemDigest;
    })
    || relationshipInputSha256(assignment.items.map(
      ({ itemId, itemDigest }) => `${itemId}:${itemDigest}`,
    )) !== assignment.itemSetSha256) {
    fail('dvids_asr_human_review_assignment_item_invalid');
  }
  return assignment;
};

export const buildDvidsAsrHumanReviewDraft = (
  assignmentValue: unknown,
): DvidsAsrHumanReviewDraft => {
  const assignment = verifyDvidsAsrHumanReviewAssignment(assignmentValue);
  return {
    recordType: 'dvids_asr_human_review_draft',
    schemaVersion: DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    reviewerId: null,
    reviewedAt: null,
    attestation: {
      humanPerformed: null,
      listenedToExactChecksumBoundMediaIntervals: null,
      preservedTimecodeAndMachineOrigin: null,
      noEventClaimOrIdentityImplied: null,
    },
    reviews: assignment.items.map(({ itemId }) => ({
      itemId,
      decision: null,
      correctedText: null,
      confidence: null,
      rationale: null,
    })),
  };
};

export const sealDvidsAsrHumanAdjudication = (params: {
  assignment: unknown;
  draft: unknown;
  sealedAt: string;
}): DvidsAsrHumanAdjudication => {
  const assignment = verifyDvidsAsrHumanReviewAssignment(params.assignment);
  if (!object(params.draft)
    || !exactKeys(params.draft, [
      'recordType', 'schemaVersion', 'assignmentDigest', 'reviewerId',
      'reviewedAt', 'attestation', 'reviews',
    ])
    || params.draft.recordType !== 'dvids_asr_human_review_draft'
    || params.draft.schemaVersion !== DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION
    || params.draft.assignmentDigest !== assignment.assignmentDigest
    || !object(params.draft.attestation)
    || !Array.isArray(params.draft.reviews)) {
    fail('dvids_asr_human_review_draft_invalid');
  }
  const draft = params.draft as Record<string, unknown>;
  const attestation = draft.attestation as Record<string, unknown>;
  const reviewerId = String(draft.reviewerId || '').trim().toLowerCase();
  if (!REVIEWER_ID.test(reviewerId)) {
    fail('dvids_asr_human_review_reviewer_invalid');
  }
  const reviewedAt = timestamp(
    draft.reviewedAt,
    'dvids_asr_human_review_reviewed_at_invalid',
  );
  const sealedAt = timestamp(
    params.sealedAt,
    'dvids_asr_human_review_sealed_at_invalid',
  );
  if (Date.parse(reviewedAt) < Date.parse(assignment.createdAt)
    || Date.parse(sealedAt) < Date.parse(reviewedAt)) {
    fail('dvids_asr_human_review_timestamp_order_invalid');
  }
  if (!exactKeys(attestation, [
    'humanPerformed', 'listenedToExactChecksumBoundMediaIntervals',
    'preservedTimecodeAndMachineOrigin', 'noEventClaimOrIdentityImplied',
  ]) || Object.values(attestation).some((entry) => entry !== true)) {
    fail('dvids_asr_human_review_attestation_invalid');
  }
  const itemById = new Map(assignment.items.map((item) => [item.itemId, item]));
  const reviews = (draft.reviews as unknown[]).map((raw) => {
    if (!object(raw)
      || !exactKeys(raw, [
        'itemId', 'decision', 'correctedText', 'confidence', 'rationale',
      ])
      || typeof raw.itemId !== 'string'
      || !DVIDS_ASR_HUMAN_REVIEW_DECISIONS.includes(raw.decision as Decision)
      || !['low', 'medium', 'high'].includes(String(raw.confidence))) {
      fail('dvids_asr_human_review_response_invalid');
    }
    const response = raw as Record<string, unknown> & { itemId: string };
    const item = itemById.get(response.itemId)
      || fail('dvids_asr_human_review_response_invalid');
    const decision = response.decision as Decision;
    const correctedText = decision === 'corrected'
      ? boundedText(
        response.correctedText,
        1,
        64 * 1024,
        'dvids_asr_human_review_corrected_text_invalid',
      )
      : null;
    if ((decision !== 'corrected' && response.correctedText !== null)
      || (decision === 'corrected' && correctedText === item.machineText)) {
      fail('dvids_asr_human_review_corrected_text_invalid');
    }
    const reviewedTranscript = decision === 'rejected'
      ? null
      : decision === 'exact' ? item.machineText : correctedText;
    const core = {
      itemId: response.itemId,
      decision,
      correctedText,
      correctedTextSha256: correctedText === null
        ? null
        : relationshipInputSha256(correctedText),
      reviewedTranscript,
      reviewedTranscriptSha256: reviewedTranscript === null
        ? null
        : relationshipInputSha256(reviewedTranscript),
      confidence: response.confidence as Confidence,
      rationale: boundedText(
        response.rationale,
        12,
        2_000,
        'dvids_asr_human_review_rationale_invalid',
      ),
      evidenceSemantics:
        'human_reviewed_asr_transcript_not_event_claim' as const,
    };
    return { ...core, reviewDigest: relationshipInputSha256(core) };
  }).sort((left, right) => lexical(left.itemId, right.itemId));
  const expectedIds = [...itemById.keys()].sort(lexical);
  if (reviews.length !== expectedIds.length
    || reviews.some(({ itemId }, index) => itemId !== expectedIds[index])) {
    fail('dvids_asr_human_review_response_set_mismatch');
  }
  const reviewedTranscripts = reviews.flatMap((review) => {
    if (review.decision === 'rejected' || review.reviewedTranscript === null) {
      return [];
    }
    const item = itemById.get(review.itemId)!;
    const core = {
      itemId: item.itemId,
      address: item.address,
      segmentOrdinal: item.segmentOrdinal,
      startMs: item.startMs,
      endMs: item.endMs,
      machineText: item.machineText,
      machineTextSha256: item.machineTextSha256,
      objectResultDigest: item.objectResultDigest,
      reviewItemDigest: item.reviewItemDigest,
      decision: review.decision,
      reviewedTranscript: review.reviewedTranscript,
      reviewedTranscriptSha256: review.reviewedTranscriptSha256!,
      evidenceSemantics:
        'human_reviewed_asr_transcript_not_event_claim' as const,
    };
    return [{ ...core, transcriptDigest: relationshipInputSha256(core) }];
  });
  const reviewSetSha256 = relationshipInputSha256(reviews.map(
    ({ itemId, reviewDigest }) => `${itemId}:${reviewDigest}`,
  ));
  const reviewedTranscriptSetSha256 = relationshipInputSha256(
    reviewedTranscripts.map(({ transcriptDigest }) => transcriptDigest),
  );
  const body: Omit<DvidsAsrHumanAdjudication, 'adjudicationDigest'> = {
    recordType: 'dvids_asr_human_adjudication',
    schemaVersion: DVIDS_ASR_HUMAN_ADJUDICATION_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    itemSetSha256: assignment.itemSetSha256,
    reviewerId,
    reviewedAt,
    sealedAt,
    attestation: {
      humanPerformed: true,
      listenedToExactChecksumBoundMediaIntervals: true,
      preservedTimecodeAndMachineOrigin: true,
      noEventClaimOrIdentityImplied: true,
    },
    reviews,
    reviewedTranscripts,
    summary: {
      reviewedItemCount: reviews.length,
      exactTranscriptCount: reviews.filter(({ decision }) => decision === 'exact')
        .length,
      correctedTranscriptCount: reviews.filter(
        ({ decision }) => decision === 'corrected',
      ).length,
      rejectedTranscriptCount: reviews.filter(
        ({ decision }) => decision === 'rejected',
      ).length,
      retainedTranscriptCount: reviewedTranscripts.length,
    },
    reviewSetSha256,
    reviewedTranscriptSetSha256,
    guarantees: {
      completeExactItemSet: true,
      exactChecksumBoundMediaIntervalsListened: true,
      timecodeAndMachineOriginPreserved: true,
      syntheticHumanReviewCredit: 0,
      claimsAuthorized: false,
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

export const verifyDvidsAsrHumanAdjudication = (params: {
  assignment: unknown;
  adjudication: unknown;
}) => {
  if (!object(params.adjudication)
    || params.adjudication.recordType !== 'dvids_asr_human_adjudication'
    || params.adjudication.schemaVersion !== DVIDS_ASR_HUMAN_ADJUDICATION_VERSION) {
    fail('dvids_asr_human_adjudication_invalid');
  }
  const value = params.adjudication as unknown as DvidsAsrHumanAdjudication;
  const draft: DvidsAsrHumanReviewDraft = {
    recordType: 'dvids_asr_human_review_draft',
    schemaVersion: DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION,
    assignmentDigest: value.assignmentDigest,
    reviewerId: value.reviewerId,
    reviewedAt: value.reviewedAt,
    attestation: value.attestation,
    reviews: value.reviews.map((review) => ({
      itemId: review.itemId,
      decision: review.decision,
      correctedText: review.correctedText,
      confidence: review.confidence,
      rationale: review.rationale,
    })),
  };
  const rebuilt = sealDvidsAsrHumanAdjudication({
    assignment: params.assignment,
    draft,
    sealedAt: value.sealedAt,
  });
  if (relationshipInputSha256(rebuilt) !== relationshipInputSha256(value)) {
    fail('dvids_asr_human_adjudication_integrity_failed');
  }
  return value;
};
