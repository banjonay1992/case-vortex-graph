import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  evidenceUniverseAddress,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const PUBLIC_TYPED_DENSITY_VERSION = 'case-vortex-public-typed-density-v2' as const;
export const PUBLIC_TYPED_DENSITY_ARCHIVE_VERSION = 'case-vortex-public-typed-density-archive-v2' as const;

export type PublicTypedDensityLevel = 'macro' | 'regional';
export type PublicTypedDensityRelationshipStatus = 'linked' | 'candidate_only' | 'isolated';

export type FullCorpusPublicDensityNodeInput = {
  address: string;
  kind: EvidenceUniverseNodeKind;
  source: string;
  eventTimestamp: string | null;
  lat: number | null;
  lon: number | null;
  degree: number;
  relationshipStatus: PublicTypedDensityRelationshipStatus;
};

type KindCounts = Record<EvidenceUniverseNodeKind, number>;
type StatusCounts = Record<PublicTypedDensityRelationshipStatus, number>;

export type FullCorpusPublicDensityCell = {
  id: string;
  level: PublicTypedDensityLevel;
  timeBin: string;
  latBin: number | null;
  lonBin: number | null;
  count: number;
  byKind: KindCounts;
  byRelationshipStatus: StatusCounts;
  degreeSum: number;
  maximumDegree: number;
  centroid: { lat: number; lon: number } | null;
  meanTimestamp: string | null;
  topSources: Array<{ source: string; count: number }>;
};

export type FullCorpusPublicDensityArtifact = {
  recordType: 'case_vortex_public_typed_density';
  schemaVersion: typeof PUBLIC_TYPED_DENSITY_VERSION;
  corpusVersion: string;
  snapshotId: string;
  publicGraphManifestDigest: string;
  nodeCount: number;
  byKind: KindCounts;
  byRelationshipStatus: StatusCounts;
  levels: {
    macro: FullCorpusPublicDensityCell[];
    regional: FullCorpusPublicDensityCell[];
  };
  accounting: {
    macroNodeCount: number;
    regionalNodeCount: number;
    unknownGeoNodeCount: number;
    unknownTimeNodeCount: number;
  };
  artifactDigest: string;
};

export type FullCorpusPublicDensityPointer = {
  schemaVersion: typeof PUBLIC_TYPED_DENSITY_ARCHIVE_VERSION;
  artifactSchemaVersion: typeof PUBLIC_TYPED_DENSITY_VERSION;
  corpusVersion: string;
  snapshotId: string;
  publicGraphManifestDigest: string;
  artifactDigest: string;
  archiveKey: string;
  compressedBytes: number;
  uncompressedBytes: number;
  compressedSha256: string;
  nodeCount: number;
  byKind: KindCounts;
  macroCellCount: number;
  regionalCellCount: number;
};

export type FullCorpusPublicDensityArchiveObject = {
  artifact: FullCorpusPublicDensityArtifact;
  pointer: FullCorpusPublicDensityPointer;
  body: Buffer;
};

type CellAccumulator = {
  id: string;
  level: PublicTypedDensityLevel;
  timeBin: string;
  latBin: number | null;
  lonBin: number | null;
  count: number;
  byKind: KindCounts;
  byRelationshipStatus: StatusCounts;
  degreeSum: number;
  maximumDegree: number;
  latitudeSum: number;
  longitudeSum: number;
  coordinateCount: number;
  timestampSum: number;
  timestampCount: number;
  sources: Record<string, number>;
};

const NODE_KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const STATUSES: PublicTypedDensityRelationshipStatus[] = ['linked', 'candidate_only', 'isolated'];
const SHA256 = /^[a-f0-9]{64}$/;
const CORPUS = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

function invalid(code: string): never {
  throw new Error(code);
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value: unknown, keys: readonly string[], code: string) => {
  if (!isRecord(value)) invalid(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return value;
};

const safeCount = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(code);
  return Number(value);
};

const finite = (value: unknown, minimum: number, maximum: number, code: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid(code);
  return value;
};

