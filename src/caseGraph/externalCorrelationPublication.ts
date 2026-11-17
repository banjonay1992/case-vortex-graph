import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  verifyCaseGraphExternalCorrelationResult,
  type CaseGraphExternalCorrelationAvailability,
  type CaseGraphExternalCorrelationResult,
} from './externalCorrelation';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_EXTERNAL_CORRELATION_PUBLICATION_VERSION =
  'case-graph-external-correlation-publication-v1' as const;

export type CaseGraphExternalCorrelationPublicationRecord = {
  nodeDigest: string;
  result: CaseGraphExternalCorrelationResult;
};

export type CaseGraphExternalCorrelationPublicationReceipt = {
  recordType: 'case_graph_external_correlation_publication_receipt';
  schemaVersion: typeof CASE_GRAPH_EXTERNAL_CORRELATION_PUBLICATION_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  categorySet: typeof CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES;
  addressCount: number;
  coverageCount: number;
  candidateCount: number;
  sourceSnapshotCount: number;
  availabilityCounts: Record<CaseGraphExternalCorrelationAvailability, number>;
  addressSetSha256: string;
  sourceSnapshotSetSha256: string;
  coverageSetSha256: string;
  candidateSetSha256: string;
  receiptDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export const makeCaseGraphExternalCorrelationPublicationReceipt = (params: {
  publication: CaseGraphResearchPublicationBinding;
  records: CaseGraphExternalCorrelationPublicationRecord[];
  limitPerCategory: number;
}) => {
  if (!Number.isSafeInteger(params.limitPerCategory) || params.limitPerCategory < 1 || params.limitPerCategory > 100
    || !params.records.length || params.records.length > 1_000_000) {
    fail('case_graph_external_correlation_publication_invalid');
  }
  const records = params.records.map(({ nodeDigest, result }) => {
    if (!SHA256.test(nodeDigest)) fail('case_graph_external_correlation_publication_invalid');
    return {
      nodeDigest,
      result: verifyCaseGraphExternalCorrelationResult({
        value: result,
        publication: params.publication,
        address: result.address,
        categories: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES],
        limitPerCategory: params.limitPerCategory,
      }),
    };
  }).sort((left, right) => compare(left.result.address, right.result.address));
  if (new Set(records.map(({ result }) => result.address)).size !== records.length) {
    fail('case_graph_external_correlation_publication_duplicate_address');
  }
  const sourceSnapshots = records.flatMap(({ result }) => result.assessments.flatMap((assessment) => (
    assessment.source ? [{ category: assessment.category, source: assessment.source }] : []
  ))).sort((left, right) => compare(
    `${left.category}:${left.source.snapshotId}`,
    `${right.category}:${right.source.snapshotId}`,
  ));
  const sourceIdentity = new Map<string, string>();
  for (const item of sourceSnapshots) {
    if (!UUID.test(item.source.snapshotId)) fail('case_graph_external_correlation_publication_source_invalid');
    const value = canonicalizeRelationshipInput(item);
    const existing = sourceIdentity.get(item.source.snapshotId);
    if (existing && existing !== value) fail('case_graph_external_correlation_publication_source_invalid');
    sourceIdentity.set(item.source.snapshotId, value);
  }
  const uniqueSources = [...sourceIdentity.values()].map((value) => JSON.parse(value) as {
    category: string;
    source: { snapshotId: string; receiptSha256: string };
  }).sort((left, right) => compare(`${left.category}:${left.source.snapshotId}`, `${right.category}:${right.source.snapshotId}`));
  const coverage = records.flatMap(({ nodeDigest, result }) => result.assessments.map((assessment) => ({
    address: result.address,
    nodeDigest,
    category: assessment.category,
    availability: assessment.availability,
    sourceSnapshotId: assessment.source?.snapshotId || null,
    assessmentDigest: assessment.assessmentDigest,
  })));
  if (coverage.length !== records.length * CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.length) {
    fail('case_graph_external_correlation_publication_coverage_incomplete');
  }
  const candidates = records.flatMap(({ result }) => result.assessments.flatMap((assessment) => (
    assessment.candidates.map((candidate) => ({
      address: result.address,
      category: assessment.category,
      sourceSnapshotId: assessment.source?.snapshotId || null,
      candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest,
    }))
  ))).sort((left, right) => compare(`${left.address}:${left.category}:${left.candidateId}`, `${right.address}:${right.category}:${right.candidateId}`));
  if (candidates.some(({ sourceSnapshotId }) => sourceSnapshotId === null)) {
    fail('case_graph_external_correlation_publication_candidate_source_invalid');
  }
  const availabilityCounts = Object.fromEntries(
    (['available', 'insufficient_evidence', 'unavailable', 'stale'] as const).map((availability) => [
      availability, coverage.filter((item) => item.availability === availability).length,
    ]),
  ) as Record<CaseGraphExternalCorrelationAvailability, number>;
  const core = {
    recordType: 'case_graph_external_correlation_publication_receipt' as const,
    schemaVersion: CASE_GRAPH_EXTERNAL_CORRELATION_PUBLICATION_VERSION,
    publication: params.publication,
    categorySet: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
    addressCount: records.length,
    coverageCount: coverage.length,
    candidateCount: candidates.length,
    sourceSnapshotCount: uniqueSources.length,
    availabilityCounts,
    addressSetSha256: relationshipInputSha256(records.map(({ nodeDigest, result }) => ({
      address: result.address, nodeDigest,
    }))),
    sourceSnapshotSetSha256: relationshipInputSha256(uniqueSources),
    coverageSetSha256: relationshipInputSha256(coverage),
    candidateSetSha256: relationshipInputSha256(candidates),
  };
  return { ...core, receiptDigest: relationshipInputSha256(core) } satisfies CaseGraphExternalCorrelationPublicationReceipt;
};

