import {
  verifyClaimAdjudicationReceipt,
  verifyClaimExtractionBatch,
  type ClaimAdjudicationReceipt,
  type ClaimExtractionBatch,
} from './claimEvidenceExtraction';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CLAIM_EXTRACTION_EVALUATION_VERSION = 'case-graph-claim-extraction-evaluation-v1' as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const invalid = (code: string): never => { throw new Error(code); };

export type ClaimExtractionGoldLabel = {
  labelId: string;
  segmentDigest: string;
  quoteStart: number;
  quoteEnd: number;
  subject: string;
  predicate: string;
  object: string;
  polarity: 'asserted' | 'denied';
  modality: 'observed' | 'reported' | 'inferred' | 'alleged' | 'unknown';
  expectedDecision: 'accept' | 'dispute';
  phenomenon: 'direct_observation' | 'attributed_report' | 'official_explanation' | 'denial' | 'repetition' | 'uncertain_interpretation';
};

export type ClaimExtractionEvaluationFixture = {
  recordType: 'case_graph_claim_extraction_evaluation_fixture';
  schemaVersion: typeof CLAIM_EXTRACTION_EVALUATION_VERSION;
  fixtureId: string;
  fixtureNature: 'synthetic_non_evidential' | 'licensed_governed_excerpt';
  constructionNotice: string;
  extractionBatch: ClaimExtractionBatch;
  goldLabels: ClaimExtractionGoldLabel[];
  fixtureDigest: string;
};

export type ClaimExtractionEvaluationReport = {
  recordType: 'case_graph_claim_extraction_evaluation_report';
  schemaVersion: typeof CLAIM_EXTRACTION_EVALUATION_VERSION;
  fixtureId: string;
  fixtureDigest: string;
  extractionBatchDigest: string;
  adjudicationReceiptDigest: string;
  counts: {
    gold: number;
    proposedGold: number;
    acceptedGold: number;
    disputedGold: number;
    deferredGold: number;
    missedGold: number;
    falseAccepted: number;
    decisionMismatches: number;
  };
  metrics: {
    proposalRecall: number;
    adjudicatedRecall: number;
    acceptedPrecision: number;
  };
  coverage: Record<ClaimExtractionGoldLabel['phenomenon'], number>;
  gate: {
    passed: boolean;
    failures: string[];
    requirements: {
      minimumGoldLabels: 6;
      requiredPhenomena: ClaimExtractionGoldLabel['phenomenon'][];
      minimumProposalRecall: 0.9;
      minimumAdjudicatedRecall: 0.9;
      minimumAcceptedPrecision: 1;
      maximumFalseAccepted: 0;
      maximumDecisionMismatches: 0;
    };
  };
  reportDigest: string;
};

const PHENOMENA: ClaimExtractionGoldLabel['phenomenon'][] = [
  'direct_observation',
  'attributed_report',
  'official_explanation',
  'denial',
  'repetition',
  'uncertain_interpretation',
];

const requireText = (value: unknown, code: string, max = 2_000): string => {
  if (typeof value !== 'string' || !value.length || value.length > max || value.trim() !== value) invalid(code);
  return value as string;
};

const requireId = (value: unknown, code: string): string => {
  const result = requireText(value, code, 240);
  if (!ID_PATTERN.test(result)) invalid(code);
  return result;
};

const labelKey = (value: Omit<ClaimExtractionGoldLabel, 'labelId' | 'expectedDecision' | 'phenomenon'>) => (
  relationshipInputSha256({
    segmentDigest: value.segmentDigest,
    quoteStart: value.quoteStart,
    quoteEnd: value.quoteEnd,
    subject: value.subject,
    predicate: value.predicate,
    object: value.object,
    polarity: value.polarity,
    modality: value.modality,
  })
);

