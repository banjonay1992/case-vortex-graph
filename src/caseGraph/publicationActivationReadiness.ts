import type {
  CaseGraphV2PublicationCandidate,
  PostgresCaseGraphV2TransactionClient,
} from './postgresCaseGraphControlPlaneV2Types';

type QueryResult = { rows: Array<Record<string, unknown>> };

export type CaseVortexPublicationReadinessQuery = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
};

const truth = (value: unknown) => value === true || value === 't';
const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * Candidate-scoped serving checks.  These deliberately bind each projection
 * to the inactive candidate rather than to whichever publication is active
 * before the switch.
 */
const candidatePublicationState = `
  publication.id = $1::uuid AND publication.active = false
  AND publication.activated_at IS NULL AND publication.deactivated_at IS NULL
`;

const activePublicationState = `
  publication.id = $1::uuid AND publication.active = true
  AND publication.activated_at IS NOT NULL AND publication.deactivated_at IS NULL
`;

const servingProjectionsSql = (publicationState: string, marker: string) => `
  /* ${marker} */
  SELECT
    EXISTS (
      SELECT 1 FROM public.case_graph_research_search_builds AS build
      JOIN public.uap_case_graph_publications AS publication ON publication.id = build.publication_id
      WHERE ${publicationState}
        AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_record_count = build.expected_record_count
    ) AS research_search_verified,
    EXISTS (
      SELECT 1
      FROM public.case_vortex_retained_influence_builds AS build
      JOIN public.uap_case_graph_publications AS publication
        ON publication.id = build.publication_id
      WHERE ${publicationState}
        AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_discovery_signal_count = (
          SELECT COALESCE(sum((entry ->> 'rowCount')::bigint), 0)
          FROM jsonb_array_elements(build.source_manifest) AS entry
          WHERE entry ->> 'lane' = 'discovery_signal'
        )
        AND build.indexed_metadata_lead_count = (
          SELECT COALESCE(sum((entry ->> 'rowCount')::bigint), 0)
          FROM jsonb_array_elements(build.source_manifest) AS entry
          WHERE entry ->> 'lane' = 'metadata_lead'
        )
    ) AS retained_influence_verified,
    EXISTS (
      SELECT 1 FROM public.case_graph_content_search_builds AS build
      JOIN public.uap_case_graph_publications AS publication ON publication.id = build.publication_id
      WHERE ${publicationState}
        AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_entry_count = build.expected_entry_count
        AND build.indexed_shard_count = build.expected_shard_count
    ) AS content_search_verified,
    EXISTS (
      SELECT 1 FROM public.case_graph_claim_evidence_builds AS build
      JOIN public.uap_case_graph_publications AS publication ON publication.id = build.publication_id
      WHERE ${publicationState}
        AND build.status = 'verified'
        AND build.public_manifest_sha256 = publication.public_manifest_sha256
        AND build.indexed_claim_count = build.expected_claim_count
        AND build.indexed_link_count = build.expected_link_count
        AND build.indexed_assessment_count = build.expected_assessment_count
    ) AS claim_evidence_verified,
    EXISTS (
      SELECT 1 FROM public.case_graph_external_correlation_completions AS completion
      JOIN public.uap_case_graph_publications AS publication ON publication.id = completion.publication_id
      WHERE ${publicationState}
        AND completion.manifest_sha256 = publication.public_manifest_sha256
        AND jsonb_array_length(completion.category_set) = 9
        AND completion.category_set ?& ARRAY[
          'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
          'military_exercise', 'launch', 'maritime', 'weather'
        ]::text[]
    ) AS external_correlations_complete
`;

/** Candidate-scoped checks performed immediately before a first activation. */
export const CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL = servingProjectionsSql(
  candidatePublicationState,
  'case_vortex_candidate_serving_projections:pre_activation',
);

/** Reconciliation checks for an already-active candidate after a receipt write failure. */
export const CASE_VORTEX_ACTIVE_SERVING_PROJECTIONS_SQL = servingProjectionsSql(
  activePublicationState,
  'case_vortex_candidate_serving_projections:active_reconciliation',
);

/**
 * The activation operator must prove both the 0235 function and the trigger
 * that makes all direct candidate INSERT paths share its advisory lock.
 */
