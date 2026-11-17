import { describe, expect, it } from 'vitest';

import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from '../../src/caseGraph/archiveTypes';
import {
  CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
  CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  contextualExplanationSha256,
} from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
  CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
  contextualRelationshipCalibrationReceiptSha256,
  getContextualRelationshipCalibrationReceiptId,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  buildContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionArtifact,
} from '../../src/caseGraph/contextualRelationshipCompletion';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
} from '../../src/caseGraph/relationshipInputArchive';
import {
  relationshipInputSha256,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import { buildTypedRelationshipRarityIndex } from '../../src/caseGraph/typedRelationshipEngine';
import {
  FULL_CORPUS_TYPED_EDGE_TYPES,
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
  buildFullCorpusRelationshipCompletion,
  fullCorpusRelationshipArtifactSha256,
  reduceFullCorpusCandidateShard,
  reduceFullCorpusPostingShard,
} from '../../src/caseGraph/typedRelationshipPipeline';
import {
  archiveFullCorpusRelationshipRun,
  buildFullCorpusRelationshipRunIndex,
  decodeFullCorpusRelationshipArchiveObject,
  decodeFullCorpusRelationshipRunIndex,
  decodeFullCorpusRelationshipRunIndexPointer,
  readVerifiedFullCorpusRelationshipArchiveObject,
} from '../../src/caseGraph/typedRelationshipPipelineArchive';
import {
  buildCanonicalContextualCompletionMixedFixture,
} from './contextualRelationshipCompletionTestSupport';
import {
  buildStructuralTestOnlyProductionContextualCompletion,
} from './contextualRelationshipProductionCompletionTestSupport';

const productionCalibrationReceipt = (seed: string): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = contextualExplanationSha256(`contextual-integration-core:${seed}`);
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: 'case-graph-contextual-relationship-calibration-v1',
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: 'production_gates_passed',
    calibrationCoreSha256,
    lineageSha256: contextualExplanationSha256(`contextual-integration-lineage:${seed}`),
    auditPlanSha256: contextualExplanationSha256(`contextual-integration-audit:${seed}`),
    trustPolicyDigest: contextualExplanationSha256(`contextual-integration-trust:${seed}`),
    evaluationSetSha256: contextualExplanationSha256(`contextual-integration-evaluations:${seed}`),
    labelSetSha256: contextualExplanationSha256(`contextual-integration-labels:${seed}`),
    metricsSha256: contextualExplanationSha256(`contextual-integration-metrics:${seed}`),
    gatePolicyVersion: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_VERSION,
    gatePolicySha256: CONTEXTUAL_RELATIONSHIP_CALIBRATION_GATE_POLICY_SHA256,
    evidenceClass: 'human_reviewed_locked_holdout',
    authorizationScope: 'production_candidate',
    calibratedEdgeType: 'contextual_explanation_candidate',
    claimDiscipline: CONTEXTUAL_EXPLANATION_CLAIM_DISCIPLINE,
  };
  return {
    ...withoutSha,
    receiptSha256: contextualRelationshipCalibrationReceiptSha256(withoutSha),
  };
};

const buildMixedPipeline = () => {
  const mixed = buildCanonicalContextualCompletionMixedFixture();
  const calibrationReceipt = productionCalibrationReceipt('mixed-pipeline');
  const expectedContextualCalibration = {
    receiptId: calibrationReceipt.receiptId,
    receiptSha256: calibrationReceipt.receiptSha256,
  };
  const contextualCompletion = buildContextualRelationshipCompletionArtifact({
    binding: mixed.binding,
    calibrationReceipt,
    sources: mixed.sources,
    entries: mixed.entryInputs,
  });
  const records = mixed.entryInputs.map((entry) => entry.relationshipRecord)
    .sort((left, right) => left.address < right.address ? -1 : 1);
  const part = buildRelationshipInputPart({
    binding: mixed.binding,
    partNumber: 0,
    records,
  });
  const manifest = buildRelationshipInputSnapshotManifest({
    binding: mixed.binding,
    parts: [part.manifest],
    generatedAt: '2026-07-18T01:00:00.000Z',
  });
  const rarityIndex = buildTypedRelationshipRarityIndex(records, mixed.binding);
  const postingShardCount = 2;
  const pairShardCount = 2;
  const postingFragments = buildFullCorpusPostingFragments({
    records,
    inputPartNumber: 0,
    relationshipInputManifest: manifest,
    rarityIndex,
    postingShardCount,
  });
  const postingMap = buildFullCorpusPostingMapManifest({
    relationshipInputManifest: manifest,
    rarityIndex,
    postingShardCount,
    fragments: postingFragments,
  });
  const postingReductions = Array.from({ length: postingShardCount }, (_, postingShard) => (
    reduceFullCorpusPostingShard({
      postingMap,
      fragments: postingFragments.filter((fragment) => fragment.postingShard === postingShard),
      postingShard,
      pairShardCount,
      caps: { matchableValue: 100, maxPairsPerGroup: 1_000 },
    })
  ));
  const candidateFragments = postingReductions.flatMap((reduction) => reduction.candidateFragments);
  const pairReducers = Array.from({ length: pairShardCount }, (_, pairShard) => (
    reduceFullCorpusCandidateShard({
      postingMap,
      rarityIndex,
      fragments: candidateFragments.filter((fragment) => fragment.pairShard === pairShard),
      pairShard,
      pairShardCount,
    })
  ));
  const completion = buildFullCorpusRelationshipCompletion({
    postingMap,
    postingReductions,
    pairReducers,
    contextualCompletion,
    expectedContextualCalibration,
    addressLedgerShardCount: 2,
  });
  return {
    mixed,
    calibrationReceipt,
    expectedContextualCalibration,
    contextualCompletion,
    records,
    postingFragments,
    postingMap,
    postingReductions,
    pairReducers,
    completion,
  };
};

