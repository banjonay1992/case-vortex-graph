import { createHash } from 'node:crypto';
import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecision,
  type ContextualSourceGovernanceDecisionPacket,
} from '../../caseGraph/contextualSourceGovernanceDecision';
import { relationshipInputSha256 } from '../../caseGraph/relationshipInputSnapshot';
import { buildSnapshotsFromTleText } from './parse';
import type { SatelliteElementSnapshotInput } from './types';

export const SATNOGS_DB_ADAPTER_VERSION = 'satnogs-db-snapshot-adapter-v1' as const;
export const SATNOGS_DB_API_SCHEMA_VERSION = 'satnogs-db-latest-tle-openapi-2026-07-27' as const;
export const SATNOGS_DB_TLE_URL = 'https://db.satnogs.org/api/tle/?format=json' as const;
export const SATNOGS_DB_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
export const SATNOGS_DB_TIMEOUT_MS = 30_000;
export const SATNOGS_DB_MAX_FUTURE_EPOCH_HOURS = 72;

type SatnogsDbLatestTle = {
  tle0: string;
  tle1: string;
  tle2: string;
  tle_source: string;
  sat_id: string;
  norad_cat_id: number;
  updated: string;
};

export type SatnogsDbAcquisitionPlan = {
  recordType: 'satnogs_db_acquisition_plan';
  schemaVersion: typeof SATNOGS_DB_ADAPTER_VERSION;
  plannedAt: string;
  governance: {
    packetDigest: string;
    decisionEntryDigest: string;
    canonicalSource: 'SATNOGS_DB_API';
    providerId: 'satnogs-db';
    requiredContentMode: 'derived_only';
    decision: ContextualSourceGovernanceDecision;
  };
  request: {
    method: 'GET';
    url: typeof SATNOGS_DB_TLE_URL;
    accept: 'application/json';
    redirect: 'error';
    timeoutMs: number;
    maximumResponseBytes: number;
  };
  guarantees: {
    providerCalls: 0;
    databaseWrites: 0;
    storageWrites: 0;
    publicationActivation: false;
    deployment: false;
  };
  planDigest: string;
};

const REQUIRED_RECORD_KEYS = [
  'norad_cat_id',
  'sat_id',
  'tle0',
  'tle1',
  'tle2',
  'tle_source',
  'updated',
] as const;
const SAT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

const invalid = (code: string): never => { throw new Error(code); };

const exactTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const normalized = (value as string).trim();
  if (!normalized || normalized.length > 80) invalid(code);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) invalid(code);
  return new Date(milliseconds).toISOString();
};

const boundedText = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const normalized = (value as string).trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum
    || CONTROL_CHARACTER.test(normalized)) invalid(code);
  return normalized;
};

const exactKeys = (value: Record<string, unknown>, code: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...REQUIRED_RECORD_KEYS].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) invalid(code);
};

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const authorize = (
  packetValue: ContextualSourceGovernanceDecisionPacket,
  at: string,
) => {
  const packet = verifyContextualSourceGovernanceDecisionPacket(packetValue);
  const authorizedAt = exactTimestamp(at, 'satnogs_db_authorized_at_invalid');
  const referenceTime = Date.parse(packet.referenceAt);
  const expirationTime = referenceTime + packet.maximumEvidenceAgeDays * 86_400_000;
  const authorizedTime = Date.parse(authorizedAt);
  if (authorizedTime < referenceTime || authorizedTime > expirationTime) {
    invalid('satnogs_db_governance_packet_stale');
  }
  const matches = packet.entries.filter((entry) => (
    entry.category === 'satellite'
    && entry.canonicalSource === 'SATNOGS_DB_API'
    && entry.providerId === 'satnogs-db'
    && entry.requiredContentMode === 'derived_only'
  ));
  if (matches.length !== 1) invalid('satnogs_db_governance_decision_missing');
  const decision = matches[0];
  if (decision.decision !== 'approved' || !decision.usableNow) {
    invalid(`satnogs_db_governance_not_approved:${decision.decision}`);
  }
  return { packet, decision, authorizedAt };
};

