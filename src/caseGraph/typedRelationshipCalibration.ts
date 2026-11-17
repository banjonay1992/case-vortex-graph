import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  assertRelationshipInputBinding,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
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
  decodeTypedRelationshipPairEvaluation,
  type TypedRelationshipPairEvaluation,
} from './typedRelationshipEngine';

export const TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION = 'case-graph-typed-relationship-calibration-v1' as const;
export const TYPED_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION = TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
export const TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_VERSION = 'case-graph-typed-relationship-production-gates-v1' as const;
export const TYPED_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION = 'wilson-one-sided-95-v1' as const;
export const TYPED_RELATIONSHIP_CALIBRATION_PLAN_VERSION = 'case-graph-locked-holdout-plan-v1' as const;
export const TYPED_RELATIONSHIP_CALIBRATION_REVIEW_VERSION = 'case-graph-typed-relationship-review-v1' as const;
export const TYPED_RELATIONSHIP_CALIBRATION_TRUST_POLICY_VERSION = 'case-graph-typed-relationship-trust-policy-v1' as const;

export const TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES = [
  'common_characteristic',
  'coarse_space_time',
  'dependent_or_republished',
  'negated_missing_or_uncertain',
  'contextual_confounder',
] as const;

export const TYPED_RELATIONSHIP_CALIBRATION_SLICE_IDS = [
  'overall',
  'hard_negative',
  'dependency_independent',
  'dependency_dependent',
  'dependency_unknown',
] as const;

export const TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY = Object.freeze({
  minimumLabelCount: 1_000,
  minimumPositiveLabelsPerEdgeType: 200,
  minimumNegativeLabelsPerEdgeType: 200,
  minimumHardNegativeLabels: 200,
  minimumHardNegativeLabelsPerCategory: 40,
  minimumDependencySliceLabels: 200,
  minimumPrecisionLowerPpm: 980_000,
  minimumRecallLowerPpm: 900_000,
  maximumFalsePositiveRateUpperPpm: 20_000,
  minimumCoveragePpm: 980_000,
  maximumHardNegativeFalsePositives: 0,
  maximumInsufficientPredictedPositives: 0,
  confidenceIntervalVersion: TYPED_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION,
} as const);

export const TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256 = relationshipInputSha256(
  TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY,
);
export const TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256 = relationshipInputSha256(TYPED_RELATIONSHIP_EDGE_TYPES);
export const TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256 = relationshipInputSha256(
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
);
export const TYPED_RELATIONSHIP_CALIBRATION_SCOPE = Object.freeze({
  calibratedEdgeTypes: TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  calibratedEdgeTypeSetSha256: TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
  excludedEdgeTypes: [{
    edgeType: 'contextual_explanation_candidate',
    reason: 'requires_separate_contextual_evaluation_calibration',
  }],
} as const);

type PairEdgeType = typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number];
type CalibrationSliceId = typeof TYPED_RELATIONSHIP_CALIBRATION_SLICE_IDS[number];
type HardNegativeCategory = typeof TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES[number];

export type TypedRelationshipCalibrationLineage = {
  binding: RelationshipInputUniverseBinding;
  relationshipInput: {
    schemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
    archiveSetSha256: string;
    manifestDigest: string;
    recordSetSha256: string;
    recordCount: number;
  };
  rarity: {
    schemaVersion: typeof TYPED_RELATIONSHIP_RARITY_VERSION;
    indexDigest: string;
    recordSetSha256: string;
  };
  engine: {
    schemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
    policyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
    policySha256: string;
    thresholds: typeof TYPED_RELATIONSHIP_POLICY;
    model: typeof TYPED_RELATIONSHIP_MODEL;
    modelSha256: string;
    edgeTypeSetSha256: string;
  };
};

export type TypedRelationshipCalibrationPairMembership = {
  pairKey: string;
  sourceGroupId: string;
};

export type TypedRelationshipCalibrationAuditPlan = {
  recordType: 'typed_relationship_calibration_audit_plan';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  planVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_PLAN_VERSION;
  lockedHoldout: TypedRelationshipCalibrationPairMembership[];
  tuningSet: TypedRelationshipCalibrationPairMembership[];
  sampleMembership: Array<TypedRelationshipCalibrationPairMembership & {
    split: 'locked_holdout' | 'tuning';
  }>;
  labelPolicyVersion: string;
  groupingPolicyVersion: string;
  planDigest: string;
};

export type TypedRelationshipEdgeAdjudication = {
  edgeType: PairEdgeType;
  label: 'positive' | 'negative' | 'insufficient';
  rationaleCode: string;
};

export type TypedRelationshipCalibrationReviewReceipt = {
  recordType: 'typed_relationship_calibration_review_receipt';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_REVIEW_VERSION;
  pairKey: string;
  evaluationDigest: string;
  pairOutcome: 'positive' | 'negative' | 'insufficient';
  edgeAdjudications: TypedRelationshipEdgeAdjudication[];
  hardNegativeCategory: HardNegativeCategory | null;
  reviewerCohortId: string;
  adjudicationPolicyVersion: string;
  reviewerIds: string[];
  sourceArchiveKey: string;
  sourceArchiveVersion: string;
  sourceObjectSha256: string;
  reviewReceiptId: string;
  reviewReceiptSha256: string;
};

export type TypedRelationshipCalibrationTrustPolicy = {
  recordType: 'typed_relationship_calibration_trust_policy';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_TRUST_POLICY_VERSION;
  auditPlanDigest: string;
  reviewReceiptSetSha256: string;
  reviewerCohortId: string;
  adjudicationPolicyVersion: string;
  minimumIndependentReviewers: number;
  evidenceClass: 'synthetic_contract_fixture' | 'human_reviewed_locked_holdout';
  authorizationScope: 'test_only_never_publish' | 'production_candidate';
  trustPolicyDigest: string;
};

export type TypedRelationshipCalibrationLabelDraft = {
  evaluation: TypedRelationshipPairEvaluation;
  pairOutcome: 'positive' | 'negative' | 'insufficient';
  edgeAdjudications: TypedRelationshipEdgeAdjudication[];
  hardNegativeCategory: HardNegativeCategory | null;
  review: TypedRelationshipCalibrationReviewReceipt;
};

export type TypedRelationshipCalibrationLabel = TypedRelationshipCalibrationLabelDraft & {
  recordType: 'typed_relationship_calibration_label';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  pairKey: string;
  labelId: string;
  labelDigest: string;
};

export type TypedRelationshipCalibrationMetric =
  | {
    status: 'measured';
    numerator: number;
    denominator: number;
    valuePpm: number;
    lowerPpm: number;
    upperPpm: number;
    intervalVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION;
  }
  | {
    status: 'not_evaluable';
    numerator: number;
    denominator: 0;
    reason: 'zero_denominator';
  };

export type TypedRelationshipCalibrationConfusion = {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  insufficientPredictedPositive: number;
  insufficientPredictedNegative: number;
};

export type TypedRelationshipCalibrationMetrics = {
  confusion: TypedRelationshipCalibrationConfusion;
  labelCount: number;
  adjudicatedCount: number;
  positiveLabelCount: number;
  negativeLabelCount: number;
  insufficientLabelCount: number;
  predictedPositiveCount: number;
  precision: TypedRelationshipCalibrationMetric;
  recall: TypedRelationshipCalibrationMetric;
  falsePositiveRate: TypedRelationshipCalibrationMetric;
  coverage: TypedRelationshipCalibrationMetric;
};

export type TypedRelationshipCalibrationEdgeMetrics = {
  edgeType: PairEdgeType;
  slices: Array<{
    sliceId: CalibrationSliceId;
    metrics: TypedRelationshipCalibrationMetrics;
  }>;
};

