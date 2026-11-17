import {
  Body,
  DefineStar,
  Equator,
  Horizon,
  Illumination,
  KM_PER_AU,
  Observer,
} from 'astronomy-engine';
import type { TrackingContextObject } from '../../shared/apiContracts';
import { relativeBearingDeg } from './tracking.utils';

export const ASTRONOMY_ENGINE_CONTEXT_PROVIDER = 'astronomy-engine-local' as const;
export const ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION = 'astronomy-engine-2.1.19' as const;
export const ASTRONOMY_ENGINE_CONTEXT_ACCURACY_DEG = 1 / 60;

const SOLAR_SYSTEM_BODIES = Object.freeze([
  { body: Body.Sun, key: 'sun', label: 'Sun' },
  { body: Body.Moon, key: 'moon', label: 'Moon' },
  { body: Body.Venus, key: 'venus', label: 'Venus' },
  { body: Body.Mars, key: 'mars', label: 'Mars' },
  { body: Body.Jupiter, key: 'jupiter', label: 'Jupiter' },
  { body: Body.Saturn, key: 'saturn', label: 'Saturn' },
] as const);

// J2000 catalogue coordinates for eight bright naked-eye stars. Astronomy
// Engine exposes eight user-defined star slots; defining them once lets the
// same topocentric/precession pipeline used for the planets place these stars
// correctly for the observer and timestamp.
const BRIGHT_STARS = Object.freeze([
  { body: Body.Star1, key: 'sirius', label: 'Sirius', raHours: 6.75248, decDeg: -16.7161, distanceLy: 8.6 },
  { body: Body.Star2, key: 'canopus', label: 'Canopus', raHours: 6.3992, decDeg: -52.6957, distanceLy: 310 },
  { body: Body.Star3, key: 'arcturus', label: 'Arcturus', raHours: 14.261, decDeg: 19.1824, distanceLy: 36.7 },
  { body: Body.Star4, key: 'vega', label: 'Vega', raHours: 18.6156, decDeg: 38.7837, distanceLy: 25 },
  { body: Body.Star5, key: 'capella', label: 'Capella', raHours: 5.2782, decDeg: 45.998, distanceLy: 42.9 },
  { body: Body.Star6, key: 'rigel', label: 'Rigel', raHours: 5.2423, decDeg: -8.2016, distanceLy: 860 },
  { body: Body.Star7, key: 'procyon', label: 'Procyon', raHours: 7.655, decDeg: 5.225, distanceLy: 11.46 },
  { body: Body.Star8, key: 'betelgeuse', label: 'Betelgeuse', raHours: 5.9195, decDeg: 7.4071, distanceLy: 642.5 },
] as const);

for (const star of BRIGHT_STARS) {
  DefineStar(star.body, star.raHours, star.decDeg, star.distanceLy);
}

const rounded = (value: number, digits: number) => Number(value.toFixed(digits));

export const buildAstronomyEngineContext = (params: {
  lat: number;
  lon: number;
  altitudeM: number | null;
  capturedAtIso: string;
  headingDeg: number | null;
}): TrackingContextObject[] => {
  const capturedAt = new Date(params.capturedAtIso);
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new Error('astronomy_engine_context_timestamp_invalid');
  }
  const observer = new Observer(params.lat, params.lon, params.altitudeM ?? 0);

  const solarSystem = SOLAR_SYSTEM_BODIES.map(({ body, key, label }) => {
    const equatorial = Equator(body, capturedAt, observer, true, true);
    const horizontal = Horizon(capturedAt, observer, equatorial.ra, equatorial.dec);
    const illumination = Illumination(body, capturedAt);
    const bearingDeg = rounded(horizontal.azimuth, 3);

    return {
      object_type: 'astronomy' as const,
      object_source: ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
      object_key: key,
      label,
      kind: key,
      bearing_deg: bearingDeg,
      relative_bearing_deg: relativeBearingDeg(bearingDeg, params.headingDeg),
      elevation_deg: rounded(horizontal.altitude, 3),
      distance_km: rounded(equatorial.dist * KM_PER_AU, 3),
      visible: horizontal.altitude > 0,
      illumination_fraction: rounded(illumination.phase_fraction, 6),
      ephemeris_accuracy_deg: ASTRONOMY_ENGINE_CONTEXT_ACCURACY_DEG,
      model_id: ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
      model_version: ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION,
      calculation_method: 'topocentric_equator_horizon',
      aberration_correction: true,
      atmospheric_refraction: 'none',
      calculated_at: capturedAt.toISOString(),
    };
  });

  const stars = BRIGHT_STARS.map(({ body, key, label, distanceLy }) => {
    const equatorial = Equator(body, capturedAt, observer, true, true);
    const horizontal = Horizon(capturedAt, observer, equatorial.ra, equatorial.dec);
    const bearingDeg = rounded(horizontal.azimuth, 3);
    return {
      object_type: 'astronomy' as const,
      object_source: ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
      object_key: key,
      label,
      kind: 'star',
      bearing_deg: bearingDeg,
      relative_bearing_deg: relativeBearingDeg(bearingDeg, params.headingDeg),
      elevation_deg: rounded(horizontal.altitude, 3),
      distance_km: rounded(distanceLy * 9.4607304725808e12, 3),
      visible: horizontal.altitude > 0,
      ephemeris_accuracy_deg: ASTRONOMY_ENGINE_CONTEXT_ACCURACY_DEG,
      model_id: ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
      model_version: ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION,
      calculation_method: 'j2000_star_topocentric_equator_horizon',
      aberration_correction: true,
      atmospheric_refraction: 'none',
      calculated_at: capturedAt.toISOString(),
    };
  });

  return [...solarSystem, ...stars];
};
