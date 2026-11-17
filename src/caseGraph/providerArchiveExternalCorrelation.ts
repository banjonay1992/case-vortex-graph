import { createHash } from 'node:crypto';

import type {
  CaseGraphExternalCorrelationAvailability,
  CaseGraphExternalCorrelationCategory,
} from './externalCorrelation';
import type {
  CaseGraphExternalCorrelationCandidateInput,
  CaseGraphExternalCorrelationProviderAdapter,
} from './externalCorrelationProviderAdapters';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export type CaseGraphExternalProviderArchiveQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export type CaseGraphExternalProviderArchiveRecordCore = {
  snapshotId: string;
  publicationId: string;
  address: string;
  nodeDigest: string;
  availability: CaseGraphExternalCorrelationAvailability;
  reasonCodes: string[];
  explanation: string;
  candidates: CaseGraphExternalCorrelationCandidateInput[];
};

export type CaseGraphExternalProviderArchiveRecord = CaseGraphExternalProviderArchiveRecordCore & {
  recordDigest: string;
};

export const CASE_GRAPH_EXTERNAL_PROVIDER_ARCHIVE_VERSION =
  'case-graph-external-provider-archive-v1' as const;

export type CaseGraphExternalProviderArchiveSnapshot = {
  snapshotId: string;
  publication: CaseGraphResearchPublicationBinding;
  category: CaseGraphExternalCorrelationCategory;
  canonicalSource: string;
  contentMode: 'full_ingest' | 'metadata_only' | 'derived_only' | 'all';
  providerId: string;
  datasetVersion: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  acquiredAt: string;
  sourceUrl: string | null;
  license: string | null;
  archiveObjectKey: string;
  archiveObjectSha256: string;
  archiveObjectBytes: number;
};

export type CaseGraphExternalProviderArchiveReceipt = {
  recordType: 'case_graph_external_provider_archive_receipt';
  schemaVersion: typeof CASE_GRAPH_EXTERNAL_PROVIDER_ARCHIVE_VERSION;
  snapshot: CaseGraphExternalProviderArchiveSnapshot;
  recordCount: number;
  candidateCount: number;
  recordSetSha256: string;
  receiptDigest: string;
};

export type CaseGraphExternalProviderArchiveTransaction = <T>(
  work: (run: CaseGraphExternalProviderArchiveQuery) => Promise<T>,
) => Promise<T>;

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (code: string): never => { throw new Error(code); };
const iso = (value: unknown) => {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail('case_graph_external_provider_archive_invalid');
  return date.toISOString();
};
const optionalIso = (value: unknown) => value == null ? null : iso(value);
const strings = (value: unknown) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail('case_graph_external_provider_archive_invalid');
  }
  return value as string[];
};

export const makeCaseGraphExternalProviderArchiveRecord = (
  core: CaseGraphExternalProviderArchiveRecordCore,
): CaseGraphExternalProviderArchiveRecord => {
  if (!UUID.test(core.snapshotId) || !UUID.test(core.publicationId) || !SHA256.test(core.nodeDigest)
    || !core.address || !core.explanation || !Array.isArray(core.reasonCodes) || !Array.isArray(core.candidates)
    || core.availability !== 'available' && core.candidates.length > 0) {
    fail('case_graph_external_provider_archive_record_invalid');
  }
  return { ...core, recordDigest: relationshipInputSha256(core) };
};

export const caseGraphExternalProviderArchiveRecordSetSha256 = (
  records: readonly CaseGraphExternalProviderArchiveRecord[],
) => createHash('sha256').update(
  [...records]
    .sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0)
    .map(({ address, recordDigest }) => `${address}:${recordDigest}`)
    .join('\n'),
  'utf8',
).digest('hex');

const ARCHIVE_KEY = /^case-vortex\/external-providers\/[a-z0-9/_-]+\/[a-f0-9]{64}\.ndjson\.gz$/;
const CONTENT_MODES = ['full_ingest', 'metadata_only', 'derived_only', 'all'] as const;
const CATEGORY_SET = new Set<CaseGraphExternalCorrelationCategory>([
  'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
  'military_exercise', 'launch', 'maritime', 'weather',
]);

