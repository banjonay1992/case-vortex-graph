import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type {
  CaseGraphArchiveStorage,
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from './archiveTypes';
import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  type ContextualExplanationCandidateDraft,
  type ContextualExplanationKind,
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
} from './contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE,
  type ContextualRelationshipAdapterResult,
  type GovernedContextualObservationPayload,
  adaptContextualRelationship,
  buildContextualRelationshipFactReceiptMetrics,
  decodeGovernedContextualObservationPayload,
  verifyContextualRelationshipAdapterResult,
} from './contextualRelationshipAdapter';
import {
  buildContextualObservationArchiveGovernanceReceipt,
  verifyContextualObservationArchiveGovernanceReceipt,
  type ContextualObservationArchiveGovernanceReceipt,
} from './contextualObservationArchiveGovernance';
import type { ContextualSourceGovernanceDecisionPacket } from './contextualSourceGovernanceDecision';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
  assertRelationshipInputBinding,
  decodeRelationshipInputRecord,
  validateRelationshipInputBinding,
} from './relationshipInputSnapshot';
import {
  assertPlainObject,
  exactKeys,
  invalid,
  isPlainObject,
  lexical,
  normalizeWindow,
  parseInput,
  requireCount,
  requireCursor,
  requireId,
  requireSha,
  requireTimestamp,
} from './contextualObservationArchiveValidation';

export const GOVERNED_CONTEXTUAL_SOURCE_VERSION = 'governed-contextual-source-v1' as const;
export const CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION = 'contextual-observation-archive-v1' as const;

export type GovernedContextualHistoricalSourceFamily =
  | 'aircraft_adsb_history'
  | 'satellite_tle_sgp4_history'
  | 'astronomy_ephemeris_history'
  | 'weather_observation_history';

const DEFAULT_PAGE_SIZE = 2_000;
const MAX_PAGE_SIZE = 10_000;
const MAX_UNCOMPRESSED_PART_BYTES = 64 * 1024 * 1024;
const MAX_COMPRESSED_PART_BYTES = 32 * 1024 * 1024;
const KINDS: readonly ContextualExplanationKind[] = ['aircraft', 'satellite', 'astronomy', 'weather'];

type UploadOptions = {
  contentType: string;
  contentEncoding?: string;
  cacheControl: string;
  contentLength: number;
};

export type GovernedContextualSourceSnapshotDraft = {
  binding: RelationshipInputUniverseBinding;
  kind: ContextualExplanationKind;
  sourceFamily: GovernedContextualHistoricalSourceFamily;
  sourceId: string;
  providerId: string;
  datasetVersion: string;
  coverageWindow: { start: string; end: string };
  materializedAt: string;
  contentSha256: string;
};

export type GovernedContextualSourceSnapshot = GovernedContextualSourceSnapshotDraft & {
  recordType: 'governed_contextual_source_snapshot';
  schemaVersion: typeof GOVERNED_CONTEXTUAL_SOURCE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  captureMode: 'immutable_historical_snapshot';
  snapshotDigest: string;
};

export type ContextualHistoricalTimeAlignment =
  | {
    status: 'verified_historical_alignment';
    coverageWindow: GovernedContextualSourceSnapshot['coverageWindow'];
    subjectWindowSha256: string;
    referenceWindowSha256: string;
  }
  | {
    status: 'unresolved_missing_time';
    coverageWindow: GovernedContextualSourceSnapshot['coverageWindow'];
    missingFields: Array<'subject.window' | 'reference.window'>;
  };

export type GovernedContextualSourceRow = {
  recordType: 'governed_contextual_source_row';
  schemaVersion: typeof GOVERNED_CONTEXTUAL_SOURCE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  snapshotDigest: string;
  sortKey: string;
  relationshipRecord: RelationshipInputRecord;
  payload: GovernedContextualObservationPayload;
  timeAlignment: ContextualHistoricalTimeAlignment;
  rowDigest: string;
};

export type GovernedContextualSourcePage = {
  recordType: 'governed_contextual_source_page';
  schemaVersion: typeof GOVERNED_CONTEXTUAL_SOURCE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  snapshotDigest: string;
  cursor: string | null;
  nextCursor: string | null;
  rows: GovernedContextualSourceRow[];
  pageDigest: string;
};

export type GovernedContextualObservationSource = {
  inspectSnapshot: () => Promise<unknown>;
  fetchPage: (params: {
    snapshot: GovernedContextualSourceSnapshot;
    cursor: string | null;
    limit: number;
  }) => Promise<unknown>;
};

export type ContextualObservationArchiveRecord = {
  recordType: 'contextual_observation_archive_record';
  schemaVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  sourceSnapshotDigest: string;
  sourceRowDigest: string;
  address: string;
  relationshipRecordDigest: string;
  payload: GovernedContextualObservationPayload;
  result: ContextualRelationshipAdapterResult;
  timeAlignment: ContextualHistoricalTimeAlignment;
  recordDigest: string;
};

export type ContextualObservationArchivePartSummary = {
  partNumber: number;
  sourcePageNumber: number;
  sourcePageDigest: string;
  archiveKey: string;
  manifestKey: string;
  rowCount: number;
  emittedEdgeCount: number;
  insufficientEvidenceCount: number;
  firstSortKey: string;
  lastSortKey: string;
  uncompressedBytes: number;
  compressedBytes: number;
  compressedSha256: string;
  recordSetSha256: string;
};

export type ContextualObservationSourcePageReceipt = {
  pageNumber: number;
  cursor: string | null;
  nextCursor: string | null;
  rowCount: number;
  pageDigest: string;
};

export type ContextualObservationArchivePartManifest = ContextualObservationArchivePartSummary & {
  recordType: 'contextual_observation_archive_part_manifest';
  schemaVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  sourceSnapshotDigest: string;
  archiveContentType: 'application/x-ndjson';
  archiveContentEncoding: 'gzip';
};

export type ContextualObservationArchiveCheckpoint = {
  recordType: 'contextual_observation_archive_checkpoint';
  schemaVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  sourceSnapshotDigest: string;
  sourceCursor: string | null;
  nextPartNumber: number;
  processedRowCount: number;
  emittedEdgeCount: number;
  insufficientEvidenceCount: number;
  parts: ContextualObservationArchivePartSummary[];
  sourcePages: ContextualObservationSourcePageReceipt[];
  status: 'processing' | 'complete';
  updatedAt: string;
  checkpointDigest: string;
};

export type ContextualObservationArchiveCompletionManifest = {
  recordType: 'contextual_observation_archive_completion_manifest';
  schemaVersion: typeof CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION;
  canonicalVersion: typeof CONTEXTUAL_EXPLANATION_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  sourceSnapshotDigest: string;
  sourcePageCount: number;
  sourcePageSetSha256: string;
  partCount: number;
  rowCount: number;
  emittedEdgeCount: number;
  insufficientEvidenceCount: number;
  parts: ContextualObservationArchivePartSummary[];
  archiveSetSha256: string;
  completedAt: string;
  manifestDigest: string;
};

export type ContextualObservationArchiveControlKeys = {
  prefix: string;
  governanceReceiptKey: string;
  sourceSnapshotKey: string;
  checkpointKey: string;
  completionManifestKey: string;
};

export type ContextualRelationshipRecordResolver = (
  address: string,
  recordDigest: string,
) => Promise<Buffer | string | RelationshipInputRecord | null>;

const canonicalBody = (value: unknown) => Buffer.from(`${canonicalizeContextualExplanation(value)}\n`, 'utf8');
const sha256 = (value: Buffer | string | unknown) => contextualExplanationSha256(value);

const sourceSnapshotWithoutDigest = (
  value: Omit<GovernedContextualSourceSnapshot, 'snapshotDigest'>,
) => value;

const SOURCE_FAMILY_BY_KIND: Readonly<Record<
  ContextualExplanationKind,
  GovernedContextualHistoricalSourceFamily
>> = Object.freeze({
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
});

