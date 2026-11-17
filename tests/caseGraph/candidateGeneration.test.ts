import { describe, expect, it } from 'vitest';

import type { CaseGraphCorpusRarity } from '../../src/caseGraph/corpusRarity';
import { extractCaseGraphFeatures, type CaseGraphFeatureRecord } from '../../src/caseGraph/featureExtraction';
import { generateCaseGraphCandidates } from '../../src/caseGraph/candidateGeneration';

const corpusVersion = 'candidate-corpus-v1';
const feature = (input: Record<string, unknown>): CaseGraphFeatureRecord => {
  const result = extractCaseGraphFeatures(input, { corpusVersion, eligibility: { eligible: true } });
  if (result.status !== 'included') throw new Error('expected included record');
  return result;
};
const rarity = (values: Record<string, number>): CaseGraphCorpusRarity => ({
  version: 'case-graph-rarity-v1',
  corpusVersion,
  documentCount: 100,
  documentFrequency: {},
  rarity: values,
});

describe('case graph candidate generation', () => {
  it('generates deterministic rare-term candidates regardless of input order', () => {
    const left = feature({ id: 'b', description: 'A rare amber chevron hovered.' });
    const right = feature({ id: 'a', description: 'An amber chevron disappeared.' });
    const termRarity = rarity({ amber: 0.1, chevron: 0.9 });
    const forward = generateCaseGraphCandidates([left, right], termRarity, { shardId: 'shard-1' });
    const reverse = generateCaseGraphCandidates([right, left], termRarity, { shardId: 'shard-1' });

    expect(forward).toEqual(reverse);
    expect(forward.candidates).toEqual([{
      pairKey: 'a::b',
      leftCaseId: 'a',
      rightCaseId: 'b',
      reasons: ['rare_visual_term'],
      sharedTerms: ['chevron'],
    }]);
    expect(forward.manifest).toMatchObject({
      inputCaseCount: 2,
      accountedCaseCount: 2,
      casesWithCandidates: 2,
      isolatedCaseCount: 0,
    });
  });

  it('finds cases across adjacent exact space-time buckets', () => {
    const left = feature({
      id: 'left', event_timestamp: '2025-01-01T05:59:00Z', event_date_precision: 'exact',
      lat: 50.99, lon: -5.01, geo_precision: 'exact',
    });
    const right = feature({
      id: 'right', event_timestamp: '2025-01-01T06:01:00Z', event_date_precision: 'exact',
      lat: 51.01, lon: -4.99, geo_precision: 'city',
    });
    const result = generateCaseGraphCandidates([left, right], rarity({}), { shardId: 'spacetime' });

    expect(result.candidates[0]).toMatchObject({
      pairKey: 'left::right',
      reasons: ['spacetime_exact_bucket'],
    });
    expect(result.manifest.exactSpacetimeCaseCount).toBe(2);
  });

  it('does not create space-time candidates from coarse temporal or geographic precision', () => {
    const left = feature({
      id: 'left', event_timestamp: '2025-01-01', event_date_precision: 'month',
      lat: 50, lon: -5, geo_precision: 'region',
    });
    const right = feature({
      id: 'right', event_timestamp: '2025-01-01', event_date_precision: 'year',
      lat: 50, lon: -5, geo_precision: 'country',
    });
    const result = generateCaseGraphCandidates([left, right], rarity({}), { shardId: 'coarse' });

    expect(result.candidates).toEqual([]);
    expect(result.manifest).toMatchObject({ isolatedCaseCount: 2, exactSpacetimeCaseCount: 0, daySpacetimeCaseCount: 0 });
  });

  it('creates provenance candidates for matching governed source records', () => {
    const left = feature({ id: 'left', source: 'archive', source_record_id: 'record-42' });
    const right = feature({ id: 'right', source: 'archive', source_record_id: 'record-42' });
    const result = generateCaseGraphCandidates([left, right], rarity({}), { shardId: 'provenance' });

    expect(result.candidates[0]).toMatchObject({ reasons: ['same_source_record'] });
  });

  it('audits oversized postings rather than silently creating an edge explosion', () => {
    const records = [
      feature({ id: 'a', source: 'archive', source_record_id: 'landing', description: 'rare chevron' }),
      feature({ id: 'b', source: 'archive', source_record_id: 'landing', description: 'rare chevron' }),
      feature({ id: 'c', source: 'archive', source_record_id: 'landing', description: 'rare chevron' }),
    ];
    const result = generateCaseGraphCandidates(records, rarity({ chevron: 0.99 }), {
      shardId: 'bounded',
      maxTermPostings: 2,
      maxSourceRecordPostings: 2,
    });

    expect(result.candidates).toEqual([]);
    expect(result.manifest.skippedHighFrequencyTerms).toEqual([{ term: 'chevron', postings: 3 }]);
    expect(result.manifest.skippedOversizedSourceRecords).toEqual([{
      sourceRecord: 'archive::landing', postings: 3,
    }]);
    expect(result.manifest).toMatchObject({ accountedCaseCount: 3, isolatedCaseCount: 3 });
  });

  it('audits and skips dense space-time buckets rather than expanding them quadratically', () => {
    const records = ['a', 'b', 'c'].map((id) => feature({
      id,
      event_timestamp: '2025-01-01T12:00:00Z',
      event_date_precision: 'exact',
      lat: 50.1,
      lon: -5.1,
      geo_precision: 'city',
    }));
    const result = generateCaseGraphCandidates(records, rarity({}), {
      shardId: 'dense-spacetime',
      maxSpatialBucketRecords: 2,
    });

    expect(result.candidates).toEqual([]);
    expect(result.manifest.skippedOversizedSpatialBuckets).toHaveLength(1);
    expect(result.manifest.skippedOversizedSpatialBuckets[0]).toMatchObject({ postings: 3 });
  });

  it('fails closed when a shard would exceed its candidate budget', () => {
    const records = [
      feature({ id: 'a', description: 'rare chevron' }),
      feature({ id: 'b', description: 'rare chevron' }),
      feature({ id: 'c', description: 'rare chevron' }),
    ];
    expect(() => generateCaseGraphCandidates(records, rarity({ chevron: 0.99 }), {
      shardId: 'limited',
      maxCandidates: 1,
      maxTermPostings: 10,
    })).toThrow('case_graph_candidate_limit_exceeded:1');
  });

  it('rejects duplicate IDs, mixed corpus versions and missing shard IDs', () => {
    const left = feature({ id: 'left' });
    expect(() => generateCaseGraphCandidates([left, left], rarity({}), { shardId: 'duplicate' }))
      .toThrow('case_graph_duplicate_case_id:left');
    expect(() => generateCaseGraphCandidates([{ ...left, corpusVersion: 'other' }], rarity({}), { shardId: 'mixed' }))
      .toThrow('case_graph_corpus_version_mismatch');
    expect(() => generateCaseGraphCandidates([left], rarity({}), { shardId: ' ' }))
      .toThrow('case_graph_shard_id_required');
  });
});
