import { createHash } from 'node:crypto';

import {
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  contextualRelationshipCalibrationLineageSha256,
  decodeContextualRelationshipCalibrationLineage,
  decodeContextualRelationshipCalibrationReceipt,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationLineage,
  type ContextualRelationshipCalibrationReceipt,
} from './contextualRelationshipCalibration';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_EDGE_TYPES,
  TYPED_RELATIONSHIP_MODEL_ID,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_MODEL_VERSION,
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  type TypedRelationshipEdgeType,
} from './typedRelationshipEngine';
import {
  TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
  assertTypedRelationshipCalibrationReceiptProductionEligible,
  decodeTypedRelationshipCalibrationLineage,
  decodeTypedRelationshipCalibrationReceipt,
  serializeTypedRelationshipCalibrationReceipt,
  typedRelationshipCalibrationLineageSha256,
  type TypedRelationshipCalibrationLineage,
  type TypedRelationshipCalibrationReceipt,
} from './typedRelationshipCalibration';
import { FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION } from './typedRelationshipPipeline';

export const CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION = 'case-vortex-publication-calibration-set-v1' as const;
export const CASE_GRAPH_PUBLICATION_CALIBRATION_EDGE_TYPE_SET_SHA256 = relationshipInputSha256(
  TYPED_RELATIONSHIP_EDGE_TYPES,
);

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;

type CalibrationReceiptIdentity = {
  receiptId: string;
  receiptSha256: string;
  receiptBodySha256: string;
  lineageSha256: string;
};

export type CaseGraphPublicationCalibrationSetReceipt = {
  recordType: 'case_graph_publication_calibration_set_receipt';
  schemaVersion: typeof CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  relationshipInput: {
    archiveSetSha256: string;
    manifestDigest: string;
    recordSetSha256: string;
    recordCount: number;
  };
  relationshipEngine: {
    schemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
    pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
    policyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
    policySha256: typeof TYPED_RELATIONSHIP_POLICY_SHA256;
    modelId: typeof TYPED_RELATIONSHIP_MODEL_ID;
    modelVersion: typeof TYPED_RELATIONSHIP_MODEL_VERSION;
    modelSha256: typeof TYPED_RELATIONSHIP_MODEL_SHA256;
  };
  pairLineage: TypedRelationshipCalibrationLineage;
  contextualLineage: ContextualRelationshipCalibrationLineage;
  edgeTypes: TypedRelationshipEdgeType[];
  edgeTypeSetSha256: string;
  pairCalibration: CalibrationReceiptIdentity & {
    calibratedEdgeTypes: Array<typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number]>;
    calibratedEdgeTypeSetSha256: string;
  };
  contextualCalibration: CalibrationReceiptIdentity & {
    calibratedEdgeType: 'contextual_explanation_candidate';
  };
  calibrationSetSha256: string;
  receiptSha256: string;
};

export type BuildCaseGraphPublicationCalibrationSetParams = {
  pairReceiptBody: Buffer;
  contextualReceiptBody: Buffer;
  pairLineage: TypedRelationshipCalibrationLineage;
  contextualLineage: ContextualRelationshipCalibrationLineage;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!isRecord(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(code);
  }
  return value;
};

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

const requireSha = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(code);
  return value;
};

const requireCount = (value: unknown, code: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(code);
  return Number(value);
};

const requireId = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(code);
  return value;
};

const sameCanonical = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

const calibrationSetCore = (
  receipt: Omit<CaseGraphPublicationCalibrationSetReceipt, 'calibrationSetSha256' | 'receiptSha256'>,
) => receipt;

const receiptWithoutSha = (
  receipt: Omit<CaseGraphPublicationCalibrationSetReceipt, 'receiptSha256'>,
) => receipt;

