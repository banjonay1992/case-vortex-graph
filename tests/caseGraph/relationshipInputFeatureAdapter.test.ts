import { describe, expect, it } from 'vitest';

import { projectEvidenceUniverseNode } from '../../src/caseGraph/evidenceUniverse';
import { extractCaseGraphFeatures, type CaseGraphFeatureRecord } from '../../src/caseGraph/featureExtraction';
import {
  buildRelationshipInputFeatureEnrichment,
  relationshipInputFeatureRecordSha256,
} from '../../src/caseGraph/relationshipInputFeatureAdapter';
import { extractRelationshipInputRecord } from '../../src/caseGraph/relationshipInputExtraction';
import type { RelationshipInputUniverseBinding } from '../../src/caseGraph/relationshipInputSnapshot';

const caseId = '11111111-1111-4111-8111-111111111111';
const corpusVersion = 'feature-adapter-test';
const binding: RelationshipInputUniverseBinding = {
  snapshotId: '22222222-2222-4222-8222-222222222222',
  corpusVersion,
  universeArchiveVersion: 'evidence-universe-archive-v3',
  universeSchemaVersion: 'evidence-universe-v2',
  universeLayoutVersion: 'evidence-universe-layout-v2',
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 1,
};

const raw = {
  id: caseId,
  source: 'nuforc',
  source_record_id: 'NUFORC-1',
  source_url: 'https://example.test/nuforc-1',
  event_timestamp: '2026-07-17T20:00:00.000Z',
  event_date_precision: 'day',
  lat: 51.5,
  lon: -0.1,
  geo_precision: 'city',
  description: 'A red light hovered silently above the city.',
  duration_seconds: 120,
  updated_at: '2026-07-17T21:00:00.000Z',
};

const feature = extractCaseGraphFeatures(raw, {
  corpusVersion,
  eligibility: { eligible: true },
}) as CaseGraphFeatureRecord;

const node = projectEvidenceUniverseNode({
  kind: 'sighting',
  recordId: caseId,
  source: 'nuforc',
  sourceRecordId: 'NUFORC-1',
  title: null,
  summary: raw.description,
  canonicalUrl: raw.source_url,
  previewUrl: null,
  eventTimestamp: raw.event_timestamp,
  lat: raw.lat,
  lon: raw.lon,
  location: null,
  countryCode: null,
  linkedSightingId: null,
  updatedAt: raw.updated_at,
  public: true,
});

