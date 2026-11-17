import { describe, expect, it } from 'vitest';

import type { CaseGraphConditionalArchiveStorage } from '../../src/caseGraph/archiveTypes';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import {
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  buildRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputRecordDraft,
  type RelationshipInputSourceAssertionDraft,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_EDGE_TYPES,
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
} from '../../src/caseGraph/typedRelationshipEngine';
import {
  TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256,
  TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY,
  TYPED_RELATIONSHIP_CALIBRATION_SCOPE,
  TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
  TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES,
  assertTypedRelationshipCalibrationReceiptProductionEligible,
  buildTypedRelationshipCalibrationAuditPlan,
  buildTypedRelationshipCalibrationArtifact,
  buildTypedRelationshipCalibrationReviewReceipt,
  buildTypedRelationshipCalibrationTrustPolicy,
  decodeTypedRelationshipCalibrationArtifact,
  serializeTypedRelationshipCalibrationArtifact,
  typedRelationshipCalibrationReviewSetSha256,
  type TypedRelationshipCalibrationArtifact,
  type TypedRelationshipCalibrationLabelDraft,
  type TypedRelationshipCalibrationLineage,
  type TypedRelationshipCalibrationTrustPolicy,
} from '../../src/caseGraph/typedRelationshipCalibration';
import {
  buildTypedRelationshipCalibrationArchiveObject,
  decodeTypedRelationshipCalibrationArchiveObject,
  readTypedRelationshipCalibrationArchive,
  writeTypedRelationshipCalibrationArchive,
} from '../../src/caseGraph/typedRelationshipCalibrationArchive';

