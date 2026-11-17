import { buildRegistryBlocklistFilter, PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS } from '../utils/dataQualitySql';
import { GOVERNED_PUBLIC_CONTENT_MODES } from '../utils/dataQualityVisibility';
import { EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY } from './postgresEvidenceMediaSource';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY = 'publishable-public-v2-materialized-v1' as const;
export const EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY = 'catalogue-materialized-v1' as const;

const COMPONENT_KINDS = ['sighting', 'document', 'photo', 'video'] as const;
type ComponentKind = typeof COMPONENT_KINDS[number];

type QueryResult = { rows: Record<string, unknown>[] };
export type EvidenceUniverseSnapshotTransactionClient = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
};

export type EvidenceUniverseSnapshotReceipt = {
  snapshotId: string;
  snapshotAt: string;
  materializedAt: string;
  sourceMvccSnapshot: string;
  snapshotPolicy: typeof EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY;
  capturePolicies: Record<ComponentKind, string>;
  counts: Record<ComponentKind, number>;
  total: number;
  reused: boolean;
};

export const evidenceUniverseSnapshotIdentitySha256 = (
  receipt: EvidenceUniverseSnapshotReceipt,
) => relationshipInputSha256({
  snapshotId: receipt.snapshotId,
  snapshotAt: receipt.snapshotAt,
  materializedAt: receipt.materializedAt,
  sourceMvccSnapshot: receipt.sourceMvccSnapshot,
  snapshotPolicy: receipt.snapshotPolicy,
  capturePolicies: receipt.capturePolicies,
  counts: receipt.counts,
  total: receipt.total,
});

export type EvidenceUniverseSourceCensusReceipt = {
  schemaVersion: 'evidence-universe-source-census-v2';
  inspectedAt: string;
  sourceMvccSnapshot: string;
  transaction: {
    isolation: 'repeatable read';
    readOnly: true;
  };
  prerequisites: {
    missingBase: string[];
    missingCapture: string[];
  };
  counts: Record<ComponentKind, number | null>;
  total: number | null;
  sightingAccounting: {
    total: number;
    eligible: number;
    excluded: number;
    exclusionReasons: {
      sourceUnapproved: number;
      registryBlocklist: number;
      duplicateNonPrimary: number;
      futureDated: number;
      invalidGeography: number;
      cursorMissing: number;
      afterCutoff: number;
      unclassified: number;
    };
  } | null;
  mediaAccounting: Record<'document' | 'photo' | 'video', {
    total: number;
    public: number;
    nonPublic: number;
  } | null>;
  mediaState: Record<'document' | 'photo' | 'video', {
    backfillComplete: boolean;
    mutationWatermarkComplete: boolean;
    mutationWatermarkCompletedAt: string | null;
  } | null>;
  invalidPublicMediaCursors: number | null;
  readyForSnapshotCapture: boolean;
  blockers: string[];
  guarantees: {
    databaseWrites: 0;
    r2Reads: 0;
    r2Writes: 0;
    lunaCalls: 0;
  };
  receiptSha256: string;
};

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const uuid = (value: unknown, label: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
};

const iso = (value: unknown, label: string) => {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
};

const preciseTimestamp = (value: unknown, label: string) => {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/.test(raw)
    || !Number.isFinite(new Date(raw).getTime())) {
    throw new Error(`${label}_invalid`);
  }
  return raw;
};

