import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceLink,
  buildSourceReliabilityAssessment,
  type AtomicEvidenceClaim,
  type ClaimEvidenceLink,
  type ClaimEvidencePublicationBinding,
  type SourceReliabilityAssessment,
  type SourceReliabilityDimensions,
} from './claimEvidenceGraph';
import type { ActiveCaseGraphPublication } from './publicAccess';
import {
  caseGraphResearchPublicationBinding,
  type CaseGraphResearchClaimEvidenceProvider,
  type CaseGraphResearchPublicationBinding,
} from './researchToolContract';

export const CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_VERSION = 'case-graph-claim-evidence-postgres-v1' as const;
export const CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS = Object.freeze({
  statementTimeoutMs: 5_000,
  queryTimeoutMs: 7_500,
  maximumClaims: 50,
  maximumLinks: 100,
  maximumAssessments: 50,
} as const);

export type CaseGraphClaimEvidencePostgresQuery = (
  sql: string,
  params: readonly unknown[],
  options: { statementTimeoutMs: number; queryTimeoutMs: number; signal?: AbortSignal },
) => Promise<{ rows: Record<string, unknown>[] }>;

export type CaseGraphClaimEvidenceServingInspection = {
  verified: true;
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  claimArtifactSha256: string;
  completionReceiptSha256: string;
  claimCount: number;
  linkCount: number;
  assessmentCount: number;
};

const SHA256 = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw new Error(code); };

const text = (value: unknown, maximum: number, code: string): string => {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > maximum) fail(code);
  return value as string;
};

const digest = (value: unknown, code = 'case_graph_claim_evidence_row_invalid') => {
  const result = text(value, 64, code);
  if (!SHA256.test(result)) fail(code);
  return result;
};

const safeInteger = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 0 || Number(number) > maximum) {
    fail('case_graph_claim_evidence_row_invalid');
  }
  return Number(number);
};

const nullableConfidence = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail('case_graph_claim_evidence_row_invalid');
  }
  return value as number;
};

const jsonObject = (value: unknown) => {
  const decoded = typeof value === 'string' ? (() => {
    try { return JSON.parse(value) as unknown; } catch { return fail('case_graph_claim_evidence_row_invalid'); }
  })() : value;
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    fail('case_graph_claim_evidence_row_invalid');
  }
  return decoded as Record<string, unknown>;
};

const jsonArray = (value: unknown, maximum: number): unknown[] => {
  const decoded = typeof value === 'string' ? (() => {
    try { return JSON.parse(value) as unknown; } catch { return fail('case_graph_claim_evidence_row_invalid'); }
  })() : value;
  if (!Array.isArray(decoded) || decoded.length > maximum) fail('case_graph_claim_evidence_row_invalid');
  return decoded as unknown[];
};

const claimBinding = (publication: CaseGraphResearchPublicationBinding): ClaimEvidencePublicationBinding => ({
  publicationId: publication.publicationId,
  corpusVersion: publication.corpusVersion,
  manifestSha256: publication.manifestSha256,
  snapshotId: publication.snapshotId,
  graphArtifactSetSha256: publication.graphArtifactSetSha256,
});

const queryOptions = (signal?: AbortSignal) => ({
  statementTimeoutMs: CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.statementTimeoutMs,
  queryTimeoutMs: CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.queryTimeoutMs,
  signal,
});

