import {
  buildNoaaNceiUsObservationUrl,
  type NoaaNceiUsObservationQuery,
} from './freeContextualProviderObservations';
import {
  verifySatnogsContextualCohortForReview,
} from './satnogsDirectionHumanReview';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_CALIBRATION_ACQUISITION_PLAN_VERSION =
  'case-vortex-contextual-calibration-acquisition-plan-v1' as const;

const DAY_MS = 86_400_000;
const NOAA_COVERAGE_START_MS = Date.parse('2005-01-01T00:00:00.000Z');
const ADSB_HISTORY_START_MS = Date.parse('2023-01-01T00:00:00.000Z');
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value as string;
};

const US_REGIONS = [
  { south: 24, north: 50, west: -125, east: -66 },
  { south: 51, north: 72, west: -180, east: -129 },
  { south: 18, north: 23, west: -161, east: -154 },
  { south: 17, north: 20, west: -68, east: -64 },
  { south: 13, north: 22, west: 143, east: 146 },
  { south: -15, north: -10, west: -172, east: -168 },
] as const;

const insideUsRegion = (latitude: number, longitude: number) => US_REGIONS.some((region) => (
  latitude >= region.south && latitude <= region.north
  && longitude >= region.west && longitude <= region.east
));

const cellBounds = (latitude: number, longitude: number) => {
  const cellSouth = Math.floor(latitude / 2) * 2;
  const cellWest = Math.floor(longitude / 2) * 2;
  return {
    south: Math.max(-90, cellSouth - 0.75),
    north: Math.min(90, cellSouth + 2.75),
    west: Math.max(-180, cellWest - 0.75),
    east: Math.min(180, cellWest + 2.75),
  };
};

type ExclusionReason =
  | 'outside_noaa_us_geography'
  | 'outside_noaa_lcdv2_period'
  | 'outside_adsb_lol_history_period'
  | 'future_dated';

export type ContextualCalibrationAcquisitionPlan = {
  recordType: 'contextual_calibration_acquisition_plan';
  schemaVersion: typeof CONTEXTUAL_CALIBRATION_ACQUISITION_PLAN_VERSION;
  checkedAt: string;
  plannedAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    universeArchiveSetSha256: string;
    cohortDigest: string;
    candidateSetSha256: string;
    cohortSubjectCount: number;
    cohortAddressSetSha256: string;
  };
  noaa: {
    dataset: 'local-climatological-data-v2';
    windows: Array<{
      ordinal: number;
      windowId: string;
      query: NoaaNceiUsObservationQuery;
      sourceUrl: string;
      addresses: string[];
      windowDigest: string;
    }>;
    excluded: Array<{ address: string; reason: ExclusionReason }>;
    accounting: {
      eligibleAddressCount: number;
      excludedAddressCount: number;
      windowCount: number;
      estimatedProviderCalls: number;
    };
  };
  adsbLol: {
    historyStart: '2023-01-01';
    requiredIndexes: Array<{
      year: number;
      preferredReleasesSourceUrl: string;
      releasesCatalogueSourceUrl: string;
    }>;
    days: Array<{
      ordinal: number;
      date: string;
      addresses: string[];
      dayDigest: string;
    }>;
    excluded: Array<{ address: string; reason: ExclusionReason }>;
    accounting: {
      eligibleAddressCount: number;
      excludedAddressCount: number;
      uniqueDayCount: number;
      requiredIndexYearCount: number;
      estimatedIndexMetadataCalls: number;
      authorizedAssetDownloads: 0;
    };
  };
  limitations: string[];
  guarantees: {
    calibrationOnly: true;
    publicationBindingCreated: 0;
    providerCalls: 0;
    providerBytesDownloaded: 0;
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    LunaCalls: 0;
    humanAdjudicationsCreated: 0;
    contextualEdgesCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  planDigest: string;
};

