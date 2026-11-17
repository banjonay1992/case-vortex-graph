import { describe, expect, it } from 'vitest';

import {
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  contextualExplanationSha256,
  type ContextualDomainEvidenceDraft,
  type ContextualProvenanceDraft,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
  adaptContextualRelationship,
  buildGovernedContextualObservationPayload,
  governedContextualInputSha256,
  type GovernedContextualObservationCore,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import {
  buildRelationshipInputRecord,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputRecordDraft,
  type RelationshipInputSourceAssertionDraft,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  buildTypedRelationshipRarityIndex,
  decodeTypedRelationshipEdge,
  decodeTypedRelationshipPairEvaluation,
  decodeTypedRelationshipRarityIndex,
  evaluateTypedContextualRelationships,
  evaluateTypedRelationshipPair,
} from '../../src/caseGraph/typedRelationshipEngine';

const address = (index: number) => `sighting:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const binding = (count: number, overrides: Partial<RelationshipInputUniverseBinding> = {}): RelationshipInputUniverseBinding => ({
  snapshotId: '00000000-0000-4000-8000-000000000099',
  corpusVersion: 'typed-relationship-test-v2',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: count,
  ...overrides,
});

const origin = (sourceAddress: string, sourceField = 'structured.value'): RelationshipInputOriginDraft => ({
  sourceAddress,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'typed-relationship-fixture-v1' },
});

const termFact = (
  family: 'visual' | 'behavioural' | 'sensory',
  value: string,
  sourceAddress: string,
  predicate = `observed_${family}`,
): RelationshipInputFactDraft => ({
  family,
  predicate,
  value: { kind: 'term', termId: value, vocabularyVersion: `${family}-v2` },
  confidence: 0.95,
  uncertainty: { level: 'low', reasons: ['single_report'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(sourceAddress, `${family}.${value}`)],
});

const governedFact = (
  family: 'entity' | 'site',
  value: string,
  sourceAddress: string,
): RelationshipInputFactDraft => ({
  family,
  predicate: family === 'entity' ? 'mentions_entity' : 'mentions_site',
  value: { kind: 'governed_reference', governedId: value, registryVersion: `${family}-registry-v2` },
  confidence: 0.96,
  uncertainty: { level: 'low', reasons: ['alias_reviewed'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-registry-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(sourceAddress, `${family}.${value}`)],
});

const narrativeFact = (value: string, sourceAddress: string): RelationshipInputFactDraft => ({
  family: 'narrative_pattern',
  predicate: 'governed_narrative_pattern',
  value: { kind: 'narrative_pattern', patternId: value, registryVersion: 'narrative-registry-v2' },
  confidence: 0.9,
  uncertainty: { level: 'low', reasons: ['pattern_reviewed'] },
  precision: { kind: 'categorical', vocabularyVersion: 'narrative-registry-v2' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(sourceAddress, `narrative.${value}`)],
});

const timestampFact = (
  timestamp: string,
  sourceAddress: string,
  precision: RelationshipInputFactDraft['precision'] = { kind: 'exact' },
): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_timestamp',
  value: { kind: 'timestamp', timestamp, datePrecision: 'exact' },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['clock_rounding'] },
  precision,
  missingness: { status: 'present', reasons: [] },
  origins: [origin(sourceAddress, 'event.timestamp')],
});

const locationFact = (
  lat: number,
  lon: number,
  sourceAddress: string,
  spatialPrecisionKm = 1,
): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_location',
  value: { kind: 'geo_point', lat, lon, spatialPrecisionKm },
  confidence: 0.95,
  uncertainty: { level: 'low', reasons: ['coordinate_rounding'] },
  precision: { kind: 'approximate', unit: 'km', tolerance: spatialPrecisionKm },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(sourceAddress, 'event.location')],
});

const durationFact = (
  seconds: number,
  sourceAddress: string,
  tolerance = 1,
): RelationshipInputFactDraft => ({
  family: 'duration',
  predicate: 'observed_duration',
  value: { kind: 'duration', seconds },
  confidence: 0.94,
  uncertainty: { level: 'low', reasons: ['witness_rounding'] },
  precision: tolerance === 0
    ? { kind: 'exact' }
    : { kind: 'approximate', unit: 'seconds', tolerance },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(sourceAddress, 'event.duration')],
});

const missingFact = (
  family: 'visual' | 'behavioural' | 'sensory' | 'duration',
): RelationshipInputFactDraft => ({
  family,
  predicate: `${family}_not_recorded`,
  value: null,
  confidence: null,
  uncertainty: { level: 'unknown', reasons: ['source_omitted'] },
  precision: { kind: 'unknown' },
  missingness: { status: 'not_recorded', reasons: ['source_omitted'] },
  origins: [],
});

type RecordOptions = {
  sourceId?: string;
  lineageId?: string;
  dependencyRisk?: RelationshipInputRecord['source']['dependencyRisk'];
  sourceRecordId?: string | null;
  facts?: RelationshipInputFactDraft[];
  sourceAssertions?: RelationshipInputSourceAssertionDraft[];
  crossReferences?: RelationshipInputRecordDraft['crossReferences'];
  duplicateLineage?: RelationshipInputRecordDraft['duplicateLineage'];
};

const record = (index: number, count: number, options: RecordOptions = {}) => {
  const recordAddress = address(index);
  const facts = options.facts || [];
  const governedReferences = facts.flatMap((fact) => {
    if ((fact.family !== 'entity' && fact.family !== 'site') || fact.value?.kind !== 'governed_reference') return [];
    return [{
      governedId: fact.value.governedId,
      kind: fact.family,
      registryVersion: fact.value.registryVersion,
      label: `Label for ${fact.value.governedId}`,
      origins: fact.origins,
    }];
  });
  return buildRelationshipInputRecord({
    binding: binding(count),
    address: recordAddress,
    source: {
      sourceId: options.sourceId || `source-${index}`,
      sourceRecordId: options.sourceRecordId === undefined ? `record-${index}` : options.sourceRecordId,
      registryVersion: 'source-registry-v2',
      lineageId: options.lineageId || `lineage-${index}`,
      dependencyRisk: options.dependencyRisk || 'low',
    },
    facts,
    recordMissingness: [],
    duplicateLineage: options.duplicateLineage || null,
    crossReferences: options.crossReferences || [],
    sourceAssertions: options.sourceAssertions || [],
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
  });
};

const assertions = (
  sourceAddress: string,
  counterpartySourceId: string,
  classification: 'independent' | 'dependent' = 'independent',
): RelationshipInputSourceAssertionDraft[] => [{
  counterpartySourceId,
  classification,
  basis: classification === 'independent' ? 'documented_separate_origin' : 'explicit_upstream',
  origins: [origin(sourceAddress, 'source.independence')],
}];

const withDistractors = (
  leftOptions: RecordOptions,
  rightOptions: RecordOptions,
  count = 8,
) => {
  const left = record(1, count, leftOptions);
  const right = record(2, count, rightOptions);
  const families = new Set([...left.facts, ...right.facts].map((fact) => fact.family));
  const extras: RelationshipInputRecord[] = [];
  for (let index = 3; index <= count; index += 1) {
    const recordAddress = address(index);
    const facts: RelationshipInputFactDraft[] = [];
    if (families.has('visual')) facts.push(termFact('visual', `visual-${index}`, recordAddress));
    if (families.has('behavioural')) facts.push(termFact('behavioural', `behaviour-${index}`, recordAddress));
    if (families.has('sensory')) facts.push(termFact('sensory', `sensory-${index}`, recordAddress));
    if (families.has('entity')) facts.push(governedFact('entity', `entity:${index}`, recordAddress));
    if (families.has('site')) facts.push(governedFact('site', `site:${index}`, recordAddress));
    if (families.has('narrative_pattern')) facts.push(narrativeFact(`pattern-${index}`, recordAddress));
    extras.push(record(index, count, { facts }));
  }
  const records = [left, right, ...extras];
  return { left, right, records, rarity: buildTypedRelationshipRarityIndex(records, binding(count)) };
};

describe('typed relationship engine v2', () => {
  it('builds a complete, coverage-aware, byte-stable rarity receipt and rejects partial or tampered indexes', () => {
    const fixture = withDistractors({
      facts: [termFact('visual', 'triangle', address(1))],
    }, {
      facts: [termFact('visual', 'triangle', address(2))],
    });
    const reversed = buildTypedRelationshipRarityIndex([...fixture.records].reverse(), binding(8));

    expect(reversed).toEqual(fixture.rarity);
    expect(fixture.rarity.entries.find((entry) => entry.valueId === 'triangle')).toMatchObject({
      documentFrequency: 2,
      eligibleRecordCount: 8,
      corpusRecordCount: 8,
      coverage: 1,
    });
    expect(decodeTypedRelationshipRarityIndex(fixture.rarity, binding(8))).toEqual(fixture.rarity);
    expect(() => buildTypedRelationshipRarityIndex(fixture.records.slice(0, 7), binding(8)))
      .toThrow('typed_relationship_rarity_incomplete_corpus');

    const tampered = structuredClone(fixture.rarity);
    tampered.entries[0].effectiveRarity = tampered.entries[0].effectiveRarity === 1 ? 0.5 : 1;
    expect(() => decodeTypedRelationshipRarityIndex(tampered, binding(8)))
      .toThrow('typed_relationship_rarity_metric_mismatch');
  });

  it('emits one deterministic duplicate-provenance receipt and labels it dependent, never corroborating', () => {
    const count = 4;
    const clusterId = 'duplicate:cluster-101';
    const provenanceFact = (recordAddress: string): RelationshipInputFactDraft => ({
      family: 'provenance',
      predicate: 'duplicate_cluster_membership',
      value: { kind: 'provenance', code: 'duplicate_cluster', referenceId: clusterId },
      confidence: 1,
      uncertainty: { level: 'none', reasons: [] },
      precision: { kind: 'exact' },
      missingness: { status: 'present', reasons: [] },
      origins: [origin(recordAddress, 'duplicate.cluster')],
    });
    const left = record(1, count, {
      facts: [provenanceFact(address(1))],
      duplicateLineage: {
        clusterId,
        status: 'confirmed',
        canonicalAddress: address(1),
        memberRole: 'canonical',
        origins: [origin(address(1), 'duplicate.cluster')],
      },
    });
    const right = record(2, count, {
      facts: [provenanceFact(address(2))],
      duplicateLineage: {
        clusterId,
        status: 'confirmed',
        canonicalAddress: address(1),
        memberRole: 'duplicate',
        origins: [origin(address(2), 'duplicate.cluster')],
      },
    });
    const records = [left, right, record(3, count), record(4, count)];
    const rarity = buildTypedRelationshipRarityIndex(records, binding(count));
    const forward = evaluateTypedRelationshipPair({ left, right, rarityIndex: rarity, expectedBinding: binding(count) });
    const reverse = evaluateTypedRelationshipPair({ left: right, right: left, rarityIndex: rarity, expectedBinding: binding(count) });

    expect(reverse).toEqual(forward);
    expect(forward.edges.find((edge) => edge.edgeType === 'duplicate_provenance')).toMatchObject({
      strength: 100,
      receipt: {
        dependency: { classification: 'dependent' },
        claimDiscipline: TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
      },
    });
    expect(forward.edges.some((edge) => edge.edgeType === 'source_independence')).toBe(false);
    expect(forward.edges.find((edge) => edge.edgeType === 'duplicate_provenance')?.receipt.plainEnglish)
      .toContain('must not be counted as independent corroboration');
  });

  it('never converts missing facts, negated predicates, or one common characteristic into a similarity edge', () => {
    const uncertainLeft = termFact('behavioural', 'erratic-motion', address(1));
    uncertainLeft.uncertainty = { level: 'high', reasons: ['ambiguous_wording'] };
    const uncertainRight = termFact('behavioural', 'erratic-motion', address(2));
    uncertainRight.uncertainty = { level: 'high', reasons: ['ambiguous_wording'] };
    const fixture = withDistractors({
      facts: [
        termFact('visual', 'triangle', address(1), 'not_observed_shape'),
        missingFact('sensory'),
        uncertainLeft,
      ],
    }, {
      facts: [
        termFact('visual', 'triangle', address(2)),
        missingFact('sensory'),
        uncertainRight,
      ],
    });
    const evaluation = evaluateTypedRelationshipPair({
      left: fixture.left,
      right: fixture.right,
      rarityIndex: fixture.rarity,
      expectedBinding: binding(8),
    });

    expect(evaluation.edges.some((edge) => [
      'shared_visual', 'shared_behavioural', 'shared_sensory',
    ].includes(edge.edgeType))).toBe(false);
    expect(evaluation.rejections.find((item) => item.edgeType === 'shared_visual')?.reasonCodes)
      .toContain('no_qualified_rare_match');
    expect(evaluation.rejections.find((item) => item.edgeType === 'shared_sensory')?.reasonCodes)
      .toContain('no_qualified_rare_match');
    expect(evaluation.rejections.find((item) => item.edgeType === 'shared_behavioural')?.reasonCodes)
      .toContain('no_qualified_rare_match');
  });

  it('emits separately typed visual, behavioural, sensory, entity, site, and narrative-pattern edges only with rare structured support', () => {
    const leftFacts = [
      termFact('visual', 'amber-triangle', address(1)),
      termFact('visual', 'three-fixed-lights', address(1)),
      termFact('behavioural', 'hover-then-depart', address(1)),
      termFact('behavioural', 'right-angle-turn', address(1)),
      termFact('sensory', 'radio-interference', address(1)),
      termFact('sensory', 'engine-stall', address(1)),
      governedFact('entity', 'entity:flight-101', address(1)),
      governedFact('site', 'site:raf-bentwaters', address(1)),
      narrativeFact('pattern:light-sequence', address(1)),
    ];
    const rightFacts = [
      termFact('visual', 'amber-triangle', address(2)),
      termFact('visual', 'three-fixed-lights', address(2)),
      termFact('behavioural', 'hover-then-depart', address(2)),
      termFact('behavioural', 'right-angle-turn', address(2)),
      termFact('sensory', 'radio-interference', address(2)),
      termFact('sensory', 'engine-stall', address(2)),
      governedFact('entity', 'entity:flight-101', address(2)),
      governedFact('site', 'site:raf-bentwaters', address(2)),
      narrativeFact('pattern:light-sequence', address(2)),
    ];
    const fixture = withDistractors({
      sourceId: 'source-left',
      facts: leftFacts,
      sourceAssertions: assertions(address(1), 'source-right'),
    }, {
      sourceId: 'source-right',
      facts: rightFacts,
      sourceAssertions: assertions(address(2), 'source-left'),
    });
    const evaluation = evaluateTypedRelationshipPair({
      left: fixture.left,
      right: fixture.right,
      rarityIndex: fixture.rarity,
      expectedBinding: binding(8),
    });
    const types = evaluation.edges.map((edge) => edge.edgeType);

    expect(types).toEqual(expect.arrayContaining([
      'shared_visual',
      'shared_behavioural',
      'shared_sensory',
      'shared_entity',
      'shared_site',
      'shared_narrative_pattern',
      'source_independence',
    ]));
    for (const edge of evaluation.edges.filter((candidate) => candidate.edgeType.startsWith('shared_'))) {
      expect(edge.receipt.policySha256).toBe(TYPED_RELATIONSHIP_POLICY_SHA256);
      expect(edge.receipt.reasons.length).toBeGreaterThan(0);
      expect(edge.receipt.factEvidence.length).toBeGreaterThan(0);
      expect(edge.receipt.rarity.every((entry) => entry.effectiveRarity >= 0.45)).toBe(true);
      expect(edge.receipt.plainEnglish).toContain('does not establish causation');
    }
  });

  it('requires reciprocal governed assertions for independence and lets a dependency override conflicting independence claims', () => {
    const oneSided = withDistractors({
      sourceId: 'source-left',
      sourceAssertions: assertions(address(1), 'source-right'),
    }, { sourceId: 'source-right' });
    const oneSidedEvaluation = evaluateTypedRelationshipPair({
      left: oneSided.left,
      right: oneSided.right,
      rarityIndex: oneSided.rarity,
      expectedBinding: binding(8),
    });
    expect(oneSidedEvaluation.dependency.classification).toBe('unknown');
    expect(oneSidedEvaluation.edges.some((edge) => edge.edgeType === 'source_independence')).toBe(false);

    const dependent = withDistractors({
      sourceId: 'source-left',
      lineageId: 'shared-lineage',
      sourceAssertions: assertions(address(1), 'source-right'),
    }, {
      sourceId: 'source-right',
      lineageId: 'shared-lineage',
      sourceAssertions: assertions(address(2), 'source-left'),
    });
    const dependentEvaluation = evaluateTypedRelationshipPair({
      left: dependent.left,
      right: dependent.right,
      rarityIndex: dependent.rarity,
      expectedBinding: binding(8),
    });
    expect(dependentEvaluation.dependency.classification).toBe('dependent');
    expect(dependentEvaluation.edges.map((edge) => edge.edgeType)).toContain('source_dependency');
    expect(dependentEvaluation.edges.map((edge) => edge.edgeType)).not.toContain('source_independence');

    const cited = withDistractors({
      sourceId: 'source-left',
      sourceAssertions: assertions(address(1), 'source-right'),
      crossReferences: [{
        targetAddress: address(2),
        relation: 'cites',
        origins: [origin(address(1), 'references.citation')],
      }],
    }, {
      sourceId: 'source-right',
      sourceAssertions: assertions(address(2), 'source-left'),
    });
    const citedEvaluation = evaluateTypedRelationshipPair({
      left: cited.left,
      right: cited.right,
      rarityIndex: cited.rarity,
      expectedBinding: binding(8),
    });
    expect(citedEvaluation.dependency.classification).toBe('dependent');
    expect(citedEvaluation.dependency.reasons.map((item) => item.code)).toContain('explicit_record_dependency');
    expect(citedEvaluation.edges.map((edge) => edge.edgeType)).not.toContain('source_independence');
  });

  it('emits bounded space-time candidates only with usable precision and an independent rare safeguard', () => {
    const fixture = withDistractors({
      sourceId: 'source-left',
      sourceAssertions: assertions(address(1), 'source-right'),
      facts: [
        timestampFact('2026-07-18T10:00:00.000Z', address(1)),
        locationFact(51.5, -0.1, address(1)),
        termFact('visual', 'amber-triangle', address(1)),
      ],
    }, {
      sourceId: 'source-right',
      sourceAssertions: assertions(address(2), 'source-left'),
      facts: [
        timestampFact('2026-07-18T10:05:00.000Z', address(2)),
        locationFact(51.51, -0.09, address(2)),
        termFact('visual', 'amber-triangle', address(2)),
      ],
    });
    const evaluation = evaluateTypedRelationshipPair({
      left: fixture.left,
      right: fixture.right,
      rarityIndex: fixture.rarity,
      expectedBinding: binding(8),
    });
    const edge = evaluation.edges.find((candidate) => candidate.edgeType === 'space_time_candidate');

    expect(edge?.receipt.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      'bounded_temporal_proximity',
      'bounded_spatial_proximity',
      'space_time_structured_support',
    ]));
    expect(edge?.receipt.plainEnglish).toContain('does not assert that they describe the same incident');

    const coarse = withDistractors({
      sourceId: 'source-left',
      sourceAssertions: assertions(address(1), 'source-right'),
      facts: [
        timestampFact('2026-07-18T10:00:00.000Z', address(1), { kind: 'unknown' }),
        locationFact(51.5, -0.1, address(1), 250),
        termFact('visual', 'amber-triangle', address(1)),
      ],
    }, {
      sourceId: 'source-right',
      sourceAssertions: assertions(address(2), 'source-left'),
      facts: [
        timestampFact('2026-07-18T10:00:00.000Z', address(2), { kind: 'unknown' }),
        locationFact(51.5, -0.1, address(2), 250),
        termFact('visual', 'amber-triangle', address(2)),
      ],
    });
    const coarseEvaluation = evaluateTypedRelationshipPair({
      left: coarse.left,
      right: coarse.right,
      rarityIndex: coarse.rarity,
      expectedBinding: binding(8),
    });
    expect(coarseEvaluation.edges.some((candidate) => candidate.edgeType === 'space_time_candidate')).toBe(false);
    expect(coarseEvaluation.rejections.find((item) => item.edgeType === 'space_time_candidate')?.reasonCodes)
      .toContain('space_time_facts_missing_or_imprecise');
  });

  it('does not let duration similarity stand alone and records both duration precision and its structured support', () => {
    const unsupported = withDistractors({
      facts: [durationFact(60, address(1))],
    }, {
      facts: [durationFact(62, address(2))],
    });
    const unsupportedEvaluation = evaluateTypedRelationshipPair({
      left: unsupported.left,
      right: unsupported.right,
      rarityIndex: unsupported.rarity,
      expectedBinding: binding(8),
    });
    expect(unsupportedEvaluation.edges.some((edge) => edge.edgeType === 'similar_duration')).toBe(false);
    expect(unsupportedEvaluation.rejections.find((item) => item.edgeType === 'similar_duration')?.reasonCodes)
      .toContain('duration_requires_structured_support');

    const supported = withDistractors({
      facts: [durationFact(60, address(1)), termFact('visual', 'amber-triangle', address(1))],
    }, {
      facts: [durationFact(62, address(2)), termFact('visual', 'amber-triangle', address(2))],
    });
    const supportedEvaluation = evaluateTypedRelationshipPair({
      left: supported.left,
      right: supported.right,
      rarityIndex: supported.rarity,
      expectedBinding: binding(8),
    });
    const edge = supportedEvaluation.edges.find((candidate) => candidate.edgeType === 'similar_duration');
    expect(edge?.receipt.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      'bounded_duration_similarity',
      'duration_structured_support',
    ]));
  });

  it('fails closed on mixed universe bindings before evaluating any relationship', () => {
    const fixture = withDistractors({ facts: [] }, { facts: [] });
    const wrong = binding(8, { universeArchiveSetSha256: 'b'.repeat(64) });
    expect(() => evaluateTypedRelationshipPair({
      left: fixture.left,
      right: fixture.right,
      rarityIndex: fixture.rarity,
      expectedBinding: wrong,
    })).toThrow('relationship_input_snapshot_binding_mismatch');
  });

  it('decodes pair and edge receipts against the exact deterministic model and rejects identity tampering', () => {
    const fixture = withDistractors({
      facts: [termFact('visual', 'amber-triangle', address(1))],
    }, {
      facts: [termFact('visual', 'amber-triangle', address(2))],
    });
    const evaluation = evaluateTypedRelationshipPair({
      left: fixture.left,
      right: fixture.right,
      rarityIndex: fixture.rarity,
      expectedBinding: binding(8),
    });
    expect(evaluation.model).toEqual(TYPED_RELATIONSHIP_MODEL);
    expect(TYPED_RELATIONSHIP_MODEL_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(decodeTypedRelationshipPairEvaluation(evaluation, binding(8))).toEqual(evaluation);
    for (const edge of evaluation.edges) {
      expect(edge.receipt.model).toEqual(TYPED_RELATIONSHIP_MODEL);
      expect(decodeTypedRelationshipEdge(edge, binding(8))).toEqual(edge);
    }

    const modelTamper = structuredClone(evaluation);
    (modelTamper.model as unknown as { modelVersion: string }).modelVersion = 'forged-v9';
    expect(() => decodeTypedRelationshipPairEvaluation(modelTamper, binding(8)))
      .toThrow('typed_relationship_pair_evaluation_invalid');

    const policyTamper = structuredClone(evaluation);
    policyTamper.policySha256 = 'f'.repeat(64);
    expect(() => decodeTypedRelationshipPairEvaluation(policyTamper, binding(8)))
      .toThrow('typed_relationship_pair_evaluation_invalid');

    const unknown = structuredClone(evaluation) as unknown as Record<string, unknown>;
    unknown.unreviewed = true;
    expect(() => decodeTypedRelationshipPairEvaluation(unknown, binding(8)))
      .toThrow('typed_relationship_pair_evaluation_invalid');
  });
});

const contextModel = () => ({
  modelId: 'deterministic-context-adapter',
  modelVersion: '1.0.0',
  method: 'deterministic' as const,
  inputSha256: contextualExplanationSha256('context-model-input'),
  outputSha256: contextualExplanationSha256('context-model-output'),
});

const contextualProvenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId: role === 'subject_observation' ? 'uapfiles' : 'adsb-registry',
  sourceRecordId: `${sourceRef}-record`,
  datasetVersion: 'context-2026-07-18',
  retrievedAt: '2026-07-18T00:00:00.000Z',
  contentSha256: contextualExplanationSha256(`${sourceRef}-content`),
  sourceUri: `https://example.test/${sourceRef}`,
});

