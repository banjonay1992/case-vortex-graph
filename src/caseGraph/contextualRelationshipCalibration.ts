import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  CONTEXTUAL_EXPLANATION_POLICY,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
  type ContextualExplanationCandidateDraft,
  type ContextualExplanationEvaluation,
} from './contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
} from './contextualRelationshipAdapter';
import { CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION } from './contextualObservationArchive';
import {
  assertRelationshipInputBinding,
  validateRelationshipInputBinding,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION = 'case-graph-contextual-relationship-calibration-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION = CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_PLAN_VERSION = 'case-graph-contextual-locked-holdout-plan-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_REVIEW_VERSION = 'case-graph-contextual-calibration-review-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_TRUST_VERSION = 'case-graph-contextual-calibration-trust-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION = 'case-graph-contextual-production-gates-v1' as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION = 'wilson-one-sided-95-v1' as const;

export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_KINDS = [
  'aircraft', 'satellite', 'astronomy', 'weather',
] as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES = [
  'near_policy_threshold',
  'coarse_precision',
  'provider_dependency',
  'historical_coverage_gap',
] as const;
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY = Object.freeze({
  minimumLabelCount: 800,
  minimumPositiveLabelsPerKind: 100,
  minimumNegativeLabelsPerKind: 100,
  minimumHardNegativeLabels: 200,
  minimumHardNegativeLabelsPerCategory: 50,
  minimumSourceSliceLabels: 200,
  minimumPrecisionSliceLabels: 200,
  minimumPrecisionLowerPpm: 970_000,
  minimumRecallLowerPpm: 970_000,
  maximumFalsePositiveRateUpperPpm: 30_000,
  minimumCoveragePpm: 980_000,
  maximumHardNegativeFalsePositives: 0,
  maximumInsufficientPredictedPositives: 0,
  confidenceIntervalVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION,
} as const);
export const CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256 = contextualExplanationSha256(
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY,
);

type ContextKind = typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_KINDS[number];
type HardNegative = typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES[number];
type TruthLabel = 'positive' | 'negative' | 'insufficient';

export type ContextualCalibrationSourceArchiveLineage = {
  kind: ContextKind;
  sourceFamily:
    | 'aircraft_adsb_history'
    | 'satellite_tle_sgp4_history'
    | 'astronomy_ephemeris_history'
    | 'weather_observation_history';
  sourceId: string;
  providerId: string;
  datasetVersion: string;
  sourceSnapshotDigest: string;
  completionManifestDigest: string;
  archiveSetSha256: string;
  sourcePageSetSha256: string;
  rowCount: number;
  emittedEdgeCount: number;
  insufficientEvidenceCount: number;
};

export type ContextualCalibrationModelIdentity = {
  modelId: string;
  modelVersion: string;
  method: 'deterministic' | 'governed_model';
  modelIdentitySha256: string;
};

export type ContextualRelationshipCalibrationLineage = {
  binding: RelationshipInputUniverseBinding;
  observationArchiveVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION;
  sourceArchives: ContextualCalibrationSourceArchiveLineage[];
  observationArchiveSetSha256: string;
  contextualPolicy: {
    schemaVersion: typeof CONTEXTUAL_EXPLANATION_SCHEMA_VERSION;
    policyVersion: typeof CONTEXTUAL_EXPLANATION_POLICY_VERSION;
    policySha256: string;
    thresholds: typeof CONTEXTUAL_EXPLANATION_POLICY;
  };
  adapter: {
    adapterVersion: typeof CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION;
    governedPayloadSchemaVersion: typeof GOVERNED_CONTEXTUAL_OBSERVATION_VERSION;
  };
  models: ContextualCalibrationModelIdentity[];
  lineageDigest: string;
};

export type ContextualCalibrationMembership = {
  sampleId: string;
  sourceGroupId: string;
};

export type ContextualRelationshipCalibrationAuditPlan = {
  recordType: 'contextual_relationship_calibration_audit_plan';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  planVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_PLAN_VERSION;
  lockedHoldout: ContextualCalibrationMembership[];
  tuningSet: ContextualCalibrationMembership[];
  sampleMembership: Array<ContextualCalibrationMembership & { split: 'locked_holdout' | 'tuning' }>;
  labelPolicyVersion: string;
  groupingPolicyVersion: string;
  planDigest: string;
};

export type ContextualRelationshipCalibrationReviewReceipt = {
  recordType: 'contextual_relationship_calibration_review_receipt';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_REVIEW_VERSION;
  sampleId: string;
  evaluationDigest: string;
  truthLabel: TruthLabel;
  hardNegativeCategory: HardNegative | null;
  reviewerCohortId: string;
  adjudicationPolicyVersion: string;
  reviewerIds: string[];
  sourceArchiveKey: string;
  sourceArchiveVersion: string;
  sourceObjectSha256: string;
  reviewReceiptId: string;
  reviewReceiptSha256: string;
};

export type ContextualRelationshipCalibrationTrustPolicy = {
  recordType: 'contextual_relationship_calibration_trust_policy';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_TRUST_VERSION;
  lineageDigest: string;
  auditPlanDigest: string;
  reviewReceiptSetSha256: string;
  reviewerCohortId: string;
  adjudicationPolicyVersion: string;
  minimumIndependentReviewers: number;
  evidenceClass: 'synthetic_contract_fixture' | 'human_reviewed_locked_holdout';
  authorizationScope: 'test_only_never_publish' | 'production_candidate';
  trustPolicyDigest: string;
};

export type ContextualRelationshipCalibrationLabelDraft = {
  candidate: ContextualExplanationCandidateDraft;
  evaluation: ContextualExplanationEvaluation;
  sourceSnapshotDigest: string;
  observationArchiveRecordDigest: string;
  truthLabel: TruthLabel;
  hardNegativeCategory: HardNegative | null;
  review: ContextualRelationshipCalibrationReviewReceipt;
};

export type ContextualRelationshipCalibrationLabel = ContextualRelationshipCalibrationLabelDraft & {
  recordType: 'contextual_relationship_calibration_label';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  sampleId: string;
  precisionSlice: 'bounded_precise' | 'coarse_or_missing';
  coverageSlice: 'complete_context' | 'incomplete_context';
  labelDigest: string;
};

export type ContextualCalibrationMetric =
  | {
    status: 'measured';
    numerator: number;
    denominator: number;
    valuePpm: number;
    lowerPpm: number;
    upperPpm: number;
    intervalVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION;
  }
  | { status: 'not_evaluable'; numerator: number; denominator: 0; reason: 'zero_denominator' };

export type ContextualCalibrationMetrics = {
  confusion: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    insufficientPredictedPositive: number;
    insufficientPredictedNegative: number;
  };
  labelCount: number;
  adjudicatedCount: number;
  positiveLabelCount: number;
  negativeLabelCount: number;
  insufficientLabelCount: number;
  precision: ContextualCalibrationMetric;
  recall: ContextualCalibrationMetric;
  falsePositiveRate: ContextualCalibrationMetric;
  coverage: ContextualCalibrationMetric;
};

export type ContextualCalibrationSliceMetrics = {
  sliceId: string;
  metrics: ContextualCalibrationMetrics;
};

