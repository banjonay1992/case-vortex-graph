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
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import { buildContextualRelationshipCompletionArtifact } from '../../src/caseGraph/contextualRelationshipCompletion';
import { projectEvidenceUniverseNode } from '../../src/caseGraph/evidenceUniverse';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
} from '../../src/caseGraph/relationshipInputArchive';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { buildTypedRelationshipRarityIndex } from '../../src/caseGraph/typedRelationshipEngine';
import {
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
  buildFullCorpusRelationshipCompletion,
  reduceFullCorpusCandidateShard,
  reduceFullCorpusPostingShard,
} from '../../src/caseGraph/typedRelationshipPipeline';
import { archiveFullCorpusRelationshipRun } from '../../src/caseGraph/typedRelationshipPipelineArchive';
import {
  buildFullCorpusPublicGraphArtifacts,
  decodeFullCorpusPublicGraphArchiveObject,
  decodeFullCorpusPublicGraphManifest,
  decodeFullCorpusPublicGraphShard,
  encodeFullCorpusPublicGraphArchiveObject,
  verifyFullCorpusPublicGraphArtifacts,
} from '../../src/caseGraph/typedRelationshipPublicGraph';
import { buildCanonicalContextualCompletionMixedFixture } from './contextualRelationshipCompletionTestSupport';

const productionCalibrationReceipt = (): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = contextualExplanationSha256('public-graph-contextual-merge-core');
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: 'case-graph-contextual-relationship-calibration-v1',
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: 'production_gates_passed',
    calibrationCoreSha256,
    lineageSha256: contextualExplanationSha256('public-graph-contextual-merge-lineage'),
    auditPlanSha256: contextualExplanationSha256('public-graph-contextual-merge-audit'),
    trustPolicyDigest: contextualExplanationSha256('public-graph-contextual-merge-trust'),
    evaluationSetSha256: contextualExplanationSha256('public-graph-contextual-merge-evaluations'),
    labelSetSha256: contextualExplanationSha256('public-graph-contextual-merge-labels'),
    metricsSha256: contextualExplanationSha256('public-graph-contextual-merge-metrics'),
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

