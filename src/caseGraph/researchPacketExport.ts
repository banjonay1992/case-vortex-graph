import {
  CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE,
  CASE_GRAPH_RESEARCH_LIMITS,
  CASE_GRAPH_RESEARCH_TOOL_VERSION,
  verifyCaseGraphResearchToolResult,
  type CaseGraphResearchToolResult,
} from './researchToolContract';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CASE_GRAPH_RESEARCH_PACKET_EXPORT_VERSION =
  'case-graph-research-packet-export-v1' as const;
export const CASE_GRAPH_RESEARCH_PACKET_MEDIA_TYPE =
  'application/vnd.uapfiles.case-vortex-research-packet+json' as const;
export const CASE_GRAPH_RESEARCH_PACKET_MAX_BYTES = 16 * 1024 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type JsonObject = Record<string, unknown>;

export type CaseGraphResearchPacketExport = {
  recordType: 'case_graph_research_packet_export';
  schemaVersion: typeof CASE_GRAPH_RESEARCH_PACKET_EXPORT_VERSION;
  mediaType: typeof CASE_GRAPH_RESEARCH_PACKET_MEDIA_TYPE;
  fileName: string;
  createdAt: string;
  publicationBindingSha256: string;
  toolResult: CaseGraphResearchToolResult;
  replay: {
    toolSchemaVersion: typeof CASE_GRAPH_RESEARCH_TOOL_VERSION;
    requestDigest: string;
    resultDigest: string;
    canonicalization: 'relationship-input-canonical-json-v1';
    claimDiscipline: typeof CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE;
    integrityScope: 'packet_bytes_and_publication_binding_not_source_availability_or_origin_authenticity';
  };
  exportDigest: string;
};

const invalid = (code: string): never => {
  throw new Error(code);
};

const objectValue = (value: unknown, code: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as JsonObject;
};

const exactKeys = (value: JsonObject, keys: readonly string[], code: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
};

const exactIsoTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) {
    invalid('case_graph_research_packet_export_timestamp_invalid');
  }
  const timestamp = value as string;
  try {
    if (new Date(timestamp).toISOString() !== timestamp) invalid('case_graph_research_packet_export_timestamp_invalid');
  } catch {
    invalid('case_graph_research_packet_export_timestamp_invalid');
  }
  return timestamp;
};

const packetData = (result: CaseGraphResearchToolResult) => {
  if (result.tool !== 'build_evidence_packet' || result.request.tool !== 'build_evidence_packet') {
    return invalid('case_graph_research_packet_export_tool_invalid');
  }
  const data = objectValue(result.data, 'case_graph_research_packet_export_data_invalid');
  exactKeys(data, [
    'recordType', 'schemaVersion', 'question', 'answer', 'answerStatus',
    'records', 'statusReceipts', 'relationships', 'candidateEvaluations',
    'unresolved', 'reproducibility',
  ], 'case_graph_research_packet_export_data_invalid');
  if (data.recordType !== 'case_graph_research_evidence_packet'
    || data.schemaVersion !== CASE_GRAPH_RESEARCH_TOOL_VERSION
    || data.question !== result.request.question
    || data.answer !== null
    || data.answerStatus !== 'evidence_packet_only_human_or_grounded_agent_conclusion_required'
    || canonicalizeRelationshipInput(data.reproducibility) !== canonicalizeRelationshipInput(result.publication)) {
    invalid('case_graph_research_packet_export_data_invalid');
  }
  if (!Array.isArray(data.records)
    || !Array.isArray(data.statusReceipts)
    || !Array.isArray(data.relationships)
    || !Array.isArray(data.candidateEvaluations)) {
    invalid('case_graph_research_packet_export_data_invalid');
  }
  const records = data.records as unknown[];
  const statusReceipts = data.statusReceipts as unknown[];
  const relationships = data.relationships as unknown[];
  const candidateEvaluations = data.candidateEvaluations as unknown[];
  if (records.length !== result.request.addresses.length
    || statusReceipts.length !== records.length
    || records.length > CASE_GRAPH_RESEARCH_LIMITS.packetRecords
    || relationships.length > CASE_GRAPH_RESEARCH_LIMITS.packetEdges
    || candidateEvaluations.length > CASE_GRAPH_RESEARCH_LIMITS.packetEvaluations) {
    invalid('case_graph_research_packet_export_data_invalid');
  }
  const requested = new Set(result.request.addresses);
  const observed = new Set<string>();
  for (const value of records) {
    const record = objectValue(value, 'case_graph_research_packet_export_data_invalid');
    if (record.recordType !== 'full_corpus_public_node'
      || typeof record.address !== 'string'
      || !requested.has(record.address)
      || typeof record.nodeDigest !== 'string'
      || !SHA256.test(record.nodeDigest)) {
      invalid('case_graph_research_packet_export_data_invalid');
    }
    observed.add(record.address as string);
  }
  if (observed.size !== requested.size || [...requested].some((address) => !observed.has(address))) {
    invalid('case_graph_research_packet_export_data_invalid');
  }
  return data;
};

