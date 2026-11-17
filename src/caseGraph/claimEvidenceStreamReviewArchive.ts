import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import {
  buildClaimExtractionBatch,
  buildConservativeSourceReliabilityAssessment,
  verifyClaimExtractionBatch,
  verifyClaimExtractionSourceSegment,
  type ClaimAdjudicationReceipt,
  type ClaimExtractionBatch,
  type ClaimExtractionProposalDraft,
  type ClaimExtractionSourceSegment,
} from './claimEvidenceExtraction';
import {
  archiveClaimExtractionReviewQueueItem,
  verifyClaimExtractionReviewArchivePointer,
  type ClaimExtractionReviewArchivePointer,
} from './claimEvidenceExtractionArchive';
import {
  buildClaimExtractionCandidateRunReceipt,
  deferClaimExtractionBatchForReview,
  verifyClaimExtractionCandidateRunReceipt,
  type ClaimExtractionCandidateRunReceipt,
} from './claimEvidenceExtractionRunner';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  verifyOpenAiClaimExtractionBatchManifest,
  type OpenAiClaimExtractionBatchManifest,
} from './openAiClaimExtractionBatch';
import {
  verifyOpenAiClaimExtractionStreamImportReceipt,
  type OpenAiClaimExtractionStreamImportReceipt,
} from './openAiClaimExtractionBatchStream';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  verifySourceReliabilityAssessment,
  type SourceReliabilityAssessment,
} from './claimEvidenceGraph';

export const CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_VERSION =
  'case-graph-claim-evidence-stream-review-archive-v1' as const;
export const CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY = Object.freeze({
  maximumInputLineBytes: 512 * 1024,
  maximumSegmentsPerChunk: 32,
  maximumChunkInputBytes: 8 * 1024 * 1024,
  assessorVersion: 'source-ledger-bootstrap-v2',
  queuePolicyVersion: 'claim_review_queue_v1',
  completionMeaning: 'immutable_local_review_queue_not_adjudicated_or_published',
} as const);

export type ClaimEvidenceStreamReviewArchiveChunk = {
  ordinal: number;
  segmentCount: number;
  proposalCount: number;
  zeroProposalSegmentCount: number;
  extractionBatchDigest: string;
  candidateRunReceiptDigest: string;
  deferralReceiptDigest: string;
  pointerObjectKey: string;
  pointerObjectSha256: string;
  pointerDigest: string;
};

export type ClaimEvidenceStreamReviewArchiveReceipt = {
  recordType: 'case_graph_claim_evidence_stream_review_archive_receipt';
  schemaVersion: typeof CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_VERSION;
  binding: ClaimExtractionBatch['binding'];
  batchManifestSha256: string;
  importReceiptSha256: string;
  inputSegmentSetSha256: string;
  providerOutputSha256: string;
  candidateOutputSha256: string;
  queuedAt: string;
  segmentCount: number;
  proposalCount: number;
  zeroProposalSegmentCount: number;
  chunkCount: number;
  pointerSetSha256: string;
  chunks: ClaimEvidenceStreamReviewArchiveChunk[];
  policy: typeof CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY;
  sideEffects: {
    networkRequests: 0;
    databaseReads: 0;
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    providerSubmissions: 0;
    publications: 0;
    deployments: 0;
  };
  receiptDigest: string;
};

type CandidateRow = {
  segmentDigest: string;
  proposals: ClaimExtractionProposalDraft[];
};

