import { createHash } from 'node:crypto';

export const EVIDENCE_UNIVERSE_SCHEMA_VERSION = 'evidence-universe-v2' as const;
export const EVIDENCE_UNIVERSE_LAYOUT_VERSION = 'evidence-universe-layout-v2' as const;

// The dated field keeps the familiar 1900-2027 ten-unit overview, but the
// affine mapping is deliberately not clamped. Governed records outside that
// nominal interval remain correctly ordered instead of piling up at an edge.
export const EVIDENCE_UNIVERSE_TIMELINE_V2 = {
  start: '1900-01-01T00:00:00.000Z',
  end: '2027-01-01T00:00:00.000Z',
  minimumX: -5,
  maximumX: 5,
} as const;

export const EVIDENCE_UNIVERSE_UNDATED_BELT_V2 = {
  minimumRadius: 4.33,
  maximumRadius: 4.77,
  maximumAbsX: 0.16,
} as const;

export type EvidenceUniverseNodeKind = 'sighting' | 'document' | 'photo' | 'video';

export type EvidenceUniverseRawRecord = {
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  source: string;
  sourceRecordId: string | null;
  title: string | null;
  summary: string | null;
  canonicalUrl: string | null;
  previewUrl: string | null;
  eventTimestamp: string | null;
  lat: number | null;
  lon: number | null;
  location: string | null;
  countryCode: string | null;
  linkedSightingId: string | null;
  updatedAt: string;
  public: boolean;
};

export type EvidenceUniverseNode = Omit<EvidenceUniverseRawRecord, 'public'> & {
  schemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  layoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  address: string;
  position: [number, number, number];
};

export type EvidenceUniverseAccounting = {
  total: number;
  byKind: Record<EvidenceUniverseNodeKind, number>;
  attachedMedia: number;
  unresolvedTime: number;
  unresolvedLocation: number;
};

const NODE_KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const FULL_TURN = Math.PI * 2;
const TIMELINE_START_MS = Date.parse(EVIDENCE_UNIVERSE_TIMELINE_V2.start);
const TIMELINE_END_MS = Date.parse(EVIDENCE_UNIVERSE_TIMELINE_V2.end);
const TIMELINE_X_SPAN = EVIDENCE_UNIVERSE_TIMELINE_V2.maximumX - EVIDENCE_UNIVERSE_TIMELINE_V2.minimumX;
const GEOGRAPHIC_Y_EXTENT = 2.1;
const GEOGRAPHIC_Z_EXTENT = 2.8;
const POSITION_JITTER_MINIMUM = 0.014;
const POSITION_JITTER_SPAN = 0.026;

const normalizeRecordId = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized.includes(':') || normalized.length > 240) {
    throw new Error('evidence_universe_record_id_invalid');
  }
  return normalized;
};

const numberOrNull = (value: unknown, minimum: number, maximum: number) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};

const isoOrNull = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const eventIsoOrNull = (value: unknown) => {
  if (value == null || value === '') return null;
  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  const canonical = parsed.toISOString();
  const fraction = raw.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1];
  if (!fraction || fraction.length <= 3) return canonical;
  if (fraction.length > 9) return null;
  return `${canonical.slice(0, 19)}.${fraction}Z`;
};

const preciseEpochMilliseconds = (canonicalTimestamp: string) => {
  const epochMs = Date.parse(canonicalTimestamp);
  const fraction = canonicalTimestamp.match(/\.(\d+)Z$/)?.[1] || '';
  const subMillisecondDigits = fraction.slice(3);
  return epochMs + (subMillisecondDigits ? Number(`0.${subMillisecondDigits}`) : 0);
};

const stableUnits = (value: string) => {
  const digest = createHash('sha256').update(value).digest();
  return (offset: 0 | 4 | 8 | 12 | 16 | 20 | 24 | 28) => digest.readUInt32BE(offset) / 0xffffffff;
};

export const evidenceUniverseAddress = (kind: EvidenceUniverseNodeKind, recordId: string) => {
  if (!NODE_KINDS.includes(kind)) throw new Error('evidence_universe_node_kind_invalid');
  return `${kind}:${normalizeRecordId(recordId)}`;
};

export const evidenceUniversePosition = (record: Pick<EvidenceUniverseRawRecord,
  'kind' | 'recordId' | 'eventTimestamp' | 'lat' | 'lon'>): [number, number, number] => {
  const address = evidenceUniverseAddress(record.kind, record.recordId);
  const eventTimestamp = eventIsoOrNull(record.eventTimestamp);
  const unit = stableUnits(address);
  const latitude = numberOrNull(record.lat, -90, 90);
  const longitude = numberOrNull(record.lon, -180, 180);
  const jitterAngle = unit(8) * FULL_TURN;
  const jitterRadius = POSITION_JITTER_MINIMUM + unit(12) * POSITION_JITTER_SPAN;

  if (!eventTimestamp) {
    // Undated records cannot honestly occupy the time rail. They live in a
    // separate, deterministic outer belt; longitude determines bearing when
    // available and latitude contributes only a small belt-depth cue.
    const angle = longitude == null ? unit(16) * FULL_TURN : (longitude + 180) / 360 * FULL_TURN;
    const latitudeDepth = latitude == null ? (unit(20) - 0.5) * 0.12 : latitude / 90 * 0.12;
    const radius = 4.55 + latitudeDepth + (unit(24) - 0.5) * 0.10;
    return [
      (unit(28) - 0.5) * EVIDENCE_UNIVERSE_UNDATED_BELT_V2.maximumAbsX * 2,
      Math.sin(angle) * radius + Math.sin(jitterAngle) * jitterRadius,
      Math.cos(angle) * radius + Math.cos(jitterAngle) * jitterRadius,
    ];
  }

  const timeProgress = (preciseEpochMilliseconds(eventTimestamp) - TIMELINE_START_MS)
    / (TIMELINE_END_MS - TIMELINE_START_MS);
  const geographicY = latitude == null ? (unit(0) * 2 - 1) * GEOGRAPHIC_Y_EXTENT : latitude / 90 * GEOGRAPHIC_Y_EXTENT;
  const geographicZ = longitude == null ? (unit(4) * 2 - 1) * GEOGRAPHIC_Z_EXTENT : longitude / 180 * GEOGRAPHIC_Z_EXTENT;
  return [
    EVIDENCE_UNIVERSE_TIMELINE_V2.minimumX + timeProgress * TIMELINE_X_SPAN,
    geographicY + Math.sin(jitterAngle) * jitterRadius,
    geographicZ + Math.cos(jitterAngle) * jitterRadius,
  ];
};

