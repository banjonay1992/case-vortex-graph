import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  makeCaseGraphContentAccountingReceipt,
  makeCaseGraphContentAsset,
  makeCaseGraphContentDiscoveryManifest,
  makeCaseGraphContentDiscoveryRecord,
  makeCaseGraphContentChunk,
  makeCaseGraphContentExtractionContract,
  makeCaseGraphContentExtractionReceipt,
  makeCaseGraphContentLimitsProfile,
  type CaseGraphContentAsset,
} from '../../src/caseGraph/contentResearchArchive';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';
import {
  archiveCaseGraphContentSourceRegistry,
  archiveCaseGraphContentSourceRegistryFromAccounting,
  caseGraphContentSourceRegistryPointerKey,
  loadCaseGraphContentSourceAssets,
} from '../../src/caseGraph/contentResearchSourceRegistryArchive';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'corpus-v3',
  manifestSha256: digest('manifest'), snapshotId: 'snapshot-v3', graphArtifactSetSha256: digest('graph'),
  relationshipSchemaVersion: 'typed-relationships-v3', relationshipPolicyVersion: 'policy-v3',
  relationshipPolicySha256: digest('policy'), relationshipModelId: 'model-v3',
  relationshipModelVersion: 'model-v3.1', relationshipModelSha256: digest('model'),
  calibrationSetSha256: digest('calibration'),
};

const asset = (address: string, suffix: string): CaseGraphContentAsset => {
  const body = Buffer.from(`asset-${suffix}`);
  return makeCaseGraphContentAsset({
    publication, address, nodeDigest: digest(`node-${suffix}`), sourceAssetKey: `source/${suffix}.pdf`,
    discoveryId: `content-discovery:${digest(`discovery-${suffix}`)}`, discoveryDigest: digest(`discovery-record-${suffix}`),
    mediaKind: 'document', claimedMimeType: 'application/pdf', sniffedMimeType: 'application/pdf',
    byteLength: body.byteLength, bytesSha256: digest(body), capturedObjectKey: `captured/${suffix}.pdf`,
    capturedObjectSha256: digest(body), searchableObjectKey: `captured/${suffix}.pdf`,
    searchableBytesSha256: digest(body), pageCount: 1, imageWidth: null, imageHeight: null, durationMs: null,
    sourceLocatorDigest: digest(`locator-${suffix}`), sourceLineageDigest: digest(`lineage-${suffix}`),
    visibility: 'public', rightsPolicyVersion: 'rights-v1', rightsEvidenceDigest: digest(`rights-${suffix}`),
    safetyPolicyVersion: 'safety-v1', safetyScanDigest: digest(`safety-${suffix}`),
    redactionPolicyDigest: digest('redaction-policy'), redactionStatus: 'not_required',
    redactionTransformationDigest: null, terminalStatus: 'extracted', terminalReason: 'extracted',
  });
};

const memoryArchive = () => {
  const objects = new Map<string, Buffer>();
  const archive: CaseGraphContentImmutableArchive = {
    putIfAbsent: async ({ key, body }) => {
      if (objects.has(key)) return 'exists';
      objects.set(key, Buffer.from(body));
      return 'written';
    },
    readObject: async (key, options) => {
      const body = objects.get(key);
      if (!body) return null;
      if (body.byteLength > options.maxBytes) throw new Error('object_too_large');
      return Buffer.from(body);
    },
  };
  return { archive, objects };
};

