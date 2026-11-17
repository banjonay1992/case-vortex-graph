import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from './evidenceUniverseArchive';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
  type RelationshipInputPartManifest,
} from './relationshipInputArchive';
import { extractRelationshipInputRecord } from './relationshipInputExtraction';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  buildFullCorpusPostingFragments,
  fullCorpusRelationshipShard,
  type FullCorpusPostingCaps,
  type FullCorpusPostingKind,
} from './typedRelationshipPipeline';
import { buildTypedRelationshipRarityIndex } from './typedRelationshipEngine';

export const LEGACY_RELATIONSHIP_FORECAST_VERSION = 'legacy-relationship-sample-forecast-v1' as const;
export const LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION = 'forecast_only_legacy_projection' as const;
export const LEGACY_RELATIONSHIP_FORECAST_CORPUS_VERSION = '2026-07-17-vortex-v7' as const;

const KINDS = ['sighting', 'document', 'photo', 'video'] as const satisfies readonly EvidenceUniverseNodeKind[];
const ADDRESS_ORDER = ['document', 'photo', 'sighting', 'video'] as const satisfies readonly EvidenceUniverseNodeKind[];
const POSTING_KINDS = [
  'address_identity',
  'source_identity',
  'source_record',
  'source_lineage',
  'duplicate_cluster',
  'matchable_value',
  'space_time',
  'duration',
] as const satisfies readonly FullCorpusPostingKind[];

export type LegacyForecastKindCounts = Record<EvidenceUniverseNodeKind, number>;

export const LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS: LegacyForecastKindCounts = Object.freeze({
  sighting: 393_177,
  document: 31_415,
  photo: 29_717,
  video: 12_626,
});

export const LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS: LegacyForecastKindCounts = Object.freeze({
  sighting: 8_177,
  document: 6_415,
  photo: 4_717,
  video: 12_626,
});

/**
 * This is a frozen copy of the v2 pipeline defaults used only to forecast cap
 * pressure. The report includes the values and never treats them as an
 * authorization to execute the pipeline.
 */
export const LEGACY_RELATIONSHIP_FORECAST_CAPS: FullCorpusPostingCaps = Object.freeze({
  addressIdentity: 10_000,
  sourceIdentity: 500,
  sourceRecord: 100,
  sourceLineage: 250,
  duplicateCluster: 500,
  matchableValue: 250,
  spaceTime: 300,
  duration: 300,
  maxPairsPerGroup: 50_000,
  maxCandidatePairsPerPostingShard: 1_000_000,
});

const FORECAST_BINDING_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000007';
const FORECAST_GENERATED_AT = '2026-07-17T17:00:00.000Z';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SAMPLE_COMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_SAMPLE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_SAMPLE_ROWS_PER_KIND = 100_000;
const MAX_NDJSON_LINE_BYTES = 2 * 1024 * 1024;
const RELATIONSHIP_PART_MAX_ROWS = 5_000;
const RELATIONSHIP_PART_MAX_BYTES = 16 * 1024 * 1024;
const FORECAST_POSTING_SHARD_COUNT = 64;
const FORECAST_CANDIDATE_BYTES_PER_PAIR = 2_048;
const RELATIONSHIP_RAW_UPPER_FACTOR_NUMERATOR = 5;
const RELATIONSHIP_RAW_UPPER_FACTOR_DENOMINATOR = 2;
const RELATIONSHIP_GZIP_UPPER_FACTOR = 3;
const POSTING_UPPER_FACTOR = 2;
const GIB = 1024 ** 3;
const FORECAST_LIMITATIONS = Object.freeze([
  'The source files are legacy evidence-universe-v1 tail samples, not a governed v2 relationship-input snapshot.',
  'The deterministic conversion omits current feature-archive enrichment, duplicate lineage, governed entity and site references, narrative vectors, and contextual observations.',
  'Source identity is projected from the legacy source label and is not proof of current registry or source-lineage reconciliation.',
  'Potential pair routes are pre-deduplication pressure estimates. They are not typed edges or relationship findings.',
  'Stable-group projections assume the sampled group occupancy persists; identifier routes use a conservative observed-pair linear projection.',
  'This report is lower-bound planning evidence only and cannot authorize activation, publication, deployment, migration, or external writes.',
] as const);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type LegacyV1Node = {
  schemaVersion: 'evidence-universe-v1';
  address: string;
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  source: string;
  sourceRecordId: string | null;
  title: string | null;
  summary: string | null;
  canonicalUrl: string | null;
  previewUrl: string | null;
  eventTimestamp: string | null;
  lat: number | null;
  lon: number | null;
  location: string | null;
  countryCode: string | null;
  linkedSightingId: string | null;
  updatedAt: string;
  position: [number, number, number];
};

export type LegacySampleArchiveMetric = {
  rowCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
  compressedSha256: string;
};

type ByteProjection = {
  sample: LegacySampleArchiveMetric;
  projected: {
    rowCount: number;
    uncompressedBytes: number;
    compressedBytes: number;
  };
};

type RouteGroup = {
  routeKind: FullCorpusPostingKind;
  postingByKind: LegacyForecastKindCounts;
  addressesByKind: Record<EvidenceUniverseNodeKind, Set<string>>;
  identityAddressesByKind: Record<EvidenceUniverseNodeKind, Set<string>>;
  assertionPostingByKind: LegacyForecastKindCounts;
};

export type LegacyRelationshipRoutePressure = {
  routeKind: FullCorpusPostingKind;
  postingCap: number;
  pairCap: number;
  projectionMethod: 'stable_group_occupancy' | 'observed_pair_linear';
  sample: {
    postingCount: number;
    groupCount: number;
    potentialPairRoutes: number;
    retainedPotentialPairRoutes: number;
    skippedPotentialPairRoutes: number;
    capBreachGroupCount: number;
    largestGroupPostingCount: number;
    largestGroupDistinctAddressCount: number;
    largestGroupPotentialPairRoutes: number;
  };
  projected: {
    postingCount: number;
    potentialPairRoutes: number;
    retainedPotentialPairRoutes: number;
    skippedPotentialPairRoutes: number;
    capBreachGroupCount: number;
  };
};

export type LegacyRelationshipSampleForecast = {
  recordType: 'legacy_relationship_sample_forecast';
  schemaVersion: typeof LEGACY_RELATIONSHIP_FORECAST_VERSION;
  classification: typeof LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION;
  corpusVersion: typeof LEGACY_RELATIONSHIP_FORECAST_CORPUS_VERSION;
  lowerBoundOnly: true;
  activationEvidence: false;
  externalWritesPerformed: false;
  limitations: readonly string[];
  sourceSample: {
    sampleDirectory: string;
    scope: 'bounded_subset' | 'complete_local_sample';
    verifiedAvailableCounts: LegacyForecastKindCounts;
    sampleCounts: LegacyForecastKindCounts;
    sampleTotal: number;
    targetCounts: LegacyForecastKindCounts;
    targetTotal: number;
    sampleSetSha256: string;
  };
  legacyNodeArchive: {
    meaning: 'measured_legacy_v1_nodes_not_relationship_inputs';
    byKind: Record<EvidenceUniverseNodeKind, ByteProjection>;
    sampleUncompressedBytes: number;
    sampleCompressedBytes: number;
    projectedUncompressedBytes: number;
    projectedCompressedBytes: number;
  };
  extractedRelationshipInputEstimate: {
    meaning: 'deterministic_v1_to_v2_projection_without_current_feature_archives';
    relationshipInputPartCount: number;
    byKind: Record<EvidenceUniverseNodeKind, ByteProjection>;
    sampleUncompressedBytes: number;
    sampleCompressedBytes: number;
    projectedUncompressedBytes: number;
    projectedCompressedBytes: number;
    planningInterval: {
      basis: 'deterministic_lower_bound_with_safety_factor_not_statistical_confidence';
      uncompressedBytes: { lower: number; point: number; upper: number };
      compressedBytes: { lower: number; point: number; upper: number };
    };
  };
  postingPressure: {
    postingShardCountAssumption: number;
    samplePostingCount: number;
    projectedPostingCount: number;
    sampleRecordReplicaCountAtAssumedShards: number;
    projectedRecordReplicaCountAtAssumedShards: number;
    projectedPostingPlanningInterval: {
      basis: 'deterministic_lower_bound_with_safety_factor_not_statistical_confidence';
      lower: number;
      point: number;
      upper: number;
    };
    routes: LegacyRelationshipRoutePressure[];
  };
  diskHardCapRecommendation: {
    freeDiskBytes: number;
    minimumFreeDiskReserveBytes: number;
    maximumScratchBytes: number;
    maximumRelationshipInputBytes: number;
    maximumPostingArtifactsBytes: number;
    maximumCandidateArtifactsBytes: number;
    abortIfFreeDiskBelowBytes: number;
    assumedCandidateBytesPerPair: number;
    recommendedMaxPairsPerGroup: number;
    recommendedMaxCandidatePairsPerPostingShard: number;
    estimatedBoundedWorkingSetBytes: number;
    diskPreflightStatus: 'within_hard_cap_for_bounded_dry_run' | 'insufficient_headroom';
    activationAllowed: false;
  };
  forecastDigest: string;
};

