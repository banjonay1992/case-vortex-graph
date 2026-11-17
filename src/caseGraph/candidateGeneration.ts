import type { CaseGraphCorpusRarity } from './corpusRarity';
import type { CaseGraphFeatureRecord } from './featureExtraction';
import { caseGraphPairKey } from './pairEvidence';

export const CASE_GRAPH_CANDIDATE_VERSION = 'case-graph-candidates-v1' as const;

export type CaseGraphCandidateReason =
  | 'same_source_record'
  | 'rare_visual_term'
  | 'rare_behaviour_term'
  | 'rare_sensory_term'
  | 'rare_entity_term'
  | 'spacetime_exact_bucket'
  | 'spacetime_day_bucket';

export type CaseGraphCandidate = {
  pairKey: string;
  leftCaseId: string;
  rightCaseId: string;
  reasons: CaseGraphCandidateReason[];
  sharedTerms: string[];
};

export type CaseGraphCandidateGenerationOptions = {
  shardId: string;
  minimumTermRarity?: number;
  maxTermPostings?: number;
  maxSpatialBucketRecords?: number;
  maxSourceRecordPostings?: number;
  maxCandidates?: number;
};

export type CaseGraphCandidateGenerationResult = {
  version: typeof CASE_GRAPH_CANDIDATE_VERSION;
  corpusVersion: string;
  shardId: string;
  candidates: CaseGraphCandidate[];
  manifest: {
    inputCaseCount: number;
    accountedCaseCount: number;
    casesWithCandidates: number;
    isolatedCaseCount: number;
    exactSpacetimeCaseCount: number;
    daySpacetimeCaseCount: number;
    skippedHighFrequencyTerms: Array<{ term: string; postings: number }>;
    skippedOversizedSpatialBuckets: Array<{ bucket: string; postings: number }>;
    skippedOversizedSourceRecords: Array<{ sourceRecord: string; postings: number }>;
  };
};

type CandidateAccumulator = {
  leftCaseId: string;
  rightCaseId: string;
  reasons: Set<CaseGraphCandidateReason>;
  sharedTerms: Set<string>;
};

type SpatialMode = 'exact' | 'day';

type SpatialEntry = {
  record: CaseGraphFeatureRecord;
  mode: SpatialMode;
  timeCell: number;
  latCell: number;
  lonCell: number;
};

const DEFAULTS = {
  minimumTermRarity: 0.55,
  maxTermPostings: 250,
  maxSpatialBucketRecords: 300,
  maxSourceRecordPostings: 100,
  maxCandidates: 1_000_000,
};

const clampInteger = (value: number | undefined, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
};

const clampRarity = (value: number | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULTS.minimumTermRarity;
  return Math.max(0, Math.min(1, parsed));
};

const sortedDistinctRecords = (records: CaseGraphFeatureRecord[]) => {
  const sorted = [...records].sort((a, b) => a.caseId.localeCompare(b.caseId));
  const seen = new Set<string>();
  for (const record of sorted) {
    if (seen.has(record.caseId)) throw new Error(`case_graph_duplicate_case_id:${record.caseId}`);
    seen.add(record.caseId);
  }
  return sorted;
};

const termPostings = (
  records: CaseGraphFeatureRecord[],
  rarity: CaseGraphCorpusRarity,
  minimumTermRarity: number,
) => {
  const postings = new Map<string, { reason: CaseGraphCandidateReason; ids: Set<string> }>();
  const categories: Array<[
    keyof Pick<CaseGraphFeatureRecord['traits'], 'visual' | 'behaviour' | 'sensory' | 'entities'>,
    CaseGraphCandidateReason,
  ]> = [
    ['visual', 'rare_visual_term'],
    ['behaviour', 'rare_behaviour_term'],
    ['sensory', 'rare_sensory_term'],
    ['entities', 'rare_entity_term'],
  ];
  for (const record of records) {
    for (const [category, reason] of categories) {
      for (const item of record.traits[category]) {
        if ((rarity.rarity[item.term] ?? 0) < minimumTermRarity) continue;
        const key = `${reason}:${item.term}`;
        const posting = postings.get(key) || { reason, ids: new Set<string>() };
        posting.ids.add(record.caseId);
        postings.set(key, posting);
      }
    }
  }
  return postings;
};