const memoryStorage = (): CaseGraphConditionalArchiveStorage & {
  objects: Map<string, CaseGraphVersionedArchiveObject>;
} => {
  const objects = new Map<string, CaseGraphVersionedArchiveObject>();
  let version = 0;
  const put = (key: string, body: Buffer) => {
    const stored = { body: Buffer.from(body), version: `v${version += 1}` };
    objects.set(key, stored);
    return stored;
  };
  return {
    objects,
    readObject: async (key) => objects.get(key)?.body || null,
    readObjectVersioned: async (key) => objects.get(key) || null,
    uploadFile: async (body, key) => {
      put(key, body);
      return key;
    },
    uploadFileConditional: async (body, key, _options, condition) => {
      const current = objects.get(key);
      if ('ifAbsent' in condition) {
        if (current) return { status: 'precondition_failed' };
      } else if (!current || current.version !== condition.ifVersion) {
        return { status: 'precondition_failed' };
      }
      const stored = put(key, body);
      return { status: 'written', key, version: stored.version };
    },
  };
};

const buildCompletion = (
  pipeline: ReturnType<typeof buildMixedPipeline>,
  contextualCompletion: ContextualRelationshipCompletionArtifact,
  expectedContextualCalibration = pipeline.expectedContextualCalibration,
) => buildFullCorpusRelationshipCompletion({
  postingMap: pipeline.postingMap,
  postingReductions: pipeline.postingReductions,
  pairReducers: pipeline.pairReducers,
  contextualCompletion,
  expectedContextualCalibration,
  addressLedgerShardCount: 2,
});

