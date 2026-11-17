import { createHash } from 'node:crypto';

import {
  buildClaimExtractionSourceSegmentFromResearchContent,
  buildConservativeSourceReliabilityAssessment,
  type ClaimExtractionSourceSegment,
} from './claimEvidenceExtraction';
import {
  archiveClaimExtractionReviewQueueItem,
  type ClaimExtractionReviewArchivePointer,
} from './claimEvidenceExtractionArchive';
import {
  deferClaimExtractionBatchForReview,
  runClaimExtractionCandidates,
  type ClaimExtractionProposer,
} from './claimEvidenceExtractionRunner';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import type { SourceReliabilityAssessment } from './claimEvidenceGraph';
import type { ClaimEvidencePublicationBinding } from './claimEvidenceGraph';
import type {
  CaseGraphResearchContentEntry,
  CaseGraphResearchPublicationBinding,
} from './researchToolContract';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';

export const CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_VERSION = 'case-graph-claim-evidence-full-corpus-backfill-v1' as const;
export const CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY = Object.freeze({
  maximumEntriesPerPage: 256,
  defaultEntriesPerPage: 128,
  maximumPages: 10_000_000,
  completionMeaning: 'candidate_extraction_complete_review_and_publication_not_complete',
  modelCandidatesEnterPublishedGraph: false,
} as const);

export type ClaimEvidenceBackfillSourceMetadata = {
  sourceId: string;
  sourceLabel: string;
  lineageId: string;
};

export type ClaimEvidenceBackfillContentPage = {
  entries: CaseGraphResearchContentEntry[];
  nextCursor: string | null;
  totalEntryCount: number;
  indexManifestDigest: string;
};

export type ClaimEvidenceBackfillContentSource = {
  readPage: (params: {
    publication: CaseGraphResearchPublicationBinding;
    cursor: string | null;
    limit: number;
    signal?: AbortSignal;
  }) => Promise<ClaimEvidenceBackfillContentPage>;
};

export type ClaimEvidenceBackfillQueueSummary = {
  extractionBatchDigest: string;
  candidateRunReceiptDigest: string;
  deferralReceiptDigest: string;
  pointerDigest: string;
  pointerObjectKey: string;
  pointerObjectSha256: string;
  segmentCount: number;
  proposalCount: number;
  sourceReliabilityCandidateCount: number;
};

export type ClaimEvidenceFullCorpusBackfillReceipt = {
  recordType: 'case_graph_claim_evidence_full_corpus_backfill_receipt';
  schemaVersion: typeof CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  indexManifestDigest: string;
  sourceEntryCount: number;
  processedEntryCount: number;
  pageCount: number;
  queueItemCount: number;
  proposalCount: number;
  deferredProposalCount: number;
  sourceReliabilityCandidateCount: number;
  publishedClaimCount: 0;
  status: 'review_required';
  queueSetSha256: string;
  queueItems: ClaimEvidenceBackfillQueueSummary[];
  policy: typeof CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY;
  receiptDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const digest = (value: unknown) => relationshipInputSha256(value);
const bytes = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const bytesDigest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const safeCount = (value: unknown, code: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code);
  return Number(value);
};

const requireDigest = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(code);
  return value as string;
};

const requireCursor = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.length || value.length > 4_096) fail('claim_backfill_cursor_invalid');
  return value as string;
};

const claimBindingFor = (
  publication: CaseGraphResearchPublicationBinding,
): ClaimEvidencePublicationBinding => ({
  publicationId: publication.publicationId,
  corpusVersion: publication.corpusVersion,
  manifestSha256: publication.manifestSha256,
  snapshotId: publication.snapshotId,
  graphArtifactSetSha256: publication.graphArtifactSetSha256,
});

const reliabilityCandidatesFor = (segments: ClaimExtractionSourceSegment[]): SourceReliabilityAssessment[] => {
  const byId = new Map<string, SourceReliabilityAssessment>();
  for (const segment of segments) {
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    const existing = byId.get(assessment.assessmentId);
    if (existing && existing.assessmentDigest !== assessment.assessmentDigest) {
      fail('claim_backfill_source_reliability_conflict');
    }
    byId.set(assessment.assessmentId, assessment);
  }
  return [...byId.values()].sort((left, right) => left.assessmentId < right.assessmentId ? -1 : 1);
};

const persistCompletion = async (params: {
  receipt: ClaimEvidenceFullCorpusBackfillReceipt;
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}) => {
  const objectKey = [
    'case-vortex/corpora', params.receipt.publication.corpusVersion,
    'claim-extraction-review/v1/publications', params.receipt.publication.publicationId,
    params.receipt.publication.manifestSha256, '_candidate-backfill-complete.json',
  ].join('/');
  const body = bytes(params.receipt);
  const objectSha256 = bytesDigest(body);
  await params.archive.putIfAbsent({ key: objectKey, body, contentType: 'application/json', signal: params.signal });
  const observed = await params.archive.readObject(objectKey, { maxBytes: body.byteLength, signal: params.signal });
  if (!observed || observed.byteLength !== body.byteLength || bytesDigest(observed) !== objectSha256) {
    fail('claim_backfill_completion_read_after_write_mismatch');
  }
  return { objectKey, objectSha256 };
};

