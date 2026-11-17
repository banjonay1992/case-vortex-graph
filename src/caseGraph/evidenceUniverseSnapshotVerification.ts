import {
  EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
  EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
  evidenceUniverseSnapshotIdentitySha256,
  type EvidenceUniverseSnapshotReceipt,
} from './postgresEvidenceUniverseSnapshot';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const EVIDENCE_UNIVERSE_SNAPSHOT_VERIFICATION_VERSION =
  'evidence-universe-snapshot-verification-v1' as const;

export type EvidenceUniverseSnapshotVerification = {
  recordType: 'evidence_universe_snapshot_verification';
  schemaVersion: typeof EVIDENCE_UNIVERSE_SNAPSHOT_VERIFICATION_VERSION;
  verifiedAt: string;
  transaction: {
    isolation: 'repeatable read';
    readOnly: true;
  };
  snapshot: EvidenceUniverseSnapshotReceipt;
  snapshotIdentitySha256: string;
  guarantees: {
    databaseWrites: 0;
    r2Reads: 0;
    r2Writes: 0;
    lunaCalls: 0;
    publications: 0;
    deployments: 0;
  };
  receiptSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const invalid = (code: string): never => { throw new Error(code); };

const canonicalTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40
    || !Number.isFinite(new Date(value).getTime())) invalid(code);
  return value as string;
};

const normalizeSnapshot = (value: unknown): EvidenceUniverseSnapshotReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('evidence_universe_snapshot_verification_snapshot_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'snapshotId', 'snapshotAt', 'materializedAt', 'sourceMvccSnapshot',
    'snapshotPolicy', 'capturePolicies', 'counts', 'total', 'reused',
  ];
  if (Object.keys(candidate).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(candidate, key))
    || typeof candidate.snapshotId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
      .test(candidate.snapshotId)
    || candidate.snapshotPolicy !== 'evidence-universe-materialized-v1'
    || typeof candidate.sourceMvccSnapshot !== 'string'
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/u.test(candidate.sourceMvccSnapshot)
    || candidate.reused !== true
    || !candidate.capturePolicies || typeof candidate.capturePolicies !== 'object'
    || Array.isArray(candidate.capturePolicies)
    || !candidate.counts || typeof candidate.counts !== 'object'
    || Array.isArray(candidate.counts)) {
    invalid('evidence_universe_snapshot_verification_snapshot_invalid');
  }
  const capturePolicies = candidate.capturePolicies as Record<string, unknown>;
  const counts = candidate.counts as Record<string, unknown>;
  const kinds = ['sighting', 'document', 'photo', 'video'] as const;
  if (Object.keys(capturePolicies).length !== kinds.length
    || Object.keys(counts).length !== kinds.length
    || kinds.some((kind) => !Number.isSafeInteger(counts[kind]) || Number(counts[kind]) < 0)
    || capturePolicies.sighting !== EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY
    || kinds.slice(1).some((kind) => capturePolicies[kind] !== EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY)) {
    invalid('evidence_universe_snapshot_verification_snapshot_invalid');
  }
  const normalizedCounts = {
    sighting: Number(counts.sighting),
    document: Number(counts.document),
    photo: Number(counts.photo),
    video: Number(counts.video),
  };
  const total = Object.values(normalizedCounts).reduce((sum, count) => sum + count, 0);
  if (candidate.total !== total) invalid('evidence_universe_snapshot_verification_snapshot_invalid');
  return {
    snapshotId: candidate.snapshotId as string,
    snapshotAt: canonicalTimestamp(
      candidate.snapshotAt,
      'evidence_universe_snapshot_verification_snapshot_invalid',
    ),
    materializedAt: canonicalTimestamp(
      candidate.materializedAt,
      'evidence_universe_snapshot_verification_snapshot_invalid',
    ),
    sourceMvccSnapshot: candidate.sourceMvccSnapshot as string,
    snapshotPolicy: 'evidence-universe-materialized-v1',
    capturePolicies: {
      sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
      document: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
      photo: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
      video: EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY,
    },
    counts: normalizedCounts,
    total,
    reused: true,
  };
};

export const buildEvidenceUniverseSnapshotVerification = (input: {
  verifiedAt: string;
  snapshot: EvidenceUniverseSnapshotReceipt;
}): EvidenceUniverseSnapshotVerification => {
  const snapshot = normalizeSnapshot(input.snapshot);
  const withoutDigest: Omit<EvidenceUniverseSnapshotVerification, 'receiptSha256'> = {
    recordType: 'evidence_universe_snapshot_verification',
    schemaVersion: EVIDENCE_UNIVERSE_SNAPSHOT_VERIFICATION_VERSION,
    verifiedAt: new Date(input.verifiedAt).toISOString(),
    transaction: { isolation: 'repeatable read', readOnly: true },
    snapshot,
    snapshotIdentitySha256: evidenceUniverseSnapshotIdentitySha256(snapshot),
    guarantees: {
      databaseWrites: 0,
      r2Reads: 0,
      r2Writes: 0,
      lunaCalls: 0,
      publications: 0,
      deployments: 0,
    },
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyEvidenceUniverseSnapshotVerification = (
  value: unknown,
): EvidenceUniverseSnapshotVerification => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('evidence_universe_snapshot_verification_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'verifiedAt', 'transaction', 'snapshot',
    'snapshotIdentitySha256', 'guarantees', 'receiptSha256',
  ];
  if (Object.keys(candidate).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(candidate, key))
    || candidate.recordType !== 'evidence_universe_snapshot_verification'
    || candidate.schemaVersion !== EVIDENCE_UNIVERSE_SNAPSHOT_VERIFICATION_VERSION
    || typeof candidate.snapshotIdentitySha256 !== 'string'
    || !SHA256.test(candidate.snapshotIdentitySha256)
    || typeof candidate.receiptSha256 !== 'string'
    || !SHA256.test(candidate.receiptSha256)) {
    invalid('evidence_universe_snapshot_verification_invalid');
  }
  const rebuilt = buildEvidenceUniverseSnapshotVerification({
    verifiedAt: candidate.verifiedAt as string,
    snapshot: candidate.snapshot as EvidenceUniverseSnapshotReceipt,
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    invalid('evidence_universe_snapshot_verification_derived_fields_invalid');
  }
  return rebuilt;
};