export const CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL = `
  /* case_vortex_first_publication_recovery:signature */
  WITH signature AS (
  SELECT
    COALESCE((
    SELECT
      procedure.prosecdef
      AND COALESCE(pg_catalog.array_to_string(procedure.proconfig, ','), '')
        LIKE '%search_path=pg_catalog, public%'
      AND pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'pg_advisory_xact_lock'
      ) > 0
      AND pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'v_total_count <> 1'
      ) > 0
      AND pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'v_active_count <> 1'
      ) > 0
      AND pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'v_total_count <> 1 OR v_active_count <> 0'
      ) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(COALESCE(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )) AS privilege
        WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS role
        WHERE role.rolname IN ('anon', 'authenticated')
          AND pg_catalog.has_function_privilege(role.oid, procedure.oid, 'EXECUTE')
      )
      AND (
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = 'service_role'
            AND pg_catalog.has_function_privilege(role.oid, procedure.oid, 'EXECUTE')
        )
      )
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'public.deactivate_first_uap_case_graph_publication_v1(uuid,text,text)'
    )
  ), false) AS recovery_function_present,
    COALESCE((
    SELECT
      COUNT(*) = 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = pg_catalog.to_regclass(
        'public.uap_case_graph_publications'
      )
      AND NOT trigger.tgisinternal
    ), false) AS publication_trigger_singleton,
    COALESCE((
    SELECT
      COUNT(*) = 1
      AND bool_and(trigger.tgenabled = 'O')
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = pg_catalog.to_regclass(
        'public.uap_case_graph_publications'
      )
      AND NOT trigger.tgisinternal
    ), false) AS publication_trigger_enabled,
    COALESCE((
    SELECT
      COUNT(*) = 1
      -- ROW | BEFORE | INSERT | UPDATE. This excludes an AFTER, DELETE,
      -- statement-level, disabled, or wrong-table/function substitute.
      AND bool_and(trigger.tgtype = 23)
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = pg_catalog.to_regclass(
        'public.uap_case_graph_publications'
      )
      AND NOT trigger.tgisinternal
    ), false) AS publication_trigger_before_insert_update_row,
    COALESCE((
    SELECT
      COUNT(*) = 1
      AND bool_and(trigger.tgfoid = pg_catalog.to_regprocedure(
        'public.uap_case_graph_publication_activation_guard()'
      ))
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = pg_catalog.to_regclass(
        'public.uap_case_graph_publications'
      )
      AND NOT trigger.tgisinternal
    ), false) AS publication_trigger_function
  )
  SELECT
    signature.*,
    recovery_function_present
      AND publication_trigger_singleton
      AND publication_trigger_enabled
      AND publication_trigger_before_insert_update_row
      AND publication_trigger_function AS present
  FROM signature
`;

/** Both migration ledgers must attest to the exact governed 0235 artifact. */
export const CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_MIGRATION_SQL = `
  /* case_vortex_first_publication_recovery:migration_0235 */
  SELECT
    EXISTS (
      SELECT 1
      FROM public.schema_migrations
      WHERE id = '0235_case_vortex_first_publication_deactivation_2026_08_10.sql'
    )
    AND EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations
      WHERE version = '0235_case_vortex_first_publication_deactivation_2026_08_10'
    ) AS present
`;

/**
 * A non-mutating rehearsal for the state the candidate will have immediately
 * before first activation.  The caller may require `transaction_read_only`
 * when it is run from the bounded read-only operator connection.
 */
export const CASE_VORTEX_PROSPECTIVE_FIRST_PUBLICATION_RECOVERY_SQL = `
  /* case_vortex_first_publication_recovery:prospective_activation_rehearsal */
  WITH inventory AS (
    SELECT
      COUNT(*)::integer AS total_publication_count,
      COUNT(*) FILTER (WHERE active = true)::integer AS active_publication_count
    FROM public.uap_case_graph_publications
  )
  SELECT
    current_setting('transaction_read_only') = 'on' AS transaction_read_only,
    inventory.total_publication_count,
    inventory.active_publication_count,
    publication.id::text AS publication_id,
    publication.corpus_version,
    publication.public_manifest_sha256,
    publication.active,
    publication.activated_at,
    publication.deactivated_at,
    (
      run.lineage_version = 'case-vortex-lineage-v2'
      AND run.status = 'completed'
      AND run.snapshot_id IS NOT NULL
      AND receipt.receipt_version = 'case-vortex-publication-receipt-v2'
      AND receipt.snapshot_id = run.snapshot_id
      AND receipt.public_manifest_sha256 = publication.public_manifest_sha256
      AND receipt.completion_manifest_sha256 = run.completion_manifest_sha256
      AND receipt.corpus_accounting_digest = run.corpus_accounting_digest
      AND receipt.graph_artifact_set_sha256 = run.graph_artifact_set_sha256
    ) AS verified_v2
  FROM inventory
  LEFT JOIN public.uap_case_graph_publications AS publication ON publication.id = $1::uuid
  LEFT JOIN public.uap_case_graph_runs AS run ON run.id = publication.run_id
  LEFT JOIN public.uap_case_graph_publication_receipts AS receipt ON receipt.publication_id = publication.id
`;