const emptyKindCounts = (): KindCounts => ({ sighting: 0, document: 0, photo: 0, video: 0 });
const emptyStatusCounts = (): StatusCounts => ({ linked: 0, candidate_only: 0, isolated: 0 });
const sum = (values: readonly number[], code: string) => values.reduce((total, value) => {
  const next = total + value;
  if (!Number.isSafeInteger(next)) invalid(code);
  return next;
}, 0);

const exactNamedCounts = <T extends string>(value: unknown, keys: readonly T[], code: string) => {
  const record = exactKeys(value, keys, code);
  return Object.fromEntries(keys.map((key) => [key, safeCount(record[key], code)])) as Record<T, number>;
};

const relationshipStatusFor = (node: FullCorpusPublicDensityNodeInput) => {
  if (!STATUSES.includes(node.relationshipStatus)) invalid('public_typed_density_status_invalid');
  if ((node.relationshipStatus === 'linked') !== (node.degree > 0)) {
    invalid('public_typed_density_degree_status_mismatch');
  }
  return node.relationshipStatus;
};

const canonicalNode = (node: FullCorpusPublicDensityNodeInput) => {
  if (!NODE_KINDS.includes(node.kind)
    || node.address !== evidenceUniverseAddress(node.kind, node.address.slice(node.address.indexOf(':') + 1))
    || typeof node.source !== 'string'
    || !node.source.length
    || node.source.trim() !== node.source
    || node.source.length > 240) invalid('public_typed_density_node_invalid');
  const degree = safeCount(node.degree, 'public_typed_density_node_invalid');
  const eventTimestamp = node.eventTimestamp == null ? null : new Date(node.eventTimestamp).toISOString();
  if (eventTimestamp !== node.eventTimestamp) invalid('public_typed_density_node_invalid');
  if ((node.lat == null) !== (node.lon == null)) invalid('public_typed_density_node_invalid');
  const lat = node.lat == null ? null : finite(node.lat, -90, 90, 'public_typed_density_node_invalid');
  const lon = node.lon == null ? null : finite(node.lon, -180, 180, 'public_typed_density_node_invalid');
  return { ...node, degree, eventTimestamp, lat, lon, relationshipStatus: relationshipStatusFor({ ...node, degree }) };
};

const descriptor = (
  node: ReturnType<typeof canonicalNode>,
  level: PublicTypedDensityLevel,
) => {
  const timeSize = level === 'macro' ? 25 : 5;
  const geoSize = level === 'macro' ? 30 : 10;
  const timestamp = node.eventTimestamp == null ? null : Date.parse(node.eventTimestamp);
  const year = timestamp == null ? null : new Date(timestamp).getUTCFullYear();
  const timeBin = year == null ? 'unknown' : String(Math.floor(year / timeSize) * timeSize);
  const latBin = node.lat == null ? null : Math.min(180 / geoSize - 1, Math.floor((node.lat + 90) / geoSize));
  const lonBin = node.lon == null ? null : Math.min(360 / geoSize - 1, Math.floor((node.lon + 180) / geoSize));
  return {
    id: `${level}:t${timeBin}:g${latBin ?? 'x'}:${lonBin ?? 'x'}`,
    level,
    timeBin,
    latBin,
    lonBin,
    timestamp,
  };
};

const accumulate = (
  cells: Map<string, CellAccumulator>,
  node: ReturnType<typeof canonicalNode>,
  level: PublicTypedDensityLevel,
) => {
  const location = descriptor(node, level);
  const cell = cells.get(location.id) || {
    id: location.id,
    level,
    timeBin: location.timeBin,
    latBin: location.latBin,
    lonBin: location.lonBin,
    count: 0,
    byKind: emptyKindCounts(),
    byRelationshipStatus: emptyStatusCounts(),
    degreeSum: 0,
    maximumDegree: 0,
    latitudeSum: 0,
    longitudeSum: 0,
    coordinateCount: 0,
    timestampSum: 0,
    timestampCount: 0,
    sources: {},
  };
  cell.count += 1;
  cell.byKind[node.kind] += 1;
  cell.byRelationshipStatus[node.relationshipStatus] += 1;
  cell.degreeSum += node.degree;
  if (!Number.isSafeInteger(cell.degreeSum)) invalid('public_typed_density_degree_overflow');
  cell.maximumDegree = Math.max(cell.maximumDegree, node.degree);
  if (node.lat != null && node.lon != null) {
    cell.latitudeSum += node.lat;
    cell.longitudeSum += node.lon;
    cell.coordinateCount += 1;
  }
  if (location.timestamp != null) {
    cell.timestampSum += location.timestamp;
    cell.timestampCount += 1;
  }
  cell.sources[node.source] = (cell.sources[node.source] || 0) + 1;
  cells.set(location.id, cell);
};

