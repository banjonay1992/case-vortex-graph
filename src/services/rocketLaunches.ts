type RocketLaunchBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  wraps: boolean;
};

export type RocketLaunchEvent = {
  id: string;
  slug: string | null;
  name: string;
  status: string;
  provider: string | null;
  vehicle: string | null;
  mission: string | null;
  padName: string | null;
  locationName: string | null;
  countryCode: string | null;
  lat: number;
  lon: number;
  net: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  imageUrl: string | null;
  infoUrl: string | null;
  webcastUrl: string | null;
  upcoming: boolean;
  recent: boolean;
  live: boolean;
  source: 'rocketlaunch_live';
};

export type LoadRocketLaunchEventsParams = {
  bounds: RocketLaunchBounds;
  limit: number;
  now?: Date;
};

type RocketLaunchLivePayload = {
  result?: unknown[];
};

type CacheEntry = {
  cachedAtMs: number;
  items: RocketLaunchEvent[];
};

type LaunchSiteCoords = {
  lat: number;
  lon: number;
};

const ROCKET_LIVE_BASE = process.env.ROCKETS_ROCKETLIVE_BASE_URL || 'https://fdo.rocketlaunch.live/json/launches';
const ROCKETS_CACHE_TTL_MS = Math.max(60_000, Number(process.env.ROCKETS_CACHE_TTL_MS || 300_000) || 300_000);
const ROCKETS_FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.ROCKETS_FETCH_TIMEOUT_MS || 8_000) || 8_000);
const ROCKETS_UPCOMING_LIMIT = Math.max(5, Math.min(100, Number(process.env.ROCKETS_UPCOMING_LIMIT || 40) || 40));
const ROCKETS_PREVIOUS_LIMIT = Math.max(1, Math.min(50, Number(process.env.ROCKETS_PREVIOUS_LIMIT || 12) || 12));
const ROCKETS_PREVIOUS_LOOKBACK_MS = Math.max(3_600_000, Number(process.env.ROCKETS_PREVIOUS_LOOKBACK_MS || 72 * 60 * 60 * 1000) || 72 * 60 * 60 * 1000);
const ROCKETS_LIVE_WINDOW_MS = Math.max(15 * 60_000, Number(process.env.ROCKETS_LIVE_WINDOW_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);

let cache: CacheEntry | null = null;

const KNOWN_LAUNCH_SITE_COORDS: Record<string, LaunchSiteCoords> = {
  'mid-atlantic-regional-spaceport-wallops-island': { lat: 37.8337, lon: -75.4880 },
  'vandenberg-sfb': { lat: 34.7420, lon: -120.5724 },
  'rocket-lab-launch-complex-mahia-peninsula': { lat: -39.2615, lon: 177.8649 },
  'xichang-satellite-launch-center': { lat: 28.2460, lon: 102.0266 },
  'plesetsk-cosmodrome': { lat: 62.9271, lon: 40.5777 },
  'cape-canaveral': { lat: 28.3922, lon: -80.6077 },
  'cape-canaveral-space-force-station': { lat: 28.4889, lon: -80.5778 },
  'kennedy-space-center': { lat: 28.5729, lon: -80.6490 },
  'baikonur-cosmodrome': { lat: 45.9647, lon: 63.3050 },
  'guiana-space-centre': { lat: 5.2390, lon: -52.7680 },
  'satish-dhawan-space-centre': { lat: 13.7199, lon: 80.2304 },
  'taiyuan-satellite-launch-center': { lat: 38.8491, lon: 111.6085 },
  'jiuquan-satellite-launch-center': { lat: 40.9606, lon: 100.2983 },
  'wenchang-space-launch-site': { lat: 19.6145, lon: 110.9516 },
  'tanegashima-space-center': { lat: 30.4016, lon: 130.9756 },
  'rocket-lab-launch-complex-1': { lat: -39.2615, lon: 177.8649 },
};

const normalizeLongitude = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && value > 0 ? 180 : wrapped;
};

const inBounds = (lat: number, lon: number, bounds: RocketLaunchBounds) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < bounds.minLat || lat > bounds.maxLat) return false;
  const normalizedLon = normalizeLongitude(lon);
  if (!bounds.wraps) return normalizedLon >= bounds.minLon && normalizedLon <= bounds.maxLon;
  return normalizedLon >= bounds.minLon || normalizedLon <= bounds.maxLon;
};

