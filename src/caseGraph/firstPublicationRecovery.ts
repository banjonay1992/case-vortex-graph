import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION =
  'case-vortex-first-publication-recovery-v1' as const;
export const CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_MAX_AGE_MS = 60 * 60 * 1_000;
export const CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT =
  'I explicitly approve fail-closed deactivation of only the exact sole first Case Vortex publication bound below. This does not approve a replacement publication, deployment, R2 mutation, or any other database mutation.' as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const text = (value: unknown, maximum: number, code: string) => {
  const stringValue = typeof value === 'string' ? value : fail(code);
  const normalized = stringValue.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) fail(code);
  return normalized;
};
const exactTime = (value: unknown, code: string) => {
  const normalized = text(value, 40, code);
  try {
    if (new Date(normalized).toISOString() !== normalized) fail(code);
  } catch {
    fail(code);
  }
  return normalized;
};
const digest = (value: unknown, code: string) => {
  const normalized = text(value, 64, code).toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
};
const publicationId = (value: unknown, code: string) => {
  const normalized = text(value, 36, code).toLowerCase();
  if (!UUID.test(normalized)) fail(code);
  return normalized;
};
const corpusVersion = (value: unknown, code: string) => {
  const normalized = text(value, 120, code).toLowerCase();
  if (!VERSION.test(normalized)) fail(code);
  return normalized;
};

export type CaseVortexFirstPublicationRecoveryRehearsal = {
  recordType: 'case_vortex_first_publication_recovery_rehearsal';
  schemaVersion: typeof CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION;
  observedAt: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  activePublicationCount: number;
  totalPublicationCount: number;
  verifiedV2: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
  ready: boolean;
  blockers: string[];
  rehearsalSha256: string;
};

