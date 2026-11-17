-- Publication-pinned external context for Case Vortex. These tables preserve
-- missingness: every category receives an explicit coverage assessment, and a
-- missing/stale feed can never be silently interpreted as "ruled out".

CREATE TABLE IF NOT EXISTS public.case_graph_external_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN (
    'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
    'military_exercise', 'launch', 'maritime', 'weather'
  )),
  provider_id TEXT NOT NULL CHECK (octet_length(provider_id) BETWEEN 1 AND 240),
  dataset_version TEXT NOT NULL CHECK (octet_length(dataset_version) BETWEEN 1 AND 240),
  coverage_start TIMESTAMPTZ,
  coverage_end TIMESTAMPTZ,
  acquired_at TIMESTAMPTZ NOT NULL,
  source_url TEXT CHECK (source_url IS NULL OR octet_length(source_url) <= 2000),
  license TEXT CHECK (license IS NULL OR octet_length(license) <= 500),
  receipt_sha256 VARCHAR(64) NOT NULL CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (category, provider_id, dataset_version, receipt_sha256),
  CHECK (coverage_start IS NULL OR coverage_end IS NULL OR coverage_start <= coverage_end)
);

CREATE TABLE IF NOT EXISTS public.case_graph_external_correlation_coverage (
  publication_id UUID NOT NULL,
  address TEXT NOT NULL,
  node_digest VARCHAR(64) NOT NULL CHECK (node_digest ~ '^[a-f0-9]{64}$'),
  category TEXT NOT NULL CHECK (category IN (
    'aircraft', 'satellite', 'balloon', 'astronomy', 'meteor',
    'military_exercise', 'launch', 'maritime', 'weather'
  )),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'insufficient_evidence', 'unavailable', 'stale')),
  source_snapshot_id UUID REFERENCES public.case_graph_external_source_snapshots(id) ON DELETE RESTRICT,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(reason_codes) = 'array' AND octet_length(reason_codes::text) <= 8192
  ),
  explanation TEXT NOT NULL CHECK (octet_length(explanation) BETWEEN 1 AND 4000),
  checked_at TIMESTAMPTZ NOT NULL,
  assessment_digest VARCHAR(64) NOT NULL CHECK (assessment_digest ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, address, category),
  FOREIGN KEY (publication_id, address)
    REFERENCES public.case_graph_research_search_publication_nodes(publication_id, address) ON DELETE CASCADE,
  CHECK ((availability = 'available' AND source_snapshot_id IS NOT NULL) OR availability <> 'available')
);

CREATE TABLE IF NOT EXISTS public.case_graph_external_correlation_candidates (
  publication_id UUID NOT NULL,
  address TEXT NOT NULL,
  category TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id ~ '^external-correlation:[a-f0-9]{64}$'),
  source_snapshot_id UUID NOT NULL REFERENCES public.case_graph_external_source_snapshots(id) ON DELETE RESTRICT,
  source_record_id TEXT NOT NULL CHECK (octet_length(source_record_id) BETWEEN 1 AND 500),
  label TEXT NOT NULL CHECK (octet_length(label) BETWEEN 1 AND 500),
  observed_at TIMESTAMPTZ,
  measurements JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(measurements) = 'object' AND octet_length(measurements::text) <= 16384
  ),
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(reason_codes) = 'array' AND octet_length(reason_codes::text) <= 8192
  ),
  explanation TEXT NOT NULL CHECK (octet_length(explanation) BETWEEN 1 AND 4000),
  uncertainty JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(uncertainty) = 'array' AND octet_length(uncertainty::text) <= 32768
  ),
  candidate_digest VARCHAR(64) NOT NULL CHECK (candidate_digest ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, address, category, candidate_id),
  FOREIGN KEY (publication_id, address, category)
    REFERENCES public.case_graph_external_correlation_coverage(publication_id, address, category) ON DELETE CASCADE,
  CHECK (candidate_id = 'external-correlation:' || candidate_digest)
);

