import { describe, expect, it } from 'vitest';

import { getCaseGraphFeatureControlKeys, getCaseGraphFeatureKeys } from '../../src/caseGraph/archiveKeys';
import {
  buildCaseGraphFeaturePart,
  compareCaseGraphCursors,
  decodeCaseGraphFeaturePart,
  getCaseGraphFeatureArchiveSetSha256,
} from '../../src/caseGraph/featureArchiveCodec';
import type { CaseGraphSourceRow } from '../../src/caseGraph/archiveTypes';

const rows: CaseGraphSourceRow[] = [
  {
    cursor: { updated_at: '2026-07-17T12:01:00Z', case_id: '00000000-0000-4000-8000-000000000002' },
    sighting: {
      id: '00000000-0000-4000-8000-000000000002', source: 'archive-b', updated_at: '2026-07-17T12:01:00Z',
      description: 'Three amber lights hovered silently.',
    },
  },
  {
    cursor: { updated_at: '2026-07-17T12:00:00Z', case_id: '00000000-0000-4000-8000-000000000001' },
    sighting: {
      id: '00000000-0000-4000-8000-000000000001', source: 'archive-a', updated_at: '2026-07-17T12:00:00Z',
      description: 'An amber triangle moved east.',
    },
  },
];

describe('case graph feature archive codec', () => {
  it('builds deterministic, sorted, compressed feature parts with audit totals', () => {
    const built = buildCaseGraphFeaturePart({ corpusVersion: 'corpus-v1', partNumber: 0, rows });
    const rebuilt = buildCaseGraphFeaturePart({ corpusVersion: 'corpus-v1', partNumber: 0, rows: [...rows].reverse() });

    expect(built.archiveBody.equals(rebuilt.archiveBody)).toBe(true);
    expect(built.manifest).toEqual(rebuilt.manifest);
    expect(built.manifest).toMatchObject({
      row_count: 2,
      first_cursor: { ...rows[1].cursor, updated_at: '2026-07-17T12:00:00.000Z' },
      last_cursor: { ...rows[0].cursor, updated_at: '2026-07-17T12:01:00.000Z' },
      source_counts: { 'archive-a': 1, 'archive-b': 1 },
      archive_key: 'case-vortex/corpora/corpus-v1/features/parts/part-000000.ndjson.gz',
    });
    expect(built.manifest.term_document_frequency.amber).toBe(2);
    expect(built.manifest.schema_version).toBe(2);
    expect(built.manifest.uncompressed_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(built.manifest.compressed_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(decodeCaseGraphFeaturePart(built.archiveBody).map((record) => record.caseId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });

  it('rejects duplicate cursors, cursor-ID mismatches and eligible rows without IDs', () => {
    expect(() => buildCaseGraphFeaturePart({
      corpusVersion: 'corpus-v1', partNumber: 0, rows: [rows[0], rows[0]],
    })).toThrow('case_graph_feature_part_cursor_not_strictly_increasing');
    expect(() => buildCaseGraphFeaturePart({
      corpusVersion: 'corpus-v1', partNumber: 0,
      rows: [{ ...rows[0], sighting: { ...rows[0].sighting, id: rows[1].cursor.case_id } }],
    })).toThrow('case_graph_feature_part_cursor_id_mismatch');
    expect(() => buildCaseGraphFeaturePart({
      corpusVersion: 'corpus-v1', partNumber: 0,
      rows: [{ ...rows[0], sighting: { ...rows[0].sighting, id: ' ' } }],
    })).toThrow('case_graph_feature_part_cursor_id_mismatch');
  });

  it('enforces row and byte limits', () => {
    expect(() => buildCaseGraphFeaturePart({
      corpusVersion: 'corpus-v1', partNumber: 0, rows, limits: { maxRows: 1 },
    })).toThrow('case_graph_feature_part_row_limit_exceeded');
    expect(() => buildCaseGraphFeaturePart({
      corpusVersion: 'corpus-v1', partNumber: 0, rows: [rows[0]], limits: { maxUncompressedBytes: 10 },
    })).toThrow('case_graph_feature_part_uncompressed_limit_exceeded');
  });

  it('builds deterministic keys and archive-set checksums', () => {
    expect(getCaseGraphFeatureKeys('Corpus.V1', 12)).toEqual({
      archiveKey: 'case-vortex/corpora/corpus.v1/features/parts/part-000012.ndjson.gz',
      manifestKey: 'case-vortex/corpora/corpus.v1/features/parts/part-000012.manifest.json',
    });
    expect(getCaseGraphFeatureControlKeys('corpus-v1')).toEqual({
      checkpointKey: 'case-vortex/corpora/corpus-v1/features/_checkpoint.json',
      rarityKey: 'case-vortex/corpora/corpus-v1/features/rarity.json',
      completionManifestKey: 'case-vortex/corpora/corpus-v1/features/_complete.manifest.json',
    });
    expect(getCaseGraphFeatureArchiveSetSha256([
      { part_number: 1, compressed_sha256: 'b'.repeat(64) },
      { part_number: 0, compressed_sha256: 'a'.repeat(64) },
    ])).toBe(getCaseGraphFeatureArchiveSetSha256([
      { part_number: 0, compressed_sha256: 'a'.repeat(64) },
      { part_number: 1, compressed_sha256: 'b'.repeat(64) },
    ]));
    expect(getCaseGraphFeatureArchiveSetSha256([
      { part_number: 0, compressed_sha256: 'a'.repeat(64) },
    ], {
      snapshot_id: '00000000-0000-4000-8000-000000000123',
      snapshot_policy: 'evidence-universe-materialized-v1',
      capture_policy: 'publishable-public-v2-materialized-v1',
      materialized_at: '2026-07-18T00:29:59.999321Z',
      source_mvcc_snapshot: '100:200:150,175',
      universe: null,
    })).not.toBe(getCaseGraphFeatureArchiveSetSha256([
      { part_number: 0, compressed_sha256: 'a'.repeat(64) },
    ]));
    expect(() => getCaseGraphFeatureKeys('../escape', 0)).toThrow('case_graph_corpus_version_invalid');
  });

  it('orders cursors by timestamp and then case ID', () => {
    expect(compareCaseGraphCursors(rows[1].cursor, rows[0].cursor)).toBeLessThan(0);
    expect(compareCaseGraphCursors(
      { ...rows[0].cursor, case_id: rows[1].cursor.case_id },
      rows[0].cursor,
    )).toBeLessThan(0);
  });

  it('version-gates decoded feature records to the requested corpus', () => {
    const built = buildCaseGraphFeaturePart({ corpusVersion: 'corpus-v2', partNumber: 0, rows: [rows[0]] });
    expect(() => decodeCaseGraphFeaturePart(built.archiveBody, undefined, 'other-corpus'))
      .toThrow('case_graph_feature_archive_record_invalid');
  });
});
