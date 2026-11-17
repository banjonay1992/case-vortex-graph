import { createHash } from 'node:crypto';

import type { CaseGraphCorpusRarity } from './corpusRarity';
import type { CaseGraphFeatureRecord } from './featureExtraction';
import {
  CASE_GRAPH_CANDIDATE_VERSION,
  type CaseGraphCandidate,
  type CaseGraphCandidateReason,
} from './candidateGeneration';
import {
  buildCaseGraphPairEvidence,
  caseGraphPairKey,
  type CaseGraphPairEvidenceOptions,
  type CaseGraphPairFeature,
} from './pairEvidence';
import { scoreCaseGraphRelationship, type CaseGraphRelationship } from './relationshipPolicy';

export const CASE_GRAPH_POSTING_VERSION = 'case-graph-postings-v1' as const;

type SpatialHome = {
  mode: 'exact' | 'day';
  timeCell: number;
  latCell: number;
  lonCell: number;
};

export type CaseGraphPosting = {
  signature: string;
  reason: CaseGraphCandidateReason;
  recordIndex: number;
  sharedTerm: string | null;
  spatialHome: SpatialHome | null;
};

export type CaseGraphPostingFragment = {
  version: typeof CASE_GRAPH_POSTING_VERSION;
  corpusVersion: string;
  inputPartNumber: number;
  reducerShard: number;
  reducerShardCount: number;
  records: CaseGraphPairFeature[];
  postings: CaseGraphPosting[];
};

export type CaseGraphPostingReduceResult = {
  version: typeof CASE_GRAPH_CANDIDATE_VERSION;
  corpusVersion: string;
  reducerShard: number;
  reducerShardCount: number;
  candidates: CaseGraphCandidate[];
  relationships: CaseGraphRelationship[];
  manifest: {
    fragmentCount: number;
    postingCount: number;
    postingGroupCount: number;
    candidateCount: number;
    relationshipCount: number;
    rejectedCandidateCount: number;
    skippedGroups: Array<{ signature: string; postings: number; reason: string }>;
  };
};

const DEFAULT_MINIMUM_TERM_RARITY = 0.55;
const DEFAULT_MAX_TERM_POSTINGS = 250;
const DEFAULT_MAX_SPATIAL_POSTINGS = 300;
const DEFAULT_MAX_SOURCE_RECORD_POSTINGS = 100;
const DEFAULT_MAX_CANDIDATES = 1_000_000;

// Archive codecs validate byte-stable ascending order with JavaScript's string
// comparison operators. localeCompare is locale-sensitive and can place
// signatures such as `...:1:-39` before `...:19:-55`, which is the opposite
// UTF-16/code-unit order and breaks deterministic production manifests.
const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export const getCaseGraphReducerShard = (value: string, shardCount: number) => {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 4096) {
    throw new Error('case_graph_posting_shard_count_invalid');
  }
  const digest = createHash('sha256').update(value).digest();
  return digest.readUInt32BE(0) % shardCount;
};

const projectRecord = (record: CaseGraphFeatureRecord): CaseGraphPairFeature => ({
  caseId: record.caseId,
  corpusVersion: record.corpusVersion,
  source: record.source,
  sourceRecordId: record.sourceRecordId,
  ingestionJobId: record.ingestionJobId,
  event: record.event,
  durationSeconds: record.durationSeconds,
  traits: record.traits,
});

const spatialHomeFor = (record: CaseGraphFeatureRecord): SpatialHome | null => {
  const timestamp = record.event.timestamp ? new Date(record.event.timestamp).getTime() : NaN;
  if (
    !Number.isFinite(timestamp)
    || record.event.lat == null
    || record.event.lon == null
    || !['exact', 'city'].includes(record.event.geoPrecision)
  ) return null;
  if (record.event.datePrecision === 'exact') return {
    mode: 'exact',
    timeCell: Math.floor(timestamp / (6 * 60 * 60 * 1_000)),
    latCell: Math.floor(record.event.lat),
    lonCell: Math.floor(record.event.lon),
  };
  if (record.event.datePrecision === 'day') return {
    mode: 'day',
    timeCell: Math.floor(timestamp / (24 * 60 * 60 * 1_000)),
    latCell: Math.floor(record.event.lat / 2),
    lonCell: Math.floor(record.event.lon / 2),
  };
  return null;
};

