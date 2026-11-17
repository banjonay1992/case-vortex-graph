import { twoline2satrec } from 'satellite.js';
import type { SatelliteElementSnapshotInput, SatelliteOrbitClass, SatelliteProvider } from './types';

const DAY_MS = 86_400_000;
const ALPHA5_PREFIXES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export type ParsedTleEntry = {
  noradId: number;
  objectName: string | null;
  tleLine1: string;
  tleLine2: string;
  epoch: string | null;
  orbitClass: SatelliteOrbitClass;
  parsedPayload: Record<string, unknown>;
};

const toFiniteNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Number(parsed) : null;
};

export const parseTleCatalogNumber = (value: unknown) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (/^\d{1,5}$/u.test(normalized)) return Number(normalized);
  if (!/^[A-HJ-NP-Z]\d{4}$/u.test(normalized)) return null;
  const prefixIndex = ALPHA5_PREFIXES.indexOf(normalized[0]);
  if (prefixIndex < 0) return null;
  return (prefixIndex + 10) * 10_000 + Number(normalized.slice(1));
};

const safeIso = (value: Date | string | null | undefined) => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

export const normalizeSatelliteGroups = (
  groups: Array<string | null | undefined>,
  fallback: string[] = [],
  maxGroups = 16,
) => {
  const normalized = Array.from(new Set(
    groups
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  )).slice(0, maxGroups);
  return normalized.length ? normalized : fallback;
};

export const getSatrecEpochIso = (satrec: ReturnType<typeof twoline2satrec>) => {
  const epochYear = toFiniteNumber((satrec as any)?.epochyr);
  const epochDays = toFiniteNumber((satrec as any)?.epochdays);
  if (epochYear == null || epochDays == null) return null;
  const fullYear = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear;
  const startMs = Date.UTC(fullYear, 0, 1, 0, 0, 0);
  const epochMs = startMs + (epochDays - 1) * DAY_MS;
  if (!Number.isFinite(epochMs)) return null;
  return new Date(epochMs).toISOString();
};

const orbitClassFromMeanMotion = (meanMotionRevPerDay: number | null): SatelliteOrbitClass => {
  if (meanMotionRevPerDay == null || meanMotionRevPerDay <= 0) return 'unknown';
  if (meanMotionRevPerDay >= 11.25) return 'leo';
  if (meanMotionRevPerDay >= 1.8) return 'meo';
  if (meanMotionRevPerDay >= 0.9 && meanMotionRevPerDay <= 1.1) return 'geo';
  if (meanMotionRevPerDay < 0.9) return 'heo';
  return 'unknown';
};

export const parseTleText = (text: string): ParsedTleEntry[] => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed: ParsedTleEntry[] = [];
  for (let index = 0; index < lines.length;) {
    const hasNameLine = !lines[index]?.startsWith('1 ');
    const objectName = hasNameLine ? (lines[index] || null) : null;
    const tleLine1 = lines[index + (hasNameLine ? 1 : 0)];
    const tleLine2 = lines[index + (hasNameLine ? 2 : 1)];
    index += hasNameLine ? 3 : 2;
    if (!tleLine1 || !tleLine2) continue;
    if (!tleLine1.startsWith('1 ') || !tleLine2.startsWith('2 ')) continue;
    try {
      const line1CatalogNumber = parseTleCatalogNumber(tleLine1.slice(2, 7));
      const line2CatalogNumber = parseTleCatalogNumber(tleLine2.slice(2, 7));
      if (line1CatalogNumber == null || line2CatalogNumber !== line1CatalogNumber) continue;
      const satrec = twoline2satrec(tleLine1, tleLine2);
      const epoch = getSatrecEpochIso(satrec);
      const meanMotionRevPerDay = toFiniteNumber((satrec as any)?.no) != null
        ? Number(((satrec as any).no * 1440) / (2 * Math.PI))
        : null;
      parsed.push({
        noradId: line1CatalogNumber,
        objectName,
        tleLine1,
        tleLine2,
        epoch,
        orbitClass: orbitClassFromMeanMotion(meanMotionRevPerDay),
        parsedPayload: {
          inclination_rad: toFiniteNumber((satrec as any)?.inclo),
          right_ascension_rad: toFiniteNumber((satrec as any)?.nodeo),
          eccentricity: toFiniteNumber((satrec as any)?.ecco),
          argument_of_perigee_rad: toFiniteNumber((satrec as any)?.argpo),
          mean_anomaly_rad: toFiniteNumber((satrec as any)?.mo),
          mean_motion_rad_min: toFiniteNumber((satrec as any)?.no),
          mean_motion_rev_per_day: meanMotionRevPerDay,
          bstar: toFiniteNumber((satrec as any)?.bstar),
          revolution_number_at_epoch: toFiniteNumber((satrec as any)?.revnum),
        },
      });
    } catch {
      // Ignore malformed TLE chunks.
    }
  }
  return parsed;
};