const safeCount = (value: unknown, label: string) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label}_invalid`);
  return count;
};

const snapshotHeaderSql = `
  SELECT
    snapshot.id::text AS snapshot_id,
    to_char(
      snapshot.source_snapshot_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) AS source_snapshot_at,
    to_char(
      snapshot.materialized_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS materialized_at,
    snapshot.source_mvcc_snapshot,
    snapshot.snapshot_policy
  FROM public.uap_evidence_universe_snapshots AS snapshot
  WHERE snapshot.id = $1::uuid
`;

const componentReceiptSql = `
  SELECT
    component.entity_kind,
    component.capture_policy,
    component.status,
    component.row_count,
    component.captured_at,
    COUNT(snapshot_row.entity_id)::bigint AS actual_count
  FROM public.uap_evidence_universe_snapshot_components AS component
  LEFT JOIN public.uap_evidence_universe_snapshot_rows AS snapshot_row
    ON snapshot_row.snapshot_id = component.snapshot_id
    AND snapshot_row.entity_kind = component.entity_kind
  WHERE component.snapshot_id = $1::uuid
  GROUP BY
    component.entity_kind,
    component.capture_policy,
    component.status,
    component.row_count,
    component.captured_at
  ORDER BY component.entity_kind
`;

const expectedCapturePolicy = (kind: ComponentKind) => (
  kind === 'sighting' ? EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY : EVIDENCE_UNIVERSE_MEDIA_CAPTURE_POLICY
);

const receiptFromRows = (
  snapshotId: string,
  snapshotAt: unknown,
  materializedAt: unknown,
  sourceMvccSnapshot: unknown,
  snapshotPolicy: unknown,
  rows: Record<string, unknown>[],
  reused: boolean,
): EvidenceUniverseSnapshotReceipt => {
  if (snapshotPolicy !== EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY) {
    throw new Error('evidence_universe_snapshot_policy_invalid');
  }
  const mvccSnapshot = String(sourceMvccSnapshot || '').trim();
  if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(mvccSnapshot)) {
    throw new Error('evidence_universe_snapshot_mvcc_receipt_invalid');
  }
  const counts = { sighting: 0, document: 0, photo: 0, video: 0 };
  const capturePolicies = { sighting: '', document: '', photo: '', video: '' };
  const seen = new Set<ComponentKind>();
  for (const row of rows) {
    const kind = String(row.entity_kind || '').trim().toLowerCase() as ComponentKind;
    if (!COMPONENT_KINDS.includes(kind) || seen.has(kind)) {
      throw new Error('evidence_universe_snapshot_component_set_invalid');
    }
    seen.add(kind);
    const count = safeCount(row.row_count, 'evidence_universe_snapshot_component_count');
    const actualCount = safeCount(row.actual_count, 'evidence_universe_snapshot_component_actual_count');
    const capturePolicy = String(row.capture_policy || '');
    if (
      row.status !== 'complete'
      || row.captured_at == null
      || capturePolicy !== expectedCapturePolicy(kind)
      || count !== actualCount
    ) {
      throw new Error('evidence_universe_snapshot_component_incomplete');
    }
    counts[kind] = count;
    capturePolicies[kind] = capturePolicy;
  }
  if (seen.size !== COMPONENT_KINDS.length) {
    throw new Error('evidence_universe_snapshot_component_set_incomplete');
  }
  return {
    snapshotId,
    snapshotAt: iso(snapshotAt, 'evidence_universe_snapshot_timestamp'),
    materializedAt: preciseTimestamp(materializedAt, 'evidence_universe_snapshot_materialized_timestamp'),
    sourceMvccSnapshot: mvccSnapshot,
    snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capturePolicies,
    counts,
    total: COMPONENT_KINDS.reduce((sum, kind) => sum + counts[kind], 0),
    reused,
  };
};

const sightingEligibilityFromSql = (cutoffExpression: string) => `
    FROM public.uap_sightings AS sighting
    JOIN approved_source_keys AS approved
      ON approved.source_key = UPPER(COALESCE(NULLIF(TRIM(sighting.source), ''), ''))
    WHERE
      ${buildRegistryBlocklistFilter('sighting')}
      AND (
        sighting.event_timestamp IS NULL
        OR sighting.event_timestamp <= ${cutoffExpression} + interval '${PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS} days'
      )
      AND (
        (sighting.lat IS NULL AND sighting.lon IS NULL)
        OR (
          sighting.lat IS NOT NULL
          AND sighting.lon IS NOT NULL
          AND sighting.lat BETWEEN -90 AND 90
          AND sighting.lon BETWEEN -180 AND 180
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.uap_sighting_duplicate_members AS duplicate_member
        JOIN public.uap_sighting_duplicate_clusters AS duplicate_cluster
          ON duplicate_cluster.id = duplicate_member.cluster_id
        WHERE duplicate_member.sighting_id = sighting.id::uuid
          AND duplicate_cluster.status = 'confirmed'
          AND duplicate_cluster.primary_sighting_id IS DISTINCT FROM sighting.id::uuid
      )
      AND COALESCE(sighting.updated_at, sighting.event_timestamp, sighting.created_at, sighting.ingested_at)
        <= ${cutoffExpression}`;

const approvedSourceKeysSql = `
  approved_canonical_sources AS MATERIALIZED (
    SELECT DISTINCT UPPER(TRIM(legal.canonical_source)) AS canonical_source
    FROM public.uap_source_legal_registry AS legal
    WHERE LOWER(COALESCE(legal.legal_status, '')) = 'approved'
      AND (
        legal.allowed_content_modes IS NULL
        OR cardinality(legal.allowed_content_modes) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(legal.allowed_content_modes) AS mode
          WHERE LOWER(mode) IN (${GOVERNED_PUBLIC_CONTENT_MODES.map((mode) => `'${mode}'`).join(', ')})
        )
      )
  ),
  approved_source_keys AS MATERIALIZED (
    SELECT canonical_source AS source_key FROM approved_canonical_sources
    UNION
    SELECT UPPER(TRIM(alias.alias)) AS source_key
    FROM public.uap_source_alias_map AS alias
    JOIN approved_canonical_sources AS approved
      ON approved.canonical_source = UPPER(TRIM(alias.canonical_source))
    WHERE COALESCE(alias.active, true) = true
  )`;

const sightingEligibilitySql = (cutoffExpression: string) => `
  ${approvedSourceKeysSql},
  frozen_rows AS MATERIALIZED (
    SELECT
      sighting.id::text AS entity_id,
      (
        date_trunc(
          'milliseconds',
          COALESCE(sighting.updated_at, sighting.event_timestamp, sighting.created_at, sighting.ingested_at)
            AT TIME ZONE 'UTC'
        ) AT TIME ZONE 'UTC'
      ) AS cursor_at,
      jsonb_build_object(
        'case_id', sighting.id::text,
        'source', sighting.source,
        'source_record_id', sighting.source_record_id,
        'external_id', sighting.external_id,
        'source_url', sighting.source_url,
        'ingestion_job_id', sighting.ingestion_job_id,
        'event_timestamp', sighting.event_timestamp,
        'event_date_precision', sighting.event_date_precision,
        'lat', sighting.lat::double precision,
        'lon', sighting.lon::double precision,
        'geo_precision', sighting.geo_precision,
        'location', COALESCE(sighting.location_normalized, sighting.location_raw, sighting.location),
        'city', sighting.city,
        'region', sighting.region,
        'country', sighting.country,
        'country_code', sighting.country_code,
        'description', sighting.description,
        'description_clean', sighting.description_clean,
        'summary', sighting.summary,
        'ai_summary', sighting.ai_summary,
        'shape', sighting.shape,
        'shape_normalized', sighting.shape_normalized,
        'duration_seconds', sighting.duration_seconds,
        'ai_keywords', sighting.ai_keywords,
        'ai_entities', sighting.ai_entities,
        'updated_at', to_char(
          date_trunc(
            'milliseconds',
            COALESCE(sighting.updated_at, sighting.event_timestamp, sighting.created_at, sighting.ingested_at)
              AT TIME ZONE 'UTC'
          ),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ) AS payload
    ${sightingEligibilityFromSql(cutoffExpression)}
  )`;

const sourceCensusSightingSql = `
  WITH
  ${approvedSourceKeysSql},
  eligible_sightings AS MATERIALIZED (
    SELECT sighting.id::uuid AS entity_id
    ${sightingEligibilityFromSql('$1::timestamptz')}
  ),
  classified_sightings AS MATERIALIZED (
    SELECT CASE
      WHEN eligible.entity_id IS NOT NULL THEN 'eligible'
      WHEN NOT EXISTS (
        SELECT 1
        FROM approved_source_keys AS approved
        WHERE approved.source_key = UPPER(COALESCE(NULLIF(TRIM(sighting.source), ''), ''))
      ) THEN 'source_unapproved'
      WHEN NOT (${buildRegistryBlocklistFilter('sighting')}) THEN 'registry_blocklist'
      WHEN EXISTS (
        SELECT 1
        FROM public.uap_sighting_duplicate_members AS duplicate_member
        JOIN public.uap_sighting_duplicate_clusters AS duplicate_cluster
          ON duplicate_cluster.id = duplicate_member.cluster_id
        WHERE duplicate_member.sighting_id = sighting.id::uuid
          AND duplicate_cluster.status = 'confirmed'
          AND duplicate_cluster.primary_sighting_id IS DISTINCT FROM sighting.id::uuid
      ) THEN 'duplicate_non_primary'
      WHEN sighting.event_timestamp IS NOT NULL
        AND sighting.event_timestamp > $1::timestamptz + interval '${PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS} days'
        THEN 'future_dated'
      WHEN NOT (
        (sighting.lat IS NULL AND sighting.lon IS NULL)
        OR (
          sighting.lat IS NOT NULL
          AND sighting.lon IS NOT NULL
          AND sighting.lat BETWEEN -90 AND 90
          AND sighting.lon BETWEEN -180 AND 180
        )
      ) THEN 'invalid_geography'
      WHEN COALESCE(sighting.updated_at, sighting.event_timestamp, sighting.created_at, sighting.ingested_at)
        IS NULL THEN 'cursor_missing'
      WHEN COALESCE(sighting.updated_at, sighting.event_timestamp, sighting.created_at, sighting.ingested_at)
        > $1::timestamptz THEN 'after_cutoff'
      ELSE 'unclassified'
    END AS classification
    FROM public.uap_sightings AS sighting
    LEFT JOIN eligible_sightings AS eligible
      ON eligible.entity_id = sighting.id::uuid
  )
  SELECT
    COUNT(*)::bigint AS total_count,
    COUNT(*) FILTER (WHERE classification = 'eligible')::bigint AS eligible_count,
    COUNT(*) FILTER (WHERE classification = 'source_unapproved')::bigint AS source_unapproved_count,
    COUNT(*) FILTER (WHERE classification = 'registry_blocklist')::bigint AS registry_blocklist_count,
    COUNT(*) FILTER (WHERE classification = 'duplicate_non_primary')::bigint AS duplicate_non_primary_count,
    COUNT(*) FILTER (WHERE classification = 'future_dated')::bigint AS future_dated_count,
    COUNT(*) FILTER (WHERE classification = 'invalid_geography')::bigint AS invalid_geography_count,
    COUNT(*) FILTER (WHERE classification = 'cursor_missing')::bigint AS cursor_missing_count,
    COUNT(*) FILTER (WHERE classification = 'after_cutoff')::bigint AS after_cutoff_count,
    COUNT(*) FILTER (WHERE classification = 'unclassified')::bigint AS unclassified_count
  FROM classified_sightings
`;

const sourceCensusMediaSql = `
  SELECT
    catalogue.entity_kind,
    COUNT(*)::bigint AS total_count,
    COUNT(*) FILTER (WHERE catalogue.is_public = true)::bigint AS public_count,
    COUNT(*) FILTER (
      WHERE catalogue.is_public = true
        AND (catalogue.last_indexed_at IS NULL OR NOT isfinite(catalogue.last_indexed_at))
    )::bigint AS invalid_public_cursor_count
  FROM public.uap_search_catalog_media AS catalogue
  WHERE catalogue.entity_kind IN ('document', 'photo', 'video')
  GROUP BY catalogue.entity_kind
  ORDER BY catalogue.entity_kind
`;

const sourceCensusMediaStateSql = `
  SELECT
    state.entity_kind,
    state.backfill_complete,
    state.mutation_watermark_complete,
    to_char(
      state.mutation_watermark_completed_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS mutation_watermark_completed_at
  FROM public.uap_search_catalog_media_state AS state
  WHERE state.entity_kind IN ('document', 'photo', 'video')
  ORDER BY state.entity_kind
`;

const CENSUS_BASE_RELATIONS = [
  'uap_sightings',
  'uap_source_legal_registry',
  'uap_source_alias_map',
  'uap_sighting_duplicate_members',
  'uap_sighting_duplicate_clusters',
  'uap_search_catalog_media',
] as const;
const CENSUS_CAPTURE_RELATIONS = [
  'uap_search_catalog_media_state',
  'uap_documents',
  'uap_photos',
  'uap_videos',
  'uap_evidence_universe_snapshots',
  'uap_evidence_universe_snapshot_components',
  'uap_evidence_universe_snapshot_rows',
] as const;
const CENSUS_BASE_COLUMNS = [
  'uap_sightings.id',
  'uap_sightings.source',
  'uap_sightings.country_code',
  'uap_sightings.country',
  'uap_sightings.location',
  'uap_sightings.event_timestamp',
  'uap_sightings.lat',
  'uap_sightings.lon',
  'uap_sightings.updated_at',
  'uap_sightings.created_at',
  'uap_sightings.ingested_at',
  'uap_source_legal_registry.canonical_source',
  'uap_source_legal_registry.legal_status',
  'uap_source_legal_registry.allowed_content_modes',
  'uap_source_alias_map.alias',
  'uap_source_alias_map.canonical_source',
  'uap_source_alias_map.active',
  'uap_sighting_duplicate_members.sighting_id',
  'uap_sighting_duplicate_members.cluster_id',
  'uap_sighting_duplicate_clusters.id',
  'uap_sighting_duplicate_clusters.status',
  'uap_sighting_duplicate_clusters.primary_sighting_id',
  'uap_search_catalog_media.entity_kind',
  'uap_search_catalog_media.is_public',
  'uap_search_catalog_media.last_indexed_at',
] as const;
const CENSUS_CAPTURE_COLUMNS = [
  'uap_sightings.source_record_id',
  'uap_sightings.external_id',
  'uap_sightings.source_url',
  'uap_sightings.ingestion_job_id',
  'uap_sightings.event_date_precision',
  'uap_sightings.geo_precision',
  'uap_sightings.location_normalized',
  'uap_sightings.city',
  'uap_sightings.region',
  'uap_sightings.description',
  'uap_sightings.description_clean',
  'uap_sightings.summary',
  'uap_sightings.ai_summary',
  'uap_sightings.shape',
  'uap_sightings.shape_normalized',
  'uap_sightings.duration_seconds',
  'uap_sightings.ai_keywords',
  'uap_sightings.ai_entities',
  'uap_search_catalog_media.entity_id',
  'uap_search_catalog_media.source',
  'uap_search_catalog_media.source_id',
  'uap_search_catalog_media.provider',
  'uap_search_catalog_media.source_record_id',
  'uap_search_catalog_media.title',
  'uap_search_catalog_media.description',
  'uap_search_catalog_media.canonical_url',
  'uap_search_catalog_media.preview_url',
  'uap_search_catalog_media.event_timestamp',
  'uap_search_catalog_media.location_normalized',
  'uap_search_catalog_media.country_code',
  'uap_search_catalog_media_state.entity_kind',
  'uap_search_catalog_media_state.backfill_complete',
  'uap_search_catalog_media_state.mutation_watermark_complete',
  'uap_search_catalog_media_state.mutation_watermark_completed_at',
  'uap_documents.id',
  'uap_documents.sighting_id',
  'uap_documents.lat',
  'uap_documents.lon',
  'uap_photos.id',
  'uap_photos.sighting_id',
  'uap_photos.lat',
  'uap_photos.lon',
  'uap_videos.id',
  'uap_videos.sighting_id',
  'uap_videos.lat',
  'uap_videos.lon',
] as const;

const sourceCensusPrerequisiteSql = `
  WITH required_relations(scope, relation_name) AS (
    SELECT 'base', unnest($1::text[])
    UNION ALL
    SELECT 'capture', unnest($2::text[])
  ),
  required_columns(scope, qualified_name) AS (
    SELECT 'base', unnest($3::text[])
    UNION ALL
    SELECT 'capture', unnest($4::text[])
  )
  SELECT
    'relation' AS requirement_kind,
    relation.scope,
    relation.relation_name AS requirement_name,
    to_regclass('public.' || quote_ident(relation.relation_name)) IS NOT NULL AS present
  FROM required_relations AS relation
  UNION ALL
  SELECT
    'column',
    required.scope,
    required.qualified_name,
    EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = split_part(required.qualified_name, '.', 1)
        AND column_row.column_name = split_part(required.qualified_name, '.', 2)
    )
  FROM required_columns AS required
  UNION ALL
  SELECT
    'function',
    'capture',
    'capture_uap_evidence_universe_media_snapshot(uuid)',
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = 'capture_uap_evidence_universe_media_snapshot'
        AND procedure.pronargs = 1
        AND procedure.prosecdef = true
        AND 'search_path=pg_catalog, public' = ANY(COALESCE(procedure.proconfig, ARRAY[]::text[]))
    )
  UNION ALL
  SELECT
    'trigger',
    'capture',
    'trg_uap_search_catalog_media_mutation_watermark',
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
      JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = trigger_function.pronamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'uap_search_catalog_media'
        AND trigger_row.tgname = 'trg_uap_search_catalog_media_mutation_watermark'
        AND trigger_row.tgisinternal = false
        AND trigger_row.tgenabled IN ('O', 'A')
        AND trigger_row.tgtype = 23
        AND function_namespace.nspname = 'public'
        AND trigger_function.proname = 'uap_search_catalog_media_stamp_mutation_watermark'
        AND trigger_function.pronargs = 0
    )
  ORDER BY scope, requirement_kind, requirement_name
