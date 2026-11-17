import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_ASSISTIVE_REVIEW_VERSION =
  'case-vortex-assistive-technology-review-v1' as const;

export const CASE_VORTEX_ASSISTIVE_TECHNOLOGIES = ['voiceover', 'nvda'] as const;
export type CaseVortexAssistiveTechnology = typeof CASE_VORTEX_ASSISTIVE_TECHNOLOGIES[number];

export const CASE_VORTEX_ASSISTIVE_REVIEW_TASKS = [
  'enter_research_surface',
  'ask_luna_question',
  'read_answer_and_citations',
  'open_exact_source_locator',
  'navigate_complete_record_list',
  'open_and_close_record_dossier',
  'inspect_claims_and_relationships',
  'inspect_external_context_and_missingness',
  'create_workspace_note_and_hypothesis',
  'restore_saved_luna_thread',
  'download_and_verify_research_report',
  'return_focus_to_research_surface',
] as const;
export type CaseVortexAssistiveReviewTask = typeof CASE_VORTEX_ASSISTIVE_REVIEW_TASKS[number];

const STATUS_ANNOUNCEMENT_TASKS = new Set<CaseVortexAssistiveReviewTask>([
  'ask_luna_question',
  'restore_saved_luna_thread',
  'download_and_verify_research_report',
]);

const EXPECTED_BEHAVIOUR: Record<CaseVortexAssistiveReviewTask, string> = {
  enter_research_surface: 'The page title, research heading, Luna question field and primary actions are announced once in a logical order.',
  ask_luna_question: 'Question submission announces retrieval progress without moving focus unexpectedly or exposing the visual orb as duplicate evidence.',
  read_answer_and_citations: 'Orientation, answer status, evidence boundary, claims, citations, uncertainty and follow-ups are distinguishable and navigable.',
  open_exact_source_locator: 'The exact page, quotation, timestamp, frame or image-region locator is named and focus enters the source dialog.',
  navigate_complete_record_list: 'The canonical keyboard navigator replaces the canvas, identifies result count and supports bounded record navigation.',
  open_and_close_record_dossier: 'Opening a record moves focus to its labelled dossier; closing returns to the originating record.',
  inspect_claims_and_relationships: 'Support, contradiction, repetition, uncertainty and connection receipts are announced as distinct meanings.',
  inspect_external_context_and_missingness: 'Checked, unavailable, stale and insufficient contextual sources are distinguishable from candidate explanations.',
  create_workspace_note_and_hypothesis: 'Workspace controls expose names, roles, values, validation and saved state without pointer-only interaction.',
  restore_saved_luna_thread: 'Restored question, answer, receipts and replay availability are announced without fabricating unavailable legacy provenance.',
  download_and_verify_research_report: 'Sealing, successful verification, file identity and failures are announced and the download remains keyboard operable.',
  return_focus_to_research_surface: 'Leaving list, dossier or dialogs restores focus to the initiating control or its stable fallback.',
};

export type CaseVortexAssistiveReviewPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexAssistiveReviewPlan = {
  recordType: 'case_vortex_assistive_review_plan';
  schemaVersion: typeof CASE_VORTEX_ASSISTIVE_REVIEW_VERSION;
  planId: string;
  publication: CaseVortexAssistiveReviewPublication;
  requirements: {
    technologies: typeof CASE_VORTEX_ASSISTIVE_TECHNOLOGIES;
    independentReviewers: 2;
    tasksPerTechnology: 12;
    automatedEvidenceCountsAsHumanReview: false;
    developerAssistanceAllowed: false;
  };
  sessions: Array<{
    assistiveTechnology: CaseVortexAssistiveTechnology;
    reviewerLane: 'reviewer_a' | 'reviewer_b';
    tasks: Array<{
      taskId: CaseVortexAssistiveReviewTask;
      expectedBehaviour: string;
      statusAnnouncementRequired: boolean;
      outcome: null;
    }>;
  }>;
  planSha256: string;
};

export type CaseVortexAssistiveReviewTaskOutcome = {
  taskId: CaseVortexAssistiveReviewTask;
  completed: boolean;
  nameRoleValuePass: boolean;
  readingOrderPass: boolean;
  focusManagementPass: boolean;
  statusAnnouncementPass: boolean | null;
  blockingIssue: boolean;
  notes: string;
};