const emptyCounts = (): LegacyForecastKindCounts => ({ sighting: 0, document: 0, photo: 0, video: 0 });

const emptySets = (): Record<EvidenceUniverseNodeKind, Set<string>> => ({
  sighting: new Set<string>(),
  document: new Set<string>(),
  photo: new Set<string>(),
  video: new Set<string>(),
});

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const safeBigIntNumber = (value: bigint, code: string) => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(code);
  return Number(value);
};

const safeAdd = (left: number, right: number, code = 'legacy_relationship_forecast_arithmetic_unsafe') => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) invalid(code);
  return safeBigIntNumber(BigInt(left) + BigInt(right), code);
};

const safeMultiply = (left: number, right: number, code = 'legacy_relationship_forecast_arithmetic_unsafe') => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) invalid(code);
  return safeBigIntNumber(BigInt(left) * BigInt(right), code);
};

const scaledCount = (value: number, target: number, sample: number, mode: 'floor' | 'ceil') => {
  if (![value, target, sample].every(Number.isSafeInteger) || value < 0 || target < 0 || sample < 1) {
    invalid('legacy_relationship_forecast_arithmetic_unsafe');
  }
  const numerator = BigInt(value) * BigInt(target);
  const denominator = BigInt(sample);
  return safeBigIntNumber(
    mode === 'ceil' ? (numerator + denominator - 1n) / denominator : numerator / denominator,
    'legacy_relationship_forecast_arithmetic_unsafe',
  );
};

const chooseTwo = (count: number) => count < 2
  ? 0
  : safeBigIntNumber(BigInt(count) * BigInt(count - 1) / 2n, 'legacy_relationship_forecast_arithmetic_unsafe');

const sumCounts = (counts: LegacyForecastKindCounts) => KINDS.reduce(
  (sum, kind) => safeAdd(sum, counts[kind]),
  0,
);

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const requireExactKeys = (value: unknown, expected: readonly string[], code: string): Record<string, unknown> => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) invalid(code);
  return value;
};

const requireSafeCount = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

const validateCounts = (value: unknown, code: string): LegacyForecastKindCounts => {
  const object = requireExactKeys(value, KINDS, code);
  return Object.fromEntries(KINDS.map((kind) => [kind, requireSafeCount(object[kind], code)])) as LegacyForecastKindCounts;
};

const countsEqual = (left: LegacyForecastKindCounts, right: LegacyForecastKindCounts) => (
  KINDS.every((kind) => left[kind] === right[kind])
);

const assertExactTarget = (counts: LegacyForecastKindCounts) => {
  if (!countsEqual(counts, LEGACY_RELATIONSHIP_FORECAST_TARGET_COUNTS)) {
    invalid('legacy_relationship_forecast_target_count_mismatch');
  }
};

const readBoundedRegularFile = (path: string, maximumBytes: number, code: string) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) invalid(code);
  return readFileSync(path);
};

const readJsonObject = (path: string, code: string) => {
  const body = readBoundedRegularFile(path, MAX_MANIFEST_BYTES, code);
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    if (!isPlainObject(value)) invalid(code);
    return value;
  } catch {
    return invalid(code);
  }
};

const requireNullableString = (value: unknown, code: string, maximumBytes = 100_000) => {
  if (value === null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes) invalid(code);
  return value;
};

const decodeLegacyNode = (input: unknown, expectedKind: EvidenceUniverseNodeKind): LegacyV1Node => {
  const value = requireExactKeys(input, [
    'schemaVersion', 'address', 'kind', 'recordId', 'source', 'sourceRecordId', 'title', 'summary',
    'canonicalUrl', 'previewUrl', 'eventTimestamp', 'lat', 'lon', 'location', 'countryCode',
    'linkedSightingId', 'updatedAt', 'position',
  ], 'legacy_relationship_forecast_node_shape_invalid');
  if (
    value.schemaVersion !== 'evidence-universe-v1'
    || value.kind !== expectedKind
    || typeof value.address !== 'string'
    || typeof value.recordId !== 'string'
    || typeof value.source !== 'string'
    || typeof value.updatedAt !== 'string'
    || !Array.isArray(value.position)
    || value.position.length !== 3
    || !value.position.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  ) invalid('legacy_relationship_forecast_node_shape_invalid');
  const nullableStrings = [
    'sourceRecordId', 'title', 'summary', 'canonicalUrl', 'previewUrl', 'eventTimestamp',
    'location', 'countryCode', 'linkedSightingId',
  ] as const;
  for (const key of nullableStrings) requireNullableString(value[key], 'legacy_relationship_forecast_node_shape_invalid');
  for (const key of ['lat', 'lon'] as const) {
    if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
      invalid('legacy_relationship_forecast_node_shape_invalid');
    }
  }
  const decoded = value as unknown as LegacyV1Node;
  const raw = {
    kind: expectedKind,
    recordId: decoded.recordId,
    source: decoded.source,
    sourceRecordId: decoded.sourceRecordId,
    title: decoded.title,
    summary: decoded.summary,
    canonicalUrl: decoded.canonicalUrl,
    previewUrl: decoded.previewUrl,
    eventTimestamp: decoded.eventTimestamp,
    lat: decoded.lat,
    lon: decoded.lon,
    location: decoded.location,
    countryCode: decoded.countryCode,
    linkedSightingId: decoded.linkedSightingId,
    updatedAt: decoded.updatedAt,
    public: true,
  };
  const current = projectEvidenceUniverseNode(raw);
  if (current.address !== value.address) invalid('legacy_relationship_forecast_node_address_mismatch');
  return decoded;
};

type LoadedLegacySample = {
  sampleDirectory: string;
  nodesByKind: Record<EvidenceUniverseNodeKind, LegacyV1Node[]>;
  archiveMetrics: Record<EvidenceUniverseNodeKind, LegacySampleArchiveMetric>;
  targetCounts: LegacyForecastKindCounts;
  sampleSetSha256: string;
};

