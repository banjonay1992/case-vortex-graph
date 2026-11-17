import type {
  RelationshipInputRecord,
  RelationshipInputUniverseBinding,
} from "./relationshipInputSnapshot";
import {
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  type TypedRelationshipEdge,
  type TypedRelationshipEdgeType,
  type TypedRelationshipPairEvaluation,
} from "./typedRelationshipEngine";

export const FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION =
  "full-corpus-typed-relationship-pipeline-v2" as const;

export const FULL_CORPUS_TYPED_EDGE_TYPES = [
  "duplicate_provenance",
  "provenance",
  "space_time_candidate",
  "shared_visual",
  "shared_behavioural",
  "shared_sensory",
  "similar_duration",
  "shared_entity",
  "shared_site",
  "shared_narrative_pattern",
  "source_independence",
  "source_dependency",
  "contextual_explanation_candidate",
] as const satisfies readonly TypedRelationshipEdgeType[];

export const FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE = Object.freeze(
  {
    semantics:
      "candidate_generation_and_bounded_evidence_relationships_not_causality",
    skippedGroupSemantics: "explicitly_unresolved_not_negative_evidence",
    notice:
      "Candidate routes and typed edges describe bounded evidence relationships. A skipped or isolated record is not evidence for or against an event, explanation, or extraordinary origin.",
  } as const,
);

export const FULL_CORPUS_ADDRESS_KINDS = [
  "sighting",
  "document",
  "photo",
  "video",
] as const;

export type FullCorpusAddressKind = (typeof FULL_CORPUS_ADDRESS_KINDS)[number];

export type FullCorpusPostingKind =
  | "address_identity"
  | "source_identity"
  | "source_record"
  | "source_lineage"
  | "duplicate_cluster"
  | "matchable_value"
  | "space_time"
  | "duration";

export type FullCorpusCandidateReasonCode =
  | "explicit_cross_reference"
  | "same_source"
  | "governed_source_assertion"
  | "same_source_record"
  | "same_source_lineage"
  | "same_duplicate_cluster"
  | "shared_matchable_value"
  | "nearby_space_time_bucket"
  | "similar_duration_bucket";

export type FullCorpusPipelineLineage = {
  binding: RelationshipInputUniverseBinding;
  pipelineVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  relationshipInputManifestDigest: string;
  relationshipInputArchiveSetSha256: string;
  relationshipInputRecordSetSha256: string;
  rarityIndexDigest: string;
  typedRelationshipSchemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
  typedRelationshipRarityVersion: typeof TYPED_RELATIONSHIP_RARITY_VERSION;
  typedRelationshipPolicyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
  typedRelationshipPolicySha256: string;
  typedRelationshipModel: typeof TYPED_RELATIONSHIP_MODEL;
  typedRelationshipModelSha256: string;
};

export type FullCorpusSpaceTimeHome = {
  time: number;
  x: number;
  y: number;
  z: number;
};

export type FullCorpusRelationshipPosting = {
  signature: string;
  routeKind: FullCorpusPostingKind;
  recordIndex: number;
  reasonCode: FullCorpusCandidateReasonCode | null;
  routeToken: string;
  evidenceIds: string[];
  targetAddress: string | null;
  targetSourceId: string | null;
  spaceTimeHome: FullCorpusSpaceTimeHome | null;
  durationHome: number | null;
};

export type FullCorpusPostingFragment = {
  recordType: "full_corpus_relationship_posting_fragment";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  inputPartNumber: number;
  postingShard: number;
  postingShardCount: number;
  records: RelationshipInputRecord[];
  postings: FullCorpusRelationshipPosting[];
  fragmentDigest: string;
};

export type FullCorpusPostingFragmentSummary = {
  inputPartNumber: number;
  postingShard: number;
  recordReplicaCount: number;
  postingCount: number;
  identityCount: number;
  fragmentDigest: string;
};

export type FullCorpusPostingMapManifest = {
  recordType: "full_corpus_relationship_posting_map_manifest";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  postingShardCount: number;
  inputPartCount: number;
  universeRecordCount: number;
  addressKindCounts: Record<FullCorpusAddressKind, number>;
  postingCount: number;
  fragmentCount: number;
  fragments: FullCorpusPostingFragmentSummary[];
  fragmentSetSha256: string;
  mapDigest: string;
};

export type FullCorpusCandidateReason = {
  reasonId: string;
  code: FullCorpusCandidateReasonCode;
  routeSignature: string;
  evidenceIds: string[];
  plainEnglish: string;
};

export type FullCorpusSkippedGroupReceipt = {
  recordType: "full_corpus_skipped_group_receipt";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  receiptId: string;
  lineage: FullCorpusPipelineLineage;
  postingShard: number;
  routeKind: FullCorpusPostingKind;
  routeSignature: string;
  postingCount: number;
  distinctAddressCount: number;
  estimatedPairCount: number;
  configuredPostingCap: number;
  configuredPairCap: number;
  reasonCode: "high_frequency_group_skipped" | "direct_target_missing";
  plainEnglish: string;
  claimDiscipline: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE;
};