export type ContextualCalibrationGateCheck = {
  gateId: string;
  status: 'pass';
  actual: number;
  operator: 'greater_than_or_equal' | 'less_than_or_equal' | 'equal';
  threshold: number;
};

export type ContextualRelationshipCalibrationReceipt = {
  recordType: 'contextual_relationship_calibration_receipt';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  receiptId: string;
  decision: 'contract_gates_passed_test_only' | 'production_gates_passed';
  calibrationCoreSha256: string;
  lineageSha256: string;
  auditPlanSha256: string;
  trustPolicyDigest: string;
  evaluationSetSha256: string;
  labelSetSha256: string;
  metricsSha256: string;
  gatePolicyVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION;
  gatePolicySha256: string;
  evidenceClass: ContextualRelationshipCalibrationTrustPolicy['evidenceClass'];
  authorizationScope: ContextualRelationshipCalibrationTrustPolicy['authorizationScope'];
  calibratedEdgeType: 'contextual_explanation_candidate';
  claimDiscipline: typeof CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE;
  receiptSha256: string;
};

export type ContextualRelationshipCalibrationArtifact = {
  recordType: 'contextual_relationship_calibration_artifact';
  schemaVersion: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  decision: ContextualRelationshipCalibrationReceipt['decision'];
  lineage: ContextualRelationshipCalibrationLineage;
  auditPlan: ContextualRelationshipCalibrationAuditPlan;
  trustPolicy: ContextualRelationshipCalibrationTrustPolicy;
  gatePolicy: typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY;
  labels: ContextualRelationshipCalibrationLabel[];
  labelCount: number;
  sliceMetrics: ContextualCalibrationSliceMetrics[];
  gateChecks: ContextualCalibrationGateCheck[];
  evaluationSetSha256: string;
  labelSetSha256: string;
  calibrationCoreSha256: string;
  receipt: ContextualRelationshipCalibrationReceipt;
  artifactDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const SAMPLE_ID = /^context-calibration-sample:[a-f0-9]{64}$/;
const Z = 1.6448536269514722;
const PPM = 1_000_000;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function invalid(code: string): never { throw new Error(code); }
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!plain(value)) invalid(code);
  const actual = Object.keys(value).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};
const reqSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value;
};
const reqId = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !ID.test(value)) invalid(code);
  return value;
};
const reqCount = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

const SOURCE_FAMILY: Record<ContextKind, ContextualCalibrationSourceArchiveLineage['sourceFamily']> = {
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
};

const normalizeSourceArchive = (value: unknown): ContextualCalibrationSourceArchiveLineage => {
  const source = exact(value, [
    'kind', 'sourceFamily', 'sourceId', 'providerId', 'datasetVersion', 'sourceSnapshotDigest',
    'completionManifestDigest', 'archiveSetSha256', 'sourcePageSetSha256', 'rowCount',
    'emittedEdgeCount', 'insufficientEvidenceCount',
  ], 'contextual_calibration_source_archive_invalid');
  if (!CONTEXTUAL_RELATIONSHIP_CALIBRATION_KINDS.includes(source.kind as ContextKind)
    || source.sourceFamily !== SOURCE_FAMILY[source.kind as ContextKind]) {
    invalid('contextual_calibration_source_archive_invalid');
  }
  const rowCount = reqCount(source.rowCount, 'contextual_calibration_source_archive_invalid');
  const emittedEdgeCount = reqCount(source.emittedEdgeCount, 'contextual_calibration_source_archive_invalid');
  const insufficientEvidenceCount = reqCount(source.insufficientEvidenceCount, 'contextual_calibration_source_archive_invalid');
  if (emittedEdgeCount + insufficientEvidenceCount !== rowCount) {
    invalid('contextual_calibration_source_archive_accounting_invalid');
  }
  return {
    kind: source.kind as ContextKind,
    sourceFamily: source.sourceFamily as ContextualCalibrationSourceArchiveLineage['sourceFamily'],
    sourceId: reqId(source.sourceId, 'contextual_calibration_source_archive_invalid'),
    providerId: reqId(source.providerId, 'contextual_calibration_source_archive_invalid'),
    datasetVersion: reqId(source.datasetVersion, 'contextual_calibration_source_archive_invalid'),
    sourceSnapshotDigest: reqSha(source.sourceSnapshotDigest, 'contextual_calibration_source_archive_invalid'),
    completionManifestDigest: reqSha(source.completionManifestDigest, 'contextual_calibration_source_archive_invalid'),
    archiveSetSha256: reqSha(source.archiveSetSha256, 'contextual_calibration_source_archive_invalid'),
    sourcePageSetSha256: reqSha(source.sourcePageSetSha256, 'contextual_calibration_source_archive_invalid'),
    rowCount,
    emittedEdgeCount,
    insufficientEvidenceCount,
  };
};

const normalizeModel = (value: unknown): ContextualCalibrationModelIdentity => {
  const model = exact(value, ['modelId', 'modelVersion', 'method', 'modelIdentitySha256'], 'contextual_calibration_model_invalid');
  if (!['deterministic', 'governed_model'].includes(String(model.method))) invalid('contextual_calibration_model_invalid');
  const withoutSha = {
    modelId: reqId(model.modelId, 'contextual_calibration_model_invalid'),
    modelVersion: reqId(model.modelVersion, 'contextual_calibration_model_invalid'),
    method: model.method as ContextualCalibrationModelIdentity['method'],
  };
  const modelIdentitySha256 = reqSha(model.modelIdentitySha256, 'contextual_calibration_model_invalid');
  if (modelIdentitySha256 !== contextualExplanationSha256(withoutSha)) invalid('contextual_calibration_model_digest_mismatch');
  return { ...withoutSha, modelIdentitySha256 };
};

