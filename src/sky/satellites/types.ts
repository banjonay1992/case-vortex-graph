import type { TrackingContextObject, TrackingSourceCoverage } from '../../shared/apiContracts';

export type SatelliteProvider =
  | 'space_track_gp_history'
  | 'space_track_gp'
  | 'satnogs_db'
  | 'celestrak_gp'
  | 'celestrak_tle'
  | 'legacy_archive'
  | 'local_cache';

export type SatelliteSourceFormat = 'tle' | 'gp_json' | 'omm_json' | 'legacy_text';

export type SatelliteOrbitClass = 'leo' | 'meo' | 'geo' | 'heo' | 'unknown';

export type SatelliteElementSnapshotInput = {
  noradId: number;
  objectName: string | null;
  sourceObjectId?: string | null;
  provider: SatelliteProvider;
  sourceFormat: SatelliteSourceFormat;
  orbitClass: SatelliteOrbitClass;
  epoch: string;
  archivedAt?: string | null;
  sourceGroups: string[];
  tleLine1?: string | null;
  tleLine2?: string | null;
  rawPayload?: Record<string, unknown>;
  parsedPayload?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
};

export type SatelliteElementSnapshotRecord = {
  id: string;
  noradId: number;
  objectName: string | null;
  sourceObjectId: string | null;
  provider: SatelliteProvider;
  sourceFormat: SatelliteSourceFormat;
  orbitClass: SatelliteOrbitClass;
  epoch: string;
  archivedAt: string | null;
  ingestedAt: string;
  sourceGroups: string[];
  tleLine1: string | null;
  tleLine2: string | null;
  rawPayload: Record<string, unknown>;
  parsedPayload: Record<string, unknown>;
  sourceMetadata: Record<string, unknown>;
};

export type SatelliteObserver = {
  lat: number;
  lon: number;
  altitudeM: number | null;
  headingDeg: number | null;
};

export type SatellitePropagationState = {
  object: TrackingContextObject;
  snapshot: SatelliteElementSnapshotRecord;
  snapshotAgeDays: number | null;
  staleSnapshot: boolean;
};

export type SatelliteSelectionResult = {
  snapshots: SatelliteElementSnapshotRecord[];
  coverage: TrackingSourceCoverage;
  selectedAtIso: string | null;
};

export type SatellitePositionsQuery = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  wraps: boolean;
  limit: number;
  groups: string[];
  timeIso: string;
};

export type SatellitePositionsItem = {
  norad_id: number | null;
  name: string;
  latitude: number;
  longitude: number;
  altitude_km: number;
  velocity_km_s: number | null;
};

export type SatellitePositionsResult = {
  time: string;
  groups: string[];
  count: number;
  items: SatellitePositionsItem[];
  coverage: TrackingSourceCoverage;
  source: 'canonical_snapshots' | 'none';
  snapshotAgeSeconds: number | null;
  snapshotFreshnessStatus: 'fresh' | 'stale' | 'unknown';
  snapshotFreshnessMaxAgeSeconds: number;
};

export type SatellitePassCandidate = {
  norad_id: number | null;
  name: string;
  closest_time: string;
  time_offset_seconds: number;
  max_elevation_deg: number;
  azimuth_deg: number;
  min_range_km: number;
  distance_km: number | null;
  sat_lat: number | null;
  sat_lon: number | null;
  sunlit: boolean | null;
  tle_epoch: string | null;
  tle_age_days: number | null;
  provider?: SatelliteProvider;
  source_format?: SatelliteSourceFormat;
  orbit_class?: SatelliteOrbitClass;
  archive_time?: string | null;
  track?: Array<[number, number]>;
};

export type SatellitePassesQuery = {
  lat: number;
  lon: number;
  altitudeM: number | null;
  headingDeg: number | null;
  groups: string[];
  timeIso: string;
  windowMinutes: number;
  stepSeconds: number;
  minElevationDeg: number;
  maxMatches: number;
  maxSnapshotAgeDays: number;
  includeTrack: boolean;
};

export type SatellitePassesResult = {
  time: string;
  window_minutes: number;
  step_seconds: number;
  min_elevation_deg: number;
  include_track: boolean;
  max_tle_age_days: number;
  groups: string[];
  analyzed: number;
  excluded_due_to_tle_age: number;
  matched: number;
  matches: SatellitePassCandidate[];
  coverage: TrackingSourceCoverage;
  source: 'canonical_snapshots' | 'none';
};
