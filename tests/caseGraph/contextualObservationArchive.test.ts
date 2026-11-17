import { describe, expect, it } from 'vitest';

import type {
  CaseGraphArchiveWriteCondition,
  CaseGraphConditionalArchiveStorage,
  CaseGraphConditionalWriteResult,
} from '../../src/caseGraph/archiveTypes';
import {
  type ContextualDomainEvidenceDraft,
  type ContextualExplanationKind,
  type ContextualMissingStatus,
  type ContextualObservation,
  type ContextualProvenanceDraft,
  contextualExplanationSha256,
} from '../../src/caseGraph/contextualExplanation';
import {
  type GovernedContextualObservationCoreDraft,
  buildGovernedContextualObservationPayloadForRecord,
  prepareGovernedContextualObservation,
} from '../../src/caseGraph/contextualRelationshipAdapter';
import {
  archiveGovernedContextualObservations,
  buildContextualObservationArchiveRecord,
  buildGovernedContextualSourcePage,
  buildGovernedContextualSourceRow,
  buildGovernedContextualSourceSnapshot,
  decodeContextualObservationArchiveRecord,
  decodeGovernedContextualSourcePage,
  decodeGovernedContextualSourceSnapshot,
  getContextualObservationArchiveControlKeys,
  readVerifiedContextualObservationArchive,
  type GovernedContextualObservationSource,
  type GovernedContextualSourcePage,
  type GovernedContextualSourceRow,
  type GovernedContextualSourceSnapshot,
} from '../../src/caseGraph/contextualObservationArchive';
import { buildContextualSourceGovernanceDecisionPacket } from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  type RelationshipInputContextValue,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
  buildRelationshipInputRecord,
} from '../../src/caseGraph/relationshipInputSnapshot';

const clone = <T>(value: T): T => structuredClone(value);
const sha = (value: string) => contextualExplanationSha256(value);

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

const address = (ordinal: number) => `sighting:00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;

const origin = (sourceAddress: string, sourceField: string): RelationshipInputOriginDraft => ({
  sourceAddress,
  sourceField,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'contextual-archive-fixture-v1' },
});

const provenance = (
  sourceRef: string,
  role: ContextualProvenanceDraft['role'],
  providerId: string,
  datasetVersion: string,
  retrievedAt = '2026-01-02T00:00:00.000Z',
): ContextualProvenanceDraft => ({
  sourceRef,
  role,
  providerId,
  sourceRecordId: `${sourceRef}-record`,
  datasetVersion,
  retrievedAt,
  contentSha256: sha(`${sourceRef}-content`),
  sourceUri: `https://example.test/${sourceRef}`,
});

const model = () => ({
  modelId: 'deterministic-context-archive',
  modelVersion: '2.0.0',
  method: 'deterministic' as const,
  inputSha256: sha('context-archive-model-input'),
  outputSha256: sha('context-archive-model-output'),
});

