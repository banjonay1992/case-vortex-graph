import { createHmac, timingSafeEqual } from 'node:crypto';

export const CASE_GRAPH_CONTENT_RESEARCH_CURSOR_VERSION = 'case-graph-content-research-cursor-v1' as const;
export const CASE_GRAPH_CONTENT_RESEARCH_SORT_VERSION = 'score-micros-desc-chunk-id-asc-v1' as const;
export const CASE_GRAPH_CONTENT_RESEARCH_CURSOR_MAX_CHARACTERS = 4_096;

const CURSOR = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK_ID = /^content-chunk:[a-f0-9]{64}$/;
const MEDIA = ['document', 'image', 'audio', 'video'] as const;
const ORIGINS = ['asr', 'embedded_text', 'exif', 'frame_ocr', 'human_transcript', 'machine_caption', 'ocr'] as const;

export type CaseGraphContentResearchCursorPayload = {
  version: typeof CASE_GRAPH_CONTENT_RESEARCH_CURSOR_VERSION;
  sortVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_SORT_VERSION;
  publicationId: string;
  publicationManifestSha256: string;
  accountingReceiptDigest: string;
  indexManifestDigest: string;
  query: string;
  mediaKinds: Array<typeof MEDIA[number]>;
  textOrigins: Array<typeof ORIGINS[number]>;
  scoreMicros: number;
  chunkId: string;
};

export type CaseGraphContentResearchCursorCodec = {
  encode: (payload: CaseGraphContentResearchCursorPayload) => string;
  decode: (cursor: string) => CaseGraphContentResearchCursorPayload;
};

const invalid = (): never => { throw new Error('case_graph_research_content_cursor_invalid'); };
const normalize = (value: CaseGraphContentResearchCursorPayload): CaseGraphContentResearchCursorPayload => {
  if (!value || value.version !== CASE_GRAPH_CONTENT_RESEARCH_CURSOR_VERSION
    || value.sortVersion !== CASE_GRAPH_CONTENT_RESEARCH_SORT_VERSION
    || typeof value.publicationId !== 'string' || !UUID.test(value.publicationId)
    || !SHA256.test(value.publicationManifestSha256) || !SHA256.test(value.accountingReceiptDigest)
    || !SHA256.test(value.indexManifestDigest) || typeof value.query !== 'string'
    || !value.query.trim() || value.query !== value.query.trim() || value.query.length > 500
    || !Array.isArray(value.mediaKinds) || value.mediaKinds.some((entry) => !MEDIA.includes(entry))
    || !Array.isArray(value.textOrigins) || value.textOrigins.some((entry) => !ORIGINS.includes(entry))
    || new Set(value.mediaKinds).size !== value.mediaKinds.length
    || new Set(value.textOrigins).size !== value.textOrigins.length
    || !Number.isSafeInteger(value.scoreMicros) || value.scoreMicros < 0
    || typeof value.chunkId !== 'string' || !CHUNK_ID.test(value.chunkId)) invalid();
  const mediaKinds = [...value.mediaKinds].sort();
  const textOrigins = [...value.textOrigins].sort();
  if (mediaKinds.some((entry, index) => entry !== value.mediaKinds[index])
    || textOrigins.some((entry, index) => entry !== value.textOrigins[index])) invalid();
  return { ...value, mediaKinds, textOrigins };
};

export const createCaseGraphContentResearchCursorCodec = (
  secret: string | Buffer,
): CaseGraphContentResearchCursorCodec => {
  const key = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(String(secret || ''), 'utf8');
  if (key.byteLength < 32) throw new Error('case_graph_research_content_cursor_secret_invalid');
  const sign = (payload: string) => createHmac('sha256', key).update(payload).digest();
  return {
    encode: (value) => {
      const payload = Buffer.from(JSON.stringify(normalize(value)), 'utf8').toString('base64url');
      const cursor = `${payload}.${sign(payload).toString('base64url')}`;
      if (cursor.length > CASE_GRAPH_CONTENT_RESEARCH_CURSOR_MAX_CHARACTERS) invalid();
      return cursor;
    },
    decode: (cursor) => {
      if (typeof cursor !== 'string' || cursor.length > CASE_GRAPH_CONTENT_RESEARCH_CURSOR_MAX_CHARACTERS
        || !CURSOR.test(cursor)) invalid();
      const [payload, encodedSignature] = cursor.split('.');
      const received = Buffer.from(encodedSignature, 'base64url');
      const expected = sign(payload);
      if (received.byteLength !== expected.byteLength || !timingSafeEqual(received, expected)) invalid();
      let value: unknown;
      try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return invalid(); }
      const normalized = normalize(value as CaseGraphContentResearchCursorPayload);
      if (Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url') !== payload) invalid();
      return normalized;
    },
  };
};
