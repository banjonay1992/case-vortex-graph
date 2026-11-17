import { describe, expect, it } from 'vitest';

import {
  assertCaseVortexGovernedReleaseApproval,
  buildCaseVortexGovernedReleaseApproval,
  buildCaseVortexGovernedReleaseReceipt,
  caseVortexGovernedReleaseAuthorizationStatement,
  verifyFreshCaseVortexGovernedReleaseApproval,
} from '../../src/caseGraph/governedReleaseOperator';

const now = new Date('2026-08-10T12:00:00.000Z');
const approvalId = '10000000-0000-4000-8000-000000000001';
const publicationId = '20000000-0000-4000-8000-000000000002';
const digest = (character: string) => character.repeat(64);

const registrationApproval = () => buildCaseVortexGovernedReleaseApproval({
  approvalId,
  approvedBy: 'release.operator',
  approvedAt: now.toISOString(),
  stage: 'register_candidate',
  corpusVersion: '2026-08-10-v2',
  typedRequestKey: `case-vortex/requests/${digest('a')}.json`,
  typedRequestSha256: digest('a'),
  publicManifestSha256: digest('b'),
  recordLedgerSha256: digest('c'),
  publicationId: null,
  authorizationStatement: caseVortexGovernedReleaseAuthorizationStatement('register_candidate'),
  immutableRequestUploadApproved: false,
  candidateRegistrationApproved: true,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

describe('Case Vortex governed release approvals', () => {
  it('binds candidate registration to one immutable request, manifest, and ledger', () => {
    const approval = registrationApproval();

    expect(verifyFreshCaseVortexGovernedReleaseApproval(approval, now)).toEqual(approval);
    expect(() => assertCaseVortexGovernedReleaseApproval({
      approval,
      stage: 'register_candidate',
      corpusVersion: approval.corpusVersion,
      typedRequestKey: approval.typedRequestKey,
      typedRequestSha256: approval.typedRequestSha256,
      publicManifestSha256: approval.publicManifestSha256,
      recordLedgerSha256: digest('d'),
      publicationId: null,
    })).toThrow('case_vortex_governed_release_approval_binding_mismatch');
  });

  it('rejects approval scope escalation and expired approvals', () => {
    expect(() => buildCaseVortexGovernedReleaseApproval({
      ...registrationApproval(),
      approvalId: '30000000-0000-4000-8000-000000000003',
      authorizationStatement: caseVortexGovernedReleaseAuthorizationStatement('register_candidate'),
      publicationActivationApproved: true,
    })).toThrow('case_vortex_governed_release_approval_scope_invalid');

    expect(() => verifyFreshCaseVortexGovernedReleaseApproval(
      registrationApproval(),
      new Date('2026-08-11T12:00:00.001Z'),
    )).toThrow('case_vortex_governed_release_approval_expired');
  });

  it('records the returned candidate id and preserves idempotent already-complete outcomes', () => {
    const approval = registrationApproval();
    const receipt = buildCaseVortexGovernedReleaseReceipt({
      operationId: '40000000-0000-4000-8000-000000000004',
      createdAt: now.toISOString(),
      stage: 'register_candidate',
      approvalSha256: approval.approvalSha256,
      corpusVersion: approval.corpusVersion,
      typedRequestKey: approval.typedRequestKey,
      typedRequestSha256: approval.typedRequestSha256,
      publicManifestSha256: approval.publicManifestSha256,
      recordLedgerSha256: approval.recordLedgerSha256,
      publicationId: null,
      resultPublicationId: publicationId,
      outcome: 'completed',
    });
    expect(receipt.resultPublicationId).toBe(publicationId);
    expect(buildCaseVortexGovernedReleaseReceipt({
      ...receipt,
      operationId: '50000000-0000-4000-8000-000000000005',
      outcome: 'already_complete',
    }).outcome).toBe('already_complete');

    expect(() => buildCaseVortexGovernedReleaseReceipt({
      ...receipt,
      operationId: '60000000-0000-4000-8000-000000000006',
      resultPublicationId: null,
    })).toThrow('case_vortex_governed_release_receipt_result_publication_invalid');
  });
});
