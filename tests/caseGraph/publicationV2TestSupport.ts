import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deserialize } from 'node:v8';
import { gzipSync } from 'node:zlib';

import {
  getCaseGraphFeatureControlKeys,
  getCaseGraphPublicationKeys,
  getEvidenceUniverseControlKeys,
  getEvidenceUniversePartKeys,
} from '../../src/caseGraph/archiveKeys';
import {
  CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
  type CaseGraphFeatureCompletionManifest,
  type CaseGraphFeaturePartSummary,
  type CaseGraphSourceRow,
} from '../../src/caseGraph/archiveTypes';
import { buildCaseGraphRarityFromDocumentFrequency } from '../../src/caseGraph/corpusRarity';
import type { CaseVortexCorpusAccountingReceipt } from '../../src/caseGraph/corpusAccounting';
import {
  CASE_VORTEX_ACCOUNTING_PUBLICATION_BINDING_VERSION,
  CASE_VORTEX_ADDRESS_LEDGER_VERSION,
  caseVortexCorpusAccountingReceiptSha256,
  encodeCaseVortexCorpusAccountingReceipt,
} from '../../src/caseGraph/corpusAccountingIntegration';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from '../../src/caseGraph/evidenceUniverse';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
  type EvidenceUniversePart,
} from '../../src/caseGraph/evidenceUniverseArchive';
import {
  buildCaseGraphFeaturePart,
  getCaseGraphFeatureArchiveSetSha256,
} from '../../src/caseGraph/featureArchiveCodec';
import {
  buildFullCorpusProductionCompatibilityArchive,
  buildFullCorpusProductionCompatibilityReceipt,
} from '../../src/caseGraph/fullCorpusProductionCompatibility';
import {
  buildFullCorpusTypedOrchestrationRequest,
  getFullCorpusTypedGraphInputBinding,
} from '../../src/caseGraph/fullCorpusTypedOrchestration';
import {
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
} from '../../src/caseGraph/postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';
import {
  buildCaseGraphPublicationCalibrationSetReceipt,
  serializeCaseGraphPublicationCalibrationSetReceipt,
} from '../../src/caseGraph/publicationCalibrationSet';
import {
  CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION,
  CASE_GRAPH_PUBLIC_MANIFEST_VERSION,
  buildCaseGraphPublicManifest,
  caseGraphPublicManifestSha256,
  encodeCaseGraphPublicManifest,
  type CaseGraphPublicManifest,
} from '../../src/caseGraph/publicationManifest';
import {
  CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION,
  encodeCaseGraphPublicationCandidateCompletion,
  type CaseGraphPublicationCandidateCompletion,
} from '../../src/caseGraph/publicationArchive';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
  getRelationshipInputControlKeys,
} from '../../src/caseGraph/relationshipInputArchive';
import {
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  canonicalizeRelationshipInput,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_MODEL_ID,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_MODEL_VERSION,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
} from '../../src/caseGraph/typedRelationshipEngine';
import {
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
  buildFullCorpusRelationshipCompletion,
  reduceFullCorpusCandidateShard,
  reduceFullCorpusPostingShard,
  type FullCorpusRelationshipCompletion,
} from '../../src/caseGraph/typedRelationshipPipeline';
import {
  buildFullCorpusRelationshipArchiveObject,
  buildFullCorpusRelationshipRunIndex,
  buildFullCorpusRelationshipRunIndexPointer,
} from '../../src/caseGraph/typedRelationshipPipelineArchive';
import {
  buildFullCorpusPublicGraphArtifacts,
  encodeFullCorpusPublicGraphArchiveObject,
  type FullCorpusPublicNode,
} from '../../src/caseGraph/typedRelationshipPublicGraph';
import {
  buildFullCorpusPublicDensityArchiveObject,
  buildFullCorpusPublicDensityArtifact,
} from '../../src/caseGraph/typedPublicDensity';
import {
  buildStructuralTestOnlyProductionContextualCompletion,
} from './contextualRelationshipProductionCompletionTestSupport';
import {
  FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
  buildFullProductionCalibrationHumanReviewTestFixture,
  type FullProductionCalibrationPairLineageMaterial,
  type FullProductionCalibrationTestFixture,
} from './fullProductionCalibrationTestSupport';

export const publicationCorpusVersion = 'publication-v2-fixture';
export const publicationSnapshotId = '018f47ef-4fb0-7e2a-8b5c-5bd3909f7101';
export const publicationPrefix = `case-vortex/corpora/${publicationCorpusVersion}`;
export const fixtureHash = (character: string) => character.repeat(64);
const rawSha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const generatedAt = '2026-07-18T12:00:00.000Z';
const snapshotAt = '2026-07-18T11:00:00.000Z';
const materializedAt = '2026-07-18T10:59:59.123456Z';

const ids = {
  sighting: '00000000-0000-4000-8000-000000000000',
  document: 'official-record-2',
  photo: 'archive-photo-3',
  video: 'witness-video-4',
} as const;

const kindOrder: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const byKind = { sighting: 102, document: 1, photo: 1, video: 1 };
const universeRecordCount = Object.values(byKind).reduce((sum, count) => sum + count, 0);

const fixtureRecordAddress = (index: number) => {
  if (index === 103) return `document:${ids.document}`;
  if (index === 104) return `photo:${ids.photo}`;
  if (index === 105) return `video:${ids.video}`;
  return `sighting:00000000-0000-4000-8000-${String(index - 1).padStart(12, '0')}`;
};

const relationshipBinding = (): RelationshipInputUniverseBinding => ({
  snapshotId: publicationSnapshotId,
  corpusVersion: publicationCorpusVersion,
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: '',
  universeRecordCount,
});

const universeNodes = (): EvidenceUniverseNode[] => Array.from(
  { length: universeRecordCount },
  (_, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    const address = fixtureRecordAddress(index);
    const delimiter = address.indexOf(':');
    const kind = address.slice(0, delimiter) as EvidenceUniverseNodeKind;
    const recordId = address.slice(delimiter + 1);
    const hasResolvedCoordinates = index % 3 === 1;
    return projectEvidenceUniverseNode({
      kind,
      recordId,
      source: kind === 'sighting' ? 'community' : kind === 'document' ? 'official' : 'research',
      sourceRecordId: `${kind}-source-record-${index}`,
      title: `${kind} fixture record ${index}`,
      summary: `Governed ${kind} fixture used only by local publication contract tests.`,
      canonicalUrl: `https://example.test/${kind}/${recordId}`,
      previewUrl: kind === 'photo' || kind === 'video'
        ? `https://example.test/${kind}/${recordId}/preview`
        : null,
      eventTimestamp: hasResolvedCoordinates ? '2026-01-01T00:00:00.000Z' : null,
      lat: hasResolvedCoordinates ? 51.5 : null,
      lon: hasResolvedCoordinates ? -0.1 : null,
      location: hasResolvedCoordinates ? 'Fixture location' : null,
      countryCode: hasResolvedCoordinates ? 'GB' : null,
      linkedSightingId: kind === 'photo' || kind === 'video' ? ids.sighting : null,
      updatedAt: '2026-07-18T10:00:00.000Z',
      public: true,
    });
  },
);

