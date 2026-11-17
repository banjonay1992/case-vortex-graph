-- Publication-pinned PostgreSQL full-text search for the Case Vortex research
-- agent.  R2 remains the immutable source of truth; these tables are a private,
-- reproducible serving index bound to one exact case-graph publication.
--
-- A build is intentionally invisible until its row reaches `verified`. Source
-- shards and publication mappings are append-only, while the build lifecycle is
-- restricted to short lease/prepare/verify transactions. No transaction or
-- advisory lock is held while immutable source artifacts are streamed from R2.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DO $$
BEGIN
  -- The exact generated-column catalog expression below is pinned to PG17.
  -- Fail closed on a different major rather than silently accepting an
  -- unverified pg_get_expr rendering or ranking contract.
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'case-graph research-search requires PostgreSQL 17.x';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_research_search_index_definition_sha256()
RETURNS VARCHAR(64)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  -- sha256(raw UTF-8 bytes of):
  -- case_graph_research_search_documents.search_vector|using=gin|opclass=tsvector_ops|predicate=none|expressions=none
  SELECT '3027254aebe1cd39e0fc273652d91a7ecf0c44ba05d8fcc3d6e3a9a27aacf66f'::varchar(64);
$$;

CREATE OR REPLACE FUNCTION public.case_graph_research_search_generated_vector_expression()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  -- Exact PostgreSQL 17 pg_get_expr output for the generated column below.
  -- Equality, not substring presence, prevents appended/reordered fields from
  -- silently changing ranking while retaining the same logical index receipt.
  SELECT '(((((setweight(to_tsvector(''simple''::regconfig, address_norm), ''A''::"char") || setweight(to_tsvector(''simple''::regconfig, title_norm), ''A''::"char")) || setweight(to_tsvector(''simple''::regconfig, source_norm), ''B''::"char")) || setweight(to_tsvector(''simple''::regconfig, location_norm), ''B''::"char")) || setweight(to_tsvector(''simple''::regconfig, event_timestamp_norm), ''C''::"char")) || setweight(to_tsvector(''simple''::regconfig, summary_norm), ''D''::"char"))'::text;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_research_search_completion_receipt_key(
  p_corpus_version TEXT,
  p_publication_id UUID,
  p_public_manifest_sha256 TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_corpus_version IS NULL
    OR p_corpus_version !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    OR p_public_manifest_sha256 IS NULL
    OR p_public_manifest_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'case-graph research-search receipt binding is invalid';
  END IF;
  RETURN 'case-vortex/corpora/' || p_corpus_version
    || '/research-search/postgres-v1/publications/' || p_publication_id::text
    || '/' || p_public_manifest_sha256 || '/_complete.receipt.json';
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_research_search_sha256_text(
  p_value TEXT
)
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

CREATE TABLE IF NOT EXISTS public.case_graph_research_search_builds (
  publication_id UUID PRIMARY KEY
    REFERENCES public.uap_case_graph_publications(id) ON DELETE RESTRICT,
  parent_publication_id UUID,
  corpus_version TEXT COLLATE "C" NOT NULL
    CHECK (corpus_version ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  snapshot_id UUID NOT NULL
    REFERENCES public.uap_evidence_universe_snapshots(id) ON DELETE RESTRICT,
  public_manifest_sha256 VARCHAR(64) NOT NULL
    CHECK (public_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  public_manifest_digest VARCHAR(64) NOT NULL
    CHECK (public_manifest_digest ~ '^[a-f0-9]{64}$'),
  graph_artifact_set_sha256 VARCHAR(64) NOT NULL
    CHECK (graph_artifact_set_sha256 ~ '^[a-f0-9]{64}$'),
  public_node_set_sha256 VARCHAR(64) NOT NULL
    CHECK (public_node_set_sha256 ~ '^[a-f0-9]{64}$'),
  expected_record_count BIGINT NOT NULL
    CHECK (expected_record_count BETWEEN 0 AND 9007199254740991),
  indexed_record_count BIGINT
    CHECK (indexed_record_count IS NULL OR indexed_record_count BETWEEN 0 AND 9007199254740991),
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'case-graph-research-search-postgres-v1'),
  tokenizer_version TEXT NOT NULL
    CHECK (tokenizer_version = 'unicode-nfkd-simple-tsvector+case-graph-sources-v1+printable-ascii-address-v2+postgres-timestamptz-canonical-utc-0001-9999-fraction-3-6-v1'),
  ranking_version TEXT NOT NULL
    CHECK (ranking_version = 'ts-rank-cd-field-weight-v1'),
  index_definition_version TEXT NOT NULL
    CHECK (index_definition_version = 'case-graph-research-search-gin-v1'),
  index_definition_sha256 VARCHAR(64) NOT NULL
    CHECK (
      index_definition_sha256 =
        public.case_graph_research_search_index_definition_sha256()
    ),
  source_shard_count BIGINT NOT NULL
    CHECK (source_shard_count BETWEEN 0 AND 4096),
  source_shard_set_sha256 VARCHAR(64)
    CHECK (source_shard_set_sha256 IS NULL OR source_shard_set_sha256 ~ '^[a-f0-9]{64}$'),
  db_node_set_sha256 VARCHAR(64)
    CHECK (db_node_set_sha256 IS NULL OR db_node_set_sha256 ~ '^[a-f0-9]{64}$'),
  search_content_set_sha256 VARCHAR(64)
    CHECK (search_content_set_sha256 IS NULL OR search_content_set_sha256 ~ '^[a-f0-9]{64}$'),
  cloned_source_shard_count BIGINT
    CHECK (
      cloned_source_shard_count IS NULL
      OR cloned_source_shard_count BETWEEN 0 AND 9007199254740991
    ),
  streamed_source_shard_count BIGINT
    CHECK (
      streamed_source_shard_count IS NULL
      OR streamed_source_shard_count BETWEEN 0 AND 9007199254740991
    ),
  cloned_record_count BIGINT
    CHECK (cloned_record_count IS NULL OR cloned_record_count BETWEEN 0 AND 9007199254740991),
  streamed_record_count BIGINT
    CHECK (streamed_record_count IS NULL OR streamed_record_count BETWEEN 0 AND 9007199254740991),
  reused_document_count BIGINT
    CHECK (reused_document_count IS NULL OR reused_document_count BETWEEN 0 AND 9007199254740991),
  inserted_document_count BIGINT
    CHECK (inserted_document_count IS NULL OR inserted_document_count BETWEEN 0 AND 9007199254740991),
  build_delta_sha256 VARCHAR(64)
    CHECK (build_delta_sha256 IS NULL OR build_delta_sha256 ~ '^[a-f0-9]{64}$'),
  sentinels JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sentinels) = 'array' AND jsonb_array_length(sentinels) <= 4),
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'receipt_pending', 'verified', 'failed')),
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completion_receipt_key TEXT COLLATE "C",
  completion_receipt_sha256 VARCHAR(64),
  receipt_pending_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_cgrs_build_parent
    FOREIGN KEY (parent_publication_id)
    REFERENCES public.case_graph_research_search_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT chk_cgrs_build_exact_accounting CHECK (
    (
      status IN ('building', 'failed')
      AND indexed_record_count IS NULL
      AND source_shard_set_sha256 IS NULL
      AND db_node_set_sha256 IS NULL
      AND search_content_set_sha256 IS NULL
      AND cloned_source_shard_count IS NULL
      AND streamed_source_shard_count IS NULL
      AND cloned_record_count IS NULL
      AND streamed_record_count IS NULL
      AND reused_document_count IS NULL
      AND inserted_document_count IS NULL
      AND build_delta_sha256 IS NULL
    )
    OR (
      status IN ('receipt_pending', 'verified', 'failed')
      AND indexed_record_count IS NOT NULL
      AND indexed_record_count = expected_record_count
      AND source_shard_set_sha256 IS NOT NULL
      AND source_shard_set_sha256 ~ '^[a-f0-9]{64}$'
      AND db_node_set_sha256 IS NOT NULL
      AND db_node_set_sha256 ~ '^[a-f0-9]{64}$'
      AND search_content_set_sha256 IS NOT NULL
      AND search_content_set_sha256 ~ '^[a-f0-9]{64}$'
      AND cloned_source_shard_count IS NOT NULL
      AND streamed_source_shard_count IS NOT NULL
      AND cloned_record_count IS NOT NULL
      AND streamed_record_count IS NOT NULL
      AND reused_document_count IS NOT NULL
      AND inserted_document_count IS NOT NULL
      AND build_delta_sha256 IS NOT NULL
      AND build_delta_sha256 ~ '^[a-f0-9]{64}$'
      AND cloned_source_shard_count + streamed_source_shard_count = source_shard_count
      AND cloned_record_count + streamed_record_count = indexed_record_count
      AND reused_document_count + inserted_document_count = indexed_record_count
    )
  ),
  CONSTRAINT chk_cgrs_build_parent_accounting CHECK (
    (
      parent_publication_id IS NULL
      AND COALESCE(cloned_source_shard_count, 0) = 0
      AND COALESCE(cloned_record_count, 0) = 0
    )
    OR (
      parent_publication_id IS NOT NULL
      AND parent_publication_id <> publication_id
    )
  ),
  CONSTRAINT chk_cgrs_build_lease_pair CHECK (
    (lease_token IS NULL AND leased_until IS NULL)
    OR (lease_token IS NOT NULL AND leased_until IS NOT NULL)
  ),
  CONSTRAINT chk_cgrs_build_receipt CHECK (
    completion_receipt_sha256 IS NULL
    OR completion_receipt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT chk_cgrs_build_state CHECK (
    (
      status = 'building'
      AND receipt_pending_at IS NULL
      AND completion_receipt_key IS NULL
      AND completion_receipt_sha256 IS NULL
      AND verified_at IS NULL
      AND failure_code IS NULL
      AND failure_detail IS NULL
    )
    OR (
      status = 'receipt_pending'
      AND receipt_pending_at IS NOT NULL
      AND lease_token IS NOT NULL
      AND leased_until IS NOT NULL
      AND completion_receipt_key IS NULL
      AND completion_receipt_sha256 IS NULL
      AND verified_at IS NULL
      AND failure_code IS NULL
      AND failure_detail IS NULL
    )
    OR (
      status = 'verified'
      AND receipt_pending_at IS NOT NULL
      AND completion_receipt_key IS NOT NULL
      AND completion_receipt_key <> ''
      AND completion_receipt_sha256 IS NOT NULL
      AND verified_at IS NOT NULL
      AND lease_token IS NULL
      AND leased_until IS NULL
      AND failure_code IS NULL
      AND failure_detail IS NULL
    )
    OR (
      status = 'failed'
      AND verified_at IS NULL
      AND lease_token IS NULL
      AND leased_until IS NULL
      AND completion_receipt_key IS NULL
      AND completion_receipt_sha256 IS NULL
      AND failure_code IS NOT NULL
      AND failure_code ~ '^[a-z0-9][a-z0-9._:-]{0,239}$'
    )
  )
);

CREATE INDEX IF NOT EXISTS case_graph_research_search_builds_status_idx
  ON public.case_graph_research_search_builds (status, created_at DESC);
CREATE INDEX IF NOT EXISTS case_graph_research_search_builds_parent_idx
  ON public.case_graph_research_search_builds (parent_publication_id, publication_id)
  WHERE parent_publication_id IS NOT NULL;

-- Operational build strategy is intentionally separated from the canonical
-- publication completion receipt. Clone/reuse/insert decisions can differ on a
-- clean restore while the publication content stays identical; recording them
-- here preserves auditability without making the immutable R2 body depend on
-- database history or execution order.
CREATE TABLE IF NOT EXISTS public.case_graph_research_search_attempt_audits (
  publication_id UUID NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
  parent_publication_id UUID,
  indexed_record_count BIGINT NOT NULL
    CHECK (indexed_record_count BETWEEN 0 AND 9007199254740991),
  source_shard_count BIGINT NOT NULL CHECK (source_shard_count BETWEEN 0 AND 4096),
  source_shard_set_sha256 VARCHAR(64) NOT NULL
    CHECK (source_shard_set_sha256 ~ '^[a-f0-9]{64}$'),
  db_node_set_sha256 VARCHAR(64) NOT NULL
    CHECK (db_node_set_sha256 ~ '^[a-f0-9]{64}$'),
  search_content_set_sha256 VARCHAR(64) NOT NULL
    CHECK (search_content_set_sha256 ~ '^[a-f0-9]{64}$'),
  cloned_source_shard_count BIGINT NOT NULL
    CHECK (cloned_source_shard_count BETWEEN 0 AND 9007199254740991),
  streamed_source_shard_count BIGINT NOT NULL
    CHECK (streamed_source_shard_count BETWEEN 0 AND 9007199254740991),
  cloned_record_count BIGINT NOT NULL
    CHECK (cloned_record_count BETWEEN 0 AND 9007199254740991),
  streamed_record_count BIGINT NOT NULL
    CHECK (streamed_record_count BETWEEN 0 AND 9007199254740991),
  reused_document_count BIGINT NOT NULL
    CHECK (reused_document_count BETWEEN 0 AND 9007199254740991),
  inserted_document_count BIGINT NOT NULL
    CHECK (inserted_document_count BETWEEN 0 AND 9007199254740991),
  build_delta_sha256 VARCHAR(64) NOT NULL
    CHECK (build_delta_sha256 ~ '^[a-f0-9]{64}$'),
  prepared_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (publication_id, attempt_count),
  CONSTRAINT fk_cgrs_attempt_build
    FOREIGN KEY (publication_id)
    REFERENCES public.case_graph_research_search_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_cgrs_attempt_parent
    FOREIGN KEY (parent_publication_id)
    REFERENCES public.case_graph_research_search_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (cloned_source_shard_count + streamed_source_shard_count = source_shard_count),
  CHECK (cloned_record_count + streamed_record_count = indexed_record_count),
  CHECK (reused_document_count + inserted_document_count = indexed_record_count)
);

