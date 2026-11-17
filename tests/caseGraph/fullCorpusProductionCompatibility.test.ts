import { describe, expect, it } from 'vitest';

import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from '../../src/caseGraph/archiveTypes';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  assertFullCorpusProductionCompatibility,
  buildFullCorpusProductionCompatibilityArchive,
  buildFullCorpusProductionCompatibilityReceipt,
  decodeFullCorpusProductionCompatibilityPointer,
  FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION,
  FULL_CORPUS_SEARCH_POSTGRES_LIMITS,
  FULL_CORPUS_SEARCH_TOKENIZER_VERSION,
  normalizeFullCorpusSearchText,
  readVerifiedFullCorpusProductionCompatibilityReceipt,
  writeFullCorpusProductionCompatibilityReceipt,
} from '../../src/caseGraph/fullCorpusProductionCompatibility';
import {
  FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION,
} from '../../src/caseGraph/fullCorpusTypedOrchestration';
import {
  relationshipInputSha256,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import { CASE_GRAPH_SOURCE_REGISTRY_VERSION } from '../../src/caseGraph/sourceRegistry';

const binding = (universeRecordCount: number): RelationshipInputUniverseBinding => ({
  snapshotId: '00000000-0000-4000-8000-000000000194',
  corpusVersion: 'compatibility-fixture-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount,
});

const orchestrationRequest = {
  schemaVersion: FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION,
  requestDigest: 'b'.repeat(64),
};

const node = (index: number, overrides: Partial<Parameters<typeof projectEvidenceUniverseNode>[0]> = {}) => (
  projectEvidenceUniverseNode({
    kind: 'document',
    recordId: `compatibility-${index}`,
    source: 'AARO',
    sourceRecordId: `source-${index}`,
    title: `Compatibility record ${index}`,
    summary: 'A deterministic governed compatibility fixture.',
    canonicalUrl: `https://example.test/compatibility/${index}`,
    previewUrl: null,
    eventTimestamp: '2026-07-18T12:00:00.123456Z',
    lat: 51.5,
    lon: -0.1,
    location: 'London',
    countryCode: 'GB',
    linkedSightingId: null,
    updatedAt: '2026-07-18T12:00:00.000Z',
    public: true,
    ...overrides,
  })
);

const receipt = (nodes: readonly EvidenceUniverseNode[]) => (
  buildFullCorpusProductionCompatibilityReceipt({
    universe: binding(nodes.length),
    orchestrationRequest,
    nodes,
  })
);

const memoryStorage = (corruptWrites = false): CaseGraphConditionalArchiveStorage & {
  objects: Map<string, CaseGraphVersionedArchiveObject>;
} => {
  let sequence = 0;
  const objects = new Map<string, CaseGraphVersionedArchiveObject>();
  return {
    objects,
    readObject: async (key) => objects.get(key)?.body || null,
    readObjectVersioned: async (key) => objects.get(key) || null,
    uploadFile: async () => { throw new Error('compatibility_test_unconditional_write_forbidden'); },
    uploadFileConditional: async (body, key, _options, condition) => {
      const current = objects.get(key);
      if ('ifAbsent' in condition) {
        if (current) return { status: 'precondition_failed' };
      } else if (!current || current.version !== condition.ifVersion) {
        return { status: 'precondition_failed' };
      }
      const stored = corruptWrites ? Buffer.from('corrupt', 'utf8') : Buffer.from(body);
      const value = { body: stored, version: `write-${sequence += 1}` };
      objects.set(key, value);
      return { status: 'written', key, version: value.version };
    },
  };
};

describe('full-corpus production compatibility receipt', () => {
  it('pins the Unicode normalizer semantics carried by the tokenizer version', () => {
    expect(normalizeFullCorpusSearchText('  Róswell—FIELD  ')).toBe('roswell field');
    expect(normalizeFullCorpusSearchText('NUL\0and\tcontrol\nspacing'))
      .toBe('nul and control spacing');
    expect(normalizeFullCorpusSearchText(null)).toBe('');
  });

  it('is deterministic, registry-bound and keeps governed misses as explicit nonfatal telemetry', () => {
    const nodes = [
      node(1, { source: 'AARO' }),
      node(2, { source: 'Foo Bar' }),
      node(3, { source: 'foo-bar' }),
      node(4, {
        source: 'İSTANBUL Archive',
        title: 'Róswell field',
        summary: 'Unicode telemetry remains measurable.',
        canonicalUrl: 'https://example.test/überblick',
      }),
    ];
    const first = receipt(nodes);
    const reordered = receipt([...nodes].reverse());

    expect(reordered).toEqual(first);
    expect(first.searchContract).toMatchObject({
      tokenizerVersion: FULL_CORPUS_SEARCH_TOKENIZER_VERSION,
      eventTimestampVersion: FULL_CORPUS_SEARCH_EVENT_TIMESTAMP_VERSION,
      sourceRegistryVersion: CASE_GRAPH_SOURCE_REGISTRY_VERSION,
      postgresLimits: FULL_CORPUS_SEARCH_POSTGRES_LIMITS,
    });
    expect(first.counters).toMatchObject({
      totalNodesChecked: 4,
      invalidSourceKeyCount: 0,
      unknownSourceCount: 3,
      unknownSourceKeyCollisionCount: 1,
      unknownSourceAliasCollisionCount: 1,
    });
    expect(first.unknownSourceKeys).toEqual(['foo_bar', 'i_stanbul_archive']);
    expect(first.maxUtf8Bytes.canonicalUrl).toBeGreaterThan(0);
    expect(first.compatible).toBe(true);
    expect(first.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(assertFullCorpusProductionCompatibility(first)).toBe(first);
  });

  it('counts Unicode, NUL, control, whitespace, noncanonical and overlong addresses exactly', () => {
    const overlong = node(4);
    overlong.recordId = 'a'.repeat(1_024);
    overlong.address = `document:${overlong.recordId}`;
    const result = receipt([
      node(1, { recordId: 'unicode-\u{10000}' }),
      node(2, { recordId: 'bad\0id' }),
      node(3, { recordId: 'bad id' }),
      overlong,
    ]);

    expect(result.counters).toMatchObject({
      totalNodesChecked: 4,
      nonAsciiAddressCount: 1,
      nulAddressCount: 1,
      controlAddressCount: 1,
      whitespaceAddressCount: 1,
      nonPrintableAddressCount: 3,
      nonCanonicalAddressCount: 1,
      overlongAddressCount: 1,
      addressOver240Utf8BytesCount: 1,
    });
    expect(result.compatible).toBe(false);
    expect(() => assertFullCorpusProductionCompatibility(result)).toThrow(
      'full_corpus_production_compatibility_address_invalid',
    );
  });

  it('reports a canonical full address over 240 bytes without treating it as a PostgreSQL failure', () => {
    const result = receipt([node(1, { recordId: 'a'.repeat(240) })]);
    expect(result.maxUtf8Bytes.address).toBe(249);
    expect(result.counters).toMatchObject({
      addressOver240Utf8BytesCount: 1,
      nonPrintableAddressCount: 0,
      nonCanonicalAddressCount: 0,
      overlongAddressCount: 0,
    });
    expect(() => assertFullCorpusProductionCompatibility(result)).not.toThrow();
  });

  it('accepts governed and canonical unknown sources but rejects a registry-derived overlong key', () => {
    const valid = receipt([
      node(1, { source: 'All-domain Anomaly Resolution Office' }),
      node(2, { source: 'İSTANBUL Archive' }),
    ]);
    expect(valid.counters).toMatchObject({
      invalidSourceKeyCount: 0,
      unknownSourceCount: 1,
    });
    expect(valid.unknownSourceKeys).toEqual(['i_stanbul_archive']);
    expect(() => assertFullCorpusProductionCompatibility(valid)).not.toThrow();

    const invalid = receipt([node(3, { source: 'x'.repeat(241) })]);
    expect(invalid.counters).toMatchObject({
      invalidSourceKeyCount: 1,
      overlongSourceKeyCount: 1,
      unknownSourceCount: 1,
    });
    expect(() => assertFullCorpusProductionCompatibility(invalid)).toThrow(
      'full_corpus_production_compatibility_source_key_invalid',
    );
  });

  it('enforces every normalized PostgreSQL byte ceiling while keeping canonical URL size nonfatal', () => {
    const urlOnly = receipt([node(1, {
      canonicalUrl: `https://example.test/${'ü'.repeat(300_000)}`,
    })]);
    expect(urlOnly.maxUtf8Bytes.canonicalUrl).toBeGreaterThan(500_000);
    expect(urlOnly.compatible).toBe(true);
    expect(() => assertFullCorpusProductionCompatibility(urlOnly)).not.toThrow();

    const invalidFields = node(2, {
      source: 'Ж'.repeat(2_049),
      title: 'ü'.repeat(FULL_CORPUS_SEARCH_POSTGRES_LIMITS.titleNormUtf8Bytes + 1),
      location: 'Ж'.repeat(4_097),
      summary: '漢'.repeat(100_000),
    });
    const result = receipt([invalidFields]);
    expect(result.counters).toMatchObject({
      invalidSourceKeyCount: 0,
      sourceNormOverLimitCount: 1,
      titleNormOverLimitCount: 1,
      locationNormOverLimitCount: 1,
      summaryNormOverLimitCount: 1,
    });
    expect(result.counters.normalizedTokenOver96CharactersCount).toBeGreaterThan(0);
    expect(result.counters.normalizedTokenOver2047Utf8BytesCount).toBeGreaterThan(0);
    expect(result.maxNormalizedTokenCharacters).toBeGreaterThan(96);
    expect(result.maxUtf8Bytes.normalizedToken).toBeGreaterThan(2_047);
    expect(() => assertFullCorpusProductionCompatibility(result)).toThrow(
      'full_corpus_production_compatibility_postgres_limit_exceeded',
    );
  });

  it('reports overlong query/lexeme tokens as explicit nonfatal risk telemetry', () => {
    const result = receipt([node(1, { title: 'x'.repeat(2_048) })]);
    expect(result.counters).toMatchObject({
      titleNormOverLimitCount: 0,
      normalizedTokenOver96CharactersCount: 1,
      normalizedTokenOver2047Utf8BytesCount: 1,
    });
    expect(result.compatible).toBe(true);
    expect(() => assertFullCorpusProductionCompatibility(result)).not.toThrow();
  });

  it('fails closed when the checked-node count does not match the immutable universe binding', () => {
    const nodes = [node(1)];
    const result = buildFullCorpusProductionCompatibilityReceipt({
      universe: binding(2),
      orchestrationRequest,
      nodes,
    });
    expect(result.counters.totalNodesChecked).toBe(1);
    expect(result.compatible).toBe(false);
    expect(() => assertFullCorpusProductionCompatibility(result)).toThrow(
      'full_corpus_production_compatibility_universe_count_mismatch',
    );
  });

  it('rejects a noncanonical timestamp and any receipt counter tampering', () => {
    const invalidTimestamp = node(1);
    invalidTimestamp.eventTimestamp = '2026-02-30T00:00:00.000Z';
    const invalid = receipt([invalidTimestamp]);
    expect(invalid.counters.invalidEventTimestampCount).toBe(1);
    expect(() => assertFullCorpusProductionCompatibility(invalid)).toThrow(
      'full_corpus_production_compatibility_event_timestamp_invalid',
    );

    const valid = receipt([node(2)]);
    const tampered = {
      ...valid,
      counters: { ...valid.counters, totalNodesChecked: 2 },
    };
    expect(() => assertFullCorpusProductionCompatibility(tampered)).toThrow(
      'full_corpus_production_compatibility_receipt_digest_mismatch',
    );
  });

  it('accepts only the canonical PostgreSQL UTC year 0001 through 9999 timestamp domain', () => {
    for (const eventTimestamp of [
      '0001-01-01T00:00:00.000Z',
      '9999-12-31T23:59:59.999999Z',
    ]) {
      const valid = receipt([node(1, { eventTimestamp })]);
      expect(valid.counters.invalidEventTimestampCount).toBe(0);
      expect(() => assertFullCorpusProductionCompatibility(valid)).not.toThrow();
    }
    for (const eventTimestamp of [
      '0000-01-01T00:00:00.000Z',
      '-000001-01-01T00:00:00.000Z',
      '+010000-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.00Z',
      '2026-01-01T00:00:00.1234567Z',
      '9999-12-31T23:59:59.9999995Z',
      '9999-12-31T23:59:59.999999999Z',
      '2026-01-01T00:00:00.1234567890Z',
    ]) {
      const invalid = node(2);
      invalid.eventTimestamp = eventTimestamp;
      const result = receipt([invalid]);
      expect(result.counters.invalidEventTimestampCount).toBe(1);
      expect(() => assertFullCorpusProductionCompatibility(result)).toThrow(
        'full_corpus_production_compatibility_event_timestamp_invalid',
      );
    }
  });

  it('archives once, verifies read-after-write and replays idempotently at the canonical request-bound key', async () => {
    const storage = memoryStorage();
    const value = receipt([node(1)]);
    const first = await writeFullCorpusProductionCompatibilityReceipt({ storage, receipt: value });
    const second = await writeFullCorpusProductionCompatibilityReceipt({ storage, receipt: value });

    expect(first.status).toBe('written');
    expect(second).toEqual({ ...first, status: 'reused' });
    expect(first.pointer).toMatchObject({
      corpusVersion: value.corpusVersion,
      snapshotId: value.universe.snapshotId,
      orchestrationRequestSchemaVersion: orchestrationRequest.schemaVersion,
      orchestrationRequestDigest: orchestrationRequest.requestDigest,
      receiptDigest: value.receiptDigest,
    });
    expect(first.pointer.archiveKey).toBe(
      `case-vortex/corpora/${value.corpusVersion}`
      + '/production-compatibility/full-corpus-production-compatibility-archive-v1'
      + `/snapshots/${value.universe.snapshotId}`
      + `/orchestrations/${orchestrationRequest.schemaVersion}`
      + `/${orchestrationRequest.requestDigest}/_complete.receipt.json`,
    );
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.get(first.pointer.archiveKey)?.body.length).toBe(first.pointer.bodyBytes);
    expect(decodeFullCorpusProductionCompatibilityPointer(first.pointer, {
      corpusVersion: value.corpusVersion,
      snapshotId: value.universe.snapshotId,
    })).toEqual(first.pointer);
    await expect(readVerifiedFullCorpusProductionCompatibilityReceipt({
      storage,
      pointer: first.pointer,
      expected: { corpusVersion: value.corpusVersion, snapshotId: value.universe.snapshotId },
    })).resolves.toMatchObject({ receipt: value, pointer: first.pointer });
  });

  it('rejects a rebound pointer and tampered archived bytes during publication replay', async () => {
    const storage = memoryStorage();
    const value = receipt([node(1)]);
    const written = await writeFullCorpusProductionCompatibilityReceipt({ storage, receipt: value });
    expect(() => decodeFullCorpusProductionCompatibilityPointer({
      ...written.pointer,
      orchestrationRequestDigest: 'f'.repeat(64),
    })).toThrow('full_corpus_production_compatibility_pointer_binding_mismatch');

    const stored = storage.objects.get(written.pointer.archiveKey);
    if (!stored) throw new Error('compatibility_test_archive_missing');
    stored.body = Buffer.from(`${stored.body.toString('utf8').trim()} `, 'utf8');
    await expect(readVerifiedFullCorpusProductionCompatibilityReceipt({
      storage,
      pointer: written.pointer,
    })).rejects.toThrow('full_corpus_production_compatibility_archive_pointer_mismatch');
  });

  it('fails closed on an immutable-key conflict or corrupt read-after-write bytes', async () => {
    const value = receipt([node(1)]);
    const expected = buildFullCorpusProductionCompatibilityArchive(value);
    const conflict = memoryStorage();
    conflict.objects.set(expected.pointer.archiveKey, {
      body: Buffer.from('{}\n', 'utf8'),
      version: 'conflict-1',
    });
    await expect(writeFullCorpusProductionCompatibilityReceipt({
      storage: conflict,
      receipt: value,
    })).rejects.toThrow('full_corpus_production_compatibility_archive_immutable_conflict');

    await expect(writeFullCorpusProductionCompatibilityReceipt({
      storage: memoryStorage(true),
      receipt: value,
    })).rejects.toThrow('full_corpus_production_compatibility_archive_read_after_write_mismatch');

    const alternateContract = structuredClone(value);
    (alternateContract.searchContract as { projectionVersion: string }).projectionVersion =
      'alternate-search-projection-v1';
    const { receiptDigest: _oldDigest, ...alternateWithoutDigest } = alternateContract;
    alternateContract.receiptDigest = relationshipInputSha256(alternateWithoutDigest);
    expect(() => buildFullCorpusProductionCompatibilityArchive(alternateContract)).toThrow(
      'full_corpus_production_compatibility_receipt_invalid',
    );
  });
});