export const buildGovernedContextualSourceSnapshot = (
  draft: GovernedContextualSourceSnapshotDraft,
): GovernedContextualSourceSnapshot => {
  assertPlainObject(draft, 'contextual_source_snapshot_invalid');
  exactKeys(draft, [
    'binding', 'kind', 'sourceFamily', 'sourceId', 'providerId', 'datasetVersion',
    'coverageWindow', 'materializedAt', 'contentSha256',
  ], 'contextual_source_snapshot_invalid');
  const binding = validateRelationshipInputBinding(draft.binding);
  if (!KINDS.includes(draft.kind)) invalid('contextual_source_snapshot_kind_invalid');
  if (draft.sourceFamily !== SOURCE_FAMILY_BY_KIND[draft.kind]) {
    invalid('contextual_source_snapshot_family_mismatch');
  }
  const coverageWindow = normalizeWindow(draft.coverageWindow, 'contextual_source_coverage_window_invalid');
  const materializedAt = requireTimestamp(draft.materializedAt, 'contextual_source_materialized_at_invalid');
  if (Date.parse(materializedAt) < Date.parse(coverageWindow.end)) {
    invalid('contextual_source_not_historical_snapshot');
  }
  const withoutDigest: Omit<GovernedContextualSourceSnapshot, 'snapshotDigest'> = {
    recordType: 'governed_contextual_source_snapshot',
    schemaVersion: GOVERNED_CONTEXTUAL_SOURCE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    captureMode: 'immutable_historical_snapshot',
    binding,
    kind: draft.kind,
    sourceFamily: draft.sourceFamily,
    sourceId: requireId(draft.sourceId, 'contextual_source_id_invalid'),
    providerId: requireId(draft.providerId, 'contextual_source_provider_invalid'),
    datasetVersion: requireId(draft.datasetVersion, 'contextual_source_dataset_version_invalid'),
    coverageWindow,
    materializedAt,
    contentSha256: requireSha(draft.contentSha256, 'contextual_source_content_digest_invalid'),
  };
  return {
    ...withoutDigest,
    snapshotDigest: sha256(sourceSnapshotWithoutDigest(withoutDigest)),
  };
};

export const decodeGovernedContextualSourceSnapshot = (
  input: Buffer | string | unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): GovernedContextualSourceSnapshot => {
  const value = parseInput(input, 'contextual_source_snapshot_json_invalid');
  assertPlainObject(value, 'contextual_source_snapshot_invalid');
  exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'captureMode', 'binding', 'kind', 'sourceFamily',
    'sourceId', 'providerId', 'datasetVersion', 'coverageWindow', 'materializedAt',
    'contentSha256', 'snapshotDigest',
  ], 'contextual_source_snapshot_invalid');
  if (value.recordType !== 'governed_contextual_source_snapshot'
    || value.schemaVersion !== GOVERNED_CONTEXTUAL_SOURCE_VERSION
    || value.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || value.captureMode !== 'immutable_historical_snapshot') invalid('contextual_source_snapshot_version_invalid');
  const rebuilt = buildGovernedContextualSourceSnapshot({
    binding: value.binding as RelationshipInputUniverseBinding,
    kind: value.kind as ContextualExplanationKind,
    sourceFamily: value.sourceFamily as GovernedContextualHistoricalSourceFamily,
    sourceId: value.sourceId as string,
    providerId: value.providerId as string,
    datasetVersion: value.datasetVersion as string,
    coverageWindow: value.coverageWindow as { start: string; end: string },
    materializedAt: value.materializedAt as string,
    contentSha256: value.contentSha256 as string,
  });
  if (expectedBinding) assertRelationshipInputBinding(rebuilt.binding, expectedBinding);
  if (value.snapshotDigest !== rebuilt.snapshotDigest
    || canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_source_snapshot_digest_mismatch');
  }
  return rebuilt;
};

const expandedBounds = (window: NonNullable<GovernedContextualObservationPayload['subjectObservation']['window']>) => ({
  start: Date.parse(window.start) - (window.precisionSeconds * 1_000),
  end: Date.parse(window.end) + (window.precisionSeconds * 1_000),
});

export const deriveContextualHistoricalTimeAlignment = (
  snapshotInput: GovernedContextualSourceSnapshot,
  payloadInput: GovernedContextualObservationPayload,
): ContextualHistoricalTimeAlignment => {
  const snapshot = decodeGovernedContextualSourceSnapshot(snapshotInput);
  const payload = decodeGovernedContextualObservationPayload(payloadInput);
  assertRelationshipInputBinding(payload.binding, snapshot.binding);
  if (payload.kind !== snapshot.kind) invalid('contextual_source_kind_mismatch');
  const subjectWindow = payload.subjectObservation.window;
  const referenceWindow = payload.referenceObservation.window;
  const missingFields: Array<'subject.window' | 'reference.window'> = [];
  if (!subjectWindow) missingFields.push('subject.window');
  if (!referenceWindow) missingFields.push('reference.window');
  if (missingFields.length) {
    return {
      status: 'unresolved_missing_time',
      coverageWindow: snapshot.coverageWindow,
      missingFields,
    };
  }
  const coverageStart = Date.parse(snapshot.coverageWindow.start);
  const coverageEnd = Date.parse(snapshot.coverageWindow.end);
  const subjectBounds = expandedBounds(subjectWindow as NonNullable<typeof subjectWindow>);
  const referenceBounds = expandedBounds(referenceWindow as NonNullable<typeof referenceWindow>);
  if (subjectBounds.start < coverageStart || subjectBounds.end > coverageEnd
    || referenceBounds.start < coverageStart || referenceBounds.end > coverageEnd) {
    invalid('contextual_source_historical_time_mismatch');
  }
  return {
    status: 'verified_historical_alignment',
    coverageWindow: snapshot.coverageWindow,
    subjectWindowSha256: sha256(subjectWindow),
    referenceWindowSha256: sha256(referenceWindow),
  };
};

const sourceRowWithoutDigest = (value: Omit<GovernedContextualSourceRow, 'rowDigest'>) => value;

export const buildGovernedContextualSourceRow = (params: {
  snapshot: GovernedContextualSourceSnapshot;
  relationshipRecord: Buffer | string | RelationshipInputRecord;
  payload: Buffer | string | GovernedContextualObservationPayload;
}): GovernedContextualSourceRow => {
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot);
  const relationshipRecord = decodeRelationshipInputRecord(params.relationshipRecord, snapshot.binding);
  const payload = decodeGovernedContextualObservationPayload(params.payload);
  assertRelationshipInputBinding(payload.binding, snapshot.binding);
  if (payload.address !== relationshipRecord.address || payload.kind !== snapshot.kind) {
    invalid('contextual_source_row_binding_mismatch');
  }
  const matchingContextSource = payload.provenance.some((source) => (
    source.role === 'context_reference'
    && source.providerId === snapshot.providerId
    && source.datasetVersion === snapshot.datasetVersion
    && Date.parse(source.retrievedAt) <= Date.parse(snapshot.materializedAt)
  ));
  if (!matchingContextSource) invalid('contextual_source_snapshot_provenance_mismatch');
  adaptContextualRelationship(relationshipRecord, payload, snapshot.binding);
  const timeAlignment = deriveContextualHistoricalTimeAlignment(snapshot, payload);
  const sortKey = `${payload.address}\u0000${payload.reference.referenceId}\u0000${payload.payloadDigest}`;
  const withoutDigest: Omit<GovernedContextualSourceRow, 'rowDigest'> = {
    recordType: 'governed_contextual_source_row',
    schemaVersion: GOVERNED_CONTEXTUAL_SOURCE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    snapshotDigest: snapshot.snapshotDigest,
    sortKey,
    relationshipRecord,
    payload,
    timeAlignment,
  };
  return { ...withoutDigest, rowDigest: sha256(sourceRowWithoutDigest(withoutDigest)) };
};

