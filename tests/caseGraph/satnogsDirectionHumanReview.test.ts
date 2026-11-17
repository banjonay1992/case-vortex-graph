import { describe, expect, it } from 'vitest';

import {
  buildSatnogsDirectionReviewAssignment,
  buildSatnogsDirectionReviewDraft,
  sealSatnogsDirectionAdjudication,
  verifySatnogsDirectionAdjudication,
} from '../../src/caseGraph/satnogsDirectionHumanReview';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const cohortFixture = () => {
  const phrase = (text: string, start: number, direction: string) => ({
    sourceField: 'summary',
    sourceText: `Object moved ${text} above the trees.`,
    sourceTextSha256: relationshipInputSha256(`Object moved ${text} above the trees.`),
    span: {
      unit: 'utf8_byte',
      start,
      end: start + Buffer.byteLength(text),
      text,
      textSha256: relationshipInputSha256(text),
    },
    normalizedDirection: direction,
    disposition: 'pending_human_review',
  });
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
      phrase('north', 13, 'north'),
      phrase('west', 13, 'west'),
    ],
    satelliteCoverage: {
      compatibleSnapshotCount: 1,
      compatibleObjectCount: 1,
      compatibleOrbitClasses: ['leo'],
      minimumEpochAgeDays: 1,
      maximumEpochAgeDays: 1,
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
      snapshotCount: 1,
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
      selectedCompatibleSnapshotCount: 1,
    },
    candidates: [candidate],
    candidateSetSha256: relationshipInputSha256([
      `${candidate.candidateId}:${candidate.candidateDigest}`,
    ]),
    guarantees: {},
  };
  return { ...body, cohortDigest: relationshipInputSha256(body) };
};

describe('SatNOGS direction human review', () => {
  it('builds a blinded blank assignment and seals a complete attested review', () => {
    const assignment = buildSatnogsDirectionReviewAssignment({
      cohort: cohortFixture(),
      createdAt: '2026-07-27T14:00:00.000Z',
    });
    expect(assignment.items).toHaveLength(2);
    expect(assignment.guarantees).toMatchObject({
      satelliteOutputsExposed: 0,
      decisionsPrepopulated: 0,
      humanAdjudicationsCreated: 0,
    });
    expect(assignment.items[0]).not.toHaveProperty('satelliteCoverage');
    expect(JSON.stringify(assignment.items)).not.toContain('LEO');

    const draft = buildSatnogsDirectionReviewDraft(assignment);
    expect(draft.reviews.every(({ decision }) => decision === null)).toBe(true);
    const completed = {
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
        decision: index === 0
          ? 'object_sky_position_confirmed'
          : 'object_motion_only',
        confidence: index === 0 ? 'high' : 'medium',
        rationale: index === 0
          ? 'The sentence locates the observed object in the sky.'
          : 'The sentence describes movement rather than a fixed sky position.',
      })),
    };
    const adjudication = sealSatnogsDirectionAdjudication({
      assignment,
      draft: completed,
      sealedAt: '2026-07-27T15:10:00.000Z',
    });
    expect(adjudication.summary).toMatchObject({
      reviewedItemCount: 2,
      confirmedSkyPositionCount: 1,
      rejectedOrNonPositionCount: 1,
    });
    expect(adjudication.guarantees).toMatchObject({
      completeItemSet: true,
      syntheticHumanReviewCredit: 0,
      propagatedSatelliteMatches: 0,
    });
    expect(verifySatnogsDirectionAdjudication({
      assignment,
      adjudication,
    })).toEqual(adjudication);
  });

  it('rejects substitution, incomplete sets and false attestations', () => {
    const assignment = buildSatnogsDirectionReviewAssignment({
      cohort: cohortFixture(),
      createdAt: '2026-07-27T14:00:00.000Z',
    });
    const draft = {
      ...buildSatnogsDirectionReviewDraft(assignment),
      reviewerId: 'human-reviewer-01',
      reviewedAt: '2026-07-27T15:00:00.000Z',
      attestation: {
        humanPerformed: true,
        reviewedExactSourceText: true,
        independentOfSatelliteOutputs: true,
      },
      reviews: buildSatnogsDirectionReviewDraft(assignment).reviews.map((review) => ({
        ...review,
        decision: 'ambiguous_or_insufficient',
        confidence: 'low',
        rationale: 'The exact text does not establish a sky position.',
      })),
    };
    expect(() => sealSatnogsDirectionAdjudication({
      assignment,
      draft: { ...draft, reviews: draft.reviews.slice(1) },
      sealedAt: '2026-07-27T15:10:00.000Z',
    })).toThrow('satnogs_direction_review_response_set_mismatch');
    expect(() => sealSatnogsDirectionAdjudication({
      assignment,
      draft: {
        ...draft,
        attestation: { ...draft.attestation, humanPerformed: false },
      },
      sealedAt: '2026-07-27T15:10:00.000Z',
    })).toThrow('satnogs_direction_review_attestation_invalid');
    expect(() => buildSatnogsDirectionReviewAssignment({
      cohort: { ...cohortFixture(), candidateSetSha256: '9'.repeat(64) },
      createdAt: '2026-07-27T14:00:00.000Z',
    })).toThrow();
  });
});
