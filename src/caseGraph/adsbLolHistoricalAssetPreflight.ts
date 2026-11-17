import { relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  verifyAdsbLolHistoricalReleasePlan,
  type AdsbLolHistoricalReleasePlan,
} from './adsbLolHistoricalReleasePlan';

export const ADSB_LOL_HISTORICAL_ASSET_PREFLIGHT_VERSION =
  'adsb-lol-historical-asset-preflight-v1' as const;

const MAX_OBSERVATION_AGE_MS = 15 * 60 * 1000;
const MAX_PREFLIGHT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_REDIRECT_HOPS = 5;
const MAX_ASSET_BYTES = 8 * 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left.localeCompare(right);

const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== 'string') fail(code);
  const normalized = value as string;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) fail(code);
  return normalized;
};

const allowedRedirectUrl = (value: string, final: boolean) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (final) {
    return ['release-assets.githubusercontent.com', 'objects.githubusercontent.com']
      .includes(url.hostname);
  }
  return url.hostname === 'github.com'
    || ['release-assets.githubusercontent.com', 'objects.githubusercontent.com']
      .includes(url.hostname);
};

export type AdsbLolHistoricalAssetObservation = {
  requestedUrl: string;
  redirectChain: string[];
  finalUrl: string;
  contentLength: number;
  etag: string | null;
  lastModified: string | null;
  observedAt: string;
  observationDigest: string;
};

export type AdsbLolHistoricalAssetHeadResponse = {
  status: number;
  headers: {
    get: (name: string) => string | null;
  };
  body?: { cancel: () => Promise<void> } | null;
};

export type AdsbLolHistoricalAssetHeadFetch = (
  url: string,
  init: {
    method: 'HEAD';
    redirect: 'manual';
    signal?: AbortSignal;
    headers: { accept: 'application/octet-stream' };
  },
) => Promise<AdsbLolHistoricalAssetHeadResponse>;

type AdsbLolHistoricalAssetPreflightCore = {
  recordType: 'adsb_lol_historical_asset_preflight';
  schemaVersion: typeof ADSB_LOL_HISTORICAL_ASSET_PREFLIGHT_VERSION;
  releasePlanDigest: string;
  checkedAt: string;
  expiresAt: string;
  observations: AdsbLolHistoricalAssetObservation[];
  selectedReleases: Array<{
    date: string;
    tag: string;
    representation: 'unsplit' | 'split';
    assetUrls: string[];
    exactDownloadBytes: number;
    selectionDigest: string;
  }>;
  accounting: {
    plannedReleaseCount: number;
    probedAssetCount: number;
    selectedAssetCount: number;
    exactDownloadBytes: number;
    maximumDownloadBytes: number;
    remainingBytes: number;
    exceededByBytes: number;
    executableWithinExactBudget: boolean;
  };
  limitations: string[];
  preflightDigest: string;
};

export type AdsbLolHistoricalAssetPreflight = AdsbLolHistoricalAssetPreflightCore & (
  | { publication: NonNullable<AdsbLolHistoricalReleasePlan['publication']>; replayDataset?: never }
  | { publication?: never; replayDataset: NonNullable<AdsbLolHistoricalReleasePlan['replayDataset']> }
);

type ObservationInput = Omit<AdsbLolHistoricalAssetObservation, 'observationDigest'> & {
  observationDigest?: string;
};

const normalizeObservation = (
  value: ObservationInput,
  expectedUrl: string,
  checkedAt: string,
): AdsbLolHistoricalAssetObservation => {
  const observedAt = timestamp(value.observedAt, 'adsb_lol_asset_observation_time_invalid');
  const age = Date.parse(checkedAt) - Date.parse(observedAt);
  if (value.requestedUrl !== expectedUrl
    || !Array.isArray(value.redirectChain)
    || value.redirectChain.length < 2
    || value.redirectChain.length > MAX_REDIRECT_HOPS + 1
    || value.redirectChain[0] !== value.requestedUrl
    || value.redirectChain.at(-1) !== value.finalUrl
    || new Set(value.redirectChain).size !== value.redirectChain.length
    || value.redirectChain.some((url, index) => (
      typeof url !== 'string'
      || !allowedRedirectUrl(url, index === value.redirectChain.length - 1)
    ))
    || !allowedRedirectUrl(value.finalUrl, true)
    || !Number.isSafeInteger(value.contentLength)
    || value.contentLength < 1
    || value.contentLength > MAX_ASSET_BYTES
    || (value.etag !== null && (
      typeof value.etag !== 'string' || !value.etag || value.etag.length > 512
    ))
    || (value.lastModified !== null && (
      typeof value.lastModified !== 'string'
      || !Number.isFinite(Date.parse(value.lastModified))
      || value.lastModified.length > 128
    ))
    || age < 0
    || age > MAX_OBSERVATION_AGE_MS) {
    fail('adsb_lol_asset_observation_invalid');
  }
  const core = {
    requestedUrl: value.requestedUrl,
    redirectChain: [...value.redirectChain],
    finalUrl: value.finalUrl,
    contentLength: value.contentLength,
    etag: value.etag,
    lastModified: value.lastModified,
    observedAt,
  };
  const observationDigest = relationshipInputSha256(core);
  if (value.observationDigest && value.observationDigest !== observationDigest) {
    fail('adsb_lol_asset_observation_digest_invalid');
  }
  return { ...core, observationDigest };
};

