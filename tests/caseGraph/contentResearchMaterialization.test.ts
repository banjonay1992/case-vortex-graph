import { describe, expect, it, vi } from 'vitest';

import {
  makeCaseGraphContentDiscoveryManifest,
  makeCaseGraphContentDiscoveryRecord,
  makeCaseGraphContentLimitsProfile,
  type CaseGraphContentDiscoveryRecord,
} from '../../src/caseGraph/contentResearchArchive';
import {
  materializeCaseGraphContentAssets,
  type CaseGraphContentImmutableArchive,
  type CaseGraphContentProcessedAsset,
} from '../../src/caseGraph/contentResearchMaterialization';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'content-materialization-test-v1',
  manifestSha256: digest('1'),
  snapshotId: 'snapshot-materialization-test',
  graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'typed-relationships-test',
  relationshipPolicyVersion: 'relationship-policy-test',
  relationshipPolicySha256: digest('3'),
  relationshipModelId: 'model-test',
  relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'content-materialization-limits',
  maxAssetBytes: 1_024,
  maxDocumentPages: 20,
  maxImagePixels: 2_000_000,
  maxTimedMediaDurationMs: 60_000,
  maxChunkTextBytes: 10_000,
  maxTotalTextBytesPerAsset: 100_000,
  maxChunksPerAsset: 100,
});
const record = (address = 'document:00000000-0000-4000-8000-000000000010', sourceAssetKey = 'canonical-url:https://example.test/evidence.pdf') => (
  makeCaseGraphContentDiscoveryRecord({
    publication,
    address,
    nodeDigest: digest('6'),
    sourceAssetKey,
    mediaKind: address.startsWith('photo:') ? 'image' : address.startsWith('video:') ? 'video' : 'document',
    claimedMimeType: 'application/octet-stream',
    sourceLocatorDigest: digest('7'),
    sourceLineageDigest: digest('8'),
  })
);
const manifest = (records: CaseGraphContentDiscoveryRecord[]) => makeCaseGraphContentDiscoveryManifest({
  publication,
  upstreamEnumerationReceiptSha256: digest('9'),
  limitsProfile,
  limitsApprovalReceiptSha256: digest('a'),
  records,
});
const rights = vi.fn(async () => ({
  allowed: true,
  policyVersion: 'public-evidence-rights-v1',
  evidenceDigest: digest('b'),
  reason: 'public extraction permitted by reviewed source policy',
}));
const ready = (overrides: Partial<Extract<CaseGraphContentProcessedAsset, { status: 'ready' }>> = {}): Extract<CaseGraphContentProcessedAsset, { status: 'ready' }> => ({
  status: 'ready',
  rawBytes: Buffer.from('raw public evidence'),
  searchableBytes: Buffer.from('raw public evidence'),
  sniffedMimeType: 'application/pdf',
  facts: { pageCount: 1, imageWidth: null, imageHeight: null, durationMs: null },
  safetyPolicyVersion: 'content-safety-v1',
  safetyScanDigest: digest('c'),
  redactionPolicyDigest: digest('d'),
  redactionStatus: 'not_required',
  redactionTransformationDigest: null,
  terminalReason: 'eligible public asset captured, scanned and materialized',
  ...overrides,
});

const memoryArchive = (initial = new Map<string, Buffer>()) => {
  const objects = new Map(initial);
  const putIfAbsent = vi.fn<CaseGraphContentImmutableArchive['putIfAbsent']>(async ({ key, body }) => {
    if (objects.has(key)) return 'exists';
    objects.set(key, Buffer.from(body));
    return 'written';
  });
  const readObject = vi.fn<CaseGraphContentImmutableArchive['readObject']>(async (key) => (
    objects.has(key) ? Buffer.from(objects.get(key)!) : null
  ));
  return { archive: { putIfAbsent, readObject }, objects, putIfAbsent, readObject };
};

const run = (params: {
  records?: CaseGraphContentDiscoveryRecord[];
  evaluateRights?: typeof rights;
  processAsset?: (params: { record: CaseGraphContentDiscoveryRecord }) => Promise<CaseGraphContentProcessedAsset>;
  archive?: ReturnType<typeof memoryArchive>;
} = {}) => {
  const archive = params.archive || memoryArchive();
  return {
    archive,
    result: materializeCaseGraphContentAssets({
      discoveryManifest: manifest(params.records || [record()]),
      evaluateRights: params.evaluateRights || rights,
      processAsset: params.processAsset || (async () => ready()),
      archive: archive.archive,
      fallbackSafetyPolicyVersion: 'content-safety-v1',
      fallbackRedactionPolicyDigest: digest('d'),
    }),
  };
};