const spatialSignature = (home: SpatialHome, timeCell: number, latCell: number, lonCell: number) => (
  `spacetime:${home.mode}:${timeCell}:${latCell}:${lonCell}`
);

const termCategories: Array<[
  keyof Pick<CaseGraphFeatureRecord['traits'], 'visual' | 'behaviour' | 'sensory' | 'entities'>,
  CaseGraphCandidateReason,
]> = [
  ['visual', 'rare_visual_term'],
  ['behaviour', 'rare_behaviour_term'],
  ['sensory', 'rare_sensory_term'],
  ['entities', 'rare_entity_term'],
];

const buildRecordPostings = (
  record: CaseGraphFeatureRecord,
  rarity: CaseGraphCorpusRarity,
  minimumTermRarity: number,
) => {
  const entries: Omit<CaseGraphPosting, 'recordIndex'>[] = [];
  if (record.sourceRecordId) entries.push({
    signature: `source-record:${record.source}:${record.sourceRecordId}`,
    reason: 'same_source_record',
    sharedTerm: null,
    spatialHome: null,
  });
  for (const [category, reason] of termCategories) {
    for (const item of record.traits[category]) {
      if ((rarity.rarity[item.term] ?? 0) < minimumTermRarity) continue;
      entries.push({
        signature: `term:${reason}:${item.term}`,
        reason,
        sharedTerm: item.term,
        spatialHome: null,
      });
    }
  }
  const home = spatialHomeFor(record);
  if (home) {
    const reason = home.mode === 'exact' ? 'spacetime_exact_bucket' : 'spacetime_day_bucket';
    // A record emits to the 2x2x2 lower-corner routes around its home cell.
    // Two neighboring cells meet at their component-wise minimum route. The
    // reducer enforces that canonical route so each spatial pair is emitted once.
    for (const timeOffset of [0, -1]) for (const latOffset of [0, -1]) for (const lonOffset of [0, -1]) {
      entries.push({
        signature: spatialSignature(
          home,
          home.timeCell + timeOffset,
          home.latCell + latOffset,
          home.lonCell + lonOffset,
        ),
        reason,
        sharedTerm: null,
        spatialHome: home,
      });
    }
  }
  return entries.sort((left, right) => compareCodeUnits(left.signature, right.signature));
};

export const buildCaseGraphPostingFragments = (params: {
  records: CaseGraphFeatureRecord[];
  rarity: CaseGraphCorpusRarity;
  inputPartNumber: number;
  reducerShardCount: number;
  minimumTermRarity?: number;
}): CaseGraphPostingFragment[] => {
  if (!Number.isSafeInteger(params.inputPartNumber) || params.inputPartNumber < 0) {
    throw new Error('case_graph_posting_part_number_invalid');
  }
  if (!Number.isSafeInteger(params.reducerShardCount) || params.reducerShardCount < 1 || params.reducerShardCount > 4096) {
    throw new Error('case_graph_posting_shard_count_invalid');
  }
  const minimumTermRarity = Number(params.minimumTermRarity ?? DEFAULT_MINIMUM_TERM_RARITY);
  if (!Number.isFinite(minimumTermRarity) || minimumTermRarity < 0 || minimumTermRarity > 1) {
    throw new Error('case_graph_posting_rarity_threshold_invalid');
  }
  const sorted = [...params.records].sort((left, right) => compareCodeUnits(left.caseId, right.caseId));
  const seen = new Set<string>();
  const byShard = new Map<number, Array<{ record: CaseGraphPairFeature; posting: Omit<CaseGraphPosting, 'recordIndex'> }>>();
  for (const record of sorted) {
    if (record.corpusVersion !== params.rarity.corpusVersion) throw new Error('case_graph_corpus_version_mismatch');
    if (seen.has(record.caseId)) throw new Error(`case_graph_duplicate_case_id:${record.caseId}`);
    seen.add(record.caseId);
    const projection = projectRecord(record);
    for (const posting of buildRecordPostings(record, params.rarity, minimumTermRarity)) {
      const shard = getCaseGraphReducerShard(posting.signature, params.reducerShardCount);
      const entries = byShard.get(shard) || [];
      entries.push({ record: projection, posting });
      byShard.set(shard, entries);
    }
  }
  return [...byShard.entries()].sort(([left], [right]) => left - right).map(([reducerShard, entries]) => {
    const records = [...new Map(entries.map((entry) => [entry.record.caseId, entry.record])).values()]
      .sort((left, right) => compareCodeUnits(left.caseId, right.caseId));
    const recordIndex = new Map(records.map((record, index) => [record.caseId, index]));
    const postings = entries.map((entry) => ({
      ...entry.posting,
      recordIndex: recordIndex.get(entry.record.caseId) as number,
    })).sort((left, right) => (
      compareCodeUnits(left.signature, right.signature)
      || compareCodeUnits(records[left.recordIndex].caseId, records[right.recordIndex].caseId)
    ));
    return {
      version: CASE_GRAPH_POSTING_VERSION,
      corpusVersion: params.rarity.corpusVersion,
      inputPartNumber: params.inputPartNumber,
      reducerShard,
      reducerShardCount: params.reducerShardCount,
      records,
      postings,
    };
  });
};

