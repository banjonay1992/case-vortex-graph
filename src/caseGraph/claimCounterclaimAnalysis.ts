import {
  CASE_GRAPH_CLAIM_DISCIPLINE,
  type AtomicEvidenceClaim,
  type ClaimEvidenceGraphArtifact,
  type ClaimEvidenceLink,
  type ClaimEvidencePublicationBinding,
  type SourceReliabilityAssessment,
  verifyClaimEvidenceGraphArtifact,
} from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CASE_GRAPH_CLAIM_COUNTERCLAIM_ANALYSIS_VERSION =
  'case-graph-claim-counterclaim-analysis-v1' as const;

export const CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE = Object.freeze({
  roleMeaning: 'witness_and_official_are_attribution_roles_not_truth_categories',
  officialStatus: 'official_status_does_not_establish_correctness_or_evidential_priority',
  falseBalance: 'opposed_positions_are_not_assumed_equally_supported',
  supportAccounting: 'only_independent_support_receives_corroboration_credit',
  repetitionAccounting: 'repetition_and_shared_lineage_receive_zero_independent_credit',
  contradictionMeaning: 'contradiction_identifies_a_dispute_and_does_not_resolve_it',
  unansweredQuestions: 'missing_evidence_is_named_and_not_silently_converted_to_a_conclusion',
  conclusionBoundary: 'analysis_preserves_evidence_positions_without_deciding_event_truth',
} as const);

const ADDRESS_PATTERN = /^[a-z][a-z0-9_]*:[^\s]{1,480}$/;
const CLAIM_ID_PATTERN = /^claim:[a-f0-9]{64}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const invalid = (code: string): never => { throw new Error(code); };

export type ClaimCounterclaimCasePlan = {
  caseId: string;
  title: string;
  scopeAddresses: string[];
  focalClaimIds: string[];
  witnessClaimIds: string[];
  officialConclusionClaimIds: string[];
  unresolvedQuestions: Array<{
    question: string;
    relevantClaimIds: string[];
    evidenceNeeded: string[];
    status: 'open' | 'partially_answered';
  }>;
  limitations: string[];
  preparedBy: {
    method: 'deterministic_rule' | 'governed_model' | 'manual_review';
    version: string;
    reviewStatus: 'unreviewed' | 'reviewed' | 'disputed';
  };
};

export type ClaimWithReliability = {
  claim: AtomicEvidenceClaim;
  sourceReliability: SourceReliabilityAssessment | null;
  reliabilityGap: 'source_reliability_assessment_missing' | null;
};

export type ClaimCounterclaimConnection = {
  link: ClaimEvidenceLink;
  from: ClaimWithReliability;
  to: ClaimWithReliability;
  independentCorroborationCredit: boolean;
  accountingExplanation:
    | 'independent_support_counted_once'
    | 'support_retained_without_independent_credit'
    | 'contradiction_requires_review_not_truth_resolution'
    | 'repetition_retained_not_counted_as_corroboration'
    | 'context_retained_not_counted_as_corroboration'
    | 'uncertain_relationship_retained_not_counted_as_corroboration';
};

export type ClaimCounterclaimUnresolvedQuestion = {
  questionId: string;
  question: string;
  relevantClaims: ClaimWithReliability[];
  evidenceNeeded: string[];
  status: 'open' | 'partially_answered';
};

export type ClaimCounterclaimCaseAnalysis = {
  recordType: 'case_graph_claim_counterclaim_analysis';
  schemaVersion: typeof CASE_GRAPH_CLAIM_COUNTERCLAIM_ANALYSIS_VERSION;
  binding: ClaimEvidencePublicationBinding;
  graphArtifactDigest: string;
  caseId: string;
  title: string;
  scopeAddresses: string[];
  focalClaims: ClaimWithReliability[];
  witnessClaims: ClaimWithReliability[];
  officialConclusions: ClaimWithReliability[];
  supportingEvidence: ClaimCounterclaimConnection[];
  contradictions: ClaimCounterclaimConnection[];
  repetitions: ClaimCounterclaimConnection[];
  contextualEvidence: ClaimCounterclaimConnection[];
  uncertainRelationships: ClaimCounterclaimConnection[];
  unresolvedQuestions: ClaimCounterclaimUnresolvedQuestion[];
  accounting: {
    scopedClaimCount: number;
    focalClaimCount: number;
    witnessClaimCount: number;
    officialConclusionCount: number;
    supportingEvidenceCount: number;
    independentSupportCount: number;
    supportWithoutIndependentCreditCount: number;
    contradictionCount: number;
    repetitionCount: number;
    contextualEvidenceCount: number;
    uncertainRelationshipCount: number;
    unresolvedQuestionCount: number;
    missingReliabilityAssessmentCount: number;
  };
  limitations: string[];
  preparedBy: ClaimCounterclaimCasePlan['preparedBy'];
  claimDiscipline: typeof CASE_GRAPH_CLAIM_DISCIPLINE;
  analysisDiscipline: typeof CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE;
  analysisDigest: string;
};

