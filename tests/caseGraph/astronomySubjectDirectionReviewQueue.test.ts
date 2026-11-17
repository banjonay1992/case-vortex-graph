import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildAstronomyCalibrationObservationArchive,
} from '../../src/caseGraph/astronomyCalibrationObservationArchive';
import {
  buildAstronomySubjectDirectionReviewQueue,
} from '../../src/caseGraph/astronomySubjectDirectionReviewQueue';
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
  universeRecordCount: 3,
  universeArchiveSetSha256: 'a'.repeat(64),
};

const relationshipRecord = (recordId: string) => buildRelationshipInputRecord({
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

const packet = buildContextualSourceGovernanceResearchPacket({
  referenceAt: '2026-07-27T17:01:12.590Z',
  registryInspectedAt: '2026-07-27T17:01:12.485Z',
  registryRows: [{
    canonical_source: 'ASTRONOMY_ENGINE_LOCAL',
    legal_status: 'approved',
    allowed_content_modes: ['derived_only'],
  }],
});

const sourceMaterials = {
  records: [
    {
      rawRecord: {
        kind: 'sighting',
        recordId: 'subject-1',
        eventTimestamp: '2024-04-08T18:00:00.000Z',
        lat: 32.7767,
        lon: -96.797,
        title: 'Light',
        summary: 'We saw a bright object northwest at 45 degrees.',
        canonicalUrl: 'https://example.test/one',
      },
      relationshipRecord: relationshipRecord('subject-1'),
    },
    {
      rawRecord: {
        kind: 'sighting',
        recordId: 'subject-2',
        eventTimestamp: '2024-04-08T18:01:00.000Z',
        lat: 32.77,
        lon: -96.79,
        title: 'Moved south',
        summary: 'No positional direction was recorded.',
        canonicalUrl: 'https://example.test/two',
      },
      relationshipRecord: relationshipRecord('subject-2'),
    },
    {
      rawRecord: {
        kind: 'sighting',
        recordId: 'ineligible',
        eventTimestamp: null,
        lat: null,
        lon: null,
        title: 'North light',
        summary: 'North.',
        canonicalUrl: 'https://example.test/three',
      },
      relationshipRecord: relationshipRecord('ineligible'),
    },
  ],
};
const sourceMaterialsBytes = () => Buffer.from(`${JSON.stringify(sourceMaterials, null, 2)}\n`);
const sourceMaterialsFileSha256 = () => (
  createHash('sha256').update(sourceMaterialsBytes()).digest('hex')
);

const astronomyArchive = () => buildAstronomyCalibrationObservationArchive({
  binding,
  decisionPacket: packet,
  sourceMaterials,
  sourceMaterialsSha256: sourceMaterialsFileSha256(),
  materializedAt: '2026-07-27T17:02:00.000Z',
});

describe('astronomy subject-direction review queue', () => {
  it('retains exact phrase evidence but admits no automatic sky positions', () => {
    const queue = buildAstronomySubjectDirectionReviewQueue({
      astronomyArchive: astronomyArchive(),
      sourceMaterialsBytes: sourceMaterialsBytes(),
      queuedAt: '2026-07-27T18:30:00.000Z',
    });

    expect(queue.summary).toEqual({
      eligibleSubjectCount: 2,
      candidateSubjectCount: 2,
      candidatePhraseCount: 2,
      noCandidateSubjectCount: 0,
      admittedSkyPositionCount: 0,
    });
    expect(queue.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjectAddress: 'sighting:subject-1',
        sourceField: 'summary',
        normalizedDirection: 'northwest',
        disposition: 'pending_human_review',
        span: expect.objectContaining({ text: 'northwest' }),
      }),
      expect.objectContaining({
        subjectAddress: 'sighting:subject-2',
        sourceField: 'title',
        normalizedDirection: 'south',
        disposition: 'pending_human_review',
      }),
    ]));
    expect(queue.candidates.every(({ span, sourceText }) => (
      Buffer.from(sourceText).subarray(span.start, span.end).toString('utf8') === span.text
    ))).toBe(true);
    expect(queue.guarantees).toMatchObject({
      automaticAzimuthAssignments: 0,
      automaticElevationAssignments: 0,
      contextualEdgesCreated: 0,
      humanAdjudicationsCreated: 0,
    });
    expect(buildAstronomySubjectDirectionReviewQueue({
      astronomyArchive: astronomyArchive(),
      sourceMaterialsBytes: sourceMaterialsBytes(),
      queuedAt: '2026-07-27T18:30:00.000Z',
    })).toEqual(queue);
  });

  it('rejects archive, source-material and relationship-record drift', () => {
    const archive = astronomyArchive();
    expect(() => buildAstronomySubjectDirectionReviewQueue({
      astronomyArchive: { ...archive, recordSetSha256: 'b'.repeat(64) },
      sourceMaterialsBytes: sourceMaterialsBytes(),
      queuedAt: '2026-07-27T18:30:00.000Z',
    })).toThrow('astronomy_direction_archive_digest_mismatch');

    expect(() => buildAstronomySubjectDirectionReviewQueue({
      astronomyArchive: archive,
      sourceMaterialsBytes: JSON.stringify({ records: sourceMaterials.records.slice(0, 1) }),
      queuedAt: '2026-07-27T18:30:00.000Z',
    })).toThrow('astronomy_direction_source_materials_mismatch');

    const driftedArchive = structuredClone(archive);
    driftedArchive.records[0].relationshipRecordDigest = 'c'.repeat(64);
    const { archiveDigest: _oldDigest, ...driftedBody } = driftedArchive;
    driftedArchive.archiveDigest = relationshipInputSha256(driftedBody);
    expect(() => buildAstronomySubjectDirectionReviewQueue({
      astronomyArchive: driftedArchive,
      sourceMaterialsBytes: sourceMaterialsBytes(),
      queuedAt: '2026-07-27T18:30:00.000Z',
    })).toThrow('astronomy_direction_relationship_record_mismatch');
  });
});
