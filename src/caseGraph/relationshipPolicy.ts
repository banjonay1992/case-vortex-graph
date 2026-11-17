export const CASE_GRAPH_POLICY_VERSION = 'case-graph-relationship-v1' as const;

export type CaseGraphRelationshipType =
  | 'provenance'
  | 'same_incident_candidate'
  | 'shared_pattern'
  | 'shared_entity';

export type CaseGraphTemporalPrecision =
  | 'exact'
  | 'hour'
  | 'day'
  | 'month'
  | 'year'
  | 'unknown';

export type CaseGraphIndependence = 'independent' | 'dependent' | 'unknown';

export type CaseGraphFeatureMatch = {
  term: string;
  /** Corpus rarity from 0 (ubiquitous) to 1 (exceptionally rare). */
  rarity: number;
};

export type CaseGraphPairEvidence = {
  leftCaseId: string;
  rightCaseId: string;
  leftSource: string;
  rightSource: string;
  explicitCrossReference?: boolean;
  sameSourceRecord?: boolean;
  sameDuplicateCluster?: boolean;
  timeDeltaSeconds?: number | null;
  temporalPrecision?: CaseGraphTemporalPrecision;
  distanceKm?: number | null;
  /** Worst geographic precision of the pair, expressed as an approximate radius. */
  spatialPrecisionKm?: number | null;
  sharedVisual?: CaseGraphFeatureMatch[];
  sharedBehaviour?: CaseGraphFeatureMatch[];
  sharedSensory?: CaseGraphFeatureMatch[];
  sharedEntities?: CaseGraphFeatureMatch[];
  durationSimilarity?: number | null;
  narrativeSimilarity?: number | null;
  sourceIndependence?: CaseGraphIndependence;
};

export type CaseGraphReasonCode =
  | 'explicit_cross_reference'
  | 'same_source_record'
  | 'duplicate_cluster'
  | 'temporal_proximity'
  | 'spatial_proximity'
  | 'shared_visual'
  | 'shared_behaviour'
  | 'shared_sensory'
  | 'shared_entity'
  | 'similar_duration'
  | 'narrative_similarity'
  | 'independent_sources'
  | 'same_source_dependency';

export type CaseGraphReason = {
  code: CaseGraphReasonCode;
  label: string;
  detail: string;
  contribution: number;
};

export type CaseGraphWarningCode =
  | 'connection_not_causation'
  | 'same_source_dependency'
  | 'coarse_temporal_precision'
  | 'coarse_spatial_precision'
  | 'narrative_is_supporting_only';

export type CaseGraphWarning = {
  code: CaseGraphWarningCode;
  detail: string;
};

export type CaseGraphRelationship = {
  edgeId: string;
  policyVersion: typeof CASE_GRAPH_POLICY_VERSION;
  leftCaseId: string;
  rightCaseId: string;
  type: CaseGraphRelationshipType;
  /** Explainable evidence strength, not a probability or causal claim. */
  strength: number;
  independence: CaseGraphIndependence;
  summary: string;
  reasons: CaseGraphReason[];
  warnings: CaseGraphWarning[];
};

type FeatureCategory = 'visual' | 'behaviour' | 'sensory' | 'entity';

const FEATURE_CONFIG: Record<FeatureCategory, {
  code: CaseGraphReasonCode;
  label: string;
  cap: number;
}> = {
  visual: { code: 'shared_visual', label: 'Shared visual signature', cap: 16 },
  behaviour: { code: 'shared_behaviour', label: 'Shared behaviour', cap: 16 },
  sensory: { code: 'shared_sensory', label: 'Shared sensory signature', cap: 14 },
  entity: { code: 'shared_entity', label: 'Shared named entity or site', cap: 18 },
};

const clamp01 = (value: number | null | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
};

