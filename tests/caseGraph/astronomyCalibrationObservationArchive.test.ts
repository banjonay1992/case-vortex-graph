import { describe, expect, it } from 'vitest';
import {
  buildAstronomyCalibrationObservationArchive,
} from '../../src/caseGraph/astronomyCalibrationObservationArchive';
import {
  buildContextualSourceGovernanceResearchPacket,
} from '../../src/caseGraph/contextualSourceGovernanceResearchCatalogue';
import {
  buildRelationshipInputRecord,
  relationshipInputSha256,
} from '../../src/caseGraph/relationshipInputSnapshot';

const binding = {
  snapshotId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: 'test-corpus-v1',
  universeSchemaVersion: 'evidence-universe-v2',
  universeLayoutVersion: 'evidence-universe-layout-v2',
  universeArchiveVersion: 'evidence-universe-archive-v3',
  universeRecordCount: 2,
  universeArchiveSetSha256: 'a'.repeat(64),
};

const record = (recordId: string) => buildRelationshipInputRecord({
  binding,
  address: `sighting:${recordId}`,
  source: {
    sourceId: 'test',
    sourceRecordId: recordId,
    registryVersion: 'test-v1',
    lineageId: 'test-lineage',
    dependencyRisk: 'low',
  },
  duplicateLineage: null,
  facts: [],
  sourceAssertions: [],
  crossReferences: [],
  governedReferences: [],
  narrativeVector: {
    status: 'missing',
    dimensions: 1,
    modelId: 'narrative-model',
    modelVersion: '1.0.0',
    normalization: 'none',
    inputSha256: null,
    vectorSha256: null,
    reason: 'no_narrative',
  },
  recordMissingness: [],
});

const packet = (approved = true) => buildContextualSourceGovernanceResearchPacket({
  referenceAt: '2026-07-27T17:01:12.590Z',
  registryInspectedAt: '2026-07-27T17:01:12.485Z',
  registryRows: approved ? [{
    canonical_source: 'ASTRONOMY_ENGINE_LOCAL',
    legal_status: 'approved',
    allowed_content_modes: ['derived_only'],
  }] : [],
});

describe('astronomy calibration observation archive', () => {
  it('materializes deterministic, digest-bound observations and explicit missing sky direction', () => {
    const sourceMaterials = {
      records: [
        {
          rawRecord: {
            kind: 'sighting',
            recordId: 'subject-1',
            eventTimestamp: '2024-04-08T18:00:00.000Z',
            lat: 32.7767,
            lon: -96.797,
          },
          relationshipRecord: record('subject-1'),
        },
        {
          rawRecord: {
            kind: 'sighting',
            recordId: 'subject-2',
            eventTimestamp: null,
            lat: null,
            lon: null,
          },
          relationshipRecord: record('subject-2'),
        },
      ],
    };
    const archive = buildAstronomyCalibrationObservationArchive({
      binding,
      decisionPacket: packet(),
      sourceMaterials,
      sourceMaterialsSha256: relationshipInputSha256(sourceMaterials),
      materializedAt: '2026-07-27T17:02:00.000Z',
    });

    expect(archive.summary).toEqual({
      inputRecordCount: 2,
      eligibleSubjectCount: 1,
      observationCount: 2,
      skippedRecordCount: 1,
      skippedByReason: { event_timestamp_missing: 1 },
      subjectSkyPositionRecordedCount: 0,
      subjectSkyPositionMissingCount: 1,
    });
    expect(archive.records[0]).toMatchObject({
      subjectAddress: 'sighting:subject-1',
      subjectSkyPositionStatus: 'not_recorded',
      objects: [
        { key: 'sun', bearingDeg: 163.561, elevationDeg: 63.937 },
        { key: 'moon', bearingDeg: 164.13, elevationDeg: 63.788 },
      ],
    });
    expect(archive.archiveDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(buildAstronomyCalibrationObservationArchive({
      binding,
      decisionPacket: packet(),
      sourceMaterials,
      sourceMaterialsSha256: relationshipInputSha256(sourceMaterials),
      materializedAt: '2026-07-27T17:02:00.000Z',
    })).toEqual(archive);
  });

  it('fails closed when the exact derived-only astronomy source is not approved', () => {
    expect(() => buildAstronomyCalibrationObservationArchive({
      binding,
      decisionPacket: packet(false),
      sourceMaterials: { records: [] },
      sourceMaterialsSha256: 'c'.repeat(64),
      materializedAt: '2026-07-27T17:02:00.000Z',
    })).toThrow('astronomy_calibration_source_not_approved');
  });
});
