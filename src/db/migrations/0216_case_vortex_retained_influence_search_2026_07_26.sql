-- Immutable, publication-pinned serving index for retained corpus influence.
--
-- This index deliberately stores no sighting narrative, summary, AI prose,
-- media URL, precise coordinates, raw location or public evidence address.
-- Discovery-only sources contribute derived search features. Metadata-only
-- sources contribute bounded metadata. Neither lane can become citable
-- evidence or receive independent-corroboration credit.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $$
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'case-vortex retained influence requires PostgreSQL 17.x';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.case_vortex_retained_influence_builds (
  publication_id UUID PRIMARY KEY
    REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  corpus_version TEXT COLLATE "C" NOT NULL
    CHECK (corpus_version ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  public_manifest_sha256 VARCHAR(64) NOT NULL
    CHECK (public_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  influence_receipt_sha256 VARCHAR(64) NOT NULL
    CHECK (influence_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  bound_census_sha256 VARCHAR(64) NOT NULL
    CHECK (bound_census_sha256 ~ '^[a-f0-9]{64}$'),
  source_mvcc_snapshot TEXT COLLATE "C" NOT NULL
    CHECK (octet_length(source_mvcc_snapshot) BETWEEN 1 AND 500),
  source_manifest JSONB NOT NULL
    CHECK (jsonb_typeof(source_manifest) = 'array'
      AND jsonb_array_length(source_manifest) BETWEEN 1 AND 100),
  expected_discovery_signal_count BIGINT NOT NULL
    CHECK (expected_discovery_signal_count BETWEEN 0 AND 9007199254740991),
  expected_metadata_lead_count BIGINT NOT NULL
    CHECK (expected_metadata_lead_count BETWEEN 0 AND 9007199254740991),
  indexed_discovery_signal_count BIGINT NOT NULL
    CHECK (indexed_discovery_signal_count BETWEEN 0 AND 9007199254740991),
  indexed_metadata_lead_count BIGINT NOT NULL
    CHECK (indexed_metadata_lead_count BETWEEN 0 AND 9007199254740991),
  entry_set_sha256 VARCHAR(64) NOT NULL
    CHECK (entry_set_sha256 ~ '^[a-f0-9]{64}$'),
  projection_set_sha256 VARCHAR(64) NOT NULL
    CHECK (projection_set_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'case-vortex-retained-influence-postgres-v1'),
  projection_policy_version TEXT NOT NULL
    CHECK (projection_policy_version = 'case-vortex-retained-influence-projection-v1'),
  status TEXT NOT NULL CHECK (status = 'verified'),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    expected_discovery_signal_count = indexed_discovery_signal_count
    AND expected_metadata_lead_count = indexed_metadata_lead_count
  )
);

CREATE TABLE IF NOT EXISTS public.case_vortex_retained_influence_entries (
  publication_id UUID NOT NULL
    REFERENCES public.case_vortex_retained_influence_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  signal_id TEXT COLLATE "C" NOT NULL
    CHECK (signal_id ~ '^retained-signal:[a-f0-9]{64}$'),
  source_row_digest VARCHAR(64) NOT NULL
    CHECK (source_row_digest ~ '^[a-f0-9]{64}$'),
  lane TEXT NOT NULL CHECK (lane IN ('discovery_signal', 'metadata_lead')),
  kind TEXT NOT NULL CHECK (kind IN ('sighting', 'document', 'photo', 'video')),
  source TEXT COLLATE "C" NOT NULL
    CHECK (octet_length(source) BETWEEN 1 AND 250),
  event_timestamp TIMESTAMPTZ,
  generalized_location TEXT
    CHECK (generalized_location IS NULL OR octet_length(generalized_location) BETWEEN 1 AND 500),
  search_text TEXT NOT NULL CHECK (octet_length(search_text) BETWEEN 1 AND 4096),
  projection_digest VARCHAR(64) NOT NULL
    CHECK (projection_digest ~ '^[a-f0-9]{64}$'),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, search_text)
  ) STORED,
  PRIMARY KEY (publication_id, signal_id),
  UNIQUE (publication_id, source_row_digest),
  CHECK (
    (lane = 'discovery_signal' AND generalized_location IS NULL)
    OR lane = 'metadata_lead'
  )
);

CREATE INDEX IF NOT EXISTS case_vortex_retained_influence_search_vector_gin_idx
  ON public.case_vortex_retained_influence_entries USING gin (search_vector);