describe('full-content materialization boundary', () => {
  it('persists and verifies one content-addressed object when no redaction is required', async () => {
    const operation = run();
    const [asset] = await operation.result;
    expect(asset).toMatchObject({
      terminalStatus: 'extracted',
      capturedObjectKey: expect.stringMatching(/\/captured\/[a-f0-9]{64}\.bin$/),
      searchableObjectKey: expect.any(String),
      capturedObjectSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(asset.searchableObjectKey).toBe(asset.capturedObjectKey);
    expect(asset.searchableBytesSha256).toBe(asset.capturedObjectSha256);
    expect(operation.archive.putIfAbsent).toHaveBeenCalledTimes(1);
    expect(operation.archive.readObject).toHaveBeenCalledTimes(1);
  });

  it('persists a separately addressable searchable object when redaction changes bytes', async () => {
    const operation = run({
      processAsset: async () => ready({
        searchableBytes: Buffer.from('redacted public evidence'),
        redactionStatus: 'applied',
        redactionTransformationDigest: digest('e'),
      }),
    });
    const [asset] = await operation.result;
    expect(asset.searchableObjectKey).toMatch(/\/searchable\/[a-f0-9]{64}\.bin$/);
    expect(asset.searchableObjectKey).not.toBe(asset.capturedObjectKey);
    expect(asset.searchableBytesSha256).not.toBe(asset.capturedObjectSha256);
    expect(operation.archive.putIfAbsent).toHaveBeenCalledTimes(2);
    expect(operation.archive.readObject).toHaveBeenCalledTimes(2);
  });

  it('records rights-blocked and unresolved assets without fetching or silently dropping them', async () => {
    const blockedRights = vi.fn(async (entry: CaseGraphContentDiscoveryRecord) => ({
      allowed: !entry.address.includes('blocked'),
      policyVersion: 'public-evidence-rights-v1',
      evidenceDigest: digest('b'),
      reason: 'reviewed source policy blocks public extraction',
    }));
    const processAsset = vi.fn(async () => ready());
    const operation = run({
      records: [
        record('document:blocked'),
        record('video:unresolved', 'unresolved-public-node:video:unresolved'),
      ],
      evaluateRights: blockedRights as typeof rights,
      processAsset,
    });
    const assets = await operation.result;
    expect(assets.map(({ terminalStatus }) => terminalStatus).sort()).toEqual(['rights_blocked', 'unavailable']);
    expect(processAsset).not.toHaveBeenCalled();
    expect(operation.archive.putIfAbsent).not.toHaveBeenCalled();
  });

  it('preserves an explicit processor terminal outcome as complete accounting', async () => {
    const operation = run({
      processAsset: async () => ({
        status: 'terminal',
        terminalStatus: 'encrypted',
        terminalReason: 'document requires a password',
        sniffedMimeType: 'application/pdf',
        safetyPolicyVersion: 'content-safety-v1',
        safetyScanDigest: digest('c'),
        redactionPolicyDigest: digest('d'),
      }),
    });
    expect(await operation.result).toEqual([
      expect.objectContaining({ terminalStatus: 'encrypted', terminalReason: 'document requires a password' }),
    ]);
    expect(operation.archive.putIfAbsent).not.toHaveBeenCalled();
  });

  it('fails closed before storage for oversized bytes or incompatible media facts', async () => {
    const oversized = run({ processAsset: async () => ready({ rawBytes: Buffer.alloc(1_025) }) });
    await expect(oversized.result).rejects.toThrow('case_graph_content_materialization_processed_asset_invalid');
    expect(oversized.archive.putIfAbsent).not.toHaveBeenCalled();

    const wrongFacts = run({
      processAsset: async () => ready({
        facts: { pageCount: null, imageWidth: 10, imageHeight: 10, durationMs: null },
      }),
    });
    await expect(wrongFacts.result).rejects.toThrow('case_graph_content_materialization_processed_asset_invalid');
    expect(wrongFacts.archive.putIfAbsent).not.toHaveBeenCalled();
  });

  it('fails closed when immutable read-after-write bytes do not match', async () => {
    const archive = memoryArchive();
    archive.readObject.mockResolvedValue(Buffer.from('tampered'));
    const operation = run({ archive });
    await expect(operation.result).rejects.toThrow('case_graph_content_materialization_read_after_write_mismatch');
  });
});
