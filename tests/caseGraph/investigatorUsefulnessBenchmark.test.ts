import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexInvestigatorBenchmarkReport,
  CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION,
  type CaseVortexBenchmarkObservation,
  type CaseVortexInvestigatorBenchmarkInput,
} from '../../src/caseGraph/investigatorUsefulnessBenchmark';
import { verifyCaseVortexAuthoritativeEvidenceArtifact } from '../../src/caseGraph/authoritativeEvidenceArtifact';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildCaseVortexInvestigatorStudyPlan,
  freezeCaseVortexInvestigatorStudyPlan,
  sealCaseVortexInvestigatorStudyAdjudications,
  type CaseVortexInvestigatorStudyPlan,
} from '../../src/caseGraph/investigatorStudyPlan';

const REVIEWER_A = 'a'.repeat(64);
const REVIEWER_B = 'b'.repeat(64);
const digest = (namespace: number, index: number) => (
  (namespace * 1_000_000 + index + 1).toString(16).padStart(64, '0')
);

const studyPlan = () => {
  const pending = buildCaseVortexInvestigatorStudyPlan({
    planId: 'benchmark-2026-07-18-plan',
    publicationId: '123e4567-e89b-42d3-a456-426614174000',
    corpusVersion: 'verified-v2-test',
    manifestSha256: 'c'.repeat(64),
  });
  const frozenAt = '2026-07-18T14:00:00.000Z';
  const adjudicatorIdHash = digest(8, 0);
  return freezeCaseVortexInvestigatorStudyPlan(pending, {
    frozenAt,
    adjudicatorIdHash,
    adjudications: sealCaseVortexInvestigatorStudyAdjudications({
      plan: pending,
      frozenAt,
      adjudicatorIdHash,
      adjudications: pending.slots.map((slot, index) => {
      const question = `Investigation question ${index}`;
      const expectedRelevantAddresses = [
        `sighting:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      ];
      return {
        slotId: slot.slotId,
        question,
        expectedRelevantAddresses,
      };
      }),
    }),
  });
};

const observation = (
  index: number,
  plan: CaseVortexInvestigatorStudyPlan,
): CaseVortexBenchmarkObservation => {
  const slot = plan.slots[index];
  const address = `sighting:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const citationId = `citation-${index}`;
  return {
    observationId: `observation-${String(index).padStart(3, '0')}`,
    studySlotId: slot.slotId,
    queryId: slot.queryId,
    journey: slot.journey,
    question: slot.question!,
    reviewerIdHash: slot.reviewerLane === 'reviewer_a' ? REVIEWER_A : REVIEWER_B,
    expectedRelevantAddresses: [...slot.expectedRelevantAddresses],
    returnedTop20Addresses: [address],
    firstResultMs: 250 + index,
    fabricatedIdentifiers: [],
    unsupportedExhaustiveClaims: [],
    requiredCapabilities: [...slot.requiredCapabilities],
    satisfiedCapabilities: [...slot.requiredCapabilities],
    citations: [{
      citationId,
      sourceLocator: `https://example.test/source/${index}#page=1`,
      resolvable: true,
      quoted: index % 3 === 0,
      quoteVerified: index % 3 === 0,
    }],
    claims: [{
      claimId: `claim-${index}`,
      material: true,
      citationIds: [citationId],
    }],
    reconstruction: slot.requiresSourceReconstruction ? {
      sourceLocatorResolved: true,
      evidenceChainReproduced: true,
    } : null,
    surfaceProof: {
      orb: true, keyboard: true, luna: true, mobile: true, reducedMotion: true,
      artifactSha256: digest(1, index),
    },
    reviewOutcome: {
      correct: true,
      useful: true,
      misleading: false,
      completedWithoutDeveloperHelp: true,
      reviewReceiptSha256: digest(2, index),
    },
    evidenceProof: {
      publicationBound: true,
      toolTraceSha256: digest(3, index),
      packetSha256: digest(4, index),
      packetReplayed: true,
      counterevidenceRetained: true,
      missingnessDisclosed: true,
    },
    productManualSourceSwitches: 0,
    productAuditTrailScore: 5,
    comparisonRuns: [{
      tool: 'direct_archive', completed: true, equivalentPublicMaterial: true,
      timeToAnswerMs: 4_000, manualSourceSwitches: 3, auditTrailScore: 2,
      toolName: 'Direct archive search', toolVersion: '2026-07-18', resultSha256: digest(5, index),
    }, {
      tool: 'generic_model', completed: true, equivalentPublicMaterial: true,
      timeToAnswerMs: 1_000, manualSourceSwitches: 0, auditTrailScore: 2,
      toolName: 'Generic comparison model', toolVersion: '2026-07-18', resultSha256: digest(6, index),
    }],
  };
};

const input = (): CaseVortexInvestigatorBenchmarkInput => {
  const plan = studyPlan();
  return {
    recordType: 'case_vortex_investigator_benchmark_input',
    schemaVersion: CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION,
    benchmarkId: 'benchmark-2026-07-18',
    completedAt: '2026-07-18T15:00:00.000Z',
    publication: { ...plan.publication },
    studyPlan: plan,
    observations: Array.from({ length: 200 }, (_, index) => observation(index, plan)),
  };
};

describe('Case Vortex investigator usefulness benchmark', () => {
  it('permits the bounded best-available claim only when every hard criterion passes', () => {
    const report = buildCaseVortexInvestigatorBenchmarkReport(input());

    expect(report.eligibleForBestAvailableClaim).toBe(true);
    expect(report.accounting).toMatchObject({
      reviewedQueryCount: 200,
      reviewObservationCount: 200,
      studyPlanSlotCount: 200,
      distinctEvidenceArtifactCount: 1_400,
      sourceReconstructionCount: 50,
      independentReviewerCount: 2,
      fabricatedIdentifierCount: 0,
      unsupportedExhaustiveClaimCount: 0,
      requiredCapabilityCheckCount: 600,
      satisfiedCapabilityCheckCount: 600,
      citationCount: 200,
      resolvedCitationCount: 200,
      materialClaimCount: 200,
      citationSupportedMaterialClaimCount: 200,
      expectedRelevantCount: 200,
      relevantReturnedAt20Count: 200,
      successfulReconstructionCount: 50,
      reproducibleObservationCount: 200,
      correctReviewCount: 200,
      usefulReviewCount: 200,
      misleadingReviewCount: 0,
      independentCompletionCount: 200,
      comparisonRunCount: 400,
      comparisonWinCount: 400,
      journeysWithSurfaceProof: 10,
      journeysWithComparisonProof: 10,
    });
    expect(report.metrics).toMatchObject({
      citationResolutionRate: 1,
      quoteVerificationRate: 1,
      materialClaimCitationSupportRate: 1,
      recallAt20: 1,
      reconstructionSuccessRate: 1,
      capabilitySatisfactionRate: 1,
      correctReviewRate: 1,
      usefulReviewRate: 1,
      independentCompletionRate: 1,
      packetReplayRate: 1,
      comparisonWinRate: 1,
    });
    expect(report.metrics.p95FirstResultMs).toBeLessThan(2_000);
    expect(report.journeys).toHaveLength(10);
    expect(report.journeys.every(({ queryCount, independentReviewerCount }) => (
      queryCount === 20 && independentReviewerCount === 2
    ))).toBe(true);
    expect(report.criteria.every(({ passed }) => passed)).toBe(true);
    expect(report.reportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'investigator_benchmark', artifactBody: Buffer.from(JSON.stringify(report)),
      artifactInputBody: Buffer.from(JSON.stringify(input())),
      publication: input().publication, verifiedAt: '2026-07-18T15:01:00.000Z',
    })).toMatchObject({ gate: 'investigator_benchmark', publication: input().publication });
  });

  it('fails the claim when safety, grounding, recall, latency, or reconstruction evidence regresses', () => {
    const candidate = input();
    for (let index = 0; index < 11; index += 1) {
      candidate.observations[index].returnedTop20Addresses = [];
      candidate.observations[index].firstResultMs = 2_500;
    }
    candidate.observations[0].fabricatedIdentifiers = ['edge:invented'];
    candidate.observations[0].unsupportedExhaustiveClaims = ['Every other corpus record was excluded.'];
    for (let index = 0; index < 5; index += 1) {
      candidate.observations[index].satisfiedCapabilities = [];
    }
    candidate.observations[0].citations[0].resolvable = false;
    candidate.observations[0].citations[0].quoteVerified = false;
    for (let index = 0; index < 5; index += 1) {
      candidate.observations[index].claims[0].citationIds = [];
    }
    candidate.observations[0].reconstruction = {
      sourceLocatorResolved: false,
      evidenceChainReproduced: false,
    };

    const report = buildCaseVortexInvestigatorBenchmarkReport(candidate);
    const failed = new Set(report.criteria.filter(({ passed }) => !passed).map(({ criterion }) => criterion));

    expect(report.eligibleForBestAvailableClaim).toBe(false);
    expect(failed).toEqual(new Set([
      'fabricated_identifiers',
      'unsupported_exhaustive_claims',
      'capability_satisfaction_rate',
      'citation_resolution_rate',
      'quote_verification_rate',
      'material_claim_citation_support_rate',
      'recall_at_20',
      'p95_first_result_ms',
      'reconstruction_success_rate',
    ]));
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'investigator_benchmark', artifactBody: Buffer.from(JSON.stringify(report)),
      artifactInputBody: Buffer.from(JSON.stringify(candidate)),
      publication: candidate.publication, verifiedAt: '2026-07-18T15:01:00.000Z',
    })).toThrow('case_vortex_authoritative_investigator_gate_failed');
  });

  it('fails closed when the benchmark is too small or a journey has only one reviewer', () => {
    const candidate = input();
    candidate.observations = candidate.observations.slice(0, 40)
      .map((item) => ({ ...item, reviewerIdHash: REVIEWER_A }));

    expect(() => buildCaseVortexInvestigatorBenchmarkReport(candidate))
      .toThrow('case_vortex_investigator_benchmark_study_plan_mismatch');
  });

  it('rejects missing or duplicated study slots instead of letting convenient reviews replace the frozen plan', () => {
    const candidate = input();
    candidate.observations[1].studySlotId = candidate.observations[0].studySlotId;

    expect(() => buildCaseVortexInvestigatorBenchmarkReport(candidate))
      .toThrow('case_vortex_investigator_benchmark_study_plan_mismatch');
  });

  it('requires reproducible evidence, all research surfaces, honest review and real comparison runs', () => {
    const candidate = input();
    candidate.observations.forEach((item) => {
      item.surfaceProof.keyboard = false;
      item.reviewOutcome.correct = false;
      item.reviewOutcome.useful = false;
      item.reviewOutcome.misleading = true;
      item.reviewOutcome.completedWithoutDeveloperHelp = false;
      item.evidenceProof.packetReplayed = false;
      item.evidenceProof.counterevidenceRetained = false;
      item.comparisonRuns = item.comparisonRuns.map((run) => ({
        ...run,
        completed: false,
        equivalentPublicMaterial: false,
      }));
    });

    const report = buildCaseVortexInvestigatorBenchmarkReport(candidate);
    const failed = new Set(report.criteria.filter(({ passed }) => !passed).map(({ criterion }) => criterion));

    expect([...failed]).toEqual(expect.arrayContaining([
      'reproducible_observations',
      'journeys_with_surface_proof',
      'journeys_with_comparison_proof',
      'misleading_review_outcomes',
      'correct_review_rate',
      'useful_review_rate',
      'independent_completion_rate',
      'packet_replay_rate',
      'comparison_win_rate',
    ]));
    expect(report.eligibleForBestAvailableClaim).toBe(false);
  });

  it('does not let empty citations or claims pass by vacuous ratios', () => {
    const candidate = input();
    candidate.observations = candidate.observations.map((item) => ({
      ...item,
      citations: [],
      claims: [],
    }));

    const report = buildCaseVortexInvestigatorBenchmarkReport(candidate);
    const failed = new Set(report.criteria.filter(({ passed }) => !passed).map(({ criterion }) => criterion));

    expect(report.eligibleForBestAvailableClaim).toBe(false);
    expect([...failed]).toEqual(expect.arrayContaining([
      'audited_citations',
      'audited_material_claims',
    ]));
  });

  it('is deterministic across observation ordering', () => {
    const first = input();
    const second = input();
    second.observations.reverse();

    expect(buildCaseVortexInvestigatorBenchmarkReport(first).reportSha256)
      .toBe(buildCaseVortexInvestigatorBenchmarkReport(second).reportSha256);
  });

  it('rejects malformed reviewers, duplicate returned records, dangling citations, and invalid timestamps', () => {
    const invalidReviewer = input();
    invalidReviewer.observations[0].reviewerIdHash = 'reviewer-name';
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(invalidReviewer))
      .toThrow('case_vortex_investigator_benchmark_reviewer_invalid');

    const duplicateResult = input();
    duplicateResult.observations[0].returnedTop20Addresses.push(
      duplicateResult.observations[0].returnedTop20Addresses[0],
    );
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(duplicateResult))
      .toThrow('case_vortex_investigator_benchmark_returned_invalid');

    const danglingCitation = input();
    danglingCitation.observations[0].claims[0].citationIds = ['not-present'];
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(danglingCitation))
      .toThrow('case_vortex_investigator_benchmark_claim_invalid');

    const unrequestedCapability = input();
    unrequestedCapability.observations[0].requiredCapabilities = [];
    unrequestedCapability.observations[0].satisfiedCapabilities = ['claim_graph'];
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(unrequestedCapability))
      .toThrow('case_vortex_investigator_benchmark_capability_invalid');

    const invalidTime = input();
    invalidTime.completedAt = '2026-07-18';
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(invalidTime))
      .toThrow('case_vortex_investigator_benchmark_completed_at_invalid');

    const aliasedQuery = input();
    aliasedQuery.observations[1].question = aliasedQuery.observations[0].question;
    aliasedQuery.observations[1].journey = aliasedQuery.observations[0].journey;
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(aliasedQuery))
      .toThrow('case_vortex_investigator_benchmark_study_plan_mismatch');

    const collapsedReviewerLanes = input();
    collapsedReviewerLanes.observations.forEach((item) => { item.reviewerIdHash = REVIEWER_A; });
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(collapsedReviewerLanes))
      .toThrow('case_vortex_investigator_benchmark_study_plan_mismatch');

    const reusedEvidenceArtifact = input();
    reusedEvidenceArtifact.observations[1].evidenceProof.toolTraceSha256 =
      reusedEvidenceArtifact.observations[0].evidenceProof.toolTraceSha256;
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(reusedEvidenceArtifact))
      .toThrow('case_vortex_investigator_benchmark_artifact_reuse_invalid');

    const tamperedPlan = input();
    tamperedPlan.studyPlan.slots[0].stratum = 'hard_negative';
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(tamperedPlan))
      .toThrow('case_vortex_investigator_benchmark_study_plan_invalid');

    const resealedUnboundReceipt = input();
    resealedUnboundReceipt.studyPlan.slots[0].adjudicationReceiptSha256 = 'f'.repeat(64);
    const { planSha256: _oldPlanDigest, ...resealedPlanBody } = resealedUnboundReceipt.studyPlan;
    resealedUnboundReceipt.studyPlan.planSha256 = relationshipInputSha256(resealedPlanBody);
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(resealedUnboundReceipt))
      .toThrow('case_vortex_investigator_benchmark_study_plan_invalid');

    const malformedPlan = input() as CaseVortexInvestigatorBenchmarkInput & {
      studyPlan: { accounting?: unknown };
    };
    malformedPlan.studyPlan.accounting = undefined;
    expect(() => buildCaseVortexInvestigatorBenchmarkReport(malformedPlan))
      .toThrow('case_vortex_investigator_benchmark_study_plan_invalid');
  });
});
