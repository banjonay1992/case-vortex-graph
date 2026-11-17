import { relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  verifyCaseGraphContentAccountingReceipt,
  verifyCaseGraphContentAsset,
  verifyCaseGraphContentChunk,
  verifyCaseGraphContentExtractionContract,
  verifyCaseGraphContentExtractionReceipt,
  type CaseGraphContentAccountingReceipt,
  type CaseGraphContentAsset,
  type CaseGraphContentChunk,
  type CaseGraphContentDiscoveryManifest,
  type CaseGraphContentExtractionContract,
  type CaseGraphContentExtractionReceipt,
  type CaseGraphContentLocator,
  type CaseGraphContentTextOrigin,
} from './contentResearchArchive';
import {
  verifyCaseGraphContentExtractionArchivePointer,
  type CaseGraphContentExtractionArchivePointer,
} from './contentResearchExtractionArchive';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION = 'case-graph-content-search-index-v1' as const;
export const CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY = Object.freeze({
  maximumEntriesPerShard: 4_096,
  authorizationScope: 'exact_verified_publication_public_content',
} as const);

export type CaseGraphContentSearchIndexEntry = {
  entryId: string;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  nodeDigest: string;
  assetId: string;
  assetDigest: string;
  extractionContractDigest: string;
  extractionReceiptDigest: string;
  extractionPointerDigest: string;
  chunksObjectKey: string;
  chunksObjectSha256: string;
  chunkId: string;
  chunkDigest: string;
  mediaKind: CaseGraphContentAsset['mediaKind'];
  textOrigin: CaseGraphContentTextOrigin;
  locator: CaseGraphContentLocator;
  text: string;
  language: string;
  confidence: number | null;
  visibility: 'public';
  authorizationScope: typeof CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.authorizationScope;
  untrustedText: true;
  entryDigest: string;
};

export type CaseGraphContentSearchIndexShard = {
  schemaVersion: typeof CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION;
  shardNumber: number;
  entryCount: number;
  entrySetSha256: string;
  entries: CaseGraphContentSearchIndexEntry[];
  shardDigest: string;
};

export type CaseGraphContentSearchIndexManifest = {
  schemaVersion: typeof CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  accountingReceiptDigest: string;
  entryCount: number;
  entrySetSha256: string;
  shardCount: number;
  shardSetSha256: string;
  shards: Array<{ shardNumber: number; entryCount: number; shardDigest: string }>;
  authorizationScope: typeof CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.authorizationScope;
  manifestDigest: string;
};

const entryCore = (entry: Omit<CaseGraphContentSearchIndexEntry, 'entryDigest'> | CaseGraphContentSearchIndexEntry) => ({
  entryId: entry.entryId,
  publication: entry.publication,
  address: entry.address,
  nodeDigest: entry.nodeDigest,
  assetId: entry.assetId,
  assetDigest: entry.assetDigest,
  extractionContractDigest: entry.extractionContractDigest,
  extractionReceiptDigest: entry.extractionReceiptDigest,
  extractionPointerDigest: entry.extractionPointerDigest,
  chunksObjectKey: entry.chunksObjectKey,
  chunksObjectSha256: entry.chunksObjectSha256,
  chunkId: entry.chunkId,
  chunkDigest: entry.chunkDigest,
  mediaKind: entry.mediaKind,
  textOrigin: entry.textOrigin,
  locator: entry.locator,
  text: entry.text,
  language: entry.language,
  confidence: entry.confidence,
  visibility: entry.visibility,
  authorizationScope: entry.authorizationScope,
  untrustedText: entry.untrustedText,
});

