import { createHash } from 'node:crypto';

import {
  verifyClaimExtractionSourceSegment,
  type ClaimExtractionProposalDraft,
  type ClaimExtractionSourceSegment,
} from './claimEvidenceExtraction';
import {
  buildOpenAiClaimExtractionRequestBody,
  decodeOpenAiClaimExtractionResponseBody,
  OPENAI_CLAIM_EXTRACTION_MODEL,
  OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST,
} from './openAiClaimExtractionProposer';
import type { ClaimEvidencePublicationBinding } from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const OPENAI_CLAIM_EXTRACTION_BATCH_VERSION =
  'case-graph-openai-claim-extraction-batch-v1' as const;
export const OPENAI_CLAIM_EXTRACTION_BATCH_POLICY = Object.freeze({
  endpoint: '/v1/responses',
  completionWindow: '24h',
  providerMaximumRequestsPerFile: 50_000,
  providerMaximumBytesPerFile: 200_000_000,
  safeMaximumRequestsPerFile: 40_000,
  safeMaximumBytesPerFile: 190_000_000,
} as const);

export type OpenAiClaimExtractionBatchShard = {
  ordinal: number;
  requestCount: number;
  byteLength: number;
  sha256: string;
  firstCustomId: string;
  lastCustomId: string;
  body: Buffer;
};

export type OpenAiClaimExtractionBatchManifest = {
  recordType: 'case_graph_openai_claim_extraction_batch_manifest';
  schemaVersion: typeof OPENAI_CLAIM_EXTRACTION_BATCH_VERSION;
  binding: ClaimEvidencePublicationBinding;
  modelId: string;
  promptDigest: string;
  segmentCount: number;
  shardCount: number;
  requestSetSha256: string;
  shards: Array<Omit<OpenAiClaimExtractionBatchShard, 'body'>>;
  policy: typeof OPENAI_CLAIM_EXTRACTION_BATCH_POLICY;
  manifestSha256: string;
};

const fail = (code: string): never => { throw new Error(code); };
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/u;
const CUSTOM_ID = /^claim-extraction:[a-f0-9]{64}$/u;
export const openAiClaimExtractionBatchCustomId = (segmentDigest: string) => (
  `claim-extraction:${segmentDigest}`
);

export const verifyOpenAiClaimExtractionBatchManifest = (
  value: OpenAiClaimExtractionBatchManifest,
): OpenAiClaimExtractionBatchManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.recordType !== 'case_graph_openai_claim_extraction_batch_manifest'
    || value.schemaVersion !== OPENAI_CLAIM_EXTRACTION_BATCH_VERSION
    || !value.binding || typeof value.binding !== 'object'
    || typeof value.modelId !== 'string' || !value.modelId.length
    || value.promptDigest !== OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST
    || !Number.isSafeInteger(value.segmentCount) || value.segmentCount < 0
    || !Number.isSafeInteger(value.shardCount) || value.shardCount < 0
    || value.shardCount !== value.shards?.length
    || !SHA256.test(value.requestSetSha256)
    || !SHA256.test(value.manifestSha256)
    || canonicalizeRelationshipInput(value.policy)
      !== canonicalizeRelationshipInput(OPENAI_CLAIM_EXTRACTION_BATCH_POLICY)) {
    fail('claim_extraction_batch_manifest_invalid');
  }
  let requestCount = 0;
  for (const [ordinal, shard] of value.shards.entries()) {
    if (shard.ordinal !== ordinal
      || !Number.isSafeInteger(shard.requestCount) || shard.requestCount < 1
      || !Number.isSafeInteger(shard.byteLength) || shard.byteLength < 1
      || shard.byteLength > OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.providerMaximumBytesPerFile
      || shard.requestCount
        > OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.providerMaximumRequestsPerFile
      || !SHA256.test(shard.sha256)
      || !CUSTOM_ID.test(shard.firstCustomId)
      || !CUSTOM_ID.test(shard.lastCustomId)
      || shard.firstCustomId > shard.lastCustomId) {
      fail('claim_extraction_batch_manifest_invalid');
    }
    requestCount += shard.requestCount;
  }
  if (requestCount !== value.segmentCount
    || (value.segmentCount === 0) !== (value.shardCount === 0)) {
    fail('claim_extraction_batch_manifest_invalid');
  }
  const { manifestSha256, ...core } = value;
  if (relationshipInputSha256(core) !== manifestSha256) {
    fail('claim_extraction_batch_manifest_digest_mismatch');
  }
  return value;
};

export const buildOpenAiClaimExtractionBatchRequestLine = (
  segment: ClaimExtractionSourceSegment,
  modelId: string,
) => Buffer.from(
  `${JSON.stringify({
    custom_id: openAiClaimExtractionBatchCustomId(segment.segmentDigest),
    method: 'POST',
    url: OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.endpoint,
    body: buildOpenAiClaimExtractionRequestBody(segment, modelId),
  })}\n`,
  'utf8',
);

