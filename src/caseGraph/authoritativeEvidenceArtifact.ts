import { createHash } from 'node:crypto';

import {
  buildCaseVortexAssistiveReviewReport,
  CASE_VORTEX_ASSISTIVE_REVIEW_VERSION,
  type CaseVortexAssistiveReviewInput,
} from './assistiveTechnologyReview';
import {
  buildCaseVortexBrowserDeviceMatrixReport,
  CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION,
  type CaseVortexBrowserDeviceMatrixInput,
} from './browserDeviceJourneyMatrix';
import {
  CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION,
  getAuthoritativeCalibrationHumanReviewEvidence,
  type CalibrationHumanReviewDerivedEvidenceBodies,
} from './calibrationHumanReview';
import {
  CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION,
  CLAIM_ANALYSIS_ADVERSARIAL_RISKS,
  evaluateClaimAnalysisAdversarialFixture,
  type ClaimAnalysisAdversarialFixture,
  type ClaimAnalysisAdversarialReport,
} from './claimAnalysisAdversarialEvaluation';
import {
  CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
  CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS,
  type CaseVortexFullRunEvidence,
  type CaseVortexFullRunPublication,
} from './fullRunReport';
import {
  buildCaseVortexInvestigatorBenchmarkReport,
  CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION,
  type CaseVortexInvestigatorBenchmarkInput,
} from './investigatorUsefulnessBenchmark';
import {
  buildCaseVortexPerformanceMatrixReport,
  CASE_VORTEX_PERFORMANCE_MATRIX_VERSION,
  type CaseVortexPerformanceMatrixInput,
} from './performanceDeviceMatrix';
import {
  buildCaseVortexOperationsMonitoringReport,
  CASE_VORTEX_OPERATIONS_MONITORING_VERSION,
  type CaseVortexOperationsMonitoringInput,
} from './operationsMonitoringReview';
import { getCaseGraphPublicationKeys } from './archiveKeys';
import {
  readVerifiedCaseGraphPublicationCandidate,
} from './publicationArchive';
import {
  decodeCaseGraphPublicManifest,
} from './publicationManifest';
import {
  decodeRetainedInfluenceServingBundle,
} from './retainedInfluenceServing';
import {
  verifyFreshCaseVortexR2ArtifactReplayObservation,
} from './r2ArtifactReplayEvidence';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  buildCaseVortexRollbackRehearsalReport,
  CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION,
  type CaseVortexRollbackRehearsalInput,
} from './rollbackRehearsalReview';
import {
  buildCaseVortexSecurityReviewReport,
  CASE_VORTEX_SECURITY_REVIEW_VERSION,
  type CaseVortexSecurityReviewInput,
} from './securityAdversarialReview';
import {
  verifyFreshCaseVortexSupabaseControlPlaneObservation,
} from './supabaseControlPlaneEvidence';
import {
  verifyCaseVortexRetainedInfluenceIndexBuildReceipt,
} from '../db/approvedCaseVortexRetainedInfluenceIndexBuildExecutor';

export type CaseVortexAuthoritativeArtifactGate =
  | 'corpus_accounting'
  | 'publication_manifest'
  | 'supabase_control_plane'
  | 'r2_artifact_replay'
  | 'calibration_human_review'
  | 'claim_counterclaim'
  | 'investigator_benchmark'
  | 'security_review'
  | 'operations_monitoring'
  | 'rollback_rehearsal'
  | 'accessibility_review'
  | 'performance_matrix'
  | 'browser_device_matrix';

type JsonArtifactInput = {
  gate: Exclude<
    CaseVortexAuthoritativeArtifactGate,
    'calibration_human_review' | 'corpus_accounting' | 'publication_manifest'
      | 'supabase_control_plane'
      | 'r2_artifact_replay'
  >;
  artifactBody: Buffer;
  artifactInputBody: Buffer;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
};

type CalibrationArtifactInput = {
  gate: 'calibration_human_review';
  calibrationBodies: CalibrationHumanReviewDerivedEvidenceBodies;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
};

type CorpusAccountingArtifactInput = {
  gate: 'corpus_accounting';
  corpusAccountingBodies: {
    retainedServingBundleBody: Buffer;
    retainedIndexReceiptBody: Buffer;
  };
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
};

export type CaseVortexPublicationManifestEvidenceBodies = {
  completionBody: Buffer;
  manifestBody: Buffer;
  accountingReceiptBody: Buffer;
  calibrationSetReceiptBody: Buffer;
  humanReviewBundleBody: Buffer;
  pairCalibrationReceiptBody: Buffer;
  contextualCalibrationReceiptBody: Buffer;
  pairCalibrationArtifactBody: Buffer;
  pairCalibrationTrustPolicyBody: Buffer;
  contextualCalibrationArtifactBody: Buffer;
  contextualCalibrationTrustPolicyBody: Buffer;
  contextualRelationshipCompletionBody: Buffer;
  productionCompatibilityReceiptBody: Buffer;
};

