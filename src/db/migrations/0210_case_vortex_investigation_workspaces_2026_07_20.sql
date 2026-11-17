-- Owner-scoped, publication-pinned Case Vortex investigation workspaces.
-- These tables store user organisation and exact Luna receipts; they never
-- rewrite or elevate the underlying governed evidence publication.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.case_vortex_workspaces (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT COLLATE "C" NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 500),
  description TEXT COLLATE "C" CHECK (description IS NULL OR octet_length(description) <= 8000),
  status TEXT COLLATE "C" NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  publication_id UUID NOT NULL REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  corpus_version TEXT COLLATE "C" NOT NULL CHECK (octet_length(corpus_version) BETWEEN 1 AND 240),
  manifest_sha256 VARCHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_id TEXT COLLATE "C" NOT NULL CHECK (octet_length(snapshot_id) BETWEEN 1 AND 240),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (updated_at >= created_at),
  UNIQUE (id, publication_id),
  UNIQUE (id, publication_id, manifest_sha256)
);

CREATE TABLE IF NOT EXISTS public.case_vortex_workspace_groups (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  title TEXT COLLATE "C" NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 300),
  description TEXT COLLATE "C" CHECK (description IS NULL OR octet_length(description) <= 4000),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (workspace_id, title),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS public.case_vortex_workspace_evidence (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL,
  group_id UUID,
  address TEXT COLLATE "C" NOT NULL
    CHECK (address ~ '^(sighting|document|photo|video):[^[:space:]]{1,240}$'),
  node_digest VARCHAR(64) NOT NULL CHECK (node_digest ~ '^[a-f0-9]{64}$'),
  label TEXT COLLATE "C" CHECK (label IS NULL OR octet_length(label) <= 500),
  note TEXT COLLATE "C" CHECK (note IS NULL OR octet_length(note) <= 12000),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000000),
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (workspace_id, address),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, publication_id)
    REFERENCES public.case_vortex_workspaces(id, publication_id) ON DELETE CASCADE,
  FOREIGN KEY (publication_id, address)
    REFERENCES public.case_graph_research_search_publication_nodes(publication_id, address) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, group_id)
    REFERENCES public.case_vortex_workspace_groups(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.case_vortex_workspace_hypotheses (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  title TEXT COLLATE "C" NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 500),
  statement TEXT COLLATE "C" NOT NULL CHECK (octet_length(statement) BETWEEN 1 AND 12000),
  status TEXT COLLATE "C" NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'supported', 'challenged', 'rejected', 'unresolved')),
  confidence TEXT COLLATE "C" NOT NULL DEFAULT 'unrated'
    CHECK (confidence IN ('unrated', 'low', 'medium', 'high')),
  notes TEXT COLLATE "C" CHECK (notes IS NULL OR octet_length(notes) <= 12000),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (workspace_id, title),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS public.case_vortex_hypothesis_evidence (
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  hypothesis_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  stance TEXT COLLATE "C" NOT NULL CHECK (stance IN ('supports', 'contradicts', 'context', 'uncertain')),
  reasoning TEXT COLLATE "C" CHECK (reasoning IS NULL OR octet_length(reasoning) <= 8000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (workspace_id, hypothesis_id, evidence_id),
  FOREIGN KEY (workspace_id, hypothesis_id)
    REFERENCES public.case_vortex_workspace_hypotheses(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES public.case_vortex_workspace_evidence(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.case_vortex_luna_threads (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  title TEXT COLLATE "C" NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS public.case_vortex_luna_turns (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 1000000),
  request_id UUID NOT NULL,
  question TEXT COLLATE "C" NOT NULL CHECK (octet_length(question) BETWEEN 1 AND 4000),
  answer TEXT COLLATE "C" NOT NULL CHECK (octet_length(answer) BETWEEN 1 AND 120000),
  answer_status TEXT COLLATE "C" NOT NULL
    CHECK (answer_status IN ('grounded', 'partial', 'insufficient_evidence')),
  citations JSONB NOT NULL CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) <= 100),
  source_assessments JSONB NOT NULL CHECK (jsonb_typeof(source_assessments) = 'array' AND jsonb_array_length(source_assessments) <= 100),
  similar_cases JSONB NOT NULL CHECK (jsonb_typeof(similar_cases) = 'array' AND jsonb_array_length(similar_cases) <= 40),
  external_correlations JSONB NOT NULL CHECK (jsonb_typeof(external_correlations) = 'array' AND jsonb_array_length(external_correlations) <= 90),
  uncertainty JSONB NOT NULL CHECK (jsonb_typeof(uncertainty) = 'array' AND jsonb_array_length(uncertainty) <= 50),
  suggested_queries JSONB NOT NULL CHECK (jsonb_typeof(suggested_queries) = 'array' AND jsonb_array_length(suggested_queries) <= 20),
  tool_result_digests JSONB NOT NULL CHECK (jsonb_typeof(tool_result_digests) = 'array' AND jsonb_array_length(tool_result_digests) BETWEEN 1 AND 40),
  answer_digest VARCHAR(64) NOT NULL CHECK (answer_digest ~ '^[a-f0-9]{64}$'),
  publication_id UUID NOT NULL REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  manifest_sha256 VARCHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (thread_id, sequence),
  UNIQUE (thread_id, request_id),
  UNIQUE (thread_id, answer_digest),
  FOREIGN KEY (workspace_id, thread_id)
    REFERENCES public.case_vortex_luna_threads(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, publication_id, manifest_sha256)
    REFERENCES public.case_vortex_workspaces(id, publication_id, manifest_sha256) ON DELETE RESTRICT,
  CHECK (octet_length(citations::text) <= 524288),
  CHECK (octet_length(source_assessments::text) <= 524288),
  CHECK (octet_length(similar_cases::text) <= 524288),
  CHECK (octet_length(external_correlations::text) <= 524288)
);

CREATE TABLE IF NOT EXISTS public.case_vortex_workspace_dossiers (
  workspace_id UUID PRIMARY KEY REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  schema_version TEXT COLLATE "C" NOT NULL DEFAULT 'case-vortex-living-dossier-v1'
    CHECK (schema_version = 'case-vortex-living-dossier-v1'),
  dossier JSONB NOT NULL CHECK (jsonb_typeof(dossier) = 'object' AND octet_length(dossier::text) <= 1048576),
  input_digest VARCHAR(64) NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  dossier_digest VARCHAR(64) NOT NULL CHECK (dossier_digest ~ '^[a-f0-9]{64}$'),
  refresh_status TEXT COLLATE "C" NOT NULL DEFAULT 'current'
    CHECK (refresh_status IN ('current', 'stale', 'refreshing', 'failed')),
  last_error_code TEXT COLLATE "C" CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9][a-z0-9._:-]{0,239}$'),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((refresh_status = 'failed') = (last_error_code IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.case_vortex_workspace_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.case_vortex_workspaces(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT COLLATE "C" NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]{0,79}$'),
  entity_type TEXT COLLATE "C" NOT NULL CHECK (entity_type IN ('workspace', 'group', 'evidence', 'hypothesis', 'hypothesis_evidence', 'luna_thread', 'luna_turn', 'dossier')),
  entity_id TEXT COLLATE "C" NOT NULL CHECK (octet_length(entity_id) BETWEEN 1 AND 240),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 32768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS case_vortex_workspaces_owner_updated_idx
  ON public.case_vortex_workspaces (owner_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS case_vortex_workspace_evidence_workspace_position_idx
  ON public.case_vortex_workspace_evidence (workspace_id, position, pinned_at, id);
CREATE INDEX IF NOT EXISTS case_vortex_workspace_evidence_group_idx
  ON public.case_vortex_workspace_evidence (workspace_id, group_id, id);
CREATE INDEX IF NOT EXISTS case_vortex_workspace_hypotheses_workspace_position_idx
  ON public.case_vortex_workspace_hypotheses (workspace_id, position, created_at, id);
CREATE INDEX IF NOT EXISTS case_vortex_luna_turns_thread_sequence_idx
  ON public.case_vortex_luna_turns (workspace_id, thread_id, sequence, id);
CREATE INDEX IF NOT EXISTS case_vortex_workspace_audit_workspace_created_idx
  ON public.case_vortex_workspace_audit (workspace_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.case_vortex_workspace_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_vortex_workspace_validate_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_corpus_version TEXT;
  v_manifest_sha256 VARCHAR(64);
BEGIN
  SELECT publication.corpus_version, publication.public_manifest_sha256
    INTO v_corpus_version, v_manifest_sha256
    FROM public.uap_case_graph_publications publication
    WHERE publication.id = NEW.publication_id;
  IF NOT FOUND
    OR NEW.corpus_version IS DISTINCT FROM v_corpus_version
    OR NEW.manifest_sha256 IS DISTINCT FROM v_manifest_sha256 THEN
    RAISE EXCEPTION 'case_vortex_workspace_publication_binding_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS case_vortex_workspaces_validate_publication
  ON public.case_vortex_workspaces;
CREATE TRIGGER case_vortex_workspaces_validate_publication
  BEFORE INSERT OR UPDATE OF publication_id, corpus_version, manifest_sha256
  ON public.case_vortex_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.case_vortex_workspace_validate_publication();

CREATE OR REPLACE FUNCTION public.case_vortex_workspace_bind_evidence_node()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_node_digest VARCHAR(64);
BEGIN
  SELECT node.node_digest INTO v_node_digest
    FROM public.case_graph_research_search_publication_nodes node
    WHERE node.publication_id = NEW.publication_id AND node.address = NEW.address;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_vortex_workspace_evidence_not_in_publication' USING ERRCODE = '23503';
  END IF;
  NEW.node_digest := v_node_digest;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS case_vortex_workspace_evidence_bind_node
  ON public.case_vortex_workspace_evidence;
CREATE TRIGGER case_vortex_workspace_evidence_bind_node
  BEFORE INSERT OR UPDATE OF publication_id, address, node_digest
  ON public.case_vortex_workspace_evidence
  FOR EACH ROW EXECUTE FUNCTION public.case_vortex_workspace_bind_evidence_node();

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'case_vortex_workspaces', 'case_vortex_workspace_groups',
    'case_vortex_workspace_evidence', 'case_vortex_workspace_hypotheses',
    'case_vortex_hypothesis_evidence', 'case_vortex_luna_threads',
    'case_vortex_workspace_dossiers'
  ] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', v_table, v_table);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.case_vortex_workspace_touch()',
      v_table, v_table
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.case_vortex_workspace_bump_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_workspace_id UUID;
BEGIN
  v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  UPDATE public.case_vortex_workspaces
    SET version = version + 1, updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_workspace_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

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
BEGIN
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
    IF v_existing.answer_digest IS DISTINCT FROM p_answer_digest THEN
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
    tool_result_digests, answer_digest, publication_id, manifest_sha256
  ) VALUES (
    p_workspace_id, p_thread_id, v_sequence, p_request_id, p_question, p_answer, p_answer_status,
    p_citations, p_source_assessments, p_similar_cases, p_external_correlations, p_uncertainty, p_suggested_queries,
    p_tool_result_digests, p_answer_digest, p_publication_id, p_manifest_sha256
  ) RETURNING id INTO v_turn_id;
  INSERT INTO public.case_vortex_workspace_audit (
    workspace_id, actor_id, action, entity_type, entity_id, detail
  ) VALUES (
    p_workspace_id, p_owner_id, 'saved_luna_turn', 'luna_turn', v_turn_id::text,
    pg_catalog.jsonb_build_object('thread_id', p_thread_id, 'sequence', v_sequence, 'answer_digest', p_answer_digest)
  );
  RETURN QUERY SELECT v_turn_id, v_sequence, true;
END;
$$;

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'case_vortex_workspace_groups', 'case_vortex_workspace_evidence',
    'case_vortex_workspace_hypotheses', 'case_vortex_hypothesis_evidence',
    'case_vortex_luna_threads', 'case_vortex_luna_turns', 'case_vortex_workspace_dossiers'
  ] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS %I_bump_workspace ON public.%I', v_table, v_table);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I_bump_workspace AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.case_vortex_workspace_bump_version()',
      v_table, v_table
    );
  END LOOP;
