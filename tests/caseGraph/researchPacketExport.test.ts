import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_RESEARCH_PACKET_MAX_BYTES,
  CASE_GRAPH_RESEARCH_PACKET_MEDIA_TYPE,
  makeCaseGraphResearchPacketExport,
  parseCaseGraphResearchPacketExport,
  serializeCaseGraphResearchPacketExport,
  verifyCaseGraphResearchPacketExport,
} from '../../src/caseGraph/researchPacketExport';
import {
  CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE,
  CASE_GRAPH_RESEARCH_TOOL_VERSION,
  type CaseGraphResearchPublicationBinding,
  type CaseGraphResearchToolRequest,
  type CaseGraphResearchToolResult,
} from '../../src/caseGraph/researchToolContract';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const digest = (character: string) => character.repeat(64);
const address = 'document:00000000-0000-4000-8000-000000000020';

const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'verified-v2-test',
  manifestSha256: digest('1'),
  snapshotId: 'snapshot-test',
  graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'typed-relationships-test',
  relationshipPolicyVersion: 'policy-test',
  relationshipPolicySha256: digest('3'),
  relationshipModelId: 'model-test',
  relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};

const request: Extract<CaseGraphResearchToolRequest, { tool: 'build_evidence_packet' }> = {
  tool: 'build_evidence_packet',
  question: 'What public evidence supports the reported date?',
  addresses: [address],
  edgeIds: [],
};

const data = (overrides: Record<string, unknown> = {}) => ({
  recordType: 'case_graph_research_evidence_packet',
  schemaVersion: CASE_GRAPH_RESEARCH_TOOL_VERSION,
  question: request.question,
  answer: null,
  answerStatus: 'evidence_packet_only_human_or_grounded_agent_conclusion_required',
  records: [{
    recordType: 'full_corpus_public_node',
    address,
    nodeDigest: digest('6'),
  }],
  statusReceipts: [{ receiptDigest: digest('7') }],
  relationships: [],
  candidateEvaluations: [],
  unresolved: {
    candidateEvaluationReceiptsTruncated: false,
    omittedCandidateEvaluationCount: 0,
  },
  reproducibility: publication,
  ...overrides,
});

const result = (packetData = data(), packetRequest: CaseGraphResearchToolRequest = request) => {
  const withoutDigest = {
    recordType: 'case_graph_research_tool_result' as const,
    schemaVersion: CASE_GRAPH_RESEARCH_TOOL_VERSION,
    tool: packetRequest.tool,
    publication,
    request: packetRequest,
    requestDigest: relationshipInputSha256(packetRequest),
    claimDiscipline: CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE,
    data: packetData,
    warnings: [],
  };
  return { ...withoutDigest, resultDigest: relationshipInputSha256(withoutDigest) } as CaseGraphResearchToolResult;
};

describe('offline Case Vortex research-packet export', () => {
  it('serializes and parses an exact publication-bound packet with replay receipts', () => {
    const packet = makeCaseGraphResearchPacketExport({
      toolResult: result(),
      createdAt: '2026-07-18T20:15:00.000Z',
    });
    const serialized = serializeCaseGraphResearchPacketExport(packet);
    const parsed = parseCaseGraphResearchPacketExport(serialized);

    expect(parsed).toEqual(packet);
    expect(packet.mediaType).toBe(CASE_GRAPH_RESEARCH_PACKET_MEDIA_TYPE);
    expect(packet.fileName).toMatch(/^case-vortex-[a-z0-9._-]+-[a-f0-9]{16}\.json$/);
    expect(packet.publicationBindingSha256).toBe(relationshipInputSha256(publication));
    expect(packet.replay).toMatchObject({
      requestDigest: result().requestDigest,
      resultDigest: result().resultDigest,
      integrityScope: 'packet_bytes_and_publication_binding_not_source_availability_or_origin_authenticity',
    });
    expect(serialized.at(-1)).toBe(10);
  });

  it('is byte deterministic for the same packet and timestamp', () => {
    const first = makeCaseGraphResearchPacketExport({
      toolResult: result(),
      createdAt: '2026-07-18T20:15:00.000Z',
    });
    const second = makeCaseGraphResearchPacketExport({
      toolResult: result(),
      createdAt: '2026-07-18T20:15:00.000Z',
    });

    expect(first.exportDigest).toBe(second.exportDigest);
    expect(serializeCaseGraphResearchPacketExport(first))
      .toEqual(serializeCaseGraphResearchPacketExport(second));
  });

  it('rejects tampering even when the outer object still resembles an export', () => {
    const packet = makeCaseGraphResearchPacketExport({
      toolResult: result(),
      createdAt: '2026-07-18T20:15:00.000Z',
    });
    const tampered = {
      ...packet,
      replay: { ...packet.replay, resultDigest: digest('f') },
    };

    expect(() => verifyCaseGraphResearchPacketExport(tampered))
      .toThrow('case_graph_research_packet_export_integrity_failed');
  });

  it('rejects non-packet tools and packet records outside the request scope', () => {
    const openRequest: CaseGraphResearchToolRequest = { tool: 'open_record', address };
    expect(() => makeCaseGraphResearchPacketExport({
      toolResult: result({ recordType: 'open_record_result' }, openRequest),
      createdAt: '2026-07-18T20:15:00.000Z',
    })).toThrow('case_graph_research_packet_export_tool_invalid');

    const otherAddress = 'document:00000000-0000-4000-8000-000000000021';
    expect(() => makeCaseGraphResearchPacketExport({
      toolResult: result(data({
        records: [{ recordType: 'full_corpus_public_node', address: otherAddress, nodeDigest: digest('6') }],
      })),
      createdAt: '2026-07-18T20:15:00.000Z',
    })).toThrow('case_graph_research_packet_export_data_invalid');
  });

  it('rejects non-canonical timestamps and malformed or oversized bytes', () => {
    expect(() => makeCaseGraphResearchPacketExport({
      toolResult: result(),
      createdAt: '2026-07-18',
    })).toThrow('case_graph_research_packet_export_timestamp_invalid');

    expect(() => parseCaseGraphResearchPacketExport('{not json'))
      .toThrow('case_graph_research_packet_export_bytes_invalid');
    expect(() => parseCaseGraphResearchPacketExport(Buffer.alloc(CASE_GRAPH_RESEARCH_PACKET_MAX_BYTES + 1)))
      .toThrow('case_graph_research_packet_export_bytes_invalid');
  });
});
