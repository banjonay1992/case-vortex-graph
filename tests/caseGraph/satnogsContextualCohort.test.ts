import { describe, expect, it } from 'vitest';

import {
  createSatnogsContextualCohortScan,
  finalizeSatnogsContextualCohort,
} from '../../src/caseGraph/satnogsContextualCohort';
import { projectEvidenceUniverseNode } from '../../src/caseGraph/evidenceUniverse';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import type { SatnogsDbSnapshotArchive } from '../../src/sky/satellites/satnogsArchive';

const snapshots = [
  {
    noradId: 10001,
    objectName: 'LEO ONE',
    sourceObjectId: 'sat-a',
    provider: 'satnogs_db',
    sourceFormat: 'tle',
    orbitClass: 'leo',
    epoch: '2026-07-27T00:00:00.000Z',
    sourceGroups: ['satnogs_db'],
    tleLine1: '1 10001U 00001A   26208.00000000  .00000000  00000+0  00000+0 0  9990',
    tleLine2: '2 10001  51.0000  20.0000 0001000  20.0000  30.0000 15.00000000100000',
  },
  {
    noradId: 20002,
    objectName: 'GEO TWO',
    sourceObjectId: 'sat-b',
    provider: 'satnogs_db',
    sourceFormat: 'tle',
    orbitClass: 'geo',
    epoch: '2026-07-10T00:00:00.000Z',
    sourceGroups: ['satnogs_db'],
    tleLine1: '1 20002U 00002A   26191.00000000  .00000000  00000+0  00000+0 0  9990',
    tleLine2: '2 20002   0.1000  20.0000 0001000  20.0000  30.0000  1.00000000100000',
  },
] as const;

const archiveFixture = () => {
  const snapshotSetSha256 = relationshipInputSha256(snapshots.map((snapshot) => ({
    noradId: snapshot.noradId,
    sourceObjectId: snapshot.sourceObjectId,
    epoch: snapshot.epoch,
    tleLine1: snapshot.tleLine1,
    tleLine2: snapshot.tleLine2,
  })));
  const body = {
    recordType: 'satnogs_db_snapshot_archive',
    schemaVersion: 'satnogs-db-snapshot-archive-v1',
    adapterVersion: 'satnogs-db-tle-adapter-v1',
    acquiredAt: '2026-07-27T12:00:00.000Z',
    acquisitionPlanDigest: 'a'.repeat(64),
    governancePacketDigest: 'b'.repeat(64),
    response: {
      status: 200, contentType: 'application/json', byteLength: 100, sha256: 'c'.repeat(64),
    },
    summary: {
      sourceRowCount: 2, snapshotCount: 2, objectCount: 2,
      earliestEpoch: snapshots[1].epoch, latestEpoch: snapshots[0].epoch,
      earliestUpstreamUpdate: '2026-07-27T00:00:00.000Z',
      latestUpstreamUpdate: '2026-07-27T00:00:00.000Z',
      followedIdentityCount: 0, coalescedAliasCount: 0,
      futureEpochCount: 0, maximumFutureEpochHours: 0,
    },
    snapshots,
    snapshotSetSha256,
    guarantees: {
      providerCalls: 1, databaseWrites: 0, r2Writes: 0, lunaCalls: 0,
      contextualEdgesCreated: 0, publicationActivation: false, deployment: false,
    },
  };
  return { ...body, archiveDigest: relationshipInputSha256(body) } as unknown as SatnogsDbSnapshotArchive;
};

const node = (
  recordId: string,
  source: string,
  eventTimestamp: string,
  summary: string,
) => projectEvidenceUniverseNode({
  kind: 'sighting',
  recordId,
  source,
  sourceRecordId: recordId,
  title: 'Observed light',
  summary,
  canonicalUrl: `https://example.test/${recordId}`,
  previewUrl: null,
  eventTimestamp,
  lat: 51.5,
  lon: -0.1,
  location: 'London',
  countryCode: 'GB',
  linkedSightingId: null,
  updatedAt: '2026-07-27T12:00:00.000Z',
  public: true,
});