type PublicationManifestArtifactInput = {
  gate: 'publication_manifest';
  publicationManifestBodies: CaseVortexPublicationManifestEvidenceBodies;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
};

type SupabaseControlPlaneArtifactInput = {
  gate: 'supabase_control_plane';
  observationBody: Buffer;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
};

type R2ArtifactReplayInput = {
  gate: 'r2_artifact_replay';
  observationBody: Buffer;
  publicationManifestBodies: CaseVortexPublicationManifestEvidenceBodies;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_PUBLICATION_ARCHIVE_BODY_BYTES = 96 * 1024 * 1024;
const TEST_ONLY_MARKER = /(?:synthetic|simulated|fixture|test[-_: ]only|never[-_: ]publication)/iu;

const invalid = (code: string): never => { throw new Error(code); };
const record = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as Record<string, unknown>;
};
const integer = (value: unknown, expected: number, code: string) => {
  if (value !== expected) invalid(code);
};
const trueValue = (value: unknown, code: string) => {
  if (value !== true) invalid(code);
};
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40) invalid(code);
  const candidate = value as string;
  try {
    if (new Date(candidate).toISOString() !== candidate) invalid(code);
  } catch {
    invalid(code);
  }
  return candidate;
};
const rawSha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const samePublication = (value: unknown, expected: CaseVortexFullRunPublication) => {
  if (!UUID.test(expected.publicationId) || !expected.corpusVersion
    || expected.corpusVersion.length > 240 || !SHA256.test(expected.manifestSha256)) {
    invalid('case_vortex_authoritative_artifact_publication_invalid');
  }
  const candidate = record(value, 'case_vortex_authoritative_artifact_publication_invalid');
  if (candidate.publicationId !== expected.publicationId
    || candidate.corpusVersion !== expected.corpusVersion
    || candidate.manifestSha256 !== expected.manifestSha256) {
    invalid('case_vortex_authoritative_artifact_publication_mismatch');
  }
};

const parseReport = (body: Buffer) => {
  if (!Buffer.isBuffer(body) || body.byteLength < 2 || body.byteLength > MAX_ARTIFACT_BYTES) {
    invalid('case_vortex_authoritative_artifact_bytes_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    invalid('case_vortex_authoritative_artifact_json_invalid');
  }
  const report = record(parsed, 'case_vortex_authoritative_artifact_report_invalid');
  if (typeof report.reportSha256 !== 'string' || !SHA256.test(report.reportSha256)) {
    invalid('case_vortex_authoritative_artifact_digest_invalid');
  }
  const { reportSha256, ...withoutDigest } = report;
  if (relationshipInputSha256(withoutDigest) !== reportSha256) {
    invalid('case_vortex_authoritative_artifact_digest_mismatch');
  }
  return report;
};

const parseInput = (body: Buffer) => {
  if (!Buffer.isBuffer(body) || body.byteLength < 2 || body.byteLength > MAX_ARTIFACT_BYTES) {
    invalid('case_vortex_authoritative_artifact_input_bytes_invalid');
  }
  try {
    return record(JSON.parse(body.toString('utf8')),
      'case_vortex_authoritative_artifact_input_invalid');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('case_vortex_')) throw error;
    return invalid('case_vortex_authoritative_artifact_input_invalid');
  }
};

const assertBoundedBody = (body: Buffer, code: string) => {
  if (!Buffer.isBuffer(body)
    || body.byteLength < 2
    || body.byteLength > MAX_PUBLICATION_ARCHIVE_BODY_BYTES) {
    invalid(code);
  }
};

