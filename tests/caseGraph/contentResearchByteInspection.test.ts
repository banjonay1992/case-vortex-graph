import { describe, expect, it, vi } from 'vitest';

import {
  inspectCaseGraphContentBytes,
  sniffCaseGraphContentType,
} from '../../src/caseGraph/contentResearchByteInspection';
import {
  makeCaseGraphContentDiscoveryRecord,
  makeCaseGraphContentLimitsProfile,
} from '../../src/caseGraph/contentResearchArchive';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'inspection-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-inspection', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'inspection-limits', maxAssetBytes: 1_024, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 1_000,
  maxTotalTextBytesPerAsset: 10_000, maxChunksPerAsset: 100,
});
const record = (mediaKind: 'document' | 'image' | 'audio' | 'video' = 'document') => (
  makeCaseGraphContentDiscoveryRecord({
    publication,
    address: `${mediaKind === 'image' ? 'photo' : mediaKind}:00000000-0000-4000-8000-000000000010`,
    nodeDigest: digest('6'), sourceAssetKey: 'canonical-url:https://example.test/evidence',
    mediaKind, claimedMimeType: 'application/octet-stream', sourceLocatorDigest: digest('7'),
    sourceLineageDigest: digest('8'),
  })
);

describe('deterministic content byte inspection', () => {
  it.each([
    [Buffer.from('%PDF-1.7\n'), 'application/pdf', 'document'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', 'image'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'image'],
    [Buffer.from('RIFFxxxxWAVE'), 'audio/wav', 'audio'],
    [Buffer.from('xxxxftypisom'), 'video/mp4', 'video'],
    [Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm', 'video'],
  ])('sniffs signatures without trusting extensions or headers', (body, mimeType, mediaKind) => {
    expect(sniffCaseGraphContentType(body)).toEqual({ mimeType, mediaKind });
  });

  it('binds a successful structural probe and facts into a ready inspection', async () => {
    const structuralProbe = vi.fn(async () => ({
      status: 'ready' as const, pageCount: 2, imageWidth: null, imageHeight: null, durationMs: null,
    }));
    const rawBytes = Buffer.from('%PDF-1.7\nfixture');
    const result = await inspectCaseGraphContentBytes({
      record: record(), rawBytes, responseMimeType: 'text/html', limitsProfile, structuralProbe,
      redactionPolicyDigest: digest('9'),
    });
    expect(result).toMatchObject({
      status: 'ready', rawBytes, searchableBytes: rawBytes, sniffedMimeType: 'application/pdf',
      facts: { pageCount: 2, imageWidth: null, imageHeight: null, durationMs: null },
      safetyScanDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(structuralProbe).toHaveBeenCalledOnce();
  });

  it('quarantines media-kind substitution before structural parsing', async () => {
    const structuralProbe = vi.fn();
    const result = await inspectCaseGraphContentBytes({
      record: record('image'), rawBytes: Buffer.from('%PDF-1.7\nfixture'),
      responseMimeType: 'image/jpeg', limitsProfile, structuralProbe, redactionPolicyDigest: digest('9'),
    });
    expect(result).toMatchObject({ status: 'terminal', terminalStatus: 'quarantined' });
    expect(structuralProbe).not.toHaveBeenCalled();
  });

  it('preserves explicit encrypted/corrupt probe verdicts and rejects unknown signatures', async () => {
    const encrypted = await inspectCaseGraphContentBytes({
      record: record(), rawBytes: Buffer.from('%PDF-1.7\nencrypted'), responseMimeType: 'application/pdf',
      limitsProfile, redactionPolicyDigest: digest('9'),
      structuralProbe: async () => ({ status: 'terminal', terminalStatus: 'encrypted', reason: 'password required' }),
    });
    expect(encrypted).toMatchObject({ status: 'terminal', terminalStatus: 'encrypted' });

    const unknown = await inspectCaseGraphContentBytes({
      record: record(), rawBytes: Buffer.from('not a supported file'), responseMimeType: 'application/pdf',
      limitsProfile, redactionPolicyDigest: digest('9'), structuralProbe: vi.fn(),
    });
    expect(unknown).toMatchObject({ status: 'terminal', terminalStatus: 'unsupported' });
  });
});
