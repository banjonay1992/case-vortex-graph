import { describe, expect, it } from 'vitest';

import {
  buildSatnogsDirectionReviewAssignment,
  buildSatnogsDirectionReviewDraft,
  sealSatnogsDirectionAdjudication,
} from '../../src/caseGraph/satnogsDirectionHumanReview';
import {
  buildSatnogsDirectionReviewIntegration,
  verifySatnogsDirectionReviewIntegration,
} from '../../src/caseGraph/satnogsDirectionReviewIntegration';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const cohortFixture = () => {
  const phrase = (text: string, direction: string) => {
    const sourceText = `Object appeared ${text} above the trees.`;
    const start = Buffer.byteLength('Object appeared ');
    return {
      sourceField: 'summary',
      sourceText,
      sourceTextSha256: relationshipInputSha256(sourceText),
      span: {
        unit: 'utf8_byte',
        start,
        end: start + Buffer.byteLength(text),
        text,
        textSha256: relationshipInputSha256(text),
      },
      normalizedDirection: direction,
      disposition: 'pending_human_review',
    };
  };
  const candidateCore = {
    candidateId: 'satnogs-contextual:candidate-1',
    address: 'sighting:subject-1',
    source: 'FIXTURE',
    sourceRecordId: 'subject-1',
    canonicalUrl: 'https://example.test/subject-1',
    eventTimestamp: '2026-07-26T00:00:00.000Z',
    lat: 51.5,
    lon: -0.1,
    nodeDigest: 'a'.repeat(64),
    sourceMaterialSha256: 'b'.repeat(64),
    directionPhrases: [
      phrase('north', 'north'),
      phrase('west', 'west'),
    ],
    satelliteCoverage: {
      compatibleSnapshotCount: 2,
      compatibleObjectCount: 2,
      compatibleOrbitClasses: ['leo'],
      minimumEpochAgeDays: 1,
      maximumEpochAgeDays: 2,
      compatibleSnapshotSetSha256: 'c'.repeat(64),
    },
    selectionRank: 'd'.repeat(64),
  };
  const candidate = {
    ...candidateCore,
    candidateDigest: relationshipInputSha256(candidateCore),
  };
  const body = {
    recordType: 'satnogs_contextual_cohort',
    schemaVersion: 'case-vortex-satnogs-contextual-cohort-v1',
    builtAt: '2026-07-27T13:00:00.000Z',
    seed: 'fixture',
    targetCount: 1,
    binding: {
      corpusVersion: 'corpus-v1',
      snapshotId: '123e4567-e89b-42d3-a456-426614174000',
      universeArchiveVersion: 'evidence-universe-archive-v3',
      universeSchemaVersion: 'evidence-universe-v2',
      universeLayoutVersion: 'evidence-universe-layout-v2',
      universeArchiveSetSha256: 'e'.repeat(64),
      universeRecordCount: 1,
      universeSightingCount: 1,
      universePartCount: 1,
      scannedSightingPartCount: 1,
    },
    satnogs: {
      schemaVersion: 'satnogs-db-snapshot-archive-v1',
      archiveDigest: 'f'.repeat(64),
      archiveFileSha256: '1'.repeat(64),
      snapshotSetSha256: '2'.repeat(64),
      snapshotCount: 2,
    },
    policy: {},
    summary: {
      scannedSightingCount: 1,
      completeCoordinateTimeCount: 1,
      satelliteCoverageEligibleCount: 1,
      directionPhraseEligibleCount: 1,
      selectedCandidateCount: 1,
      selectedSourceCount: 1,
      selectedDirectionPhraseCount: 2,
      selectedCompatibleSnapshotCount: 2,
    },
    candidates: [candidate],
    candidateSetSha256: relationshipInputSha256([
      `${candidate.candidateId}:${candidate.candidateDigest}`,
    ]),
    guarantees: {},
  };
  return { ...body, cohortDigest: relationshipInputSha256(body) };
};

const reviewedFixture = (
  decisions: Array<'object_sky_position_confirmed' | 'object_motion_only'>,
) => {
  const cohort = cohortFixture();
  const assignment = buildSatnogsDirectionReviewAssignment({
    cohort,
    createdAt: '2026-07-27T14:00:00.000Z',
  });
  const draft = buildSatnogsDirectionReviewDraft(assignment);
  const adjudication = sealSatnogsDirectionAdjudication({
    assignment,
    draft: {
      ...draft,
      reviewerId: 'human-reviewer-01',
      reviewedAt: '2026-07-27T15:00:00.000Z',
      attestation: {
        humanPerformed: true,
        reviewedExactSourceText: true,
        independentOfSatelliteOutputs: true,
      },
      reviews: draft.reviews.map((review, index) => ({
        ...review,
        decision: decisions[index],
        confidence: 'high',
        rationale: decisions[index] === 'object_sky_position_confirmed'
          ? 'The phrase locates the observed object in the sky.'
          : 'The phrase describes motion rather than a sky position.',
      })),
    },
    sealedAt: '2026-07-27T15:10:00.000Z',
  });
  return { cohort, assignment, adjudication };
};

