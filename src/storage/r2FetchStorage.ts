import { createHash, createHmac } from 'node:crypto';

import type {
  CaseGraphArchiveWriteCondition,
  CaseGraphListableConditionalArchiveStorage,
} from '../caseGraph/archiveTypes';

type R2FetchStorageConfig = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`
));
const encodeKey = (key: string) => key.split('/').map(awsEncode).join('/');
const timestamp = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');
const canonicalHeaderValue = (value: string) => value.trim().replace(/\s+/g, ' ');

const canonicalQueryString = (query: Record<string, string | undefined> = {}) => (
  Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      leftName < rightName ? -1
        : leftName > rightName ? 1
          : leftValue < rightValue ? -1
            : leftValue > rightValue ? 1 : 0
    ))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
);

const objectVersion = (response: Response, errorCode: string) => {
  const value = String(response.headers.get('etag') || '').trim();
  if (!value || value.length > 1024 || /[\r\n]/.test(value)) throw new Error(errorCode);
  return value;
};

const signingKey = (secret: string, date: string) => {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
};

const signedHeaders = (params: {
  config: R2FetchStorageConfig;
  method: 'GET' | 'PUT';
  key: string;
  body?: Buffer;
  now?: Date;
  extra?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
}) => {
  const now = params.now || new Date();
  const amzDate = timestamp(now);
  const date = amzDate.slice(0, 8);
  const endpoint = new URL(params.config.endpoint.includes('://') ? params.config.endpoint : `https://${params.config.endpoint}`);
  endpoint.pathname = `/${encodeURIComponent(params.config.bucket)}/${encodeKey(params.key)}`;
  const canonicalQuery = canonicalQueryString(params.query);
  endpoint.search = canonicalQuery ? `?${canonicalQuery}` : '';
  endpoint.hash = '';
  const payloadHash = hash(params.body || Buffer.alloc(0));
  const extraHeaders: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(params.extra || {})) {
    if (rawValue == null) continue;
    const name = rawName.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name) || ['authorization', 'host', 'x-amz-content-sha256', 'x-amz-date'].includes(name)) {
      throw new Error('r2_fetch_signed_header_invalid');
    }
    extraHeaders[name] = canonicalHeaderValue(rawValue);
  }
  const headersToSign: Record<string, string> = {
    host: endpoint.host,
    ...extraHeaders,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaderNames = Object.keys(headersToSign).sort();
  const canonicalHeaders = `${signedHeaderNames.map((name) => `${name}:${headersToSign[name]}`).join('\n')}\n`;
  const names = signedHeaderNames.join(';');
  const canonicalRequest = [params.method, endpoint.pathname, canonicalQuery, canonicalHeaders, names, payloadHash].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(params.config.secretAccessKey, date)).update(stringToSign).digest('hex');
  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${params.config.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
    ...extraHeaders,
  };
  return {
    url: endpoint.toString(),
    headers,
  };
};

const putHeaders = (options: {
  contentType: string;
  cacheControl: string;
  contentLength: number;
}) => ({
  'content-type': options.contentType,
  // Archive verification is defined over the stored gzip bytes. Setting HTTP
  // Content-Encoding here makes fetch transparently decompress an R2 GET and
  // destroys raw-byte checksum semantics. Public download routes add
  // Content-Encoding after verifying the stored object.
  'cache-control': options.cacheControl,
  'content-length': String(options.contentLength),
});

const conditionalHeader = (condition: CaseGraphArchiveWriteCondition) => {
  if ('ifAbsent' in condition && condition.ifAbsent === true) return { 'if-none-match': '*' };
  if ('ifVersion' in condition) {
    const version = String(condition.ifVersion || '').trim();
    if (!version || version.length > 1024 || /[\r\n]/.test(version)) throw new Error('r2_fetch_object_version_invalid');
    return { 'if-match': version };
  }
  throw new Error('r2_fetch_write_condition_invalid');
};

const XML_MAX_BYTES = 8 * 1024 * 1024;

const isXmlCodePoint = (value: number) => (
  value === 0x09
  || value === 0x0a
  || value === 0x0d
  || (value >= 0x20 && value <= 0xd7ff)
  || (value >= 0xe000 && value <= 0xfffd)
  || (value >= 0x10000 && value <= 0x10ffff)
);

