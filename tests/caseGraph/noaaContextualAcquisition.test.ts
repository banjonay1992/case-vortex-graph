import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type {
  CaseGraphArchiveWriteCondition,
  CaseGraphConditionalArchiveStorage,
  CaseGraphConditionalWriteResult,
} from '../../src/caseGraph/archiveTypes';
import {
  acquireNoaaContextualWindows,
  getNoaaContextualAcquisitionKeys,
  NOAA_CONTEXTUAL_ACQUISITION_VERSION,
  planNoaaContextualAcquisition,
  readCompletedNoaaContextualAcquisition,
  type NoaaContextualAcquisitionWindow,
} from '../../src/caseGraph/noaaContextualAcquisition';
import type { NoaaNceiUsObservationResult } from '../../src/caseGraph/freeContextualProviderObservations';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'noaa-acquisition-v1',
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

class MemoryConditionalStorage implements CaseGraphConditionalArchiveStorage {
  readonly objects = new Map<string, { body: Buffer; version: string }>();
  writes = 0;
  failCheckpointWriteNumber: number | null = null;
  failRateWrites = 0;
  private checkpointWrites = 0;

  async readObject(key: string, options?: { maxBytes?: number }) {
    const value = this.objects.get(key);
    if (!value) return null;
    if (options?.maxBytes != null && value.body.length > options.maxBytes) {
      throw new Error('fixture_max_bytes_exceeded');
    }
    return Buffer.from(value.body);
  }

  async uploadFile(
    body: Buffer,
    key: string,
  ) {
    const version = `v${this.writes += 1}`;
    this.objects.set(key, { body: Buffer.from(body), version });
    return key;
  }

  async readObjectVersioned(key: string) {
    const value = this.objects.get(key);
    return value ? { body: Buffer.from(value.body), version: value.version } : null;
  }

  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: unknown,
    condition: CaseGraphArchiveWriteCondition,
  ): Promise<CaseGraphConditionalWriteResult> {
    if (key.includes('/acquisition/noaa/rate/') && this.failRateWrites > 0) {
      this.failRateWrites -= 1;
      return { status: 'precondition_failed' };
    }
    if (key.endsWith('/checkpoint.json')) {
      this.checkpointWrites += 1;
      if (this.failCheckpointWriteNumber === this.checkpointWrites) return { status: 'precondition_failed' };
    }
    const current = this.objects.get(key);
    if ('ifAbsent' in condition && current) return { status: 'precondition_failed' };
    if ('ifVersion' in condition && current?.version !== condition.ifVersion) {
      return { status: 'precondition_failed' };
    }
    const version = `v${this.writes += 1}`;
    this.objects.set(key, { body: Buffer.from(body), version });
    return { status: 'written', key, version };
  }
}

const sightings = [
  {
    address: 'sighting:a',
    nodeDigest: digest('a'),
    eventTimestamp: '2026-07-20T12:00:00.000Z',
    latitude: 40.7,
    longitude: -74,
  },
  {
    address: 'sighting:b',
    nodeDigest: digest('b'),
    eventTimestamp: '2026-07-20T13:00:00.000Z',
    latitude: 40.8,
    longitude: -73.9,
  },
  {
    address: 'sighting:c',
    nodeDigest: digest('c'),
    eventTimestamp: '2026-07-21T13:00:00.000Z',
    latitude: 34.05,
    longitude: -118.25,
  },
  {
    address: 'sighting:old',
    nodeDigest: digest('d'),
    eventTimestamp: '1997-03-13T20:00:00.000Z',
    latitude: 33.4,
    longitude: -112.1,
  },
  {
    address: 'sighting:outside',
    nodeDigest: digest('e'),
    eventTimestamp: '2026-07-20T13:00:00.000Z',
    latitude: 51.5,
    longitude: -0.1,
  },
  {
    address: 'sighting:missing-time',
    nodeDigest: digest('f'),
    eventTimestamp: null,
    latitude: 40,
    longitude: -74,
  },
  {
    address: 'sighting:missing-location',
    nodeDigest: digest('0'),
    eventTimestamp: '2026-07-20T13:00:00.000Z',
    latitude: null,
    longitude: null,
  },
  {
    address: 'sighting:future',
    nodeDigest: digest('9'),
    eventTimestamp: '2026-07-26T13:00:00.000Z',
    latitude: 40,
    longitude: -74,
  },
];

const plan = () => planNoaaContextualAcquisition({
  publication,
  sightings,
  checkedAt: '2026-07-25T00:00:00.000Z',
  plannedAt: '2026-07-25T01:00:00.000Z',
});

const resultFor = (
  window: NoaaContextualAcquisitionWindow,
  acquiredAt = '2026-07-25T02:00:00.000Z',
): NoaaNceiUsObservationResult => ({
  providerId: 'noaa-ncei-us-observations',
  datasetVersion: 'local-climatological-data-v2',
  sourceUrl: window.sourceUrl,
  acquiredAt,
  observations: [{
    sourceRecordId: `noaa:${window.ordinal}`,
    stationId: 'USW00000001',
    stationName: 'FIXTURE',
    observedAt: new Date(Date.parse(window.query.start) + 3_600_000).toISOString(),
    latitude: (window.query.north + window.query.south) / 2,
    longitude: (window.query.east + window.query.west) / 2,
    measurements: { HourlyVisibility: 10 },
    sourceSha256: createHash('sha256').update(window.windowId).digest('hex'),
  }],
  excludedNonUsRows: window.ordinal,
  limitations: ['Station coverage is incomplete.'],
});