const parseClaimAnalysisReport = (body: Buffer) => {
  if (!Buffer.isBuffer(body) || body.byteLength < 2 || body.byteLength > MAX_ARTIFACT_BYTES) {
    invalid('case_vortex_authoritative_claim_analysis_bytes_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    invalid('case_vortex_authoritative_claim_analysis_json_invalid');
  }
  const report = record(parsed, 'case_vortex_authoritative_claim_analysis_report_invalid');
  if (typeof report.reportDigest !== 'string' || !SHA256.test(report.reportDigest)) {
    invalid('case_vortex_authoritative_claim_analysis_digest_invalid');
  }
  const { reportDigest, ...withoutDigest } = report;
  if (relationshipInputSha256(withoutDigest) !== reportDigest) {
    invalid('case_vortex_authoritative_claim_analysis_digest_mismatch');
  }
  return report as unknown as ClaimAnalysisAdversarialReport;
};

const rejectCalibrationTestMarkers = (body: Buffer) => {
  if (!Buffer.isBuffer(body) || body.byteLength < 2 || body.byteLength > MAX_ARTIFACT_BYTES) {
    invalid('case_vortex_authoritative_calibration_bytes_invalid');
  }
  let declaration: Record<string, unknown>;
  try {
    declaration = record(JSON.parse(body.toString('utf8')),
      'case_vortex_authoritative_calibration_declaration_invalid');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('case_vortex_')) throw error;
    return invalid('case_vortex_authoritative_calibration_declaration_invalid');
  }
  const pack = record(declaration.pack, 'case_vortex_authoritative_calibration_declaration_invalid');
  const source = record(pack.sourceEvidence,
    'case_vortex_authoritative_calibration_declaration_invalid');
  const policy = record(pack.reviewPolicy,
    'case_vortex_authoritative_calibration_declaration_invalid');
  const identities = [
    source.sourceId,
    policy.adjudicatorId,
    policy.pairReviewerCohortId,
    policy.pairAdjudicationPolicyVersion,
    policy.contextualReviewerCohortId,
    policy.contextualAdjudicationPolicyVersion,
    ...(Array.isArray(policy.reviewerIds) ? policy.reviewerIds : []),
  ];
  if (identities.some((value) => typeof value !== 'string' || TEST_ONLY_MARKER.test(value))) {
    invalid('case_vortex_authoritative_calibration_test_marker_rejected');
  }
};

const criteriaPass = (value: unknown, code: string) => {
  if (!Array.isArray(value) || !value.length
    || value.some((entry) => record(entry, code).passed !== true)) invalid(code);
};

const verifyInvestigator = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_investigator_benchmark_report'
    || report.schemaVersion !== CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION) {
    invalid('case_vortex_authoritative_investigator_artifact_invalid');
  }
  trueValue(report.eligibleForBestAvailableClaim, 'case_vortex_authoritative_investigator_gate_failed');
  criteriaPass(report.criteria, 'case_vortex_authoritative_investigator_gate_failed');
  const accounting = record(report.accounting, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.studyPlanSlotCount, 200, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.distinctEvidenceArtifactCount, 1_400,
    'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.reviewedQueryCount, 200, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.sourceReconstructionCount, 50, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.independentReviewerCount, 2, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.fabricatedIdentifierCount, 0, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.unsupportedExhaustiveClaimCount, 0, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.misleadingReviewCount, 0, 'case_vortex_authoritative_investigator_gate_failed');
  integer(accounting.comparisonRunCount, 400, 'case_vortex_authoritative_investigator_gate_failed');
};

const verifyAssistive = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_assistive_review_report'
    || report.schemaVersion !== CASE_VORTEX_ASSISTIVE_REVIEW_VERSION) {
    invalid('case_vortex_authoritative_assistive_artifact_invalid');
  }
  trueValue(report.humanAssistiveReviewPassed, 'case_vortex_authoritative_assistive_gate_failed');
  criteriaPass(report.criteria, 'case_vortex_authoritative_assistive_gate_failed');
  const accounting = record(report.accounting, 'case_vortex_authoritative_assistive_gate_failed');
  integer(accounting.sessionCount, 2, 'case_vortex_authoritative_assistive_gate_failed');
  integer(accounting.reviewerCount, 2, 'case_vortex_authoritative_assistive_gate_failed');
  integer(accounting.taskCount, 24, 'case_vortex_authoritative_assistive_gate_failed');
  integer(accounting.passedTaskCount, 24, 'case_vortex_authoritative_assistive_gate_failed');
  integer(accounting.blockingTaskCount, 0, 'case_vortex_authoritative_assistive_gate_failed');
  integer(accounting.unresolvedCriticalOrHighIssueCount, 0,
    'case_vortex_authoritative_assistive_gate_failed');
};

const verifyPerformance = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_performance_matrix_report'
    || report.schemaVersion !== CASE_VORTEX_PERFORMANCE_MATRIX_VERSION) {
    invalid('case_vortex_authoritative_performance_artifact_invalid');
  }
  trueValue(report.performanceMatrixPassed, 'case_vortex_authoritative_performance_gate_failed');
  const accounting = record(report.accounting, 'case_vortex_authoritative_performance_gate_failed');
  integer(accounting.profileCount, 3, 'case_vortex_authoritative_performance_gate_failed');
  integer(accounting.runCount, 9, 'case_vortex_authoritative_performance_gate_failed');
  integer(accounting.passedRunCount, 9, 'case_vortex_authoritative_performance_gate_failed');
  integer(accounting.failedRunCount, 0, 'case_vortex_authoritative_performance_gate_failed');
  if (!Array.isArray(report.runs) || report.runs.length !== 9
    || report.runs.some((value) => {
      const run = record(value, 'case_vortex_authoritative_performance_gate_failed');
      const device = record(run.device, 'case_vortex_authoritative_performance_gate_failed');
      return run.passed !== true || device.physicalDevice !== true || device.browserEmulation !== false;
    })) invalid('case_vortex_authoritative_performance_gate_failed');
};

