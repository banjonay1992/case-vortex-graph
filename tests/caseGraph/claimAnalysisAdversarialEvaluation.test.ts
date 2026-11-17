import { describe, expect, it } from 'vitest';

import {
  CLAIM_ANALYSIS_ADVERSARIAL_RISKS,
  buildClaimAnalysisAdversarialFixture,
  evaluateClaimAnalysisAdversarialFixture,
  verifyClaimAnalysisAdversarialFixture,
  type ClaimAnalysisAdversarialRisk,
  type ClaimAnalysisAdversarialScenario,
} from '../../src/caseGraph/claimAnalysisAdversarialEvaluation';
import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceGraphArtifact,
  buildClaimEvidenceLink,
  buildSourceReliabilityAssessment,
  type AtomicEvidenceClaim,
  type ClaimEvidencePublicationBinding,
} from '../../src/caseGraph/claimEvidenceGraph';
import { verifyCaseVortexAuthoritativeEvidenceArtifact } from '../../src/caseGraph/authoritativeEvidenceArtifact';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const binding: ClaimEvidencePublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'synthetic-adversarial-claim-evaluation-v1',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const buildClaim = (
  risk: ClaimAnalysisAdversarialRisk,
  role: string,
  predicate: string,
): AtomicEvidenceClaim => {
  const sourceText = `Synthetic ${role} statement for ${risk}.`;
  return buildAtomicEvidenceClaim({
    binding,
    address: `document:synthetic-${risk}-${role}`,
    sourceId: `synthetic_${risk}_${role}`,
    subject: `synthetic ${role}`,
    predicate,
    object: `synthetic ${role} object`,
    polarity: 'asserted',
    modality: 'reported',
    sourceText,
    locator: {
      kind: 'document_page',
      pageNumber: 1,
      characterStart: 0,
      characterEnd: sourceText.length,
      boundingBox: null,
    },
    extraction: {
      method: 'manual_review',
      version: 'synthetic-adversarial-claim-review-v1',
      confidence: 1,
      reviewStatus: 'reviewed',
    },
  });
};

const reliability = (target: AtomicEvidenceClaim) => buildSourceReliabilityAssessment({
  binding,
  address: target.address,
  sourceId: target.sourceId,
  sourceLabel: target.subject,
  lineageId: target.sourceId,
  dimensions: {
    sourcePosition: {
      value: 'primary',
      reasonCodes: ['synthetic_originating_record'],
      explanation: 'This synthetic fixture treats the item as its originating record.',
    },
    contemporaneity: {
      value: 'unknown',
      reasonCodes: ['synthetic_time_not_applicable'],
      explanation: 'The synthetic fixture has no event-time truth claim.',
    },
    witnessIdentity: {
      value: target.predicate === 'official_conclusion' ? 'institutional' : 'named',
      reasonCodes: ['synthetic_attribution'],
      explanation: 'The synthetic role is explicitly attributable inside the fixture.',
    },
    originality: {
      value: 'original',
      reasonCodes: ['synthetic_original'],
      explanation: 'The item is the original synthetic statement.',
    },
    independence: {
      value: 'independent',
      reasonCodes: ['synthetic_separate_lineage'],
      explanation: 'The fixture assigns a separate synthetic lineage.',
    },
    provenance: {
      value: 'partial',
      reasonCodes: ['synthetic_fixture_only'],
      explanation: 'This is a synthetic evaluation item rather than event evidence.',
    },
    corroboration: {
      value: 'none',
      reasonCodes: ['no_truth_credit'],
      explanation: 'No real-world corroboration is claimed.',
      independentSourceCount: 0,
      sharedLineageSourceCount: 0,
    },
  },
  limitations: ['Synthetic source-quality metadata is not a truth score.'],
  assessedBy: {
    method: 'manual_review',
    version: 'synthetic-adversarial-reliability-v1',
    reviewStatus: 'reviewed',
  },
});

const optionsForRisk = (risk: ClaimAnalysisAdversarialRisk) => ({
  independentWitnessSupport: [
    'official_authority_truth_substitution',
    'contradiction_truth_resolution',
    'false_equivalence',
    'uncertainty_erasure',
    'missing_provenance_erasure',
  ].includes(risk),
  sharedWitnessSupport: risk === 'shared_lineage_corroboration_inflation',
  contradiction: [
    'official_authority_truth_substitution',
    'contradiction_truth_resolution',
    'false_equivalence',
  ].includes(risk),
  repetition: risk === 'shared_lineage_corroboration_inflation',
  uncertain: risk === 'uncertainty_erasure',
  omitWitnessReliability: risk === 'missing_provenance_erasure',
  unresolvedOfficial: [
    'official_authority_truth_substitution',
    'false_equivalence',
    'uncertainty_erasure',
    'unsupported_conclusion',
  ].includes(risk),
});

