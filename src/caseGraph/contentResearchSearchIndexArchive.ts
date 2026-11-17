import { createHash } from 'node:crypto';

import { canonicalizeRelationshipInput, relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION,
  verifyCaseGraphContentSearchIndex,
  type CaseGraphContentSearchIndexManifest,
  type CaseGraphContentSearchIndexShard,
} from './contentResearchSearchIndex';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';

export const CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION = 'case-graph-content-search-archive-v1' as const;

export type CaseGraphContentSearchArchivePointer = {
  schemaVersion: typeof CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION;
  publicationManifestSha256: string;
  indexManifestDigest: string;
  manifestObjectKey: string;
  manifestObjectSha256: string;
  shardCount: number;
  entryCount: number;
  shardObjects: Array<{ shardNumber: number; objectKey: string; objectSha256: string; shardDigest: string }>;
  pointerDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/;

const bytesOf = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const persist = async (archive: CaseGraphContentImmutableArchive, key: string, body: Buffer, signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('case_graph_content_search_archive_aborted');
  const digest = sha256(body);
  await archive.putIfAbsent({ key, body, contentType: 'application/json', signal });
  const observed = await archive.readObject(key, { maxBytes: body.byteLength, signal });
  if (!observed || observed.byteLength !== body.byteLength || sha256(observed) !== digest) {
    throw new Error('case_graph_content_search_archive_read_after_write_mismatch');
  }
  return digest;
};

export const archiveCaseGraphContentSearchIndex = async (params: {
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<CaseGraphContentSearchArchivePointer> => {
  const verified = verifyCaseGraphContentSearchIndex({ manifest: params.manifest, shards: params.shards });
  const prefix = [
    'case-vortex/content-search', verified.manifest.publication.manifestSha256,
    CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION, verified.manifest.manifestDigest,
  ].join('/');
  const shardObjects = [] as CaseGraphContentSearchArchivePointer['shardObjects'];
  for (const shard of verified.shards) {
    const objectKey = `${prefix}/shards/${String(shard.shardNumber).padStart(6, '0')}.json`;
    const objectSha256 = await persist(params.archive, objectKey, bytesOf(shard), params.signal);
    shardObjects.push({ shardNumber: shard.shardNumber, objectKey, objectSha256, shardDigest: shard.shardDigest });
  }
  const manifestObjectKey = `${prefix}/manifest.json`;
  const manifestObjectSha256 = await persist(
    params.archive, manifestObjectKey, bytesOf(verified.manifest), params.signal,
  );
  const core = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION,
    publicationManifestSha256: verified.manifest.publication.manifestSha256,
    indexManifestDigest: verified.manifest.manifestDigest,
    manifestObjectKey,
    manifestObjectSha256,
    shardCount: shardObjects.length,
    entryCount: verified.manifest.entryCount,
    shardObjects,
  };
  return { ...core, pointerDigest: relationshipInputSha256(core) };
};

export const verifyCaseGraphContentSearchArchivePointer = (params: {
  value: CaseGraphContentSearchArchivePointer;
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
}): CaseGraphContentSearchArchivePointer => {
  const verified = verifyCaseGraphContentSearchIndex({ manifest: params.manifest, shards: params.shards });
  const prefix = [
    'case-vortex/content-search', verified.manifest.publication.manifestSha256,
    CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION, verified.manifest.manifestDigest,
  ].join('/');
  const value = params.value;
  const expectedManifestSha256 = sha256(bytesOf(verified.manifest));
  if (!value || value.schemaVersion !== CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION
    || value.manifestObjectSha256 !== expectedManifestSha256 || !Array.isArray(value.shardObjects)
    || value.shardObjects.length !== verified.shards.length) {
    throw new Error('case_graph_content_search_archive_pointer_integrity_failed');
  }
  const shardObjects = verified.shards.map((shard, shardNumber) => {
    const observed = value.shardObjects[shardNumber];
    const expectedObjectSha256 = sha256(bytesOf(shard));
    if (!observed || observed.shardNumber !== shardNumber || !SHA256.test(observed.objectSha256)
      || observed.objectSha256 !== expectedObjectSha256) {
      throw new Error('case_graph_content_search_archive_pointer_integrity_failed');
    }
    return {
      shardNumber,
      objectKey: `${prefix}/shards/${String(shardNumber).padStart(6, '0')}.json`,
      objectSha256: expectedObjectSha256,
      shardDigest: shard.shardDigest,
    };
  });
  const core = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_ARCHIVE_VERSION,
    publicationManifestSha256: verified.manifest.publication.manifestSha256,
    indexManifestDigest: verified.manifest.manifestDigest,
    manifestObjectKey: `${prefix}/manifest.json`,
    manifestObjectSha256: expectedManifestSha256,
    shardCount: verified.manifest.shardCount,
    entryCount: verified.manifest.entryCount,
    shardObjects,
  };
  const expected = { ...core, pointerDigest: relationshipInputSha256(core) };
  if (relationshipInputSha256(value) !== relationshipInputSha256(expected)) {
    throw new Error('case_graph_content_search_archive_pointer_integrity_failed');
  }
  return expected;
};

export const verifyCaseGraphContentSearchArchiveObjects = async (params: {
  value: CaseGraphContentSearchArchivePointer;
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}) => {
  const pointer = verifyCaseGraphContentSearchArchivePointer(params);
  const expected = [
    { key: pointer.manifestObjectKey, body: bytesOf(params.manifest) },
    ...pointer.shardObjects.map((object, index) => ({ key: object.objectKey, body: bytesOf(params.shards[index]) })),
  ];
  for (const object of expected) {
    if (params.signal?.aborted) throw new Error('case_graph_content_search_archive_aborted');
    const observed = await params.archive.readObject(object.key, {
      maxBytes: object.body.byteLength,
      signal: params.signal,
    });
    if (!observed || !observed.equals(object.body)) {
      throw new Error('case_graph_content_search_archive_source_read_mismatch');
    }
  }
  return pointer;
};