const toIso = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const parseNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeLaunchSiteKey = (value: string | null) => {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const resolveLaunchSiteCoords = (
  pad: Record<string, unknown> | null,
  location: Record<string, unknown> | null,
) => {
  const directLat = parseNumber(pad?.latitude);
  const directLon = parseNumber(pad?.longitude);
  if (directLat != null && directLon != null) {
    return { lat: directLat, lon: directLon };
  }

  const candidateKeys = [
    typeof location?.slug === 'string' ? location.slug : null,
    normalizeLaunchSiteKey(typeof location?.name === 'string' ? location.name : null),
  ].filter((value): value is string => Boolean(value));

  for (const key of candidateKeys) {
    const match = KNOWN_LAUNCH_SITE_COORDS[key];
    if (match) return match;
  }

  return null;
};

const parseRocketLiveItem = (raw: unknown, nowMs: number, recentMode: boolean): RocketLaunchEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const pad = item.pad && typeof item.pad === 'object' ? item.pad as Record<string, unknown> : null;
  const location = pad?.location && typeof pad.location === 'object' ? pad.location as Record<string, unknown> : null;
  const coords = resolveLaunchSiteCoords(pad, location);
  if (!coords) return null;

  const t0 = toIso(item.t0);
  const winOpen = toIso(item.win_open);
  const winClose = toIso(item.win_close);
  const bestTimeIso = t0 || winOpen || winClose;
  const bestTimeMs = bestTimeIso ? Date.parse(bestTimeIso) : NaN;
  const deltaMs = Number.isFinite(bestTimeMs) ? bestTimeMs - nowMs : null;
  const providerObj = item.provider && typeof item.provider === 'object' ? item.provider as Record<string, unknown> : null;
  const vehicleObj = item.vehicle && typeof item.vehicle === 'object' ? item.vehicle as Record<string, unknown> : null;
  const missions = Array.isArray(item.missions) ? item.missions : [];
  const firstMission = missions[0] && typeof missions[0] === 'object' ? missions[0] as Record<string, unknown> : null;
  const media = Array.isArray(item.media) ? item.media : [];
  const firstMedia = media.find((entry) => entry && typeof entry === 'object') as Record<string, unknown> | undefined;
  const upcoming = !recentMode && (deltaMs == null || deltaMs >= -2 * 60 * 60 * 1000);
  const recent = recentMode || (deltaMs != null && deltaMs < 0 && Math.abs(deltaMs) <= ROCKETS_PREVIOUS_LOOKBACK_MS);
  const statusCode = parseNumber(item.result);
  const live = (deltaMs != null && Math.abs(deltaMs) <= ROCKETS_LIVE_WINDOW_MS) || statusCode === -1;

  return {
    id: String(item.id || item.slug || item.name || `${bestTimeIso || coords.lat}:${coords.lon}`),
    slug: typeof item.slug === 'string' ? item.slug : null,
    name: String(item.name || firstMission?.name || 'Rocket launch').trim() || 'Rocket launch',
    status: statusCode === 1 ? 'Success' : statusCode === 0 ? 'Failure' : statusCode === -1 ? 'Pending' : 'Scheduled',
    provider: typeof providerObj?.name === 'string' ? providerObj.name : null,
    vehicle: typeof vehicleObj?.name === 'string' ? vehicleObj.name : null,
    mission: typeof firstMission?.name === 'string'
      ? firstMission.name
      : typeof item.mission_description === 'string'
        ? item.mission_description
        : null,
    padName: typeof pad?.name === 'string' ? pad.name : null,
    locationName: typeof location?.name === 'string' ? location.name : null,
    countryCode: typeof location?.country === 'string' ? location.country : null,
    lat: coords.lat,
    lon: normalizeLongitude(coords.lon),
    net: t0,
    windowStart: winOpen,
    windowEnd: winClose,
    imageUrl: typeof firstMedia?.thumbnail_url === 'string'
      ? String(firstMedia.thumbnail_url)
      : typeof firstMedia?.url === 'string'
        ? String(firstMedia.url)
        : null,
    infoUrl: typeof item.quicktext === 'string' && item.quicktext.includes('http')
      ? String(item.quicktext.match(/https?:\/\/\S+/)?.[0] || '')
      : null,
    webcastUrl: typeof firstMedia?.url === 'string' ? String(firstMedia.url) : null,
    upcoming,
    recent,
    live,
    source: 'rocketlaunch_live',
  };
};

const fetchJson = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROCKETS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'UAPFilesLive/1.0 (+https://uapfileslive.com)',
      },
    });
    if (!response.ok) {
      throw new Error(`rocket_launches_http_${response.status}`);
    }
    return await response.json() as RocketLaunchLivePayload;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchRocketLiveFeed = async (path: 'next' | 'past', limit: number) => {
  const url = `${ROCKET_LIVE_BASE}/${path}/${limit}`;
  const payload = await fetchJson(url);
  return Array.isArray(payload.result) ? payload.result : [];
};

const buildMergedLaunchFeed = async (now: Date) => {
  const [upcomingRaw, previousRaw] = await Promise.all([
    fetchRocketLiveFeed('next', ROCKETS_UPCOMING_LIMIT),
    fetchRocketLiveFeed('past', ROCKETS_PREVIOUS_LIMIT),
  ]);
  const nowMs = now.getTime();
  const merged = [
    ...upcomingRaw.map((item) => parseRocketLiveItem(item, nowMs, false)),
    ...previousRaw.map((item) => parseRocketLiveItem(item, nowMs, true)),
  ].filter((item): item is RocketLaunchEvent => Boolean(item));

  const deduped = new Map<string, RocketLaunchEvent>();
  for (const item of merged) {
    if (!deduped.has(item.id)) deduped.set(item.id, item);
  }

  return Array.from(deduped.values())
    .filter((item) => item.upcoming || item.recent)
    .sort((a, b) => {
      const aMs = Date.parse(a.net || a.windowStart || a.windowEnd || '') || 0;
      const bMs = Date.parse(b.net || b.windowStart || b.windowEnd || '') || 0;
      return aMs - bMs;
    });
};

const loadCachedLaunchFeed = async (now: Date) => {
  if (cache && (now.getTime() - cache.cachedAtMs) <= ROCKETS_CACHE_TTL_MS) {
    return cache.items;
  }
  const items = await buildMergedLaunchFeed(now);
  cache = { cachedAtMs: now.getTime(), items };
  return items;
};

export const clearRocketLaunchesCache = () => {
  cache = null;
};

export const loadRocketLaunchEvents = async ({
  bounds,
  limit,
  now = new Date(),
}: LoadRocketLaunchEventsParams) => {
  const items = await loadCachedLaunchFeed(now);
  const filtered = items.filter((item) => inBounds(item.lat, item.lon, bounds)).slice(0, limit);
  return {
    generatedAt: now.toISOString(),
    count: filtered.length,
    items: filtered,
  };
};
