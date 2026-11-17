import { relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  sealCaseVortexInvestigatorStudyAdjudications,
  type CaseVortexInvestigatorStudyPlan,
} from './investigatorStudyPlan';

export const CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION =
  'case-vortex-investigator-usefulness-v3' as const;

export const CASE_VORTEX_INVESTIGATOR_JOURNEYS = [
  'exact_record_find',
  'event_reconstruction',
  'provenance_and_circular_reporting',
  'contextual_explanation_review',
  'versioned_fact_comparison',
  'pattern_and_base_rate_audit',
  'connection_receipt_inspection',
  'media_lineage',
  'contradiction_and_open_question_review',
  'reproducible_research_packet',
] as const;

export type CaseVortexInvestigatorJourney =
  typeof CASE_VORTEX_INVESTIGATOR_JOURNEYS[number];

export const CASE_VORTEX_INVESTIGATOR_CAPABILITIES = [
  'claim_graph',
  'source_reliability',
  'claim_counterclaim',
  'similar_cases',
  'investigation_workspace',
  'external_correlations',
  'precise_source_locators',
  'explainable_orb_trace',
  'living_dossier',
  'reproducible_report',
] as const;

export type CaseVortexInvestigatorCapability =
  typeof CASE_VORTEX_INVESTIGATOR_CAPABILITIES[number];

export const CASE_VORTEX_INVESTIGATOR_CLAIM_GATE = Object.freeze({
  requiredStudyPlanSlots: 200,
  requiredDistinctEvidenceArtifacts: 1_400,
  minimumReviewedQueries: 200,
  minimumSourceReconstructions: 50,
  minimumQueriesPerJourney: 10,
  minimumIndependentReviewers: 2,
  minimumAuditedCitations: 200,
  minimumAuditedMaterialClaims: 200,
  minimumExpectedRelevantRecords: 200,
  minimumAuditedCapabilityChecks: 200,
  minimumReproducibleObservations: 200,
  minimumComparisonRuns: 400,
  minimumJourneysWithSurfaceProof: 10,
  minimumJourneysWithComparisonProof: 10,
  maximumFabricatedIdentifiers: 0,
  maximumUnsupportedExhaustiveClaims: 0,
  maximumMisleadingReviewOutcomes: 0,
  minimumCitationResolutionRate: 1,
  minimumQuoteVerificationRate: 1,
  minimumMaterialClaimCitationSupportRate: 0.98,
  minimumRecallAt20: 0.95,
  maximumP95FirstResultMs: 2_000,
  minimumReconstructionSuccessRate: 1,
  minimumCapabilitySatisfactionRate: 0.98,
  minimumCorrectReviewRate: 0.98,
  minimumUsefulReviewRate: 0.95,
  minimumIndependentCompletionRate: 0.9,
  minimumPacketReplayRate: 1,
  minimumComparisonWinRate: 0.8,
} as const);

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_QUESTION_LENGTH = 4_000;
const MAX_SOURCE_LOCATOR_LENGTH = 2_000;
const MAX_OBSERVATIONS = 100_000;

export type CaseVortexBenchmarkPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexBenchmarkCitationObservation = {
  citationId: string;
  sourceLocator: string;
  resolvable: boolean;
  quoted: boolean;
  quoteVerified: boolean;
};

export type CaseVortexBenchmarkClaimObservation = {
  claimId: string;
  material: boolean;
  citationIds: string[];
};

export type CaseVortexBenchmarkReconstructionObservation = {
  sourceLocatorResolved: boolean;
  evidenceChainReproduced: boolean;
};

export type CaseVortexBenchmarkSurfaceProof = {
  orb: boolean;
  keyboard: boolean;
  luna: boolean;
  mobile: boolean;
  reducedMotion: boolean;
  artifactSha256: string;
};

export type CaseVortexBenchmarkReviewOutcome = {
  correct: boolean;
  useful: boolean;
  misleading: boolean;
  completedWithoutDeveloperHelp: boolean;
  reviewReceiptSha256: string;
};

export type CaseVortexBenchmarkEvidenceProof = {
  publicationBound: boolean;
  toolTraceSha256: string;
  packetSha256: string;
  packetReplayed: boolean;
  counterevidenceRetained: boolean;
  missingnessDisclosed: boolean;
};

export type CaseVortexBenchmarkComparisonRun = {
  tool: 'direct_archive' | 'generic_model';
  completed: boolean;
  equivalentPublicMaterial: boolean;
  timeToAnswerMs: number;
  manualSourceSwitches: number;
  auditTrailScore: number;
  toolName: string;
  toolVersion: string;
  resultSha256: string;
};

export type CaseVortexBenchmarkObservation = {
  observationId: string;
  studySlotId: string;
  queryId: string;
  journey: CaseVortexInvestigatorJourney;
  question: string;
  reviewerIdHash: string;
  expectedRelevantAddresses: string[];
  returnedTop20Addresses: string[];
  firstResultMs: number;
  fabricatedIdentifiers: string[];
  unsupportedExhaustiveClaims: string[];
  requiredCapabilities: CaseVortexInvestigatorCapability[];
  satisfiedCapabilities: CaseVortexInvestigatorCapability[];
  citations: CaseVortexBenchmarkCitationObservation[];
  claims: CaseVortexBenchmarkClaimObservation[];
  reconstruction: CaseVortexBenchmarkReconstructionObservation | null;
  surfaceProof: CaseVortexBenchmarkSurfaceProof;
  reviewOutcome: CaseVortexBenchmarkReviewOutcome;
  evidenceProof: CaseVortexBenchmarkEvidenceProof;
  productManualSourceSwitches: number;
  productAuditTrailScore: number;
  comparisonRuns: CaseVortexBenchmarkComparisonRun[];
};

export type CaseVortexInvestigatorBenchmarkInput = {
  recordType: 'case_vortex_investigator_benchmark_input';
  schemaVersion: typeof CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION;
  benchmarkId: string;
  completedAt: string;
  publication: CaseVortexBenchmarkPublication;
  studyPlan: CaseVortexInvestigatorStudyPlan;
  observations: CaseVortexBenchmarkObservation[];
};

export type CaseVortexInvestigatorBenchmarkCriterion = {
  criterion: string;
  comparator: '>=' | '<=' | '=';
  threshold: number;
  actual: number;
  passed: boolean;
};

