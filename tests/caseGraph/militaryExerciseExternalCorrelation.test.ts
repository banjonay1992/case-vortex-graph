import { describe, expect, it } from 'vitest';

import { createUnavailableMilitaryExerciseExternalCorrelationAdapter } from '../../src/caseGraph/militaryExerciseExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'military-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1', relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};

describe('military exercise external correlation', () => {
  it('reports the exact missing coverage without treating the category as ruled out', async () => {
    const adapter = createUnavailableMilitaryExerciseExternalCorrelationAdapter();
    await expect(adapter.correlate({
      publication, address: 'sighting:case-a', nodeDigest: digest('6'), limit: 5,
      checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toEqual({
      availability: 'unavailable',
      reasonCodes: ['structured_military_exercise_provider_unavailable'],
      explanation: 'No publication-pinned, governed structured military-exercise provider is available. Exercises, restricted activity and training operations were not checked or ruled out.',
      source: null,
      candidates: [],
    });
  });

  it('propagates cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createUnavailableMilitaryExerciseExternalCorrelationAdapter().correlate({
      publication, address: 'sighting:case-a', nodeDigest: digest('6'), limit: 5,
      checkedAt: '2026-07-22T02:00:00.000Z', signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
  });
});
