import {
  CONTEXTUAL_EXPLANATION_POLICY,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
  type ContextualExplanationCandidateDraft,
  type ContextualProvenanceDraft,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES,
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  buildContextualRelationshipCalibrationArtifact,
  buildContextualRelationshipCalibrationAuditPlan,
  buildContextualRelationshipCalibrationLineage,
  buildContextualRelationshipCalibrationReviewReceipt,
  buildContextualRelationshipCalibrationTrustPolicy,
  contextualRelationshipCalibrationReviewSetSha256,
  decodeContextualRelationshipCalibrationArtifact,
  decodeContextualRelationshipCalibrationReceipt,
  decodeContextualRelationshipCalibrationTrustPolicy,
  getContextualRelationshipCalibrationSampleId,
  serializeContextualRelationshipCalibrationReceipt,
  serializeContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationLabelDraft,
  type ContextualRelationshipCalibrationTrustPolicy,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT,
  CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION,
  buildCalibrationArtifactsFromHumanReview,
  buildCalibrationHumanReviewAdjudication,
  buildCalibrationHumanReviewPack,
  buildCalibrationHumanReviewerSubmission,
  finalizeCalibrationHumanReview,
  type CalibrationHumanReviewBundle,
} from '../../src/caseGraph/calibrationHumanReview';
import { CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION } from '../../src/caseGraph/contextualObservationArchive';
import {
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  buildRelationshipInputRecord,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputRecordDraft,
  type RelationshipInputSourceAssertionDraft,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  TYPED_RELATIONSHIP_POLICY,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  buildTypedRelationshipRarityIndex,
  evaluateTypedRelationshipPair,
  type TypedRelationshipRarityIndex,
} from '../../src/caseGraph/typedRelationshipEngine';
import {
  TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
  TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES,
  assertTypedRelationshipCalibrationReceiptProductionEligible,
  buildTypedRelationshipCalibrationArtifact,
  buildTypedRelationshipCalibrationAuditPlan,
  buildTypedRelationshipCalibrationReviewReceipt,
  buildTypedRelationshipCalibrationTrustPolicy,
  decodeTypedRelationshipCalibrationArtifact,
  decodeTypedRelationshipCalibrationReceipt,
  decodeTypedRelationshipCalibrationTrustPolicy,
  serializeTypedRelationshipCalibrationReceipt,
  serializeTypedRelationshipCalibrationArtifact,
  typedRelationshipCalibrationReviewSetSha256,
  type TypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationLabelDraft,
  type TypedRelationshipCalibrationLineage,
  type TypedRelationshipCalibrationTrustPolicy,
} from '../../src/caseGraph/typedRelationshipCalibration';

/**
 * The pair calibration contract needs five disjoint 21-record cohorts. Callers
 * may supply a larger binding; all remaining records are deterministic fillers
 * so the real rarity-index completeness check still runs over the full binding.
 */
export const FULL_PRODUCTION_CALIBRATION_MINIMUM_UNIVERSE_RECORD_COUNT = 105;

/**
 * These artifacts deliberately have the same shape as production-eligible
 * human-review artifacts so publication wiring can be tested. They are locally
 * generated and MUST NOT be treated as human-review or release evidence.
 */
export const FULL_PRODUCTION_CALIBRATION_FIXTURE_USE =
  'local_structural_test_fixture_only_not_human_review_or_release_evidence' as const;

/**
 * This fixture exercises the complete sealed-review derivation contract, but
 * its decisions are copied from deterministic structural labels by code. It
 * must never be represented as evidence that people performed the review.
 */
export const FULL_PRODUCTION_CALIBRATION_HUMAN_REVIEW_FIXTURE_USE =
  'simulated_human_review_contract_fixture_only_never_publication_evidence' as const;

type CanonicalCalibrationBundle<Artifact, TrustPolicy, Receipt> = {
  artifact: Artifact;
  artifactBody: Buffer;
  trustPolicy: TrustPolicy;
  trustPolicyBody: Buffer;
  receipt: Receipt;
  receiptBody: Buffer;
};

export type FullProductionCalibrationPairRelationshipInput = {
  fixtureUse: typeof FULL_PRODUCTION_CALIBRATION_FIXTURE_USE;
  binding: RelationshipInputUniverseBinding;
  records: RelationshipInputRecord[];
  rarityIndex: TypedRelationshipRarityIndex;
  archiveSetSha256: string;
  manifestDigest: string;
  recordSetSha256: string;
  rarityIndexDigest: string;
};

export type FullProductionCalibrationPairLineageMaterial = Pick<
  FullProductionCalibrationPairRelationshipInput,
  'fixtureUse' | 'binding' | 'records' | 'rarityIndex' | 'recordSetSha256' | 'rarityIndexDigest'
>;

export type FullProductionCalibrationTestFixtureOptions = {
  /**
   * Called after the real full-binding records and rarity index exist but before
   * the calibration artifact is built. A publication fixture can materialize
   * those exact records into its relationship-input archive and return that
   * archive's real identities here.
   */
  resolvePairRelationshipInputLineage?: (
    material: FullProductionCalibrationPairLineageMaterial,
  ) => { archiveSetSha256: string; manifestDigest: string };
};

export type FullProductionCalibrationTestFixture = {
  fixtureUse: typeof FULL_PRODUCTION_CALIBRATION_FIXTURE_USE;
  binding: RelationshipInputUniverseBinding;
  pair: CanonicalCalibrationBundle<
    TypedRelationshipCalibrationArtifact,
    TypedRelationshipCalibrationTrustPolicy,
    TypedRelationshipCalibrationArtifact['receipt']
  > & {
    relationshipInput: FullProductionCalibrationPairRelationshipInput;
    relationshipInputRecords: RelationshipInputRecord[];
    rarityIndex: TypedRelationshipRarityIndex;
  };
  contextual: CanonicalCalibrationBundle<
    ContextualRelationshipCalibrationArtifact,
    ContextualRelationshipCalibrationTrustPolicy,
    ContextualRelationshipCalibrationArtifact['receipt']
  >;
};

export type FullProductionCalibrationTestFixtureBodies = {
  fixtureUse: typeof FULL_PRODUCTION_CALIBRATION_FIXTURE_USE;
  binding: RelationshipInputUniverseBinding;
  pair: {
    artifactBody: Buffer | string;
    trustPolicyBody: Buffer | string;
    receiptBody: Buffer | string;
    relationshipInput: FullProductionCalibrationPairRelationshipInput;
  };
  contextual: {
    artifactBody: Buffer | string;
    trustPolicyBody: Buffer | string;
    receiptBody: Buffer | string;
  };
};

