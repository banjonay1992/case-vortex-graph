import type { CaseVortexCorpusAccountingReceipt } from './corpusAccounting';
import {
  decodeCaseGraphPublicManifest,
  type CaseGraphPublicManifest,
} from './publicationManifest';
import {
  readVerifiedCaseGraphPublicationCandidate,
  type CaseGraphPublicationCandidateCompletion,
} from './publicationArchive';
import { CASE_GRAPH_SOURCE_REGISTRY, CASE_GRAPH_SOURCE_REGISTRY_VERSION } from './sourceRegistry';
import { evidenceUniverseAddress, type EvidenceUniverseNodeKind } from './evidenceUniverse';
import { fullCorpusRelationshipShard } from './typedRelationshipPipeline';
import {
  buildFullCorpusPublicRenderPackingReceipt,
  decodeFullCorpusPublicGraphArchiveObject,
  type FullCorpusPublicEdge,
  type FullCorpusPublicEgo,
  type FullCorpusPublicEvaluationReceipt,
  type FullCorpusPublicGraphArchiveReceipt,
  type FullCorpusPublicGraphShard,
  type FullCorpusPublicGraphShardKind,
  type FullCorpusPublicGraphShardSummary,
  type FullCorpusPublicNode,
  type FullCorpusPublicRenderRow,
} from './typedRelationshipPublicGraph';
import {
  decodeFullCorpusPublicDensityArchiveObject,
  type PublicTypedDensityLevel,
} from './typedPublicDensity';

// Backwards-compatible import location, now backed by the sole strict v2
// decoder rather than a second permissive public-path implementation.
export { decodeCaseGraphPublicManifest } from './publicationManifest';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_NODE_KINDS: readonly EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const TYPED_EDGE_ID_PATTERN = /^typed-edge:[a-f0-9]{64}$/;
const PUBLIC_EVALUATION_ID_PATTERN = /^public-evaluation:[a-f0-9]{64}$/;
const RELATIONSHIP_STATUSES = ['linked', 'candidate_only', 'isolated'] as const;
const MAX_PUBLIC_GRAPH_BATCH_ITEMS = 250;

export type CaseGraphPublicStorage = {
  readObject: (key: string, options?: { maxBytes?: number; signal?: AbortSignal }) => Promise<Buffer | null>;
};

export type CaseGraphPublicQuery = (
  text: string,
  params?: unknown[],
  options?: { queryTimeoutMs?: number; statementTimeoutMs?: number },
) => Promise<{ rows: unknown[] }>;

export type ActiveCaseGraphPublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
  manifest: CaseGraphPublicManifest;
  completion: CaseGraphPublicationCandidateCompletion;
  accountingReceiptSha256: string;
  accountingReceipt: CaseVortexCorpusAccountingReceipt;
};

export type CaseGraphDensityCellDescriptor = {
  id: string;
  level: PublicTypedDensityLevel;
  timeBin: string;
  timeStart: string | null;
  timeEnd: string | null;
  latBin: number | null;
  lonBin: number | null;
  minLat: number | null;
  maxLat: number | null;
  minLon: number | null;
  maxLon: number | null;
};

