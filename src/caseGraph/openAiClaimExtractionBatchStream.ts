import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  link,
  open,
  rm,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  buildOpenAiClaimExtractionBatchRequestLine,
  openAiClaimExtractionBatchCustomId,
  OPENAI_CLAIM_EXTRACTION_BATCH_POLICY,
  OPENAI_CLAIM_EXTRACTION_BATCH_VERSION,
  verifyOpenAiClaimExtractionBatchManifest,
  type OpenAiClaimExtractionBatchManifest,
} from './openAiClaimExtractionBatch';
import {
  verifyClaimExtractionSourceSegment,
  type ClaimExtractionProposalDraft,
  type ClaimExtractionSourceSegment,
} from './claimEvidenceExtraction';
import {
  decodeOpenAiClaimExtractionResponseBody,
  OPENAI_CLAIM_EXTRACTION_MODEL,
  OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST,
} from './openAiClaimExtractionProposer';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import { canonicalizeRelationshipInput } from './relationshipInputSnapshot';

export const OPENAI_CLAIM_EXTRACTION_STREAM_VERSION =
  'case-graph-openai-claim-extraction-stream-v1' as const;
export const OPENAI_CLAIM_EXTRACTION_STREAM_POLICY = Object.freeze({
  maximumInputLineBytes: 512 * 1024,
  defaultSortChunkBytes: 32 * 1024 * 1024,
  minimumSortChunkBytes: 1 * 1024 * 1024,
  maximumSortChunkBytes: 128 * 1024 * 1024,
  maximumSortChunks: 128,
} as const);

export type OpenAiClaimExtractionStreamImportReceipt = {
  recordType: 'case_graph_openai_claim_extraction_stream_import_receipt';
  schemaVersion: typeof OPENAI_CLAIM_EXTRACTION_STREAM_VERSION;
  binding: import('./claimEvidenceGraph').ClaimEvidencePublicationBinding;
  batchManifestSha256: string;
  modelId: string;
  promptDigest: string;
  segmentCount: number;
  proposalCount: number;
  zeroProposalSegmentCount: number;
  inputSegmentSetSha256: string;
  providerOutputSha256: string;
  candidateOutputSha256: string;
  candidateOutputBytes: number;
  receiptSha256: string;
};

const fail = (code: string): never => { throw new Error(code); };
const SHA256 = /^[a-f0-9]{64}$/u;
const sha256File = async (path: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};
const writeAll = async (handle: FileHandle, bytes: Buffer | string) => {
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await handle.write(buffer, offset, buffer.byteLength - offset);
    if (result.bytesWritten < 1) fail('claim_extraction_stream_write_failed');
    offset += result.bytesWritten;
  }
};
const publishNoReplace = async (temporaryPath: string, finalPath: string) => {
  await link(temporaryPath, finalPath);
  await rm(temporaryPath, { force: true });
};

export const verifyOpenAiClaimExtractionStreamImportReceipt = (
  value: OpenAiClaimExtractionStreamImportReceipt,
): OpenAiClaimExtractionStreamImportReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.recordType !== 'case_graph_openai_claim_extraction_stream_import_receipt'
    || value.schemaVersion !== OPENAI_CLAIM_EXTRACTION_STREAM_VERSION
    || !value.binding || typeof value.binding !== 'object'
    || !SHA256.test(value.batchManifestSha256)
    || typeof value.modelId !== 'string' || !value.modelId.length
    || !SHA256.test(value.promptDigest)
    || !Number.isSafeInteger(value.segmentCount) || value.segmentCount < 1
    || !Number.isSafeInteger(value.proposalCount) || value.proposalCount < 0
    || !Number.isSafeInteger(value.zeroProposalSegmentCount)
    || value.zeroProposalSegmentCount < 0
    || value.zeroProposalSegmentCount > value.segmentCount
    || !SHA256.test(value.inputSegmentSetSha256)
    || !SHA256.test(value.providerOutputSha256)
    || !SHA256.test(value.candidateOutputSha256)
    || !Number.isSafeInteger(value.candidateOutputBytes)
    || value.candidateOutputBytes < value.segmentCount * 2
    || !SHA256.test(value.receiptSha256)) {
    fail('claim_extraction_stream_receipt_invalid');
  }
  const { receiptSha256, ...core } = value;
  if (relationshipInputSha256(core) !== receiptSha256) {
    fail('claim_extraction_stream_receipt_digest_mismatch');
  }
  return value;
};

