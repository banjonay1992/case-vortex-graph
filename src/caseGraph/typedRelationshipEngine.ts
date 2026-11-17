import {
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  decodeContextualExplanationEdge,
  type ContextualExplanationReceipt,
} from './contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  type ContextualRelationshipAdapterResult,
} from './contextualRelationshipAdapter';
import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  assertRelationshipInputBinding,
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputFact,
  type RelationshipInputFactFamily,
  type RelationshipInputPrecision,
  type RelationshipInputRecord,
  type RelationshipInputTimestampValue,
  type RelationshipInputUniverseBinding,
  type RelationshipInputUncertaintyLevel,
} from './relationshipInputSnapshot';
import {
  MATCHABLE_FAMILIES,
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  TYPED_RELATIONSHIP_EDGE_TYPES,
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_ID,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_MODEL_VERSION,
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  TYPED_RELATIONSHIP_POLICY,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  type MatchableFact,
  type MatchableFamily,
  type SharedMatch,
  type TypedRelationshipCheck,
  type TypedRelationshipDependency,
  type TypedRelationshipEdge,
  type TypedRelationshipEdgeType,
  type TypedRelationshipEndpoint,
  type TypedRelationshipFactEvidence,
  type TypedRelationshipMissingnessReceipt,
  type TypedRelationshipPairEvaluation,
  type TypedRelationshipPairRejection,
  type TypedRelationshipRarityEntry,
  type TypedRelationshipRarityIndex,
  type TypedRelationshipReason,
  type TypedRelationshipReceipt,
} from './typedRelationshipModel';
export {
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  TYPED_RELATIONSHIP_EDGE_TYPES,
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_ID,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_MODEL_VERSION,
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  TYPED_RELATIONSHIP_POLICY,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
} from './typedRelationshipModel';
export type {
  TypedRelationshipCheck,
  TypedRelationshipDependency,
  TypedRelationshipEdge,
  TypedRelationshipEdgeType,
  TypedRelationshipEndpoint,
  TypedRelationshipFactEvidence,
  TypedRelationshipMissingnessReceipt,
  TypedRelationshipPairEvaluation,
  TypedRelationshipPairRejection,
  TypedRelationshipRarityEntry,
  TypedRelationshipRarityIndex,
  TypedRelationshipReason,
  TypedRelationshipReceipt,
} from './typedRelationshipModel';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NEGATED_PREDICATE = /(^|_)(?:no|not|without|absent|denied|denies|negated|ruled_out)(?:_|$)/;

const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const roundMetric = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isNegatedPredicate = (predicate: string) => NEGATED_PREDICATE.test(predicate.toLowerCase());

const uncertaintyWeight: Readonly<Record<RelationshipInputUncertaintyLevel, number>> = Object.freeze({
  none: 1,
  low: 0.9,
  medium: 0.65,
  high: 0.25,
  unknown: 0,
});

const uncertaintyRank: Readonly<Record<RelationshipInputUncertaintyLevel, number>> = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  unknown: 4,
});

const precisionWeight = (precision: RelationshipInputPrecision) => {
  switch (precision.kind) {
    case 'exact': return 1;
    case 'categorical': return 0.95;
    case 'bounded': return 0.85;
    case 'approximate': return 0.8;
    case 'unknown': return 0;
  }
};

const matchableIdentity = (fact: RelationshipInputFact): {
  family: MatchableFamily;
  valueId: string;
  registryVersion: string;
  valueKey: string;
} | null => {
  if (!MATCHABLE_FAMILIES.includes(fact.family as MatchableFamily) || fact.value === null) return null;
  let valueId: string;
  let registryVersion: string;
  if (fact.value.kind === 'term') {
    valueId = fact.value.termId;
    registryVersion = fact.value.vocabularyVersion;
  } else if (fact.value.kind === 'governed_reference') {
    valueId = fact.value.governedId;
    registryVersion = fact.value.registryVersion;
  } else if (fact.value.kind === 'narrative_pattern') {
    valueId = fact.value.patternId;
    registryVersion = fact.value.registryVersion;
  } else return null;
  const family = fact.family as MatchableFamily;
  return {
    family,
    valueId,
    registryVersion,
    valueKey: `value:${relationshipInputSha256({ family, valueId, registryVersion })}`,
  };
};

const categoricalPrecisionMatches = (fact: RelationshipInputFact, registryVersion: string) => (
  fact.precision.kind !== 'categorical' || fact.precision.vocabularyVersion === registryVersion
);

const factQuality = (fact: RelationshipInputFact) => {
  if (
    fact.value === null
    || fact.confidence === null
    || fact.missingness.status !== 'present'
    || isNegatedPredicate(fact.predicate)
  ) return 0;
  const identity = matchableIdentity(fact);
  if (identity && !categoricalPrecisionMatches(fact, identity.registryVersion)) return 0;
  return roundMetric(fact.confidence * uncertaintyWeight[fact.uncertainty.level] * precisionWeight(fact.precision));
};

const rarityWithoutDigest = (index: Omit<TypedRelationshipRarityIndex, 'indexDigest'>) => index;

const emptyEligibleCounts = (): Record<MatchableFamily, number> => ({
  visual: 0,
  behavioural: 0,
  sensory: 0,
  entity: 0,
  site: 0,
  narrative_pattern: 0,
});

const rarityValues = (documentFrequency: number, eligibleRecordCount: number, corpusRecordCount: number) => {
  const rawRarity = eligibleRecordCount <= 1
    ? 0
    : (eligibleRecordCount - documentFrequency) / (eligibleRecordCount - 1);
  const coverage = corpusRecordCount ? eligibleRecordCount / corpusRecordCount : 0;
  return {
    rawRarity: roundMetric(Math.max(0, Math.min(1, rawRarity))),
    coverage: roundMetric(Math.max(0, Math.min(1, coverage))),
    effectiveRarity: roundMetric(Math.max(0, Math.min(1, rawRarity * Math.sqrt(coverage)))),
  };
};

export const buildTypedRelationshipRarityIndex = (
  recordInputs: readonly RelationshipInputRecord[],
  expectedBinding: RelationshipInputUniverseBinding,
): TypedRelationshipRarityIndex => {
  const binding = validateRelationshipInputBinding(expectedBinding);
  const records = recordInputs.map((record) => decodeRelationshipInputRecord(record, binding))
    .sort((left, right) => lexical(left.address, right.address));
  if (records.length !== binding.universeRecordCount) invalid('typed_relationship_rarity_incomplete_corpus');
  if (new Set(records.map((record) => record.address)).size !== records.length) {
    invalid('typed_relationship_rarity_duplicate_address');
  }

  const eligibleRecordCounts = emptyEligibleCounts();
  const frequencies = new Map<string, {
    family: MatchableFamily;
    valueId: string;
    registryVersion: string;
    count: number;
  }>();
  for (const record of records) {
    const recordValues = new Map<string, ReturnType<typeof matchableIdentity>>();
    const eligibleFamilies = new Set<MatchableFamily>();
    for (const fact of record.facts) {
      const identity = matchableIdentity(fact);
      if (!identity || factQuality(fact) === 0) continue;
      eligibleFamilies.add(identity.family);
      recordValues.set(identity.valueKey, identity);
    }
    for (const family of eligibleFamilies) eligibleRecordCounts[family] += 1;
    for (const [valueKey, identity] of recordValues) {
      if (!identity) continue;
      const current = frequencies.get(valueKey);
      frequencies.set(valueKey, {
        family: identity.family,
        valueId: identity.valueId,
        registryVersion: identity.registryVersion,
        count: (current?.count || 0) + 1,
      });
    }
  }

  const entries = [...frequencies.entries()].map(([valueKey, value]) => {
    const eligibleRecordCount = eligibleRecordCounts[value.family];
    return {
      valueKey,
      family: value.family,
      valueId: value.valueId,
      registryVersion: value.registryVersion,
      documentFrequency: value.count,
      eligibleRecordCount,
      corpusRecordCount: records.length,
      ...rarityValues(value.count, eligibleRecordCount, records.length),
    };
  }).sort((left, right) => lexical(left.valueKey, right.valueKey));
  const withoutDigest: Omit<TypedRelationshipRarityIndex, 'indexDigest'> = {
    recordType: 'typed_relationship_rarity_index',
    schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    recordSetSha256: relationshipInputSha256(records.map((record) => ({
      address: record.address,
      recordDigest: record.recordDigest,
    }))),
    eligibleRecordCounts,
    entries,
  };
  return { ...withoutDigest, indexDigest: relationshipInputSha256(rarityWithoutDigest(withoutDigest)) };
};

