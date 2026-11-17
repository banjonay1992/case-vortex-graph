BEGIN;

ALTER TABLE public.case_vortex_luna_turns
  ADD COLUMN IF NOT EXISTS claim_analyses JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.case_vortex_luna_turns
  DROP CONSTRAINT IF EXISTS case_vortex_luna_turns_claim_analyses_shape;
ALTER TABLE public.case_vortex_luna_turns
  ADD CONSTRAINT case_vortex_luna_turns_claim_analyses_shape CHECK (
    jsonb_typeof(claim_analyses) = 'array'
    AND jsonb_array_length(claim_analyses) <= 8
    AND octet_length(claim_analyses::text) <= 1048576
  );

CREATE OR REPLACE FUNCTION public.save_case_vortex_luna_turn(
  p_owner_id UUID,
  p_workspace_id UUID,
  p_thread_id UUID,
  p_request_id UUID,
  p_question TEXT,
  p_answer TEXT,
  p_answer_status TEXT,
  p_citations JSONB,
  p_source_assessments JSONB,
  p_claim_analyses JSONB,
  p_similar_cases JSONB,
  p_external_correlations JSONB,
  p_uncertainty JSONB,
  p_suggested_queries JSONB,
  p_tool_result_digests JSONB,
  p_tool_receipts JSONB,
  p_provider_usage JSONB,
  p_answer_digest VARCHAR(64),
  p_publication_id UUID,
  p_manifest_sha256 VARCHAR(64)
)
RETURNS TABLE(saved_turn_id UUID, saved_sequence INTEGER, was_created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_saved_turn_id UUID;
  v_saved_sequence INTEGER;
  v_was_created BOOLEAN;
  v_persisted_claim_analyses JSONB;
BEGIN
  IF jsonb_typeof(p_claim_analyses) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_claim_analyses) > 8
    OR octet_length(p_claim_analyses::text) > 1048576
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_claim_analyses) analysis
      WHERE jsonb_typeof(analysis) IS DISTINCT FROM 'object'
        OR analysis->>'analysisDigest' !~ '^[a-f0-9]{64}$'
        OR analysis->>'resultDigest' !~ '^[a-f0-9]{64}$'
        OR NOT p_tool_result_digests ? (analysis->>'resultDigest')
    )
    OR (
      SELECT COUNT(*) IS DISTINCT FROM COUNT(DISTINCT analysis->>'analysisDigest')
      FROM jsonb_array_elements(p_claim_analyses) analysis
    ) THEN
    RAISE EXCEPTION 'case_vortex_workspace_claim_analysis_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT saved.saved_turn_id, saved.saved_sequence, saved.was_created
    INTO v_saved_turn_id, v_saved_sequence, v_was_created
    FROM public.save_case_vortex_luna_turn(
      p_owner_id,
      p_workspace_id,
      p_thread_id,
      p_request_id,
      p_question,
      p_answer,
      p_answer_status,
      p_citations,
      p_source_assessments,
      p_similar_cases,
      p_external_correlations,
      p_uncertainty,
      p_suggested_queries,
      p_tool_result_digests,
      p_tool_receipts,
      p_provider_usage,
      p_answer_digest,
      p_publication_id,
      p_manifest_sha256
    ) saved;

  SELECT turn.claim_analyses
    INTO v_persisted_claim_analyses
    FROM public.case_vortex_luna_turns turn
    WHERE turn.id = v_saved_turn_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_vortex_workspace_turn_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_was_created THEN
    UPDATE public.case_vortex_luna_turns
      SET claim_analyses = p_claim_analyses
      WHERE id = v_saved_turn_id;
  ELSIF v_persisted_claim_analyses IS DISTINCT FROM p_claim_analyses THEN
    RAISE EXCEPTION 'case_vortex_workspace_turn_idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT v_saved_turn_id, v_saved_sequence, v_was_created;
END;
$$;

REVOKE ALL ON FUNCTION public.save_case_vortex_luna_turn(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
  VARCHAR, UUID, VARCHAR
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_case_vortex_luna_turn(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
  VARCHAR, UUID, VARCHAR
) TO service_role;

COMMIT;