export type CaseVortexFirstPublicationRecoveryApproval = {
  recordType: 'case_vortex_first_publication_recovery_approval';
  schemaVersion: typeof CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  rehearsalSha256: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  reasonSha256: string;
  authorizationStatement: typeof CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT;
  solePublicationDeactivationApproved: true;
  replacementPublicationApproved: false;
  storageWriteApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

export type CaseVortexFirstPublicationRecoveryReceipt = {
  recordType: 'case_vortex_first_publication_recovery_receipt';
  schemaVersion: typeof CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION;
  receiptId: string;
  createdAt: string;
  approvalSha256: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  reasonSha256: string;
  outcome: 'deactivated' | 'reconciled';
  deactivatedAt: string | null;
  receiptSha256: string;
};

export const buildCaseVortexFirstPublicationRecoveryRehearsal = (input: {
  observedAt: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  activePublicationCount: number;
  totalPublicationCount: number;
  verifiedV2: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
}): CaseVortexFirstPublicationRecoveryRehearsal => {
  if (!Number.isSafeInteger(input.activePublicationCount) || input.activePublicationCount < 0
    || !Number.isSafeInteger(input.totalPublicationCount) || input.totalPublicationCount < 0
    || typeof input.verifiedV2 !== 'boolean') {
    fail('case_vortex_first_publication_recovery_rehearsal_count_invalid');
  }
  const activatedAt = input.activatedAt === null ? null
    : exactTime(input.activatedAt, 'case_vortex_first_publication_recovery_rehearsal_timestamp_invalid');
  const deactivatedAt = input.deactivatedAt === null ? null
    : exactTime(input.deactivatedAt, 'case_vortex_first_publication_recovery_rehearsal_timestamp_invalid');
  const blockers: string[] = [];
  if (input.activePublicationCount !== 1) blockers.push('active_publication_count_not_one');
  if (input.totalPublicationCount !== 1) blockers.push('total_publication_count_not_one');
  if (!input.verifiedV2) blockers.push('publication_not_verified_v2');
  if (activatedAt === null) blockers.push('publication_not_activated');
  if (deactivatedAt !== null) blockers.push('publication_previously_deactivated');
  const withoutDigest: Omit<CaseVortexFirstPublicationRecoveryRehearsal, 'rehearsalSha256'> = {
    recordType: 'case_vortex_first_publication_recovery_rehearsal',
    schemaVersion: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION,
    observedAt: exactTime(input.observedAt, 'case_vortex_first_publication_recovery_rehearsal_timestamp_invalid'),
    publicationId: publicationId(input.publicationId, 'case_vortex_first_publication_recovery_rehearsal_publication_invalid'),
    corpusVersion: corpusVersion(input.corpusVersion, 'case_vortex_first_publication_recovery_rehearsal_corpus_invalid'),
    publicManifestSha256: digest(input.publicManifestSha256, 'case_vortex_first_publication_recovery_rehearsal_manifest_invalid'),
    activePublicationCount: input.activePublicationCount,
    totalPublicationCount: input.totalPublicationCount,
    verifiedV2: input.verifiedV2,
    activatedAt,
    deactivatedAt,
    ready: blockers.length === 0,
    blockers,
  };
  return { ...withoutDigest, rehearsalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexFirstPublicationRecoveryRehearsal = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('case_vortex_first_publication_recovery_rehearsal_invalid');
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'observedAt', 'publicationId', 'corpusVersion',
    'publicManifestSha256', 'activePublicationCount', 'totalPublicationCount', 'verifiedV2',
    'activatedAt', 'deactivatedAt', 'ready', 'blockers', 'rehearsalSha256',
  ];
  if (Object.keys(candidate).length !== keys.length || keys.some((key) => !hasOwn(candidate, key))
    || candidate.recordType !== 'case_vortex_first_publication_recovery_rehearsal'
    || candidate.schemaVersion !== CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION
    || !Array.isArray(candidate.blockers) || candidate.blockers.some((item) => typeof item !== 'string')
    || typeof candidate.ready !== 'boolean' || typeof candidate.rehearsalSha256 !== 'string'
    || !SHA256.test(candidate.rehearsalSha256)) {
    fail('case_vortex_first_publication_recovery_rehearsal_invalid');
  }
  const rebuilt = buildCaseVortexFirstPublicationRecoveryRehearsal({
    observedAt: candidate.observedAt as string,
    publicationId: candidate.publicationId as string,
    corpusVersion: candidate.corpusVersion as string,
    publicManifestSha256: candidate.publicManifestSha256 as string,
    activePublicationCount: candidate.activePublicationCount as number,
    totalPublicationCount: candidate.totalPublicationCount as number,
    verifiedV2: candidate.verifiedV2 as boolean,
    activatedAt: candidate.activatedAt as string | null,
    deactivatedAt: candidate.deactivatedAt as string | null,
  });
  if (candidate.ready !== rebuilt.ready
    || JSON.stringify(candidate.blockers) !== JSON.stringify(rebuilt.blockers)
    || relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    fail('case_vortex_first_publication_recovery_rehearsal_derived_fields_invalid');
  }
  return rebuilt;
};

export const buildCaseVortexFirstPublicationRecoveryApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  rehearsal: CaseVortexFirstPublicationRecoveryRehearsal;
  reasonSha256: string;
  authorizationStatement: string;
  solePublicationDeactivationApproved: boolean;
  replacementPublicationApproved: boolean;
  storageWriteApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexFirstPublicationRecoveryApproval => {
  const rehearsal = verifyCaseVortexFirstPublicationRecoveryRehearsal(input.rehearsal);
  if (!rehearsal.ready) fail('case_vortex_first_publication_recovery_approval_rehearsal_blocked');
  const approvedBy = text(input.approvedBy, 240, 'case_vortex_first_publication_recovery_approval_identity_invalid');
  if (!ID.test(approvedBy)) fail('case_vortex_first_publication_recovery_approval_identity_invalid');
  if (input.authorizationStatement !== CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT
    || input.solePublicationDeactivationApproved !== true
    || input.replacementPublicationApproved !== false
    || input.storageWriteApproved !== false
    || input.deploymentApproved !== false) {
    fail('case_vortex_first_publication_recovery_approval_scope_invalid');
  }
  const withoutDigest: Omit<CaseVortexFirstPublicationRecoveryApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_first_publication_recovery_approval',
    schemaVersion: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION,
    approvalId: publicationId(input.approvalId, 'case_vortex_first_publication_recovery_approval_id_invalid'),
    approvedBy,
    approvedAt: exactTime(input.approvedAt, 'case_vortex_first_publication_recovery_approval_timestamp_invalid'),
    rehearsalSha256: rehearsal.rehearsalSha256,
    publicationId: rehearsal.publicationId,
    corpusVersion: rehearsal.corpusVersion,
    publicManifestSha256: rehearsal.publicManifestSha256,
    reasonSha256: digest(input.reasonSha256, 'case_vortex_first_publication_recovery_approval_reason_invalid'),
    authorizationStatement: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
    solePublicationDeactivationApproved: true,
    replacementPublicationApproved: false,
    storageWriteApproved: false,
    deploymentApproved: false,
  };
  return { ...withoutDigest, approvalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyFreshCaseVortexFirstPublicationRecoveryApproval = (value: unknown, now = new Date()) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('case_vortex_first_publication_recovery_approval_invalid');
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt', 'rehearsalSha256',
    'publicationId', 'corpusVersion', 'publicManifestSha256', 'reasonSha256',
    'authorizationStatement', 'solePublicationDeactivationApproved',
    'replacementPublicationApproved', 'storageWriteApproved', 'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== keys.length || keys.some((key) => !hasOwn(candidate, key))
    || candidate.recordType !== 'case_vortex_first_publication_recovery_approval'
    || candidate.schemaVersion !== CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION
    || typeof candidate.approvalSha256 !== 'string' || !SHA256.test(candidate.approvalSha256)) {
    fail('case_vortex_first_publication_recovery_approval_invalid');
  }
  const approvedBy = text(candidate.approvedBy, 240, 'case_vortex_first_publication_recovery_approval_identity_invalid');
  if (!ID.test(approvedBy)
    || candidate.authorizationStatement !== CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT
    || candidate.solePublicationDeactivationApproved !== true
    || candidate.replacementPublicationApproved !== false
    || candidate.storageWriteApproved !== false
    || candidate.deploymentApproved !== false) {
    fail('case_vortex_first_publication_recovery_approval_scope_invalid');
  }
  const rebuilt: CaseVortexFirstPublicationRecoveryApproval = {
    recordType: 'case_vortex_first_publication_recovery_approval',
    schemaVersion: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION,
    approvalId: publicationId(candidate.approvalId, 'case_vortex_first_publication_recovery_approval_id_invalid'),
    approvedBy,
    approvedAt: exactTime(candidate.approvedAt, 'case_vortex_first_publication_recovery_approval_timestamp_invalid'),
    rehearsalSha256: digest(candidate.rehearsalSha256, 'case_vortex_first_publication_recovery_approval_rehearsal_invalid'),
    publicationId: publicationId(candidate.publicationId, 'case_vortex_first_publication_recovery_approval_publication_invalid'),
    corpusVersion: corpusVersion(candidate.corpusVersion, 'case_vortex_first_publication_recovery_approval_corpus_invalid'),
    publicManifestSha256: digest(candidate.publicManifestSha256, 'case_vortex_first_publication_recovery_approval_manifest_invalid'),
    reasonSha256: digest(candidate.reasonSha256, 'case_vortex_first_publication_recovery_approval_reason_invalid'),
    authorizationStatement: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
    solePublicationDeactivationApproved: true,
    replacementPublicationApproved: false,
    storageWriteApproved: false,
    deploymentApproved: false,
    approvalSha256: String(candidate.approvalSha256),
  };
  const { approvalSha256: suppliedApprovalSha256, ...withoutDigest } = rebuilt;
  const expectedSha256 = relationshipInputSha256(withoutDigest);
  if (suppliedApprovalSha256 !== expectedSha256) {
    fail('case_vortex_first_publication_recovery_approval_derived_fields_invalid');
  }
  const ageMs = now.getTime() - new Date(rebuilt.approvedAt).getTime();
  if (ageMs < -5 * 60 * 1_000 || ageMs > CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_MAX_AGE_MS) {
    fail('case_vortex_first_publication_recovery_approval_expired');
  }
  return rebuilt;
};

