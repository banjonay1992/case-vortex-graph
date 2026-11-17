import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from '../../src/caseGraph/archiveKeys';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
  type EvidenceUniversePart,
} from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  projectEvidenceUniverseNode,
} from '../../src/caseGraph/evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
} from '../../src/caseGraph/postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';
import {
  decodeEvidenceUniverseCompletion,
  decodeEvidenceUniverseNodePart,
  loadEvidenceUniverseCompletion,
  projectEvidenceUniverseManifest,
  readEvidenceUniversePart,
} from '../../src/caseGraph/evidenceUniversePublicAccess';

const sha = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const archiveSetSha = (parts: EvidenceUniversePart[]) => sha(
  parts.map((part) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n'),
);
const corpusVersion = 'universe-public-test';
const archive = Buffer.from('compressed-node-bytes');
const keys = getEvidenceUniversePartKeys(corpusVersion, 'sighting', 0);
const sightingPart: EvidenceUniversePart = {
  partNumber: 0,
  kind: 'sighting',
  rowCount: 1,
  archiveKey: keys.archiveKey,
  manifestKey: keys.manifestKey,
  compressedBytes: archive.length,
  uncompressedBytes: 100,
  sha256: sha(archive),
  firstAddress: 'sighting:case-1',
  lastAddress: 'sighting:case-1',
  cursor: { updated_at: '2026-07-17T16:00:00.000Z', case_id: 'case-1' },
  accounting: {
    total: 1,
    byKind: { sighting: 1, document: 0, photo: 0, video: 0 },
    attachedMedia: 0,
    unresolvedTime: 0,
    unresolvedLocation: 0,
  },
};
const completion: EvidenceUniverseCompletion = {
  recordType: 'evidence_universe_completion',
  archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  corpusVersion,
  expected: {
    snapshotId: '33333333-3333-4333-8333-333333333333',
    snapshotAt: '2026-07-17T17:00:00.000Z',
    materializedAt: '2026-07-17T16:59:59.999321Z',
    sourceMvccSnapshot: '100:200:',
    snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capturePolicies: {
      sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
      document: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      photo: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      video: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
    },
    byKind: { sighting: 1, document: 0, photo: 0, video: 0 },
    total: 1,
    sightingPolicy: 'governed-test',
    mediaBackfillsComplete: { document: true, photo: true, video: true },
  },
  exportedByKind: { sighting: 1, document: 0, photo: 0, video: 0 },
  cursors: {
    sighting: { updated_at: '2026-07-17T16:00:00.000Z', case_id: 'case-1' },
    document: null,
    photo: null,
    video: null,
  },
  parts: [sightingPart],
  accounting: {
    total: 1,
    byKind: { sighting: 1, document: 0, photo: 0, video: 0 },
    attachedMedia: 0,
    unresolvedTime: 0,
    unresolvedLocation: 0,
  },
  archiveSetSha256: archiveSetSha([sightingPart]),
  completedAt: '2026-07-17T18:00:00.000Z',
};

const body = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('evidence universe public archive access', () => {
  it('accepts the UUIDv7 snapshot identifiers used by strict publication-v2 lineage', () => {
    const v7 = structuredClone(completion);
    v7.expected.snapshotId = '018f47ef-4fb0-7e2a-8b5c-5bd3909f7101';
    expect(decodeEvidenceUniverseCompletion(Buffer.from(JSON.stringify(v7)), corpusVersion).expected.snapshotId)
      .toBe(v7.expected.snapshotId);
  });

  it('rejects pre-snapshot v2 archive completions and missing global policy receipts', () => {
    expect(EVIDENCE_UNIVERSE_ARCHIVE_VERSION).toBe('evidence-universe-archive-v3');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      archiveVersion: 'evidence-universe-archive-v2',
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      expected: { ...completion.expected, snapshotPolicy: undefined },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      expected: { ...completion.expected, sourceMvccSnapshot: 'not-an-mvcc-receipt' },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      expected: {
        ...completion.expected,
        capturePolicies: { ...completion.expected.capturePolicies, video: 'legacy-live-query' },
      },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
  });

  it('rejects v1 completion artifacts after the v2 position-layout migration', () => {
    expect(EVIDENCE_UNIVERSE_SCHEMA_VERSION).toBe('evidence-universe-v2');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      schemaVersion: 'evidence-universe-v1',
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
  });

  it('loads, validates and projects an exact node manifest with corpus and content-addressed shard URLs', async () => {
    const objects = new Map([[getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey, body(completion)]]);
    const storage = { readObject: async (key: string) => objects.get(key) || null };
    const loaded = await loadEvidenceUniverseCompletion(storage, corpusVersion);
    expect(loaded).toEqual(completion);
    expect(projectEvidenceUniverseManifest(loaded!).parts[0]).toMatchObject({
      kind: 'sighting',
      rowCount: 1,
      url: `/api/public/case-vortex/universe/corpora/${corpusVersion}/shards/sighting/0/${sightingPart.sha256}`,
    });
    expect(projectEvidenceUniverseManifest(loaded!)).toMatchObject({
      snapshotId: completion.expected.snapshotId,
      snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      schemaVersion: 'evidence-universe-v2',
      layoutVersion: 'evidence-universe-layout-v2',
    });
    const secondCorpus = { ...completion, corpusVersion: 'universe-public-test-v2' };
    expect(projectEvidenceUniverseManifest(secondCorpus).parts[0].url)
      .not.toBe(projectEvidenceUniverseManifest(completion).parts[0].url);
  });

  it('accepts only a canonical seed fingerprint on a completed seeded corpus', () => {
    const seeded = { ...completion, seedFingerprint: 'a'.repeat(64) };
    expect(decodeEvidenceUniverseCompletion(body(seeded), corpusVersion)).toEqual(seeded);
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      seedFingerprint: 'A'.repeat(64),
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
  });

  it('serves a shard only when its compressed bytes match the manifest', async () => {
    await expect(readEvidenceUniversePart({ readObject: async () => archive }, completion, 'sighting', 0))
      .resolves.toEqual({ part: completion.parts[0], body: archive });
    await expect(readEvidenceUniversePart({ readObject: async () => Buffer.from('bad') }, completion, 'sighting', 0))
      .rejects.toThrow('evidence_universe_public_part_checksum_mismatch');
  });

  it('strictly decodes canonical universe nodes and reconciles the part accounting receipt', () => {
    const node = projectEvidenceUniverseNode({
      kind: 'sighting',
      recordId: 'case-1',
      source: 'governed-test',
      sourceRecordId: 'source-case-1',
      title: 'Light',
      summary: 'A steady light crossed the sky.',
      canonicalUrl: 'https://example.test/case-1',
      previewUrl: null,
      eventTimestamp: '2026-07-17T15:00:00.000Z',
      lat: 51.5,
      lon: -0.1,
      location: 'London',
      countryCode: 'GB',
      linkedSightingId: null,
      updatedAt: '2026-07-17T16:00:00.000Z',
      public: true,
    });
    const raw = Buffer.from(`${JSON.stringify(node)}\n`);
    const compressed = gzipSync(raw);
    const part: EvidenceUniversePart = {
      ...sightingPart,
      compressedBytes: compressed.length,
      uncompressedBytes: raw.length,
      sha256: sha(compressed),
      firstAddress: node.address,
      lastAddress: node.address,
      accounting: {
        total: 1,
        byKind: { sighting: 1, document: 0, photo: 0, video: 0 },
        attachedMedia: 0,
        unresolvedTime: 0,
        unresolvedLocation: 0,
      },
    };
    expect(decodeEvidenceUniverseNodePart(compressed, part)).toEqual({
      part,
      nodes: [node],
      accounting: part.accounting,
    });

    const tamperedRaw = Buffer.from(`${JSON.stringify({ ...node, position: [9, 9, 9] })}\n`);
    const tamperedCompressed = gzipSync(tamperedRaw);
    expect(() => decodeEvidenceUniverseNodePart(tamperedCompressed, {
      ...part,
      compressedBytes: tamperedCompressed.length,
      uncompressedBytes: tamperedRaw.length,
      sha256: sha(tamperedCompressed),
    })).toThrow('evidence_universe_node_part_record_non_canonical');
    expect(() => decodeEvidenceUniverseNodePart(compressed, {
      ...part,
      accounting: { ...part.accounting, unresolvedTime: 1 },
    })).toThrow('evidence_universe_node_part_accounting_mismatch');
  });

  it('requires the exact ordered archive-set digest, including sha256 of the empty sequence', () => {
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      archiveSetSha256: sha('arbitrary-completion-marker'),
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');

    const emptyCompletion: EvidenceUniverseCompletion = {
      ...completion,
      expected: {
        ...completion.expected,
        byKind: { sighting: 0, document: 0, photo: 0, video: 0 },
        total: 0,
      },
      exportedByKind: { sighting: 0, document: 0, photo: 0, video: 0 },
      cursors: { sighting: null, document: null, photo: null, video: null },
      parts: [],
      accounting: {
        total: 0,
        byKind: { sighting: 0, document: 0, photo: 0, video: 0 },
        attachedMedia: 0,
        unresolvedTime: 0,
        unresolvedLocation: 0,
      },
      archiveSetSha256: sha(''),
    };
    expect(decodeEvidenceUniverseCompletion(body(emptyCompletion), corpusVersion)).toEqual(emptyCompletion);
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...emptyCompletion,
      archiveSetSha256: 'a'.repeat(64),
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
  });

  it('rejects incomplete media backfills and unsafe, negative, or drifted completion totals', () => {
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      expected: {
        ...completion.expected,
        mediaBackfillsComplete: { document: true, photo: false, video: true },
      },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      exportedByKind: { ...completion.exportedByKind, sighting: -1 },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      expected: { ...completion.expected, total: Number.MAX_SAFE_INTEGER + 1 },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      accounting: { ...completion.accounting, byKind: { ...completion.accounting.byKind, sighting: 0 } },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
  });

  it('rejects tampered part hashes, keys, ordering and cursor receipts', () => {
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      parts: [{ ...sightingPart, sha256: 'b'.repeat(64) }],
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      parts: [{ ...sightingPart, archiveKey: 'attacker-controlled.ndjson.gz' }],
    }), corpusVersion)).toThrow('evidence_universe_public_part_key_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      cursors: { ...completion.cursors, sighting: { updated_at: '2026-07-17T15:00:00.000Z', case_id: 'case-1' } },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');

    const documentKeys = getEvidenceUniversePartKeys(corpusVersion, 'document', 0);
    const documentPart: EvidenceUniversePart = {
      ...sightingPart,
      kind: 'document',
      archiveKey: documentKeys.archiveKey,
      manifestKey: documentKeys.manifestKey,
      firstAddress: 'document:doc-1',
      lastAddress: 'document:doc-1',
      cursor: { updatedAt: '2026-07-17T16:30:00.000000Z', recordId: 'doc-1' },
      accounting: {
        ...sightingPart.accounting,
        byKind: { sighting: 0, document: 1, photo: 0, video: 0 },
      },
    };
    const reversedParts = [documentPart, sightingPart];
    const reversed = {
      ...completion,
      expected: {
        ...completion.expected,
        byKind: { sighting: 1, document: 1, photo: 0, video: 0 },
        total: 2,
      },
      exportedByKind: { sighting: 1, document: 1, photo: 0, video: 0 },
      cursors: {
        ...completion.cursors,
        document: { updatedAt: '2026-07-17T16:30:00.000000Z', recordId: 'doc-1' },
      },
      parts: reversedParts,
      accounting: {
        ...completion.accounting,
        total: 2,
        byKind: { sighting: 1, document: 1, photo: 0, video: 0 },
      },
      archiveSetSha256: archiveSetSha(reversedParts),
    };
    expect(() => decodeEvidenceUniverseCompletion(body(reversed), corpusVersion))
      .toThrow('evidence_universe_public_part_order_invalid');
  });

  it('rejects a record-id regression when adjacent parts share a timestamp', () => {
    const secondKeys = getEvidenceUniversePartKeys(corpusVersion, 'sighting', 1);
    const firstPart: EvidenceUniversePart = {
      ...sightingPart,
      firstAddress: 'sighting:case-z',
      lastAddress: 'sighting:case-z',
      cursor: { updated_at: '2026-07-17T16:00:00.000Z', case_id: 'case-z' },
    };
    const secondPart: EvidenceUniversePart = {
      ...sightingPart,
      partNumber: 1,
      archiveKey: secondKeys.archiveKey,
      manifestKey: secondKeys.manifestKey,
      firstAddress: 'sighting:case-a',
      lastAddress: 'sighting:case-a',
      cursor: { updated_at: '2026-07-17T16:00:00.000Z', case_id: 'case-a' },
    };
    const parts = [firstPart, secondPart];
    const regressing = {
      ...completion,
      expected: {
        ...completion.expected,
        byKind: { sighting: 2, document: 0, photo: 0, video: 0 },
        total: 2,
      },
      exportedByKind: { sighting: 2, document: 0, photo: 0, video: 0 },
      cursors: {
        ...completion.cursors,
        sighting: { updated_at: '2026-07-17T16:00:00.000Z', case_id: 'case-a' },
      },
      parts,
      accounting: {
        ...completion.accounting,
        total: 2,
        byKind: { sighting: 2, document: 0, photo: 0, video: 0 },
      },
      archiveSetSha256: archiveSetSha(parts),
    };
    expect(() => decodeEvidenceUniverseCompletion(body(regressing), corpusVersion))
      .toThrow('evidence_universe_public_part_order_invalid');
  });

  it('rejects impossible or non-canonical completion and cursor timestamps', () => {
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      completedAt: '2026-07-17T16:59:59.000Z',
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      completedAt: '2026-07-17T18:00:00Z',
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      parts: [{
        ...sightingPart,
        cursor: { updated_at: '2026-07-17T17:00:00.000001Z', case_id: 'case-1' },
      }],
      cursors: {
        ...completion.cursors,
        sighting: { updated_at: '2026-07-17T17:00:00.000001Z', case_id: 'case-1' },
      },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
  });

  it('rejects manifest accounting drift and malformed requests', async () => {
    expect(() => decodeEvidenceUniverseCompletion(body({
      ...completion,
      accounting: { ...completion.accounting, total: 2 },
    }), corpusVersion)).toThrow('evidence_universe_public_manifest_invalid');
    await expect(readEvidenceUniversePart({ readObject: async () => null }, completion, 'audio' as any, 0))
      .rejects.toThrow('evidence_universe_public_part_request_invalid');
  });
});
