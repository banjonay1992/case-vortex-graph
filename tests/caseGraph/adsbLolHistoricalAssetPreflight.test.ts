import { describe, expect, it } from 'vitest';

import {
  buildAdsbLolHistoricalAssetPreflight,
  probeAdsbLolHistoricalAsset,
  verifyAdsbLolHistoricalAssetPreflight,
  type AdsbLolHistoricalAssetObservation,
} from '../../src/caseGraph/adsbLolHistoricalAssetPreflight';
import {
  planAdsbLolHistoricalReleases,
  type AdsbLolHistoricalIndexInput,
} from '../../src/caseGraph/adsbLolHistoricalReleasePlan';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const MIB = 1024 * 1024;
const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'adsb-preflight-v1',
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

const tag = (date: string, environment: 'prod' | 'staging') => (
  `v${date.replace(/-/gu, '.')}-planes-readsb-${environment}-0`
);
const tagUrl = (date: string, environment: 'prod' | 'staging') => (
  `https://github.com/adsblol/globe_history_2026/releases/tag/${tag(date, environment)}#assets`
);
const assetUrl = (
  date: string,
  environment: 'prod' | 'staging',
  suffix?: string,
) => (
  `https://github.com/adsblol/globe_history_2026/releases/download/`
  + `${tag(date, environment)}/${tag(date, environment)}.tar${suffix ? `.${suffix}` : ''}`
);

const indexInput = (): AdsbLolHistoricalIndexInput => ({
  year: 2026,
  preferredReleasesSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/PREFERRED_RELEASES.txt',
  preferredReleasesBody: [
    [
      assetUrl('2026-07-20', 'prod'),
      assetUrl('2026-07-20', 'prod', 'aa'),
      assetUrl('2026-07-20', 'prod', 'ab'),
    ].join(','),
    assetUrl('2026-07-21', 'staging'),
  ].join('\n'),
  releasesCatalogueSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/RELEASES.md',
  releasesCatalogueBody: [
    '# Releases',
    `- 2026-07-20 [planes-readsb-prod-0 (200 MiB)](${tagUrl('2026-07-20', 'prod')})`,
    `- 2026-07-21 [planes-readsb-staging-0 (150 MiB)](${tagUrl('2026-07-21', 'staging')})`,
  ].join('\n'),
  fetchedAt: '2026-07-25T00:00:00.000Z',
});

const plan = (maximumDownloadBytes = 500 * MIB) => planAdsbLolHistoricalReleases({
  publication,
  sightings: [
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
      eventTimestamp: '2026-07-21T12:00:00.000Z',
      latitude: 51,
      longitude: -1,
    },
  ],
  indexes: [indexInput()],
  checkedAt: '2026-07-25T01:00:00.000Z',
  plannedAt: '2026-07-25T02:00:00.000Z',
  maximumDownloadBytes,
});

const observation = (
  requestedUrl: string,
  contentLength: number,
): AdsbLolHistoricalAssetObservation => {
  const filename = requestedUrl.slice(requestedUrl.lastIndexOf('/') + 1);
  const core = {
    requestedUrl,
    redirectChain: [
      requestedUrl,
      `https://release-assets.githubusercontent.com/github-production-release-asset/1/${filename}?sig=fixed`,
    ],
    finalUrl:
      `https://release-assets.githubusercontent.com/github-production-release-asset/1/${filename}?sig=fixed`,
    contentLength,
    etag: '"fixed-etag"',
    lastModified: 'Sat, 25 Jul 2026 00:00:00 GMT',
    observedAt: '2026-07-25T02:05:00.000Z',
  };
  return { ...core, observationDigest: relationshipInputSha256(core) };
};

const observationsFor = (
  releasePlan = plan(),
) => releasePlan.releases.flatMap(({ assetUrls }) => (
  assetUrls.map((url, index) => observation(url, (index + 1) * 10 * MIB))
));

