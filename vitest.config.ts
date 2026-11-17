import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { configureIntegrationTestDatabase } from './src/db/integrationTestSafety';
import { shouldUsePublicationV2FixtureCache } from './vitest.fixtureCachePolicy';

process.env.NODE_ENV ||= 'test';
configureIntegrationTestDatabase(process.env);
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@db.test.supabase.co:5432/postgres';
process.env.SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const requestedMaxWorkers = Number.parseInt(String(process.env.VITEST_MAX_WORKERS || '1'), 10);
const maxWorkers = Number.isFinite(requestedMaxWorkers) ? Math.min(8, Math.max(1, requestedMaxWorkers)) : 1;
const usePublicationV2FixtureCache = shouldUsePublicationV2FixtureCache(process.argv);

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    ...(usePublicationV2FixtureCache ? { globalSetup: ['tests/caseGraph/caseVortexSecurityGlobalSetup.ts'] } : {}),
    setupFiles: ['tests/vitest.setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 12_000,
    maxWorkers,
    fileParallelism: maxWorkers > 1,
    include: ['tests/**/*.test.ts'],
  },
});