export type CaseVortexInvestigatorJourneyMetrics = {
  journey: CaseVortexInvestigatorJourney;
  queryCount: number;
  independentReviewerCount: number;
  expectedRelevantCount: number;
  relevantReturnedAt20Count: number;
  recallAt20: number;
};

export type CaseVortexInvestigatorBenchmarkReport = {
  recordType: 'case_vortex_investigator_benchmark_report';
  schemaVersion: typeof CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION;
  benchmarkId: string;
  completedAt: string;
  publication: CaseVortexBenchmarkPublication;
  studyPlan: { planId: string; planSha256: string };
  gatePolicy: typeof CASE_VORTEX_INVESTIGATOR_CLAIM_GATE;
  accounting: {
    reviewedQueryCount: number;
    reviewObservationCount: number;
    studyPlanSlotCount: number;
    distinctEvidenceArtifactCount: number;
    sourceReconstructionCount: number;
    independentReviewerCount: number;
    fabricatedIdentifierCount: number;
    unsupportedExhaustiveClaimCount: number;
    requiredCapabilityCheckCount: number;
    satisfiedCapabilityCheckCount: number;
    citationCount: number;
    resolvedCitationCount: number;
    quotedCitationCount: number;
    verifiedQuoteCount: number;
    materialClaimCount: number;
    citationSupportedMaterialClaimCount: number;
    expectedRelevantCount: number;
    relevantReturnedAt20Count: number;
    successfulReconstructionCount: number;
    reproducibleObservationCount: number;
    correctReviewCount: number;
    usefulReviewCount: number;
    misleadingReviewCount: number;
    independentCompletionCount: number;
    comparisonRunCount: number;
    comparisonWinCount: number;
    journeysWithSurfaceProof: number;
    journeysWithComparisonProof: number;
  };
  metrics: {
    citationResolutionRate: number;
    quoteVerificationRate: number;
    materialClaimCitationSupportRate: number;
    recallAt20: number;
    p95FirstResultMs: number;
    reconstructionSuccessRate: number;
    capabilitySatisfactionRate: number;
    correctReviewRate: number;
    usefulReviewRate: number;
    independentCompletionRate: number;
    packetReplayRate: number;
    comparisonWinRate: number;
  };
  journeys: CaseVortexInvestigatorJourneyMetrics[];
  criteria: CaseVortexInvestigatorBenchmarkCriterion[];
  eligibleForBestAvailableClaim: boolean;
  limitations: string[];
  reportSha256: string;
};

const invalid = (code: string): never => {
  throw new Error(code);
};

const nonEmpty = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const stringValue = value as string;
  const trimmed = stringValue.trim();
  if (!trimmed || stringValue.length > maximum) invalid(code);
  return trimmed;
};

const finiteNonNegative = (value: unknown, code: string) => {
  if (typeof value !== 'number') invalid(code);
  const numberValue = value as number;
  if (!Number.isFinite(numberValue) || numberValue < 0) invalid(code);
  return numberValue;
};

const boundedInteger = (value: unknown, maximum: number, code: string) => {
  const numberValue = finiteNonNegative(value, code);
  if (!Number.isSafeInteger(numberValue) || numberValue > maximum) invalid(code);
  return numberValue;
};

const exactKeys = (value: object, keys: readonly string[], code: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
};

const uniqueSortedStrings = (
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  code: string,
) => {
  if (!Array.isArray(value)) invalid(code);
  const arrayValue = value as unknown[];
  if (arrayValue.length > maximumItems) invalid(code);
  const result = arrayValue.map((entry) => nonEmpty(entry, maximumLength, code)).sort();
  if (new Set(result).size !== result.length) invalid(code);
  return result;
};

const ratio = (numerator: number, denominator: number) => (
  denominator === 0 ? 1 : numerator / denominator
);

const compareText = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);

const p95 = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
};

const validatePublication = (value: CaseVortexBenchmarkPublication) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('case_vortex_investigator_benchmark_publication_invalid');
  }
  exactKeys(value, ['publicationId', 'corpusVersion', 'manifestSha256'],
    'case_vortex_investigator_benchmark_publication_invalid');
  const manifestSha256 = nonEmpty(value.manifestSha256, 64,
    'case_vortex_investigator_benchmark_publication_invalid').toLowerCase();
  if (!SHA256.test(manifestSha256)) invalid('case_vortex_investigator_benchmark_publication_invalid');
  return {
    publicationId: nonEmpty(value.publicationId, 200,
      'case_vortex_investigator_benchmark_publication_invalid'),
    corpusVersion: nonEmpty(value.corpusVersion, 200,
      'case_vortex_investigator_benchmark_publication_invalid'),
    manifestSha256,
  };
};

const STUDY_PLAN_VERSION = 'case-vortex-investigator-study-plan-v2';
const STUDY_STRATA = [
  'known_positive',
  'ambiguous_or_alias',
  'hard_negative',
  'missing_data',
  'counterevidence_or_dispute',
] as const;
const STUDY_SURFACES = ['orb', 'keyboard', 'luna', 'mobile', 'reduced_motion'] as const;
const STUDY_COMPARISONS = ['direct_archive', 'generic_model'] as const;