export const createTypedRelationshipRarityAccumulator = (
  expectedBinding: RelationshipInputUniverseBinding,
) => {
  const binding = validateRelationshipInputBinding(expectedBinding);
  const eligibleRecordCounts = emptyEligibleCounts();
  const frequencies = new Map<string, {
    family: MatchableFamily;
    valueId: string;
    registryVersion: string;
    count: number;
  }>();
  const recordSet = createHash('sha256');
  recordSet.update('[');
  let recordCount = 0;
  let previousAddress = '';
  let finished = false;
  return {
    add(record: RelationshipInputRecord) {
      if (finished) invalid('typed_relationship_rarity_accumulator_finished');
      assertRelationshipInputBinding(record.binding, binding);
      if (previousAddress && previousAddress >= record.address) {
        invalid('typed_relationship_rarity_duplicate_or_unsorted_address');
      }
      if (recordCount) recordSet.update(',');
      recordSet.update(canonicalizeRelationshipInput({
        address: record.address,
        recordDigest: record.recordDigest,
      }));
      recordCount += 1;
      previousAddress = record.address;
      const recordValues = new Map<string, ReturnType<typeof matchableIdentity>>();
      const eligibleFamilies = new Set<MatchableFamily>();
      for (const fact of record.facts) {
        const identity = matchableIdentity(fact);
        if (!identity || factQuality(fact) === 0) continue;
        eligibleFamilies.add(identity.family);
        recordValues.set(identity.valueKey, identity);
      }
      for (const family of eligibleFamilies) eligibleRecordCounts[family] += 1;
      for (const [valueKey, identity] of recordValues) {
        if (!identity) continue;
        const current = frequencies.get(valueKey);
        frequencies.set(valueKey, {
          family: identity.family,
          valueId: identity.valueId,
          registryVersion: identity.registryVersion,
          count: (current?.count || 0) + 1,
        });
      }
    },
    finish(): TypedRelationshipRarityIndex {
      if (finished) invalid('typed_relationship_rarity_accumulator_finished');
      finished = true;
      if (recordCount !== binding.universeRecordCount) {
        invalid('typed_relationship_rarity_incomplete_corpus');
      }
      recordSet.update(']');
      const entries = [...frequencies.entries()].map(([valueKey, value]) => {
        const eligibleRecordCount = eligibleRecordCounts[value.family];
        return {
          valueKey,
          family: value.family,
          valueId: value.valueId,
          registryVersion: value.registryVersion,
          documentFrequency: value.count,
          eligibleRecordCount,
          corpusRecordCount: recordCount,
          ...rarityValues(value.count, eligibleRecordCount, recordCount),
        };
      }).sort((left, right) => lexical(left.valueKey, right.valueKey));
      const withoutDigest: Omit<TypedRelationshipRarityIndex, 'indexDigest'> = {
        recordType: 'typed_relationship_rarity_index',
        schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
        canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
        binding,
        recordSetSha256: recordSet.digest('hex'),
        eligibleRecordCounts,
        entries,
      };
      return {
        ...withoutDigest,
        indexDigest: relationshipInputSha256(rarityWithoutDigest(withoutDigest)),
      };
    },
  };
};

export const decodeTypedRelationshipRarityIndex = (
  input: unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): TypedRelationshipRarityIndex => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(String(input));
    } catch {
      invalid('typed_relationship_rarity_json_invalid');
    }
  }
  if (!isPlainObject(value)
    || value.recordType !== 'typed_relationship_rarity_index'
    || value.schemaVersion !== TYPED_RELATIONSHIP_RARITY_VERSION
    || value.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
    || !SHA256_PATTERN.test(String(value.recordSetSha256))
    || !SHA256_PATTERN.test(String(value.indexDigest))
    || !isPlainObject(value.eligibleRecordCounts)
    || !Array.isArray(value.entries)
  ) invalid('typed_relationship_rarity_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  if (expectedBinding) assertRelationshipInputBinding(binding, expectedBinding);
  const eligibleRecordCounts = emptyEligibleCounts();
  for (const family of MATCHABLE_FAMILIES) {
    const count = Number(value.eligibleRecordCounts[family]);
    if (!Number.isSafeInteger(count) || count < 0 || count > binding.universeRecordCount) {
      invalid('typed_relationship_rarity_eligible_count_invalid');
    }
    eligibleRecordCounts[family] = count;
  }
  const entries = value.entries.map((raw): TypedRelationshipRarityEntry => {
    if (!isPlainObject(raw) || !MATCHABLE_FAMILIES.includes(raw.family as MatchableFamily)) {
      return invalid('typed_relationship_rarity_entry_invalid');
    }
    const family = raw.family as MatchableFamily;
    const valueId = String(raw.valueId);
    const registryVersion = String(raw.registryVersion);
    const valueKey = `value:${relationshipInputSha256({ family, valueId, registryVersion })}`;
    const documentFrequency = Number(raw.documentFrequency);
    const eligibleRecordCount = Number(raw.eligibleRecordCount);
    const corpusRecordCount = Number(raw.corpusRecordCount);
    if (
      raw.valueKey !== valueKey
      || !valueId.length
      || !registryVersion.length
      || !Number.isSafeInteger(documentFrequency)
      || documentFrequency < 1
      || !Number.isSafeInteger(eligibleRecordCount)
      || eligibleRecordCount !== eligibleRecordCounts[family]
      || documentFrequency > eligibleRecordCount
      || corpusRecordCount !== binding.universeRecordCount
    ) invalid('typed_relationship_rarity_entry_invalid');
    const computed = rarityValues(documentFrequency, eligibleRecordCount, corpusRecordCount);
    if (
      raw.rawRarity !== computed.rawRarity
      || raw.coverage !== computed.coverage
      || raw.effectiveRarity !== computed.effectiveRarity
    ) invalid('typed_relationship_rarity_metric_mismatch');
    return {
      valueKey,
      family,
      valueId,
      registryVersion,
      documentFrequency,
      eligibleRecordCount,
      corpusRecordCount,
      ...computed,
    };
  }).sort((left, right) => lexical(left.valueKey, right.valueKey));
  if (new Set(entries.map((entry) => entry.valueKey)).size !== entries.length) {
    invalid('typed_relationship_rarity_duplicate_entry');
  }
  const withoutDigest: Omit<TypedRelationshipRarityIndex, 'indexDigest'> = {
    recordType: 'typed_relationship_rarity_index',
    schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    recordSetSha256: String(value.recordSetSha256),
    eligibleRecordCounts,
    entries,
  };
  const indexDigest = relationshipInputSha256(rarityWithoutDigest(withoutDigest));
  if (value.indexDigest !== indexDigest) invalid('typed_relationship_rarity_digest_mismatch');
  const decoded = { ...withoutDigest, indexDigest };
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(decoded)) {
    invalid('typed_relationship_rarity_noncanonical');
  }
  return decoded;
};

const selectedMatchableFacts = (record: RelationshipInputRecord) => {
  const selected = new Map<string, MatchableFact>();
  for (const fact of record.facts) {
    const identity = matchableIdentity(fact);
    const quality = factQuality(fact);
    if (!identity || quality === 0) continue;
    const current = selected.get(identity.valueKey);
    if (!current
      || quality > factQuality(current)
      || (quality === factQuality(current) && lexical(fact.factId, current.factId) < 0)
    ) selected.set(identity.valueKey, fact as MatchableFact);
  }
  return selected;
};

const sharedMatches = (
  left: RelationshipInputRecord,
  right: RelationshipInputRecord,
  rarityIndex: TypedRelationshipRarityIndex,
) => {
  const leftFacts = selectedMatchableFacts(left);
  const rightFacts = selectedMatchableFacts(right);
  const rarity = new Map(rarityIndex.entries.map((entry) => [entry.valueKey, entry]));
  const matches: SharedMatch[] = [];
  for (const [valueKey, leftFact] of leftFacts) {
    const rightFact = rightFacts.get(valueKey);
    const entry = rarity.get(valueKey);
    const identity = matchableIdentity(leftFact);
    if (!rightFact || !entry || !identity || rightFact.family !== leftFact.family) continue;
    matches.push({
      family: identity.family,
      valueKey,
      valueId: identity.valueId,
      registryVersion: identity.registryVersion,
      quality: Math.min(factQuality(leftFact), factQuality(rightFact)),
      left: leftFact,
      right: rightFact,
      rarity: entry,
    });
  }
  return matches.sort((leftMatch, rightMatch) => (
    lexical(leftMatch.family, rightMatch.family) || lexical(leftMatch.valueKey, rightMatch.valueKey)
  ));
};

