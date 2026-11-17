import { beforeAll, describe, expect, it } from 'vitest';

import {
  selectCalibrationContextualCandidates,
  serializeCalibrationContextualCandidateSelection,
  type CalibrationContextualCandidateInput,
} from '../../src/caseGraph/calibrationContextualCandidateSelection';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
} from '../../src/caseGraph/evidenceUniverseArchive';
import {
  buildRelationshipInputRecord,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import { buildFullProductionCalibrationTestFixture } from './fullProductionCalibrationTestSupport';

const binding = (): RelationshipInputUniverseBinding => ({
  snapshotId: '11111111-1111-4111-8111-111111111111',
  corpusVersion: 'contextual-selection-fixture',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 105,
});

const subjectRecord = (
  candidate: CalibrationContextualCandidateInput,
  expectedBinding: RelationshipInputUniverseBinding,
  index: number,
): RelationshipInputRecord => buildRelationshipInputRecord({
  binding: expectedBinding,
  address: candidate.candidate.subjectAddress,
  source: {
    sourceId: `subject-source-${index % 7}`,
    sourceRecordId: `subject-record-${index}`,
    registryVersion: 'source-registry-v2',
    lineageId: `subject-lineage-${index % 11}`,
    dependencyRisk: 'unknown',
  },
  facts: [],
  recordMissingness: [],
  duplicateLineage: null,
  crossReferences: [],
  sourceAssertions: [],
  narrativeVector: {
    status: 'missing',
    modelId: 'contextual-selection-fixture',
    modelVersion: 'v1',
    dimensions: 16,
    normalization: 'l2',
    inputSha256: null,
    vectorSha256: null,
    reason: 'no_narrative',
  },
  governedReferences: [],
});

const fixture = () => {
  const expectedBinding = binding();
  const calibration = buildFullProductionCalibrationTestFixture(expectedBinding);
  const candidates: CalibrationContextualCandidateInput[] = calibration.contextual.artifact.labels
    .map((label) => ({
      sampleId: label.sampleId,
      evaluationDigest: label.review.evaluationDigest,
      candidate: label.candidate,
      evaluation: label.evaluation,
      sourceSnapshotDigest: label.sourceSnapshotDigest,
      observationArchiveRecordDigest: label.observationArchiveRecordDigest,
    }));
  const byAddress = new Map<string, RelationshipInputRecord>();
  candidates.forEach((candidate, index) => {
    if (!byAddress.has(candidate.candidate.subjectAddress)) {
      byAddress.set(
        candidate.candidate.subjectAddress,
        subjectRecord(candidate, expectedBinding, index),
      );
    }
  });
  return {
    lineage: calibration.contextual.artifact.lineage,
    candidates,
    subjectRecords: [...byAddress.values()],
  };
};

describe('governed contextual calibration candidate selection', () => {
  let source: ReturnType<typeof fixture>;

  beforeAll(() => {
    source = fixture();
  }, 30_000);

  it('selects a deterministic input-order-invariant cohort across kinds and outcomes', () => {
    const first = selectCalibrationContextualCandidates({
      ...source,
      targetCount: 80,
      seed: 'current-contextual-human-review-v1',
    });
    const reversed = selectCalibrationContextualCandidates({
      ...source,
      candidates: [...source.candidates].reverse(),
      subjectRecords: [...source.subjectRecords].reverse(),
      targetCount: 80,
      seed: 'current-contextual-human-review-v1',
    });

    expect(serializeCalibrationContextualCandidateSelection(reversed))
      .toBe(serializeCalibrationContextualCandidateSelection(first));
    expect(first.candidates).toHaveLength(80);
    expect(first.eligibleCount).toBe(source.candidates.length);
    expect(first.cohortCounts['kind:aircraft']).toBeGreaterThan(0);
    expect(first.cohortCounts['kind:satellite']).toBeGreaterThan(0);
    expect(first.cohortCounts['kind:astronomy']).toBeGreaterThan(0);
    expect(first.cohortCounts['kind:weather']).toBeGreaterThan(0);
    expect(first.cohortCounts['outcome:emit_candidate_edge']).toBeGreaterThan(0);
    expect(first.cohortCounts['outcome:insufficient_evidence']).toBeGreaterThan(0);
    expect(first.candidates.every(({ sourceGroupId }) => (
      sourceGroupId.startsWith('context-source-group:')
    ))).toBe(true);
  }, 30_000);

  it('fails closed on duplicate candidates, missing subjects and evaluation tampering', () => {
    const candidate = source.candidates[0];
    expect(() => selectCalibrationContextualCandidates({
      ...source,
      candidates: [candidate, candidate],
      targetCount: 1,
      seed: 'contextual-duplicate',
    })).toThrow('calibration_contextual_candidate_duplicate');
    expect(() => selectCalibrationContextualCandidates({
      ...source,
      subjectRecords: [],
      targetCount: 1,
      seed: 'contextual-missing-subject',
    })).toThrow('calibration_contextual_candidate_subject_record_missing');
    const tampered = structuredClone(candidate);
    tampered.evaluation.receipt.plainEnglish = 'invented evaluator conclusion';
    expect(() => selectCalibrationContextualCandidates({
      ...source,
      candidates: [tampered, ...source.candidates.slice(1)],
      targetCount: 1,
      seed: 'contextual-tamper',
    })).toThrow('calibration_contextual_candidate_evaluation_mismatch');
  }, 30_000);
});