export type TypedRelationshipCalibrationSliceSummary = {
  sliceId: CalibrationSliceId;
  pairLabelCount: number;
  metrics: TypedRelationshipCalibrationMetrics;
};

export type TypedRelationshipCalibrationGateCheck = {
  gateId: string;
  scope: 'global' | 'edge_type' | 'slice' | 'hard_negative_category';
  edgeType: PairEdgeType | null;
  sliceId: CalibrationSliceId | null;
  status: 'pass';
  actual: number;
  operator: 'greater_than_or_equal' | 'less_than_or_equal' | 'equal';
  threshold: number;
};

export type TypedRelationshipCalibrationReceipt = {
  recordType: 'typed_relationship_calibration_receipt';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  receiptId: string;
  decision: 'contract_gates_passed_test_only' | 'production_gates_passed';
  calibrationCoreSha256: string;
  lineageSha256: string;
  auditPlanSha256: string;
  evaluationSetSha256: string;
  labelSetSha256: string;
  metricsSha256: string;
  gatePolicyVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_VERSION;
  gatePolicySha256: string;
  calibratedEdgeTypeSetSha256: string;
  trustPolicyDigest: string;
  evidenceClass: TypedRelationshipCalibrationTrustPolicy['evidenceClass'];
  authorizationScope: TypedRelationshipCalibrationTrustPolicy['authorizationScope'];
  claimDiscipline: typeof TYPED_RELATIONSHIP_CLAIM_DISCIPLINE;
  receiptSha256: string;
};

export type TypedRelationshipCalibrationArtifact = {
  recordType: 'typed_relationship_calibration_artifact';
  schemaVersion: typeof TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  decision: 'contract_gates_passed_test_only' | 'production_gates_passed';
  calibrationScope: typeof TYPED_RELATIONSHIP_CALIBRATION_SCOPE;
  trustPolicy: TypedRelationshipCalibrationTrustPolicy;
  lineage: TypedRelationshipCalibrationLineage;
  auditPlan: TypedRelationshipCalibrationAuditPlan;
  gatePolicy: typeof TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY;
  labelCount: number;
  evaluationSetSha256: string;
  labelSetSha256: string;
  labels: TypedRelationshipCalibrationLabel[];
  edgeMetrics: TypedRelationshipCalibrationEdgeMetrics[];
  sliceSummaries: TypedRelationshipCalibrationSliceSummary[];
  gateChecks: TypedRelationshipCalibrationGateCheck[];
  calibrationCoreSha256: string;
  receipt: TypedRelationshipCalibrationReceipt;
  artifactDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const PAIR_KEY = /^pair:[a-f0-9]{64}$/;
const ONE_SIDED_95_Z = 1.6448536269514722;
const PPM = 1_000_000;
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const requireSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value;
};

const requireStableId = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) invalid(code);
  return value;
};

const requireSafeCount = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

const exactKeys = (value: unknown, keys: readonly string[], code: string) => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};

