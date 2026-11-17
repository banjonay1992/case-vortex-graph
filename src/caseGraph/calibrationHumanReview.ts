import { createHash } from 'node:crypto';

import {
  decodeCalibrationHumanReviewSourcePacket,
  type CalibrationHumanReviewSourceMaterial,
} from './calibrationHumanReviewSourcePacket';

import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES,
  buildContextualRelationshipCalibrationArtifact,
  buildContextualRelationshipCalibrationReviewReceipt,
  buildContextualRelationshipCalibrationTrustPolicy,
  contextualRelationshipCalibrationReviewSetSha256,
  decodeContextualRelationshipCalibrationAuditPlan,
  decodeContextualRelationshipCalibrationLineage,
  getContextualRelationshipCalibrationSampleId,
  serializeContextualRelationshipCalibrationArtifact,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationAuditPlan,
  type ContextualRelationshipCalibrationLabelDraft,
  type ContextualRelationshipCalibrationLineage,
  type ContextualRelationshipCalibrationTrustPolicy,
} from './contextualRelationshipCalibration';
import {
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
  type ContextualExplanationCandidateDraft,
  type ContextualExplanationEvaluation,
} from './contextualExplanation';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  decodeTypedRelationshipPairEvaluation,
  type TypedRelationshipPairEvaluation,
} from './typedRelationshipEngine';
import {
  TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES,
  buildTypedRelationshipCalibrationArtifact,
  buildTypedRelationshipCalibrationReviewReceipt,
  buildTypedRelationshipCalibrationTrustPolicy,
  decodeTypedRelationshipCalibrationAuditPlan,
  decodeTypedRelationshipCalibrationLineage,
  typedRelationshipCalibrationReviewSetSha256,
  serializeTypedRelationshipCalibrationArtifact,
  serializeTypedRelationshipCalibrationReceipt,
  type TypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationAuditPlan,
  type TypedRelationshipCalibrationLabelDraft,
  type TypedRelationshipCalibrationLineage,
  type TypedRelationshipCalibrationTrustPolicy,
  type TypedRelationshipEdgeAdjudication,
} from './typedRelationshipCalibration';

export const CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION = 'case-graph-calibration-human-review-v1' as const;
export const CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION = 'case-graph-human-review-attestation-v1' as const;
export const CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT =
  'I attest that the named reviewers and adjudicator are real people who independently reviewed the locked candidates under the stated policy; this evidence is not synthetic or inferred from model output.' as const;

const PACK_PURPOSE = 'human_review_evidence_collection_not_authorization' as const;
const ASSIGNMENT_PURPOSE = 'review_worksheet_not_evidence' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const PAIR_KEY = /^pair:[a-f0-9]{64}$/;
const SAMPLE_ID = /^context-calibration-sample:[a-f0-9]{64}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

type PairOutcome = 'positive' | 'negative' | 'insufficient';
type TruthLabel = 'positive' | 'negative' | 'insufficient';
type PairHardNegative = typeof TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES[number];
type ContextualHardNegative = typeof CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES[number];

export type CalibrationHumanReviewSourceEvidence = {
  evidenceOrigin: 'synthetic_contract_fixture' | 'governed_locked_holdout_candidates';
  sourceId: string;
  sourceSha256: string;
};

export type CalibrationHumanReviewPolicy = {
  reviewerIds: string[];
  adjudicatorId: string;
  minimumIndependentReviewers: number;
  pairReviewerCohortId: string;
  pairAdjudicationPolicyVersion: string;
  contextualReviewerCohortId: string;
  contextualAdjudicationPolicyVersion: string;
};

export type CalibrationHumanReviewPairCandidate = {
  pairKey: string;
  sourceGroupId: string;
  evaluationDigest: string;
  evaluation: TypedRelationshipPairEvaluation;
};

export type CalibrationHumanReviewContextualCandidate = {
  sampleId: string;
  sourceGroupId: string;
  evaluationDigest: string;
  candidate: ContextualExplanationCandidateDraft;
  evaluation: ContextualExplanationEvaluation;
  sourceSnapshotDigest: string;
  observationArchiveRecordDigest: string;
};

export type CalibrationHumanReviewPack = {
  recordType: 'calibration_human_review_pack';
  schemaVersion: typeof CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION;
  purpose: typeof PACK_PURPOSE;
  lockedAt: string;
  sourceEvidence: CalibrationHumanReviewSourceEvidence;
  reviewPolicy: CalibrationHumanReviewPolicy;
  pairLineage: TypedRelationshipCalibrationLineage;
  contextualLineage: ContextualRelationshipCalibrationLineage;
  pairAuditPlan: TypedRelationshipCalibrationAuditPlan;
  contextualAuditPlan: ContextualRelationshipCalibrationAuditPlan;
  pairCandidates: CalibrationHumanReviewPairCandidate[];
  contextualCandidates: CalibrationHumanReviewContextualCandidate[];
  lockedInputSha256: string;
  packDigest: string;
};

export type CalibrationHumanReviewPackDraft = Omit<
CalibrationHumanReviewPack,
'recordType' | 'schemaVersion' | 'purpose' | 'lockedInputSha256' | 'packDigest'
>;

export type CalibrationHumanReviewAssignment = {
  recordType: 'calibration_human_review_assignment';
  schemaVersion: typeof CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION;
  purpose: typeof ASSIGNMENT_PURPOSE;
  packDigest: string;
  lockedInputSha256: string;
  sourcePacketDigest: string | null;
  reviewerId: string;
  pairItems: Array<{
    pairKey: string;
    sourceGroupId: string;
    evaluationDigest: string;
    addresses: [string, string];
    sourceMaterials: CalibrationHumanReviewSourceMaterial[];
    decisionTemplate: {
      pairOutcome: null;
      edgeAdjudications: Array<{
        edgeType: typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number];
        label: null;
        rationaleCode: null;
      }>;
      hardNegativeCategory: null;
      reviewedAt: null;
    };
  }>;
  contextualItems: Array<{
    sampleId: string;
    sourceGroupId: string;
    evaluationDigest: string;
    kind: ContextualExplanationCandidateDraft['kind'];
    subjectAddress: string;
    referenceId: string;
    subjectMaterial: CalibrationHumanReviewSourceMaterial | null;
    referenceMaterial: {
      reference: ContextualExplanationCandidateDraft['reference'];
      subjectObservation: ContextualExplanationCandidateDraft['subjectObservation'];
      referenceObservation: ContextualExplanationCandidateDraft['referenceObservation'];
      provenance: ContextualExplanationCandidateDraft['provenance'];
      domainEvidence: ContextualExplanationCandidateDraft['domainEvidence'];
      missingness: ContextualExplanationCandidateDraft['missingness'];
      uncertainty: ContextualExplanationCandidateDraft['uncertainty'];
    };
    decisionTemplate: {
      truthLabel: null;
      hardNegativeCategory: null;
      rationaleCode: null;
      reviewedAt: null;
    };
  }>;
  assignmentDigest: string;
};

export type CalibrationHumanReviewPairDecision = {
  pairKey: string;
  evaluationDigest: string;
  pairOutcome: PairOutcome;
  edgeAdjudications: TypedRelationshipEdgeAdjudication[];
  hardNegativeCategory: PairHardNegative | null;
  reviewedAt: string;
};

export type CalibrationHumanReviewContextualDecision = {
  sampleId: string;
  evaluationDigest: string;
  truthLabel: TruthLabel;
  hardNegativeCategory: ContextualHardNegative | null;
  rationaleCode: string;
  reviewedAt: string;
};

export type CalibrationHumanReviewerSubmission = {
  recordType: 'calibration_human_reviewer_submission';
  schemaVersion: typeof CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION;
  packDigest: string;
  lockedInputSha256: string;
  reviewerId: string;
  startedAt: string;
  submittedAt: string;
  pairReviews: CalibrationHumanReviewPairDecision[];
  contextualReviews: CalibrationHumanReviewContextualDecision[];
  submissionDigest: string;
};

export type CalibrationHumanReviewerSubmissionDraft = Omit<
CalibrationHumanReviewerSubmission,
'recordType' | 'schemaVersion' | 'packDigest' | 'lockedInputSha256' | 'submissionDigest'
>;

type AdjudicationBasis = 'unanimous' | 'adjudicator_resolution';

