import { describe, expect, it, vi } from 'vitest';

import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
} from '../../src/caseGraph/externalCorrelation';
import {
  createPostgresCaseGraphExternalCorrelationProvider,
  createPostgresCaseGraphExternalCorrelationPublicationTransaction,
  createPostgresCaseGraphExternalCorrelationGovernanceInspector,
  createPostgresGovernedExternalCorrelationProviderAdapter,
  inspectCaseGraphExternalCorrelationServing,
} from '../../src/caseGraph/postgresExternalCorrelation';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const publication = {
  publicationId: '11111111-1111-4111-8111-111111111111', corpusVersion: 'corpus-v3',
  manifestSha256: 'a'.repeat(64), snapshotId: 'snapshot-v3', graphArtifactSetSha256: 'b'.repeat(64),
  relationshipSchemaVersion: 'schema-v3', relationshipPolicyVersion: 'policy-v3', relationshipPolicySha256: 'c'.repeat(64),
  relationshipModelId: 'model-v3', relationshipModelVersion: '3', relationshipModelSha256: 'd'.repeat(64), calibrationSetSha256: 'e'.repeat(64),
};
const address = 'sighting:22222222-2222-4222-8222-222222222222';
const checkedAt = '2026-07-20T12:10:00.000Z';
const source = {
  snapshotId: '33333333-3333-4333-8333-333333333333', providerId: 'sondehub', datasetVersion: 'history-v1',
  coverageStart: '2026-07-20T00:00:00.000Z', coverageEnd: '2026-07-20T12:00:00.000Z',
  acquiredAt: '2026-07-20T12:05:00.000Z', sourceUrl: 'https://sondehub.org/', license: 'provider terms',
  receiptSha256: 'b'.repeat(64),
};
const candidateCore = {
  category: 'balloon' as const, sourceRecordId: 'sondehub:track-1', label: 'Weather balloon track',
  observedAt: '2026-07-20T11:58:00.000Z', measurements: { distance_km: 12.5, time_delta_seconds: 120 },
  reasonCodes: ['bounded_time_distance_match'], explanation: 'The archived track falls inside the declared bounds.',
  uncertainty: ['The sighting time has minute-level precision.'],
};
const candidateDigest = relationshipInputSha256(candidateCore);
const candidate = { candidateId: `external-correlation:${candidateDigest}`, ...candidateCore, candidateDigest };
const balloonAssessmentCore = {
  category: 'balloon' as const, availability: 'available' as const, reasonCodes: ['bounded_archive_available'],
  explanation: 'A publication-pinned balloon archive was checked.', source, candidates: [candidate], checkedAt,
};
const meteorAssessmentCore = {
  category: 'meteor' as const, availability: 'unavailable' as const, reasonCodes: ['governed_provider_unavailable'],
  explanation: 'The governed meteor archive is unavailable.', source: null, candidates: [], checkedAt,
};