describe('ADSB.lol historical asset preflight', () => {
  it('probes with HEAD only and records an allowlisted manual redirect chain', async () => {
    const url = assetUrl('2026-07-20', 'prod', 'aa');
    const finalUrl =
      'https://release-assets.githubusercontent.com/github-production-release-asset/1/file?sig=fixed';
    const calls: Array<{ url: string; init: unknown }> = [];
    const result = await probeAdsbLolHistoricalAsset({
      assetUrl: url,
      observedAt: '2026-07-25T02:05:00.000Z',
      fetchHead: async (requested, init) => {
        calls.push({ url: requested, init });
        const headers = new Map<string, string>();
        if (requested === url) headers.set('location', finalUrl);
        else {
          headers.set('content-length', String(25 * MIB));
          headers.set('etag', '"asset-etag"');
          headers.set('last-modified', 'Sat, 25 Jul 2026 00:00:00 GMT');
        }
        return {
          status: requested === url ? 302 : 200,
          headers: { get: (name: string) => headers.get(name) || null },
          body: null,
        };
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls.every(({ init }) => (
      (init as { method: string; redirect: string }).method === 'HEAD'
      && (init as { method: string; redirect: string }).redirect === 'manual'
    ))).toBe(true);
    expect(result).toMatchObject({
      requestedUrl: url,
      redirectChain: [url, finalUrl],
      finalUrl,
      contentLength: 25 * MIB,
      etag: '"asset-etag"',
    });

    await expect(probeAdsbLolHistoricalAsset({
      assetUrl: url,
      observedAt: '2026-07-25T02:05:00.000Z',
      fetchHead: async () => ({
        status: 302,
        headers: { get: () => 'https://evil.example/archive.tar' },
        body: null,
      }),
    })).rejects.toThrow('adsb_lol_asset_probe_redirect_invalid');
  });

  it('selects exactly one representation and accounts exact bytes', () => {
    const releasePlan = plan();
    const preflight = buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations: observationsFor(releasePlan),
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    });
    expect(preflight.selectedReleases).toMatchObject([
      {
        date: '2026-07-20',
        representation: 'split',
        assetUrls: [
          expect.stringMatching(/\.tar\.aa$/u),
          expect.stringMatching(/\.tar\.ab$/u),
        ],
        exactDownloadBytes: 50 * MIB,
      },
      {
        date: '2026-07-21',
        representation: 'unsplit',
        assetUrls: [expect.stringMatching(/\.tar$/u)],
        exactDownloadBytes: 10 * MIB,
      },
    ]);
    expect(preflight.accounting).toEqual({
      plannedReleaseCount: 2,
      probedAssetCount: 4,
      selectedAssetCount: 3,
      exactDownloadBytes: 60 * MIB,
      maximumDownloadBytes: 500 * MIB,
      remainingBytes: 440 * MIB,
      exceededByBytes: 0,
      executableWithinExactBudget: true,
    });
    expect(verifyAdsbLolHistoricalAssetPreflight(
      preflight,
      releasePlan,
      '2026-07-25T02:30:00.000Z',
    )).toEqual(preflight);
  });

  it('retains a valid receipt but blocks exact-byte execution above budget', () => {
    const releasePlan = plan(400 * MIB);
    const observations = observationsFor(releasePlan).map((item) => ({
      ...item,
      contentLength: 200 * MIB,
      observationDigest: relationshipInputSha256({
        requestedUrl: item.requestedUrl,
        redirectChain: item.redirectChain,
        finalUrl: item.finalUrl,
        contentLength: 200 * MIB,
        etag: item.etag,
        lastModified: item.lastModified,
        observedAt: item.observedAt,
      }),
    }));
    const preflight = buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations,
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    });
    expect(preflight.accounting).toMatchObject({
      exactDownloadBytes: 600 * MIB,
      exceededByBytes: 200 * MIB,
      executableWithinExactBudget: false,
    });
  });

  it('rejects missing, duplicate, stale and unsafe redirect observations', () => {
    const releasePlan = plan();
    const observations = observationsFor(releasePlan);
    expect(() => buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations: observations.slice(1),
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    })).toThrow('adsb_lol_asset_preflight_observation_set_invalid');

    expect(() => buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations: [observations[0], observations[0], ...observations.slice(2)],
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    })).toThrow('adsb_lol_asset_preflight_observation_set_invalid');

    const stale = structuredClone(observations);
    stale[0].observedAt = '2026-07-25T01:00:00.000Z';
    expect(() => buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations: stale,
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    })).toThrow('adsb_lol_asset_observation_invalid');

    const unsafe = structuredClone(observations);
    unsafe[0].redirectChain[1] = 'https://evil.example/archive.tar';
    unsafe[0].finalUrl = unsafe[0].redirectChain[1];
    expect(() => buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations: unsafe,
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    })).toThrow('adsb_lol_asset_observation_invalid');
  });

  it('rejects expiry, plan substitution and fully re-sealed receipt tampering', () => {
    const releasePlan = plan();
    const preflight = buildAdsbLolHistoricalAssetPreflight({
      releasePlan,
      observations: observationsFor(releasePlan),
      checkedAt: '2026-07-25T02:10:00.000Z',
      expiresAt: '2026-07-25T03:00:00.000Z',
    });
    expect(() => verifyAdsbLolHistoricalAssetPreflight(
      preflight,
      releasePlan,
      '2026-07-25T03:00:00.000Z',
    )).toThrow('adsb_lol_asset_preflight_invalid');

    expect(() => verifyAdsbLolHistoricalAssetPreflight(
      preflight,
      plan(600 * MIB),
      '2026-07-25T02:30:00.000Z',
    )).toThrow();

    const tampered = structuredClone(preflight);
    tampered.selectedReleases[0].representation = 'unsplit';
    const { preflightDigest: _digest, ...core } = tampered;
    tampered.preflightDigest = relationshipInputSha256(core);
    expect(() => verifyAdsbLolHistoricalAssetPreflight(
      tampered,
      releasePlan,
      '2026-07-25T02:30:00.000Z',
    )).toThrow('adsb_lol_asset_preflight_invalid');
  });
});
