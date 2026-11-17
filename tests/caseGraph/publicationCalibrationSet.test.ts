import { describe, expect, it } from 'vitest';

import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  CONTEXTUAL_EXPLANATION_POLICY,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
  contextualExplanationSha256,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
  buildContextualRelationshipCalibrationLineage,
  contextualRelationshipCalibrationReceiptSha256,
  getContextualRelationshipCalibrationReceiptId,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import { CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION } from '../../src/caseGraph/contextualObservationArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  buildCaseGraphPublicationCalibrationSetReceipt,
  decodeCaseGraphPublicationCalibrationSetReceipt,
  serializeCaseGraphPublicationCalibrationSetReceipt,
  verifyCaseGraphPublicationCalibrationSetReceiptBodies,
} from '../../src/caseGraph/publicationCalibrationSet';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  relationshipInputSha256,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  TYPED_RELATIONSHIP_EDGE_TYPES,
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  TYPED_RELATIONSHIP_POLICY,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
} from '../../src/caseGraph/typedRelationshipEngine';
import {
  TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
  TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
  TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_VERSION,
  TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
  getTypedRelationshipCalibrationReceiptId,
  serializeTypedRelationshipCalibrationReceipt,
  typedRelationshipCalibrationLineageSha256,
  typedRelationshipCalibrationReceiptSha256,
  type TypedRelationshipCalibrationLineage,
  type TypedRelationshipCalibrationReceipt,
} from '../../src/caseGraph/typedRelationshipCalibration';

const sha = (value: unknown) => relationshipInputSha256(value);

const binding: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000321',
  corpusVersion: 'publication-calibration-set-test-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 4,
};

const pairLineage: TypedRelationshipCalibrationLineage = {
  binding,
  relationshipInput: {
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    archiveSetSha256: 'b'.repeat(64),
    manifestDigest: 'c'.repeat(64),
    recordSetSha256: 'd'.repeat(64),
    recordCount: binding.universeRecordCount,
  },
  rarity: {
    schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
    indexDigest: 'e'.repeat(64),
    recordSetSha256: 'd'.repeat(64),
  },
  engine: {
    schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
    policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
    policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
    thresholds: TYPED_RELATIONSHIP_POLICY,
    model: TYPED_RELATIONSHIP_MODEL,
    modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
    edgeTypeSetSha256: TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
  },
};

const contextualKinds = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;
const sourceFamily = {
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
} as const;

const contextualLineageFor = (lineageBinding: RelationshipInputUniverseBinding) => {
  const model = {
    modelId: 'context-calibration-model',
    modelVersion: '1.0.0',
    method: 'deterministic' as const,
  };
  return buildContextualRelationshipCalibrationLineage({
    binding: lineageBinding,
    observationArchiveVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    sourceArchives: contextualKinds.map((kind) => ({
      kind,
      sourceFamily: sourceFamily[kind],
      sourceId: `${kind}-source`,
      providerId: `${kind}-provider`,
      datasetVersion: '1.0.0',
      sourceSnapshotDigest: sha(`${kind}:snapshot`),
      completionManifestDigest: sha(`${kind}:completion`),
      archiveSetSha256: sha(`${kind}:archive`),
      sourcePageSetSha256: sha(`${kind}:pages`),
      rowCount: 1,
      emittedEdgeCount: 1,
      insufficientEvidenceCount: 0,
    })),
    contextualPolicy: {
      schemaVersion: CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
      policyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
      policySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
      thresholds: CONTEXTUAL_EXPLANATION_POLICY,
    },
    adapter: {
      adapterVersion: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
      governedPayloadSchemaVersion: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
    },
    models: [{ ...model, modelIdentitySha256: contextualExplanationSha256(model) }],
  });
};

const pairReceiptFor = (
  lineage: TypedRelationshipCalibrationLineage,
  production = true,
): TypedRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = sha('pair-calibration-core');
  const withoutSha: Omit<TypedRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'typed_relationship_calibration_receipt',
    schemaVersion: 'case-graph-typed-relationship-calibration-v1',
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    receiptId: getTypedRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: production ? 'production_gates_passed' : 'contract_gates_passed_test_only',
    calibrationCoreSha256,
    lineageSha256: typedRelationshipCalibrationLineageSha256(lineage),
    auditPlanSha256: sha('pair-audit'),
    evaluationSetSha256: sha('pair-evaluations'),
    labelSetSha256: sha('pair-labels'),
    metricsSha256: sha('pair-metrics'),
    gatePolicyVersion: TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_VERSION,
    gatePolicySha256: TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    calibratedEdgeTypeSetSha256: TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
    trustPolicyDigest: sha('pair-trust'),
    evidenceClass: production ? 'human_reviewed_locked_holdout' : 'synthetic_contract_fixture',
    authorizationScope: production ? 'production_candidate' : 'test_only_never_publish',
    claimDiscipline: TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  };
  return { ...withoutSha, receiptSha256: typedRelationshipCalibrationReceiptSha256(withoutSha) };
};

