import { describe, expect, it } from 'vitest';

import {
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  type ContextualDomainEvidenceDraft,
  type ContextualExplanationKind,
  type ContextualMissingStatus,
  type ContextualObservation,
  type ContextualProvenanceDraft,
  contextualExplanationSha256,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE,
  GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
  type GovernedContextualObservationCore,
  type GovernedContextualObservationPayload,
  type GovernedContextualObservationPayloadDraft,
  adaptContextualRelationship,
  buildGovernedContextualObservationPayload,
  buildGovernedContextualObservationPayloadForRecord,
  decodeGovernedContextualObservationPayload,
  governedContextualInputSha256,
  prepareGovernedContextualObservation,
  verifyContextualRelationshipAdapterResult,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import {
  type RelationshipInputContextValue,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputRecordDraft,
  type RelationshipInputUniverseBinding,
  buildRelationshipInputRecord,
  projectRelationshipInputOrigin,
  relationshipInputOriginId,
  relationshipInputSha256,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';

const clone = <T>(value: T): T => structuredClone(value);
const sha = (value: string) => relationshipInputSha256(value);

const binding = (overrides: Partial<RelationshipInputUniverseBinding> = {}): RelationshipInputUniverseBinding => ({
  snapshotId: '00000000-0000-4000-8000-000000000099',
  corpusVersion: 'case-vortex-2026-07-18',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 466_935,
  ...overrides,
});

const address = 'sighting:00000000-0000-4000-8000-000000000001';

const structuredOrigin = (sourceField: string): RelationshipInputOriginDraft => ({
  sourceAddress: address,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'governed-context-extraction-v1' },
});

const sourceProvenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
  providerId: string,
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId,
  sourceRecordId: `${sourceRef}-record`,
  datasetVersion: 'governed-context-2026-07-18',
  retrievedAt: '2026-07-18T00:00:00.000Z',
  contentSha256: contextualExplanationSha256(`${sourceRef}-content`),
  sourceUri: `https://example.test/${sourceRef}`,
});

const model = () => ({
  modelId: 'deterministic-context-adapter',
  modelVersion: '1.0.0',
  method: 'deterministic' as const,
  inputSha256: contextualExplanationSha256('adapter-model-input'),
  outputSha256: contextualExplanationSha256('adapter-model-output'),
});

