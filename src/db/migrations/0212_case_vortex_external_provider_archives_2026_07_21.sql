-- Immutable, publication-bound provider inputs for Case Vortex external
-- correlations. R2 holds the canonical archive object; PostgreSQL holds a
-- digest-verified, bounded materialization used by provider adapters.

INSERT INTO public.uap_source_legal_registry
  (canonical_source, legal_status, allowed_content_modes)
VALUES
  ('SONDEHUB_ARCHIVE', 'review', ARRAY['metadata_only']::text[]),
  ('IGRA2', 'review', ARRAY['metadata_only']::text[]),
  ('MARITIME_ZONE_CONTEXT', 'review', ARRAY['metadata_only']::text[]),
  ('NASA_CNEOS_FIREBALL', 'review', ARRAY['metadata_only']::text[]),
  ('ROCKETLAUNCH_LIVE', 'review', ARRAY['metadata_only']::text[])
ON CONFLICT (canonical_source) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.case_graph_external_provider_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN (
    'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
    'military_exercise', 'launch', 'maritime', 'weather'
  )),
  canonical_source TEXT NOT NULL REFERENCES public.uap_source_legal_registry(canonical_source) ON DELETE RESTRICT,
  content_mode TEXT NOT NULL CHECK (content_mode IN ('full_ingest', 'metadata_only', 'derived_only', 'all')),
  provider_id TEXT NOT NULL CHECK (octet_length(provider_id) BETWEEN 1 AND 240),
  dataset_version TEXT NOT NULL CHECK (octet_length(dataset_version) BETWEEN 1 AND 240),
  coverage_start TIMESTAMPTZ,
  coverage_end TIMESTAMPTZ,
  acquired_at TIMESTAMPTZ NOT NULL,
  source_url TEXT CHECK (source_url IS NULL OR octet_length(source_url) <= 2000),
  license TEXT CHECK (license IS NULL OR octet_length(license) <= 500),
  archive_object_key TEXT NOT NULL CHECK (octet_length(archive_object_key) BETWEEN 1 AND 4096),
  archive_object_sha256 VARCHAR(64) NOT NULL CHECK (archive_object_sha256 ~ '^[a-f0-9]{64}$'),
  archive_object_bytes BIGINT NOT NULL CHECK (archive_object_bytes BETWEEN 1 AND 34359738368),
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'complete')),
  record_count BIGINT CHECK (record_count IS NULL OR record_count BETWEEN 0 AND 9007199254740991),
  record_set_sha256 VARCHAR(64) CHECK (record_set_sha256 IS NULL OR record_set_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_sha256 VARCHAR(64) CHECK (receipt_sha256 IS NULL OR receipt_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (coverage_start IS NULL OR coverage_end IS NULL OR coverage_start <= coverage_end),
  CHECK (
    archive_object_key ~ '^case-vortex/external-providers/[a-z0-9/_-]+/[a-f0-9]{64}\.ndjson\.gz$'
    AND archive_object_key LIKE '%' || archive_object_sha256 || '.ndjson.gz'
  ),
  CHECK (
    (status = 'building' AND record_count IS NULL AND record_set_sha256 IS NULL AND receipt_sha256 IS NULL AND completed_at IS NULL)
    OR
    (status = 'complete' AND record_count IS NOT NULL AND record_set_sha256 IS NOT NULL AND receipt_sha256 IS NOT NULL AND completed_at IS NOT NULL)
  ),
  UNIQUE (publication_id, category, provider_id, dataset_version, archive_object_sha256)
);

CREATE TABLE IF NOT EXISTS public.case_graph_external_provider_archive_records (
  snapshot_id UUID NOT NULL REFERENCES public.case_graph_external_provider_archives(id) ON DELETE RESTRICT,
  publication_id UUID NOT NULL,
  address TEXT NOT NULL,
  node_digest VARCHAR(64) NOT NULL CHECK (node_digest ~ '^[a-f0-9]{64}$'),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'insufficient_evidence', 'unavailable', 'stale')),
  reason_codes JSONB NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array' AND octet_length(reason_codes::text) <= 8192),
  explanation TEXT NOT NULL CHECK (octet_length(explanation) BETWEEN 1 AND 4000),
  candidates JSONB NOT NULL CHECK (jsonb_typeof(candidates) = 'array' AND octet_length(candidates::text) <= 1048576),
  record_digest VARCHAR(64) NOT NULL CHECK (record_digest ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (snapshot_id, address),
  FOREIGN KEY (publication_id, address)
    REFERENCES public.case_graph_research_search_publication_nodes(publication_id, address) ON DELETE RESTRICT,
  CHECK (availability = 'available' OR candidates = '[]'::jsonb)
);