const sourceAssertionsFor = (record: RelationshipInputRecord, counterpartySourceId: string) => record.sourceAssertions
  .filter((assertion) => assertion.counterpartySourceId === counterpartySourceId)
  .sort((left, right) => lexical(left.assertionId, right.assertionId));

const dependencyReason = (
  code: TypedRelationshipDependency['reasons'][number]['code'],
  evidenceIds: string[],
  plainEnglish: string,
): TypedRelationshipDependency['reasons'][number] => ({
  code,
  evidenceIds: [...new Set(evidenceIds)].sort(lexical),
  plainEnglish,
});

const resolveDependency = (
  left: RelationshipInputRecord,
  right: RelationshipInputRecord,
): TypedRelationshipDependency => {
  const reasons: TypedRelationshipDependency['reasons'] = [];
  if (left.source.sourceId === right.source.sourceId) {
    reasons.push(dependencyReason('same_source', [], 'Both records use the same governed source.'));
  }
  if (
    left.source.sourceId === right.source.sourceId
    && left.source.sourceRecordId !== null
    && left.source.sourceRecordId === right.source.sourceRecordId
  ) reasons.push(dependencyReason('same_source_record', [], 'Both records resolve to the same governed source record.'));
  if (left.source.lineageId === right.source.lineageId) {
    reasons.push(dependencyReason('same_lineage', [], 'Both sources share the same governed lineage.'));
  }
  if (left.duplicateLineage && right.duplicateLineage
    && left.duplicateLineage.clusterId === right.duplicateLineage.clusterId) {
    reasons.push(dependencyReason(
      'duplicate_lineage',
      [left.duplicateLineage.clusterId],
      'Both records belong to the same governed duplicate lineage.',
    ));
  }
  const directReferences = [
    ...left.crossReferences.filter((reference) => reference.targetAddress === right.address),
    ...right.crossReferences.filter((reference) => reference.targetAddress === left.address),
  ];
  if (directReferences.length) {
    reasons.push(dependencyReason(
      'explicit_record_dependency',
      directReferences.map((reference) => reference.referenceId),
      'A governed cross-reference records a direct citation, derivation, duplicate, same-record, or media dependency.',
    ));
  }

  const leftAssertions = sourceAssertionsFor(left, right.source.sourceId);
  const rightAssertions = sourceAssertionsFor(right, left.source.sourceId);
  const dependentAssertions = [...leftAssertions, ...rightAssertions]
    .filter((assertion) => assertion.classification === 'dependent');
  if (dependentAssertions.length) reasons.push(dependencyReason(
    'governed_dependent_assertion',
    dependentAssertions.map((assertion) => assertion.assertionId),
    'At least one governed source assertion classifies the sources as dependent.',
  ));
  const independentAssertions = [
    leftAssertions.filter((assertion) => assertion.classification === 'independent'),
    rightAssertions.filter((assertion) => assertion.classification === 'independent'),
  ] as const;
  if (dependentAssertions.length && independentAssertions.some((side) => side.length)) {
    reasons.push(dependencyReason(
      'conflicting_source_assertions',
      [...dependentAssertions, ...independentAssertions.flat()].map((assertion) => assertion.assertionId),
      'The governed source assertions conflict, so the pair cannot be treated as independent.',
    ));
  }
  const hardDependency = reasons.some((reason) => [
    'same_source', 'same_source_record', 'same_lineage', 'duplicate_lineage',
    'explicit_record_dependency', 'governed_dependent_assertion', 'conflicting_source_assertions',
  ].includes(reason.code));
  if (hardDependency) return { classification: 'dependent', reasons: reasons.sort((a, b) => lexical(a.code, b.code)) };

  const reciprocal = independentAssertions[0].length > 0 && independentAssertions[1].length > 0;
  const acceptableRisk = ['low', 'medium'].includes(left.source.dependencyRisk)
    && ['low', 'medium'].includes(right.source.dependencyRisk);
  if (reciprocal && acceptableRisk) {
    return {
      classification: 'independent',
      reasons: [dependencyReason(
        'reciprocal_governed_assertions',
        independentAssertions.flat().map((assertion) => assertion.assertionId),
        'Both governed sources assert a separately documented or reviewed origin.',
      )],
    };
  }
  if (reciprocal && !acceptableRisk) reasons.push(dependencyReason(
    'dependency_risk_not_low_enough',
    independentAssertions.flat().map((assertion) => assertion.assertionId),
    'A source dependency-risk classification prevents an independent-corroboration claim.',
  ));
  reasons.push(dependencyReason(
    'insufficient_independence_evidence',
    independentAssertions.flat().map((assertion) => assertion.assertionId),
    'Different sources or a one-sided assertion are not enough to establish independence.',
  ));
  return { classification: 'unknown', reasons: reasons.sort((a, b) => lexical(a.code, b.code)) };
};

const factEvidence = (record: RelationshipInputRecord, fact: RelationshipInputFact): TypedRelationshipFactEvidence => {
  const identity = matchableIdentity(fact);
  let valueKey = identity?.valueKey || `fact-value:${relationshipInputSha256(fact.value)}`;
  if (fact.value?.kind === 'duration') valueKey = `duration:${roundMetric(fact.value.seconds)}`;
  if (fact.value?.kind === 'timestamp') valueKey = `timestamp:${fact.value.timestamp}`;
  if (fact.value?.kind === 'geo_point') valueKey = `geo:${fact.value.lat}:${fact.value.lon}:${fact.value.spatialPrecisionKm}`;
  if (fact.value?.kind === 'contextual_explanation') {
    valueKey = `context:${fact.value.explanationType}:${fact.value.referenceId}`;
  }
  return {
    address: record.address,
    factId: fact.factId,
    family: fact.family,
    predicate: fact.predicate,
    valueKey,
    confidence: fact.confidence as number,
    uncertainty: fact.uncertainty,
    precision: fact.precision,
    originIds: fact.origins.map((origin) => origin.originId).sort(lexical),
  };
};

const missingnessFor = (
  records: readonly RelationshipInputRecord[],
  families: readonly RelationshipInputFactFamily[],
): TypedRelationshipMissingnessReceipt[] => records.flatMap((record) => record.facts
  .filter((fact) => families.includes(fact.family) && fact.missingness.status !== 'present')
  .map((fact) => ({
    address: record.address,
    family: fact.family,
    factId: fact.factId,
    status: fact.missingness.status as TypedRelationshipMissingnessReceipt['status'],
    reasons: [...fact.missingness.reasons].sort(lexical),
  }))).sort((left, right) => lexical(left.address, right.address)
    || lexical(left.family, right.family)
    || lexical(String(left.factId), String(right.factId)));

const summarizeUncertainty = (facts: readonly TypedRelationshipFactEvidence[]) => {
  let level: RelationshipInputUncertaintyLevel = 'none';
  const reasons = new Set<string>();
  for (const fact of facts) {
    if (uncertaintyRank[fact.uncertainty.level] > uncertaintyRank[level]) level = fact.uncertainty.level;
    for (const reason of fact.uncertainty.reasons) reasons.add(reason);
  }
  return { level, reasons: [...reasons].sort(lexical) };
};

const makeCheck = (
  code: string,
  actual: string | number | boolean,
  operator: TypedRelationshipCheck['operator'],
  threshold: string | number | boolean,
): TypedRelationshipCheck => ({ code, status: 'pass', actual, operator, threshold });

const edgeWithoutId = (edge: Omit<TypedRelationshipEdge, 'edgeId'>) => edge;
const receiptWithoutId = (receipt: Omit<TypedRelationshipReceipt, 'receiptId'>) => receipt;