export type FullProductionCalibrationHumanReviewTestFixture = {
  fixtureUse: typeof FULL_PRODUCTION_CALIBRATION_HUMAN_REVIEW_FIXTURE_USE;
  binding: RelationshipInputUniverseBinding;
  bundle: CalibrationHumanReviewBundle;
  bundleBody: Buffer;
  pair: CanonicalCalibrationBundle<
    TypedRelationshipCalibrationArtifact,
    TypedRelationshipCalibrationTrustPolicy,
    TypedRelationshipCalibrationArtifact['receipt']
  >;
  contextual: CanonicalCalibrationBundle<
    ContextualRelationshipCalibrationArtifact,
    ContextualRelationshipCalibrationTrustPolicy,
    ContextualRelationshipCalibrationArtifact['receipt']
  >;
};

const PAIRS_PER_COHORT = 200;
const CONTEXT_KINDS = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;
const sha = (value: unknown) => relationshipInputSha256(value);
const contextSha = (value: unknown) => contextualExplanationSha256(value);
const recordAddress = (index: number) => {
  if (index === 103) return 'document:official-record-2';
  if (index === 104) return 'photo:archive-photo-3';
  if (index === 105) return 'video:witness-video-4';
  return `sighting:00000000-0000-4000-8000-${String(index - 1).padStart(12, '0')}`;
};

const asBuffer = (value: Buffer | string) => Buffer.isBuffer(value)
  ? Buffer.from(value)
  : Buffer.from(value, 'utf8');

const parseJsonBody = (value: Buffer | string, code: string): unknown => {
  try {
    return JSON.parse(asBuffer(value).toString('utf8'));
  } catch {
    throw new Error(code);
  }
};

const requireExactBody = (supplied: Buffer | string, canonical: Buffer, code: string) => {
  if (!asBuffer(supplied).equals(canonical)) throw new Error(code);
};

const origin = (address: string, sourceField: string): RelationshipInputOriginDraft => ({
  sourceAddress: address,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'full-production-calibration-test-fixture-v1' },
});

const termFact = (
  family: 'visual' | 'behavioural' | 'sensory',
  termId: string,
  address: string,
): RelationshipInputFactDraft => ({
  family,
  predicate: `observed_${family}`,
  value: { kind: 'term', termId, vocabularyVersion: `${family}-v2` },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['reviewed_fixture'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, `${family}.${termId}`)],
});

const governedFact = (
  family: 'entity' | 'site',
  governedId: string,
  address: string,
): RelationshipInputFactDraft => ({
  family,
  predicate: family === 'entity' ? 'mentions_entity' : 'mentions_site',
  value: { kind: 'governed_reference', governedId, registryVersion: `${family}-registry-v2` },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['registry_reviewed'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-registry-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, `${family}.${governedId}`)],
});

const narrativeFact = (patternId: string, address: string): RelationshipInputFactDraft => ({
  family: 'narrative_pattern',
  predicate: 'governed_narrative_pattern',
  value: { kind: 'narrative_pattern', patternId, registryVersion: 'narrative-registry-v2' },
  confidence: 0.96,
  uncertainty: { level: 'low', reasons: ['pattern_reviewed'] },
  precision: { kind: 'categorical', vocabularyVersion: 'narrative-registry-v2' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, `narrative.${patternId}`)],
});

const timestampFact = (address: string): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_timestamp',
  value: { kind: 'timestamp', timestamp: '2026-07-18T10:00:00.000Z', datePrecision: 'exact' },
  confidence: 0.99,
  uncertainty: { level: 'low', reasons: ['clock_rounding'] },
  precision: { kind: 'exact' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'event.timestamp')],
});

const locationFact = (address: string): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_location',
  value: { kind: 'geo_point', lat: 51.5, lon: -0.1, spatialPrecisionKm: 1 },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['coordinate_rounding'] },
  precision: { kind: 'approximate', unit: 'km', tolerance: 1 },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'event.location')],
});

const durationFact = (address: string): RelationshipInputFactDraft => ({
  family: 'duration',
  predicate: 'observed_duration',
  value: { kind: 'duration', seconds: 60 },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['witness_rounding'] },
  precision: { kind: 'approximate', unit: 'seconds', tolerance: 1 },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'event.duration')],
});

const duplicateProvenanceFact = (address: string): RelationshipInputFactDraft => ({
  family: 'provenance',
  predicate: 'duplicate_cluster_membership',
  value: {
    kind: 'provenance',
    code: 'duplicate_cluster',
    referenceId: 'duplicate:full-production-calibration-fixture',
  },
  confidence: 1,
  uncertainty: { level: 'none', reasons: [] },
  precision: { kind: 'exact' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'duplicate.cluster')],
});

const allPairs = (indices: readonly number[]) => {
  const pairs: Array<[number, number]> = [];
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      pairs.push([indices[left], indices[right]]);
    }
  }
  return pairs;
};

const cohort = (start: number) => Array.from({ length: 21 }, (_, offset) => start + offset);

