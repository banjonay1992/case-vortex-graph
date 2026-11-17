-- Deterministic, resumable Evidence Universe snapshots.
--
-- The live media catalogue gains a monotonic mutation watermark, then a
-- security-definer capture freezes full projected records into generic
-- snapshot/component/row tables. A coordinator supplies the snapshot UUID and
-- must call capture inside REPEATABLE READ or SERIALIZABLE. The media capture
-- and a future sighting capture can therefore share the same transaction,
-- header, MVCC receipt and immutable row contract.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE public.uap_search_catalog_media_state
  ADD COLUMN IF NOT EXISTS mutation_watermark_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mutation_watermark_completed_at TIMESTAMPTZ;

INSERT INTO public.uap_search_catalog_media_state (
  entity_kind,
  cursor_updated_at,
  last_processed_count,
  backfill_complete,
  updated_at,
  mutation_watermark_complete
)
VALUES
  ('document', to_timestamp(0), 0, false, clock_timestamp(), false),
  ('photo', to_timestamp(0), 0, false, clock_timestamp(), false),
  ('video', to_timestamp(0), 0, false, clock_timestamp(), false)
ON CONFLICT (entity_kind) DO NOTHING;

CREATE OR REPLACE FUNCTION public.uap_search_catalog_media_stamp_mutation_watermark()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_indexed_at := clock_timestamp();
  ELSE
    IF NOT isfinite(OLD.last_indexed_at) THEN
      RAISE EXCEPTION 'uap_search_catalog_media has a non-finite mutation watermark for %:%',
        OLD.entity_kind,
        OLD.entity_id;
    END IF;
    NEW.last_indexed_at := GREATEST(
      clock_timestamp(),
      OLD.last_indexed_at + interval '1 microsecond'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_search_catalog_media_mutation_watermark
  ON public.uap_search_catalog_media;

CREATE TRIGGER trg_uap_search_catalog_media_mutation_watermark
BEFORE INSERT OR UPDATE ON public.uap_search_catalog_media
FOR EACH ROW
EXECUTE FUNCTION public.uap_search_catalog_media_stamp_mutation_watermark();

-- Stamp and receipt each incomplete kind exactly once. The receipt is at least
-- the maximum watermark written, so no earlier capture instant can pass.
DO $$
DECLARE
  v_kind TEXT;
  v_backfill_started_at TIMESTAMPTZ;
  v_backfill_completed_at TIMESTAMPTZ;
  v_unstamped_count BIGINT;
BEGIN
  FOR v_kind IN
    SELECT state.entity_kind
    FROM public.uap_search_catalog_media_state AS state
    WHERE state.entity_kind IN ('document', 'photo', 'video')
      AND state.mutation_watermark_complete = false
    ORDER BY state.entity_kind
    FOR UPDATE
  LOOP
    v_backfill_started_at := clock_timestamp();

    UPDATE public.uap_search_catalog_media AS catalogue
    SET last_indexed_at = clock_timestamp()
    WHERE catalogue.entity_kind = v_kind;

    SELECT COUNT(*)
    INTO v_unstamped_count
    FROM public.uap_search_catalog_media AS catalogue
    WHERE catalogue.entity_kind = v_kind
      AND (
        NOT isfinite(catalogue.last_indexed_at)
        OR catalogue.last_indexed_at < v_backfill_started_at
      );

    IF v_unstamped_count <> 0 THEN
      RAISE EXCEPTION 'uap_search_catalog_media mutation watermark backfill incomplete for % (% rows)',
        v_kind,
        v_unstamped_count;
    END IF;

    v_backfill_completed_at := GREATEST(
      clock_timestamp(),
      COALESCE(
        (
          SELECT MAX(catalogue.last_indexed_at)
          FROM public.uap_search_catalog_media AS catalogue
          WHERE catalogue.entity_kind = v_kind
        ),
        v_backfill_started_at
      )
    );

    UPDATE public.uap_search_catalog_media_state AS state
    SET
      mutation_watermark_complete = true,
      mutation_watermark_completed_at = v_backfill_completed_at,
      updated_at = v_backfill_completed_at
    WHERE state.entity_kind = v_kind
      AND state.mutation_watermark_complete = false;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_uap_search_catalog_media_public_mutation_cursor
  ON public.uap_search_catalog_media (
    entity_kind,
    last_indexed_at,
    entity_id COLLATE "C"
  )
  WHERE is_public = true;

CREATE TABLE IF NOT EXISTS public.uap_evidence_universe_snapshots (
  id UUID PRIMARY KEY,
  snapshot_policy TEXT NOT NULL CHECK (snapshot_policy <> ''),
  source_snapshot_at TIMESTAMPTZ NOT NULL CHECK (isfinite(source_snapshot_at)),
  materialized_at TIMESTAMPTZ NOT NULL CHECK (isfinite(materialized_at)),
  source_mvcc_snapshot TEXT NOT NULL CHECK (source_mvcc_snapshot <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.uap_evidence_universe_snapshot_components (
  snapshot_id UUID NOT NULL,
  entity_kind TEXT NOT NULL
    CHECK (entity_kind IN ('sighting', 'document', 'photo', 'video')),
  capture_policy TEXT NOT NULL CHECK (capture_policy <> ''),
  status TEXT NOT NULL CHECK (status = 'complete'),
  row_count BIGINT NOT NULL CHECK (row_count >= 0),
  source_counts JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_counts) = 'object'),
  captured_at TIMESTAMPTZ NOT NULL CHECK (isfinite(captured_at)),
  PRIMARY KEY (snapshot_id, entity_kind),
  CONSTRAINT fk_uap_evidence_universe_component_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES public.uap_evidence_universe_snapshots(id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS public.uap_evidence_universe_snapshot_rows (
  snapshot_id UUID NOT NULL,
  entity_kind TEXT NOT NULL
    CHECK (entity_kind IN ('sighting', 'document', 'photo', 'video')),
  entity_id TEXT COLLATE "C" NOT NULL CHECK (entity_id <> ''),
  cursor_at TIMESTAMPTZ NOT NULL CHECK (isfinite(cursor_at)),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (snapshot_id, entity_kind, entity_id),
  CONSTRAINT fk_uap_evidence_universe_row_component
    FOREIGN KEY (snapshot_id, entity_kind)
    REFERENCES public.uap_evidence_universe_snapshot_components(snapshot_id, entity_kind)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_uap_evidence_universe_snapshot_rows_cursor
  ON public.uap_evidence_universe_snapshot_rows (
    snapshot_id,
    entity_kind,
    cursor_at,
    entity_id COLLATE "C"
  );

CREATE OR REPLACE FUNCTION public.uap_evidence_universe_snapshot_header_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'evidence-universe snapshot headers are immutable';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_evidence_universe_snapshot_header_guard
  ON public.uap_evidence_universe_snapshots;

CREATE TRIGGER trg_uap_evidence_universe_snapshot_header_guard
BEFORE UPDATE OR DELETE ON public.uap_evidence_universe_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.uap_evidence_universe_snapshot_header_guard();

CREATE OR REPLACE FUNCTION public.uap_evidence_universe_snapshot_component_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'completed evidence-universe snapshot components are immutable';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_evidence_universe_snapshot_component_guard
  ON public.uap_evidence_universe_snapshot_components;

CREATE TRIGGER trg_uap_evidence_universe_snapshot_component_guard
BEFORE UPDATE OR DELETE ON public.uap_evidence_universe_snapshot_components
FOR EACH ROW
EXECUTE FUNCTION public.uap_evidence_universe_snapshot_component_guard();

CREATE OR REPLACE FUNCTION public.uap_evidence_universe_snapshot_row_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_capture_snapshot_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'evidence-universe snapshot rows are immutable';
  END IF;

  v_capture_snapshot_id := current_setting('uap.evidence_universe_capture_snapshot_id', true);
  IF v_capture_snapshot_id IS DISTINCT FROM NEW.snapshot_id::text THEN
    RAISE EXCEPTION 'evidence-universe snapshot row insert is not authorized';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uap_evidence_universe_snapshot_row_guard
  ON public.uap_evidence_universe_snapshot_rows;

CREATE TRIGGER trg_uap_evidence_universe_snapshot_row_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.uap_evidence_universe_snapshot_rows
FOR EACH ROW
EXECUTE FUNCTION public.uap_evidence_universe_snapshot_row_guard();

REVOKE ALL
  ON public.uap_evidence_universe_snapshots,
     public.uap_evidence_universe_snapshot_components,
     public.uap_evidence_universe_snapshot_rows
  FROM PUBLIC;

ALTER TABLE public.uap_evidence_universe_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_evidence_universe_snapshot_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uap_evidence_universe_snapshot_rows ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.capture_uap_evidence_universe_media_snapshot(
  p_snapshot_id UUID
)
RETURNS TABLE (
  snapshot_id UUID,
  source_snapshot_at TIMESTAMPTZ,
  materialized_at TIMESTAMPTZ,
  source_mvcc_snapshot TEXT,
  document_count BIGINT,
  photo_count BIGINT,
  video_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_materialized_at TIMESTAMPTZ;
  v_source_snapshot_at TIMESTAMPTZ;
  v_source_mvcc_snapshot TEXT;
  v_valid_watermark_count INTEGER;
  v_trigger_valid BOOLEAN;
BEGIN
  IF p_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'evidence-universe snapshot id is required';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'evidence-universe capture requires repeatable read or serializable isolation';
  END IF;

  -- UUID text is canonical and timezone-independent, so retries/concurrent
  -- callers for one coordinator id serialize on the same transaction lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('uap-evidence-universe-snapshot:' || p_snapshot_id::text, 0)
  );

  -- Unknown-commit retry: return an existing complete, physically reconciled
  -- media snapshot for this coordinator id.
  IF EXISTS (
    SELECT 1 FROM public.uap_evidence_universe_snapshots AS snapshot
    WHERE snapshot.id = p_snapshot_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.uap_evidence_universe_snapshots AS snapshot
      WHERE snapshot.id = p_snapshot_id
        AND snapshot.snapshot_policy = 'evidence-universe-materialized-v1'
        AND snapshot.source_snapshot_at =
          date_trunc('milliseconds', snapshot.materialized_at) + interval '1 millisecond'
        AND snapshot.source_mvcc_snapshot ~ '^[0-9]+:[0-9]+:([0-9]+(,[0-9]+)*)?$'
    ) THEN
      RAISE EXCEPTION 'existing evidence-universe snapshot header is invalid';
    END IF;

    IF (
      SELECT COUNT(*)
      FROM (
        SELECT
          component.entity_kind,
          component.row_count,
          COUNT(snapshot_row.entity_id)::bigint AS actual_count
        FROM public.uap_evidence_universe_snapshot_components AS component
        LEFT JOIN public.uap_evidence_universe_snapshot_rows AS snapshot_row
          ON snapshot_row.snapshot_id = component.snapshot_id
          AND snapshot_row.entity_kind = component.entity_kind
        WHERE component.snapshot_id = p_snapshot_id
          AND component.entity_kind IN ('document', 'photo', 'video')
          AND component.status = 'complete'
          AND component.capture_policy = 'catalogue-materialized-v1'
        GROUP BY component.entity_kind, component.row_count
        HAVING component.row_count = COUNT(snapshot_row.entity_id)::bigint
      ) AS reconciled
    ) <> 3 THEN
      RAISE EXCEPTION 'existing evidence-universe media snapshot is incomplete or inconsistent';
    END IF;

    RETURN QUERY
    SELECT
      snapshot.id,
      snapshot.source_snapshot_at,
      snapshot.materialized_at,
      snapshot.source_mvcc_snapshot,
      MAX(component.row_count) FILTER (WHERE component.entity_kind = 'document'),
      MAX(component.row_count) FILTER (WHERE component.entity_kind = 'photo'),
      MAX(component.row_count) FILTER (WHERE component.entity_kind = 'video')
    FROM public.uap_evidence_universe_snapshots AS snapshot
    JOIN public.uap_evidence_universe_snapshot_components AS component
      ON component.snapshot_id = snapshot.id
    WHERE snapshot.id = p_snapshot_id
    GROUP BY
      snapshot.id,
      snapshot.source_snapshot_at,
      snapshot.materialized_at,
      snapshot.source_mvcc_snapshot;
    RETURN;
  END IF;

  -- Establish and receipt the authoritative MVCC membership first, then record
  -- when materialization began. Do not filter visible rows by a wall-clock
  -- watermark: a commit can become visible between statement receipt and MVCC
  -- acquisition, and monotonic microsecond stamping can legitimately run just
  -- ahead of the clock under rapid updates.
  v_source_mvcc_snapshot := pg_current_snapshot()::text;
  v_materialized_at := clock_timestamp();
  -- Canonical millisecond upper bound used by existing archive contracts. The
  -- exact materialization instant and MVCC identity are retained separately.
  v_source_snapshot_at := date_trunc('milliseconds', v_materialized_at) + interval '1 millisecond';

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
    JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = trigger_function.pronamespace
    WHERE relation_namespace.nspname = 'public'
      AND relation.relname = 'uap_search_catalog_media'
      AND trigger_row.tgname = 'trg_uap_search_catalog_media_mutation_watermark'
      AND trigger_row.tgisinternal = false
      AND trigger_row.tgenabled IN ('O', 'A')
      AND trigger_row.tgtype = 23
      AND function_namespace.nspname = 'public'
      AND trigger_function.proname = 'uap_search_catalog_media_stamp_mutation_watermark'
      AND trigger_function.pronargs = 0
  ) INTO v_trigger_valid;

  IF NOT v_trigger_valid THEN
    RAISE EXCEPTION 'evidence-universe media mutation watermark trigger is invalid';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_valid_watermark_count
  FROM public.uap_search_catalog_media_state AS state
  WHERE state.entity_kind IN ('document', 'photo', 'video')
    AND state.backfill_complete = true
    AND state.mutation_watermark_complete = true
    AND state.mutation_watermark_completed_at IS NOT NULL
    AND state.mutation_watermark_completed_at <= v_materialized_at;

  IF v_valid_watermark_count <> 3 THEN
    RAISE EXCEPTION 'evidence-universe media capture predates a complete catalogue watermark';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.uap_search_catalog_media AS catalogue
    WHERE catalogue.entity_kind IN ('document', 'photo', 'video')
      AND catalogue.is_public = true
      AND (
        catalogue.last_indexed_at IS NULL
        OR NOT isfinite(catalogue.last_indexed_at)
      )
  ) THEN
    RAISE EXCEPTION 'evidence-universe media catalogue contains an invalid mutation cursor';
  END IF;

  PERFORM set_config('uap.evidence_universe_capture_snapshot_id', p_snapshot_id::text, true);

  -- Rows intentionally write before their header/components in this single
  -- data-modifying statement. Both foreign keys are DEFERRABLE INITIALLY
  -- DEFERRED, so PostgreSQL validates the fully sealed graph at commit; any
  -- failed row, header, component, or receipt rolls the whole capture back.
  RETURN QUERY
  WITH frozen_rows AS MATERIALIZED (
    SELECT
      catalogue.entity_kind,
      catalogue.entity_id,
      catalogue.last_indexed_at AS cursor_at,
      jsonb_build_object(
        'entity_id', catalogue.entity_id,
        'source', COALESCE(
          NULLIF(catalogue.source, ''),
          NULLIF(catalogue.source_id, ''),
          NULLIF(catalogue.provider, ''),
          'unknown'
        ),
        'source_id', catalogue.source_id,
        'provider', catalogue.provider,
        'source_record_id', catalogue.source_record_id,
        'title', catalogue.title,
        'description', catalogue.description,
        'canonical_url', catalogue.canonical_url,
        'preview_url', catalogue.preview_url,
        'event_timestamp', catalogue.event_timestamp,
        'location_normalized', catalogue.location_normalized,
        'country_code', catalogue.country_code,
        'sighting_id', CASE catalogue.entity_kind
          WHEN 'document' THEN document_source.sighting_id::text
          WHEN 'photo' THEN photo_source.sighting_id::text
          WHEN 'video' THEN video_source.sighting_id::text
        END,
        'lat', CASE catalogue.entity_kind
          WHEN 'document' THEN document_source.lat::double precision
          WHEN 'photo' THEN photo_source.lat::double precision
          WHEN 'video' THEN video_source.lat::double precision
        END,
        'lon', CASE catalogue.entity_kind
          WHEN 'document' THEN document_source.lon::double precision
          WHEN 'photo' THEN photo_source.lon::double precision
          WHEN 'video' THEN video_source.lon::double precision
        END,
        'updated_at', to_char(
          catalogue.last_indexed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'is_public', true
      ) AS payload
    FROM public.uap_search_catalog_media AS catalogue
    LEFT JOIN public.uap_documents AS document_source
      ON catalogue.entity_kind = 'document'
      AND document_source.id::text = catalogue.entity_id
    LEFT JOIN public.uap_photos AS photo_source
      ON catalogue.entity_kind = 'photo'
      AND photo_source.id::text = catalogue.entity_id
    LEFT JOIN public.uap_videos AS video_source
      ON catalogue.entity_kind = 'video'
      AND video_source.id::text = catalogue.entity_id
    WHERE catalogue.entity_kind IN ('document', 'photo', 'video')
      AND catalogue.is_public = true
  ),
  written_rows AS (
    INSERT INTO public.uap_evidence_universe_snapshot_rows (
      snapshot_id,
      entity_kind,
      entity_id,
      cursor_at,
      payload
    )
    SELECT
      p_snapshot_id,
      frozen.entity_kind,
      frozen.entity_id,
      frozen.cursor_at,
      frozen.payload
    FROM frozen_rows AS frozen
    RETURNING entity_kind, entity_id
  ),
  row_counts AS MATERIALIZED (
    SELECT written.entity_kind, COUNT(*)::bigint AS row_count
    FROM written_rows AS written
    GROUP BY written.entity_kind
  ),
  inserted_header AS (
    INSERT INTO public.uap_evidence_universe_snapshots AS snapshot_header (
      id,
      snapshot_policy,
      source_snapshot_at,
      materialized_at,
      source_mvcc_snapshot
    )
    SELECT
      p_snapshot_id,
      'evidence-universe-materialized-v1',
      v_source_snapshot_at,
      v_materialized_at,
      v_source_mvcc_snapshot
    FROM (SELECT COUNT(*) AS written_count FROM written_rows) AS write_receipt
    RETURNING
      snapshot_header.id,
      snapshot_header.source_snapshot_at,
      snapshot_header.materialized_at,
      snapshot_header.source_mvcc_snapshot
  ),
  inserted_components AS (
    INSERT INTO public.uap_evidence_universe_snapshot_components (
      snapshot_id,
      entity_kind,
      capture_policy,
      status,
      row_count,
      source_counts,
      captured_at
    )
    SELECT
      header.id,
      kind.entity_kind,
      'catalogue-materialized-v1',
      'complete',
      COALESCE(row_counts.row_count, 0),
      '{}'::jsonb,
      header.materialized_at
    FROM inserted_header AS header
    CROSS JOIN (VALUES ('document'), ('photo'), ('video')) AS kind(entity_kind)
    LEFT JOIN row_counts ON row_counts.entity_kind = kind.entity_kind
    RETURNING entity_kind, row_count
  )
  SELECT
    header.id,
    header.source_snapshot_at,
    header.materialized_at,
    header.source_mvcc_snapshot,
    MAX(component.row_count) FILTER (WHERE component.entity_kind = 'document'),
    MAX(component.row_count) FILTER (WHERE component.entity_kind = 'photo'),
    MAX(component.row_count) FILTER (WHERE component.entity_kind = 'video')
  FROM inserted_header AS header
  CROSS JOIN inserted_components AS component
  GROUP BY
    header.id,
    header.source_snapshot_at,
    header.materialized_at,
    header.source_mvcc_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_uap_evidence_universe_media_snapshot(UUID)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.uap_evidence_universe_snapshot_header_guard()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.uap_evidence_universe_snapshot_component_guard()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.uap_evidence_universe_snapshot_row_guard()
  FROM PUBLIC;

-- Runtime roles may read sealed snapshots, but only the database-owner capture
-- coordinator can create them. In particular, service_role cannot self-set the
-- transaction-local capture GUC and then write rows because it has SELECT only
-- and cannot execute the internal media capture function directly.
DO $$
DECLARE
  v_table_name TEXT;
  v_role_name TEXT;
  v_policy_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'uap_evidence_universe_snapshots',
    'uap_evidence_universe_snapshot_components',
    'uap_evidence_universe_snapshot_rows'
  ] LOOP
    FOREACH v_role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', v_table_name, v_role_name);
      END IF;
    END LOOP;

    -- Default privileges can grant newly-created tables to application-specific
    -- roles. Remove every direct non-owner grant before adding the one intended
    -- read-only runtime grant below.
    FOR v_role_name IN
      SELECT DISTINCT grantee.rolname
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) AS privilege
      JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
      WHERE relation_namespace.nspname = 'public'
        AND relation.relname = v_table_name
        AND privilege.grantee <> relation.relowner
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', v_table_name, v_role_name);
    END LOOP;

    v_policy_name := 'service_role_read_' || v_table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy_name, v_table_name);
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', v_table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO service_role USING (true)',
        v_policy_name,
        v_table_name
      );
    END IF;
  END LOOP;

  FOREACH v_role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.capture_uap_evidence_universe_media_snapshot(UUID) FROM %I',
        v_role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.uap_evidence_universe_snapshot_header_guard() FROM %I',
        v_role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.uap_evidence_universe_snapshot_component_guard() FROM %I',
        v_role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.uap_evidence_universe_snapshot_row_guard() FROM %I',
        v_role_name
      );
    END IF;
  END LOOP;

  -- Revoke capture execution granted by any custom default-function ACL too.
  FOR v_role_name IN
    SELECT DISTINCT grantee.rolname
    FROM pg_catalog.pg_proc AS capture_function
    JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = capture_function.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(capture_function.proacl, pg_catalog.acldefault('f', capture_function.proowner))
    ) AS privilege
    JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE function_namespace.nspname = 'public'
      AND capture_function.proname = 'capture_uap_evidence_universe_media_snapshot'
      AND capture_function.pronargs = 1
      AND privilege.grantee <> capture_function.proowner
      AND privilege.privilege_type = 'EXECUTE'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.capture_uap_evidence_universe_media_snapshot(UUID) FROM %I',
      v_role_name
    );
  END LOOP;
END;
$$;
