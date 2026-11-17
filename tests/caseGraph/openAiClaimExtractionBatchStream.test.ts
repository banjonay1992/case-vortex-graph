import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildOpenAiClaimExtractionBatchShards,
} from '../../src/caseGraph/openAiClaimExtractionBatch';
import {
  streamOpenAiClaimExtractionBatchExport,
  streamOpenAiClaimExtractionBatchImport,
} from '../../src/caseGraph/openAiClaimExtractionBatchStream';
import {
  buildClaimExtractionSourceSegment,
  type ClaimExtractionSourceSegment,
} from '../../src/caseGraph/claimEvidenceExtraction';

const temporaryDirectories: string[] = [];
const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'claim-extraction-stream-test-'));
  temporaryDirectories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

const segment = (ordinal: number) => buildClaimExtractionSourceSegment({
  binding: {
    publicationId: '00000000-0000-4000-8000-000000000001',
    corpusVersion: 'v1',
    manifestSha256: '1'.repeat(64),
    snapshotId: 'snapshot',
    graphArtifactSetSha256: '2'.repeat(64),
  },
  address: `document:${ordinal}`,
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
    assetDigest: String(ordinal).repeat(64),
    extractionContractDigest: '3'.repeat(64),
    extractionReceiptDigest: '4'.repeat(64),
    extractionPointerDigest: '5'.repeat(64),
  },
});

const sortedSegments = () => [segment(1), segment(2), segment(3)]
  .sort((left, right) => left.segmentDigest < right.segmentDigest ? -1 : 1);

const writeSegments = async (path: string, segments: ClaimExtractionSourceSegment[]) => {
  await writeFile(path, `${segments.map((value) => JSON.stringify(value)).join('\n')}\n`);
};

const output = (source: ClaimExtractionSourceSegment, padding = '') => ({
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
            proposals: [{
              quoteStart: 0,
              quoteEnd: source.text.length,
              quote: source.text,
              subject: `Witness ${source.locatorBase.kind === 'document_page'
                ? source.locatorBase.pageNumber : 0}`,
              predicate: 'reported_light',
              object: 'a light',
              polarity: 'asserted',
              modality: 'reported',
              confidence: 0.8,
            }],
          }),
        }],
      }],
    },
  },
  error: null,
  padding,
});

