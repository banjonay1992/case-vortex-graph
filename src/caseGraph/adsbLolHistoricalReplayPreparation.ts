import type { ContextualProviderPublicationSighting } from './aircraftWeatherProviderRecords';
import {
  planAdsbLolHistoricalReleases,
  type AdsbLolHistoricalIndexInput,
} from './adsbLolHistoricalReleasePlan';
import { selectAdsbLolHistoricalRecoveryBatch } from './adsbLolHistoricalRecoveryBatch';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const ADSB_LOL_HISTORICAL_REPLAY_PREPARATION_VERSION =
  'adsb-lol-historical-replay-preparation-v1' as const;

export type AdsbLolHistoricalReplayCandidate = {
  id: string;
  eventTimestamp: string;
  latitude: number;
  longitude: number;
};

const toIsoTimestamp = (value: string, errorCode: string) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(errorCode);
  return new Date(timestamp).toISOString();
};

export const buildAdsbLolHistoricalReplayPreparation = (params: {
  candidates: AdsbLolHistoricalReplayCandidate[];
  indexes: AdsbLolHistoricalIndexInput[];
  snapshotAt: string;
  candidateQuerySha256: string;
  checkedAt: string;
  plannedAt: string;
  maximumBatchDownloadBytes: number;
  temporalWindowSeconds?: number;
  radiusKm?: number;
  maximumCandidates?: number;
}) => {
  const ordered = [...params.candidates].sort((left, right) => left.id.localeCompare(right.id));
  if (!ordered.length || new Set(ordered.map(({ id }) => id)).size !== ordered.length) {
    throw new Error('adsb_lol_replay_preparation_candidates_invalid');
  }
  const sightings: ContextualProviderPublicationSighting[] = ordered.map((candidate) => {
    if (!candidate.id) throw new Error('adsb_lol_replay_preparation_candidate_invalid');
    const core = {
      address: `sighting:${candidate.id}`,
      eventTimestamp: toIsoTimestamp(
        candidate.eventTimestamp,
        'adsb_lol_replay_preparation_candidate_invalid',
      ),
      latitude: Number(candidate.latitude),
      longitude: Number(candidate.longitude),
    };
    if (!Number.isFinite(core.latitude) || core.latitude < -90 || core.latitude > 90
      || !Number.isFinite(core.longitude) || core.longitude < -180 || core.longitude > 180) {
      throw new Error('adsb_lol_replay_preparation_candidate_invalid');
    }
    return { ...core, nodeDigest: relationshipInputSha256(core) };
  });
  const sightingSetSha256 = relationshipInputSha256(sightings);
  const replayDataset = {
    bindingType: 'sighting_replay_dataset' as const,
    sourceTable: 'uap_sightings' as const,
    snapshotAt: toIsoTimestamp(
      params.snapshotAt,
      'adsb_lol_replay_preparation_snapshot_invalid',
    ),
    candidateQuerySha256: params.candidateQuerySha256,
    sightingSetSha256,
    candidateCount: sightings.length,
  };
  const masterPlan = planAdsbLolHistoricalReleases({
    replayDataset,
    sightings,
    indexes: params.indexes,
    checkedAt: params.checkedAt,
    plannedAt: params.plannedAt,
    maximumDownloadBytes: Number.MAX_SAFE_INTEGER,
  });
  const batch = selectAdsbLolHistoricalRecoveryBatch(
    masterPlan,
    params.maximumBatchDownloadBytes,
  );
  const selected = batch.selected[0];
  if (!selected) throw new Error('adsb_lol_replay_preparation_budget_selects_no_day');
  const selectedAddresses = new Set(selected.addresses);
  const selectedSightings = sightings.filter(({ address }) => selectedAddresses.has(address));
  const plan = planAdsbLolHistoricalReleases({
    replayDataset: {
      ...replayDataset,
      sightingSetSha256: relationshipInputSha256(selectedSightings),
      candidateCount: selectedSightings.length,
    },
    sightings: selectedSightings,
    indexes: params.indexes,
    checkedAt: params.checkedAt,
    plannedAt: params.plannedAt,
    // The catalogue size is only an estimate. Preserve the operator-approved
    // batch ceiling so the subsequent HEAD preflight can validate exact bytes
    // without rejecting a release whose asset is slightly larger than listed.
    maximumDownloadBytes: params.maximumBatchDownloadBytes,
  });
  const release = plan.releases[0];
  if (!release || release.date !== selected.date || plan.releases.length !== 1) {
    throw new Error('adsb_lol_replay_preparation_selection_invalid');
  }
  const byAddress = new Map(sightings.map((sighting) => [sighting.address, sighting]));
  const temporalWindowSeconds = params.temporalWindowSeconds ?? 900;
  const radiusKm = params.radiusKm ?? 250;
  const maximumCandidates = params.maximumCandidates ?? 20;
  const bundle = {
    releaseDate: release.date,
    targets: release.addresses.map((address) => {
      const sighting = byAddress.get(address)!;
      return {
        address,
        eventTimestamp: sighting.eventTimestamp!,
        latitude: sighting.latitude!,
        longitude: sighting.longitude!,
        temporalWindowSeconds,
        radiusKm,
        maximumCandidates,
      };
    }),
  };
  const core = {
    recordType: 'adsb_lol_historical_replay_preparation' as const,
    schemaVersion: ADSB_LOL_HISTORICAL_REPLAY_PREPARATION_VERSION,
    masterPlanDigest: masterPlan.planDigest,
    batchDigest: batch.batchDigest,
    plan,
    bundle,
    accounting: {
      inputCandidateCount: sightings.length,
      recoverableCandidateCount: masterPlan.accounting.plannedAddressCount,
      selectedCandidateCount: selectedSightings.length,
      selectedReleaseDate: release.date,
      selectedAdvertisedDownloadBytes: release.advertisedBytes,
      deferredCandidateCount: batch.accounting.deferredAddressCount,
    },
  };
  return { ...core, preparationDigest: relationshipInputSha256(core) };
};