const normalizeLineage = (value: unknown): TypedRelationshipCalibrationLineage => {
  const lineage = exactKeys(value, ['binding', 'relationshipInput', 'rarity', 'engine'], 'typed_relationship_calibration_lineage_invalid');
  const binding = validateRelationshipInputBinding(lineage.binding);
  const relationshipInput = exactKeys(lineage.relationshipInput, [
    'schemaVersion', 'archiveSetSha256', 'manifestDigest', 'recordSetSha256', 'recordCount',
  ], 'typed_relationship_calibration_relationship_input_invalid');
  if (relationshipInput.schemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION) {
    invalid('typed_relationship_calibration_relationship_input_invalid');
  }
  const recordCount = requireSafeCount(
    relationshipInput.recordCount,
    'typed_relationship_calibration_relationship_input_invalid',
  );
  if (recordCount !== binding.universeRecordCount) invalid('typed_relationship_calibration_record_count_mismatch');
  const normalizedRelationshipInput = {
    schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    archiveSetSha256: requireSha(relationshipInput.archiveSetSha256, 'typed_relationship_calibration_relationship_input_invalid'),
    manifestDigest: requireSha(relationshipInput.manifestDigest, 'typed_relationship_calibration_relationship_input_invalid'),
    recordSetSha256: requireSha(relationshipInput.recordSetSha256, 'typed_relationship_calibration_relationship_input_invalid'),
    recordCount,
  };
  const rarity = exactKeys(lineage.rarity, [
    'schemaVersion', 'indexDigest', 'recordSetSha256',
  ], 'typed_relationship_calibration_rarity_invalid');
  if (rarity.schemaVersion !== TYPED_RELATIONSHIP_RARITY_VERSION) invalid('typed_relationship_calibration_rarity_invalid');
  const normalizedRarity = {
    schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
    indexDigest: requireSha(rarity.indexDigest, 'typed_relationship_calibration_rarity_invalid'),
    recordSetSha256: requireSha(rarity.recordSetSha256, 'typed_relationship_calibration_rarity_invalid'),
  };
  if (normalizedRarity.recordSetSha256 !== normalizedRelationshipInput.recordSetSha256) {
    invalid('typed_relationship_calibration_rarity_record_set_mismatch');
  }
  const engine = exactKeys(lineage.engine, [
    'schemaVersion', 'policyVersion', 'policySha256', 'thresholds', 'model', 'modelSha256', 'edgeTypeSetSha256',
  ], 'typed_relationship_calibration_engine_invalid');
  if (engine.schemaVersion !== TYPED_RELATIONSHIP_SCHEMA_VERSION
    || engine.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION
    || engine.policySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256
    || engine.modelSha256 !== TYPED_RELATIONSHIP_MODEL_SHA256
    || engine.edgeTypeSetSha256 !== TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256
    || canonicalizeRelationshipInput(engine.thresholds) !== canonicalizeRelationshipInput(TYPED_RELATIONSHIP_POLICY)
    || canonicalizeRelationshipInput(engine.model) !== canonicalizeRelationshipInput(TYPED_RELATIONSHIP_MODEL)
  ) invalid('typed_relationship_calibration_engine_invalid');
  return {
    binding,
    relationshipInput: normalizedRelationshipInput,
    rarity: normalizedRarity,
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
};

export const decodeTypedRelationshipCalibrationLineage = (
  input: unknown,
) => normalizeLineage(input);

export const typedRelationshipCalibrationLineageSha256 = (
  lineage: TypedRelationshipCalibrationLineage,
) => relationshipInputSha256(normalizeLineage(lineage));

const normalizePairMembership = (
  value: unknown,
  code: string,
): TypedRelationshipCalibrationPairMembership => {
  const item = exactKeys(value, ['pairKey', 'sourceGroupId'], code);
  if (typeof item.pairKey !== 'string' || !PAIR_KEY.test(item.pairKey)) invalid(code);
  return {
    pairKey: item.pairKey,
    sourceGroupId: requireStableId(item.sourceGroupId, code),
  };
};

const sortPairMembership = <T extends TypedRelationshipCalibrationPairMembership>(values: T[]) => values.sort(
  (left, right) => compareText(left.pairKey, right.pairKey) || compareText(left.sourceGroupId, right.sourceGroupId),
);

const auditPlanWithoutDigest = (
  plan: Omit<TypedRelationshipCalibrationAuditPlan, 'planDigest'>,
) => plan;

const normalizeAuditPlan = (value: unknown): TypedRelationshipCalibrationAuditPlan => {
  const plan = exactKeys(value, [
    'recordType', 'schemaVersion', 'planVersion', 'lockedHoldout', 'tuningSet', 'sampleMembership',
    'labelPolicyVersion', 'groupingPolicyVersion', 'planDigest',
  ], 'typed_relationship_calibration_audit_plan_invalid');
  if (plan.recordType !== 'typed_relationship_calibration_audit_plan'
    || plan.schemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION
    || plan.planVersion !== TYPED_RELATIONSHIP_CALIBRATION_PLAN_VERSION
    || !Array.isArray(plan.lockedHoldout)
    || !Array.isArray(plan.tuningSet)
    || !Array.isArray(plan.sampleMembership)
    || plan.lockedHoldout.length === 0
    || plan.tuningSet.length === 0) {
    invalid('typed_relationship_calibration_audit_plan_invalid');
  }
  const lockedHoldout = sortPairMembership(plan.lockedHoldout.map((item) => normalizePairMembership(
    item,
    'typed_relationship_calibration_holdout_membership_invalid',
  )));
  const tuningSet = sortPairMembership(plan.tuningSet.map((item) => normalizePairMembership(
    item,
    'typed_relationship_calibration_tuning_membership_invalid',
  )));
  const lockedKeys = new Set(lockedHoldout.map((item) => item.pairKey));
  const tuningKeys = new Set(tuningSet.map((item) => item.pairKey));
  if (lockedKeys.size !== lockedHoldout.length || tuningKeys.size !== tuningSet.length
    || [...lockedKeys].some((pairKey) => tuningKeys.has(pairKey))) {
    invalid('typed_relationship_calibration_split_overlap_or_duplicate');
  }
  const lockedGroups = new Set(lockedHoldout.map((item) => item.sourceGroupId));
  if (tuningSet.some((item) => lockedGroups.has(item.sourceGroupId))) {
    invalid('typed_relationship_calibration_group_leakage');
  }
  const sampleMembership = plan.sampleMembership.map((raw) => {
    const item = exactKeys(raw, ['pairKey', 'sourceGroupId', 'split'], 'typed_relationship_calibration_sample_membership_invalid');
    if (!['locked_holdout', 'tuning'].includes(String(item.split))) {
      invalid('typed_relationship_calibration_sample_membership_invalid');
    }
    return {
      ...normalizePairMembership(
        { pairKey: item.pairKey, sourceGroupId: item.sourceGroupId },
        'typed_relationship_calibration_sample_membership_invalid',
      ),
      split: item.split as 'locked_holdout' | 'tuning',
    };
  }).sort((left, right) => compareText(left.pairKey, right.pairKey));
  const expectedMembership = [
    ...lockedHoldout.map((item) => ({ ...item, split: 'locked_holdout' as const })),
    ...tuningSet.map((item) => ({ ...item, split: 'tuning' as const })),
  ].sort((left, right) => compareText(left.pairKey, right.pairKey));
  if (canonicalizeRelationshipInput(sampleMembership) !== canonicalizeRelationshipInput(expectedMembership)) {
    invalid('typed_relationship_calibration_sample_membership_mismatch');
  }
  const withoutDigest: Omit<TypedRelationshipCalibrationAuditPlan, 'planDigest'> = {
    recordType: 'typed_relationship_calibration_audit_plan',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    planVersion: TYPED_RELATIONSHIP_CALIBRATION_PLAN_VERSION,
    lockedHoldout,
    tuningSet,
    sampleMembership,
    labelPolicyVersion: requireStableId(plan.labelPolicyVersion, 'typed_relationship_calibration_audit_plan_invalid'),
    groupingPolicyVersion: requireStableId(plan.groupingPolicyVersion, 'typed_relationship_calibration_audit_plan_invalid'),
  };
  const planDigest = requireSha(plan.planDigest, 'typed_relationship_calibration_audit_plan_invalid');
  if (planDigest !== relationshipInputSha256(auditPlanWithoutDigest(withoutDigest))) {
    invalid('typed_relationship_calibration_audit_plan_digest_mismatch');
  }
  return { ...withoutDigest, planDigest };
};

export const buildTypedRelationshipCalibrationAuditPlan = (params: {
  lockedHoldout: TypedRelationshipCalibrationPairMembership[];
  tuningSet: TypedRelationshipCalibrationPairMembership[];
  labelPolicyVersion: string;
  groupingPolicyVersion: string;
}): TypedRelationshipCalibrationAuditPlan => {
  const lockedHoldout = sortPairMembership(params.lockedHoldout.map((item) => ({ ...item })));
  const tuningSet = sortPairMembership(params.tuningSet.map((item) => ({ ...item })));
  const withoutDigest: Omit<TypedRelationshipCalibrationAuditPlan, 'planDigest'> = {
    recordType: 'typed_relationship_calibration_audit_plan',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    planVersion: TYPED_RELATIONSHIP_CALIBRATION_PLAN_VERSION,
    lockedHoldout,
    tuningSet,
    sampleMembership: [
      ...lockedHoldout.map((item) => ({ ...item, split: 'locked_holdout' as const })),
      ...tuningSet.map((item) => ({ ...item, split: 'tuning' as const })),
    ].sort((left, right) => compareText(left.pairKey, right.pairKey)),
    labelPolicyVersion: params.labelPolicyVersion,
    groupingPolicyVersion: params.groupingPolicyVersion,
  };
  return normalizeAuditPlan({
    ...withoutDigest,
    planDigest: relationshipInputSha256(auditPlanWithoutDigest(withoutDigest)),
  });
};

export const decodeTypedRelationshipCalibrationAuditPlan = (
  input: unknown,
) => normalizeAuditPlan(input);

const reviewCore = (review: Omit<
TypedRelationshipCalibrationReviewReceipt,
'reviewReceiptId' | 'reviewReceiptSha256'
>) => review;
const reviewWithoutSha = (review: Omit<
TypedRelationshipCalibrationReviewReceipt,
'reviewReceiptSha256'
>) => review;

const normalizeReview = (value: unknown): TypedRelationshipCalibrationReviewReceipt => {
  const review = exactKeys(value, [
    'recordType', 'schemaVersion', 'pairKey', 'evaluationDigest', 'pairOutcome', 'edgeAdjudications',
    'hardNegativeCategory', 'reviewerCohortId', 'adjudicationPolicyVersion', 'reviewerIds',
    'sourceArchiveKey', 'sourceArchiveVersion', 'sourceObjectSha256', 'reviewReceiptId', 'reviewReceiptSha256',
  ], 'typed_relationship_calibration_review_invalid');
  if (review.recordType !== 'typed_relationship_calibration_review_receipt'
    || review.schemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_REVIEW_VERSION
    || typeof review.pairKey !== 'string'
    || !PAIR_KEY.test(review.pairKey)
    || !['positive', 'negative', 'insufficient'].includes(String(review.pairOutcome))
    || !Array.isArray(review.reviewerIds)
    || review.reviewerIds.length < 2) {
    invalid('typed_relationship_calibration_review_invalid');
  }
  const reviewerIds = review.reviewerIds.map((reviewerId) => requireStableId(
    reviewerId,
    'typed_relationship_calibration_review_invalid',
  )).sort(compareText);
  if (new Set(reviewerIds).size !== reviewerIds.length) invalid('typed_relationship_calibration_review_duplicate_reviewer');
  const hardNegativeCategory = review.hardNegativeCategory === null
    ? null
    : TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES.includes(review.hardNegativeCategory as HardNegativeCategory)
      ? review.hardNegativeCategory as HardNegativeCategory
      : invalid('typed_relationship_calibration_review_invalid');
  const withoutIds: Omit<TypedRelationshipCalibrationReviewReceipt, 'reviewReceiptId' | 'reviewReceiptSha256'> = {
    recordType: 'typed_relationship_calibration_review_receipt',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_REVIEW_VERSION,
    pairKey: review.pairKey,
    evaluationDigest: requireSha(review.evaluationDigest, 'typed_relationship_calibration_review_invalid'),
    pairOutcome: review.pairOutcome as TypedRelationshipCalibrationReviewReceipt['pairOutcome'],
    edgeAdjudications: normalizeAdjudications(review.edgeAdjudications),
    hardNegativeCategory,
    reviewerCohortId: requireStableId(review.reviewerCohortId, 'typed_relationship_calibration_review_invalid'),
    adjudicationPolicyVersion: requireStableId(review.adjudicationPolicyVersion, 'typed_relationship_calibration_review_invalid'),
    reviewerIds,
    sourceArchiveKey: requireStableId(review.sourceArchiveKey, 'typed_relationship_calibration_review_invalid'),
    sourceArchiveVersion: requireStableId(review.sourceArchiveVersion, 'typed_relationship_calibration_review_invalid'),
    sourceObjectSha256: requireSha(review.sourceObjectSha256, 'typed_relationship_calibration_review_invalid'),
  };
  const reviewReceiptId = `typed-calibration-review:${relationshipInputSha256(reviewCore(withoutIds))}`;
  if (review.reviewReceiptId !== reviewReceiptId) invalid('typed_relationship_calibration_review_id_mismatch');
  const withoutSha: Omit<TypedRelationshipCalibrationReviewReceipt, 'reviewReceiptSha256'> = {
    ...withoutIds,
    reviewReceiptId,
  };
  const reviewReceiptSha256 = relationshipInputSha256(reviewWithoutSha(withoutSha));
  if (review.reviewReceiptSha256 !== reviewReceiptSha256) invalid('typed_relationship_calibration_review_digest_mismatch');
  return { ...withoutSha, reviewReceiptSha256 };
};

export const buildTypedRelationshipCalibrationReviewReceipt = (params: Omit<
TypedRelationshipCalibrationReviewReceipt,
'recordType' | 'schemaVersion' | 'reviewReceiptId' | 'reviewReceiptSha256'
>): TypedRelationshipCalibrationReviewReceipt => {
  const withoutIds: Omit<TypedRelationshipCalibrationReviewReceipt, 'reviewReceiptId' | 'reviewReceiptSha256'> = {
    recordType: 'typed_relationship_calibration_review_receipt',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_REVIEW_VERSION,
    ...params,
  };
  const reviewReceiptId = `typed-calibration-review:${relationshipInputSha256(reviewCore(withoutIds))}`;
  const withoutSha = { ...withoutIds, reviewReceiptId };
  return normalizeReview({
    ...withoutSha,
    reviewReceiptSha256: relationshipInputSha256(reviewWithoutSha(withoutSha)),
  });
};

export const decodeTypedRelationshipCalibrationReviewReceipt = (
  input: unknown,
) => normalizeReview(input);

export const typedRelationshipCalibrationReviewSetSha256 = (
  reviews: readonly TypedRelationshipCalibrationReviewReceipt[],
) => relationshipInputSha256(reviews.map((review) => normalizeReview(review))
  .sort((left, right) => compareText(left.pairKey, right.pairKey))
  .map((review) => ({ pairKey: review.pairKey, reviewReceiptSha256: review.reviewReceiptSha256 })));

const trustPolicyWithoutDigest = (
  policy: Omit<TypedRelationshipCalibrationTrustPolicy, 'trustPolicyDigest'>,
) => policy;

const normalizeTrustPolicy = (value: unknown): TypedRelationshipCalibrationTrustPolicy => {
  const policy = exactKeys(value, [
    'recordType', 'schemaVersion', 'auditPlanDigest', 'reviewReceiptSetSha256', 'reviewerCohortId',
    'adjudicationPolicyVersion', 'minimumIndependentReviewers', 'evidenceClass',
    'authorizationScope', 'trustPolicyDigest',
  ], 'typed_relationship_calibration_trust_policy_invalid');
  if (policy.recordType !== 'typed_relationship_calibration_trust_policy'
    || policy.schemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_TRUST_POLICY_VERSION) {
    invalid('typed_relationship_calibration_trust_policy_invalid');
  }
  const withoutDigest: Omit<TypedRelationshipCalibrationTrustPolicy, 'trustPolicyDigest'> = {
    recordType: 'typed_relationship_calibration_trust_policy',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_TRUST_POLICY_VERSION,
    auditPlanDigest: requireSha(policy.auditPlanDigest, 'typed_relationship_calibration_trust_policy_invalid'),
    reviewReceiptSetSha256: requireSha(policy.reviewReceiptSetSha256, 'typed_relationship_calibration_trust_policy_invalid'),
    reviewerCohortId: requireStableId(policy.reviewerCohortId, 'typed_relationship_calibration_trust_policy_invalid'),
    adjudicationPolicyVersion: requireStableId(policy.adjudicationPolicyVersion, 'typed_relationship_calibration_trust_policy_invalid'),
    minimumIndependentReviewers: requireSafeCount(
      policy.minimumIndependentReviewers,
      'typed_relationship_calibration_trust_policy_invalid',
      2,
    ),
    evidenceClass: policy.evidenceClass as TypedRelationshipCalibrationTrustPolicy['evidenceClass'],
    authorizationScope: policy.authorizationScope as TypedRelationshipCalibrationTrustPolicy['authorizationScope'],
  };
  if (!['synthetic_contract_fixture', 'human_reviewed_locked_holdout'].includes(withoutDigest.evidenceClass)
    || !['test_only_never_publish', 'production_candidate'].includes(withoutDigest.authorizationScope)
    || (withoutDigest.authorizationScope === 'production_candidate'
      && withoutDigest.evidenceClass !== 'human_reviewed_locked_holdout')) {
    invalid('typed_relationship_calibration_trust_authorization_invalid');
  }
  const trustPolicyDigest = requireSha(policy.trustPolicyDigest, 'typed_relationship_calibration_trust_policy_invalid');
  if (trustPolicyDigest !== relationshipInputSha256(trustPolicyWithoutDigest(withoutDigest))) {
    invalid('typed_relationship_calibration_trust_policy_digest_mismatch');
  }
  return { ...withoutDigest, trustPolicyDigest };
};

export const buildTypedRelationshipCalibrationTrustPolicy = (params: Omit<
TypedRelationshipCalibrationTrustPolicy,
'recordType' | 'schemaVersion' | 'trustPolicyDigest'
>): TypedRelationshipCalibrationTrustPolicy => {
  const withoutDigest: Omit<TypedRelationshipCalibrationTrustPolicy, 'trustPolicyDigest'> = {
    recordType: 'typed_relationship_calibration_trust_policy',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_TRUST_POLICY_VERSION,
    ...params,
  };
  return normalizeTrustPolicy({
    ...withoutDigest,
    trustPolicyDigest: relationshipInputSha256(trustPolicyWithoutDigest(withoutDigest)),
  });
};

export const decodeTypedRelationshipCalibrationTrustPolicy = (
  input: unknown,
) => normalizeTrustPolicy(input);

const normalizeAdjudications = (value: unknown): TypedRelationshipEdgeAdjudication[] => {
  if (!Array.isArray(value)) invalid('typed_relationship_calibration_adjudications_invalid');
  const adjudications = value.map((raw) => {
    const item = exactKeys(raw, ['edgeType', 'label', 'rationaleCode'], 'typed_relationship_calibration_adjudication_invalid');
    if (!TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.includes(item.edgeType as PairEdgeType)
      || !['positive', 'negative', 'insufficient'].includes(String(item.label))) {
      invalid('typed_relationship_calibration_adjudication_invalid');
    }
    return {
      edgeType: item.edgeType as PairEdgeType,
      label: item.label as TypedRelationshipEdgeAdjudication['label'],
      rationaleCode: requireStableId(item.rationaleCode, 'typed_relationship_calibration_adjudication_invalid'),
    };
  }).sort((left, right) => TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.indexOf(left.edgeType)
    - TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.indexOf(right.edgeType));
  if (adjudications.length !== TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.length
    || new Set(adjudications.map((item) => item.edgeType)).size !== adjudications.length
    || adjudications.some((item, index) => item.edgeType !== TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[index])) {
    invalid('typed_relationship_calibration_adjudication_set_invalid');
  }
  return adjudications;
};

const labelWithoutDigest = (label: Omit<TypedRelationshipCalibrationLabel, 'labelDigest'>) => label;

const buildLabel = (
  draft: TypedRelationshipCalibrationLabelDraft,
  lineage: TypedRelationshipCalibrationLineage,
): TypedRelationshipCalibrationLabel => {
  if (!isPlainObject(draft)) invalid('typed_relationship_calibration_label_invalid');
  const evaluation = decodeTypedRelationshipPairEvaluation(draft.evaluation, lineage.binding);
  if (evaluation.rarityIndexDigest !== lineage.rarity.indexDigest
    || evaluation.policyVersion !== lineage.engine.policyVersion
    || evaluation.policySha256 !== lineage.engine.policySha256
    || canonicalizeRelationshipInput(evaluation.model) !== canonicalizeRelationshipInput(lineage.engine.model)) {
    invalid('typed_relationship_calibration_evaluation_identity_mismatch');
  }
  const edgeAdjudications = normalizeAdjudications(draft.edgeAdjudications);
  if (!['positive', 'negative', 'insufficient'].includes(String(draft.pairOutcome))) {
    invalid('typed_relationship_calibration_pair_outcome_invalid');
  }
  const positiveCount = edgeAdjudications.filter((item) => item.label === 'positive').length;
  const insufficientCount = edgeAdjudications.filter((item) => item.label === 'insufficient').length;
  if ((draft.pairOutcome === 'positive' && positiveCount === 0)
    || (draft.pairOutcome === 'negative' && (positiveCount !== 0 || insufficientCount !== 0))
    || (draft.pairOutcome === 'insufficient' && (positiveCount !== 0 || insufficientCount === 0))) {
    invalid('typed_relationship_calibration_pair_outcome_mismatch');
  }
  if (draft.hardNegativeCategory !== null
    && (!TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES.includes(draft.hardNegativeCategory)
      || draft.pairOutcome !== 'negative')) {
    invalid('typed_relationship_calibration_hard_negative_invalid');
  }
  const pairKey = `pair:${relationshipInputSha256(evaluation.addresses)}`;
  const review = normalizeReview(draft.review);
  if (review.pairKey !== pairKey
    || review.evaluationDigest !== evaluation.evaluationDigest
    || review.pairOutcome !== draft.pairOutcome
    || review.hardNegativeCategory !== draft.hardNegativeCategory
    || canonicalizeRelationshipInput(review.edgeAdjudications) !== canonicalizeRelationshipInput(edgeAdjudications)) {
    invalid('typed_relationship_calibration_review_label_mismatch');
  }
  const labelIdentity = {
    pairKey,
    evaluationDigest: evaluation.evaluationDigest,
    pairOutcome: draft.pairOutcome,
    edgeAdjudications,
    hardNegativeCategory: draft.hardNegativeCategory,
    review,
  };
  const labelId = `calibration-label:${relationshipInputSha256(labelIdentity)}`;
  const withoutDigest: Omit<TypedRelationshipCalibrationLabel, 'labelDigest'> = {
    recordType: 'typed_relationship_calibration_label',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    pairKey,
    labelId,
    evaluation,
    pairOutcome: draft.pairOutcome,
    edgeAdjudications,
    hardNegativeCategory: draft.hardNegativeCategory,
    review,
  };
  return { ...withoutDigest, labelDigest: relationshipInputSha256(labelWithoutDigest(withoutDigest)) };
};

const wilsonMetric = (numerator: number, denominator: number): TypedRelationshipCalibrationMetric => {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
    || numerator < 0 || denominator < 0 || numerator > denominator) {
    invalid('typed_relationship_calibration_metric_counts_invalid');
  }
  if (denominator === 0) return {
    status: 'not_evaluable',
    numerator,
    denominator: 0,
    reason: 'zero_denominator',
  };
  const proportion = numerator / denominator;
  const zSquared = ONE_SIDED_95_Z ** 2;
  const scale = 1 + zSquared / denominator;
  const centre = (proportion + zSquared / (2 * denominator)) / scale;
  const margin = (ONE_SIDED_95_Z * Math.sqrt(
    (proportion * (1 - proportion) + zSquared / (4 * denominator)) / denominator,
  )) / scale;
  return {
    status: 'measured',
    numerator,
    denominator,
    valuePpm: Math.round(proportion * PPM),
    lowerPpm: Math.max(0, Math.round((centre - margin) * PPM)),
    upperPpm: Math.min(PPM, Math.round((centre + margin) * PPM)),
    intervalVersion: TYPED_RELATIONSHIP_CALIBRATION_INTERVAL_VERSION,
  };
};

