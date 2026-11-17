import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexAssistiveReviewPlan,
  buildCaseVortexAssistiveReviewReport,
  CASE_VORTEX_ASSISTIVE_REVIEW_TASKS,
  CASE_VORTEX_ASSISTIVE_REVIEW_VERSION,
  type CaseVortexAssistiveReviewInput,
  verifyCaseVortexAssistiveReviewPlan,
} from '../../src/caseGraph/assistiveTechnologyReview';
import { verifyCaseVortexAuthoritativeEvidenceArtifact } from '../../src/caseGraph/authoritativeEvidenceArtifact';

const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: 'corpus-v2',
  manifestSha256: 'a'.repeat(64),
};
const plan = () => buildCaseVortexAssistiveReviewPlan({
  planId: 'assistive-review-v1',
  publication,
});
const statusTasks = new Set([
  'ask_luna_question',
  'restore_saved_luna_thread',
  'download_and_verify_research_report',
]);

const input = (): CaseVortexAssistiveReviewInput => ({
  recordType: 'case_vortex_assistive_review_input',
  schemaVersion: CASE_VORTEX_ASSISTIVE_REVIEW_VERSION,
  planId: plan().planId,
  planSha256: plan().planSha256,
  publication,
  completedAt: '2026-07-22T12:00:00.000Z',
  sessions: (['voiceover', 'nvda'] as const).map((assistiveTechnology, index) => ({
    assistiveTechnology,
    reviewerIdHash: (index ? 'b' : 'c').repeat(64),
    assistiveTechnologyVersion: index ? 'NVDA 2026.1' : 'VoiceOver 16.0',
    browserName: index ? 'Firefox' : 'Safari',
    browserVersion: index ? '140' : '26',
    operatingSystem: index ? 'Windows' : 'macOS',
    operatingSystemVersion: index ? '11 24H2' : '26.0',
    completedWithoutDeveloperHelp: true,
    artifactSha256: (index ? 'd' : 'e').repeat(64),
    taskOutcomes: CASE_VORTEX_ASSISTIVE_REVIEW_TASKS.map((taskId) => ({
      taskId,
      completed: true,
      nameRoleValuePass: true,
      readingOrderPass: true,
      focusManagementPass: true,
      statusAnnouncementPass: statusTasks.has(taskId) ? true : null,
      blockingIssue: false,
      notes: `Human observation for ${taskId}`,
    })),
  })),
  issues: [],
});

