import {
  CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE,
  buildClaimCounterclaimCaseAnalysis,
  type ClaimCounterclaimCaseAnalysis,
  type ClaimCounterclaimCasePlan,
} from './claimCounterclaimAnalysis';
import {
  CASE_GRAPH_CLAIM_DISCIPLINE,
  verifyClaimEvidenceGraphArtifact,
  type ClaimEvidenceGraphArtifact,
} from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION =
  'case-graph-claim-analysis-adversarial-evaluation-v1' as const;

export const CLAIM_ANALYSIS_ADVERSARIAL_RISKS = [
  'official_authority_truth_substitution',
  'shared_lineage_corroboration_inflation',
  'contradiction_truth_resolution',
  'false_equivalence',
  'uncertainty_erasure',
  'missing_provenance_erasure',
  'unsupported_conclusion',
] as const;

export type ClaimAnalysisAdversarialRisk =
  typeof CLAIM_ANALYSIS_ADVERSARIAL_RISKS[number];

type PerClaimCount = {
  claimId: string;
  count: number;
};

export type ClaimAnalysisAdversarialExpectation = {
  independentSupportByFocalClaim: PerClaimCount[];
  nonIndependentSupportByFocalClaim: PerClaimCount[];
  contradictionCount: number;
  repetitionCount: number;
  uncertainRelationshipCount: number;
  unresolvedFocalClaimIds: string[];
  reliabilityGapClaimIds: string[];
};

export type ClaimAnalysisAdversarialScenario = {
  scenarioId: string;
  risk: ClaimAnalysisAdversarialRisk;
  graph: ClaimEvidenceGraphArtifact;
  plan: ClaimCounterclaimCasePlan;
  expected: ClaimAnalysisAdversarialExpectation;
  rationale: string;
};

export type ClaimAnalysisAdversarialFixture = {
  recordType: 'case_graph_claim_analysis_adversarial_fixture';
  schemaVersion: typeof CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION;
  fixtureId: string;
  fixtureNature: 'synthetic_non_evidential';
  constructionNotice: string;
  scenarios: ClaimAnalysisAdversarialScenario[];
  fixtureDigest: string;
};

export type ClaimAnalysisAdversarialScenarioResult = {
  scenarioId: string;
  risk: ClaimAnalysisAdversarialRisk;
  graphArtifactDigest: string;
  analysisDigest: string;
  passed: boolean;
  violations: string[];
};

export type ClaimAnalysisAdversarialReport = {
  recordType: 'case_graph_claim_analysis_adversarial_report';
  schemaVersion: typeof CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION;
  fixtureId: string;
  fixtureDigest: string;
  scenarioResults: ClaimAnalysisAdversarialScenarioResult[];
  riskCoverage: Record<ClaimAnalysisAdversarialRisk, number>;
  counts: {
    scenarios: number;
    passed: number;
    failed: number;
    violations: number;
  };
  gate: {
    passed: boolean;
    failures: string[];
    requirements: {
      exactScenarioCount: 7;
      everyRiskExactlyOnce: true;
      uniqueGraphPerScenario: true;
      maximumViolations: 0;
    };
  };
  reportDigest: string;
};

const CLAIM_ID_PATTERN = /^claim:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const invalid = (code: string): never => { throw new Error(code); };

const requireText = (value: unknown, code: string, maximum = 2_000): string => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) {
    invalid(code);
  }
  return value as string;
};

const requireId = (value: unknown, code: string) => {
  const result = requireText(value, code, 240);
  if (!ID_PATTERN.test(result)) invalid(code);
  return result;
};

const requireClaimId = (value: unknown) => {
  const result = requireText(value, 'claim_analysis_adversarial_expectation_invalid', 70);
  if (!CLAIM_ID_PATTERN.test(result)) invalid('claim_analysis_adversarial_expectation_invalid');
  return result;
};

const requireCount = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid('claim_analysis_adversarial_expectation_invalid');
  }
  return Number(value);
};

const uniqueSortedClaimIds = (values: string[]) => {
  const result = values.map(requireClaimId).sort(compareText);
  if (new Set(result).size !== result.length) {
    invalid('claim_analysis_adversarial_expectation_duplicate');
  }
  return result;
};

