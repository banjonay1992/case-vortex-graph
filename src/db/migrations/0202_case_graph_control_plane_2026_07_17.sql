-- Durable control plane for the versioned Case Vortex graph pipeline.
-- Bulk features, candidates and edges remain immutable R2 artifacts; Postgres
-- stores run state, per-case current pointers, shard receipts and publication
-- activation. These tables are service-role-only and expose no raw narratives.

-- The graph exporter filters a 1M+ row corpus by governed source and then
-- walks a frozen keyset cursor. This expression index keeps each resumable
-- page bounded without materialising narratives in Postgres.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_uap_sightings_case_graph_source_cursor
  ON public.uap_sightings (
    (UPPER(COALESCE(NULLIF(TRIM(source), ''), ''))),
    (COALESCE(updated_at, event_timestamp, created_at, ingested_at)),
    id
  );

CREATE TABLE IF NOT EXISTS public.uap_case_graph_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_version TEXT NOT NULL UNIQUE,
  publishability_policy TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  rarity_version TEXT NOT NULL,
  candidate_version TEXT NOT NULL,
  relationship_policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'partial', 'completed', 'failed', 'superseded')),
  source_snapshot_at TIMESTAMPTZ NOT NULL,
  expected_eligible_count BIGINT NOT NULL CHECK (expected_eligible_count >= 0),
  processed_eligible_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_eligible_count >= 0),
  excluded_count BIGINT NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  candidate_count BIGINT NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  edge_count BIGINT NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  isolated_case_count BIGINT NOT NULL DEFAULT 0 CHECK (isolated_case_count >= 0),
  shard_count INTEGER NOT NULL DEFAULT 0 CHECK (shard_count >= 0),
  feature_cursor_updated_at TIMESTAMPTZ,
  feature_cursor_sighting_id UUID,
  r2_prefix TEXT NOT NULL,
  completion_manifest_key TEXT,
  completion_manifest_sha256 VARCHAR(64),
  error_code TEXT,
  error_detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (processed_eligible_count + excluded_count <= expected_eligible_count),
  CHECK (
    completion_manifest_sha256 IS NULL
    OR completion_manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CHECK (
    (feature_cursor_updated_at IS NULL AND feature_cursor_sighting_id IS NULL)
    OR (feature_cursor_updated_at IS NOT NULL AND feature_cursor_sighting_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_runs_status_updated
  ON public.uap_case_graph_runs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_uap_case_graph_runs_completed
  ON public.uap_case_graph_runs (completed_at DESC)
  WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS public.uap_case_graph_shards (
  run_id UUID NOT NULL REFERENCES public.uap_case_graph_runs(id) ON DELETE CASCADE,
  shard_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('features', 'candidates', 'edges', 'density', 'ego_index')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'partial', 'completed', 'failed', 'superseded')),
  expected_case_count BIGINT NOT NULL DEFAULT 0 CHECK (expected_case_count >= 0),
  processed_case_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_case_count >= 0),
  output_record_count BIGINT NOT NULL DEFAULT 0 CHECK (output_record_count >= 0),
  first_cursor JSONB,
  last_cursor JSONB,
  artifact_key TEXT,
  artifact_sha256 VARCHAR(64),
  manifest_key TEXT,
  manifest_sha256 VARCHAR(64),
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  audit JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audit) = 'object'),
  error_code TEXT,
  error_detail TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, stage, shard_id),
  CHECK (processed_case_count <= expected_case_count),
  CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_shards_status
  ON public.uap_case_graph_shards (run_id, stage, status, updated_at);

CREATE TABLE IF NOT EXISTS public.uap_case_graph_case_state (
  sighting_id UUID PRIMARY KEY REFERENCES public.uap_sightings(id) ON DELETE CASCADE,
  corpus_version TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  feature_digest VARCHAR(64) NOT NULL CHECK (feature_digest ~ '^[a-f0-9]{64}$'),
  source_updated_at TIMESTAMPTZ,
  feature_shard_id TEXT NOT NULL,
  feature_artifact_key TEXT NOT NULL,
  feature_row_index INTEGER NOT NULL CHECK (feature_row_index >= 0),
  graph_degree INTEGER NOT NULL DEFAULT 0 CHECK (graph_degree >= 0),
  ego_shard_id TEXT,
  ego_artifact_key TEXT,
  last_run_id UUID NOT NULL REFERENCES public.uap_case_graph_runs(id) ON DELETE RESTRICT,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_case_state_corpus_shard
  ON public.uap_case_graph_case_state (corpus_version, feature_shard_id, sighting_id);
CREATE INDEX IF NOT EXISTS idx_uap_case_graph_case_state_source_updated
  ON public.uap_case_graph_case_state (source_updated_at, sighting_id);
CREATE INDEX IF NOT EXISTS idx_uap_case_graph_case_state_degree
  ON public.uap_case_graph_case_state (corpus_version, graph_degree DESC, sighting_id);

CREATE TABLE IF NOT EXISTS public.uap_case_graph_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES public.uap_case_graph_runs(id) ON DELETE RESTRICT,
  corpus_version TEXT NOT NULL UNIQUE,
  public_manifest_key TEXT NOT NULL,
  public_manifest_sha256 VARCHAR(64) NOT NULL
    CHECK (public_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  active BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  rollback_of_publication_id UUID REFERENCES public.uap_case_graph_publications(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((active = false) OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uap_case_graph_publications_single_active
  ON public.uap_case_graph_publications ((active))
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_uap_case_graph_publications_created
  ON public.uap_case_graph_publications (created_at DESC);

CREATE OR REPLACE FUNCTION public.uap_case_graph_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS uap_case_graph_runs_touch_updated_at_trg
  ON public.uap_case_graph_runs;
CREATE TRIGGER uap_case_graph_runs_touch_updated_at_trg
  BEFORE UPDATE ON public.uap_case_graph_runs
  FOR EACH ROW EXECUTE FUNCTION public.uap_case_graph_touch_updated_at();

DROP TRIGGER IF EXISTS uap_case_graph_shards_touch_updated_at_trg
  ON public.uap_case_graph_shards;
CREATE TRIGGER uap_case_graph_shards_touch_updated_at_trg
  BEFORE UPDATE ON public.uap_case_graph_shards
  FOR EACH ROW EXECUTE FUNCTION public.uap_case_graph_touch_updated_at();

DROP TRIGGER IF EXISTS uap_case_graph_case_state_touch_updated_at_trg
  ON public.uap_case_graph_case_state;
CREATE TRIGGER uap_case_graph_case_state_touch_updated_at_trg
  BEFORE UPDATE ON public.uap_case_graph_case_state
  FOR EACH ROW EXECUTE FUNCTION public.uap_case_graph_touch_updated_at();

REVOKE ALL ON TABLE public.uap_case_graph_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.uap_case_graph_shards FROM PUBLIC;
REVOKE ALL ON TABLE public.uap_case_graph_case_state FROM PUBLIC;
REVOKE ALL ON TABLE public.uap_case_graph_publications FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_touch_updated_at() FROM PUBLIC;

ALTER TABLE public.uap_case_graph_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_case_graph_shards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_case_graph_case_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_case_graph_publications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'uap_case_graph_runs',
    'uap_case_graph_shards',
    'uap_case_graph_case_state',
    'uap_case_graph_publications'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
      policy_name := 'service_role_manage_' || table_name;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        policy_name,
        table_name
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_touch_updated_at() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_touch_updated_at() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.uap_case_graph_touch_updated_at() TO service_role;
  END IF;
END $$;
