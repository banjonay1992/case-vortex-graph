import type { CaseGraphCorpusRarity } from './corpusRarity';
import type { CaseGraphExtractedTerm, CaseGraphFeatureRecord } from './featureExtraction';
import type {
  CaseGraphFeatureMatch,
  CaseGraphIndependence,
  CaseGraphPairEvidence,
  CaseGraphTemporalPrecision,
} from './relationshipPolicy';
import { caseGraphSourcesShareLineage } from './sourceRegistry';

export type CaseGraphPairEvidenceOptions = {
  duplicateClusterIdsByCase?: Readonly<Record<string, string | null | undefined>>;
  explicitCrossReferencePairs?: ReadonlySet<string>;
  independentSourcePairs?: ReadonlySet<string>;
  sourceLineageBySource?: Readonly<Record<string, string | null | undefined>>;
  narrativeSimilarity?: number | null;
};

export type CaseGraphPairFeature = Pick<
  CaseGraphFeatureRecord,
  | 'caseId'
  | 'corpusVersion'
  | 'source'
  | 'sourceRecordId'
  | 'ingestionJobId'
  | 'event'
  | 'durationSeconds'
  | 'traits'
>;

export const caseGraphPairKey = (left: string, right: string) => (
  [String(left).trim(), String(right).trim()].sort((a, b) => a.localeCompare(b)).join('::')
);

const sourcePairKey = (left: string, right: string) => caseGraphPairKey(
  String(left).trim().toLowerCase(),
  String(right).trim().toLowerCase(),
);

const sharedTerms = (
  left: CaseGraphExtractedTerm[],
  right: CaseGraphExtractedTerm[],
  rarity: CaseGraphCorpusRarity,
): CaseGraphFeatureMatch[] => {
  const rightTerms = new Set(right.map((item) => item.term));
  return left
    .filter((item) => rightTerms.has(item.term))
    .map((item) => ({ term: item.term, rarity: rarity.rarity[item.term] ?? 0 }))
    .sort((a, b) => a.term.localeCompare(b.term));
};

const toTimestamp = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const toRadians = (degrees: number) => degrees * (Math.PI / 180);

export const caseGraphDistanceKm = (
  left: { lat: number | null; lon: number | null },
  right: { lat: number | null; lon: number | null },
) => {
  if (left.lat == null || left.lon == null || right.lat == null || right.lon == null) return null;
  const earthRadiusKm = 6_371.0088;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lon - left.lon);
  const leftLat = toRadians(left.lat);
  const rightLat = toRadians(right.lat);
  const a = (Math.sin(dLat / 2) ** 2)
    + (Math.cos(leftLat) * Math.cos(rightLat) * (Math.sin(dLon / 2) ** 2));
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
};

const precisionOrder: CaseGraphTemporalPrecision[] = ['exact', 'hour', 'day', 'month', 'year', 'unknown'];

const worstTemporalPrecision = (
  left: CaseGraphFeatureRecord['event']['datePrecision'],
  right: CaseGraphFeatureRecord['event']['datePrecision'],
): CaseGraphTemporalPrecision => {
  const leftIndex = precisionOrder.indexOf(left);
  const rightIndex = precisionOrder.indexOf(right);
  return precisionOrder[Math.max(leftIndex, rightIndex)] || 'unknown';
};

const worstSpatialPrecision = (left: number | null, right: number | null) => {
  // Unknown precision is intentionally treated as country-scale so coordinates
  // cannot silently create a precise spatial relationship.
  if (left == null || right == null) return 1_000;
  return Math.max(left, right);
};

const durationSimilarity = (left: number | null, right: number | null) => {
  if (left == null || right == null || left < 0 || right < 0) return null;
  if (left === 0 && right === 0) return 1;
  const largest = Math.max(left, right);
  return largest > 0 ? Math.min(left, right) / largest : null;
};

const resolveIndependence = (
  left: CaseGraphPairFeature,
  right: CaseGraphPairFeature,
  options: CaseGraphPairEvidenceOptions,
): CaseGraphIndependence => {
  if (left.source === right.source) return 'dependent';
  if (left.ingestionJobId && left.ingestionJobId === right.ingestionJobId) return 'dependent';
  const leftLineage = options.sourceLineageBySource?.[left.source];
  const rightLineage = options.sourceLineageBySource?.[right.source];
  if (leftLineage && rightLineage && leftLineage === rightLineage) return 'dependent';
  if (caseGraphSourcesShareLineage(left.source, right.source)) return 'dependent';
  if (options.independentSourcePairs?.has(sourcePairKey(left.source, right.source))) return 'independent';
  return 'unknown';
};

export const buildCaseGraphPairEvidence = (
  left: CaseGraphPairFeature,
  right: CaseGraphPairFeature,
  rarity: CaseGraphCorpusRarity,
  options: CaseGraphPairEvidenceOptions = {},
): CaseGraphPairEvidence => {
  if (left.corpusVersion !== right.corpusVersion || left.corpusVersion !== rarity.corpusVersion) {
    throw new Error('case_graph_corpus_version_mismatch');
  }
  if (left.caseId === right.caseId) throw new Error('case_graph_pair_requires_distinct_cases');
  const leftTime = toTimestamp(left.event.timestamp);
  const rightTime = toTimestamp(right.event.timestamp);
  const leftCluster = options.duplicateClusterIdsByCase?.[left.caseId];
  const rightCluster = options.duplicateClusterIdsByCase?.[right.caseId];
  const sameSourceRecord = Boolean(
    left.sourceRecordId
    && right.sourceRecordId
    && left.source === right.source
    && left.sourceRecordId === right.sourceRecordId,
  );

  return {
    leftCaseId: left.caseId,
    rightCaseId: right.caseId,
    leftSource: left.source,
    rightSource: right.source,
    explicitCrossReference: options.explicitCrossReferencePairs?.has(caseGraphPairKey(left.caseId, right.caseId)) || false,
    sameSourceRecord,
    sameDuplicateCluster: Boolean(leftCluster && rightCluster && leftCluster === rightCluster),
    timeDeltaSeconds: leftTime != null && rightTime != null ? Math.abs(leftTime - rightTime) / 1_000 : null,
    temporalPrecision: worstTemporalPrecision(left.event.datePrecision, right.event.datePrecision),
    distanceKm: caseGraphDistanceKm(left.event, right.event),
    spatialPrecisionKm: worstSpatialPrecision(left.event.spatialPrecisionKm, right.event.spatialPrecisionKm),
    sharedVisual: sharedTerms(left.traits.visual, right.traits.visual, rarity),
    sharedBehaviour: sharedTerms(left.traits.behaviour, right.traits.behaviour, rarity),
    sharedSensory: sharedTerms(left.traits.sensory, right.traits.sensory, rarity),
    sharedEntities: sharedTerms(left.traits.entities, right.traits.entities, rarity),
    durationSimilarity: durationSimilarity(left.durationSeconds, right.durationSeconds),
    narrativeSimilarity: options.narrativeSimilarity ?? null,
    sourceIndependence: resolveIndependence(left, right, options),
  };
};