const identityForPair = (
  receipt: TypedRelationshipCalibrationReceipt,
  body: Buffer,
): CaseGraphPublicationCalibrationSetReceipt['pairCalibration'] => ({
  receiptId: receipt.receiptId,
  receiptSha256: receipt.receiptSha256,
  receiptBodySha256: sha256(body),
  lineageSha256: receipt.lineageSha256,
  calibratedEdgeTypes: [...TYPED_RELATIONSHIP_PAIR_EDGE_TYPES],
  calibratedEdgeTypeSetSha256: TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
});

const identityForContextual = (
  receipt: ContextualRelationshipCalibrationReceipt,
  body: Buffer,
): CaseGraphPublicationCalibrationSetReceipt['contextualCalibration'] => ({
  receiptId: receipt.receiptId,
  receiptSha256: receipt.receiptSha256,
  receiptBodySha256: sha256(body),
  lineageSha256: receipt.lineageSha256,
  calibratedEdgeType: 'contextual_explanation_candidate',
});

const decodeCanonicalPairReceipt = (body: Buffer) => {
  const receipt = assertTypedRelationshipCalibrationReceiptProductionEligible(body);
  const canonical = Buffer.from(serializeTypedRelationshipCalibrationReceipt(receipt), 'utf8');
  if (!body.equals(canonical)) throw new Error('case_graph_publication_pair_calibration_receipt_noncanonical');
  return receipt;
};

const decodeCanonicalContextualReceipt = (body: Buffer) => {
  const receipt = assertContextualRelationshipCalibrationReceiptProductionEligible(body);
  const canonical = Buffer.from(serializeContextualRelationshipCalibrationReceipt(receipt), 'utf8');
  if (!body.equals(canonical)) throw new Error('case_graph_publication_contextual_calibration_receipt_noncanonical');
  return receipt;
};

export const caseGraphPublicationCalibrationSetSha256 = (
  receipt: Omit<CaseGraphPublicationCalibrationSetReceipt, 'calibrationSetSha256' | 'receiptSha256'>,
) => relationshipInputSha256(calibrationSetCore(receipt));

export const caseGraphPublicationCalibrationSetReceiptSha256 = (
  receipt: Omit<CaseGraphPublicationCalibrationSetReceipt, 'receiptSha256'>,
) => relationshipInputSha256(receiptWithoutSha(receipt));

export const buildCaseGraphPublicationCalibrationSetReceipt = (
  params: BuildCaseGraphPublicationCalibrationSetParams,
): CaseGraphPublicationCalibrationSetReceipt => {
  if (!Buffer.isBuffer(params.pairReceiptBody) || !Buffer.isBuffer(params.contextualReceiptBody)) {
    throw new Error('case_graph_publication_calibration_receipt_body_required');
  }
  const pairLineage = decodeTypedRelationshipCalibrationLineage(params.pairLineage);
  const contextualLineage = decodeContextualRelationshipCalibrationLineage(params.contextualLineage);
  if (!sameCanonical(pairLineage.binding, contextualLineage.binding)) {
    throw new Error('case_graph_publication_calibration_binding_mismatch');
  }
  const pairReceipt = decodeCanonicalPairReceipt(params.pairReceiptBody);
  const contextualReceipt = decodeCanonicalContextualReceipt(params.contextualReceiptBody);
  const expectedPairLineageSha256 = typedRelationshipCalibrationLineageSha256(pairLineage);
  const expectedContextualLineageSha256 = contextualRelationshipCalibrationLineageSha256(contextualLineage);
  if (pairReceipt.lineageSha256 !== expectedPairLineageSha256) {
    throw new Error('case_graph_publication_pair_calibration_lineage_mismatch');
  }
  if (contextualReceipt.lineageSha256 !== expectedContextualLineageSha256) {
    throw new Error('case_graph_publication_contextual_calibration_lineage_mismatch');
  }
  const binding = validateRelationshipInputBinding(pairLineage.binding);
  const withoutSetSha: Omit<CaseGraphPublicationCalibrationSetReceipt, 'calibrationSetSha256' | 'receiptSha256'> = {
    recordType: 'case_graph_publication_calibration_set_receipt',
    schemaVersion: CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    relationshipInput: {
      archiveSetSha256: pairLineage.relationshipInput.archiveSetSha256,
      manifestDigest: pairLineage.relationshipInput.manifestDigest,
      recordSetSha256: pairLineage.relationshipInput.recordSetSha256,
      recordCount: pairLineage.relationshipInput.recordCount,
    },
    relationshipEngine: {
      schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
      pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
      policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
      policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
      modelId: TYPED_RELATIONSHIP_MODEL_ID,
      modelVersion: TYPED_RELATIONSHIP_MODEL_VERSION,
      modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
    },
    pairLineage,
    contextualLineage,
    edgeTypes: [...TYPED_RELATIONSHIP_EDGE_TYPES],
    edgeTypeSetSha256: CASE_GRAPH_PUBLICATION_CALIBRATION_EDGE_TYPE_SET_SHA256,
    pairCalibration: identityForPair(pairReceipt, params.pairReceiptBody),
    contextualCalibration: identityForContextual(contextualReceipt, params.contextualReceiptBody),
  };
  const calibrationSetSha256 = caseGraphPublicationCalibrationSetSha256(withoutSetSha);
  const withoutReceiptSha = { ...withoutSetSha, calibrationSetSha256 };
  return {
    ...withoutReceiptSha,
    receiptSha256: caseGraphPublicationCalibrationSetReceiptSha256(withoutReceiptSha),
  };
};

