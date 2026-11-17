import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  mkdir,
  mkdtemp,
  open,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import {
  buildClaimExtractionSourceSegmentFromResearchContent,
  verifyClaimExtractionSourceSegment,
  type ClaimExtractionSourceSegment,
} from './claimEvidenceExtraction';
import {
  CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY,
  type ClaimEvidenceBackfillContentSource,
  type ClaimEvidenceBackfillSourceMetadata,
} from './claimEvidenceFullCorpusBackfill';
import type { ClaimEvidencePublicationBinding } from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type {
  CaseGraphResearchContentEntry,
  CaseGraphResearchPublicationBinding,
} from './researchToolContract';

export const CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_VERSION =
  'case-graph-claim-evidence-segment-materializer-v1' as const;
export const CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY = Object.freeze({
  defaultPageSize: 128,
  maximumPageSize: 256,
  defaultSortChunkBytes: 32 * 1024 * 1024,
  minimumSortChunkBytes: 1 * 1024 * 1024,
  maximumSortChunkBytes: 128 * 1024 * 1024,
  maximumSortChunks: 128,
  maximumSegmentLineBytes: 512 * 1024,
  outputOrdering: 'segment_digest_bytewise_v1',
} as const);

export type ClaimEvidenceSegmentMaterializationReceipt = {
  recordType: 'case_graph_claim_evidence_segment_materialization_receipt';
  schemaVersion: typeof CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  indexManifestDigest: string;
  sourceMetadataResolverVersion: string;
  sourceEntryCount: number;
  processedEntryCount: number;
  segmentCount: number;
  pageCount: number;
  segmentSetSha256: string;
  outputSha256: string;
  outputBytes: number;
  policy: typeof CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY;
  receiptDigest: string;
};

type SortRow = { key: string; raw: string };
type HeapEntry = SortRow & { iterator: AsyncIterator<SortRow> };
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const claimBindingFor = (
  publication: CaseGraphResearchPublicationBinding,
): ClaimEvidencePublicationBinding => ({
  publicationId: publication.publicationId,
  corpusVersion: publication.corpusVersion,
  manifestSha256: publication.manifestSha256,
  snapshotId: publication.snapshotId,
  graphArtifactSetSha256: publication.graphArtifactSetSha256,
});
const requireCount = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code);
  return Number(value);
};
const requireDigest = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code);
  return value as string;
};
const requireVersion = (value: unknown) => {
  if (typeof value !== 'string' || !ID.test(value)) {
    fail('claim_segment_materializer_resolver_version_invalid');
  }
  return value as string;
};
const writeAll = async (handle: FileHandle, value: string) => {
  const bytes = Buffer.from(value, 'utf8');
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten < 1) fail('claim_segment_materializer_write_failed');
    offset += result.bytesWritten;
  }
};
const publishNoReplace = async (temporaryPath: string, finalPath: string) => {
  await link(temporaryPath, finalPath);
  await rm(temporaryPath, { force: true });
};
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const exactKeys = (value: object, expected: readonly string[]) => {
  const observed = Object.keys(value).sort();
  if (!same(observed, [...expected].sort())) {
    fail('claim_segment_materializer_receipt_invalid');
  }
};