const buildMixedPipeline = () => {
  const mixed = buildCanonicalContextualCompletionMixedFixture();
  const calibrationReceipt = productionCalibrationReceipt();
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
  const inputManifest = buildRelationshipInputSnapshotManifest({
    binding: mixed.binding,
    parts: [part.manifest],
    generatedAt: '2026-07-18T02:00:00.000Z',
  });
  const rarityIndex = buildTypedRelationshipRarityIndex(records, mixed.binding);
  const postingShardCount = 2;
  const pairShardCount = 2;
  const postingFragments = buildFullCorpusPostingFragments({
    records,
    inputPartNumber: 0,
    relationshipInputManifest: inputManifest,
    rarityIndex,
    postingShardCount,
  });
  const postingMap = buildFullCorpusPostingMapManifest({
    relationshipInputManifest: inputManifest,
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
    records,
    postingFragments,
    postingMap,
    postingReductions,
    pairReducers,
    contextualCompletion,
    expectedContextualCalibration,
    completion,
  };
};

describe('public graph contextual completion merge', () => {
  it('keeps the public graph codec API available from the canonical module', () => {
    expect(typeof decodeFullCorpusPublicGraphArchiveObject).toBe('function');
    expect(typeof decodeFullCorpusPublicGraphManifest).toBe('function');
    expect(typeof decodeFullCorpusPublicGraphShard).toBe('function');
    expect(typeof encodeFullCorpusPublicGraphArchiveObject).toBe('function');
  });

  it('publishes only accepted contextual edges while keeping insufficient entries audit-only', async () => {
    const pipeline = buildMixedPipeline();
    const accepted = pipeline.contextualCompletion.entries.find((entry) => entry.status === 'accepted_edge');
    const insufficient = pipeline.contextualCompletion.entries.find((entry) => (
      entry.status === 'insufficient_evidence'
    ));
    if (!accepted || accepted.status !== 'accepted_edge' || !insufficient
      || insufficient.status !== 'insufficient_evidence') {
      throw new Error('public_graph_contextual_fixture_invalid');
    }
    const pairEdges = pipeline.pairReducers.flatMap((reducer) => reducer.edges);
    const pairEdgeIds = pairEdges.map((edge) => edge.edgeId).sort();

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
    const universeNodes = pipeline.records.map((record, index) => {
      const separator = record.address.indexOf(':');
      return projectEvidenceUniverseNode({
        kind: 'sighting',
        recordId: record.address.slice(separator + 1),
        source: record.source.sourceId,
        sourceRecordId: record.source.sourceRecordId,
        title: `Contextual merge evidence ${index + 1}`,
        summary: 'A structural public-graph contextual integration fixture.',
        canonicalUrl: `https://example.test/contextual-merge/${index + 1}`,
        previewUrl: null,
        eventTimestamp: null,
        lat: null,
        lon: null,
        location: null,
        countryCode: null,
        linkedSightingId: null,
        updatedAt: '2026-07-18T02:00:00.000Z',
        public: true,
      });
    });
    const artifacts = buildFullCorpusPublicGraphArtifacts({
      universeNodes,
      postingFragments: pipeline.postingFragments,
      postingMap: pipeline.postingMap,
      postingReductions: pipeline.postingReductions,
      pairReducers: pipeline.pairReducers,
      contextualRelationshipCompletion: pipeline.contextualCompletion,
      expectedContextualCalibrationReceiptId: pipeline.expectedContextualCalibration.receiptId,
      expectedContextualCalibrationReceiptSha256: pipeline.expectedContextualCalibration.receiptSha256,
      completion: pipeline.completion,
      runIndexPointer: archived.indexPointer,
      runIndexArchiveBody: archived.indexArtifact.archiveBody,
      runIndexReceipt: archived.indexArtifact.receipt,
      runArtifactReceipts: archived.index.objects.map((entry) => {
        const receipt = storage.objects.get(entry.receiptKey)?.body;
        if (!receipt) throw new Error('public_graph_contextual_archive_receipt_missing');
        return receipt;
      }),
      renderShardCount: 2,
      nodeShardCount: 2,
      edgeShardCount: 2,
      evaluationShardCount: 2,
      egoShardCount: 2,
    });
    expect(verifyFullCorpusPublicGraphArtifacts(artifacts)).toEqual(artifacts);

    const edges = artifacts.shards.filter((shard) => shard.shardKind === 'edge')
      .flatMap((shard) => shard.items)
      .filter((item) => 'recordType' in item && item.recordType === 'full_corpus_public_edge');
    expect(edges).toHaveLength(pairEdges.length + 1);
    const contextualPublicEdge = edges.find((edge) => (
      edge.edgeType === 'contextual_explanation_candidate'
    ));
    expect(contextualPublicEdge).toMatchObject({
      edgeId: accepted.typedEdge.edgeId,
      edgeType: 'contextual_explanation_candidate',
      endpoints: accepted.typedEdge.endpoints,
    });

    const nodes = artifacts.shards.filter((shard) => shard.shardKind === 'node')
      .flatMap((shard) => shard.items)
      .filter((item) => 'recordType' in item && item.recordType === 'full_corpus_public_node');
    const acceptedNode = nodes.find((node) => node.address === accepted.address);
    const insufficientNode = nodes.find((node) => node.address === insufficient.address);
    const acceptedPairDegree = pairEdges.filter((edge) => edge.endpoints.some((endpoint) => (
      endpoint.kind === 'evidence' && endpoint.id === accepted.address
    ))).length;
    const insufficientPairEdges = pairEdges.filter((edge) => edge.endpoints.some((endpoint) => (
      endpoint.kind === 'evidence' && endpoint.id === insufficient.address
    )));
    expect(acceptedNode).toMatchObject({
      relationshipStatus: 'linked',
      degree: acceptedPairDegree + 1,
      edgeTypeCounts: { contextual_explanation_candidate: 1 },
    });
    expect(insufficientNode).toMatchObject({
      relationshipStatus: insufficientPairEdges.length ? 'linked' : 'isolated',
      degree: insufficientPairEdges.length,
    });
    expect(insufficientNode?.statusReceipt.edgeIds).toEqual(
      insufficientPairEdges.map((edge) => edge.edgeId).sort(),
    );
    expect(insufficientNode?.statusReceipt.edgeIds).not.toContain(accepted.typedEdge.edgeId);
    expect(artifacts.manifest).toMatchObject({
      typedEdgeCount: pairEdges.length + 1,
      pairReducerTypedEdgeCount: pairEdges.length,
      pairReducerTypedEdgeIdSetSha256: relationshipInputSha256(pairEdgeIds.join('\n')),
      typedEdgeTypeCounts: { contextual_explanation_candidate: 1 },
      contextualRelationshipCompletion: {
        completionId: pipeline.contextualCompletion.completionId,
        completionDigest: pipeline.contextualCompletion.completionDigest,
        accounting: { acceptedEdgeCount: 1, insufficientEvidenceCount: 1 },
        acceptedEdgeIdSetSha256: relationshipInputSha256(accepted.typedEdge.edgeId),
        zeroObservationState: false,
      },
    });
  });
});
