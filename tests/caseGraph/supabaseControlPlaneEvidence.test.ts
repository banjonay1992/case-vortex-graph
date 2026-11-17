import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexSupabaseControlPlaneObservation,
  verifyCaseVortexSupabaseControlPlaneObservation,
  verifyFreshCaseVortexSupabaseControlPlaneObservation,
  type CaseVortexSupabaseControlPlaneObservationInput,
} from '../../src/caseGraph/supabaseControlPlaneEvidence';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

export const controlPlaneInput = (
  overrides: Partial<CaseVortexSupabaseControlPlaneObservationInput> = {},
): CaseVortexSupabaseControlPlaneObservationInput => ({
  observedAt: '2026-07-26T17:00:00.000Z',
  serverVersionNum: 170_006,
  transactionReadOnly: true,
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  runId: '223e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-26-v3',
  publicManifestKey:
    'case-vortex/corpora/2026-07-26-v3/publication/public-manifest.json',
  publicManifestSha256: 'a'.repeat(64),
  active: false,
  activatedAt: null,
  deactivatedAt: null,
  activePublicationCount: 0,
  runStatus: 'completed',
  lineageVersion: 'case-vortex-lineage-v2',
  runSnapshotId: '323e4567-e89b-42d3-a456-426614174000',
  runCompletionManifestSha256: 'b'.repeat(64),
  runCorpusAccountingDigest: 'c'.repeat(64),
  runGraphArtifactSetSha256: 'd'.repeat(64),
  receiptVersion: 'case-vortex-publication-receipt-v2',
  receiptSnapshotId: '323e4567-e89b-42d3-a456-426614174000',
  receiptPublicManifestSha256: 'a'.repeat(64),
  receiptCompletionManifestSha256: 'b'.repeat(64),
  receiptCorpusAccountingDigest: 'c'.repeat(64),
  receiptGraphArtifactSetSha256: 'd'.repeat(64),
  ...overrides,
});

describe('Case Vortex Supabase control-plane evidence', () => {
  it('accepts a fresh inactive never-activated verified-v2 candidate observation', () => {
    const observation = buildCaseVortexSupabaseControlPlaneObservation(controlPlaneInput());
    expect(verifyFreshCaseVortexSupabaseControlPlaneObservation({
      observation,
      publication: {
        publicationId: observation.publicationId,
        corpusVersion: observation.corpusVersion,
        manifestSha256: observation.publicManifestSha256,
      },
      verifiedAt: '2026-07-26T17:30:00.000Z',
    })).toEqual(observation);
  });

  it('rejects active, previously activated, legacy and lineage-drift candidates', () => {
    for (const overrides of [
      { active: true, activePublicationCount: 1 },
      { activatedAt: '2026-07-26T16:00:00.000Z' },
      { lineageVersion: 'case-vortex-lineage-v1' },
      { receiptCompletionManifestSha256: 'e'.repeat(64) },
    ]) {
      expect(() => buildCaseVortexSupabaseControlPlaneObservation(
        controlPlaneInput(overrides),
      )).toThrow(/case_vortex_supabase_control_plane_/u);
    }
  });

  it('rejects stale/publication-drift observations and outer re-sealing', () => {
    const observation = buildCaseVortexSupabaseControlPlaneObservation(controlPlaneInput());
    expect(() => verifyFreshCaseVortexSupabaseControlPlaneObservation({
      observation,
      publication: {
        publicationId: observation.publicationId,
        corpusVersion: observation.corpusVersion,
        manifestSha256: 'f'.repeat(64),
      },
      verifiedAt: '2026-07-26T17:30:00.000Z',
    })).toThrow('case_vortex_supabase_control_plane_publication_mismatch');
    expect(() => verifyFreshCaseVortexSupabaseControlPlaneObservation({
      observation,
      publication: {
        publicationId: observation.publicationId,
        corpusVersion: observation.corpusVersion,
        manifestSha256: observation.publicManifestSha256,
      },
      verifiedAt: '2026-07-26T18:00:00.001Z',
    })).toThrow('case_vortex_supabase_control_plane_observation_stale');

    const changed = {
      ...observation,
      guarantees: { ...observation.guarantees, databaseWrites: 1 },
    };
    const { observationSha256: _discarded, ...changedBody } = changed;
    expect(() => verifyCaseVortexSupabaseControlPlaneObservation({
      ...changed,
      observationSha256: relationshipInputSha256(changedBody),
    })).toThrow('case_vortex_supabase_control_plane_observation_derived_fields_invalid');
  });
});
