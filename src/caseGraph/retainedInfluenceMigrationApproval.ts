import {
  CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT,
} from '../cli/buildCaseVortexRetainedInfluenceMigrationRehearsal';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_VERSION =
  'case-vortex-retained-influence-migration-approval-v1' as const;
export const CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_SCOPE =
  'apply_case_vortex_migration_0216_only' as const;
export const CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_STATEMENT =
  'I explicitly approve applying only the frozen Case Vortex migration 0216 to the newly rehearsed database state. This does not approve building the retained-influence index, writing R2, publication activation, or deployment.' as const;

export type CaseVortexRetainedInfluenceMigrationApproval = {
  recordType: 'case_vortex_retained_influence_migration_approval';
  schemaVersion: typeof CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_SCOPE;
  rehearsalReceiptSha256: string;
  bundleSha256: string;
  influenceReceiptSha256: string;
  plannedMigrations: string[];
  authorizationStatement: typeof CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_STATEMENT;
  indexBuildApproved: false;
  storageWriteApproved: false;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };
const plan = () => [CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_CONTRACT.fileName];

const timestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40) {
    return fail('case_vortex_retained_influence_migration_approval_timestamp_invalid');
  }
  try {
    if (new Date(value).toISOString() !== value) {
      return fail('case_vortex_retained_influence_migration_approval_timestamp_invalid');
    }
  } catch {
    return fail('case_vortex_retained_influence_migration_approval_timestamp_invalid');
  }
  return value;
};

export const caseVortexRetainedInfluenceMigrationApprovalPlan = plan;

export const buildCaseVortexRetainedInfluenceMigrationApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  rehearsalReceiptSha256: string;
  bundleSha256: string;
  influenceReceiptSha256: string;
  plannedMigrations: string[];
  authorizationStatement: string;
  indexBuildApproved: boolean;
  storageWriteApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexRetainedInfluenceMigrationApproval => {
  if (!UUID.test(input.approvalId)) {
    fail('case_vortex_retained_influence_migration_approval_id_invalid');
  }
  if (!ID.test(input.approvedBy)) {
    fail('case_vortex_retained_influence_migration_approval_identity_invalid');
  }
  const approvedAt = timestamp(input.approvedAt);
  if (!SHA256.test(input.rehearsalReceiptSha256)
    || !SHA256.test(input.bundleSha256)
    || !SHA256.test(input.influenceReceiptSha256)) {
    fail('case_vortex_retained_influence_migration_approval_receipt_invalid');
  }
  const plannedMigrations = plan();
  if (!Array.isArray(input.plannedMigrations)
    || relationshipInputSha256(input.plannedMigrations)
      !== relationshipInputSha256(plannedMigrations)) {
    fail('case_vortex_retained_influence_migration_approval_plan_invalid');
  }
  if (input.authorizationStatement
      !== CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_STATEMENT
    || input.indexBuildApproved !== false
    || input.storageWriteApproved !== false
    || input.publicationActivationApproved !== false
    || input.deploymentApproved !== false) {
    fail('case_vortex_retained_influence_migration_approval_scope_invalid');
  }
  const body: Omit<CaseVortexRetainedInfluenceMigrationApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_retained_influence_migration_approval',
    schemaVersion: CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    scope: CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_SCOPE,
    rehearsalReceiptSha256: input.rehearsalReceiptSha256,
    bundleSha256: input.bundleSha256,
    influenceReceiptSha256: input.influenceReceiptSha256,
    plannedMigrations,
    authorizationStatement: CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_STATEMENT,
    indexBuildApproved: false,
    storageWriteApproved: false,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return { ...body, approvalSha256: relationshipInputSha256(body) };
};

export const verifyCaseVortexRetainedInfluenceMigrationApproval = (
  value: unknown,
): CaseVortexRetainedInfluenceMigrationApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_retained_influence_migration_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'scope', 'rehearsalReceiptSha256', 'bundleSha256',
    'influenceReceiptSha256', 'plannedMigrations', 'authorizationStatement',
    'indexBuildApproved', 'storageWriteApproved', 'publicationActivationApproved',
    'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
    || candidate.recordType !== 'case_vortex_retained_influence_migration_approval'
    || candidate.schemaVersion !== CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_VERSION
    || candidate.scope !== CASE_VORTEX_RETAINED_INFLUENCE_MIGRATION_APPROVAL_SCOPE
    || typeof candidate.approvalSha256 !== 'string'
    || !SHA256.test(candidate.approvalSha256)) {
    return fail('case_vortex_retained_influence_migration_approval_invalid');
  }
  const rebuilt = buildCaseVortexRetainedInfluenceMigrationApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    rehearsalReceiptSha256: candidate.rehearsalReceiptSha256 as string,
    bundleSha256: candidate.bundleSha256 as string,
    influenceReceiptSha256: candidate.influenceReceiptSha256 as string,
    plannedMigrations: candidate.plannedMigrations as string[],
    authorizationStatement: candidate.authorizationStatement as string,
    indexBuildApproved: candidate.indexBuildApproved as boolean,
    storageWriteApproved: candidate.storageWriteApproved as boolean,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    return fail('case_vortex_retained_influence_migration_approval_derived_fields_invalid');
  }
  return rebuilt;
};
