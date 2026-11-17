-- Case Vortex v2 control plane.
--
-- Immutable bulk data remains in content-addressed R2 artifacts. PostgreSQL
-- holds the exact snapshot lineage, one all-record address ledger, incremental
-- work leases, and the sole guarded publication activation path. Legacy-v1
-- runs remain readable but can never satisfy v2 activation.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE OR REPLACE FUNCTION public.uap_case_graph_jsonb_safe_count(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF jsonb_typeof(p_value) <> 'number'
    OR p_value::text !~ '^(0|[1-9][0-9]*)$'
  THEN
    RETURN false;
  END IF;
  RETURN (p_value::text)::numeric <= 9007199254740991;
END;
$$;

-- Exact, non-negative accounting for every governed typed relationship edge
-- kind. Keeping this validator in PostgreSQL lets both the run receipt and the
-- publication receipt reject missing, extra, fractional, unsafe, or
-- mis-totalled keys.
CREATE OR REPLACE FUNCTION public.uap_case_graph_typed_edge_type_counts_valid(
  p_counts JSONB,
  p_total BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry RECORD;
  v_total NUMERIC := 0;
BEGIN
  IF p_counts IS NULL
    OR p_total IS NULL
    OR p_total < 0
    OR p_total > 9007199254740991
    OR jsonb_typeof(p_counts) <> 'object'
  THEN
    RETURN false;
  END IF;
  IF (SELECT COUNT(*) FROM jsonb_object_keys(p_counts)) <> 13
    OR NOT (p_counts ?& ARRAY[
      'duplicate_provenance',
      'provenance',
      'space_time_candidate',
      'shared_visual',
      'shared_behavioural',
      'shared_sensory',
      'similar_duration',
      'shared_entity',
      'shared_site',
      'shared_narrative_pattern',
      'source_independence',
      'source_dependency',
      'contextual_explanation_candidate'
    ]::text[])
  THEN
    RETURN false;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_each(p_counts)
  LOOP
    IF public.uap_case_graph_jsonb_safe_count(v_entry.value) IS DISTINCT FROM true THEN
      RETURN false;
    END IF;
    v_total := v_total + (v_entry.value::text)::numeric;
  END LOOP;
  RETURN v_total = p_total::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.uap_case_graph_relationship_accounting_valid(
  p_accounting JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry RECORD;
  v_universe BIGINT;
  v_typed_edges BIGINT;
  v_kind_total NUMERIC := 0;
  v_status_total NUMERIC := 0;
BEGIN
  IF p_accounting IS NULL
    OR jsonb_typeof(p_accounting) <> 'object'
  THEN
    RETURN false;
  END IF;
  IF (SELECT COUNT(*) FROM jsonb_object_keys(p_accounting)) <> 9
    OR NOT (p_accounting ?& ARRAY[
      'universe_record_count',
      'address_kind_counts',
      'candidate_pair_count',
      'typed_edge_count',
      'typed_edge_type_counts',
      'skipped_group_count',
      'skipped_estimated_pair_count',
      'relationship_status_counts',
      'address_ledger_set_sha256'
    ]::text[])
  THEN
    RETURN false;
  END IF;

  IF public.uap_case_graph_jsonb_safe_count(
      p_accounting -> 'universe_record_count'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      p_accounting -> 'candidate_pair_count'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      p_accounting -> 'typed_edge_count'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      p_accounting -> 'skipped_group_count'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      p_accounting -> 'skipped_estimated_pair_count'
    ) IS DISTINCT FROM true
  THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_accounting -> 'address_kind_counts') <> 'object'
    OR jsonb_typeof(p_accounting -> 'relationship_status_counts') <> 'object'
  THEN
    RETURN false;
  END IF;
  IF (
      SELECT COUNT(*)
      FROM jsonb_object_keys(p_accounting -> 'address_kind_counts')
    ) <> 4
    OR NOT ((p_accounting -> 'address_kind_counts') ?& ARRAY[
      'sighting', 'document', 'photo', 'video'
    ]::text[])
    OR (
      SELECT COUNT(*)
      FROM jsonb_object_keys(p_accounting -> 'relationship_status_counts')
    ) <> 3
    OR NOT ((p_accounting -> 'relationship_status_counts') ?& ARRAY[
      'linked', 'candidate_only', 'isolated'
    ]::text[])
    OR jsonb_typeof(p_accounting -> 'address_ledger_set_sha256') <> 'string'
    OR (p_accounting ->> 'address_ledger_set_sha256') !~ '^[a-f0-9]{64}$'
  THEN
    RETURN false;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_each(p_accounting -> 'address_kind_counts')
  LOOP
    IF public.uap_case_graph_jsonb_safe_count(v_entry.value) IS DISTINCT FROM true THEN
      RETURN false;
    END IF;
    v_kind_total := v_kind_total + (v_entry.value::text)::numeric;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_each(p_accounting -> 'relationship_status_counts')
  LOOP
    IF public.uap_case_graph_jsonb_safe_count(v_entry.value) IS DISTINCT FROM true THEN
      RETURN false;
    END IF;
    v_status_total := v_status_total + (v_entry.value::text)::numeric;
  END LOOP;

  v_universe := (p_accounting ->> 'universe_record_count')::bigint;
  v_typed_edges := (p_accounting ->> 'typed_edge_count')::bigint;
  RETURN v_kind_total = v_universe::numeric
    AND v_status_total = v_universe::numeric
    AND public.uap_case_graph_typed_edge_type_counts_valid(
      p_accounting -> 'typed_edge_type_counts',
      v_typed_edges
    );
END;
$$;

ALTER TABLE public.uap_case_graph_runs
  ADD COLUMN IF NOT EXISTS lineage_version TEXT NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN IF NOT EXISTS snapshot_id UUID,
  ADD COLUMN IF NOT EXISTS snapshot_policy TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_materialized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_mvcc_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS universe_archive_version TEXT,
  ADD COLUMN IF NOT EXISTS universe_schema_version TEXT,
  ADD COLUMN IF NOT EXISTS universe_layout_version TEXT,
  ADD COLUMN IF NOT EXISTS universe_archive_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS universe_record_count BIGINT,
  ADD COLUMN IF NOT EXISTS feature_archive_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_input_schema_version TEXT,
  ADD COLUMN IF NOT EXISTS relationship_input_archive_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_input_manifest_digest VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_input_record_count BIGINT,
  ADD COLUMN IF NOT EXISTS relationship_model_id TEXT,
  -- The default only backfills databases that applied an earlier unreleased
  -- draft of this migration. It is dropped immediately below so callers must
  -- continue to supply the schema identity explicitly.
  ADD COLUMN IF NOT EXISTS relationship_schema_version TEXT
    DEFAULT 'case-graph-typed-relationship-v2',
  ADD COLUMN IF NOT EXISTS relationship_model_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS pair_calibration_id TEXT,
  ADD COLUMN IF NOT EXISTS pair_calibration_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS contextual_calibration_id TEXT,
  ADD COLUMN IF NOT EXISTS contextual_calibration_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS graph_artifact_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS corpus_accounting_digest VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_policy_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_model_version TEXT,
  ADD COLUMN IF NOT EXISTS relationship_run_index_digest VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_run_artifact_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_completion_digest VARCHAR(64),
  ADD COLUMN IF NOT EXISTS candidate_pair_count BIGINT,
  ADD COLUMN IF NOT EXISTS typed_edge_count BIGINT,
  ADD COLUMN IF NOT EXISTS skipped_group_count BIGINT,
  ADD COLUMN IF NOT EXISTS skipped_estimated_pair_count BIGINT,
  ADD COLUMN IF NOT EXISTS linked_address_count BIGINT,
  ADD COLUMN IF NOT EXISTS candidate_only_address_count BIGINT,
  ADD COLUMN IF NOT EXISTS isolated_address_count BIGINT,
  ADD COLUMN IF NOT EXISTS sighting_record_count BIGINT,
  ADD COLUMN IF NOT EXISTS document_record_count BIGINT,
  ADD COLUMN IF NOT EXISTS photo_record_count BIGINT,
  ADD COLUMN IF NOT EXISTS video_record_count BIGINT,
  ADD COLUMN IF NOT EXISTS typed_edge_type_counts JSONB,
  ADD COLUMN IF NOT EXISTS address_ledger_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS calibration_set_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS relationship_accounting JSONB;

ALTER TABLE public.uap_case_graph_runs
  ALTER COLUMN relationship_schema_version DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_uap_case_graph_run_snapshot'
      AND conrelid = 'public.uap_case_graph_runs'::regclass
  ) THEN
    ALTER TABLE public.uap_case_graph_runs
      ADD CONSTRAINT fk_uap_case_graph_run_snapshot
      FOREIGN KEY (snapshot_id)
      REFERENCES public.uap_evidence_universe_snapshots(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_uap_case_graph_run_v2_lineage'
      AND conrelid = 'public.uap_case_graph_runs'::regclass
  ) THEN
    ALTER TABLE public.uap_case_graph_runs
      ADD CONSTRAINT chk_uap_case_graph_run_v2_lineage CHECK (
        lineage_version <> 'case-vortex-lineage-v2'
        OR ((
          corpus_version ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
          AND status = 'completed'
          AND snapshot_id IS NOT NULL
          AND snapshot_policy = 'evidence-universe-materialized-v1'
          AND snapshot_materialized_at IS NOT NULL
          AND isfinite(snapshot_materialized_at)
          AND source_mvcc_snapshot ~ '^[0-9]+:[0-9]+:([0-9]+(,[0-9]+)*)?$'
          AND universe_archive_version = 'evidence-universe-archive-v3'
          AND universe_schema_version = 'evidence-universe-v2'
          AND universe_layout_version = 'evidence-universe-layout-v2'
          AND universe_archive_set_sha256 ~ '^[a-f0-9]{64}$'
          AND universe_record_count >= 0
          AND feature_archive_set_sha256 ~ '^[a-f0-9]{64}$'
          AND relationship_input_schema_version = 'relationship-input-snapshot-v2'
          AND relationship_input_archive_set_sha256 ~ '^[a-f0-9]{64}$'
          AND relationship_input_manifest_digest ~ '^[a-f0-9]{64}$'
          AND relationship_input_record_count = universe_record_count
          AND relationship_policy_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
          AND relationship_model_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
          AND relationship_schema_version = 'case-graph-typed-relationship-v2'
          AND relationship_model_sha256 ~ '^[a-f0-9]{64}$'
          AND pair_calibration_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
          AND pair_calibration_sha256 ~ '^[a-f0-9]{64}$'
          AND contextual_calibration_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
          AND contextual_calibration_sha256 ~ '^[a-f0-9]{64}$'
          AND pair_calibration_id <> contextual_calibration_id
          AND graph_artifact_set_sha256 ~ '^[a-f0-9]{64}$'
          AND corpus_accounting_digest ~ '^[a-f0-9]{64}$'
          AND relationship_policy_sha256 ~ '^[a-f0-9]{64}$'
          AND relationship_model_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
          AND relationship_run_index_digest ~ '^[a-f0-9]{64}$'
          AND relationship_run_artifact_set_sha256 ~ '^[a-f0-9]{64}$'
          AND relationship_completion_digest ~ '^[a-f0-9]{64}$'
          AND candidate_pair_count >= 0
          AND typed_edge_count >= 0
          AND skipped_group_count >= 0
          AND skipped_estimated_pair_count >= 0
          AND linked_address_count >= 0
          AND candidate_only_address_count >= 0
          AND isolated_address_count >= 0
          AND sighting_record_count >= 0
          AND document_record_count >= 0
          AND photo_record_count >= 0
          AND video_record_count >= 0
          AND sighting_record_count + document_record_count
            + photo_record_count + video_record_count = universe_record_count
          AND linked_address_count + candidate_only_address_count
            + isolated_address_count = universe_record_count
          AND public.uap_case_graph_typed_edge_type_counts_valid(
            typed_edge_type_counts,
            typed_edge_count
          )
          AND address_ledger_set_sha256 ~ '^[a-f0-9]{64}$'
          AND calibration_set_sha256 ~ '^[a-f0-9]{64}$'
          AND public.uap_case_graph_relationship_accounting_valid(
            relationship_accounting
          )
          AND relationship_accounting = jsonb_build_object(
            'universe_record_count', universe_record_count,
            'address_kind_counts', jsonb_build_object(
              'sighting', sighting_record_count,
              'document', document_record_count,
              'photo', photo_record_count,
              'video', video_record_count
            ),
            'candidate_pair_count', candidate_pair_count,
            'typed_edge_count', typed_edge_count,
            'typed_edge_type_counts', typed_edge_type_counts,
            'skipped_group_count', skipped_group_count,
            'skipped_estimated_pair_count', skipped_estimated_pair_count,
            'relationship_status_counts', jsonb_build_object(
              'linked', linked_address_count,
              'candidate_only', candidate_only_address_count,
              'isolated', isolated_address_count
            ),
            'address_ledger_set_sha256', address_ledger_set_sha256
          )
          AND candidate_count = candidate_pair_count
          AND edge_count = typed_edge_count
          AND isolated_case_count = isolated_address_count
          AND expected_eligible_count = universe_record_count
          AND processed_eligible_count = universe_record_count
          AND excluded_count = 0
          AND r2_prefix = 'case-vortex/corpora/' || corpus_version
          AND completion_manifest_key =
            'case-vortex/corpora/' || corpus_version || '/publication/_candidate.complete.manifest.json'
          AND completion_manifest_sha256 ~ '^[a-f0-9]{64}$'
          AND completed_at IS NOT NULL
          AND isfinite(completed_at)
        ) IS TRUE)
      );
  END IF;

  -- Keep a separately named model-artifact constraint so a development
  -- database that already applied an earlier draft of this unreleased
  -- migration is hardened on reapply as well as on a clean install.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_uap_case_graph_run_v2_model_sha256'
      AND conrelid = 'public.uap_case_graph_runs'::regclass
  ) THEN
    ALTER TABLE public.uap_case_graph_runs
      ADD CONSTRAINT chk_uap_case_graph_run_v2_model_sha256 CHECK ((
        lineage_version <> 'case-vortex-lineage-v2'
        OR relationship_model_sha256 ~ '^[a-f0-9]{64}$'
      ) IS TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_uap_case_graph_run_v2_relationship_schema'
      AND conrelid = 'public.uap_case_graph_runs'::regclass
  ) THEN
    ALTER TABLE public.uap_case_graph_runs
      ADD CONSTRAINT chk_uap_case_graph_run_v2_relationship_schema CHECK ((
        lineage_version <> 'case-vortex-lineage-v2'
        OR relationship_schema_version = 'case-graph-typed-relationship-v2'
      ) IS TRUE);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_runs_snapshot
  ON public.uap_case_graph_runs (snapshot_id, corpus_version)
  WHERE snapshot_id IS NOT NULL;