const validateCompletion = (value: unknown) => {
  const completion = requireExactKeys(value, [
    'recordType', 'archiveVersion', 'schemaVersion', 'corpusVersion', 'expected', 'exportedByKind',
    'cursors', 'parts', 'accounting', 'archiveSetSha256', 'completedAt',
  ], 'legacy_relationship_forecast_completion_invalid');
  if (
    completion.recordType !== 'evidence_universe_completion'
    || completion.archiveVersion !== 'evidence-universe-archive-v1'
    || completion.schemaVersion !== 'evidence-universe-v1'
    || completion.corpusVersion !== LEGACY_RELATIONSHIP_FORECAST_CORPUS_VERSION
    || !Array.isArray(completion.parts)
    || typeof completion.archiveSetSha256 !== 'string'
    || !SHA256_PATTERN.test(completion.archiveSetSha256)
  ) invalid('legacy_relationship_forecast_completion_invalid');
  const expected = requireExactKeys(completion.expected, [
    'snapshotAt', 'byKind', 'total', 'sightingPolicy', 'mediaBackfillsComplete',
  ], 'legacy_relationship_forecast_completion_invalid');
  const targets = validateCounts(expected.byKind, 'legacy_relationship_forecast_target_count_mismatch');
  assertExactTarget(targets);
  if (
    expected.total !== sumCounts(targets)
    || expected.snapshotAt !== FORECAST_GENERATED_AT
    || !countsEqual(validateCounts(completion.exportedByKind, 'legacy_relationship_forecast_target_count_mismatch'), targets)
  ) invalid('legacy_relationship_forecast_target_count_mismatch');
  const accounting = requireExactKeys(completion.accounting, [
    'total', 'byKind', 'attachedMedia', 'unresolvedTime', 'unresolvedLocation',
  ], 'legacy_relationship_forecast_completion_invalid');
  if (accounting.total !== sumCounts(targets)
    || !countsEqual(validateCounts(accounting.byKind, 'legacy_relationship_forecast_target_count_mismatch'), targets)) {
    invalid('legacy_relationship_forecast_target_count_mismatch');
  }
  return { completion, targets };
};

export const loadLegacyV7RelationshipForecastSample = (sampleDirectoryInput: string): LoadedLegacySample => {
  const sampleDirectory = resolve(sampleDirectoryInput);
  const completionBody = readBoundedRegularFile(
    resolve(sampleDirectory, '_complete.manifest.json'),
    MAX_MANIFEST_BYTES,
    'legacy_relationship_forecast_completion_invalid',
  );
  let completionValue: unknown;
  try {
    completionValue = JSON.parse(completionBody.toString('utf8'));
  } catch {
    invalid('legacy_relationship_forecast_completion_invalid');
  }
  const { completion, targets } = validateCompletion(completionValue);
  const fullParts = completion.parts as unknown[];
  const nodesByKind = {} as Record<EvidenceUniverseNodeKind, LegacyV1Node[]>;
  const archiveMetrics = {} as Record<EvidenceUniverseNodeKind, LegacySampleArchiveMetric>;
  const seenAddresses = new Set<string>();

  for (const kind of KINDS) {
    const manifest = requireExactKeys(
      readJsonObject(resolve(sampleDirectory, `${kind}.manifest.json`), 'legacy_relationship_forecast_sample_manifest_invalid'),
      [
        'partNumber', 'kind', 'rowCount', 'archiveKey', 'manifestKey', 'compressedBytes',
        'uncompressedBytes', 'sha256', 'firstAddress', 'lastAddress', 'cursor', 'accounting',
      ],
      'legacy_relationship_forecast_sample_manifest_invalid',
    );
    const rowCount = requireSafeCount(manifest.rowCount, 'legacy_relationship_forecast_sample_count_invalid', 1);
    if (
      manifest.kind !== kind
      || rowCount !== LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS[kind]
      || rowCount > MAX_SAMPLE_ROWS_PER_KIND
      || typeof manifest.archiveKey !== 'string'
      || typeof manifest.sha256 !== 'string'
      || !SHA256_PATTERN.test(manifest.sha256)
      || typeof manifest.firstAddress !== 'string'
      || typeof manifest.lastAddress !== 'string'
    ) invalid('legacy_relationship_forecast_sample_count_invalid');
    const compressedBytes = requireSafeCount(
      manifest.compressedBytes,
      'legacy_relationship_forecast_sample_manifest_invalid',
      1,
    );
    const uncompressedBytes = requireSafeCount(
      manifest.uncompressedBytes,
      'legacy_relationship_forecast_sample_manifest_invalid',
      1,
    );
    if (compressedBytes > MAX_SAMPLE_COMPRESSED_BYTES || uncompressedBytes > MAX_SAMPLE_UNCOMPRESSED_BYTES) {
      invalid('legacy_relationship_forecast_sample_size_unsafe');
    }
    const completionPart = fullParts.find((part) => isPlainObject(part) && part.archiveKey === manifest.archiveKey);
    if (!isPlainObject(completionPart)
      || completionPart.kind !== kind
      || completionPart.rowCount !== rowCount
      || completionPart.compressedBytes !== compressedBytes
      || completionPart.uncompressedBytes !== uncompressedBytes
      || completionPart.sha256 !== manifest.sha256) {
      invalid('legacy_relationship_forecast_sample_completion_mismatch');
    }
    const archiveBody = readBoundedRegularFile(
      resolve(sampleDirectory, `${kind}.ndjson.gz`),
      MAX_SAMPLE_COMPRESSED_BYTES,
      'legacy_relationship_forecast_sample_archive_invalid',
    );
    if (archiveBody.length !== compressedBytes || sha256(archiveBody) !== manifest.sha256) {
      invalid('legacy_relationship_forecast_sample_compressed_receipt_mismatch');
    }
    let body: Buffer;
    try {
      body = gunzipSync(archiveBody, { maxOutputLength: MAX_SAMPLE_UNCOMPRESSED_BYTES });
    } catch {
      return invalid('legacy_relationship_forecast_sample_gzip_invalid');
    }
    if (body.length !== uncompressedBytes || !body.length || body[body.length - 1] !== 0x0a) {
      invalid('legacy_relationship_forecast_sample_uncompressed_receipt_mismatch');
    }
    const lines = body.toString('utf8').slice(0, -1).split('\n');
    if (lines.length !== rowCount || lines.some((line) => !line.length || Buffer.byteLength(line, 'utf8') > MAX_NDJSON_LINE_BYTES)) {
      invalid('legacy_relationship_forecast_sample_row_count_mismatch');
    }
    const nodes = lines.map((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return invalid('legacy_relationship_forecast_sample_ndjson_invalid');
      }
      return decodeLegacyNode(value, kind);
    });
    for (let index = 0; index < nodes.length; index += 1) {
      if (seenAddresses.has(nodes[index].address)) invalid('legacy_relationship_forecast_sample_address_duplicate');
      seenAddresses.add(nodes[index].address);
    }
    if (nodes[0].address !== manifest.firstAddress || nodes.at(-1)?.address !== manifest.lastAddress) {
      invalid('legacy_relationship_forecast_sample_address_bounds_mismatch');
    }
    nodesByKind[kind] = nodes;
    archiveMetrics[kind] = {
      rowCount,
      uncompressedBytes,
      compressedBytes,
      compressedSha256: manifest.sha256,
    };
  }
  if (seenAddresses.size !== sumCounts(LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS)) {
    invalid('legacy_relationship_forecast_sample_count_mismatch');
  }
  const sampleSetSha256 = sha256([
    sha256(completionBody),
    ...KINDS.map((kind) => `${kind}:${archiveMetrics[kind].compressedSha256}`),
  ].join('\n'));
  return { sampleDirectory, nodesByKind, archiveMetrics, targetCounts: targets, sampleSetSha256 };
};

const projectBytes = (
  metric: LegacySampleArchiveMetric,
  targetRows: number,
): ByteProjection => ({
  sample: metric,
  projected: {
    rowCount: targetRows,
    uncompressedBytes: scaledCount(metric.uncompressedBytes, targetRows, metric.rowCount, 'ceil'),
    compressedBytes: scaledCount(metric.compressedBytes, targetRows, metric.rowCount, 'ceil'),
  },
});

const projectCountFloor = (value: number, sampleCount: number, targetCount: number) => (
  scaledCount(value, targetCount, sampleCount, 'floor')
);

const projectByKindFloor = (
  values: LegacyForecastKindCounts,
  sampleCounts: LegacyForecastKindCounts,
  targets: LegacyForecastKindCounts,
) => KINDS.reduce(
  (sum, kind) => safeAdd(sum, projectCountFloor(values[kind], sampleCounts[kind], targets[kind])),
  0,
);

