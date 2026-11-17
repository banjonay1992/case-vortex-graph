import { createHash } from 'node:crypto';

import {
  verifyCaseGraphContentAccountingReceipt,
  verifyCaseGraphContentAsset,
  type CaseGraphContentAccountingReceipt,
  type CaseGraphContentAsset,
  type CaseGraphContentChunk,
  type CaseGraphContentDiscoveryManifest,
  type CaseGraphContentExtractionContract,
  type CaseGraphContentExtractionReceipt,
} from './contentResearchArchive';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION =
  'case-graph-content-source-registry-v1' as const;
const SHARD_COUNT = 256;
const MAX_POINTER_BYTES = 16 * 1024;
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_SHARD_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

type SourceRegistryShardReceipt = {
  shardNumber: number;
  objectKey: string;
  objectSha256: string;
  byteLength: number;
  assetCount: number;
  addressCount: number;
  assetSetSha256: string;
};

export type CaseGraphContentSourceRegistry = {
  recordType: 'case_graph_content_source_registry';
  schemaVersion: typeof CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  accountingReceiptDigest: string;
  assetCount: number;
  addressCount: number;
  assetSetSha256: string;
  shards: SourceRegistryShardReceipt[];
  registryDigest: string;
};

export type CaseGraphContentSourceRegistryPointer = {
  recordType: 'case_graph_content_source_registry_pointer';
  schemaVersion: typeof CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  registryObjectKey: string;
  registryObjectSha256: string;
  registryDigest: string;
  pointerDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const bytes = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const shardNumberFor = (address: string) => Number.parseInt(sha256(address).slice(0, 2), 16);
const prefix = (manifestSha256: string) => `case-vortex/content/source-replay/publications/${manifestSha256}`;
export const caseGraphContentSourceRegistryPointerKey = (manifestSha256: string) => `${prefix(manifestSha256)}/active.json`;

const persistExact = async (params: {
  archive: CaseGraphContentImmutableArchive;
  key: string;
  body: Buffer;
  maximumBytes: number;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) fail('case_graph_content_source_registry_aborted');
  if (params.body.byteLength < 2 || params.body.byteLength > params.maximumBytes) {
    fail('case_graph_content_source_registry_too_large');
  }
  await params.archive.putIfAbsent({
    key: params.key,
    body: params.body,
    contentType: 'application/json',
    signal: params.signal,
  });
  const observed = await params.archive.readObject(params.key, {
    maxBytes: params.maximumBytes,
    signal: params.signal,
  });
  if (!observed || !observed.equals(params.body)) fail('case_graph_content_source_registry_read_after_write_mismatch');
};

const decode = (body: Buffer, code: string): unknown => {
  try { return JSON.parse(body.toString('utf8')); } catch { return fail(code); }
};

const requiredBuffer = (value: Buffer | null, code: string): Buffer => {
  if (value === null) return fail(code);
  return value;
};

const requiredString = (value: unknown, code: string): string => {
  if (typeof value !== 'string') return fail(code);
  return value;
};

const exactObject = (value: unknown, keys: string[], code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return object;
};

const validatePublication = (
  value: unknown,
  expected: CaseGraphResearchPublicationBinding,
  code: string,
) => {
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) fail(code);
};