const buildPairCalibration = (
  binding: RelationshipInputUniverseBinding,
  options: FullProductionCalibrationTestFixtureOptions,
): FullProductionCalibrationTestFixture['pair'] => {
  const categorical = cohort(1);
  const spaceTime = cohort(22);
  const duplicate = cohort(43);
  const provenance = cohort(64);
  const hardNegative = cohort(85);
  const categoricalPairs = allPairs(categorical).slice(0, PAIRS_PER_COHORT);
  const spaceTimePairs = allPairs(spaceTime).slice(0, PAIRS_PER_COHORT);
  const duplicatePairs = allPairs(duplicate).slice(0, PAIRS_PER_COHORT);
  const provenancePairs = allPairs(provenance).slice(0, PAIRS_PER_COHORT);
  const hardNegativePairs = allPairs(hardNegative);
  const facts = new Map<number, RelationshipInputFactDraft[]>();
  const assertions = new Map<number, RelationshipInputSourceAssertionDraft[]>();

  for (let index = 1; index <= binding.universeRecordCount; index += 1) {
    const address = recordAddress(index);
    facts.set(index, [
      termFact('visual', `filler-visual-${index}`, address),
      termFact('behavioural', `filler-behavioural-${index}`, address),
      termFact('sensory', `filler-sensory-${index}`, address),
      governedFact('entity', `entity:filler-${index}`, address),
      governedFact('site', `site:filler-${index}`, address),
      narrativeFact(`pattern:filler-${index}`, address),
    ]);
    assertions.set(index, []);
  }

  const addIndependentPair = (left: number, right: number) => {
    assertions.get(left)?.push({
      counterpartySourceId: `source-${right}`,
      classification: 'independent',
      basis: 'documented_separate_origin',
      origins: [origin(recordAddress(left), `source.independence.${right}`)],
    });
    assertions.get(right)?.push({
      counterpartySourceId: `source-${left}`,
      classification: 'independent',
      basis: 'documented_separate_origin',
      origins: [origin(recordAddress(right), `source.independence.${left}`)],
    });
  };

  categoricalPairs.forEach(([left, right], pairIndex) => {
    const suffix = String(pairIndex).padStart(3, '0');
    for (const index of [left, right]) facts.get(index)?.push(
      termFact('visual', `cat-visual-${suffix}`, recordAddress(index)),
      termFact('behavioural', `cat-behavioural-${suffix}`, recordAddress(index)),
      termFact('sensory', `cat-sensory-${suffix}`, recordAddress(index)),
      governedFact('entity', `entity:cat-${suffix}`, recordAddress(index)),
      governedFact('site', `site:cat-${suffix}`, recordAddress(index)),
      narrativeFact(`pattern:cat-${suffix}`, recordAddress(index)),
    );
    addIndependentPair(left, right);
  });

  for (const index of spaceTime) facts.get(index)?.push(
    termFact('visual', 'space-time-amber-triangle', recordAddress(index)),
    termFact('behavioural', 'space-time-hover', recordAddress(index)),
    timestampFact(recordAddress(index)),
    locationFact(recordAddress(index)),
    durationFact(recordAddress(index)),
  );
  for (const [left, right] of spaceTimePairs) addIndependentPair(left, right);

  const records: RelationshipInputRecord[] = [];
  for (let index = 1; index <= binding.universeRecordCount; index += 1) {
    const address = recordAddress(index);
    const recordFacts = [...(facts.get(index) || [])];
    const governedReferences = recordFacts.flatMap((fact) => {
      if ((fact.family !== 'entity' && fact.family !== 'site')
        || fact.value?.kind !== 'governed_reference') return [];
      return [{
        governedId: fact.value.governedId,
        kind: fact.family,
        registryVersion: fact.value.registryVersion,
        label: `Label ${fact.value.governedId}`,
        origins: fact.origins,
      }];
    });
    const inDuplicate = duplicate.includes(index);
    const inProvenance = provenance.includes(index);
    if (inDuplicate) recordFacts.push(duplicateProvenanceFact(address));
    const draft: RelationshipInputRecordDraft = {
      binding,
      address,
      source: {
        sourceId: inProvenance ? 'provenance-source' : `source-${index}`,
        sourceRecordId: inProvenance ? 'provenance-record' : `record-${index}`,
        registryVersion: 'source-registry-v2',
        lineageId: inDuplicate ? 'duplicate-lineage' : `lineage-${index}`,
        dependencyRisk: 'low',
      },
      facts: recordFacts,
      recordMissingness: [],
      duplicateLineage: inDuplicate ? {
        clusterId: 'duplicate:full-production-calibration-fixture',
        status: 'confirmed',
        canonicalAddress: recordAddress(duplicate[0]),
        memberRole: index === duplicate[0] ? 'canonical' : 'duplicate',
        origins: [origin(address, 'duplicate.cluster')],
      } : null,
      crossReferences: [],
      sourceAssertions: assertions.get(index) || [],
      narrativeVector: {
        status: 'missing',
        modelId: 'narrative-model',
        modelVersion: 'v2',
        dimensions: 16,
        normalization: 'l2',
        inputSha256: null,
        vectorSha256: null,
        reason: 'no_narrative',
      },
      governedReferences,
    };
    records.push(buildRelationshipInputRecord(draft));
  }

  const rarity = buildTypedRelationshipRarityIndex(records, binding);
  const lineageMaterial: FullProductionCalibrationPairLineageMaterial = {
    fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
    binding,
    records,
    rarityIndex: rarity,
    recordSetSha256: rarity.recordSetSha256,
    rarityIndexDigest: rarity.indexDigest,
  };
  const resolvedLineage = options.resolvePairRelationshipInputLineage?.(lineageMaterial) || {
    archiveSetSha256: sha({
      fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
      binding,
      kind: 'input-archive',
    }),
    manifestDigest: sha({
      fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
      binding,
      kind: 'input-manifest',
    }),
  };
  const relationshipInput: FullProductionCalibrationPairRelationshipInput = {
    ...lineageMaterial,
    ...resolvedLineage,
  };
  const byAddress = new Map(records.map((record) => [record.address, record]));
  const evaluate = ([left, right]: [number, number]) => evaluateTypedRelationshipPair({
    left: byAddress.get(recordAddress(left)) as RelationshipInputRecord,
    right: byAddress.get(recordAddress(right)) as RelationshipInputRecord,
    rarityIndex: rarity,
    expectedBinding: binding,
  });
  const labelled = (
    pair: [number, number],
    pairOutcome: TypedRelationshipCalibrationLabelDraft['pairOutcome'],
    hardNegativeCategory: TypedRelationshipCalibrationLabelDraft['hardNegativeCategory'],
    insufficient = false,
  ): TypedRelationshipCalibrationLabelDraft => {
    const evaluation = evaluate(pair);
    const emitted = new Set(evaluation.edges.map((edge) => edge.edgeType));
    const edgeAdjudications = TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.map((edgeType) => ({
      edgeType,
      label: insufficient
        ? 'insufficient' as const
        : emitted.has(edgeType) ? 'positive' as const : 'negative' as const,
      rationaleCode: insufficient
        ? 'fixture_insufficient'
        : emitted.has(edgeType) ? 'fixture_confirmed' : 'fixture_rejected',
    }));
    const pairKey = `pair:${relationshipInputSha256(evaluation.addresses)}`;
    const review = buildTypedRelationshipCalibrationReviewReceipt({
      pairKey,
      evaluationDigest: evaluation.evaluationDigest,
      pairOutcome,
      edgeAdjudications,
      hardNegativeCategory,
      reviewerCohortId: 'local-structural-calibration-reviewers-v1',
      adjudicationPolicyVersion: 'typed-relationship-adjudication-v1',
      reviewerIds: ['local-fixture-reviewer-alpha', 'local-fixture-reviewer-beta'],
      sourceArchiveKey: `local-test-only/reviews/${relationshipInputSha256(pair)}`,
      sourceArchiveVersion: 'local-structural-fixture-v1',
      sourceObjectSha256: relationshipInputSha256({
        fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
        pair,
        pairOutcome,
        hardNegativeCategory,
        edgeAdjudications,
      }),
    });
    return { evaluation, pairOutcome, edgeAdjudications, hardNegativeCategory, review };
  };

  const labels: TypedRelationshipCalibrationLabelDraft[] = [
    ...categoricalPairs.map((pair) => labelled(pair, 'positive', null)),
    ...spaceTimePairs.map((pair) => labelled(pair, 'positive', null)),
    ...duplicatePairs.map((pair) => labelled(pair, 'positive', null)),
    ...provenancePairs.map((pair) => labelled(pair, 'positive', null)),
    ...hardNegativePairs.slice(0, PAIRS_PER_COHORT).map((pair, index) => labelled(
      pair,
      'negative',
      TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES[
        index % TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES.length
      ],
    )),
    labelled(hardNegativePairs[PAIRS_PER_COHORT], 'insufficient', null, true),
  ];
  const lineage: TypedRelationshipCalibrationLineage = {
    binding,
    relationshipInput: {
      schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      archiveSetSha256: relationshipInput.archiveSetSha256,
      manifestDigest: relationshipInput.manifestDigest,
      recordSetSha256: rarity.recordSetSha256,
      recordCount: binding.universeRecordCount,
    },
    rarity: {
      schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
      indexDigest: rarity.indexDigest,
      recordSetSha256: rarity.recordSetSha256,
    },
    engine: {
      schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
      policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
      policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
      thresholds: TYPED_RELATIONSHIP_POLICY,
      model: TYPED_RELATIONSHIP_MODEL,
      modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
      edgeTypeSetSha256: TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
    },
  };
  const auditPlan = buildTypedRelationshipCalibrationAuditPlan({
    lockedHoldout: labels.map((label) => ({
      pairKey: label.review.pairKey,
      sourceGroupId: `holdout-group:${label.evaluation.dependency.classification}`,
    })),
    tuningSet: [{
      pairKey: `pair:${sha({ binding, kind: 'disjoint-pair-tuning-set' })}`,
      sourceGroupId: 'tuning-group:reserved',
    }],
    labelPolicyVersion: 'typed-label-policy-v1',
    groupingPolicyVersion: 'source-grouping-policy-v1',
  });
  const trustPolicy = buildTypedRelationshipCalibrationTrustPolicy({
    auditPlanDigest: auditPlan.planDigest,
    reviewReceiptSetSha256: typedRelationshipCalibrationReviewSetSha256(
      labels.map((label) => label.review),
    ),
    reviewerCohortId: 'local-structural-calibration-reviewers-v1',
    adjudicationPolicyVersion: 'typed-relationship-adjudication-v1',
    minimumIndependentReviewers: 2,
    evidenceClass: 'human_reviewed_locked_holdout',
    authorizationScope: 'production_candidate',
  });
  const artifact = buildTypedRelationshipCalibrationArtifact({
    lineage,
    auditPlan,
    trustPolicy,
    labels,
  });
  const receipt = assertTypedRelationshipCalibrationReceiptProductionEligible(artifact.receipt);
  return {
    relationshipInput,
    relationshipInputRecords: records,
    rarityIndex: rarity,
    artifact,
    artifactBody: Buffer.from(`${canonicalizeRelationshipInput(artifact)}\n`, 'utf8'),
    trustPolicy,
    trustPolicyBody: Buffer.from(`${canonicalizeRelationshipInput(trustPolicy)}\n`, 'utf8'),
    receipt,
    receiptBody: Buffer.from(serializeTypedRelationshipCalibrationReceipt(receipt), 'utf8'),
  };
};