const verifyBrowserDevice = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_browser_device_matrix_report'
    || report.schemaVersion !== CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION) {
    invalid('case_vortex_authoritative_browser_device_artifact_invalid');
  }
  trueValue(report.browserDeviceMatrixPassed, 'case_vortex_authoritative_browser_device_gate_failed');
  const accounting = record(report.accounting, 'case_vortex_authoritative_browser_device_gate_failed');
  integer(accounting.profileCount, 7, 'case_vortex_authoritative_browser_device_gate_failed');
  integer(accounting.sessionCount, 7, 'case_vortex_authoritative_browser_device_gate_failed');
  integer(accounting.journeyObservationCount, 98, 'case_vortex_authoritative_browser_device_gate_failed');
  integer(accounting.passedSessionCount, 7, 'case_vortex_authoritative_browser_device_gate_failed');
  integer(accounting.failedSessionCount, 0, 'case_vortex_authoritative_browser_device_gate_failed');
  if (!Array.isArray(report.sessions) || report.sessions.length !== 7
    || report.sessions.some((value) => {
      const session = record(value, 'case_vortex_authoritative_browser_device_gate_failed');
      return session.passed !== true || session.publicationManifestVerified !== true;
    })) invalid('case_vortex_authoritative_browser_device_gate_failed');
};

const verifySecurity = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_security_review_report'
    || report.schemaVersion !== CASE_VORTEX_SECURITY_REVIEW_VERSION) {
    invalid('case_vortex_authoritative_security_artifact_invalid');
  }
  trueValue(report.securityReviewPassed, 'case_vortex_authoritative_security_gate_failed');
  criteriaPass(report.criteria, 'case_vortex_authoritative_security_gate_failed');
  const accounting = record(report.accounting, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.sessionCount, 2, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.reviewerCount, 2, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.riskCount, 12, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.observationCount, 24, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.passedObservationCount, 24, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.mutationCount, 0, 'case_vortex_authoritative_security_gate_failed');
  integer(accounting.boundaryViolationCount, 0, 'case_vortex_authoritative_security_gate_failed');
  integer(
    accounting.unresolvedCriticalOrHighIssueCount,
    0,
    'case_vortex_authoritative_security_gate_failed',
  );
  if (!Array.isArray(report.sessions) || report.sessions.length !== 2
    || report.sessions.some((value) => {
      const session = record(value, 'case_vortex_authoritative_security_gate_failed');
      return session.completedWithoutDeveloperHelp !== true
        || !Array.isArray(session.observations)
        || session.observations.length !== 12
        || session.observations.some((observation) => (
          record(observation, 'case_vortex_authoritative_security_gate_failed').passed !== true
        ));
    })) {
    invalid('case_vortex_authoritative_security_gate_failed');
  }
};