const lineageWithoutDigest = (lineage: Omit<ContextualRelationshipCalibrationLineage, 'lineageDigest'>) => lineage;
const normalizeLineage = (value: unknown): ContextualRelationshipCalibrationLineage => {
  const lineage = exact(value, [
    'binding', 'observationArchiveVersion', 'sourceArchives', 'observationArchiveSetSha256',
    'contextualPolicy', 'adapter', 'models', 'lineageDigest',
  ], 'contextual_calibration_lineage_invalid');
  const binding = validateRelationshipInputBinding(lineage.binding);
  if (lineage.observationArchiveVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION
    || !Array.isArray(lineage.sourceArchives)
    || !Array.isArray(lineage.models)) invalid('contextual_calibration_lineage_invalid');
  const sourceArchives = lineage.sourceArchives.map(normalizeSourceArchive).sort((left, right) => (
    compare(left.kind, right.kind) || compare(left.sourceSnapshotDigest, right.sourceSnapshotDigest)
  ));
  if (new Set(sourceArchives.map((source) => source.sourceSnapshotDigest)).size !== sourceArchives.length
    || CONTEXTUAL_RELATIONSHIP_CALIBRATION_KINDS.some((kind) => !sourceArchives.some((source) => source.kind === kind))) {
    invalid('contextual_calibration_source_coverage_invalid');
  }
  const observationArchiveSetSha256 = contextualExplanationSha256(sourceArchives.map((source) => ({
    sourceSnapshotDigest: source.sourceSnapshotDigest,
    completionManifestDigest: source.completionManifestDigest,
    archiveSetSha256: source.archiveSetSha256,
  })));
  if (lineage.observationArchiveSetSha256 !== observationArchiveSetSha256) {
    invalid('contextual_calibration_archive_set_mismatch');
  }
  const policy = exact(lineage.contextualPolicy, [
    'schemaVersion', 'policyVersion', 'policySha256', 'thresholds',
  ], 'contextual_calibration_policy_invalid');
  if (policy.schemaVersion !== CONTEXTUAL_EXPLANATION_SCHEMA_VERSION
    || policy.policyVersion !== CONTEXTUAL_EXPLANATION_POLICY_VERSION
    || policy.policySha256 !== CONTEXTUAL_EXPLANATION_POLICY_SHA256
    || canonicalizeContextualExplanation(policy.thresholds)
      !== canonicalizeContextualExplanation(CONTEXTUAL_EXPLANATION_POLICY)) {
    invalid('contextual_calibration_policy_invalid');
  }
  const adapter = exact(lineage.adapter, [
    'adapterVersion', 'governedPayloadSchemaVersion',
  ], 'contextual_calibration_adapter_invalid');
  if (adapter.adapterVersion !== CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION
    || adapter.governedPayloadSchemaVersion !== GOVERNED_CONTEXTUAL_OBSERVATION_VERSION) {
    invalid('contextual_calibration_adapter_invalid');
  }
  const models = lineage.models.map(normalizeModel).sort((left, right) => (
    compare(left.modelId, right.modelId) || compare(left.modelVersion, right.modelVersion) || compare(left.method, right.method)
  ));
  if (!models.length || new Set(models.map((model) => model.modelIdentitySha256)).size !== models.length) {
    invalid('contextual_calibration_model_set_invalid');
  }
  const withoutDigest: Omit<ContextualRelationshipCalibrationLineage, 'lineageDigest'> = {
    binding,
    observationArchiveVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    sourceArchives,
    observationArchiveSetSha256,
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
    models,
  };
  const lineageDigest = reqSha(lineage.lineageDigest, 'contextual_calibration_lineage_invalid');
  if (lineageDigest !== contextualExplanationSha256(lineageWithoutDigest(withoutDigest))) {
    invalid('contextual_calibration_lineage_digest_mismatch');
  }
  return { ...withoutDigest, lineageDigest };
};

export const buildContextualRelationshipCalibrationLineage = (params: Omit<
ContextualRelationshipCalibrationLineage,
'observationArchiveSetSha256' | 'lineageDigest'
>): ContextualRelationshipCalibrationLineage => {
  const sources = params.sourceArchives.map(normalizeSourceArchive).sort((left, right) => (
    compare(left.kind, right.kind) || compare(left.sourceSnapshotDigest, right.sourceSnapshotDigest)
  ));
  const observationArchiveSetSha256 = contextualExplanationSha256(sources.map((source) => ({
    sourceSnapshotDigest: source.sourceSnapshotDigest,
    completionManifestDigest: source.completionManifestDigest,
    archiveSetSha256: source.archiveSetSha256,
  })));
  const withoutDigest = { ...params, sourceArchives: sources, observationArchiveSetSha256 };
  return normalizeLineage({
    ...withoutDigest,
    lineageDigest: contextualExplanationSha256(lineageWithoutDigest(withoutDigest)),
  });
};
export const decodeContextualRelationshipCalibrationLineage = (input: unknown) => normalizeLineage(input);
export const contextualRelationshipCalibrationLineageSha256 = (
  lineage: ContextualRelationshipCalibrationLineage,
) => contextualExplanationSha256(normalizeLineage(lineage));

export const getContextualRelationshipCalibrationSampleId = (params: {
  candidate: ContextualExplanationCandidateDraft;
  sourceSnapshotDigest: string;
  observationArchiveRecordDigest: string;
}) => `context-calibration-sample:${contextualExplanationSha256({
  candidate: params.candidate,
  sourceSnapshotDigest: params.sourceSnapshotDigest,
  observationArchiveRecordDigest: params.observationArchiveRecordDigest,
})}` as const;

const normalizeMembership = (value: unknown, code: string): ContextualCalibrationMembership => {
  const item = exact(value, ['sampleId', 'sourceGroupId'], code);
  if (typeof item.sampleId !== 'string' || !SAMPLE_ID.test(item.sampleId)) invalid(code);
  return { sampleId: item.sampleId, sourceGroupId: reqId(item.sourceGroupId, code) };
};
const sortMembership = <T extends ContextualCalibrationMembership>(items: T[]) => items.sort(
  (left, right) => compare(left.sampleId, right.sampleId) || compare(left.sourceGroupId, right.sourceGroupId),
);
const planWithoutDigest = (plan: Omit<ContextualRelationshipCalibrationAuditPlan, 'planDigest'>) => plan;
const normalizePlan = (value: unknown): ContextualRelationshipCalibrationAuditPlan => {
  const plan = exact(value, [
    'recordType', 'schemaVersion', 'planVersion', 'lockedHoldout', 'tuningSet', 'sampleMembership',
    'labelPolicyVersion', 'groupingPolicyVersion', 'planDigest',
  ], 'contextual_calibration_plan_invalid');
  if (plan.recordType !== 'contextual_relationship_calibration_audit_plan'
    || plan.schemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION
    || plan.planVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_PLAN_VERSION
    || !Array.isArray(plan.lockedHoldout) || !plan.lockedHoldout.length
    || !Array.isArray(plan.tuningSet) || !plan.tuningSet.length
    || !Array.isArray(plan.sampleMembership)) invalid('contextual_calibration_plan_invalid');
  const lockedHoldout = sortMembership(plan.lockedHoldout.map((item) => normalizeMembership(item, 'contextual_calibration_holdout_invalid')));
  const tuningSet = sortMembership(plan.tuningSet.map((item) => normalizeMembership(item, 'contextual_calibration_tuning_invalid')));
  const holdoutIds = new Set(lockedHoldout.map((item) => item.sampleId));
  const tuningIds = new Set(tuningSet.map((item) => item.sampleId));
  const holdoutGroups = new Set(lockedHoldout.map((item) => item.sourceGroupId));
  if (holdoutIds.size !== lockedHoldout.length || tuningIds.size !== tuningSet.length
    || [...holdoutIds].some((id) => tuningIds.has(id))
    || tuningSet.some((item) => holdoutGroups.has(item.sourceGroupId))) {
    invalid('contextual_calibration_split_leakage');
  }
  const sampleMembership = plan.sampleMembership.map((raw) => {
    const item = exact(raw, ['sampleId', 'sourceGroupId', 'split'], 'contextual_calibration_membership_invalid');
    if (!['locked_holdout', 'tuning'].includes(String(item.split))) invalid('contextual_calibration_membership_invalid');
    return {
      ...normalizeMembership({ sampleId: item.sampleId, sourceGroupId: item.sourceGroupId }, 'contextual_calibration_membership_invalid'),
      split: item.split as 'locked_holdout' | 'tuning',
    };
  }).sort((left, right) => compare(left.sampleId, right.sampleId));
  const expected = [
    ...lockedHoldout.map((item) => ({ ...item, split: 'locked_holdout' as const })),
    ...tuningSet.map((item) => ({ ...item, split: 'tuning' as const })),
  ].sort((left, right) => compare(left.sampleId, right.sampleId));
  if (canonicalizeContextualExplanation(sampleMembership) !== canonicalizeContextualExplanation(expected)) {
    invalid('contextual_calibration_membership_mismatch');
  }
  const withoutDigest: Omit<ContextualRelationshipCalibrationAuditPlan, 'planDigest'> = {
    recordType: 'contextual_relationship_calibration_audit_plan',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    planVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_PLAN_VERSION,
    lockedHoldout,
    tuningSet,
    sampleMembership,
    labelPolicyVersion: reqId(plan.labelPolicyVersion, 'contextual_calibration_plan_invalid'),
    groupingPolicyVersion: reqId(plan.groupingPolicyVersion, 'contextual_calibration_plan_invalid'),
  };
  const planDigest = reqSha(plan.planDigest, 'contextual_calibration_plan_invalid');
  if (planDigest !== contextualExplanationSha256(planWithoutDigest(withoutDigest))) {
    invalid('contextual_calibration_plan_digest_mismatch');
  }
  return { ...withoutDigest, planDigest };
};
export const buildContextualRelationshipCalibrationAuditPlan = (params: {
  lockedHoldout: ContextualCalibrationMembership[];
  tuningSet: ContextualCalibrationMembership[];
  labelPolicyVersion: string;
  groupingPolicyVersion: string;
}) => {
  const lockedHoldout = sortMembership(params.lockedHoldout.map((item) => ({ ...item })));
  const tuningSet = sortMembership(params.tuningSet.map((item) => ({ ...item })));
  const withoutDigest: Omit<ContextualRelationshipCalibrationAuditPlan, 'planDigest'> = {
    recordType: 'contextual_relationship_calibration_audit_plan',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    planVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_PLAN_VERSION,
    lockedHoldout,
    tuningSet,
    sampleMembership: [
      ...lockedHoldout.map((item) => ({ ...item, split: 'locked_holdout' as const })),
      ...tuningSet.map((item) => ({ ...item, split: 'tuning' as const })),
    ].sort((left, right) => compare(left.sampleId, right.sampleId)),
    labelPolicyVersion: params.labelPolicyVersion,
    groupingPolicyVersion: params.groupingPolicyVersion,
  };
  return normalizePlan({ ...withoutDigest, planDigest: contextualExplanationSha256(planWithoutDigest(withoutDigest)) });
};
export const decodeContextualRelationshipCalibrationAuditPlan = (input: unknown) => normalizePlan(input);