const providerByKind = {
  aircraft: 'adsb-history',
  satellite: 'space-track',
  astronomy: 'jpl-horizons',
  weather: 'met-office',
} as const;

const familyByKind = {
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
} as const;

const contextualProvenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
  providerId: string,
  index: number,
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId,
  sourceRecordId: `${sourceRef}-record-${index}`,
  datasetVersion: 'full-production-calibration-test-source-v1',
  retrievedAt: '2026-07-18T00:00:00.000Z',
  contentSha256: contextSha(`${sourceRef}:${index}`),
  sourceUri: `https://example.test/local-structural-calibration/${sourceRef}/${index}`,
});

const contextualModel = (kind: typeof CONTEXT_KINDS[number], index: number) => ({
  modelId: 'deterministic-context-matcher',
  modelVersion: '1.0.0',
  method: 'deterministic' as const,
  inputSha256: contextSha(`model-input:${kind}:${index}`),
  outputSha256: contextSha(`model-output:${kind}:${index}`),
});

const contextualCandidate = (
  kind: typeof CONTEXT_KINDS[number],
  index: number,
  predictedPositive: boolean,
): ContextualExplanationCandidateDraft => {
  const subjectAddress = `sighting:context-calibration-${kind}-${String(index).padStart(4, '0')}`;
  const common = {
    kind,
    subjectAddress,
    subjectObservation: {
      window: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-01T00:00:20.000Z',
        precisionSeconds: predictedPositive ? 10 : 10_000,
      },
      location: { lat: 51.5, lon: -0.1, precisionKm: 1 },
      skyPosition: kind === 'weather'
        ? null
        : { azimuthDeg: 100, elevationDeg: 30, precisionDeg: 1 },
    },
    provenance: [
      contextualProvenance(`subject-${kind}`, 'subject_observation', 'uapfiles', index),
      contextualProvenance(`reference-${kind}`, 'context_reference', providerByKind[kind], index),
    ],
    missingness: kind === 'weather' ? [
      { field: 'subject.sky_position', status: 'not_recorded' as const, reason: 'source_omitted_direction' },
      { field: 'reference.sky_position', status: 'not_applicable' as const, reason: 'area_weather_observation' },
    ] : [],
    uncertainty: { level: 'low' as const, reasons: ['bounded_fixture'] },
    model: contextualModel(kind, index),
  };
  if (kind === 'aircraft') return {
    ...common,
    kind,
    reference: { referenceId: `adsb:flight-${index}`, label: `Flight ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:30.000Z', end: '2026-01-01T00:00:40.000Z', precisionSeconds: 5 },
      location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
      skyPosition: { azimuthDeg: 102, elevationDeg: 30, precisionDeg: 0.25 },
    },
    domainEvidence: [{
      code: 'track_coverage_fraction', value: 0.9, precision: 0.05, method: 'catalogue',
      methodVersion: 'adsb-track-coverage-v1', sourceRefs: ['reference-aircraft'],
    }],
  };
  if (kind === 'satellite') return {
    ...common,
    kind,
    reference: { referenceId: `norad:${20_000 + index}`, label: `Satellite ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:30.000Z', end: '2026-01-01T00:00:30.000Z', precisionSeconds: 2 },
      location: null,
      skyPosition: { azimuthDeg: 101, elevationDeg: 30, precisionDeg: 0.1 },
    },
    missingness: [{
      field: 'reference.location',
      status: 'not_applicable',
      reason: 'observer_centric_sky_solution',
    }],
    domainEvidence: [
      {
        code: 'track_coverage_fraction', value: 0.9, precision: 0.05, method: 'catalogue',
        methodVersion: 'sgp4-coverage-v1', sourceRefs: ['reference-satellite'],
      },
      {
        code: 'orbit_epoch_age_hours', value: 24, precision: 1, method: 'catalogue',
        methodVersion: 'tle-age-v1', sourceRefs: ['reference-satellite'],
      },
    ],
  };
  if (kind === 'astronomy') return {
    ...common,
    kind,
    reference: { referenceId: `iau:object-${index}`, label: `Ephemeris object ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:10.000Z', end: '2026-01-01T00:00:10.000Z', precisionSeconds: 1 },
      location: null,
      skyPosition: { azimuthDeg: 101, elevationDeg: 30, precisionDeg: 0.05 },
    },
    missingness: [{
      field: 'reference.location',
      status: 'not_applicable',
      reason: 'observer_centric_sky_solution',
    }],
    domainEvidence: [{
      code: 'ephemeris_accuracy_deg', value: 0.1, precision: 0.05, method: 'catalogue',
      methodVersion: 'ephemeris-solution-v1', sourceRefs: ['reference-astronomy'],
    }],
  };
  return {
    ...common,
    kind: 'weather',
    reference: { referenceId: `met:station-${index}`, label: `Weather station ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z', precisionSeconds: 120 },
      location: { lat: 51.6, lon: -0.2, precisionKm: 5 },
      skyPosition: null,
    },
    domainEvidence: [
      {
        code: 'observation_coverage_fraction', value: 0.8, precision: 0.1, method: 'measured',
        methodVersion: 'weather-window-v1', sourceRefs: ['reference-weather'],
      },
      {
        code: 'phenomenon_match_score', value: 0.9, precision: 0.05,
        method: 'deterministic_rule', methodVersion: 'weather-trait-match-v1',
        sourceRefs: ['reference-weather'],
      },
    ],
  };
};