const contextualFixture = (tooFar = false) => {
  const recordAddress = address(1);
  const count = 1;
  const contextOrigins = [origin(recordAddress, 'event.observation'), origin(recordAddress, 'context.aircraft')];
  const placeholderFact: RelationshipInputFactDraft = {
    family: 'contextual_explanation',
    predicate: 'contextual_explanation_candidate',
    value: {
      kind: 'contextual_explanation',
      explanationType: 'aircraft',
      referenceId: 'adsb:flight-101',
      matchStatus: 'candidate',
      interpretation: 'candidate_explanation_not_causal_attribution',
      metrics: {
        adapter_version: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
        governed_payload_schema_version: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
        context_input_sha256: '0'.repeat(64),
        context_policy_version: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
        context_policy_sha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
        model_input_sha256: contextModel().inputSha256,
        model_output_sha256: contextModel().outputSha256,
      },
    },
    confidence: 0.82,
    uncertainty: { level: 'low', reasons: ['bounded_observation_precision'] },
    precision: { kind: 'bounded', unit: 'seconds', lower: 0, upper: 60 },
    missingness: { status: 'present', reasons: [] },
    origins: contextOrigins,
  };
  const baseDraft = (fact: RelationshipInputFactDraft): RelationshipInputRecordDraft => ({
    binding: binding(count),
    address: recordAddress,
    source: {
      sourceId: 'uapfiles',
      sourceRecordId: 'case-001',
      registryVersion: 'source-registry-v2',
      lineageId: 'uapfiles-lineage',
      dependencyRisk: 'low',
    },
    facts: [fact],
    recordMissingness: [],
    duplicateLineage: null,
    crossReferences: [],
    sourceAssertions: [],
    narrativeVector: {
      status: 'missing', modelId: 'narrative-model', modelVersion: 'v2', dimensions: 16,
      normalization: 'l2', inputSha256: null, vectorSha256: null, reason: 'no_narrative',
    },
    governedReferences: [],
  });
  const preliminary = buildRelationshipInputRecord(baseDraft(placeholderFact));
  const preliminaryFact = preliminary.facts[0];
  const domainEvidence: ContextualDomainEvidenceDraft[] = [{
    code: 'track_coverage_fraction',
    value: 0.95,
    precision: 0.02,
    method: 'catalogue',
    methodVersion: 'adsb-track-v1',
    sourceRefs: ['context-source'],
  }];
  const core: GovernedContextualObservationCore = {
    kind: 'aircraft',
    binding: binding(count),
    address: recordAddress,
    originBindings: [
      { originId: preliminaryFact.origins.find((item) => item.sourceField === 'event.observation')?.originId as string, sourceRef: 'subject-source' },
      { originId: preliminaryFact.origins.find((item) => item.sourceField === 'context.aircraft')?.originId as string, sourceRef: 'context-source' },
    ],
    reference: { referenceId: 'adsb:flight-101', label: 'Flight 101' },
    subjectObservation: {
      window: { start: '2026-07-18T10:00:00.000Z', end: '2026-07-18T10:00:20.000Z', precisionSeconds: 5 },
      location: { lat: 51.5, lon: -0.1, precisionKm: 1 },
      skyPosition: { azimuthDeg: 100, elevationDeg: 30, precisionDeg: 1 },
    },
    referenceObservation: {
      window: {
        start: tooFar ? '2026-07-18T20:00:00.000Z' : '2026-07-18T10:00:30.000Z',
        end: tooFar ? '2026-07-18T20:00:10.000Z' : '2026-07-18T10:00:40.000Z',
        precisionSeconds: 2,
      },
      location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
      skyPosition: { azimuthDeg: 102, elevationDeg: 30, precisionDeg: 0.1 },
    },
    provenance: [
      contextualProvenance('subject-source', 'subject_observation'),
      contextualProvenance('context-source', 'context_reference'),
    ],
    domainEvidence,
    missingness: [],
    model: contextModel(),
  };
  const contextInputSha256 = governedContextualInputSha256(core);
  const finalFact = structuredClone(placeholderFact);
  if (finalFact.value?.kind !== 'contextual_explanation') throw new Error('fixture_context_value_missing');
  finalFact.value.metrics.context_input_sha256 = contextInputSha256;
  const finalRecord = buildRelationshipInputRecord(baseDraft(finalFact));
  const payload = buildGovernedContextualObservationPayload({ ...core, factId: finalRecord.facts[0].factId });
  const result = adaptContextualRelationship(finalRecord, payload, binding(count));
  return { record: finalRecord, result };
};