CREATE INDEX IF NOT EXISTS case_graph_research_search_attempt_audits_created_idx
  ON public.case_graph_research_search_attempt_audits (prepared_at DESC, publication_id);

CREATE TABLE IF NOT EXISTS public.case_graph_research_search_source_shards (
  publication_id UUID NOT NULL,
  node_shard INTEGER NOT NULL CHECK (node_shard >= 0),
  build_mode TEXT NOT NULL CHECK (build_mode IN ('cloned', 'streamed')),
  cloned_from_publication_id UUID,
  source_artifact_digest VARCHAR(64) NOT NULL
    CHECK (source_artifact_digest ~ '^[a-f0-9]{64}$'),
  source_item_set_sha256 VARCHAR(64) NOT NULL
    CHECK (source_item_set_sha256 ~ '^[a-f0-9]{64}$'),
  item_count BIGINT NOT NULL CHECK (item_count BETWEEN 0 AND 9007199254740991),
  db_row_set_sha256 VARCHAR(64) NOT NULL
    CHECK (db_row_set_sha256 ~ '^[a-f0-9]{64}$'),
  search_content_sha256 VARCHAR(64) NOT NULL
    CHECK (search_content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (publication_id, node_shard),
  CONSTRAINT fk_cgrs_shard_build
    FOREIGN KEY (publication_id)
    REFERENCES public.case_graph_research_search_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_cgrs_shard_clone_source
    FOREIGN KEY (cloned_from_publication_id, node_shard)
    REFERENCES public.case_graph_research_search_source_shards(publication_id, node_shard)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT chk_cgrs_shard_clone_mode CHECK (
    (build_mode = 'cloned' AND cloned_from_publication_id IS NOT NULL)
    OR (build_mode = 'streamed' AND cloned_from_publication_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS case_graph_research_search_shards_clone_idx
  ON public.case_graph_research_search_source_shards (
    cloned_from_publication_id,
    node_shard
  ) WHERE cloned_from_publication_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.case_graph_research_search_documents (
  node_digest VARCHAR(64) PRIMARY KEY
    CHECK (node_digest ~ '^[a-f0-9]{64}$'),
  address TEXT COLLATE "C" NOT NULL CHECK (
    address ~ '^[!-~]+$'
    AND octet_length(address) <= 1024
  ),
  kind TEXT NOT NULL CHECK (kind IN ('sighting', 'document', 'photo', 'video')),
  relationship_status TEXT NOT NULL
    CHECK (relationship_status IN ('linked', 'candidate_only', 'isolated')),
  source_key TEXT COLLATE "C" NOT NULL
    CHECK (
      source_key ~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
    ),
  source_norm TEXT COLLATE "C" NOT NULL
    CHECK (octet_length(source_norm) <= 4096),
  event_timestamp TIMESTAMPTZ,
  event_timestamp_norm TEXT COLLATE "C" NOT NULL
    CHECK (
      octet_length(event_timestamp_norm) <= 128
      AND ((event_timestamp IS NULL) = (event_timestamp_norm = ''))
    ),
  address_norm TEXT COLLATE "C" NOT NULL
    CHECK (address_norm <> '' AND octet_length(address_norm) <= 2048),
  title_norm TEXT COLLATE "C" NOT NULL
    CHECK (octet_length(title_norm) <= 16384),
  location_norm TEXT COLLATE "C" NOT NULL
    CHECK (octet_length(location_norm) <= 8192),
  summary_norm TEXT COLLATE "C" NOT NULL
    CHECK (octet_length(summary_norm) <= 262144),
  content_digest VARCHAR(64) NOT NULL
    CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  -- This is internal accounting provenance, not publication lineage. It lets
  -- PostgreSQL derive inserted/reused counts exactly across retries instead of
  -- trusting process-local counters supplied by a builder.
  inserted_by_publication_id UUID NOT NULL
    REFERENCES public.case_graph_research_search_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, address_norm), 'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, title_norm), 'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, source_norm), 'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, location_norm), 'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, event_timestamp_norm), 'C'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, summary_norm), 'D'
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_cgrs_document_digest_address UNIQUE (node_digest, address)
);

-- This exact name and logical definition are part of the immutable build
-- receipt and are checked through pg_catalog before verification.
CREATE INDEX IF NOT EXISTS case_graph_research_search_documents_search_vector_gin_idx
  ON public.case_graph_research_search_documents USING gin (search_vector);
CREATE INDEX IF NOT EXISTS case_graph_research_search_documents_kind_idx
  ON public.case_graph_research_search_documents (kind, node_digest);
CREATE INDEX IF NOT EXISTS case_graph_research_search_documents_status_idx
  ON public.case_graph_research_search_documents (relationship_status, node_digest);
CREATE INDEX IF NOT EXISTS case_graph_research_search_documents_source_idx
  ON public.case_graph_research_search_documents (source_key, node_digest);
CREATE INDEX IF NOT EXISTS case_graph_research_search_documents_event_idx
  ON public.case_graph_research_search_documents (event_timestamp DESC, node_digest)
  WHERE event_timestamp IS NOT NULL;
CREATE INDEX IF NOT EXISTS case_graph_research_search_documents_inserted_by_idx
  ON public.case_graph_research_search_documents (
    inserted_by_publication_id,
    node_digest
  );

