import { relationshipInputSha256 } from './relationshipInputSnapshot';
import { CALIBRATION_HUMAN_REVIEW_SCHEMA_VERSION } from './calibrationHumanReview';
import { CASE_VORTEX_INVESTIGATOR_BENCHMARK_VERSION } from './investigatorUsefulnessBenchmark';

export const CASE_VORTEX_FULL_RUN_REPORT_VERSION = 'case-vortex-full-run-report-v1' as const;
export const CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION =
  'case-vortex-authoritative-artifact-verifier-v1' as const;
export const CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION =
  'case-vortex-authoritative-evidence-set-v1' as const;

export const CASE_VORTEX_FULL_RUN_GATES = [
  'corpus_accounting',
  'publication_manifest',
  'calibration_human_review',
  'content_ingestion',
  'claim_graph',
  'source_reliability',
  'claim_counterclaim',
  'similar_cases',
  'workspace_durability',
  'external_correlations',
  'precise_citations',
  'orb_semantic_zoom',
  'living_dossiers',
  'reproducible_reports',
  'luna_tool_contract',
  'investigator_benchmark',
  'supabase_control_plane',
  'r2_artifact_replay',
  'security_review',
  'accessibility_review',
  'performance_matrix',
  'operations_monitoring',
  'rollback_rehearsal',
  'browser_device_matrix',
] as const;

export type CaseVortexFullRunGate = typeof CASE_VORTEX_FULL_RUN_GATES[number];

export const CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS: Partial<Record<
  CaseVortexFullRunGate,
  { artifactType: string; schemaVersion: string; verifierVersion: string }
>> = {
  corpus_accounting: {
    artifactType: 'case_vortex_zero_discard_corpus_accounting_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  publication_manifest: {
    artifactType: 'case_vortex_immutable_publication_candidate_archive_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  supabase_control_plane: {
    artifactType: 'case_vortex_supabase_control_plane_observation_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  r2_artifact_replay: {
    artifactType: 'case_vortex_r2_artifact_replay_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  security_review: {
    artifactType: 'case_vortex_adversarial_security_review_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  operations_monitoring: {
    artifactType: 'case_vortex_operations_monitoring_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  rollback_rehearsal: {
    artifactType: 'case_vortex_publication_rollback_rehearsal_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  calibration_human_review: {
    artifactType: 'case_vortex_calibration_human_review_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  investigator_benchmark: {
    artifactType: 'case_vortex_investigator_benchmark_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  claim_counterclaim: {
    artifactType: 'case_vortex_claim_analysis_adversarial_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  accessibility_review: {
    artifactType: 'case_vortex_assistive_review_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  performance_matrix: {
    artifactType: 'case_vortex_performance_matrix_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
  browser_device_matrix: {
    artifactType: 'case_vortex_browser_device_matrix_evidence_set',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_EVIDENCE_SET_VERSION,
    verifierVersion: CASE_VORTEX_AUTHORITATIVE_ARTIFACT_VERIFIER_VERSION,
  },
};

export type CaseVortexFullRunPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexFullRunEvidence = {
  gate: CaseVortexFullRunGate;
  artifactType: string;
  schemaVersion: string;
  artifactSha256: string;
  verifierVersion: string;
  verifiedAt: string;
  publication: CaseVortexFullRunPublication;
};

export type CaseVortexFullRunDeploymentEvidence = {
  status: 'verified';
  approvalReceiptSha256: string;
  deploymentReceiptSha256: string;
  liveVerificationSha256: string;
  verifiedAt: string;
  publication: CaseVortexFullRunPublication;
};

export type CaseVortexFullRunReportInput = {
  recordType: 'case_vortex_full_run_report_input';
  schemaVersion: typeof CASE_VORTEX_FULL_RUN_REPORT_VERSION;
  runId: string;
  generatedAt: string;
  publication: CaseVortexFullRunPublication;
  evidence: CaseVortexFullRunEvidence[];
  deployment: { status: 'not_requested' } | CaseVortexFullRunDeploymentEvidence;
};

export type CaseVortexFullRunCriterion = {
  gate: CaseVortexFullRunGate;
  passed: boolean;
  artifactSha256: string | null;
};

export type CaseVortexFullRunReport = {
  recordType: 'case_vortex_full_run_report';
  schemaVersion: typeof CASE_VORTEX_FULL_RUN_REPORT_VERSION;
  runId: string;
  generatedAt: string;
  publication: CaseVortexFullRunPublication;
  evidence: CaseVortexFullRunEvidence[];
  criteria: CaseVortexFullRunCriterion[];
  missingGates: CaseVortexFullRunGate[];
  candidateEligible: boolean;
  deployment: { status: 'not_requested' } | CaseVortexFullRunDeploymentEvidence;
  objectiveEligible: boolean;
  limitations: string[];
  reportSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const gates = new Set<string>(CASE_VORTEX_FULL_RUN_GATES);

const invalid = (code: string): never => { throw new Error(code); };
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exact = (value: unknown, keys: readonly string[], code: string) => {
  if (!isRecord(value)) invalid(code);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const allowed = new Set(keys);
  if (actual.length !== keys.length || keys.some((key) => !own(record, key)) || actual.some((key) => !allowed.has(key))) {
    invalid(code);
  }
  return record;
};

const requireSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value as string;
};

const requireId = (value: unknown, pattern: RegExp, code: string) => {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(code);
  return value as string;
};

const requireTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40) invalid(code);
  const timestamp = value as string;
  try {
    if (new Date(timestamp).toISOString() !== timestamp) invalid(code);
  } catch {
    invalid(code);
  }
  return timestamp;
};