export const archiveCaseGraphContentSourceRegistry = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  accountingReceiptDigest: string;
  accountingAssetSetSha256: string;
  assets: CaseGraphContentAsset[];
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<CaseGraphContentSourceRegistryPointer> => {
  if (!SHA256.test(params.accountingReceiptDigest) || !SHA256.test(params.accountingAssetSetSha256)) {
    fail('case_graph_content_source_registry_accounting_invalid');
  }
  const assets = params.assets.map(verifyCaseGraphContentAsset)
    .sort((left, right) => compareText(left.assetId, right.assetId));
  if (new Set(assets.map((asset) => asset.assetId)).size !== assets.length
    || assets.some((asset) => canonicalizeRelationshipInput(asset.publication)
      !== canonicalizeRelationshipInput(params.publication))) {
    fail('case_graph_content_source_registry_asset_set_invalid');
  }
  const assetSetSha256 = relationshipInputSha256(assets.map(({ assetId, assetDigest }) => ({ assetId, assetDigest })));
  if (assetSetSha256 !== params.accountingAssetSetSha256) fail('case_graph_content_source_registry_asset_set_invalid');

  const grouped = new Map<number, CaseGraphContentAsset[]>();
  for (const asset of assets) {
    const shardNumber = shardNumberFor(asset.address);
    grouped.set(shardNumber, [...(grouped.get(shardNumber) || []), asset]);
  }
  const shardReceipts: SourceRegistryShardReceipt[] = [];
  for (const [shardNumber, shardAssets] of [...grouped.entries()].sort(([left], [right]) => left - right)) {
    const shardCore = {
      recordType: 'case_graph_content_source_registry_shard' as const,
      schemaVersion: CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION,
      publication: params.publication,
      shardNumber,
      assets: shardAssets,
      assetSetSha256: relationshipInputSha256(shardAssets.map(({ assetId, assetDigest }) => ({ assetId, assetDigest }))),
    };
    const shard = { ...shardCore, shardDigest: relationshipInputSha256(shardCore) };
    const shardBody = bytes(shard);
    const objectKey = `${prefix(params.publication.manifestSha256)}/shards/${shardNumber.toString(16).padStart(2, '0')}-${shard.shardDigest}.json`;
    await persistExact({ archive: params.archive, key: objectKey, body: shardBody, maximumBytes: MAX_SHARD_BYTES, signal: params.signal });
    shardReceipts.push({
      shardNumber,
      objectKey,
      objectSha256: sha256(shardBody),
      byteLength: shardBody.byteLength,
      assetCount: shardAssets.length,
      addressCount: new Set(shardAssets.map((asset) => asset.address)).size,
      assetSetSha256: shard.assetSetSha256,
    });
  }
  const registryCore = {
    recordType: 'case_graph_content_source_registry' as const,
    schemaVersion: CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION,
    publication: params.publication,
    accountingReceiptDigest: params.accountingReceiptDigest,
    assetCount: assets.length,
    addressCount: new Set(assets.map((asset) => asset.address)).size,
    assetSetSha256,
    shards: shardReceipts,
  };
  const registry: CaseGraphContentSourceRegistry = {
    ...registryCore,
    registryDigest: relationshipInputSha256(registryCore),
  };
  const registryBody = bytes(registry);
  const registryObjectKey = `${prefix(params.publication.manifestSha256)}/registries/${registry.registryDigest}.json`;
  await persistExact({ archive: params.archive, key: registryObjectKey, body: registryBody, maximumBytes: MAX_REGISTRY_BYTES, signal: params.signal });
  const pointerCore = {
    recordType: 'case_graph_content_source_registry_pointer' as const,
    schemaVersion: CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION,
    publication: params.publication,
    registryObjectKey,
    registryObjectSha256: sha256(registryBody),
    registryDigest: registry.registryDigest,
  };
  const pointer = { ...pointerCore, pointerDigest: relationshipInputSha256(pointerCore) };
  await persistExact({
    archive: params.archive,
    key: caseGraphContentSourceRegistryPointerKey(params.publication.manifestSha256),
    body: bytes(pointer),
    maximumBytes: MAX_POINTER_BYTES,
    signal: params.signal,
  });
  return pointer;
};

/**
 * Authoritative activation path for source replay. The registry is not written
 * until the complete discovery, terminal-asset and extraction accounting proof
 * has been re-derived and matched to the supplied immutable receipt.
 */
