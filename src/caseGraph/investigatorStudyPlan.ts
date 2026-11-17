import {
  CASE_VORTEX_INVESTIGATOR_CAPABILITIES,
  CASE_VORTEX_INVESTIGATOR_CLAIM_GATE,
  CASE_VORTEX_INVESTIGATOR_JOURNEYS,
  type CaseVortexInvestigatorCapability,
  type CaseVortexInvestigatorJourney,
} from './investigatorUsefulnessBenchmark';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_INVESTIGATOR_STUDY_PLAN_VERSION =
  'case-vortex-investigator-study-plan-v2' as const;
export const CASE_VORTEX_INVESTIGATOR_STUDY_ADJUDICATION_RECEIPT_VERSION =
  'case-vortex-investigator-study-adjudication-receipt-v1' as const;
export const CASE_VORTEX_INVESTIGATOR_STUDY_ADJUDICATION_DRAFT_VERSION =
  'case-vortex-investigator-study-adjudication-draft-v1' as const;
export const CASE_VORTEX_INVESTIGATOR_STUDY_ADJUDICATION_FILE_VERSION =
  'case-vortex-investigator-study-adjudications-v1' as const;

export const CASE_VORTEX_INVESTIGATOR_QUERY_STRATA = [
  'known_positive',
  'ambiguous_or_alias',
  'hard_negative',
  'missing_data',
  'counterevidence_or_dispute',
] as const;

export type CaseVortexInvestigatorQueryStratum =
  typeof CASE_VORTEX_INVESTIGATOR_QUERY_STRATA[number];

const CAPABILITIES_BY_JOURNEY: Record<
CaseVortexInvestigatorJourney, readonly CaseVortexInvestigatorCapability[]> = {
  exact_record_find: ['source_reliability', 'precise_source_locators', 'explainable_orb_trace'],
  event_reconstruction: ['claim_graph', 'precise_source_locators', 'living_dossier'],
  provenance_and_circular_reporting: ['claim_graph', 'source_reliability', 'claim_counterclaim'],
  contextual_explanation_review: ['external_correlations', 'claim_counterclaim', 'source_reliability'],
  versioned_fact_comparison: ['similar_cases', 'claim_graph', 'source_reliability'],
  pattern_and_base_rate_audit: ['similar_cases', 'source_reliability', 'claim_counterclaim'],
  connection_receipt_inspection: ['claim_graph', 'explainable_orb_trace', 'precise_source_locators'],
  media_lineage: ['precise_source_locators', 'source_reliability', 'claim_graph'],
  contradiction_and_open_question_review: ['claim_graph', 'claim_counterclaim', 'living_dossier'],
  reproducible_research_packet: ['investigation_workspace', 'reproducible_report', 'precise_source_locators'],
};

const GUIDANCE_BY_JOURNEY: Record<CaseVortexInvestigatorJourney, string> = {
  exact_record_find: 'Adjudicate an ordinary-language lookup to exact governed addresses, including why alternatives do not match.',
  event_reconstruction: 'Adjudicate source-specific records that concern one event without erasing duplicates, dissent or uncertainty.',
  provenance_and_circular_reporting: 'Trace a material claim to the earliest available public source and label mirrors versus independent corroboration.',
  contextual_explanation_review: 'Test available ordinary contextual explanations and retain unavailable coverage and uncertainty explicitly.',
  versioned_fact_comparison: 'Compare governed extracted facts and missing fields without turning narrative similarity into causation.',
  pattern_and_base_rate_audit: 'Test a claimed pattern against base rates, source coverage, duplicate dependence, precision and counterexamples.',
  connection_receipt_inspection: 'Inspect one visible relationship receipt, its thresholds, contributing and missing features, versions and sources.',
  media_lineage: 'Trace original public media, derivatives, host records, metadata and custody gaps without implying authentication.',
  contradiction_and_open_question_review: 'Place material contradictions side by side and state what further evidence would discriminate them.',
  reproducible_research_packet: 'Reproduce a saved investigation from its publication, tools, filters, addresses, citations, receipts and limitations.',
};

