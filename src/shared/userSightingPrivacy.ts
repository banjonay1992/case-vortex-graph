export const USER_PUBLICATION_CONSENT_VERSION = '2026-07-11-v1';

export const USER_PUBLICATION_STATES = ['private', 'public'] as const;
export type UserPublicationState = (typeof USER_PUBLICATION_STATES)[number];

export const USER_LOCATION_PRIVACY_MODES = ['coarse', 'hidden'] as const;
export type UserLocationPrivacyMode = (typeof USER_LOCATION_PRIVACY_MODES)[number];

const normalizeSource = (value: unknown) => String(value || '').trim().toUpperCase();
const normalizeText = (value: unknown) => String(value || '').trim();

const PRIVATE_PUBLIC_USER_FIELD_KEYS = new Set([
  'account_id',
  'avatar_url',
  'client_ip',
  'contact_email',
  'capture_session_id',
  'device_id',
  'device_metadata',
  'display_name',
  'email',
  'email_address',
  'ingestion_job_id',
  'ip',
  'ip_address',
  'owner_id',
  'phone',
  'phone_number',
  'profile_id',
  'remote_address',
  'session_id',
  'session_metadata',
  'submitted_by',
  'submitted_by_email',
  'submitted_by_user_id',
  'submitter',
  'submitter_email',
  'submitter_id',
  'submitter_user_id',
  'user',
  'user_email',
  'user_id',
  'tracking_snapshot_id',
]);

const normalizePrivateFieldKey = (value: string) => value
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[\s.-]+/g, '_')
  .toLowerCase();

const isPrivatePublicUserField = (value: string) => {
  const key = normalizePrivateFieldKey(value);
  return PRIVATE_PUBLIC_USER_FIELD_KEYS.has(key)
    || /^submitted_by(?:_|$)/.test(key)
    || /^submitter(?:_|$)/.test(key)
    || /^(?:account|moderator|owner|profile|reviewer|user)_(?:email|id|name)$/.test(key);
};

const redactPublicUserIdentityFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => redactPublicUserIdentityFields(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isPrivatePublicUserField(key))
      .map(([key, entry]) => [key, redactPublicUserIdentityFields(entry)]),
  );
};

const isPrivatePublicUserMetadataField = (value: string) => {
  const key = normalizePrivateFieldKey(value);
  return isPrivatePublicUserField(key)
    || /^(?:lat|latitude|lon|lng|longitude)$/.test(key)
    || /^(?:observer|device|capture)_(?:lat|latitude|lon|lng|longitude|location|position|accuracy)$/.test(key)
    || /^(?:address|street|street_address|postcode|postal_code)$/.test(key)
    || /^(?:coordinate|coordinates|geolocation|gps|position)$/.test(key)
    || /^(?:capture|device|raw|session|sky|tracking)_(?:context|metadata|payload)$/.test(key);
};

const redactPublicUserMetadataFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => redactPublicUserMetadataFields(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isPrivatePublicUserMetadataField(key))
      .map(([key, entry]) => [key, redactPublicUserMetadataFields(entry)]),
  );
};

const toFiniteCoordinate = (value: unknown) => {
  if (value == null) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const roundUserPublicCoordinate = (value: unknown) => {
  const parsed = toFiniteCoordinate(value);
  if (parsed == null) return null;
  return Number(parsed.toFixed(1));
};

const buildCoarseLocationLabel = (row: Record<string, unknown>) => {
  const parts = [row.city, row.region, row.country]
    .map(normalizeText)
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join(', ') : 'Approximate area';
};

export const isUserSighting = (row: Record<string, unknown> | null | undefined) =>
  normalizeSource(row?.source) === 'USER';

export const hasCurrentUserPublicationConsent = (
  row: Record<string, unknown> | null | undefined,
) => {
  if (!isUserSighting(row)) return true;
  return normalizeText(row?.user_publication_state).toLowerCase() === 'public'
    && normalizeText(row?.user_publication_consent_version) === USER_PUBLICATION_CONSENT_VERSION
    && Boolean(normalizeText(row?.user_publication_consented_at));
};

/**
 * Defense-in-depth response shaping for first-party reports.
 *
 * Public SQL must exclude USER rows without current consent. This helper still
 * fails closed so a future query regression cannot expose the stored precise
 * location or provenance fields. Publicly consented rows are coarse by
 * default; exact coordinates remain available only through owner-only routes.
 */
export const applyPublicUserSightingPrivacy = <T extends Record<string, any>>(row: T): T => {
  const output: Record<string, any> = { ...row };
  if (!isUserSighting(row)) {
    delete output.user_publication_state;
    delete output.user_publication_consent_version;
    delete output.user_publication_consented_at;
    delete output.user_location_privacy;
    return output as T;
  }

  const consented = hasCurrentUserPublicationConsent(row);
  const locationPrivacy = normalizeText(row.user_location_privacy).toLowerCase();

  if (!consented) {
    output.location = null;
    output.location_raw = null;
    output.location_normalized = null;
    output.lat = null;
    output.lon = null;
    output.description = null;
    output.description_raw = null;
    output.description_clean = null;
    output.summary = null;
    output.search_text = null;
    output.media_url = null;
    output.tags = null;
    output.quality_flags = null;
    output.evidence_provenance = null;
  } else if (locationPrivacy === 'coarse') {
    const coarseLat = roundUserPublicCoordinate(row.lat);
    const coarseLon = roundUserPublicCoordinate(row.lon);
    if (coarseLat === 0 && coarseLon === 0) {
      // A valid near-origin pair can become null island after privacy rounding.
      // Hide the public location instead of emitting a fake (0,0) coordinate.
      output.location = null;
      output.location_raw = null;
      output.location_normalized = null;
      output.lat = null;
      output.lon = null;
      output.geo_precision = 'hidden';
    } else {
      output.location = buildCoarseLocationLabel(row);
      output.location_raw = null;
      output.location_normalized = output.location;
      output.lat = coarseLat;
      output.lon = coarseLon;
      output.geo_precision = 'coarse';
    }
    output.evidence_provenance = null;
  } else {
    // `hidden` and unknown future values are deliberately non-mappable.
    output.location = null;
    output.location_raw = null;
    output.location_normalized = null;
    output.lat = null;
    output.lon = null;
    output.geo_precision = 'hidden';
    output.evidence_provenance = null;
  }

  // Consent audit data is owner/admin data, not part of the public payload.
  delete output.user_publication_state;
  delete output.user_publication_consent_version;
  delete output.user_publication_consented_at;
  delete output.user_location_privacy;

  output.quality_flags = redactPublicUserMetadataFields(output.quality_flags);
  if (Object.prototype.hasOwnProperty.call(output, 'metadata')) {
    output.metadata = redactPublicUserMetadataFields(output.metadata);
  }

  // Public-display consent never authorizes account identity, submitter
  // provenance, exact-device metadata, or nested copies of those fields. Keep
  // this final recursive pass in the shared projection so every dynamic public
  // consumer gets the same fail-closed identity contract.
  return redactPublicUserIdentityFields(output) as T;
};