const buildUniverseCompletion = (nodes: EvidenceUniverseNode[]) => {
  const partBodies = new Map<string, Buffer>();
  const parts: EvidenceUniversePart[] = kindOrder.map((kind) => {
    const kindNodes = nodes
      .filter((node) => node.kind === kind)
      .sort((left, right) => left.address.localeCompare(right.address));
    const first = kindNodes[0];
    const last = kindNodes.at(-1);
    if (!first || !last) throw new Error(`publication_v2_universe_kind_missing:${kind}`);
    const keys = getEvidenceUniversePartKeys(publicationCorpusVersion, kind, 0);
    const plain = Buffer.from(
      `${kindNodes.map((node) => JSON.stringify(node)).join('\n')}\n`,
      'utf8',
    );
    const archiveBody = gzipSync(plain, { level: 6 });
    partBodies.set(keys.archiveKey, archiveBody);
    const cursor = kind === 'sighting'
      ? { updated_at: last.updatedAt, case_id: last.recordId }
      : { updatedAt: last.updatedAt, recordId: last.recordId };
    return {
      partNumber: 0,
      kind,
      rowCount: kindNodes.length,
      archiveKey: keys.archiveKey,
      manifestKey: keys.manifestKey,
      compressedBytes: archiveBody.length,
      uncompressedBytes: plain.length,
      sha256: rawSha(archiveBody),
      firstAddress: first.address,
      lastAddress: last.address,
      cursor,
      accounting: {
        total: kindNodes.length,
        byKind: Object.fromEntries(kindOrder.map((candidateKind) => [
          candidateKind,
          candidateKind === kind ? kindNodes.length : 0,
        ])) as typeof byKind,
        attachedMedia: kind === 'photo' || kind === 'video' ? kindNodes.length : 0,
        unresolvedTime: kindNodes.filter((node) => node.eventTimestamp === null).length,
        unresolvedLocation: kindNodes.filter((node) => node.lat === null).length,
      },
    };
  });
  const accounting = {
    total: universeRecordCount,
    byKind,
    attachedMedia: nodes.filter((node) => (
      (node.kind === 'photo' || node.kind === 'video') && node.linkedSightingId !== null
    )).length,
    unresolvedTime: nodes.filter((node) => node.eventTimestamp === null).length,
    unresolvedLocation: nodes.filter((node) => node.lat === null).length,
  };
  const cursors = Object.fromEntries(parts.map((part) => [part.kind, part.cursor])) as EvidenceUniverseCompletion['cursors'];
  const completion: EvidenceUniverseCompletion = {
    recordType: 'evidence_universe_completion',
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion: publicationCorpusVersion,
    expected: {
      snapshotId: publicationSnapshotId,
      snapshotAt,
      materializedAt,
      sourceMvccSnapshot: '1:2:3,4',
      snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      capturePolicies: {
        sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
        document: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        photo: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        video: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      },
      byKind,
      total: universeRecordCount,
      sightingPolicy: 'publication-v2-local-contract-fixture',
      mediaBackfillsComplete: { document: true, photo: true, video: true },
    },
    exportedByKind: byKind,
    cursors,
    parts,
    accounting,
    archiveSetSha256: rawSha(parts.map((part) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n')),
    completedAt: generatedAt,
  };
  return { completion, body: Buffer.from(`${JSON.stringify(completion)}\n`, 'utf8'), partBodies };
};

const buildFeatureCompletion = (universe: EvidenceUniverseCompletion) => {
  const firstCursor = { updated_at: '2026-07-18T10:00:00.000Z', case_id: ids.sighting };
  const sourceRows: CaseGraphSourceRow[] = [{
    cursor: firstCursor,
    sighting: {
      id: ids.sighting,
      source: 'community',
      updated_at: firstCursor.updated_at,
      description: 'Local structural publication fixture sighting.',
    },
  }];
  const builtPart = buildCaseGraphFeaturePart({
    corpusVersion: publicationCorpusVersion,
    partNumber: 0,
    rows: sourceRows,
  });
  const partManifest = builtPart.manifest;
  const part: CaseGraphFeaturePartSummary = {
    part_number: partManifest.part_number,
    archive_key: partManifest.archive_key,
    manifest_key: partManifest.manifest_key,
    row_count: partManifest.row_count,
    first_cursor: partManifest.first_cursor,
    last_cursor: partManifest.last_cursor,
    source_counts: partManifest.source_counts,
    term_document_frequency: partManifest.term_document_frequency,
    completeness_sum: partManifest.completeness_sum,
    uncompressed_bytes: partManifest.uncompressed_bytes,
    uncompressed_sha256: partManifest.uncompressed_sha256,
    compressed_bytes: partManifest.compressed_bytes,
    compressed_sha256: partManifest.compressed_sha256,
  };
  const binding = {
    snapshot_id: publicationSnapshotId,
    snapshot_policy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capture_policy: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    materialized_at: materializedAt,
    source_mvcc_snapshot: '1:2:3,4',
    universe: { corpus_version: publicationCorpusVersion, archive_set_sha256: universe.archiveSetSha256 },
  };
  const expected = {
    snapshot_id: publicationSnapshotId,
    snapshot_policy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
    capture_policy: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
    materialized_at: materializedAt,
    source_mvcc_snapshot: '1:2:3,4',
    eligible_count: 1,
    min_cursor: firstCursor,
    max_cursor: firstCursor,
    source_counts: { community: 1 },
    publishability_policy: 'publishable_public_v2',
    snapshot_at: snapshotAt,
  };
  const completion: CaseGraphFeatureCompletionManifest = {
    record_type: 'case_graph_feature_completion_manifest',
    schema_version: CASE_GRAPH_ARCHIVE_SCHEMA_VERSION,
    corpus_version: publicationCorpusVersion,
    binding,
    expected,
    exported_row_count: 1,
    part_count: 1,
    parts: [part],
    archive_set_sha256: getCaseGraphFeatureArchiveSetSha256([part], binding),
    rarity_key: getCaseGraphFeatureControlKeys(publicationCorpusVersion).rarityKey,
    rarity_sha256: '',
    completed_at: generatedAt,
  };
  const rarity = buildCaseGraphRarityFromDocumentFrequency(
    part.term_document_frequency,
    part.row_count,
    publicationCorpusVersion,
  );
  const rarityBody = Buffer.from(`${JSON.stringify(rarity)}\n`, 'utf8');
  completion.rarity_sha256 = rawSha(rarityBody);
  return {
    completion,
    body: Buffer.from(`${JSON.stringify(completion)}\n`, 'utf8'),
    part: builtPart,
    rarity,
    rarityBody,
  };
};

type FixtureRelationshipInputArchive = {
  records: RelationshipInputRecord[];
  part: ReturnType<typeof buildRelationshipInputPart>;
  manifest: ReturnType<typeof buildRelationshipInputSnapshotManifest>;
  manifestBody: Buffer;
  rarity: FullProductionCalibrationTestFixture['pair']['rarityIndex'];
};

const buildRelationshipRun = (params: {
  input: FixtureRelationshipInputArchive;
  contextualCompletion: ReturnType<typeof buildStructuralTestOnlyProductionContextualCompletion>;
}) => {
  const { records, part, manifest, manifestBody, rarity } = params.input;
  const expectedContextualCalibration = params.contextualCompletion.expectedCalibration;
  const fragments = buildFullCorpusPostingFragments({
    records,
    inputPartNumber: 0,
    relationshipInputManifest: manifest,
    rarityIndex: rarity,
    postingShardCount: 1,
  });
  const postingMap = buildFullCorpusPostingMapManifest({
    relationshipInputManifest: manifest,
    rarityIndex: rarity,
    postingShardCount: 1,
    fragments,
  });
  const postingReductions = [reduceFullCorpusPostingShard({
    postingMap,
    fragments,
    postingShard: 0,
    pairShardCount: 1,
    caps: {
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
  })];
  const candidateFragments = postingReductions.flatMap((reduction) => reduction.candidateFragments);
  const pairReducers = [reduceFullCorpusCandidateShard({
    postingMap,
    rarityIndex: rarity,
    fragments: candidateFragments,
    pairShard: 0,
    pairShardCount: 1,
  })];
  const completion = buildFullCorpusRelationshipCompletion({
    postingMap,
    postingReductions,
    pairReducers,
    contextualCompletion: params.contextualCompletion.artifact,
    expectedContextualCalibration,
    addressLedgerShardCount: 1,
  });
  const lineage = postingMap.lineage;
  const artifacts = [
    ...fragments.map((value) => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'posting_fragment' as const, value, lineage,
    })),
    buildFullCorpusRelationshipArchiveObject({ artifactType: 'posting_map', value: postingMap, lineage }),
    ...postingReductions.flatMap((reduction) => [
      buildFullCorpusRelationshipArchiveObject({ artifactType: 'posting_reduction' as const, value: reduction, lineage }),
      ...reduction.candidateFragments.map((value) => buildFullCorpusRelationshipArchiveObject({
        artifactType: 'candidate_fragment' as const, value, lineage,
      })),
    ]),
    ...pairReducers.map((value) => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'pair_reducer' as const, value, lineage,
    })),
    buildFullCorpusRelationshipArchiveObject({
      artifactType: 'contextual_completion' as const,
      value: params.contextualCompletion.artifact,
      lineage,
      expectedContextualCompletion: completion.contextualCompletion,
    }),
    ...completion.addressLedgerShards.map((value) => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'address_ledger' as const, value, lineage,
    })),
    buildFullCorpusRelationshipArchiveObject({ artifactType: 'completion', value: completion, lineage }),
  ];
  const index = buildFullCorpusRelationshipRunIndex({
    postingMap,
    completion,
    contextualCompletion: params.contextualCompletion.artifact,
    receipts: artifacts.map((artifact) => artifact.receipt),
  });
  const indexArtifact = buildFullCorpusRelationshipArchiveObject({
    artifactType: 'run_index',
    value: index,
    lineage,
  });
  const pointer = buildFullCorpusRelationshipRunIndexPointer(indexArtifact);
  return {
    records,
    part,
    manifest,
    manifestBody,
    rarity,
    fragments,
    postingMap,
    postingReductions,
    pairReducers,
    completion,
    artifacts,
    index,
    indexArtifact,
    pointer,
    contextualCompletion: params.contextualCompletion,
  };
};

