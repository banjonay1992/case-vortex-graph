import { createHash } from 'node:crypto';

import {
  verifyCaseGraphContentAsset,
  type CaseGraphContentAsset,
} from './contentResearchArchive';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_CONTENT_SOURCE_REPLAY_VERSION =
  'case-graph-content-source-replay-v1' as const;
export const CASE_GRAPH_CONTENT_SOURCE_REPLAY_MAX_BYTES = 64 * 1024 * 1024;

export type CaseGraphContentSourceReplayReceipt = {
  recordType: 'case_graph_content_source_replay_receipt';
  schemaVersion: typeof CASE_GRAPH_CONTENT_SOURCE_REPLAY_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  nodeDigest: string;
  assetId: string;
  assetDigest: string;
  mediaKind: CaseGraphContentAsset['mediaKind'];
  contentType: string;
  byteLength: number;
  bytesSha256: string;
  servedRepresentation: 'captured_original' | 'rights_preserving_redacted';
  redactionStatus: CaseGraphContentAsset['redactionStatus'];
  rightsPolicyVersion: string;
  rightsEvidenceDigest: string;
  replayedAt: string;
  receiptDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

type ReplayableContentAsset = CaseGraphContentAsset & {
  byteLength: number;
  bytesSha256: string;
  searchableObjectKey: string;
  searchableBytesSha256: string;
};

const replayableContentAsset = (asset: CaseGraphContentAsset): ReplayableContentAsset => {
  if (asset.visibility !== 'public' || asset.terminalStatus !== 'extracted'
    || asset.byteLength === null || asset.bytesSha256 === null
    || asset.searchableObjectKey === null || asset.searchableBytesSha256 === null) {
    return fail('case_graph_content_source_replay_unavailable');
  }
  return asset as ReplayableContentAsset;
};

const exactIsoTimestamp = (value: string) => {
  if (!value.endsWith('Z')) fail('case_graph_content_source_replay_timestamp_invalid');
  try {
    if (new Date(value).toISOString() !== value) fail('case_graph_content_source_replay_timestamp_invalid');
  } catch {
    fail('case_graph_content_source_replay_timestamp_invalid');
  }
  return value;
};

export const replayCaseGraphContentSourceAsset = async (params: {
  asset: CaseGraphContentAsset;
  expectedPublication: CaseGraphResearchPublicationBinding;
  archive: Pick<CaseGraphContentImmutableArchive, 'readObject'>;
  replayedAt: string;
  maximumBytes?: number;
  signal?: AbortSignal;
}): Promise<{ bytes: Buffer; receipt: CaseGraphContentSourceReplayReceipt }> => {
  if (params.signal?.aborted) fail('case_graph_content_source_replay_aborted');
  const asset = replayableContentAsset(verifyCaseGraphContentAsset(params.asset));
  if (canonicalizeRelationshipInput(asset.publication)
    !== canonicalizeRelationshipInput(params.expectedPublication)) {
    fail('case_graph_content_source_replay_publication_mismatch');
  }
  const maximumBytes = params.maximumBytes ?? CASE_GRAPH_CONTENT_SOURCE_REPLAY_MAX_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > CASE_GRAPH_CONTENT_SOURCE_REPLAY_MAX_BYTES
    || asset.byteLength > maximumBytes) {
    fail('case_graph_content_source_replay_limit_exceeded');
  }
  const replayedAt = exactIsoTimestamp(params.replayedAt);
  const replayBytes = await params.archive.readObject(asset.searchableObjectKey, {
    maxBytes: maximumBytes,
    signal: params.signal,
  });
  if (params.signal?.aborted) fail('case_graph_content_source_replay_aborted');
  if (!replayBytes) fail('case_graph_content_source_replay_unavailable');
  const bytes = replayBytes as Buffer;
  const expectedSha256 = asset.searchableBytesSha256;
  const expectedLength = asset.redactionStatus === 'not_required' ? asset.byteLength : bytes.byteLength;
  if (bytes.byteLength !== expectedLength || sha256(bytes) !== expectedSha256) {
    fail('case_graph_content_source_replay_integrity_failed');
  }
  const core = {
    recordType: 'case_graph_content_source_replay_receipt' as const,
    schemaVersion: CASE_GRAPH_CONTENT_SOURCE_REPLAY_VERSION,
    publication: asset.publication,
    address: asset.address,
    nodeDigest: asset.nodeDigest,
    assetId: asset.assetId,
    assetDigest: asset.assetDigest,
    mediaKind: asset.mediaKind,
    contentType: asset.sniffedMimeType,
    byteLength: bytes.byteLength,
    bytesSha256: expectedSha256,
    servedRepresentation: asset.redactionStatus === 'applied'
      ? 'rights_preserving_redacted' as const
      : 'captured_original' as const,
    redactionStatus: asset.redactionStatus,
    rightsPolicyVersion: asset.rightsPolicyVersion,
    rightsEvidenceDigest: asset.rightsEvidenceDigest,
    replayedAt,
  };
  return {
    bytes,
    receipt: { ...core, receiptDigest: relationshipInputSha256(core) },
  };
};
