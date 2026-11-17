import { createHash } from 'node:crypto';
import type { ContextualSourceGovernanceDecisionPacket } from '../../caseGraph/contextualSourceGovernanceDecision';
import { relationshipInputSha256 } from '../../caseGraph/relationshipInputSnapshot';
import {
  buildSatnogsDbAcquisitionPlan,
  buildSnapshotsFromSatnogsDbResponse,
  SATNOGS_DB_ADAPTER_VERSION,
  type SatnogsDbAcquisitionPlan,
} from './satnogs';
import type { SatelliteElementSnapshotInput } from './types';

export const SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION = 'satnogs-db-snapshot-archive-v1' as const;

export type SatnogsDbSnapshotArchive = {
  recordType: 'satnogs_db_snapshot_archive';
  schemaVersion: typeof SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION;
  adapterVersion: typeof SATNOGS_DB_ADAPTER_VERSION;
  acquiredAt: string;
  acquisitionPlanDigest: string;
  governancePacketDigest: string;
  response: {
    status: 200;
    contentType: string;
    byteLength: number;
    sha256: string;
  };
  summary: {
    sourceRowCount: number;
    snapshotCount: number;
    objectCount: number;
    earliestEpoch: string | null;
    latestEpoch: string | null;
    earliestUpstreamUpdate: string | null;
    latestUpstreamUpdate: string | null;
    followedIdentityCount: number;
    coalescedAliasCount: number;
    futureEpochCount: number;
    maximumFutureEpochHours: number;
  };
  snapshots: SatelliteElementSnapshotInput[];
  snapshotSetSha256: string;
  guarantees: {
    providerCalls: 1;
    databaseWrites: 0;
    r2Writes: 0;
    lunaCalls: 0;
    contextualEdgesCreated: 0;
    publicationActivation: false;
    deployment: false;
  };
  archiveDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value as string;
};

const verifyPlan = (
  value: unknown,
  packet: ContextualSourceGovernanceDecisionPacket,
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('satnogs_db_archive_plan_invalid');
  }
  const plan = value as SatnogsDbAcquisitionPlan;
  const rebuilt = buildSatnogsDbAcquisitionPlan({
    decisionPacket: packet,
    plannedAt: String(plan.plannedAt),
  });
  if (relationshipInputSha256(plan) !== relationshipInputSha256(rebuilt)) {
    invalid('satnogs_db_archive_plan_mismatch');
  }
  return rebuilt;
};

const extrema = (values: string[]) => {
  const sorted = [...values].sort(lexical);
  return { earliest: sorted[0] || null, latest: sorted.at(-1) || null };
};

export const buildSatnogsDbSnapshotArchive = (params: {
  acquisitionPlan: unknown;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  responseBytes: Buffer | string;
  acquiredAt: string;
  responseStatus: number;
  responseContentType: string;
}): SatnogsDbSnapshotArchive => {
  const plan = verifyPlan(params.acquisitionPlan, params.decisionPacket);
  const acquiredAt = timestamp(params.acquiredAt, 'satnogs_db_archive_acquired_at_invalid');
  const acquiredAtMs = Date.parse(acquiredAt);
  const plannedAtMs = Date.parse(plan.plannedAt);
  if (acquiredAtMs < plannedAtMs || acquiredAtMs - plannedAtMs > 3_600_000) {
    invalid('satnogs_db_archive_plan_window_invalid');
  }
  if (params.responseStatus !== 200) invalid(`satnogs_db_archive_http_status:${params.responseStatus}`);
  const contentType = String(params.responseContentType || '').trim().toLowerCase();
  if (!/^application\/json(?:\s*;|$)/u.test(contentType)) {
    invalid('satnogs_db_archive_content_type_invalid');
  }
  const responseBytes = Buffer.isBuffer(params.responseBytes)
    ? Buffer.from(params.responseBytes)
    : Buffer.from(params.responseBytes, 'utf8');
  const snapshots = buildSnapshotsFromSatnogsDbResponse({
    responseBytes,
    retrievedAt: acquiredAt,
    decisionPacket: params.decisionPacket,
  }).sort((left, right) => (
    left.noradId - right.noradId
    || lexical(left.epoch, right.epoch)
    || lexical(left.sourceObjectId || '', right.sourceObjectId || '')
  ));
  if (!snapshots.length) invalid('satnogs_db_archive_empty');
  const epochs = extrema(snapshots.map(({ epoch }) => epoch));
  const upstreamUpdates = extrema(snapshots.map((snapshot) => {
    const value = snapshot.sourceMetadata?.upstream_updated_at;
    if (typeof value !== 'string') invalid('satnogs_db_archive_upstream_update_invalid');
    return timestamp(value, 'satnogs_db_archive_upstream_update_invalid');
  }));
  const responseSha256 = String(snapshots[0].sourceMetadata?.response_sha256 || '');
  if (!SHA256.test(responseSha256)
    || snapshots.some(({ sourceMetadata }) => sourceMetadata?.response_sha256 !== responseSha256)) {
    invalid('satnogs_db_archive_response_digest_invalid');
  }
  const snapshotSetSha256 = relationshipInputSha256(snapshots.map((snapshot) => ({
    noradId: snapshot.noradId,
    sourceObjectId: snapshot.sourceObjectId,
    epoch: snapshot.epoch,
    tleLine1: snapshot.tleLine1,
    tleLine2: snapshot.tleLine2,
  })));
  const sourceRowCount = Number(snapshots[0].sourceMetadata?.source_row_count);
  if (!Number.isSafeInteger(sourceRowCount) || sourceRowCount < snapshots.length
    || snapshots.some(({ sourceMetadata }) => sourceMetadata?.source_row_count !== sourceRowCount)) {
    invalid('satnogs_db_archive_source_row_count_invalid');
  }
  const aliases = snapshots.flatMap(({ sourceMetadata }) => (
    Array.isArray(sourceMetadata?.satnogs_identity_aliases)
      ? sourceMetadata.satnogs_identity_aliases as Array<Record<string, unknown>>
      : []
  ));
  const body: Omit<SatnogsDbSnapshotArchive, 'archiveDigest'> = {
    recordType: 'satnogs_db_snapshot_archive',
    schemaVersion: SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION,
    adapterVersion: SATNOGS_DB_ADAPTER_VERSION,
    acquiredAt,
    acquisitionPlanDigest: plan.planDigest,
    governancePacketDigest: plan.governance.packetDigest,
    response: {
      status: 200,
      contentType,
      byteLength: responseBytes.byteLength,
      sha256: responseSha256,
    },
    summary: {
      sourceRowCount,
      snapshotCount: snapshots.length,
      objectCount: new Set(snapshots.map(({ noradId }) => noradId)).size,
      earliestEpoch: epochs.earliest,
      latestEpoch: epochs.latest,
      earliestUpstreamUpdate: upstreamUpdates.earliest,
      latestUpstreamUpdate: upstreamUpdates.latest,
      followedIdentityCount: aliases.filter(({ norad_identity_status }) => (
        norad_identity_status === 'follow_id_inferred'
      )).length,
      coalescedAliasCount: sourceRowCount - snapshots.length,
      futureEpochCount: snapshots.filter(({ sourceMetadata }) => (
        sourceMetadata?.epoch_timing_status === 'future_within_72h'
      )).length,
      maximumFutureEpochHours: Math.max(
        0,
        ...snapshots.map(({ sourceMetadata }) => (
          typeof sourceMetadata?.epoch_update_delta_hours === 'number'
            ? sourceMetadata.epoch_update_delta_hours
            : 0
        )),
      ),
    },
    snapshots,
    snapshotSetSha256,
    guarantees: {
      providerCalls: 1,
      databaseWrites: 0,
      r2Writes: 0,
      lunaCalls: 0,
      contextualEdgesCreated: 0,
      publicationActivation: false,
      deployment: false,
    },
  };
  return { ...body, archiveDigest: relationshipInputSha256(body) };
};