const metricsFromDecisions = (decisions: Array<{
  predicted: boolean;
  label: TypedRelationshipEdgeAdjudication['label'];
}>): TypedRelationshipCalibrationMetrics => {
  const confusion: TypedRelationshipCalibrationConfusion = {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    insufficientPredictedPositive: 0,
    insufficientPredictedNegative: 0,
  };
  for (const decision of decisions) {
    if (decision.label === 'positive') {
      if (decision.predicted) confusion.truePositive += 1;
      else confusion.falseNegative += 1;
    } else if (decision.label === 'negative') {
      if (decision.predicted) confusion.falsePositive += 1;
      else confusion.trueNegative += 1;
    } else if (decision.predicted) confusion.insufficientPredictedPositive += 1;
    else confusion.insufficientPredictedNegative += 1;
  }
  const positiveLabelCount = confusion.truePositive + confusion.falseNegative;
  const negativeLabelCount = confusion.trueNegative + confusion.falsePositive;
  const insufficientLabelCount = confusion.insufficientPredictedPositive + confusion.insufficientPredictedNegative;
  const adjudicatedCount = positiveLabelCount + negativeLabelCount;
  return {
    confusion,
    labelCount: decisions.length,
    adjudicatedCount,
    positiveLabelCount,
    negativeLabelCount,
    insufficientLabelCount,
    predictedPositiveCount: confusion.truePositive + confusion.falsePositive + confusion.insufficientPredictedPositive,
    precision: wilsonMetric(confusion.truePositive, confusion.truePositive + confusion.falsePositive),
    recall: wilsonMetric(confusion.truePositive, positiveLabelCount),
    falsePositiveRate: wilsonMetric(confusion.falsePositive, negativeLabelCount),
    coverage: wilsonMetric(adjudicatedCount, decisions.length),
  };
};

