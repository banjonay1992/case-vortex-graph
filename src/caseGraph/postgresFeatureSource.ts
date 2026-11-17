import { buildRegistryBlocklistFilter, PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS } from '../utils/dataQualitySql';
import { GOVERNED_PUBLIC_CONTENT_MODES, PUBLISHABLE_SIGHTING_POLICY_MODE } from '../utils/dataQualityVisibility';
import type {
  CaseGraphCursor,
  CaseGraphUnmaterializedFeatureSource,
  CaseGraphSourceRow,
  CaseGraphSourceCensus,
} from './archiveTypes';

type QueryResult = { rows: Record<string, unknown>[] };
type QueryWithOptions = (
  sql: string,
  params?: unknown[],
  options?: { queryTimeoutMs?: number; statementTimeoutMs?: number },
) => Promise<QueryResult>;

const DEFAULT_READ_TIMEOUT_MS = 5 * 60 * 1_000;
const CURSOR_EXPRESSION = 'COALESCE(s.updated_at, s.event_timestamp, s.created_at, s.ingested_at)';
const CURSOR_ORDER_EXPRESSION = `date_trunc('milliseconds', ${CURSOR_EXPRESSION} AT TIME ZONE 'UTC')`;
const CURSOR_OUTPUT_EXPRESSION = `(${CURSOR_ORDER_EXPRESSION} AT TIME ZONE 'UTC')`;
const NORMALIZED_SOURCE_EXPRESSION = "UPPER(COALESCE(NULLIF(TRIM(s.source), ''), ''))";
const GOVERNED_SOURCE_CTES = `
  approved_canonical_sources AS MATERIALIZED (
    SELECT DISTINCT UPPER(TRIM(legal.canonical_source)) AS canonical_source
    FROM uap_source_legal_registry legal
    WHERE LOWER(COALESCE(legal.legal_status, '')) = 'approved'
      AND (
        legal.allowed_content_modes IS NULL
        OR cardinality(legal.allowed_content_modes) = 0
        OR EXISTS (
          SELECT 1 FROM unnest(legal.allowed_content_modes) AS mode
          WHERE LOWER(mode) IN (${GOVERNED_PUBLIC_CONTENT_MODES.map((mode) => `'${mode}'`).join(', ')})
        )
      )
  ),
  approved_source_keys AS MATERIALIZED (
    SELECT canonical_source AS source_key FROM approved_canonical_sources
    UNION
    SELECT UPPER(TRIM(alias.alias)) AS source_key
    FROM uap_source_alias_map alias
    JOIN approved_canonical_sources approved
      ON approved.canonical_source = UPPER(TRIM(alias.canonical_source))
    WHERE COALESCE(alias.active, true) = true
  )`;
const PUBLISHABLE_BASE_FILTER = `
      ${buildRegistryBlocklistFilter('s')}
      AND (s.event_timestamp IS NULL OR s.event_timestamp <= $2::timestamptz)
      AND (
        (s.lat IS NULL AND s.lon IS NULL)
        OR (s.lat IS NOT NULL AND s.lon IS NOT NULL AND s.lat BETWEEN -90 AND 90 AND s.lon BETWEEN -180 AND 180)
      )`;
const PUBLISHABLE_ROW_FILTER = `
      ${PUBLISHABLE_BASE_FILTER}
      AND NOT EXISTS (
        SELECT 1
        FROM uap_sighting_duplicate_members dm
        JOIN uap_sighting_duplicate_clusters dc ON dc.id = dm.cluster_id
        WHERE dm.sighting_id = s.id::uuid
          AND dc.status = 'confirmed'
          AND dc.primary_sighting_id IS DISTINCT FROM s.id::uuid
      )`;

const toIso = (value: unknown, label: string) => {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
};

const cursorFromRow = (row: Record<string, unknown> | undefined): CaseGraphCursor | null => {
  if (!row) return null;
  const caseId = String(row.case_id || row.id || '').trim().toLowerCase();
  if (!caseId) throw new Error('case_graph_postgres_cursor_id_invalid');
  return {
    updated_at: toIso(row.cursor_ts, 'case_graph_postgres_cursor_timestamp'),
    case_id: caseId,
  };
};

