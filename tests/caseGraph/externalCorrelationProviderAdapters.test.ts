import { describe, expect, it, vi } from 'vitest';

import {
  buildAndPublishCaseGraphExternalCorrelations,
  buildCaseGraphExternalCorrelationResultFromAdapters,
  createDecisionPacketGovernedExternalCorrelationProviderAdapter,
  createGovernedExternalCorrelationProviderAdapter,
  type CaseGraphExternalCorrelationProviderAdapter,
} from '../../src/caseGraph/externalCorrelationProviderAdapters';
import {
  buildContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceEntryInput,
} from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'adapter-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1',
  relationshipModelVersion: 'model-v1', relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};
const base = {
  publication, address: 'sighting:case-a', nodeDigest: digest('6'),
  limitPerCategory: 20, checkedAt: '2026-07-21T20:00:00.000Z',
};

const sourceDecisionPacket = (
  weather: Partial<ContextualSourceGovernanceEntryInput> = {},
  maximumEvidenceAgeDays = 30,
) => buildContextualSourceGovernanceDecisionPacket({
  referenceAt: '2026-07-21T19:30:00.000Z',
  maximumEvidenceAgeDays,
  entries: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => ({
    category,
    canonicalSource: category === 'weather' ? 'WEATHER_TEST' : `SOURCE_${category.toUpperCase()}`,
    providerId: category === 'weather' ? 'weather-test' : `provider-${category.replace(/_/g, '-')}`,
    requiredContentMode: 'full_ingest',
    registry: {
      inspectedAt: '2026-07-21T19:00:00.000Z',
      legalStatus: 'approved',
      allowedContentModes: ['full_ingest'],
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
      evidenceId: `terms-${category.replace(/_/g, '-')}`,
      evidenceUrl: `https://example.test/${category}`,
      observedAt: '2026-07-21T18:00:00.000Z',
      evidenceSha256: digest('a'),
      summary: `Approved terms fixture for ${category}.`,
    }],
    limitations: [],
    ...(category === 'weather' ? weather : {}),
  })),
});