CREATE TABLE IF NOT EXISTS public.case_graph_research_search_publication_nodes (
  publication_id UUID NOT NULL,
  address TEXT COLLATE "C" NOT NULL CHECK (
    address ~ '^[!-~]+$'
    AND octet_length(address) <= 1024
  ),
  node_digest VARCHAR(64) NOT NULL CHECK (node_digest ~ '^[a-f0-9]{64}$'),
  source_node_shard INTEGER NOT NULL CHECK (source_node_shard >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (publication_id, address),
  CONSTRAINT fk_cgrs_node_build
    FOREIGN KEY (publication_id)
    REFERENCES public.case_graph_research_search_builds(publication_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_cgrs_node_document
    FOREIGN KEY (node_digest, address)
    REFERENCES public.case_graph_research_search_documents(node_digest, address)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  -- Streamed publication-node batches intentionally commit before their shard
  -- receipt. Exact shard membership and counts are enforced by the final
  -- deferred verification gate rather than an impossible cross-transaction FK.
  CONSTRAINT chk_cgrs_node_source_shard_nonnegative CHECK (source_node_shard >= 0)
);

CREATE INDEX IF NOT EXISTS case_graph_research_search_publication_nodes_digest_idx
  ON public.case_graph_research_search_publication_nodes (
    publication_id,
    node_digest,
    address
  );
CREATE INDEX IF NOT EXISTS case_graph_research_search_publication_nodes_shard_idx
  ON public.case_graph_research_search_publication_nodes (
    publication_id,
    source_node_shard,
    address
  );

CREATE OR REPLACE FUNCTION public.case_graph_research_search_build_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_binding_count BIGINT;
  v_parent_count BIGINT;
BEGIN
  -- Lifecycle state is never imported. Every build starts hidden and acquires
  -- its first durable lease through the guarded control-plane function.
  IF NEW.status <> 'building'
    OR NEW.lease_token IS NOT NULL
    OR NEW.leased_until IS NOT NULL
    OR NEW.attempt_count <> 0
    OR NEW.sentinels IS DISTINCT FROM '[]'::jsonb
    OR NEW.receipt_pending_at IS NOT NULL
    OR NEW.completion_receipt_key IS NOT NULL
    OR NEW.completion_receipt_sha256 IS NOT NULL
    OR NEW.verified_at IS NOT NULL
    OR NEW.failure_code IS NOT NULL
    OR NEW.failure_detail IS NOT NULL
  THEN
    RAISE EXCEPTION 'case-graph research-search builds must start in pristine building state';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_binding_count
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.id = NEW.publication_id
    AND publication.corpus_version = NEW.corpus_version
    AND publication.public_manifest_sha256 = NEW.public_manifest_sha256
    AND receipt.public_manifest_sha256 = NEW.public_manifest_sha256
    AND receipt.snapshot_id = NEW.snapshot_id
    AND receipt.graph_artifact_set_sha256 = NEW.graph_artifact_set_sha256
    AND receipt.universe_record_count = NEW.expected_record_count;

  IF v_binding_count <> 1 THEN
    RAISE EXCEPTION 'case-graph research-search build publication lineage mismatch';
  END IF;

  IF NEW.parent_publication_id IS NOT NULL THEN
    SELECT COUNT(*)::bigint
    INTO v_parent_count
    FROM public.case_graph_research_search_builds AS parent
    WHERE parent.publication_id = NEW.parent_publication_id
      AND parent.status = 'verified';
    IF v_parent_count <> 1 THEN
      RAISE EXCEPTION 'case-graph research-search clone parent is not verified';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cgrs_build_insert_guard
  ON public.case_graph_research_search_builds;
CREATE TRIGGER trg_cgrs_build_insert_guard
BEFORE INSERT ON public.case_graph_research_search_builds
FOR EACH ROW
EXECUTE FUNCTION public.case_graph_research_search_build_insert_guard();

CREATE OR REPLACE FUNCTION public.case_graph_research_search_build_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_identity JSONB;
  v_new_identity JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'case-graph research-search build receipts cannot be deleted';
  END IF;
  IF OLD.status = 'verified' THEN
    RAISE EXCEPTION 'terminal case-graph research-search build receipts are immutable';
  END IF;

  v_old_identity := to_jsonb(OLD) - ARRAY[
    'status', 'lease_token', 'leased_until', 'attempt_count', 'sentinels',
    'completion_receipt_key', 'completion_receipt_sha256',
    'receipt_pending_at', 'verified_at', 'failure_code', 'failure_detail',
    'indexed_record_count', 'source_shard_set_sha256',
    'db_node_set_sha256', 'search_content_set_sha256',
    'cloned_source_shard_count', 'streamed_source_shard_count',
    'cloned_record_count', 'streamed_record_count',
    'reused_document_count', 'inserted_document_count', 'build_delta_sha256'
  ];
  v_new_identity := to_jsonb(NEW) - ARRAY[
    'status', 'lease_token', 'leased_until', 'attempt_count', 'sentinels',
    'completion_receipt_key', 'completion_receipt_sha256',
    'receipt_pending_at', 'verified_at', 'failure_code', 'failure_detail',
    'indexed_record_count', 'source_shard_set_sha256',
    'db_node_set_sha256', 'search_content_set_sha256',
    'cloned_source_shard_count', 'streamed_source_shard_count',
    'cloned_record_count', 'streamed_record_count',
    'reused_document_count', 'inserted_document_count', 'build_delta_sha256'
  ];
  IF v_new_identity IS DISTINCT FROM v_old_identity THEN
    RAISE EXCEPTION 'case-graph research-search build lineage and accounting are immutable';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'case-graph research-search build attempt count cannot decrease';
  END IF;

  IF OLD.status = 'building' AND NEW.status = 'building' THEN
    IF ROW(
        NEW.indexed_record_count,
        NEW.source_shard_set_sha256,
        NEW.db_node_set_sha256,
        NEW.search_content_set_sha256,
        NEW.cloned_source_shard_count,
        NEW.streamed_source_shard_count,
        NEW.cloned_record_count,
        NEW.streamed_record_count,
        NEW.reused_document_count,
        NEW.inserted_document_count,
        NEW.build_delta_sha256
      ) IS DISTINCT FROM ROW(
        OLD.indexed_record_count,
        OLD.source_shard_set_sha256,
        OLD.db_node_set_sha256,
        OLD.search_content_set_sha256,
        OLD.cloned_source_shard_count,
        OLD.streamed_source_shard_count,
        OLD.cloned_record_count,
        OLD.streamed_record_count,
        OLD.reused_document_count,
        OLD.inserted_document_count,
        OLD.build_delta_sha256
      )
      OR NEW.sentinels IS DISTINCT FROM OLD.sentinels
      OR NEW.completion_receipt_key IS DISTINCT FROM OLD.completion_receipt_key
      OR NEW.completion_receipt_sha256 IS DISTINCT FROM OLD.completion_receipt_sha256
      OR NEW.receipt_pending_at IS DISTINCT FROM OLD.receipt_pending_at
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
      OR NEW.failure_detail IS DISTINCT FROM OLD.failure_detail
    THEN
      RAISE EXCEPTION 'building case-graph research-search rows only permit lease changes';
    END IF;
  ELSIF OLD.status = 'building' AND NEW.status = 'receipt_pending' THEN
    IF NEW.lease_token IS NULL
      OR NEW.leased_until IS NULL
      OR NEW.leased_until <= clock_timestamp()
      OR NEW.receipt_pending_at IS NULL
      OR NEW.sentinels IS DISTINCT FROM OLD.sentinels AND NEW.sentinels = '[]'::jsonb
    THEN
      RAISE EXCEPTION 'case-graph research-search receipt preparation requires an active lease and sentinels';
    END IF;
  ELSIF OLD.status = 'receipt_pending' AND NEW.status = 'receipt_pending' THEN
    IF ROW(
        NEW.indexed_record_count,
        NEW.source_shard_set_sha256,
        NEW.db_node_set_sha256,
        NEW.search_content_set_sha256,
        NEW.cloned_source_shard_count,
        NEW.streamed_source_shard_count,
        NEW.cloned_record_count,
        NEW.streamed_record_count,
        NEW.reused_document_count,
        NEW.inserted_document_count,
        NEW.build_delta_sha256
      ) IS DISTINCT FROM ROW(
        OLD.indexed_record_count,
        OLD.source_shard_set_sha256,
        OLD.db_node_set_sha256,
        OLD.search_content_set_sha256,
        OLD.cloned_source_shard_count,
        OLD.streamed_source_shard_count,
        OLD.cloned_record_count,
        OLD.streamed_record_count,
        OLD.reused_document_count,
        OLD.inserted_document_count,
        OLD.build_delta_sha256
      )
      OR NEW.sentinels IS DISTINCT FROM OLD.sentinels
      OR NEW.receipt_pending_at IS DISTINCT FROM OLD.receipt_pending_at
      OR NEW.completion_receipt_key IS DISTINCT FROM OLD.completion_receipt_key
      OR NEW.completion_receipt_sha256 IS DISTINCT FROM OLD.completion_receipt_sha256
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
      OR NEW.failure_detail IS DISTINCT FROM OLD.failure_detail
    THEN
      RAISE EXCEPTION 'receipt-pending case-graph research-search rows only permit lease changes';
    END IF;
  ELSIF OLD.status = 'receipt_pending' AND NEW.status = 'verified' THEN
    IF OLD.lease_token IS NULL
      OR OLD.leased_until IS NULL
      OR OLD.leased_until <= clock_timestamp()
      OR NEW.lease_token IS NOT NULL
      OR NEW.leased_until IS NOT NULL
      OR NEW.sentinels IS DISTINCT FROM OLD.sentinels
      OR NEW.receipt_pending_at IS DISTINCT FROM OLD.receipt_pending_at
      OR NEW.completion_receipt_key IS NULL
      OR NEW.completion_receipt_sha256 IS NULL
      OR NEW.verified_at IS NULL
      OR ROW(
        NEW.indexed_record_count,
        NEW.source_shard_set_sha256,
        NEW.db_node_set_sha256,
        NEW.search_content_set_sha256,
        NEW.cloned_source_shard_count,
        NEW.streamed_source_shard_count,
        NEW.cloned_record_count,
        NEW.streamed_record_count,
        NEW.reused_document_count,
        NEW.inserted_document_count,
        NEW.build_delta_sha256
      ) IS DISTINCT FROM ROW(
        OLD.indexed_record_count,
        OLD.source_shard_set_sha256,
        OLD.db_node_set_sha256,
        OLD.search_content_set_sha256,
        OLD.cloned_source_shard_count,
        OLD.streamed_source_shard_count,
        OLD.cloned_record_count,
        OLD.streamed_record_count,
        OLD.reused_document_count,
        OLD.inserted_document_count,
        OLD.build_delta_sha256
      )
    THEN
      RAISE EXCEPTION 'case-graph research-search verification requires the active prepared lease and receipt';
    END IF;
  ELSIF NEW.status = 'failed' AND OLD.status IN ('building', 'receipt_pending') THEN
    IF NEW.lease_token IS NOT NULL
      OR NEW.leased_until IS NOT NULL
      OR NEW.failure_code IS NULL
      OR NEW.completion_receipt_key IS NOT NULL
      OR NEW.completion_receipt_sha256 IS NOT NULL
      OR NEW.verified_at IS NOT NULL
      OR ROW(
        NEW.indexed_record_count,
        NEW.source_shard_set_sha256,
        NEW.db_node_set_sha256,
        NEW.search_content_set_sha256,
        NEW.cloned_source_shard_count,
        NEW.streamed_source_shard_count,
        NEW.cloned_record_count,
        NEW.streamed_record_count,
        NEW.reused_document_count,
        NEW.inserted_document_count,
        NEW.build_delta_sha256
      ) IS DISTINCT FROM ROW(
        OLD.indexed_record_count,
        OLD.source_shard_set_sha256,
        OLD.db_node_set_sha256,
        OLD.search_content_set_sha256,
        OLD.cloned_source_shard_count,
        OLD.streamed_source_shard_count,
        OLD.cloned_record_count,
        OLD.streamed_record_count,
        OLD.reused_document_count,
        OLD.inserted_document_count,
        OLD.build_delta_sha256
      )
    THEN
      RAISE EXCEPTION 'case-graph research-search failed transition is invalid';
    END IF;
  ELSIF OLD.status = 'failed'
    AND NEW.status = (CASE
      WHEN OLD.indexed_record_count IS NULL THEN 'building'
      ELSE 'receipt_pending'
    END)
  THEN
    IF NEW.lease_token IS NULL
      OR NEW.leased_until IS NULL
      OR NEW.leased_until <= clock_timestamp()
      OR NEW.failure_code IS NOT NULL
      OR NEW.failure_detail IS NOT NULL
      OR NEW.completion_receipt_key IS NOT NULL
      OR NEW.completion_receipt_sha256 IS NOT NULL
      OR NEW.verified_at IS NOT NULL
      OR NEW.receipt_pending_at IS DISTINCT FROM OLD.receipt_pending_at
      OR NEW.sentinels IS DISTINCT FROM OLD.sentinels
      OR ROW(
        NEW.indexed_record_count,
        NEW.source_shard_set_sha256,
        NEW.db_node_set_sha256,
        NEW.search_content_set_sha256,
        NEW.cloned_source_shard_count,
        NEW.streamed_source_shard_count,
        NEW.cloned_record_count,
        NEW.streamed_record_count,
        NEW.reused_document_count,
        NEW.inserted_document_count,
        NEW.build_delta_sha256
      ) IS DISTINCT FROM ROW(
        OLD.indexed_record_count,
        OLD.source_shard_set_sha256,
        OLD.db_node_set_sha256,
        OLD.search_content_set_sha256,
        OLD.cloned_source_shard_count,
        OLD.streamed_source_shard_count,
        OLD.cloned_record_count,
        OLD.streamed_record_count,
        OLD.reused_document_count,
        OLD.inserted_document_count,
        OLD.build_delta_sha256
      )
    THEN
      RAISE EXCEPTION 'case-graph research-search failed build resume is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid case-graph research-search build lifecycle transition';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cgrs_build_lifecycle_guard
  ON public.case_graph_research_search_builds;
CREATE TRIGGER trg_cgrs_build_lifecycle_guard
BEFORE UPDATE OR DELETE ON public.case_graph_research_search_builds
FOR EACH ROW
EXECUTE FUNCTION public.case_graph_research_search_build_lifecycle_guard();

CREATE OR REPLACE FUNCTION public.case_graph_research_search_append_only_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'case-graph research-search index rows are append-only';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cgrs_document_append_only
  ON public.case_graph_research_search_documents;
CREATE TRIGGER trg_cgrs_document_append_only
BEFORE UPDATE OR DELETE ON public.case_graph_research_search_documents
FOR EACH ROW
EXECUTE FUNCTION public.case_graph_research_search_append_only_guard();

DROP TRIGGER IF EXISTS trg_cgrs_attempt_audit_append_only
  ON public.case_graph_research_search_attempt_audits;
CREATE TRIGGER trg_cgrs_attempt_audit_append_only
BEFORE UPDATE OR DELETE ON public.case_graph_research_search_attempt_audits
FOR EACH ROW
EXECUTE FUNCTION public.case_graph_research_search_append_only_guard();

DROP TRIGGER IF EXISTS trg_cgrs_shard_append_only
  ON public.case_graph_research_search_source_shards;
CREATE TRIGGER trg_cgrs_shard_append_only
BEFORE UPDATE OR DELETE ON public.case_graph_research_search_source_shards
FOR EACH ROW
EXECUTE FUNCTION public.case_graph_research_search_append_only_guard();

DROP TRIGGER IF EXISTS trg_cgrs_node_append_only
  ON public.case_graph_research_search_publication_nodes;
CREATE TRIGGER trg_cgrs_node_append_only
BEFORE UPDATE OR DELETE ON public.case_graph_research_search_publication_nodes
FOR EACH ROW
EXECUTE FUNCTION public.case_graph_research_search_append_only_guard();

CREATE OR REPLACE FUNCTION public.assert_case_graph_research_search_build_ready(
  p_publication_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build public.case_graph_research_search_builds%ROWTYPE;
  v_binding_count BIGINT;
  v_parent_count BIGINT;
  v_shard_count BIGINT;
  v_cloned_shard_count BIGINT;
  v_streamed_shard_count BIGINT;
  v_shard_record_count BIGINT;
  v_cloned_record_count BIGINT;
  v_streamed_record_count BIGINT;
  v_min_node_shard INTEGER;
  v_max_node_shard INTEGER;
  v_bad_shard_count BIGINT;
  v_orphan_node_count BIGINT;
  v_node_count BIGINT;
  v_index_count BIGINT;
  v_gin_count BIGINT;
  v_generated_vector_count BIGINT;
  v_generated_vector_expression TEXT;
  v_actual_source_shard_set_sha256 VARCHAR(64);
  v_actual_build_delta_sha256 VARCHAR(64);
  v_actual_db_node_set_sha256 VARCHAR(64);
  v_actual_search_content_set_sha256 VARCHAR(64);
  v_actual_inserted_document_count BIGINT;
  v_actual_reused_document_count BIGINT;
  v_expected_sighting_count BIGINT;
  v_expected_document_count BIGINT;
  v_expected_photo_count BIGINT;
  v_expected_video_count BIGINT;
  v_expected_linked_count BIGINT;
  v_expected_candidate_only_count BIGINT;
  v_expected_isolated_count BIGINT;
  v_actual_sighting_count BIGINT;
  v_actual_document_count BIGINT;
  v_actual_photo_count BIGINT;
  v_actual_video_count BIGINT;
  v_actual_linked_count BIGINT;
  v_actual_candidate_only_count BIGINT;
  v_actual_isolated_count BIGINT;
  v_sentinel_invalid BOOLEAN;
  v_actual_kind_count BIGINT;
  v_sentinel_count BIGINT;
  v_sentinel_kind_count BIGINT;
  v_sentinel_match_count BIGINT;
BEGIN
  SELECT * INTO v_build
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id;
  IF NOT FOUND OR v_build.status NOT IN ('receipt_pending', 'verified') THEN
    RAISE EXCEPTION 'case-graph research-search build is not prepared for verification';
  END IF;

  SELECT
    COUNT(*)::bigint,
    MAX(receipt.sighting_record_count),
    MAX(receipt.document_record_count),
    MAX(receipt.photo_record_count),
    MAX(receipt.video_record_count),
    MAX(receipt.linked_address_count),
    MAX(receipt.candidate_only_address_count),
    MAX(receipt.isolated_address_count)
  INTO
    v_binding_count,
    v_expected_sighting_count,
    v_expected_document_count,
    v_expected_photo_count,
    v_expected_video_count,
    v_expected_linked_count,
    v_expected_candidate_only_count,
    v_expected_isolated_count
  FROM public.uap_case_graph_publications AS publication
  JOIN public.uap_case_graph_publication_receipts AS receipt
    ON receipt.publication_id = publication.id
  WHERE publication.id = v_build.publication_id
    AND publication.corpus_version = v_build.corpus_version
    AND publication.public_manifest_sha256 = v_build.public_manifest_sha256
    AND receipt.public_manifest_sha256 = v_build.public_manifest_sha256
    AND receipt.snapshot_id = v_build.snapshot_id
    AND receipt.graph_artifact_set_sha256 = v_build.graph_artifact_set_sha256
    AND receipt.universe_record_count = v_build.expected_record_count;
  IF v_binding_count <> 1 THEN
    RAISE EXCEPTION 'case-graph research-search verification lineage mismatch';
  END IF;

  IF v_build.parent_publication_id IS NOT NULL THEN
    SELECT COUNT(*)::bigint
    INTO v_parent_count
    FROM public.case_graph_research_search_builds AS parent
    WHERE parent.publication_id = v_build.parent_publication_id
      AND parent.status = 'verified';
    IF v_parent_count <> 1 THEN
      RAISE EXCEPTION 'case-graph research-search verification parent is not verified';
    END IF;
  END IF;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE shard.build_mode = 'cloned')::bigint,
    COUNT(*) FILTER (WHERE shard.build_mode = 'streamed')::bigint,
    COALESCE(SUM(shard.item_count), 0)::bigint,
    COALESCE(SUM(shard.item_count) FILTER (WHERE shard.build_mode = 'cloned'), 0)::bigint,
    COALESCE(SUM(shard.item_count) FILTER (WHERE shard.build_mode = 'streamed'), 0)::bigint,
    MIN(shard.node_shard),
    MAX(shard.node_shard)
  INTO
    v_shard_count,
    v_cloned_shard_count,
    v_streamed_shard_count,
    v_shard_record_count,
    v_cloned_record_count,
    v_streamed_record_count,
    v_min_node_shard,
    v_max_node_shard
  FROM public.case_graph_research_search_source_shards AS shard
  WHERE shard.publication_id = v_build.publication_id;

  IF v_shard_count <> v_build.source_shard_count
    OR v_cloned_shard_count <> v_build.cloned_source_shard_count
    OR v_streamed_shard_count <> v_build.streamed_source_shard_count
    OR v_shard_record_count <> v_build.indexed_record_count
    OR v_cloned_record_count <> v_build.cloned_record_count
    OR v_streamed_record_count <> v_build.streamed_record_count
    OR (
      v_build.source_shard_count = 0
      AND (v_min_node_shard IS NOT NULL OR v_max_node_shard IS NOT NULL)
    )
    OR (
      v_build.source_shard_count > 0
      AND (
        v_min_node_shard <> 0
        OR v_max_node_shard <> v_build.source_shard_count - 1
      )
    )
  THEN
    RAISE EXCEPTION 'case-graph research-search source-shard accounting mismatch';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_bad_shard_count
  FROM (
    SELECT shard.node_shard
    FROM public.case_graph_research_search_source_shards AS shard
    LEFT JOIN public.case_graph_research_search_publication_nodes AS node
      ON node.publication_id = shard.publication_id
     AND node.source_node_shard = shard.node_shard
    LEFT JOIN public.case_graph_research_search_documents AS document
      ON document.node_digest = node.node_digest
     AND document.address = node.address
    WHERE shard.publication_id = v_build.publication_id
    GROUP BY
      shard.node_shard,
      shard.item_count,
      shard.db_row_set_sha256,
      shard.search_content_sha256
    HAVING COUNT(node.address)::bigint <> shard.item_count
      OR public.case_graph_research_search_sha256_text(
        COALESCE(
          pg_catalog.string_agg(
            node.address || ':' || node.node_digest,
            E'\n' ORDER BY node.address COLLATE "C"
          ),
          ''
        )
      ) <> shard.db_row_set_sha256
      OR public.case_graph_research_search_sha256_text(
        COALESCE(
          pg_catalog.string_agg(
            node.address || ':' || document.content_digest,
            E'\n' ORDER BY node.address COLLATE "C"
          ),
          ''
        )
      ) <> shard.search_content_sha256
  ) AS bad_shard;
  IF v_bad_shard_count <> 0 THEN
    RAISE EXCEPTION 'case-graph research-search source-shard row coverage mismatch';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_orphan_node_count
  FROM public.case_graph_research_search_publication_nodes AS node
  LEFT JOIN public.case_graph_research_search_source_shards AS shard
    ON shard.publication_id = node.publication_id
   AND shard.node_shard = node.source_node_shard
  WHERE node.publication_id = v_build.publication_id
    AND shard.publication_id IS NULL;
  IF v_orphan_node_count <> 0 THEN
    RAISE EXCEPTION 'case-graph research-search publication node has no source-shard receipt';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_node_count
  FROM public.case_graph_research_search_publication_nodes AS node
  JOIN public.case_graph_research_search_documents AS document
    ON document.node_digest = node.node_digest
   AND document.address = node.address
  WHERE node.publication_id = v_build.publication_id;
  IF v_node_count <> v_build.expected_record_count
    OR v_node_count <> v_build.indexed_record_count
    OR v_node_count <> v_shard_record_count
  THEN
    RAISE EXCEPTION 'case-graph research-search publication-node count mismatch';
  END IF;

  -- Re-derive every completion digest from pinned database rows. These checks
  -- deliberately run once at the publication gate, never on the query path.
  SELECT public.case_graph_research_search_sha256_text(
    '[' || COALESCE(
      pg_catalog.string_agg(
        '{"dbRowSetSha256":"' || shard.db_row_set_sha256
          || '","itemCount":' || shard.item_count::text
          || ',"nodeShard":' || shard.node_shard::text
          || ',"searchContentSha256":"' || shard.search_content_sha256
          || '","sourceArtifactDigest":"' || shard.source_artifact_digest
          || '","sourceItemSetSha256":"' || shard.source_item_set_sha256
          || '"}',
        ',' ORDER BY shard.node_shard
      ),
      ''
    ) || ']'
  )
  INTO v_actual_source_shard_set_sha256
  FROM public.case_graph_research_search_source_shards AS shard
  WHERE shard.publication_id = v_build.publication_id;

  SELECT public.case_graph_research_search_sha256_text(
    '[' || COALESCE(
      pg_catalog.string_agg(
        '{"buildMode":"' || shard.build_mode
          || '","clonedFromPublicationId":'
          || CASE
            WHEN shard.cloned_from_publication_id IS NULL THEN 'null'
            ELSE '"' || shard.cloned_from_publication_id::text || '"'
          END
          || ',"dbRowSetSha256":"' || shard.db_row_set_sha256
          || '","itemCount":' || shard.item_count::text
          || ',"nodeShard":' || shard.node_shard::text
          || ',"searchContentSha256":"' || shard.search_content_sha256
          || '","sourceArtifactDigest":"' || shard.source_artifact_digest
          || '","sourceItemSetSha256":"' || shard.source_item_set_sha256
          || '"}',
        ',' ORDER BY shard.node_shard
      ),
      ''
    ) || ']'
  )
  INTO v_actual_build_delta_sha256
  FROM public.case_graph_research_search_source_shards AS shard
  WHERE shard.publication_id = v_build.publication_id;

  SELECT
    public.case_graph_research_search_sha256_text(COALESCE(
      pg_catalog.string_agg(
        node.address || ':' || node.node_digest,
        E'\n' ORDER BY node.address COLLATE "C"
      ),
      ''
    )),
    public.case_graph_research_search_sha256_text(COALESCE(
      pg_catalog.string_agg(
        node.address || ':' || document.content_digest,
        E'\n' ORDER BY node.address COLLATE "C"
      ),
      ''
    )),
    COUNT(*) FILTER (
      WHERE document.inserted_by_publication_id = v_build.publication_id
    )::bigint,
    COUNT(*) FILTER (
      WHERE document.inserted_by_publication_id <> v_build.publication_id
    )::bigint,
    COUNT(*) FILTER (WHERE document.kind = 'sighting')::bigint,
    COUNT(*) FILTER (WHERE document.kind = 'document')::bigint,
    COUNT(*) FILTER (WHERE document.kind = 'photo')::bigint,
    COUNT(*) FILTER (WHERE document.kind = 'video')::bigint,
    COUNT(*) FILTER (WHERE document.relationship_status = 'linked')::bigint,
    COUNT(*) FILTER (WHERE document.relationship_status = 'candidate_only')::bigint,
    COUNT(*) FILTER (WHERE document.relationship_status = 'isolated')::bigint
  INTO
    v_actual_db_node_set_sha256,
    v_actual_search_content_set_sha256,
    v_actual_inserted_document_count,
    v_actual_reused_document_count,
    v_actual_sighting_count,
    v_actual_document_count,
    v_actual_photo_count,
    v_actual_video_count,
    v_actual_linked_count,
    v_actual_candidate_only_count,
    v_actual_isolated_count
  FROM public.case_graph_research_search_publication_nodes AS node
  JOIN public.case_graph_research_search_documents AS document
    ON document.node_digest = node.node_digest
   AND document.address = node.address
  WHERE node.publication_id = v_build.publication_id;

  IF v_actual_source_shard_set_sha256 <> v_build.source_shard_set_sha256
    OR v_actual_build_delta_sha256 <> v_build.build_delta_sha256
    OR v_actual_db_node_set_sha256 <> v_build.db_node_set_sha256
    OR v_actual_db_node_set_sha256 <> v_build.public_node_set_sha256
    OR v_actual_search_content_set_sha256 <> v_build.search_content_set_sha256
    OR v_actual_inserted_document_count <> v_build.inserted_document_count
    OR v_actual_reused_document_count <> v_build.reused_document_count
  THEN
    RAISE EXCEPTION 'case-graph research-search derived digest or document accounting mismatch';
  END IF;

  IF v_actual_sighting_count <> v_expected_sighting_count
    OR v_actual_document_count <> v_expected_document_count
    OR v_actual_photo_count <> v_expected_photo_count
    OR v_actual_video_count <> v_expected_video_count
    OR v_actual_linked_count <> v_expected_linked_count
    OR v_actual_candidate_only_count <> v_expected_candidate_only_count
    OR v_actual_isolated_count <> v_expected_isolated_count
  THEN
    RAISE EXCEPTION 'case-graph research-search publication accounting receipt mismatch';
  END IF;

  -- All serving indexes must be live before a build can become visible. The
  -- GIN check below additionally pins the exact column and opclass contract.
  SELECT COUNT(*)::bigint
  INTO v_index_count
  FROM pg_catalog.pg_index AS index_state
  WHERE index_state.indexrelid = ANY(ARRAY[
      pg_catalog.to_regclass('public.case_graph_research_search_documents_search_vector_gin_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_documents_kind_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_documents_status_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_documents_source_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_documents_event_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_documents_inserted_by_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_publication_nodes_digest_idx'),
      pg_catalog.to_regclass('public.case_graph_research_search_publication_nodes_shard_idx')
    ]::regclass[])
    AND index_state.indisvalid
    AND index_state.indisready
    AND index_state.indislive;
  IF v_index_count <> 8 THEN
    RAISE EXCEPTION 'case-graph research-search serving indexes are not ready';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_gin_count
  FROM pg_catalog.pg_index AS index_state
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = index_state.indexrelid
  JOIN pg_catalog.pg_class AS table_relation
    ON table_relation.oid = index_state.indrelid
  JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_namespace.oid = table_relation.relnamespace
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = index_relation.relam
  JOIN pg_catalog.pg_attribute AS indexed_attribute
    ON indexed_attribute.attrelid = table_relation.oid
   AND indexed_attribute.attname = 'search_vector'
  JOIN pg_catalog.pg_opclass AS operator_class
    ON operator_class.oid = index_state.indclass[0]
   AND operator_class.opcmethod = access_method.oid
  WHERE index_relation.oid = pg_catalog.to_regclass(
      'public.case_graph_research_search_documents_search_vector_gin_idx'
    )
    AND table_namespace.nspname = 'public'
    AND table_relation.relname = 'case_graph_research_search_documents'
    AND access_method.amname = 'gin'
    AND operator_class.opcname = 'tsvector_ops'
    AND index_state.indisvalid
    AND index_state.indisready
    AND index_state.indislive
    AND NOT index_state.indisunique
    AND index_state.indpred IS NULL
    AND index_state.indexprs IS NULL
    AND index_state.indnatts = 1
    AND index_state.indnkeyatts = 1
    AND index_state.indkey[0] = indexed_attribute.attnum;
  IF v_gin_count <> 1
    OR v_build.index_definition_sha256 <>
      public.case_graph_research_search_index_definition_sha256()
  THEN
    RAISE EXCEPTION 'case-graph research-search GIN definition mismatch';
  END IF;

  SELECT COUNT(*)::bigint, MAX(pg_catalog.pg_get_expr(definition.adbin, definition.adrelid))
  INTO v_generated_vector_count, v_generated_vector_expression
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_attrdef AS definition
    ON definition.adrelid = attribute.attrelid
   AND definition.adnum = attribute.attnum
  WHERE attribute.attrelid = pg_catalog.to_regclass(
      'public.case_graph_research_search_documents'
    )
    AND attribute.attname = 'search_vector'
    AND attribute.attgenerated = 's'
    AND attribute.atttypid = 'pg_catalog.tsvector'::pg_catalog.regtype;
  IF v_generated_vector_count <> 1
    OR v_generated_vector_expression IS DISTINCT FROM
      public.case_graph_research_search_generated_vector_expression()
  THEN
    RAISE EXCEPTION 'case-graph research-search generated search vector mismatch';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_build.sentinels) AS sentinel(value)
    WHERE CASE
      WHEN jsonb_typeof(sentinel.value) <> 'object' THEN true
      ELSE
        (SELECT COUNT(*) FROM jsonb_object_keys(sentinel.value)) <> 3
        OR NOT (sentinel.value ?& ARRAY['kind', 'address', 'nodeDigest']::text[])
        OR sentinel.value ->> 'kind' NOT IN ('sighting', 'document', 'photo', 'video')
        OR COALESCE(sentinel.value ->> 'address', '') = ''
        OR COALESCE(sentinel.value ->> 'nodeDigest', '') !~ '^[a-f0-9]{64}$'
    END
  ) INTO v_sentinel_invalid;
  IF v_sentinel_invalid THEN
    RAISE EXCEPTION 'case-graph research-search sentinel receipt is invalid';
  END IF;

  WITH actual_first AS (
    SELECT document.kind, MIN(node.address) AS address
    FROM public.case_graph_research_search_publication_nodes AS node
    JOIN public.case_graph_research_search_documents AS document
      ON document.node_digest = node.node_digest
     AND document.address = node.address
    WHERE node.publication_id = v_build.publication_id
    GROUP BY document.kind
  ), actual AS (
    SELECT
      actual_first.kind,
      actual_first.address,
      ROW_NUMBER() OVER (
        ORDER BY actual_first.kind COLLATE "C", actual_first.address COLLATE "C"
      )::bigint AS ordinality
    FROM actual_first
  ), provided AS (
    SELECT
      sentinel.value ->> 'kind' AS kind,
      sentinel.value ->> 'address' AS address,
      sentinel.value ->> 'nodeDigest' AS node_digest,
      sentinel.ordinality
    FROM jsonb_array_elements(v_build.sentinels)
      WITH ORDINALITY AS sentinel(value, ordinality)
  ), matched AS (
    SELECT actual.kind
    FROM actual
    JOIN provided
      ON provided.kind = actual.kind
     AND provided.address = actual.address
     AND provided.ordinality = actual.ordinality
    JOIN public.case_graph_research_search_publication_nodes AS node
      ON node.publication_id = v_build.publication_id
     AND node.address = actual.address
     AND node.node_digest = provided.node_digest
    JOIN public.case_graph_research_search_documents AS document
      ON document.node_digest = node.node_digest
     AND document.address = node.address
     AND document.kind = actual.kind
    WHERE octet_length(document.search_vector::text) > 0
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM actual),
    (SELECT COUNT(*)::bigint FROM provided),
    (SELECT COUNT(DISTINCT provided.kind)::bigint FROM provided),
    (SELECT COUNT(*)::bigint FROM matched)
  INTO
    v_actual_kind_count,
    v_sentinel_count,
    v_sentinel_kind_count,
    v_sentinel_match_count;

  IF v_sentinel_count <> v_actual_kind_count
    OR v_sentinel_kind_count <> v_actual_kind_count
    OR v_sentinel_match_count <> v_actual_kind_count
  THEN
    RAISE EXCEPTION 'case-graph research-search sentinels do not match deterministic first records';
  END IF;

  IF v_build.status = 'receipt_pending' THEN
    IF v_build.lease_token IS NULL
      OR v_build.leased_until IS NULL
      OR v_build.leased_until <= clock_timestamp()
      OR v_build.completion_receipt_key IS NOT NULL
      OR v_build.completion_receipt_sha256 IS NOT NULL
    THEN
      RAISE EXCEPTION 'case-graph research-search prepared build lease is invalid';
    END IF;
  ELSE
    IF v_build.lease_token IS NOT NULL
      OR v_build.leased_until IS NOT NULL
      OR v_build.completion_receipt_key IS NULL
      OR v_build.completion_receipt_sha256 IS NULL
      OR v_build.verified_at IS NULL
      OR v_build.completion_receipt_key <>
        public.case_graph_research_search_completion_receipt_key(
          v_build.corpus_version,
          v_build.publication_id,
          v_build.public_manifest_sha256
        )
    THEN
      RAISE EXCEPTION 'case-graph research-search verified receipt is invalid';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_research_search_verified_build_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The expensive digest/accounting proof already ran while preparing the
  -- receipt. Receipt-pending rows and all child rows are then immutable. This
  -- deferred commit gate intentionally performs only bounded final-state
  -- checks so verification does not repeat the full corpus scan.
  IF NEW.status <> 'verified'
    OR NEW.completion_receipt_key <>
      public.case_graph_research_search_completion_receipt_key(
        NEW.corpus_version,
        NEW.publication_id,
        NEW.public_manifest_sha256
      )
    OR NEW.completion_receipt_sha256 !~ '^[a-f0-9]{64}$'
    OR NEW.db_node_set_sha256 <> NEW.public_node_set_sha256
  THEN
    RAISE EXCEPTION 'case-graph research-search verified commit gate mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cgrs_verified_build_guard
  ON public.case_graph_research_search_builds;
