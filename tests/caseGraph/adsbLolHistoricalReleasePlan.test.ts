import { describe, expect, it } from 'vitest';

import {
  decodeAdsbLolHistoricalIndex,
  planAdsbLolHistoricalReleases,
  verifyAdsbLolHistoricalReleasePlan,
  type AdsbLolHistoricalIndexInput,
} from '../../src/caseGraph/adsbLolHistoricalReleasePlan';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const MIB = 1024 * 1024;
const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'adsb-release-plan-v1',
  manifestSha256: digest('1'),
  snapshotId: 'snapshot-v1',
  graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1',
  relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'),
  relationshipModelId: 'model-v1',
  relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};

const tagUrl = (date: string, environment: 'prod' | 'staging' | 'mlatonly') => (
  `https://github.com/adsblol/globe_history_2026/releases/tag/`
  + `v${date.replace(/-/g, '.')}-planes-readsb-${environment}-0#assets`
);
const assetUrl = (
  date: string,
  environment: 'prod' | 'staging' | 'mlatonly',
  suffix?: string,
) => {
  const tag = `v${date.replace(/-/g, '.')}-planes-readsb-${environment}-0`;
  return `https://github.com/adsblol/globe_history_2026/releases/download/${tag}/${tag}.tar${suffix ? `.${suffix}` : ''}`;
};

const indexInput = (): AdsbLolHistoricalIndexInput => ({
  year: 2026,
  preferredReleasesSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/PREFERRED_RELEASES.txt',
  preferredReleasesBody: [
    [
      assetUrl('2026-07-20', 'prod', 'aa'),
      assetUrl('2026-07-20', 'prod', 'ab'),
    ].join(','),
    [
      assetUrl('2026-07-21', 'staging', 'aa'),
      assetUrl('2026-07-21', 'staging', 'ab'),
      assetUrl('2026-07-21', 'staging', 'ac'),
    ].join(','),
  ].join('\n'),
  releasesCatalogueSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/RELEASES.md',
  releasesCatalogueBody: [
    '# Releases',
    `- 2026-07-20 [planes-readsb-staging-0 (190 MiB)](${tagUrl('2026-07-20', 'staging')}) [planes-readsb-prod-0 (200 MB)](${tagUrl('2026-07-20', 'prod')})`,
    `- 2026-07-21 [planes-readsb-staging-0 (150 MiB)](${tagUrl('2026-07-21', 'staging')}) [planes-readsb-prod-0 (100 MiB)](${tagUrl('2026-07-21', 'prod')})`,
  ].join('\n'),
  fetchedAt: '2026-07-25T00:00:00.000Z',
});

const sightings = [
  {
    address: 'sighting:a',
    nodeDigest: digest('a'),
    eventTimestamp: '2026-07-20T12:00:00.000Z',
    latitude: 40,
    longitude: -74,
  },
  {
    address: 'sighting:b',
    nodeDigest: digest('b'),
    eventTimestamp: '2026-07-20T18:00:00.000Z',
    latitude: 35,
    longitude: -118,
  },
  {
    address: 'sighting:c',
    nodeDigest: digest('c'),
    eventTimestamp: '2026-07-21T18:00:00.000Z',
    latitude: 51,
    longitude: -1,
  },
  {
    address: 'sighting:missing-time',
    nodeDigest: digest('d'),
    eventTimestamp: null,
    latitude: 40,
    longitude: -74,
  },
  {
    address: 'sighting:old',
    nodeDigest: digest('e'),
    eventTimestamp: '1997-03-13T20:00:00.000Z',
    latitude: 33,
    longitude: -112,
  },
  {
    address: 'sighting:index-missing',
    nodeDigest: digest('f'),
    eventTimestamp: '2025-07-20T18:00:00.000Z',
    latitude: 40,
    longitude: -74,
  },
  {
    address: 'sighting:release-missing',
    nodeDigest: digest('7'),
    eventTimestamp: '2026-07-22T18:00:00.000Z',
    latitude: 40,
    longitude: -74,
  },
  {
    address: 'sighting:future',
    nodeDigest: digest('8'),
    eventTimestamp: '2026-07-26T18:00:00.000Z',
    latitude: 40,
    longitude: -74,
  },
];

const buildPlan = (maximumDownloadBytes = 500 * MIB) => planAdsbLolHistoricalReleases({
  publication,
  sightings,
  indexes: [indexInput()],
  checkedAt: '2026-07-25T01:00:00.000Z',
  plannedAt: '2026-07-25T02:00:00.000Z',
  maximumDownloadBytes,
});