export type CaseVortexInvestigatorStudySlot = {
  slotId: string;
  queryId: string;
  journey: CaseVortexInvestigatorJourney;
  stratum: CaseVortexInvestigatorQueryStratum;
  reviewerLane: 'reviewer_a' | 'reviewer_b';
  requiresSourceReconstruction: boolean;
  requiredCapabilities: CaseVortexInvestigatorCapability[];
  requiredSurfaces: ['orb', 'keyboard', 'luna', 'mobile', 'reduced_motion'];
  requiredComparisons: ['direct_archive', 'generic_model'];
  adjudicationGuidance: string;
  question: string | null;
  expectedRelevantAddresses: string[];
  adjudicationStatus: 'pending' | 'frozen';
  adjudicationReceiptSha256: string | null;
};

export type CaseVortexInvestigatorStudyPlan = {
  recordType: 'case_vortex_investigator_study_plan';
  schemaVersion: typeof CASE_VORTEX_INVESTIGATOR_STUDY_PLAN_VERSION;
  planId: string;
  publication: { publicationId: string; corpusVersion: string; manifestSha256: string };
  frozenAt: string | null;
  adjudicatorIdHash: string | null;
  policy: typeof CASE_VORTEX_INVESTIGATOR_CLAIM_GATE;
  accounting: {
    querySlotCount: 200;
    sourceReconstructionSlotCount: 50;
    slotsPerJourney: 20;
    slotsPerStratumPerJourney: 4;
    reviewerLaneCount: 2;
  };
  safeguards: {
    syntheticAnswersAllowed: false;
    fixtureEvidenceCountsAsHumanReview: false;
    publicationMutationAllowed: false;
    networkCallsDuringGeneration: 0;
    lunaCallsDuringGeneration: 0;
  };
  slots: CaseVortexInvestigatorStudySlot[];
  planSha256: string;
};

const bounded = (value: string, field: string, maximum = 200) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw new Error(`case_vortex_investigator_study_${field}_invalid`);
  return trimmed;
};

export const buildCaseVortexInvestigatorStudyPlan = (input: {
  planId: string;
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
}): CaseVortexInvestigatorStudyPlan => {
  const manifestSha256 = input.manifestSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(manifestSha256)) {
    throw new Error('case_vortex_investigator_study_manifest_sha256_invalid');
  }
  const slots = CASE_VORTEX_INVESTIGATOR_JOURNEYS.flatMap((journey, journeyIndex) => (
    Array.from({ length: 20 }, (_, slotIndex): CaseVortexInvestigatorStudySlot => {
      const ordinal = String(slotIndex + 1).padStart(2, '0');
      return {
        slotId: `${journey}-${ordinal}`,
        queryId: `${journey}/${ordinal}`,
        journey,
        stratum: CASE_VORTEX_INVESTIGATOR_QUERY_STRATA[slotIndex % 5],
        reviewerLane: (slotIndex + journeyIndex) % 2 === 0 ? 'reviewer_a' : 'reviewer_b',
        requiresSourceReconstruction: slotIndex < 5,
        requiredCapabilities: [...CAPABILITIES_BY_JOURNEY[journey]],
        requiredSurfaces: ['orb', 'keyboard', 'luna', 'mobile', 'reduced_motion'],
        requiredComparisons: ['direct_archive', 'generic_model'],
        adjudicationGuidance: GUIDANCE_BY_JOURNEY[journey],
        question: null,
        expectedRelevantAddresses: [],
        adjudicationStatus: 'pending',
        adjudicationReceiptSha256: null,
      };
    })
  ));
  const withoutDigest = {
    recordType: 'case_vortex_investigator_study_plan' as const,
    schemaVersion: CASE_VORTEX_INVESTIGATOR_STUDY_PLAN_VERSION,
    planId: bounded(input.planId, 'plan_id'),
    publication: {
      publicationId: bounded(input.publicationId, 'publication_id'),
      corpusVersion: bounded(input.corpusVersion, 'corpus_version'),
      manifestSha256,
    },
    frozenAt: null,
    adjudicatorIdHash: null,
    policy: CASE_VORTEX_INVESTIGATOR_CLAIM_GATE,
    accounting: {
      querySlotCount: 200 as const,
      sourceReconstructionSlotCount: 50 as const,
      slotsPerJourney: 20 as const,
      slotsPerStratumPerJourney: 4 as const,
      reviewerLaneCount: 2 as const,
    },
    safeguards: {
      syntheticAnswersAllowed: false as const,
      fixtureEvidenceCountsAsHumanReview: false as const,
      publicationMutationAllowed: false as const,
      networkCallsDuringGeneration: 0 as const,
      lunaCallsDuringGeneration: 0 as const,
    },
    slots,
  };
  const planSha256 = relationshipInputSha256(withoutDigest);
  const plan = { ...withoutDigest, planSha256 };

  const coveredCapabilities = new Set(slots.flatMap(({ requiredCapabilities }) => requiredCapabilities));
  if (slots.length !== 200
    || slots.filter(({ requiresSourceReconstruction }) => requiresSourceReconstruction).length !== 50
    || CASE_VORTEX_INVESTIGATOR_CAPABILITIES.some((capability) => !coveredCapabilities.has(capability))) {
    throw new Error('case_vortex_investigator_study_accounting_invalid');
  }
  return plan;
};

