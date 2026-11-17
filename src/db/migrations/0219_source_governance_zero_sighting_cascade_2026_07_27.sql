BEGIN;

CREATE OR REPLACE FUNCTION public.uap_source_legal_registry_cascade_is_publishable_mappable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
DECLARE
  affected_canonical text[];
  affected_sources text[];
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.canonical_source IS NOT DISTINCT FROM OLD.canonical_source
    AND NEW.legal_status IS NOT DISTINCT FROM OLD.legal_status
    AND NEW.allowed_content_modes IS NOT DISTINCT FROM OLD.allowed_content_modes
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    affected_canonical := ARRAY[UPPER(TRIM(NEW.canonical_source))];
  ELSIF TG_OP = 'DELETE' THEN
    affected_canonical := ARRAY[UPPER(TRIM(OLD.canonical_source))];
  ELSE
    affected_canonical := ARRAY[
      UPPER(TRIM(OLD.canonical_source)),
      UPPER(TRIM(NEW.canonical_source))
    ];
  END IF;

  SELECT ARRAY_AGG(DISTINCT source_key)
  INTO affected_sources
  FROM (
    SELECT canonical AS source_key
    FROM UNNEST(affected_canonical) AS canonical
    WHERE canonical <> ''
    UNION
    SELECT UPPER(TRIM(alias.alias)) AS source_key
    FROM public.uap_source_alias_map alias
    WHERE COALESCE(alias.active, true) = true
      AND UPPER(TRIM(alias.canonical_source)) = ANY(affected_canonical)
  ) sources;

  -- uap_source_governance_zero_sighting_guard:v1
  -- Match the leading expression of idx_uap_sightings_case_graph_source_cursor_ms
  -- so a newly governed source with no sightings does not launch two corpus scans.
  IF COALESCE(CARDINALITY(affected_sources), 0) > 0
    AND EXISTS (
      SELECT 1
      FROM public.uap_sightings sighting
      WHERE UPPER(COALESCE(NULLIF(TRIM(sighting.source), ''), ''))
        = ANY(affected_sources)
      LIMIT 1
    )
  THEN
    PERFORM public.uap_sightings_recompute_is_publishable_mappable_by_sources(
      affected_sources
    );
    PERFORM public.uap_sightings_refresh_public_rollup_by_sources(
      affected_sources
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.uap_source_legal_registry_cascade_is_publishable_mappable()
  FROM PUBLIC;

COMMIT;