export const buildCaseGraphContentSearchIndex = (params: {
  publication: CaseGraphResearchPublicationBinding;
  discoveryManifest: CaseGraphContentDiscoveryManifest;
  assets: CaseGraphContentAsset[];
  accountingReceipt: CaseGraphContentAccountingReceipt;
  extractions: Array<{
    contract: CaseGraphContentExtractionContract;
    receipt: CaseGraphContentExtractionReceipt;
    chunks: CaseGraphContentChunk[];
    pointer: CaseGraphContentExtractionArchivePointer;
  }>;
  maximumEntriesPerShard?: number;
}): { manifest: CaseGraphContentSearchIndexManifest; shards: CaseGraphContentSearchIndexShard[] } => {
  const accountingExtractions = params.extractions.map(({ contract, receipt, chunks }) => ({ contract, receipt, chunks }));
  const accounting = verifyCaseGraphContentAccountingReceipt({
    value: params.accountingReceipt,
    publication: params.publication,
    discoveryManifest: params.discoveryManifest,
    assets: params.assets,
    extractions: accountingExtractions,
  });
  const maximumEntriesPerShard = params.maximumEntriesPerShard
    ?? CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.maximumEntriesPerShard;
  if (!Number.isSafeInteger(maximumEntriesPerShard) || maximumEntriesPerShard < 1
    || maximumEntriesPerShard > CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.maximumEntriesPerShard) {
    throw new Error('case_graph_content_search_index_plan_invalid');
  }
  const assets = new Map(params.assets.map((value) => {
    const asset = verifyCaseGraphContentAsset(value);
    return [asset.assetId, asset] as const;
  }));
  const entries: CaseGraphContentSearchIndexEntry[] = [];
  for (const extraction of params.extractions) {
    const asset = assets.get(extraction.receipt.assetId);
    if (!asset || asset.visibility !== 'public') throw new Error('case_graph_content_search_index_asset_invalid');
    const contract = verifyCaseGraphContentExtractionContract({ value: extraction.contract, asset });
    const chunks = extraction.chunks.map((value) => verifyCaseGraphContentChunk({ value, asset, contract }));
    const receipt = verifyCaseGraphContentExtractionReceipt({
      value: extraction.receipt, asset, contract, chunks,
    });
    const pointer = verifyCaseGraphContentExtractionArchivePointer({
      value: extraction.pointer, asset, contract, receipt,
    });
    for (const chunk of chunks) {
      const withoutDigest = {
        entryId: `content-search-entry:${relationshipInputSha256({
          publication: asset.publication, chunkId: chunk.chunkId, chunkDigest: chunk.chunkDigest,
        })}`,
        publication: asset.publication,
        address: asset.address,
        nodeDigest: asset.nodeDigest,
        assetId: asset.assetId,
        assetDigest: asset.assetDigest,
        extractionContractDigest: contract.contractDigest,
        extractionReceiptDigest: receipt.receiptDigest,
        extractionPointerDigest: pointer.pointerDigest,
        chunksObjectKey: pointer.chunksObjectKey,
        chunksObjectSha256: pointer.chunksObjectSha256,
        chunkId: chunk.chunkId,
        chunkDigest: chunk.chunkDigest,
        mediaKind: asset.mediaKind,
        textOrigin: chunk.textOrigin,
        locator: chunk.locator,
        text: chunk.text,
        language: chunk.language,
        confidence: chunk.confidence,
        visibility: 'public' as const,
        authorizationScope: CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.authorizationScope,
        untrustedText: true as const,
      };
      entries.push({ ...withoutDigest, entryDigest: relationshipInputSha256(withoutDigest) });
    }
  }
  entries.sort((left, right) => left.chunkId < right.chunkId ? -1 : left.chunkId > right.chunkId ? 1 : 0);
  if (entries.length !== accounting.searchableChunkCount
    || new Set(entries.map(({ chunkId }) => chunkId)).size !== entries.length) {
    throw new Error('case_graph_content_search_index_accounting_mismatch');
  }
  const shards: CaseGraphContentSearchIndexShard[] = [];
  for (let offset = 0; offset < entries.length; offset += maximumEntriesPerShard) {
    const shardEntries = entries.slice(offset, offset + maximumEntriesPerShard);
    const core = {
      schemaVersion: CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION,
      shardNumber: shards.length,
      entryCount: shardEntries.length,
      entrySetSha256: relationshipInputSha256(shardEntries.map(({ entryId, entryDigest }) => ({ entryId, entryDigest }))),
      entries: shardEntries,
    };
    shards.push({ ...core, shardDigest: relationshipInputSha256(core) });
  }
  const summaries = shards.map(({ shardNumber, entryCount, shardDigest }) => ({ shardNumber, entryCount, shardDigest }));
  const core = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION,
    publication: params.publication,
    accountingReceiptDigest: accounting.receiptDigest,
    entryCount: entries.length,
    entrySetSha256: relationshipInputSha256(entries.map(({ entryId, entryDigest }) => ({ entryId, entryDigest }))),
    shardCount: shards.length,
    shardSetSha256: relationshipInputSha256(summaries),
    shards: summaries,
    authorizationScope: CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.authorizationScope,
  };
  return { manifest: { ...core, manifestDigest: relationshipInputSha256(core) }, shards };
};