describe('Case Vortex assistive-technology review', () => {
  it('builds a deterministic publication-bound plan for two independent human sessions', () => {
    const first = plan();
    expect(first).toEqual(plan());
    expect(first.sessions).toHaveLength(2);
    expect(first.sessions.flatMap(({ tasks }) => tasks)).toHaveLength(24);
    expect(first.sessions.every(({ tasks }) => tasks.length === 12)).toBe(true);
    expect(first.requirements).toMatchObject({
      automatedEvidenceCountsAsHumanReview: false,
      developerAssistanceAllowed: false,
      independentReviewers: 2,
    });
    expect(verifyCaseVortexAssistiveReviewPlan(first)).toBe(true);
    const tampered = structuredClone(first);
    tampered.sessions[0].tasks[0].expectedBehaviour = 'skip the actual review';
    expect(verifyCaseVortexAssistiveReviewPlan(tampered)).toBe(false);
  });

  it('seals a complete independent VoiceOver and NVDA review deterministically', () => {
    const first = buildCaseVortexAssistiveReviewReport(input());
    const second = buildCaseVortexAssistiveReviewReport(input());

    expect(first).toEqual(second);
    expect(first.humanAssistiveReviewPassed).toBe(true);
    expect(first.accounting).toMatchObject({
      sessionCount: 2,
      reviewerCount: 2,
      taskCount: 24,
      passedTaskCount: 24,
      blockingTaskCount: 0,
      unresolvedCriticalOrHighIssueCount: 0,
    });
    expect(first.criteria.every(({ passed }) => passed)).toBe(true);
    expect(first.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'accessibility_review', artifactBody: Buffer.from(JSON.stringify(first)),
      artifactInputBody: Buffer.from(JSON.stringify(input())),
      publication, verifiedAt: '2026-07-22T12:01:00.000Z',
    })).toMatchObject({
      gate: 'accessibility_review', artifactType: 'case_vortex_assistive_review_evidence_set', publication,
    });
    const driftedInput = input();
    driftedInput.sessions[0].taskOutcomes[0].notes = 'A different retained observation.';
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'accessibility_review', artifactBody: Buffer.from(JSON.stringify(first)),
      artifactInputBody: Buffer.from(JSON.stringify(driftedInput)),
      publication, verifiedAt: '2026-07-22T12:01:00.000Z',
    })).toThrow('case_vortex_authoritative_artifact_rebuild_mismatch');
  });

  it('rejects an arbitrary plan digest instead of granting unbound review credit', () => {
    const review = input();
    review.planSha256 = 'f'.repeat(64);
    expect(() => buildCaseVortexAssistiveReviewReport(review))
      .toThrow('case_vortex_assistive_review_plan_binding_invalid');
  });

  it('rejects duplicate reviewers, duplicate artifacts and incomplete task sets', () => {
    const duplicateReviewer = input();
    duplicateReviewer.sessions[1].reviewerIdHash = duplicateReviewer.sessions[0].reviewerIdHash;
    expect(() => buildCaseVortexAssistiveReviewReport(duplicateReviewer))
      .toThrow('case_vortex_assistive_review_reviewers_not_independent');

    const duplicateArtifact = input();
    duplicateArtifact.sessions[1].artifactSha256 = duplicateArtifact.sessions[0].artifactSha256;
    expect(() => buildCaseVortexAssistiveReviewReport(duplicateArtifact))
      .toThrow('case_vortex_assistive_review_artifacts_not_independent');

    const duplicateTask = input();
    duplicateTask.sessions[0].taskOutcomes[1].taskId = duplicateTask.sessions[0].taskOutcomes[0].taskId;
    expect(() => buildCaseVortexAssistiveReviewReport(duplicateTask))
      .toThrow('case_vortex_assistive_review_task_invalid');
  });

  it('retains failed observations and unresolved severe issues without claiming passage', () => {
    const review = input();
    review.sessions[0].taskOutcomes[0].focusManagementPass = false;
    review.sessions[0].taskOutcomes[0].blockingIssue = true;
    review.issues.push({
      issueId: 'focus-loss-1',
      assistiveTechnology: 'voiceover',
      taskId: 'enter_research_surface',
      severity: 'high',
      description: 'Focus leaves the research surface.',
      reproducible: true,
      resolved: false,
      resolutionReceiptSha256: null,
    });

    const report = buildCaseVortexAssistiveReviewReport(review);
    expect(report.humanAssistiveReviewPassed).toBe(false);
    expect(report.accounting).toMatchObject({
      passedTaskCount: 23,
      blockingTaskCount: 1,
      unresolvedCriticalOrHighIssueCount: 1,
    });
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'accessibility_review', artifactBody: Buffer.from(JSON.stringify(report)),
      artifactInputBody: Buffer.from(JSON.stringify(review)),
      publication, verifiedAt: '2026-07-22T12:01:00.000Z',
    })).toThrow('case_vortex_authoritative_assistive_gate_failed');
  });

  it('fails closed on announcement, independence and issue-receipt fabrication', () => {
    const missingAnnouncement = input();
    missingAnnouncement.sessions[0].taskOutcomes
      .find(({ taskId }) => taskId === 'ask_luna_question')!.statusAnnouncementPass = null;
    expect(() => buildCaseVortexAssistiveReviewReport(missingAnnouncement))
      .toThrow('case_vortex_assistive_review_task_invalid');

    const assisted = input();
    assisted.sessions[0].completedWithoutDeveloperHelp = 'yes' as unknown as boolean;
    expect(() => buildCaseVortexAssistiveReviewReport(assisted))
      .toThrow('case_vortex_assistive_review_session_invalid');

    const fakeResolution = input();
    fakeResolution.issues.push({
      issueId: 'issue-1', assistiveTechnology: 'nvda', taskId: 'ask_luna_question',
      severity: 'low', description: 'A real issue.', reproducible: true,
      resolved: true, resolutionReceiptSha256: null,
    });
    expect(() => buildCaseVortexAssistiveReviewReport(fakeResolution))
      .toThrow('case_vortex_assistive_review_issue_invalid');
  });
});
