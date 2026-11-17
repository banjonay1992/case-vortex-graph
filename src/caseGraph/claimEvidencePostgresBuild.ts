import { createHash } from 'node:crypto';

import {
  archiveClaimEvidenceGraph,
  verifyClaimEvidenceArchive,
  type ClaimEvidenceArchiveManifest,
  type ClaimEvidenceArchivePointer,
  type ClaimEvidenceArchiveShard,
} from './claimEvidenceArchive';
import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';
import {
  verifyClaimEvidenceGraphArtifact,
  type AtomicEvidenceClaim,
  type ClaimEvidenceGraphArtifact,
  type ClaimEvidenceLink,
  type SourceReliabilityAssessment,
} from './claimEvidenceGraph';
import type { CaseGraphClaimEvidencePostgresQuery } from './postgresClaimEvidence';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_BUILD_VERSION = 'case-graph-claim-evidence-postgres-build-v1' as const;
export const CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_VERSION = '0209_case_graph_claim_evidence_ledger_2026_07_20.sql' as const;
export const CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_SHA256 = 'b0e8bd026491aa88ca9ee8dfcfa80a484672b0cad23cbeb0d4d908cbebfbf4d1' as const;

export type ClaimEvidencePostgresCompletionReceipt = {
  recordType: 'case_graph_claim_evidence_postgres_completion_receipt';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_BUILD_VERSION;
  migrationVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_VERSION;
  migrationSha256: typeof CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_SHA256;
  publication: ClaimEvidenceGraphArtifact['binding'];
  artifactDigest: string;
  archiveManifestDigest: string;
  archivePointerDigest: string;
  claimCount: number;
  linkCount: number;
  sourceAssessmentCount: number;
  claimSetSha256: string;
  linkSetSha256: string;
  assessmentSetSha256: string;
  dbClaimSetSha256: string;
  dbLinkSetSha256: string;
  dbAssessmentSetSha256: string;
  receiptDigest: string;
};

export type ClaimEvidencePostgresBuildResult = {
  artifact: ClaimEvidenceGraphArtifact;
  manifest: ClaimEvidenceArchiveManifest;
  shards: ClaimEvidenceArchiveShard[];
  pointer: ClaimEvidenceArchivePointer;
  completionReceipt: ClaimEvidencePostgresCompletionReceipt;
  completionReceiptKey: string;
  completionReceiptSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const BATCH_SIZE = 4_096;
const TIMEOUT_MS = 30_000;
const fail = (code: string): never => { throw new Error(code); };
const options = (signal?: AbortSignal) => ({
  statementTimeoutMs: TIMEOUT_MS,
  queryTimeoutMs: TIMEOUT_MS,
  signal,
});
const bytes = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail('case_graph_research_aborted');
};
const one = (rows: Record<string, unknown>[], code: string) => {
  if (rows.length !== 1) fail(code);
  return rows[0];
};
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0 || Number(numeric) > maximum) {
    fail('claim_evidence_postgres_build_result_invalid');
  }
  return Number(numeric);
};

const claimRow = (claim: AtomicEvidenceClaim) => ({
  claim_id: claim.claimId,
  claim_digest: claim.claimDigest,
  address: claim.address,
  source_id: claim.sourceId,
  subject: claim.subject,
  predicate: claim.predicate,
  object_text: claim.object,
  polarity: claim.polarity,
  modality: claim.modality,
  source_text: claim.sourceText,
  source_text_sha256: claim.sourceTextSha256,
  locator: claim.locator,
  extraction_method: claim.extraction.method,
  extraction_version: claim.extraction.version,
  extraction_confidence: claim.extraction.confidence,
  review_status: claim.extraction.reviewStatus,
});

const linkRow = (link: ClaimEvidenceLink) => ({
  link_id: link.linkId,
  link_digest: link.linkDigest,
  from_claim_id: link.fromClaimId,
  to_claim_id: link.toClaimId,
  stance: link.stance,
  lineage: link.lineage,
  rationale: link.rationale,
  confidence: link.confidence,
  determination_method: link.determination.method,
  determination_version: link.determination.version,
  review_status: link.determination.reviewStatus,
});

const assessmentRow = (assessment: SourceReliabilityAssessment) => ({
  assessment_id: assessment.assessmentId,
  assessment_digest: assessment.assessmentDigest,
  address: assessment.address,
  source_id: assessment.sourceId,
  source_label: assessment.sourceLabel,
  lineage_id: assessment.lineageId,
  source_position: assessment.dimensions.sourcePosition.value,
  contemporaneity: assessment.dimensions.contemporaneity.value,
  witness_identity: assessment.dimensions.witnessIdentity.value,
  originality: assessment.dimensions.originality.value,
  independence: assessment.dimensions.independence.value,
  provenance: assessment.dimensions.provenance.value,
  corroboration: assessment.dimensions.corroboration.value,
  independent_source_count: assessment.dimensions.corroboration.independentSourceCount,
  shared_lineage_source_count: assessment.dimensions.corroboration.sharedLineageSourceCount,
  dimensions: assessment.dimensions,
  overall_category: assessment.overall.category,
  overall_reason_codes: assessment.overall.reasonCodes,
  overall_explanation: assessment.overall.explanation,
  limitations: assessment.limitations,
  assessment_method: assessment.assessedBy.method,
  assessment_version: assessment.assessedBy.version,
  review_status: assessment.assessedBy.reviewStatus,
});

