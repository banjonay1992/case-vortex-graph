import { describe, expect, it } from 'vitest';

import {
  LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION,
  LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS,
  LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS,
  buildLegacyRelationshipSampleForecast,
  decodeLegacyRelationshipSampleForecast,
  type LegacyForecastKindCounts,
  type LegacySampleArchiveMetric,
  type LegacyV1Node,
} from '../../src/caseGraph/legacyRelationshipSampleForecast';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import type { EvidenceUniverseNodeKind } from '../../src/caseGraph/evidenceUniverse';

const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];

const node = (kind: EvidenceUniverseNodeKind, index = 1): LegacyV1Node => {
  const recordId = `${kind}-${index}`;
  return {
    schemaVersion: 'evidence-universe-v1',
    address: `${kind}:${recordId}`,
    kind,
    recordId,
    source: 'shared-forecast-source',
    sourceRecordId: `${kind}-source-record-${index}`,
    title: 'red triangular light',
    summary: 'A red triangle hovered silently for two minutes.',
    canonicalUrl: `https://example.test/${kind}/${index}`,
    previewUrl: null,
    eventTimestamp: '2026-01-01T00:00:00.000Z',
    lat: 51,
    lon: -3,
    location: 'Test location',
    countryCode: 'GB',
    linkedSightingId: null,
    updatedAt: '2026-07-17T17:00:00.000Z',
    position: [0, 0, 0],
  };
};

const fixture = () => {
  const nodesByKind = Object.fromEntries(KINDS.map((kind) => [kind, [node(kind)]])) as Record<
    EvidenceUniverseNodeKind,
    LegacyV1Node[]
  >;
  const archiveMetrics = Object.fromEntries(KINDS.map((kind, index) => [kind, {
    rowCount: 1,
    uncompressedBytes: 1_000 + index,
    compressedBytes: 250 + index,
    compressedSha256: String(index + 1).repeat(64),
  }])) as Record<EvidenceUniverseNodeKind, LegacySampleArchiveMetric>;
  return {
    sampleDirectory: '/tmp/legacy-relationship-forecast-fixture',
    nodesByKind,
    archiveMetrics,
    targetCounts: { ...LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS },
    sampleSetSha256: 'a'.repeat(64),
    freeDiskBytes: 30 * 1024 ** 3,
  };
};

const rehash = (report: Record<string, unknown>) => {
  const { forecastDigest: _forecastDigest, ...withoutDigest } = report;
  return { ...withoutDigest, forecastDigest: relationshipInputSha256(withoutDigest) };
};

describe('legacy relationship sample forecast', () => {
  it('builds a deterministic lower-bound report with separate legacy and relationship-input bytes', () => {
    const first = buildLegacyRelationshipSampleForecast(fixture());
    const second = buildLegacyRelationshipSampleForecast(fixture());

    expect(first.forecastDigest).toBe(second.forecastDigest);
    expect(first.classification).toBe(LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION);
    expect(first.lowerBoundOnly).toBe(true);
    expect(first.activationEvidence).toBe(false);
    expect(first.externalWritesPerformed).toBe(false);
    expect(first.sourceSample.scope).toBe('complete_local_sample');
    expect(first.sourceSample.sampleTotal).toBe(4);
    expect(first.sourceSample.targetTotal).toBe(466_935);
    expect(first.legacyNodeArchive.meaning).toBe('measured_legacy_v1_nodes_not_relationship_inputs');
    expect(first.extractedRelationshipInputEstimate.meaning)
      .toBe('deterministic_v1_to_v2_projection_without_current_feature_archives');
    expect(first.extractedRelationshipInputEstimate.sampleUncompressedBytes)
      .toBeGreaterThan(first.legacyNodeArchive.sampleUncompressedBytes);
    expect(first.extractedRelationshipInputEstimate.planningInterval.uncompressedBytes.lower)
      .toBe(first.extractedRelationshipInputEstimate.projectedUncompressedBytes);
    expect(first.extractedRelationshipInputEstimate.planningInterval.uncompressedBytes.upper)
      .toBeGreaterThan(first.extractedRelationshipInputEstimate.projectedUncompressedBytes);
    expect(first.postingPressure.samplePostingCount).toBeGreaterThan(4);
    expect(first.postingPressure.projectedPostingPlanningInterval.upper)
      .toBe(first.postingPressure.projectedPostingCount * 2);

    const sourceRoute = first.postingPressure.routes.find((route) => route.routeKind === 'source_identity');
    expect(sourceRoute?.sample.potentialPairRoutes).toBe(6);
    expect(sourceRoute?.projected.capBreachGroupCount).toBe(1);
    expect(sourceRoute?.projected.skippedPotentialPairRoutes).toBeGreaterThan(1_000_000);
    expect(first.diskHardCapRecommendation.activationAllowed).toBe(false);
    expect(decodeLegacyRelationshipSampleForecast(JSON.stringify(first))).toEqual(first);
  });

  it('rejects self-rehashed changes to classification, activation flags, targets, and caps', () => {
    const valid = buildLegacyRelationshipSampleForecast(fixture());
    const mutations: Array<(copy: Record<string, unknown>) => void> = [
      (copy) => { copy.classification = 'activation_ready'; },
      (copy) => { copy.activationEvidence = true; },
      (copy) => {
        const source = copy.sourceSample as Record<string, unknown>;
        source.targetCounts = {
          ...(source.targetCounts as LegacyForecastKindCounts),
          sighting: LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS.sighting - 1,
        };
        source.targetTotal = 466_934;
      },
      (copy) => {
        const pressure = copy.postingPressure as { routes: Array<Record<string, unknown>> };
        pressure.routes[1].postingCap = 501;
      },
      (copy) => {
        const disk = copy.diskHardCapRecommendation as Record<string, unknown>;
        disk.activationAllowed = true;
      },
    ];

    for (const mutate of mutations) {
      const copy = structuredClone(valid) as unknown as Record<string, unknown>;
      mutate(copy);
      expect(() => decodeLegacyRelationshipSampleForecast(rehash(copy))).toThrow();
    }
  });

  it('fails closed on mismatched sample counts and unsafe numeric inputs', () => {
    expect(() => buildLegacyRelationshipSampleForecast({
      ...fixture(),
      expectedSampleCounts: LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS,
    })).toThrow('legacy_relationship_forecast_sample_count_mismatch');

    expect(() => buildLegacyRelationshipSampleForecast({
      ...fixture(),
      freeDiskBytes: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow('legacy_relationship_forecast_free_disk_invalid');

    expect(() => buildLegacyRelationshipSampleForecast({
      ...fixture(),
      targetCounts: {
        ...LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS,
        photo: LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS.photo - 1,
      },
    })).toThrow('legacy_relationship_forecast_target_count_mismatch');
  });

  it('labels a bounded subset explicitly and rejects a dishonest scope', () => {
    const input = fixture();
    const available = { sighting: 2, document: 2, photo: 2, video: 2 };
    const bounded = buildLegacyRelationshipSampleForecast({
      ...input,
      verifiedAvailableCounts: available,
      sampleScope: 'bounded_subset',
    });
    expect(bounded.sourceSample.scope).toBe('bounded_subset');
    expect(bounded.sourceSample.verifiedAvailableCounts).toEqual(available);

    expect(() => buildLegacyRelationshipSampleForecast({
      ...input,
      verifiedAvailableCounts: available,
      sampleScope: 'complete_local_sample',
    })).toThrow('legacy_relationship_forecast_sample_scope_mismatch');
  });
});
