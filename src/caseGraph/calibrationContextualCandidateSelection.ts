import type { CalibrationHumanReviewContextualCandidate } from './calibrationHumanReview';
import {
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
} from './contextualExplanation';
import {
  decodeContextualRelationshipCalibrationLineage,
  getContextualRelationshipCalibrationSampleId,
  type ContextualRelationshipCalibrationLineage,
} from './contextualRelationshipCalibration';
import {
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputRecord,
} from './relationshipInputSnapshot';

export const CALIBRATION_CONTEXTUAL_CANDIDATE_SELECTION_VERSION =
  'case-graph-calibration-contextual-candidate-selection-v1' as const;

export type CalibrationContextualCandidateInput = Omit<
CalibrationHumanReviewContextualCandidate,
'sourceGroupId'
>;

export type CalibrationContextualCandidateSelection = {
  recordType: 'calibration_contextual_candidate_selection';
  schemaVersion: typeof CALIBRATION_CONTEXTUAL_CANDIDATE_SELECTION_VERSION;
  seed: string;
  targetCount: number;
  eligibleCount: number;
  candidates: CalibrationHumanReviewContextualCandidate[];
  cohortCounts: Record<string, number>;
  selectionDigest: string;
};

const STABLE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };

const candidateTokens = (candidate: CalibrationContextualCandidateInput) => {
  const receipt = candidate.evaluation.receipt;
  return [
    `kind:${candidate.candidate.kind}`,
    `outcome:${receipt.decision}`,
    `uncertainty:${candidate.candidate.uncertainty.level}`,
    ...receipt.checks.map((check) => `check:${check.code}:${check.status}`),
    ...receipt.failedChecks.map((code) => `failed:${code}`),
    ...candidate.candidate.missingness.map((item) => `missingness:${item.status}`),
  ].sort(compare);
};

const deriveSourceGroupId = (
  candidate: CalibrationContextualCandidateInput,
  subject: RelationshipInputRecord,
) => {
  const contextualSources = candidate.candidate.provenance
    .filter(({ role }) => role === 'context_reference')
    .map(({ providerId, datasetVersion, sourceRef }) => (
      `context:${providerId}:${datasetVersion}:${sourceRef}`
    ));
  return `context-source-group:${relationshipInputSha256([
    `subject-source:${subject.source.sourceId}`,
    `subject-lineage:${subject.source.lineageId}`,
    ...(subject.duplicateLineage ? [`subject-duplicate:${subject.duplicateLineage.clusterId}`] : []),
    `context-snapshot:${candidate.sourceSnapshotDigest}`,
    ...contextualSources,
  ].sort(compare))}`;
};

const normalizeCandidate = (params: {
  candidate: CalibrationContextualCandidateInput;
  lineage: ContextualRelationshipCalibrationLineage;
  records: ReadonlyMap<string, RelationshipInputRecord>;
}) => {
  const { candidate } = params;
  if (!SHA256.test(candidate.sourceSnapshotDigest)
    || !SHA256.test(candidate.observationArchiveRecordDigest)) {
    invalid('calibration_contextual_candidate_archive_digest_invalid');
  }
  const subject = params.records.get(candidate.candidate.subjectAddress)
    || invalid('calibration_contextual_candidate_subject_record_missing');
  const evaluation = evaluateContextualExplanationCandidate(candidate.candidate);
  if (canonicalizeContextualExplanation(evaluation)
    !== canonicalizeContextualExplanation(candidate.evaluation)) {
    invalid('calibration_contextual_candidate_evaluation_mismatch');
  }
  const evaluationDigest = contextualExplanationSha256(evaluation);
  const sampleId = getContextualRelationshipCalibrationSampleId({
    candidate: candidate.candidate,
    sourceSnapshotDigest: candidate.sourceSnapshotDigest,
    observationArchiveRecordDigest: candidate.observationArchiveRecordDigest,
  });
  if (candidate.sampleId !== sampleId || candidate.evaluationDigest !== evaluationDigest) {
    invalid('calibration_contextual_candidate_identity_mismatch');
  }
  const source = params.lineage.sourceArchives.find(({ sourceSnapshotDigest }) => (
    sourceSnapshotDigest === candidate.sourceSnapshotDigest
  ));
  if (!source || source.kind !== candidate.candidate.kind
    || !candidate.candidate.provenance.some((item) => (
      item.role === 'context_reference'
      && item.providerId === source.providerId
      && item.datasetVersion === source.datasetVersion
    ))) {
    invalid('calibration_contextual_candidate_source_mismatch');
  }
  return {
    ...candidate,
    sourceGroupId: deriveSourceGroupId(candidate, subject),
    evaluation,
    evaluationDigest,
    sampleId,
  } satisfies CalibrationHumanReviewContextualCandidate;
};