const SHA256 = /^[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new Error(code); };
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const sha256File = async (path: string) => {
  const before = await stat(path);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).byteLength;
  }
  const after = await stat(path);
  if (before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || bytes !== after.size) {
    fail('claim_review_stream_input_changed');
  }
  return { sha256: hash.digest('hex'), bytes };
};
const jsonLines = async function* (
  path: string,
  code: string,
): AsyncGenerator<{ raw: string; value: unknown }> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of lines) {
      if (!raw.length || Buffer.byteLength(raw, 'utf8')
        > CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY.maximumInputLineBytes) {
        fail(code);
      }
      let value: unknown;
      try { value = JSON.parse(raw); } catch { fail(code); }
      yield { raw, value };
    }
  } finally {
    lines.close();
    input.destroy();
  }
};
const decodeCandidate = (value: unknown): CandidateRow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !same(Object.keys(value).sort(), ['proposals', 'segmentDigest'])) {
    fail('claim_review_stream_candidate_invalid');
  }
  const row = value as CandidateRow;
  if (!SHA256.test(row.segmentDigest) || !Array.isArray(row.proposals)
    || row.proposals.length > 64) fail('claim_review_stream_candidate_invalid');
  return row;
};
const queuedAt = (value: string) => {
  const time = Date.parse(value);
  if (!value.endsWith('Z') || !Number.isFinite(time)
    || new Date(time).toISOString() !== value) {
    fail('claim_review_stream_queued_at_invalid');
  }
  return value;
};
const safeArchiveKey = (key: string) => {
  if (!/^[a-z0-9][a-z0-9._/-]{0,2047}$/u.test(key)
    || key.includes('..') || key.startsWith('/')) {
    fail('claim_review_stream_archive_key_invalid');
  }
  return key;
};
const createLocalArchive = (root: string): CaseGraphContentImmutableArchive => ({
  putIfAbsent: async ({ key, body, signal }) => {
    if (signal?.aborted) fail('claim_review_stream_aborted');
    const path = join(root, 'objects', safeArchiveKey(key));
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, body, { flag: 'wx', mode: 0o600 });
      return 'written';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
      throw error;
    }
  },
  readObject: async (key, { maxBytes, signal }) => {
    if (signal?.aborted) fail('claim_review_stream_aborted');
    const path = join(root, 'objects', safeArchiveKey(key));
    let file;
    try { file = await stat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (file.size > maxBytes) fail('claim_review_stream_archive_object_too_large');
    return readFile(path);
  },
});
const readJson = async (path: string, code: string) => {
  let value: unknown;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch { fail(code); }
  return value;
};
const readVerifiedArchiveJson = async (
  root: string,
  key: string,
  expectedSha256: string,
  code: string,
) => {
  const path = join(root, 'objects', safeArchiveKey(key));
  const body = await readFile(path);
  if (createHash('sha256').update(body).digest('hex') !== expectedSha256) {
    fail(code);
  }
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); } catch { fail(code); }
  return value;
};

const processChunk = async (params: {
  ordinal: number;
  segments: ClaimExtractionSourceSegment[];
  proposals: ClaimExtractionProposalDraft[];
  provider: ClaimExtractionCandidateRunReceipt['provider'];
  queuedAt: string;
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<ClaimEvidenceStreamReviewArchiveChunk> => {
  const batch = buildClaimExtractionBatch({
    binding: params.segments[0]!.binding,
    segments: params.segments,
    proposals: params.proposals,
  });
  const candidateRunReceipt = buildClaimExtractionCandidateRunReceipt({
    batch,
    provider: params.provider,
  });
  const deferralReceipt = deferClaimExtractionBatchForReview({
    batch,
    queuedAt: params.queuedAt,
    queuePolicyVersion: CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY.queuePolicyVersion,
  });
  const sourceReliabilityCandidates = params.segments.map((segment) => (
    buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY.assessorVersion,
    })
  ));
  const archived = await archiveClaimExtractionReviewQueueItem({
    batch,
    candidateRunReceipt,
    deferralReceipt,
    sourceReliabilityCandidates,
    archive: params.archive,
    signal: params.signal,
  });
  return {
    ordinal: params.ordinal,
    segmentCount: batch.accounting.segmentCount,
    proposalCount: batch.accounting.proposalCount,
    zeroProposalSegmentCount: candidateRunReceipt.accounting.zeroProposalSegmentCount,
    extractionBatchDigest: batch.batchDigest,
    candidateRunReceiptDigest: candidateRunReceipt.receiptDigest,
    deferralReceiptDigest: deferralReceipt.receiptDigest,
    pointerObjectKey: archived.pointer.pointerObjectKey,
    pointerObjectSha256: archived.pointerObjectSha256,
    pointerDigest: archived.pointer.pointerDigest,
  };
};

