import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { canonicalizeRelationshipInput, relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildCaseGraphContentPostgresProjection,
  createPostgresCaseGraphContentBuildStore,
  decodeCaseGraphContentPostgresCompletionReceipt,
  encodeCaseGraphContentPostgresCompletionReceipt,
  makeCaseGraphContentPostgresCompletionReceipt,
  preflightCaseGraphContentPostgresProjection,
  verifyCaseGraphContentPostgresCompletionReceipt,
  type CaseGraphContentPostgresBuildClient,
} from '../../src/caseGraph/contentResearchPostgresBuild';
import { CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION } from '../../src/caseGraph/contentResearchSearchIndex';
import { CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION } from '../../src/caseGraph/contentResearchSearchIndexArchive';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';
import { prepareCaseGraphContentResearchServing } from '../../src/caseGraph/contentResearchServing';
import type { ActiveCaseGraphPublication } from '../../src/caseGraph/publicAccess';
import type {
  CaseGraphContentPostgresQuery,
  CaseGraphContentServingBinding,
} from '../../src/caseGraph/postgresContentResearchSearch';

const d = (value: string) => value.repeat(64);
const bytes = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const sha = (value: unknown) => createHash('sha256').update(bytes(value)).digest('hex');
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'v1', manifestSha256: d('1'),
  snapshotId: 'snapshot', graphArtifactSetSha256: d('2'), relationshipSchemaVersion: 'schema-v1',
  relationshipPolicyVersion: 'policy-v1', relationshipPolicySha256: d('3'), relationshipModelId: 'model',
  relationshipModelVersion: 'model-v1', relationshipModelSha256: d('4'), calibrationSetSha256: d('5'),
};

const fixture = () => {
  const entryCore = {
    entryId: `content-search-entry:${d('6')}`, publication,
    address: 'document:00000000-0000-4000-8000-000000000010', nodeDigest: d('7'),
    assetId: `content-asset:${d('8')}`, assetDigest: d('9'), extractionContractDigest: d('a'),
    extractionReceiptDigest: d('b'), extractionPointerDigest: d('c'), chunksObjectKey: 'chunks.json',
    chunksObjectSha256: d('d'), chunkId: `content-chunk:${d('e')}`, chunkDigest: d('f'),
    mediaKind: 'document' as const, textOrigin: 'embedded_text' as const,
    locator: { locatorType: 'document_page' as const, pageNumber: 1, characterStart: 0,
      characterEnd: 13, readingOrder: 0, boundingBox: null },
    text: 'Roswell memo.', language: 'en', confidence: null, visibility: 'public' as const,
    authorizationScope: 'exact_verified_publication_public_content' as const, untrustedText: true as const,
  };
  const entry = { ...entryCore, entryDigest: relationshipInputSha256(entryCore) };
  const shardCore = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION, shardNumber: 0, entryCount: 1,
    entrySetSha256: relationshipInputSha256([{ entryId: entry.entryId, entryDigest: entry.entryDigest }]),
    entries: [entry],
  };
  const shard = { ...shardCore, shardDigest: relationshipInputSha256(shardCore) };
  const summaries = [{ shardNumber: 0, entryCount: 1, shardDigest: shard.shardDigest }];
  const manifestCore = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION, publication, accountingReceiptDigest: d('0'),
    entryCount: 1, entrySetSha256: shard.entrySetSha256, shardCount: 1,
    shardSetSha256: relationshipInputSha256(summaries), shards: summaries,
    authorizationScope: 'exact_verified_publication_public_content' as const,
  };
  const manifest = { ...manifestCore, manifestDigest: relationshipInputSha256(manifestCore) };
  const prefix = `case-vortex/content-search/${publication.manifestSha256}/${CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION}/${manifest.manifestDigest}`;
  const pointerCore = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION,
    publicationManifestSha256: publication.manifestSha256, indexManifestDigest: manifest.manifestDigest,
    manifestObjectKey: `${prefix}/manifest.json`, manifestObjectSha256: sha(manifest), shardCount: 1, entryCount: 1,
    shardObjects: [{ shardNumber: 0, objectKey: `${prefix}/shards/000000.json`,
      objectSha256: sha(shard), shardDigest: shard.shardDigest }],
  };
  const pointer = { ...pointerCore, pointerDigest: relationshipInputSha256(pointerCore) };
  return { entry, shard, shards: [shard], manifest, pointer };
};