const normalizeIdentity = (
  value: unknown,
  kind: 'pair' | 'contextual',
): CalibrationReceiptIdentity => {
  const identity = exact(value, [
    'receiptId', 'receiptSha256', 'receiptBodySha256', 'lineageSha256',
    ...(kind === 'pair' ? ['calibratedEdgeTypes', 'calibratedEdgeTypeSetSha256'] : ['calibratedEdgeType']),
  ], 'case_graph_publication_calibration_set_invalid');
  return {
    receiptId: requireId(identity.receiptId, 'case_graph_publication_calibration_set_invalid'),
    receiptSha256: requireSha(identity.receiptSha256, 'case_graph_publication_calibration_set_invalid'),
    receiptBodySha256: requireSha(identity.receiptBodySha256, 'case_graph_publication_calibration_set_invalid'),
    lineageSha256: requireSha(identity.lineageSha256, 'case_graph_publication_calibration_set_invalid'),
  };
};

export const decodeCaseGraphPublicationCalibrationSetReceipt = (
  input: unknown,
  expected?: { receiptSha256: string; calibrationSetSha256: string },
): CaseGraphPublicationCalibrationSetReceipt => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(String(input));
    } catch {
      throw new Error('case_graph_publication_calibration_set_json_invalid');
    }
  }
  const receipt = exact(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'binding', 'relationshipInput',
    'relationshipEngine', 'pairLineage', 'contextualLineage', 'edgeTypes', 'edgeTypeSetSha256', 'pairCalibration',
    'contextualCalibration', 'calibrationSetSha256', 'receiptSha256',
  ], 'case_graph_publication_calibration_set_invalid');
  if (receipt.recordType !== 'case_graph_publication_calibration_set_receipt'
    || receipt.schemaVersion !== CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION
    || receipt.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !Array.isArray(receipt.edgeTypes)
    || !sameCanonical(receipt.edgeTypes, TYPED_RELATIONSHIP_EDGE_TYPES)
    || receipt.edgeTypeSetSha256 !== CASE_GRAPH_PUBLICATION_CALIBRATION_EDGE_TYPE_SET_SHA256) {
    throw new Error('case_graph_publication_calibration_set_invalid');
  }
  const binding = validateRelationshipInputBinding(receipt.binding);
  const pairLineage = decodeTypedRelationshipCalibrationLineage(receipt.pairLineage);
  const contextualLineage = decodeContextualRelationshipCalibrationLineage(receipt.contextualLineage);
  if (!sameCanonical(binding, pairLineage.binding)
    || !sameCanonical(binding, contextualLineage.binding)) {
    throw new Error('case_graph_publication_calibration_binding_mismatch');
  }
  const relationshipInput = exact(receipt.relationshipInput, [
    'archiveSetSha256', 'manifestDigest', 'recordSetSha256', 'recordCount',
  ], 'case_graph_publication_calibration_set_invalid');
  const relationshipEngine = exact(receipt.relationshipEngine, [
    'schemaVersion', 'pipelineVersion', 'policyVersion', 'policySha256',
    'modelId', 'modelVersion', 'modelSha256',
  ], 'case_graph_publication_calibration_set_invalid');
  if (relationshipEngine.schemaVersion !== TYPED_RELATIONSHIP_SCHEMA_VERSION
    || relationshipEngine.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION
    || relationshipEngine.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION
    || relationshipEngine.policySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256
    || relationshipEngine.modelId !== TYPED_RELATIONSHIP_MODEL_ID
    || relationshipEngine.modelVersion !== TYPED_RELATIONSHIP_MODEL_VERSION
    || relationshipEngine.modelSha256 !== TYPED_RELATIONSHIP_MODEL_SHA256) {
    throw new Error('case_graph_publication_calibration_set_invalid');
  }
  if (relationshipInput.archiveSetSha256 !== pairLineage.relationshipInput.archiveSetSha256
    || relationshipInput.manifestDigest !== pairLineage.relationshipInput.manifestDigest
    || relationshipInput.recordSetSha256 !== pairLineage.relationshipInput.recordSetSha256
    || relationshipInput.recordCount !== pairLineage.relationshipInput.recordCount
    || relationshipInput.recordCount !== binding.universeRecordCount) {
    throw new Error('case_graph_publication_calibration_relationship_input_mismatch');
  }
  const pairBase = normalizeIdentity(receipt.pairCalibration, 'pair');
  const pairRaw = receipt.pairCalibration as Record<string, unknown>;
  if (!Array.isArray(pairRaw.calibratedEdgeTypes)
    || !sameCanonical(pairRaw.calibratedEdgeTypes, TYPED_RELATIONSHIP_PAIR_EDGE_TYPES)
    || pairRaw.calibratedEdgeTypeSetSha256 !== TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256) {
    throw new Error('case_graph_publication_calibration_set_pair_scope_invalid');
  }
  const contextualBase = normalizeIdentity(receipt.contextualCalibration, 'contextual');
  const contextualRaw = receipt.contextualCalibration as Record<string, unknown>;
  if (contextualRaw.calibratedEdgeType !== 'contextual_explanation_candidate') {
    throw new Error('case_graph_publication_calibration_set_contextual_scope_invalid');
  }
  if (pairBase.lineageSha256 !== typedRelationshipCalibrationLineageSha256(pairLineage)) {
    throw new Error('case_graph_publication_pair_calibration_lineage_mismatch');
  }
  if (contextualBase.lineageSha256 !== contextualRelationshipCalibrationLineageSha256(contextualLineage)) {
    throw new Error('case_graph_publication_contextual_calibration_lineage_mismatch');
  }
  const normalizedWithoutHashes: Omit<CaseGraphPublicationCalibrationSetReceipt, 'calibrationSetSha256' | 'receiptSha256'> = {
    recordType: 'case_graph_publication_calibration_set_receipt',
    schemaVersion: CASE_GRAPH_PUBLICATION_CALIBRATION_SET_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    relationshipInput: {
      archiveSetSha256: requireSha(relationshipInput.archiveSetSha256, 'case_graph_publication_calibration_set_invalid'),
      manifestDigest: requireSha(relationshipInput.manifestDigest, 'case_graph_publication_calibration_set_invalid'),
      recordSetSha256: requireSha(relationshipInput.recordSetSha256, 'case_graph_publication_calibration_set_invalid'),
      recordCount: requireCount(relationshipInput.recordCount, 'case_graph_publication_calibration_set_invalid'),
    },
    relationshipEngine: {
      schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
      pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
      policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
      policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
      modelId: TYPED_RELATIONSHIP_MODEL_ID,
      modelVersion: TYPED_RELATIONSHIP_MODEL_VERSION,
      modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
    },
    pairLineage,
    contextualLineage,
    edgeTypes: [...TYPED_RELATIONSHIP_EDGE_TYPES],
    edgeTypeSetSha256: CASE_GRAPH_PUBLICATION_CALIBRATION_EDGE_TYPE_SET_SHA256,
    pairCalibration: {
      ...pairBase,
      calibratedEdgeTypes: [...TYPED_RELATIONSHIP_PAIR_EDGE_TYPES],
      calibratedEdgeTypeSetSha256: TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
    },
    contextualCalibration: {
      ...contextualBase,
      calibratedEdgeType: 'contextual_explanation_candidate',
    },
  };
  const calibrationSetSha256 = requireSha(
    receipt.calibrationSetSha256,
    'case_graph_publication_calibration_set_invalid',
  );
  if (calibrationSetSha256 !== caseGraphPublicationCalibrationSetSha256(normalizedWithoutHashes)) {
    throw new Error('case_graph_publication_calibration_set_digest_mismatch');
  }
  const normalizedWithoutReceiptSha = { ...normalizedWithoutHashes, calibrationSetSha256 };
  const receiptSha256 = requireSha(receipt.receiptSha256, 'case_graph_publication_calibration_set_invalid');
  if (receiptSha256 !== caseGraphPublicationCalibrationSetReceiptSha256(normalizedWithoutReceiptSha)) {
    throw new Error('case_graph_publication_calibration_set_receipt_digest_mismatch');
  }
  if (expected && (receiptSha256 !== expected.receiptSha256
    || calibrationSetSha256 !== expected.calibrationSetSha256)) {
    throw new Error('case_graph_publication_calibration_set_expected_identity_mismatch');
  }
  return { ...normalizedWithoutReceiptSha, receiptSha256 };
};