export const inspectCaseGraphClaimEvidenceServing = async (params: {
  active: ActiveCaseGraphPublication;
  query: CaseGraphClaimEvidencePostgresQuery;
  signal?: AbortSignal;
}): Promise<CaseGraphClaimEvidenceServingInspection> => {
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const publication = caseGraphResearchPublicationBinding(params.active);
  const result = await params.query(`
    SELECT publication_id, public_manifest_sha256, graph_artifact_set_sha256,
      claim_artifact_sha256, schema_version, reliability_schema_version,
      expected_claim_count, expected_link_count, expected_assessment_count,
      indexed_claim_count, indexed_link_count, indexed_assessment_count,
      completion_receipt_sha256, status
    FROM public.case_graph_claim_evidence_builds
    WHERE publication_id = $1::uuid
    LIMIT 2
  `, [publication.publicationId], queryOptions(params.signal));
  if (result.rows.length !== 1) fail('case_graph_research_claim_evidence_unavailable');
  const row = result.rows[0];
  const expectedClaimCount = safeInteger(row.expected_claim_count);
  const expectedLinkCount = safeInteger(row.expected_link_count);
  const expectedAssessmentCount = safeInteger(row.expected_assessment_count);
  if (row.publication_id !== publication.publicationId
    || row.public_manifest_sha256 !== publication.manifestSha256
    || row.graph_artifact_set_sha256 !== publication.graphArtifactSetSha256
    || row.schema_version !== 'case-graph-claim-evidence-v1'
    || row.reliability_schema_version !== 'case-graph-source-reliability-v1'
    || row.status !== 'verified'
    || safeInteger(row.indexed_claim_count) !== expectedClaimCount
    || safeInteger(row.indexed_link_count) !== expectedLinkCount
    || safeInteger(row.indexed_assessment_count) !== expectedAssessmentCount) {
    fail('case_graph_research_claim_evidence_unavailable');
  }
  return {
    verified: true,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_VERSION,
    publication,
    claimArtifactSha256: digest(row.claim_artifact_sha256, 'case_graph_research_claim_evidence_unavailable'),
    completionReceiptSha256: digest(row.completion_receipt_sha256, 'case_graph_research_claim_evidence_unavailable'),
    claimCount: expectedClaimCount,
    linkCount: expectedLinkCount,
    assessmentCount: expectedAssessmentCount,
  };
};

const claimFromRow = (
  row: Record<string, unknown>,
  publication: CaseGraphResearchPublicationBinding,
): AtomicEvidenceClaim => {
  const claim = buildAtomicEvidenceClaim({
    binding: claimBinding(publication),
    address: text(row.address, 1_024, 'case_graph_claim_evidence_row_invalid'),
    sourceId: text(row.source_id, 240, 'case_graph_claim_evidence_row_invalid'),
    subject: text(row.subject, 2_000, 'case_graph_claim_evidence_row_invalid'),
    predicate: text(row.predicate, 240, 'case_graph_claim_evidence_row_invalid'),
    object: text(row.object_text, 8_000, 'case_graph_claim_evidence_row_invalid'),
    polarity: row.polarity as AtomicEvidenceClaim['polarity'],
    modality: row.modality as AtomicEvidenceClaim['modality'],
    sourceText: text(row.source_text, 32_768, 'case_graph_claim_evidence_row_invalid'),
    locator: jsonObject(row.locator) as AtomicEvidenceClaim['locator'],
    extraction: {
      method: row.extraction_method as AtomicEvidenceClaim['extraction']['method'],
      version: text(row.extraction_version, 240, 'case_graph_claim_evidence_row_invalid'),
      confidence: nullableConfidence(row.extraction_confidence),
      reviewStatus: row.review_status as AtomicEvidenceClaim['extraction']['reviewStatus'],
    },
  });
  if (row.claim_id !== claim.claimId || row.claim_digest !== claim.claimDigest
    || row.source_text_sha256 !== claim.sourceTextSha256) fail('case_graph_claim_evidence_row_invalid');
  return claim;
};

const linkFromRow = (
  row: Record<string, unknown>,
  publication: CaseGraphResearchPublicationBinding,
): ClaimEvidenceLink => {
  const link = buildClaimEvidenceLink({
    binding: claimBinding(publication),
    fromClaimId: text(row.from_claim_id, 70, 'case_graph_claim_evidence_row_invalid'),
    toClaimId: text(row.to_claim_id, 70, 'case_graph_claim_evidence_row_invalid'),
    stance: row.stance as ClaimEvidenceLink['stance'],
    lineage: row.lineage as ClaimEvidenceLink['lineage'],
    rationale: text(row.rationale, 8_000, 'case_graph_claim_evidence_row_invalid'),
    confidence: nullableConfidence(row.confidence),
    determination: {
      method: row.determination_method as ClaimEvidenceLink['determination']['method'],
      version: text(row.determination_version, 240, 'case_graph_claim_evidence_row_invalid'),
      reviewStatus: row.review_status as ClaimEvidenceLink['determination']['reviewStatus'],
    },
  });
  if (row.link_id !== link.linkId || row.link_digest !== link.linkDigest) {
    fail('case_graph_claim_evidence_row_invalid');
  }
  return link;
};

