import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  TYPED_RELATIONSHIP_EDGE_TYPES,
  type TypedRelationshipEdgeType,
} from './typedRelationshipEngine';

export const CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION = 'case-graph-relationship-cursor-v1' as const;
export const CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION = 'strength-desc-edge-id-asc-v1' as const;
export const CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_MAX_CHARACTERS = 4_096;

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ADDRESS_PATTERN = /^(sighting|document|photo|video):[^\u0000-\u001f\u007f]{1,512}$/u;

export type CaseGraphResearchRelationshipCursorPayload = {
  version: typeof CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION;
  sortVersion: typeof CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION;
  tool: 'expand_relationships' | 'correlate_context';
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
  address: string;
  edgeTypes: TypedRelationshipEdgeType[];
  minimumStrength: number;
  nextOffset: number;
};

export type CaseGraphResearchRelationshipCursorCodec = {
  encode(payload: CaseGraphResearchRelationshipCursorPayload): string;
  decode(cursor: string): CaseGraphResearchRelationshipCursorPayload;
};

const invalid = (): never => { throw new Error('case_graph_research_relationship_cursor_invalid'); };

const normalizedPayload = (
  value: CaseGraphResearchRelationshipCursorPayload,
): CaseGraphResearchRelationshipCursorPayload => {
  if (!value || typeof value !== 'object'
    || value.version !== CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION
    || value.sortVersion !== CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION
    || (value.tool !== 'expand_relationships' && value.tool !== 'correlate_context')
    || typeof value.publicationId !== 'string' || !value.publicationId || value.publicationId.length > 240
    || typeof value.corpusVersion !== 'string' || !value.corpusVersion || value.corpusVersion.length > 240
    || !SHA256_PATTERN.test(value.manifestSha256)
    || !ADDRESS_PATTERN.test(value.address)
    || !Array.isArray(value.edgeTypes)
    || value.edgeTypes.some((entry) => !TYPED_RELATIONSHIP_EDGE_TYPES.includes(entry))
    || new Set(value.edgeTypes).size !== value.edgeTypes.length
    || !Number.isFinite(value.minimumStrength) || value.minimumStrength < 0 || value.minimumStrength > 100
    || !Number.isSafeInteger(value.nextOffset) || value.nextOffset < 1 || value.nextOffset > 1_000_000) {
    return invalid();
  }
  const edgeTypes = [...value.edgeTypes].sort();
  if (edgeTypes.some((entry, index) => entry !== value.edgeTypes[index])) invalid();
  return {
    version: CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION,
    sortVersion: CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION,
    tool: value.tool,
    publicationId: value.publicationId,
    corpusVersion: value.corpusVersion,
    manifestSha256: value.manifestSha256,
    address: value.address,
    edgeTypes,
    minimumStrength: value.minimumStrength,
    nextOffset: value.nextOffset,
  };
};

export const createCaseGraphResearchRelationshipCursorCodec = (
  secret: string | Buffer,
): CaseGraphResearchRelationshipCursorCodec => {
  const key = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(String(secret || ''), 'utf8');
  if (key.byteLength < 32) throw new Error('case_graph_research_relationship_cursor_secret_invalid');
  const signature = (payload: string) => createHmac('sha256', key).update(payload).digest();
  return {
    encode: (raw) => {
      const payload = Buffer.from(JSON.stringify(normalizedPayload(raw)), 'utf8').toString('base64url');
      const cursor = `${payload}.${signature(payload).toString('base64url')}`;
      if (cursor.length > CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_MAX_CHARACTERS) invalid();
      return cursor;
    },
    decode: (cursor) => {
      if (typeof cursor !== 'string'
        || cursor.length > CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_MAX_CHARACTERS
        || !CURSOR_PATTERN.test(cursor)) invalid();
      const [payload, encodedSignature] = cursor.split('.');
      const receivedSignature = Buffer.from(encodedSignature, 'base64url');
      const expectedSignature = signature(payload);
      if (receivedSignature.byteLength !== expectedSignature.byteLength
        || !timingSafeEqual(receivedSignature, expectedSignature)) invalid();
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        return invalid();
      }
      const normalized = normalizedPayload(decoded as CaseGraphResearchRelationshipCursorPayload);
      if (Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url') !== payload) invalid();
      return normalized;
    },
  };
};
