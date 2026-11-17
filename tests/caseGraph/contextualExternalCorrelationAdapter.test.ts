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
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import { buildContextualRelationshipCompletionArtifact } from '../../src/caseGraph/contextualRelationshipCompletion';
import { createVerifiedContextualExternalCorrelationAdapter } from '../../src/caseGraph/contextualExternalCorrelationAdapter';
import { buildCaseGraphExternalCorrelationResultFromAdapters } from '../../src/caseGraph/externalCorrelationProviderAdapters';
import { buildCanonicalContextualCompletionMixedFixture } from './contextualRelationshipCompletionTestSupport';

const digest = (character: string) => character.repeat(64);

const productionReceipt = (): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = contextualExplanationSha256('contextual-external-adapter-production-fixture');
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: 'case-graph-contextual-relationship-calibration-v1',
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: 'production_gates_passed',
    calibrationCoreSha256,
    lineageSha256: contextualExplanationSha256('contextual-external-lineage'),
    auditPlanSha256: contextualExplanationSha256('contextual-external-audit'),
    trustPolicyDigest: contextualExplanationSha256('contextual-external-trust'),
    evaluationSetSha256: contextualExplanationSha256('contextual-external-evaluations'),
    labelSetSha256: contextualExplanationSha256('contextual-external-labels'),
    metricsSha256: contextualExplanationSha256('contextual-external-metrics'),
    gatePolicyVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
    gatePolicySha256: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    evidenceClass: 'human_reviewed_locked_holdout',
    authorizationScope: 'production_candidate',
    calibratedEdgeType: 'contextual_explanation_candidate',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  return { ...withoutSha, receiptSha256: contextualRelationshipCalibrationReceiptSha256(withoutSha) };
};

const setup = () => {
  const fixture = buildCanonicalContextualCompletionMixedFixture();
  const receipt = productionReceipt();
  const artifact = buildContextualRelationshipCompletionArtifact({
    binding: fixture.binding,
    calibrationReceipt: receipt,
    sources: fixture.sources,
    entries: fixture.entryInputs,
  });
  const publication = {
    publicationId: '00000000-0000-4000-8000-000000000001',
    corpusVersion: fixture.binding.corpusVersion,
    manifestSha256: digest('1'),
    snapshotId: fixture.binding.snapshotId,
    graphArtifactSetSha256: digest('2'),
    relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
    relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1',
    relationshipModelVersion: 'model-v1', relationshipModelSha256: digest('4'),
    calibrationSetSha256: digest('5'),
  };
  const source = artifact.sources.find((item) => item.snapshot.kind === 'aircraft');
  if (!source) throw new Error('aircraft_source_missing');
  const adapter = createVerifiedContextualExternalCorrelationAdapter({
    publication,
    artifact,
    expectedBinding: fixture.binding,
    expectedCalibration: { receiptId: receipt.receiptId, receiptSha256: receipt.receiptSha256 },
    sourceSnapshotDigest: source.snapshot.snapshotDigest,
    sourceUrl: 'https://example.test/aircraft-archive',
    license: 'approved fixture',
  });
  return { fixture, artifact, publication, source, adapter };
};

describe('verified contextual archive external-correlation adapter', () => {
  it('maps an accepted immutable contextual receipt into a bounded external candidate', async () => {
    const { artifact, publication, source, adapter } = setup();
    const entry = artifact.entries.find((item) => item.status === 'accepted_edge');
    if (!entry) throw new Error('accepted_entry_missing');
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({
      publication,
      address: entry.address,
      nodeDigest: entry.relationshipRecordDigest,
      adapters: [adapter],
      limitPerCategory: 5,
      checkedAt: '2026-07-21T20:00:00.000Z',
    });
    expect(result.assessments[0]).toMatchObject({
      category: 'aircraft', availability: 'available',
      source: {
        providerId: source.snapshot.providerId,
        datasetVersion: source.snapshot.datasetVersion,
        receiptSha256: source.sourceCompletionDigest,
      },
      candidates: [{
        sourceRecordId: entry.entryId,
        reasonCodes: expect.arrayContaining(['governed_contextual_candidate']),
        measurements: { evidence_strength: expect.any(Number) },
      }],
    });
  });

  it('preserves explicit insufficient evidence and does not turn it into a candidate', async () => {
    const { artifact, publication, adapter } = setup();
    const entry = artifact.entries.find((item) => item.status === 'insufficient_evidence');
    if (!entry) throw new Error('insufficient_entry_missing');
    const outcome = await adapter.correlate({
      publication, address: entry.address, nodeDigest: entry.relationshipRecordDigest,
      limit: 5, checkedAt: '2026-07-21T20:00:00.000Z',
    });
    expect(outcome).toMatchObject({ availability: 'insufficient_evidence', candidates: [], source: expect.any(Object) });
    expect(outcome.reasonCodes).toContain('verified_contextual_snapshot_checked');
  });

  it('fails closed for an unassessed address, node drift, publication drift and unvalidated artifacts', async () => {
    const { fixture, publication, adapter } = setup();
    await expect(adapter.correlate({
      publication, address: 'sighting:not-assessed', nodeDigest: digest('9'),
      limit: 5, checkedAt: '2026-07-21T20:00:00.000Z',
    })).resolves.toMatchObject({
      availability: 'unavailable', reasonCodes: ['contextual_address_not_assessed'], candidates: [],
    });
    const accepted = setup().artifact.entries.find((item) => item.status === 'accepted_edge');
    if (!accepted) throw new Error('accepted_entry_missing');
    await expect(adapter.correlate({
      publication, address: accepted.address, nodeDigest: digest('9'),
      limit: 5, checkedAt: '2026-07-21T20:00:00.000Z',
    })).rejects.toThrow('contextual_external_correlation_node_mismatch');
    await expect(adapter.correlate({
      publication: { ...publication, publicationId: '00000000-0000-4000-8000-000000000002' },
      address: accepted.address, nodeDigest: accepted.relationshipRecordDigest,
      limit: 5, checkedAt: '2026-07-21T20:00:00.000Z',
    })).rejects.toThrow('contextual_external_correlation_publication_mismatch');
    expect(() => createVerifiedContextualExternalCorrelationAdapter({
      publication,
      artifact: fixture.artifact,
      expectedBinding: fixture.binding,
      expectedCalibration: fixture.expectedCalibration,
      sourceSnapshotDigest: fixture.sources[0].snapshot.snapshotDigest,
      sourceUrl: null,
      license: null,
    })).toThrow('contextual_completion_not_production_eligible');
  });
});
