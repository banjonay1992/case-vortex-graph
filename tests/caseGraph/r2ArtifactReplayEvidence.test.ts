import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexR2ArtifactReplayObservation,
  r2ReplayObjectFromVersionedBody,
  verifyCaseVortexR2ArtifactReplayObservation,
  verifyFreshCaseVortexR2ArtifactReplayObservation,
} from '../../src/caseGraph/r2ArtifactReplayEvidence';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-26-v3',
  manifestSha256: 'a'.repeat(64),
};
const objects = () => Array.from({ length: 13 }, (_, index) => (
  r2ReplayObjectFromVersionedBody({
    key: `case-vortex/corpora/2026-07-26-v3/publication/object-${index}.json`,
    version: `"etag-${index}"`,
    body: Buffer.from(`{"index":${index}}`),
  })
));

describe('Case Vortex R2 artifact replay observation', () => {
  it('accepts exactly 13 immutable versioned reads bound to one publication', () => {
    const observation = buildCaseVortexR2ArtifactReplayObservation({
      observedAt: '2026-07-26T17:00:00.000Z',
      publication,
      objects: objects(),
    });
    expect(verifyFreshCaseVortexR2ArtifactReplayObservation({
      observation,
      publication,
      verifiedAt: '2026-07-26T17:30:00.000Z',
    })).toEqual(observation);
    expect(observation.guarantees).toMatchObject({
      storageReads: 13,
      storageWrites: 0,
      publicationActivations: 0,
      deployments: 0,
    });
  });

  it('rejects missing/duplicate objects, invalid versions and stale observations', () => {
    expect(() => buildCaseVortexR2ArtifactReplayObservation({
      observedAt: '2026-07-26T17:00:00.000Z',
      publication,
      objects: objects().slice(1),
    })).toThrow('case_vortex_r2_artifact_replay_object_count_invalid');
    const duplicates = objects();
    duplicates[12] = duplicates[11];
    expect(() => buildCaseVortexR2ArtifactReplayObservation({
      observedAt: '2026-07-26T17:00:00.000Z',
      publication,
      objects: duplicates,
    })).toThrow('case_vortex_r2_artifact_replay_object_invalid');
    expect(() => r2ReplayObjectFromVersionedBody({
      key: 'valid/key.json',
      version: 'bad\netag',
      body: Buffer.from('{}'),
    })).toThrow('case_vortex_r2_artifact_replay_object_invalid');

    const observation = buildCaseVortexR2ArtifactReplayObservation({
      observedAt: '2026-07-26T17:00:00.000Z',
      publication,
      objects: objects(),
    });
    expect(() => verifyFreshCaseVortexR2ArtifactReplayObservation({
      observation,
      publication,
      verifiedAt: '2026-07-26T18:00:00.001Z',
    })).toThrow('case_vortex_r2_artifact_replay_observation_stale');
  });

  it('rejects outer re-sealing after a digest or guarantee is changed', () => {
    const observation = buildCaseVortexR2ArtifactReplayObservation({
      observedAt: '2026-07-26T17:00:00.000Z',
      publication,
      objects: objects(),
    });
    const changed = {
      ...observation,
      guarantees: { ...observation.guarantees, storageWrites: 1 },
    };
    const { observationSha256: _discarded, ...body } = changed;
    expect(() => verifyCaseVortexR2ArtifactReplayObservation({
      ...changed,
      observationSha256: relationshipInputSha256(body),
    })).toThrow('case_vortex_r2_artifact_replay_observation_derived_fields_invalid');
  });
});
