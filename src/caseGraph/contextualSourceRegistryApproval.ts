import {
  contextualSourceRegistryProposalApprovalStatement,
  verifyContextualSourceRegistryProposal,
} from './contextualSourceRegistryProposal';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_VERSION =
  'case-vortex-contextual-source-registry-approval-v1' as const;
export const CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_SCOPE =
  'approve_exact_missing_adsb_lol_and_noaa_ncei_us_observations_derived_only_rows' as const;

export type ContextualSourceRegistryApproval = {
  recordType: 'contextual_source_registry_approval';
  schemaVersion: typeof CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_SCOPE;
  proposalDigest: string;
  decisionPacketDigest: string;
  authorizationStatement: string;
  registryChangeApproved: true;
  providerCallsApproved: false;
  archivalWritesApproved: false;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const invalid = (code: string): never => { throw new Error(code); };

const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || value.length > 40) invalid(code);
  const normalized = value as string;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) invalid(code);
  return normalized;
};

const exactObject = (
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) invalid(code);
  return object;
};

export const buildContextualSourceRegistryApproval = (params: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  proposal: unknown;
  decisionPacket: unknown;
  authorizationStatement: string;
  registryChangeApproved: boolean;
  providerCallsApproved: boolean;
  archivalWritesApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): ContextualSourceRegistryApproval => {
  if (!UUID.test(params.approvalId)) invalid('contextual_source_registry_approval_id_invalid');
  if (!IDENTITY.test(params.approvedBy)) {
    invalid('contextual_source_registry_approval_identity_invalid');
  }
  const approvedAt = timestamp(
    params.approvedAt,
    'contextual_source_registry_approval_time_invalid',
  );
  const proposal = verifyContextualSourceRegistryProposal(
    params.proposal,
    params.decisionPacket,
  );
  const exactStatement = contextualSourceRegistryProposalApprovalStatement(
    proposal.proposalDigest,
  );
  if (params.authorizationStatement !== exactStatement
    || params.registryChangeApproved !== true
    || params.providerCallsApproved !== false
    || params.archivalWritesApproved !== false
    || params.publicationActivationApproved !== false
    || params.deploymentApproved !== false) {
    invalid('contextual_source_registry_approval_scope_invalid');
  }
  const withoutDigest: Omit<ContextualSourceRegistryApproval, 'approvalDigest'> = {
    recordType: 'contextual_source_registry_approval',
    schemaVersion: CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_VERSION,
    approvalId: params.approvalId,
    approvedBy: params.approvedBy,
    approvedAt,
    scope: CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_SCOPE,
    proposalDigest: proposal.proposalDigest,
    decisionPacketDigest: proposal.boundDecisionPacket.packetDigest,
    authorizationStatement: exactStatement,
    registryChangeApproved: true,
    providerCallsApproved: false,
    archivalWritesApproved: false,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return {
    ...withoutDigest,
    approvalDigest: relationshipInputSha256(withoutDigest),
  };
};

export const verifyContextualSourceRegistryApproval = (
  value: unknown,
  proposalValue: unknown,
  decisionPacket: unknown,
): ContextualSourceRegistryApproval => {
  const approval = exactObject(value, [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'scope', 'proposalDigest', 'decisionPacketDigest', 'authorizationStatement',
    'registryChangeApproved', 'providerCallsApproved', 'archivalWritesApproved',
    'publicationActivationApproved', 'deploymentApproved', 'approvalDigest',
  ], 'contextual_source_registry_approval_invalid');
  if (approval.recordType !== 'contextual_source_registry_approval'
    || approval.schemaVersion !== CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_VERSION
    || approval.scope !== CONTEXTUAL_SOURCE_REGISTRY_APPROVAL_SCOPE
    || typeof approval.approvalDigest !== 'string'
    || !SHA256.test(approval.approvalDigest)) {
    invalid('contextual_source_registry_approval_invalid');
  }
  const rebuilt = buildContextualSourceRegistryApproval({
    approvalId: approval.approvalId as string,
    approvedBy: approval.approvedBy as string,
    approvedAt: approval.approvedAt as string,
    proposal: proposalValue,
    decisionPacket,
    authorizationStatement: approval.authorizationStatement as string,
    registryChangeApproved: approval.registryChangeApproved as boolean,
    providerCallsApproved: approval.providerCallsApproved as boolean,
    archivalWritesApproved: approval.archivalWritesApproved as boolean,
    publicationActivationApproved: approval.publicationActivationApproved as boolean,
    deploymentApproved: approval.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(approval) !== relationshipInputSha256(rebuilt)) {
    invalid('contextual_source_registry_approval_drift');
  }
  return rebuilt;
};