const jsonLines = async function* (
  path: string,
  code: string,
): AsyncGenerator<{ raw: string; value: Record<string, unknown> }> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of lines) {
      if (!raw.length || Buffer.byteLength(raw, 'utf8')
        > OPENAI_CLAIM_EXTRACTION_STREAM_POLICY.maximumInputLineBytes) fail(code);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { fail(code); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(code);
      yield { raw, value: parsed as Record<string, unknown> };
    }
  } finally {
    lines.close();
    input.destroy();
  }
};

const segmentLines = async function* (path: string) {
  let previous = '';
  for await (const { value } of jsonLines(path, 'claim_extraction_stream_segment_invalid')) {
    const segment = verifyClaimExtractionSourceSegment(
      value as unknown as ClaimExtractionSourceSegment,
    );
    if (previous && segment.segmentDigest <= previous) {
      fail(segment.segmentDigest === previous
        ? 'claim_extraction_batch_segment_duplicate'
        : 'claim_extraction_stream_segments_not_sorted');
    }
    previous = segment.segmentDigest;
    yield segment;
  }
};

const inputSetHasher = () => {
  const hash = createHash('sha256');
  let count = 0;
  hash.update('[');
  return {
    add(digest: string) {
      if (count) hash.update(',');
      hash.update(JSON.stringify(digest));
      count += 1;
    },
    finish() {
      hash.update(']');
      return { count, digest: hash.digest('hex') };
    },
  };
};