export const runClaimEvidenceFullCorpusCandidateBackfill = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  contentSource: ClaimEvidenceBackfillContentSource;
  resolveSourceMetadata: (entry: CaseGraphResearchContentEntry) => ClaimEvidenceBackfillSourceMetadata;
  proposer: ClaimExtractionProposer;
  archive: CaseGraphContentImmutableArchive;
  queuedAt: string;
  pageSize?: number;
  modelConcurrency?: number;
  signal?: AbortSignal;
}): Promise<{
  receipt: ClaimEvidenceFullCorpusBackfillReceipt;
  completionObjectKey: string;
  completionObjectSha256: string;
}> => {
  const pageSize = params.pageSize ?? CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY.defaultEntriesPerPage;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1
    || pageSize > CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY.maximumEntriesPerPage) {
    fail('claim_backfill_page_size_invalid');
  }
  const seenChunkIds = new Set<string>();
  const seenCursors = new Set<string>();
  const reliabilityIds = new Set<string>();
  const queueItems: ClaimEvidenceBackfillQueueSummary[] = [];
  let cursor: string | null = null;
  let expectedEntryCount: number | null = null;
  let indexManifestDigest: string | null = null;
  let pageCount = 0;
  let processedEntryCount = 0;
  let proposalCount = 0;
  const claimBinding = claimBindingFor(params.publication);

  while (true) {
    if (params.signal?.aborted) fail('claim_backfill_aborted');
    if (pageCount >= CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY.maximumPages) fail('claim_backfill_page_limit_exceeded');
    const page = await params.contentSource.readPage({
      publication: params.publication,
      cursor,
      limit: pageSize,
      signal: params.signal,
    });
    pageCount += 1;
    if (!page || !Array.isArray(page.entries) || page.entries.length > pageSize) fail('claim_backfill_page_invalid');
    const pageExpected = safeCount(page.totalEntryCount, 'claim_backfill_accounting_invalid');
    const pageManifest = requireDigest(page.indexManifestDigest, 'claim_backfill_manifest_invalid');
    if (expectedEntryCount === null) expectedEntryCount = pageExpected;
    if (indexManifestDigest === null) indexManifestDigest = pageManifest;
    if (expectedEntryCount !== pageExpected || indexManifestDigest !== pageManifest) fail('claim_backfill_source_changed');
    if (!page.entries.length && page.nextCursor !== null) fail('claim_backfill_empty_page_with_cursor');
    const segments = page.entries.map((entry) => {
      if (seenChunkIds.has(entry.chunkId)) fail('claim_backfill_duplicate_chunk');
      seenChunkIds.add(entry.chunkId);
      const metadata = params.resolveSourceMetadata(entry);
      return buildClaimExtractionSourceSegmentFromResearchContent({
        binding: claimBinding,
        entry,
        ...metadata,
      });
    });
    if (segments.length) {
      const candidateRun = await runClaimExtractionCandidates({
        binding: claimBinding,
        segments,
        proposer: params.proposer,
        maximumConcurrency: params.modelConcurrency,
        signal: params.signal,
      });
      const deferralReceipt = deferClaimExtractionBatchForReview({
        batch: candidateRun.batch,
        queuedAt: params.queuedAt,
        queuePolicyVersion: 'claim_review_queue_v1',
      });
      const sourceReliabilityCandidates = reliabilityCandidatesFor(segments);
      sourceReliabilityCandidates.forEach(({ assessmentId }) => reliabilityIds.add(assessmentId));
      const archived = await archiveClaimExtractionReviewQueueItem({
        batch: candidateRun.batch,
        candidateRunReceipt: candidateRun.receipt,
        deferralReceipt,
        sourceReliabilityCandidates,
        archive: params.archive,
        signal: params.signal,
      });
      proposalCount += candidateRun.batch.proposals.length;
      queueItems.push({
        extractionBatchDigest: candidateRun.batch.batchDigest,
        candidateRunReceiptDigest: candidateRun.receipt.receiptDigest,
        deferralReceiptDigest: deferralReceipt.receiptDigest,
        pointerDigest: archived.pointer.pointerDigest,
        pointerObjectKey: archived.pointer.pointerObjectKey,
        pointerObjectSha256: archived.pointerObjectSha256,
        segmentCount: segments.length,
        proposalCount: candidateRun.batch.proposals.length,
        sourceReliabilityCandidateCount: sourceReliabilityCandidates.length,
      });
    }
    processedEntryCount += page.entries.length;
    const nextCursor = requireCursor(page.nextCursor);
    if (nextCursor === null) break;
    if (seenCursors.has(nextCursor) || nextCursor === cursor) fail('claim_backfill_cursor_cycle');
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (expectedEntryCount === null || indexManifestDigest === null
    || processedEntryCount !== expectedEntryCount || seenChunkIds.size !== expectedEntryCount) {
    fail('claim_backfill_incomplete_corpus');
  }
  const receiptCore = {
    recordType: 'case_graph_claim_evidence_full_corpus_backfill_receipt' as const,
    schemaVersion: CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_VERSION,
    publication: params.publication,
    indexManifestDigest,
    sourceEntryCount: expectedEntryCount,
    processedEntryCount,
    pageCount,
    queueItemCount: queueItems.length,
    proposalCount,
    deferredProposalCount: proposalCount,
    sourceReliabilityCandidateCount: reliabilityIds.size,
    publishedClaimCount: 0 as const,
    status: 'review_required' as const,
    queueSetSha256: digest(queueItems.map(({ pointerDigest }) => pointerDigest)),
    queueItems,
    policy: CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY,
  };
  const receipt = { ...receiptCore, receiptDigest: digest(receiptCore) };
  const completion = await persistCompletion({ receipt, archive: params.archive, signal: params.signal });
  return { receipt, completionObjectKey: completion.objectKey, completionObjectSha256: completion.objectSha256 };
};

