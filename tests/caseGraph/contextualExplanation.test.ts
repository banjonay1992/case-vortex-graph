import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  CONTEXTUAL_EXPLANATION_POLICY,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  type AircraftContextCandidateDraft,
  type AstronomyContextCandidateDraft,
  type ContextualExplanationCandidateDraft,
  type ContextualExplanationEdge,
  type ContextualProvenanceDraft,
  type SatelliteContextCandidateDraft,
  type WeatherContextCandidateDraft,
  buildContextualExplanationEdge,
  canonicalizeContextualExplanation,
  decodeContextualExplanationEdge,
  evaluateContextualExplanationCandidate,
  serializeContextualExplanationEdge,
} from '../../src/caseGraph/contextualExplanation';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

const provenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
  providerId: string,
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId,
  sourceRecordId: `${sourceRef}-record`,
  datasetVersion: 'context-fixture-2026-07-18',
  retrievedAt: '2026-07-18T00:00:00.000Z',
  contentSha256: sha(`${sourceRef}-content`),
  sourceUri: `https://example.test/${sourceRef}`,
});

const model = () => ({
  modelId: 'deterministic-context-matcher',
  modelVersion: '1.0.0',
  method: 'deterministic' as const,
  inputSha256: sha('matcher-input'),
  outputSha256: sha('matcher-output'),
});

const aircraftCandidate = (): AircraftContextCandidateDraft => ({
  kind: 'aircraft',
  subjectAddress: 'sighting:case-001',
  reference: { referenceId: 'adsb:flight-101', label: 'Flight 101 governed track' },
  subjectObservation: {
    window: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:20.000Z',
      precisionSeconds: 10,
    },
    location: { lat: 51.5, lon: -0.1, precisionKm: 1 },
    skyPosition: { azimuthDeg: 100, elevationDeg: 30, precisionDeg: 1 },
  },
  referenceObservation: {
    window: {
      start: '2026-01-01T00:00:30.000Z',
      end: '2026-01-01T00:00:40.000Z',
      precisionSeconds: 5,
    },
    location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
    skyPosition: { azimuthDeg: 102, elevationDeg: 30, precisionDeg: 0.25 },
  },
  provenance: [
    provenance('subject-report', 'subject_observation', 'uapfiles'),
    provenance('aircraft-track', 'context_reference', 'adsb-history'),
  ],
  domainEvidence: [{
    code: 'track_coverage_fraction',
    value: 0.9,
    precision: 0.05,
    method: 'catalogue',
    methodVersion: 'adsb-track-coverage-v1',
    sourceRefs: ['aircraft-track'],
  }],
  missingness: [],
  uncertainty: { level: 'low', reasons: ['witness_direction_precision'] },
  model: model(),
});

