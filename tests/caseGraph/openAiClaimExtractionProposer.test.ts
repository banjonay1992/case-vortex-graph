import { describe, expect, it, vi } from 'vitest';

import {
  createOpenAiClaimExtractionProposer,
  OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST,
  OPENAI_CLAIM_EXTRACTION_PROPOSER_VERSION,
} from '../../src/caseGraph/openAiClaimExtractionProposer';
import {
  CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
} from '../../src/caseGraph/claimEvidenceExtractionRunner';
import type {
  ClaimExtractionSourceSegment,
} from '../../src/caseGraph/claimEvidenceExtraction';

const segment: ClaimExtractionSourceSegment = {
  recordType: 'case_graph_claim_source_segment',
  schemaVersion: 'case-graph-claim-extraction-v1',
  binding: {
    publicationId: '00000000-0000-4000-8000-000000000001',
    corpusVersion: 'v1',
    manifestSha256: '1'.repeat(64),
    snapshotId: 'snapshot',
    graphArtifactSetSha256: '2'.repeat(64),
  },
  address: 'document:one',
  sourceId: 'source_one',
  sourceLabel: 'Source One',
  lineageId: 'lineage_one',
  mediaKind: 'document',
  textOrigin: 'embedded_text',
  text: 'A witness reported a blue light. The report denied seeing an aircraft.',
  textSha256: '3'.repeat(64),
  locatorBase: {
    kind: 'document_page',
    pageNumber: 1,
    characterOffset: 0,
    boundingBox: null,
  },
  provenance: {
    assetDigest: '4'.repeat(64),
    extractionContractDigest: '5'.repeat(64),
    extractionReceiptDigest: '6'.repeat(64),
    extractionPointerDigest: '7'.repeat(64),
  },
  segmentDigest: '8'.repeat(64),
};

const providerResponse = (output: unknown, overrides: Record<string, unknown> = {}) => new Response(
  JSON.stringify({
    id: 'resp_test',
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(output) }],
    }],
    ...overrides,
  }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

const proposal = {
  quoteStart: 0,
  quoteEnd: 32,
  quote: 'A witness reported a blue light.',
  subject: 'a witness',
  predicate: 'reported_light',
  object: 'a blue light',
  polarity: 'asserted',
  modality: 'reported',
  confidence: 0.91,
};

describe('OpenAI claim extraction proposer', () => {
  it('uses non-stored strict Responses output and converts exact quotes into governed drafts', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => providerResponse({
      proposals: [proposal],
    }));
    const proposer = createOpenAiClaimExtractionProposer({
      apiKey: 'secret',
      fetchImpl,
    });

    const result = await proposer.propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    });

    expect(proposer).toMatchObject({
      providerId: 'openai_responses',
      modelId: 'gpt-5.6-luna',
      modelRevision: 'gpt-5.6-luna',
      promptDigest: OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST,
    });
    expect(result).toEqual([{
      segmentDigest: segment.segmentDigest,
      quoteStart: 0,
      quoteEnd: 32,
      subject: 'a witness',
      predicate: 'reported_light',
      object: 'a blue light',
      polarity: 'asserted',
      modality: 'reported',
      extraction: {
        method: 'governed_model',
        version: OPENAI_CLAIM_EXTRACTION_PROPOSER_VERSION,
        confidence: 0.91,
      },
    }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject({
      model: 'gpt-5.6-luna',
      store: false,
      reasoning: { effort: 'low' },
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          name: 'case_graph_claim_extraction_proposals',
        },
      },
    });
    expect(request.input[0].content[0].text).toContain(segment.text);
    expect(request.input[0].content[0].text).toContain('untrusted_claim_extraction_source');
  });

  it('accepts an explicit empty proposal set without inventing a claim', async () => {
    const proposer = createOpenAiClaimExtractionProposer({
      apiKey: 'secret',
      fetchImpl: vi.fn(async () => providerResponse({ proposals: [] })),
    });
    await expect(proposer.propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    })).resolves.toEqual([]);
  });

  it('derives offsets only when the model quote is an exact unique source span', async () => {
    const proposer = createOpenAiClaimExtractionProposer({
      apiKey: 'secret',
      fetchImpl: vi.fn(async () => providerResponse({
        proposals: [{
          ...proposal,
          quoteStart: 2,
          quoteEnd: 10,
        }],
      })),
    });
    const result = await proposer.propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    });
    expect(result[0]).toMatchObject({ quoteStart: 0, quoteEnd: 32 });

    const repeatedSegment = {
      ...segment,
      text: `${proposal.quote} ${proposal.quote}`,
    };
    await expect(proposer.propose({
      segment: repeatedSegment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    })).rejects.toThrow('claim_extraction_provider_quote_invalid');
  });

  it('fails closed on quote drift, extra fields, duplicates, refusal and incomplete output', async () => {
    const run = async (response: Response) => createOpenAiClaimExtractionProposer({
      apiKey: 'secret',
      fetchImpl: vi.fn(async () => response),
    }).propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    });

    await expect(run(providerResponse({
      proposals: [{ ...proposal, quote: 'a different quote' }],
    }))).rejects.toThrow('claim_extraction_provider_quote_invalid');
    await expect(run(providerResponse({
      proposals: [{ ...proposal, surprise: true }],
    }))).rejects.toThrow('claim_extraction_provider_output_invalid');
    await expect(run(providerResponse({
      proposals: [proposal, proposal],
    }))).rejects.toThrow('claim_extraction_provider_output_duplicate');
    await expect(run(new Response(JSON.stringify({
      status: 'completed',
      output: [{
        type: 'message',
        content: [{ type: 'refusal', refusal: 'no' }],
      }],
    }), { status: 200 }))).rejects.toThrow('claim_extraction_provider_refused');
    await expect(run(providerResponse(
      { proposals: [] },
      { status: 'incomplete' },
    ))).rejects.toThrow('claim_extraction_provider_incomplete');
  });

  it('fails closed on provider errors, oversized output, abort and a changed boundary', async () => {
    const failed = createOpenAiClaimExtractionProposer({
      apiKey: 'secret',
      fetchImpl: vi.fn(async () => new Response('failed', { status: 500 })),
    });
    await expect(failed.propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    })).rejects.toThrow('claim_extraction_provider_failed');

    const oversized = createOpenAiClaimExtractionProposer({
      apiKey: 'secret',
      fetchImpl: vi.fn(async () => new Response('{}', {
        status: 200,
        headers: { 'content-length': String(300 * 1024) },
      })),
    });
    await expect(oversized.propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
    })).rejects.toThrow('claim_extraction_provider_response_too_large');

    const controller = new AbortController();
    controller.abort();
    await expect(failed.propose({
      segment,
      securityBoundary: CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
      signal: controller.signal,
    })).rejects.toThrow('claim_extraction_provider_aborted');
    await expect(failed.propose({
      segment,
      securityBoundary: {
        ...CLAIM_EXTRACTION_MODEL_SECURITY_BOUNDARY,
      },
    })).rejects.toThrow('claim_extraction_provider_security_boundary_invalid');
  });
});