const buildContextualCalibration = (
  binding: RelationshipInputUniverseBinding,
): FullProductionCalibrationTestFixture['contextual'] => {
  const sourceDigest = Object.fromEntries(CONTEXT_KINDS.map((kind) => [
    kind,
    contextSha({ fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE, binding, kind }),
  ])) as Record<typeof CONTEXT_KINDS[number], string>;
  const drafts: Array<Omit<ContextualRelationshipCalibrationLabelDraft, 'review'>> = [];
  for (const kind of CONTEXT_KINDS) {
    for (let index = 0; index < 200; index += 1) {
      const predictedPositive = index < 100;
      const candidate = contextualCandidate(kind, index, predictedPositive);
      drafts.push({
        candidate,
        evaluation: evaluateContextualExplanationCandidate(candidate),
        sourceSnapshotDigest: sourceDigest[kind],
        observationArchiveRecordDigest: contextSha(`archive-record:${kind}:${index}`),
        truthLabel: predictedPositive ? 'positive' : 'negative',
        hardNegativeCategory: predictedPositive
          ? null
          : CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES[
            index % CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES.length
          ],
      });
    }
  }
  const insufficientCandidate = contextualCandidate('weather', 999, false);
  insufficientCandidate.subjectObservation.location = null;
  insufficientCandidate.missingness.push({
    field: 'subject.location',
    status: 'not_recorded',
    reason: 'fixture_location_omitted',
  });
  drafts.push({
    candidate: insufficientCandidate,
    evaluation: evaluateContextualExplanationCandidate(insufficientCandidate),
    sourceSnapshotDigest: sourceDigest.weather,
    observationArchiveRecordDigest: contextSha('archive-record:weather:insufficient'),
    truthLabel: 'insufficient',
    hardNegativeCategory: null,
  });
  const labels = drafts.map((draft): ContextualRelationshipCalibrationLabelDraft => {
    const sampleId = getContextualRelationshipCalibrationSampleId(draft);
    const evaluationDigest = contextSha(draft.evaluation);
    return {
      ...draft,
      review: buildContextualRelationshipCalibrationReviewReceipt({
        sampleId,
        evaluationDigest,
        truthLabel: draft.truthLabel,
        hardNegativeCategory: draft.hardNegativeCategory,
        reviewerCohortId: 'local-structural-context-reviewers-v1',
        adjudicationPolicyVersion: 'context-adjudication-v1',
        reviewerIds: ['local-context-reviewer-alpha', 'local-context-reviewer-beta'],
        sourceArchiveKey: `local-test-only/context-reviews/${sampleId.slice('context-calibration-sample:'.length)}`,
        sourceArchiveVersion: 'local-structural-fixture-v1',
        sourceObjectSha256: contextSha({
          fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
          sampleId,
          truthLabel: draft.truthLabel,
        }),
      }),
    };
  });
  const modelIdentity = {
    modelId: 'deterministic-context-matcher',
    modelVersion: '1.0.0',
    method: 'deterministic' as const,
  };
  const lineage = buildContextualRelationshipCalibrationLineage({
    binding,
    observationArchiveVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    sourceArchives: CONTEXT_KINDS.map((kind) => ({
      kind,
      sourceFamily: familyByKind[kind],
      sourceId: `local-structural-context-source-${kind}`,
      providerId: providerByKind[kind],
      datasetVersion: 'full-production-calibration-test-source-v1',
      sourceSnapshotDigest: sourceDigest[kind],
      completionManifestDigest: contextSha({ binding, kind, type: 'completion' }),
      archiveSetSha256: contextSha({ binding, kind, type: 'archive-set' }),
      sourcePageSetSha256: contextSha({ binding, kind, type: 'source-pages' }),
      rowCount: kind === 'weather' ? 201 : 200,
      emittedEdgeCount: 100,
      insufficientEvidenceCount: kind === 'weather' ? 101 : 100,
    })),
    contextualPolicy: {
      schemaVersion: CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
      policyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
      policySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
      thresholds: CONTEXTUAL_EXPLANATION_POLICY,
    },
    adapter: {
      adapterVersion: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
      governedPayloadSchemaVersion: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
    },
    models: [{ ...modelIdentity, modelIdentitySha256: contextSha(modelIdentity) }],
  });
  const auditPlan = buildContextualRelationshipCalibrationAuditPlan({
    lockedHoldout: labels.map((label) => ({
      sampleId: label.review.sampleId,
      sourceGroupId: `source-group:${label.candidate.kind}`,
    })),
    tuningSet: [{
      sampleId: `context-calibration-sample:${contextSha({ binding, type: 'disjoint-context-tuning' })}`,
      sourceGroupId: 'source-group:disjoint-tuning',
    }],
    labelPolicyVersion: 'context-label-policy-v1',
    groupingPolicyVersion: 'context-source-group-policy-v1',
  });
  const trustPolicy = buildContextualRelationshipCalibrationTrustPolicy({
    lineageDigest: lineage.lineageDigest,
    auditPlanDigest: auditPlan.planDigest,
    reviewReceiptSetSha256: contextualRelationshipCalibrationReviewSetSha256(
      labels.map((label) => label.review),
    ),
    reviewerCohortId: 'local-structural-context-reviewers-v1',
    adjudicationPolicyVersion: 'context-adjudication-v1',
    minimumIndependentReviewers: 2,
    evidenceClass: 'human_reviewed_locked_holdout',
    authorizationScope: 'production_candidate',
  });
  const artifact = buildContextualRelationshipCalibrationArtifact({
    lineage,
    auditPlan,
    trustPolicy,
    labels,
  });
  const receipt = assertContextualRelationshipCalibrationReceiptProductionEligible(artifact.receipt);
  return {
    artifact,
    artifactBody: Buffer.from(`${canonicalizeContextualExplanation(artifact)}\n`, 'utf8'),
    trustPolicy,
    trustPolicyBody: Buffer.from(`${canonicalizeContextualExplanation(trustPolicy)}\n`, 'utf8'),
    receipt,
    receiptBody: Buffer.from(serializeContextualRelationshipCalibrationReceipt(receipt), 'utf8'),
  };
};