export const buildSnapshotsFromTleText = (params: {
  provider: SatelliteProvider;
  sourceGroups: string[];
  archivedAt?: string | null;
  rawText: string;
  sourceMetadata?: Record<string, unknown>;
}) => {
  const archivedAt = safeIso(params.archivedAt) || null;
  const groups = normalizeSatelliteGroups(params.sourceGroups);
  return parseTleText(params.rawText)
    .filter((entry) => entry.epoch)
    .map<SatelliteElementSnapshotInput>((entry) => ({
      noradId: entry.noradId,
      objectName: entry.objectName,
      provider: params.provider,
      sourceFormat: 'tle',
      orbitClass: entry.orbitClass,
      epoch: entry.epoch as string,
      archivedAt,
      sourceGroups: groups,
      tleLine1: entry.tleLine1,
      tleLine2: entry.tleLine2,
      rawPayload: {
        object_name: entry.objectName,
        tle_text: [entry.objectName || 'UNKNOWN', entry.tleLine1, entry.tleLine2].join('\n'),
      },
      parsedPayload: entry.parsedPayload,
      sourceMetadata: params.sourceMetadata || {},
    }));
};

export type SpaceTrackGpHistoryRow = {
  OBJECT_ID?: string | null;
  OBJECT_NAME?: string | null;
  NORAD_CAT_ID?: number | string | null;
  EPOCH?: string | null;
  TLE_LINE0?: string | null;
  TLE_LINE1?: string | null;
  TLE_LINE2?: string | null;
};

export const buildSnapshotsFromSpaceTrackRows = (params: {
  rows: SpaceTrackGpHistoryRow[];
  sourceGroups: string[];
  archivedAt?: string | null;
  sourceMetadata?: Record<string, unknown>;
}) => {
  const archivedAt = safeIso(params.archivedAt) || null;
  const groups = normalizeSatelliteGroups(params.sourceGroups);
  return params.rows.flatMap<SatelliteElementSnapshotInput>((row) => {
    const tleLine1 = String(row?.TLE_LINE1 || '').trim();
    const tleLine2 = String(row?.TLE_LINE2 || '').trim();
    if (!tleLine1 || !tleLine2) return [];
    const built = buildSnapshotsFromTleText({
      provider: 'space_track_gp_history',
      sourceGroups: groups,
      archivedAt,
      rawText: [String(row?.OBJECT_NAME || row?.TLE_LINE0 || 'UNKNOWN').trim() || 'UNKNOWN', tleLine1, tleLine2].join('\n'),
      sourceMetadata: {
        ...params.sourceMetadata,
        upstream_epoch: safeIso(row?.EPOCH || null),
      },
    })[0];
    if (!built) return [];
    const noradId = toFiniteNumber(row?.NORAD_CAT_ID);
    return [{
      ...built,
      noradId: noradId ?? built.noradId,
      objectName: String(row?.OBJECT_NAME || built.objectName || '').trim() || built.objectName,
      sourceObjectId: String(row?.OBJECT_ID || '').trim() || null,
      rawPayload: {
        object_name: row?.OBJECT_NAME ?? null,
        norad_cat_id: row?.NORAD_CAT_ID ?? null,
        epoch: row?.EPOCH ?? null,
        tle_line0: row?.TLE_LINE0 ?? null,
        tle_line1: row?.TLE_LINE1 ?? null,
        tle_line2: row?.TLE_LINE2 ?? null,
      },
    }];
  });
};