const reviewCore = (review: Omit<ContextualRelationshipCalibrationReviewReceipt, 'reviewReceiptId' | 'reviewReceiptSha256'>) => review;
const reviewWithoutSha = (review: Omit<ContextualRelationshipCalibrationReviewReceipt, 'reviewReceiptSha256'>) => review;
const normalizeReview = (value: unknown): ContextualRelationshipCalibrationReviewReceipt => {
  const review = exact(value, [
    'recordType', 'schemaVersion', 'sampleId', 'evaluationDigest', 'truthLabel', 'hardNegativeCategory',
    'reviewerCohortId', 'adjudicationPolicyVersion', 'reviewerIds', 'sourceArchiveKey',
    'sourceArchiveVersion', 'sourceObjectSha256', 'reviewReceiptId', 'reviewReceiptSha256',
  ], 'contextual_calibration_review_invalid');
  if (review.recordType !== 'contextual_relationship_calibration_review_receipt'
    || review.schemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_REVIEW_VERSION
    || typeof review.sampleId !== 'string' || !SAMPLE_ID.test(review.sampleId)
    || !['positive', 'negative', 'insufficient'].includes(String(review.truthLabel))
    || !Array.isArray(review.reviewerIds) || review.reviewerIds.length < 2) invalid('contextual_calibration_review_invalid');
  const reviewerIds = review.reviewerIds.map((id) => reqId(id, 'contextual_calibration_review_invalid')).sort(compare);
  if (new Set(reviewerIds).size !== reviewerIds.length) invalid('contextual_calibration_review_duplicate_reviewer');
  const hardNegativeCategory = review.hardNegativeCategory === null ? null
    : CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES.includes(review.hardNegativeCategory as HardNegative)
      ? review.hardNegativeCategory as HardNegative : invalid('contextual_calibration_review_invalid');
  const withoutIds: Omit<ContextualRelationshipCalibrationReviewReceipt, 'reviewReceiptId' | 'reviewReceiptSha256'> = {
    recordType: 'contextual_relationship_calibration_review_receipt',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_REVIEW_VERSION,
    sampleId: review.sampleId,
    evaluationDigest: reqSha(review.evaluationDigest, 'contextual_calibration_review_invalid'),
    truthLabel: review.truthLabel as TruthLabel,
    hardNegativeCategory,
    reviewerCohortId: reqId(review.reviewerCohortId, 'contextual_calibration_review_invalid'),
    adjudicationPolicyVersion: reqId(review.adjudicationPolicyVersion, 'contextual_calibration_review_invalid'),
    reviewerIds,
    sourceArchiveKey: reqId(review.sourceArchiveKey, 'contextual_calibration_review_invalid'),
    sourceArchiveVersion: reqId(review.sourceArchiveVersion, 'contextual_calibration_review_invalid'),
    sourceObjectSha256: reqSha(review.sourceObjectSha256, 'contextual_calibration_review_invalid'),
  };
  const reviewReceiptId = `context-calibration-review:${contextualExplanationSha256(reviewCore(withoutIds))}`;
  if (review.reviewReceiptId !== reviewReceiptId) invalid('contextual_calibration_review_id_mismatch');
  const withoutSha = { ...withoutIds, reviewReceiptId };
  const reviewReceiptSha256 = contextualExplanationSha256(reviewWithoutSha(withoutSha));
  if (review.reviewReceiptSha256 !== reviewReceiptSha256) invalid('contextual_calibration_review_digest_mismatch');
  return { ...withoutSha, reviewReceiptSha256 };
};
export const buildContextualRelationshipCalibrationReviewReceipt = (params: Omit<
ContextualRelationshipCalibrationReviewReceipt,
'recordType' | 'schemaVersion' | 'reviewReceiptId' | 'reviewReceiptSha256'
>) => {
  const core = {
    recordType: 'contextual_relationship_calibration_review_receipt' as const,
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_REVIEW_VERSION,
    ...params,
  };
  const reviewReceiptId = `context-calibration-review:${contextualExplanationSha256(reviewCore(core))}`;
  const withoutSha = { ...core, reviewReceiptId };
  return normalizeReview({ ...withoutSha, reviewReceiptSha256: contextualExplanationSha256(reviewWithoutSha(withoutSha)) });
};
export const decodeContextualRelationshipCalibrationReviewReceipt = (input: unknown) => normalizeReview(input);
export const contextualRelationshipCalibrationReviewSetSha256 = (
  reviews: readonly ContextualRelationshipCalibrationReviewReceipt[],
) => contextualExplanationSha256(reviews.map(normalizeReview).sort((left, right) => compare(left.sampleId, right.sampleId))
  .map((review) => ({ sampleId: review.sampleId, reviewReceiptSha256: review.reviewReceiptSha256 })));

