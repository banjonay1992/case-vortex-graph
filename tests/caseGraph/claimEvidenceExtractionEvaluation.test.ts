import { describe, expect, it } from 'vitest';

import {
  adjudicateClaimExtractionBatch,
  buildClaimExtractionBatch,
  buildClaimExtractionSourceSegment,
} from '../../src/caseGraph/claimEvidenceExtraction';
import {
  buildClaimExtractionEvaluationFixture,
  evaluateClaimExtraction,
  verifyClaimExtractionEvaluationFixture,
  type ClaimExtractionGoldLabel,
} from '../../src/caseGraph/claimEvidenceExtractionEvaluation';
import type { ClaimEvidencePublicationBinding } from '../../src/caseGraph/claimEvidenceGraph';

const binding: ClaimEvidencePublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const cases: Array<{
  id: string;
  text: string;
  phenomenon: ClaimExtractionGoldLabel['phenomenon'];
  predicate: string;
  polarity: ClaimExtractionGoldLabel['polarity'];
  modality: ClaimExtractionGoldLabel['modality'];
  expectedDecision: ClaimExtractionGoldLabel['expectedDecision'];
}> = [
  { id: 'direct', text: 'I observed a white oval above the ridge.', phenomenon: 'direct_observation', predicate: 'observed_object', polarity: 'asserted', modality: 'observed', expectedDecision: 'accept' },
  { id: 'report', text: 'The dispatcher reported three lights moving east.', phenomenon: 'attributed_report', predicate: 'reported_lights', polarity: 'asserted', modality: 'reported', expectedDecision: 'accept' },
  { id: 'official', text: 'The office concluded that the light was a training flare.', phenomenon: 'official_explanation', predicate: 'concluded_explanation', polarity: 'asserted', modality: 'reported', expectedDecision: 'accept' },
  { id: 'denial', text: 'The controller denied tracking an unidentified target.', phenomenon: 'denial', predicate: 'tracked_unidentified_target', polarity: 'denied', modality: 'reported', expectedDecision: 'accept' },
  { id: 'repeat', text: 'This catalogue repeats the statement from Archive A.', phenomenon: 'repetition', predicate: 'repeated_statement', polarity: 'asserted', modality: 'reported', expectedDecision: 'accept' },
  { id: 'uncertain', text: 'The narrator suggested the glow might have changed direction.', phenomenon: 'uncertain_interpretation', predicate: 'changed_direction', polarity: 'asserted', modality: 'inferred', expectedDecision: 'dispute' },
];

const makeFixture = (includeDecoy = false) => {
  const segments = cases.map((entry, index) => buildClaimExtractionSourceSegment({
    binding,
    address: `document:synthetic-eval-${entry.id}`,
    sourceId: `synthetic_source_${entry.id}`,
    sourceLabel: `Synthetic ${entry.id} source`,
    lineageId: entry.id === 'repeat' ? 'synthetic_lineage_a' : `synthetic_lineage_${entry.id}`,
    mediaKind: index === 5 ? 'video' : 'document',
    textOrigin: index === 5 ? 'human_transcript' : 'embedded_text',
    text: entry.text,
    locatorBase: index === 5
      ? { kind: 'timed_media' as const, startMilliseconds: 12_000, endMilliseconds: 16_000, frameNumber: 360 }
      : { kind: 'document_page' as const, pageNumber: index + 1, characterOffset: index * 100, boundingBox: null },
    provenance: {
      assetDigest: `${index + 1}`.repeat(64),
      extractionContractDigest: 'a'.repeat(64),
      extractionReceiptDigest: 'b'.repeat(64),
      extractionPointerDigest: 'c'.repeat(64),
    },
  }));
  const proposalDrafts = cases.map((entry, index) => ({
    segmentDigest: segments[index]!.segmentDigest,
    quoteStart: 0,
    quoteEnd: entry.text.length,
    subject: `synthetic subject ${entry.id}`,
    predicate: entry.predicate,
    object: `synthetic object ${entry.id}`,
    polarity: entry.polarity,
    modality: entry.modality,
    extraction: { method: 'governed_model' as const, version: 'fixture-extractor-v1', confidence: 0.9 },
  }));
  if (includeDecoy) proposalDrafts.push({
    segmentDigest: segments[0]!.segmentDigest,
    quoteStart: 0,
    quoteEnd: cases[0]!.text.length,
    subject: 'invented subject',
    predicate: 'invented_claim',
    object: 'invented object',
    polarity: 'asserted',
    modality: 'inferred',
    extraction: { method: 'governed_model', version: 'fixture-extractor-v1', confidence: 0.4 },
  });
  const extractionBatch = buildClaimExtractionBatch({ binding, segments, proposals: proposalDrafts });
  const goldLabels = cases.map((entry, index) => ({
    segmentDigest: segments[index]!.segmentDigest,
    quoteStart: 0,
    quoteEnd: entry.text.length,
    subject: `synthetic subject ${entry.id}`,
    predicate: entry.predicate,
    object: `synthetic object ${entry.id}`,
    polarity: entry.polarity,
    modality: entry.modality,
    expectedDecision: entry.expectedDecision,
    phenomenon: entry.phenomenon,
  }));
  return buildClaimExtractionEvaluationFixture({
    fixtureId: includeDecoy ? 'synthetic-six-paths-with-decoy-v1' : 'synthetic-six-paths-v1',
    fixtureNature: 'synthetic_non_evidential',
    constructionNotice: 'Synthetic evaluation text only. It is not a statement about any real UAP event and must never enter the evidence corpus.',
    extractionBatch,
    goldLabels,
  });
};