export const buildClaimExtractionEvaluationFixture = (params: {
  fixtureId: string;
  fixtureNature: ClaimExtractionEvaluationFixture['fixtureNature'];
  constructionNotice: string;
  extractionBatch: ClaimExtractionBatch;
  goldLabels: Array<Omit<ClaimExtractionGoldLabel, 'labelId'>>;
}): ClaimExtractionEvaluationFixture => {
  const batch = verifyClaimExtractionBatch(params.extractionBatch);
  const segments = new Map(batch.segments.map((segment) => [segment.segmentDigest, segment]));
  const goldLabels = params.goldLabels.map((draft) => {
    const segment = segments.get(draft.segmentDigest) ?? invalid('claim_extraction_evaluation_segment_missing');
    if (!Number.isSafeInteger(draft.quoteStart) || !Number.isSafeInteger(draft.quoteEnd)
      || draft.quoteStart < 0 || draft.quoteEnd <= draft.quoteStart || draft.quoteEnd > segment.text.length
      || !PHENOMENA.includes(draft.phenomenon)
      || !['accept', 'dispute'].includes(draft.expectedDecision)) invalid('claim_extraction_evaluation_label_invalid');
    const core = {
      segmentDigest: draft.segmentDigest,
      quoteStart: draft.quoteStart,
      quoteEnd: draft.quoteEnd,
      subject: requireText(draft.subject, 'claim_extraction_evaluation_label_invalid', 500),
      predicate: requireId(draft.predicate, 'claim_extraction_evaluation_label_invalid'),
      object: requireText(draft.object, 'claim_extraction_evaluation_label_invalid'),
      polarity: draft.polarity,
      modality: draft.modality,
      expectedDecision: draft.expectedDecision,
      phenomenon: draft.phenomenon,
    };
    if (!['asserted', 'denied'].includes(core.polarity)
      || !['observed', 'reported', 'inferred', 'alleged', 'unknown'].includes(core.modality)) {
      invalid('claim_extraction_evaluation_label_invalid');
    }
    const key = labelKey(core);
    return { ...core, labelId: `gold-claim:${key}` };
  }).sort((left, right) => compareText(left.labelId, right.labelId));
  if (new Set(goldLabels.map((label) => label.labelId)).size !== goldLabels.length) {
    invalid('claim_extraction_evaluation_label_duplicate');
  }
  if (params.fixtureNature === 'synthetic_non_evidential'
    && !params.constructionNotice.toLowerCase().includes('synthetic')) {
    invalid('claim_extraction_evaluation_notice_invalid');
  }
  const withoutDigest = {
    recordType: 'case_graph_claim_extraction_evaluation_fixture' as const,
    schemaVersion: CLAIM_EXTRACTION_EVALUATION_VERSION,
    fixtureId: requireId(params.fixtureId, 'claim_extraction_evaluation_id_invalid'),
    fixtureNature: params.fixtureNature,
    constructionNotice: requireText(params.constructionNotice, 'claim_extraction_evaluation_notice_invalid'),
    extractionBatch: batch,
    goldLabels,
  };
  return { ...withoutDigest, fixtureDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyClaimExtractionEvaluationFixture = (
  value: ClaimExtractionEvaluationFixture,
): ClaimExtractionEvaluationFixture => {
  const expected = buildClaimExtractionEvaluationFixture(value);
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_extraction_evaluation_fixture_integrity_failed');
  }
  return expected;
};

export const evaluateClaimExtraction = (params: {
  fixture: ClaimExtractionEvaluationFixture;
  receipt: ClaimAdjudicationReceipt;
}): ClaimExtractionEvaluationReport => {
  const fixture = verifyClaimExtractionEvaluationFixture(params.fixture);
  const receipt = verifyClaimAdjudicationReceipt({ batch: fixture.extractionBatch, receipt: params.receipt });
  const proposals = new Map(fixture.extractionBatch.proposals.map((proposal) => [labelKey(proposal), proposal]));
  const decisions = new Map(receipt.decisions.map((decision) => [decision.proposalId, decision]));
  const goldKeys = new Set(fixture.goldLabels.map(labelKey));
  let proposedGold = 0;
  let acceptedGold = 0;
  let disputedGold = 0;
  let deferredGold = 0;
  let decisionMismatches = 0;
  for (const label of fixture.goldLabels) {
    const proposal = proposals.get(labelKey(label));
    if (!proposal) continue;
    proposedGold += 1;
    const decision = decisions.get(proposal.proposalId);
    if (decision?.decision === 'accept') acceptedGold += 1;
    if (decision?.decision === 'dispute') disputedGold += 1;
    if (decision?.decision === 'defer') deferredGold += 1;
    if (decision && ['accept', 'dispute'].includes(decision.decision)
      && decision.decision !== label.expectedDecision) decisionMismatches += 1;
  }
  const accepted = fixture.extractionBatch.proposals.filter((proposal) => (
    decisions.get(proposal.proposalId)?.decision === 'accept'
  ));
  const falseAccepted = accepted.filter((proposal) => !goldKeys.has(labelKey(proposal))).length;
  const adjudicatedGold = acceptedGold + disputedGold;
  const proposalRecall = fixture.goldLabels.length ? proposedGold / fixture.goldLabels.length : 0;
  const adjudicatedRecall = fixture.goldLabels.length ? adjudicatedGold / fixture.goldLabels.length : 0;
  const acceptedPrecision = accepted.length ? (accepted.length - falseAccepted) / accepted.length : 0;
  const coverage = Object.fromEntries(PHENOMENA.map((phenomenon) => [
    phenomenon,
    fixture.goldLabels.filter((label) => label.phenomenon === phenomenon).length,
  ])) as ClaimExtractionEvaluationReport['coverage'];
  const failures: string[] = [];
  if (fixture.goldLabels.length < 6) failures.push('insufficient_gold_labels');
  for (const phenomenon of PHENOMENA) if (coverage[phenomenon] < 1) failures.push(`missing_phenomenon:${phenomenon}`);
  if (proposalRecall < 0.9) failures.push('proposal_recall_below_0.9');
  if (adjudicatedRecall < 0.9) failures.push('adjudicated_recall_below_0.9');
  if (acceptedPrecision < 1) failures.push('accepted_precision_below_1');
  if (falseAccepted > 0) failures.push('false_accepted_claims_present');
  if (decisionMismatches > 0) failures.push('gold_decision_mismatches_present');
  const withoutDigest = {
    recordType: 'case_graph_claim_extraction_evaluation_report' as const,
    schemaVersion: CLAIM_EXTRACTION_EVALUATION_VERSION,
    fixtureId: fixture.fixtureId,
    fixtureDigest: fixture.fixtureDigest,
    extractionBatchDigest: fixture.extractionBatch.batchDigest,
    adjudicationReceiptDigest: receipt.receiptDigest,
    counts: {
      gold: fixture.goldLabels.length,
      proposedGold,
      acceptedGold,
      disputedGold,
      deferredGold,
      missedGold: fixture.goldLabels.length - adjudicatedGold,
      falseAccepted,
      decisionMismatches,
    },
    metrics: { proposalRecall, adjudicatedRecall, acceptedPrecision },
    coverage,
    gate: {
      passed: failures.length === 0,
      failures,
      requirements: {
        minimumGoldLabels: 6 as const,
        requiredPhenomena: PHENOMENA,
        minimumProposalRecall: 0.9 as const,
        minimumAdjudicatedRecall: 0.9 as const,
        minimumAcceptedPrecision: 1 as const,
        maximumFalseAccepted: 0 as const,
        maximumDecisionMismatches: 0 as const,
      },
    },
  };
  return { ...withoutDigest, reportDigest: relationshipInputSha256(withoutDigest) };
};
