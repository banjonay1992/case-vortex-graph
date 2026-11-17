import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  materializeClaimEvidenceSourceSegments,
  verifyClaimEvidenceSegmentMaterializationReceipt,
} from '../../src/caseGraph/claimEvidenceSegmentMaterializer';
import type {
  ClaimEvidenceBackfillContentPage,
} from '../../src/caseGraph/claimEvidenceFullCorpusBackfill';
import type {
  CaseGraphResearchContentEntry,
  CaseGraphResearchPublicationBinding,
} from '../../src/caseGraph/researchToolContract';

const temporaryDirectories: string[] = [];
const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'claim-segment-materializer-test-'));
  temporaryDirectories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

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

const digest = (ordinal: number, offset = 0) => (
  (ordinal + offset).toString(16).padStart(64, '0')
);
const entry = (ordinal: number, text = `Witness ${ordinal} reported a blue light.`):
CaseGraphResearchContentEntry => ({
  chunkId: `content-chunk:${digest(ordinal)}`,
  chunkDigest: digest(ordinal, 20),
  address: `document:materializer-${ordinal}`,
  assetId: `content-asset:${ordinal}`,
  assetDigest: digest(ordinal, 40),
  extractionContractDigest: '6'.repeat(64),
  extractionReceiptDigest: '7'.repeat(64),
  extractionPointerDigest: '8'.repeat(64),
  mediaKind: 'document',
  textOrigin: 'embedded_text',
  locator: {
    locatorType: 'document_page',
    pageNumber: ordinal,
    characterStart: 0,
    characterEnd: text.length,
    readingOrder: 0,
    boundingBox: null,
  },
  text,
  language: 'en',
  confidence: null,
  scoreMicros: 0,
});

const sourceFor = (pages: Record<string, ClaimEvidenceBackfillContentPage>) => ({
  readPage: vi.fn(async ({ cursor }: { cursor: string | null }) => (
    pages[cursor ?? 'start']!
  )),
});
const metadata = (value: CaseGraphResearchContentEntry) => ({
  sourceId: `source_${value.address.split('-').at(-1)}`,
  sourceLabel: `Source for ${value.address}`,
  lineageId: `lineage_${value.address.split('-').at(-1)}`,
});