const decodeXmlText = (value: string) => {
  const entity = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi;
  let decoded = '';
  let offset = 0;
  for (const match of value.matchAll(entity)) {
    const index = match.index;
    const plain = value.slice(offset, index);
    if (plain.includes('&')) throw new Error('r2_fetch_list_response_invalid');
    decoded += plain;
    const token = match[1].toLowerCase();
    if (token === 'amp') decoded += '&';
    else if (token === 'lt') decoded += '<';
    else if (token === 'gt') decoded += '>';
    else if (token === 'quot') decoded += '"';
    else if (token === 'apos') decoded += "'";
    else {
      const codePoint = Number.parseInt(token.startsWith('#x') ? token.slice(2) : token.slice(1), token.startsWith('#x') ? 16 : 10);
      if (!Number.isSafeInteger(codePoint) || !isXmlCodePoint(codePoint)) {
        throw new Error('r2_fetch_list_response_invalid');
      }
      decoded += String.fromCodePoint(codePoint);
    }
    offset = index + match[0].length;
  }
  const tail = value.slice(offset);
  if (tail.includes('&')) throw new Error('r2_fetch_list_response_invalid');
  decoded += tail;
  if ([...decoded].some((character) => !isXmlCodePoint(character.codePointAt(0)!))) {
    throw new Error('r2_fetch_list_response_invalid');
  }
  return decoded;
};

const xmlTexts = (value: string, element: string) => {
  const pattern = new RegExp(`<${element}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${element}\\s*>`, 'g');
  return [...value.matchAll(pattern)].map((match) => decodeXmlText(match[1]));
};

const singleXmlText = (value: string, element: string, required = false) => {
  const values = xmlTexts(value, element);
  if (values.length > 1 || (required && values.length !== 1)) {
    throw new Error('r2_fetch_list_response_invalid');
  }
  return values[0] ?? null;
};

const parseListObjectsV2 = (raw: string) => {
  if (Buffer.byteLength(raw, 'utf8') > XML_MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(raw)) {
    throw new Error('r2_fetch_list_response_invalid');
  }
  const value = raw.replace(/^\uFEFF/, '');
  const root = value.match(/^\s*(?:<\?xml[^>]*>\s*)?<ListBucketResult(?:\s[^>]*)?>([\s\S]*)<\/ListBucketResult\s*>\s*$/);
  if (!root) throw new Error('r2_fetch_list_response_invalid');
  const body = root[1];
  const truncatedValue = singleXmlText(body, 'IsTruncated', true)?.trim().toLowerCase();
  if (truncatedValue !== 'true' && truncatedValue !== 'false') {
    throw new Error('r2_fetch_list_response_invalid');
  }
  const encodingType = singleXmlText(body, 'EncodingType')?.trim().toLowerCase() || null;
  if (encodingType !== 'url') {
    throw new Error('r2_fetch_list_response_invalid');
  }
  const contentBlocks = [...body.matchAll(/<Contents(?:\s[^>]*)?>([\s\S]*?)<\/Contents\s*>/g)];
  const keys = contentBlocks.map((match) => {
    const encodedKey = singleXmlText(match[1], 'Key', true)!;
    let key = encodedKey;
    if (encodingType === 'url') {
      try {
        key = decodeURIComponent(encodedKey);
      } catch {
        throw new Error('r2_fetch_list_response_invalid');
      }
    }
    if (!key || Buffer.byteLength(key, 'utf8') > 1024) {
      throw new Error('r2_fetch_list_response_invalid');
    }
    return key;
  });
  const keyCountValue = singleXmlText(body, 'KeyCount');
  if (keyCountValue !== null) {
    const keyCount = Number(keyCountValue.trim());
    if (!Number.isSafeInteger(keyCount) || keyCount < 0 || keyCount !== keys.length) {
      throw new Error('r2_fetch_list_response_invalid');
    }
  }
  const truncated = truncatedValue === 'true';
  const nextCursor = singleXmlText(body, 'NextContinuationToken');
  if (
    (truncated && !nextCursor)
    || (!truncated && nextCursor !== null)
    || (nextCursor !== null && (nextCursor.length > 16_384 || /[\r\n]/.test(nextCursor)))
    || new Set(keys).size !== keys.length
  ) {
    throw new Error('r2_fetch_list_response_invalid');
  }
  return { keys, cursor: truncated ? nextCursor : null };
};