const withoutDigest = (
  selection: Omit<CalibrationContextualCandidateSelection, 'selectionDigest'>,
) => selection;

export const selectCalibrationContextualCandidates = (params: {
  lineage: ContextualRelationshipCalibrationLineage;
  candidates: readonly CalibrationContextualCandidateInput[];
  subjectRecords: readonly RelationshipInputRecord[];
  targetCount: number;
  seed: string;
}): CalibrationContextualCandidateSelection => {
  if (!Number.isSafeInteger(params.targetCount) || params.targetCount < 1) {
    invalid('calibration_contextual_candidate_target_invalid');
  }
  if (typeof params.seed !== 'string' || !STABLE_ID.test(params.seed)) {
    invalid('calibration_contextual_candidate_seed_invalid');
  }
  const lineage = decodeContextualRelationshipCalibrationLineage(params.lineage);
  const records = new Map(params.subjectRecords.map((record) => {
    const decoded = decodeRelationshipInputRecord(record, lineage.binding);
    return [decoded.address, decoded] as const;
  }));
  if (records.size !== params.subjectRecords.length) {
    invalid('calibration_contextual_candidate_subject_record_duplicate');
  }
  const normalized = params.candidates.map((candidate) => normalizeCandidate({
    candidate,
    lineage,
    records,
  }));
  if (new Set(normalized.map(({ sampleId }) => sampleId)).size !== normalized.length) {
    invalid('calibration_contextual_candidate_duplicate');
  }
  if (normalized.length < params.targetCount) {
    invalid('calibration_contextual_candidate_pool_too_small');
  }

  const keyed = normalized.map((candidate) => ({
    sampleId: candidate.sampleId,
    rank: contextualExplanationSha256({
      schemaVersion: CALIBRATION_CONTEXTUAL_CANDIDATE_SELECTION_VERSION,
      seed: params.seed,
      sampleId: candidate.sampleId,
      evaluationDigest: candidate.evaluationDigest,
    }),
    tokens: candidateTokens(candidate),
    candidate,
  })).sort((left, right) => (
    compare(left.rank, right.rank) || compare(left.sampleId, right.sampleId)
  ));
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
      while (offset < queue.length && chosen.has(queue[offset].sampleId)) offset += 1;
      offsets.set(token, offset + 1);
      if (offset >= queue.length) continue;
      chosen.set(queue[offset].sampleId, queue[offset]);
      advanced = true;
      if (chosen.size === params.targetCount) break;
    }
    if (!advanced) break;
  }
  for (const entry of keyed) {
    if (chosen.size === params.targetCount) break;
    chosen.set(entry.sampleId, entry);
  }
  if (chosen.size !== params.targetCount) {
    invalid('calibration_contextual_candidate_selection_incomplete');
  }

  const selected = [...chosen.values()].sort((left, right) => (
    compare(left.sampleId, right.sampleId)
  ));
  const cohortCounts: Record<string, number> = {};
  for (const entry of selected) for (const token of entry.tokens) {
    cohortCounts[token] = (cohortCounts[token] || 0) + 1;
  }
  const core: Omit<CalibrationContextualCandidateSelection, 'selectionDigest'> = {
    recordType: 'calibration_contextual_candidate_selection',
    schemaVersion: CALIBRATION_CONTEXTUAL_CANDIDATE_SELECTION_VERSION,
    seed: params.seed,
    targetCount: params.targetCount,
    eligibleCount: normalized.length,
    candidates: selected.map(({ candidate }) => candidate),
    cohortCounts: Object.fromEntries(
      Object.entries(cohortCounts).sort(([left], [right]) => compare(left, right)),
    ),
  };
  return {
    ...core,
    selectionDigest: contextualExplanationSha256(withoutDigest(core)),
  };
};

export const serializeCalibrationContextualCandidateSelection = (
  selection: CalibrationContextualCandidateSelection,
) => `${canonicalizeContextualExplanation(selection)}\n`;
