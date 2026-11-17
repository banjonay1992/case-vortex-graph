type IntegrationTestEnvironment = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const RESERVED_DATABASE_NAMES = new Set(['postgres', 'template0', 'template1']);
const TEST_DATABASE_NAME_PATTERN = /(^|[_-])(test|testing|integration|ephemeral)([_-]|$)/i;
const DEPLOYMENT_ENV_KEYS = ['NODE_ENV', 'APP_ENV', 'ENVIRONMENT', 'DEPLOY_ENV', 'VERCEL_ENV'] as const;
const PRODUCTION_LIKE_ENV_PATTERN = /(^|[_-])(prod|production|stage|staging)([_-]|$)/i;
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

const isTruthy = (value: string | undefined) => TRUTHY_VALUES.has(String(value || '').trim().toLowerCase());

const refusal = (reason: string): Error => new Error(
  `Refusing to run database integration tests: ${reason}. `
  + 'Set INTEGRATION_DATABASE_URL to a disposable loopback Postgres database whose name contains '
  + '"test", "integration", or "ephemeral". Never point this lane at production or staging.',
);

const readDatabaseName = (url: URL): string => {
  const encodedName = url.pathname.replace(/^\/+/, '');
  if (!encodedName || encodedName.includes('/')) return '';

  try {
    return decodeURIComponent(encodedName).trim();
  } catch {
    return '';
  }
};

export const assertIntegrationDatabaseIsEphemeral = (
  env: IntegrationTestEnvironment,
): string => {
  for (const key of DEPLOYMENT_ENV_KEYS) {
    const value = String(env[key] || '').trim();
    if (PRODUCTION_LIKE_ENV_PATTERN.test(value)) {
      throw refusal(`${key} identifies a production-like deployment`);
    }
  }

  const connectionString = String(env.INTEGRATION_DATABASE_URL || '').trim();
  if (!connectionString) {
    throw refusal('the dedicated INTEGRATION_DATABASE_URL is missing');
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw refusal('INTEGRATION_DATABASE_URL is not a valid URL');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw refusal('INTEGRATION_DATABASE_URL must use the postgres or postgresql protocol');
  }

  // node-postgres/libpq connection parameters can override URL authority and
  // identity fields (for example `?host=remote.example`). This destructive
  // test lane has no need for query parameters, so reject the entire class
  // instead of maintaining an override-name denylist that can drift.
  if (url.search) {
    throw refusal('INTEGRATION_DATABASE_URL must not include query parameters');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw refusal('the integration database host is not loopback-only');
  }

  const databaseName = readDatabaseName(url);
  if (!databaseName) {
    throw refusal('the integration database name is missing or invalid');
  }
  if (RESERVED_DATABASE_NAMES.has(databaseName.toLowerCase())) {
    throw refusal('the default administrative database is not disposable');
  }
  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw refusal('the database name is not explicitly test-scoped');
  }

  const isCi = isTruthy(env.CI) || isTruthy(env.GITHUB_ACTIONS);
  if (isCi && !isTruthy(env.INTEGRATION_DATABASE_EPHEMERAL)) {
    throw refusal('CI must set INTEGRATION_DATABASE_EPHEMERAL=1 for its disposable database service');
  }

  return connectionString;
};

/**
 * Canonical integration-test bootstrap. The dedicated, validated URL replaces
 * any ambient DATABASE_URL before application modules are imported.
 */
export const configureIntegrationTestDatabase = (
  env: IntegrationTestEnvironment,
): boolean => {
  if (env.RUN_INTEGRATION_TESTS !== '1') return false;

  const connectionString = assertIntegrationDatabaseIsEphemeral(env);
  env.DATABASE_URL = connectionString;
  env.ALLOW_LOCAL_DB = 'true';
  env.ALLOW_NON_SUPABASE_DB = 'true';
  return true;
};