export const buildOpenAiClaimExtractionBatchShards = (params: {
  segments: ClaimExtractionSourceSegment[];
  modelId?: string;
  maximumRequestsPerFile?: number;
  maximumBytesPerFile?: number;
}): {
  manifest: OpenAiClaimExtractionBatchManifest;
  shards: OpenAiClaimExtractionBatchShard[];
} => {
  const modelId = params.modelId ?? OPENAI_CLAIM_EXTRACTION_MODEL;
  const maximumRequestsPerFile = params.maximumRequestsPerFile
    ?? OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.safeMaximumRequestsPerFile;
  const maximumBytesPerFile = params.maximumBytesPerFile
    ?? OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.safeMaximumBytesPerFile;
  if (!Number.isSafeInteger(maximumRequestsPerFile) || maximumRequestsPerFile < 1
    || maximumRequestsPerFile
      > OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.providerMaximumRequestsPerFile
    || !Number.isSafeInteger(maximumBytesPerFile) || maximumBytesPerFile < 1
    || maximumBytesPerFile
      > OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.providerMaximumBytesPerFile) {
    fail('claim_extraction_batch_limits_invalid');
  }
  const segments = params.segments.map(verifyClaimExtractionSourceSegment)
    .sort((left, right) => left.segmentDigest < right.segmentDigest ? -1 : 1);
  if (!segments.length
    || new Set(segments.map(({ segmentDigest }) => segmentDigest)).size !== segments.length
    || segments.some((segment) => canonicalizeRelationshipInput(segment.binding)
      !== canonicalizeRelationshipInput(segments[0]!.binding))) {
    fail('claim_extraction_batch_segment_duplicate');
  }
  const shards: OpenAiClaimExtractionBatchShard[] = [];
  let lines: Buffer[] = [];
  let size = 0;
  const flush = () => {
    if (!lines.length) return;
    const body = Buffer.concat(lines, size);
    const ids = body.toString('utf8').trimEnd().split('\n')
      .map((line) => String((JSON.parse(line) as { custom_id: unknown }).custom_id));
    shards.push({
      ordinal: shards.length,
      requestCount: lines.length,
      byteLength: body.byteLength,
      sha256: sha256(body),
      firstCustomId: ids[0]!,
      lastCustomId: ids.at(-1)!,
      body,
    });
    lines = [];
    size = 0;
  };
  for (const segment of segments) {
    const line = buildOpenAiClaimExtractionBatchRequestLine(segment, modelId);
    if (line.byteLength > maximumBytesPerFile) {
      fail('claim_extraction_batch_request_too_large');
    }
    if (lines.length >= maximumRequestsPerFile
      || size + line.byteLength > maximumBytesPerFile) flush();
    lines.push(line);
    size += line.byteLength;
  }
  flush();
  const shardEvidence = shards.map(({ body: _body, ...shard }) => shard);
  const core = {
    recordType: 'case_graph_openai_claim_extraction_batch_manifest' as const,
    schemaVersion: OPENAI_CLAIM_EXTRACTION_BATCH_VERSION,
    binding: segments[0]!.binding,
    modelId,
    promptDigest: OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST,
    segmentCount: segments.length,
    shardCount: shards.length,
    requestSetSha256: relationshipInputSha256(
      segments.map(({ segmentDigest }) => segmentDigest),
    ),
    shards: shardEvidence,
    policy: OPENAI_CLAIM_EXTRACTION_BATCH_POLICY,
  };
  return {
    shards,
    manifest: { ...core, manifestSha256: relationshipInputSha256(core) },
  };
};

export const decodeOpenAiClaimExtractionBatchOutput = (params: {
  segments: ClaimExtractionSourceSegment[];
  outputJsonl: Buffer;
}): Map<string, ClaimExtractionProposalDraft[]> => {
  const segments = params.segments.map(verifyClaimExtractionSourceSegment);
  const byCustomId = new Map(segments.map((segment) => [
    openAiClaimExtractionBatchCustomId(segment.segmentDigest),
    segment,
  ]));
  if (byCustomId.size !== segments.length) fail('claim_extraction_batch_segment_duplicate');
  const decoded = new Map<string, ClaimExtractionProposalDraft[]>();
  const text = params.outputJsonl.toString('utf8');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length === 1 && !lines[0]) return segments.length
    ? fail('claim_extraction_batch_output_incomplete')
    : decoded;
  for (const line of lines) {
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      value = parsed as Record<string, unknown>;
    } catch {
      return fail('claim_extraction_batch_output_invalid');
    }
    const id = typeof value.custom_id === 'string' ? value.custom_id : '';
    const segment = byCustomId.get(id);
    if (!segment || decoded.has(id) || value.error != null
      || !value.response || typeof value.response !== 'object'
      || Array.isArray(value.response)) {
      fail('claim_extraction_batch_output_invalid');
    }
    const boundSegment = segment as ClaimExtractionSourceSegment;
    const response = value.response as Record<string, unknown>;
    if (response.status_code !== 200
      || !response.body || typeof response.body !== 'object'
      || Array.isArray(response.body)) {
      fail('claim_extraction_batch_output_failed');
    }
    decoded.set(id, decodeOpenAiClaimExtractionResponseBody(
      response.body as Record<string, unknown>,
      boundSegment,
    ));
  }
  if (decoded.size !== segments.length) fail('claim_extraction_batch_output_incomplete');
  return new Map(segments.map((segment) => [
    segment.segmentDigest,
    decoded.get(openAiClaimExtractionBatchCustomId(segment.segmentDigest))!,
  ]));
};
