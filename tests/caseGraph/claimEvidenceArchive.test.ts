import { describe, expect, it } from 'vitest';

import {
  archiveClaimEvidenceGraph,
  verifyClaimEvidenceArchive,
} from '../../src/caseGraph/claimEvidenceArchive';
import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceGraphArtifact,
  buildSourceReliabilityAssessment,
} from '../../src/caseGraph/claimEvidenceGraph';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';

const binding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const claim = buildAtomicEvidenceClaim({
  binding, address: 'document:archive-fixture', sourceId: 'fixture', subject: 'Witness',
  predicate: 'observed', object: 'a light', polarity: 'asserted', modality: 'reported',
  sourceText: 'Witness reported a light.',
  locator: { kind: 'document_page', pageNumber: 2, characterStart: 10, characterEnd: 35, boundingBox: null },
  extraction: { method: 'manual_review', version: 'review-v1', confidence: 1, reviewStatus: 'reviewed' },
});

const assessment = buildSourceReliabilityAssessment({
  binding, address: claim.address, sourceId: 'fixture', sourceLabel: 'Fixture source', lineageId: 'fixture',
  dimensions: {
    sourcePosition: { value: 'primary', reasonCodes: ['direct_report'], explanation: 'Direct report.' },
    contemporaneity: { value: 'unknown', reasonCodes: ['date_unknown'], explanation: 'Date unknown.' },
    witnessIdentity: { value: 'named', reasonCodes: ['named'], explanation: 'Named witness.' },
    originality: { value: 'original', reasonCodes: ['original'], explanation: 'Original record.' },
    independence: { value: 'independent', reasonCodes: ['origin'], explanation: 'Originating lineage.' },
    provenance: { value: 'partial', reasonCodes: ['partial'], explanation: 'Partial archive chain.' },
    corroboration: { value: 'none', reasonCodes: ['none'], explanation: 'No corroborating source.', independentSourceCount: 0, sharedLineageSourceCount: 0 },
  },
  limitations: ['Not a truth score.'],
  assessedBy: { method: 'manual_review', version: 'review-v1', reviewStatus: 'reviewed' },
});

const artifact = buildClaimEvidenceGraphArtifact({
  binding, claims: [claim], links: [], sourceReliability: [assessment],
});

const memoryArchive = () => {
  const objects = new Map<string, Buffer>();
  const writes: string[] = [];
  const archive: CaseGraphContentImmutableArchive = {
    putIfAbsent: async ({ key, body }) => {
      if (objects.has(key)) return 'exists';
      objects.set(key, Buffer.from(body));
      writes.push(key);
      return 'written';
    },
    readObject: async (key) => objects.get(key) || null,
  };
  return { archive, objects, writes };
};

describe('claim evidence immutable archive', () => {
  it('writes deterministic shards first and the publication manifest last', async () => {
    const storage = memoryArchive();
    const first = await archiveClaimEvidenceGraph({ artifact, archive: storage.archive });
    expect(first.shards.map((shard) => shard.shardKind)).toEqual(['claim', 'source_reliability']);
    expect(storage.writes.at(-1)).toBe(first.pointer.manifestObjectKey);
    expect(first.manifest).toMatchObject({
      artifactDigest: artifact.artifactDigest,
      claimCount: 1,
      linkCount: 0,
      sourceAssessmentCount: 1,
      shardCount: 2,
    });
    expect(verifyClaimEvidenceArchive(first)).toEqual(first);

    const writeCount = storage.writes.length;
    const second = await archiveClaimEvidenceGraph({ artifact, archive: storage.archive });
    expect(second).toEqual(first);
    expect(storage.writes).toHaveLength(writeCount);
  });

  it('fails closed when an archived shard or pointer is altered', async () => {
    const stored = await archiveClaimEvidenceGraph({ artifact, archive: memoryArchive().archive });
    expect(() => verifyClaimEvidenceArchive({
      ...stored,
      shards: [{ ...stored.shards[0], entryCount: 2 }, ...stored.shards.slice(1)],
    })).toThrow('claim_evidence_archive_shard_integrity_failed');
    expect(() => verifyClaimEvidenceArchive({
      ...stored,
      pointer: { ...stored.pointer, artifactDigest: 'f'.repeat(64) },
    })).toThrow('claim_evidence_archive_pointer_integrity_failed');
  });
});
