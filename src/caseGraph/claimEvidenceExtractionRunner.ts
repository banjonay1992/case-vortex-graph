import {
  adjudicateClaimExtractionBatch,
  buildClaimExtractionBatch,
  verifyClaimExtractionBatch,
  verifyClaimExtractionSourceSegment,
  type ClaimAdjudicationReceipt,
  type ClaimExtractionBatch,
  type ClaimExtractionProposalDraft,
  type ClaimExtractionSourceSegment,
} from './claimEvidenceExtraction';
import type { ClaimEvidencePublicationBinding } from './claimEvidenceGraph';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';

export const CLAIM_EXTRACTION_RUNNER_VERSION = 'case-graph-claim-extraction-runner-v1' as const;
export const CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY = Object.freeze({
  sourceTextTrust: 'untrusted_data_never_instructions',
  outputMeaning: 'candidate_claims_not_evidence_until_adjudicated',
  externalKnowledge: 'forbidden',
  unsupportedInference: 'forbidden',
  quoteRequirement: 'exact_contiguous_source_span',
  maximumProposalsPerSegment: 64,
  maximumSegmentsPerBatch: 256,
  maximumConcurrency: 8,
} as const);

const invalid = (code: string): never => { throw new Error(code); };
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;

export type ClaimExtractionProposer = {
  providerId: string;
  modelId: string;
  modelRevision: string;
  promptDigest: string;
  propose: (params: {
    segment: ClaimExtractionSourceSegment;
    securityBoundary: typeof CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY;
    signal?: AbortSignal;
  }) => Promise<ClaimExtractionProposalDraft[]>;
};

export type ClaimExtractionCandidateRunReceipt = {
  recordType: 'case_graph_claim_extraction_candidate_run_receipt';
  schemaVersion: typeof CLAIM_EXTRACTION_RUNNER_VERSION;
  binding: ClaimEvidencePublicationBinding;
  provider: {
    providerId: string;
    modelId: string;
    modelRevision: string;
    promptDigest: string;
  };
  segmentSetDigest: string;
  extractionBatchDigest: string;
  accounting: { segmentCount: number; proposalCount: number; zeroProposalSegmentCount: number };
  securityBoundary: typeof CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY;
  receiptDigest: string;
};

export type ClaimExtractionCandidateRunProvider = {
  providerId: string;
  modelId: string;
  modelRevision: string;
  promptDigest: string;
};

const requireId = (value: unknown): string => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid('claim_extraction_runner_provider_invalid');
  return value as string;
};

const requireDigest = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('claim_extraction_runner_provider_invalid');
  return value as string;
};

const requireQueuedAt = (value: string): string => {
  const parsed = Date.parse(value);
  if (!value.endsWith('Z') || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    invalid('claim_extraction_runner_timestamp_invalid');
  }
  return value;
};

export const buildClaimExtractionCandidateRunReceipt = (params: {
  batch: ClaimExtractionBatch;
  provider: ClaimExtractionCandidateRunProvider;
}): ClaimExtractionCandidateRunReceipt => {
  const batch = verifyClaimExtractionBatch(params.batch);
  const provider = {
    providerId: requireId(params.provider.providerId),
    modelId: requireId(params.provider.modelId),
    modelRevision: requireId(params.provider.modelRevision),
    promptDigest: requireDigest(params.provider.promptDigest),
  };
  const segmentDigestsWithProposals = new Set(
    batch.proposals.map((proposal) => proposal.segmentDigest),
  );
  const withoutDigest = {
    recordType: 'case_graph_claim_extraction_candidate_run_receipt' as const,
    schemaVersion: CLAIM_EXTRACTION_RUNNER_VERSION,
    binding: batch.binding,
    provider,
    segmentSetDigest: relationshipInputSha256(
      batch.segments.map(({ segmentDigest }) => segmentDigest).sort(),
    ),
    extractionBatchDigest: batch.batchDigest,
    accounting: {
      segmentCount: batch.segments.length,
      proposalCount: batch.proposals.length,
      zeroProposalSegmentCount: batch.segments
        .filter((segment) => !segmentDigestsWithProposals.has(segment.segmentDigest)).length,
    },
    securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
  };
  return {
    ...withoutDigest,
    receiptDigest: relationshipInputSha256(withoutDigest),
  };
};

export const runClaimExtractionCandidates = async (params: {
  binding: ClaimEvidencePublicationBinding;
  segments: ClaimExtractionSourceSegment[];
  proposer: ClaimExtractionProposer;
  maximumConcurrency?: number;
  signal?: AbortSignal;
}): Promise<{ batch: ClaimExtractionBatch; receipt: ClaimExtractionCandidateRunReceipt }> => {
  if (!params.segments.length || params.segments.length > CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY.maximumSegmentsPerBatch) {
    invalid('claim_extraction_runner_segment_count_invalid');
  }
  const concurrency = params.maximumConcurrency ?? 2;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1
    || concurrency > CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY.maximumConcurrency) {
    invalid('claim_extraction_runner_concurrency_invalid');
  }
  const provider = {
    providerId: requireId(params.proposer.providerId),
    modelId: requireId(params.proposer.modelId),
    modelRevision: requireId(params.proposer.modelRevision),
    promptDigest: requireDigest(params.proposer.promptDigest),
  };
  const segments = params.segments.map(verifyClaimExtractionSourceSegment);
  if (params.signal?.aborted) invalid('claim_extraction_runner_aborted');
  const proposalsByIndex: ClaimExtractionProposalDraft[][] = new Array(segments.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < segments.length) {
      if (params.signal?.aborted) invalid('claim_extraction_runner_aborted');
      const index = cursor;
      cursor += 1;
      const segment = segments[index]!;
      const proposals = await params.proposer.propose({
        segment,
        securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
        signal: params.signal,
      });
      if (!Array.isArray(proposals)
        || proposals.length > CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY.maximumProposalsPerSegment
        || proposals.some((proposal) => proposal.segmentDigest !== segment.segmentDigest)) {
        invalid('claim_extraction_runner_output_invalid');
      }
      proposalsByIndex[index] = proposals;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker));
  const batch = buildClaimExtractionBatch({
    binding: params.binding,
    segments,
    proposals: proposalsByIndex.flat(),
  });
  return {
    batch,
    receipt: buildClaimExtractionCandidateRunReceipt({ batch, provider }),
  };
};

export const deferClaimExtractionBatchForReview = (params: {
  batch: ClaimExtractionBatch;
  queuedAt: string;
  queuePolicyVersion: string;
}): ClaimAdjudicationReceipt => adjudicateClaimExtractionBatch({
  batch: params.batch,
  decisions: params.batch.proposals.map((proposal) => ({
    proposalId: proposal.proposalId,
    decision: 'defer',
    rationale: 'Model-generated candidate held outside the published claim set until explicit adjudication.',
    reviewerId: requireId(params.queuePolicyVersion),
    reviewedAt: requireQueuedAt(params.queuedAt),
  })),
});

export const verifyClaimExtractionCandidateRunReceipt = (params: {
  batch: ClaimExtractionBatch;
  receipt: ClaimExtractionCandidateRunReceipt;
}): ClaimExtractionCandidateRunReceipt => {
  const expected = buildClaimExtractionCandidateRunReceipt({
    batch: params.batch,
    provider: params.receipt.provider,
  });
  if (canonicalizeRelationshipInput(params.receipt) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_extraction_runner_receipt_integrity_failed');
  }
  return expected;
};