const sliceMatches = (label: TypedRelationshipCalibrationLabel, sliceId: CalibrationSliceId) => {
  if (sliceId === 'overall') return true;
  if (sliceId === 'hard_negative') return label.hardNegativeCategory !== null;
  return label.evaluation.dependency.classification === sliceId.replace('dependency_', '');
};

const buildEdgeMetrics = (labels: readonly TypedRelationshipCalibrationLabel[]) => (
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.map((edgeType): TypedRelationshipCalibrationEdgeMetrics => ({
    edgeType,
    slices: TYPED_RELATIONSHIP_CALIBRATION_SLICE_IDS.map((sliceId) => {
      const sliceLabels = labels.filter((label) => sliceMatches(label, sliceId));
      return {
        sliceId,
        metrics: metricsFromDecisions(sliceLabels.map((label) => ({
          predicted: label.evaluation.edges.some((edge) => edge.edgeType === edgeType),
          label: label.edgeAdjudications.find((item) => item.edgeType === edgeType)?.label
            || invalid('typed_relationship_calibration_adjudication_set_invalid'),
        }))),
      };
    }),
  }))
);

const buildSliceSummaries = (labels: readonly TypedRelationshipCalibrationLabel[]) => (
  TYPED_RELATIONSHIP_CALIBRATION_SLICE_IDS.map((sliceId): TypedRelationshipCalibrationSliceSummary => {
    const sliceLabels = labels.filter((label) => sliceMatches(label, sliceId));
    const decisions = sliceLabels.flatMap((label) => label.edgeAdjudications.map((adjudication) => ({
      predicted: label.evaluation.edges.some((edge) => edge.edgeType === adjudication.edgeType),
      label: adjudication.label,
    })));
    return { sliceId, pairLabelCount: sliceLabels.length, metrics: metricsFromDecisions(decisions) };
  })
);

