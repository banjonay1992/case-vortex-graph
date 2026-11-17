import { CASE_VORTEX_MIGRATION_CONTRACTS } from '../cli/buildCaseVortexRemoteRehearsal';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_MIGRATION_APPROVAL_VERSION =
  'case-vortex-migration-execution-approval-v1' as const;
export const CASE_VORTEX_MIGRATION_APPROVAL_SCOPE =
  'apply_case_vortex_migrations_0202_through_0213_only' as const;
export const CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT =
  'I explicitly approve applying only the frozen Case Vortex migrations 0202 through 0213 to the rehearsed database state. This does not approve publication activation or deployment.' as const;

export type CaseVortexMigrationExecutionApproval = {
  recordType: 'case_vortex_migration_execution_approval';
  schemaVersion: typeof CASE_VORTEX_MIGRATION_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof CASE_VORTEX_MIGRATION_APPROVAL_SCOPE;
  rehearsalReceiptSha256: string;
  plannedMigrations: string[];
  authorizationStatement: typeof CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const invalid = (code: string): never => { throw new Error(code); };

const canonicalTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40) invalid('case_vortex_migration_approval_timestamp_invalid');
  try {
    if (new Date(value as string).toISOString() !== value) invalid('case_vortex_migration_approval_timestamp_invalid');
  } catch {
    invalid('case_vortex_migration_approval_timestamp_invalid');
  }
  return value as string;
};

export const caseVortexMigrationApprovalPlannedMigrations = () => (
  CASE_VORTEX_MIGRATION_CONTRACTS.map(({ fileName }) => fileName)
);

export const buildCaseVortexMigrationExecutionApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  rehearsalReceiptSha256: string;
  plannedMigrations: string[];
  authorizationStatement: string;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): CaseVortexMigrationExecutionApproval => {
  if (!UUID.test(input.approvalId)) invalid('case_vortex_migration_approval_id_invalid');
  if (!ID.test(input.approvedBy)) invalid('case_vortex_migration_approval_identity_invalid');
  const approvedAt = canonicalTimestamp(input.approvedAt);
  if (!SHA256.test(input.rehearsalReceiptSha256)) invalid('case_vortex_migration_approval_receipt_invalid');
  const expectedMigrations = caseVortexMigrationApprovalPlannedMigrations();
  if (!Array.isArray(input.plannedMigrations)
    || relationshipInputSha256(input.plannedMigrations) !== relationshipInputSha256(expectedMigrations)) {
    invalid('case_vortex_migration_approval_plan_invalid');
  }
  if (input.authorizationStatement !== CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT
    || input.publicationActivationApproved !== false || input.deploymentApproved !== false) {
    invalid('case_vortex_migration_approval_scope_invalid');
  }
  const withoutDigest: Omit<CaseVortexMigrationExecutionApproval, 'approvalSha256'> = {
    recordType: 'case_vortex_migration_execution_approval',
    schemaVersion: CASE_VORTEX_MIGRATION_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    scope: CASE_VORTEX_MIGRATION_APPROVAL_SCOPE,
    rehearsalReceiptSha256: input.rehearsalReceiptSha256,
    plannedMigrations: [...expectedMigrations],
    authorizationStatement: CASE_VORTEX_MIGRATION_APPROVAL_STATEMENT,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return { ...withoutDigest, approvalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexMigrationExecutionApproval = (
  value: unknown,
): CaseVortexMigrationExecutionApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('case_vortex_migration_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt', 'scope',
    'rehearsalReceiptSha256', 'plannedMigrations', 'authorizationStatement',
    'publicationActivationApproved', 'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
    || candidate.recordType !== 'case_vortex_migration_execution_approval'
    || candidate.schemaVersion !== CASE_VORTEX_MIGRATION_APPROVAL_VERSION
    || candidate.scope !== CASE_VORTEX_MIGRATION_APPROVAL_SCOPE
    || typeof candidate.approvalSha256 !== 'string' || !SHA256.test(candidate.approvalSha256)) {
    invalid('case_vortex_migration_approval_invalid');
  }
  const rebuilt = buildCaseVortexMigrationExecutionApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    rehearsalReceiptSha256: candidate.rehearsalReceiptSha256 as string,
    plannedMigrations: candidate.plannedMigrations as string[],
    authorizationStatement: candidate.authorizationStatement as string,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    invalid('case_vortex_migration_approval_derived_fields_invalid');
  }
  return rebuilt;
};