export type CalibrationHumanReviewPairAdjudication = CalibrationHumanReviewPairDecision & {
  basis: AdjudicationBasis;
  resolutionRationaleCode: string;
};

export type CalibrationHumanReviewContextualAdjudication = CalibrationHumanReviewContextualDecision & {
  basis: AdjudicationBasis;
  resolutionRationaleCode: string;
};

export type CalibrationHumanReviewAttestation = {
  statementVersion: typeof CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION;
  statement: typeof CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT;
  attestedBy: string;
  attestedAt: string;
  reviewerIds: string[];
};

export type CalibrationHumanReviewAdjudication = {
  recordType: 'calibration_human_review_adjudication';
  schemaVersion: typeof CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION;
  packDigest: string;
  lockedInputSha256: string;
  adjudicatorId: string;
  startedAt: string;
  adjudicatedAt: string;
  pairAdjudications: CalibrationHumanReviewPairAdjudication[];
  contextualAdjudications: CalibrationHumanReviewContextualAdjudication[];
  humanReviewAttestation: CalibrationHumanReviewAttestation | null;
  adjudicationDigest: string;
};

export type CalibrationHumanReviewAdjudicationDraft = Omit<
CalibrationHumanReviewAdjudication,
'recordType' | 'schemaVersion' | 'packDigest' | 'lockedInputSha256' | 'adjudicationDigest'
>;

export type CalibrationHumanReviewBundle = {
  recordType: 'calibration_human_review_bundle';
  schemaVersion: typeof CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION;
  pack: CalibrationHumanReviewPack;
  submissions: CalibrationHumanReviewerSubmission[];
  adjudication: CalibrationHumanReviewAdjudication;
  evidenceClass: 'synthetic_contract_fixture' | 'human_reviewed_locked_holdout';
  authorizationScope: 'test_only_never_publish' | 'production_candidate';
  pairLabels: TypedRelationshipCalibrationLabelDraft[];
  contextualLabels: ContextualRelationshipCalibrationLabelDraft[];
  pairTrustPolicy: TypedRelationshipCalibrationTrustPolicy;
  contextualTrustPolicy: ContextualRelationshipCalibrationTrustPolicy;
  evidenceSetSha256: string;
  bundleDigest: string;
};

function invalid(code: string): never { throw new Error(code); }
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exact = (value: unknown, keys: readonly string[], code: string): Record<string, unknown> => {
  if (!plain(value)) invalid(code);
  const actual = Object.keys(value).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};
const reqSha = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value;
};
const reqId = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !ID.test(value)) invalid(code);
  return value;
};
const reqCount = (value: unknown, code: string, minimum: number) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};
const reqIso = (value: unknown, code: string): string => {
  if (typeof value !== 'string') invalid(code);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid(code);
  return value;
};
const assertChronology = (earlier: string, later: string, code: string) => {
  if (Date.parse(later) < Date.parse(earlier)) invalid(code);
};
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const parseJson = (input: unknown, code: string): unknown => {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) return input;
  try { return JSON.parse(String(input)); } catch { return invalid(code); }
};

const normalizeSourceEvidence = (value: unknown): CalibrationHumanReviewSourceEvidence => {
  const source = exact(value, ['evidenceOrigin', 'sourceId', 'sourceSha256'], 'calibration_human_review_source_invalid');
  if (!['synthetic_contract_fixture', 'governed_locked_holdout_candidates'].includes(String(source.evidenceOrigin))) {
    invalid('calibration_human_review_source_invalid');
  }
  return {
    evidenceOrigin: source.evidenceOrigin as CalibrationHumanReviewSourceEvidence['evidenceOrigin'],
    sourceId: reqId(source.sourceId, 'calibration_human_review_source_invalid'),
    sourceSha256: reqSha(source.sourceSha256, 'calibration_human_review_source_invalid'),
  };
};

const normalizeIds = (value: unknown, code: string): string[] => {
  if (!Array.isArray(value)) invalid(code);
  const ids = value.map((item) => reqId(item, code)).sort(compare);
  if (new Set(ids).size !== ids.length) invalid(code);
  return ids;
};

const normalizePolicy = (value: unknown): CalibrationHumanReviewPolicy => {
  const policy = exact(value, [
    'reviewerIds', 'adjudicatorId', 'minimumIndependentReviewers', 'pairReviewerCohortId',
    'pairAdjudicationPolicyVersion', 'contextualReviewerCohortId',
    'contextualAdjudicationPolicyVersion',
  ], 'calibration_human_review_policy_invalid');
  const reviewerIds = normalizeIds(policy.reviewerIds, 'calibration_human_review_policy_invalid');
  const minimumIndependentReviewers = reqCount(
    policy.minimumIndependentReviewers,
    'calibration_human_review_policy_invalid',
    2,
  );
  const adjudicatorId = reqId(policy.adjudicatorId, 'calibration_human_review_policy_invalid');
  if (reviewerIds.length < minimumIndependentReviewers || reviewerIds.includes(adjudicatorId)) {
    invalid('calibration_human_review_policy_invalid');
  }
  return {
    reviewerIds,
    adjudicatorId,
    minimumIndependentReviewers,
    pairReviewerCohortId: reqId(policy.pairReviewerCohortId, 'calibration_human_review_policy_invalid'),
    pairAdjudicationPolicyVersion: reqId(
      policy.pairAdjudicationPolicyVersion,
      'calibration_human_review_policy_invalid',
    ),
    contextualReviewerCohortId: reqId(
      policy.contextualReviewerCohortId,
      'calibration_human_review_policy_invalid',
    ),
    contextualAdjudicationPolicyVersion: reqId(
      policy.contextualAdjudicationPolicyVersion,
      'calibration_human_review_policy_invalid',
    ),
  };
};

const normalizePairAdjudications = (value: unknown, code: string): TypedRelationshipEdgeAdjudication[] => {
  if (!Array.isArray(value)) invalid(code);
  const items = value.map((raw) => {
    const item = exact(raw, ['edgeType', 'label', 'rationaleCode'], code);
    if (!TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.includes(item.edgeType as typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number])
      || !['positive', 'negative', 'insufficient'].includes(String(item.label))) invalid(code);
    return {
      edgeType: item.edgeType as typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number],
      label: item.label as TypedRelationshipEdgeAdjudication['label'],
      rationaleCode: reqId(item.rationaleCode, code),
    };
  }).sort((left, right) => TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.indexOf(left.edgeType)
    - TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.indexOf(right.edgeType));
  if (items.length !== TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.length
    || new Set(items.map((item) => item.edgeType)).size !== items.length
    || items.some((item, index) => item.edgeType !== TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[index])) invalid(code);
  return items;
};

const normalizePairOutcome = (
  outcome: unknown,
  edgeAdjudications: readonly TypedRelationshipEdgeAdjudication[],
  hardNegativeCategory: unknown,
  code: string,
) => {
  if (!['positive', 'negative', 'insufficient'].includes(String(outcome))) invalid(code);
  const pairOutcome = outcome as PairOutcome;
  const positives = edgeAdjudications.filter((item) => item.label === 'positive').length;
  const insufficient = edgeAdjudications.filter((item) => item.label === 'insufficient').length;
  if ((pairOutcome === 'positive' && positives === 0)
    || (pairOutcome === 'negative' && (positives !== 0 || insufficient !== 0))
    || (pairOutcome === 'insufficient' && (positives !== 0 || insufficient === 0))) invalid(code);
  const hardNegative = hardNegativeCategory === null ? null
    : TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES.includes(hardNegativeCategory as PairHardNegative)
      ? hardNegativeCategory as PairHardNegative : invalid(code);
  if (hardNegative !== null && pairOutcome !== 'negative') invalid(code);
  return { pairOutcome, hardNegativeCategory: hardNegative };
};

const normalizeTruth = (truth: unknown, hardNegativeCategory: unknown, code: string) => {
  if (!['positive', 'negative', 'insufficient'].includes(String(truth))) invalid(code);
  const truthLabel = truth as TruthLabel;
  const hardNegative = hardNegativeCategory === null ? null
    : CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES.includes(
      hardNegativeCategory as ContextualHardNegative,
    ) ? hardNegativeCategory as ContextualHardNegative : invalid(code);
  if (hardNegative !== null && truthLabel !== 'negative') invalid(code);
  return { truthLabel, hardNegativeCategory: hardNegative };
};

