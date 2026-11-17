import { describe, expect, it } from 'vitest';

import type { CaseGraphConditionalArchiveStorage } from '../../src/caseGraph/archiveTypes';

import {
  CONTEXTUAL_EXPLANATION_POLICY,
  CONTEXTUAL_EXPLANATION_POLICY_SHA256,
  CONTEXTUAL_EXPLANATION_POLICY_VERSION,
  CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
  contextualExplanationSha256,
  evaluateContextualExplanationCandidate,
  type ContextualExplanationCandidateDraft,
  type ContextualProvenanceDraft,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
  GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import { CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION } from '../../src/caseGraph/contextualObservationArchive';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY,
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES,
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  buildContextualRelationshipCalibrationArtifact,
  buildContextualRelationshipCalibrationAuditPlan,
  buildContextualRelationshipCalibrationLineage,
  buildContextualRelationshipCalibrationReviewReceipt,
  buildContextualRelationshipCalibrationTrustPolicy,
  contextualRelationshipCalibrationReviewSetSha256,
  decodeContextualRelationshipCalibrationArtifact,
  decodeContextualRelationshipCalibrationReceipt,
  getContextualRelationshipCalibrationSampleId,
  serializeContextualRelationshipCalibrationArtifact,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationArtifact,
  type ContextualRelationshipCalibrationLabelDraft,
  type ContextualRelationshipCalibrationLineage,
  type ContextualRelationshipCalibrationTrustPolicy,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  buildContextualRelationshipCalibrationArchiveObject,
  decodeContextualRelationshipCalibrationArchiveObject,
  readContextualRelationshipCalibrationArchive,
  writeContextualRelationshipCalibrationArchive,
} from '../../src/caseGraph/contextualRelationshipCalibrationArchive';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import type { RelationshipInputUniverseBinding } from '../../src/caseGraph/relationshipInputSnapshot';

const sha = (value: unknown) => contextualExplanationSha256(value);
const clone = <T>(value: T): T => structuredClone(value);
const KINDS = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;

const binding: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000777',
  corpusVersion: 'contextual-calibration-fixture-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'c'.repeat(64),
  universeRecordCount: 801,
};

const providerByKind = {
  aircraft: 'adsb-history',
  satellite: 'space-track',
  astronomy: 'jpl-horizons',
  weather: 'met-office',
} as const;
const familyByKind = {
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
} as const;

const provenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
  providerId: string,
  index: number,
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId,
  sourceRecordId: `${sourceRef}-record-${index}`,
  datasetVersion: 'context-calibration-source-v1',
  retrievedAt: '2026-07-18T00:00:00.000Z',
  contentSha256: sha(`${sourceRef}:${index}`),
  sourceUri: `https://example.test/${sourceRef}/${index}`,
});

const model = (kind: typeof KINDS[number], index: number) => ({
  modelId: 'deterministic-context-matcher',
  modelVersion: '1.0.0',
  method: 'deterministic' as const,
  inputSha256: sha(`model-input:${kind}:${index}`),
  outputSha256: sha(`model-output:${kind}:${index}`),
});