const normalizePerClaimCounts = (
  values: PerClaimCount[],
  focalClaimIds: string[],
): PerClaimCount[] => {
  const normalized = values.map((item) => ({
    claimId: requireClaimId(item.claimId),
    count: requireCount(item.count),
  })).sort((left, right) => compareText(left.claimId, right.claimId));
  if (new Set(normalized.map(({ claimId }) => claimId)).size !== normalized.length
    || canonicalizeRelationshipInput(normalized.map(({ claimId }) => claimId))
      !== canonicalizeRelationshipInput([...focalClaimIds].sort(compareText))) {
    invalid('claim_analysis_adversarial_focal_accounting_invalid');
  }
  return normalized;
};

const normalizeExpectation = (
  value: ClaimAnalysisAdversarialExpectation,
  focalClaimIds: string[],
): ClaimAnalysisAdversarialExpectation => ({
  independentSupportByFocalClaim: normalizePerClaimCounts(
    value.independentSupportByFocalClaim,
    focalClaimIds,
  ),
  nonIndependentSupportByFocalClaim: normalizePerClaimCounts(
    value.nonIndependentSupportByFocalClaim,
    focalClaimIds,
  ),
  contradictionCount: requireCount(value.contradictionCount),
  repetitionCount: requireCount(value.repetitionCount),
  uncertainRelationshipCount: requireCount(value.uncertainRelationshipCount),
  unresolvedFocalClaimIds: uniqueSortedClaimIds(value.unresolvedFocalClaimIds),
  reliabilityGapClaimIds: uniqueSortedClaimIds(value.reliabilityGapClaimIds),
});

export const buildClaimAnalysisAdversarialFixture = (params: {
  fixtureId: string;
  constructionNotice: string;
  scenarios: ClaimAnalysisAdversarialScenario[];
}): ClaimAnalysisAdversarialFixture => {
  if (!params.constructionNotice.toLowerCase().includes('synthetic')
    || !params.constructionNotice.toLowerCase().includes('non-evidential')) {
    invalid('claim_analysis_adversarial_notice_invalid');
  }
  const scenarios = params.scenarios.map((draft) => {
    if (!CLAIM_ANALYSIS_ADVERSARIAL_RISKS.includes(draft.risk)) {
      invalid('claim_analysis_adversarial_risk_invalid');
    }
    const graph = verifyClaimEvidenceGraphArtifact(draft.graph);
    const analysis = buildClaimCounterclaimCaseAnalysis({ graph, plan: draft.plan });
    const focalClaimIds = analysis.focalClaims.map(({ claim }) => claim.claimId);
    return {
      scenarioId: requireId(draft.scenarioId, 'claim_analysis_adversarial_scenario_invalid'),
      risk: draft.risk,
      graph,
      plan: draft.plan,
      expected: normalizeExpectation(draft.expected, focalClaimIds),
      rationale: requireText(draft.rationale, 'claim_analysis_adversarial_scenario_invalid'),
    };
  }).sort((left, right) => compareText(left.scenarioId, right.scenarioId));
  if (scenarios.length !== CLAIM_ANALYSIS_ADVERSARIAL_RISKS.length
    || new Set(scenarios.map(({ scenarioId }) => scenarioId)).size !== scenarios.length
    || new Set(scenarios.map(({ graph }) => graph.artifactDigest)).size !== scenarios.length) {
    invalid('claim_analysis_adversarial_scenario_coverage_invalid');
  }
  for (const risk of CLAIM_ANALYSIS_ADVERSARIAL_RISKS) {
    if (scenarios.filter((scenario) => scenario.risk === risk).length !== 1) {
      invalid('claim_analysis_adversarial_risk_coverage_invalid');
    }
  }
  const withoutDigest = {
    recordType: 'case_graph_claim_analysis_adversarial_fixture' as const,
    schemaVersion: CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION,
    fixtureId: requireId(params.fixtureId, 'claim_analysis_adversarial_fixture_invalid'),
    fixtureNature: 'synthetic_non_evidential' as const,
    constructionNotice: requireText(
      params.constructionNotice,
      'claim_analysis_adversarial_notice_invalid',
    ),
    scenarios,
  };
  return { ...withoutDigest, fixtureDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyClaimAnalysisAdversarialFixture = (
  value: ClaimAnalysisAdversarialFixture,
): ClaimAnalysisAdversarialFixture => {
  const expected = buildClaimAnalysisAdversarialFixture(value);
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_analysis_adversarial_fixture_integrity_failed');
  }
  return expected;
};

const countSupportByFocalClaim = (
  analysis: ClaimCounterclaimCaseAnalysis,
  independent: boolean,
): PerClaimCount[] => analysis.focalClaims.map(({ claim }) => ({
  claimId: claim.claimId,
  count: analysis.supportingEvidence.filter((connection) => (
    connection.to.claim.claimId === claim.claimId
    && connection.independentCorroborationCredit === independent
  )).length,
})).sort((left, right) => compareText(left.claimId, right.claimId));

const involvedReliabilityGaps = (analysis: ClaimCounterclaimCaseAnalysis) => {
  const claims = [
    ...analysis.focalClaims,
    ...analysis.supportingEvidence.flatMap(({ from, to }) => [from, to]),
    ...analysis.contradictions.flatMap(({ from, to }) => [from, to]),
    ...analysis.repetitions.flatMap(({ from, to }) => [from, to]),
    ...analysis.contextualEvidence.flatMap(({ from, to }) => [from, to]),
    ...analysis.uncertainRelationships.flatMap(({ from, to }) => [from, to]),
    ...analysis.unresolvedQuestions.flatMap(({ relevantClaims }) => relevantClaims),
  ];
  return [...new Set(claims
    .filter(({ reliabilityGap }) => reliabilityGap !== null)
    .map(({ claim }) => claim.claimId))].sort(compareText);
};

const unresolvedFocalClaims = (analysis: ClaimCounterclaimCaseAnalysis) => {
  const focal = new Set(analysis.focalClaims.map(({ claim }) => claim.claimId));
  return [...new Set(analysis.unresolvedQuestions.flatMap(({ relevantClaims }) => (
    relevantClaims.map(({ claim }) => claim.claimId).filter((claimId) => focal.has(claimId))
  )))].sort(compareText);
};

const hasProhibitedConclusionKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasProhibitedConclusionKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    ['truthVerdict', 'winnerClaimId', 'resolvedTruth', 'preferredRole'].includes(key)
    || hasProhibitedConclusionKey(nested)
  ));
};