const assertStorageKey = (key: unknown, corpusVersion: string) => {
  const value = String(key || '');
  const prefix = `case-vortex/corpora/${corpusVersion}/`;
  if (!value.startsWith(prefix) || value.includes('..') || value.includes('\\')) {
    throw new Error('case_graph_public_manifest_storage_key_invalid');
  }
  return value;
};
const assertSha = (value: unknown) => {
  const normalized = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('case_graph_public_manifest_sha_invalid');
  return normalized;
};
const sameNamedCounts = <T extends string>(
  left: Record<T, number>,
  right: Record<T, number>,
  keys: readonly T[],
) => keys.every((key) => left[key] === right[key]);
export const loadActiveCaseGraphPublication = async (params: {
  query: CaseGraphPublicQuery;
  storage: CaseGraphPublicStorage;
  signal?: AbortSignal;
}): Promise<ActiveCaseGraphPublication | null> => {
  const result = await params.query(`
    SELECT
      p.id AS publication_id,
      p.corpus_version,
      p.public_manifest_key,
      p.public_manifest_sha256,
      r.relationship_schema_version AS run_relationship_schema_version,
      r.relationship_policy_version AS run_relationship_policy_version,
      r.relationship_policy_sha256 AS run_relationship_policy_sha256,
      r.relationship_model_id AS run_relationship_model_id,
      r.relationship_model_version AS run_relationship_model_version,
      r.relationship_model_sha256 AS run_relationship_model_sha256,
      r.pair_calibration_id AS run_pair_calibration_id,
      r.pair_calibration_sha256 AS run_pair_calibration_sha256,
      r.contextual_calibration_id AS run_contextual_calibration_id,
      r.contextual_calibration_sha256 AS run_contextual_calibration_sha256,
      r.calibration_set_sha256 AS run_calibration_set_sha256,
      receipt.receipt_version,
      receipt.snapshot_id AS receipt_snapshot_id,
      receipt.universe_archive_set_sha256,
      receipt.feature_archive_set_sha256,
      receipt.relationship_input_archive_set_sha256,
      receipt.relationship_input_manifest_digest,
      receipt.relationship_schema_version AS receipt_relationship_schema_version,
      receipt.relationship_policy_version AS receipt_relationship_policy_version,
      receipt.relationship_policy_sha256 AS receipt_relationship_policy_sha256,
      receipt.relationship_model_id AS receipt_relationship_model_id,
      receipt.relationship_model_version AS receipt_relationship_model_version,
      receipt.relationship_model_sha256 AS receipt_relationship_model_sha256,
      receipt.pair_calibration_id AS receipt_pair_calibration_id,
      receipt.pair_calibration_sha256 AS receipt_pair_calibration_sha256,
      receipt.contextual_calibration_id AS receipt_contextual_calibration_id,
      receipt.contextual_calibration_sha256 AS receipt_contextual_calibration_sha256,
      receipt.calibration_set_sha256 AS receipt_calibration_set_sha256,
      receipt.graph_artifact_set_sha256,
      receipt.corpus_accounting_digest,
      receipt.public_manifest_sha256 AS receipt_public_manifest_sha256,
      receipt.universe_record_count,
      receipt.sighting_record_count,
      receipt.document_record_count,
      receipt.photo_record_count,
      receipt.video_record_count,
      receipt.relationship_input_record_count,
      receipt.graph_record_count,
      receipt.user_interface_record_count,
      receipt.represented_record_count,
      receipt.excluded_record_count,
      receipt.observed_record_count
    FROM public.uap_case_graph_publications p
    JOIN public.uap_case_graph_runs r ON r.id = p.run_id
    JOIN public.uap_case_graph_publication_receipts receipt ON receipt.publication_id = p.id
    WHERE p.active = true
      AND r.status = 'completed'
      AND r.corpus_version = p.corpus_version
    ORDER BY p.activated_at DESC, p.created_at DESC
    LIMIT 1
  `, [], { queryTimeoutMs: 4_000, statementTimeoutMs: 3_000 });
  if (!result.rows.length) return null;
  const row = result.rows[0] as Record<string, unknown>;
  const publicationId = String(row.publication_id || '');
  const corpusVersion = String(row.corpus_version || '');
  const manifestKey = assertStorageKey(row.public_manifest_key, corpusVersion);
  const manifestSha256 = assertSha(row.public_manifest_sha256);
  if (!UUID_PATTERN.test(publicationId)) throw new Error('case_graph_publication_id_invalid');
  const verified = await readVerifiedCaseGraphPublicationCandidate(params.storage, corpusVersion);
  if (verified.completion.manifest_key !== manifestKey || verified.completion.manifest_sha256 !== manifestSha256) {
    throw new Error('case_graph_active_publication_receipt_mismatch');
  }
  const manifest = verified.manifest;
  const accounting = verified.accountingReceipt;
  const count = (key: string) => {
    const raw = row[key];
    const value = typeof raw === 'string' && /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('case_graph_active_database_receipt_invalid');
    return Number(value);
  };
  if (row.receipt_version !== 'case-vortex-publication-receipt-v2'
    || row.receipt_public_manifest_sha256 !== manifestSha256
    || row.corpus_accounting_digest !== verified.completion.accounting_receipt_sha256
    || row.receipt_snapshot_id !== manifest.lineage.snapshot.snapshotId
    || row.universe_archive_set_sha256 !== manifest.lineage.universe.archiveSetSha256
    || row.feature_archive_set_sha256 !== manifest.lineage.features.archiveSetSha256
    || row.relationship_input_archive_set_sha256 !== manifest.lineage.relationshipInput.archiveSetSha256
    || row.relationship_input_manifest_digest !== manifest.lineage.relationshipInput.manifestDigest
    || row.run_relationship_schema_version !== manifest.models.relationshipSchemaVersion
    || row.receipt_relationship_schema_version !== manifest.models.relationshipSchemaVersion
    || row.run_relationship_policy_version !== manifest.lineage.relationship.policyVersion
    || row.run_relationship_policy_sha256 !== manifest.lineage.relationship.policySha256
    || row.receipt_relationship_policy_version !== manifest.lineage.relationship.policyVersion
    || row.receipt_relationship_policy_sha256 !== manifest.lineage.relationship.policySha256
    || row.run_relationship_model_id !== manifest.lineage.relationship.modelId
    || row.run_relationship_model_version !== manifest.lineage.relationship.modelVersion
    || row.run_relationship_model_sha256 !== manifest.lineage.relationship.modelSha256
    || row.receipt_relationship_model_id !== manifest.lineage.relationship.modelId
    || row.receipt_relationship_model_version !== manifest.lineage.relationship.modelVersion
    || row.receipt_relationship_model_sha256 !== manifest.lineage.relationship.modelSha256
    || row.run_pair_calibration_id !== manifest.lineage.calibration.pair.receiptId
    || row.run_pair_calibration_sha256 !== manifest.lineage.calibration.pair.receiptSha256
    || row.receipt_pair_calibration_id !== manifest.lineage.calibration.pair.receiptId
    || row.receipt_pair_calibration_sha256 !== manifest.lineage.calibration.pair.receiptSha256
    || row.run_contextual_calibration_id !== manifest.lineage.calibration.contextual.receiptId
    || row.run_contextual_calibration_sha256 !== manifest.lineage.calibration.contextual.receiptSha256
    || row.receipt_contextual_calibration_id !== manifest.lineage.calibration.contextual.receiptId
    || row.receipt_contextual_calibration_sha256 !== manifest.lineage.calibration.contextual.receiptSha256
    || row.run_calibration_set_sha256 !== manifest.lineage.calibration.set.calibrationSetSha256
    || row.receipt_calibration_set_sha256 !== manifest.lineage.calibration.set.calibrationSetSha256
    || row.graph_artifact_set_sha256 !== manifest.lineage.graph.artifactSetSha256
    || count('universe_record_count') !== manifest.lineage.universe.recordCount
    || count('sighting_record_count') !== accounting.capturedByKind.sighting
    || count('document_record_count') !== accounting.capturedByKind.document
    || count('photo_record_count') !== accounting.capturedByKind.photo
    || count('video_record_count') !== accounting.capturedByKind.video
    || count('relationship_input_record_count') !== manifest.lineage.relationshipInput.recordCount
    || count('graph_record_count') !== manifest.lineage.universe.recordCount
    || count('user_interface_record_count') !== manifest.lineage.universe.recordCount
    || count('represented_record_count') !== accounting.representedTotal
    || count('excluded_record_count') !== accounting.excludedTotal
    || count('observed_record_count') !== accounting.observedTotal) {
    throw new Error('case_graph_active_database_receipt_mismatch');
  }
  return {
    publicationId,
    corpusVersion,
    manifestSha256,
    manifest,
    completion: verified.completion,
    accountingReceiptSha256: verified.completion.accounting_receipt_sha256,
    accountingReceipt: verified.accountingReceipt,
  };
};