export const decodeGovernedContextualSourceRow = (
  input: unknown,
  snapshot: GovernedContextualSourceSnapshot,
): GovernedContextualSourceRow => {
  const value = parseInput(input, 'contextual_source_row_json_invalid');
  assertPlainObject(value, 'contextual_source_row_invalid');
  exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'snapshotDigest', 'sortKey',
    'relationshipRecord', 'payload', 'timeAlignment', 'rowDigest',
  ], 'contextual_source_row_invalid');
  if (value.recordType !== 'governed_contextual_source_row'
    || value.schemaVersion !== GOVERNED_CONTEXTUAL_SOURCE_VERSION
    || value.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || value.snapshotDigest !== snapshot.snapshotDigest) invalid('contextual_source_row_version_invalid');
  const rebuilt = buildGovernedContextualSourceRow({
    snapshot,
    relationshipRecord: value.relationshipRecord as RelationshipInputRecord,
    payload: value.payload as GovernedContextualObservationPayload,
  });
  if (value.rowDigest !== rebuilt.rowDigest
    || canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_source_row_digest_mismatch');
  }
  return rebuilt;
};

const pageWithoutDigest = (value: Omit<GovernedContextualSourcePage, 'pageDigest'>) => value;

export const buildGovernedContextualSourcePage = (params: {
  snapshot: GovernedContextualSourceSnapshot;
  cursor: string | null;
  nextCursor: string | null;
  rows: unknown[];
}): GovernedContextualSourcePage => {
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot);
  const cursor = requireCursor(params.cursor, 'contextual_source_page_cursor_invalid');
  const nextCursor = requireCursor(params.nextCursor, 'contextual_source_page_cursor_invalid');
  if (nextCursor !== null && nextCursor === cursor) invalid('contextual_source_page_cursor_not_advanced');
  if (!Array.isArray(params.rows) || params.rows.length > MAX_PAGE_SIZE) invalid('contextual_source_page_rows_invalid');
  const rows = params.rows.map((row) => decodeGovernedContextualSourceRow(row, snapshot))
    .sort((left, right) => lexical(left.sortKey, right.sortKey));
  if (!rows.length && nextCursor !== null) invalid('contextual_source_page_empty_nonterminal');
  if (new Set(rows.map((row) => row.rowDigest)).size !== rows.length) invalid('contextual_source_page_duplicate_row');
  const withoutDigest: Omit<GovernedContextualSourcePage, 'pageDigest'> = {
    recordType: 'governed_contextual_source_page',
    schemaVersion: GOVERNED_CONTEXTUAL_SOURCE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    snapshotDigest: snapshot.snapshotDigest,
    cursor,
    nextCursor,
    rows,
  };
  return { ...withoutDigest, pageDigest: sha256(pageWithoutDigest(withoutDigest)) };
};

export const decodeGovernedContextualSourcePage = (
  input: unknown,
  snapshot: GovernedContextualSourceSnapshot,
  expectedCursor: string | null,
): GovernedContextualSourcePage => {
  const value = parseInput(input, 'contextual_source_page_json_invalid');
  assertPlainObject(value, 'contextual_source_page_invalid');
  exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'snapshotDigest',
    'cursor', 'nextCursor', 'rows', 'pageDigest',
  ], 'contextual_source_page_invalid');
  if (!Array.isArray(value.rows)) invalid('contextual_source_page_invalid');
  const rebuilt = buildGovernedContextualSourcePage({
    snapshot,
    cursor: value.cursor as string | null,
    nextCursor: value.nextCursor as string | null,
    rows: value.rows,
  });
  if (rebuilt.cursor !== expectedCursor
    || value.pageDigest !== rebuilt.pageDigest
    || canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_source_page_digest_mismatch');
  }
  return rebuilt;
};

const archiveRecordWithoutDigest = (
  value: Omit<ContextualObservationArchiveRecord, 'recordDigest'>,
) => value;

export const buildContextualObservationArchiveRecord = (params: {
  snapshot: GovernedContextualSourceSnapshot;
  sourceRow: GovernedContextualSourceRow;
}): ContextualObservationArchiveRecord => {
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot);
  const sourceRow = decodeGovernedContextualSourceRow(params.sourceRow, snapshot);
  const result = adaptContextualRelationship(
    sourceRow.relationshipRecord,
    sourceRow.payload,
    snapshot.binding,
  );
  verifyContextualRelationshipAdapterResult(
    result,
    sourceRow.relationshipRecord,
    sourceRow.payload,
    snapshot.binding,
  );
  if (sourceRow.timeAlignment.status === 'unresolved_missing_time' && result.evaluation.edge) {
    invalid('contextual_archive_unresolved_time_edge_forbidden');
  }
  const withoutDigest: Omit<ContextualObservationArchiveRecord, 'recordDigest'> = {
    recordType: 'contextual_observation_archive_record',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding: snapshot.binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    sourceRowDigest: sourceRow.rowDigest,
    address: sourceRow.payload.address,
    relationshipRecordDigest: sourceRow.relationshipRecord.recordDigest,
    payload: sourceRow.payload,
    result,
    timeAlignment: sourceRow.timeAlignment,
  };
  return { ...withoutDigest, recordDigest: sha256(archiveRecordWithoutDigest(withoutDigest)) };
};

const validateArchivedResult = (
  result: ContextualRelationshipAdapterResult,
  payload: GovernedContextualObservationPayload,
  binding: RelationshipInputUniverseBinding,
  relationshipRecordDigest: string,
) => {
  assertPlainObject(result, 'contextual_archive_adapter_result_invalid');
  exactKeys(result, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'binding', 'address',
    'sourceRecordDigest', 'governedPayloadDigest', 'contextInputSha256', 'sourceFact',
    'evaluation', 'claimDiscipline', 'adapterReceiptSha256',
  ], 'contextual_archive_adapter_result_invalid');
  if (result.recordType !== 'contextual_relationship_adapter_result'
    || result.schemaVersion !== CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION
    || result.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || result.address !== payload.address
    || result.sourceRecordDigest !== relationshipRecordDigest
    || result.governedPayloadDigest !== payload.payloadDigest
    || result.contextInputSha256 !== payload.contextInputSha256) {
    invalid('contextual_archive_adapter_result_binding_mismatch');
  }
  assertRelationshipInputBinding(result.binding, binding);
  const { adapterReceiptSha256, ...withoutDigest } = result;
  if (adapterReceiptSha256 !== sha256(withoutDigest)) invalid('contextual_archive_adapter_result_digest_mismatch');
  const core = {
    kind: payload.kind,
    binding: payload.binding,
    address: payload.address,
    originBindings: payload.originBindings,
    reference: payload.reference,
    subjectObservation: payload.subjectObservation,
    referenceObservation: payload.referenceObservation,
    provenance: payload.provenance,
    domainEvidence: payload.domainEvidence,
    missingness: payload.missingness,
    model: payload.model,
  };
  const metrics = buildContextualRelationshipFactReceiptMetrics(core);
  if (result.sourceFact.factId !== payload.factId
    || result.sourceFact.predicate !== CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE
    || result.sourceFact.referenceId !== payload.reference.referenceId
    || canonicalizeContextualExplanation(result.sourceFact.metrics) !== canonicalizeContextualExplanation(metrics)) {
    invalid('contextual_archive_adapter_fact_receipt_mismatch');
  }
  const payloadOriginIds = [...new Set(payload.originBindings.map((item) => item.originId))].sort(lexical);
  if (canonicalizeContextualExplanation(result.sourceFact.originIds) !== canonicalizeContextualExplanation(payloadOriginIds)) {
    invalid('contextual_archive_adapter_origin_receipt_mismatch');
  }
  const evaluation = evaluateContextualExplanationCandidate({
    kind: payload.kind,
    subjectAddress: payload.address,
    reference: payload.reference,
    subjectObservation: payload.subjectObservation,
    referenceObservation: payload.referenceObservation,
    provenance: payload.provenance,
    domainEvidence: payload.domainEvidence,
    missingness: payload.missingness,
    uncertainty: result.sourceFact.uncertainty,
    model: payload.model,
  } as ContextualExplanationCandidateDraft);
  if (canonicalizeContextualExplanation(result.evaluation) !== canonicalizeContextualExplanation(evaluation)
    || canonicalizeContextualExplanation(result.claimDiscipline) !== canonicalizeContextualExplanation({
      source: RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
      output: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
    })) invalid('contextual_archive_adapter_evaluation_mismatch');
};

