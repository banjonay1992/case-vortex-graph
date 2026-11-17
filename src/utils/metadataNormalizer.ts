import crypto from 'crypto';

export type GeoPrecision = 'exact' | 'city' | 'region' | 'country' | 'unknown';
export type DatePrecision = 'exact' | 'day' | 'month' | 'year' | 'unknown';

const US_STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

const US_STATE_NAME_TO_ABBR = Object.fromEntries(
  Object.entries(US_STATE_ABBR_TO_NAME).map(([abbr, name]) => [name.toUpperCase(), abbr])
) as Record<string, string>;

const COUNTRY_ALIASES: Record<string, { code: string; name: string }> = {
  US: { code: 'US', name: 'United States' },
  USA: { code: 'US', name: 'United States' },
  'UNITED STATES': { code: 'US', name: 'United States' },
  'UNITED STATES OF AMERICA': { code: 'US', name: 'United States' },
  GB: { code: 'GB', name: 'United Kingdom' },
  UK: { code: 'GB', name: 'United Kingdom' },
  'UNITED KINGDOM': { code: 'GB', name: 'United Kingdom' },
  'GREAT BRITAIN': { code: 'GB', name: 'United Kingdom' },
  BRITAIN: { code: 'GB', name: 'United Kingdom' },
  ENGLAND: { code: 'GB', name: 'United Kingdom' },
  SCOTLAND: { code: 'GB', name: 'United Kingdom' },
  WALES: { code: 'GB', name: 'United Kingdom' },
  'NORTHERN IRELAND': { code: 'GB', name: 'United Kingdom' },
  CA: { code: 'CA', name: 'Canada' },
  CANADA: { code: 'CA', name: 'Canada' },
  MX: { code: 'MX', name: 'Mexico' },
  MEXICO: { code: 'MX', name: 'Mexico' },
  BR: { code: 'BR', name: 'Brazil' },
  BRAZIL: { code: 'BR', name: 'Brazil' },
  FR: { code: 'FR', name: 'France' },
  FRANCE: { code: 'FR', name: 'France' },
  CL: { code: 'CL', name: 'Chile' },
  CHILE: { code: 'CL', name: 'Chile' },
  AR: { code: 'AR', name: 'Argentina' },
  ARGENTINA: { code: 'AR', name: 'Argentina' },
  PE: { code: 'PE', name: 'Peru' },
  PERU: { code: 'PE', name: 'Peru' },
  CO: { code: 'CO', name: 'Colombia' },
  COLOMBIA: { code: 'CO', name: 'Colombia' },
  AU: { code: 'AU', name: 'Australia' },
  AUSTRALIA: { code: 'AU', name: 'Australia' },
  NZ: { code: 'NZ', name: 'New Zealand' },
  'NEW ZEALAND': { code: 'NZ', name: 'New Zealand' },
  DE: { code: 'DE', name: 'Germany' },
  GERMANY: { code: 'DE', name: 'Germany' },
  ES: { code: 'ES', name: 'Spain' },
  SPAIN: { code: 'ES', name: 'Spain' },
  IT: { code: 'IT', name: 'Italy' },
  ITALY: { code: 'IT', name: 'Italy' },
  PT: { code: 'PT', name: 'Portugal' },
  PORTUGAL: { code: 'PT', name: 'Portugal' },
  JP: { code: 'JP', name: 'Japan' },
  JAPAN: { code: 'JP', name: 'Japan' },
  CN: { code: 'CN', name: 'China' },
  CHINA: { code: 'CN', name: 'China' },
  RU: { code: 'RU', name: 'Russia' },
  RUSSIA: { code: 'RU', name: 'Russia' },
  NL: { code: 'NL', name: 'Netherlands' },
  NETHERLANDS: { code: 'NL', name: 'Netherlands' },
  NO: { code: 'NO', name: 'Norway' },
  NORWAY: { code: 'NO', name: 'Norway' },
  SE: { code: 'SE', name: 'Sweden' },
  SWEDEN: { code: 'SE', name: 'Sweden' },
  FI: { code: 'FI', name: 'Finland' },
  FINLAND: { code: 'FI', name: 'Finland' },
  IS: { code: 'IS', name: 'Iceland' },
  ICELAND: { code: 'IS', name: 'Iceland' },
  IE: { code: 'IE', name: 'Ireland' },
  IRELAND: { code: 'IE', name: 'Ireland' },
  PL: { code: 'PL', name: 'Poland' },
  POLAND: { code: 'PL', name: 'Poland' },
  CH: { code: 'CH', name: 'Switzerland' },
  SWITZERLAND: { code: 'CH', name: 'Switzerland' },
  BE: { code: 'BE', name: 'Belgium' },
  BELGIUM: { code: 'BE', name: 'Belgium' },
  DK: { code: 'DK', name: 'Denmark' },
  DENMARK: { code: 'DK', name: 'Denmark' },
  ZA: { code: 'ZA', name: 'South Africa' },
  'SOUTH AFRICA': { code: 'ZA', name: 'South Africa' },
  IN: { code: 'IN', name: 'India' },
  INDIA: { code: 'IN', name: 'India' },
  AE: { code: 'AE', name: 'United Arab Emirates' },
  UAE: { code: 'AE', name: 'United Arab Emirates' },
  'UNITED ARAB EMIRATES': { code: 'AE', name: 'United Arab Emirates' },
};