-- A v2 run is a lineage receipt, not mutable job state. Legacy rows retain
-- their original update path; once a row is inserted as v2, even a privileged
-- direct table update cannot drift its counters, keys, or hashes.
CREATE OR REPLACE FUNCTION public.uap_case_graph_run_v2_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.lineage_version = 'case-vortex-lineage-v2'
    OR (TG_OP = 'UPDATE' AND NEW.lineage_version = 'case-vortex-lineage-v2')
  THEN
    RAISE EXCEPTION 'case-graph v2 run receipts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_run_v2_guard
  ON public.uap_case_graph_runs;
CREATE TRIGGER trg_uap_case_graph_run_v2_guard
BEFORE UPDATE OR DELETE ON public.uap_case_graph_runs
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_run_v2_guard();

CREATE TABLE IF NOT EXISTS public.uap_case_graph_record_state (
  corpus_version TEXT NOT NULL,
  address TEXT COLLATE "C" NOT NULL,
  entity_kind TEXT NOT NULL
    CHECK (entity_kind IN ('sighting', 'document', 'photo', 'video')),
  entity_id TEXT COLLATE "C" NOT NULL CHECK (entity_id <> ''),
  universe_record_sha256 VARCHAR(64) NOT NULL
    CHECK (universe_record_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_input_sha256 VARCHAR(64) NOT NULL
    CHECK (relationship_input_sha256 ~ '^[a-f0-9]{64}$'),
  graph_record_sha256 VARCHAR(64) NOT NULL
    CHECK (graph_record_sha256 ~ '^[a-f0-9]{64}$'),
  user_interface_record_sha256 VARCHAR(64) NOT NULL
    CHECK (user_interface_record_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_disposition TEXT NOT NULL
    CHECK (relationship_disposition IN ('processed', 'not_applicable')),
  not_applicable_reason TEXT,
  last_run_id UUID NOT NULL
    REFERENCES public.uap_case_graph_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (corpus_version, address),
  CHECK (address = entity_kind || ':' || entity_id),
  CHECK (
    (relationship_disposition = 'processed' AND not_applicable_reason IS NULL)
    OR (
      relationship_disposition = 'not_applicable'
      AND not_applicable_reason ~ '^[a-z0-9][a-z0-9._:-]{0,239}$'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_record_state_kind
  ON public.uap_case_graph_record_state (corpus_version, entity_kind, address COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_uap_case_graph_record_state_run
  ON public.uap_case_graph_record_state (last_run_id, address COLLATE "C");

CREATE OR REPLACE FUNCTION public.uap_case_graph_record_state_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'case-graph corpus record ledgers are immutable';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_record_state_guard
  ON public.uap_case_graph_record_state;
CREATE TRIGGER trg_uap_case_graph_record_state_guard
BEFORE UPDATE OR DELETE ON public.uap_case_graph_record_state
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_record_state_guard();

-- One immutable PostgreSQL receipt for every canonical incremental plan stored
-- in R2. Queue rows reference both the plan and its exact batch/change IDs, so
-- a worker can recover the authoritative bytes rather than treating a digest
-- with no object locator as executable input.
CREATE TABLE IF NOT EXISTS public.uap_case_graph_incremental_plans (
  plan_id TEXT PRIMARY KEY
    CHECK (plan_id ~ '^plan:[a-f0-9]{64}$'),
  plan_sha256 VARCHAR(64) NOT NULL UNIQUE
    CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'case-vortex-incremental-plan-v1'),
  canonical_version TEXT NOT NULL
    CHECK (canonical_version = 'case-vortex-incremental-canonical-json-v1'),
  plan_artifact_key TEXT COLLATE "C" NOT NULL CHECK (plan_artifact_key <> ''),
  from_snapshot_id UUID NOT NULL
    REFERENCES public.uap_evidence_universe_snapshots(id) ON DELETE RESTRICT,
  to_snapshot_id UUID NOT NULL
    REFERENCES public.uap_evidence_universe_snapshots(id) ON DELETE RESTRICT,
  from_corpus_version TEXT NOT NULL
    CHECK (from_corpus_version ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  to_corpus_version TEXT NOT NULL
    CHECK (to_corpus_version ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  base_activation_id TEXT NOT NULL
    CHECK (base_activation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$'),
  base_universe_archive_set_sha256 VARCHAR(64) NOT NULL
    CHECK (base_universe_archive_set_sha256 ~ '^[a-f0-9]{64}$'),
  base_address_set_sha256 VARCHAR(64) NOT NULL
    CHECK (base_address_set_sha256 ~ '^[a-f0-9]{64}$'),
  base_relationship_input_set_sha256 VARCHAR(64) NOT NULL
    CHECK (base_relationship_input_set_sha256 ~ '^[a-f0-9]{64}$'),
  base_graph_archive_set_sha256 VARCHAR(64) NOT NULL
    CHECK (base_graph_archive_set_sha256 ~ '^[a-f0-9]{64}$'),
  target_universe_archive_set_sha256 VARCHAR(64) NOT NULL
    CHECK (target_universe_archive_set_sha256 ~ '^[a-f0-9]{64}$'),
  target_address_set_sha256 VARCHAR(64) NOT NULL
    CHECK (target_address_set_sha256 ~ '^[a-f0-9]{64}$'),
  target_relationship_input_set_sha256 VARCHAR(64) NOT NULL
    CHECK (target_relationship_input_set_sha256 ~ '^[a-f0-9]{64}$'),
  incident_index_root_sha256 VARCHAR(64) NOT NULL
    CHECK (incident_index_root_sha256 ~ '^[a-f0-9]{64}$'),
  source_diff_receipt_sha256 VARCHAR(64) NOT NULL
    CHECK (source_diff_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  watermark_id TEXT NOT NULL UNIQUE
    CHECK (watermark_id ~ '^watermark:[a-f0-9]{64}$'),
  watermark_sequence BIGINT NOT NULL CHECK (watermark_sequence >= 1),
  previous_watermark_id TEXT
    CHECK (previous_watermark_id IS NULL OR previous_watermark_id ~ '^watermark:[a-f0-9]{64}$'),
  source_cursor TEXT NOT NULL CHECK (source_cursor <> ''),
  change_set_sha256 VARCHAR(64) NOT NULL
    CHECK (change_set_sha256 ~ '^[a-f0-9]{64}$'),
  base_record_count BIGINT NOT NULL CHECK (base_record_count >= 0),
  target_record_count BIGINT NOT NULL CHECK (target_record_count >= 0),
  change_count BIGINT NOT NULL CHECK (change_count >= 0),
  insert_count BIGINT NOT NULL CHECK (insert_count >= 0),
  update_count BIGINT NOT NULL CHECK (update_count >= 0),
  delete_count BIGINT NOT NULL CHECK (delete_count >= 0),
  batch_count INTEGER NOT NULL CHECK (batch_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (plan_id, from_snapshot_id, to_snapshot_id),
  UNIQUE (to_corpus_version, watermark_sequence),
  FOREIGN KEY (previous_watermark_id)
    REFERENCES public.uap_case_graph_incremental_plans(watermark_id)
    ON DELETE RESTRICT,
  CHECK (from_snapshot_id <> to_snapshot_id),
  CHECK (plan_id = 'plan:' || plan_sha256),
  CHECK (
    plan_artifact_key =
      'case-vortex/incremental/case-vortex-incremental-archive-v1/'
      || to_corpus_version || '/' || to_snapshot_id::text || '/'
      || substring(plan_id FROM 6) || '/plan.json'
  ),
  CHECK (
    (watermark_sequence = 1 AND previous_watermark_id IS NULL)
    OR (watermark_sequence > 1 AND previous_watermark_id IS NOT NULL)
  ),
  CHECK (insert_count + update_count + delete_count = change_count),
  CHECK (target_record_count = base_record_count + insert_count - delete_count),
  CHECK (change_count = 0 OR batch_count > 0),
  CHECK (change_count > 0 OR batch_count = 0)
);

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_incremental_plans_target
  ON public.uap_case_graph_incremental_plans (
    to_snapshot_id,
    watermark_sequence,
    plan_id COLLATE "C"
  );

CREATE OR REPLACE FUNCTION public.uap_case_graph_incremental_plan_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'case-graph incremental plan receipts are immutable';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_incremental_plan_guard
  ON public.uap_case_graph_incremental_plans;
CREATE TRIGGER trg_uap_case_graph_incremental_plan_guard
BEFORE UPDATE OR DELETE ON public.uap_case_graph_incremental_plans
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_incremental_plan_guard();

CREATE OR REPLACE FUNCTION public.uap_case_graph_incremental_plan_snapshot_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_from_component_count BIGINT;
  v_from_record_count BIGINT;
  v_to_component_count BIGINT;
  v_to_record_count BIGINT;
  v_previous_plan_count BIGINT;
BEGIN
  SELECT COUNT(*)::bigint, COALESCE(SUM(component.row_count), 0)::bigint
  INTO v_from_component_count, v_from_record_count
  FROM public.uap_evidence_universe_snapshots AS snapshot
  JOIN public.uap_evidence_universe_snapshot_components AS component
    ON component.snapshot_id = snapshot.id
  WHERE snapshot.id = NEW.from_snapshot_id
    AND snapshot.snapshot_policy = 'evidence-universe-materialized-v1'
    AND snapshot.source_mvcc_snapshot ~ '^[0-9]+:[0-9]+:([0-9]+(,[0-9]+)*)?$'
    AND component.status = 'complete'
    AND (
      (
        component.entity_kind = 'sighting'
        AND component.capture_policy = 'publishable-public-v2-materialized-v1'
      )
      OR (
        component.entity_kind IN ('document', 'photo', 'video')
        AND component.capture_policy = 'catalogue-materialized-v1'
      )
    );

  SELECT COUNT(*)::bigint, COALESCE(SUM(component.row_count), 0)::bigint
  INTO v_to_component_count, v_to_record_count
  FROM public.uap_evidence_universe_snapshots AS snapshot
  JOIN public.uap_evidence_universe_snapshot_components AS component
    ON component.snapshot_id = snapshot.id
  WHERE snapshot.id = NEW.to_snapshot_id
    AND snapshot.snapshot_policy = 'evidence-universe-materialized-v1'
    AND snapshot.source_mvcc_snapshot ~ '^[0-9]+:[0-9]+:([0-9]+(,[0-9]+)*)?$'
    AND component.status = 'complete'
    AND (
      (
        component.entity_kind = 'sighting'
        AND component.capture_policy = 'publishable-public-v2-materialized-v1'
      )
      OR (
        component.entity_kind IN ('document', 'photo', 'video')
        AND component.capture_policy = 'catalogue-materialized-v1'
      )
    );

  IF v_from_component_count <> 4
    OR v_to_component_count <> 4
    OR v_from_record_count <> NEW.base_record_count
    OR v_to_record_count <> NEW.target_record_count
  THEN
    RAISE EXCEPTION 'case-graph incremental plan snapshot lineage is incomplete or inconsistent';
  END IF;

  IF NEW.watermark_sequence > 1 THEN
    SELECT COUNT(*)::bigint
    INTO v_previous_plan_count
    FROM public.uap_case_graph_incremental_plans AS previous_plan
    WHERE previous_plan.watermark_id = NEW.previous_watermark_id
      AND previous_plan.watermark_sequence = NEW.watermark_sequence - 1
      AND previous_plan.to_snapshot_id = NEW.from_snapshot_id
      AND previous_plan.to_corpus_version = NEW.from_corpus_version;

    IF v_previous_plan_count <> 1 THEN
      RAISE EXCEPTION 'case-graph incremental watermark chain is incomplete or inconsistent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_incremental_plan_snapshot_guard
  ON public.uap_case_graph_incremental_plans;
CREATE TRIGGER trg_uap_case_graph_incremental_plan_snapshot_guard
BEFORE INSERT ON public.uap_case_graph_incremental_plans
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_incremental_plan_snapshot_guard();

CREATE TABLE IF NOT EXISTS public.uap_case_graph_incremental_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL,
  from_snapshot_id UUID NOT NULL
    REFERENCES public.uap_evidence_universe_snapshots(id) ON DELETE RESTRICT,
  to_snapshot_id UUID NOT NULL
    REFERENCES public.uap_evidence_universe_snapshots(id) ON DELETE RESTRICT,
  batch_id TEXT NOT NULL
    CHECK (batch_id ~ '^batch:[a-f0-9]{64}$'),
  batch_ordinal INTEGER NOT NULL CHECK (batch_ordinal >= 0),
  change_id TEXT NOT NULL
    CHECK (change_id ~ '^change:[a-f0-9]{64}$'),
  change_ordinal BIGINT NOT NULL CHECK (change_ordinal >= 0),
  address TEXT COLLATE "C" NOT NULL,
  entity_kind TEXT NOT NULL
    CHECK (entity_kind IN ('sighting', 'document', 'photo', 'video')),
  entity_id TEXT COLLATE "C" NOT NULL CHECK (entity_id <> ''),
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  source_updated_at TIMESTAMPTZ,
  input_sha256 VARCHAR(64) NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  error_code TEXT
    CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9][a-z0-9._:-]{0,239}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_uap_case_graph_incremental_queue_plan
    FOREIGN KEY (plan_id, from_snapshot_id, to_snapshot_id)
    REFERENCES public.uap_case_graph_incremental_plans(plan_id, from_snapshot_id, to_snapshot_id)
    ON DELETE RESTRICT,
  UNIQUE (plan_id, address),
  UNIQUE (plan_id, change_id),
  UNIQUE (plan_id, change_ordinal),
  UNIQUE (from_snapshot_id, to_snapshot_id, address),
  CHECK (from_snapshot_id <> to_snapshot_id),
  CHECK (address = entity_kind || ':' || entity_id),
  CHECK (
    (status = 'leased' AND lease_token IS NOT NULL AND leased_until IS NOT NULL)
    OR (status <> 'leased' AND lease_token IS NULL AND leased_until IS NULL)
  ),
  CHECK (status <> 'failed' OR error_code IS NOT NULL),
  CHECK (status <> 'leased' OR error_code IS NULL),
  CHECK (status <> 'completed' OR error_code IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_incremental_queue_claim
  ON public.uap_case_graph_incremental_queue (status, next_attempt_at, source_updated_at, address COLLATE "C")
  WHERE status IN ('queued', 'leased');
CREATE INDEX IF NOT EXISTS idx_uap_case_graph_incremental_queue_target
  ON public.uap_case_graph_incremental_queue (
    to_snapshot_id,
    status,
    batch_ordinal,
    change_ordinal,
    address COLLATE "C"
  );

CREATE INDEX IF NOT EXISTS idx_uap_case_graph_incremental_queue_plan
  ON public.uap_case_graph_incremental_queue (
    plan_id COLLATE "C",
    batch_ordinal,
    change_ordinal
  );

CREATE OR REPLACE FUNCTION public.uap_case_graph_incremental_queue_plan_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plan_count BIGINT;
BEGIN
  SELECT COUNT(*)::bigint
  INTO v_plan_count
  FROM public.uap_case_graph_incremental_plans AS plan
  WHERE plan.plan_id = NEW.plan_id
    AND plan.from_snapshot_id = NEW.from_snapshot_id
    AND plan.to_snapshot_id = NEW.to_snapshot_id
    AND NEW.change_ordinal < plan.change_count
    AND NEW.batch_ordinal < plan.batch_count;

  IF v_plan_count <> 1 THEN
    RAISE EXCEPTION 'case-graph incremental queue row is outside its immutable plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_incremental_queue_plan_guard
  ON public.uap_case_graph_incremental_queue;
CREATE TRIGGER trg_uap_case_graph_incremental_queue_plan_guard
BEFORE INSERT ON public.uap_case_graph_incremental_queue
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_incremental_queue_plan_guard();

CREATE OR REPLACE FUNCTION public.uap_case_graph_incremental_queue_identity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'case-graph incremental queue receipts are immutable';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.from_snapshot_id IS DISTINCT FROM OLD.from_snapshot_id
    OR NEW.to_snapshot_id IS DISTINCT FROM OLD.to_snapshot_id
    OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
    OR NEW.batch_ordinal IS DISTINCT FROM OLD.batch_ordinal
    OR NEW.change_id IS DISTINCT FROM OLD.change_id
    OR NEW.change_ordinal IS DISTINCT FROM OLD.change_ordinal
    OR NEW.address IS DISTINCT FROM OLD.address
    OR NEW.entity_kind IS DISTINCT FROM OLD.entity_kind
    OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
    OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.source_updated_at IS DISTINCT FROM OLD.source_updated_at
    OR NEW.input_sha256 IS DISTINCT FROM OLD.input_sha256
  THEN
    RAISE EXCEPTION 'case-graph incremental queue identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_incremental_queue_identity_guard
  ON public.uap_case_graph_incremental_queue;
CREATE TRIGGER trg_uap_case_graph_incremental_queue_identity_guard
BEFORE UPDATE OR DELETE ON public.uap_case_graph_incremental_queue
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_incremental_queue_identity_guard();

DROP TRIGGER IF EXISTS uap_case_graph_incremental_queue_touch_updated_at_trg
  ON public.uap_case_graph_incremental_queue;
CREATE TRIGGER uap_case_graph_incremental_queue_touch_updated_at_trg
BEFORE UPDATE ON public.uap_case_graph_incremental_queue
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_touch_updated_at();

-- Plans and their queue rows are inserted in one transaction. This deferred
-- constraint closes the gap where a valid plan receipt could otherwise commit
-- with a truncated change list or batch topology.
CREATE OR REPLACE FUNCTION public.uap_case_graph_incremental_plan_queue_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_change_count BIGINT;
  v_insert_count BIGINT;
  v_update_count BIGINT;
  v_delete_count BIGINT;
  v_change_ordinal_count BIGINT;
  v_min_change_ordinal BIGINT;
  v_max_change_ordinal BIGINT;
  v_batch_ordinal_count BIGINT;
  v_batch_id_count BIGINT;
  v_batch_pair_count BIGINT;
  v_min_batch_ordinal INTEGER;
  v_max_batch_ordinal INTEGER;
BEGIN
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE queue.action = 'insert')::bigint,
    COUNT(*) FILTER (WHERE queue.action = 'update')::bigint,
    COUNT(*) FILTER (WHERE queue.action = 'delete')::bigint,
    COUNT(DISTINCT queue.change_ordinal)::bigint,
    MIN(queue.change_ordinal),
    MAX(queue.change_ordinal),
    COUNT(DISTINCT queue.batch_ordinal)::bigint,
    COUNT(DISTINCT queue.batch_id)::bigint,
    COUNT(DISTINCT (queue.batch_ordinal, queue.batch_id))::bigint,
    MIN(queue.batch_ordinal),
    MAX(queue.batch_ordinal)
  INTO
    v_change_count,
    v_insert_count,
    v_update_count,
    v_delete_count,
    v_change_ordinal_count,
    v_min_change_ordinal,
    v_max_change_ordinal,
    v_batch_ordinal_count,
    v_batch_id_count,
    v_batch_pair_count,
    v_min_batch_ordinal,
    v_max_batch_ordinal
  FROM public.uap_case_graph_incremental_queue AS queue
  WHERE queue.plan_id = NEW.plan_id;

  IF v_change_count <> NEW.change_count
    OR v_insert_count <> NEW.insert_count
    OR v_update_count <> NEW.update_count
    OR v_delete_count <> NEW.delete_count
    OR v_change_ordinal_count <> NEW.change_count
    OR v_batch_ordinal_count <> NEW.batch_count
    OR v_batch_id_count <> NEW.batch_count
    OR v_batch_pair_count <> NEW.batch_count
    OR (
      NEW.change_count = 0
      AND (
        v_min_change_ordinal IS NOT NULL
        OR v_max_change_ordinal IS NOT NULL
        OR v_min_batch_ordinal IS NOT NULL
        OR v_max_batch_ordinal IS NOT NULL
      )
    )
    OR (
      NEW.change_count > 0
      AND (
        v_min_change_ordinal <> 0
        OR v_max_change_ordinal <> NEW.change_count - 1
        OR v_min_batch_ordinal <> 0
        OR v_max_batch_ordinal <> NEW.batch_count - 1
      )
    )
  THEN
    RAISE EXCEPTION 'case-graph incremental plan queue coverage is incomplete or inconsistent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_incremental_plan_queue_guard
  ON public.uap_case_graph_incremental_plans;
CREATE CONSTRAINT TRIGGER trg_uap_case_graph_incremental_plan_queue_guard
AFTER INSERT ON public.uap_case_graph_incremental_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_incremental_plan_queue_guard();

CREATE OR REPLACE FUNCTION public.claim_uap_case_graph_incremental_jobs(
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  id UUID,
  plan_id TEXT,
  plan_sha256 VARCHAR(64),
  plan_artifact_key TEXT,
  watermark_id TEXT,
  to_corpus_version TEXT,
  target_universe_archive_set_sha256 VARCHAR(64),
  target_relationship_input_set_sha256 VARCHAR(64),
  source_diff_receipt_sha256 VARCHAR(64),
  from_snapshot_id UUID,
  to_snapshot_id UUID,
  batch_id TEXT,
  batch_ordinal INTEGER,
  change_id TEXT,
  change_ordinal BIGINT,
  address TEXT,
  entity_kind TEXT,
  entity_id TEXT,
  action TEXT,
  source_updated_at TIMESTAMPTZ,
  input_sha256 VARCHAR(64),
  status TEXT,
  attempt_count INTEGER,
  next_attempt_at TIMESTAMPTZ,
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'case-graph incremental claim limit is invalid';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'case-graph incremental lease is invalid';
  END IF;

  RETURN QUERY
  WITH claimable AS MATERIALIZED (
    SELECT
      queue.id,
      plan.plan_sha256,
      plan.plan_artifact_key,
      plan.watermark_id,
      plan.to_corpus_version,
      plan.target_universe_archive_set_sha256,
      plan.target_relationship_input_set_sha256,
      plan.source_diff_receipt_sha256
    FROM public.uap_case_graph_incremental_queue AS queue
    JOIN public.uap_case_graph_incremental_plans AS plan
      ON plan.plan_id = queue.plan_id
    WHERE (
      (
        queue.status = 'queued'
        AND queue.next_attempt_at <= clock_timestamp()
      ) OR (
        queue.status = 'leased'
        AND queue.leased_until < clock_timestamp()
      )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.uap_case_graph_incremental_plans AS prior_plan
        JOIN public.uap_case_graph_incremental_queue AS prior_plan_queue
          ON prior_plan_queue.plan_id = prior_plan.plan_id
        WHERE prior_plan.watermark_id = plan.previous_watermark_id
          AND prior_plan_queue.status <> 'completed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.uap_case_graph_incremental_queue AS prior_batch
        WHERE prior_batch.plan_id = queue.plan_id
          AND prior_batch.batch_ordinal < queue.batch_ordinal
          AND prior_batch.status <> 'completed'
      )
    ORDER BY
      plan.watermark_sequence,
      queue.batch_ordinal,
      queue.change_ordinal,
      queue.address COLLATE "C"
    FOR UPDATE OF queue SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.uap_case_graph_incremental_queue AS queue
  SET
    status = 'leased',
    attempt_count = queue.attempt_count + 1,
    lease_token = gen_random_uuid(),
    leased_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
    error_code = NULL,
    updated_at = clock_timestamp()
  FROM claimable
  WHERE queue.id = claimable.id
  RETURNING
    queue.id,
    queue.plan_id,
    claimable.plan_sha256,
    claimable.plan_artifact_key,
    claimable.watermark_id,
    claimable.to_corpus_version,
    claimable.target_universe_archive_set_sha256,
    claimable.target_relationship_input_set_sha256,
    claimable.source_diff_receipt_sha256,
    queue.from_snapshot_id,
    queue.to_snapshot_id,
    queue.batch_id,
    queue.batch_ordinal,
    queue.change_id,
    queue.change_ordinal,
    queue.address,
    queue.entity_kind,
    queue.entity_id,
    queue.action,
    queue.source_updated_at,
    queue.input_sha256,
    queue.status,
    queue.attempt_count,
    queue.next_attempt_at,
    queue.lease_token,
    queue.leased_until,
    queue.error_code,
    queue.created_at,
    queue.updated_at;
END;
$$;

CREATE TABLE IF NOT EXISTS public.uap_case_graph_publication_receipts (
  publication_id UUID PRIMARY KEY
    REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  receipt_version TEXT NOT NULL CHECK (receipt_version = 'case-vortex-publication-receipt-v2'),
  snapshot_id UUID NOT NULL
    REFERENCES public.uap_evidence_universe_snapshots(id) ON DELETE RESTRICT,
  universe_archive_set_sha256 VARCHAR(64) NOT NULL
    CHECK (universe_archive_set_sha256 ~ '^[a-f0-9]{64}$'),
  feature_archive_set_sha256 VARCHAR(64) NOT NULL
    CHECK (feature_archive_set_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_input_archive_set_sha256 VARCHAR(64) NOT NULL
    CHECK (relationship_input_archive_set_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_input_manifest_digest VARCHAR(64) NOT NULL
    CHECK (relationship_input_manifest_digest ~ '^[a-f0-9]{64}$'),
  relationship_policy_version TEXT NOT NULL
    CHECK (relationship_policy_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  relationship_policy_sha256 VARCHAR(64) NOT NULL
    CHECK (relationship_policy_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_model_id TEXT NOT NULL
    CHECK (relationship_model_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  relationship_model_version TEXT NOT NULL
    CHECK (relationship_model_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  relationship_schema_version TEXT NOT NULL
    CHECK (relationship_schema_version = 'case-graph-typed-relationship-v2'),
  relationship_model_sha256 VARCHAR(64) NOT NULL
    CHECK (relationship_model_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_run_index_digest VARCHAR(64) NOT NULL
    CHECK (relationship_run_index_digest ~ '^[a-f0-9]{64}$'),
  relationship_run_artifact_set_sha256 VARCHAR(64) NOT NULL
    CHECK (relationship_run_artifact_set_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_completion_digest VARCHAR(64) NOT NULL
    CHECK (relationship_completion_digest ~ '^[a-f0-9]{64}$'),
  pair_calibration_id TEXT NOT NULL
    CHECK (pair_calibration_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  pair_calibration_sha256 VARCHAR(64) NOT NULL
    CHECK (pair_calibration_sha256 ~ '^[a-f0-9]{64}$'),
  contextual_calibration_id TEXT NOT NULL
    CHECK (contextual_calibration_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  contextual_calibration_sha256 VARCHAR(64) NOT NULL
    CHECK (contextual_calibration_sha256 ~ '^[a-f0-9]{64}$'),
  calibration_set_sha256 VARCHAR(64) NOT NULL
    CHECK (calibration_set_sha256 ~ '^[a-f0-9]{64}$'),
  graph_artifact_set_sha256 VARCHAR(64) NOT NULL
    CHECK (graph_artifact_set_sha256 ~ '^[a-f0-9]{64}$'),
  corpus_accounting_digest VARCHAR(64) NOT NULL
    CHECK (corpus_accounting_digest ~ '^[a-f0-9]{64}$'),
  public_manifest_sha256 VARCHAR(64) NOT NULL
    CHECK (public_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  completion_manifest_key TEXT COLLATE "C" NOT NULL
    CHECK (completion_manifest_key <> ''),
  completion_manifest_sha256 VARCHAR(64) NOT NULL
    CHECK (completion_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  universe_record_count BIGINT NOT NULL CHECK (universe_record_count >= 0),
  sighting_record_count BIGINT NOT NULL CHECK (sighting_record_count >= 0),
  document_record_count BIGINT NOT NULL CHECK (document_record_count >= 0),
  photo_record_count BIGINT NOT NULL CHECK (photo_record_count >= 0),
  video_record_count BIGINT NOT NULL CHECK (video_record_count >= 0),
  relationship_input_record_count BIGINT NOT NULL CHECK (relationship_input_record_count >= 0),
  graph_record_count BIGINT NOT NULL CHECK (graph_record_count >= 0),
  user_interface_record_count BIGINT NOT NULL CHECK (user_interface_record_count >= 0),
  represented_record_count BIGINT NOT NULL CHECK (represented_record_count >= 0),
  excluded_record_count BIGINT NOT NULL CHECK (excluded_record_count >= 0),
  observed_record_count BIGINT NOT NULL CHECK (observed_record_count >= 0),
  candidate_pair_count BIGINT NOT NULL CHECK (candidate_pair_count >= 0),
  typed_edge_count BIGINT NOT NULL CHECK (typed_edge_count >= 0),
  skipped_group_count BIGINT NOT NULL CHECK (skipped_group_count >= 0),
  skipped_estimated_pair_count BIGINT NOT NULL CHECK (skipped_estimated_pair_count >= 0),
  linked_address_count BIGINT NOT NULL CHECK (linked_address_count >= 0),
  candidate_only_address_count BIGINT NOT NULL CHECK (candidate_only_address_count >= 0),
  isolated_address_count BIGINT NOT NULL CHECK (isolated_address_count >= 0),
  typed_edge_type_counts JSONB NOT NULL,
  address_ledger_set_sha256 VARCHAR(64) NOT NULL
    CHECK (address_ledger_set_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_accounting JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    sighting_record_count
      + document_record_count
      + photo_record_count
      + video_record_count = universe_record_count
  ),
  CHECK (relationship_input_record_count = universe_record_count),
  CHECK (graph_record_count = universe_record_count),
  CHECK (user_interface_record_count = universe_record_count),
  CHECK (represented_record_count = universe_record_count),
  CHECK (represented_record_count + excluded_record_count = observed_record_count),
  CHECK (pair_calibration_id <> contextual_calibration_id),
  CHECK (
    linked_address_count + candidate_only_address_count + isolated_address_count
      = universe_record_count
  ),
  CHECK (
    public.uap_case_graph_typed_edge_type_counts_valid(
      typed_edge_type_counts,
      typed_edge_count
    )
  ),
  CHECK (public.uap_case_graph_relationship_accounting_valid(relationship_accounting)),
  CHECK (
    relationship_accounting = jsonb_build_object(
      'universe_record_count', universe_record_count,
      'address_kind_counts', jsonb_build_object(
        'sighting', sighting_record_count,
        'document', document_record_count,
        'photo', photo_record_count,
        'video', video_record_count
      ),
      'candidate_pair_count', candidate_pair_count,
      'typed_edge_count', typed_edge_count,
      'typed_edge_type_counts', typed_edge_type_counts,
      'skipped_group_count', skipped_group_count,
      'skipped_estimated_pair_count', skipped_estimated_pair_count,
      'relationship_status_counts', jsonb_build_object(
        'linked', linked_address_count,
        'candidate_only', candidate_only_address_count,
        'isolated', isolated_address_count
      ),
      'address_ledger_set_sha256', address_ledger_set_sha256
    )
  )
);

-- This additive form makes local reapplication of the evolving, unreleased
-- migration converge on the same required receipt shape as a clean install.
ALTER TABLE public.uap_case_graph_publication_receipts
  ADD COLUMN IF NOT EXISTS relationship_model_sha256 VARCHAR(64) NOT NULL
    CHECK (relationship_model_sha256 ~ '^[a-f0-9]{64}$');

ALTER TABLE public.uap_case_graph_publication_receipts
  ADD COLUMN IF NOT EXISTS relationship_schema_version TEXT NOT NULL
    DEFAULT 'case-graph-typed-relationship-v2'
    CHECK (relationship_schema_version = 'case-graph-typed-relationship-v2');
ALTER TABLE public.uap_case_graph_publication_receipts
  ALTER COLUMN relationship_schema_version DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.uap_case_graph_publication_receipt_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'case-graph publication receipts are immutable';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_publication_receipt_guard
  ON public.uap_case_graph_publication_receipts;
CREATE TRIGGER trg_uap_case_graph_publication_receipt_guard
BEFORE UPDATE OR DELETE ON public.uap_case_graph_publication_receipts
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_publication_receipt_guard();

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
    RAISE EXCEPTION 'case-graph publications may only be activated by the guarded v2 function';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_case_graph_publication_activation_guard
  ON public.uap_case_graph_publications;
CREATE TRIGGER trg_uap_case_graph_publication_activation_guard
BEFORE INSERT OR UPDATE ON public.uap_case_graph_publications
FOR EACH ROW
EXECUTE FUNCTION public.uap_case_graph_publication_activation_guard();

CREATE OR REPLACE FUNCTION public.activate_uap_case_graph_publication_v2(
  p_publication_id UUID,
  p_public_manifest_sha256 TEXT,
  p_completion_manifest_sha256 TEXT,
  p_corpus_accounting_digest TEXT,
  p_relationship_completion_digest TEXT,
  p_relationship_run_index_digest TEXT,
  p_relationship_run_artifact_set_sha256 TEXT,
  p_relationship_policy_sha256 TEXT,
  p_relationship_model_version TEXT,
  p_pair_calibration_id TEXT,
  p_pair_calibration_sha256 TEXT,
  p_contextual_calibration_id TEXT,
  p_contextual_calibration_sha256 TEXT,
  p_calibration_set_sha256 TEXT,
  p_graph_artifact_set_sha256 TEXT,
  p_relationship_accounting JSONB
)
RETURNS TABLE (
  publication_id UUID,
  corpus_version TEXT,
  activated_at TIMESTAMPTZ,
  completion_manifest_key TEXT,
  completion_manifest_sha256 TEXT,
  relationship_completion_digest TEXT,
  relationship_run_index_digest TEXT,
  relationship_run_artifact_set_sha256 TEXT,
  pair_calibration_id TEXT,
  pair_calibration_sha256 TEXT,
  contextual_calibration_id TEXT,
  contextual_calibration_sha256 TEXT,
  calibration_set_sha256 TEXT,
  relationship_accounting JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_candidate RECORD;
  v_ledger RECORD;
  v_activated_at TIMESTAMPTZ;
BEGIN
  IF NOT ((
    p_publication_id IS NOT NULL
    AND p_public_manifest_sha256 ~ '^[a-f0-9]{64}$'
    AND p_completion_manifest_sha256 ~ '^[a-f0-9]{64}$'
    AND p_corpus_accounting_digest ~ '^[a-f0-9]{64}$'
    AND p_relationship_completion_digest ~ '^[a-f0-9]{64}$'
    AND p_relationship_run_index_digest ~ '^[a-f0-9]{64}$'
    AND p_relationship_run_artifact_set_sha256 ~ '^[a-f0-9]{64}$'
    AND p_relationship_policy_sha256 ~ '^[a-f0-9]{64}$'
    AND p_relationship_model_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
    AND p_pair_calibration_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
    AND p_pair_calibration_sha256 ~ '^[a-f0-9]{64}$'
    AND p_contextual_calibration_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
    AND p_contextual_calibration_sha256 ~ '^[a-f0-9]{64}$'
    AND p_pair_calibration_id <> p_contextual_calibration_id
    AND p_calibration_set_sha256 ~ '^[a-f0-9]{64}$'
    AND p_graph_artifact_set_sha256 ~ '^[a-f0-9]{64}$'
    AND public.uap_case_graph_relationship_accounting_valid(
      p_relationship_accounting
    )
  ) IS TRUE) THEN
    RAISE EXCEPTION 'case-graph publication activation receipt is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('uap-case-graph-publication-v2', 0));

  SELECT
    publication.id,
    publication.corpus_version,
    publication.public_manifest_key,
    publication.public_manifest_sha256,
    run.id AS run_id,
    run.corpus_version AS run_corpus_version,
    run.status AS run_status,
    run.lineage_version,
    run.snapshot_id,
    run.snapshot_policy,
    run.source_snapshot_at,
    run.snapshot_materialized_at,
    run.source_mvcc_snapshot,
    run.universe_archive_set_sha256,
    run.feature_archive_set_sha256,
    run.relationship_input_archive_set_sha256,
    run.relationship_input_manifest_digest,
    run.relationship_input_record_count,
    run.universe_record_count,
    run.processed_eligible_count AS run_relationship_processed_count,
    run.excluded_count AS run_relationship_not_applicable_count,
    run.relationship_policy_version,
    run.relationship_policy_sha256,
    run.relationship_model_id,
    run.relationship_model_version,
    run.relationship_schema_version,
    run.relationship_model_sha256,
    run.relationship_run_index_digest,
    run.relationship_run_artifact_set_sha256,
    run.relationship_completion_digest,
    run.pair_calibration_id,
    run.pair_calibration_sha256,
    run.contextual_calibration_id,
    run.contextual_calibration_sha256,
    run.calibration_set_sha256,
    run.graph_artifact_set_sha256,
    run.corpus_accounting_digest,
    run.completion_manifest_key AS run_completion_manifest_key,
    run.completion_manifest_sha256 AS run_completion_manifest_sha256,
    run.candidate_pair_count,
    run.typed_edge_count,
    run.skipped_group_count,
    run.skipped_estimated_pair_count,
    run.linked_address_count,
    run.candidate_only_address_count,
    run.isolated_address_count,
    run.sighting_record_count,
    run.document_record_count,
    run.photo_record_count,
    run.video_record_count,
    run.typed_edge_type_counts,
    run.address_ledger_set_sha256,
    run.relationship_accounting,
    run.candidate_count AS legacy_candidate_count,
    run.edge_count AS legacy_edge_count,
    run.isolated_case_count AS legacy_isolated_count,
    snapshot.snapshot_policy AS sealed_snapshot_policy,
    snapshot.source_snapshot_at AS sealed_source_snapshot_at,
    snapshot.materialized_at AS sealed_materialized_at,
    snapshot.source_mvcc_snapshot AS sealed_source_mvcc_snapshot,
    receipt.snapshot_id AS receipt_snapshot_id,
    receipt.universe_archive_set_sha256 AS receipt_universe_archive_set_sha256,
    receipt.feature_archive_set_sha256 AS receipt_feature_archive_set_sha256,
    receipt.relationship_input_archive_set_sha256 AS receipt_relationship_input_archive_set_sha256,
    receipt.relationship_input_manifest_digest AS receipt_relationship_input_manifest_digest,
    receipt.relationship_policy_version AS receipt_relationship_policy_version,
    receipt.relationship_policy_sha256 AS receipt_relationship_policy_sha256,
    receipt.relationship_model_id AS receipt_relationship_model_id,
    receipt.relationship_model_version AS receipt_relationship_model_version,
    receipt.relationship_schema_version AS receipt_relationship_schema_version,
    receipt.relationship_model_sha256 AS receipt_relationship_model_sha256,
    receipt.relationship_run_index_digest AS receipt_relationship_run_index_digest,
    receipt.relationship_run_artifact_set_sha256 AS receipt_relationship_run_artifact_set_sha256,
    receipt.relationship_completion_digest AS receipt_relationship_completion_digest,
    receipt.pair_calibration_id AS receipt_pair_calibration_id,
    receipt.pair_calibration_sha256 AS receipt_pair_calibration_sha256,
    receipt.contextual_calibration_id AS receipt_contextual_calibration_id,
    receipt.contextual_calibration_sha256 AS receipt_contextual_calibration_sha256,
    receipt.calibration_set_sha256 AS receipt_calibration_set_sha256,
    receipt.public_manifest_sha256 AS receipt_public_manifest_sha256,
    receipt.corpus_accounting_digest AS receipt_corpus_accounting_digest,
    receipt.graph_artifact_set_sha256 AS receipt_graph_artifact_set_sha256,
    receipt.completion_manifest_key AS receipt_completion_manifest_key,
    receipt.completion_manifest_sha256 AS receipt_completion_manifest_sha256,
    receipt.candidate_pair_count AS receipt_candidate_pair_count,
    receipt.typed_edge_count AS receipt_typed_edge_count,
    receipt.skipped_group_count AS receipt_skipped_group_count,
    receipt.skipped_estimated_pair_count AS receipt_skipped_estimated_pair_count,
    receipt.linked_address_count AS receipt_linked_address_count,
    receipt.candidate_only_address_count AS receipt_candidate_only_address_count,
    receipt.isolated_address_count AS receipt_isolated_address_count,
    receipt.typed_edge_type_counts AS receipt_typed_edge_type_counts,
    receipt.address_ledger_set_sha256 AS receipt_address_ledger_set_sha256,
    receipt.relationship_accounting AS receipt_relationship_accounting,
    receipt.universe_record_count AS receipt_universe_record_count,
    receipt.relationship_input_record_count AS receipt_relationship_input_record_count,
    receipt.graph_record_count AS receipt_graph_record_count,
    receipt.user_interface_record_count AS receipt_user_interface_record_count,
    receipt.represented_record_count AS receipt_represented_record_count,
    receipt.excluded_record_count AS receipt_relationship_not_applicable_count,
    receipt.observed_record_count AS receipt_observed_record_count,
    receipt.sighting_record_count AS receipt_sighting_record_count,
    receipt.document_record_count AS receipt_document_record_count,
    receipt.photo_record_count AS receipt_photo_record_count,
    receipt.video_record_count AS receipt_video_record_count
  INTO v_candidate
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_runs AS run ON run.id = publication.run_id
  JOIN public.uap_evidence_universe_snapshots AS snapshot ON snapshot.id = run.snapshot_id
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.id = p_publication_id
  FOR UPDATE OF publication, run, snapshot, receipt;

  IF NOT FOUND
    OR v_candidate.run_status <> 'completed'
    OR v_candidate.lineage_version <> 'case-vortex-lineage-v2'
    OR v_candidate.snapshot_id IS NULL
    OR v_candidate.run_corpus_version <> v_candidate.corpus_version
    OR v_candidate.public_manifest_key <>
      'case-vortex/corpora/' || v_candidate.corpus_version || '/publication/public-manifest.json'
    OR v_candidate.run_completion_manifest_key <>
      'case-vortex/corpora/' || v_candidate.corpus_version || '/publication/_candidate.complete.manifest.json'
    OR v_candidate.receipt_completion_manifest_key <> v_candidate.run_completion_manifest_key
    OR v_candidate.run_completion_manifest_sha256 <> p_completion_manifest_sha256
    OR v_candidate.receipt_completion_manifest_sha256 <> p_completion_manifest_sha256
    OR v_candidate.receipt_snapshot_id <> v_candidate.snapshot_id
    OR v_candidate.sealed_snapshot_policy <> v_candidate.snapshot_policy
    OR v_candidate.sealed_source_snapshot_at <> v_candidate.source_snapshot_at
    OR v_candidate.sealed_materialized_at <> v_candidate.snapshot_materialized_at
    OR v_candidate.sealed_source_mvcc_snapshot <> v_candidate.source_mvcc_snapshot
    OR v_candidate.receipt_universe_archive_set_sha256 <> v_candidate.universe_archive_set_sha256
    OR v_candidate.receipt_feature_archive_set_sha256 <> v_candidate.feature_archive_set_sha256
    OR v_candidate.receipt_relationship_input_archive_set_sha256
      <> v_candidate.relationship_input_archive_set_sha256
    OR v_candidate.receipt_relationship_input_manifest_digest
      <> v_candidate.relationship_input_manifest_digest
    OR v_candidate.receipt_relationship_policy_version <> v_candidate.relationship_policy_version
    OR v_candidate.relationship_policy_sha256 <> p_relationship_policy_sha256
    OR v_candidate.receipt_relationship_policy_sha256 <> p_relationship_policy_sha256
    OR v_candidate.receipt_relationship_model_id <> v_candidate.relationship_model_id
    OR v_candidate.relationship_model_version <> p_relationship_model_version
    OR v_candidate.receipt_relationship_model_version <> p_relationship_model_version
    OR v_candidate.receipt_relationship_schema_version
      <> v_candidate.relationship_schema_version
    OR v_candidate.receipt_relationship_model_sha256
      <> v_candidate.relationship_model_sha256
    OR v_candidate.relationship_completion_digest <> p_relationship_completion_digest
    OR v_candidate.receipt_relationship_completion_digest <> p_relationship_completion_digest
    OR v_candidate.relationship_run_index_digest <> p_relationship_run_index_digest
    OR v_candidate.receipt_relationship_run_index_digest <> p_relationship_run_index_digest
    OR v_candidate.relationship_run_artifact_set_sha256
      <> p_relationship_run_artifact_set_sha256
    OR v_candidate.receipt_relationship_run_artifact_set_sha256
      <> p_relationship_run_artifact_set_sha256
    OR v_candidate.pair_calibration_id <> p_pair_calibration_id
    OR v_candidate.receipt_pair_calibration_id <> p_pair_calibration_id
    OR v_candidate.pair_calibration_sha256 <> p_pair_calibration_sha256
    OR v_candidate.receipt_pair_calibration_sha256 <> p_pair_calibration_sha256
    OR v_candidate.contextual_calibration_id <> p_contextual_calibration_id
    OR v_candidate.receipt_contextual_calibration_id <> p_contextual_calibration_id
    OR v_candidate.contextual_calibration_sha256 <> p_contextual_calibration_sha256
    OR v_candidate.receipt_contextual_calibration_sha256 <> p_contextual_calibration_sha256
    OR v_candidate.calibration_set_sha256 <> p_calibration_set_sha256
    OR v_candidate.receipt_calibration_set_sha256 <> p_calibration_set_sha256
    OR v_candidate.public_manifest_sha256 <> p_public_manifest_sha256
    OR v_candidate.receipt_public_manifest_sha256 <> p_public_manifest_sha256
    OR v_candidate.corpus_accounting_digest <> p_corpus_accounting_digest
    OR v_candidate.receipt_corpus_accounting_digest <> p_corpus_accounting_digest
    OR v_candidate.graph_artifact_set_sha256 <> p_graph_artifact_set_sha256
    OR v_candidate.receipt_graph_artifact_set_sha256 <> p_graph_artifact_set_sha256
    OR v_candidate.relationship_accounting IS DISTINCT FROM p_relationship_accounting
    OR v_candidate.receipt_relationship_accounting IS DISTINCT FROM p_relationship_accounting
    OR v_candidate.legacy_candidate_count <> v_candidate.candidate_pair_count
    OR v_candidate.legacy_edge_count <> v_candidate.typed_edge_count
    OR v_candidate.legacy_isolated_count <> v_candidate.isolated_address_count
    OR v_candidate.relationship_input_record_count <> v_candidate.universe_record_count
    OR v_candidate.receipt_relationship_input_record_count <> v_candidate.receipt_universe_record_count
    OR v_candidate.receipt_graph_record_count <> v_candidate.receipt_universe_record_count
    OR v_candidate.receipt_user_interface_record_count <> v_candidate.receipt_universe_record_count
    OR v_candidate.receipt_represented_record_count <> v_candidate.receipt_universe_record_count
    OR v_candidate.run_relationship_processed_count <> v_candidate.universe_record_count
    OR v_candidate.run_relationship_not_applicable_count <> 0
    OR v_candidate.receipt_relationship_not_applicable_count <> 0
    OR v_candidate.receipt_observed_record_count <> v_candidate.receipt_universe_record_count
    OR v_candidate.receipt_universe_record_count <> v_candidate.universe_record_count
  THEN
    RAISE EXCEPTION 'case-graph publication v2 lineage is incomplete or inconsistent';
  END IF;

  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE record_state.entity_kind = 'sighting')::bigint AS sighting,
    COUNT(*) FILTER (WHERE record_state.entity_kind = 'document')::bigint AS document,
    COUNT(*) FILTER (WHERE record_state.entity_kind = 'photo')::bigint AS photo,
    COUNT(*) FILTER (WHERE record_state.entity_kind = 'video')::bigint AS video,
    COUNT(*) FILTER (
      WHERE record_state.relationship_disposition = 'processed'
    )::bigint AS relationship_processed,
    COUNT(*) FILTER (
      WHERE record_state.relationship_disposition = 'not_applicable'
    )::bigint AS relationship_not_applicable
  INTO v_ledger
  FROM public.uap_case_graph_record_state AS record_state
  WHERE record_state.corpus_version = v_candidate.corpus_version
    AND record_state.last_run_id = v_candidate.run_id;

  IF v_ledger.total <> v_candidate.universe_record_count
    OR v_ledger.sighting <> v_candidate.receipt_sighting_record_count
    OR v_ledger.document <> v_candidate.receipt_document_record_count
    OR v_ledger.photo <> v_candidate.receipt_photo_record_count
    OR v_ledger.video <> v_candidate.receipt_video_record_count
    OR v_ledger.relationship_processed <> v_candidate.run_relationship_processed_count
    OR v_ledger.relationship_processed <> v_candidate.receipt_represented_record_count
    OR v_ledger.relationship_not_applicable <> v_candidate.run_relationship_not_applicable_count
    OR v_ledger.relationship_not_applicable <> v_candidate.receipt_relationship_not_applicable_count
  THEN
    RAISE EXCEPTION 'case-graph publication all-record ledger is incomplete';
  END IF;

  -- The advisory lock serializes v2 activations; explicit row locks make the
  -- old-active to new-active transition observable and all-or-nothing even if
  -- an owner-level maintenance transaction is touching publication rows.
  PERFORM publication.id
  FROM public.uap_case_graph_publications AS publication
  WHERE publication.active = true
  ORDER BY publication.id
  FOR UPDATE;

  v_activated_at := clock_timestamp();
  UPDATE public.uap_case_graph_publications
  SET active = false, deactivated_at = v_activated_at
  WHERE active = true AND id <> p_publication_id;

  UPDATE public.uap_case_graph_publications
  SET active = true, activated_at = v_activated_at, deactivated_at = NULL
  WHERE id = p_publication_id;

  RETURN QUERY SELECT
    p_publication_id,
    v_candidate.corpus_version::text,
    v_activated_at,
    v_candidate.run_completion_manifest_key::text,
    v_candidate.run_completion_manifest_sha256::text,
    v_candidate.relationship_completion_digest::text,
    v_candidate.relationship_run_index_digest::text,
    v_candidate.relationship_run_artifact_set_sha256::text,
    v_candidate.pair_calibration_id::text,
    v_candidate.pair_calibration_sha256::text,
    v_candidate.contextual_calibration_id::text,
    v_candidate.contextual_calibration_sha256::text,
    v_candidate.calibration_set_sha256::text,
    v_candidate.relationship_accounting::jsonb;
END;
$$;

REVOKE ALL ON TABLE public.uap_case_graph_record_state FROM PUBLIC;
REVOKE ALL ON TABLE public.uap_case_graph_incremental_plans FROM PUBLIC;
REVOKE ALL ON TABLE public.uap_case_graph_incremental_queue FROM PUBLIC;
REVOKE ALL ON TABLE public.uap_case_graph_publication_receipts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_jsonb_safe_count(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_typed_edge_type_counts_valid(JSONB, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_relationship_accounting_valid(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_uap_case_graph_incremental_jobs(INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_uap_case_graph_publication_v2(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_publication_receipt_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_record_state_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_run_v2_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_incremental_plan_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_incremental_plan_snapshot_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_incremental_plan_queue_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_incremental_queue_plan_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_incremental_queue_identity_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.uap_case_graph_publication_activation_guard() FROM PUBLIC;

ALTER TABLE public.uap_case_graph_record_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_case_graph_incremental_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_case_graph_incremental_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_case_graph_publication_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.uap_case_graph_record_state FROM anon;
    REVOKE ALL ON TABLE public.uap_case_graph_incremental_plans FROM anon;
    REVOKE ALL ON TABLE public.uap_case_graph_incremental_queue FROM anon;
    REVOKE ALL ON TABLE public.uap_case_graph_publication_receipts FROM anon;
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_jsonb_safe_count(JSONB) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_typed_edge_type_counts_valid(JSONB, BIGINT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_relationship_accounting_valid(JSONB) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.claim_uap_case_graph_incremental_jobs(INTEGER, INTEGER) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.activate_uap_case_graph_publication_v2(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.uap_case_graph_record_state FROM authenticated;
    REVOKE ALL ON TABLE public.uap_case_graph_incremental_plans FROM authenticated;
    REVOKE ALL ON TABLE public.uap_case_graph_incremental_queue FROM authenticated;
    REVOKE ALL ON TABLE public.uap_case_graph_publication_receipts FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_jsonb_safe_count(JSONB) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_typed_edge_type_counts_valid(JSONB, BIGINT) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.uap_case_graph_relationship_accounting_valid(JSONB) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.claim_uap_case_graph_incremental_jobs(INTEGER, INTEGER) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.activate_uap_case_graph_publication_v2(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON TABLE public.uap_case_graph_record_state TO service_role;
    GRANT SELECT, INSERT ON TABLE public.uap_case_graph_incremental_plans TO service_role;
    REVOKE DELETE ON TABLE public.uap_case_graph_incremental_queue FROM service_role;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.uap_case_graph_incremental_queue TO service_role;
    GRANT SELECT, INSERT ON TABLE public.uap_case_graph_publication_receipts TO service_role;
    GRANT EXECUTE ON FUNCTION public.uap_case_graph_jsonb_safe_count(JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.uap_case_graph_typed_edge_type_counts_valid(JSONB, BIGINT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.uap_case_graph_relationship_accounting_valid(JSONB)
      TO service_role;

    -- Preserve legacy-run progress updates while removing broad mutation and
    -- deletion rights. The v2 immutability trigger still rejects every UPDATE
    -- or DELETE against a lineage-v2 row, including owner-level maintenance.
    REVOKE UPDATE, DELETE ON TABLE public.uap_case_graph_runs FROM service_role;
    GRANT UPDATE (
      status,
      processed_eligible_count,
      excluded_count,
      candidate_count,
      edge_count,
      isolated_case_count,
      shard_count,
      feature_cursor_updated_at,
      feature_cursor_sighting_id,
      completion_manifest_key,
      completion_manifest_sha256,
      error_code,
      error_detail,
      metadata,
      updated_at,
      completed_at
    ) ON public.uap_case_graph_runs TO service_role;

    DROP POLICY IF EXISTS service_role_manage_uap_case_graph_publications
      ON public.uap_case_graph_publications;
    DROP POLICY IF EXISTS service_role_manage_uap_case_graph_runs
      ON public.uap_case_graph_runs;
    REVOKE UPDATE, DELETE ON TABLE public.uap_case_graph_publications FROM service_role;
    GRANT SELECT, INSERT ON TABLE public.uap_case_graph_publications TO service_role;

    DROP POLICY IF EXISTS service_role_read_insert_uap_case_graph_record_state
      ON public.uap_case_graph_record_state;
    DROP POLICY IF EXISTS service_role_read_insert_uap_case_graph_incremental_plans
      ON public.uap_case_graph_incremental_plans;
    DROP POLICY IF EXISTS service_role_manage_uap_case_graph_incremental_queue
      ON public.uap_case_graph_incremental_queue;
    DROP POLICY IF EXISTS service_role_read_insert_uap_case_graph_publication_receipts
      ON public.uap_case_graph_publication_receipts;
    DROP POLICY IF EXISTS service_role_read_insert_uap_case_graph_publications
      ON public.uap_case_graph_publications;
    DROP POLICY IF EXISTS service_role_read_uap_case_graph_runs
      ON public.uap_case_graph_runs;
    DROP POLICY IF EXISTS service_role_insert_uap_case_graph_runs
      ON public.uap_case_graph_runs;
    DROP POLICY IF EXISTS service_role_update_legacy_uap_case_graph_runs
      ON public.uap_case_graph_runs;
    CREATE POLICY service_role_read_insert_uap_case_graph_record_state
      ON public.uap_case_graph_record_state FOR ALL TO service_role
      USING (true) WITH CHECK (true);
    CREATE POLICY service_role_read_insert_uap_case_graph_incremental_plans
      ON public.uap_case_graph_incremental_plans FOR ALL TO service_role
      USING (true) WITH CHECK (true);
    CREATE POLICY service_role_manage_uap_case_graph_incremental_queue
      ON public.uap_case_graph_incremental_queue FOR ALL TO service_role
      USING (true) WITH CHECK (true);
    CREATE POLICY service_role_read_insert_uap_case_graph_publication_receipts
      ON public.uap_case_graph_publication_receipts FOR ALL TO service_role
      USING (true) WITH CHECK (true);
    CREATE POLICY service_role_read_insert_uap_case_graph_publications
      ON public.uap_case_graph_publications FOR ALL TO service_role
      USING (true) WITH CHECK (true);
    CREATE POLICY service_role_read_uap_case_graph_runs
      ON public.uap_case_graph_runs FOR SELECT TO service_role
      USING (true);
    CREATE POLICY service_role_insert_uap_case_graph_runs
      ON public.uap_case_graph_runs FOR INSERT TO service_role
      WITH CHECK (true);
    CREATE POLICY service_role_update_legacy_uap_case_graph_runs
      ON public.uap_case_graph_runs FOR UPDATE TO service_role
      USING (lineage_version <> 'case-vortex-lineage-v2')
      WITH CHECK (lineage_version <> 'case-vortex-lineage-v2');

    GRANT EXECUTE ON FUNCTION public.claim_uap_case_graph_incremental_jobs(INTEGER, INTEGER)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.activate_uap_case_graph_publication_v2(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
      TO service_role;
  END IF;
END;
$$;