const gatePasses = (actual: number, operator: TypedRelationshipCalibrationGateCheck['operator'], threshold: number) => {
  if (operator === 'greater_than_or_equal') return actual >= threshold;
  if (operator === 'less_than_or_equal') return actual <= threshold;
  return actual === threshold;
};

const makeGate = (params: Omit<TypedRelationshipCalibrationGateCheck, 'status'>) => {
  if (!Number.isSafeInteger(params.actual) || !Number.isSafeInteger(params.threshold)) {
    invalid('typed_relationship_calibration_gate_value_invalid');
  }
  if (!gatePasses(params.actual, params.operator, params.threshold)) {
    invalid(`typed_relationship_calibration_gate_failed:${params.gateId}`);
  }
  return { ...params, status: 'pass' as const };
};

const measuredBound = (
  metric: TypedRelationshipCalibrationMetric,
  field: 'valuePpm' | 'lowerPpm' | 'upperPpm',
  gateId: string,
) => {
  if (metric.status !== 'measured') invalid(`typed_relationship_calibration_zero_denominator:${gateId}`);
  return metric[field];
};

const buildGateChecks = (
  labels: readonly TypedRelationshipCalibrationLabel[],
  edgeMetrics: readonly TypedRelationshipCalibrationEdgeMetrics[],
  sliceSummaries: readonly TypedRelationshipCalibrationSliceSummary[],
) => {
  const policy = TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY;
  const checks: TypedRelationshipCalibrationGateCheck[] = [];
  checks.push(makeGate({
    gateId: 'minimum_label_count', scope: 'global', edgeType: null, sliceId: 'overall',
    actual: labels.length, operator: 'greater_than_or_equal', threshold: policy.minimumLabelCount,
  }));
  const hardNegativeCount = labels.filter((label) => label.hardNegativeCategory !== null).length;
  checks.push(makeGate({
    gateId: 'minimum_hard_negative_labels', scope: 'slice', edgeType: null, sliceId: 'hard_negative',
    actual: hardNegativeCount, operator: 'greater_than_or_equal', threshold: policy.minimumHardNegativeLabels,
  }));
  for (const category of TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES) checks.push(makeGate({
    gateId: `hard_negative_category:${category}`,
    scope: 'hard_negative_category', edgeType: null, sliceId: 'hard_negative',
    actual: labels.filter((label) => label.hardNegativeCategory === category).length,
    operator: 'greater_than_or_equal', threshold: policy.minimumHardNegativeLabelsPerCategory,
  }));

  for (const sliceId of ['dependency_independent', 'dependency_dependent', 'dependency_unknown'] as const) {
    const summary = sliceSummaries.find((item) => item.sliceId === sliceId)
      || invalid(`typed_relationship_calibration_mandatory_slice_missing:${sliceId}`);
    checks.push(makeGate({
      gateId: `minimum_slice_labels:${sliceId}`, scope: 'slice', edgeType: null, sliceId,
      actual: summary.pairLabelCount, operator: 'greater_than_or_equal', threshold: policy.minimumDependencySliceLabels,
    }));
    checks.push(makeGate({
      gateId: `slice_coverage:${sliceId}`, scope: 'slice', edgeType: null, sliceId,
      actual: measuredBound(summary.metrics.coverage, 'valuePpm', `slice_coverage:${sliceId}`),
      operator: 'greater_than_or_equal', threshold: policy.minimumCoveragePpm,
    }));
  }

  for (const result of edgeMetrics) {
    const overall = result.slices.find((slice) => slice.sliceId === 'overall')
      || invalid(`typed_relationship_calibration_mandatory_slice_missing:overall:${result.edgeType}`);
    const hardNegative = result.slices.find((slice) => slice.sliceId === 'hard_negative')
      || invalid(`typed_relationship_calibration_mandatory_slice_missing:hard_negative:${result.edgeType}`);
    checks.push(makeGate({
      gateId: `positive_support:${result.edgeType}`, scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: overall.metrics.positiveLabelCount, operator: 'greater_than_or_equal',
      threshold: policy.minimumPositiveLabelsPerEdgeType,
    }));
    checks.push(makeGate({
      gateId: `negative_support:${result.edgeType}`, scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: overall.metrics.negativeLabelCount, operator: 'greater_than_or_equal',
      threshold: policy.minimumNegativeLabelsPerEdgeType,
    }));
    checks.push(makeGate({
      gateId: `precision_lower:${result.edgeType}`, scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: measuredBound(overall.metrics.precision, 'lowerPpm', `precision:${result.edgeType}`),
      operator: 'greater_than_or_equal', threshold: policy.minimumPrecisionLowerPpm,
    }));
    checks.push(makeGate({
      gateId: `recall_lower:${result.edgeType}`, scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: measuredBound(overall.metrics.recall, 'lowerPpm', `recall:${result.edgeType}`),
      operator: 'greater_than_or_equal', threshold: policy.minimumRecallLowerPpm,
    }));
    checks.push(makeGate({
      gateId: `fpr_upper:${result.edgeType}`, scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: measuredBound(overall.metrics.falsePositiveRate, 'upperPpm', `fpr:${result.edgeType}`),
      operator: 'less_than_or_equal', threshold: policy.maximumFalsePositiveRateUpperPpm,
    }));
    checks.push(makeGate({
      gateId: `coverage:${result.edgeType}`, scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: measuredBound(overall.metrics.coverage, 'valuePpm', `coverage:${result.edgeType}`),
      operator: 'greater_than_or_equal', threshold: policy.minimumCoveragePpm,
    }));
    checks.push(makeGate({
      gateId: `hard_negative_false_positives:${result.edgeType}`,
      scope: 'edge_type', edgeType: result.edgeType, sliceId: 'hard_negative',
      actual: hardNegative.metrics.confusion.falsePositive,
      operator: 'equal', threshold: policy.maximumHardNegativeFalsePositives,
    }));
    checks.push(makeGate({
      gateId: `hard_negative_fpr_upper:${result.edgeType}`,
      scope: 'edge_type', edgeType: result.edgeType, sliceId: 'hard_negative',
      actual: measuredBound(hardNegative.metrics.falsePositiveRate, 'upperPpm', `hard_negative_fpr:${result.edgeType}`),
      operator: 'less_than_or_equal', threshold: policy.maximumFalsePositiveRateUpperPpm,
    }));
    checks.push(makeGate({
      gateId: `insufficient_predicted_positive:${result.edgeType}`,
      scope: 'edge_type', edgeType: result.edgeType, sliceId: 'overall',
      actual: overall.metrics.confusion.insufficientPredictedPositive,
      operator: 'equal', threshold: policy.maximumInsufficientPredictedPositives,
    }));
  }
  const independent = edgeMetrics.find((item) => item.edgeType === 'source_independence')
    || invalid('typed_relationship_calibration_source_independence_missing');
  for (const sliceId of ['dependency_dependent', 'dependency_unknown'] as const) {
    const slice = independent.slices.find((item) => item.sliceId === sliceId)
      || invalid(`typed_relationship_calibration_mandatory_slice_missing:${sliceId}:source_independence`);
    checks.push(makeGate({
      gateId: `independence_false_positive:${sliceId}`,
      scope: 'edge_type', edgeType: 'source_independence', sliceId,
      actual: slice.metrics.confusion.falsePositive,
      operator: 'equal', threshold: 0,
    }));
  }
  const dependency = edgeMetrics.find((item) => item.edgeType === 'source_dependency')
    || invalid('typed_relationship_calibration_source_dependency_missing');
  for (const sliceId of ['dependency_independent', 'dependency_unknown'] as const) {
    const slice = dependency.slices.find((item) => item.sliceId === sliceId)
      || invalid(`typed_relationship_calibration_mandatory_slice_missing:${sliceId}:source_dependency`);
    checks.push(makeGate({
      gateId: `dependency_false_positive:${sliceId}`,
      scope: 'edge_type', edgeType: 'source_dependency', sliceId,
      actual: slice.metrics.confusion.falsePositive,
      operator: 'equal', threshold: 0,
    }));
  }
  return checks.sort((left, right) => compareText(left.gateId, right.gateId));
};

