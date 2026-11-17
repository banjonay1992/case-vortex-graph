import { describe, expect, it } from 'vitest';

import {
  selectCalibrationPairCandidates,
  serializeCalibrationPairCandidateSelection,
} from '../../src/caseGraph/calibrationCandidateSelection';
import {
  buildTypedRelationshipRarityIndex,
  createTypedRelationshipRarityAccumulator,
} from '../../src/caseGraph/typedRelationshipEngine';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { buildFullProductionCalibrationTestFixture } from './fullProductionCalibrationTestSupport';

const fixture = buildFullProductionCalibrationTestFixture({
  snapshotId: '00000000-0000-4000-8000-000000000ca1',
  corpusVersion: 'calibration-candidate-selection-fixture-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'c'.repeat(64),
  universeRecordCount: 105,
});

const evaluations = fixture.pair.artifact.labels.map(({ evaluation }) => evaluation);

describe('governed calibration pair candidate selection', () => {
  it('builds the exact rarity index incrementally without retaining a second corpus copy', () => {
    const records = [...fixture.pair.relationshipInputRecords]
      .sort((left, right) => left.address.localeCompare(right.address));
    const accumulator = createTypedRelationshipRarityAccumulator(fixture.binding);
    records.forEach((record) => accumulator.add(record));
    expect(accumulator.finish()).toEqual(
      buildTypedRelationshipRarityIndex(records, fixture.binding),
    );
  });

  it('selects a deterministic source-grouped cohort across emitted, rejected and dependency slices', () => {
    const first = selectCalibrationPairCandidates({
      binding: fixture.binding,
      evaluations,
      records: fixture.pair.relationshipInputRecords,
      targetCount: 240,
      seed: 'current-corpus-human-review-v1',
    });
    const second = selectCalibrationPairCandidates({
      binding: fixture.binding,
      evaluations: [...evaluations].reverse(),
      records: [...fixture.pair.relationshipInputRecords].reverse(),
      targetCount: 240,
      seed: 'current-corpus-human-review-v1',
    });
    expect(second).toEqual(first);
    expect(first.candidates).toHaveLength(240);
    expect(new Set(first.candidates.map(({ pairKey }) => pairKey)).size).toBe(240);
    expect(first.candidates.every(({ sourceGroupId }) => (
      /^source-group:[a-f0-9]{64}$/.test(sourceGroupId)
    ))).toBe(true);
    expect(first.cohortCounts['outcome:emitted']).toBeGreaterThan(0);
    expect(first.cohortCounts['outcome:rejected']).toBeGreaterThan(0);
    expect(Object.keys(first.cohortCounts).some((key) => key.startsWith('edge:'))).toBe(true);
    expect(Object.keys(first.cohortCounts).some((key) => key.startsWith('rejection:'))).toBe(true);
    expect(JSON.parse(serializeCalibrationPairCandidateSelection(first))).toEqual(first);
  }, 30_000);

  it('fails closed on undersized pools, duplicate evaluations and missing source records', () => {
    expect(() => selectCalibrationPairCandidates({
      binding: fixture.binding,
      evaluations: evaluations.slice(0, 2),
      records: fixture.pair.relationshipInputRecords,
      targetCount: 3,
      seed: 'current-corpus-human-review-v1',
    })).toThrow('calibration_pair_candidate_pool_too_small');
    expect(() => selectCalibrationPairCandidates({
      binding: fixture.binding,
      evaluations: [evaluations[0], evaluations[0]],
      records: fixture.pair.relationshipInputRecords,
      targetCount: 1,
      seed: 'current-corpus-human-review-v1',
    })).toThrow('calibration_pair_candidate_evaluation_duplicate');
    expect(() => selectCalibrationPairCandidates({
      binding: fixture.binding,
      evaluations: [evaluations[0]],
      records: [],
      targetCount: 1,
      seed: 'current-corpus-human-review-v1',
    })).toThrow('calibration_pair_candidate_source_record_missing');
  });
});
