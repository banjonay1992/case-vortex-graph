import {
  verifyDvidsAsrHumanAdjudication,
  verifyDvidsAsrHumanReviewAssignment,
  type DvidsAsrHumanAdjudication,
  type DvidsAsrHumanReviewAssignment,
} from './dvidsAsrHumanReview';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const DVIDS_ASR_REVIEWED_TRANSCRIPT_INTEGRATION_VERSION =
  'case-vortex-dvids-asr-reviewed-transcript-integration-v1' as const;

export type DvidsAsrReviewedTranscriptIntegration = {
  recordType: 'dvids_asr_reviewed_transcript_integration';
  schemaVersion: typeof DVIDS_ASR_REVIEWED_TRANSCRIPT_INTEGRATION_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    asrQueueDigest: string;
    asrReviewItemSetSha256: string;
    toolchainDigest: string;
    assignmentDigest: string;
    assignmentItemSetSha256: string;
    adjudicationDigest: string;
    reviewSetSha256: string;
    reviewedTranscriptSetSha256: string;
  };
  reviewedTranscripts: DvidsAsrHumanAdjudication['reviewedTranscripts'];
  accounting: {
    assignedSegmentCount: number;
    reviewedSegmentCount: number;
    exactTranscriptCount: number;
    correctedTranscriptCount: number;
    rejectedTranscriptCount: number;
    retainedTranscriptCount: number;
    eventClaimCount: 0;
  };
  guarantees: {
    exactAsrAssignmentAndAdjudicationVerified: true;
    corpusAndSnapshotBound: true;
    timecodesAndMachineOriginPreserved: true;
    reviewedTranscriptsRemainNotEventClaims: true;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  integrationDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const timestamp = (value: string, code: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(code);
  }
  return value;
};

const verifyInputs = (params: {
  assignment: unknown;
  adjudication: unknown;
}) => {
  const assignment = verifyDvidsAsrHumanReviewAssignment(params.assignment);
  const adjudication = verifyDvidsAsrHumanAdjudication({
    assignment,
    adjudication: params.adjudication,
  });
  if (adjudication.assignmentDigest !== assignment.assignmentDigest
    || adjudication.itemSetSha256 !== assignment.itemSetSha256
    || adjudication.reviewedTranscripts.some((record) => (
      record.evidenceSemantics !== 'human_reviewed_asr_transcript_not_event_claim'
      || record.startMs < 0
      || record.endMs <= record.startMs
    ))) {
    fail('dvids_asr_reviewed_transcript_integration_binding_invalid');
  }
  return { assignment, adjudication };
};

export const buildDvidsAsrReviewedTranscriptIntegration = (params: {
  assignment: unknown;
  adjudication: unknown;
  builtAt: string;
}): DvidsAsrReviewedTranscriptIntegration => {
  const { assignment, adjudication } = verifyInputs(params);
  const body: Omit<DvidsAsrReviewedTranscriptIntegration, 'integrationDigest'> = {
    recordType: 'dvids_asr_reviewed_transcript_integration',
    schemaVersion: DVIDS_ASR_REVIEWED_TRANSCRIPT_INTEGRATION_VERSION,
    builtAt: timestamp(
      params.builtAt,
      'dvids_asr_reviewed_transcript_integration_built_at_invalid',
    ),
    binding: {
      corpusVersion: assignment.binding.corpusVersion,
      snapshotId: assignment.binding.snapshotId,
      asrQueueDigest: assignment.binding.asrQueueDigest,
      asrReviewItemSetSha256: assignment.binding.asrReviewItemSetSha256,
      toolchainDigest: assignment.binding.toolchainDigest,
      assignmentDigest: assignment.assignmentDigest,
      assignmentItemSetSha256: assignment.itemSetSha256,
      adjudicationDigest: adjudication.adjudicationDigest,
      reviewSetSha256: adjudication.reviewSetSha256,
      reviewedTranscriptSetSha256: adjudication.reviewedTranscriptSetSha256,
    },
    reviewedTranscripts: adjudication.reviewedTranscripts,
    accounting: {
      assignedSegmentCount: assignment.items.length,
      reviewedSegmentCount: adjudication.summary.reviewedItemCount,
      exactTranscriptCount: adjudication.summary.exactTranscriptCount,
      correctedTranscriptCount: adjudication.summary.correctedTranscriptCount,
      rejectedTranscriptCount: adjudication.summary.rejectedTranscriptCount,
      retainedTranscriptCount: adjudication.summary.retainedTranscriptCount,
      eventClaimCount: 0,
    },
    guarantees: {
      exactAsrAssignmentAndAdjudicationVerified: true,
      corpusAndSnapshotBound: true,
      timecodesAndMachineOriginPreserved: true,
      reviewedTranscriptsRemainNotEventClaims: true,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, integrationDigest: relationshipInputSha256(body) };
};

export const verifyDvidsAsrReviewedTranscriptIntegration = (params: {
  value: unknown;
  assignment: unknown;
  adjudication: unknown;
}) => {
  const value = params.value as DvidsAsrReviewedTranscriptIntegration;
  const rebuilt = buildDvidsAsrReviewedTranscriptIntegration({
    assignment: params.assignment,
    adjudication: params.adjudication,
    builtAt: value?.builtAt,
  });
  if (canonicalizeRelationshipInput(value)
    !== canonicalizeRelationshipInput(rebuilt)) {
    fail('dvids_asr_reviewed_transcript_integration_integrity_failed');
  }
  return rebuilt;
};
