import { describe, expect, it } from 'vitest';

import { buildAdsbLolHistoricalReplayPreparation } from '../../src/caseGraph/adsbLolHistoricalReplayPreparation';

const MIB = 1024 * 1024;
const digest = (character: string) => character.repeat(64);
const repository = 'https://github.com/adsblol/globe_history_2026';
const asset = (date: string) => {
  const tag = `v${date.replace(/-/g, '.')}-planes-readsb-prod-0`;
  return `${repository}/releases/download/${tag}/${tag}.tar`;
};
const index = {
  year: 2026,
  preferredReleasesSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/PREFERRED_RELEASES.txt',
  preferredReleasesBody: [asset('2026-07-20'), asset('2026-07-21')].join('\n'),
  releasesCatalogueSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/RELEASES.md',
  releasesCatalogueBody: [
    `- 2026-07-20 [planes-readsb-prod-0 (200 MiB)](${repository}/releases/tag/v2026.07.20-planes-readsb-prod-0#assets)`,
    `- 2026-07-21 [planes-readsb-prod-0 (100 MiB)](${repository}/releases/tag/v2026.07.21-planes-readsb-prod-0#assets)`,
  ].join('\n'),
  fetchedAt: '2026-07-25T00:00:00.000Z',
};

describe('ADSB.lol replay recovery preparation', () => {
  it('selects the highest-yield day and emits an executable replay-bound plan', () => {
    const result = buildAdsbLolHistoricalReplayPreparation({
      candidates: [
        { id: 'c', eventTimestamp: '2026-07-21T03:00:00.000Z', latitude: 51, longitude: -1 },
        { id: 'a', eventTimestamp: '2026-07-20T01:00:00.000Z', latitude: 40, longitude: -74 },
        { id: 'b', eventTimestamp: '2026-07-21T02:00:00.000Z', latitude: 52, longitude: 0 },
      ],
      indexes: [index],
      snapshotAt: '2026-07-25T00:30:00.000Z',
      candidateQuerySha256: digest('a'),
      checkedAt: '2026-07-25T01:00:00.000Z',
      plannedAt: '2026-07-25T02:00:00.000Z',
      maximumBatchDownloadBytes: 200 * MIB,
    });
    expect(result.accounting).toMatchObject({
      inputCandidateCount: 3,
      recoverableCandidateCount: 3,
      selectedCandidateCount: 2,
      selectedReleaseDate: '2026-07-21',
      selectedAdvertisedDownloadBytes: 100 * MIB,
    });
    expect(result.plan).not.toHaveProperty('publication');
    expect(result.plan.budget.maximumDownloadBytes).toBe(200 * MIB);
    expect(result.plan.replayDataset).toMatchObject({
      sourceTable: 'uap_sightings',
      candidateCount: 2,
    });
    expect(result.bundle.targets.map(({ address }) => address)).toEqual([
      'sighting:b',
      'sighting:c',
    ]);
  });

  it('refuses duplicate candidates and a budget that selects no full day', () => {
    const candidate = {
      id: 'a', eventTimestamp: '2026-07-20T01:00:00.000Z', latitude: 40, longitude: -74,
    };
    const base = {
      candidates: [candidate], indexes: [index], snapshotAt: '2026-07-25T00:30:00.000Z',
      candidateQuerySha256: digest('a'), checkedAt: '2026-07-25T01:00:00.000Z',
      plannedAt: '2026-07-25T02:00:00.000Z', maximumBatchDownloadBytes: 200 * MIB,
    };
    expect(() => buildAdsbLolHistoricalReplayPreparation({
      ...base, candidates: [candidate, candidate],
    })).toThrow('adsb_lol_replay_preparation_candidates_invalid');
    expect(() => buildAdsbLolHistoricalReplayPreparation({
      ...base, maximumBatchDownloadBytes: 99 * MIB,
    })).toThrow('adsb_lol_replay_preparation_budget_selects_no_day');
    expect(() => buildAdsbLolHistoricalReplayPreparation({
      ...base, candidates: [{ ...candidate, eventTimestamp: 'not-a-date' }],
    })).toThrow('adsb_lol_replay_preparation_candidate_invalid');
    expect(() => buildAdsbLolHistoricalReplayPreparation({
      ...base, snapshotAt: 'not-a-date',
    })).toThrow('adsb_lol_replay_preparation_snapshot_invalid');
  });
});
