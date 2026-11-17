import {
  buildCaseGraphContentSearchIndex,
  type CaseGraphContentSearchIndexManifest,
} from './contentResearchSearchIndex';
import {
  archiveCaseGraphContentSearchIndex,
  type CaseGraphContentSearchArchivePointer,
} from './contentResearchSearchIndexArchive';
import {
  archiveCaseGraphContentSourceRegistryFromAccounting,
  type CaseGraphContentSourceRegistryPointer,
} from './contentResearchSourceRegistryArchive';
import type { CaseGraphContentExtractionArchivePointer } from './contentResearchExtractionArchive';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import type {
  CaseGraphContentAccountingReceipt,
  CaseGraphContentAsset,
  CaseGraphContentChunk,
  CaseGraphContentDiscoveryManifest,
  CaseGraphContentExtractionContract,
  CaseGraphContentExtractionReceipt,
} from './contentResearchArchive';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_CONTENT_PUBLICATION_ARCHIVE_VERSION =
  'case-graph-content-publication-archive-v1' as const;

type Extraction = {
  contract: CaseGraphContentExtractionContract;
  receipt: CaseGraphContentExtractionReceipt;
  chunks: CaseGraphContentChunk[];
  pointer: CaseGraphContentExtractionArchivePointer;
};

export type CaseGraphContentPublicationArchiveReceipt = {
  recordType: 'case_graph_content_publication_archive_receipt';
  schemaVersion: typeof CASE_GRAPH_CONTENT_PUBLICATION_ARCHIVE_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  accountingReceiptDigest: string;
  searchIndexManifestDigest: string;
  searchArchivePointerDigest: string;
  sourceRegistryPointerDigest: string;
  terminalAssetCount: number;
  searchableEntryCount: number;
  receiptDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };

/**
 * Finalizes the public-content research surface in dependency order. Search
 * artifacts must be fully verified and archived before source replay receives
 * its active pointer. Immutable search objects may remain after a later failure,
 * but no source registry is activated for a partial publication.
 */
export const archiveCaseGraphContentResearchPublication = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  discoveryManifest: CaseGraphContentDiscoveryManifest;
  assets: CaseGraphContentAsset[];
  accountingReceipt: CaseGraphContentAccountingReceipt;
  extractions: Extraction[];
  archive: CaseGraphContentImmutableArchive;
  maximumEntriesPerShard?: number;
  signal?: AbortSignal;
}): Promise<{
  receipt: CaseGraphContentPublicationArchiveReceipt;
  searchIndexManifest: CaseGraphContentSearchIndexManifest;
  searchArchivePointer: CaseGraphContentSearchArchivePointer;
  sourceRegistryPointer: CaseGraphContentSourceRegistryPointer;
}> => {
  if (params.signal?.aborted) fail('case_graph_content_publication_archive_aborted');
  const searchIndex = buildCaseGraphContentSearchIndex({
    publication: params.publication,
    discoveryManifest: params.discoveryManifest,
    assets: params.assets,
    accountingReceipt: params.accountingReceipt,
    extractions: params.extractions,
    maximumEntriesPerShard: params.maximumEntriesPerShard,
  });
  const searchArchivePointer = await archiveCaseGraphContentSearchIndex({
    ...searchIndex,
    archive: params.archive,
    signal: params.signal,
  });
  if (params.signal?.aborted) fail('case_graph_content_publication_archive_aborted');
  const sourceRegistryPointer = await archiveCaseGraphContentSourceRegistryFromAccounting({
    publication: params.publication,
    discoveryManifest: params.discoveryManifest,
    assets: params.assets,
    accountingReceipt: params.accountingReceipt,
    extractions: params.extractions.map(({ contract, receipt, chunks }) => ({ contract, receipt, chunks })),
    archive: params.archive,
    signal: params.signal,
  });
  const receiptCore = {
    recordType: 'case_graph_content_publication_archive_receipt' as const,
    schemaVersion: CASE_GRAPH_CONTENT_PUBLICATION_ARCHIVE_VERSION,
    publication: params.publication,
    accountingReceiptDigest: params.accountingReceipt.receiptDigest,
    searchIndexManifestDigest: searchIndex.manifest.manifestDigest,
    searchArchivePointerDigest: searchArchivePointer.pointerDigest,
    sourceRegistryPointerDigest: sourceRegistryPointer.pointerDigest,
    terminalAssetCount: params.accountingReceipt.terminalAssetCount,
    searchableEntryCount: searchIndex.manifest.entryCount,
  };
  return {
    receipt: { ...receiptCore, receiptDigest: relationshipInputSha256(receiptCore) },
    searchIndexManifest: searchIndex.manifest,
    searchArchivePointer,
    sourceRegistryPointer,
  };
};