CREATE CONSTRAINT TRIGGER trg_cgrs_verified_build_guard
AFTER INSERT OR UPDATE ON public.case_graph_research_search_builds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.status = 'verified')
EXECUTE FUNCTION public.case_graph_research_search_verified_build_guard();

CREATE OR REPLACE FUNCTION public.create_or_acquire_case_graph_research_search_build(
  p_publication_id UUID,
  p_parent_publication_id UUID,
  p_corpus_version TEXT,
  p_snapshot_id UUID,
  p_public_manifest_sha256 TEXT,
  p_public_manifest_digest TEXT,
  p_graph_artifact_set_sha256 TEXT,
  p_public_node_set_sha256 TEXT,
  p_expected_record_count BIGINT,
  p_source_shard_count BIGINT,
  p_schema_version TEXT,
  p_tokenizer_version TEXT,
  p_ranking_version TEXT,
  p_index_definition_version TEXT,
  p_index_definition_sha256 TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  publication_id UUID,
  status TEXT,
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  attempt_count INTEGER,
  reset_partial_build BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.case_graph_research_search_builds%ROWTYPE;
  v_result public.case_graph_research_search_builds%ROWTYPE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600
    OR p_schema_version <> 'case-graph-research-search-postgres-v1'
    OR p_tokenizer_version <> 'unicode-nfkd-simple-tsvector+case-graph-sources-v1+printable-ascii-address-v2+postgres-timestamptz-canonical-utc-0001-9999-fraction-3-6-v1'
    OR p_ranking_version <> 'ts-rank-cd-field-weight-v1'
    OR p_index_definition_version <> 'case-graph-research-search-gin-v1'
    OR p_index_definition_sha256 <>
      public.case_graph_research_search_index_definition_sha256()
  THEN
    RAISE EXCEPTION 'case-graph research-search build contract is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.parent_publication_id IS DISTINCT FROM p_parent_publication_id
      OR v_existing.corpus_version IS DISTINCT FROM p_corpus_version
      OR v_existing.snapshot_id IS DISTINCT FROM p_snapshot_id
      OR v_existing.public_manifest_sha256 IS DISTINCT FROM p_public_manifest_sha256
      OR v_existing.public_manifest_digest IS DISTINCT FROM p_public_manifest_digest
      OR v_existing.graph_artifact_set_sha256 IS DISTINCT FROM p_graph_artifact_set_sha256
      OR v_existing.public_node_set_sha256 IS DISTINCT FROM p_public_node_set_sha256
      OR v_existing.expected_record_count IS DISTINCT FROM p_expected_record_count
      OR v_existing.source_shard_count IS DISTINCT FROM p_source_shard_count
      OR v_existing.schema_version IS DISTINCT FROM p_schema_version
      OR v_existing.tokenizer_version IS DISTINCT FROM p_tokenizer_version
      OR v_existing.ranking_version IS DISTINCT FROM p_ranking_version
      OR v_existing.index_definition_version IS DISTINCT FROM p_index_definition_version
      OR v_existing.index_definition_sha256 IS DISTINCT FROM p_index_definition_sha256
    THEN
      RAISE EXCEPTION 'case-graph research-search build binding mismatch';
    END IF;

    IF v_existing.status = 'verified' THEN
      RETURN QUERY SELECT
        v_existing.publication_id,
        v_existing.status,
        v_existing.lease_token,
        v_existing.leased_until,
        v_existing.attempt_count,
        false;
      RETURN;
    END IF;

    IF v_existing.lease_token IS NOT NULL
      AND v_existing.leased_until > clock_timestamp()
    THEN
      RAISE EXCEPTION 'case_graph_research_search_build_busy';
    END IF;

    -- Exact retries resume in place. Completed immutable shards/documents are
    -- retained and replay-safe; no unbounded DELETE occurs in this transaction.
    UPDATE public.case_graph_research_search_builds AS build
    SET status = CASE
          WHEN build.status = 'failed' AND build.indexed_record_count IS NULL
            THEN 'building'
          WHEN build.status = 'failed' THEN 'receipt_pending'
          ELSE build.status
        END,
        lease_token = gen_random_uuid(),
        leased_until = clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        attempt_count = build.attempt_count + 1,
        failure_code = NULL,
        failure_detail = NULL
    WHERE build.publication_id = p_publication_id
    RETURNING build.* INTO v_result;

    RETURN QUERY SELECT
      v_result.publication_id,
      v_result.status,
      v_result.lease_token,
      v_result.leased_until,
      v_result.attempt_count,
      false;
    RETURN;
  END IF;

  INSERT INTO public.case_graph_research_search_builds (
    publication_id,
    parent_publication_id,
    corpus_version,
    snapshot_id,
    public_manifest_sha256,
    public_manifest_digest,
    graph_artifact_set_sha256,
    public_node_set_sha256,
    expected_record_count,
    schema_version,
    tokenizer_version,
    ranking_version,
    index_definition_version,
    index_definition_sha256,
    source_shard_count
  ) VALUES (
    p_publication_id,
    p_parent_publication_id,
    p_corpus_version,
    p_snapshot_id,
    p_public_manifest_sha256,
    p_public_manifest_digest,
    p_graph_artifact_set_sha256,
    p_public_node_set_sha256,
    p_expected_record_count,
    p_schema_version,
    p_tokenizer_version,
    p_ranking_version,
    p_index_definition_version,
    p_index_definition_sha256,
    p_source_shard_count
  );

  UPDATE public.case_graph_research_search_builds AS build
  SET lease_token = gen_random_uuid(),
      leased_until = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = 1
  WHERE build.publication_id = p_publication_id
  RETURNING build.* INTO v_result;

  RETURN QUERY SELECT
    v_result.publication_id,
    v_result.status,
    v_result.lease_token,
    v_result.leased_until,
    v_result.attempt_count,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_case_graph_research_search_build_lease(
  p_publication_id UUID,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  publication_id UUID,
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  attempt_count INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_token UUID;
  v_until TIMESTAMPTZ;
  v_attempt INTEGER;
  v_status TEXT;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'case-graph research-search lease duration is outside 30..3600 seconds';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );

  UPDATE public.case_graph_research_search_builds AS build
  SET lease_token = gen_random_uuid(),
      leased_until = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = build.attempt_count + 1
  WHERE build.publication_id = p_publication_id
    AND build.status IN ('building', 'receipt_pending')
    AND (build.lease_token IS NULL OR build.leased_until <= clock_timestamp())
  RETURNING
    build.lease_token,
    build.leased_until,
    build.attempt_count,
    build.status
  INTO v_token, v_until, v_attempt, v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search build lease is unavailable';
  END IF;
  RETURN QUERY SELECT p_publication_id, v_token, v_until, v_attempt, v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_case_graph_research_search_build_lease(
  p_publication_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_until TIMESTAMPTZ;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'case-graph research-search lease duration is outside 30..3600 seconds';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  UPDATE public.case_graph_research_search_builds AS build
  SET leased_until = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
  WHERE build.publication_id = p_publication_id
    AND build.status IN ('building', 'receipt_pending')
    AND build.lease_token = p_lease_token
    AND build.leased_until > clock_timestamp()
  RETURNING build.leased_until INTO v_until;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search build lease cannot be renewed';
  END IF;
  RETURN v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.clone_case_graph_research_search_source_shard(
  p_publication_id UUID,
  p_lease_token UUID,
  p_node_shard INTEGER,
  p_cloned_from_publication_id UUID,
  p_source_artifact_digest TEXT,
  p_source_item_set_sha256 TEXT,
  p_item_count BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build public.case_graph_research_search_builds%ROWTYPE;
  v_source public.case_graph_research_search_source_shards%ROWTYPE;
  v_existing public.case_graph_research_search_source_shards%ROWTYPE;
  v_cloned BIGINT;
  v_conflict_count BIGINT;
BEGIN
  IF p_node_shard < 0
    OR p_source_artifact_digest !~ '^[a-f0-9]{64}$'
    OR p_source_item_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_item_count < 0
    OR p_item_count > 9007199254740991
  THEN
    RAISE EXCEPTION 'case-graph research-search clone request is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  SELECT * INTO v_build
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_build.status <> 'building'
    OR v_build.parent_publication_id IS DISTINCT FROM p_cloned_from_publication_id
    OR p_node_shard >= v_build.source_shard_count
    OR v_build.lease_token IS DISTINCT FROM p_lease_token
    OR v_build.leased_until <= clock_timestamp()
  THEN
    RAISE EXCEPTION 'case-graph research-search clone requires the active target lease';
  END IF;

  SELECT shard.* INTO v_source
  FROM public.case_graph_research_search_source_shards AS shard
  JOIN public.case_graph_research_search_builds AS source_build
    ON source_build.publication_id = shard.publication_id
  WHERE shard.publication_id = p_cloned_from_publication_id
    AND shard.node_shard = p_node_shard
    AND source_build.status = 'verified'
    AND source_build.schema_version = v_build.schema_version
    AND source_build.tokenizer_version = v_build.tokenizer_version
    AND source_build.ranking_version = v_build.ranking_version
    AND source_build.index_definition_version = v_build.index_definition_version
    AND source_build.index_definition_sha256 = v_build.index_definition_sha256
    AND shard.source_artifact_digest = p_source_artifact_digest
    AND shard.source_item_set_sha256 = p_source_item_set_sha256
    AND shard.item_count = p_item_count;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search clone source receipt mismatch';
  END IF;

  SELECT * INTO v_existing
  FROM public.case_graph_research_search_source_shards AS shard
  WHERE shard.publication_id = p_publication_id
    AND shard.node_shard = p_node_shard;
  IF FOUND THEN
    IF v_existing.build_mode <> 'cloned'
      OR v_existing.cloned_from_publication_id IS DISTINCT FROM p_cloned_from_publication_id
      OR v_existing.source_artifact_digest <> v_source.source_artifact_digest
      OR v_existing.source_item_set_sha256 <> v_source.source_item_set_sha256
      OR v_existing.item_count <> v_source.item_count
      OR v_existing.db_row_set_sha256 <> v_source.db_row_set_sha256
      OR v_existing.search_content_sha256 <> v_source.search_content_sha256
    THEN
      RAISE EXCEPTION 'case-graph research-search clone replay conflicts with stored shard';
    END IF;
    SELECT COUNT(*)::bigint INTO v_cloned
    FROM public.case_graph_research_search_publication_nodes AS node
    WHERE node.publication_id = p_publication_id
      AND node.source_node_shard = p_node_shard;
    IF v_cloned <> p_item_count THEN
      RAISE EXCEPTION 'case-graph research-search clone replay row count mismatch';
    END IF;
    RETURN v_cloned;
  END IF;

  SELECT COUNT(*)::bigint INTO v_conflict_count
  FROM public.case_graph_research_search_publication_nodes AS target_node
  LEFT JOIN public.case_graph_research_search_publication_nodes AS source_node
    ON source_node.publication_id = p_cloned_from_publication_id
   AND source_node.source_node_shard = p_node_shard
   AND source_node.address = target_node.address
   AND source_node.node_digest = target_node.node_digest
  WHERE target_node.publication_id = p_publication_id
    AND target_node.source_node_shard = p_node_shard
    AND source_node.publication_id IS NULL;
  IF v_conflict_count <> 0 THEN
    RAISE EXCEPTION 'case-graph research-search partial clone rows conflict with source';
  END IF;

  INSERT INTO public.case_graph_research_search_source_shards (
    publication_id,
    node_shard,
    build_mode,
    cloned_from_publication_id,
    source_artifact_digest,
    source_item_set_sha256,
    item_count,
    db_row_set_sha256,
    search_content_sha256
  ) VALUES (
    p_publication_id,
    p_node_shard,
    'cloned',
    p_cloned_from_publication_id,
    v_source.source_artifact_digest,
    v_source.source_item_set_sha256,
    v_source.item_count,
    v_source.db_row_set_sha256,
    v_source.search_content_sha256
  );

  INSERT INTO public.case_graph_research_search_publication_nodes (
    publication_id,
    address,
    node_digest,
    source_node_shard
  )
  SELECT
    p_publication_id,
    source_node.address,
    source_node.node_digest,
    p_node_shard
  FROM public.case_graph_research_search_publication_nodes AS source_node
  WHERE source_node.publication_id = p_cloned_from_publication_id
    AND source_node.source_node_shard = p_node_shard
  ORDER BY source_node.address COLLATE "C"
  ON CONFLICT (publication_id, address) DO NOTHING;
  SELECT COUNT(*)::bigint INTO v_cloned
  FROM public.case_graph_research_search_publication_nodes AS target_node
  WHERE target_node.publication_id = p_publication_id
    AND target_node.source_node_shard = p_node_shard;
  IF v_cloned <> p_item_count THEN
    RAISE EXCEPTION 'case-graph research-search clone row count mismatch';
  END IF;
  RETURN v_cloned;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_graph_research_search_document_content_sha256(
  p_document JSONB
)
RETURNS VARCHAR(64)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $$
  SELECT public.case_graph_research_search_sha256_text(
    '{"address":' || pg_catalog.to_jsonb(p_document ->> 'address')::text
      || ',"addressNorm":' || pg_catalog.to_jsonb(p_document ->> 'addressNorm')::text
      || ',"eventTimestamp":' || CASE
        WHEN p_document -> 'eventTimestamp' = 'null'::jsonb THEN 'null'
        ELSE pg_catalog.to_jsonb(p_document ->> 'eventTimestamp')::text
      END
      || ',"eventTimestampNorm":' || pg_catalog.to_jsonb(p_document ->> 'eventTimestampNorm')::text
      || ',"kind":' || pg_catalog.to_jsonb(p_document ->> 'kind')::text
      || ',"locationNorm":' || pg_catalog.to_jsonb(p_document ->> 'locationNorm')::text
      || ',"nodeDigest":' || pg_catalog.to_jsonb(p_document ->> 'nodeDigest')::text
      || ',"relationshipStatus":' || pg_catalog.to_jsonb(p_document ->> 'relationshipStatus')::text
      || ',"sourceKey":' || pg_catalog.to_jsonb(p_document ->> 'sourceKey')::text
      || ',"sourceNorm":' || pg_catalog.to_jsonb(p_document ->> 'sourceNorm')::text
      || ',"summaryNorm":' || pg_catalog.to_jsonb(p_document ->> 'summaryNorm')::text
      || ',"titleNorm":' || pg_catalog.to_jsonb(p_document ->> 'titleNorm')::text
      || '}'
  );
$$;

CREATE OR REPLACE FUNCTION public.ingest_case_graph_research_search_batch(
  p_publication_id UUID,
  p_lease_token UUID,
  p_node_shard INTEGER,
  p_documents JSONB
)
RETURNS TABLE (
  input_count BIGINT,
  inserted_document_count BIGINT,
  reused_document_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build public.case_graph_research_search_builds%ROWTYPE;
  v_input_count BIGINT;
  v_match_count BIGINT;
  v_inserted_count BIGINT;
  v_node_count BIGINT;
BEGIN
  IF p_documents IS NULL
    OR pg_catalog.jsonb_typeof(p_documents) <> 'array'
    OR pg_catalog.jsonb_array_length(p_documents) NOT BETWEEN 1 AND 400
    -- jsonb::text adds one formatting space after each of 13 object colons,
    -- after 12 intra-object commas, and after each inter-row array comma.
    -- At 400 rows the exact overhead over canonical compact JSON is 10,399
    -- bytes, so this remains equivalent to the transport's hard 4 MiB cap.
    OR pg_catalog.octet_length(p_documents::text) > 4204703
    OR p_node_shard < 0
  THEN
    RAISE EXCEPTION 'case-graph research-search ingest batch shape is invalid';
  END IF;

  SELECT COUNT(*)::bigint INTO v_input_count
  FROM pg_catalog.jsonb_array_elements(p_documents);
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
    WHERE pg_catalog.jsonb_typeof(item.document) <> 'object'
      OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(item.document)) <> 13
      OR NOT (item.document ?& ARRAY[
        'nodeDigest', 'address', 'kind', 'relationshipStatus', 'sourceKey',
        'sourceNorm', 'eventTimestamp', 'eventTimestampNorm', 'addressNorm',
        'titleNorm', 'locationNorm', 'summaryNorm', 'contentDigest'
      ]::text[])
      OR pg_catalog.jsonb_typeof(item.document -> 'nodeDigest') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'address') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'kind') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'relationshipStatus') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'sourceKey') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'sourceNorm') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'eventTimestamp') NOT IN ('string', 'null')
      OR pg_catalog.jsonb_typeof(item.document -> 'eventTimestampNorm') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'addressNorm') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'titleNorm') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'locationNorm') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'summaryNorm') <> 'string'
      OR pg_catalog.jsonb_typeof(item.document -> 'contentDigest') <> 'string'
      OR item.document ->> 'nodeDigest' !~ '^[a-f0-9]{64}$'
      OR item.document ->> 'contentDigest' !~ '^[a-f0-9]{64}$'
      OR item.document ->> 'address' !~ '^[!-~]+$'
      OR pg_catalog.octet_length(item.document ->> 'address') > 1024
      OR item.document ->> 'kind' NOT IN ('sighting', 'document', 'photo', 'video')
      OR item.document ->> 'relationshipStatus' NOT IN ('linked', 'candidate_only', 'isolated')
      OR item.document ->> 'sourceKey' !~ '^[a-z0-9][a-z0-9._:/-]{0,239}$'
      OR pg_catalog.octet_length(item.document ->> 'sourceNorm') > 4096
      OR pg_catalog.octet_length(item.document ->> 'eventTimestampNorm') > 128
      OR pg_catalog.octet_length(item.document ->> 'addressNorm') NOT BETWEEN 1 AND 2048
      OR pg_catalog.octet_length(item.document ->> 'titleNorm') > 16384
      OR pg_catalog.octet_length(item.document ->> 'locationNorm') > 8192
      OR pg_catalog.octet_length(item.document ->> 'summaryNorm') > 262144
      OR (
        (item.document -> 'eventTimestamp' = 'null'::jsonb)
        IS DISTINCT FROM (item.document ->> 'eventTimestampNorm' = '')
      )
      OR (
        item.document -> 'eventTimestamp' <> 'null'::jsonb
        AND item.document ->> 'eventTimestamp'
          !~ '^(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3,6}Z$'
      )
      OR (
        item.document -> 'eventTimestamp' <> 'null'::jsonb
        AND NOT pg_catalog.isfinite(
          (item.document ->> 'eventTimestamp')::timestamptz
        )
      )
      OR public.case_graph_research_search_document_content_sha256(item.document)
        <> item.document ->> 'contentDigest'
  ) THEN
    RAISE EXCEPTION 'case-graph research-search ingest document is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
    GROUP BY item.document ->> 'address'
    HAVING COUNT(*) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
    GROUP BY item.document ->> 'nodeDigest'
    HAVING COUNT(*) <> 1
  ) THEN
    RAISE EXCEPTION 'case-graph research-search ingest batch contains duplicate identities';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  SELECT * INTO v_build
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_build.status <> 'building'
    OR v_build.lease_token IS DISTINCT FROM p_lease_token
    OR v_build.leased_until <= clock_timestamp()
    OR p_node_shard >= v_build.source_shard_count
  THEN
    RAISE EXCEPTION 'case-graph research-search ingest requires the active build lease';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.case_graph_research_search_source_shards AS shard
    WHERE shard.publication_id = p_publication_id
      AND shard.node_shard = p_node_shard
  ) THEN
    RAISE EXCEPTION 'case-graph research-search completed source shard is immutable';
  END IF;

  -- Casting an invalid non-null timestamp raises and rolls the transaction
  -- back, which is the intended fail-closed behavior.
  INSERT INTO public.case_graph_research_search_documents (
    node_digest,
    address,
    kind,
    relationship_status,
    source_key,
    source_norm,
    event_timestamp,
    event_timestamp_norm,
    address_norm,
    title_norm,
    location_norm,
    summary_norm,
    content_digest,
    inserted_by_publication_id
  )
  SELECT
    item.document ->> 'nodeDigest',
    item.document ->> 'address',
    item.document ->> 'kind',
    item.document ->> 'relationshipStatus',
    item.document ->> 'sourceKey',
    item.document ->> 'sourceNorm',
    CASE WHEN item.document -> 'eventTimestamp' = 'null'::jsonb
      THEN NULL
      ELSE (item.document ->> 'eventTimestamp')::timestamptz
    END,
    item.document ->> 'eventTimestampNorm',
    item.document ->> 'addressNorm',
    item.document ->> 'titleNorm',
    item.document ->> 'locationNorm',
    item.document ->> 'summaryNorm',
    item.document ->> 'contentDigest',
    p_publication_id
  FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
  ON CONFLICT (node_digest) DO NOTHING;

  SELECT COUNT(*)::bigint
  INTO v_match_count
  FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
  JOIN public.case_graph_research_search_documents AS stored
    ON stored.node_digest = item.document ->> 'nodeDigest'
   AND stored.address = item.document ->> 'address'
   AND stored.kind = item.document ->> 'kind'
   AND stored.relationship_status = item.document ->> 'relationshipStatus'
   AND stored.source_key = item.document ->> 'sourceKey'
   AND stored.source_norm = item.document ->> 'sourceNorm'
   AND stored.event_timestamp IS NOT DISTINCT FROM CASE
     WHEN item.document -> 'eventTimestamp' = 'null'::jsonb THEN NULL
     ELSE (item.document ->> 'eventTimestamp')::timestamptz
   END
   AND stored.event_timestamp_norm = item.document ->> 'eventTimestampNorm'
   AND stored.address_norm = item.document ->> 'addressNorm'
   AND stored.title_norm = item.document ->> 'titleNorm'
   AND stored.location_norm = item.document ->> 'locationNorm'
   AND stored.summary_norm = item.document ->> 'summaryNorm'
   AND stored.content_digest = item.document ->> 'contentDigest';
  IF v_match_count <> v_input_count THEN
    RAISE EXCEPTION 'case-graph research-search content-addressed document conflict';
  END IF;

  INSERT INTO public.case_graph_research_search_publication_nodes (
    publication_id,
    address,
    node_digest,
    source_node_shard
  )
  SELECT
    p_publication_id,
    item.document ->> 'address',
    item.document ->> 'nodeDigest',
    p_node_shard
  FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
  ORDER BY item.document ->> 'address' COLLATE "C"
  ON CONFLICT (publication_id, address) DO NOTHING;

  SELECT COUNT(*)::bigint
  INTO v_node_count
  FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
  JOIN public.case_graph_research_search_publication_nodes AS node
    ON node.publication_id = p_publication_id
   AND node.address = item.document ->> 'address'
   AND node.node_digest = item.document ->> 'nodeDigest'
   AND node.source_node_shard = p_node_shard;
  IF v_node_count <> v_input_count THEN
    RAISE EXCEPTION 'case-graph research-search publication-node replay conflict';
  END IF;

  SELECT COUNT(*) FILTER (
    WHERE stored.inserted_by_publication_id = p_publication_id
  )::bigint
  INTO v_inserted_count
  FROM pg_catalog.jsonb_array_elements(p_documents) AS item(document)
  JOIN public.case_graph_research_search_documents AS stored
    ON stored.node_digest = item.document ->> 'nodeDigest';
  RETURN QUERY SELECT
    v_input_count,
    v_inserted_count,
    v_input_count - v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_case_graph_research_search_streamed_shard(
  p_publication_id UUID,
  p_lease_token UUID,
  p_node_shard INTEGER,
  p_source_artifact_digest TEXT,
  p_source_item_set_sha256 TEXT,
  p_item_count BIGINT,
  p_db_row_set_sha256 TEXT,
  p_search_content_sha256 TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build public.case_graph_research_search_builds%ROWTYPE;
  v_existing public.case_graph_research_search_source_shards%ROWTYPE;
  v_actual_count BIGINT;
  v_actual_db_sha VARCHAR(64);
  v_actual_search_sha VARCHAR(64);
BEGIN
  IF p_node_shard < 0
    OR p_source_artifact_digest !~ '^[a-f0-9]{64}$'
    OR p_source_item_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_db_row_set_sha256 !~ '^[a-f0-9]{64}$'
    OR p_search_content_sha256 !~ '^[a-f0-9]{64}$'
    OR p_item_count NOT BETWEEN 0 AND 9007199254740991
  THEN
    RAISE EXCEPTION 'case-graph research-search streamed shard receipt is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  SELECT * INTO v_build
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_build.status <> 'building'
    OR v_build.lease_token IS DISTINCT FROM p_lease_token
    OR v_build.leased_until <= clock_timestamp()
    OR p_node_shard >= v_build.source_shard_count
  THEN
    RAISE EXCEPTION 'case-graph research-search streamed shard requires the active build lease';
  END IF;

  SELECT
    COUNT(*)::bigint,
    public.case_graph_research_search_sha256_text(COALESCE(
      pg_catalog.string_agg(
        node.address || ':' || node.node_digest,
        E'\n' ORDER BY node.address COLLATE "C"
      ),
      ''
    )),
    public.case_graph_research_search_sha256_text(COALESCE(
      pg_catalog.string_agg(
        node.address || ':' || document.content_digest,
        E'\n' ORDER BY node.address COLLATE "C"
      ),
      ''
    ))
  INTO v_actual_count, v_actual_db_sha, v_actual_search_sha
  FROM public.case_graph_research_search_publication_nodes AS node
  JOIN public.case_graph_research_search_documents AS document
    ON document.node_digest = node.node_digest
   AND document.address = node.address
  WHERE node.publication_id = p_publication_id
    AND node.source_node_shard = p_node_shard;
  IF v_actual_count <> p_item_count
    OR v_actual_db_sha <> p_db_row_set_sha256
    OR v_actual_db_sha <> p_source_item_set_sha256
    OR v_actual_search_sha <> p_search_content_sha256
  THEN
    RAISE EXCEPTION 'case-graph research-search streamed shard database digest mismatch';
  END IF;

  SELECT * INTO v_existing
  FROM public.case_graph_research_search_source_shards AS shard
  WHERE shard.publication_id = p_publication_id
    AND shard.node_shard = p_node_shard;
  IF FOUND THEN
    IF v_existing.build_mode <> 'streamed'
      OR v_existing.cloned_from_publication_id IS NOT NULL
      OR v_existing.source_artifact_digest <> p_source_artifact_digest
      OR v_existing.source_item_set_sha256 <> p_source_item_set_sha256
      OR v_existing.item_count <> p_item_count
      OR v_existing.db_row_set_sha256 <> p_db_row_set_sha256
      OR v_existing.search_content_sha256 <> p_search_content_sha256
    THEN
      RAISE EXCEPTION 'case-graph research-search streamed shard replay conflicts with receipt';
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.case_graph_research_search_source_shards (
    publication_id,
    node_shard,
    build_mode,
    cloned_from_publication_id,
    source_artifact_digest,
    source_item_set_sha256,
    item_count,
    db_row_set_sha256,
    search_content_sha256
  ) VALUES (
    p_publication_id,
    p_node_shard,
    'streamed',
    NULL,
    p_source_artifact_digest,
    p_source_item_set_sha256,
    p_item_count,
    p_db_row_set_sha256,
    p_search_content_sha256
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.read_case_graph_research_search_source_shard(
  p_publication_id UUID,
  p_lease_token UUID,
  p_node_shard INTEGER
)
RETURNS SETOF public.case_graph_research_search_source_shards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build_count BIGINT;
BEGIN
  IF p_node_shard < 0 THEN
    RAISE EXCEPTION 'case-graph research-search source shard coordinate is invalid';
  END IF;
  SELECT COUNT(*)::bigint INTO v_build_count
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id
    AND build.status = 'building'
    AND build.lease_token = p_lease_token
    AND build.leased_until > clock_timestamp()
    AND p_node_shard < build.source_shard_count;
  IF v_build_count <> 1 THEN
    RAISE EXCEPTION 'case-graph research-search source shard read requires the active build lease';
  END IF;
  RETURN QUERY
  SELECT shard.*
  FROM public.case_graph_research_search_source_shards AS shard
  WHERE shard.publication_id = p_publication_id
    AND shard.node_shard = p_node_shard;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_case_graph_research_search_receipt_pending(
  p_publication_id UUID,
  p_lease_token UUID
)
RETURNS SETOF public.case_graph_research_search_builds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT build.*
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id
    AND build.status = 'receipt_pending'
    AND build.lease_token = p_lease_token
    AND build.leased_until > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search pending receipt read requires the active lease';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_case_graph_research_search_receipt(
  p_publication_id UUID,
  p_lease_token UUID,
  p_completion JSONB
)
RETURNS TABLE (
  publication_id UUID,
  status TEXT,
  sentinels JSONB,
  receipt_pending_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_sentinels JSONB;
  v_pending_at TIMESTAMPTZ;
  v_accounting JSONB;
BEGIN
  IF p_completion IS NULL
    OR jsonb_typeof(p_completion) <> 'object'
    OR (SELECT COUNT(*) FROM jsonb_object_keys(p_completion)) <> 7
    OR NOT (p_completion ?& ARRAY[
      'indexDefinitionSha256',
      'sourceShardSetSha256',
      'dbNodeSetSha256',
      'searchContentSetSha256',
      'buildDeltaSha256',
      'accounting',
      'sentinels'
    ]::text[])
  THEN
    RAISE EXCEPTION 'case-graph research-search completion shape is invalid';
  END IF;
  v_accounting := p_completion -> 'accounting';
  IF jsonb_typeof(v_accounting) <> 'object'
    OR (SELECT COUNT(*) FROM jsonb_object_keys(v_accounting)) <> 8
    OR NOT (v_accounting ?& ARRAY[
      'indexedRecordCount',
      'sourceShardCount',
      'clonedSourceShardCount',
      'streamedSourceShardCount',
      'clonedRecordCount',
      'streamedRecordCount',
      'reusedDocumentCount',
      'insertedDocumentCount'
    ]::text[])
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'indexedRecordCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'sourceShardCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'clonedSourceShardCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'streamedSourceShardCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'clonedRecordCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'streamedRecordCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'reusedDocumentCount'
    ) IS DISTINCT FROM true
    OR public.uap_case_graph_jsonb_safe_count(
      v_accounting -> 'insertedDocumentCount'
    ) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'case-graph research-search completion accounting is invalid';
  END IF;
  IF jsonb_typeof(p_completion -> 'indexDefinitionSha256') <> 'string'
    OR jsonb_typeof(p_completion -> 'sourceShardSetSha256') <> 'string'
    OR jsonb_typeof(p_completion -> 'dbNodeSetSha256') <> 'string'
    OR jsonb_typeof(p_completion -> 'searchContentSetSha256') <> 'string'
    OR jsonb_typeof(p_completion -> 'buildDeltaSha256') <> 'string'
    OR p_completion ->> 'indexDefinitionSha256' <>
      public.case_graph_research_search_index_definition_sha256()
    OR p_completion ->> 'sourceShardSetSha256' !~ '^[a-f0-9]{64}$'
    OR p_completion ->> 'dbNodeSetSha256' !~ '^[a-f0-9]{64}$'
    OR p_completion ->> 'searchContentSetSha256' !~ '^[a-f0-9]{64}$'
    OR p_completion ->> 'buildDeltaSha256' !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_completion -> 'sentinels') <> 'array'
  THEN
    RAISE EXCEPTION 'case-graph research-search completion digests or sentinels are invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  UPDATE public.case_graph_research_search_builds AS build
  SET status = 'receipt_pending',
      indexed_record_count = (v_accounting ->> 'indexedRecordCount')::bigint,
      source_shard_set_sha256 = p_completion ->> 'sourceShardSetSha256',
      db_node_set_sha256 = p_completion ->> 'dbNodeSetSha256',
      search_content_set_sha256 = p_completion ->> 'searchContentSetSha256',
      cloned_source_shard_count = (v_accounting ->> 'clonedSourceShardCount')::bigint,
      streamed_source_shard_count = (v_accounting ->> 'streamedSourceShardCount')::bigint,
      cloned_record_count = (v_accounting ->> 'clonedRecordCount')::bigint,
      streamed_record_count = (v_accounting ->> 'streamedRecordCount')::bigint,
      reused_document_count = (v_accounting ->> 'reusedDocumentCount')::bigint,
      inserted_document_count = (v_accounting ->> 'insertedDocumentCount')::bigint,
      build_delta_sha256 = p_completion ->> 'buildDeltaSha256',
      sentinels = p_completion -> 'sentinels',
      receipt_pending_at = clock_timestamp()
  WHERE build.publication_id = p_publication_id
    AND build.status = 'building'
    AND build.lease_token = p_lease_token
    AND build.leased_until > clock_timestamp()
    AND build.source_shard_count = (v_accounting ->> 'sourceShardCount')::bigint
    AND build.index_definition_sha256 = p_completion ->> 'indexDefinitionSha256'
  RETURNING build.status, build.sentinels, build.receipt_pending_at
  INTO v_status, v_sentinels, v_pending_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search receipt preparation lease mismatch';
  END IF;

  IF p_completion ->> 'dbNodeSetSha256' IS DISTINCT FROM (
    SELECT build.public_node_set_sha256
    FROM public.case_graph_research_search_builds AS build
    WHERE build.publication_id = p_publication_id
  ) THEN
    RAISE EXCEPTION 'case-graph research-search public/database node-set mismatch';
  END IF;

  -- Visibility is gated until planner statistics have sampled the final data.
  -- This runs once per publication build and is bounded by PostgreSQL ANALYZE's
  -- sampling algorithm; it does not build another index or hold a long DDL lock.
  EXECUTE 'ANALYZE public.case_graph_research_search_documents';
  EXECUTE 'ANALYZE public.case_graph_research_search_publication_nodes';
  PERFORM public.assert_case_graph_research_search_build_ready(p_publication_id);
  INSERT INTO public.case_graph_research_search_attempt_audits (
    publication_id,
    attempt_count,
    parent_publication_id,
    indexed_record_count,
    source_shard_count,
    source_shard_set_sha256,
    db_node_set_sha256,
    search_content_set_sha256,
    cloned_source_shard_count,
    streamed_source_shard_count,
    cloned_record_count,
    streamed_record_count,
    reused_document_count,
    inserted_document_count,
    build_delta_sha256,
    prepared_at
  )
  SELECT
    build.publication_id,
    build.attempt_count,
    build.parent_publication_id,
    build.indexed_record_count,
    build.source_shard_count,
    build.source_shard_set_sha256,
    build.db_node_set_sha256,
    build.search_content_set_sha256,
    build.cloned_source_shard_count,
    build.streamed_source_shard_count,
    build.cloned_record_count,
    build.streamed_record_count,
    build.reused_document_count,
    build.inserted_document_count,
    build.build_delta_sha256,
    build.receipt_pending_at
  FROM public.case_graph_research_search_builds AS build
  WHERE build.publication_id = p_publication_id;
  RETURN QUERY SELECT p_publication_id, v_status, v_sentinels, v_pending_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_case_graph_research_search_build(
  p_publication_id UUID,
  p_lease_token UUID,
  p_completion_receipt_key TEXT,
  p_completion_receipt_sha256 TEXT
)
RETURNS TABLE (
  publication_id UUID,
  corpus_version TEXT,
  public_manifest_sha256 VARCHAR(64),
  public_node_set_sha256 VARCHAR(64),
  indexed_record_count BIGINT,
  completion_receipt_key TEXT,
  completion_receipt_sha256 VARCHAR(64),
  verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build public.case_graph_research_search_builds%ROWTYPE;
BEGIN
  IF p_completion_receipt_key IS NULL
    OR p_completion_receipt_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'case-graph research-search completion receipt is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  UPDATE public.case_graph_research_search_builds AS build
  SET status = 'verified',
      completion_receipt_key = p_completion_receipt_key,
      completion_receipt_sha256 = p_completion_receipt_sha256,
      verified_at = clock_timestamp(),
      lease_token = NULL,
      leased_until = NULL
  WHERE build.publication_id = p_publication_id
    AND build.status = 'receipt_pending'
    AND build.lease_token = p_lease_token
    AND build.leased_until > clock_timestamp()
  RETURNING build.* INTO v_build;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search verification lease mismatch';
  END IF;

  IF p_completion_receipt_key <>
    public.case_graph_research_search_completion_receipt_key(
      v_build.corpus_version,
      v_build.publication_id,
      v_build.public_manifest_sha256
    )
  THEN
    RAISE EXCEPTION 'case-graph research-search completion receipt key binding mismatch';
  END IF;

  -- The immutable R2 receipt is uploaded and hashed before this short final
  -- transaction. The deferred constraint trigger replays the DB gate exactly
  -- once at commit, after the row has reached its final immutable state.
  RETURN QUERY SELECT
    v_build.publication_id,
    v_build.corpus_version,
    v_build.public_manifest_sha256,
    v_build.public_node_set_sha256,
    v_build.indexed_record_count,
    v_build.completion_receipt_key,
    v_build.completion_receipt_sha256,
    v_build.verified_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_case_graph_research_search_build(
  p_publication_id UUID,
  p_lease_token UUID,
  p_failure_code TEXT,
  p_failure_detail TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_failure_code !~ '^[a-z0-9][a-z0-9._:-]{0,239}$'
    OR (p_failure_detail IS NOT NULL AND octet_length(p_failure_detail) > 4096)
  THEN
    RAISE EXCEPTION 'case-graph research-search failure receipt is invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-graph-research-search:' || p_publication_id::text,
      0
    )
  );
  UPDATE public.case_graph_research_search_builds AS build
  SET status = 'failed',
      lease_token = NULL,
      leased_until = NULL,
      failure_code = p_failure_code,
      failure_detail = p_failure_detail
  WHERE build.publication_id = p_publication_id
    AND build.status IN ('building', 'receipt_pending')
    AND build.lease_token = p_lease_token
    AND build.leased_until > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-graph research-search failure lease mismatch';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.preflight_case_graph_research_search_build(
  p_publication_id UUID,
  p_corpus_version TEXT,
  p_public_manifest_sha256 TEXT,
  p_public_manifest_digest TEXT,
  p_graph_artifact_set_sha256 TEXT,
  p_public_node_set_sha256 TEXT,
  p_expected_record_count BIGINT,
  p_completion_receipt_key TEXT,
  p_completion_receipt_sha256 TEXT
)
RETURNS TABLE (
  publication_id UUID,
  corpus_version TEXT,
  snapshot_id UUID,
  public_manifest_sha256 VARCHAR(64),
  public_manifest_digest VARCHAR(64),
  graph_artifact_set_sha256 VARCHAR(64),
  public_node_set_sha256 VARCHAR(64),
  expected_record_count BIGINT,
  indexed_record_count BIGINT,
  schema_version TEXT,
  tokenizer_version TEXT,
  ranking_version TEXT,
  index_definition_version TEXT,
  index_definition_sha256 VARCHAR(64),
  source_shard_count BIGINT,
  source_shard_set_sha256 VARCHAR(64),
  db_node_set_sha256 VARCHAR(64),
  search_content_set_sha256 VARCHAR(64),
  sentinels JSONB,
  completion_receipt_key TEXT,
  completion_receipt_sha256 VARCHAR(64),
  verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_build public.case_graph_research_search_builds%ROWTYPE;
  v_gin_count BIGINT;
  v_generated_vector_expression TEXT;
  v_sentinel JSONB;
  v_sentinel_exists BOOLEAN;
BEGIN
  SELECT build.* INTO v_build
  FROM public.case_graph_research_search_builds AS build
  JOIN public.uap_case_graph_publications AS publication
    ON publication.id = build.publication_id
  WHERE build.publication_id = p_publication_id
    AND publication.active = true
    AND build.status = 'verified'
    AND build.corpus_version = p_corpus_version
    AND build.public_manifest_sha256 = p_public_manifest_sha256
    AND build.public_manifest_digest = p_public_manifest_digest
    AND build.graph_artifact_set_sha256 = p_graph_artifact_set_sha256
    AND build.public_node_set_sha256 = p_public_node_set_sha256
    AND build.expected_record_count = p_expected_record_count
    AND build.indexed_record_count = p_expected_record_count
    AND build.completion_receipt_key = p_completion_receipt_key
    AND build.completion_receipt_key =
      public.case_graph_research_search_completion_receipt_key(
        build.corpus_version,
        build.publication_id,
        build.public_manifest_sha256
      )
    AND build.completion_receipt_sha256 = p_completion_receipt_sha256
    AND build.index_definition_sha256 =
      public.case_graph_research_search_index_definition_sha256();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_graph_research_search_index_unavailable';
  END IF;
  IF jsonb_array_length(v_build.sentinels) > 4 THEN
    RAISE EXCEPTION 'case_graph_research_search_index_unavailable';
  END IF;

  -- Force <=4 primary-key probes. A set join lets the planner scan every node
  -- for the publication before joining the tiny JSON array, which is not a
  -- bounded request-time preflight on a 466k-record corpus.
  FOR v_sentinel IN
    SELECT sentinel.value
    FROM jsonb_array_elements(v_build.sentinels) AS sentinel(value)
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM public.case_graph_research_search_publication_nodes AS node
      JOIN public.case_graph_research_search_documents AS document
        ON document.node_digest = node.node_digest
       AND document.address = node.address
      WHERE node.publication_id = v_build.publication_id
        AND node.address = v_sentinel ->> 'address'
        AND node.node_digest = v_sentinel ->> 'nodeDigest'
        AND document.kind = v_sentinel ->> 'kind'
    ) INTO v_sentinel_exists;
    IF NOT v_sentinel_exists THEN
      RAISE EXCEPTION 'case_graph_research_search_index_unavailable';
    END IF;
  END LOOP;
  SELECT COUNT(*)::bigint INTO v_gin_count
  FROM pg_catalog.pg_index AS index_state
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = index_state.indexrelid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = index_relation.relam
  JOIN pg_catalog.pg_opclass AS operator_class
    ON operator_class.oid = index_state.indclass[0]
   AND operator_class.opcmethod = access_method.oid
  WHERE index_state.indexrelid = pg_catalog.to_regclass(
      'public.case_graph_research_search_documents_search_vector_gin_idx'
    )
    AND access_method.amname = 'gin'
    AND operator_class.opcname = 'tsvector_ops'
    AND index_state.indisvalid
    AND index_state.indisready
    AND index_state.indislive
    AND index_state.indpred IS NULL
    AND index_state.indexprs IS NULL;
  SELECT pg_catalog.pg_get_expr(definition.adbin, definition.adrelid)
  INTO v_generated_vector_expression
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_attrdef AS definition
    ON definition.adrelid = attribute.attrelid
   AND definition.adnum = attribute.attnum
  WHERE attribute.attrelid = pg_catalog.to_regclass(
      'public.case_graph_research_search_documents'
    )
    AND attribute.attname = 'search_vector'
    AND attribute.attgenerated = 's';
  IF v_gin_count <> 1
    OR v_generated_vector_expression IS DISTINCT FROM
      public.case_graph_research_search_generated_vector_expression()
  THEN
    RAISE EXCEPTION 'case_graph_research_search_index_unavailable';
  END IF;

  RETURN QUERY SELECT
    v_build.publication_id,
    v_build.corpus_version,
    v_build.snapshot_id,
    v_build.public_manifest_sha256,
    v_build.public_manifest_digest,
    v_build.graph_artifact_set_sha256,
    v_build.public_node_set_sha256,
    v_build.expected_record_count,
    v_build.indexed_record_count,
    v_build.schema_version,
    v_build.tokenizer_version,
    v_build.ranking_version,
    v_build.index_definition_version,
    v_build.index_definition_sha256,
    v_build.source_shard_count,
    v_build.source_shard_set_sha256,
    v_build.db_node_set_sha256,
    v_build.search_content_set_sha256,
    v_build.sentinels,
    v_build.completion_receipt_key,
    v_build.completion_receipt_sha256,
    v_build.verified_at;