const normalizeCountryKey = (value: string) => value.trim().toUpperCase().replace(/\./g, '');

const CANADA_PROVINCE_ABBR_TO_NAME: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

const CANADA_PROVINCE_ALIASES: Record<string, string> = {
  QUE: 'QC',
};

const CANADA_PROVINCE_NAME_TO_ABBR = Object.fromEntries(
  Object.entries(CANADA_PROVINCE_ABBR_TO_NAME).map(([abbr, name]) => [name.toUpperCase(), abbr])
) as Record<string, string>;

// Postgres rejects embedded NUL bytes, and OCR/PDF extraction occasionally
// leaks other control characters that are not useful for search/storage.
export const stripUnsafeTextChars = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');

export const normalizeText = (value?: unknown, maxLen = 5000) => {
  if (typeof value !== 'string') return null;
  const trimmed = stripUnsafeTextChars(value).trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
};

export const buildSearchText = (parts: Array<string | null | undefined>, maxLen = 8000) => {
  const tokens = parts
    .map(part => normalizeText(part))
    .filter(Boolean) as string[];
  if (tokens.length === 0) return null;
  const joined = tokens.join(' ');
  return joined.length > maxLen ? joined.slice(0, maxLen) : joined;
};

export const normalizeLocation = (location?: string | null, city?: string | null, region?: string | null, country?: string | null) => {
  const direct = normalizeText(location, 255);
  if (direct) return direct;
  const pieces = [city, region, country].map(part => normalizeText(part, 100)).filter(Boolean) as string[];
  if (pieces.length === 0) return null;
  return pieces.join(', ');
};

const normalizeUsState = (value?: string | null) => {
  const raw = normalizeText(value, 100);
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\./g, '').trim();
  if (US_STATE_ABBR_TO_NAME[upper]) return upper;
  if (US_STATE_NAME_TO_ABBR[upper]) return US_STATE_NAME_TO_ABBR[upper];
  return raw;
};

const getUsStateCode = (value?: string | null) => {
  const normalized = normalizeUsState(value);
  if (!normalized) return null;
  return US_STATE_ABBR_TO_NAME[normalized] ? normalized : null;
};

const normalizeCanadaProvince = (value?: string | null) => {
  const raw = normalizeText(value, 100);
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\./g, '').trim();
  if (CANADA_PROVINCE_ALIASES[upper]) return CANADA_PROVINCE_ALIASES[upper];
  if (CANADA_PROVINCE_ABBR_TO_NAME[upper]) return upper;
  if (CANADA_PROVINCE_NAME_TO_ABBR[upper]) return CANADA_PROVINCE_NAME_TO_ABBR[upper];
  return null;
};

const normalizeCityName = (value?: string | null) => {
  const raw = normalizeText(value, 100);
  if (!raw) return null;
  if (raw === raw.toUpperCase() || raw === raw.toLowerCase()) {
    return raw.toLowerCase().replace(/\b([a-z])/g, (_, letter: string) => letter.toUpperCase());
  }
  return raw;
};

