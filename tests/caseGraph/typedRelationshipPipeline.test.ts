import { describe, expect, it } from 'vitest';

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
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  projectEvidenceUniverseNode,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import type {
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from '../../src/caseGraph/archiveTypes';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
} from '../../src/caseGraph/relationshipInputArchive';
import {
  buildRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputFactDraft,
  type RelationshipInputOriginDraft,
  type RelationshipInputRecordDraft,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import { buildTypedRelationshipRarityIndex } from '../../src/caseGraph/typedRelationshipEngine';
import {
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
  buildFullCorpusRelationshipCompletion,
  decodeFullCorpusPostingMapManifest,
  FULL_CORPUS_TYPED_EDGE_TYPES,
  reduceFullCorpusCandidateShard,
  reduceFullCorpusPostingShard,
  type FullCorpusCandidateFragment,
  type FullCorpusPostingFragment,
} from '../../src/caseGraph/typedRelationshipPipeline';
import {
  archiveFullCorpusRelationshipRun,
  buildFullCorpusRelationshipArchiveObject,
  buildFullCorpusRelationshipRunIndexPointer,
  decodeFullCorpusRelationshipArchiveObject,
  decodeFullCorpusRelationshipArchiveReceipt,
  readVerifiedFullCorpusRelationshipArchiveObject,
  writeFullCorpusRelationshipArchiveObject,
} from '../../src/caseGraph/typedRelationshipPipelineArchive';
import {
  buildContextualRelationshipCompletionArtifact,
} from '../../src/caseGraph/contextualRelationshipCompletion';
import {
  buildFullCorpusPublicGraphArtifacts,
  buildFullCorpusPublicRenderPackingReceipt,
  decodeFullCorpusPublicGraphManifest,
  decodeFullCorpusPublicGraphArchiveObject,
  decodeFullCorpusPublicGraphShard,
  encodeFullCorpusPublicGraphArchiveObject,
  fullCorpusPublicRenderTimestamp,
  indexFullCorpusPublicGraphReferences,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT,
  PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING,
  verifyFullCorpusPublicGraphArtifacts,
  type FullCorpusPublicGraphArtifacts,
  type FullCorpusPublicRenderRow,
} from '../../src/caseGraph/typedRelationshipPublicGraph';
import {
  buildStructuralTestOnlyProductionContextualCompletion,
} from './contextualRelationshipProductionCompletionTestSupport';

const addresses = [
  'sighting:00000000-0000-4000-8000-000000000001',
  'document:official-record-2',
  'photo:archive-photo-3',
  'video:witness-video-4',
  'sighting:00000000-0000-4000-8000-000000000005',
  'document:official-record-6',
  'photo:archive-photo-7',
  'video:witness-video-8',
] as const;

const binding = (overrides: Partial<RelationshipInputUniverseBinding> = {}): RelationshipInputUniverseBinding => ({
  snapshotId: '00000000-0000-4000-8000-000000000099',
  corpusVersion: 'full-corpus-pipeline-test-v2',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: addresses.length,
  ...overrides,
});

const structuralProductionContextualCalibrationReceipt = (
  seed = 'full-corpus-pipeline',
): ContextualRelationshipCalibrationReceipt => {
  const calibrationCoreSha256 = contextualExplanationSha256(`structural-contextual-core:${seed}`);
  const withoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
    recordType: 'contextual_relationship_calibration_receipt',
    schemaVersion: 'case-graph-contextual-relationship-calibration-v1',
    canonicalVersion: CONTEXTUAL_EXPLANATION_CANONICAL_VERSION,
    receiptId: getContextualRelationshipCalibrationReceiptId(calibrationCoreSha256),
    decision: 'production_gates_passed',
    calibrationCoreSha256,
    lineageSha256: contextualExplanationSha256(`structural-contextual-lineage:${seed}`),
    auditPlanSha256: contextualExplanationSha256(`structural-contextual-audit:${seed}`),
    trustPolicyDigest: contextualExplanationSha256(`structural-contextual-trust:${seed}`),
    evaluationSetSha256: contextualExplanationSha256(`structural-contextual-evaluation:${seed}`),
    labelSetSha256: contextualExplanationSha256(`structural-contextual-labels:${seed}`),
    metricsSha256: contextualExplanationSha256(`structural-contextual-metrics:${seed}`),
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

const structuralZeroContextualCompletion = (
  universeBinding: RelationshipInputUniverseBinding,
  seed = 'full-corpus-pipeline',
) => {
  const receipt = structuralProductionContextualCalibrationReceipt(seed);
  return buildStructuralTestOnlyProductionContextualCompletion({
    binding: universeBinding,
    contextualCalibrationReceipt: receipt,
    contextualCalibrationReceiptBody: serializeContextualRelationshipCalibrationReceipt(receipt),
  });
};

const origin = (address: string, field: string): RelationshipInputOriginDraft => ({
  sourceAddress: address,
  sourceField: field,
  sourceTextSha256: null,
  sourceTextBytes: null,
  supportingSpans: [],
  extraction: { method: 'structured', version: 'full-corpus-pipeline-fixture-v2' },
});

const termFact = (
  family: 'visual' | 'behavioural',
  termId: string,
  address: string,
): RelationshipInputFactDraft => ({
  family,
  predicate: family === 'visual' ? 'observed_shape' : 'observed_motion',
  value: { kind: 'term', termId, vocabularyVersion: `${family}-v2` },
  confidence: 0.97,
  uncertainty: { level: 'low', reasons: ['single_report'] },
  precision: { kind: 'categorical', vocabularyVersion: `${family}-v2` },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, `${family}.${termId}`)],
});

const timestampFact = (address: string, timestamp: string): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_timestamp',
  value: { kind: 'timestamp', timestamp, datePrecision: 'exact' },
  confidence: 0.98,
  uncertainty: { level: 'low', reasons: ['clock_rounding'] },
  precision: { kind: 'exact' },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'event.timestamp')],
});

const locationFact = (address: string, lat: number, lon: number): RelationshipInputFactDraft => ({
  family: 'space_time',
  predicate: 'event_location',
  value: { kind: 'geo_point', lat, lon, spatialPrecisionKm: 1 },
  confidence: 0.96,
  uncertainty: { level: 'low', reasons: ['coordinate_rounding'] },
  precision: { kind: 'approximate', unit: 'km', tolerance: 1 },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'event.location')],
});

const durationFact = (address: string, seconds: number): RelationshipInputFactDraft => ({
  family: 'duration',
  predicate: 'observed_duration',
  value: { kind: 'duration', seconds },
  confidence: 0.95,
  uncertainty: { level: 'low', reasons: ['witness_rounding'] },
  precision: { kind: 'approximate', unit: 'seconds', tolerance: 1 },
  missingness: { status: 'present', reasons: [] },
  origins: [origin(address, 'event.duration')],
});