const trustWithoutDigest = (trust: Omit<ContextualRelationshipCalibrationTrustPolicy, 'trustPolicyDigest'>) => trust;
const normalizeTrust = (value: unknown): ContextualRelationshipCalibrationTrustPolicy => {
  const trust = exact(value, [
    'recordType', 'schemaVersion', 'lineageDigest', 'auditPlanDigest', 'reviewReceiptSetSha256',
    'reviewerCohortId', 'adjudicationPolicyVersion', 'minimumIndependentReviewers',
    'evidenceClass', 'authorizationScope', 'trustPolicyDigest',
  ], 'contextual_calibration_trust_invalid');
  if (trust.recordType !== 'contextual_relationship_calibration_trust_policy'
    || trust.schemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_TRUST_VERSION) invalid('contextual_calibration_trust_invalid');
  const withoutDigest: Omit<ContextualRelationshipCalibrationTrustPolicy, 'trustPolicyDigest'> = {
    recordType: 'contextual_relationship_calibration_trust_policy',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_TRUST_VERSION,
    lineageDigest: reqSha(trust.lineageDigest, 'contextual_calibration_trust_invalid'),
    auditPlanDigest: reqSha(trust.auditPlanDigest, 'contextual_calibration_trust_invalid'),
    reviewReceiptSetSha256: reqSha(trust.reviewReceiptSetSha256, 'contextual_calibration_trust_invalid'),
    reviewerCohortId: reqId(trust.reviewerCohortId, 'contextual_calibration_trust_invalid'),
    adjudicationPolicyVersion: reqId(trust.adjudicationPolicyVersion, 'contextual_calibration_trust_invalid'),
    minimumIndependentReviewers: reqCount(trust.minimumIndependentReviewers, 'contextual_calibration_trust_invalid', 2),
    evidenceClass: trust.evidenceClass as ContextualRelationshipCalibrationTrustPolicy['evidenceClass'],
    authorizationScope: trust.authorizationScope as ContextualRelationshipCalibrationTrustPolicy['authorizationScope'],
  };
  if (!['synthetic_contract_fixture', 'human_reviewed_locked_holdout'].includes(withoutDigest.evidenceClass)
    || !['test_only_never_publish', 'production_candidate'].includes(withoutDigest.authorizationScope)
    || (withoutDigest.authorizationScope === 'production_candidate'
      && withoutDigest.evidenceClass !== 'human_reviewed_locked_holdout')) invalid('contextual_calibration_trust_authorization_invalid');
  const trustPolicyDigest = reqSha(trust.trustPolicyDigest, 'contextual_calibration_trust_invalid');
  if (trustPolicyDigest !== contextualExplanationSha256(trustWithoutDigest(withoutDigest))) {
    invalid('contextual_calibration_trust_digest_mismatch');
  }
  return { ...withoutDigest, trustPolicyDigest };
};
export const buildContextualRelationshipCalibrationTrustPolicy = (params: Omit<
ContextualRelationshipCalibrationTrustPolicy,
'recordType' | 'schemaVersion' | 'trustPolicyDigest'
>) => {
  const withoutDigest = {
    recordType: 'contextual_relationship_calibration_trust_policy' as const,
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_TRUST_VERSION,
    ...params,
  };
  return normalizeTrust({ ...withoutDigest, trustPolicyDigest: contextualExplanationSha256(trustWithoutDigest(withoutDigest)) });
};
export const decodeContextualRelationshipCalibrationTrustPolicy = (input: unknown) => normalizeTrust(input);

const modelIdentity = (candidate: ContextualExplanationCandidateDraft): ContextualCalibrationModelIdentity => {
  const identity = {
    modelId: candidate.model.modelId,
    modelVersion: candidate.model.modelVersion,
    method: candidate.model.method,
  };
  return { ...identity, modelIdentitySha256: contextualExplanationSha256(identity) };
};
const precisionSlice = (candidate: ContextualExplanationCandidateDraft) => {
  const window = candidate.subjectObservation.window;
  const location = candidate.subjectObservation.location;
  return window && location && window.precisionSeconds <= 60 && location.precisionKm <= 10
    ? 'bounded_precise' as const : 'coarse_or_missing' as const;
};
const coverageSlice = (candidate: ContextualExplanationCandidateDraft) => (
  candidate.subjectObservation.window && candidate.subjectObservation.location
    ? 'complete_context' as const : 'incomplete_context' as const
);
const labelWithoutDigest = (label: Omit<ContextualRelationshipCalibrationLabel, 'labelDigest'>) => label;
const buildLabel = (
  draft: ContextualRelationshipCalibrationLabelDraft,
  lineage: ContextualRelationshipCalibrationLineage,
): ContextualRelationshipCalibrationLabel => {
  if (!plain(draft)) invalid('contextual_calibration_label_invalid');
  const evaluation = evaluateContextualExplanationCandidate(draft.candidate);
  if (canonicalizeContextualExplanation(evaluation) !== canonicalizeContextualExplanation(draft.evaluation)) {
    invalid('contextual_calibration_evaluation_mismatch');
  }
  if (!['positive', 'negative', 'insufficient'].includes(draft.truthLabel)) invalid('contextual_calibration_label_invalid');
  if (draft.hardNegativeCategory !== null
    && (!CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES.includes(draft.hardNegativeCategory)
      || draft.truthLabel !== 'negative')) invalid('contextual_calibration_hard_negative_invalid');
  const source = lineage.sourceArchives.find((item) => item.sourceSnapshotDigest === draft.sourceSnapshotDigest)
    || invalid('contextual_calibration_source_snapshot_unknown');
  if (source.kind !== draft.candidate.kind
    || !draft.candidate.provenance.some((item) => item.role === 'context_reference'
      && item.providerId === source.providerId && item.datasetVersion === source.datasetVersion)) {
    invalid('contextual_calibration_candidate_source_mismatch');
  }
  reqSha(draft.observationArchiveRecordDigest, 'contextual_calibration_archive_record_digest_invalid');
  const sampleId = getContextualRelationshipCalibrationSampleId({
    candidate: draft.candidate,
    sourceSnapshotDigest: draft.sourceSnapshotDigest,
    observationArchiveRecordDigest: draft.observationArchiveRecordDigest,
  });
  const evaluationDigest = contextualExplanationSha256(evaluation);
  const review = normalizeReview(draft.review);
  if (review.sampleId !== sampleId || review.evaluationDigest !== evaluationDigest
    || review.truthLabel !== draft.truthLabel || review.hardNegativeCategory !== draft.hardNegativeCategory) {
    invalid('contextual_calibration_review_label_mismatch');
  }
  const withoutDigest: Omit<ContextualRelationshipCalibrationLabel, 'labelDigest'> = {
    recordType: 'contextual_relationship_calibration_label',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    sampleId,
    candidate: structuredClone(draft.candidate),
    evaluation,
    sourceSnapshotDigest: draft.sourceSnapshotDigest,
    observationArchiveRecordDigest: draft.observationArchiveRecordDigest,
    truthLabel: draft.truthLabel,
    hardNegativeCategory: draft.hardNegativeCategory,
    review,
    precisionSlice: precisionSlice(draft.candidate),
    coverageSlice: coverageSlice(draft.candidate),
  };
  return { ...withoutDigest, labelDigest: contextualExplanationSha256(labelWithoutDigest(withoutDigest)) };
};