const forBatches = async <T>(params: {
  entries: T[];
  run: (batch: T[]) => Promise<number>;
  signal?: AbortSignal;
}) => {
  let ingested = 0;
  for (let offset = 0; offset < params.entries.length; offset += BATCH_SIZE) {
    abort(params.signal);
    const batch = params.entries.slice(offset, offset + BATCH_SIZE);
    const observed = await params.run(batch);
    if (observed !== batch.length) fail('claim_evidence_postgres_build_batch_accounting_mismatch');
    ingested += observed;
  }
  return ingested;
};

const completionCore = (params: {
  artifact: ClaimEvidenceGraphArtifact;
  manifest: ClaimEvidenceArchiveManifest;
  pointer: ClaimEvidenceArchivePointer;
}) => ({
  recordType: 'case_graph_claim_evidence_postgres_completion_receipt' as const,
  schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_BUILD_VERSION,
  migrationVersion: CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_VERSION,
  migrationSha256: CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_SHA256,
  publication: params.artifact.binding,
  artifactDigest: params.artifact.artifactDigest,
  archiveManifestDigest: params.manifest.manifestDigest,
  archivePointerDigest: params.pointer.pointerDigest,
  claimCount: params.manifest.claimCount,
  linkCount: params.manifest.linkCount,
  sourceAssessmentCount: params.manifest.sourceAssessmentCount,
  claimSetSha256: params.manifest.claimSetSha256,
  linkSetSha256: params.manifest.linkSetSha256,
  assessmentSetSha256: params.manifest.assessmentSetSha256,
  dbClaimSetSha256: params.manifest.claimSetSha256,
  dbLinkSetSha256: params.manifest.linkSetSha256,
  dbAssessmentSetSha256: params.manifest.assessmentSetSha256,
});

export const makeClaimEvidencePostgresCompletionReceipt = (params: {
  artifact: ClaimEvidenceGraphArtifact;
  manifest: ClaimEvidenceArchiveManifest;
  shards: ClaimEvidenceArchiveShard[];
  pointer: ClaimEvidenceArchivePointer;
}): ClaimEvidencePostgresCompletionReceipt => {
  const verified = verifyClaimEvidenceArchive({
    artifact: params.artifact,
    manifest: params.manifest,
    shards: params.shards,
    pointer: params.pointer,
  });
  const core = completionCore(verified);
  return { ...core, receiptDigest: relationshipInputSha256(core) };
};

export const verifyClaimEvidencePostgresCompletionReceipt = (params: {
  value: ClaimEvidencePostgresCompletionReceipt;
  artifact: ClaimEvidenceGraphArtifact;
  manifest: ClaimEvidenceArchiveManifest;
  shards: ClaimEvidenceArchiveShard[];
  pointer: ClaimEvidenceArchivePointer;
}) => {
  const expected = makeClaimEvidencePostgresCompletionReceipt(params);
  if (canonicalizeRelationshipInput(params.value) !== canonicalizeRelationshipInput(expected)) {
    fail('claim_evidence_postgres_completion_receipt_invalid');
  }
  return expected;
};

const persistCompletionReceipt = async (params: {
  archive: CaseGraphContentImmutableArchive;
  pointer: ClaimEvidenceArchivePointer;
  receipt: ClaimEvidencePostgresCompletionReceipt;
  signal?: AbortSignal;
}) => {
  const key = params.pointer.manifestObjectKey.replace(/\/manifest\.json$/, '/_complete.receipt.json');
  if (key === params.pointer.manifestObjectKey) fail('claim_evidence_postgres_completion_key_invalid');
  const body = bytes(params.receipt);
  const bodyDigest = sha256(body);
  await params.archive.putIfAbsent({ key, body, contentType: 'application/json', signal: params.signal });
  const observed = await params.archive.readObject(key, { maxBytes: body.byteLength, signal: params.signal });
  if (!observed || observed.byteLength !== body.byteLength || sha256(observed) !== bodyDigest) {
    fail('claim_evidence_postgres_completion_read_after_write_mismatch');
  }
  return { key, sha256: bodyDigest };
};

