import {
  verifyAdsbLolHistoricalReleasePlan,
  type AdsbLolHistoricalReleasePlan,
} from './adsbLolHistoricalReleasePlan';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const ADSB_LOL_HISTORICAL_RECOVERY_BATCH_VERSION =
  'adsb-lol-historical-recovery-batch-v1' as const;

type PlannedRelease = AdsbLolHistoricalReleasePlan['releases'][number];

export type AdsbLolHistoricalRecoveryBatch = {
  recordType: 'adsb_lol_historical_recovery_batch';
  schemaVersion: typeof ADSB_LOL_HISTORICAL_RECOVERY_BATCH_VERSION;
  releasePlanDigest: string;
  maximumDownloadBytes: number;
  selected: PlannedRelease[];
  deferred: PlannedRelease[];
  accounting: {
    selectedDayCount: number;
    selectedAddressCount: number;
    selectedAdvertisedDownloadBytes: number;
    deferredDayCount: number;
    deferredAddressCount: number;
    deferredAdvertisedDownloadBytes: number;
    remainingDownloadBytes: number;
  };
  selectionPolicy: 'sightings_per_advertised_byte_then_count_then_date';
  limitations: string[];
  batchDigest: string;
};

const comparePriority = (left: PlannedRelease, right: PlannedRelease) => {
  const leftYield = left.addresses.length / left.advertisedBytes;
  const rightYield = right.addresses.length / right.advertisedBytes;
  return rightYield - leftYield
    || right.addresses.length - left.addresses.length
    || left.advertisedBytes - right.advertisedBytes
    || left.date.localeCompare(right.date)
    || left.tag.localeCompare(right.tag);
};

export const selectAdsbLolHistoricalRecoveryBatch = (
  planInput: AdsbLolHistoricalReleasePlan,
  maximumDownloadBytes: number,
): AdsbLolHistoricalRecoveryBatch => {
  if (!Number.isSafeInteger(maximumDownloadBytes) || maximumDownloadBytes < 1) {
    throw new Error('adsb_lol_recovery_batch_budget_invalid');
  }
  const plan = verifyAdsbLolHistoricalReleasePlan(planInput);
  const selected: PlannedRelease[] = [];
  const deferred: PlannedRelease[] = [];
  let selectedAdvertisedDownloadBytes = 0;

  for (const release of [...plan.releases].sort(comparePriority)) {
    if (release.advertisedBytes <= maximumDownloadBytes - selectedAdvertisedDownloadBytes) {
      selected.push(structuredClone(release));
      selectedAdvertisedDownloadBytes += release.advertisedBytes;
    } else {
      deferred.push(structuredClone(release));
    }
  }

  const accounting = {
    selectedDayCount: selected.length,
    selectedAddressCount: selected.reduce((sum, release) => sum + release.addresses.length, 0),
    selectedAdvertisedDownloadBytes,
    deferredDayCount: deferred.length,
    deferredAddressCount: deferred.reduce((sum, release) => sum + release.addresses.length, 0),
    deferredAdvertisedDownloadBytes: deferred.reduce(
      (sum, release) => sum + release.advertisedBytes,
      0,
    ),
    remainingDownloadBytes: maximumDownloadBytes - selectedAdvertisedDownloadBytes,
  };
  const core = {
    recordType: 'adsb_lol_historical_recovery_batch' as const,
    schemaVersion: ADSB_LOL_HISTORICAL_RECOVERY_BATCH_VERSION,
    releasePlanDigest: plan.planDigest,
    maximumDownloadBytes,
    selected,
    deferred,
    accounting,
    selectionPolicy: 'sightings_per_advertised_byte_then_count_then_date' as const,
    limitations: [
      'Selection is a deterministic yield-first queue, not proof that every selected sighting has nearby receiver coverage.',
      'Advertised bytes remain estimates; exact asset byte preflight is required before download.',
      'A full UTC-day release is indivisible for budgeting even when only one sighting needs that day.',
    ],
  };
  return { ...core, batchDigest: relationshipInputSha256(core) };
};