const finalizeCell = (cell: CellAccumulator): FullCorpusPublicDensityCell => ({
  id: cell.id,
  level: cell.level,
  timeBin: cell.timeBin,
  latBin: cell.latBin,
  lonBin: cell.lonBin,
  count: cell.count,
  byKind: cell.byKind,
  byRelationshipStatus: cell.byRelationshipStatus,
  degreeSum: cell.degreeSum,
  maximumDegree: cell.maximumDegree,
  centroid: cell.coordinateCount ? {
    lat: Number((cell.latitudeSum / cell.coordinateCount).toFixed(5)),
    lon: Number((cell.longitudeSum / cell.coordinateCount).toFixed(5)),
  } : null,
  meanTimestamp: cell.timestampCount ? new Date(cell.timestampSum / cell.timestampCount).toISOString() : null,
  topSources: Object.entries(cell.sources)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .slice(0, 5)
    .map(([source, count]) => ({ source, count })),
});

const withoutDigest = (artifact: Omit<FullCorpusPublicDensityArtifact, 'artifactDigest'>) => artifact;

export const buildFullCorpusPublicDensityArtifact = (params: {
  corpusVersion: string;
  snapshotId: string;
  publicGraphManifestDigest: string;
  nodes: readonly FullCorpusPublicDensityNodeInput[];
}): FullCorpusPublicDensityArtifact => {
  if (!CORPUS.test(params.corpusVersion)
    || !UUID.test(params.snapshotId)
    || !SHA256.test(params.publicGraphManifestDigest)) invalid('public_typed_density_lineage_invalid');
  const nodes = params.nodes.map(canonicalNode).sort((left, right) => left.address.localeCompare(right.address));
  if (new Set(nodes.map((node) => node.address)).size !== nodes.length) invalid('public_typed_density_duplicate_node');
  const byKind = emptyKindCounts();
  const byRelationshipStatus = emptyStatusCounts();
  const macro = new Map<string, CellAccumulator>();
  const regional = new Map<string, CellAccumulator>();
  let unknownGeoNodeCount = 0;
  let unknownTimeNodeCount = 0;
  for (const node of nodes) {
    byKind[node.kind] += 1;
    byRelationshipStatus[node.relationshipStatus] += 1;
    if (node.lat == null) unknownGeoNodeCount += 1;
    if (node.eventTimestamp == null) unknownTimeNodeCount += 1;
    accumulate(macro, node, 'macro');
    accumulate(regional, node, 'regional');
  }
  const levels = {
    macro: [...macro.values()].sort((left, right) => left.id.localeCompare(right.id)).map(finalizeCell),
    regional: [...regional.values()].sort((left, right) => left.id.localeCompare(right.id)).map(finalizeCell),
  };
  const nodeCount = nodes.length;
  const body: Omit<FullCorpusPublicDensityArtifact, 'artifactDigest'> = {
    recordType: 'case_vortex_public_typed_density',
    schemaVersion: PUBLIC_TYPED_DENSITY_VERSION,
    corpusVersion: params.corpusVersion,
    snapshotId: params.snapshotId,
    publicGraphManifestDigest: params.publicGraphManifestDigest,
    nodeCount,
    byKind,
    byRelationshipStatus,
    levels,
    accounting: {
      macroNodeCount: sum(levels.macro.map((cell) => cell.count), 'public_typed_density_count_overflow'),
      regionalNodeCount: sum(levels.regional.map((cell) => cell.count), 'public_typed_density_count_overflow'),
      unknownGeoNodeCount,
      unknownTimeNodeCount,
    },
  };
  return decodeFullCorpusPublicDensityArtifact({
    ...body,
    artifactDigest: relationshipInputSha256(withoutDigest(body)),
  });
};