export const materializeClaimEvidencePostgresBuild = async (params: {
  artifact: ClaimEvidenceGraphArtifact;
  archive: CaseGraphContentImmutableArchive;
  query: CaseGraphClaimEvidencePostgresQuery;
  leaseSeconds?: number;
  signal?: AbortSignal;
}): Promise<ClaimEvidencePostgresBuildResult> => {
  abort(params.signal);
  const artifact = verifyClaimEvidenceGraphArtifact(params.artifact);
  const archived = await archiveClaimEvidenceGraph({ artifact, archive: params.archive, signal: params.signal });
  verifyClaimEvidenceArchive(archived);
  const leaseSeconds = params.leaseSeconds ?? 300;
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    fail('claim_evidence_postgres_build_lease_duration_invalid');
  }
  const leaseRow = one((await params.query(`
    SELECT * FROM public.create_case_graph_claim_evidence_build(
      $1::uuid,$2::text,$3::text,$4::text,$5::bigint,$6::bigint,$7::bigint,
      $8::text,$9::text,$10::text,$11::integer
    )
  `, [
    artifact.binding.publicationId,
    artifact.binding.manifestSha256,
    artifact.binding.graphArtifactSetSha256,
    artifact.artifactDigest,
    archived.manifest.claimCount,
    archived.manifest.linkCount,
    archived.manifest.sourceAssessmentCount,
    archived.manifest.claimSetSha256,
    archived.manifest.linkSetSha256,
    archived.manifest.assessmentSetSha256,
    leaseSeconds,
  ], options(params.signal))).rows, 'claim_evidence_postgres_build_lease_invalid');
  const leaseToken = leaseRow.lease_token;
  if (typeof leaseToken !== 'string' || !UUID.test(leaseToken)) {
    fail('claim_evidence_postgres_build_lease_invalid');
  }
  let verified = false;
  try {
    const claimCount = await forBatches({
      entries: artifact.claims.map(claimRow), signal: params.signal,
      run: async (batch) => integer(one((await params.query(`
        SELECT public.ingest_case_graph_atomic_claim_batch($1::uuid,$2::uuid,$3::jsonb)
          AS ingested_count
      `, [artifact.binding.publicationId, leaseToken, JSON.stringify(batch)], options(params.signal))).rows,
      'claim_evidence_postgres_build_claim_ingest_invalid').ingested_count, BATCH_SIZE),
    });
    const linkCount = await forBatches({
      entries: artifact.links.map(linkRow), signal: params.signal,
      run: async (batch) => integer(one((await params.query(`
        SELECT public.ingest_case_graph_claim_link_batch($1::uuid,$2::uuid,$3::jsonb)
          AS ingested_count
      `, [artifact.binding.publicationId, leaseToken, JSON.stringify(batch)], options(params.signal))).rows,
      'claim_evidence_postgres_build_link_ingest_invalid').ingested_count, BATCH_SIZE),
    });
    const assessmentCount = await forBatches({
      entries: artifact.sourceReliability.map(assessmentRow), signal: params.signal,
      run: async (batch) => integer(one((await params.query(`
        SELECT public.ingest_case_graph_source_reliability_batch($1::uuid,$2::uuid,$3::jsonb)
          AS ingested_count
      `, [artifact.binding.publicationId, leaseToken, JSON.stringify(batch)], options(params.signal))).rows,
      'claim_evidence_postgres_build_assessment_ingest_invalid').ingested_count, BATCH_SIZE),
    });
    if (claimCount !== artifact.claims.length || linkCount !== artifact.links.length
      || assessmentCount !== artifact.sourceReliability.length) {
      fail('claim_evidence_postgres_build_accounting_mismatch');
    }
    const completionReceipt = makeClaimEvidencePostgresCompletionReceipt({
      artifact, manifest: archived.manifest, shards: archived.shards, pointer: archived.pointer,
    });
    const completion = await persistCompletionReceipt({
      archive: params.archive,
      pointer: archived.pointer,
      receipt: completionReceipt,
      signal: params.signal,
    });
    await params.query(`
      SELECT public.verify_case_graph_claim_evidence_build(
        $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text
      )
    `, [
      artifact.binding.publicationId,
      leaseToken,
      archived.manifest.claimSetSha256,
      archived.manifest.linkSetSha256,
      archived.manifest.assessmentSetSha256,
      completion.key,
      completion.sha256,
    ], options(params.signal));
    verified = true;
    return {
      artifact,
      manifest: archived.manifest,
      shards: archived.shards,
      pointer: archived.pointer,
      completionReceipt,
      completionReceiptKey: completion.key,
      completionReceiptSha256: completion.sha256,
    };
  } catch (error) {
    if (!verified) {
      try {
        await params.query(`
          SELECT public.fail_case_graph_claim_evidence_build($1::uuid,$2::uuid,$3::text)
        `, [artifact.binding.publicationId, leaseToken, 'materialization_failed'], options());
      } catch {
        // Preserve the originating failure; an expired lease remains safely
        // invisible and can be audited independently.
      }
    }
    throw error;
  }
};
