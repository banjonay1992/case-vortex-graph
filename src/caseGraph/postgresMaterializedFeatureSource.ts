import { PUBLISHABLE_SIGHTING_POLICY_MODE } from '../utils/dataQualityVisibility';
import type {
  CaseGraphCursor,
  CaseGraphFeatureSource,
  CaseGraphSourceRow,
  CaseGraphSourceStats,
} from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
} from './postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from './postgresEvidenceUniverseSnapshot';

type QueryResult = { rows: Record<string, unknown>[] };
type Query = (
  sql: string,
  params?: unknown[],
  options?: { queryTimeoutMs?: number; statementTimeoutMs?: number },
) => Promise<QueryResult>;

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const snapshotId = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error('case_graph_materialized_snapshot_id_invalid');
  return normalized;
};

const iso = (value: unknown, label: string) => {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
};

const timestampText = (value: unknown, label: string) => {
  const raw = String(value || '').trim();
  const parsed = new Date(raw);
  if (!raw || !Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return raw;
};

const count = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}_invalid`);
  return parsed;
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const payload = (value: unknown) => {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error('case_graph_materialized_snapshot_payload_invalid');
    }
  }
  if (!isObject(parsed)) throw new Error('case_graph_materialized_snapshot_payload_invalid');
  return parsed;
};

const numberOrNull = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sourceRow = (row: Record<string, unknown>): CaseGraphSourceRow => {
  const caseId = String(row.entity_id || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(caseId)) throw new Error('case_graph_materialized_snapshot_case_id_invalid');
  const cursorAt = String(row.cursor_at_text || '').trim();
  iso(cursorAt, 'case_graph_materialized_snapshot_cursor');
  const frozen = payload(row.snapshot_payload);
  if (String(frozen.case_id || '').trim().toLowerCase() !== caseId) {
    throw new Error('case_graph_materialized_snapshot_payload_invalid');
  }
  return {
    cursor: { updated_at: cursorAt, case_id: caseId },
    sighting: {
      id: caseId,
      source: frozen.source,
      source_record_id: frozen.source_record_id,
      external_id: frozen.external_id,
      source_url: frozen.source_url,
      ingestion_job_id: frozen.ingestion_job_id,
      event_timestamp: frozen.event_timestamp,
      event_date_precision: frozen.event_date_precision,
      lat: numberOrNull(frozen.lat),
      lon: numberOrNull(frozen.lon),
      geo_precision: frozen.geo_precision,
      location: frozen.location,
      city: frozen.city,
      region: frozen.region,
      country: frozen.country,
      country_code: frozen.country_code,
      description: frozen.description,
      description_clean: frozen.description_clean,
      summary: frozen.summary,
      ai_summary: frozen.ai_summary,
      shape: frozen.shape,
      shape_normalized: frozen.shape_normalized,
      duration_seconds: numberOrNull(frozen.duration_seconds),
      ai_keywords: frozen.ai_keywords,
      ai_entities: frozen.ai_entities,
      updated_at: cursorAt,
    },
  };
};

export type MaterializedCaseGraphSourceStats = CaseGraphSourceStats & {
  snapshot_id: string;
  snapshot_policy: typeof EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY;
  capture_policy: typeof EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY;
  materialized_at: string;
  source_mvcc_snapshot: string;
};

export const createPostgresMaterializedCaseGraphFeatureSource = (
  query: Query,
  options: { snapshotId: string; timeoutMs?: number },
): CaseGraphFeatureSource & { inspectEligibleSnapshot: () => Promise<MaterializedCaseGraphSourceStats> } => {
  const frozenSnapshotId = snapshotId(options.snapshotId);
  const timeoutMs = Math.trunc(options.timeoutMs ?? 5 * 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000) {
    throw new Error('case_graph_materialized_snapshot_timeout_invalid');
  }
  const queryOptions = { queryTimeoutMs: timeoutMs, statementTimeoutMs: timeoutMs };
  let inspected = false;

  return {
    async inspectEligibleSnapshot(): Promise<MaterializedCaseGraphSourceStats> {
      const result = await query(`
        WITH immutable_capability AS (
          SELECT
            COUNT(*) FILTER (
              WHERE trigger_row.tgname = 'trg_uap_evidence_universe_snapshot_row_guard'
                AND relation.relname = 'uap_evidence_universe_snapshot_rows'
                AND trigger_row.tgtype = 31
                AND trigger_function.proname = 'uap_evidence_universe_snapshot_row_guard'
            ) = 1
            AND COUNT(*) FILTER (
              WHERE trigger_row.tgname = 'trg_uap_evidence_universe_snapshot_component_guard'
                AND relation.relname = 'uap_evidence_universe_snapshot_components'
                AND trigger_row.tgtype = 27
                AND trigger_function.proname = 'uap_evidence_universe_snapshot_component_guard'
            ) = 1
            AND COUNT(*) FILTER (
              WHERE trigger_row.tgname = 'trg_uap_evidence_universe_snapshot_header_guard'
                AND relation.relname = 'uap_evidence_universe_snapshots'
                AND trigger_row.tgtype = 27
                AND trigger_function.proname = 'uap_evidence_universe_snapshot_header_guard'
            ) = 1 AS enforced
          FROM pg_catalog.pg_trigger AS trigger_row
          JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
          JOIN pg_catalog.pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
          JOIN pg_catalog.pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
          JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = trigger_function.pronamespace
          WHERE relation_namespace.nspname = 'public'
            AND function_namespace.nspname = 'public'
            AND trigger_row.tgisinternal = false
            AND trigger_row.tgenabled IN ('O', 'A')
            AND trigger_function.pronargs = 0
        ),
        privilege_capability AS (
          SELECT
            COUNT(*) = 3
            AND BOOL_AND(relation.relrowsecurity)
            AND NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_class AS protected_relation
              JOIN pg_catalog.pg_namespace AS protected_namespace
                ON protected_namespace.oid = protected_relation.relnamespace
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  protected_relation.relacl,
                  pg_catalog.acldefault('r', protected_relation.relowner)
                )
              ) AS privilege
              LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
              WHERE protected_namespace.nspname = 'public'
                AND protected_relation.relname IN (
                  'uap_evidence_universe_snapshots',
                  'uap_evidence_universe_snapshot_components',
                  'uap_evidence_universe_snapshot_rows'
                )
                AND (
                  (
                    (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
                    AND privilege.privilege_type IN (
                      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
                    )
                  )
                  OR (
                    grantee.rolname = 'service_role'
                    AND privilege.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
                  )
                )
            ) AS enforced
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
          WHERE relation_namespace.nspname = 'public'
            AND relation.relname IN (
              'uap_evidence_universe_snapshots',
              'uap_evidence_universe_snapshot_components',
              'uap_evidence_universe_snapshot_rows'
            )
        ),
        bounds AS MATERIALIZED (
          SELECT snapshot_row.cursor_at, snapshot_row.entity_id
          FROM public.uap_evidence_universe_snapshot_rows AS snapshot_row
          WHERE snapshot_row.snapshot_id = $1::uuid
            AND snapshot_row.entity_kind = 'sighting'
        ),
        min_bound AS (
          SELECT cursor_at, entity_id FROM bounds ORDER BY cursor_at, entity_id COLLATE "C" LIMIT 1
        ),
        max_bound AS (
          SELECT cursor_at, entity_id FROM bounds ORDER BY cursor_at DESC, entity_id COLLATE "C" DESC LIMIT 1
        )
        SELECT
          snapshot.id::text AS snapshot_id,
          snapshot.source_snapshot_at,
          to_char(
            snapshot.materialized_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS materialized_at,
          snapshot.source_mvcc_snapshot,
          snapshot.snapshot_policy,
          component.capture_policy,
          component.status,
          component.row_count,
          component.source_counts,
          component.captured_at,
          immutable_capability.enforced
            AND privilege_capability.enforced AS immutability_enforced,
          (SELECT COUNT(*)::bigint FROM bounds) AS actual_count,
          (SELECT to_char(cursor_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM min_bound) AS min_cursor_at,
          (SELECT entity_id FROM min_bound) AS min_entity_id,
          (SELECT to_char(cursor_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM max_bound) AS max_cursor_at,
          (SELECT entity_id FROM max_bound) AS max_entity_id
        FROM public.uap_evidence_universe_snapshots AS snapshot
        JOIN public.uap_evidence_universe_snapshot_components AS component
          ON component.snapshot_id = snapshot.id
          AND component.entity_kind = 'sighting'
        CROSS JOIN immutable_capability
        CROSS JOIN privilege_capability
        WHERE snapshot.id = $1::uuid
      `, [frozenSnapshotId], queryOptions);
      if (result.rows.length !== 1) throw new Error('case_graph_materialized_snapshot_unavailable');
      const row = result.rows[0];
      const eligibleCount = count(row.row_count, 'case_graph_materialized_snapshot_count');
      if (
        snapshotId(row.snapshot_id) !== frozenSnapshotId
        || row.snapshot_policy !== EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY
        || row.capture_policy !== EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY
        || row.status !== 'complete'
        || row.captured_at == null
        || row.immutability_enforced !== true
        || count(row.actual_count, 'case_graph_materialized_snapshot_actual_count') !== eligibleCount
      ) {
        throw new Error('case_graph_materialized_snapshot_invalid');
      }
      const rawSourceCounts = payload(row.source_counts);
      const sourceCounts: Record<string, number> = {};
      let sourceCountTotal = 0;
      for (const [source, rawCount] of Object.entries(rawSourceCounts)) {
        const sourceCount = count(rawCount, 'case_graph_materialized_snapshot_source_count');
        sourceCounts[source] = sourceCount;
        sourceCountTotal += sourceCount;
      }
      if (sourceCountTotal !== eligibleCount) throw new Error('case_graph_materialized_snapshot_source_count_mismatch');
      const sourceMvccSnapshot = String(row.source_mvcc_snapshot || '').trim();
      if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(sourceMvccSnapshot)) {
        throw new Error('case_graph_materialized_snapshot_mvcc_invalid');
      }
      const minCursor = eligibleCount === 0 ? null : {
        updated_at: String(row.min_cursor_at || ''),
        case_id: String(row.min_entity_id || '').toLowerCase(),
      };
      const maxCursor = eligibleCount === 0 ? null : {
        updated_at: String(row.max_cursor_at || ''),
        case_id: String(row.max_entity_id || '').toLowerCase(),
      };
      if (minCursor) {
        iso(minCursor.updated_at, 'case_graph_materialized_snapshot_min_cursor');
        snapshotId(minCursor.case_id);
      }
      if (maxCursor) {
        iso(maxCursor.updated_at, 'case_graph_materialized_snapshot_max_cursor');
        snapshotId(maxCursor.case_id);
      }
      inspected = true;
      return {
        snapshot_id: frozenSnapshotId,
        snapshot_policy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
        capture_policy: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
        materialized_at: timestampText(row.materialized_at, 'case_graph_materialized_at'),
        source_mvcc_snapshot: sourceMvccSnapshot,
        eligible_count: eligibleCount,
        min_cursor: minCursor,
        max_cursor: maxCursor,
        source_counts: sourceCounts,
        publishability_policy: PUBLISHABLE_SIGHTING_POLICY_MODE,
        snapshot_at: iso(row.source_snapshot_at, 'case_graph_materialized_snapshot_timestamp'),
      };
    },

    async fetchEligiblePage(cursor: CaseGraphCursor | null, limit: number): Promise<CaseGraphSourceRow[]> {
      if (!inspected) throw new Error('case_graph_materialized_snapshot_not_inspected');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25_000) {
        throw new Error('case_graph_materialized_snapshot_page_limit_invalid');
      }
      const cursorSql = cursor
        ? 'AND (snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C") > ($2::timestamptz, $3::text COLLATE "C")'
        : '';
      const limitPlaceholder = cursor ? '$4' : '$2';
      const params = cursor
        ? [frozenSnapshotId, iso(cursor.updated_at, 'case_graph_materialized_snapshot_cursor'), String(cursor.case_id || '').trim(), limit]
        : [frozenSnapshotId, limit];
      if (cursor) snapshotId(cursor.case_id);
      const result = await query(`
        SELECT
          snapshot_row.entity_id,
          snapshot_row.payload AS snapshot_payload,
          to_char(
            snapshot_row.cursor_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS cursor_at_text
        FROM public.uap_evidence_universe_snapshot_rows AS snapshot_row
        WHERE snapshot_row.snapshot_id = $1::uuid
          AND snapshot_row.entity_kind = 'sighting'
          ${cursorSql}
        ORDER BY snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C"
        LIMIT ${limitPlaceholder}::int
      `, params, queryOptions);
      return result.rows.map(sourceRow);
    },
  };
};
