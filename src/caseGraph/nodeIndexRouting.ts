import { getCaseGraphReducerShard } from './candidateRouting';
import type { CaseGraphFeatureRecord } from './featureExtraction';
import type { CaseGraphRelationship } from './relationshipPolicy';

export const CASE_GRAPH_NODE_INDEX_VERSION = 'case-graph-node-index-v1' as const;

export type CaseGraphPublicNodeBase = {
  caseId: string;
  source: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  event: CaseGraphFeatureRecord['event'];
  durationSeconds: number | null;
  traits: CaseGraphFeatureRecord['traits'];
  completeness: CaseGraphFeatureRecord['completeness'];
  narrativeDigest: string;
  sourceUpdatedAt: string | null;
};

export type CaseGraphNodeRouteFragment = {
  version: typeof CASE_GRAPH_NODE_INDEX_VERSION;
  corpusVersion: string;
  inputFeaturePart: number;
  nodeShard: number;
  nodeShardCount: number;
  nodes: CaseGraphPublicNodeBase[];
};

export type CaseGraphIncident = {
  ownerCaseId: string;
  neighborCaseId: string;
  edgeId: string;
  edgeShard: number;
  type: CaseGraphRelationship['type'];
  strength: number;
  independence: CaseGraphRelationship['independence'];
  summary: string;
};

export type CaseGraphIncidentRouteFragment = {
  version: typeof CASE_GRAPH_NODE_INDEX_VERSION;
  corpusVersion: string;
  inputEdgeShard: number;
  nodeShard: number;
  nodeShardCount: number;
  incidents: CaseGraphIncident[];
};

export type CaseGraphPublicNode = CaseGraphPublicNodeBase & {
  degree: number;
  connected: boolean;
  detailPath: string;
};

export type CaseGraphEgoIndexRecord = {
  caseId: string;
  degree: number;
  incidents: CaseGraphIncident[];
};

const assertShardCount = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
    throw new Error('case_graph_node_shard_count_invalid');
  }
};

const projectNode = (record: CaseGraphFeatureRecord): CaseGraphPublicNodeBase => ({
  caseId: record.caseId,
  source: record.source,
  sourceRecordId: record.sourceRecordId,
  sourceUrl: record.sourceUrl,
  event: record.event,
  durationSeconds: record.durationSeconds,
  traits: record.traits,
  completeness: record.completeness,
  narrativeDigest: record.narrative.digest,
  sourceUpdatedAt: record.sourceUpdatedAt,
});

export const buildCaseGraphNodeRouteFragments = (params: {
  records: CaseGraphFeatureRecord[];
  inputFeaturePart: number;
  nodeShardCount: number;
}) => {
  assertShardCount(params.nodeShardCount);
  if (!Number.isSafeInteger(params.inputFeaturePart) || params.inputFeaturePart < 0) {
    throw new Error('case_graph_node_feature_part_invalid');
  }
  const sorted = [...params.records].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const ids = new Set<string>();
  const corpusVersion = sorted[0]?.corpusVersion || '';
  const byShard = new Map<number, CaseGraphPublicNodeBase[]>();
  for (const record of sorted) {
    if (!corpusVersion || record.corpusVersion !== corpusVersion) throw new Error('case_graph_corpus_version_mismatch');
    if (ids.has(record.caseId)) throw new Error(`case_graph_duplicate_case_id:${record.caseId}`);
    ids.add(record.caseId);
    const shard = getCaseGraphReducerShard(record.caseId, params.nodeShardCount);
    const nodes = byShard.get(shard) || [];
    nodes.push(projectNode(record));
    byShard.set(shard, nodes);
  }
  return [...byShard.entries()].sort(([left], [right]) => left - right).map(([nodeShard, nodes]) => ({
    version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpusVersion,
    inputFeaturePart: params.inputFeaturePart,
    nodeShard,
    nodeShardCount: params.nodeShardCount,
    nodes,
  }));
};

export const buildCaseGraphIncidentRouteFragments = (params: {
  corpusVersion: string;
  relationships: CaseGraphRelationship[];
  inputEdgeShard: number;
  nodeShardCount: number;
}) => {
  assertShardCount(params.nodeShardCount);
  if (!Number.isSafeInteger(params.inputEdgeShard) || params.inputEdgeShard < 0) {
    throw new Error('case_graph_node_edge_shard_invalid');
  }
  const byShard = new Map<number, CaseGraphIncident[]>();
  const seen = new Set<string>();
  for (const relationship of [...params.relationships].sort((left, right) => left.edgeId.localeCompare(right.edgeId))) {
    if (seen.has(relationship.edgeId)) throw new Error(`case_graph_duplicate_final_edge:${relationship.edgeId}`);
    seen.add(relationship.edgeId);
    for (const [ownerCaseId, neighborCaseId] of [
      [relationship.leftCaseId, relationship.rightCaseId],
      [relationship.rightCaseId, relationship.leftCaseId],
    ]) {
      const nodeShard = getCaseGraphReducerShard(ownerCaseId, params.nodeShardCount);
      const incidents = byShard.get(nodeShard) || [];
      incidents.push({
        ownerCaseId,
        neighborCaseId,
        edgeId: relationship.edgeId,
        edgeShard: params.inputEdgeShard,
        type: relationship.type,
        strength: relationship.strength,
        independence: relationship.independence,
        summary: relationship.summary,
      });
      byShard.set(nodeShard, incidents);
    }
  }
  return [...byShard.entries()].sort(([left], [right]) => left - right).map(([nodeShard, incidents]) => ({
    version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpusVersion: params.corpusVersion,
    inputEdgeShard: params.inputEdgeShard,
    nodeShard,
    nodeShardCount: params.nodeShardCount,
    incidents: incidents.sort((left, right) => (
      left.ownerCaseId.localeCompare(right.ownerCaseId)
      || right.strength - left.strength
      || left.edgeId.localeCompare(right.edgeId)
    )),
  }));
};