const writeChunk = async (directory: string, ordinal: number, rows: SortRow[]) => {
  rows.sort((left, right) => compare(left.key, right.key));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.key === rows[index]!.key) {
      fail('claim_segment_materializer_segment_duplicate');
    }
  }
  const path = join(directory, `segment-chunk-${String(ordinal).padStart(4, '0')}.jsonl`);
  await writeFile(path, `${rows.map(({ raw }) => raw).join('\n')}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return path;
};

const sortedChunkRows = async function* (path: string): AsyncGenerator<SortRow> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of lines) {
      if (!raw.length || Buffer.byteLength(raw, 'utf8')
        > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumSegmentLineBytes) {
        fail('claim_segment_materializer_chunk_invalid');
      }
      let value: unknown;
      try { value = JSON.parse(raw); } catch { fail('claim_segment_materializer_chunk_invalid'); }
      const segment = verifyClaimExtractionSourceSegment(
        value as ClaimExtractionSourceSegment,
      );
      yield { key: segment.segmentDigest, raw };
    }
  } finally {
    lines.close();
    input.destroy();
  }
};

const heapPush = (heap: HeapEntry[], value: HeapEntry) => {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]!.key <= value.key) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = value;
};
const heapPop = (heap: HeapEntry[]) => {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || !heap.length) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.key < heap[left]!.key ? right : left;
    if (heap[child]!.key >= last.key) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = last;
  return first;
};

const mergeChunks = async (params: {
  chunkPaths: string[];
  temporaryOutputPath: string;
  expectedCount: number;
  signal?: AbortSignal;
}) => {
  const output = await open(params.temporaryOutputPath, 'wx', 0o600);
  const heap: HeapEntry[] = [];
  const outputHash = createHash('sha256');
  const setHash = createHash('sha256');
  setHash.update('[');
  let previous = '';
  let count = 0;
  let outputBytes = 0;
  try {
    for (const path of params.chunkPaths) {
      const iterator = sortedChunkRows(path)[Symbol.asyncIterator]();
      const next = await iterator.next();
      if (!next.done) heapPush(heap, { ...next.value, iterator });
    }
    while (heap.length) {
      if (params.signal?.aborted) fail('claim_segment_materializer_aborted');
      const current = heapPop(heap)!;
      if (current.key === previous) fail('claim_segment_materializer_segment_duplicate');
      previous = current.key;
      const line = `${current.raw}\n`;
      await writeAll(output, line);
      outputHash.update(line);
      outputBytes += Buffer.byteLength(line, 'utf8');
      if (count) setHash.update(',');
      setHash.update(JSON.stringify(current.key));
      count += 1;
      const next = await current.iterator.next();
      if (!next.done) heapPush(heap, { ...next.value, iterator: current.iterator });
    }
    if (count !== params.expectedCount) fail('claim_segment_materializer_accounting_invalid');
    setHash.update(']');
    await output.sync();
    return {
      segmentCount: count,
      segmentSetSha256: setHash.digest('hex'),
      outputSha256: outputHash.digest('hex'),
      outputBytes,
    };
  } finally {
    await output.close();
  }
};

export const materializeClaimEvidenceSourceSegments = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  contentSource: ClaimEvidenceBackfillContentSource;
  resolveSourceMetadata: (
    entry: CaseGraphResearchContentEntry
  ) => ClaimEvidenceBackfillSourceMetadata;
  sourceMetadataResolverVersion: string;
  outputJsonlPath: string;
  pageSize?: number;
  sortChunkBytes?: number;
  temporaryDirectory?: string;
  signal?: AbortSignal;
}): Promise<ClaimEvidenceSegmentMaterializationReceipt> => {
  const pageSize = params.pageSize
    ?? CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.defaultPageSize;
  const sortChunkBytes = params.sortChunkBytes
    ?? CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.defaultSortChunkBytes;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1
    || pageSize > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumPageSize) {
    fail('claim_segment_materializer_page_size_invalid');
  }
  if (!Number.isSafeInteger(sortChunkBytes)
    || sortChunkBytes < CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.minimumSortChunkBytes
    || sortChunkBytes > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumSortChunkBytes) {
    fail('claim_segment_materializer_sort_chunk_invalid');
  }
  const resolverVersion = requireVersion(params.sourceMetadataResolverVersion);
  const destination = resolve(params.outputJsonlPath);
  await mkdir(dirname(destination), { recursive: true });
  const temporaryRoot = params.temporaryDirectory
    ? resolve(params.temporaryDirectory) : tmpdir();
  await mkdir(temporaryRoot, { recursive: true });
  const work = await mkdtemp(join(temporaryRoot, 'claim-segment-materializer-'));
  const temporaryOutputPath = join(
    dirname(destination),
    `.${basename(destination)}.tmp-${basename(work)}`,
  );
  const claimBinding = claimBindingFor(params.publication);
  const chunkPaths: string[] = [];
  let rows: SortRow[] = [];
  let rowBytes = 0;
  let cursor: string | null = null;
  let priorChunkId = '';
  let expectedEntryCount: number | null = null;
  let indexManifestDigest: string | null = null;
  let processedEntryCount = 0;
  let pageCount = 0;

  try {
    while (true) {
      if (params.signal?.aborted) fail('claim_segment_materializer_aborted');
      if (pageCount >= CLAIM_EVIDENCE_FULL_CORPUS_BACKFILL_POLICY.maximumPages) {
        fail('claim_segment_materializer_page_limit_exceeded');
      }
      const page = await params.contentSource.readPage({
        publication: params.publication,
        cursor,
        limit: pageSize,
        signal: params.signal,
      });
      pageCount += 1;
      if (!page || !Array.isArray(page.entries) || page.entries.length > pageSize) {
        fail('claim_segment_materializer_page_invalid');
      }
      const total = requireCount(
        page.totalEntryCount,
        'claim_segment_materializer_accounting_invalid',
      );
      const manifest = requireDigest(
        page.indexManifestDigest,
        'claim_segment_materializer_manifest_invalid',
      );
      if (expectedEntryCount === null) expectedEntryCount = total;
      if (indexManifestDigest === null) indexManifestDigest = manifest;
      if (expectedEntryCount !== total || indexManifestDigest !== manifest) {
        fail('claim_segment_materializer_source_changed');
      }
      if (!page.entries.length && page.nextCursor !== null) {
        fail('claim_segment_materializer_empty_page_with_cursor');
      }
      for (const entry of page.entries) {
        if (typeof entry.chunkId !== 'string' || entry.chunkId <= priorChunkId) {
          fail('claim_segment_materializer_content_order_invalid');
        }
        priorChunkId = entry.chunkId;
        const segment = buildClaimExtractionSourceSegmentFromResearchContent({
          binding: claimBinding,
          entry,
          ...params.resolveSourceMetadata(entry),
        });
        const raw = canonicalizeRelationshipInput(segment);
        const bytes = Buffer.byteLength(raw, 'utf8') + 1;
        if (bytes > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumSegmentLineBytes) {
          fail('claim_segment_materializer_segment_too_large');
        }
        rows.push({ key: segment.segmentDigest, raw });
        rowBytes += bytes;
        processedEntryCount += 1;
        if (rowBytes >= sortChunkBytes) {
          chunkPaths.push(await writeChunk(work, chunkPaths.length, rows));
          rows = [];
          rowBytes = 0;
          if (chunkPaths.length
            > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumSortChunks) {
            fail('claim_segment_materializer_sort_budget_exceeded');
          }
        }
      }
      const nextCursor = page.nextCursor;
      if (nextCursor === null) break;
      if (typeof nextCursor !== 'string' || !nextCursor.length
        || nextCursor !== page.entries.at(-1)?.chunkId || nextCursor === cursor) {
        fail('claim_segment_materializer_cursor_invalid');
      }
      cursor = nextCursor;
    }
    if (rows.length) chunkPaths.push(await writeChunk(work, chunkPaths.length, rows));
    if (chunkPaths.length > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumSortChunks) {
      fail('claim_segment_materializer_sort_budget_exceeded');
    }
    if (expectedEntryCount === null || indexManifestDigest === null
      || processedEntryCount !== expectedEntryCount) {
      fail('claim_segment_materializer_incomplete_corpus');
    }
    const output = await mergeChunks({
      chunkPaths,
      temporaryOutputPath,
      expectedCount: expectedEntryCount,
      signal: params.signal,
    });
    await publishNoReplace(temporaryOutputPath, destination);
    const core = {
      recordType: 'case_graph_claim_evidence_segment_materialization_receipt' as const,
      schemaVersion: CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_VERSION,
      publication: params.publication,
      indexManifestDigest,
      sourceMetadataResolverVersion: resolverVersion,
      sourceEntryCount: expectedEntryCount,
      processedEntryCount,
      segmentCount: output.segmentCount,
      pageCount,
      segmentSetSha256: output.segmentSetSha256,
      outputSha256: output.outputSha256,
      outputBytes: output.outputBytes,
      policy: CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY,
    };
    return { ...core, receiptDigest: relationshipInputSha256(core) };
  } finally {
    await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const verifyClaimEvidenceSegmentMaterializationReceipt = async (params: {
  receipt: ClaimEvidenceSegmentMaterializationReceipt;
  outputJsonlPath: string;
  expectedPublication?: CaseGraphResearchPublicationBinding;
  signal?: AbortSignal;
}): Promise<ClaimEvidenceSegmentMaterializationReceipt> => {
  const value = params.receipt as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('claim_segment_materializer_receipt_invalid');
  }
  const receipt = value as ClaimEvidenceSegmentMaterializationReceipt;
  exactKeys(receipt, [
    'recordType', 'schemaVersion', 'publication', 'indexManifestDigest',
    'sourceMetadataResolverVersion', 'sourceEntryCount', 'processedEntryCount',
    'segmentCount', 'pageCount', 'segmentSetSha256', 'outputSha256',
    'outputBytes', 'policy', 'receiptDigest',
  ]);
  if (receipt.recordType !== 'case_graph_claim_evidence_segment_materialization_receipt'
    || receipt.schemaVersion !== CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_VERSION
    || !same(receipt.policy, CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY)) {
    fail('claim_segment_materializer_receipt_invalid');
  }
  requireDigest(receipt.indexManifestDigest, 'claim_segment_materializer_receipt_invalid');
  requireDigest(receipt.segmentSetSha256, 'claim_segment_materializer_receipt_invalid');
  requireDigest(receipt.outputSha256, 'claim_segment_materializer_receipt_invalid');
  requireDigest(receipt.receiptDigest, 'claim_segment_materializer_receipt_invalid');
  requireVersion(receipt.sourceMetadataResolverVersion);
  const sourceEntryCount = requireCount(
    receipt.sourceEntryCount,
    'claim_segment_materializer_receipt_invalid',
  );
  const processedEntryCount = requireCount(
    receipt.processedEntryCount,
    'claim_segment_materializer_receipt_invalid',
  );
  const segmentCount = requireCount(
    receipt.segmentCount,
    'claim_segment_materializer_receipt_invalid',
  );
  const pageCount = requireCount(
    receipt.pageCount,
    'claim_segment_materializer_receipt_invalid',
  );
  const outputBytes = requireCount(
    receipt.outputBytes,
    'claim_segment_materializer_receipt_invalid',
  );
  if (sourceEntryCount !== processedEntryCount
    || sourceEntryCount !== segmentCount || pageCount < 1
    || (segmentCount === 0 ? outputBytes !== 0 : outputBytes < segmentCount * 2)) {
    fail('claim_segment_materializer_receipt_invalid');
  }
  if (params.expectedPublication && !same(
    receipt.publication,
    params.expectedPublication,
  )) {
    fail('claim_segment_materializer_publication_mismatch');
  }
  const { receiptDigest, ...core } = receipt;
  if (relationshipInputSha256(core) !== receiptDigest) {
    fail('claim_segment_materializer_receipt_digest_mismatch');
  }

  const input = createReadStream(resolve(params.outputJsonlPath), { encoding: 'utf8' });
  const initialFile = await stat(resolve(params.outputJsonlPath));
  const lines = createInterface({ input, crlfDelay: Infinity });
  const outputHash = createHash('sha256');
  const setHash = createHash('sha256');
  const binding = claimBindingFor(receipt.publication);
  setHash.update('[');
  let previous = '';
  let count = 0;
  let bytes = 0;
  try {
    for await (const raw of lines) {
      if (params.signal?.aborted) fail('claim_segment_materializer_aborted');
      if (!raw.length || Buffer.byteLength(raw, 'utf8')
        > CLAIM_EVIDENCE_SEGMENT_MATERIALIZER_POLICY.maximumSegmentLineBytes) {
        fail('claim_segment_materializer_output_invalid');
      }
      let decoded: unknown;
      try { decoded = JSON.parse(raw); } catch {
        fail('claim_segment_materializer_output_invalid');
      }
      const segment = verifyClaimExtractionSourceSegment(
        decoded as ClaimExtractionSourceSegment,
      );
      if (!same(segment.binding, binding)
        || (previous && compare(previous, segment.segmentDigest) >= 0)) {
        fail('claim_segment_materializer_output_invalid');
      }
      previous = segment.segmentDigest;
      const line = `${raw}\n`;
      outputHash.update(line);
      bytes += Buffer.byteLength(line, 'utf8');
      if (count) setHash.update(',');
      setHash.update(JSON.stringify(segment.segmentDigest));
      count += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  setHash.update(']');
  const finalFile = await stat(resolve(params.outputJsonlPath));
  if (initialFile.dev !== finalFile.dev || initialFile.ino !== finalFile.ino
    || initialFile.size !== finalFile.size || finalFile.size !== outputBytes
    || count !== segmentCount || bytes !== outputBytes
    || outputHash.digest('hex') !== receipt.outputSha256
    || setHash.digest('hex') !== receipt.segmentSetSha256) {
    fail('claim_segment_materializer_output_receipt_mismatch');
  }
  return receipt;
};