const scenarioForRisk = (
  risk: ClaimAnalysisAdversarialRisk,
): ClaimAnalysisAdversarialScenario => {
  const options = optionsForRisk(risk);
  const witness = buildClaim(risk, 'witness', 'reported_observation');
  const official = buildClaim(risk, 'official', 'official_conclusion');
  const independent = buildClaim(risk, 'independent-support', 'reported_context');
  const shared = buildClaim(risk, 'shared-copy', 'repeated_observation');
  const uncertain = buildClaim(risk, 'uncertain-media', 'alleged_depiction');
  const link = (
    from: AtomicEvidenceClaim,
    to: AtomicEvidenceClaim,
    stance: 'supports' | 'contradicts' | 'repeats' | 'uncertain',
    lineage: 'independent' | 'shared_lineage' | 'unknown',
  ) => buildClaimEvidenceLink({
    binding,
    fromClaimId: from.claimId,
    toClaimId: to.claimId,
    stance,
    lineage,
    rationale: `Synthetic ${risk} ${stance} relationship for adversarial evaluation.`,
    confidence: .8,
    determination: {
      method: 'manual_review',
      version: 'synthetic-adversarial-link-review-v1',
      reviewStatus: 'reviewed',
    },
  });
  const links = [
    ...(options.independentWitnessSupport
      ? [link(independent, witness, 'supports', 'independent')] : []),
    ...(options.sharedWitnessSupport
      ? [link(shared, witness, 'supports', 'shared_lineage')] : []),
    ...(options.contradiction
      ? [link(official, witness, 'contradicts', 'independent')] : []),
    ...(options.repetition
      ? [link(shared, witness, 'repeats', 'shared_lineage')] : []),
    ...(options.uncertain
      ? [link(uncertain, witness, 'uncertain', 'unknown')] : []),
  ];
  const graph = buildClaimEvidenceGraphArtifact({
    binding,
    claims: [witness, official, independent, shared, uncertain],
    links,
    sourceReliability: [
      ...(!options.omitWitnessReliability ? [reliability(witness)] : []),
      reliability(official),
      reliability(independent),
      reliability(shared),
      reliability(uncertain),
    ],
  });
  const unresolvedClaimIds = [
    witness.claimId,
    ...(options.unresolvedOfficial ? [official.claimId] : []),
  ];
  return {
    scenarioId: `synthetic-${risk}-v1`,
    risk,
    graph,
    plan: {
      caseId: `synthetic-${risk}`,
      title: `Synthetic ${risk.replaceAll('_', ' ')} test`,
      scopeAddresses: graph.claims.map(({ address }) => address),
      focalClaimIds: [witness.claimId, official.claimId],
      witnessClaimIds: [witness.claimId],
      officialConclusionClaimIds: [official.claimId],
      unresolvedQuestions: [{
        question: `What evidence remains necessary for the synthetic ${risk} scenario?`,
        relevantClaimIds: unresolvedClaimIds,
        evidenceNeeded: ['Independent source material with complete provenance.'],
        status: 'open',
      }],
      limitations: [
        'This synthetic, non-evidential scenario tests analysis discipline and makes no event claim.',
      ],
      preparedBy: {
        method: 'manual_review',
        version: 'synthetic-adversarial-plan-v1',
        reviewStatus: 'reviewed',
      },
    },
    expected: {
      independentSupportByFocalClaim: [
        { claimId: witness.claimId, count: options.independentWitnessSupport ? 1 : 0 },
        { claimId: official.claimId, count: 0 },
      ],
      nonIndependentSupportByFocalClaim: [
        { claimId: witness.claimId, count: options.sharedWitnessSupport ? 1 : 0 },
        { claimId: official.claimId, count: 0 },
      ],
      contradictionCount: options.contradiction ? 1 : 0,
      repetitionCount: options.repetition ? 1 : 0,
      uncertainRelationshipCount: options.uncertain ? 1 : 0,
      unresolvedFocalClaimIds: unresolvedClaimIds,
      reliabilityGapClaimIds: options.omitWitnessReliability ? [witness.claimId] : [],
    },
    rationale: `Synthetic, non-evidential challenge for ${risk}.`,
  };
};

const fixture = (scenarios = CLAIM_ANALYSIS_ADVERSARIAL_RISKS.map(scenarioForRisk)) => (
  buildClaimAnalysisAdversarialFixture({
    fixtureId: 'synthetic-seven-risk-claim-analysis-pack-v1',
    constructionNotice: 'Synthetic, non-evidential adversarial evaluation only. Nothing in this pack describes a real event or may enter the evidence corpus.',
    scenarios,
  })
);

