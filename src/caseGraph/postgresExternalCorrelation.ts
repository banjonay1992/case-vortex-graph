import { getClient, query } from '../db';
import type { PoolClient } from 'pg';
import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
  type CaseGraphExternalCorrelationAssessment,
  type CaseGraphExternalCorrelationCandidate,
  type CaseGraphExternalCorrelationCategory,
  type CaseGraphExternalCorrelationProvider,
  type CaseGraphExternalCorrelationSource,
  verifyCaseGraphExternalCorrelationResult,
} from './externalCorrelation';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import type {
  CaseGraphExternalCorrelationPublicationTransaction,
} from './externalCorrelationPublication';
import {
  createGovernedExternalCorrelationProviderAdapter,
  type CaseGraphExternalCorrelationProviderAdapter,
  type CaseGraphExternalCorrelationGovernanceInspector,
} from './externalCorrelationProviderAdapters';

type QueryResult = { rows: any[] };
export type CaseGraphExternalCorrelationQuery = (sql: string, params?: unknown[]) => Promise<QueryResult>;
const defaultQuery: CaseGraphExternalCorrelationQuery = (sql, params = []) => query(sql, params);
const invalid = (): never => { throw new Error('case_graph_external_correlation_integrity_failed'); };
const jsonArray = (value: unknown) => Array.isArray(value) ? value : invalid();
const iso = (value: unknown) => new Date(String(value)).toISOString();
const nullableIso = (value: unknown) => value == null ? null : iso(value);