export const archiveCaseGraphContentSourceRegistryFromAccounting = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  discoveryManifest: CaseGraphContentDiscoveryManifest;
  assets: CaseGraphContentAsset[];
  accountingReceipt: CaseGraphContentAccountingReceipt;
  extractions: Array<{
    contract: CaseGraphContentExtractionContract;
    receipt: CaseGraphContentExtractionReceipt;
    chunks: CaseGraphContentChunk[];
  }>;
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<CaseGraphContentSourceRegistryPointer> => {
  if (params.signal?.aborted) fail('case_graph_content_source_registry_aborted');
  const accountingReceipt = verifyCaseGraphContentAccountingReceipt({
    value: params.accountingReceipt,
    publication: params.publication,
    discoveryManifest: params.discoveryManifest,
    assets: params.assets,
    extractions: params.extractions,
  });
  if (!accountingReceipt.accountingComplete) {
    fail('case_graph_content_source_registry_accounting_incomplete');
  }
  const observedObjects = new Map<string, Buffer>();
  const readVerifiedObject = async (key: string, expectedSha256: string) => {
    if (params.signal?.aborted) fail('case_graph_content_source_registry_aborted');
    const cached = observedObjects.get(key);
    const body = cached ?? requiredBuffer(await params.archive.readObject(key, {
      maxBytes: params.discoveryManifest.limitsProfile.maxAssetBytes,
      signal: params.signal,
    }), 'case_graph_content_source_registry_source_integrity_failed');
    if (sha256(body) !== expectedSha256) {
      fail('case_graph_content_source_registry_source_integrity_failed');
    }
    observedObjects.set(key, body);
    return body;
  };
  for (const asset of params.assets.filter(({ terminalStatus }) => terminalStatus === 'extracted')) {
    const capturedObjectKey = requiredString(
      asset.capturedObjectKey, 'case_graph_content_source_registry_source_integrity_failed',
    );
    const capturedObjectSha256 = requiredString(
      asset.capturedObjectSha256, 'case_graph_content_source_registry_source_integrity_failed',
    );
    const searchableObjectKey = requiredString(
      asset.searchableObjectKey, 'case_graph_content_source_registry_source_integrity_failed',
    );
    const searchableBytesSha256 = requiredString(
      asset.searchableBytesSha256, 'case_graph_content_source_registry_source_integrity_failed',
    );
    const captured = await readVerifiedObject(capturedObjectKey, capturedObjectSha256);
    if (captured.byteLength !== asset.byteLength) {
      fail('case_graph_content_source_registry_source_integrity_failed');
    }
    await readVerifiedObject(searchableObjectKey, searchableBytesSha256);
  }
  return archiveCaseGraphContentSourceRegistry({
    publication: params.publication,
    accountingReceiptDigest: accountingReceipt.receiptDigest,
    accountingAssetSetSha256: accountingReceipt.assetSetSha256,
    assets: params.assets,
    archive: params.archive,
    signal: params.signal,
  });
};

