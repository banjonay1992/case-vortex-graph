import { getEvidenceUniverseControlKeys } from './archiveKeys';
import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
} from './evidenceUniverseArchive';
import {
  decodeEvidenceUniverseCompletion,
  decodeEvidenceUniverseNodePart,
} from './evidenceUniversePublicAccess';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  type EvidenceUniverseNode,
  type EvidenceUniverseRawRecord,
} from './evidenceUniverse';
import {
  decodeRelationshipInputPart,
  decodeRelationshipInputPartManifest,
  decodeRelationshipInputSnapshotManifest,
  getRelationshipInputControlKeys,
  type RelationshipInputPartManifest,
  type RelationshipInputPartSummary,
  type RelationshipInputSnapshotManifest,
} from './relationshipInputArchive';
import {
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  type RelationshipInputFact,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
  type TypedRelationshipCalibrationLineage,
} from './typedRelationshipCalibration';
import {
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_POLICY,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  buildTypedRelationshipRarityIndex,
  createTypedRelationshipRarityAccumulator,
  evaluateTypedRelationshipPair,
} from './typedRelationshipEngine';
import {
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
  reduceFullCorpusCandidateShard,
  reduceFullCorpusPostingShard,
  type FullCorpusPostingCaps,
} from './typedRelationshipPipeline';
import {
  selectCalibrationPairCandidates,
  type CalibrationPairCandidateSelection,
} from './calibrationCandidateSelection';
import type { CalibrationHumanReviewSourcePacketDraft } from './calibrationHumanReviewSourcePacket';

export const CALIBRATION_PAIR_CANDIDATE_POOL_VERSION =
  'case-graph-calibration-pair-candidate-pool-v1' as const;

export type CalibrationPairCandidateTopology = {
  postingShardCount: number;
  pairShardCount: number;
  maxPostingsPerRecord: number;
  maxCandidatePairsPerPairShard: number;
  postingCaps: FullCorpusPostingCaps;
};

export const DEFAULT_CALIBRATION_PAIR_CANDIDATE_TOPOLOGY: CalibrationPairCandidateTopology = {
  postingShardCount: 64,
  pairShardCount: 64,
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
};

export type CalibrationCandidateArchiveSource = {
  universe: EvidenceUniverseCompletion;
  binding: RelationshipInputUniverseBinding;
  relationshipInputManifest: RelationshipInputSnapshotManifest;
  relationshipInputParts: Array<{ partNumber: number; records: RelationshipInputRecord[] }>;
};

export type CalibrationCandidateArchiveHeader = Omit<
CalibrationCandidateArchiveSource,
'relationshipInputParts'
>;

export type CalibrationPairCandidatePoolCore = {
  pool: Omit<CalibrationPairCandidatePool, 'sourceMaterials' | 'poolDigest'>;
  selectedRecords: RelationshipInputRecord[];
};

export type CalibrationPairCandidatePool = {
  recordType: 'calibration_pair_candidate_pool';
  schemaVersion: typeof CALIBRATION_PAIR_CANDIDATE_POOL_VERSION;
  corpusVersion: string;
  binding: RelationshipInputUniverseBinding;
  topology: CalibrationPairCandidateTopology;
  relationshipInputManifestDigest: string;
  relationshipInputArchiveSetSha256: string;
  rarityIndexDigest: string;
  eligibleEvaluationCount: number;
  selection: CalibrationPairCandidateSelection;
  pairLineage: TypedRelationshipCalibrationLineage;
  sourceMaterials: CalibrationHumanReviewSourcePacketDraft;
  poolDigest: string;
};

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };

const bindingFromUniverse = (universe: EvidenceUniverseCompletion): RelationshipInputUniverseBinding => ({
  snapshotId: universe.expected.snapshotId,
  corpusVersion: universe.corpusVersion,
  universeArchiveVersion: universe.archiveVersion,
  universeSchemaVersion: universe.schemaVersion,
  universeLayoutVersion: universe.layoutVersion,
  universeArchiveSetSha256: universe.archiveSetSha256,
  universeRecordCount: universe.expected.total,
});