export const createR2FetchArchiveStorage = (
  config: R2FetchStorageConfig = {
    bucket: String(process.env.STORAGE_BUCKET || '').trim(),
    endpoint: String(process.env.STORAGE_ENDPOINT || '').trim(),
    accessKeyId: String(process.env.STORAGE_ACCESS_KEY || '').trim(),
    secretAccessKey: String(process.env.STORAGE_SECRET_KEY || '').trim(),
  },
  request: typeof fetch = fetch,
): CaseGraphListableConditionalArchiveStorage => {
  if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error('r2_fetch_storage_config_missing');
  }
  return {
    async listObjectKeys(prefix, cursor = null, limit = 1_000) {
      if (typeof prefix !== 'string' || Buffer.byteLength(prefix, 'utf8') > 1024 || prefix.includes('\u0000')) {
        throw new Error('r2_fetch_list_prefix_invalid');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('r2_fetch_list_limit_invalid');
      }
      if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 16_384 || /[\r\n]/.test(cursor))) {
        throw new Error('r2_fetch_list_cursor_invalid');
      }
      const signed = signedHeaders({
        config,
        method: 'GET',
        key: '',
        query: {
          'continuation-token': cursor || undefined,
          'encoding-type': 'url',
          'list-type': '2',
          'max-keys': String(limit),
          prefix,
        },
      });
      const response = await request(signed.url, { method: 'GET', headers: signed.headers });
      if (!response.ok) throw new Error(`r2_fetch_list_failed:${response.status}`);
      const page = parseListObjectsV2(await response.text());
      if (page.keys.length > limit || page.keys.some((key) => !key.startsWith(prefix))) {
        throw new Error('r2_fetch_list_response_invalid');
      }
      return page;
    },
    async readObject(key) {
      // Undici advertises compressed transport encodings by default. R2 may
      // then return a weak ETag for a dynamically encoded representation,
      // which cannot safely drive a later If-Match checkpoint transition.
      // Archive reads also verify stored bytes, so request the identity
      // representation explicitly.
      const signed = signedHeaders({
        config,
        method: 'GET',
        key,
        extra: { 'accept-encoding': 'identity' },
      });
      const response = await request(signed.url, { method: 'GET', headers: signed.headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`r2_fetch_read_failed:${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async readObjectVersioned(key) {
      const signed = signedHeaders({
        config,
        method: 'GET',
        key,
        extra: { 'accept-encoding': 'identity' },
      });
      const response = await request(signed.url, { method: 'GET', headers: signed.headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`r2_fetch_read_failed:${response.status}`);
      const version = objectVersion(response, 'r2_fetch_object_version_missing');
      return { body: Buffer.from(await response.arrayBuffer()), version };
    },
    async uploadFile(body, key, options) {
      const signed = signedHeaders({
        config, method: 'PUT', key, body,
        extra: putHeaders(options),
      });
      const response = await request(signed.url, { method: 'PUT', headers: signed.headers, body: new Uint8Array(body) });
      if (!response.ok) throw new Error(`r2_fetch_upload_failed:${response.status}`);
      return key;
    },
    async uploadFileConditional(body, key, options, condition) {
      const signed = signedHeaders({
        config,
        method: 'PUT',
        key,
        body,
        extra: { ...putHeaders(options), ...conditionalHeader(condition) },
      });
      const response = await request(signed.url, {
        method: 'PUT',
        headers: signed.headers,
        body: new Uint8Array(body),
      });
      if (response.status === 412) return { status: 'precondition_failed' as const };
      if (!response.ok) throw new Error(`r2_fetch_conditional_upload_failed:${response.status}`);
      return {
        status: 'written' as const,
        key,
        version: objectVersion(response, 'r2_fetch_object_version_missing'),
      };
    },
  };
};

export const signR2FetchRequestForTest = signedHeaders;