export const getCaseGraphDensityLevel = async (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  level: PublicTypedDensityLevel,
  signal?: AbortSignal,
) => {
  if (level !== 'macro' && level !== 'regional') throw new Error('case_graph_density_level_invalid');
  const pointer = active.manifest.density;
  const body = await storage.readObject(pointer.archiveKey, { maxBytes: pointer.compressedBytes, signal });
  if (!body) throw new Error('case_graph_public_density_missing');
  const artifact = decodeFullCorpusPublicDensityArchiveObject({ pointer, body });
  if (
    artifact.corpusVersion !== active.corpusVersion
    || artifact.snapshotId !== active.manifest.lineage.snapshot.snapshotId
    || artifact.publicGraphManifestDigest !== active.manifest.lineage.publicGraph.manifestDigest
    || artifact.nodeCount !== active.manifest.accounting.indexedRecordCount
    || artifact.artifactDigest !== pointer.artifactDigest
    || !sameNamedCounts(artifact.byKind, active.manifest.accounting.addressKindCounts, EVIDENCE_NODE_KINDS)
    || !sameNamedCounts(
      artifact.byRelationshipStatus,
      active.manifest.accounting.relationshipStatusCounts,
      RELATIONSHIP_STATUSES,
    )
    || artifact.accounting.macroNodeCount !== artifact.nodeCount
    || artifact.accounting.regionalNodeCount !== artifact.nodeCount
  ) throw new Error('case_graph_public_density_invalid');
  return { corpusVersion: active.corpusVersion, level, nodeCount: artifact.nodeCount, cells: artifact.levels[level], accounting: artifact.accounting };
};