const normalizePairCandidate = (
  value: unknown,
  lineage: TypedRelationshipCalibrationLineage,
): CalibrationHumanReviewPairCandidate => {
  const candidate = exact(value, [
    'pairKey', 'sourceGroupId', 'evaluationDigest', 'evaluation',
  ], 'calibration_human_review_pair_candidate_invalid');
  const evaluation = decodeTypedRelationshipPairEvaluation(candidate.evaluation, lineage.binding);
  const pairKey = `pair:${relationshipInputSha256(evaluation.addresses)}`;
  if (candidate.pairKey !== pairKey || candidate.evaluationDigest !== evaluation.evaluationDigest) {
    invalid('calibration_human_review_pair_candidate_identity_mismatch');
  }
  return {
    pairKey,
    sourceGroupId: reqId(candidate.sourceGroupId, 'calibration_human_review_pair_candidate_invalid'),
    evaluationDigest: reqSha(candidate.evaluationDigest, 'calibration_human_review_pair_candidate_invalid'),
    evaluation,
  };
};

const normalizeContextualCandidate = (
  value: unknown,
  lineage: ContextualRelationshipCalibrationLineage,
): CalibrationHumanReviewContextualCandidate => {
  const item = exact(value, [
    'sampleId', 'sourceGroupId', 'evaluationDigest', 'candidate', 'evaluation',
    'sourceSnapshotDigest', 'observationArchiveRecordDigest',
  ], 'calibration_human_review_contextual_candidate_invalid');
  const candidate = item.candidate as ContextualExplanationCandidateDraft;
  const evaluation = evaluateContextualExplanationCandidate(candidate);
  if (canonicalizeContextualExplanation(evaluation)
    !== canonicalizeContextualExplanation(item.evaluation)) {
    invalid('calibration_human_review_contextual_evaluation_mismatch');
  }
  const sourceSnapshotDigest = reqSha(
    item.sourceSnapshotDigest,
    'calibration_human_review_contextual_candidate_invalid',
  );
  const observationArchiveRecordDigest = reqSha(
    item.observationArchiveRecordDigest,
    'calibration_human_review_contextual_candidate_invalid',
  );
  const sampleId = getContextualRelationshipCalibrationSampleId({
    candidate,
    sourceSnapshotDigest,
    observationArchiveRecordDigest,
  });
  const evaluationDigest = contextualExplanationSha256(evaluation);
  if (item.sampleId !== sampleId || item.evaluationDigest !== evaluationDigest) {
    invalid('calibration_human_review_contextual_candidate_identity_mismatch');
  }
  const source = lineage.sourceArchives.find((archive) => archive.sourceSnapshotDigest === sourceSnapshotDigest);
  if (!source || source.kind !== candidate.kind
    || !candidate.provenance.some((provenance) => provenance.role === 'context_reference'
      && provenance.providerId === source.providerId
      && provenance.datasetVersion === source.datasetVersion)) {
    invalid('calibration_human_review_contextual_candidate_source_mismatch');
  }
  return {
    sampleId,
    sourceGroupId: reqId(item.sourceGroupId, 'calibration_human_review_contextual_candidate_invalid'),
    evaluationDigest,
    candidate,
    evaluation,
    sourceSnapshotDigest,
    observationArchiveRecordDigest,
  };
};

const assertMembership = (
  actual: Array<{ id: string; sourceGroupId: string }>,
  expected: Array<{ id: string; sourceGroupId: string }>,
  code: string,
) => {
  const sortedActual = actual.sort((left, right) => compare(left.id, right.id));
  const sortedExpected = expected.sort((left, right) => compare(left.id, right.id));
  if (!same(sortedActual, sortedExpected)) invalid(code);
};

const lockedInputCore = (pack: Pick<
CalibrationHumanReviewPack,
'sourceEvidence' | 'pairLineage' | 'contextualLineage' | 'pairAuditPlan' | 'contextualAuditPlan'
| 'pairCandidates' | 'contextualCandidates'
>) => pack;

const packWithoutDigest = (pack: Omit<CalibrationHumanReviewPack, 'packDigest'>) => pack;

const normalizePackMaterial = (pack: {
  lockedAt: unknown;
  sourceEvidence: unknown;
  reviewPolicy: unknown;
  pairLineage: unknown;
  contextualLineage: unknown;
  pairAuditPlan: unknown;
  contextualAuditPlan: unknown;
  pairCandidates: unknown;
  contextualCandidates: unknown;
}) => {
  if (!Array.isArray(pack.pairCandidates) || !Array.isArray(pack.contextualCandidates)) {
    invalid('calibration_human_review_pack_invalid');
  }
  const pairLineage = decodeTypedRelationshipCalibrationLineage(pack.pairLineage);
  const contextualLineage = decodeContextualRelationshipCalibrationLineage(pack.contextualLineage);
  if (!same(pairLineage.binding, contextualLineage.binding)) {
    invalid('calibration_human_review_lineage_binding_mismatch');
  }
  const pairAuditPlan = decodeTypedRelationshipCalibrationAuditPlan(pack.pairAuditPlan);
  const contextualAuditPlan = decodeContextualRelationshipCalibrationAuditPlan(pack.contextualAuditPlan);
  const pairCandidates = pack.pairCandidates.map((candidate) => normalizePairCandidate(candidate, pairLineage))
    .sort((left, right) => compare(left.pairKey, right.pairKey));
  const contextualCandidates = pack.contextualCandidates.map((candidate) => (
    normalizeContextualCandidate(candidate, contextualLineage)
  )).sort((left, right) => compare(left.sampleId, right.sampleId));
  if (new Set(pairCandidates.map((candidate) => candidate.pairKey)).size !== pairCandidates.length
    || new Set(contextualCandidates.map((candidate) => candidate.sampleId)).size !== contextualCandidates.length) {
    invalid('calibration_human_review_candidate_duplicate');
  }
  assertMembership(
    pairCandidates.map((candidate) => ({ id: candidate.pairKey, sourceGroupId: candidate.sourceGroupId })),
    pairAuditPlan.lockedHoldout.map((member) => ({ id: member.pairKey, sourceGroupId: member.sourceGroupId })),
    'calibration_human_review_pair_holdout_incomplete',
  );
  assertMembership(
    contextualCandidates.map((candidate) => ({ id: candidate.sampleId, sourceGroupId: candidate.sourceGroupId })),
    contextualAuditPlan.lockedHoldout.map((member) => ({ id: member.sampleId, sourceGroupId: member.sourceGroupId })),
    'calibration_human_review_contextual_holdout_incomplete',
  );
  return {
    recordType: 'calibration_human_review_pack' as const,
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    purpose: PACK_PURPOSE,
    lockedAt: reqIso(pack.lockedAt, 'calibration_human_review_pack_time_invalid'),
    sourceEvidence: normalizeSourceEvidence(pack.sourceEvidence),
    reviewPolicy: normalizePolicy(pack.reviewPolicy),
    pairLineage,
    contextualLineage,
    pairAuditPlan,
    contextualAuditPlan,
    pairCandidates,
    contextualCandidates,
  };
};

const normalizePack = (input: unknown): CalibrationHumanReviewPack => {
  const value = parseJson(input, 'calibration_human_review_pack_json_invalid');
  const pack = exact(value, [
    'recordType', 'schemaVersion', 'purpose', 'lockedAt', 'sourceEvidence', 'reviewPolicy',
    'pairLineage', 'contextualLineage', 'pairAuditPlan', 'contextualAuditPlan',
    'pairCandidates', 'contextualCandidates', 'lockedInputSha256', 'packDigest',
  ], 'calibration_human_review_pack_invalid');
  if (pack.recordType !== 'calibration_human_review_pack'
    || pack.schemaVersion !== CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION
    || pack.purpose !== PACK_PURPOSE) invalid('calibration_human_review_pack_invalid');
  const withoutHashes = normalizePackMaterial(pack as Parameters<typeof normalizePackMaterial>[0]);
  const lockedInputSha256 = relationshipInputSha256(lockedInputCore(withoutHashes));
  if (pack.lockedInputSha256 !== lockedInputSha256) invalid('calibration_human_review_locked_input_tampered');
  const withoutDigest = { ...withoutHashes, lockedInputSha256 };
  const packDigest = relationshipInputSha256(packWithoutDigest(withoutDigest));
  if (pack.packDigest !== packDigest) invalid('calibration_human_review_pack_digest_mismatch');
  return { ...withoutDigest, packDigest };
};

