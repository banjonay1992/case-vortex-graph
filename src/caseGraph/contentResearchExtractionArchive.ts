import { createHash } from 'node:crypto';

import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import {
  verifyCaseGraphContentAsset,
  verifyCaseGraphContentChunk,
  verifyCaseGraphContentExtractionContract,
  verifyCaseGraphContentExtractionReceipt,
  type CaseGraphContentAsset,
  type CaseGraphContentChunk,
  type CaseGraphContentExtractionContract,
  type CaseGraphContentExtractionReceipt,
} from './contentResearchArchive';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const CASE_GRAPH_CONTENT_EXTRACTION_ARCHIVE_VERSION = 'case-graph-content-extraction-archive-v1' as const;

export type CaseGraphContentExtractionArchivePointer = {
  recordType: 'case_graph_content_extraction_archive_pointer';
  schemaVersion: typeof CASE_GRAPH_CONTENT_EXTRACTION_ARCHIVE_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  assetId: string;
  assetDigest: string;
  extractionContractDigest: string;
  contractObjectKey: string;
  contractObjectSha256: string;
  chunksObjectKey: string;
  chunksObjectSha256: string;
  receiptObjectKey: string;
  receiptObjectSha256: string;
  chunkCount: number;
  chunkSetSha256: string;
  pointerDigest: string;
};

const bytesOf = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const persist = async (params: {
  archive: CaseGraphContentImmutableArchive;
  key: string;
  body: Buffer;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) throw new Error('case_graph_content_extraction_archive_aborted');
  const digest = sha256(params.body);
  await params.archive.putIfAbsent({
    key: params.key,
    body: params.body,
    contentType: 'application/json',
    signal: params.signal,
  });
  const observed = await params.archive.readObject(params.key, {
    maxBytes: params.body.byteLength,
    signal: params.signal,
  });
  if (!observed || observed.byteLength !== params.body.byteLength || sha256(observed) !== digest) {
    throw new Error('case_graph_content_extraction_archive_read_after_write_mismatch');
  }
  return digest;
};

export const archiveCaseGraphContentExtraction = async (params: {
  asset: CaseGraphContentAsset;
  contract: CaseGraphContentExtractionContract;
  receipt: CaseGraphContentExtractionReceipt;
  chunks: CaseGraphContentChunk[];
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<CaseGraphContentExtractionArchivePointer> => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const contract = verifyCaseGraphContentExtractionContract({ value: params.contract, asset });
  const chunks = params.chunks
    .map((value) => verifyCaseGraphContentChunk({ value, asset, contract }))
    .sort((left, right) => left.ordinal - right.ordinal);
  const receipt = verifyCaseGraphContentExtractionReceipt({
    value: params.receipt,
    asset,
    contract,
    chunks,
  });
  const prefix = [
    'case-vortex/content-extractions',
    asset.publication.manifestSha256,
    asset.assetDigest,
    contract.contractDigest,
  ].join('/');
  const contractObjectKey = `${prefix}/contract.json`;
  const chunksObjectKey = `${prefix}/chunks.json`;
  const receiptObjectKey = `${prefix}/receipt.json`;
  const [contractObjectSha256, chunksObjectSha256, receiptObjectSha256] = await Promise.all([
    persist({ archive: params.archive, key: contractObjectKey, body: bytesOf(contract), signal: params.signal }),
    persist({ archive: params.archive, key: chunksObjectKey, body: bytesOf(chunks), signal: params.signal }),
    persist({ archive: params.archive, key: receiptObjectKey, body: bytesOf(receipt), signal: params.signal }),
  ]);
  const withoutDigest = {
    recordType: 'case_graph_content_extraction_archive_pointer' as const,
    schemaVersion: CASE_GRAPH_CONTENT_EXTRACTION_ARCHIVE_VERSION,
    publication: asset.publication,
    assetId: asset.assetId,
    assetDigest: asset.assetDigest,
    extractionContractDigest: contract.contractDigest,
    contractObjectKey,
    contractObjectSha256,
    chunksObjectKey,
    chunksObjectSha256,
    receiptObjectKey,
    receiptObjectSha256,
    chunkCount: receipt.chunkCount,
    chunkSetSha256: receipt.chunkSetSha256,
  };
  return { ...withoutDigest, pointerDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentExtractionArchivePointer = (params: {
  value: CaseGraphContentExtractionArchivePointer;
  asset: CaseGraphContentAsset;
  contract: CaseGraphContentExtractionContract;
  receipt: CaseGraphContentExtractionReceipt;
}) => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const contract = verifyCaseGraphContentExtractionContract({ value: params.contract, asset });
  const value = params.value;
  const expectedPrefix = [
    'case-vortex/content-extractions', asset.publication.manifestSha256,
    asset.assetDigest, contract.contractDigest,
  ].join('/');
  const withoutDigest = {
    recordType: 'case_graph_content_extraction_archive_pointer' as const,
    schemaVersion: CASE_GRAPH_CONTENT_EXTRACTION_ARCHIVE_VERSION,
    publication: asset.publication,
    assetId: asset.assetId,
    assetDigest: asset.assetDigest,
    extractionContractDigest: contract.contractDigest,
    contractObjectKey: `${expectedPrefix}/contract.json`,
    contractObjectSha256: value.contractObjectSha256,
    chunksObjectKey: `${expectedPrefix}/chunks.json`,
    chunksObjectSha256: value.chunksObjectSha256,
    receiptObjectKey: `${expectedPrefix}/receipt.json`,
    receiptObjectSha256: value.receiptObjectSha256,
    chunkCount: params.receipt.chunkCount,
    chunkSetSha256: params.receipt.chunkSetSha256,
  };
  const digests = [
    withoutDigest.contractObjectSha256,
    withoutDigest.chunksObjectSha256,
    withoutDigest.receiptObjectSha256,
  ];
  if (digests.some((digest) => !/^[a-f0-9]{64}$/.test(digest))
    || relationshipInputSha256(value) !== relationshipInputSha256({
      ...withoutDigest, pointerDigest: relationshipInputSha256(withoutDigest),
    })) {
    throw new Error('case_graph_content_extraction_archive_pointer_integrity_failed');
  }
  return { ...withoutDigest, pointerDigest: relationshipInputSha256(withoutDigest) };
};