export const decodeContextualObservationArchiveRecord = (
  input: Buffer | string | unknown,
  snapshotInput: GovernedContextualSourceSnapshot,
): ContextualObservationArchiveRecord => {
  const snapshot = decodeGovernedContextualSourceSnapshot(snapshotInput);
  const value = parseInput(input, 'contextual_archive_record_json_invalid');
  assertPlainObject(value, 'contextual_archive_record_invalid');
  exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'binding', 'sourceSnapshotDigest',
    'sourceRowDigest', 'address', 'relationshipRecordDigest', 'payload', 'result',
    'timeAlignment', 'recordDigest',
  ], 'contextual_archive_record_invalid');
  if (value.recordType !== 'contextual_observation_archive_record'
    || value.schemaVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION
    || value.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || value.sourceSnapshotDigest !== snapshot.snapshotDigest) invalid('contextual_archive_record_version_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  assertRelationshipInputBinding(binding, snapshot.binding);
  const payload = decodeGovernedContextualObservationPayload(value.payload);
  assertRelationshipInputBinding(payload.binding, binding);
  const relationshipRecordDigest = requireSha(value.relationshipRecordDigest, 'contextual_archive_record_source_digest_invalid');
  const sourceRowDigest = requireSha(value.sourceRowDigest, 'contextual_archive_record_source_row_digest_invalid');
  const timeAlignment = deriveContextualHistoricalTimeAlignment(snapshot, payload);
  if (canonicalizeContextualExplanation(value.timeAlignment) !== canonicalizeContextualExplanation(timeAlignment)) {
    invalid('contextual_archive_time_alignment_mismatch');
  }
  validateArchivedResult(
    value.result as ContextualRelationshipAdapterResult,
    payload,
    binding,
    relationshipRecordDigest,
  );
  const withoutDigest: Omit<ContextualObservationArchiveRecord, 'recordDigest'> = {
    recordType: 'contextual_observation_archive_record',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    sourceRowDigest,
    address: payload.address,
    relationshipRecordDigest,
    payload,
    result: value.result as ContextualRelationshipAdapterResult,
    timeAlignment,
  };
  const rebuilt = { ...withoutDigest, recordDigest: sha256(archiveRecordWithoutDigest(withoutDigest)) };
  if (value.address !== payload.address
    || value.recordDigest !== rebuilt.recordDigest
    || canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_archive_record_digest_mismatch');
  }
  if (timeAlignment.status === 'unresolved_missing_time' && rebuilt.result.evaluation.edge) {
    invalid('contextual_archive_unresolved_time_edge_forbidden');
  }
  return rebuilt;
};

const encoded = (value: string) => encodeURIComponent(value);

export const getContextualObservationArchiveControlKeys = (
  snapshotInput: GovernedContextualSourceSnapshot,
): ContextualObservationArchiveControlKeys => {
  const snapshot = decodeGovernedContextualSourceSnapshot(snapshotInput);
  const prefix = [
    'case-vortex',
    'corpora',
    encoded(snapshot.binding.corpusVersion),
    CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    snapshot.binding.snapshotId,
    snapshot.binding.universeArchiveSetSha256,
    snapshot.kind,
    encoded(snapshot.sourceId),
    snapshot.snapshotDigest,
    '',
  ].join('/');
  return {
    prefix,
    governanceReceiptKey: `${prefix}source-governance.json`,
    sourceSnapshotKey: `${prefix}source-snapshot.json`,
    checkpointKey: `${prefix}checkpoint.json`,
    completionManifestKey: `${prefix}complete.manifest.json`,
  };
};

export const getContextualObservationArchivePartKeys = (
  snapshot: GovernedContextualSourceSnapshot,
  partNumber: number,
) => {
  if (!Number.isSafeInteger(partNumber) || partNumber < 0 || partNumber > 999_999) {
    invalid('contextual_archive_part_number_invalid');
  }
  const prefix = `${getContextualObservationArchiveControlKeys(snapshot).prefix}parts`;
  const part = String(partNumber).padStart(6, '0');
  return {
    archiveKey: `${prefix}/part-${part}.ndjson.gz`,
    manifestKey: `${prefix}/part-${part}.manifest.json`,
  };
};

const normalizePartSummary = (
  value: unknown,
  snapshot: GovernedContextualSourceSnapshot,
): ContextualObservationArchivePartSummary => {
  assertPlainObject(value, 'contextual_archive_part_summary_invalid');
  const partNumber = requireCount(value.partNumber, 'contextual_archive_part_summary_invalid');
  const keys = getContextualObservationArchivePartKeys(snapshot, partNumber);
  if (value.archiveKey !== keys.archiveKey || value.manifestKey !== keys.manifestKey) {
    invalid('contextual_archive_part_keys_invalid');
  }
  const rowCount = requireCount(value.rowCount, 'contextual_archive_part_summary_invalid', 1);
  const emittedEdgeCount = requireCount(value.emittedEdgeCount, 'contextual_archive_part_summary_invalid');
  const insufficientEvidenceCount = requireCount(value.insufficientEvidenceCount, 'contextual_archive_part_summary_invalid');
  if (emittedEdgeCount + insufficientEvidenceCount !== rowCount) invalid('contextual_archive_part_decision_count_invalid');
  const firstSortKey = typeof value.firstSortKey === 'string' ? value.firstSortKey : invalid('contextual_archive_part_sort_key_invalid');
  const lastSortKey = typeof value.lastSortKey === 'string' ? value.lastSortKey : invalid('contextual_archive_part_sort_key_invalid');
  if (!firstSortKey.length || lexical(firstSortKey, lastSortKey) > 0) invalid('contextual_archive_part_sort_key_invalid');
  return {
    partNumber,
    sourcePageNumber: requireCount(value.sourcePageNumber, 'contextual_archive_part_summary_invalid'),
    sourcePageDigest: requireSha(value.sourcePageDigest, 'contextual_archive_part_summary_invalid'),
    ...keys,
    rowCount,
    emittedEdgeCount,
    insufficientEvidenceCount,
    firstSortKey,
    lastSortKey,
    uncompressedBytes: requireCount(value.uncompressedBytes, 'contextual_archive_part_summary_invalid', 1),
    compressedBytes: requireCount(value.compressedBytes, 'contextual_archive_part_summary_invalid', 1),
    compressedSha256: requireSha(value.compressedSha256, 'contextual_archive_part_summary_invalid'),
    recordSetSha256: requireSha(value.recordSetSha256, 'contextual_archive_part_summary_invalid'),
  };
};

const assertPartSequence = (parts: ContextualObservationArchivePartSummary[]) => {
  parts.forEach((part, index) => {
    if (part.partNumber !== index) invalid('contextual_archive_checkpoint_part_sequence_invalid');
    if (index && lexical(parts[index - 1].lastSortKey, part.firstSortKey) >= 0) {
      invalid('contextual_archive_part_sort_overlap');
    }
  });
};