`;

const sightingCaptureSql = `
  WITH
  ${sightingEligibilitySql('$2::timestamptz')},
  written_rows AS MATERIALIZED (
    INSERT INTO public.uap_evidence_universe_snapshot_rows (
      snapshot_id,
      entity_kind,
      entity_id,
      cursor_at,
      payload
    )
    SELECT $1::uuid, 'sighting', frozen.entity_id, frozen.cursor_at, frozen.payload
    FROM frozen_rows AS frozen
    RETURNING entity_id, cursor_at, payload
  ),
  source_rollup AS MATERIALIZED (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(inserted.payload->>'source'), ''), 'unknown')) AS source_key,
      COUNT(*)::bigint AS source_count
    FROM written_rows AS inserted
    GROUP BY source_key
  ),
  receipt AS MATERIALIZED (
    SELECT
      COUNT(*)::bigint AS row_count,
      COALESCE(
        (SELECT jsonb_object_agg(source_key, source_count ORDER BY source_key) FROM source_rollup),
        '{}'::jsonb
      ) AS source_counts
    FROM written_rows
  ),
  inserted_component AS (
    INSERT INTO public.uap_evidence_universe_snapshot_components (
      snapshot_id,
      entity_kind,
      capture_policy,
      status,
      row_count,
      source_counts,
      captured_at
    )
    SELECT
      $1::uuid,
      'sighting',
      $3::text,
      'complete',
      receipt.row_count,
      receipt.source_counts,
      statement_timestamp()
    FROM receipt
    RETURNING row_count
  )
  SELECT row_count FROM inserted_component