const record = (params: {
  index: number;
  facts?: RelationshipInputFactDraft[];
  crossReferences?: RelationshipInputRecordDraft['crossReferences'];
  sourceId?: string;
  sourceAssertions?: RelationshipInputRecordDraft['sourceAssertions'];
}) => {
  const address = addresses[params.index];
  return buildRelationshipInputRecord({
    binding: binding(),
    address,
    source: {
      sourceId: params.sourceId || `source-${params.index + 1}`,
      sourceRecordId: `record-${params.index + 1}`,
      registryVersion: 'source-registry-v2',
      lineageId: `lineage-${params.index + 1}`,
      dependencyRisk: 'low',
    },
    facts: params.facts || [],
    recordMissingness: [],
    duplicateLineage: null,
    crossReferences: params.crossReferences || [],
    sourceAssertions: params.sourceAssertions || [],
    narrativeVector: {
      status: 'missing',
      modelId: 'narrative-model',
      modelVersion: 'v2',
      dimensions: 16,
      normalization: 'l2',
      inputSha256: null,
      vectorSha256: null,
      reason: 'no_narrative',
    },
    governedReferences: [],
  });
};

const fixture = () => {
  const records = [
    record({
      index: 0,
      facts: [
        termFact('visual', 'triangle', addresses[0]),
        termFact('behavioural', 'hover', addresses[0]),
        timestampFact(addresses[0], '2025-01-01T00:00:00.000Z'),
        locationFact(addresses[0], 51.5000, -0.1000),
        durationFact(addresses[0], 60),
      ],
    }),
    record({
      index: 1,
      facts: [
        termFact('visual', 'triangle', addresses[1]),
        termFact('behavioural', 'hover', addresses[1]),
        timestampFact(addresses[1], '2025-01-01T00:04:00.000Z'),
        locationFact(addresses[1], 51.5050, -0.1050),
        durationFact(addresses[1], 62),
      ],
    }),
    record({
      index: 2,
      facts: [termFact('visual', 'photo-only-value', addresses[2])],
      crossReferences: [{
        targetAddress: addresses[0],
        relation: 'media_attachment',
        origins: [origin(addresses[2], 'media.parent')],
      }],
    }),
    record({
      index: 3,
      sourceId: 'same-source',
      facts: [termFact('visual', 'common', addresses[3])],
    }),
    record({
      index: 4,
      sourceId: 'same-source',
      facts: [termFact('visual', 'common', addresses[4])],
    }),
    record({
      index: 5,
      sourceId: 'independent-a',
      facts: [termFact('visual', 'common', addresses[5])],
      sourceAssertions: [{
        counterpartySourceId: 'independent-b',
        classification: 'independent',
        basis: 'documented_separate_origin',
        origins: [origin(addresses[5], 'source.independence')],
      }],
    }),
    record({
      index: 6,
      sourceId: 'independent-b',
      facts: [termFact('visual', 'common', addresses[6])],
      sourceAssertions: [{
        counterpartySourceId: 'independent-a',
        classification: 'independent',
        basis: 'documented_separate_origin',
        origins: [origin(addresses[6], 'source.independence')],
      }],
      crossReferences: [{
        targetAddress: 'document:not-in-the-immutable-universe',
        relation: 'cites',
        origins: [origin(addresses[6], 'citation.target')],
      }],
    }),
    record({ index: 7 }),
  ];
  const sorted = [...records].sort((left, right) => left.address < right.address ? -1 : 1);
  const part0 = buildRelationshipInputPart({ binding: binding(), partNumber: 0, records: sorted.slice(0, 4) });
  const part1 = buildRelationshipInputPart({ binding: binding(), partNumber: 1, records: sorted.slice(4) });
  const manifest = buildRelationshipInputSnapshotManifest({
    binding: binding(),
    parts: [part0.manifest, part1.manifest],
    generatedAt: '2026-07-18T00:00:00.000Z',
  });
  const rarity = buildTypedRelationshipRarityIndex(records, binding());
  return { records, sorted, parts: [part0, part1], manifest, rarity };
};

