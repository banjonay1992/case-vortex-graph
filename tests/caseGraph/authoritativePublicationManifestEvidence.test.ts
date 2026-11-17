import { beforeAll, describe, expect, it } from 'vitest';

import {
  verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact,
  type CaseVortexPublicationManifestEvidenceBodies,
} from '../../src/caseGraph/authoritativeEvidenceArtifact';
import {
  buildPublicationV2Fixture,
  type PublicationV2Fixture,
} from './publicationV2TestSupport';

const publicationId = '123e4567-e89b-42d3-a456-426614174000';

const bodiesFromFixture = (
  fixture: PublicationV2Fixture,
): CaseVortexPublicationManifestEvidenceBodies => ({
  completionBody: fixture.completionBody,
  manifestBody: fixture.manifestBody,
  accountingReceiptBody: fixture.accountingReceiptBody,
  calibrationSetReceiptBody: fixture.calibration.setReceiptBody,
  humanReviewBundleBody: fixture.calibration.bundleBody,
  pairCalibrationReceiptBody: fixture.calibration.pairReceiptBody,
  contextualCalibrationReceiptBody: fixture.calibration.contextualReceiptBody,
  pairCalibrationArtifactBody: fixture.calibration.pair.artifactBody,
  pairCalibrationTrustPolicyBody: fixture.calibration.pair.trustPolicyBody,
  contextualCalibrationArtifactBody: fixture.calibration.contextual.artifactBody,
  contextualCalibrationTrustPolicyBody: fixture.calibration.contextual.trustPolicyBody,
  contextualRelationshipCompletionBody: fixture.contextualCompletion.artifactBody,
  productionCompatibilityReceiptBody: fixture.productionCompatibility.body,
});

describe('Case Vortex authoritative publication-manifest evidence', () => {
  beforeAll(() => {
    buildPublicationV2Fixture();
  }, 240_000);

  it('grants only immutable candidate-archive credit after replaying the production verifier', async () => {
    const fixture = buildPublicationV2Fixture();
    const publication = {
      publicationId,
      corpusVersion: fixture.manifest.corpusVersion,
      manifestSha256: fixture.manifestSha256,
    };
    const evidence = await verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact({
      gate: 'publication_manifest',
      publication,
      verifiedAt: '2026-07-22T12:00:00.000Z',
      publicationManifestBodies: bodiesFromFixture(fixture),
    });

    expect(evidence).toMatchObject({
      gate: 'publication_manifest',
      artifactType: 'case_vortex_immutable_publication_candidate_archive_evidence_set',
      publication,
    });
  }, 60_000);

  it('rejects substituted archive bytes even when the outer evidence call is otherwise valid', async () => {
    const fixture = buildPublicationV2Fixture();
    const publicationManifestBodies = bodiesFromFixture(fixture);
    publicationManifestBodies.humanReviewBundleBody = Buffer.concat([
      publicationManifestBodies.humanReviewBundleBody,
      Buffer.from(' '),
    ]);

    await expect(verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact({
      gate: 'publication_manifest',
      publication: {
        publicationId,
        corpusVersion: fixture.manifest.corpusVersion,
        manifestSha256: fixture.manifestSha256,
      },
      verifiedAt: '2026-07-22T12:00:00.000Z',
      publicationManifestBodies,
    })).rejects.toThrow('case_graph_publication_human_review_bundle_checksum_mismatch');
  }, 60_000);

  it('rejects full-run publication drift and verification before candidate completion', async () => {
    const fixture = buildPublicationV2Fixture();
    const base = {
      gate: 'publication_manifest' as const,
      publicationManifestBodies: bodiesFromFixture(fixture),
    };

    await expect(verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact({
      ...base,
      publication: {
        publicationId,
        corpusVersion: fixture.manifest.corpusVersion,
        manifestSha256: 'f'.repeat(64),
      },
      verifiedAt: '2026-07-22T12:00:00.000Z',
    })).rejects.toThrow('case_vortex_authoritative_artifact_publication_mismatch');

    await expect(verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact({
      ...base,
      publication: {
        publicationId,
        corpusVersion: fixture.manifest.corpusVersion,
        manifestSha256: fixture.manifestSha256,
      },
      verifiedAt: '2026-07-17T00:00:00.000Z',
    })).rejects.toThrow(
      'case_vortex_authoritative_publication_manifest_completed_at_invalid',
    );
  }, 60_000);
});