const assertProductionShapedPairTrust = (trust: TypedRelationshipCalibrationTrustPolicy) => {
  if (trust.evidenceClass !== 'human_reviewed_locked_holdout'
    || trust.authorizationScope !== 'production_candidate') {
    throw new Error('full_production_calibration_pair_trust_not_production_shaped');
  }
};

const assertProductionShapedContextTrust = (
  trust: ContextualRelationshipCalibrationTrustPolicy,
) => {
  if (trust.evidenceClass !== 'human_reviewed_locked_holdout'
    || trust.authorizationScope !== 'production_candidate') {
    throw new Error('full_production_calibration_contextual_trust_not_production_shaped');
  }
};

export const assertFullProductionCalibrationTestTrustPolicyBodies = (params: {
  pairTrustPolicyBody: Buffer | string;
  contextualTrustPolicyBody: Buffer | string;
}) => {
  const pairTrustPolicy = decodeTypedRelationshipCalibrationTrustPolicy(parseJsonBody(
    params.pairTrustPolicyBody,
    'full_production_calibration_pair_trust_body_json_invalid',
  ));
  assertProductionShapedPairTrust(pairTrustPolicy);
  const pairTrustPolicyBody = Buffer.from(
    `${canonicalizeRelationshipInput(pairTrustPolicy)}\n`,
    'utf8',
  );
  requireExactBody(
    params.pairTrustPolicyBody,
    pairTrustPolicyBody,
    'full_production_calibration_pair_trust_body_noncanonical',
  );

  const contextualTrustPolicy = decodeContextualRelationshipCalibrationTrustPolicy(parseJsonBody(
    params.contextualTrustPolicyBody,
    'full_production_calibration_contextual_trust_body_json_invalid',
  ));
  assertProductionShapedContextTrust(contextualTrustPolicy);
  const contextualTrustPolicyBody = Buffer.from(
    `${canonicalizeContextualExplanation(contextualTrustPolicy)}\n`,
    'utf8',
  );
  requireExactBody(
    params.contextualTrustPolicyBody,
    contextualTrustPolicyBody,
    'full_production_calibration_contextual_trust_body_noncanonical',
  );
  return {
    pairTrustPolicy,
    pairTrustPolicyBody,
    contextualTrustPolicy,
    contextualTrustPolicyBody,
  };
};

export const assertFullProductionCalibrationTestReceiptBodies = (params: {
  pairReceiptBody: Buffer | string;
  contextualReceiptBody: Buffer | string;
}) => {
  const pairReceipt = assertTypedRelationshipCalibrationReceiptProductionEligible(
    decodeTypedRelationshipCalibrationReceipt(params.pairReceiptBody),
  );
  const pairReceiptBody = Buffer.from(
    serializeTypedRelationshipCalibrationReceipt(pairReceipt),
    'utf8',
  );
  requireExactBody(
    params.pairReceiptBody,
    pairReceiptBody,
    'full_production_calibration_pair_receipt_body_noncanonical',
  );
  const contextualReceipt = assertContextualRelationshipCalibrationReceiptProductionEligible(
    decodeContextualRelationshipCalibrationReceipt(params.contextualReceiptBody),
  );
  const contextualReceiptBody = Buffer.from(
    serializeContextualRelationshipCalibrationReceipt(contextualReceipt),
    'utf8',
  );
  requireExactBody(
    params.contextualReceiptBody,
    contextualReceiptBody,
    'full_production_calibration_contextual_receipt_body_noncanonical',
  );
  return { pairReceipt, pairReceiptBody, contextualReceipt, contextualReceiptBody };
};

/**
 * Revalidates every exact body against the production decoders and builders.
 * The explicit fixture-use marker remains mandatory so a structural fixture
 * cannot silently masquerade as an external human-review trust ceremony.
 */