const validateStudyPlan = (value: CaseVortexInvestigatorStudyPlan) => {
  const code = 'case_vortex_investigator_benchmark_study_plan_invalid';
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  exactKeys(value, [
    'recordType', 'schemaVersion', 'planId', 'publication', 'frozenAt', 'adjudicatorIdHash', 'policy', 'accounting',
    'safeguards', 'slots', 'planSha256',
  ], code);
  const planSha256 = nonEmpty(value.planSha256, 64, code).toLowerCase();
  if (!SHA256.test(planSha256)) invalid(code);
  if (!value.policy || typeof value.policy !== 'object' || Array.isArray(value.policy)
    || !value.accounting || typeof value.accounting !== 'object' || Array.isArray(value.accounting)
    || !value.safeguards || typeof value.safeguards !== 'object' || Array.isArray(value.safeguards)) {
    invalid(code);
  }
  try {
    validatePublication(value.publication);
  } catch {
    invalid(code);
  }
  const frozenAt = nonEmpty(value.frozenAt, 40, code);
  const adjudicatorIdHash = nonEmpty(value.adjudicatorIdHash, 64, code).toLowerCase();
  let normalizedFrozenAt = '';
  try { normalizedFrozenAt = new Date(frozenAt).toISOString(); }
  catch { invalid(code); }
  if (normalizedFrozenAt !== frozenAt || !SHA256.test(adjudicatorIdHash)) invalid(code);
  const { planSha256: _claimedDigest, ...withoutDigest } = value;
  if (relationshipInputSha256(withoutDigest) !== planSha256
    || value.recordType !== 'case_vortex_investigator_study_plan'
    || value.schemaVersion !== STUDY_PLAN_VERSION
    || relationshipInputSha256(value.policy) !== relationshipInputSha256(CASE_VORTEX_INVESTIGATOR_CLAIM_GATE)) {
    invalid(code);
  }
  exactKeys(value.accounting, [
    'querySlotCount', 'sourceReconstructionSlotCount', 'slotsPerJourney',
    'slotsPerStratumPerJourney', 'reviewerLaneCount',
  ], code);
  if (value.accounting.querySlotCount !== 200
    || value.accounting.sourceReconstructionSlotCount !== 50
    || value.accounting.slotsPerJourney !== 20
    || value.accounting.slotsPerStratumPerJourney !== 4
    || value.accounting.reviewerLaneCount !== 2) invalid(code);
  exactKeys(value.safeguards, [
    'syntheticAnswersAllowed', 'fixtureEvidenceCountsAsHumanReview',
    'publicationMutationAllowed', 'networkCallsDuringGeneration', 'lunaCallsDuringGeneration',
  ], code);
  if (value.safeguards.syntheticAnswersAllowed !== false
    || value.safeguards.fixtureEvidenceCountsAsHumanReview !== false
    || value.safeguards.publicationMutationAllowed !== false
    || value.safeguards.networkCallsDuringGeneration !== 0
    || value.safeguards.lunaCallsDuringGeneration !== 0
    || !Array.isArray(value.slots)
    || value.slots.length !== 200) invalid(code);

  const slotIds = new Set<string>();
  const queryIds = new Set<string>();
  const normalizedQuestions = new Set<string>();
  const adjudicationReceipts = new Set<string>();
  let expectedAdjudicationReceipts: Map<string, string>;
  try {
    expectedAdjudicationReceipts = new Map(sealCaseVortexInvestigatorStudyAdjudications({
      plan: value,
      frozenAt,
      adjudicatorIdHash,
      adjudications: value.slots.map((slot) => ({
        slotId: slot.slotId,
        question: slot.question || '',
        expectedRelevantAddresses: slot.expectedRelevantAddresses,
      })),
    }).map((adjudication) => [adjudication.slotId, adjudication.adjudicationReceiptSha256]));
  } catch {
    invalid(code);
  }
  value.slots.forEach((slot) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) invalid(code);
    exactKeys(slot, [
      'slotId', 'queryId', 'journey', 'stratum', 'reviewerLane',
      'requiresSourceReconstruction', 'requiredCapabilities', 'requiredSurfaces',
      'requiredComparisons', 'adjudicationGuidance', 'question',
      'expectedRelevantAddresses', 'adjudicationStatus', 'adjudicationReceiptSha256',
    ], code);
    const slotId = nonEmpty(slot.slotId, 200, code);
    const queryId = nonEmpty(slot.queryId, 200, code);
    if (slotIds.has(slotId) || queryIds.has(queryId)
      || !CASE_VORTEX_INVESTIGATOR_JOURNEYS.includes(slot.journey)
      || !STUDY_STRATA.includes(slot.stratum)
      || !['reviewer_a', 'reviewer_b'].includes(slot.reviewerLane)
      || typeof slot.requiresSourceReconstruction !== 'boolean'
      || !Array.isArray(slot.requiredSurfaces)
      || !Array.isArray(slot.requiredComparisons)
      || !Array.isArray(slot.expectedRelevantAddresses)
      || slot.expectedRelevantAddresses.length > 10_000
      || slot.adjudicationStatus !== 'frozen') invalid(code);
    const question = nonEmpty(slot.question, MAX_QUESTION_LENGTH, code);
    const expectedRelevantAddresses = uniqueSortedStrings(
      slot.expectedRelevantAddresses, 10_000, 512, code,
    );
    if (expectedRelevantAddresses.some((address) => !/^(sighting|document|photo|video):[^\s:][^\r\n]{0,510}$/u.test(address))) {
      invalid(code);
    }
    const adjudicationReceipt = nonEmpty(slot.adjudicationReceiptSha256, 64, code).toLowerCase();
    const normalizedQuestion = `${slot.journey}:${question.toLocaleLowerCase('en').replace(/\s+/gu, ' ')}`;
    if (!SHA256.test(adjudicationReceipt)
      || adjudicationReceipt !== expectedAdjudicationReceipts.get(slotId)
      || adjudicationReceipts.has(adjudicationReceipt)
      || normalizedQuestions.has(normalizedQuestion)) invalid(code);
    adjudicationReceipts.add(adjudicationReceipt);
    normalizedQuestions.add(normalizedQuestion);
    slotIds.add(slotId);
    queryIds.add(queryId);
    const capabilities = uniqueSortedStrings(slot.requiredCapabilities, 10, 100, code);
    if (!capabilities.length
      || capabilities.some((capability) => !CASE_VORTEX_INVESTIGATOR_CAPABILITIES.includes(
        capability as CaseVortexInvestigatorCapability,
      ))
      || relationshipInputSha256([...slot.requiredSurfaces].sort())
        !== relationshipInputSha256([...STUDY_SURFACES].sort())
      || relationshipInputSha256([...slot.requiredComparisons].sort())
        !== relationshipInputSha256([...STUDY_COMPARISONS].sort())) invalid(code);
    nonEmpty(slot.adjudicationGuidance, 2_000, code);
  });
  for (const journey of CASE_VORTEX_INVESTIGATOR_JOURNEYS) {
    const journeySlots = value.slots.filter((slot) => slot.journey === journey);
    if (journeySlots.length !== 20
      || new Set(journeySlots.map(({ reviewerLane }) => reviewerLane)).size !== 2
      || STUDY_STRATA.some((stratum) => (
        journeySlots.filter((slot) => slot.stratum === stratum).length !== 4
      ))) invalid(code);
  }
  if (value.slots.filter(({ requiresSourceReconstruction }) => requiresSourceReconstruction).length !== 50) {
    invalid(code);
  }
  return { ...value, planSha256 };
};

