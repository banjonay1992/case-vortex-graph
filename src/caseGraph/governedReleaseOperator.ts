import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_GOVERNED_RELEASE_APPROVAL_VERSION =
  'case-vortex-governed-release-approval-v1' as const;
export const CASE_VORTEX_GOVERNED_RELEASE_RECEIPT_VERSION =
  'case-vortex-governed-release-receipt-v1' as const;
export const CASE_VORTEX_GOVERNED_RELEASE_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export const CASE_VORTEX_GOVERNED_RELEASE_STAGES = [
  'upload_request',
  'register_candidate',
  'activate',
  'verify',
] as const;
export type CaseVortexGovernedReleaseStage = typeof CASE_VORTEX_GOVERNED_RELEASE_STAGES[number];

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const KEY = /^case-vortex\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,2047}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;

const fail = (code: string): never => { throw new Error(code); };
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value: unknown, maximum: number, code: string) => {
  const stringValue = typeof value === 'string' ? value : fail(code);
  const normalized = stringValue.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) fail(code);
  return normalized;
};
const digest = (value: unknown, code: string) => {
  const normalized = text(value, 64, code).toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
};
const timestamp = (value: unknown, code: string) => {
  const normalized = text(value, 40, code);
  try {
    if (new Date(normalized).toISOString() !== normalized) fail(code);
  } catch {
    fail(code);
  }
  return normalized;
};
const optionalDigest = (value: unknown, code: string) => value === null ? null : digest(value, code);
const optionalPublicationId = (value: unknown, code: string) => {
  if (value === null) return null;
  const normalized = text(value, 36, code).toLowerCase();
  if (!UUID.test(normalized)) fail(code);
  return normalized;
};

export const caseVortexGovernedReleaseAuthorizationStatement = (
  stage: CaseVortexGovernedReleaseStage,
) => {
  if (stage === 'upload_request') {
    return 'I explicitly approve uploading only the exact immutable Case Vortex typed request bound below. This does not approve candidate registration, publication activation, deployment, or any database mutation.' as const;
  }
  if (stage === 'register_candidate') {
    return 'I explicitly approve registering only the exact inactive Case Vortex publication candidate bound below. This does not approve publication activation, deployment, or any other mutation.' as const;
  }
  if (stage === 'verify') {
    return 'I explicitly approve read-only verification of only the exact active Case Vortex publication bound below. This does not approve any R2 write, publication mutation, deployment, or database mutation.' as const;
  }
  return 'I explicitly approve activating only the exact inactive Case Vortex publication candidate bound below. This does not approve deployment, replacement publication creation, or any other mutation.' as const;
};

type ScopeFlags = {
  immutableRequestUploadApproved: boolean;
  candidateRegistrationApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: false;
};

export type CaseVortexGovernedReleaseApproval = {
  recordType: 'case_vortex_governed_release_approval';
  schemaVersion: typeof CASE_VORTEX_GOVERNED_RELEASE_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  stage: CaseVortexGovernedReleaseStage;
  corpusVersion: string;
  typedRequestKey: string;
  typedRequestSha256: string;
  publicManifestSha256: string | null;
  recordLedgerSha256: string | null;
  publicationId: string | null;
  authorizationStatement: string;
  immutableRequestUploadApproved: boolean;
  candidateRegistrationApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: false;
  approvalSha256: string;
};

export type CaseVortexGovernedReleaseReceipt = {
  recordType: 'case_vortex_governed_release_receipt';
  schemaVersion: typeof CASE_VORTEX_GOVERNED_RELEASE_RECEIPT_VERSION;
  operationId: string;
  createdAt: string;
  stage: CaseVortexGovernedReleaseStage;
  approvalSha256: string;
  corpusVersion: string;
  typedRequestKey: string;
  typedRequestSha256: string;
  publicManifestSha256: string | null;
  recordLedgerSha256: string | null;
  publicationId: string | null;
  resultPublicationId: string | null;
  outcome: 'completed' | 'already_complete';
  receiptSha256: string;
};

const flagsFor = (stage: CaseVortexGovernedReleaseStage): ScopeFlags => ({
  immutableRequestUploadApproved: stage === 'upload_request',
  candidateRegistrationApproved: stage === 'register_candidate',
  publicationActivationApproved: stage === 'activate',
  deploymentApproved: false,
});

const validateStage = (value: unknown): CaseVortexGovernedReleaseStage => {
  if (!CASE_VORTEX_GOVERNED_RELEASE_STAGES.includes(value as CaseVortexGovernedReleaseStage)) {
    fail('case_vortex_governed_release_stage_invalid');
  }
  return value as CaseVortexGovernedReleaseStage;
};