const decodeCell = (value: unknown, level: PublicTypedDensityLevel): FullCorpusPublicDensityCell => {
  const cell = exactKeys(value, [
    'id', 'level', 'timeBin', 'latBin', 'lonBin', 'count', 'byKind', 'byRelationshipStatus',
    'degreeSum', 'maximumDegree', 'centroid', 'meanTimestamp', 'topSources',
  ], 'public_typed_density_cell_invalid');
  if (cell.level !== level || typeof cell.id !== 'string' || !cell.id.startsWith(`${level}:t`)
    || typeof cell.timeBin !== 'string'
    || (cell.latBin !== null && !Number.isSafeInteger(cell.latBin))
    || (cell.lonBin !== null && !Number.isSafeInteger(cell.lonBin))) invalid('public_typed_density_cell_invalid');
  const count = safeCount(cell.count, 'public_typed_density_cell_invalid');
  const byKind = exactNamedCounts(cell.byKind, NODE_KINDS, 'public_typed_density_cell_invalid');
  const byRelationshipStatus = exactNamedCounts(cell.byRelationshipStatus, STATUSES, 'public_typed_density_cell_invalid');
  const degreeSum = safeCount(cell.degreeSum, 'public_typed_density_cell_invalid');
  const maximumDegree = safeCount(cell.maximumDegree, 'public_typed_density_cell_invalid');
  if (sum(Object.values(byKind), 'public_typed_density_count_overflow') !== count
    || sum(Object.values(byRelationshipStatus), 'public_typed_density_count_overflow') !== count
    || maximumDegree > degreeSum) invalid('public_typed_density_cell_accounting_invalid');
  let centroid: FullCorpusPublicDensityCell['centroid'] = null;
  if (cell.centroid !== null) {
    const point = exactKeys(cell.centroid, ['lat', 'lon'], 'public_typed_density_cell_invalid');
    centroid = {
      lat: finite(point.lat, -90, 90, 'public_typed_density_cell_invalid'),
      lon: finite(point.lon, -180, 180, 'public_typed_density_cell_invalid'),
    };
  }
  if (cell.meanTimestamp !== null
    && (typeof cell.meanTimestamp !== 'string' || new Date(cell.meanTimestamp).toISOString() !== cell.meanTimestamp)) {
    invalid('public_typed_density_cell_invalid');
  }
  if (!Array.isArray(cell.topSources) || cell.topSources.length > 5) invalid('public_typed_density_cell_invalid');
  const topSources = cell.topSources.map((raw) => {
    const source = exactKeys(raw, ['source', 'count'], 'public_typed_density_cell_invalid');
    if (typeof source.source !== 'string' || !source.source.length || source.source.trim() !== source.source) {
      invalid('public_typed_density_cell_invalid');
    }
    return { source: source.source, count: safeCount(source.count, 'public_typed_density_cell_invalid') };
  });
  const expectedId = `${level}:t${cell.timeBin}:g${cell.latBin ?? 'x'}:${cell.lonBin ?? 'x'}`;
  const timeSize = level === 'macro' ? 25 : 5;
  const geoSize = level === 'macro' ? 30 : 10;
  const year = cell.timeBin === 'unknown' ? null : Number(cell.timeBin);
  if (cell.id !== expectedId
    || (cell.latBin === null) !== (cell.lonBin === null)
    || (year !== null && (!Number.isSafeInteger(year) || year < 1000 || year > 3000 || year % timeSize !== 0))
    || (cell.latBin !== null && (Number(cell.latBin) < 0 || Number(cell.latBin) >= 180 / geoSize))
    || (cell.lonBin !== null && (Number(cell.lonBin) < 0 || Number(cell.lonBin) >= 360 / geoSize))) {
    invalid('public_typed_density_cell_invalid');
  }
  return { ...cell, count, byKind, byRelationshipStatus, degreeSum, maximumDegree, centroid, topSources } as FullCorpusPublicDensityCell;
};

