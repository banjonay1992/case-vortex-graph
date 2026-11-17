import { describe, expect, it } from 'vitest';

import {
  unavailableExternalCorrelationResult,
  type CaseGraphExternalCorrelationAssessment,
  type CaseGraphExternalCorrelationResult,
} from '../../src/caseGraph/externalCorrelation';
import {
  makeCaseGraphExternalCorrelationPublicationReceipt,
  publishCaseGraphExternalCorrelationPublication,
  type CaseGraphExternalCorrelationPublicationTransaction,
} from '../../src/caseGraph/externalCorrelationPublication';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'external-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1',
  relationshipModelVersion: 'model-v1', relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};
const categories = [
  'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
  'military_exercise', 'launch', 'maritime', 'weather',
] as const;
const record = (address: string, nodeDigest = digest('6')) => ({
  nodeDigest,
  result: unavailableExternalCorrelationResult({
    publication, address, categories: [...categories], checkedAt: '2026-07-21T20:00:00.000Z',
  }),
});
const availableRecord = () => {
  const address = 'sighting:case-weather';
  const source = {
    snapshotId: '00000000-0000-4000-8000-000000000099', providerId: 'met-office-test',
    datasetVersion: '2026-07-21', coverageStart: '2026-07-21T00:00:00.000Z',
    coverageEnd: '2026-07-22T00:00:00.000Z', acquiredAt: '2026-07-22T01:00:00.000Z',
    sourceUrl: 'https://example.test/weather', license: 'test-license', receiptSha256: digest('8'),
  };
  const candidateCore = {
    category: 'weather' as const, sourceRecordId: 'weather-42', label: 'Low cloud layer',
    observedAt: '2026-07-21T20:00:00.000Z', measurements: { cloud_base_m: 450 },
    reasonCodes: ['time_window_match'], explanation: 'Weather observation overlaps the report window.',
    uncertainty: ['Station is 12 km from the reported location.'],
  };
  const candidateDigest = relationshipInputSha256(candidateCore);
  const candidate = { candidateId: `external-correlation:${candidateDigest}`, ...candidateCore, candidateDigest };
  const assessments: CaseGraphExternalCorrelationAssessment[] = categories.map((category) => {
    const core = category === 'weather' ? {
      category, availability: 'available' as const, reasonCodes: ['snapshot_covered'],
      explanation: 'A governed weather snapshot covers the event window.', source,
      candidates: [candidate], checkedAt: '2026-07-22T02:00:00.000Z',
    } : {
      category, availability: 'unavailable' as const, reasonCodes: ['provider_unavailable'],
      explanation: 'No governed provider snapshot is available.', source: null, candidates: [],
      checkedAt: '2026-07-22T02:00:00.000Z',
    };
    return { ...core, assessmentDigest: relationshipInputSha256(core) };
  });
  const core = {
    recordType: 'case_graph_external_correlation_result' as const,
    schemaVersion: 'case-graph-external-correlation-v1' as const,
    publication, address, assessments,
    limitations: ['External correlations are candidate comparisons, not identifications, causal explanations, debunking conclusions, or origin assessments.'],
  };
  return { nodeDigest: digest('9'), result: { ...core, resultDigest: relationshipInputSha256(core) } satisfies CaseGraphExternalCorrelationResult };
};