export const reduceCaseGraphNodeIndexShard = (params: {
  corpusVersion: string;
  nodeShard: number;
  nodeShardCount: number;
  nodeFragments: CaseGraphNodeRouteFragment[];
  incidentFragments: CaseGraphIncidentRouteFragment[];
}) => {
  assertShardCount(params.nodeShardCount);
  if (!Number.isSafeInteger(params.nodeShard) || params.nodeShard < 0 || params.nodeShard >= params.nodeShardCount) {
    throw new Error('case_graph_node_shard_invalid');
  }
  const nodes = new Map<string, CaseGraphPublicNodeBase>();
  for (const fragment of [...params.nodeFragments].sort((left, right) => left.inputFeaturePart - right.inputFeaturePart)) {
    if (
      fragment.version !== CASE_GRAPH_NODE_INDEX_VERSION
      || fragment.corpusVersion !== params.corpusVersion
      || fragment.nodeShard !== params.nodeShard
      || fragment.nodeShardCount !== params.nodeShardCount
    ) throw new Error('case_graph_node_fragment_identity_invalid');
    for (const node of fragment.nodes) {
      if (getCaseGraphReducerShard(node.caseId, params.nodeShardCount) !== params.nodeShard) {
        throw new Error('case_graph_node_routed_to_wrong_shard');
      }
      if (nodes.has(node.caseId)) throw new Error(`case_graph_duplicate_case_id:${node.caseId}`);
      nodes.set(node.caseId, node);
    }
  }
  const incidentsByCase = new Map<string, CaseGraphIncident[]>();
  const incidentKeys = new Set<string>();
  for (const fragment of [...params.incidentFragments].sort((left, right) => left.inputEdgeShard - right.inputEdgeShard)) {
    if (
      fragment.version !== CASE_GRAPH_NODE_INDEX_VERSION
      || fragment.corpusVersion !== params.corpusVersion
      || fragment.nodeShard !== params.nodeShard
      || fragment.nodeShardCount !== params.nodeShardCount
    ) throw new Error('case_graph_incident_fragment_identity_invalid');
    for (const incident of fragment.incidents) {
      if (getCaseGraphReducerShard(incident.ownerCaseId, params.nodeShardCount) !== params.nodeShard) {
        throw new Error('case_graph_incident_routed_to_wrong_shard');
      }
      const key = `${incident.ownerCaseId}::${incident.edgeId}`;
      if (incidentKeys.has(key)) throw new Error(`case_graph_duplicate_incident:${key}`);
      incidentKeys.add(key);
      const incidents = incidentsByCase.get(incident.ownerCaseId) || [];
      incidents.push(incident);
      incidentsByCase.set(incident.ownerCaseId, incidents);
    }
  }
  for (const caseId of incidentsByCase.keys()) {
    if (!nodes.has(caseId)) throw new Error(`case_graph_incident_owner_missing:${caseId}`);
  }
  const publicNodes: CaseGraphPublicNode[] = [...nodes.values()]
    .sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map((node) => {
      const degree = incidentsByCase.get(node.caseId)?.length || 0;
      return { ...node, degree, connected: degree > 0, detailPath: `/reports/${node.caseId}` };
    });
  const egoIndex: CaseGraphEgoIndexRecord[] = publicNodes.map((node) => ({
    caseId: node.caseId,
    degree: node.degree,
    incidents: [...(incidentsByCase.get(node.caseId) || [])].sort((left, right) => (
      right.strength - left.strength || left.edgeId.localeCompare(right.edgeId)
    )),
  }));
  return {
    version: CASE_GRAPH_NODE_INDEX_VERSION,
    corpusVersion: params.corpusVersion,
    nodeShard: params.nodeShard,
    nodeShardCount: params.nodeShardCount,
    nodes: publicNodes,
    egoIndex,
    manifest: {
      nodeCount: publicNodes.length,
      connectedNodeCount: publicNodes.filter((node) => node.connected).length,
      isolatedNodeCount: publicNodes.filter((node) => !node.connected).length,
      incidentCount: egoIndex.reduce((sum, record) => sum + record.degree, 0),
      maximumDegree: publicNodes.reduce((maximum, node) => Math.max(maximum, node.degree), 0),
    },
  };
};