const partSummary = (manifest: RelationshipInputPartManifest): RelationshipInputPartSummary => ({
  partNumber: manifest.partNumber,
  archiveKey: manifest.archiveKey,
  manifestKey: manifest.manifestKey,
  rowCount: manifest.rowCount,
  firstAddress: manifest.firstAddress,
  lastAddress: manifest.lastAddress,
  uncompressedBytes: manifest.uncompressedBytes,
  compressedBytes: manifest.compressedBytes,
  compressedSha256: manifest.compressedSha256,
  recordSetSha256: manifest.recordSetSha256,
  accounting: manifest.accounting,
});

export const loadCalibrationCandidateArchiveHeader = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  corpusVersion: string;
}): Promise<CalibrationCandidateArchiveHeader> => {
  const universeBody = await params.storage.readObject(
    getEvidenceUniverseControlKeys(params.corpusVersion).completionManifestKey,
  );
  if (!universeBody) return invalid('calibration_candidate_universe_completion_missing');
  const universe = decodeEvidenceUniverseCompletion(universeBody, params.corpusVersion);
  const binding = bindingFromUniverse(universe);
  const relationshipBody = await params.storage.readObject(
    getRelationshipInputControlKeys(binding).completionManifestKey,
  );
  if (!relationshipBody) invalid('calibration_candidate_relationship_completion_missing');
  const relationshipInputManifest = decodeRelationshipInputSnapshotManifest(
    relationshipBody,
    binding,
  );
  return { universe, binding, relationshipInputManifest };
};

export const scanCalibrationCandidateRelationshipParts = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  header: CalibrationCandidateArchiveHeader;
  onPart: (part: { partNumber: number; records: RelationshipInputRecord[] }) => void | Promise<void>;
}) => {
  let rowCount = 0;
  for (const summary of params.header.relationshipInputManifest.parts) {
    const [manifestBody, archiveBody] = await Promise.all([
      params.storage.readObject(summary.manifestKey),
      params.storage.readObject(summary.archiveKey),
    ]);
    if (!manifestBody || !archiveBody) return invalid('calibration_candidate_relationship_part_missing');
    const manifest = decodeRelationshipInputPartManifest(manifestBody, params.header.binding);
    if (canonicalizeRelationshipInput(partSummary(manifest))
      !== canonicalizeRelationshipInput(summary)) {
      invalid('calibration_candidate_relationship_part_manifest_mismatch');
    }
    const part = decodeRelationshipInputPart(archiveBody, manifest, params.header.binding);
    rowCount += part.records.length;
    await params.onPart({ partNumber: summary.partNumber, records: part.records });
  }
  if (rowCount !== params.header.binding.universeRecordCount) {
    invalid('calibration_candidate_relationship_address_set_mismatch');
  }
  return { partCount: params.header.relationshipInputManifest.partCount, rowCount };
};

export const loadCalibrationCandidateArchiveSource = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  corpusVersion: string;
}): Promise<CalibrationCandidateArchiveSource> => {
  const header = await loadCalibrationCandidateArchiveHeader(params);
  const relationshipInputParts: CalibrationCandidateArchiveSource['relationshipInputParts'] = [];
  await scanCalibrationCandidateRelationshipParts({
    storage: params.storage,
    header,
    onPart: (part) => { relationshipInputParts.push(part); },
  });
  const relationshipAddresses = relationshipInputParts
    .flatMap(({ records }) => records.map(({ address }) => address))
    .sort(compare);
  if (relationshipAddresses.length !== header.binding.universeRecordCount
    || new Set(relationshipAddresses).size !== header.binding.universeRecordCount) {
    invalid('calibration_candidate_relationship_address_set_mismatch');
  }
  return {
    ...header,
    relationshipInputParts,
  };
};

export const loadCalibrationCandidateUniverseNodes = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  universe: EvidenceUniverseCompletion;
  addresses: readonly string[];
}): Promise<EvidenceUniverseNode[]> => {
  const requested = new Set(params.addresses);
  if (!requested.size || requested.size !== params.addresses.length) {
    invalid('calibration_candidate_universe_address_request_invalid');
  }
  const nodes: EvidenceUniverseNode[] = [];
  for (const summary of params.universe.parts) {
    const body = await params.storage.readObject(summary.archiveKey);
    if (!body) return invalid('calibration_candidate_universe_part_missing');
    for (const node of decodeEvidenceUniverseNodePart(body, summary).nodes) {
      if (requested.has(node.address)) nodes.push(node);
    }
  }
  nodes.sort((left, right) => compare(left.address, right.address));
  if (nodes.length !== requested.size
    || nodes.some((node, index) => node.address !== [...requested].sort(compare)[index])) {
    invalid('calibration_candidate_universe_address_set_mismatch');
  }
  return nodes;
};

