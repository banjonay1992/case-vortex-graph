import {
  getAuthoritativeCalibrationHumanReviewEvidence,
} from '../../src/caseGraph/calibrationHumanReview';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  FULL_PRODUCTION_CALIBRATION_HUMAN_REVIEW_FIXTURE_USE,
  buildFullProductionCalibrationHumanReviewTestFixture,
} from './fullProductionCalibrationTestSupport';

const startedAt = performance.now();
const fixture = buildFullProductionCalibrationHumanReviewTestFixture({
  snapshotId: '00000000-0000-4000-8000-000000000a12',
  corpusVersion: 'human-review-derived-evidence-contract-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'b'.repeat(64),
  universeRecordCount: 105,
});
const fixtureBuiltAt = performance.now();
if (fixture.fixtureUse !== FULL_PRODUCTION_CALIBRATION_HUMAN_REVIEW_FIXTURE_USE) {
  throw new Error('calibration_human_review_proof_fixture_use_invalid');
}
const bodies = {
  bundleBody: fixture.bundleBody,
  pairReceiptBody: fixture.pair.receiptBody,
  pairArtifactBody: fixture.pair.artifactBody,
  pairTrustPolicyBody: fixture.pair.trustPolicyBody,
  contextualReceiptBody: fixture.contextual.receiptBody,
  contextualArtifactBody: fixture.contextual.artifactBody,
  contextualTrustPolicyBody: fixture.contextual.trustPolicyBody,
};
const verified = getAuthoritativeCalibrationHumanReviewEvidence(bodies);
const verifiedAt = performance.now();
const cached = getAuthoritativeCalibrationHumanReviewEvidence(bodies);
const cacheReadAt = performance.now();
if (verified.bundleDigest !== fixture.bundle.bundleDigest
  || verified.pairArtifactDigest !== fixture.pair.artifact.artifactDigest
  || verified.contextualArtifactDigest !== fixture.contextual.artifact.artifactDigest
  || JSON.stringify(cached) !== JSON.stringify(verified)) {
  throw new Error('calibration_human_review_proof_identity_mismatch');
}
let tamperRejected = false;
try {
  getAuthoritativeCalibrationHumanReviewEvidence({
    ...bodies,
    bundleBody: Buffer.concat([fixture.bundleBody, Buffer.from(' ')]),
  });
} catch (error) {
  tamperRejected = error instanceof Error
    && error.message === 'calibration_human_review_derived_bundle_noncanonical';
}
if (!tamperRejected) throw new Error('calibration_human_review_proof_tamper_not_rejected');

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  fixture_use: fixture.fixtureUse,
  pair_labels: fixture.bundle.pairLabels.length,
  contextual_labels: fixture.bundle.contextualLabels.length,
  fixture_build_ms: Math.round(fixtureBuiltAt - startedAt),
  authoritative_verify_ms: Math.round(verifiedAt - fixtureBuiltAt),
  cached_verify_ms: Math.round(cacheReadAt - verifiedAt),
  ...verified,
})}\n`);