export const parseCaseGraphDensityCellId = (value: string): CaseGraphDensityCellDescriptor => {
  const normalized = String(value || '').trim().toLowerCase();
  const match = normalized.match(/^(macro|regional):t(unknown|\d{4}):g(x|\d{1,2}):(x|\d{1,2})$/);
  if (!match) throw new Error('case_graph_density_cell_id_invalid');
  const level = match[1] as PublicTypedDensityLevel;
  const timeBin = match[2];
  const latRaw = match[3];
  const lonRaw = match[4];
  if ((latRaw === 'x') !== (lonRaw === 'x')) throw new Error('case_graph_density_cell_id_invalid');
  const timeSize = level === 'macro' ? 25 : 5;
  const geoSize = level === 'macro' ? 30 : 10;
  const year = timeBin === 'unknown' ? null : Number(timeBin);
  if (year != null && (year < 1000 || year > 3000 || year % timeSize !== 0)) {
    throw new Error('case_graph_density_cell_id_invalid');
  }
  const latBin = latRaw === 'x' ? null : Number(latRaw);
  const lonBin = lonRaw === 'x' ? null : Number(lonRaw);
  const maximumLatBin = 180 / geoSize - 1;
  const maximumLonBin = 360 / geoSize - 1;
  if ((latBin != null && (latBin < 0 || latBin > maximumLatBin))
    || (lonBin != null && (lonBin < 0 || lonBin > maximumLonBin))) {
    throw new Error('case_graph_density_cell_id_invalid');
  }
  const minLat = latBin == null ? null : latBin * geoSize - 90;
  const minLon = lonBin == null ? null : lonBin * geoSize - 180;
  return {
    id: normalized,
    level,
    timeBin,
    timeStart: year == null ? null : `${String(year).padStart(4, '0')}-01-01T00:00:00.000Z`,
    timeEnd: year == null ? null : `${String(year + timeSize).padStart(4, '0')}-01-01T00:00:00.000Z`,
    latBin,
    lonBin,
    minLat,
    maxLat: minLat == null ? null : Math.min(90, minLat + geoSize),
    minLon,
    maxLon: minLon == null ? null : Math.min(180, minLon + geoSize),
  };
};

export const getCaseGraphClusterCases = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  cellId: string;
  limit?: number;
  afterEvidenceAddress?: string | null;
  signal?: AbortSignal;
}) => {
  const cell = parseCaseGraphDensityCellId(params.cellId);
  const limit = Math.trunc(params.limit ?? 100);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new Error('case_graph_cluster_limit_invalid');
  const afterAddress = params.afterEvidenceAddress
    ? parseCaseGraphEvidenceAddress(params.afterEvidenceAddress).address
    : null;
  const shardCount = params.active.manifest.topology.nodeShardCount;
  const firstShard = afterAddress == null ? 0 : fullCorpusRelationshipShard(afterAddress, shardCount);
  const matchesCell = (node: FullCorpusPublicNode) => {
    if (cell.timeStart == null ? node.eventTimestamp !== null : (
      node.eventTimestamp == null || node.eventTimestamp < cell.timeStart || node.eventTimestamp >= cell.timeEnd!
    )) return false;
    if (cell.minLat == null) return node.lat === null && node.lon === null;
    if (node.lat == null || node.lon == null) return false;
    const latInRange = node.lat >= cell.minLat && (cell.maxLat === 90 ? node.lat <= 90 : node.lat < cell.maxLat!);
    const lonInRange = node.lon >= cell.minLon! && (cell.maxLon === 180 ? node.lon <= 180 : node.lon < cell.maxLon!);
    return latInRange && lonInRange;
  };
  const records: FullCorpusPublicNode[] = [];
  for (let shardNumber = firstShard; shardNumber < shardCount && records.length <= limit; shardNumber += 1) {
    const shard = await readCaseGraphPublicShard({
      active: params.active,
      storage: params.storage,
      kind: 'node',
      shard: shardNumber,
      signal: params.signal,
    });
    for (const node of shard.items) {
      if (shardNumber === firstShard && afterAddress !== null && node.address <= afterAddress) continue;
      if (matchesCell(node)) records.push(node);
      if (records.length > limit) break;
    }
  }
  const rows = records.slice(0, limit).map((node) => {
    const caseId = node.kind === 'sighting' && UUID_PATTERN.test(node.recordId) ? node.recordId : null;
    return {
      address: node.address,
      kind: node.kind,
      recordId: node.recordId,
      caseId,
      source: node.source,
      sourceRecordId: node.sourceRecordId,
      title: node.title,
      summary: node.summary,
      canonicalUrl: node.canonicalUrl,
      previewUrl: node.previewUrl,
      eventTimestamp: node.eventTimestamp,
      datePrecision: 'unknown',
      lat: node.lat,
      lon: node.lon,
      geoPrecision: 'unknown',
      shape: null,
      location: node.location,
      durationSeconds: null,
      relationshipStatus: node.relationshipStatus,
      degree: node.degree,
      detailPath: caseId ? `/reports/${caseId}` : `/case-vortex?address=${encodeURIComponent(node.address)}`,
    };
  });
  return {
    corpusVersion: params.active.corpusVersion,
    cell,
    cases: rows,
    nextCursor: records.length > limit ? rows.at(-1)?.address || null : null,
  };
};