CREATE INDEX IF NOT EXISTS idx_case_graph_external_provider_archives_publication
  ON public.case_graph_external_provider_archives (publication_id, category, status, id);
CREATE INDEX IF NOT EXISTS idx_case_graph_external_provider_records_publication
  ON public.case_graph_external_provider_archive_records (publication_id, address, snapshot_id);

CREATE OR REPLACE FUNCTION public.case_graph_external_provider_archive_record_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_publication_id UUID;
BEGIN
  SELECT status, publication_id INTO v_status, v_publication_id
  FROM public.case_graph_external_provider_archives
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.snapshot_id ELSE NEW.snapshot_id END
  FOR SHARE;
  IF NOT FOUND OR v_status <> 'building'
    OR (TG_OP <> 'DELETE' AND v_publication_id IS DISTINCT FROM NEW.publication_id) THEN
    RAISE EXCEPTION 'external provider archive is not writable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_external_provider_archive_immutable_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'complete' THEN
    RAISE EXCEPTION 'completed external provider archive is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_finalize_external_provider_archive(
  p_snapshot_id UUID,
  p_record_count BIGINT,
  p_record_set_sha256 VARCHAR(64),
  p_receipt_sha256 VARCHAR(64)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_count BIGINT;
  v_set_sha256 VARCHAR(64);
BEGIN
  IF p_record_count < 0 OR p_record_count > 9007199254740991
    OR p_record_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_receipt_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'external provider archive completion is invalid';
  END IF;
  SELECT status INTO v_status
  FROM public.case_graph_external_provider_archives WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'building' THEN
    RAISE EXCEPTION 'external provider archive cannot be finalized';
  END IF;
  SELECT COUNT(*)::bigint,
         encode(sha256(convert_to(COALESCE(string_agg(address || ':' || record_digest, E'\n' ORDER BY address COLLATE "C"), ''), 'UTF8')), 'hex')
    INTO v_count, v_set_sha256
  FROM public.case_graph_external_provider_archive_records WHERE snapshot_id = p_snapshot_id;
  IF v_count <> p_record_count OR v_set_sha256 <> p_record_set_sha256 THEN
    RAISE EXCEPTION 'external provider archive accounting mismatch';
  END IF;
  UPDATE public.case_graph_external_provider_archives
  SET status = 'complete', record_count = p_record_count, record_set_sha256 = p_record_set_sha256,
      receipt_sha256 = p_receipt_sha256, completed_at = pg_catalog.clock_timestamp()
  WHERE id = p_snapshot_id;
END;
$$;

CREATE TRIGGER case_graph_external_provider_archive_record_insert_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.case_graph_external_provider_archive_records
  FOR EACH ROW EXECUTE FUNCTION public.case_graph_external_provider_archive_record_guard();
CREATE TRIGGER case_graph_external_provider_archive_immutable_guard
  BEFORE UPDATE OR DELETE ON public.case_graph_external_provider_archives
  FOR EACH ROW EXECUTE FUNCTION public.case_graph_external_provider_archive_immutable_guard();

ALTER TABLE public.case_graph_external_provider_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_provider_archives FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_provider_archive_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_provider_archive_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_graph_external_provider_archives FROM anon, authenticated;
REVOKE ALL ON public.case_graph_external_provider_archive_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_graph_external_provider_archives TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_graph_external_provider_archive_records TO service_role;
REVOKE ALL ON FUNCTION public.case_graph_finalize_external_provider_archive(UUID, BIGINT, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.case_graph_external_provider_archive_record_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.case_graph_external_provider_archive_immutable_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.case_graph_finalize_external_provider_archive(UUID, BIGINT, VARCHAR, VARCHAR) TO service_role;
CREATE POLICY case_graph_external_provider_archives_service_policy
  ON public.case_graph_external_provider_archives FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY case_graph_external_provider_archive_records_service_policy
  ON public.case_graph_external_provider_archive_records FOR ALL TO service_role USING (true) WITH CHECK (true);
