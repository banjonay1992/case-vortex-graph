import { describe, expect, it } from 'vitest';

import { buildCaseGraphCorpusRarity } from '../../src/caseGraph/corpusRarity';
import { extractCaseGraphFeatures, type CaseGraphFeatureRecord } from '../../src/caseGraph/featureExtraction';
import { buildCaseGraphPairEvidence, caseGraphPairKey } from '../../src/caseGraph/pairEvidence';

const corpusVersion = 'corpus-pair-test';
const feature = (input: Record<string, unknown>): CaseGraphFeatureRecord => {
  const result = extractCaseGraphFeatures(input, {
    corpusVersion,
    eligibility: { eligible: true },
  });
  if (result.status !== 'included') throw new Error('expected included feature');
  return result;
};

describe('case graph pair evidence', () => {
  it('joins structured features, time, distance, duration and corpus rarity', () => {
    const left = feature({
      id: 'left', source: 'archive-a', event_timestamp: '2025-01-01T12:00:00Z', event_date_precision: 'exact',
      lat: 50, lon: -5, geo_precision: 'exact', duration_seconds: 100,
      description: 'Three amber lights hovered silently near RAF Culdrose.',
      ai_entities: ['RAF Culdrose'],
    });
    const right = feature({
      id: 'right', source: 'archive-b', event_timestamp: '2025-01-01T12:30:00Z', event_date_precision: 'exact',
      lat: 50.1, lon: -5, geo_precision: 'city', duration_seconds: 80,
      description: 'Three amber lights hovered silently beside RAF Culdrose.',
      ai_entities: [{ name: 'RAF Culdrose' }],
    });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);
    const evidence = buildCaseGraphPairEvidence(left, right, rarity, {
      independentSourcePairs: new Set([caseGraphPairKey('archive-a', 'archive-b')]),
    });

    expect(evidence).toMatchObject({
      timeDeltaSeconds: 1_800,
      temporalPrecision: 'exact',
      spatialPrecisionKm: 25,
      durationSimilarity: 0.8,
      sourceIndependence: 'independent',
    });
    expect(evidence.distanceKm).toBeGreaterThan(11);
    expect(evidence.distanceKm).toBeLessThan(12);
    expect(evidence.sharedVisual?.map((item) => item.term)).toEqual(['amber', 'light count 3']);
    expect(evidence.sharedBehaviour?.map((item) => item.term)).toEqual(['hover']);
    expect(evidence.sharedSensory?.map((item) => item.term)).toEqual(['silent']);
    expect(evidence.sharedEntities?.map((item) => item.term)).toEqual(['raf culdrose']);
  });

  it('never infers source independence merely from different source labels', () => {
    const left = feature({ id: 'left', source: 'archive-a', description: 'amber disk' });
    const right = feature({ id: 'right', source: 'archive-b', description: 'amber disk' });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);

    expect(buildCaseGraphPairEvidence(left, right, rarity).sourceIndependence).toBe('unknown');
  });

  it('marks shared ingestion and source lineages as dependent', () => {
    const left = feature({ id: 'left', source: 'archive-a', ingestion_job_id: 'job-1', description: 'amber disk' });
    const right = feature({ id: 'right', source: 'archive-b', ingestion_job_id: 'job-1', description: 'amber disk' });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);

    expect(buildCaseGraphPairEvidence(left, right, rarity).sourceIndependence).toBe('dependent');
    expect(buildCaseGraphPairEvidence(left, { ...right, ingestionJobId: 'job-2' }, rarity, {
      sourceLineageBySource: { 'archive-a': 'shared-feed', 'archive-b': 'shared-feed' },
    }).sourceIndependence).toBe('dependent');
  });

  it('uses the governed registry to catch aliases of the same source lineage', () => {
    const left = feature({ id: 'left', source: 'cufos', description: 'amber disk' });
    const right = feature({ id: 'right', source: 'cufos_ufocat', description: 'amber disk' });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);

    expect(buildCaseGraphPairEvidence(left, right, rarity).sourceIndependence).toBe('dependent');
  });

  it('disables precise spatial evidence when either coordinate precision is unknown', () => {
    const left = feature({ id: 'left', source: 'a', lat: 50, lon: -5, geo_precision: 'exact' });
    const right = feature({ id: 'right', source: 'b', lat: 50.001, lon: -5, geo_precision: 'unknown' });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);

    expect(buildCaseGraphPairEvidence(left, right, rarity)).toMatchObject({
      spatialPrecisionKm: 1_000,
      sourceIndependence: 'unknown',
    });
  });

  it('recognizes governed duplicate, record and cross-reference provenance', () => {
    const left = feature({ id: 'left', source: 'archive', source_record_id: 'record-1' });
    const right = feature({ id: 'right', source: 'archive', source_record_id: 'record-1' });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);
    const evidence = buildCaseGraphPairEvidence(left, right, rarity, {
      duplicateClusterIdsByCase: { left: 'cluster-1', right: 'cluster-1' },
      explicitCrossReferencePairs: new Set([caseGraphPairKey('right', 'left')]),
    });

    expect(evidence).toMatchObject({
      explicitCrossReference: true,
      sameSourceRecord: true,
      sameDuplicateCluster: true,
      sourceIndependence: 'dependent',
    });
  });

  it('rejects mixed corpus versions and self-pairs', () => {
    const left = feature({ id: 'left' });
    const right = feature({ id: 'right' });
    const rarity = buildCaseGraphCorpusRarity([left, right], corpusVersion);

    expect(() => buildCaseGraphPairEvidence(left, { ...right, corpusVersion: 'other' }, rarity))
      .toThrow('case_graph_corpus_version_mismatch');
    expect(() => buildCaseGraphPairEvidence(left, left, rarity))
      .toThrow('case_graph_pair_requires_distinct_cases');
  });
});
