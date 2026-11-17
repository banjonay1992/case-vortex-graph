-- Durable, fail-closed admission and usage accounting for Luna Case Vortex
-- research. Raw network identifiers never enter this schema: callers provide
-- either a domain-separated account SHA-256 or a secret-keyed network HMAC.
-- All admission, reservation, settlement, expiry and retry clocks come from
-- PostgreSQL so multiple API instances share one atomic policy boundary.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.case_vortex_research_usage_policy_sha256()
RETURNS VARCHAR(64)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  -- sha256(raw UTF-8 bytes of):
  -- case-vortex-research-usage-v1|window_seconds=600|max_requests=12|max_concurrent=1|max_lease_seconds=300|max_input_tokens=6000000|max_output_tokens=100000|max_reasoning_tokens=1000000|max_tool_envelope_bytes=16777216|subject=sha256-account-or-hmac-sha256-network|clock=postgres-clock_timestamp|unsettled=reserved-committed-on-release-or-expiry
  SELECT 'f18417ecbfc1dea452a4ef0fc4f1e1aaa5f0ec5cf3c95ad0229cc0ce30f83bed'::varchar(64);
$$;

CREATE OR REPLACE FUNCTION public.case_vortex_research_usage_charge_sha256(
  p_input_tokens BIGINT,
  p_output_tokens BIGINT,
  p_reasoning_tokens BIGINT,
  p_tool_envelope_bytes BIGINT
)
RETURNS VARCHAR(64)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        p_input_tokens::text || '|'
          || p_output_tokens::text || '|'
          || p_reasoning_tokens::text || '|'
          || p_tool_envelope_bytes::text,
        'UTF8'
      )
    ),
    'hex'
  )::varchar(64);
$$;

