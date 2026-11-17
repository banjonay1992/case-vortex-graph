import { describe, expect, it, vi } from 'vitest';

import { buildClaimExtractionSourceSegment } from '../../src/caseGraph/claimEvidenceExtraction';
import {
  CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
  deferClaimExtractionBatchForReview,
  runClaimExtractionCandidates,
  verifyClaimExtractionCandidateRunReceipt,
} from '../../src/caseGraph/claimEvidenceExtractionRunner';
import type { ClaimEvidencePublicationBinding } from '../../src/caseGraph/claimEvidenceGraph';

const binding: ClaimEvidencePublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const makeSegment = (ordinal: number) => buildClaimExtractionSourceSegment({
  binding,
  address: `document:runner-fixture-${ordinal}`,
  sourceId: `fixture_source_${ordinal}`,
  sourceLabel: `Fixture source ${ordinal}`,
  lineageId: `fixture_lineage_${ordinal}`,
  mediaKind: 'document',
  textOrigin: 'embedded_text',
  text: `Witness ${ordinal} reported one light.`,
  locatorBase: { kind: 'document_page', pageNumber: ordinal, characterOffset: 0, boundingBox: null },
  provenance: {
    assetDigest: String(ordinal).repeat(64),
    extractionContractDigest: 'c'.repeat(64),
    extractionReceiptDigest: 'd'.repeat(64),
    extractionPointerDigest: 'e'.repeat(64),
  },
});

const proposer = (propose: ReturnType<typeof vi.fn>) => ({
  providerId: 'luna_extraction_provider',
  modelId: 'governed_claim_model',
  modelRevision: 'revision_2026_07_20',
  promptDigest: 'f'.repeat(64),
  propose,
});

describe('claim extraction candidate runner', () => {
  it('runs a bounded model boundary and deterministically builds candidates', async () => {
    const segments = [makeSegment(1), makeSegment(2)];
    const propose = vi.fn(async ({ segment, securityBoundary }) => {
      expect(securityBoundary).toBe(CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY);
      return [{
        segmentDigest: segment.segmentDigest,
        quoteStart: 0,
        quoteEnd: segment.text.length,
        subject: segment.text.split(' reported')[0],
        predicate: 'reported_light',
        object: 'one light',
        polarity: 'asserted' as const,
        modality: 'reported' as const,
        extraction: { method: 'governed_model' as const, version: 'fixture-extractor-v1', confidence: 0.8 },
      }];
    });

    const result = await runClaimExtractionCandidates({
      binding,
      segments,
      proposer: proposer(propose),
      maximumConcurrency: 2,
    });

    expect(propose).toHaveBeenCalledTimes(2);
    expect(result.batch.accounting).toEqual({ segmentCount: 2, proposalCount: 2 });
    expect(result.receipt.accounting).toEqual({ segmentCount: 2, proposalCount: 2, zeroProposalSegmentCount: 0 });
    expect(result.receipt.securityBoundary.externalKnowledge).toBe('forbidden');
    expect(verifyClaimExtractionCandidateRunReceipt(result)).toEqual(result.receipt);
    expect(() => verifyClaimExtractionCandidateRunReceipt({
      batch: result.batch,
      receipt: { ...result.receipt, accounting: { ...result.receipt.accounting, proposalCount: 99 } },
    })).toThrow('claim_extraction_runner_receipt_integrity_failed');
  });

  it('automatically defers model candidates outside the published claim set', async () => {
    const segment = makeSegment(1);
    const result = await runClaimExtractionCandidates({
      binding,
      segments: [segment],
      proposer: proposer(vi.fn(async () => [{
        segmentDigest: segment.segmentDigest,
        quoteStart: 0,
        quoteEnd: segment.text.length,
        subject: 'Witness 1',
        predicate: 'reported_light',
        object: 'one light',
        polarity: 'asserted' as const,
        modality: 'reported' as const,
        extraction: { method: 'governed_model' as const, version: 'fixture-extractor-v1', confidence: 0.8 },
      }])),
    });
    const deferred = deferClaimExtractionBatchForReview({
      batch: result.batch,
      queuedAt: '2026-07-20T13:30:00.000Z',
      queuePolicyVersion: 'claim_review_queue_v1',
    });

    expect(deferred.accounting.deferred).toBe(1);
    expect(deferred.claims).toEqual([]);
  });

  it('fails the whole batch on cross-segment output, over-limit concurrency or abort', async () => {
    const segment = makeSegment(1);
    await expect(runClaimExtractionCandidates({
      binding,
      segments: [segment],
      proposer: proposer(vi.fn(async () => [{
        segmentDigest: '9'.repeat(64), quoteStart: 0, quoteEnd: 10,
        subject: 'x', predicate: 'reported', object: 'y', polarity: 'asserted', modality: 'reported',
        extraction: { method: 'governed_model', version: 'fixture-v1', confidence: 0.5 },
      }])),
    })).rejects.toThrow('claim_extraction_runner_output_invalid');

    await expect(runClaimExtractionCandidates({
      binding, segments: [segment], proposer: proposer(vi.fn()), maximumConcurrency: 9,
    })).rejects.toThrow('claim_extraction_runner_concurrency_invalid');

    const controller = new AbortController();
    controller.abort();
    await expect(runClaimExtractionCandidates({
      binding, segments: [segment], proposer: proposer(vi.fn()), signal: controller.signal,
    })).rejects.toThrow('claim_extraction_runner_aborted');
  });
});