export const buildContextualCalibrationAcquisitionPlan = (params: {
  cohort: unknown;
  checkedAt: string;
  plannedAt: string;
}): ContextualCalibrationAcquisitionPlan => {
  const cohort = verifySatnogsContextualCohortForReview(params.cohort);
  const checkedAt = timestamp(
    params.checkedAt,
    'contextual_calibration_acquisition_time_invalid',
  );
  const plannedAt = timestamp(
    params.plannedAt,
    'contextual_calibration_acquisition_time_invalid',
  );
  if (Date.parse(plannedAt) < Date.parse(checkedAt)) {
    invalid('contextual_calibration_acquisition_time_order_invalid');
  }
  const candidates = [...cohort.candidates].sort(
    (left, right) => lexical(left.address, right.address),
  );
  if (!candidates.length
    || new Set(candidates.map(({ address }) => address)).size !== candidates.length) {
    invalid('contextual_calibration_acquisition_cohort_addresses_invalid');
  }
  const checkedMs = Date.parse(checkedAt);
  const noaaGroups = new Map<string, {
    query: NoaaNceiUsObservationQuery;
    addresses: string[];
  }>();
  const noaaExcluded: ContextualCalibrationAcquisitionPlan['noaa']['excluded'] = [];
  const adsbGroups = new Map<string, string[]>();
  const adsbExcluded: ContextualCalibrationAcquisitionPlan['adsbLol']['excluded'] = [];

  for (const candidate of candidates) {
    const eventMs = Date.parse(candidate.eventTimestamp);
    if (eventMs > checkedMs) {
      noaaExcluded.push({ address: candidate.address, reason: 'future_dated' });
      adsbExcluded.push({ address: candidate.address, reason: 'future_dated' });
      continue;
    }
    if (eventMs < NOAA_COVERAGE_START_MS) {
      noaaExcluded.push({
        address: candidate.address,
        reason: 'outside_noaa_lcdv2_period',
      });
    } else if (!insideUsRegion(candidate.lat, candidate.lon)) {
      noaaExcluded.push({
        address: candidate.address,
        reason: 'outside_noaa_us_geography',
      });
    } else {
      const dayStartMs = Math.floor(eventMs / DAY_MS) * DAY_MS;
      const bounds = cellBounds(candidate.lat, candidate.lon);
      const query: NoaaNceiUsObservationQuery = {
        start: new Date(dayStartMs).toISOString(),
        end: new Date(dayStartMs + DAY_MS).toISOString(),
        ...bounds,
      };
      const key = relationshipInputSha256(query);
      const existing = noaaGroups.get(key);
      if (existing) existing.addresses.push(candidate.address);
      else noaaGroups.set(key, { query, addresses: [candidate.address] });
    }

    if (eventMs < ADSB_HISTORY_START_MS) {
      adsbExcluded.push({
        address: candidate.address,
        reason: 'outside_adsb_lol_history_period',
      });
    } else {
      const date = candidate.eventTimestamp.slice(0, 10);
      const existing = adsbGroups.get(date);
      if (existing) existing.push(candidate.address);
      else adsbGroups.set(date, [candidate.address]);
    }
  }

  const noaaWindows = [...noaaGroups.values()]
    .sort((left, right) => (
      lexical(left.query.start, right.query.start)
      || left.query.south - right.query.south
      || left.query.west - right.query.west
    ))
    .map((group, ordinal) => {
      const addresses = [...group.addresses].sort(lexical);
      const core = {
        ordinal,
        windowId: `noaa-calibration-window:${relationshipInputSha256({
          query: group.query,
          addresses,
        })}`,
        query: group.query,
        sourceUrl: buildNoaaNceiUsObservationUrl(group.query),
        addresses,
      };
      return { ...core, windowDigest: relationshipInputSha256(core) };
    });
  const adsbDays = [...adsbGroups]
    .sort(([left], [right]) => lexical(left, right))
    .map(([date, groupedAddresses], ordinal) => {
      const addresses = [...groupedAddresses].sort(lexical);
      const core = { ordinal, date, addresses };
      return { ...core, dayDigest: relationshipInputSha256(core) };
    });
  noaaExcluded.sort((left, right) => lexical(left.address, right.address));
  adsbExcluded.sort((left, right) => lexical(left.address, right.address));
  const indexYears = [...new Set(adsbDays.map(({ date }) => Number(date.slice(0, 4))))]
    .sort((left, right) => left - right);
  const requiredIndexes = indexYears.map((year) => ({
    year,
    preferredReleasesSourceUrl:
      `https://raw.githubusercontent.com/adsblol/globe_history_${year}/refs/heads/main/PREFERRED_RELEASES.txt`,
    releasesCatalogueSourceUrl:
      `https://raw.githubusercontent.com/adsblol/globe_history_${year}/refs/heads/main/RELEASES.md`,
  }));
  const noaaEligible = noaaWindows.reduce(
    (sum, window) => sum + window.addresses.length,
    0,
  );
  const adsbEligible = adsbDays.reduce((sum, day) => sum + day.addresses.length, 0);
  if (noaaEligible + noaaExcluded.length !== candidates.length
    || adsbEligible + adsbExcluded.length !== candidates.length) {
    invalid('contextual_calibration_acquisition_accounting_invalid');
  }
  const addresses = candidates.map(({ address }) => address);
  const body: Omit<ContextualCalibrationAcquisitionPlan, 'planDigest'> = {
    recordType: 'contextual_calibration_acquisition_plan',
    schemaVersion: CONTEXTUAL_CALIBRATION_ACQUISITION_PLAN_VERSION,
    checkedAt,
    plannedAt,
    binding: {
      corpusVersion: cohort.binding.corpusVersion,
      snapshotId: cohort.binding.snapshotId,
      universeArchiveSetSha256: cohort.binding.universeArchiveSetSha256,
      cohortDigest: cohort.cohortDigest,
      candidateSetSha256: cohort.candidateSetSha256,
      cohortSubjectCount: candidates.length,
      cohortAddressSetSha256: relationshipInputSha256(addresses),
    },
    noaa: {
      dataset: 'local-climatological-data-v2',
      windows: noaaWindows,
      excluded: noaaExcluded,
      accounting: {
        eligibleAddressCount: noaaEligible,
        excludedAddressCount: noaaExcluded.length,
        windowCount: noaaWindows.length,
        estimatedProviderCalls: noaaWindows.length,
      },
    },
    adsbLol: {
      historyStart: '2023-01-01',
      requiredIndexes,
      days: adsbDays,
      excluded: adsbExcluded,
      accounting: {
        eligibleAddressCount: adsbEligible,
        excludedAddressCount: adsbExcluded.length,
        uniqueDayCount: adsbDays.length,
        requiredIndexYearCount: requiredIndexes.length,
        estimatedIndexMetadataCalls: requiredIndexes.length * 2,
        authorizedAssetDownloads: 0,
      },
    },
    limitations: [
      'This plan is bound to a calibration cohort, not an active or inactive publication.',
      'NOAA LCDv2 is primarily available from 2005 onward and U.S. station coverage may still be absent inside an eligible window.',
      'ADSB.lol history begins in 2023; preferred-release metadata must be verified before any exact asset can be selected.',
      'Aircraft checked-no-match results cannot rule out aircraft because receiver, blocking, outage and MLAT gaps remain.',
      'The plan authorizes no provider request, metadata probe, asset download, database/storage operation, publication mutation or deployment.',
    ],
    guarantees: {
      calibrationOnly: true,
      publicationBindingCreated: 0,
      providerCalls: 0,
      providerBytesDownloaded: 0,
      databaseWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      LunaCalls: 0,
      humanAdjudicationsCreated: 0,
      contextualEdgesCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, planDigest: relationshipInputSha256(body) };
};

export const verifyContextualCalibrationAcquisitionPlan = (params: {
  cohort: unknown;
  plan: unknown;
}) => {
  if (!isObject(params.plan)
    || params.plan.recordType !== 'contextual_calibration_acquisition_plan'
    || params.plan.schemaVersion !== CONTEXTUAL_CALIBRATION_ACQUISITION_PLAN_VERSION
    || typeof params.plan.checkedAt !== 'string'
    || typeof params.plan.plannedAt !== 'string') {
    invalid('contextual_calibration_acquisition_plan_invalid');
  }
  const plan = params.plan as unknown as ContextualCalibrationAcquisitionPlan;
  const rebuilt = buildContextualCalibrationAcquisitionPlan({
    cohort: params.cohort,
    checkedAt: plan.checkedAt,
    plannedAt: plan.plannedAt,
  });
  if (canonicalizeRelationshipInput(rebuilt) !== canonicalizeRelationshipInput(plan)) {
    invalid('contextual_calibration_acquisition_plan_mismatch');
  }
  return rebuilt;
};
