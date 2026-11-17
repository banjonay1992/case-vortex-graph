import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
  unavailableExternalCorrelationResult,
  verifyCaseGraphExternalCorrelationResult,
} from '../../src/caseGraph/externalCorrelation';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const publication = {
  publicationId: '11111111-1111-4111-8111-111111111111', corpusVersion: 'corpus-v3',
  manifestSha256: 'a'.repeat(64), snapshotId: 'snapshot-v3', graphArtifactSetSha256: 'b'.repeat(64),
  relationshipSchemaVersion: 'schema-v3', relationshipPolicyVersion: 'policy-v3', relationshipPolicySha256: 'c'.repeat(64),
  relationshipModelId: 'model-v3', relationshipModelVersion: '3', relationshipModelSha256: 'd'.repeat(64), calibrationSetSha256: 'e'.repeat(64),
};
const address = 'sighting:22222222-2222-4222-8222-222222222222';

describe('Case Graph external correlation contract', () => {
  it('discloses unavailable coverage for all nine categories without implying they were ruled out', () => {
    const result = unavailableExternalCorrelationResult({
      publication, address, categories: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES],
      checkedAt: '2026-07-20T12:10:00.000Z',
    });
    expect(verifyCaseGraphExternalCorrelationResult({
      value: result, publication, address, categories: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES], limitPerCategory: 5,
    })).toEqual(result);
    expect(result.assessments).toHaveLength(9);
    expect(result.assessments.every((item) => item.availability === 'unavailable' && !item.candidates.length)).toBe(true);
    expect(result.assessments[0].explanation).toContain('Absence of a candidate is not evidence');
  });

  it('verifies digest-bound provider candidates and bounded source coverage', () => {
    const candidateCore = {
      category: 'balloon' as const, sourceRecordId: 'sondehub:track-1', label: 'Weather balloon track',
      observedAt: '2026-07-20T11:58:00.000Z', measurements: { distance_km: 12.5, time_delta_seconds: 120 },
      reasonCodes: ['bounded_time_distance_match'],
      explanation: 'The archived track falls inside the declared time and distance bounds.',
      uncertainty: ['The sighting has minute-level time precision.'],
    };
    const candidateDigest = relationshipInputSha256(candidateCore);
    const candidate = { candidateId: `external-correlation:${candidateDigest}`, ...candidateCore, candidateDigest };
    const source = {
      snapshotId: 'snapshot:sondehub:2026-07-20', providerId: 'sondehub', datasetVersion: 'history-2026-07-20',
      coverageStart: '2026-07-20T00:00:00.000Z', coverageEnd: '2026-07-20T12:00:00.000Z',
      acquiredAt: '2026-07-20T12:05:00.000Z', sourceUrl: 'https://sondehub.org/', license: 'provider terms',
      receiptSha256: 'b'.repeat(64),
    };
    const assessmentCore = {
      category: 'balloon' as const, availability: 'available' as const, reasonCodes: ['bounded_archive_available'],
      explanation: 'A publication-pinned balloon archive was checked.', source, candidates: [candidate],
      checkedAt: '2026-07-20T12:10:00.000Z',
    };
    const assessment = { ...assessmentCore, assessmentDigest: relationshipInputSha256(assessmentCore) };
    const resultCore = {
      recordType: 'case_graph_external_correlation_result' as const,
      schemaVersion: CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
      publication, address, assessments: [assessment],
      limitations: ['External correlations are candidates, not identifications.'],
    };
    const result = { ...resultCore, resultDigest: relationshipInputSha256(resultCore) };
    expect(verifyCaseGraphExternalCorrelationResult({
      value: result, publication, address, categories: ['balloon'], limitPerCategory: 5,
    })).toEqual(result);
  });

  it('rejects a tampered availability assessment or category order', () => {
    const result = unavailableExternalCorrelationResult({
      publication, address, categories: ['aircraft', 'weather'], checkedAt: '2026-07-20T12:10:00.000Z',
    });
    const tampered = structuredClone(result);
    tampered.assessments[0].explanation = 'Coverage exists.';
    expect(() => verifyCaseGraphExternalCorrelationResult({
      value: tampered, publication, address, categories: ['aircraft', 'weather'], limitPerCategory: 5,
    })).toThrow('case_graph_external_correlation_integrity_failed');
    expect(() => verifyCaseGraphExternalCorrelationResult({
      value: result, publication, address, categories: ['weather', 'aircraft'], limitPerCategory: 5,
    })).toThrow('case_graph_external_correlation_integrity_failed');
  });

  it('keeps the schema and required category set explicit', () => {
    expect(CASE_GRAPH_EXTERNAL_CORRELATION_VERSION).toBe('case-graph-external-correlation-v1');
    expect(CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES).toEqual([
      'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
      'military_exercise', 'launch', 'maritime', 'weather',
    ]);
  });
});
