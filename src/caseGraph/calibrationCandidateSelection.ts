import {
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  decodeTypedRelationshipPairEvaluation,
  type TypedRelationshipPairEvaluation,
} from './typedRelationshipEngine';
import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import type { CalibrationHumanReviewPairCandidate } from './calibrationHumanReview';

export const CALIBRATION_PAIR_CANDIDATE_SELECTION_VERSION =
  'case-graph-calibration-pair-candidate-selection-v1' as const;

export type CalibrationPairCandidateSelection = {
  recordType: 'calibration_pair_candidate_selection';
  schemaVersion: typeof CALIBRATION_PAIR_CANDIDATE_SELECTION_VERSION;
  seed: string;
  targetCount: number;
  eligibleCount: number;
  candidates: CalibrationHumanReviewPairCandidate[];
  cohortCounts: Record<string, number>;
  selectionDigest: string;
};

const STABLE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };

const candidateTokens = (evaluation: TypedRelationshipPairEvaluation) => {
  const emitted = new Set(evaluation.edges.map(({ edgeType }) => edgeType));
  return [
    `dependency:${evaluation.dependency.classification}`,
    `outcome:${evaluation.edges.length ? 'emitted' : 'rejected'}`,
    ...TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.map((edgeType) => (
      `${emitted.has(edgeType) ? 'edge' : 'rejection'}:${edgeType}`
    )),
  ].sort(compare);
};

const sourceGroupId = (
  evaluation: TypedRelationshipPairEvaluation,
  records: ReadonlyMap<string, RelationshipInputRecord>,
) => {
  const identities = evaluation.addresses.flatMap((address) => {
    const record = records.get(address);
    if (!record) return invalid('calibration_pair_candidate_source_record_missing');
    return [
      `source:${record.source.sourceId}`,
      `lineage:${record.source.lineageId}`,
      ...(record.duplicateLineage ? [`duplicate:${record.duplicateLineage.clusterId}`] : []),
    ];
  }).sort(compare);
  return `source-group:${relationshipInputSha256([...new Set(identities)])}`;
};

const selectionWithoutDigest = (
  selection: Omit<CalibrationPairCandidateSelection, 'selectionDigest'>,
) => selection;

export const selectCalibrationPairCandidates = (params: {
  binding: RelationshipInputUniverseBinding;
  evaluations: readonly TypedRelationshipPairEvaluation[];
  records: readonly RelationshipInputRecord[];
  targetCount: number;
  seed: string;
}): CalibrationPairCandidateSelection => {
  if (!Number.isSafeInteger(params.targetCount) || params.targetCount < 1) {
    invalid('calibration_pair_candidate_target_invalid');
  }
  if (typeof params.seed !== 'string' || !STABLE_ID.test(params.seed)) {
    invalid('calibration_pair_candidate_seed_invalid');
  }
  const records = new Map(params.records.map((record) => {
    const decoded = decodeRelationshipInputRecord(record, params.binding);
    return [decoded.address, decoded] as const;
  }));
  if (records.size !== params.records.length) invalid('calibration_pair_candidate_source_record_duplicate');
  const normalized = params.evaluations.map((evaluation) => (
    decodeTypedRelationshipPairEvaluation(evaluation, params.binding)
  ));
  if (new Set(normalized.map(({ evaluationDigest }) => evaluationDigest)).size !== normalized.length) {
    invalid('calibration_pair_candidate_evaluation_duplicate');
  }
  if (normalized.length < params.targetCount) invalid('calibration_pair_candidate_pool_too_small');

  const keyed = normalized.map((evaluation) => {
    const pairKey = `pair:${relationshipInputSha256(evaluation.addresses)}`;
    const rank = relationshipInputSha256({
      schemaVersion: CALIBRATION_PAIR_CANDIDATE_SELECTION_VERSION,
      seed: params.seed,
      pairKey,
      evaluationDigest: evaluation.evaluationDigest,
    });
    return {
      pairKey,
      rank,
      tokens: candidateTokens(evaluation),
      candidate: {
        pairKey,
        sourceGroupId: sourceGroupId(evaluation, records),
        evaluationDigest: evaluation.evaluationDigest,
        evaluation,
      } satisfies CalibrationHumanReviewPairCandidate,
    };
  }).sort((left, right) => compare(left.rank, right.rank) || compare(left.pairKey, right.pairKey));

  const tokenQueues = new Map<string, typeof keyed>();
  for (const entry of keyed) for (const token of entry.tokens) {
    const queue = tokenQueues.get(token) || [];
    queue.push(entry);
    tokenQueues.set(token, queue);
  }
  const chosen = new Map<string, typeof keyed[number]>();
  const offsets = new Map<string, number>();
  const tokens = [...tokenQueues.keys()].sort(compare);
  while (chosen.size < params.targetCount) {
    let advanced = false;
    for (const token of tokens) {
      const queue = tokenQueues.get(token)!;
      let offset = offsets.get(token) || 0;
      while (offset < queue.length && chosen.has(queue[offset].pairKey)) offset += 1;
      offsets.set(token, offset + 1);
      if (offset >= queue.length) continue;
      chosen.set(queue[offset].pairKey, queue[offset]);
      advanced = true;
      if (chosen.size === params.targetCount) break;
    }
    if (!advanced) break;
  }
  for (const entry of keyed) {
    if (chosen.size === params.targetCount) break;
    chosen.set(entry.pairKey, entry);
  }
  if (chosen.size !== params.targetCount) invalid('calibration_pair_candidate_selection_incomplete');

  const selected = [...chosen.values()].sort((left, right) => compare(left.pairKey, right.pairKey));
  const cohortCounts: Record<string, number> = {};
  for (const entry of selected) for (const token of entry.tokens) {
    cohortCounts[token] = (cohortCounts[token] || 0) + 1;
  }
  const withoutDigest: Omit<CalibrationPairCandidateSelection, 'selectionDigest'> = {
    recordType: 'calibration_pair_candidate_selection',
    schemaVersion: CALIBRATION_PAIR_CANDIDATE_SELECTION_VERSION,
    seed: params.seed,
    targetCount: params.targetCount,
    eligibleCount: normalized.length,
    candidates: selected.map(({ candidate }) => candidate),
    cohortCounts: Object.fromEntries(Object.entries(cohortCounts).sort(([left], [right]) => compare(left, right))),
  };
  return {
    ...withoutDigest,
    selectionDigest: relationshipInputSha256(selectionWithoutDigest(withoutDigest)),
  };
};

export const serializeCalibrationPairCandidateSelection = (
  selection: CalibrationPairCandidateSelection,
) => `${canonicalizeRelationshipInput(selection)}\n`;