export const buildSatnogsDbAcquisitionPlan = (params: {
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  plannedAt: string;
}): SatnogsDbAcquisitionPlan => {
  const { packet, decision, authorizedAt } = authorize(params.decisionPacket, params.plannedAt);
  const body = {
    recordType: 'satnogs_db_acquisition_plan' as const,
    schemaVersion: SATNOGS_DB_ADAPTER_VERSION,
    plannedAt: authorizedAt,
    governance: {
      packetDigest: packet.packetDigest,
      decisionEntryDigest: decision.entryDigest,
      canonicalSource: 'SATNOGS_DB_API' as const,
      providerId: 'satnogs-db' as const,
      requiredContentMode: 'derived_only' as const,
      decision: decision.decision,
    },
    request: {
      method: 'GET' as const,
      url: SATNOGS_DB_TLE_URL,
      accept: 'application/json' as const,
      redirect: 'error' as const,
      timeoutMs: SATNOGS_DB_TIMEOUT_MS,
      maximumResponseBytes: SATNOGS_DB_MAX_RESPONSE_BYTES,
    },
    guarantees: {
      providerCalls: 0 as const,
      databaseWrites: 0 as const,
      storageWrites: 0 as const,
      publicationActivation: false as const,
      deployment: false as const,
    },
  };
  return { ...body, planDigest: relationshipInputSha256(body) };
};

