import { describe, expect, it, vi } from 'vitest';

import {
  acquireDvidsMilitaryExerciseReferences,
  materializeVerifiedDvidsMilitaryExerciseAcquisition,
  planDvidsMilitaryExerciseAcquisition,
  verifyDvidsMilitaryExerciseAcquisitionCompletion,
} from '../../src/caseGraph/dvidsMilitaryExerciseAcquisition';
import {
  buildContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceEntryInput,
} from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'dvids-acquisition-v1',
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

const sightings = [
  {
    address: 'sighting:a',
    nodeDigest: digest('a'),
    eventTimestamp: '2026-07-21T20:00:00.000Z',
    locationLabel: 'Killeen, Texas, United States',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
  {
    address: 'sighting:b',
    nodeDigest: digest('b'),
    eventTimestamp: '2026-07-04T12:00:00.000Z',
    locationLabel: 'Killeen, Texas, United States',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
  {
    address: 'sighting:future',
    nodeDigest: digest('c'),
    eventTimestamp: '2026-08-01T00:00:00.000Z',
    locationLabel: 'Killeen, Texas',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
  {
    address: 'sighting:missing-city',
    nodeDigest: digest('d'),
    eventTimestamp: '2026-07-21T20:00:00.000Z',
    locationLabel: null,
    city: null,
    region: 'Texas',
    country: 'United States',
  },
  {
    address: 'sighting:missing-time',
    nodeDigest: digest('e'),
    eventTimestamp: null,
    locationLabel: 'Killeen, Texas',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
];

const plan = () => planDvidsMilitaryExerciseAcquisition({
  publication,
  sightings,
  checkedAt: '2026-07-25T00:00:00.000Z',
  plannedAt: '2026-07-25T01:00:00.000Z',
});

const decisionPacket = (
  military: Partial<ContextualSourceGovernanceEntryInput> = {},
) => buildContextualSourceGovernanceDecisionPacket({
  referenceAt: '2026-07-24T12:00:00.000Z',
  maximumEvidenceAgeDays: 30,
  entries: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => ({
    category,
    canonicalSource: category === 'military_exercise'
      ? 'DVIDS'
      : `SOURCE_${category.toUpperCase()}`,
    providerId: category === 'military_exercise'
      ? 'dvids-exercise-reference'
      : `provider-${category.replace(/_/gu, '-')}`,
    requiredContentMode: category === 'military_exercise' ? 'metadata_only' : 'full_ingest',
    registry: {
      inspectedAt: '2026-07-24T11:00:00.000Z',
      legalStatus: 'approved',
      allowedContentModes: category === 'military_exercise' ? ['metadata_only'] : ['full_ingest'],
    },
    rights: {
      commercialUse: 'allowed',
      automatedAccess: 'allowed',
      archivalUse: 'allowed',
      redistribution: 'allowed',
      accessConstraint: 'none',
      attributionRequired: true,
    },
    evidence: [{
      evidenceId: `terms-${category.replace(/_/gu, '-')}`,
      evidenceUrl: `https://example.test/${category}`,
      observedAt: '2026-07-24T10:00:00.000Z',
      evidenceSha256: digest('f'),
      summary: `Approved terms fixture for ${category}.`,
    }],
    limitations: [],
    ...(category === 'military_exercise' ? military : {}),
  })),
});

const result = (id: number) => ({
  id: `image:${id}`,
  type: 'image',
  title: 'Military training exercise readiness drill gunnery MCCRE war game',
  short_description: 'Personnel conduct a bounded training event.',
  keywords: 'exercise, training, drill, readiness, gunnery, MCCRE, war game',
  date: '2026-07-21T18:00:00Z',
  date_published: '2026-07-22T09:00:00Z',
  city: 'Killeen',
  state: 'Texas',
  country: 'United States',
  unit_name: '1st Cavalry Division',
  branch: 'Army',
  hls_url: `https://api.dvidshub.net/hls/video/${id}.m3u8?api_key=fixture-key`,
  url: `https://www.dvidshub.net/image/${id}/military-training-event`,
});

const body = (results: unknown[], totalResults: number) => JSON.stringify({
  page_info: { total_results: totalResults, results_per_page: 50 },
  results,
});

describe('DVIDS military-exercise acquisition', () => {
  it('plans deterministic location-month searches with complete inclusion and exclusion accounting', () => {
    const first = plan();
    const reversed = planDvidsMilitaryExerciseAcquisition({
      publication,
      sightings: [...sightings].reverse(),
      checkedAt: '2026-07-25T00:00:00.000Z',
      plannedAt: '2026-07-25T01:00:00.000Z',
    });
    expect(reversed).toEqual(first);
    expect(first.accounting).toEqual({
      inputAddressCount: 5,
      plannedAddressCount: 2,
      excludedAddressCount: 3,
      locationMonthGroupCount: 1,
      queryCount: 7,
      maximumProviderCalls: 140,
      maximumAccessibleResultsPerQuery: 1000,
      maximumResultsPerPage: 50,
    });
    expect(first.excluded).toEqual([
      { address: 'sighting:future', reason: 'future_dated' },
      { address: 'sighting:missing-city', reason: 'sighting_city_missing' },
      { address: 'sighting:missing-time', reason: 'sighting_time_missing' },
    ]);
    expect(first.queries[0]).toMatchObject({
      ordinal: 0,
      term: 'exercise',
      city: 'Killeen',
      region: 'Texas',
      countryCode: 'US',
      fromDate: '2026-07-01T00:00:00.000Z',
      toDate: '2026-08-01T00:00:00.000Z',
      addresses: ['sighting:a', 'sighting:b'],
    });
    expect(first.queries[0].firstPageUrl).toContain('max_results=50');
    expect(first.queries[0].firstPageUrl).not.toContain('api_key');
    expect(first.limitations.join(' ')).toContain('not a complete military-exercise schedule');
  });

  it('blocks before registry inspection and provider access when the signed decision is review-only', async () => {
    const inspectGovernance = vi.fn();
    const fetchPage = vi.fn();
    const resultValue = await acquireDvidsMilitaryExerciseReferences({
      plan: plan(),
      decisionPacket: decisionPacket({
        registry: {
          inspectedAt: '2026-07-24T11:00:00.000Z',
          legalStatus: 'review',
          allowedContentModes: ['metadata_only'],
        },
      }),
      inspectGovernance,
      apiKey: 'fixture-key',
      fetchPage,
      completedAt: '2026-07-25T02:00:00.000Z',
    });
    expect(resultValue).toMatchObject({
      status: 'blocked',
      reasonCodes: ['source_decision_review_required'],
      providerCallCount: 0,
    });
    expect(inspectGovernance).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('captures every accessible page after both gates and deduplicates overlapping term results', async () => {
    const inspectGovernance = vi.fn(async () => ({
      present: true,
      canonicalSource: 'DVIDS',
      legalStatus: 'approved',
      allowedContentModes: ['metadata_only'],
    }));
    const fetchPage = vi.fn(async ({ requestUrl, apiKey }: {
      requestUrl: string;
      apiKey: string;
    }) => {
      expect(apiKey).toBe('fixture-key');
      expect(requestUrl).not.toContain('fixture-key');
      const url = new URL(requestUrl);
      const term = url.searchParams.get('q');
      const page = Number(url.searchParams.get('page'));
      const isFirstQuery = term === 'exercise';
      const rows = isFirstQuery
        ? page === 1
          ? Array.from({ length: 50 }, (_, index) => result(1_000_000 + index))
          : [result(1_000_050)]
        : [result(1_000_000)];
      return {
        body: body(rows, isFirstQuery ? 51 : 1),
        acquiredAt: '2026-07-25T01:30:00.000Z',
      };
    });
    const acquisitionPlan = plan();
    const approvedDecision = decisionPacket();
    const acquired = await acquireDvidsMilitaryExerciseReferences({
      plan: acquisitionPlan,
      decisionPacket: approvedDecision,
      inspectGovernance,
      apiKey: 'fixture-key',
      fetchPage,
      completedAt: '2026-07-25T02:00:00.000Z',
    });
    expect(acquired).toMatchObject({
      status: 'complete',
      providerCallCount: 8,
      completion: {
        queryCount: 7,
        providerCallCount: 8,
        retainedReferenceCount: 51,
        duplicateReferenceCount: 6,
        excludedNonExerciseResults: 0,
      },
    });
    if (acquired.status !== 'complete') throw new Error('expected_complete');
    expect(acquired.completion.queryReceipts[0]).toMatchObject({
      totalResults: 51,
      accessibleResults: 51,
      pageCount: 2,
    });
    expect(acquired.completion.collection.pageCount).toBe(8);
    expect(JSON.stringify(acquired)).not.toContain('fixture-key');
    expect(verifyDvidsMilitaryExerciseAcquisitionCompletion({
      plan: acquisitionPlan,
      decisionPacket: approvedDecision,
      completion: acquired.completion,
    })).toEqual(acquired.completion);

    const materialize = vi.fn(async () => ({ status: 'fixture-written' as const }));
    await expect(materializeVerifiedDvidsMilitaryExerciseAcquisition({
      plan: acquisitionPlan,
      decisionPacket: approvedDecision,
      completion: acquired.completion,
      snapshot: {
        snapshotId: '00000000-0000-4000-8000-000000000099',
        publication,
        category: 'military_exercise',
        canonicalSource: 'DVIDS',
        contentMode: 'metadata_only',
        providerId: 'dvids-exercise-reference',
        datasetVersion: `dvids-search:${acquired.completion.collection.collectionSha256}`,
        coverageStart: '2026-07-01T00:00:00.000Z',
        coverageEnd: '2026-08-01T00:00:00.000Z',
        acquiredAt: acquired.completion.completedAt,
        sourceUrl: 'https://api.dvidshub.net/docs/search_api',
        license: 'fixture',
      },
      run: async () => ({ rows: [] }),
      transaction: async (work) => work(async () => ({ rows: [] })),
      putArchiveObject: async () => {},
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => ({
        sha256: expectedSha256,
        bytes: expectedBytes,
      }),
      maxTimeDeltaDays: 31,
      limitPerAddress: 5,
      materialize: materialize as never,
    })).resolves.toEqual({ status: 'fixture-written' });
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      collection: acquired.completion.collection,
      decisionPacket: approvedDecision,
    }));

    const resealed = structuredClone(acquired.completion);
    resealed.queryReceipts[0].responseSha256s[0] = digest('9');
    const { receiptDigest: _receiptDigest, ...receiptCore } = resealed.queryReceipts[0];
    resealed.queryReceipts[0].receiptDigest = relationshipInputSha256(receiptCore);
    const { completionDigest: _completionDigest, ...completionCore } = resealed;
    resealed.completionDigest = relationshipInputSha256(completionCore);
    materialize.mockClear();
    await expect(materializeVerifiedDvidsMilitaryExerciseAcquisition({
      plan: acquisitionPlan,
      decisionPacket: approvedDecision,
      completion: resealed,
      snapshot: {
        snapshotId: '00000000-0000-4000-8000-000000000099',
        publication,
        category: 'military_exercise',
        canonicalSource: 'DVIDS',
        contentMode: 'metadata_only',
        providerId: 'dvids-exercise-reference',
        datasetVersion: `dvids-search:${resealed.collection.collectionSha256}`,
        coverageStart: '2026-07-01T00:00:00.000Z',
        coverageEnd: '2026-08-01T00:00:00.000Z',
        acquiredAt: resealed.completedAt,
        sourceUrl: 'https://api.dvidshub.net/docs/search_api',
        license: 'fixture',
      },
      run: async () => ({ rows: [] }),
      transaction: async (work) => work(async () => ({ rows: [] })),
      putArchiveObject: async () => {},
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => ({
        sha256: expectedSha256,
        bytes: expectedBytes,
      }),
      maxTimeDeltaDays: 31,
      limitPerAddress: 5,
      materialize: materialize as never,
    })).rejects.toThrow('dvids_military_acquisition_completion_page_mismatch');
    expect(materialize).not.toHaveBeenCalled();
    expect(inspectGovernance).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(8);
  });

  it('fails closed on pagination drift, cancellation and a re-sealed plan mutation', async () => {
    const inspectGovernance = vi.fn(async () => ({
      present: true,
      canonicalSource: 'DVIDS',
      legalStatus: 'approved',
      allowedContentModes: ['metadata_only'],
    }));
    let call = 0;
    await expect(acquireDvidsMilitaryExerciseReferences({
      plan: plan(),
      decisionPacket: decisionPacket(),
      inspectGovernance,
      apiKey: 'fixture-key',
      fetchPage: async () => {
        call += 1;
        return {
          body: body(
            call === 1
              ? Array.from({ length: 50 }, (_, index) => result(2_000_000 + index))
              : [result(2_000_050)],
            call === 1 ? 51 : 52,
          ),
          acquiredAt: '2026-07-25T01:30:00.000Z',
        };
      },
      completedAt: '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('dvids_military_acquisition_pagination_drift');

    const controller = new AbortController();
    controller.abort();
    const fetchPage = vi.fn();
    await expect(acquireDvidsMilitaryExerciseReferences({
      plan: plan(),
      decisionPacket: decisionPacket(),
      inspectGovernance,
      apiKey: 'fixture-key',
      fetchPage,
      completedAt: '2026-07-25T02:00:00.000Z',
      signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
    expect(fetchPage).not.toHaveBeenCalled();

    const mutated = structuredClone(plan());
    mutated.queries[0].city = 'Changed city';
    await expect(acquireDvidsMilitaryExerciseReferences({
      plan: mutated,
      decisionPacket: decisionPacket(),
      inspectGovernance,
      apiKey: 'fixture-key',
      fetchPage,
      completedAt: '2026-07-25T02:00:00.000Z',
    })).rejects.toThrow('dvids_military_acquisition_plan_invalid');
  });
});
