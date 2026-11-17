import { describe, expect, it, vi } from 'vitest';

import {
  runClaimEvidenceFullCorpusCandidateBackfill,
  verifyClaimEvidenceFullCorpusBackfillReceipt,
  type ClaimEvidenceBackfillContentPage,
} from '../../src/caseGraph/claimEvidenceFullCorpusBackfill';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';
import type { CaseGraphResearchContentEntry, CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
  relationshipSchemaVersion: 'relationship-schema-v1',
  relationshipPolicyVersion: 'relationship-policy-v1',
  relationshipPolicySha256: 'c'.repeat(64),
  relationshipModelId: 'relationship-model',
  relationshipModelVersion: 'relationship-model-v1',
  relationshipModelSha256: 'd'.repeat(64),
  calibrationSetSha256: 'e'.repeat(64),
};

const entry = (ordinal: number): CaseGraphResearchContentEntry => ({
  chunkId: `content-chunk:${String(ordinal).repeat(64)}`,
  chunkDigest: String(ordinal + 3).repeat(64),
  address: `document:full-corpus-${ordinal}`,
  assetId: `content-asset:${ordinal}`,
  assetDigest: String(ordinal + 4).repeat(64),
  extractionContractDigest: '6'.repeat(64),
  extractionReceiptDigest: '7'.repeat(64),
  extractionPointerDigest: '8'.repeat(64),
  mediaKind: 'document',
  textOrigin: 'embedded_text',
  locator: {
    locatorType: 'document_page', pageNumber: ordinal, characterStart: 0,
    characterEnd: 32, readingOrder: 0, boundingBox: null,
  },
  text: `Witness ${ordinal} reported a blue light.`,
  language: 'en',
  confidence: null,
  scoreMicros: 0,
});

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

const proposer = {
  providerId: 'fixture_provider',
  modelId: 'fixture_model',
  modelRevision: 'fixture_revision_v1',
  promptDigest: '9'.repeat(64),
  propose: vi.fn(async ({ segment }) => [{
    segmentDigest: segment.segmentDigest,
    quoteStart: 0,
    quoteEnd: segment.text.length,
    subject: segment.text.split(' reported')[0],
    predicate: 'reported_light',
    object: 'a blue light',
    polarity: 'asserted' as const,
    modality: 'reported' as const,
    extraction: { method: 'governed_model' as const, version: 'fixture-extractor-v1', confidence: 0.8 },
  }]),
};

const sourceFor = (pages: Record<string, ClaimEvidenceBackfillContentPage>) => ({
  readPage: vi.fn(async ({ cursor }) => pages[cursor ?? 'start']!),
});

describe('full-corpus claim candidate backfill', () => {
  it('accounts every pinned content entry, archives review queues and publishes zero model claims', async () => {
    const storage = memoryArchive();
    const source = sourceFor({
      start: { entries: [entry(1), entry(2)], nextCursor: 'page-2', totalEntryCount: 3, indexManifestDigest: 'f'.repeat(64) },
      'page-2': { entries: [entry(3)], nextCursor: null, totalEntryCount: 3, indexManifestDigest: 'f'.repeat(64) },
    });
    const result = await runClaimEvidenceFullCorpusCandidateBackfill({
      publication,
      contentSource: source,
      resolveSourceMetadata: (value) => ({
        sourceId: `source_${value.address.split('-').at(-1)}`,
        sourceLabel: `Source for ${value.address}`,
        lineageId: `lineage_${value.address.split('-').at(-1)}`,
      }),
      proposer,
      archive: storage.archive,
      queuedAt: '2026-07-20T15:00:00.000Z',
      pageSize: 2,
      modelConcurrency: 2,
    });

    expect(source.readPage).toHaveBeenCalledTimes(2);
    expect(result.receipt).toMatchObject({
      sourceEntryCount: 3,
      processedEntryCount: 3,
      pageCount: 2,
      queueItemCount: 2,
      proposalCount: 3,
      deferredProposalCount: 3,
      sourceReliabilityCandidateCount: 3,
      publishedClaimCount: 0,
      status: 'review_required',
    });
    expect(result.receipt.queueItems.map((item) => item.segmentCount)).toEqual([2, 1]);
    expect(storage.writes).toHaveLength(11);
    expect(storage.writes.at(-1)).toBe(result.completionObjectKey);
    expect(verifyClaimEvidenceFullCorpusBackfillReceipt(result.receipt)).toEqual(result.receipt);
  });

  it('fails closed if the source changes, repeats a chunk, or undercounts the corpus', async () => {
    const base = {
      publication,
      resolveSourceMetadata: () => ({ sourceId: 'source', sourceLabel: 'Source', lineageId: 'lineage' }),
      proposer,
      queuedAt: '2026-07-20T15:00:00.000Z',
      pageSize: 1,
    };
    await expect(runClaimEvidenceFullCorpusCandidateBackfill({
      ...base,
      contentSource: sourceFor({
        start: { entries: [entry(1)], nextCursor: 'next', totalEntryCount: 2, indexManifestDigest: 'f'.repeat(64) },
        next: { entries: [entry(2)], nextCursor: null, totalEntryCount: 2, indexManifestDigest: 'e'.repeat(64) },
      }),
      archive: memoryArchive().archive,
    })).rejects.toThrow('claim_backfill_source_changed');

    await expect(runClaimEvidenceFullCorpusCandidateBackfill({
      ...base,
      contentSource: sourceFor({
        start: { entries: [entry(1)], nextCursor: 'next', totalEntryCount: 2, indexManifestDigest: 'f'.repeat(64) },
        next: { entries: [entry(1)], nextCursor: null, totalEntryCount: 2, indexManifestDigest: 'f'.repeat(64) },
      }),
      archive: memoryArchive().archive,
    })).rejects.toThrow('claim_backfill_duplicate_chunk');

    await expect(runClaimEvidenceFullCorpusCandidateBackfill({
      ...base,
      contentSource: sourceFor({
        start: { entries: [entry(1)], nextCursor: null, totalEntryCount: 2, indexManifestDigest: 'f'.repeat(64) },
      }),
      archive: memoryArchive().archive,
    })).rejects.toThrow('claim_backfill_incomplete_corpus');
  });

  it('supports a pinned empty corpus without invoking the model', async () => {
    const storage = memoryArchive();
    const localProposer = { ...proposer, propose: vi.fn() };
    const result = await runClaimEvidenceFullCorpusCandidateBackfill({
      publication,
      contentSource: sourceFor({
        start: { entries: [], nextCursor: null, totalEntryCount: 0, indexManifestDigest: 'f'.repeat(64) },
      }),
      resolveSourceMetadata: () => ({ sourceId: 'unused', sourceLabel: 'Unused', lineageId: 'unused' }),
      proposer: localProposer,
      archive: storage.archive,
      queuedAt: '2026-07-20T15:00:00.000Z',
    });

    expect(localProposer.propose).not.toHaveBeenCalled();
    expect(result.receipt).toMatchObject({ sourceEntryCount: 0, queueItemCount: 0, proposalCount: 0 });
    expect(storage.writes).toEqual([result.completionObjectKey]);
  });
});