describe('NOAA contextual acquisition', () => {
  it('plans deterministic daily geographic cells with complete inclusion/exclusion accounting', () => {
    const first = plan();
    const second = planNoaaContextualAcquisition({
      publication,
      sightings: [...sightings].reverse(),
      checkedAt: '2026-07-25T00:00:00.000Z',
      plannedAt: '2026-07-25T01:00:00.000Z',
    });
    expect(second).toEqual(first);
    expect(first.accounting).toEqual({
      inputAddressCount: 8,
      plannedAddressCount: 3,
      excludedAddressCount: 5,
      windowCount: 2,
      estimatedProviderCalls: 2,
      minimumDaysAtDailyLimit: 1,
      providerDailyLimit: 10_000,
      providerRequestsPerSecondLimit: 5,
    });
    expect(first.windows[0]).toMatchObject({
      ordinal: 0,
      addresses: ['sighting:a', 'sighting:b'],
      query: {
        start: '2026-07-20T00:00:00.000Z',
        end: '2026-07-21T00:00:00.000Z',
      },
    });
    expect(first.excluded).toEqual([
      { address: 'sighting:future', reason: 'future_dated' },
      { address: 'sighting:missing-location', reason: 'sighting_location_missing' },
      { address: 'sighting:missing-time', reason: 'sighting_time_missing' },
      { address: 'sighting:old', reason: 'outside_lcdv2_period' },
      { address: 'sighting:outside', reason: 'outside_noaa_us_geography' },
    ]);
    expect(first.limitations.join(' ')).toContain('authorizes no provider');
  });

  it('checkpoints a bounded partial run, resumes without duplicate calls and verifies completion', async () => {
    const storage = new MemoryConditionalStorage();
    const acquisitionPlan = plan();
    const acquire = vi.fn(async (window: NoaaContextualAcquisitionWindow) => resultFor(window));
    let nowIndex = 0;
    const now = () => new Date(Date.parse('2026-07-25T02:00:00.000Z') + nowIndex++ * 1_000).toISOString();
    const partial = await acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now,
    });
    expect(partial).toMatchObject({
      status: 'partial',
      resumed: false,
      acquiredThisRun: 1,
      remainingWindows: 1,
      checkpoint: { nextOrdinal: 1, providerCalls: 1, observationCount: 1 },
    });
    const resumed = await acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 10,
      now,
    });
    expect(resumed).toMatchObject({
      status: 'resumed',
      resumed: true,
      acquiredThisRun: 1,
      remainingWindows: 0,
      checkpoint: {
        status: 'complete',
        nextOrdinal: 2,
        providerCalls: 2,
        observationCount: 2,
        excludedNonUsRows: 1,
      },
      completion: { windowCount: 2, providerCalls: 2, observationCount: 2 },
    });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls.map(([window]) => window.ordinal)).toEqual([0, 1]);
    const read = await readCompletedNoaaContextualAcquisition({
      storage,
      plan: acquisitionPlan,
    });
    expect(read.results.map(({ observations }) => observations[0].sourceRecordId)).toEqual([
      'noaa:0',
      'noaa:1',
    ]);
  });

  it('fails closed on artifact tampering before resuming', async () => {
    const storage = new MemoryConditionalStorage();
    const acquisitionPlan = plan();
    await acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire: async (window) => resultFor(window),
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
    });
    const keys = getNoaaContextualAcquisitionKeys(acquisitionPlan.planDigest);
    const artifactKey = [...storage.objects.keys()].find((key) => key.startsWith(`${keys.prefix}windows/`))!;
    const artifact = storage.objects.get(artifactKey)!;
    artifact.body[artifact.body.length - 2] ^= 1;
    await expect(acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire: async (window) => resultFor(window),
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:01.000Z',
    })).rejects.toThrow('noaa_acquisition_window_artifact_missing');
  });

  it('does not advance a checkpoint when compare-and-swap loses a race', async () => {
    const storage = new MemoryConditionalStorage();
    storage.failCheckpointWriteNumber = 2;
    const acquisitionPlan = plan();
    const acquire = vi.fn(async (window: NoaaContextualAcquisitionWindow) => resultFor(window));
    await expect(acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('noaa_acquisition_checkpoint_conflict');
    const keys = getNoaaContextualAcquisitionKeys(acquisitionPlan.planDigest);
    const checkpoint = JSON.parse((await storage.readObject(keys.checkpointKey))!.toString('utf8'));
    expect(checkpoint).toMatchObject({ nextOrdinal: 0, providerCalls: 0, receipts: [] });
    expect(acquire).toHaveBeenCalledTimes(1);

    storage.failCheckpointWriteNumber = null;
    const recovered = await acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:01.000Z',
    });
    expect(recovered).toMatchObject({
      status: 'partial',
      acquiredThisRun: 0,
      recoveredThisRun: 1,
      checkpoint: { nextOrdinal: 1, providerCalls: 1 },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('honours caller cancellation and validates per-run budgets before provider access', async () => {
    const storage = new MemoryConditionalStorage();
    const acquisitionPlan = plan();
    const acquire = vi.fn(async (window: NoaaContextualAcquisitionWindow) => resultFor(window));
    const controller = new AbortController();
    controller.abort();
    await expect(acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
      signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
    expect(acquire).not.toHaveBeenCalled();
    await expect(acquireNoaaContextualWindows({
      storage: new MemoryConditionalStorage(),
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 10_001,
      now: () => '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('noaa_acquisition_run_budget_invalid');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('rejects tampered plans and invalid provider results before archiving them', async () => {
    const acquisitionPlan = plan();
    const tamperedPlan = structuredClone(acquisitionPlan);
    tamperedPlan.windows[0].addresses = ['sighting:substituted'];
    const acquire = vi.fn(async (window: NoaaContextualAcquisitionWindow) => resultFor(window));
    await expect(acquireNoaaContextualWindows({
      storage: new MemoryConditionalStorage(),
      plan: tamperedPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('noaa_acquisition_window_invalid');
    expect(acquire).not.toHaveBeenCalled();

    const storage = new MemoryConditionalStorage();
    await expect(acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire: async (window) => ({
        ...resultFor(window),
        sourceUrl: 'https://example.invalid/substituted',
      }),
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('noaa_acquisition_window_result_invalid');
    const keys = getNoaaContextualAcquisitionKeys(acquisitionPlan.planDigest);
    expect([...storage.objects.keys()].filter((key) => key.startsWith(`${keys.prefix}windows/`))).toEqual([]);
  });

  it('enforces provider clock provenance and the five-request-per-second cadence', async () => {
    const acquisitionPlan = plan();
    const skewedStorage = new MemoryConditionalStorage();
    await expect(acquireNoaaContextualWindows({
      storage: skewedStorage,
      plan: acquisitionPlan,
      acquire: async (window) => resultFor(window, '2026-07-25T03:00:00.000Z'),
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('noaa_acquisition_provider_clock_invalid');
    const keys = getNoaaContextualAcquisitionKeys(acquisitionPlan.planDigest);
    expect([...skewedStorage.objects.keys()].filter(
      (key) => key.startsWith(`${keys.prefix}windows/`),
    )).toEqual([]);

    const cadenceStorage = new MemoryConditionalStorage();
    const acquire = vi.fn(async (window: NoaaContextualAcquisitionWindow) => resultFor(window));
    await expect(acquireNoaaContextualWindows({
      storage: cadenceStorage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 2,
      now: () => '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('noaa_acquisition_provider_cadence_not_observed');
    expect(acquire).toHaveBeenCalledOnce();
  });

  it('shares a CAS-protected daily call budget across runs and fails closed on ledger tampering', async () => {
    const acquisitionPlan = plan();
    const storage = new MemoryConditionalStorage();
    storage.failRateWrites = 1;
    const acquire = vi.fn(async (window: NoaaContextualAcquisitionWindow) => resultFor(window));
    const partial = await acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:00.000Z',
    });
    expect(partial).toMatchObject({ status: 'partial', acquiredThisRun: 1 });
    expect(acquire).toHaveBeenCalledOnce();

    const keys = getNoaaContextualAcquisitionKeys(acquisitionPlan.planDigest);
    const rateKey = keys.rateLedgerKey('2026-07-25');
    const existing = storage.objects.get(rateKey)!;
    const core = {
      recordType: 'noaa_contextual_acquisition_rate_ledger' as const,
      schemaVersion: NOAA_CONTEXTUAL_ACQUISITION_VERSION,
      utcDate: '2026-07-25',
      callCount: 10_000,
      lastReservedAt: '2026-07-25T02:00:00.000Z',
      updatedAt: '2026-07-25T02:00:00.000Z',
    };
    storage.objects.set(rateKey, {
      version: existing.version,
      body: Buffer.from(`${JSON.stringify({
        ...core,
        ledgerDigest: relationshipInputSha256(core),
      })}\n`),
    });
    await expect(acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:01.000Z',
    })).rejects.toThrow('noaa_acquisition_provider_daily_limit_reached');
    expect(acquire).toHaveBeenCalledOnce();

    const tampered = storage.objects.get(rateKey)!;
    tampered.body[tampered.body.length - 2] ^= 1;
    await expect(acquireNoaaContextualWindows({
      storage,
      plan: acquisitionPlan,
      acquire,
      maxWindowsPerRun: 1,
      now: () => '2026-07-25T02:00:01.000Z',
    })).rejects.toThrow('noaa_acquisition_rate_ledger_invalid');
    expect(acquire).toHaveBeenCalledOnce();
  });
});