export const normalizeCountry = (country?: string | null, countryCode?: string | null) => {
  const rawCountry = normalizeText(country, 100);
  const rawCode = normalizeText(countryCode, 10);
  const countryKey = rawCountry ? normalizeCountryKey(rawCountry) : null;
  const codeKey = rawCode ? normalizeCountryKey(rawCode) : null;

  if (countryKey) {
    const mapped = COUNTRY_ALIASES[countryKey];
    if (mapped) return { country: mapped.name, country_code: mapped.code };
    if (countryKey.length === 2) {
      const mappedCode = COUNTRY_ALIASES[countryKey];
      if (mappedCode) return { country: mappedCode.name, country_code: mappedCode.code };
      return { country: rawCountry, country_code: countryKey };
    }
  }

  if (codeKey && codeKey.length === 2) {
    const mapped = COUNTRY_ALIASES[codeKey];
    if (mapped) return { country: mapped.name, country_code: mapped.code };
    return { country: rawCountry ?? codeKey, country_code: codeKey };
  }

  return { country: rawCountry, country_code: null };
};

export const normalizeRegion = (region?: string | null, countryCode?: string | null) => {
  const raw = normalizeText(region, 100);
  if (!raw) return null;
  const code = normalizeText(countryCode, 10)?.toUpperCase();
  if (code === 'US') return normalizeUsState(raw);
  if (code === 'CA') return normalizeCanadaProvince(raw) ?? raw;
  return raw;
};

export const parseLocationParts = (location?: string | null) => {
  const raw = normalizeText(location, 255);
  if (!raw) return { city: null, region: null, country: null };
  const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, region: null, country: null };
  if (parts.length === 1) return { city: parts[0], region: null, country: null };
  if (parts.length === 2) {
    const usStateCode = getUsStateCode(parts[1]);
    if (usStateCode) {
      return { city: parts[0], region: usStateCode, country: null };
    }
    const canadaProvinceCode = normalizeCanadaProvince(parts[1]);
    if (canadaProvinceCode) {
      return { city: parts[0], region: canadaProvinceCode, country: 'Canada' };
    }
    const guess = normalizeCountry(parts[1], null);
    if (guess.country_code === 'CA') {
      const provinceFromFirstPart = normalizeCanadaProvince(parts[0]);
      if (provinceFromFirstPart) {
        return { city: null, region: provinceFromFirstPart, country: guess.country ?? 'Canada' };
      }
    }
    if (guess.country_code) {
      return { city: parts[0], region: null, country: guess.country ?? parts[1] };
    }
    return { city: parts[0], region: parts[1], country: null };
  }
  const city = parts[0];
  const country = parts[parts.length - 1];
  const region = parts.slice(1, -1).join(', ');
  return { city, region: region || null, country };
};

export const normalizeLocationFields = (input: {
  location?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  country_code?: string | null;
}) => {
  let city = normalizeCityName(input.city);
  let region = normalizeText(input.region, 100);
  let country = normalizeText(input.country, 100);
  let countryCode = normalizeText(input.country_code, 10);

  if (!city || !region || !country) {
    const parsed = parseLocationParts(input.location);
    if (!city && parsed.city) city = normalizeCityName(parsed.city);
    if (!region && parsed.region) region = parsed.region;
    if (!country && parsed.country) country = parsed.country;
  }

  const usStateCode = getUsStateCode(region);
  let countryForNormalization = country;
  let countryCodeForNormalization = countryCode;
  if (usStateCode) {
    const normalizedCountryCandidate = normalizeCountry(countryForNormalization, countryCodeForNormalization);
    const conflictingForeignCountry = normalizedCountryCandidate.country_code === usStateCode;
    if (conflictingForeignCountry || (!countryForNormalization && !countryCodeForNormalization)) {
      countryForNormalization = 'United States';
      countryCodeForNormalization = 'US';
    }
  }

  const normalizedCountry = normalizeCountry(countryForNormalization, countryCodeForNormalization);
  const normalizedRegion = normalizeRegion(region, normalizedCountry.country_code ?? countryCode);

  return {
    city,
    region: normalizedRegion,
    country: normalizedCountry.country ?? countryForNormalization ?? null,
    country_code: normalizedCountry.country_code ?? countryCodeForNormalization ?? null,
  };
};

