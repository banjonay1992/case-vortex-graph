import { GOVERNED_PUBLIC_CONTENT_MODES } from './dataQualityVisibility';
import {
  buildUserMappableLocationPrivacyFilter,
  buildUserPublicationConsentFilter,
} from './userSightingPrivacySql';

export const PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS = 365;

const col = (prefix: string, name: string) => (prefix ? `${prefix}.${name}` : name);
const normalizedSourceExpr = (prefix = '') => `UPPER(COALESCE(NULLIF(TRIM(${col(prefix, 'source')}), ''), ''))`;

const buildAllowedContentModesPredicate = (fieldExpression: string) => `(
  ${fieldExpression} IS NULL
  OR cardinality(${fieldExpression}) = 0
  OR EXISTS (
    SELECT 1
    FROM unnest(${fieldExpression}) AS mode
    WHERE LOWER(mode) IN (${GOVERNED_PUBLIC_CONTENT_MODES.map((mode) => `'${mode}'`).join(', ')})
  )
)`;

/**
 * Resolve source governance without choosing an arbitrary case-variant alias.
 *
 * Both governance tables historically use case-sensitive primary keys while
 * public policy is case-insensitive. More than one normalized alias target is
 * therefore ambiguous and must fail closed. Likewise, every normalized legal
 * row for the chosen target participates in the decision: one blocked row
 * blocks, and public/full publication requires every row to be approved and to
 * allow a governed public content mode.
 */
const buildSourceGovernanceSummarySql = (prefix = '') => `(
  WITH input AS (
    SELECT ${normalizedSourceExpr(prefix)} AS source_key
  ),
  alias_candidates AS MATERIALIZED (
    SELECT DISTINCT UPPER(TRIM(alias.canonical_source)) AS canonical_source
    FROM public.uap_source_alias_map alias
    CROSS JOIN input
    WHERE COALESCE(alias.active, true) = true
      AND UPPER(TRIM(alias.alias)) = input.source_key
      AND NULLIF(TRIM(alias.canonical_source), '') IS NOT NULL
  ),
  canonical_candidates AS MATERIALIZED (
    SELECT canonical_source
    FROM alias_candidates
    UNION ALL
    SELECT input.source_key
    FROM input
    WHERE input.source_key <> ''
      AND NOT EXISTS (SELECT 1 FROM alias_candidates)
  ),
  legal_candidates AS MATERIALIZED (
    SELECT
      legal.legal_status,
      legal.allowed_content_modes
    FROM canonical_candidates candidate
    JOIN public.uap_source_legal_registry legal
      ON UPPER(TRIM(legal.canonical_source)) = candidate.canonical_source
  )
  SELECT
    (SELECT COUNT(*) FROM alias_candidates) <= 1 AS alias_unambiguous,
    COUNT(*) > 0 AS legal_present,
    COALESCE(BOOL_OR(LOWER(COALESCE(legal.legal_status, '')) = 'blocked'), false) AS any_blocked,
    COALESCE(BOOL_AND(LOWER(COALESCE(legal.legal_status, '')) = 'approved'), false) AS all_approved,
    COALESCE(BOOL_AND(${buildAllowedContentModesPredicate('legal.allowed_content_modes')}), false) AS all_public_modes
  FROM legal_candidates legal
)`;

export const buildGovernedPublicSourceFilter = (prefix = '') => {
  return `EXISTS (
    SELECT 1
    FROM ${buildSourceGovernanceSummarySql(prefix)} governance
    WHERE governance.alias_unambiguous
      AND governance.legal_present
      AND NOT governance.any_blocked
      AND governance.all_approved
      AND governance.all_public_modes
  )`;
};

// Compatibility name retained for callers that combine this predicate with a
// preloaded approved-source list. Blocking is source-governance driven: a
// country, location string, or source name is never a legal policy by itself.
export const buildRegistryBlocklistFilter = (prefix = '') => `NOT (
  EXISTS (
    SELECT 1
    FROM ${buildSourceGovernanceSummarySql(prefix)} governance
    WHERE governance.any_blocked
  )
)`;

export const buildPublishableSightingFilter = (prefix = '') => `(
  ${buildGovernedPublicSourceFilter(prefix)}
  AND
  ${buildUserPublicationConsentFilter(prefix)}
  AND (
    NOT EXISTS (
      SELECT 1
      FROM uap_sighting_duplicate_members dm
      JOIN (
        SELECT
          id AS cluster_id,
          status,
          primary_sighting_id
        FROM uap_sighting_duplicate_clusters
      ) dc
        ON dc.cluster_id = dm.cluster_id
      WHERE dm.sighting_id = ${col(prefix, 'id')}::uuid
        AND dc.status = 'confirmed'
        AND dc.primary_sighting_id IS DISTINCT FROM ${col(prefix, 'id')}::uuid
    )
  )
  AND (
    ${col(prefix, 'event_timestamp')} IS NULL
    OR (
      ${col(prefix, 'event_timestamp')} <= NOW() + interval '${PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS} days'
    )
  )
  AND (
    (${col(prefix, 'lat')} IS NULL AND ${col(prefix, 'lon')} IS NULL)
    OR (
      ${col(prefix, 'lat')} IS NOT NULL
      AND ${col(prefix, 'lon')} IS NOT NULL
      AND ${col(prefix, 'lat')} BETWEEN -90 AND 90
      AND ${col(prefix, 'lon')} BETWEEN -180 AND 180
    )
  )
)`;