const decodePublication = (value: unknown): CaseVortexFullRunPublication => {
  const publication = exact(value, ['publicationId', 'corpusVersion', 'manifestSha256'],
    'case_vortex_full_run_publication_invalid');
  return {
    publicationId: requireId(publication.publicationId, UUID, 'case_vortex_full_run_publication_invalid'),
    corpusVersion: requireId(publication.corpusVersion, VERSION, 'case_vortex_full_run_publication_invalid'),
    manifestSha256: requireSha(publication.manifestSha256, 'case_vortex_full_run_publication_invalid'),
  };
};

const samePublication = (left: CaseVortexFullRunPublication, right: CaseVortexFullRunPublication) => (
  left.publicationId === right.publicationId
  && left.corpusVersion === right.corpusVersion
  && left.manifestSha256 === right.manifestSha256
);

const decodeEvidence = (
  value: unknown,
  publication: CaseVortexFullRunPublication,
  generatedAt: string,
): CaseVortexFullRunEvidence => {
  const evidence = exact(value, [
    'gate', 'artifactType', 'schemaVersion', 'artifactSha256', 'verifierVersion', 'verifiedAt', 'publication',
  ], 'case_vortex_full_run_evidence_invalid');
  if (typeof evidence.gate !== 'string' || !gates.has(evidence.gate)) {
    invalid('case_vortex_full_run_evidence_gate_invalid');
  }
  const verifiedAt = requireTimestamp(evidence.verifiedAt, 'case_vortex_full_run_evidence_timestamp_invalid');
  if (verifiedAt > generatedAt) invalid('case_vortex_full_run_evidence_timestamp_invalid');
  const evidencePublication = decodePublication(evidence.publication);
  if (!samePublication(evidencePublication, publication)) invalid('case_vortex_full_run_evidence_publication_mismatch');
  const gate = evidence.gate as CaseVortexFullRunGate;
  const artifactType = requireId(evidence.artifactType, ID,
    'case_vortex_full_run_evidence_identity_invalid');
  const schemaVersion = requireId(evidence.schemaVersion, VERSION,
    'case_vortex_full_run_evidence_identity_invalid');
  const requiredArtifact = CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate];
  if (requiredArtifact && (artifactType !== requiredArtifact.artifactType
    || schemaVersion !== requiredArtifact.schemaVersion
    || evidence.verifierVersion !== requiredArtifact.verifierVersion)) {
    invalid('case_vortex_full_run_evidence_artifact_contract_invalid');
  }
  return {
    gate,
    artifactType,
    schemaVersion,
    artifactSha256: requireSha(evidence.artifactSha256, 'case_vortex_full_run_evidence_sha_invalid'),
    verifierVersion: requireId(evidence.verifierVersion, VERSION, 'case_vortex_full_run_evidence_identity_invalid'),
    verifiedAt,
    publication: evidencePublication,
  };
};

const decodeDeployment = (
  value: unknown,
  publication: CaseVortexFullRunPublication,
  generatedAt: string,
): CaseVortexFullRunReportInput['deployment'] => {
  if (isRecord(value) && value.status === 'not_requested') {
    exact(value, ['status'], 'case_vortex_full_run_deployment_invalid');
    return { status: 'not_requested' };
  }
  const deployment = exact(value, [
    'status', 'approvalReceiptSha256', 'deploymentReceiptSha256', 'liveVerificationSha256',
    'verifiedAt', 'publication',
  ], 'case_vortex_full_run_deployment_invalid');
  if (deployment.status !== 'verified') invalid('case_vortex_full_run_deployment_invalid');
  const verifiedAt = requireTimestamp(deployment.verifiedAt, 'case_vortex_full_run_deployment_invalid');
  if (verifiedAt > generatedAt) invalid('case_vortex_full_run_deployment_invalid');
  const deploymentPublication = decodePublication(deployment.publication);
  if (!samePublication(deploymentPublication, publication)) invalid('case_vortex_full_run_deployment_publication_mismatch');
  return {
    status: 'verified',
    approvalReceiptSha256: requireSha(deployment.approvalReceiptSha256, 'case_vortex_full_run_deployment_invalid'),
    deploymentReceiptSha256: requireSha(deployment.deploymentReceiptSha256, 'case_vortex_full_run_deployment_invalid'),
    liveVerificationSha256: requireSha(deployment.liveVerificationSha256, 'case_vortex_full_run_deployment_invalid'),
    verifiedAt,
    publication: deploymentPublication,
  };
};