const requireText = (value: unknown, code: string, maximum = 2_000): string => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) {
    invalid(code);
  }
  return value as string;
};

const requireId = (value: unknown, code: string): string => {
  const result = requireText(value, code, 240);
  if (!/^[a-z0-9][a-z0-9._:/-]{0,239}$/.test(result)) invalid(code);
  return result;
};

const requireAddress = (value: unknown): string => {
  const result = requireText(value, 'claim_counterclaim_scope_invalid', 500);
  if (!ADDRESS_PATTERN.test(result)) invalid('claim_counterclaim_scope_invalid');
  return result;
};

const requireClaimId = (value: unknown, code = 'claim_counterclaim_claim_invalid'): string => {
  const result = requireText(value, code, 70);
  if (!CLAIM_ID_PATTERN.test(result)) invalid(code);
  return result;
};

const uniqueSorted = <T>(
  values: T[],
  normalize: (value: T) => string,
  duplicateCode: string,
): string[] => {
  const normalized = values.map(normalize);
  if (new Set(normalized).size !== normalized.length) invalid(duplicateCode);
  return normalized.sort(compareText);
};

const sameBinding = (
  left: ClaimEvidencePublicationBinding,
  right: ClaimEvidencePublicationBinding,
) => canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right);

const connectionExplanation = (
  link: ClaimEvidenceLink,
): ClaimCounterclaimConnection['accountingExplanation'] => {
  if (link.stance === 'supports') {
    return link.lineage === 'independent'
      ? 'independent_support_counted_once'
      : 'support_retained_without_independent_credit';
  }
  if (link.stance === 'contradicts') return 'contradiction_requires_review_not_truth_resolution';
  if (link.stance === 'repeats') return 'repetition_retained_not_counted_as_corroboration';
  if (link.stance === 'contextualizes') return 'context_retained_not_counted_as_corroboration';
  return 'uncertain_relationship_retained_not_counted_as_corroboration';
};

