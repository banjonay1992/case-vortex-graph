import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import type { GovernedContextualSourceSnapshot } from './contextualObservationArchive';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_OBSERVATION_ARCHIVE_GOVERNANCE_VERSION =
  'contextual-observation-archive-governance-v1' as const;

export type ContextualObservationArchiveGovernanceReceipt = {
  recordType: 'contextual_observation_archive_governance_receipt';
  schemaVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_GOVERNANCE_VERSION;
  packetDigest: string;
  decisionEntryDigest: string;
  decisionReferenceAt: string;
  decisionExpiresAt: string;
  category: GovernedContextualSourceSnapshot['kind'];
  canonicalSource: string;
  providerId: string;
  requiredContentMode: 'derived_only';
  sourceSnapshotDigest: string;
  authorizedAt: string;
  receiptDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const invalid = (code: string): never => { throw new Error(code); };
const timestamp = (value: unknown, code: string) => {
  const raw = String(value || '').trim();
  const time = Date.parse(raw);
  if (!raw || !Number.isFinite(time)) invalid(code);
  return new Date(time).toISOString();
};
const digest = (value: unknown, code: string) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!SHA256.test(raw)) invalid(code);
  return raw;
};

const build = (params: {
  packet: ContextualSourceGovernanceDecisionPacket;
  snapshot: GovernedContextualSourceSnapshot;
  canonicalSource: string;
  authorizedAt: string;
}) => {
  const packet = verifyContextualSourceGovernanceDecisionPacket(params.packet);
  const canonicalSource = String(params.canonicalSource || '').trim().toUpperCase();
  const authorizedAt = timestamp(
    params.authorizedAt,
    'contextual_archive_governance_authorized_at_invalid',
  );
  const referenceAtMs = Date.parse(packet.referenceAt);
  const expiresAtMs = referenceAtMs + packet.maximumEvidenceAgeDays * 86_400_000;
  const authorizedAtMs = Date.parse(authorizedAt);
  if (authorizedAtMs < referenceAtMs || authorizedAtMs > expiresAtMs) {
    invalid('contextual_archive_governance_packet_stale');
  }
  const matches = packet.entries.filter((entry) => (
    entry.category === params.snapshot.kind
    && entry.canonicalSource === canonicalSource
    && entry.providerId === params.snapshot.providerId.toLowerCase()
    && entry.requiredContentMode === 'derived_only'
  ));
  if (matches.length !== 1) invalid('contextual_archive_governance_decision_missing');
  const decision = matches[0];
  if (!decision.usableNow || decision.decision !== 'approved') {
    invalid(`contextual_archive_governance_not_approved:${decision.decision}`);
  }
  const sourceSnapshotDigest = digest(
    params.snapshot.snapshotDigest,
    'contextual_archive_governance_snapshot_invalid',
  );
  const body = {
    recordType: 'contextual_observation_archive_governance_receipt' as const,
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_GOVERNANCE_VERSION,
    packetDigest: packet.packetDigest,
    decisionEntryDigest: decision.entryDigest,
    decisionReferenceAt: packet.referenceAt,
    decisionExpiresAt: new Date(expiresAtMs).toISOString(),
    category: params.snapshot.kind,
    canonicalSource,
    providerId: params.snapshot.providerId.toLowerCase(),
    requiredContentMode: 'derived_only' as const,
    sourceSnapshotDigest,
    authorizedAt,
  };
  return { ...body, receiptDigest: relationshipInputSha256(body) };
};

export const buildContextualObservationArchiveGovernanceReceipt = build;

export const verifyContextualObservationArchiveGovernanceReceipt = (params: {
  value: unknown;
  packet: ContextualSourceGovernanceDecisionPacket;
  snapshot: GovernedContextualSourceSnapshot;
  canonicalSource: string;
}): ContextualObservationArchiveGovernanceReceipt => {
  if (!params.value || typeof params.value !== 'object' || Array.isArray(params.value)) {
    invalid('contextual_archive_governance_receipt_invalid');
  }
  const value = params.value as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'packetDigest', 'decisionEntryDigest',
    'decisionReferenceAt', 'decisionExpiresAt', 'category', 'canonicalSource',
    'providerId', 'requiredContentMode', 'sourceSnapshotDigest', 'authorizedAt',
    'receiptDigest',
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || value.recordType !== 'contextual_observation_archive_governance_receipt'
    || value.schemaVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_GOVERNANCE_VERSION) {
    invalid('contextual_archive_governance_receipt_invalid');
  }
  const rebuilt = build({
    packet: params.packet,
    snapshot: params.snapshot,
    canonicalSource: params.canonicalSource,
    authorizedAt: String(value.authorizedAt),
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    invalid('contextual_archive_governance_receipt_mismatch');
  }
  return rebuilt;
};