CREATE INDEX IF NOT EXISTS case_vortex_retained_influence_event_idx
  ON public.case_vortex_retained_influence_entries
  (publication_id, event_timestamp, signal_id);
CREATE INDEX IF NOT EXISTS case_vortex_retained_influence_source_idx
  ON public.case_vortex_retained_influence_entries
  (publication_id, source, signal_id);

CREATE OR REPLACE FUNCTION public.case_vortex_retained_influence_immutable_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'case-vortex retained influence rows are append-only';
END;
$$;

DROP TRIGGER IF EXISTS case_vortex_retained_influence_builds_immutable
  ON public.case_vortex_retained_influence_builds;
CREATE TRIGGER case_vortex_retained_influence_builds_immutable
  BEFORE UPDATE OR DELETE ON public.case_vortex_retained_influence_builds
  FOR EACH ROW EXECUTE FUNCTION public.case_vortex_retained_influence_immutable_guard();

DROP TRIGGER IF EXISTS case_vortex_retained_influence_entries_immutable
  ON public.case_vortex_retained_influence_entries;
CREATE TRIGGER case_vortex_retained_influence_entries_immutable
  BEFORE UPDATE OR DELETE ON public.case_vortex_retained_influence_entries
  FOR EACH ROW EXECUTE FUNCTION public.case_vortex_retained_influence_immutable_guard();