const satelliteCandidate = (): SatelliteContextCandidateDraft => ({
  kind: 'satellite',
  subjectAddress: 'sighting:case-002',
  reference: { referenceId: 'norad:25544', label: 'Tracked satellite pass' },
  subjectObservation: {
    window: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:00.000Z',
      precisionSeconds: 5,
    },
    location: { lat: 51.5, lon: -0.1, precisionKm: 1 },
    skyPosition: { azimuthDeg: 150, elevationDeg: 40, precisionDeg: 1 },
  },
  referenceObservation: {
    window: {
      start: '2026-01-01T00:00:30.000Z',
      end: '2026-01-01T00:00:30.000Z',
      precisionSeconds: 2,
    },
    location: null,
    skyPosition: { azimuthDeg: 151, elevationDeg: 40, precisionDeg: 0.1 },
  },
  provenance: [
    provenance('subject-report', 'subject_observation', 'uapfiles'),
    provenance('satellite-pass', 'context_reference', 'space-track'),
  ],
  domainEvidence: [
    {
      code: 'track_coverage_fraction',
      value: 0.9,
      precision: 0.05,
      method: 'catalogue',
      methodVersion: 'sgp4-coverage-v1',
      sourceRefs: ['satellite-pass'],
    },
    {
      code: 'orbit_epoch_age_hours',
      value: 24,
      precision: 1,
      method: 'catalogue',
      methodVersion: 'tle-age-v1',
      sourceRefs: ['satellite-pass'],
    },
  ],
  missingness: [{ field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution' }],
  uncertainty: { level: 'low', reasons: ['witness_direction_precision'] },
  model: model(),
});

const astronomyCandidate = (): AstronomyContextCandidateDraft => ({
  kind: 'astronomy',
  subjectAddress: 'sighting:case-003',
  reference: { referenceId: 'iau:venus', label: 'Venus ephemeris position' },
  subjectObservation: {
    window: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:05:00.000Z',
      precisionSeconds: 30,
    },
    location: { lat: 51.5, lon: -0.1, precisionKm: 2 },
    skyPosition: { azimuthDeg: 220, elevationDeg: 20, precisionDeg: 1 },
  },
  referenceObservation: {
    window: {
      start: '2026-01-01T00:02:30.000Z',
      end: '2026-01-01T00:02:30.000Z',
      precisionSeconds: 1,
    },
    location: null,
    skyPosition: { azimuthDeg: 221, elevationDeg: 20, precisionDeg: 0.05 },
  },
  provenance: [
    provenance('subject-report', 'subject_observation', 'uapfiles'),
    provenance('ephemeris', 'context_reference', 'jpl-horizons'),
  ],
  domainEvidence: [{
    code: 'ephemeris_accuracy_deg',
    value: 0.1,
    precision: 0.05,
    method: 'catalogue',
    methodVersion: 'ephemeris-solution-v1',
    sourceRefs: ['ephemeris'],
  }],
  missingness: [{ field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution' }],
  uncertainty: { level: 'low', reasons: ['witness_direction_precision'] },
  model: model(),
});

const weatherCandidate = (): WeatherContextCandidateDraft => ({
  kind: 'weather',
  subjectAddress: 'sighting:case-004',
  reference: { referenceId: 'met:station-123', label: 'Governed weather observation' },
  subjectObservation: {
    window: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:10:00.000Z',
      precisionSeconds: 60,
    },
    location: { lat: 51.5, lon: -0.1, precisionKm: 3 },
    skyPosition: null,
  },
  referenceObservation: {
    window: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T01:00:00.000Z',
      precisionSeconds: 120,
    },
    location: { lat: 51.6, lon: -0.2, precisionKm: 5 },
    skyPosition: null,
  },
  provenance: [
    provenance('subject-report', 'subject_observation', 'uapfiles'),
    provenance('weather-observation', 'context_reference', 'met-office'),
  ],
  domainEvidence: [
    {
      code: 'observation_coverage_fraction',
      value: 0.8,
      precision: 0.1,
      method: 'measured',
      methodVersion: 'weather-window-v1',
      sourceRefs: ['weather-observation'],
    },
    {
      code: 'phenomenon_match_score',
      value: 0.9,
      precision: 0.05,
      method: 'deterministic_rule',
      methodVersion: 'weather-trait-match-v1',
      sourceRefs: ['weather-observation'],
    },
  ],
  missingness: [
    { field: 'reference.sky_position', status: 'not_applicable', reason: 'area_weather_observation' },
    { field: 'subject.sky_position', status: 'not_recorded', reason: 'source_omitted_direction' },
  ],
  uncertainty: { level: 'medium', reasons: ['area_observation'] },
  model: model(),
});

const candidates = (): ContextualExplanationCandidateDraft[] => [
  aircraftCandidate(),
  satelliteCandidate(),
  astronomyCandidate(),
  weatherCandidate(),
];

