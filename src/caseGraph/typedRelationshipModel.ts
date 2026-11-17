import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type { ContextualExplanationReceipt } from './contextualExplanation';
import type {
  RelationshipInputFact,
  RelationshipInputFactFamily,
  RelationshipInputPrecision,
  RelationshipInputUncertaintyLevel,
  RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const TYPED_RELATIONSHIP_SCHEMA_VERSION = 'case-graph-typed-relationship-v2' as const;
export const TYPED_RELATIONSHIP_POLICY_VERSION = 'case-graph-conservative-relationship-policy-v2' as const;
export const TYPED_RELATIONSHIP_RARITY_VERSION = 'case-graph-relationship-rarity-v2' as const;
export const TYPED_RELATIONSHIP_MODEL_ID = 'case-graph-deterministic-typed-relationship-engine' as const;
export const TYPED_RELATIONSHIP_MODEL_VERSION = '2.0.0' as const;
export const TYPED_RELATIONSHIP_MODEL = Object.freeze({
  modelId: TYPED_RELATIONSHIP_MODEL_ID,
  modelVersion: TYPED_RELATIONSHIP_MODEL_VERSION,
  method: 'deterministic_rules',
} as const);
export const TYPED_RELATIONSHIP_MODEL_SHA256 = relationshipInputSha256(TYPED_RELATIONSHIP_MODEL);

export const TYPED_RELATIONSHIP_CLAIM_DISCIPLINE = Object.freeze({
  semantics: 'candidate_evidence_relationship_not_causality',
  extraordinaryOrigin: 'not_assessed',
  notice: 'This edge records a bounded evidence relationship. It does not establish causation, truth, corroboration unless source independence is separately evidenced, or ordinary or extraordinary origin.',
} as const);

export const TYPED_RELATIONSHIP_POLICY = Object.freeze({
  minimumFactQuality: 0.5,
  minimumEffectiveRarity: 0.5,
  minimumCrossFamilySupportRarity: 0.45,
  minimumSpaceTimeSupportRarity: 0.55,
  minimumSingleGovernedRarity: 0.55,
  minimumSingleCrossFamilyRarity: 0.65,
  maximumSpaceTimeUpperSeconds: 21_600,
  maximumSpaceTimeUpperKilometres: 100,
  ultraTightSpaceTimeUpperSeconds: 900,
  ultraTightSpaceTimeUpperKilometres: 10,
  minimumDurationSimilarity: 0.85,
  maximumDurationRelativePrecision: 0.25,
  minimumInformativeDurationSeconds: 5,
  independentRequiresReciprocalAssertions: true,
  narrativeSimilarityAloneMayEmit: false,
  missingOrNegatedFactsMayEmit: false,
} as const);

export const TYPED_RELATIONSHIP_POLICY_SHA256 = relationshipInputSha256(TYPED_RELATIONSHIP_POLICY);

export const MATCHABLE_FAMILIES = [
  'visual', 'behavioural', 'sensory', 'entity', 'site', 'narrative_pattern',
] as const;

export const TYPED_RELATIONSHIP_PAIR_EDGE_TYPES = [
  'duplicate_provenance', 'provenance', 'space_time_candidate', 'shared_visual',
  'shared_behavioural', 'shared_sensory', 'similar_duration', 'shared_entity',
  'shared_site', 'shared_narrative_pattern', 'source_independence', 'source_dependency',
] as const;

export const TYPED_RELATIONSHIP_EDGE_TYPES = [
  ...TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  'contextual_explanation_candidate',
] as const;

export type MatchableFamily = typeof MATCHABLE_FAMILIES[number];
export type TypedRelationshipEdgeType = typeof TYPED_RELATIONSHIP_EDGE_TYPES[number];

export type TypedRelationshipEndpoint =
  | { kind: 'evidence'; id: string }
  | { kind: 'context'; id: string };

export type TypedRelationshipDependency = {
  classification: 'independent' | 'dependent' | 'unknown';
  reasons: Array<{
    code:
      | 'reciprocal_governed_assertions' | 'same_source' | 'same_source_record'
      | 'same_lineage' | 'duplicate_lineage' | 'explicit_record_dependency'
      | 'governed_dependent_assertion' | 'conflicting_source_assertions'
      | 'dependency_risk_not_low_enough' | 'insufficient_independence_evidence';
    evidenceIds: string[];
    plainEnglish: string;
  }>;
};

export type TypedRelationshipFactEvidence = {
  address: string;
  factId: string;
  family: RelationshipInputFactFamily;
  predicate: string;
  valueKey: string;
  confidence: number;
  uncertainty: RelationshipInputFact['uncertainty'];
  precision: RelationshipInputPrecision;
  originIds: string[];
};

export type TypedRelationshipRarityEntry = {
  valueKey: string;
  family: MatchableFamily;
  valueId: string;
  registryVersion: string;
  documentFrequency: number;
  eligibleRecordCount: number;
  corpusRecordCount: number;
  rawRarity: number;
  coverage: number;
  effectiveRarity: number;
};

export type TypedRelationshipRarityIndex = {
  recordType: 'typed_relationship_rarity_index';
  schemaVersion: typeof TYPED_RELATIONSHIP_RARITY_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  recordSetSha256: string;
  eligibleRecordCounts: Record<MatchableFamily, number>;
  entries: TypedRelationshipRarityEntry[];
  indexDigest: string;
};

export type TypedRelationshipReason = {
  code: string;
  family: RelationshipInputFactFamily | 'source_independence' | 'source_dependency';
  plainEnglish: string;
  evidenceIds: string[];
  metrics: Record<string, string | number | boolean | null>;
};

export type TypedRelationshipCheck = {
  code: string;
  status: 'pass';
  actual: string | number | boolean;
  operator: 'equal' | 'greater_than_or_equal' | 'less_than_or_equal';
  threshold: string | number | boolean;
};

export type TypedRelationshipMissingnessReceipt = {
  address: string;
  family: RelationshipInputFactFamily;
  factId: string | null;
  status: 'unknown' | 'not_recorded' | 'not_applicable' | 'withheld';
  reasons: string[];
};

export type TypedRelationshipReceipt = {
  recordType: 'typed_relationship_receipt';
  schemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  receiptId: string;
  edgeType: TypedRelationshipEdgeType;
  inputRecordDigests: string[];
  rarityIndexDigest: string | null;
  policyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
  policySha256: string;
  model: typeof TYPED_RELATIONSHIP_MODEL;
  reasons: TypedRelationshipReason[];
  checks: TypedRelationshipCheck[];
  factEvidence: TypedRelationshipFactEvidence[];
  rarity: TypedRelationshipRarityEntry[];
  missingness: TypedRelationshipMissingnessReceipt[];
  uncertainty: { level: RelationshipInputUncertaintyLevel; reasons: string[] };
  dependency: TypedRelationshipDependency;
  contextualEvaluation: ContextualExplanationReceipt | null;
  claimDiscipline: typeof TYPED_RELATIONSHIP_CLAIM_DISCIPLINE;
  plainEnglish: string;
};

export type TypedRelationshipEdge = {
  recordType: 'typed_relationship_edge';
  schemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  edgeId: string;
  binding: RelationshipInputUniverseBinding;
  edgeType: TypedRelationshipEdgeType;
  endpoints: [TypedRelationshipEndpoint, TypedRelationshipEndpoint];
  strength: number;
  receipt: TypedRelationshipReceipt;
};

export type TypedRelationshipPairRejection = {
  edgeType: typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number];
  reasonCodes: string[];
};

export type TypedRelationshipPairEvaluation = {
  recordType: 'typed_relationship_pair_evaluation';
  schemaVersion: typeof TYPED_RELATIONSHIP_SCHEMA_VERSION;
  canonicalVersion: typeof RELATIONSHIP_INPUT_CANONICAL_VERSION;
  binding: RelationshipInputUniverseBinding;
  addresses: [string, string];
  inputRecordDigests: [string, string];
  rarityIndexDigest: string;
  policyVersion: typeof TYPED_RELATIONSHIP_POLICY_VERSION;
  policySha256: string;
  model: typeof TYPED_RELATIONSHIP_MODEL;
  dependency: TypedRelationshipDependency;
  edges: TypedRelationshipEdge[];
  rejections: TypedRelationshipPairRejection[];
  evaluationDigest: string;
};

export type MatchableFact = RelationshipInputFact & {
  family: MatchableFamily;
  value: NonNullable<RelationshipInputFact['value']>;
};

export type SharedMatch = {
  family: MatchableFamily;
  valueKey: string;
  valueId: string;
  registryVersion: string;
  quality: number;
  left: MatchableFact;
  right: MatchableFact;
  rarity: TypedRelationshipRarityEntry;
};
