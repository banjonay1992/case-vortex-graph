import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  materializeClaimEvidenceStreamReviewArchive,
  verifyClaimEvidenceStreamReviewArchive,
} from '../../src/caseGraph/claimEvidenceStreamReviewArchive';
import {
  buildClaimExtractionSourceSegment,
  type ClaimExtractionSourceSegment,
} from '../../src/caseGraph/claimEvidenceExtraction';
import {
  streamOpenAiClaimExtractionBatchExport,
  streamOpenAiClaimExtractionBatchImport,
} from '../../src/caseGraph/openAiClaimExtractionBatchStream';

const directories: string[] = [];
const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'claim-review-stream-test-'));
  directories.push(path);
  return path;
};
afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

const binding = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'corpus-v1',
  manifestSha256: '1'.repeat(64),
  snapshotId: '00000000-0000-4000-8000-000000000002',
  graphArtifactSetSha256: '2'.repeat(64),
};
const segment = (ordinal: number) => buildClaimExtractionSourceSegment({
  binding,
  address: `document:review-stream-${ordinal}`,
  sourceId: `source_${ordinal}`,
  sourceLabel: `Source ${ordinal}`,
  lineageId: `lineage_${ordinal}`,
  mediaKind: 'document',
  textOrigin: 'embedded_text',
  text: `Witness ${ordinal} reported a light.`,
  locatorBase: {
    kind: 'document_page',
    pageNumber: ordinal,
    characterOffset: 0,
    boundingBox: null,
  },
  provenance: {
    assetDigest: ordinal.toString(16).repeat(64),
    extractionContractDigest: '3'.repeat(64),
    extractionReceiptDigest: '4'.repeat(64),
    extractionPointerDigest: '5'.repeat(64),
  },
});
const providerRow = (source: ClaimExtractionSourceSegment, withProposal = true) => ({
  custom_id: `claim-extraction:${source.segmentDigest}`,
  response: {
    status_code: 200,
    body: {
      status: 'completed',
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            proposals: withProposal ? [{
              quoteStart: 0,
              quoteEnd: source.text.length,
              quote: source.text,
              subject: 'a witness',
              predicate: 'reported_light',
              object: 'a light',
              polarity: 'asserted',
              modality: 'reported',
              confidence: 0.8,
            }] : [],
          }),
        }],
      }],
    },
  },
  error: null,
});
const fixture = async () => {
  const directory = await temporaryDirectory();
  const sources = [segment(1), segment(2), segment(3)]
    .sort((left, right) => left.segmentDigest < right.segmentDigest ? -1 : 1);
  const segmentsPath = join(directory, 'segments.jsonl');
  const providerPath = join(directory, 'provider.jsonl');
  const candidatesPath = join(directory, 'candidates.jsonl');
  await writeFile(
    segmentsPath,
    `${sources.map((value) => JSON.stringify(value)).join('\n')}\n`,
  );
  await writeFile(
    providerPath,
    `${sources.map((value, index) => JSON.stringify(
      providerRow(value, index !== 1),
    )).reverse().join('\n')}\n`,
  );
  const exported = await streamOpenAiClaimExtractionBatchExport({
    segmentsJsonlPath: segmentsPath,
    outputDirectory: join(directory, 'batch'),
  });
  const imported = await streamOpenAiClaimExtractionBatchImport({
    segmentsJsonlPath: segmentsPath,
    providerOutputJsonlPath: providerPath,
    candidateOutputJsonlPath: candidatesPath,
    batchManifest: exported.manifest,
    temporaryDirectory: directory,
  });
  return {
    directory,
    segmentsPath,
    providerPath,
    candidatesPath,
    manifest: exported.manifest,
    imported,
  };
};

describe('streaming claim extraction immutable review archive', () => {
  it('materializes and independently verifies a fully deferred local queue', async () => {
    const input = await fixture();
    const output = join(input.directory, 'review-archive');
    const receipt = await materializeClaimEvidenceStreamReviewArchive({
      segmentsJsonlPath: input.segmentsPath,
      candidatesJsonlPath: input.candidatesPath,
      providerOutputJsonlPath: input.providerPath,
      batchManifest: input.manifest,
      importReceipt: input.imported,
      outputDirectory: output,
      queuedAt: '2026-07-27T12:00:00.000Z',
    });

    expect(receipt).toMatchObject({
      segmentCount: 3,
      proposalCount: 2,
      zeroProposalSegmentCount: 1,
      chunkCount: 1,
      sideEffects: {
        networkRequests: 0,
        databaseWrites: 0,
        storageWrites: 0,
        providerSubmissions: 0,
        publications: 0,
        deployments: 0,
      },
    });
    await expect(verifyClaimEvidenceStreamReviewArchive({
      outputDirectory: output,
    })).resolves.toEqual(receipt);
    expect(receipt.chunks[0]?.pointerObjectKey).toContain(
      'claim-extraction-review/v1/publications',
    );
  });

  it('never replaces an output directory and removes a failed new archive', async () => {
    const input = await fixture();
    const output = join(input.directory, 'existing');
    await writeFile(output, 'preserve');
    await expect(materializeClaimEvidenceStreamReviewArchive({
      segmentsJsonlPath: input.segmentsPath,
      candidatesJsonlPath: input.candidatesPath,
      providerOutputJsonlPath: input.providerPath,
      batchManifest: input.manifest,
      importReceipt: input.imported,
      outputDirectory: output,
      queuedAt: '2026-07-27T12:00:00.000Z',
    })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(output, 'utf8')).toBe('preserve');

    const corruptCandidates = join(input.directory, 'corrupt-candidates.jsonl');
    await writeFile(corruptCandidates, '{}\n');
    const failedOutput = join(input.directory, 'failed-output');
    await expect(materializeClaimEvidenceStreamReviewArchive({
      segmentsJsonlPath: input.segmentsPath,
      candidatesJsonlPath: corruptCandidates,
      providerOutputJsonlPath: input.providerPath,
      batchManifest: input.manifest,
      importReceipt: {
        ...input.imported,
        candidateOutputSha256: 'f'.repeat(64),
      },
      outputDirectory: failedOutput,
      queuedAt: '2026-07-27T12:00:00.000Z',
    })).rejects.toThrow('claim_extraction_stream_receipt_digest_mismatch');
    await expect(access(failedOutput)).rejects.toThrow();
  });

  it('detects immutable object tampering during independent replay', async () => {
    const input = await fixture();
    const output = join(input.directory, 'review-archive');
    const receipt = await materializeClaimEvidenceStreamReviewArchive({
      segmentsJsonlPath: input.segmentsPath,
      candidatesJsonlPath: input.candidatesPath,
      providerOutputJsonlPath: input.providerPath,
      batchManifest: input.manifest,
      importReceipt: input.imported,
      outputDirectory: output,
      queuedAt: '2026-07-27T12:00:00.000Z',
    });
    const pointerPath = join(
      output,
      'objects',
      receipt.chunks[0]!.pointerObjectKey,
    );
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
    pointer.batchObjectSha256 = 'f'.repeat(64);
    await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);

    await expect(verifyClaimEvidenceStreamReviewArchive({
      outputDirectory: output,
    })).rejects.toThrow('claim_review_stream_archive_invalid');
  });
});