const verifyOperationsMonitoring = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_operations_monitoring_report'
    || report.schemaVersion !== CASE_VORTEX_OPERATIONS_MONITORING_VERSION) {
    invalid('case_vortex_authoritative_operations_monitoring_artifact_invalid');
  }
  trueValue(
    report.operationsMonitoringPassed,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  criteriaPass(
    report.criteria,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  const accounting = record(
    report.accounting,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.drillCount,
    10,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.passedDrillCount,
    10,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.telemetryPhaseCount,
    5,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.passedTelemetryCount,
    5,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.artifactCount,
    15,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.mutationCount,
    0,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  integer(
    accounting.unresolvedCriticalOrHighIssueCount,
    0,
    'case_vortex_authoritative_operations_monitoring_gate_failed',
  );
  if (!Array.isArray(report.drills) || report.drills.length !== 10
    || report.drills.some((value) => (
      record(value, 'case_vortex_authoritative_operations_monitoring_gate_failed').passed !== true
    ))
    || !Array.isArray(report.telemetry) || report.telemetry.length !== 5
    || report.telemetry.some((value) => (
      record(value, 'case_vortex_authoritative_operations_monitoring_gate_failed').passed !== true
    ))) {
    invalid('case_vortex_authoritative_operations_monitoring_gate_failed');
  }
};

const verifyRollbackRehearsal = (report: Record<string, unknown>) => {
  if (report.recordType !== 'case_vortex_rollback_rehearsal_report'
    || report.schemaVersion !== CASE_VORTEX_ROLLBACK_REHEARSAL_VERSION) {
    invalid('case_vortex_authoritative_rollback_rehearsal_artifact_invalid');
  }
  trueValue(
    report.rollbackRehearsalPassed,
    'case_vortex_authoritative_rollback_rehearsal_gate_failed',
  );
  criteriaPass(
    report.criteria,
    'case_vortex_authoritative_rollback_rehearsal_gate_failed',
  );
  const accounting = record(
    report.accounting,
    'case_vortex_authoritative_rollback_rehearsal_gate_failed',
  );
  for (const [field, expected] of [
    ['stepCount', 8],
    ['passedStepCount', 8],
    ['artifactCount', 8],
    ['committedSwitchTransactionCount', 2],
    ['rollbackLineageWriteCount', 1],
    ['directFlagMutationCount', 0],
    ['failedTransactionResidueCount', 0],
    ['externalMutationCount', 0],
    ['unresolvedCriticalOrHighIssueCount', 0],
  ] as const) {
    integer(
      accounting[field],
      expected,
      'case_vortex_authoritative_rollback_rehearsal_gate_failed',
    );
  }
  if (report.ephemeralDatabase !== true
    || !Array.isArray(report.steps) || report.steps.length !== 8
    || report.steps.some((value) => (
      record(value, 'case_vortex_authoritative_rollback_rehearsal_gate_failed').passed !== true
    ))) {
    invalid('case_vortex_authoritative_rollback_rehearsal_gate_failed');
  }
};

export const verifyCaseVortexAuthoritativeEvidenceArtifact = (
  input: JsonArtifactInput | CalibrationArtifactInput | CorpusAccountingArtifactInput,
): CaseVortexFullRunEvidence => {
  const verifiedAt = timestamp(input.verifiedAt, 'case_vortex_authoritative_artifact_verified_at_invalid');
  const required = CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[input.gate];
  if (!required) return invalid('case_vortex_authoritative_artifact_contract_missing');
  if (input.gate === 'calibration_human_review') {
    samePublication(input.publication, input.publication);
    rejectCalibrationTestMarkers(input.calibrationBodies.bundleBody);
    getAuthoritativeCalibrationHumanReviewEvidence(input.calibrationBodies);
    return {
      gate: input.gate,
      artifactType: required.artifactType,
      schemaVersion: required.schemaVersion,
      artifactSha256: relationshipInputSha256({
        schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
        bodySha256: Object.entries(input.calibrationBodies)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, body]) => ({ name, sha256: rawSha256(body) })),
      }),
      verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
      verifiedAt,
      publication: input.publication,
    };
  }
  if (input.gate === 'corpus_accounting') {
    const bundle = decodeRetainedInfluenceServingBundle(
      input.corpusAccountingBodies.retainedServingBundleBody,
    );
    const decodedIndexReceipt = verifyCaseVortexRetainedInfluenceIndexBuildReceipt(parseInput(
      input.corpusAccountingBodies.retainedIndexReceiptBody,
    ));
    const indexReceipt = decodedIndexReceipt.recordType
      === 'case_vortex_retained_influence_index_build_receipt'
      ? decodedIndexReceipt
      : invalid('case_vortex_authoritative_corpus_accounting_build_not_verified');
    samePublication({
      publicationId: indexReceipt.publicationId,
      corpusVersion: indexReceipt.corpusVersion,
      manifestSha256: indexReceipt.publicManifestSha256,
    }, input.publication);
    const completedAt = timestamp(
      indexReceipt.completedAt,
      'case_vortex_authoritative_corpus_accounting_completed_at_invalid',
    );
    if (completedAt > verifiedAt) {
      invalid('case_vortex_authoritative_corpus_accounting_completed_at_invalid');
    }
    const influence = bundle.influenceReceipt;
    const lanes = influence.influenceLaneCounts;
    const laneTotal = Object.values(lanes).reduce((sum, count) => sum + count, 0);
    if (rawSha256(input.corpusAccountingBodies.retainedServingBundleBody)
        !== indexReceipt.bundleSha256
      || influence.receiptSha256 !== indexReceipt.influenceReceiptSha256
      || lanes.discovery_signal !== indexReceipt.discoverySignalCount
      || lanes.metadata_lead !== indexReceipt.metadataLeadCount
      || indexReceipt.entryCount !== lanes.discovery_signal + lanes.metadata_lead
      || laneTotal !== influence.accounting.retainedRecordCount
      || laneTotal !== influence.accounting.influencedRecordCount
      || influence.accounting.silentlyDiscardedRecordCount !== 0
      || Object.values(influence.guarantees).some((guarantee) => guarantee !== true)) {
      invalid('case_vortex_authoritative_corpus_accounting_gate_failed');
    }
    return {
      gate: input.gate,
      artifactType: required.artifactType,
      schemaVersion: required.schemaVersion,
      artifactSha256: relationshipInputSha256({
        schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
        retainedServingBundleBodySha256: rawSha256(
          input.corpusAccountingBodies.retainedServingBundleBody,
        ),
        retainedIndexReceiptBodySha256: rawSha256(
          input.corpusAccountingBodies.retainedIndexReceiptBody,
        ),
      }),
      verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
      verifiedAt,
      publication: input.publication,
    };
  }
  if (input.gate === 'claim_counterclaim') {
    samePublication(input.publication, input.publication);
    const fixture = parseInput(input.artifactInputBody) as unknown as ClaimAnalysisAdversarialFixture;
    const report = parseClaimAnalysisReport(input.artifactBody);
    const gate = record(report.gate, 'case_vortex_authoritative_claim_analysis_gate_failed');
    const counts = record(report.counts, 'case_vortex_authoritative_claim_analysis_gate_failed');
    const riskCoverage = record(
      report.riskCoverage,
      'case_vortex_authoritative_claim_analysis_gate_failed',
    );
    if (report.recordType !== 'case_graph_claim_analysis_adversarial_report'
      || report.schemaVersion !== CLAIM_ANALYSIS_ADVERSARIAL_EVALUATION_VERSION
      || gate.passed !== true
      || counts.scenarios !== CLAIM_ANALYSIS_ADVERSARIAL_RISKS.length
      || counts.passed !== CLAIM_ANALYSIS_ADVERSARIAL_RISKS.length
      || counts.failed !== 0
      || counts.violations !== 0
      || CLAIM_ANALYSIS_ADVERSARIAL_RISKS.some((risk) => riskCoverage[risk] !== 1)) {
      invalid('case_vortex_authoritative_claim_analysis_gate_failed');
    }
    const rebuilt = evaluateClaimAnalysisAdversarialFixture(fixture);
    if (relationshipInputSha256(rebuilt) !== relationshipInputSha256(report)) {
      invalid('case_vortex_authoritative_artifact_rebuild_mismatch');
    }
    return {
      gate: input.gate,
      artifactType: required.artifactType,
      schemaVersion: required.schemaVersion,
      artifactSha256: relationshipInputSha256({
        schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
        inputBodySha256: rawSha256(input.artifactInputBody),
        reportBodySha256: rawSha256(input.artifactBody),
      }),
      verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
      verifiedAt,
      publication: input.publication,
    };
  }
  const report = parseReport(input.artifactBody);
  const artifactInput = parseInput(input.artifactInputBody);
  samePublication(report.publication, input.publication);
  const completedAt = timestamp(report.completedAt, 'case_vortex_authoritative_artifact_completed_at_invalid');
  if (completedAt > verifiedAt) invalid('case_vortex_authoritative_artifact_completed_at_invalid');
  let rebuilt: Record<string, unknown>;
  if (input.gate === 'investigator_benchmark') {
    verifyInvestigator(report);
    rebuilt = buildCaseVortexInvestigatorBenchmarkReport(
      artifactInput as unknown as CaseVortexInvestigatorBenchmarkInput,
    ) as unknown as Record<string, unknown>;
  } else if (input.gate === 'accessibility_review') {
    verifyAssistive(report);
    rebuilt = buildCaseVortexAssistiveReviewReport(
      artifactInput as unknown as CaseVortexAssistiveReviewInput,
    ) as unknown as Record<string, unknown>;
  } else if (input.gate === 'security_review') {
    verifySecurity(report);
    rebuilt = buildCaseVortexSecurityReviewReport(
      artifactInput as unknown as CaseVortexSecurityReviewInput,
    ) as unknown as Record<string, unknown>;
  } else if (input.gate === 'operations_monitoring') {
    verifyOperationsMonitoring(report);
    rebuilt = buildCaseVortexOperationsMonitoringReport(
      artifactInput as unknown as CaseVortexOperationsMonitoringInput,
    ) as unknown as Record<string, unknown>;
  } else if (input.gate === 'rollback_rehearsal') {
    verifyRollbackRehearsal(report);
    rebuilt = buildCaseVortexRollbackRehearsalReport(
      artifactInput as unknown as CaseVortexRollbackRehearsalInput,
    ) as unknown as Record<string, unknown>;
  } else if (input.gate === 'performance_matrix') {
    verifyPerformance(report);
    rebuilt = buildCaseVortexPerformanceMatrixReport(
      artifactInput as unknown as CaseVortexPerformanceMatrixInput,
    ) as unknown as Record<string, unknown>;
  } else {
    verifyBrowserDevice(report);
    rebuilt = buildCaseVortexBrowserDeviceMatrixReport(
      artifactInput as unknown as CaseVortexBrowserDeviceMatrixInput,
    ) as unknown as Record<string, unknown>;
  }
  if (relationshipInputSha256(rebuilt) !== relationshipInputSha256(report)) {
    invalid('case_vortex_authoritative_artifact_rebuild_mismatch');
  }
  return {
    gate: input.gate,
    artifactType: required.artifactType,
    schemaVersion: required.schemaVersion,
    artifactSha256: relationshipInputSha256({
      schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
      inputBodySha256: rawSha256(input.artifactInputBody),
      reportBodySha256: rawSha256(input.artifactBody),
    }),
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
    verifiedAt,
    publication: input.publication,
  };
};