export const verifyClaimEvidenceFullCorpusBackfillReceipt = (
  value: ClaimEvidenceFullCorpusBackfillReceipt,
): ClaimEvidenceFullCorpusBackfillReceipt => {
  const queueItems = value.queueItems.map((item) => ({
    extractionBatchDigest: requireDigest(item.extractionBatchDigest, 'claim_backfill_receipt_invalid'),
    candidateRunReceiptDigest: requireDigest(item.candidateRunReceiptDigest, 'claim_backfill_receipt_invalid'),
    deferralReceiptDigest: requireDigest(item.deferralReceiptDigest, 'claim_backfill_receipt_invalid'),
    pointerDigest: requireDigest(item.pointerDigest, 'claim_backfill_receipt_invalid'),
    pointerObjectKey: typeof item.pointerObjectKey === 'string' && item.pointerObjectKey.length
      ? item.pointerObjectKey : fail('claim_backfill_receipt_invalid'),
    pointerObjectSha256: requireDigest(item.pointerObjectSha256, 'claim_backfill_receipt_invalid'),
    segmentCount: safeCount(item.segmentCount, 'claim_backfill_receipt_invalid'),
    proposalCount: safeCount(item.proposalCount, 'claim_backfill_receipt_invalid'),
    sourceReliabilityCandidateCount: safeCount(item.sourceReliabilityCandidateCount, 'claim_backfill_receipt_invalid'),
  }));
  const core = {
    recordType: 'case_graph_claim_evidence_full_corpus_backfill_receipt' as const,
    schemaVersion: CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_VERSION,
    publication: value.publication,
    indexManifestDigest: requireDigest(value.indexManifestDigest, 'claim_backfill_receipt_invalid'),
    sourceEntryCount: safeCount(value.sourceEntryCount, 'claim_backfill_receipt_invalid'),
    processedEntryCount: safeCount(value.processedEntryCount, 'claim_backfill_receipt_invalid'),
    pageCount: safeCount(value.pageCount, 'claim_backfill_receipt_invalid'),
    queueItemCount: safeCount(value.queueItemCount, 'claim_backfill_receipt_invalid'),
    proposalCount: safeCount(value.proposalCount, 'claim_backfill_receipt_invalid'),
    deferredProposalCount: safeCount(value.deferredProposalCount, 'claim_backfill_receipt_invalid'),
    sourceReliabilityCandidateCount: safeCount(value.sourceReliabilityCandidateCount, 'claim_backfill_receipt_invalid'),
    publishedClaimCount: value.publishedClaimCount,
    status: value.status,
    queueSetSha256: digest(queueItems.map(({ pointerDigest }) => pointerDigest)),
    queueItems,
    policy: CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY,
  };
  const expected = { ...core, receiptDigest: digest(core) };
  if (value.recordType !== expected.recordType || value.schemaVersion !== expected.schemaVersion
    || value.status !== 'review_required' || value.publishedClaimCount !== 0
    || value.sourceEntryCount !== value.processedEntryCount
    || value.queueItemCount !== queueItems.length
    || value.proposalCount !== queueItems.reduce((sum, item) => sum + item.proposalCount, 0)
    || value.deferredProposalCount !== value.proposalCount
    || canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    fail('claim_backfill_receipt_integrity_failed');
  }
  return expected;
};