export const serializeCaseGraphPublicationCalibrationSetReceipt = (
  receipt: CaseGraphPublicationCalibrationSetReceipt,
) => `${canonicalizeRelationshipInput(decodeCaseGraphPublicationCalibrationSetReceipt(receipt))}\n`;

export const verifyCaseGraphPublicationCalibrationSetReceiptBodies = (params: {
  receipt: CaseGraphPublicationCalibrationSetReceipt;
  pairReceiptBody: Buffer;
  contextualReceiptBody: Buffer;
}) => {
  const receipt = decodeCaseGraphPublicationCalibrationSetReceipt(params.receipt);
  const pairReceipt = decodeCanonicalPairReceipt(params.pairReceiptBody);
  const contextualReceipt = decodeCanonicalContextualReceipt(params.contextualReceiptBody);
  decodeTypedRelationshipCalibrationReceipt(pairReceipt, receipt.pairCalibration);
  decodeContextualRelationshipCalibrationReceipt(contextualReceipt, receipt.contextualCalibration);
  if (sha256(params.pairReceiptBody) !== receipt.pairCalibration.receiptBodySha256
    || sha256(params.contextualReceiptBody) !== receipt.contextualCalibration.receiptBodySha256) {
    throw new Error('case_graph_publication_calibration_receipt_body_digest_mismatch');
  }
  const rebuilt = buildCaseGraphPublicationCalibrationSetReceipt({
    pairReceiptBody: params.pairReceiptBody,
    contextualReceiptBody: params.contextualReceiptBody,
    pairLineage: receipt.pairLineage,
    contextualLineage: receipt.contextualLineage,
  });
  if (!sameCanonical(receipt, rebuilt)) {
    throw new Error('case_graph_publication_calibration_set_receipt_binding_mismatch');
  }
  return { receipt, pairReceipt, contextualReceipt };
};