export const decodeFullCorpusPublicDensityArtifact = (
  input: Buffer | string | unknown,
  expected?: { corpusVersion?: string; snapshotId?: string; publicGraphManifestDigest?: string },
): FullCorpusPublicDensityArtifact => {
  let raw = input;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try { raw = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input); } catch {
      return invalid('public_typed_density_json_invalid');
    }
  }
  const value = exactKeys(raw, [
    'recordType', 'schemaVersion', 'corpusVersion', 'snapshotId', 'publicGraphManifestDigest', 'nodeCount',
    'byKind', 'byRelationshipStatus', 'levels', 'accounting', 'artifactDigest',
  ], 'public_typed_density_invalid');
  if (value.recordType !== 'case_vortex_public_typed_density'
    || value.schemaVersion !== PUBLIC_TYPED_DENSITY_VERSION
    || typeof value.corpusVersion !== 'string' || !CORPUS.test(value.corpusVersion)
    || typeof value.snapshotId !== 'string' || !UUID.test(value.snapshotId)
    || typeof value.publicGraphManifestDigest !== 'string' || !SHA256.test(value.publicGraphManifestDigest)
    || typeof value.artifactDigest !== 'string' || !SHA256.test(value.artifactDigest)
    || (expected?.corpusVersion && expected.corpusVersion !== value.corpusVersion)
    || (expected?.snapshotId && expected.snapshotId !== value.snapshotId)
    || (expected?.publicGraphManifestDigest && expected.publicGraphManifestDigest !== value.publicGraphManifestDigest)) {
    invalid('public_typed_density_lineage_invalid');
  }
  const nodeCount = safeCount(value.nodeCount, 'public_typed_density_accounting_invalid');
  const byKind = exactNamedCounts(value.byKind, NODE_KINDS, 'public_typed_density_accounting_invalid');
  const byRelationshipStatus = exactNamedCounts(value.byRelationshipStatus, STATUSES,
    'public_typed_density_accounting_invalid');
  const levels = exactKeys(value.levels, ['macro', 'regional'], 'public_typed_density_invalid');
  if (!Array.isArray(levels.macro) || !Array.isArray(levels.regional)) invalid('public_typed_density_invalid');
  const macro = levels.macro.map((cell) => decodeCell(cell, 'macro'));
  const regional = levels.regional.map((cell) => decodeCell(cell, 'regional'));
  if (macro.some((cell, index) => index > 0 && macro[index - 1].id >= cell.id)
    || regional.some((cell, index) => index > 0 && regional[index - 1].id >= cell.id)) {
    invalid('public_typed_density_cell_order_invalid');
  }
  const accounting = exactKeys(value.accounting, [
    'macroNodeCount', 'regionalNodeCount', 'unknownGeoNodeCount', 'unknownTimeNodeCount',
  ], 'public_typed_density_accounting_invalid');
  const decodedAccounting = {
    macroNodeCount: safeCount(accounting.macroNodeCount, 'public_typed_density_accounting_invalid'),
    regionalNodeCount: safeCount(accounting.regionalNodeCount, 'public_typed_density_accounting_invalid'),
    unknownGeoNodeCount: safeCount(accounting.unknownGeoNodeCount, 'public_typed_density_accounting_invalid'),
    unknownTimeNodeCount: safeCount(accounting.unknownTimeNodeCount, 'public_typed_density_accounting_invalid'),
  };
  const kindTotals = (cells: readonly FullCorpusPublicDensityCell[]) => Object.fromEntries(NODE_KINDS.map((kind) => [
    kind,
    sum(cells.map((cell) => cell.byKind[kind]), 'public_typed_density_count_overflow'),
  ])) as KindCounts;
  const statusTotals = (cells: readonly FullCorpusPublicDensityCell[]) => Object.fromEntries(STATUSES.map((status) => [
    status,
    sum(cells.map((cell) => cell.byRelationshipStatus[status]), 'public_typed_density_count_overflow'),
  ])) as StatusCounts;
  if (sum(Object.values(byKind), 'public_typed_density_count_overflow') !== nodeCount
    || sum(Object.values(byRelationshipStatus), 'public_typed_density_count_overflow') !== nodeCount
    || decodedAccounting.macroNodeCount !== nodeCount
    || decodedAccounting.regionalNodeCount !== nodeCount
    || decodedAccounting.unknownGeoNodeCount > nodeCount
    || decodedAccounting.unknownTimeNodeCount > nodeCount
    || sum(macro.map((cell) => cell.count), 'public_typed_density_count_overflow') !== nodeCount
    || sum(regional.map((cell) => cell.count), 'public_typed_density_count_overflow') !== nodeCount
    || canonicalizeRelationshipInput(kindTotals(macro)) !== canonicalizeRelationshipInput(byKind)
    || canonicalizeRelationshipInput(kindTotals(regional)) !== canonicalizeRelationshipInput(byKind)
    || canonicalizeRelationshipInput(statusTotals(macro)) !== canonicalizeRelationshipInput(byRelationshipStatus)
    || canonicalizeRelationshipInput(statusTotals(regional)) !== canonicalizeRelationshipInput(byRelationshipStatus)
    || sum(macro.filter((cell) => cell.latBin === null).map((cell) => cell.count),
      'public_typed_density_count_overflow') !== decodedAccounting.unknownGeoNodeCount
    || sum(macro.filter((cell) => cell.timeBin === 'unknown').map((cell) => cell.count),
      'public_typed_density_count_overflow') !== decodedAccounting.unknownTimeNodeCount) {
    invalid('public_typed_density_accounting_invalid');
  }
  const decoded: FullCorpusPublicDensityArtifact = {
    ...(value as unknown as FullCorpusPublicDensityArtifact),
    nodeCount,
    byKind,
    byRelationshipStatus,
    levels: { macro, regional },
    accounting: decodedAccounting,
  };
  const { artifactDigest, ...body } = decoded;
  if (artifactDigest !== relationshipInputSha256(withoutDigest(body))) {
    invalid('public_typed_density_digest_mismatch');
  }
  if ((Buffer.isBuffer(input) || typeof input === 'string')) {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    if (!bytes.equals(encodeFullCorpusPublicDensityArtifact(decoded))) invalid('public_typed_density_non_canonical');
  }
  return decoded;
};