const assessmentFromRow = (
  row: Record<string, unknown>,
  publication: CaseGraphResearchPublicationBinding,
): SourceReliabilityAssessment => {
  const dimensions = jsonObject(row.dimensions) as SourceReliabilityDimensions;
  const assessment = buildSourceReliabilityAssessment({
    binding: claimBinding(publication),
    address: text(row.address, 1_024, 'case_graph_claim_evidence_row_invalid'),
    sourceId: text(row.source_id, 240, 'case_graph_claim_evidence_row_invalid'),
    sourceLabel: text(row.source_label, 2_000, 'case_graph_claim_evidence_row_invalid'),
    lineageId: text(row.lineage_id, 240, 'case_graph_claim_evidence_row_invalid'),
    dimensions,
    limitations: jsonArray(row.limitations, 64)
      .map((item) => text(item, 8_000, 'case_graph_claim_evidence_row_invalid')),
    assessedBy: {
      method: row.assessment_method as SourceReliabilityAssessment['assessedBy']['method'],
      version: text(row.assessment_version, 240, 'case_graph_claim_evidence_row_invalid'),
      reviewStatus: row.review_status as SourceReliabilityAssessment['assessedBy']['reviewStatus'],
    },
  });
  const reasonCodes = jsonArray(row.overall_reason_codes, 32);
  if (row.assessment_id !== assessment.assessmentId
    || row.assessment_digest !== assessment.assessmentDigest
    || row.source_position !== assessment.dimensions.sourcePosition.value
    || row.contemporaneity !== assessment.dimensions.contemporaneity.value
    || row.witness_identity !== assessment.dimensions.witnessIdentity.value
    || row.originality !== assessment.dimensions.originality.value
    || row.independence !== assessment.dimensions.independence.value
    || row.provenance !== assessment.dimensions.provenance.value
    || row.corroboration !== assessment.dimensions.corroboration.value
    || safeInteger(row.independent_source_count, 1_000_000) !== assessment.dimensions.corroboration.independentSourceCount
    || safeInteger(row.shared_lineage_source_count, 1_000_000) !== assessment.dimensions.corroboration.sharedLineageSourceCount
    || row.overall_category !== assessment.overall.category
    || JSON.stringify(reasonCodes) !== JSON.stringify(assessment.overall.reasonCodes)
    || row.overall_explanation !== assessment.overall.explanation) fail('case_graph_claim_evidence_row_invalid');
  return assessment;
};

const CLAIM_COLUMNS = `claim_id, claim_digest, address, source_id, subject, predicate,
  object_text, polarity, modality, source_text, source_text_sha256, locator,
  extraction_method, extraction_version, extraction_confidence, review_status`;
const LINK_COLUMNS = `link_id, link_digest, from_claim_id, to_claim_id, stance, lineage,
  rationale, confidence, determination_method, determination_version, review_status`;
const ASSESSMENT_COLUMNS = `assessment_id, assessment_digest, address, source_id,
  source_label, lineage_id, source_position, contemporaneity, witness_identity,
  originality, independence, provenance, corroboration, independent_source_count,
  shared_lineage_source_count, dimensions, overall_category, overall_reason_codes,
  overall_explanation, limitations, assessment_method, assessment_version, review_status`;

const assertPublication = (
  actual: CaseGraphResearchPublicationBinding,
  expected: CaseGraphResearchPublicationBinding,
) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('case_graph_research_claim_evidence_publication_mismatch');
  }
};

