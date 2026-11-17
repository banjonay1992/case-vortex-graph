import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from '../../src/caseGraph/archiveTypes';
import { canonicalizeRelationshipInput } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildFullCorpusTypedOrchestrationRequest,
  decodeFullCorpusTypedOrchestrationRequest,
  encodeFullCorpusTypedOrchestrationRequest,
  getFullCorpusTypedGraphInputBinding,
  preflightFullCorpusTypedOrchestrationRequest,
  runFullCorpusTypedGraphFromArchiveRequest,
  runFullCorpusTypedPublicationFromArchiveRequest,
  type FullCorpusTypedObjectReference,
} from '../../src/caseGraph/fullCorpusTypedOrchestration';
import {
  buildPublicationV2Fixture,
  publicationCorpusVersion,
} from './publicationV2TestSupport';

const REQUEST_KEY = 'case-vortex/requests/publication-v2-fixture.json';
const ACCOUNTING_BINDING_KEY = 'case-vortex/requests/publication-v2-accounting-binding.json';
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const reference = (key: string, objects: Map<string, Buffer>): FullCorpusTypedObjectReference => {
  const body = objects.get(key);
  if (!body) throw new Error(`orchestration_test_reference_missing:${key}`);
  return { key, sha256: sha256(body) };
};

const removeGeneratedOutputs = (fixture: ReturnType<typeof buildPublicationV2Fixture>) => {
  const objects = fixture.objects;
  objects.delete(fixture.keys.manifestKey);
  objects.delete(fixture.keys.completionKey);
  objects.delete(fixture.productionCompatibility.pointer.archiveKey);
  objects.delete(fixture.densityArchive.pointer.archiveKey);
  for (const artifact of [...fixture.relationship.artifacts, fixture.relationship.indexArtifact]) {
    objects.delete(artifact.receipt.archiveKey);
    objects.delete(artifact.receipt.receiptKey);
  }
  for (const artifact of [...fixture.publicGraphShardArchives, fixture.publicGraphManifestArchive]) {
    objects.delete(artifact.receipt.archiveKey);
    objects.delete(artifact.receipt.receiptKey);
  }
  return objects;
};

const buildRequest = (
  fixture: ReturnType<typeof buildPublicationV2Fixture>,
  publication: boolean,
) => {
  const objects = removeGeneratedOutputs(fixture);
  const accountingBindingBody = Buffer.from(
    `${canonicalizeRelationshipInput(fixture.manifest.accountingBinding)}\n`,
    'utf8',
  );
  objects.set(ACCOUNTING_BINDING_KEY, accountingBindingBody);
  const request = buildFullCorpusTypedOrchestrationRequest({
    corpusVersion: publicationCorpusVersion,
    calibration: {
      humanReviewBundle: reference(fixture.keys.humanReviewBundleKey, objects),
      pairReceipt: reference(fixture.keys.pairCalibrationReceiptKey, objects),
      pairArtifact: reference(fixture.keys.pairCalibrationArtifactKey, objects),
      pairTrustPolicy: reference(fixture.keys.pairCalibrationTrustPolicyKey, objects),
      contextualReceipt: reference(fixture.keys.contextualCalibrationReceiptKey, objects),
      contextualArtifact: reference(fixture.keys.contextualCalibrationArtifactKey, objects),
      contextualTrustPolicy: reference(fixture.keys.contextualCalibrationTrustPolicyKey, objects),
    },
    contextualRelationshipCompletion: reference(
      fixture.keys.contextualRelationshipCompletionKey,
      objects,
    ),
    topology: {
      postingShardCount: 1,
      pairShardCount: 1,
      addressLedgerShardCount: 1,
      renderShardCount: 1,
      nodeShardCount: 1,
      edgeShardCount: 1,
      evaluationShardCount: 1,
      egoShardCount: 1,
      maxPostingsPerRecord: 512,
      maxCandidatePairsPerPairShard: 1_000_000,
      postingCaps: {
        addressIdentity: 1,
        sourceIdentity: 1_000,
        sourceRecord: 1,
        sourceLineage: 1,
        duplicateCluster: 1,
        matchableValue: 1,
        spaceTime: 1,
        duration: 1,
        maxPairsPerGroup: 1_000,
        maxCandidatePairsPerPostingShard: 1_000,
      },
    },
    publication: publication ? {
      generatedAt: fixture.manifest.generatedAt,
      accountingBinding: reference(ACCOUNTING_BINDING_KEY, objects),
      accountingReceipt: reference(fixture.keys.accountingReceiptKey, objects),
    } : null,
  });
  objects.set(REQUEST_KEY, encodeFullCorpusTypedOrchestrationRequest(request));
  return { request, objects };
};

