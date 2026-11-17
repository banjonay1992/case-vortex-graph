-- Match the Case Vortex archive cursor contract exactly. Node/Postgres JSON
-- boundaries preserve milliseconds, so the durable keyset must order at the
-- same precision before UUID tie-breaking. This prevents skips or duplicates
-- when bulk ingests share a timestamp inside one millisecond.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_uap_sightings_case_graph_source_cursor_ms
  ON public.uap_sightings (
    (UPPER(COALESCE(NULLIF(TRIM(source), ''), ''))),
    (date_trunc(
      'milliseconds',
      COALESCE(updated_at, event_timestamp, created_at, ingested_at) AT TIME ZONE 'UTC'
    )),
    id
  );

DROP INDEX CONCURRENTLY IF EXISTS public.idx_uap_sightings_case_graph_source_cursor;
