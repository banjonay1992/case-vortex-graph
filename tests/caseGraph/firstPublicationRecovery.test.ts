import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexFirstPublicationRecoveryApproval,
  buildCaseVortexFirstPublicationRecoveryReceipt,
  buildCaseVortexFirstPublicationRecoveryRehearsal,
  CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
  verifyFreshCaseVortexFirstPublicationRecoveryApproval,
} from '../../src/caseGraph/firstPublicationRecovery';

const now = new Date('2026-08-10T12:00:00.000Z');
const publicationId = '10000000-0000-4000-8000-000000000001';
const digest = (character: string) => character.repeat(64);

const readyRehearsal = () => buildCaseVortexFirstPublicationRecoveryRehearsal({
  observedAt: now.toISOString(),
  publicationId,
  corpusVersion: '2026-08-10-v2',
  publicManifestSha256: digest('a'),
  activePublicationCount: 1,
  totalPublicationCount: 1,
  verifiedV2: true,
  activatedAt: '2026-08-10T11:00:00.000Z',
  deactivatedAt: null,
});

describe('first-publication Case Vortex recovery', () => {
  it('requires the exact sole verified active publication before approval', () => {
    const rehearsal = readyRehearsal();
    expect(rehearsal).toMatchObject({ ready: true, blockers: [] });

    const approval = buildCaseVortexFirstPublicationRecoveryApproval({
      approvalId: '20000000-0000-4000-8000-000000000002',
      approvedBy: 'release.operator',
      approvedAt: now.toISOString(),
      rehearsal,
      reasonSha256: digest('b'),
      authorizationStatement: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
      solePublicationDeactivationApproved: true,
      replacementPublicationApproved: false,
      storageWriteApproved: false,
      deploymentApproved: false,
    });
    expect(verifyFreshCaseVortexFirstPublicationRecoveryApproval(approval, now)).toEqual(approval);

    const blocked = buildCaseVortexFirstPublicationRecoveryRehearsal({
      ...rehearsal,
      totalPublicationCount: 2,
    });
    expect(blocked).toMatchObject({ ready: false, blockers: ['total_publication_count_not_one'] });
    expect(() => buildCaseVortexFirstPublicationRecoveryApproval({
      approvalId: '30000000-0000-4000-8000-000000000003',
      approvedBy: 'release.operator',
      approvedAt: now.toISOString(),
      rehearsal: blocked,
      reasonSha256: digest('b'),
      authorizationStatement: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
      solePublicationDeactivationApproved: true,
      replacementPublicationApproved: false,
      storageWriteApproved: false,
      deploymentApproved: false,
    })).toThrow('case_vortex_first_publication_recovery_approval_rehearsal_blocked');
  });

  it('does not permit scope escalation and binds the recovery receipt to its reason', () => {
    const rehearsal = readyRehearsal();
    expect(() => buildCaseVortexFirstPublicationRecoveryApproval({
      approvalId: '40000000-0000-4000-8000-000000000004',
      approvedBy: 'release.operator',
      approvedAt: now.toISOString(),
      rehearsal,
      reasonSha256: digest('b'),
      authorizationStatement: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
      solePublicationDeactivationApproved: true,
      replacementPublicationApproved: true,
      storageWriteApproved: false,
      deploymentApproved: false,
    })).toThrow('case_vortex_first_publication_recovery_approval_scope_invalid');

    const approval = buildCaseVortexFirstPublicationRecoveryApproval({
      approvalId: '50000000-0000-4000-8000-000000000005',
      approvedBy: 'release.operator',
      approvedAt: now.toISOString(),
      rehearsal,
      reasonSha256: digest('b'),
      authorizationStatement: CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_APPROVAL_STATEMENT,
      solePublicationDeactivationApproved: true,
      replacementPublicationApproved: false,
      storageWriteApproved: false,
      deploymentApproved: false,
    });
    const receipt = buildCaseVortexFirstPublicationRecoveryReceipt({
      receiptId: '60000000-0000-4000-8000-000000000006',
      createdAt: now.toISOString(),
      approval,
      outcome: 'deactivated',
      deactivatedAt: '2026-08-10T12:01:00.000Z',
    });
    expect(receipt).toMatchObject({ publicationId, reasonSha256: digest('b'), outcome: 'deactivated' });
  });
});