export const assertCanonicalFullProductionCalibrationTestFixture = (
  params: FullProductionCalibrationTestFixtureBodies,
): FullProductionCalibrationTestFixture => {
  if (params.fixtureUse !== FULL_PRODUCTION_CALIBRATION_FIXTURE_USE) {
    throw new Error('full_production_calibration_fixture_use_invalid');
  }
  const binding = validateRelationshipInputBinding(params.binding);
  if (binding.universeRecordCount < FULL_PRODUCTION_CALIBRATION_MINIMUM_UNIVERSE_RECORD_COUNT) {
    throw new Error('full_production_calibration_fixture_universe_too_small');
  }

  const trusts = assertFullProductionCalibrationTestTrustPolicyBodies({
    pairTrustPolicyBody: params.pair.trustPolicyBody,
    contextualTrustPolicyBody: params.contextual.trustPolicyBody,
  });
  const pairTrust = trusts.pairTrustPolicy;
  const pairTrustBody = trusts.pairTrustPolicyBody;
  const pairArtifact = decodeTypedRelationshipCalibrationArtifact(
    params.pair.artifactBody,
    binding,
    pairTrust,
  );
  const relationshipInput = params.pair.relationshipInput;
  if (relationshipInput.fixtureUse !== FULL_PRODUCTION_CALIBRATION_FIXTURE_USE
    || canonicalizeRelationshipInput(relationshipInput.binding)
      !== canonicalizeRelationshipInput(binding)) {
    throw new Error('full_production_calibration_pair_relationship_input_binding_invalid');
  }
  if (pairArtifact.lineage.relationshipInput.archiveSetSha256 !== relationshipInput.archiveSetSha256
    || pairArtifact.lineage.relationshipInput.manifestDigest !== relationshipInput.manifestDigest
    || pairArtifact.lineage.relationshipInput.recordSetSha256 !== relationshipInput.recordSetSha256
    || pairArtifact.lineage.rarity.indexDigest !== relationshipInput.rarityIndexDigest) {
    throw new Error('full_production_calibration_pair_relationship_input_lineage_mismatch');
  }
  const rebuiltRarity = buildTypedRelationshipRarityIndex(relationshipInput.records, binding);
  if (canonicalizeRelationshipInput(rebuiltRarity)
      !== canonicalizeRelationshipInput(relationshipInput.rarityIndex)
    || relationshipInput.recordSetSha256 !== rebuiltRarity.recordSetSha256
    || relationshipInput.rarityIndexDigest !== rebuiltRarity.indexDigest) {
    throw new Error('full_production_calibration_pair_relationship_input_rarity_invalid');
  }
  const pairArtifactBody = Buffer.from(`${canonicalizeRelationshipInput(pairArtifact)}\n`, 'utf8');
  requireExactBody(
    params.pair.artifactBody,
    pairArtifactBody,
    'full_production_calibration_pair_artifact_body_noncanonical',
  );
  const pairReceipt = assertTypedRelationshipCalibrationReceiptProductionEligible(
    decodeTypedRelationshipCalibrationReceipt(params.pair.receiptBody, {
      receiptId: pairArtifact.receipt.receiptId,
      receiptSha256: pairArtifact.receipt.receiptSha256,
    }),
  );
  const pairReceiptBody = Buffer.from(serializeTypedRelationshipCalibrationReceipt(pairReceipt), 'utf8');
  requireExactBody(
    params.pair.receiptBody,
    pairReceiptBody,
    'full_production_calibration_pair_receipt_body_noncanonical',
  );

  const contextualTrust = trusts.contextualTrustPolicy;
  const contextualTrustBody = trusts.contextualTrustPolicyBody;
  const contextualArtifact = decodeContextualRelationshipCalibrationArtifact(
    params.contextual.artifactBody,
    binding,
    contextualTrust,
  );
  const contextualArtifactBody = Buffer.from(
    `${canonicalizeContextualExplanation(contextualArtifact)}\n`,
    'utf8',
  );
  requireExactBody(
    params.contextual.artifactBody,
    contextualArtifactBody,
    'full_production_calibration_contextual_artifact_body_noncanonical',
  );
  const contextualReceipt = assertContextualRelationshipCalibrationReceiptProductionEligible(
    decodeContextualRelationshipCalibrationReceipt(params.contextual.receiptBody, {
      receiptId: contextualArtifact.receipt.receiptId,
      receiptSha256: contextualArtifact.receipt.receiptSha256,
    }),
  );
  const contextualReceiptBody = Buffer.from(
    serializeContextualRelationshipCalibrationReceipt(contextualReceipt),
    'utf8',
  );
  requireExactBody(
    params.contextual.receiptBody,
    contextualReceiptBody,
    'full_production_calibration_contextual_receipt_body_noncanonical',
  );

  return {
    fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
    binding,
    pair: {
      relationshipInput,
      relationshipInputRecords: relationshipInput.records,
      rarityIndex: relationshipInput.rarityIndex,
      artifact: pairArtifact,
      artifactBody: pairArtifactBody,
      trustPolicy: pairTrust,
      trustPolicyBody: pairTrustBody,
      receipt: pairReceipt,
      receiptBody: pairReceiptBody,
    },
    contextual: {
      artifact: contextualArtifact,
      artifactBody: contextualArtifactBody,
      trustPolicy: contextualTrust,
      trustPolicyBody: contextualTrustBody,
      receipt: contextualReceipt,
      receiptBody: contextualReceiptBody,
    },
  };
};

export const buildFullProductionCalibrationTestFixture = (
  bindingInput: RelationshipInputUniverseBinding,
  options: FullProductionCalibrationTestFixtureOptions = {},
): FullProductionCalibrationTestFixture => {
  const binding = validateRelationshipInputBinding(bindingInput);
  if (binding.universeRecordCount < FULL_PRODUCTION_CALIBRATION_MINIMUM_UNIVERSE_RECORD_COUNT) {
    throw new Error('full_production_calibration_fixture_universe_too_small');
  }
  const pair = buildPairCalibration(binding, options);
  const contextual = buildContextualCalibration(binding);
  return {
    fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
    binding,
    pair,
    contextual,
  };
};

/**
 * Builds a production-shaped, sealed two-reviewer bundle for contract tests.
 * The source origin intentionally exercises the production-candidate branch,
 * while fixtureUse makes its simulated nature explicit to every test caller.
 */
