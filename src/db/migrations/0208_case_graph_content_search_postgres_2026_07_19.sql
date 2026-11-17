-- Private, publication-pinned serving index for governed extracted content.
-- Immutable R2 content-search shards remain authoritative. PostgreSQL is a
-- reproducible serving projection and stays invisible until exact accounting
-- and its external completion receipt are verified.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DO $$
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'case-graph content search requires PostgreSQL 17.x';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.case_graph_content_search_builds (
  publication_id UUID PRIMARY KEY
    REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  public_manifest_sha256 VARCHAR(64) NOT NULL CHECK (public_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  accounting_receipt_digest VARCHAR(64) NOT NULL CHECK (accounting_receipt_digest ~ '^[a-f0-9]{64}$'),
  index_manifest_digest VARCHAR(64) NOT NULL CHECK (index_manifest_digest ~ '^[a-f0-9]{64}$'),
  expected_entry_count BIGINT NOT NULL CHECK (expected_entry_count BETWEEN 0 AND 9007199254740991),
  expected_shard_count INTEGER NOT NULL CHECK (expected_shard_count BETWEEN 0 AND 1000000),
  expected_entry_set_sha256 VARCHAR(64) NOT NULL CHECK (expected_entry_set_sha256 ~ '^[a-f0-9]{64}$'),
  expected_shard_set_sha256 VARCHAR(64) NOT NULL CHECK (expected_shard_set_sha256 ~ '^[a-f0-9]{64}$'),
  indexed_entry_count BIGINT CHECK (indexed_entry_count BETWEEN 0 AND 9007199254740991),
  indexed_shard_count INTEGER CHECK (indexed_shard_count BETWEEN 0 AND 1000000),
  db_entry_set_sha256 VARCHAR(64) CHECK (db_entry_set_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'verified', 'failed')),
  lease_token UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  leased_until TIMESTAMPTZ NOT NULL,
  completion_receipt_key TEXT COLLATE "C",
  completion_receipt_sha256 VARCHAR(64) CHECK (completion_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at TIMESTAMPTZ,
  failure_code TEXT COLLATE "C",
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((status = 'building' AND verified_at IS NULL AND completion_receipt_key IS NULL
      AND completion_receipt_sha256 IS NULL AND failure_code IS NULL)
    OR (status = 'verified' AND verified_at IS NOT NULL AND completion_receipt_key IS NOT NULL
      AND completion_receipt_sha256 IS NOT NULL AND failure_code IS NULL
      AND indexed_entry_count = expected_entry_count AND indexed_shard_count = expected_shard_count)
    OR (status = 'failed' AND verified_at IS NULL AND completion_receipt_key IS NULL
      AND completion_receipt_sha256 IS NULL AND failure_code ~ '^[a-z0-9][a-z0-9._:-]{0,239}$'))
);

CREATE TABLE IF NOT EXISTS public.case_graph_content_search_chunks (
  publication_id UUID NOT NULL REFERENCES public.case_graph_content_search_builds(publication_id) ON DELETE RESTRICT,
  chunk_id TEXT COLLATE "C" NOT NULL CHECK (chunk_id ~ '^content-chunk:[a-f0-9]{64}$'),
  chunk_digest VARCHAR(64) NOT NULL CHECK (chunk_digest ~ '^[a-f0-9]{64}$'),
  entry_id TEXT COLLATE "C" NOT NULL CHECK (entry_id ~ '^content-search-entry:[a-f0-9]{64}$'),
  entry_digest VARCHAR(64) NOT NULL CHECK (entry_digest ~ '^[a-f0-9]{64}$'),
  address TEXT COLLATE "C" NOT NULL CHECK (address ~ '^[!-~]+$' AND octet_length(address) <= 1024),
  node_digest VARCHAR(64) NOT NULL CHECK (node_digest ~ '^[a-f0-9]{64}$'),
  asset_id TEXT COLLATE "C" NOT NULL CHECK (asset_id ~ '^content-asset:[a-f0-9]{64}$'),
  asset_digest VARCHAR(64) NOT NULL CHECK (asset_digest ~ '^[a-f0-9]{64}$'),
  extraction_contract_digest VARCHAR(64) NOT NULL CHECK (extraction_contract_digest ~ '^[a-f0-9]{64}$'),
  extraction_receipt_digest VARCHAR(64) NOT NULL CHECK (extraction_receipt_digest ~ '^[a-f0-9]{64}$'),
  extraction_pointer_digest VARCHAR(64) NOT NULL CHECK (extraction_pointer_digest ~ '^[a-f0-9]{64}$'),
  chunks_object_key TEXT COLLATE "C" NOT NULL CHECK (octet_length(chunks_object_key) BETWEEN 1 AND 4096),
  chunks_object_sha256 VARCHAR(64) NOT NULL CHECK (chunks_object_sha256 ~ '^[a-f0-9]{64}$'),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('document', 'image', 'audio', 'video')),
  text_origin TEXT NOT NULL CHECK (text_origin IN (
    'embedded_text', 'ocr', 'asr', 'human_transcript', 'machine_caption', 'frame_ocr', 'exif'
  )),
  locator JSONB NOT NULL CHECK (
    jsonb_typeof(locator) = 'object' AND octet_length(locator::text) <= 16384
    AND locator->>'locatorType' IN ('document_page', 'image_region', 'timed_media', 'exif_field')
  ),
  text TEXT COLLATE "C" NOT NULL CHECK (text <> '' AND octet_length(text) <= 16777216),
  language TEXT COLLATE "C" NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  source_shard INTEGER NOT NULL CHECK (source_shard BETWEEN 0 AND 999999),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, text)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, chunk_id),
  UNIQUE (publication_id, entry_id),
  CHECK ((text_origin IN ('ocr', 'asr', 'machine_caption', 'frame_ocr') AND confidence IS NOT NULL)
    OR (text_origin NOT IN ('ocr', 'asr', 'machine_caption', 'frame_ocr'))),
  CHECK (
    (media_kind = 'document' AND text_origin IN ('embedded_text', 'ocr')
      AND locator->>'locatorType' = 'document_page')
    OR (media_kind = 'image' AND text_origin IN ('machine_caption', 'frame_ocr')
      AND locator->>'locatorType' = 'image_region')
    OR (media_kind = 'image' AND text_origin = 'exif' AND locator->>'locatorType' = 'exif_field')
    OR (media_kind IN ('audio', 'video') AND text_origin IN ('asr', 'human_transcript')
      AND locator->>'locatorType' = 'timed_media')
    OR (media_kind = 'video' AND text_origin IN ('machine_caption', 'frame_ocr')
      AND locator->>'locatorType' = 'timed_media' AND locator->'keyframeMs' <> 'null'::jsonb)
  )
);