type QueryResult = { rows: Array<Record<string, unknown>> };
export type CaseGraphExternalCorrelationPublicationQuery = (
  sql: string,
  params?: unknown[],
) => Promise<QueryResult>;
export type CaseGraphExternalCorrelationPublicationTransaction = <T>(
  work: (run: CaseGraphExternalCorrelationPublicationQuery) => Promise<T>,
) => Promise<T>;

const count = (value: unknown) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail('case_graph_external_correlation_publication_database_invalid');
  return number;
};
const BATCH_SIZE = 250;

export const publishCaseGraphExternalCorrelationPublication = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  records: CaseGraphExternalCorrelationPublicationRecord[];
  limitPerCategory: number;
  transaction: CaseGraphExternalCorrelationPublicationTransaction;
  signal?: AbortSignal;
}) => {
  const receipt = makeCaseGraphExternalCorrelationPublicationReceipt(params);
  const records = params.records.map((record) => ({
    nodeDigest: record.nodeDigest,
    result: verifyCaseGraphExternalCorrelationResult({
      value: record.result,
      publication: params.publication,
      address: record.result.address,
      categories: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES],
      limitPerCategory: params.limitPerCategory,
    }),
  })).sort((left, right) => compare(left.result.address, right.result.address));
  const abort = () => { if (params.signal?.aborted) fail('case_graph_external_correlation_publication_aborted'); };
  abort();
  return params.transaction(async (run) => {
    abort();
    await run('/* external-correlation:lock */ SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
      params.publication.publicationId,
    ]);
    const existing = await run(`/* external-correlation:existing-completion */
      SELECT completion_sha256, source_snapshot_set_sha256, coverage_set_sha256,
             candidate_set_sha256, accounting
      FROM public.case_graph_external_correlation_completions
      WHERE publication_id = $1::uuid`, [params.publication.publicationId]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (existing.rows.length !== 1 || row.completion_sha256 !== receipt.receiptDigest
        || row.source_snapshot_set_sha256 !== receipt.sourceSnapshotSetSha256
        || row.coverage_set_sha256 !== receipt.coverageSetSha256
        || row.candidate_set_sha256 !== receipt.candidateSetSha256
        || canonicalizeRelationshipInput(row.accounting) !== canonicalizeRelationshipInput(receipt)) {
        fail('case_graph_external_correlation_publication_conflict');
      }
      return { status: 'reused' as const, receipt };
    }
    const nodeRows = await run(`/* external-correlation:publication-nodes */
      SELECT node.address, node.node_digest, totals.total_publication_count
      FROM public.case_graph_research_search_publication_nodes AS node
      CROSS JOIN (
        SELECT COUNT(*)::bigint AS total_publication_count
        FROM public.case_graph_research_search_publication_nodes WHERE publication_id = $1::uuid
      ) AS totals
      WHERE node.publication_id = $1::uuid AND node.address = ANY($2::text[])
      ORDER BY node.address COLLATE "C"`, [
      params.publication.publicationId, records.map(({ result }) => result.address),
    ]);
    if (nodeRows.rows.length !== records.length || nodeRows.rows.some((row, index) => (
      row.address !== records[index].result.address || row.node_digest !== records[index].nodeDigest
      || count(row.total_publication_count) !== records.length
    ))) fail('case_graph_external_correlation_publication_node_mismatch');
    const partial = await run(`/* external-correlation:partial-check */
      SELECT COUNT(*)::bigint AS coverage_count
      FROM public.case_graph_external_correlation_coverage WHERE publication_id = $1::uuid`, [
      params.publication.publicationId,
    ]);
    if (partial.rows.length !== 1 || count(partial.rows[0].coverage_count) !== 0) {
      fail('case_graph_external_correlation_publication_partial_state');
    }
    const sources = new Map<string, Record<string, unknown>>();
    for (const { result } of records) for (const assessment of result.assessments) if (assessment.source) {
      sources.set(assessment.source.snapshotId, { category: assessment.category, ...assessment.source });
    }
    if (sources.size) {
      await run(`/* external-correlation:source-snapshots */
        INSERT INTO public.case_graph_external_source_snapshots
          (id, category, provider_id, dataset_version, coverage_start, coverage_end,
           acquired_at, source_url, license, receipt_sha256)
        SELECT input.snapshot_id::uuid, input.category, input.provider_id, input.dataset_version,
               input.coverage_start::timestamptz, input.coverage_end::timestamptz,
               input.acquired_at::timestamptz, input.source_url, input.license, input.receipt_sha256
        FROM jsonb_to_recordset($1::jsonb) AS input(
          snapshot_id text, category text, provider_id text, dataset_version text,
          coverage_start text, coverage_end text, acquired_at text, source_url text,
          license text, receipt_sha256 text)
        ON CONFLICT (id) DO NOTHING`, [JSON.stringify([...sources.values()].map((source) => ({
        snapshot_id: source.snapshotId, category: source.category, provider_id: source.providerId,
        dataset_version: source.datasetVersion, coverage_start: source.coverageStart,
        coverage_end: source.coverageEnd, acquired_at: source.acquiredAt, source_url: source.sourceUrl,
        license: source.license, receipt_sha256: source.receiptSha256,
      })))]);
      const observed = await run(`/* external-correlation:source-snapshot-check */
        SELECT id::text, category, provider_id, dataset_version, coverage_start, coverage_end,
               acquired_at, source_url, license, receipt_sha256
        FROM public.case_graph_external_source_snapshots WHERE id = ANY($1::uuid[])`, [[...sources.keys()]]);
      if (observed.rows.length !== sources.size) fail('case_graph_external_correlation_publication_source_mismatch');
      for (const row of observed.rows) {
        const expected = sources.get(String(row.id));
        const iso = (value: unknown) => {
          if (value == null) return null;
          try { return new Date(String(value)).toISOString(); } catch {
            return fail('case_graph_external_correlation_publication_source_mismatch');
          }
        };
        if (!expected || row.category !== expected.category || row.provider_id !== expected.providerId
          || row.dataset_version !== expected.datasetVersion
          || iso(row.coverage_start) !== expected.coverageStart || iso(row.coverage_end) !== expected.coverageEnd
          || iso(row.acquired_at) !== expected.acquiredAt || (row.source_url ?? null) !== expected.sourceUrl
          || (row.license ?? null) !== expected.license || row.receipt_sha256 !== expected.receiptSha256) {
          fail('case_graph_external_correlation_publication_source_mismatch');
        }
      }
    }
    const coverage = records.flatMap(({ nodeDigest, result }) => result.assessments.map((assessment) => ({
      address: result.address, node_digest: nodeDigest, category: assessment.category,
      availability: assessment.availability, source_snapshot_id: assessment.source?.snapshotId || null,
      reason_codes: assessment.reasonCodes, explanation: assessment.explanation,
      checked_at: assessment.checkedAt, assessment_digest: assessment.assessmentDigest,
    })));
    for (let offset = 0; offset < coverage.length; offset += BATCH_SIZE * CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.length) {
      abort();
      await run(`/* external-correlation:coverage */
        INSERT INTO public.case_graph_external_correlation_coverage
          (publication_id, address, node_digest, category, availability, source_snapshot_id,
           reason_codes, explanation, checked_at, assessment_digest)
        SELECT $1::uuid, input.address, input.node_digest, input.category, input.availability,
               input.source_snapshot_id::uuid, input.reason_codes, input.explanation,
               input.checked_at::timestamptz, input.assessment_digest
        FROM jsonb_to_recordset($2::jsonb) AS input(
          address text, node_digest text, category text, availability text,
          source_snapshot_id text, reason_codes jsonb, explanation text,
          checked_at text, assessment_digest text)`, [
        params.publication.publicationId, JSON.stringify(coverage.slice(offset, offset + BATCH_SIZE * 9)),
      ]);
    }
    const candidates = records.flatMap(({ result }) => result.assessments.flatMap((assessment) => (
      assessment.candidates.map((candidate) => ({
        address: result.address, category: assessment.category, candidate_id: candidate.candidateId,
        source_snapshot_id: assessment.source!.snapshotId, source_record_id: candidate.sourceRecordId,
        label: candidate.label, observed_at: candidate.observedAt, measurements: candidate.measurements,
        reason_codes: candidate.reasonCodes, explanation: candidate.explanation,
        uncertainty: candidate.uncertainty, candidate_digest: candidate.candidateDigest,
      }))
    )));
    for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
      abort();
      await run(`/* external-correlation:candidates */
        INSERT INTO public.case_graph_external_correlation_candidates
          (publication_id, address, category, candidate_id, source_snapshot_id, source_record_id,
           label, observed_at, measurements, reason_codes, explanation, uncertainty, candidate_digest)
        SELECT $1::uuid, input.address, input.category, input.candidate_id,
               input.source_snapshot_id::uuid, input.source_record_id, input.label,
               input.observed_at::timestamptz, input.measurements, input.reason_codes,
               input.explanation, input.uncertainty, input.candidate_digest
        FROM jsonb_to_recordset($2::jsonb) AS input(
          address text, category text, candidate_id text, source_snapshot_id text,
          source_record_id text, label text, observed_at text, measurements jsonb,
          reason_codes jsonb, explanation text, uncertainty jsonb, candidate_digest text)`, [
        params.publication.publicationId, JSON.stringify(candidates.slice(offset, offset + BATCH_SIZE)),
      ]);
    }
    const accounting = await run(`/* external-correlation:accounting */
      SELECT
        (SELECT COUNT(*) FROM public.case_graph_external_correlation_coverage WHERE publication_id = $1::uuid)::bigint AS coverage_count,
        (SELECT COUNT(*) FROM public.case_graph_external_correlation_candidates WHERE publication_id = $1::uuid)::bigint AS candidate_count,
        (SELECT COUNT(DISTINCT source_snapshot_id) FROM public.case_graph_external_correlation_coverage
          WHERE publication_id = $1::uuid AND source_snapshot_id IS NOT NULL)::bigint AS source_count`, [
      params.publication.publicationId,
    ]);
    const observed = accounting.rows[0];
    if (accounting.rows.length !== 1 || count(observed.coverage_count) !== receipt.coverageCount
      || count(observed.candidate_count) !== receipt.candidateCount
      || count(observed.source_count) !== receipt.sourceSnapshotCount) {
      fail('case_graph_external_correlation_publication_accounting_mismatch');
    }
    abort();
    const completed = await run(`/* external-correlation:completion */
      INSERT INTO public.case_graph_external_correlation_completions
        (publication_id, manifest_sha256, category_set, source_snapshot_set_sha256,
         coverage_set_sha256, candidate_set_sha256, completion_sha256, completed_at, accounting)
      VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7, pg_catalog.clock_timestamp(), $8::jsonb)
      RETURNING completion_sha256`, [
      params.publication.publicationId, params.publication.manifestSha256,
      JSON.stringify(CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES), receipt.sourceSnapshotSetSha256,
      receipt.coverageSetSha256, receipt.candidateSetSha256, receipt.receiptDigest, JSON.stringify(receipt),
    ]);
    if (completed.rows.length !== 1 || completed.rows[0].completion_sha256 !== receipt.receiptDigest) {
      fail('case_graph_external_correlation_publication_completion_failed');
    }
    return { status: 'written' as const, receipt };
  });
};
