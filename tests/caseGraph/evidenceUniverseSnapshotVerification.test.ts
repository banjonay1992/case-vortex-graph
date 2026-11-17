import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
  EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
} from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';
import {
  buildEvidenceUniverseSnapshotVerification,
  verifyEvidenceUniverseSnapshotVerification,
} from '../../src/caseGraph/evidenceUniverseSnapshotVerification';

const snapshot = () => ({
  snapshotId: '00000000-0000-4000-8000-000000000724',
  snapshotAt: '2026-07-24T10:27:33.026Z',
  materializedAt: '2026-07-24T10:27:33.025343Z',
  sourceMvccSnapshot: '47267690:47267690:',
  snapshotPolicy: 'evidence-universe-materialized-v1' as const,
  capturePolicies: {
    sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    document: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
    photo: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
    video: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
  },
  counts: { sighting: 393177, document: 31415, photo: 29717, video: 12626 },
  total: 466935,
  reused: true,
});

describe('evidence-universe snapshot verification receipt', () => {
  it('seals the complete immutable snapshot identity', () => {
    const verification = buildEvidenceUniverseSnapshotVerification({
      verifiedAt: '2026-07-24T18:10:00.000Z',
      snapshot: snapshot(),
    });
    expect(verifyEvidenceUniverseSnapshotVerification(verification)).toEqual(verification);
    expect(verification).toMatchObject({
      snapshotIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      guarantees: { databaseWrites: 0, r2Writes: 0, publications: 0, deployments: 0 },
    });
  });

  it('rejects physical count drift and derived-field tampering', () => {
    expect(() => buildEvidenceUniverseSnapshotVerification({
      verifiedAt: '2026-07-24T18:10:00.000Z',
      snapshot: { ...snapshot(), total: 1 },
    })).toThrow('evidence_universe_snapshot_verification_snapshot_invalid');
    const verification = buildEvidenceUniverseSnapshotVerification({
      verifiedAt: '2026-07-24T18:10:00.000Z',
      snapshot: snapshot(),
    });
    expect(() => verifyEvidenceUniverseSnapshotVerification({
      ...verification,
      snapshotIdentitySha256: 'b'.repeat(64),
    })).toThrow('evidence_universe_snapshot_verification_derived_fields_invalid');
  });
});