describe('relationship input feature adapter', () => {
  it('joins the immutable sighting feature receipt into conservative precision and duration facts', () => {
    const enrichment = buildRelationshipInputFeatureEnrichment(node, feature, corpusVersion);
    expect(enrichment).toMatchObject({
      eventPrecision: { datePrecision: 'day', confidence: 0.95 },
      spatialPrecision: { spatialPrecisionKm: feature.event.spatialPrecisionKm, confidence: 0.9 },
      duration: { seconds: 120, confidence: 0.9 },
      featureArchiveReceipt: {
        featureSchemaVersion: 'case-graph-features-v1',
        corpusVersion,
        recordSha256: relationshipInputFeatureRecordSha256(feature),
      },
    });

    const record = extractRelationshipInputRecord(node, {
      binding,
      vectorPolicy: {
        modelId: 'case-vortex-narrative',
        modelVersion: 'v1',
        dimensions: 1536,
        normalization: 'l2',
      },
      enrichment,
    });
    expect(record.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'space_time', predicate: 'event_timestamp' }),
      expect.objectContaining({ family: 'space_time', predicate: 'event_location' }),
      expect.objectContaining({ family: 'duration', predicate: 'observed_duration' }),
      expect.objectContaining({
        family: 'provenance',
        predicate: 'archived_feature_record',
        value: expect.objectContaining({
          kind: 'provenance',
          code: 'ingestion_lineage',
          referenceId: `case-graph-feature:${corpusVersion}:${relationshipInputFeatureRecordSha256(feature)}`,
        }),
      }),
    ]));
    expect(record.recordMissingness.map((item) => item.field)).not.toContain('duration_seconds');
  });

  it('fails closed when the feature record is not the exact archived universe record', () => {
    expect(() => buildRelationshipInputFeatureEnrichment(node, {
      ...feature,
      sourceUpdatedAt: '2026-07-17T21:00:01.000Z',
    }, corpusVersion)).toThrow('relationship_input_feature_join_mismatch');
    expect(() => buildRelationshipInputFeatureEnrichment(node, {
      ...feature,
      event: { ...feature.event, lat: 40 },
    }, corpusVersion)).toThrow('relationship_input_feature_join_mismatch');
    expect(() => buildRelationshipInputFeatureEnrichment({ ...node, ignored: true } as never, feature, corpusVersion))
      .toThrow('relationship_input_feature_node_invalid');
  });

  it('joins a captured source label to its canonical lowercase feature identity', () => {
    expect(() => buildRelationshipInputFeatureEnrichment(
      { ...node, source: 'NUFORC' },
      feature,
      corpusVersion,
    )).not.toThrow();
    expect(() => buildRelationshipInputFeatureEnrichment(
      { ...node, source: 'OTHER_ARCHIVE' },
      feature,
      corpusVersion,
    )).toThrow('relationship_input_feature_join_mismatch');
  });

  it('strictly validates every feature path and rejects noncanonical or silently added fields', () => {
    expect(() => buildRelationshipInputFeatureEnrichment(node, {
      ...feature,
      ignored: true,
    } as never, corpusVersion)).toThrow('relationship_input_feature_record_invalid');
    expect(() => buildRelationshipInputFeatureEnrichment(node, {
      ...feature,
      event: { ...feature.event, ignored: true },
    } as never, corpusVersion)).toThrow('relationship_input_feature_record_invalid');
    expect(() => buildRelationshipInputFeatureEnrichment(node, {
      ...feature,
      completeness: { ...feature.completeness, score: 0 },
    }, corpusVersion)).toThrow('relationship_input_feature_record_invalid');
    expect(() => buildRelationshipInputFeatureEnrichment(node, {
      ...feature,
      traits: {
        ...feature.traits,
        visual: [{ term: 'red', origins: ['ai_keyword'] }],
      },
    }, corpusVersion)).toThrow('relationship_input_feature_record_invalid');
  });

  it('binds fields that are intentionally not promoted into the whole-feature receipt', () => {
    const withFirstJob = extractCaseGraphFeatures({ ...raw, ingestion_job_id: 'job-one' }, {
      corpusVersion,
      eligibility: { eligible: true },
    }) as CaseGraphFeatureRecord;
    const withSecondJob = extractCaseGraphFeatures({ ...raw, ingestion_job_id: 'job-two' }, {
      corpusVersion,
      eligibility: { eligible: true },
    }) as CaseGraphFeatureRecord;
    const first = buildRelationshipInputFeatureEnrichment(node, withFirstJob, corpusVersion);
    const second = buildRelationshipInputFeatureEnrichment(node, withSecondJob, corpusVersion);
    expect(first.featureArchiveReceipt?.recordSha256).not.toBe(second.featureArchiveReceipt?.recordSha256);

    const firstRecord = extractRelationshipInputRecord(node, {
      binding,
      vectorPolicy: {
        modelId: 'case-vortex-narrative', modelVersion: 'v1', dimensions: 1536, normalization: 'l2',
      },
      enrichment: first,
    });
    const secondRecord = extractRelationshipInputRecord(node, {
      binding,
      vectorPolicy: {
        modelId: 'case-vortex-narrative', modelVersion: 'v1', dimensions: 1536, normalization: 'l2',
      },
      enrichment: second,
    });
    expect(firstRecord.recordDigest).not.toBe(secondRecord.recordDigest);
  });

  it('keeps valid coordinates conservative when archived spatial precision is unknown', () => {
    const unknownPrecisionFeature = extractCaseGraphFeatures({ ...raw, geo_precision: 'unknown' }, {
      corpusVersion,
      eligibility: { eligible: true },
    }) as CaseGraphFeatureRecord;
    const enrichment = buildRelationshipInputFeatureEnrichment(node, unknownPrecisionFeature, corpusVersion);
    expect(enrichment.spatialPrecision).toBeUndefined();
    const record = extractRelationshipInputRecord(node, {
      binding,
      vectorPolicy: {
        modelId: 'case-vortex-narrative', modelVersion: 'v1', dimensions: 1536, normalization: 'l2',
      },
      enrichment,
    });
    expect(record.recordMissingness).toContainEqual({
      field: 'spatial_precision', status: 'not_recorded', reason: 'precision_missing',
    });
    expect(record.facts.some((fact) => fact.value?.kind === 'geo_point')).toBe(false);
  });

  it('does not turn unreceipted AI terms or entities into relationship facts', () => {
    const enrichedFeature = extractCaseGraphFeatures({
      ...raw,
      ai_entities: ['unreviewed entity'],
      ai_keywords: ['unreviewed claim'],
    }, {
      corpusVersion,
      eligibility: { eligible: true },
    }) as CaseGraphFeatureRecord;
    const enrichment = buildRelationshipInputFeatureEnrichment(node, enrichedFeature, corpusVersion);
    expect(enrichment.governedMentions).toBeUndefined();
    expect(enrichment.narrativePatterns).toBeUndefined();
    expect(enrichment.featureArchiveReceipt?.recordSha256)
      .not.toBe(relationshipInputFeatureRecordSha256(feature));
  });
});