export const makeCaseGraphExternalProviderArchiveReceipt = (params: {
  snapshot: CaseGraphExternalProviderArchiveSnapshot;
  records: readonly CaseGraphExternalProviderArchiveRecord[];
}): CaseGraphExternalProviderArchiveReceipt => {
  const snapshot = params.snapshot;
  if (!UUID.test(snapshot.snapshotId) || !UUID.test(snapshot.publication.publicationId)
    || !CATEGORY_SET.has(snapshot.category) || !/^[A-Z0-9][A-Z0-9._:-]{0,239}$/.test(snapshot.canonicalSource)
    || !CONTENT_MODES.includes(snapshot.contentMode) || !snapshot.providerId || !snapshot.datasetVersion
    || !SHA256.test(snapshot.archiveObjectSha256) || !ARCHIVE_KEY.test(snapshot.archiveObjectKey)
    || !snapshot.archiveObjectKey.endsWith(`/${snapshot.archiveObjectSha256}.ndjson.gz`)
    || !Number.isSafeInteger(snapshot.archiveObjectBytes) || snapshot.archiveObjectBytes < 1
    || snapshot.archiveObjectBytes > 34_359_738_368 || params.records.length > 1_000_000) {
    fail('case_graph_external_provider_archive_plan_invalid');
  }
  const acquiredAt = iso(snapshot.acquiredAt);
  const coverageStart = snapshot.coverageStart == null ? null : iso(snapshot.coverageStart);
  const coverageEnd = snapshot.coverageEnd == null ? null : iso(snapshot.coverageEnd);
  if (coverageStart && coverageEnd && coverageStart > coverageEnd) {
    fail('case_graph_external_provider_archive_plan_invalid');
  }
  for (const url of [snapshot.sourceUrl]) if (url) {
    try { if (!['https:', 'http:'].includes(new URL(url).protocol)) fail('case_graph_external_provider_archive_plan_invalid'); }
    catch { fail('case_graph_external_provider_archive_plan_invalid'); }
  }
  const normalizedSnapshot = { ...snapshot, coverageStart, coverageEnd, acquiredAt };
  const records = params.records.map((record) => {
    const { recordDigest, ...core } = record;
    const rebuilt = makeCaseGraphExternalProviderArchiveRecord(core);
    if (recordDigest !== rebuilt.recordDigest || rebuilt.snapshotId !== snapshot.snapshotId
      || rebuilt.publicationId !== snapshot.publication.publicationId) {
      fail('case_graph_external_provider_archive_record_mismatch');
    }
    return rebuilt;
  });
  if (new Set(records.map(({ address }) => address)).size !== records.length) {
    fail('case_graph_external_provider_archive_duplicate_address');
  }
  const core = {
    recordType: 'case_graph_external_provider_archive_receipt' as const,
    schemaVersion: CASE_GRAPH_EXTERNAL_PROVIDER_ARCHIVE_VERSION,
    snapshot: normalizedSnapshot,
    recordCount: records.length,
    candidateCount: records.reduce((sum, record) => sum + record.candidates.length, 0),
    recordSetSha256: caseGraphExternalProviderArchiveRecordSetSha256(records),
  };
  return { ...core, receiptDigest: relationshipInputSha256(core) };
};

const count = (value: unknown) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail('case_graph_external_provider_archive_database_invalid');
  return number;
};

