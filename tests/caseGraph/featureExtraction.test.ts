import { describe, expect, it } from 'vitest';

import { extractCaseGraphFeatures } from '../../src/caseGraph/featureExtraction';
import {
  buildCaseGraphCorpusRarity,
  buildCaseGraphRarityFromDocumentFrequency,
} from '../../src/caseGraph/corpusRarity';

const include = { corpusVersion: 'corpus-2026-07-17', eligibility: { eligible: true } as const };

describe('case graph feature extraction', () => {
  it('accounts for governed exclusions without reading them into the graph', () => {
    expect(extractCaseGraphFeatures({ id: 'blocked-1', description: 'red light' }, {
      corpusVersion: 'corpus-2026-07-17',
      eligibility: { eligible: false, reason: 'registry_blocklist' },
    })).toEqual({
      status: 'excluded',
      schemaVersion: 'case-graph-features-v1',
      corpusVersion: 'corpus-2026-07-17',
      caseId: 'blocked-1',
      reason: 'registry blocklist',
    });
  });

  it('extracts deterministic structured, narrative, entity and precision features', () => {
    const result = extractCaseGraphFeatures({
      id: 'case-1',
      source: '  NUFORC ',
      source_record_id: 'N-42',
      event_timestamp: '2025-03-04T21:10:00Z',
      event_date_precision: 'exact',
      lat: '50.2',
      lon: '-5.1',
      geo_precision: 'city',
      city: 'Penzance',
      region: 'Cornwall',
      country_code: 'GB',
      shape_normalized: 'triangle',
      duration_seconds: '95',
      description_clean: 'Three amber lights in a triangular formation hovered, then zig-zagged west. It was silent and caused radio interference.',
      ai_keywords: ['Night sighting', 'Amber', 'night sighting'],
      ai_entities: [{ name: 'RAF Culdrose' }, { text: 'Penzance' }],
      updated_at: '2026-07-17T12:00:00Z',
    }, include);

    expect(result).toMatchObject({
      status: 'included',
      caseId: 'case-1',
      source: 'nuforc',
      sourceRecordId: 'N-42',
      event: {
        timestamp: '2025-03-04T21:10:00.000Z',
        datePrecision: 'exact',
        lat: 50.2,
        lon: -5.1,
        geoPrecision: 'city',
        spatialPrecisionKm: 25,
        locationKey: 'penzance|cornwall|gb',
      },
      durationSeconds: 95,
      sourceUpdatedAt: '2026-07-17T12:00:00.000Z',
    });
    if (result.status !== 'included') throw new Error('expected included record');
    expect(result.traits.visual.map((item) => item.term)).toEqual([
      'amber', 'formation', 'light count 3', 'triangle',
    ]);
    expect(result.traits.behaviour.map((item) => item.term)).toEqual([
      'hover', 'movement west', 'zig zag movement',
    ]);
    expect(result.traits.sensory.map((item) => item.term)).toEqual(['radio interference', 'silent']);
    expect(result.traits.entities.map((item) => item.term)).toEqual(['penzance', 'raf culdrose']);
    expect(result.traits.keywords.map((item) => item.term)).toEqual(['amber', 'night sighting']);
    expect(result.completeness.score).toBe(1);
    expect(result.narrative.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not turn explicitly negated observations into positive traits', () => {
    const result = extractCaseGraphFeatures({
      id: 'case-negated',
      description: 'The witness said it was not silent, never hovered, and was not a triangle.',
    }, include);
    if (result.status !== 'included') throw new Error('expected included record');

    expect(result.traits.sensory.map((item) => item.term)).not.toContain('silent');
    expect(result.traits.behaviour.map((item) => item.term)).not.toContain('hover');
    expect(result.traits.visual.map((item) => item.term)).not.toContain('triangle');
  });

  it('preserves missingness and rejects invalid coordinates defensively', () => {
    const result = extractCaseGraphFeatures({
      id: 'case-sparse',
      lat: 140,
      lon: -500,
      event_timestamp: 'not-a-date',
      geo_precision: 'planet',
      duration_seconds: -12,
    }, include);
    if (result.status !== 'included') throw new Error('expected included record');

    expect(result.event).toMatchObject({
      timestamp: null,
      lat: null,
      lon: null,
      geoPrecision: 'unknown',
      spatialPrecisionKm: null,
    });
    expect(result.durationSeconds).toBeNull();
    expect(result.completeness.missing).toEqual(expect.arrayContaining([
      'coordinates', 'duration', 'event_timestamp', 'geo_precision', 'narrative',
    ]));
  });

  it('is stable across AI array ordering and changes digest when governed narrative changes', () => {
    const left = extractCaseGraphFeatures({
      id: 'case-stable',
      description: 'An amber disk hovered.',
      ai_keywords: ['disk', 'amber'],
      ai_entities: [{ name: 'Site B' }, { name: 'Site A' }],
    }, include);
    const reordered = extractCaseGraphFeatures({
      id: 'case-stable',
      description: 'An amber disk hovered.',
      ai_keywords: ['amber', 'disk'],
      ai_entities: [{ name: 'Site A' }, { name: 'Site B' }],
    }, include);
    const changed = extractCaseGraphFeatures({
      id: 'case-stable',
      description: 'A green disk hovered.',
      ai_keywords: ['amber', 'disk'],
      ai_entities: [{ name: 'Site A' }, { name: 'Site B' }],
    }, include);

    expect(left).toEqual(reordered);
    if (left.status !== 'included' || changed.status !== 'included') throw new Error('expected included records');
    expect(left.narrative.digest).not.toBe(changed.narrative.digest);
  });

  it('requires an explicit corpus version and accounts for invalid case IDs', () => {
    expect(() => extractCaseGraphFeatures({ id: 'case-1' }, {
      corpusVersion: ' ',
      eligibility: { eligible: true },
    })).toThrow('case_graph_corpus_version_required');
    expect(extractCaseGraphFeatures({ id: ' ' }, include)).toMatchObject({
      status: 'excluded',
      reason: 'invalid_case_id',
      caseId: null,
    });
  });
});

describe('case graph corpus rarity', () => {
  const feature = (id: string, description: string) => {
    const result = extractCaseGraphFeatures({ id, description }, include);
    if (result.status !== 'included') throw new Error('expected included record');
    return result;
  };

  it('computes document rarity once per case and makes rare terms stronger', () => {
    const result = buildCaseGraphCorpusRarity([
      feature('case-1', 'An amber disk hovered with radio interference.'),
      feature('case-2', 'An amber triangle hovered.'),
      feature('case-3', 'An amber light moved east.'),
    ], 'corpus-2026-07-17');

    expect(result.documentCount).toBe(3);
    expect(result.documentFrequency.amber).toBe(3);
    expect(result.documentFrequency['radio interference']).toBe(1);
    expect(result.rarity['radio interference']).toBeGreaterThan(result.rarity.amber);
  });

  it('rejects duplicate case IDs and mixed corpus versions', () => {
    const first = feature('case-1', 'amber disk');
    expect(() => buildCaseGraphCorpusRarity([first, first], 'corpus-2026-07-17'))
      .toThrow('case_graph_duplicate_case_id:case-1');
    expect(() => buildCaseGraphCorpusRarity([
      first,
      { ...feature('case-2', 'green disk'), corpusVersion: 'other-corpus' },
    ], 'corpus-2026-07-17')).toThrow('case_graph_corpus_version_mismatch');
  });

  it('reduces validated part-level document frequencies without loading feature rows', () => {
    expect(buildCaseGraphRarityFromDocumentFrequency({ amber: 3, chevron: 1 }, 3, 'corpus-2026-07-17'))
      .toMatchObject({
        documentCount: 3,
        documentFrequency: { amber: 3, chevron: 1 },
      });
    expect(() => buildCaseGraphRarityFromDocumentFrequency({ impossible: 4 }, 3, 'corpus-2026-07-17'))
      .toThrow('case_graph_document_frequency_invalid:impossible');
    expect(() => buildCaseGraphRarityFromDocumentFrequency({}, -1, 'corpus-2026-07-17'))
      .toThrow('case_graph_document_count_invalid');
  });
});