export const loadCaseGraphContentSourceAssets = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  archive: Pick<CaseGraphContentImmutableArchive, 'readObject'>;
  signal?: AbortSignal;
}): Promise<{ registry: CaseGraphContentSourceRegistry; assets: CaseGraphContentAsset[] }> => {
  if (params.signal?.aborted) fail('case_graph_content_source_registry_aborted');
  const pointerKey = caseGraphContentSourceRegistryPointerKey(params.publication.manifestSha256);
  const pointerBody = requiredBuffer(
    await params.archive.readObject(pointerKey, { maxBytes: MAX_POINTER_BYTES, signal: params.signal }),
    'case_graph_content_source_registry_unavailable',
  );
  const pointerRaw = exactObject(decode(pointerBody, 'case_graph_content_source_registry_pointer_invalid'), [
    'recordType', 'schemaVersion', 'publication', 'registryObjectKey', 'registryObjectSha256', 'registryDigest', 'pointerDigest',
  ], 'case_graph_content_source_registry_pointer_invalid');
  validatePublication(pointerRaw.publication, params.publication, 'case_graph_content_source_registry_publication_mismatch');
  const { pointerDigest: _pointerDigest, ...pointerCore } = pointerRaw;
  const registryObjectKey = requiredString(pointerRaw.registryObjectKey, 'case_graph_content_source_registry_pointer_invalid');
  const registryObjectSha256 = requiredString(pointerRaw.registryObjectSha256, 'case_graph_content_source_registry_pointer_invalid');
  const pointerRegistryDigest = requiredString(pointerRaw.registryDigest, 'case_graph_content_source_registry_pointer_invalid');
  if (pointerRaw.recordType !== 'case_graph_content_source_registry_pointer'
    || pointerRaw.schemaVersion !== CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION
    || !SHA256.test(registryObjectSha256)
    || !SHA256.test(pointerRegistryDigest)
    || pointerRaw.pointerDigest !== relationshipInputSha256(pointerCore)) {
    fail('case_graph_content_source_registry_pointer_invalid');
  }
  const registryBody = requiredBuffer(
    await params.archive.readObject(registryObjectKey, { maxBytes: MAX_REGISTRY_BYTES, signal: params.signal }),
    'case_graph_content_source_registry_integrity_failed',
  );
  if (sha256(registryBody) !== registryObjectSha256) fail('case_graph_content_source_registry_integrity_failed');
  const registryRaw = exactObject(decode(registryBody, 'case_graph_content_source_registry_invalid'), [
    'recordType', 'schemaVersion', 'publication', 'accountingReceiptDigest', 'assetCount', 'addressCount', 'assetSetSha256', 'shards', 'registryDigest',
  ], 'case_graph_content_source_registry_invalid');
  validatePublication(registryRaw.publication, params.publication, 'case_graph_content_source_registry_publication_mismatch');
  const { registryDigest: _registryDigest, ...registryCore } = registryRaw;
  if (registryRaw.recordType !== 'case_graph_content_source_registry'
    || registryRaw.schemaVersion !== CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION
    || registryRaw.registryDigest !== pointerRegistryDigest
    || registryRaw.registryDigest !== relationshipInputSha256(registryCore)
    || !Array.isArray(registryRaw.shards)) fail('case_graph_content_source_registry_invalid');
  const registry = registryRaw as unknown as CaseGraphContentSourceRegistry;
  const shardNumber = shardNumberFor(params.address);
  const shardReceipt = registry.shards.find((shard) => shard.shardNumber === shardNumber);
  if (!shardReceipt) return { registry, assets: [] };
  const shardBody = requiredBuffer(
    await params.archive.readObject(shardReceipt.objectKey, { maxBytes: MAX_SHARD_BYTES, signal: params.signal }),
    'case_graph_content_source_registry_integrity_failed',
  );
  if (shardBody.byteLength !== shardReceipt.byteLength || sha256(shardBody) !== shardReceipt.objectSha256) {
    fail('case_graph_content_source_registry_integrity_failed');
  }
  const shardRaw = exactObject(decode(shardBody, 'case_graph_content_source_registry_shard_invalid'), [
    'recordType', 'schemaVersion', 'publication', 'shardNumber', 'assets', 'assetSetSha256', 'shardDigest',
  ], 'case_graph_content_source_registry_shard_invalid');
  validatePublication(shardRaw.publication, params.publication, 'case_graph_content_source_registry_publication_mismatch');
  const { shardDigest: _shardDigest, ...shardCore } = shardRaw;
  if (shardRaw.recordType !== 'case_graph_content_source_registry_shard'
    || shardRaw.schemaVersion !== CASE_GRAPH_CONTENT_SOURCE_REGISTRY_VERSION
    || shardRaw.shardNumber !== shardNumber
    || shardRaw.shardDigest !== relationshipInputSha256(shardCore)
    || !Array.isArray(shardRaw.assets)) fail('case_graph_content_source_registry_shard_invalid');
  const shardAssets = shardRaw.assets as unknown[];
  const assets = shardAssets.map((asset: unknown) => verifyCaseGraphContentAsset(asset as CaseGraphContentAsset));
  if (assets.length !== shardReceipt.assetCount
    || relationshipInputSha256(assets.map(({ assetId, assetDigest }) => ({ assetId, assetDigest }))) !== shardReceipt.assetSetSha256
    || assets.some((asset) => shardNumberFor(asset.address) !== shardNumber)) {
    fail('case_graph_content_source_registry_shard_invalid');
  }
  return { registry, assets: assets.filter((asset) => asset.address === params.address) };
};