export const buildContextualObservationArchivePart = (params: {
  snapshot: GovernedContextualSourceSnapshot;
  partNumber: number;
  sourcePage: ContextualObservationSourcePageReceipt;
  records: ContextualObservationArchiveRecord[];
}) => {
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot);
  if (!params.records.length || params.records.length > MAX_PAGE_SIZE) invalid('contextual_archive_part_rows_invalid');
  const records = params.records.map((record) => decodeContextualObservationArchiveRecord(record, snapshot))
    .sort((left, right) => lexical(
      `${left.address}\u0000${left.payload.reference.referenceId}\u0000${left.payload.payloadDigest}`,
      `${right.address}\u0000${right.payload.reference.referenceId}\u0000${right.payload.payloadDigest}`,
    ));
  if (new Set(records.map((record) => record.recordDigest)).size !== records.length) {
    invalid('contextual_archive_part_duplicate_record');
  }
  const sortKeys = records.map((record) => (
    `${record.address}\u0000${record.payload.reference.referenceId}\u0000${record.payload.payloadDigest}`
  ));
  const body = Buffer.from(records.map((record) => `${canonicalizeContextualExplanation(record)}\n`).join(''), 'utf8');
  if (body.length > MAX_UNCOMPRESSED_PART_BYTES) invalid('contextual_archive_part_uncompressed_limit');
  const archiveBody = gzipSync(body, { level: 6 });
  if (archiveBody.length > MAX_COMPRESSED_PART_BYTES) invalid('contextual_archive_part_compressed_limit');
  const keys = getContextualObservationArchivePartKeys(snapshot, params.partNumber);
  const sourcePage = normalizeSourcePageReceipt(params.sourcePage);
  if (sourcePage.rowCount !== records.length) invalid('contextual_archive_part_source_page_count_mismatch');
  const emittedEdgeCount = records.filter((record) => Boolean(record.result.evaluation.edge)).length;
  const summary: ContextualObservationArchivePartSummary = {
    partNumber: params.partNumber,
    sourcePageNumber: sourcePage.pageNumber,
    sourcePageDigest: sourcePage.pageDigest,
    ...keys,
    rowCount: records.length,
    emittedEdgeCount,
    insufficientEvidenceCount: records.length - emittedEdgeCount,
    firstSortKey: sortKeys[0],
    lastSortKey: sortKeys[sortKeys.length - 1],
    uncompressedBytes: body.length,
    compressedBytes: archiveBody.length,
    compressedSha256: createHash('sha256').update(archiveBody).digest('hex'),
    recordSetSha256: sha256(records.map((record) => record.recordDigest).join('\n')),
  };
  const manifest: ContextualObservationArchivePartManifest = {
    recordType: 'contextual_observation_archive_part_manifest',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding: snapshot.binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    archiveContentType: 'application/x-ndjson',
    archiveContentEncoding: 'gzip',
    ...summary,
  };
  return { records, archiveBody, manifest, manifestBody: canonicalBody(manifest) };
};

