BEGIN;

CREATE OR REPLACE FUNCTION public.uap_sighting_map_projection_enqueue_governance_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  key_value text;
  affected_canonical text[];
  affected_source_keys text[];
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.canonical_source IS NOT DISTINCT FROM OLD.canonical_source
    AND NEW.legal_status IS NOT DISTINCT FROM OLD.legal_status
    AND NEW.allowed_content_modes IS NOT DISTINCT FROM OLD.allowed_content_modes
  THEN
    RETURN NULL;
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

  SELECT ARRAY_AGG(DISTINCT source_key ORDER BY source_key)
  INTO affected_source_keys
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

  -- uap_source_governance_zero_sighting_map_queue_guard:v1
  -- A newly governed source with no sightings cannot have map projections or
  -- coordinate-reuse state to invalidate, and does not need a refresh queue row.
  IF COALESCE(CARDINALITY(affected_source_keys), 0) = 0
    OR NOT EXISTS (
      SELECT 1
      FROM public.uap_sightings sighting
      WHERE UPPER(COALESCE(NULLIF(TRIM(sighting.source), ''), ''))
        = ANY(affected_source_keys)
      LIMIT 1
    )
  THEN
    RETURN NULL;
  END IF;

  PERFORM public.uap_map_invalidate_coordinate_reuse(
    'source_legal_registry_' || LOWER(TG_OP)
  );

  FOREACH key_value IN ARRAY affected_source_keys LOOP
    INSERT INTO public.uap_sighting_map_projection_source_refresh_queue (
      source_key,
      reason,
      enqueued_at,
      cursor_sighting_id
    ) VALUES (
      key_value,
      'source_governance_changed',
      NOW(),
      '00000000-0000-0000-0000-000000000000'::uuid
    )
    ON CONFLICT (source_key) DO UPDATE SET
      reason = EXCLUDED.reason,
      enqueued_at = EXCLUDED.enqueued_at,
      cursor_sighting_id = EXCLUDED.cursor_sighting_id;
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.uap_sighting_map_projection_enqueue_governance_source()
  FROM PUBLIC;

COMMIT;
