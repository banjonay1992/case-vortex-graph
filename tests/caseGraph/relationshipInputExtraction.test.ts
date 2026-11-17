import { describe, expect, it } from 'vitest';

import { projectEvidenceUniverseNode, type EvidenceUniverseNodeKind } from '../../src/caseGraph/evidenceUniverse';
import {
  extractRelationshipInputRecord,
  relationshipInputNarrativeSha256,
} from '../../src/caseGraph/relationshipInputExtraction';
import {
  relationshipInputSha256,
  type RelationshipInputOriginDraft,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';

const sightingId = '11111111-1111-4111-8111-111111111111';
const binding: RelationshipInputUniverseBinding = {
  snapshotId: '22222222-2222-4222-8222-222222222222',
  corpusVersion: 'relationship-extraction-test',
  universeArchiveVersion: 'evidence-universe-archive-v3',
  universeSchemaVersion: 'evidence-universe-v2',
  universeLayoutVersion: 'evidence-universe-layout-v2',
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 4,
};
const vectorPolicy = {
  modelId: 'case-vortex-narrative',
  modelVersion: 'v1',
  dimensions: 1536,
  normalization: 'l2' as const,
};

const node = (
  kind: EvidenceUniverseNodeKind,
  recordId: string,
  overrides: Record<string, unknown> = {},
) => projectEvidenceUniverseNode({
  kind,
  recordId,
  source: 'nuforc',
  sourceRecordId: `${kind}-source-1`,
  title: null,
  summary: null,
  canonicalUrl: `https://example.test/${kind}/${recordId}`,
  previewUrl: null,
  eventTimestamp: null,
  lat: null,
  lon: null,
  location: null,
  countryCode: null,
  linkedSightingId: kind === 'sighting' ? null : sightingId,
  updatedAt: '2026-07-18T01:00:00.000Z',
  public: true,
  ...overrides,
});

const narrativeOrigin = (
  value: ReturnType<typeof node>,
  sourceText: string,
  spanText: string,
): RelationshipInputOriginDraft => {
  const characterStart = sourceText.indexOf(spanText);
  if (characterStart < 0) throw new Error('test_span_missing');
  const start = Buffer.byteLength(sourceText.slice(0, characterStart), 'utf8');
  const end = start + Buffer.byteLength(spanText, 'utf8');
  return {
    sourceAddress: value.address,
    sourceField: 'summary',
    sourceTextSha256: relationshipInputSha256(sourceText),
    sourceTextBytes: Buffer.byteLength(sourceText, 'utf8'),
    supportingSpans: [{
      unit: 'utf8_byte', start, end, text: spanText, textSha256: relationshipInputSha256(spanText),
    }],
    extraction: { method: 'deterministic_rule', version: 'governed-site-registry-v1' },
  };
};

describe('relationship input extraction v2', () => {
  it('produces one deterministic, fully accounted record for every universe node kind', () => {
    const nodes = [
      node('sighting', sightingId),
      node('document', 'document-1'),
      node('photo', 'photo-1'),
      node('video', 'video-1'),
    ];
    const records = nodes.map((value) => extractRelationshipInputRecord(value, { binding, vectorPolicy }));
    expect(records.map((record) => record.address)).toEqual(nodes.map((value) => value.address));
    expect(new Set(records.map((record) => record.recordDigest)).size).toBe(4);
    for (const record of records) {
      expect(new Set(record.facts.map((fact) => fact.family))).toEqual(new Set([
        'provenance', 'space_time', 'visual', 'behavioural', 'sensory', 'duration',
        'entity', 'site', 'narrative_pattern', 'contextual_explanation',
      ]));
      expect(record.narrativeVector).toMatchObject({ status: 'missing', reason: 'no_narrative' });
    }
    for (const record of records.slice(1)) {
      expect(record.crossReferences).toEqual([
        expect.objectContaining({ relation: 'media_attachment', targetAddress: `sighting:${sightingId}` }),
      ]);
    }
    expect(extractRelationshipInputRecord(nodes[0], { binding, vectorPolicy }))
      .toEqual(records[0]);
  });

  it('uses UTF-8 byte spans and suppresses negated traits without losing explicit silence', () => {
    const summary = 'Glød ✨ red orb hovered for two minutes. It did not buzz. There was no sound.';
    const record = extractRelationshipInputRecord(node('sighting', sightingId, {
      summary,
      eventTimestamp: '2026-07-17T20:00:00.000Z',
      lat: 51.5,
      lon: -0.1,
    }), { binding, vectorPolicy });
    const terms = record.facts.flatMap((fact) => fact.value?.kind === 'term' ? [fact.value.termId] : []);
    expect(terms).toEqual(expect.arrayContaining(['red', 'sphere', 'hover', 'silent']));
    expect(terms).not.toContain('buzzing_or_humming');
    const red = record.facts.find((fact) => fact.value?.kind === 'term' && fact.value.termId === 'red');
    const span = red?.origins[0]?.supportingSpans[0];
    expect(span).toMatchObject({ unit: 'utf8_byte', text: 'red' });
    expect(span?.start).toBe(Buffer.byteLength(summary.slice(0, summary.indexOf('red')), 'utf8'));
    expect(record.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'duration',
        value: expect.objectContaining({ kind: 'duration', seconds: 120 }),
      }),
    ]));
  });

  it('suppresses preceding and following denials and does not turn a negated duration into a fact', () => {
    const summary = [
      'The red light did not hover.',
      'Buzzing was not heard.',
      'It was not silent.',
      'The witness denied seeing a triangle.',
      'It did not last for ten minutes, but lasted for two minutes.',
      'There was no sound.',
    ].join(' ');
    const record = extractRelationshipInputRecord(node('sighting', sightingId, { summary }), {
      binding,
      vectorPolicy,
    });
    const terms = record.facts.flatMap((fact) => fact.value?.kind === 'term' ? [fact.value.termId] : []);
    const durations = record.facts.flatMap((fact) => fact.value?.kind === 'duration' ? [fact.value.seconds] : []);
    expect(terms).toContain('red');
    expect(terms).toContain('silent');
    expect(terms).not.toContain('hover');
    expect(terms).not.toContain('buzzing_or_humming');
    expect(terms).not.toContain('triangle');
    expect(durations).toEqual([120]);
  });

  it('requires exact option and node shapes instead of silently ignoring fields or undefined enrichments', () => {
    const current = node('sighting', sightingId, { eventTimestamp: '2026-07-17T20:00:00.000Z' });
    expect(() => extractRelationshipInputRecord(current, {
      binding: { ...binding, ignored: true },
      vectorPolicy,
    } as never)).toThrow('relationship_input_extraction_options_shape_invalid');
    expect(() => extractRelationshipInputRecord({ ...current, ignored: true } as never, {
      binding,
      vectorPolicy,
    })).toThrow('relationship_input_extraction_node_invalid');
    expect(() => extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: { duration: undefined },
    } as never)).toThrow('relationship_input_extraction_enrichment_shape_invalid');
    expect(() => extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: { governedMentions: undefined },
    } as never)).toThrow('relationship_input_extraction_enrichment_shape_invalid');
    expect(() => extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: {
        eventPrecision: {
          datePrecision: 'exact',
          confidence: 1,
          uncertainty: { level: 'none', reasons: [] },
          precision: { kind: 'exact' },
          origins: [],
        },
      },
    })).toThrow('relationship_input_extraction_enrichment_receipt_required');
  });

  it('binds governed narrative enrichment spans to the actual current-node text', () => {
    const summary = 'A light passed above the governed test site.';
    const current = node('sighting', sightingId, { summary });
    const metadata = {
      governedId: 'site:test-site',
      kind: 'site' as const,
      registryVersion: 'governed-sites-v1',
      label: 'Test site',
      confidence: 0.9,
      uncertainty: { level: 'low' as const, reasons: ['registry_exact_label'] },
      precision: { kind: 'categorical' as const, vocabularyVersion: 'governed-sites-v1' },
    };
    const valid = extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: {
        governedMentions: [{ ...metadata, origins: [narrativeOrigin(current, summary, 'test site')] }],
      },
    });
    expect(valid.governedReferences).toEqual([
      expect.objectContaining({ governedId: 'site:test-site', kind: 'site' }),
    ]);

    const fabricatedText = 'A light passed above the governed fake site.';
    expect(() => extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: {
        governedMentions: [{
          ...metadata,
          origins: [narrativeOrigin(current, fabricatedText, 'fake site')],
        }],
      },
    })).toThrow('relationship_input_extraction_origin_source_mismatch');
  });

  it('accounts explicitly for unattached media and avoids overconfident timestamp precision', () => {
    const media = node('photo', 'unattached-photo', {
      linkedSightingId: null,
      eventTimestamp: '2026-07-17T20:00:00.000Z',
    });
    const record = extractRelationshipInputRecord(media, { binding, vectorPolicy });
    expect(record.crossReferences).toEqual([]);
    expect(record.recordMissingness).toContainEqual({
      field: 'linked_sighting_id', status: 'not_recorded', reason: 'source_omitted',
    });
    expect(record.facts).toContainEqual(expect.objectContaining({
      family: 'space_time',
      predicate: 'event_timestamp',
      confidence: 0.5,
      uncertainty: { level: 'unknown', reasons: ['date_precision_unknown'] },
    }));
  });

  it('preserves canonical microsecond timestamps from the immutable universe', () => {
    const timestamp = '2026-03-29T15:58:35.075244Z';
    const record = extractRelationshipInputRecord(node('video', 'microsecond-video', {
      linkedSightingId: null,
      eventTimestamp: timestamp,
    }), { binding, vectorPolicy });
    expect(record.facts).toContainEqual(expect.objectContaining({
      family: 'space_time',
      predicate: 'event_timestamp',
      value: { kind: 'timestamp', timestamp, datePrecision: 'unknown' },
    }));
  });

  it('preserves a separately versioned feature corpus receipt and rejects invalid receipt syntax', () => {
    const current = node('sighting', sightingId);
    const origin: RelationshipInputOriginDraft = {
      sourceAddress: current.address,
      sourceField: 'featureArchive.record',
      sourceTextSha256: null,
      sourceTextBytes: null,
      supportingSpans: [],
      extraction: { method: 'structured', version: 'relationship-input-feature-adapter-v2' },
    };
    const record = extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: {
        featureArchiveReceipt: {
          featureSchemaVersion: 'case-graph-features-v1',
          corpusVersion: 'separate-feature-corpus',
          recordSha256: 'f'.repeat(64),
          origins: [origin],
        },
      },
    });
    expect(record.facts).toContainEqual(expect.objectContaining({
      predicate: 'archived_feature_record',
      value: expect.objectContaining({
        referenceId: `case-graph-feature:separate-feature-corpus:${'f'.repeat(64)}`,
      }),
    }));

    expect(() => extractRelationshipInputRecord(current, {
      binding,
      vectorPolicy,
      enrichment: {
        featureArchiveReceipt: {
          featureSchemaVersion: 'case-graph-features-v1',
          corpusVersion: 'Invalid Corpus',
          recordSha256: 'f'.repeat(64),
          origins: [origin],
        },
      },
    })).toThrow('relationship_input_extraction_feature_receipt_invalid');
  });

  it('requires exact vector input receipts and rejects unknown option fields', () => {
    const narrativeNode = node('sighting', sightingId, { summary: 'A red light.' });
    const inputSha256 = relationshipInputNarrativeSha256(narrativeNode)!;
    expect(() => extractRelationshipInputRecord(narrativeNode, {
      binding,
      vectorPolicy,
      enrichment: {
        narrativeVector: {
          status: 'present',
          ...vectorPolicy,
          inputSha256: 'b'.repeat(64),
          vectorSha256: 'c'.repeat(64),
        },
      },
    })).toThrow('relationship_input_extraction_vector_receipt_mismatch');
    const record = extractRelationshipInputRecord(narrativeNode, {
      binding,
      vectorPolicy,
      enrichment: {
        narrativeVector: {
          status: 'present',
          ...vectorPolicy,
          inputSha256,
          vectorSha256: 'c'.repeat(64),
        },
      },
    });
    expect(record.narrativeVector).toMatchObject({ status: 'present', inputSha256 });
    expect(() => extractRelationshipInputRecord(narrativeNode, {
      binding,
      vectorPolicy,
      ignored: true,
    } as never)).toThrow('relationship_input_extraction_options_shape_invalid');
  });
});