describe('SatNOGS direction review integration', () => {
  it('integrates every reviewed phrase while exposing no derived sky coordinate or match', () => {
    const inputs = reviewedFixture([
      'object_sky_position_confirmed',
      'object_motion_only',
    ]);
    const integration = buildSatnogsDirectionReviewIntegration({
      ...inputs,
      integratedAt: '2026-07-27T15:20:00.000Z',
    });

    expect(integration.summary).toEqual({
      cohortSubjectCount: 1,
      reviewedPhraseCount: 2,
      confirmedPhraseCount: 1,
      subjectsWithConfirmedDirectionCount: 1,
      conflictingConfirmedDirectionCount: 0,
      subjectsWithoutConfirmedDirectionCount: 0,
    });
    expect(integration.subjects[0]).toMatchObject({
      disposition: 'confirmed_direction_available',
      confirmedDirections: [{
        normalizedDirection: inputs.assignment.items[0].normalizedDirection,
        confidence: 'high',
      }],
    });
    expect(integration.guarantees).toMatchObject({
      exactCohortAssignmentReplay: true,
      completeSubjectAccounting: true,
      automaticAzimuthAssignments: 0,
      automaticElevationAssignments: 0,
      propagatedSatelliteMatches: 0,
      contextualEdgesCreated: 0,
      databaseWrites: 0,
      publicationMutations: 0,
    });
    expect(JSON.stringify(integration)).not.toContain('azimuthDeg');
    expect(JSON.stringify(integration)).not.toContain('elevationDeg');
    expect(verifySatnogsDirectionReviewIntegration({
      ...inputs,
      integration,
    })).toEqual(integration);
  });

  it('quarantines conflicting confirmed directions and accounts no-confirmed subjects', () => {
    const conflictInputs = reviewedFixture([
      'object_sky_position_confirmed',
      'object_sky_position_confirmed',
    ]);
    const conflict = buildSatnogsDirectionReviewIntegration({
      ...conflictInputs,
      integratedAt: '2026-07-27T15:20:00.000Z',
    });
    expect(conflict.subjects[0].disposition).toBe('conflicting_confirmed_directions');
    expect(conflict.summary.conflictingConfirmedDirectionCount).toBe(1);

    const noneInputs = reviewedFixture(['object_motion_only', 'object_motion_only']);
    const none = buildSatnogsDirectionReviewIntegration({
      ...noneInputs,
      integratedAt: '2026-07-27T15:20:00.000Z',
    });
    expect(none.subjects[0].disposition).toBe('no_confirmed_direction');
    expect(none.summary.subjectsWithoutConfirmedDirectionCount).toBe(1);
  });

  it('rejects artifact tampering, assignment substitution and timestamp reversal', () => {
    const inputs = reviewedFixture([
      'object_sky_position_confirmed',
      'object_motion_only',
    ]);
    const integration = buildSatnogsDirectionReviewIntegration({
      ...inputs,
      integratedAt: '2026-07-27T15:20:00.000Z',
    });
    expect(() => verifySatnogsDirectionReviewIntegration({
      ...inputs,
      integration: {
        ...integration,
        summary: { ...integration.summary, confirmedPhraseCount: 2 },
      },
    })).toThrow('satnogs_direction_integration_mismatch');
    expect(() => buildSatnogsDirectionReviewIntegration({
      ...inputs,
      integratedAt: '2026-07-27T15:09:59.000Z',
    })).toThrow('satnogs_direction_integration_timestamp_order_invalid');

    const { assignmentDigest: _digest, ...assignmentBody } = inputs.assignment;
    const substitutedItems = inputs.assignment.items.slice(1);
    const substitutedBody = {
      ...assignmentBody,
      items: substitutedItems,
      itemSetSha256: relationshipInputSha256(substitutedItems.map(
        ({ itemId, itemDigest }) => `${itemId}:${itemDigest}`,
      )),
    };
    const substitutedAssignment = {
      ...substitutedBody,
      assignmentDigest: relationshipInputSha256(substitutedBody),
    };
    expect(() => buildSatnogsDirectionReviewIntegration({
      cohort: inputs.cohort,
      assignment: substitutedAssignment,
      adjudication: inputs.adjudication,
      integratedAt: '2026-07-27T15:20:00.000Z',
    })).toThrow('satnogs_direction_integration_assignment_cohort_mismatch');
  });
});