const adjudicate = (fixture: ReturnType<typeof makeFixture>, override?: (proposalId: string, gold: boolean) => 'accept' | 'reject' | 'dispute') => {
  const goldByKey = new Map(fixture.goldLabels.map((label) => [
    [label.segmentDigest, label.quoteStart, label.quoteEnd, label.subject, label.predicate, label.object, label.polarity, label.modality].join('|'),
    label,
  ]));
  return adjudicateClaimExtractionBatch({
    batch: fixture.extractionBatch,
    decisions: fixture.extractionBatch.proposals.map((proposal) => {
      const key = [proposal.segmentDigest, proposal.quoteStart, proposal.quoteEnd, proposal.subject, proposal.predicate, proposal.object, proposal.polarity, proposal.modality].join('|');
      const gold = goldByKey.get(key);
      return {
        proposalId: proposal.proposalId,
        decision: override?.(proposal.proposalId, Boolean(gold)) ?? gold?.expectedDecision ?? 'reject',
        rationale: gold ? 'Matches the synthetic gold label.' : 'Does not match a gold label.',
        reviewerId: 'fixture_reviewer_01',
        reviewedAt: '2026-07-20T13:00:00.000Z',
      };
    }),
  });
};

describe('claim extraction evaluation fixture and gate', () => {
  it('passes a complete six-phenomenon synthetic pack with no false acceptance', () => {
    const fixture = makeFixture();
    const report = evaluateClaimExtraction({ fixture, receipt: adjudicate(fixture) });

    expect(report.gate.passed).toBe(true);
    expect(report.counts).toEqual({
      gold: 6, proposedGold: 6, acceptedGold: 5, disputedGold: 1, deferredGold: 0, missedGold: 0, falseAccepted: 0,
      decisionMismatches: 0,
    });
    expect(report.metrics).toEqual({ proposalRecall: 1, adjudicatedRecall: 1, acceptedPrecision: 1 });
    expect(Object.values(report.coverage)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(verifyClaimExtractionEvaluationFixture(fixture)).toEqual(fixture);
  });

  it('fails when a non-gold model proposal is accepted', () => {
    const fixture = makeFixture(true);
    const receipt = adjudicate(fixture, (_proposalId, gold) => gold ? 'accept' : 'accept');
    const report = evaluateClaimExtraction({ fixture, receipt });

    expect(report.gate.passed).toBe(false);
    expect(report.counts.falseAccepted).toBe(1);
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      'accepted_precision_below_1',
      'false_accepted_claims_present',
    ]));
  });

  it('fails recall when one gold claim is rejected', () => {
    const fixture = makeFixture();
    let rejected = false;
    const receipt = adjudicate(fixture, () => {
      if (!rejected) { rejected = true; return 'reject'; }
      return 'accept';
    });
    const report = evaluateClaimExtraction({ fixture, receipt });

    expect(report.gate.passed).toBe(false);
    expect(report.metrics.adjudicatedRecall).toBeCloseTo(5 / 6);
    expect(report.gate.failures).toContain('adjudicated_recall_below_0.9');
  });

  it('rejects a synthetic fixture that is not visibly labelled synthetic', () => {
    const fixture = makeFixture();
    expect(() => buildClaimExtractionEvaluationFixture({
      ...fixture,
      constructionNotice: 'Evaluation text only.',
    })).toThrow('claim_extraction_evaluation_notice_invalid');
  });
});