const validateBinding = (input: {
  stage: CaseVortexGovernedReleaseStage;
  corpusVersion: unknown;
  typedRequestKey: unknown;
  typedRequestSha256: unknown;
  publicManifestSha256: unknown;
  recordLedgerSha256: unknown;
  publicationId: unknown;
}) => {
  const corpusVersion = text(input.corpusVersion, 120, 'case_vortex_governed_release_corpus_invalid').toLowerCase();
  if (!VERSION.test(corpusVersion)) fail('case_vortex_governed_release_corpus_invalid');
  const typedRequestKey = text(input.typedRequestKey, 2_048, 'case_vortex_governed_release_request_key_invalid');
  if (!KEY.test(typedRequestKey) || /(?:^|\/)\.\.(?:\/|$)/u.test(typedRequestKey)) {
    fail('case_vortex_governed_release_request_key_invalid');
  }
  const typedRequestSha256 = digest(input.typedRequestSha256, 'case_vortex_governed_release_request_sha_invalid');
  const publicManifestSha256 = optionalDigest(
    input.publicManifestSha256,
    'case_vortex_governed_release_manifest_sha_invalid',
  );
  const recordLedgerSha256 = optionalDigest(
    input.recordLedgerSha256,
    'case_vortex_governed_release_ledger_sha_invalid',
  );
  const publicationId = optionalPublicationId(
    input.publicationId,
    'case_vortex_governed_release_publication_id_invalid',
  );
  if (input.stage === 'upload_request'
    && (publicManifestSha256 !== null || recordLedgerSha256 !== null || publicationId !== null)) {
    fail('case_vortex_governed_release_stage_binding_invalid');
  }
  if (input.stage === 'register_candidate'
    && (publicManifestSha256 === null || recordLedgerSha256 === null || publicationId !== null)) {
    fail('case_vortex_governed_release_stage_binding_invalid');
  }
  if ((input.stage === 'activate' || input.stage === 'verify')
    && (publicManifestSha256 === null || publicationId === null || recordLedgerSha256 !== null)) {
    fail('case_vortex_governed_release_stage_binding_invalid');
  }
  return {
    corpusVersion,
    typedRequestKey,
    typedRequestSha256,
    publicManifestSha256,
    recordLedgerSha256,
    publicationId,
  };
};

export const buildCaseVortexGovernedReleaseApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  stage: CaseVortexGovernedReleaseStage;
  corpusVersion: string;
  typedRequestKey: string;
  typedRequestSha256: string;
  publicManifestSha256: string | null;
  recordLedgerSha256: string | null;
  publicationId: string | null;
  authorizationStatement: string;
  immutableRequestUploadApproved: boolean;
  candidateRegistrationApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexGovernedReleaseApproval => {
  const stage = validateStage(input.stage);
  const approvalId = optionalPublicationId(input.approvalId, 'case_vortex_governed_release_approval_id_invalid')
    || fail('case_vortex_governed_release_approval_id_invalid');
  const approvedBy = text(input.approvedBy, 240, 'case_vortex_governed_release_identity_invalid');
  if (!ID.test(approvedBy)) fail('case_vortex_governed_release_identity_invalid');
  const binding = validateBinding({ ...input, stage });
  const expectedFlags = flagsFor(stage);
  if (input.authorizationStatement !== caseVortexGovernedReleaseAuthorizationStatement(stage)
    || input.immutableRequestUploadApproved !== expectedFlags.immutableRequestUploadApproved
    || input.candidateRegistrationApproved !== expectedFlags.candidateRegistrationApproved
    || input.publicationActivationApproved !== expectedFlags.publicationActivationApproved
    || input.deploymentApproved !== false) {
    fail('case_vortex_governed_release_approval_scope_invalid');
  }
  const withoutDigest: Omit<CaseVortexGovernedReleaseApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_governed_release_approval',
    schemaVersion: CASE_VORTEX_GOVERNED_RELEASE_APPROVAL_VERSION,
    approvalId,
    approvedBy,
    approvedAt: timestamp(input.approvedAt, 'case_vortex_governed_release_approval_timestamp_invalid'),
    stage,
    ...binding,
    authorizationStatement: caseVortexGovernedReleaseAuthorizationStatement(stage),
    ...expectedFlags,
  };
  return { ...withoutDigest, approvalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexGovernedReleaseApproval = (
  value: unknown,
): CaseVortexGovernedReleaseApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('case_vortex_governed_release_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt', 'stage',
    'corpusVersion', 'typedRequestKey', 'typedRequestSha256', 'publicManifestSha256',
    'recordLedgerSha256', 'publicationId', 'authorizationStatement',
    'immutableRequestUploadApproved', 'candidateRegistrationApproved',
    'publicationActivationApproved', 'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== keys.length || keys.some((key) => !hasOwn(candidate, key))
    || candidate.recordType !== 'case_vortex_governed_release_approval'
    || candidate.schemaVersion !== CASE_VORTEX_GOVERNED_RELEASE_APPROVAL_VERSION
    || typeof candidate.approvalSha256 !== 'string' || !SHA256.test(candidate.approvalSha256)) {
    fail('case_vortex_governed_release_approval_invalid');
  }
  const rebuilt = buildCaseVortexGovernedReleaseApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    stage: candidate.stage as CaseVortexGovernedReleaseStage,
    corpusVersion: candidate.corpusVersion as string,
    typedRequestKey: candidate.typedRequestKey as string,
    typedRequestSha256: candidate.typedRequestSha256 as string,
    publicManifestSha256: candidate.publicManifestSha256 as string | null,
    recordLedgerSha256: candidate.recordLedgerSha256 as string | null,
    publicationId: candidate.publicationId as string | null,
    authorizationStatement: candidate.authorizationStatement as string,
    immutableRequestUploadApproved: candidate.immutableRequestUploadApproved as boolean,
    candidateRegistrationApproved: candidate.candidateRegistrationApproved as boolean,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    fail('case_vortex_governed_release_approval_derived_fields_invalid');
  }
  return rebuilt;
};