const accountedBlockedFixture = () => {
  const address = 'document:00000000-0000-4000-8000-000000000030';
  const discovery = makeCaseGraphContentDiscoveryRecord({
    publication,
    address,
    nodeDigest: digest('accounted-node'),
    sourceAssetKey: 'source/accounted.pdf',
    mediaKind: 'document',
    claimedMimeType: 'application/pdf',
    sourceLocatorDigest: digest('accounted-locator'),
    sourceLineageDigest: digest('accounted-lineage'),
  });
  const limitsProfile = makeCaseGraphContentLimitsProfile({
    profileId: 'source-registry-test-v1',
    maxAssetBytes: 10_000_000,
    maxDocumentPages: 10_000,
    maxImagePixels: 100_000_000,
    maxTimedMediaDurationMs: 86_400_000,
    maxChunkTextBytes: 64_000,
    maxTotalTextBytesPerAsset: 10_000_000,
    maxChunksPerAsset: 100_000,
  });
  const discoveryManifest = makeCaseGraphContentDiscoveryManifest({
    publication,
    upstreamEnumerationReceiptSha256: digest('accounted-enumeration'),
    limitsProfile,
    limitsApprovalReceiptSha256: digest('accounted-limits-approval'),
    records: [discovery],
  });
  const blockedAsset = makeCaseGraphContentAsset({
    publication,
    address,
    nodeDigest: discovery.nodeDigest,
    sourceAssetKey: discovery.sourceAssetKey,
    discoveryId: discovery.discoveryId,
    discoveryDigest: discovery.discoveryDigest,
    mediaKind: discovery.mediaKind,
    claimedMimeType: discovery.claimedMimeType,
    sniffedMimeType: 'application/pdf',
    byteLength: null,
    bytesSha256: null,
    capturedObjectKey: null,
    capturedObjectSha256: null,
    searchableObjectKey: null,
    searchableBytesSha256: null,
    pageCount: null,
    imageWidth: null,
    imageHeight: null,
    durationMs: null,
    sourceLocatorDigest: discovery.sourceLocatorDigest,
    sourceLineageDigest: discovery.sourceLineageDigest,
    visibility: 'public',
    rightsPolicyVersion: 'rights-v1',
    rightsEvidenceDigest: digest('accounted-rights'),
    safetyPolicyVersion: 'safety-v1',
    safetyScanDigest: null,
    redactionPolicyDigest: digest('redaction-policy'),
    redactionStatus: 'not_required',
    redactionTransformationDigest: null,
    terminalStatus: 'rights_blocked',
    terminalReason: 'source rights do not allow public replay',
  });
  const accountingReceipt = makeCaseGraphContentAccountingReceipt({
    publication,
    discoveryManifest,
    assets: [blockedAsset],
    extractions: [],
  });
  return { address, discoveryManifest, assets: [blockedAsset], accountingReceipt, extractions: [] };
};

const accountedExtractedFixture = () => {
  const body = Buffer.from('accounted public source bytes');
  const address = 'document:00000000-0000-4000-8000-000000000031';
  const discovery = makeCaseGraphContentDiscoveryRecord({
    publication, address, nodeDigest: digest('extracted-node'), sourceAssetKey: 'source/extracted.pdf',
    mediaKind: 'document', claimedMimeType: 'application/pdf',
    sourceLocatorDigest: digest('extracted-locator'), sourceLineageDigest: digest('extracted-lineage'),
  });
  const limitsProfile = makeCaseGraphContentLimitsProfile({
    profileId: 'source-registry-extracted-test-v1', maxAssetBytes: 10_000_000,
    maxDocumentPages: 10_000, maxImagePixels: 100_000_000,
    maxTimedMediaDurationMs: 86_400_000, maxChunkTextBytes: 64_000,
    maxTotalTextBytesPerAsset: 10_000_000, maxChunksPerAsset: 100_000,
  });
  const discoveryManifest = makeCaseGraphContentDiscoveryManifest({
    publication, upstreamEnumerationReceiptSha256: digest('extracted-enumeration'), limitsProfile,
    limitsApprovalReceiptSha256: digest('extracted-limits-approval'), records: [discovery],
  });
  const objectKey = 'case-vortex/content/publications/source-registry-test/captured/source.bin';
  const extractedAsset = makeCaseGraphContentAsset({
    ...discovery, sniffedMimeType: 'application/pdf', byteLength: body.byteLength,
    bytesSha256: digest(body), capturedObjectKey: objectKey, capturedObjectSha256: digest(body),
    searchableObjectKey: objectKey, searchableBytesSha256: digest(body), pageCount: 1,
    imageWidth: null, imageHeight: null, durationMs: null, visibility: 'public',
    rightsPolicyVersion: 'rights-v1', rightsEvidenceDigest: digest('extracted-rights'),
    safetyPolicyVersion: 'safety-v1', safetyScanDigest: digest('extracted-safety'),
    redactionPolicyDigest: digest('redaction-policy'), redactionStatus: 'not_required',
    redactionTransformationDigest: null, terminalStatus: 'extracted', terminalReason: 'extracted',
  });
  const contract = makeCaseGraphContentExtractionContract({
    asset: extractedAsset, limitsProfile,
    extractor: {
      extractorType: 'embedded', extractorId: 'pdf-text', extractorVersion: '1.0.0',
      containerDigest: digest('container'), modelId: null, modelRevision: null,
      configDigest: digest('config'), promptDigest: null, humanProvenanceDigest: null,
      languageDetectorVersion: 'fixed-en-v1',
    },
  });
  const chunk = makeCaseGraphContentChunk({
    asset: extractedAsset, contract, textOrigin: contract.textOrigin, ordinal: 0,
    locator: {
      locatorType: 'document_page', pageNumber: 1, characterStart: 0,
      characterEnd: 22, readingOrder: 0, boundingBox: null,
    },
    text: 'Accounted public text.', language: 'en', confidence: null, warnings: [],
  });
  const receipt = makeCaseGraphContentExtractionReceipt({
    asset: extractedAsset, contract, chunks: [chunk],
    coverage: { coverageType: 'document', totalPages: 1, processedPages: [1] },
  });
  const extractions = [{ contract, receipt, chunks: [chunk] }];
  const accountingReceipt = makeCaseGraphContentAccountingReceipt({
    publication, discoveryManifest, assets: [extractedAsset], extractions,
  });
  return {
    address, body, objectKey, discoveryManifest, assets: [extractedAsset], accountingReceipt, extractions,
  };
};