describe('streaming OpenAI claim extraction batch transport', () => {
  it('writes byte-identical deterministic shards without holding shard bodies in memory', async () => {
    const directory = await temporaryDirectory();
    const segments = sortedSegments();
    const segmentsPath = join(directory, 'segments.jsonl');
    const outputDirectory = join(directory, 'batch');
    await writeSegments(segmentsPath, segments);

    const streamed = await streamOpenAiClaimExtractionBatchExport({
      segmentsJsonlPath: segmentsPath,
      outputDirectory,
      maximumRequestsPerFile: 2,
      maximumBytesPerFile: 100_000,
    });
    const inMemory = buildOpenAiClaimExtractionBatchShards({
      segments,
      maximumRequestsPerFile: 2,
      maximumBytesPerFile: 100_000,
    });

    expect(streamed.manifest).toEqual(inMemory.manifest);
    expect(await readFile(streamed.manifestPath, 'utf8')).toBe(
      `${JSON.stringify(inMemory.manifest, null, 2)}\n`,
    );
    for (const shard of inMemory.shards) {
      expect(await readFile(join(
        outputDirectory,
        `claim-extraction-${String(shard.ordinal).padStart(5, '0')}.jsonl`,
      ))).toEqual(shard.body);
    }
  });

  it('externally sorts out-of-order provider output and reconciles every record once', async () => {
    const directory = await temporaryDirectory();
    const segments = sortedSegments();
    const segmentsPath = join(directory, 'segments.jsonl');
    const providerPath = join(directory, 'provider.jsonl');
    const candidatePath = join(directory, 'candidates.jsonl');
    await writeSegments(segmentsPath, segments);
    const exported = await streamOpenAiClaimExtractionBatchExport({
      segmentsJsonlPath: segmentsPath,
      outputDirectory: join(directory, 'batch'),
    });
    await writeFile(providerPath, `${[...segments].reverse().map(
      (source) => JSON.stringify(output(source, 'x'.repeat(400_000))),
    ).join('\n')}\n`);

    const receipt = await streamOpenAiClaimExtractionBatchImport({
      segmentsJsonlPath: segmentsPath,
      providerOutputJsonlPath: providerPath,
      candidateOutputJsonlPath: candidatePath,
      batchManifest: exported.manifest,
      temporaryDirectory: directory,
      sortChunkBytes: 1 * 1024 * 1024,
    });
    const candidates = (await readFile(candidatePath, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line));

    expect(receipt).toMatchObject({
      segmentCount: 3,
      proposalCount: 3,
      zeroProposalSegmentCount: 0,
    });
    expect(candidates.map(({ segmentDigest }) => segmentDigest)).toEqual(
      segments.map(({ segmentDigest }) => segmentDigest),
    );
    expect(candidates.every(({ proposals }) => (
      proposals.length === 1 && proposals[0].predicate === 'reported_light'
    ))).toBe(true);
    expect((await readdir(directory)).some(
      (name) => name.startsWith('claim-extraction-import-'),
    )).toBe(false);
  });

  it('fails closed on unsorted segments, missing output, duplicates, and unsafe paths', async () => {
    const directory = await temporaryDirectory();
    const segments = sortedSegments();
    const segmentsPath = join(directory, 'segments.jsonl');
    const providerPath = join(directory, 'provider.jsonl');
    const candidatePath = join(directory, 'candidates.jsonl');
    await writeSegments(segmentsPath, [...segments].reverse());
    const validSegmentsPath = join(directory, 'valid-segments.jsonl');
    await writeSegments(validSegmentsPath, segments);
    const exported = await streamOpenAiClaimExtractionBatchExport({
      segmentsJsonlPath: validSegmentsPath,
      outputDirectory: join(directory, 'valid-batch'),
    });

    await expect(streamOpenAiClaimExtractionBatchExport({
      segmentsJsonlPath: segmentsPath,
      outputDirectory: join(directory, 'batch'),
    })).rejects.toThrow('claim_extraction_stream_segments_not_sorted');

    await writeSegments(segmentsPath, segments);
    await writeFile(providerPath, `${JSON.stringify(output(segments[0]!))}\n`);
    await expect(streamOpenAiClaimExtractionBatchImport({
      segmentsJsonlPath: segmentsPath,
      providerOutputJsonlPath: providerPath,
      candidateOutputJsonlPath: candidatePath,
      batchManifest: exported.manifest,
      temporaryDirectory: directory,
    })).rejects.toThrow('claim_extraction_batch_output_incomplete');

    await writeFile(providerPath, `${[
      output(segments[0]!),
      output(segments[0]!),
      output(segments[1]!),
      output(segments[2]!),
    ].map((value) => JSON.stringify(value)).join('\n')}\n`);
    await expect(streamOpenAiClaimExtractionBatchImport({
      segmentsJsonlPath: segmentsPath,
      providerOutputJsonlPath: providerPath,
      candidateOutputJsonlPath: candidatePath,
      batchManifest: exported.manifest,
      temporaryDirectory: directory,
    })).rejects.toThrow('claim_extraction_batch_output_invalid');

    await expect(streamOpenAiClaimExtractionBatchImport({
      segmentsJsonlPath: segmentsPath,
      providerOutputJsonlPath: providerPath,
      candidateOutputJsonlPath: providerPath,
      batchManifest: exported.manifest,
      temporaryDirectory: directory,
    })).rejects.toThrow('claim_extraction_stream_paths_conflict');
  });

  it('binds import to the exact export manifest', async () => {
    const directory = await temporaryDirectory();
    const segments = sortedSegments();
    const segmentsPath = join(directory, 'segments.jsonl');
    const providerPath = join(directory, 'provider.jsonl');
    await writeSegments(segmentsPath, segments);
    await writeFile(providerPath, `${segments.map(
      (source) => JSON.stringify(output(source)),
    ).join('\n')}\n`);
    const exported = await streamOpenAiClaimExtractionBatchExport({
      segmentsJsonlPath: segmentsPath,
      outputDirectory: join(directory, 'batch'),
    });

    await expect(streamOpenAiClaimExtractionBatchImport({
      segmentsJsonlPath: segmentsPath,
      providerOutputJsonlPath: providerPath,
      candidateOutputJsonlPath: join(directory, 'candidates.jsonl'),
      batchManifest: {
        ...exported.manifest,
        requestSetSha256: 'f'.repeat(64),
      },
    })).rejects.toThrow('claim_extraction_batch_manifest_digest_mismatch');

    const subsetPath = join(directory, 'subset.jsonl');
    await writeSegments(subsetPath, segments.slice(0, 2));
    await expect(streamOpenAiClaimExtractionBatchImport({
      segmentsJsonlPath: subsetPath,
      providerOutputJsonlPath: providerPath,
      candidateOutputJsonlPath: join(directory, 'subset-candidates.jsonl'),
      batchManifest: exported.manifest,
    })).rejects.toThrow('claim_extraction_batch_output_invalid');
  });

  it('rejects a segment file that mixes publication bindings', async () => {
    const directory = await temporaryDirectory();
    const segments = sortedSegments();
    const {
      recordType: _recordType,
      schemaVersion: _schemaVersion,
      textSha256: _textSha256,
      segmentDigest: _segmentDigest,
      ...secondDraft
    } = segments[1]!;
    const mixed = [
      segments[0]!,
      buildClaimExtractionSourceSegment({
        ...secondDraft,
        binding: { ...secondDraft.binding, manifestSha256: '9'.repeat(64) },
      }),
    ].sort((left, right) => left.segmentDigest < right.segmentDigest ? -1 : 1);
    const segmentsPath = join(directory, 'mixed.jsonl');
    await writeSegments(segmentsPath, mixed);
    await expect(streamOpenAiClaimExtractionBatchExport({
      segmentsJsonlPath: segmentsPath,
      outputDirectory: join(directory, 'batch'),
    })).rejects.toThrow('claim_extraction_stream_publication_mismatch');
  });
});
