import { describe, expect, it, vi } from 'vitest';

import {
  buildCaseGraphContentDiscoveryManifestFromNodeShards,
  CASE_GRAPH_CONTENT_DISCOVERY_POLICY,
  makeCaseGraphContentDiscoveryRecordFromPublicNode,
} from '../../src/caseGraph/contentResearchDiscovery';
import { makeCaseGraphContentLimitsProfile } from '../../src/caseGraph/contentResearchArchive';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';
import type { FullCorpusPublicNode } from '../../src/caseGraph/typedRelationshipPublicGraph';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'content-discovery-test-v1',
  manifestSha256: digest('1'),
  snapshotId: 'snapshot-content-test',
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
  profileId: 'content-discovery-test-limits',
  maxAssetBytes: 10_000_000,
  maxDocumentPages: 1_000,
  maxImagePixels: 50_000_000,
  maxTimedMediaDurationMs: 3_600_000,
  maxChunkTextBytes: 32_000,
  maxTotalTextBytesPerAsset: 4_000_000,
  maxChunksPerAsset: 10_000,
});

const node = (
  kind: FullCorpusPublicNode['kind'],
  id: string,
  overrides: Partial<FullCorpusPublicNode> = {},
) => ({
  recordType: 'full_corpus_public_node',
  address: `${kind}:${id}`,
  kind,
  nodeDigest: digest(id.slice(-1)),
  source: 'official-test',
  sourceRecordId: `source-${id}`,
  canonicalUrl: `https://example.test/${id}`,
  previewUrl: null,
  updatedAt: '2026-07-19T12:00:00.000Z',
  ...overrides,
}) as FullCorpusPublicNode;

describe('publication-bound full-content discovery', () => {
  it('maps every media node, skips sightings and preserves unresolved locators for accounting', async () => {
    const shards = [
      [node('sighting', '1'), node('document', '2')],
      [node('photo', '3', { canonicalUrl: null, previewUrl: 'https://example.test/photo-3.jpg' })],
      [node('video', '4', { canonicalUrl: null, previewUrl: null })],
    ];
    const progress: number[] = [];
    const manifest = await buildCaseGraphContentDiscoveryManifestFromNodeShards({
      publication,
      nodeShardCount: shards.length,
      readNodeShard: async (shard) => shards[shard],
      upstreamEnumerationReceiptSha256: digest('6'),
      limitsProfile,
      limitsApprovalReceiptSha256: digest('7'),
      maximumConcurrentReads: 2,
      onShardComplete: ({ completedShards }) => progress.push(completedShards),
    });

    expect(manifest.recordCount).toBe(3);
    expect(manifest.records.map(({ address }) => address).sort()).toEqual([
      'document:2', 'photo:3', 'video:4',
    ]);
    expect(manifest.records.find(({ address }) => address === 'document:2')).toMatchObject({
      mediaKind: 'document',
      claimedMimeType: 'application/octet-stream',
      sourceAssetKey: 'canonical-url:https://example.test/2',
    });
    expect(manifest.records.find(({ address }) => address === 'photo:3')).toMatchObject({
      mediaKind: 'image',
      sourceAssetKey: 'preview-url:https://example.test/photo-3.jpg',
    });
    expect(manifest.records.find(({ address }) => address === 'video:4')?.sourceAssetKey)
      .toBe(`${CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unresolvedLocatorPrefix}video:4`);
    expect(progress.sort((left, right) => left - right)).toEqual([1, 2, 3]);
  });

  it('is deterministic when shard completion order changes', async () => {
    const shards = [[node('document', 'a')], [node('photo', 'b')], [node('video', 'c')]];
    const build = (delays: number[]) => buildCaseGraphContentDiscoveryManifestFromNodeShards({
      publication,
      nodeShardCount: shards.length,
      readNodeShard: async (shard) => {
        await new Promise((resolve) => setTimeout(resolve, delays[shard]));
        return shards[shard];
      },
      upstreamEnumerationReceiptSha256: digest('6'),
      limitsProfile,
      limitsApprovalReceiptSha256: digest('7'),
      maximumConcurrentReads: 3,
    });
    expect(await build([8, 1, 4])).toEqual(await build([1, 8, 4]));
  });

  it('rejects duplicate addresses, invalid plans and aborts before reading', async () => {
    await expect(buildCaseGraphContentDiscoveryManifestFromNodeShards({
      publication,
      nodeShardCount: 2,
      readNodeShard: async () => [node('document', 'duplicate')],
      upstreamEnumerationReceiptSha256: digest('6'),
      limitsProfile,
      limitsApprovalReceiptSha256: digest('7'),
    })).rejects.toThrow('case_graph_content_discovery_address_duplicate');

    await expect(buildCaseGraphContentDiscoveryManifestFromNodeShards({
      publication,
      nodeShardCount: 0,
      readNodeShard: async () => [],
      upstreamEnumerationReceiptSha256: digest('6'),
      limitsProfile,
      limitsApprovalReceiptSha256: digest('7'),
    })).rejects.toThrow('case_graph_content_discovery_plan_invalid');

    const controller = new AbortController();
    controller.abort();
    const readNodeShard = vi.fn(async () => []);
    await expect(buildCaseGraphContentDiscoveryManifestFromNodeShards({
      publication,
      nodeShardCount: 1,
      readNodeShard,
      upstreamEnumerationReceiptSha256: digest('6'),
      limitsProfile,
      limitsApprovalReceiptSha256: digest('7'),
      signal: controller.signal,
    })).rejects.toThrow('case_graph_content_discovery_aborted');
    expect(readNodeShard).not.toHaveBeenCalled();
  });

  it('binds locator and source-lineage drift into distinct discovery identities', () => {
    const first = makeCaseGraphContentDiscoveryRecordFromPublicNode({
      publication,
      node: node('document', '9'),
    });
    const locatorDrift = makeCaseGraphContentDiscoveryRecordFromPublicNode({
      publication,
      node: node('document', '9', { canonicalUrl: 'https://example.test/changed.pdf' }),
    });
    const lineageDrift = makeCaseGraphContentDiscoveryRecordFromPublicNode({
      publication,
      node: node('document', '9', { updatedAt: '2026-07-19T12:00:01.000Z' }),
    });
    expect(first?.discoveryId).not.toBe(locatorDrift?.discoveryId);
    expect(first?.discoveryId).not.toBe(lineageDrift?.discoveryId);
  });
});
