import { describe, expect, it, vi } from 'vitest';

import {
  makeCaseGraphContentDiscoveryRecord,
  makeCaseGraphContentLimitsProfile,
} from '../../src/caseGraph/contentResearchArchive';
import { createCaseGraphContentRemoteProcessor } from '../../src/caseGraph/contentResearchRemoteCapture';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'remote-capture-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-remote-capture', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const record = (sourceAssetKey = 'canonical-url:https://example.test/archive/evidence.pdf') => (
  makeCaseGraphContentDiscoveryRecord({
    publication,
    address: 'document:00000000-0000-4000-8000-000000000010',
    nodeDigest: digest('6'),
    sourceAssetKey,
    mediaKind: 'document',
    claimedMimeType: 'application/octet-stream',
    sourceLocatorDigest: digest('7'),
    sourceLineageDigest: digest('8'),
  })
);
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'remote-capture-limits', maxAssetBytes: 1_024, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 1_000,
  maxTotalTextBytesPerAsset: 10_000, maxChunksPerAsset: 100,
});
const inspected = {
  status: 'ready' as const,
  searchableBytes: Buffer.from('captured bytes'),
  sniffedMimeType: 'application/pdf',
  facts: { pageCount: 1, imageWidth: null, imageHeight: null, durationMs: null },
  safetyPolicyVersion: 'content-safety-v1', safetyScanDigest: digest('9'),
  redactionPolicyDigest: digest('a'), redactionStatus: 'not_required' as const,
  redactionTransformationDigest: null, terminalReason: 'captured and inspected',
};

const processor = (overrides: Record<string, unknown> = {}) => {
  const fetchBuffer = vi.fn(async () => ({
    response: new Response(null, { headers: { 'content-type': 'application/pdf; charset=binary' } }),
    body: Buffer.from('captured bytes'),
  }));
  const inspectCapturedBytes = vi.fn(async () => inspected);
  return {
    fetchBuffer,
    inspectCapturedBytes,
    process: createCaseGraphContentRemoteProcessor({
      fetchBuffer,
      inspectCapturedBytes,
      safetyPolicyVersion: 'content-safety-v1',
      redactionPolicyDigest: digest('a'),
      ...overrides,
    }),
  };
};

describe('safe remote full-content capture', () => {
  it('uses the SSRF-safe bounded fetch path and passes exact bytes to inspection', async () => {
    const operation = processor();
    const result = await operation.process({ record: record(), limitsProfile });
    expect(result).toMatchObject({ status: 'ready', rawBytes: Buffer.from('captured bytes') });
    expect(operation.fetchBuffer).toHaveBeenCalledWith('https://example.test/archive/evidence.pdf', {
      requestTimeoutMs: 30_000,
      bodyTimeoutMs: 30_000,
      totalTimeoutMs: 60_000,
      maxBytes: 1_024,
      maxRedirects: 3,
      signal: undefined,
      headers: { 'user-agent': 'UAPFilesLive-Evidence-Archiver/1.0' },
    });
    expect(operation.inspectCapturedBytes).toHaveBeenCalledWith(expect.objectContaining({
      rawBytes: Buffer.from('captured bytes'),
      responseMimeType: 'application/pdf',
    }));
  });

  it.each([
    'canonical-url:ftp://example.test/evidence.pdf',
    'preview-url:https://user:secret@example.test/evidence.pdf',
    'r2-key:private/object.pdf',
  ])('quarantines an invalid remote locator without fetching: %s', async (sourceAssetKey) => {
    const operation = processor();
    await expect(operation.process({ record: record(sourceAssetKey), limitsProfile })).resolves.toMatchObject({
      status: 'terminal', terminalStatus: 'quarantined', safetyScanDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(operation.fetchBuffer).not.toHaveBeenCalled();
  });

  it('maps only explicit terminal fetch outcomes and rethrows transient failures', async () => {
    const tooLarge = Object.assign(new Error('too large'), { code: 'SAFE_REMOTE_BODY_TOO_LARGE' });
    const oversized = processor({ fetchBuffer: vi.fn(async () => { throw tooLarge; }) });
    await expect(oversized.process({ record: record(), limitsProfile })).resolves.toMatchObject({
      status: 'terminal', terminalStatus: 'oversized',
    });

    const notFound = Object.assign(new Error('not found'), { code: 'SAFE_REMOTE_HTTP_ERROR', statusCode: 404 });
    const unavailable = processor({ fetchBuffer: vi.fn(async () => { throw notFound; }) });
    await expect(unavailable.process({ record: record(), limitsProfile })).resolves.toMatchObject({
      status: 'terminal', terminalStatus: 'unavailable',
    });

    const transient = processor({ fetchBuffer: vi.fn(async () => { throw new Error('remote_timeout'); }) });
    await expect(transient.process({ record: record(), limitsProfile })).rejects.toThrow('remote_timeout');
  });
});
