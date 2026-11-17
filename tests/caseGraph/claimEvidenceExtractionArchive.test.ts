import { describe, expect, it, vi } from 'vitest';

import {
  buildClaimExtractionSourceSegment,
  buildConservativeSourceReliabilityAssessment,
} from '../../src/caseGraph/claimEvidenceExtraction';
import {
  archiveClaimExtractionReviewQueueItem,
  verifyClaimExtractionReviewArchivePointer,
} from '../../src/caseGraph/claimEvidenceExtractionArchive';
import {
  deferClaimExtractionBatchForReview,
  runClaimExtractionCandidates,
} from '../../src/caseGraph/claimEvidenceExtractionRunner';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';

const binding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const memoryArchive = () => {
  const objects = new Map<string, Buffer>();
  const writes: string[] = [];
  const archive: CaseGraphContentImmutableArchive = {
    putIfAbsent: async ({ key, body }) => {
      if (objects.has(key)) return 'exists';
      objects.set(key, Buffer.from(body));
      writes.push(key);
      return 'written';
    },
    readObject: async (key) => objects.get(key) || null,
  };
  return { archive, objects, writes };
};

const candidate = async () => {
  const segment = buildClaimExtractionSourceSegment({
    binding,
    address: 'document:review-archive-fixture',
    sourceId: 'fixture_source',
    sourceLabel: 'Fixture source',
    lineageId: 'fixture_lineage',
    mediaKind: 'document',
    textOrigin: 'embedded_text',
    text: 'A witness reported a stationary light.',
    locatorBase: { kind: 'document_page', pageNumber: 1, characterOffset: 0, boundingBox: null },
    provenance: {
      assetDigest: 'c'.repeat(64), extractionContractDigest: 'd'.repeat(64),
      extractionReceiptDigest: 'e'.repeat(64), extractionPointerDigest: 'f'.repeat(64),
    },
  });
  const result = await runClaimExtractionCandidates({
    binding,
    segments: [segment],
    proposer: {
      providerId: 'fixture_provider', modelId: 'fixture_model', modelRevision: 'revision_v1',
      promptDigest: '1'.repeat(64),
      propose: vi.fn(async () => [{
        segmentDigest: segment.segmentDigest, quoteStart: 0, quoteEnd: segment.text.length,
        subject: 'a witness', predicate: 'reported_light', object: 'a stationary light',
        polarity: 'asserted', modality: 'reported',
        extraction: { method: 'governed_model', version: 'fixture-v1', confidence: 0.9 },
      }]),
    },
  });
  return {
    ...result,
    sourceReliabilityCandidates: [buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v1',
    })],
    deferralReceipt: deferClaimExtractionBatchForReview({
      batch: result.batch,
      queuedAt: '2026-07-20T14:00:00.000Z',
      queuePolicyVersion: 'claim_review_queue_v1',
    }),
  };
};

describe('claim extraction review queue immutable archive', () => {
  it('persists candidates and deferrals before a deterministic pointer', async () => {
    const storage = memoryArchive();
    const item = await candidate();
    const first = await archiveClaimExtractionReviewQueueItem({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: item.deferralReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      archive: storage.archive,
    });

    expect(storage.writes).toHaveLength(5);
    expect(storage.writes.at(-1)).toBe(first.pointer.pointerObjectKey);
    expect(first.pointerObjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyClaimExtractionReviewArchivePointer({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: item.deferralReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      pointer: first.pointer,
    })).toEqual(first.pointer);

    const second = await archiveClaimExtractionReviewQueueItem({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: item.deferralReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      archive: storage.archive,
    });
    expect(second).toEqual(first);
    expect(storage.writes).toHaveLength(5);
  });

  it('fails on altered pointers, non-deferred decisions and read-after-write corruption', async () => {
    const item = await candidate();
    const stored = await archiveClaimExtractionReviewQueueItem({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: item.deferralReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      archive: memoryArchive().archive,
    });
    expect(() => verifyClaimExtractionReviewArchivePointer({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: item.deferralReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      pointer: { ...stored.pointer, batchObjectSha256: '9'.repeat(64) },
    })).toThrow('claim_extraction_review_archive_pointer_integrity_failed');

    const acceptedReceipt = {
      ...item.deferralReceipt,
      decisions: item.deferralReceipt.decisions.map((decision) => ({ ...decision, decision: 'accept' as const })),
    };
    await expect(archiveClaimExtractionReviewQueueItem({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: acceptedReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      archive: memoryArchive().archive,
    })).rejects.toThrow('claim_adjudication_receipt_integrity_failed');

    const corrupt: CaseGraphContentImmutableArchive = {
      putIfAbsent: async () => 'written',
      readObject: async () => Buffer.from('corrupt'),
    };
    await expect(archiveClaimExtractionReviewQueueItem({
      batch: item.batch,
      candidateRunReceipt: item.receipt,
      deferralReceipt: item.deferralReceipt,
      sourceReliabilityCandidates: item.sourceReliabilityCandidates,
      archive: corrupt,
    })).rejects.toThrow('claim_extraction_review_archive_read_after_write_mismatch');
  });
});