describe('bounded external-correlation provider adapters', () => {
  it('runs configured adapters and explicitly marks every unconfigured category unavailable', async () => {
    const weather: CaseGraphExternalCorrelationProviderAdapter = {
      category: 'weather',
      correlate: vi.fn(async () => ({
        availability: 'available', reasonCodes: ['snapshot_covered'],
        explanation: 'A governed weather snapshot covers the event.',
        source: {
          snapshotId: '00000000-0000-4000-8000-000000000099', providerId: 'weather-test',
          datasetVersion: '2026-07-21', coverageStart: '2026-07-21T00:00:00.000Z',
          coverageEnd: '2026-07-22T00:00:00.000Z', acquiredAt: '2026-07-22T01:00:00.000Z',
          sourceUrl: 'https://example.test/weather', license: 'approved test fixture', receiptSha256: digest('7'),
        },
        candidates: [{
          sourceRecordId: 'weather-42', label: 'Low cloud layer', observedAt: '2026-07-21T20:00:00.000Z',
          measurements: { cloud_base_m: 450 }, reasonCodes: ['time_window_match'],
          explanation: 'The observation overlaps the report window.', uncertainty: ['Station is 12 km away.'],
        }],
      })),
    };
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [weather] });
    expect(result.assessments).toHaveLength(9);
    expect(result.assessments.find(({ category }) => category === 'weather')).toMatchObject({
      availability: 'available', candidates: [{ candidateId: expect.stringMatching(/^external-correlation:[a-f0-9]{64}$/) }],
    });
    expect(result.assessments.filter(({ category }) => category !== 'weather'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ availability: 'unavailable', candidates: [] })]));
  });

  it('turns adapter failures into explicit unavailable evidence but propagates cancellation', async () => {
    const failed: CaseGraphExternalCorrelationProviderAdapter = {
      category: 'aircraft', correlate: async () => { throw new Error('database_down'); },
    };
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [failed] });
    expect(result.assessments[0]).toMatchObject({
      category: 'aircraft', availability: 'unavailable', reasonCodes: ['provider_adapter_failed'], candidates: [],
    });
    const cancelled: CaseGraphExternalCorrelationProviderAdapter = {
      category: 'aircraft', correlate: async () => { throw new Error('case_graph_research_aborted'); },
    };
    await expect(buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [cancelled] }))
      .rejects.toThrow('case_graph_research_aborted');
  });

  it('rejects duplicate adapters, unsafe limits and invalid node bindings before provider calls', async () => {
    const weather: CaseGraphExternalCorrelationProviderAdapter = {
      category: 'weather', correlate: vi.fn(),
    };
    await expect(buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [weather, weather] }))
      .rejects.toThrow('case_graph_external_correlation_adapter_plan_invalid');
    await expect(buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [], limitPerCategory: 0 }))
      .rejects.toThrow('case_graph_external_correlation_adapter_plan_invalid');
    await expect(buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [], nodeDigest: 'bad' }))
      .rejects.toThrow('case_graph_external_correlation_adapter_plan_invalid');
    expect(weather.correlate).not.toHaveBeenCalled();
  });

  it('builds every node before publishing one complete deterministic record set', async () => {
    const correlate = vi.fn(async () => ({
      availability: 'unavailable' as const,
      reasonCodes: ['snapshot_not_configured'],
      explanation: 'No governed weather snapshot covers this event.',
      source: null,
      candidates: [],
    }));
    const publish = vi.fn(async ({ records }: { records: Array<{ nodeDigest: string; result: { address: string } }> }) => ({
      status: 'written' as const,
      addresses: records.map(({ result }) => result.address),
    }));
    const progress = vi.fn();
    const transaction = vi.fn();
    const result = await buildAndPublishCaseGraphExternalCorrelations({
      publication,
      nodes: [
        { address: 'sighting:case-a', nodeDigest: digest('6') },
        { address: 'document:case-b', nodeDigest: digest('7') },
      ],
      adapters: [{ category: 'weather', correlate }],
      limitPerCategory: 20,
      checkedAt: '2026-07-21T20:00:00.000Z',
      transaction,
      onProgress: progress,
      publish: publish as never,
    });
    expect(correlate).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].records).toHaveLength(2);
    expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2, address: 'document:case-b' });
    expect(result).toEqual({ status: 'written', addresses: ['sighting:case-a', 'document:case-b'] });
  });

  it('never opens publication after a failed plan or cancellation', async () => {
    const publish = vi.fn();
    const transaction = vi.fn();
    await expect(buildAndPublishCaseGraphExternalCorrelations({
      publication,
      nodes: [
        { address: 'sighting:case-a', nodeDigest: digest('6') },
        { address: 'sighting:case-a', nodeDigest: digest('7') },
      ],
      adapters: [], limitPerCategory: 20, checkedAt: '2026-07-21T20:00:00.000Z',
      transaction, publish,
    })).rejects.toThrow('case_graph_external_correlation_adapter_plan_invalid');
    const controller = new AbortController();
    const adapter: CaseGraphExternalCorrelationProviderAdapter = {
      category: 'weather',
      correlate: async () => {
        controller.abort();
        throw new Error('case_graph_research_aborted');
      },
    };
    await expect(buildAndPublishCaseGraphExternalCorrelations({
      publication,
      nodes: [{ address: 'sighting:case-a', nodeDigest: digest('6') }],
      adapters: [adapter], limitPerCategory: 20, checkedAt: '2026-07-21T20:00:00.000Z',
      transaction, signal: controller.signal, publish,
    })).rejects.toThrow('case_graph_research_aborted');
    expect(publish).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('runs a provider only after an exact approved legal-registry mode decision', async () => {
    const correlate = vi.fn(async () => ({
      availability: 'available' as const,
      reasonCodes: ['snapshot_covered'],
      explanation: 'The governed weather snapshot covers the event.',
      source: {
        snapshotId: '00000000-0000-4000-8000-000000000099', providerId: 'weather-test',
        datasetVersion: '2026-07-21', coverageStart: '2026-07-21T00:00:00.000Z',
        coverageEnd: '2026-07-22T00:00:00.000Z', acquiredAt: '2026-07-22T01:00:00.000Z',
        sourceUrl: 'https://example.test/weather', license: 'approved test fixture', receiptSha256: digest('7'),
      },
      candidates: [],
    }));
    const inspectGovernance = vi.fn(async () => ({
      present: true, canonicalSource: 'WEATHER_TEST', legalStatus: 'approved',
      allowedContentModes: ['full_ingest'],
    }));
    const adapter = createGovernedExternalCorrelationProviderAdapter({
      category: 'weather', canonicalSource: 'weather_test', providerId: 'weather-test',
      allowedContentModes: ['full_ingest'], inspectGovernance, correlate,
    });
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [adapter] });
    expect(inspectGovernance).toHaveBeenCalledWith(expect.objectContaining({
      canonicalSource: 'WEATHER_TEST', category: 'weather',
    }));
    expect(correlate).toHaveBeenCalledTimes(1);
    expect(result.assessments.at(-1)).toMatchObject({ availability: 'available', source: { providerId: 'weather-test' } });
  });

  it.each([
    [{ present: false, canonicalSource: 'WEATHER_TEST', legalStatus: 'review', allowedContentModes: null }, 'source_governance_missing'],
    [{ present: true, canonicalSource: 'WEATHER_TEST', legalStatus: 'review', allowedContentModes: ['full_ingest'] }, 'source_governance_not_approved'],
    [{ present: true, canonicalSource: 'WEATHER_TEST', legalStatus: 'approved', allowedContentModes: ['metadata_only'] }, 'source_governance_mode_not_approved'],
  ])('fails closed before provider access for governance decision %#', async (decision, reasonCode) => {
    const correlate = vi.fn();
    const adapter = createGovernedExternalCorrelationProviderAdapter({
      category: 'weather', canonicalSource: 'WEATHER_TEST', providerId: 'weather-test',
      allowedContentModes: ['full_ingest'], inspectGovernance: async () => decision, correlate,
    });
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [adapter] });
    expect(result.assessments.at(-1)).toMatchObject({
      availability: 'unavailable', reasonCodes: [reasonCode], source: null, candidates: [],
    });
    expect(correlate).not.toHaveBeenCalled();
  });

  it.each(['available', 'insufficient_evidence'] as const)(
    'fails closed when an approved adapter returns a different provider snapshot identity for %s coverage',
    async (availability) => {
    const adapter = createGovernedExternalCorrelationProviderAdapter({
      category: 'weather', canonicalSource: 'WEATHER_TEST', providerId: 'weather-test',
      allowedContentModes: ['full_ingest'],
      inspectGovernance: async () => ({
        present: true, canonicalSource: 'WEATHER_TEST', legalStatus: 'approved', allowedContentModes: ['full_ingest'],
      }),
      correlate: async () => ({
        availability, reasonCodes: ['snapshot_covered'], explanation: 'Covered.',
        source: {
          snapshotId: '00000000-0000-4000-8000-000000000099', providerId: 'wrong-provider',
          datasetVersion: '1', coverageStart: null, coverageEnd: null,
          acquiredAt: '2026-07-22T01:00:00.000Z', sourceUrl: null, license: null, receiptSha256: digest('7'),
        },
        candidates: [],
      }),
    });
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [adapter] });
    expect(result.assessments.at(-1)).toMatchObject({
      availability: 'unavailable', reasonCodes: ['provider_snapshot_identity_mismatch'], source: null,
    });
    },
  );

  it('requires both the signed source decision and live registry to approve before provider access', async () => {
    const correlate = vi.fn(async () => ({
      availability: 'available' as const,
      reasonCodes: ['snapshot_covered'],
      explanation: 'The governed weather snapshot covers the event.',
      source: {
        snapshotId: '00000000-0000-4000-8000-000000000099',
        providerId: 'weather-test',
        datasetVersion: '2026-07-21',
        coverageStart: null,
        coverageEnd: null,
        acquiredAt: '2026-07-21T19:45:00.000Z',
        sourceUrl: 'https://example.test/weather',
        license: 'approved test fixture',
        receiptSha256: digest('7'),
      },
      candidates: [],
    }));
    const inspectGovernance = vi.fn(async () => ({
      present: true,
      canonicalSource: 'WEATHER_TEST',
      legalStatus: 'approved',
      allowedContentModes: ['full_ingest'],
    }));
    const adapter = createDecisionPacketGovernedExternalCorrelationProviderAdapter({
      category: 'weather',
      canonicalSource: 'WEATHER_TEST',
      providerId: 'weather-test',
      requiredContentMode: 'full_ingest',
      decisionPacket: sourceDecisionPacket(),
      inspectGovernance,
      correlate,
    });
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({ ...base, adapters: [adapter] });
    expect(result.assessments.at(-1)).toMatchObject({ availability: 'available' });
    expect(inspectGovernance).toHaveBeenCalledTimes(1);
    expect(correlate).toHaveBeenCalledTimes(1);
  });

  it('explains unapproved and stale signed decisions without consulting or calling the provider', async () => {
    const inspectGovernance = vi.fn();
    const correlate = vi.fn();
    const reviewAdapter = createDecisionPacketGovernedExternalCorrelationProviderAdapter({
      category: 'weather',
      canonicalSource: 'WEATHER_TEST',
      providerId: 'weather-test',
      requiredContentMode: 'full_ingest',
      decisionPacket: sourceDecisionPacket({
        registry: {
          inspectedAt: '2026-07-21T19:00:00.000Z',
          legalStatus: 'review',
          allowedContentModes: ['metadata_only'],
        },
      }),
      inspectGovernance,
      correlate,
    });
    const review = await buildCaseGraphExternalCorrelationResultFromAdapters({
      ...base,
      adapters: [reviewAdapter],
    });
    expect(review.assessments.at(-1)).toMatchObject({
      availability: 'unavailable',
      reasonCodes: ['source_decision_review_required'],
      explanation: expect.stringContaining('source_registry_review'),
    });

    const staleAdapter = createDecisionPacketGovernedExternalCorrelationProviderAdapter({
      category: 'weather',
      canonicalSource: 'WEATHER_TEST',
      providerId: 'weather-test',
      requiredContentMode: 'full_ingest',
      decisionPacket: sourceDecisionPacket({}, 1),
      inspectGovernance,
      correlate,
    });
    const stale = await buildCaseGraphExternalCorrelationResultFromAdapters({
      ...base,
      checkedAt: '2026-07-23T20:00:00.000Z',
      adapters: [staleAdapter],
    });
    expect(stale.assessments.at(-1)).toMatchObject({
      availability: 'unavailable',
      reasonCodes: ['source_decision_packet_stale'],
    });
    expect(inspectGovernance).not.toHaveBeenCalled();
    expect(correlate).not.toHaveBeenCalled();
  });
});
