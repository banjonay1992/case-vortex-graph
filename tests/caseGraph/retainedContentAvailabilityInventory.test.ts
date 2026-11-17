import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRetainedContentAvailabilityScan,
  decodeRetainedContentAvailabilityRoutes,
  retainedArchiveCandidateKey,
  verifyRetainedContentAvailabilityReceipt,
} from '../../src/caseGraph/retainedContentAvailabilityInventory';
import {
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from '../../src/caseGraph/evidenceUniverse';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const kinds: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const host = 'public.example.r2.dev';

const node = (params: {
  kind: EvidenceUniverseNodeKind;
  id: string;
  canonicalUrl?: string | null;
  previewUrl?: string | null;
}): EvidenceUniverseNode => projectEvidenceUniverseNode({
  kind: params.kind,
  recordId: params.id,
  source: params.kind === 'photo' ? 'SOURCE-B' : 'SOURCE-A',
  sourceRecordId: params.id,
  title: params.id,
  summary: null,
  canonicalUrl: params.canonicalUrl ?? null,
  previewUrl: params.previewUrl ?? null,
  eventTimestamp: null,
  lat: null,
  lon: null,
  location: null,
  countryCode: null,
  linkedSightingId: null,
  updatedAt: '2026-07-27T12:00:00.000Z',
  public: true,
});

const fixture = () => {
  const nodes = [
    [node({ kind: 'sighting', id: 'sighting-1' })],
    [
      node({
        kind: 'document',
        id: 'retained',
        canonicalUrl: `https://${host}/retained/a%20file.pdf`,
      }),
      node({ kind: 'document', id: 'unresolved' }),
    ],
    [node({
      kind: 'photo',
      id: 'missing',
      canonicalUrl: `https://${host}/retained/missing.jpg`,
    })],
    [node({
      kind: 'video',
      id: 'external',
      canonicalUrl: 'https://external.example/video.mp4',
    })],
  ];
  const byKind = { sighting: 1, document: 2, photo: 1, video: 1 };
  const parts = kinds.map((kind, index) => ({
    partNumber: index + 1,
    kind,
    rowCount: nodes[index].length,
    archiveKey: `universe/${kind}.jsonl.gz`,
    manifestKey: `universe/${kind}.manifest.json`,
    compressedBytes: 100,
    uncompressedBytes: 200,
    sha256: relationshipInputSha256(`${kind}:part`),
    firstAddress: nodes[index][0].address,
    lastAddress: nodes[index].at(-1)!.address,
    cursor: kind === 'sighting'
      ? { updated_at: '2026-07-27T12:00:00.000Z', case_id: 'sighting-1' }
      : { updatedAt: '2026-07-27T12:00:00.000Z', recordId: nodes[index].at(-1)!.recordId },
    accounting: {
      total: nodes[index].length,
      byKind: Object.fromEntries(kinds.map((candidate) => [
        candidate,
        candidate === kind ? nodes[index].length : 0,
      ])),
      attachedMedia: 0,
      unresolvedTime: nodes[index].length,
      unresolvedLocation: nodes[index].length,
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
      byKind,
      total: 5,
    },
    parts,
    archiveSetSha256: relationshipInputSha256('archive-set'),
  } as any;
  return { completion, nodes, parts };
};

describe('retained content availability inventory', () => {
  it('routes exact archive keys separately from missing, external and unresolved content', () => {
    const { completion, nodes, parts } = fixture();
    const scan = createRetainedContentAvailabilityScan({
      completion,
      builtAt: '2026-07-27T20:00:00.000Z',
      publicArchiveHost: host,
      listedPrefixes: ['retained'],
      listedArchiveKeys: ['retained/a file.pdf', 'retained/unreferenced.bin'],
      contentInventoryReceiptDigest: 'a'.repeat(64),
      contentInventorySetSha256: 'b'.repeat(64),
      contentRecordCount: 4,
    });
    parts.forEach((part: any, index: number) => scan.addPart(part, nodes[index]));
    const result = scan.finalize();

    expect(result.receipt.accounting).toMatchObject({
      scannedRecordCount: 5,
      contentRecordCount: 4,
      statusCounts: {
        retained_archive_object: 1,
        archive_locator_missing: 1,
        external_retrieval_required: 1,
        unresolved_locator: 1,
      },
      retainedArchiveObjectCount: 1,
      externalOrMissingCount: 3,
    });
    expect(result.routes.map(({ address, availability, archiveKey }) => ({
      address,
      availability,
      archiveKey,
    }))).toEqual([
      {
        address: 'document:retained',
        availability: 'retained_archive_object',
        archiveKey: 'retained/a file.pdf',
      },
      {
        address: 'document:unresolved',
        availability: 'unresolved_locator',
        archiveKey: null,
      },
      {
        address: 'photo:missing',
        availability: 'archive_locator_missing',
        archiveKey: 'retained/missing.jpg',
      },
      {
        address: 'video:external',
        availability: 'external_retrieval_required',
        archiveKey: null,
      },
    ]);
    expect(result.receipt.guarantees).toMatchObject({
      contentBytesRead: 0,
      objectIntegrityProven: false,
      providerCalls: 0,
      storageWrites: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    });
    expect(verifyRetainedContentAvailabilityReceipt({
      value: result.receipt,
      routesBody: result.routesBody,
    })).toEqual(result.receipt);
    expect(decodeRetainedContentAvailabilityRoutes({
      receipt: result.receipt,
      routesBody: result.routesBody,
    })).toEqual(result.routes);
  });

  it('rejects route tampering and only derives safe exact archive paths', () => {
    const { completion, nodes, parts } = fixture();
    const scan = createRetainedContentAvailabilityScan({
      completion,
      builtAt: '2026-07-27T20:00:00.000Z',
      publicArchiveHost: host,
      listedPrefixes: ['retained'],
      listedArchiveKeys: ['retained/a file.pdf'],
      contentInventoryReceiptDigest: 'a'.repeat(64),
      contentInventorySetSha256: 'b'.repeat(64),
      contentRecordCount: 4,
    });
    parts.forEach((part: any, index: number) => scan.addPart(part, nodes[index]));
    const result = scan.finalize();
    const tampered = Buffer.from(result.routesBody);
    tampered[0] ^= 1;
    expect(() => verifyRetainedContentAvailabilityReceipt({
      value: result.receipt,
      routesBody: tampered,
    })).toThrow('retained_content_availability_routes_digest_mismatch');
    const semanticTamper = Buffer.from(result.routesBody.toString('utf8').replace(
      '"availability":"retained_archive_object"',
      '"availability":"external_retrieval_required"',
    ));
    const semanticReceipt = {
      ...result.receipt,
      routesFileSha256: createHash('sha256').update(semanticTamper).digest('hex'),
    };
    const { receiptDigest: _receiptDigest, ...semanticCore } = semanticReceipt;
    const resealed = {
      ...semanticCore,
      receiptDigest: relationshipInputSha256(semanticCore),
    };
    expect(() => decodeRetainedContentAvailabilityRoutes({
      receipt: resealed,
      routesBody: semanticTamper,
    })).toThrow();

    expect(retainedArchiveCandidateKey(nodes[1][0], host)).toBe(
      'retained/a file.pdf',
    );
    expect(retainedArchiveCandidateKey({
      ...nodes[1][0],
      canonicalUrl: `https://${host}/retained/a.pdf?download=1`,
    }, host)).toBeNull();
    expect(retainedArchiveCandidateKey(nodes[3][0], host)).toBeNull();
  });
});