CREATE INDEX IF NOT EXISTS case_graph_content_search_chunks_vector_gin_idx
  ON public.case_graph_content_search_chunks USING gin (search_vector);
CREATE INDEX IF NOT EXISTS case_graph_content_search_chunks_asset_idx
  ON public.case_graph_content_search_chunks (publication_id, asset_id, chunk_id);
CREATE INDEX IF NOT EXISTS case_graph_content_search_chunks_origin_idx
  ON public.case_graph_content_search_chunks (publication_id, media_kind, text_origin, chunk_id);

CREATE TABLE IF NOT EXISTS public.case_graph_content_search_source_shards (
  publication_id UUID NOT NULL REFERENCES public.case_graph_content_search_builds(publication_id) ON DELETE RESTRICT,
  shard_number INTEGER NOT NULL CHECK (shard_number BETWEEN 0 AND 999999),
  shard_digest VARCHAR(64) NOT NULL CHECK (shard_digest ~ '^[a-f0-9]{64}$'),
  source_object_sha256 VARCHAR(64) NOT NULL CHECK (source_object_sha256 ~ '^[a-f0-9]{64}$'),
  entry_set_sha256 VARCHAR(64) NOT NULL CHECK (entry_set_sha256 ~ '^[a-f0-9]{64}$'),
  entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 1 AND 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, shard_number)
);