END $$;

ALTER TABLE public.case_vortex_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_hypothesis_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_luna_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_luna_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_hypotheses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_hypothesis_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_luna_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_luna_turns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_dossiers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_workspace_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY case_vortex_workspaces_owner_all ON public.case_vortex_workspaces
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'case_vortex_workspace_groups', 'case_vortex_workspace_evidence',
    'case_vortex_workspace_hypotheses', 'case_vortex_hypothesis_evidence',
    'case_vortex_luna_threads', 'case_vortex_luna_turns',
    'case_vortex_workspace_dossiers', 'case_vortex_workspace_audit'
  ] LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I_owner_all ON public.%I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.case_vortex_workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.case_vortex_workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())))',
      v_table, v_table
    );
  END LOOP;
END $$;

REVOKE ALL ON public.case_vortex_workspaces FROM anon;
REVOKE ALL ON public.case_vortex_workspace_groups FROM anon;
REVOKE ALL ON public.case_vortex_workspace_evidence FROM anon;
REVOKE ALL ON public.case_vortex_workspace_hypotheses FROM anon;
REVOKE ALL ON public.case_vortex_hypothesis_evidence FROM anon;
REVOKE ALL ON public.case_vortex_luna_threads FROM anon;
REVOKE ALL ON public.case_vortex_luna_turns FROM anon;
REVOKE ALL ON public.case_vortex_workspace_dossiers FROM anon;
REVOKE ALL ON public.case_vortex_workspace_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.case_vortex_luna_turns FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.case_vortex_workspace_dossiers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.case_vortex_workspace_audit FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_workspaces TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_workspace_groups TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_workspace_evidence TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_workspace_hypotheses TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_hypothesis_evidence TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_luna_threads TO authenticated, service_role;
GRANT SELECT ON public.case_vortex_luna_turns TO authenticated;
GRANT SELECT ON public.case_vortex_luna_turns TO service_role;
GRANT SELECT ON public.case_vortex_workspace_dossiers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_vortex_workspace_dossiers TO service_role;
GRANT SELECT ON public.case_vortex_workspace_audit TO authenticated, service_role;
GRANT INSERT ON public.case_vortex_workspace_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.case_vortex_workspace_audit_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.case_vortex_workspace_touch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.case_vortex_workspace_bump_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.case_vortex_workspace_validate_publication() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.case_vortex_workspace_bind_evidence_node() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_case_vortex_luna_turn(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, VARCHAR, UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_case_vortex_luna_turn(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, VARCHAR, UUID, VARCHAR) TO service_role;