export const normalizeShape = (shape?: string | null) => {
  const raw = normalizeText(shape, 50);
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (
    value.includes('balloon') ||
    value.includes('aerostat') ||
    value.includes('blimp') ||
    value.includes('lantern')
  ) return 'balloon';
  if (
    value.includes('triangle') ||
    value.includes('triangular') ||
    value.includes('delta') ||
    value.includes('chevron') ||
    value.includes('v-shaped') ||
    value.includes('v shaped')
  ) return 'triangle';
  if (value.includes('disk') || value.includes('disc') || value.includes('saucer')) return 'disk';
  if (value.includes('sphere') || value.includes('spherical') || value.includes('orb')) return 'sphere';
  if (value.includes('cigar') || value.includes('cylinder')) return 'cigar';
  if (value.includes('fireball') || value.includes('meteor')) return 'fireball';
  if (value.includes('formation')) return 'formation';
  if (value.includes('light') || value.includes('flash') || value.includes('glow')) return 'light';
  return 'unknown';
};

export const parseDurationSeconds = (raw?: string | null) => {
  const value = normalizeText(raw, 100);
  if (!value) return null;
  const text = value.toLowerCase();
  const timeMatch = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    const first = Number(timeMatch[1]);
    const second = Number(timeMatch[2]);
    const third = timeMatch[3] ? Number(timeMatch[3]) : null;
    if (Number.isFinite(first) && Number.isFinite(second)) {
      if (third != null && Number.isFinite(third)) {
        return first * 3600 + second * 60 + third;
      }
      return first * 60 + second;
    }
  }

  const match = text.match(/(\d+(?:\.\d+)?)\s*(seconds|second|secs|sec|minutes|minute|mins|min|hours|hour|hrs|hr)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  if (unit.startsWith('sec')) return Math.round(amount);
  if (unit.startsWith('min')) return Math.round(amount * 60);
  if (unit.startsWith('hr') || unit.startsWith('hour')) return Math.round(amount * 3600);
  return null;
};

export const inferGeoPrecision = (lat?: number | null, lon?: number | null, city?: string | null, region?: string | null, country?: string | null): GeoPrecision => {
  if (lat != null && lon != null) return 'exact';
  if (normalizeText(city, 100)) return 'city';
  if (normalizeText(region, 100)) return 'region';
  if (normalizeText(country, 100)) return 'country';
  return 'unknown';
};

export const getEventParts = (value?: string | Date | null) => {
  if (!value) return { event_year: null, event_month: null, event_decade: null, valid: false };
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { event_year: null, event_month: null, event_decade: null, valid: false };
  const year = date.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  if (year < 1800 || year > currentYear + 1) {
    return { event_year: null, event_month: null, event_decade: null, valid: false };
  }
  const month = date.getUTCMonth() + 1;
  const decade = Math.floor(year / 10) * 10;
  return { event_year: year, event_month: month, event_decade: decade, valid: true };
};

export const buildPublicId = (prefix: string, seed?: string | null) => {
  const normalized = normalizeText(seed, 200);
  if (!normalized) return null;
  const hash = crypto.createHash('md5').update(normalized).digest('hex').slice(0, 10).toUpperCase();
  return `${prefix}-${hash}`;
};

export const extractFileExt = (...candidates: Array<string | null | undefined>) => {
  for (const candidate of candidates) {
    const value = normalizeText(candidate, 512);
    if (!value) continue;
    const match = value.toLowerCase().match(/\.([a-z0-9]{2,8})(?:$|[?#])/);
    if (match) return match[1];
  }
  return null;
};

export const inferDocType = (fileExt?: string | null) => {
  const ext = normalizeText(fileExt, 10)?.toLowerCase();
  if (!ext) return 'other';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'report';
  if (['doc', 'docx', 'rtf', 'txt'].includes(ext)) return 'report';
  if (['csv', 'tsv', 'xls', 'xlsx'].includes(ext)) return 'dataset';
  return 'other';
};
