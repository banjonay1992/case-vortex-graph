import { describe, expect, it } from 'vitest';

import {
  auditCaseVortexCorpusAccounting,
  buildCaseVortexCorpusAccountingReceipt,
  type CaseVortexCorpusAccountingInput,
  type CaseVortexCorpusRecord,
} from '../../src/caseGraph/corpusAccounting';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import { RELATIONSHIP_INPUT_SNAPSHOT_VERSION } from '../../src/caseGraph/relationshipInputSnapshot';

const hash = (character: string) => character.repeat(64);
const pointer = (address: string, character: string) => ({ address, sha256: hash(character) });

const represented = (
  kind: 'sighting' | 'document' | 'photo' | 'video',
  recordId: string,
  disposition: 'processed' | 'not_applicable' = 'processed',
): CaseVortexCorpusRecord => {
  const address = `${kind}:${recordId}`;
  return {
    status: 'represented',
    kind,
    recordId,
    address,
    universe: pointer(address, 'a'),
    relationshipInput: {
      ...pointer(address, 'b'),
      disposition,
      ...(disposition === 'not_applicable' ? { notApplicableReason: 'no_narrative_field' } : {}),
    },
    graph: pointer(address, 'c'),
    userInterface: pointer(address, 'd'),
  };
};

const excluded = (
  kind: 'sighting' | 'document' | 'photo' | 'video',
  recordId: string,
  reason: 'not_public' | 'withdrawn' | 'legal_restriction' | 'unsafe_media' | 'invalid_record' | 'outside_governed_scope',
): CaseVortexCorpusRecord => ({
  status: 'excluded',
  kind,
  recordId,
  address: `${kind}:${recordId}`,
  exclusion: {
    reason,
    policyRule: `public-scope-${reason}-v1`,
    evidenceReference: `audit-ledger/${kind}/${recordId}`,
  },
});

const fixture = (): CaseVortexCorpusAccountingInput => ({
  binding: {
    corpusVersion: '2026-07-18-v3',
    snapshotId: '018f47ef-4fb0-7e2a-8b5c-5bd3909f7101',
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeArchiveSetSha256: hash('1'),
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeRecordCount: 3,
    relationshipInputSchemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
    relationshipInputBinding: {
      snapshotId: '018f47ef-4fb0-7e2a-8b5c-5bd3909f7101',
      corpusVersion: '2026-07-18-v3',
      universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
      universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      universeArchiveSetSha256: hash('1'),
      universeRecordCount: 3,
    },
    relationshipInputArchiveSetSha256: hash('2'),
    relationshipInputManifestDigest: hash('4'),
    relationshipInputRecordCount: 3,
    graphPublicationSha256: hash('3'),
    policyVersion: 'public-corpus-v3',
  },
  observedByKind: { sighting: 1, document: 1, photo: 1, video: 1 },
  capturedByKind: { sighting: 1, document: 1, photo: 0, video: 1 },
  records: [
    represented('sighting', 's-1'),
    represented('document', 'd-1'),
    excluded('photo', 'p-1', 'not_public'),
    represented('video', 'v-1'),
  ],
});

const issueCodes = (input: CaseVortexCorpusAccountingInput) => {
  const result = auditCaseVortexCorpusAccounting(input);
  return result.status === 'incomplete' ? result.issues.map((issue) => issue.code) : [];
};

