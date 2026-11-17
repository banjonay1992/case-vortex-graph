import {
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
  type EvidenceUniverseRawRecord,
} from './evidenceUniverse';

type MediaKind = Exclude<EvidenceUniverseNodeKind, 'sighting'>;
type Query = (
  sql: string,
  params?: unknown[],
  options?: { queryTimeoutMs?: number; statementTimeoutMs?: number },
) => Promise<{ rows: Record<string, unknown>[] }>;

export type EvidenceMediaCursor = { updatedAt: string; recordId: string };
export type EvidenceMediaPage = { nodes: EvidenceUniverseNode[]; nextCursor: EvidenceMediaCursor | null };
export const EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY = 'evidence-universe-materialized-v1' as const;
export const EVIDENCE_MEDIA_SNAPSHOT_POLICY = 'catalogue-materialized-v1' as const;
export type EvidenceMediaSnapshot = {
  snapshotId: string;
  snapshotAt: string;
  materializedAt: string;
  sourceMvccSnapshot: string;
  snapshotPolicy: typeof EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY;
  capturePolicy: typeof EVIDENCE_MEDIA_SNAPSHOT_POLICY;
  counts: Record<MediaKind, number>;
  backfillsComplete: Record<MediaKind, boolean>;
};

const MEDIA_KINDS: MediaKind[] = ['document', 'photo', 'video'];
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000;

const iso = (value: unknown, label: string) => {
  const parsed = value instanceof Date
    ? new Date(value.getTime())
    : new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
};

const cursorTimestamp = (value: unknown, label: string) => {
  const raw = String(value || '').trim();
  const parsed = new Date(raw);
  if (!raw || !Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return raw;
};

const kind = (value: string): MediaKind => {
  const normalized = String(value || '').trim().toLowerCase() as MediaKind;
  if (!MEDIA_KINDS.includes(normalized)) throw new Error('evidence_media_kind_invalid');
  return normalized;
};

const finiteOrNull = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const snapshotPayload = (value: unknown) => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('evidence_media_snapshot_payload_invalid');
    }
  }
  if (!isObject(parsed)) throw new Error('evidence_media_snapshot_payload_invalid');
  return parsed;
};

const rawRecord = (row: Record<string, unknown>, mediaKind: MediaKind): EvidenceUniverseRawRecord => ({
  kind: mediaKind,
  recordId: String(row.entity_id || ''),
  source: String(row.source || row.source_id || row.provider || 'unknown'),
  sourceRecordId: row.source_record_id == null ? null : String(row.source_record_id),
  title: row.title == null ? null : String(row.title),
  summary: row.description == null ? null : String(row.description),
  canonicalUrl: row.canonical_url == null ? null : String(row.canonical_url),
  previewUrl: row.preview_url == null ? null : String(row.preview_url),
  eventTimestamp: row.event_timestamp == null ? null : String(row.event_timestamp),
  lat: finiteOrNull(row.lat),
  lon: finiteOrNull(row.lon),
  location: row.location_normalized == null ? null : String(row.location_normalized),
  countryCode: row.country_code == null ? null : String(row.country_code),
  linkedSightingId: row.sighting_id == null ? null : String(row.sighting_id),
  updatedAt: String(row.cursor_updated_at || row.updated_at || row.created_at || row.last_indexed_at || ''),
  public: row.is_public === true,
});