END;
$$;

REVOKE ALL ON TABLE public.case_graph_research_search_builds FROM PUBLIC;
REVOKE ALL ON TABLE public.case_graph_research_search_attempt_audits FROM PUBLIC;
REVOKE ALL ON TABLE public.case_graph_research_search_source_shards FROM PUBLIC;
REVOKE ALL ON TABLE public.case_graph_research_search_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.case_graph_research_search_publication_nodes FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_index_definition_sha256() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_generated_vector_expression() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_completion_receipt_key(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_sha256_text(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_build_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_build_lifecycle_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_append_only_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_case_graph_research_search_build_ready(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_verified_build_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_graph_research_search_document_content_sha256(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_or_acquire_case_graph_research_search_build(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_case_graph_research_search_build_lease(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renew_case_graph_research_search_build_lease(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clone_case_graph_research_search_source_shard(UUID, UUID, INTEGER, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_case_graph_research_search_batch(UUID, UUID, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finish_case_graph_research_search_streamed_shard(UUID, UUID, INTEGER, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_case_graph_research_search_source_shard(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_case_graph_research_search_receipt_pending(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prepare_case_graph_research_search_receipt(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_case_graph_research_search_build(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_case_graph_research_search_build(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preflight_case_graph_research_search_build(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC;

ALTER TABLE public.case_graph_research_search_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_research_search_attempt_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_research_search_source_shards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_research_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_graph_research_search_publication_nodes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.case_graph_research_search_builds FROM anon;
    REVOKE ALL ON TABLE public.case_graph_research_search_attempt_audits FROM anon;
    REVOKE ALL ON TABLE public.case_graph_research_search_source_shards FROM anon;
    REVOKE ALL ON TABLE public.case_graph_research_search_documents FROM anon;
    REVOKE ALL ON TABLE public.case_graph_research_search_publication_nodes FROM anon;
    REVOKE EXECUTE ON FUNCTION public.preflight_case_graph_research_search_build(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.case_graph_research_search_builds FROM authenticated;
    REVOKE ALL ON TABLE public.case_graph_research_search_attempt_audits FROM authenticated;
    REVOKE ALL ON TABLE public.case_graph_research_search_source_shards FROM authenticated;
    REVOKE ALL ON TABLE public.case_graph_research_search_documents FROM authenticated;
    REVOKE ALL ON TABLE public.case_graph_research_search_publication_nodes FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.preflight_case_graph_research_search_build(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    -- The serving role gets no UPDATE/DELETE path. Lifecycle mutation is only
    -- available through the narrow SECURITY DEFINER control-plane functions.
    GRANT SELECT ON TABLE public.case_graph_research_search_builds TO service_role;
    GRANT SELECT ON TABLE public.case_graph_research_search_attempt_audits TO service_role;
    GRANT SELECT ON TABLE public.case_graph_research_search_source_shards TO service_role;
    GRANT SELECT ON TABLE public.case_graph_research_search_documents TO service_role;
    GRANT SELECT ON TABLE public.case_graph_research_search_publication_nodes TO service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_graph_research_search_builds FROM service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_graph_research_search_attempt_audits FROM service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_graph_research_search_source_shards FROM service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_graph_research_search_documents FROM service_role;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.case_graph_research_search_publication_nodes FROM service_role;

    DROP POLICY IF EXISTS service_role_select_cgrs_builds
      ON public.case_graph_research_search_builds;
    CREATE POLICY service_role_select_cgrs_builds
      ON public.case_graph_research_search_builds
      FOR SELECT TO service_role USING (true);
    DROP POLICY IF EXISTS service_role_select_cgrs_attempt_audits
      ON public.case_graph_research_search_attempt_audits;
    CREATE POLICY service_role_select_cgrs_attempt_audits
      ON public.case_graph_research_search_attempt_audits
      FOR SELECT TO service_role USING (true);
    DROP POLICY IF EXISTS service_role_insert_cgrs_builds
      ON public.case_graph_research_search_builds;

    DROP POLICY IF EXISTS service_role_select_cgrs_shards
      ON public.case_graph_research_search_source_shards;
    CREATE POLICY service_role_select_cgrs_shards
      ON public.case_graph_research_search_source_shards
      FOR SELECT TO service_role USING (true);
    DROP POLICY IF EXISTS service_role_insert_cgrs_shards
      ON public.case_graph_research_search_source_shards;

    DROP POLICY IF EXISTS service_role_select_cgrs_documents
      ON public.case_graph_research_search_documents;
    CREATE POLICY service_role_select_cgrs_documents
      ON public.case_graph_research_search_documents
      FOR SELECT TO service_role USING (true);
    DROP POLICY IF EXISTS service_role_insert_cgrs_documents
      ON public.case_graph_research_search_documents;

    DROP POLICY IF EXISTS service_role_select_cgrs_nodes
      ON public.case_graph_research_search_publication_nodes;
    CREATE POLICY service_role_select_cgrs_nodes
      ON public.case_graph_research_search_publication_nodes
      FOR SELECT TO service_role USING (true);
    DROP POLICY IF EXISTS service_role_insert_cgrs_nodes
      ON public.case_graph_research_search_publication_nodes;

    GRANT EXECUTE ON FUNCTION public.case_graph_research_search_index_definition_sha256()
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.create_or_acquire_case_graph_research_search_build(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.acquire_case_graph_research_search_build_lease(UUID, INTEGER)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.renew_case_graph_research_search_build_lease(UUID, UUID, INTEGER)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.clone_case_graph_research_search_source_shard(UUID, UUID, INTEGER, UUID, TEXT, TEXT, BIGINT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.ingest_case_graph_research_search_batch(UUID, UUID, INTEGER, JSONB)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.finish_case_graph_research_search_streamed_shard(UUID, UUID, INTEGER, TEXT, TEXT, BIGINT, TEXT, TEXT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.read_case_graph_research_search_source_shard(UUID, UUID, INTEGER)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.read_case_graph_research_search_receipt_pending(UUID, UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.prepare_case_graph_research_search_receipt(UUID, UUID, JSONB)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.verify_case_graph_research_search_build(UUID, UUID, TEXT, TEXT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_case_graph_research_search_build(UUID, UUID, TEXT, TEXT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.preflight_case_graph_research_search_build(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT)
      TO service_role;
  END IF;
END;
$$;