const metric = (numerator: number, denominator: number): ContextualCalibrationMetric => {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
    || numerator < 0 || denominator < 0 || numerator > denominator) invalid('contextual_calibration_metric_invalid');
  if (denominator === 0) return { status: 'not_evaluable', numerator, denominator: 0, reason: 'zero_denominator' };
  const p = numerator / denominator;
  const z2 = Z ** 2;
  const scale = 1 + z2 / denominator;
  const centre = (p + z2 / (2 * denominator)) / scale;
  const margin = (Z * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator)) / scale;
  return {
    status: 'measured', numerator, denominator, valuePpm: Math.round(p * PPM),
    lowerPpm: Math.max(0, Math.round((centre - margin) * PPM)),
    upperPpm: Math.min(PPM, Math.round((centre + margin) * PPM)),
    intervalVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION,
  };
};
const metrics = (labels: readonly ContextualRelationshipCalibrationLabel[]): ContextualCalibrationMetrics => {
  const confusion = {
    truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0,
    insufficientPredictedPositive: 0, insufficientPredictedNegative: 0,
  };
  for (const label of labels) {
    const predicted = Boolean(label.evaluation.edge);
    if (label.truthLabel === 'positive') predicted ? confusion.truePositive += 1 : confusion.falseNegative += 1;
    else if (label.truthLabel === 'negative') predicted ? confusion.falsePositive += 1 : confusion.trueNegative += 1;
    else predicted ? confusion.insufficientPredictedPositive += 1 : confusion.insufficientPredictedNegative += 1;
  }
  const positiveLabelCount = confusion.truePositive + confusion.falseNegative;
  const negativeLabelCount = confusion.trueNegative + confusion.falsePositive;
  const insufficientLabelCount = confusion.insufficientPredictedPositive + confusion.insufficientPredictedNegative;
  const adjudicatedCount = positiveLabelCount + negativeLabelCount;
  return {
    confusion,
    labelCount: labels.length,
    adjudicatedCount,
    positiveLabelCount,
    negativeLabelCount,
    insufficientLabelCount,
    precision: metric(confusion.truePositive, confusion.truePositive + confusion.falsePositive),
    recall: metric(confusion.truePositive, positiveLabelCount),
    falsePositiveRate: metric(confusion.falsePositive, negativeLabelCount),
    coverage: metric(adjudicatedCount, labels.length),
  };
};
const makeGate = (gate: Omit<ContextualCalibrationGateCheck, 'status'>) => {
  const passed = gate.operator === 'greater_than_or_equal' ? gate.actual >= gate.threshold
    : gate.operator === 'less_than_or_equal' ? gate.actual <= gate.threshold : gate.actual === gate.threshold;
  if (!passed) invalid(`contextual_calibration_gate_failed:${gate.gateId}`);
  return { ...gate, status: 'pass' as const };
};
const bound = (value: ContextualCalibrationMetric, field: 'valuePpm' | 'lowerPpm' | 'upperPpm', gate: string) => {
  if (value.status !== 'measured') invalid(`contextual_calibration_zero_denominator:${gate}`);
  return value[field];
};
const buildSlices = (
  labels: readonly ContextualRelationshipCalibrationLabel[],
  lineage: ContextualRelationshipCalibrationLineage,
) => {
  const definitions: Array<{ sliceId: string; select: (label: ContextualRelationshipCalibrationLabel) => boolean }> = [
    { sliceId: 'overall', select: () => true },
    { sliceId: 'hard_negative', select: (label) => label.hardNegativeCategory !== null },
    ...CONTEXTUAL_RELATIONSHIP_CALIBRATION_KINDS.map((kind) => ({
      sliceId: `kind:${kind}`, select: (label: ContextualRelationshipCalibrationLabel) => label.candidate.kind === kind,
    })),
    ...(['bounded_precise', 'coarse_or_missing'] as const).map((slice) => ({
      sliceId: `precision:${slice}`, select: (label: ContextualRelationshipCalibrationLabel) => label.precisionSlice === slice,
    })),
    ...(['complete_context', 'incomplete_context'] as const).map((slice) => ({
      sliceId: `coverage:${slice}`, select: (label: ContextualRelationshipCalibrationLabel) => label.coverageSlice === slice,
    })),
    ...lineage.sourceArchives.map((source) => ({
      sliceId: `source:${source.sourceSnapshotDigest}`,
      select: (label: ContextualRelationshipCalibrationLabel) => label.sourceSnapshotDigest === source.sourceSnapshotDigest,
    })),
  ];
  return definitions.map((definition) => ({
    sliceId: definition.sliceId,
    metrics: metrics(labels.filter(definition.select)),
  })).sort((left, right) => compare(left.sliceId, right.sliceId));
};
const slice = (slices: ContextualCalibrationSliceMetrics[], id: string) => slices.find((item) => item.sliceId === id)
  || invalid(`contextual_calibration_slice_missing:${id}`);
const buildGates = (
  labels: readonly ContextualRelationshipCalibrationLabel[],
  lineage: ContextualRelationshipCalibrationLineage,
  slices: ContextualCalibrationSliceMetrics[],
) => {
  const policy = CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY;
  const checks: ContextualCalibrationGateCheck[] = [];
  checks.push(makeGate({ gateId: 'minimum_label_count', actual: labels.length, operator: 'greater_than_or_equal', threshold: policy.minimumLabelCount }));
  const overall = slice(slices, 'overall').metrics;
  checks.push(makeGate({ gateId: 'overall_precision_lower', actual: bound(overall.precision, 'lowerPpm', 'overall_precision'), operator: 'greater_than_or_equal', threshold: policy.minimumPrecisionLowerPpm }));
  checks.push(makeGate({ gateId: 'overall_recall_lower', actual: bound(overall.recall, 'lowerPpm', 'overall_recall'), operator: 'greater_than_or_equal', threshold: policy.minimumRecallLowerPpm }));
  checks.push(makeGate({ gateId: 'overall_fpr_upper', actual: bound(overall.falsePositiveRate, 'upperPpm', 'overall_fpr'), operator: 'less_than_or_equal', threshold: policy.maximumFalsePositiveRateUpperPpm }));
  checks.push(makeGate({ gateId: 'overall_coverage', actual: bound(overall.coverage, 'valuePpm', 'overall_coverage'), operator: 'greater_than_or_equal', threshold: policy.minimumCoveragePpm }));
  checks.push(makeGate({ gateId: 'insufficient_predicted_positive', actual: overall.confusion.insufficientPredictedPositive, operator: 'equal', threshold: policy.maximumInsufficientPredictedPositives }));
  for (const kind of CONTEXTUAL_RELATIONSHIP_CALIBRATION_KINDS) {
    const result = slice(slices, `kind:${kind}`).metrics;
    checks.push(makeGate({ gateId: `positive_support:${kind}`, actual: result.positiveLabelCount, operator: 'greater_than_or_equal', threshold: policy.minimumPositiveLabelsPerKind }));
    checks.push(makeGate({ gateId: `negative_support:${kind}`, actual: result.negativeLabelCount, operator: 'greater_than_or_equal', threshold: policy.minimumNegativeLabelsPerKind }));
    checks.push(makeGate({ gateId: `precision_lower:${kind}`, actual: bound(result.precision, 'lowerPpm', `precision:${kind}`), operator: 'greater_than_or_equal', threshold: policy.minimumPrecisionLowerPpm }));
    checks.push(makeGate({ gateId: `recall_lower:${kind}`, actual: bound(result.recall, 'lowerPpm', `recall:${kind}`), operator: 'greater_than_or_equal', threshold: policy.minimumRecallLowerPpm }));
    checks.push(makeGate({ gateId: `fpr_upper:${kind}`, actual: bound(result.falsePositiveRate, 'upperPpm', `fpr:${kind}`), operator: 'less_than_or_equal', threshold: policy.maximumFalsePositiveRateUpperPpm }));
  }
  const hard = slice(slices, 'hard_negative').metrics;
  checks.push(makeGate({ gateId: 'hard_negative_support', actual: hard.labelCount, operator: 'greater_than_or_equal', threshold: policy.minimumHardNegativeLabels }));
  checks.push(makeGate({ gateId: 'hard_negative_false_positives', actual: hard.confusion.falsePositive, operator: 'equal', threshold: policy.maximumHardNegativeFalsePositives }));
  for (const category of CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES) checks.push(makeGate({
    gateId: `hard_negative_category:${category}`,
    actual: labels.filter((label) => label.hardNegativeCategory === category).length,
    operator: 'greater_than_or_equal', threshold: policy.minimumHardNegativeLabelsPerCategory,
  }));
  for (const precision of ['bounded_precise', 'coarse_or_missing'] as const) checks.push(makeGate({
    gateId: `precision_slice_support:${precision}`,
    actual: slice(slices, `precision:${precision}`).metrics.labelCount,
    operator: 'greater_than_or_equal', threshold: policy.minimumPrecisionSliceLabels,
  }));
  for (const source of lineage.sourceArchives) checks.push(makeGate({
    gateId: `source_slice_support:${source.sourceSnapshotDigest}`,
    actual: slice(slices, `source:${source.sourceSnapshotDigest}`).metrics.labelCount,
    operator: 'greater_than_or_equal', threshold: policy.minimumSourceSliceLabels,
  }));
  return checks.sort((left, right) => compare(left.gateId, right.gateId));
};