export const encodeFullCorpusPublicDensityArtifact = (artifact: FullCorpusPublicDensityArtifact) => (
  Buffer.from(`${canonicalizeRelationshipInput(artifact)}\n`, 'utf8')
);

export const buildFullCorpusPublicDensityArchiveObject = (
  artifactInput: FullCorpusPublicDensityArtifact,
): FullCorpusPublicDensityArchiveObject => {
  const artifact = decodeFullCorpusPublicDensityArtifact(artifactInput);
  const canonicalBody = encodeFullCorpusPublicDensityArtifact(artifact);
  const body = gzipSync(canonicalBody, { level: 6 });
  if (body.length > MAX_COMPRESSED_BYTES || canonicalBody.length > MAX_UNCOMPRESSED_BYTES) {
    invalid('public_typed_density_archive_size_invalid');
  }
  const archiveKey = [
    'case-vortex', 'corpora', artifact.corpusVersion, 'public-typed-density-v2', artifact.snapshotId,
    artifact.publicGraphManifestDigest, `${artifact.artifactDigest}.json.gz`,
  ].join('/');
  const pointer: FullCorpusPublicDensityPointer = {
    schemaVersion: PUBLIC_TYPED_DENSITY_ARCHIVE_VERSION,
    artifactSchemaVersion: PUBLIC_TYPED_DENSITY_VERSION,
    corpusVersion: artifact.corpusVersion,
    snapshotId: artifact.snapshotId,
    publicGraphManifestDigest: artifact.publicGraphManifestDigest,
    artifactDigest: artifact.artifactDigest,
    archiveKey,
    compressedBytes: body.length,
    uncompressedBytes: canonicalBody.length,
    compressedSha256: createHash('sha256').update(body).digest('hex'),
    nodeCount: artifact.nodeCount,
    byKind: artifact.byKind,
    macroCellCount: artifact.levels.macro.length,
    regionalCellCount: artifact.levels.regional.length,
  };
  return { artifact, pointer, body };
};