const validateCitation = (value: CaseVortexBenchmarkCitationObservation) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('case_vortex_investigator_benchmark_citation_invalid');
  }
  exactKeys(value, ['citationId', 'sourceLocator', 'resolvable', 'quoted', 'quoteVerified'],
    'case_vortex_investigator_benchmark_citation_invalid');
  if (typeof value.resolvable !== 'boolean'
    || typeof value.quoted !== 'boolean'
    || typeof value.quoteVerified !== 'boolean'
    || (!value.quoted && value.quoteVerified)) {
    invalid('case_vortex_investigator_benchmark_citation_invalid');
  }
  return {
    citationId: nonEmpty(value.citationId, 200,
      'case_vortex_investigator_benchmark_citation_invalid'),
    sourceLocator: nonEmpty(value.sourceLocator, MAX_SOURCE_LOCATOR_LENGTH,
      'case_vortex_investigator_benchmark_citation_invalid'),
    resolvable: value.resolvable,
    quoted: value.quoted,
    quoteVerified: value.quoteVerified,
  };
};

const validateClaim = (value: CaseVortexBenchmarkClaimObservation) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('case_vortex_investigator_benchmark_claim_invalid');
  }
  exactKeys(value, ['claimId', 'material', 'citationIds'],
    'case_vortex_investigator_benchmark_claim_invalid');
  if (typeof value.material !== 'boolean') invalid('case_vortex_investigator_benchmark_claim_invalid');
  return {
    claimId: nonEmpty(value.claimId, 200, 'case_vortex_investigator_benchmark_claim_invalid'),
    material: value.material,
    citationIds: uniqueSortedStrings(value.citationIds, 100, 200,
      'case_vortex_investigator_benchmark_claim_invalid'),
  };
};

const validateComparisonRun = (value: CaseVortexBenchmarkComparisonRun) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('case_vortex_investigator_benchmark_comparison_invalid');
  }
  exactKeys(value, [
    'tool', 'completed', 'equivalentPublicMaterial', 'timeToAnswerMs',
    'manualSourceSwitches', 'auditTrailScore', 'toolName', 'toolVersion', 'resultSha256',
  ], 'case_vortex_investigator_benchmark_comparison_invalid');
  if (!['direct_archive', 'generic_model'].includes(value.tool)
    || typeof value.completed !== 'boolean'
    || typeof value.equivalentPublicMaterial !== 'boolean') {
    invalid('case_vortex_investigator_benchmark_comparison_invalid');
  }
  const resultSha256 = nonEmpty(value.resultSha256, 64,
    'case_vortex_investigator_benchmark_comparison_invalid').toLowerCase();
  if (!SHA256.test(resultSha256)) invalid('case_vortex_investigator_benchmark_comparison_invalid');
  return {
    tool: value.tool,
    completed: value.completed,
    equivalentPublicMaterial: value.equivalentPublicMaterial,
    timeToAnswerMs: finiteNonNegative(value.timeToAnswerMs,
      'case_vortex_investigator_benchmark_comparison_invalid'),
    manualSourceSwitches: boundedInteger(value.manualSourceSwitches, 10_000,
      'case_vortex_investigator_benchmark_comparison_invalid'),
    auditTrailScore: boundedInteger(value.auditTrailScore, 5,
      'case_vortex_investigator_benchmark_comparison_invalid'),
    toolName: nonEmpty(value.toolName, 200,
      'case_vortex_investigator_benchmark_comparison_invalid'),
    toolVersion: nonEmpty(value.toolVersion, 200,
      'case_vortex_investigator_benchmark_comparison_invalid'),
    resultSha256,
  } as CaseVortexBenchmarkComparisonRun;
};