export const createPostgresCaseGraphClaimEvidenceProvider = (params: {
  query: CaseGraphClaimEvidencePostgresQuery;
  inspection: CaseGraphClaimEvidenceServingInspection;
}): CaseGraphResearchClaimEvidenceProvider => ({
  inspectClaims: async ({ publication, address, limit, signal }) => {
    assertPublication(publication, params.inspection.publication);
    const boundedLimit = Math.min(Math.max(1, limit), CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.maximumClaims);
    const claimRows = await params.query(`
      SELECT ${CLAIM_COLUMNS}
      FROM public.case_graph_atomic_claims
      WHERE publication_id = $1::uuid AND address = $2::text
      ORDER BY claim_id COLLATE "C"
      LIMIT $3::integer
    `, [publication.publicationId, address, boundedLimit + 1], queryOptions(signal));
    const hasMore = claimRows.rows.length > boundedLimit;
    const claims = claimRows.rows.slice(0, boundedLimit).map((row) => claimFromRow(row, publication));
    const claimIds = claims.map((claim) => claim.claimId);
    let links: ClaimEvidenceLink[] = [];
    let relatedClaims: AtomicEvidenceClaim[] = [];
    if (claimIds.length) {
      const linkRows = await params.query(`
        SELECT ${LINK_COLUMNS}
        FROM public.case_graph_claim_links
        WHERE publication_id = $1::uuid
          AND (from_claim_id = ANY($2::text[]) OR to_claim_id = ANY($2::text[]))
        ORDER BY link_id COLLATE "C"
        LIMIT $3::integer
      `, [publication.publicationId, claimIds, CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.maximumLinks], queryOptions(signal));
      links = linkRows.rows.map((row) => linkFromRow(row, publication));
      const relatedIds = [...new Set(links.flatMap((link) => [link.fromClaimId, link.toClaimId])
        .filter((claimId) => !claimIds.includes(claimId)))].sort();
      if (relatedIds.length) {
        const relatedRows = await params.query(`
          SELECT ${CLAIM_COLUMNS}
          FROM public.case_graph_atomic_claims
          WHERE publication_id = $1::uuid AND claim_id = ANY($2::text[])
          ORDER BY claim_id COLLATE "C"
          LIMIT $3::integer
        `, [publication.publicationId, relatedIds, CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.maximumClaims], queryOptions(signal));
        relatedClaims = relatedRows.rows.map((row) => claimFromRow(row, publication));
        if (relatedClaims.length !== relatedIds.length) fail('case_graph_claim_evidence_row_invalid');
      }
    }
    const assessmentRows = await params.query(`
      SELECT ${ASSESSMENT_COLUMNS}
      FROM public.case_graph_source_reliability_assessments
      WHERE publication_id = $1::uuid AND address = $2::text
      ORDER BY assessment_id COLLATE "C"
      LIMIT $3::integer
    `, [publication.publicationId, address, CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.maximumAssessments], queryOptions(signal));
    return {
      artifactDigest: params.inspection.claimArtifactSha256,
      completionReceiptSha256: params.inspection.completionReceiptSha256,
      claims,
      relatedClaims,
      links,
      sourceReliability: assessmentRows.rows.map((row) => assessmentFromRow(row, publication)),
      hasMore,
    };
  },
  inspectSourceReliability: async ({ publication, address, signal }) => {
    assertPublication(publication, params.inspection.publication);
    const rows = await params.query(`
      SELECT ${ASSESSMENT_COLUMNS}
      FROM public.case_graph_source_reliability_assessments
      WHERE publication_id = $1::uuid AND address = $2::text
      ORDER BY assessment_id COLLATE "C"
      LIMIT $3::integer
    `, [publication.publicationId, address, CASE_GRAPH_CLAIM_EVIDENCE_POSTGRES_LIMITS.maximumAssessments], queryOptions(signal));
    return {
      artifactDigest: params.inspection.claimArtifactSha256,
      completionReceiptSha256: params.inspection.completionReceiptSha256,
      assessments: rows.rows.map((row) => assessmentFromRow(row, publication)),
    };
  },
});
