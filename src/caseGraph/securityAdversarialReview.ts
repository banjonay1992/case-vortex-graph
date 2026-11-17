import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_SECURITY_REVIEW_VERSION =
  'case-vortex-adversarial-security-review-v1' as const;

export const CASE_VORTEX_SECURITY_RISKS = [
  'authentication_bypass',
  'cross_user_workspace_access',
  'publication_binding_substitution',
  'untrusted_evidence_prompt_injection',
  'fabricated_citation_or_tool_receipt',
  'report_replay_tampering',
  'external_tool_fail_open',
  'quota_or_idempotency_bypass',
  'storage_key_or_secret_exposure',
  'migration_or_activation_scope_escalation',
  'r2_object_substitution',
  'browser_xss_or_html_injection',
] as const;
export type CaseVortexSecurityRisk = typeof CASE_VORTEX_SECURITY_RISKS[number];

export const CASE_VORTEX_SECURITY_EXPECTED_DISPOSITIONS = {
  authentication_bypass: 'rejected_unauthenticated',
  cross_user_workspace_access: 'rejected_cross_user',
  publication_binding_substitution: 'rejected_publication_mismatch',
  untrusted_evidence_prompt_injection:
    'ignored_untrusted_instruction_preserved_verified_receipts',
  fabricated_citation_or_tool_receipt: 'rejected_fabricated_evidence',
  report_replay_tampering: 'rejected_tampered_replay',
  external_tool_fail_open: 'failed_closed_provider_unavailable',
  quota_or_idempotency_bypass: 'deduplicated_without_second_side_effect',
  storage_key_or_secret_exposure: 'redacted_secret_material',
  migration_or_activation_scope_escalation: 'rejected_scope_escalation',
  r2_object_substitution: 'rejected_r2_substitution',
  browser_xss_or_html_injection: 'rendered_as_inert_text',
} as const satisfies Record<CaseVortexSecurityRisk, string>;

export type CaseVortexSecurityPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexSecurityReviewPlan = {
  recordType: 'case_vortex_security_review_plan';
  schemaVersion: typeof CASE_VORTEX_SECURITY_REVIEW_VERSION;
  planId: string;
  publication: CaseVortexSecurityPublication;
  requirements: {
    independentReviewers: 2;
    risksPerReviewer: 12;
    totalObservations: 24;
    automatedAssertionsAloneSufficient: false;
    developerAssistanceAllowed: false;
  };
  risks: Array<{
    risk: CaseVortexSecurityRisk;
    expectedDisposition: string;
    observation: null;
  }>;
  planSha256: string;
};

export type CaseVortexSecurityObservation = {
  risk: CaseVortexSecurityRisk;
  requestArtifactSha256: string;
  responseArtifactSha256: string;
  observedDisposition: string;
  databaseMutationCount: number;
  storageMutationCount: number;
  publicationActivationCount: number;
  deploymentCount: number;
  crossBoundaryReadCount: number;
  fabricatedEvidenceCount: number;
  exposedSecretCount: number;
  notes: string;
};

export type CaseVortexSecurityReviewInput = {
  recordType: 'case_vortex_security_review_input';
  schemaVersion: typeof CASE_VORTEX_SECURITY_REVIEW_VERSION;
  planId: string;
  planSha256: string;
  publication: CaseVortexSecurityPublication;
  completedAt: string;
  sessions: Array<{
    reviewerIdHash: string;
    environmentId: string;
    browserOrClient: string;
    completedWithoutDeveloperHelp: boolean;
    sessionArtifactSha256: string;
    observations: CaseVortexSecurityObservation[];
  }>;
  issues: Array<{
    issueId: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    risk: CaseVortexSecurityRisk;
    description: string;
    resolved: boolean;
    resolutionReceiptSha256: string | null;
  }>;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const TEST_ONLY = /(?:synthetic|simulated|fixture|test[-_: ]only|never[-_: ]publication)/iu;
const fail = (code: string): never => { throw new Error(code); };
const text = (value: unknown, code: string, maximum = 1_000) => {
  if (typeof value !== 'string' || !value.trim()
    || Buffer.byteLength(value, 'utf8') > maximum) return fail(code);
  return value.trim();
};
const digest = (value: unknown, code: string) => {
  const normalized = text(value, code, 64).toLowerCase();
  if (!SHA256.test(normalized)) return fail(code);
  return normalized;
};
const count = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(code);
  return Number(value);
};
const publication = (value: CaseVortexSecurityPublication) => {
  if (!value || !UUID.test(value.publicationId)
    || !VERSION.test(value.corpusVersion)
    || !SHA256.test(value.manifestSha256)) {
    return fail('case_vortex_security_review_publication_invalid');
  }
  return { ...value };
};

