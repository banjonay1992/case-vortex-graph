import { describe, expect, it } from 'vitest';

import { buildCaseGraphCorpusRarity } from '../../src/caseGraph/corpusRarity';
import { buildCaseGraphPostingFragments, deduplicateCaseGraphRelationships, reduceCaseGraphPostingFragments } from '../../src/caseGraph/candidateRouting';
import { extractCaseGraphFeatures, type CaseGraphFeatureRecord } from '../../src/caseGraph/featureExtraction';

const feature = (id: string, description: string, overrides: Record<string, unknown> = {}) => {
  const result = extractCaseGraphFeatures({
    id,
    source: 'archive-a',
    event_timestamp: '2026-07-17T12:00:00Z',
    event_date_precision: 'exact',
    lat: 51.5,
    lon: -0.1,
    geo_precision: 'exact',
    duration_seconds: 60,
    description,
    ...overrides,
  }, { corpusVersion: 'routing-v1', eligibility: { eligible: true } });
  if (result.status !== 'included') throw new Error('fixture excluded');
  return result;
};

const left = feature('00000000-0000-4000-8000-000000000001', 'Rare amber chevron hovered silently.');
const right = feature('00000000-0000-4000-8000-000000000002', 'An amber chevron hovered silently.', {
  source: 'archive-b',
  event_timestamp: '2026-07-17T12:05:00Z',
  lat: 51.51,
  lon: -0.09,
});
const unrelated = feature('00000000-0000-4000-8000-000000000003', 'A white light moved east.', {
  event_timestamp: '2022-01-01T00:00:00Z',
  lat: -33,
  lon: 151,
});

const fragmentsForShard = (
  parts: CaseGraphFeatureRecord[][],
  rarity: ReturnType<typeof buildCaseGraphCorpusRarity>,
  shard: number,
  shardCount = 8,
) => parts.flatMap((records, inputPartNumber) => buildCaseGraphPostingFragments({
  records, rarity, inputPartNumber, reducerShardCount: shardCount, minimumTermRarity: 0,
})).filter((fragment) => fragment.reducerShard === shard);

describe('case graph global candidate routing', () => {
  it('finds and scores relationships across different feature archive parts', () => {
    const rarity = buildCaseGraphCorpusRarity([left, right, unrelated], 'routing-v1');
    const mapped = [left, right, unrelated].map((record, inputPartNumber) => buildCaseGraphPostingFragments({
      records: [record], rarity, inputPartNumber, reducerShardCount: 8, minimumTermRarity: 0,
    }));
    const reduced = Array.from({ length: 8 }, (_, shard) => {
      const fragments = mapped.flat().filter((fragment) => fragment.reducerShard === shard);
      return fragments.length ? reduceCaseGraphPostingFragments({ fragments, rarity }) : null;
    }).filter(Boolean);
    const relationships = deduplicateCaseGraphRelationships(reduced.flatMap((result) => result!.relationships));
    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({
      leftCaseId: left.caseId,
      rightCaseId: right.caseId,
      type: 'same_incident_candidate',
    });
    expect(reduced.flatMap((result) => result!.candidates)
      .some((candidate) => candidate.pairKey.includes(left.caseId) && candidate.pairKey.includes(right.caseId)))
      .toBe(true);
  });

  it('routes neighboring spatial cells canonically so duplicate reducer receipts collapse exactly', () => {
    const boundaryLeft = feature('00000000-0000-4000-8000-000000000005', 'Amber chevron hovered silently.', {
      event_timestamp: '2026-07-17T17:59:00Z',
      lat: 51.99,
      lon: -0.01,
    });
    const boundaryRight = feature('00000000-0000-4000-8000-000000000004', 'Amber chevron hovered silently.', {
      source: 'archive-c',
      event_timestamp: '2026-07-17T18:01:00Z',
      lat: 52.01,
      lon: 0.01,
    });
    const rarity = buildCaseGraphCorpusRarity([boundaryLeft, boundaryRight], 'routing-v1');
    const mapped = [boundaryLeft, boundaryRight].flatMap((record, inputPartNumber) => buildCaseGraphPostingFragments({
      records: [record], rarity, inputPartNumber, reducerShardCount: 16, minimumTermRarity: 0,
    }));
    const reduced = Array.from({ length: 16 }, (_, shard) => {
      const fragments = mapped.filter((fragment) => fragment.reducerShard === shard);
      return fragments.length ? reduceCaseGraphPostingFragments({ fragments, rarity }) : null;
    }).filter(Boolean);
    const all = reduced.flatMap((result) => result!.relationships);
    expect(all.length).toBeGreaterThan(0);
    expect(deduplicateCaseGraphRelationships(all)).toHaveLength(1);
  });

  it('skips oversized groups and fails closed on candidate or receipt conflicts', () => {
    const rarity = buildCaseGraphCorpusRarity([left, right], 'routing-v1');
    const shard = buildCaseGraphPostingFragments({
      records: [left, right], rarity, inputPartNumber: 0, reducerShardCount: 1, minimumTermRarity: 0,
    });
    const reduced = reduceCaseGraphPostingFragments({
      fragments: shard,
      rarity,
      maxTermPostings: 1,
      maxSpatialPostings: 1,
      maxSourceRecordPostings: 1,
    });
    expect(reduced.manifest.skippedGroups.length).toBeGreaterThan(0);

    const relationship = reduceCaseGraphPostingFragments({ fragments: shard, rarity }).relationships[0];
    expect(() => deduplicateCaseGraphRelationships([
      relationship,
      { ...relationship, strength: relationship.strength - 1 },
    ])).toThrow('case_graph_relationship_receipt_conflict');
  });
});