export const verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact = async (
  input: PublicationManifestArtifactInput,
): Promise<CaseVortexFullRunEvidence> => {
  const verifiedAt = timestamp(
    input.verifiedAt,
    'case_vortex_authoritative_artifact_verified_at_invalid',
  );
  samePublication(input.publication, input.publication);
  const required = CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS.publication_manifest;
  if (!required) return invalid('case_vortex_authoritative_artifact_contract_missing');
  for (const body of Object.values(input.publicationManifestBodies)) {
    assertBoundedBody(body, 'case_vortex_authoritative_publication_manifest_bytes_invalid');
  }

  const keys = getCaseGraphPublicationKeys(input.publication.corpusVersion);
  const decodedManifest = decodeCaseGraphPublicManifest(
    input.publicationManifestBodies.manifestBody,
    input.publication.corpusVersion,
  );
  const archiveBodies = new Map<string, Buffer>([
    [keys.completionManifestKey, input.publicationManifestBodies.completionBody],
    [keys.manifestKey, input.publicationManifestBodies.manifestBody],
    [keys.accountingReceiptKey, input.publicationManifestBodies.accountingReceiptBody],
    [keys.calibrationSetReceiptKey, input.publicationManifestBodies.calibrationSetReceiptBody],
    [keys.humanReviewBundleKey, input.publicationManifestBodies.humanReviewBundleBody],
    [keys.pairCalibrationReceiptKey, input.publicationManifestBodies.pairCalibrationReceiptBody],
    [
      keys.contextualCalibrationReceiptKey,
      input.publicationManifestBodies.contextualCalibrationReceiptBody,
    ],
    [keys.pairCalibrationArtifactKey, input.publicationManifestBodies.pairCalibrationArtifactBody],
    [
      keys.pairCalibrationTrustPolicyKey,
      input.publicationManifestBodies.pairCalibrationTrustPolicyBody,
    ],
    [
      keys.contextualCalibrationArtifactKey,
      input.publicationManifestBodies.contextualCalibrationArtifactBody,
    ],
    [
      keys.contextualCalibrationTrustPolicyKey,
      input.publicationManifestBodies.contextualCalibrationTrustPolicyBody,
    ],
    [
      keys.contextualRelationshipCompletionKey,
      input.publicationManifestBodies.contextualRelationshipCompletionBody,
    ],
    [
      decodedManifest.lineage.productionCompatibility.archiveKey,
      input.publicationManifestBodies.productionCompatibilityReceiptBody,
    ],
  ]);
  if (archiveBodies.size !== 13) {
    invalid('case_vortex_authoritative_publication_manifest_archive_key_collision');
  }

  const verified = await readVerifiedCaseGraphPublicationCandidate({
    readObject: async (key: string) => archiveBodies.get(key) || null,
  }, input.publication.corpusVersion);
  if (verified.completion.manifest_sha256 !== input.publication.manifestSha256
    || verified.manifest.corpusVersion !== input.publication.corpusVersion
    || rawSha256(verified.manifestBody) !== input.publication.manifestSha256) {
    invalid('case_vortex_authoritative_artifact_publication_mismatch');
  }
  const completedAt = timestamp(
    verified.completion.generated_at,
    'case_vortex_authoritative_publication_manifest_completed_at_invalid',
  );
  if (completedAt > verifiedAt) {
    invalid('case_vortex_authoritative_publication_manifest_completed_at_invalid');
  }

  return {
    gate: input.gate,
    artifactType: required.artifactType,
    schemaVersion: required.schemaVersion,
    artifactSha256: relationshipInputSha256({
      schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
      archiveScope: 'immutable_candidate_archive_not_control_plane_or_activation',
      bodies: Object.entries(input.publicationManifestBodies)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, body]) => ({ name, sha256: rawSha256(body) })),
    }),
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
    verifiedAt,
    publication: input.publication,
  };
};

