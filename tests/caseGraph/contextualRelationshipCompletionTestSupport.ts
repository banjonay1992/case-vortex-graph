import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  contextualExplanationSha256,
  type ContextualExplanationKind,
  type ContextualMissingStatus,
  type ContextualObservation,
  type ContextualProvenanceDraft,
  type ContextualDomainEvidenceDraft,
} from '../../src/caseGraph/contextualExplanation';
import {
  type GovernedContextualObservationCoreDraft,
  buildGovernedContextualObservationPayloadForRecord,
  prepareGovernedContextualObservation,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import {
  CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
  buildContextualObservationArchivePart,
  buildContextualObservationArchiveRecord,
  buildEmptyContextualObservationArchiveCompletionManifest,
  buildGovernedContextualSourceRow,
  buildGovernedContextualSourceSnapshot,
  decodeContextualObservationArchiveCompletionManifest,
  type ContextualObservationArchiveCompletionManifest,
  type ContextualObservationArchivePartSummary,
  type ContextualObservationArchiveRecord,
  type GovernedContextualSourceRow,
  type GovernedContextualSourceSnapshot,
} from '../../src/caseGraph/contextualObservationArchive';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION,
  contextualRelationshipCalibrationReceiptSha256,
  getContextualRelationshipCalibrationReceiptId,
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  buildContextualRelationshipCompletionArtifact,
  buildContextualRelationshipSourceCompletionReceipt,
  type ContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionEntryInput,
  type ContextualRelationshipSourceCompletionReceipt,
} from '../../src/caseGraph/contextualRelationshipCompletion';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  buildRelationshipInputRecord,
  type RelationshipInputContextValue,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';

const KINDS = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;
const sha = (value: unknown) => contextualExplanationSha256(value);

export const CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000888',
  corpusVersion: 'contextual-completion-contract-fixture-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: '8'.repeat(64),
  universeRecordCount: 2,
};

const calibrationReceipt = (): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = sha('contextual-completion-synthetic-calibration-core');
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_RECEIPT_SCHEMA_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: 'contract_gates_passed_test_only',
    calibrationCoreSha256,
    lineageSha256: sha('contextual-completion-synthetic-lineage'),
    auditPlanSha256: sha('contextual-completion-synthetic-audit-plan'),
    trustPolicyDigest: sha('contextual-completion-synthetic-trust-policy'),
    evaluationSetSha256: sha('contextual-completion-synthetic-evaluations'),
    labelSetSha256: sha('contextual-completion-synthetic-labels'),
    metricsSha256: sha('contextual-completion-synthetic-metrics'),
    gatePolicyVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
    gatePolicySha256: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    evidenceClass: 'synthetic_contract_fixture',
    authorizationScope: 'test_only_never_publish',
    calibratedEdgeType: 'contextual_explanation_candidate',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  return {
    ...withoutSha,
    receiptSha256: contextualRelationshipCalibrationReceiptSha256(withoutSha),
  };
};

export const buildSyntheticContextualCompletionCalibrationReceipt = calibrationReceipt;

export const expectedSyntheticContextualCompletionCalibration = () => {
  const receipt = calibrationReceipt();
  return { receiptId: receipt.receiptId, receiptSha256: receipt.receiptSha256 };
};

const sourceFamily = (kind: ContextualExplanationKind) => ({
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
} as const)[kind];

const snapshotFor = (kind: ContextualExplanationKind) => buildGovernedContextualSourceSnapshot({
  binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
  kind,
  sourceFamily: sourceFamily(kind),
  sourceId: `completion-source-${kind}`,
  providerId: `completion-provider-${kind}`,
  datasetVersion: `completion-dataset-${kind}-v1`,
  coverageWindow: {
    start: '2025-12-31T23:00:00.000Z',
    end: '2026-01-01T02:00:00.000Z',
  },
  materializedAt: '2026-01-02T00:00:00.000Z',
  contentSha256: sha(`contextual-completion-source-content:${kind}`),
});

const origin = (sourceAddress: string, sourceField: string): RelationshipInputOriginDraft => ({
  sourceAddress,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'contextual-completion-contract-fixture-v1' },
});

const provenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
  providerId: string,
  datasetVersion: string,
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId,
  sourceRecordId: `${sourceRef}-completion-record`,
  datasetVersion,
  retrievedAt: '2026-01-02T00:00:00.000Z',
  contentSha256: sha(`contextual-completion-provenance:${sourceRef}`),
  sourceUri: `https://example.test/contextual-completion/${sourceRef}`,
});

