import { beforeAll, describe, expect, it } from 'vitest';

import { canonicalizeContextualExplanation } from '../../src/caseGraph/contextualExplanation';
import {
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  buildContextualRelationshipCalibrationTrustPolicy,
  serializeContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  canonicalizeRelationshipInput,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  assertTypedRelationshipCalibrationReceiptProductionEligible,
  buildTypedRelationshipCalibrationTrustPolicy,
  serializeTypedRelationshipCalibrationReceipt,
} from '../../src/caseGraph/typedRelationshipCalibration';
import {
  FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
  FULL_PRODUCTION_CALIBRATION_MINIMUM_UNIVERSE_RECORD_COUNT,
  assertCanonicalFullProductionCalibrationTestFixture,
  assertFullProductionCalibrationTestReceiptBodies,
  assertFullProductionCalibrationTestTrustPolicyBodies,
  buildFullProductionCalibrationTestFixture,
  type FullProductionCalibrationPairLineageMaterial,
  type FullProductionCalibrationTestFixture,
} from './fullProductionCalibrationTestSupport';

const binding: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000995',
  corpusVersion: 'full-production-calibration-test-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: '9'.repeat(64),
  universeRecordCount: FULL_PRODUCTION_CALIBRATION_MINIMUM_UNIVERSE_RECORD_COUNT,
};

const bodyInputs = (fixture: FullProductionCalibrationTestFixture) => ({
  fixtureUse: fixture.fixtureUse,
  binding: fixture.binding,
  pair: {
    artifactBody: fixture.pair.artifactBody,
    trustPolicyBody: fixture.pair.trustPolicyBody,
    receiptBody: fixture.pair.receiptBody,
    relationshipInput: fixture.pair.relationshipInput,
  },
  contextual: {
    artifactBody: fixture.contextual.artifactBody,
    trustPolicyBody: fixture.contextual.trustPolicyBody,
    receiptBody: fixture.contextual.receiptBody,
  },
});