const decisionForTrust = (trust: ContextualRelationshipCalibrationTrustPolicy) => (
  trust.authorizationScope === 'production_candidate' ? 'production_gates_passed' as const : 'contract_gates_passed_test_only' as const
);
const coreWithoutHash = (artifact: Omit<ContextualRelationshipCalibrationArtifact, 'calibrationCoreSha256' | 'receipt' | 'artifactDigest'>) => artifact;
const receiptWithoutHash = (receipt: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'>) => receipt;
const artifactWithoutHash = (artifact: Omit<ContextualRelationshipCalibrationArtifact, 'artifactDigest'>) => artifact;
export const getContextualRelationshipCalibrationReceiptId = (calibrationCoreSha256: string) => {
  reqSha(calibrationCoreSha256, 'contextual_calibration_core_sha_invalid');
  return `contextual-calibration:${calibrationCoreSha256}` as const;
};
export const contextualRelationshipCalibrationReceiptSha256 = (
  receipt: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'>,
) => contextualExplanationSha256(receiptWithoutHash(receipt));

export const buildContextualRelationshipCalibrationArtifact = (params: {
  lineage: ContextualRelationshipCalibrationLineage;
  auditPlan: ContextualRelationshipCalibrationAuditPlan;
  trustPolicy: ContextualRelationshipCalibrationTrustPolicy;
  labels: readonly ContextualRelationshipCalibrationLabelDraft[];
}): ContextualRelationshipCalibrationArtifact => {
  const lineage = normalizeLineage(params.lineage);
  const auditPlan = normalizePlan(params.auditPlan);
  const trustPolicy = normalizeTrust(params.trustPolicy);
  if (trustPolicy.lineageDigest !== lineage.lineageDigest || trustPolicy.auditPlanDigest !== auditPlan.planDigest) {
    invalid('contextual_calibration_untrusted_lineage_or_plan');
  }
  const labels = params.labels.map((label) => buildLabel(label, lineage)).sort((left, right) => compare(left.sampleId, right.sampleId));
  if (new Set(labels.map((label) => label.sampleId)).size !== labels.length) invalid('contextual_calibration_duplicate_sample');
  const holdoutIds = auditPlan.lockedHoldout.map((item) => item.sampleId).sort(compare);
  if (canonicalizeContextualExplanation(labels.map((label) => label.sampleId)) !== canonicalizeContextualExplanation(holdoutIds)) {
    invalid('contextual_calibration_holdout_membership_mismatch');
  }
  if (contextualRelationshipCalibrationReviewSetSha256(labels.map((label) => label.review))
    !== trustPolicy.reviewReceiptSetSha256) invalid('contextual_calibration_untrusted_review_set');
  for (const label of labels) if (label.review.reviewerCohortId !== trustPolicy.reviewerCohortId
    || label.review.adjudicationPolicyVersion !== trustPolicy.adjudicationPolicyVersion
    || label.review.reviewerIds.length < trustPolicy.minimumIndependentReviewers) {
    invalid('contextual_calibration_review_policy_mismatch');
  }
  const derivedModels = [...new Map(labels.map((label) => {
    const model = modelIdentity(label.candidate);
    return [model.modelIdentitySha256, model] as const;
  })).values()].sort((left, right) => compare(left.modelIdentitySha256, right.modelIdentitySha256));
  if (canonicalizeContextualExplanation(derivedModels) !== canonicalizeContextualExplanation(lineage.models)) {
    invalid('contextual_calibration_model_set_mismatch');
  }
  const sliceMetrics = buildSlices(labels, lineage);
  const gateChecks = buildGates(labels, lineage, sliceMetrics);
  const evaluationSetSha256 = contextualExplanationSha256(labels.map((label) => ({
    sampleId: label.sampleId,
    evaluationDigest: contextualExplanationSha256(label.evaluation),
  })));
  const labelSetSha256 = contextualExplanationSha256(labels.map((label) => label.labelDigest));
  const metricsSha256 = contextualExplanationSha256({ sliceMetrics, gateChecks });
  const decision = decisionForTrust(trustPolicy);
  const core: Omit<ContextualRelationshipCalibrationArtifact, 'calibrationCoreSha256' | 'receipt' | 'artifactDigest'> = {
    recordType: 'contextual_relationship_calibration_artifact',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    decision,
    lineage,
    auditPlan,
    trustPolicy,
    gatePolicy: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY,
    labels,
    labelCount: labels.length,
    sliceMetrics,
    gateChecks,
    evaluationSetSha256,
    labelSetSha256,
  };
  const calibrationCoreSha256 = contextualExplanationSha256(coreWithoutHash(core));
  const withoutReceiptSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision,
    calibrationCoreSha256,
    lineageSha256: contextualRelationshipCalibrationLineageSha256(lineage),
    auditPlanSha256: contextualExplanationSha256(auditPlan),
    trustPolicyDigest: trustPolicy.trustPolicyDigest,
    evaluationSetSha256,
    labelSetSha256,
    metricsSha256,
    gatePolicyVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
    gatePolicySha256: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    evidenceClass: trustPolicy.evidenceClass,
    authorizationScope: trustPolicy.authorizationScope,
    calibratedEdgeType: 'contextual_explanation_candidate',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  const receipt = {
    ...withoutReceiptSha,
    receiptSha256: contextualRelationshipCalibrationReceiptSha256(withoutReceiptSha),
  };
  const withoutArtifactDigest = { ...core, calibrationCoreSha256, receipt };
  return { ...withoutArtifactDigest, artifactDigest: contextualExplanationSha256(artifactWithoutHash(withoutArtifactDigest)) };
};

export const decodeContextualRelationshipCalibrationReceipt = (
  input: unknown,
  expected?: { receiptId: string; receiptSha256: string },
): ContextualRelationshipCalibrationReceipt => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try { value = JSON.parse(String(input)); } catch { invalid('contextual_calibration_receipt_json_invalid'); }
  }
  const receipt = exact(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'receiptId', 'decision', 'calibrationCoreSha256',
    'lineageSha256', 'auditPlanSha256', 'trustPolicyDigest', 'evaluationSetSha256', 'labelSetSha256',
    'metricsSha256', 'gatePolicyVersion', 'gatePolicySha256', 'evidenceClass', 'authorizationScope',
    'calibratedEdgeType', 'claimDiscipline', 'receiptSha256',
  ], 'contextual_calibration_receipt_invalid');
  if (receipt.recordType !== 'contextual_relationship_calibration_receipt'
    || receipt.schemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION
    || receipt.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || !['contract_gates_passed_test_only', 'production_gates_passed'].includes(String(receipt.decision))
    || receipt.gatePolicyVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION
    || receipt.gatePolicySha256 !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256
    || receipt.calibratedEdgeType !== 'contextual_explanation_candidate'
    || canonicalizeContextualExplanation(receipt.claimDiscipline)
      !== canonicalizeContextualExplanation(CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE)) invalid('contextual_calibration_receipt_invalid');
  for (const field of [
    'calibrationCoreSha256', 'lineageSha256', 'auditPlanSha256', 'trustPolicyDigest',
    'evaluationSetSha256', 'labelSetSha256', 'metricsSha256', 'gatePolicySha256', 'receiptSha256',
  ] as const) reqSha(receipt[field], 'contextual_calibration_receipt_invalid');
  if ((receipt.decision === 'production_gates_passed'
    && (receipt.evidenceClass !== 'human_reviewed_locked_holdout' || receipt.authorizationScope !== 'production_candidate'))
    || (receipt.decision === 'contract_gates_passed_test_only'
      && (receipt.evidenceClass !== 'synthetic_contract_fixture' || receipt.authorizationScope !== 'test_only_never_publish'))) {
    invalid('contextual_calibration_receipt_authorization_invalid');
  }
  const coreSha = reqSha(receipt.calibrationCoreSha256, 'contextual_calibration_receipt_invalid');
  if (receipt.receiptId !== getContextualRelationshipCalibrationReceiptId(coreSha)) invalid('contextual_calibration_receipt_id_mismatch');
  const typed = receipt as unknown as ContextualRelationshipCalibrationReceipt;
  const { receiptSha256: _receiptSha, ...withoutSha } = typed;
  if (typed.receiptSha256 !== contextualRelationshipCalibrationReceiptSha256(withoutSha)) {
    invalid('contextual_calibration_receipt_digest_mismatch');
  }
  if (expected && (typed.receiptId !== expected.receiptId || typed.receiptSha256 !== expected.receiptSha256)) {
    invalid('contextual_calibration_receipt_expected_identity_mismatch');
  }
  return typed;
};
export const assertContextualRelationshipCalibrationReceiptProductionEligible = (input: unknown) => {
  const receipt = decodeContextualRelationshipCalibrationReceipt(input);
  if (receipt.decision !== 'production_gates_passed'
    || receipt.evidenceClass !== 'human_reviewed_locked_holdout'
    || receipt.authorizationScope !== 'production_candidate') invalid('contextual_calibration_receipt_not_production_eligible');
  return receipt;
};
export const serializeContextualRelationshipCalibrationReceipt = (
  receipt: ContextualRelationshipCalibrationReceipt,
) => `${canonicalizeContextualExplanation(decodeContextualRelationshipCalibrationReceipt(receipt))}\n`;