const makeEdge = (params: {
  binding: RelationshipInputUniverseBinding;
  edgeType: TypedRelationshipEdgeType;
  endpoints: [TypedRelationshipEndpoint, TypedRelationshipEndpoint];
  inputRecordDigests: string[];
  rarityIndexDigest: string | null;
  strength: number;
  reasons: TypedRelationshipReason[];
  checks: TypedRelationshipCheck[];
  factEvidence: TypedRelationshipFactEvidence[];
  rarity: TypedRelationshipRarityEntry[];
  missingness: TypedRelationshipMissingnessReceipt[];
  dependency: TypedRelationshipDependency;
  contextualEvaluation?: ContextualExplanationReceipt | null;
  plainEnglish: string;
}): TypedRelationshipEdge => {
  const evidence = [...params.factEvidence].sort((left, right) => lexical(left.address, right.address)
    || lexical(left.factId, right.factId));
  const withoutReceiptId: Omit<TypedRelationshipReceipt, 'receiptId'> = {
    recordType: 'typed_relationship_receipt',
    schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    edgeType: params.edgeType,
    inputRecordDigests: [...params.inputRecordDigests].sort(lexical),
    rarityIndexDigest: params.rarityIndexDigest,
    policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
    policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
    model: TYPED_RELATIONSHIP_MODEL,
    reasons: [...params.reasons].map((reason) => ({
      ...reason,
      evidenceIds: [...new Set(reason.evidenceIds)].sort(lexical),
      metrics: Object.fromEntries(Object.entries(reason.metrics).sort(([left], [right]) => lexical(left, right))),
    })).sort((left, right) => lexical(left.code, right.code)
      || lexical(canonicalizeRelationshipInput(left), canonicalizeRelationshipInput(right))),
    checks: [...params.checks].sort((left, right) => lexical(left.code, right.code)),
    factEvidence: evidence,
    rarity: [...params.rarity].sort((left, right) => lexical(left.valueKey, right.valueKey)),
    missingness: [...params.missingness],
    uncertainty: summarizeUncertainty(evidence),
    dependency: params.dependency,
    contextualEvaluation: params.contextualEvaluation || null,
    claimDiscipline: TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
    plainEnglish: params.plainEnglish,
  };
  const receipt: TypedRelationshipReceipt = {
    ...withoutReceiptId,
    receiptId: `typed-receipt:${relationshipInputSha256(receiptWithoutId(withoutReceiptId))}`,
  };
  const withoutEdgeId: Omit<TypedRelationshipEdge, 'edgeId'> = {
    recordType: 'typed_relationship_edge',
    schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding: params.binding,
    edgeType: params.edgeType,
    endpoints: params.endpoints,
    strength: Math.max(0, Math.min(100, Math.round(params.strength))),
    receipt,
  };
  return {
    ...withoutEdgeId,
    edgeId: `typed-edge:${relationshipInputSha256(edgeWithoutId(withoutEdgeId))}`,
  };
};

const reason = (
  code: string,
  family: TypedRelationshipReason['family'],
  plainEnglish: string,
  evidenceIds: string[],
  metrics: TypedRelationshipReason['metrics'] = {},
): TypedRelationshipReason => ({ code, family, plainEnglish, evidenceIds, metrics });

const pairEndpoints = (
  left: RelationshipInputRecord,
  right: RelationshipInputRecord,
): [TypedRelationshipEndpoint, TypedRelationshipEndpoint] => [
  { kind: 'evidence', id: left.address },
  { kind: 'evidence', id: right.address },
];

const reasonEvidenceForMatch = (match: SharedMatch) => [match.left.factId, match.right.factId];

const edgeTypeForFamily: Readonly<Record<MatchableFamily, TypedRelationshipEdgeType>> = Object.freeze({
  visual: 'shared_visual',
  behavioural: 'shared_behavioural',
  sensory: 'shared_sensory',
  entity: 'shared_entity',
  site: 'shared_site',
  narrative_pattern: 'shared_narrative_pattern',
});

const plainFamily: Readonly<Record<MatchableFamily, string>> = Object.freeze({
  visual: 'visual terms',
  behavioural: 'behavioural terms',
  sensory: 'sensory terms',
  entity: 'governed entities',
  site: 'governed sites',
  narrative_pattern: 'governed narrative patterns',
});

const qualifiedMatch = (
  match: SharedMatch,
  rarity: number = TYPED_RELATIONSHIP_POLICY.minimumEffectiveRarity,
) => (
  match.quality >= TYPED_RELATIONSHIP_POLICY.minimumFactQuality
  && match.rarity.effectiveRarity >= rarity
);

const bestCorroborators = (matches: readonly SharedMatch[], excludedFamily: MatchableFamily) => matches
  .filter((match) => match.family !== excludedFamily
    && qualifiedMatch(match, TYPED_RELATIONSHIP_POLICY.minimumCrossFamilySupportRarity))
  .sort((left, right) => right.rarity.effectiveRarity - left.rarity.effectiveRarity
    || right.quality - left.quality
    || lexical(left.valueKey, right.valueKey));

const matchFactEvidence = (
  left: RelationshipInputRecord,
  right: RelationshipInputRecord,
  matches: readonly SharedMatch[],
) => matches.flatMap((match) => [factEvidence(left, match.left), factEvidence(right, match.right)]);