describe('claim evidence source-segment materializer', () => {
  it('pages the pinned corpus, externally sorts every segment and verifies its receipt', async () => {
    const directory = await temporaryDirectory();
    const entries = Array.from(
      { length: 24 },
      (_, index) => entry(index + 1, `${index + 1}:${'x'.repeat(89_900)}`),
    );
    const source = sourceFor({
      start: {
        entries: entries.slice(0, 12),
        nextCursor: entries[11]!.chunkId,
        totalEntryCount: entries.length,
        indexManifestDigest: 'f'.repeat(64),
      },
      [entries[11]!.chunkId]: {
        entries: entries.slice(12),
        nextCursor: null,
        totalEntryCount: entries.length,
        indexManifestDigest: 'f'.repeat(64),
      },
    });
    const outputJsonlPath = join(directory, 'segments.jsonl');

    const receipt = await materializeClaimEvidenceSourceSegments({
      publication,
      contentSource: source,
      resolveSourceMetadata: metadata,
      sourceMetadataResolverVersion: 'relationship-input-resolver-v1',
      outputJsonlPath,
      temporaryDirectory: directory,
      pageSize: 12,
      sortChunkBytes: 1 * 1024 * 1024,
    });
    const segments = (await readFile(outputJsonlPath, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line));

    expect(source.readPage).toHaveBeenCalledTimes(2);
    expect(receipt).toMatchObject({
      sourceEntryCount: 24,
      processedEntryCount: 24,
      segmentCount: 24,
      pageCount: 2,
    });
    expect(segments.map(({ segmentDigest }) => segmentDigest)).toEqual(
      segments.map(({ segmentDigest }) => segmentDigest).sort(),
    );
    await expect(verifyClaimEvidenceSegmentMaterializationReceipt({
      receipt,
      outputJsonlPath,
      expectedPublication: publication,
    })).resolves.toEqual(receipt);
    expect((await readdir(directory)).some(
      (name) => name.startsWith('claim-segment-materializer-')
        || name.includes('.tmp-claim-segment-materializer-'),
    )).toBe(false);
  });

  it('fails closed when page accounting, ordering or cursors change', async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, 'segments.jsonl');
    const run = (source: ReturnType<typeof sourceFor>) => (
      materializeClaimEvidenceSourceSegments({
        publication,
        contentSource: source,
        resolveSourceMetadata: metadata,
        sourceMetadataResolverVersion: 'relationship-input-resolver-v1',
        outputJsonlPath: output,
        temporaryDirectory: directory,
        pageSize: 2,
      })
    );

    await expect(run(sourceFor({
      start: {
        entries: [entry(1)],
        nextCursor: entry(1).chunkId,
        totalEntryCount: 2,
        indexManifestDigest: 'f'.repeat(64),
      },
      [entry(1).chunkId]: {
        entries: [entry(2)],
        nextCursor: null,
        totalEntryCount: 2,
        indexManifestDigest: '0'.repeat(64),
      },
    }))).rejects.toThrow('claim_segment_materializer_source_changed');

    await expect(run(sourceFor({
      start: {
        entries: [entry(2), entry(1)],
        nextCursor: null,
        totalEntryCount: 2,
        indexManifestDigest: 'f'.repeat(64),
      },
    }))).rejects.toThrow('claim_segment_materializer_content_order_invalid');

    await expect(run(sourceFor({
      start: {
        entries: [entry(1)],
        nextCursor: 'wrong-cursor',
        totalEntryCount: 1,
        indexManifestDigest: 'f'.repeat(64),
      },
    }))).rejects.toThrow('claim_segment_materializer_cursor_invalid');
    await expect(access(output)).rejects.toThrow();
  });

  it('never overwrites a prior output and removes work files after aborts', async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, 'segments.jsonl');
    await writeFile(output, 'preserve-me\n');
    const singlePage = sourceFor({
      start: {
        entries: [entry(1)],
        nextCursor: null,
        totalEntryCount: 1,
        indexManifestDigest: 'f'.repeat(64),
      },
    });
    await expect(materializeClaimEvidenceSourceSegments({
      publication,
      contentSource: singlePage,
      resolveSourceMetadata: metadata,
      sourceMetadataResolverVersion: 'relationship-input-resolver-v1',
      outputJsonlPath: output,
      temporaryDirectory: directory,
    })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(output, 'utf8')).toBe('preserve-me\n');

    const controller = new AbortController();
    controller.abort();
    await expect(materializeClaimEvidenceSourceSegments({
      publication,
      contentSource: singlePage,
      resolveSourceMetadata: metadata,
      sourceMetadataResolverVersion: 'relationship-input-resolver-v1',
      outputJsonlPath: join(directory, 'aborted.jsonl'),
      temporaryDirectory: directory,
      signal: controller.signal,
    })).rejects.toThrow('claim_segment_materializer_aborted');
    expect((await readdir(directory)).some(
      (name) => name.startsWith('claim-segment-materializer-'),
    )).toBe(false);
  });

  it('detects receipt, publication, output and final-newline tampering', async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, 'segments.jsonl');
    const receipt = await materializeClaimEvidenceSourceSegments({
      publication,
      contentSource: sourceFor({
        start: {
          entries: [entry(1)],
          nextCursor: null,
          totalEntryCount: 1,
          indexManifestDigest: 'f'.repeat(64),
        },
      }),
      resolveSourceMetadata: metadata,
      sourceMetadataResolverVersion: 'relationship-input-resolver-v1',
      outputJsonlPath: output,
      temporaryDirectory: directory,
    });

    await expect(verifyClaimEvidenceSegmentMaterializationReceipt({
      receipt: { ...receipt, outputBytes: receipt.outputBytes + 1 },
      outputJsonlPath: output,
    })).rejects.toThrow('claim_segment_materializer_receipt_digest_mismatch');
    await expect(verifyClaimEvidenceSegmentMaterializationReceipt({
      receipt,
      outputJsonlPath: output,
      expectedPublication: { ...publication, corpusVersion: 'another-corpus' },
    })).rejects.toThrow('claim_segment_materializer_publication_mismatch');

    const original = await readFile(output, 'utf8');
    await writeFile(output, original.slice(0, -1));
    await expect(verifyClaimEvidenceSegmentMaterializationReceipt({
      receipt,
      outputJsonlPath: output,
    })).rejects.toThrow('claim_segment_materializer_output_receipt_mismatch');
  });
});