const rawRecordFromNode = (node: EvidenceUniverseNode): EvidenceUniverseRawRecord => ({
  kind: node.kind,
  recordId: node.recordId,
  source: node.source,
  sourceRecordId: node.sourceRecordId,
  title: node.title,
  summary: node.summary,
  canonicalUrl: node.canonicalUrl,
  previewUrl: node.previewUrl,
  eventTimestamp: node.eventTimestamp,
  lat: node.lat,
  lon: node.lon,
  location: node.location,
  countryCode: node.countryCode,
  linkedSightingId: node.linkedSightingId,
  updatedAt: node.updatedAt,
  public: true,
});

const poolWithoutDigest = (pool: Omit<CalibrationPairCandidatePool, 'poolDigest'>) => pool;

export const buildCalibrationPairCandidatePoolCore = (params: {
  source: CalibrationCandidateArchiveSource;
  targetCount: number;
  seed: string;
  topology?: CalibrationPairCandidateTopology;
}): CalibrationPairCandidatePoolCore => {
  const topology = params.topology || DEFAULT_CALIBRATION_PAIR_CANDIDATE_TOPOLOGY;
  const parts = [...params.source.relationshipInputParts]
    .sort((left, right) => left.partNumber - right.partNumber);
  if (parts.length !== params.source.relationshipInputManifest.partCount
    || parts.some((part, index) => part.partNumber !== index)) {
    invalid('calibration_candidate_relationship_parts_incomplete');
  }
  const records = parts.flatMap(({ records: values }) => values);
  const rarityIndex = buildTypedRelationshipRarityIndex(records, params.source.binding);
  const fragments = parts.flatMap((part) => buildFullCorpusPostingFragments({
    records: part.records,
    inputPartNumber: part.partNumber,
    relationshipInputManifest: params.source.relationshipInputManifest,
    rarityIndex,
    postingShardCount: topology.postingShardCount,
    maxPostingsPerRecord: topology.maxPostingsPerRecord,
  }));
  const postingMap = buildFullCorpusPostingMapManifest({
    relationshipInputManifest: params.source.relationshipInputManifest,
    rarityIndex,
    postingShardCount: topology.postingShardCount,
    fragments,
  });
  const reductions = Array.from({ length: topology.postingShardCount }, (_, postingShard) => (
    reduceFullCorpusPostingShard({
      postingMap,
      fragments: fragments.filter((fragment) => fragment.postingShard === postingShard),
      postingShard,
      pairShardCount: topology.pairShardCount,
      caps: topology.postingCaps,
    })
  ));
  const candidateFragments = reductions.flatMap(({ candidateFragments: values }) => values);
  const evaluations = Array.from({ length: topology.pairShardCount }, (_, pairShard) => (
    reduceFullCorpusCandidateShard({
      postingMap,
      rarityIndex,
      fragments: candidateFragments.filter((fragment) => fragment.pairShard === pairShard),
      pairShard,
      pairShardCount: topology.pairShardCount,
      maxCandidatePairs: topology.maxCandidatePairsPerPairShard,
    }).evaluations
  )).flat();
  const selection = selectCalibrationPairCandidates({
    binding: params.source.binding,
    evaluations,
    records,
    targetCount: params.targetCount,
    seed: params.seed,
  });
  const pairLineage: TypedRelationshipCalibrationLineage = {
    binding: params.source.binding,
    relationshipInput: {
      schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      archiveSetSha256: params.source.relationshipInputManifest.archiveSetSha256,
      manifestDigest: params.source.relationshipInputManifest.manifestDigest,
      recordSetSha256: rarityIndex.recordSetSha256,
      recordCount: records.length,
    },
    rarity: {
      schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
      indexDigest: rarityIndex.indexDigest,
      recordSetSha256: rarityIndex.recordSetSha256,
    },
    engine: {
      schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
      policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
      policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
      thresholds: TYPED_RELATIONSHIP_POLICY,
      model: TYPED_RELATIONSHIP_MODEL,
      modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
      edgeTypeSetSha256: TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
    },
  };
  const recordByAddress = new Map(records.map((record) => [record.address, record]));
  const addresses = [...new Set(selection.candidates.flatMap(({ evaluation }) => (
    evaluation.addresses
  )))].sort(compare);
  const selectedRecords = addresses.map((address) => {
    const record = recordByAddress.get(address);
    if (!record) return invalid('calibration_candidate_selected_source_missing');
    return record;
  });
  const pool: Omit<CalibrationPairCandidatePool, 'sourceMaterials' | 'poolDigest'> = {
    recordType: 'calibration_pair_candidate_pool',
    schemaVersion: CALIBRATION_PAIR_CANDIDATE_POOL_VERSION,
    corpusVersion: params.source.binding.corpusVersion,
    binding: params.source.binding,
    topology,
    relationshipInputManifestDigest: params.source.relationshipInputManifest.manifestDigest,
    relationshipInputArchiveSetSha256: params.source.relationshipInputManifest.archiveSetSha256,
    rarityIndexDigest: rarityIndex.indexDigest,
    eligibleEvaluationCount: evaluations.length,
    selection,
    pairLineage,
  };
  return { pool, selectedRecords };
};