const categoricalEdge = (params: {
  family: MatchableFamily;
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  matches: SharedMatch[];
  allMatches: SharedMatch[];
  rarityIndex: TypedRelationshipRarityIndex;
  dependency: TypedRelationshipDependency;
}): { edge: TypedRelationshipEdge | null; rejection: string[] } => {
  const primary = params.matches.filter((match) => qualifiedMatch(match));
  const corroborators = bestCorroborators(params.allMatches, params.family);
  const strongest = primary[0];
  const twoPrimary = primary.length >= 2;
  const crossFamily = Boolean(
    strongest
    && strongest.rarity.effectiveRarity >= TYPED_RELATIONSHIP_POLICY.minimumSingleCrossFamilyRarity
    && corroborators.length,
  );
  const governedSingle = ['entity', 'site'].includes(params.family)
    && Boolean(strongest)
    && strongest.rarity.effectiveRarity >= TYPED_RELATIONSHIP_POLICY.minimumSingleGovernedRarity
    && (params.dependency.classification === 'independent' || corroborators.length > 0);
  const narrativeGate = params.family !== 'narrative_pattern'
    || twoPrimary
    || (crossFamily && params.dependency.classification === 'independent');
  const dependencyGate = params.dependency.classification !== 'dependent'
    || (twoPrimary && corroborators.length > 0);
  const gate = Boolean(strongest) && (twoPrimary || crossFamily || governedSingle)
    && narrativeGate && dependencyGate;
  if (!gate) {
    const rejection: string[] = [];
    if (!strongest) rejection.push('no_qualified_rare_match');
    if (strongest && !twoPrimary && !crossFamily && !governedSingle) rejection.push('single_common_characteristic');
    if (!narrativeGate) rejection.push('narrative_pattern_requires_structured_support');
    if (!dependencyGate) rejection.push('dependent_sources_require_stronger_support');
    return { edge: null, rejection: rejection.sort(lexical) };
  }
  const used = twoPrimary ? primary : [strongest];
  const support = twoPrimary ? [] : corroborators.slice(0, 1);
  const evidenceMatches = [...used, ...support];
  const reasons = used.map((match) => reason(
    `shared_${params.family}`,
    params.family,
    `Both records contain the same ${plainFamily[params.family]} value “${match.valueId}” under registry ${match.registryVersion}.`,
    reasonEvidenceForMatch(match),
    {
      value_key: match.valueKey,
      effective_rarity: match.rarity.effectiveRarity,
      corpus_coverage: match.rarity.coverage,
      fact_quality: match.quality,
    },
  ));
  for (const match of support) reasons.push(reason(
    'cross_family_corroborator',
    match.family,
    `A separate ${plainFamily[match.family]} match supplies the required cross-family support.`,
    reasonEvidenceForMatch(match),
    { effective_rarity: match.rarity.effectiveRarity, fact_quality: match.quality },
  ));
  const averageSignal = used.reduce((sum, match) => (
    sum + (match.quality * match.rarity.effectiveRarity)
  ), 0) / used.length;
  const strength = 38 + (averageSignal * 42) + (twoPrimary ? 8 : 0)
    + (params.dependency.classification === 'independent' ? 5 : 0)
    - (params.dependency.classification === 'dependent' ? 12 : 0);
  return {
    edge: makeEdge({
      binding: params.left.binding,
      edgeType: edgeTypeForFamily[params.family],
      endpoints: pairEndpoints(params.left, params.right),
      inputRecordDigests: [params.left.recordDigest, params.right.recordDigest],
      rarityIndexDigest: params.rarityIndex.indexDigest,
      strength,
      reasons,
      checks: [
        makeCheck('fact_quality', Math.min(...used.map((match) => match.quality)), 'greater_than_or_equal', TYPED_RELATIONSHIP_POLICY.minimumFactQuality),
        makeCheck('effective_rarity', Math.min(...used.map((match) => match.rarity.effectiveRarity)), 'greater_than_or_equal', TYPED_RELATIONSHIP_POLICY.minimumEffectiveRarity),
        makeCheck('false_positive_support', true, 'equal', true),
      ],
      factEvidence: matchFactEvidence(params.left, params.right, evidenceMatches),
      rarity: evidenceMatches.map((match) => match.rarity),
      missingness: missingnessFor([params.left, params.right], [params.family, ...support.map((match) => match.family)]),
      dependency: params.dependency,
      plainEnglish: `The records share bounded, provenance-backed ${plainFamily[params.family]} evidence that passed rarity, uncertainty, precision, dependency, and false-positive gates. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
    }),
    rejection: [],
  };
};

const provenanceEdges = (params: {
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  rarityIndex: TypedRelationshipRarityIndex;
  dependency: TypedRelationshipDependency;
}) => {
  const { left, right } = params;
  const directReferences = [
    ...left.crossReferences.filter((reference) => reference.targetAddress === right.address),
    ...right.crossReferences.filter((reference) => reference.targetAddress === left.address),
  ].sort((a, b) => lexical(a.referenceId, b.referenceId));
  const sameSourceRecord = left.source.sourceId === right.source.sourceId
    && left.source.sourceRecordId !== null
    && left.source.sourceRecordId === right.source.sourceRecordId;
  const sameDuplicateCluster = Boolean(left.duplicateLineage && right.duplicateLineage
    && left.duplicateLineage.clusterId === right.duplicateLineage.clusterId);
  const duplicateReferences = directReferences.filter((reference) => reference.relation === 'duplicate_of');
  const duplicate = sameDuplicateCluster || duplicateReferences.length > 0;
  const provenance = sameSourceRecord || directReferences.length > 0;
  if (!duplicate && !provenance) return { edge: null, duplicate: false };

  const reasons: TypedRelationshipReason[] = [];
  if (sameDuplicateCluster && left.duplicateLineage && right.duplicateLineage) reasons.push(reason(
    'duplicate_cluster_match',
    'provenance',
    `Both records belong to governed duplicate cluster ${left.duplicateLineage.clusterId}.`,
    [left.duplicateLineage.clusterId, ...left.duplicateLineage.origins.map((origin) => origin.originId), ...right.duplicateLineage.origins.map((origin) => origin.originId)],
    {
      cluster_status: left.duplicateLineage.status === 'confirmed' && right.duplicateLineage.status === 'confirmed'
        ? 'confirmed'
        : 'candidate',
    },
  ));
  if (sameSourceRecord) reasons.push(reason(
    'same_source_record',
    'provenance',
    'Both records resolve to the same governed source record.',
    [],
    { source_id: left.source.sourceId, source_record_id: left.source.sourceRecordId as string },
  ));
  for (const reference of directReferences) reasons.push(reason(
    `explicit_${reference.relation}`,
    'provenance',
    `A governed record explicitly declares the relation “${reference.relation}”.`,
    [reference.referenceId, ...reference.origins.map((origin) => origin.originId)],
    { relation: reference.relation },
  ));
  const provenanceFacts = [left, right].flatMap((record) => record.facts
    .filter((fact) => fact.family === 'provenance' && fact.missingness.status === 'present')
    .map((fact) => ({ record, fact })));
  const confirmed = sameSourceRecord || duplicateReferences.length > 0
    || (sameDuplicateCluster
      && left.duplicateLineage?.status === 'confirmed'
      && right.duplicateLineage?.status === 'confirmed');
  return {
    duplicate,
    edge: makeEdge({
      binding: left.binding,
      edgeType: duplicate ? 'duplicate_provenance' : 'provenance',
      endpoints: pairEndpoints(left, right),
      inputRecordDigests: [left.recordDigest, right.recordDigest],
      rarityIndexDigest: params.rarityIndex.indexDigest,
      strength: duplicate ? (confirmed ? 100 : 82) : (sameSourceRecord ? 100 : 92),
      reasons,
      checks: [makeCheck('governed_provenance_receipt', true, 'equal', true)],
      factEvidence: provenanceFacts.map(({ record, fact }) => factEvidence(record, fact)),
      rarity: [],
      missingness: missingnessFor([left, right], ['provenance']),
      dependency: params.dependency,
      plainEnglish: duplicate
        ? `The records are linked by governed duplicate provenance and must not be counted as independent corroboration. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`
        : `The records are directly linked by governed record provenance. This describes record lineage, not independent corroboration. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
    }),
  };
};

const timestampResolutionSeconds = (fact: RelationshipInputFact) => {
  if (fact.value?.kind !== 'timestamp') return null;
  const dateResolution: Record<RelationshipInputTimestampValue['datePrecision'], number> = {
    exact: 1,
    hour: 3_600,
    day: 86_400,
    month: Number.POSITIVE_INFINITY,
    year: Number.POSITIVE_INFINITY,
    unknown: Number.POSITIVE_INFINITY,
  };
  let declared = 0;
  if (fact.precision.kind === 'unknown' || fact.precision.kind === 'categorical') return null;
  if (fact.precision.kind === 'approximate') {
    const multiplier = fact.precision.unit === 'seconds' ? 1
      : fact.precision.unit === 'minutes' ? 60
        : fact.precision.unit === 'hours' ? 3_600
          : fact.precision.unit === 'days' ? 86_400
            : null;
    if (multiplier === null) return null;
    declared = fact.precision.tolerance * multiplier;
  }
  if (fact.precision.kind === 'bounded') {
    const multiplier = fact.precision.unit === 'seconds' ? 1
      : fact.precision.unit === 'minutes' ? 60
        : fact.precision.unit === 'hours' ? 3_600
          : fact.precision.unit === 'days' ? 86_400
            : null;
    if (multiplier === null) return null;
    declared = Math.max(Math.abs(fact.precision.lower), Math.abs(fact.precision.upper)) * multiplier;
  }
  const resolution = dateResolution[fact.value.datePrecision] + declared;
  return Number.isFinite(resolution) ? resolution : null;
};

const geoPrecisionKm = (fact: RelationshipInputFact) => {
  if (fact.value?.kind !== 'geo_point' || fact.precision.kind === 'unknown' || fact.precision.kind === 'categorical') {
    return null;
  }
  let declared = 0;
  if (fact.precision.kind === 'approximate') {
    if (fact.precision.unit !== 'km') return null;
    declared = fact.precision.tolerance;
  }
  if (fact.precision.kind === 'bounded') {
    if (fact.precision.unit !== 'km') return null;
    declared = Math.max(Math.abs(fact.precision.lower), Math.abs(fact.precision.upper));
  }
  return fact.value.spatialPrecisionKm + declared;
};

const radians = (degrees: number) => degrees * Math.PI / 180;
const distanceKm = (left: { lat: number; lon: number }, right: { lat: number; lon: number }) => {
  const radius = 6_371.0088;
  const dLat = radians(right.lat - left.lat);
  const dLon = radians(right.lon - left.lon);
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
};

const selectFacts = (record: RelationshipInputRecord, predicate: (fact: RelationshipInputFact) => boolean) => record.facts
  .filter((fact) => fact.value !== null
    && fact.confidence !== null
    && fact.missingness.status === 'present'
    && !isNegatedPredicate(fact.predicate)
    && predicate(fact))
  .sort((left, right) => factQuality(right) - factQuality(left) || lexical(left.factId, right.factId));