export const streamOpenAiClaimExtractionBatchExport = async (params: {
  segmentsJsonlPath: string;
  outputDirectory: string;
  modelId?: string;
  maximumRequestsPerFile?: number;
  maximumBytesPerFile?: number;
}): Promise<{ manifest: OpenAiClaimExtractionBatchManifest; manifestPath: string }> => {
  const modelId = params.modelId ?? OPENAI_CLAIM_EXTRACTION_MODEL;
  const maximumRequestsPerFile = params.maximumRequestsPerFile
    ?? OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.safeMaximumRequestsPerFile;
  const maximumBytesPerFile = params.maximumBytesPerFile
    ?? OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.safeMaximumBytesPerFile;
  if (!Number.isSafeInteger(maximumRequestsPerFile) || maximumRequestsPerFile < 1
    || maximumRequestsPerFile
      > OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.providerMaximumRequestsPerFile
    || !Number.isSafeInteger(maximumBytesPerFile) || maximumBytesPerFile < 1
    || maximumBytesPerFile
      > OPENAI_CLAIM_EXTRACTION_BATCH_POLICY.providerMaximumBytesPerFile) {
    fail('claim_extraction_batch_limits_invalid');
  }
  const outputDirectory = resolve(params.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const inputHash = inputSetHasher();
  const shards: OpenAiClaimExtractionBatchManifest['shards'] = [];
  let handle: FileHandle | null = null;
  let temporaryPath = '';
  let finalPath = '';
  let requestCount = 0;
  let byteLength = 0;
  let bodyHash = createHash('sha256');
  let firstCustomId = '';
  let lastCustomId = '';
  const publishedPaths: string[] = [];
  let binding: ClaimExtractionSourceSegment['binding'] | null = null;

  const beginShard = async () => {
    const ordinal = shards.length;
    finalPath = join(outputDirectory, `claim-extraction-${String(ordinal).padStart(5, '0')}.jsonl`);
    temporaryPath = `${finalPath}.tmp-${process.pid}`;
    handle = await open(temporaryPath, 'wx', 0o600);
    requestCount = 0;
    byteLength = 0;
    bodyHash = createHash('sha256');
    firstCustomId = '';
    lastCustomId = '';
  };
  const finishShard = async () => {
    if (!handle || !requestCount) return;
    await handle.sync();
    await handle.close();
    handle = null;
    await publishNoReplace(temporaryPath, finalPath);
    publishedPaths.push(finalPath);
    shards.push({
      ordinal: shards.length,
      requestCount,
      byteLength,
      sha256: bodyHash.digest('hex'),
      firstCustomId,
      lastCustomId,
    });
  };

  try {
    for await (const segment of segmentLines(resolve(params.segmentsJsonlPath))) {
      if (binding === null) binding = segment.binding;
      else if (canonicalizeRelationshipInput(binding)
        !== canonicalizeRelationshipInput(segment.binding)) {
        fail('claim_extraction_stream_publication_mismatch');
      }
      const line = buildOpenAiClaimExtractionBatchRequestLine(segment, modelId);
      if (line.byteLength > maximumBytesPerFile) {
        fail('claim_extraction_batch_request_too_large');
      }
      if (!handle) await beginShard();
      if (requestCount >= maximumRequestsPerFile
        || byteLength + line.byteLength > maximumBytesPerFile) {
        await finishShard();
        await beginShard();
      }
      const writableHandle = handle as unknown as FileHandle | null;
      if (!writableHandle) fail('claim_extraction_stream_write_failed');
      await writeAll(writableHandle!, line);
      bodyHash.update(line);
      const id = openAiClaimExtractionBatchCustomId(segment.segmentDigest);
      if (!firstCustomId) firstCustomId = id;
      lastCustomId = id;
      requestCount += 1;
      byteLength += line.byteLength;
      inputHash.add(segment.segmentDigest);
    }
    await finishShard();
  } catch (error) {
    const danglingHandle = handle as unknown as FileHandle | null;
    if (danglingHandle) await danglingHandle.close().catch(() => undefined);
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    await Promise.all(publishedPaths.map(
      (path) => rm(path, { force: true }).catch(() => undefined),
    ));
    throw error;
  }

  const input = inputHash.finish();
  if (!binding) fail('claim_extraction_stream_segments_empty');
  const publicationBinding = binding as ClaimExtractionSourceSegment['binding'];
  const core = {
    recordType: 'case_graph_openai_claim_extraction_batch_manifest' as const,
    schemaVersion: OPENAI_CLAIM_EXTRACTION_BATCH_VERSION,
    binding: publicationBinding,
    modelId,
    promptDigest: OPENAI_CLAIM_EXTRACTION_PROMPT_DIGEST,
    segmentCount: input.count,
    shardCount: shards.length,
    requestSetSha256: input.digest,
    shards,
    policy: OPENAI_CLAIM_EXTRACTION_BATCH_POLICY,
  };
  const manifest = { ...core, manifestSha256: relationshipInputSha256(core) };
  const manifestPath = join(outputDirectory, 'manifest.json');
  const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await publishNoReplace(temporaryManifestPath, manifestPath);
  } catch (error) {
    await rm(temporaryManifestPath, { force: true }).catch(() => undefined);
    await Promise.all(publishedPaths.map(
      (path) => rm(path, { force: true }).catch(() => undefined),
    ));
    throw error;
  }
  return { manifest, manifestPath };
};

type SortedLine = { id: string; raw: string };
const outputId = (value: Record<string, unknown>): string => {
  const id = value.custom_id;
  if (typeof id !== 'string'
    || !/^claim-extraction:[a-f0-9]{64}$/u.test(id)) {
    fail('claim_extraction_batch_output_invalid');
  }
  return id as string;
};