const parseSpatialRoute = (signature: string): SpatialHome | null => {
  const match = /^spacetime:(exact|day):(-?\d+):(-?\d+):(-?\d+)$/.exec(signature);
  if (!match) return null;
  return {
    mode: match[1] as SpatialHome['mode'],
    timeCell: Number(match[2]),
    latCell: Number(match[3]),
    lonCell: Number(match[4]),
  };
};

const isCanonicalSpatialPair = (signature: string, left: SpatialHome | null, right: SpatialHome | null) => {
  const route = parseSpatialRoute(signature);
  if (!route || !left || !right || left.mode !== right.mode || left.mode !== route.mode) return false;
  if (
    Math.abs(left.timeCell - right.timeCell) > 1
    || Math.abs(left.latCell - right.latCell) > 1
    || Math.abs(left.lonCell - right.lonCell) > 1
  ) return false;
  return route.timeCell === Math.min(left.timeCell, right.timeCell)
    && route.latCell === Math.min(left.latCell, right.latCell)
    && route.lonCell === Math.min(left.lonCell, right.lonCell);
};

export const reduceCaseGraphPostingFragments = (params: {
  fragments: CaseGraphPostingFragment[];
  rarity: CaseGraphCorpusRarity;
  pairEvidenceOptions?: CaseGraphPairEvidenceOptions;
  maxTermPostings?: number;
  maxSpatialPostings?: number;
  maxSourceRecordPostings?: number;
  maxCandidates?: number;
}): CaseGraphPostingReduceResult => {
  if (!params.fragments.length) throw new Error('case_graph_posting_fragments_required');
  const [first] = params.fragments;
  const fragments = [...params.fragments].sort((left, right) => left.inputPartNumber - right.inputPartNumber);
  const partNumbers = new Set<number>();
  const groups = new Map<string, {
    reason: CaseGraphCandidateReason;
    sharedTerm: string | null;
    members: Map<string, { record: CaseGraphPairFeature; spatialHome: SpatialHome | null }>;
  }>();
  let postingCount = 0;
  for (const fragment of fragments) {
    if (
      fragment.version !== CASE_GRAPH_POSTING_VERSION
      || fragment.corpusVersion !== first.corpusVersion
      || fragment.corpusVersion !== params.rarity.corpusVersion
      || fragment.reducerShard !== first.reducerShard
      || fragment.reducerShardCount !== first.reducerShardCount
      || partNumbers.has(fragment.inputPartNumber)
    ) throw new Error('case_graph_posting_fragment_set_invalid');
    partNumbers.add(fragment.inputPartNumber);
    for (const posting of fragment.postings) {
      postingCount += 1;
      if (getCaseGraphReducerShard(posting.signature, fragment.reducerShardCount) !== fragment.reducerShard) {
        throw new Error('case_graph_posting_routed_to_wrong_shard');
      }
      const record = fragment.records[posting.recordIndex];
      if (!record) throw new Error('case_graph_posting_record_index_invalid');
      const group = groups.get(posting.signature) || {
        reason: posting.reason,
        sharedTerm: posting.sharedTerm,
        members: new Map(),
      };
      if (group.reason !== posting.reason || group.sharedTerm !== posting.sharedTerm) {
        throw new Error('case_graph_posting_signature_collision');
      }
      if (group.members.has(record.caseId)) throw new Error(`case_graph_duplicate_case_id:${record.caseId}`);
      group.members.set(record.caseId, { record, spatialHome: posting.spatialHome });
      groups.set(posting.signature, group);
    }
  }

  const maxTerm = params.maxTermPostings ?? DEFAULT_MAX_TERM_POSTINGS;
  const maxSpatial = params.maxSpatialPostings ?? DEFAULT_MAX_SPATIAL_POSTINGS;
  const maxSource = params.maxSourceRecordPostings ?? DEFAULT_MAX_SOURCE_RECORD_POSTINGS;
  const maxCandidates = params.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  for (const [value, label, maximum] of [
    [maxTerm, 'term', 100_000],
    [maxSpatial, 'spatial', 100_000],
    [maxSource, 'source', 10_000],
    [maxCandidates, 'candidate', 10_000_000],
  ] as const) if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`case_graph_posting_${label}_limit_invalid`);
  }

  const candidates = new Map<string, {
    candidate: CaseGraphCandidate;
    left: CaseGraphPairFeature;
    right: CaseGraphPairFeature;
  }>();
  const skippedGroups: CaseGraphPostingReduceResult['manifest']['skippedGroups'] = [];
  for (const [signature, group] of [...groups.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
    const members = [...group.members.values()].sort((left, right) => compareCodeUnits(left.record.caseId, right.record.caseId));
    const limit = group.reason === 'same_source_record'
      ? maxSource
      : group.reason.startsWith('spacetime_') ? maxSpatial : maxTerm;
    if (members.length > limit) {
      skippedGroups.push({ signature, postings: members.length, reason: `postings_exceed_${limit}` });
      continue;
    }
    for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
        const left = members[leftIndex];
        const right = members[rightIndex];
        if (group.reason.startsWith('spacetime_')
          && !isCanonicalSpatialPair(signature, left.spatialHome, right.spatialHome)) continue;
        const pairKey = caseGraphPairKey(left.record.caseId, right.record.caseId);
        const existing = candidates.get(pairKey);
        if (!existing && candidates.size >= maxCandidates) {
          throw new Error(`case_graph_candidate_limit_exceeded:${maxCandidates}`);
        }
        const reasons = new Set(existing?.candidate.reasons || []);
        reasons.add(group.reason);
        const terms = new Set(existing?.candidate.sharedTerms || []);
        if (group.sharedTerm) terms.add(group.sharedTerm);
        candidates.set(pairKey, {
          candidate: {
            pairKey,
            leftCaseId: left.record.caseId,
            rightCaseId: right.record.caseId,
            reasons: [...reasons].sort(compareCodeUnits),
            sharedTerms: [...terms].sort(compareCodeUnits),
          },
          left: left.record,
          right: right.record,
        });
      }
    }
  }
  const sortedCandidates = [...candidates.values()].sort((left, right) => (
    compareCodeUnits(left.candidate.pairKey, right.candidate.pairKey)
  ));
  const relationships = sortedCandidates.map(({ left, right }) => scoreCaseGraphRelationship(
    buildCaseGraphPairEvidence(left, right, params.rarity, params.pairEvidenceOptions),
  )).filter((relationship): relationship is CaseGraphRelationship => Boolean(relationship));
  return {
    version: CASE_GRAPH_CANDIDATE_VERSION,
    corpusVersion: first.corpusVersion,
    reducerShard: first.reducerShard,
    reducerShardCount: first.reducerShardCount,
    candidates: sortedCandidates.map((entry) => entry.candidate),
    relationships,
    manifest: {
      fragmentCount: fragments.length,
      postingCount,
      postingGroupCount: groups.size,
      candidateCount: sortedCandidates.length,
      relationshipCount: relationships.length,
      rejectedCandidateCount: sortedCandidates.length - relationships.length,
      skippedGroups,
    },
  };
};

export const deduplicateCaseGraphRelationships = (relationships: CaseGraphRelationship[]) => {
  const byId = new Map<string, CaseGraphRelationship>();
  for (const relationship of [...relationships].sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId))) {
    const existing = byId.get(relationship.edgeId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(relationship)) {
      throw new Error(`case_graph_relationship_receipt_conflict:${relationship.edgeId}`);
    }
    byId.set(relationship.edgeId, relationship);
  }
  return [...byId.values()];
};