const observations = (kind: ContextualExplanationKind): {
  subjectObservation: ContextualObservation;
  referenceObservation: ContextualObservation;
  domainEvidence: ContextualDomainEvidenceDraft[];
  missingness: Array<{ field: string; status: ContextualMissingStatus; reason: string }>;
} => {
  const subjectWindow = {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T00:00:20.000Z',
    precisionSeconds: 5,
  };
  const referenceWindow = {
    start: '2026-01-01T00:00:30.000Z',
    end: '2026-01-01T00:00:40.000Z',
    precisionSeconds: 2,
  };
  const subjectLocation = { lat: 51.5, lon: -0.1, precisionKm: 1 };
  const subjectSky = { azimuthDeg: 100, elevationDeg: 30, precisionDeg: 1 };
  const referenceSky = { azimuthDeg: 102, elevationDeg: 30, precisionDeg: 0.1 };
  if (kind === 'aircraft') {
    return {
      subjectObservation: { window: subjectWindow, location: subjectLocation, skyPosition: subjectSky },
      referenceObservation: {
        window: referenceWindow,
        location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
        skyPosition: referenceSky,
      },
      domainEvidence: [{
        code: 'track_coverage_fraction', value: 0.9, precision: 0.05,
        method: 'catalogue', methodVersion: 'adsb-track-v1', sourceRefs: ['context-source'],
      }],
      missingness: [],
    };
  }
  if (kind === 'satellite') {
    return {
      subjectObservation: { window: subjectWindow, location: subjectLocation, skyPosition: subjectSky },
      referenceObservation: { window: referenceWindow, location: null, skyPosition: referenceSky },
      domainEvidence: [
        {
          code: 'track_coverage_fraction', value: 0.9, precision: 0.05,
          method: 'catalogue', methodVersion: 'sgp4-track-v1', sourceRefs: ['context-source'],
        },
        {
          code: 'orbit_epoch_age_hours', value: 24, precision: 1,
          method: 'catalogue', methodVersion: 'tle-age-v1', sourceRefs: ['context-source'],
        },
      ],
      missingness: [{
        field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution',
      }],
    };
  }
  if (kind === 'astronomy') {
    return {
      subjectObservation: { window: subjectWindow, location: subjectLocation, skyPosition: subjectSky },
      referenceObservation: { window: referenceWindow, location: null, skyPosition: referenceSky },
      domainEvidence: [{
        code: 'ephemeris_accuracy_deg', value: 0.1, precision: 0.05,
        method: 'catalogue', methodVersion: 'ephemeris-v1', sourceRefs: ['context-source'],
      }],
      missingness: [{
        field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution',
      }],
    };
  }
  return {
    subjectObservation: {
      window: { ...subjectWindow, precisionSeconds: 60 },
      location: { ...subjectLocation, precisionKm: 3 },
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
    domainEvidence: [
      {
        code: 'observation_coverage_fraction', value: 0.8, precision: 0.1,
        method: 'measured', methodVersion: 'weather-window-v1', sourceRefs: ['context-source'],
      },
      {
        code: 'phenomenon_match_score', value: 0.9, precision: 0.05,
        method: 'deterministic_rule', methodVersion: 'weather-match-v1', sourceRefs: ['context-source'],
      },
    ],
    missingness: [
      { field: 'reference.sky_position', status: 'not_applicable', reason: 'area_weather_observation' },
      { field: 'subject.sky_position', status: 'not_recorded', reason: 'source_omitted_direction' },
    ],
  };
};

const explanationType = (kind: ContextualExplanationKind): RelationshipInputContextValue['explanationType'] => ({
  aircraft: 'aircraft',
  satellite: 'satellite',
  astronomy: 'astronomical',
  weather: 'meteorological',
}[kind] as RelationshipInputContextValue['explanationType']);

const referenceId = (kind: ContextualExplanationKind) => ({
  aircraft: 'adsb:flight-101',
  satellite: 'norad:25544',
  astronomy: 'iau:venus',
  weather: 'met:station-123',
}[kind]);

const recordDraft = (
  kind: ContextualExplanationKind,
  metrics: Record<string, string | number | boolean | null>,
  status: RelationshipInputContextValue['matchStatus'] = 'candidate',
  type: RelationshipInputContextValue['explanationType'] = explanationType(kind),
  originOrder: 'normal' | 'reverse' = 'normal',
  predicate: string = CONTEXTUAL_RELATIONSHIP_FACT_PREDICATE,
): RelationshipInputRecordDraft => {
  const origins = [structuredOrigin('event.observation'), structuredOrigin(`context.${kind}`)];
  if (originOrder === 'reverse') origins.reverse();
  const fact: RelationshipInputFactDraft = {
    family: 'contextual_explanation',
    predicate,
    value: {
      kind: 'contextual_explanation',
      explanationType: type,
      referenceId: referenceId(kind),
      matchStatus: status,
      interpretation: 'candidate_explanation_not_causal_attribution',
      metrics,
    },
    confidence: 0.82,
    uncertainty: { level: 'low', reasons: ['bounded_observation_precision'] },
    precision: { kind: 'bounded', unit: 'seconds', lower: 0, upper: 60 },
    missingness: { status: 'present', reasons: [] },
    origins,
  };
  return {
    binding: binding(),
    address,
    source: {
      sourceId: 'uapfiles',
      sourceRecordId: 'case-001',
      registryVersion: 'case-graph-sources-v2',
      lineageId: 'uapfiles-lineage',
      dependencyRisk: 'low',
    },
    facts: [fact],
    recordMissingness: [],
    duplicateLineage: null,
    crossReferences: [],
    sourceAssertions: [],
    narrativeVector: {
      status: 'missing',
      modelId: 'narrative-model',
      modelVersion: '1.0.0',
      dimensions: 1,
      normalization: 'none',
      inputSha256: null,
      vectorSha256: null,
      reason: 'no_narrative',
    },
    governedReferences: [],
  };
};

const receiptMetrics = (contextInputSha256: string) => ({
  adapter_version: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  governed_payload_schema_version: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
  context_input_sha256: contextInputSha256,
  context_policy_version: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  context_policy_sha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  model_input_sha256: model().inputSha256,
  model_output_sha256: model().outputSha256,
});

type FixtureOptions = {
  status?: RelationshipInputContextValue['matchStatus'];
  explanationType?: RelationshipInputContextValue['explanationType'];
  mutateCore?: (core: GovernedContextualObservationCore) => void;
  metricContextInputOverride?: string;
  reverseInputOrder?: boolean;
  predicate?: string;
  metricOverrides?: Record<string, string | number | boolean | null>;
};

const contextualFact = (record: RelationshipInputRecord) => {
  const fact = record.facts.find((item) => item.family === 'contextual_explanation');
  if (!fact || fact.family !== 'contextual_explanation') throw new Error('fixture_context_fact_missing');
  return fact;
};

const fixture = (kind: ContextualExplanationKind, options: FixtureOptions = {}) => {
  const metricsFor = (contextInputSha256: string) => ({
    ...receiptMetrics(contextInputSha256),
    ...options.metricOverrides,
  });
  const preliminary = buildRelationshipInputRecord(recordDraft(
    kind,
    metricsFor('0'.repeat(64)),
    options.status,
    options.explanationType,
    options.reverseInputOrder ? 'reverse' : 'normal',
    options.predicate,
  ));
  const preliminaryFact = contextualFact(preliminary);
  const subjectOrigin = preliminaryFact.origins.find((origin) => origin.sourceField === 'event.observation');
  const contextOrigin = preliminaryFact.origins.find((origin) => origin.sourceField === `context.${kind}`);
  if (!subjectOrigin || !contextOrigin) throw new Error('fixture_origin_missing');
  const family = observations(kind);
  const core: GovernedContextualObservationCore = {
    kind,
    binding: binding(),
    address,
    originBindings: [
      { originId: subjectOrigin.originId, sourceRef: 'subject-source' },
      { originId: contextOrigin.originId, sourceRef: 'context-source' },
    ],
    reference: { referenceId: referenceId(kind), label: `${kind} governed reference` },
    subjectObservation: family.subjectObservation,
    referenceObservation: family.referenceObservation,
    provenance: [
      sourceProvenance('subject-source', 'subject_observation', 'uapfiles'),
      sourceProvenance('context-source', 'context_reference', `${kind}-registry`),
    ],
    domainEvidence: family.domainEvidence,
    missingness: family.missingness,
    model: model(),
  };
  options.mutateCore?.(core);
  if (options.reverseInputOrder) {
    core.originBindings.reverse();
    core.provenance.reverse();
    core.domainEvidence.reverse();
    core.domainEvidence.forEach((item) => item.sourceRefs.reverse());
    core.missingness.reverse();
  }
  const contextInputSha256 = governedContextualInputSha256(core);
  const record = buildRelationshipInputRecord(recordDraft(
    kind,
    metricsFor(options.metricContextInputOverride || contextInputSha256),
    options.status,
    options.explanationType,
    options.reverseInputOrder ? 'reverse' : 'normal',
    options.predicate,
  ));
  const fact = contextualFact(record);
  const finalOriginIds = fact.origins.map((origin) => origin.originId).sort();
  const preliminaryOriginIds = preliminaryFact.origins.map((origin) => origin.originId).sort();
  if (JSON.stringify(finalOriginIds) !== JSON.stringify(preliminaryOriginIds)) throw new Error('fixture_origin_drift');
  const payload = buildGovernedContextualObservationPayload({ ...core, factId: fact.factId });
  return { record, payload, core, fact };
};

const payloadDraft = (payload: GovernedContextualObservationPayload): GovernedContextualObservationPayloadDraft => {
  const {
    recordType: _recordType,
    schemaVersion: _schemaVersion,
    canonicalVersion: _canonicalVersion,
    contextInputSha256: _contextInputSha256,
    payloadDigest: _payloadDigest,
    ...draft
  } = payload;
  return draft;
};

describe('contextual relationship adapter', () => {
  it('projects origin IDs once and completes the coordinator flow without a placeholder record', () => {
    const subjectOrigin = structuredOrigin('event.observation');
    const contextOrigin = structuredOrigin('context.aircraft');
    const family = observations('aircraft');
    const prepared = prepareGovernedContextualObservation({
      kind: 'aircraft',
      binding: binding(),
      address,
      originDraftBindings: [
        { origin: subjectOrigin, sourceRef: 'subject-source' },
        { origin: contextOrigin, sourceRef: 'context-source' },
      ],
      reference: { referenceId: referenceId('aircraft'), label: 'aircraft governed reference' },
      subjectObservation: family.subjectObservation,
      referenceObservation: family.referenceObservation,
      provenance: [
        sourceProvenance('subject-source', 'subject_observation', 'uapfiles'),
        sourceProvenance('context-source', 'context_reference', 'aircraft-registry'),
      ],
      domainEvidence: family.domainEvidence,
      missingness: family.missingness,
      model: model(),
    });
    const draft = recordDraft('aircraft', prepared.factReceiptMetrics);
    draft.facts[0].origins = prepared.factOrigins;
    const record = buildRelationshipInputRecord(draft);
    const payload = buildGovernedContextualObservationPayloadForRecord(record, prepared.core, binding());
    const result = adaptContextualRelationship(record, payload, binding());

    expect(prepared.contextInputSha256).toBe(governedContextualInputSha256(prepared.core));
    expect(prepared.factOrigins.map(relationshipInputOriginId)).toEqual([
      relationshipInputOriginId(subjectOrigin),
      relationshipInputOriginId(contextOrigin),
    ].sort());
    expect(projectRelationshipInputOrigin(subjectOrigin).originId).toBe(relationshipInputOriginId(subjectOrigin));
    expect(payload.factId).toBe(result.sourceFact.factId);
    expect(result.evaluation.edge?.edgeType).toBe('context_aircraft_candidate');

    const forged = { ...projectRelationshipInputOrigin(subjectOrigin), originId: `origin:${'f'.repeat(64)}` };
    expect(() => projectRelationshipInputOrigin(forged)).toThrow('relationship_input_origin_id_mismatch');
  });

  it('converts receipt-backed aircraft, satellite, astronomy, and weather facts into distinct deterministic edges', () => {
    const expectedEdgeTypes = {
      aircraft: 'context_aircraft_candidate',
      satellite: 'context_satellite_candidate',
      astronomy: 'context_astronomy_candidate',
      weather: 'context_weather_candidate',
    } as const;
    for (const kind of ['aircraft', 'satellite', 'astronomy', 'weather'] as const) {
      const { record, payload, fact } = fixture(kind);
      const result = adaptContextualRelationship(record, payload, binding());
      expect(result.evaluation.edge?.edgeType).toBe(expectedEdgeTypes[kind]);
      expect(result.binding).toEqual(binding());
      expect(result.address).toBe(address);
      expect(result.sourceRecordDigest).toBe(record.recordDigest);
      expect(result.governedPayloadDigest).toBe(payload.payloadDigest);
      expect(result.sourceFact).toMatchObject({
        factId: fact.factId,
        uncertainty: fact.uncertainty,
        precision: fact.precision,
        missingness: fact.missingness,
      });
      expect(result.adapterReceiptSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.evaluation.receipt.claimDiscipline).toMatchObject({
        causality: 'not_assessed', debunking: 'not_assessed', origin: 'not_assessed',
      });
    }
  });

  it('is invariant to origin, provenance, evidence, source-ref, and missingness permutations', () => {
    const normal = fixture('satellite');
    const permuted = fixture('satellite', { reverseInputOrder: true });

    expect(permuted.record).toEqual(normal.record);
    expect(permuted.payload).toEqual(normal.payload);
    expect(adaptContextualRelationship(permuted.record, permuted.payload, binding()))
      .toEqual(adaptContextualRelationship(normal.record, normal.payload, binding()));
    expect(decodeGovernedContextualObservationPayload(JSON.stringify(normal.payload))).toEqual(normal.payload);
  });

  it('rejects a mixed universe snapshot before contextual evaluation', () => {
    const current = fixture('aircraft');
    const otherBinding = binding({ snapshotId: '00000000-0000-4000-8000-000000000088' });
    const mixedDraft = payloadDraft(current.payload);
    mixedDraft.binding = otherBinding;
    const mixedPayload = buildGovernedContextualObservationPayload(mixedDraft);

    expect(() => adaptContextualRelationship(current.record, mixedPayload, binding()))
      .toThrow('relationship_input_snapshot_binding_mismatch');
  });

  it('rejects record or governed-payload tampering and a fact receipt that does not bind the payload input', () => {
    const current = fixture('aircraft');
    const recordTamper = clone(current.record);
    recordTamper.recordDigest = 'b'.repeat(64);
    expect(() => adaptContextualRelationship(recordTamper, current.payload, binding()))
      .toThrow('relationship_input_record_digest_mismatch');

    const payloadTamper = clone(current.payload);
    const referenceWindow = payloadTamper.referenceObservation.window;
    if (referenceWindow) referenceWindow.start = '2026-01-01T00:00:31.000Z';
    expect(() => adaptContextualRelationship(current.record, payloadTamper, binding()))
      .toThrow(/contextual_adapter_(context_input|payload)_digest_mismatch/);

    const wrongReceipt = fixture('aircraft', { metricContextInputOverride: 'f'.repeat(64) });
    expect(() => adaptContextualRelationship(wrongReceipt.record, wrongReceipt.payload, binding()))
      .toThrow('contextual_adapter_context_input_receipt_mismatch');
  });

  it('rejects policy/model drift, causal predicates, and ungoverned receipt fields', () => {
    const policyDrift = fixture('aircraft', {
      metricOverrides: { context_policy_version: 'context-policy-drifted' },
    });
    expect(() => adaptContextualRelationship(policyDrift.record, policyDrift.payload, binding()))
      .toThrow('contextual_adapter_policy_receipt_mismatch');

    const modelDrift = fixture('satellite', {
      metricOverrides: { model_input_sha256: 'd'.repeat(64) },
    });
    expect(() => adaptContextualRelationship(modelDrift.record, modelDrift.payload, binding()))
      .toThrow('contextual_adapter_model_receipt_mismatch');

    const causalPredicate = fixture('aircraft', { predicate: 'aircraft_caused_sighting' });
    expect(() => adaptContextualRelationship(causalPredicate.record, causalPredicate.payload, binding()))
      .toThrow('contextual_adapter_fact_predicate_invalid');

    const causalMetric = fixture('aircraft', { metricOverrides: { causal_verdict: 'aircraft' } });
    expect(() => adaptContextualRelationship(causalMetric.record, causalMetric.payload, binding()))
      .toThrow('contextual_adapter_receipt_metrics_invalid');
  });

  it('requires exact address and exact fact-origin-to-provenance bindings', () => {
    const current = fixture('aircraft');
    const otherAddressDraft = payloadDraft(current.payload);
    otherAddressDraft.address = 'sighting:00000000-0000-4000-8000-000000000002';
    const otherAddressPayload = buildGovernedContextualObservationPayload(otherAddressDraft);
    expect(() => adaptContextualRelationship(current.record, otherAddressPayload, binding()))
      .toThrow('contextual_adapter_address_mismatch');

    const wrongOrigin = fixture('aircraft', {
      mutateCore: (core) => {
        core.originBindings[0].originId = `origin:${'c'.repeat(64)}`;
      },
    });
    expect(() => adaptContextualRelationship(wrongOrigin.record, wrongOrigin.payload, binding()))
      .toThrow('contextual_adapter_origin_set_mismatch');

    const unbound = fixture('aircraft', {
      mutateCore: (core) => {
        core.provenance.push(sourceProvenance('extra-source', 'correlation_method', 'method-registry'));
      },
    });
    expect(() => adaptContextualRelationship(unbound.record, unbound.payload, binding()))
      .toThrow('contextual_adapter_unbound_provenance');

    const ambiguous = fixture('aircraft', {
      mutateCore: (core) => {
        core.originBindings.push({
          originId: core.originBindings[1].originId,
          sourceRef: core.originBindings[0].sourceRef,
        });
      },
    });
    expect(() => adaptContextualRelationship(ambiguous.record, ambiguous.payload, binding()))
      .toThrow('contextual_adapter_origin_source_ambiguous');
  });

  it('preserves explicit missingness but emits no edge when required satellite evidence is unavailable', () => {
    const missing = fixture('satellite', {
      mutateCore: (core) => {
        core.domainEvidence = core.domainEvidence.filter((item) => item.code !== 'track_coverage_fraction');
        core.missingness.push({
          field: 'domain_evidence.track_coverage_fraction',
          status: 'unavailable',
          reason: 'historical_track_gap',
        });
      },
    });
    const result = adaptContextualRelationship(missing.record, missing.payload, binding());
    expect(result.evaluation.edge).toBeNull();
    expect(result.evaluation.receipt.failedChecks).toContain('domain_track_coverage_fraction_available');
    expect(result.evaluation.receipt.missingness).toContainEqual({
      field: 'domain_evidence.track_coverage_fraction',
      status: 'unavailable',
      reason: 'historical_track_gap',
    });

    expect(() => fixture('satellite', {
      mutateCore: (core) => {
        core.domainEvidence = core.domainEvidence.filter((item) => item.code !== 'track_coverage_fraction');
      },
      })).toThrow('contextual_explanation_missingness_required');
  });

  it('fails closed on coarse time/geo precision and on explicitly missing observation windows', () => {
    const coarseTime = fixture('aircraft', {
      mutateCore: (core) => {
        if (core.subjectObservation.window) core.subjectObservation.window.precisionSeconds = 60.001;
      },
    });
    const timeResult = adaptContextualRelationship(coarseTime.record, coarseTime.payload, binding());
    expect(timeResult.evaluation.edge).toBeNull();
    expect(timeResult.evaluation.receipt.failedChecks).toContain('subject_time_precision');

    const coarseGeo = fixture('weather', {
      mutateCore: (core) => {
        if (core.referenceObservation.location) core.referenceObservation.location.precisionKm = 25.001;
      },
    });
    const geoResult = adaptContextualRelationship(coarseGeo.record, coarseGeo.payload, binding());
    expect(geoResult.evaluation.edge).toBeNull();
    expect(geoResult.evaluation.receipt.failedChecks).toContain('reference_location_precision');

    const missingWindow = fixture('satellite', {
      mutateCore: (core) => {
        core.subjectObservation.window = null;
        core.missingness.push({
          field: 'subject.window',
          status: 'not_recorded',
          reason: 'source_omitted_time',
        });
      },
    });
    const missingResult = adaptContextualRelationship(missingWindow.record, missingWindow.payload, binding());
    expect(missingResult.evaluation.edge).toBeNull();
    expect(missingResult.evaluation.receipt.failedChecks)
      .toEqual(expect.arrayContaining(['subject_window_available', 'temporal_match_available']));
    expect(missingResult.evaluation.receipt.missingness).toContainEqual({
      field: 'subject.window',
      status: 'not_recorded',
      reason: 'source_omitted_time',
    });
  });

  it('never turns ruled-out or unknown source facts into candidate or causal edges', () => {
    for (const status of ['ruled_out', 'unknown'] as const) {
      const source = fixture('astronomy', { status });
      expect(() => adaptContextualRelationship(source.record, source.payload, binding()))
        .toThrow('contextual_adapter_fact_not_candidate');
    }
  });

  it('keeps every family explicitly non-causal, non-debunking, and origin-neutral', () => {
    const forbiddenVerdict = /\b(?:caused by|explained by|debunked|identified as|ordinary origin|extraordinary origin)\b/i;
    for (const kind of ['aircraft', 'satellite', 'astronomy', 'weather'] as const) {
      const current = fixture(kind);
      const result = adaptContextualRelationship(current.record, current.payload, binding());
      const plainEnglish = result.evaluation.edge?.explanation.plainEnglish || '';
      expect(plainEnglish).toContain('candidate contextual correlation only');
      expect(plainEnglish).toContain('not a causal attribution');
      expect(plainEnglish).toContain('debunking conclusion');
      expect(plainEnglish).not.toMatch(forbiddenVerdict);
      expect(result.claimDiscipline.output).toMatchObject({
        causality: 'not_assessed',
        debunking: 'not_assessed',
        origin: 'not_assessed',
        extraordinaryOrigin: 'not_assessed',
      });
    }
  });

  it('rejects unsupported contextual families instead of relabeling them', () => {
    const unsupported = fixture('aircraft', { explanationType: 'balloon' });
    expect(() => adaptContextualRelationship(unsupported.record, unsupported.payload, binding()))
      .toThrow('contextual_adapter_explanation_type_unsupported');
  });

  it('rejects a missing/unknown precision receipt instead of creating an edge', () => {
    const base = fixture('weather');
    const draft = recordDraft('weather', receiptMetrics(base.payload.contextInputSha256));
    const factDraft = draft.facts[0];
    factDraft.precision = { kind: 'unknown' };
    const record = buildRelationshipInputRecord(draft);
    const fact = contextualFact(record);
    const rebuiltPayload = buildGovernedContextualObservationPayload({
      ...payloadDraft(base.payload),
      factId: fact.factId,
    });
    expect(() => adaptContextualRelationship(record, rebuiltPayload, binding()))
      .toThrow('contextual_adapter_fact_precision_unknown');
  });

  it('does not accept an unreceipted extra field in the governed payload', () => {
    const current = fixture('weather');
    const extended = clone(current.payload) as GovernedContextualObservationPayload & { verdict?: string };
    extended.verdict = 'explained';
    expect(() => decodeGovernedContextualObservationPayload(extended))
      .toThrow('contextual_adapter_payload_invalid');
  });

  it('binds the adapter digest to the evaluated edge and source fact receipt', () => {
    const current = fixture('weather');
    const result = adaptContextualRelationship(current.record, current.payload, binding());
    const { adapterReceiptSha256, ...withoutDigest } = result;
    expect(adapterReceiptSha256).toBe(contextualExplanationSha256(withoutDigest));
    expect(result.sourceFact.originIds).toEqual(current.fact.origins.map((origin) => origin.originId).sort());
    expect(result.claimDiscipline.output.notice).toContain('not a causal attribution');
    expect(sha(result.sourceRecordDigest)).not.toBe(result.adapterReceiptSha256);
  });

  it('strictly verifies a stored result and rejects recomputed tampering or schema extensions', () => {
    const current = fixture('weather');
    const result = adaptContextualRelationship(current.record, current.payload, binding());
    expect(verifyContextualRelationshipAdapterResult(
      JSON.stringify(result), current.record, current.payload, binding(),
    )).toEqual(result);

    const tampered = clone(result);
    if (tampered.evaluation.edge) {
      tampered.evaluation.edge.explanation.plainEnglish = 'The weather caused and explained this sighting.';
    }
    const { adapterReceiptSha256: _oldDigest, ...tamperedWithoutDigest } = tampered;
    tampered.adapterReceiptSha256 = contextualExplanationSha256(tamperedWithoutDigest);
    expect(() => verifyContextualRelationshipAdapterResult(
      tampered, current.record, current.payload, binding(),
    )).toThrow('contextual_adapter_result_mismatch');

    const extended = clone(result) as typeof result & { causalVerdict?: string };
    extended.causalVerdict = 'weather';
    expect(() => verifyContextualRelationshipAdapterResult(
      extended, current.record, current.payload, binding(),
    )).toThrow('contextual_adapter_result_mismatch');
  });
});