describe('full-corpus contextual relationship integration', () => {
  it('merges accepted contextual edges, preserves insufficient receipts, and accounts all 13 edge types', () => {
    const pipeline = buildMixedPipeline();
    const accepted = pipeline.contextualCompletion.entries.find((entry) => entry.status === 'accepted_edge');
    const insufficient = pipeline.contextualCompletion.entries.find((entry) => entry.status === 'insufficient_evidence');
    if (!accepted || accepted.status !== 'accepted_edge' || !insufficient
      || insufficient.status !== 'insufficient_evidence') {
      throw new Error('contextual_integration_fixture_invalid');
    }

    expect(FULL_CORPUS_TYPED_EDGE_TYPES).toHaveLength(13);
    expect(Object.keys(pipeline.completion.typedEdgeTypeCounts).sort()).toEqual(
      [...FULL_CORPUS_TYPED_EDGE_TYPES].sort(),
    );
    expect(pipeline.completion.contextualCompletion).toMatchObject({
      completionId: pipeline.contextualCompletion.completionId,
      completionDigest: pipeline.contextualCompletion.completionDigest,
      artifactDigest: fullCorpusRelationshipArtifactSha256(pipeline.contextualCompletion),
      sourceCompletionSetSha256: pipeline.contextualCompletion.sourceCompletionSetSha256,
      entrySetSha256: pipeline.contextualCompletion.entrySetSha256,
      calibrationReceiptId: pipeline.calibrationReceipt.receiptId,
      calibrationReceiptSha256: pipeline.calibrationReceipt.receiptSha256,
      sourceRecordCount: 2,
      acceptedEdgeCount: 1,
      insufficientEvidenceCount: 1,
      zeroObservationState: false,
    });
    expect(pipeline.completion.typedEdgeTypeCounts.contextual_explanation_candidate).toBe(1);
    expect(insufficient.typedEdge).toBeNull();
    expect(insufficient.insufficientReceipt.decision).toBe('insufficient_evidence');
    expect(insufficient.insufficientReceipt.receiptId).toMatch(/^contextual-insufficient:/);
    const states = pipeline.completion.addressLedgerShards.flatMap((shard) => shard.states);
    expect(states.find((state) => state.address === accepted.address)?.status).toBe('linked');
    expect(pipeline.completion.evaluatedAddressCount).toBe(2);
    const expectedEdgeIds = [
      ...pipeline.pairReducers.flatMap((reducer) => reducer.edges.map((edge) => edge.edgeId)),
      accepted.typedEdge.edgeId,
    ].sort();
    expect(pipeline.completion.edgeSetSha256).toBe(
      relationshipInputSha256(expectedEdgeIds.join('\n')),
    );
    expect(pipeline.completion.typedEdgeCount).toBe(expectedEdgeIds.length);
  });

  it('archives one production contextual artifact and binds it through index and pointer decoders', async () => {
    const pipeline = buildMixedPipeline();
    const storage = memoryStorage();
    const archived = await archiveFullCorpusRelationshipRun({
      storage,
      postingFragments: pipeline.postingFragments,
      postingMap: pipeline.postingMap,
      postingReductions: pipeline.postingReductions,
      pairReducers: pipeline.pairReducers,
      contextualCompletion: pipeline.contextualCompletion,
      expectedContextualCalibration: pipeline.expectedContextualCalibration,
      completion: pipeline.completion,
    });

    expect(archived.index.objectTypeCounts.contextual_completion).toBe(1);
    expect(archived.index.contextualCompletion).toEqual(pipeline.completion.contextualCompletion);
    expect(archived.indexPointer.contextualCompletion).toEqual(pipeline.completion.contextualCompletion);
    expect(decodeFullCorpusRelationshipRunIndex(
      archived.indexArtifact.value,
      pipeline.postingMap.lineage,
    )).toEqual(archived.index);
    expect(decodeFullCorpusRelationshipRunIndexPointer(
      archived.indexPointer,
      pipeline.postingMap.lineage,
    )).toEqual(archived.indexPointer);

    const contextualEntry = archived.index.objects.find((entry) => (
      entry.artifactType === 'contextual_completion'
    ));
    if (!contextualEntry) throw new Error('contextual_archive_entry_missing');
    const readBack = await readVerifiedFullCorpusRelationshipArchiveObject<ContextualRelationshipCompletionArtifact>({
      storage,
      receiptKey: contextualEntry.receiptKey,
      expectedLineage: pipeline.postingMap.lineage,
      expectedContextualCompletion: pipeline.completion.contextualCompletion,
    });
    expect(readBack.value).toEqual(pipeline.contextualCompletion);
    expect(() => decodeFullCorpusRelationshipArchiveObject({
      archiveBody: storage.objects.get(contextualEntry.archiveKey)?.body as Buffer,
      receipt: storage.objects.get(contextualEntry.receiptKey)?.body as Buffer,
      expectedLineage: pipeline.postingMap.lineage,
    })).toThrow('full_corpus_relationship_contextual_completion_identity_required');

    const receipts = archived.index.objects.map((entry) => {
      const body = storage.objects.get(entry.receiptKey)?.body;
      if (!body) throw new Error('archive_receipt_missing');
      return JSON.parse(body.toString('utf8'));
    });
    expect(() => buildFullCorpusRelationshipRunIndex({
      postingMap: pipeline.postingMap,
      completion: pipeline.completion,
      contextualCompletion: pipeline.contextualCompletion,
      receipts: receipts.filter((receipt) => receipt.artifactType !== 'contextual_completion'),
    })).toThrow('full_corpus_relationship_run_index_required_object_missing');
  });

  it('fails closed on missing completion, mixed lineage, duplicate entries, and forged context endpoints', () => {
    const pipeline = buildMixedPipeline();
    const missing = {
      postingMap: pipeline.postingMap,
      postingReductions: pipeline.postingReductions,
      pairReducers: pipeline.pairReducers,
      expectedContextualCalibration: pipeline.expectedContextualCalibration,
      addressLedgerShardCount: 2,
    } as unknown as Parameters<typeof buildFullCorpusRelationshipCompletion>[0];
    expect(() => buildFullCorpusRelationshipCompletion(missing)).toThrow(
      'full_corpus_relationship_contextual_completion_required',
    );

    const wrongBinding: RelationshipInputUniverseBinding = {
      ...pipeline.mixed.binding,
      snapshotId: '00000000-0000-4000-8000-000000000889',
    };
    const wrongReceipt = productionCalibrationReceipt('wrong-binding');
    const wrongContext = buildStructuralTestOnlyProductionContextualCompletion({
      binding: wrongBinding,
      contextualCalibrationReceipt: wrongReceipt,
      contextualCalibrationReceiptBody: serializeContextualRelationshipCalibrationReceipt(wrongReceipt),
    });
    expect(() => buildCompletion(
      pipeline,
      wrongContext.artifact,
      wrongContext.expectedCalibration,
    )).toThrow(/relationship_input_(?:snapshot_)?binding_mismatch/);

    const duplicate = structuredClone(pipeline.contextualCompletion);
    duplicate.entries.push(structuredClone(duplicate.entries[0]));
    expect(() => buildCompletion(pipeline, duplicate)).toThrow(
      /contextual_completion_(?:duplicate_entry|source_entry_accounting_mismatch|noncanonical)/,
    );

    const endpoint = structuredClone(pipeline.contextualCompletion);
    const accepted = endpoint.entries.find((entry) => entry.status === 'accepted_edge');
    if (!accepted || accepted.status !== 'accepted_edge') throw new Error('accepted_entry_missing');
    accepted.typedEdge.endpoints[1].id = 'context-node:aircraft:forged';
    expect(() => buildCompletion(pipeline, endpoint)).toThrow(
      /(?:typed_relationship_edge_digest_mismatch|contextual_completion_(?:entry_typed_edge_mismatch|entry_noncanonical|noncanonical))/,
    );
  });
});