describe('ADSB.lol historical preferred-release planning', () => {
  it('binds replay recovery to an exact sighting snapshot without a publication', () => {
    const replayDataset = {
      bindingType: 'sighting_replay_dataset' as const,
      sourceTable: 'uap_sightings' as const,
      snapshotAt: '2026-07-25T00:30:00.000Z',
      candidateQuerySha256: digest('9'),
      sightingSetSha256: digest('0'),
      candidateCount: sightings.length,
    };
    const replayPlan = planAdsbLolHistoricalReleases({
      replayDataset,
      sightings,
      indexes: [indexInput()],
      checkedAt: '2026-07-25T01:00:00.000Z',
      plannedAt: '2026-07-25T02:00:00.000Z',
      maximumDownloadBytes: 500 * MIB,
    });
    expect(verifyAdsbLolHistoricalReleasePlan(replayPlan)).toEqual(replayPlan);
    expect(replayPlan).toMatchObject({ replayDataset, accounting: { inputAddressCount: 8 } });
    expect(replayPlan).not.toHaveProperty('publication');
    const tampered = structuredClone(replayPlan);
    tampered.replayDataset.sightingSetSha256 = digest('f');
    expect(() => verifyAdsbLolHistoricalReleasePlan(tampered))
      .toThrow('adsb_lol_release_plan_invalid');
  });

  it('verifies official preferred assets against the advertised release catalogue', () => {
    const index = decodeAdsbLolHistoricalIndex(
      indexInput(),
      '2026-07-25T01:00:00.000Z',
    );
    expect(index.releases).toHaveLength(2);
    expect(index.releases[0]).toMatchObject({
      date: '2026-07-20',
      environment: 'prod',
      advertisedMiB: 200,
      advertisedBytes: 200 * MIB,
    });
    expect(index.releases[1]).toMatchObject({
      date: '2026-07-21',
      environment: 'staging',
      advertisedMiB: 150,
      assetUrls: [
        expect.stringMatching(/\.tar\.aa$/),
        expect.stringMatching(/\.tar\.ab$/),
        expect.stringMatching(/\.tar\.ac$/),
      ],
    });

    const mlatOnly = indexInput();
    mlatOnly.preferredReleasesBody += `\n${assetUrl('2026-07-19', 'mlatonly')}`;
    mlatOnly.preferredReleasesBody += `\n${[
      assetUrl('2026-07-18', 'staging'),
      assetUrl('2026-07-18', 'staging', 'aa'),
      assetUrl('2026-07-18', 'staging', 'ab'),
    ].join(',')}`;
    mlatOnly.releasesCatalogueBody +=
      `\n- 2026-07-19 [planes-readsb-mlatonly-0 (35 MiB)](${tagUrl('2026-07-19', 'mlatonly')})`;
    mlatOnly.releasesCatalogueBody +=
      `\n- 2026-07-18 [planes-readsb-staging-0 (300 MiB)](${tagUrl('2026-07-18', 'staging')})`;
    const layouts = decodeAdsbLolHistoricalIndex(
      mlatOnly,
      '2026-07-25T01:00:00.000Z',
    ).releases;
    expect(layouts.find(({ date }) => date === '2026-07-19')).toMatchObject({
      environment: 'mlatonly',
      assetLayout: 'unsplit',
      advertisedMiB: 35,
      assetUrls: [expect.stringMatching(/\.tar$/)],
    });
    expect(layouts.find(({ date }) => date === '2026-07-18')).toMatchObject({
      environment: 'staging',
      assetLayout: 'mixed',
      assetUrls: [
        expect.stringMatching(/\.tar$/),
        expect.stringMatching(/\.tar\.aa$/),
        expect.stringMatching(/\.tar\.ab$/),
      ],
    });
  });

  it('accepts official rollover dates and legacy test releases', () => {
    const rollover = indexInput();
    rollover.preferredReleasesBody += `\n${assetUrl('2027-01-01', 'prod')}`;
    rollover.preferredReleasesBody += '\nhttps://github.com/adsblol/globe_history_2026/releases/download/v2026.02.18-planes-readsb-test-1/v2026.02.18-planes-readsb-test-1.tar';
    rollover.preferredReleasesBody += '\nhttps://github.com/adsblol/globe_history_2026/releases/download/v2026.06.12-planes-readsb-staging-0tmp/v2026.06.12-planes-readsb-staging-0tmp.tar.aa,https://github.com/adsblol/globe_history_2026/releases/download/v2026.06.12-planes-readsb-staging-0tmp/v2026.06.12-planes-readsb-staging-0tmp.tar.ab';
    rollover.releasesCatalogueBody += [
      `\n- 2027-01-01 [planes-readsb-prod-0 (210 MB)](${tagUrl('2027-01-01', 'prod')})`,
      '- 2026-02-18 [planes-readsb-test-1 (467 MB)](https://github.com/adsblol/globe_history_2026/releases/tag/v2026.02.18-planes-readsb-test-1#assets)',
      '- 2026-06-12 [planes-readsb-staging-0tmp (3403 MiB)](https://github.com/adsblol/globe_history_2026/releases/tag/v2026.06.12-planes-readsb-staging-0tmp#assets) [planes-readsb-staging-0 (3323 MiB)](https://github.com/adsblol/globe_history_2026/releases/tag/v2026.06.12-planes-readsb-staging-0#assets) [planes-readsb-prod-0tmp (3315 MiB)](https://github.com/adsblol/globe_history_2026/releases/tag/v2026.06.12-planes-readsb-prod-0tmp#assets) [planes-readsb-prod-0 (3321 MiB)](https://github.com/adsblol/globe_history_2026/releases/tag/v2026.06.12-planes-readsb-prod-0#assets)',
    ].join('\n');

    expect(decodeAdsbLolHistoricalIndex(
      rollover,
      '2026-07-25T01:00:00.000Z',
    ).releases.find(({ date }) => date === '2027-01-01')).toMatchObject({
      date: '2027-01-01',
      advertisedMiB: 210,
    });
    expect(decodeAdsbLolHistoricalIndex(
      rollover,
      '2026-07-25T01:00:00.000Z',
    ).releases.find(({ date }) => date === '2026-02-18')).toMatchObject({
      environment: 'test',
      advertisedMiB: 467,
    });
    expect(decodeAdsbLolHistoricalIndex(
      rollover,
      '2026-07-25T01:00:00.000Z',
    ).releases.find(({ date }) => date === '2026-06-12')).toMatchObject({
      environment: 'staging',
      advertisedMiB: 3403,
      assetLayout: 'split',
    });
  });

  it('plans every eligible sighting deterministically with complete exclusion and byte accounting', () => {
    const first = buildPlan();
    const second = planAdsbLolHistoricalReleases({
      publication,
      sightings: [...sightings].reverse(),
      indexes: [indexInput()],
      checkedAt: '2026-07-25T01:00:00.000Z',
      plannedAt: '2026-07-25T02:00:00.000Z',
      maximumDownloadBytes: 500 * MIB,
    });
    expect(second).toEqual(first);
    expect(first.releases.map(({ date, addresses }) => ({ date, addresses }))).toEqual([
      { date: '2026-07-20', addresses: ['sighting:a', 'sighting:b'] },
      { date: '2026-07-21', addresses: ['sighting:c'] },
    ]);
    expect(first.accounting).toEqual({
      inputAddressCount: 8,
      plannedAddressCount: 3,
      excludedAddressCount: 5,
      uniqueReleaseDayCount: 2,
      assetPartCount: 5,
      advertisedDownloadBytes: 350 * MIB,
    });
    expect(first.excluded).toEqual([
      { address: 'sighting:future', reason: 'future_dated' },
      { address: 'sighting:index-missing', reason: 'release_index_missing' },
      { address: 'sighting:missing-time', reason: 'sighting_time_missing' },
      { address: 'sighting:old', reason: 'outside_adsb_lol_history_period' },
      { address: 'sighting:release-missing', reason: 'preferred_release_missing' },
    ]);
    expect(first.budget).toMatchObject({
      executableWithinAdvertisedBudget: true,
      remainingBytes: 150 * MIB,
      exceededByBytes: 0,
      exactAssetBytePreflightRequired: true,
    });
    expect(verifyAdsbLolHistoricalReleasePlan(first)).toEqual(first);
  });

  it('retains the full plan but blocks execution when advertised bytes exceed the operator budget', () => {
    const plan = buildPlan(100 * MIB);
    expect(plan.releases).toHaveLength(2);
    expect(plan.budget).toEqual({
      maximumDownloadBytes: 100 * MIB,
      advertisedDownloadBytes: 350 * MIB,
      remainingBytes: 0,
      exceededByBytes: 250 * MIB,
      executableWithinAdvertisedBudget: false,
      exactAssetBytePreflightRequired: true,
    });
  });

  it('rejects malformed parts, stale indexes, catalogue substitution and re-sealed plan tampering', () => {
    const malformed = indexInput();
    malformed.preferredReleasesBody = malformed.preferredReleasesBody.replace(
      /\.tar\.ab/,
      '.tar.ac',
    );
    expect(() => decodeAdsbLolHistoricalIndex(
      malformed,
      '2026-07-25T01:00:00.000Z',
    )).toThrow('adsb_lol_preferred_release_invalid');

    const substituted = indexInput();
    substituted.releasesCatalogueBody = substituted.releasesCatalogueBody.replace(
      'planes-readsb-prod-0 (200 MB)',
      'planes-readsb-test-0 (200 MB)',
    );
    expect(() => decodeAdsbLolHistoricalIndex(
      substituted,
      '2026-07-25T01:00:00.000Z',
    )).toThrow('adsb_lol_preferred_release_catalogue_mismatch');

    expect(() => decodeAdsbLolHistoricalIndex(
      indexInput(),
      '2026-08-02T01:00:00.000Z',
    )).toThrow('adsb_lol_release_index_stale');

    const tampered = buildPlan();
    tampered.releases[0].assetUrls[0] = 'https://example.invalid/substituted';
    const {
      addresses: _addresses,
      releaseDigest: _releaseDigest,
      ...releaseCore
    } = tampered.releases[0];
    tampered.releases[0].releaseDigest = relationshipInputSha256(releaseCore);
    const { planDigest: _planDigest, ...planCore } = tampered;
    tampered.planDigest = relationshipInputSha256(planCore);
    expect(() => verifyAdsbLolHistoricalReleasePlan(tampered)).toThrow(
      'adsb_lol_release_plan_invalid',
    );
  });
});