export const verifyCaseVortexInvestigatorStudyPlan = (plan: unknown): plan is CaseVortexInvestigatorStudyPlan => {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return false;
  if (!('planSha256' in plan) || typeof plan.planSha256 !== 'string') return false;
  const { planSha256, ...withoutDigest } = plan;
  return relationshipInputSha256(withoutDigest) === planSha256;
};

const STUDY_ADDRESS = /^(sighting|document|photo|video):[^\s:][^\r\n]{0,510}$/u;
const STUDY_SHA256 = /^[a-f0-9]{64}$/u;

export type CaseVortexInvestigatorStudyAdjudication = {
  slotId: string;
  question: string;
  expectedRelevantAddresses: string[];
  adjudicationReceiptSha256: string;
};

export type CaseVortexInvestigatorStudyAdjudicationDraft = Omit<
CaseVortexInvestigatorStudyAdjudication, 'adjudicationReceiptSha256'>;

export type CaseVortexInvestigatorStudyAdjudicationDraftFile = {
  recordType: 'case_vortex_investigator_study_adjudication_draft';
  schemaVersion: typeof CASE_VORTEX_INVESTIGATOR_STUDY_ADJUDICATION_DRAFT_VERSION;
  planSha256: string;
  frozenAt: string;
  adjudicatorIdHash: string;
  adjudications: Array<{
    slotId: string;
    question: string | null;
    expectedRelevantAddresses: string[];
  }>;
};

export type CaseVortexInvestigatorStudyAdjudicationFile = {
  recordType: 'case_vortex_investigator_study_adjudications';
  schemaVersion: typeof CASE_VORTEX_INVESTIGATOR_STUDY_ADJUDICATION_FILE_VERSION;
  planSha256: string;
  frozenAt: string;
  adjudicatorIdHash: string;
  adjudications: CaseVortexInvestigatorStudyAdjudication[];
};

const sourceStudyPlanSha256 = (plan: CaseVortexInvestigatorStudyPlan) => {
  const { planSha256: _currentDigest, ...withoutDigest } = plan;
  const pendingBody = {
    ...withoutDigest,
    frozenAt: null,
    adjudicatorIdHash: null,
    slots: plan.slots.map((slot) => ({
      ...slot,
      question: null,
      expectedRelevantAddresses: [],
      adjudicationStatus: 'pending' as const,
      adjudicationReceiptSha256: null,
    })),
  };
  return relationshipInputSha256(pendingBody);
};