export const probeAdsbLolHistoricalAsset = async (params: {
  assetUrl: string;
  observedAt: string;
  fetchHead: AdsbLolHistoricalAssetHeadFetch;
  signal?: AbortSignal;
}): Promise<AdsbLolHistoricalAssetObservation> => {
  if (!allowedRedirectUrl(params.assetUrl, false)
    || !params.assetUrl.startsWith('https://github.com/adsblol/globe_history_')) {
    fail('adsb_lol_asset_probe_url_invalid');
  }
  const redirectChain = [params.assetUrl];
  let currentUrl = params.assetUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await params.fetchHead(currentUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: params.signal,
      headers: { accept: 'application/octet-stream' },
    });
    if (response.body) await response.body.cancel();
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) fail('adsb_lol_asset_probe_redirect_invalid');
      let nextUrl = '';
      try {
        nextUrl = new URL(location as string, currentUrl).toString();
      } catch {
        fail('adsb_lol_asset_probe_redirect_invalid');
      }
      if (!allowedRedirectUrl(nextUrl, false)
        || redirectChain.includes(nextUrl)
        || hop === MAX_REDIRECT_HOPS) {
        fail('adsb_lol_asset_probe_redirect_invalid');
      }
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      continue;
    }
    if (response.status !== 200 || !allowedRedirectUrl(currentUrl, true)
      || redirectChain.length < 2) {
      fail('adsb_lol_asset_probe_response_invalid');
    }
    const rawContentLength = response.headers.get('content-length');
    if (!rawContentLength || !/^\d+$/u.test(rawContentLength)) {
      fail('adsb_lol_asset_probe_length_invalid');
    }
    const contentLength = Number(rawContentLength);
    const core = {
      requestedUrl: params.assetUrl,
      redirectChain,
      finalUrl: currentUrl,
      contentLength,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      observedAt: timestamp(params.observedAt, 'adsb_lol_asset_probe_time_invalid'),
    };
    return normalizeObservation(core, params.assetUrl, core.observedAt);
  }
  return fail('adsb_lol_asset_probe_redirect_invalid');
};

const selectAssetUrls = (
  release: AdsbLolHistoricalReleasePlan['releases'][number],
): { representation: 'unsplit' | 'split'; assetUrls: string[] } => {
  const unsplit = release.assetUrls.filter((url) => url.endsWith('.tar'));
  const split = release.assetUrls.filter((url) => /\.tar\.a[a-z]$/u.test(url));
  if (release.assetLayout === 'unsplit') {
    if (unsplit.length !== 1 || split.length) fail('adsb_lol_asset_preflight_plan_invalid');
    return { representation: 'unsplit', assetUrls: unsplit };
  }
  if (release.assetLayout === 'split') {
    if (!split.length || unsplit.length) fail('adsb_lol_asset_preflight_plan_invalid');
    return { representation: 'split', assetUrls: split };
  }
  if (unsplit.length !== 1 || !split.length) fail('adsb_lol_asset_preflight_plan_invalid');
  // A mixed preferred line exposes redundant representations. The contiguous
  // split set is selected so execution never concatenates it with the full tar.
  return { representation: 'split', assetUrls: split };
};

const preflightCore = (
  value: Omit<AdsbLolHistoricalAssetPreflightCore, 'preflightDigest'> & (
    | { publication: NonNullable<AdsbLolHistoricalReleasePlan['publication']>; replayDataset?: never }
    | { publication?: never; replayDataset: NonNullable<AdsbLolHistoricalReleasePlan['replayDataset']> }
  ),
) => value;