export const finalizeCalibrationPairCandidatePool = (params: {
  core: CalibrationPairCandidatePoolCore;
  universeNodes: readonly EvidenceUniverseNode[];
}): CalibrationPairCandidatePool => {
  const nodeByAddress = new Map(params.universeNodes.map((node) => [node.address, node]));
  const sourceMaterials: CalibrationHumanReviewSourcePacketDraft = {
    records: params.core.selectedRecords.map((relationshipRecord) => {
      const node = nodeByAddress.get(relationshipRecord.address);
      if (!node) return invalid('calibration_candidate_selected_source_missing');
      return { rawRecord: rawRecordFromNode(node), relationshipRecord };
    }),
  };
  const withoutDigest: Omit<CalibrationPairCandidatePool, 'poolDigest'> = {
    ...params.core.pool,
    sourceMaterials,
  };
  return { ...withoutDigest, poolDigest: relationshipInputSha256(poolWithoutDigest(withoutDigest)) };
};

export const buildCalibrationPairCandidatePool = (params: {
  source: CalibrationCandidateArchiveSource;
  universeNodes: readonly EvidenceUniverseNode[];
  targetCount: number;
  seed: string;
  topology?: CalibrationPairCandidateTopology;
}): CalibrationPairCandidatePool => finalizeCalibrationPairCandidatePool({
  core: buildCalibrationPairCandidatePoolCore(params),
  universeNodes: params.universeNodes,
});

type StreamingRoute = {
  kind: 'source' | 'source_record' | 'lineage' | 'duplicate' | 'matchable' | 'duration' | 'space_time';
  key: string;
};

const STREAMING_MATCHABLE_FAMILIES = new Set([
  'visual', 'behavioural', 'sensory', 'entity', 'site', 'narrative_pattern',
]);
const STREAMING_NEGATED_PREDICATE =
  /(^|_)(?:no|not|without|absent|denied|denies|negated|ruled_out)(?:_|$)/;

const matchableRoute = (fact: RelationshipInputFact): StreamingRoute | null => {
  if (!STREAMING_MATCHABLE_FAMILIES.has(fact.family)
    || fact.value === null
    || fact.confidence === null
    || fact.missingness.status !== 'present'
    || STREAMING_NEGATED_PREDICATE.test(fact.predicate.toLowerCase())) return null;
  let valueId = '';
  let registryVersion = '';
  if (fact.value.kind === 'term') {
    valueId = fact.value.termId;
    registryVersion = fact.value.vocabularyVersion;
  } else if (fact.value.kind === 'governed_reference') {
    valueId = fact.value.governedId;
    registryVersion = fact.value.registryVersion;
  } else if (fact.value.kind === 'narrative_pattern') {
    valueId = fact.value.patternId;
    registryVersion = fact.value.registryVersion;
  } else return null;
  return {
    kind: 'matchable',
    key: `matchable:${relationshipInputSha256({
      family: fact.family,
      valueId,
      registryVersion,
    })}`,
  };
};