const spaceTimeEdge = (params: {
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  matches: SharedMatch[];
  rarityIndex: TypedRelationshipRarityIndex;
  dependency: TypedRelationshipDependency;
}) => {
  const leftTimes = selectFacts(params.left, (fact) => fact.family === 'space_time'
    && fact.value?.kind === 'timestamp'
    && ['event_timestamp', 'event_time', 'observation_timestamp', 'occurred_at'].includes(fact.predicate));
  const rightTimes = selectFacts(params.right, (fact) => fact.family === 'space_time'
    && fact.value?.kind === 'timestamp'
    && ['event_timestamp', 'event_time', 'observation_timestamp', 'occurred_at'].includes(fact.predicate));
  const leftLocations = selectFacts(params.left, (fact) => fact.family === 'space_time'
    && fact.value?.kind === 'geo_point'
    && ['event_location', 'observation_location'].includes(fact.predicate));
  const rightLocations = selectFacts(params.right, (fact) => fact.family === 'space_time'
    && fact.value?.kind === 'geo_point'
    && ['event_location', 'observation_location'].includes(fact.predicate));
  const candidates: Array<{
    leftTime: RelationshipInputFact;
    rightTime: RelationshipInputFact;
    leftLocation: RelationshipInputFact;
    rightLocation: RelationshipInputFact;
    temporalDelta: number;
    temporalUpper: number;
    surfaceDistance: number;
    spatialUpper: number;
    quality: number;
  }> = [];
  for (const leftTime of leftTimes) for (const rightTime of rightTimes) {
    const leftResolution = timestampResolutionSeconds(leftTime);
    const rightResolution = timestampResolutionSeconds(rightTime);
    if (leftResolution === null || rightResolution === null
      || leftTime.value?.kind !== 'timestamp' || rightTime.value?.kind !== 'timestamp') continue;
    const temporalDelta = Math.abs(new Date(leftTime.value.timestamp).getTime()
      - new Date(rightTime.value.timestamp).getTime()) / 1_000;
    for (const leftLocation of leftLocations) for (const rightLocation of rightLocations) {
      const leftPrecision = geoPrecisionKm(leftLocation);
      const rightPrecision = geoPrecisionKm(rightLocation);
      if (leftPrecision === null || rightPrecision === null
        || leftLocation.value?.kind !== 'geo_point' || rightLocation.value?.kind !== 'geo_point') continue;
      const surfaceDistance = distanceKm(leftLocation.value, rightLocation.value);
      candidates.push({
        leftTime,
        rightTime,
        leftLocation,
        rightLocation,
        temporalDelta,
        temporalUpper: temporalDelta + leftResolution + rightResolution,
        surfaceDistance,
        spatialUpper: surfaceDistance + leftPrecision + rightPrecision,
        quality: Math.min(
          factQuality(leftTime), factQuality(rightTime),
          factQuality(leftLocation), factQuality(rightLocation),
        ),
      });
    }
  }
  const candidate = candidates.sort((left, right) => left.temporalUpper - right.temporalUpper
    || left.spatialUpper - right.spatialUpper
    || right.quality - left.quality)[0];
  if (!candidate) return { edge: null, rejection: ['space_time_facts_missing_or_imprecise'] };
  const corroborators = params.matches
    .filter((match) => qualifiedMatch(match, TYPED_RELATIONSHIP_POLICY.minimumSpaceTimeSupportRarity))
    .sort((left, right) => right.rarity.effectiveRarity - left.rarity.effectiveRarity
      || right.quality - left.quality
      || lexical(left.valueKey, right.valueKey));
  const ultraTight = candidate.temporalUpper <= TYPED_RELATIONSHIP_POLICY.ultraTightSpaceTimeUpperSeconds
    && candidate.spatialUpper <= TYPED_RELATIONSHIP_POLICY.ultraTightSpaceTimeUpperKilometres
    && params.dependency.classification === 'independent';
  const gate = candidate.quality >= TYPED_RELATIONSHIP_POLICY.minimumFactQuality
    && candidate.temporalUpper <= TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperSeconds
    && candidate.spatialUpper <= TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres
    && (corroborators.length > 0 || ultraTight)
    && params.dependency.classification !== 'dependent';
  if (!gate) {
    const rejection: string[] = [];
    if (candidate.quality < TYPED_RELATIONSHIP_POLICY.minimumFactQuality) rejection.push('space_time_fact_quality_too_low');
    if (candidate.temporalUpper > TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperSeconds) rejection.push('temporal_upper_bound_too_coarse');
    if (candidate.spatialUpper > TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres) rejection.push('spatial_upper_bound_too_coarse');
    if (!corroborators.length && !ultraTight) rejection.push('space_time_requires_structured_support');
    if (params.dependency.classification === 'dependent') rejection.push('dependent_space_time_not_corroboration');
    return { edge: null, rejection: rejection.sort(lexical) };
  }
  const support = corroborators.slice(0, 1);
  const facts = [
    factEvidence(params.left, candidate.leftTime),
    factEvidence(params.right, candidate.rightTime),
    factEvidence(params.left, candidate.leftLocation),
    factEvidence(params.right, candidate.rightLocation),
    ...matchFactEvidence(params.left, params.right, support),
  ];
  const strength = 45
    + Math.max(0, 20 * (1 - candidate.temporalUpper / TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperSeconds))
    + Math.max(0, 20 * (1 - candidate.spatialUpper / TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres))
    + (corroborators.length ? 8 : 0);
  return {
    edge: makeEdge({
      binding: params.left.binding,
      edgeType: 'space_time_candidate',
      endpoints: pairEndpoints(params.left, params.right),
      inputRecordDigests: [params.left.recordDigest, params.right.recordDigest],
      rarityIndexDigest: params.rarityIndex.indexDigest,
      strength,
      reasons: [
        reason('bounded_temporal_proximity', 'space_time', 'The declared event-time intervals remain close after adding both precision bounds.', [candidate.leftTime.factId, candidate.rightTime.factId], {
          observed_delta_seconds: roundMetric(candidate.temporalDelta),
          upper_bound_seconds: roundMetric(candidate.temporalUpper),
        }),
        reason('bounded_spatial_proximity', 'space_time', 'The declared locations remain close after adding both spatial-precision radii.', [candidate.leftLocation.factId, candidate.rightLocation.factId], {
          surface_distance_km: roundMetric(candidate.surfaceDistance),
          upper_bound_km: roundMetric(candidate.spatialUpper),
        }),
        ...support.map((match) => reason('space_time_structured_support', match.family, `The shared ${plainFamily[match.family]} value supplies a separate structured safeguard.`, reasonEvidenceForMatch(match), {
          effective_rarity: match.rarity.effectiveRarity,
          fact_quality: match.quality,
        })),
      ],
      checks: [
        makeCheck('fact_quality', candidate.quality, 'greater_than_or_equal', TYPED_RELATIONSHIP_POLICY.minimumFactQuality),
        makeCheck('temporal_upper_bound_seconds', roundMetric(candidate.temporalUpper), 'less_than_or_equal', TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperSeconds),
        makeCheck('spatial_upper_bound_km', roundMetric(candidate.spatialUpper), 'less_than_or_equal', TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres),
        makeCheck('structured_or_ultra_tight_support', true, 'equal', true),
      ],
      factEvidence: facts,
      rarity: support.map((match) => match.rarity),
      missingness: missingnessFor([params.left, params.right], ['space_time', ...support.map((match) => match.family)]),
      dependency: params.dependency,
      plainEnglish: `The records form a bounded space-time candidate after declared time and location precision, uncertainty, source dependency, and a separate structured safeguard were applied. This does not assert that they describe the same incident. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
    }),
    rejection: [],
  };
};

const precisionToleranceSeconds = (fact: RelationshipInputFact) => {
  if (fact.value?.kind !== 'duration') return null;
  if (fact.precision.kind === 'exact') return 0;
  if (fact.precision.kind === 'approximate') {
    if (fact.precision.unit !== 'seconds') return null;
    return fact.precision.tolerance;
  }
  if (fact.precision.kind === 'bounded') {
    if (fact.precision.unit !== 'seconds') return null;
    return Math.max(
      Math.abs(fact.value.seconds - fact.precision.lower),
      Math.abs(fact.precision.upper - fact.value.seconds),
    );
  }
  return null;
};

const durationEdge = (params: {
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  matches: SharedMatch[];
  rarityIndex: TypedRelationshipRarityIndex;
  dependency: TypedRelationshipDependency;
}) => {
  const leftFact = selectFacts(params.left, (fact) => fact.family === 'duration'
    && fact.value?.kind === 'duration'
    && fact.predicate === 'observed_duration')[0];
  const rightFact = selectFacts(params.right, (fact) => fact.family === 'duration'
    && fact.value?.kind === 'duration'
    && fact.predicate === 'observed_duration')[0];
  if (!leftFact || !rightFact || leftFact.value?.kind !== 'duration' || rightFact.value?.kind !== 'duration') {
    return { edge: null, rejection: ['duration_missing_or_negated'] };
  }
  const leftTolerance = precisionToleranceSeconds(leftFact);
  const rightTolerance = precisionToleranceSeconds(rightFact);
  if (leftTolerance === null || rightTolerance === null) return { edge: null, rejection: ['duration_precision_unknown'] };
  const maximum = Math.max(leftFact.value.seconds, rightFact.value.seconds);
  const minimum = Math.min(leftFact.value.seconds, rightFact.value.seconds);
  const similarity = maximum > 0 ? minimum / maximum : 0;
  const relativePrecision = maximum > 0 ? Math.max(leftTolerance, rightTolerance) / maximum : 1;
  const quality = Math.min(factQuality(leftFact), factQuality(rightFact));
  const corroborators = params.matches.filter((match) => qualifiedMatch(match))
    .sort((left, right) => right.rarity.effectiveRarity - left.rarity.effectiveRarity
      || right.quality - left.quality
      || lexical(left.valueKey, right.valueKey));
  const gate = maximum >= TYPED_RELATIONSHIP_POLICY.minimumInformativeDurationSeconds
    && similarity >= TYPED_RELATIONSHIP_POLICY.minimumDurationSimilarity
    && relativePrecision <= TYPED_RELATIONSHIP_POLICY.maximumDurationRelativePrecision
    && quality >= TYPED_RELATIONSHIP_POLICY.minimumFactQuality
    && corroborators.length > 0
    && params.dependency.classification !== 'dependent';
  if (!gate) {
    const rejection: string[] = [];
    if (maximum < TYPED_RELATIONSHIP_POLICY.minimumInformativeDurationSeconds) rejection.push('duration_not_informative');
    if (similarity < TYPED_RELATIONSHIP_POLICY.minimumDurationSimilarity) rejection.push('duration_similarity_too_low');
    if (relativePrecision > TYPED_RELATIONSHIP_POLICY.maximumDurationRelativePrecision) rejection.push('duration_precision_too_coarse');
    if (quality < TYPED_RELATIONSHIP_POLICY.minimumFactQuality) rejection.push('duration_fact_quality_too_low');
    if (!corroborators.length) rejection.push('duration_requires_structured_support');
    if (params.dependency.classification === 'dependent') rejection.push('dependent_duration_not_corroboration');
    return { edge: null, rejection: rejection.sort(lexical) };
  }
  const support = corroborators.slice(0, 1);
  return {
    edge: makeEdge({
      binding: params.left.binding,
      edgeType: 'similar_duration',
      endpoints: pairEndpoints(params.left, params.right),
      inputRecordDigests: [params.left.recordDigest, params.right.recordDigest],
      rarityIndexDigest: params.rarityIndex.indexDigest,
      strength: 38 + similarity * 30 + support[0].rarity.effectiveRarity * 12,
      reasons: [
        reason('bounded_duration_similarity', 'duration', 'The reported durations remain similar within their declared precision.', [leftFact.factId, rightFact.factId], {
          left_seconds: leftFact.value.seconds,
          right_seconds: rightFact.value.seconds,
          similarity: roundMetric(similarity),
          maximum_relative_precision: roundMetric(relativePrecision),
        }),
        reason('duration_structured_support', support[0].family, `A separate ${plainFamily[support[0].family]} match prevents duration alone from creating an edge.`, reasonEvidenceForMatch(support[0]), {
          effective_rarity: support[0].rarity.effectiveRarity,
        }),
      ],
      checks: [
        makeCheck('duration_similarity', roundMetric(similarity), 'greater_than_or_equal', TYPED_RELATIONSHIP_POLICY.minimumDurationSimilarity),
        makeCheck('duration_relative_precision', roundMetric(relativePrecision), 'less_than_or_equal', TYPED_RELATIONSHIP_POLICY.maximumDurationRelativePrecision),
        makeCheck('duration_structured_support', true, 'equal', true),
      ],
      factEvidence: [
        factEvidence(params.left, leftFact),
        factEvidence(params.right, rightFact),
        ...matchFactEvidence(params.left, params.right, support),
      ],
      rarity: support.map((match) => match.rarity),
      missingness: missingnessFor([params.left, params.right], ['duration', ...support.map((match) => match.family)]),
      dependency: params.dependency,
      plainEnglish: `The records have similarly bounded reported durations plus separate structured support. Duration similarity is not treated as a causal or incident identity claim. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
    }),
    rejection: [],
  };
};