const calibrationCore = (artifact: Omit<
TypedRelationshipCalibrationArtifact,
'calibrationCoreSha256' | 'receipt' | 'artifactDigest'
>) => artifact;
const receiptWithoutSha = (receipt: Omit<TypedRelationshipCalibrationReceipt, 'receiptSha256'>) => receipt;
const artifactWithoutDigest = (artifact: Omit<TypedRelationshipCalibrationArtifact, 'artifactDigest'>) => artifact;
const decisionForTrustPolicy = (
  trustPolicy: TypedRelationshipCalibrationTrustPolicy,
): TypedRelationshipCalibrationArtifact['decision'] => trustPolicy.authorizationScope === 'production_candidate'
  ? 'production_gates_passed'
  : 'contract_gates_passed_test_only';

export const getTypedRelationshipCalibrationReceiptId = (calibrationCoreSha256: string) => {
  requireSha(calibrationCoreSha256, 'typed_relationship_calibration_core_sha_invalid');
  return `typed-calibration:${calibrationCoreSha256}` as const;
};

export const typedRelationshipCalibrationReceiptSha256 = (
  receipt: Omit<TypedRelationshipCalibrationReceipt, 'receiptSha256'>,
) => relationshipInputSha256(receiptWithoutSha(receipt));

export const decodeTypedRelationshipCalibrationReceipt = (
  input: unknown,
  expected?: { receiptId: string; receiptSha256: string },
): TypedRelationshipCalibrationReceipt => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(String(input));
    } catch {
      invalid('typed_relationship_calibration_receipt_json_invalid');
    }
  }
  const receipt = exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'receiptId', 'decision',
    'calibrationCoreSha256', 'lineageSha256', 'auditPlanSha256', 'evaluationSetSha256',
    'labelSetSha256', 'metricsSha256', 'gatePolicyVersion', 'gatePolicySha256',
    'calibratedEdgeTypeSetSha256', 'trustPolicyDigest', 'evidenceClass', 'authorizationScope',
    'claimDiscipline', 'receiptSha256',
  ], 'typed_relationship_calibration_receipt_invalid');
  if (receipt.recordType !== 'typed_relationship_calibration_receipt'
    || receipt.schemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION
    || receipt.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !['contract_gates_passed_test_only', 'production_gates_passed'].includes(String(receipt.decision))
    || receipt.gatePolicyVersion !== TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_VERSION
    || receipt.gatePolicySha256 !== TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256
    || receipt.calibratedEdgeTypeSetSha256 !== TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256
    || !['synthetic_contract_fixture', 'human_reviewed_locked_holdout'].includes(String(receipt.evidenceClass))
    || !['test_only_never_publish', 'production_candidate'].includes(String(receipt.authorizationScope))
    || (receipt.decision === 'production_gates_passed'
      ? receipt.evidenceClass !== 'human_reviewed_locked_holdout' || receipt.authorizationScope !== 'production_candidate'
      : receipt.evidenceClass !== 'synthetic_contract_fixture' || receipt.authorizationScope !== 'test_only_never_publish')
    || canonicalizeRelationshipInput(receipt.claimDiscipline)
      !== canonicalizeRelationshipInput(TYPED_RELATIONSHIP_CLAIM_DISCIPLINE)) {
    invalid('typed_relationship_calibration_receipt_invalid');
  }
  for (const field of [
    'calibrationCoreSha256', 'lineageSha256', 'auditPlanSha256', 'evaluationSetSha256',
    'labelSetSha256', 'metricsSha256', 'gatePolicySha256', 'calibratedEdgeTypeSetSha256',
    'trustPolicyDigest', 'receiptSha256',
  ] as const) requireSha(receipt[field], 'typed_relationship_calibration_receipt_invalid');
  const calibrationCoreSha256 = requireSha(
    receipt.calibrationCoreSha256,
    'typed_relationship_calibration_receipt_invalid',
  );
  if (receipt.receiptId !== getTypedRelationshipCalibrationReceiptId(calibrationCoreSha256)) {
    invalid('typed_relationship_calibration_receipt_id_mismatch');
  }
  const typed = receipt as unknown as TypedRelationshipCalibrationReceipt;
  const { receiptSha256: _receiptSha256, ...withoutSha } = typed;
  if (typed.receiptSha256 !== typedRelationshipCalibrationReceiptSha256(withoutSha)) {
    invalid('typed_relationship_calibration_receipt_digest_mismatch');
  }
  if (expected && (typed.receiptId !== expected.receiptId || typed.receiptSha256 !== expected.receiptSha256)) {
    invalid('typed_relationship_calibration_receipt_expected_identity_mismatch');
  }
  return typed;
};

export const assertTypedRelationshipCalibrationReceiptProductionEligible = (
  receiptInput: unknown,
): TypedRelationshipCalibrationReceipt => {
  const receipt = decodeTypedRelationshipCalibrationReceipt(receiptInput);
  if (receipt.decision !== 'production_gates_passed'
    || receipt.evidenceClass !== 'human_reviewed_locked_holdout'
    || receipt.authorizationScope !== 'production_candidate') {
    invalid('typed_relationship_calibration_receipt_not_production_eligible');
  }
  return receipt;
};

export const serializeTypedRelationshipCalibrationReceipt = (
  receipt: TypedRelationshipCalibrationReceipt,
) => `${canonicalizeRelationshipInput(decodeTypedRelationshipCalibrationReceipt(receipt))}\n`;

