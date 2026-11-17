import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE,
  buildClaimCounterclaimCaseAnalysis,
  verifyClaimCounterclaimCaseAnalysis,
  type ClaimCounterclaimCasePlan,
} from '../../src/caseGraph/claimCounterclaimAnalysis';
import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceGraphArtifact,
  buildClaimEvidenceLink,
  buildSourceReliabilityAssessment,
  type AtomicEvidenceClaim,
  type ClaimEvidencePublicationBinding,
} from '../../src/caseGraph/claimEvidenceGraph';

const binding: ClaimEvidencePublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-23',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const claim = (params: {
  address: string;
  sourceId: string;
  subject: string;
  predicate: string;
  object: string;
  sourceText: string;
  polarity?: 'asserted' | 'denied';
}): AtomicEvidenceClaim => buildAtomicEvidenceClaim({
  binding,
  address: params.address,
  sourceId: params.sourceId,
  subject: params.subject,
  predicate: params.predicate,
  object: params.object,
  polarity: params.polarity ?? 'asserted',
  modality: 'reported',
  sourceText: params.sourceText,
  locator: {
    kind: 'document_page',
    pageNumber: 1,
    characterStart: 0,
    characterEnd: params.sourceText.length,
    boundingBox: null,
  },
  extraction: {
    method: 'manual_review',
    version: 'roswell-claim-review-v1',
    confidence: 1,
    reviewStatus: 'reviewed',
  },
});