export const buildCalibrationHumanReviewPack = (
  draft: CalibrationHumanReviewPackDraft,
): CalibrationHumanReviewPack => {
  const base = normalizePackMaterial(draft);
  const lockedInputSha256 = relationshipInputSha256(lockedInputCore(base));
  const withoutDigest = { ...base, lockedInputSha256 };
  return normalizePack({
    ...withoutDigest,
    packDigest: relationshipInputSha256(packWithoutDigest(withoutDigest)),
  });
};

export const decodeCalibrationHumanReviewPack = (input: unknown) => normalizePack(input);
export const serializeCalibrationHumanReviewPack = (pack: CalibrationHumanReviewPack) => (
  `${canonicalizeRelationshipInput(normalizePack(pack))}\n`
);

export const buildCalibrationHumanReviewAssignment = (
  packInput: unknown,
  reviewerIdInput: string,
  sourcePacketInput?: unknown,
): CalibrationHumanReviewAssignment => {
  const pack = normalizePack(packInput);
  const sourcePacket = sourcePacketInput == null
    ? null
    : decodeCalibrationHumanReviewSourcePacket(pack, sourcePacketInput);
  if (pack.sourceEvidence.evidenceOrigin === 'governed_locked_holdout_candidates' && !sourcePacket) {
    invalid('calibration_human_review_governed_assignment_source_packet_required');
  }
  const sourceMaterials = new Map((sourcePacket?.materials || []).map((material) => [material.address, material]));
  const reviewerId = reqId(reviewerIdInput, 'calibration_human_review_assignment_reviewer_invalid');
  if (!pack.reviewPolicy.reviewerIds.includes(reviewerId)) {
    invalid('calibration_human_review_assignment_reviewer_not_authorized');
  }
  const withoutDigest: Omit<CalibrationHumanReviewAssignment, 'assignmentDigest'> = {
    recordType: 'calibration_human_review_assignment',
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    purpose: ASSIGNMENT_PURPOSE,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    sourcePacketDigest: sourcePacket?.packetDigest || null,
    reviewerId,
    pairItems: pack.pairCandidates.map((candidate) => ({
      pairKey: candidate.pairKey,
      sourceGroupId: candidate.sourceGroupId,
      evaluationDigest: candidate.evaluationDigest,
      addresses: candidate.evaluation.addresses,
      sourceMaterials: candidate.evaluation.addresses.map((address) => sourceMaterials.get(address)).filter(
        (material): material is CalibrationHumanReviewSourceMaterial => material != null,
      ),
      decisionTemplate: {
        pairOutcome: null,
        edgeAdjudications: TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.map((edgeType) => ({
          edgeType,
          label: null,
          rationaleCode: null,
        })),
        hardNegativeCategory: null,
        reviewedAt: null,
      },
    })),
    contextualItems: pack.contextualCandidates.map((candidate) => ({
      sampleId: candidate.sampleId,
      sourceGroupId: candidate.sourceGroupId,
      evaluationDigest: candidate.evaluationDigest,
      kind: candidate.candidate.kind,
      subjectAddress: candidate.candidate.subjectAddress,
      referenceId: candidate.candidate.reference.referenceId,
      subjectMaterial: sourceMaterials.get(candidate.candidate.subjectAddress) || null,
      referenceMaterial: {
        reference: candidate.candidate.reference,
        subjectObservation: candidate.candidate.subjectObservation,
        referenceObservation: candidate.candidate.referenceObservation,
        provenance: candidate.candidate.provenance,
        domainEvidence: candidate.candidate.domainEvidence,
        missingness: candidate.candidate.missingness,
        uncertainty: candidate.candidate.uncertainty,
      },
      decisionTemplate: {
        truthLabel: null,
        hardNegativeCategory: null,
        rationaleCode: null,
        reviewedAt: null,
      },
    })),
  };
  return { ...withoutDigest, assignmentDigest: relationshipInputSha256(withoutDigest) };
};

export const serializeCalibrationHumanReviewAssignment = (assignment: CalibrationHumanReviewAssignment) => (
  `${canonicalizeRelationshipInput(assignment)}\n`
);

const normalizePairDecision = (value: unknown): CalibrationHumanReviewPairDecision => {
  const item = exact(value, [
    'pairKey', 'evaluationDigest', 'pairOutcome', 'edgeAdjudications',
    'hardNegativeCategory', 'reviewedAt',
  ], 'calibration_human_review_pair_decision_invalid');
  if (typeof item.pairKey !== 'string' || !PAIR_KEY.test(item.pairKey)) {
    invalid('calibration_human_review_pair_decision_invalid');
  }
  const edgeAdjudications = normalizePairAdjudications(
    item.edgeAdjudications,
    'calibration_human_review_pair_decision_invalid',
  );
  const outcome = normalizePairOutcome(
    item.pairOutcome,
    edgeAdjudications,
    item.hardNegativeCategory,
    'calibration_human_review_pair_decision_invalid',
  );
  return {
    pairKey: item.pairKey,
    evaluationDigest: reqSha(item.evaluationDigest, 'calibration_human_review_pair_decision_invalid'),
    ...outcome,
    edgeAdjudications,
    reviewedAt: reqIso(item.reviewedAt, 'calibration_human_review_pair_decision_invalid'),
  };
};

const normalizeContextualDecision = (value: unknown): CalibrationHumanReviewContextualDecision => {
  const item = exact(value, [
    'sampleId', 'evaluationDigest', 'truthLabel', 'hardNegativeCategory', 'rationaleCode', 'reviewedAt',
  ], 'calibration_human_review_contextual_decision_invalid');
  if (typeof item.sampleId !== 'string' || !SAMPLE_ID.test(item.sampleId)) {
    invalid('calibration_human_review_contextual_decision_invalid');
  }
  return {
    sampleId: item.sampleId,
    evaluationDigest: reqSha(item.evaluationDigest, 'calibration_human_review_contextual_decision_invalid'),
    ...normalizeTruth(
      item.truthLabel,
      item.hardNegativeCategory,
      'calibration_human_review_contextual_decision_invalid',
    ),
    rationaleCode: reqId(item.rationaleCode, 'calibration_human_review_contextual_decision_invalid'),
    reviewedAt: reqIso(item.reviewedAt, 'calibration_human_review_contextual_decision_invalid'),
  };
};

const assertSubmissionCoverage = (
  pack: CalibrationHumanReviewPack,
  pairReviews: CalibrationHumanReviewPairDecision[],
  contextualReviews: CalibrationHumanReviewContextualDecision[],
) => {
  assertMembership(
    pairReviews.map((review) => ({ id: review.pairKey, sourceGroupId: review.evaluationDigest })),
    pack.pairCandidates.map((candidate) => ({ id: candidate.pairKey, sourceGroupId: candidate.evaluationDigest })),
    'calibration_human_review_pair_submission_incomplete',
  );
  assertMembership(
    contextualReviews.map((review) => ({ id: review.sampleId, sourceGroupId: review.evaluationDigest })),
    pack.contextualCandidates.map((candidate) => ({ id: candidate.sampleId, sourceGroupId: candidate.evaluationDigest })),
    'calibration_human_review_contextual_submission_incomplete',
  );
};

const submissionWithoutDigest = (
  submission: Omit<CalibrationHumanReviewerSubmission, 'submissionDigest'>,
) => submission;