const aircraftObservation = (missingSubjectWindow: boolean): {
  subjectObservation: ContextualObservation;
  referenceObservation: ContextualObservation;
  domainEvidence: ContextualDomainEvidenceDraft[];
  missingness: Array<{ field: string; status: ContextualMissingStatus; reason: string }>;
} => ({
  subjectObservation: {
    window: missingSubjectWindow ? null : {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:20.000Z',
      precisionSeconds: 5,
    },
    location: { lat: 51.5, lon: -0.1, precisionKm: 1 },
    skyPosition: { azimuthDeg: 100, elevationDeg: 30, precisionDeg: 1 },
  },
  referenceObservation: {
    window: {
      start: '2026-01-01T00:00:30.000Z',
      end: '2026-01-01T00:00:40.000Z',
      precisionSeconds: 2,
    },
    location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
    skyPosition: { azimuthDeg: 102, elevationDeg: 30, precisionDeg: 0.1 },
  },
  domainEvidence: [{
    code: 'track_coverage_fraction',
    value: 0.9,
    precision: 0.05,
    method: 'catalogue',
    methodVersion: 'completion-adsb-history-v1',
    sourceRefs: ['context-source'],
  }],
  missingness: missingSubjectWindow ? [{
    field: 'subject.window',
    status: 'not_recorded',
    reason: 'fixture_source_omitted_time',
  }] : [],
});