export type CaseVortexAssistiveReviewInput = {
  recordType: 'case_vortex_assistive_review_input';
  schemaVersion: typeof CASE_VORTEX_ASSISTIVE_REVIEW_VERSION;
  planId: string;
  planSha256: string;
  publication: CaseVortexAssistiveReviewPublication;
  completedAt: string;
  sessions: Array<{
    assistiveTechnology: CaseVortexAssistiveTechnology;
    reviewerIdHash: string;
    assistiveTechnologyVersion: string;
    browserName: string;
    browserVersion: string;
    operatingSystem: string;
    operatingSystemVersion: string;
    completedWithoutDeveloperHelp: boolean;
    artifactSha256: string;
    taskOutcomes: CaseVortexAssistiveReviewTaskOutcome[];
  }>;
  issues: Array<{
    issueId: string;
    assistiveTechnology: CaseVortexAssistiveTechnology;
    taskId: CaseVortexAssistiveReviewTask;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    reproducible: boolean;
    resolved: boolean;
    resolutionReceiptSha256: string | null;
  }>;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const bounded = (value: unknown, code: string, maximum = 1_000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(code);
  return value.trim();
};
const digest = (value: unknown, code: string) => {
  const normalized = bounded(value, code, 64).toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(code);
  return normalized;
};

const publication = (value: CaseVortexAssistiveReviewPublication) => ({
  publicationId: bounded(value?.publicationId, 'case_vortex_assistive_review_publication_invalid', 200),
  corpusVersion: bounded(value?.corpusVersion, 'case_vortex_assistive_review_publication_invalid', 200),
  manifestSha256: digest(value?.manifestSha256, 'case_vortex_assistive_review_publication_invalid'),
});

export const buildCaseVortexAssistiveReviewPlan = (input: {
  planId: string;
  publication: CaseVortexAssistiveReviewPublication;
}): CaseVortexAssistiveReviewPlan => {
  const withoutDigest = {
    recordType: 'case_vortex_assistive_review_plan' as const,
    schemaVersion: CASE_VORTEX_ASSISTIVE_REVIEW_VERSION,
    planId: bounded(input.planId, 'case_vortex_assistive_review_plan_id_invalid', 200),
    publication: publication(input.publication),
    requirements: {
      technologies: CASE_VORTEX_ASSISTIVE_TECHNOLOGIES,
      independentReviewers: 2 as const,
      tasksPerTechnology: 12 as const,
      automatedEvidenceCountsAsHumanReview: false as const,
      developerAssistanceAllowed: false as const,
    },
    sessions: CASE_VORTEX_ASSISTIVE_TECHNOLOGIES.map((assistiveTechnology, index) => ({
      assistiveTechnology,
      reviewerLane: index === 0 ? 'reviewer_a' as const : 'reviewer_b' as const,
      tasks: CASE_VORTEX_ASSISTIVE_REVIEW_TASKS.map((taskId) => ({
        taskId,
        expectedBehaviour: EXPECTED_BEHAVIOUR[taskId],
        statusAnnouncementRequired: STATUS_ANNOUNCEMENT_TASKS.has(taskId),
        outcome: null,
      })),
    })),
  };
  return { ...withoutDigest, planSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexAssistiveReviewPlan = (
  value: CaseVortexAssistiveReviewPlan,
): boolean => {
  if (!value || value.recordType !== 'case_vortex_assistive_review_plan'
    || value.schemaVersion !== CASE_VORTEX_ASSISTIVE_REVIEW_VERSION
    || !SHA256.test(value.planSha256)) return false;
  const { planSha256, ...withoutDigest } = value;
  return relationshipInputSha256(withoutDigest) === planSha256;
};

export const buildCaseVortexAssistiveReviewReport = (input: CaseVortexAssistiveReviewInput) => {
  if (!input || input.recordType !== 'case_vortex_assistive_review_input'
    || input.schemaVersion !== CASE_VORTEX_ASSISTIVE_REVIEW_VERSION
    || !Array.isArray(input.sessions) || input.sessions.length !== 2
    || !Array.isArray(input.issues)) {
    throw new Error('case_vortex_assistive_review_input_invalid');
  }
  const normalizedPublication = publication(input.publication);
  const planId = bounded(input.planId, 'case_vortex_assistive_review_plan_id_invalid', 200);
  const planSha256 = digest(input.planSha256, 'case_vortex_assistive_review_plan_digest_invalid');
  const expectedPlan = buildCaseVortexAssistiveReviewPlan({
    planId,
    publication: normalizedPublication,
  });
  if (expectedPlan.planSha256 !== planSha256) {
    throw new Error('case_vortex_assistive_review_plan_binding_invalid');
  }
  const completedAt = bounded(input.completedAt, 'case_vortex_assistive_review_completed_at_invalid', 100);
  if (!Number.isFinite(Date.parse(completedAt))) {
    throw new Error('case_vortex_assistive_review_completed_at_invalid');
  }
  const technologies = new Set<CaseVortexAssistiveTechnology>();
  const reviewers = new Set<string>();
  const artifacts = new Set<string>();
  let passedTasks = 0;
  let blockingTasks = 0;
  let independentCompletions = 0;
  const normalizedSessions = input.sessions.map((session) => {
    if (!CASE_VORTEX_ASSISTIVE_TECHNOLOGIES.includes(session.assistiveTechnology)
      || technologies.has(session.assistiveTechnology)
      || !Array.isArray(session.taskOutcomes)
      || session.taskOutcomes.length !== CASE_VORTEX_ASSISTIVE_REVIEW_TASKS.length
      || typeof session.completedWithoutDeveloperHelp !== 'boolean') {
      throw new Error('case_vortex_assistive_review_session_invalid');
    }
    technologies.add(session.assistiveTechnology);
    const reviewerIdHash = digest(session.reviewerIdHash, 'case_vortex_assistive_review_reviewer_invalid');
    reviewers.add(reviewerIdHash);
    const seenTasks = new Set<CaseVortexAssistiveReviewTask>();
    const taskOutcomes = session.taskOutcomes.map((outcome) => {
      if (!CASE_VORTEX_ASSISTIVE_REVIEW_TASKS.includes(outcome.taskId)
        || seenTasks.has(outcome.taskId)
        || typeof outcome.completed !== 'boolean'
        || typeof outcome.nameRoleValuePass !== 'boolean'
        || typeof outcome.readingOrderPass !== 'boolean'
        || typeof outcome.focusManagementPass !== 'boolean'
        || typeof outcome.blockingIssue !== 'boolean'
        || typeof outcome.notes !== 'string' || outcome.notes.length > 4_000) {
        throw new Error('case_vortex_assistive_review_task_invalid');
      }
      seenTasks.add(outcome.taskId);
      const statusRequired = STATUS_ANNOUNCEMENT_TASKS.has(outcome.taskId);
      if ((statusRequired && typeof outcome.statusAnnouncementPass !== 'boolean')
        || (!statusRequired && outcome.statusAnnouncementPass !== null)) {
        throw new Error('case_vortex_assistive_review_task_invalid');
      }
      const passed = outcome.completed && outcome.nameRoleValuePass
        && outcome.readingOrderPass && outcome.focusManagementPass
        && (!statusRequired || outcome.statusAnnouncementPass === true)
        && !outcome.blockingIssue;
      if (passed) passedTasks += 1;
      if (outcome.blockingIssue) blockingTasks += 1;
      return { ...outcome, notes: outcome.notes.trim(), passed };
    });
    if (session.completedWithoutDeveloperHelp) independentCompletions += 1;
    const artifactSha256 = digest(session.artifactSha256,
      'case_vortex_assistive_review_artifact_invalid');
    artifacts.add(artifactSha256);
    return {
      assistiveTechnology: session.assistiveTechnology,
      reviewerIdHash,
      assistiveTechnologyVersion: bounded(session.assistiveTechnologyVersion,
        'case_vortex_assistive_review_environment_invalid', 100),
      browserName: bounded(session.browserName, 'case_vortex_assistive_review_environment_invalid', 100),
      browserVersion: bounded(session.browserVersion, 'case_vortex_assistive_review_environment_invalid', 100),
      operatingSystem: bounded(session.operatingSystem, 'case_vortex_assistive_review_environment_invalid', 100),
      operatingSystemVersion: bounded(session.operatingSystemVersion,
        'case_vortex_assistive_review_environment_invalid', 100),
      completedWithoutDeveloperHelp: session.completedWithoutDeveloperHelp === true,
      artifactSha256,
      taskOutcomes,
    };
  });
  if (reviewers.size !== input.sessions.length) {
    throw new Error('case_vortex_assistive_review_reviewers_not_independent');
  }
  if (artifacts.size !== input.sessions.length) {
    throw new Error('case_vortex_assistive_review_artifacts_not_independent');
  }
  const issueIds = new Set<string>();
  const normalizedIssues = input.issues.map((issue) => {
    if (!CASE_VORTEX_ASSISTIVE_TECHNOLOGIES.includes(issue.assistiveTechnology)
      || !CASE_VORTEX_ASSISTIVE_REVIEW_TASKS.includes(issue.taskId)
      || !['critical', 'high', 'medium', 'low'].includes(issue.severity)
      || typeof issue.reproducible !== 'boolean' || typeof issue.resolved !== 'boolean') {
      throw new Error('case_vortex_assistive_review_issue_invalid');
    }
    const resolutionReceiptSha256 = issue.resolutionReceiptSha256 === null
      ? null : digest(issue.resolutionReceiptSha256, 'case_vortex_assistive_review_issue_invalid');
    if (issue.resolved !== (resolutionReceiptSha256 !== null)) {
      throw new Error('case_vortex_assistive_review_issue_invalid');
    }
    const issueId = bounded(issue.issueId, 'case_vortex_assistive_review_issue_invalid', 200);
    if (issueIds.has(issueId)) throw new Error('case_vortex_assistive_review_issue_invalid');
    issueIds.add(issueId);
    return {
      ...issue,
      issueId,
      description: bounded(issue.description, 'case_vortex_assistive_review_issue_invalid', 4_000),
      resolutionReceiptSha256,
    };
  });
  const unresolvedCriticalOrHigh = normalizedIssues.filter(({ severity, resolved }) => (
    !resolved && (severity === 'critical' || severity === 'high')
  )).length;
  const criteria = [
    { criterion: 'assistive_technologies', passed: technologies.size === 2, actual: technologies.size, required: 2 },
    { criterion: 'independent_reviewers', passed: reviewers.size === 2, actual: reviewers.size, required: 2 },
    { criterion: 'independent_session_artifacts', passed: artifacts.size === 2, actual: artifacts.size, required: 2 },
    { criterion: 'passed_tasks', passed: passedTasks === 24, actual: passedTasks, required: 24 },
    { criterion: 'blocking_tasks', passed: blockingTasks === 0, actual: blockingTasks, required: 0 },
    { criterion: 'independent_completions', passed: independentCompletions === 2, actual: independentCompletions, required: 2 },
    { criterion: 'unresolved_critical_or_high_issues', passed: unresolvedCriticalOrHigh === 0, actual: unresolvedCriticalOrHigh, required: 0 },
  ];
  const withoutDigest = {
    recordType: 'case_vortex_assistive_review_report' as const,
    schemaVersion: CASE_VORTEX_ASSISTIVE_REVIEW_VERSION,
    planId,
    planSha256,
    publication: normalizedPublication,
    completedAt: new Date(completedAt).toISOString(),
    accounting: {
      sessionCount: normalizedSessions.length,
      reviewerCount: reviewers.size,
      taskCount: 24,
      passedTaskCount: passedTasks,
      blockingTaskCount: blockingTasks,
      issueCount: normalizedIssues.length,
      unresolvedCriticalOrHighIssueCount: unresolvedCriticalOrHigh,
    },
    sessions: normalizedSessions,
    issues: normalizedIssues,
    criteria,
    humanAssistiveReviewPassed: criteria.every(({ passed }) => passed),
    limitations: [
      'This report proves only the named publication, browsers, operating systems, assistive-technology versions and retained human sessions.',
      'Automated axe, DOM and keyboard tests are supporting evidence and do not count as these human sessions.',
    ],
  };
  return { ...withoutDigest, reportSha256: relationshipInputSha256(withoutDigest) };
};