const fixture = () => {
  const witness = claim({
    address: 'document:roswell-witness-interview',
    sourceId: 'witness_interview',
    subject: 'named witness',
    predicate: 'observed_debris',
    object: 'unusual lightweight material',
    sourceText: 'The witness described unusual lightweight material that returned to its original shape.',
  });
  const official = claim({
    address: 'document:official-roswell-report',
    sourceId: 'us_air_force',
    subject: 'United States Air Force',
    predicate: 'explained_debris_as',
    object: 'Project Mogul balloon material',
    sourceText: 'The report attributed the recovered debris to Project Mogul balloon material.',
  });
  const radar = claim({
    address: 'document:independent-radar-log',
    sourceId: 'radar_station',
    subject: 'radar station',
    predicate: 'recorded_track',
    object: 'anomalous return during the event window',
    sourceText: 'The radar log records an anomalous return during the event window.',
  });
  const copy = claim({
    address: 'document:later-catalogue-copy',
    sourceId: 'later_catalogue',
    subject: 'named witness',
    predicate: 'observed_debris',
    object: 'unusual lightweight material',
    sourceText: 'The later catalogue repeats the witness description from the earlier interview.',
  });
  const image = claim({
    address: 'image:unverified-debris-photograph',
    sourceId: 'private_collection',
    subject: 'unverified photograph',
    predicate: 'depicts',
    object: 'material alleged to be event debris',
    sourceText: 'The catalogue alleges that the photograph depicts debris from the event.',
  });

  const link = (
    from: AtomicEvidenceClaim,
    to: AtomicEvidenceClaim,
    stance: 'supports' | 'contradicts' | 'repeats' | 'contextualizes' | 'uncertain',
    lineage: 'independent' | 'shared_lineage' | 'unknown',
    rationale: string,
  ) => buildClaimEvidenceLink({
    binding,
    fromClaimId: from.claimId,
    toClaimId: to.claimId,
    stance,
    lineage,
    rationale,
    confidence: 0.9,
    determination: {
      method: 'manual_review',
      version: 'roswell-link-review-v1',
      reviewStatus: 'reviewed',
    },
  });

  const reliability = (target: AtomicEvidenceClaim, sourceLabel: string) => buildSourceReliabilityAssessment({
    binding,
    address: target.address,
    sourceId: target.sourceId,
    sourceLabel,
    lineageId: target.sourceId,
    dimensions: {
      sourcePosition: {
        value: 'primary',
        reasonCodes: ['originating_record'],
        explanation: 'This is the originating record for the attributed statement.',
      },
      contemporaneity: {
        value: 'retrospective',
        reasonCodes: ['recorded_after_event'],
        explanation: 'The record was created after the event.',
      },
      witnessIdentity: {
        value: target === official ? 'institutional' : 'named',
        reasonCodes: ['attributable_source'],
        explanation: 'The source is attributable.',
      },
      originality: {
        value: 'original',
        reasonCodes: ['original_record'],
        explanation: 'The assessed item is not catalogued as a copy.',
      },
      independence: {
        value: 'independent',
        reasonCodes: ['separate_lineage'],
        explanation: 'The source lineage is treated as separate in this fixture.',
      },
      provenance: {
        value: 'partial',
        reasonCodes: ['archive_gap'],
        explanation: 'Part of the custody history remains unresolved.',
      },
      corroboration: {
        value: 'single_independent',
        reasonCodes: ['one_independent_source'],
        explanation: 'One separate source lineage is linked.',
        independentSourceCount: 1,
        sharedLineageSourceCount: 0,
      },
    },
    limitations: ['Source quality does not establish whether the attributed claim is true.'],
    assessedBy: {
      method: 'manual_review',
      version: 'roswell-reliability-review-v1',
      reviewStatus: 'reviewed',
    },
  });

  const graph = buildClaimEvidenceGraphArtifact({
    binding,
    claims: [copy, official, image, radar, witness],
    links: [
      link(radar, witness, 'supports', 'independent', 'The dated track may independently support activity during the reported window.'),
      link(copy, witness, 'repeats', 'shared_lineage', 'The catalogue explicitly repeats the earlier interview.'),
      link(official, witness, 'contradicts', 'independent', 'The official material explanation conflicts with the witness interpretation.'),
      link(image, witness, 'uncertain', 'unknown', 'The photograph attribution has not been authenticated.'),
      link(radar, official, 'contextualizes', 'independent', 'The log supplies event-window context without resolving debris identity.'),
    ],
    sourceReliability: [
      reliability(witness, 'Witness interview'),
      reliability(official, 'United States Air Force report'),
      reliability(radar, 'Radar station log'),
    ],
  });
  const plan: ClaimCounterclaimCasePlan = {
    caseId: 'roswell-1947',
    title: 'Roswell 1947 evidence positions',
    scopeAddresses: graph.claims.map(({ address }) => address),
    focalClaimIds: [witness.claimId, official.claimId],
    witnessClaimIds: [witness.claimId],
    officialConclusionClaimIds: [official.claimId],
    unresolvedQuestions: [{
      question: 'Can the photographed material be authenticated to the recovered debris?',
      relevantClaimIds: [witness.claimId],
      evidenceNeeded: [
        'A documented chain of custody for the photographed material.',
        'Independent forensic examination of the original material.',
      ],
      status: 'open',
    }],
    limitations: [
      'This comparison preserves attributed positions and does not decide the underlying event.',
      'Absence of a source-reliability assessment is a provenance gap, not negative evidence.',
    ],
    preparedBy: {
      method: 'manual_review',
      version: 'roswell-analysis-review-v1',
      reviewStatus: 'reviewed',
    },
  };
  return { graph, plan, claims: { witness, official, radar, copy, image } };
};

