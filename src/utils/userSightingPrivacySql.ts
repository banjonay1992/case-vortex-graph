import { USER_PUBLICATION_CONSENT_VERSION } from '../shared/userSightingPrivacy';

const col = (prefix: string, name: string) => (prefix ? `${prefix}.${name}` : name);

const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Excludes every first-party report from a response that can be replayed from
 * a shared cache. Consent-aware surfaces should use
 * `buildUserPublicationConsentFilter` instead.
 */
export const buildNonUserSightingFilter = (prefix = '') =>
  `UPPER(TRIM(COALESCE(${col(prefix, 'source')}, ''))) <> 'USER'`;

export const buildUserPublicationConsentFilter = (prefix = '') => `(
  ${buildNonUserSightingFilter(prefix)}
  OR (
    LOWER(COALESCE(${col(prefix, 'user_publication_state')}, 'private')) = 'public'
    AND COALESCE(${col(prefix, 'user_publication_consent_version')}, '') = ${sqlLiteral(USER_PUBLICATION_CONSENT_VERSION)}
    AND ${col(prefix, 'user_publication_consented_at')} IS NOT NULL
  )
)`;

export const buildUserMappableLocationPrivacyFilter = (prefix = '') => `(
  UPPER(TRIM(COALESCE(${col(prefix, 'source')}, ''))) <> 'USER'
  OR LOWER(COALESCE(${col(prefix, 'user_location_privacy')}, 'hidden')) = 'coarse'
)`;

export const buildPublicMapLatitudeSql = (prefix = '') => `CASE
  WHEN UPPER(TRIM(COALESCE(${col(prefix, 'source')}, ''))) = 'USER'
    THEN ROUND(${col(prefix, 'lat')}::numeric, 1)
  ELSE ${col(prefix, 'lat')}
END`;

export const buildPublicMapLongitudeSql = (prefix = '') => `CASE
  WHEN UPPER(TRIM(COALESCE(${col(prefix, 'source')}, ''))) = 'USER'
    THEN ROUND(${col(prefix, 'lon')}::numeric, 1)
  ELSE ${col(prefix, 'lon')}
END`;
