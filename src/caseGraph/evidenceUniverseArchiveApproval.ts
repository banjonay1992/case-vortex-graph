import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_VERSION =
  'evidence-universe-r2-archive-approval-v1' as const;
export const EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_SCOPE =
  'archive_one_immutable_case_vortex_evidence_universe_snapshot_to_r2_only' as const;
export const EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_STATEMENT =
  'I explicitly approve archiving the exact immutable Case Vortex evidence-universe snapshot and corpus version bound in this artifact to R2. This does not approve graph publication, publication activation, or deployment.' as const;

export type EvidenceUniverseArchiveApproval = {
  recordType: 'evidence_universe_r2_archive_approval';
  schemaVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  scope: typeof EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_SCOPE;
  snapshotId: string;
  snapshotIdentitySha256: string;
  corpusVersion: string;
  pageSize: number;
  destinationPrefix: string;
  authorizationStatement: typeof EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_STATEMENT;
  r2ArchiveApproved: true;
  graphPublicationApproved: false;
  publicationActivationApproved: false;
  deploymentApproved: false;
  approvalSha256: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const CORPUS = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const invalid = (code: string): never => { throw new Error(code); };

export const evidenceUniverseArchiveDestinationPrefix = (corpusVersion: string) => (
  `case-vortex/corpora/${corpusVersion}/universe/`
);

export const buildEvidenceUniverseArchiveApproval = (input: {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  snapshotId: string;
  snapshotIdentitySha256: string;
  corpusVersion: string;
  pageSize: number;
  authorizationStatement: string;
  r2ArchiveApproved: boolean;
  graphPublicationApproved: boolean;
  publicationActivationApproved: boolean;
  deploymentApproved: boolean;
}): EvidenceUniverseArchiveApproval => {
  if (!UUID.test(input.approvalId)) invalid('evidence_universe_archive_approval_id_invalid');
  if (!ID.test(input.approvedBy)) invalid('evidence_universe_archive_approval_identity_invalid');
  if (!UUID.test(input.snapshotId)) invalid('evidence_universe_archive_approval_snapshot_id_invalid');
  if (!SHA256.test(input.snapshotIdentitySha256)) {
    invalid('evidence_universe_archive_approval_snapshot_identity_invalid');
  }
  if (!CORPUS.test(input.corpusVersion)) invalid('evidence_universe_archive_approval_corpus_invalid');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 25_000) {
    invalid('evidence_universe_archive_approval_page_size_invalid');
  }
  if (typeof input.approvedAt !== 'string'
    || new Date(input.approvedAt).toISOString() !== input.approvedAt) {
    invalid('evidence_universe_archive_approval_timestamp_invalid');
  }
  if (input.authorizationStatement !== EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_STATEMENT
    || input.r2ArchiveApproved !== true
    || input.graphPublicationApproved !== false
    || input.publicationActivationApproved !== false
    || input.deploymentApproved !== false) {
    invalid('evidence_universe_archive_approval_scope_invalid');
  }
  const withoutDigest: Omit<EvidenceUniverseArchiveApproval, 'approvalSha256'> = {
    recordType: 'evidence_universe_r2_archive_approval',
    schemaVersion: EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_VERSION,
    approvalId: input.approvalId,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    scope: EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_SCOPE,
    snapshotId: input.snapshotId,
    snapshotIdentitySha256: input.snapshotIdentitySha256,
    corpusVersion: input.corpusVersion,
    pageSize: input.pageSize,
    destinationPrefix: evidenceUniverseArchiveDestinationPrefix(input.corpusVersion),
    authorizationStatement: EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_STATEMENT,
    r2ArchiveApproved: true,
    graphPublicationApproved: false,
    publicationActivationApproved: false,
    deploymentApproved: false,
  };
  return { ...withoutDigest, approvalSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyEvidenceUniverseArchiveApproval = (
  value: unknown,
): EvidenceUniverseArchiveApproval => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('evidence_universe_archive_approval_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approvedAt',
    'scope', 'snapshotId', 'snapshotIdentitySha256', 'corpusVersion', 'pageSize', 'destinationPrefix',
    'authorizationStatement', 'r2ArchiveApproved', 'graphPublicationApproved',
    'publicationActivationApproved', 'deploymentApproved', 'approvalSha256',
  ];
  if (Object.keys(candidate).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(candidate, key))
    || candidate.recordType !== 'evidence_universe_r2_archive_approval'
    || candidate.schemaVersion !== EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_VERSION
    || candidate.scope !== EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_SCOPE
    || typeof candidate.approvalSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(candidate.approvalSha256)) {
    invalid('evidence_universe_archive_approval_invalid');
  }
  const rebuilt = buildEvidenceUniverseArchiveApproval({
    approvalId: candidate.approvalId as string,
    approvedBy: candidate.approvedBy as string,
    approvedAt: candidate.approvedAt as string,
    snapshotId: candidate.snapshotId as string,
    snapshotIdentitySha256: candidate.snapshotIdentitySha256 as string,
    corpusVersion: candidate.corpusVersion as string,
    pageSize: candidate.pageSize as number,
    authorizationStatement: candidate.authorizationStatement as string,
    r2ArchiveApproved: candidate.r2ArchiveApproved as boolean,
    graphPublicationApproved: candidate.graphPublicationApproved as boolean,
    publicationActivationApproved: candidate.publicationActivationApproved as boolean,
    deploymentApproved: candidate.deploymentApproved as boolean,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    invalid('evidence_universe_archive_approval_derived_fields_invalid');
  }
  return rebuilt;
};