const evaluateScenario = (
  scenario: ClaimAnalysisAdversarialScenario,
): ClaimAnalysisAdversarialScenarioResult => {
  const analysis = buildClaimCounterclaimCaseAnalysis({
    graph: scenario.graph,
    plan: scenario.plan,
  });
  const violations: string[] = [];
  const expected = scenario.expected;
  const expectEqual = (name: string, actual: unknown, wanted: unknown) => {
    if (canonicalizeRelationshipInput(actual) !== canonicalizeRelationshipInput(wanted)) {
      violations.push(`${name}_mismatch`);
    }
  };
  expectEqual(
    'independent_support_by_focal_claim',
    countSupportByFocalClaim(analysis, true),
    expected.independentSupportByFocalClaim,
  );
  expectEqual(
    'non_independent_support_by_focal_claim',
    countSupportByFocalClaim(analysis, false),
    expected.nonIndependentSupportByFocalClaim,
  );
  expectEqual('contradiction_count', analysis.accounting.contradictionCount, expected.contradictionCount);
  expectEqual('repetition_count', analysis.accounting.repetitionCount, expected.repetitionCount);
  expectEqual(
    'uncertain_relationship_count',
    analysis.accounting.uncertainRelationshipCount,
    expected.uncertainRelationshipCount,
  );
  expectEqual('unresolved_focal_claims', unresolvedFocalClaims(analysis), expected.unresolvedFocalClaimIds);
  expectEqual('reliability_gap_claims', involvedReliabilityGaps(analysis), expected.reliabilityGapClaimIds);

  if (analysis.claimDiscipline !== CASE_GRAPH_CLAIM_DISCIPLINE
    || analysis.analysisDiscipline !== CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE
    || hasProhibitedConclusionKey(analysis)) {
    violations.push('truth_or_role_priority_boundary_failed');
  }
  if (analysis.supportingEvidence.some((connection) => (
    connection.independentCorroborationCredit !== (
      connection.link.lineage === 'independent'
    )
  ))) violations.push('support_lineage_accounting_failed');
  if (analysis.contradictions.some((connection) => (
    connection.independentCorroborationCredit
    || connection.accountingExplanation !== 'contradiction_requires_review_not_truth_resolution'
  ))) violations.push('contradiction_resolution_boundary_failed');
  if (analysis.repetitions.some((connection) => (
    connection.independentCorroborationCredit
    || connection.accountingExplanation !== 'repetition_retained_not_counted_as_corroboration'
  ))) violations.push('repetition_corroboration_boundary_failed');

  if (scenario.risk === 'official_authority_truth_substitution'
    && (!analysis.officialConclusions.length
      || analysis.analysisDiscipline.officialStatus
        !== 'official_status_does_not_establish_correctness_or_evidential_priority')) {
    violations.push('official_authority_boundary_not_exercised');
  }
  if (scenario.risk === 'shared_lineage_corroboration_inflation'
    && !analysis.supportingEvidence.some(({ link }) => link.lineage !== 'independent')
    && !analysis.repetitions.length) {
    violations.push('shared_lineage_risk_not_exercised');
  }
  if (scenario.risk === 'contradiction_truth_resolution' && !analysis.contradictions.length) {
    violations.push('contradiction_risk_not_exercised');
  }
  if (scenario.risk === 'false_equivalence') {
    const counts = countSupportByFocalClaim(analysis, true).map(({ count }) => count);
    if (new Set(counts).size < 2) violations.push('false_equivalence_risk_not_exercised');
  }
  if (scenario.risk === 'uncertainty_erasure'
    && (!analysis.uncertainRelationships.length || !analysis.unresolvedQuestions.length)) {
    violations.push('uncertainty_risk_not_exercised');
  }
  if (scenario.risk === 'missing_provenance_erasure'
    && analysis.accounting.missingReliabilityAssessmentCount < 1) {
    violations.push('missing_provenance_risk_not_exercised');
  }
  if (scenario.risk === 'unsupported_conclusion') {
    const unsupported = countSupportByFocalClaim(analysis, true)
      .filter(({ count }) => count === 0)
      .map(({ claimId }) => claimId);
    const unresolved = new Set(unresolvedFocalClaims(analysis));
    if (!unsupported.some((claimId) => unresolved.has(claimId))) {
      violations.push('unsupported_conclusion_risk_not_exercised');
    }
  }

  return {
    scenarioId: scenario.scenarioId,
    risk: scenario.risk,
    graphArtifactDigest: scenario.graph.artifactDigest,
    analysisDigest: analysis.analysisDigest,
    passed: violations.length === 0,
    violations: [...new Set(violations)].sort(compareText),
  };
};