const normalizeSubmission = (
  pack: CalibrationHumanReviewPack,
  input: unknown,
): CalibrationHumanReviewerSubmission => {
  const value = parseJson(input, 'calibration_human_review_submission_json_invalid');
  const submission = exact(value, [
    'recordType', 'schemaVersion', 'packDigest', 'lockedInputSha256', 'reviewerId',
    'startedAt', 'submittedAt', 'pairReviews', 'contextualReviews', 'submissionDigest',
  ], 'calibration_human_review_submission_invalid');
  if (submission.recordType !== 'calibration_human_reviewer_submission'
    || submission.schemaVersion !== CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION
    || submission.packDigest !== pack.packDigest
    || submission.lockedInputSha256 !== pack.lockedInputSha256
    || !Array.isArray(submission.pairReviews)
    || !Array.isArray(submission.contextualReviews)) invalid('calibration_human_review_submission_invalid');
  const reviewerId = reqId(submission.reviewerId, 'calibration_human_review_submission_invalid');
  if (!pack.reviewPolicy.reviewerIds.includes(reviewerId)) {
    invalid('calibration_human_review_submission_reviewer_not_authorized');
  }
  const startedAt = reqIso(submission.startedAt, 'calibration_human_review_submission_time_invalid');
  const submittedAt = reqIso(submission.submittedAt, 'calibration_human_review_submission_time_invalid');
  assertChronology(pack.lockedAt, startedAt, 'calibration_human_review_submission_predates_lock');
  assertChronology(startedAt, submittedAt, 'calibration_human_review_submission_time_invalid');
  const pairReviews = submission.pairReviews.map(normalizePairDecision)
    .sort((left, right) => compare(left.pairKey, right.pairKey));
  const contextualReviews = submission.contextualReviews.map(normalizeContextualDecision)
    .sort((left, right) => compare(left.sampleId, right.sampleId));
  assertSubmissionCoverage(pack, pairReviews, contextualReviews);
  for (const review of [...pairReviews, ...contextualReviews]) {
    assertChronology(startedAt, review.reviewedAt, 'calibration_human_review_item_time_invalid');
    assertChronology(review.reviewedAt, submittedAt, 'calibration_human_review_item_time_invalid');
  }
  const withoutDigest: Omit<CalibrationHumanReviewerSubmission, 'submissionDigest'> = {
    recordType: 'calibration_human_reviewer_submission',
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    reviewerId,
    startedAt,
    submittedAt,
    pairReviews,
    contextualReviews,
  };
  const submissionDigest = relationshipInputSha256(submissionWithoutDigest(withoutDigest));
  if (submission.submissionDigest !== submissionDigest) {
    invalid('calibration_human_review_submission_digest_mismatch');
  }
  return { ...withoutDigest, submissionDigest };
};

export const buildCalibrationHumanReviewerSubmission = (
  packInput: unknown,
  draft: CalibrationHumanReviewerSubmissionDraft,
) => {
  const pack = normalizePack(packInput);
  const withoutDigest: Omit<CalibrationHumanReviewerSubmission, 'submissionDigest'> = {
    recordType: 'calibration_human_reviewer_submission',
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    ...draft,
  };
  return normalizeSubmission(pack, {
    ...withoutDigest,
    submissionDigest: relationshipInputSha256(submissionWithoutDigest(withoutDigest)),
  });
};

export const decodeCalibrationHumanReviewerSubmission = (
  packInput: unknown,
  submissionInput: unknown,
) => normalizeSubmission(normalizePack(packInput), submissionInput);

export const serializeCalibrationHumanReviewerSubmission = (
  packInput: unknown,
  submissionInput: unknown,
) => `${canonicalizeRelationshipInput(decodeCalibrationHumanReviewerSubmission(
  packInput,
  submissionInput,
))}\n`;

const pairSemanticDecision = (decision: Pick<
CalibrationHumanReviewPairDecision,
'pairOutcome' | 'edgeAdjudications' | 'hardNegativeCategory'
>) => ({
  pairOutcome: decision.pairOutcome,
  edgeAdjudications: decision.edgeAdjudications.map(({ edgeType, label }) => ({ edgeType, label })),
  hardNegativeCategory: decision.hardNegativeCategory,
});
const contextualSemanticDecision = (decision: Pick<
CalibrationHumanReviewContextualDecision,
'truthLabel' | 'hardNegativeCategory'
>) => ({ truthLabel: decision.truthLabel, hardNegativeCategory: decision.hardNegativeCategory });

const allSame = (values: unknown[]) => values.length > 0
  && values.every((value) => same(value, values[0]));

const normalizeAttestation = (
  value: unknown,
  pack: CalibrationHumanReviewPack,
  adjudicatedAt: string,
): CalibrationHumanReviewAttestation | null => {
  if (pack.sourceEvidence.evidenceOrigin === 'synthetic_contract_fixture') {
    if (value !== null) invalid('calibration_human_review_fixture_attestation_forbidden');
    return null;
  }
  const attestation = exact(value, [
    'statementVersion', 'statement', 'attestedBy', 'attestedAt', 'reviewerIds',
  ], 'calibration_human_review_attestation_required');
  const reviewerIds = normalizeIds(attestation.reviewerIds, 'calibration_human_review_attestation_invalid');
  const attestedAt = reqIso(attestation.attestedAt, 'calibration_human_review_attestation_invalid');
  if (attestation.statementVersion !== CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION
    || attestation.statement !== CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT
    || attestation.attestedBy !== pack.reviewPolicy.adjudicatorId
    || !same(reviewerIds, pack.reviewPolicy.reviewerIds)
    || attestedAt !== adjudicatedAt) invalid('calibration_human_review_attestation_invalid');
  return {
    statementVersion: CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION,
    statement: CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT,
    attestedBy: pack.reviewPolicy.adjudicatorId,
    attestedAt,
    reviewerIds,
  };
};

const normalizePairAdjudication = (value: unknown): CalibrationHumanReviewPairAdjudication => {
  const item = exact(value, [
    'pairKey', 'evaluationDigest', 'pairOutcome', 'edgeAdjudications', 'hardNegativeCategory',
    'reviewedAt', 'basis', 'resolutionRationaleCode',
  ], 'calibration_human_review_pair_adjudication_invalid');
  if (!['unanimous', 'adjudicator_resolution'].includes(String(item.basis))) {
    invalid('calibration_human_review_pair_adjudication_invalid');
  }
  return {
    ...normalizePairDecision({
      pairKey: item.pairKey,
      evaluationDigest: item.evaluationDigest,
      pairOutcome: item.pairOutcome,
      edgeAdjudications: item.edgeAdjudications,
      hardNegativeCategory: item.hardNegativeCategory,
      reviewedAt: item.reviewedAt,
    }),
    basis: item.basis as AdjudicationBasis,
    resolutionRationaleCode: reqId(
      item.resolutionRationaleCode,
      'calibration_human_review_pair_adjudication_invalid',
    ),
  };
};

const normalizeContextualAdjudication = (value: unknown): CalibrationHumanReviewContextualAdjudication => {
  const item = exact(value, [
    'sampleId', 'evaluationDigest', 'truthLabel', 'hardNegativeCategory', 'rationaleCode',
    'reviewedAt', 'basis', 'resolutionRationaleCode',
  ], 'calibration_human_review_contextual_adjudication_invalid');
  if (!['unanimous', 'adjudicator_resolution'].includes(String(item.basis))) {
    invalid('calibration_human_review_contextual_adjudication_invalid');
  }
  return {
    ...normalizeContextualDecision({
      sampleId: item.sampleId,
      evaluationDigest: item.evaluationDigest,
      truthLabel: item.truthLabel,
      hardNegativeCategory: item.hardNegativeCategory,
      rationaleCode: item.rationaleCode,
      reviewedAt: item.reviewedAt,
    }),
    basis: item.basis as AdjudicationBasis,
    resolutionRationaleCode: reqId(
      item.resolutionRationaleCode,
      'calibration_human_review_contextual_adjudication_invalid',
    ),
  };
};

const normalizeSubmissionSet = (
  pack: CalibrationHumanReviewPack,
  submissionsInput: readonly unknown[],
) => {
  if (!Array.isArray(submissionsInput)) invalid('calibration_human_review_submission_set_invalid');
  const submissions = submissionsInput.map((submission) => normalizeSubmission(pack, submission))
    .sort((left, right) => compare(left.reviewerId, right.reviewerId));
  if (new Set(submissions.map((submission) => submission.reviewerId)).size !== submissions.length
    || !same(submissions.map((submission) => submission.reviewerId), pack.reviewPolicy.reviewerIds)) {
    invalid('calibration_human_review_submission_set_incomplete');
  }
  return submissions;
};

const adjudicationWithoutDigest = (
  adjudication: Omit<CalibrationHumanReviewAdjudication, 'adjudicationDigest'>,
) => adjudication;