export type CaseGraphEvidenceAddressLookup = {
  address: string;
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  /** The v1 node archive routed sighting UUIDs without their kind prefix. */
  legacySightingCaseId: string | null;
};

/**
 * Canonical public graph identifiers are evidence-universe addresses. A bare
 * UUID remains a read-only alias for its historical sighting address so old
 * report links do not break while the all-record graph replaces v1 shards.
 */
export const parseCaseGraphEvidenceAddress = (value: string): CaseGraphEvidenceAddressLookup => {
  const normalized = String(value || '').trim().toLowerCase();
  if (UUID_PATTERN.test(normalized)) return {
    address: evidenceUniverseAddress('sighting', normalized),
    kind: 'sighting',
    recordId: normalized,
    legacySightingCaseId: normalized,
  };
  const separator = normalized.indexOf(':');
  if (separator < 1 || normalized.indexOf(':', separator + 1) !== -1) {
    throw new Error('case_graph_case_id_invalid');
  }
  const kind = normalized.slice(0, separator) as EvidenceUniverseNodeKind;
  const recordId = normalized.slice(separator + 1);
  if (!EVIDENCE_NODE_KINDS.includes(kind)) throw new Error('case_graph_case_id_invalid');
  let address: string;
  try {
    address = evidenceUniverseAddress(kind, recordId);
  } catch {
    throw new Error('case_graph_case_id_invalid');
  }
  if (address !== normalized) throw new Error('case_graph_case_id_invalid');
  return {
    address,
    kind,
    recordId,
    legacySightingCaseId: kind === 'sighting' && UUID_PATTERN.test(recordId) ? recordId : null,
  };
};

type CaseGraphPublicShardItemMap = {
  render: FullCorpusPublicRenderRow;
  node: FullCorpusPublicNode;
  edge: FullCorpusPublicEdge;
  evaluation: FullCorpusPublicEvaluationReceipt;
  ego: FullCorpusPublicEgo;
};

type CaseGraphVerifiedPublicShard<K extends FullCorpusPublicGraphShardKind> = Omit<
  FullCorpusPublicGraphShard,
  'shardKind' | 'items'
> & {
  shardKind: K;
  items: CaseGraphPublicShardItemMap[K][];
};

const publicGraphShardCount = (
  manifest: CaseGraphPublicManifest,
  kind: FullCorpusPublicGraphShardKind,
) => {
  if (kind === 'render') return manifest.topology.renderShardCount;
  if (kind === 'node') return manifest.topology.nodeShardCount;
  if (kind === 'edge') return manifest.topology.edgeShardCount;
  if (kind === 'evaluation') return manifest.topology.evaluationShardCount;
  return manifest.topology.egoShardCount;
};

const publicGraphShardSummary = (
  active: ActiveCaseGraphPublication,
  kind: FullCorpusPublicGraphShardKind,
  shard: number,
): FullCorpusPublicGraphShardSummary => {
  const shardCount = publicGraphShardCount(active.manifest, kind);
  if (!Number.isSafeInteger(shard) || shard < 0 || shard >= shardCount) {
    throw new Error('case_graph_public_graph_shard_request_invalid');
  }
  const matches = active.manifest.graphShards.filter((summary) => (
    summary.shardKind === kind && summary.shard === shard
  ));
  if (matches.length !== 1 || matches[0].shardCount !== shardCount) {
    throw new Error('case_graph_public_graph_shard_summary_missing');
  }
  return matches[0];
};