describe('contextual explanation relationships', () => {
  it('emits distinct, provenance-rich candidate edge types for aircraft, satellites, astronomy, and weather', () => {
    const edges = candidates().map((candidate) => buildContextualExplanationEdge(candidate));

    expect(edges.every(Boolean)).toBe(true);
    expect(edges.map((edge) => edge?.edgeType)).toEqual([
      'context_aircraft_candidate',
      'context_satellite_candidate',
      'context_astronomy_candidate',
      'context_weather_candidate',
    ]);
    for (const edge of edges as ContextualExplanationEdge[]) {
      expect(edge.edgeId).toMatch(/^context-edge:[a-f0-9]{64}$/);
      expect(edge.contextNodeId).toMatch(/^context-node:(aircraft|satellite|astronomy|weather):[a-f0-9]{64}$/);
      expect(edge.policy).toEqual({
        version: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
        sha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
      });
      expect(edge.provenance.some((item) => item.role === 'subject_observation')).toBe(true);
      expect(edge.provenance.some((item) => item.role === 'context_reference')).toBe(true);
      expect(edge.matchingEvidence.every((item) => item.lowerBound <= item.value && item.value <= item.upperBound)).toBe(true);
      expect(edge.receipt.decision).toBe('emit_candidate_edge');
      expect(edge.receipt.failedChecks).toEqual([]);
    }
  });

  it('is deterministic across input ordering and has stable canonical serialization and decoding', () => {
    const firstDraft = satelliteCandidate();
    const reordered = clone(firstDraft);
    reordered.provenance.reverse();
    reordered.domainEvidence.reverse();
    reordered.domainEvidence.forEach((item) => item.sourceRefs.reverse());
    reordered.missingness.reverse();
    reordered.uncertainty.reasons.reverse();

    const first = buildContextualExplanationEdge(firstDraft);
    const second = buildContextualExplanationEdge(reordered);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);

    const serialized = serializeContextualExplanationEdge(first as ContextualExplanationEdge);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.slice(0, -1)).toBe(canonicalizeContextualExplanation(first));
    expect(decodeContextualExplanationEdge(serialized)).toEqual(first);
  });

  it('publishes an explicit non-causal, non-debunking, origin-neutral human and machine receipt', () => {
    const edge = buildContextualExplanationEdge(aircraftCandidate());
    expect(edge?.claimDiscipline).toEqual(CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE);
    expect(edge?.receipt.claimDiscipline).toEqual(CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE);
    expect(edge?.receipt).toMatchObject({
      decision: 'emit_candidate_edge',
      policyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
      policySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
      claimDiscipline: {
        causality: 'not_assessed',
        debunking: 'not_assessed',
        origin: 'not_assessed',
        extraordinaryOrigin: 'not_assessed',
      },
    });
    expect(edge?.explanation.plainEnglish).toContain('candidate contextual correlation only');
    expect(edge?.explanation.plainEnglish).toContain('not a causal attribution');
    expect(edge?.explanation.plainEnglish.toLowerCase()).not.toContain('caused by');
  });

  it('fails closed when an aircraft is nearby in time and ground distance but not in the reported sky direction', () => {
    const draft = aircraftCandidate();
    (draft.referenceObservation.skyPosition as NonNullable<typeof draft.referenceObservation.skyPosition>).azimuthDeg = 210;
    const evaluation = evaluateContextualExplanationCandidate(draft);

    expect(evaluation.edge).toBeNull();
    expect(evaluation.receipt.decision).toBe('insufficient_evidence');
    expect(evaluation.receipt.failedChecks).toContain('angular_separation_upper');
    expect(evaluation.receipt.plainEnglish).toContain('No contextual edge was emitted');
  });

  it('fails closed for a stale satellite orbit, below-horizon astronomy, and weak weather phenomenon match', () => {
    const satellite = satelliteCandidate();
    const epochAge = satellite.domainEvidence.find((item) => item.code === 'orbit_epoch_age_hours');
    if (epochAge) {
      epochAge.value = 73;
      epochAge.precision = 0;
    }
    expect(evaluateContextualExplanationCandidate(satellite).receipt.failedChecks)
      .toContain('domain_orbit_epoch_age_hours_upper');

    const astronomy = astronomyCandidate();
    const subjectSky = astronomy.subjectObservation.skyPosition;
    const referenceSky = astronomy.referenceObservation.skyPosition;
    if (subjectSky && referenceSky) {
      subjectSky.elevationDeg = -1;
      subjectSky.precisionDeg = 0;
      referenceSky.elevationDeg = -1;
      referenceSky.precisionDeg = 0;
    }
    expect(evaluateContextualExplanationCandidate(astronomy).receipt.failedChecks)
      .toEqual(expect.arrayContaining(['reference_elevation_visible', 'subject_elevation_visible']));

    const weather = weatherCandidate();
    const phenomenon = weather.domainEvidence.find((item) => item.code === 'phenomenon_match_score');
    if (phenomenon) {
      phenomenon.value = 0.799;
      phenomenon.precision = 0;
    }
    expect(evaluateContextualExplanationCandidate(weather).receipt.failedChecks)
      .toContain('domain_phenomenon_match_score_lower');
  });

  it('fails closed when the reported direction is below the visible horizon even if the reference is above it', () => {
    const astronomy = astronomyCandidate();
    const subjectSky = astronomy.subjectObservation.skyPosition;
    const referenceSky = astronomy.referenceObservation.skyPosition;
    if (subjectSky && referenceSky) {
      subjectSky.elevationDeg = -0.5;
      subjectSky.precisionDeg = 0.25;
      referenceSky.elevationDeg = 0.5;
      referenceSky.precisionDeg = 0.1;
    }
    const evaluation = evaluateContextualExplanationCandidate(astronomy);
    expect(evaluation.edge).toBeNull();
    expect(evaluation.receipt.failedChecks).toContain('subject_elevation_visible');
    expect(evaluation.receipt.failedChecks).not.toContain('reference_elevation_visible');
  });

  it('uses conservative uncertainty bounds with inclusive, explicit policy boundaries', () => {
    const exact = satelliteCandidate();
    const subjectWindow = exact.subjectObservation.window;
    const referenceWindow = exact.referenceObservation.window;
    if (subjectWindow && referenceWindow) {
      subjectWindow.precisionSeconds = 60;
      referenceWindow.start = '2026-01-01T00:00:50.000Z';
      referenceWindow.end = '2026-01-01T00:00:50.000Z';
      referenceWindow.precisionSeconds = 10;
    }
    const coverage = exact.domainEvidence.find((item) => item.code === 'track_coverage_fraction');
    const epochAge = exact.domainEvidence.find((item) => item.code === 'orbit_epoch_age_hours');
    if (coverage) {
      coverage.value = 0.85;
      coverage.precision = 0.05;
    }
    if (epochAge) {
      epochAge.value = 72;
      epochAge.precision = 0;
    }
    const accepted = evaluateContextualExplanationCandidate(exact);
    expect(accepted.edge).not.toBeNull();
    expect(accepted.receipt.checks.find((item) => item.code === 'temporal_gap_upper')).toMatchObject({
      actual: 120,
      threshold: 120,
      status: 'pass',
    });
    expect(accepted.receipt.checks.find((item) => item.code === 'domain_track_coverage_fraction_lower')).toMatchObject({
      actual: 0.8,
      threshold: 0.8,
      status: 'pass',
    });

    const timeOutside = clone(exact);
    const outsideWindow = timeOutside.referenceObservation.window;
    if (outsideWindow) {
      outsideWindow.start = '2026-01-01T00:00:50.001Z';
      outsideWindow.end = '2026-01-01T00:00:50.001Z';
    }
    expect(evaluateContextualExplanationCandidate(timeOutside).receipt.failedChecks).toContain('temporal_gap_upper');

    const coverageOutside = clone(exact);
    const outsideCoverage = coverageOutside.domainEvidence.find((item) => item.code === 'track_coverage_fraction');
    if (outsideCoverage) outsideCoverage.value = 0.849;
    expect(evaluateContextualExplanationCandidate(coverageOutside).receipt.failedChecks)
      .toContain('domain_track_coverage_fraction_lower');

    const epochOutside = clone(exact);
    const outsideEpoch = epochOutside.domainEvidence.find((item) => item.code === 'orbit_epoch_age_hours');
    if (outsideEpoch) outsideEpoch.value = 72.001;
    expect(evaluateContextualExplanationCandidate(epochOutside).receipt.failedChecks)
      .toContain('domain_orbit_epoch_age_hours_upper');
  });

  it('fails closed on coarse precision, high qualitative uncertainty, or absent required evidence', () => {
    const coarse = aircraftCandidate();
    const subjectWindow = coarse.subjectObservation.window;
    if (subjectWindow) subjectWindow.precisionSeconds = 60.001;
    expect(evaluateContextualExplanationCandidate(coarse).receipt.failedChecks).toContain('subject_time_precision');

    const uncertain = aircraftCandidate();
    uncertain.uncertainty = { level: 'high', reasons: ['unresolved_clock_and_direction'] };
    expect(evaluateContextualExplanationCandidate(uncertain).receipt.failedChecks).toContain('declared_uncertainty_rank');

    const falselyExact = aircraftCandidate();
    falselyExact.uncertainty = { level: 'none', reasons: [] };
    expect(evaluateContextualExplanationCandidate(falselyExact).receipt.failedChecks)
      .toContain('declared_uncertainty_consistent');

    const missingSky = aircraftCandidate();
    missingSky.subjectObservation.skyPosition = null;
    missingSky.missingness.push({
      field: 'subject.sky_position',
      status: 'not_recorded',
      reason: 'source_omitted_direction',
    });
    expect(evaluateContextualExplanationCandidate(missingSky).receipt.failedChecks)
      .toEqual(expect.arrayContaining(['angular_match_available', 'subject_sky_position_available']));

    const missingCoverage = satelliteCandidate();
    missingCoverage.domainEvidence = missingCoverage.domainEvidence
      .filter((item) => item.code !== 'track_coverage_fraction');
    missingCoverage.missingness.push({
      field: 'domain_evidence.track_coverage_fraction',
      status: 'unavailable',
      reason: 'track_archive_gap',
    });
    expect(evaluateContextualExplanationCandidate(missingCoverage).receipt.failedChecks)
      .toContain('domain_track_coverage_fraction_available');
  });

  it('requires explicit, non-contradictory missingness for absent observations and evidence', () => {
    const undeclared = aircraftCandidate();
    undeclared.subjectObservation.skyPosition = null;
    expect(() => evaluateContextualExplanationCandidate(undeclared))
      .toThrow('contextual_explanation_missingness_required');

    const contradictory = weatherCandidate();
    contradictory.missingness.push({
      field: 'subject.location',
      status: 'unknown',
      reason: 'incorrectly_marked_missing',
    });
    expect(() => evaluateContextualExplanationCandidate(contradictory))
      .toThrow('contextual_explanation_missingness_contradiction');
  });

  it('requires inspectable provenance and binds every supplied metric to known context sources', () => {
    const unknownSource = aircraftCandidate();
    unknownSource.domainEvidence[0].sourceRefs = ['unregistered-track'];
    expect(() => evaluateContextualExplanationCandidate(unknownSource))
      .toThrow('contextual_explanation_evidence_source_unknown');

    const subjectOnly = aircraftCandidate();
    subjectOnly.domainEvidence[0].sourceRefs = ['subject-report'];
    expect(() => evaluateContextualExplanationCandidate(subjectOnly))
      .toThrow('contextual_explanation_evidence_context_source_required');

    const modelWithoutReceipt = weatherCandidate();
    const phenomenon = modelWithoutReceipt.domainEvidence.find((item) => item.code === 'phenomenon_match_score');
    if (phenomenon) phenomenon.method = 'model_output';
    expect(() => evaluateContextualExplanationCandidate(modelWithoutReceipt))
      .toThrow('contextual_explanation_model_provenance_required');

    const withModelReceipt = weatherCandidate();
    withModelReceipt.provenance.push(provenance('weather-matcher', 'correlation_method', 'governed-model-registry'));
    const governedPhenomenon = withModelReceipt.domainEvidence.find((item) => item.code === 'phenomenon_match_score');
    if (governedPhenomenon) {
      governedPhenomenon.method = 'model_output';
      governedPhenomenon.sourceRefs = ['weather-observation', 'weather-matcher'];
    }
    withModelReceipt.model.method = 'governed_model';
    const edge = buildContextualExplanationEdge(withModelReceipt);
    expect(edge).not.toBeNull();
    expect(edge?.matchingEvidence.find((item) => item.code === 'phenomenon_match_score')?.provenanceIds).toHaveLength(2);

    const mislabeledModelOutput = weatherCandidate();
    mislabeledModelOutput.provenance.push(provenance('weather-matcher', 'correlation_method', 'governed-model-registry'));
    const mislabeledPhenomenon = mislabeledModelOutput.domainEvidence
      .find((item) => item.code === 'phenomenon_match_score');
    if (mislabeledPhenomenon) {
      mislabeledPhenomenon.method = 'model_output';
      mislabeledPhenomenon.sourceRefs = ['weather-observation', 'weather-matcher'];
    }
    expect(() => evaluateContextualExplanationCandidate(mislabeledModelOutput))
      .toThrow('contextual_explanation_model_method_mismatch');

    const unreceiptedGovernedModel = weatherCandidate();
    unreceiptedGovernedModel.model.method = 'governed_model';
    expect(() => evaluateContextualExplanationCandidate(unreceiptedGovernedModel))
      .toThrow('contextual_explanation_model_method_mismatch');
  });

  it('deep-freezes every policy threshold so the published policy hash cannot drift at runtime', () => {
    const threshold = CONTEXTUAL_EXPLANATION_POLICY.thresholds.satellite.domain.orbit_epoch_age_hours;
    expect(Object.isFrozen(CONTEXTUAL_EXPLANATION_POLICY)).toBe(true);
    expect(Object.isFrozen(CONTEXTUAL_EXPLANATION_POLICY.thresholds.satellite)).toBe(true);
    expect(Object.isFrozen(CONTEXTUAL_EXPLANATION_POLICY.thresholds.satellite.domain)).toBe(true);
    expect(Object.isFrozen(threshold)).toBe(true);
    expect(() => {
      (threshold as { threshold: number }).threshold = 9_999;
    }).toThrow();
    expect(CONTEXTUAL_EXPLANATION_POLICY.thresholds.satellite.domain.orbit_epoch_age_hours?.threshold).toBe(72);
  });

  it('rejects malformed geometry, windows, physical evidence bounds, and duplicate evidence', () => {
    const badLatitude = aircraftCandidate();
    (badLatitude.subjectObservation.location as NonNullable<typeof badLatitude.subjectObservation.location>).lat = 90.001;
    expect(() => evaluateContextualExplanationCandidate(badLatitude))
      .toThrow('contextual_explanation_location_invalid');

    const reversedWindow = aircraftCandidate();
    const window = reversedWindow.subjectObservation.window;
    if (window) window.end = '2025-12-31T23:59:59.999Z';
    expect(() => evaluateContextualExplanationCandidate(reversedWindow))
      .toThrow('contextual_explanation_window_order_invalid');

    const impossibleFraction = aircraftCandidate();
    impossibleFraction.domainEvidence[0].value = 0.99;
    impossibleFraction.domainEvidence[0].precision = 0.02;
    expect(() => evaluateContextualExplanationCandidate(impossibleFraction))
      .toThrow('contextual_explanation_evidence_bounds_invalid');

    const duplicate = satelliteCandidate();
    duplicate.domainEvidence.push(clone(duplicate.domainEvidence[0]));
    expect(() => evaluateContextualExplanationCandidate(duplicate))
      .toThrow('contextual_explanation_duplicate_evidence_code');
  });

  it('detects any tampering or non-canonical extension during strict decoding', () => {
    const edge = buildContextualExplanationEdge(aircraftCandidate());
    expect(edge).not.toBeNull();

    const idTamper = clone(edge as ContextualExplanationEdge);
    idTamper.edgeId = `context-edge:${'b'.repeat(64)}`;
    expect(() => decodeContextualExplanationEdge(idTamper)).toThrow('contextual_explanation_edge_noncanonical');

    const evidenceTamper = clone(edge as ContextualExplanationEdge);
    evidenceTamper.matchingEvidence[0].upperBound += 1;
    expect(() => decodeContextualExplanationEdge(evidenceTamper)).toThrow('contextual_explanation_edge_noncanonical');

    const claimTamper = clone(edge as ContextualExplanationEdge) as ContextualExplanationEdge & { hiddenVerdict?: string };
    claimTamper.hiddenVerdict = 'explained';
    expect(() => decodeContextualExplanationEdge(claimTamper)).toThrow('contextual_explanation_edge_noncanonical');
  });

  it('rejects non-JSON values rather than silently changing deterministic digests', () => {
    expect(() => canonicalizeContextualExplanation({ value: Number.NaN }))
      .toThrow('contextual_explanation_canonical_non_finite');
    expect(() => canonicalizeContextualExplanation({ value: undefined }))
      .toThrow('contextual_explanation_canonical_undefined');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeContextualExplanation(cyclic))
      .toThrow('contextual_explanation_canonical_cycle');
  });
});
