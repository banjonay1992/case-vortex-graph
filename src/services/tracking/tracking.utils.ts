export const parseFiniteNumber = (value: unknown) => {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : null;
};

export const parseOptionalIsoTime = (value: unknown) => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

export const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const normalizeSnapshotTime = (rawSnapshot: unknown) => {
  if (rawSnapshot instanceof Date) {
    return Number.isFinite(rawSnapshot.getTime()) ? rawSnapshot.toISOString() : null;
  }
  const text = typeof rawSnapshot === 'string' ? rawSnapshot.trim() : '';
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text;
};

export const addSecondsToIso = (isoTimestamp: string, seconds: number) => {
  const parsedMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsedMs)) return isoTimestamp;
  return new Date(parsedMs + (seconds * 1000)).toISOString();
};

export const wrapLongitude = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && value > 0 ? 180 : wrapped;
};

export const buildBoundingBox = (lat: number, lon: number, radiusKm: number) => {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / Math.max(8, 111.32 * Math.cos((lat * Math.PI) / 180));
  const minLat = Math.max(-90, lat - latDelta);
  const maxLat = Math.min(90, lat + latDelta);
  const minLon = wrapLongitude(lon - lonDelta);
  const maxLon = wrapLongitude(lon + lonDelta);
  return {
    minLat,
    maxLat,
    minLon,
    maxLon,
    wraps: minLon > maxLon,
  };
};

export const computeBearingDeg = (fromLat: number, fromLon: number, toLat: number, toLon: number) => {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const lambda = ((toLon - fromLon) * Math.PI) / 180;
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
};

export const absoluteBearingDeg = (fromLat: number, fromLon: number, toLat: number, toLon: number) => {
  const value = computeBearingDeg(fromLat, fromLon, toLat, toLon);
  return ((value % 360) + 360) % 360;
};

export const relativeBearingDeg = (bearingDeg: number, headingDeg: number | null) => {
  if (!Number.isFinite(headingDeg ?? NaN)) return null;
  return ((((bearingDeg - (headingDeg as number)) % 360) + 540) % 360) - 180;
};
