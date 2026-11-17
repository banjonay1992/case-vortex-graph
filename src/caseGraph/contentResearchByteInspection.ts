import { createHash } from 'node:crypto';

import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type {
  CaseGraphContentDiscoveryRecord,
  CaseGraphContentLimitsProfile,
  CaseGraphContentMediaKind,
} from './contentResearchArchive';
import type { CaseGraphContentProcessedAsset } from './contentResearchMaterialization';

export const CASE_GRAPH_CONTENT_BYTE_INSPECTION_POLICY = Object.freeze({
  version: 'case-graph-content-byte-inspection-v1',
  safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
} as const);

export type CaseGraphContentSniffedType = {
  mimeType: string;
  mediaKind: CaseGraphContentMediaKind;
};

export type CaseGraphContentStructuralProbe = (params: {
  rawBytes: Buffer;
  sniffed: CaseGraphContentSniffedType;
  limitsProfile: CaseGraphContentLimitsProfile;
  signal?: AbortSignal;
}) => Promise<
  | {
    status: 'ready';
    pageCount: number | null;
    imageWidth: number | null;
    imageHeight: number | null;
    durationMs: number | null;
  }
  | {
    status: 'terminal';
    terminalStatus: 'unsupported' | 'encrypted' | 'corrupt' | 'quarantined' | 'oversized';
    reason: string;
  }
>;

const startsWith = (body: Buffer, signature: number[]) => (
  body.byteLength >= signature.length
  && signature.every((value, index) => body[index] === value)
);

const ascii = (body: Buffer, start: number, length: number) => (
  body.byteLength >= start + length ? body.subarray(start, start + length).toString('ascii') : ''
);

export const sniffCaseGraphContentType = (body: Buffer): CaseGraphContentSniffedType | null => {
  if (!Buffer.isBuffer(body) || body.byteLength < 4) return null;
  if (ascii(body, 0, 5) === '%PDF-') return { mimeType: 'application/pdf', mediaKind: 'document' };
  if (startsWith(body, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', mediaKind: 'image' };
  if (startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', mediaKind: 'image' };
  }
  if (ascii(body, 0, 4) === 'GIF8') return { mimeType: 'image/gif', mediaKind: 'image' };
  if (ascii(body, 0, 4) === 'RIFF' && ascii(body, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', mediaKind: 'image' };
  }
  if (startsWith(body, [0x49, 0x49, 0x2a, 0x00]) || startsWith(body, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { mimeType: 'image/tiff', mediaKind: 'image' };
  }
  if (ascii(body, 0, 4) === 'RIFF' && ascii(body, 8, 4) === 'WAVE') {
    return { mimeType: 'audio/wav', mediaKind: 'audio' };
  }
  if (ascii(body, 0, 4) === 'OggS') return { mimeType: 'audio/ogg', mediaKind: 'audio' };
  if (ascii(body, 0, 3) === 'ID3' || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0)) {
    return { mimeType: 'audio/mpeg', mediaKind: 'audio' };
  }
  if (ascii(body, 4, 4) === 'ftyp') {
    const brand = ascii(body, 8, 4).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'].includes(brand)) {
      return { mimeType: brand === 'avif' ? 'image/avif' : 'image/heic', mediaKind: 'image' };
    }
    return { mimeType: 'video/mp4', mediaKind: 'video' };
  }
  if (startsWith(body, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { mimeType: 'video/webm', mediaKind: 'video' };
  }
  return null;
};

const terminal = (
  terminalStatus: 'unsupported' | 'encrypted' | 'corrupt' | 'quarantined' | 'oversized',
  terminalReason: string,
  sniffedMimeType: string,
  redactionPolicyDigest: string,
  safetyScanDigest: string,
): CaseGraphContentProcessedAsset => ({
  status: 'terminal',
  terminalStatus,
  terminalReason,
  sniffedMimeType,
  safetyPolicyVersion: CASE_GRAPH_CONTENT_BYTE_INSPECTION_POLICY.safetyPolicyVersion,
  safetyScanDigest,
  redactionPolicyDigest,
});

export const inspectCaseGraphContentBytes = async (params: {
  record: CaseGraphContentDiscoveryRecord;
  rawBytes: Buffer;
  responseMimeType: string;
  limitsProfile: CaseGraphContentLimitsProfile;
  structuralProbe: CaseGraphContentStructuralProbe;
  redactionPolicyDigest: string;
  signal?: AbortSignal;
}): Promise<CaseGraphContentProcessedAsset> => {
  if (params.signal?.aborted) throw new Error('case_graph_content_byte_inspection_aborted');
  const bytesSha256 = createHash('sha256').update(params.rawBytes).digest('hex');
  const sniffed = sniffCaseGraphContentType(params.rawBytes);
  const baseAudit = {
    policyVersion: CASE_GRAPH_CONTENT_BYTE_INSPECTION_POLICY.version,
    address: params.record.address,
    discoveryDigest: params.record.discoveryDigest,
    bytesSha256,
    byteLength: params.rawBytes.byteLength,
    responseMimeType: params.responseMimeType,
    sniffed,
  };
  if (!sniffed) {
    return terminal('unsupported', 'captured bytes have no supported deterministic file signature',
      'application/octet-stream', params.redactionPolicyDigest,
      relationshipInputSha256({ ...baseAudit, decision: 'unsupported_signature' }));
  }
  if (sniffed.mediaKind !== params.record.mediaKind) {
    return terminal('quarantined',
      `captured ${sniffed.mediaKind} bytes do not match discovery kind ${params.record.mediaKind}`,
      sniffed.mimeType, params.redactionPolicyDigest,
      relationshipInputSha256({ ...baseAudit, decision: 'media_kind_mismatch' }));
  }
  if (params.rawBytes.byteLength > params.limitsProfile.maxAssetBytes) {
    return terminal('oversized', 'captured bytes exceed the approved asset limit', sniffed.mimeType,
      params.redactionPolicyDigest, relationshipInputSha256({ ...baseAudit, decision: 'oversized' }));
  }
  const probed = await params.structuralProbe({
    rawBytes: params.rawBytes,
    sniffed,
    limitsProfile: params.limitsProfile,
    signal: params.signal,
  });
  if (probed.status === 'terminal') {
    return terminal(probed.terminalStatus, probed.reason, sniffed.mimeType,
      params.redactionPolicyDigest,
      relationshipInputSha256({ ...baseAudit, decision: probed.terminalStatus, reason: probed.reason }));
  }
  const facts = {
    pageCount: probed.pageCount,
    imageWidth: probed.imageWidth,
    imageHeight: probed.imageHeight,
    durationMs: probed.durationMs,
  };
  return {
    status: 'ready',
    rawBytes: params.rawBytes,
    searchableBytes: params.rawBytes,
    sniffedMimeType: sniffed.mimeType,
    facts,
    safetyPolicyVersion: CASE_GRAPH_CONTENT_BYTE_INSPECTION_POLICY.safetyPolicyVersion,
    safetyScanDigest: relationshipInputSha256({ ...baseAudit, decision: 'structurally_valid', facts }),
    redactionPolicyDigest: params.redactionPolicyDigest,
    redactionStatus: 'not_required',
    redactionTransformationDigest: null,
    terminalReason: 'captured bytes passed deterministic signature and structural inspection',
  };
};