const validateObservation = (value: CaseVortexBenchmarkObservation) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('case_vortex_investigator_benchmark_observation_invalid');
  }
  exactKeys(value, [
    'observationId', 'studySlotId', 'queryId', 'journey', 'question', 'reviewerIdHash',
    'expectedRelevantAddresses', 'returnedTop20Addresses', 'firstResultMs',
    'fabricatedIdentifiers', 'unsupportedExhaustiveClaims',
    'requiredCapabilities', 'satisfiedCapabilities', 'citations', 'claims', 'reconstruction',
    'surfaceProof', 'reviewOutcome', 'evidenceProof', 'productManualSourceSwitches',
    'productAuditTrailScore', 'comparisonRuns',
  ], 'case_vortex_investigator_benchmark_observation_invalid');
  if (!CASE_VORTEX_INVESTIGATOR_JOURNEYS.includes(value.journey)) {
    invalid('case_vortex_investigator_benchmark_journey_invalid');
  }
  const reviewerIdHash = nonEmpty(value.reviewerIdHash, 64,
    'case_vortex_investigator_benchmark_reviewer_invalid').toLowerCase();
  if (!SHA256.test(reviewerIdHash)) invalid('case_vortex_investigator_benchmark_reviewer_invalid');
  if (!Array.isArray(value.citations) || value.citations.length > 1_000
    || !Array.isArray(value.claims) || value.claims.length > 1_000
    || !Array.isArray(value.comparisonRuns) || value.comparisonRuns.length > 2) {
    invalid('case_vortex_investigator_benchmark_observation_invalid');
  }
  const citations = value.citations.map(validateCitation).sort((left, right) => (
    compareText(left.citationId, right.citationId)
  ));
  if (new Set(citations.map(({ citationId }) => citationId)).size !== citations.length) {
    invalid('case_vortex_investigator_benchmark_citation_invalid');
  }
  const citationIds = new Set(citations.map(({ citationId }) => citationId));
  const requiredCapabilities = uniqueSortedStrings(value.requiredCapabilities, 10, 100,
    'case_vortex_investigator_benchmark_capability_invalid') as CaseVortexInvestigatorCapability[];
  const satisfiedCapabilities = uniqueSortedStrings(value.satisfiedCapabilities, 10, 100,
    'case_vortex_investigator_benchmark_capability_invalid') as CaseVortexInvestigatorCapability[];
  if (requiredCapabilities.some((capability) => !CASE_VORTEX_INVESTIGATOR_CAPABILITIES.includes(capability))
    || satisfiedCapabilities.some((capability) => !requiredCapabilities.includes(capability))) {
    invalid('case_vortex_investigator_benchmark_capability_invalid');
  }
  const claims = value.claims.map(validateClaim).sort((left, right) => (
    compareText(left.claimId, right.claimId)
  ));
  if (new Set(claims.map(({ claimId }) => claimId)).size !== claims.length
    || claims.some((claim) => claim.citationIds.some((citationId) => !citationIds.has(citationId)))) {
    invalid('case_vortex_investigator_benchmark_claim_invalid');
  }
  let reconstruction: CaseVortexBenchmarkReconstructionObservation | null = null;
  if (value.reconstruction !== null) {
    if (!value.reconstruction || typeof value.reconstruction !== 'object'
      || Array.isArray(value.reconstruction)) {
      invalid('case_vortex_investigator_benchmark_reconstruction_invalid');
    }
    exactKeys(value.reconstruction, ['sourceLocatorResolved', 'evidenceChainReproduced'],
      'case_vortex_investigator_benchmark_reconstruction_invalid');
    if (typeof value.reconstruction.sourceLocatorResolved !== 'boolean'
      || typeof value.reconstruction.evidenceChainReproduced !== 'boolean') {
      invalid('case_vortex_investigator_benchmark_reconstruction_invalid');
    }
    reconstruction = { ...value.reconstruction };
  }
  if (!value.surfaceProof || typeof value.surfaceProof !== 'object' || Array.isArray(value.surfaceProof)) {
    invalid('case_vortex_investigator_benchmark_surface_proof_invalid');
  }
  exactKeys(value.surfaceProof, ['orb', 'keyboard', 'luna', 'mobile', 'reducedMotion', 'artifactSha256'],
    'case_vortex_investigator_benchmark_surface_proof_invalid');
  if (['orb', 'keyboard', 'luna', 'mobile', 'reducedMotion']
    .some((key) => typeof value.surfaceProof[key as keyof typeof value.surfaceProof] !== 'boolean')) {
    invalid('case_vortex_investigator_benchmark_surface_proof_invalid');
  }
  const surfaceArtifactSha256 = nonEmpty(value.surfaceProof.artifactSha256, 64,
    'case_vortex_investigator_benchmark_surface_proof_invalid').toLowerCase();
  if (!SHA256.test(surfaceArtifactSha256)) invalid('case_vortex_investigator_benchmark_surface_proof_invalid');
  const surfaceProof: CaseVortexBenchmarkSurfaceProof = { ...value.surfaceProof, artifactSha256: surfaceArtifactSha256 };
  if (!value.reviewOutcome || typeof value.reviewOutcome !== 'object' || Array.isArray(value.reviewOutcome)) {
    invalid('case_vortex_investigator_benchmark_review_outcome_invalid');
  }
  exactKeys(value.reviewOutcome,
    ['correct', 'useful', 'misleading', 'completedWithoutDeveloperHelp', 'reviewReceiptSha256'],
    'case_vortex_investigator_benchmark_review_outcome_invalid');
  if (['correct', 'useful', 'misleading', 'completedWithoutDeveloperHelp']
    .some((key) => typeof value.reviewOutcome[key as keyof typeof value.reviewOutcome] !== 'boolean')) {
    invalid('case_vortex_investigator_benchmark_review_outcome_invalid');
  }
  const reviewReceiptSha256 = nonEmpty(value.reviewOutcome.reviewReceiptSha256, 64,
    'case_vortex_investigator_benchmark_review_outcome_invalid').toLowerCase();
  if (!SHA256.test(reviewReceiptSha256)) invalid('case_vortex_investigator_benchmark_review_outcome_invalid');
  const reviewOutcome: CaseVortexBenchmarkReviewOutcome = { ...value.reviewOutcome, reviewReceiptSha256 };
  if (!value.evidenceProof || typeof value.evidenceProof !== 'object' || Array.isArray(value.evidenceProof)) {
    invalid('case_vortex_investigator_benchmark_evidence_proof_invalid');
  }
  exactKeys(value.evidenceProof, [
    'publicationBound', 'toolTraceSha256', 'packetSha256', 'packetReplayed',
    'counterevidenceRetained', 'missingnessDisclosed',
  ], 'case_vortex_investigator_benchmark_evidence_proof_invalid');
  if (typeof value.evidenceProof.publicationBound !== 'boolean'
    || typeof value.evidenceProof.packetReplayed !== 'boolean'
    || typeof value.evidenceProof.counterevidenceRetained !== 'boolean'
    || typeof value.evidenceProof.missingnessDisclosed !== 'boolean') {
    invalid('case_vortex_investigator_benchmark_evidence_proof_invalid');
  }
  const toolTraceSha256 = nonEmpty(value.evidenceProof.toolTraceSha256, 64,
    'case_vortex_investigator_benchmark_evidence_proof_invalid').toLowerCase();
  const packetSha256 = nonEmpty(value.evidenceProof.packetSha256, 64,
    'case_vortex_investigator_benchmark_evidence_proof_invalid').toLowerCase();
  if (!SHA256.test(toolTraceSha256) || !SHA256.test(packetSha256)) {
    invalid('case_vortex_investigator_benchmark_evidence_proof_invalid');
  }
  const comparisonRuns = value.comparisonRuns.map(validateComparisonRun)
    .sort((left, right) => compareText(left.tool, right.tool));
  if (new Set(comparisonRuns.map(({ tool }) => tool)).size !== comparisonRuns.length) {
    invalid('case_vortex_investigator_benchmark_comparison_invalid');
  }
  return {
    observationId: nonEmpty(value.observationId, 200,
      'case_vortex_investigator_benchmark_observation_invalid'),
    studySlotId: nonEmpty(value.studySlotId, 200,
      'case_vortex_investigator_benchmark_study_plan_mismatch'),
    queryId: nonEmpty(value.queryId, 200,
      'case_vortex_investigator_benchmark_query_invalid'),
    journey: value.journey,
    question: nonEmpty(value.question, MAX_QUESTION_LENGTH,
      'case_vortex_investigator_benchmark_observation_invalid'),
    reviewerIdHash,
    expectedRelevantAddresses: uniqueSortedStrings(value.expectedRelevantAddresses, 10_000, 500,
      'case_vortex_investigator_benchmark_expected_invalid'),
    returnedTop20Addresses: uniqueSortedStrings(value.returnedTop20Addresses, 20, 500,
      'case_vortex_investigator_benchmark_returned_invalid'),
    firstResultMs: finiteNonNegative(value.firstResultMs,
      'case_vortex_investigator_benchmark_latency_invalid'),
    fabricatedIdentifiers: uniqueSortedStrings(value.fabricatedIdentifiers, 1_000, 500,
      'case_vortex_investigator_benchmark_fabrication_invalid'),
    unsupportedExhaustiveClaims: uniqueSortedStrings(value.unsupportedExhaustiveClaims, 1_000, 2_000,
      'case_vortex_investigator_benchmark_exhaustive_claim_invalid'),
    requiredCapabilities,
    satisfiedCapabilities,
    citations,
    claims,
    reconstruction,
    surfaceProof,
    reviewOutcome,
    evidenceProof: {
      publicationBound: value.evidenceProof.publicationBound,
      toolTraceSha256,
      packetSha256,
      packetReplayed: value.evidenceProof.packetReplayed,
      counterevidenceRetained: value.evidenceProof.counterevidenceRetained,
      missingnessDisclosed: value.evidenceProof.missingnessDisclosed,
    },
    productManualSourceSwitches: boundedInteger(value.productManualSourceSwitches, 10_000,
      'case_vortex_investigator_benchmark_product_measure_invalid'),
    productAuditTrailScore: boundedInteger(value.productAuditTrailScore, 5,
      'case_vortex_investigator_benchmark_product_measure_invalid'),
    comparisonRuns,
  };
};

