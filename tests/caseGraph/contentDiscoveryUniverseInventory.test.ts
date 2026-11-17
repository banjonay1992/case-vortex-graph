import { describe, expect, it } from 'vitest';

import {
  createContentDiscoveryUniverseInventoryScan,
  verifyContentDiscoveryUniverseInventoryReceipt,
} from '../../src/caseGraph/contentDiscoveryUniverseInventory';
import {
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from '../../src/caseGraph/evidenceUniverse';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const kinds: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];

const node = (
  kind: EvidenceUniverseNodeKind,
  options: { canonicalUrl?: string | null; previewUrl?: string | null } = {},
): EvidenceUniverseNode => projectEvidenceUniverseNode({
  kind,
  recordId: `${kind}-1`,
  source: kind === 'photo' ? 'SOURCE-B' : 'SOURCE-A',
  sourceRecordId: `${kind}-source-1`,
  title: `${kind} title`,
  summary: null,
  canonicalUrl: options.canonicalUrl ?? null,
  previewUrl: options.previewUrl ?? null,
  eventTimestamp: '2024-01-01T12:00:00.000Z',
  lat: 51.5,
  lon: -0.1,
  location: 'London',
  countryCode: 'GB',
  linkedSightingId: kind === 'sighting' ? null : 'sighting-1',
  updatedAt: '2026-07-27T12:00:00.000Z',
  public: true,
});

const fixture = () => {
  const nodes = [
    [node('sighting')],
    [node('document', {
      canonicalUrl: 'https://example.test/document',
      previewUrl: 'https://example.test/document-preview',
    })],
    [node('photo', { previewUrl: 'https://example.test/photo-preview' })],
    [node('video')],
  ];
  const parts = kinds.map((kind, index) => ({
    partNumber: index + 1,
    kind,
    rowCount: 1,
    archiveKey: `universe/${kind}.jsonl.gz`,
    manifestKey: `universe/${kind}.manifest.json`,
    compressedBytes: 100,
    uncompressedBytes: 200,
    sha256: relationshipInputSha256(`${kind}:part`),
    firstAddress: nodes[index][0].address,
    lastAddress: nodes[index][0].address,
    cursor: kind === 'sighting'
      ? { updated_at: '2026-07-27T12:00:00.000Z', case_id: 'sighting-1' }
      : { updatedAt: '2026-07-27T12:00:00.000Z', recordId: `${kind}-1` },
    accounting: {
      total: 1,
      byKind: Object.fromEntries(kinds.map((candidate) => [
        candidate,
        candidate === kind ? 1 : 0,
      ])),
      attachedMedia: kind === 'sighting' ? 0 : 1,
      unresolvedTime: 0,
      unresolvedLocation: 0,
    },
  }));
  const completion = {
    recordType: 'evidence_universe_completion',
    archiveVersion: 'evidence-universe-archive-v3',
    schemaVersion: 'evidence-universe-v2',
    layoutVersion: 'evidence-universe-layout-v2',
    corpusVersion: 'corpus-v1',
    expected: {
      snapshotId: '123e4567-e89b-42d3-a456-426614174000',
      byKind: { sighting: 1, document: 1, photo: 1, video: 1 },
      total: 4,
    },
    parts,
    archiveSetSha256: relationshipInputSha256('archive-set'),
  } as any;
  return { completion, nodes, parts };
};

describe('content discovery universe inventory', () => {
  it('accounts for every node and applies canonical, preview, unresolved precedence', () => {
    const { completion, nodes, parts } = fixture();
    const scan = createContentDiscoveryUniverseInventoryScan({
      completion,
      builtAt: '2026-07-27T18:00:00.000Z',
    });
    parts.forEach((part: any, index: number) => scan.addPart(part, nodes[index]));
    const receipt = scan.finalize();

    expect(receipt.accounting).toMatchObject({
      scannedRecordCount: 4,
      scannedPartCount: 4,
      contentRecordCount: 3,
      nonContentSightingCount: 1,
      byKind: { sighting: 1, document: 1, photo: 1, video: 1 },
      locatorCounts: { canonical_url: 1, preview_url: 1, unresolved: 1 },
      resolvedLocatorCount: 2,
      unresolvedLocatorCount: 1,
      bySource: [
        { source: 'SOURCE-A', recordCount: 2 },
        { source: 'SOURCE-B', recordCount: 1 },
      ],
    });
    expect(receipt.guarantees).toMatchObject({
      allUniversePartsReplayed: true,
      contentBytesRead: 0,
      providerCalls: 0,
      storageWrites: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    });
    expect(verifyContentDiscoveryUniverseInventoryReceipt(receipt)).toEqual(receipt);
  });

  it('fails closed on tampering, duplicate addresses, missing parts and wrong order', () => {
    const { completion, nodes, parts } = fixture();
    const scan = createContentDiscoveryUniverseInventoryScan({
      completion,
      builtAt: '2026-07-27T18:00:00.000Z',
    });
    parts.forEach((part: any, index: number) => scan.addPart(part, nodes[index]));
    const receipt = scan.finalize();
    expect(() => verifyContentDiscoveryUniverseInventoryReceipt({
      ...receipt,
      accounting: { ...receipt.accounting, contentRecordCount: 2 },
    })).toThrow('content_discovery_inventory_receipt_digest_mismatch');

    const duplicate = fixture();
    duplicate.nodes[1] = [duplicate.nodes[1][0], duplicate.nodes[1][0]];
    duplicate.parts[1] = {
      ...duplicate.parts[1],
      rowCount: 2,
    };
    duplicate.completion.parts = duplicate.parts;
    duplicate.completion.expected.total = 5;
    duplicate.completion.expected.byKind.document = 2;
    const duplicateScan = createContentDiscoveryUniverseInventoryScan({
      completion: duplicate.completion,
      builtAt: '2026-07-27T18:00:00.000Z',
    });
    duplicateScan.addPart(duplicate.parts[0] as any, duplicate.nodes[0]);
    expect(() => duplicateScan.addPart(
      duplicate.parts[1] as any,
      duplicate.nodes[1],
    )).toThrow('content_discovery_inventory_address_duplicate');

    const missingScan = createContentDiscoveryUniverseInventoryScan({
      completion,
      builtAt: '2026-07-27T18:00:00.000Z',
    });
    expect(() => missingScan.finalize()).toThrow(
      'content_discovery_inventory_accounting_invalid',
    );

    const wrongOrderScan = createContentDiscoveryUniverseInventoryScan({
      completion,
      builtAt: '2026-07-27T18:00:00.000Z',
    });
    expect(() => wrongOrderScan.addPart(parts[1] as any, nodes[1])).toThrow(
      'content_discovery_inventory_part_invalid',
    );
  });
});