describe('PostgreSQL external correlation provider', () => {
  it('reads an exact legal-registry decision and fails closed for missing or cancelled reads', async () => {
    const run = vi.fn(async () => ({ rows: [{
      canonical_source: 'OPEN_METEO', legal_status: 'approved', allowed_content_modes: ['full_ingest'],
    }] }));
    const inspect = createPostgresCaseGraphExternalCorrelationGovernanceInspector(run);
    await expect(inspect({ canonicalSource: 'open_meteo', category: 'weather' })).resolves.toEqual({
      present: true, canonicalSource: 'OPEN_METEO', legalStatus: 'approved', allowedContentModes: ['full_ingest'],
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining('uap_source_legal_registry'), ['OPEN_METEO']);

    run.mockResolvedValueOnce({ rows: [] });
    await expect(inspect({ canonicalSource: 'MISSING', category: 'weather' })).resolves.toEqual({
      present: false, canonicalSource: 'MISSING', legalStatus: 'review', allowedContentModes: null,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(inspect({ canonicalSource: 'OPEN_METEO', category: 'weather', signal: controller.signal }))
      .rejects.toThrow('case_graph_research_aborted');
  });

  it('rejects ambiguous or malformed legal-registry decisions', async () => {
    const inspectDuplicate = createPostgresCaseGraphExternalCorrelationGovernanceInspector(async () => ({ rows: [
      { canonical_source: 'OPEN_METEO', legal_status: 'approved', allowed_content_modes: ['full_ingest'] },
      { canonical_source: 'OPEN_METEO', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
    ] }));
    await expect(inspectDuplicate({ canonicalSource: 'OPEN_METEO', category: 'weather' }))
      .rejects.toThrow('case_graph_external_correlation_integrity_failed');
    const inspectMalformed = createPostgresCaseGraphExternalCorrelationGovernanceInspector(async () => ({ rows: [{
      canonical_source: 'OPEN_METEO', legal_status: 'approved', allowed_content_modes: 'full_ingest',
    }] }));
    await expect(inspectMalformed({ canonicalSource: 'OPEN_METEO', category: 'weather' }))
      .rejects.toThrow('case_graph_external_correlation_integrity_failed');
  });

  it('composes PostgreSQL governance with a concrete provider before access', async () => {
    const run = vi.fn(async () => ({ rows: [{
      canonical_source: 'SONDEHUB', legal_status: 'review', allowed_content_modes: ['metadata_only'],
    }] }));
    const correlate = vi.fn();
    const adapter = createPostgresGovernedExternalCorrelationProviderAdapter({
      category: 'balloon', canonicalSource: 'SONDEHUB', providerId: 'sondehub',
      allowedContentModes: ['full_ingest'], correlate, run,
    });
    await expect(adapter.correlate({
      publication, address, nodeDigest: 'f'.repeat(64), limit: 5, checkedAt,
    })).resolves.toMatchObject({
      availability: 'unavailable', reasonCodes: ['source_governance_not_approved'], source: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(correlate).not.toHaveBeenCalled();
  });

  it('commits successful publication work and rolls failures back on the same client', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'FAIL') throw new Error('write_failed');
      return { rows: [] };
    });
    const release = vi.fn();
    const acquire = vi.fn(async () => ({ query, release } as never));
    const transaction = createPostgresCaseGraphExternalCorrelationPublicationTransaction(acquire);
    await expect(transaction(async (run) => {
      await run('WRITE');
      return 'ok';
    })).resolves.toBe('ok');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'WRITE', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);

    query.mockClear();
    release.mockClear();
    await expect(transaction(async (run) => {
      await run('FAIL');
      return 'unreachable';
    })).rejects.toThrow('write_failed');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'FAIL', 'ROLLBACK']);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('returns publication-bound coverage and bounded candidates in requested category order', async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('case_graph_external_correlation_coverage')) return { rows: [
        {
          category: 'balloon', availability: 'available', reason_codes: balloonAssessmentCore.reasonCodes,
          explanation: balloonAssessmentCore.explanation, checked_at: checkedAt,
          assessment_digest: relationshipInputSha256(balloonAssessmentCore), source_snapshot_id: source.snapshotId,
          provider_id: source.providerId, dataset_version: source.datasetVersion, coverage_start: source.coverageStart,
          coverage_end: source.coverageEnd, acquired_at: source.acquiredAt, source_url: source.sourceUrl,
          license: source.license, receipt_sha256: source.receiptSha256,
        },
        {
          category: 'meteor', availability: 'unavailable', reason_codes: meteorAssessmentCore.reasonCodes,
          explanation: meteorAssessmentCore.explanation, checked_at: checkedAt,
          assessment_digest: relationshipInputSha256(meteorAssessmentCore), source_snapshot_id: null,
        },
      ] };
      if (sql.includes('case_graph_external_correlation_candidates')) return { rows: [{
        category: 'balloon', candidate_id: candidate.candidateId, source_record_id: candidate.sourceRecordId,
        label: candidate.label, observed_at: candidate.observedAt, measurements: candidate.measurements,
        reason_codes: candidate.reasonCodes, explanation: candidate.explanation, uncertainty: candidate.uncertainty,
        candidate_digest: candidate.candidateDigest, source_snapshot_id: source.snapshotId,
      }] };
      throw new Error('unexpected_query');
    });
    const provider = createPostgresCaseGraphExternalCorrelationProvider(run);
    const result = await provider.correlate({ publication, address, categories: ['balloon', 'meteor'], limitPerCategory: 5 });
    expect(result.assessments).toEqual([
      expect.objectContaining({ category: 'balloon', availability: 'available', candidates: [expect.objectContaining({ label: 'Weather balloon track' })] }),
      expect.objectContaining({ category: 'meteor', availability: 'unavailable', candidates: [] }),
    ]);
    expect(run.mock.calls[1][1]).toEqual([publication.publicationId, address, ['balloon', 'meteor'], 5]);
  });

  it('fails closed when coverage is incomplete', async () => {
    const run = vi.fn(async (sql: string) => ({ rows: sql.includes('coverage') ? [] : [] }));
    const provider = createPostgresCaseGraphExternalCorrelationProvider(run);
    await expect(provider.correlate({ publication, address, categories: ['aircraft'], limitPerCategory: 5 }))
      .rejects.toThrow('case_graph_external_correlation_integrity_failed');
  });

  it('fails closed if stored candidates contradict coverage availability or source snapshot', async () => {
    const coverage = {
      category: 'meteor', availability: 'unavailable', reason_codes: ['source_unavailable'],
      explanation: 'No source was available.', checked_at: checkedAt,
      assessment_digest: 'd'.repeat(64), source_snapshot_id: null,
    };
    const storedCandidate = {
      category: 'meteor', candidate_id: candidate.candidateId, source_record_id: candidate.sourceRecordId,
      label: candidate.label, observed_at: candidate.observedAt, measurements: candidate.measurements,
      reason_codes: candidate.reasonCodes, explanation: candidate.explanation, uncertainty: candidate.uncertainty,
      candidate_digest: candidate.candidateDigest, source_snapshot_id: source.snapshotId,
    };
    const run = vi.fn(async (sql: string) => ({ rows: sql.includes('coverage') ? [coverage] : [storedCandidate] }));
    await expect(createPostgresCaseGraphExternalCorrelationProvider(run).correlate({
      publication, address, categories: ['meteor'], limitPerCategory: 5,
    })).rejects.toThrow('case_graph_external_correlation_integrity_failed');
  });

  it('preflights the exact publication manifest and complete nine-category set', async () => {
    const run = vi.fn(async () => ({ rows: [{
      manifest_sha256: publication.manifestSha256,
      category_set: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES],
      completion_sha256: 'c'.repeat(64), completed_at: checkedAt,
    }] }));
    await expect(inspectCaseGraphExternalCorrelationServing({ publication, run })).resolves.toMatchObject({
      verified: true, completionSha256: 'c'.repeat(64), provider: expect.any(Object),
    });
    run.mockResolvedValueOnce({ rows: [{
      manifest_sha256: 'd'.repeat(64), category_set: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES],
      completion_sha256: 'c'.repeat(64), completed_at: checkedAt,
    }] });
    await expect(inspectCaseGraphExternalCorrelationServing({ publication, run }))
      .rejects.toThrow('case_graph_external_correlation_unavailable');
  });
});