const normalizeRecord = (value: unknown, index: number): SatnogsDbLatestTle => {
  const code = `satnogs_db_record_invalid:${index}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  const raw = value as Record<string, unknown>;
  exactKeys(raw, code);
  const noradCatId = Number(raw.norad_cat_id);
  if (!Number.isSafeInteger(noradCatId) || noradCatId < 1 || noradCatId > 999_999) {
    invalid(`satnogs_db_norad_invalid:${index}`);
  }
  const satId = boundedText(raw.sat_id, 80, `satnogs_db_sat_id_invalid:${index}`);
  if (!SAT_ID.test(satId)) invalid(`satnogs_db_sat_id_invalid:${index}`);
  return {
    tle0: boundedText(raw.tle0, 256, `satnogs_db_tle0_invalid:${index}`),
    tle1: boundedText(raw.tle1, 256, `satnogs_db_tle1_invalid:${index}`),
    tle2: boundedText(raw.tle2, 256, `satnogs_db_tle2_invalid:${index}`),
    tle_source: boundedText(raw.tle_source, 160, `satnogs_db_tle_source_invalid:${index}`),
    sat_id: satId,
    norad_cat_id: noradCatId,
    updated: exactTimestamp(raw.updated, `satnogs_db_updated_invalid:${index}`),
  };
};

export const buildSnapshotsFromSatnogsDbResponse = (params: {
  responseBytes: Buffer | string;
  retrievedAt: string;
  sourceUrl?: string;
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  sourceGroups?: string[];
}): SatelliteElementSnapshotInput[] => {
  const { packet, decision, authorizedAt } = authorize(params.decisionPacket, params.retrievedAt);
  const sourceUrl = params.sourceUrl || SATNOGS_DB_TLE_URL;
  if (sourceUrl !== SATNOGS_DB_TLE_URL) invalid('satnogs_db_source_url_invalid');
  const responseBytes = Buffer.isBuffer(params.responseBytes)
    ? Buffer.from(params.responseBytes)
    : Buffer.from(params.responseBytes, 'utf8');
  if (!responseBytes.length || responseBytes.length > SATNOGS_DB_MAX_RESPONSE_BYTES) {
    invalid('satnogs_db_response_size_invalid');
  }
  const responseText = responseBytes.toString('utf8');
  if (responseText.includes('\uFFFD')) invalid('satnogs_db_response_utf8_invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    invalid('satnogs_db_response_json_invalid');
  }
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : invalid('satnogs_db_response_schema_invalid');

  const responseSha256 = sha256(responseBytes);
  const seenDeclaredNoradIds = new Set<number>();
  const sourceSnapshots = rows.map((value, index) => {
    const record = normalizeRecord(value, index);
    if (seenDeclaredNoradIds.has(record.norad_cat_id)) {
      invalid(`satnogs_db_duplicate_norad:${record.norad_cat_id}`);
    }
    seenDeclaredNoradIds.add(record.norad_cat_id);
    const objectName = record.tle0.replace(/^0\s+/u, '').trim();
    const built = buildSnapshotsFromTleText({
      provider: 'satnogs_db',
      sourceGroups: params.sourceGroups || ['satnogs-db'],
      archivedAt: authorizedAt,
      rawText: [objectName, record.tle1, record.tle2].join('\n'),
    });
    if (built.length !== 1) invalid(`satnogs_db_tle_invalid:${index}`);
    const snapshot = built[0];
    const epochUpdateDeltaHours = (
      Date.parse(snapshot.epoch) - Date.parse(record.updated)
    ) / 3_600_000;
    if (epochUpdateDeltaHours > SATNOGS_DB_MAX_FUTURE_EPOCH_HOURS) {
      invalid(`satnogs_db_epoch_too_far_after_updated:${index}`);
    }
    return {
      ...snapshot,
      objectName,
      sourceObjectId: record.sat_id,
      rawPayload: { ...(value as Record<string, unknown>) },
      sourceMetadata: {
        adapter_version: SATNOGS_DB_ADAPTER_VERSION,
        api_schema_version: SATNOGS_DB_API_SCHEMA_VERSION,
        canonical_source: 'SATNOGS_DB_API',
        provider_id: 'satnogs-db',
        source_url: sourceUrl,
        retrieved_at: authorizedAt,
        response_sha256: responseSha256,
        upstream_tle_source: record.tle_source,
        upstream_updated_at: record.updated,
        satnogs_declared_norad_cat_id: record.norad_cat_id,
        tle_catalog_number: snapshot.noradId,
        norad_identity_status: snapshot.noradId === record.norad_cat_id
          ? 'matches'
          : 'follow_id_inferred',
        epoch_update_delta_hours: Number(epochUpdateDeltaHours.toFixed(6)),
        epoch_timing_status: epochUpdateDeltaHours > 0
          ? 'future_within_72h'
          : 'not_future',
        licence: 'CC BY-SA 4.0',
        attribution: 'SatNOGS DB',
        governance_packet_digest: packet.packetDigest,
        governance_decision_entry_digest: decision.entryDigest,
        required_content_mode: 'derived_only',
      },
    };
  });
  const snapshotsByOrbitKey = new Map<string, SatelliteElementSnapshotInput[]>();
  for (const snapshot of sourceSnapshots) {
    const key = `${snapshot.noradId}:${snapshot.epoch}`;
    const grouped = snapshotsByOrbitKey.get(key) || [];
    grouped.push(snapshot);
    snapshotsByOrbitKey.set(key, grouped);
  }
  return [...snapshotsByOrbitKey.values()].map((group) => {
    const ranked = [...group].sort((left, right) => {
      const leftUpdated = String(left.sourceMetadata?.upstream_updated_at || '');
      const rightUpdated = String(right.sourceMetadata?.upstream_updated_at || '');
      return rightUpdated.localeCompare(leftUpdated)
        || String(left.sourceObjectId || '').localeCompare(String(right.sourceObjectId || ''));
    });
    const selected = ranked[0];
    const aliases = [...group].map((snapshot) => ({
      sat_id: snapshot.sourceObjectId,
      declared_norad_cat_id: snapshot.sourceMetadata?.satnogs_declared_norad_cat_id,
      tle_catalog_number: snapshot.noradId,
      norad_identity_status: snapshot.sourceMetadata?.norad_identity_status,
      upstream_updated_at: snapshot.sourceMetadata?.upstream_updated_at,
      upstream_tle_source: snapshot.sourceMetadata?.upstream_tle_source,
      tle_variant_sha256: sha256(Buffer.from(
        `${snapshot.tleLine1 || ''}\n${snapshot.tleLine2 || ''}`,
        'utf8',
      )),
    })).sort((left, right) => String(left.sat_id).localeCompare(String(right.sat_id)));
    return {
      ...selected,
      sourceMetadata: {
        ...selected.sourceMetadata,
        source_row_count: rows.length,
        coalesced_source_row_count: group.length,
        satnogs_identity_aliases: aliases,
      },
    };
  });
};