describe('external-correlation full-publication accounting', () => {
  it('deterministically accounts every address across all nine categories and explicit missingness', () => {
    const first = makeCaseGraphExternalCorrelationPublicationReceipt({
      publication, records: [record('sighting:case-b', digest('7')), record('sighting:case-a')], limitPerCategory: 20,
    });
    const reversed = makeCaseGraphExternalCorrelationPublicationReceipt({
      publication, records: [record('sighting:case-a'), record('sighting:case-b', digest('7'))], limitPerCategory: 20,
    });
    expect(reversed).toEqual(first);
    expect(first).toMatchObject({
      addressCount: 2, coverageCount: 18, candidateCount: 0, sourceSnapshotCount: 0,
      availabilityCounts: { available: 0, insufficient_evidence: 0, unavailable: 18, stale: 0 },
    });
    expect(first.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects duplicate addresses, incomplete categories, invalid limits and node digests', () => {
    expect(() => makeCaseGraphExternalCorrelationPublicationReceipt({
      publication, records: [record('sighting:case-a'), record('sighting:case-a')], limitPerCategory: 20,
    })).toThrow('case_graph_external_correlation_publication_duplicate_address');
    const incomplete = record('sighting:case-a');
    incomplete.result = unavailableExternalCorrelationResult({
      publication, address: 'sighting:case-a', categories: ['weather'], checkedAt: '2026-07-21T20:00:00.000Z',
    });
    expect(() => makeCaseGraphExternalCorrelationPublicationReceipt({
      publication, records: [incomplete], limitPerCategory: 20,
    })).toThrow('case_graph_external_correlation_integrity_failed');
    expect(() => makeCaseGraphExternalCorrelationPublicationReceipt({
      publication, records: [record('sighting:case-a')], limitPerCategory: 0,
    })).toThrow('case_graph_external_correlation_publication_invalid');
    expect(() => makeCaseGraphExternalCorrelationPublicationReceipt({
      publication, records: [record('sighting:case-a', 'bad')], limitPerCategory: 20,
    })).toThrow('case_graph_external_correlation_publication_invalid');
  });

  it('publishes coverage and completion atomically and reuses only the exact receipt', async () => {
    const records = [record('sighting:case-a')];
    const expected = makeCaseGraphExternalCorrelationPublicationReceipt({ publication, records, limitPerCategory: 20 });
    const calls: string[] = [];
    const transaction: CaseGraphExternalCorrelationPublicationTransaction = async (work) => work(async (sql) => {
      calls.push(sql);
      if (sql.includes('existing-completion')) return { rows: [] };
      if (sql.includes('publication-nodes')) return { rows: [{ address: 'sighting:case-a', node_digest: digest('6'), total_publication_count: '1' }] };
      if (sql.includes('partial-check')) return { rows: [{ coverage_count: '0' }] };
      if (sql.includes('completion')) return { rows: [{ completion_sha256: expected.receiptDigest }] };
      if (sql.includes('accounting')) return { rows: [{ coverage_count: '9', candidate_count: '0', source_count: '0' }] };
      return { rows: [] };
    });
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20, transaction,
    })).resolves.toEqual({ status: 'written', receipt: expected });
    expect(calls.findIndex((sql) => sql.includes('external-correlation:coverage */')))
      .toBeLessThan(calls.findIndex((sql) => sql.includes('external-correlation:completion */')));

    const reuse: CaseGraphExternalCorrelationPublicationTransaction = async (work) => work(async (sql) => {
      if (sql.includes('existing-completion')) return { rows: [{
        completion_sha256: expected.receiptDigest,
        source_snapshot_set_sha256: expected.sourceSnapshotSetSha256,
        coverage_set_sha256: expected.coverageSetSha256,
        candidate_set_sha256: expected.candidateSetSha256,
        accounting: expected,
      }] };
      return { rows: [] };
    });
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20, transaction: reuse,
    })).resolves.toEqual({ status: 'reused', receipt: expected });
  });

  it('rejects publication-node drift, partial state, conflicting completion and cancellation', async () => {
    const records = [record('sighting:case-a')];
    const runWith = (responses: Record<string, Array<Record<string, unknown>>>) => (
      (async (work) => work(async (sql) => {
        const key = Object.keys(responses).find((candidate) => sql.includes(candidate));
        return { rows: key ? responses[key] : [] };
      })) as CaseGraphExternalCorrelationPublicationTransaction
    );
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20,
      transaction: runWith({ 'existing-completion': [], 'publication-nodes': [] }),
    })).rejects.toThrow('case_graph_external_correlation_publication_node_mismatch');
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20,
      transaction: runWith({
        'existing-completion': [],
        'publication-nodes': [{
          address: 'sighting:case-a', node_digest: digest('6'), total_publication_count: '2',
        }],
      }),
    })).rejects.toThrow('case_graph_external_correlation_publication_node_mismatch');
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20,
      transaction: runWith({
        'existing-completion': [],
        'publication-nodes': [{ address: 'sighting:case-a', node_digest: digest('6'), total_publication_count: '1' }],
        'partial-check': [{ coverage_count: '1' }],
      }),
    })).rejects.toThrow('case_graph_external_correlation_publication_partial_state');
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20,
      transaction: runWith({ 'existing-completion': [{ completion_sha256: digest('f') }] }),
    })).rejects.toThrow('case_graph_external_correlation_publication_conflict');
    const controller = new AbortController();
    controller.abort();
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20,
      transaction: runWith({}), signal: controller.signal,
    })).rejects.toThrow('case_graph_external_correlation_publication_aborted');
  });

  it('writes and verifies exact provider snapshots and candidates before completion', async () => {
    const records = [availableRecord()];
    const expected = makeCaseGraphExternalCorrelationPublicationReceipt({ publication, records, limitPerCategory: 20 });
    const calls: string[] = [];
    const transaction: CaseGraphExternalCorrelationPublicationTransaction = async (work) => work(async (sql) => {
      calls.push(sql);
      if (sql.includes('existing-completion')) return { rows: [] };
      if (sql.includes('publication-nodes')) return { rows: [{ address: 'sighting:case-weather', node_digest: digest('9'), total_publication_count: '1' }] };
      if (sql.includes('partial-check')) return { rows: [{ coverage_count: '0' }] };
      if (sql.includes('source-snapshot-check')) return { rows: [{
        id: '00000000-0000-4000-8000-000000000099', category: 'weather', provider_id: 'met-office-test',
        dataset_version: '2026-07-21', coverage_start: '2026-07-21T00:00:00.000Z',
        coverage_end: '2026-07-22T00:00:00.000Z', acquired_at: '2026-07-22T01:00:00.000Z',
        source_url: 'https://example.test/weather', license: 'test-license', receipt_sha256: digest('8'),
      }] };
      if (sql.includes('external-correlation:completion */')) return { rows: [{ completion_sha256: expected.receiptDigest }] };
      if (sql.includes('external-correlation:accounting */')) return { rows: [{ coverage_count: '9', candidate_count: '1', source_count: '1' }] };
      return { rows: [] };
    });
    await expect(publishCaseGraphExternalCorrelationPublication({
      publication, records, limitPerCategory: 20, transaction,
    })).resolves.toEqual({ status: 'written', receipt: expected });
    expect(calls.some((sql) => sql.includes('source-snapshots'))).toBe(true);
    expect(calls.some((sql) => sql.includes('external-correlation:candidates */'))).toBe(true);
  });
});