const archive = (corrupt = false, sharedEvents?: string[]) => {
  const source = fixture();
  const objects = new Map<string, Buffer>();
  objects.set(source.pointer.manifestObjectKey, bytes(source.manifest));
  objects.set(source.pointer.shardObjects[0].objectKey, bytes(source.shard));
  const events: string[] = [];
  const value: CaseGraphContentImmutableArchive = {
    putIfAbsent: vi.fn(async ({ key, body }) => {
      events.push('archive-put');
      sharedEvents?.push('receipt-put');
      if (!objects.has(key)) objects.set(key, Buffer.from(body));
      return objects.has(key) ? 'exists' as const : 'written' as const;
    }),
    readObject: vi.fn(async (key) => {
      const completion = key.includes('/content-search-postgres/');
      events.push(completion ? 'receipt-read' : 'source-read');
      sharedEvents?.push(completion ? 'receipt-read' : 'source-read');
      return corrupt && completion ? Buffer.from('corrupt') : objects.get(key) || null;
    }),
  };
  return { value, objects, events };
};

const database = (resume = false, sharedEvents?: string[]) => {
  const { entry, shard, pointer } = fixture();
  const events: string[] = [];
  const query = vi.fn<CaseGraphContentPostgresQuery>(async (sql) => {
    if (sql.includes('create_case_graph_content_search_build')) {
      events.push('acquire');
      return { rows: [{ lease_token: '00000000-0000-4000-8000-000000000099', leased_until: '2026-07-19T12:00:00Z' }] };
    }
    if (sql.includes('renew_case_graph_content_search_build')) {
      events.push('renew'); return { rows: [{ leased_until: '2026-07-19T12:00:00Z' }] };
    }
    if (sql.includes('SELECT source.*')) {
      events.push('find');
      return { rows: resume ? [{ shard_digest: shard.shardDigest, source_object_sha256: pointer.shardObjects[0].objectSha256,
        entry_set_sha256: shard.entrySetSha256, entry_count: 1 }] : [] };
    }
    if (sql.includes('ingest_case_graph_content_search_shard')) {
      events.push('ingest'); return { rows: [{ ingested_count: 1 }] };
    }
    if (sql.includes('SELECT chunk.chunk_id')) {
      events.push('inspect-entries'); return { rows: [{ chunk_id: entry.chunkId, entry_id: entry.entryId, entry_digest: entry.entryDigest }] };
    }
    if (sql.includes('SELECT shard_number')) {
      events.push('inspect-shards'); return { rows: [{ shard_number: 0, shard_digest: shard.shardDigest,
        source_object_sha256: pointer.shardObjects[0].objectSha256, entry_set_sha256: shard.entrySetSha256,
        entry_count: 1 }] };
    }
    if (sql.includes('verify_case_graph_content_search_build')) {
      events.push('verify'); sharedEvents?.push('verify'); return { rows: [{ verified: null }] };
    }
    if (sql.includes('fail_case_graph_content_search_build')) {
      events.push('fail'); return { rows: [{ failed: null }] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { client: { query } satisfies CaseGraphContentPostgresBuildClient, query, events };
};

const preflightFixture = (overrides: Record<string, unknown> = {}) => {
  const data = fixture();
  const receipt = makeCaseGraphContentPostgresCompletionReceipt({
    ...data, dbEntrySetSha256: data.manifest.entrySetSha256,
  });
  const body = encodeCaseGraphContentPostgresCompletionReceipt(receipt);
  const receiptKey = [
    'case-vortex/content-search-postgres', publication.manifestSha256,
    data.manifest.manifestDigest, 'case-graph-content-postgres-build-v1',
    `${receipt.receiptDigest}.json`,
  ].join('/');
  const receiptSha256 = createHash('sha256').update(body).digest('hex');
  const row = {
    public_manifest_sha256: publication.manifestSha256,
    accounting_receipt_digest: data.manifest.accountingReceiptDigest,
    index_manifest_digest: data.manifest.manifestDigest,
    expected_entry_count: 1,
    expected_shard_count: 1,
    expected_entry_set_sha256: data.manifest.entrySetSha256,
    expected_shard_set_sha256: data.manifest.shardSetSha256,
    indexed_entry_count: 1,
    indexed_shard_count: 1,
    db_entry_set_sha256: data.manifest.entrySetSha256,
    completion_receipt_key: receiptKey,
    completion_receipt_sha256: receiptSha256,
    ...overrides,
  };
  const query = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [row] }));
  const readObject = vi.fn(async () => body);
  const storage: CaseGraphContentImmutableArchive = {
    putIfAbsent: vi.fn(async () => 'exists' as const),
    readObject,
  };
  const binding: CaseGraphContentServingBinding = {
    publication,
    accountingReceiptDigest: data.manifest.accountingReceiptDigest,
    indexManifestDigest: data.manifest.manifestDigest,
    expectedEntryCount: 1,
  };
  return { data, receipt, body, receiptKey, receiptSha256, row, query, readObject, storage, binding };
};

describe('crash-safe PostgreSQL extracted-content build and completion receipt', () => {
  it('ingests exact snake-case shard bytes, archives the receipt, then and only then verifies', async () => {
    const data = fixture();
    const order: string[] = [];
    const db = database(false, order);
    const storage = archive(false, order);
    const result = await buildCaseGraphContentPostgresProjection({
      client: db.client, ...data, archive: storage.value,
    });
    expect(result.receipt).toMatchObject({
      recordType: 'case_graph_content_postgres_completion_receipt', entryCount: 1, shardCount: 1,
      dbEntrySetSha256: data.manifest.entrySetSha256,
      indexArchivePointerDigest: data.pointer.pointerDigest,
    });
    const ingest = db.query.mock.calls.find(([sql]) => sql.includes('ingest_case_graph_content_search_shard'));
    const payload = JSON.parse(String(ingest?.[1][6]));
    expect(Object.keys(payload[0]).sort()).toEqual([
      'address', 'asset_digest', 'asset_id', 'chunk_digest', 'chunk_id', 'chunks_object_key',
      'chunks_object_sha256', 'confidence', 'entry_digest', 'entry_id', 'extraction_contract_digest',
      'extraction_pointer_digest', 'extraction_receipt_digest', 'language', 'locator', 'media_kind',
      'node_digest', 'text', 'text_origin',
    ].sort());
    expect(result.receipt.sourceShards[0].sourceObjectSha256).toBe(data.pointer.shardObjects[0].objectSha256);
    expect(storage.objects.get(result.receiptKey)).toEqual(encodeCaseGraphContentPostgresCompletionReceipt(result.receipt));
    expect(order).toEqual(['source-read', 'source-read', 'receipt-put', 'receipt-read', 'verify']);
    expect(storage.events).toEqual(['source-read', 'source-read', 'archive-put', 'receipt-read']);
    expect(db.events.at(-1)).toBe('verify');
    const verifyCall = db.query.mock.calls.find(([sql]) => sql.includes('verify_case_graph_content_search_build'));
    expect(verifyCall?.[1].slice(2)).toEqual([
      data.manifest.entrySetSha256, data.manifest.shardSetSha256, data.manifest.entrySetSha256,
      result.receiptKey, result.receiptSha256,
    ]);
  });

  it('resumes an expired build by accepting only an exact already-ingested shard', async () => {
    const data = fixture();
    const db = database(true);
    const storage = archive();
    await buildCaseGraphContentPostgresProjection({ client: db.client, ...data, archive: storage.value });
    expect(db.events).toContain('find');
    expect(db.events).not.toContain('ingest');
    expect(db.events.at(-1)).toBe('verify');
  });

  it('never exposes the database build if immutable receipt read-after-write fails', async () => {
    const data = fixture();
    const db = database();
    await expect(buildCaseGraphContentPostgresProjection({
      client: db.client, ...data, archive: archive(true).value,
    })).rejects.toThrow('case_graph_content_postgres_completion_read_after_write_mismatch');
    expect(db.events).not.toContain('verify');
  });

  it('does not even acquire a database lease when an authoritative source shard is missing', async () => {
    const data = fixture();
    const db = database();
    const storage = archive();
    storage.objects.delete(data.pointer.shardObjects[0].objectKey);
    await expect(buildCaseGraphContentPostgresProjection({
      client: db.client, ...data, archive: storage.value,
    })).rejects.toThrow('case_graph_content_search_archive_source_read_mismatch');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects database projection drift before writing any receipt', async () => {
    const data = fixture();
    const db = database();
    db.query.mockImplementationOnce(db.query.getMockImplementation()!);
    const original = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, values, queryOptions) => {
      const result = await original(sql, values, queryOptions);
      if (sql.includes('SELECT chunk.chunk_id')) result.rows[0].entry_digest = d('0');
      return result;
    });
    const storage = archive();
    await expect(buildCaseGraphContentPostgresProjection({ client: db.client, ...data, archive: storage.value }))
      .rejects.toThrow('case_graph_content_postgres_projection_accounting_mismatch');
    expect(storage.events).toEqual(['source-read', 'source-read']);
    expect(db.events).not.toContain('verify');
  });

  it('makes deterministic, independently verifiable receipts and rejects tampering', () => {
    const data = fixture();
    const receipt = makeCaseGraphContentPostgresCompletionReceipt({
      ...data, dbEntrySetSha256: data.manifest.entrySetSha256,
    });
    expect(makeCaseGraphContentPostgresCompletionReceipt({
      ...data, dbEntrySetSha256: data.manifest.entrySetSha256,
    })).toEqual(receipt);
    expect(verifyCaseGraphContentPostgresCompletionReceipt({ value: receipt, ...data })).toEqual(receipt);
    expect(() => verifyCaseGraphContentPostgresCompletionReceipt({
      value: { ...receipt, rankingVersion: 'wrong' as typeof receipt.rankingVersion }, ...data,
    })).toThrow('case_graph_content_postgres_completion_receipt_invalid');
    expect(decodeCaseGraphContentPostgresCompletionReceipt(receipt)).toEqual(receipt);
    expect(() => decodeCaseGraphContentPostgresCompletionReceipt({
      ...receipt, publication: { ...receipt.publication, corpusVersion: '' },
    })).toThrow('case_graph_content_postgres_completion_receipt_invalid');
  });

  it('preflights only a canonical immutable receipt bound to the exact verified database build', async () => {
    const value = preflightFixture();
    await expect(preflightCaseGraphContentPostgresProjection({
      binding: value.binding, query: value.query, archive: value.storage,
    })).resolves.toMatchObject({
      verified: true, binding: value.binding, receiptKey: value.receiptKey,
      receiptSha256: value.receiptSha256, receipt: value.receipt,
    });
    expect(value.query).toHaveBeenCalledTimes(1);
    expect(value.query.mock.calls[0][1]).toEqual([
      publication.publicationId, publication.manifestSha256,
      value.data.manifest.accountingReceiptDigest, value.data.manifest.manifestDigest, 1,
    ]);
    expect(value.query.mock.calls[0][2]).toMatchObject({ statementTimeoutMs: 30_000, queryTimeoutMs: 30_000 });
    expect(value.readObject).toHaveBeenCalledWith(value.receiptKey,
      expect.objectContaining({ maxBytes: 4 * 1024 * 1024 }));
  });

  it('fails closed for receipt bytes, object-key, and verified database accounting drift', async () => {
    const corrupt = preflightFixture();
    corrupt.readObject.mockResolvedValue(Buffer.from('corrupt'));
    await expect(preflightCaseGraphContentPostgresProjection({
      binding: corrupt.binding, query: corrupt.query, archive: corrupt.storage,
    })).rejects.toThrow('case_graph_research_content_search_unavailable');

    const nonCanonical = preflightFixture();
    const pretty = Buffer.from(JSON.stringify(nonCanonical.receipt, null, 2), 'utf8');
    nonCanonical.readObject.mockResolvedValue(pretty);
    nonCanonical.row.completion_receipt_sha256 = createHash('sha256').update(pretty).digest('hex');
    await expect(preflightCaseGraphContentPostgresProjection({
      binding: nonCanonical.binding, query: nonCanonical.query, archive: nonCanonical.storage,
    })).rejects.toThrow('case_graph_research_content_search_unavailable');

    const wrongKey = preflightFixture({ completion_receipt_key: 'wrong/receipt.json' });
    await expect(preflightCaseGraphContentPostgresProjection({
      binding: wrongKey.binding, query: wrongKey.query, archive: wrongKey.storage,
    })).rejects.toThrow('case_graph_research_content_search_unavailable');

    const drift = preflightFixture({ indexed_entry_count: 0 });
    await expect(preflightCaseGraphContentPostgresProjection({
      binding: drift.binding, query: drift.query, archive: drift.storage,
    })).rejects.toThrow('case_graph_research_content_search_unavailable');
  });

  it('propagates preflight abort before database or archive access', async () => {
    const value = preflightFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(preflightCaseGraphContentPostgresProjection({
      binding: value.binding, query: value.query, archive: value.storage, signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
    expect(value.query).not.toHaveBeenCalled();
    expect(value.readObject).not.toHaveBeenCalled();
  });

  it('creates a request-scoped content provider only from the active publication verified build', async () => {
    const value = preflightFixture();
    const active = {
      publicationId: publication.publicationId,
      corpusVersion: publication.corpusVersion,
      manifestSha256: publication.manifestSha256,
      accountingReceiptSha256: value.data.manifest.accountingReceiptDigest,
      manifest: {
        lineage: {
          snapshot: { snapshotId: publication.snapshotId },
          graph: { artifactSetSha256: publication.graphArtifactSetSha256 },
          relationship: {
            policyVersion: publication.relationshipPolicyVersion,
            policySha256: publication.relationshipPolicySha256,
            modelId: publication.relationshipModelId,
            modelVersion: publication.relationshipModelVersion,
            modelSha256: publication.relationshipModelSha256,
          },
          calibration: { set: { calibrationSetSha256: publication.calibrationSetSha256 } },
        },
        models: { relationshipSchemaVersion: publication.relationshipSchemaVersion },
      },
    } as unknown as ActiveCaseGraphPublication;
    const query = vi.fn<CaseGraphContentPostgresQuery>(async (sql) => {
      if (sql.includes('LIMIT 2')) return { rows: [{
        accounting_receipt_digest: value.data.manifest.accountingReceiptDigest,
        index_manifest_digest: value.data.manifest.manifestDigest,
        expected_entry_count: 1,
      }] };
      return { rows: [value.row] };
    });
    const prepared = await prepareCaseGraphContentResearchServing({
      active,
      query,
      storage: { readObject: value.readObject },
      cursorSecret: 'content-provider-test-secret-is-long-enough',
    });
    expect(prepared).toMatchObject({ verified: true, binding: value.binding });
    expect(prepared.provider).toMatchObject({ search: expect.any(Function), open: expect.any(Function) });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual([
      publication.publicationId,
      publication.manifestSha256,
      value.data.manifest.accountingReceiptDigest,
    ]);
    expect(value.readObject).toHaveBeenCalledTimes(1);

    const duplicateBuilds = vi.fn<CaseGraphContentPostgresQuery>(async () => ({ rows: [{}, {}] }));
    await expect(prepareCaseGraphContentResearchServing({
      active,
      query: duplicateBuilds,
      storage: { readObject: value.readObject },
      cursorSecret: 'content-provider-test-secret-is-long-enough',
    })).rejects.toThrow('case_graph_research_content_search_unavailable');
  });

  it('propagates AbortSignal and supports explicit terminal failure with a bounded code', async () => {
    const db = database();
    const store = createPostgresCaseGraphContentBuildStore(db.client);
    const controller = new AbortController();
    controller.abort();
    await expect(store.acquire(fixture().manifest, 300, controller.signal)).rejects.toThrow('case_graph_research_aborted');
    expect(db.query).not.toHaveBeenCalled();
    await store.fail({ publicationId: publication.publicationId,
      leaseToken: '00000000-0000-4000-8000-000000000099' }, 'archive.integrity_failed');
    expect(db.events).toContain('fail');
    await expect(store.fail({ publicationId: publication.publicationId,
      leaseToken: '00000000-0000-4000-8000-000000000099' }, 'NOT SAFE'))
      .rejects.toThrow('case_graph_content_postgres_failure_code_invalid');
  });
});