export const decodeContextualObservationArchivePartManifest = (
  input: Buffer | string | unknown,
  snapshot: GovernedContextualSourceSnapshot,
): ContextualObservationArchivePartManifest => {
  const value = parseInput(input, 'contextual_archive_part_manifest_json_invalid');
  assertPlainObject(value, 'contextual_archive_part_manifest_invalid');
  if (value.recordType !== 'contextual_observation_archive_part_manifest'
    || value.schemaVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION
    || value.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || value.sourceSnapshotDigest !== snapshot.snapshotDigest
    || value.archiveContentType !== 'application/x-ndjson'
    || value.archiveContentEncoding !== 'gzip') invalid('contextual_archive_part_manifest_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  assertRelationshipInputBinding(binding, snapshot.binding);
  const rebuilt: ContextualObservationArchivePartManifest = {
    recordType: 'contextual_observation_archive_part_manifest',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    archiveContentType: 'application/x-ndjson',
    archiveContentEncoding: 'gzip',
    ...normalizePartSummary(value, snapshot),
  };
  if (canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_archive_part_manifest_noncanonical');
  }
  return rebuilt;
};

export const decodeContextualObservationArchivePart = (
  archiveBody: Buffer,
  manifestInput: Buffer | string | ContextualObservationArchivePartManifest,
  snapshot: GovernedContextualSourceSnapshot,
) => {
  const manifest = decodeContextualObservationArchivePartManifest(manifestInput, snapshot);
  if (archiveBody.length !== manifest.compressedBytes
    || createHash('sha256').update(archiveBody).digest('hex') !== manifest.compressedSha256) {
    invalid('contextual_archive_part_compressed_receipt_mismatch');
  }
  let body: Buffer;
  try {
    body = gunzipSync(archiveBody, { maxOutputLength: MAX_UNCOMPRESSED_PART_BYTES });
  } catch {
    return invalid('contextual_archive_part_gzip_invalid');
  }
  if (body.length !== manifest.uncompressedBytes || !body.length || body.at(-1) !== 0x0a) {
    invalid('contextual_archive_part_uncompressed_receipt_mismatch');
  }
  const lines = body.toString('utf8').slice(0, -1).split('\n');
  if (lines.length !== manifest.rowCount || lines.some((line) => !line.length)) {
    invalid('contextual_archive_part_row_count_mismatch');
  }
  const records = lines.map((line) => decodeContextualObservationArchiveRecord(line, snapshot));
  const rebuilt = buildContextualObservationArchivePart({
    snapshot,
    partNumber: manifest.partNumber,
    sourcePage: {
      pageNumber: manifest.sourcePageNumber,
      cursor: null,
      nextCursor: null,
      rowCount: manifest.rowCount,
      pageDigest: manifest.sourcePageDigest,
    },
    records,
  });
  if (canonicalizeContextualExplanation(rebuilt.manifest) !== canonicalizeContextualExplanation(manifest)) {
    invalid('contextual_archive_part_manifest_receipt_mismatch');
  }
  return { records, manifest };
};

const archiveSetSha256 = (parts: ContextualObservationArchivePartSummary[]) => sha256(
  parts.map((part) => `${part.partNumber}:${part.sourcePageNumber}:${part.sourcePageDigest}:${part.compressedSha256}:${part.recordSetSha256}`).join('\n'),
);

const normalizeSourcePageReceipt = (value: unknown): ContextualObservationSourcePageReceipt => {
  assertPlainObject(value, 'contextual_archive_source_page_receipt_invalid');
  exactKeys(value, ['pageNumber', 'cursor', 'nextCursor', 'rowCount', 'pageDigest'], 'contextual_archive_source_page_receipt_invalid');
  return {
    pageNumber: requireCount(value.pageNumber, 'contextual_archive_source_page_receipt_invalid'),
    cursor: requireCursor(value.cursor, 'contextual_archive_source_page_receipt_invalid'),
    nextCursor: requireCursor(value.nextCursor, 'contextual_archive_source_page_receipt_invalid'),
    rowCount: requireCount(value.rowCount, 'contextual_archive_source_page_receipt_invalid'),
    pageDigest: requireSha(value.pageDigest, 'contextual_archive_source_page_receipt_invalid'),
  };
};

const sourcePageSetSha256 = (pages: ContextualObservationSourcePageReceipt[]) => sha256(
  pages.map((page) => `${page.pageNumber}:${JSON.stringify(page.cursor)}:${JSON.stringify(page.nextCursor)}:${page.rowCount}:${page.pageDigest}`).join('\n'),
);

const checkpointWithoutDigest = (
  value: Omit<ContextualObservationArchiveCheckpoint, 'checkpointDigest'>,
) => value;

const buildCheckpoint = (params: Omit<ContextualObservationArchiveCheckpoint, 'recordType' | 'schemaVersion' | 'canonicalVersion' | 'checkpointDigest'>) => {
  const withoutDigest: Omit<ContextualObservationArchiveCheckpoint, 'checkpointDigest'> = {
    recordType: 'contextual_observation_archive_checkpoint',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    ...params,
  };
  return { ...withoutDigest, checkpointDigest: sha256(checkpointWithoutDigest(withoutDigest)) };
};

const decodeCheckpoint = (
  input: Buffer | string | unknown,
  snapshot: GovernedContextualSourceSnapshot,
): ContextualObservationArchiveCheckpoint => {
  const value = parseInput(input, 'contextual_archive_checkpoint_json_invalid');
  assertPlainObject(value, 'contextual_archive_checkpoint_invalid');
  if (value.recordType !== 'contextual_observation_archive_checkpoint'
    || value.schemaVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION
    || value.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || value.sourceSnapshotDigest !== snapshot.snapshotDigest
    || !Array.isArray(value.parts)
    || !Array.isArray(value.sourcePages)
    || !['processing', 'complete'].includes(String(value.status))) invalid('contextual_archive_checkpoint_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  assertRelationshipInputBinding(binding, snapshot.binding);
  const parts = value.parts.map((part) => normalizePartSummary(part, snapshot))
    .sort((left, right) => left.partNumber - right.partNumber);
  assertPartSequence(parts);
  const sourcePages = value.sourcePages.map(normalizeSourcePageReceipt)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const seenCursors = new Set<string>();
  sourcePages.forEach((page, index) => {
    if (page.pageNumber !== index) invalid('contextual_archive_source_page_sequence_invalid');
    const expectedCursor = index ? sourcePages[index - 1].nextCursor : null;
    if (page.cursor !== expectedCursor) invalid('contextual_archive_source_cursor_chain_invalid');
    const cursorIdentity = JSON.stringify(page.cursor);
    if (seenCursors.has(cursorIdentity)) invalid('contextual_archive_source_cursor_cycle');
    seenCursors.add(cursorIdentity);
    if (page.nextCursor !== null && page.nextCursor === page.cursor) invalid('contextual_archive_source_cursor_cycle');
  });
  const processedRowCount = requireCount(value.processedRowCount, 'contextual_archive_checkpoint_invalid');
  const emittedEdgeCount = requireCount(value.emittedEdgeCount, 'contextual_archive_checkpoint_invalid');
  const insufficientEvidenceCount = requireCount(value.insufficientEvidenceCount, 'contextual_archive_checkpoint_invalid');
  if (parts.reduce((sum, part) => sum + part.rowCount, 0) !== processedRowCount
    || parts.reduce((sum, part) => sum + part.emittedEdgeCount, 0) !== emittedEdgeCount
    || parts.reduce((sum, part) => sum + part.insufficientEvidenceCount, 0) !== insufficientEvidenceCount
    || emittedEdgeCount + insufficientEvidenceCount !== processedRowCount) {
    invalid('contextual_archive_checkpoint_accounting_invalid');
  }
  const nonemptyPages = sourcePages.filter((page) => page.rowCount > 0);
  if (nonemptyPages.length !== parts.length || parts.some((part, index) => (
    part.sourcePageNumber !== nonemptyPages[index].pageNumber
    || part.sourcePageDigest !== nonemptyPages[index].pageDigest
    || part.rowCount !== nonemptyPages[index].rowCount
  ))) invalid('contextual_archive_checkpoint_source_page_mismatch');
  const status = value.status as 'processing' | 'complete';
  const sourceCursor = requireCursor(value.sourceCursor, 'contextual_archive_checkpoint_cursor_invalid');
  if (!sourcePages.length) {
    if (status === 'complete' || sourceCursor !== null) invalid('contextual_archive_source_cursor_chain_invalid');
  } else {
    const lastNextCursor = sourcePages[sourcePages.length - 1].nextCursor;
    if ((status === 'complete' && lastNextCursor !== null)
      || (status === 'processing' && (lastNextCursor === null || sourceCursor !== lastNextCursor))) {
      invalid('contextual_archive_source_cursor_chain_invalid');
    }
  }
  const rebuilt = buildCheckpoint({
    binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    sourceCursor,
    nextPartNumber: requireCount(value.nextPartNumber, 'contextual_archive_checkpoint_invalid'),
    processedRowCount,
    emittedEdgeCount,
    insufficientEvidenceCount,
    parts,
    sourcePages,
    status,
    updatedAt: requireTimestamp(value.updatedAt, 'contextual_archive_checkpoint_updated_at_invalid'),
  });
  if (rebuilt.nextPartNumber !== parts.length
    || value.checkpointDigest !== rebuilt.checkpointDigest
    || canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_archive_checkpoint_digest_mismatch');
  }
  return rebuilt;
};

const completionWithoutDigest = (
  value: Omit<ContextualObservationArchiveCompletionManifest, 'manifestDigest'>,
) => value;

const buildCompletion = (
  checkpoint: ContextualObservationArchiveCheckpoint,
  completedAt: string,
): ContextualObservationArchiveCompletionManifest => {
  if (checkpoint.status !== 'complete') invalid('contextual_archive_completion_checkpoint_invalid');
  const withoutDigest: Omit<ContextualObservationArchiveCompletionManifest, 'manifestDigest'> = {
    recordType: 'contextual_observation_archive_completion_manifest',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding: checkpoint.binding,
    sourceSnapshotDigest: checkpoint.sourceSnapshotDigest,
    sourcePageCount: checkpoint.sourcePages.length,
    sourcePageSetSha256: sourcePageSetSha256(checkpoint.sourcePages),
    partCount: checkpoint.parts.length,
    rowCount: checkpoint.processedRowCount,
    emittedEdgeCount: checkpoint.emittedEdgeCount,
    insufficientEvidenceCount: checkpoint.insufficientEvidenceCount,
    parts: checkpoint.parts,
    archiveSetSha256: archiveSetSha256(checkpoint.parts),
    completedAt: requireTimestamp(completedAt, 'contextual_archive_completed_at_invalid'),
  };
  return { ...withoutDigest, manifestDigest: sha256(completionWithoutDigest(withoutDigest)) };
};

export const buildEmptyContextualObservationArchiveCompletionManifest = (params: {
  snapshot: GovernedContextualSourceSnapshot;
  completedAt: string;
}): ContextualObservationArchiveCompletionManifest => {
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot);
  const withoutDigest: Omit<ContextualObservationArchiveCompletionManifest, 'manifestDigest'> = {
    recordType: 'contextual_observation_archive_completion_manifest',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding: snapshot.binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    sourcePageCount: 0,
    sourcePageSetSha256: sourcePageSetSha256([]),
    partCount: 0,
    rowCount: 0,
    emittedEdgeCount: 0,
    insufficientEvidenceCount: 0,
    parts: [],
    archiveSetSha256: archiveSetSha256([]),
    completedAt: requireTimestamp(params.completedAt, 'contextual_archive_completed_at_invalid'),
  };
  return { ...withoutDigest, manifestDigest: sha256(completionWithoutDigest(withoutDigest)) };
};

export const decodeContextualObservationArchiveCompletionManifest = (
  input: Buffer | string | unknown,
  snapshotInput: GovernedContextualSourceSnapshot,
): ContextualObservationArchiveCompletionManifest => {
  const snapshot = decodeGovernedContextualSourceSnapshot(snapshotInput);
  const value = parseInput(input, 'contextual_archive_completion_json_invalid');
  assertPlainObject(value, 'contextual_archive_completion_invalid');
  exactKeys(value, [
    'recordType', 'schemaVersion', 'canonicalVersion', 'binding', 'sourceSnapshotDigest',
    'sourcePageCount', 'sourcePageSetSha256', 'partCount', 'rowCount', 'emittedEdgeCount',
    'insufficientEvidenceCount', 'parts', 'archiveSetSha256', 'completedAt', 'manifestDigest',
  ], 'contextual_archive_completion_invalid');
  if (value.recordType !== 'contextual_observation_archive_completion_manifest'
    || value.schemaVersion !== CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION
    || value.canonicalVersion !== CONTEXTUAL_EXPLANATION_CANONICAL_VERSION
    || value.sourceSnapshotDigest !== snapshot.snapshotDigest
    || !Array.isArray(value.parts)) invalid('contextual_archive_completion_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  assertRelationshipInputBinding(binding, snapshot.binding);
  const parts = value.parts.map((part) => normalizePartSummary(part, snapshot))
    .sort((left, right) => left.partNumber - right.partNumber);
  assertPartSequence(parts);
  const sourcePageCount = requireCount(value.sourcePageCount, 'contextual_archive_completion_invalid');
  const sourcePageSetDigest = requireSha(value.sourcePageSetSha256, 'contextual_archive_completion_invalid');
  const partCount = requireCount(value.partCount, 'contextual_archive_completion_invalid');
  const rowCount = requireCount(value.rowCount, 'contextual_archive_completion_invalid');
  const emittedEdgeCount = requireCount(value.emittedEdgeCount, 'contextual_archive_completion_invalid');
  const insufficientEvidenceCount = requireCount(value.insufficientEvidenceCount, 'contextual_archive_completion_invalid');
  if (partCount !== parts.length
    || rowCount !== parts.reduce((sum, part) => sum + part.rowCount, 0)
    || emittedEdgeCount !== parts.reduce((sum, part) => sum + part.emittedEdgeCount, 0)
    || insufficientEvidenceCount !== parts.reduce((sum, part) => sum + part.insufficientEvidenceCount, 0)
    || emittedEdgeCount + insufficientEvidenceCount !== rowCount
    || (rowCount === 0 && (sourcePageCount !== 0 || sourcePageSetDigest !== sourcePageSetSha256([])))
    || (rowCount > 0 && sourcePageCount < parts.length)
    || value.archiveSetSha256 !== archiveSetSha256(parts)) {
    invalid('contextual_archive_completion_accounting_invalid');
  }
  const withoutDigest: Omit<ContextualObservationArchiveCompletionManifest, 'manifestDigest'> = {
    recordType: 'contextual_observation_archive_completion_manifest',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    sourcePageCount,
    sourcePageSetSha256: sourcePageSetDigest,
    partCount,
    rowCount,
    emittedEdgeCount,
    insufficientEvidenceCount,
    parts,
    archiveSetSha256: value.archiveSetSha256 as string,
    completedAt: requireTimestamp(value.completedAt, 'contextual_archive_completed_at_invalid'),
  };
  const rebuilt: ContextualObservationArchiveCompletionManifest = {
    ...withoutDigest,
    manifestDigest: sha256(completionWithoutDigest(withoutDigest)),
  };
  if (value.manifestDigest !== rebuilt.manifestDigest
    || canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_archive_completion_digest_mismatch');
  }
  return rebuilt;
};

const decodeCompletion = (
  input: Buffer | string | unknown,
  checkpoint: ContextualObservationArchiveCheckpoint,
) => {
  const value = parseInput(input, 'contextual_archive_completion_json_invalid');
  assertPlainObject(value, 'contextual_archive_completion_invalid');
  const rebuilt = buildCompletion(checkpoint, value.completedAt as string);
  if (canonicalizeContextualExplanation(value) !== canonicalizeContextualExplanation(rebuilt)) {
    invalid('contextual_archive_completion_digest_mismatch');
  }
  return rebuilt;
};

const requireConditionalStorage = (storage: CaseGraphArchiveStorage): CaseGraphConditionalArchiveStorage => {
  const candidate = storage as Partial<CaseGraphConditionalArchiveStorage>;
  if (typeof candidate.readObjectVersioned !== 'function'
    || typeof candidate.uploadFileConditional !== 'function') {
    invalid('contextual_archive_conditional_storage_required');
  }
  return storage as CaseGraphConditionalArchiveStorage;
};

const immutableOptions = (body: Buffer, contentType = 'application/json', contentEncoding?: string): UploadOptions => ({
  contentType,
  ...(contentEncoding ? { contentEncoding } : {}),
  cacheControl: 'private, max-age=31536000, immutable',
  contentLength: body.length,
});

const checkpointOptions = (body: Buffer): UploadOptions => ({
  contentType: 'application/json',
  cacheControl: 'private, no-store',
  contentLength: body.length,
});

const readVersioned = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
): Promise<CaseGraphVersionedArchiveObject | null> => {
  const object = await storage.readObjectVersioned(key);
  if (object && (!Buffer.isBuffer(object.body) || !String(object.version || '').length)) {
    invalid(`contextual_archive_object_version_invalid:${key}`);
  }
  return object;
};

const putImmutable = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  key: string;
  body: Buffer;
  options: UploadOptions;
  conflictCode: string;
}) => {
  let error: unknown = null;
  try {
    await params.storage.uploadFileConditional(params.body, params.key, params.options, { ifAbsent: true });
  } catch (caught) {
    error = caught;
  }
  const current = await readVersioned(params.storage, params.key);
  if (current?.body.equals(params.body)) return current;
  if (current) invalid(`${params.conflictCode}:${params.key}`);
  if (error) throw error;
  invalid(`contextual_archive_immutable_write_failed:${params.key}`);
};