const reportWithoutDigest = (report: Omit<CaseVortexFullRunReport, 'reportSha256'>) => report;

export const buildCaseVortexFullRunReport = (input: CaseVortexFullRunReportInput): CaseVortexFullRunReport => {
  const value = exact(input, [
    'recordType', 'schemaVersion', 'runId', 'generatedAt', 'publication', 'evidence', 'deployment',
  ], 'case_vortex_full_run_input_invalid');
  if (value.recordType !== 'case_vortex_full_run_report_input'
    || value.schemaVersion !== CASE_VORTEX_FULL_RUN_REPORT_VERSION
    || !Array.isArray(value.evidence)
    || value.evidence.length > CASE_VORTEX_FULL_RUN_GATES.length) {
    invalid('case_vortex_full_run_input_invalid');
  }
  const generatedAt = requireTimestamp(value.generatedAt, 'case_vortex_full_run_generated_at_invalid');
  const publication = decodePublication(value.publication);
  const evidence = (value.evidence as unknown[])
    .map((item) => decodeEvidence(item, publication, generatedAt))
    .sort((left, right) => left.gate.localeCompare(right.gate));
  if (new Set(evidence.map(({ gate }) => gate)).size !== evidence.length) {
    invalid('case_vortex_full_run_evidence_duplicate');
  }
  if (new Set(evidence.map(({ artifactSha256 }) => artifactSha256)).size !== evidence.length) {
    invalid('case_vortex_full_run_evidence_artifact_reused');
  }
  const byGate = new Map(evidence.map((item) => [item.gate, item]));
  const criteria = CASE_VORTEX_FULL_RUN_GATES.map((gate) => ({
    gate,
    passed: byGate.has(gate),
    artifactSha256: byGate.get(gate)?.artifactSha256 || null,
  }));
  const missingGates = criteria.filter(({ passed }) => !passed).map(({ gate }) => gate);
  const candidateEligible = missingGates.length === 0;
  const deployment = decodeDeployment(value.deployment, publication, generatedAt);
  const objectiveEligible = candidateEligible && deployment.status === 'verified';
  const limitations = [
    'This report binds verifier outputs; each referenced artifact must still be independently retained and reproducible.',
    'A candidate report does not authorize deployment, migration, publication activation or rollback.',
    ...(deployment.status === 'not_requested'
      ? ['Deployment was not requested; production and live-verification evidence are intentionally absent.']
      : []),
    ...(!candidateEligible
      ? [`The candidate is incomplete because ${missingGates.length} required evidence gate${missingGates.length === 1 ? ' is' : 's are'} missing.`]
      : []),
  ];
  const withoutDigest: Omit<CaseVortexFullRunReport, 'reportSha256'> = {
    recordType: 'case_vortex_full_run_report',
    schemaVersion: CASE_VORTEX_FULL_RUN_REPORT_VERSION,
    runId: requireId(value.runId, ID, 'case_vortex_full_run_id_invalid'),
    generatedAt,
    publication,
    evidence,
    criteria,
    missingGates,
    candidateEligible,
    deployment,
    objectiveEligible,
    limitations,
  };
  return { ...withoutDigest, reportSha256: relationshipInputSha256(reportWithoutDigest(withoutDigest)) };
};

export const verifyCaseVortexFullRunReport = (input: unknown): CaseVortexFullRunReport => {
  const value = exact(input, [
    'recordType', 'schemaVersion', 'runId', 'generatedAt', 'publication', 'evidence', 'criteria',
    'missingGates', 'candidateEligible', 'deployment', 'objectiveEligible', 'limitations', 'reportSha256',
  ], 'case_vortex_full_run_report_invalid');
  if (value.recordType !== 'case_vortex_full_run_report'
    || value.schemaVersion !== CASE_VORTEX_FULL_RUN_REPORT_VERSION
    || typeof value.reportSha256 !== 'string') invalid('case_vortex_full_run_report_invalid');
  const rebuilt = buildCaseVortexFullRunReport({
    recordType: 'case_vortex_full_run_report_input',
    schemaVersion: CASE_VORTEX_FULL_RUN_REPORT_VERSION,
    runId: value.runId as string,
    generatedAt: value.generatedAt as string,
    publication: value.publication as CaseVortexFullRunPublication,
    evidence: value.evidence as CaseVortexFullRunEvidence[],
    deployment: value.deployment as CaseVortexFullRunReportInput['deployment'],
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    invalid('case_vortex_full_run_report_derived_fields_invalid');
  }
  if (rebuilt.reportSha256 !== value.reportSha256) invalid('case_vortex_full_run_report_sha_invalid');
  return rebuilt;
};
