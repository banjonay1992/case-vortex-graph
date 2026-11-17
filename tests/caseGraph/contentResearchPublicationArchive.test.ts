import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  makeCaseGraphContentAccountingReceipt,
  makeCaseGraphContentAsset,
  makeCaseGraphContentDiscoveryManifest,
  makeCaseGraphContentDiscoveryRecord,
  makeCaseGraphContentLimitsProfile,
} from '../../src/caseGraph/contentResearchArchive';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';
import {
  archiveCaseGraphContentResearchPublication,
} from '../../src/caseGraph/contentResearchPublicationArchive';
import {
  caseGraphContentSourceRegistryPointerKey,
} from '../../src/caseGraph/contentResearchSourceRegistryArchive';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'corpus-v3',
  manifestSha256: digest('manifest'), snapshotId: 'snapshot-v3', graphArtifactSetSha256: digest('graph'),
  relationshipSchemaVersion: 'typed-relationships-v3', relationshipPolicyVersion: 'policy-v3',
  relationshipPolicySha256: digest('policy'), relationshipModelId: 'model-v3',
  relationshipModelVersion: 'model-v3.1', relationshipModelSha256: digest('model'),
  calibrationSetSha256: digest('calibration'),
};

const fixture = () => {
  const address = 'document:00000000-0000-4000-8000-000000000030';
  const discovery = makeCaseGraphContentDiscoveryRecord({
    publication, address, nodeDigest: digest('node'), sourceAssetKey: 'source/accounted.pdf',
    mediaKind: 'document', claimedMimeType: 'application/pdf',
    sourceLocatorDigest: digest('locator'), sourceLineageDigest: digest('lineage'),
  });
  const discoveryManifest = makeCaseGraphContentDiscoveryManifest({
    publication,
    upstreamEnumerationReceiptSha256: digest('enumeration'),
    limitsApprovalReceiptSha256: digest('limits-approval'),
    limitsProfile: makeCaseGraphContentLimitsProfile({
      profileId: 'publication-archive-test-v1', maxAssetBytes: 10_000_000,
      maxDocumentPages: 10_000, maxImagePixels: 100_000_000,
      maxTimedMediaDurationMs: 86_400_000, maxChunkTextBytes: 64_000,
      maxTotalTextBytesPerAsset: 10_000_000, maxChunksPerAsset: 100_000,
    }),
    records: [discovery],
  });
  const blockedAsset = makeCaseGraphContentAsset({
    ...discovery,
    sniffedMimeType: 'application/pdf', byteLength: null, bytesSha256: null,
    capturedObjectKey: null, capturedObjectSha256: null, searchableObjectKey: null,
    searchableBytesSha256: null, pageCount: null, imageWidth: null, imageHeight: null,
    durationMs: null, visibility: 'public', rightsPolicyVersion: 'rights-v1',
    rightsEvidenceDigest: digest('rights'), safetyPolicyVersion: 'safety-v1', safetyScanDigest: null,
    redactionPolicyDigest: digest('redaction'), redactionStatus: 'not_required',
    redactionTransformationDigest: null, terminalStatus: 'rights_blocked',
    terminalReason: 'source rights do not allow public replay',
  });
  const accountingReceipt = makeCaseGraphContentAccountingReceipt({
    publication, discoveryManifest, assets: [blockedAsset], extractions: [],
  });
  return { publication, discoveryManifest, assets: [blockedAsset], accountingReceipt, extractions: [] };
};

const memoryArchive = () => {
  const objects = new Map<string, Buffer>();
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

describe('authoritative content research publication archive', () => {
  it('archives verified search first and activates source replay last, idempotently', async () => {
    const store = memoryArchive();
    const input = { ...fixture(), archive: store.archive };
    const first = await archiveCaseGraphContentResearchPublication(input);
    const second = await archiveCaseGraphContentResearchPublication(input);

    expect(second).toEqual(first);
    expect(first.receipt).toMatchObject({ terminalAssetCount: 1, searchableEntryCount: 0 });
    expect(first.receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
    const activeKey = caseGraphContentSourceRegistryPointerKey(publication.manifestSha256);
    expect(store.objects.has(activeKey)).toBe(true);
    const firstActiveWrite = store.putIfAbsent.mock.calls.findIndex(([call]) => call.key === activeKey);
    const firstSearchWrite = store.putIfAbsent.mock.calls.findIndex(([call]) => (
      call.key.startsWith(`case-vortex/content-search/${publication.manifestSha256}/`)
    ));
    expect(firstSearchWrite).toBeGreaterThanOrEqual(0);
    expect(firstActiveWrite).toBeGreaterThan(firstSearchWrite);
  });

  it('does not activate source replay when search archival fails', async () => {
    const store = memoryArchive();
    store.readObject.mockImplementation(async (key) => (
      key.startsWith('case-vortex/content-search/') ? Buffer.from('tampered')
        : store.objects.has(key) ? Buffer.from(store.objects.get(key)!) : null
    ));
    await expect(archiveCaseGraphContentResearchPublication({
      ...fixture(), archive: store.archive,
    })).rejects.toThrow('case_graph_content_search_archive_read_after_write_mismatch');
    expect(store.objects.has(caseGraphContentSourceRegistryPointerKey(publication.manifestSha256))).toBe(false);
  });

  it('writes nothing for invalid accounting or cancellation', async () => {
    const invalidStore = memoryArchive();
    const invalid = fixture();
    await expect(archiveCaseGraphContentResearchPublication({
      ...invalid,
      accountingReceipt: { ...invalid.accountingReceipt, terminalAssetCount: 0 },
      archive: invalidStore.archive,
    })).rejects.toThrow('case_graph_content_accounting_integrity_failed');
    expect(invalidStore.objects.size).toBe(0);

    const cancelledStore = memoryArchive();
    const controller = new AbortController();
    controller.abort();
    await expect(archiveCaseGraphContentResearchPublication({
      ...fixture(), archive: cancelledStore.archive, signal: controller.signal,
    })).rejects.toThrow('case_graph_content_publication_archive_aborted');
    expect(cancelledStore.objects.size).toBe(0);
  });

  it('does not activate source replay when cancelled after search archival', async () => {
    const store = memoryArchive();
    const controller = new AbortController();
    store.readObject.mockImplementation(async (key) => {
      const body = store.objects.get(key);
      if (key.startsWith('case-vortex/content-search/') && key.endsWith('/manifest.json')) {
        controller.abort();
      }
      return body ? Buffer.from(body) : null;
    });
    await expect(archiveCaseGraphContentResearchPublication({
      ...fixture(), archive: store.archive, signal: controller.signal,
    })).rejects.toThrow('case_graph_content_publication_archive_aborted');
    expect([...store.objects.keys()].some((key) => key.startsWith('case-vortex/content-search/'))).toBe(true);
    expect(store.objects.has(caseGraphContentSourceRegistryPointerKey(publication.manifestSha256))).toBe(false);
  });
});