export const materializeClaimEvidenceStreamReviewArchive = async (params: {
  segmentsJsonlPath: string;
  candidatesJsonlPath: string;
  providerOutputJsonlPath: string;
  batchManifest: OpenAiClaimExtractionBatchManifest;
  importReceipt: OpenAiClaimExtractionStreamImportReceipt;
  outputDirectory: string;
  queuedAt: string;
  signal?: AbortSignal;
}): Promise<ClaimEvidenceStreamReviewArchiveReceipt> => {
  const manifest = verifyOpenAiClaimExtractionBatchManifest(params.batchManifest);
  const imported = verifyOpenAiClaimExtractionStreamImportReceipt(params.importReceipt);
  if (manifest.manifestSha256 !== imported.batchManifestSha256
    || manifest.modelId !== imported.modelId
    || manifest.promptDigest !== imported.promptDigest
    || !same(manifest.binding, imported.binding)) {
    fail('claim_review_stream_manifest_mismatch');
  }
  const [candidateFile, providerFile] = await Promise.all([
    sha256File(resolve(params.candidatesJsonlPath)),
    sha256File(resolve(params.providerOutputJsonlPath)),
  ]);
  if (candidateFile.sha256 !== imported.candidateOutputSha256
    || candidateFile.bytes !== imported.candidateOutputBytes
    || providerFile.sha256 !== imported.providerOutputSha256) {
    fail('claim_review_stream_import_artifact_mismatch');
  }
  const outputDirectory = resolve(params.outputDirectory);
  const reviewQueuedAt = queuedAt(params.queuedAt);
  await mkdir(outputDirectory);
  const archive = createLocalArchive(outputDirectory);
  const segments = jsonLines(
    resolve(params.segmentsJsonlPath),
    'claim_review_stream_segment_invalid',
  )[Symbol.asyncIterator]();
  const candidates = jsonLines(
    resolve(params.candidatesJsonlPath),
    'claim_review_stream_candidate_invalid',
  )[Symbol.asyncIterator]();
  const chunks: ClaimEvidenceStreamReviewArchiveChunk[] = [];
  const setHash = createHash('sha256');
  setHash.update('[');
  let segmentCount = 0;
  let proposalCount = 0;
  let zeroProposalSegmentCount = 0;
  let chunkSegments: ClaimExtractionSourceSegment[] = [];
  let chunkProposals: ClaimExtractionProposalDraft[] = [];
  let chunkBytes = 0;
  const provider = {
    providerId: 'openai_responses',
    modelId: imported.modelId,
    modelRevision: imported.modelId,
    promptDigest: imported.promptDigest,
  };
  const flush = async () => {
    if (!chunkSegments.length) return;
    const chunk = await processChunk({
      ordinal: chunks.length,
      segments: chunkSegments,
      proposals: chunkProposals,
      provider,
      queuedAt: reviewQueuedAt,
      archive,
      signal: params.signal,
    });
    chunks.push(chunk);
    chunkSegments = [];
    chunkProposals = [];
    chunkBytes = 0;
  };
  try {
    while (true) {
      if (params.signal?.aborted) fail('claim_review_stream_aborted');
      const [nextSegment, nextCandidate] = await Promise.all([
        segments.next(),
        candidates.next(),
      ]);
      if (nextSegment.done || nextCandidate.done) {
        if (nextSegment.done !== nextCandidate.done) {
          fail('claim_review_stream_accounting_mismatch');
        }
        break;
      }
      const segment = verifyClaimExtractionSourceSegment(
        nextSegment.value.value as ClaimExtractionSourceSegment,
      );
      const candidate = decodeCandidate(nextCandidate.value.value);
      if (segment.segmentDigest !== candidate.segmentDigest
        || !same(segment.binding, imported.binding)) {
        fail('claim_review_stream_binding_mismatch');
      }
      const bytes = Buffer.byteLength(nextSegment.value.raw, 'utf8')
        + Buffer.byteLength(nextCandidate.value.raw, 'utf8') + 2;
      if (chunkSegments.length && (
        chunkSegments.length
          >= CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY.maximumSegmentsPerChunk
        || chunkBytes + bytes
          > CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY.maximumChunkInputBytes
      )) await flush();
      chunkSegments.push(segment);
      chunkProposals.push(...candidate.proposals);
      chunkBytes += bytes;
      if (segmentCount) setHash.update(',');
      setHash.update(JSON.stringify(segment.segmentDigest));
      segmentCount += 1;
      proposalCount += candidate.proposals.length;
      if (!candidate.proposals.length) zeroProposalSegmentCount += 1;
    }
    await flush();
    setHash.update(']');
    const segmentSetSha256 = setHash.digest('hex');
    if (segmentCount !== imported.segmentCount
      || proposalCount !== imported.proposalCount
      || zeroProposalSegmentCount !== imported.zeroProposalSegmentCount
      || segmentSetSha256 !== imported.inputSegmentSetSha256) {
      fail('claim_review_stream_accounting_mismatch');
    }
    const core = {
      recordType: 'case_graph_claim_evidence_stream_review_archive_receipt' as const,
      schemaVersion: CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_VERSION,
      binding: imported.binding,
      batchManifestSha256: imported.batchManifestSha256,
      importReceiptSha256: imported.receiptSha256,
      inputSegmentSetSha256: imported.inputSegmentSetSha256,
      providerOutputSha256: imported.providerOutputSha256,
      candidateOutputSha256: imported.candidateOutputSha256,
      queuedAt: reviewQueuedAt,
      segmentCount,
      proposalCount,
      zeroProposalSegmentCount,
      chunkCount: chunks.length,
      pointerSetSha256: relationshipInputSha256(
        chunks.map(({ pointerDigest }) => pointerDigest),
      ),
      chunks,
      policy: CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY,
      sideEffects: {
        networkRequests: 0 as const,
        databaseReads: 0 as const,
        databaseWrites: 0 as const,
        storageReads: 0 as const,
        storageWrites: 0 as const,
        lunaCalls: 0 as const,
        providerSubmissions: 0 as const,
        publications: 0 as const,
        deployments: 0 as const,
      },
    };
    const receipt = { ...core, receiptDigest: relationshipInputSha256(core) };
    await writeFile(
      join(outputDirectory, 'receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    return receipt;
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
};

export const verifyClaimEvidenceStreamReviewArchive = async (params: {
  outputDirectory: string;
}): Promise<ClaimEvidenceStreamReviewArchiveReceipt> => {
  const root = resolve(params.outputDirectory);
  const value = await readJson(
    join(root, 'receipt.json'),
    'claim_review_stream_receipt_invalid',
  ) as ClaimEvidenceStreamReviewArchiveReceipt;
  if (!value || value.recordType
      !== 'case_graph_claim_evidence_stream_review_archive_receipt'
    || value.schemaVersion !== CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_VERSION
    || !Array.isArray(value.chunks)
    || !same(value.policy, CLAIM_EVIDENCE_STREAM_REVIEW_ARCHIVE_POLICY)
    || !SHA256.test(value.receiptDigest)) {
    fail('claim_review_stream_receipt_invalid');
  }
  const { receiptDigest, ...core } = value;
  if (relationshipInputSha256(core) !== receiptDigest) {
    fail('claim_review_stream_receipt_digest_mismatch');
  }
  let segmentCount = 0;
  let proposalCount = 0;
  let zeroProposalSegmentCount = 0;
  const pointerDigests: string[] = [];
  for (const [ordinal, chunk] of value.chunks.entries()) {
    if (chunk.ordinal !== ordinal) fail('claim_review_stream_receipt_invalid');
    const pointer = await readVerifiedArchiveJson(
      root,
      chunk.pointerObjectKey,
      chunk.pointerObjectSha256,
      'claim_review_stream_archive_invalid',
    ) as ClaimExtractionReviewArchivePointer;
    const batch = verifyClaimExtractionBatch(await readVerifiedArchiveJson(
      root,
      pointer.batchObjectKey,
      pointer.batchObjectSha256,
      'claim_review_stream_archive_invalid',
    ) as ClaimExtractionBatch);
    const candidateRunReceipt = verifyClaimExtractionCandidateRunReceipt({
      batch,
      receipt: await readVerifiedArchiveJson(
        root,
        pointer.candidateRunObjectKey,
        pointer.candidateRunObjectSha256,
        'claim_review_stream_archive_invalid',
      ) as ClaimExtractionCandidateRunReceipt,
    });
    const deferralReceipt = await readVerifiedArchiveJson(
      root,
      pointer.deferralObjectKey,
      pointer.deferralObjectSha256,
      'claim_review_stream_archive_invalid',
    ) as ClaimAdjudicationReceipt;
    const reliability = (await readVerifiedArchiveJson(
      root,
      pointer.sourceReliabilityObjectKey,
      pointer.sourceReliabilityObjectSha256,
      'claim_review_stream_archive_invalid',
    ) as SourceReliabilityAssessment[]).map(verifySourceReliabilityAssessment);
    verifyClaimExtractionReviewArchivePointer({
      batch,
      candidateRunReceipt,
      deferralReceipt,
      sourceReliabilityCandidates: reliability,
      pointer,
    });
    if (pointer.pointerDigest !== chunk.pointerDigest
      || batch.batchDigest !== chunk.extractionBatchDigest
      || candidateRunReceipt.receiptDigest !== chunk.candidateRunReceiptDigest
      || deferralReceipt.receiptDigest !== chunk.deferralReceiptDigest
      || batch.accounting.segmentCount !== chunk.segmentCount
      || batch.accounting.proposalCount !== chunk.proposalCount
      || candidateRunReceipt.accounting.zeroProposalSegmentCount
        !== chunk.zeroProposalSegmentCount) {
      fail('claim_review_stream_archive_invalid');
    }
    segmentCount += chunk.segmentCount;
    proposalCount += chunk.proposalCount;
    zeroProposalSegmentCount += chunk.zeroProposalSegmentCount;
    pointerDigests.push(pointer.pointerDigest);
  }
  if (value.chunkCount !== value.chunks.length
    || segmentCount !== value.segmentCount
    || proposalCount !== value.proposalCount
    || zeroProposalSegmentCount !== value.zeroProposalSegmentCount
    || relationshipInputSha256(pointerDigests) !== value.pointerSetSha256) {
    fail('claim_review_stream_receipt_invalid');
  }
  return value;
};
