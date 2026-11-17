import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const CONNECTION_IDENTITY_QUERY_PARAMETERS = new Set([
  'database',
  'dbname',
  'host',
  'hostaddr',
  'password',
  'port',
  'service',
  'user',
  'username',
]);
const TLS_QUERY_PARAMETERS = new Set([
  'ssl',
  'sslcert',
  'sslkey',
  'sslmode',
  'sslrootcert',
]);

export type DatabaseEndpoint = {
  effectiveConnectionString: string;
  hostname: string;
  isLocal: boolean;
  isSupabase: boolean;
  isSupabasePooler: boolean;
};

export type DatabaseTlsWarning = {
  code: 'DB_TLS_SERVER_VERIFICATION_DISABLED';
  message: string;
};

export type DatabaseTlsPolicy = {
  caSource: 'DATABASE_SSL_CA' | 'PGSSLROOTCERT' | null;
  ssl: ConnectionOptions | undefined;
  verificationEnabled: boolean;
  warning: DatabaseTlsWarning | null;
};

type DatabaseEnvironment = Record<string, string | undefined>;
type ReadTextFile = (path: string) => string;

const normalizeHostname = (value: string) => {
  let hostname = value.trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }
  return hostname.replace(/\.+$/, '');
};

const isHostnameWithin = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

export const parseDatabaseEndpoint = (connectionString: string): DatabaseEndpoint => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  const queryParameterKeys = Array.from(url.searchParams.keys());
  const identityOverride = queryParameterKeys.find((key) =>
    CONNECTION_IDENTITY_QUERY_PARAMETERS.has(key.toLowerCase()),
  );
  if (identityOverride) {
    throw new Error(
      `DATABASE_URL query parameter "${identityOverride}" cannot override the connection target or identity.`,
    );
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new Error('DATABASE_URL must include a hostname.');
  }

  for (const key of queryParameterKeys) {
    if (TLS_QUERY_PARAMETERS.has(key.toLowerCase())) {
      // node-postgres connection-string parsing can otherwise replace the
      // explicit Pool.ssl policy below, including its configured trust root.
      url.searchParams.delete(key);
    }
  }

  const isSupabase = isHostnameWithin(hostname, 'supabase.co')
    || isHostnameWithin(hostname, 'supabase.com');

  return {
    effectiveConnectionString: url.toString(),
    hostname,
    isLocal: LOCAL_HOSTNAMES.has(hostname),
    isSupabase,
    isSupabasePooler: isHostnameWithin(hostname, 'pooler.supabase.com'),
  };
};

const parseOptionalBoolean = (name: string, value: string | undefined): boolean | undefined => {
  if (value == null || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be one of true, false, 1, 0, yes, no, on, or off.`);
};

const normalizeCertificatePem = (value: string, source: string) => {
  const pem = value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
  const certificates = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  if (!certificates?.length) {
    throw new Error(`${source} must contain at least one PEM CERTIFICATE block.`);
  }
  return `${pem}\n`;
};

const resolveCertificateAuthority = (
  environment: DatabaseEnvironment,
  readTextFile: ReadTextFile,
): { ca: string; source: DatabaseTlsPolicy['caSource'] } | null => {
  const inlineCa = environment.DATABASE_SSL_CA?.trim();
  if (inlineCa) {
    return {
      ca: normalizeCertificatePem(inlineCa, 'DATABASE_SSL_CA'),
      source: 'DATABASE_SSL_CA',
    };
  }

  const rootCertificatePath = environment.PGSSLROOTCERT?.trim();
  if (!rootCertificatePath) return null;

  let fileContents: string;
  try {
    fileContents = readTextFile(rootCertificatePath);
  } catch {
    throw new Error('PGSSLROOTCERT could not be read. Check that the configured certificate path exists and is readable.');
  }
  return {
    ca: normalizeCertificatePem(fileContents, 'PGSSLROOTCERT'),
    source: 'PGSSLROOTCERT',
  };
};

const defaultReadTextFile: ReadTextFile = (path) => readFileSync(path, 'utf8');

export const resolveDatabaseTlsPolicy = (
  endpoint: DatabaseEndpoint,
  environment: DatabaseEnvironment = process.env,
  readTextFile: ReadTextFile = defaultReadTextFile,
): DatabaseTlsPolicy => {
  if (endpoint.isLocal) {
    return {
      caSource: null,
      ssl: undefined,
      verificationEnabled: false,
      warning: null,
    };
  }

  const certificateAuthority = resolveCertificateAuthority(environment, readTextFile);
  const explicitVerification = parseOptionalBoolean(
    'PGSSL_REJECT_UNAUTHORIZED',
    environment.PGSSL_REJECT_UNAUTHORIZED,
  );
  const verificationRequiredInProduction = parseOptionalBoolean(
    'REQUIRE_DATABASE_SSL_VERIFICATION_IN_PROD',
    environment.REQUIRE_DATABASE_SSL_VERIFICATION_IN_PROD,
  ) ?? false;
  const production = environment.NODE_ENV?.trim().toLowerCase() === 'production';
  const verificationEnabled = certificateAuthority
    ? true
    : explicitVerification ?? !endpoint.isSupabase;

  if (production && verificationRequiredInProduction) {
    if (!verificationEnabled) {
      throw new Error(
        'Production database TLS verification is required, but server identity verification is disabled. Configure DATABASE_SSL_CA or PGSSLROOTCERT.',
      );
    }
    if (endpoint.isSupabase && !certificateAuthority) {
      throw new Error(
        'Production Supabase TLS verification requires the project Server root certificate in DATABASE_SSL_CA or PGSSLROOTCERT.',
      );
    }
  }

  const warning = production && !verificationEnabled
    ? {
      code: 'DB_TLS_SERVER_VERIFICATION_DISABLED' as const,
      message: 'Database traffic is encrypted, but server identity verification is disabled. Install the Supabase project Server root certificate with DATABASE_SSL_CA or PGSSLROOTCERT, then enable REQUIRE_DATABASE_SSL_VERIFICATION_IN_PROD.',
    }
    : null;

  return {
    caSource: certificateAuthority?.source ?? null,
    ssl: {
      rejectUnauthorized: verificationEnabled,
      ...(certificateAuthority ? { ca: certificateAuthority.ca } : {}),
    },
    verificationEnabled,
    warning,
  };
};