export const buildTypedRelationshipCalibrationArtifact = (params: {
  lineage: TypedRelationshipCalibrationLineage;
  auditPlan: TypedRelationshipCalibrationAuditPlan;
  trustPolicy: TypedRelationshipCalibrationTrustPolicy;
  labels: readonly TypedRelationshipCalibrationLabelDraft[];
}): TypedRelationshipCalibrationArtifact => {
  const lineage = normalizeLineage(params.lineage);
  const auditPlan = normalizeAuditPlan(params.auditPlan);
  const trustPolicy = normalizeTrustPolicy(params.trustPolicy);
  const decision = decisionForTrustPolicy(trustPolicy);
  if (trustPolicy.auditPlanDigest !== auditPlan.planDigest) {
    invalid('typed_relationship_calibration_untrusted_audit_plan');
  }
  if (!Array.isArray(params.labels)) invalid('typed_relationship_calibration_labels_invalid');
  const labels = params.labels.map((label) => buildLabel(label, lineage))
    .sort((left, right) => compareText(left.pairKey, right.pairKey));
  if (new Set(labels.map((label) => label.pairKey)).size !== labels.length) {
    invalid('typed_relationship_calibration_duplicate_pair');
  }
  if (new Set(labels.map((label) => label.labelId)).size !== labels.length) {
    invalid('typed_relationship_calibration_duplicate_label');
  }
  const holdoutPairKeys = auditPlan.lockedHoldout.map((item) => item.pairKey).sort(compareText);
  const labelPairKeys = labels.map((label) => label.pairKey).sort(compareText);
  if (canonicalizeRelationshipInput(labelPairKeys) !== canonicalizeRelationshipInput(holdoutPairKeys)) {
    invalid('typed_relationship_calibration_holdout_membership_mismatch');
  }
  const reviews = labels.map((label) => label.review);
  if (typedRelationshipCalibrationReviewSetSha256(reviews) !== trustPolicy.reviewReceiptSetSha256) {
    invalid('typed_relationship_calibration_untrusted_review_set');
  }
  for (const review of reviews) {
    if (review.reviewerCohortId !== trustPolicy.reviewerCohortId
      || review.adjudicationPolicyVersion !== trustPolicy.adjudicationPolicyVersion
      || review.reviewerIds.length < trustPolicy.minimumIndependentReviewers) {
      invalid('typed_relationship_calibration_review_policy_mismatch');
    }
  }
  const edgeMetrics = buildEdgeMetrics(labels);
  const sliceSummaries = buildSliceSummaries(labels);
  for (const sliceId of TYPED_RELATIONSHIP_CALIBRATION_SLICE_IDS) {
    const summary = sliceSummaries.find((item) => item.sliceId === sliceId);
    if (!summary || summary.pairLabelCount === 0) {
      invalid(`typed_relationship_calibration_mandatory_slice_missing:${sliceId}`);
    }
  }
  const gateChecks = buildGateChecks(labels, edgeMetrics, sliceSummaries);
  const evaluationSetSha256 = relationshipInputSha256(labels.map((label) => ({
    pairKey: label.pairKey,
    evaluationDigest: label.evaluation.evaluationDigest,
  })));
  const labelSetSha256 = relationshipInputSha256(labels.map((label) => label.labelDigest));
  const metricsSha256 = relationshipInputSha256({ edgeMetrics, sliceSummaries, gateChecks });
  const core: Omit<
  TypedRelationshipCalibrationArtifact,
  'calibrationCoreSha256' | 'receipt' | 'artifactDigest'
  > = {
    recordType: 'typed_relationship_calibration_artifact',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    decision,
    calibrationScope: TYPED_RELATIONSHIP_CALIBRATION_SCOPE,
    trustPolicy,
    lineage,
    auditPlan,
    gatePolicy: TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY,
    labelCount: labels.length,
    evaluationSetSha256,
    labelSetSha256,
    labels,
    edgeMetrics,
    sliceSummaries,
    gateChecks,
  };
  const calibrationCoreSha256 = relationshipInputSha256(calibrationCore(core));
  const withoutReceiptSha: Omit<TypedRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'typed_relationship_calibration_receipt',
    schemaVersion: TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    receiptId: getTypedRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision,
    calibrationCoreSha256,
    lineageSha256: relationshipInputSha256(lineage),
    auditPlanSha256: relationshipInputSha256(auditPlan),
    evaluationSetSha256,
    labelSetSha256,
    metricsSha256,
    gatePolicyVersion: TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_VERSION,
    gatePolicySha256: TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    calibratedEdgeTypeSetSha256: TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
    trustPolicyDigest: trustPolicy.trustPolicyDigest,
    evidenceClass: trustPolicy.evidenceClass,
    authorizationScope: trustPolicy.authorizationScope,
    claimDiscipline: TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  };
  const receipt: TypedRelationshipCalibrationReceipt = {
    ...withoutReceiptSha,
    receiptSha256: typedRelationshipCalibrationReceiptSha256(withoutReceiptSha),
  };
  const withoutArtifactDigest: Omit<TypedRelationshipCalibrationArtifact, 'artifactDigest'> = {
    ...core,
    calibrationCoreSha256,
    receipt,
  };
  return {
    ...withoutArtifactDigest,
    artifactDigest: relationshipInputSha256(artifactWithoutDigest(withoutArtifactDigest)),
  };
};

export const decodeTypedRelationshipCalibrationArtifact = (
  input: unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
  expectedTrustPolicy?: TypedRelationshipCalibrationTrustPolicy,
): TypedRelationshipCalibrationArtifact => {
  if (!expectedTrustPolicy) invalid('typed_relationship_calibration_trust_policy_required');
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(String(input));
    } catch {
      invalid('typed_relationship_calibration_json_invalid');
    }
  }
  const artifact = exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'decision', 'calibrationScope', 'trustPolicy', 'lineage', 'auditPlan',
    'gatePolicy', 'labelCount', 'evaluationSetSha256', 'labelSetSha256', 'labels',
    'edgeMetrics', 'sliceSummaries', 'gateChecks', 'calibrationCoreSha256', 'receipt',
    'artifactDigest',
  ], 'typed_relationship_calibration_artifact_invalid');
  if (artifact.recordType !== 'typed_relationship_calibration_artifact'
    || artifact.schemaVersion !== TYPED_RELATIONSHIP_CALIBRATION_SCHEMA_VERSION
    || artifact.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !['contract_gates_passed_test_only', 'production_gates_passed'].includes(String(artifact.decision))
    || !Array.isArray(artifact.labels)) {
    invalid('typed_relationship_calibration_artifact_invalid');
  }
  const lineage = normalizeLineage(artifact.lineage);
  if (expectedBinding) assertRelationshipInputBinding(lineage.binding, expectedBinding);
  const trustPolicy = normalizeTrustPolicy(artifact.trustPolicy);
  const expectedTrust = normalizeTrustPolicy(expectedTrustPolicy);
  if (canonicalizeRelationshipInput(trustPolicy) !== canonicalizeRelationshipInput(expectedTrust)) {
    invalid('typed_relationship_calibration_trust_policy_mismatch');
  }
  if (artifact.decision !== decisionForTrustPolicy(trustPolicy)) {
    invalid('typed_relationship_calibration_decision_mismatch');
  }
  const labels = artifact.labels.map((raw): TypedRelationshipCalibrationLabelDraft => {
    const label = exactKeys(raw, [
      'recordType', 'schemaVersion', 'canonicalVersion', 'pairKey', 'labelId', 'evaluation',
      'pairOutcome', 'edgeAdjudications', 'hardNegativeCategory', 'review', 'labelDigest',
    ], 'typed_relationship_calibration_label_invalid');
    return {
      evaluation: label.evaluation as TypedRelationshipPairEvaluation,
      pairOutcome: label.pairOutcome as TypedRelationshipCalibrationLabelDraft['pairOutcome'],
      edgeAdjudications: label.edgeAdjudications as TypedRelationshipEdgeAdjudication[],
      hardNegativeCategory: label.hardNegativeCategory as HardNegativeCategory | null,
      review: label.review as TypedRelationshipCalibrationReviewReceipt,
    };
  });
  const rebuilt = buildTypedRelationshipCalibrationArtifact({
    lineage,
    auditPlan: artifact.auditPlan as TypedRelationshipCalibrationAuditPlan,
    trustPolicy,
    labels,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(rebuilt)) {
    invalid('typed_relationship_calibration_noncanonical');
  }
  return rebuilt;
};

export const serializeTypedRelationshipCalibrationArtifact = (
  artifact: TypedRelationshipCalibrationArtifact,
  expectedTrustPolicy: TypedRelationshipCalibrationTrustPolicy,
) => `${canonicalizeRelationshipInput(decodeTypedRelationshipCalibrationArtifact(
  artifact,
  artifact.lineage.binding,
  expectedTrustPolicy,
))}\n`;
