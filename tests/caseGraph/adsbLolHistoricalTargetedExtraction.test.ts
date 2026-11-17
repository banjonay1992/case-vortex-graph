import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  buildAdsbLolHistoricalAssetPreflight,
  type AdsbLolHistoricalAssetObservation,
} from '../../src/caseGraph/adsbLolHistoricalAssetPreflight';
import {
  planAdsbLolHistoricalReleases,
  type AdsbLolHistoricalIndexInput,
} from '../../src/caseGraph/adsbLolHistoricalReleasePlan';
import {
  buildAdsbLolHistoricalProviderRecords,
  extractAdsbLolHistoricalTargets,
  verifyAdsbLolHistoricalTargetedExtraction,
} from '../../src/caseGraph/adsbLolHistoricalTargetedExtraction';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const MIB = 1024 * 1024;
const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'adsb-extraction-v1',
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
const tag = 'v2026.07.20-planes-readsb-prod-0';
const assetUrls = ['aa', 'ab'].map((suffix) => (
  `https://github.com/adsblol/globe_history_2026/releases/download/${tag}/${tag}.tar.${suffix}`
));
const index: AdsbLolHistoricalIndexInput = {
  year: 2026,
  preferredReleasesSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/PREFERRED_RELEASES.txt',
  preferredReleasesBody: assetUrls.join(','),
  releasesCatalogueSourceUrl:
    'https://raw.githubusercontent.com/adsblol/globe_history_2026/refs/heads/main/RELEASES.md',
  releasesCatalogueBody:
    `- 2026-07-20 [planes-readsb-prod-0 (200 MiB)](https://github.com/adsblol/globe_history_2026/releases/tag/${tag}#assets)`,
  fetchedAt: '2026-07-25T00:00:00.000Z',
};
const releasePlan = planAdsbLolHistoricalReleases({
  publication,
  sightings: [
    {
      address: 'sighting:matched',
      nodeDigest: digest('a'),
      eventTimestamp: '2026-07-20T12:00:00.000Z',
      latitude: 40,
      longitude: -74,
    },
    {
      address: 'sighting:no-match',
      nodeDigest: digest('b'),
      eventTimestamp: '2026-07-20T18:00:00.000Z',
      latitude: 0,
      longitude: 0,
    },
  ],
  indexes: [index],
  checkedAt: '2026-07-25T01:00:00.000Z',
  plannedAt: '2026-07-25T02:00:00.000Z',
  maximumDownloadBytes: 500 * MIB,
});

