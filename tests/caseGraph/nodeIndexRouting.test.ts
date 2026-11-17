import { describe, expect, it } from 'vitest';

import { extractCaseGraphFeatures } from '../../src/caseGraph/featureExtraction';
import {
  buildCaseGraphIncidentRouteFragments,
  buildCaseGraphNodeRouteFragments,
  reduceCaseGraphNodeIndexShard,
} from '../../src/caseGraph/nodeIndexRouting';
import { scoreCaseGraphRelationship } from '../../src/caseGraph/relationshipPolicy';

const feature = (index: number) => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const result = extractCaseGraphFeatures({
    id, source: `archive-${index}`, source_url: `https://example.test/${index}`,
    event_timestamp: '2026-07-17T12:00:00Z', event_date_precision: 'exact',
    lat: 51.5, lon: -0.1, geo_precision: 'exact', description: 'Amber chevron hovered silently.',
  }, { corpusVersion: 'nodes-v1', eligibility: { eligible: true } });
  if (result.status !== 'included') throw new Error('fixture excluded');
  return result;
};

describe('case graph node and ego index routing', () => {
  it('accounts for connected and isolated cases across feature parts', () => {
    const records = [feature(1), feature(2), feature(3)];
    const relationship = scoreCaseGraphRelationship({
      leftCaseId: records[0].caseId,
      rightCaseId: records[1].caseId,
      leftSource: records[0].source,
      rightSource: records[1].source,
      explicitCrossReference: true,
      sourceIndependence: 'unknown',
    });
    if (!relationship) throw new Error('fixture edge rejected');
    const nodeFragments = records.flatMap((record, inputFeaturePart) => buildCaseGraphNodeRouteFragments({
      records: [record], inputFeaturePart, nodeShardCount: 2,
    }));
    const incidentFragments = buildCaseGraphIncidentRouteFragments({
      corpusVersion: 'nodes-v1', relationships: [relationship], inputEdgeShard: 0, nodeShardCount: 2,
    });
    const reduced = [0, 1].map((nodeShard) => reduceCaseGraphNodeIndexShard({
      corpusVersion: 'nodes-v1',
      nodeShard,
      nodeShardCount: 2,
      nodeFragments: nodeFragments.filter((fragment) => fragment.nodeShard === nodeShard),
      incidentFragments: incidentFragments.filter((fragment) => fragment.nodeShard === nodeShard),
    }));
    const nodes = reduced.flatMap((result) => result.nodes).sort((left, right) => left.caseId.localeCompare(right.caseId));
    expect(nodes).toHaveLength(3);
    expect(nodes.map((node) => node.degree)).toEqual([1, 1, 0]);
    expect(nodes[2]).toMatchObject({ connected: false, detailPath: `/reports/${records[2].caseId}` });
    const ego = reduced.flatMap((result) => result.egoIndex)
      .find((record) => record.caseId === records[0].caseId);
    expect(ego).toMatchObject({ degree: 1, incidents: [{ neighborCaseId: records[1].caseId }] });
    expect(reduced.reduce((sum, result) => sum + result.manifest.incidentCount, 0)).toBe(2);
  });

  it('fails closed on missing owners and duplicate incidents', () => {
    const records = [feature(1), feature(2)];
    const relationship = scoreCaseGraphRelationship({
      leftCaseId: records[0].caseId,
      rightCaseId: records[1].caseId,
      leftSource: records[0].source,
      rightSource: records[1].source,
      explicitCrossReference: true,
    });
    if (!relationship) throw new Error('fixture edge rejected');
    const incidents = buildCaseGraphIncidentRouteFragments({
      corpusVersion: 'nodes-v1', relationships: [relationship], inputEdgeShard: 0, nodeShardCount: 1,
    })[0];
    expect(() => reduceCaseGraphNodeIndexShard({
      corpusVersion: 'nodes-v1', nodeShard: 0, nodeShardCount: 1,
      nodeFragments: buildCaseGraphNodeRouteFragments({ records: [records[0]], inputFeaturePart: 0, nodeShardCount: 1 }),
      incidentFragments: [incidents],
    })).toThrow('case_graph_incident_owner_missing');
    expect(() => reduceCaseGraphNodeIndexShard({
      corpusVersion: 'nodes-v1', nodeShard: 0, nodeShardCount: 1,
      nodeFragments: buildCaseGraphNodeRouteFragments({ records, inputFeaturePart: 0, nodeShardCount: 1 }),
      incidentFragments: [incidents, { ...incidents, inputEdgeShard: 1 }],
    })).toThrow('case_graph_duplicate_incident');
  });
});