export const buildFullProductionCalibrationHumanReviewTestFixture = (
  bindingInput: RelationshipInputUniverseBinding,
  options: FullProductionCalibrationTestFixtureOptions = {},
): FullProductionCalibrationHumanReviewTestFixture => {
  const structural = buildFullProductionCalibrationTestFixture(bindingInput, options);
  const pairGroups = new Map(structural.pair.artifact.auditPlan.lockedHoldout.map(
    (item) => [item.pairKey, item.sourceGroupId],
  ));
  const contextualGroups = new Map(structural.contextual.artifact.auditPlan.lockedHoldout.map(
    (item) => [item.sampleId, item.sourceGroupId],
  ));
  const reviewerIds = ['simulated-reviewer-alpha', 'simulated-reviewer-beta'];
  const adjudicatorId = 'simulated-adjudicator';
  const lockedAt = '2026-07-18T09:00:00.000Z';
  const reviewedAt = '2026-07-18T10:00:00.000Z';
  const pack = buildCalibrationHumanReviewPack({
    lockedAt,
    sourceEvidence: {
      evidenceOrigin: 'governed_locked_holdout_candidates',
      sourceId: 'simulated-contract-source-never-publication-evidence',
      sourceSha256: sha({
        fixtureUse: FULL_PRODUCTION_CALIBRATION_HUMAN_REVIEW_FIXTURE_USE,
        binding: structural.binding,
      }),
    },
    reviewPolicy: {
      reviewerIds,
      adjudicatorId,
      minimumIndependentReviewers: reviewerIds.length,
      pairReviewerCohortId: 'simulated-pair-reviewer-cohort-v1',
      pairAdjudicationPolicyVersion: 'simulated-pair-adjudication-v1',
      contextualReviewerCohortId: 'simulated-context-reviewer-cohort-v1',
      contextualAdjudicationPolicyVersion: 'simulated-context-adjudication-v1',
    },
    pairLineage: structural.pair.artifact.lineage,
    contextualLineage: structural.contextual.artifact.lineage,
    pairAuditPlan: structural.pair.artifact.auditPlan,
    contextualAuditPlan: structural.contextual.artifact.auditPlan,
    pairCandidates: structural.pair.artifact.labels.map((label) => ({
      pairKey: label.review.pairKey,
      sourceGroupId: pairGroups.get(label.review.pairKey)
        ?? (() => { throw new Error('simulated_human_review_pair_group_missing'); })(),
      evaluationDigest: label.review.evaluationDigest,
      evaluation: label.evaluation,
    })),
    contextualCandidates: structural.contextual.artifact.labels.map((label) => ({
      sampleId: label.review.sampleId,
      sourceGroupId: contextualGroups.get(label.review.sampleId)
        ?? (() => { throw new Error('simulated_human_review_contextual_group_missing'); })(),
      evaluationDigest: label.review.evaluationDigest,
      candidate: label.candidate,
      evaluation: label.evaluation,
      sourceSnapshotDigest: label.sourceSnapshotDigest,
      observationArchiveRecordDigest: label.observationArchiveRecordDigest,
    })),
  });
  const submissions = reviewerIds.map((reviewerId, index) => (
    buildCalibrationHumanReviewerSubmission(pack, {
      reviewerId,
      startedAt: `2026-07-18T09:${index === 0 ? '10' : '20'}:00.000Z`,
      submittedAt: `2026-07-18T10:${index === 0 ? '10' : '20'}:00.000Z`,
      pairReviews: structural.pair.artifact.labels.map((label) => ({
        pairKey: label.review.pairKey,
        evaluationDigest: label.review.evaluationDigest,
        pairOutcome: label.pairOutcome,
        edgeAdjudications: label.edgeAdjudications,
        hardNegativeCategory: label.hardNegativeCategory,
        reviewedAt,
      })),
      contextualReviews: structural.contextual.artifact.labels.map((label) => ({
        sampleId: label.review.sampleId,
        evaluationDigest: label.review.evaluationDigest,
        truthLabel: label.truthLabel,
        hardNegativeCategory: label.hardNegativeCategory,
        rationaleCode: 'simulated_contract_label',
        reviewedAt,
      })),
    })
  ));
  const adjudicatedAt = '2026-07-18T11:30:00.000Z';
  const adjudication = buildCalibrationHumanReviewAdjudication(pack, submissions, {
    adjudicatorId,
    startedAt: '2026-07-18T11:00:00.000Z',
    adjudicatedAt,
    pairAdjudications: structural.pair.artifact.labels.map((label) => ({
      pairKey: label.review.pairKey,
      evaluationDigest: label.review.evaluationDigest,
      pairOutcome: label.pairOutcome,
      edgeAdjudications: label.edgeAdjudications,
      hardNegativeCategory: label.hardNegativeCategory,
      reviewedAt: adjudicatedAt,
      basis: 'unanimous',
      resolutionRationaleCode: 'simulated_unanimous_contract_label',
    })),
    contextualAdjudications: structural.contextual.artifact.labels.map((label) => ({
      sampleId: label.review.sampleId,
      evaluationDigest: label.review.evaluationDigest,
      truthLabel: label.truthLabel,
      hardNegativeCategory: label.hardNegativeCategory,
      rationaleCode: 'simulated_contract_label',
      reviewedAt: adjudicatedAt,
      basis: 'unanimous',
      resolutionRationaleCode: 'simulated_unanimous_contract_label',
    })),
    humanReviewAttestation: {
      statementVersion: CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION,
      statement: CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT,
      attestedBy: adjudicatorId,
      attestedAt: adjudicatedAt,
      reviewerIds,
    },
  });
  const bundle = finalizeCalibrationHumanReview({ pack, submissions, adjudication });
  const { pairArtifact, contextualArtifact } = buildCalibrationArtifactsFromHumanReview(bundle);
  return {
    fixtureUse: FULL_PRODUCTION_CALIBRATION_HUMAN_REVIEW_FIXTURE_USE,
    binding: structural.binding,
    bundle,
    bundleBody: Buffer.from(`${canonicalizeRelationshipInput(bundle)}\n`, 'utf8'),
    pair: {
      artifact: pairArtifact,
      artifactBody: Buffer.from(serializeTypedRelationshipCalibrationArtifact(
        pairArtifact,
        pairArtifact.trustPolicy,
      ), 'utf8'),
      trustPolicy: pairArtifact.trustPolicy,
      trustPolicyBody: Buffer.from(
        `${canonicalizeRelationshipInput(pairArtifact.trustPolicy)}\n`,
        'utf8',
      ),
      receipt: pairArtifact.receipt,
      receiptBody: Buffer.from(
        serializeTypedRelationshipCalibrationReceipt(pairArtifact.receipt),
        'utf8',
      ),
    },
    contextual: {
      artifact: contextualArtifact,
      artifactBody: Buffer.from(serializeContextualRelationshipCalibrationArtifact(
        contextualArtifact,
        contextualArtifact.trustPolicy,
      ), 'utf8'),
      trustPolicy: contextualArtifact.trustPolicy,
      trustPolicyBody: Buffer.from(
        `${canonicalizeContextualExplanation(contextualArtifact.trustPolicy)}\n`,
        'utf8',
      ),
      receipt: contextualArtifact.receipt,
      receiptBody: Buffer.from(
        serializeContextualRelationshipCalibrationReceipt(contextualArtifact.receipt),
        'utf8',
      ),
    },
  };
};
