import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getCaseGraphPostingFragmentKeys } from './archiveKeys';
import {
  CASE_GRAPH_POSTING_VERSION,
  getCaseGraphReducerShard,
  type CaseGraphPostingFragment,
} from './candidateRouting';

export const CASE_GRAPH_POSTING_ARCHIVE_SCHEMA_VERSION = 1 as const;

export type CaseGraphPostingFragmentManifest = {
  record_type: 'case_graph_posting_fragment_manifest';
  schema_version: typeof CASE_GRAPH_POSTING_ARCHIVE_SCHEMA_VERSION;
  posting_version: typeof CASE_GRAPH_POSTING_VERSION;
  corpus_version: string;
  input_part_number: number;
  reducer_shard: number;
  reducer_shard_count: number;
  archive_key: string;
  manifest_key: string;
  record_count: number;
  posting_count: number;
  first_signature: string;
  last_signature: string;
  uncompressed_bytes: number;
  compressed_bytes: number;
  compressed_sha256: string;
};

const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const assertFragment = (fragment: CaseGraphPostingFragment) => {
  if (
    fragment.version !== CASE_GRAPH_POSTING_VERSION
    || !fragment.corpusVersion
    || !Number.isSafeInteger(fragment.inputPartNumber)
    || fragment.inputPartNumber < 0
    || !Number.isSafeInteger(fragment.reducerShard)
    || fragment.reducerShard < 0
    || !Number.isSafeInteger(fragment.reducerShardCount)
    || fragment.reducerShardCount < 1
    || fragment.reducerShard >= fragment.reducerShardCount
    || !fragment.records.length
    || !fragment.postings.length
  ) throw new Error('case_graph_posting_fragment_invalid');
  const caseIds = new Set<string>();
  let previousCaseId = '';
  for (const record of fragment.records) {
    if (
      !record.caseId
      || record.corpusVersion !== fragment.corpusVersion
      || record.caseId <= previousCaseId
      || caseIds.has(record.caseId)
    ) throw new Error('case_graph_posting_fragment_records_invalid');
    caseIds.add(record.caseId);
    previousCaseId = record.caseId;
  }
  let previousPostingKey = '';
  for (const posting of fragment.postings) {
    const record = fragment.records[posting.recordIndex];
    const postingKey = `${posting.signature}\u0000${record?.caseId || ''}`;
    if (
      !record
      || !posting.signature
      || getCaseGraphReducerShard(posting.signature, fragment.reducerShardCount) !== fragment.reducerShard
      || postingKey < previousPostingKey
    ) throw new Error('case_graph_posting_fragment_postings_invalid');
    previousPostingKey = postingKey;
  }
};

export const buildCaseGraphPostingFragmentArchive = (fragment: CaseGraphPostingFragment) => {
  assertFragment(fragment);
  const uncompressed = Buffer.from(`${JSON.stringify(fragment)}\n`);
  if (uncompressed.length > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('case_graph_posting_fragment_uncompressed_limit_exceeded');
  }
  const archiveBody = gzipSync(uncompressed, { level: 6 });
  if (archiveBody.length > MAX_COMPRESSED_BYTES) {
    throw new Error('case_graph_posting_fragment_compressed_limit_exceeded');
  }
  const keys = getCaseGraphPostingFragmentKeys(
    fragment.corpusVersion,
    fragment.inputPartNumber,
    fragment.reducerShard,
  );
  const manifest: CaseGraphPostingFragmentManifest = {
    record_type: 'case_graph_posting_fragment_manifest',
    schema_version: CASE_GRAPH_POSTING_ARCHIVE_SCHEMA_VERSION,
    posting_version: CASE_GRAPH_POSTING_VERSION,
    corpus_version: fragment.corpusVersion,
    input_part_number: fragment.inputPartNumber,
    reducer_shard: fragment.reducerShard,
    reducer_shard_count: fragment.reducerShardCount,
    archive_key: keys.archiveKey,
    manifest_key: keys.manifestKey,
    record_count: fragment.records.length,
    posting_count: fragment.postings.length,
    first_signature: fragment.postings[0].signature,
    last_signature: fragment.postings.at(-1)!.signature,
    uncompressed_bytes: uncompressed.length,
    compressed_bytes: archiveBody.length,
    compressed_sha256: sha256(archiveBody),
  };
  return {
    archiveBody,
    manifest,
    manifestBody: Buffer.from(`${JSON.stringify(manifest)}\n`),
  };
};

export const decodeCaseGraphPostingFragmentArchive = (
  archiveBody: Buffer,
  manifest: CaseGraphPostingFragmentManifest,
) => {
  if (sha256(archiveBody) !== manifest.compressed_sha256 || archiveBody.length !== manifest.compressed_bytes) {
    throw new Error('case_graph_posting_fragment_checksum_mismatch');
  }
  const uncompressed = gunzipSync(archiveBody, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  if (uncompressed.length !== manifest.uncompressed_bytes) {
    throw new Error('case_graph_posting_fragment_size_mismatch');
  }
  const parsed = JSON.parse(uncompressed.toString('utf8')) as CaseGraphPostingFragment;
  assertFragment(parsed);
  const rebuilt = buildCaseGraphPostingFragmentArchive(parsed).manifest;
  if (JSON.stringify(rebuilt) !== JSON.stringify(manifest)) {
    throw new Error('case_graph_posting_fragment_manifest_mismatch');
  }
  return parsed;
};
