import { describe, expect, it } from 'vitest';

import {
  buildFullCorpusPublicDensityArchiveObject,
  buildFullCorpusPublicDensityArtifact,
  decodeFullCorpusPublicDensityArchiveObject,
  decodeFullCorpusPublicDensityArtifact,
  decodeFullCorpusPublicDensityPointer,
  encodeFullCorpusPublicDensityArtifact,
  type FullCorpusPublicDensityNodeInput,
} from '../../src/caseGraph/typedPublicDensity';

const corpusVersion = 'typed-public-density-test-v2';
const snapshotId = '00000000-0000-4000-8000-000000000099';
const publicGraphManifestDigest = 'a'.repeat(64);

const nodes: FullCorpusPublicDensityNodeInput[] = [
  {
    address: 'sighting:00000000-0000-4000-8000-000000000001',
    kind: 'sighting',
    source: 'official',
    eventTimestamp: '2026-01-01T00:00:00.000Z',
    lat: 51,
    lon: -1,
    degree: 1,
    relationshipStatus: 'linked',
  },
  {
    address: 'document:doc-1',
    kind: 'document',
    source: 'research',
    eventTimestamp: null,
    lat: null,
    lon: null,
    degree: 0,
    relationshipStatus: 'candidate_only',
  },
  {
    address: 'photo:photo-1',
    kind: 'photo',
    source: 'community',
    eventTimestamp: '2026-01-01T00:00:00.000Z',
    lat: 51,
    lon: -1,
    degree: 0,
    relationshipStatus: 'isolated',
  },
];

const build = () => buildFullCorpusPublicDensityArtifact({
  corpusVersion,
  snapshotId,
  publicGraphManifestDigest,
  nodes,
});

describe('full-corpus public typed density v2', () => {
  it('accounts every evidence-address kind and relationship state in both zoom levels', () => {
    const artifact = build();
    expect(artifact).toMatchObject({
      nodeCount: 3,
      byKind: { sighting: 1, document: 1, photo: 1, video: 0 },
      byRelationshipStatus: { linked: 1, candidate_only: 1, isolated: 1 },
      accounting: { macroNodeCount: 3, regionalNodeCount: 3, unknownGeoNodeCount: 1, unknownTimeNodeCount: 1 },
    });
    expect(artifact.levels.macro.flatMap((cell) => Object.keys(cell.byKind))).toContain('document');
    expect(decodeFullCorpusPublicDensityArtifact(encodeFullCorpusPublicDensityArtifact(artifact))).toEqual(artifact);
  });

  it('binds canonical artifact bytes to a content-addressed compressed pointer', () => {
    const archived = buildFullCorpusPublicDensityArchiveObject(build());
    expect(decodeFullCorpusPublicDensityPointer(archived.pointer)).toEqual(archived.pointer);
    expect(decodeFullCorpusPublicDensityArchiveObject(archived)).toEqual(archived.artifact);
    const tampered = Buffer.from(archived.body);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decodeFullCorpusPublicDensityArchiveObject({ pointer: archived.pointer, body: tampered }))
      .toThrow('public_typed_density_archive_checksum_mismatch');
  });

  it('rejects duplicate addresses, inconsistent status/degree, hidden fields and digest tampering', () => {
    expect(() => buildFullCorpusPublicDensityArtifact({
      corpusVersion, snapshotId, publicGraphManifestDigest, nodes: [nodes[0], nodes[0]],
    })).toThrow('public_typed_density_duplicate_node');
    expect(() => buildFullCorpusPublicDensityArtifact({
      corpusVersion, snapshotId, publicGraphManifestDigest,
      nodes: [{ ...nodes[1], relationshipStatus: 'linked' }],
    })).toThrow('public_typed_density_degree_status_mismatch');
    const hidden = structuredClone(build()) as unknown as Record<string, unknown>;
    hidden.unbound = true;
    expect(() => decodeFullCorpusPublicDensityArtifact(hidden)).toThrow('public_typed_density_invalid');
    const tampered = structuredClone(build());
    tampered.byKind.video = 1;
    expect(() => decodeFullCorpusPublicDensityArtifact(tampered)).toThrow('public_typed_density_accounting_invalid');

    const cellTamper = structuredClone(build());
    cellTamper.levels.macro[0].byKind.video = 1;
    cellTamper.artifactDigest = '0'.repeat(64);
    expect(() => decodeFullCorpusPublicDensityArtifact(cellTamper)).toThrow('public_typed_density_cell_accounting_invalid');
  });
});