export const verifyCaseVortexAuthoritativeSupabaseControlPlaneEvidenceArtifact = (
  input: SupabaseControlPlaneArtifactInput,
): CaseVortexFullRunEvidence => {
  assertBoundedBody(
    input.observationBody,
    'case_vortex_authoritative_supabase_control_plane_bytes_invalid',
  );
  const required = CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS.supabase_control_plane;
  if (!required) return invalid('case_vortex_authoritative_artifact_contract_missing');
  const observation = verifyFreshCaseVortexSupabaseControlPlaneObservation({
    observation: parseInput(input.observationBody),
    publication: input.publication,
    verifiedAt: input.verifiedAt,
  });
  return {
    gate: input.gate,
    artifactType: required.artifactType,
    schemaVersion: required.schemaVersion,
    artifactSha256: relationshipInputSha256({
      schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
      observationSha256: observation.observationSha256,
      observationBodySha256: rawSha256(input.observationBody),
      scope: 'read_only_candidate_existence_not_activation_or_deployment',
    }),
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
    verifiedAt: input.verifiedAt,
    publication: input.publication,
  };
};

export const verifyCaseVortexAuthoritativeR2ArtifactReplayEvidenceArtifact = async (
  input: R2ArtifactReplayInput,
): Promise<CaseVortexFullRunEvidence> => {
  assertBoundedBody(
    input.observationBody,
    'case_vortex_authoritative_r2_artifact_replay_bytes_invalid',
  );
  const required = CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS.r2_artifact_replay;
  if (!required) return invalid('case_vortex_authoritative_artifact_contract_missing');
  const publicationArchiveEvidence =
    await verifyCaseVortexAuthoritativePublicationManifestEvidenceArtifact({
      gate: 'publication_manifest',
      publicationManifestBodies: input.publicationManifestBodies,
      publication: input.publication,
      verifiedAt: input.verifiedAt,
    });
  const observation = verifyFreshCaseVortexR2ArtifactReplayObservation({
    observation: parseInput(input.observationBody),
    publication: input.publication,
    verifiedAt: input.verifiedAt,
  });
  const keys = getCaseGraphPublicationKeys(input.publication.corpusVersion);
  const decodedManifest = decodeCaseGraphPublicManifest(
    input.publicationManifestBodies.manifestBody,
    input.publication.corpusVersion,
  );
  const exactBodies = new Map<string, Buffer>([
    [keys.completionManifestKey, input.publicationManifestBodies.completionBody],
    [keys.manifestKey, input.publicationManifestBodies.manifestBody],
    [keys.accountingReceiptKey, input.publicationManifestBodies.accountingReceiptBody],
    [keys.calibrationSetReceiptKey, input.publicationManifestBodies.calibrationSetReceiptBody],
    [keys.humanReviewBundleKey, input.publicationManifestBodies.humanReviewBundleBody],
    [keys.pairCalibrationReceiptKey, input.publicationManifestBodies.pairCalibrationReceiptBody],
    [
      keys.contextualCalibrationReceiptKey,
      input.publicationManifestBodies.contextualCalibrationReceiptBody,
    ],
    [keys.pairCalibrationArtifactKey, input.publicationManifestBodies.pairCalibrationArtifactBody],
    [
      keys.pairCalibrationTrustPolicyKey,
      input.publicationManifestBodies.pairCalibrationTrustPolicyBody,
    ],
    [
      keys.contextualCalibrationArtifactKey,
      input.publicationManifestBodies.contextualCalibrationArtifactBody,
    ],
    [
      keys.contextualCalibrationTrustPolicyKey,
      input.publicationManifestBodies.contextualCalibrationTrustPolicyBody,
    ],
    [
      keys.contextualRelationshipCompletionKey,
      input.publicationManifestBodies.contextualRelationshipCompletionBody,
    ],
    [
      decodedManifest.lineage.productionCompatibility.archiveKey,
      input.publicationManifestBodies.productionCompatibilityReceiptBody,
    ],
  ]);
  if (exactBodies.size !== observation.objectCount
    || observation.objects.some((object) => {
      const body = exactBodies.get(object.key);
      return !body || body.byteLength !== object.bodyBytes || rawSha256(body) !== object.bodySha256;
    })) {
    invalid('case_vortex_authoritative_r2_artifact_replay_object_mismatch');
  }
  return {
    gate: input.gate,
    artifactType: required.artifactType,
    schemaVersion: required.schemaVersion,
    artifactSha256: relationshipInputSha256({
      schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
      publicationArchiveEvidenceSha256: publicationArchiveEvidence.artifactSha256,
      replayObservationSha256: observation.observationSha256,
      replayObservationBodySha256: rawSha256(input.observationBody),
      scope: 'immutable_r2_read_replay_not_storage_write_activation_or_deployment',
    }),
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
    verifiedAt: input.verifiedAt,
    publication: input.publication,
  };
};