const normalizeAdjudication = (
  pack: CalibrationHumanReviewPack,
  submissions: CalibrationHumanReviewerSubmission[],
  input: unknown,
): CalibrationHumanReviewAdjudication => {
  const value = parseJson(input, 'calibration_human_review_adjudication_json_invalid');
  const adjudication = exact(value, [
    'recordType', 'schemaVersion', 'packDigest', 'lockedInputSha256', 'adjudicatorId',
    'startedAt', 'adjudicatedAt', 'pairAdjudications', 'contextualAdjudications',
    'humanReviewAttestation', 'adjudicationDigest',
  ], 'calibration_human_review_adjudication_invalid');
  if (adjudication.recordType !== 'calibration_human_review_adjudication'
    || adjudication.schemaVersion !== CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION
    || adjudication.packDigest !== pack.packDigest
    || adjudication.lockedInputSha256 !== pack.lockedInputSha256
    || adjudication.adjudicatorId !== pack.reviewPolicy.adjudicatorId
    || !Array.isArray(adjudication.pairAdjudications)
    || !Array.isArray(adjudication.contextualAdjudications)) {
    invalid('calibration_human_review_adjudication_invalid');
  }
  const startedAt = reqIso(adjudication.startedAt, 'calibration_human_review_adjudication_time_invalid');
  const adjudicatedAt = reqIso(adjudication.adjudicatedAt, 'calibration_human_review_adjudication_time_invalid');
  const submittedTimes = submissions.map((submission) => submission.submittedAt).sort(compare);
  const latestSubmission = submittedTimes[submittedTimes.length - 1]
    || invalid('calibration_human_review_submission_set_incomplete');
  assertChronology(latestSubmission, startedAt, 'calibration_human_review_adjudication_predates_submissions');
  assertChronology(startedAt, adjudicatedAt, 'calibration_human_review_adjudication_time_invalid');
  const pairAdjudications = adjudication.pairAdjudications.map(normalizePairAdjudication)
    .sort((left, right) => compare(left.pairKey, right.pairKey));
  const contextualAdjudications = adjudication.contextualAdjudications.map(normalizeContextualAdjudication)
    .sort((left, right) => compare(left.sampleId, right.sampleId));
  assertSubmissionCoverage(pack, pairAdjudications, contextualAdjudications);
  for (const item of [...pairAdjudications, ...contextualAdjudications]) {
    if (item.reviewedAt !== adjudicatedAt) invalid('calibration_human_review_adjudication_item_time_invalid');
  }
  const pairReviewsBySubmission = submissions.map((submission) => new Map(
    submission.pairReviews.map((review) => [review.pairKey, review] as const),
  ));
  const contextualReviewsBySubmission = submissions.map((submission) => new Map(
    submission.contextualReviews.map((review) => [review.sampleId, review] as const),
  ));
  for (const final of pairAdjudications) {
    const decisions = pairReviewsBySubmission.map((reviews) => reviews.get(final.pairKey)
      || invalid('calibration_human_review_pair_submission_incomplete'));
    const unanimous = allSame(decisions.map(pairSemanticDecision));
    if (final.basis !== (unanimous ? 'unanimous' : 'adjudicator_resolution')) {
      invalid('calibration_human_review_adjudication_basis_invalid');
    }
    if (unanimous && !same(pairSemanticDecision(final), pairSemanticDecision(decisions[0]))) {
      invalid('calibration_human_review_unanimous_adjudication_mismatch');
    }
  }
  for (const final of contextualAdjudications) {
    const decisions = contextualReviewsBySubmission.map((reviews) => reviews.get(final.sampleId)
      || invalid('calibration_human_review_contextual_submission_incomplete'));
    const unanimous = allSame(decisions.map(contextualSemanticDecision));
    if (final.basis !== (unanimous ? 'unanimous' : 'adjudicator_resolution')) {
      invalid('calibration_human_review_adjudication_basis_invalid');
    }
    if (unanimous && !same(contextualSemanticDecision(final), contextualSemanticDecision(decisions[0]))) {
      invalid('calibration_human_review_unanimous_adjudication_mismatch');
    }
  }
  const withoutDigest: Omit<CalibrationHumanReviewAdjudication, 'adjudicationDigest'> = {
    recordType: 'calibration_human_review_adjudication',
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    adjudicatorId: pack.reviewPolicy.adjudicatorId,
    startedAt,
    adjudicatedAt,
    pairAdjudications,
    contextualAdjudications,
    humanReviewAttestation: normalizeAttestation(
      adjudication.humanReviewAttestation,
      pack,
      adjudicatedAt,
    ),
  };
  const adjudicationDigest = relationshipInputSha256(adjudicationWithoutDigest(withoutDigest));
  if (adjudication.adjudicationDigest !== adjudicationDigest) {
    invalid('calibration_human_review_adjudication_digest_mismatch');
  }
  return { ...withoutDigest, adjudicationDigest };
};

export const buildCalibrationHumanReviewAdjudication = (
  packInput: unknown,
  submissionsInput: readonly unknown[],
  draft: CalibrationHumanReviewAdjudicationDraft,
) => {
  const pack = normalizePack(packInput);
  const submissions = normalizeSubmissionSet(pack, submissionsInput);
  const withoutDigest: Omit<CalibrationHumanReviewAdjudication, 'adjudicationDigest'> = {
    recordType: 'calibration_human_review_adjudication',
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    ...draft,
  };
  return normalizeAdjudication(pack, submissions, {
    ...withoutDigest,
    adjudicationDigest: relationshipInputSha256(adjudicationWithoutDigest(withoutDigest)),
  });
};

export const decodeCalibrationHumanReviewAdjudication = (
  packInput: unknown,
  submissionsInput: readonly unknown[],
  adjudicationInput: unknown,
) => {
  const pack = normalizePack(packInput);
  return normalizeAdjudication(pack, normalizeSubmissionSet(pack, submissionsInput), adjudicationInput);
};

export const serializeCalibrationHumanReviewAdjudication = (
  packInput: unknown,
  submissionsInput: readonly unknown[],
  adjudicationInput: unknown,
) => `${canonicalizeRelationshipInput(decodeCalibrationHumanReviewAdjudication(
  packInput,
  submissionsInput,
  adjudicationInput,
))}\n`;

const itemEvidenceSha = (params: {
  pack: CalibrationHumanReviewPack;
  submissions: CalibrationHumanReviewerSubmission[];
  adjudication: CalibrationHumanReviewAdjudication;
  kind: 'pair' | 'contextual';
  itemId: string;
  decisions: Array<CalibrationHumanReviewPairDecision | CalibrationHumanReviewContextualDecision>;
  adjudicationDecision:
    | CalibrationHumanReviewPairAdjudication
    | CalibrationHumanReviewContextualAdjudication;
}) => relationshipInputSha256({
  schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
  packDigest: params.pack.packDigest,
  lockedInputSha256: params.pack.lockedInputSha256,
  kind: params.kind,
  itemId: params.itemId,
  submissions: params.submissions.map((submission, index) => ({
    reviewerId: submission.reviewerId,
    startedAt: submission.startedAt,
    submittedAt: submission.submittedAt,
    submissionDigest: submission.submissionDigest,
    decision: params.decisions[index],
  })),
  adjudication: params.adjudicationDecision,
  adjudicationDigest: params.adjudication.adjudicationDigest,
  humanReviewAttestation: params.adjudication.humanReviewAttestation,
});

const bundleWithoutDigest = (bundle: Omit<CalibrationHumanReviewBundle, 'bundleDigest'>) => bundle;

