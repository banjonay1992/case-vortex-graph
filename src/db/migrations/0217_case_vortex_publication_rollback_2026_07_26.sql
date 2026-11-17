-- Exact compare-and-swap rollback for the Case Vortex publication control plane.
--
-- This migration does not perform a rollback. It adds the sole service-role
-- rollback path. The function requires the caller's exact current publication
-- and both public-manifest digests, permits only a previously activated and
-- deactivated verified-v2 target, reuses the complete v2 activation verifier,
-- and records rollback lineage in the same transaction.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE OR REPLACE FUNCTION public.uap_case_graph_publication_activation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_table_owner NAME;
BEGIN
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

CREATE OR REPLACE FUNCTION public.rollback_uap_case_graph_publication_v1(
  p_expected_active_publication_id UUID,
  p_target_publication_id UUID,
  p_expected_active_manifest_sha256 TEXT,
  p_target_manifest_sha256 TEXT,
  p_reason_sha256 TEXT
)
RETURNS TABLE (
  previous_publication_id UUID,
  target_publication_id UUID,
  previous_manifest_sha256 TEXT,
  target_manifest_sha256 TEXT,
  rolled_back_at TIMESTAMPTZ,
  reason_sha256 TEXT,
  active_publication_count BIGINT,
  rollback_of_publication_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current RECORD;
  v_target RECORD;
  v_activation RECORD;
  v_current_count BIGINT;
  v_active_count BIGINT;
BEGIN
  IF NOT ((
    p_expected_active_publication_id IS NOT NULL
    AND p_target_publication_id IS NOT NULL
    AND p_expected_active_publication_id <> p_target_publication_id
    AND p_expected_active_manifest_sha256 ~ '^[a-f0-9]{64}$'
    AND p_target_manifest_sha256 ~ '^[a-f0-9]{64}$'
    AND p_reason_sha256 ~ '^[a-f0-9]{64}$'
  ) IS TRUE) THEN
    RAISE EXCEPTION 'case-graph publication rollback input is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('uap-case-graph-publication-v2', 0)
  );

  -- Lock the complete active set before evaluating the expected generation.
  -- A plain SELECT INTO could otherwise accept one arbitrary row if a damaged
  -- control plane already contained multiple active publications.
  PERFORM publication.id
  FROM public.uap_case_graph_publications AS publication
  WHERE publication.active = true
  FOR UPDATE;

  SELECT COUNT(*)::bigint
  INTO v_current_count
  FROM public.uap_case_graph_publications
  WHERE active = true;

  SELECT
    publication.id,
    publication.public_manifest_sha256,
    publication.active,
    publication.activated_at,
    publication.deactivated_at,
    run.lineage_version,
    run.status AS run_status,
    receipt.receipt_version,
    receipt.public_manifest_sha256 AS receipt_public_manifest_sha256
  INTO v_current
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_runs AS run
    ON run.id = publication.run_id
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.active = true
    AND publication.id = p_expected_active_publication_id
  FOR UPDATE OF publication, run, receipt;

  IF v_current_count <> 1
    OR NOT FOUND
    OR v_current.id <> p_expected_active_publication_id
    OR v_current.public_manifest_sha256 <> p_expected_active_manifest_sha256
    OR v_current.receipt_public_manifest_sha256 <> p_expected_active_manifest_sha256
    OR v_current.active IS DISTINCT FROM true
    OR v_current.activated_at IS NULL
    OR v_current.deactivated_at IS NOT NULL
    OR v_current.lineage_version <> 'case-vortex-lineage-v2'
    OR v_current.run_status <> 'completed'
    OR v_current.receipt_version <> 'case-vortex-publication-receipt-v2'
  THEN
    RAISE EXCEPTION 'case-graph publication rollback compare-and-swap failed';
  END IF;

  SELECT
    publication.id,
    publication.public_manifest_sha256,
    publication.active,
    publication.activated_at,
    publication.deactivated_at,
    run.lineage_version,
    run.status AS run_status,
    receipt.receipt_version,
    receipt.public_manifest_sha256 AS receipt_public_manifest_sha256,
    receipt.completion_manifest_sha256,
    receipt.corpus_accounting_digest,
    receipt.relationship_completion_digest,
    receipt.relationship_run_index_digest,
    receipt.relationship_run_artifact_set_sha256,
    receipt.relationship_policy_sha256,
    receipt.relationship_model_version,
    receipt.pair_calibration_id,
    receipt.pair_calibration_sha256,
    receipt.contextual_calibration_id,
    receipt.contextual_calibration_sha256,
    receipt.calibration_set_sha256,
    receipt.graph_artifact_set_sha256,
    receipt.relationship_accounting
  INTO v_target
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_runs AS run
    ON run.id = publication.run_id
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.id = p_target_publication_id
  FOR UPDATE OF publication, run, receipt;

  IF NOT FOUND
    OR v_target.public_manifest_sha256 <> p_target_manifest_sha256
    OR v_target.receipt_public_manifest_sha256 <> p_target_manifest_sha256
    OR v_target.active IS DISTINCT FROM false
    OR v_target.activated_at IS NULL
    OR v_target.deactivated_at IS NULL
    OR v_target.lineage_version <> 'case-vortex-lineage-v2'
    OR v_target.run_status <> 'completed'
    OR v_target.receipt_version <> 'case-vortex-publication-receipt-v2'
  THEN
    RAISE EXCEPTION 'case-graph publication rollback target is not a prior verified generation';
  END IF;

  SELECT *
  INTO v_activation
  FROM public.activate_uap_case_graph_publication_v2(
    p_target_publication_id,
    p_target_manifest_sha256,
    v_target.completion_manifest_sha256,
    v_target.corpus_accounting_digest,
    v_target.relationship_completion_digest,
    v_target.relationship_run_index_digest,
    v_target.relationship_run_artifact_set_sha256,
    v_target.relationship_policy_sha256,
    v_target.relationship_model_version,
    v_target.pair_calibration_id,
    v_target.pair_calibration_sha256,
    v_target.contextual_calibration_id,
    v_target.contextual_calibration_sha256,
    v_target.calibration_set_sha256,
    v_target.graph_artifact_set_sha256,
    v_target.relationship_accounting
  );

  IF v_activation.publication_id <> p_target_publication_id THEN
    RAISE EXCEPTION 'case-graph publication rollback activation was not observed';
  END IF;

  UPDATE public.uap_case_graph_publications
  SET rollback_of_publication_id = p_expected_active_publication_id
  WHERE id = p_target_publication_id
    AND active = true;

  SELECT COUNT(*)::bigint
  INTO v_active_count
  FROM public.uap_case_graph_publications
  WHERE active = true;

  IF v_active_count <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.uap_case_graph_publications AS target
      WHERE target.id = p_target_publication_id
        AND target.active = true
        AND target.deactivated_at IS NULL
        AND target.rollback_of_publication_id = p_expected_active_publication_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.uap_case_graph_publications AS previous
      WHERE previous.id = p_expected_active_publication_id
        AND previous.active = false
        AND previous.deactivated_at = v_activation.activated_at
    )
  THEN
    RAISE EXCEPTION 'case-graph publication rollback postcondition failed';
  END IF;

  RETURN QUERY SELECT
    p_expected_active_publication_id,
    p_target_publication_id,
    p_expected_active_manifest_sha256,
    p_target_manifest_sha256,
    v_activation.activated_at,
    p_reason_sha256,
    v_active_count,
    p_expected_active_publication_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rollback_uap_case_graph_publication_v1(
  UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.rollback_uap_case_graph_publication_v1(
      UUID, UUID, TEXT, TEXT, TEXT
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.rollback_uap_case_graph_publication_v1(
      UUID, UUID, TEXT, TEXT, TEXT
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.rollback_uap_case_graph_publication_v1(
      UUID, UUID, TEXT, TEXT, TEXT
    ) TO service_role;
  END IF;
END $$;
