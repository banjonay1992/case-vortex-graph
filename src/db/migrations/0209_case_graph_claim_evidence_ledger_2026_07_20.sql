-- Immutable, publication-pinned serving projection for atomic claims, explicit
-- claim-to-claim stances and explainable source reliability assessments.
-- Canonical R2 artefacts remain authoritative. PostgreSQL rows are private and
-- may be served only after an exact completion receipt reaches `verified`.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE TABLE IF NOT EXISTS public.case_graph_claim_evidence_builds (
  publication_id UUID PRIMARY KEY
    REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  public_manifest_sha256 VARCHAR(64) NOT NULL
    CHECK (public_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  graph_artifact_set_sha256 VARCHAR(64) NOT NULL
    CHECK (graph_artifact_set_sha256 ~ '^[a-f0-9]{64}$'),
  claim_artifact_sha256 VARCHAR(64) NOT NULL
    CHECK (claim_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version TEXT COLLATE "C" NOT NULL
    CHECK (schema_version = 'case-graph-claim-evidence-v1'),
  reliability_schema_version TEXT COLLATE "C" NOT NULL
    CHECK (reliability_schema_version = 'case-graph-source-reliability-v1'),
  expected_claim_count BIGINT NOT NULL
    CHECK (expected_claim_count BETWEEN 0 AND 9007199254740991),
  expected_link_count BIGINT NOT NULL
    CHECK (expected_link_count BETWEEN 0 AND 9007199254740991),
  expected_assessment_count BIGINT NOT NULL
    CHECK (expected_assessment_count BETWEEN 0 AND 9007199254740991),
  expected_claim_set_sha256 VARCHAR(64) NOT NULL
    CHECK (expected_claim_set_sha256 ~ '^[a-f0-9]{64}$'),
  expected_link_set_sha256 VARCHAR(64) NOT NULL
    CHECK (expected_link_set_sha256 ~ '^[a-f0-9]{64}$'),
  expected_assessment_set_sha256 VARCHAR(64) NOT NULL
    CHECK (expected_assessment_set_sha256 ~ '^[a-f0-9]{64}$'),
  indexed_claim_count BIGINT,
  indexed_link_count BIGINT,
  indexed_assessment_count BIGINT,
  db_claim_set_sha256 VARCHAR(64),
  db_link_set_sha256 VARCHAR(64),
  db_assessment_set_sha256 VARCHAR(64),
  status TEXT COLLATE "C" NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'verified', 'failed')),
  lease_token UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  leased_until TIMESTAMPTZ NOT NULL,
  completion_receipt_key TEXT COLLATE "C",
  completion_receipt_sha256 VARCHAR(64),
  verified_at TIMESTAMPTZ,
  failure_code TEXT COLLATE "C",
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    (status = 'building'
      AND indexed_claim_count IS NULL AND indexed_link_count IS NULL
      AND indexed_assessment_count IS NULL AND db_claim_set_sha256 IS NULL
      AND db_link_set_sha256 IS NULL AND db_assessment_set_sha256 IS NULL
      AND completion_receipt_key IS NULL AND completion_receipt_sha256 IS NULL
      AND verified_at IS NULL AND failure_code IS NULL AND failed_at IS NULL
      AND leased_until > created_at)
    OR
    (status = 'verified'
      AND indexed_claim_count = expected_claim_count
      AND indexed_link_count = expected_link_count
      AND indexed_assessment_count = expected_assessment_count
      AND db_claim_set_sha256 ~ '^[a-f0-9]{64}$'
      AND db_link_set_sha256 ~ '^[a-f0-9]{64}$'
      AND db_assessment_set_sha256 ~ '^[a-f0-9]{64}$'
      AND completion_receipt_key IS NOT NULL
      AND completion_receipt_sha256 ~ '^[a-f0-9]{64}$'
      AND verified_at IS NOT NULL AND failure_code IS NULL AND failed_at IS NULL
      AND leased_until <= verified_at)
    OR
    (status = 'failed' AND verified_at IS NULL AND failed_at IS NOT NULL
      AND completion_receipt_key IS NULL AND completion_receipt_sha256 IS NULL
      AND failure_code ~ '^[a-z0-9][a-z0-9._:-]{0,239}$'
      AND leased_until <= failed_at)
  )
);

