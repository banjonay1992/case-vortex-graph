import { describe, expect, it } from 'vitest';

import {
  buildOpenAiClaimExtractionBatchShards,
  decodeOpenAiClaimExtractionBatchOutput,
} from '../../src/caseGraph/openAiClaimExtractionBatch';
import {
  buildClaimExtractionSourceSegment,
} from '../../src/caseGraph/claimEvidenceExtraction';

const segment = (ordinal: number, text = `Witness ${ordinal} reported a light.`) => (
  buildClaimExtractionSourceSegment({
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
    text,
    locatorBase: {
      kind: 'document_page',
      pageNumber: ordinal,
      characterOffset: 0,
      boundingBox: null,
    },
    provenance: {
      assetDigest: `${ordinal}`.repeat(64),
      extractionContractDigest: '3'.repeat(64),
      extractionReceiptDigest: '4'.repeat(64),
      extractionPointerDigest: '5'.repeat(64),
    },
  })
);

const outputLine = (source: ReturnType<typeof segment>) => ({
  id: `batch-request-${source.segmentDigest}`,
  custom_id: `claim-extraction:${source.segmentDigest}`,
  response: {
    status_code: 200,
    request_id: 'req_test',
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
              subject: 'witness',
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
});

describe('OpenAI full-corpus claim extraction batch transport', () => {
  it('builds deterministic Responses JSONL shards under both request and byte limits', () => {
    const segments = [segment(3), segment(1), segment(2)];
    const first = buildOpenAiClaimExtractionBatchShards({
      segments,
      maximumRequestsPerFile: 2,
      maximumBytesPerFile: 100_000,
    });
    const second = buildOpenAiClaimExtractionBatchShards({
      segments: [...segments].reverse(),
      maximumRequestsPerFile: 2,
      maximumBytesPerFile: 100_000,
    });

    expect(first.manifest).toEqual(second.manifest);
    expect(first.shards.map(({ body }) => body)).toEqual(
      second.shards.map(({ body }) => body),
    );
    expect(first.manifest).toMatchObject({
      segmentCount: 3,
      shardCount: 2,
      modelId: 'gpt-5.6-luna',
    });
    expect(first.shards.map(({ requestCount }) => requestCount)).toEqual([2, 1]);
    for (const shard of first.shards) {
      for (const line of shard.body.toString('utf8').trim().split('\n')) {
        const request = JSON.parse(line);
        expect(request).toMatchObject({
          method: 'POST',
          url: '/v1/responses',
          body: {
            model: 'gpt-5.6-luna',
            store: false,
            text: { format: { type: 'json_schema', strict: true } },
          },
        });
      }
    }
  });

  it('maps out-of-order output by custom_id and verifies every exact quote', () => {
    const segments = [segment(1), segment(2)];
    const outputJsonl = Buffer.from([
      JSON.stringify(outputLine(segments[1]!)),
      JSON.stringify(outputLine(segments[0]!)),
      '',
    ].join('\n'));
    const decoded = decodeOpenAiClaimExtractionBatchOutput({
      segments,
      outputJsonl,
    });
    expect([...decoded.keys()]).toEqual(segments.map(({ segmentDigest }) => segmentDigest));
    expect([...decoded.values()].every((proposals) => (
      proposals.length === 1 && proposals[0]?.predicate === 'reported_light'
    ))).toBe(true);
  });

  it('rejects missing, duplicate, failed and unknown batch results', () => {
    const segments = [segment(1), segment(2)];
    const one = Buffer.from(`${JSON.stringify(outputLine(segments[0]!))}\n`);
    expect(() => decodeOpenAiClaimExtractionBatchOutput({
      segments,
      outputJsonl: one,
    })).toThrow('claim_extraction_batch_output_incomplete');

    const duplicated = Buffer.from([
      JSON.stringify(outputLine(segments[0]!)),
      JSON.stringify(outputLine(segments[0]!)),
      '',
    ].join('\n'));
    expect(() => decodeOpenAiClaimExtractionBatchOutput({
      segments: [segments[0]!],
      outputJsonl: duplicated,
    })).toThrow('claim_extraction_batch_output_invalid');

    const failed = outputLine(segments[0]!);
    failed.response.status_code = 500;
    expect(() => decodeOpenAiClaimExtractionBatchOutput({
      segments: [segments[0]!],
      outputJsonl: Buffer.from(`${JSON.stringify(failed)}\n`),
    })).toThrow('claim_extraction_batch_output_failed');

    const unknown = outputLine(segments[0]!);
    unknown.custom_id = 'claim-extraction:unknown';
    expect(() => decodeOpenAiClaimExtractionBatchOutput({
      segments: [segments[0]!],
      outputJsonl: Buffer.from(`${JSON.stringify(unknown)}\n`),
    })).toThrow('claim_extraction_batch_output_invalid');
  });

  it('rejects duplicate source segments and a request larger than its shard budget', () => {
    const one = segment(1);
    expect(() => buildOpenAiClaimExtractionBatchShards({
      segments: [one, one],
    })).toThrow('claim_extraction_batch_segment_duplicate');
    expect(() => buildOpenAiClaimExtractionBatchShards({
      segments: [segment(2, 'x'.repeat(20_000))],
      maximumBytesPerFile: 1_000,
    })).toThrow('claim_extraction_batch_request_too_large');
  });
});
