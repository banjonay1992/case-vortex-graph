import { createHash } from 'node:crypto';

import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  CASE_GRAPH_CLAIM_EVIDENCE_VERSION,
  verifyClaimEvidenceGraphArtifact,
  type AtomicEvidenceClaim,
  type ClaimEvidenceGraphArtifact,
  type ClaimEvidenceLink,
  type ClaimEvidencePublicationBinding,
  type SourceReliabilityAssessment,
} from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION = 'case-graph-claim-evidence-archive-v1' as const;
export const CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_MAX_ENTRIES_PER_SHARD = 4_096;

export type ClaimEvidenceArchiveShardKind = 'claim' | 'link' | 'source_reliability';
type ClaimEvidenceArchiveEntry = AtomicEvidenceClaim | ClaimEvidenceLink | SourceReliabilityAssessment;

export type ClaimEvidenceArchiveShard = {
  recordType: 'case_graph_claim_evidence_archive_shard';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION;
  publication: ClaimEvidencePublicationBinding;
  artifactDigest: string;
  shardKind: ClaimEvidenceArchiveShardKind;
  shardNumber: number;
  entries: ClaimEvidenceArchiveEntry[];
  entryCount: number;
  entrySetSha256: string;
  shardDigest: string;
};

export type ClaimEvidenceArchiveShardSummary = {
  shardKind: ClaimEvidenceArchiveShardKind;
  shardNumber: number;
  objectKey: string;
  objectSha256: string;
  shardDigest: string;
  entryCount: number;
  entrySetSha256: string;
};

export type ClaimEvidenceArchiveManifest = {
  recordType: 'case_graph_claim_evidence_archive_manifest';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION;
  claimSchemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_VERSION;
  publication: ClaimEvidencePublicationBinding;
  artifactDigest: string;
  claimCount: number;
  linkCount: number;
  sourceAssessmentCount: number;
  claimSetSha256: string;
  linkSetSha256: string;
  assessmentSetSha256: string;
  shardCount: number;
  shardSetSha256: string;
  shards: ClaimEvidenceArchiveShardSummary[];
  manifestDigest: string;
};

