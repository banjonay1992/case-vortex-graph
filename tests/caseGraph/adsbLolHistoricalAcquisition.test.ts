import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  acquireAndMaterializeAdsbLolHistoricalRelease,
  acquireAndPersistAdsbLolHistoricalReplayRelease,
  type AdsbLolHistoricalAssetGetFetch,
} from '../../src/caseGraph/adsbLolHistoricalAcquisition';
import {
  buildAdsbLolHistoricalAssetPreflight,
  type AdsbLolHistoricalAssetObservation,
} from '../../src/caseGraph/adsbLolHistoricalAssetPreflight';
import {
  planAdsbLolHistoricalReleases,
  type AdsbLolHistoricalIndexInput,
} from '../../src/caseGraph/adsbLolHistoricalReleasePlan';
import type { ContextualSourceGovernanceDecisionPacket } from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildAdsbLolHistoricalReplayRows,
  persistAdsbLolHistoricalReplayHistory,
} from '../../src/caseGraph/adsbLolHistoricalReplayHistory';

const MIB = 1024 * 1024;
const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'adsb-acquisition-v1',
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
const snapshotId = '00000000-0000-4000-8000-000000000099';
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
const targets = [
  {
    address: 'sighting:00000000-0000-4000-8000-000000000001',
    eventTimestamp: '2026-07-20T12:00:00.000Z',
    latitude: 40,
    longitude: -74,
    temporalWindowSeconds: 300,
    radiusKm: 10,
    maximumCandidates: 10,
  },
  {
    address: 'sighting:00000000-0000-4000-8000-000000000002',
    eventTimestamp: '2026-07-20T18:00:00.000Z',
    latitude: 0,
    longitude: 0,
    temporalWindowSeconds: 300,
    radiusKm: 10,
    maximumCandidates: 10,
  },
];
const nodes = [
  { address: 'sighting:00000000-0000-4000-8000-000000000001', nodeDigest: digest('a') },
  { address: 'sighting:00000000-0000-4000-8000-000000000002', nodeDigest: digest('b') },
];
const releasePlan = planAdsbLolHistoricalReleases({
  publication,
  sightings: targets.map((target, indexValue) => ({
    address: target.address,
    nodeDigest: nodes[indexValue].nodeDigest,
    eventTimestamp: target.eventTimestamp,
    latitude: target.latitude,
    longitude: target.longitude,
  })),
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
  return Buffer.concat([
    header,
    body,
    Buffer.alloc((512 - (body.length % 512)) % 512),
  ]);
};
const trace = gzipSync(Buffer.from(JSON.stringify({
  icao: 'abcdef',
  r: 'G-TEST',
  t: 'A320',
  timestamp: Date.parse('2026-07-20T11:59:00.000Z') / 1000,
  trace: [
    [60, 40.001, -74.001, 10_000, 250, 90, 0, 0, { flight: 'TEST123 ' }, 'adsb_icao'],
  ],
})));
const tar = Buffer.concat([
  tarEntry('traces/ab/trace_full_abcdef.json', trace),
  Buffer.alloc(1024),
]);
const parts = [tar.subarray(0, 700), tar.subarray(700)];
const observations = assetUrls.map((assetUrl, indexValue) => {
  const finalUrl =
    `https://release-assets.githubusercontent.com/github-production-release-asset/1/${indexValue}?sig=fixed`;
  const core = {
    requestedUrl: assetUrl,
    redirectChain: [assetUrl, finalUrl],
    finalUrl,
    contentLength: parts[indexValue].length,
    etag: '"fixed"',
    lastModified: 'Sat, 25 Jul 2026 00:00:00 GMT',
    observedAt: '2026-07-25T02:05:00.000Z',
  };
  return {
    ...core,
    observationDigest: relationshipInputSha256(core),
  } satisfies AdsbLolHistoricalAssetObservation;
});
const preflight = buildAdsbLolHistoricalAssetPreflight({
  releasePlan,
  observations,
  checkedAt: '2026-07-25T02:10:00.000Z',
  expiresAt: '2026-07-25T03:00:00.000Z',
});
const replayReleasePlan = planAdsbLolHistoricalReleases({
  replayDataset: {
    bindingType: 'sighting_replay_dataset',
    sourceTable: 'uap_sightings',
    snapshotAt: '2026-07-25T00:30:00.000Z',
    candidateQuerySha256: digest('8'),
    sightingSetSha256: digest('9'),
    candidateCount: targets.length,
  },
  sightings: targets.map((target, indexValue) => ({
    address: target.address,
    nodeDigest: nodes[indexValue].nodeDigest,
    eventTimestamp: target.eventTimestamp,
    latitude: target.latitude,
    longitude: target.longitude,
  })),
  indexes: [index],
  checkedAt: '2026-07-25T01:00:00.000Z',
  plannedAt: '2026-07-25T02:00:00.000Z',
  maximumDownloadBytes: 500 * MIB,
});
const replayPreflight = buildAdsbLolHistoricalAssetPreflight({
  releasePlan: replayReleasePlan,
  observations,
  checkedAt: '2026-07-25T02:10:00.000Z',
  expiresAt: '2026-07-25T03:00:00.000Z',
});
const packet = (usableNow = true) => ({
  referenceAt: '2026-07-25T00:00:00.000Z',
  maximumEvidenceAgeDays: 7,
  entries: [{
    category: 'aircraft',
    canonicalSource: 'ADSB_LOL',
    providerId: 'adsb-lol',
    requiredContentMode: 'derived_only',
    usableNow,
  }],
}) as unknown as ContextualSourceGovernanceDecisionPacket;

const fixtures = (params: {
  usableNow?: boolean;
  registryApproved?: boolean;
  wrongLength?: boolean;
  corruptBody?: boolean;
} = {}) => {
  const inspectGovernance = vi.fn(async () => ({
    present: true,
    canonicalSource: 'ADSB_LOL',
    legalStatus: params.registryApproved === false ? 'review' : 'approved',
    allowedContentModes: ['derived_only'],
  }));
  const cancel = vi.fn(async () => undefined);
  const fetchAsset = vi.fn(async (url: string) => {
    const indexValue = observations.findIndex(({ finalUrl }) => finalUrl === url);
    const part = Buffer.from(parts[indexValue]);
    if (params.corruptBody && indexValue === 0) part[0] ^= 1;
    return {
      status: 200,
      headers: {
        get: (name: string) => {
          if (name === 'content-length') {
            return String(part.length + (params.wrongLength ? 1 : 0));
          }
          return null;
        },
      },
      body: Object.assign((async function* stream() {
        for (let offset = 0; offset < part.length; offset += 101) {
          yield part.subarray(offset, offset + 101);
        }
      }()), { cancel }),
    };
  }) as unknown as ReturnType<typeof vi.fn<AdsbLolHistoricalAssetGetFetch>>;
  const materialize = vi.fn(async ({ snapshot, records }: {
    snapshot: Record<string, unknown>;
    records: unknown[];
  }) => ({
    status: 'written' as const,
    receipt: {
      snapshot,
      recordCount: records.length,
      receiptDigest: digest('f'),
    },
  }));
  const persistReplayHistory = vi.fn(async ({ extraction }: { extraction: { accounting: { candidateCount: number }; releaseDate: string; extractionDigest: string } }) => ({
    candidateRows: extraction.accounting.candidateCount,
    uniqueRows: extraction.accounting.candidateCount,
    insertedRows: extraction.accounting.candidateCount,
    existingRows: 0,
    source: 'adsblol_history' as const,
    releaseDate: extraction.releaseDate,
    extractionDigest: extraction.extractionDigest,
  }));
  const transaction = vi.fn();
  const putArchiveObject = vi.fn();
  const verifyArchiveObject = vi.fn();
  return {
    inspectGovernance,
    fetchAsset,
    materialize,
    persistReplayHistory,
    transaction,
    putArchiveObject,
    verifyArchiveObject,
    cancel,
    decisionPacket: packet(params.usableNow !== false),
  };
};

const run = (fixture: ReturnType<typeof fixtures>) => acquireAndMaterializeAdsbLolHistoricalRelease({
  publication,
  snapshotId,
  releasePlan,
  preflight,
  releaseDate: '2026-07-20',
  targets,
  nodes,
  decisionPacket: fixture.decisionPacket,
  checkedAt: '2026-07-25T02:30:00.000Z',
  inspectGovernance: fixture.inspectGovernance,
  fetchAsset: fixture.fetchAsset,
  transaction: fixture.transaction as never,
  putArchiveObject: fixture.putArchiveObject as never,
  verifyArchiveObject: fixture.verifyArchiveObject as never,
  dependencies: {
    verifyDecisionPacket: (value) => value,
    materialize: fixture.materialize as never,
    persistReplayHistory: fixture.persistReplayHistory as never,
  },
});

describe('ADSB.lol historical governed acquisition', () => {
  it('persists replay history without requiring a Case Graph publication transaction', async () => {
    const fixture = fixtures();
    const result = await acquireAndPersistAdsbLolHistoricalReplayRelease({
      releasePlan: replayReleasePlan,
      preflight: replayPreflight,
      releaseDate: '2026-07-20',
      targets,
      decisionPacket: fixture.decisionPacket,
      checkedAt: '2026-07-25T02:30:00.000Z',
      inspectGovernance: fixture.inspectGovernance,
      fetchAsset: fixture.fetchAsset,
      verifyDecisionPacket: (value) => value,
      persistReplayHistory: fixture.persistReplayHistory as never,
    });
    expect(result).toMatchObject({
      replayHistory: { insertedRows: 1, source: 'adsblol_history' },
      guarantees: {
        rawArchiveFilesWritten: 0,
        derivedProviderArchiveMaterialized: false,
        replayHistoryPersisted: true,
      },
    });
    expect(fixture.persistReplayHistory).toHaveBeenCalledOnce();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(fixture.putArchiveObject).not.toHaveBeenCalled();
  });

  it('fails before registry and provider access when the decision is unusable', async () => {
    const fixture = fixtures({ usableNow: false });
    await expect(run(fixture)).rejects.toThrow(
      'adsb_lol_acquisition_source_decision_not_approved',
    );
    expect(fixture.inspectGovernance).not.toHaveBeenCalled();
    expect(fixture.fetchAsset).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.persistReplayHistory).not.toHaveBeenCalled();
  });

  it('fails before GET or storage when the live registry is not approved', async () => {
    const fixture = fixtures({ registryApproved: false });
    await expect(run(fixture)).rejects.toThrow(
      'adsb_lol_acquisition_source_registry_not_approved',
    );
    expect(fixture.inspectGovernance).toHaveBeenCalledOnce();
    expect(fixture.fetchAsset).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.persistReplayHistory).not.toHaveBeenCalled();
  });

  it('rejects changed GET metadata, cancels the body and writes no derived archive', async () => {
    const fixture = fixtures({ wrongLength: true });
    await expect(run(fixture)).rejects.toThrow('adsb_lol_acquisition_response_invalid');
    expect(fixture.fetchAsset).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.persistReplayHistory).not.toHaveBeenCalled();
  });

  it('streams exact preflighted assets and materializes only derived records', async () => {
    const fixture = fixtures();
    const result = await run(fixture);
    expect(fixture.fetchAsset).toHaveBeenCalledTimes(2);
    expect(fixture.fetchAsset.mock.calls.map(([url, init]) => ({
      url,
      method: init.method,
      redirect: init.redirect,
      encoding: init.headers['accept-encoding'],
    }))).toEqual(observations.map(({ finalUrl }) => ({
      url: finalUrl,
      method: 'GET',
      redirect: 'manual',
      encoding: 'identity',
    })));
    expect(fixture.materialize).toHaveBeenCalledOnce();
    expect(fixture.persistReplayHistory).toHaveBeenCalledOnce();
    expect(fixture.materialize.mock.calls[0][0]).toMatchObject({
      snapshot: {
        category: 'aircraft',
        canonicalSource: 'ADSB_LOL',
        contentMode: 'derived_only',
        providerId: 'adsb-lol',
        license: 'ODbL-1.0',
      },
      records: [
        { address: 'sighting:00000000-0000-4000-8000-000000000001', candidates: [{ label: 'TEST123 (ABCDEF)' }] },
        { address: 'sighting:00000000-0000-4000-8000-000000000002', candidates: [] },
      ],
    });
    expect(result.guarantees).toEqual({
      providerMethod: 'GET',
      rawArchiveFilesWritten: 0,
      derivedProviderArchiveMaterialized: true,
      replayHistoryPersisted: true,
      publicationActivations: 0,
      deployments: 0,
    });
    expect(buildAdsbLolHistoricalReplayRows({
      extraction: result.extraction,
      ingestedAt: '2026-07-25T02:30:00.000Z',
    })).toEqual([expect.objectContaining({
      icao24: 'abcdef',
      callsign: 'TEST123',
      baro_altitude: 3048,
      geo_altitude: 3048,
      velocity: 128.611,
      true_track: 90,
      snapshot_time: '2026-07-20T12:00:00.000Z',
      source: 'adsblol_history',
    })]);

    const query = vi.fn(async () => ({ rowCount: 1 }));
    await expect(persistAdsbLolHistoricalReplayHistory({
      releasePlan,
      preflight,
      extraction: result.extraction,
      checkedAt: '2026-07-25T02:30:00.000Z',
      query,
      batchSize: 1,
    })).resolves.toMatchObject({
      candidateRows: 1,
      uniqueRows: 1,
      insertedRows: 1,
      existingRows: 0,
      searchedTargets: 2,
      emptyTargets: 1,
      source: 'adsblol_history',
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (snapshot_time, icao24) DO NOTHING');
    expect(query.mock.calls[0][1]).toHaveLength(20);
    expect(query.mock.calls[1][0]).toContain('uap_aircraft_archive_searches');
    expect(query.mock.calls[1][1]).toHaveLength(14);
  });

  it('publishes no derived record archive when streamed tar integrity fails', async () => {
    const fixture = fixtures({ corruptBody: true });
    await expect(run(fixture)).rejects.toThrow('adsb_lol_tar_checksum_invalid');
    expect(fixture.fetchAsset).toHaveBeenCalledOnce();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.persistReplayHistory).not.toHaveBeenCalled();
  });
});