export const buildCaseVortexFirstPublicationRecoveryReceipt = (input: {
  receiptId: string;
  createdAt: string;
  approval: CaseVortexFirstPublicationRecoveryApproval;
  outcome: 'deactivated' | 'reconciled';
  deactivatedAt: string | null;
}): CaseVortexFirstPublicationRecoveryReceipt => {
  if (!['deactivated', 'reconciled'].includes(input.outcome)) {
    fail('case_vortex_first_publication_recovery_receipt_outcome_invalid');
  }
  const approval = verifyFreshCaseVortexFirstPublicationRecoveryApproval(input.approval, new Date(input.approval.approvedAt));
  const withoutDigest: Omit<CaseVortexFirstPublicationRecoveryReceipt, 'receiptSha256'> = {
    recordType: 'case_vortex_first_publication_recovery_receipt',
    schemaVersion: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_VERSION,
    receiptId: publicationId(input.receiptId, 'case_vortex_first_publication_recovery_receipt_id_invalid'),
    createdAt: exactTime(input.createdAt, 'case_vortex_first_publication_recovery_receipt_timestamp_invalid'),
    approvalSha256: approval.approvalSha256,
    publicationId: approval.publicationId,
    corpusVersion: approval.corpusVersion,
    publicManifestSha256: approval.publicManifestSha256,
    reasonSha256: approval.reasonSha256,
    outcome: input.outcome,
    deactivatedAt: input.deactivatedAt === null ? null
      : exactTime(input.deactivatedAt, 'case_vortex_first_publication_recovery_receipt_timestamp_invalid'),
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};