const buildPublicationV2FixtureUncached = () => {
  const nodes = universeNodes();
  const universe = buildUniverseCompletion(nodes);
  const binding = { ...relationshipBinding(), universeArchiveSetSha256: universe.completion.archiveSetSha256 };
  const features = buildFeatureCompletion(universe.completion);
  let relationshipInput: FixtureRelationshipInputArchive | null = null;
  const calibrationEvidence = buildFullProductionCalibrationHumanReviewTestFixture(binding, {
    resolvePairRelationshipInputLineage: (
      material: FullProductionCalibrationPairLineageMaterial,
    ) => {
      const expectedAddresses = nodes.map((node) => node.address).sort();
      const actualAddresses = material.records.map((record) => record.address).sort();
      if (canonicalizeRelationshipInput(actualAddresses)
        !== canonicalizeRelationshipInput(expectedAddresses)) {
        throw new Error('publication_v2_calibration_relationship_input_address_mismatch');
      }
      const part = buildRelationshipInputPart({
        binding,
        partNumber: 0,
        records: material.records,
      });
      const manifest = buildRelationshipInputSnapshotManifest({
        binding,
        parts: [part.manifest],
        generatedAt,
      });
      relationshipInput = {
        records: material.records,
        part,
        manifest,
        manifestBody: Buffer.from(`${canonicalizeRelationshipInput(manifest)}\n`, 'utf8'),
        rarity: material.rarityIndex,
      };
      return {
        archiveSetSha256: manifest.archiveSetSha256,
        manifestDigest: manifest.manifestDigest,
      };
    },
  });
  if (!relationshipInput) {
    throw new Error('publication_v2_calibration_relationship_input_missing');
  }
  const contextualCompletion = buildStructuralTestOnlyProductionContextualCompletion({
    binding,
    contextualCalibrationReceipt: calibrationEvidence.contextual.receipt,
    contextualCalibrationReceiptBody: calibrationEvidence.contextual.receiptBody,
  });
  const relationship = buildRelationshipRun({
    input: relationshipInput,
    contextualCompletion,
  });
  const publicGraph = buildFullCorpusPublicGraphArtifacts({
    universeNodes: nodes,
    postingFragments: relationship.fragments,
    postingMap: relationship.postingMap,
    postingReductions: relationship.postingReductions,
    pairReducers: relationship.pairReducers,
    contextualRelationshipCompletion: contextualCompletion.artifactBody,
    expectedContextualCalibrationReceiptId: contextualCompletion.expectedCalibration.receiptId,
    expectedContextualCalibrationReceiptSha256: contextualCompletion.expectedCalibration.receiptSha256,
    completion: relationship.completion,
    runIndexPointer: relationship.pointer,
    runIndexArchiveBody: relationship.indexArtifact.archiveBody,
    runIndexReceipt: relationship.indexArtifact.receipt,
    runArtifactReceipts: relationship.artifacts.map((artifact) => artifact.receiptBody),
    renderShardCount: 1,
    nodeShardCount: 1,
    edgeShardCount: 1,
    evaluationShardCount: 1,
    egoShardCount: 1,
  });
  const publicGraphShardArchives = publicGraph.shards.map((shard) => (
    encodeFullCorpusPublicGraphArchiveObject(shard)
  ));
  const publicGraphManifestArchive = encodeFullCorpusPublicGraphArchiveObject(publicGraph.manifest);
  const publicNodes = publicGraph.shards
    .filter((shard) => shard.shardKind === 'node')
    .flatMap((shard) => shard.items)
    .filter((node): node is FullCorpusPublicNode => (
      'recordType' in node && node.recordType === 'full_corpus_public_node'
    ));
  const densityArtifact = buildFullCorpusPublicDensityArtifact({
    corpusVersion: publicationCorpusVersion,
    snapshotId: publicationSnapshotId,
    publicGraphManifestDigest: publicGraph.manifest.manifestDigest,
    nodes: publicNodes.map((node) => ({
      address: node.address,
      kind: node.kind,
      source: node.source,
      eventTimestamp: node.eventTimestamp,
      lat: node.lat,
      lon: node.lon,
      degree: node.degree,
      relationshipStatus: node.relationshipStatus,
    })),
  });
  const densityArchive = buildFullCorpusPublicDensityArchiveObject(densityArtifact);
  const setReceipt = buildCaseGraphPublicationCalibrationSetReceipt({
    pairReceiptBody: calibrationEvidence.pair.receiptBody,
    contextualReceiptBody: calibrationEvidence.contextual.receiptBody,
    pairLineage: calibrationEvidence.pair.artifact.lineage,
    contextualLineage: calibrationEvidence.contextual.artifact.lineage,
  });
  const setReceiptBody = Buffer.from(
    serializeCaseGraphPublicationCalibrationSetReceipt(setReceipt),
    'utf8',
  );
  const calibration = {
    ...calibrationEvidence,
    pairLineage: calibrationEvidence.pair.artifact.lineage,
    contextualLineage: calibrationEvidence.contextual.artifact.lineage,
    pairReceipt: calibrationEvidence.pair.receipt,
    contextualReceipt: calibrationEvidence.contextual.receipt,
    pairReceiptBody: calibrationEvidence.pair.receiptBody,
    contextualReceiptBody: calibrationEvidence.contextual.receiptBody,
    setReceipt,
    setReceiptBody,
  };
  const keys = getCaseGraphPublicationKeys(publicationCorpusVersion);
  const graphRequest = buildFullCorpusTypedOrchestrationRequest({
    corpusVersion: publicationCorpusVersion,
    calibration: {
      humanReviewBundle: {
        key: keys.humanReviewBundleKey,
        sha256: rawSha(calibration.bundleBody),
      },
      pairReceipt: { key: keys.pairCalibrationReceiptKey, sha256: rawSha(calibration.pairReceiptBody) },
      pairArtifact: { key: keys.pairCalibrationArtifactKey, sha256: rawSha(calibration.pair.artifactBody) },
      pairTrustPolicy: {
        key: keys.pairCalibrationTrustPolicyKey,
        sha256: rawSha(calibration.pair.trustPolicyBody),
      },
      contextualReceipt: {
        key: keys.contextualCalibrationReceiptKey,
        sha256: rawSha(calibration.contextualReceiptBody),
      },
      contextualArtifact: {
        key: keys.contextualCalibrationArtifactKey,
        sha256: rawSha(calibration.contextual.artifactBody),
      },
      contextualTrustPolicy: {
        key: keys.contextualCalibrationTrustPolicyKey,
        sha256: rawSha(calibration.contextual.trustPolicyBody),
      },
    },
    contextualRelationshipCompletion: {
      key: keys.contextualRelationshipCompletionKey,
      sha256: rawSha(contextualCompletion.artifactBody),
    },
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
    publication: null,
  });
  const productionCompatibility = buildFullCorpusProductionCompatibilityArchive(
    buildFullCorpusProductionCompatibilityReceipt({
      universe: binding,
      orchestrationRequest: getFullCorpusTypedGraphInputBinding(graphRequest),
      nodes,
    }),
  );
  const accountingBinding = {
    schemaVersion: CASE_VORTEX_ACCOUNTING_PUBLICATION_BINDING_VERSION,
    corpusVersion: publicationCorpusVersion,
    snapshotId: publicationSnapshotId,
    universe: {
      archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
      schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      archiveSetSha256: universe.completion.archiveSetSha256,
      recordCount: universeRecordCount,
    },
    relationshipInput: {
      schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      archiveSetSha256: relationship.manifest.archiveSetSha256,
      manifestDigest: relationship.manifest.manifestDigest,
      recordCount: universeRecordCount,
    },
    policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
    graphAddressLedger: {
      schemaVersion: CASE_VORTEX_ADDRESS_LEDGER_VERSION,
      stage: 'graph' as const,
      manifestSha256: publicGraph.manifest.manifestDigest,
      archiveSetSha256: publicGraph.manifest.shardSetSha256,
      recordCount: universeRecordCount,
      byKind,
    },
  };
  const manifest = buildCaseGraphPublicManifest({
    corpusVersion: publicationCorpusVersion,
    generatedAt,
    features: features.completion,
    universe: universe.completion,
    relationshipInput: relationship.manifest,
    relationshipCompletion: relationship.completion,
    relationshipRun: relationship.pointer,
    productionCompatibility: productionCompatibility.pointer,
    publicGraph: publicGraph.manifest,
    publicGraphManifestReceipt: publicGraphManifestArchive.receipt,
    density: densityArchive.pointer,
    densityArtifact,
    calibration: {
      receipt: calibration.setReceipt,
      receiptBody: calibration.setReceiptBody,
      receiptKey: keys.calibrationSetReceiptKey,
      pairReceiptKey: keys.pairCalibrationReceiptKey,
      contextualReceiptKey: keys.contextualCalibrationReceiptKey,
      pairReceiptBody: calibration.pairReceiptBody,
      contextualReceiptBody: calibration.contextualReceiptBody,
    },
    calibrationEvidence: {
      humanReviewBundleBody: calibration.bundleBody,
      humanReviewBundleKey: keys.humanReviewBundleKey,
      pairArtifactBody: calibration.pair.artifactBody,
      pairTrustPolicyBody: calibration.pair.trustPolicyBody,
      pairArtifactKey: keys.pairCalibrationArtifactKey,
      pairTrustPolicyKey: keys.pairCalibrationTrustPolicyKey,
      contextualArtifactBody: calibration.contextual.artifactBody,
      contextualTrustPolicyBody: calibration.contextual.trustPolicyBody,
      contextualArtifactKey: keys.contextualCalibrationArtifactKey,
      contextualTrustPolicyKey: keys.contextualCalibrationTrustPolicyKey,
      pinned: {
        pair: {
          receiptId: calibration.pair.receipt.receiptId,
          receiptSha256: calibration.pair.receipt.receiptSha256,
          artifactDigest: calibration.pair.artifact.artifactDigest,
          trustPolicyDigest: calibration.pair.trustPolicy.trustPolicyDigest,
        },
        contextual: {
          receiptId: calibration.contextual.receipt.receiptId,
          receiptSha256: calibration.contextual.receipt.receiptSha256,
          artifactDigest: calibration.contextual.artifact.artifactDigest,
          trustPolicyDigest: calibration.contextual.trustPolicy.trustPolicyDigest,
        },
      },
    },
    contextualCompletion: {
      artifact: contextualCompletion.artifact,
      body: contextualCompletion.artifactBody,
      key: keys.contextualRelationshipCompletionKey,
    },
    accountingBinding,
  });
  const manifestBody = encodeCaseGraphPublicManifest(manifest);
  const manifestSha256 = caseGraphPublicManifestSha256(manifestBody);
  const accountingReceipt: CaseVortexCorpusAccountingReceipt = {
    accountingVersion: 'case-vortex-corpus-accounting-v1',
    complete: true,
    binding: {
      corpusVersion: publicationCorpusVersion,
      snapshotId: publicationSnapshotId,
      universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
      universeArchiveSetSha256: universe.completion.archiveSetSha256,
      universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      universeRecordCount,
      relationshipInputSchemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      relationshipInputBinding: binding,
      relationshipInputArchiveSetSha256: relationship.manifest.archiveSetSha256,
      relationshipInputManifestDigest: relationship.manifest.manifestDigest,
      relationshipInputRecordCount: universeRecordCount,
      graphPublicationSha256: manifestSha256,
      policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
    },
    observedByKind: byKind,
    capturedByKind: byKind,
    excludedByKind: { sighting: 0, document: 0, photo: 0, video: 0 },
    observedTotal: universeRecordCount,
    representedTotal: universeRecordCount,
    excludedTotal: 0,
    relationshipProcessedTotal: universeRecordCount,
    relationshipNotApplicableTotal: 0,
    duplicateCandidateTotal: 0,
    duplicateConfirmedTotal: 0,
    exclusionsByReason: {
      not_public: 0,
      withdrawn: 0,
      legal_restriction: 0,
      unsafe_media: 0,
      invalid_record: 0,
      outside_governed_scope: 0,
    },
    recordLedgerSha256: fixtureHash('a'),
    representedAddressSetSha256: fixtureHash('b'),
    excludedAddressSetSha256: fixtureHash('c'),
    universePointerSetSha256: fixtureHash('d'),
    relationshipInputPointerSetSha256: fixtureHash('e'),
    graphPointerSetSha256: fixtureHash('f'),
    userInterfacePointerSetSha256: fixtureHash('0'),
  };
  const accountingReceiptBody = encodeCaseVortexCorpusAccountingReceipt(accountingReceipt);
  const accountingReceiptSha256 = caseVortexCorpusAccountingReceiptSha256(accountingReceiptBody);
  const completion: CaseGraphPublicationCandidateCompletion = {
    record_type: 'case_graph_publication_candidate_completion',
    schema_version: CASE_GRAPH_PUBLICATION_ARCHIVE_SCHEMA_VERSION,
    public_manifest_version: CASE_GRAPH_PUBLIC_MANIFEST_VERSION,
    graph_artifact_set_version: CASE_GRAPH_GRAPH_ARTIFACT_SET_VERSION,
    corpus_version: publicationCorpusVersion,
    snapshot_id: publicationSnapshotId,
    manifest_key: keys.manifestKey,
    manifest_sha256: manifestSha256,
    accounting_receipt_key: keys.accountingReceiptKey,
    accounting_receipt_sha256: accountingReceiptSha256,
    relationship_input_manifest_digest: manifest.lineage.relationshipInput.manifestDigest,
    relationship_policy_version: TYPED_RELATIONSHIP_POLICY_VERSION,
    relationship_policy_sha256: TYPED_RELATIONSHIP_POLICY_SHA256,
    relationship_model_id: TYPED_RELATIONSHIP_MODEL_ID,
    relationship_model_version: TYPED_RELATIONSHIP_MODEL_VERSION,
    relationship_model_sha256: TYPED_RELATIONSHIP_MODEL_SHA256,
    relationship_run_index_digest: manifest.lineage.relationshipRun.indexDigest,
    relationship_run_artifact_set_sha256: manifest.lineage.relationshipRun.artifactSetSha256,
    relationship_completion_digest: manifest.lineage.relationshipRun.completionDigest,
    public_graph_manifest_digest: manifest.lineage.publicGraph.manifestDigest,
    density_artifact_digest: manifest.density.artifactDigest,
    calibration_set_receipt_key: keys.calibrationSetReceiptKey,
    calibration_set_receipt_sha256: calibration.setReceipt.receiptSha256,
    calibration_set_receipt_body_sha256: rawSha(calibration.setReceiptBody),
    calibration_set_sha256: calibration.setReceipt.calibrationSetSha256,
    pair_calibration_receipt_id: calibration.pairReceipt.receiptId,
    pair_calibration_receipt_key: keys.pairCalibrationReceiptKey,
    pair_calibration_receipt_sha256: calibration.pairReceipt.receiptSha256,
    pair_calibration_receipt_body_sha256: rawSha(calibration.pairReceiptBody),
    pair_calibration_lineage_sha256: calibration.pairReceipt.lineageSha256,
    contextual_calibration_receipt_id: calibration.contextualReceipt.receiptId,
    contextual_calibration_receipt_key: keys.contextualCalibrationReceiptKey,
    contextual_calibration_receipt_sha256: calibration.contextualReceipt.receiptSha256,
    contextual_calibration_receipt_body_sha256: rawSha(calibration.contextualReceiptBody),
    contextual_calibration_lineage_sha256: calibration.contextualReceipt.lineageSha256,
    pair_calibration_artifact_key: manifest.lineage.calibrationEvidence.pair.artifactKey,
    pair_calibration_artifact_body_sha256:
      manifest.lineage.calibrationEvidence.pair.artifactBodySha256,
    pair_calibration_artifact_digest: manifest.lineage.calibrationEvidence.pair.artifactDigest,
    pair_calibration_trust_policy_key: manifest.lineage.calibrationEvidence.pair.trustPolicyKey,
    pair_calibration_trust_policy_body_sha256:
      manifest.lineage.calibrationEvidence.pair.trustPolicyBodySha256,
    pair_calibration_trust_policy_digest:
      manifest.lineage.calibrationEvidence.pair.trustPolicyDigest,
    contextual_calibration_artifact_key:
      manifest.lineage.calibrationEvidence.contextual.artifactKey,
    contextual_calibration_artifact_body_sha256:
      manifest.lineage.calibrationEvidence.contextual.artifactBodySha256,
    contextual_calibration_artifact_digest:
      manifest.lineage.calibrationEvidence.contextual.artifactDigest,
    contextual_calibration_trust_policy_key:
      manifest.lineage.calibrationEvidence.contextual.trustPolicyKey,
    contextual_calibration_trust_policy_body_sha256:
      manifest.lineage.calibrationEvidence.contextual.trustPolicyBodySha256,
    contextual_calibration_trust_policy_digest:
      manifest.lineage.calibrationEvidence.contextual.trustPolicyDigest,
    contextual_relationship_completion_key: manifest.lineage.contextualCompletion.key,
    contextual_relationship_completion_body_sha256: manifest.lineage.contextualCompletion.bodySha256,
    contextual_relationship_completion_id: manifest.lineage.contextualCompletion.completionId,
    contextual_relationship_completion_digest: manifest.lineage.contextualCompletion.completionDigest,
    contextual_relationship_source_completion_set_sha256:
      manifest.lineage.contextualCompletion.sourceCompletionSetSha256,
    contextual_relationship_entry_set_sha256: manifest.lineage.contextualCompletion.entrySetSha256,
    contextual_relationship_accounting: manifest.lineage.contextualCompletion.accounting,
    graph_artifact_set_sha256: manifest.lineage.graph.artifactSetSha256,
    eligible_case_count: universeRecordCount,
    indexed_case_count: universeRecordCount,
    candidate_pair_count: relationship.completion.candidatePairCount,
    unique_edge_count: relationship.completion.typedEdgeCount,
    skipped_group_count: relationship.completion.skippedGroupCount,
    skipped_estimated_pair_count: relationship.completion.skippedEstimatedPairCount,
    generated_at: generatedAt,
  };
  const completionBody = encodeCaseGraphPublicationCandidateCompletion(completion);
  const objects = new Map<string, Buffer>([
    [keys.manifestKey, manifestBody],
    [keys.accountingReceiptKey, accountingReceiptBody],
    [keys.calibrationSetReceiptKey, calibration.setReceiptBody],
    [keys.humanReviewBundleKey, calibration.bundleBody],
    [keys.pairCalibrationReceiptKey, calibration.pairReceiptBody],
    [keys.contextualCalibrationReceiptKey, calibration.contextualReceiptBody],
    [keys.pairCalibrationArtifactKey, calibration.pair.artifactBody],
    [keys.pairCalibrationTrustPolicyKey, calibration.pair.trustPolicyBody],
    [keys.contextualCalibrationArtifactKey, calibration.contextual.artifactBody],
    [keys.contextualCalibrationTrustPolicyKey, calibration.contextual.trustPolicyBody],
    [keys.contextualRelationshipCompletionKey, contextualCompletion.artifactBody],
    [keys.completionManifestKey, completionBody],
    [productionCompatibility.pointer.archiveKey, productionCompatibility.body],
    [densityArchive.pointer.archiveKey, densityArchive.body],
    [getEvidenceUniverseControlKeys(publicationCorpusVersion).completionManifestKey, universe.body],
    [getCaseGraphFeatureControlKeys(publicationCorpusVersion).completionManifestKey, features.body],
    [getCaseGraphFeatureControlKeys(publicationCorpusVersion).rarityKey, features.rarityBody],
    [features.part.manifest.archive_key, features.part.archiveBody],
    [features.part.manifest.manifest_key, features.part.manifestBody],
    [getRelationshipInputControlKeys(binding).completionManifestKey, relationship.manifestBody],
    [relationship.part.manifest.archiveKey, relationship.part.archiveBody],
    [relationship.part.manifest.manifestKey, relationship.part.manifestBody],
  ]);
  for (const [key, body] of universe.partBodies) objects.set(key, body);
  for (const artifact of [...relationship.artifacts, relationship.indexArtifact]) {
    objects.set(artifact.receipt.archiveKey, artifact.archiveBody);
    objects.set(artifact.receipt.receiptKey, artifact.receiptBody);
  }
  for (const archive of [...publicGraphShardArchives, publicGraphManifestArchive]) {
    objects.set(archive.receipt.archiveKey, archive.archiveBody);
    objects.set(archive.receipt.receiptKey, archive.receiptBody);
  }
  const compactCalibration = {
    fixtureUse: calibration.fixtureUse,
    bundle: calibration.bundle,
    bundleBody: calibration.bundleBody,
    pairLineage: calibration.pairLineage,
    contextualLineage: calibration.contextualLineage,
    pairReceipt: calibration.pairReceipt,
    contextualReceipt: calibration.contextualReceipt,
    pairReceiptBody: calibration.pairReceiptBody,
    contextualReceiptBody: calibration.contextualReceiptBody,
    setReceipt: calibration.setReceipt,
    setReceiptBody: calibration.setReceiptBody,
    pair: {
      artifactBody: calibration.pair.artifactBody,
      trustPolicyBody: calibration.pair.trustPolicyBody,
      receipt: calibration.pair.receipt,
      receiptBody: calibration.pair.receiptBody,
    },
    contextual: {
      artifactBody: calibration.contextual.artifactBody,
      trustPolicyBody: calibration.contextual.trustPolicyBody,
      receipt: calibration.contextual.receipt,
      receiptBody: calibration.contextual.receiptBody,
    },
  };
  return {
    manifest,
    manifestBody,
    manifestSha256,
    accountingReceipt,
    accountingReceiptBody,
    accountingReceiptSha256,
    completion,
    completionBody,
    keys: {
      manifestKey: keys.manifestKey,
      accountingReceiptKey: keys.accountingReceiptKey,
      pairCalibrationReceiptKey: keys.pairCalibrationReceiptKey,
      contextualCalibrationReceiptKey: keys.contextualCalibrationReceiptKey,
      calibrationSetReceiptKey: keys.calibrationSetReceiptKey,
      pairCalibrationArtifactKey: keys.pairCalibrationArtifactKey,
      pairCalibrationTrustPolicyKey: keys.pairCalibrationTrustPolicyKey,
      contextualCalibrationArtifactKey: keys.contextualCalibrationArtifactKey,
      contextualCalibrationTrustPolicyKey: keys.contextualCalibrationTrustPolicyKey,
      humanReviewBundleKey: keys.humanReviewBundleKey,
      contextualRelationshipCompletionKey: keys.contextualRelationshipCompletionKey,
      completionKey: keys.completionManifestKey,
    },
    objects,
    universeCompletion: universe.completion,
    universeCompletionBody: universe.body,
    featureCompletion: features.completion,
    featureCompletionBody: features.body,
    relationshipInputManifest: relationship.manifest,
    relationshipInputManifestBody: relationship.manifestBody,
    relationship,
    publicGraph,
    publicGraphShardArchives,
    publicGraphManifestArchive,
    densityArtifact,
    densityArchive,
    productionCompatibility,
    calibration: compactCalibration,
    contextualCompletion,
    fixtureUse: FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
  };
};