const safeFilePart = (value: string) => {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return sanitized || 'publication';
};

export const makeCaseGraphResearchPacketExport = (params: {
  toolResult: CaseGraphResearchToolResult;
  createdAt: string;
}): CaseGraphResearchPacketExport => {
  const toolResult = verifyCaseGraphResearchToolResult(params.toolResult);
  packetData(toolResult);
  const createdAt = exactIsoTimestamp(params.createdAt);
  const publicationBindingSha256 = relationshipInputSha256(toolResult.publication);
  const core = {
    recordType: 'case_graph_research_packet_export' as const,
    schemaVersion: CASE_GRAPH_RESEARCH_PACKET_EXPORT_VERSION,
    mediaType: CASE_GRAPH_RESEARCH_PACKET_MEDIA_TYPE,
    createdAt,
    publicationBindingSha256,
    toolResult,
    replay: {
      toolSchemaVersion: CASE_GRAPH_RESEARCH_TOOL_VERSION,
      requestDigest: toolResult.requestDigest,
      resultDigest: toolResult.resultDigest,
      canonicalization: 'relationship-input-canonical-json-v1' as const,
      claimDiscipline: CASE_GRAPH_RESEARCH_CLAIM_DISCIPLINE,
      integrityScope: 'packet_bytes_and_publication_binding_not_source_availability_or_origin_authenticity' as const,
    },
  };
  const exportDigest = relationshipInputSha256(core);
  const fileName = `case-vortex-${safeFilePart(toolResult.publication.publicationId)}-${exportDigest.slice(0, 16)}.json`;
  const withoutDigest = { ...core, fileName };
  return { ...withoutDigest, exportDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphResearchPacketExport = (value: CaseGraphResearchPacketExport) => {
  const object = objectValue(value, 'case_graph_research_packet_export_invalid');
  exactKeys(object, [
    'recordType', 'schemaVersion', 'mediaType', 'fileName', 'createdAt',
    'publicationBindingSha256', 'toolResult', 'replay', 'exportDigest',
  ], 'case_graph_research_packet_export_invalid');
  if (value.recordType !== 'case_graph_research_packet_export'
    || value.schemaVersion !== CASE_GRAPH_RESEARCH_PACKET_EXPORT_VERSION
    || value.mediaType !== CASE_GRAPH_RESEARCH_PACKET_MEDIA_TYPE) {
    invalid('case_graph_research_packet_export_invalid');
  }
  const expected = makeCaseGraphResearchPacketExport({
    toolResult: value.toolResult,
    createdAt: value.createdAt,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('case_graph_research_packet_export_integrity_failed');
  }
  return expected;
};

export const serializeCaseGraphResearchPacketExport = (value: CaseGraphResearchPacketExport) => {
  const verified = verifyCaseGraphResearchPacketExport(value);
  const bytes = Buffer.from(`${canonicalizeRelationshipInput(verified)}\n`, 'utf8');
  if (bytes.byteLength > CASE_GRAPH_RESEARCH_PACKET_MAX_BYTES) {
    invalid('case_graph_research_packet_export_too_large');
  }
  return bytes;
};

export const parseCaseGraphResearchPacketExport = (value: Buffer | string) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  if (bytes.byteLength < 2 || bytes.byteLength > CASE_GRAPH_RESEARCH_PACKET_MAX_BYTES) {
    invalid('case_graph_research_packet_export_bytes_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    invalid('case_graph_research_packet_export_bytes_invalid');
  }
  return verifyCaseGraphResearchPacketExport(parsed as CaseGraphResearchPacketExport);
};
