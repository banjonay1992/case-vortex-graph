import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_VERSION =
  'evidence-universe-snapshot-capture-approval-v1' as const;
export const EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_SCOPE =
  'capture_one_immutable_case_vortex_evidence_universe_snapshot_only' as const;
export const EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT =
  'I explicitly approve capturing one immutable Case Vortex evidence-universe snapshot using the exact snapshot UUID and source-census receipt bound in the approval artifact. This does not approve publication activation or deployment.' as const;

export type EvidenceUniverseSnapshotCaptureApproval = {
  recordType: 'evidence_universe_snapshot_capture_approval';
  schemaVersion: typeof EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_SCOPE;
  snapshotId: string;
  censusReceiptSha256: string;
  censusInspectedAt: string;
  authorizationStatement: typeof EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT;
  snapshotCaptureApproved: true;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const invalid = (code: string): never => { throw new Error(code); };

const canonicalTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40) invalid(code);
  try {
    if (new Date(value as string).toISOString() !== value) invalid(code);
  } catch {
    invalid(code);
  }
  return value as string;
};

const canonicalSourceTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/u.test(value)
    || !Number.isFinite(new Date(value).getTime())) {
    invalid('evidence_universe_snapshot_approval_census_time_invalid');
  }
  return value as string;
};

export const buildEvidenceUniverseSnapshotCaptureApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  snapshotId: string;
  censusReceiptSha256: string;
  censusInspectedAt: string;
  authorizationStatement: string;
  snapshotCaptureApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): EvidenceUniverseSnapshotCaptureApproval => {
  if (!UUID.test(input.approvalId)) invalid('evidence_universe_snapshot_approval_id_invalid');
  if (!ID.test(input.approvedBy)) invalid('evidence_universe_snapshot_approval_identity_invalid');
  if (!UUID.test(input.snapshotId)) invalid('evidence_universe_snapshot_approval_snapshot_id_invalid');
  if (!SHA256.test(input.censusReceiptSha256)) {
    invalid('evidence_universe_snapshot_approval_census_receipt_invalid');
  }
  const approvedAt = canonicalTimestamp(
    input.approvedAt,
    'evidence_universe_snapshot_approval_timestamp_invalid',
  );
  const censusInspectedAt = canonicalSourceTimestamp(input.censusInspectedAt);
  if (input.authorizationStatement !== EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT
    || input.snapshotCaptureApproved !== true
    || input.publicationActivationApproved !== false
    || input.deploymentApproved !== false) {
    invalid('evidence_universe_snapshot_approval_scope_invalid');
  }
  const withoutDigest: Omit<EvidenceUniverseSnapshotCaptureApproval, 'approvalSha256'> = {
    recordType: 'evidence_universe_snapshot_capture_approval',
    schemaVersion: EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt,
    scope: EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_SCOPE,
    snapshotId: input.snapshotId,
    censusReceiptSha256: input.censusReceiptSha256,
    censusInspectedAt,
    authorizationStatement: EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT,
    snapshotCaptureApproved: true,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return {
    ...withoutDigest,
    approvalSha256: relationshipInputSha256(withoutDigest),
  };
};

export const verifyEvidenceUniverseSnapshotCaptureApproval = (
  value: unknown,
): EvidenceUniverseSnapshotCaptureApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('evidence_universe_snapshot_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'scope', 'snapshotId', 'censusReceiptSha256', 'censusInspectedAt',
    'authorizationStatement', 'snapshotCaptureApproved',
    'publicationActivationApproved', 'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(candidate, key))
    || candidate.recordType !== 'evidence_universe_snapshot_capture_approval'
    || candidate.schemaVersion !== EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_VERSION
    || candidate.scope !== EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_SCOPE
    || typeof candidate.approvalSha256 !== 'string'
    || !SHA256.test(candidate.approvalSha256)) {
    invalid('evidence_universe_snapshot_approval_invalid');
  }
  const rebuilt = buildEvidenceUniverseSnapshotCaptureApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    snapshotId: candidate.snapshotId as string,
    censusReceiptSha256: candidate.censusReceiptSha256 as string,
    censusInspectedAt: candidate.censusInspectedAt as string,
    authorizationStatement: candidate.authorizationStatement as string,
    snapshotCaptureApproved: candidate.snapshotCaptureApproved as boolean,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    invalid('evidence_universe_snapshot_approval_derived_fields_invalid');
  }
  return rebuilt;
};