export const createPostgresCaseGraphExternalCorrelationPublicationTransaction = (
  acquireClient: () => Promise<PoolClient> = getClient,
): CaseGraphExternalCorrelationPublicationTransaction => async (work) => {
  const client = await acquireClient();
  try {
    await client.query('BEGIN');
    const result = await work((sql, params = []) => client.query(sql, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const createPostgresCaseGraphExternalCorrelationGovernanceInspector = (
  run: CaseGraphExternalCorrelationQuery = defaultQuery,
): CaseGraphExternalCorrelationGovernanceInspector => async ({ canonicalSource, signal }) => {
  if (signal?.aborted) throw new Error('case_graph_research_aborted');
  const normalizedSource = canonicalSource.trim().toUpperCase();
  if (!normalizedSource) invalid();
  const result = await run(
    `/* external-correlation:source-governance */
     SELECT canonical_source, legal_status, allowed_content_modes
     FROM public.uap_source_legal_registry
     WHERE UPPER(BTRIM(canonical_source)) = $1`,
    [normalizedSource],
  );
  if (signal?.aborted) throw new Error('case_graph_research_aborted');
  if (result.rows.length > 1) invalid();
  const row = result.rows[0];
  if (!row) return {
    present: false,
    canonicalSource: normalizedSource,
    legalStatus: 'review',
    allowedContentModes: null,
  };
  if (!Array.isArray(row.allowed_content_modes)) invalid();
  return {
    present: true,
    canonicalSource: String(row.canonical_source || '').trim().toUpperCase(),
    legalStatus: String(row.legal_status || '').trim().toLowerCase(),
    allowedContentModes: row.allowed_content_modes.map((mode: unknown) => String(mode).trim().toLowerCase()),
  };
};

export const createPostgresGovernedExternalCorrelationProviderAdapter = (params: {
  category: CaseGraphExternalCorrelationCategory;
  canonicalSource: string;
  providerId: string;
  allowedContentModes: string[];
  correlate: CaseGraphExternalCorrelationProviderAdapter['correlate'];
  run?: CaseGraphExternalCorrelationQuery;
}) => createGovernedExternalCorrelationProviderAdapter({
  category: params.category,
  canonicalSource: params.canonicalSource,
  providerId: params.providerId,
  allowedContentModes: params.allowedContentModes,
  inspectGovernance: createPostgresCaseGraphExternalCorrelationGovernanceInspector(params.run || defaultQuery),
  correlate: params.correlate,
});

const source = (row: any): CaseGraphExternalCorrelationSource | null => row.source_snapshot_id == null ? null : {
  snapshotId: String(row.source_snapshot_id), providerId: String(row.provider_id),
  datasetVersion: String(row.dataset_version), coverageStart: nullableIso(row.coverage_start),
  coverageEnd: nullableIso(row.coverage_end), acquiredAt: iso(row.acquired_at),
  sourceUrl: row.source_url == null ? null : String(row.source_url),
  license: row.license == null ? null : String(row.license), receiptSha256: String(row.receipt_sha256),
};

const candidate = (row: any): CaseGraphExternalCorrelationCandidate => ({
  candidateId: String(row.candidate_id), category: String(row.category) as CaseGraphExternalCorrelationCategory,
  sourceRecordId: String(row.source_record_id), label: String(row.label), observedAt: nullableIso(row.observed_at),
  measurements: row.measurements, reasonCodes: jsonArray(row.reason_codes).map(String),
  explanation: String(row.explanation), uncertainty: jsonArray(row.uncertainty).map(String),
  candidateDigest: String(row.candidate_digest),
});

export const createPostgresCaseGraphExternalCorrelationProvider = (
  run: CaseGraphExternalCorrelationQuery = defaultQuery,
): CaseGraphExternalCorrelationProvider => ({
  correlate: async ({ publication, address, categories, limitPerCategory, signal }) => {
    if (signal?.aborted) throw new Error('case_graph_research_aborted');
    const coverage = await run(
      `SELECT coverage.*,
              source.provider_id, source.dataset_version, source.coverage_start, source.coverage_end,
              source.acquired_at, source.source_url, source.license, source.receipt_sha256
       FROM public.case_graph_external_correlation_coverage coverage
       LEFT JOIN public.case_graph_external_source_snapshots source ON source.id = coverage.source_snapshot_id
       WHERE coverage.publication_id = $1::uuid AND coverage.address = $2
         AND coverage.category = ANY($3::text[])
       ORDER BY array_position($3::text[], coverage.category)`,
      [publication.publicationId, address, categories],
    );
    if (signal?.aborted) throw new Error('case_graph_research_aborted');
    const candidates = await run(
      `SELECT ranked.* FROM (
         SELECT candidate.*, ROW_NUMBER() OVER (
           PARTITION BY candidate.category ORDER BY candidate.observed_at NULLS LAST, candidate.candidate_id
         ) AS category_rank
         FROM public.case_graph_external_correlation_candidates candidate
         WHERE candidate.publication_id = $1::uuid AND candidate.address = $2
           AND candidate.category = ANY($3::text[])
       ) ranked
       WHERE ranked.category_rank <= $4
       ORDER BY array_position($3::text[], ranked.category), ranked.category_rank`,
      [publication.publicationId, address, categories, limitPerCategory],
    );
    if (coverage.rows.length !== categories.length) invalid();
    const candidatesByCategory = new Map<CaseGraphExternalCorrelationCategory, Array<{
      candidate: CaseGraphExternalCorrelationCandidate;
      sourceSnapshotId: string;
    }>>();
    for (const row of candidates.rows) {
      const item = candidate(row);
      const current = candidatesByCategory.get(item.category) || [];
      current.push({ candidate: item, sourceSnapshotId: String(row.source_snapshot_id) });
      candidatesByCategory.set(item.category, current);
    }
    const assessments: CaseGraphExternalCorrelationAssessment[] = coverage.rows.map((row, index) => {
      if (String(row.category) !== categories[index]) invalid();
      const categoryCandidates = candidatesByCategory.get(categories[index]) || [];
      if ((row.availability !== 'available' && categoryCandidates.length > 0)
        || categoryCandidates.some((item) => item.sourceSnapshotId !== String(row.source_snapshot_id))) invalid();
      return {
        category: categories[index], availability: row.availability,
        reasonCodes: jsonArray(row.reason_codes).map(String), explanation: String(row.explanation),
        source: source(row), candidates: categoryCandidates.map((item) => item.candidate),
        checkedAt: iso(row.checked_at), assessmentDigest: String(row.assessment_digest),
      };
    });
    const withoutDigest = {
      recordType: 'case_graph_external_correlation_result' as const,
      schemaVersion: CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
      publication, address, assessments,
      limitations: ['External correlations are candidate comparisons, not identifications, causal explanations, debunking conclusions, or origin assessments.'],
    };
    return verifyCaseGraphExternalCorrelationResult({
      value: { ...withoutDigest, resultDigest: relationshipInputSha256(withoutDigest) },
      publication, address, categories, limitPerCategory,
    });
  },
});

export const inspectCaseGraphExternalCorrelationServing = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  run?: CaseGraphExternalCorrelationQuery;
}) => {
  const run = params.run || defaultQuery;
  const result = await run(
    `SELECT manifest_sha256, category_set, completion_sha256, completed_at
     FROM public.case_graph_external_correlation_completions
     WHERE publication_id = $1::uuid`,
    [params.publication.publicationId],
  );
  const row = result.rows[0];
  if (!row || String(row.manifest_sha256) !== params.publication.manifestSha256
    || JSON.stringify(row.category_set) !== JSON.stringify(CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES)
    || !/^[a-f0-9]{64}$/.test(String(row.completion_sha256))) {
    throw new Error('case_graph_external_correlation_unavailable');
  }
  return {
    verified: true as const,
    completionSha256: String(row.completion_sha256),
    completedAt: iso(row.completed_at),
    provider: createPostgresCaseGraphExternalCorrelationProvider(run),
  };
};