CREATE OR REPLACE FUNCTION public.build_case_vortex_retained_influence_index(
  p_publication_id UUID,
  p_public_manifest_sha256 TEXT,
  p_influence_receipt_sha256 TEXT,
  p_bound_census_sha256 TEXT,
  p_source_mvcc_snapshot TEXT,
  p_source_manifest JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_corpus_version TEXT;
  v_expected_discovery BIGINT;
  v_expected_metadata BIGINT;
  v_indexed_discovery BIGINT;
  v_indexed_metadata BIGINT;
  v_entry_set_sha256 TEXT;
  v_projection_set_sha256 TEXT;
BEGIN
  IF p_public_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_influence_receipt_sha256 !~ '^[a-f0-9]{64}$'
    OR p_bound_census_sha256 !~ '^[a-f0-9]{64}$'
    OR p_source_mvcc_snapshot IS NULL
    OR octet_length(p_source_mvcc_snapshot) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_source_manifest) <> 'array'
    OR jsonb_array_length(p_source_manifest) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'case-vortex retained influence build binding is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'case-vortex-retained-influence:' || p_publication_id::text,
    0
  ));

  SELECT publication.corpus_version
  INTO STRICT v_corpus_version
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_runs AS run
    ON run.id = publication.run_id
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.id = p_publication_id
    AND publication.public_manifest_sha256 = p_public_manifest_sha256
    AND publication.active = false
    AND publication.activated_at IS NULL
    AND publication.deactivated_at IS NULL
    AND run.lineage_version = 'case-vortex-lineage-v2'
    AND run.status = 'completed'
    AND run.snapshot_id IS NOT NULL
    AND receipt.receipt_version = 'case-vortex-publication-receipt-v2'
    AND receipt.snapshot_id = run.snapshot_id
    AND receipt.public_manifest_sha256 = publication.public_manifest_sha256
    AND receipt.completion_manifest_sha256 = run.completion_manifest_sha256
    AND receipt.corpus_accounting_digest = run.corpus_accounting_digest
    AND receipt.graph_artifact_set_sha256 = run.graph_artifact_set_sha256;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_source_manifest) AS item
    WHERE jsonb_typeof(item) <> 'object'
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(item) AS key)
        <> ARRAY['lane', 'projectionPolicy', 'rowCount', 'source']::TEXT[]
      OR coalesce(item->>'source', '') !~ '^[A-Z0-9][A-Z0-9._:/-]{0,239}$'
      OR coalesce(item->>'lane', '') NOT IN ('discovery_signal', 'metadata_lead')
      OR coalesce(item->>'projectionPolicy', '') <> CASE item->>'lane'
        WHEN 'discovery_signal' THEN 'derived_features_only'
        ELSE 'metadata_and_source_link_only'
      END
      OR coalesce(item->>'rowCount', '') !~ '^[0-9]+$'
      OR (item->>'rowCount')::numeric > 9007199254740991
  ) OR (
    SELECT count(DISTINCT item->>'source')
    FROM jsonb_array_elements(p_source_manifest) AS item
  ) <> jsonb_array_length(p_source_manifest)
  THEN
    RAISE EXCEPTION 'case-vortex retained influence source manifest is invalid';
  END IF;

  SELECT
    coalesce(sum((item->>'rowCount')::bigint)
      FILTER (WHERE item->>'lane' = 'discovery_signal'), 0),
    coalesce(sum((item->>'rowCount')::bigint)
      FILTER (WHERE item->>'lane' = 'metadata_lead'), 0)
  INTO v_expected_discovery, v_expected_metadata
  FROM jsonb_array_elements(p_source_manifest) AS item;

  IF EXISTS (
    WITH expected AS (
      SELECT item->>'source' AS source, (item->>'rowCount')::bigint AS row_count
      FROM jsonb_array_elements(p_source_manifest) AS item
    ),
    actual AS (
      SELECT upper(btrim(sighting.source)) AS source, count(*)::bigint AS row_count
      FROM public.uap_sightings AS sighting
      WHERE upper(btrim(sighting.source)) IN (SELECT source FROM expected)
      GROUP BY upper(btrim(sighting.source))
    )
    SELECT 1
    FROM expected
    FULL OUTER JOIN actual USING (source)
    WHERE expected.row_count IS DISTINCT FROM actual.row_count
  ) THEN
    RAISE EXCEPTION 'case-vortex retained influence source accounting drifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.case_vortex_retained_influence_builds
    WHERE publication_id = p_publication_id
  ) THEN
    RAISE EXCEPTION 'case-vortex retained influence publication already indexed';
  END IF;

  WITH policy AS (
    SELECT
      item->>'source' AS source,
      item->>'lane' AS lane
    FROM jsonb_array_elements(p_source_manifest) AS item
  ),
  projected AS (
    SELECT
      sighting.id,
      policy.lane,
      upper(btrim(sighting.source)) AS source,
      sighting.event_timestamp,
      CASE WHEN policy.lane = 'metadata_lead' THEN nullif(concat_ws(
        ', ',
        nullif(btrim(sighting.region), ''),
        nullif(btrim(sighting.country), '')
      ), '') ELSE NULL END AS generalized_location,
      CASE WHEN policy.lane = 'discovery_signal' THEN concat_ws(
        ' ',
        upper(btrim(sighting.source)),
        nullif(btrim(coalesce(sighting.shape_normalized, sighting.shape)), ''),
        sighting.event_year::text,
        sighting.event_decade::text,
        nullif(btrim(sighting.region), ''),
        nullif(btrim(sighting.country), ''),
        array_to_string(coalesce(sighting.ai_keywords, '{}'::text[]), ' ')
      ) ELSE concat_ws(
        ' ',
        upper(btrim(sighting.source)),
        nullif(btrim(sighting.external_id), ''),
        nullif(btrim(sighting.source_record_id), ''),
        sighting.event_year::text,
        nullif(btrim(coalesce(sighting.shape_normalized, sighting.shape)), ''),
        nullif(btrim(sighting.region), ''),
        nullif(btrim(sighting.country), '')
      ) END AS search_text
    FROM public.uap_sightings AS sighting
    JOIN policy ON policy.source = upper(btrim(sighting.source))
  ),
  digested AS (
    SELECT
      p_publication_id AS publication_id,
      'retained-signal:' || encode(sha256(convert_to(
        p_influence_receipt_sha256 || chr(31) || projected.id::text,
        'UTF8'
      )), 'hex') AS signal_id,
      encode(sha256(convert_to(projected.id::text, 'UTF8')), 'hex') AS source_row_digest,
      projected.lane,
      'sighting'::text AS kind,
      projected.source,
      projected.event_timestamp,
      projected.generalized_location,
      left(regexp_replace(projected.search_text, '[[:space:]]+', ' ', 'g'), 1000) AS search_text,
      encode(sha256(convert_to(concat_ws(
        chr(31),
        projected.lane,
        projected.source,
        coalesce(projected.event_timestamp::text, ''),
        coalesce(projected.generalized_location, ''),
        left(regexp_replace(projected.search_text, '[[:space:]]+', ' ', 'g'), 1000)
      ), 'UTF8')), 'hex') AS projection_digest
    FROM projected
    WHERE octet_length(btrim(projected.search_text)) BETWEEN 1 AND 4096
  )
  INSERT INTO public.case_vortex_retained_influence_entries (
    publication_id, signal_id, source_row_digest, lane, kind, source,
    event_timestamp, generalized_location, search_text, projection_digest
  )
  SELECT publication_id, signal_id, source_row_digest, lane, kind, source,
    event_timestamp, generalized_location, search_text, projection_digest
  FROM digested
  ORDER BY signal_id;

  SELECT
    count(*) FILTER (WHERE lane = 'discovery_signal'),
    count(*) FILTER (WHERE lane = 'metadata_lead'),
    encode(sha256(convert_to(string_agg(signal_id, '' ORDER BY signal_id), 'UTF8')), 'hex'),
    encode(sha256(convert_to(string_agg(projection_digest, '' ORDER BY signal_id), 'UTF8')), 'hex')
  INTO v_indexed_discovery, v_indexed_metadata, v_entry_set_sha256, v_projection_set_sha256
  FROM public.case_vortex_retained_influence_entries
  WHERE publication_id = p_publication_id;

  IF v_indexed_discovery <> v_expected_discovery
    OR v_indexed_metadata <> v_expected_metadata
  THEN
    RAISE EXCEPTION 'case-vortex retained influence terminal accounting mismatch';
  END IF;

  INSERT INTO public.case_vortex_retained_influence_builds (
    publication_id, corpus_version, public_manifest_sha256,
    influence_receipt_sha256, bound_census_sha256, source_mvcc_snapshot,
    source_manifest, expected_discovery_signal_count,
    expected_metadata_lead_count, indexed_discovery_signal_count,
    indexed_metadata_lead_count, entry_set_sha256, projection_set_sha256,
    schema_version, projection_policy_version, status
  ) VALUES (
    p_publication_id, v_corpus_version, p_public_manifest_sha256,
    p_influence_receipt_sha256, p_bound_census_sha256, p_source_mvcc_snapshot,
    p_source_manifest, v_expected_discovery, v_expected_metadata,
    v_indexed_discovery, v_indexed_metadata, v_entry_set_sha256,
    v_projection_set_sha256, 'case-vortex-retained-influence-postgres-v1',
    'case-vortex-retained-influence-projection-v1', 'verified'
  );

  RETURN jsonb_build_object(
    'publicationId', p_publication_id::text,
    'corpusVersion', v_corpus_version,
    'publicManifestSha256', p_public_manifest_sha256,
    'influenceReceiptSha256', p_influence_receipt_sha256,
    'discoverySignalCount', v_indexed_discovery,
    'metadataLeadCount', v_indexed_metadata,
    'entrySetSha256', v_entry_set_sha256,
    'projectionSetSha256', v_projection_set_sha256
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.search_case_vortex_retained_influence(
  p_publication_id UUID,
  p_public_manifest_sha256 TEXT,
  p_influence_receipt_sha256 TEXT,
  p_query TEXT,
  p_sources TEXT[],
  p_kinds TEXT[],
  p_event_start TIMESTAMPTZ,
  p_event_end TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (
  signal_id TEXT,
  lane TEXT,
  kind TEXT,
  source TEXT,
  event_timestamp TEXT,
  generalized_location TEXT,
  score DOUBLE PRECISION,
  projection_digest TEXT,
  matched_discovery_signal_count BIGINT,
  matched_metadata_lead_count BIGINT,
  influence_receipt_sha256 TEXT,
  index_sha256 TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_query TSQUERY;
  v_index_sha256 TEXT;
BEGIN
  IF p_public_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_influence_receipt_sha256 !~ '^[a-f0-9]{64}$'
    OR p_query IS NULL OR octet_length(btrim(p_query)) NOT BETWEEN 1 AND 1000
    OR p_limit NOT BETWEEN 1 AND 20
    OR cardinality(coalesce(p_sources, '{}'::text[])) > 20
    OR cardinality(coalesce(p_kinds, '{}'::text[])) > 4
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_sources, '{}'::text[])) item
      WHERE item !~ '^[a-z0-9][a-z0-9._:/-]{0,239}$')
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_kinds, '{}'::text[])) item
      WHERE item NOT IN ('sighting', 'document', 'photo', 'video'))
    OR (p_event_start IS NOT NULL AND p_event_end IS NOT NULL
      AND p_event_start >= p_event_end)
  THEN
    RAISE EXCEPTION 'case-vortex retained influence search request is invalid';
  END IF;

  SELECT build.projection_set_sha256
  INTO STRICT v_index_sha256
  FROM public.case_vortex_retained_influence_builds AS build
  JOIN public.uap_case_graph_publications AS publication
    ON publication.id = build.publication_id
  WHERE build.publication_id = p_publication_id
    AND build.public_manifest_sha256 = p_public_manifest_sha256
    AND build.influence_receipt_sha256 = p_influence_receipt_sha256
    AND build.status = 'verified'
    AND publication.active = true
    AND publication.public_manifest_sha256 = p_public_manifest_sha256;

  v_query := websearch_to_tsquery('pg_catalog.simple'::regconfig, p_query);
  IF numnode(v_query) = 0 THEN
    RAISE EXCEPTION 'case-vortex retained influence search query is empty';
  END IF;

  RETURN QUERY
  WITH matches AS MATERIALIZED (
    SELECT
      entry.signal_id,
      entry.lane,
      entry.kind,
      entry.source,
      entry.event_timestamp,
      entry.generalized_location,
      entry.projection_digest,
      ts_rank_cd(entry.search_vector, v_query, 32)::double precision AS score
    FROM public.case_vortex_retained_influence_entries AS entry
    WHERE entry.publication_id = p_publication_id
      AND entry.search_vector @@ v_query
      AND (
        cardinality(coalesce(p_sources, '{}'::text[])) = 0
        OR lower(entry.source) = ANY(p_sources)
      )
      AND (
        cardinality(coalesce(p_kinds, '{}'::text[])) = 0
        OR entry.kind = ANY(p_kinds)
      )
      AND (p_event_start IS NULL OR entry.event_timestamp >= p_event_start)
      AND (p_event_end IS NULL OR entry.event_timestamp < p_event_end)
  ),
  counted AS (
    SELECT
      matches.*,
      count(*) FILTER (WHERE matches.lane = 'discovery_signal') OVER ()
        AS discovery_count,
      count(*) FILTER (WHERE matches.lane = 'metadata_lead') OVER ()
        AS metadata_count
    FROM matches
  )
  SELECT
    counted.signal_id,
    counted.lane,
    counted.kind,
    counted.source,
    CASE WHEN counted.event_timestamp IS NULL THEN NULL
      ELSE to_char(counted.event_timestamp AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    counted.generalized_location,
    counted.score,
    counted.projection_digest::text,
    counted.discovery_count,
    counted.metadata_count,
    p_influence_receipt_sha256,
    v_index_sha256
  FROM counted
  ORDER BY counted.score DESC, counted.signal_id ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON TABLE public.case_vortex_retained_influence_builds FROM PUBLIC;
REVOKE ALL ON TABLE public.case_vortex_retained_influence_entries FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_vortex_retained_influence_immutable_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.build_case_vortex_retained_influence_index(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_case_vortex_retained_influence(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;

ALTER TABLE public.case_vortex_retained_influence_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_retained_influence_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.case_vortex_retained_influence_builds FROM anon;
    REVOKE ALL ON TABLE public.case_vortex_retained_influence_entries FROM anon;
    REVOKE EXECUTE ON FUNCTION public.build_case_vortex_retained_influence_index(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.search_case_vortex_retained_influence(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.case_vortex_retained_influence_builds FROM authenticated;
    REVOKE ALL ON TABLE public.case_vortex_retained_influence_entries FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.build_case_vortex_retained_influence_index(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.search_case_vortex_retained_influence(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON TABLE public.case_vortex_retained_influence_builds TO service_role;
    GRANT SELECT ON TABLE public.case_vortex_retained_influence_entries TO service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_vortex_retained_influence_builds FROM service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_vortex_retained_influence_entries FROM service_role;

    DROP POLICY IF EXISTS service_role_select_retained_influence_builds
      ON public.case_vortex_retained_influence_builds;
    CREATE POLICY service_role_select_retained_influence_builds
      ON public.case_vortex_retained_influence_builds
      FOR SELECT TO service_role USING (true);
    DROP POLICY IF EXISTS service_role_select_retained_influence_entries
      ON public.case_vortex_retained_influence_entries;
    CREATE POLICY service_role_select_retained_influence_entries
      ON public.case_vortex_retained_influence_entries
      FOR SELECT TO service_role USING (true);

    GRANT EXECUTE ON FUNCTION public.build_case_vortex_retained_influence_index(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.search_case_vortex_retained_influence(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
      TO service_role;
  END IF;
END;
$$;