export const decodeContextualRelationshipCalibrationArtifact = (
  input: unknown,
  expectedBinding: RelationshipInputUniverseBinding,
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy,
) => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try { value = JSON.parse(String(input)); } catch { invalid('contextual_calibration_artifact_json_invalid'); }
  }
  const artifact = exact(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'decision', 'lineage', 'auditPlan', 'trustPolicy',
    'gatePolicy', 'labels', 'labelCount', 'sliceMetrics', 'gateChecks', 'evaluationSetSha256',
    'labelSetSha256', 'calibrationCoreSha256', 'receipt', 'artifactDigest',
  ], 'contextual_calibration_artifact_invalid');
  if (artifact.recordType !== 'contextual_relationship_calibration_artifact'
    || artifact.schemaVersion !== CONTEXTUAL_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION
    || artifact.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || !Array.isArray(artifact.labels)) invalid('contextual_calibration_artifact_invalid');
  const lineage = normalizeLineage(artifact.lineage);
  assertRelationshipInputBinding(lineage.binding, expectedBinding);
  const trustPolicy = normalizeTrust(artifact.trustPolicy);
  const expectedTrust = normalizeTrust(expectedTrustPolicy);
  if (canonicalizeContextualExplanation(trustPolicy) !== canonicalizeContextualExplanation(expectedTrust)) {
    invalid('contextual_calibration_trust_mismatch');
  }
  const labels = artifact.labels.map((raw): ContextualRelationshipCalibrationLabelDraft => {
    const label = exact(raw, [
      'recordType', 'schemaVersion', 'canonicalVersion', 'sampleId', 'candidate', 'evaluation',
      'sourceSnapshotDigest', 'observationArchiveRecordDigest', 'truthLabel', 'hardNegativeCategory',
      'review', 'precisionSlice', 'coverageSlice', 'labelDigest',
    ], 'contextual_calibration_label_invalid');
    return {
      candidate: label.candidate as ContextualExplanationCandidateDraft,
      evaluation: label.evaluation as ContextualExplanationEvaluation,
      sourceSnapshotDigest: label.sourceSnapshotDigest as string,
      observationArchiveRecordDigest: label.observationArchiveRecordDigest as string,
      truthLabel: label.truthLabel as TruthLabel,
      hardNegativeCategory: label.hardNegativeCategory as HardNegative | null,
      review: label.review as ContextualRelationshipCalibrationReviewReceipt,
    };
  });
  const rebuilt = buildContextualRelationshipCalibrationArtifact({
    lineage,
    auditPlan: artifact.auditPlan as ContextualRelationshipCalibrationAuditPlan,
    trustPolicy,
    labels,
  });
  if (canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_calibration_noncanonical');
  }
  return rebuilt;
};
export const serializeContextualRelationshipCalibrationArtifact = (
  artifact: ContextualRelationshipCalibrationArtifact,
  expectedTrustPolicy: ContextualRelationshipCalibrationTrustPolicy,
) => `${canonicalizeContextualExplanation(decodeContextualRelationshipCalibrationArtifact(
  artifact,
  artifact.lineage.binding,
  expectedTrustPolicy,
))}\n`;