export const projectEvidenceUniverseNode = (raw: EvidenceUniverseRawRecord): EvidenceUniverseNode => {
  if (!raw.public) throw new Error('evidence_universe_record_not_public');
  const address = evidenceUniverseAddress(raw.kind, raw.recordId);
  const updatedAt = isoOrNull(raw.updatedAt);
  const eventTimestamp = eventIsoOrNull(raw.eventTimestamp);
  if (!updatedAt) throw new Error('evidence_universe_updated_at_invalid');
  return {
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    address,
    kind: raw.kind,
    recordId: normalizeRecordId(raw.recordId),
    source: String(raw.source || '').trim() || 'unknown',
    sourceRecordId: raw.sourceRecordId ? String(raw.sourceRecordId).trim() || null : null,
    title: raw.title ? String(raw.title).trim() || null : null,
    summary: raw.summary ? String(raw.summary).trim() || null : null,
    canonicalUrl: raw.canonicalUrl ? String(raw.canonicalUrl).trim() || null : null,
    previewUrl: raw.previewUrl ? String(raw.previewUrl).trim() || null : null,
    eventTimestamp,
    lat: numberOrNull(raw.lat, -90, 90),
    lon: numberOrNull(raw.lon, -180, 180),
    location: raw.location ? String(raw.location).trim() || null : null,
    countryCode: raw.countryCode ? String(raw.countryCode).trim().toUpperCase().slice(0, 10) || null : null,
    linkedSightingId: raw.linkedSightingId ? normalizeRecordId(raw.linkedSightingId) : null,
    updatedAt,
    position: evidenceUniversePosition({ ...raw, eventTimestamp }),
  };
};

export const projectSightingEvidenceUniverseNode = (row: {
  cursor: { updated_at: string; case_id: string };
  sighting: Record<string, unknown>;
}) => projectEvidenceUniverseNode({
  kind: 'sighting',
  recordId: row.cursor.case_id,
  source: String(row.sighting.source || 'unknown'),
  sourceRecordId: row.sighting.source_record_id == null ? null : String(row.sighting.source_record_id),
  title: row.sighting.shape_normalized == null && row.sighting.shape == null
    ? null : String(row.sighting.shape_normalized || row.sighting.shape),
  summary: row.sighting.summary == null && row.sighting.description_clean == null && row.sighting.description == null
    ? null : String(row.sighting.summary || row.sighting.description_clean || row.sighting.description),
  canonicalUrl: row.sighting.source_url == null ? null : String(row.sighting.source_url),
  previewUrl: null,
  eventTimestamp: row.sighting.event_timestamp == null ? null : String(row.sighting.event_timestamp),
  lat: numberOrNull(row.sighting.lat, -90, 90),
  lon: numberOrNull(row.sighting.lon, -180, 180),
  location: row.sighting.location == null ? null : String(row.sighting.location),
  countryCode: row.sighting.country_code == null ? null : String(row.sighting.country_code),
  linkedSightingId: null,
  updatedAt: row.cursor.updated_at,
  public: true,
});

export const accountEvidenceUniverseNodes = (nodes: EvidenceUniverseNode[]): EvidenceUniverseAccounting => {
  const addresses = new Set<string>();
  const byKind: Record<EvidenceUniverseNodeKind, number> = { sighting: 0, document: 0, photo: 0, video: 0 };
  let attachedMedia = 0;
  let unresolvedTime = 0;
  let unresolvedLocation = 0;
  for (const node of nodes) {
    if (
      node.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
      || node.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
      || !NODE_KINDS.includes(node.kind)
      || node.address !== evidenceUniverseAddress(node.kind, node.recordId)
      || !Array.isArray(node.position)
      || node.position.length !== 3
      || !node.position.every(Number.isFinite)
    ) throw new Error('evidence_universe_node_layout_invalid');
    if (addresses.has(node.address)) throw new Error(`evidence_universe_duplicate_address:${node.address}`);
    addresses.add(node.address);
    byKind[node.kind] += 1;
    if (node.kind !== 'sighting' && node.linkedSightingId) attachedMedia += 1;
    if (!node.eventTimestamp) unresolvedTime += 1;
    if (node.lat == null || node.lon == null) unresolvedLocation += 1;
  }
  return { total: nodes.length, byKind, attachedMedia, unresolvedTime, unresolvedLocation };
};
