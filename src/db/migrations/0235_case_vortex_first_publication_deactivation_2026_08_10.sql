-- First-authoritative-publication emergency recovery.
--
-- The normal rollback function requires a prior verified V2 generation.  A
-- first production generation has no such target, so this intentionally
-- narrow function can only fail closed: it deactivates exactly the sole,
-- still-first verified publication and never selects or activates a
-- replacement.

-- Every insertion participates in the same lock as activation, rollback, and
-- the recovery function below.  Without this, a candidate INSERT can race the
-- first-publication inventory count after recovery has locked existing rows.
CREATE OR REPLACE FUNCTION public.uap_case_graph_publication_activation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_table_owner NAME;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('uap-case-graph-publication-v2', 0)
    );
  END IF;

  IF NOT (
    (TG_OP = 'INSERT' AND NEW.active = true)
    OR (
      TG_OP = 'UPDATE'
      AND (
        NEW.active IS DISTINCT FROM OLD.active
        OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
        OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
        OR NEW.rollback_of_publication_id IS DISTINCT FROM OLD.rollback_of_publication_id
      )
    )
  ) THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(relation.relowner)
  INTO v_table_owner
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS relation_namespace
    ON relation_namespace.oid = relation.relnamespace
  WHERE relation_namespace.nspname = 'public'
    AND relation.relname = 'uap_case_graph_publications';

  IF v_table_owner IS NULL OR current_user <> v_table_owner THEN
    RAISE EXCEPTION 'case-graph publications may only be switched by a guarded function';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_first_uap_case_graph_publication_v1(
  p_expected_active_publication_id UUID,
  p_expected_active_manifest_sha256 TEXT,
  p_reason_sha256 TEXT
)
RETURNS TABLE (
  publication_id UUID,
  corpus_version TEXT,
  public_manifest_sha256 TEXT,
  deactivated_at TIMESTAMPTZ,
  reason_sha256 TEXT,
  active_publication_count BIGINT,
  total_publication_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current RECORD;
  v_deactivated_at TIMESTAMPTZ;
  v_active_count BIGINT;
  v_total_count BIGINT;
BEGIN
  IF NOT (
    p_expected_active_publication_id IS NOT NULL
    AND p_expected_active_manifest_sha256 ~ '^[a-f0-9]{64}$'
    AND p_reason_sha256 ~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'case-graph first-publication deactivation input is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('uap-case-graph-publication-v2', 0)
  );

  -- Lock the complete set first: a concurrent candidate insertion or any
  -- historic generation makes the first-generation-only kill switch invalid.
  PERFORM publication.id
  FROM public.uap_case_graph_publications AS publication
  FOR UPDATE;

  SELECT COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE active = true)::bigint
  INTO v_total_count, v_active_count
  FROM public.uap_case_graph_publications;

  SELECT
    publication.id,
    publication.corpus_version,
    publication.public_manifest_sha256,
    publication.active,
    publication.activated_at,
    publication.deactivated_at,
    run.lineage_version,
    run.status AS run_status,
    receipt.receipt_version,
    receipt.public_manifest_sha256 AS receipt_public_manifest_sha256,
    receipt.completion_manifest_sha256,
    run.completion_manifest_sha256 AS run_completion_manifest_sha256,
    receipt.corpus_accounting_digest,
    run.corpus_accounting_digest,
    receipt.graph_artifact_set_sha256,
    run.graph_artifact_set_sha256
  INTO v_current
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_runs AS run ON run.id = publication.run_id
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.id = p_expected_active_publication_id
  FOR UPDATE OF publication, run, receipt;

  IF v_total_count <> 1
    OR v_active_count <> 1
    OR NOT FOUND
    OR v_current.public_manifest_sha256 <> p_expected_active_manifest_sha256
    OR v_current.receipt_public_manifest_sha256 <> p_expected_active_manifest_sha256
    OR v_current.active IS DISTINCT FROM true
    OR v_current.activated_at IS NULL
    OR v_current.deactivated_at IS NOT NULL
    OR v_current.lineage_version <> 'case-vortex-lineage-v2'
    OR v_current.run_status <> 'completed'
    OR v_current.receipt_version <> 'case-vortex-publication-receipt-v2'
    OR v_current.completion_manifest_sha256 <> v_current.run_completion_manifest_sha256
    OR v_current.corpus_accounting_digest <> v_current.run_corpus_accounting_digest
    OR v_current.graph_artifact_set_sha256 <> v_current.run_graph_artifact_set_sha256
  THEN
    RAISE EXCEPTION 'case-graph first-publication deactivation compare-and-swap failed';
  END IF;

  v_deactivated_at := clock_timestamp();
  UPDATE public.uap_case_graph_publications
  SET active = false,
    deactivated_at = v_deactivated_at
  WHERE id = p_expected_active_publication_id
    AND active = true
    AND public_manifest_sha256 = p_expected_active_manifest_sha256;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph first-publication deactivation compare-and-swap failed';
  END IF;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE active = true)::bigint
  INTO v_total_count, v_active_count
  FROM public.uap_case_graph_publications;

  IF v_total_count <> 1 OR v_active_count <> 0 THEN
    RAISE EXCEPTION 'case-graph first-publication deactivation postcondition failed';
  END IF;

  RETURN QUERY SELECT
    p_expected_active_publication_id,
    v_current.corpus_version,
    p_expected_active_manifest_sha256,
    v_deactivated_at,
    p_reason_sha256,
    v_active_count,
    v_total_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_first_uap_case_graph_publication_v1(
  UUID, TEXT, TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.deactivate_first_uap_case_graph_publication_v1(
      UUID, TEXT, TEXT
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.deactivate_first_uap_case_graph_publication_v1(
      UUID, TEXT, TEXT
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.deactivate_first_uap_case_graph_publication_v1(
      UUID, TEXT, TEXT
    ) TO service_role;
  END IF;
END $$;