const runPipeline = (overrides: { matchableValueCap?: number } = {}) => {
  const data = fixture();
  const postingShardCount = 4;
  const pairShardCount = 4;
  const fragments = data.parts.flatMap((part, inputPartNumber) => buildFullCorpusPostingFragments({
    records: [...part.records].reverse(),
    inputPartNumber,
    relationshipInputManifest: data.manifest,
    rarityIndex: data.rarity,
    postingShardCount,
  }));
  const postingMap = buildFullCorpusPostingMapManifest({
    relationshipInputManifest: data.manifest,
    rarityIndex: data.rarity,
    postingShardCount,
    fragments: [...fragments].reverse(),
  });
  const postingReductions = Array.from({ length: postingShardCount }, (_, postingShard) => (
    reduceFullCorpusPostingShard({
      postingMap,
      fragments: fragments.filter((fragment) => fragment.postingShard === postingShard),
      postingShard,
      pairShardCount,
      caps: {
        matchableValue: overrides.matchableValueCap ?? 2,
        maxPairsPerGroup: 1_000,
      },
    })
  ));
  const candidateFragments = postingReductions.flatMap((reduction) => reduction.candidateFragments);
  const pairReducers = Array.from({ length: pairShardCount }, (_, pairShard) => (
    reduceFullCorpusCandidateShard({
      postingMap,
      rarityIndex: data.rarity,
      fragments: candidateFragments.filter((fragment) => fragment.pairShard === pairShard),
      pairShard,
      pairShardCount,
    })
  ));
  const contextual = structuralZeroContextualCompletion(binding());
  const completion = buildFullCorpusRelationshipCompletion({
    postingMap,
    postingReductions,
    pairReducers,
    contextualCompletion: contextual.artifact,
    expectedContextualCalibration: contextual.expectedCalibration,
    addressLedgerShardCount: 4,
  });
  return {
    ...data,
    fragments,
    postingMap,
    postingReductions,
    candidateFragments,
    pairReducers,
    contextual,
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

const replaceDigest = <T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  field: K,
) => {
  const without = { ...value };
  delete without[field];
  value[field] = relationshipInputSha256(without) as T[K];
  return value;
};

const universeNodes = () => addresses.map((address, index) => {
  const separator = address.indexOf(':');
  const kind = address.slice(0, separator) as 'sighting' | 'document' | 'photo' | 'video';
  const recordId = address.slice(separator + 1);
  return projectEvidenceUniverseNode({
    kind,
    recordId,
    source: `public-source-${index + 1}`,
    sourceRecordId: `public-record-${index + 1}`,
    title: `Evidence ${index + 1}`,
    summary: `Governed public summary for evidence ${index + 1}.`,
    canonicalUrl: `https://example.test/evidence/${index + 1}`,
    previewUrl: kind === 'photo' || kind === 'video' ? `https://example.test/preview/${index + 1}` : null,
    eventTimestamp: index < 2 ? `2025-01-01T00:0${index * 4}:00.000Z` : null,
    lat: index < 2 ? 51.5 + index * 0.005 : null,
    lon: index < 2 ? -0.1 - index * 0.005 : null,
    location: index < 2 ? 'London' : null,
    countryCode: index < 2 ? 'GB' : null,
    linkedSightingId: kind === 'photo' ? addresses[0].slice(addresses[0].indexOf(':') + 1) : null,
    updatedAt: '2026-07-18T00:00:00.000Z',
    public: true,
  });
});

describe('full-corpus typed relationship pipeline', () => {
  it('maps every sighting, document, photo, and video through deterministic shards and retains isolated records', () => {
    const first = runPipeline();
    const second = runPipeline();

    expect(first.postingMap).toEqual(second.postingMap);
    expect(first.completion).toEqual(second.completion);
    expect(first.postingMap.universeRecordCount).toBe(addresses.length);
    expect(first.postingMap.addressKindCounts).toEqual({ sighting: 2, document: 2, photo: 2, video: 2 });
    expect(first.completion.universeRecordCount).toBe(addresses.length);
    expect(first.completion.linkedAddressCount).toBeGreaterThanOrEqual(3);
    expect(first.completion.isolatedAddressCount).toBeGreaterThanOrEqual(1);
    expect(first.completion.linkedAddressCount
      + first.completion.candidateOnlyAddressCount
      + first.completion.isolatedAddressCount).toBe(addresses.length);

    const states = first.completion.addressLedgerShards.flatMap((shard) => shard.states);
    expect(new Set(states.map((state) => state.address))).toEqual(new Set(addresses));
    expect(states.find((state) => state.address === addresses[7])?.status).toBe('isolated');
    expect(first.completion.plainEnglish).toContain(`All ${addresses.length} immutable evidence addresses were retained`);
    expect(first.completion.completionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(first.completion.typedEdgeTypeCounts).sort()).toEqual(
      [...FULL_CORPUS_TYPED_EDGE_TYPES].sort(),
    );
    expect(Object.values(first.completion.typedEdgeTypeCounts)
      .reduce((sum, count) => sum + count, 0)).toBe(first.completion.typedEdgeCount);
  });

  it('routes direct media provenance without a rare shared term and deduplicates overlapping spatial/duration routes', () => {
    const result = runPipeline();
    const evaluations = result.pairReducers.flatMap((reducer) => reducer.evaluations);
    const mediaPair = evaluations.find((evaluation) => {
      const endpoints = evaluation.edges.flatMap((edge) => edge.endpoints)
        .filter((endpoint) => endpoint.kind === 'evidence')
        .map((endpoint) => endpoint.id);
      return endpoints.includes(addresses[0]) && endpoints.includes(addresses[2]);
    });
    expect(mediaPair?.edges.some((edge) => edge.edgeType === 'provenance')).toBe(true);

    const closePairEvaluations = evaluations.filter((evaluation) => {
      const digests = new Set(evaluation.inputRecordDigests);
      return digests.has(result.records[0].recordDigest) && digests.has(result.records[1].recordDigest);
    });
    expect(closePairEvaluations).toHaveLength(1);
    expect(closePairEvaluations[0].edges.some((edge) => edge.edgeType === 'space_time_candidate')).toBe(true);
    expect(closePairEvaluations[0].edges.some((edge) => edge.edgeType === 'similar_duration')).toBe(true);
    expect(closePairEvaluations[0].edges.every((edge) => (
      edge.receipt.plainEnglish.length > 40
      && edge.receipt.receiptId.startsWith('typed-receipt:')
    ))).toBe(true);
  });

  it('routes same-source dependency and reciprocal governed source assertions without a categorical match', () => {
    const result = runPipeline();
    const edges = result.pairReducers.flatMap((reducer) => reducer.edges);
    const endpointSet = (edge: (typeof edges)[number]) => new Set(edge.endpoints
      .filter((endpoint) => endpoint.kind === 'evidence')
      .map((endpoint) => endpoint.id));

    expect(edges.some((edge) => edge.edgeType === 'source_dependency'
      && endpointSet(edge).has(addresses[3])
      && endpointSet(edge).has(addresses[4]))).toBe(true);
    expect(edges.some((edge) => edge.edgeType === 'source_independence'
      && endpointSet(edge).has(addresses[5])
      && endpointSet(edge).has(addresses[6]))).toBe(true);
  });

  it('skips high-frequency groups before quadratic expansion and emits immutable machine/plain-English receipts', () => {
    const result = runPipeline();
    const skipped = result.postingReductions.flatMap((reduction) => reduction.skippedGroups);
    const highFrequency = skipped.find((receipt) => receipt.reasonCode === 'high_frequency_group_skipped'
      && receipt.distinctAddressCount === 4);
    const unresolved = skipped.find((receipt) => receipt.reasonCode === 'direct_target_missing');

    expect(highFrequency).toMatchObject({
      configuredPostingCap: 2,
      estimatedPairCount: 6,
      reasonCode: 'high_frequency_group_skipped',
    });
    expect(highFrequency?.receiptId).toMatch(/^skip:[a-f0-9]{64}$/);
    expect(highFrequency?.plainEnglish).toContain('unbounded quadratic expansion');
    expect(unresolved?.plainEnglish).toContain('not present in the immutable relationship-input universe');
    expect(result.completion.skippedGroupCount).toBe(skipped.length);
    expect(result.completion.skippedEstimatedPairCount).toBeGreaterThanOrEqual(6);
  });

  it('fails closed on partial maps, mixed lineage, fragment tampering, and incomplete reducer sets', () => {
    const data = fixture();
    const fragments = data.parts.flatMap((part, inputPartNumber) => buildFullCorpusPostingFragments({
      records: part.records,
      inputPartNumber,
      relationshipInputManifest: data.manifest,
      rarityIndex: data.rarity,
      postingShardCount: 2,
    }));
    expect(() => buildFullCorpusPostingMapManifest({
      relationshipInputManifest: data.manifest,
      rarityIndex: data.rarity,
      postingShardCount: 2,
      fragments: fragments.slice(1),
    })).toThrow(/identity_ledger_part_mismatch|identity_ledger_universe_mismatch/);

    const tampered = structuredClone(fragments[0]) as FullCorpusPostingFragment;
    tampered.postings[0].evidenceIds.push(`origin:${'b'.repeat(64)}`);
    expect(() => buildFullCorpusPostingMapManifest({
      relationshipInputManifest: data.manifest,
      rarityIndex: data.rarity,
      postingShardCount: 2,
      fragments: [tampered, ...fragments.slice(1)],
    })).toThrow(/full_corpus_relationship_posting_(?:invalid|fragment_digest_mismatch)/);

    const complete = runPipeline();
    const candidateTamper = structuredClone(complete.candidateFragments[0]) as FullCorpusCandidateFragment;
    candidateTamper.lineage.binding = binding({ universeArchiveSetSha256: 'f'.repeat(64) });
    expect(() => reduceFullCorpusCandidateShard({
      postingMap: complete.postingMap,
      rarityIndex: complete.rarity,
      fragments: [candidateTamper],
      pairShard: candidateTamper.pairShard,
      pairShardCount: 4,
    })).toThrow('full_corpus_relationship_lineage_mismatch');

    expect(() => buildFullCorpusRelationshipCompletion({
      postingMap: complete.postingMap,
      postingReductions: complete.postingReductions.slice(1),
      pairReducers: complete.pairReducers,
      contextualCompletion: complete.contextual.artifact,
      expectedContextualCalibration: complete.contextual.expectedCalibration,
    })).toThrow('full_corpus_relationship_posting_reduction_incomplete');
  });

  it('rejects self-rehashed model lineage and pair reducer accounting forgeries', () => {
    const result = runPipeline();
    const wrongModel = structuredClone(result.postingMap) as typeof result.postingMap;
    (wrongModel.lineage.typedRelationshipModel as { modelVersion: string }).modelVersion = '9.9.9';
    replaceDigest(wrongModel as unknown as Record<string, unknown>, 'mapDigest');
    expect(() => decodeFullCorpusPostingMapManifest(wrongModel)).toThrow(
      'full_corpus_relationship_policy_lineage_mismatch',
    );

    const reducerIndex = result.pairReducers.findIndex((reducer) => reducer.evaluations.length > 0);
    expect(reducerIndex).toBeGreaterThanOrEqual(0);
    const forgedCountReducers = structuredClone(result.pairReducers);
    forgedCountReducers[reducerIndex].evaluatedAddressCount += 1;
    replaceDigest(
      forgedCountReducers[reducerIndex] as unknown as Record<string, unknown>,
      'resultDigest',
    );
    expect(() => buildFullCorpusRelationshipCompletion({
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: forgedCountReducers,
      contextualCompletion: result.contextual.artifact,
      expectedContextualCalibration: result.contextual.expectedCalibration,
      addressLedgerShardCount: 4,
    })).toThrow('full_corpus_relationship_pair_reducer_evaluated_address_mismatch');

    const edgeReducerIndex = result.pairReducers.findIndex((reducer) => reducer.edges.length > 0);
    expect(edgeReducerIndex).toBeGreaterThanOrEqual(0);
    const forgedEdgeReducers = structuredClone(result.pairReducers);
    forgedEdgeReducers[edgeReducerIndex].edges = forgedEdgeReducers[edgeReducerIndex].edges.slice(1);
    forgedEdgeReducers[edgeReducerIndex].typedEdgeCount = forgedEdgeReducers[edgeReducerIndex].edges.length;
    replaceDigest(
      forgedEdgeReducers[edgeReducerIndex] as unknown as Record<string, unknown>,
      'resultDigest',
    );
    expect(() => buildFullCorpusRelationshipCompletion({
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: forgedEdgeReducers,
      contextualCompletion: result.contextual.artifact,
      expectedContextualCalibration: result.contextual.expectedCalibration,
      addressLedgerShardCount: 4,
    })).toThrow('full_corpus_relationship_pair_reducer_edge_accounting_mismatch');
  });

  it('rejects exact-schema archive forgeries even when all local digests are recomputed', () => {
    const result = runPipeline();
    const fragment = structuredClone(result.fragments[0]) as typeof result.fragments[0] & { injected?: string };
    fragment.injected = 'self-consistent-but-unknown';
    replaceDigest(fragment as unknown as Record<string, unknown>, 'fragmentDigest');
    expect(() => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'posting_fragment',
      value: fragment,
    })).toThrow('full_corpus_relationship_posting_fragment_invalid');

    const completion = structuredClone(result.completion);
    completion.linkedAddressCount += 1;
    replaceDigest(completion as unknown as Record<string, unknown>, 'completionDigest');
    expect(() => buildFullCorpusRelationshipArchiveObject({
      artifactType: 'completion',
      value: completion,
    })).toThrow('full_corpus_relationship_completion_accounting_mismatch');

    const valid = buildFullCorpusRelationshipArchiveObject({
      artifactType: 'completion',
      value: result.completion,
    });
    const receipt = structuredClone(valid.receipt) as typeof valid.receipt & { injected?: string };
    receipt.injected = 'unknown-receipt-field';
    replaceDigest(receipt as unknown as Record<string, unknown>, 'receiptDigest');
    expect(() => decodeFullCorpusRelationshipArchiveReceipt(receipt)).toThrow(
      'full_corpus_relationship_archive_receipt_invalid',
    );
  });

  it('binds the posting ledger to the exact relationship-input manifest and rarity record set', () => {
    const result = runPipeline();
    expect(result.postingMap.lineage).toMatchObject({
      relationshipInputManifestDigest: result.manifest.manifestDigest,
      relationshipInputArchiveSetSha256: result.manifest.archiveSetSha256,
      relationshipInputRecordSetSha256: result.rarity.recordSetSha256,
      rarityIndexDigest: result.rarity.indexDigest,
    });
    expect(result.postingMap.fragmentSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.completion.addressLedgerSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(relationshipInputSha256(result.completion.addressLedgerShards)).not.toBe('0'.repeat(64));
  });

  it('encodes byte-stable gzip artifacts, rejects tampering, and archives the whole run with immutable CAS reuse', async () => {
    const result = runPipeline();
    const artifact = buildFullCorpusRelationshipArchiveObject({
      artifactType: 'completion',
      value: result.completion,
    });
    const second = buildFullCorpusRelationshipArchiveObject({
      artifactType: 'completion',
      value: structuredClone(result.completion),
    });
    expect(second.archiveBody).toEqual(artifact.archiveBody);
    expect(second.receipt).toEqual(artifact.receipt);
    expect(decodeFullCorpusRelationshipArchiveObject({
      archiveBody: artifact.archiveBody,
      receipt: artifact.receipt,
    })).toEqual(result.completion);

    const corrupted = Buffer.from(artifact.archiveBody);
    corrupted[corrupted.length - 2] ^= 0xff;
    expect(() => decodeFullCorpusRelationshipArchiveObject({
      archiveBody: corrupted,
      receipt: artifact.receipt,
    })).toThrow('full_corpus_relationship_archive_compressed_receipt_mismatch');

    const storage = memoryStorage();
    const firstWrite = await archiveFullCorpusRelationshipRun({
      storage,
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualCompletion: result.contextual.artifact,
      expectedContextualCalibration: result.contextual.expectedCalibration,
      completion: result.completion,
    });
    expect(firstWrite.writes.every((write) => write.archiveStatus === 'written'
      && write.receiptStatus === 'written')).toBe(true);
    const secondWrite = await archiveFullCorpusRelationshipRun({
      storage,
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualCompletion: result.contextual.artifact,
      expectedContextualCalibration: result.contextual.expectedCalibration,
      completion: result.completion,
    });
    expect(secondWrite.index).toEqual(firstWrite.index);
    expect(secondWrite.writes.every((write) => write.archiveStatus === 'reused'
      && write.receiptStatus === 'reused')).toBe(true);
    const readBack = await readVerifiedFullCorpusRelationshipArchiveObject({
      storage,
      receiptKey: firstWrite.indexArtifact.receipt.receiptKey,
      expectedLineage: result.postingMap.lineage,
    });
    expect(readBack.value).toEqual(firstWrite.index);

    const collisionStorage = memoryStorage();
    collisionStorage.objects.set(artifact.receipt.archiveKey, {
      body: Buffer.from('different immutable bytes'),
      version: 'existing',
    });
    await expect(writeFullCorpusRelationshipArchiveObject(collisionStorage, artifact))
      .rejects.toThrow('full_corpus_relationship_archive_immutable_collision');
  });

  it('builds strict public node, edge, evaluation, and ego shards for every address including isolated evidence', async () => {
    const result = runPipeline();
    const storage = memoryStorage();
    const archived = await archiveFullCorpusRelationshipRun({
      storage,
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualCompletion: result.contextual.artifact,
      expectedContextualCalibration: result.contextual.expectedCalibration,
      completion: result.completion,
    });
    const artifacts = buildFullCorpusPublicGraphArtifacts({
      universeNodes: [...universeNodes()].reverse(),
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualRelationshipCompletion: result.contextual.artifact,
      expectedContextualCalibrationReceiptId: result.contextual.expectedCalibration.receiptId,
      expectedContextualCalibrationReceiptSha256: result.contextual.expectedCalibration.receiptSha256,
      completion: result.completion,
      runIndexPointer: archived.indexPointer,
      runIndexArchiveBody: archived.indexArtifact.archiveBody,
      runIndexReceipt: archived.indexArtifact.receipt,
      runArtifactReceipts: archived.index.objects.map((entry) => (
        storage.objects.get(entry.receiptKey)?.body as Buffer
      )),
      renderShardCount: 4,
      nodeShardCount: 4,
      edgeShardCount: 4,
      evaluationShardCount: 4,
      egoShardCount: 4,
    });
    expect(verifyFullCorpusPublicGraphArtifacts(artifacts)).toEqual(artifacts);
    expect(artifacts.manifest.universeNodeCount).toBe(addresses.length);
    expect(artifacts.manifest.addressKindCounts).toEqual({ sighting: 2, document: 2, photo: 2, video: 2 });
    expect(artifacts.manifest.renderRowCount).toBe(addresses.length);
    expect(artifacts.manifest.renderAddressKindCounts).toEqual(artifacts.manifest.addressKindCounts);
    expect(artifacts.manifest.renderUncompressedBytes).toBeGreaterThan(0);
    expect(artifacts.manifest.renderCompressedBytes).toBeGreaterThan(0);
    expect(artifacts.manifest.renderFormat).toBe(PUBLIC_TYPED_RELATIONSHIP_RENDER_FORMAT);
    expect(artifacts.manifest.renderAddressOrder).toBe(PUBLIC_TYPED_RELATIONSHIP_RENDER_ADDRESS_ORDER);
    expect(artifacts.manifest.renderPackedLayout).toEqual(PUBLIC_TYPED_RELATIONSHIP_RENDER_PACKED_LAYOUT);
    expect(artifacts.manifest.renderLodPolicy).toEqual(PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY);
    expect(artifacts.manifest.renderTemporalMapping).toEqual(
      PUBLIC_TYPED_RELATIONSHIP_RENDER_TEMPORAL_MAPPING,
    );
    expect(artifacts.manifest.renderAddressUtf8Bytes).toBeGreaterThan(0);
    expect(artifacts.manifest.renderPackedBytes).toBeGreaterThan(artifacts.manifest.renderAddressUtf8Bytes);
    expect(artifacts.manifest.renderLodIndexBytes).toBeGreaterThan(0);
    expect(artifacts.manifest.renderRetainedBytes).toBe(
      artifacts.manifest.renderPackedBytes + artifacts.manifest.renderLodIndexBytes,
    );
    expect(artifacts.manifest.renderRetainedBytes).toBeLessThanOrEqual(
      PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES,
    );
    expect(artifacts.manifest.renderRetainedBudgetBytes).toBe(
      PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES,
    );
    expect(artifacts.manifest.renderInFlightDecodeBudgetBytes).toBe(
      PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES,
    );
    expect(artifacts.manifest.renderBufferAllocation).toBe(
      PUBLIC_TYPED_RELATIONSHIP_RENDER_BUFFER_ALLOCATION,
    );
    expect(artifacts.manifest.fullNodeMetadataAccess).toBe('on_demand_node_and_ego_shards');
    expect(artifacts.manifest.typedEdgeTypeCounts).toEqual(result.completion.typedEdgeTypeCounts);
    expect(artifacts.manifest.pairReducerTypedEdgeCount).toBe(result.completion.typedEdgeCount);
    expect(artifacts.manifest.pairReducerTypedEdgeIdSetSha256).toBe(
      result.completion.edgeSetSha256,
    );
    expect(artifacts.manifest.contextualRelationshipCompletion).toEqual({
      schemaVersion: result.contextual.artifact.schemaVersion,
      completionId: result.contextual.artifact.completionId,
      completionDigest: result.contextual.artifact.completionDigest,
      sourceCompletionSetSha256: result.contextual.artifact.sourceCompletionSetSha256,
      contextualIdentitySha256: result.contextual.artifact.contextualIdentitySha256,
      entrySetSha256: result.contextual.artifact.entrySetSha256,
      calibrationReceiptId: result.contextual.artifact.calibrationReceipt.receiptId,
      calibrationReceiptSha256: result.contextual.artifact.calibrationReceipt.receiptSha256,
      accounting: result.contextual.artifact.accounting,
      zeroObservationState: true,
      acceptedEdgeIdSetSha256: relationshipInputSha256(''),
    });
    expect(Object.values(artifacts.manifest.relationshipStatusCounts)
      .reduce((sum, count) => sum + count, 0)).toBe(addresses.length);

    const renderRows = artifacts.shards.filter((shard) => shard.shardKind === 'render')
      .flatMap((shard) => shard.items);
    expect(renderRows).toHaveLength(addresses.length);
    expect(renderRows.every((row) => !('recordType' in row)
      && Object.keys(row).sort().join(',') === [
        'address', 'degree', 'egoShard', 'eventTimestamp', 'kind', 'nodeShard',
        'position', 'relationshipStatus',
      ].sort().join(','))).toBe(true);
    for (const shard of artifacts.shards) {
      if (shard.shardKind === 'render') {
        const receipt = buildFullCorpusPublicRenderPackingReceipt(shard.items as FullCorpusPublicRenderRow[]);
        const rowCount = shard.items.length;
        const expectedLodIndexBytes = PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY.levels.reduce(
          (sum, { stride }) => sum + 8 + (rowCount ? Math.floor((rowCount - 1) / stride) + 1 : 0) * 2,
          0,
        );
        expect(receipt.packedBytes).toBe(
          receipt.addressUtf8Bytes + (rowCount + 1) * 4 + rowCount * 30,
        );
        expect(receipt.lodIndexBytes).toBe(expectedLodIndexBytes);
        const summary = artifacts.manifest.shards.find((candidate) => (
          candidate.shardKind === 'render' && candidate.shard === shard.shard
        ));
        expect(summary).toMatchObject({
          renderAddressLookupSha256: receipt.addressLookupSha256,
          renderLodIndexSha256: receipt.lodIndexSha256,
          renderAddressUtf8Bytes: receipt.addressUtf8Bytes,
          renderPackedBytes: receipt.packedBytes,
          renderLodIndexBytes: receipt.lodIndexBytes,
        });
      } else {
        const summary = artifacts.manifest.shards.find((candidate) => (
          candidate.shardKind === shard.shardKind && candidate.shard === shard.shard
        ));
        expect(summary).toMatchObject({
          renderAddressLookupSha256: null,
          renderLodIndexSha256: null,
          renderAddressUtf8Bytes: null,
          renderPackedBytes: null,
          renderLodIndexBytes: null,
        });
      }
    }

    const nodes = artifacts.shards.filter((shard) => shard.shardKind === 'node')
      .flatMap((shard) => shard.items)
      .filter((item) => 'recordType' in item && item.recordType === 'full_corpus_public_node');
    const egos = artifacts.shards.filter((shard) => shard.shardKind === 'ego')
      .flatMap((shard) => shard.items)
      .filter((item) => 'recordType' in item && item.recordType === 'full_corpus_public_ego');
    const isolated = nodes.find((node) => node.address === addresses[7]);
    const isolatedEgo = egos.find((ego) => ego.address === addresses[7]);
    expect(isolated).toMatchObject({
      kind: 'video',
      relationshipStatus: 'isolated',
      degree: 0,
      neighbourCount: 0,
    });
    expect(isolated?.statusReceipt.plainEnglish).toContain('not negative evidence');
    expect(isolatedEgo?.edgeReferences).toEqual([]);

    const edgeItems = artifacts.shards.filter((shard) => shard.shardKind === 'edge')
      .flatMap((shard) => shard.items)
      .filter((item) => 'recordType' in item && item.recordType === 'full_corpus_public_edge');
    expect(edgeItems.length).toBe(result.completion.typedEdgeCount);
    expect(edgeItems.every((edge) => edge.receipt.receiptId.startsWith('typed-receipt:')
      && edge.receipt.plainEnglish.length > 40)).toBe(true);
    const evaluationItems = artifacts.shards.filter((shard) => shard.shardKind === 'evaluation')
      .flatMap((shard) => shard.items)
      .filter((item) => 'recordType' in item && item.recordType === 'full_corpus_public_evaluation_receipt');
    expect(evaluationItems).toHaveLength(result.completion.candidatePairCount);
    expect(evaluationItems.every((evaluation) => evaluation.candidateReasons.length > 0)).toBe(true);

    const encodedManifest = encodeFullCorpusPublicGraphArchiveObject(artifacts.manifest);
    expect(decodeFullCorpusPublicGraphArchiveObject({
      archiveBody: encodedManifest.archiveBody,
      receipt: encodedManifest.receiptBody,
    })).toEqual(artifacts.manifest);
    const encodedShard = encodeFullCorpusPublicGraphArchiveObject(artifacts.shards[0]);
    expect(decodeFullCorpusPublicGraphArchiveObject({
      archiveBody: encodedShard.archiveBody,
      receipt: encodedShard.receipt,
    })).toEqual(artifacts.shards[0]);
  });

  it('indexes public references in endpoint-linear work independent of corpus node count', () => {
    const scale = 20_000;
    type Edge = Parameters<typeof indexFullCorpusPublicGraphReferences>[0]['edges'][number];
    type Evaluation = Parameters<typeof indexFullCorpusPublicGraphReferences>[0]['evaluations'][number];
    const edges = Array.from({ length: scale }, (_, index) => ({
      edgeId: `typed-edge:${index.toString(16).padStart(64, '0')}`,
      endpoints: [
        { kind: 'evidence', id: `sighting:left-${index}` },
        { kind: 'evidence', id: `document:right-${index}` },
      ],
    } as unknown as Edge));
    const evaluations = Array.from({ length: scale }, (_, index) => ({
      evaluationId: `public-evaluation:${index.toString(16).padStart(64, '0')}`,
      addresses: [`sighting:left-${index}`, `document:right-${index}`],
    } as unknown as Evaluation));
    const indexed = indexFullCorpusPublicGraphReferences({ edges, evaluations });
    expect(indexed.edgeEndpointVisits).toBe(scale * 2);
    expect(indexed.evaluationAddressVisits).toBe(scale * 2);
    expect(indexed.edgeIdsByAddress.size).toBe(scale * 2);
    expect(indexed.evaluationIdsByAddress.size).toBe(scale * 2);
  });

  it('keeps render time unclipped and monotonic while rejecting shards that cannot use Uint16 LOD indices', () => {
    const early = fullCorpusPublicRenderTimestamp('0193-01-01T00:00:00.000Z');
    const late = fullCorpusPublicRenderTimestamp('2058-12-31T23:59:59.999Z');
    expect(Number.isFinite(early)).toBe(true);
    expect(Number.isFinite(late)).toBe(true);
    expect(early).toBeLessThan(late);
    expect(fullCorpusPublicRenderTimestamp('2000-01-01T00:00:00.000001Z')).toBeLessThan(
      fullCorpusPublicRenderTimestamp('2000-01-01T00:00:00.000002Z'),
    );
    expect(fullCorpusPublicRenderTimestamp(null)).toBeNaN();
    expect(PUBLIC_TYPED_RELATIONSHIP_RENDER_LOD_POLICY.indexEncoding).toBe(
      'uint16-le-render-row-index',
    );

    const overflow = Array.from({
      length: PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_ROWS_PER_SHARD + 1,
    }, (_, index): FullCorpusPublicRenderRow => ({
      address: `sighting:${index.toString().padStart(8, '0')}`,
      kind: 'sighting',
      eventTimestamp: '2000-01-01T00:00:00.000Z',
      position: [0, 0, 0],
      relationshipStatus: 'isolated',
      degree: 0,
      nodeShard: 0,
      egoShard: 0,
    }));
    expect(() => buildFullCorpusPublicRenderPackingReceipt(overflow)).toThrow(
      'full_corpus_public_graph_render_shard_row_limit_exceeded',
    );
  });

  it('rejects public graph node tampering, missing shards, wrong universe membership, and compressed-byte corruption', async () => {
    const result = runPipeline();
    const storage = memoryStorage();
    const archived = await archiveFullCorpusRelationshipRun({
      storage,
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualCompletion: result.contextual.artifact,
      expectedContextualCalibration: result.contextual.expectedCalibration,
      completion: result.completion,
    });
    const runReceipts = archived.index.objects.map((entry) => (
      storage.objects.get(entry.receiptKey)?.body as Buffer
    ));
    const publicGraphParams: Parameters<typeof buildFullCorpusPublicGraphArtifacts>[0] = {
      universeNodes: universeNodes(),
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualRelationshipCompletion: result.contextual.artifact,
      expectedContextualCalibrationReceiptId: result.contextual.expectedCalibration.receiptId,
      expectedContextualCalibrationReceiptSha256: result.contextual.expectedCalibration.receiptSha256,
      completion: result.completion,
      runIndexPointer: archived.indexPointer,
      runIndexArchiveBody: archived.indexArtifact.archiveBody,
      runIndexReceipt: archived.indexArtifact.receipt,
      runArtifactReceipts: runReceipts,
      renderShardCount: 2,
      nodeShardCount: 2,
      edgeShardCount: 2,
      evaluationShardCount: 2,
      egoShardCount: 2,
    };
    const build = () => buildFullCorpusPublicGraphArtifacts(publicGraphParams);
    const artifacts = build();

    const missingContext = { ...publicGraphParams } as Partial<typeof publicGraphParams>;
    delete missingContext.contextualRelationshipCompletion;
    expect(() => buildFullCorpusPublicGraphArtifacts(
      missingContext as Parameters<typeof buildFullCorpusPublicGraphArtifacts>[0],
    )).toThrow('full_corpus_public_graph_contextual_completion_required');

    const localReceipt = structuredClone(result.contextual.calibrationReceipt);
    localReceipt.decision = 'contract_gates_passed_test_only';
    localReceipt.evidenceClass = 'synthetic_contract_fixture';
    localReceipt.authorizationScope = 'test_only_never_publish';
    const { receiptSha256: _localReceiptSha256, ...localReceiptWithoutSha } = localReceipt;
    localReceipt.receiptSha256 = contextualRelationshipCalibrationReceiptSha256(
      localReceiptWithoutSha,
    );
    const unvalidatedContext = buildContextualRelationshipCompletionArtifact({
      binding: binding(),
      calibrationReceipt: localReceipt,
      sources: result.contextual.sources,
      entries: [],
    });
    expect(() => buildFullCorpusPublicGraphArtifacts({
      ...publicGraphParams,
      contextualRelationshipCompletion: unvalidatedContext,
      expectedContextualCalibrationReceiptId: localReceipt.receiptId,
      expectedContextualCalibrationReceiptSha256: localReceipt.receiptSha256,
    })).toThrow('contextual_completion_not_production_eligible');

    const duplicatePairReducers = structuredClone(result.pairReducers);
    const reducerWithEdge = duplicatePairReducers.find((reducer) => reducer.edges.length > 0);
    if (!reducerWithEdge) throw new Error('test_pair_reducer_edge_missing');
    reducerWithEdge.edges.push(structuredClone(reducerWithEdge.edges[0]));
    expect(() => buildFullCorpusPublicGraphArtifacts({
      ...publicGraphParams,
      pairReducers: duplicatePairReducers,
    })).toThrow('full_corpus_public_graph_duplicate_edge_id');

    const contextualPairReducers = structuredClone(result.pairReducers);
    const reducerWithContextForgery = contextualPairReducers.find((reducer) => reducer.edges.length > 0);
    if (!reducerWithContextForgery) throw new Error('test_pair_reducer_edge_missing');
    reducerWithContextForgery.edges[0].edgeType = 'contextual_explanation_candidate';
    expect(() => buildFullCorpusPublicGraphArtifacts({
      ...publicGraphParams,
      pairReducers: contextualPairReducers,
    })).toThrow('full_corpus_public_graph_pair_reducer_contextual_edge_forbidden');
    const tampered = structuredClone(artifacts) as FullCorpusPublicGraphArtifacts;
    const nodeShard = tampered.shards.find((shard) => shard.shardKind === 'node' && shard.items.length);
    const node = nodeShard?.items.find((item) => (
      'recordType' in item && item.recordType === 'full_corpus_public_node'
    ));
    if (node && 'recordType' in node && node.recordType === 'full_corpus_public_node') node.degree += 1;
    expect(() => verifyFullCorpusPublicGraphArtifacts(tampered)).toThrow(
      /full_corpus_public_graph_(?:item_digest|node_degree)_mismatch/,
    );

    const exactKeyForgery = structuredClone(artifacts) as FullCorpusPublicGraphArtifacts;
    const exactNodeShard = exactKeyForgery.shards.find((shard) => shard.shardKind === 'node' && shard.items.length);
    const exactNode = exactNodeShard?.items.find((item) => (
      'recordType' in item && item.recordType === 'full_corpus_public_node'
    ));
    if (!exactNodeShard || !exactNode || !('recordType' in exactNode)
      || exactNode.recordType !== 'full_corpus_public_node') throw new Error('test_node_missing');
    (exactNode as typeof exactNode & { injected?: string }).injected = 'unknown-field';
    replaceDigest(exactNode as unknown as Record<string, unknown>, 'nodeDigest');
    exactNodeShard.itemSetSha256 = relationshipInputSha256(exactNodeShard.items.map((item) => {
      if (!('recordType' in item) || item.recordType !== 'full_corpus_public_node') throw new Error('test_node_invalid');
      return `${item.address}:${item.nodeDigest}`;
    }).join('\n'));
    replaceDigest(exactNodeShard as unknown as Record<string, unknown>, 'shardDigest');
    expect(() => decodeFullCorpusPublicGraphShard(exactNodeShard)).toThrow(
      'full_corpus_public_graph_node_invalid',
    );

    const manifestForgery = structuredClone(artifacts.manifest);
    manifestForgery.renderRowCount += 1;
    replaceDigest(manifestForgery as unknown as Record<string, unknown>, 'manifestDigest');
    expect(() => decodeFullCorpusPublicGraphManifest(manifestForgery)).toThrow(
      'full_corpus_public_graph_manifest_accounting_invalid',
    );

    const layoutForgery = structuredClone(artifacts.manifest) as unknown as Record<string, unknown>;
    (layoutForgery.renderPackedLayout as Record<string, unknown>).addressBytes = 'js-string-array';
    replaceDigest(layoutForgery, 'manifestDigest');
    expect(() => decodeFullCorpusPublicGraphManifest(layoutForgery)).toThrow(
      'full_corpus_public_graph_manifest_accounting_invalid',
    );

    const retainedBudgetForgery = structuredClone(artifacts.manifest);
    const retainedDelta = PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES + 1
      - retainedBudgetForgery.renderRetainedBytes;
    const retainedRenderSummary = retainedBudgetForgery.shards.find((summary) => (
      summary.shardKind === 'render'
    ));
    if (!retainedRenderSummary || retainedRenderSummary.renderPackedBytes === null) {
      throw new Error('test_render_summary_missing');
    }
    retainedBudgetForgery.renderRetainedBytes = PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_RETAINED_BYTES + 1;
    retainedBudgetForgery.renderPackedBytes += retainedDelta;
    retainedRenderSummary.renderPackedBytes += retainedDelta;
    replaceDigest(retainedBudgetForgery as unknown as Record<string, unknown>, 'manifestDigest');
    expect(() => decodeFullCorpusPublicGraphManifest(retainedBudgetForgery)).toThrow(
      'full_corpus_public_graph_manifest_accounting_invalid',
    );

    const renderDecodeBudgetForgery = structuredClone(artifacts.manifest);
    const oversizedRenderSummary = renderDecodeBudgetForgery.shards.find((summary) => (
      summary.shardKind === 'render'
    ));
    if (!oversizedRenderSummary) throw new Error('test_render_summary_missing');
    const renderUncompressedDelta = PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES + 1
      - oversizedRenderSummary.uncompressedBytes;
    oversizedRenderSummary.uncompressedBytes =
      PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES + 1;
    renderDecodeBudgetForgery.renderUncompressedBytes += renderUncompressedDelta;
    replaceDigest(renderDecodeBudgetForgery as unknown as Record<string, unknown>, 'manifestDigest');
    expect(() => decodeFullCorpusPublicGraphManifest(renderDecodeBudgetForgery)).toThrow(
      'full_corpus_public_graph_shard_summary_invalid',
    );

    expect(() => verifyFullCorpusPublicGraphArtifacts({
      manifest: artifacts.manifest,
      shards: artifacts.shards.slice(1),
    })).toThrow(/manifest_shard_set_mismatch|shard_sequence_incomplete/);
    expect(() => buildFullCorpusPublicGraphArtifacts({
      universeNodes: universeNodes().slice(1),
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualRelationshipCompletion: result.contextual.artifact,
      expectedContextualCalibrationReceiptId: result.contextual.expectedCalibration.receiptId,
      expectedContextualCalibrationReceiptSha256: result.contextual.expectedCalibration.receiptSha256,
      completion: result.completion,
      runIndexPointer: archived.indexPointer,
      runIndexArchiveBody: archived.indexArtifact.archiveBody,
      runIndexReceipt: archived.indexArtifact.receipt,
      runArtifactReceipts: archived.index.objects.map((entry) => (
        storage.objects.get(entry.receiptKey)?.body as Buffer
      )),
    })).toThrow('full_corpus_public_graph_universe_accounting_mismatch');

    expect(() => buildFullCorpusPublicGraphArtifacts({
      universeNodes: universeNodes(),
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualRelationshipCompletion: result.contextual.artifact,
      expectedContextualCalibrationReceiptId: result.contextual.expectedCalibration.receiptId,
      expectedContextualCalibrationReceiptSha256: result.contextual.expectedCalibration.receiptSha256,
      completion: result.completion,
      runIndexPointer: archived.indexPointer,
      runIndexArchiveBody: archived.indexArtifact.archiveBody,
      runIndexReceipt: archived.indexArtifact.receipt,
      runArtifactReceipts: runReceipts.slice(1),
    })).toThrow('full_corpus_public_graph_run_index_receipt_coverage_mismatch');

    const forgedIndex = structuredClone(archived.index);
    const removedIndex = forgedIndex.objects.findIndex((entry) => entry.artifactType === 'candidate_fragment');
    expect(removedIndex).toBeGreaterThanOrEqual(0);
    const [removed] = forgedIndex.objects.splice(removedIndex, 1);
    forgedIndex.objectCount -= 1;
    forgedIndex.objectTypeCounts[removed.artifactType as keyof typeof forgedIndex.objectTypeCounts] -= 1;
    forgedIndex.artifactSetSha256 = relationshipInputSha256(forgedIndex.objects.map((entry) => (
      `${entry.artifactType}:${entry.artifactDigest}:${entry.compressedSha256}`
    )).join('\n'));
    replaceDigest(forgedIndex as unknown as Record<string, unknown>, 'indexDigest');
    const forgedIndexArtifact = buildFullCorpusRelationshipArchiveObject({
      artifactType: 'run_index',
      value: forgedIndex,
      lineage: result.postingMap.lineage,
    });
    const forgedPointer = buildFullCorpusRelationshipRunIndexPointer(forgedIndexArtifact);
    expect(() => buildFullCorpusPublicGraphArtifacts({
      universeNodes: universeNodes(),
      postingFragments: result.fragments,
      postingMap: result.postingMap,
      postingReductions: result.postingReductions,
      pairReducers: result.pairReducers,
      contextualRelationshipCompletion: result.contextual.artifact,
      expectedContextualCalibrationReceiptId: result.contextual.expectedCalibration.receiptId,
      expectedContextualCalibrationReceiptSha256: result.contextual.expectedCalibration.receiptSha256,
      completion: result.completion,
      runIndexPointer: forgedPointer,
      runIndexArchiveBody: forgedIndexArtifact.archiveBody,
      runIndexReceipt: forgedIndexArtifact.receipt,
      runArtifactReceipts: runReceipts,
    })).toThrow('full_corpus_public_graph_run_index_coverage_mismatch');

    const encoded = encodeFullCorpusPublicGraphArchiveObject(artifacts.manifest);
    const corrupted = Buffer.from(encoded.archiveBody);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    expect(() => decodeFullCorpusPublicGraphArchiveObject({
      archiveBody: corrupted,
      receipt: encoded.receipt,
    })).toThrow('full_corpus_public_graph_archive_receipt_invalid');

    const forgedReceipt = structuredClone(encoded.receipt) as typeof encoded.receipt & { injected?: string };
    forgedReceipt.injected = 'unknown-receipt-field';
    replaceDigest(forgedReceipt as unknown as Record<string, unknown>, 'receiptDigest');
    expect(() => decodeFullCorpusPublicGraphArchiveObject({
      archiveBody: encoded.archiveBody,
      receipt: forgedReceipt,
    })).toThrow('full_corpus_public_graph_archive_receipt_invalid');

    const renderShard = artifacts.shards.find((shard) => shard.shardKind === 'render');
    if (!renderShard) throw new Error('test_render_shard_missing');
    const encodedRenderShard = encodeFullCorpusPublicGraphArchiveObject(renderShard);
    const oversizedRenderReceipt = structuredClone(encodedRenderShard.receipt);
    oversizedRenderReceipt.uncompressedBytes =
      PUBLIC_TYPED_RELATIONSHIP_RENDER_MAX_IN_FLIGHT_DECODE_BYTES + 1;
    replaceDigest(oversizedRenderReceipt as unknown as Record<string, unknown>, 'receiptDigest');
    expect(() => decodeFullCorpusPublicGraphArchiveObject({
      archiveBody: encodedRenderShard.archiveBody,
      receipt: oversizedRenderReceipt,
    })).toThrow('full_corpus_public_graph_archive_render_decode_budget_exceeded');
  });
});
