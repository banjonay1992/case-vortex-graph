import { describe, expect, it } from 'vitest';

import {
  verifyCaseVortexAuthoritativeEvidenceArtifact,
} from '../../src/caseGraph/authoritativeEvidenceArtifact';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildCaseVortexSecurityReviewPlan,
  buildCaseVortexSecurityReviewReport,
  CASE_VORTEX_SECURITY_EXPECTED_DISPOSITIONS,
  CASE_VORTEX_SECURITY_REVIEW_VERSION,
  CASE_VORTEX_SECURITY_RISKS,
  type CaseVortexSecurityReviewInput,
} from '../../src/caseGraph/securityAdversarialReview';

const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-26-v3',
  manifestSha256: 'a'.repeat(64),
};

const securityInput = (): CaseVortexSecurityReviewInput => {
  const plan = buildCaseVortexSecurityReviewPlan({
    planId: 'case-vortex-security-review-2026-07-26',
    publication,
  });
  return {
    recordType: 'case_vortex_security_review_input',
    schemaVersion: CASE_VORTEX_SECURITY_REVIEW_VERSION,
    planId: plan.planId,
    planSha256: plan.planSha256,
    publication,
    completedAt: '2026-07-26T18:00:00.000Z',
    sessions: ['reviewer-alpha', 'reviewer-beta'].map((reviewer, reviewerIndex) => ({
      reviewerIdHash: relationshipInputSha256({ reviewer }),
      environmentId: `staging-security-review-2026-07-26-${reviewerIndex + 1}`,
      browserOrClient: reviewerIndex === 0
        ? 'Chrome 140 on macOS 16'
        : 'Firefox 142 on Windows 11',
      completedWithoutDeveloperHelp: true,
      sessionArtifactSha256: relationshipInputSha256({ reviewer, artifact: 'session' }),
      observations: CASE_VORTEX_SECURITY_RISKS.map((risk) => ({
        risk,
        requestArtifactSha256: relationshipInputSha256({ reviewer, risk, artifact: 'request' }),
        responseArtifactSha256: relationshipInputSha256({ reviewer, risk, artifact: 'response' }),
        observedDisposition: CASE_VORTEX_SECURITY_EXPECTED_DISPOSITIONS[risk],
        databaseMutationCount: 0,
        storageMutationCount: 0,
        publicationActivationCount: 0,
        deploymentCount: 0,
        crossBoundaryReadCount: 0,
        fabricatedEvidenceCount: 0,
        exposedSecretCount: 0,
        notes: `Retained adversarial observation for ${risk}.`,
      })),
    })),
    issues: [],
  };
};