export const buildClaimCounterclaimCaseAnalysis = (params: {
  graph: ClaimEvidenceGraphArtifact;
  plan: ClaimCounterclaimCasePlan;
}): ClaimCounterclaimCaseAnalysis => {
  let graph: ClaimEvidenceGraphArtifact;
  try {
    graph = verifyClaimEvidenceGraphArtifact(params.graph);
  } catch {
    return invalid('claim_counterclaim_graph_integrity_failed');
  }

  const caseId = requireId(params.plan.caseId, 'claim_counterclaim_case_invalid');
  const title = requireText(params.plan.title, 'claim_counterclaim_case_invalid', 500);
  const scopeAddresses = uniqueSorted(
    params.plan.scopeAddresses,
    requireAddress,
    'claim_counterclaim_scope_duplicate',
  );
  if (!scopeAddresses.length) invalid('claim_counterclaim_scope_invalid');

  const focalClaimIds = uniqueSorted(
    params.plan.focalClaimIds,
    (value) => requireClaimId(value),
    'claim_counterclaim_focal_claim_duplicate',
  );
  const witnessClaimIds = uniqueSorted(
    params.plan.witnessClaimIds,
    (value) => requireClaimId(value),
    'claim_counterclaim_witness_claim_duplicate',
  );
  const officialConclusionClaimIds = uniqueSorted(
    params.plan.officialConclusionClaimIds,
    (value) => requireClaimId(value),
    'claim_counterclaim_official_claim_duplicate',
  );
  if (!focalClaimIds.length) invalid('claim_counterclaim_focal_claim_missing');
  if (!witnessClaimIds.length) invalid('claim_counterclaim_witness_claim_missing');
  if (!officialConclusionClaimIds.length) invalid('claim_counterclaim_official_claim_missing');

  const focalIdSet = new Set(focalClaimIds);
  const witnessIdSet = new Set(witnessClaimIds);
  const officialIdSet = new Set(officialConclusionClaimIds);
  if (witnessClaimIds.some((claimId) => officialIdSet.has(claimId))) {
    invalid('claim_counterclaim_role_overlap');
  }
  if (witnessClaimIds.some((claimId) => !focalIdSet.has(claimId))
    || officialConclusionClaimIds.some((claimId) => !focalIdSet.has(claimId))) {
    invalid('claim_counterclaim_role_not_focal');
  }

  const claimsById = new Map(graph.claims.map((claim) => [claim.claimId, claim]));
  const scopeAddressSet = new Set(scopeAddresses);
  const scopedClaims = graph.claims.filter((claim) => scopeAddressSet.has(claim.address));
  const scopedClaimIds = new Set(scopedClaims.map((claim) => claim.claimId));
  for (const claimId of focalClaimIds) {
    if (!claimsById.has(claimId)) invalid('claim_counterclaim_claim_missing');
    if (!scopedClaimIds.has(claimId)) invalid('claim_counterclaim_claim_out_of_scope');
  }

  const reliabilityBySource = new Map<string, SourceReliabilityAssessment>();
  for (const assessment of graph.sourceReliability) {
    const key = `${assessment.address}\u0000${assessment.sourceId}`;
    if (reliabilityBySource.has(key)) invalid('claim_counterclaim_reliability_ambiguous');
    reliabilityBySource.set(key, assessment);
  }

  const resolveClaim = (claimId: string): ClaimWithReliability => {
    const claim = claimsById.get(claimId) ?? invalid('claim_counterclaim_claim_missing');
    const sourceReliability = reliabilityBySource.get(`${claim.address}\u0000${claim.sourceId}`) ?? null;
    return {
      claim,
      sourceReliability,
      reliabilityGap: sourceReliability ? null : 'source_reliability_assessment_missing',
    };
  };

  const connections = graph.links
    .filter((link) => (
      (focalIdSet.has(link.fromClaimId) || focalIdSet.has(link.toClaimId))
      && scopedClaimIds.has(link.fromClaimId)
      && scopedClaimIds.has(link.toClaimId)
    ))
    .map((link): ClaimCounterclaimConnection => ({
      link,
      from: resolveClaim(link.fromClaimId),
      to: resolveClaim(link.toClaimId),
      independentCorroborationCredit: link.stance === 'supports' && link.lineage === 'independent',
      accountingExplanation: connectionExplanation(link),
    }))
    .sort((left, right) => compareText(left.link.linkId, right.link.linkId));

  const supportingEvidence = connections.filter(({ link }) => link.stance === 'supports');
  const contradictions = connections.filter(({ link }) => link.stance === 'contradicts');
  const repetitions = connections.filter(({ link }) => link.stance === 'repeats');
  const contextualEvidence = connections.filter(({ link }) => link.stance === 'contextualizes');
  const uncertainRelationships = connections.filter(({ link }) => link.stance === 'uncertain');

  const unresolvedQuestions = params.plan.unresolvedQuestions.map((question) => {
    const relevantClaimIds = uniqueSorted(
      question.relevantClaimIds,
      (value) => requireClaimId(value, 'claim_counterclaim_question_invalid'),
      'claim_counterclaim_question_claim_duplicate',
    );
    if (!relevantClaimIds.length
      || relevantClaimIds.some((claimId) => !focalIdSet.has(claimId))) {
      invalid('claim_counterclaim_question_claim_invalid');
    }
    const evidenceNeeded = uniqueSorted(
      question.evidenceNeeded,
      (value) => requireText(value, 'claim_counterclaim_question_invalid', 2_000),
      'claim_counterclaim_question_evidence_duplicate',
    );
    if (!evidenceNeeded.length || !['open', 'partially_answered'].includes(question.status)) {
      invalid('claim_counterclaim_question_invalid');
    }
    const core = {
      question: requireText(question.question, 'claim_counterclaim_question_invalid', 2_000),
      relevantClaims: relevantClaimIds.map(resolveClaim),
      evidenceNeeded,
      status: question.status,
    };
    return {
      questionId: `unresolved-question:${relationshipInputSha256({
        binding: graph.binding,
        caseId,
        question: core.question,
        relevantClaimIds,
      })}`,
      ...core,
    };
  }).sort((left, right) => compareText(left.questionId, right.questionId));
  if (new Set(unresolvedQuestions.map(({ questionId }) => questionId)).size !== unresolvedQuestions.length) {
    invalid('claim_counterclaim_question_duplicate');
  }
  if (!unresolvedQuestions.length) invalid('claim_counterclaim_question_missing');

  const preparedBy = {
    method: params.plan.preparedBy.method,
    version: requireId(params.plan.preparedBy.version, 'claim_counterclaim_preparer_invalid'),
    reviewStatus: params.plan.preparedBy.reviewStatus,
  };
  if (!['deterministic_rule', 'governed_model', 'manual_review'].includes(preparedBy.method)
    || !['unreviewed', 'reviewed', 'disputed'].includes(preparedBy.reviewStatus)) {
    invalid('claim_counterclaim_preparer_invalid');
  }
  const limitations = uniqueSorted(
    params.plan.limitations,
    (value) => requireText(value, 'claim_counterclaim_limitation_invalid', 2_000),
    'claim_counterclaim_limitation_duplicate',
  );
  if (!limitations.length) invalid('claim_counterclaim_limitation_missing');
  const focalClaims = focalClaimIds.map(resolveClaim);
  const witnessClaims = focalClaims.filter(({ claim }) => witnessIdSet.has(claim.claimId));
  const officialConclusions = focalClaims.filter(({ claim }) => officialIdSet.has(claim.claimId));
  const involvedClaims = new Map<string, ClaimWithReliability>();
  for (const claim of focalClaims) involvedClaims.set(claim.claim.claimId, claim);
  for (const connection of connections) {
    involvedClaims.set(connection.from.claim.claimId, connection.from);
    involvedClaims.set(connection.to.claim.claimId, connection.to);
  }
  for (const question of unresolvedQuestions) {
    for (const claim of question.relevantClaims) involvedClaims.set(claim.claim.claimId, claim);
  }

  const withoutDigest = {
    recordType: 'case_graph_claim_counterclaim_analysis' as const,
    schemaVersion: CASE_GRAPH_CLAIM_COUNTERCLAIM_ANALYSIS_VERSION,
    binding: { ...graph.binding },
    graphArtifactDigest: graph.artifactDigest,
    caseId,
    title,
    scopeAddresses,
    focalClaims,
    witnessClaims,
    officialConclusions,
    supportingEvidence,
    contradictions,
    repetitions,
    contextualEvidence,
    uncertainRelationships,
    unresolvedQuestions,
    accounting: {
      scopedClaimCount: scopedClaims.length,
      focalClaimCount: focalClaims.length,
      witnessClaimCount: witnessClaims.length,
      officialConclusionCount: officialConclusions.length,
      supportingEvidenceCount: supportingEvidence.length,
      independentSupportCount: supportingEvidence.filter((connection) => connection.independentCorroborationCredit).length,
      supportWithoutIndependentCreditCount: supportingEvidence.filter((connection) => !connection.independentCorroborationCredit).length,
      contradictionCount: contradictions.length,
      repetitionCount: repetitions.length,
      contextualEvidenceCount: contextualEvidence.length,
      uncertainRelationshipCount: uncertainRelationships.length,
      unresolvedQuestionCount: unresolvedQuestions.length,
      missingReliabilityAssessmentCount: [...involvedClaims.values()]
        .filter((claim) => claim.sourceReliability === null).length,
    },
    limitations,
    preparedBy,
    claimDiscipline: CASE_GRAPH_CLAIM_DISCIPLINE,
    analysisDiscipline: CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE,
  };
  return {
    ...withoutDigest,
    analysisDigest: relationshipInputSha256(withoutDigest),
  };
};