const completion = (sightingCount: number) => ({
  recordType: 'evidence_universe_completion',
  archiveVersion: 'evidence-universe-archive-v3',
  schemaVersion: 'evidence-universe-v2',
  layoutVersion: 'evidence-universe-layout-v2',
  corpusVersion: 'corpus-v1',
  expected: {
    snapshotId: '123e4567-e89b-42d3-a456-426614174000',
    byKind: { sighting: sightingCount, document: 0, photo: 0, video: 0 },
    total: sightingCount,
  },
  parts: [{ kind: 'sighting', partNumber: 0 }],
  archiveSetSha256: 'd'.repeat(64),
}) as any;

describe('SatNOGS contextual cohort', () => {
  it('selects a deterministic source-diverse review cohort under strict orbit age limits', () => {
    const archive = archiveFixture();
    const archiveBytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`);
    const scan = createSatnogsContextualCohortScan({
      satnogsArchive: archive,
      satnogsArchiveBytes: archiveBytes,
      seed: 'fixture-seed-v1',
    });
    scan.addNodes([
      node('a-1', 'source-a', '2026-07-26T00:00:00.000Z', 'Object north of the observer.'),
      node('a-2', 'source-a', '2026-07-26T12:00:00.000Z', 'Object east, moving slowly.'),
      node('b-1', 'source-b', '2026-07-25T00:00:00.000Z', 'Light to the southwest.'),
      node('b-2', 'source-b', '2026-07-25T00:00:00.000Z', 'Light without a bearing phrase.'),
      node('old', 'source-c', '2025-01-01T00:00:00.000Z', 'Object west.'),
    ]);

    const cohort = finalizeSatnogsContextualCohort({
      completion: completion(5),
      scan,
      seed: 'fixture-seed-v1',
      targetCount: 2,
      builtAt: '2026-07-27T13:00:00.000Z',
      scannedSightingPartCount: 1,
    });

    expect(cohort.summary).toEqual({
      scannedSightingCount: 5,
      completeCoordinateTimeCount: 5,
      satelliteCoverageEligibleCount: 4,
      directionPhraseEligibleCount: 3,
      selectedCandidateCount: 2,
      selectedSourceCount: 2,
      selectedDirectionPhraseCount: 2,
      selectedCompatibleSnapshotCount: 4,
    });
    expect(new Set(cohort.candidates.map(({ source }) => source)))
      .toEqual(new Set(['source-a', 'source-b']));
    expect(cohort.candidates.every(({ directionPhrases }) => (
      directionPhrases.every(({ disposition }) => disposition === 'pending_human_review')
    ))).toBe(true);
    expect(cohort.candidates[0].satelliteCoverage).toMatchObject({
      compatibleSnapshotCount: 2,
      compatibleObjectCount: 2,
      compatibleOrbitClasses: ['geo', 'leo'],
    });
    expect(cohort.guarantees).toMatchObject({
      propagatedSatelliteMatches: 0,
      contextualEdgesCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    });
    expect(cohort.cohortDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fails closed on archive, byte and universe-scan drift', () => {
    const archive = archiveFixture();
    const archiveBytes = Buffer.from(JSON.stringify(archive));
    expect(() => createSatnogsContextualCohortScan({
      satnogsArchive: { ...archive, snapshotSetSha256: 'e'.repeat(64) },
      satnogsArchiveBytes: archiveBytes,
      seed: 'fixture-seed-v1',
    })).toThrow();
    expect(() => createSatnogsContextualCohortScan({
      satnogsArchive: archive,
      satnogsArchiveBytes: Buffer.from('{}'),
      seed: 'fixture-seed-v1',
    })).toThrow('satnogs_contextual_archive_bytes_mismatch');

    const scan = createSatnogsContextualCohortScan({
      satnogsArchive: archive,
      satnogsArchiveBytes: archiveBytes,
      seed: 'fixture-seed-v1',
    });
    scan.addNodes([node(
      'only', 'source-a', '2026-07-26T00:00:00.000Z', 'Object north.',
    )]);
    expect(() => finalizeSatnogsContextualCohort({
      completion: completion(2),
      scan,
      seed: 'fixture-seed-v1',
      targetCount: 1,
      builtAt: '2026-07-27T13:00:00.000Z',
      scannedSightingPartCount: 1,
    })).toThrow('satnogs_contextual_universe_scan_incomplete');
  });
});