export type PublicationV2Fixture = ReturnType<typeof buildPublicationV2FixtureUncached>;
let cachedPublicationV2Fixture: PublicationV2Fixture | null = null;

const cloneFixtureObjectMap = (objects: Map<string, Buffer>) => new Map(
  [...objects].map(([key, body]) => [key, Buffer.from(body)] as const),
);

const decodePublicationV2FixtureCache = (cachePath: string): PublicationV2Fixture => {
  const fixture = deserialize(readFileSync(cachePath)) as PublicationV2Fixture;
  if (!(fixture.objects instanceof Map) || fixture.objects.size === 0) {
    throw new Error('case_vortex_publication_v2_fixture_cache_invalid');
  }
  for (const body of fixture.objects.values()) {
    if (!Buffer.isBuffer(body)) {
      throw new Error('case_vortex_publication_v2_fixture_cache_invalid');
    }
  }
  return fixture;
};

export const buildPublicationV2Fixture = (): PublicationV2Fixture => {
  if (!cachedPublicationV2Fixture) {
    const cachePath = process.env.CASE_VORTEX_PUBLICATION_V2_FIXTURE_CACHE;
    cachedPublicationV2Fixture = cachePath
      ? decodePublicationV2FixtureCache(cachePath)
      : buildPublicationV2FixtureUncached();
  }
  return {
    ...cachedPublicationV2Fixture,
    objects: cloneFixtureObjectMap(cachedPublicationV2Fixture.objects),
  };
};