const finiteNonNegative = (value: number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalizeMatches = (matches: CaseGraphFeatureMatch[] | undefined) => {
  const byTerm = new Map<string, number>();
  for (const match of matches || []) {
    const term = String(match?.term || '').trim().toLowerCase();
    if (!term) continue;
    byTerm.set(term, Math.max(byTerm.get(term) || 0, clamp01(match.rarity)));
  }
  return [...byTerm.entries()]
    .map(([term, rarity]) => ({ term, rarity }))
    .sort((a, b) => a.term.localeCompare(b.term));
};

const scoreFeatureCategory = (
  category: FeatureCategory,
  matches: CaseGraphFeatureMatch[] | undefined,
): { reason: CaseGraphReason | null; score: number; rareCount: number } => {
  const normalized = normalizeMatches(matches);
  if (!normalized.length) return { reason: null, score: 0, rareCount: 0 };
  const config = FEATURE_CONFIG[category];
  const rawScore = normalized.reduce((total, match) => total + 2 + (match.rarity * 6), 0);
  const score = Math.min(config.cap, Math.round(rawScore));
  const rareCount = normalized.filter((match) => match.rarity >= 0.55).length;
  const detail = normalized
    .map((match) => `${match.term} (${Math.round(match.rarity * 100)}% rarity)`)
    .join(', ');
  return {
    score,
    rareCount,
    reason: {
      code: config.code,
      label: config.label,
      detail,
      contribution: score,
    },
  };
};

const scoreTemporal = (
  seconds: number | null | undefined,
  precision: CaseGraphTemporalPrecision,
): CaseGraphReason | null => {
  const delta = finiteNonNegative(seconds);
  if (delta == null || ['month', 'year', 'unknown'].includes(precision)) return null;
  const hours = delta / 3600;
  let contribution = 0;
  if (precision === 'day') {
    if (hours <= 24) contribution = 4;
    else if (hours <= 24 * 7) contribution = 2;
  } else if (hours <= 0.25) contribution = 18;
  else if (hours <= 1) contribution = 14;
  else if (hours <= 6) contribution = 9;
  else if (hours <= 24) contribution = 5;
  else if (hours <= 24 * 7) contribution = 2;
  if (!contribution) return null;
  const detail = hours < 1
    ? `${Math.round(delta / 60)} minutes apart`
    : `${Number(hours.toFixed(hours < 24 ? 1 : 0))} hours apart`;
  return { code: 'temporal_proximity', label: 'Temporal proximity', detail, contribution };
};

const scoreSpatial = (
  distanceKm: number | null | undefined,
  spatialPrecisionKm: number | null | undefined,
): CaseGraphReason | null => {
  const distance = finiteNonNegative(distanceKm);
  const precision = finiteNonNegative(spatialPrecisionKm);
  if (distance == null || (precision != null && precision > 100)) return null;
  let contribution = 0;
  if (distance <= 5) contribution = 18;
  else if (distance <= 25) contribution = 14;
  else if (distance <= 100) contribution = 8;
  else if (distance <= 500) contribution = 3;
  if (!contribution) return null;
  if (precision != null && precision > 25) contribution = Math.min(contribution, 5);
  return {
    code: 'spatial_proximity',
    label: 'Spatial proximity',
    detail: `${Number(distance.toFixed(distance < 10 ? 1 : 0))} km apart`,
    contribution,
  };
};

const stableCaseIds = (leftCaseId: string, rightCaseId: string) => (
  [String(leftCaseId).trim(), String(rightCaseId).trim()].sort((a, b) => a.localeCompare(b))
);

const buildSummary = (type: CaseGraphRelationshipType, reasons: CaseGraphReason[]) => {
  const evidence = reasons
    .filter((reason) => reason.contribution > 0)
    .slice(0, 4)
    .map((reason) => reason.detail);
  const prefix: Record<CaseGraphRelationshipType, string> = {
    provenance: 'Linked by record provenance',
    same_incident_candidate: 'Candidate reports of the same incident',
    shared_pattern: 'Cases share an evidence pattern',
    shared_entity: 'Cases share a named entity or site',
  };
  return evidence.length ? `${prefix[type]}: ${evidence.join('; ')}.` : `${prefix[type]}.`;
};

/**
 * Produces an explainable relationship only when corroborating structured
 * evidence crosses policy thresholds. It deliberately does not emit edges for
 * narrative similarity alone or for a single common characteristic.
 */
export const scoreCaseGraphRelationship = (
  evidence: CaseGraphPairEvidence,
): CaseGraphRelationship | null => {
  const [leftCaseId, rightCaseId] = stableCaseIds(evidence.leftCaseId, evidence.rightCaseId);
  if (!leftCaseId || !rightCaseId || leftCaseId === rightCaseId) return null;

  const temporalPrecision = evidence.temporalPrecision || 'unknown';
  const independence: CaseGraphIndependence = evidence.sameDuplicateCluster || evidence.sameSourceRecord
    ? 'dependent'
    : (evidence.sourceIndependence || (
      evidence.leftSource && evidence.rightSource && evidence.leftSource !== evidence.rightSource
        ? 'unknown'
        : 'dependent'
    ));
  const reasons: CaseGraphReason[] = [];
  const warnings: CaseGraphWarning[] = [{
    code: 'connection_not_causation',
    detail: 'This edge describes shared evidence and does not establish causation or extraordinary origin.',
  }];

  if (evidence.explicitCrossReference) {
    reasons.push({
      code: 'explicit_cross_reference',
      label: 'Explicit cross-reference',
      detail: 'One governed record explicitly references the other',
      contribution: 100,
    });
  }
  if (evidence.sameSourceRecord) {
    reasons.push({
      code: 'same_source_record',
      label: 'Same source record',
      detail: 'Both cases resolve to the same governed source record',
      contribution: 98,
    });
  }
  if (evidence.sameDuplicateCluster) {
    reasons.push({
      code: 'duplicate_cluster',
      label: 'Duplicate-cluster membership',
      detail: 'Both records belong to the same governed duplicate cluster',
      contribution: 96,
    });
  }

  const provenance = reasons.some((reason) => [
    'explicit_cross_reference', 'same_source_record', 'duplicate_cluster',
  ].includes(reason.code));

  const temporal = scoreTemporal(evidence.timeDeltaSeconds, temporalPrecision);
  const spatial = scoreSpatial(evidence.distanceKm, evidence.spatialPrecisionKm);
  if (temporal) reasons.push(temporal);
  if (spatial) reasons.push(spatial);

  const featureResults = [
    scoreFeatureCategory('visual', evidence.sharedVisual),
    scoreFeatureCategory('behaviour', evidence.sharedBehaviour),
    scoreFeatureCategory('sensory', evidence.sharedSensory),
    scoreFeatureCategory('entity', evidence.sharedEntities),
  ];
  for (const result of featureResults) if (result.reason) reasons.push(result.reason);

  const durationSimilarity = clamp01(evidence.durationSimilarity);
  if (durationSimilarity >= 0.72) {
    const contribution = durationSimilarity >= 0.92 ? 8 : durationSimilarity >= 0.82 ? 6 : 4;
    reasons.push({
      code: 'similar_duration',
      label: 'Similar observed duration',
      detail: `${Math.round(durationSimilarity * 100)}% duration similarity`,
      contribution,
    });
  }

  const narrativeSimilarity = clamp01(evidence.narrativeSimilarity);
  if (narrativeSimilarity >= 0.7) {
    const contribution = narrativeSimilarity >= 0.9 ? 12 : narrativeSimilarity >= 0.8 ? 8 : 4;
    reasons.push({
      code: 'narrative_similarity',
      label: 'Narrative similarity',
      detail: `${Math.round(narrativeSimilarity * 100)}% semantic similarity`,
      contribution,
    });
    warnings.push({
      code: 'narrative_is_supporting_only',
      detail: 'Narrative similarity supports candidate generation but cannot create an edge by itself.',
    });
  }

  if (independence === 'independent') {
    reasons.push({
      code: 'independent_sources',
      label: 'Independent sources',
      detail: 'The records come from sources currently classified as independent',
      contribution: 6,
    });
  } else if (independence === 'dependent') {
    reasons.push({
      code: 'same_source_dependency',
      label: 'Source dependency',
      detail: 'The records share a source lineage and are not independent corroboration',
      contribution: -12,
    });
    warnings.push({
      code: 'same_source_dependency',
      detail: 'Dependent records must not be counted as independent corroboration.',
    });
  }

  if (['month', 'year', 'unknown'].includes(temporalPrecision)) {
    warnings.push({
      code: 'coarse_temporal_precision',
      detail: 'Temporal precision is too coarse for a strong space-time relationship.',
    });
  }
  if ((finiteNonNegative(evidence.spatialPrecisionKm) || 0) > 100) {
    warnings.push({
      code: 'coarse_spatial_precision',
      detail: 'Geographic precision is too coarse for a strong spatial relationship.',
    });
  }

  const narrativeScore = reasons.find((reason) => reason.code === 'narrative_similarity')?.contribution || 0;
  const structuredReasons = reasons.filter((reason) => (
    reason.contribution > 0
    && !['narrative_similarity', 'independent_sources'].includes(reason.code)
  ));
  const rareFeatureCount = featureResults.reduce((sum, result) => sum + result.rareCount, 0);
  const featureCategoryCount = featureResults.filter((result) => result.score > 0).length;
  const featureScore = featureResults.reduce((sum, result) => sum + result.score, 0);
  const spaceTimeScore = (temporal?.contribution || 0) + (spatial?.contribution || 0);
  const independentBonus = independence === 'independent' ? 6 : 0;
  const dependencyPenalty = independence === 'dependent' && !provenance ? 12 : 0;

  let type: CaseGraphRelationshipType | null = null;
  if (provenance) type = 'provenance';
  else if (
    (spaceTimeScore >= 22 && (rareFeatureCount >= 1 || featureScore >= 8))
    || (spaceTimeScore >= 32 && independence === 'independent')
  ) type = 'same_incident_candidate';
  else if (featureResults[3].score >= 10 && structuredReasons.length >= 2) type = 'shared_entity';
  else if (featureCategoryCount >= 2 && rareFeatureCount >= 2 && (featureScore + narrativeScore) >= 28) {
    type = 'shared_pattern';
  }
  if (!type) return null;

  let strength = provenance
    ? Math.max(...reasons.filter((reason) => reason.contribution > 0).map((reason) => reason.contribution))
    : reasons.reduce((sum, reason) => sum + Math.max(0, reason.contribution), 0)
      - dependencyPenalty;
  strength += provenance && independence === 'independent' ? independentBonus : 0;
  if (!provenance && ['month', 'year', 'unknown'].includes(temporalPrecision)) strength = Math.min(strength, 55);
  if (!provenance && (finiteNonNegative(evidence.spatialPrecisionKm) || 0) > 100) strength = Math.min(strength, 55);
  strength = Math.max(0, Math.min(100, Math.round(strength)));
  if (!provenance && strength < 35) return null;

  const sortedReasons = [...reasons].sort((a, b) => (
    b.contribution - a.contribution || a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail)
  ));
  const sortedWarnings = [...warnings].sort((a, b) => a.code.localeCompare(b.code));

  return {
    edgeId: `${CASE_GRAPH_POLICY_VERSION}:${leftCaseId}:${rightCaseId}`,
    policyVersion: CASE_GRAPH_POLICY_VERSION,
    leftCaseId,
    rightCaseId,
    type,
    strength,
    independence,
    summary: buildSummary(type, sortedReasons),
    reasons: sortedReasons,
    warnings: sortedWarnings,
  };
};