const streamingRoutes = (record: RelationshipInputRecord): StreamingRoute[] => {
  const routes: StreamingRoute[] = [
    { kind: 'source', key: `source:${record.source.sourceId}` },
    { kind: 'lineage', key: `lineage:${record.source.lineageId}` },
  ];
  if (record.source.sourceRecordId !== null) routes.push({
    kind: 'source_record',
    key: `source-record:${record.source.sourceId}:${record.source.sourceRecordId}`,
  });
  if (record.duplicateLineage) routes.push({
    kind: 'duplicate',
    key: `duplicate:${record.duplicateLineage.clusterId}`,
  });
  const timestamps = record.facts.filter((fact) => (
    fact.family === 'space_time' && fact.value?.kind === 'timestamp'
  ));
  const locations = record.facts.filter((fact) => (
    fact.family === 'space_time' && fact.value?.kind === 'geo_point'
  ));
  for (const fact of record.facts) {
    const matchable = matchableRoute(fact);
    if (matchable) routes.push(matchable);
    if (fact.family === 'duration' && fact.value?.kind === 'duration' && fact.value.seconds > 0) {
      routes.push({
        kind: 'duration',
        key: `duration:${Math.floor(Math.log(fact.value.seconds) / Math.log(
          1 / TYPED_RELATIONSHIP_POLICY.minimumDurationSimilarity,
        ))}`,
      });
    }
  }
  for (const timestamp of timestamps) for (const location of locations) {
    if (timestamp.value?.kind !== 'timestamp' || location.value?.kind !== 'geo_point') continue;
    const epochSeconds = Date.parse(timestamp.value.timestamp) / 1_000;
    if (!Number.isFinite(epochSeconds)) continue;
    const cellDegrees = Math.max(
      0.01,
      TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres / 111.32,
    );
    routes.push({
      kind: 'space_time',
      key: `space-time:${Math.floor(
        epochSeconds / TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperSeconds,
      )}:${Math.floor(location.value.lat / cellDegrees)}:${Math.floor(
        location.value.lon / cellDegrees,
      )}`,
    });
  }
  return [...new Map(routes.map((route) => [`${route.kind}:${route.key}`, route])).values()]
    .sort((left, right) => compare(left.key, right.key));
};

const acceptsStreamingRoute = (seed: string, route: StreamingRoute) => {
  if (route.kind === 'duplicate') return true;
  return Number.parseInt(relationshipInputSha256({ seed, route }).slice(0, 4), 16) < 0x1000;
};

const trimRanked = <T extends { rank: string }>(values: Map<string, T>, limit: number) => {
  if (values.size <= limit * 2) return;
  const keep = [...values.entries()]
    .sort(([, left], [, right]) => compare(left.rank, right.rank))
    .slice(0, limit);
  values.clear();
  keep.forEach(([key, value]) => values.set(key, value));
};