ALTER TABLE public.case_graph_content_search_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_content_search_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_content_search_source_shards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cgcs_service_read_builds ON public.case_graph_content_search_builds;
DROP POLICY IF EXISTS cgcs_service_read_chunks ON public.case_graph_content_search_chunks;
DROP POLICY IF EXISTS cgcs_service_read_shards ON public.case_graph_content_search_source_shards;
CREATE POLICY cgcs_service_read_builds ON public.case_graph_content_search_builds
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');
CREATE POLICY cgcs_service_read_chunks ON public.case_graph_content_search_chunks
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');
CREATE POLICY cgcs_service_read_shards ON public.case_graph_content_search_source_shards
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');

CREATE OR REPLACE FUNCTION public.case_graph_content_search_append_only_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'case-graph content search rows are append-only'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_cgcs_chunks_append_only BEFORE UPDATE OR DELETE
  ON public.case_graph_content_search_chunks FOR EACH ROW
  EXECUTE FUNCTION public.case_graph_content_search_append_only_guard();
CREATE TRIGGER trg_cgcs_shards_append_only BEFORE UPDATE OR DELETE
  ON public.case_graph_content_search_source_shards FOR EACH ROW
  EXECUTE FUNCTION public.case_graph_content_search_append_only_guard();

CREATE OR REPLACE FUNCTION public.create_case_graph_content_search_build(
  p_publication_id UUID, p_public_manifest_sha256 TEXT, p_accounting_receipt_digest TEXT,
  p_index_manifest_digest TEXT, p_expected_entry_count BIGINT, p_expected_shard_count INTEGER,
  p_expected_entry_set_sha256 TEXT, p_expected_shard_set_sha256 TEXT, p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE(lease_token UUID, leased_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_token UUID := pg_catalog.gen_random_uuid(); v_until TIMESTAMPTZ; v_existing RECORD;
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 900 OR p_public_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_accounting_receipt_digest !~ '^[a-f0-9]{64}$' OR p_index_manifest_digest !~ '^[a-f0-9]{64}$'
    OR p_expected_entry_set_sha256 !~ '^[a-f0-9]{64}$' OR p_expected_shard_set_sha256 !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'case-graph content search build binding invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.uap_case_graph_publications
    WHERE id = p_publication_id AND public_manifest_sha256 = p_public_manifest_sha256)
  THEN RAISE EXCEPTION 'case-graph content search publication mismatch'; END IF;
  v_until := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);
  INSERT INTO public.case_graph_content_search_builds(
    publication_id, public_manifest_sha256, accounting_receipt_digest, index_manifest_digest,
    expected_entry_count, expected_shard_count, expected_entry_set_sha256, expected_shard_set_sha256,
    lease_token, leased_until
  ) VALUES (p_publication_id, p_public_manifest_sha256, p_accounting_receipt_digest, p_index_manifest_digest,
    p_expected_entry_count, p_expected_shard_count, p_expected_entry_set_sha256, p_expected_shard_set_sha256,
    v_token, v_until)
  ON CONFLICT (publication_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_existing FROM public.case_graph_content_search_builds
    WHERE publication_id = p_publication_id FOR UPDATE;
    IF v_existing.public_manifest_sha256 <> p_public_manifest_sha256
      OR v_existing.accounting_receipt_digest <> p_accounting_receipt_digest
      OR v_existing.index_manifest_digest <> p_index_manifest_digest
      OR v_existing.expected_entry_count <> p_expected_entry_count
      OR v_existing.expected_shard_count <> p_expected_shard_count
      OR v_existing.expected_entry_set_sha256 <> p_expected_entry_set_sha256
      OR v_existing.expected_shard_set_sha256 <> p_expected_shard_set_sha256
    THEN RAISE EXCEPTION 'case-graph content search build binding mismatch'; END IF;
    IF v_existing.status <> 'building' OR v_existing.leased_until > pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'case-graph content search build busy';
    END IF;
    v_until := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);
    UPDATE public.case_graph_content_search_builds
    SET lease_token = v_token, leased_until = v_until
    WHERE publication_id = p_publication_id;
  END IF;
  RETURN QUERY SELECT v_token, v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_case_graph_content_search_shard(
  p_publication_id UUID, p_lease_token UUID, p_shard_number INTEGER, p_shard_digest TEXT,
  p_source_object_sha256 TEXT, p_entry_set_sha256 TEXT, p_entries JSONB
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER;
BEGIN
  IF jsonb_typeof(p_entries) <> 'array' THEN RAISE EXCEPTION 'content search shard payload invalid'; END IF;
  v_count := jsonb_array_length(p_entries);
  IF v_count NOT BETWEEN 1 AND 4096 THEN RAISE EXCEPTION 'content search shard size invalid'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_entries) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
      OR NOT item.value ?& ARRAY[
        'chunk_id','chunk_digest','entry_id','entry_digest','address','node_digest','asset_id','asset_digest',
        'extraction_contract_digest','extraction_receipt_digest','extraction_pointer_digest',
        'chunks_object_key','chunks_object_sha256','media_kind','text_origin','locator','text','language','confidence'
      ]
      OR (item.value - ARRAY[
        'chunk_id','chunk_digest','entry_id','entry_digest','address','node_digest','asset_id','asset_digest',
        'extraction_contract_digest','extraction_receipt_digest','extraction_pointer_digest',
        'chunks_object_key','chunks_object_sha256','media_kind','text_origin','locator','text','language','confidence'
      ]) <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'content search shard entry shape invalid'; END IF;
  PERFORM 1 FROM public.case_graph_content_search_builds WHERE publication_id = p_publication_id
    AND lease_token = p_lease_token AND leased_until > pg_catalog.clock_timestamp() AND status = 'building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'content search build lease invalid'; END IF;
  INSERT INTO public.case_graph_content_search_chunks(
    publication_id, chunk_id, chunk_digest, entry_id, entry_digest, address, node_digest,
    asset_id, asset_digest, extraction_contract_digest, extraction_receipt_digest,
    extraction_pointer_digest, chunks_object_key, chunks_object_sha256, media_kind,
    text_origin, locator, text, language, confidence, source_shard
  ) SELECT p_publication_id, x.chunk_id, x.chunk_digest, x.entry_id, x.entry_digest, x.address,
    x.node_digest, x.asset_id, x.asset_digest, x.extraction_contract_digest,
    x.extraction_receipt_digest, x.extraction_pointer_digest, x.chunks_object_key,
    x.chunks_object_sha256, x.media_kind, x.text_origin, x.locator, x.text, x.language,
    x.confidence, p_shard_number
  FROM pg_catalog.jsonb_to_recordset(p_entries) AS x(
    chunk_id TEXT, chunk_digest TEXT, entry_id TEXT, entry_digest TEXT, address TEXT,
    node_digest TEXT, asset_id TEXT, asset_digest TEXT, extraction_contract_digest TEXT,
    extraction_receipt_digest TEXT, extraction_pointer_digest TEXT, chunks_object_key TEXT,
    chunks_object_sha256 TEXT, media_kind TEXT, text_origin TEXT, locator JSONB, text TEXT,
    language TEXT, confidence DOUBLE PRECISION
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> jsonb_array_length(p_entries) THEN RAISE EXCEPTION 'content search shard accounting mismatch'; END IF;
  INSERT INTO public.case_graph_content_search_source_shards(
    publication_id, shard_number, shard_digest, source_object_sha256, entry_set_sha256, entry_count
  ) VALUES (p_publication_id, p_shard_number, p_shard_digest, p_source_object_sha256, p_entry_set_sha256, v_count);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_case_graph_content_search_build(
  p_publication_id UUID, p_lease_token UUID, p_lease_seconds INTEGER DEFAULT 300
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_until TIMESTAMPTZ;
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 900 THEN RAISE EXCEPTION 'content search lease duration invalid'; END IF;
  v_until := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);
  UPDATE public.case_graph_content_search_builds SET leased_until = v_until
  WHERE publication_id = p_publication_id AND lease_token = p_lease_token
    AND leased_until > pg_catalog.clock_timestamp() AND status = 'building';
  IF NOT FOUND THEN RAISE EXCEPTION 'content search build lease invalid'; END IF;
  RETURN v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_case_graph_content_search_build(
  p_publication_id UUID, p_lease_token UUID, p_failure_code TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_failure_code !~ '^[a-z0-9][a-z0-9._:-]{0,239}$' THEN
    RAISE EXCEPTION 'content search failure code invalid';
  END IF;
  UPDATE public.case_graph_content_search_builds SET status = 'failed', failure_code = p_failure_code,
    leased_until = pg_catalog.clock_timestamp()
  WHERE publication_id = p_publication_id AND lease_token = p_lease_token
    AND status = 'building';
  IF NOT FOUND THEN RAISE EXCEPTION 'content search build lease invalid'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_case_graph_content_search_build(
  p_publication_id UUID, p_lease_token UUID, p_observed_entry_set_sha256 TEXT,
  p_observed_shard_set_sha256 TEXT, p_db_entry_set_sha256 TEXT,
  p_completion_receipt_key TEXT, p_completion_receipt_sha256 TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_entries BIGINT; v_shards INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_entries FROM public.case_graph_content_search_chunks WHERE publication_id = p_publication_id;
  SELECT COUNT(*) INTO v_shards FROM public.case_graph_content_search_source_shards WHERE publication_id = p_publication_id;
  UPDATE public.case_graph_content_search_builds SET
    indexed_entry_count = v_entries, indexed_shard_count = v_shards,
    db_entry_set_sha256 = p_db_entry_set_sha256, status = 'verified',
    completion_receipt_key = p_completion_receipt_key,
    completion_receipt_sha256 = p_completion_receipt_sha256,
    verified_at = pg_catalog.clock_timestamp(), leased_until = pg_catalog.clock_timestamp()
  WHERE publication_id = p_publication_id AND lease_token = p_lease_token
    AND leased_until > pg_catalog.clock_timestamp() AND status = 'building'
    AND expected_entry_count = v_entries AND expected_shard_count = v_shards
    AND expected_entry_set_sha256 = p_observed_entry_set_sha256
    AND expected_shard_set_sha256 = p_observed_shard_set_sha256
    AND p_db_entry_set_sha256 ~ '^[a-f0-9]{64}$'
    AND p_completion_receipt_sha256 ~ '^[a-f0-9]{64}$' AND p_completion_receipt_key <> '';
  IF NOT FOUND THEN RAISE EXCEPTION 'content search verification accounting mismatch'; END IF;
END;
$$;

REVOKE ALL ON public.case_graph_content_search_builds FROM PUBLIC;
REVOKE ALL ON public.case_graph_content_search_chunks FROM PUBLIC;
REVOKE ALL ON public.case_graph_content_search_source_shards FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_case_graph_content_search_build(UUID,TEXT,TEXT,TEXT,BIGINT,INTEGER,TEXT,TEXT,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_case_graph_content_search_shard(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renew_case_graph_content_search_build(UUID,UUID,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_case_graph_content_search_build(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_case_graph_content_search_build(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_content_search_append_only_guard() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.case_graph_content_search_builds, public.case_graph_content_search_chunks,
      public.case_graph_content_search_source_shards FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.case_graph_content_search_builds, public.case_graph_content_search_chunks,
      public.case_graph_content_search_source_shards FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.case_graph_content_search_builds, public.case_graph_content_search_chunks,
      public.case_graph_content_search_source_shards TO service_role;
    REVOKE INSERT, UPDATE, DELETE ON public.case_graph_content_search_builds,
      public.case_graph_content_search_chunks, public.case_graph_content_search_source_shards FROM service_role;
    GRANT EXECUTE ON FUNCTION public.create_case_graph_content_search_build(UUID,TEXT,TEXT,TEXT,BIGINT,INTEGER,TEXT,TEXT,INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ingest_case_graph_content_search_shard(UUID,UUID,INTEGER,TEXT,TEXT,TEXT,JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.renew_case_graph_content_search_build(UUID,UUID,INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_case_graph_content_search_build(UUID,UUID,TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.verify_case_graph_content_search_build(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
  END IF;
END $$;