const sourceRecordPostings = (records: CaseGraphFeatureRecord[]) => {
  const postings = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.sourceRecordId) continue;
    const key = `${record.source}::${record.sourceRecordId}`;
    const ids = postings.get(key) || new Set<string>();
    ids.add(record.caseId);
    postings.set(key, ids);
  }
  return postings;
};

const timestampMs = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const spatialEntry = (record: CaseGraphFeatureRecord): SpatialEntry | null => {
  const timestamp = timestampMs(record.event.timestamp);
  if (timestamp == null || record.event.lat == null || record.event.lon == null) return null;
  if (!['exact', 'city'].includes(record.event.geoPrecision)) return null;
  if (record.event.datePrecision === 'exact') {
    return {
      record,
      mode: 'exact',
      timeCell: Math.floor(timestamp / (6 * 60 * 60 * 1_000)),
      latCell: Math.floor(record.event.lat),
      lonCell: Math.floor(record.event.lon),
    };
  }
  if (record.event.datePrecision === 'day') {
    return {
      record,
      mode: 'day',
      timeCell: Math.floor(timestamp / (24 * 60 * 60 * 1_000)),
      latCell: Math.floor(record.event.lat / 2),
      lonCell: Math.floor(record.event.lon / 2),
    };
  }
  return null;
};

const spatialBucketKey = (entry: Pick<SpatialEntry, 'mode' | 'timeCell' | 'latCell' | 'lonCell'>) => (
  `${entry.mode}:${entry.timeCell}:${entry.latCell}:${entry.lonCell}`
);

const allPairs = (ids: string[], callback: (left: string, right: string) => void) => {
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) callback(ids[left], ids[right]);
  }
};