const familyObservation = (kind: ContextualExplanationKind): {
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
  if (kind === 'aircraft') return {
    subjectObservation: { window: subjectWindow, location: subjectLocation, skyPosition: subjectSky },
    referenceObservation: {
      window: referenceWindow,
      location: { lat: 51.51, lon: -0.09, precisionKm: 0.5 },
      skyPosition: referenceSky,
    },
    domainEvidence: [{
      code: 'track_coverage_fraction', value: 0.9, precision: 0.05,
      method: 'catalogue', methodVersion: 'adsb-history-v1', sourceRefs: ['context-source'],
    }],
    missingness: [],
  };
  if (kind === 'satellite') return {
    subjectObservation: { window: subjectWindow, location: subjectLocation, skyPosition: subjectSky },
    referenceObservation: { window: referenceWindow, location: null, skyPosition: referenceSky },
    domainEvidence: [
      {
        code: 'track_coverage_fraction', value: 0.9, precision: 0.05,
        method: 'catalogue', methodVersion: 'sgp4-history-v1', sourceRefs: ['context-source'],
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
  if (kind === 'astronomy') return {
    subjectObservation: { window: subjectWindow, location: subjectLocation, skyPosition: subjectSky },
    referenceObservation: { window: referenceWindow, location: null, skyPosition: referenceSky },
    domainEvidence: [{
      code: 'ephemeris_accuracy_deg', value: 0.1, precision: 0.05,
      method: 'catalogue', methodVersion: 'ephemeris-history-v1', sourceRefs: ['context-source'],
    }],
    missingness: [{
      field: 'reference.location', status: 'not_applicable', reason: 'observer_centric_sky_solution',
    }],
  };
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
        method: 'measured', methodVersion: 'weather-history-v1', sourceRefs: ['context-source'],
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

const snapshotFor = (
  kind: ContextualExplanationKind,
  overrides: Partial<Parameters<typeof buildGovernedContextualSourceSnapshot>[0]> = {},
) => buildGovernedContextualSourceSnapshot({
  binding: binding(),
  kind,
  sourceFamily: ({
    aircraft: 'aircraft_adsb_history',
    satellite: 'satellite_tle_sgp4_history',
    astronomy: 'astronomy_ephemeris_history',
    weather: 'weather_observation_history',
  } as const)[kind],
  sourceId: `historical-${kind}`,
  providerId: `provider-${kind}`,
  datasetVersion: `dataset-${kind}-2026-01-01`,
  coverageWindow: { start: '2025-12-31T23:00:00.000Z', end: '2026-01-01T02:00:00.000Z' },
  materializedAt: '2026-01-02T00:00:00.000Z',
  contentSha256: sha(`${kind}-snapshot-content`),
  ...overrides,
});

const governanceFor = (snapshot: GovernedContextualSourceSnapshot, approved = true) => ({
  canonicalSource: `SOURCE_${snapshot.kind.toUpperCase()}`,
  decisionPacket: buildContextualSourceGovernanceDecisionPacket({
    referenceAt: '2026-01-02T12:00:00.000Z',
    maximumEvidenceAgeDays: 30,
    entries: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => ({
      ...(() => {
        const categoryApproved = approved || category !== snapshot.kind;
        return {
          registry: {
            inspectedAt: '2026-01-02T11:00:00.000Z',
            legalStatus: categoryApproved ? 'approved' as const : 'review' as const,
            allowedContentModes: categoryApproved ? ['derived_only'] : ['metadata_only'],
          },
          rights: {
            commercialUse: categoryApproved ? 'allowed' as const : 'unclear' as const,
            automatedAccess: 'allowed' as const,
            archivalUse: categoryApproved ? 'allowed' as const : 'unclear' as const,
            redistribution: categoryApproved ? 'allowed' as const : 'unclear' as const,
            accessConstraint: categoryApproved ? 'none' as const : 'unclear' as const,
            attributionRequired: categoryApproved ? true : null,
          },
        };
      })(),
      category,
      canonicalSource: `SOURCE_${category.toUpperCase()}`,
      providerId: `provider-${category}`,
      requiredContentMode: 'derived_only',
      evidence: [{
        evidenceId: `fixture-${category}`,
        evidenceUrl: `https://example.test/${category}/terms`,
        observedAt: '2026-01-02T10:00:00.000Z',
        evidenceSha256: sha(`fixture-${category}-terms`),
        summary: `Approved fixture terms for ${category}.`,
      }],
      limitations: [],
    })),
  }),
});

const fixture = (
  kind: ContextualExplanationKind,
  ordinal: number,
  options: { missingSubjectWindow?: boolean; retrievedAt?: string } = {},
): {
  snapshot: GovernedContextualSourceSnapshot;
  record: RelationshipInputRecord;
  row: GovernedContextualSourceRow;
} => {
  const sightingAddress = address(ordinal);
  const family = familyObservation(kind);
  if (options.missingSubjectWindow) {
    family.subjectObservation.window = null;
    family.missingness.push({
      field: 'subject.window', status: 'not_recorded', reason: 'source_omitted_time',
    });
  }
  const snapshot = snapshotFor(kind);
  const coreDraft: GovernedContextualObservationCoreDraft = {
    kind,
    binding: binding(),
    address: sightingAddress,
    originDraftBindings: [
      { origin: origin(sightingAddress, 'event.observation'), sourceRef: 'subject-source' },
      { origin: origin(sightingAddress, `context.${kind}`), sourceRef: 'context-source' },
    ],
    reference: { referenceId: referenceId(kind), label: `${kind} historical reference` },
    subjectObservation: family.subjectObservation,
    referenceObservation: family.referenceObservation,
    provenance: [
      provenance('subject-source', 'subject_observation', 'uapfiles', 'uapfiles-2026-01-01'),
      provenance(
        'context-source',
        'context_reference',
        snapshot.providerId,
        snapshot.datasetVersion,
        options.retrievedAt,
      ),
    ],
    domainEvidence: family.domainEvidence,
    missingness: family.missingness,
    model: model(),
  };
  const prepared = prepareGovernedContextualObservation(coreDraft);
  const fact: RelationshipInputFactDraft = {
    family: 'contextual_explanation',
    predicate: 'contextual_explanation_candidate',
    value: {
      kind: 'contextual_explanation',
      explanationType: explanationType(kind),
      referenceId: referenceId(kind),
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
    binding: binding(),
    address: sightingAddress,
    source: {
      sourceId: 'uapfiles',
      sourceRecordId: `case-${ordinal}`,
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
  });
  const payload = buildGovernedContextualObservationPayloadForRecord(record, prepared.core, binding());
  return {
    snapshot,
    record,
    row: buildGovernedContextualSourceRow({ snapshot, relationshipRecord: record, payload }),
  };
};

type Stored = { body: Buffer; version: string };

class MemoryStorage implements CaseGraphConditionalArchiveStorage {
  readonly objects = new Map<string, Stored>();
  readonly throwAfterCommitKeys = new Set<string>();
  private version = 0;

  private nextVersion() {
    this.version += 1;
    return `v${this.version}`;
  }

  async readObject(key: string) {
    const value = this.objects.get(key);
    return value ? Buffer.from(value.body) : null;
  }

  async readObjectVersioned(key: string) {
    const value = this.objects.get(key);
    return value ? { body: Buffer.from(value.body), version: value.version } : null;
  }

  async uploadFile(body: Buffer, key: string) {
    this.objects.set(key, { body: Buffer.from(body), version: this.nextVersion() });
    return key;
  }

  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: { contentType: string; contentEncoding?: string; cacheControl: string; contentLength: number },
    condition: CaseGraphArchiveWriteCondition,
  ): Promise<CaseGraphConditionalWriteResult> {
    const existing = this.objects.get(key);
    if ('ifAbsent' in condition ? Boolean(existing) : !existing || existing.version !== condition.ifVersion) {
      return { status: 'precondition_failed' };
    }
    const version = this.nextVersion();
    this.objects.set(key, { body: Buffer.from(body), version });
    if (this.throwAfterCommitKeys.delete(key)) throw new Error(`simulated_lost_ack:${key}`);
    return { status: 'written', key, version };
  }

  overwrite(key: string, body: Buffer) {
    this.objects.set(key, { body: Buffer.from(body), version: this.nextVersion() });
  }
}

const sourceForPages = (
  snapshot: GovernedContextualSourceSnapshot,
  pages: Map<string, GovernedContextualSourcePage>,
  failCursorOnce: string | null = '__never__',
): GovernedContextualObservationSource & { calls: Array<string | null> } => {
  const calls: Array<string | null> = [];
  let pendingFailure = failCursorOnce;
  return {
    calls,
    inspectSnapshot: async () => snapshot,
    fetchPage: async ({ cursor }) => {
      calls.push(cursor);
      if (cursor === pendingFailure) {
        pendingFailure = '__never__';
        throw new Error(`simulated_source_interruption:${cursor}`);
      }
      return pages.get(cursor || '__start__') || (() => { throw new Error(`page_missing:${cursor}`); })();
    },
  };
};

describe('governed contextual source and archive', () => {
  it('accepts immutable historically aligned ADS-B, TLE/SGP4, ephemeris, and weather rows', () => {
    const expectedEdges = {
      aircraft: 'context_aircraft_candidate',
      satellite: 'context_satellite_candidate',
      astronomy: 'context_astronomy_candidate',
      weather: 'context_weather_candidate',
    } as const;
    for (const [index, kind] of (['aircraft', 'satellite', 'astronomy', 'weather'] as const).entries()) {
      const current = fixture(kind, index + 1);
      const archived = buildContextualObservationArchiveRecord({ snapshot: current.snapshot, sourceRow: current.row });
      expect(current.row.timeAlignment.status).toBe('verified_historical_alignment');
      expect(archived.result.evaluation.edge?.edgeType).toBe(expectedEdges[kind]);
      expect(decodeContextualObservationArchiveRecord(archived, current.snapshot)).toEqual(archived);
    }
  });

  it('rejects live/incomplete snapshots, out-of-coverage events, and post-materialization provenance', () => {
    expect(() => snapshotFor('satellite', { sourceFamily: 'aircraft_adsb_history' }))
      .toThrow('contextual_source_snapshot_family_mismatch');

    expect(() => snapshotFor('aircraft', {
      coverageWindow: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' },
      materializedAt: '2026-01-01T12:00:00.000Z',
    })).toThrow('contextual_source_not_historical_snapshot');

    const current = fixture('aircraft', 10);
    const narrow = snapshotFor('aircraft', {
      coverageWindow: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T00:00:40.000Z' },
      materializedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(() => buildGovernedContextualSourceRow({
      snapshot: narrow,
      relationshipRecord: current.record,
      payload: current.row.payload,
    })).toThrow('contextual_source_historical_time_mismatch');

    expect(() => fixture('aircraft', 11, { retrievedAt: '2026-01-03T00:00:00.000Z' }))
      .toThrow('contextual_source_snapshot_provenance_mismatch');
  });

  it('archives missing time as an explicit insufficient-evidence receipt instead of dropping the row', () => {
    const current = fixture('satellite', 20, { missingSubjectWindow: true });
    const archived = buildContextualObservationArchiveRecord({ snapshot: current.snapshot, sourceRow: current.row });
    expect(archived.timeAlignment).toEqual({
      status: 'unresolved_missing_time',
      coverageWindow: current.snapshot.coverageWindow,
      missingFields: ['subject.window'],
    });
    expect(archived.result.evaluation.edge).toBeNull();
    expect(archived.result.evaluation.receipt.decision).toBe('insufficient_evidence');
    expect(archived.result.evaluation.receipt.failedChecks)
      .toEqual(expect.arrayContaining(['subject_window_available', 'temporal_match_available']));
  });

  it('detects snapshot/page/result tampering even when outer digests are recomputed', () => {
    const current = fixture('weather', 30);
    const snapshotTamper = clone(current.snapshot);
    snapshotTamper.contentSha256 = 'f'.repeat(64);
    expect(() => decodeGovernedContextualSourceSnapshot(snapshotTamper, binding()))
      .toThrow('contextual_source_snapshot_digest_mismatch');

    const page = buildGovernedContextualSourcePage({
      snapshot: current.snapshot,
      cursor: null,
      nextCursor: null,
      rows: [current.row],
    });
    const pageTamper = clone(page);
    pageTamper.rows[0].rowDigest = 'e'.repeat(64);
    expect(() => decodeGovernedContextualSourcePage(pageTamper, current.snapshot, null))
      .toThrow(/contextual_source_row_digest_mismatch|contextual_source_page_digest_mismatch/);

    const archived = buildContextualObservationArchiveRecord({ snapshot: current.snapshot, sourceRow: current.row });
    const resultTamper = clone(archived);
    resultTamper.result.evaluation.receipt.policySha256 = 'd'.repeat(64);
    const { adapterReceiptSha256: _adapterDigest, ...resultWithoutDigest } = resultTamper.result;
    resultTamper.result.adapterReceiptSha256 = contextualExplanationSha256(resultWithoutDigest);
    const { recordDigest: _recordDigest, ...recordWithoutDigest } = resultTamper;
    resultTamper.recordDigest = contextualExplanationSha256(recordWithoutDigest);
    expect(() => decodeContextualObservationArchiveRecord(resultTamper, current.snapshot))
      .toThrow('contextual_archive_adapter_evaluation_mismatch');
  });

  it('refuses an unapproved source decision before the first storage write or page fetch', async () => {
    const current = fixture('weather', 31);
    const page = buildGovernedContextualSourcePage({
      snapshot: current.snapshot,
      cursor: null,
      nextCursor: null,
      rows: [current.row],
    });
    const storage = new MemoryStorage();
    const source = sourceForPages(current.snapshot, new Map([['__start__', page]]));
    await expect(archiveGovernedContextualObservations({
      storage,
      source,
      expectedBinding: binding(),
      governance: governanceFor(current.snapshot, false),
      now: () => '2026-01-03T00:00:00.000Z',
    })).rejects.toThrow('contextual_archive_governance_not_approved:review_required');
    expect(storage.objects.size).toBe(0);
    expect(source.calls).toEqual([]);
  });

  it('rejects a changed stored governance receipt before replaying archived evidence', async () => {
    const current = fixture('aircraft', 32);
    const page = buildGovernedContextualSourcePage({
      snapshot: current.snapshot,
      cursor: null,
      nextCursor: null,
      rows: [current.row],
    });
    const storage = new MemoryStorage();
    const governance = governanceFor(current.snapshot);
    await archiveGovernedContextualObservations({
      storage,
      source: sourceForPages(current.snapshot, new Map([['__start__', page]])),
      expectedBinding: binding(),
      governance,
      now: () => '2026-01-03T00:00:00.000Z',
    });
    const key = getContextualObservationArchiveControlKeys(current.snapshot).governanceReceiptKey;
    const receipt = JSON.parse((await storage.readObject(key))!.toString('utf8'));
    receipt.packetDigest = 'f'.repeat(64);
    storage.overwrite(key, Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'));
    await expect(readVerifiedContextualObservationArchive({
      storage,
      snapshot: current.snapshot,
      expectedBinding: binding(),
      governance,
      resolveRelationshipRecord: async () => current.record,
    })).rejects.toThrow('contextual_archive_governance_receipt_mismatch');
  });

  it('resumes from the durable cursor, reconciles lost acknowledgements, and verifies every receipt', async () => {
    const first = fixture('aircraft', 40);
    const second = fixture('aircraft', 41, { missingSubjectWindow: true });
    const snapshot = first.snapshot;
    expect(second.snapshot).toEqual(snapshot);
    const pages = new Map<string, GovernedContextualSourcePage>([
      ['__start__', buildGovernedContextualSourcePage({
        snapshot, cursor: null, nextCursor: 'page-1', rows: [first.row],
      })],
      ['page-1', buildGovernedContextualSourcePage({
        snapshot, cursor: 'page-1', nextCursor: null, rows: [second.row],
      })],
    ]);
    const storage = new MemoryStorage();
    const keys = getContextualObservationArchiveControlKeys(snapshot);
    storage.throwAfterCommitKeys.add(keys.checkpointKey);
    const interruptedSource = sourceForPages(snapshot, pages, 'page-1');

    await expect(archiveGovernedContextualObservations({
      storage,
      source: interruptedSource,
      expectedBinding: binding(),
      governance: governanceFor(snapshot),
      pageSize: 1,
      now: () => '2026-01-03T00:00:00.000Z',
    })).rejects.toThrow('simulated_source_interruption:page-1');
    expect(interruptedSource.calls).toEqual([null, 'page-1']);

    const resumedSource = sourceForPages(snapshot, pages);
    const completed = await archiveGovernedContextualObservations({
      storage,
      source: resumedSource,
      expectedBinding: binding(),
      governance: governanceFor(snapshot),
      pageSize: 1,
      now: () => '2026-01-03T00:00:00.000Z',
    });
    expect(completed.status).toBe('resumed');
    expect(resumedSource.calls).toEqual(['page-1']);
    expect(completed.completion).toMatchObject({
      rowCount: 2,
      emittedEdgeCount: 1,
      insufficientEvidenceCount: 1,
      partCount: 2,
    });

    const records = new Map([first.record, second.record].map((record) => [record.address, record]));
    const decisions: string[] = [];
    const verified = await readVerifiedContextualObservationArchive({
      storage,
      snapshot,
      expectedBinding: binding(),
      governance: governanceFor(snapshot),
      resolveRelationshipRecord: async (recordAddress, digest) => {
        const record = records.get(recordAddress);
        return record?.recordDigest === digest ? record : null;
      },
      onRecord: (record) => { decisions.push(record.result.evaluation.receipt.decision); },
    });
    expect(verified.verifiedRowCount).toBe(2);
    expect(decisions.sort()).toEqual(['emit_candidate_edge', 'insufficient_evidence']);

    const noFetchSource = sourceForPages(snapshot, new Map());
    const repeated = await archiveGovernedContextualObservations({
      storage,
      source: noFetchSource,
      expectedBinding: binding(),
      governance: governanceFor(snapshot),
      now: () => '2026-01-03T00:00:00.000Z',
    });
    expect(repeated.status).toBe('resumed');
    expect(noFetchSource.calls).toEqual([]);
  });

  it('rejects a repeating source cursor instead of looping across resumptions', async () => {
    const rows = [fixture('aircraft', 60), fixture('aircraft', 61), fixture('aircraft', 62)];
    const snapshot = rows[0].snapshot;
    const pages = new Map<string, GovernedContextualSourcePage>([
      ['__start__', buildGovernedContextualSourcePage({
        snapshot, cursor: null, nextCursor: 'page-a', rows: [rows[0].row],
      })],
      ['page-a', buildGovernedContextualSourcePage({
        snapshot, cursor: 'page-a', nextCursor: 'page-b', rows: [rows[1].row],
      })],
      ['page-b', buildGovernedContextualSourcePage({
        snapshot, cursor: 'page-b', nextCursor: 'page-a', rows: [rows[2].row],
      })],
    ]);
    const source = sourceForPages(snapshot, pages);
    await expect(archiveGovernedContextualObservations({
      storage: new MemoryStorage(),
      source,
      expectedBinding: binding(),
      governance: governanceFor(snapshot),
      pageSize: 1,
      now: () => '2026-01-03T00:00:00.000Z',
    })).rejects.toThrow('contextual_archive_source_cursor_cycle');
    expect(source.calls).toEqual([null, 'page-a', 'page-b']);
  });

  it('fails closed on archive-byte tampering, resolver mismatch, and a mixed universe binding', async () => {
    const current = fixture('astronomy', 50);
    const page = buildGovernedContextualSourcePage({
      snapshot: current.snapshot,
      cursor: null,
      nextCursor: null,
      rows: [current.row],
    });
    const storage = new MemoryStorage();
    await archiveGovernedContextualObservations({
      storage,
      source: sourceForPages(current.snapshot, new Map([['__start__', page]])),
      expectedBinding: binding(),
      governance: governanceFor(current.snapshot),
      now: () => '2026-01-03T00:00:00.000Z',
    });

    await expect(readVerifiedContextualObservationArchive({
      storage,
      snapshot: current.snapshot,
      expectedBinding: binding(),
      governance: governanceFor(current.snapshot),
      resolveRelationshipRecord: async () => null,
    })).rejects.toThrow('contextual_archive_relationship_record_missing');

    const snapshotKey = getContextualObservationArchiveControlKeys(current.snapshot).sourceSnapshotKey;
    const originalSnapshotBody = (await storage.readObject(snapshotKey))!;
    const differentSnapshot = snapshotFor('astronomy', { datasetVersion: 'different-immutable-dataset' });
    storage.overwrite(snapshotKey, Buffer.from(`${JSON.stringify(differentSnapshot)}\n`, 'utf8'));
    await expect(readVerifiedContextualObservationArchive({
      storage,
      snapshot: current.snapshot,
      expectedBinding: binding(),
      governance: governanceFor(current.snapshot),
      resolveRelationshipRecord: async () => current.record,
    })).rejects.toThrow('contextual_archive_stored_source_snapshot_mismatch');
    storage.overwrite(snapshotKey, originalSnapshotBody);

    const checkpoint = JSON.parse((await storage.readObject(
      getContextualObservationArchiveControlKeys(current.snapshot).checkpointKey,
    ))!.toString('utf8')) as { parts: Array<{ archiveKey: string }> };
    const partKey = checkpoint.parts[0].archiveKey;
    const tampered = Buffer.from((await storage.readObject(partKey))!);
    tampered[0] ^= 0xff;
    storage.overwrite(partKey, tampered);
    await expect(readVerifiedContextualObservationArchive({
      storage,
      snapshot: current.snapshot,
      expectedBinding: binding(),
      governance: governanceFor(current.snapshot),
      resolveRelationshipRecord: async () => current.record,
    })).rejects.toThrow('contextual_archive_part_compressed_receipt_mismatch');

    await expect(archiveGovernedContextualObservations({
      storage: new MemoryStorage(),
      source: sourceForPages(current.snapshot, new Map([['__start__', page]])),
      expectedBinding: binding({ snapshotId: '00000000-0000-4000-8000-000000000088' }),
      governance: governanceFor(current.snapshot),
      now: () => '2026-01-03T00:00:00.000Z',
    })).rejects.toThrow('relationship_input_snapshot_binding_mismatch');
  });
});