export type FullCorpusCandidateRoute = {
  pairKey: string;
  leftRecordIndex: number;
  rightRecordIndex: number;
  reasons: FullCorpusCandidateReason[];
};

export type FullCorpusCandidateFragment = {
  recordType: "full_corpus_relationship_candidate_fragment";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  postingMapDigest: string;
  sourcePostingShard: number;
  pairShard: number;
  pairShardCount: number;
  records: RelationshipInputRecord[];
  candidates: FullCorpusCandidateRoute[];
  fragmentDigest: string;
};

export type FullCorpusPresenceRecord = {
  address: string;
  recordDigest: string;
  kind: FullCorpusAddressKind;
};

export type FullCorpusPostingShardReduction = {
  recordType: "full_corpus_relationship_posting_shard_reduction";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  postingMapDigest: string;
  postingShard: number;
  postingShardCount: number;
  pairShardCount: number;
  inputFragmentCount: number;
  postingCount: number;
  postingGroupCount: number;
  candidatePairCount: number;
  candidateRouteCount: number;
  presenceRecords: FullCorpusPresenceRecord[];
  skippedGroups: FullCorpusSkippedGroupReceipt[];
  candidateFragments: FullCorpusCandidateFragment[];
  reductionDigest: string;
};

export type FullCorpusPairReducerResult = {
  recordType: "full_corpus_relationship_pair_reducer_result";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  postingMapDigest: string;
  pairShard: number;
  pairShardCount: number;
  candidateFragmentSetSha256: string;
  candidatePairCount: number;
  evaluatedAddressCount: number;
  typedEdgeCount: number;
  rejectedCandidateCount: number;
  evaluations: TypedRelationshipPairEvaluation[];
  edges: TypedRelationshipEdge[];
  resultDigest: string;
};

export type FullCorpusAddressState = FullCorpusPresenceRecord & {
  status: "linked" | "candidate_only" | "isolated";
};

export type FullCorpusContextualCompletionReference = {
  completionId: string;
  completionDigest: string;
  artifactDigest: string;
  sourceCompletionSetSha256: string;
  entrySetSha256: string;
  calibrationReceiptId: string;
  calibrationReceiptSha256: string;
  sourceSnapshotCount: number;
  sourceRecordCount: number;
  acceptedEdgeCount: number;
  insufficientEvidenceCount: number;
  zeroObservationState: boolean;
};

export type FullCorpusAddressLedgerShard = {
  shard: number;
  shardCount: number;
  states: FullCorpusAddressState[];
  stateCount: number;
  linkedCount: number;
  candidateOnlyCount: number;
  isolatedCount: number;
  stateSetSha256: string;
};

export type FullCorpusRelationshipCompletion = {
  recordType: "full_corpus_relationship_completion";
  schemaVersion: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION;
  lineage: FullCorpusPipelineLineage;
  postingMapDigest: string;
  contextualCompletion: FullCorpusContextualCompletionReference;
  postingShardCount: number;
  pairShardCount: number;
  universeRecordCount: number;
  addressKindCounts: Record<FullCorpusAddressKind, number>;
  candidatePairCount: number;
  evaluatedAddressCount: number;
  linkedAddressCount: number;
  candidateOnlyAddressCount: number;
  isolatedAddressCount: number;
  typedEdgeCount: number;
  typedEdgeTypeCounts: Record<TypedRelationshipEdgeType, number>;
  skippedGroupCount: number;
  skippedEstimatedPairCount: number;
  postingReductionSetSha256: string;
  pairReducerSetSha256: string;
  evaluationSetSha256: string;
  edgeSetSha256: string;
  skippedGroupSetSha256: string;
  addressLedgerShards: FullCorpusAddressLedgerShard[];
  addressLedgerSetSha256: string;
  claimDiscipline: typeof FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE;
  plainEnglish: string;
  completionDigest: string;
};

export type FullCorpusPostingCaps = {
  addressIdentity: number;
  sourceIdentity: number;
  sourceRecord: number;
  sourceLineage: number;
  duplicateCluster: number;
  matchableValue: number;
  spaceTime: number;
  duration: number;
  maxPairsPerGroup: number;
  maxCandidatePairsPerPostingShard: number;
};

export const DEFAULT_FULL_CORPUS_POSTING_CAPS: FullCorpusPostingCaps =
  Object.freeze({
    addressIdentity: 10_000,
    sourceIdentity: 500,
    sourceRecord: 100,
    sourceLineage: 250,
    duplicateCluster: 500,
    matchableValue: 250,
    spaceTime: 300,
    duration: 300,
    maxPairsPerGroup: 50_000,
    maxCandidatePairsPerPostingShard: 1_000_000,
  });