export const assertCaseVortexFirstPublicationRecoverySignature = async (
  query: CaseVortexPublicationReadinessQuery,
) => {
  const result = await query.query(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL);
  const row = result.rows[0];
  if (result.rows.length !== 1
    || !truth(row?.present)
    || !truth(row?.recovery_function_present)
    || !truth(row?.publication_trigger_singleton)
    || !truth(row?.publication_trigger_enabled)
    || !truth(row?.publication_trigger_before_insert_update_row)
    || !truth(row?.publication_trigger_function)) {
    throw new Error('case_vortex_first_publication_recovery_schema_unavailable');
  }
};

export const assertCaseVortexFirstPublicationRecoveryMigration = async (
  query: CaseVortexPublicationReadinessQuery,
) => {
  const result = await query.query(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_MIGRATION_SQL);
  if (result.rows.length !== 1 || !truth(result.rows[0].present)) {
    throw new Error('case_vortex_first_publication_recovery_migration_unavailable');
  }
};

export const assertCaseVortexProspectiveFirstPublicationRecovery = async (
  query: CaseVortexPublicationReadinessQuery,
  candidate: CaseGraphV2PublicationCandidate,
  requireReadOnly: boolean,
) => {
  const result = await query.query(CASE_VORTEX_PROSPECTIVE_FIRST_PUBLICATION_RECOVERY_SQL, [
    candidate.publicationId,
  ]);
  const row = result.rows[0];
  if (result.rows.length !== 1
    || (requireReadOnly && !truth(row?.transaction_read_only))
    || count(row?.total_publication_count) !== 1
    || count(row?.active_publication_count) !== 0
    || row?.publication_id !== candidate.publicationId
    || row?.corpus_version !== candidate.corpusVersion
    || row?.public_manifest_sha256 !== candidate.publicManifestSha256
    || row?.active !== false
    || row?.activated_at !== null
    || row?.deactivated_at !== null
    || !truth(row?.verified_v2)) {
    throw new Error('case_vortex_first_publication_recovery_rehearsal_unready');
  }
};

const assertCaseVortexServingProjections = async (
  query: CaseVortexPublicationReadinessQuery,
  candidate: CaseGraphV2PublicationCandidate,
  sql: string,
) => {
  const result = await query.query(sql, [
    candidate.publicationId,
  ]);
  const row = result.rows[0];
  if (result.rows.length !== 1
    || !truth(row?.research_search_verified)
    || !truth(row?.retained_influence_verified)
    || !truth(row?.content_search_verified)
    || !truth(row?.claim_evidence_verified)
    || !truth(row?.external_correlations_complete)) {
    throw new Error('case_vortex_candidate_serving_projections_unready');
  }
};

export const assertCaseVortexCandidateServingProjections = async (
  query: CaseVortexPublicationReadinessQuery,
  candidate: CaseGraphV2PublicationCandidate,
) => assertCaseVortexServingProjections(query, candidate, CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL);

export const assertCaseVortexActiveServingProjections = async (
  query: CaseVortexPublicationReadinessQuery,
  candidate: CaseGraphV2PublicationCandidate,
) => assertCaseVortexServingProjections(query, candidate, CASE_VORTEX_ACTIVE_SERVING_PROJECTIONS_SQL);

/** Must run in the activation transaction after acquiring the shared lock. */
export const assertCaseVortexCandidateActivationReadiness = async (
  query: PostgresCaseGraphV2TransactionClient,
  candidate: CaseGraphV2PublicationCandidate,
) => {
  await assertCaseVortexFirstPublicationRecoveryMigration(query);
  await assertCaseVortexFirstPublicationRecoverySignature(query);
  await assertCaseVortexProspectiveFirstPublicationRecovery(query, candidate, false);
  await assertCaseVortexCandidateServingProjections(query, candidate);
};

/**
 * Reconciliation intentionally omits the prospective first-activation check:
 * the exact candidate is already active after a committed switch whose local
 * receipt write failed. It still proves migration, trigger/function, and live
 * serving gates before the idempotent result is acknowledged.
 */
export const assertCaseVortexActivePublicationReconciliationReadiness = async (
  query: PostgresCaseGraphV2TransactionClient,
  candidate: CaseGraphV2PublicationCandidate,
) => {
  await assertCaseVortexFirstPublicationRecoveryMigration(query);
  await assertCaseVortexFirstPublicationRecoverySignature(query);
  await assertCaseVortexActiveServingProjections(query, candidate);
};