describe('full production-shaped calibration test support', () => {
  let fixture: FullProductionCalibrationTestFixture;
  let callbackMaterial: FullProductionCalibrationPairLineageMaterial;
  const relationshipArchiveSetSha256 = 'a'.repeat(64);
  const relationshipManifestDigest = 'b'.repeat(64);

  beforeAll(() => {
    fixture = buildFullProductionCalibrationTestFixture(binding, {
      resolvePairRelationshipInputLineage: (material) => {
        callbackMaterial = material;
        return {
          archiveSetSha256: relationshipArchiveSetSha256,
          manifestDigest: relationshipManifestDigest,
        };
      },
    });
  }, 300_000);

  it('builds canonical production-shaped pair and contextual artifacts through the real gates', () => {
    expect(fixture.fixtureUse).toBe(FULL_PRODUCTION_CALIBRATION_FIXTURE_USE);
    expect(fixture.pair.artifact).toMatchObject({
      decision: 'production_gates_passed',
      labelCount: 1_001,
    });
    expect(fixture.pair.relationshipInputRecords).toHaveLength(105);
    expect(fixture.pair.relationshipInputRecords.slice(-3).map((record) => record.address)).toEqual([
      'document:official-record-2',
      'photo:archive-photo-3',
      'video:witness-video-4',
    ]);
    expect(fixture.pair.rarityIndex).toBe(fixture.pair.relationshipInput.rarityIndex);
    expect(callbackMaterial.records).toBe(fixture.pair.relationshipInputRecords);
    expect(callbackMaterial.rarityIndex).toBe(fixture.pair.rarityIndex);
    expect(fixture.pair.artifact.lineage.relationshipInput).toMatchObject({
      archiveSetSha256: relationshipArchiveSetSha256,
      manifestDigest: relationshipManifestDigest,
      recordSetSha256: callbackMaterial.recordSetSha256,
    });
    expect(fixture.pair.artifact.lineage.rarity.indexDigest).toBe(
      callbackMaterial.rarityIndexDigest,
    );
    expect(fixture.contextual.artifact).toMatchObject({
      decision: 'production_gates_passed',
      labelCount: 801,
    });
    expect(fixture.pair.artifact.gateChecks.every((gate) => gate.status === 'pass')).toBe(true);
    expect(fixture.contextual.artifact.gateChecks.every((gate) => gate.status === 'pass')).toBe(true);
    expect(assertTypedRelationshipCalibrationReceiptProductionEligible(
      fixture.pair.receiptBody,
    )).toEqual(fixture.pair.receipt);
    expect(assertContextualRelationshipCalibrationReceiptProductionEligible(
      fixture.contextual.receiptBody,
    )).toEqual(fixture.contextual.receipt);

    expect(fixture.pair.artifactBody.toString('utf8')).toBe(
      `${canonicalizeRelationshipInput(fixture.pair.artifact)}\n`,
    );
    expect(fixture.pair.trustPolicyBody.toString('utf8')).toBe(
      `${canonicalizeRelationshipInput(fixture.pair.trustPolicy)}\n`,
    );
    expect(fixture.pair.receiptBody.toString('utf8')).toBe(
      serializeTypedRelationshipCalibrationReceipt(fixture.pair.receipt),
    );
    expect(fixture.contextual.artifactBody.toString('utf8')).toBe(
      `${canonicalizeContextualExplanation(fixture.contextual.artifact)}\n`,
    );
    expect(fixture.contextual.trustPolicyBody.toString('utf8')).toBe(
      `${canonicalizeContextualExplanation(fixture.contextual.trustPolicy)}\n`,
    );
    expect(fixture.contextual.receiptBody.toString('utf8')).toBe(
      serializeContextualRelationshipCalibrationReceipt(fixture.contextual.receipt),
    );
    expect(assertFullProductionCalibrationTestTrustPolicyBodies({
      pairTrustPolicyBody: fixture.pair.trustPolicyBody,
      contextualTrustPolicyBody: fixture.contextual.trustPolicyBody,
    })).toMatchObject({
      pairTrustPolicy: fixture.pair.trustPolicy,
      contextualTrustPolicy: fixture.contextual.trustPolicy,
    });
    expect(assertFullProductionCalibrationTestReceiptBodies({
      pairReceiptBody: fixture.pair.receiptBody,
      contextualReceiptBody: fixture.contextual.receiptBody,
    })).toMatchObject({
      pairReceipt: fixture.pair.receipt,
      contextualReceipt: fixture.contextual.receipt,
    });
  }, 120_000);

  it('rejects a caller-supplied binding that does not match the canonical artifact bodies', () => {
    const wrongBinding = {
      ...binding,
      snapshotId: '00000000-0000-4000-8000-000000000996',
    };
    expect(() => assertCanonicalFullProductionCalibrationTestFixture({
      ...bodyInputs(fixture),
      binding: wrongBinding,
    })).toThrow('relationship_input_snapshot_binding_mismatch');
  }, 60_000);

  it('rejects valid JSON bodies that are not the exact canonical bytes', () => {
    expect(() => assertFullProductionCalibrationTestTrustPolicyBodies({
      pairTrustPolicyBody: JSON.stringify(fixture.pair.trustPolicy, null, 2),
      contextualTrustPolicyBody: fixture.contextual.trustPolicyBody,
    })).toThrow('full_production_calibration_pair_trust_body_noncanonical');

    expect(() => assertFullProductionCalibrationTestReceiptBodies({
      pairReceiptBody: fixture.pair.receiptBody,
      contextualReceiptBody: Buffer.concat([fixture.contextual.receiptBody, Buffer.from('\n')]),
    })).toThrow('full_production_calibration_contextual_receipt_body_noncanonical');
  }, 120_000);

  it('rejects synthetic test-only trust policies even when their own digests are valid', () => {
    const pairTrust = buildTypedRelationshipCalibrationTrustPolicy({
      auditPlanDigest: fixture.pair.trustPolicy.auditPlanDigest,
      reviewReceiptSetSha256: fixture.pair.trustPolicy.reviewReceiptSetSha256,
      reviewerCohortId: fixture.pair.trustPolicy.reviewerCohortId,
      adjudicationPolicyVersion: fixture.pair.trustPolicy.adjudicationPolicyVersion,
      minimumIndependentReviewers: fixture.pair.trustPolicy.minimumIndependentReviewers,
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
    });
    expect(() => assertFullProductionCalibrationTestTrustPolicyBodies({
      pairTrustPolicyBody: `${canonicalizeRelationshipInput(pairTrust)}\n`,
      contextualTrustPolicyBody: fixture.contextual.trustPolicyBody,
    })).toThrow('full_production_calibration_pair_trust_not_production_shaped');

    const contextualTrust = buildContextualRelationshipCalibrationTrustPolicy({
      lineageDigest: fixture.contextual.trustPolicy.lineageDigest,
      auditPlanDigest: fixture.contextual.trustPolicy.auditPlanDigest,
      reviewReceiptSetSha256: fixture.contextual.trustPolicy.reviewReceiptSetSha256,
      reviewerCohortId: fixture.contextual.trustPolicy.reviewerCohortId,
      adjudicationPolicyVersion: fixture.contextual.trustPolicy.adjudicationPolicyVersion,
      minimumIndependentReviewers: fixture.contextual.trustPolicy.minimumIndependentReviewers,
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
    });
    expect(() => assertFullProductionCalibrationTestTrustPolicyBodies({
      pairTrustPolicyBody: fixture.pair.trustPolicyBody,
      contextualTrustPolicyBody: `${canonicalizeContextualExplanation(contextualTrust)}\n`,
    })).toThrow('full_production_calibration_contextual_trust_not_production_shaped');
  }, 60_000);

  it('fails closed before allocation when the binding has fewer than 105 records', () => {
    expect(() => buildFullProductionCalibrationTestFixture({
      ...binding,
      universeRecordCount: FULL_PRODUCTION_CALIBRATION_MINIMUM_UNIVERSE_RECORD_COUNT - 1,
    })).toThrow('full_production_calibration_fixture_universe_too_small');
  });
});
