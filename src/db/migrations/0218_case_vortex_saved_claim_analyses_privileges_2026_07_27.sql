BEGIN;

REVOKE ALL ON FUNCTION public.save_case_vortex_luna_turn(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
  VARCHAR, UUID, VARCHAR
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.save_case_vortex_luna_turn(
      UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
      JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
      VARCHAR, UUID, VARCHAR
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.save_case_vortex_luna_turn(
      UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
      JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
      VARCHAR, UUID, VARCHAR
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.save_case_vortex_luna_turn(
      UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT,
      JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB,
      VARCHAR, UUID, VARCHAR
    ) TO service_role;
  END IF;
END;
$$;

COMMIT;
