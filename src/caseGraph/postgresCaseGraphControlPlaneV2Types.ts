import type { CaseGraphFeatureCompletionManifest } from './archiveTypes';
import type { CaseVortexCorpusAccountingReceipt } from './corpusAccounting';
import type { EvidenceUniverseNodeKind } from './evidenceUniverse';
import type { EvidenceUniverseCompletion } from './evidenceUniverseArchive';
import type {
  CaseGraphPublicManifest,
} from './publicationManifest';
import type {
  CaseGraphPublicationCandidateCompletion,
} from './publicationArchive';
import type {
  CaseGraphPublicationCalibrationSetReceipt,
} from './publicationCalibrationSet';
import type {
  ContextualRelationshipCalibrationArtifact,
  ContextualRelationshipCalibrationReceipt,
  ContextualRelationshipCalibrationTrustPolicy,
} from './contextualRelationshipCalibration';
import type { ContextualRelationshipCompletionArtifact } from './contextualRelationshipCompletion';
import type { RelationshipInputSnapshotManifest } from './relationshipInputArchive';
import type {
  TypedRelationshipCalibrationArtifact,
  TypedRelationshipCalibrationReceipt,
  TypedRelationshipCalibrationTrustPolicy,
} from './typedRelationshipCalibration';
import type { TypedRelationshipEdgeType } from './typedRelationshipEngine';
import type { FullCorpusRelationshipCompletion } from './typedRelationshipPipeline';
import type {
  FullCorpusRelationshipArchiveReceipt,
  FullCorpusRelationshipRunIndex,
  FullCorpusRelationshipRunIndexPointer,
} from './typedRelationshipPipelineArchive';

export type PostgresCaseGraphV2QueryResult = {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
};

/** A transaction-pinned client; a pool-level `query` function is not sufficient. */
export type PostgresCaseGraphV2TransactionClient = {
  query: (sql: string, params?: unknown[]) => Promise<PostgresCaseGraphV2QueryResult>;
};

/**
 * Deliberately narrow database capability. The host owns connection pooling and
 * supplies a transaction callback pinned to one PostgreSQL connection.
 */
export type PostgresCaseGraphV2QueryClient = PostgresCaseGraphV2TransactionClient & {
  transaction: <T>(
    work: (transaction: PostgresCaseGraphV2TransactionClient) => Promise<T>,
  ) => Promise<T>;
};

export const NODE_KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];

export type KindCounts = Record<EvidenceUniverseNodeKind, number>;
export type RelationshipStatus = 'linked' | 'candidate_only' | 'isolated';
export type RelationshipStatusCounts = Record<RelationshipStatus, number>;
export type RelationshipAccounting = {
  universe_record_count: number;
  address_kind_counts: KindCounts;
  candidate_pair_count: number;
  typed_edge_count: number;
  typed_edge_type_counts: Record<TypedRelationshipEdgeType, number>;
  skipped_group_count: number;
  skipped_estimated_pair_count: number;
  relationship_status_counts: RelationshipStatusCounts;
  address_ledger_set_sha256: string;
};

export const LINEAGE_BRAND: unique symbol = Symbol('case-graph-v2-lineage-receipts');

export type CaseGraphV2LineageReceipts = {
  readonly [LINEAGE_BRAND]: true;
  readonly completion: Readonly<CaseGraphPublicationCandidateCompletion>;
  readonly universe: Readonly<EvidenceUniverseCompletion>;
  readonly features: Readonly<CaseGraphFeatureCompletionManifest>;
  readonly relationshipInput: Readonly<RelationshipInputSnapshotManifest>;
  readonly relationshipCompletion: Readonly<FullCorpusRelationshipCompletion>;
  readonly relationshipRunIndex: Readonly<FullCorpusRelationshipRunIndex>;
  readonly relationshipRunIndexReceipt: Readonly<FullCorpusRelationshipArchiveReceipt>;
  readonly relationshipRunIndexPointer: Readonly<FullCorpusRelationshipRunIndexPointer>;
  readonly contextualCompletion: Readonly<ContextualRelationshipCompletionArtifact>;
  readonly calibrationSet: Readonly<CaseGraphPublicationCalibrationSetReceipt>;
  readonly pairCalibration: Readonly<TypedRelationshipCalibrationReceipt>;
  readonly contextualCalibration: Readonly<ContextualRelationshipCalibrationReceipt>;
  readonly pairCalibrationArtifact: Readonly<TypedRelationshipCalibrationArtifact>;
  readonly pairCalibrationTrustPolicy: Readonly<TypedRelationshipCalibrationTrustPolicy>;
  readonly contextualCalibrationArtifact: Readonly<ContextualRelationshipCalibrationArtifact>;
  readonly contextualCalibrationTrustPolicy: Readonly<ContextualRelationshipCalibrationTrustPolicy>;
  readonly manifest: Readonly<CaseGraphPublicManifest>;
  readonly accounting: Readonly<CaseVortexCorpusAccountingReceipt>;
  readonly publicManifestSha256: string;
  readonly accountingReceiptSha256: string;
  readonly publicationCompletionSha256: string;
};

export type CaseGraphV2Run = {
  runId: string;
  corpusVersion: string;
  snapshotId: string;
  universeRecordCount: number;
  completionManifestKey: string;
  completionManifestSha256: string;
  status: 'completed';
};

export type CaseGraphV2RecordLedgerInsertResult = {
  runId: string;
  corpusVersion: string;
  recordCount: number;
  byKind: KindCounts;
  batchCount: number;
};

export type CaseGraphV2IncrementalJob = {
  id: string;
  planId: string;
  planSha256: string;
  planArtifactKey: string;
  watermarkId: string;
  targetCorpusVersion: string;
  targetUniverseArchiveSetSha256: string;
  targetRelationshipInputSetSha256: string;
  sourceDiffReceiptSha256: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  batchId: string;
  batchOrdinal: number;
  changeId: string;
  changeOrdinal: number;
  address: string;
  entityKind: EvidenceUniverseNodeKind;
  entityId: string;
  action: 'insert' | 'update' | 'delete';
  inputSha256: string;
  status: 'queued' | 'leased' | 'completed' | 'failed';
  attemptCount: number;
  nextAttemptAt: string;
  leaseToken: string | null;
  leasedUntil: string | null;
  errorCode: string | null;
};

export type CaseGraphV2PublicationCandidate = {
  publicationId: string;
  runId: string;
  corpusVersion: string;
  publicManifestKey: string;
  publicManifestSha256: string;
};

/** Result status for an idempotent candidate-registration attempt. */
export type CaseGraphV2PublicationCandidateRegistration = CaseGraphV2PublicationCandidate & {
  registrationStatus: 'created' | 'already_exists';
};

export type CaseGraphV2ActivePublication = CaseGraphV2PublicationCandidate & {
  activatedAt: string;
  rollbackOfPublicationId: string | null;
  accountingReceiptSha256: string;
  snapshotId: string;
  universeRecordCount: number;
  completionManifestKey: string;
  completionManifestSha256: string;
};
