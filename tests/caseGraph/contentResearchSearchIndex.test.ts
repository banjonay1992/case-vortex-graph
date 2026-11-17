import { describe, expect, it } from 'vitest';

import {
  makeCaseGraphContentAccountingReceipt,
  makeCaseGraphContentDiscoveryManifest,
  makeCaseGraphContentDiscoveryRecord,
} from '../../src/caseGraph/contentResearchArchive';
import { archiveCaseGraphContentExtraction } from '../../src/caseGraph/contentResearchExtractionArchive';
import { extractCaseGraphImageContent } from '../../src/caseGraph/contentResearchImageExtraction';
import {
  buildCaseGraphContentSearchIndex,
  verifyCaseGraphContentSearchIndex,
} from '../../src/caseGraph/contentResearchSearchIndex';
import {
  archiveCaseGraphContentSearchIndex,
  verifyCaseGraphContentSearchArchivePointer,
} from '../../src/caseGraph/contentResearchSearchIndexArchive';
import { imageAsset, imageExtractor, imageLimits } from './contentResearchImageFixtures';

const d = (value: string) => value.repeat(64);
const discoveryManifest = makeCaseGraphContentDiscoveryManifest({
  publication: imageAsset.publication,
  upstreamEnumerationReceiptSha256: d('1'), limitsProfile: imageLimits, limitsApprovalReceiptSha256: d('2'),
  records: [makeCaseGraphContentDiscoveryRecord({
    publication: imageAsset.publication, address: imageAsset.address, nodeDigest: imageAsset.nodeDigest,
    sourceAssetKey: imageAsset.sourceAssetKey, mediaKind: imageAsset.mediaKind,
    claimedMimeType: imageAsset.claimedMimeType, sourceLocatorDigest: imageAsset.sourceLocatorDigest,
    sourceLineageDigest: imageAsset.sourceLineageDigest,
  })],
});

const fixture = async () => {
  const bundles = extractCaseGraphImageContent({
    asset: imageAsset, limitsProfile: imageLimits,
    metadataExtractor: imageExtractor('metadata', 'd'), ocrExtractor: imageExtractor('ocr', 'f'),
    metadataFields: [{ field: 'Make', text: 'Maker' }],
    ocrRegions: [{
      text: 'bright orb', language: 'en', confidence: 0.9,
      boundingBox: [0.1, 0.2, 0.3, 0.2], regionLabel: 'line:1',
    }],
  });
  const objects = new Map<string, Buffer>();
  const archive = {
    putIfAbsent: async ({ key, body }: { key: string; body: Buffer }) => {
      if (objects.has(key)) return 'exists' as const;
      objects.set(key, Buffer.from(body));
      return 'written' as const;
    },
    readObject: async (key: string) => objects.get(key) || null,
  };
  const extractions = await Promise.all(bundles.map(async (bundle) => ({
    ...bundle,
    pointer: await archiveCaseGraphContentExtraction({ asset: imageAsset, ...bundle, archive }),
  })));
  const accountingReceipt = makeCaseGraphContentAccountingReceipt({
    publication: imageAsset.publication, discoveryManifest, assets: [imageAsset], extractions,
  });
  return { extractions, accountingReceipt };
};

describe('publication-authorized extracted-content search index', () => {
  it('retains every modality and exact source locator under one pinned public publication', async () => {
    const { extractions, accountingReceipt } = await fixture();
    const build = buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset],
      accountingReceipt, extractions, maximumEntriesPerShard: 1,
    });
    expect(build.manifest).toMatchObject({
      accountingReceiptDigest: accountingReceipt.receiptDigest,
      entryCount: 3, shardCount: 3,
      authorizationScope: 'exact_verified_publication_public_content',
      manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const entries = build.shards.flatMap(({ entries }) => entries);
    expect(entries.map(({ textOrigin }) => textOrigin).sort()).toEqual(['exif', 'frame_ocr', 'frame_ocr']);
    expect(entries.every((entry) => entry.publication.manifestSha256 === imageAsset.publication.manifestSha256
      && entry.visibility === 'public' && entry.untrustedText)).toBe(true);
    expect(entries.find(({ textOrigin }) => textOrigin === 'frame_ocr')?.locator)
      .toMatchObject({ locatorType: 'image_region', boundingBox: [0.1, 0.2, 0.3, 0.2] });
  });

  it('is deterministic across extraction order and fails on pointer or accounting drift', async () => {
    const { extractions, accountingReceipt } = await fixture();
    const forward = buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset], accountingReceipt, extractions,
    });
    const reverse = buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset],
      accountingReceipt, extractions: [...extractions].reverse(),
    });
    expect(reverse).toEqual(forward);
    expect(() => buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset], accountingReceipt,
      extractions: [{ ...extractions[0], pointer: { ...extractions[0].pointer, chunksObjectSha256: d('0') } }, extractions[1]],
    })).toThrow('case_graph_content_extraction_archive_pointer_integrity_failed');
    expect(() => buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset],
      accountingReceipt: { ...accountingReceipt, searchableChunkCount: 2 }, extractions,
    })).toThrow('case_graph_content_accounting_integrity_failed');
  });

  it('rejects unsafe shard plans', async () => {
    const { extractions, accountingReceipt } = await fixture();
    expect(() => buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset],
      accountingReceipt, extractions, maximumEntriesPerShard: 0,
    })).toThrow('case_graph_content_search_index_plan_invalid');
  });

  it('rejects altered entry or shard bytes', async () => {
    const { extractions, accountingReceipt } = await fixture();
    const build = buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset], accountingReceipt, extractions,
    });
    expect(verifyCaseGraphContentSearchIndex(build)).toEqual(build);
    expect(() => verifyCaseGraphContentSearchIndex({
      manifest: build.manifest,
      shards: [{ ...build.shards[0], entries: [{ ...build.shards[0].entries[0], text: 'altered' }] }],
    })).toThrow('case_graph_content_search_index_integrity_failed');
  });

  it('archives every verified shard and manifest with exact read-after-write bytes', async () => {
    const { extractions, accountingReceipt } = await fixture();
    const build = buildCaseGraphContentSearchIndex({
      publication: imageAsset.publication, discoveryManifest, assets: [imageAsset],
      accountingReceipt, extractions, maximumEntriesPerShard: 1,
    });
    const objects = new Map<string, Buffer>();
    const archive = {
      putIfAbsent: async ({ key, body }: { key: string; body: Buffer }) => {
        if (objects.has(key)) return 'exists' as const;
        objects.set(key, Buffer.from(body));
        return 'written' as const;
      },
      readObject: async (key: string) => objects.get(key) || null,
    };
    const pointer = await archiveCaseGraphContentSearchIndex({ ...build, archive });
    expect(pointer).toMatchObject({
      indexManifestDigest: build.manifest.manifestDigest,
      shardCount: 3, entryCount: 3, pointerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(verifyCaseGraphContentSearchArchivePointer({ value: pointer, ...build })).toEqual(pointer);
    expect(() => verifyCaseGraphContentSearchArchivePointer({
      value: { ...pointer, shardObjects: [{ ...pointer.shardObjects[0], objectKey: 'wrong' }, ...pointer.shardObjects.slice(1)] },
      ...build,
    })).toThrow('case_graph_content_search_archive_pointer_integrity_failed');
    expect(objects.size).toBe(4);
    const corruptArchive = {
      ...archive,
      readObject: async () => Buffer.from('corrupt'),
    };
    await expect(archiveCaseGraphContentSearchIndex({ ...build, archive: corruptArchive }))
      .rejects.toThrow('case_graph_content_search_archive_read_after_write_mismatch');
  });
});