const criterion = (
  name: string,
  comparator: '>=' | '<=' | '=',
  threshold: number,
  actual: number,
): CaseVortexInvestigatorBenchmarkCriterion => ({
  criterion: name,
  comparator,
  threshold,
  actual,
  passed: comparator === '>=' ? actual >= threshold : comparator === '<=' ? actual <= threshold : actual === threshold,
});

export const buildCaseVortexInvestigatorBenchmarkReport = (
  input: CaseVortexInvestigatorBenchmarkInput,
): CaseVortexInvestigatorBenchmarkReport => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalid('case_vortex_investigator_benchmark_input_invalid');
  }
  exactKeys(input, [
    'recordType', 'schemaVersion', 'benchmarkId', 'completedAt', 'publication', 'studyPlan', 'observations',
  ],
    'case_vortex_investigator_benchmark_input_invalid');
  if (input.recordType !== 'case_vortex_investigator_benchmark_input'
    || input.schemaVersion !== CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION
    || !Array.isArray(input.observations)
    || input.observations.length > MAX_OBSERVATIONS) {
    invalid('case_vortex_investigator_benchmark_input_invalid');
  }
  const completedAt = nonEmpty(input.completedAt, 40,
    'case_vortex_investigator_benchmark_completed_at_invalid');
  if (new Date(completedAt).toISOString() !== completedAt) {
    invalid('case_vortex_investigator_benchmark_completed_at_invalid');
  }
  const publication = validatePublication(input.publication);
  const studyPlan = validateStudyPlan(input.studyPlan);
  if (relationshipInputSha256(studyPlan.publication) !== relationshipInputSha256(publication)) {
    invalid('case_vortex_investigator_benchmark_study_plan_mismatch');
  }
  const observations = input.observations.map(validateObservation).sort((left, right) => (
    compareText(left.observationId, right.observationId)
  ));
  if (new Set(observations.map(({ observationId }) => observationId)).size !== observations.length) {
    invalid('case_vortex_investigator_benchmark_observation_invalid');
  }
  const studySlots = new Map(studyPlan.slots.map((slot) => [slot.slotId, slot] as const));
  const usedStudySlots = new Set<string>();
  const reviewersByLane = new Map<'reviewer_a' | 'reviewer_b', Set<string>>([
    ['reviewer_a', new Set<string>()],
    ['reviewer_b', new Set<string>()],
  ]);
  observations.forEach((item) => {
    const slot = studySlots.get(item.studySlotId)
      ?? invalid('case_vortex_investigator_benchmark_study_plan_mismatch');
    if (usedStudySlots.has(item.studySlotId)
      || item.queryId !== slot.queryId
      || item.journey !== slot.journey
      || item.question !== slot.question
      || relationshipInputSha256(item.expectedRelevantAddresses)
        !== relationshipInputSha256([...slot.expectedRelevantAddresses].sort())
      || relationshipInputSha256(item.requiredCapabilities)
        !== relationshipInputSha256([...slot.requiredCapabilities].sort())
      || (slot.requiresSourceReconstruction ? item.reconstruction === null : item.reconstruction !== null)) {
      invalid('case_vortex_investigator_benchmark_study_plan_mismatch');
    }
    usedStudySlots.add(item.studySlotId);
    reviewersByLane.get(slot.reviewerLane)?.add(item.reviewerIdHash);
  });
  const reviewerA = reviewersByLane.get('reviewer_a')!;
  const reviewerB = reviewersByLane.get('reviewer_b')!;
  if (usedStudySlots.size !== studyPlan.slots.length
    || observations.length !== studyPlan.slots.length
    || reviewerA.size !== 1
    || reviewerB.size !== 1
    || [...reviewerA][0] === [...reviewerB][0]) {
    invalid('case_vortex_investigator_benchmark_study_plan_mismatch');
  }
  const retainedEvidenceArtifacts = [
    ...studyPlan.slots.map(({ adjudicationReceiptSha256 }) => adjudicationReceiptSha256!),
    ...observations.flatMap((item) => [
    item.surfaceProof.artifactSha256,
    item.reviewOutcome.reviewReceiptSha256,
    item.evidenceProof.toolTraceSha256,
    item.evidenceProof.packetSha256,
    ...item.comparisonRuns.map(({ resultSha256 }) => resultSha256),
    ]),
  ];
  const distinctEvidenceArtifactCount = new Set(retainedEvidenceArtifacts).size;
  if (distinctEvidenceArtifactCount !== retainedEvidenceArtifacts.length) {
    invalid('case_vortex_investigator_benchmark_artifact_reuse_invalid');
  }
  const queryDefinitions = new Map<string, string>();
  const normalizedQuestions = new Map<string, string>();
  const reviewerQueryPairs = new Set<string>();
  observations.forEach((item) => {
    const definition = relationshipInputSha256({
      journey: item.journey,
      question: item.question,
      expectedRelevantAddresses: item.expectedRelevantAddresses,
    });
    const priorDefinition = queryDefinitions.get(item.queryId);
    if (priorDefinition && priorDefinition !== definition) {
      invalid('case_vortex_investigator_benchmark_query_definition_conflict');
    }
    queryDefinitions.set(item.queryId, definition);
    const normalizedQuestion = `${item.journey}:${item.question.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim()}`;
    const priorQueryId = normalizedQuestions.get(normalizedQuestion);
    if (priorQueryId && priorQueryId !== item.queryId) {
      invalid('case_vortex_investigator_benchmark_query_alias_invalid');
    }
    normalizedQuestions.set(normalizedQuestion, item.queryId);
    const reviewerPair = `${item.queryId}:${item.reviewerIdHash}`;
    if (reviewerQueryPairs.has(reviewerPair)) {
      invalid('case_vortex_investigator_benchmark_duplicate_review_invalid');
    }
    reviewerQueryPairs.add(reviewerPair);
  });
  const citationCount = observations.reduce((total, item) => total + item.citations.length, 0);
  const resolvedCitationCount = observations.reduce((total, item) => (
    total + item.citations.filter(({ resolvable }) => resolvable).length
  ), 0);
  const quotedCitationCount = observations.reduce((total, item) => (
    total + item.citations.filter(({ quoted }) => quoted).length
  ), 0);
  const verifiedQuoteCount = observations.reduce((total, item) => (
    total + item.citations.filter(({ quoted, quoteVerified }) => quoted && quoteVerified).length
  ), 0);
  const materialClaims = observations.flatMap((item) => item.claims.filter(({ material }) => material));
  const citationSupportedMaterialClaimCount = observations.reduce((total, item) => {
    const resolved = new Set(item.citations.filter(({ resolvable }) => resolvable).map(({ citationId }) => citationId));
    return total + item.claims.filter(({ material, citationIds }) => (
      material && citationIds.some((citationId) => resolved.has(citationId))
    )).length;
  }, 0);
  const expectedRelevantCount = observations.reduce((total, item) => (
    total + item.expectedRelevantAddresses.length
  ), 0);
  const relevantReturnedAt20Count = observations.reduce((total, item) => {
    const returned = new Set(item.returnedTop20Addresses);
    return total + item.expectedRelevantAddresses.filter((address) => returned.has(address)).length;
  }, 0);
  const reconstructions = observations.filter(({ reconstruction }) => reconstruction !== null);
  const successfulReconstructionCount = reconstructions.filter(({ reconstruction }) => (
    reconstruction?.sourceLocatorResolved && reconstruction.evidenceChainReproduced
  )).length;
  const independentReviewers = new Set(observations.map(({ reviewerIdHash }) => reviewerIdHash));
  const fabricatedIdentifierCount = observations.reduce((total, item) => (
    total + item.fabricatedIdentifiers.length
  ), 0);
  const unsupportedExhaustiveClaimCount = observations.reduce((total, item) => (
    total + item.unsupportedExhaustiveClaims.length
  ), 0);
  const requiredCapabilityCheckCount = observations.reduce((total, item) => (
    total + item.requiredCapabilities.length
  ), 0);
  const satisfiedCapabilityCheckCount = observations.reduce((total, item) => (
    total + item.satisfiedCapabilities.length
  ), 0);
  const reviewedQueryCount = queryDefinitions.size;
  const correctReviewCount = observations.filter(({ reviewOutcome }) => reviewOutcome.correct).length;
  const usefulReviewCount = observations.filter(({ reviewOutcome }) => reviewOutcome.useful).length;
  const misleadingReviewCount = observations.filter(({ reviewOutcome }) => reviewOutcome.misleading).length;
  const independentCompletionCount = observations.filter(({ reviewOutcome }) => (
    reviewOutcome.completedWithoutDeveloperHelp
  )).length;
  const reproducibleObservationCount = observations.filter(({ evidenceProof }) => (
    evidenceProof.publicationBound
    && evidenceProof.packetReplayed
    && evidenceProof.counterevidenceRetained
    && evidenceProof.missingnessDisclosed
  )).length;
  const comparisonRuns = observations.flatMap((item) => item.comparisonRuns.map((comparison) => ({
    ...comparison,
    won: comparison.completed
      && comparison.equivalentPublicMaterial
      && item.productManualSourceSwitches <= comparison.manualSourceSwitches
      && item.productAuditTrailScore > comparison.auditTrailScore,
  })));
  const comparisonWinCount = comparisonRuns.filter(({ won }) => won).length;
  const metrics = {
    citationResolutionRate: ratio(resolvedCitationCount, citationCount),
    quoteVerificationRate: ratio(verifiedQuoteCount, quotedCitationCount),
    materialClaimCitationSupportRate: ratio(citationSupportedMaterialClaimCount, materialClaims.length),
    recallAt20: expectedRelevantCount === 0 ? 0 : relevantReturnedAt20Count / expectedRelevantCount,
    p95FirstResultMs: p95(observations.map(({ firstResultMs }) => firstResultMs)),
    reconstructionSuccessRate: ratio(successfulReconstructionCount, reconstructions.length),
    capabilitySatisfactionRate: requiredCapabilityCheckCount === 0
      ? 0
      : satisfiedCapabilityCheckCount / requiredCapabilityCheckCount,
    correctReviewRate: ratio(correctReviewCount, observations.length),
    usefulReviewRate: ratio(usefulReviewCount, observations.length),
    independentCompletionRate: ratio(independentCompletionCount, observations.length),
    packetReplayRate: ratio(
      observations.filter(({ evidenceProof }) => evidenceProof.packetReplayed).length,
      observations.length,
    ),
    comparisonWinRate: comparisonRuns.length === 0 ? 0 : comparisonWinCount / comparisonRuns.length,
  };
  const journeys = CASE_VORTEX_INVESTIGATOR_JOURNEYS.map((journey) => {
    const journeyObservations = observations.filter((item) => item.journey === journey);
    const expected = journeyObservations.reduce((total, item) => total + item.expectedRelevantAddresses.length, 0);
    const returned = journeyObservations.reduce((total, item) => {
      const addresses = new Set(item.returnedTop20Addresses);
      return total + item.expectedRelevantAddresses.filter((address) => addresses.has(address)).length;
    }, 0);
    return {
      journey,
      queryCount: new Set(journeyObservations.map(({ queryId }) => queryId)).size,
      independentReviewerCount: new Set(journeyObservations.map(({ reviewerIdHash }) => reviewerIdHash)).size,
      expectedRelevantCount: expected,
      relevantReturnedAt20Count: returned,
      recallAt20: expected === 0 ? 0 : returned / expected,
    };
  });
  const minimumJourneyQueries = Math.min(...journeys.map(({ queryCount }) => queryCount));
  const minimumJourneyReviewers = Math.min(...journeys.map(({ independentReviewerCount }) => independentReviewerCount));
  const journeysWithSurfaceProof = CASE_VORTEX_INVESTIGATOR_JOURNEYS.filter((journey) => (
    observations.some((item) => item.journey === journey && Object.values(item.surfaceProof).every(Boolean))
  )).length;
  const journeysWithComparisonProof = CASE_VORTEX_INVESTIGATOR_JOURNEYS.filter((journey) => {
    const tools = new Set(observations.filter((item) => item.journey === journey)
      .flatMap((item) => item.comparisonRuns
        .filter(({ completed, equivalentPublicMaterial }) => completed && equivalentPublicMaterial)
        .map(({ tool }) => tool)));
    return tools.has('direct_archive') && tools.has('generic_model');
  }).length;
  const criteria = [
    criterion('study_plan_slots', '=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.requiredStudyPlanSlots,
      studyPlan.slots.length),
    criterion('distinct_evidence_artifacts', '=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.requiredDistinctEvidenceArtifacts,
      distinctEvidenceArtifactCount),
    criterion('reviewed_queries', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumReviewedQueries,
      reviewedQueryCount),
    criterion('source_reconstructions', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumSourceReconstructions,
      reconstructions.length),
    criterion('queries_per_journey', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumQueriesPerJourney,
      minimumJourneyQueries),
    criterion('independent_reviewers', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumIndependentReviewers,
      independentReviewers.size),
    criterion('independent_reviewers_per_journey', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumIndependentReviewers, minimumJourneyReviewers),
    criterion('audited_citations', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumAuditedCitations,
      citationCount),
    criterion('audited_material_claims', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumAuditedMaterialClaims, materialClaims.length),
    criterion('expected_relevant_records', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumExpectedRelevantRecords, expectedRelevantCount),
    criterion('audited_capability_checks', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumAuditedCapabilityChecks, requiredCapabilityCheckCount),
    criterion('reproducible_observations', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumReproducibleObservations, reproducibleObservationCount),
    criterion('comparison_runs', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumComparisonRuns,
      comparisonRuns.length),
    criterion('journeys_with_surface_proof', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumJourneysWithSurfaceProof, journeysWithSurfaceProof),
    criterion('journeys_with_comparison_proof', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumJourneysWithComparisonProof, journeysWithComparisonProof),
    criterion('fabricated_identifiers', '=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.maximumFabricatedIdentifiers,
      fabricatedIdentifierCount),
    criterion('unsupported_exhaustive_claims', '=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.maximumUnsupportedExhaustiveClaims,
      unsupportedExhaustiveClaimCount),
    criterion('misleading_review_outcomes', '=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.maximumMisleadingReviewOutcomes, misleadingReviewCount),
    criterion('citation_resolution_rate', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumCitationResolutionRate, metrics.citationResolutionRate),
    criterion('quote_verification_rate', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumQuoteVerificationRate, metrics.quoteVerificationRate),
    criterion('material_claim_citation_support_rate', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumMaterialClaimCitationSupportRate,
      metrics.materialClaimCitationSupportRate),
    criterion('recall_at_20', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumRecallAt20, metrics.recallAt20),
    criterion('p95_first_result_ms', '<=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.maximumP95FirstResultMs,
      metrics.p95FirstResultMs),
    criterion('reconstruction_success_rate', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumReconstructionSuccessRate,
      metrics.reconstructionSuccessRate),
    criterion('capability_satisfaction_rate', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumCapabilitySatisfactionRate,
      metrics.capabilitySatisfactionRate),
    criterion('correct_review_rate', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumCorrectReviewRate,
      metrics.correctReviewRate),
    criterion('useful_review_rate', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumUsefulReviewRate,
      metrics.usefulReviewRate),
    criterion('independent_completion_rate', '>=',
      CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumIndependentCompletionRate,
      metrics.independentCompletionRate),
    criterion('packet_replay_rate', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumPacketReplayRate,
      metrics.packetReplayRate),
    criterion('comparison_win_rate', '>=', CASE_VORTEX_INVESTIGATOR_CLAIM_GATE.minimumComparisonWinRate,
      metrics.comparisonWinRate),
  ];
  const withoutDigest = {
    recordType: 'case_vortex_investigator_benchmark_report' as const,
    schemaVersion: CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION,
    benchmarkId: nonEmpty(input.benchmarkId, 200, 'case_vortex_investigator_benchmark_id_invalid'),
    completedAt,
    publication,
    studyPlan: { planId: studyPlan.planId, planSha256: studyPlan.planSha256 },
    gatePolicy: CASE_VORTEX_INVESTIGATOR_CLAIM_GATE,
    accounting: {
      reviewedQueryCount,
      reviewObservationCount: observations.length,
      studyPlanSlotCount: studyPlan.slots.length,
      distinctEvidenceArtifactCount,
      sourceReconstructionCount: reconstructions.length,
      independentReviewerCount: independentReviewers.size,
      fabricatedIdentifierCount,
      unsupportedExhaustiveClaimCount,
      requiredCapabilityCheckCount,
      satisfiedCapabilityCheckCount,
      citationCount,
      resolvedCitationCount,
      quotedCitationCount,
      verifiedQuoteCount,
      materialClaimCount: materialClaims.length,
      citationSupportedMaterialClaimCount,
      expectedRelevantCount,
      relevantReturnedAt20Count,
      successfulReconstructionCount,
      reproducibleObservationCount,
      correctReviewCount,
      usefulReviewCount,
      misleadingReviewCount,
      independentCompletionCount,
      comparisonRunCount: comparisonRuns.length,
      comparisonWinCount,
      journeysWithSurfaceProof,
      journeysWithComparisonProof,
    },
    metrics,
    journeys,
    criteria,
    eligibleForBestAvailableClaim: criteria.every(({ passed }) => passed),
    limitations: [
      'This gate measures the pinned publication and benchmark set only; it does not prove universal corpus completeness.',
      'Passing supports a bounded best-available product claim, not claims about UAP origin or causality.',
      'Independent reviewers must disclose benchmark-set construction and conflicts of interest outside this artifact.',
    ],
  };
  return {
    ...withoutDigest,
    reportSha256: relationshipInputSha256(withoutDigest),
  };
};
