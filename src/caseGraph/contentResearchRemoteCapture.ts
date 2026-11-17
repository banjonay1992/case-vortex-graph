import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphContentDiscoveryRecord } from './contentResearchArchive';
import type { CaseGraphContentProcessedAsset } from './contentResearchMaterialization';

export const CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY = Object.freeze({
  version: 'case-graph-content-remote-capture-v1',
  requestTimeoutMs: 30_000,
  bodyTimeoutMs: 30_000,
  totalTimeoutMs: 60_000,
  maximumRedirects: 3,
  userAgent: 'UAPFilesLive-Evidence-Archiver/1.0',
} as const);

type SafeFetch = (
  rawUrl: string,
  options: {
    requestTimeoutMs: number;
    bodyTimeoutMs: number;
    totalTimeoutMs?: number;
    maxBytes: number;
    headers?: HeadersInit;
    maxRedirects?: number;
    signal?: AbortSignal | null;
  },
) => Promise<{ response: Response; body: Buffer }>;
type ReadyInspection = Omit<Extract<CaseGraphContentProcessedAsset, { status: 'ready' }>, 'rawBytes'>;

const captureUrl = (record: CaseGraphContentDiscoveryRecord) => {
  const prefixes = ['canonical-url:', 'preview-url:'] as const;
  const prefix = prefixes.find((candidate) => record.sourceAssetKey.startsWith(candidate));
  if (!prefix) return null;
  const raw = record.sourceAssetKey.slice(prefix.length);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol.toLowerCase()) || url.username || url.password) return null;
  return url.toString();
};

const responseMimeType = (response: Response) => {
  const candidate = String(response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(candidate)
    ? candidate
    : 'application/octet-stream';
};

const terminal = (params: {
  status: 'unavailable' | 'oversized' | 'quarantined';
  reason: string;
  sniffedMimeType?: string;
  safetyPolicyVersion: string;
  safetyScanDigest?: string | null;
  redactionPolicyDigest: string;
}): CaseGraphContentProcessedAsset => ({
  status: 'terminal',
  terminalStatus: params.status,
  terminalReason: params.reason,
  sniffedMimeType: params.sniffedMimeType || 'application/octet-stream',
  safetyPolicyVersion: params.safetyPolicyVersion,
  safetyScanDigest: params.safetyScanDigest ?? null,
  redactionPolicyDigest: params.redactionPolicyDigest,
});

export const createCaseGraphContentRemoteProcessor = (options: {
  inspectCapturedBytes: (params: {
    record: CaseGraphContentDiscoveryRecord;
    rawBytes: Buffer;
    responseMimeType: string;
    signal?: AbortSignal;
  }) => Promise<ReadyInspection | Extract<CaseGraphContentProcessedAsset, { status: 'terminal' }>>;
  safetyPolicyVersion: string;
  redactionPolicyDigest: string;
  fetchBuffer: SafeFetch;
  requestTimeoutMs?: number;
  bodyTimeoutMs?: number;
  totalTimeoutMs?: number;
  maximumRedirects?: number;
}) => async (params: {
  record: CaseGraphContentDiscoveryRecord;
  limitsProfile: { maxAssetBytes: number };
  signal?: AbortSignal;
}): Promise<CaseGraphContentProcessedAsset> => {
  const url = captureUrl(params.record);
  if (!url) {
    return terminal({
      status: 'quarantined',
      reason: 'content locator is not an authenticated public HTTP(S) URL',
      safetyPolicyVersion: options.safetyPolicyVersion,
      safetyScanDigest: relationshipInputSha256({
        policy: CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY.version,
        sourceAssetKey: params.record.sourceAssetKey,
        decision: 'invalid_remote_locator',
      }),
      redactionPolicyDigest: options.redactionPolicyDigest,
    });
  }
  const fetchBuffer = options.fetchBuffer;
  try {
    const fetched = await fetchBuffer(url, {
      requestTimeoutMs: options.requestTimeoutMs
        ?? CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY.requestTimeoutMs,
      bodyTimeoutMs: options.bodyTimeoutMs
        ?? CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY.bodyTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs
        ?? CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY.totalTimeoutMs,
      maxBytes: params.limitsProfile.maxAssetBytes,
      maxRedirects: options.maximumRedirects
        ?? CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY.maximumRedirects,
      signal: params.signal,
      headers: { 'user-agent': CASE_GRAPH_CONTENT_REMOTE_CAPTURE_POLICY.userAgent },
    });
    const inspected = await options.inspectCapturedBytes({
      record: params.record,
      rawBytes: fetched.body,
      responseMimeType: responseMimeType(fetched.response),
      signal: params.signal,
    });
    return inspected.status === 'terminal'
      ? inspected
      : { ...inspected, rawBytes: fetched.body };
  } catch (error) {
    const value = error as { code?: unknown; statusCode?: unknown };
    if (value?.code === 'SAFE_REMOTE_BODY_TOO_LARGE') {
      return terminal({
        status: 'oversized',
        reason: `remote asset exceeds approved ${params.limitsProfile.maxAssetBytes}-byte limit`,
        safetyPolicyVersion: options.safetyPolicyVersion,
        redactionPolicyDigest: options.redactionPolicyDigest,
      });
    }
    if (value?.code === 'SAFE_REMOTE_HTTP_ERROR'
      && (value.statusCode === 404 || value.statusCode === 410)) {
      return terminal({
        status: 'unavailable',
        reason: `remote asset returned terminal HTTP ${String(value.statusCode)}`,
        safetyPolicyVersion: options.safetyPolicyVersion,
        redactionPolicyDigest: options.redactionPolicyDigest,
      });
    }
    // DNS failures, timeouts, 5xx responses and aborted work are retryable.
    // They must not be committed as permanent corpus exclusions.
    throw error;
  }
};