CREATE TABLE IF NOT EXISTS public.case_graph_atomic_claims (
  publication_id UUID NOT NULL
    REFERENCES public.case_graph_claim_evidence_builds(publication_id) ON DELETE RESTRICT,
  claim_id TEXT COLLATE "C" NOT NULL
    CHECK (claim_id ~ '^claim:[a-f0-9]{64}$'),
  claim_digest VARCHAR(64) NOT NULL CHECK (claim_digest ~ '^[a-f0-9]{64}$'),
  address TEXT COLLATE "C" NOT NULL
    CHECK (address ~ '^[a-z][a-z0-9_]*:[^[:space:]]+$' AND octet_length(address) <= 1024),
  source_id TEXT COLLATE "C" NOT NULL
    CHECK (source_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  subject TEXT COLLATE "C" NOT NULL CHECK (octet_length(subject) BETWEEN 1 AND 2000),
  predicate TEXT COLLATE "C" NOT NULL
    CHECK (predicate ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  object_text TEXT COLLATE "C" NOT NULL CHECK (octet_length(object_text) BETWEEN 1 AND 8000),
  polarity TEXT COLLATE "C" NOT NULL CHECK (polarity IN ('asserted', 'denied')),
  modality TEXT COLLATE "C" NOT NULL
    CHECK (modality IN ('observed', 'reported', 'inferred', 'alleged', 'unknown')),
  source_text TEXT COLLATE "C" NOT NULL CHECK (octet_length(source_text) BETWEEN 1 AND 32768),
  source_text_sha256 VARCHAR(64) NOT NULL CHECK (source_text_sha256 ~ '^[a-f0-9]{64}$'),
  locator JSONB NOT NULL CHECK (
    jsonb_typeof(locator) = 'object'
    AND octet_length(locator::text) <= 16384
    AND locator->>'kind' IN ('record_field', 'document_page', 'timed_media', 'image_region')
  ),
  extraction_method TEXT COLLATE "C" NOT NULL
    CHECK (extraction_method IN ('structured', 'deterministic_rule', 'governed_model', 'manual_review')),
  extraction_version TEXT COLLATE "C" NOT NULL
    CHECK (extraction_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  extraction_confidence DOUBLE PRECISION CHECK (extraction_confidence BETWEEN 0 AND 1),
  review_status TEXT COLLATE "C" NOT NULL
    CHECK (review_status IN ('unreviewed', 'reviewed', 'disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, claim_id),
  UNIQUE (publication_id, claim_digest)
);

CREATE TABLE IF NOT EXISTS public.case_graph_claim_links (
  publication_id UUID NOT NULL
    REFERENCES public.case_graph_claim_evidence_builds(publication_id) ON DELETE RESTRICT,
  link_id TEXT COLLATE "C" NOT NULL
    CHECK (link_id ~ '^claim-link:[a-f0-9]{64}$'),
  link_digest VARCHAR(64) NOT NULL CHECK (link_digest ~ '^[a-f0-9]{64}$'),
  from_claim_id TEXT COLLATE "C" NOT NULL,
  to_claim_id TEXT COLLATE "C" NOT NULL,
  stance TEXT COLLATE "C" NOT NULL
    CHECK (stance IN ('supports', 'contradicts', 'repeats', 'contextualizes', 'uncertain')),
  lineage TEXT COLLATE "C" NOT NULL
    CHECK (lineage IN ('independent', 'shared_lineage', 'unknown')),
  rationale TEXT COLLATE "C" NOT NULL CHECK (octet_length(rationale) BETWEEN 1 AND 8000),
  confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  determination_method TEXT COLLATE "C" NOT NULL
    CHECK (determination_method IN ('deterministic_rule', 'governed_model', 'manual_review')),
  determination_version TEXT COLLATE "C" NOT NULL
    CHECK (determination_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  review_status TEXT COLLATE "C" NOT NULL
    CHECK (review_status IN ('unreviewed', 'reviewed', 'disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, link_id),
  UNIQUE (publication_id, link_digest),
  FOREIGN KEY (publication_id, from_claim_id)
    REFERENCES public.case_graph_atomic_claims(publication_id, claim_id) ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, to_claim_id)
    REFERENCES public.case_graph_atomic_claims(publication_id, claim_id) ON DELETE RESTRICT,
  CHECK (from_claim_id <> to_claim_id),
  CHECK (stance <> 'repeats' OR lineage <> 'independent')
);

CREATE TABLE IF NOT EXISTS public.case_graph_source_reliability_assessments (
  publication_id UUID NOT NULL
    REFERENCES public.case_graph_claim_evidence_builds(publication_id) ON DELETE RESTRICT,
  assessment_id TEXT COLLATE "C" NOT NULL
    CHECK (assessment_id ~ '^source-assessment:[a-f0-9]{64}$'),
  assessment_digest VARCHAR(64) NOT NULL CHECK (assessment_digest ~ '^[a-f0-9]{64}$'),
  address TEXT COLLATE "C" NOT NULL
    CHECK (address ~ '^[a-z][a-z0-9_]*:[^[:space:]]+$' AND octet_length(address) <= 1024),
  source_id TEXT COLLATE "C" NOT NULL
    CHECK (source_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  source_label TEXT COLLATE "C" NOT NULL CHECK (octet_length(source_label) BETWEEN 1 AND 2000),
  lineage_id TEXT COLLATE "C" NOT NULL
    CHECK (lineage_id ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  source_position TEXT COLLATE "C" NOT NULL CHECK (source_position IN ('primary', 'secondary', 'mixed', 'unknown')),
  contemporaneity TEXT COLLATE "C" NOT NULL CHECK (contemporaneity IN ('contemporaneous', 'near_contemporary', 'retrospective', 'unknown')),
  witness_identity TEXT COLLATE "C" NOT NULL CHECK (witness_identity IN ('named', 'anonymous', 'institutional', 'not_applicable', 'unknown')),
  originality TEXT COLLATE "C" NOT NULL CHECK (originality IN ('original', 'derived', 'copy', 'unknown')),
  independence TEXT COLLATE "C" NOT NULL CHECK (independence IN ('independent', 'shared_lineage', 'not_applicable', 'unknown')),
  provenance TEXT COLLATE "C" NOT NULL CHECK (provenance IN ('complete', 'partial', 'missing')),
  corroboration TEXT COLLATE "C" NOT NULL CHECK (corroboration IN ('none', 'single_independent', 'multiple_independent', 'shared_lineage_only', 'unknown')),
  independent_source_count INTEGER NOT NULL CHECK (independent_source_count BETWEEN 0 AND 1000000),
  shared_lineage_source_count INTEGER NOT NULL CHECK (shared_lineage_source_count BETWEEN 0 AND 1000000),
  dimensions JSONB NOT NULL CHECK (jsonb_typeof(dimensions) = 'object' AND octet_length(dimensions::text) <= 65536),
  overall_category TEXT COLLATE "C" NOT NULL CHECK (overall_category IN ('high', 'medium', 'low', 'indeterminate')),
  overall_reason_codes JSONB NOT NULL CHECK (jsonb_typeof(overall_reason_codes) = 'array' AND jsonb_array_length(overall_reason_codes) BETWEEN 1 AND 32),
  overall_explanation TEXT COLLATE "C" NOT NULL CHECK (octet_length(overall_explanation) BETWEEN 1 AND 8000),
  limitations JSONB NOT NULL CHECK (jsonb_typeof(limitations) = 'array' AND jsonb_array_length(limitations) <= 64),
  assessment_method TEXT COLLATE "C" NOT NULL
    CHECK (assessment_method IN ('deterministic_rule', 'governed_model', 'manual_review')),
  assessment_version TEXT COLLATE "C" NOT NULL
    CHECK (assessment_version ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'),
  review_status TEXT COLLATE "C" NOT NULL
    CHECK (review_status IN ('unreviewed', 'reviewed', 'disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (publication_id, assessment_id),
  UNIQUE (publication_id, address, source_id),
  UNIQUE (publication_id, assessment_digest),
  CHECK (corroboration <> 'multiple_independent' OR independent_source_count >= 2),
  CHECK (corroboration <> 'single_independent' OR independent_source_count = 1),
  CHECK (corroboration <> 'shared_lineage_only'
    OR (independent_source_count = 0 AND shared_lineage_source_count >= 1))
);

CREATE INDEX IF NOT EXISTS case_graph_atomic_claims_address_idx
  ON public.case_graph_atomic_claims (publication_id, address, claim_id);
CREATE INDEX IF NOT EXISTS case_graph_atomic_claims_spo_idx
  ON public.case_graph_atomic_claims (publication_id, predicate, subject, claim_id);
CREATE INDEX IF NOT EXISTS case_graph_claim_links_from_idx
  ON public.case_graph_claim_links (publication_id, from_claim_id, stance, link_id);
CREATE INDEX IF NOT EXISTS case_graph_claim_links_to_idx
  ON public.case_graph_claim_links (publication_id, to_claim_id, stance, link_id);
CREATE INDEX IF NOT EXISTS case_graph_source_reliability_address_idx
  ON public.case_graph_source_reliability_assessments (publication_id, address, assessment_id);

CREATE OR REPLACE FUNCTION public.case_graph_claim_evidence_sha256_text(p_value TEXT)
RETURNS VARCHAR(64)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')),
    'hex'
  )::varchar(64);
$$;

CREATE OR REPLACE FUNCTION public.create_case_graph_claim_evidence_build(
  p_publication_id UUID,
  p_public_manifest_sha256 TEXT,
  p_graph_artifact_set_sha256 TEXT,
  p_claim_artifact_sha256 TEXT,
  p_expected_claim_count BIGINT,
  p_expected_link_count BIGINT,
  p_expected_assessment_count BIGINT,
  p_expected_claim_set_sha256 TEXT,
  p_expected_link_set_sha256 TEXT,
  p_expected_assessment_set_sha256 TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(lease_token UUID, leased_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_token UUID := pg_catalog.gen_random_uuid();
  v_until TIMESTAMPTZ;
  v_existing public.case_graph_claim_evidence_builds%ROWTYPE;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 900
    OR p_public_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_graph_artifact_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_claim_artifact_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_claim_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_link_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_assessment_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_claim_count NOT BETWEEN 0 AND 9007199254740991
    OR p_expected_link_count NOT BETWEEN 0 AND 9007199254740991
    OR p_expected_assessment_count NOT BETWEEN 0 AND 9007199254740991
  THEN RAISE EXCEPTION 'claim evidence build binding invalid'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uap_case_graph_publications AS publication
    WHERE publication.id = p_publication_id
      AND publication.public_manifest_sha256 = p_public_manifest_sha256
  ) THEN RAISE EXCEPTION 'claim evidence publication mismatch'; END IF;

  v_until := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);
  INSERT INTO public.case_graph_claim_evidence_builds (
    publication_id, public_manifest_sha256, graph_artifact_set_sha256,
    claim_artifact_sha256, schema_version, reliability_schema_version,
    expected_claim_count, expected_link_count, expected_assessment_count,
    expected_claim_set_sha256, expected_link_set_sha256,
    expected_assessment_set_sha256, lease_token, leased_until
  ) VALUES (
    p_publication_id, p_public_manifest_sha256, p_graph_artifact_set_sha256,
    p_claim_artifact_sha256, 'case-graph-claim-evidence-v1',
    'case-graph-source-reliability-v1', p_expected_claim_count,
    p_expected_link_count, p_expected_assessment_count,
    p_expected_claim_set_sha256, p_expected_link_set_sha256,
    p_expected_assessment_set_sha256, v_token, v_until
  ) ON CONFLICT (publication_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.case_graph_claim_evidence_builds AS build
    WHERE build.publication_id = p_publication_id
    FOR UPDATE;
    IF v_existing.public_manifest_sha256 <> p_public_manifest_sha256
      OR v_existing.graph_artifact_set_sha256 <> p_graph_artifact_set_sha256
      OR v_existing.claim_artifact_sha256 <> p_claim_artifact_sha256
      OR v_existing.expected_claim_count <> p_expected_claim_count
      OR v_existing.expected_link_count <> p_expected_link_count
      OR v_existing.expected_assessment_count <> p_expected_assessment_count
      OR v_existing.expected_claim_set_sha256 <> p_expected_claim_set_sha256
      OR v_existing.expected_link_set_sha256 <> p_expected_link_set_sha256
      OR v_existing.expected_assessment_set_sha256 <> p_expected_assessment_set_sha256
    THEN RAISE EXCEPTION 'claim evidence build binding mismatch'; END IF;
    IF v_existing.status <> 'building'
      OR v_existing.leased_until > pg_catalog.clock_timestamp()
    THEN RAISE EXCEPTION 'claim evidence build busy'; END IF;
    UPDATE public.case_graph_claim_evidence_builds AS build
    SET lease_token = v_token, leased_until = v_until
    WHERE build.publication_id = p_publication_id;
  END IF;
  RETURN QUERY SELECT v_token, v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_case_graph_claim_evidence_build(
  p_publication_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_until TIMESTAMPTZ;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'claim evidence lease duration invalid';
  END IF;
  v_until := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds);
  UPDATE public.case_graph_claim_evidence_builds AS build
  SET leased_until = v_until
  WHERE build.publication_id = p_publication_id
    AND build.lease_token = p_lease_token
    AND build.leased_until > pg_catalog.clock_timestamp()
    AND build.status = 'building';
  IF NOT FOUND THEN RAISE EXCEPTION 'claim evidence build lease invalid'; END IF;
  RETURN v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_case_graph_atomic_claim_batch(
  p_publication_id UUID,
  p_lease_token UUID,
  p_claims JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF pg_catalog.jsonb_typeof(p_claims) <> 'array'
    OR pg_catalog.jsonb_array_length(p_claims) NOT BETWEEN 1 AND 4096
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_claims) AS item(value)
      WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
        OR NOT item.value ?& ARRAY[
          'claim_id','claim_digest','address','source_id','subject','predicate',
          'object_text','polarity','modality','source_text','source_text_sha256',
          'locator','extraction_method','extraction_version','extraction_confidence','review_status'
        ]
        OR (item.value - ARRAY[
          'claim_id','claim_digest','address','source_id','subject','predicate',
          'object_text','polarity','modality','source_text','source_text_sha256',
          'locator','extraction_method','extraction_version','extraction_confidence','review_status'
        ]) <> '{}'::jsonb
    )
  THEN RAISE EXCEPTION 'claim evidence claim batch invalid'; END IF;
  PERFORM 1 FROM public.case_graph_claim_evidence_builds AS build
  WHERE build.publication_id = p_publication_id
    AND build.lease_token = p_lease_token
    AND build.leased_until > pg_catalog.clock_timestamp()
    AND build.status = 'building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim evidence build lease invalid'; END IF;

  INSERT INTO public.case_graph_atomic_claims (
    publication_id, claim_id, claim_digest, address, source_id, subject,
    predicate, object_text, polarity, modality, source_text, source_text_sha256,
    locator, extraction_method, extraction_version, extraction_confidence, review_status
  ) SELECT p_publication_id, x.claim_id, x.claim_digest, x.address, x.source_id,
    x.subject, x.predicate, x.object_text, x.polarity, x.modality, x.source_text,
    x.source_text_sha256, x.locator, x.extraction_method, x.extraction_version,
    x.extraction_confidence, x.review_status
  FROM pg_catalog.jsonb_to_recordset(p_claims) AS x(
    claim_id TEXT, claim_digest TEXT, address TEXT, source_id TEXT, subject TEXT,
    predicate TEXT, object_text TEXT, polarity TEXT, modality TEXT, source_text TEXT,
    source_text_sha256 TEXT, locator JSONB, extraction_method TEXT,
    extraction_version TEXT, extraction_confidence DOUBLE PRECISION, review_status TEXT
  ) ON CONFLICT (publication_id, claim_id) DO NOTHING;

  SELECT pg_catalog.jsonb_array_length(p_claims) INTO v_count;
  IF (SELECT COUNT(DISTINCT item.value->>'claim_id')
      FROM pg_catalog.jsonb_array_elements(p_claims) AS item(value)) <> v_count
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_claims) AS item(value)
      LEFT JOIN public.case_graph_atomic_claims AS claim
        ON claim.publication_id = p_publication_id
        AND claim.claim_id = item.value->>'claim_id'
      WHERE claim.claim_id IS NULL OR claim.claim_digest <> item.value->>'claim_digest'
    )
  THEN RAISE EXCEPTION 'claim evidence claim batch conflict'; END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_case_graph_claim_link_batch(
  p_publication_id UUID,
  p_lease_token UUID,
  p_links JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF pg_catalog.jsonb_typeof(p_links) <> 'array'
    OR pg_catalog.jsonb_array_length(p_links) NOT BETWEEN 1 AND 4096
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_links) AS item(value)
      WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
        OR NOT item.value ?& ARRAY[
          'link_id','link_digest','from_claim_id','to_claim_id','stance','lineage',
          'rationale','confidence','determination_method','determination_version','review_status'
        ]
        OR (item.value - ARRAY[
          'link_id','link_digest','from_claim_id','to_claim_id','stance','lineage',
          'rationale','confidence','determination_method','determination_version','review_status'
        ]) <> '{}'::jsonb
    )
  THEN RAISE EXCEPTION 'claim evidence link batch invalid'; END IF;
  PERFORM 1 FROM public.case_graph_claim_evidence_builds AS build
  WHERE build.publication_id = p_publication_id
    AND build.lease_token = p_lease_token
    AND build.leased_until > pg_catalog.clock_timestamp()
    AND build.status = 'building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim evidence build lease invalid'; END IF;

  INSERT INTO public.case_graph_claim_links (
    publication_id, link_id, link_digest, from_claim_id, to_claim_id, stance,
    lineage, rationale, confidence, determination_method, determination_version, review_status
  ) SELECT p_publication_id, x.link_id, x.link_digest, x.from_claim_id,
    x.to_claim_id, x.stance, x.lineage, x.rationale, x.confidence,
    x.determination_method, x.determination_version, x.review_status
  FROM pg_catalog.jsonb_to_recordset(p_links) AS x(
    link_id TEXT, link_digest TEXT, from_claim_id TEXT, to_claim_id TEXT,
    stance TEXT, lineage TEXT, rationale TEXT, confidence DOUBLE PRECISION,
    determination_method TEXT, determination_version TEXT, review_status TEXT
  ) ON CONFLICT (publication_id, link_id) DO NOTHING;

  SELECT pg_catalog.jsonb_array_length(p_links) INTO v_count;
  IF (SELECT COUNT(DISTINCT item.value->>'link_id')
      FROM pg_catalog.jsonb_array_elements(p_links) AS item(value)) <> v_count
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_links) AS item(value)
      LEFT JOIN public.case_graph_claim_links AS link
        ON link.publication_id = p_publication_id
        AND link.link_id = item.value->>'link_id'
      WHERE link.link_id IS NULL OR link.link_digest <> item.value->>'link_digest'
    )
  THEN RAISE EXCEPTION 'claim evidence link batch conflict'; END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_case_graph_source_reliability_batch(
  p_publication_id UUID,
  p_lease_token UUID,
  p_assessments JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF pg_catalog.jsonb_typeof(p_assessments) <> 'array'
    OR pg_catalog.jsonb_array_length(p_assessments) NOT BETWEEN 1 AND 4096
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assessments) AS item(value)
      WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
        OR NOT item.value ?& ARRAY[
          'assessment_id','assessment_digest','address','source_id','source_label','lineage_id',
          'source_position','contemporaneity','witness_identity','originality','independence',
          'provenance','corroboration','independent_source_count','shared_lineage_source_count',
          'dimensions','overall_category','overall_reason_codes','overall_explanation','limitations',
          'assessment_method','assessment_version','review_status'
        ]
        OR (item.value - ARRAY[
          'assessment_id','assessment_digest','address','source_id','source_label','lineage_id',
          'source_position','contemporaneity','witness_identity','originality','independence',
          'provenance','corroboration','independent_source_count','shared_lineage_source_count',
          'dimensions','overall_category','overall_reason_codes','overall_explanation','limitations',
          'assessment_method','assessment_version','review_status'
        ]) <> '{}'::jsonb
    )
  THEN RAISE EXCEPTION 'claim evidence assessment batch invalid'; END IF;
  PERFORM 1 FROM public.case_graph_claim_evidence_builds AS build
  WHERE build.publication_id = p_publication_id
    AND build.lease_token = p_lease_token
    AND build.leased_until > pg_catalog.clock_timestamp()
    AND build.status = 'building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim evidence build lease invalid'; END IF;

  INSERT INTO public.case_graph_source_reliability_assessments (
    publication_id, assessment_id, assessment_digest, address, source_id,
    source_label, lineage_id, source_position, contemporaneity, witness_identity,
    originality, independence, provenance, corroboration, independent_source_count,
    shared_lineage_source_count, dimensions, overall_category, overall_reason_codes,
    overall_explanation, limitations, assessment_method, assessment_version, review_status
  ) SELECT p_publication_id, x.assessment_id, x.assessment_digest, x.address,
    x.source_id, x.source_label, x.lineage_id, x.source_position, x.contemporaneity,
    x.witness_identity, x.originality, x.independence, x.provenance, x.corroboration,
    x.independent_source_count, x.shared_lineage_source_count, x.dimensions,
    x.overall_category, x.overall_reason_codes, x.overall_explanation, x.limitations,
    x.assessment_method, x.assessment_version, x.review_status
  FROM pg_catalog.jsonb_to_recordset(p_assessments) AS x(
    assessment_id TEXT, assessment_digest TEXT, address TEXT, source_id TEXT,
    source_label TEXT, lineage_id TEXT, source_position TEXT, contemporaneity TEXT,
    witness_identity TEXT, originality TEXT, independence TEXT, provenance TEXT,
    corroboration TEXT, independent_source_count INTEGER,
    shared_lineage_source_count INTEGER, dimensions JSONB, overall_category TEXT,
    overall_reason_codes JSONB, overall_explanation TEXT, limitations JSONB,
    assessment_method TEXT, assessment_version TEXT, review_status TEXT
  ) ON CONFLICT (publication_id, assessment_id) DO NOTHING;

  SELECT pg_catalog.jsonb_array_length(p_assessments) INTO v_count;
  IF (SELECT COUNT(DISTINCT item.value->>'assessment_id')
      FROM pg_catalog.jsonb_array_elements(p_assessments) AS item(value)) <> v_count
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assessments) AS item(value)
      LEFT JOIN public.case_graph_source_reliability_assessments AS assessment
        ON assessment.publication_id = p_publication_id
        AND assessment.assessment_id = item.value->>'assessment_id'
      WHERE assessment.assessment_id IS NULL
        OR assessment.assessment_digest <> item.value->>'assessment_digest'
    )
  THEN RAISE EXCEPTION 'claim evidence assessment batch conflict'; END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_case_graph_claim_evidence_build(
  p_publication_id UUID,
  p_lease_token UUID,
  p_observed_claim_set_sha256 TEXT,
  p_observed_link_set_sha256 TEXT,
  p_observed_assessment_set_sha256 TEXT,
  p_completion_receipt_key TEXT,
  p_completion_receipt_sha256 TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim_count BIGINT;
  v_link_count BIGINT;
  v_assessment_count BIGINT;
  v_claim_set_sha256 VARCHAR(64);
  v_link_set_sha256 VARCHAR(64);
  v_assessment_set_sha256 VARCHAR(64);
BEGIN
  IF p_observed_claim_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_observed_link_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_observed_assessment_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_completion_receipt_sha256 !~ '^[a-f0-9]{64}$'
    OR p_completion_receipt_key IS NULL
    OR pg_catalog.octet_length(p_completion_receipt_key) NOT BETWEEN 1 AND 4096
    OR p_completion_receipt_key ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'claim evidence completion receipt invalid'; END IF;

  SELECT COUNT(*), public.case_graph_claim_evidence_sha256_text(
    '[' || COALESCE(pg_catalog.string_agg(pg_catalog.to_json(claim.claim_digest::text)::text,
      ',' ORDER BY claim.claim_id COLLATE "C"), '') || ']'
  ) INTO v_claim_count, v_claim_set_sha256
  FROM public.case_graph_atomic_claims AS claim
  WHERE claim.publication_id = p_publication_id;

  SELECT COUNT(*), public.case_graph_claim_evidence_sha256_text(
    '[' || COALESCE(pg_catalog.string_agg(pg_catalog.to_json(link.link_digest::text)::text,
      ',' ORDER BY link.link_id COLLATE "C"), '') || ']'
  ) INTO v_link_count, v_link_set_sha256
  FROM public.case_graph_claim_links AS link
  WHERE link.publication_id = p_publication_id;

  SELECT COUNT(*), public.case_graph_claim_evidence_sha256_text(
    '[' || COALESCE(pg_catalog.string_agg(pg_catalog.to_json(assessment.assessment_digest::text)::text,
      ',' ORDER BY assessment.assessment_id COLLATE "C"), '') || ']'
  ) INTO v_assessment_count, v_assessment_set_sha256
  FROM public.case_graph_source_reliability_assessments AS assessment
  WHERE assessment.publication_id = p_publication_id;

  UPDATE public.case_graph_claim_evidence_builds AS build
  SET indexed_claim_count = v_claim_count,
    indexed_link_count = v_link_count,
    indexed_assessment_count = v_assessment_count,
    db_claim_set_sha256 = v_claim_set_sha256,
    db_link_set_sha256 = v_link_set_sha256,
    db_assessment_set_sha256 = v_assessment_set_sha256,
    status = 'verified',
    completion_receipt_key = p_completion_receipt_key,
    completion_receipt_sha256 = p_completion_receipt_sha256,
    verified_at = pg_catalog.clock_timestamp(),
    leased_until = pg_catalog.clock_timestamp()
  WHERE build.publication_id = p_publication_id
    AND build.lease_token = p_lease_token
    AND build.leased_until > pg_catalog.clock_timestamp()
    AND build.status = 'building'
    AND build.expected_claim_count = v_claim_count
    AND build.expected_link_count = v_link_count
    AND build.expected_assessment_count = v_assessment_count
    AND build.expected_claim_set_sha256 = v_claim_set_sha256
    AND build.expected_link_set_sha256 = v_link_set_sha256
    AND build.expected_assessment_set_sha256 = v_assessment_set_sha256
    AND p_observed_claim_set_sha256 = v_claim_set_sha256
    AND p_observed_link_set_sha256 = v_link_set_sha256
    AND p_observed_assessment_set_sha256 = v_assessment_set_sha256;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim evidence verification accounting mismatch'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_case_graph_claim_evidence_build(
  p_publication_id UUID,
  p_lease_token UUID,
  p_failure_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_failed_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_failure_code !~ '^[a-z0-9][a-z0-9._:-]{0,239}$' THEN
    RAISE EXCEPTION 'claim evidence failure code invalid';
  END IF;
  UPDATE public.case_graph_claim_evidence_builds AS build
  SET status = 'failed', failure_code = p_failure_code,
    failed_at = v_failed_at, leased_until = v_failed_at
  WHERE build.publication_id = p_publication_id
    AND build.lease_token = p_lease_token
    AND build.status = 'building';
  IF NOT FOUND THEN RAISE EXCEPTION 'claim evidence build lease invalid'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_claim_evidence_append_only_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'case-graph claim evidence rows are append-only';
END;
$$;

CREATE TRIGGER trg_cgce_claims_append_only BEFORE UPDATE OR DELETE
  ON public.case_graph_atomic_claims FOR EACH ROW
  EXECUTE FUNCTION public.case_graph_claim_evidence_append_only_guard();
CREATE TRIGGER trg_cgce_links_append_only BEFORE UPDATE OR DELETE
  ON public.case_graph_claim_links FOR EACH ROW
  EXECUTE FUNCTION public.case_graph_claim_evidence_append_only_guard();
CREATE TRIGGER trg_cgce_assessments_append_only BEFORE UPDATE OR DELETE
  ON public.case_graph_source_reliability_assessments FOR EACH ROW
  EXECUTE FUNCTION public.case_graph_claim_evidence_append_only_guard();

ALTER TABLE public.case_graph_claim_evidence_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_atomic_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_claim_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_source_reliability_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY cgce_service_read_builds ON public.case_graph_claim_evidence_builds
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');
CREATE POLICY cgce_service_read_claims ON public.case_graph_atomic_claims
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');
CREATE POLICY cgce_service_read_links ON public.case_graph_claim_links
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');
CREATE POLICY cgce_service_read_assessments ON public.case_graph_source_reliability_assessments
  FOR SELECT TO PUBLIC USING (current_user = 'service_role');

REVOKE ALL ON public.case_graph_claim_evidence_builds FROM PUBLIC;
REVOKE ALL ON public.case_graph_atomic_claims FROM PUBLIC;
REVOKE ALL ON public.case_graph_claim_links FROM PUBLIC;
REVOKE ALL ON public.case_graph_source_reliability_assessments FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_claim_evidence_append_only_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_claim_evidence_sha256_text(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_case_graph_claim_evidence_build(
  UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT,INTEGER
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renew_case_graph_claim_evidence_build(UUID,UUID,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_case_graph_atomic_claim_batch(UUID,UUID,JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_case_graph_claim_link_batch(UUID,UUID,JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_case_graph_source_reliability_batch(UUID,UUID,JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_case_graph_claim_evidence_build(
  UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_case_graph_claim_evidence_build(UUID,UUID,TEXT) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.case_graph_claim_evidence_builds, public.case_graph_atomic_claims,
      public.case_graph_claim_links, public.case_graph_source_reliability_assessments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.case_graph_claim_evidence_builds, public.case_graph_atomic_claims,
      public.case_graph_claim_links, public.case_graph_source_reliability_assessments FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.case_graph_claim_evidence_builds, public.case_graph_atomic_claims,
      public.case_graph_claim_links, public.case_graph_source_reliability_assessments TO service_role;
    REVOKE INSERT, UPDATE, DELETE ON public.case_graph_claim_evidence_builds,
      public.case_graph_atomic_claims, public.case_graph_claim_links,
      public.case_graph_source_reliability_assessments FROM service_role;
    GRANT EXECUTE ON FUNCTION public.create_case_graph_claim_evidence_build(
      UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT,INTEGER
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.renew_case_graph_claim_evidence_build(UUID,UUID,INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ingest_case_graph_atomic_claim_batch(UUID,UUID,JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ingest_case_graph_claim_link_batch(UUID,UUID,JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ingest_case_graph_source_reliability_batch(UUID,UUID,JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.verify_case_graph_claim_evidence_build(
      UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_case_graph_claim_evidence_build(UUID,UUID,TEXT) TO service_role;
  END IF;
END $$;