const CORPUS_SIZE = 105;
const PAIRS_PER_COHORT = 200;
const sha = (value: string) => relationshipInputSha256(value);
const address = (index: number) => `sighting:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const binding: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000123',
  corpusVersion: 'typed-calibration-locked-holdout-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: CORPUS_SIZE,
};

const origin = (recordAddress: string, sourceField: string): RelationshipInputOriginDraft => ({
  sourceAddress: recordAddress,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'typed-calibration-fixture-v1' },
});

const termFact = (
  family: 'visual' | 'behavioural' | 'sensory',
  termId: string,
  recordAddress: string,
): RelationshipInputFactDraft => ({
  family,
  predicate: `observed_${family}`,
  value: { kind: 'term', termId, vocabularyVersion: `${family}-v2` },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['reviewed_fixture'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, `${family}.${termId}`)],
});

const governedFact = (
  family: 'entity' | 'site',
  governedId: string,
  recordAddress: string,
): RelationshipInputFactDraft => ({
  family,
  predicate: family === 'entity' ? 'mentions_entity' : 'mentions_site',
  value: { kind: 'governed_reference', governedId, registryVersion: `${family}-registry-v2` },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['registry_reviewed'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-registry-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, `${family}.${governedId}`)],
});

const narrativeFact = (patternId: string, recordAddress: string): RelationshipInputFactDraft => ({
  family: 'narrative_pattern',
  predicate: 'governed_narrative_pattern',
  value: { kind: 'narrative_pattern', patternId, registryVersion: 'narrative-registry-v2' },
  confidence: 0.96,
  uncertainty: { level: 'low', reasons: ['pattern_reviewed'] },
  precision: { kind: 'categorical', vocabularyVersion: 'narrative-registry-v2' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, `narrative.${patternId}`)],
});

const timestampFact = (recordAddress: string): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_timestamp',
  value: { kind: 'timestamp', timestamp: '2026-07-18T10:00:00.000Z', datePrecision: 'exact' },
  confidence: 0.99,
  uncertainty: { level: 'low', reasons: ['clock_rounding'] },
  precision: { kind: 'exact' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, 'event.timestamp')],
});

const locationFact = (recordAddress: string): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_location',
  value: { kind: 'geo_point', lat: 51.5, lon: -0.1, spatialPrecisionKm: 1 },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['coordinate_rounding'] },
  precision: { kind: 'approximate', unit: 'km', tolerance: 1 },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, 'event.location')],
});

const durationFact = (recordAddress: string): RelationshipInputFactDraft => ({
  family: 'duration',
  predicate: 'observed_duration',
  value: { kind: 'duration', seconds: 60 },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['witness_rounding'] },
  precision: { kind: 'approximate', unit: 'seconds', tolerance: 1 },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, 'event.duration')],
});

const duplicateProvenanceFact = (recordAddress: string): RelationshipInputFactDraft => ({
  family: 'provenance',
  predicate: 'duplicate_cluster_membership',
  value: {
    kind: 'provenance',
    code: 'duplicate_cluster',
    referenceId: 'duplicate:calibration-cluster',
  },
  confidence: 1,
  uncertainty: { level: 'none', reasons: [] },
  precision: { kind: 'exact' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(recordAddress, 'duplicate.cluster')],
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

type Fixture = {
  artifact: TypedRelationshipCalibrationArtifact;
  labels: TypedRelationshipCalibrationLabelDraft[];
  lineage: TypedRelationshipCalibrationLineage;
  trustPolicy: TypedRelationshipCalibrationTrustPolicy;
};

let cachedFixture: Fixture | null = null;

const buildFixture = (): Fixture => {
  if (cachedFixture) return cachedFixture;
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

  for (let index = 1; index <= CORPUS_SIZE; index += 1) {
    const recordAddress = address(index);
    facts.set(index, [
      termFact('visual', `filler-visual-${index}`, recordAddress),
      termFact('behavioural', `filler-behavioural-${index}`, recordAddress),
      termFact('sensory', `filler-sensory-${index}`, recordAddress),
      governedFact('entity', `entity:filler-${index}`, recordAddress),
      governedFact('site', `site:filler-${index}`, recordAddress),
      narrativeFact(`pattern:filler-${index}`, recordAddress),
    ]);
    assertions.set(index, []);
  }

  const addIndependentPair = (left: number, right: number) => {
    assertions.get(left)?.push({
      counterpartySourceId: `source-${right}`,
      classification: 'independent',
      basis: 'documented_separate_origin',
      origins: [origin(address(left), `source.independence.${right}`)],
    });
    assertions.get(right)?.push({
      counterpartySourceId: `source-${left}`,
      classification: 'independent',
      basis: 'documented_separate_origin',
      origins: [origin(address(right), `source.independence.${left}`)],
    });
  };

  categoricalPairs.forEach(([left, right], pairIndex) => {
    const suffix = String(pairIndex).padStart(3, '0');
    for (const index of [left, right]) facts.get(index)?.push(
      termFact('visual', `cat-visual-${suffix}`, address(index)),
      termFact('behavioural', `cat-behavioural-${suffix}`, address(index)),
      termFact('sensory', `cat-sensory-${suffix}`, address(index)),
      governedFact('entity', `entity:cat-${suffix}`, address(index)),
      governedFact('site', `site:cat-${suffix}`, address(index)),
      narrativeFact(`pattern:cat-${suffix}`, address(index)),
    );
    addIndependentPair(left, right);
  });

  for (const index of spaceTime) facts.get(index)?.push(
    termFact('visual', 'space-time-amber-triangle', address(index)),
    termFact('behavioural', 'space-time-hover', address(index)),
    timestampFact(address(index)),
    locationFact(address(index)),
    durationFact(address(index)),
  );
  for (const [left, right] of spaceTimePairs) addIndependentPair(left, right);

  const records: RelationshipInputRecord[] = [];
  for (let index = 1; index <= CORPUS_SIZE; index += 1) {
    const recordAddress = address(index);
    const recordFacts = [...(facts.get(index) || [])];
    const governedReferences = recordFacts.flatMap((fact) => {
      if ((fact.family !== 'entity' && fact.family !== 'site') || fact.value?.kind !== 'governed_reference') return [];
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
    if (inDuplicate) recordFacts.push(duplicateProvenanceFact(recordAddress));
    const draft: RelationshipInputRecordDraft = {
      binding,
      address: recordAddress,
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
        clusterId: 'duplicate:calibration-cluster',
        status: 'confirmed',
        canonicalAddress: address(duplicate[0]),
        memberRole: index === duplicate[0] ? 'canonical' : 'duplicate',
        origins: [origin(recordAddress, 'duplicate.cluster')],
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
  const byAddress = new Map(records.map((record) => [record.address, record]));
  const evaluate = ([left, right]: [number, number]) => evaluateTypedRelationshipPair({
    left: byAddress.get(address(left)) as RelationshipInputRecord,
    right: byAddress.get(address(right)) as RelationshipInputRecord,
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
      label: insufficient ? 'insufficient' as const : emitted.has(edgeType) ? 'positive' as const : 'negative' as const,
      rationaleCode: insufficient ? 'fixture_insufficient' : emitted.has(edgeType) ? 'fixture_confirmed' : 'fixture_rejected',
    }));
    const pairKey = `pair:${relationshipInputSha256(evaluation.addresses)}`;
    const review = buildTypedRelationshipCalibrationReviewReceipt({
      pairKey,
      evaluationDigest: evaluation.evaluationDigest,
      pairOutcome,
      edgeAdjudications,
      hardNegativeCategory,
      reviewerCohortId: 'calibration-reviewers-v1',
      adjudicationPolicyVersion: 'typed-relationship-adjudication-v1',
      reviewerIds: ['reviewer-alpha', 'reviewer-beta'],
      sourceArchiveKey: `review/archive/${relationshipInputSha256(pair)}`,
      sourceArchiveVersion: 'immutable-v1',
      sourceObjectSha256: relationshipInputSha256({ pair, pairOutcome, hardNegativeCategory, edgeAdjudications }),
    });
    return {
      evaluation,
      pairOutcome,
      edgeAdjudications,
      hardNegativeCategory,
      review,
    };
  };

  const labels: TypedRelationshipCalibrationLabelDraft[] = [
    ...categoricalPairs.map((pair) => labelled(pair, 'positive', null)),
    ...spaceTimePairs.map((pair) => labelled(pair, 'positive', null)),
    ...duplicatePairs.map((pair) => labelled(pair, 'positive', null)),
    ...provenancePairs.map((pair) => labelled(pair, 'positive', null)),
    ...hardNegativePairs.slice(0, PAIRS_PER_COHORT).map((pair, index) => labelled(
      pair,
      'negative',
      TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES[index % TYPED_RELATIONSHIP_HARD_NEGATIVE_CATEGORIES.length],
    )),
    labelled(hardNegativePairs[PAIRS_PER_COHORT], 'insufficient', null, true),
  ];
  const lineage: TypedRelationshipCalibrationLineage = {
    binding,
    relationshipInput: {
      schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      archiveSetSha256: sha('relationship-input-archive-set'),
      manifestDigest: sha('relationship-input-manifest'),
      recordSetSha256: rarity.recordSetSha256,
      recordCount: CORPUS_SIZE,
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
      pairKey: `pair:${sha('disjoint-tuning-pair')}`,
      sourceGroupId: 'tuning-group:reserved',
    }],
    labelPolicyVersion: 'typed-label-policy-v1',
    groupingPolicyVersion: 'source-grouping-policy-v1',
  });
  const trustPolicy = buildTypedRelationshipCalibrationTrustPolicy({
    auditPlanDigest: auditPlan.planDigest,
    reviewReceiptSetSha256: typedRelationshipCalibrationReviewSetSha256(labels.map((label) => label.review)),
    reviewerCohortId: 'calibration-reviewers-v1',
    adjudicationPolicyVersion: 'typed-relationship-adjudication-v1',
    minimumIndependentReviewers: 2,
    evidenceClass: 'synthetic_contract_fixture',
    authorizationScope: 'test_only_never_publish',
  });
  const artifact = buildTypedRelationshipCalibrationArtifact({
    lineage,
    auditPlan,
    trustPolicy,
    labels,
  });
  cachedFixture = { artifact, labels, lineage, trustPolicy };
  return cachedFixture;
};

const clone = <T>(value: T): T => structuredClone(value);

class MemoryStorage implements CaseGraphConditionalArchiveStorage {
  readonly objects = new Map<string, Buffer>();
  throwAfterWrite = false;

  async readObject(key: string) { return this.objects.get(key) || null; }
  async readObjectVersioned(key: string) {
    const body = this.objects.get(key);
    return body ? { body, version: sha(body.toString('base64')) } : null;
  }
  async uploadFile(body: Buffer, key: string) {
    this.objects.set(key, Buffer.from(body));
    return key;
  }
  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[2],
    condition: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[3],
  ) {
    if (!('ifAbsent' in condition) || this.objects.has(key)) return { status: 'precondition_failed' as const };
    this.objects.set(key, Buffer.from(body));
    if (this.throwAfterWrite) {
      this.throwAfterWrite = false;
      throw new Error('fixture_lost_ack');
    }
    return { status: 'written' as const, key, version: sha(body.toString('base64')) };
  }
}

describe('typed relationship calibration audit artifact', () => {
  it('binds a deterministic locked holdout, per-edge confusion matrices, mandatory slices, and conservative gates', () => {
    const { artifact, labels, lineage, trustPolicy } = buildFixture();
    const reversed = buildTypedRelationshipCalibrationArtifact({
      lineage,
      auditPlan: artifact.auditPlan,
      trustPolicy,
      labels: [...labels].reverse(),
    });

    expect(reversed).toEqual(artifact);
    expect(artifact.labelCount).toBe(1_001);
    expect(artifact.calibrationScope).toEqual(TYPED_RELATIONSHIP_CALIBRATION_SCOPE);
    expect(artifact.calibrationScope.calibratedEdgeTypes).toEqual(TYPED_RELATIONSHIP_PAIR_EDGE_TYPES);
    expect(artifact.calibrationScope.excludedEdgeTypes).toEqual([{
      edgeType: 'contextual_explanation_candidate',
      reason: 'requires_separate_contextual_evaluation_calibration',
    }]);
    expect(artifact.lineage.engine.edgeTypeSetSha256).toBe(relationshipInputSha256(TYPED_RELATIONSHIP_EDGE_TYPES));
    expect(artifact.receipt.calibratedEdgeTypeSetSha256).toBe(TYPED_RELATIONSHIP_CALIBRATED_EDGE_TYPE_SET_SHA256);
    expect(artifact.edgeMetrics).toHaveLength(TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.length);
    expect(artifact.edgeMetrics.every((edge) => edge.slices.length === 5)).toBe(true);
    expect(artifact.edgeMetrics.every((edge) => {
      const overall = edge.slices.find((slice) => slice.sliceId === 'overall')?.metrics;
      return overall?.confusion.falsePositive === 0
        && overall.confusion.falseNegative === 0
        && overall.precision.status === 'measured'
        && overall.recall.status === 'measured'
        && overall.falsePositiveRate.status === 'measured'
        && overall.coverage.status === 'measured';
    })).toBe(true);
    expect(artifact.sliceSummaries.map((slice) => [slice.sliceId, slice.pairLabelCount])).toEqual([
      ['overall', 1_001],
      ['hard_negative', 200],
      ['dependency_independent', 400],
      ['dependency_dependent', 400],
      ['dependency_unknown', 201],
    ]);
    expect(artifact.gateChecks.every((gate) => gate.status === 'pass')).toBe(true);
    expect(artifact.gatePolicy).toEqual(TYPED_RELATIONSHIP_CALIBRATION_GATE_POLICY);
    expect(artifact.receipt).toMatchObject({
      decision: 'contract_gates_passed_test_only',
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
    });
    expect(() => assertTypedRelationshipCalibrationReceiptProductionEligible(artifact.receipt))
      .toThrow('typed_relationship_calibration_receipt_not_production_eligible');
  }, 60_000);

  it('round-trips canonically and fails closed on tampering, unknown fields, mixed identity, and zero-denominator substitutions', () => {
    const { artifact, trustPolicy } = buildFixture();
    const serialized = serializeTypedRelationshipCalibrationArtifact(artifact, trustPolicy);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(decodeTypedRelationshipCalibrationArtifact(serialized, binding, trustPolicy)).toEqual(artifact);

    const metricTamper = clone(artifact);
    metricTamper.edgeMetrics[0].slices[0].metrics.confusion.falsePositive = 1;
    expect(() => decodeTypedRelationshipCalibrationArtifact(metricTamper, binding, trustPolicy))
      .toThrow('typed_relationship_calibration_noncanonical');

    const zeroDenominator = clone(artifact) as unknown as Record<string, unknown>;
    const firstMetric = ((zeroDenominator.edgeMetrics as TypedRelationshipCalibrationArtifact['edgeMetrics'])[0].slices[0].metrics);
    firstMetric.precision = { status: 'not_evaluable', numerator: 0, denominator: 0, reason: 'zero_denominator' };
    expect(() => decodeTypedRelationshipCalibrationArtifact(zeroDenominator, binding, trustPolicy))
      .toThrow('typed_relationship_calibration_noncanonical');

    const unknown = clone(artifact) as unknown as Record<string, unknown>;
    unknown.unreviewed = true;
    expect(() => decodeTypedRelationshipCalibrationArtifact(unknown, binding, trustPolicy))
      .toThrow('typed_relationship_calibration_artifact_invalid');

    const mixed = clone(artifact);
    mixed.lineage.rarity.indexDigest = 'b'.repeat(64);
    expect(() => decodeTypedRelationshipCalibrationArtifact(mixed, binding, trustPolicy))
      .toThrow('typed_relationship_calibration_evaluation_identity_mismatch');
  }, 60_000);

  it('rejects duplicate pairs, incomplete adjudications, outcome mismatches, missing slices, and unmet production gates', () => {
    const { artifact, labels, lineage, trustPolicy } = buildFixture();
    expect(() => buildTypedRelationshipCalibrationArtifact({
      lineage,
      auditPlan: artifact.auditPlan,
      trustPolicy,
      labels: [...labels, labels[0]],
    })).toThrow('typed_relationship_calibration_duplicate_pair');

    const incomplete = clone(labels);
    incomplete[0].edgeAdjudications.pop();
    expect(() => buildTypedRelationshipCalibrationArtifact({
      lineage, auditPlan: artifact.auditPlan, trustPolicy, labels: incomplete,
    }))
      .toThrow('typed_relationship_calibration_adjudication_set_invalid');

    const mismatch = clone(labels);
    mismatch[0].pairOutcome = 'negative';
    expect(() => buildTypedRelationshipCalibrationArtifact({
      lineage, auditPlan: artifact.auditPlan, trustPolicy, labels: mismatch,
    }))
      .toThrow('typed_relationship_calibration_pair_outcome_mismatch');

    expect(() => buildTypedRelationshipCalibrationArtifact({
      lineage,
      auditPlan: artifact.auditPlan,
      trustPolicy,
      labels: labels.filter((label) => label.evaluation.dependency.classification !== 'unknown'),
    })).toThrow(/typed_relationship_calibration_(holdout_membership_mismatch|mandatory_slice_missing|gate_failed)/);

    const falsePositive = clone(labels);
    const negative = falsePositive.find((label) => label.hardNegativeCategory !== null);
    if (!negative) throw new Error('fixture_hard_negative_missing');
    const forged = clone(negative.evaluation);
    forged.edges = [clone(labels[0].evaluation.edges[0])];
    forged.edges[0].binding = forged.binding;
    forged.edges[0].endpoints = forged.addresses.map((id) => ({ kind: 'evidence' as const, id })) as [
      { kind: 'evidence'; id: string },
      { kind: 'evidence'; id: string },
    ];
    negative.evaluation = forged;
    expect(() => buildTypedRelationshipCalibrationArtifact({
      lineage, auditPlan: artifact.auditPlan, trustPolicy, labels: falsePositive,
    }))
      .toThrow();
  }, 60_000);

  it('rejects fully rehashed replacement plans, review receipts, and labels against the precommitted trust policy', () => {
    const { artifact, labels, lineage, trustPolicy } = buildFixture();
    const replacedLabels = clone(labels);
    replacedLabels[0].edgeAdjudications[0].rationaleCode = 'fabricated_recompute';
    const priorReview = replacedLabels[0].review;
    replacedLabels[0].review = buildTypedRelationshipCalibrationReviewReceipt({
      pairKey: priorReview.pairKey,
      evaluationDigest: priorReview.evaluationDigest,
      pairOutcome: priorReview.pairOutcome,
      edgeAdjudications: replacedLabels[0].edgeAdjudications,
      hardNegativeCategory: priorReview.hardNegativeCategory,
      reviewerCohortId: priorReview.reviewerCohortId,
      adjudicationPolicyVersion: priorReview.adjudicationPolicyVersion,
      reviewerIds: priorReview.reviewerIds,
      sourceArchiveKey: 'review/archive/fabricated-replacement',
      sourceArchiveVersion: priorReview.sourceArchiveVersion,
      sourceObjectSha256: sha('fabricated-replacement-body'),
    });
    const replacementTrust = buildTypedRelationshipCalibrationTrustPolicy({
      auditPlanDigest: artifact.auditPlan.planDigest,
      reviewReceiptSetSha256: typedRelationshipCalibrationReviewSetSha256(
        replacedLabels.map((label) => label.review),
      ),
      reviewerCohortId: trustPolicy.reviewerCohortId,
      adjudicationPolicyVersion: trustPolicy.adjudicationPolicyVersion,
      minimumIndependentReviewers: trustPolicy.minimumIndependentReviewers,
      evidenceClass: trustPolicy.evidenceClass,
      authorizationScope: trustPolicy.authorizationScope,
    });
    const fullyRehashedReviewReplacement = buildTypedRelationshipCalibrationArtifact({
      lineage,
      auditPlan: artifact.auditPlan,
      trustPolicy: replacementTrust,
      labels: replacedLabels,
    });
    expect(() => decodeTypedRelationshipCalibrationArtifact(
      fullyRehashedReviewReplacement,
      binding,
      trustPolicy,
    )).toThrow('typed_relationship_calibration_trust_policy_mismatch');

    const replacementPlan = buildTypedRelationshipCalibrationAuditPlan({
      lockedHoldout: artifact.auditPlan.lockedHoldout.map((item) => ({
        ...item,
        sourceGroupId: `${item.sourceGroupId}-replacement`,
      })),
      tuningSet: artifact.auditPlan.tuningSet,
      labelPolicyVersion: artifact.auditPlan.labelPolicyVersion,
      groupingPolicyVersion: artifact.auditPlan.groupingPolicyVersion,
    });
    const replacementPlanTrust = buildTypedRelationshipCalibrationTrustPolicy({
      auditPlanDigest: replacementPlan.planDigest,
      reviewReceiptSetSha256: trustPolicy.reviewReceiptSetSha256,
      reviewerCohortId: trustPolicy.reviewerCohortId,
      adjudicationPolicyVersion: trustPolicy.adjudicationPolicyVersion,
      minimumIndependentReviewers: trustPolicy.minimumIndependentReviewers,
      evidenceClass: trustPolicy.evidenceClass,
      authorizationScope: trustPolicy.authorizationScope,
    });
    const fullyRehashedPlanReplacement = buildTypedRelationshipCalibrationArtifact({
      lineage,
      auditPlan: replacementPlan,
      trustPolicy: replacementPlanTrust,
      labels,
    });
    expect(() => decodeTypedRelationshipCalibrationArtifact(
      fullyRehashedPlanReplacement,
      binding,
      trustPolicy,
    )).toThrow('typed_relationship_calibration_trust_policy_mismatch');
  }, 60_000);

  it('archives canonically, reconciles lost acknowledgements, reuses identical bytes, and rejects divergent or tampered objects', async () => {
    const { artifact, trustPolicy } = buildFixture();
    const object = buildTypedRelationshipCalibrationArchiveObject(artifact, trustPolicy);
    expect(decodeTypedRelationshipCalibrationArchiveObject({
      archiveBody: object.archiveBody,
      receiptInput: object.receiptBody,
      expectedBinding: binding,
      expectedTrustPolicy: trustPolicy,
    }).artifact).toEqual(artifact);

    const storage = new MemoryStorage();
    storage.throwAfterWrite = true;
    const first = await writeTypedRelationshipCalibrationArchive({ storage, artifact, expectedTrustPolicy: trustPolicy });
    expect(first.archiveStatus).toBe('reused');
    expect(first.receiptStatus).toBe('written');
    const second = await writeTypedRelationshipCalibrationArchive({ storage, artifact, expectedTrustPolicy: trustPolicy });
    expect(second.archiveStatus).toBe('reused');
    expect(second.receiptStatus).toBe('reused');
    expect((await readTypedRelationshipCalibrationArchive({
      storage,
      receiptKey: first.receiptKey,
      expectedBinding: binding,
      expectedTrustPolicy: trustPolicy,
    })).artifact).toEqual(artifact);

    const tampered = Buffer.from(object.archiveBody);
    tampered[0] ^= 0xff;
    expect(() => decodeTypedRelationshipCalibrationArchiveObject({
      archiveBody: tampered,
      receiptInput: object.receipt,
      expectedTrustPolicy: trustPolicy,
    })).toThrow('typed_relationship_calibration_archive_compressed_mismatch');

    storage.objects.set(object.receipt.archiveKey, Buffer.from('divergent'));
    await expect(writeTypedRelationshipCalibrationArchive({ storage, artifact, expectedTrustPolicy: trustPolicy }))
      .rejects.toThrow('typed_relationship_calibration_archive_immutable_conflict');
  }, 60_000);
});