export const decodeFullCorpusPublicDensityPointer = (
  input: unknown,
  expected?: { corpusVersion?: string; snapshotId?: string; publicGraphManifestDigest?: string },
): FullCorpusPublicDensityPointer => {
  const value = exactKeys(input, [
    'schemaVersion', 'artifactSchemaVersion', 'corpusVersion', 'snapshotId', 'publicGraphManifestDigest',
    'artifactDigest', 'archiveKey', 'compressedBytes', 'uncompressedBytes', 'compressedSha256', 'nodeCount',
    'byKind', 'macroCellCount', 'regionalCellCount',
  ], 'public_typed_density_pointer_invalid');
  if (value.schemaVersion !== PUBLIC_TYPED_DENSITY_ARCHIVE_VERSION
    || value.artifactSchemaVersion !== PUBLIC_TYPED_DENSITY_VERSION
    || typeof value.corpusVersion !== 'string' || !CORPUS.test(value.corpusVersion)
    || typeof value.snapshotId !== 'string' || !UUID.test(value.snapshotId)
    || typeof value.publicGraphManifestDigest !== 'string' || !SHA256.test(value.publicGraphManifestDigest)
    || typeof value.artifactDigest !== 'string' || !SHA256.test(value.artifactDigest)
    || typeof value.compressedSha256 !== 'string' || !SHA256.test(value.compressedSha256)
    || typeof value.archiveKey !== 'string'
    || value.archiveKey !== [
      'case-vortex', 'corpora', value.corpusVersion, 'public-typed-density-v2', value.snapshotId,
      value.publicGraphManifestDigest, `${value.artifactDigest}.json.gz`,
    ].join('/')
    || (expected?.corpusVersion && expected.corpusVersion !== value.corpusVersion)
    || (expected?.snapshotId && expected.snapshotId !== value.snapshotId)
    || (expected?.publicGraphManifestDigest && expected.publicGraphManifestDigest !== value.publicGraphManifestDigest)) {
    invalid('public_typed_density_pointer_invalid');
  }
  const compressedBytes = safeCount(value.compressedBytes, 'public_typed_density_pointer_invalid');
  const uncompressedBytes = safeCount(value.uncompressedBytes, 'public_typed_density_pointer_invalid');
  const nodeCount = safeCount(value.nodeCount, 'public_typed_density_pointer_invalid');
  const byKind = exactNamedCounts(value.byKind, NODE_KINDS, 'public_typed_density_pointer_invalid');
  const macroCellCount = safeCount(value.macroCellCount, 'public_typed_density_pointer_invalid');
  const regionalCellCount = safeCount(value.regionalCellCount, 'public_typed_density_pointer_invalid');
  if (compressedBytes < 1 || compressedBytes > MAX_COMPRESSED_BYTES
    || uncompressedBytes < 1 || uncompressedBytes > MAX_UNCOMPRESSED_BYTES
    || sum(Object.values(byKind), 'public_typed_density_count_overflow') !== nodeCount) {
    invalid('public_typed_density_pointer_invalid');
  }
  return { ...(value as unknown as FullCorpusPublicDensityPointer), compressedBytes, uncompressedBytes,
    nodeCount, byKind, macroCellCount, regionalCellCount };
};

export const decodeFullCorpusPublicDensityArchiveObject = (params: {
  pointer: FullCorpusPublicDensityPointer | unknown;
  body: Buffer;
}): FullCorpusPublicDensityArtifact => {
  const pointer = decodeFullCorpusPublicDensityPointer(params.pointer);
  if (params.body.length !== pointer.compressedBytes
    || createHash('sha256').update(params.body).digest('hex') !== pointer.compressedSha256) {
    invalid('public_typed_density_archive_checksum_mismatch');
  }
  let uncompressed: Buffer;
  try { uncompressed = gunzipSync(params.body, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }); } catch {
    return invalid('public_typed_density_archive_gzip_invalid');
  }
  if (uncompressed.length !== pointer.uncompressedBytes) invalid('public_typed_density_archive_size_mismatch');
  const artifact = decodeFullCorpusPublicDensityArtifact(uncompressed, pointer);
  if (artifact.artifactDigest !== pointer.artifactDigest
    || artifact.nodeCount !== pointer.nodeCount
    || canonicalizeRelationshipInput(artifact.byKind) !== canonicalizeRelationshipInput(pointer.byKind)
    || artifact.levels.macro.length !== pointer.macroCellCount
    || artifact.levels.regional.length !== pointer.regionalCellCount) {
    invalid('public_typed_density_archive_pointer_mismatch');
  }
  return artifact;
};