export const createPostgresEvidenceMediaSource = (
  query: Query,
  options: { snapshotId: string; timeoutMs?: number },
) => {
  const requestedSnapshotId = String(options.snapshotId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestedSnapshotId)) {
    throw new Error('evidence_media_materialized_snapshot_id_required');
  }
  const timeoutMs = Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60 * 1_000) {
    throw new Error('evidence_media_timeout_invalid');
  }
  const queryOptions = { queryTimeoutMs: timeoutMs, statementTimeoutMs: timeoutMs };
  let resolvedSnapshotId: string | null = null;

  return {
    async inspectSnapshot(): Promise<EvidenceMediaSnapshot> {
      const result = await query(`
        WITH immutable_capability AS (
          SELECT
            COUNT(*) FILTER (
              WHERE trigger_row.tgname = 'trg_uap_evidence_universe_snapshot_row_guard'
                AND relation.relname = 'uap_evidence_universe_snapshot_rows'
                AND trigger_row.tgtype = 31
                AND trigger_function.proname = 'uap_evidence_universe_snapshot_row_guard'
                AND trigger_function.proowner = relation.relowner
                AND trigger_function.prosecdef = false
            ) = 1
            AND COUNT(*) FILTER (
              WHERE trigger_row.tgname = 'trg_uap_evidence_universe_snapshot_component_guard'
                AND relation.relname = 'uap_evidence_universe_snapshot_components'
                AND trigger_row.tgtype = 27
                AND trigger_function.proname = 'uap_evidence_universe_snapshot_component_guard'
                AND trigger_function.proowner = relation.relowner
                AND trigger_function.prosecdef = false
            ) = 1
            AND COUNT(*) FILTER (
              WHERE trigger_row.tgname = 'trg_uap_evidence_universe_snapshot_header_guard'
                AND relation.relname = 'uap_evidence_universe_snapshots'
                AND trigger_row.tgtype = 27
                AND trigger_function.proname = 'uap_evidence_universe_snapshot_header_guard'
                AND trigger_function.proowner = relation.relowner
                AND trigger_function.prosecdef = false
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
                    privilege.grantee <> protected_relation.relowner
                    AND privilege.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
                  )
                  OR (
                    privilege.grantee <> protected_relation.relowner
                    AND grantee.rolname IS DISTINCT FROM 'service_role'
                    AND privilege.privilege_type = 'SELECT'
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
        capture_capability AS (
          SELECT
            COUNT(*) = 1
            AND BOOL_AND(capture_function.prosecdef)
            AND BOOL_AND(capture_function.proowner = snapshot_relation.relowner)
            AND NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_proc AS protected_function
              JOIN pg_catalog.pg_namespace AS protected_namespace
                ON protected_namespace.oid = protected_function.pronamespace
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  protected_function.proacl,
                  pg_catalog.acldefault('f', protected_function.proowner)
                )
              ) AS privilege
              WHERE protected_namespace.nspname = 'public'
                AND protected_function.proname = 'capture_uap_evidence_universe_media_snapshot'
                AND protected_function.pronargs = 1
                AND privilege.grantee <> protected_function.proowner
                AND privilege.privilege_type = 'EXECUTE'
            ) AS enforced
          FROM pg_catalog.pg_proc AS capture_function
          JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = capture_function.pronamespace
          CROSS JOIN pg_catalog.pg_class AS snapshot_relation
          JOIN pg_catalog.pg_namespace AS snapshot_namespace ON snapshot_namespace.oid = snapshot_relation.relnamespace
          WHERE function_namespace.nspname = 'public'
            AND capture_function.proname = 'capture_uap_evidence_universe_media_snapshot'
            AND capture_function.pronargs = 1
            AND snapshot_namespace.nspname = 'public'
            AND snapshot_relation.relname = 'uap_evidence_universe_snapshots'
        )
        SELECT
          snapshot.id::text AS snapshot_id,
          snapshot.source_snapshot_at,
          to_char(
            snapshot.materialized_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS materialized_at,
          snapshot.source_mvcc_snapshot,
          component.entity_kind,
          component.capture_policy,
          component.status,
          component.row_count,
          COUNT(snapshot_row.entity_id)::bigint AS actual_count,
          immutable_capability.enforced
            AND privilege_capability.enforced
            AND capture_capability.enforced AS immutability_enforced
        FROM public.uap_evidence_universe_snapshots AS snapshot
        JOIN public.uap_evidence_universe_snapshot_components AS component
          ON component.snapshot_id = snapshot.id
        CROSS JOIN immutable_capability
        CROSS JOIN privilege_capability
        CROSS JOIN capture_capability
        LEFT JOIN public.uap_evidence_universe_snapshot_rows AS snapshot_row
          ON snapshot_row.snapshot_id = component.snapshot_id
          AND snapshot_row.entity_kind = component.entity_kind
        WHERE snapshot.id = $1::uuid
          AND snapshot.snapshot_policy = $2::text
          AND component.entity_kind = ANY($3::text[])
        GROUP BY
          snapshot.id,
          snapshot.source_snapshot_at,
          snapshot.materialized_at,
          snapshot.source_mvcc_snapshot,
          component.entity_kind,
          component.capture_policy,
          component.status,
          component.row_count,
          immutable_capability.enforced,
          privilege_capability.enforced,
          capture_capability.enforced
        ORDER BY component.entity_kind
      `, [requestedSnapshotId, EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY, MEDIA_KINDS], queryOptions);
      const counts: EvidenceMediaSnapshot['counts'] = { document: 0, photo: 0, video: 0 };
      const backfillsComplete: EvidenceMediaSnapshot['backfillsComplete'] = { document: false, photo: false, video: false };
      let snapshotId: string | null = null;
      let snapshotAt: string | null = null;
      let materializedAt: string | null = null;
      let sourceMvccSnapshot: string | null = null;
      const seenKinds = new Set<MediaKind>();
      for (const row of result.rows) {
        const mediaKind = kind(String(row.entity_kind));
        if (seenKinds.has(mediaKind)) throw new Error('evidence_media_materialized_snapshot_invalid');
        seenKinds.add(mediaKind);
        const count = Number(row.row_count);
        const actualCount = Number(row.actual_count);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('evidence_media_count_invalid');
        if (actualCount !== count) throw new Error('evidence_media_materialized_snapshot_count_mismatch');
        const rowSnapshotId = String(row.snapshot_id || '').trim().toLowerCase();
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(rowSnapshotId)) {
          throw new Error('evidence_media_materialized_snapshot_invalid');
        }
        if (rowSnapshotId !== requestedSnapshotId) throw new Error('evidence_media_materialized_snapshot_invalid');
        if (snapshotId && snapshotId !== rowSnapshotId) throw new Error('evidence_media_materialized_snapshot_invalid');
        const rowSnapshotAt = iso(row.source_snapshot_at, 'evidence_media_materialized_snapshot');
        const rowMaterializedAt = cursorTimestamp(row.materialized_at, 'evidence_media_materialized_at');
        const rowSourceMvccSnapshot = String(row.source_mvcc_snapshot || '').trim();
        if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(rowSourceMvccSnapshot)) {
          throw new Error('evidence_media_materialized_snapshot_mvcc_invalid');
        }
        if (materializedAt && materializedAt !== rowMaterializedAt) {
          throw new Error('evidence_media_materialized_snapshot_invalid');
        }
        if (snapshotAt && snapshotAt !== rowSnapshotAt) {
          throw new Error('evidence_media_materialized_snapshot_invalid');
        }
        const expectedSnapshotAt = new Date(new Date(rowMaterializedAt).getTime() + 1).toISOString();
        if (rowSnapshotAt !== expectedSnapshotAt) {
          throw new Error('evidence_media_materialized_snapshot_timestamp_invalid');
        }
        if (sourceMvccSnapshot && sourceMvccSnapshot !== rowSourceMvccSnapshot) {
          throw new Error('evidence_media_materialized_snapshot_invalid');
        }
        snapshotId = rowSnapshotId;
        snapshotAt = rowSnapshotAt;
        materializedAt = rowMaterializedAt;
        sourceMvccSnapshot = rowSourceMvccSnapshot;
        counts[mediaKind] = count;
        backfillsComplete[mediaKind] = row.status === 'complete'
          && row.capture_policy === EVIDENCE_MEDIA_SNAPSHOT_POLICY
          && row.immutability_enforced === true;
      }
      if (!snapshotId || !snapshotAt || !materializedAt || !sourceMvccSnapshot
        || MEDIA_KINDS.some((mediaKind) => !backfillsComplete[mediaKind])) {
        throw new Error('evidence_media_materialized_snapshot_unavailable');
      }
      resolvedSnapshotId = snapshotId;
      return {
        snapshotId,
        snapshotAt,
        materializedAt,
        sourceMvccSnapshot,
        snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
        capturePolicy: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        counts,
        backfillsComplete,
      };
    },

    async fetchPage(mediaKindInput: string, cursor: EvidenceMediaCursor | null, limit: number): Promise<EvidenceMediaPage> {
      const mediaKind = kind(mediaKindInput);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25_000) throw new Error('evidence_media_page_limit_invalid');
      if (!resolvedSnapshotId) throw new Error('evidence_media_materialized_snapshot_not_inspected');
      const cursorUpdatedAt = cursor ? cursorTimestamp(cursor.updatedAt, 'evidence_media_cursor') : null;
      // Preserve the database text value exactly. PostgreSQL text ordering is
      // case-sensitive, so normalising a persisted cursor can skip a mixed-case
      // boundary record on resume.
      const cursorRecordId = cursor ? String(cursor.recordId ?? '') : null;
      if (cursor && (cursorRecordId == null || cursorRecordId.length === 0)) {
        throw new Error('evidence_media_cursor_id_invalid');
      }
      const cursorSql = cursor
        ? `AND (snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C") > ($3::timestamptz, $4::text COLLATE "C")`
        : '';
      const limitPlaceholder = cursor ? '$5' : '$3';
      const params = cursor
        ? [resolvedSnapshotId, mediaKind, cursorUpdatedAt, cursorRecordId, limit]
        : [resolvedSnapshotId, mediaKind, limit];
      const result = await query(`
        SELECT
          snapshot_row.entity_id,
          snapshot_row.payload AS snapshot_payload,
          to_char(
            snapshot_row.cursor_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS cursor_updated_at,
          snapshot_row.entity_id AS cursor_record_id
        FROM public.uap_evidence_universe_snapshot_rows AS snapshot_row
        WHERE snapshot_row.snapshot_id = $1::uuid
          AND snapshot_row.entity_kind = $2::text
          ${cursorSql}
        ORDER BY snapshot_row.cursor_at, snapshot_row.entity_id COLLATE "C"
        LIMIT ${limitPlaceholder}::int
      `, params, queryOptions);
      const nodes = result.rows.map((row) => {
        const payload = snapshotPayload(row.snapshot_payload);
        if (String(payload.entity_id || '') !== String(row.entity_id || '') || payload.is_public !== true) {
          throw new Error('evidence_media_snapshot_payload_invalid');
        }
        return projectEvidenceUniverseNode(rawRecord({
          ...payload,
          entity_id: row.entity_id,
          cursor_updated_at: row.cursor_updated_at,
        }, mediaKind));
      });
      const last = result.rows.at(-1);
      return {
        nodes,
        nextCursor: last ? {
          updatedAt: cursorTimestamp(last.cursor_updated_at || last.updated_at || last.created_at || last.last_indexed_at, 'evidence_media_result_cursor'),
          recordId: String(last.cursor_record_id ?? last.entity_id ?? ''),
        } : null,
      };
    },
  };
};