const contextualReceiptFor = (
  lineage: ReturnType<typeof contextualLineageFor>,
  production = true,
): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = sha('contextual-calibration-core');
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: 'case-graph-contextual-relationship-calibration-v1',
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: production ? 'production_gates_passed' : 'contract_gates_passed_test_only',
    calibrationCoreSha256,
    lineageSha256: contextualExplanationSha256(lineage),
    auditPlanSha256: sha('context-audit'),
    trustPolicyDigest: sha('context-trust'),
    evaluationSetSha256: sha('context-evaluations'),
    labelSetSha256: sha('context-labels'),
    metricsSha256: sha('context-metrics'),
    gatePolicyVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
    gatePolicySha256: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    evidenceClass: production ? 'human_reviewed_locked_holdout' : 'synthetic_contract_fixture',
    authorizationScope: production ? 'production_candidate' : 'test_only_never_publish',
    calibratedEdgeType: 'contextual_explanation_candidate',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  return { ...withoutSha, receiptSha256: contextualRelationshipCalibrationReceiptSha256(withoutSha) };
};

const bodies = (production = true, contextualBinding = binding) => {
  const contextualLineage = contextualLineageFor(contextualBinding);
  const pairReceipt = pairReceiptFor(pairLineage, production);
  const contextualReceipt = contextualReceiptFor(contextualLineage, production);
  return {
    pairLineage,
    contextualLineage,
    pairReceiptBody: Buffer.from(serializeTypedRelationshipCalibrationReceipt(pairReceipt), 'utf8'),
    contextualReceiptBody: Buffer.from(serializeContextualRelationshipCalibrationReceipt(contextualReceipt), 'utf8'),
  };
};

describe('publication calibration set', () => {
  it('binds exact canonical production-eligible pair and contextual receipts to all 13 edge types', () => {
    const inputs = bodies();
    const receipt = buildCaseGraphPublicationCalibrationSetReceipt(inputs);
    const encoded = Buffer.from(serializeCaseGraphPublicationCalibrationSetReceipt(receipt), 'utf8');
    const decoded = decodeCaseGraphPublicationCalibrationSetReceipt(encoded, {
      receiptSha256: receipt.receiptSha256,
      calibrationSetSha256: receipt.calibrationSetSha256,
    });
    expect(decoded.edgeTypes).toEqual(TYPED_RELATIONSHIP_EDGE_TYPES);
    expect(decoded.pairCalibration.calibratedEdgeTypes).toEqual(TYPED_RELATIONSHIP_PAIR_EDGE_TYPES);
    expect(decoded.contextualCalibration.calibratedEdgeType).toBe('contextual_explanation_candidate');
    expect(verifyCaseGraphPublicationCalibrationSetReceiptBodies({
      receipt: decoded,
      pairReceiptBody: inputs.pairReceiptBody,
      contextualReceiptBody: inputs.contextualReceiptBody,
    }).receipt).toEqual(decoded);
  });

  it('structurally rejects synthetic contract fixtures at the publication boundary', () => {
    expect(() => buildCaseGraphPublicationCalibrationSetReceipt(bodies(false)))
      .toThrow('typed_relationship_calibration_receipt_not_production_eligible');
  });

  it('rejects mixed snapshot bindings even when each receipt is internally hashed', () => {
    const otherBinding = { ...binding, snapshotId: '00000000-0000-4000-8000-000000000999' };
    expect(() => buildCaseGraphPublicationCalibrationSetReceipt(bodies(true, otherBinding)))
      .toThrow('case_graph_publication_calibration_binding_mismatch');
  });

  it('rejects noncanonical source receipt bytes and body substitution', () => {
    const inputs = bodies();
    const prettyPairBody = Buffer.from(JSON.stringify(JSON.parse(inputs.pairReceiptBody.toString('utf8')), null, 2), 'utf8');
    expect(() => buildCaseGraphPublicationCalibrationSetReceipt({ ...inputs, pairReceiptBody: prettyPairBody }))
      .toThrow('case_graph_publication_pair_calibration_receipt_noncanonical');
    const receipt = buildCaseGraphPublicationCalibrationSetReceipt(inputs);
    expect(() => verifyCaseGraphPublicationCalibrationSetReceiptBodies({
      receipt,
      pairReceiptBody: Buffer.concat([inputs.pairReceiptBody, Buffer.from(' ')]),
      contextualReceiptBody: inputs.contextualReceiptBody,
    })).toThrow('case_graph_publication_pair_calibration_receipt_noncanonical');
  });

  it('rejects missing edge coverage, added fields, and receipt digest tampering', () => {
    const receipt = buildCaseGraphPublicationCalibrationSetReceipt(bodies());
    const missingEdge = structuredClone(receipt) as Record<string, unknown>;
    missingEdge.edgeTypes = TYPED_RELATIONSHIP_EDGE_TYPES.slice(0, -1);
    expect(() => decodeCaseGraphPublicationCalibrationSetReceipt(missingEdge))
      .toThrow('case_graph_publication_calibration_set_invalid');
    expect(() => decodeCaseGraphPublicationCalibrationSetReceipt({ ...receipt, unexpected: true }))
      .toThrow('case_graph_publication_calibration_set_invalid');
    expect(() => decodeCaseGraphPublicationCalibrationSetReceipt({ ...receipt, receiptSha256: 'f'.repeat(64) }))
      .toThrow('case_graph_publication_calibration_set_receipt_digest_mismatch');
  });
});