export const publishCaseGraphExternalProviderArchive = async (params: {
  snapshot: CaseGraphExternalProviderArchiveSnapshot;
  records: CaseGraphExternalProviderArchiveRecord[];
  transaction: CaseGraphExternalProviderArchiveTransaction;
  verifyArchiveObject: (params: {
    key: string;
    expectedSha256: string;
    expectedBytes: number;
    signal?: AbortSignal;
  }) => Promise<{ sha256: string; bytes: number }>;
  signal?: AbortSignal;
}) => {
  const abort = () => { if (params.signal?.aborted) fail('case_graph_research_aborted'); };
  abort();
  const object = await params.verifyArchiveObject({
    key: params.snapshot.archiveObjectKey,
    expectedSha256: params.snapshot.archiveObjectSha256,
    expectedBytes: params.snapshot.archiveObjectBytes,
    signal: params.signal,
  });
  abort();
  if (object.sha256 !== params.snapshot.archiveObjectSha256 || object.bytes !== params.snapshot.archiveObjectBytes) {
    fail('case_graph_external_provider_archive_object_mismatch');
  }
  const receipt = makeCaseGraphExternalProviderArchiveReceipt(params);
  const records = params.records.map((record) => {
    const { recordDigest: _recordDigest, ...core } = record;
    return makeCaseGraphExternalProviderArchiveRecord(core);
  }).sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
  return params.transaction(async (run) => {
    abort();
    await run('/* external-provider-archive:lock */ SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
      `external-provider-archive:${params.snapshot.snapshotId}`,
    ]);
    const existing = await run(`/* external-provider-archive:existing */
      SELECT status, publication_id::text, category, canonical_source, content_mode, provider_id,
             dataset_version, archive_object_sha256, archive_object_bytes, record_count,
             record_set_sha256, receipt_sha256
      FROM public.case_graph_external_provider_archives WHERE id = $1::uuid`, [params.snapshot.snapshotId]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (existing.rows.length !== 1 || row.status !== 'complete'
        || row.publication_id !== params.snapshot.publication.publicationId
        || row.category !== params.snapshot.category || row.canonical_source !== params.snapshot.canonicalSource
        || row.content_mode !== params.snapshot.contentMode || row.provider_id !== params.snapshot.providerId
        || row.dataset_version !== params.snapshot.datasetVersion
        || row.archive_object_sha256 !== params.snapshot.archiveObjectSha256
        || count(row.archive_object_bytes) !== params.snapshot.archiveObjectBytes
        || count(row.record_count) !== receipt.recordCount
        || row.record_set_sha256 !== receipt.recordSetSha256 || row.receipt_sha256 !== receipt.receiptDigest) {
        fail('case_graph_external_provider_archive_conflict');
      }
      return { status: 'reused' as const, receipt };
    }
    const governance = await run(`/* external-provider-archive:governance */
      SELECT publication.public_manifest_sha256, legal.legal_status, legal.allowed_content_modes
      FROM public.uap_case_graph_publications publication
      LEFT JOIN public.uap_source_legal_registry legal ON legal.canonical_source = $3
      WHERE publication.id = $1::uuid AND publication.corpus_version = $2`, [
      params.snapshot.publication.publicationId,
      params.snapshot.publication.corpusVersion,
      params.snapshot.canonicalSource,
    ]);
    const governed = governance.rows[0];
    const allowedModes = Array.isArray(governed?.allowed_content_modes)
      ? governed.allowed_content_modes.map((mode: unknown) => String(mode).toLowerCase()) : [];
    if (governance.rows.length !== 1 || governed.public_manifest_sha256 !== params.snapshot.publication.manifestSha256
      || String(governed.legal_status).toLowerCase() !== 'approved'
      || !allowedModes.some((mode: string) => mode === 'all' || mode === params.snapshot.contentMode)) {
      fail('case_graph_external_provider_archive_governance_rejected');
    }
    if (records.length) {
      const nodes = await run(`/* external-provider-archive:nodes */
        SELECT address, node_digest FROM public.case_graph_research_search_publication_nodes
        WHERE publication_id = $1::uuid AND address = ANY($2::text[])
        ORDER BY address COLLATE "C"`, [params.snapshot.publication.publicationId, records.map(({ address }) => address)]);
      if (nodes.rows.length !== records.length || nodes.rows.some((row, index) => (
        row.address !== records[index].address || row.node_digest !== records[index].nodeDigest
      ))) fail('case_graph_external_provider_archive_node_mismatch');
    }
    await run(`/* external-provider-archive:create */
      INSERT INTO public.case_graph_external_provider_archives
        (id,publication_id,category,canonical_source,content_mode,provider_id,dataset_version,
         coverage_start,coverage_end,acquired_at,source_url,license,archive_object_key,
         archive_object_sha256,archive_object_bytes)
      VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,
              $11,$12,$13,$14,$15::bigint)`, [
      params.snapshot.snapshotId, params.snapshot.publication.publicationId, params.snapshot.category,
      params.snapshot.canonicalSource, params.snapshot.contentMode, params.snapshot.providerId,
      params.snapshot.datasetVersion, params.snapshot.coverageStart, params.snapshot.coverageEnd,
      params.snapshot.acquiredAt, params.snapshot.sourceUrl, params.snapshot.license,
      params.snapshot.archiveObjectKey, params.snapshot.archiveObjectSha256, params.snapshot.archiveObjectBytes,
    ]);
    for (let offset = 0; offset < records.length; offset += 250) {
      abort();
      await run(`/* external-provider-archive:records */
        INSERT INTO public.case_graph_external_provider_archive_records
          (snapshot_id,publication_id,address,node_digest,availability,reason_codes,explanation,candidates,record_digest)
        SELECT $1::uuid,$2::uuid,input.address,input.node_digest,input.availability,input.reason_codes,
               input.explanation,input.candidates,input.record_digest
        FROM jsonb_to_recordset($3::jsonb) AS input(
          address text,node_digest text,availability text,reason_codes jsonb,
          explanation text,candidates jsonb,record_digest text)`, [
        params.snapshot.snapshotId,
        params.snapshot.publication.publicationId,
        JSON.stringify(records.slice(offset, offset + 250).map((record) => ({
          address: record.address, node_digest: record.nodeDigest, availability: record.availability,
          reason_codes: record.reasonCodes, explanation: record.explanation,
          candidates: record.candidates, record_digest: record.recordDigest,
        }))),
      ]);
    }
    abort();
    await run('/* external-provider-archive:finalize */ SELECT public.case_graph_finalize_external_provider_archive($1::uuid,$2,$3,$4)', [
      params.snapshot.snapshotId, receipt.recordCount, receipt.recordSetSha256, receipt.receiptDigest,
    ]);
    const completed = await run(`/* external-provider-archive:completion-check */
      SELECT status, record_count, record_set_sha256, receipt_sha256
      FROM public.case_graph_external_provider_archives WHERE id = $1::uuid`, [params.snapshot.snapshotId]);
    const row = completed.rows[0];
    if (completed.rows.length !== 1 || row.status !== 'complete' || count(row.record_count) !== receipt.recordCount
      || row.record_set_sha256 !== receipt.recordSetSha256 || row.receipt_sha256 !== receipt.receiptDigest) {
      fail('case_graph_external_provider_archive_completion_failed');
    }
    return { status: 'written' as const, receipt };
  });
};

export const createPostgresExternalProviderArchiveAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  category: CaseGraphExternalCorrelationCategory;
  run: CaseGraphExternalProviderArchiveQuery;
}): CaseGraphExternalCorrelationProviderAdapter => {
  if (!UUID.test(params.snapshotId)) fail('case_graph_external_provider_archive_plan_invalid');
  return {
    category: params.category,
    correlate: async (request) => {
      if (request.signal?.aborted) fail('case_graph_research_aborted');
      if (request.publication.publicationId !== params.publication.publicationId
        || request.publication.manifestSha256 !== params.publication.manifestSha256) {
        fail('case_graph_external_provider_archive_publication_mismatch');
      }
      const result = await params.run(
        `/* external-correlation:provider-archive-record */
         SELECT archive.id::text AS snapshot_id, archive.provider_id, archive.dataset_version,
                archive.coverage_start, archive.coverage_end, archive.acquired_at,
                archive.source_url, archive.license, archive.receipt_sha256,
                record.address AS record_address, record.node_digest, record.availability,
                record.reason_codes, record.explanation, record.candidates, record.record_digest
         FROM public.case_graph_external_provider_archives archive
         LEFT JOIN public.case_graph_external_provider_archive_records record
           ON record.snapshot_id = archive.id AND record.publication_id = archive.publication_id
          AND record.address = $4
         WHERE archive.id = $1::uuid AND archive.publication_id = $2::uuid
           AND archive.category = $3 AND archive.status = 'complete'`,
        [params.snapshotId, params.publication.publicationId, params.category, request.address],
      );
      if (request.signal?.aborted) fail('case_graph_research_aborted');
      if (result.rows.length > 1) fail('case_graph_external_provider_archive_invalid');
      const row = result.rows[0];
      if (!row) return {
        availability: 'unavailable', reasonCodes: ['provider_snapshot_unavailable'],
        explanation: `No completed ${params.category.replace(/_/g, ' ')} provider archive is available; the category was not ruled out.`,
        source: null, candidates: [],
      };
      const source = {
        snapshotId: String(row.snapshot_id), providerId: String(row.provider_id),
        datasetVersion: String(row.dataset_version), coverageStart: optionalIso(row.coverage_start),
        coverageEnd: optionalIso(row.coverage_end), acquiredAt: iso(row.acquired_at),
        sourceUrl: row.source_url == null ? null : String(row.source_url),
        license: row.license == null ? null : String(row.license), receiptSha256: String(row.receipt_sha256),
      };
      if (!UUID.test(source.snapshotId) || !SHA256.test(source.receiptSha256)) {
        fail('case_graph_external_provider_archive_invalid');
      }
      if (row.record_address == null) return {
        availability: 'unavailable', reasonCodes: ['provider_record_not_assessed'],
        explanation: `The completed ${params.category.replace(/_/g, ' ')} provider archive contains no assessment for this record; the category was not ruled out.`,
        source, candidates: [],
      };
      const core: CaseGraphExternalProviderArchiveRecordCore = {
        snapshotId: source.snapshotId,
        publicationId: params.publication.publicationId,
        address: String(row.record_address),
        nodeDigest: String(row.node_digest),
        availability: String(row.availability) as CaseGraphExternalCorrelationAvailability,
        reasonCodes: strings(row.reason_codes),
        explanation: String(row.explanation),
        candidates: Array.isArray(row.candidates)
          ? row.candidates as CaseGraphExternalCorrelationCandidateInput[]
          : fail('case_graph_external_provider_archive_invalid'),
      };
      const rebuilt = makeCaseGraphExternalProviderArchiveRecord(core);
      if (core.address !== request.address || core.nodeDigest !== request.nodeDigest
        || rebuilt.recordDigest !== row.record_digest) {
        fail('case_graph_external_provider_archive_record_mismatch');
      }
      return {
        availability: core.availability,
        reasonCodes: core.reasonCodes,
        explanation: core.explanation,
        source,
        candidates: core.candidates.slice(0, request.limit),
      };
    },
  };
};