const adjudicationReceiptSha256 = (input: {
  sourcePlanSha256: string;
  publication: CaseVortexInvestigatorStudyPlan['publication'];
  planId: string;
  slotId: string;
  frozenAt: string;
  adjudicatorIdHash: string;
  question: string;
  expectedRelevantAddresses: string[];
}) => relationshipInputSha256({
  recordType: 'case_vortex_investigator_study_adjudication_receipt',
  schemaVersion: CASE_VORTEX_INVESTIGATOR_STUDY_ADJUDICATION_RECEIPT_VERSION,
  ...input,
});

export const sealCaseVortexInvestigatorStudyAdjudications = (input: {
  plan: CaseVortexInvestigatorStudyPlan;
  frozenAt: string;
  adjudicatorIdHash: string;
  adjudications: CaseVortexInvestigatorStudyAdjudicationDraft[];
}) => {
  const invalid = (): never => { throw new Error('case_vortex_investigator_study_adjudication_receipt_invalid'); };
  if (!verifyCaseVortexInvestigatorStudyPlan(input.plan)
    || !Array.isArray(input.plan.slots)
    || !Array.isArray(input.adjudications)
    || input.adjudications.length > input.plan.slots.length) invalid();
  let frozenAt = '';
  try { frozenAt = new Date(input.frozenAt).toISOString(); }
  catch { invalid(); }
  if (frozenAt !== input.frozenAt) invalid();
  const adjudicatorIdHash = String(input.adjudicatorIdHash || '').trim().toLowerCase();
  if (!STUDY_SHA256.test(adjudicatorIdHash)) invalid();
  const sourcePlanSha256 = sourceStudyPlanSha256(input.plan);
  const slotIds = new Set<string>();
  return input.adjudications.map((candidate): CaseVortexInvestigatorStudyAdjudication => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) invalid();
    const slotId = String(candidate.slotId || '').trim();
    if (slotIds.has(slotId) || !input.plan.slots.some((slot) => slot.slotId === slotId)) invalid();
    slotIds.add(slotId);
    const question = String(candidate.question || '').trim();
    if (!question || question.length > 4_000
      || !Array.isArray(candidate.expectedRelevantAddresses)
      || candidate.expectedRelevantAddresses.length > 10_000) invalid();
    const expectedRelevantAddresses = candidate.expectedRelevantAddresses
      .map((address) => String(address || '').trim()).sort();
    if (new Set(expectedRelevantAddresses).size !== expectedRelevantAddresses.length
      || expectedRelevantAddresses.some((address) => !STUDY_ADDRESS.test(address))) invalid();
    return {
      slotId,
      question,
      expectedRelevantAddresses,
      adjudicationReceiptSha256: adjudicationReceiptSha256({
        sourcePlanSha256,
        publication: input.plan.publication,
        planId: input.plan.planId,
        slotId,
        frozenAt,
        adjudicatorIdHash,
        question,
        expectedRelevantAddresses,
      }),
    };
  });
};

export const caseVortexInvestigatorStudyAdjudicationReceiptSha256 = (input: {
  plan: CaseVortexInvestigatorStudyPlan;
  slotId: string;
  frozenAt: string;
  adjudicatorIdHash: string;
  question: string;
  expectedRelevantAddresses: string[];
}) => sealCaseVortexInvestigatorStudyAdjudications({
  plan: input.plan,
  frozenAt: input.frozenAt,
  adjudicatorIdHash: input.adjudicatorIdHash,
  adjudications: [{
    slotId: input.slotId,
    question: input.question,
    expectedRelevantAddresses: input.expectedRelevantAddresses,
  }],
})[0].adjudicationReceiptSha256;