CREATE TABLE IF NOT EXISTS public.case_graph_external_correlation_completions (
  publication_id UUID PRIMARY KEY REFERENCES public.uap_case_graph_publications(id) ON DELETE CASCADE,
  manifest_sha256 VARCHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  category_set JSONB NOT NULL CHECK (jsonb_typeof(category_set) = 'array'),
  source_snapshot_set_sha256 VARCHAR(64) NOT NULL CHECK (source_snapshot_set_sha256 ~ '^[a-f0-9]{64}$'),
  coverage_set_sha256 VARCHAR(64) NOT NULL CHECK (coverage_set_sha256 ~ '^[a-f0-9]{64}$'),
  candidate_set_sha256 VARCHAR(64) NOT NULL CHECK (candidate_set_sha256 ~ '^[a-f0-9]{64}$'),
  completion_sha256 VARCHAR(64) NOT NULL CHECK (completion_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at TIMESTAMPTZ NOT NULL,
  accounting JSONB NOT NULL CHECK (jsonb_typeof(accounting) = 'object' AND octet_length(accounting::text) <= 65536)
);

CREATE INDEX IF NOT EXISTS idx_case_graph_external_coverage_address
  ON public.case_graph_external_correlation_coverage (publication_id, address, category);
CREATE INDEX IF NOT EXISTS idx_case_graph_external_candidates_rank
  ON public.case_graph_external_correlation_candidates (publication_id, address, category, observed_at, candidate_id);

CREATE OR REPLACE FUNCTION public.case_graph_external_candidate_coverage_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_availability TEXT;
  v_source_snapshot_id UUID;
BEGIN
  SELECT coverage.availability, coverage.source_snapshot_id
    INTO v_availability, v_source_snapshot_id
    FROM public.case_graph_external_correlation_coverage AS coverage
    WHERE coverage.publication_id = NEW.publication_id
      AND coverage.address = NEW.address
      AND coverage.category = NEW.category;
  IF NOT FOUND
    OR v_availability <> 'available'
    OR v_source_snapshot_id IS DISTINCT FROM NEW.source_snapshot_id
  THEN
    RAISE EXCEPTION 'external correlation candidate coverage mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS case_graph_external_candidate_coverage_guard
  ON public.case_graph_external_correlation_candidates;
CREATE TRIGGER case_graph_external_candidate_coverage_guard
  BEFORE INSERT OR UPDATE OF publication_id, address, category, source_snapshot_id
  ON public.case_graph_external_correlation_candidates
  FOR EACH ROW EXECUTE FUNCTION public.case_graph_external_candidate_coverage_guard();

ALTER TABLE public.case_graph_external_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_source_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_correlation_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_correlation_coverage FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_correlation_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_correlation_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_correlation_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_external_correlation_completions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.case_graph_external_source_snapshots FROM anon, authenticated;
REVOKE ALL ON public.case_graph_external_correlation_coverage FROM anon, authenticated;
REVOKE ALL ON public.case_graph_external_correlation_candidates FROM anon, authenticated;
REVOKE ALL ON public.case_graph_external_correlation_completions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_graph_external_source_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_graph_external_correlation_coverage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_graph_external_correlation_candidates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_graph_external_correlation_completions TO service_role;

REVOKE ALL ON FUNCTION public.case_graph_external_candidate_coverage_guard() FROM PUBLIC;

CREATE POLICY case_graph_external_source_snapshots_service_policy
  ON public.case_graph_external_source_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY case_graph_external_coverage_service_policy
  ON public.case_graph_external_correlation_coverage FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY case_graph_external_candidates_service_policy
  ON public.case_graph_external_correlation_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY case_graph_external_completions_service_policy
  ON public.case_graph_external_correlation_completions FOR ALL TO service_role USING (true) WITH CHECK (true);
