import { describe, expect, it } from 'vitest';

import {
  RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
  accountRelationshipInputRecords,
  buildRelationshipInputRecord,
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecord,
  type RelationshipInputRecordDraft,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
  decodeRelationshipInputPart,
  decodeRelationshipInputPartManifest,
  decodeRelationshipInputSnapshotManifest,
  getRelationshipInputControlKeys,
  getRelationshipInputPartKeys,
} from '../../src/caseGraph/relationshipInputArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';

const sha = (value: string) => relationshipInputSha256(value);

const binding = (overrides: Partial<RelationshipInputUniverseBinding> = {}): RelationshipInputUniverseBinding => ({
  snapshotId: '00000000-0000-4000-8000-000000000099',
  corpusVersion: 'corpus-v2',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 2,
  ...overrides,
});

const narrativeOrigin = (
  address: string,
  sourceText = 'A silent triangle hovered beside the base.',
  excerpt = 'silent triangle',
): RelationshipInputOriginDraft => {
  const characterStart = sourceText.indexOf(excerpt);
  const start = Buffer.byteLength(sourceText.slice(0, characterStart), 'utf8');
  const end = start + Buffer.byteLength(excerpt, 'utf8');
  return {
    sourceAddress: address,
    sourceField: 'description_clean',
    sourceTextSha256: sha(sourceText),
    sourceTextBytes: Buffer.byteLength(sourceText, 'utf8'),
    supportingSpans: [{ unit: 'utf8_byte', start, end, text: excerpt, textSha256: sha(excerpt) }],
    extraction: { method: 'deterministic_rule', version: 'visual-rules-v2' },
  };
};

const structuredOrigin = (address: string, field = 'source_record_id'): RelationshipInputOriginDraft => ({
  sourceAddress: address,
  sourceField: field,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'governed-snapshot-v2' },
});

const draft = (
  address = 'sighting:00000000-0000-4000-8000-000000000001',
  sourceId = 'aaro',
): RelationshipInputRecordDraft => ({
  binding: binding(),
  address,
  source: {
    sourceId,
    sourceRecordId: `record-${address.slice(-4)}`,
    registryVersion: 'case-graph-sources-v2',
    lineageId: `${sourceId}-lineage`,
    dependencyRisk: 'low',
  },
  facts: [
    {
      family: 'visual',
      predicate: 'observed_shape',
      value: { kind: 'term', termId: 'triangle', vocabularyVersion: 'visual-v2' },
      confidence: 0.92,
      uncertainty: { level: 'low', reasons: ['single_witness'] },
      precision: { kind: 'categorical', vocabularyVersion: 'visual-v2' },
      missingness: { status: 'present', reasons: [] },
      origins: [narrativeOrigin(address)],
    },
    {
      family: 'space_time',
      predicate: 'event_location',
      value: { kind: 'geo_point', lat: 51.5, lon: -0.1, spatialPrecisionKm: 25 },
      confidence: 0.8,
      uncertainty: { level: 'medium', reasons: ['city_level_geocode'] },
      precision: { kind: 'approximate', unit: 'km', tolerance: 25 },
      missingness: { status: 'present', reasons: [] },
      origins: [structuredOrigin(address, 'location')],
    },
    {
      family: 'entity',
      predicate: 'mentions_entity',
      value: { kind: 'governed_reference', governedId: 'entity:usaf', registryVersion: 'entity-registry-v3' },
      confidence: 0.88,
      uncertainty: { level: 'low', reasons: ['entity_alias'] },
      precision: { kind: 'categorical', vocabularyVersion: 'entity-registry-v3' },
      missingness: { status: 'present', reasons: [] },
      origins: [narrativeOrigin(address, 'The witness reported USAF personnel.', 'USAF')],
    },
    {
      family: 'contextual_explanation',
      predicate: 'nearby_aircraft_candidate',
      value: {
        kind: 'contextual_explanation',
        explanationType: 'aircraft',
        referenceId: 'adsb:flight-101',
        matchStatus: 'candidate',
        interpretation: 'candidate_explanation_not_causal_attribution',
        metrics: { distance_km: 12.5, time_delta_seconds: 90 },
      },
      confidence: 0.67,
      uncertainty: { level: 'medium', reasons: ['coverage_gap'] },
      precision: { kind: 'bounded', unit: 'seconds', lower: 60, upper: 120 },
      missingness: { status: 'present', reasons: [] },
      origins: [structuredOrigin(address, 'context.aircraft')],
    },
    {
      family: 'duration',
      predicate: 'observed_duration',
      value: null,
      confidence: null,
      uncertainty: { level: 'unknown', reasons: ['not_recorded'] },
      precision: { kind: 'unknown' },
      missingness: { status: 'not_recorded', reasons: ['source_omitted'] },
      origins: [],
    },
  ],
  recordMissingness: [{ field: 'duration_seconds', status: 'not_recorded', reason: 'source_omitted' }],
  duplicateLineage: null,
  crossReferences: [{
    targetAddress: address === 'document:official-file-101'
      ? 'sighting:00000000-0000-4000-8000-000000000001'
      : 'document:official-file-101',
    relation: 'cites',
    origins: [narrativeOrigin(address, 'See official-file-101 for the report.', 'official-file-101')],
  }],
  sourceAssertions: [{
    counterpartySourceId: sourceId === 'uk_mod' ? 'aaro' : 'uk_mod',
    classification: 'independent',
    basis: 'documented_separate_origin',
    origins: [structuredOrigin(address, 'source_independence_receipt')],
  }],
  narrativeVector: {
    status: 'present',
    modelId: 'uap-narrative-encoder',
    modelVersion: '2026-07-17',
    dimensions: 768,
    normalization: 'l2',
    inputSha256: sha('normalized narrative'),
    vectorSha256: sha('binary vector receipt'),
  },
  governedReferences: [{
    governedId: 'entity:usaf',
    kind: 'entity',
    registryVersion: 'entity-registry-v3',
    label: 'United States Air Force',
    origins: [narrativeOrigin(address, 'The witness reported USAF personnel.', 'USAF')],
  }],
});