export const generateCaseGraphCandidates = (
  inputRecords: CaseGraphFeatureRecord[],
  rarity: CaseGraphCorpusRarity,
  options: CaseGraphCandidateGenerationOptions,
): CaseGraphCandidateGenerationResult => {
  const shardId = String(options.shardId || '').trim();
  if (!shardId) throw new Error('case_graph_shard_id_required');
  const records = sortedDistinctRecords(inputRecords);
  if (records.some((record) => record.corpusVersion !== rarity.corpusVersion)) {
    throw new Error('case_graph_corpus_version_mismatch');
  }
  const minimumTermRarity = clampRarity(options.minimumTermRarity);
  const maxTermPostings = clampInteger(options.maxTermPostings, DEFAULTS.maxTermPostings, 2, 100_000);
  const maxSpatialBucketRecords = clampInteger(
    options.maxSpatialBucketRecords,
    DEFAULTS.maxSpatialBucketRecords,
    2,
    100_000,
  );
  const maxSourceRecordPostings = clampInteger(
    options.maxSourceRecordPostings,
    DEFAULTS.maxSourceRecordPostings,
    2,
    10_000,
  );
  const maxCandidates = clampInteger(options.maxCandidates, DEFAULTS.maxCandidates, 1, 10_000_000);
  const candidates = new Map<string, CandidateAccumulator>();
  const touchedIds = new Set<string>();

  const addCandidate = (
    left: string,
    right: string,
    reason: CaseGraphCandidateReason,
    sharedTerm?: string,
  ) => {
    if (left === right) return;
    const [leftCaseId, rightCaseId] = [left, right].sort((a, b) => a.localeCompare(b));
    const pairKey = caseGraphPairKey(leftCaseId, rightCaseId);
    const accumulator = candidates.get(pairKey) || {
      leftCaseId,
      rightCaseId,
      reasons: new Set<CaseGraphCandidateReason>(),
      sharedTerms: new Set<string>(),
    };
    accumulator.reasons.add(reason);
    if (sharedTerm) accumulator.sharedTerms.add(sharedTerm);
    if (!candidates.has(pairKey) && candidates.size >= maxCandidates) {
      throw new Error(`case_graph_candidate_limit_exceeded:${maxCandidates}`);
    }
    candidates.set(pairKey, accumulator);
    touchedIds.add(leftCaseId);
    touchedIds.add(rightCaseId);
  };

  const skippedOversizedSourceRecords: Array<{ sourceRecord: string; postings: number }> = [];
  for (const [sourceRecord, idSet] of [...sourceRecordPostings(records).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ids = [...idSet].sort((a, b) => a.localeCompare(b));
    if (ids.length > maxSourceRecordPostings) {
      skippedOversizedSourceRecords.push({ sourceRecord, postings: ids.length });
      continue;
    }
    allPairs(ids, (left, right) => addCandidate(left, right, 'same_source_record'));
  }

  const skippedHighFrequencyTerms: Array<{ term: string; postings: number }> = [];
  for (const [key, posting] of [...termPostings(records, rarity, minimumTermRarity).entries()]
    .sort(([a], [b]) => a.localeCompare(b))) {
    const ids = [...posting.ids].sort((a, b) => a.localeCompare(b));
    const term = key.slice(key.indexOf(':') + 1);
    if (ids.length > maxTermPostings) {
      skippedHighFrequencyTerms.push({ term, postings: ids.length });
      continue;
    }
    allPairs(ids, (left, right) => addCandidate(left, right, posting.reason, term));
  }

  const entries = records.map(spatialEntry).filter((entry): entry is SpatialEntry => Boolean(entry));
  const buckets = new Map<string, SpatialEntry[]>();
  for (const entry of entries) {
    const key = spatialBucketKey(entry);
    const bucket = buckets.get(key) || [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => a.record.caseId.localeCompare(b.record.caseId));
  const oversizedBuckets = new Map<string, number>();
  for (const [key, bucket] of buckets) if (bucket.length > maxSpatialBucketRecords) oversizedBuckets.set(key, bucket.length);

  for (const entry of entries.sort((a, b) => a.record.caseId.localeCompare(b.record.caseId))) {
    if (oversizedBuckets.has(spatialBucketKey(entry))) continue;
    for (let timeOffset = -1; timeOffset <= 1; timeOffset += 1) {
      for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
        for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
          const neighborKey = spatialBucketKey({
            mode: entry.mode,
            timeCell: entry.timeCell + timeOffset,
            latCell: entry.latCell + latOffset,
            lonCell: entry.lonCell + lonOffset,
          });
          if (oversizedBuckets.has(neighborKey)) continue;
          for (const neighbor of buckets.get(neighborKey) || []) {
            if (entry.record.caseId >= neighbor.record.caseId) continue;
            addCandidate(
              entry.record.caseId,
              neighbor.record.caseId,
              entry.mode === 'exact' ? 'spacetime_exact_bucket' : 'spacetime_day_bucket',
            );
          }
        }
      }
    }
  }

  const outputCandidates = [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pairKey, value]) => ({
      pairKey,
      leftCaseId: value.leftCaseId,
      rightCaseId: value.rightCaseId,
      reasons: [...value.reasons].sort((a, b) => a.localeCompare(b)),
      sharedTerms: [...value.sharedTerms].sort((a, b) => a.localeCompare(b)),
    }));

  return {
    version: CASE_GRAPH_CANDIDATE_VERSION,
    corpusVersion: rarity.corpusVersion,
    shardId,
    candidates: outputCandidates,
    manifest: {
      inputCaseCount: records.length,
      accountedCaseCount: records.length,
      casesWithCandidates: touchedIds.size,
      isolatedCaseCount: records.length - touchedIds.size,
      exactSpacetimeCaseCount: entries.filter((entry) => entry.mode === 'exact').length,
      daySpacetimeCaseCount: entries.filter((entry) => entry.mode === 'day').length,
      skippedHighFrequencyTerms,
      skippedOversizedSpatialBuckets: [...oversizedBuckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, postings]) => ({ bucket, postings })),
      skippedOversizedSourceRecords,
    },
  };
};