export const verifyFreshCaseVortexGovernedReleaseApproval = (
  value: unknown,
  now = new Date(),
) => {
  const approval = verifyCaseVortexGovernedReleaseApproval(value);
  const ageMs = now.getTime() - new Date(approval.approvedAt).getTime();
  if (ageMs < -5 * 60 * 1_000 || ageMs > CASE_VORTEX_GOVERNED_RELEASE_APPROVAL_MAX_AGE_MS) {
    fail('case_vortex_governed_release_approval_expired');
  }
  return approval;
};

export const assertCaseVortexGovernedReleaseApproval = (params: {
  approval: CaseVortexGovernedReleaseApproval;
  stage: CaseVortexGovernedReleaseStage;
  corpusVersion: string;
  typedRequestKey: string;
  typedRequestSha256: string;
  publicManifestSha256: string | null;
  recordLedgerSha256: string | null;
  publicationId: string | null;
}) => {
  const binding = validateBinding({ ...params, stage: params.stage });
  if (params.approval.stage !== params.stage
    || params.approval.corpusVersion !== binding.corpusVersion
    || params.approval.typedRequestKey !== binding.typedRequestKey
    || params.approval.typedRequestSha256 !== binding.typedRequestSha256
    || params.approval.publicManifestSha256 !== binding.publicManifestSha256
    || params.approval.recordLedgerSha256 !== binding.recordLedgerSha256
    || params.approval.publicationId !== binding.publicationId) {
    fail('case_vortex_governed_release_approval_binding_mismatch');
  }
  return params.approval;
};

export const buildCaseVortexGovernedReleaseReceipt = (input: {
  operationId: string;
  createdAt: string;
  stage: CaseVortexGovernedReleaseStage;
  approvalSha256: string;
  corpusVersion: string;
  typedRequestKey: string;
  typedRequestSha256: string;
  publicManifestSha256: string | null;
  recordLedgerSha256: string | null;
  publicationId: string | null;
  resultPublicationId: string | null;
  outcome: 'completed' | 'already_complete';
}): CaseVortexGovernedReleaseReceipt => {
  const stage = validateStage(input.stage);
  const operationId = optionalPublicationId(input.operationId, 'case_vortex_governed_release_receipt_operation_id_invalid')
    || fail('case_vortex_governed_release_receipt_operation_id_invalid');
  const binding = validateBinding({ ...input, stage });
  const resultPublicationId = optionalPublicationId(
    input.resultPublicationId,
    'case_vortex_governed_release_receipt_result_publication_invalid',
  );
  if ((stage === 'upload_request' && resultPublicationId !== null)
    || (stage === 'register_candidate' && resultPublicationId === null)
    || ((stage === 'activate' || stage === 'verify') && resultPublicationId !== binding.publicationId)) {
    fail('case_vortex_governed_release_receipt_result_publication_invalid');
  }
  if (!['completed', 'already_complete'].includes(input.outcome)) {
    fail('case_vortex_governed_release_receipt_outcome_invalid');
  }
  const withoutDigest: Omit<CaseVortexGovernedReleaseReceipt, 'receiptSha256'> = {
    recordType: 'case_vortex_governed_release_receipt',
    schemaVersion: CASE_VORTEX_GOVERNED_RELEASE_RECEIPT_VERSION,
    operationId,
    createdAt: timestamp(input.createdAt, 'case_vortex_governed_release_receipt_timestamp_invalid'),
    stage,
    approvalSha256: digest(input.approvalSha256, 'case_vortex_governed_release_receipt_approval_invalid'),
    ...binding,
    resultPublicationId,
    outcome: input.outcome,
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};