const sourceClassificationEdge = (params: {
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  rarityIndex: TypedRelationshipRarityIndex;
  dependency: TypedRelationshipDependency;
}) => {
  if (params.dependency.classification === 'independent') {
    const ids = params.dependency.reasons.flatMap((item) => item.evidenceIds);
    return makeEdge({
      binding: params.left.binding,
      edgeType: 'source_independence',
      endpoints: pairEndpoints(params.left, params.right),
      inputRecordDigests: [params.left.recordDigest, params.right.recordDigest],
      rarityIndexDigest: params.rarityIndex.indexDigest,
      strength: 90,
      reasons: [reason('reciprocal_source_independence', 'source_independence', 'Both governed sources provide reciprocal, separately documented or reviewed independence assertions.', ids, {
        left_source: params.left.source.sourceId,
        right_source: params.right.source.sourceId,
      })],
      checks: [makeCheck('reciprocal_governed_assertions', true, 'equal', true)],
      factEvidence: [],
      rarity: [],
      missingness: [],
      dependency: params.dependency,
      plainEnglish: `The source registries contain reciprocal governed evidence that these source lineages are independent. This classification does not verify either report and is not itself corroboration. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
    });
  }
  if (params.dependency.classification === 'dependent'
    && params.dependency.reasons.some((item) => ['same_source', 'same_source_record', 'same_lineage', 'governed_dependent_assertion'].includes(item.code))) {
    return makeEdge({
      binding: params.left.binding,
      edgeType: 'source_dependency',
      endpoints: pairEndpoints(params.left, params.right),
      inputRecordDigests: [params.left.recordDigest, params.right.recordDigest],
      rarityIndexDigest: params.rarityIndex.indexDigest,
      strength: 100,
      reasons: params.dependency.reasons.map((item) => reason(item.code, 'source_dependency', item.plainEnglish, item.evidenceIds)),
      checks: [makeCheck('governed_dependency_evidence', true, 'equal', true)],
      factEvidence: [],
      rarity: [],
      missingness: [],
      dependency: params.dependency,
      plainEnglish: `The records share governed source dependency and must not be counted as independent corroboration. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
    });
  }
  return null;
};

const pairEvaluationWithoutDigest = (
  evaluation: Omit<TypedRelationshipPairEvaluation, 'evaluationDigest'>,
) => evaluation;