CREATE TABLE IF NOT EXISTS public.case_vortex_research_usage_windows (
  subject_kind TEXT COLLATE "C" NOT NULL
    CHECK (subject_kind IN ('account', 'network')),
  subject_hash VARCHAR(64) COLLATE "C" NOT NULL
    CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  window_ends_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
    CHECK (request_count BETWEEN 0 AND 12),
  reserved_input_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (reserved_input_tokens BETWEEN 0 AND 6000000),
  committed_input_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (committed_input_tokens BETWEEN 0 AND 6000000),
  reserved_output_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (reserved_output_tokens BETWEEN 0 AND 100000),
  committed_output_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (committed_output_tokens BETWEEN 0 AND 100000),
  reserved_reasoning_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (reserved_reasoning_tokens BETWEEN 0 AND 1000000),
  committed_reasoning_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (committed_reasoning_tokens BETWEEN 0 AND 1000000),
  reserved_tool_envelope_bytes BIGINT NOT NULL DEFAULT 0
    CHECK (reserved_tool_envelope_bytes BETWEEN 0 AND 16777216),
  committed_tool_envelope_bytes BIGINT NOT NULL DEFAULT 0
    CHECK (committed_tool_envelope_bytes BETWEEN 0 AND 16777216),
  policy_version TEXT COLLATE "C" NOT NULL DEFAULT 'case-vortex-research-usage-v1'
    CHECK (policy_version = 'case-vortex-research-usage-v1'),
  policy_sha256 VARCHAR(64) NOT NULL DEFAULT public.case_vortex_research_usage_policy_sha256()
    CHECK (policy_sha256 = public.case_vortex_research_usage_policy_sha256()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (subject_kind, subject_hash, window_started_at),
  CONSTRAINT ck_case_vortex_usage_window_exact_duration
    CHECK (window_ends_at = window_started_at + interval '10 minutes'),
  CONSTRAINT ck_case_vortex_usage_window_input_cap
    CHECK (reserved_input_tokens + committed_input_tokens <= 6000000),
  CONSTRAINT ck_case_vortex_usage_window_output_cap
    CHECK (reserved_output_tokens + committed_output_tokens <= 100000),
  CONSTRAINT ck_case_vortex_usage_window_reasoning_cap
    CHECK (reserved_reasoning_tokens + committed_reasoning_tokens <= 1000000),
  CONSTRAINT ck_case_vortex_usage_window_tool_bytes_cap
    CHECK (reserved_tool_envelope_bytes + committed_tool_envelope_bytes <= 16777216)
);

CREATE TABLE IF NOT EXISTS public.case_vortex_research_usage_leases (
  lease_token UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  acquire_id UUID NOT NULL UNIQUE,
  subject_kind TEXT COLLATE "C" NOT NULL
    CHECK (subject_kind IN ('account', 'network')),
  subject_hash VARCHAR(64) COLLATE "C" NOT NULL
    CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_lease_seconds INTEGER NOT NULL
    CHECK (requested_lease_seconds BETWEEN 1 AND 300),
  initial_reserved_input_tokens BIGINT NOT NULL
    CHECK (initial_reserved_input_tokens BETWEEN 0 AND 6000000),
  initial_reserved_output_tokens BIGINT NOT NULL
    CHECK (initial_reserved_output_tokens BETWEEN 0 AND 100000),
  initial_reserved_reasoning_tokens BIGINT NOT NULL
    CHECK (initial_reserved_reasoning_tokens BETWEEN 0 AND 1000000),
  initial_reserved_tool_envelope_bytes BIGINT NOT NULL
    CHECK (initial_reserved_tool_envelope_bytes BETWEEN 0 AND 16777216),
  reserved_input_tokens BIGINT NOT NULL
    CHECK (reserved_input_tokens BETWEEN 0 AND 6000000),
  reserved_output_tokens BIGINT NOT NULL
    CHECK (reserved_output_tokens BETWEEN 0 AND 100000),
  reserved_reasoning_tokens BIGINT NOT NULL
    CHECK (reserved_reasoning_tokens BETWEEN 0 AND 1000000),
  reserved_tool_envelope_bytes BIGINT NOT NULL
    CHECK (reserved_tool_envelope_bytes BETWEEN 0 AND 16777216),
  committed_input_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (committed_input_tokens BETWEEN 0 AND 6000000),
  committed_output_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (committed_output_tokens BETWEEN 0 AND 100000),
  committed_reasoning_tokens BIGINT NOT NULL DEFAULT 0
    CHECK (committed_reasoning_tokens BETWEEN 0 AND 1000000),
  committed_tool_envelope_bytes BIGINT NOT NULL DEFAULT 0
    CHECK (committed_tool_envelope_bytes BETWEEN 0 AND 16777216),
  settlement_id UUID,
  settlement_sha256 VARCHAR(64)
    CHECK (settlement_sha256 IS NULL OR settlement_sha256 ~ '^[a-f0-9]{64}$'),
  settlement_kind TEXT COLLATE "C"
    CHECK (settlement_kind IS NULL OR settlement_kind IN (
      'client', 'released_assumed', 'expired_assumed'
    )),
  settled_at TIMESTAMPTZ,
  release_kind TEXT COLLATE "C"
    CHECK (release_kind IS NULL OR release_kind IN ('client', 'expired')),
  released_at TIMESTAMPTZ,
  policy_version TEXT COLLATE "C" NOT NULL DEFAULT 'case-vortex-research-usage-v1'
    CHECK (policy_version = 'case-vortex-research-usage-v1'),
  policy_sha256 VARCHAR(64) NOT NULL DEFAULT public.case_vortex_research_usage_policy_sha256()
    CHECK (policy_sha256 = public.case_vortex_research_usage_policy_sha256()),
  FOREIGN KEY (subject_kind, subject_hash, window_started_at)
    REFERENCES public.case_vortex_research_usage_windows(
      subject_kind, subject_hash, window_started_at
    ) ON DELETE RESTRICT,
  CONSTRAINT ck_case_vortex_usage_lease_bounded
    CHECK (
      expires_at > acquired_at
      AND expires_at <= acquired_at + interval '5 minutes'
    ),
  CONSTRAINT ck_case_vortex_usage_lease_committed_not_above_reserved
    CHECK (
      committed_input_tokens <= reserved_input_tokens
      AND committed_output_tokens <= reserved_output_tokens
      AND committed_reasoning_tokens <= reserved_reasoning_tokens
      AND committed_tool_envelope_bytes <= reserved_tool_envelope_bytes
    ),
  CONSTRAINT ck_case_vortex_usage_lease_settlement_shape
    CHECK (
      (settled_at IS NULL
        AND settlement_kind IS NULL
        AND settlement_id IS NULL
        AND settlement_sha256 IS NULL)
      OR
      (settled_at IS NOT NULL
        AND settlement_kind IS NOT NULL
        AND settlement_sha256 IS NOT NULL
        AND (
          (settlement_kind = 'client' AND settlement_id IS NOT NULL)
          OR (settlement_kind <> 'client' AND settlement_id IS NULL)
        ))
    ),
  CONSTRAINT ck_case_vortex_usage_lease_release_shape
    CHECK (
      (released_at IS NULL AND release_kind IS NULL)
      OR (released_at IS NOT NULL AND release_kind IS NOT NULL)
    ),
  CONSTRAINT ck_case_vortex_usage_lease_times
    CHECK (
      (settled_at IS NULL OR settled_at >= acquired_at)
      AND (released_at IS NULL OR released_at >= acquired_at)
    )
);

CREATE TABLE IF NOT EXISTS public.case_vortex_research_usage_reservations (
  reservation_id UUID PRIMARY KEY,
  lease_token UUID NOT NULL
    REFERENCES public.case_vortex_research_usage_leases(lease_token) ON DELETE CASCADE,
  input_tokens BIGINT NOT NULL
    CHECK (input_tokens BETWEEN 0 AND 6000000),
  output_tokens BIGINT NOT NULL
    CHECK (output_tokens BETWEEN 0 AND 100000),
  reasoning_tokens BIGINT NOT NULL
    CHECK (reasoning_tokens BETWEEN 0 AND 1000000),
  tool_envelope_bytes BIGINT NOT NULL
    CHECK (tool_envelope_bytes BETWEEN 0 AND 16777216),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT ck_case_vortex_usage_reservation_nonzero
    CHECK (
      input_tokens > 0
      OR output_tokens > 0
      OR reasoning_tokens > 0
      OR tool_envelope_bytes > 0
    )
);

CREATE INDEX IF NOT EXISTS case_vortex_research_usage_leases_active_subject_idx
  ON public.case_vortex_research_usage_leases(
    subject_kind, subject_hash, expires_at, lease_token
  )
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS case_vortex_research_usage_leases_cleanup_idx
  ON public.case_vortex_research_usage_leases(released_at, expires_at, lease_token);

CREATE INDEX IF NOT EXISTS case_vortex_research_usage_reservations_lease_idx
  ON public.case_vortex_research_usage_reservations(lease_token, reservation_id);

REVOKE ALL ON TABLE public.case_vortex_research_usage_windows FROM PUBLIC;
REVOKE ALL ON TABLE public.case_vortex_research_usage_leases FROM PUBLIC;
REVOKE ALL ON TABLE public.case_vortex_research_usage_reservations FROM PUBLIC;

ALTER TABLE public.case_vortex_research_usage_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_research_usage_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_research_usage_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_research_usage_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_research_usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_vortex_research_usage_reservations FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.case_vortex_research_usage_reap_subject(
  p_subject_kind TEXT,
  p_subject_hash TEXT,
  p_now TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lease public.case_vortex_research_usage_leases%ROWTYPE;
  v_reaped INTEGER := 0;
BEGIN
  IF p_subject_kind NOT IN ('account', 'network')
    OR p_subject_hash !~ '^[a-f0-9]{64}$'
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'case-vortex research usage reaper subject is invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-vortex-research-usage:' || p_subject_kind || ':' || p_subject_hash,
      0
    )
  );

  FOR v_lease IN
    SELECT lease.*
    FROM public.case_vortex_research_usage_leases AS lease
    WHERE lease.subject_kind = p_subject_kind
      AND lease.subject_hash = p_subject_hash
      AND lease.released_at IS NULL
      AND lease.expires_at <= p_now
    ORDER BY lease.expires_at, lease.lease_token
    FOR UPDATE
  LOOP
    IF v_lease.settled_at IS NULL THEN
      UPDATE public.case_vortex_research_usage_windows AS usage_window
      SET reserved_input_tokens = usage_window.reserved_input_tokens - v_lease.reserved_input_tokens,
          committed_input_tokens = usage_window.committed_input_tokens + v_lease.reserved_input_tokens,
          reserved_output_tokens = usage_window.reserved_output_tokens - v_lease.reserved_output_tokens,
          committed_output_tokens = usage_window.committed_output_tokens + v_lease.reserved_output_tokens,
          reserved_reasoning_tokens = usage_window.reserved_reasoning_tokens - v_lease.reserved_reasoning_tokens,
          committed_reasoning_tokens = usage_window.committed_reasoning_tokens + v_lease.reserved_reasoning_tokens,
          reserved_tool_envelope_bytes = usage_window.reserved_tool_envelope_bytes - v_lease.reserved_tool_envelope_bytes,
          committed_tool_envelope_bytes = usage_window.committed_tool_envelope_bytes + v_lease.reserved_tool_envelope_bytes,
          updated_at = p_now
      WHERE usage_window.subject_kind = v_lease.subject_kind
        AND usage_window.subject_hash = v_lease.subject_hash
        AND usage_window.window_started_at = v_lease.window_started_at;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'case-vortex research usage expiry window is missing';
      END IF;

      UPDATE public.case_vortex_research_usage_leases AS lease
      SET committed_input_tokens = v_lease.reserved_input_tokens,
          committed_output_tokens = v_lease.reserved_output_tokens,
          committed_reasoning_tokens = v_lease.reserved_reasoning_tokens,
          committed_tool_envelope_bytes = v_lease.reserved_tool_envelope_bytes,
          settlement_kind = 'expired_assumed',
          settlement_sha256 = public.case_vortex_research_usage_charge_sha256(
            v_lease.reserved_input_tokens,
            v_lease.reserved_output_tokens,
            v_lease.reserved_reasoning_tokens,
            v_lease.reserved_tool_envelope_bytes
          ),
          settled_at = p_now
      WHERE lease.lease_token = v_lease.lease_token;
    END IF;

    UPDATE public.case_vortex_research_usage_leases AS lease
    SET release_kind = 'expired',
        released_at = p_now
    WHERE lease.lease_token = v_lease.lease_token;
    v_reaped := v_reaped + 1;
  END LOOP;

  RETURN v_reaped;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_case_vortex_research_usage_lease(
  p_subject_kind TEXT,
  p_subject_hash TEXT,
  p_acquire_id UUID,
  p_lease_seconds INTEGER,
  p_reserve_input_tokens BIGINT,
  p_reserve_output_tokens BIGINT,
  p_reserve_reasoning_tokens BIGINT,
  p_reserve_tool_envelope_bytes BIGINT
)
RETURNS TABLE (
  acquired BOOLEAN,
  lease_token UUID,
  denial_reason TEXT,
  retry_after_seconds INTEGER,
  window_started_at TIMESTAMPTZ,
  window_ends_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  request_count INTEGER,
  concurrent_count INTEGER,
  reserved_input_tokens BIGINT,
  committed_input_tokens BIGINT,
  reserved_output_tokens BIGINT,
  committed_output_tokens BIGINT,
  reserved_reasoning_tokens BIGINT,
  committed_reasoning_tokens BIGINT,
  reserved_tool_envelope_bytes BIGINT,
  committed_tool_envelope_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_window public.case_vortex_research_usage_windows%ROWTYPE;
  v_existing public.case_vortex_research_usage_leases%ROWTYPE;
  v_active INTEGER;
  v_retry INTEGER;
  v_reason TEXT;
  v_token UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_subject_kind NOT IN ('account', 'network')
    OR p_subject_hash !~ '^[a-f0-9]{64}$'
    OR p_acquire_id IS NULL
    OR p_lease_seconds NOT BETWEEN 1 AND 300
    OR p_reserve_input_tokens NOT BETWEEN 0 AND 6000000
    OR p_reserve_output_tokens NOT BETWEEN 0 AND 100000
    OR p_reserve_reasoning_tokens NOT BETWEEN 0 AND 1000000
    OR p_reserve_tool_envelope_bytes NOT BETWEEN 0 AND 16777216
  THEN
    RAISE EXCEPTION 'case-vortex research usage acquire request is invalid';
  END IF;

  v_window_start := pg_catalog.date_bin(
    interval '10 minutes',
    v_now,
    timestamptz '2000-01-01 00:00:00+00'
  );

  -- The caller-supplied acquire UUID makes transport retries idempotent. The
  -- second subject lock serializes all quota mutation for this identity even
  -- before its first fixed-window row exists.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-vortex-research-usage-acquire:' || p_acquire_id::text,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-vortex-research-usage:' || p_subject_kind || ':' || p_subject_hash,
      0
    )
  );
  PERFORM public.case_vortex_research_usage_reap_subject(
    p_subject_kind,
    p_subject_hash,
    v_now
  );

  SELECT lease.* INTO v_existing
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.acquire_id = p_acquire_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.subject_kind <> p_subject_kind
      OR v_existing.subject_hash <> p_subject_hash
      OR v_existing.requested_lease_seconds <> p_lease_seconds
      OR v_existing.initial_reserved_input_tokens <> p_reserve_input_tokens
      OR v_existing.initial_reserved_output_tokens <> p_reserve_output_tokens
      OR v_existing.initial_reserved_reasoning_tokens <> p_reserve_reasoning_tokens
      OR v_existing.initial_reserved_tool_envelope_bytes <> p_reserve_tool_envelope_bytes
    THEN
      RAISE EXCEPTION 'case-vortex research usage acquire idempotency conflict';
    END IF;
    IF v_existing.released_at IS NOT NULL OR v_existing.expires_at <= v_now THEN
      RAISE EXCEPTION 'case-vortex research usage acquire replay is no longer active';
    END IF;

    SELECT usage_window.* INTO v_window
    FROM public.case_vortex_research_usage_windows AS usage_window
    WHERE usage_window.subject_kind = v_existing.subject_kind
      AND usage_window.subject_hash = v_existing.subject_hash
      AND usage_window.window_started_at = v_existing.window_started_at
    FOR UPDATE;
    SELECT COUNT(*)::integer INTO v_active
    FROM public.case_vortex_research_usage_leases AS lease
    WHERE lease.subject_kind = p_subject_kind
      AND lease.subject_hash = p_subject_hash
      AND lease.released_at IS NULL
      AND lease.expires_at > v_now;

    RETURN QUERY SELECT
      true,
      v_existing.lease_token,
      NULL::text,
      NULL::integer,
      v_window.window_started_at,
      v_window.window_ends_at,
      v_existing.expires_at,
      v_window.request_count,
      v_active,
      v_window.reserved_input_tokens,
      v_window.committed_input_tokens,
      v_window.reserved_output_tokens,
      v_window.committed_output_tokens,
      v_window.reserved_reasoning_tokens,
      v_window.committed_reasoning_tokens,
      v_window.reserved_tool_envelope_bytes,
      v_window.committed_tool_envelope_bytes;
    RETURN;
  END IF;

  INSERT INTO public.case_vortex_research_usage_windows (
    subject_kind,
    subject_hash,
    window_started_at,
    window_ends_at
  ) VALUES (
    p_subject_kind,
    p_subject_hash,
    v_window_start,
    v_window_start + interval '10 minutes'
  )
  ON CONFLICT ON CONSTRAINT case_vortex_research_usage_windows_pkey DO NOTHING;

  SELECT usage_window.* INTO v_window
  FROM public.case_vortex_research_usage_windows AS usage_window
  WHERE usage_window.subject_kind = p_subject_kind
    AND usage_window.subject_hash = p_subject_hash
    AND usage_window.window_started_at = v_window_start
  FOR UPDATE;
  IF NOT FOUND
    OR v_window.policy_version <> 'case-vortex-research-usage-v1'
    OR v_window.policy_sha256 <> public.case_vortex_research_usage_policy_sha256()
  THEN
    RAISE EXCEPTION 'case-vortex research usage policy window is invalid';
  END IF;

  SELECT COUNT(*)::integer INTO v_active
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.subject_kind = p_subject_kind
    AND lease.subject_hash = p_subject_hash
    AND lease.released_at IS NULL
    AND lease.expires_at > v_now;

  IF v_active >= 1 THEN
    SELECT GREATEST(
      1,
      LEAST(
        600,
        CEIL(EXTRACT(EPOCH FROM (MIN(lease.expires_at) - v_now)))::integer
      )
    ) INTO v_retry
    FROM public.case_vortex_research_usage_leases AS lease
    WHERE lease.subject_kind = p_subject_kind
      AND lease.subject_hash = p_subject_hash
      AND lease.released_at IS NULL
      AND lease.expires_at > v_now;
    v_reason := 'concurrent';
  ELSIF v_window.request_count >= 12 THEN
    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window.window_ends_at - v_now)))::integer
    );
    v_reason := 'request_quota';
  ELSIF v_window.reserved_input_tokens + v_window.committed_input_tokens
      + p_reserve_input_tokens > 6000000 THEN
    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window.window_ends_at - v_now)))::integer
    );
    v_reason := 'input_token_quota';
  ELSIF v_window.reserved_output_tokens + v_window.committed_output_tokens
      + p_reserve_output_tokens > 100000 THEN
    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window.window_ends_at - v_now)))::integer
    );
    v_reason := 'output_token_quota';
  ELSIF v_window.reserved_reasoning_tokens + v_window.committed_reasoning_tokens
      + p_reserve_reasoning_tokens > 1000000 THEN
    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window.window_ends_at - v_now)))::integer
    );
    v_reason := 'reasoning_token_quota';
  ELSIF v_window.reserved_tool_envelope_bytes + v_window.committed_tool_envelope_bytes
      + p_reserve_tool_envelope_bytes > 16777216 THEN
    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window.window_ends_at - v_now)))::integer
    );
    v_reason := 'tool_envelope_byte_quota';
  END IF;

  IF v_reason IS NOT NULL THEN
    RETURN QUERY SELECT
      false,
      NULL::uuid,
      v_reason,
      LEAST(600, v_retry),
      v_window.window_started_at,
      v_window.window_ends_at,
      NULL::timestamptz,
      v_window.request_count,
      v_active,
      v_window.reserved_input_tokens,
      v_window.committed_input_tokens,
      v_window.reserved_output_tokens,
      v_window.committed_output_tokens,
      v_window.reserved_reasoning_tokens,
      v_window.committed_reasoning_tokens,
      v_window.reserved_tool_envelope_bytes,
      v_window.committed_tool_envelope_bytes;
    RETURN;
  END IF;

  v_token := pg_catalog.gen_random_uuid();
  v_expires := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  UPDATE public.case_vortex_research_usage_windows AS usage_window
  SET request_count = usage_window.request_count + 1,
      reserved_input_tokens = usage_window.reserved_input_tokens + p_reserve_input_tokens,
      reserved_output_tokens = usage_window.reserved_output_tokens + p_reserve_output_tokens,
      reserved_reasoning_tokens = usage_window.reserved_reasoning_tokens + p_reserve_reasoning_tokens,
      reserved_tool_envelope_bytes = usage_window.reserved_tool_envelope_bytes + p_reserve_tool_envelope_bytes,
      updated_at = v_now
  WHERE usage_window.subject_kind = p_subject_kind
    AND usage_window.subject_hash = p_subject_hash
    AND usage_window.window_started_at = v_window_start
  RETURNING usage_window.* INTO v_window;

  INSERT INTO public.case_vortex_research_usage_leases (
    lease_token,
    acquire_id,
    subject_kind,
    subject_hash,
    window_started_at,
    acquired_at,
    expires_at,
    requested_lease_seconds,
    initial_reserved_input_tokens,
    initial_reserved_output_tokens,
    initial_reserved_reasoning_tokens,
    initial_reserved_tool_envelope_bytes,
    reserved_input_tokens,
    reserved_output_tokens,
    reserved_reasoning_tokens,
    reserved_tool_envelope_bytes
  ) VALUES (
    v_token,
    p_acquire_id,
    p_subject_kind,
    p_subject_hash,
    v_window_start,
    v_now,
    v_expires,
    p_lease_seconds,
    p_reserve_input_tokens,
    p_reserve_output_tokens,
    p_reserve_reasoning_tokens,
    p_reserve_tool_envelope_bytes,
    p_reserve_input_tokens,
    p_reserve_output_tokens,
    p_reserve_reasoning_tokens,
    p_reserve_tool_envelope_bytes
  );

  RETURN QUERY SELECT
    true,
    v_token,
    NULL::text,
    NULL::integer,
    v_window.window_started_at,
    v_window.window_ends_at,
    v_expires,
    v_window.request_count,
    v_active + 1,
    v_window.reserved_input_tokens,
    v_window.committed_input_tokens,
    v_window.reserved_output_tokens,
    v_window.committed_output_tokens,
    v_window.reserved_reasoning_tokens,
    v_window.committed_reasoning_tokens,
    v_window.reserved_tool_envelope_bytes,
    v_window.committed_tool_envelope_bytes;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_case_vortex_research_usage(
  p_lease_token UUID,
  p_reservation_id UUID,
  p_input_tokens BIGINT,
  p_output_tokens BIGINT,
  p_reasoning_tokens BIGINT,
  p_tool_envelope_bytes BIGINT
)
RETURNS TABLE (
  reserved BOOLEAN,
  denial_reason TEXT,
  retry_after_seconds INTEGER,
  expires_at TIMESTAMPTZ,
  reserved_input_tokens BIGINT,
  committed_input_tokens BIGINT,
  reserved_output_tokens BIGINT,
  committed_output_tokens BIGINT,
  reserved_reasoning_tokens BIGINT,
  committed_reasoning_tokens BIGINT,
  reserved_tool_envelope_bytes BIGINT,
  committed_tool_envelope_bytes BIGINT,
  lease_reserved_input_tokens BIGINT,
  lease_reserved_output_tokens BIGINT,
  lease_reserved_reasoning_tokens BIGINT,
  lease_reserved_tool_envelope_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_lease public.case_vortex_research_usage_leases%ROWTYPE;
  v_window public.case_vortex_research_usage_windows%ROWTYPE;
  v_reservation public.case_vortex_research_usage_reservations%ROWTYPE;
  v_reason TEXT;
BEGIN
  IF p_lease_token IS NULL
    OR p_reservation_id IS NULL
    OR p_input_tokens NOT BETWEEN 0 AND 6000000
    OR p_output_tokens NOT BETWEEN 0 AND 100000
    OR p_reasoning_tokens NOT BETWEEN 0 AND 1000000
    OR p_tool_envelope_bytes NOT BETWEEN 0 AND 16777216
    OR (
      p_input_tokens = 0
      AND p_output_tokens = 0
      AND p_reasoning_tokens = 0
      AND p_tool_envelope_bytes = 0
    )
  THEN
    RAISE EXCEPTION 'case-vortex research usage reservation is invalid';
  END IF;

  SELECT lease.* INTO v_lease
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.lease_token = p_lease_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-vortex research usage lease is unknown';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-vortex-research-usage:' || v_lease.subject_kind || ':' || v_lease.subject_hash,
      0
    )
  );
  PERFORM public.case_vortex_research_usage_reap_subject(
    v_lease.subject_kind,
    v_lease.subject_hash,
    v_now
  );

  SELECT lease.* INTO v_lease
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.lease_token = p_lease_token
  FOR UPDATE;
  SELECT reservation.* INTO v_reservation
  FROM public.case_vortex_research_usage_reservations AS reservation
  WHERE reservation.reservation_id = p_reservation_id;

  SELECT usage_window.* INTO v_window
  FROM public.case_vortex_research_usage_windows AS usage_window
  WHERE usage_window.subject_kind = v_lease.subject_kind
    AND usage_window.subject_hash = v_lease.subject_hash
    AND usage_window.window_started_at = v_lease.window_started_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-vortex research usage reservation window is missing';
  END IF;

  IF v_reservation.reservation_id IS NOT NULL THEN
    IF v_reservation.lease_token <> p_lease_token
      OR v_reservation.input_tokens <> p_input_tokens
      OR v_reservation.output_tokens <> p_output_tokens
      OR v_reservation.reasoning_tokens <> p_reasoning_tokens
      OR v_reservation.tool_envelope_bytes <> p_tool_envelope_bytes
    THEN
      RAISE EXCEPTION 'case-vortex research usage reservation idempotency conflict';
    END IF;
    RETURN QUERY SELECT
      true,
      NULL::text,
      NULL::integer,
      v_lease.expires_at,
      v_window.reserved_input_tokens,
      v_window.committed_input_tokens,
      v_window.reserved_output_tokens,
      v_window.committed_output_tokens,
      v_window.reserved_reasoning_tokens,
      v_window.committed_reasoning_tokens,
      v_window.reserved_tool_envelope_bytes,
      v_window.committed_tool_envelope_bytes,
      v_lease.reserved_input_tokens,
      v_lease.reserved_output_tokens,
      v_lease.reserved_reasoning_tokens,
      v_lease.reserved_tool_envelope_bytes;
    RETURN;
  END IF;

  IF v_lease.released_at IS NOT NULL
    OR v_lease.expires_at <= v_now
    OR v_lease.settled_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'case-vortex research usage reservation requires an active unsettled lease';
  END IF;

  IF v_window.reserved_input_tokens + v_window.committed_input_tokens
      + p_input_tokens > 6000000 THEN
    v_reason := 'input_token_quota';
  ELSIF v_window.reserved_output_tokens + v_window.committed_output_tokens
      + p_output_tokens > 100000 THEN
    v_reason := 'output_token_quota';
  ELSIF v_window.reserved_reasoning_tokens + v_window.committed_reasoning_tokens
      + p_reasoning_tokens > 1000000 THEN
    v_reason := 'reasoning_token_quota';
  ELSIF v_window.reserved_tool_envelope_bytes + v_window.committed_tool_envelope_bytes
      + p_tool_envelope_bytes > 16777216 THEN
    v_reason := 'tool_envelope_byte_quota';
  END IF;

  IF v_reason IS NOT NULL THEN
    RETURN QUERY SELECT
      false,
      v_reason,
      GREATEST(
        1,
        LEAST(
          600,
          CEIL(EXTRACT(EPOCH FROM (v_window.window_ends_at - v_now)))::integer
        )
      ),
      v_lease.expires_at,
      v_window.reserved_input_tokens,
      v_window.committed_input_tokens,
      v_window.reserved_output_tokens,
      v_window.committed_output_tokens,
      v_window.reserved_reasoning_tokens,
      v_window.committed_reasoning_tokens,
      v_window.reserved_tool_envelope_bytes,
      v_window.committed_tool_envelope_bytes,
      v_lease.reserved_input_tokens,
      v_lease.reserved_output_tokens,
      v_lease.reserved_reasoning_tokens,
      v_lease.reserved_tool_envelope_bytes;
    RETURN;
  END IF;

  INSERT INTO public.case_vortex_research_usage_reservations (
    reservation_id,
    lease_token,
    input_tokens,
    output_tokens,
    reasoning_tokens,
    tool_envelope_bytes,
    created_at
  ) VALUES (
    p_reservation_id,
    p_lease_token,
    p_input_tokens,
    p_output_tokens,
    p_reasoning_tokens,
    p_tool_envelope_bytes,
    v_now
  );

  UPDATE public.case_vortex_research_usage_windows AS usage_window
  SET reserved_input_tokens = usage_window.reserved_input_tokens + p_input_tokens,
      reserved_output_tokens = usage_window.reserved_output_tokens + p_output_tokens,
      reserved_reasoning_tokens = usage_window.reserved_reasoning_tokens + p_reasoning_tokens,
      reserved_tool_envelope_bytes = usage_window.reserved_tool_envelope_bytes + p_tool_envelope_bytes,
      updated_at = v_now
  WHERE usage_window.subject_kind = v_lease.subject_kind
    AND usage_window.subject_hash = v_lease.subject_hash
    AND usage_window.window_started_at = v_lease.window_started_at
  RETURNING usage_window.* INTO v_window;

  UPDATE public.case_vortex_research_usage_leases AS lease
  SET reserved_input_tokens = lease.reserved_input_tokens + p_input_tokens,
      reserved_output_tokens = lease.reserved_output_tokens + p_output_tokens,
      reserved_reasoning_tokens = lease.reserved_reasoning_tokens + p_reasoning_tokens,
      reserved_tool_envelope_bytes = lease.reserved_tool_envelope_bytes + p_tool_envelope_bytes
  WHERE lease.lease_token = p_lease_token
  RETURNING lease.* INTO v_lease;

  RETURN QUERY SELECT
    true,
    NULL::text,
    NULL::integer,
    v_lease.expires_at,
    v_window.reserved_input_tokens,
    v_window.committed_input_tokens,
    v_window.reserved_output_tokens,
    v_window.committed_output_tokens,
    v_window.reserved_reasoning_tokens,
    v_window.committed_reasoning_tokens,
    v_window.reserved_tool_envelope_bytes,
    v_window.committed_tool_envelope_bytes,
    v_lease.reserved_input_tokens,
    v_lease.reserved_output_tokens,
    v_lease.reserved_reasoning_tokens,
    v_lease.reserved_tool_envelope_bytes;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_case_vortex_research_usage_lease(
  p_lease_token UUID,
  p_settlement_id UUID,
  p_input_tokens BIGINT,
  p_output_tokens BIGINT,
  p_reasoning_tokens BIGINT,
  p_tool_envelope_bytes BIGINT
)
RETURNS TABLE (
  settled_at TIMESTAMPTZ,
  reserved_input_tokens BIGINT,
  committed_input_tokens BIGINT,
  reserved_output_tokens BIGINT,
  committed_output_tokens BIGINT,
  reserved_reasoning_tokens BIGINT,
  committed_reasoning_tokens BIGINT,
  reserved_tool_envelope_bytes BIGINT,
  committed_tool_envelope_bytes BIGINT,
  lease_committed_input_tokens BIGINT,
  lease_committed_output_tokens BIGINT,
  lease_committed_reasoning_tokens BIGINT,
  lease_committed_tool_envelope_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_lease public.case_vortex_research_usage_leases%ROWTYPE;
  v_window public.case_vortex_research_usage_windows%ROWTYPE;
  v_digest VARCHAR(64);
BEGIN
  IF p_lease_token IS NULL
    OR p_settlement_id IS NULL
    OR p_input_tokens NOT BETWEEN 0 AND 6000000
    OR p_output_tokens NOT BETWEEN 0 AND 100000
    OR p_reasoning_tokens NOT BETWEEN 0 AND 1000000
    OR p_tool_envelope_bytes NOT BETWEEN 0 AND 16777216
  THEN
    RAISE EXCEPTION 'case-vortex research usage settlement is invalid';
  END IF;
  v_digest := public.case_vortex_research_usage_charge_sha256(
    p_input_tokens,
    p_output_tokens,
    p_reasoning_tokens,
    p_tool_envelope_bytes
  );

  SELECT lease.* INTO v_lease
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.lease_token = p_lease_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-vortex research usage lease is unknown';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-vortex-research-usage:' || v_lease.subject_kind || ':' || v_lease.subject_hash,
      0
    )
  );
  PERFORM public.case_vortex_research_usage_reap_subject(
    v_lease.subject_kind,
    v_lease.subject_hash,
    v_now
  );

  SELECT lease.* INTO v_lease
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.lease_token = p_lease_token
  FOR UPDATE;
  SELECT usage_window.* INTO v_window
  FROM public.case_vortex_research_usage_windows AS usage_window
  WHERE usage_window.subject_kind = v_lease.subject_kind
    AND usage_window.subject_hash = v_lease.subject_hash
    AND usage_window.window_started_at = v_lease.window_started_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case-vortex research usage settlement window is missing';
  END IF;

  IF v_lease.settled_at IS NOT NULL THEN
    IF v_lease.settlement_kind <> 'client'
      OR v_lease.settlement_id IS DISTINCT FROM p_settlement_id
      OR v_lease.settlement_sha256 <> v_digest
    THEN
      RAISE EXCEPTION 'case-vortex research usage settlement idempotency conflict';
    END IF;
    RETURN QUERY SELECT
      v_lease.settled_at,
      v_window.reserved_input_tokens,
      v_window.committed_input_tokens,
      v_window.reserved_output_tokens,
      v_window.committed_output_tokens,
      v_window.reserved_reasoning_tokens,
      v_window.committed_reasoning_tokens,
      v_window.reserved_tool_envelope_bytes,
      v_window.committed_tool_envelope_bytes,
      v_lease.committed_input_tokens,
      v_lease.committed_output_tokens,
      v_lease.committed_reasoning_tokens,
      v_lease.committed_tool_envelope_bytes;
    RETURN;
  END IF;

  IF v_lease.released_at IS NOT NULL OR v_lease.expires_at <= v_now THEN
    RAISE EXCEPTION 'case-vortex research usage settlement requires an active lease';
  END IF;
  IF p_input_tokens > v_lease.reserved_input_tokens
    OR p_output_tokens > v_lease.reserved_output_tokens
    OR p_reasoning_tokens > v_lease.reserved_reasoning_tokens
    OR p_tool_envelope_bytes > v_lease.reserved_tool_envelope_bytes
  THEN
    RAISE EXCEPTION 'case-vortex research usage settlement exceeds reservation';
  END IF;

  UPDATE public.case_vortex_research_usage_windows AS usage_window
  SET reserved_input_tokens = usage_window.reserved_input_tokens - v_lease.reserved_input_tokens,
      committed_input_tokens = usage_window.committed_input_tokens + p_input_tokens,
      reserved_output_tokens = usage_window.reserved_output_tokens - v_lease.reserved_output_tokens,
      committed_output_tokens = usage_window.committed_output_tokens + p_output_tokens,
      reserved_reasoning_tokens = usage_window.reserved_reasoning_tokens - v_lease.reserved_reasoning_tokens,
      committed_reasoning_tokens = usage_window.committed_reasoning_tokens + p_reasoning_tokens,
      reserved_tool_envelope_bytes = usage_window.reserved_tool_envelope_bytes - v_lease.reserved_tool_envelope_bytes,
      committed_tool_envelope_bytes = usage_window.committed_tool_envelope_bytes + p_tool_envelope_bytes,
      updated_at = v_now
  WHERE usage_window.subject_kind = v_lease.subject_kind
    AND usage_window.subject_hash = v_lease.subject_hash
    AND usage_window.window_started_at = v_lease.window_started_at
  RETURNING usage_window.* INTO v_window;

  UPDATE public.case_vortex_research_usage_leases AS lease
  SET committed_input_tokens = p_input_tokens,
      committed_output_tokens = p_output_tokens,
      committed_reasoning_tokens = p_reasoning_tokens,
      committed_tool_envelope_bytes = p_tool_envelope_bytes,
      settlement_id = p_settlement_id,
      settlement_sha256 = v_digest,
      settlement_kind = 'client',
      settled_at = v_now
  WHERE lease.lease_token = p_lease_token
  RETURNING lease.* INTO v_lease;

  RETURN QUERY SELECT
    v_lease.settled_at,
    v_window.reserved_input_tokens,
    v_window.committed_input_tokens,
    v_window.reserved_output_tokens,
    v_window.committed_output_tokens,
    v_window.reserved_reasoning_tokens,
    v_window.committed_reasoning_tokens,
    v_window.reserved_tool_envelope_bytes,
    v_window.committed_tool_envelope_bytes,
    v_lease.committed_input_tokens,
    v_lease.committed_output_tokens,
    v_lease.committed_reasoning_tokens,
    v_lease.committed_tool_envelope_bytes;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_case_vortex_research_usage_lease(
  p_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_lease public.case_vortex_research_usage_leases%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL THEN
    RETURN false;
  END IF;
  SELECT lease.* INTO v_lease
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.lease_token = p_lease_token;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-vortex-research-usage:' || v_lease.subject_kind || ':' || v_lease.subject_hash,
      0
    )
  );
  PERFORM public.case_vortex_research_usage_reap_subject(
    v_lease.subject_kind,
    v_lease.subject_hash,
    v_now
  );
  SELECT lease.* INTO v_lease
  FROM public.case_vortex_research_usage_leases AS lease
  WHERE lease.lease_token = p_lease_token
  FOR UPDATE;

  -- A known lease always releases successfully, including retries and leases
  -- that the deadline reaper already closed.
  IF v_lease.released_at IS NOT NULL THEN
    RETURN true;
  END IF;

  IF v_lease.settled_at IS NULL THEN
    -- Unknown provider usage is never treated as free. A crash/finally release
    -- commits the full prior reservation, keeping the window fail closed.
    UPDATE public.case_vortex_research_usage_windows AS usage_window
    SET reserved_input_tokens = usage_window.reserved_input_tokens - v_lease.reserved_input_tokens,
        committed_input_tokens = usage_window.committed_input_tokens + v_lease.reserved_input_tokens,
        reserved_output_tokens = usage_window.reserved_output_tokens - v_lease.reserved_output_tokens,
        committed_output_tokens = usage_window.committed_output_tokens + v_lease.reserved_output_tokens,
        reserved_reasoning_tokens = usage_window.reserved_reasoning_tokens - v_lease.reserved_reasoning_tokens,
        committed_reasoning_tokens = usage_window.committed_reasoning_tokens + v_lease.reserved_reasoning_tokens,
        reserved_tool_envelope_bytes = usage_window.reserved_tool_envelope_bytes - v_lease.reserved_tool_envelope_bytes,
        committed_tool_envelope_bytes = usage_window.committed_tool_envelope_bytes + v_lease.reserved_tool_envelope_bytes,
        updated_at = v_now
    WHERE usage_window.subject_kind = v_lease.subject_kind
      AND usage_window.subject_hash = v_lease.subject_hash
      AND usage_window.window_started_at = v_lease.window_started_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case-vortex research usage release window is missing';
    END IF;

    UPDATE public.case_vortex_research_usage_leases AS lease
    SET committed_input_tokens = v_lease.reserved_input_tokens,
        committed_output_tokens = v_lease.reserved_output_tokens,
        committed_reasoning_tokens = v_lease.reserved_reasoning_tokens,
        committed_tool_envelope_bytes = v_lease.reserved_tool_envelope_bytes,
        settlement_kind = 'released_assumed',
        settlement_sha256 = public.case_vortex_research_usage_charge_sha256(
          v_lease.reserved_input_tokens,
          v_lease.reserved_output_tokens,
          v_lease.reserved_reasoning_tokens,
          v_lease.reserved_tool_envelope_bytes
        ),
        settled_at = v_now
    WHERE lease.lease_token = p_lease_token;
  END IF;

  UPDATE public.case_vortex_research_usage_leases AS lease
  SET release_kind = 'client',
      released_at = v_now
  WHERE lease.lease_token = p_lease_token;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_expired_case_vortex_research_usage_leases(
  p_subject_limit INTEGER DEFAULT 1000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subject RECORD;
  v_total INTEGER := 0;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_subject_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'case-vortex research usage reaper limit is invalid';
  END IF;

  FOR v_subject IN
    SELECT lease.subject_kind, lease.subject_hash, MIN(lease.expires_at) AS first_expiry
    FROM public.case_vortex_research_usage_leases AS lease
    WHERE lease.released_at IS NULL
      AND lease.expires_at <= v_now
    GROUP BY lease.subject_kind, lease.subject_hash
    ORDER BY first_expiry, lease.subject_kind, lease.subject_hash
    LIMIT p_subject_limit
  LOOP
    v_total := v_total + public.case_vortex_research_usage_reap_subject(
      v_subject.subject_kind,
      v_subject.subject_hash,
      v_now
    );
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_case_vortex_research_usage_limiter(
  p_row_limit INTEGER DEFAULT 1000
)
RETURNS TABLE (
  reaped_leases INTEGER,
  deleted_leases INTEGER,
  deleted_windows INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_reaped INTEGER;
  v_deleted_leases INTEGER;
  v_deleted_windows INTEGER;
BEGIN
  IF p_row_limit NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'case-vortex research usage cleanup limit is invalid';
  END IF;
  v_reaped := public.reap_expired_case_vortex_research_usage_leases(
    LEAST(1000, p_row_limit)
  );

  WITH doomed AS (
    SELECT lease.ctid
    FROM public.case_vortex_research_usage_leases AS lease
    WHERE lease.released_at IS NOT NULL
      AND lease.released_at <= v_now - interval '24 hours'
      AND lease.expires_at <= v_now - interval '24 hours'
    ORDER BY lease.released_at, lease.lease_token
    LIMIT p_row_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.case_vortex_research_usage_leases AS lease
  USING doomed
  WHERE lease.ctid = doomed.ctid;
  GET DIAGNOSTICS v_deleted_leases = ROW_COUNT;

  WITH doomed AS (
    SELECT usage_window.ctid
    FROM public.case_vortex_research_usage_windows AS usage_window
    WHERE usage_window.window_ends_at <= v_now - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.case_vortex_research_usage_leases AS lease
        WHERE lease.subject_kind = usage_window.subject_kind
          AND lease.subject_hash = usage_window.subject_hash
          AND lease.window_started_at = usage_window.window_started_at
      )
    ORDER BY usage_window.window_started_at, usage_window.subject_kind, usage_window.subject_hash
    LIMIT p_row_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.case_vortex_research_usage_windows AS usage_window
  USING doomed
  WHERE usage_window.ctid = doomed.ctid;
  GET DIAGNOSTICS v_deleted_windows = ROW_COUNT;

  RETURN QUERY SELECT v_reaped, v_deleted_leases, v_deleted_windows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.case_vortex_research_usage_policy_sha256() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_vortex_research_usage_charge_sha256(BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.case_vortex_research_usage_reap_subject(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_case_vortex_research_usage_lease(TEXT, TEXT, UUID, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_case_vortex_research_usage(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_case_vortex_research_usage_lease(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_case_vortex_research_usage_lease(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reap_expired_case_vortex_research_usage_leases(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_case_vortex_research_usage_limiter(INTEGER) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.case_vortex_research_usage_windows FROM anon;
    REVOKE ALL ON TABLE public.case_vortex_research_usage_leases FROM anon;
    REVOKE ALL ON TABLE public.case_vortex_research_usage_reservations FROM anon;
    REVOKE EXECUTE ON FUNCTION public.acquire_case_vortex_research_usage_lease(TEXT, TEXT, UUID, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.reserve_case_vortex_research_usage(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.settle_case_vortex_research_usage_lease(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.release_case_vortex_research_usage_lease(UUID) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.reap_expired_case_vortex_research_usage_leases(INTEGER) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.cleanup_case_vortex_research_usage_limiter(INTEGER) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.case_vortex_research_usage_windows FROM authenticated;
    REVOKE ALL ON TABLE public.case_vortex_research_usage_leases FROM authenticated;
    REVOKE ALL ON TABLE public.case_vortex_research_usage_reservations FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.acquire_case_vortex_research_usage_lease(TEXT, TEXT, UUID, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.reserve_case_vortex_research_usage(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.settle_case_vortex_research_usage_lease(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.release_case_vortex_research_usage_lease(UUID) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.reap_expired_case_vortex_research_usage_leases(INTEGER) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.cleanup_case_vortex_research_usage_limiter(INTEGER) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    -- No direct reads or writes are required by the API. Every state change is
    -- confined to the SECURITY DEFINER RPC contract below.
    REVOKE ALL ON TABLE public.case_vortex_research_usage_windows FROM service_role;
    REVOKE ALL ON TABLE public.case_vortex_research_usage_leases FROM service_role;
    REVOKE ALL ON TABLE public.case_vortex_research_usage_reservations FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.case_vortex_research_usage_policy_sha256() FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.case_vortex_research_usage_charge_sha256(BIGINT, BIGINT, BIGINT, BIGINT) FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.case_vortex_research_usage_reap_subject(TEXT, TEXT, TIMESTAMPTZ) FROM service_role;

    GRANT EXECUTE ON FUNCTION public.acquire_case_vortex_research_usage_lease(TEXT, TEXT, UUID, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.reserve_case_vortex_research_usage(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.settle_case_vortex_research_usage_lease(UUID, UUID, BIGINT, BIGINT, BIGINT, BIGINT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.release_case_vortex_research_usage_lease(UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.reap_expired_case_vortex_research_usage_leases(INTEGER)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.cleanup_case_vortex_research_usage_limiter(INTEGER)
      TO service_role;
  END IF;
END;
$$;
