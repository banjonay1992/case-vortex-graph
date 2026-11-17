import { describe, expect, it, vi } from 'vitest';

import { buildCaseGraphExternalCorrelationResultFromAdapters } from '../../src/caseGraph/externalCorrelationProviderAdapters';
import {
  caseGraphExternalProviderArchiveRecordSetSha256,
  createPostgresExternalProviderArchiveAdapter,
  makeCaseGraphExternalProviderArchiveReceipt,
  makeCaseGraphExternalProviderArchiveRecord,
  publishCaseGraphExternalProviderArchive,
  type CaseGraphExternalProviderArchiveTransaction,
} from '../../src/caseGraph/providerArchiveExternalCorrelation';

const digest = (character: string) => character.repeat(64);
const snapshotId = '00000000-0000-4000-8000-000000000099';
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'provider-archive-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-v1', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model-v1', relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const address = 'sighting:case-a';
const nodeDigest = digest('6');
const candidate = {
  sourceRecordId: 'balloon-track-42', label: 'Archived balloon track',
  observedAt: '2026-07-21T19:55:00.000Z',
  measurements: { distance_km: 8.2, time_delta_minutes: 5 },
  reasonCodes: ['bounded_time_distance_match'],
  explanation: 'The archived track overlaps the bounded event window.',
  uncertainty: ['The reported sighting time is minute-level.'],
};
const record = makeCaseGraphExternalProviderArchiveRecord({
  snapshotId, publicationId: publication.publicationId, address, nodeDigest,
  availability: 'available', reasonCodes: ['snapshot_record_checked'],
  explanation: 'A sealed balloon archive was checked.', candidates: [candidate],
});
const archiveSha = digest('a');
const snapshot = {
  snapshotId,
  publication,
  category: 'balloon' as const,
  canonicalSource: 'SONDEHUB_ARCHIVE',
  contentMode: 'full_ingest' as const,
  providerId: 'sondehub-archive',
  datasetVersion: '2026-07-21',
  coverageStart: '2026-07-21T00:00:00.000Z',
  coverageEnd: '2026-07-22T00:00:00.000Z',
  acquiredAt: '2026-07-22T01:00:00.000Z',
  sourceUrl: 'https://example.test/balloons',
  license: 'approved fixture',
  archiveObjectKey: `case-vortex/external-providers/balloon/${archiveSha}.ndjson.gz`,
  archiveObjectSha256: archiveSha,
  archiveObjectBytes: 4096,
};
const row = {
  snapshot_id: snapshotId, provider_id: 'sondehub-archive', dataset_version: '2026-07-21',
  coverage_start: '2026-07-21T00:00:00.000Z', coverage_end: '2026-07-22T00:00:00.000Z',
  acquired_at: '2026-07-22T01:00:00.000Z', source_url: 'https://example.test/balloons',
  license: 'approved fixture', receipt_sha256: digest('7'), record_address: address,
  node_digest: nodeDigest, availability: record.availability, reason_codes: record.reasonCodes,
  explanation: record.explanation, candidates: record.candidates, record_digest: record.recordDigest,
};