const postingCap = (kind: FullCorpusPostingKind, caps: FullCorpusPostingCaps) => ({
  address_identity: caps.addressIdentity,
  source_identity: caps.sourceIdentity,
  source_record: caps.sourceRecord,
  source_lineage: caps.sourceLineage,
  duplicate_cluster: caps.duplicateCluster,
  matchable_value: caps.matchableValue,
  space_time: caps.spaceTime,
  duration: caps.duration,
})[kind];

const groupCounts = (sets: Record<EvidenceUniverseNodeKind, Set<string>>): LegacyForecastKindCounts => ({
  sighting: sets.sighting.size,
  document: sets.document.size,
  photo: sets.photo.size,
  video: sets.video.size,
});

const pairRoutesFor = (
  routeKind: FullCorpusPostingKind,
  distinctCount: number,
  identityCount: number,
  assertionPostingCount: number,
) => {
  if (routeKind === 'address_identity') {
    return safeMultiply(identityCount, Math.max(0, distinctCount - identityCount));
  }
  if (routeKind === 'source_identity') {
    return safeAdd(chooseTwo(identityCount), safeMultiply(assertionPostingCount, identityCount));
  }
  return chooseTwo(distinctCount);
};

const isStableOccupancyRoute = (kind: FullCorpusPostingKind) => (
  kind === 'source_identity'
  || kind === 'source_lineage'
  || kind === 'matchable_value'
  || kind === 'space_time'
  || kind === 'duration'
);

const buildRoutePressure = (params: {
  groups: Map<string, RouteGroup>;
  routePostingByKind: Record<FullCorpusPostingKind, LegacyForecastKindCounts>;
  sampleCounts: LegacyForecastKindCounts;
  targetCounts: LegacyForecastKindCounts;
  caps: FullCorpusPostingCaps;
}) => POSTING_KINDS.map((routeKind): LegacyRelationshipRoutePressure => {
  const routeGroups = [...params.groups.values()].filter((group) => group.routeKind === routeKind);
  const cap = postingCap(routeKind, params.caps);
  let samplePotential = 0;
  let sampleRetained = 0;
  let sampleSkipped = 0;
  let sampleBreaches = 0;
  let projectedPotential = 0;
  let projectedRetained = 0;
  let projectedSkipped = 0;
  let projectedBreaches = 0;
  let largestPostingCount = 0;
  let largestDistinctCount = 0;
  let largestPotential = 0;

  for (const group of routeGroups) {
    const postingCount = sumCounts(group.postingByKind);
    const distinctByKind = groupCounts(group.addressesByKind);
    const identityByKind = groupCounts(group.identityAddressesByKind);
    const distinctCount = sumCounts(distinctByKind);
    const identityCount = sumCounts(identityByKind);
    const assertionCount = sumCounts(group.assertionPostingByKind);
    const potential = pairRoutesFor(routeKind, distinctCount, identityCount, assertionCount);
    const breached = postingCount > cap || potential > params.caps.maxPairsPerGroup;
    samplePotential = safeAdd(samplePotential, potential);
    if (breached) {
      sampleBreaches += 1;
      sampleSkipped = safeAdd(sampleSkipped, potential);
    } else sampleRetained = safeAdd(sampleRetained, potential);
    if (potential > largestPotential
      || (potential === largestPotential && postingCount > largestPostingCount)) {
      largestPostingCount = postingCount;
      largestDistinctCount = distinctCount;
      largestPotential = potential;
    }

    if (isStableOccupancyRoute(routeKind)) {
      const projectedPosting = projectByKindFloor(group.postingByKind, params.sampleCounts, params.targetCounts);
      const projectedDistinct = projectByKindFloor(distinctByKind, params.sampleCounts, params.targetCounts);
      const projectedIdentity = projectByKindFloor(identityByKind, params.sampleCounts, params.targetCounts);
      const projectedAssertions = projectByKindFloor(group.assertionPostingByKind, params.sampleCounts, params.targetCounts);
      const projectedPairs = pairRoutesFor(routeKind, projectedDistinct, projectedIdentity, projectedAssertions);
      const projectedBreach = projectedPosting > cap || projectedPairs > params.caps.maxPairsPerGroup;
      projectedPotential = safeAdd(projectedPotential, projectedPairs);
      if (projectedBreach) {
        projectedBreaches += 1;
        projectedSkipped = safeAdd(projectedSkipped, projectedPairs);
      } else projectedRetained = safeAdd(projectedRetained, projectedPairs);
    }
  }

  const projectedPostingCount = projectByKindFloor(
    params.routePostingByKind[routeKind],
    params.sampleCounts,
    params.targetCounts,
  );
  if (!isStableOccupancyRoute(routeKind)) {
    const samplePostingCount = sumCounts(params.routePostingByKind[routeKind]);
    const scale = (value: number) => samplePostingCount
      ? scaledCount(value, projectedPostingCount, samplePostingCount, 'floor')
      : 0;
    projectedPotential = scale(samplePotential);
    projectedRetained = scale(sampleRetained);
    projectedSkipped = scale(sampleSkipped);
    projectedBreaches = sampleBreaches;
  }

  return {
    routeKind,
    postingCap: cap,
    pairCap: params.caps.maxPairsPerGroup,
    projectionMethod: isStableOccupancyRoute(routeKind) ? 'stable_group_occupancy' : 'observed_pair_linear',
    sample: {
      postingCount: sumCounts(params.routePostingByKind[routeKind]),
      groupCount: routeGroups.length,
      potentialPairRoutes: samplePotential,
      retainedPotentialPairRoutes: sampleRetained,
      skippedPotentialPairRoutes: sampleSkipped,
      capBreachGroupCount: sampleBreaches,
      largestGroupPostingCount: largestPostingCount,
      largestGroupDistinctAddressCount: largestDistinctCount,
      largestGroupPotentialPairRoutes: largestPotential,
    },
    projected: {
      postingCount: projectedPostingCount,
      potentialPairRoutes: projectedPotential,
      retainedPotentialPairRoutes: projectedRetained,
      skippedPotentialPairRoutes: projectedSkipped,
      capBreachGroupCount: projectedBreaches,
    },
  };
});