const numberOrNull = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sourceRowFromDb = (row: Record<string, unknown>): CaseGraphSourceRow => {
  const cursor = cursorFromRow(row);
  if (!cursor) throw new Error('case_graph_postgres_row_cursor_missing');
  return {
    cursor,
    sighting: {
      id: row.case_id ?? row.id,
      source: row.source,
      source_record_id: row.source_record_id,
      external_id: row.external_id,
      source_url: row.source_url,
      ingestion_job_id: row.ingestion_job_id,
      event_timestamp: row.event_timestamp,
      event_date_precision: row.event_date_precision,
      lat: numberOrNull(row.lat),
      lon: numberOrNull(row.lon),
      geo_precision: row.geo_precision,
      location: row.location,
      city: row.city,
      region: row.region,
      country: row.country,
      country_code: row.country_code,
      description: row.description,
      description_clean: row.description_clean,
      summary: row.summary,
      ai_summary: row.ai_summary,
      shape: row.shape,
      shape_normalized: row.shape_normalized,
      duration_seconds: numberOrNull(row.duration_seconds),
      ai_keywords: row.ai_keywords,
      ai_entities: row.ai_entities,
      updated_at: row.cursor_ts,
    },
  };
};

const compareCursors = (left: CaseGraphCursor, right: CaseGraphCursor) => (
  left.updated_at.localeCompare(right.updated_at) || left.case_id.localeCompare(right.case_id)
);