const clone = <T>(value: T): T => structuredClone(value);

describe('relationship input snapshot v2', () => {
  it('canonicalizes drafts deterministically and derives stable fact, origin, reference, assertion, and record IDs', () => {
    const firstDraft = draft();
    const reordered = clone(firstDraft);
    reordered.facts.reverse();
    reordered.governedReferences.reverse();
    reordered.sourceAssertions.reverse();
    reordered.crossReferences.reverse();
    const context = reordered.facts.find((fact) => fact.family === 'contextual_explanation');
    if (context?.value?.kind === 'contextual_explanation') {
      context.value.metrics = { time_delta_seconds: 90, distance_km: 12.5 };
    }

    const first = buildRelationshipInputRecord(firstDraft);
    const second = buildRelationshipInputRecord(reordered);

    expect(first).toEqual(second);
    expect(first.recordDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.facts.every((fact) => /^fact:[a-f0-9]{64}$/.test(fact.factId))).toBe(true);
    expect(first.facts.flatMap((fact) => fact.origins).every((origin) => /^origin:[a-f0-9]{64}$/.test(origin.originId))).toBe(true);
    expect(first.crossReferences[0].referenceId).toMatch(/^xref:[a-f0-9]{64}$/);
    expect(first.sourceAssertions[0].assertionId).toMatch(/^source-assertion:[a-f0-9]{64}$/);
    expect(decodeRelationshipInputRecord(JSON.stringify(first), binding())).toEqual(first);
  });

  it('fails closed when a fact, stable ID, vector digest, or record receipt is tampered', () => {
    const record = buildRelationshipInputRecord(draft());
    const factTamper = clone(record) as RelationshipInputRecord;
    const visual = factTamper.facts.find((fact) => fact.family === 'visual');
    if (visual?.value?.kind === 'term') visual.value.termId = 'sphere';
    expect(() => decodeRelationshipInputRecord(factTamper)).toThrow(/relationship_input_fact_id_mismatch|relationship_input_record_digest_mismatch/);

    const idTamper = clone(record);
    idTamper.facts[0].factId = `fact:${'b'.repeat(64)}`;
    expect(() => decodeRelationshipInputRecord(idTamper)).toThrow('relationship_input_fact_id_mismatch');

    const vectorTamper = clone(record);
    if (vectorTamper.narrativeVector.status === 'present') vectorTamper.narrativeVector.vectorSha256 = 'c'.repeat(64);
    expect(() => decodeRelationshipInputRecord(vectorTamper)).toThrow('relationship_input_record_digest_mismatch');

    const receiptTamper = clone(record);
    receiptTamper.recordDigest = 'd'.repeat(64);
    expect(() => decodeRelationshipInputRecord(receiptTamper)).toThrow('relationship_input_record_digest_mismatch');
  });

  it('rejects invalid UTF-8 supporting spans and excerpt digests', () => {
    const badBounds = draft();
    badBounds.facts[0].origins[0].supportingSpans[0].end += 1;
    expect(() => buildRelationshipInputRecord(badBounds)).toThrow('relationship_input_span_bounds_invalid');

    const badDigest = draft();
    badDigest.facts[0].origins[0].supportingSpans[0].textSha256 = 'e'.repeat(64);
    expect(() => buildRelationshipInputRecord(badDigest)).toThrow('relationship_input_span_digest_mismatch');

    const unicode = draft();
    unicode.facts[0].origins = [narrativeOrigin(unicode.address, 'A café-bright object.', 'café')];
    expect(buildRelationshipInputRecord(unicode).facts.find((fact) => fact.family === 'visual')?.origins[0].supportingSpans[0])
      .toMatchObject({ start: 2, end: 7 });
  });

  it('rejects out-of-range confidence and contradictory missingness while accounting explicit gaps', () => {
    const overconfident = draft();
    overconfident.facts[0].confidence = 1.01;
    expect(() => buildRelationshipInputRecord(overconfident)).toThrow('relationship_input_confidence_invalid');

    const contradictory = draft();
    contradictory.facts[0].missingness = { status: 'not_recorded', reasons: ['source_omitted'] };
    expect(() => buildRelationshipInputRecord(contradictory)).toThrow('relationship_input_fact_missingness_mismatch');

    const missingReason = draft();
    missingReason.facts[4].missingness = { status: 'not_recorded', reasons: [] };
    expect(() => buildRelationshipInputRecord(missingReason)).toThrow('relationship_input_missingness_reason_mismatch');

    const record = buildRelationshipInputRecord(draft());
    expect(accountRelationshipInputRecords([record], binding())).toMatchObject({
      recordCount: 1,
      factCount: 5,
      missingFactCount: 1,
      recordMissingFieldCount: 1,
      contextualExplanationFactCount: 1,
    });
  });

  it('binds every record to the exact universe snapshot, corpus, schema, layout, count, and archive-set hash', () => {
    const record = buildRelationshipInputRecord(draft());
    expect(() => decodeRelationshipInputRecord(record, binding({ snapshotId: '00000000-0000-4000-8000-000000000088' })))
      .toThrow('relationship_input_snapshot_binding_mismatch');
    expect(() => decodeRelationshipInputRecord(record, binding({ universeArchiveSetSha256: 'f'.repeat(64) })))
      .toThrow('relationship_input_snapshot_binding_mismatch');
    expect(() => decodeRelationshipInputRecord(record, binding({ corpusVersion: 'corpus-v3' })))
      .toThrow('relationship_input_snapshot_binding_mismatch');
    expect(() => buildRelationshipInputRecord({
      ...draft(),
      binding: { ...binding(), universeLayoutVersion: 'evidence-universe-layout-v1' as typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION },
    })).toThrow('relationship_input_universe_version_invalid');
  });

  it('requires inspectable duplicate provenance and internally consistent canonical membership', () => {
    const missingProvenance = draft();
    missingProvenance.duplicateLineage = {
      clusterId: 'duplicate:cluster-101',
      status: 'confirmed',
      canonicalAddress: 'sighting:00000000-0000-4000-8000-000000000002',
      memberRole: 'duplicate',
      origins: [structuredOrigin(missingProvenance.address, 'duplicate_cluster_id')],
    };
    expect(() => buildRelationshipInputRecord(missingProvenance))
      .toThrow('relationship_input_duplicate_provenance_missing');

    missingProvenance.facts.push({
      family: 'provenance',
      predicate: 'duplicate_cluster_membership',
      value: { kind: 'provenance', code: 'duplicate_cluster', referenceId: 'duplicate:cluster-101' },
      confidence: 1,
      uncertainty: { level: 'none', reasons: [] },
      precision: { kind: 'exact' },
      missingness: { status: 'present', reasons: [] },
      origins: [structuredOrigin(missingProvenance.address, 'duplicate_cluster_id')],
    });
    const record = buildRelationshipInputRecord(missingProvenance);
    expect(record.duplicateLineage).toMatchObject({ status: 'confirmed', memberRole: 'duplicate' });

    const falseCanonical = draft();
    falseCanonical.duplicateLineage = {
      clusterId: 'duplicate:cluster-102',
      status: 'candidate',
      canonicalAddress: falseCanonical.address,
      memberRole: 'duplicate',
      origins: [structuredOrigin(falseCanonical.address, 'duplicate_cluster_id')],
    };
    expect(() => buildRelationshipInputRecord(falseCanonical)).toThrow('relationship_input_duplicate_member_role_invalid');

    const orphanProvenance = draft();
    orphanProvenance.facts.push({
      family: 'provenance',
      predicate: 'duplicate_cluster_membership',
      value: { kind: 'provenance', code: 'duplicate_cluster', referenceId: 'duplicate:orphan-cluster' },
      confidence: 1,
      uncertainty: { level: 'none', reasons: [] },
      precision: { kind: 'exact' },
      missingness: { status: 'present', reasons: [] },
      origins: [structuredOrigin(orphanProvenance.address, 'duplicate_cluster_id')],
    });
    expect(() => buildRelationshipInputRecord(orphanProvenance)).toThrow('relationship_input_orphan_duplicate_provenance');
  });

  it('requires positive provenance for independence and never treats a source as independent from itself', () => {
    const unsupported = draft();
    unsupported.sourceAssertions[0].origins = [];
    expect(() => buildRelationshipInputRecord(unsupported)).toThrow('relationship_input_origin_required');

    const selfIndependent = draft();
    selfIndependent.sourceAssertions[0] = {
      counterpartySourceId: 'aaro',
      classification: 'independent',
      basis: 'governed_review',
      origins: [structuredOrigin(selfIndependent.address, 'source_independence_receipt')],
    };
    expect(() => buildRelationshipInputRecord(selfIndependent)).toThrow('relationship_input_same_source_independence_invalid');

    const unknown = draft();
    unknown.sourceAssertions[0] = {
      counterpartySourceId: 'unknown_archive',
      classification: 'unknown',
      basis: 'insufficient_evidence',
      origins: [],
    };
    expect(buildRelationshipInputRecord(unknown).sourceAssertions[0]).toMatchObject({ classification: 'unknown' });
  });

  it('requires governed entity/site references to resolve to a matching registry receipt', () => {
    const noRegistryReceipt = draft();
    noRegistryReceipt.governedReferences = [];
    expect(() => buildRelationshipInputRecord(noRegistryReceipt)).toThrow('relationship_input_fact_governed_reference_mismatch');

    const wrongKind = draft();
    wrongKind.governedReferences[0].kind = 'site';
    expect(() => buildRelationshipInputRecord(wrongKind)).toThrow('relationship_input_fact_governed_reference_mismatch');
  });

  it('encodes candidate contextual explanations without causal or extraordinary-origin claims', () => {
    const record = buildRelationshipInputRecord(draft());
    expect(record.claimDiscipline).toEqual(RELATIONSHIP_INPUT_CLAIM_DISCIPLINE);
    const context = record.facts.find((fact) => fact.family === 'contextual_explanation');
    expect(context?.value).toMatchObject({
      matchStatus: 'candidate',
      interpretation: 'candidate_explanation_not_causal_attribution',
    });

    const causal = draft();
    const causalContext = causal.facts.find((fact) => fact.family === 'contextual_explanation');
    if (causalContext?.value?.kind === 'contextual_explanation') {
      causalContext.value.interpretation = 'caused_by_aircraft' as 'candidate_explanation_not_causal_attribution';
    }
    expect(() => buildRelationshipInputRecord(causal)).toThrow('relationship_input_context_claim_invalid');

    const tamperedNotice = clone(record) as RelationshipInputRecord;
    tamperedNotice.claimDiscipline = {
      ...RELATIONSHIP_INPUT_CLAIM_DISCIPLINE,
      notice: 'This proves an extraordinary origin.',
    } as unknown as typeof RELATIONSHIP_INPUT_CLAIM_DISCIPLINE;
    expect(() => decodeRelationshipInputRecord(tamperedNotice)).toThrow('relationship_input_claim_discipline_invalid');

    const hiddenClaim = clone(record) as RelationshipInputRecord;
    const hiddenContext = hiddenClaim.facts.find((fact) => fact.family === 'contextual_explanation');
    if (hiddenContext?.value?.kind === 'contextual_explanation') {
      Object.assign(hiddenContext.value, { causalClaim: 'aircraft caused this report' });
    }
    expect(() => decodeRelationshipInputRecord(hiddenClaim)).toThrow('relationship_input_record_non_canonical');
  });

  it('builds deterministic map parts and verifies compressed, record-set, address, and accounting receipts', () => {
    const one = buildRelationshipInputRecord(draft());
    const twoDraft = draft('document:official-file-101', 'uk_mod');
    twoDraft.facts = twoDraft.facts.filter((fact) => fact.family !== 'entity');
    twoDraft.governedReferences = [];
    const two = buildRelationshipInputRecord(twoDraft);
    const first = buildRelationshipInputPart({ binding: binding(), partNumber: 0, records: [one, two] });
    const reordered = buildRelationshipInputPart({ binding: binding(), partNumber: 0, records: [two, one] });

    expect(first.archiveBody.equals(reordered.archiveBody)).toBe(true);
    expect(first.manifest).toEqual(reordered.manifest);
    expect(decodeRelationshipInputPart(first.archiveBody, first.manifest, binding()).records.map((record) => record.address))
      .toEqual([two.address, one.address].sort());
    expect(decodeRelationshipInputPartManifest(first.manifestBody, binding())).toEqual(first.manifest);
    expect(() => decodeRelationshipInputPartManifest({ ...first.manifest, hiddenPolicy: 'causal' }, binding()))
      .toThrow('relationship_input_part_manifest_non_canonical');

    const corrupted = Buffer.from(first.archiveBody);
    corrupted[corrupted.length - 2] ^= 0xff;
    expect(() => decodeRelationshipInputPart(corrupted, first.manifest, binding()))
      .toThrow('relationship_input_part_compressed_receipt_mismatch');

    const tamperedManifest = { ...first.manifest, recordSetSha256: 'f'.repeat(64) };
    expect(() => decodeRelationshipInputPart(first.archiveBody, tamperedManifest, binding()))
      .toThrow('relationship_input_part_record_set_mismatch');
  });

  it('builds a complete snapshot manifest only when every universe record is accounted for', () => {
    const one = buildRelationshipInputRecord(draft());
    const twoDraft = draft('document:official-file-101', 'uk_mod');
    twoDraft.facts = twoDraft.facts.filter((fact) => fact.family !== 'entity');
    twoDraft.governedReferences = [];
    const two = buildRelationshipInputRecord(twoDraft);
    const part0 = buildRelationshipInputPart({ binding: binding(), partNumber: 0, records: [two] });
    const part1 = buildRelationshipInputPart({ binding: binding(), partNumber: 1, records: [one] });
    const generatedAt = '2026-07-18T01:00:00.000Z';
    const manifest = buildRelationshipInputSnapshotManifest({
      binding: binding(), parts: [part1.manifest, part0.manifest], generatedAt,
    });
    expect(manifest).toMatchObject({ partCount: 2, rowCount: 2, generatedAt });
    expect(manifest.archiveSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(decodeRelationshipInputSnapshotManifest(JSON.stringify(manifest), binding())).toEqual(manifest);

    expect(() => buildRelationshipInputSnapshotManifest({
      binding: binding(), parts: [part0.manifest], generatedAt,
    })).toThrow('relationship_input_snapshot_incomplete');

    const tampered = { ...manifest, archiveSetSha256: '0'.repeat(64) };
    expect(() => decodeRelationshipInputSnapshotManifest(tampered, binding()))
      .toThrow('relationship_input_snapshot_manifest_integrity_invalid');
  });

  it('provides immutable, snapshot-bound keys suitable for map/reduce workers', () => {
    expect(getRelationshipInputPartKeys(binding(), 12)).toEqual({
      archiveKey: `case-vortex/corpora/corpus-v2/relationship-input-v2/${binding().snapshotId}/${'a'.repeat(64)}/parts/part-000012.ndjson.gz`,
      manifestKey: `case-vortex/corpora/corpus-v2/relationship-input-v2/${binding().snapshotId}/${'a'.repeat(64)}/parts/part-000012.manifest.json`,
    });
    expect(getRelationshipInputControlKeys(binding()).completionManifestKey)
      .toContain('/relationship-input-v2/00000000-0000-4000-8000-000000000099/');
    expect(() => getRelationshipInputPartKeys(binding(), -1)).toThrow('relationship_input_part_number_invalid');
  });

  it('rejects non-JSON canonical values instead of silently changing their digest', () => {
    expect(() => canonicalizeRelationshipInput({ value: Number.NaN })).toThrow('relationship_input_canonical_non_finite');
    expect(() => canonicalizeRelationshipInput({ value: undefined })).toThrow('relationship_input_canonical_undefined');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeRelationshipInput(cyclic)).toThrow('relationship_input_canonical_cycle');
  });
});