const partitionRecords = (records: readonly RelationshipInputRecord[]) => {
  const chunks: RelationshipInputRecord[][] = [];
  let current: RelationshipInputRecord[] = [];
  let currentBytes = 0;
  for (const record of records) {
    const bytes = Buffer.byteLength(`${canonicalizeRelationshipInput(record)}\n`, 'utf8');
    if (bytes > RELATIONSHIP_PART_MAX_BYTES) invalid('legacy_relationship_forecast_relationship_record_too_large');
    if (current.length && (current.length >= RELATIONSHIP_PART_MAX_ROWS
      || currentBytes + bytes > RELATIONSHIP_PART_MAX_BYTES)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(record);
    currentBytes += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
};

const buildDiskRecommendation = (params: {
  freeDiskBytes: number;
  projectedRelationshipInputBytes: number;
  projectedPostingCount: number;
  projectedRecordReplicaCount: number;
  averageRelationshipRecordBytes: number;
  projectedRetainedPairRoutes: number;
  caps: FullCorpusPostingCaps;
}) => {
  const reserve = Math.max(8 * GIB, Math.ceil(params.freeDiskBytes * 0.4));
  const maximumScratchBytes = Math.max(0, Math.min(
    12 * GIB,
    Math.floor(Math.max(0, params.freeDiskBytes - reserve) * 0.7),
  ));
  const maximumRelationshipInputBytes = Math.min(2 * GIB, Math.floor(maximumScratchBytes * 0.2));
  const maximumPostingArtifactsBytes = Math.min(4 * GIB, Math.floor(maximumScratchBytes * 0.35));
  const maximumCandidateArtifactsBytes = Math.max(
    0,
    maximumScratchBytes - maximumRelationshipInputBytes - maximumPostingArtifactsBytes - GIB,
  );
  const recommendedPerShardPairs = Math.max(1_000, Math.floor(
    maximumCandidateArtifactsBytes
      / FORECAST_POSTING_SHARD_COUNT
      / FORECAST_CANDIDATE_BYTES_PER_PAIR
      / 1_000,
  ) * 1_000);
  const recommendedMaxCandidatePairsPerPostingShard = Math.min(
    params.caps.maxCandidatePairsPerPostingShard,
    recommendedPerShardPairs,
  );
  const recommendedMaxPairsPerGroup = Math.min(
    params.caps.maxPairsPerGroup,
    recommendedMaxCandidatePairsPerPostingShard,
  );
  const estimatedPostingBytes = requireSafeCount(Math.ceil(
    safeMultiply(params.projectedPostingCount, 384)
    + params.projectedRecordReplicaCount * params.averageRelationshipRecordBytes,
  ), 'legacy_relationship_forecast_arithmetic_unsafe');
  const boundedPairs = Math.min(
    params.projectedRetainedPairRoutes,
    recommendedMaxCandidatePairsPerPostingShard * FORECAST_POSTING_SHARD_COUNT,
  );
  const estimatedCandidateBytes = safeMultiply(boundedPairs, FORECAST_CANDIDATE_BYTES_PER_PAIR);
  const workingSubtotal = safeAdd(
    safeAdd(params.projectedRelationshipInputBytes, estimatedPostingBytes),
    estimatedCandidateBytes,
  );
  const estimatedBoundedWorkingSetBytes = requireSafeCount(
    Math.ceil(workingSubtotal * 1.25),
    'legacy_relationship_forecast_arithmetic_unsafe',
  );
  const abortIfFreeDiskBelowBytes = safeAdd(
    reserve,
    Math.min(maximumScratchBytes, estimatedBoundedWorkingSetBytes),
  );
  return {
    freeDiskBytes: params.freeDiskBytes,
    minimumFreeDiskReserveBytes: reserve,
    maximumScratchBytes,
    maximumRelationshipInputBytes,
    maximumPostingArtifactsBytes,
    maximumCandidateArtifactsBytes,
    abortIfFreeDiskBelowBytes,
    assumedCandidateBytesPerPair: FORECAST_CANDIDATE_BYTES_PER_PAIR,
    recommendedMaxPairsPerGroup,
    recommendedMaxCandidatePairsPerPostingShard,
    estimatedBoundedWorkingSetBytes,
    diskPreflightStatus: (
      maximumScratchBytes > 0
      && params.projectedRelationshipInputBytes <= maximumRelationshipInputBytes
      && estimatedPostingBytes <= maximumPostingArtifactsBytes
      && estimatedCandidateBytes <= maximumCandidateArtifactsBytes
      && estimatedBoundedWorkingSetBytes <= maximumScratchBytes
    ) ? 'within_hard_cap_for_bounded_dry_run' as const : 'insufficient_headroom' as const,
    activationAllowed: false as const,
  };
};

export const buildLegacyRelationshipSampleForecast = (params: {
  sampleDirectory: string;
  nodesByKind: Record<EvidenceUniverseNodeKind, LegacyV1Node[]>;
  archiveMetrics: Record<EvidenceUniverseNodeKind, LegacySampleArchiveMetric>;
  targetCounts: LegacyForecastKindCounts;
  sampleSetSha256: string;
  freeDiskBytes: number;
  expectedSampleCounts?: LegacyForecastKindCounts;
  verifiedAvailableCounts?: LegacyForecastKindCounts;
  sampleScope?: 'bounded_subset' | 'complete_local_sample';
  caps?: FullCorpusPostingCaps;
}): LegacyRelationshipSampleForecast => {
  assertExactTarget(params.targetCounts);
  if (!SHA256_PATTERN.test(params.sampleSetSha256)) invalid('legacy_relationship_forecast_sample_set_sha_invalid');
  const freeDiskBytes = requireSafeCount(params.freeDiskBytes, 'legacy_relationship_forecast_free_disk_invalid');
  const sampleCounts = Object.fromEntries(KINDS.map((kind) => [kind, params.nodesByKind[kind]?.length ?? 0])) as LegacyForecastKindCounts;
  for (const kind of KINDS) {
    if (!sampleCounts[kind] || sampleCounts[kind] > params.targetCounts[kind]) {
      invalid('legacy_relationship_forecast_sample_count_invalid');
    }
    if (params.archiveMetrics[kind]?.rowCount !== sampleCounts[kind]) {
      invalid('legacy_relationship_forecast_archive_metric_count_mismatch');
    }
  }
  if (params.expectedSampleCounts && !countsEqual(sampleCounts, params.expectedSampleCounts)) {
    invalid('legacy_relationship_forecast_sample_count_mismatch');
  }
  const verifiedAvailableCounts = params.verifiedAvailableCounts ?? sampleCounts;
  for (const kind of KINDS) {
    if (!Number.isSafeInteger(verifiedAvailableCounts[kind])
      || verifiedAvailableCounts[kind] < sampleCounts[kind]
      || verifiedAvailableCounts[kind] > params.targetCounts[kind]) {
      invalid('legacy_relationship_forecast_available_count_invalid');
    }
  }
  const sampleScope = params.sampleScope ?? 'complete_local_sample';
  if ((sampleScope === 'complete_local_sample' && !countsEqual(sampleCounts, verifiedAvailableCounts))
    || (sampleScope === 'bounded_subset' && countsEqual(sampleCounts, verifiedAvailableCounts))) {
    invalid('legacy_relationship_forecast_sample_scope_mismatch');
  }
  const binding: RelationshipInputUniverseBinding = {
    snapshotId: FORECAST_BINDING_SNAPSHOT_ID,
    corpusVersion: 'forecast-only-legacy-v7',
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: relationshipInputSha256({
      classification: LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION,
      sampleSetSha256: params.sampleSetSha256,
    }),
    universeRecordCount: sumCounts(sampleCounts),
  };
  const recordsByKind = {} as Record<EvidenceUniverseNodeKind, RelationshipInputRecord[]>;
  const allAddresses = new Set<string>();
  for (const kind of KINDS) {
    recordsByKind[kind] = params.nodesByKind[kind].map((legacy) => {
      const node = projectEvidenceUniverseNode({
        kind: legacy.kind,
        recordId: legacy.recordId,
        source: legacy.source,
        sourceRecordId: legacy.sourceRecordId,
        title: legacy.title,
        summary: legacy.summary,
        canonicalUrl: legacy.canonicalUrl,
        previewUrl: legacy.previewUrl,
        eventTimestamp: legacy.eventTimestamp,
        lat: legacy.lat,
        lon: legacy.lon,
        location: legacy.location,
        countryCode: legacy.countryCode,
        linkedSightingId: legacy.linkedSightingId,
        updatedAt: legacy.updatedAt,
        public: true,
      });
      if (node.address !== legacy.address || allAddresses.has(node.address)) {
        invalid('legacy_relationship_forecast_projected_address_mismatch');
      }
      allAddresses.add(node.address);
      return extractRelationshipInputRecord(node, {
        binding,
        vectorPolicy: {
          modelId: 'forecast-only',
          modelVersion: 'legacy-sample-v1',
          dimensions: 1,
          normalization: 'none',
        },
      });
    }).sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
  }

  const builtParts: Array<{
    kind: EvidenceUniverseNodeKind;
    records: RelationshipInputRecord[];
    manifest: RelationshipInputPartManifest;
  }> = [];
  let partNumber = 0;
  for (const kind of ADDRESS_ORDER) for (const chunk of partitionRecords(recordsByKind[kind])) {
    const part = buildRelationshipInputPart({
      binding,
      partNumber,
      records: chunk,
      limits: {
        maxRows: RELATIONSHIP_PART_MAX_ROWS,
        maxUncompressedBytes: RELATIONSHIP_PART_MAX_BYTES,
        maxCompressedBytes: RELATIONSHIP_PART_MAX_BYTES,
      },
    });
    builtParts.push({ kind, records: part.records, manifest: part.manifest });
    partNumber += 1;
  }
  const relationshipInputManifest = buildRelationshipInputSnapshotManifest({
    binding,
    parts: builtParts.map((part) => part.manifest),
    generatedAt: FORECAST_GENERATED_AT,
  });
  const allRecords = ADDRESS_ORDER.flatMap((kind) => recordsByKind[kind]);
  const rarityIndex = buildTypedRelationshipRarityIndex(allRecords, binding);
  const fragments = builtParts.flatMap((part, inputPartNumber) => buildFullCorpusPostingFragments({
    records: part.records,
    inputPartNumber,
    relationshipInputManifest,
    rarityIndex,
    postingShardCount: 1,
  }));

  const routePostingByKind = Object.fromEntries(POSTING_KINDS.map((kind) => [kind, emptyCounts()])) as Record<
    FullCorpusPostingKind,
    LegacyForecastKindCounts
  >;
  const groups = new Map<string, RouteGroup>();
  const recordPostingShards = new Map<string, Set<number>>();
  const recordKind = new Map<string, EvidenceUniverseNodeKind>();
  for (const fragment of fragments) for (const posting of fragment.postings) {
    const record = fragment.records[posting.recordIndex];
    const kind = record.address.slice(0, record.address.indexOf(':')) as EvidenceUniverseNodeKind;
    routePostingByKind[posting.routeKind][kind] += 1;
    recordKind.set(record.address, kind);
    const shardSet = recordPostingShards.get(record.address) || new Set<number>();
    shardSet.add(fullCorpusRelationshipShard(posting.signature, FORECAST_POSTING_SHARD_COUNT));
    recordPostingShards.set(record.address, shardSet);
    const group = groups.get(posting.signature) || {
      routeKind: posting.routeKind,
      postingByKind: emptyCounts(),
      addressesByKind: emptySets(),
      identityAddressesByKind: emptySets(),
      assertionPostingByKind: emptyCounts(),
    };
    if (group.routeKind !== posting.routeKind) invalid('legacy_relationship_forecast_posting_group_mixed');
    group.postingByKind[kind] += 1;
    group.addressesByKind[kind].add(record.address);
    if (posting.reasonCode === null) group.identityAddressesByKind[kind].add(record.address);
    if (posting.reasonCode === 'governed_source_assertion') group.assertionPostingByKind[kind] += 1;
    groups.set(posting.signature, group);
  }
  const caps = params.caps ?? LEGACY_RELATIONSHIP_FORECAST_CAPS;
  const routes = buildRoutePressure({ groups, routePostingByKind, sampleCounts, targetCounts: params.targetCounts, caps });
  const samplePostingCount = routes.reduce((sum, route) => safeAdd(sum, route.sample.postingCount), 0);
  const projectedPostingCount = routes.reduce((sum, route) => safeAdd(sum, route.projected.postingCount), 0);
  const replicaByKind = emptyCounts();
  for (const [address, shards] of recordPostingShards) replicaByKind[recordKind.get(address) as EvidenceUniverseNodeKind] += shards.size;
  const sampleRecordReplicaCount = sumCounts(replicaByKind);
  const projectedRecordReplicaCount = projectByKindFloor(replicaByKind, sampleCounts, params.targetCounts);

  const relationshipMetrics = {} as Record<EvidenceUniverseNodeKind, LegacySampleArchiveMetric>;
  for (const kind of KINDS) {
    const manifests = builtParts.filter((part) => part.kind === kind).map((part) => part.manifest);
    relationshipMetrics[kind] = {
      rowCount: manifests.reduce((sum, manifest) => sum + manifest.rowCount, 0),
      uncompressedBytes: manifests.reduce((sum, manifest) => sum + manifest.uncompressedBytes, 0),
      compressedBytes: manifests.reduce((sum, manifest) => sum + manifest.compressedBytes, 0),
      compressedSha256: relationshipInputSha256(manifests.map((manifest) => manifest.compressedSha256)),
    };
  }
  const legacyByKind = Object.fromEntries(KINDS.map((kind) => [
    kind,
    projectBytes(params.archiveMetrics[kind], params.targetCounts[kind]),
  ])) as Record<EvidenceUniverseNodeKind, ByteProjection>;
  const relationshipByKind = Object.fromEntries(KINDS.map((kind) => [
    kind,
    projectBytes(relationshipMetrics[kind], params.targetCounts[kind]),
  ])) as Record<EvidenceUniverseNodeKind, ByteProjection>;
  const totalMetric = (
    byKind: Record<EvidenceUniverseNodeKind, ByteProjection>,
    section: 'sample' | 'projected',
    field: 'uncompressedBytes' | 'compressedBytes',
  ) => KINDS.reduce((sum, kind) => safeAdd(sum, byKind[kind][section][field]), 0);
  const sampleRelationshipBytes = totalMetric(relationshipByKind, 'sample', 'uncompressedBytes');
  const projectedRelationshipBytes = totalMetric(relationshipByKind, 'projected', 'uncompressedBytes');
  const projectedRelationshipGzipBytes = totalMetric(relationshipByKind, 'projected', 'compressedBytes');
  const projectedRelationshipUpperBytes = scaledCount(
    projectedRelationshipBytes,
    RELATIONSHIP_RAW_UPPER_FACTOR_NUMERATOR,
    RELATIONSHIP_RAW_UPPER_FACTOR_DENOMINATOR,
    'ceil',
  );
  const projectedRelationshipGzipUpperBytes = safeMultiply(
    projectedRelationshipGzipBytes,
    RELATIONSHIP_GZIP_UPPER_FACTOR,
  );
  const projectedPostingUpper = safeMultiply(projectedPostingCount, POSTING_UPPER_FACTOR);
  const projectedReplicaUpper = safeMultiply(projectedRecordReplicaCount, POSTING_UPPER_FACTOR);
  const projectedRetainedPairRoutes = routes.reduce(
    (sum, route) => safeAdd(sum, route.projected.retainedPotentialPairRoutes),
    0,
  );
  const diskHardCapRecommendation = buildDiskRecommendation({
    freeDiskBytes,
    projectedRelationshipInputBytes: projectedRelationshipUpperBytes,
    projectedPostingCount: projectedPostingUpper,
    projectedRecordReplicaCount: projectedReplicaUpper,
    averageRelationshipRecordBytes: sampleRelationshipBytes / sumCounts(sampleCounts),
    projectedRetainedPairRoutes,
    caps,
  });
  const withoutDigest: Omit<LegacyRelationshipSampleForecast, 'forecastDigest'> = {
    recordType: 'legacy_relationship_sample_forecast',
    schemaVersion: LEGACY_RELATIONSHIP_FORECAST_VERSION,
    classification: LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION,
    corpusVersion: LEGACY_RELATIONSHIP_FORECAST_CORPUS_VERSION,
    lowerBoundOnly: true,
    activationEvidence: false,
    externalWritesPerformed: false,
    limitations: FORECAST_LIMITATIONS,
    sourceSample: {
      sampleDirectory: resolve(params.sampleDirectory),
      scope: sampleScope,
      verifiedAvailableCounts,
      sampleCounts,
      sampleTotal: sumCounts(sampleCounts),
      targetCounts: params.targetCounts,
      targetTotal: sumCounts(params.targetCounts),
      sampleSetSha256: params.sampleSetSha256,
    },
    legacyNodeArchive: {
      meaning: 'measured_legacy_v1_nodes_not_relationship_inputs',
      byKind: legacyByKind,
      sampleUncompressedBytes: totalMetric(legacyByKind, 'sample', 'uncompressedBytes'),
      sampleCompressedBytes: totalMetric(legacyByKind, 'sample', 'compressedBytes'),
      projectedUncompressedBytes: totalMetric(legacyByKind, 'projected', 'uncompressedBytes'),
      projectedCompressedBytes: totalMetric(legacyByKind, 'projected', 'compressedBytes'),
    },
    extractedRelationshipInputEstimate: {
      meaning: 'deterministic_v1_to_v2_projection_without_current_feature_archives',
      relationshipInputPartCount: builtParts.length,
      byKind: relationshipByKind,
      sampleUncompressedBytes: sampleRelationshipBytes,
      sampleCompressedBytes: totalMetric(relationshipByKind, 'sample', 'compressedBytes'),
      projectedUncompressedBytes: projectedRelationshipBytes,
      projectedCompressedBytes: projectedRelationshipGzipBytes,
      planningInterval: {
        basis: 'deterministic_lower_bound_with_safety_factor_not_statistical_confidence',
        uncompressedBytes: {
          lower: projectedRelationshipBytes,
          point: projectedRelationshipBytes,
          upper: projectedRelationshipUpperBytes,
        },
        compressedBytes: {
          lower: projectedRelationshipGzipBytes,
          point: projectedRelationshipGzipBytes,
          upper: projectedRelationshipGzipUpperBytes,
        },
      },
    },
    postingPressure: {
      postingShardCountAssumption: FORECAST_POSTING_SHARD_COUNT,
      samplePostingCount,
      projectedPostingCount,
      sampleRecordReplicaCountAtAssumedShards: sampleRecordReplicaCount,
      projectedRecordReplicaCountAtAssumedShards: projectedRecordReplicaCount,
      projectedPostingPlanningInterval: {
        basis: 'deterministic_lower_bound_with_safety_factor_not_statistical_confidence',
        lower: projectedPostingCount,
        point: projectedPostingCount,
        upper: projectedPostingUpper,
      },
      routes,
    },
    diskHardCapRecommendation,
  };
  const report: LegacyRelationshipSampleForecast = {
    ...withoutDigest,
    forecastDigest: relationshipInputSha256(withoutDigest),
  };
  return decodeLegacyRelationshipSampleForecast(report, caps);
};

const requireSafeFields = (value: Record<string, unknown>, fields: readonly string[], code: string) => {
  for (const field of fields) requireSafeCount(value[field], code);
};

const decodeByteProjection = (value: unknown, code: string) => {
  const projection = requireExactKeys(value, ['sample', 'projected'], code);
  const sample = requireExactKeys(projection.sample, [
    'rowCount', 'uncompressedBytes', 'compressedBytes', 'compressedSha256',
  ], code);
  const projected = requireExactKeys(projection.projected, [
    'rowCount', 'uncompressedBytes', 'compressedBytes',
  ], code);
  requireSafeFields(sample, ['rowCount', 'uncompressedBytes', 'compressedBytes'], code);
  requireSafeFields(projected, ['rowCount', 'uncompressedBytes', 'compressedBytes'], code);
  if (typeof sample.compressedSha256 !== 'string' || !SHA256_PATTERN.test(sample.compressedSha256)) invalid(code);
};

const decodeByteSection = (
  value: unknown,
  expectedMeaning: string,
  includePartCount: boolean,
  code: string,
) => {
  const fields = [
    'meaning', 'byKind', 'sampleUncompressedBytes', 'sampleCompressedBytes',
    'projectedUncompressedBytes', 'projectedCompressedBytes',
    ...(includePartCount ? ['relationshipInputPartCount', 'planningInterval'] : []),
  ];
  const section = requireExactKeys(value, fields, code);
  if (section.meaning !== expectedMeaning) invalid(code);
  requireSafeFields(section, [
    'sampleUncompressedBytes', 'sampleCompressedBytes',
    'projectedUncompressedBytes', 'projectedCompressedBytes',
    ...(includePartCount ? ['relationshipInputPartCount'] : []),
  ], code);
  const byKind = requireExactKeys(section.byKind, KINDS, code);
  for (const kind of KINDS) decodeByteProjection(byKind[kind], code);
  if (includePartCount) {
    const interval = requireExactKeys(section.planningInterval, [
      'basis', 'uncompressedBytes', 'compressedBytes',
    ], code);
    if (interval.basis !== 'deterministic_lower_bound_with_safety_factor_not_statistical_confidence') invalid(code);
    for (const field of ['uncompressedBytes', 'compressedBytes'] as const) {
      const range = requireExactKeys(interval[field], ['lower', 'point', 'upper'], code);
      requireSafeFields(range, ['lower', 'point', 'upper'], code);
      if (range.lower !== range.point || Number(range.upper) < Number(range.point)) invalid(code);
    }
  }
};

/**
 * Strictly validates the planning report's fail-closed claims and digest. A
 * caller cannot self-rehash a changed activation flag, target corpus, or cap
 * set into a report that passes this decoder.
 */
export const decodeLegacyRelationshipSampleForecast = (
  input: unknown,
  expectedCaps: FullCorpusPostingCaps = LEGACY_RELATIONSHIP_FORECAST_CAPS,
): LegacyRelationshipSampleForecast => {
  let parsed: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      parsed = JSON.parse(String(input));
    } catch {
      invalid('legacy_relationship_forecast_report_json_invalid');
    }
  }
  const report = requireExactKeys(parsed, [
    'recordType', 'schemaVersion', 'classification', 'corpusVersion', 'lowerBoundOnly',
    'activationEvidence', 'externalWritesPerformed', 'limitations', 'sourceSample',
    'legacyNodeArchive', 'extractedRelationshipInputEstimate', 'postingPressure',
    'diskHardCapRecommendation', 'forecastDigest',
  ], 'legacy_relationship_forecast_report_invalid');
  if (
    report.recordType !== 'legacy_relationship_sample_forecast'
    || report.schemaVersion !== LEGACY_RELATIONSHIP_FORECAST_VERSION
    || report.classification !== LEGACY_RELATIONSHIP_FORECAST_CLASSIFICATION
    || report.corpusVersion !== LEGACY_RELATIONSHIP_FORECAST_CORPUS_VERSION
    || report.lowerBoundOnly !== true
    || report.activationEvidence !== false
    || report.externalWritesPerformed !== false
    || !Array.isArray(report.limitations)
    || canonicalizeRelationshipInput(report.limitations) !== canonicalizeRelationshipInput(FORECAST_LIMITATIONS)
    || typeof report.forecastDigest !== 'string'
    || !SHA256_PATTERN.test(report.forecastDigest)
  ) invalid('legacy_relationship_forecast_report_claim_invalid');

  const source = requireExactKeys(report.sourceSample, [
    'sampleDirectory', 'scope', 'verifiedAvailableCounts', 'sampleCounts', 'sampleTotal',
    'targetCounts', 'targetTotal', 'sampleSetSha256',
  ], 'legacy_relationship_forecast_report_source_invalid');
  if (typeof source.sampleDirectory !== 'string'
    || !['bounded_subset', 'complete_local_sample'].includes(String(source.scope))
    || typeof source.sampleSetSha256 !== 'string'
    || !SHA256_PATTERN.test(source.sampleSetSha256)) {
    invalid('legacy_relationship_forecast_report_source_invalid');
  }
  const availableCounts = validateCounts(source.verifiedAvailableCounts, 'legacy_relationship_forecast_report_source_invalid');
  const sampleCounts = validateCounts(source.sampleCounts, 'legacy_relationship_forecast_report_source_invalid');
  const targetCounts = validateCounts(source.targetCounts, 'legacy_relationship_forecast_report_target_invalid');
  assertExactTarget(targetCounts);
  if (
    source.sampleTotal !== sumCounts(sampleCounts)
    || source.targetTotal !== sumCounts(targetCounts)
    || KINDS.some((kind) => sampleCounts[kind] < 1
      || sampleCounts[kind] > availableCounts[kind]
      || availableCounts[kind] > targetCounts[kind])
    || (source.scope === 'complete_local_sample' && !countsEqual(sampleCounts, availableCounts))
    || (source.scope === 'bounded_subset' && countsEqual(sampleCounts, availableCounts))
  ) invalid('legacy_relationship_forecast_report_source_invalid');

  decodeByteSection(
    report.legacyNodeArchive,
    'measured_legacy_v1_nodes_not_relationship_inputs',
    false,
    'legacy_relationship_forecast_report_legacy_bytes_invalid',
  );
  decodeByteSection(
    report.extractedRelationshipInputEstimate,
    'deterministic_v1_to_v2_projection_without_current_feature_archives',
    true,
    'legacy_relationship_forecast_report_relationship_bytes_invalid',
  );

  const pressure = requireExactKeys(report.postingPressure, [
    'postingShardCountAssumption', 'samplePostingCount', 'projectedPostingCount',
    'sampleRecordReplicaCountAtAssumedShards', 'projectedRecordReplicaCountAtAssumedShards',
    'projectedPostingPlanningInterval', 'routes',
  ], 'legacy_relationship_forecast_report_posting_invalid');
  requireSafeFields(pressure, [
    'postingShardCountAssumption', 'samplePostingCount', 'projectedPostingCount',
    'sampleRecordReplicaCountAtAssumedShards', 'projectedRecordReplicaCountAtAssumedShards',
  ], 'legacy_relationship_forecast_report_posting_invalid');
  if (pressure.postingShardCountAssumption !== FORECAST_POSTING_SHARD_COUNT || !Array.isArray(pressure.routes)
    || pressure.routes.length !== POSTING_KINDS.length) {
    invalid('legacy_relationship_forecast_report_posting_invalid');
  }
  const postingInterval = requireExactKeys(pressure.projectedPostingPlanningInterval, [
    'basis', 'lower', 'point', 'upper',
  ], 'legacy_relationship_forecast_report_posting_invalid');
  requireSafeFields(postingInterval, ['lower', 'point', 'upper'], 'legacy_relationship_forecast_report_posting_invalid');
  if (postingInterval.basis !== 'deterministic_lower_bound_with_safety_factor_not_statistical_confidence'
    || postingInterval.lower !== pressure.projectedPostingCount
    || postingInterval.point !== pressure.projectedPostingCount
    || Number(postingInterval.upper) < Number(postingInterval.point)) {
    invalid('legacy_relationship_forecast_report_posting_invalid');
  }
  for (let index = 0; index < POSTING_KINDS.length; index += 1) {
    const routeKind = POSTING_KINDS[index];
    const route = requireExactKeys(pressure.routes[index], [
      'routeKind', 'postingCap', 'pairCap', 'projectionMethod', 'sample', 'projected',
    ], 'legacy_relationship_forecast_report_route_invalid');
    if (
      route.routeKind !== routeKind
      || route.postingCap !== postingCap(routeKind, expectedCaps)
      || route.pairCap !== expectedCaps.maxPairsPerGroup
      || route.projectionMethod !== (isStableOccupancyRoute(routeKind)
        ? 'stable_group_occupancy' : 'observed_pair_linear')
    ) invalid('legacy_relationship_forecast_report_cap_mismatch');
    const sample = requireExactKeys(route.sample, [
      'postingCount', 'groupCount', 'potentialPairRoutes', 'retainedPotentialPairRoutes',
      'skippedPotentialPairRoutes', 'capBreachGroupCount', 'largestGroupPostingCount',
      'largestGroupDistinctAddressCount', 'largestGroupPotentialPairRoutes',
    ], 'legacy_relationship_forecast_report_route_invalid');
    const projected = requireExactKeys(route.projected, [
      'postingCount', 'potentialPairRoutes', 'retainedPotentialPairRoutes',
      'skippedPotentialPairRoutes', 'capBreachGroupCount',
    ], 'legacy_relationship_forecast_report_route_invalid');
    requireSafeFields(sample, Object.keys(sample), 'legacy_relationship_forecast_report_route_invalid');
    requireSafeFields(projected, Object.keys(projected), 'legacy_relationship_forecast_report_route_invalid');
  }

  const disk = requireExactKeys(report.diskHardCapRecommendation, [
    'freeDiskBytes', 'minimumFreeDiskReserveBytes', 'maximumScratchBytes',
    'maximumRelationshipInputBytes', 'maximumPostingArtifactsBytes', 'maximumCandidateArtifactsBytes',
    'abortIfFreeDiskBelowBytes', 'assumedCandidateBytesPerPair', 'recommendedMaxPairsPerGroup',
    'recommendedMaxCandidatePairsPerPostingShard', 'estimatedBoundedWorkingSetBytes',
    'diskPreflightStatus', 'activationAllowed',
  ], 'legacy_relationship_forecast_report_disk_invalid');
  requireSafeFields(disk, Object.keys(disk).filter((key) => !['diskPreflightStatus', 'activationAllowed'].includes(key)),
    'legacy_relationship_forecast_report_disk_invalid');
  if (disk.activationAllowed !== false
    || !['within_hard_cap_for_bounded_dry_run', 'insufficient_headroom'].includes(String(disk.diskPreflightStatus))
    || disk.assumedCandidateBytesPerPair !== FORECAST_CANDIDATE_BYTES_PER_PAIR
    || Number(disk.recommendedMaxPairsPerGroup) > expectedCaps.maxPairsPerGroup
    || Number(disk.recommendedMaxCandidatePairsPerPostingShard) > expectedCaps.maxCandidatePairsPerPostingShard) {
    invalid('legacy_relationship_forecast_report_disk_invalid');
  }

  const { forecastDigest, ...withoutDigest } = report;
  if (forecastDigest !== relationshipInputSha256(withoutDigest)) {
    invalid('legacy_relationship_forecast_report_digest_mismatch');
  }
  return report as unknown as LegacyRelationshipSampleForecast;
};

