import { createHash } from 'node:crypto';

import type { ContextualProviderPublicationSighting } from './aircraftWeatherProviderRecords';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const ADSB_LOL_HISTORICAL_RELEASE_PLAN_VERSION =
  'adsb-lol-historical-release-plan-v1' as const;

const MIB = 1024 * 1024;
const MAX_INDEX_BYTES = 2 * MIB;
const MAX_SIGHTINGS = 1_000_000;
const MAX_ASSET_PARTS = 26;
const MAX_INDEX_AGE_MS = 7 * 86_400_000;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left.localeCompare(right);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const iso = (value: unknown, code: string) => {
  const source = String(value);
  if (!/(?:z|[+-]\d{2}:\d{2})$/i.test(source)) fail(code);
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
};

const normalizePublication = (publication: CaseGraphResearchPublicationBinding) => {
  if (!UUID.test(publication.publicationId) || !SHA256.test(publication.manifestSha256)) {
    fail('adsb_lol_release_plan_publication_invalid');
  }
  return structuredClone(publication);
};

export type AdsbLolHistoricalReplayDatasetBinding = {
  bindingType: 'sighting_replay_dataset';
  sourceTable: 'uap_sightings';
  snapshotAt: string;
  candidateQuerySha256: string;
  sightingSetSha256: string;
  candidateCount: number;
};

const normalizeReplayDataset = (binding: AdsbLolHistoricalReplayDatasetBinding) => {
  if (binding?.bindingType !== 'sighting_replay_dataset'
    || binding.sourceTable !== 'uap_sightings'
    || iso(binding.snapshotAt, 'adsb_lol_release_plan_replay_binding_invalid') !== binding.snapshotAt
    || !SHA256.test(binding.candidateQuerySha256)
    || !SHA256.test(binding.sightingSetSha256)
    || !Number.isSafeInteger(binding.candidateCount)
    || binding.candidateCount < 1
    || binding.candidateCount > MAX_SIGHTINGS) {
    fail('adsb_lol_release_plan_replay_binding_invalid');
  }
  return structuredClone(binding);
};

export type AdsbLolHistoricalIndexInput = {
  year: number;
  preferredReleasesSourceUrl: string;
  preferredReleasesBody: string;
  releasesCatalogueSourceUrl: string;
  releasesCatalogueBody: string;
  fetchedAt: string;
};

export type AdsbLolHistoricalPreferredRelease = {
  date: string;
  year: number;
  environment: 'prod' | 'staging' | 'mlatonly' | 'test';
  tag: string;
  advertisedMiB: number;
  advertisedBytes: number;
  assetLayout: 'unsplit' | 'split' | 'mixed';
  assetUrls: string[];
  releasePageUrl: string;
  releaseDigest: string;
};

export type AdsbLolHistoricalIndex = {
  year: number;
  preferredReleasesSourceUrl: string;
  preferredReleasesSha256: string;
  releasesCatalogueSourceUrl: string;
  releasesCatalogueSha256: string;
  fetchedAt: string;
  releases: AdsbLolHistoricalPreferredRelease[];
  indexDigest: string;
};

type AdsbLolHistoricalReleasePlanCore = {
  recordType: 'adsb_lol_historical_release_plan';
  schemaVersion: typeof ADSB_LOL_HISTORICAL_RELEASE_PLAN_VERSION;
  plannedAt: string;
  checkedAt: string;
  indexBindings: Array<{
    year: number;
    preferredReleasesSourceUrl: string;
    preferredReleasesSha256: string;
    releasesCatalogueSourceUrl: string;
    releasesCatalogueSha256: string;
    fetchedAt: string;
    indexDigest: string;
  }>;
  releases: Array<AdsbLolHistoricalPreferredRelease & { addresses: string[] }>;
  excluded: Array<{
    address: string;
    reason:
      | 'sighting_time_missing'
      | 'outside_adsb_lol_history_period'
      | 'future_dated'
      | 'release_index_missing'
      | 'preferred_release_missing';
  }>;
  accounting: {
    inputAddressCount: number;
    plannedAddressCount: number;
    excludedAddressCount: number;
    uniqueReleaseDayCount: number;
    assetPartCount: number;
    advertisedDownloadBytes: number;
  };
  budget: {
    maximumDownloadBytes: number;
    advertisedDownloadBytes: number;
    remainingBytes: number;
    exceededByBytes: number;
    executableWithinAdvertisedBudget: boolean;
    exactAssetBytePreflightRequired: true;
  };
  limitations: string[];
  planDigest: string;
};

