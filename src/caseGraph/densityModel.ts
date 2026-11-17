import type { CaseGraphPublicNode } from './nodeIndexRouting';

export const CASE_GRAPH_DENSITY_VERSION = 'case-graph-density-v1' as const;
export type CaseGraphDensityLevel = 'macro' | 'regional';

type CellAccumulator = {
  id: string;
  level: CaseGraphDensityLevel;
  timeBin: string;
  latBin: number | null;
  lonBin: number | null;
  count: number;
  connectedCount: number;
  degreeSum: number;
  maximumDegree: number;
  latitudeSum: number;
  longitudeSum: number;
  coordinateCount: number;
  timestampSum: number;
  timestampCount: number;
  sources: Record<string, number>;
  traits: Record<string, number>;
};

export type CaseGraphDensityState = {
  version: typeof CASE_GRAPH_DENSITY_VERSION;
  corpusVersion: string;
  processedNodeCount: number;
  macro: Record<string, CellAccumulator>;
  regional: Record<string, CellAccumulator>;
};

export type CaseGraphDensityCell = {
  id: string;
  level: CaseGraphDensityLevel;
  timeBin: string;
  latBin: number | null;
  lonBin: number | null;
  count: number;
  connectedCount: number;
  isolatedCount: number;
  averageDegree: number;
  maximumDegree: number;
  centroid: { lat: number; lon: number } | null;
  meanTimestamp: string | null;
  topSources: Array<{ source: string; count: number }>;
  topTraits: Array<{ term: string; count: number }>;
};

export type CaseGraphDensityArtifact = {
  version: typeof CASE_GRAPH_DENSITY_VERSION;
  corpusVersion: string;
  nodeCount: number;
  levels: {
    macro: CaseGraphDensityCell[];
    regional: CaseGraphDensityCell[];
  };
  accounting: {
    macroNodeCount: number;
    regionalNodeCount: number;
    unknownGeoNodeCount: number;
    unknownTimeNodeCount: number;
  };
};

export const createCaseGraphDensityState = (corpusVersion: string): CaseGraphDensityState => {
  const normalized = String(corpusVersion || '').trim();
  if (!normalized) throw new Error('case_graph_corpus_version_required');
  return {
    version: CASE_GRAPH_DENSITY_VERSION,
    corpusVersion: normalized,
    processedNodeCount: 0,
    macro: {},
    regional: {},
  };
};

const parseTimestamp = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const floorBin = (value: number, size: number, offset: number) => Math.floor((value + offset) / size);

const descriptor = (node: CaseGraphPublicNode, level: CaseGraphDensityLevel) => {
  const timestamp = parseTimestamp(node.event.timestamp);
  const year = timestamp == null ? null : new Date(timestamp).getUTCFullYear();
  const timeSize = level === 'macro' ? 25 : 5;
  const geoSize = level === 'macro' ? 30 : 10;
  const timeBin = year == null ? 'unknown' : `${Math.floor(year / timeSize) * timeSize}`;
  const hasGeo = node.event.lat != null && node.event.lon != null;
  const latBin = hasGeo ? floorBin(node.event.lat!, geoSize, 90) : null;
  const lonBin = hasGeo ? floorBin(node.event.lon!, geoSize, 180) : null;
  return {
    id: `${level}:t${timeBin}:g${latBin ?? 'x'}:${lonBin ?? 'x'}`,
    level,
    timeBin,
    latBin,
    lonBin,
    timestamp,
  };
};

const nodeTraits = (node: CaseGraphPublicNode) => new Set([
  ...node.traits.visual,
  ...node.traits.behaviour,
  ...node.traits.sensory,
  ...node.traits.entities,
].map((trait) => trait.term));