describe('immutable content source replay registry', () => {
  it('activates idempotently only from the exact complete content-accounting proof', async () => {
    const fixture = accountedBlockedFixture();
    const store = memoryArchive();
    const input = { publication, ...fixture, archive: store.archive };

    const first = await archiveCaseGraphContentSourceRegistryFromAccounting(input);
    expect(await archiveCaseGraphContentSourceRegistryFromAccounting(input)).toEqual(first);
    const loaded = await loadCaseGraphContentSourceAssets({
      publication, address: fixture.address, archive: store.archive,
    });
    expect(loaded.registry).toMatchObject({
      accountingReceiptDigest: fixture.accountingReceipt.receiptDigest,
      assetSetSha256: fixture.accountingReceipt.assetSetSha256,
      assetCount: 1,
    });
    expect(loaded.assets).toEqual(fixture.assets);
  });

  it('writes nothing when accounting is tampered, incomplete or cancelled', async () => {
    const fixture = accountedBlockedFixture();

    const tamperedStore = memoryArchive();
    await expect(archiveCaseGraphContentSourceRegistryFromAccounting({
      publication,
      ...fixture,
      accountingReceipt: { ...fixture.accountingReceipt, discoveredAssetCount: 2 },
      archive: tamperedStore.archive,
    })).rejects.toThrow('case_graph_content_accounting_integrity_failed');
    expect(tamperedStore.objects.size).toBe(0);

    const incompleteStore = memoryArchive();
    await expect(archiveCaseGraphContentSourceRegistryFromAccounting({
      publication,
      ...fixture,
      assets: [],
      archive: incompleteStore.archive,
    })).rejects.toThrow('case_graph_content_accounting_discovered_mismatch');
    expect(incompleteStore.objects.size).toBe(0);

    const cancelledStore = memoryArchive();
    const controller = new AbortController();
    controller.abort();
    await expect(archiveCaseGraphContentSourceRegistryFromAccounting({
      publication,
      ...fixture,
      archive: cancelledStore.archive,
      signal: controller.signal,
    })).rejects.toThrow('case_graph_content_source_registry_aborted');
    expect(cancelledStore.objects.size).toBe(0);
  });

  it('preflights every replayable source object before activating the registry', async () => {
    const fixture = accountedExtractedFixture();
    const validStore = memoryArchive();
    validStore.objects.set(fixture.objectKey, fixture.body);
    await archiveCaseGraphContentSourceRegistryFromAccounting({
      publication, ...fixture, archive: validStore.archive,
    });
    expect(validStore.objects.has(caseGraphContentSourceRegistryPointerKey(publication.manifestSha256))).toBe(true);

    const missingStore = memoryArchive();
    await expect(archiveCaseGraphContentSourceRegistryFromAccounting({
      publication, ...fixture, archive: missingStore.archive,
    })).rejects.toThrow('case_graph_content_source_registry_source_integrity_failed');
    expect(missingStore.objects.size).toBe(0);

    const corruptStore = memoryArchive();
    corruptStore.objects.set(fixture.objectKey, Buffer.from('corrupt'));
    await expect(archiveCaseGraphContentSourceRegistryFromAccounting({
      publication, ...fixture, archive: corruptStore.archive,
    })).rejects.toThrow('case_graph_content_source_registry_source_integrity_failed');
    expect(corruptStore.objects.has(caseGraphContentSourceRegistryPointerKey(publication.manifestSha256))).toBe(false);
  });

  it('archives sharded asset receipts and resolves only the requested publication address', async () => {
    const firstAddress = 'document:00000000-0000-4000-8000-000000000010';
    const secondAddress = 'photo:00000000-0000-4000-8000-000000000020';
    const assets = [asset(firstAddress, 'one'), asset(secondAddress, 'two')];
    const store = memoryArchive();
    const accountingAssetSetSha256 = relationshipInputSha256(
      [...assets].sort((a, b) => a.assetId.localeCompare(b.assetId))
        .map(({ assetId, assetDigest }) => ({ assetId, assetDigest })),
    );
    const pointer = await archiveCaseGraphContentSourceRegistry({
      publication, accountingReceiptDigest: digest('accounting'), accountingAssetSetSha256,
      assets, archive: store.archive,
    });
    expect(store.objects.has(caseGraphContentSourceRegistryPointerKey(publication.manifestSha256))).toBe(true);
    expect(pointer.pointerDigest).toMatch(/^[a-f0-9]{64}$/);

    const loaded = await loadCaseGraphContentSourceAssets({ publication, address: secondAddress, archive: store.archive });
    expect(loaded.assets.map((entry) => entry.address)).toEqual([secondAddress]);
    expect(loaded.registry).toMatchObject({ assetCount: 2, addressCount: 2, accountingReceiptDigest: digest('accounting') });
    await expect(loadCaseGraphContentSourceAssets({
      publication: { ...publication, manifestSha256: digest('other') }, address: secondAddress, archive: store.archive,
    })).rejects.toThrow('case_graph_content_source_registry_unavailable');
  });

  it('is idempotent but rejects conflicting or corrupted immutable objects', async () => {
    const address = 'document:00000000-0000-4000-8000-000000000010';
    const assets = [asset(address, 'one')];
    const accountingAssetSetSha256 = relationshipInputSha256(assets.map(({ assetId, assetDigest }) => ({ assetId, assetDigest })));
    const store = memoryArchive();
    const input = {
      publication, accountingReceiptDigest: digest('accounting'), accountingAssetSetSha256,
      assets, archive: store.archive,
    };
    const first = await archiveCaseGraphContentSourceRegistry(input);
    expect(await archiveCaseGraphContentSourceRegistry(input)).toEqual(first);

    const pointerKey = caseGraphContentSourceRegistryPointerKey(publication.manifestSha256);
    store.objects.set(pointerKey, Buffer.from('{}'));
    await expect(loadCaseGraphContentSourceAssets({ publication, address, archive: store.archive }))
      .rejects.toThrow('case_graph_content_source_registry_pointer_invalid');
    await expect(archiveCaseGraphContentSourceRegistry(input))
      .rejects.toThrow('case_graph_content_source_registry_read_after_write_mismatch');
  });

  it('rejects accounting drift, duplicate assets and cancellation before writes', async () => {
    const address = 'document:00000000-0000-4000-8000-000000000010';
    const one = asset(address, 'one');
    const store = memoryArchive();
    const common = {
      publication, accountingReceiptDigest: digest('accounting'), accountingAssetSetSha256: digest('wrong'),
      assets: [one], archive: store.archive,
    };
    await expect(archiveCaseGraphContentSourceRegistry(common))
      .rejects.toThrow('case_graph_content_source_registry_asset_set_invalid');
    await expect(archiveCaseGraphContentSourceRegistry({
      ...common,
      accountingAssetSetSha256: relationshipInputSha256([{ assetId: one.assetId, assetDigest: one.assetDigest }]),
      assets: [one, one],
    })).rejects.toThrow('case_graph_content_source_registry_asset_set_invalid');
    const controller = new AbortController();
    controller.abort();
    await expect(archiveCaseGraphContentSourceRegistry({
      ...common,
      accountingAssetSetSha256: relationshipInputSha256([{ assetId: one.assetId, assetDigest: one.assetDigest }]),
      signal: controller.signal,
    })).rejects.toThrow('case_graph_content_source_registry_aborted');
    expect(store.objects.size).toBe(0);
  });
});
