import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_POLICY_VERSION,
  scoreCaseGraphRelationship,
  type CaseGraphPairEvidence,
} from '../../src/caseGraph/relationshipPolicy';

const basePair = (overrides: Partial<CaseGraphPairEvidence> = {}): CaseGraphPairEvidence => ({
  leftCaseId: 'case-b',
  rightCaseId: 'case-a',
  leftSource: 'archive-one',
  rightSource: 'archive-two',
  temporalPrecision: 'exact',
  spatialPrecisionKm: 1,
  sourceIndependence: 'independent',
  ...overrides,
});

describe('case graph relationship policy', () => {
  it('emits deterministic provenance receipts for explicit references', () => {
    const relationship = scoreCaseGraphRelationship(basePair({ explicitCrossReference: true }));

    expect(relationship).toMatchObject({
      edgeId: `${CASE_GRAPH_POLICY_VERSION}:case-a:case-b`,
      leftCaseId: 'case-a',
      rightCaseId: 'case-b',
      type: 'provenance',
      strength: 100,
      independence: 'independent',
    });
    expect(relationship?.reasons[0].code).toBe('explicit_cross_reference');
    expect(relationship?.warnings.map((warning) => warning.code)).toContain('connection_not_causation');
  });

  it('labels duplicate-cluster links as dependent rather than corroborating', () => {
    const relationship = scoreCaseGraphRelationship(basePair({
      sameDuplicateCluster: true,
      sourceIndependence: 'independent',
    }));

    expect(relationship).toMatchObject({
      type: 'provenance',
      strength: 96,
      independence: 'dependent',
    });
    expect(relationship?.warnings.map((warning) => warning.code)).toContain('same_source_dependency');
  });

  it('rejects narrative similarity plus a single common characteristic', () => {
    const relationship = scoreCaseGraphRelationship(basePair({
      narrativeSimilarity: 0.99,
      sharedVisual: [{ term: 'light', rarity: 0.05 }],
    }));

    expect(relationship).toBeNull();
  });

  it('connects close independent reports when rare structured evidence agrees', () => {
    const relationship = scoreCaseGraphRelationship(basePair({
      timeDeltaSeconds: 47 * 60,
      distanceKm: 34,
      sharedVisual: [
        { term: 'three amber lights', rarity: 0.92 },
        { term: 'triangular formation', rarity: 0.71 },
      ],
      sharedBehaviour: [{ term: 'silent westward movement', rarity: 0.88 }],
    }));

    expect(relationship).toMatchObject({
      type: 'same_incident_candidate',
      independence: 'independent',
    });
    expect(relationship?.strength).toBeGreaterThanOrEqual(35);
    expect(relationship?.summary).toContain('34 km apart');
    expect(relationship?.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      'temporal_proximity',
      'spatial_proximity',
      'shared_visual',
      'shared_behaviour',
      'independent_sources',
    ]));
  });

  it('does not manufacture a precise incident link from coarse dates and places', () => {
    const relationship = scoreCaseGraphRelationship(basePair({
      temporalPrecision: 'year',
      spatialPrecisionKm: 250,
      timeDeltaSeconds: 0,
      distanceKm: 0,
      narrativeSimilarity: 0.95,
      sharedVisual: [{ term: 'disk', rarity: 0.18 }],
    }));

    expect(relationship).toBeNull();
  });

  it('allows a rare multi-category pattern without claiming a shared incident', () => {
    const relationship = scoreCaseGraphRelationship(basePair({
      temporalPrecision: 'unknown',
      sharedVisual: [
        { term: 'structured chevron', rarity: 0.91 },
        { term: 'five fixed lights', rarity: 0.86 },
      ],
      sharedSensory: [{ term: 'radio interference', rarity: 0.94 }],
      narrativeSimilarity: 0.84,
    }));

    expect(relationship).toMatchObject({ type: 'shared_pattern' });
    expect(relationship?.strength).toBeLessThanOrEqual(55);
    expect(relationship?.warnings.map((warning) => warning.code)).toContain('coarse_temporal_precision');
  });

  it('deduplicates and sorts feature terms so input order cannot change receipts', () => {
    const forward = scoreCaseGraphRelationship(basePair({
      sharedVisual: [
        { term: 'Zig-zag movement', rarity: 0.8 },
        { term: 'amber', rarity: 0.7 },
        { term: 'AMBER', rarity: 0.9 },
      ],
      sharedBehaviour: [{ term: 'hover then depart', rarity: 0.9 }],
      narrativeSimilarity: 0.82,
    }));
    const reversed = scoreCaseGraphRelationship(basePair({
      sharedVisual: [
        { term: 'AMBER', rarity: 0.9 },
        { term: 'amber', rarity: 0.7 },
        { term: 'Zig-zag movement', rarity: 0.8 },
      ],
      sharedBehaviour: [{ term: 'hover then depart', rarity: 0.9 }],
      narrativeSimilarity: 0.82,
    }));

    expect(forward).toEqual(reversed);
    expect(forward?.reasons.find((reason) => reason.code === 'shared_visual')?.detail)
      .toBe('amber (90% rarity), zig-zag movement (80% rarity)');
  });

  it('penalizes same-source pattern matches and records the dependency warning', () => {
    const relationship = scoreCaseGraphRelationship(basePair({
      leftSource: 'same-archive',
      rightSource: 'same-archive',
      sourceIndependence: 'dependent',
      sharedVisual: [
        { term: 'green rectangular object', rarity: 0.91 },
        { term: 'four corner lights', rarity: 0.88 },
      ],
      sharedBehaviour: [{ term: 'instant acceleration', rarity: 0.96 }],
      sharedSensory: [
        { term: 'radio interference', rarity: 0.94 },
        { term: 'engine interruption', rarity: 0.9 },
      ],
      durationSimilarity: 0.95,
      narrativeSimilarity: 0.91,
    }));

    expect(relationship).toMatchObject({
      type: 'shared_pattern',
      independence: 'dependent',
    });
    expect(relationship?.reasons.map((reason) => reason.code)).toContain('same_source_dependency');
    expect(relationship?.warnings.map((warning) => warning.code)).toContain('same_source_dependency');
  });
});