describe('claim-versus-counterclaim case analysis', () => {
  it('preserves attributed positions, exact locators, reliability and unresolved questions', () => {
    const { graph, plan, claims } = fixture();
    const analysis = buildClaimCounterclaimCaseAnalysis({ graph, plan });

    expect(analysis.witnessClaims).toHaveLength(1);
    expect(analysis.witnessClaims[0]?.claim.claimId).toBe(claims.witness.claimId);
    expect(analysis.witnessClaims[0]?.claim.locator).toEqual(expect.objectContaining({
      kind: 'document_page',
      pageNumber: 1,
    }));
    expect(analysis.officialConclusions[0]?.claim.claimId).toBe(claims.official.claimId);
    expect(analysis.officialConclusions[0]?.sourceReliability?.overall.category).toBe('medium');
    expect(analysis.contradictions[0]).toMatchObject({
      independentCorroborationCredit: false,
      accountingExplanation: 'contradiction_requires_review_not_truth_resolution',
    });
    expect(analysis.unresolvedQuestions[0]).toMatchObject({
      status: 'open',
      relevantClaims: [{ claim: { claimId: claims.witness.claimId } }],
    });
    expect(analysis.claimDiscipline.contradiction).toContain('do_not_resolve');
    expect(analysis.analysisDiscipline).toEqual(CASE_GRAPH_CLAIM_COUNTERCLAIM_DISCIPLINE);
    expect(analysis.analysisDiscipline.officialStatus).toContain('does_not_establish_correctness');
    expect(analysis.analysisDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('counts only independent support and never credits repetition as corroboration', () => {
    const { graph, plan } = fixture();
    const analysis = buildClaimCounterclaimCaseAnalysis({ graph, plan });

    expect(analysis.accounting).toMatchObject({
      supportingEvidenceCount: 1,
      independentSupportCount: 1,
      supportWithoutIndependentCreditCount: 0,
      contradictionCount: 1,
      repetitionCount: 1,
      contextualEvidenceCount: 1,
      uncertainRelationshipCount: 1,
    });
    expect(analysis.repetitions[0]).toMatchObject({
      independentCorroborationCredit: false,
      accountingExplanation: 'repetition_retained_not_counted_as_corroboration',
    });
  });

  it('is deterministic across input ordering and verifies exact output integrity', () => {
    const { graph, plan } = fixture();
    const first = buildClaimCounterclaimCaseAnalysis({ graph, plan });
    const second = buildClaimCounterclaimCaseAnalysis({
      graph,
      plan: {
        ...plan,
        scopeAddresses: [...plan.scopeAddresses].reverse(),
        focalClaimIds: [...plan.focalClaimIds].reverse(),
        unresolvedQuestions: plan.unresolvedQuestions.map((question) => ({
          ...question,
          evidenceNeeded: [...question.evidenceNeeded].reverse(),
        })),
        limitations: [...plan.limitations].reverse(),
      },
    });
    expect(second).toEqual(first);
    expect(verifyClaimCounterclaimCaseAnalysis({ graph, analysis: first })).toEqual(first);
  });

  it('fails closed for missing, out-of-scope, overlapping or tampered claims and accounting', () => {
    const { graph, plan, claims } = fixture();
    expect(() => buildClaimCounterclaimCaseAnalysis({
      graph,
      plan: { ...plan, scopeAddresses: ['document:official-roswell-report'] },
    })).toThrow('claim_counterclaim_claim_out_of_scope');
    expect(() => buildClaimCounterclaimCaseAnalysis({
      graph,
      plan: {
        ...plan,
        officialConclusionClaimIds: [claims.witness.claimId],
      },
    })).toThrow('claim_counterclaim_role_overlap');
    expect(() => buildClaimCounterclaimCaseAnalysis({
      graph,
      plan: {
        ...plan,
        unresolvedQuestions: [{
          ...plan.unresolvedQuestions[0]!,
          relevantClaimIds: [claims.radar.claimId],
        }],
      },
    })).toThrow('claim_counterclaim_question_claim_invalid');
    expect(() => buildClaimCounterclaimCaseAnalysis({
      graph,
      plan: { ...plan, unresolvedQuestions: [] },
    })).toThrow('claim_counterclaim_question_missing');
    expect(() => buildClaimCounterclaimCaseAnalysis({
      graph,
      plan: { ...plan, limitations: [] },
    })).toThrow('claim_counterclaim_limitation_missing');

    const analysis = buildClaimCounterclaimCaseAnalysis({ graph, plan });
    expect(() => verifyClaimCounterclaimCaseAnalysis({
      graph,
      analysis: {
        ...analysis,
        accounting: { ...analysis.accounting, independentSupportCount: 99 },
      },
    })).toThrow('claim_counterclaim_analysis_integrity_failed');
    expect(() => buildClaimCounterclaimCaseAnalysis({
      graph: {
        ...graph,
        claims: graph.claims.map((item) => (
          item.claimId === claims.witness.claimId ? { ...item, object: 'tampered' } : item
        )),
      },
      plan,
    })).toThrow('claim_counterclaim_graph_integrity_failed');
  });
});