export const evaluateClaimAnalysisAdversarialFixture = (
  value: ClaimAnalysisAdversarialFixture,
): ClaimAnalysisAdversarialReport => {
  const fixture = verifyClaimAnalysisAdversarialFixture(value);
  const scenarioResults = fixture.scenarios.map(evaluateScenario);
  const riskCoverage = Object.fromEntries(CLAIM_ANALYSIS_ADVERSARIAL_RISKS.map((risk) => [
    risk,
    scenarioResults.filter((result) => result.risk === risk && result.passed).length,
  ])) as Record<ClaimAnalysisAdversarialRisk, number>;
  const failures = scenarioResults
    .filter(({ passed }) => !passed)
    .map(({ scenarioId }) => `scenario_failed:${scenarioId}`);
  for (const risk of CLAIM_ANALYSIS_ADVERSARIAL_RISKS) {
    if (riskCoverage[risk] !== 1) failures.push(`risk_not_passed:${risk}`);
  }
  const violationCount = scenarioResults.reduce(
    (total, result) => total + result.violations.length,
    0,
  );
  if (violationCount) failures.push('adversarial_violations_present');
  const withoutDigest = {
    recordType: 'case_graph_claim_analysis_adversarial_report' as const,
    schemaVersion: CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION,
    fixtureId: fixture.fixtureId,
    fixtureDigest: fixture.fixtureDigest,
    scenarioResults,
    riskCoverage,
    counts: {
      scenarios: scenarioResults.length,
      passed: scenarioResults.filter(({ passed }) => passed).length,
      failed: scenarioResults.filter(({ passed }) => !passed).length,
      violations: violationCount,
    },
    gate: {
      passed: failures.length === 0,
      failures,
      requirements: {
        exactScenarioCount: 7 as const,
        everyRiskExactlyOnce: true as const,
        uniqueGraphPerScenario: true as const,
        maximumViolations: 0 as const,
      },
    },
  };
  return { ...withoutDigest, reportDigest: relationshipInputSha256(withoutDigest) };
};