export const freezeCaseVortexInvestigatorStudyPlan = (
  plan: CaseVortexInvestigatorStudyPlan,
  input: {
    frozenAt: string;
    adjudicatorIdHash: string;
    adjudications: CaseVortexInvestigatorStudyAdjudication[];
  },
): CaseVortexInvestigatorStudyPlan => {
  const invalid = (): never => { throw new Error('case_vortex_investigator_study_adjudication_invalid'); };
  if (!verifyCaseVortexInvestigatorStudyPlan(plan)
    || plan.schemaVersion !== CASE_VORTEX_INVESTIGATOR_STUDY_PLAN_VERSION
    || !Array.isArray(plan.slots)
    || plan.frozenAt !== null
    || plan.adjudicatorIdHash !== null
    || plan.slots.some(({ adjudicationStatus, question, adjudicationReceiptSha256 }) => (
      adjudicationStatus !== 'pending' || question !== null || adjudicationReceiptSha256 !== null
    ))
    || !Array.isArray(input.adjudications)
    || input.adjudications.length !== plan.slots.length) invalid();
  const frozenAt = (() => {
    try { return new Date(input.frozenAt).toISOString(); }
    catch { return invalid(); }
  })();
  if (frozenAt !== input.frozenAt) invalid();
  const adjudicatorIdHash = String(input.adjudicatorIdHash || '').trim().toLowerCase();
  if (!STUDY_SHA256.test(adjudicatorIdHash)) invalid();
  const adjudications = new Map<string, CaseVortexInvestigatorStudyAdjudication>();
  const normalizedQuestions = new Set<string>();
  const receiptDigests = new Set<string>();
  input.adjudications.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.keys(candidate).sort().join(',')
        !== ['adjudicationReceiptSha256', 'expectedRelevantAddresses', 'question', 'slotId'].sort().join(',')) invalid();
    const slotId = String(candidate.slotId || '').trim();
    const slot = plan.slots.find((item) => item.slotId === slotId) ?? invalid();
    const question = String(candidate.question || '').trim();
    const receipt = String(candidate.adjudicationReceiptSha256 || '').trim().toLowerCase();
    if (adjudications.has(slotId) || !question || question.length > 4_000
      || !STUDY_SHA256.test(receipt) || receiptDigests.has(receipt)
      || !Array.isArray(candidate.expectedRelevantAddresses)
      || candidate.expectedRelevantAddresses.length > 10_000) invalid();
    const expectedRelevantAddresses = candidate.expectedRelevantAddresses
      .map((address) => String(address || '').trim()).sort();
    if (new Set(expectedRelevantAddresses).size !== expectedRelevantAddresses.length
      || expectedRelevantAddresses.some((address) => !STUDY_ADDRESS.test(address))) invalid();
    const normalizedQuestion = `${slot.journey}:${question.toLocaleLowerCase('en').replace(/\s+/gu, ' ')}`;
    if (normalizedQuestions.has(normalizedQuestion)) invalid();
    normalizedQuestions.add(normalizedQuestion);
    receiptDigests.add(receipt);
    adjudications.set(slotId, {
      slotId,
      question,
      expectedRelevantAddresses,
      adjudicationReceiptSha256: receipt,
    });
  });
  if (adjudications.size !== plan.slots.length) invalid();
  const expectedReceipts = new Map(sealCaseVortexInvestigatorStudyAdjudications({
    plan,
    frozenAt,
    adjudicatorIdHash,
    adjudications: [...adjudications.values()].map((adjudication) => ({
      slotId: adjudication.slotId,
      question: adjudication.question,
      expectedRelevantAddresses: adjudication.expectedRelevantAddresses,
    })),
  }).map((adjudication) => [adjudication.slotId, adjudication.adjudicationReceiptSha256]));
  if ([...adjudications.values()].some((adjudication) => (
    adjudication.adjudicationReceiptSha256 !== expectedReceipts.get(adjudication.slotId)
  ))) invalid();
  const withoutDigest = {
    ...plan,
    frozenAt,
    adjudicatorIdHash,
    slots: plan.slots.map((slot) => {
      const adjudication = adjudications.get(slot.slotId) ?? invalid();
      return {
        ...slot,
        question: adjudication.question,
        expectedRelevantAddresses: adjudication.expectedRelevantAddresses,
        adjudicationStatus: 'frozen' as const,
        adjudicationReceiptSha256: adjudication.adjudicationReceiptSha256,
      };
    }),
  };
  const { planSha256: _pendingDigest, ...frozenBody } = withoutDigest;
  return { ...frozenBody, planSha256: relationshipInputSha256(frozenBody) };
};