const putCheckpoint = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  key: string;
  body: Buffer;
  priorVersion: string | null;
}) => {
  let error: unknown = null;
  try {
    await params.storage.uploadFileConditional(
      params.body,
      params.key,
      checkpointOptions(params.body),
      params.priorVersion === null ? { ifAbsent: true } : { ifVersion: params.priorVersion },
    );
  } catch (caught) {
    error = caught;
  }
  const current = await readVersioned(params.storage, params.key);
  if (current?.body.equals(params.body)) return current;
  if (current) invalid('contextual_archive_checkpoint_compare_and_swap_conflict');
  if (error) throw error;
  invalid('contextual_archive_checkpoint_write_failed');
};

const verifyStoredParts = async (
  storage: CaseGraphConditionalArchiveStorage,
  snapshot: GovernedContextualSourceSnapshot,
  parts: ContextualObservationArchivePartSummary[],
) => {
  for (const part of parts) {
    const archiveBody = await storage.readObject(part.archiveKey);
    const manifestBody = await storage.readObject(part.manifestKey);
    if (!archiveBody || !manifestBody) invalid(`contextual_archive_part_missing:${part.partNumber}`);
    const decoded = decodeContextualObservationArchivePart(archiveBody, manifestBody, snapshot);
    if (canonicalizeContextualExplanation(decoded.manifest) !== canonicalizeContextualExplanation({
      recordType: 'contextual_observation_archive_part_manifest',
      schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
      canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
      binding: snapshot.binding,
      sourceSnapshotDigest: snapshot.snapshotDigest,
      archiveContentType: 'application/x-ndjson',
      archiveContentEncoding: 'gzip',
      ...part,
    })) invalid(`contextual_archive_part_summary_mismatch:${part.partNumber}`);
  }
};

const normalizeNow = (now: () => string) => requireTimestamp(now(), 'contextual_archive_now_invalid');