export const readCaseGraphPublicShard = async <K extends FullCorpusPublicGraphShardKind>(params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  kind: K;
  shard: number;
  signal?: AbortSignal;
}): Promise<CaseGraphVerifiedPublicShard<K>> => {
  const summary = publicGraphShardSummary(params.active, params.kind, params.shard);
  const [archiveBody, receiptBody] = await Promise.all([
    params.storage.readObject(summary.archiveKey, { maxBytes: summary.compressedBytes, signal: params.signal }),
    params.storage.readObject(summary.receiptKey, { maxBytes: 1024 * 1024, signal: params.signal }),
  ]);
  if (!archiveBody || !receiptBody) throw new Error('case_graph_public_graph_shard_missing');
  const shard = decodeFullCorpusPublicGraphArchiveObject<FullCorpusPublicGraphShard>({
    archiveBody,
    receipt: receiptBody,
    maxUncompressedBytes: summary.uncompressedBytes,
  });
  let receipt: FullCorpusPublicGraphArchiveReceipt;
  try {
    receipt = JSON.parse(receiptBody.toString('utf8')) as FullCorpusPublicGraphArchiveReceipt;
  } catch {
    throw new Error('case_graph_public_graph_shard_receipt_invalid');
  }
  if (receipt.artifactKind !== params.kind
    || receipt.artifactDigest !== summary.artifactDigest
    || receipt.archiveKey !== summary.archiveKey
    || receipt.receiptKey !== summary.receiptKey
    || receipt.uncompressedBytes !== summary.uncompressedBytes
    || receipt.compressedBytes !== summary.compressedBytes
    || receipt.compressedSha256 !== summary.compressedSha256
    || shard.shardKind !== params.kind
    || shard.shard !== params.shard
    || shard.shardCount !== summary.shardCount
    || shard.itemCount !== summary.itemCount
    || shard.itemSetSha256 !== summary.itemSetSha256
    || shard.shardDigest !== summary.shardDigest) {
    throw new Error('case_graph_public_graph_shard_summary_mismatch');
  }
  if (params.kind === 'render') {
    const packing = buildFullCorpusPublicRenderPackingReceipt(shard.items as FullCorpusPublicRenderRow[]);
    if (packing.rowCount !== summary.itemCount
      || packing.addressLookupSha256 !== summary.renderAddressLookupSha256
      || packing.lodIndexSha256 !== summary.renderLodIndexSha256
      || packing.addressUtf8Bytes !== summary.renderAddressUtf8Bytes
      || packing.packedBytes !== summary.renderPackedBytes
      || packing.lodIndexBytes !== summary.renderLodIndexBytes) {
      throw new Error('case_graph_public_graph_render_packing_mismatch');
    }
  }
  return shard as CaseGraphVerifiedPublicShard<K>;
};

const readAddressShardItems = async <K extends 'node' | 'ego'>(params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  evidenceAddresses: readonly string[];
  kind: K;
  signal?: AbortSignal;
}): Promise<Map<string, CaseGraphPublicShardItemMap[K]>> => {
  if (params.evidenceAddresses.length > MAX_PUBLIC_GRAPH_BATCH_ITEMS) {
    throw new Error('case_graph_public_batch_request_invalid');
  }
  const addresses = params.evidenceAddresses.map((address) => parseCaseGraphEvidenceAddress(address).address);
  if (new Set(addresses).size !== addresses.length) throw new Error('case_graph_public_batch_request_invalid');
  const shardCount = publicGraphShardCount(params.active.manifest, params.kind);
  const addressesByShard = new Map<number, Set<string>>();
  for (const address of addresses) {
    const shard = fullCorpusRelationshipShard(address, shardCount);
    const group = addressesByShard.get(shard) || new Set<string>();
    group.add(address);
    addressesByShard.set(shard, group);
  }
  const result = new Map<string, CaseGraphPublicShardItemMap[K]>();
  await Promise.all([...addressesByShard].map(async ([shardNumber, wanted]) => {
    const shard = await readCaseGraphPublicShard({ ...params, shard: shardNumber });
    for (const item of shard.items) {
      if (!wanted.has(item.address)) continue;
      if (result.has(item.address)) throw new Error('case_graph_public_node_address_duplicate');
      result.set(item.address, item);
    }
  }));
  return result;
};

export const getCaseGraphRenderShard = async (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  shard: number,
  signal?: AbortSignal,
) => readCaseGraphPublicShard({ active, storage, kind: 'render', shard, signal });

export const getCaseGraphNodes = (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  evidenceAddresses: readonly string[],
  signal?: AbortSignal,
) => readAddressShardItems({ active, storage, evidenceAddresses, kind: 'node', signal });

export const getCaseGraphEgos = (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  evidenceAddresses: readonly string[],
  signal?: AbortSignal,
) => readAddressShardItems({ active, storage, evidenceAddresses, kind: 'ego', signal });

export const getCaseGraphNode = async (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  evidenceAddress: string,
  signal?: AbortSignal,
) => (await getCaseGraphNodes(active, storage, [evidenceAddress], signal)).get(
  parseCaseGraphEvidenceAddress(evidenceAddress).address,
) || null;

export const getCaseGraphEgo = async (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  evidenceAddress: string,
  signal?: AbortSignal,
) => (await getCaseGraphEgos(active, storage, [evidenceAddress], signal)).get(
  parseCaseGraphEvidenceAddress(evidenceAddress).address,
) || null;

