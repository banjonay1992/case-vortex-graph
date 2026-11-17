import { describe, expect, it } from 'vitest';

import { buildCaseGraphCorpusRarity } from '../../src/caseGraph/corpusRarity';
import { buildCaseGraphPostingFragments } from '../../src/caseGraph/candidateRouting';
import { extractCaseGraphFeatures } from '../../src/caseGraph/featureExtraction';
import { buildCaseGraphPostingFragmentArchive, decodeCaseGraphPostingFragmentArchive } from '../../src/caseGraph/postingArchiveCodec';

const record = (id: string, text: string) => {
  const result = extractCaseGraphFeatures({
    id,
    source: 'archive-a',
    event_timestamp: '2026-07-17T12:00:00Z',
    event_date_precision: 'exact',
    lat: 51.5,
    lon: -0.1,
    geo_precision: 'exact',
    description: text,
  }, { corpusVersion: 'posting-codec-v1', eligibility: { eligible: true } });
  if (result.status !== 'included') throw new Error('fixture excluded');
  return result;
};

const spatialRecord = (id: string, lat: number, lon: number) => {
  const result = extractCaseGraphFeatures({
    id,
    source: 'archive-a',
    event_timestamp: '2016-08-21T12:00:00Z',
    event_date_precision: 'day',
    lat,
    lon,
    geo_precision: 'exact',
    description: 'A light moved silently.',
  }, { corpusVersion: 'posting-codec-v1', eligibility: { eligible: true } });
  if (result.status !== 'included') throw new Error('fixture excluded');
  return result;
};

describe('case graph posting archive codec', () => {
  it('round-trips deterministic dictionary-compressed posting fragments', () => {
    const records = [
      record('00000000-0000-4000-8000-000000000001', 'Amber chevron hovered silently.'),
      record('00000000-0000-4000-8000-000000000002', 'Amber chevron moved east.'),
    ];
    const rarity = buildCaseGraphCorpusRarity(records, 'posting-codec-v1');
    const fragment = buildCaseGraphPostingFragments({
      records, rarity, inputPartNumber: 3, reducerShardCount: 1, minimumTermRarity: 0,
    })[0];
    const built = buildCaseGraphPostingFragmentArchive(fragment);
    const rebuilt = buildCaseGraphPostingFragmentArchive(fragment);
    expect(built.archiveBody.equals(rebuilt.archiveBody)).toBe(true);
    expect(built.manifest).toEqual(rebuilt.manifest);
    expect(built.manifest).toMatchObject({
      archive_key: 'case-vortex/corpora/posting-codec-v1/candidates/postings/shard-0000/part-000003.json.gz',
      reducer_shard: 0,
      reducer_shard_count: 1,
      record_count: 2,
    });
    expect(decodeCaseGraphPostingFragmentArchive(built.archiveBody, built.manifest)).toEqual(fragment);
  });

  it('rejects corrupt archives and manifests', () => {
    const records = [record('00000000-0000-4000-8000-000000000001', 'Amber chevron hovered silently.')];
    const rarity = buildCaseGraphCorpusRarity(records, 'posting-codec-v1');
    const fragment = buildCaseGraphPostingFragments({
      records, rarity, inputPartNumber: 0, reducerShardCount: 1, minimumTermRarity: 0,
    })[0];
    const built = buildCaseGraphPostingFragmentArchive(fragment);
    expect(() => decodeCaseGraphPostingFragmentArchive(Buffer.from('corrupt'), built.manifest))
      .toThrow('case_graph_posting_fragment_checksum_mismatch');
    expect(() => decodeCaseGraphPostingFragmentArchive(built.archiveBody, {
      ...built.manifest,
      posting_count: built.manifest.posting_count + 1,
    })).toThrow('case_graph_posting_fragment_manifest_mismatch');
  });

  it('uses byte-stable ordering for variable-width spatial cell signatures', () => {
    const records = [
      spatialRecord('00000000-0000-4000-8000-000000000001', 3.1, -77.1),
      spatialRecord('00000000-0000-4000-8000-000000000002', 39.1, -109.1),
    ];
    const rarity = buildCaseGraphCorpusRarity(records, 'posting-codec-v1');
    const fragment = buildCaseGraphPostingFragments({
      records, rarity, inputPartNumber: 42, reducerShardCount: 1, minimumTermRarity: 0,
    })[0];
    expect(() => buildCaseGraphPostingFragmentArchive(fragment)).not.toThrow();
    const postingKeys = fragment.postings.map((posting) => (
      `${posting.signature}\0${fragment.records[posting.recordIndex].caseId}`
    ));
    expect(postingKeys).toEqual([...postingKeys].sort());
  });
});