export const createPostgresCaseGraphFeatureSource = (
  queryWithOptions: QueryWithOptions,
  options: { snapshotAt?: Date | string; timeoutMs?: number; pageStrategy?: 'per_source_lateral' | 'global_cursor' } = {},
): CaseGraphUnmaterializedFeatureSource => {
  const snapshotAt = toIso(options.snapshotAt || new Date(), 'case_graph_postgres_snapshot');
  const futureCutoffAt = new Date(new Date(snapshotAt).getTime() + PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS * 86_400_000).toISOString();
  const timeoutMs = Math.trunc(options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60 * 1_000) {
    throw new Error('case_graph_postgres_timeout_invalid');
  }
  const readOptions = { queryTimeoutMs: timeoutMs, statementTimeoutMs: timeoutMs };
  const pageStrategy = options.pageStrategy ?? 'per_source_lateral';
  if (pageStrategy !== 'per_source_lateral' && pageStrategy !== 'global_cursor') {
    throw new Error('case_graph_postgres_page_strategy_invalid');
  }
  const frozenFilter = `${PUBLISHABLE_ROW_FILTER}\n      AND ${CURSOR_EXPRESSION} <= $1::timestamptz`;
  const frozenParams = [snapshotAt, futureCutoffAt];

  return {
    async inspectEligibleSnapshot(): Promise<CaseGraphSourceCensus> {
      const approved = await queryWithOptions(`WITH ${GOVERNED_SOURCE_CTES}
        SELECT source_key FROM approved_source_keys ORDER BY source_key ASC
      `, [], readOptions);
      const sourceCounts: Record<string, number> = {};
      let minCursor: CaseGraphCursor | null = null;
      let maxCursor: CaseGraphCursor | null = null;
      for (const approvedRow of approved.rows) {
        const sourceKey = String(approvedRow.source_key || '').trim().toUpperCase();
        if (!sourceKey) continue;
        const result = await queryWithOptions(`WITH eligible AS MATERIALIZED (
            SELECT ${CURSOR_OUTPUT_EXPRESSION} AS cursor_ts, s.id::text AS case_id
            FROM uap_sightings s
            WHERE ${NORMALIZED_SOURCE_EXPRESSION} = $3::text
              AND ${frozenFilter}
          ),
          min_bound AS (
            SELECT cursor_ts, case_id FROM eligible ORDER BY cursor_ts ASC, case_id ASC LIMIT 1
          ),
          max_bound AS (
            SELECT cursor_ts, case_id FROM eligible ORDER BY cursor_ts DESC, case_id DESC LIMIT 1
          )
          SELECT
            (SELECT COUNT(*)::bigint FROM eligible) AS row_count,
            (SELECT cursor_ts FROM min_bound) AS min_cursor_ts,
            (SELECT case_id FROM min_bound) AS min_case_id,
            (SELECT cursor_ts FROM max_bound) AS max_cursor_ts,
            (SELECT case_id FROM max_bound) AS max_case_id
        `, [...frozenParams, sourceKey], readOptions);
        const row = result.rows[0] || {};
        const rowCount = Number(row.row_count);
        if (!Number.isSafeInteger(rowCount) || rowCount <= 0) continue;
        const source = sourceKey.toLowerCase();
        sourceCounts[source] = rowCount;
        const sourceMin = cursorFromRow({ cursor_ts: row.min_cursor_ts, case_id: row.min_case_id });
        const sourceMax = cursorFromRow({ cursor_ts: row.max_cursor_ts, case_id: row.max_case_id });
        if (sourceMin && (!minCursor || compareCursors(sourceMin, minCursor) < 0)) minCursor = sourceMin;
        if (sourceMax && (!maxCursor || compareCursors(sourceMax, maxCursor) > 0)) maxCursor = sourceMax;
      }
      return {
        eligible_count: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
        min_cursor: minCursor,
        max_cursor: maxCursor,
        source_counts: sourceCounts,
        publishability_policy: PUBLISHABLE_SIGHTING_POLICY_MODE,
        snapshot_at: snapshotAt,
      };
    },

    async fetchEligiblePage(cursor: CaseGraphCursor | null, limit: number): Promise<CaseGraphSourceRow[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25_000) {
        throw new Error('case_graph_postgres_page_limit_invalid');
      }
      const cursorPredicate = cursor
        ? `AND (${CURSOR_ORDER_EXPRESSION}, s.id) > (($3::timestamptz AT TIME ZONE 'UTC'), $4::uuid)`
        : '';
      const params = cursor
        ? [...frozenParams, cursor.updated_at, cursor.case_id, limit]
        : [...frozenParams, limit];
      const limitPlaceholder = cursor ? '$5' : '$3';
      const eligiblePage = pageStrategy === 'global_cursor' ? `
        eligible_page AS MATERIALIZED (
          SELECT s.*
          FROM uap_sightings s
          JOIN approved_source_keys approved ON approved.source_key =
            ${NORMALIZED_SOURCE_EXPRESSION}
          WHERE ${PUBLISHABLE_ROW_FILTER}
            AND ${CURSOR_EXPRESSION} <= $1::timestamptz
            ${cursorPredicate}
          ORDER BY
            ${CURSOR_ORDER_EXPRESSION} ASC, s.id ASC
          LIMIT ${limitPlaceholder}::int
        )` : `
        eligible_page AS MATERIALIZED (
          SELECT candidate.*
          FROM approved_source_keys approved
          CROSS JOIN LATERAL (
            SELECT s.*
            FROM uap_sightings s
            WHERE ${NORMALIZED_SOURCE_EXPRESSION} = approved.source_key
              AND ${PUBLISHABLE_ROW_FILTER}
              AND ${CURSOR_EXPRESSION} <= $1::timestamptz
              ${cursorPredicate}
            ORDER BY
              ${CURSOR_ORDER_EXPRESSION} ASC, s.id ASC
            LIMIT ${limitPlaceholder}::int
          ) candidate
        )`;
      const result = await queryWithOptions(`WITH ${GOVERNED_SOURCE_CTES},${eligiblePage}
        SELECT
          s.id::text AS case_id,
          ${CURSOR_OUTPUT_EXPRESSION} AS cursor_ts,
          s.source,
          s.source_record_id,
          s.external_id,
          s.source_url,
          s.ingestion_job_id,
          s.event_timestamp,
          s.event_date_precision,
          s.lat::double precision AS lat,
          s.lon::double precision AS lon,
          s.geo_precision,
          COALESCE(s.location_normalized, s.location_raw, s.location) AS location,
          s.city,
          s.region,
          s.country,
          s.country_code,
          s.description,
          s.description_clean,
          s.summary,
          s.ai_summary,
          s.shape,
          s.shape_normalized,
          s.duration_seconds,
          s.ai_keywords,
          s.ai_entities
        FROM eligible_page s
        ORDER BY cursor_ts ASC, s.id ASC
        LIMIT ${limitPlaceholder}::int
      `, params, readOptions);
      return result.rows.map(sourceRowFromDb);
    },
  };
};
