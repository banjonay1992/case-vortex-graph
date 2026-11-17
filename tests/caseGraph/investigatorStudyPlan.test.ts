import { describe, expect, it, vi } from 'vitest';

import {
  buildCaseVortexInvestigatorStudyPlan,
  CASE_VORTEX_INVESTIGATOR_QUERY_STRATA,
  freezeCaseVortexInvestigatorStudyPlan,
  sealCaseVortexInvestigatorStudyAdjudications,
  verifyCaseVortexInvestigatorStudyPlan,
} from '../../src/caseGraph/investigatorStudyPlan';
import {
  CASE_VORTEX_INVESTIGATOR_CAPABILITIES,
  CASE_VORTEX_INVESTIGATOR_JOURNEYS,
} from '../../src/caseGraph/investigatorUsefulnessBenchmark';
import { runCaseVortexInvestigatorStudyPlanCli } from '../../src/cli/buildCaseVortexInvestigatorStudyPlan';

const input = {
  planId: 'authoritative-study-v1',
  publicationId: 'publication-v2',
  corpusVersion: 'corpus-v2',
  manifestSha256: 'a'.repeat(64),
};

describe('Case Vortex investigator study plan', () => {
  it('builds a deterministic balanced 200-query and 50-reconstruction protocol', () => {
    const first = buildCaseVortexInvestigatorStudyPlan(input);
    const second = buildCaseVortexInvestigatorStudyPlan(input);

    expect(first).toEqual(second);
    expect(first.slots).toHaveLength(200);
    expect(first.slots.filter(({ requiresSourceReconstruction }) => requiresSourceReconstruction))
      .toHaveLength(50);
    expect(verifyCaseVortexInvestigatorStudyPlan(first)).toBe(true);
    expect(new Set(first.slots.flatMap(({ requiredCapabilities }) => requiredCapabilities)))
      .toEqual(new Set(CASE_VORTEX_INVESTIGATOR_CAPABILITIES));
    for (const journey of CASE_VORTEX_INVESTIGATOR_JOURNEYS) {
      const slots = first.slots.filter((slot) => slot.journey === journey);
      expect(slots).toHaveLength(20);
      expect(new Set(slots.map(({ reviewerLane }) => reviewerLane)))
        .toEqual(new Set(['reviewer_a', 'reviewer_b']));
      for (const stratum of CASE_VORTEX_INVESTIGATOR_QUERY_STRATA) {
        expect(slots.filter((slot) => slot.stratum === stratum)).toHaveLength(4);
      }
    }
    expect(first.slots.every((slot) => (
      slot.question === null
      && slot.expectedRelevantAddresses.length === 0
      && slot.adjudicationStatus === 'pending'
      && slot.adjudicationReceiptSha256 === null
      && slot.requiredComparisons.join(',') === 'direct_archive,generic_model'
      && slot.requiredSurfaces.length === 5
    ))).toBe(true);
    expect(first.frozenAt).toBeNull();
    expect(first.adjudicatorIdHash).toBeNull();
    expect(first.safeguards).toEqual({
      syntheticAnswersAllowed: false,
      fixtureEvidenceCountsAsHumanReview: false,
      publicationMutationAllowed: false,
      networkCallsDuringGeneration: 0,
      lunaCallsDuringGeneration: 0,
    });
  });

  it('freezes every human-adjudicated question and expected record before product runs', () => {
    const pending = buildCaseVortexInvestigatorStudyPlan(input);
    const frozenAt = '2026-07-18T12:00:00.000Z';
    const adjudicatorIdHash = 'b'.repeat(64);
    const frozen = freezeCaseVortexInvestigatorStudyPlan(pending, {
      frozenAt,
      adjudicatorIdHash,
      adjudications: sealCaseVortexInvestigatorStudyAdjudications({
        plan: pending,
        frozenAt,
        adjudicatorIdHash,
        adjudications: pending.slots.map((slot, index) => {
        const question = `Pre-registered investigation ${index}`;
        const expectedRelevantAddresses = index % 5 === 2 ? [] : [`sighting:${index}`];
        return {
          slotId: slot.slotId,
          question,
          expectedRelevantAddresses,
        };
        }),
      }),
    });

    expect(verifyCaseVortexInvestigatorStudyPlan(frozen)).toBe(true);
    expect(frozen.frozenAt).toBe('2026-07-18T12:00:00.000Z');
    expect(frozen.adjudicatorIdHash).toBe('b'.repeat(64));
    expect(frozen.slots).toHaveLength(200);
    expect(frozen.slots.every((slot) => (
      slot.adjudicationStatus === 'frozen'
      && typeof slot.question === 'string'
      && /^[a-f0-9]{64}$/u.test(slot.adjudicationReceiptSha256 || '')
    ))).toBe(true);
    expect(() => freezeCaseVortexInvestigatorStudyPlan(frozen, {
      frozenAt: '2026-07-18T13:00:00.000Z',
      adjudicatorIdHash: 'b'.repeat(64),
      adjudications: [],
    })).toThrow('case_vortex_investigator_study_adjudication_invalid');
  });

  it('rejects a receipt copied between slots or retained after adjudication content changes', () => {
    const pending = buildCaseVortexInvestigatorStudyPlan(input);
    const frozenAt = '2026-07-18T12:00:00.000Z';
    const adjudicatorIdHash = 'b'.repeat(64);
    const adjudications = sealCaseVortexInvestigatorStudyAdjudications({
      plan: pending,
      frozenAt,
      adjudicatorIdHash,
      adjudications: pending.slots.map((slot, index) => {
      const question = `Receipt-bound investigation ${index}`;
      const expectedRelevantAddresses = index % 5 === 2 ? [] : [`sighting:${index}`];
      return {
        slotId: slot.slotId,
        question,
        expectedRelevantAddresses,
      };
      }),
    });
    const substituted = structuredClone(adjudications);
    substituted[0].adjudicationReceiptSha256 = substituted[1].adjudicationReceiptSha256;
    expect(() => freezeCaseVortexInvestigatorStudyPlan(pending, {
      frozenAt, adjudicatorIdHash, adjudications: substituted,
    })).toThrow('case_vortex_investigator_study_adjudication_invalid');

    const edited = structuredClone(adjudications);
    edited[0].question = 'Question edited after its receipt was created';
    expect(() => freezeCaseVortexInvestigatorStudyPlan(pending, {
      frozenAt, adjudicatorIdHash, adjudications: edited,
    })).toThrow('case_vortex_investigator_study_adjudication_invalid');
  });

  it('detects tampering and rejects invalid publication bindings', () => {
    const plan = buildCaseVortexInvestigatorStudyPlan(input);
    const tampered = structuredClone(plan);
    tampered.slots[0].reviewerLane = 'reviewer_b';
    expect(verifyCaseVortexInvestigatorStudyPlan(tampered)).toBe(false);
    expect(() => buildCaseVortexInvestigatorStudyPlan({ ...input, manifestSha256: 'bad' }))
      .toThrow('case_vortex_investigator_study_manifest_sha256_invalid');
    expect(() => buildCaseVortexInvestigatorStudyPlan({ ...input, planId: ' ' }))
      .toThrow('case_vortex_investigator_study_plan_id_invalid');
    expect(verifyCaseVortexInvestigatorStudyPlan(null)).toBe(false);
    expect(verifyCaseVortexInvestigatorStudyPlan({})).toBe(false);
    expect(verifyCaseVortexInvestigatorStudyPlan([])).toBe(false);
  });

  it('writes the pending plan atomically without fabricating review evidence', async () => {
    const writes: Buffer[] = [];
    const dependencies = {
      makeDirectory: vi.fn(async () => undefined) as any,
      writeFileBytes: vi.fn(async (_path: string, bytes: Buffer) => { writes.push(bytes); }) as any,
      renameFile: vi.fn(async () => undefined) as any,
      unlinkFile: vi.fn(async () => undefined) as any,
    };
    const receipt = await runCaseVortexInvestigatorStudyPlanCli([
      '--plan-id', input.planId,
      '--publication-id', input.publicationId,
      '--corpus-version', input.corpusVersion,
      '--manifest-sha256', input.manifestSha256,
      '--output', 'reports/study-plan.json',
    ], dependencies);

    expect(receipt).toMatchObject({
      valid: true,
      query_slot_count: 200,
      source_reconstruction_slot_count: 50,
      synthetic_answers: 0,
      network_requests: 0,
      luna_calls: 0,
      publication_mutations: 0,
    });
    expect(dependencies.writeFileBytes).toHaveBeenCalledOnce();
    expect(dependencies.renameFile).toHaveBeenCalledOnce();
    const plan = JSON.parse(writes[0].toString('utf8'));
    expect(plan.slots).toHaveLength(200);
    expect(plan.slots.every((slot: { question: unknown }) => slot.question === null)).toBe(true);
  });

  it('fails closed on missing, duplicate or unknown CLI arguments', async () => {
    const dependencies = {
      makeDirectory: vi.fn() as any,
      writeFileBytes: vi.fn() as any,
      renameFile: vi.fn() as any,
      unlinkFile: vi.fn() as any,
    };
    await expect(runCaseVortexInvestigatorStudyPlanCli(['--plan-id', 'only'], dependencies))
      .rejects.toThrow('case_vortex_investigator_study_argument_required:');
    await expect(runCaseVortexInvestigatorStudyPlanCli(['--unknown', 'value'], dependencies))
      .rejects.toThrow('case_vortex_investigator_study_argument_invalid:--unknown');
    expect(dependencies.writeFileBytes).not.toHaveBeenCalled();
  });
});