export type ClaimEvidenceArchivePointer = {
  recordType: 'case_graph_claim_evidence_archive_pointer';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION;
  publication: ClaimEvidencePublicationBinding;
  artifactDigest: string;
  manifestObjectKey: string;
  manifestObjectSha256: string;
  manifestDigest: string;
  shardCount: number;
  shardSetSha256: string;
  pointerDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const body = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const bodySha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;

const digestForEntry = (entry: ClaimEvidenceArchiveEntry) => {
  if (entry.recordType === 'case_graph_atomic_claim') return entry.claimDigest;
  if (entry.recordType === 'case_graph_claim_link') return entry.linkDigest;
  return entry.assessmentDigest;
};

const idForEntry = (entry: ClaimEvidenceArchiveEntry) => {
  if (entry.recordType === 'case_graph_atomic_claim') return entry.claimId;
  if (entry.recordType === 'case_graph_claim_link') return entry.linkId;
  return entry.assessmentId;
};

const makeShard = (params: {
  publication: ClaimEvidencePublicationBinding;
  artifactDigest: string;
  shardKind: ClaimEvidenceArchiveShardKind;
  shardNumber: number;
  entries: ClaimEvidenceArchiveEntry[];
}): ClaimEvidenceArchiveShard => {
  const entries = [...params.entries].sort((left, right) => compareText(idForEntry(left), idForEntry(right)));
  if (!entries.length || entries.length > CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_MAX_ENTRIES_PER_SHARD) {
    fail('claim_evidence_archive_shard_size_invalid');
  }
  const withoutDigest = {
    recordType: 'case_graph_claim_evidence_archive_shard' as const,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION,
    publication: params.publication,
    artifactDigest: params.artifactDigest,
    shardKind: params.shardKind,
    shardNumber: params.shardNumber,
    entries,
    entryCount: entries.length,
    entrySetSha256: relationshipInputSha256(entries.map(digestForEntry)),
  };
  return { ...withoutDigest, shardDigest: relationshipInputSha256(withoutDigest) };
};

const shardEntries = (params: {
  publication: ClaimEvidencePublicationBinding;
  artifactDigest: string;
  shardKind: ClaimEvidenceArchiveShardKind;
  entries: ClaimEvidenceArchiveEntry[];
}) => {
  const sorted = [...params.entries].sort((left, right) => compareText(idForEntry(left), idForEntry(right)));
  const output: ClaimEvidenceArchiveShard[] = [];
  for (let offset = 0; offset < sorted.length; offset += CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_MAX_ENTRIES_PER_SHARD) {
    output.push(makeShard({
      ...params,
      shardNumber: output.length,
      entries: sorted.slice(offset, offset + CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_MAX_ENTRIES_PER_SHARD),
    }));
  }
  return output;
};

const prefixFor = (artifact: ClaimEvidenceGraphArtifact) => [
  'case-vortex/corpora',
  artifact.binding.corpusVersion,
  'claim-evidence/v1/publications',
  artifact.binding.publicationId,
  artifact.binding.manifestSha256,
].join('/');

const persistImmutable = async (params: {
  archive: CaseGraphContentImmutableArchive;
  key: string;
  value: unknown;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) fail('claim_evidence_archive_aborted');
  const bytes = body(params.value);
  const sha256 = bodySha256(bytes);
  await params.archive.putIfAbsent({
    key: params.key,
    body: bytes,
    contentType: 'application/json',
    signal: params.signal,
  });
  const observed = await params.archive.readObject(params.key, {
    maxBytes: bytes.byteLength,
    signal: params.signal,
  });
  if (!observed || observed.byteLength !== bytes.byteLength || bodySha256(observed) !== sha256) {
    fail('claim_evidence_archive_read_after_write_mismatch');
  }
  return sha256;
};

export const archiveClaimEvidenceGraph = async (params: {
  artifact: ClaimEvidenceGraphArtifact;
  archive: CaseGraphContentImmutableArchive;
  signal?: AbortSignal;
}): Promise<{
  artifact: ClaimEvidenceGraphArtifact;
  manifest: ClaimEvidenceArchiveManifest;
  shards: ClaimEvidenceArchiveShard[];
  pointer: ClaimEvidenceArchivePointer;
}> => {
  const artifact = verifyClaimEvidenceGraphArtifact(params.artifact);
  const prefix = prefixFor(artifact);
  const shards = [
    ...shardEntries({ publication: artifact.binding, artifactDigest: artifact.artifactDigest, shardKind: 'claim', entries: artifact.claims }),
    ...shardEntries({ publication: artifact.binding, artifactDigest: artifact.artifactDigest, shardKind: 'link', entries: artifact.links }),
    ...shardEntries({ publication: artifact.binding, artifactDigest: artifact.artifactDigest, shardKind: 'source_reliability', entries: artifact.sourceReliability }),
  ].sort((left, right) => compareText(`${left.shardKind}:${left.shardNumber}`, `${right.shardKind}:${right.shardNumber}`));

  const summaries: ClaimEvidenceArchiveShardSummary[] = [];
  for (const shard of shards) {
    const objectKey = `${prefix}/shards/${shard.shardKind}-${String(shard.shardNumber).padStart(6, '0')}.json`;
    const objectSha256 = await persistImmutable({
      archive: params.archive, key: objectKey, value: shard, signal: params.signal,
    });
    summaries.push({
      shardKind: shard.shardKind,
      shardNumber: shard.shardNumber,
      objectKey,
      objectSha256,
      shardDigest: shard.shardDigest,
      entryCount: shard.entryCount,
      entrySetSha256: shard.entrySetSha256,
    });
  }
  const manifestCore = {
    recordType: 'case_graph_claim_evidence_archive_manifest' as const,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION,
    claimSchemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_VERSION,
    publication: artifact.binding,
    artifactDigest: artifact.artifactDigest,
    claimCount: artifact.claims.length,
    linkCount: artifact.links.length,
    sourceAssessmentCount: artifact.sourceReliability.length,
    claimSetSha256: relationshipInputSha256(artifact.claims.map((entry) => entry.claimDigest)),
    linkSetSha256: relationshipInputSha256(artifact.links.map((entry) => entry.linkDigest)),
    assessmentSetSha256: relationshipInputSha256(artifact.sourceReliability.map((entry) => entry.assessmentDigest)),
    shardCount: summaries.length,
    shardSetSha256: relationshipInputSha256(summaries.map((entry) => entry.shardDigest)),
    shards: summaries,
  };
  const manifest: ClaimEvidenceArchiveManifest = {
    ...manifestCore,
    manifestDigest: relationshipInputSha256(manifestCore),
  };
  const manifestObjectKey = `${prefix}/manifest.json`;
  const manifestObjectSha256 = await persistImmutable({
    archive: params.archive, key: manifestObjectKey, value: manifest, signal: params.signal,
  });
  const pointerCore = {
    recordType: 'case_graph_claim_evidence_archive_pointer' as const,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_ARCHIVE_VERSION,
    publication: artifact.binding,
    artifactDigest: artifact.artifactDigest,
    manifestObjectKey,
    manifestObjectSha256,
    manifestDigest: manifest.manifestDigest,
    shardCount: manifest.shardCount,
    shardSetSha256: manifest.shardSetSha256,
  };
  const pointer: ClaimEvidenceArchivePointer = {
    ...pointerCore,
    pointerDigest: relationshipInputSha256(pointerCore),
  };
  return { artifact, manifest, shards, pointer };
};

export const verifyClaimEvidenceArchive = (params: {
  artifact: ClaimEvidenceGraphArtifact;
  manifest: ClaimEvidenceArchiveManifest;
  shards: ClaimEvidenceArchiveShard[];
  pointer: ClaimEvidenceArchivePointer;
}) => {
  const artifact = verifyClaimEvidenceGraphArtifact(params.artifact);
  const shards = [...params.shards]
    .sort((left, right) => compareText(`${left.shardKind}:${left.shardNumber}`, `${right.shardKind}:${right.shardNumber}`));
  for (const shard of shards) {
    const rebuilt = makeShard({
      publication: artifact.binding,
      artifactDigest: artifact.artifactDigest,
      shardKind: shard.shardKind,
      shardNumber: shard.shardNumber,
      entries: shard.entries,
    });
    if (canonicalizeRelationshipInput(shard) !== canonicalizeRelationshipInput(rebuilt)) {
      fail('claim_evidence_archive_shard_integrity_failed');
    }
  }
  const prefix = prefixFor(artifact);
  const expectedSummaries = shards.map((shard) => ({
    shardKind: shard.shardKind,
    shardNumber: shard.shardNumber,
    objectKey: `${prefix}/shards/${shard.shardKind}-${String(shard.shardNumber).padStart(6, '0')}.json`,
    objectSha256: bodySha256(body(shard)),
    shardDigest: shard.shardDigest,
    entryCount: shard.entryCount,
    entrySetSha256: shard.entrySetSha256,
  }));
  const expectedShardSet = relationshipInputSha256(params.manifest.shards.map((entry) => entry.shardDigest));
  const { manifestDigest, ...manifestCore } = params.manifest;
  if (params.manifest.publication.publicationId !== artifact.binding.publicationId
    || params.manifest.artifactDigest !== artifact.artifactDigest
    || params.manifest.claimCount !== artifact.claims.length
    || params.manifest.linkCount !== artifact.links.length
    || params.manifest.sourceAssessmentCount !== artifact.sourceReliability.length
    || params.manifest.shardCount !== shards.length
    || canonicalizeRelationshipInput(params.manifest.shards) !== canonicalizeRelationshipInput(expectedSummaries)
    || params.manifest.claimSetSha256 !== relationshipInputSha256(artifact.claims.map((entry) => entry.claimDigest))
    || params.manifest.linkSetSha256 !== relationshipInputSha256(artifact.links.map((entry) => entry.linkDigest))
    || params.manifest.assessmentSetSha256 !== relationshipInputSha256(artifact.sourceReliability.map((entry) => entry.assessmentDigest))
    || params.manifest.shardSetSha256 !== expectedShardSet
    || relationshipInputSha256(manifestCore) !== manifestDigest) {
    fail('claim_evidence_archive_manifest_integrity_failed');
  }
  const { pointerDigest, ...pointerCore } = params.pointer;
  if (params.pointer.manifestDigest !== manifestDigest
    || params.pointer.shardSetSha256 !== params.manifest.shardSetSha256
    || params.pointer.shardCount !== params.manifest.shardCount
    || params.pointer.artifactDigest !== artifact.artifactDigest
    || relationshipInputSha256(pointerCore) !== pointerDigest) {
    fail('claim_evidence_archive_pointer_integrity_failed');
  }
  return { artifact, manifest: params.manifest, shards, pointer: params.pointer };
};