export const finalizeCalibrationHumanReview = (params: {
  pack: unknown;
  submissions: readonly unknown[];
  adjudication: unknown;
}): CalibrationHumanReviewBundle => {
  const pack = normalizePack(params.pack);
  const submissions = normalizeSubmissionSet(pack, params.submissions);
  const adjudication = normalizeAdjudication(pack, submissions, params.adjudication);
  const isHuman = pack.sourceEvidence.evidenceOrigin === 'governed_locked_holdout_candidates';
  const evidenceClass = isHuman ? 'human_reviewed_locked_holdout' as const : 'synthetic_contract_fixture' as const;
  const authorizationScope = isHuman ? 'production_candidate' as const : 'test_only_never_publish' as const;
  const reviewerIds = submissions.map((submission) => submission.reviewerId);
  const pairReviewsBySubmission = submissions.map((submission) => new Map(
    submission.pairReviews.map((review) => [review.pairKey, review] as const),
  ));
  const contextualReviewsBySubmission = submissions.map((submission) => new Map(
    submission.contextualReviews.map((review) => [review.sampleId, review] as const),
  ));
  const pairAdjudications = new Map(adjudication.pairAdjudications.map(
    (item) => [item.pairKey, item] as const,
  ));
  const contextualAdjudications = new Map(adjudication.contextualAdjudications.map(
    (item) => [item.sampleId, item] as const,
  ));
  const pairLabels = pack.pairCandidates.map((candidate): TypedRelationshipCalibrationLabelDraft => {
    const final = pairAdjudications.get(candidate.pairKey)
      || invalid('calibration_human_review_pair_adjudication_incomplete');
    const sourceObjectSha256 = itemEvidenceSha({
      pack, submissions, adjudication, kind: 'pair', itemId: candidate.pairKey,
      decisions: pairReviewsBySubmission.map((reviews) => reviews.get(candidate.pairKey)
        || invalid('calibration_human_review_pair_submission_incomplete')),
      adjudicationDecision: final,
    });
    return {
      evaluation: candidate.evaluation,
      pairOutcome: final.pairOutcome,
      edgeAdjudications: final.edgeAdjudications,
      hardNegativeCategory: final.hardNegativeCategory,
      review: buildTypedRelationshipCalibrationReviewReceipt({
        pairKey: candidate.pairKey,
        evaluationDigest: candidate.evaluationDigest,
        pairOutcome: final.pairOutcome,
        edgeAdjudications: final.edgeAdjudications,
        hardNegativeCategory: final.hardNegativeCategory,
        reviewerCohortId: pack.reviewPolicy.pairReviewerCohortId,
        adjudicationPolicyVersion: pack.reviewPolicy.pairAdjudicationPolicyVersion,
        reviewerIds,
        sourceArchiveKey: `calibration-human-review/${pack.packDigest}/pair/${candidate.pairKey.slice(5)}`,
        sourceArchiveVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
        sourceObjectSha256,
      }),
    };
  });
  const contextualLabels = pack.contextualCandidates.map((candidate): ContextualRelationshipCalibrationLabelDraft => {
    const final = contextualAdjudications.get(candidate.sampleId)
      || invalid('calibration_human_review_contextual_adjudication_incomplete');
    const sourceObjectSha256 = itemEvidenceSha({
      pack, submissions, adjudication, kind: 'contextual', itemId: candidate.sampleId,
      decisions: contextualReviewsBySubmission.map((reviews) => reviews.get(candidate.sampleId)
        || invalid('calibration_human_review_contextual_submission_incomplete')),
      adjudicationDecision: final,
    });
    return {
      candidate: candidate.candidate,
      evaluation: candidate.evaluation,
      sourceSnapshotDigest: candidate.sourceSnapshotDigest,
      observationArchiveRecordDigest: candidate.observationArchiveRecordDigest,
      truthLabel: final.truthLabel,
      hardNegativeCategory: final.hardNegativeCategory,
      review: buildContextualRelationshipCalibrationReviewReceipt({
        sampleId: candidate.sampleId,
        evaluationDigest: candidate.evaluationDigest,
        truthLabel: final.truthLabel,
        hardNegativeCategory: final.hardNegativeCategory,
        reviewerCohortId: pack.reviewPolicy.contextualReviewerCohortId,
        adjudicationPolicyVersion: pack.reviewPolicy.contextualAdjudicationPolicyVersion,
        reviewerIds,
        sourceArchiveKey: `calibration-human-review/${pack.packDigest}/context/${candidate.sampleId.slice(27)}`,
        sourceArchiveVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
        sourceObjectSha256,
      }),
    };
  });
  const pairTrustPolicy = buildTypedRelationshipCalibrationTrustPolicy({
    auditPlanDigest: pack.pairAuditPlan.planDigest,
    reviewReceiptSetSha256: typedRelationshipCalibrationReviewSetSha256(
      pairLabels.map((label) => label.review),
    ),
    reviewerCohortId: pack.reviewPolicy.pairReviewerCohortId,
    adjudicationPolicyVersion: pack.reviewPolicy.pairAdjudicationPolicyVersion,
    minimumIndependentReviewers: pack.reviewPolicy.minimumIndependentReviewers,
    evidenceClass,
    authorizationScope,
  });
  const contextualTrustPolicy = buildContextualRelationshipCalibrationTrustPolicy({
    lineageDigest: pack.contextualLineage.lineageDigest,
    auditPlanDigest: pack.contextualAuditPlan.planDigest,
    reviewReceiptSetSha256: contextualRelationshipCalibrationReviewSetSha256(
      contextualLabels.map((label) => label.review),
    ),
    reviewerCohortId: pack.reviewPolicy.contextualReviewerCohortId,
    adjudicationPolicyVersion: pack.reviewPolicy.contextualAdjudicationPolicyVersion,
    minimumIndependentReviewers: pack.reviewPolicy.minimumIndependentReviewers,
    evidenceClass,
    authorizationScope,
  });
  const evidenceSetSha256 = relationshipInputSha256({
    packDigest: pack.packDigest,
    submissionDigests: submissions.map((submission) => submission.submissionDigest),
    adjudicationDigest: adjudication.adjudicationDigest,
    pairReviewReceiptSetSha256: pairTrustPolicy.reviewReceiptSetSha256,
    contextualReviewReceiptSetSha256: contextualTrustPolicy.reviewReceiptSetSha256,
  });
  const withoutDigest: Omit<CalibrationHumanReviewBundle, 'bundleDigest'> = {
    recordType: 'calibration_human_review_bundle',
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
    pack,
    submissions,
    adjudication,
    evidenceClass,
    authorizationScope,
    pairLabels,
    contextualLabels,
    pairTrustPolicy,
    contextualTrustPolicy,
    evidenceSetSha256,
  };
  return { ...withoutDigest, bundleDigest: relationshipInputSha256(bundleWithoutDigest(withoutDigest)) };
};

export const decodeCalibrationHumanReviewBundle = (input: unknown): CalibrationHumanReviewBundle => {
  const value = parseJson(input, 'calibration_human_review_bundle_json_invalid');
  const bundle = exact(value, [
    'recordType', 'schemaVersion', 'pack', 'submissions', 'adjudication', 'evidenceClass',
    'authorizationScope', 'pairLabels', 'contextualLabels', 'pairTrustPolicy',
    'contextualTrustPolicy', 'evidenceSetSha256', 'bundleDigest',
  ], 'calibration_human_review_bundle_invalid');
  if (bundle.recordType !== 'calibration_human_review_bundle'
    || bundle.schemaVersion !== CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION
    || !Array.isArray(bundle.submissions)) invalid('calibration_human_review_bundle_invalid');
  const rebuilt = finalizeCalibrationHumanReview({
    pack: bundle.pack,
    submissions: bundle.submissions,
    adjudication: bundle.adjudication,
  });
  if (!same(rebuilt, value)) invalid('calibration_human_review_bundle_noncanonical');
  return rebuilt;
};

export const serializeCalibrationHumanReviewBundle = (bundleInput: unknown) => (
  `${canonicalizeRelationshipInput(decodeCalibrationHumanReviewBundle(bundleInput))}\n`
);

export const assertCalibrationHumanReviewBundleProductionCandidate = (
  bundleInput: unknown,
) => {
  const bundle = decodeCalibrationHumanReviewBundle(bundleInput);
  if (bundle.evidenceClass !== 'human_reviewed_locked_holdout'
    || bundle.authorizationScope !== 'production_candidate'
    || !bundle.adjudication.humanReviewAttestation) {
    invalid('calibration_human_review_bundle_not_production_candidate');
  }
  return bundle;
};

const buildCalibrationArtifactsFromDecodedHumanReview = (
  bundle: CalibrationHumanReviewBundle,
) => ({
  pairArtifact: buildTypedRelationshipCalibrationArtifact({
    lineage: bundle.pack.pairLineage,
    auditPlan: bundle.pack.pairAuditPlan,
    trustPolicy: bundle.pairTrustPolicy,
    labels: bundle.pairLabels,
  }),
  contextualArtifact: buildContextualRelationshipCalibrationArtifact({
    lineage: bundle.pack.contextualLineage,
    auditPlan: bundle.pack.contextualAuditPlan,
    trustPolicy: bundle.contextualTrustPolicy,
    labels: bundle.contextualLabels,
  }),
});