const octal = (value: number, width: number) => (
  `${value.toString(8).padStart(width - 1, '0')}\0`
);
const tarEntry = (path: string, body: Buffer) => {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(octal(body.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
};

const traceBody = (overrides: Record<string, unknown> = {}) => gzipSync(Buffer.from(JSON.stringify({
  icao: 'abcdef',
  r: 'G-TEST',
  t: 'A320',
  timestamp: Date.parse('2026-07-20T11:59:00.000Z') / 1000,
  trace: [
    [60, 40.001, -74.001, 10_000, 250, 90, 0, 0, { flight: 'TEST123 ' }, 'adsb_icao'],
    [3_600, 50, 10, 20_000, 300, 180, 0, 0, null, 'mlat'],
  ],
  ...overrides,
})));

const archive = (body = traceBody()) => Buffer.concat([
  tarEntry('README.txt', Buffer.from('fixture')),
  tarEntry('traces/ab/trace_full_abcdef.json', body),
  Buffer.alloc(1024),
]);

const observation = (url: string, contentLength: number): AdsbLolHistoricalAssetObservation => {
  const finalUrl =
    `https://release-assets.githubusercontent.com/github-production-release-asset/1/${url.slice(-2)}?sig=fixed`;
  const core = {
    requestedUrl: url,
    redirectChain: [url, finalUrl],
    finalUrl,
    contentLength,
    etag: '"fixed"',
    lastModified: 'Sat, 25 Jul 2026 00:00:00 GMT',
    observedAt: '2026-07-25T02:05:00.000Z',
  };
  return { ...core, observationDigest: relationshipInputSha256(core) };
};

const fixture = (tar = archive(), splitAt = 700) => {
  const parts = [tar.subarray(0, splitAt), tar.subarray(splitAt)];
  const preflight = buildAdsbLolHistoricalAssetPreflight({
    releasePlan,
    observations: [
      observation(assetUrls[0], parts[0].length),
      observation(assetUrls[1], parts[1].length),
    ],
    checkedAt: '2026-07-25T02:10:00.000Z',
    expiresAt: '2026-07-25T03:00:00.000Z',
  });
  const chunks = (part: Buffer) => (async function* stream() {
    for (let offset = 0; offset < part.length; offset += 97) {
      yield part.subarray(offset, offset + 97);
    }
  }());
  return {
    preflight,
    parts,
    assetStreams: assetUrls.map((assetUrl, index) => ({
      assetUrl,
      chunks: chunks(parts[index]),
    })),
  };
};

const targets = [
  {
    address: 'sighting:matched',
    eventTimestamp: '2026-07-20T12:00:00.000Z',
    latitude: 40,
    longitude: -74,
    temporalWindowSeconds: 300,
    radiusKm: 10,
    maximumCandidates: 10,
  },
  {
    address: 'sighting:no-match',
    eventTimestamp: '2026-07-20T18:00:00.000Z',
    latitude: 0,
    longitude: 0,
    temporalWindowSeconds: 300,
    radiusKm: 10,
    maximumCandidates: 10,
  },
];

describe('ADSB.lol historical targeted extraction', () => {
  it('streams across split-part and tar-block boundaries and emits bounded candidates', async () => {
    const data = fixture();
    const result = await extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: data.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: data.assetStreams,
    });
    expect(result.results).toEqual([
      {
        address: 'sighting:matched',
        status: 'matched',
        candidates: [{
          aircraftIcao: 'abcdef',
          registration: 'G-TEST',
          aircraftType: 'A320',
          callsign: 'TEST123',
          positionAt: '2026-07-20T12:00:00.000Z',
          latitude: 40.001,
          longitude: -74.001,
          distanceKm: expect.any(Number),
          temporalDeltaSeconds: 0,
          altitudeFeet: 10_000,
          groundSpeedKnots: 250,
          trackDegrees: 90,
          sourceType: 'adsb_icao',
          tracePath: 'traces/ab/trace_full_abcdef.json',
          candidateDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }],
      },
      { address: 'sighting:no-match', status: 'checked_no_match', candidates: [] },
    ]);
    expect(result.accounting).toMatchObject({
      exactArchiveBytes: data.parts[0].length + data.parts[1].length,
      traceEntryCount: 1,
      tracePointCount: 2,
      targetCount: 2,
      matchedTargetCount: 1,
      candidateCount: 1,
    });
    expect(result.assets).toHaveLength(2);
    expect(result.assets.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(true);
    expect(verifyAdsbLolHistoricalTargetedExtraction({
      value: result,
      releasePlan,
      preflight: data.preflight,
      checkedAt: '2026-07-25T02:40:00.000Z',
    })).toEqual(result);

    const tampered = structuredClone(result);
    tampered.results[0].candidates[0].distanceKm = 999;
    expect(() => verifyAdsbLolHistoricalTargetedExtraction({
      value: tampered,
      releasePlan,
      preflight: data.preflight,
      checkedAt: '2026-07-25T02:40:00.000Z',
    })).toThrow('adsb_lol_extraction_invalid');
  });

  it('rejects truncated parts and mismatched stream order before claiming coverage', async () => {
    const data = fixture();
    await expect(extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: data.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: [
        data.assetStreams[1],
        data.assetStreams[0],
      ],
    })).rejects.toThrow('adsb_lol_extraction_asset_set_invalid');

    const truncated = fixture();
    truncated.parts[1] = truncated.parts[1].subarray(0, truncated.parts[1].length - 1);
    truncated.assetStreams[1].chunks = (async function* stream() {
      yield truncated.parts[1];
    }());
    await expect(extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: truncated.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: truncated.assetStreams,
    })).rejects.toThrow('adsb_lol_extraction_asset_bytes_invalid');
  });

  it('rejects tar checksum and trace identity corruption', async () => {
    const corruptTar = archive();
    corruptTar[0] ^= 1;
    const corrupt = fixture(corruptTar);
    await expect(extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: corrupt.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: corrupt.assetStreams,
    })).rejects.toThrow('adsb_lol_tar_checksum_invalid');

    const wrongIdentity = fixture(archive(traceBody({ icao: '123456' })));
    await expect(extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: wrongIdentity.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: wrongIdentity.assetStreams,
    })).rejects.toThrow('adsb_lol_trace_json_invalid');
  });

  it('rejects expired preflight and invalid or cross-day targets before reading streams', async () => {
    const data = fixture();
    let opened = false;
    const unopened = data.assetStreams.map(({ assetUrl }) => ({
      assetUrl,
      chunks: (async function* stream() {
        opened = true;
        yield Buffer.alloc(1);
      }()),
    }));
    await expect(extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: data.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T03:00:00.000Z',
      assetStreams: unopened,
    })).rejects.toThrow('adsb_lol_asset_preflight_invalid');
    expect(opened).toBe(false);

    await expect(extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: data.preflight,
      releaseDate: '2026-07-20',
      targets: [{ ...targets[0], eventTimestamp: '2026-07-21T00:00:00.000Z' }],
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: unopened,
    })).rejects.toThrow('adsb_lol_extraction_target_invalid');
    expect(opened).toBe(false);
  });

  it('builds durable publication records for Luna with candidate and no-match boundaries', async () => {
    const data = fixture();
    const extraction = await extractAdsbLolHistoricalTargets({
      releasePlan,
      preflight: data.preflight,
      releaseDate: '2026-07-20',
      targets,
      extractedAt: '2026-07-25T02:30:00.000Z',
      assetStreams: data.assetStreams,
    });
    const records = buildAdsbLolHistoricalProviderRecords({
      publication,
      snapshotId: '00000000-0000-4000-8000-000000000099',
      releasePlan,
      preflight: data.preflight,
      extraction,
      nodes: [
        { address: 'sighting:matched', nodeDigest: digest('a') },
        { address: 'sighting:no-match', nodeDigest: digest('b') },
      ],
      checkedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      address: 'sighting:matched',
      availability: 'available',
      reasonCodes: [
        'bounded_aircraft_candidates_available',
        'aircraft_receiver_coverage_incomplete',
        'historical_adsb_trace_checked',
      ],
      candidates: [{
        label: 'TEST123 (ABCDEF)',
        reasonCodes: [
          'archived_adsb_trace_position',
          'bounded_spatiotemporal_match',
          'candidate_not_identification',
        ],
        measurements: {
          distance_km: expect.any(Number),
          time_delta_minutes: 0,
          aircraft_icao: 'abcdef',
          trace_path_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      }],
    });
    expect(records[0].candidates[0].explanation).toContain('not proof');
    expect(records[1]).toMatchObject({
      address: 'sighting:no-match',
      availability: 'available',
      reasonCodes: [
        'bounded_aircraft_window_checked_no_candidate',
        'aircraft_receiver_coverage_incomplete',
        'historical_adsb_trace_checked',
      ],
      candidates: [],
    });
    expect(records[1].explanation).toContain('not ruled out');

    const substitutedNodes = [
      { address: 'sighting:matched', nodeDigest: digest('a') },
      { address: 'sighting:substituted', nodeDigest: digest('b') },
    ];
    expect(() => buildAdsbLolHistoricalProviderRecords({
      publication,
      snapshotId: '00000000-0000-4000-8000-000000000099',
      releasePlan,
      preflight: data.preflight,
      extraction,
      nodes: substitutedNodes,
      checkedAt: '2026-08-01T00:00:00.000Z',
    })).toThrow('adsb_lol_extraction_provider_record_plan_invalid');
  });
});