describe('Case Vortex adversarial security review', () => {
  it('requires two independent sessions covering all 12 risks with zero side effects', () => {
    const input = securityInput();
    const report = buildCaseVortexSecurityReviewReport(input);
    expect(report.securityReviewPassed).toBe(true);
    expect(report.accounting).toMatchObject({
      sessionCount: 2,
      reviewerCount: 2,
      riskCount: 12,
      observationCount: 24,
      passedObservationCount: 24,
      mutationCount: 0,
      boundaryViolationCount: 0,
      unresolvedCriticalOrHighIssueCount: 0,
    });
    expect(report.sessions.flatMap(({ observations }) => observations))
      .toHaveLength(24);

    const evidence = verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'security_review',
      publication,
      verifiedAt: '2026-07-26T18:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(input)),
      artifactBody: Buffer.from(JSON.stringify(report)),
    });
    expect(evidence).toMatchObject({
      gate: 'security_review',
      artifactType: 'case_vortex_adversarial_security_review_evidence_set',
      publication,
    });
  });

  it('rejects omitted or duplicated risk coverage', () => {
    const omitted = securityInput();
    omitted.sessions[0]!.observations.pop();
    expect(() => buildCaseVortexSecurityReviewReport(omitted))
      .toThrow('case_vortex_security_review_session_invalid');

    const duplicated = securityInput();
    duplicated.sessions[0]!.observations[11] = {
      ...duplicated.sessions[0]!.observations[0]!,
      requestArtifactSha256: relationshipInputSha256({ duplicate: 'request' }),
      responseArtifactSha256: relationshipInputSha256({ duplicate: 'response' }),
    };
    expect(() => buildCaseVortexSecurityReviewReport(duplicated))
      .toThrow('case_vortex_security_review_risk_coverage_invalid');
  });

  it('rejects reviewer, session or request/response artifact reuse', () => {
    const sameReviewer = securityInput();
    sameReviewer.sessions[1]!.reviewerIdHash = sameReviewer.sessions[0]!.reviewerIdHash;
    expect(() => buildCaseVortexSecurityReviewReport(sameReviewer))
      .toThrow('case_vortex_security_review_independence_invalid');

    const sameSessionArtifact = securityInput();
    sameSessionArtifact.sessions[1]!.sessionArtifactSha256 =
      sameSessionArtifact.sessions[0]!.sessionArtifactSha256;
    expect(() => buildCaseVortexSecurityReviewReport(sameSessionArtifact))
      .toThrow('case_vortex_security_review_independence_invalid');

    const reusedResponse = securityInput();
    reusedResponse.sessions[1]!.observations[0]!.responseArtifactSha256 =
      reusedResponse.sessions[0]!.observations[0]!.responseArtifactSha256;
    expect(() => buildCaseVortexSecurityReviewReport(reusedResponse))
      .toThrow('case_vortex_security_review_independence_invalid');
  });

  it('fails closed for an attack side effect, wrong disposition or unresolved high issue', () => {
    const mutated = securityInput();
    mutated.sessions[0]!.observations[0]!.publicationActivationCount = 1;
    const mutatedReport = buildCaseVortexSecurityReviewReport(mutated);
    expect(mutatedReport.securityReviewPassed).toBe(false);
    expect(mutatedReport.accounting.mutationCount).toBe(1);
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'security_review',
      publication,
      verifiedAt: '2026-07-26T18:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(mutated)),
      artifactBody: Buffer.from(JSON.stringify(mutatedReport)),
    })).toThrow('case_vortex_authoritative_security_gate_failed');

    const wrongDisposition = securityInput();
    wrongDisposition.sessions[0]!.observations[0]!.observedDisposition = 'allowed';
    expect(buildCaseVortexSecurityReviewReport(wrongDisposition).securityReviewPassed).toBe(false);

    const unresolved = securityInput();
    unresolved.issues.push({
      issueId: 'SEC-001',
      severity: 'high',
      risk: 'authentication_bypass',
      description: 'A retained high-severity issue.',
      resolved: false,
      resolutionReceiptSha256: null,
    });
    expect(buildCaseVortexSecurityReviewReport(unresolved).securityReviewPassed).toBe(false);
  });

  it('rejects test-only environments and a re-sealed report not rebuilt from its input', () => {
    const testOnly = securityInput();
    testOnly.sessions[0]!.environmentId = 'synthetic-test-only-browser';
    expect(() => buildCaseVortexSecurityReviewReport(testOnly))
      .toThrow('case_vortex_security_review_session_invalid');

    const input = securityInput();
    const report = buildCaseVortexSecurityReviewReport(input);
    const changed = {
      ...report,
      limitations: [...report.limitations, 'Inserted after the retained review.'],
    };
    const { reportSha256: _discarded, ...body } = changed;
    const resealed = { ...changed, reportSha256: relationshipInputSha256(body) };
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'security_review',
      publication,
      verifiedAt: '2026-07-26T18:01:00.000Z',
      artifactInputBody: Buffer.from(JSON.stringify(input)),
      artifactBody: Buffer.from(JSON.stringify(resealed)),
    })).toThrow('case_vortex_authoritative_artifact_rebuild_mismatch');
  });
});