export const buildCalibrationArtifactsFromHumanReview = (
  bundleInput: unknown,
): {
  pairArtifact: TypedRelationshipCalibrationArtifact;
  contextualArtifact: ContextualRelationshipCalibrationArtifact;
} => {
  const bundle = decodeCalibrationHumanReviewBundle(bundleInput);
  return buildCalibrationArtifactsFromDecodedHumanReview(bundle);
};

export type CalibrationHumanReviewDerivedEvidenceBodies = {
  bundleBody: Buffer;
  pairReceiptBody: Buffer;
  pairArtifactBody: Buffer;
  pairTrustPolicyBody: Buffer;
  contextualReceiptBody: Buffer;
  contextualArtifactBody: Buffer;
  contextualTrustPolicyBody: Buffer;
};

const requireBody = (value: unknown, code: string): Buffer => {
  if (!Buffer.isBuffer(value) || value.byteLength < 2) invalid(code);
  return value;
};

const sameBody = (actual: Buffer, expected: string, code: string) => {
  if (!actual.equals(Buffer.from(expected, 'utf8'))) invalid(code);
};

/**
 * Proves that every calibration byte offered to an execution/publication path
 * was deterministically derived from one exact sealed human-review bundle.
 * Authorization remains separate: callers targeting a real publication must
 * additionally call assertCalibrationHumanReviewBundleProductionCandidate.
 */
export const verifyCalibrationHumanReviewDerivedEvidenceBodies = (
  input: CalibrationHumanReviewDerivedEvidenceBodies,
) => {
  const bundleBody = requireBody(input?.bundleBody,
    'calibration_human_review_derived_bundle_body_invalid');
  const bundle = decodeCalibrationHumanReviewBundle(bundleBody);
  sameBody(bundleBody, `${canonicalizeRelationshipInput(bundle)}\n`,
    'calibration_human_review_derived_bundle_noncanonical');
  const { pairArtifact, contextualArtifact } = buildCalibrationArtifactsFromDecodedHumanReview(bundle);
  const pairReceiptBody = requireBody(input.pairReceiptBody,
    'calibration_human_review_derived_pair_receipt_invalid');
  const pairArtifactBody = requireBody(input.pairArtifactBody,
    'calibration_human_review_derived_pair_artifact_invalid');
  const pairTrustPolicyBody = requireBody(input.pairTrustPolicyBody,
    'calibration_human_review_derived_pair_trust_invalid');
  const contextualReceiptBody = requireBody(input.contextualReceiptBody,
    'calibration_human_review_derived_contextual_receipt_invalid');
  const contextualArtifactBody = requireBody(input.contextualArtifactBody,
    'calibration_human_review_derived_contextual_artifact_invalid');
  const contextualTrustPolicyBody = requireBody(input.contextualTrustPolicyBody,
    'calibration_human_review_derived_contextual_trust_invalid');
  sameBody(pairReceiptBody, serializeTypedRelationshipCalibrationReceipt(pairArtifact.receipt),
    'calibration_human_review_derived_pair_receipt_mismatch');
  sameBody(pairArtifactBody, serializeTypedRelationshipCalibrationArtifact(
    pairArtifact,
    pairArtifact.trustPolicy,
  ),
    'calibration_human_review_derived_pair_artifact_mismatch');
  sameBody(pairTrustPolicyBody, `${canonicalizeRelationshipInput(pairArtifact.trustPolicy)}\n`,
    'calibration_human_review_derived_pair_trust_mismatch');
  sameBody(contextualReceiptBody,
    serializeContextualRelationshipCalibrationReceipt(contextualArtifact.receipt),
    'calibration_human_review_derived_contextual_receipt_mismatch');
  sameBody(contextualArtifactBody,
    serializeContextualRelationshipCalibrationArtifact(
      contextualArtifact,
      contextualArtifact.trustPolicy,
    ),
    'calibration_human_review_derived_contextual_artifact_mismatch');
  sameBody(contextualTrustPolicyBody,
    `${canonicalizeContextualExplanation(contextualArtifact.trustPolicy)}\n`,
    'calibration_human_review_derived_contextual_trust_mismatch');
  return {
    bundle,
    pairArtifact,
    contextualArtifact,
    evidence: {
      bundleDigest: bundle.bundleDigest,
      evidenceSetSha256: bundle.evidenceSetSha256,
      packDigest: bundle.pack.packDigest,
      adjudicationDigest: bundle.adjudication.adjudicationDigest,
      pairReceiptSha256: pairArtifact.receipt.receiptSha256,
      pairArtifactDigest: pairArtifact.artifactDigest,
      pairTrustPolicyDigest: pairArtifact.trustPolicy.trustPolicyDigest,
      contextualReceiptSha256: contextualArtifact.receipt.receiptSha256,
      contextualArtifactDigest: contextualArtifact.artifactDigest,
      contextualTrustPolicyDigest: contextualArtifact.trustPolicy.trustPolicyDigest,
    },
  };
};

export const assertAuthoritativeCalibrationHumanReviewDerivedEvidenceBodies = (
  input: CalibrationHumanReviewDerivedEvidenceBodies,
) => {
  const bundleBody = requireBody(
    input?.bundleBody,
    'calibration_human_review_derived_bundle_body_invalid',
  );
  // This is only an inexpensive declaration precheck. The complete canonical
  // bundle is still rebuilt and validated exactly once below before any claim
  // is trusted or returned.
  const declaration = parseJson(bundleBody, 'calibration_human_review_bundle_json_invalid');
  if (!plain(declaration)
    || declaration.evidenceClass !== 'human_reviewed_locked_holdout'
    || declaration.authorizationScope !== 'production_candidate'
    || !plain(declaration.adjudication)
    || !declaration.adjudication.humanReviewAttestation) {
    invalid('calibration_human_review_bundle_not_production_candidate');
  }
  const verified = verifyCalibrationHumanReviewDerivedEvidenceBodies(input);
  if (verified.bundle.evidenceClass !== 'human_reviewed_locked_holdout'
    || verified.bundle.authorizationScope !== 'production_candidate'
    || !verified.bundle.adjudication.humanReviewAttestation) {
    invalid('calibration_human_review_bundle_not_production_candidate');
  }
  return verified;
};

export type AuthoritativeCalibrationHumanReviewEvidence = ReturnType<
  typeof assertAuthoritativeCalibrationHumanReviewDerivedEvidenceBodies
>['evidence'];

const AUTHORITATIVE_EVIDENCE_CACHE_MAX = 16;
const authoritativeEvidenceCache = new Map<string, AuthoritativeCalibrationHumanReviewEvidence>();
const rawBodySha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

/**
 * Content-addressed fast path for repeated preflight/replay of the same exact
 * immutable evidence bytes. Only the small identity ledger is cached; decoded
 * bundles and artifacts are never retained or returned by reference.
 */
export const getAuthoritativeCalibrationHumanReviewEvidence = (
  input: CalibrationHumanReviewDerivedEvidenceBodies,
): AuthoritativeCalibrationHumanReviewEvidence => {
  const bodies = [
    input?.bundleBody,
    input?.pairReceiptBody,
    input?.pairArtifactBody,
    input?.pairTrustPolicyBody,
    input?.contextualReceiptBody,
    input?.contextualArtifactBody,
    input?.contextualTrustPolicyBody,
  ];
  if (bodies.some((body) => !Buffer.isBuffer(body) || body.byteLength < 2)) {
    invalid('calibration_human_review_derived_body_invalid');
  }
  const cacheKey = relationshipInputSha256({
    schemaVersion: 'calibration-human-review-authoritative-evidence-cache-v1',
    bodySha256: bodies.map((body) => rawBodySha256(body as Buffer)),
  });
  const cached = authoritativeEvidenceCache.get(cacheKey);
  if (cached) return { ...cached };
  const evidence = Object.freeze({
    ...assertAuthoritativeCalibrationHumanReviewDerivedEvidenceBodies(input).evidence,
  });
  if (authoritativeEvidenceCache.size >= AUTHORITATIVE_EVIDENCE_CACHE_MAX) {
    const oldest = authoritativeEvidenceCache.keys().next().value;
    if (typeof oldest === 'string') authoritativeEvidenceCache.delete(oldest);
  }
  authoritativeEvidenceCache.set(cacheKey, evidence);
  return { ...evidence };
};
