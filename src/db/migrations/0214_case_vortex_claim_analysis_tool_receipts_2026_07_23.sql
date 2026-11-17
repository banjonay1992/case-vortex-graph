BEGIN;

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
  v_workspace_publication_id UUID;
  v_workspace_manifest_sha256 VARCHAR(64);
  v_existing public.case_vortex_luna_turns%ROWTYPE;
  v_turn_id UUID;
  v_sequence INTEGER;
  v_receipt_count INTEGER;
  v_digest_count INTEGER;
BEGIN
  IF jsonb_typeof(p_tool_result_digests) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_tool_result_digests) NOT BETWEEN 1 AND 40
    OR jsonb_typeof(p_tool_receipts) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_tool_receipts) NOT BETWEEN 1 AND 40
    OR jsonb_typeof(p_provider_usage) IS DISTINCT FROM 'object'
    OR octet_length(p_tool_receipts::text) > 524288
    OR octet_length(p_provider_usage::text) > 8192 THEN
    RAISE EXCEPTION 'case_vortex_workspace_report_replay_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT value)
    INTO v_digest_count, v_sequence
    FROM jsonb_array_elements_text(p_tool_result_digests);
  IF v_digest_count IS DISTINCT FROM v_sequence
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_tool_result_digests) digest_value
      WHERE digest_value !~ '^[a-f0-9]{64}$'
    ) THEN
    RAISE EXCEPTION 'case_vortex_workspace_report_replay_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT receipt->>'resultDigest')
    INTO v_receipt_count, v_sequence
    FROM jsonb_array_elements(p_tool_receipts) receipt;
  IF v_receipt_count IS DISTINCT FROM v_digest_count
    OR v_receipt_count IS DISTINCT FROM v_sequence
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_tool_receipts) receipt
      WHERE jsonb_typeof(receipt) IS DISTINCT FROM 'object'
        OR receipt->>'sequence' !~ '^[1-9][0-9]?$'
        OR CASE WHEN receipt->>'sequence' ~ '^[1-9][0-9]?$'
          THEN (receipt->>'sequence')::integer NOT BETWEEN 1 AND 40
          ELSE true END
        OR receipt->>'tool' NOT IN (
          'search_records',
          'search_content',
          'open_content',
          'trace_content',
          'inspect_claims',
          'inspect_source_reliability',
          'analyze_case_claims',
          'open_record',
          'expand_relationships',
          'correlate_context',
          'compare_records',
          'find_similar_cases',
          'trace_connection',
          'build_evidence_packet'
        )
        OR receipt->>'resultDigest' !~ '^[a-f0-9]{64}$'
        OR jsonb_typeof(receipt->'accounting') NOT IN ('object', 'null')
        OR NOT p_tool_result_digests ? (receipt->>'resultDigest')
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_tool_result_digests) digest_value
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_tool_receipts) receipt
        WHERE receipt->>'resultDigest' = digest_value
      )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_tool_receipts) WITH ORDINALITY ordered(receipt, ordinal)
      WHERE ordered.receipt->>'sequence' !~ '^[1-9][0-9]?$'
        OR CASE WHEN ordered.receipt->>'sequence' ~ '^[1-9][0-9]?$'
          THEN (ordered.receipt->>'sequence')::integer <> ordered.ordinal
          ELSE true END
    ) THEN
    RAISE EXCEPTION 'case_vortex_workspace_report_replay_invalid' USING ERRCODE = '23514';
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_object_keys(p_provider_usage)) <> 7 OR EXISTS (
    SELECT 1
    FROM jsonb_each(p_provider_usage) item
    WHERE item.key NOT IN (
      'providerCalls', 'meteredResponses', 'unmeteredResponses', 'inputTokens',
      'outputTokens', 'reasoningTokens', 'totalTokens'
    ) OR jsonb_typeof(item.value) <> 'number'
      OR (item.value #>> '{}') !~ '^[0-9]+$'
      OR (item.value #>> '{}')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'case_vortex_workspace_report_replay_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT workspace.publication_id, workspace.manifest_sha256
    INTO v_workspace_publication_id, v_workspace_manifest_sha256
    FROM public.case_vortex_luna_threads thread
    JOIN public.case_vortex_workspaces workspace ON workspace.id = thread.workspace_id
    WHERE thread.id = p_thread_id
      AND thread.workspace_id = p_workspace_id
      AND workspace.owner_id = p_owner_id
    FOR UPDATE OF thread;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_vortex_workspace_thread_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_workspace_publication_id IS DISTINCT FROM p_publication_id
    OR v_workspace_manifest_sha256 IS DISTINCT FROM p_manifest_sha256 THEN
    RAISE EXCEPTION 'case_vortex_workspace_publication_changed' USING ERRCODE = '23514';
  END IF;

  SELECT turn.* INTO v_existing
    FROM public.case_vortex_luna_turns turn
    WHERE turn.thread_id = p_thread_id AND turn.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.answer_digest IS DISTINCT FROM p_answer_digest
      OR v_existing.tool_result_digests IS DISTINCT FROM p_tool_result_digests
      OR v_existing.tool_receipts IS DISTINCT FROM p_tool_receipts
      OR v_existing.provider_usage IS DISTINCT FROM p_provider_usage THEN
      RAISE EXCEPTION 'case_vortex_workspace_turn_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.sequence, false;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(turn.sequence), 0) + 1 INTO v_sequence
    FROM public.case_vortex_luna_turns turn
    WHERE turn.thread_id = p_thread_id;
  INSERT INTO public.case_vortex_luna_turns (
    workspace_id, thread_id, sequence, request_id, question, answer, answer_status,
    citations, source_assessments, similar_cases, external_correlations, uncertainty, suggested_queries,
    tool_result_digests, tool_receipts, provider_usage, answer_digest, publication_id, manifest_sha256
  ) VALUES (
    p_workspace_id, p_thread_id, v_sequence, p_request_id, p_question, p_answer, p_answer_status,
    p_citations, p_source_assessments, p_similar_cases, p_external_correlations, p_uncertainty, p_suggested_queries,
    p_tool_result_digests, p_tool_receipts, p_provider_usage, p_answer_digest, p_publication_id, p_manifest_sha256
  ) RETURNING id INTO v_turn_id;
  INSERT INTO public.case_vortex_workspace_audit (
    workspace_id, actor_id, action, entity_type, entity_id, detail
  ) VALUES (
    p_workspace_id, p_owner_id, 'saved_luna_turn', 'luna_turn', v_turn_id::text,
    pg_catalog.jsonb_build_object(
      'thread_id', p_thread_id,
      'sequence', v_sequence,
      'answer_digest', p_answer_digest,
      'tool_receipt_count', v_receipt_count
    )
  );
  RETURN QUERY SELECT v_turn_id, v_sequence, true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_case_vortex_luna_turn(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
  VARCHAR, UUID, VARCHAR
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_case_vortex_luna_turn(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
  VARCHAR, UUID, VARCHAR
) TO service_role;

COMMIT;