export const verifySatnogsDbSnapshotArchive = (params: {
  value: unknown;
  acquisitionPlan: unknown;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  responseBytes: Buffer | string;
}): SatnogsDbSnapshotArchive => {
  if (!params.value || typeof params.value !== 'object' || Array.isArray(params.value)) {
    invalid('satnogs_db_archive_invalid');
  }
  const value = params.value as Record<string, unknown>;
  const rebuilt = buildSatnogsDbSnapshotArchive({
    acquisitionPlan: params.acquisitionPlan,
    decisionPacket: params.decisionPacket,
    responseBytes: params.responseBytes,
    acquiredAt: String(value.acquiredAt),
    responseStatus: Number((value.response as Record<string, unknown>)?.status),
    responseContentType: String((value.response as Record<string, unknown>)?.contentType || ''),
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    invalid('satnogs_db_archive_mismatch');
  }
  return rebuilt;
};

export const buildSatnogsDbSnapshotArchiveFromFailureReceipt = (params: {
  failureReceipt: unknown;
  acquisitionPlan: unknown;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  responseBytes: Buffer | string;
}): SatnogsDbSnapshotArchive => {
  if (!params.failureReceipt || typeof params.failureReceipt !== 'object'
    || Array.isArray(params.failureReceipt)) invalid('satnogs_db_failure_receipt_invalid');
  const failure = params.failureReceipt as Record<string, unknown>;
  const expectedKeys = [
    'recordType', 'schemaVersion', 'failedAt', 'acquisitionPlanDigest',
    'governancePacketDigest', 'response', 'errorCode', 'guarantees', 'failureDigest',
  ].sort();
  const actualKeys = Object.keys(failure).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || failure.recordType !== 'satnogs_db_acquisition_validation_failure'
    || failure.schemaVersion !== 'satnogs-db-acquisition-validation-failure-v1'
    || typeof failure.failureDigest !== 'string') {
    invalid('satnogs_db_failure_receipt_invalid');
  }
  const { failureDigest, ...failureBody } = failure;
  if (relationshipInputSha256(failureBody) !== failureDigest) {
    invalid('satnogs_db_failure_receipt_digest_mismatch');
  }
  const plan = verifyPlan(params.acquisitionPlan, params.decisionPacket);
  if (failure.acquisitionPlanDigest !== plan.planDigest
    || failure.governancePacketDigest !== plan.governance.packetDigest
    || typeof failure.errorCode !== 'string'
    || !failure.errorCode.startsWith('satnogs_db_')) {
    invalid('satnogs_db_failure_receipt_binding_mismatch');
  }
  const response = failure.response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    invalid('satnogs_db_failure_receipt_response_invalid');
  }
  const responseRecord = response as Record<string, unknown>;
  const responseBytes = Buffer.isBuffer(params.responseBytes)
    ? Buffer.from(params.responseBytes)
    : Buffer.from(params.responseBytes, 'utf8');
  if (responseRecord.byteLength !== responseBytes.byteLength
    || responseRecord.sha256 !== createHash('sha256').update(responseBytes).digest('hex')) {
    invalid('satnogs_db_failure_receipt_response_mismatch');
  }
  return buildSatnogsDbSnapshotArchive({
    acquisitionPlan: plan,
    decisionPacket: params.decisionPacket,
    responseBytes,
    acquiredAt: String(failure.failedAt),
    responseStatus: Number(responseRecord.status),
    responseContentType: String(responseRecord.contentType || ''),
  });
};