describe('typed contextual relationship integration', () => {
  it('does not emit from a raw contextual candidate and wraps only a governed adapter edge with its complete receipt', () => {
    const fixture = contextualFixture();
    expect(evaluateTypedContextualRelationships({
      record: fixture.record,
      adapterResults: [],
      expectedBinding: binding(1),
    })).toEqual([]);

    const edges = evaluateTypedContextualRelationships({
      record: fixture.record,
      adapterResults: [fixture.result],
      expectedBinding: binding(1),
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      edgeType: 'contextual_explanation_candidate',
      endpoints: [
        { kind: 'evidence', id: address(1) },
        { kind: 'context' },
      ],
      receipt: {
        contextualEvaluation: { decision: 'emit_candidate_edge' },
        dependency: { classification: 'unknown' },
      },
    });
    expect(edges[0].receipt.plainEnglish).toContain('candidate contextual correlation only');
    expect(edges[0].receipt.plainEnglish).toContain('not a causal attribution');
  });

  it('rejects an adapter result whose contextual policy found insufficient evidence and detects receipt tampering', () => {
    const rejected = contextualFixture(true);
    expect(rejected.result.evaluation.edge).toBeNull();
    expect(() => evaluateTypedContextualRelationships({
      record: rejected.record,
      adapterResults: [rejected.result],
      expectedBinding: binding(1),
    })).toThrow('typed_relationship_context_not_qualified');

    const accepted = contextualFixture();
    const tampered = structuredClone(accepted.result);
    tampered.sourceFact.metrics.context_input_sha256 = 'f'.repeat(64);
    expect(() => evaluateTypedContextualRelationships({
      record: accepted.record,
      adapterResults: [tampered],
      expectedBinding: binding(1),
    })).toThrow('typed_relationship_context_adapter_digest_mismatch');
  });
});
