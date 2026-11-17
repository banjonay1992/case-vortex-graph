import { describe, expect, it } from 'vitest';

import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  contextualExplanationSha256,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
  contextualRelationshipCalibrationReceiptSha256,
  getContextualRelationshipCalibrationReceiptId,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  assertContextualRelationshipCompletionProductionEligible,
  decodeContextualRelationshipCompletionArtifact,
} from '../../src/caseGraph/contextualRelationshipCompletion';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import type { RelationshipInputUniverseBinding } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  STRUCTURAL_CONTEXTUAL_COMPLETION_FIXTURE_USE,
  buildStructuralTestOnlyProductionContextualCompletion,
} from './contextualRelationshipProductionCompletionTestSupport';

const binding: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000991',
  corpusVersion: 'structural-contextual-completion-test-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: '9'.repeat(64),
  universeRecordCount: 4,
};

const structuralProductionReceipt = (
  seed = 'primary',
  production = true,
): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = contextualExplanationSha256(`structural-contextual-core:${seed}`);
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: 'case-graph-contextual-relationship-calibration-v1',
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: production ? 'production_gates_passed' : 'contract_gates_passed_test_only',
    calibrationCoreSha256,
    lineageSha256: contextualExplanationSha256(`structural-contextual-lineage:${seed}`),
    auditPlanSha256: contextualExplanationSha256(`structural-contextual-audit:${seed}`),
    trustPolicyDigest: contextualExplanationSha256(`structural-contextual-trust:${seed}`),
    evaluationSetSha256: contextualExplanationSha256(`structural-contextual-evaluation:${seed}`),
    labelSetSha256: contextualExplanationSha256(`structural-contextual-labels:${seed}`),
    metricsSha256: contextualExplanationSha256(`structural-contextual-metrics:${seed}`),
    gatePolicyVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
    gatePolicySha256: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    evidenceClass: production ? 'human_reviewed_locked_holdout' : 'synthetic_contract_fixture',
    authorizationScope: production ? 'production_candidate' : 'test_only_never_publish',
    calibratedEdgeType: 'contextual_explanation_candidate',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  return {
    ...withoutSha,
    receiptSha256: contextualRelationshipCalibrationReceiptSha256(withoutSha),
  };
};

describe('structural production contextual completion test support', () => {
  it('builds a canonical, binding-specific four-source zero completion', () => {
    const receipt = structuralProductionReceipt();
    const receiptBody = Buffer.from(
      serializeContextualRelationshipCalibrationReceipt(receipt),
      'utf8',
    );
    const fixture = buildStructuralTestOnlyProductionContextualCompletion({
      binding,
      contextualCalibrationReceipt: receipt,
      contextualCalibrationReceiptBody: receiptBody,
    });

    expect(fixture.fixtureUse).toBe(STRUCTURAL_CONTEXTUAL_COMPLETION_FIXTURE_USE);
    expect(fixture.artifact).toMatchObject({
      status: 'production_eligible_complete',
      binding,
      zeroObservationState: true,
      entries: [],
      accounting: {
        sourceSnapshotCount: 4,
        sourceKindCount: 4,
        sourceRecordCount: 0,
        acceptedEdgeCount: 0,
        insufficientEvidenceCount: 0,
        uniqueAddressCount: 0,
      },
    });
    expect(new Set(fixture.sources.map((source) => source.snapshot.kind))).toEqual(
      new Set(['aircraft', 'satellite', 'astronomy', 'weather']),
    );
    expect(fixture.sources.every((source) => source.rowCount === 0)).toBe(true);
    expect(fixture.calibrationReceiptBody).toEqual(receiptBody);
    expect(decodeContextualRelationshipCompletionArtifact(
      fixture.artifactBody,
      binding,
      fixture.expectedCalibration,
    )).toEqual(fixture.artifact);
    expect(assertContextualRelationshipCompletionProductionEligible(
      fixture.artifactBody,
      binding,
      fixture.expectedCalibration,
    )).toEqual(fixture.artifact);
  });

  it('rejects a calibration body that is valid JSON but not the exact canonical bytes', () => {
    const receipt = structuralProductionReceipt();
    expect(() => buildStructuralTestOnlyProductionContextualCompletion({
      binding,
      contextualCalibrationReceipt: receipt,
      contextualCalibrationReceiptBody: JSON.stringify(receipt, null, 2),
    })).toThrow('structural_contextual_completion_calibration_body_noncanonical');
  });

  it('rejects a mismatched or non-production contextual calibration receipt before building sources', () => {
    const receipt = structuralProductionReceipt();
    const otherReceipt = structuralProductionReceipt('other');
    expect(() => buildStructuralTestOnlyProductionContextualCompletion({
      binding,
      contextualCalibrationReceipt: receipt,
      contextualCalibrationReceiptBody: serializeContextualRelationshipCalibrationReceipt(otherReceipt),
    })).toThrow('structural_contextual_completion_calibration_body_noncanonical');

    const localOnlyReceipt = structuralProductionReceipt('local-only', false);
    expect(() => buildStructuralTestOnlyProductionContextualCompletion({
      binding,
      contextualCalibrationReceipt: localOnlyReceipt,
      contextualCalibrationReceiptBody: serializeContextualRelationshipCalibrationReceipt(localOnlyReceipt),
    })).toThrow('contextual_calibration_receipt_not_production_eligible');
  });
});
