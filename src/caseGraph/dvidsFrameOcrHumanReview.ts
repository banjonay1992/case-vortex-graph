import {
  DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION,
  type DvidsFrameOcrReviewQueue,
} from './dvidsFrameOcrReviewQueue';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_FRAME_OCR_REVIEW_ASSIGNMENT_VERSION =
  'case-vortex-dvids-frame-ocr-human-review-assignment-v1' as const;
export const DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION =
  'case-vortex-dvids-frame-ocr-human-review-draft-v1' as const;
export const DVIDS_FRAME_OCR_ADJUDICATION_VERSION =
  'case-vortex-dvids-frame-ocr-human-adjudication-v1' as const;

export const DVIDS_FRAME_OCR_REVIEW_DECISIONS = [
  'ocr_exact',
  'ocr_corrected',
  'ocr_rejected',
] as const;

type Decision = typeof DVIDS_FRAME_OCR_REVIEW_DECISIONS[number];
type Confidence = 'low' | 'medium' | 'high';

export type DvidsRecoveredOcrFrame = {
  address: string;
  keyframeOrdinal: number;
  frameFileName: string;
  frameBytes: number;
  frameSha256: string;
  frameWidth: number;
  frameHeight: number;
};

export type DvidsFrameOcrReviewAssignment = {
  recordType: 'dvids_frame_ocr_human_review_assignment';
  schemaVersion: typeof DVIDS_FRAME_OCR_REVIEW_ASSIGNMENT_VERSION;
  createdAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    frameOcrQueueSchemaVersion: typeof DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION;
    frameOcrQueueDigest: string;
    frameOcrReviewItemSetSha256: string;
    toolchainDigest: string;
  };
  protocol: {
    decisions: [...typeof DVIDS_FRAME_OCR_REVIEW_DECISIONS];
    confidenceValues: ['low', 'medium', 'high'];
  };
  items: Array<{
    itemId: string;
    address: string;
    keyframeOrdinal: number;
    keyframeMs: number;
    machineText: string;
    machineTextSha256: string;
    machineConfidence: number;
    frameDigest: string;
    reviewItemDigest: string;
    frameFileName: string;
    frameBytes: number;
    frameSha256: string;
    frameWidth: number;
    frameHeight: number;
    evidenceSemantics: 'machine_frame_ocr';
    itemDigest: string;
  }>;
  itemSetSha256: string;
  guarantees: {
    exactFrameOcrQueueBinding: true;
    exactRecoveredFrameBytesBound: true;
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

export type DvidsFrameOcrReviewDraft = {
  recordType: 'dvids_frame_ocr_human_review_draft';
  schemaVersion: typeof DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION;
  assignmentDigest: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  attestation: {
    humanPerformed: boolean | null;
    viewedExactRecoveredFrames: boolean | null;
    preservedMachineOcrOrigin: boolean | null;
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

export type DvidsFrameOcrAdjudication = {
  recordType: 'dvids_frame_ocr_human_adjudication';
  schemaVersion: typeof DVIDS_FRAME_OCR_ADJUDICATION_VERSION;
  assignmentDigest: string;
  itemSetSha256: string;
  reviewerId: string;
  reviewedAt: string;
  sealedAt: string;
  attestation: {
    humanPerformed: true;
    viewedExactRecoveredFrames: true;
    preservedMachineOcrOrigin: true;
    noEventClaimOrIdentityImplied: true;
  };
  reviews: Array<{
    itemId: string;
    decision: Decision;
    correctedText: string | null;
    correctedTextSha256: string | null;
    reviewedFrameText: string | null;
    reviewedFrameTextSha256: string | null;
    confidence: Confidence;
    rationale: string;
    evidenceSemantics:
      'human_reviewed_frame_text_not_event_claim';
    reviewDigest: string;
  }>;
  summary: {
    reviewedItemCount: number;
    exactOcrCount: number;
    correctedOcrCount: number;
    rejectedOcrCount: number;
    retainedFrameTextCount: number;
  };
  reviewSetSha256: string;
  guarantees: {
    completeExactItemSet: true;
    exactRecoveredFrameViewed: true;
    machineOriginPreserved: true;
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
const FILE_NAME = /^frame-[a-f0-9]{64}\.png$/u;
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

const verifyQueueEnvelope = (queue: DvidsFrameOcrReviewQueue) => {
  if (!object(queue)
    || queue.recordType !== 'dvids_frame_ocr_review_queue'
    || queue.schemaVersion !== DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION
    || !SHA256.test(queue.queueDigest)
    || !SHA256.test(queue.reviewItemSetSha256)
    || !Array.isArray(queue.frames)
    || !Array.isArray(queue.reviewItems)
    || queue.reviewItems.length < 1) {
    fail('dvids_frame_ocr_human_review_queue_invalid');
  }
  const { queueDigest, ...body } = queue;
  if (relationshipInputSha256(body) !== queueDigest
    || queue.reviewItems.some((item) => (
      item.reviewStatus !== 'unreviewed'
      || item.evidenceSemantics !== 'machine_frame_ocr'
      || relationshipInputSha256(item.text) !== item.textSha256
    ))) {
    fail('dvids_frame_ocr_human_review_queue_invalid');
  }
  return queue;
};

export const buildDvidsFrameOcrReviewAssignment = (params: {
  queue: DvidsFrameOcrReviewQueue;
  recoveredFrames: readonly DvidsRecoveredOcrFrame[];
  createdAt: string;
}): DvidsFrameOcrReviewAssignment => {
  const queue = verifyQueueEnvelope(params.queue);
  const recovered = new Map(params.recoveredFrames.map((frame) => [
    `${frame.address}:${frame.keyframeOrdinal}`,
    frame,
  ]));
  if (recovered.size !== params.recoveredFrames.length
    || recovered.size !== queue.reviewItems.length) {
    fail('dvids_frame_ocr_human_review_frame_accounting_invalid');
  }
  const items = queue.reviewItems.map((reviewItem) => {
    const key = `${reviewItem.address}:${reviewItem.keyframeOrdinal}`;
    const frame = queue.frames.find((candidate) => (
      candidate.address === reviewItem.address
      && candidate.keyframeOrdinal === reviewItem.keyframeOrdinal
    )) || fail('dvids_frame_ocr_human_review_frame_invalid');
    const artifact = recovered.get(key)
      || fail('dvids_frame_ocr_human_review_frame_invalid');
    if (artifact.frameBytes !== frame.frameBytes
      || artifact.frameSha256 !== frame.frameSha256
      || artifact.frameWidth !== frame.frameWidth
      || artifact.frameHeight !== frame.frameHeight
      || !FILE_NAME.test(artifact.frameFileName)
      || artifact.frameFileName !== `frame-${frame.frameSha256}.png`) {
      fail('dvids_frame_ocr_human_review_frame_invalid');
    }
    const core = {
      address: reviewItem.address,
      keyframeOrdinal: reviewItem.keyframeOrdinal,
      keyframeMs: reviewItem.keyframeMs,
      machineText: reviewItem.text,
      machineTextSha256: reviewItem.textSha256,
      machineConfidence: reviewItem.confidence,
      frameDigest: reviewItem.frameDigest,
      reviewItemDigest: reviewItem.reviewItemDigest,
      frameFileName: artifact.frameFileName,
      frameBytes: artifact.frameBytes,
      frameSha256: artifact.frameSha256,
      frameWidth: artifact.frameWidth,
      frameHeight: artifact.frameHeight,
      evidenceSemantics: 'machine_frame_ocr' as const,
    };
    const itemDigest = relationshipInputSha256(core);
    return {
      itemId: `dvids-frame-ocr-review:${itemDigest}`,
      ...core,
      itemDigest,
    };
  }).sort((left, right) => lexical(left.itemId, right.itemId));
  const itemSetSha256 = relationshipInputSha256(items.map(
    ({ itemId, itemDigest }) => `${itemId}:${itemDigest}`,
  ));
  const body: Omit<DvidsFrameOcrReviewAssignment, 'assignmentDigest'> = {
    recordType: 'dvids_frame_ocr_human_review_assignment',
    schemaVersion: DVIDS_FRAME_OCR_REVIEW_ASSIGNMENT_VERSION,
    createdAt: timestamp(
      params.createdAt,
      'dvids_frame_ocr_human_review_created_at_invalid',
    ),
    binding: {
      corpusVersion: queue.binding.corpusVersion,
      snapshotId: queue.binding.snapshotId,
      frameOcrQueueSchemaVersion: queue.schemaVersion,
      frameOcrQueueDigest: queue.queueDigest,
      frameOcrReviewItemSetSha256: queue.reviewItemSetSha256,
      toolchainDigest: queue.toolchain.toolchainDigest,
    },
    protocol: {
      decisions: [...DVIDS_FRAME_OCR_REVIEW_DECISIONS],
      confidenceValues: ['low', 'medium', 'high'],
    },
    items,
    itemSetSha256,
    guarantees: {
      exactFrameOcrQueueBinding: true,
      exactRecoveredFrameBytesBound: true,
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

export const verifyDvidsFrameOcrReviewAssignment = (
  value: unknown,
): DvidsFrameOcrReviewAssignment => {
  if (!object(value)
    || value.recordType !== 'dvids_frame_ocr_human_review_assignment'
    || value.schemaVersion !== DVIDS_FRAME_OCR_REVIEW_ASSIGNMENT_VERSION
    || !SHA256.test(String(value.assignmentDigest))
    || !Array.isArray(value.items)) {
    fail('dvids_frame_ocr_human_review_assignment_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { assignmentDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== assignmentDigest) {
    fail('dvids_frame_ocr_human_review_assignment_digest_mismatch');
  }
  const assignment = value as unknown as DvidsFrameOcrReviewAssignment;
  if (assignment.items.length < 1
    || new Set(assignment.items.map(({ itemId }) => itemId)).size
      !== assignment.items.length
    || assignment.items.some((item) => {
      const { itemId, itemDigest, ...core } = item;
      return itemId !== `dvids-frame-ocr-review:${itemDigest}`
        || !FILE_NAME.test(item.frameFileName)
        || item.frameFileName !== `frame-${item.frameSha256}.png`
        || relationshipInputSha256(item.machineText)
          !== item.machineTextSha256
        || relationshipInputSha256(core) !== itemDigest;
    })
    || relationshipInputSha256(assignment.items.map(
      ({ itemId, itemDigest }) => `${itemId}:${itemDigest}`,
    )) !== assignment.itemSetSha256) {
    fail('dvids_frame_ocr_human_review_assignment_item_invalid');
  }
  return assignment;
};

export const buildDvidsFrameOcrReviewDraft = (
  assignmentValue: unknown,
): DvidsFrameOcrReviewDraft => {
  const assignment = verifyDvidsFrameOcrReviewAssignment(assignmentValue);
  return {
    recordType: 'dvids_frame_ocr_human_review_draft',
    schemaVersion: DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    reviewerId: null,
    reviewedAt: null,
    attestation: {
      humanPerformed: null,
      viewedExactRecoveredFrames: null,
      preservedMachineOcrOrigin: null,
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

export const sealDvidsFrameOcrAdjudication = (params: {
  assignment: unknown;
  draft: unknown;
  sealedAt: string;
}): DvidsFrameOcrAdjudication => {
  const assignment = verifyDvidsFrameOcrReviewAssignment(params.assignment);
  if (!object(params.draft)
    || !exactKeys(params.draft, [
      'recordType', 'schemaVersion', 'assignmentDigest', 'reviewerId',
      'reviewedAt', 'attestation', 'reviews',
    ])
    || params.draft.recordType !== 'dvids_frame_ocr_human_review_draft'
    || params.draft.schemaVersion !== DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION
    || params.draft.assignmentDigest !== assignment.assignmentDigest
    || !object(params.draft.attestation)
    || !Array.isArray(params.draft.reviews)) {
    fail('dvids_frame_ocr_human_review_draft_invalid');
  }
  const draft = params.draft as Record<string, unknown>;
  const attestation = draft.attestation as Record<string, unknown>;
  const reviewerId = String(draft.reviewerId || '').trim().toLowerCase();
  if (!REVIEWER_ID.test(reviewerId)) {
    fail('dvids_frame_ocr_human_review_reviewer_invalid');
  }
  const reviewedAt = timestamp(
    draft.reviewedAt,
    'dvids_frame_ocr_human_review_reviewed_at_invalid',
  );
  const sealedAt = timestamp(
    params.sealedAt,
    'dvids_frame_ocr_human_review_sealed_at_invalid',
  );
  if (Date.parse(reviewedAt) < Date.parse(assignment.createdAt)
    || Date.parse(sealedAt) < Date.parse(reviewedAt)) {
    fail('dvids_frame_ocr_human_review_timestamp_order_invalid');
  }
  if (!exactKeys(attestation, [
    'humanPerformed', 'viewedExactRecoveredFrames',
    'preservedMachineOcrOrigin', 'noEventClaimOrIdentityImplied',
  ]) || Object.values(attestation).some((entry) => entry !== true)) {
    fail('dvids_frame_ocr_human_review_attestation_invalid');
  }
  const itemById = new Map(assignment.items.map((item) => [item.itemId, item]));
  const reviews = (draft.reviews as unknown[]).map((raw) => {
    if (!object(raw)
      || !exactKeys(raw, [
        'itemId', 'decision', 'correctedText', 'confidence', 'rationale',
      ])
      || typeof raw.itemId !== 'string'
      || !DVIDS_FRAME_OCR_REVIEW_DECISIONS.includes(raw.decision as Decision)
      || !['low', 'medium', 'high'].includes(String(raw.confidence))) {
      fail('dvids_frame_ocr_human_review_response_invalid');
    }
    const response = raw as Record<string, unknown> & { itemId: string };
    const item = itemById.get(response.itemId)
      || fail('dvids_frame_ocr_human_review_response_invalid');
    const decision = response.decision as Decision;
    const correctedText = decision === 'ocr_corrected'
      ? boundedText(
        response.correctedText,
        1,
        100_000,
        'dvids_frame_ocr_human_review_corrected_text_invalid',
      )
      : null;
    if ((decision !== 'ocr_corrected' && response.correctedText !== null)
      || (decision === 'ocr_corrected'
        && correctedText === item.machineText)) {
      fail('dvids_frame_ocr_human_review_corrected_text_invalid');
    }
    const reviewedFrameText = decision === 'ocr_rejected'
      ? null
      : decision === 'ocr_exact' ? item.machineText : correctedText;
    const core = {
      itemId: response.itemId,
      decision,
      correctedText,
      correctedTextSha256: correctedText === null
        ? null
        : relationshipInputSha256(correctedText),
      reviewedFrameText,
      reviewedFrameTextSha256: reviewedFrameText === null
        ? null
        : relationshipInputSha256(reviewedFrameText),
      confidence: response.confidence as Confidence,
      rationale: boundedText(
        response.rationale,
        12,
        2_000,
        'dvids_frame_ocr_human_review_rationale_invalid',
      ),
      evidenceSemantics:
        'human_reviewed_frame_text_not_event_claim' as const,
    };
    return { ...core, reviewDigest: relationshipInputSha256(core) };
  }).sort((left, right) => lexical(left.itemId, right.itemId));
  const expectedIds = [...itemById.keys()].sort(lexical);
  if (reviews.length !== expectedIds.length
    || reviews.some(({ itemId }, index) => itemId !== expectedIds[index])) {
    fail('dvids_frame_ocr_human_review_response_set_mismatch');
  }
  const reviewSetSha256 = relationshipInputSha256(reviews.map(
    ({ itemId, reviewDigest }) => `${itemId}:${reviewDigest}`,
  ));
  const body: Omit<DvidsFrameOcrAdjudication, 'adjudicationDigest'> = {
    recordType: 'dvids_frame_ocr_human_adjudication',
    schemaVersion: DVIDS_FRAME_OCR_ADJUDICATION_VERSION,
    assignmentDigest: assignment.assignmentDigest,
    itemSetSha256: assignment.itemSetSha256,
    reviewerId,
    reviewedAt,
    sealedAt,
    attestation: {
      humanPerformed: true,
      viewedExactRecoveredFrames: true,
      preservedMachineOcrOrigin: true,
      noEventClaimOrIdentityImplied: true,
    },
    reviews,
    summary: {
      reviewedItemCount: reviews.length,
      exactOcrCount: reviews.filter(({ decision }) => decision === 'ocr_exact')
        .length,
      correctedOcrCount: reviews.filter(
        ({ decision }) => decision === 'ocr_corrected',
      ).length,
      rejectedOcrCount: reviews.filter(
        ({ decision }) => decision === 'ocr_rejected',
      ).length,
      retainedFrameTextCount: reviews.filter(
        ({ reviewedFrameText }) => reviewedFrameText !== null,
      ).length,
    },
    reviewSetSha256,
    guarantees: {
      completeExactItemSet: true,
      exactRecoveredFrameViewed: true,
      machineOriginPreserved: true,
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

export const verifyDvidsFrameOcrAdjudication = (params: {
  assignment: unknown;
  adjudication: unknown;
}) => {
  if (!object(params.adjudication)
    || params.adjudication.recordType
      !== 'dvids_frame_ocr_human_adjudication'
    || params.adjudication.schemaVersion
      !== DVIDS_FRAME_OCR_ADJUDICATION_VERSION) {
    fail('dvids_frame_ocr_human_adjudication_invalid');
  }
  const value = params.adjudication as unknown as DvidsFrameOcrAdjudication;
  const draft: DvidsFrameOcrReviewDraft = {
    recordType: 'dvids_frame_ocr_human_review_draft',
    schemaVersion: DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION,
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
  const rebuilt = sealDvidsFrameOcrAdjudication({
    assignment: params.assignment,
    draft,
    sealedAt: value.sealedAt,
  });
  if (relationshipInputSha256(rebuilt) !== relationshipInputSha256(value)) {
    fail('dvids_frame_ocr_human_adjudication_integrity_failed');
  }
  return value;
};