export const loadPublicationV2Fixture = buildPublicationV2Fixture;

export const buildStructurallyBoundPublicationV2Fixture = buildPublicationV2Fixture;

export const buildPublicationV2ActivationRow = (fixture: {
  manifest: CaseGraphPublicManifest;
  completion: CaseGraphPublicationCandidateCompletion;
  completionBody?: Buffer;
  accountingReceipt: CaseVortexCorpusAccountingReceipt;
  relationship?: { completion: FullCorpusRelationshipCompletion };
}) => {
  const relationship = fixture.relationship?.completion
    ?? buildPublicationV2Fixture().relationship.completion;
  const keys = getCaseGraphPublicationKeys(fixture.manifest.corpusVersion);
  const publicManifestSha256 = fixture.completion.manifest_sha256;
  const completionManifestSha256 = rawSha(
    fixture.completionBody ?? encodeCaseGraphPublicationCandidateCompletion(fixture.completion),
  );
  const accountingSha256 = fixture.completion.accounting_receipt_sha256;
  const universeCount = relationship.universeRecordCount;
  const counts = relationship.addressKindCounts;
  const typedEdgeTypeCounts = { ...relationship.typedEdgeTypeCounts };
  const relationshipAccounting = {
    universe_record_count: universeCount,
    address_kind_counts: {
      sighting: counts.sighting,
      document: counts.document,
      photo: counts.photo,
      video: counts.video,
    },
    candidate_pair_count: relationship.candidatePairCount,
    typed_edge_count: relationship.typedEdgeCount,
    typed_edge_type_counts: typedEdgeTypeCounts,
    skipped_group_count: relationship.skippedGroupCount,
    skipped_estimated_pair_count: relationship.skippedEstimatedPairCount,
    relationship_status_counts: {
      linked: relationship.linkedAddressCount,
      candidate_only: relationship.candidateOnlyAddressCount,
      isolated: relationship.isolatedAddressCount,
    },
    address_ledger_set_sha256: relationship.addressLedgerSetSha256,
  };
  const text = (value: number) => String(value);
  const activatedAt = '2026-07-18T13:00:00.000Z';

  return {
    publication_id: '00000000-0000-4000-8000-000000000010',
    run_id: '10000000-0000-4000-8000-000000000001',
    corpus_version: fixture.manifest.corpusVersion,
    run_corpus_version: fixture.manifest.corpusVersion,
    public_manifest_key: fixture.completion.manifest_key,
    publication_manifest_sha256: publicManifestSha256,
    public_manifest_sha256: publicManifestSha256,
    receipt_public_manifest_sha256: publicManifestSha256,
    active: true,
    activated_at: activatedAt,
    deactivated_at: null,
    run_present: true,
    snapshot_present: true,
    receipt_present: true,
    run_status: 'completed',
    lineage_version: 'case-vortex-lineage-v2',
    run_snapshot_id: fixture.manifest.lineage.snapshot.snapshotId,
    snapshot_policy_matches: true,
    snapshot_at_matches: true,
    materialized_at_matches: true,
    mvcc_matches: true,

    run_universe_sha256: fixture.manifest.lineage.universe.archiveSetSha256,
    run_feature_sha256: fixture.manifest.lineage.features.archiveSetSha256,
    run_relationship_input_sha256: fixture.manifest.lineage.relationshipInput.archiveSetSha256,
    run_relationship_manifest_digest: fixture.manifest.lineage.relationshipInput.manifestDigest,
    run_relationship_schema_version: fixture.manifest.models.relationshipSchemaVersion,
    run_relationship_policy_version: fixture.manifest.lineage.relationship.policyVersion,
    run_relationship_policy_sha256: fixture.manifest.lineage.relationship.policySha256,
    run_relationship_model_id: fixture.manifest.lineage.relationship.modelId,
    run_relationship_model_version: fixture.manifest.lineage.relationship.modelVersion,
    run_relationship_model_sha256: fixture.manifest.lineage.relationship.modelSha256,
    run_relationship_run_index_digest: fixture.manifest.lineage.relationshipRun.indexDigest,
    run_relationship_run_artifact_set_sha256:
      fixture.manifest.lineage.relationshipRun.artifactSetSha256,
    run_relationship_completion_digest: fixture.manifest.lineage.relationshipRun.completionDigest,
    run_pair_calibration_id: fixture.manifest.lineage.calibration.pair.receiptId,
    run_pair_calibration_sha256: fixture.manifest.lineage.calibration.pair.receiptSha256,
    run_contextual_calibration_id: fixture.manifest.lineage.calibration.contextual.receiptId,
    run_contextual_calibration_sha256: fixture.manifest.lineage.calibration.contextual.receiptSha256,
    run_calibration_set_sha256: fixture.manifest.lineage.calibration.set.calibrationSetSha256,
    run_graph_sha256: fixture.manifest.lineage.graph.artifactSetSha256,
    run_accounting_sha256: accountingSha256,
    run_completion_manifest_key: keys.completionManifestKey,
    run_completion_manifest_sha256: completionManifestSha256,

    run_universe_count: text(universeCount),
    run_relationship_input_count: text(universeCount),
    run_expected_eligible_count: text(universeCount),
    run_processed_eligible_count: text(universeCount),
    run_excluded_count: '0',
    run_legacy_candidate_count: text(relationship.candidatePairCount),
    run_legacy_edge_count: text(relationship.typedEdgeCount),
    run_legacy_isolated_count: text(relationship.isolatedAddressCount),
    run_candidate_pair_count: text(relationship.candidatePairCount),
    run_typed_edge_count: text(relationship.typedEdgeCount),
    run_skipped_group_count: text(relationship.skippedGroupCount),
    run_skipped_estimated_pair_count: text(relationship.skippedEstimatedPairCount),
    run_linked_address_count: text(relationship.linkedAddressCount),
    run_candidate_only_address_count: text(relationship.candidateOnlyAddressCount),
    run_isolated_address_count: text(relationship.isolatedAddressCount),
    run_sighting_record_count: text(counts.sighting),
    run_document_record_count: text(counts.document),
    run_photo_record_count: text(counts.photo),
    run_video_record_count: text(counts.video),
    run_typed_edge_type_counts: typedEdgeTypeCounts,
    run_address_ledger_set_sha256: relationship.addressLedgerSetSha256,
    run_relationship_accounting: relationshipAccounting,

    receipt_version: 'case-vortex-publication-receipt-v2',
    snapshot_id: fixture.manifest.lineage.snapshot.snapshotId,
    universe_archive_set_sha256: fixture.manifest.lineage.universe.archiveSetSha256,
    feature_archive_set_sha256: fixture.manifest.lineage.features.archiveSetSha256,
    relationship_input_archive_set_sha256: fixture.manifest.lineage.relationshipInput.archiveSetSha256,
    relationship_input_manifest_digest: fixture.manifest.lineage.relationshipInput.manifestDigest,
    relationship_schema_version: fixture.manifest.models.relationshipSchemaVersion,
    relationship_policy_version: fixture.manifest.lineage.relationship.policyVersion,
    relationship_policy_sha256: fixture.manifest.lineage.relationship.policySha256,
    relationship_model_id: fixture.manifest.lineage.relationship.modelId,
    relationship_model_version: fixture.manifest.lineage.relationship.modelVersion,
    relationship_model_sha256: fixture.manifest.lineage.relationship.modelSha256,
    relationship_run_index_digest: fixture.manifest.lineage.relationshipRun.indexDigest,
    relationship_run_artifact_set_sha256: fixture.manifest.lineage.relationshipRun.artifactSetSha256,
    relationship_completion_digest: fixture.manifest.lineage.relationshipRun.completionDigest,
    pair_calibration_id: fixture.manifest.lineage.calibration.pair.receiptId,
    pair_calibration_sha256: fixture.manifest.lineage.calibration.pair.receiptSha256,
    contextual_calibration_id: fixture.manifest.lineage.calibration.contextual.receiptId,
    contextual_calibration_sha256: fixture.manifest.lineage.calibration.contextual.receiptSha256,
    calibration_set_sha256: fixture.manifest.lineage.calibration.set.calibrationSetSha256,
    graph_artifact_set_sha256: fixture.manifest.lineage.graph.artifactSetSha256,
    corpus_accounting_digest: accountingSha256,
    completion_manifest_key: keys.completionManifestKey,
    completion_manifest_sha256: completionManifestSha256,
    universe_record_count: text(universeCount),
    sighting_record_count: text(counts.sighting),
    document_record_count: text(counts.document),
    photo_record_count: text(counts.photo),
    video_record_count: text(counts.video),
    relationship_input_record_count: text(universeCount),
    graph_record_count: text(universeCount),
    user_interface_record_count: text(universeCount),
    represented_record_count: text(fixture.accountingReceipt.representedTotal),
    excluded_record_count: text(fixture.accountingReceipt.excludedTotal),
    observed_record_count: text(fixture.accountingReceipt.observedTotal),
    candidate_pair_count: text(relationship.candidatePairCount),
    typed_edge_count: text(relationship.typedEdgeCount),
    skipped_group_count: text(relationship.skippedGroupCount),
    skipped_estimated_pair_count: text(relationship.skippedEstimatedPairCount),
    linked_address_count: text(relationship.linkedAddressCount),
    candidate_only_address_count: text(relationship.candidateOnlyAddressCount),
    isolated_address_count: text(relationship.isolatedAddressCount),
    typed_edge_type_counts: typedEdgeTypeCounts,
    address_ledger_set_sha256: relationship.addressLedgerSetSha256,
    relationship_accounting: relationshipAccounting,

    receipt_snapshot_id: fixture.manifest.lineage.snapshot.snapshotId,
    receipt_relationship_schema_version: fixture.manifest.models.relationshipSchemaVersion,
    receipt_relationship_policy_version: fixture.manifest.lineage.relationship.policyVersion,
    receipt_relationship_policy_sha256: fixture.manifest.lineage.relationship.policySha256,
    receipt_relationship_model_id: fixture.manifest.lineage.relationship.modelId,
    receipt_relationship_model_version: fixture.manifest.lineage.relationship.modelVersion,
    receipt_relationship_model_sha256: fixture.manifest.lineage.relationship.modelSha256,
    receipt_pair_calibration_id: fixture.manifest.lineage.calibration.pair.receiptId,
    receipt_pair_calibration_sha256: fixture.manifest.lineage.calibration.pair.receiptSha256,
    receipt_contextual_calibration_id: fixture.manifest.lineage.calibration.contextual.receiptId,
    receipt_contextual_calibration_sha256: fixture.manifest.lineage.calibration.contextual.receiptSha256,
    receipt_calibration_set_sha256: fixture.manifest.lineage.calibration.set.calibrationSetSha256,

    ledger_total: text(universeCount),
    ledger_sighting: text(counts.sighting),
    ledger_document: text(counts.document),
    ledger_photo: text(counts.photo),
    ledger_video: text(counts.video),
    ledger_processed: text(fixture.accountingReceipt.relationshipProcessedTotal),
    ledger_not_applicable: text(fixture.accountingReceipt.relationshipNotApplicableTotal),
  };
};