describe('case-vortex full-corpus accounting', () => {
  it('issues a complete receipt only when every observed record is represented or explicitly excluded', () => {
    const result = auditCaseVortexCorpusAccounting(fixture());
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('expected complete audit');
    expect(result.receipt).toMatchObject({
      complete: true,
      observedTotal: 4,
      representedTotal: 3,
      excludedTotal: 1,
      relationshipProcessedTotal: 3,
      relationshipNotApplicableTotal: 0,
      excludedByKind: { sighting: 0, document: 0, photo: 1, video: 0 },
      exclusionsByReason: { not_public: 1 },
    });
    expect(result.receipt.recordLedgerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.representedAddressSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.excludedAddressSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.universePointerSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.relationshipInputPointerSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.graphPointerSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.userInterfacePointerSetSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic regardless of input record order and does not mutate the caller array', () => {
    const input = fixture();
    const originalOrder = input.records.map((record) => record.address);
    const reversed = { ...input, records: [...input.records].reverse() };
    expect(buildCaseVortexCorpusAccountingReceipt(reversed)).toEqual(buildCaseVortexCorpusAccountingReceipt(input));
    expect(input.records.map((record) => record.address)).toEqual(originalOrder);
  });

  it('fails closed on missing or cross-snapshot stage coverage', () => {
    const missingGraph = fixture();
    missingGraph.records = missingGraph.records.filter((record) => record.address !== 'video:v-1');
    expect(issueCodes(missingGraph)).toEqual(expect.arrayContaining([
      'observed_count_mismatch',
      'represented_count_mismatch',
    ]));

    const badPointer = fixture();
    badPointer.records = badPointer.records.map((record) => record.address === 'sighting:s-1' && record.status === 'represented'
      ? { ...record, graph: pointer('sighting:somewhere-else', 'c') }
      : record);
    expect(issueCodes(badPointer)).toContain('graph_pointer_invalid');

    const mixedSnapshot = fixture();
    mixedSnapshot.binding.relationshipInputBinding.snapshotId = '018f47ef-4fb0-7e2a-8b5c-5bd3909f7102';
    expect(issueCodes(mixedSnapshot)).toContain('binding_snapshot_mismatch');
  });

  it('requires every represented universe record to be relationship-processed', () => {
    const input = fixture();
    input.records = input.records.map((record) => record.address === 'document:d-1'
      ? represented('document', 'd-1', 'not_applicable')
      : record);
    expect(issueCodes(input)).toEqual(expect.arrayContaining([
      'relationship_input_not_processed',
      'relationship_processed_count_mismatch',
    ]));
  });

  it('rejects duplicate addresses and unexplained count differences', () => {
    const input = fixture();
    input.records = [...input.records, represented('sighting', 's-1')];
    expect(issueCodes(input)).toEqual(expect.arrayContaining([
      'duplicate_record_accounting',
      'observed_count_mismatch',
    ]));

    const impossible = fixture();
    impossible.capturedByKind.photo = 2;
    expect(issueCodes(impossible)).toEqual(expect.arrayContaining([
      'captured_exceeds_observed',
      'represented_count_mismatch',
      'excluded_count_mismatch',
    ]));
  });

  it.each([
    'not_public',
    'withdrawn',
    'legal_restriction',
    'unsafe_media',
    'invalid_record',
    'outside_governed_scope',
  ] as const)('records the governed %s exclusion reason deterministically', (reason) => {
    const input = fixture();
    input.records = input.records.map((record) => record.address === 'photo:p-1' ? excluded('photo', 'p-1', reason) : record);
    const receipt = buildCaseVortexCorpusAccountingReceipt(input);
    expect(receipt.exclusionsByReason[reason]).toBe(1);
    expect(Object.values(receipt.exclusionsByReason).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('verifies duplicate lineage without collapsing the individual record', () => {
    const canonical = represented('sighting', 's-1');
    if (canonical.status !== 'represented') throw new Error('fixture failure');
    canonical.duplicateLineage = {
      status: 'confirmed',
      clusterId: 'duplicate-cluster-v1',
      canonicalAddress: canonical.address,
      memberRole: 'canonical',
    };
    const duplicate = represented('sighting', 's-2');
    if (duplicate.status !== 'represented') throw new Error('fixture failure');
    duplicate.duplicateLineage = {
      status: 'confirmed',
      clusterId: 'duplicate-cluster-v1',
      canonicalAddress: canonical.address,
      memberRole: 'duplicate',
    };
    const input = fixture();
    input.observedByKind.sighting = 2;
    input.capturedByKind.sighting = 2;
    input.binding.universeRecordCount = 4;
    input.binding.relationshipInputBinding.universeRecordCount = 4;
    input.binding.relationshipInputRecordCount = 4;
    input.records = input.records.map((record) => record.address === canonical.address ? canonical : record).concat(duplicate);
    const receipt = buildCaseVortexCorpusAccountingReceipt(input);
    expect(receipt.representedTotal).toBe(4);
    expect(receipt.duplicateConfirmedTotal).toBe(2);

    duplicate.duplicateLineage.canonicalAddress = 'sighting:missing';
    expect(issueCodes(input)).toContain('duplicate_canonical_address_missing');
  });

  it('requires duplicate members and their canonical receipt to agree on cluster, status, and kind', () => {
    const canonical = represented('sighting', 's-1');
    const duplicate = represented('sighting', 's-2');
    if (canonical.status !== 'represented' || duplicate.status !== 'represented') throw new Error('fixture failure');
    canonical.duplicateLineage = {
      status: 'confirmed',
      clusterId: 'duplicate:cluster-1',
      canonicalAddress: canonical.address,
      memberRole: 'canonical',
    };
    duplicate.duplicateLineage = {
      status: 'candidate',
      clusterId: 'duplicate:cluster-2',
      canonicalAddress: canonical.address,
      memberRole: 'duplicate',
    };
    const input = fixture();
    input.observedByKind.sighting = 2;
    input.capturedByKind.sighting = 2;
    input.binding.universeRecordCount = 4;
    input.binding.relationshipInputBinding.universeRecordCount = 4;
    input.binding.relationshipInputRecordCount = 4;
    input.records = input.records.map((record) => record.address === canonical.address ? canonical : record).concat(duplicate);
    expect(issueCodes(input)).toContain('duplicate_lineage_mismatch');

    duplicate.duplicateLineage.status = 'unreviewed' as 'candidate';
    expect(issueCodes(input)).toContain('duplicate_status_invalid');

    const secondCanonical = represented('sighting', 's-2');
    if (secondCanonical.status !== 'represented') throw new Error('fixture failure');
    secondCanonical.duplicateLineage = {
      status: 'confirmed',
      clusterId: canonical.duplicateLineage.clusterId,
      canonicalAddress: secondCanonical.address,
      memberRole: 'canonical',
    };
    const twoCanonicals = fixture();
    twoCanonicals.observedByKind.sighting = 2;
    twoCanonicals.capturedByKind.sighting = 2;
    twoCanonicals.binding.universeRecordCount = 4;
    twoCanonicals.binding.relationshipInputBinding.universeRecordCount = 4;
    twoCanonicals.binding.relationshipInputRecordCount = 4;
    twoCanonicals.records = twoCanonicals.records
      .map((record) => record.address === canonical.address ? canonical : record)
      .concat(secondCanonical);
    expect(issueCodes(twoCanonicals)).toContain('duplicate_cluster_inconsistent');
  });

  it('binds universe and relationship completion counts and archive receipts exactly', () => {
    const wrongUniverseHash = fixture();
    wrongUniverseHash.binding.relationshipInputBinding.universeArchiveSetSha256 = hash('9');
    expect(issueCodes(wrongUniverseHash)).toContain('binding_relationship_universe_sha_mismatch');

    const wrongCorpus = fixture();
    wrongCorpus.binding.relationshipInputBinding.corpusVersion = 'different-corpus';
    expect(issueCodes(wrongCorpus)).toContain('binding_corpus_mismatch');

    const wrongCount = fixture();
    wrongCount.binding.relationshipInputRecordCount = 2;
    expect(issueCodes(wrongCount)).toEqual(expect.arrayContaining([
      'binding_relationship_record_count_mismatch',
      'relationship_input_record_count_mismatch',
    ]));

    const badManifestDigest = fixture();
    badManifestDigest.binding.relationshipInputManifestDigest = 'not-a-digest';
    expect(issueCodes(badManifestDigest)).toContain('binding_relationship_manifest_digest_invalid');
  });

  it('rejects hidden accounting, record, pointer, and nested-binding fields', () => {
    const hiddenBinding = fixture();
    Object.assign(hiddenBinding.binding.relationshipInputBinding, { hiddenSnapshot: true });
    expect(issueCodes(hiddenBinding)).toContain('binding_relationship_universe_binding_shape_invalid');

    const hiddenRecord = fixture();
    hiddenRecord.records = hiddenRecord.records.map((record) => record.address === 'video:v-1'
      ? Object.assign(record, { hiddenCausalClaim: true })
      : record);
    expect(issueCodes(hiddenRecord)).toContain('record_shape_invalid');

    const hiddenPointer = fixture();
    hiddenPointer.records = hiddenPointer.records.map((record) => record.address === 'video:v-1' && record.status === 'represented'
      ? ({ ...record, graph: { ...record.graph, hiddenArchive: true } } as CaseVortexCorpusRecord)
      : record);
    expect(issueCodes(hiddenPointer)).toContain('graph_pointer_invalid');

    const hiddenInput = Object.assign(fixture(), { complete: true });
    expect(issueCodes(hiddenInput)).toContain('accounting_input_shape_invalid');
  });

  it('rejects non-canonical identities and malformed exclusion receipts', () => {
    const identity = fixture();
    identity.records = identity.records.map((record) => record.address === 'video:v-1'
      ? { ...record, recordId: 'V-1' }
      : record);
    expect(issueCodes(identity)).toContain('record_id_not_canonical');

    const malformed = fixture();
    malformed.records = malformed.records.map((record) => record.address === 'photo:p-1' && record.status === 'excluded'
      ? { ...record, exclusion: { ...record.exclusion, evidenceReference: '\n' } }
      : record);
    expect(issueCodes(malformed)).toContain('exclusion_evidence_reference_invalid');
  });

  it('returns fail-closed diagnostics instead of crashing on a malformed represented pointer', () => {
    const input = fixture();
    input.records = input.records.map((record) => record.address === 'video:v-1' && record.status === 'represented'
      ? ({ ...record, relationshipInput: undefined } as unknown as CaseVortexCorpusRecord)
      : record);
    expect(issueCodes(input)).toContain('relationship_pointer_invalid');

    const undefinedOptional = fixture();
    undefinedOptional.records = undefinedOptional.records.map((record) => record.address === 'video:v-1' && record.status === 'represented'
      ? ({
        ...record,
        relationshipInput: { ...record.relationshipInput, notApplicableReason: undefined },
      } as CaseVortexCorpusRecord)
      : record);
    expect(issueCodes(undefinedOptional)).toContain('relationship_not_applicable_reason_unexpected');

    const nullRecord = fixture();
    nullRecord.records = [
      ...nullRecord.records,
      null as unknown as CaseVortexCorpusRecord,
    ];
    expect(issueCodes(nullRecord)).toContain('record_shape_invalid');

    const malformedInput = auditCaseVortexCorpusAccounting(undefined as unknown as CaseVortexCorpusAccountingInput);
    expect(malformedInput).toEqual({
      status: 'incomplete',
      issues: [{ code: 'accounting_input_shape_invalid' }],
      receipt: null,
    });

    const malformedCounts = fixture();
    malformedCounts.observedByKind = undefined as unknown as CaseVortexCorpusAccountingInput['observedByKind'];
    expect(() => auditCaseVortexCorpusAccounting(malformedCounts)).not.toThrow();
    expect(issueCodes(malformedCounts)).toContain('kind_counts_shape_invalid');
  });

  it('exposes stable diagnostics and makes the throwing builder impossible to mistake for completion', () => {
    const input = fixture();
    input.observedByKind.video = 2;
    const first = auditCaseVortexCorpusAccounting(input);
    const second = auditCaseVortexCorpusAccounting(input);
    expect(first).toEqual(second);
    expect(first.status).toBe('incomplete');
    expect(() => buildCaseVortexCorpusAccountingReceipt(input)).toThrow(/case_vortex_corpus_accounting_incomplete/);
  });
});