export const archiveGovernedContextualObservations = async (params: {
  storage: CaseGraphArchiveStorage;
  source: GovernedContextualObservationSource;
  expectedBinding: RelationshipInputUniverseBinding;
  governance: {
    decisionPacket: ContextualSourceGovernanceDecisionPacket;
    canonicalSource: string;
  };
  pageSize?: number;
  now: () => string;
}) => {
  const storage = requireConditionalStorage(params.storage);
  const binding = validateRelationshipInputBinding(params.expectedBinding);
  const snapshot = decodeGovernedContextualSourceSnapshot(await params.source.inspectSnapshot(), binding);
  const governanceReceipt = buildContextualObservationArchiveGovernanceReceipt({
    packet: params.governance.decisionPacket,
    snapshot,
    canonicalSource: params.governance.canonicalSource,
    authorizedAt: normalizeNow(params.now),
  });
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    invalid('contextual_archive_page_size_invalid');
  }
  const keys = getContextualObservationArchiveControlKeys(snapshot);
  await putImmutable({
    storage,
    key: keys.governanceReceiptKey,
    body: canonicalBody(governanceReceipt),
    options: immutableOptions(canonicalBody(governanceReceipt)),
    conflictCode: 'contextual_archive_governance_receipt_conflict',
  });
  await putImmutable({
    storage,
    key: keys.sourceSnapshotKey,
    body: canonicalBody(snapshot),
    options: immutableOptions(canonicalBody(snapshot)),
    conflictCode: 'contextual_archive_source_snapshot_conflict',
  });

  let checkpointObject = await readVersioned(storage, keys.checkpointKey);
  let checkpoint: ContextualObservationArchiveCheckpoint;
  let resumed = Boolean(checkpointObject);
  if (!checkpointObject) {
    checkpoint = buildCheckpoint({
      binding,
      sourceSnapshotDigest: snapshot.snapshotDigest,
      sourceCursor: null,
      nextPartNumber: 0,
      processedRowCount: 0,
      emittedEdgeCount: 0,
      insufficientEvidenceCount: 0,
      parts: [],
      sourcePages: [],
      status: 'processing',
      updatedAt: normalizeNow(params.now),
    });
    checkpointObject = await putCheckpoint({
      storage,
      key: keys.checkpointKey,
      body: canonicalBody(checkpoint),
      priorVersion: null,
    });
  } else {
    checkpoint = decodeCheckpoint(checkpointObject.body, snapshot);
    await verifyStoredParts(storage, snapshot, checkpoint.parts);
  }

  if (!checkpoint) checkpoint = decodeCheckpoint(checkpointObject.body, snapshot);
  if (checkpoint.status === 'complete') {
    let completionBody = await storage.readObject(keys.completionManifestKey);
    if (!completionBody) {
      const recoveredCompletion = buildCompletion(checkpoint, normalizeNow(params.now));
      completionBody = canonicalBody(recoveredCompletion);
      await putImmutable({
        storage,
        key: keys.completionManifestKey,
        body: completionBody,
        options: immutableOptions(completionBody),
        conflictCode: 'contextual_archive_completion_conflict',
      });
    }
    return {
      status: 'resumed' as const,
      snapshot,
      checkpoint,
      governanceReceipt,
      completion: decodeCompletion(completionBody, checkpoint),
    };
  }

  while (checkpoint.status === 'processing') {
    if (checkpoint.sourcePages.some((receipt) => receipt.cursor === checkpoint.sourceCursor)) {
      invalid('contextual_archive_source_cursor_cycle');
    }
    const page = decodeGovernedContextualSourcePage(await params.source.fetchPage({
      snapshot,
      cursor: checkpoint.sourceCursor,
      limit: pageSize,
    }), snapshot, checkpoint.sourceCursor);
    if (page.nextCursor !== null
      && checkpoint.sourcePages.some((receipt) => receipt.cursor === page.nextCursor)) {
      invalid('contextual_archive_source_cursor_cycle');
    }
    let nextParts = checkpoint.parts;
    let processedRowCount = checkpoint.processedRowCount;
    let emittedEdgeCount = checkpoint.emittedEdgeCount;
    let insufficientEvidenceCount = checkpoint.insufficientEvidenceCount;
    const sourcePageReceipt: ContextualObservationSourcePageReceipt = {
      pageNumber: checkpoint.sourcePages.length,
      cursor: page.cursor,
      nextCursor: page.nextCursor,
      rowCount: page.rows.length,
      pageDigest: page.pageDigest,
    };

    if (page.rows.length) {
      const records = page.rows.map((sourceRow) => buildContextualObservationArchiveRecord({ snapshot, sourceRow }));
      const part = buildContextualObservationArchivePart({
        snapshot,
        partNumber: checkpoint.nextPartNumber,
        sourcePage: sourcePageReceipt,
        records,
      });
      await putImmutable({
        storage,
        key: part.manifest.manifestKey,
        body: part.manifestBody,
        options: immutableOptions(part.manifestBody),
        conflictCode: 'contextual_archive_part_manifest_conflict',
      });
      await putImmutable({
        storage,
        key: part.manifest.archiveKey,
        body: part.archiveBody,
        options: immutableOptions(part.archiveBody, 'application/x-ndjson', 'gzip'),
        conflictCode: 'contextual_archive_part_conflict',
      });
      nextParts = [...checkpoint.parts, normalizePartSummary(part.manifest, snapshot)];
      assertPartSequence(nextParts);
      processedRowCount += part.manifest.rowCount;
      emittedEdgeCount += part.manifest.emittedEdgeCount;
      insufficientEvidenceCount += part.manifest.insufficientEvidenceCount;
    }

    const status = page.nextCursor === null ? 'complete' as const : 'processing' as const;
    const nextCheckpoint = buildCheckpoint({
      binding,
      sourceSnapshotDigest: snapshot.snapshotDigest,
      sourceCursor: page.nextCursor,
      nextPartNumber: nextParts.length,
      processedRowCount,
      emittedEdgeCount,
      insufficientEvidenceCount,
      parts: nextParts,
      sourcePages: [...checkpoint.sourcePages, sourcePageReceipt],
      status,
      updatedAt: normalizeNow(params.now),
    });
    checkpointObject = await putCheckpoint({
      storage,
      key: keys.checkpointKey,
      body: canonicalBody(nextCheckpoint),
      priorVersion: checkpointObject.version,
    });
    checkpoint = nextCheckpoint;
  }

  const completion = buildCompletion(checkpoint, normalizeNow(params.now));
  const completionBody = canonicalBody(completion);
  await putImmutable({
    storage,
    key: keys.completionManifestKey,
    body: completionBody,
    options: immutableOptions(completionBody),
    conflictCode: 'contextual_archive_completion_conflict',
  });
  return {
    status: resumed ? 'resumed' as const : 'completed' as const,
    snapshot,
    governanceReceipt,
    checkpoint,
    completion,
  };
};

export const readVerifiedContextualObservationArchive = async (params: {
  storage: CaseGraphArchiveStorage;
  snapshot: GovernedContextualSourceSnapshot;
  expectedBinding: RelationshipInputUniverseBinding;
  governance: {
    decisionPacket: ContextualSourceGovernanceDecisionPacket;
    canonicalSource: string;
  };
  resolveRelationshipRecord: ContextualRelationshipRecordResolver;
  onRecord?: (record: ContextualObservationArchiveRecord) => void | Promise<void>;
}) => {
  const storage = requireConditionalStorage(params.storage);
  const binding = validateRelationshipInputBinding(params.expectedBinding);
  const snapshot = decodeGovernedContextualSourceSnapshot(params.snapshot, binding);
  const keys = getContextualObservationArchiveControlKeys(snapshot);
  const governanceReceiptBody = await storage.readObject(keys.governanceReceiptKey);
  const storedSnapshot = await storage.readObject(keys.sourceSnapshotKey);
  const checkpointBody = await storage.readObject(keys.checkpointKey);
  const completionBody = await storage.readObject(keys.completionManifestKey);
  if (!governanceReceiptBody || !storedSnapshot || !checkpointBody || !completionBody) {
    invalid('contextual_archive_incomplete');
  }
  let governanceReceiptValue: unknown;
  try {
    governanceReceiptValue = JSON.parse(governanceReceiptBody.toString('utf8'));
  } catch {
    invalid('contextual_archive_governance_receipt_invalid');
  }
  const governanceReceipt: ContextualObservationArchiveGovernanceReceipt =
    verifyContextualObservationArchiveGovernanceReceipt({
      value: governanceReceiptValue,
      packet: params.governance.decisionPacket,
      snapshot,
      canonicalSource: params.governance.canonicalSource,
    });
  const decodedStoredSnapshot = decodeGovernedContextualSourceSnapshot(storedSnapshot, binding);
  if (canonicalizeContextualExplanation(decodedStoredSnapshot)
    !== canonicalizeContextualExplanation(snapshot)) {
    invalid('contextual_archive_stored_source_snapshot_mismatch');
  }
  const checkpoint = decodeCheckpoint(checkpointBody, snapshot);
  if (checkpoint.status !== 'complete') invalid('contextual_archive_incomplete');
  const completion = decodeCompletion(completionBody, checkpoint);
  let verifiedRowCount = 0;
  for (const part of checkpoint.parts) {
    const archiveBody = await storage.readObject(part.archiveKey);
    const manifestBody = await storage.readObject(part.manifestKey);
    if (!archiveBody || !manifestBody) invalid(`contextual_archive_part_missing:${part.partNumber}`);
    const decoded = decodeContextualObservationArchivePart(archiveBody, manifestBody, snapshot);
    for (const record of decoded.records) {
      const relationshipRecordInput = await params.resolveRelationshipRecord(
        record.address,
        record.relationshipRecordDigest,
      );
      if (!relationshipRecordInput) invalid(`contextual_archive_relationship_record_missing:${record.address}`);
      const relationshipRecord = decodeRelationshipInputRecord(relationshipRecordInput, binding);
      if (relationshipRecord.recordDigest !== record.relationshipRecordDigest) {
        invalid(`contextual_archive_relationship_record_digest_mismatch:${record.address}`);
      }
      const sourceRow = buildGovernedContextualSourceRow({
        snapshot,
        relationshipRecord,
        payload: record.payload,
      });
      if (sourceRow.rowDigest !== record.sourceRowDigest) {
        invalid(`contextual_archive_source_row_digest_mismatch:${record.address}`);
      }
      verifyContextualRelationshipAdapterResult(
        record.result,
        relationshipRecord,
        record.payload,
        binding,
      );
      await params.onRecord?.(record);
      verifiedRowCount += 1;
    }
  }
  if (verifiedRowCount !== completion.rowCount) invalid('contextual_archive_verified_row_count_mismatch');
  return { snapshot, governanceReceipt, checkpoint, completion, verifiedRowCount };
};
