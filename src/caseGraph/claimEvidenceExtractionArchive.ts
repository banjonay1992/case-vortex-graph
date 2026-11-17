import { createHash } from 'node:crypto';

import {
  verifyClaimAdjudicationReceipt,
  verifyClaimExtractionBatch,
  type ClaimAdjudicationReceipt,
  type ClaimExtractionBatch,
} from './claimEvidenceExtraction';
import {
  verifyClaimExtractionCandidateRunReceipt,
  type ClaimExtractionCandidateRunReceipt,
} from './claimEvidenceExtractionRunner';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  verifySourceReliabilityAssessment,
  type SourceReliabilityAssessment,
} from './claimEvidenceGraph';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';

export const CLAIM_EXTRACTION_REVIEW_ARCHIVE_VERSION = 'case-graph-claim-extraction-review-archive-v1' as const;

export type ClaimExtractionReviewArchivePointer = {
  recordType: 'case_graph_claim_extraction_review_archive_pointer';
  schemaVersion: typeof CLAIM_EXTRACTION_REVIEW_ARCHIVE_VERSION;
  publication: ClaimExtractionBatch['binding'];
  extractionBatchDigest: string;
  candidateRunReceiptDigest: string;
  deferralReceiptDigest: string;
  sourceReliabilityCandidateCount: number;
  sourceReliabilityCandidateSetSha256: string;
  batchObjectKey: string;
  batchObjectSha256: string;
  candidateRunObjectKey: string;
  candidateRunObjectSha256: string;
  deferralObjectKey: string;
  deferralObjectSha256: string;
  sourceReliabilityObjectKey: string;
  sourceReliabilityObjectSha256: string;
  pointerObjectKey: string;
  pointerDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const body = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const validateReliabilityCandidates = (
  batch: ClaimExtractionBatch,
  values: SourceReliabilityAssessment[],
) => {
  const candidates = values
    .map(verifySourceReliabilityAssessment)
    .sort((left, right) => left.assessmentId < right.assessmentId ? -1 : left.assessmentId > right.assessmentId ? 1 : 0);
  if (new Set(candidates.map(({ assessmentId }) => assessmentId)).size !== candidates.length
    || candidates.some((assessment) => assessment.assessedBy.reviewStatus !== 'unreviewed'
      || canonicalizeRelationshipInput(assessment.binding) !== canonicalizeRelationshipInput(batch.binding))) {
    fail('claim_extraction_review_archive_reliability_invalid');
  }
  return candidates;
};

const persist = async (params: {
  archive: CaseGraphContentImmutableArchive;
  key: string;
  value: unknown;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) fail('claim_extraction_review_archive_aborted');
  const bytes = body(params.value);
  const expectedSha256 = sha256(bytes);
  await params.archive.putIfAbsent({
    key: params.key,
    body: bytes,
    contentType: 'application/json',
    signal: params.signal,
  });
  const observed = await params.archive.readObject(params.key, {
    maxBytes: bytes.byteLength,
    signal: params.signal,
  });
  if (!observed || observed.byteLength !== bytes.byteLength || sha256(observed) !== expectedSha256) {
    fail('claim_extraction_review_archive_read_after_write_mismatch');
  }
  return expectedSha256;
};

const pointerFor = (params: {
  batch: ClaimExtractionBatch;
  candidateRunReceipt: ClaimExtractionCandidateRunReceipt;
  deferralReceipt: ClaimAdjudicationReceipt;
  sourceReliabilityCandidates: SourceReliabilityAssessment[];
  prefix: string;
  batchObjectSha256: string;
  candidateRunObjectSha256: string;
  deferralObjectSha256: string;
  sourceReliabilityObjectSha256: string;
}): ClaimExtractionReviewArchivePointer => {
  const withoutDigest = {
    recordType: 'case_graph_claim_extraction_review_archive_pointer' as const,
    schemaVersion: CLAIM_EXTRACTION_REVIEW_ARCHIVE_VERSION,
    publication: params.batch.binding,
    extractionBatchDigest: params.batch.batchDigest,
    candidateRunReceiptDigest: params.candidateRunReceipt.receiptDigest,
    deferralReceiptDigest: params.deferralReceipt.receiptDigest,
    sourceReliabilityCandidateCount: params.sourceReliabilityCandidates.length,
    sourceReliabilityCandidateSetSha256: relationshipInputSha256(
      params.sourceReliabilityCandidates.map(({ assessmentDigest }) => assessmentDigest),
    ),
    batchObjectKey: `${params.prefix}/extraction-batch.json`,
    batchObjectSha256: params.batchObjectSha256,
    candidateRunObjectKey: `${params.prefix}/candidate-run-receipt.json`,
    candidateRunObjectSha256: params.candidateRunObjectSha256,
    deferralObjectKey: `${params.prefix}/deferral-receipt.json`,
    deferralObjectSha256: params.deferralObjectSha256,
    sourceReliabilityObjectKey: `${params.prefix}/source-reliability-candidates.json`,
    sourceReliabilityObjectSha256: params.sourceReliabilityObjectSha256,
    pointerObjectKey: `${params.prefix}/review-queue-pointer.json`,
  };
  return { ...withoutDigest, pointerDigest: relationshipInputSha256(withoutDigest) };
};

export const archiveClaimExtractionReviewQueueItem = async (params: {
  batch: ClaimExtractionBatch;
  candidateRunReceipt: ClaimExtractionCandidateRunReceipt;
  deferralReceipt: ClaimAdjudicationReceipt;
  sourceReliabilityCandidates: SourceReliabilityAssessment[];
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<{ pointer: ClaimExtractionReviewArchivePointer; pointerObjectSha256: string }> => {
  const batch = verifyClaimExtractionBatch(params.batch);
  const candidateRunReceipt = verifyClaimExtractionCandidateRunReceipt({
    batch,
    receipt: params.candidateRunReceipt,
  });
  const deferralReceipt = verifyClaimAdjudicationReceipt({ batch, receipt: params.deferralReceipt });
  const sourceReliabilityCandidates = validateReliabilityCandidates(batch, params.sourceReliabilityCandidates);
  if (deferralReceipt.accounting.deferred !== batch.proposals.length
    || deferralReceipt.accounting.accepted !== 0
    || deferralReceipt.accounting.rejected !== 0
    || deferralReceipt.accounting.disputed !== 0) {
    fail('claim_extraction_review_archive_not_fully_deferred');
  }
  const prefix = [
    'case-vortex/corpora',
    batch.binding.corpusVersion,
    'claim-extraction-review/v1/publications',
    batch.binding.publicationId,
    batch.binding.manifestSha256,
    batch.batchDigest,
  ].join('/');
  const batchObjectSha256 = await persist({
    archive: params.archive,
    key: `${prefix}/extraction-batch.json`,
    value: batch,
    signal: params.signal,
  });
  const candidateRunObjectSha256 = await persist({
    archive: params.archive,
    key: `${prefix}/candidate-run-receipt.json`,
    value: candidateRunReceipt,
    signal: params.signal,
  });
  const deferralObjectSha256 = await persist({
    archive: params.archive,
    key: `${prefix}/deferral-receipt.json`,
    value: deferralReceipt,
    signal: params.signal,
  });
  const sourceReliabilityObjectSha256 = await persist({
    archive: params.archive,
    key: `${prefix}/source-reliability-candidates.json`,
    value: sourceReliabilityCandidates,
    signal: params.signal,
  });
  const pointer = pointerFor({
    batch,
    candidateRunReceipt,
    deferralReceipt,
    sourceReliabilityCandidates,
    prefix,
    batchObjectSha256,
    candidateRunObjectSha256,
    deferralObjectSha256,
    sourceReliabilityObjectSha256,
  });
  const pointerObjectSha256 = await persist({
    archive: params.archive,
    key: pointer.pointerObjectKey,
    value: pointer,
    signal: params.signal,
  });
  return { pointer, pointerObjectSha256 };
};

export const verifyClaimExtractionReviewArchivePointer = (params: {
  batch: ClaimExtractionBatch;
  candidateRunReceipt: ClaimExtractionCandidateRunReceipt;
  deferralReceipt: ClaimAdjudicationReceipt;
  sourceReliabilityCandidates: SourceReliabilityAssessment[];
  pointer: ClaimExtractionReviewArchivePointer;
}): ClaimExtractionReviewArchivePointer => {
  const batch = verifyClaimExtractionBatch(params.batch);
  const candidateRunReceipt = verifyClaimExtractionCandidateRunReceipt({ batch, receipt: params.candidateRunReceipt });
  const deferralReceipt = verifyClaimAdjudicationReceipt({ batch, receipt: params.deferralReceipt });
  const sourceReliabilityCandidates = validateReliabilityCandidates(batch, params.sourceReliabilityCandidates);
  const prefix = [
    'case-vortex/corpora', batch.binding.corpusVersion, 'claim-extraction-review/v1/publications',
    batch.binding.publicationId, batch.binding.manifestSha256, batch.batchDigest,
  ].join('/');
  const digestValues = [
    params.pointer.batchObjectSha256,
    params.pointer.candidateRunObjectSha256,
    params.pointer.deferralObjectSha256,
    params.pointer.sourceReliabilityObjectSha256,
  ];
  if (digestValues.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    fail('claim_extraction_review_archive_pointer_invalid');
  }
  const expected = pointerFor({
    batch,
    candidateRunReceipt,
    deferralReceipt,
    sourceReliabilityCandidates,
    prefix,
    batchObjectSha256: params.pointer.batchObjectSha256,
    candidateRunObjectSha256: params.pointer.candidateRunObjectSha256,
    deferralObjectSha256: params.pointer.deferralObjectSha256,
    sourceReliabilityObjectSha256: params.pointer.sourceReliabilityObjectSha256,
  });
  if (canonicalizeRelationshipInput(params.pointer) !== canonicalizeRelationshipInput(expected)) {
    fail('claim_extraction_review_archive_pointer_integrity_failed');
  }
  return expected;
};