export const buildCaseVortexSecurityReviewPlan = (input: {
  planId: string;
  publication: CaseVortexSecurityPublication;
}): CaseVortexSecurityReviewPlan => {
  const body = {
    recordType: 'case_vortex_security_review_plan' as const,
    schemaVersion: CASE_VORTEX_SECURITY_REVIEW_VERSION,
    planId: text(input.planId, 'case_vortex_security_review_plan_invalid', 200),
    publication: publication(input.publication),
    requirements: {
      independentReviewers: 2 as const,
      risksPerReviewer: 12 as const,
      totalObservations: 24 as const,
      automatedAssertionsAloneSufficient: false as const,
      developerAssistanceAllowed: false as const,
    },
    risks: CASE_VORTEX_SECURITY_RISKS.map((risk) => ({
      risk,
      expectedDisposition: CASE_VORTEX_SECURITY_EXPECTED_DISPOSITIONS[risk],
      observation: null,
    })),
  };
  return { ...body, planSha256: relationshipInputSha256(body) };
};

export const buildCaseVortexSecurityReviewReport = (
  input: CaseVortexSecurityReviewInput,
) => {
  if (!input || input.recordType !== 'case_vortex_security_review_input'
    || input.schemaVersion !== CASE_VORTEX_SECURITY_REVIEW_VERSION
    || !Array.isArray(input.sessions) || input.sessions.length !== 2
    || !Array.isArray(input.issues)) {
    fail('case_vortex_security_review_input_invalid');
  }
  const exactPublication = publication(input.publication);
  const planId = text(input.planId, 'case_vortex_security_review_plan_invalid', 200);
  const planSha256 = digest(
    input.planSha256,
    'case_vortex_security_review_plan_digest_invalid',
  );
  const plan = buildCaseVortexSecurityReviewPlan({ planId, publication: exactPublication });
  if (plan.planSha256 !== planSha256) {
    fail('case_vortex_security_review_plan_binding_invalid');
  }
  let completedAt: string;
  try {
    completedAt = new Date(input.completedAt).toISOString();
    if (completedAt !== input.completedAt) fail('case_vortex_security_review_completed_at_invalid');
  } catch {
    return fail('case_vortex_security_review_completed_at_invalid');
  }
  const reviewers = new Set<string>();
  const sessionArtifacts = new Set<string>();
  const requestArtifacts = new Set<string>();
  const responseArtifacts = new Set<string>();
  let passedObservationCount = 0;
  let mutationCount = 0;
  let boundaryViolationCount = 0;
  const sessions = input.sessions.map((session) => {
    const reviewerIdHash = digest(
      session.reviewerIdHash,
      'case_vortex_security_review_reviewer_invalid',
    );
    const environmentId = text(
      session.environmentId,
      'case_vortex_security_review_environment_invalid',
      200,
    );
    const browserOrClient = text(
      session.browserOrClient,
      'case_vortex_security_review_environment_invalid',
      200,
    );
    if (TEST_ONLY.test(environmentId) || TEST_ONLY.test(browserOrClient)
      || session.completedWithoutDeveloperHelp !== true
      || !Array.isArray(session.observations)
      || session.observations.length !== CASE_VORTEX_SECURITY_RISKS.length) {
      fail('case_vortex_security_review_session_invalid');
    }
    reviewers.add(reviewerIdHash);
    const sessionArtifactSha256 = digest(
      session.sessionArtifactSha256,
      'case_vortex_security_review_artifact_invalid',
    );
    sessionArtifacts.add(sessionArtifactSha256);
    const seen = new Set<CaseVortexSecurityRisk>();
    const observations = session.observations.map((observation) => {
      if (!CASE_VORTEX_SECURITY_RISKS.includes(observation.risk)
        || seen.has(observation.risk)) {
        return fail('case_vortex_security_review_risk_coverage_invalid');
      }
      seen.add(observation.risk);
      const requestArtifactSha256 = digest(
        observation.requestArtifactSha256,
        'case_vortex_security_review_artifact_invalid',
      );
      const responseArtifactSha256 = digest(
        observation.responseArtifactSha256,
        'case_vortex_security_review_artifact_invalid',
      );
      requestArtifacts.add(requestArtifactSha256);
      responseArtifacts.add(responseArtifactSha256);
      const counts = {
        databaseMutationCount: count(
          observation.databaseMutationCount,
          'case_vortex_security_review_observation_invalid',
        ),
        storageMutationCount: count(
          observation.storageMutationCount,
          'case_vortex_security_review_observation_invalid',
        ),
        publicationActivationCount: count(
          observation.publicationActivationCount,
          'case_vortex_security_review_observation_invalid',
        ),
        deploymentCount: count(
          observation.deploymentCount,
          'case_vortex_security_review_observation_invalid',
        ),
        crossBoundaryReadCount: count(
          observation.crossBoundaryReadCount,
          'case_vortex_security_review_observation_invalid',
        ),
        fabricatedEvidenceCount: count(
          observation.fabricatedEvidenceCount,
          'case_vortex_security_review_observation_invalid',
        ),
        exposedSecretCount: count(
          observation.exposedSecretCount,
          'case_vortex_security_review_observation_invalid',
        ),
      };
      const passed = observation.observedDisposition
          === CASE_VORTEX_SECURITY_EXPECTED_DISPOSITIONS[observation.risk]
        && Object.values(counts).every((value) => value === 0);
      if (passed) passedObservationCount += 1;
      mutationCount += counts.databaseMutationCount + counts.storageMutationCount
        + counts.publicationActivationCount + counts.deploymentCount;
      boundaryViolationCount += counts.crossBoundaryReadCount
        + counts.fabricatedEvidenceCount + counts.exposedSecretCount;
      return {
        risk: observation.risk,
        requestArtifactSha256,
        responseArtifactSha256,
        observedDisposition: text(
          observation.observedDisposition,
          'case_vortex_security_review_observation_invalid',
          200,
        ),
        ...counts,
        notes: text(observation.notes, 'case_vortex_security_review_observation_invalid', 4_000),
        passed,
      };
    });
    if (seen.size !== CASE_VORTEX_SECURITY_RISKS.length) {
      fail('case_vortex_security_review_risk_coverage_invalid');
    }
    return {
      reviewerIdHash,
      environmentId,
      browserOrClient,
      completedWithoutDeveloperHelp: true as const,
      sessionArtifactSha256,
      observations,
    };
  });
  if (reviewers.size !== 2 || sessionArtifacts.size !== 2
    || requestArtifacts.size !== 24 || responseArtifacts.size !== 24) {
    fail('case_vortex_security_review_independence_invalid');
  }
  const issueIds = new Set<string>();
  const issues = input.issues.map((issue) => {
    if (!CASE_VORTEX_SECURITY_RISKS.includes(issue.risk)
      || !['critical', 'high', 'medium', 'low'].includes(issue.severity)
      || typeof issue.resolved !== 'boolean') {
      return fail('case_vortex_security_review_issue_invalid');
    }
    const issueId = text(issue.issueId, 'case_vortex_security_review_issue_invalid', 200);
    if (issueIds.has(issueId)) fail('case_vortex_security_review_issue_invalid');
    issueIds.add(issueId);
    const resolutionReceiptSha256 = issue.resolutionReceiptSha256 === null
      ? null
      : digest(
        issue.resolutionReceiptSha256,
        'case_vortex_security_review_issue_invalid',
      );
    if (issue.resolved !== (resolutionReceiptSha256 !== null)) {
      fail('case_vortex_security_review_issue_invalid');
    }
    return {
      ...issue,
      issueId,
      description: text(
        issue.description,
        'case_vortex_security_review_issue_invalid',
        4_000,
      ),
      resolutionReceiptSha256,
    };
  });
  const unresolvedCriticalOrHighIssueCount = issues.filter((issue) => (
    !issue.resolved && (issue.severity === 'critical' || issue.severity === 'high')
  )).length;
  const criteria = [
    { criterion: 'independent_reviewers', actual: reviewers.size, required: 2, passed: reviewers.size === 2 },
    { criterion: 'independent_session_artifacts', actual: sessionArtifacts.size, required: 2, passed: sessionArtifacts.size === 2 },
    { criterion: 'unique_request_artifacts', actual: requestArtifacts.size, required: 24, passed: requestArtifacts.size === 24 },
    { criterion: 'unique_response_artifacts', actual: responseArtifacts.size, required: 24, passed: responseArtifacts.size === 24 },
    { criterion: 'passed_adversarial_observations', actual: passedObservationCount, required: 24, passed: passedObservationCount === 24 },
    { criterion: 'mutations_from_attacks', actual: mutationCount, required: 0, passed: mutationCount === 0 },
    { criterion: 'boundary_violations', actual: boundaryViolationCount, required: 0, passed: boundaryViolationCount === 0 },
    { criterion: 'unresolved_critical_or_high_issues', actual: unresolvedCriticalOrHighIssueCount, required: 0, passed: unresolvedCriticalOrHighIssueCount === 0 },
  ];
  const body = {
    recordType: 'case_vortex_security_review_report' as const,
    schemaVersion: CASE_VORTEX_SECURITY_REVIEW_VERSION,
    planId,
    planSha256,
    publication: exactPublication,
    completedAt,
    accounting: {
      sessionCount: sessions.length,
      reviewerCount: reviewers.size,
      riskCount: CASE_VORTEX_SECURITY_RISKS.length,
      observationCount: 24,
      passedObservationCount,
      mutationCount,
      boundaryViolationCount,
      issueCount: issues.length,
      unresolvedCriticalOrHighIssueCount,
    },
    sessions,
    issues,
    criteria,
    securityReviewPassed: criteria.every(({ passed }) => passed),
    limitations: [
      'This report proves only the named publication, retained request/response artifacts, environments and reviewer sessions.',
      'Automated unit tests support but do not replace the two independent retained review sessions.',
      'A passing review does not authorize migration, storage write, publication activation or deployment.',
    ],
  };
  return { ...body, reportSha256: relationshipInputSha256(body) };
};