const accumulate = (
  target: Record<string, CellAccumulator>,
  node: CaseGraphPublicNode,
  level: CaseGraphDensityLevel,
) => {
  const cell = descriptor(node, level);
  const current = target[cell.id] || {
    id: cell.id,
    level,
    timeBin: cell.timeBin,
    latBin: cell.latBin,
    lonBin: cell.lonBin,
    count: 0,
    connectedCount: 0,
    degreeSum: 0,
    maximumDegree: 0,
    latitudeSum: 0,
    longitudeSum: 0,
    coordinateCount: 0,
    timestampSum: 0,
    timestampCount: 0,
    sources: {},
    traits: {},
  };
  current.count += 1;
  current.connectedCount += node.connected ? 1 : 0;
  current.degreeSum += node.degree;
  current.maximumDegree = Math.max(current.maximumDegree, node.degree);
  if (node.event.lat != null && node.event.lon != null) {
    current.latitudeSum += node.event.lat;
    current.longitudeSum += node.event.lon;
    current.coordinateCount += 1;
  }
  if (cell.timestamp != null) {
    current.timestampSum += cell.timestamp;
    current.timestampCount += 1;
  }
  current.sources[node.source] = (current.sources[node.source] || 0) + 1;
  for (const trait of nodeTraits(node)) current.traits[trait] = (current.traits[trait] || 0) + 1;
  target[cell.id] = current;
};

export const accumulateCaseGraphDensity = (
  state: CaseGraphDensityState,
  nodes: CaseGraphPublicNode[],
) => {
  if (state.version !== CASE_GRAPH_DENSITY_VERSION) throw new Error('case_graph_density_state_version_invalid');
  for (const node of nodes) {
    accumulate(state.macro, node, 'macro');
    accumulate(state.regional, node, 'regional');
    state.processedNodeCount += 1;
  }
  return state;
};

const topCounts = (counts: Record<string, number>, limit: number) => Object.entries(counts)
  .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
  .slice(0, limit);

const finalizeCell = (cell: CellAccumulator): CaseGraphDensityCell => ({
  id: cell.id,
  level: cell.level,
  timeBin: cell.timeBin,
  latBin: cell.latBin,
  lonBin: cell.lonBin,
  count: cell.count,
  connectedCount: cell.connectedCount,
  isolatedCount: cell.count - cell.connectedCount,
  averageDegree: Number((cell.degreeSum / cell.count).toFixed(4)),
  maximumDegree: cell.maximumDegree,
  centroid: cell.coordinateCount ? {
    lat: Number((cell.latitudeSum / cell.coordinateCount).toFixed(5)),
    lon: Number((cell.longitudeSum / cell.coordinateCount).toFixed(5)),
  } : null,
  meanTimestamp: cell.timestampCount ? new Date(cell.timestampSum / cell.timestampCount).toISOString() : null,
  topSources: topCounts(cell.sources, 5).map(([source, count]) => ({ source, count })),
  topTraits: topCounts(cell.traits, 8).map(([term, count]) => ({ term, count })),
});

export const finalizeCaseGraphDensity = (state: CaseGraphDensityState): CaseGraphDensityArtifact => {
  const macro = Object.values(state.macro).sort((left, right) => left.id.localeCompare(right.id)).map(finalizeCell);
  const regional = Object.values(state.regional).sort((left, right) => left.id.localeCompare(right.id)).map(finalizeCell);
  const macroCount = macro.reduce((sum, cell) => sum + cell.count, 0);
  const regionalCount = regional.reduce((sum, cell) => sum + cell.count, 0);
  if (macroCount !== state.processedNodeCount || regionalCount !== state.processedNodeCount) {
    throw new Error('case_graph_density_accounting_mismatch');
  }
  return {
    version: CASE_GRAPH_DENSITY_VERSION,
    corpusVersion: state.corpusVersion,
    nodeCount: state.processedNodeCount,
    levels: { macro, regional },
    accounting: {
      macroNodeCount: macroCount,
      regionalNodeCount: regionalCount,
      unknownGeoNodeCount: macro.filter((cell) => cell.latBin == null).reduce((sum, cell) => sum + cell.count, 0),
      unknownTimeNodeCount: macro.filter((cell) => cell.timeBin === 'unknown').reduce((sum, cell) => sum + cell.count, 0),
    },
  };
};