export const verifyClaimCounterclaimCaseAnalysis = (params: {
  graph: ClaimEvidenceGraphArtifact;
  analysis: ClaimCounterclaimCaseAnalysis;
}): ClaimCounterclaimCaseAnalysis => {
  const expected = buildClaimCounterclaimCaseAnalysis({
    graph: params.graph,
    plan: {
      caseId: params.analysis.caseId,
      title: params.analysis.title,
      scopeAddresses: params.analysis.scopeAddresses,
      focalClaimIds: params.analysis.focalClaims.map(({ claim }) => claim.claimId),
      witnessClaimIds: params.analysis.witnessClaims.map(({ claim }) => claim.claimId),
      officialConclusionClaimIds: params.analysis.officialConclusions.map(({ claim }) => claim.claimId),
      unresolvedQuestions: params.analysis.unresolvedQuestions.map((question) => ({
        question: question.question,
        relevantClaimIds: question.relevantClaims.map(({ claim }) => claim.claimId),
        evidenceNeeded: question.evidenceNeeded,
        status: question.status,
      })),
      limitations: params.analysis.limitations,
      preparedBy: params.analysis.preparedBy,
    },
  });
  if (!sameBinding(params.analysis.binding, expected.binding)
    || canonicalizeRelationshipInput(params.analysis) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_counterclaim_analysis_integrity_failed');
  }
  return expected;
};
