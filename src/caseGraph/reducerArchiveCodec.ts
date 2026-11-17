import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getCaseGraphPreliminaryReducerKeys } from './archiveKeys';
import { CASE_GRAPH_CANDIDATE_VERSION, type CaseGraphCandidate } from './candidateGeneration';
import type { CaseGraphPostingReduceResult } from './candidateRouting';
import { CASE_GRAPH_POLICY_VERSION, type CaseGraphRelationship } from './relationshipPolicy';

export const CASE_GRAPH_REDUCER_ARCHIVE_SCHEMA_VERSION = 1 as const;

export type CaseGraphPreliminaryReducerManifest = {
  record_type: 'case_graph_preliminary_reducer_manifest';
  schema_version: typeof CASE_GRAPH_REDUCER_ARCHIVE_SCHEMA_VERSION;
  corpus_version: string;
  candidate_version: typeof CASE_GRAPH_CANDIDATE_VERSION;
  relationship_policy_version: typeof CASE_GRAPH_POLICY_VERSION;
  reducer_shard: number;
  reducer_shard_count: number;
  fragment_count: number;
  posting_count: number;
  posting_group_count: number;
  candidate_count: number;
  relationship_count: number;
  rejected_candidate_count: number;
  skipped_groups: CaseGraphPostingReduceResult['manifest']['skippedGroups'];
  manifest_key: string;
  candidates_key: string;
  candidates_compressed_bytes: number;
  candidates_sha256: string;
  relationships_key: string;
  relationships_compressed_bytes: number;
  relationships_sha256: string;
};

const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const ndjsonGzip = (rows: readonly unknown[]) => {
  const raw = Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
  if (raw.length > MAX_OUTPUT_BYTES) throw new Error('case_graph_reducer_output_limit_exceeded');
  return gzipSync(raw, { level: 6 });
};

export const buildCaseGraphPreliminaryReducerArchive = (result: CaseGraphPostingReduceResult) => {
  const candidates = [...result.candidates].sort((left, right) => left.pairKey.localeCompare(right.pairKey));
  const relationships = [...result.relationships].sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  if (
    result.version !== CASE_GRAPH_CANDIDATE_VERSION
    || result.manifest.candidateCount !== candidates.length
    || result.manifest.relationshipCount !== relationships.length
    || result.manifest.rejectedCandidateCount !== candidates.length - relationships.length
  ) throw new Error('case_graph_reducer_result_invalid');
  const keys = getCaseGraphPreliminaryReducerKeys(result.corpusVersion, result.reducerShard);
  const candidatesBody = ndjsonGzip(candidates);
  const relationshipsBody = ndjsonGzip(relationships);
  const manifest: CaseGraphPreliminaryReducerManifest = {
    record_type: 'case_graph_preliminary_reducer_manifest',
    schema_version: CASE_GRAPH_REDUCER_ARCHIVE_SCHEMA_VERSION,
    corpus_version: result.corpusVersion,
    candidate_version: CASE_GRAPH_CANDIDATE_VERSION,
    relationship_policy_version: CASE_GRAPH_POLICY_VERSION,
    reducer_shard: result.reducerShard,
    reducer_shard_count: result.reducerShardCount,
    fragment_count: result.manifest.fragmentCount,
    posting_count: result.manifest.postingCount,
    posting_group_count: result.manifest.postingGroupCount,
    candidate_count: candidates.length,
    relationship_count: relationships.length,
    rejected_candidate_count: result.manifest.rejectedCandidateCount,
    skipped_groups: result.manifest.skippedGroups,
    manifest_key: keys.manifestKey,
    candidates_key: keys.candidatesKey,
    candidates_compressed_bytes: candidatesBody.length,
    candidates_sha256: sha256(candidatesBody),
    relationships_key: keys.relationshipsKey,
    relationships_compressed_bytes: relationshipsBody.length,
    relationships_sha256: sha256(relationshipsBody),
  };
  return {
    candidatesBody,
    relationshipsBody,
    manifest,
    manifestBody: Buffer.from(`${JSON.stringify(manifest)}\n`),
  };
};

const decodeRows = <T>(body: Buffer, expectedHash: string, expectedBytes: number): T[] => {
  if (body.length !== expectedBytes || sha256(body) !== expectedHash) {
    throw new Error('case_graph_reducer_archive_checksum_mismatch');
  }
  const raw = gunzipSync(body, { maxOutputLength: MAX_OUTPUT_BYTES }).toString('utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
};

export const decodeCaseGraphPreliminaryCandidates = (
  body: Buffer,
  manifest: CaseGraphPreliminaryReducerManifest,
) => decodeRows<CaseGraphCandidate>(body, manifest.candidates_sha256, manifest.candidates_compressed_bytes);

export const decodeCaseGraphPreliminaryRelationships = (
  body: Buffer,
  manifest: CaseGraphPreliminaryReducerManifest,
) => decodeRows<CaseGraphRelationship>(
  body,
  manifest.relationships_sha256,
  manifest.relationships_compressed_bytes,
);