const readIdShardItems = async <K extends 'edge' | 'evaluation'>(params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  ids: readonly string[];
  kind: K;
  pattern: RegExp;
  idOf: (item: CaseGraphPublicShardItemMap[K]) => string;
  invalidCode: string;
  duplicateCode: string;
  signal?: AbortSignal;
}): Promise<Map<string, CaseGraphPublicShardItemMap[K]>> => {
  if (params.ids.length > MAX_PUBLIC_GRAPH_BATCH_ITEMS) {
    throw new Error('case_graph_public_batch_request_invalid');
  }
  const ids = params.ids.map((id) => String(id || '').trim().toLowerCase());
  if (ids.some((id) => !params.pattern.test(id))) throw new Error(params.invalidCode);
  if (new Set(ids).size !== ids.length) throw new Error('case_graph_public_batch_request_invalid');
  const shardCount = publicGraphShardCount(params.active.manifest, params.kind);
  const idsByShard = new Map<number, Set<string>>();
  for (const id of ids) {
    const shard = fullCorpusRelationshipShard(id, shardCount);
    const group = idsByShard.get(shard) || new Set<string>();
    group.add(id);
    idsByShard.set(shard, group);
  }
  const result = new Map<string, CaseGraphPublicShardItemMap[K]>();
  await Promise.all([...idsByShard].map(async ([shardNumber, wanted]) => {
    const shard = await readCaseGraphPublicShard({
      active: params.active,
      storage: params.storage,
      kind: params.kind,
      shard: shardNumber,
      signal: params.signal,
    });
    for (const item of shard.items) {
      const id = params.idOf(item);
      if (!wanted.has(id)) continue;
      if (result.has(id)) throw new Error(params.duplicateCode);
      result.set(id, item);
    }
  }));
  return result;
};

export const getCaseGraphEdgeReceipts = (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  edgeIds: readonly string[],
  signal?: AbortSignal,
) => readIdShardItems<'edge'>({
  active,
  storage,
  ids: edgeIds,
  kind: 'edge',
  pattern: TYPED_EDGE_ID_PATTERN,
  idOf: (edge) => edge.edgeId,
  invalidCode: 'case_graph_edge_id_invalid',
  duplicateCode: 'case_graph_public_edge_duplicate',
  signal,
});

export const getCaseGraphEdgeReceipt = async (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  edgeId: string,
  signal?: AbortSignal,
) => {
  const normalized = String(edgeId || '').trim().toLowerCase();
  if (!TYPED_EDGE_ID_PATTERN.test(normalized)) throw new Error('case_graph_edge_id_invalid');
  return (await getCaseGraphEdgeReceipts(active, storage, [normalized], signal)).get(normalized) || null;
};

export const getCaseGraphEvaluationReceipts = (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  evaluationIds: readonly string[],
  signal?: AbortSignal,
) => readIdShardItems<'evaluation'>({
  active,
  storage,
  ids: evaluationIds,
  kind: 'evaluation',
  pattern: PUBLIC_EVALUATION_ID_PATTERN,
  idOf: (evaluation) => evaluation.evaluationId,
  invalidCode: 'case_graph_evaluation_id_invalid',
  duplicateCode: 'case_graph_public_evaluation_duplicate',
  signal,
});

export const getCaseGraphEvaluationReceipt = async (
  active: ActiveCaseGraphPublication,
  storage: CaseGraphPublicStorage,
  evaluationId: string,
  signal?: AbortSignal,
) => {
  const normalized = String(evaluationId || '').trim().toLowerCase();
  if (!PUBLIC_EVALUATION_ID_PATTERN.test(normalized)) {
    throw new Error('case_graph_evaluation_id_invalid');
  }
  return (await getCaseGraphEvaluationReceipts(active, storage, [normalized], signal)).get(normalized) || null;
};

