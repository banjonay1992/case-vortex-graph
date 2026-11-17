import { describe, expect, it } from 'vitest';

import { accumulateCaseGraphDensity, createCaseGraphDensityState, finalizeCaseGraphDensity } from '../../src/caseGraph/densityModel';
import type { CaseGraphPublicNode } from '../../src/caseGraph/nodeIndexRouting';

const node = (index: number, overrides: Partial<CaseGraphPublicNode> = {}): CaseGraphPublicNode => ({
  caseId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  source: index % 2 ? 'archive-a' : 'archive-b',
  sourceRecordId: null,
  sourceUrl: null,
  event: {
    timestamp: `20${String(10 + index).padStart(2, '0')}-01-01T00:00:00Z`,
    datePrecision: 'exact', lat: 50 + index, lon: -2, geoPrecision: 'exact',
    spatialPrecisionKm: 0.1, locationKey: 'uk',
  },
  durationSeconds: 60,
  traits: { visual: [{ term: 'amber', origins: ['narrative'] }], behaviour: [], sensory: [], entities: [], keywords: [] },
  completeness: { score: 1, missing: [] },
  narrativeDigest: 'a'.repeat(64),
  sourceUpdatedAt: null,
  degree: index,
  connected: index > 0,
  detailPath: `/reports/${index}`,
  ...overrides,
});

describe('case graph semantic zoom density', () => {
  it('accounts for every node at each LOD including missing time and geography', () => {
    const state = createCaseGraphDensityState('density-v1');
    accumulateCaseGraphDensity(state, [node(1), node(2)]);
    accumulateCaseGraphDensity(state, [node(3, {
      event: { timestamp: null, datePrecision: 'unknown', lat: null, lon: null, geoPrecision: 'unknown', spatialPrecisionKm: null, locationKey: null },
    })]);
    const artifact = finalizeCaseGraphDensity(state);
    expect(artifact).toMatchObject({
      nodeCount: 3,
      accounting: { macroNodeCount: 3, regionalNodeCount: 3, unknownGeoNodeCount: 1, unknownTimeNodeCount: 1 },
    });
    expect(artifact.levels.macro.flatMap((cell) => cell.topSources).some((entry) => entry.source === 'archive-a')).toBe(true);
    expect(artifact.levels.regional.reduce((sum, cell) => sum + cell.count, 0)).toBe(3);
  });

  it('fails closed when state accounting is tampered', () => {
    const state = createCaseGraphDensityState('density-v1');
    accumulateCaseGraphDensity(state, [node(1)]);
    state.processedNodeCount = 2;
    expect(() => finalizeCaseGraphDensity(state)).toThrow('case_graph_density_accounting_mismatch');
  });
});