const memoryStorage = (source: Map<string, Buffer>): CaseGraphConditionalArchiveStorage & {
  objects: Map<string, CaseGraphVersionedArchiveObject>;
} => {
  let sequence = 0;
  const objects = new Map<string, CaseGraphVersionedArchiveObject>([...source].map(([key, body]) => [
    key,
    { body: Buffer.from(body), version: `seed-${sequence += 1}` },
  ]));
  const store = (key: string, body: Buffer) => {
    const value = { body: Buffer.from(body), version: `write-${sequence += 1}` };
    objects.set(key, value);
    return value;
  };
  return {
    objects,
    readObject: async (key) => objects.get(key)?.body || null,
    readObjectVersioned: async (key) => objects.get(key) || null,
    uploadFile: async () => { throw new Error('orchestration_unconditional_write_forbidden'); },
    uploadFileConditional: async (body, key, _options, condition) => {
      const current = objects.get(key);
      if ('ifAbsent' in condition) {
        if (current) return { status: 'precondition_failed' };
      } else if (!current || current.version !== condition.ifVersion) {
        return { status: 'precondition_failed' };
      }
      const stored = store(key, body);
      return { status: 'written', key, version: stored.version };
    },
  };
};

describe('production full-corpus typed orchestration', () => {
  beforeAll(() => {
    buildPublicationV2Fixture();
  }, 240_000);

  it('canonicalizes the pinned request and rejects any referenced-byte substitution before graph writes', async () => {
    const fixture = buildPublicationV2Fixture();
    const { request, objects } = buildRequest(fixture, false);
    const body = encodeFullCorpusTypedOrchestrationRequest(request);
    expect(decodeFullCorpusTypedOrchestrationRequest(body)).toEqual(request);

    const storage = memoryStorage(objects);
    const pairReceipt = storage.objects.get(fixture.keys.pairCalibrationReceiptKey);
    if (!pairReceipt) throw new Error('orchestration_test_pair_receipt_missing');
    pairReceipt.body = Buffer.from(`${pairReceipt.body.toString('utf8').trim()} `, 'utf8');
    const writesBefore = storage.objects.size;
    await expect(runFullCorpusTypedGraphFromArchiveRequest({
      storage,
      requestKey: REQUEST_KEY,
      expectedCorpusVersion: publicationCorpusVersion,
    })).rejects.toThrow('full_corpus_typed_orchestration_referenced_object_digest_mismatch');
    expect(storage.objects.size).toBe(writesBefore);
  });

  it('preflights every graph and publication input without writing an object', async () => {
    const fixture = buildPublicationV2Fixture();
    const { request, objects } = buildRequest(fixture, true);
    const storage = memoryStorage(objects);
    const writesBefore = storage.objects.size;

    const result = await preflightFullCorpusTypedOrchestrationRequest({
      storage,
      requestKey: REQUEST_KEY,
      expectedCorpusVersion: publicationCorpusVersion,
    });

    expect(result).toMatchObject({
      status: 'verified',
      writeEnabled: false,
      corpusVersion: publicationCorpusVersion,
      requestDigest: request.requestDigest,
      graphInputBinding: getFullCorpusTypedGraphInputBinding(request),
      universe: {
        recordCount: fixture.relationship.completion.universeRecordCount,
        productionCompatibility: { compatible: true },
      },
      relationshipInput: {
        recordCount: fixture.relationship.completion.universeRecordCount,
      },
      calibration: {
        humanReviewBundleDigest: fixture.calibration.bundle.bundleDigest,
        humanReviewEvidenceSetSha256: fixture.calibration.bundle.evidenceSetSha256,
        humanReviewPackDigest: fixture.calibration.bundle.pack.packDigest,
        humanReviewAdjudicationDigest: fixture.calibration.bundle.adjudication.adjudicationDigest,
      },
      contextualRelationshipCompletion: {
        completionDigest: fixture.contextualCompletion.artifact.completionDigest,
      },
      publication: {
        generatedAt: fixture.manifest.generatedAt,
        accountingReceiptSha256: request.publication?.accountingReceipt.sha256,
      },
    });
    expect(storage.objects.size).toBe(writesBefore);
    expect(storage.objects.has(fixture.keys.manifestKey)).toBe(false);

    const pairReceipt = storage.objects.get(fixture.keys.pairCalibrationReceiptKey);
    if (!pairReceipt) throw new Error('orchestration_test_pair_receipt_missing');
    pairReceipt.body = Buffer.from(`${pairReceipt.body.toString('utf8').trim()} `, 'utf8');
    await expect(preflightFullCorpusTypedOrchestrationRequest({
      storage,
      requestKey: REQUEST_KEY,
      expectedCorpusVersion: publicationCorpusVersion,
    })).rejects.toThrow('full_corpus_typed_orchestration_referenced_object_digest_mismatch');
    expect(storage.objects.size).toBe(writesBefore);
  }, 60_000);

  it('rejects a corpus version outside the shared PostgreSQL/storage key domain', () => {
    const fixture = buildPublicationV2Fixture();
    const { request } = buildRequest(fixture, false);
    expect(() => buildFullCorpusTypedOrchestrationRequest({
      corpusVersion: 'unsafe/version',
      calibration: request.calibration,
      contextualRelationshipCompletion: request.contextualRelationshipCompletion,
      topology: request.topology,
      publication: request.publication,
    })).toThrow('full_corpus_typed_orchestration_request_invalid');
  });

  it('rejects substituted accounting bytes before the publication path writes graph artifacts', async () => {
    const fixture = buildPublicationV2Fixture();
    const { objects } = buildRequest(fixture, true);
    const storage = memoryStorage(objects);
    const accounting = storage.objects.get(fixture.keys.accountingReceiptKey);
    if (!accounting) throw new Error('orchestration_test_accounting_receipt_missing');
    accounting.body = Buffer.from(`${accounting.body.toString('utf8').trim()} `, 'utf8');
    const writesBefore = storage.objects.size;
    await expect(runFullCorpusTypedPublicationFromArchiveRequest({
      storage,
      requestKey: REQUEST_KEY,
      expectedCorpusVersion: publicationCorpusVersion,
    })).rejects.toThrow('full_corpus_typed_orchestration_referenced_object_digest_mismatch');
    expect(storage.objects.size).toBe(writesBefore);
  });

  it('builds and archives the unified 13-type graph from the canonical corpus inputs', async () => {
    const fixture = buildPublicationV2Fixture();
    const { request, objects } = buildRequest(fixture, false);
    const storage = memoryStorage(objects);
    const first = await runFullCorpusTypedGraphFromArchiveRequest({
      storage,
      requestKey: REQUEST_KEY,
      expectedCorpusVersion: publicationCorpusVersion,
    });
    expect(first.relationshipRun).toEqual(fixture.relationship.pointer);
    expect(first.publicGraph).toMatchObject({
      manifestDigest: fixture.publicGraph.manifest.manifestDigest,
      shardSetSha256: fixture.publicGraph.manifest.shardSetSha256,
      shardCount: fixture.publicGraph.manifest.shards.length,
    });
    expect(first.density).toEqual(fixture.densityArchive.pointer);
    expect(first.accounting).toMatchObject({
      universeRecordCount: fixture.relationship.completion.universeRecordCount,
      typedEdgeCount: fixture.relationship.completion.typedEdgeCount,
      contextualAcceptedEdgeCount:
        fixture.relationship.completion.contextualCompletion.acceptedEdgeCount,
      contextualInsufficientEvidenceCount:
        fixture.relationship.completion.contextualCompletion.insufficientEvidenceCount,
    });
    expect(first.accounting.productionCompatibility).toMatchObject({
      corpusVersion: publicationCorpusVersion,
      orchestrationRequest: getFullCorpusTypedGraphInputBinding(request),
      compatible: true,
      counters: {
        totalNodesChecked: fixture.relationship.completion.universeRecordCount,
        nonAsciiAddressCount: 0,
        nulAddressCount: 0,
        controlAddressCount: 0,
        nonPrintableAddressCount: 0,
        invalidSourceKeyCount: 0,
      },
    });
    expect(first.accounting.productionCompatibility.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.accounting.productionCompatibilityPointer).toMatchObject({
      corpusVersion: publicationCorpusVersion,
      snapshotId: fixture.relationship.completion.lineage.binding.snapshotId,
      orchestrationRequestDigest: getFullCorpusTypedGraphInputBinding(request).requestDigest,
      receiptDigest: first.accounting.productionCompatibility.receiptDigest,
    });
    expect(first.accounting.productionCompatibilityPointer.archiveKey)
      .toContain(`/orchestrations/${getFullCorpusTypedGraphInputBinding(request).schemaVersion}/${getFullCorpusTypedGraphInputBinding(request).requestDigest}/`);
    expect(first.writes.relationship.written).toBeGreaterThan(0);
    expect(first.writes.publicGraph.written).toBeGreaterThan(0);
    expect(first.writes.density).toBe('written');
    expect(first.writes.productionCompatibility).toBe('written');
  }, 240_000);

  it('hands the exact graph, calibration and accounting lineage into the publication transaction', async () => {
    const fixture = buildPublicationV2Fixture();
    const { objects } = buildRequest(fixture, true);
    const storage = memoryStorage(objects);
    const result = await runFullCorpusTypedPublicationFromArchiveRequest({
      storage,
      requestKey: REQUEST_KEY,
      expectedCorpusVersion: publicationCorpusVersion,
    });
    expect(result.graph.relationshipRun).toEqual(fixture.relationship.pointer);
    expect(result.publication.status).toBe('complete');
    expect(result.publication.manifest).toEqual(fixture.manifest);
    expect(result.publication.completion).toEqual(fixture.completion);
    expect(storage.objects.get(fixture.keys.manifestKey)?.body).toEqual(fixture.manifestBody);
    expect(storage.objects.get(fixture.keys.completionKey)?.body).toEqual(fixture.completionBody);
  }, 240_000);

  it('requires the accounting phase explicitly instead of publishing a graph-only request', async () => {
    const fixture = buildPublicationV2Fixture();
    const { request, objects } = buildRequest(fixture, false);
    expect(request.publication).toBeNull();
    const storage = memoryStorage(objects);
    await expect(runFullCorpusTypedPublicationFromArchiveRequest({
      storage,
      requestKey: REQUEST_KEY,
    })).rejects.toThrow('full_corpus_typed_orchestration_publication_inputs_required');
    expect(storage.objects.has(fixture.keys.manifestKey)).toBe(false);
  });

  it('fails closed on a noncanonical request body even when its decoded values are valid', () => {
    const fixture = buildPublicationV2Fixture();
    const { request } = buildRequest(fixture, false);
    const noncanonical = Buffer.from(JSON.stringify(request, null, 2), 'utf8');
    expect(() => decodeFullCorpusTypedOrchestrationRequest(noncanonical)).toThrow(
      'full_corpus_typed_orchestration_request_noncanonical',
    );
  });
});