const observationFixture = (
  snapshot: GovernedContextualSourceSnapshot,
  ordinal: number,
  missingSubjectWindow: boolean,
): {
  record: RelationshipInputRecord;
  row: GovernedContextualSourceRow;
  archiveRecord: ContextualObservationArchiveRecord;
} => {
  const address = `sighting:00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
  const observation = aircraftObservation(missingSubjectWindow);
  const referenceId = `adsb:completion-flight-${ordinal}`;
  const coreDraft: GovernedContextualObservationCoreDraft = {
    kind: 'aircraft',
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    address,
    originDraftBindings: [
      { origin: origin(address, 'event.observation'), sourceRef: 'subject-source' },
      { origin: origin(address, 'context.aircraft'), sourceRef: 'context-source' },
    ],
    reference: { referenceId, label: `Completion flight ${ordinal}` },
    subjectObservation: observation.subjectObservation,
    referenceObservation: observation.referenceObservation,
    provenance: [
      provenance('subject-source', 'subject_observation', 'uapfiles', 'uapfiles-fixture-v1'),
      provenance('context-source', 'context_reference', snapshot.providerId, snapshot.datasetVersion),
    ],
    domainEvidence: observation.domainEvidence,
    missingness: observation.missingness,
    model: {
      modelId: 'deterministic-context-completion-fixture',
      modelVersion: '1.0.0',
      method: 'deterministic',
      inputSha256: sha(`contextual-completion-model-input:${ordinal}`),
      outputSha256: sha(`contextual-completion-model-output:${ordinal}`),
    },
  };
  const prepared = prepareGovernedContextualObservation(coreDraft);
  const fact: RelationshipInputFactDraft = {
    family: 'contextual_explanation',
    predicate: 'contextual_explanation_candidate',
    value: {
      kind: 'contextual_explanation',
      explanationType: 'aircraft' as RelationshipInputContextValue['explanationType'],
      referenceId,
      matchStatus: 'candidate',
      interpretation: 'candidate_explanation_not_causal_attribution',
      metrics: prepared.factReceiptMetrics,
    },
    confidence: 0.82,
    uncertainty: { level: 'low', reasons: ['bounded_observation_precision'] },
    precision: { kind: 'bounded', unit: 'seconds', lower: 0, upper: 60 },
    missingness: { status: 'present', reasons: [] },
    origins: prepared.factOrigins,
  };
  const record = buildRelationshipInputRecord({
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    address,
    source: {
      sourceId: 'uapfiles',
      sourceRecordId: `completion-case-${ordinal}`,
      registryVersion: 'case-graph-sources-v2',
      lineageId: 'uapfiles-completion-lineage',
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
  });
  const payload = buildGovernedContextualObservationPayloadForRecord(
    record,
    prepared.core,
    CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
  );
  const row = buildGovernedContextualSourceRow({ snapshot, relationshipRecord: record, payload });
  return { record, row, archiveRecord: buildContextualObservationArchiveRecord({ snapshot, sourceRow: row }) };
};

export const buildCanonicalContextualSourceRowFixture = () => {
  const snapshot = snapshotFor('aircraft');
  const observation = observationFixture(snapshot, 1, false);
  return { snapshot, ...observation };
};

const nonemptyCompletionManifest = (
  snapshot: GovernedContextualSourceSnapshot,
  records: ContextualObservationArchiveRecord[],
): ContextualObservationArchiveCompletionManifest => {
  const pageDigest = sha(records.map((record) => record.recordDigest));
  const sourcePage = {
    pageNumber: 0,
    cursor: null,
    nextCursor: null,
    rowCount: records.length,
    pageDigest,
  };
  const part = buildContextualObservationArchivePart({
    snapshot,
    partNumber: 0,
    sourcePage,
    records,
  });
  const {
    recordType: _recordType,
    schemaVersion: _schemaVersion,
    canonicalVersion: _canonicalVersion,
    binding: _binding,
    sourceSnapshotDigest: _sourceSnapshotDigest,
    archiveContentType: _archiveContentType,
    archiveContentEncoding: _archiveContentEncoding,
    ...summary
  } = part.manifest;
  const parts: ContextualObservationArchivePartSummary[] = [summary];
  const withoutDigest: Omit<ContextualObservationArchiveCompletionManifest, 'manifestDigest'> = {
    recordType: 'contextual_observation_archive_completion_manifest',
    schemaVersion: CONTEXTUAL_OBSERVATION_ARCHIVE_VERSION,
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    sourcePageCount: 1,
    sourcePageSetSha256: sha(`0:null:null:${records.length}:${pageDigest}`),
    partCount: 1,
    rowCount: records.length,
    emittedEdgeCount: records.filter((record) => Boolean(record.result.evaluation.edge)).length,
    insufficientEvidenceCount: records.filter((record) => !record.result.evaluation.edge).length,
    parts,
    archiveSetSha256: sha(`0:0:${pageDigest}:${summary.compressedSha256}:${summary.recordSetSha256}`),
    completedAt: '2026-01-03T00:00:00.000Z',
  };
  return decodeContextualObservationArchiveCompletionManifest({
    ...withoutDigest,
    manifestDigest: sha(withoutDigest),
  }, snapshot);
};

const sourceReceipts = (params?: {
  aircraftRecords?: ContextualObservationArchiveRecord[];
}) => KINDS.map((kind): ContextualRelationshipSourceCompletionReceipt => {
  const snapshot = snapshotFor(kind);
  const records = kind === 'aircraft' ? params?.aircraftRecords || [] : [];
  const completionManifest = records.length
    ? nonemptyCompletionManifest(snapshot, records)
    : buildEmptyContextualObservationArchiveCompletionManifest({
      snapshot,
      completedAt: '2026-01-03T00:00:00.000Z',
    });
  return buildContextualRelationshipSourceCompletionReceipt({ snapshot, completionManifest });
});

export type ContextualRelationshipCompletionFixture = {
  binding: RelationshipInputUniverseBinding;
  calibrationReceipt: ContextualRelationshipCalibrationReceipt;
  expectedCalibration: { receiptId: string; receiptSha256: string };
  sources: ContextualRelationshipSourceCompletionReceipt[];
  entryInputs: ContextualRelationshipCompletionEntryInput[];
  artifact: ContextualRelationshipCompletionArtifact;
};

export const buildCanonicalContextualCompletionZeroFixture = (): ContextualRelationshipCompletionFixture => {
  const receipt = calibrationReceipt();
  const sources = sourceReceipts();
  const entryInputs: ContextualRelationshipCompletionEntryInput[] = [];
  const artifact = buildContextualRelationshipCompletionArtifact({
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    calibrationReceipt: receipt,
    sources,
    entries: entryInputs,
  });
  return {
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    calibrationReceipt: receipt,
    expectedCalibration: { receiptId: receipt.receiptId, receiptSha256: receipt.receiptSha256 },
    sources,
    entryInputs,
    artifact,
  };
};

export const buildCanonicalContextualCompletionMixedFixture = (): ContextualRelationshipCompletionFixture => {
  const aircraftSnapshot = snapshotFor('aircraft');
  const accepted = observationFixture(aircraftSnapshot, 1, false);
  const insufficient = observationFixture(aircraftSnapshot, 2, true);
  const records = [accepted.archiveRecord, insufficient.archiveRecord];
  const sources = sourceReceipts({ aircraftRecords: records });
  const canonicalAircraftSnapshot = sources.find((source) => source.snapshot.kind === 'aircraft')?.snapshot
    || (() => { throw new Error('contextual_completion_test_aircraft_source_missing'); })();
  if (canonicalAircraftSnapshot.snapshotDigest !== aircraftSnapshot.snapshotDigest) {
    throw new Error('contextual_completion_test_snapshot_mismatch');
  }
  const receipt = calibrationReceipt();
  const entryInputs: ContextualRelationshipCompletionEntryInput[] = [
    {
      sourceSnapshotDigest: aircraftSnapshot.snapshotDigest,
      archiveRecord: accepted.archiveRecord,
      relationshipRecord: accepted.record,
    },
    {
      sourceSnapshotDigest: aircraftSnapshot.snapshotDigest,
      archiveRecord: insufficient.archiveRecord,
      relationshipRecord: insufficient.record,
    },
  ];
  const artifact = buildContextualRelationshipCompletionArtifact({
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    calibrationReceipt: receipt,
    sources,
    entries: entryInputs,
  });
  return {
    binding: CONTEXTUAL_RELATIONSHIP_COMPLETION_TEST_BINDING,
    calibrationReceipt: receipt,
    expectedCalibration: { receiptId: receipt.receiptId, receiptSha256: receipt.receiptSha256 },
    sources,
    entryInputs,
    artifact,
  };
};