describe('claim-analysis adversarial quality gate', () => {
  it('passes seven distinct synthetic risks without false balance or evidence inflation', () => {
    const pack = fixture();
    const report = evaluateClaimAnalysisAdversarialFixture(pack);

    expect(report.gate.passed).toBe(true);
    expect(report.counts).toEqual({
      scenarios: 7,
      passed: 7,
      failed: 0,
      violations: 0,
    });
    expect(Object.values(report.riskCoverage)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(report.scenarioResults).toHaveLength(7);
    expect(new Set(report.scenarioResults.map(({ graphArtifactDigest }) => graphArtifactDigest)).size)
      .toBe(7);
    expect(report.reportDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyClaimAnalysisAdversarialFixture(pack)).toEqual(pack);
  });

  it('independently rebuilds the seven-risk pack before granting full-run evidence credit', () => {
    const pack = fixture();
    const report = evaluateClaimAnalysisAdversarialFixture(pack);
    const evidence = verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'claim_counterclaim',
      publication: {
        publicationId: binding.publicationId,
        corpusVersion: binding.corpusVersion,
        manifestSha256: binding.manifestSha256,
      },
      verifiedAt: '2026-07-26T12:00:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(pack)),
      artifactBody: Buffer.from(JSON.stringify(report)),
    });

    expect(evidence).toMatchObject({
      gate: 'claim_counterclaim',
      artifactType: 'case_vortex_claim_analysis_adversarial_evidence_set',
      verifierVersion: 'case-vortex-authoritative-artifact-verifier-v1',
    });
  });

  it('refuses claim-analysis evidence credit for a passing-looking tampered report', () => {
    const pack = fixture();
    const report = evaluateClaimAnalysisAdversarialFixture(pack);
    const tampered = {
      ...report,
      scenarioResults: report.scenarioResults.map((result, index) => index === 0
        ? { ...result, analysisDigest: 'f'.repeat(64) }
        : result),
    };

    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'claim_counterclaim',
      publication: {
        publicationId: binding.publicationId,
        corpusVersion: binding.corpusVersion,
        manifestSha256: binding.manifestSha256,
      },
      verifiedAt: '2026-07-26T12:00:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(pack)),
      artifactBody: Buffer.from(JSON.stringify(tampered)),
    })).toThrow('case_vortex_authoritative_claim_analysis_digest_mismatch');
  });

  it('fails closed on a re-sealed report with missing gate structure', () => {
    const pack = fixture();
    const report = evaluateClaimAnalysisAdversarialFixture(pack);
    const { reportDigest: _reportDigest, gate: _gate, ...withoutGate } = report;
    const malformed = {
      ...withoutGate,
      reportDigest: relationshipInputSha256(withoutGate),
    };

    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'claim_counterclaim',
      publication: {
        publicationId: binding.publicationId,
        corpusVersion: binding.corpusVersion,
        manifestSha256: binding.manifestSha256,
      },
      verifiedAt: '2026-07-26T12:00:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(pack)),
      artifactBody: Buffer.from(JSON.stringify(malformed)),
    })).toThrow('case_vortex_authoritative_claim_analysis_gate_failed');
  });

  it('fails the report when frozen gold accounting no longer matches the analysis', () => {
    const scenarios = CLAIM_ANALYSIS_ADVERSARIAL_RISKS.map(scenarioForRisk);
    scenarios[0] = {
      ...scenarios[0]!,
      expected: {
        ...scenarios[0]!.expected,
        contradictionCount: scenarios[0]!.expected.contradictionCount + 1,
      },
    };
    const report = evaluateClaimAnalysisAdversarialFixture(fixture(scenarios));

    expect(report.gate.passed).toBe(false);
    expect(report.counts.failed).toBe(1);
    expect(report.counts.violations).toBe(1);
    expect(report.scenarioResults.find(({ scenarioId }) => (
      scenarioId === scenarios[0]!.scenarioId
    ))?.violations).toContain('contradiction_count_mismatch');
  });

  it('rejects duplicated graph material, missing risk coverage and unsafe fixture labels', () => {
    const scenarios = CLAIM_ANALYSIS_ADVERSARIAL_RISKS.map(scenarioForRisk);
    expect(() => fixture([
      {
        ...scenarios[0]!,
        graph: scenarios[1]!.graph,
        plan: scenarios[1]!.plan,
        expected: scenarios[1]!.expected,
      },
      ...scenarios.slice(1),
    ])).toThrow('claim_analysis_adversarial_scenario_coverage_invalid');
    expect(() => fixture(scenarios.slice(1))).toThrow(
      'claim_analysis_adversarial_scenario_coverage_invalid',
    );
    expect(() => buildClaimAnalysisAdversarialFixture({
      fixtureId: 'unsafe-pack',
      constructionNotice: 'Evaluation pack.',
      scenarios,
    })).toThrow('claim_analysis_adversarial_notice_invalid');
  });

  it('rejects re-sealed fixture tampering', () => {
    const pack = fixture();
    const tampered = {
      ...pack,
      scenarios: pack.scenarios.map((scenario, index) => index === 0 ? {
        ...scenario,
        rationale: 'Changed after the fixture was sealed.',
      } : scenario),
    };
    expect(() => verifyClaimAnalysisAdversarialFixture(tampered)).toThrow(
      'claim_analysis_adversarial_fixture_integrity_failed',
    );
  });
});