describe('sealed external provider archive adapter', () => {
  it('reads and verifies one publication-bound record before producing candidates', async () => {
    const run = vi.fn(async () => ({ rows: [row] }));
    const adapter = createPostgresExternalProviderArchiveAdapter({ publication, snapshotId, category: 'balloon', run });
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({
      publication, address, nodeDigest, adapters: [adapter], limitPerCategory: 10,
      checkedAt: '2026-07-22T02:00:00.000Z',
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining("archive.status = 'complete'"), [
      snapshotId, publication.publicationId, 'balloon', address,
    ]);
    expect(result.assessments.find(({ category }) => category === 'balloon')).toMatchObject({
      availability: 'available', source: { snapshotId, providerId: 'sondehub-archive' },
      candidates: [{ sourceRecordId: 'balloon-track-42' }],
    });
  });

  it('distinguishes a missing completed snapshot from an unassessed record', async () => {
    const missing = createPostgresExternalProviderArchiveAdapter({
      publication, snapshotId, category: 'balloon', run: async () => ({ rows: [] }),
    });
    await expect(missing.correlate({
      publication, address, nodeDigest, limit: 5, checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toMatchObject({ availability: 'unavailable', reasonCodes: ['provider_snapshot_unavailable'], source: null });

    const unassessed = createPostgresExternalProviderArchiveAdapter({
      publication, snapshotId, category: 'balloon', run: async () => ({ rows: [{ ...row, record_address: null }] }),
    });
    await expect(unassessed.correlate({
      publication, address, nodeDigest, limit: 5, checkedAt: '2026-07-22T02:00:00.000Z',
    })).resolves.toMatchObject({
      availability: 'unavailable', reasonCodes: ['provider_record_not_assessed'], source: { snapshotId },
    });
  });

  it('rejects record/node tampering, publication drift and cancellation', async () => {
    const adapter = createPostgresExternalProviderArchiveAdapter({
      publication, snapshotId, category: 'balloon', run: async () => ({ rows: [{ ...row, record_digest: digest('f') }] }),
    });
    await expect(adapter.correlate({
      publication, address, nodeDigest, limit: 5, checkedAt: '2026-07-22T02:00:00.000Z',
    })).rejects.toThrow('case_graph_external_provider_archive_record_mismatch');
    await expect(adapter.correlate({
      publication: { ...publication, manifestSha256: digest('9') }, address, nodeDigest,
      limit: 5, checkedAt: '2026-07-22T02:00:00.000Z',
    })).rejects.toThrow('case_graph_external_provider_archive_publication_mismatch');
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.correlate({
      publication, address, nodeDigest, limit: 5, checkedAt: '2026-07-22T02:00:00.000Z', signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
  });

  it('matches PostgreSQL finalization record-set hashing including the empty set', () => {
    const second = makeCaseGraphExternalProviderArchiveRecord({
      snapshotId, publicationId: publication.publicationId, address: 'sighting:case-b', nodeDigest: digest('8'),
      availability: 'unavailable', reasonCodes: ['no_match'], explanation: 'No bounded match.', candidates: [],
    });
    expect(caseGraphExternalProviderArchiveRecordSetSha256([second, record])).toMatch(/^[a-f0-9]{64}$/);
    expect(caseGraphExternalProviderArchiveRecordSetSha256([]))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('writes the verified R2 object and every exact record before finalizing once', async () => {
    const expected = makeCaseGraphExternalProviderArchiveReceipt({ snapshot, records: [record] });
    const calls: string[] = [];
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => work(async (sql) => {
      calls.push(sql);
      if (sql.includes('external-provider-archive:existing')) return { rows: [] };
      if (sql.includes('external-provider-archive:governance')) return { rows: [{
        public_manifest_sha256: publication.manifestSha256,
        legal_status: 'approved', allowed_content_modes: ['full_ingest'],
      }] };
      if (sql.includes('external-provider-archive:nodes')) return { rows: [{ address, node_digest: nodeDigest }] };
      if (sql.includes('external-provider-archive:completion-check')) return { rows: [{
        status: 'complete', record_count: '1', record_set_sha256: expected.recordSetSha256,
        receipt_sha256: expected.receiptDigest,
      }] };
      return { rows: [] };
    });
    const verifyArchiveObject = vi.fn(async () => ({ sha256: archiveSha, bytes: 4096 }));
    await expect(publishCaseGraphExternalProviderArchive({
      snapshot, records: [record], transaction, verifyArchiveObject,
    })).resolves.toEqual({ status: 'written', receipt: expected });
    expect(verifyArchiveObject).toHaveBeenCalledWith(expect.objectContaining({
      key: snapshot.archiveObjectKey, expectedSha256: archiveSha, expectedBytes: 4096,
    }));
    expect(calls.findIndex((sql) => sql.includes('external-provider-archive:records')))
      .toBeLessThan(calls.findIndex((sql) => sql.includes('external-provider-archive:finalize')));
  });

  it('reuses only an exact completed archive and rejects governance or partial conflicts', async () => {
    const expected = makeCaseGraphExternalProviderArchiveReceipt({ snapshot, records: [record] });
    const verifyArchiveObject = async () => ({ sha256: archiveSha, bytes: 4096 });
    const existingRow = {
      status: 'complete', publication_id: publication.publicationId, category: 'balloon',
      canonical_source: snapshot.canonicalSource, content_mode: snapshot.contentMode,
      provider_id: snapshot.providerId, dataset_version: snapshot.datasetVersion,
      archive_object_sha256: archiveSha, archive_object_bytes: '4096', record_count: '1',
      record_set_sha256: expected.recordSetSha256, receipt_sha256: expected.receiptDigest,
    };
    const transactionWith = (existing: Record<string, unknown>[], governance?: Record<string, unknown>) => (
      (async (work) => work(async (sql) => {
        if (sql.includes('external-provider-archive:existing')) return { rows: existing };
        if (sql.includes('external-provider-archive:governance')) return { rows: governance ? [governance] : [] };
        return { rows: [] };
      })) as CaseGraphExternalProviderArchiveTransaction
    );
    await expect(publishCaseGraphExternalProviderArchive({
      snapshot, records: [record], transaction: transactionWith([existingRow]), verifyArchiveObject,
    })).resolves.toEqual({ status: 'reused', receipt: expected });
    await expect(publishCaseGraphExternalProviderArchive({
      snapshot, records: [record], transaction: transactionWith([{ ...existingRow, status: 'building' }]), verifyArchiveObject,
    })).rejects.toThrow('case_graph_external_provider_archive_conflict');
    await expect(publishCaseGraphExternalProviderArchive({
      snapshot, records: [record], transaction: transactionWith([], {
        public_manifest_sha256: publication.manifestSha256,
        legal_status: 'review', allowed_content_modes: ['full_ingest'],
      }), verifyArchiveObject,
    })).rejects.toThrow('case_graph_external_provider_archive_governance_rejected');
  });

  it('never opens a transaction for object tampering or cancellation', async () => {
    const transaction = vi.fn();
    await expect(publishCaseGraphExternalProviderArchive({
      snapshot, records: [record], transaction,
      verifyArchiveObject: async () => ({ sha256: digest('f'), bytes: 4096 }),
    })).rejects.toThrow('case_graph_external_provider_archive_object_mismatch');
    const controller = new AbortController();
    controller.abort();
    const verifyArchiveObject = vi.fn();
    await expect(publishCaseGraphExternalProviderArchive({
      snapshot, records: [record], transaction, verifyArchiveObject, signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
    expect(transaction).not.toHaveBeenCalled();
    expect(verifyArchiveObject).not.toHaveBeenCalled();
  });
});