export const projectCaseGraphPublicManifest = (active: ActiveCaseGraphPublication) => {
  // Projection is an independent trust boundary. Do not assume a caller kept
  // the object returned by activation immutable after its storage verification.
  const manifest = decodeCaseGraphPublicManifest(active.manifest, active.corpusVersion);
  const {
    archiveKey: _productionCompatibilityArchiveKey,
    ...publicProductionCompatibility
  } = manifest.lineage.productionCompatibility;
  const publicLineage = {
    ...manifest.lineage,
    // The verified pointer is useful public provenance, but its internal R2
    // object key is not part of the public routing contract.
    productionCompatibility: publicProductionCompatibility,
  };
  const publicShards = (kind: FullCorpusPublicGraphShardKind) => manifest.graphShards
    .filter((summary) => summary.shardKind === kind)
    .map((summary) => ({
      shard: summary.shard,
      shardCount: summary.shardCount,
      itemCount: summary.itemCount,
      uncompressedBytes: summary.uncompressedBytes,
      compressedBytes: summary.compressedBytes,
      artifactDigest: summary.artifactDigest,
      renderPacking: kind === 'render' ? {
        addressLookupSha256: summary.renderAddressLookupSha256,
        lodIndexSha256: summary.renderLodIndexSha256,
        addressUtf8Bytes: summary.renderAddressUtf8Bytes,
        packedBytes: summary.renderPackedBytes,
        lodIndexBytes: summary.renderLodIndexBytes,
      } : null,
      url: kind === 'render' ? `/api/public/case-vortex/render/shards/${summary.shard}` : null,
    }));
  return {
    active: true,
    publicationId: active.publicationId,
    corpusVersion: active.corpusVersion,
    generatedAt: manifest.generatedAt,
    sourceSnapshotAt: manifest.sourceSnapshotAt,
    lineage: publicLineage,
    accountingBinding: manifest.accountingBinding,
    models: manifest.models,
    topology: manifest.topology,
    accounting: manifest.accounting,
    corpusAccounting: {
      sha256: active.accountingReceiptSha256,
      receipt: active.accountingReceipt,
    },
    sourceRegistry: {
      version: CASE_GRAPH_SOURCE_REGISTRY_VERSION,
      sources: CASE_GRAPH_SOURCE_REGISTRY.map((source) => ({
        id: source.id,
        label: source.label,
        family: source.family,
        role: source.role,
        lineageId: source.lineageId,
        dependencyRisk: source.dependencyRisk,
        description: source.description,
      })),
    },
    density: {
      macroCellCount: manifest.density.macroCellCount,
      regionalCellCount: manifest.density.regionalCellCount,
    },
    renderIndex: {
      rowCount: manifest.lineage.publicGraph.renderRowCount,
      byKind: manifest.lineage.publicGraph.renderAddressKindCounts,
      addressSetSha256: manifest.lineage.publicGraph.renderAddressSetSha256,
      renderSetSha256: manifest.lineage.publicGraph.renderSetSha256,
      uncompressedBytes: manifest.lineage.publicGraph.renderUncompressedBytes,
      compressedBytes: manifest.lineage.publicGraph.renderCompressedBytes,
      format: manifest.lineage.publicGraph.renderFormat,
      addressOrder: manifest.lineage.publicGraph.renderAddressOrder,
      packedLayout: manifest.lineage.publicGraph.renderPackedLayout,
      packedLayoutSha256: manifest.lineage.publicGraph.renderPackedLayoutSha256,
      addressLookupSetSha256: manifest.lineage.publicGraph.renderAddressLookupSetSha256,
      lodPolicy: manifest.lineage.publicGraph.renderLodPolicy,
      lodPolicySha256: manifest.lineage.publicGraph.renderLodPolicySha256,
      lodIndexSetSha256: manifest.lineage.publicGraph.renderLodIndexSetSha256,
      temporalMapping: manifest.lineage.publicGraph.renderTemporalMapping,
      temporalMappingSha256: manifest.lineage.publicGraph.renderTemporalMappingSha256,
      addressUtf8Bytes: manifest.lineage.publicGraph.renderAddressUtf8Bytes,
      packedBytes: manifest.lineage.publicGraph.renderPackedBytes,
      lodIndexBytes: manifest.lineage.publicGraph.renderLodIndexBytes,
      retainedBytes: manifest.lineage.publicGraph.renderRetainedBytes,
      retainedBudgetBytes: manifest.lineage.publicGraph.renderRetainedBudgetBytes,
      inFlightDecodeBudgetBytes: manifest.lineage.publicGraph.renderInFlightDecodeBudgetBytes,
      bufferAllocation: manifest.lineage.publicGraph.renderBufferAllocation,
      fullNodeMetadataAccess: manifest.lineage.publicGraph.fullNodeMetadataAccess,
    },
    shards: {
      render: publicShards('render'),
      nodes: publicShards('node'),
      edges: publicShards('edge'),
      evaluations: publicShards('evaluation'),
      egos: publicShards('ego'),
    },
    endpoints: {
      density: '/api/public/case-vortex/density?level={macro|regional}',
      cluster: '/api/public/case-vortex/clusters/{cellId}?limit={1..250}&after={evidenceAddress}',
      render: '/api/public/case-vortex/render/shards/{shard}',
      node: '/api/public/case-vortex/nodes/{evidenceAddress}',
      ego: '/api/public/case-vortex/ego/{evidenceAddress}',
      receipt: '/api/public/case-vortex/receipts/{edgeId}',
    },
    identifierContract: {
      canonical: '{sighting|document|photo|video}:{recordId}',
      legacySightingAlias: '{uuid}',
    },
    notices: manifest.notices,
  };
};
