import { describe, expect, it } from 'vitest';

import {
  buildContextualCalibrationAcquisitionPlan,
  verifyContextualCalibrationAcquisitionPlan,
} from '../../src/caseGraph/contextualCalibrationAcquisitionPlan';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const cohortFixture = () => {
  const candidates = [
    ['one', '2024-01-01T12:00:00.000Z', 40, -75],
    ['two', '2024-01-01T18:00:00.000Z', 40.2, -74.9],
    ['three', '2024-02-01T12:00:00.000Z', 51.5, -0.1],
    ['four', '2004-01-01T12:00:00.000Z', 40, -75],
    ['five', '2027-01-01T12:00:00.000Z', 40, -75],
  ].map(([id, eventTimestamp, lat, lon]) => {
    const sourceText = `Object north ${id}.`;
    const candidateCore = {
      candidateId: `satnogs-contextual:${id}`,
      address: `sighting:${id}`,
      source: 'FIXTURE',
      sourceRecordId: String(id),
      canonicalUrl: `https://example.test/${id}`,
      eventTimestamp,
      lat,
      lon,
      nodeDigest: relationshipInputSha256(`node:${id}`),
      sourceMaterialSha256: relationshipInputSha256(`source:${id}`),
      directionPhrases: [{
        sourceField: 'summary',
        sourceText,
        sourceTextSha256: relationshipInputSha256(sourceText),
        span: {
          unit: 'utf8_byte',
          start: 7,
          end: 12,
          text: 'north',
          textSha256: relationshipInputSha256('north'),
        },
        normalizedDirection: 'north',
        disposition: 'pending_human_review',
      }],
      satelliteCoverage: {
        compatibleSnapshotCount: 1,
        compatibleObjectCount: 1,
        compatibleOrbitClasses: ['leo'],
        minimumEpochAgeDays: 1,
        maximumEpochAgeDays: 1,
        compatibleSnapshotSetSha256: relationshipInputSha256(`snapshots:${id}`),
      },
      selectionRank: relationshipInputSha256(`rank:${id}`),
    };
    return { ...candidateCore, candidateDigest: relationshipInputSha256(candidateCore) };
  });
  const body = {
    recordType: 'satnogs_contextual_cohort',
    schemaVersion: 'case-vortex-satnogs-contextual-cohort-v1',
    builtAt: '2026-07-27T13:00:00.000Z',
    seed: 'fixture',
    targetCount: 5,
    binding: {
      corpusVersion: 'corpus-v1',
      snapshotId: '123e4567-e89b-42d3-a456-426614174000',
      universeArchiveVersion: 'evidence-universe-archive-v3',
      universeSchemaVersion: 'evidence-universe-v2',
      universeLayoutVersion: 'evidence-universe-layout-v2',
      universeArchiveSetSha256: 'e'.repeat(64),
      universeRecordCount: 5,
      universeSightingCount: 5,
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
      scannedSightingCount: 5,
      completeCoordinateTimeCount: 5,
      satelliteCoverageEligibleCount: 5,
      directionPhraseEligibleCount: 5,
      selectedCandidateCount: 5,
      selectedSourceCount: 1,
      selectedDirectionPhraseCount: 5,
      selectedCompatibleSnapshotCount: 5,
    },
    candidates,
    candidateSetSha256: relationshipInputSha256(candidates.map(
      ({ candidateId, candidateDigest }) => `${candidateId}:${candidateDigest}`,
    )),
    guarantees: {},
  };
  return { ...body, cohortDigest: relationshipInputSha256(body) };
};

describe('contextual calibration acquisition plan', () => {
  it('builds exact NOAA windows and ADSB history days without external operations', () => {
    const cohort = cohortFixture();
    const plan = buildContextualCalibrationAcquisitionPlan({
      cohort,
      checkedAt: '2026-07-27T16:00:00.000Z',
      plannedAt: '2026-07-27T16:05:00.000Z',
    });

    expect(plan.noaa.accounting).toEqual({
      eligibleAddressCount: 2,
      excludedAddressCount: 3,
      windowCount: 1,
      estimatedProviderCalls: 1,
    });
    expect(plan.noaa.windows[0].addresses).toEqual(['sighting:one', 'sighting:two']);
    expect(plan.noaa.windows[0].sourceUrl).toContain('www.ncei.noaa.gov');
    expect(plan.adsbLol.accounting).toEqual({
      eligibleAddressCount: 3,
      excludedAddressCount: 2,
      uniqueDayCount: 2,
      requiredIndexYearCount: 1,
      estimatedIndexMetadataCalls: 2,
      authorizedAssetDownloads: 0,
    });
    expect(plan.adsbLol.requiredIndexes).toEqual([expect.objectContaining({ year: 2024 })]);
    expect(plan.guarantees).toMatchObject({
      calibrationOnly: true,
      providerCalls: 0,
      providerBytesDownloaded: 0,
      storageReads: 0,
      storageWrites: 0,
      publicationMutations: 0,
      deployments: 0,
    });
    expect(verifyContextualCalibrationAcquisitionPlan({ cohort, plan })).toEqual(plan);
  });

  it('rejects plan tampering, duplicate addresses and reversed planning time', () => {
    const cohort = cohortFixture();
    const plan = buildContextualCalibrationAcquisitionPlan({
      cohort,
      checkedAt: '2026-07-27T16:00:00.000Z',
      plannedAt: '2026-07-27T16:05:00.000Z',
    });
    expect(() => verifyContextualCalibrationAcquisitionPlan({
      cohort,
      plan: {
        ...plan,
        noaa: {
          ...plan.noaa,
          accounting: { ...plan.noaa.accounting, estimatedProviderCalls: 0 },
        },
      },
    })).toThrow('contextual_calibration_acquisition_plan_mismatch');
    expect(() => buildContextualCalibrationAcquisitionPlan({
      cohort,
      checkedAt: '2026-07-27T16:00:00.000Z',
      plannedAt: '2026-07-27T15:59:59.000Z',
    })).toThrow('contextual_calibration_acquisition_time_order_invalid');
    const { candidateDigest: _candidateDigest, ...lastCandidateCore } =
      cohort.candidates.at(-1)!;
    const duplicateLastCore = {
      ...lastCandidateCore,
      address: cohort.candidates[0].address,
    };
    const duplicateCandidates = [
      ...cohort.candidates.slice(0, -1),
      {
        ...duplicateLastCore,
        candidateDigest: relationshipInputSha256(duplicateLastCore),
      },
    ];
    const duplicateBody = {
      ...cohort,
      candidates: duplicateCandidates,
      candidateSetSha256: relationshipInputSha256(duplicateCandidates.map(
        ({ candidateId, candidateDigest }) => `${candidateId}:${candidateDigest}`,
      )),
    };
    const { cohortDigest: _digest, ...duplicateCore } = duplicateBody;
    expect(() => buildContextualCalibrationAcquisitionPlan({
      cohort: {
        ...duplicateCore,
        cohortDigest: relationshipInputSha256(duplicateCore),
      },
      checkedAt: '2026-07-27T16:00:00.000Z',
      plannedAt: '2026-07-27T16:05:00.000Z',
    })).toThrow('contextual_calibration_acquisition_cohort_addresses_invalid');
  });
});