export const buildStreamingCalibrationPairCandidatePoolCore = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  header: CalibrationCandidateArchiveHeader;
  targetCount: number;
  seed: string;
  topology?: CalibrationPairCandidateTopology;
}): Promise<CalibrationPairCandidatePoolCore> => {
  const topology = params.topology || DEFAULT_CALIBRATION_PAIR_CANDIDATE_TOPOLOGY;
  const rarityAccumulator = createTypedRelationshipRarityAccumulator(params.header.binding);
  await scanCalibrationCandidateRelationshipParts({
    storage: params.storage,
    header: params.header,
    onPart: ({ records }) => records.forEach((record) => rarityAccumulator.add(record)),
  });
  const rarityIndex = rarityAccumulator.finish();
  const routeRecords = new Map<string, { route: StreamingRoute; records: RelationshipInputRecord[] }>();
  type RankedEvaluation = {
    rank: string;
    evaluation: ReturnType<typeof evaluateTypedRelationshipPair>;
    records: [RelationshipInputRecord, RelationshipInputRecord];
  };
  const reservoirs = new Map<StreamingRoute['kind'], Map<string, RankedEvaluation>>();
  const seenPairs = new Set<string>();
  let evaluatedPairCount = 0;
  await scanCalibrationCandidateRelationshipParts({
    storage: params.storage,
    header: params.header,
    onPart: ({ records }) => {
      for (const record of records) for (const route of streamingRoutes(record)) {
        if (!acceptsStreamingRoute(params.seed, route)) continue;
        const routeId = `${route.kind}:${route.key}`;
        const state = routeRecords.get(routeId) || { route, records: [] };
        for (const previous of state.records) {
          const addresses = [previous.address, record.address].sort(compare) as [string, string];
          const pairKey = `pair:${relationshipInputSha256(addresses)}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          const evaluation = evaluateTypedRelationshipPair({
            left: previous,
            right: record,
            rarityIndex,
            expectedBinding: params.header.binding,
          });
          evaluatedPairCount += 1;
          const reservoir = reservoirs.get(route.kind) || new Map<string, RankedEvaluation>();
          reservoir.set(pairKey, {
            rank: relationshipInputSha256({
              schemaVersion: 'streaming-calibration-route-rank-v1',
              seed: params.seed,
              routeKind: route.kind,
              pairKey,
              evaluationDigest: evaluation.evaluationDigest,
            }),
            evaluation,
            records: [previous, record],
          });
          trimRanked(reservoir, params.targetCount);
          reservoirs.set(route.kind, reservoir);
        }
        state.records = [...state.records, record]
          .sort((left, right) => compare(
            relationshipInputSha256({ seed: params.seed, routeId, address: left.address }),
            relationshipInputSha256({ seed: params.seed, routeId, address: right.address }),
          ))
          .slice(0, 2);
        routeRecords.set(routeId, state);
        if (routeRecords.size > 100_000) invalid('calibration_candidate_streaming_route_bound_exceeded');
        if (seenPairs.size > 2_000_000) invalid('calibration_candidate_streaming_pair_bound_exceeded');
      }
    },
  });
  for (const reservoir of reservoirs.values()) trimRanked(reservoir, params.targetCount);
  const unique = new Map<string, RankedEvaluation>();
  for (const entry of [...reservoirs.values()].flatMap((reservoir) => [...reservoir.values()])) {
    const pairKey = `pair:${relationshipInputSha256(entry.evaluation.addresses)}`;
    const existing = unique.get(pairKey);
    if (!existing || compare(entry.rank, existing.rank) < 0) unique.set(pairKey, entry);
  }
  const selectedRecordMap = new Map<string, RelationshipInputRecord>();
  unique.forEach(({ records }) => records.forEach((record) => selectedRecordMap.set(record.address, record)));
  const selection = selectCalibrationPairCandidates({
    binding: params.header.binding,
    evaluations: [...unique.values()].map(({ evaluation }) => evaluation),
    records: [...selectedRecordMap.values()],
    targetCount: params.targetCount,
    seed: params.seed,
  });
  const selectedAddresses = new Set(selection.candidates.flatMap(({ evaluation }) => evaluation.addresses));
  const selectedRecords = [...selectedRecordMap.values()]
    .filter(({ address }) => selectedAddresses.has(address))
    .sort((left, right) => compare(left.address, right.address));
  const pairLineage: TypedRelationshipCalibrationLineage = {
    binding: params.header.binding,
    relationshipInput: {
      schemaVersion: RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
      archiveSetSha256: params.header.relationshipInputManifest.archiveSetSha256,
      manifestDigest: params.header.relationshipInputManifest.manifestDigest,
      recordSetSha256: rarityIndex.recordSetSha256,
      recordCount: params.header.binding.universeRecordCount,
    },
    rarity: {
      schemaVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
      indexDigest: rarityIndex.indexDigest,
      recordSetSha256: rarityIndex.recordSetSha256,
    },
    engine: {
      schemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
      policyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
      policySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
      thresholds: TYPED_RELATIONSHIP_POLICY,
      model: TYPED_RELATIONSHIP_MODEL,
      modelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
      edgeTypeSetSha256: TYPED_RELATIONSHIP_EDGE_TYPE_SET_SHA256,
    },
  };
  return {
    pool: {
      recordType: 'calibration_pair_candidate_pool',
      schemaVersion: CALIBRATION_PAIR_CANDIDATE_POOL_VERSION,
      corpusVersion: params.header.binding.corpusVersion,
      binding: params.header.binding,
      topology,
      relationshipInputManifestDigest: params.header.relationshipInputManifest.manifestDigest,
      relationshipInputArchiveSetSha256: params.header.relationshipInputManifest.archiveSetSha256,
      rarityIndexDigest: rarityIndex.indexDigest,
      eligibleEvaluationCount: evaluatedPairCount,
      selection,
      pairLineage,
    },
    selectedRecords,
  };
};