export type AdsbLolHistoricalReleasePlan = AdsbLolHistoricalReleasePlanCore & (
  | { publication: CaseGraphResearchPublicationBinding; replayDataset?: never }
  | { publication?: never; replayDataset: AdsbLolHistoricalReplayDatasetBinding }
);

const expectedSourceUrl = (year: number, filename: 'PREFERRED_RELEASES.txt' | 'RELEASES.md') => (
  `https://raw.githubusercontent.com/adsblol/globe_history_${year}/refs/heads/main/${filename}`
);

const assetPattern = (year: number) => new RegExp(
  `^https://github\\.com/adsblol/globe_history_${year}/releases/download/`
  + `(v(${year - 1}|${year}|${year + 1})\\.(\\d{2})\\.(\\d{2})-planes-readsb-(prod|staging|mlatonly|test)-[01](?:tmp)?)/`
  + `\\1\\.tar(?:\\.a([a-z]))?$`,
);

const parseCatalogue = (input: AdsbLolHistoricalIndexInput) => {
  const byTag = new Map<string, { date: string; advertisedMiB: number; releasePageUrl: string }>();
  for (const rawLine of input.releasesCatalogueBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('- ')) continue;
    if (!/\[planes-readsb-(?:prod|staging|mlatonly|test)-[01](?:tmp)? /.test(line)) continue;
    const date = line.slice(2, 12);
    if (!DATE.test(date)
      || ![input.year - 1, input.year, input.year + 1].includes(Number(date.slice(0, 4)))) {
      fail('adsb_lol_release_catalogue_invalid');
    }
    const matches = [...line.matchAll(
      /\[planes-readsb-(prod|staging|mlatonly|test)-[01](?:tmp)? \((\d+) M(?:i)?B\)\]\((https:\/\/github\.com\/adsblol\/globe_history_(\d{4})\/releases\/tag\/(v(\d{4})\.(\d{2})\.(\d{2})-planes-readsb-\1-[01](?:tmp)?)#assets)\)/g,
    )];
    if (matches.length < 1 || matches.length > 8) fail('adsb_lol_release_catalogue_invalid');
    for (const match of matches) {
      const advertisedMiB = Number(match[2]);
      const repositoryYear = Number(match[4]);
      const tag = match[5];
      const tagDate = `${match[6]}-${match[7]}-${match[8]}`;
      if (!Number.isSafeInteger(advertisedMiB) || advertisedMiB < 0
        || advertisedMiB > 100_000 || repositoryYear !== input.year || tagDate !== date
        || byTag.has(tag)) {
        fail('adsb_lol_release_catalogue_invalid');
      }
      byTag.set(tag, {
        date,
        advertisedMiB,
        releasePageUrl: match[3].slice(0, -'#assets'.length),
      });
    }
  }
  if (!byTag.size) fail('adsb_lol_release_catalogue_invalid');
  return byTag;
};

export const decodeAdsbLolHistoricalIndex = (
  input: AdsbLolHistoricalIndexInput,
  checkedAtInput: string,
): AdsbLolHistoricalIndex => {
  if (!Number.isSafeInteger(input.year) || input.year < 2023 || input.year > 2100
    || input.preferredReleasesSourceUrl !== expectedSourceUrl(input.year, 'PREFERRED_RELEASES.txt')
    || input.releasesCatalogueSourceUrl !== expectedSourceUrl(input.year, 'RELEASES.md')
    || Buffer.byteLength(input.preferredReleasesBody, 'utf8') < 1
    || Buffer.byteLength(input.preferredReleasesBody, 'utf8') > MAX_INDEX_BYTES
    || Buffer.byteLength(input.releasesCatalogueBody, 'utf8') < 1
    || Buffer.byteLength(input.releasesCatalogueBody, 'utf8') > MAX_INDEX_BYTES) {
    fail('adsb_lol_release_index_invalid');
  }
  const checkedAt = iso(checkedAtInput, 'adsb_lol_release_index_time_invalid');
  const fetchedAt = iso(input.fetchedAt, 'adsb_lol_release_index_time_invalid');
  const age = Date.parse(checkedAt) - Date.parse(fetchedAt);
  if (age < 0 || age > MAX_INDEX_AGE_MS) fail('adsb_lol_release_index_stale');
  const catalogue = parseCatalogue(input);
  const releases: AdsbLolHistoricalPreferredRelease[] = [];
  const seenDates = new Set<string>();
  for (const rawLine of input.preferredReleasesBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const assetUrls = line.split(',');
    if (assetUrls.length < 1 || assetUrls.length > MAX_ASSET_PARTS) {
      fail('adsb_lol_preferred_release_invalid');
    }
    const pattern = assetPattern(input.year);
    const parsed = assetUrls.map((url) => {
      const match = url.match(pattern);
      if (!match) fail('adsb_lol_preferred_release_invalid');
      const groups = match as RegExpMatchArray;
      return {
        tag: groups[1],
        date: `${groups[2]}-${groups[3]}-${groups[4]}`,
        environment: groups[5] as 'prod' | 'staging' | 'mlatonly' | 'test',
        suffix: groups[6] || null,
      };
    });
    const first = parsed[0];
    const unsplitCount = parsed.filter(({ suffix }) => suffix === null).length;
    const split = parsed.filter(({ suffix }) => suffix !== null);
    if (parsed.some(({ tag, date, environment }) => (
      tag !== first.tag || date !== first.date || environment !== first.environment
    )) || unsplitCount > 1
      || split.some(({ suffix }, index) => suffix !== String.fromCharCode(97 + index))
      || seenDates.has(first.date)) {
      fail('adsb_lol_preferred_release_invalid');
    }
    const advertised = catalogue.get(first.tag);
    if (!advertised || advertised.date !== first.date || advertised.advertisedMiB < 1) {
      fail('adsb_lol_preferred_release_catalogue_mismatch');
    }
    const catalogueEntry = advertised as NonNullable<typeof advertised>;
    seenDates.add(first.date);
    const core = {
      date: first.date,
      year: input.year,
      environment: first.environment,
      tag: first.tag,
      advertisedMiB: catalogueEntry.advertisedMiB,
      advertisedBytes: catalogueEntry.advertisedMiB * MIB,
      assetLayout: unsplitCount && split.length ? 'mixed' as const
        : unsplitCount ? 'unsplit' as const : 'split' as const,
      assetUrls,
      releasePageUrl: catalogueEntry.releasePageUrl,
    };
    releases.push({ ...core, releaseDigest: relationshipInputSha256(core) });
  }
  releases.sort((left, right) => compare(left.date, right.date));
  if (!releases.length) fail('adsb_lol_preferred_release_invalid');
  const core = {
    year: input.year,
    preferredReleasesSourceUrl: input.preferredReleasesSourceUrl,
    preferredReleasesSha256: sha256(input.preferredReleasesBody),
    releasesCatalogueSourceUrl: input.releasesCatalogueSourceUrl,
    releasesCatalogueSha256: sha256(input.releasesCatalogueBody),
    fetchedAt,
    releases,
  };
  return { ...core, indexDigest: relationshipInputSha256(core) };
};

const planCore = (value: Omit<AdsbLolHistoricalReleasePlanCore, 'planDigest'> & (
  | { publication: CaseGraphResearchPublicationBinding; replayDataset?: never }
  | { publication?: never; replayDataset: AdsbLolHistoricalReplayDatasetBinding }
)) => value;

export const planAdsbLolHistoricalReleases = (params: {
  publication?: CaseGraphResearchPublicationBinding;
  replayDataset?: AdsbLolHistoricalReplayDatasetBinding;
  sightings: ContextualProviderPublicationSighting[];
  indexes: AdsbLolHistoricalIndexInput[];
  checkedAt: string;
  plannedAt: string;
  maximumDownloadBytes: number;
}): AdsbLolHistoricalReleasePlan => {
  if (!params.sightings.length || params.sightings.length > MAX_SIGHTINGS
    || new Set(params.sightings.map(({ address }) => address)).size !== params.sightings.length
    || !Number.isSafeInteger(params.maximumDownloadBytes) || params.maximumDownloadBytes < 1) {
    fail('adsb_lol_release_plan_input_invalid');
  }
  if (Boolean(params.publication) === Boolean(params.replayDataset)) {
    fail('adsb_lol_release_plan_binding_invalid');
  }
  const binding = params.publication
    ? { publication: normalizePublication(params.publication) }
    : { replayDataset: normalizeReplayDataset(params.replayDataset!) };
  const checkedAt = iso(params.checkedAt, 'adsb_lol_release_plan_time_invalid');
  const plannedAt = iso(params.plannedAt, 'adsb_lol_release_plan_time_invalid');
  if (Date.parse(plannedAt) < Date.parse(checkedAt)) fail('adsb_lol_release_plan_time_invalid');
  const indexes = params.indexes.map((input) => decodeAdsbLolHistoricalIndex(input, checkedAt));
  if (new Set(indexes.map(({ year }) => year)).size !== indexes.length) {
    fail('adsb_lol_release_plan_index_duplicate');
  }
  indexes.sort((left, right) => left.year - right.year);
  const releasesByDate = new Map<string, AdsbLolHistoricalPreferredRelease>();
  for (const index of indexes) {
    for (const release of index.releases) {
      const existing = releasesByDate.get(release.date);
      if (!existing || release.year === Number(release.date.slice(0, 4))) {
        releasesByDate.set(release.date, release);
      } else if (existing.year !== Number(existing.date.slice(0, 4))) {
        fail('adsb_lol_release_plan_date_overlap');
      }
    }
  }
  const years = new Set(indexes.map(({ year }) => year));
  const grouped = new Map<string, string[]>();
  const excluded: AdsbLolHistoricalReleasePlan['excluded'] = [];
  for (const sighting of [...params.sightings].sort((left, right) => compare(left.address, right.address))) {
    if (!sighting.eventTimestamp) {
      excluded.push({ address: sighting.address, reason: 'sighting_time_missing' });
      continue;
    }
    const eventAt = iso(sighting.eventTimestamp, 'adsb_lol_release_plan_sighting_invalid');
    const date = eventAt.slice(0, 10);
    const year = Number(date.slice(0, 4));
    if (year < 2023) {
      excluded.push({ address: sighting.address, reason: 'outside_adsb_lol_history_period' });
      continue;
    }
    if (Date.parse(eventAt) > Date.parse(checkedAt)) {
      excluded.push({ address: sighting.address, reason: 'future_dated' });
      continue;
    }
    if (!years.has(year)) {
      excluded.push({ address: sighting.address, reason: 'release_index_missing' });
      continue;
    }
    if (!releasesByDate.has(date)) {
      excluded.push({ address: sighting.address, reason: 'preferred_release_missing' });
      continue;
    }
    const addresses = grouped.get(date);
    if (addresses) addresses.push(sighting.address);
    else grouped.set(date, [sighting.address]);
  }
  const releases = [...grouped].sort(([left], [right]) => compare(left, right)).map(([date, addresses]) => ({
    ...releasesByDate.get(date)!,
    addresses: addresses.sort(compare),
  }));
  const plannedAddressCount = releases.reduce((sum, release) => sum + release.addresses.length, 0);
  const advertisedDownloadBytes = releases.reduce((sum, release) => sum + release.advertisedBytes, 0);
  if (!Number.isSafeInteger(advertisedDownloadBytes)
    || plannedAddressCount + excluded.length !== params.sightings.length) {
    fail('adsb_lol_release_plan_accounting_invalid');
  }
  const accounting = {
    inputAddressCount: params.sightings.length,
    plannedAddressCount,
    excludedAddressCount: excluded.length,
    uniqueReleaseDayCount: releases.length,
    assetPartCount: releases.reduce((sum, release) => sum + release.assetUrls.length, 0),
    advertisedDownloadBytes,
  };
  const budget = {
    maximumDownloadBytes: params.maximumDownloadBytes,
    advertisedDownloadBytes,
    remainingBytes: Math.max(0, params.maximumDownloadBytes - advertisedDownloadBytes),
    exceededByBytes: Math.max(0, advertisedDownloadBytes - params.maximumDownloadBytes),
    executableWithinAdvertisedBudget: advertisedDownloadBytes <= params.maximumDownloadBytes,
    exactAssetBytePreflightRequired: true as const,
  };
  const core = {
    recordType: 'adsb_lol_historical_release_plan' as const,
    schemaVersion: ADSB_LOL_HISTORICAL_RELEASE_PLAN_VERSION,
    ...binding,
    plannedAt,
    checkedAt,
    indexBindings: indexes.map(({ releases: _releases, ...binding }) => binding),
    releases,
    excluded,
    accounting,
    budget,
    limitations: [
      'ADSB.lol historical releases begin in 2023; older sightings cannot be checked by this source.',
      'Each preferred release is a complete global UTC-day tar split into multi-gigabyte parts; this plan downloads no asset.',
      'Advertised MiB is planning evidence only. Every asset must pass an exact Content-Length, redirect-host and byte-budget preflight before transfer.',
      'Absence from ADSB.lol cannot rule out aircraft because receiver, blocking, outage, MLAT and source-coverage gaps remain.',
      'The plan grants no provider call, archive write, publication, activation or deployment authority.',
    ],
  };
  return {
    ...core,
    planDigest: relationshipInputSha256(planCore(core)),
  } as AdsbLolHistoricalReleasePlan;
};

export const verifyAdsbLolHistoricalReleasePlan = (
  value: AdsbLolHistoricalReleasePlan,
): AdsbLolHistoricalReleasePlan => {
  const { planDigest, ...core } = structuredClone(value);
  const checkedAt = iso(core.checkedAt, 'adsb_lol_release_plan_invalid');
  const plannedAt = iso(core.plannedAt, 'adsb_lol_release_plan_invalid');
  const indexYears = core.indexBindings.map((binding) => binding.year);
  const releaseAddresses = core.releases.flatMap(({ addresses }) => addresses);
  const excludedAddresses = core.excluded.map(({ address }) => address);
  const addressSet = new Set([...releaseAddresses, ...excludedAddresses]);
  const releasesStructurallyValid = core.releases.every((release, index) => {
    return DATE.test(release.date)
      && [release.year - 1, release.year, release.year + 1]
        .includes(Number(release.date.slice(0, 4)))
      && indexYears.includes(release.year)
      && (index === 0 || core.releases[index - 1].date < release.date);
  }) && core.releases.every((release) => {
    const { addresses, releaseDigest, ...releaseCore } = release;
    const pattern = assetPattern(release.year);
    return addresses.length > 0
      && addresses.every((address, index) => (
        typeof address === 'string' && address.length > 0
        && (index === 0 || addresses[index - 1] < address)
      ))
      && release.assetUrls.length >= 1
      && release.assetUrls.length <= MAX_ASSET_PARTS
      && (() => {
        const parsedAssets = release.assetUrls.map((url) => {
          const match = url.match(pattern);
          if (!match
            || match[1] !== release.tag
            || `${match[2]}-${match[3]}-${match[4]}` !== release.date
            || match[5] !== release.environment) return null;
          return { suffix: match[6] || null };
        });
        const unsplitCount = parsedAssets.filter((asset) => asset?.suffix === null).length;
        const split = parsedAssets.filter(
          (asset): asset is { suffix: string } => Boolean(asset?.suffix),
        );
        const layout = unsplitCount && split.length ? 'mixed'
          : unsplitCount ? 'unsplit' : 'split';
        return !parsedAssets.includes(null)
          && unsplitCount <= 1
          && split.every(({ suffix }, index) => suffix === String.fromCharCode(97 + index))
          && release.assetLayout === layout;
      })()
      && release.assetUrls.every((url) => {
        const match = url.match(pattern);
        return Boolean(match);
      })
      && release.releasePageUrl
        === `https://github.com/adsblol/globe_history_${release.year}/releases/tag/${release.tag}`
      && Number.isSafeInteger(release.advertisedMiB)
      && release.advertisedMiB >= 1
      && release.advertisedBytes === release.advertisedMiB * MIB
      && releaseDigest === relationshipInputSha256(releaseCore);
  });
  const indexesValid = core.indexBindings.every((binding, index) => (
    Number.isSafeInteger(binding.year) && binding.year >= 2023 && binding.year <= 2100
    && (index === 0 || core.indexBindings[index - 1].year < binding.year)
    && binding.preferredReleasesSourceUrl
      === expectedSourceUrl(binding.year, 'PREFERRED_RELEASES.txt')
    && binding.releasesCatalogueSourceUrl === expectedSourceUrl(binding.year, 'RELEASES.md')
    && SHA256.test(binding.preferredReleasesSha256)
    && SHA256.test(binding.releasesCatalogueSha256)
    && SHA256.test(binding.indexDigest)
    && iso(binding.fetchedAt, 'adsb_lol_release_plan_invalid') === binding.fetchedAt
    && Date.parse(checkedAt) - Date.parse(binding.fetchedAt) >= 0
    && Date.parse(checkedAt) - Date.parse(binding.fetchedAt) <= MAX_INDEX_AGE_MS
  ));
  const budgetValid = Number.isSafeInteger(core.budget.maximumDownloadBytes)
    && core.budget.maximumDownloadBytes >= 1
    && core.budget.advertisedDownloadBytes === core.accounting.advertisedDownloadBytes
    && core.budget.remainingBytes
      === Math.max(0, core.budget.maximumDownloadBytes - core.budget.advertisedDownloadBytes)
    && core.budget.exceededByBytes
      === Math.max(0, core.budget.advertisedDownloadBytes - core.budget.maximumDownloadBytes)
    && core.budget.executableWithinAdvertisedBudget
      === (core.budget.advertisedDownloadBytes <= core.budget.maximumDownloadBytes)
    && core.budget.exactAssetBytePreflightRequired === true;
  const bindingValid = 'publication' in core
    ? !('replayDataset' in core)
      && normalizePublication(core.publication).publicationId === core.publication.publicationId
    : 'replayDataset' in core
      && normalizeReplayDataset(core.replayDataset).sightingSetSha256
        === core.replayDataset.sightingSetSha256;
  if (core.recordType !== 'adsb_lol_historical_release_plan'
    || core.schemaVersion !== ADSB_LOL_HISTORICAL_RELEASE_PLAN_VERSION
    || !bindingValid
    || checkedAt !== core.checkedAt || plannedAt !== core.plannedAt
    || Date.parse(plannedAt) < Date.parse(checkedAt)
    || !indexesValid || !releasesStructurallyValid || !budgetValid
    || !Array.isArray(core.limitations) || !core.limitations.length
    || core.limitations.some((limitation) => typeof limitation !== 'string' || !limitation)
    || planDigest !== relationshipInputSha256(planCore(core))
    || core.accounting.plannedAddressCount
      !== core.releases.reduce((sum, release) => sum + release.addresses.length, 0)
    || core.accounting.excludedAddressCount !== core.excluded.length
    || core.accounting.inputAddressCount
      !== core.accounting.plannedAddressCount + core.accounting.excludedAddressCount
    || core.accounting.uniqueReleaseDayCount !== core.releases.length
    || core.accounting.assetPartCount
      !== core.releases.reduce((sum, release) => sum + release.assetUrls.length, 0)
    || core.accounting.advertisedDownloadBytes
      !== core.releases.reduce((sum, release) => sum + release.advertisedBytes, 0)
    || new Set(releaseAddresses).size !== core.accounting.plannedAddressCount
    || new Set(excludedAddresses).size !== core.accounting.excludedAddressCount
    || addressSet.size !== core.accounting.inputAddressCount
    || core.excluded.some(({ address }, index) => (
      typeof address !== 'string' || !address
      || (index > 0 && core.excluded[index - 1].address >= address)
    ))) {
    fail('adsb_lol_release_plan_invalid');
  }
  return { ...core, planDigest };
};
