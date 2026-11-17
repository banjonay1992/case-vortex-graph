import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT,
  buildEvidenceUniverseSnapshotCaptureApproval,
  verifyEvidenceUniverseSnapshotCaptureApproval,
} from '../../src/caseGraph/evidenceUniverseSnapshotApproval';

const input = () => ({
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  approvedBy: 'owner:nathan',
  approvedAt: '2026-07-24T10:30:00.000Z',
  snapshotId: '00000000-0000-4000-8000-000000000123',
  censusReceiptSha256: 'a'.repeat(64),
  censusInspectedAt: '2026-07-24T10:25:00.000Z',
  authorizationStatement: EVIDENCE_UNIVERSE_SNAPSHOT_APPROVAL_STATEMENT,
  snapshotCaptureApproved: true,
  publicationActivationApproved: false,
  deploymentApproved: false,
});

describe('evidence-universe snapshot approval artifact', () => {
  it('binds exact authority, snapshot UUID and census receipt', () => {
    const approval = buildEvidenceUniverseSnapshotCaptureApproval(input());
    expect(verifyEvidenceUniverseSnapshotCaptureApproval(approval)).toEqual(approval);
    expect(approval).toMatchObject({
      scope: 'capture_one_immutable_case_vortex_evidence_universe_snapshot_only',
      snapshotCaptureApproved: true,
      publicationActivationApproved: false,
      deploymentApproved: false,
      approvalSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('rejects paraphrased or broadened authority', () => {
    expect(() => buildEvidenceUniverseSnapshotCaptureApproval({
      ...input(),
      authorizationStatement: 'yes, do whatever is needed',
    })).toThrow('evidence_universe_snapshot_approval_scope_invalid');
    expect(() => buildEvidenceUniverseSnapshotCaptureApproval({
      ...input(),
      publicationActivationApproved: true,
    })).toThrow('evidence_universe_snapshot_approval_scope_invalid');
  });

  it('rejects tampered and resealed derived fields', () => {
    const approval = buildEvidenceUniverseSnapshotCaptureApproval(input());
    expect(() => verifyEvidenceUniverseSnapshotCaptureApproval({
      ...approval,
      censusReceiptSha256: 'b'.repeat(64),
    })).toThrow('evidence_universe_snapshot_approval_derived_fields_invalid');
    expect(() => verifyEvidenceUniverseSnapshotCaptureApproval({
      ...approval,
      scope: 'capture_and_publish',
    })).toThrow('evidence_universe_snapshot_approval_invalid');
  });
});
