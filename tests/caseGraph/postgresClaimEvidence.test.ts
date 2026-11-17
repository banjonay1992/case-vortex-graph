import { describe, expect, it, vi } from 'vitest';

import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceLink,
  buildSourceReliabilityAssessment,
} from '../../src/caseGraph/claimEvidenceGraph';
import {
  createPostgresCaseGraphClaimEvidenceProvider,
  inspectCaseGraphClaimEvidenceServing,
  type CaseGraphClaimEvidencePostgresQuery,
} from '../../src/caseGraph/postgresClaimEvidence';
import { caseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';
import type { ActiveCaseGraphPublication } from '../../src/caseGraph/publicAccess';

const active = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  manifest: {
    lineage: {
      snapshot: { snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222' },
      graph: { artifactSetSha256: 'b'.repeat(64) },
      relationship: {
        policyVersion: 'policy-v1', policySha256: 'c'.repeat(64), modelId: 'model',
        modelVersion: 'model-v1', modelSha256: 'd'.repeat(64), calibrationSetSha256: 'e'.repeat(64),
      },
      calibration: { set: { calibrationSetSha256: 'e'.repeat(64) } },
    },
    models: { relationshipSchemaVersion: 'relationship-v1' },
  },
} as ActiveCaseGraphPublication;

const publication = caseGraphResearchPublicationBinding(active);
const binding = {
  publicationId: publication.publicationId,
  corpusVersion: publication.corpusVersion,
  manifestSha256: publication.manifestSha256,
  snapshotId: publication.snapshotId,
  graphArtifactSetSha256: publication.graphArtifactSetSha256,
};

const claim = buildAtomicEvidenceClaim({
  binding, address: 'document:origin', sourceId: 'origin', subject: 'Witness', predicate: 'observed',
  object: 'a light', polarity: 'asserted', modality: 'reported', sourceText: 'Witness observed a light.',
  locator: { kind: 'document_page', pageNumber: 1, characterStart: 0, characterEnd: 25, boundingBox: null },
  extraction: { method: 'manual_review', version: 'review-v1', confidence: 1, reviewStatus: 'reviewed' },
});
const related = buildAtomicEvidenceClaim({
  binding, address: 'document:copy', sourceId: 'copy', subject: 'Witness', predicate: 'observed',
  object: 'a light', polarity: 'asserted', modality: 'reported', sourceText: 'A catalogue repeated the witness account.',
  locator: { kind: 'record_field', field: 'summary', characterStart: 0, characterEnd: 41 },
  extraction: { method: 'manual_review', version: 'review-v1', confidence: 1, reviewStatus: 'reviewed' },
});
const link = buildClaimEvidenceLink({
  binding, fromClaimId: related.claimId, toClaimId: claim.claimId, stance: 'repeats', lineage: 'shared_lineage',
  rationale: 'The catalogue attributes its text to the origin record.', confidence: 1,
  determination: { method: 'manual_review', version: 'review-v1', reviewStatus: 'reviewed' },
});
const assessment = buildSourceReliabilityAssessment({
  binding, address: claim.address, sourceId: 'origin', sourceLabel: 'Origin source', lineageId: 'origin',
  dimensions: {
    sourcePosition: { value: 'primary', reasonCodes: ['direct_report'], explanation: 'Direct report.' },
    contemporaneity: { value: 'unknown', reasonCodes: ['date_unknown'], explanation: 'Date unknown.' },
    witnessIdentity: { value: 'named', reasonCodes: ['named'], explanation: 'Witness named.' },
    originality: { value: 'original', reasonCodes: ['original'], explanation: 'Original record.' },
    independence: { value: 'independent', reasonCodes: ['origin'], explanation: 'Originating lineage.' },
    provenance: { value: 'partial', reasonCodes: ['partial'], explanation: 'Partial archive chain.' },
    corroboration: { value: 'shared_lineage_only', reasonCodes: ['copy_only'], explanation: 'Only a copy is linked.', independentSourceCount: 0, sharedLineageSourceCount: 1 },
  },
  limitations: ['Not a truth score.'],
  assessedBy: { method: 'manual_review', version: 'review-v1', reviewStatus: 'reviewed' },
});

const claimRow = (value: typeof claim) => ({
  claim_id: value.claimId, claim_digest: value.claimDigest, address: value.address, source_id: value.sourceId,
  subject: value.subject, predicate: value.predicate, object_text: value.object, polarity: value.polarity,
  modality: value.modality, source_text: value.sourceText, source_text_sha256: value.sourceTextSha256,
  locator: value.locator, extraction_method: value.extraction.method, extraction_version: value.extraction.version,
  extraction_confidence: value.extraction.confidence, review_status: value.extraction.reviewStatus,
});
const linkRow = () => ({
  link_id: link.linkId, link_digest: link.linkDigest, from_claim_id: link.fromClaimId,
  to_claim_id: link.toClaimId, stance: link.stance, lineage: link.lineage, rationale: link.rationale,
  confidence: link.confidence, determination_method: link.determination.method,
  determination_version: link.determination.version, review_status: link.determination.reviewStatus,
});
const assessmentRow = () => ({
  assessment_id: assessment.assessmentId, assessment_digest: assessment.assessmentDigest,
  address: assessment.address, source_id: assessment.sourceId, source_label: assessment.sourceLabel,
  lineage_id: assessment.lineageId, source_position: assessment.dimensions.sourcePosition.value,
  contemporaneity: assessment.dimensions.contemporaneity.value,
  witness_identity: assessment.dimensions.witnessIdentity.value, originality: assessment.dimensions.originality.value,
  independence: assessment.dimensions.independence.value, provenance: assessment.dimensions.provenance.value,
  corroboration: assessment.dimensions.corroboration.value,
  independent_source_count: assessment.dimensions.corroboration.independentSourceCount,
  shared_lineage_source_count: assessment.dimensions.corroboration.sharedLineageSourceCount,
  dimensions: assessment.dimensions, overall_category: assessment.overall.category,
  overall_reason_codes: assessment.overall.reasonCodes, overall_explanation: assessment.overall.explanation,
  limitations: assessment.limitations, assessment_method: assessment.assessedBy.method,
  assessment_version: assessment.assessedBy.version, review_status: assessment.assessedBy.reviewStatus,
});
const buildRow = () => ({
  publication_id: publication.publicationId, public_manifest_sha256: publication.manifestSha256,
  graph_artifact_set_sha256: publication.graphArtifactSetSha256, claim_artifact_sha256: '1'.repeat(64),
  schema_version: 'case-graph-claim-evidence-v1', reliability_schema_version: 'case-graph-source-reliability-v1',
  expected_claim_count: '2', expected_link_count: '1', expected_assessment_count: '1',
  indexed_claim_count: '2', indexed_link_count: '1', indexed_assessment_count: '1',
  completion_receipt_sha256: '2'.repeat(64), status: 'verified',
});

describe('PostgreSQL claim evidence serving', () => {
  it('preflights an exact verified publication and returns digest-checked claims, links and ledger rows', async () => {
    const query: CaseGraphClaimEvidencePostgresQuery = vi.fn(async (sql, params) => {
      if (sql.includes('FROM public.case_graph_claim_evidence_builds')) return { rows: [buildRow()] };
      if (sql.includes('FROM public.case_graph_claim_links')) return { rows: [linkRow()] };
      if (sql.includes('FROM public.case_graph_source_reliability_assessments')) return { rows: [assessmentRow()] };
      if (sql.includes('claim_id = ANY')) return { rows: [claimRow(related)] };
      if (sql.includes('FROM public.case_graph_atomic_claims') && params[1] === claim.address) {
        return { rows: [claimRow(claim)] };
      }
      throw new Error('unexpected_query');
    });
    const inspection = await inspectCaseGraphClaimEvidenceServing({ active, query });
    const provider = createPostgresCaseGraphClaimEvidenceProvider({ query, inspection });
    const result = await provider.inspectClaims({ publication, address: claim.address, limit: 10 });
    expect(result).toMatchObject({
      artifactDigest: '1'.repeat(64), completionReceiptSha256: '2'.repeat(64), hasMore: false,
      claims: [{ claimId: claim.claimId }], relatedClaims: [{ claimId: related.claimId }],
      links: [{ linkId: link.linkId, stance: 'repeats', lineage: 'shared_lineage' }],
      sourceReliability: [{ assessmentId: assessment.assessmentId }],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('status'), [publication.publicationId], expect.objectContaining({ statementTimeoutMs: 5_000 }));
  });

  it('fails closed on publication mismatch and digest-tampered rows', async () => {
    const unavailable: CaseGraphClaimEvidencePostgresQuery = async () => ({ rows: [{
      ...buildRow(), public_manifest_sha256: 'f'.repeat(64),
    }] });
    await expect(inspectCaseGraphClaimEvidenceServing({ active, query: unavailable }))
      .rejects.toThrow('case_graph_research_claim_evidence_unavailable');

    const query: CaseGraphClaimEvidencePostgresQuery = async (sql) => {
      if (sql.includes('FROM public.case_graph_claim_evidence_builds')) return { rows: [buildRow()] };
      if (sql.includes('FROM public.case_graph_atomic_claims')) return { rows: [{ ...claimRow(claim), claim_digest: 'f'.repeat(64) }] };
      return { rows: [] };
    };
    const inspection = await inspectCaseGraphClaimEvidenceServing({ active, query });
    const provider = createPostgresCaseGraphClaimEvidenceProvider({ query, inspection });
    await expect(provider.inspectClaims({ publication, address: claim.address, limit: 10 }))
      .rejects.toThrow('case_graph_claim_evidence_row_invalid');
  });
});
