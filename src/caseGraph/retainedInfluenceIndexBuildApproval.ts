import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_VERSION =
  'case-vortex-retained-influence-index-approval-v1' as const;
export const CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_SCOPE =
  'build_case_vortex_retained_influence_index_only' as const;
export const CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_STATEMENT =
  'I explicitly approve building only the Case Vortex retained-influence index for the publication and serving bundle in this fresh rehearsal. This does not approve writing R2, publication activation, deployment, or any other database mutation.' as const;
export const CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_MAX_AGE_MS =
  24 * 60 * 60 * 1000;

export type CaseVortexRetainedInfluenceIndexApproval = {
  recordType: 'case_vortex_retained_influence_index_approval';
  schemaVersion: typeof CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_SCOPE;
  rehearsalReceiptSha256: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  bundleSha256: string;
  influenceReceiptSha256: string;
  discoverySignalCount: number;
  metadataLeadCount: number;
  authorizationStatement: typeof CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_STATEMENT;
  indexBuildApproved: true;
  storageWriteApproved: false;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };

const timestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40) {
    return fail('case_vortex_retained_influence_index_approval_timestamp_invalid');
  }
  try {
    if (new Date(value).toISOString() !== value) {
      return fail('case_vortex_retained_influence_index_approval_timestamp_invalid');
    }
  } catch {
    return fail('case_vortex_retained_influence_index_approval_timestamp_invalid');
  }
  return value;
};

const text = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string' || !value.trim()
    || Buffer.byteLength(value, 'utf8') > maximum) return fail(code);
  return value.trim();
};

const count = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(code);
  return Number(value);
};

export const buildCaseVortexRetainedInfluenceIndexApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  rehearsalReceiptSha256: string;
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  bundleSha256: string;
  influenceReceiptSha256: string;
  discoverySignalCount: number;
  metadataLeadCount: number;
  authorizationStatement: string;
  indexBuildApproved: boolean;
  storageWriteApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexRetainedInfluenceIndexApproval => {
  if (!UUID.test(input.approvalId) || !UUID.test(input.publicationId)) {
    fail('case_vortex_retained_influence_index_approval_id_invalid');
  }
  if (!ID.test(input.approvedBy)) {
    fail('case_vortex_retained_influence_index_approval_identity_invalid');
  }
  const approvedAt = timestamp(input.approvedAt);
  if (!SHA256.test(input.rehearsalReceiptSha256)
    || !SHA256.test(input.publicManifestSha256)
    || !SHA256.test(input.bundleSha256)
    || !SHA256.test(input.influenceReceiptSha256)) {
    fail('case_vortex_retained_influence_index_approval_digest_invalid');
  }
  const corpusVersion = text(
    input.corpusVersion,
    120,
    'case_vortex_retained_influence_index_approval_corpus_invalid',
  );
  const discoverySignalCount = count(
    input.discoverySignalCount,
    'case_vortex_retained_influence_index_approval_count_invalid',
  );
  const metadataLeadCount = count(
    input.metadataLeadCount,
    'case_vortex_retained_influence_index_approval_count_invalid',
  );
  if (discoverySignalCount + metadataLeadCount !== 490_933) {
    fail('case_vortex_retained_influence_index_approval_count_invalid');
  }
  if (input.authorizationStatement
      !== CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_STATEMENT
    || input.indexBuildApproved !== true
    || input.storageWriteApproved !== false
    || input.publicationActivationApproved !== false
    || input.deploymentApproved !== false) {
    fail('case_vortex_retained_influence_index_approval_scope_invalid');
  }
  const body: Omit<CaseVortexRetainedInfluenceIndexApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_retained_influence_index_approval',
    schemaVersion: CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    scope: CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_SCOPE,
    rehearsalReceiptSha256: input.rehearsalReceiptSha256,
    publicationId: input.publicationId,
    corpusVersion,
    publicManifestSha256: input.publicManifestSha256,
    bundleSha256: input.bundleSha256,
    influenceReceiptSha256: input.influenceReceiptSha256,
    discoverySignalCount,
    metadataLeadCount,
    authorizationStatement:
      CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_STATEMENT,
    indexBuildApproved: true,
    storageWriteApproved: false,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return { ...body, approvalSha256: relationshipInputSha256(body) };
};

export const verifyCaseVortexRetainedInfluenceIndexApproval = (
  value: unknown,
): CaseVortexRetainedInfluenceIndexApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_retained_influence_index_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'scope', 'rehearsalReceiptSha256', 'publicationId', 'corpusVersion',
    'publicManifestSha256', 'bundleSha256', 'influenceReceiptSha256',
    'discoverySignalCount', 'metadataLeadCount', 'authorizationStatement',
    'indexBuildApproved', 'storageWriteApproved', 'publicationActivationApproved',
    'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
    || candidate.recordType !== 'case_vortex_retained_influence_index_approval'
    || candidate.schemaVersion !== CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_VERSION
    || candidate.scope !== CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_SCOPE
    || typeof candidate.approvalSha256 !== 'string'
    || !SHA256.test(candidate.approvalSha256)) {
    return fail('case_vortex_retained_influence_index_approval_invalid');
  }
  const rebuilt = buildCaseVortexRetainedInfluenceIndexApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    rehearsalReceiptSha256: candidate.rehearsalReceiptSha256 as string,
    publicationId: candidate.publicationId as string,
    corpusVersion: candidate.corpusVersion as string,
    publicManifestSha256: candidate.publicManifestSha256 as string,
    bundleSha256: candidate.bundleSha256 as string,
    influenceReceiptSha256: candidate.influenceReceiptSha256 as string,
    discoverySignalCount: candidate.discoverySignalCount as number,
    metadataLeadCount: candidate.metadataLeadCount as number,
    authorizationStatement: candidate.authorizationStatement as string,
    indexBuildApproved: candidate.indexBuildApproved as boolean,
    storageWriteApproved: candidate.storageWriteApproved as boolean,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    return fail('case_vortex_retained_influence_index_approval_derived_fields_invalid');
  }
  return rebuilt;
};

export const verifyFreshCaseVortexRetainedInfluenceIndexApproval = (
  value: unknown,
  now = new Date(),
) => {
  const approval = verifyCaseVortexRetainedInfluenceIndexApproval(value);
  const age = now.getTime() - new Date(approval.approvedAt).getTime();
  if (age < -5 * 60 * 1000
    || age > CASE_VORTEX_RETAINED_INFLUENCE_INDEX_APPROVAL_MAX_AGE_MS) {
    fail('case_vortex_retained_influence_index_approval_expired');
  }
  return approval;
};