export const buildAdsbLolHistoricalAssetPreflight = (params: {
  releasePlan: AdsbLolHistoricalReleasePlan;
  observations: ObservationInput[];
  checkedAt: string;
  expiresAt: string;
}): AdsbLolHistoricalAssetPreflight => {
  const releasePlan = verifyAdsbLolHistoricalReleasePlan(params.releasePlan);
  if (!releasePlan.budget.executableWithinAdvertisedBudget) {
    fail('adsb_lol_asset_preflight_advertised_budget_exceeded');
  }
  const checkedAt = timestamp(params.checkedAt, 'adsb_lol_asset_preflight_time_invalid');
  const expiresAt = timestamp(params.expiresAt, 'adsb_lol_asset_preflight_time_invalid');
  const lifetime = Date.parse(expiresAt) - Date.parse(checkedAt);
  if (lifetime < 1 || lifetime > MAX_PREFLIGHT_LIFETIME_MS) {
    fail('adsb_lol_asset_preflight_time_invalid');
  }
  const expectedUrls = releasePlan.releases.flatMap(({ assetUrls }) => assetUrls).sort(compare);
  if (params.observations.length !== expectedUrls.length
    || new Set(params.observations.map(({ requestedUrl }) => requestedUrl)).size
      !== params.observations.length) {
    fail('adsb_lol_asset_preflight_observation_set_invalid');
  }
  const observationsByUrl = new Map(
    params.observations.map((observation) => [observation.requestedUrl, observation]),
  );
  const observations = expectedUrls.map((url) => {
    const observation = observationsByUrl.get(url);
    if (!observation) fail('adsb_lol_asset_preflight_observation_set_invalid');
    return normalizeObservation(observation as ObservationInput, url, checkedAt);
  });
  const normalizedByUrl = new Map(
    observations.map((observation) => [observation.requestedUrl, observation]),
  );
  const selectedReleases = releasePlan.releases.map((release) => {
    const selected = selectAssetUrls(release);
    const exactDownloadBytes = selected.assetUrls.reduce((sum, url) => {
      const observation = normalizedByUrl.get(url);
      if (!observation) fail('adsb_lol_asset_preflight_observation_set_invalid');
      return sum + (observation as AdsbLolHistoricalAssetObservation).contentLength;
    }, 0);
    if (!Number.isSafeInteger(exactDownloadBytes)) {
      fail('adsb_lol_asset_preflight_accounting_invalid');
    }
    const core = {
      date: release.date,
      tag: release.tag,
      representation: selected.representation,
      assetUrls: selected.assetUrls,
      exactDownloadBytes,
    };
    return { ...core, selectionDigest: relationshipInputSha256(core) };
  });
  const exactDownloadBytes = selectedReleases.reduce(
    (sum, release) => sum + release.exactDownloadBytes,
    0,
  );
  if (!Number.isSafeInteger(exactDownloadBytes)) {
    fail('adsb_lol_asset_preflight_accounting_invalid');
  }
  const maximumDownloadBytes = releasePlan.budget.maximumDownloadBytes;
  const accounting = {
    plannedReleaseCount: selectedReleases.length,
    probedAssetCount: observations.length,
    selectedAssetCount: selectedReleases.reduce(
      (sum, release) => sum + release.assetUrls.length,
      0,
    ),
    exactDownloadBytes,
    maximumDownloadBytes,
    remainingBytes: Math.max(0, maximumDownloadBytes - exactDownloadBytes),
    exceededByBytes: Math.max(0, exactDownloadBytes - maximumDownloadBytes),
    executableWithinExactBudget: exactDownloadBytes <= maximumDownloadBytes,
  };
  const binding = releasePlan.publication
    ? { publication: releasePlan.publication } as const
    : { replayDataset: releasePlan.replayDataset! } as const;
  const core = {
    recordType: 'adsb_lol_historical_asset_preflight' as const,
    schemaVersion: ADSB_LOL_HISTORICAL_ASSET_PREFLIGHT_VERSION,
    ...binding,
    releasePlanDigest: releasePlan.planDigest,
    checkedAt,
    expiresAt,
    observations,
    selectedReleases,
    accounting,
    limitations: [
      'This receipt records metadata probes only and contains no ADSB observation data.',
      'Signed release-asset URLs are short-lived and must be fetched only while this receipt is current.',
      'A successful byte preflight does not establish receiver coverage or identify an aircraft.',
      'Mixed preferred releases use only their contiguous split representation; the redundant unsplit tar is never concatenated.',
      'This receipt grants no archive download, storage write, publication, activation or deployment authority.',
    ],
  };
  return {
    ...core,
    preflightDigest: relationshipInputSha256(preflightCore(core)),
  } as AdsbLolHistoricalAssetPreflight;
};

export const verifyAdsbLolHistoricalAssetPreflight = (
  value: AdsbLolHistoricalAssetPreflight,
  releasePlan: AdsbLolHistoricalReleasePlan,
  checkedAtInput: string,
): AdsbLolHistoricalAssetPreflight => {
  const plan = verifyAdsbLolHistoricalReleasePlan(releasePlan);
  const checkedAt = timestamp(checkedAtInput, 'adsb_lol_asset_preflight_verification_time_invalid');
  const rebuilt = buildAdsbLolHistoricalAssetPreflight({
    releasePlan: plan,
    observations: value.observations,
    checkedAt: value.checkedAt,
    expiresAt: value.expiresAt,
  });
  if (value.releasePlanDigest !== plan.planDigest
    || Date.parse(checkedAt) < Date.parse(value.checkedAt)
    || Date.parse(checkedAt) >= Date.parse(value.expiresAt)
    || !SHA256.test(value.preflightDigest)
    || value.preflightDigest !== rebuilt.preflightDigest
    || JSON.stringify(value) !== JSON.stringify(rebuilt)) {
    fail('adsb_lol_asset_preflight_invalid');
  }
  return structuredClone(value);
};
