import { createHash } from 'node:crypto';

import type { EvidenceUniverseNodeKind } from './evidenceUniverse';
import { TYPED_RELATIONSHIP_EDGE_TYPES, type TypedRelationshipEdgeType } from './typedRelationshipEngine';
import type {
  CaseGraphV2LineageReceipts,
  KindCounts,
  RelationshipAccounting,
  RelationshipStatus,
} from './postgresCaseGraphControlPlaneV2Types';
import { NODE_KINDS } from './postgresCaseGraphControlPlaneV2Types';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA256 = /^[a-f0-9]{64}$/;

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export const exactKeys = (value: unknown, expected: readonly string[]) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

export const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
};

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('case_graph_v2_non_finite_json');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) throw new Error('case_graph_v2_non_json_value');
  const entries = Object.entries(value).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  if (entries.some(([, child]) => child === undefined)) {
    throw new Error('case_graph_v2_undefined_json_value');
  }
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
};

export const sameJson = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export const parseJsonBody = (body: Buffer, code: string): unknown => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error(code);
  }
};

export const safeCount = (value: unknown, code: string) => {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) throw new Error(code);
  return Number(parsed);
};

export const requiredText = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !value) throw new Error(code);
  return value;
};

export const requiredUuid = (value: unknown, code: string) => {
  const normalized = requiredText(value, code).toLowerCase();
  if (!UUID.test(normalized)) throw new Error(code);
  return normalized;
};

export const requiredSha = (value: unknown, code: string) => {
  const digest = requiredText(value, code);
  if (!SHA256.test(digest)) throw new Error(code);
  return digest;
};

export const requiredBoolean = (value: unknown, code: string) => {
  if (value !== true && value !== false) throw new Error(code);
  return value;
};

export const timestamp = (value: unknown, code: string) => {
  const parsed = value instanceof Date ? value : new Date(requiredText(value, code));
  if (!Number.isFinite(parsed.getTime())) throw new Error(code);
  return parsed.toISOString();
};

export const nullableTimestamp = (value: unknown, code: string) => (
  value == null ? null : timestamp(value, code)
);

export const nullableText = (value: unknown, code: string) => (
  value == null ? null : requiredText(value, code)
);

export const nullableUuid = (value: unknown, code: string) => (
  value == null ? null : requiredUuid(value, code)
);

export const emptyKindCounts = (): KindCounts => ({
  sighting: 0, document: 0, photo: 0, video: 0,
});

export const sameKindCounts = (left: KindCounts, right: KindCounts) => (
  NODE_KINDS.every((kind) => left[kind] === right[kind])
);

const RELATIONSHIP_STATUSES: RelationshipStatus[] = ['linked', 'candidate_only', 'isolated'];

const exactSafeCounts = <T extends string>(
  value: unknown,
  keys: readonly T[],
  code: string,
): Record<T, number> => {
  if (!exactKeys(value, keys)) throw new Error(code);
  return Object.fromEntries(keys.map((key) => [
    key,
    safeCount((value as Record<string, unknown>)[key], code),
  ])) as Record<T, number>;
};

export const parseRelationshipAccounting = (value: unknown): RelationshipAccounting => {
  const code = 'case_graph_v2_relationship_accounting_invalid';
  if (!exactKeys(value, [
    'universe_record_count', 'address_kind_counts', 'candidate_pair_count',
    'typed_edge_count', 'typed_edge_type_counts', 'skipped_group_count',
    'skipped_estimated_pair_count', 'relationship_status_counts',
    'address_ledger_set_sha256',
  ])) throw new Error(code);
  const raw = value as Record<string, unknown>;
  const universe = safeCount(raw.universe_record_count, code);
  const addressKindCounts = exactSafeCounts(raw.address_kind_counts, NODE_KINDS, code);
  const typedEdgeCount = safeCount(raw.typed_edge_count, code);
  const typedEdgeTypeCounts = exactSafeCounts(
    raw.typed_edge_type_counts,
    TYPED_RELATIONSHIP_EDGE_TYPES,
    code,
  );
  const statusCounts = exactSafeCounts(raw.relationship_status_counts, RELATIONSHIP_STATUSES, code);
  if (NODE_KINDS.reduce((sum, kind) => sum + addressKindCounts[kind], 0) !== universe
    || RELATIONSHIP_STATUSES.reduce((sum, status) => sum + statusCounts[status], 0) !== universe
    || TYPED_RELATIONSHIP_EDGE_TYPES.reduce((sum, edgeType) => sum + typedEdgeTypeCounts[edgeType], 0)
      !== typedEdgeCount) {
    throw new Error(code);
  }
  return {
    universe_record_count: universe,
    address_kind_counts: addressKindCounts,
    candidate_pair_count: safeCount(raw.candidate_pair_count, code),
    typed_edge_count: typedEdgeCount,
    typed_edge_type_counts: typedEdgeTypeCounts as Record<TypedRelationshipEdgeType, number>,
    skipped_group_count: safeCount(raw.skipped_group_count, code),
    skipped_estimated_pair_count: safeCount(raw.skipped_estimated_pair_count, code),
    relationship_status_counts: statusCounts,
    address_ledger_set_sha256: requiredSha(raw.address_ledger_set_sha256, code),
  };
};

export const relationshipAccountingFor = (
  receipts: CaseGraphV2LineageReceipts,
): RelationshipAccounting => {
  const completion = receipts.relationshipCompletion;
  return parseRelationshipAccounting({
    universe_record_count: completion.universeRecordCount,
    address_kind_counts: completion.addressKindCounts,
    candidate_pair_count: completion.candidatePairCount,
    typed_edge_count: completion.typedEdgeCount,
    typed_edge_type_counts: completion.typedEdgeTypeCounts,
    skipped_group_count: completion.skippedGroupCount,
    skipped_estimated_pair_count: completion.skippedEstimatedPairCount,
    relationship_status_counts: {
      linked: completion.linkedAddressCount,
      candidate_only: completion.candidateOnlyAddressCount,
      isolated: completion.isolatedAddressCount,
    },
    address_ledger_set_sha256: completion.addressLedgerSetSha256,
  });
};
