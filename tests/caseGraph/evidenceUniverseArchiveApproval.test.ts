import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_STATEMENT,
  buildEvidenceUniverseArchiveApproval,
  verifyEvidenceUniverseArchiveApproval,
} from '../../src/caseGraph/evidenceUniverseArchiveApproval';

const input = () => ({
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-24T18:10:00.000Z',
  snapshotId: '00000000-0000-4000-8000-000000000724',
  snapshotIdentitySha256: 'a'.repeat(64),
  corpusVersion: '2026-07-24-vortex-v3',
  pageSize: 10_000,
  authorizationStatement: EVIDENCE_UNIVERSE_ARCHIVE_APPROVAL_STATEMENT,
  r2ArchiveApproved: true,
  graphPublicationApproved: false,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

describe('evidence-universe R2 archive approval', () => {
  it('binds one immutable snapshot, corpus and page layout', () => {
    const approval = buildEvidenceUniverseArchiveApproval(input());
    expect(verifyEvidenceUniverseArchiveApproval(approval)).toEqual(approval);
    expect(approval).toMatchObject({
      destinationPrefix: 'case-vortex/corpora/2026-07-24-vortex-v3/universe/',
      r2ArchiveApproved: true,
      graphPublicationApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
  });

  it('rejects broader authority and tampering', () => {
    expect(() => buildEvidenceUniverseArchiveApproval({
      ...input(),
      authorizationStatement: 'archive and publish it',
    })).toThrow('evidence_universe_archive_approval_scope_invalid');
    const approval = buildEvidenceUniverseArchiveApproval(input());
    expect(() => verifyEvidenceUniverseArchiveApproval({
      ...approval,
      corpusVersion: 'different-corpus',
    })).toThrow('evidence_universe_archive_approval_derived_fields_invalid');
  });
});