export const verifyCaseGraphContentSearchIndex = (value: {
  manifest: CaseGraphContentSearchIndexManifest;
  shards: CaseGraphContentSearchIndexShard[];
}) => {
  if (!value || !Array.isArray(value.shards)) throw new Error('case_graph_content_search_index_integrity_failed');
  const shards = value.shards.map((shard, shardNumber) => {
    if (shard.schemaVersion !== CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION || shard.shardNumber !== shardNumber
      || !Array.isArray(shard.entries) || shard.entries.length < 1
      || shard.entries.length > CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.maximumEntriesPerShard) {
      throw new Error('case_graph_content_search_index_integrity_failed');
    }
    const entries = shard.entries.map((entry) => {
      const core = entryCore(entry);
      if (entry.visibility !== 'public' || entry.untrustedText !== true
        || entry.authorizationScope !== CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.authorizationScope
        || relationshipInputSha256(core) !== entry.entryDigest) {
        throw new Error('case_graph_content_search_index_integrity_failed');
      }
      return { ...core, entryDigest: entry.entryDigest };
    });
    const core = {
      schemaVersion: CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION,
      shardNumber,
      entryCount: entries.length,
      entrySetSha256: relationshipInputSha256(entries.map(({ entryId, entryDigest }) => ({ entryId, entryDigest }))),
      entries,
    };
    if (relationshipInputSha256(core) !== shard.shardDigest
      || shard.entryCount !== core.entryCount || shard.entrySetSha256 !== core.entrySetSha256) {
      throw new Error('case_graph_content_search_index_integrity_failed');
    }
    return { ...core, shardDigest: shard.shardDigest };
  });
  const entries = shards.flatMap(({ entries }) => entries);
  if (new Set(entries.map(({ chunkId }) => chunkId)).size !== entries.length
    || entries.some((entry, index) => index > 0 && entries[index - 1].chunkId >= entry.chunkId)) {
    throw new Error('case_graph_content_search_index_integrity_failed');
  }
  const summaries = shards.map(({ shardNumber, entryCount, shardDigest }) => ({ shardNumber, entryCount, shardDigest }));
  const core = {
    schemaVersion: CASE_GRAPH_CONTENT_SEARCH_INDEX_VERSION,
    publication: value.manifest.publication,
    accountingReceiptDigest: value.manifest.accountingReceiptDigest,
    entryCount: entries.length,
    entrySetSha256: relationshipInputSha256(entries.map(({ entryId, entryDigest }) => ({ entryId, entryDigest }))),
    shardCount: shards.length,
    shardSetSha256: relationshipInputSha256(summaries),
    shards: summaries,
    authorizationScope: CASE_GRAPH_CONTENT_SEARCH_INDEX_POLICY.authorizationScope,
  };
  if (value.manifest.entryCount !== core.entryCount || value.manifest.entrySetSha256 !== core.entrySetSha256
    || value.manifest.shardCount !== core.shardCount || value.manifest.shardSetSha256 !== core.shardSetSha256
    || value.manifest.authorizationScope !== core.authorizationScope
    || relationshipInputSha256(core) !== value.manifest.manifestDigest) {
    throw new Error('case_graph_content_search_index_integrity_failed');
  }
  return { manifest: { ...core, manifestDigest: value.manifest.manifestDigest }, shards };
};