export const evaluateTypedRelationshipPair = (params: {
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  rarityIndex: TypedRelationshipRarityIndex;
  expectedBinding: RelationshipInputUniverseBinding;
}): TypedRelationshipPairEvaluation => {
  const binding = validateRelationshipInputBinding(params.expectedBinding);
  const decoded = [
    decodeRelationshipInputRecord(params.left, binding),
    decodeRelationshipInputRecord(params.right, binding),
  ].sort((left, right) => lexical(left.address, right.address));
  const [left, right] = decoded;
  if (left.address === right.address) invalid('typed_relationship_pair_requires_distinct_addresses');
  const rarityIndex = decodeTypedRelationshipRarityIndex(params.rarityIndex, binding);
  const dependency = resolveDependency(left, right);
  const matches = sharedMatches(left, right, rarityIndex);
  const edges: TypedRelationshipEdge[] = [];
  const rejectionByType = new Map<typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number], string[]>();

  const provenance = provenanceEdges({ left, right, rarityIndex, dependency });
  if (provenance.edge) edges.push(provenance.edge);
  if (provenance.duplicate) rejectionByType.set('provenance', ['subsumed_by_duplicate_provenance']);
  else rejectionByType.set('duplicate_provenance', ['no_governed_duplicate_receipt']);
  if (!provenance.edge) rejectionByType.set('provenance', ['no_direct_provenance_receipt']);

  const spaceTime = spaceTimeEdge({ left, right, matches, rarityIndex, dependency });
  if (spaceTime.edge) edges.push(spaceTime.edge);
  else rejectionByType.set('space_time_candidate', spaceTime.rejection);

  for (const family of MATCHABLE_FAMILIES) {
    const result = categoricalEdge({
      family,
      left,
      right,
      matches: matches.filter((match) => match.family === family),
      allMatches: matches,
      rarityIndex,
      dependency,
    });
    if (result.edge) edges.push(result.edge);
    else rejectionByType.set(edgeTypeForFamily[family] as typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number], result.rejection);
  }

  const duration = durationEdge({ left, right, matches, rarityIndex, dependency });
  if (duration.edge) edges.push(duration.edge);
  else rejectionByType.set('similar_duration', duration.rejection);

  const sourceEdge = sourceClassificationEdge({ left, right, rarityIndex, dependency });
  if (sourceEdge) {
    edges.push(sourceEdge);
    rejectionByType.set(
      sourceEdge.edgeType === 'source_independence' ? 'source_dependency' : 'source_independence',
      [sourceEdge.edgeType === 'source_independence'
        ? 'governed_dependency_not_present'
        : 'reciprocal_independence_not_present'],
    );
  } else {
    rejectionByType.set('source_independence', ['reciprocal_independence_not_present']);
    rejectionByType.set('source_dependency', ['governed_dependency_not_present']);
  }

  const emittedTypes = new Set(edges.map((edge) => edge.edgeType));
  const rejections = TYPED_RELATIONSHIP_PAIR_EDGE_TYPES
    .filter((edgeType) => !emittedTypes.has(edgeType))
    .map((edgeType) => ({
      edgeType,
      reasonCodes: [...new Set(rejectionByType.get(edgeType) || ['policy_gate_not_met'])].sort(lexical),
    }));
  const sortedEdges = edges.sort((leftEdge, rightEdge) => lexical(leftEdge.edgeType, rightEdge.edgeType)
    || lexical(leftEdge.edgeId, rightEdge.edgeId));
  const withoutDigest: Omit<TypedRelationshipPairEvaluation, 'evaluationDigest'> = {
    recordType: 'typed_relationship_pair_evaluation',
    schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
    canonicalVersion: RELATIONSHIP_INPUT_CANONICAL_VERSION,
    binding,
    addresses: [left.address, right.address],
    inputRecordDigests: [left.recordDigest, right.recordDigest],
    rarityIndexDigest: rarityIndex.indexDigest,
    policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
    policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
    model: TYPED_RELATIONSHIP_MODEL,
    dependency,
    edges: sortedEdges,
    rejections,
  };
  return {
    ...withoutDigest,
    evaluationDigest: relationshipInputSha256(pairEvaluationWithoutDigest(withoutDigest)),
  };
};

const validateContextualAdapterResult = (
  record: RelationshipInputRecord,
  result: ContextualRelationshipAdapterResult,
) => {
  if (!isPlainObject(result)
    || result.recordType !== 'contextual_relationship_adapter_result'
    || result.schemaVersion !== CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION
    || result.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION
  ) invalid('typed_relationship_context_adapter_invalid');
  assertRelationshipInputBinding(result.binding, record.binding);
  if (result.address !== record.address || result.sourceRecordDigest !== record.recordDigest) {
    invalid('typed_relationship_context_record_mismatch');
  }
  const { adapterReceiptSha256, ...withoutDigest } = result;
  if (adapterReceiptSha256 !== contextualExplanationSha256(withoutDigest)) {
    invalid('typed_relationship_context_adapter_digest_mismatch');
  }
  const fact = record.facts.find((candidate) => candidate.factId === result.sourceFact.factId);
  if (!fact || fact.family !== 'contextual_explanation' || fact.value?.kind !== 'contextual_explanation') {
    invalid('typed_relationship_context_fact_mismatch');
  }
  if (
    fact.value.matchStatus !== 'candidate'
    || fact.value.interpretation !== 'candidate_explanation_not_causal_attribution'
    || fact.value.referenceId !== result.sourceFact.referenceId
    || fact.value.explanationType !== result.sourceFact.explanationType
    || fact.predicate !== result.sourceFact.predicate
    || fact.confidence !== result.sourceFact.confidence
    || canonicalizeRelationshipInput(fact.uncertainty) !== canonicalizeRelationshipInput(result.sourceFact.uncertainty)
    || canonicalizeRelationshipInput(fact.precision) !== canonicalizeRelationshipInput(result.sourceFact.precision)
    || canonicalizeRelationshipInput(fact.missingness) !== canonicalizeRelationshipInput(result.sourceFact.missingness)
    || canonicalizeRelationshipInput(fact.value.metrics) !== canonicalizeRelationshipInput(result.sourceFact.metrics)
    || canonicalizeRelationshipInput(fact.origins.map((origin) => origin.originId).sort(lexical))
      !== canonicalizeRelationshipInput([...result.sourceFact.originIds].sort(lexical))
  ) invalid('typed_relationship_context_fact_mismatch');
  if (!result.evaluation.edge || result.evaluation.receipt.decision !== 'emit_candidate_edge') {
    invalid('typed_relationship_context_not_qualified');
  }
  const contextualEdge = decodeContextualExplanationEdge(result.evaluation.edge);
  if (
    contextualEdge.subjectAddress !== record.address
    || contextualEdge.reference.referenceId !== fact.value.referenceId
    || canonicalizeContextualExplanation(contextualEdge.receipt)
      !== canonicalizeContextualExplanation(result.evaluation.receipt)
    || canonicalizeContextualExplanation(result.claimDiscipline.output)
      !== canonicalizeContextualExplanation(CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE)
  ) invalid('typed_relationship_context_evaluation_mismatch');
  return { fact, contextualEdge };
};

export const evaluateTypedContextualRelationships = (params: {
  record: RelationshipInputRecord;
  adapterResults: readonly ContextualRelationshipAdapterResult[];
  expectedBinding: RelationshipInputUniverseBinding;
}): TypedRelationshipEdge[] => {
  const binding = validateRelationshipInputBinding(params.expectedBinding);
  const record = decodeRelationshipInputRecord(params.record, binding);
  const seenFacts = new Set<string>();
  return params.adapterResults.map((result) => {
    const { fact, contextualEdge } = validateContextualAdapterResult(record, result);
    if (seenFacts.has(fact.factId)) invalid('typed_relationship_duplicate_context_result');
    seenFacts.add(fact.factId);
    return makeEdge({
      binding,
      edgeType: 'contextual_explanation_candidate',
      endpoints: [
        { kind: 'evidence', id: record.address },
        { kind: 'context', id: contextualEdge.contextNodeId },
      ],
      inputRecordDigests: [record.recordDigest],
      rarityIndexDigest: null,
      strength: 55 + (fact.confidence as number) * 25,
      reasons: [reason(
        'governed_contextual_policy_pass',
        'contextual_explanation',
        contextualEdge.explanation.plainEnglish,
        [fact.factId, result.adapterReceiptSha256, contextualEdge.receipt.receiptId],
        {
          context_kind: contextualEdge.kind,
          context_reference_id: contextualEdge.reference.referenceId,
          contextual_policy_version: contextualEdge.policy.version,
          contextual_policy_sha256: contextualEdge.policy.sha256,
        },
      )],
      checks: [makeCheck('governed_contextual_evaluation', contextualEdge.receipt.decision, 'equal', 'emit_candidate_edge')],
      factEvidence: [factEvidence(record, fact)],
      rarity: [],
      missingness: missingnessFor([record], ['contextual_explanation']),
      dependency: {
        classification: 'unknown',
        reasons: [dependencyReason(
          'insufficient_independence_evidence',
          [],
          'A contextual catalogue correlation is not independent corroboration of the report.',
        )],
      },
      contextualEvaluation: contextualEdge.receipt,
      plainEnglish: contextualEdge.explanation.plainEnglish,
    });
  }).sort((left, right) => lexical(left.edgeId, right.edgeId));
};

export {
  decodeTypedRelationshipEdge,
  decodeTypedRelationshipPairEvaluation,
} from './typedRelationshipDecoder';
import { createHash } from 'node:crypto';