const writeSortChunk = async (directory: string, ordinal: number, rows: SortedLine[]) => {
  rows.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.id === rows[index]!.id) fail('claim_extraction_batch_output_invalid');
  }
  const path = join(directory, `chunk-${String(ordinal).padStart(4, '0')}.jsonl`);
  await writeFile(path, `${rows.map(({ raw }) => raw).join('\n')}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return path;
};

type HeapEntry = SortedLine & {
  iterator: AsyncIterator<{ raw: string; value: Record<string, unknown> }>;
};
const heapPush = (heap: HeapEntry[], value: HeapEntry) => {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]!.id <= value.id) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = value;
};
const heapPop = (heap: HeapEntry[]) => {
  const root = heap[0];
  const last = heap.pop();
  if (!root || !last || !heap.length) return root;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.id < heap[left]!.id ? right : left;
    if (heap[child]!.id >= last.id) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = last;
  return root;
};

const externallySortOutput = async (
  outputPath: string,
  directory: string,
  chunkBytes: number,
) => {
  const chunks: string[] = [];
  let rows: SortedLine[] = [];
  let bytes = 0;
  for await (const { raw, value } of jsonLines(
    outputPath,
    'claim_extraction_batch_output_invalid',
  )) {
    rows.push({ id: outputId(value), raw });
    bytes += Buffer.byteLength(raw, 'utf8') + 1;
    if (bytes >= chunkBytes) {
      chunks.push(await writeSortChunk(directory, chunks.length, rows));
      rows = [];
      bytes = 0;
      if (chunks.length > OPENAI_CLAIM_EXTRACTION_STREAM_POLICY.maximumSortChunks) {
        fail('claim_extraction_stream_sort_budget_exceeded');
      }
    }
  }
  if (rows.length) chunks.push(await writeSortChunk(directory, chunks.length, rows));
  if (chunks.length > OPENAI_CLAIM_EXTRACTION_STREAM_POLICY.maximumSortChunks) {
    fail('claim_extraction_stream_sort_budget_exceeded');
  }
  const sortedPath = join(directory, 'provider-output-sorted.jsonl');
  const output = await open(sortedPath, 'wx', 0o600);
  const heap: HeapEntry[] = [];
  try {
    for (const path of chunks) {
      const iterator = jsonLines(path, 'claim_extraction_batch_output_invalid')[Symbol.asyncIterator]();
      const next = await iterator.next();
      if (!next.done) heapPush(heap, {
        id: outputId(next.value.value),
        raw: next.value.raw,
        iterator,
      });
    }
    let previous = '';
    while (heap.length) {
      const current = heapPop(heap)!;
      if (current.id === previous) fail('claim_extraction_batch_output_invalid');
      previous = current.id;
      await writeAll(output, `${current.raw}\n`);
      const next = await current.iterator.next();
      if (!next.done) heapPush(heap, {
        id: outputId(next.value.value),
        raw: next.value.raw,
        iterator: current.iterator,
      });
    }
    await output.sync();
  } finally {
    await output.close();
  }
  return sortedPath;
};

const decodeOutputValue = (
  value: Record<string, unknown>,
  segment: ClaimExtractionSourceSegment,
): ClaimExtractionProposalDraft[] => {
  if (value.error != null || !value.response || typeof value.response !== 'object'
    || Array.isArray(value.response)) fail('claim_extraction_batch_output_invalid');
  const response = value.response as Record<string, unknown>;
  if (response.status_code !== 200 || !response.body
    || typeof response.body !== 'object' || Array.isArray(response.body)) {
    fail('claim_extraction_batch_output_failed');
  }
  return decodeOpenAiClaimExtractionResponseBody(
    response.body as Record<string, unknown>,
    segment,
  );
};

export const streamOpenAiClaimExtractionBatchImport = async (params: {
  segmentsJsonlPath: string;
  providerOutputJsonlPath: string;
  candidateOutputJsonlPath: string;
  batchManifest: OpenAiClaimExtractionBatchManifest;
  temporaryDirectory?: string;
  sortChunkBytes?: number;
}): Promise<OpenAiClaimExtractionStreamImportReceipt> => {
  const manifest = verifyOpenAiClaimExtractionBatchManifest(params.batchManifest);
  const sortChunkBytes = params.sortChunkBytes
    ?? OPENAI_CLAIM_EXTRACTION_STREAM_POLICY.defaultSortChunkBytes;
  if (!Number.isSafeInteger(sortChunkBytes)
    || sortChunkBytes < OPENAI_CLAIM_EXTRACTION_STREAM_POLICY.minimumSortChunkBytes
    || sortChunkBytes > OPENAI_CLAIM_EXTRACTION_STREAM_POLICY.maximumSortChunkBytes) {
    fail('claim_extraction_stream_sort_chunk_invalid');
  }
  const destination = resolve(params.candidateOutputJsonlPath);
  if ([params.segmentsJsonlPath, params.providerOutputJsonlPath]
    .map((path) => resolve(path)).includes(destination)) {
    fail('claim_extraction_stream_paths_conflict');
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporaryRoot = params.temporaryDirectory
    ? resolve(params.temporaryDirectory)
    : tmpdir();
  await mkdir(temporaryRoot, { recursive: true });
  const work = await mkdtemp(join(temporaryRoot, 'claim-extraction-import-'));
  const temporaryDestination = join(
    dirname(destination),
    `.${basename(destination)}.tmp-${process.pid}`,
  );
  let destinationHandle: FileHandle | null = null;
  try {
    const sortedOutput = await externallySortOutput(
      resolve(params.providerOutputJsonlPath),
      work,
      sortChunkBytes,
    );
    const outputIterator = jsonLines(
      sortedOutput,
      'claim_extraction_batch_output_invalid',
    )[Symbol.asyncIterator]();
    let output = await outputIterator.next();
    destinationHandle = await open(temporaryDestination, 'wx', 0o600);
    const candidateHash = createHash('sha256');
    const setHash = inputSetHasher();
    let proposalCount = 0;
    let zeroProposalSegmentCount = 0;
    let candidateOutputBytes = 0;

    for await (const segment of segmentLines(resolve(params.segmentsJsonlPath))) {
      if (output.done) fail('claim_extraction_batch_output_incomplete');
      const expectedId = openAiClaimExtractionBatchCustomId(segment.segmentDigest);
      const actualId = outputId(output.value.value);
      if (actualId !== expectedId) {
        fail(actualId < expectedId
          ? 'claim_extraction_batch_output_invalid'
          : 'claim_extraction_batch_output_incomplete');
      }
      const proposals = decodeOutputValue(output.value.value, segment);
      const line = `${JSON.stringify({ segmentDigest: segment.segmentDigest, proposals })}\n`;
      await writeAll(destinationHandle, line);
      candidateHash.update(line);
      candidateOutputBytes += Buffer.byteLength(line, 'utf8');
      proposalCount += proposals.length;
      if (!proposals.length) zeroProposalSegmentCount += 1;
      setHash.add(segment.segmentDigest);
      output = await outputIterator.next();
    }
    if (!output.done) fail('claim_extraction_batch_output_invalid');
    await destinationHandle.sync();
    await destinationHandle.close();
    destinationHandle = null;
    await publishNoReplace(temporaryDestination, destination);
    const input = setHash.finish();
    if (input.count !== manifest.segmentCount
      || input.digest !== manifest.requestSetSha256) {
      fail('claim_extraction_stream_manifest_mismatch');
    }
    const core = {
      recordType: 'case_graph_openai_claim_extraction_stream_import_receipt' as const,
      schemaVersion: OPENAI_CLAIM_EXTRACTION_STREAM_VERSION,
      binding: manifest.binding,
      batchManifestSha256: manifest.manifestSha256,
      modelId: manifest.modelId,
      promptDigest: manifest.promptDigest,
      segmentCount: input.count,
      proposalCount,
      zeroProposalSegmentCount,
      inputSegmentSetSha256: input.digest,
      providerOutputSha256: await sha256File(resolve(params.providerOutputJsonlPath)),
      candidateOutputSha256: candidateHash.digest('hex'),
      candidateOutputBytes,
    };
    return { ...core, receiptSha256: relationshipInputSha256(core) };
  } finally {
    if (destinationHandle) await destinationHandle.close().catch(() => undefined);
    await rm(temporaryDestination, { force: true }).catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
};