const candidate = (
  kind: typeof KINDS[number],
  index: number,
  predictedPositive: boolean,
): ContextualExplanationCandidateDraft => {
  const subjectAddress = `sighting:context-calibration-${kind}-${String(index).padStart(4, '0')}`;
  const subjectWindow = {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T00:00:20.000Z',
    precisionSeconds: predictedPositive ? 10 : 10_000,
  };
  const common = {
    kind,
    subjectAddress,
    subjectObservation: {
      window: subjectWindow,
      location: { lat: 51.5, lon: -0.1, precisionKm: 1 },
      skyPosition: kind === 'weather' ? null : { azimuthDeg: 100, elevationDeg: 30, precisionDeg: 1 },
    },
    provenance: [
      provenance(`subject-${kind}`, 'subject_observation', 'uapfiles', index),
      provenance(`reference-${kind}`, 'context_reference', providerByKind[kind], index),
    ],
    missingness: kind === 'weather' ? [
      { field: 'subject.sky_position', status: 'not_recorded' as const, reason: 'source_omitted_direction' },
      { field: 'reference.sky_position', status: 'not_applicable' as const, reason: 'area_weather_observation' },
    ] : [],
    uncertainty: { level: 'low' as const, reasons: ['bounded_fixture'] },
    model: model(kind, index),
  };
  if (kind === 'aircraft') return {
    ...common,
    kind,
    reference: { referenceId: `adsb:flight-${index}`, label: `Flight ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:30.000Z', end: '2026-01-01T00:00:40.000Z', precisionSeconds: 5 },
      location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
      skyPosition: { azimuthDeg: 102, elevationDeg: 30, precisionDeg: 0.25 },
    },
    domainEvidence: [{
      code: 'track_coverage_fraction', value: 0.9, precision: 0.05, method: 'catalogue',
      methodVersion: 'adsb-track-coverage-v1', sourceRefs: ['reference-aircraft'],
    }],
  };
  if (kind === 'satellite') return {
    ...common,
    kind,
    reference: { referenceId: `norad:${20_000 + index}`, label: `Satellite ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:30.000Z', end: '2026-01-01T00:00:30.000Z', precisionSeconds: 2 },
      location: null,
      skyPosition: { azimuthDeg: 101, elevationDeg: 30, precisionDeg: 0.1 },
    },
    missingness: [{ field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution' }],
    domainEvidence: [
      { code: 'track_coverage_fraction', value: 0.9, precision: 0.05, method: 'catalogue', methodVersion: 'sgp4-coverage-v1', sourceRefs: ['reference-satellite'] },
      { code: 'orbit_epoch_age_hours', value: 24, precision: 1, method: 'catalogue', methodVersion: 'tle-age-v1', sourceRefs: ['reference-satellite'] },
    ],
  };
  if (kind === 'astronomy') return {
    ...common,
    kind,
    reference: { referenceId: `iau:object-${index}`, label: `Ephemeris object ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:10.000Z', end: '2026-01-01T00:00:10.000Z', precisionSeconds: 1 },
      location: null,
      skyPosition: { azimuthDeg: 101, elevationDeg: 30, precisionDeg: 0.05 },
    },
    missingness: [{ field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution' }],
    domainEvidence: [{
      code: 'ephemeris_accuracy_deg', value: 0.1, precision: 0.05, method: 'catalogue',
      methodVersion: 'ephemeris-solution-v1', sourceRefs: ['reference-astronomy'],
    }],
  };
  return {
    ...common,
    kind: 'weather',
    reference: { referenceId: `met:station-${index}`, label: `Weather station ${index}` },
    referenceObservation: {
      window: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z', precisionSeconds: 120 },
      location: { lat: 51.6, lon: -0.2, precisionKm: 5 },
      skyPosition: null,
    },
    domainEvidence: [
      { code: 'observation_coverage_fraction', value: 0.8, precision: 0.1, method: 'measured', methodVersion: 'weather-window-v1', sourceRefs: ['reference-weather'] },
      { code: 'phenomenon_match_score', value: 0.9, precision: 0.05, method: 'deterministic_rule', methodVersion: 'weather-trait-match-v1', sourceRefs: ['reference-weather'] },
    ],
  };
};

type Fixture = {
  artifact: ContextualRelationshipCalibrationArtifact;
  labels: ContextualRelationshipCalibrationLabelDraft[];
  lineage: ContextualRelationshipCalibrationLineage;
  trustPolicy: ContextualRelationshipCalibrationTrustPolicy;
};
let cached: Fixture | null = null;

class MemoryStorage implements CaseGraphConditionalArchiveStorage {
  readonly objects = new Map<string, Buffer>();
  throwAfterWrite = false;
  async readObject(key: string) { return this.objects.get(key) || null; }
  async readObjectVersioned(key: string) {
    const body = this.objects.get(key);
    return body ? { body, version: sha(body.toString('base64')) } : null;
  }
  async uploadFile(body: Buffer, key: string) { this.objects.set(key, Buffer.from(body)); return key; }
  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[2],
    condition: Parameters<CaseGraphConditionalArchiveStorage['uploadFileConditional']>[3],
  ) {
    if (!('ifAbsent' in condition) || this.objects.has(key)) return { status: 'precondition_failed' as const };
    this.objects.set(key, Buffer.from(body));
    if (this.throwAfterWrite) {
      this.throwAfterWrite = false;
      throw new Error('fixture_lost_ack');
    }
    return { status: 'written' as const, key, version: sha(body.toString('base64')) };
  }
}

const buildFixture = (): Fixture => {
  if (cached) return cached;
  const sourceDigest = Object.fromEntries(KINDS.map((kind) => [kind, sha(`source-snapshot:${kind}`)])) as Record<typeof KINDS[number], string>;
  const drafts: Array<Omit<ContextualRelationshipCalibrationLabelDraft, 'review'>> = [];
  for (const kind of KINDS) {
    for (let index = 0; index < 200; index += 1) {
      const predictedPositive = index < 100;
      const input = candidate(kind, index, predictedPositive);
      drafts.push({
        candidate: input,
        evaluation: evaluateContextualExplanationCandidate(input),
        sourceSnapshotDigest: sourceDigest[kind],
        observationArchiveRecordDigest: sha(`archive-record:${kind}:${index}`),
        truthLabel: predictedPositive ? 'positive' : 'negative',
        hardNegativeCategory: predictedPositive ? null
          : CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES[index % CONTEXTUAL_RELATIONSHIP_CALIBRATION_HARD_NEGATIVES.length],
      });
    }
  }
  const insufficientCandidate = candidate('weather', 999, false);
  insufficientCandidate.subjectObservation.location = null;
  insufficientCandidate.missingness.push({
    field: 'subject.location',
    status: 'not_recorded',
    reason: 'fixture_location_omitted',
  });
  drafts.push({
    candidate: insufficientCandidate,
    evaluation: evaluateContextualExplanationCandidate(insufficientCandidate),
    sourceSnapshotDigest: sourceDigest.weather,
    observationArchiveRecordDigest: sha('archive-record:weather:insufficient'),
    truthLabel: 'insufficient',
    hardNegativeCategory: null,
  });
  const labels = drafts.map((draft): ContextualRelationshipCalibrationLabelDraft => {
    const sampleId = getContextualRelationshipCalibrationSampleId(draft);
    const evaluationDigest = sha(draft.evaluation);
    return {
      ...draft,
      review: buildContextualRelationshipCalibrationReviewReceipt({
        sampleId,
        evaluationDigest,
        truthLabel: draft.truthLabel,
        hardNegativeCategory: draft.hardNegativeCategory,
        reviewerCohortId: 'context-reviewers-v1',
        adjudicationPolicyVersion: 'context-adjudication-v1',
        reviewerIds: ['context-reviewer-alpha', 'context-reviewer-beta'],
        sourceArchiveKey: `context/reviews/${sampleId.slice('context-calibration-sample:'.length)}`,
        sourceArchiveVersion: 'immutable-v1',
        sourceObjectSha256: sha({ sampleId, truthLabel: draft.truthLabel }),
      }),
    };
  });
  const modelIdentity = {
    modelId: 'deterministic-context-matcher',
    modelVersion: '1.0.0',
    method: 'deterministic' as const,
  };
  const lineage = buildContextualRelationshipCalibrationLineage({
    binding,
    observationArchiveVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    sourceArchives: KINDS.map((kind) => ({
      kind,
      sourceFamily: familyByKind[kind],
      sourceId: `context-source-${kind}`,
      providerId: providerByKind[kind],
      datasetVersion: 'context-calibration-source-v1',
      sourceSnapshotDigest: sourceDigest[kind],
      completionManifestDigest: sha(`completion:${kind}`),
      archiveSetSha256: sha(`archive-set:${kind}`),
      sourcePageSetSha256: sha(`source-page-set:${kind}`),
      rowCount: kind === 'weather' ? 201 : 200,
      emittedEdgeCount: 100,
      insufficientEvidenceCount: kind === 'weather' ? 101 : 100,
    })),
    contextualPolicy: {
      schemaVersion: CONTEXTUAL_EXPLANATION_SCHEMA_VERSION,
      policyVersion: CONTEXTUAL_EXPLANATION_POLICY_VERSION,
      policySha256: CONTEXTUAL_EXPLANATION_POLICY_SHA256,
      thresholds: CONTEXTUAL_EXPLANATION_POLICY,
    },
    adapter: {
      adapterVersion: CONTEXTUAL_RELATIONSHIP_ADAPTER_VERSION,
      governedPayloadSchemaVersion: GOVERNED_CONTEXTUAL_OBSERVATION_VERSION,
    },
    models: [{ ...modelIdentity, modelIdentitySha256: sha(modelIdentity) }],
  });
  const auditPlan = buildContextualRelationshipCalibrationAuditPlan({
    lockedHoldout: labels.map((label) => ({
      sampleId: label.review.sampleId,
      sourceGroupId: `source-group:${label.candidate.kind}`,
    })),
    tuningSet: [{
      sampleId: `context-calibration-sample:${sha('disjoint-context-tuning')}`,
      sourceGroupId: 'source-group:disjoint-tuning',
    }],
    labelPolicyVersion: 'context-label-policy-v1',
    groupingPolicyVersion: 'context-source-group-policy-v1',
  });
  const trustPolicy = buildContextualRelationshipCalibrationTrustPolicy({
    lineageDigest: lineage.lineageDigest,
    auditPlanDigest: auditPlan.planDigest,
    reviewReceiptSetSha256: contextualRelationshipCalibrationReviewSetSha256(labels.map((label) => label.review)),
    reviewerCohortId: 'context-reviewers-v1',
    adjudicationPolicyVersion: 'context-adjudication-v1',
    minimumIndependentReviewers: 2,
    evidenceClass: 'synthetic_contract_fixture',
    authorizationScope: 'test_only_never_publish',
  });
  const artifact = buildContextualRelationshipCalibrationArtifact({ lineage, auditPlan, trustPolicy, labels });
  cached = { artifact, labels, lineage, trustPolicy };
  return cached;
};

describe('contextual relationship calibration', () => {
  it('measures kinds, source, precision, coverage, and hard-negative slices without authorizing synthetic labels', () => {
    const { artifact } = buildFixture();
    expect(artifact.labelCount).toBe(801);
    expect(artifact.gatePolicy).toEqual(CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY);
    expect(artifact.gateChecks.every((gate) => gate.status === 'pass')).toBe(true);
    expect(artifact.sliceMetrics.map((slice) => slice.sliceId)).toEqual(expect.arrayContaining([
      'overall', 'hard_negative', 'kind:aircraft', 'kind:satellite', 'kind:astronomy', 'kind:weather',
      'precision:bounded_precise', 'precision:coarse_or_missing',
      'coverage:complete_context', 'coverage:incomplete_context',
    ]));
    expect(artifact.receipt).toMatchObject({
      decision: 'contract_gates_passed_test_only',
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
      calibratedEdgeType: 'contextual_explanation_candidate',
    });
    expect(() => assertContextualRelationshipCalibrationReceiptProductionEligible(artifact.receipt))
      .toThrow('contextual_calibration_receipt_not_production_eligible');
  }, 30_000);

  it('round-trips artifact and receipt canonically and rejects metric, policy, lineage, and unknown-field tampering', () => {
    const { artifact, trustPolicy } = buildFixture();
    const encoded = serializeContextualRelationshipCalibrationArtifact(artifact, trustPolicy);
    expect(decodeContextualRelationshipCalibrationArtifact(encoded, binding, trustPolicy)).toEqual(artifact);
    const receiptEncoded = serializeContextualRelationshipCalibrationReceipt(artifact.receipt);
    expect(decodeContextualRelationshipCalibrationReceipt(receiptEncoded)).toEqual(artifact.receipt);

    const metricTamper = clone(artifact);
    metricTamper.sliceMetrics[0].metrics.confusion.falsePositive += 1;
    expect(() => decodeContextualRelationshipCalibrationArtifact(metricTamper, binding, trustPolicy))
      .toThrow('contextual_calibration_noncanonical');
    const policyTamper = clone(artifact);
    policyTamper.lineage.contextualPolicy.policySha256 = 'f'.repeat(64);
    expect(() => decodeContextualRelationshipCalibrationArtifact(policyTamper, binding, trustPolicy))
      .toThrow('contextual_calibration_policy_invalid');
    const unknown = clone(artifact) as unknown as Record<string, unknown>;
    unknown.unreviewed = true;
    expect(() => decodeContextualRelationshipCalibrationArtifact(unknown, binding, trustPolicy))
      .toThrow('contextual_calibration_artifact_invalid');
  }, 30_000);

  it('rejects fully rehashed replacement reviews, labels, plans, and trust policies against the original commitment', () => {
    const { artifact, labels, lineage, trustPolicy } = buildFixture();
    const replaced = clone(labels);
    const first = replaced[0];
    first.review = buildContextualRelationshipCalibrationReviewReceipt({
      sampleId: first.review.sampleId,
      evaluationDigest: first.review.evaluationDigest,
      truthLabel: first.truthLabel,
      hardNegativeCategory: first.hardNegativeCategory,
      reviewerCohortId: first.review.reviewerCohortId,
      adjudicationPolicyVersion: first.review.adjudicationPolicyVersion,
      reviewerIds: first.review.reviewerIds,
      sourceArchiveKey: 'context/reviews/replaced',
      sourceArchiveVersion: first.review.sourceArchiveVersion,
      sourceObjectSha256: sha('replaced-review-body'),
    });
    const replacementTrust = buildContextualRelationshipCalibrationTrustPolicy({
      lineageDigest: lineage.lineageDigest,
      auditPlanDigest: artifact.auditPlan.planDigest,
      reviewReceiptSetSha256: contextualRelationshipCalibrationReviewSetSha256(replaced.map((label) => label.review)),
      reviewerCohortId: trustPolicy.reviewerCohortId,
      adjudicationPolicyVersion: trustPolicy.adjudicationPolicyVersion,
      minimumIndependentReviewers: trustPolicy.minimumIndependentReviewers,
      evidenceClass: trustPolicy.evidenceClass,
      authorizationScope: trustPolicy.authorizationScope,
    });
    const forged = buildContextualRelationshipCalibrationArtifact({
      lineage, auditPlan: artifact.auditPlan, trustPolicy: replacementTrust, labels: replaced,
    });
    expect(() => decodeContextualRelationshipCalibrationArtifact(forged, binding, trustPolicy))
      .toThrow('contextual_calibration_trust_mismatch');

    expect(() => buildContextualRelationshipCalibrationTrustPolicy({
      lineageDigest: lineage.lineageDigest,
      auditPlanDigest: artifact.auditPlan.planDigest,
      reviewReceiptSetSha256: trustPolicy.reviewReceiptSetSha256,
      reviewerCohortId: trustPolicy.reviewerCohortId,
      adjudicationPolicyVersion: trustPolicy.adjudicationPolicyVersion,
      minimumIndependentReviewers: 2,
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'production_candidate',
    })).toThrow('contextual_calibration_trust_authorization_invalid');
  }, 30_000);

  it('fails on duplicate samples, mixed source lineage, missing adjudication slices, and unmet hard-negative gates', () => {
    const { artifact, labels, lineage, trustPolicy } = buildFixture();
    expect(() => buildContextualRelationshipCalibrationArtifact({
      lineage, auditPlan: artifact.auditPlan, trustPolicy, labels: [...labels, labels[0]],
    })).toThrow('contextual_calibration_duplicate_sample');

    const mixed = clone(labels);
    mixed[0].sourceSnapshotDigest = lineage.sourceArchives.find((source) => source.kind === 'weather')?.sourceSnapshotDigest
      || '0'.repeat(64);
    expect(() => buildContextualRelationshipCalibrationArtifact({
      lineage, auditPlan: artifact.auditPlan, trustPolicy, labels: mixed,
    })).toThrow('contextual_calibration_candidate_source_mismatch');

    expect(() => buildContextualRelationshipCalibrationArtifact({
      lineage,
      auditPlan: artifact.auditPlan,
      trustPolicy,
      labels: labels.filter((label) => label.hardNegativeCategory === null),
    })).toThrow(/contextual_calibration_(holdout_membership_mismatch|gate_failed)/);
  }, 30_000);

  it('writes and reads an immutable content-addressed contextual calibration archive and rejects byte conflicts', async () => {
    const { artifact, trustPolicy } = buildFixture();
    const object = buildContextualRelationshipCalibrationArchiveObject(artifact, trustPolicy);
    expect(decodeContextualRelationshipCalibrationArchiveObject({
      archiveBody: object.archiveBody,
      receiptInput: object.receiptBody,
      expectedBinding: binding,
      expectedTrustPolicy: trustPolicy,
    }).artifact).toEqual(artifact);
    const storage = new MemoryStorage();
    storage.throwAfterWrite = true;
    const first = await writeContextualRelationshipCalibrationArchive({
      storage, artifact, expectedTrustPolicy: trustPolicy,
    });
    expect(first.archiveStatus).toBe('reused');
    expect(first.receiptStatus).toBe('written');
    const second = await writeContextualRelationshipCalibrationArchive({
      storage, artifact, expectedTrustPolicy: trustPolicy,
    });
    expect(second.archiveStatus).toBe('reused');
    expect((await readContextualRelationshipCalibrationArchive({
      storage,
      receiptKey: first.receiptKey,
      expectedBinding: binding,
      expectedTrustPolicy: trustPolicy,
    })).artifact).toEqual(artifact);
    const tampered = Buffer.from(object.archiveBody);
    tampered[0] ^= 0xff;
    expect(() => decodeContextualRelationshipCalibrationArchiveObject({
      archiveBody: tampered,
      receiptInput: object.receipt,
      expectedBinding: binding,
      expectedTrustPolicy: trustPolicy,
    })).toThrow('contextual_calibration_archive_compressed_mismatch');
    storage.objects.set(object.receipt.archiveKey, Buffer.from('divergent'));
    await expect(writeContextualRelationshipCalibrationArchive({
      storage, artifact, expectedTrustPolicy: trustPolicy,
    })).rejects.toThrow('contextual_calibration_archive_immutable_conflict');
  }, 60_000);
});
