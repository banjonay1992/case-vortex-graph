import { describe, expect, it } from 'vitest';

import { selectAdsbLolHistoricalRecoveryBatch } from '../../src/caseGraph/adsbLolHistoricalRecoveryBatch';
import {
  planAdsbLolHistoricalReleases,
  type AdsbLolHistoricalIndexInput,
} from '../../src/caseGraph/adsbLolHistoricalReleasePlan';

const MIB = 1024 * 1024;
const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'adsb-recovery-batch-v1',
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
const tag = (date: string, environment: 'prod' | 'staging') =>
  `v${date.replace(/-/g, '.')}-planes-readsb-${environment}-0`;
const tagUrl = (date: string, environment: 'prod' | 'staging') =>
  `https://github.com/adsblol/globe_history_2026/releases/tag/${tag(date, environment)}#assets`;
const assetUrl = (date: string, environment: 'prod' | 'staging') =>
  `https://github.com/adsblol/globe_history_2026/releases/download/${tag(date, environment)}/${tag(date, environment)}.tar`;

const buildPlan = () => {
  const index: AdsbLolHistoricalIndexInput = {
    year: 2026,
    preferredReleasesSourceUrl: 'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/PREFERRED_RELEASES.txt',
    preferredReleasesBody: [
      assetUrl('2026-07-20', 'prod'),
      assetUrl('2026-07-21', 'staging'),
    ].join('\n'),
    releasesCatalogueSourceUrl: 'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/RELEASES.md',
    releasesCatalogueBody: [
      `- 2026-07-20 [planes-readsb-prod-0 (200 MiB)](${tagUrl('2026-07-20', 'prod')})`,
      `- 2026-07-21 [planes-readsb-staging-0 (150 MiB)](${tagUrl('2026-07-21', 'staging')})`,
    ].join('\n'),
    fetchedAt: '2026-07-25T00:00:00.000Z',
  };
  return planAdsbLolHistoricalReleases({
    publication,
    sightings: [
      { address: 'sighting:a', nodeDigest: digest('a'), eventTimestamp: '2026-07-20T12:00:00.000Z', latitude: 40, longitude: -74 },
      { address: 'sighting:b', nodeDigest: digest('b'), eventTimestamp: '2026-07-20T18:00:00.000Z', latitude: 35, longitude: -118 },
      { address: 'sighting:c', nodeDigest: digest('c'), eventTimestamp: '2026-07-21T18:00:00.000Z', latitude: 51, longitude: -1 },
    ],
    indexes: [index],
    checkedAt: '2026-07-25T01:00:00.000Z',
    plannedAt: '2026-07-25T02:00:00.000Z',
    maximumDownloadBytes: 500 * MIB,
  });
};

describe('ADSB.lol historical recovery batch selection', () => {
  it('prioritizes the most sightings recovered per advertised byte', () => {
    const batch = selectAdsbLolHistoricalRecoveryBatch(buildPlan(), 200 * MIB);
    expect(batch.selected.map(({ date }) => date)).toEqual(['2026-07-20']);
    expect(batch.deferred.map(({ date }) => date)).toEqual(['2026-07-21']);
    expect(batch.accounting).toEqual({
      selectedDayCount: 1,
      selectedAddressCount: 2,
      selectedAdvertisedDownloadBytes: 200 * MIB,
      deferredDayCount: 1,
      deferredAddressCount: 1,
      deferredAdvertisedDownloadBytes: 150 * MIB,
      remainingDownloadBytes: 0,
    });
  });

  it('skips a higher-yield day that does not fit and fills the remaining budget', () => {
    const batch = selectAdsbLolHistoricalRecoveryBatch(buildPlan(), 150 * MIB);
    expect(batch.selected.map(({ date }) => date)).toEqual(['2026-07-21']);
    expect(batch.accounting.selectedAddressCount).toBe(1);
  });

  it('is deterministic and rejects unsafe budgets or tampered plans', () => {
    const plan = buildPlan();
    expect(selectAdsbLolHistoricalRecoveryBatch(plan, 350 * MIB))
      .toEqual(selectAdsbLolHistoricalRecoveryBatch(structuredClone(plan), 350 * MIB));
    expect(() => selectAdsbLolHistoricalRecoveryBatch(plan, 0))
      .toThrow('adsb_lol_recovery_batch_budget_invalid');
    const tampered = structuredClone(plan);
    tampered.releases[0].advertisedBytes = 1;
    expect(() => selectAdsbLolHistoricalRecoveryBatch(tampered, 350 * MIB))
      .toThrow('adsb_lol_release_plan_invalid');
  });
});