export const buildFastPublicSightingFilter = (prefix = '') => `(
  ${buildUserPublicationConsentFilter(prefix)}
  AND (
    NOT EXISTS (
      SELECT 1
      FROM uap_sighting_duplicate_members dm
      JOIN (
        SELECT
          id AS cluster_id,
          status,
          primary_sighting_id
        FROM uap_sighting_duplicate_clusters
      ) dc
        ON dc.cluster_id = dm.cluster_id
      WHERE dm.sighting_id = ${col(prefix, 'id')}::uuid
        AND dc.status = 'confirmed'
        AND dc.primary_sighting_id IS DISTINCT FROM ${col(prefix, 'id')}::uuid
    )
  )
  AND (
    ${col(prefix, 'event_timestamp')} IS NULL
    OR (
      ${col(prefix, 'event_timestamp')} <= NOW() + interval '${PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS} days'
    )
  )
  AND (
    (${col(prefix, 'lat')} IS NULL AND ${col(prefix, 'lon')} IS NULL)
    OR (
      ${col(prefix, 'lat')} IS NOT NULL
      AND ${col(prefix, 'lon')} IS NOT NULL
      AND ${col(prefix, 'lat')} BETWEEN -90 AND 90
      AND ${col(prefix, 'lon')} BETWEEN -180 AND 180
    )
  )
)`;

export const buildRenderableGeoPairFilter = (prefix = '') => `(
  ${buildUserPublicationConsentFilter(prefix)}
  AND
  ${col(prefix, 'lat')} IS NOT NULL
  AND ${col(prefix, 'lon')} IS NOT NULL
  AND ${col(prefix, 'lat')} BETWEEN -90 AND 90
  AND ${col(prefix, 'lon')} BETWEEN -180 AND 180
  AND NOT (${col(prefix, 'lat')} = 0 AND ${col(prefix, 'lon')} = 0)
  AND NOT (
    UPPER(COALESCE(${col(prefix, 'source')}, '')) = 'SKYWATCH'
    AND LOWER(COALESCE(${col(prefix, 'geo_precision')}, '')) = 'city'
    AND COALESCE(NULLIF(TRIM(${col(prefix, 'country')}), ''), NULLIF(TRIM(${col(prefix, 'region')}), ''), '') = ''
  )
  AND ${buildUserMappableLocationPrivacyFilter(prefix)}
)`;

export const buildPublishableMappableSightingFilter = (prefix = '') => `(
  ${col(prefix, 'is_publishable_mappable')} = true
  AND (
    ${col(prefix, 'event_timestamp')} IS NULL
    OR ${col(prefix, 'event_timestamp')} <= NOW() + interval '${PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS} days'
  )
)`;

export const buildPublishableVisibilityReasonCase = (prefix = '') => `COALESCE((
  SELECT CASE
    WHEN NOT governance.legal_present THEN 'source_governance_missing'
    WHEN governance.any_blocked THEN 'registry_blocklist'
    WHEN NOT governance.alias_unambiguous OR NOT governance.all_approved THEN 'source_governance_not_approved'
    WHEN NOT governance.all_public_modes THEN 'source_governance_non_public_mode'
    WHEN NOT (
      governance.alias_unambiguous
      AND governance.legal_present
      AND NOT governance.any_blocked
      AND governance.all_approved
      AND governance.all_public_modes
    ) THEN 'source_governance_unapproved'
    WHEN NOT (${buildUserPublicationConsentFilter(prefix)}) THEN 'user_publication_not_consented'
    WHEN EXISTS (
      SELECT 1
      FROM uap_sighting_duplicate_members dm
      JOIN (
        SELECT
          id AS cluster_id,
          status,
          primary_sighting_id
        FROM uap_sighting_duplicate_clusters
      ) dc
        ON dc.cluster_id = dm.cluster_id
      WHERE dm.sighting_id = ${col(prefix, 'id')}::uuid
        AND dc.status = 'confirmed'
        AND dc.primary_sighting_id IS DISTINCT FROM ${col(prefix, 'id')}::uuid
    ) THEN 'duplicate_cluster_non_primary'
    WHEN (
      ${col(prefix, 'event_timestamp')} IS NOT NULL
      AND ${col(prefix, 'event_timestamp')} > NOW() + interval '${PUBLISHABLE_SIGHTING_MAX_FUTURE_DAYS} days'
    ) THEN 'future_dated'
    WHEN NOT (
      (${col(prefix, 'lat')} IS NULL AND ${col(prefix, 'lon')} IS NULL)
      OR (
        ${col(prefix, 'lat')} IS NOT NULL
        AND ${col(prefix, 'lon')} IS NOT NULL
        AND ${col(prefix, 'lat')} BETWEEN -90 AND 90
        AND ${col(prefix, 'lon')} BETWEEN -180 AND 180
      )
    ) THEN 'invalid_geo_pair'
    ELSE 'included'
  END
  FROM ${buildSourceGovernanceSummarySql(prefix)} governance
), 'source_governance_missing')`;

export const REGISTRY_BLOCKLIST_FILTER = buildRegistryBlocklistFilter();
export const PUBLISHABLE_SIGHTING_FILTER = buildPublishableSightingFilter();
export const RENDERABLE_GEO_PAIR_FILTER = buildRenderableGeoPairFilter();
export const PUBLISHABLE_MAPPABLE_SIGHTING_FILTER = buildPublishableMappableSightingFilter();