`;

const beginSql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE';
const censusBeginSql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

const strictBoolean = (value: unknown, label: string) => {
  if (value === true || value === 'true' || value === 't') return true;
  if (value === false || value === 'false' || value === 'f') return false;
  throw new Error(`${label}_invalid`);
};

const exactObjectKeys = (value: Record<string, unknown>, expected: string[], code: string) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(code);
  }
};

const sortedUniqueStrings = (value: unknown, code: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item || item.length > 300)) {
    throw new Error(code);
  }
  const items = value as string[];
  if (items.some((item, index) => index > 0 && items[index - 1] >= item)) throw new Error(code);
  return [...items];
};

export const verifyEvidenceUniverseSourceCensusReceipt = (
  value: unknown,
): EvidenceUniverseSourceCensusReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('evidence_universe_source_census_receipt_invalid');
  }
  const candidate = value as Record<string, unknown>;
  exactObjectKeys(candidate, [
    'schemaVersion', 'inspectedAt', 'sourceMvccSnapshot', 'transaction', 'prerequisites',
    'counts', 'total', 'sightingAccounting', 'mediaAccounting', 'mediaState',
    'invalidPublicMediaCursors', 'readyForSnapshotCapture', 'blockers', 'guarantees',
    'receiptSha256',
  ], 'evidence_universe_source_census_receipt_invalid');
  if (candidate.schemaVersion !== 'evidence-universe-source-census-v2'
    || typeof candidate.receiptSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(candidate.receiptSha256)) {
    throw new Error('evidence_universe_source_census_receipt_invalid');
  }
  const inspectedAt = preciseTimestamp(candidate.inspectedAt, 'evidence_universe_source_census_timestamp');
  const sourceMvccSnapshot = String(candidate.sourceMvccSnapshot || '').trim();
  if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/u.test(sourceMvccSnapshot)) {
    throw new Error('evidence_universe_source_census_mvcc_invalid');
  }
  if (!candidate.transaction || typeof candidate.transaction !== 'object' || Array.isArray(candidate.transaction)) {
    throw new Error('evidence_universe_source_census_transaction_invalid');
  }
  const transaction = candidate.transaction as Record<string, unknown>;
  exactObjectKeys(transaction, ['isolation', 'readOnly'], 'evidence_universe_source_census_transaction_invalid');
  if (transaction.isolation !== 'repeatable read' || transaction.readOnly !== true) {
    throw new Error('evidence_universe_source_census_transaction_invalid');
  }
  if (!candidate.prerequisites || typeof candidate.prerequisites !== 'object'
    || Array.isArray(candidate.prerequisites)) {
    throw new Error('evidence_universe_source_census_prerequisites_invalid');
  }
  const prerequisiteValue = candidate.prerequisites as Record<string, unknown>;
  exactObjectKeys(
    prerequisiteValue,
    ['missingBase', 'missingCapture'],
    'evidence_universe_source_census_prerequisites_invalid',
  );
  const prerequisites = {
    missingBase: sortedUniqueStrings(
      prerequisiteValue.missingBase,
      'evidence_universe_source_census_prerequisites_invalid',
    ),
    missingCapture: sortedUniqueStrings(
      prerequisiteValue.missingCapture,
      'evidence_universe_source_census_prerequisites_invalid',
    ),
  };
  if (!candidate.counts || typeof candidate.counts !== 'object' || Array.isArray(candidate.counts)) {
    throw new Error('evidence_universe_source_census_counts_invalid');
  }
  const countValue = candidate.counts as Record<string, unknown>;
  exactObjectKeys(countValue, [...COMPONENT_KINDS], 'evidence_universe_source_census_counts_invalid');
  const counts = Object.fromEntries(COMPONENT_KINDS.map((kind) => [
    kind,
    countValue[kind] === null
      ? null
      : safeCount(countValue[kind], `evidence_universe_source_census_${kind}_count`),
  ])) as Record<ComponentKind, number | null>;
  const computedTotal = Object.values(counts).every((count) => count !== null)
    ? Object.values(counts).reduce<number>((sum, count) => sum + (count || 0), 0)
    : null;
  if (candidate.total !== computedTotal) throw new Error('evidence_universe_source_census_total_invalid');
  let sightingAccounting: EvidenceUniverseSourceCensusReceipt['sightingAccounting'] = null;
  if (candidate.sightingAccounting !== null) {
    if (!candidate.sightingAccounting || typeof candidate.sightingAccounting !== 'object'
      || Array.isArray(candidate.sightingAccounting)) {
      throw new Error('evidence_universe_source_census_sighting_accounting_invalid');
    }
    const accounting = candidate.sightingAccounting as Record<string, unknown>;
    exactObjectKeys(
      accounting,
      ['total', 'eligible', 'excluded', 'exclusionReasons'],
      'evidence_universe_source_census_sighting_accounting_invalid',
    );
    if (!accounting.exclusionReasons || typeof accounting.exclusionReasons !== 'object'
      || Array.isArray(accounting.exclusionReasons)) {
      throw new Error('evidence_universe_source_census_sighting_accounting_invalid');
    }
    const reasonValue = accounting.exclusionReasons as Record<string, unknown>;
    const reasonKeys = [
      'sourceUnapproved', 'registryBlocklist', 'duplicateNonPrimary', 'futureDated',
      'invalidGeography', 'cursorMissing', 'afterCutoff', 'unclassified',
    ] as const;
    exactObjectKeys(
      reasonValue,
      [...reasonKeys],
      'evidence_universe_source_census_sighting_accounting_invalid',
    );
    const exclusionReasons = Object.fromEntries(reasonKeys.map((reason) => [
      reason,
      safeCount(reasonValue[reason], `evidence_universe_source_census_sighting_${reason}`),
    ])) as NonNullable<EvidenceUniverseSourceCensusReceipt['sightingAccounting']>['exclusionReasons'];
    const total = safeCount(accounting.total, 'evidence_universe_source_census_sighting_total');
    const eligible = safeCount(accounting.eligible, 'evidence_universe_source_census_sighting_eligible');
    const excluded = safeCount(accounting.excluded, 'evidence_universe_source_census_sighting_excluded');
    const exclusionTotal = Object.values(exclusionReasons).reduce((sum, count) => sum + count, 0);
    if (excluded !== exclusionTotal || total !== eligible + excluded || exclusionReasons.unclassified !== 0) {
      throw new Error('evidence_universe_source_census_sighting_reconciliation_invalid');
    }
    sightingAccounting = { total, eligible, excluded, exclusionReasons };
  }
  if ((counts.sighting === null) !== (sightingAccounting === null)
    || (sightingAccounting && counts.sighting !== sightingAccounting.eligible)) {
    throw new Error('evidence_universe_source_census_sighting_reconciliation_invalid');
  }
  if (!candidate.mediaAccounting || typeof candidate.mediaAccounting !== 'object'
    || Array.isArray(candidate.mediaAccounting)) {
    throw new Error('evidence_universe_source_census_media_accounting_invalid');
  }
  const mediaAccountingValue = candidate.mediaAccounting as Record<string, unknown>;
  exactObjectKeys(
    mediaAccountingValue,
    ['document', 'photo', 'video'],
    'evidence_universe_source_census_media_accounting_invalid',
  );
  const mediaAccounting = Object.fromEntries((['document', 'photo', 'video'] as const).map((kind) => {
    const value = mediaAccountingValue[kind];
    if (value === null) {
      if (counts[kind] !== null) throw new Error('evidence_universe_source_census_media_reconciliation_invalid');
      return [kind, null];
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('evidence_universe_source_census_media_accounting_invalid');
    }
    const item = value as Record<string, unknown>;
    exactObjectKeys(item, ['total', 'public', 'nonPublic'], 'evidence_universe_source_census_media_accounting_invalid');
    const total = safeCount(item.total, `evidence_universe_source_census_${kind}_total`);
    const publicCount = safeCount(item.public, `evidence_universe_source_census_${kind}_public`);
    const nonPublic = safeCount(item.nonPublic, `evidence_universe_source_census_${kind}_non_public`);
    if (total !== publicCount + nonPublic || counts[kind] !== publicCount) {
      throw new Error('evidence_universe_source_census_media_reconciliation_invalid');
    }
    return [kind, { total, public: publicCount, nonPublic }];
  })) as EvidenceUniverseSourceCensusReceipt['mediaAccounting'];
  if (!candidate.mediaState || typeof candidate.mediaState !== 'object' || Array.isArray(candidate.mediaState)) {
    throw new Error('evidence_universe_source_census_media_state_invalid');
  }
  const mediaStateValue = candidate.mediaState as Record<string, unknown>;
  exactObjectKeys(mediaStateValue, ['document', 'photo', 'video'], 'evidence_universe_source_census_media_state_invalid');
  const mediaState = Object.fromEntries((['document', 'photo', 'video'] as const).map((kind) => {
    const state = mediaStateValue[kind];
    if (state === null) return [kind, null];
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('evidence_universe_source_census_media_state_invalid');
    }
    const item = state as Record<string, unknown>;
    exactObjectKeys(
      item,
      ['backfillComplete', 'mutationWatermarkComplete', 'mutationWatermarkCompletedAt'],
      'evidence_universe_source_census_media_state_invalid',
    );
    const completedAt = item.mutationWatermarkCompletedAt === null
      ? null
      : preciseTimestamp(
        item.mutationWatermarkCompletedAt,
        'evidence_universe_source_census_media_watermark_timestamp',
      );
    return [kind, {
      backfillComplete: strictBoolean(item.backfillComplete, 'evidence_universe_source_census_media_backfill_state'),
      mutationWatermarkComplete: strictBoolean(
        item.mutationWatermarkComplete,
        'evidence_universe_source_census_media_watermark_state',
      ),
      mutationWatermarkCompletedAt: completedAt,
    }];
  })) as EvidenceUniverseSourceCensusReceipt['mediaState'];
  const invalidPublicMediaCursors = candidate.invalidPublicMediaCursors === null
    ? null
    : safeCount(
      candidate.invalidPublicMediaCursors,
      'evidence_universe_source_census_invalid_media_cursor_count',
    );
  const blockers = sortedUniqueStrings(candidate.blockers, 'evidence_universe_source_census_blockers_invalid');
  if (candidate.readyForSnapshotCapture !== (blockers.length === 0)) {
    throw new Error('evidence_universe_source_census_readiness_invalid');
  }
  if (!candidate.guarantees || typeof candidate.guarantees !== 'object' || Array.isArray(candidate.guarantees)) {
    throw new Error('evidence_universe_source_census_guarantees_invalid');
  }
  const guarantees = candidate.guarantees as Record<string, unknown>;
  exactObjectKeys(guarantees, ['databaseWrites', 'r2Reads', 'r2Writes', 'lunaCalls'], 'evidence_universe_source_census_guarantees_invalid');
  if (Object.values(guarantees).some((item) => item !== 0)) {
    throw new Error('evidence_universe_source_census_guarantees_invalid');
  }
  const withoutDigest: Omit<EvidenceUniverseSourceCensusReceipt, 'receiptSha256'> = {
    schemaVersion: 'evidence-universe-source-census-v2',
    inspectedAt,
    sourceMvccSnapshot,
    transaction: { isolation: 'repeatable read', readOnly: true },
    prerequisites,
    counts,
    total: computedTotal,
    sightingAccounting,
    mediaAccounting,
    mediaState,
    invalidPublicMediaCursors,
    readyForSnapshotCapture: blockers.length === 0,
    blockers,
    guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0 },
  };
  if (relationshipInputSha256(withoutDigest) !== candidate.receiptSha256) {
    throw new Error('evidence_universe_source_census_receipt_digest_invalid');
  }
  return { ...withoutDigest, receiptSha256: candidate.receiptSha256 };
};

export const inspectPostgresEvidenceUniverseSourceReadiness = async (
  client: EvidenceUniverseSnapshotTransactionClient,
  options: { statementTimeoutMs?: number } = {},
): Promise<EvidenceUniverseSourceCensusReceipt> => {
  const timeoutMs = Math.trunc(options.statementTimeoutMs ?? 10 * 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60_000) {
    throw new Error('evidence_universe_source_census_timeout_invalid');
  }

  let transactionOpen = false;
  try {
    await client.query(censusBeginSql);
    transactionOpen = true;
    await client.query("SELECT set_config('statement_timeout', $1::text, true)", [`${timeoutMs}ms`]);
    const identityResult = await client.query(`
      SELECT
        to_char(
          clock_timestamp() AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS inspected_at,
        pg_current_snapshot()::text AS source_mvcc_snapshot
    `);
    if (identityResult.rows.length !== 1) throw new Error('evidence_universe_source_census_identity_invalid');
    const inspectedAt = preciseTimestamp(
      identityResult.rows[0].inspected_at,
      'evidence_universe_source_census_timestamp',
    );
    const sourceMvccSnapshot = String(identityResult.rows[0].source_mvcc_snapshot || '').trim();
    if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(sourceMvccSnapshot)) {
      throw new Error('evidence_universe_source_census_mvcc_invalid');
    }

    const prerequisiteResult = await client.query(sourceCensusPrerequisiteSql, [
      [...CENSUS_BASE_RELATIONS],
      [...CENSUS_CAPTURE_RELATIONS],
      [...CENSUS_BASE_COLUMNS],
      [...CENSUS_CAPTURE_COLUMNS],
    ]);
    const missingBase: string[] = [];
    const missingCapture: string[] = [];
    const seenRequirements = new Set<string>();
    for (const row of prerequisiteResult.rows) {
      const kind = String(row.requirement_kind || '').trim();
      const scope = String(row.scope || '').trim();
      const name = String(row.requirement_name || '').trim();
      if (!['relation', 'column', 'function', 'trigger'].includes(kind)
        || !['base', 'capture'].includes(scope)
        || !name) {
        throw new Error('evidence_universe_source_census_prerequisite_invalid');
      }
      const key = `${scope}:${kind}:${name}`;
      if (seenRequirements.has(key)) throw new Error('evidence_universe_source_census_prerequisite_duplicate');
      seenRequirements.add(key);
      if (!strictBoolean(row.present, 'evidence_universe_source_census_prerequisite_presence')) {
        (scope === 'base' ? missingBase : missingCapture).push(`${kind}:${name}`);
      }
    }
    const expectedRequirementCount = CENSUS_BASE_RELATIONS.length
      + CENSUS_CAPTURE_RELATIONS.length
      + CENSUS_BASE_COLUMNS.length
      + CENSUS_CAPTURE_COLUMNS.length
      + 2;
    if (seenRequirements.size !== expectedRequirementCount) {
      throw new Error('evidence_universe_source_census_prerequisite_set_incomplete');
    }

    const counts: Record<ComponentKind, number | null> = {
      sighting: null,
      document: null,
      photo: null,
      video: null,
    };
    let sightingAccounting: EvidenceUniverseSourceCensusReceipt['sightingAccounting'] = null;
    const mediaAccounting: EvidenceUniverseSourceCensusReceipt['mediaAccounting'] = {
      document: null,
      photo: null,
      video: null,
    };
    const mediaState: EvidenceUniverseSourceCensusReceipt['mediaState'] = {
      document: null,
      photo: null,
      video: null,
    };
    let invalidPublicMediaCursors: number | null = null;

    const sightingPrerequisitesMissing = missingBase.some((requirement) => (
      !requirement.includes('uap_search_catalog_media')
    ));
    if (!sightingPrerequisitesMissing) {
      const sightingResult = await client.query(sourceCensusSightingSql, [inspectedAt]);
      if (sightingResult.rows.length !== 1) throw new Error('evidence_universe_source_census_sighting_count_invalid');
      const row = sightingResult.rows[0];
      const exclusionReasons = {
        sourceUnapproved: safeCount(row.source_unapproved_count, 'evidence_universe_source_census_sighting_source_unapproved'),
        registryBlocklist: safeCount(row.registry_blocklist_count, 'evidence_universe_source_census_sighting_registry_blocklist'),
        duplicateNonPrimary: safeCount(row.duplicate_non_primary_count, 'evidence_universe_source_census_sighting_duplicate_non_primary'),
        futureDated: safeCount(row.future_dated_count, 'evidence_universe_source_census_sighting_future_dated'),
        invalidGeography: safeCount(row.invalid_geography_count, 'evidence_universe_source_census_sighting_invalid_geography'),
        cursorMissing: safeCount(row.cursor_missing_count, 'evidence_universe_source_census_sighting_cursor_missing'),
        afterCutoff: safeCount(row.after_cutoff_count, 'evidence_universe_source_census_sighting_after_cutoff'),
        unclassified: safeCount(row.unclassified_count, 'evidence_universe_source_census_sighting_unclassified'),
      };
      const eligible = safeCount(row.eligible_count, 'evidence_universe_source_census_sighting_count');
      const total = safeCount(row.total_count, 'evidence_universe_source_census_sighting_total');
      const excluded = Object.values(exclusionReasons).reduce((sum, count) => sum + count, 0);
      if (exclusionReasons.unclassified !== 0) {
        throw new Error('evidence_universe_source_census_sighting_unclassified');
      }
      if (total !== eligible + excluded) {
        throw new Error('evidence_universe_source_census_sighting_reconciliation_invalid');
      }
      counts.sighting = eligible;
      sightingAccounting = { total, eligible, excluded, exclusionReasons };
    }

    const mediaPrerequisitesMissing = missingBase.some((requirement) => (
      requirement.includes('uap_search_catalog_media')
    ));
    if (!mediaPrerequisitesMissing) {
      const mediaResult = await client.query(sourceCensusMediaSql);
      let invalidCursorTotal = 0;
      const seenKinds = new Set<ComponentKind>();
      for (const row of mediaResult.rows) {
        const kind = String(row.entity_kind || '').trim().toLowerCase() as ComponentKind;
        if (!['document', 'photo', 'video'].includes(kind) || seenKinds.has(kind)) {
          throw new Error('evidence_universe_source_census_media_kind_invalid');
        }
        seenKinds.add(kind);
        const totalCount = safeCount(row.total_count, 'evidence_universe_source_census_media_total');
        const publicCount = safeCount(row.public_count, 'evidence_universe_source_census_media_count');
        if (publicCount > totalCount) {
          throw new Error('evidence_universe_source_census_media_reconciliation_invalid');
        }
        counts[kind] = publicCount;
        mediaAccounting[kind as 'document' | 'photo' | 'video'] = {
          total: totalCount,
          public: publicCount,
          nonPublic: totalCount - publicCount,
        };
        invalidCursorTotal += safeCount(
          row.invalid_public_cursor_count,
          'evidence_universe_source_census_invalid_media_cursor_count',
        );
      }
      for (const kind of ['document', 'photo', 'video'] as const) {
        if (!seenKinds.has(kind)) {
          counts[kind] = 0;
          mediaAccounting[kind] = { total: 0, public: 0, nonPublic: 0 };
        }
      }
      invalidPublicMediaCursors = invalidCursorTotal;
    }

    const statePrerequisitesMissing = missingCapture.some((requirement) => (
      requirement.includes('uap_search_catalog_media_state')
    ));
    if (!statePrerequisitesMissing) {
      const stateResult = await client.query(sourceCensusMediaStateSql);
      const seenKinds = new Set<string>();
      for (const row of stateResult.rows) {
        const kind = String(row.entity_kind || '').trim().toLowerCase();
        if (!['document', 'photo', 'video'].includes(kind) || seenKinds.has(kind)) {
          throw new Error('evidence_universe_source_census_media_state_invalid');
        }
        seenKinds.add(kind);
        const completedAt = row.mutation_watermark_completed_at == null
          ? null
          : preciseTimestamp(
            row.mutation_watermark_completed_at,
            'evidence_universe_source_census_media_watermark_timestamp',
          );
        mediaState[kind as 'document' | 'photo' | 'video'] = {
          backfillComplete: strictBoolean(
            row.backfill_complete,
            'evidence_universe_source_census_media_backfill_state',
          ),
          mutationWatermarkComplete: strictBoolean(
            row.mutation_watermark_complete,
            'evidence_universe_source_census_media_watermark_state',
          ),
          mutationWatermarkCompletedAt: completedAt,
        };
      }
    }

    const blockers = [
      ...missingBase.map((requirement) => `base_prerequisite_missing:${requirement}`),
      ...missingCapture.map((requirement) => `capture_prerequisite_missing:${requirement}`),
    ];
    if (invalidPublicMediaCursors !== null && invalidPublicMediaCursors > 0) {
      blockers.push(`invalid_public_media_cursors:${invalidPublicMediaCursors}`);
    }
    for (const kind of ['document', 'photo', 'video'] as const) {
      const state = mediaState[kind];
      if (!state) {
        blockers.push(`media_state_missing:${kind}`);
      } else {
        if (!state.backfillComplete) blockers.push(`media_backfill_incomplete:${kind}`);
        if (!state.mutationWatermarkComplete || !state.mutationWatermarkCompletedAt) {
          blockers.push(`media_mutation_watermark_incomplete:${kind}`);
        } else if (new Date(state.mutationWatermarkCompletedAt).getTime() > new Date(inspectedAt).getTime()) {
          blockers.push(`media_mutation_watermark_after_census:${kind}`);
        }
      }
    }
    if (Object.values(counts).some((count) => count === null)) {
      blockers.push('source_counts_incomplete');
    }
    const total = Object.values(counts).every((count) => count !== null)
      ? Object.values(counts).reduce<number>((sum, count) => sum + (count || 0), 0)
      : null;

    const receiptBody: Omit<EvidenceUniverseSourceCensusReceipt, 'receiptSha256'> = {
      schemaVersion: 'evidence-universe-source-census-v2',
      inspectedAt,
      sourceMvccSnapshot,
      transaction: { isolation: 'repeatable read', readOnly: true },
      prerequisites: {
        missingBase: missingBase.sort(),
        missingCapture: missingCapture.sort(),
      },
      counts,
      total,
      sightingAccounting,
      mediaAccounting,
      mediaState,
      invalidPublicMediaCursors,
      readyForSnapshotCapture: blockers.length === 0,
      blockers: [...new Set(blockers)].sort(),
      guarantees: { databaseWrites: 0, r2Reads: 0, r2Writes: 0, lunaCalls: 0 },
    };
    const receipt: EvidenceUniverseSourceCensusReceipt = {
      ...receiptBody,
      receiptSha256: relationshipInputSha256(receiptBody),
    };
    await client.query('COMMIT');
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the census error; a broken connection releases the transaction.
      }
    }
    throw error;
  }
};

export const capturePostgresEvidenceUniverseSnapshot = async (
  client: EvidenceUniverseSnapshotTransactionClient,
  options: {
    snapshotId: string;
    statementTimeoutMs?: number;
    expectedCounts?: Record<ComponentKind, number>;
  },
): Promise<EvidenceUniverseSnapshotReceipt> => {
  const snapshotId = uuid(options.snapshotId, 'evidence_universe_snapshot_id');
  const timeoutMs = Math.trunc(options.statementTimeoutMs ?? 30 * 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60_000) {
    throw new Error('evidence_universe_snapshot_timeout_invalid');
  }
  if (options.expectedCounts) {
    exactObjectKeys(
      options.expectedCounts as unknown as Record<string, unknown>,
      [...COMPONENT_KINDS],
      'evidence_universe_snapshot_expected_counts_invalid',
    );
    for (const kind of COMPONENT_KINDS) {
      safeCount(options.expectedCounts[kind], `evidence_universe_snapshot_expected_${kind}_count`);
    }
  }
  const assertExpectedCounts = (counts: Record<ComponentKind, number>) => {
    if (options.expectedCounts && COMPONENT_KINDS.some((kind) => (
      counts[kind] !== options.expectedCounts?.[kind]
    ))) throw new Error('evidence_universe_snapshot_source_census_drift');
  };

  let sessionLockAcquired = false;
  let transactionOpen = false;
  try {
    // Serialize before REPEATABLE READ begins. If a waiting retry established
    // its MVCC snapshot first, it could not see the prior writer after the
    // advisory lock was released even though that writer had committed.
    await client.query("SET lock_timeout = '10s'");
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('uap-evidence-universe-snapshot-coordinator', 0))",
    );
    sessionLockAcquired = true;
    await client.query(beginSql);
    transactionOpen = true;
    await client.query("SELECT set_config('statement_timeout', $1::text, true)", [`${timeoutMs}ms`]);

    const existingHeader = await client.query(snapshotHeaderSql, [snapshotId]);
    if (existingHeader.rows.length > 1) throw new Error('evidence_universe_snapshot_header_invalid');
    if (existingHeader.rows.length === 1) {
      const header = existingHeader.rows[0];
      const components = await client.query(componentReceiptSql, [snapshotId]);
      const receipt = receiptFromRows(
        snapshotId,
        header.source_snapshot_at,
        header.materialized_at,
        header.source_mvcc_snapshot,
        header.snapshot_policy,
        components.rows,
        true,
      );
      assertExpectedCounts(receipt.counts);
      await client.query('COMMIT');
      transactionOpen = false;
      return receipt;
    }

    const mediaResult = await client.query(`
      SELECT
        captured.snapshot_id::text AS snapshot_id,
        to_char(
          captured.source_snapshot_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS source_snapshot_at,
        to_char(
          captured.materialized_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS materialized_at,
        captured.source_mvcc_snapshot,
        captured.document_count,
        captured.photo_count,
        captured.video_count
      FROM public.capture_uap_evidence_universe_media_snapshot($1::uuid) AS captured
    `,
      [snapshotId],
    );
    if (
      mediaResult.rows.length !== 1
      || uuid(mediaResult.rows[0].snapshot_id, 'evidence_universe_media_snapshot_id') !== snapshotId
    ) {
      throw new Error('evidence_universe_media_snapshot_binding_invalid');
    }
    const mediaReceipt = mediaResult.rows[0];
    const snapshotAt = iso(mediaReceipt.source_snapshot_at, 'evidence_universe_snapshot_timestamp');
    const materializedAt = preciseTimestamp(
      mediaReceipt.materialized_at,
      'evidence_universe_snapshot_materialized_timestamp',
    );
    const sourceMvccSnapshot = String(mediaReceipt.source_mvcc_snapshot || '').trim();
    if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(sourceMvccSnapshot)) {
      throw new Error('evidence_universe_snapshot_mvcc_receipt_invalid');
    }

    await client.query(
      "SELECT set_config('uap.evidence_universe_capture_snapshot_id', $1::text, true)",
      [snapshotId],
    );
    const sightingResult = await client.query(sightingCaptureSql, [
      snapshotId,
      snapshotAt,
      EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    ]);
    if (sightingResult.rows.length !== 1) throw new Error('evidence_universe_sighting_snapshot_sealing_failed');
    safeCount(sightingResult.rows[0].row_count, 'evidence_universe_sighting_snapshot_count');

    const components = await client.query(componentReceiptSql, [snapshotId]);
    const receipt = receiptFromRows(
      snapshotId,
      snapshotAt,
      materializedAt,
      sourceMvccSnapshot,
      EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      components.rows,
      false,
    );
    assertExpectedCounts(receipt.counts);
    await client.query('COMMIT');
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the capture error; a broken connection releases the transaction.
      }
    }
    throw error;
  } finally {
    if (sessionLockAcquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended('uap-evidence-universe-snapshot-coordinator', 0))",
        );
      } catch {
        // A discarded connection releases its session advisory locks.
      }
    }
    try {
      await client.query('RESET lock_timeout');
    } catch {
      // Do not mask the capture result if the connection is already gone.
    }
  }
};

export const inspectPostgresEvidenceUniverseSnapshot = async (
  client: EvidenceUniverseSnapshotTransactionClient,
  options: {
    snapshotId: string;
    statementTimeoutMs?: number;
  },
): Promise<EvidenceUniverseSnapshotReceipt | null> => {
  const snapshotId = uuid(options.snapshotId, 'evidence_universe_snapshot_id');
  const timeoutMs = Math.trunc(options.statementTimeoutMs ?? 5 * 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60_000) {
    throw new Error('evidence_universe_snapshot_timeout_invalid');
  }
  let transactionOpen = false;
  try {
    await client.query(censusBeginSql);
    transactionOpen = true;
    await client.query("SELECT set_config('statement_timeout', $1::text, true)", [`${timeoutMs}ms`]);
    const headerResult = await client.query(snapshotHeaderSql, [snapshotId]);
    if (headerResult.rows.length > 1) throw new Error('evidence_universe_snapshot_header_invalid');
    if (headerResult.rows.length === 0) {
      await client.query('COMMIT');
      transactionOpen = false;
      return null;
    }
    const header = headerResult.rows[0];
    const components = await client.query(componentReceiptSql, [snapshotId]);
    const receipt = receiptFromRows(
      snapshotId,
      header.source_snapshot_at,
      header.materialized_at,
      header.source_mvcc_snapshot,
      header.snapshot_policy,
      components.rows,
      true,
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the inspection error; a broken connection releases the transaction.
      }
    }
    throw error;
  }
};

export const evidenceUniverseSightingCaptureSqlForTests = sightingCaptureSql;
export const evidenceUniverseSourceCensusSightingSqlForTests = sourceCensusSightingSql;