const measureLegacyNodeSubset = (nodes: readonly LegacyV1Node[]): LegacySampleArchiveMetric => {
  if (!nodes.length) invalid('legacy_relationship_forecast_sample_count_invalid');
  const body = Buffer.from(nodes.map((node) => `${JSON.stringify(node)}\n`).join(''), 'utf8');
  const archiveBody = gzipSync(body, { level: 6 });
  return {
    rowCount: nodes.length,
    uncompressedBytes: body.length,
    compressedBytes: archiveBody.length,
    compressedSha256: sha256(archiveBody),
  };
};

export const forecastLegacyV7RelationshipSampleDirectory = (params: {
  sampleDirectory: string;
  freeDiskBytes: number;
  selection:
    | { mode: 'bounded_per_kind'; maxRowsPerKind: number }
    | { mode: 'complete_local_sample' };
}): LegacyRelationshipSampleForecast => {
  const loaded = loadLegacyV7RelationshipForecastSample(params.sampleDirectory);
  let nodesByKind = loaded.nodesByKind;
  let archiveMetrics = loaded.archiveMetrics;
  let sampleSetSha256 = loaded.sampleSetSha256;
  let expectedSampleCounts: LegacyForecastKindCounts | undefined = LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS;
  let sampleScope: 'bounded_subset' | 'complete_local_sample' = 'complete_local_sample';
  if (params.selection.mode === 'bounded_per_kind') {
    const maxRows = requireSafeCount(
      params.selection.maxRowsPerKind,
      'legacy_relationship_forecast_selection_invalid',
      1,
    );
    if (maxRows > 10_000) invalid('legacy_relationship_forecast_selection_unsafe');
    nodesByKind = Object.fromEntries(KINDS.map((kind) => [
      kind,
      loaded.nodesByKind[kind].slice(0, Math.min(maxRows, loaded.nodesByKind[kind].length)),
    ])) as Record<EvidenceUniverseNodeKind, LegacyV1Node[]>;
    archiveMetrics = Object.fromEntries(KINDS.map((kind) => [
      kind,
      measureLegacyNodeSubset(nodesByKind[kind]),
    ])) as Record<EvidenceUniverseNodeKind, LegacySampleArchiveMetric>;
    sampleSetSha256 = relationshipInputSha256({
      verifiedSampleSetSha256: loaded.sampleSetSha256,
      selection: params.selection,
      selectedAddresses: KINDS.flatMap((kind) => nodesByKind[kind].map((node) => node.address)),
    });
    expectedSampleCounts = undefined;
    sampleScope = 'bounded_subset';
  }
  return buildLegacyRelationshipSampleForecast({
    ...loaded,
    nodesByKind,
    archiveMetrics,
    sampleSetSha256,
    freeDiskBytes: params.freeDiskBytes,
    expectedSampleCounts,
    verifiedAvailableCounts: LEGACY_RELATIONSHIP_FORECAST_SAMPLE_COUNTS,
    sampleScope,
  });
};
