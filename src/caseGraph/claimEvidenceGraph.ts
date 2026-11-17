import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CASE_GRAPH_CLAIM_EVIDENCE_VERSION = 'case-graph-claim-evidence-v1' as const;
export const CASE_GRAPH_SOURCE_RELIABILITY_VERSION = 'case-graph-source-reliability-v1' as const;

export const CASE_GRAPH_CLAIM_DISCIPLINE = Object.freeze({
  claimMeaning: 'attributable_source_statement_not_verified_truth',
  reliabilityMeaning: 'source_provenance_quality_not_claim_truth',
  repetition: 'shared_lineage_or_repetition_is_not_independent_corroboration',
  contradiction: 'opposed_claims_require_review_and_do_not_resolve_the_underlying_event',
  missingness: 'unknown_and_not_recorded_are_not_negative_evidence',
  causality: 'not_established',
  extraordinaryOrigin: 'not_assessed',
  humanOversight: 'required_for_publication_grade_conclusions',
} as const);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ADDRESS_PATTERN = /^[a-z][a-z0-9_]*:[^\s]{1,480}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;

export type ClaimEvidencePublicationBinding = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
  snapshotId: string;
  graphArtifactSetSha256: string;
};

export type ClaimEvidenceLocator =
  | { kind: 'record_field'; field: string; characterStart: number; characterEnd: number }
  | { kind: 'document_page'; pageNumber: number; characterStart: number; characterEnd: number; boundingBox: [number, number, number, number] | null }
  | { kind: 'timed_media'; startMilliseconds: number; endMilliseconds: number; frameNumber: number | null }
  | { kind: 'image_region'; boundingBox: [number, number, number, number] };

export type AtomicEvidenceClaim = {
  recordType: 'case_graph_atomic_claim';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_VERSION;
  binding: ClaimEvidencePublicationBinding;
  claimId: string;
  address: string;
  sourceId: string;
  subject: string;
  predicate: string;
  object: string;
  polarity: 'asserted' | 'denied';
  modality: 'observed' | 'reported' | 'inferred' | 'alleged' | 'unknown';
  sourceText: string;
  sourceTextSha256: string;
  locator: ClaimEvidenceLocator;
  extraction: {
    method: 'structured' | 'deterministic_rule' | 'governed_model' | 'manual_review';
    version: string;
    confidence: number | null;
    reviewStatus: 'unreviewed' | 'reviewed' | 'disputed';
  };
  claimDiscipline: typeof CASE_GRAPH_CLAIM_DISCIPLINE;
  claimDigest: string;
};

export type AtomicEvidenceClaimDraft = Omit<
  AtomicEvidenceClaim,
  'recordType' | 'schemaVersion' | 'claimId' | 'sourceTextSha256' | 'claimDiscipline' | 'claimDigest'
>;

export type ClaimEvidenceLink = {
  recordType: 'case_graph_claim_link';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_VERSION;
  binding: ClaimEvidencePublicationBinding;
  linkId: string;
  fromClaimId: string;
  toClaimId: string;
  stance: 'supports' | 'contradicts' | 'repeats' | 'contextualizes' | 'uncertain';
  lineage: 'independent' | 'shared_lineage' | 'unknown';
  rationale: string;
  confidence: number | null;
  determination: {
    method: 'deterministic_rule' | 'governed_model' | 'manual_review';
    version: string;
    reviewStatus: 'unreviewed' | 'reviewed' | 'disputed';
  };
  claimDiscipline: typeof CASE_GRAPH_CLAIM_DISCIPLINE;
  linkDigest: string;
};

export type ClaimEvidenceLinkDraft = Omit<
  ClaimEvidenceLink,
  'recordType' | 'schemaVersion' | 'linkId' | 'claimDiscipline' | 'linkDigest'
>;

type ExplainedDimension<T extends string> = {
  value: T;
  reasonCodes: string[];
  explanation: string;
};

export type SourceReliabilityDimensions = {
  sourcePosition: ExplainedDimension<'primary' | 'secondary' | 'mixed' | 'unknown'>;
  contemporaneity: ExplainedDimension<'contemporaneous' | 'near_contemporary' | 'retrospective' | 'unknown'>;
  witnessIdentity: ExplainedDimension<'named' | 'anonymous' | 'institutional' | 'not_applicable' | 'unknown'>;
  originality: ExplainedDimension<'original' | 'derived' | 'copy' | 'unknown'>;
  independence: ExplainedDimension<'independent' | 'shared_lineage' | 'not_applicable' | 'unknown'>;
  provenance: ExplainedDimension<'complete' | 'partial' | 'missing'>;
  corroboration: ExplainedDimension<'none' | 'single_independent' | 'multiple_independent' | 'shared_lineage_only' | 'unknown'> & {
    independentSourceCount: number;
    sharedLineageSourceCount: number;
  };
};

export type SourceReliabilityAssessment = {
  recordType: 'case_graph_source_reliability';
  schemaVersion: typeof CASE_GRAPH_SOURCE_RELIABILITY_VERSION;
  binding: ClaimEvidencePublicationBinding;
  assessmentId: string;
  address: string;
  sourceId: string;
  sourceLabel: string;
  lineageId: string;
  dimensions: SourceReliabilityDimensions;
  overall: {
    category: 'high' | 'medium' | 'low' | 'indeterminate';
    reasonCodes: string[];
    explanation: string;
  };
  limitations: string[];
  assessedBy: {
    method: 'deterministic_rule' | 'governed_model' | 'manual_review';
    version: string;
    reviewStatus: 'unreviewed' | 'reviewed' | 'disputed';
  };
  claimDiscipline: typeof CASE_GRAPH_CLAIM_DISCIPLINE;
  assessmentDigest: string;
};

export type SourceReliabilityAssessmentDraft = Omit<
  SourceReliabilityAssessment,
  'recordType' | 'schemaVersion' | 'assessmentId' | 'overall' | 'claimDiscipline' | 'assessmentDigest'
>;

export type ClaimEvidenceGraphArtifact = {
  recordType: 'case_graph_claim_evidence_graph';
  schemaVersion: typeof CASE_GRAPH_CLAIM_EVIDENCE_VERSION;
  binding: ClaimEvidencePublicationBinding;
  claims: AtomicEvidenceClaim[];
  links: ClaimEvidenceLink[];
  sourceReliability: SourceReliabilityAssessment[];
  accounting: {
    claimCount: number;
    linkCount: number;
    sourceAssessmentCount: number;
    stanceCounts: Record<ClaimEvidenceLink['stance'], number>;
    independentSupportCount: number;
    repeatedOrSharedLineageCount: number;
  };
  claimDiscipline: typeof CASE_GRAPH_CLAIM_DISCIPLINE;
  artifactDigest: string;
};

const invalid = (code: string): never => { throw new Error(code); };

const requireText = (value: unknown, code: string, maximum = 2_000): string => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.trim() !== value) invalid(code);
  return value as string;
};

const requireId = (value: unknown, code: string): string => {
  const result = requireText(value, code, 240);
  if (!ID_PATTERN.test(result)) invalid(code);
  return result;
};

const requireDigest = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(code);
  return value as string;
};

const requireBinding = (value: ClaimEvidencePublicationBinding): ClaimEvidencePublicationBinding => {
  if (!value || !UUID_PATTERN.test(value.publicationId) || !UUID_PATTERN.test(value.snapshotId)) invalid('claim_evidence_binding_invalid');
  requireId(value.corpusVersion, 'claim_evidence_binding_invalid');
  requireDigest(value.manifestSha256, 'claim_evidence_binding_invalid');
  requireDigest(value.graphArtifactSetSha256, 'claim_evidence_binding_invalid');
  return { ...value };
};

const requireAddress = (value: unknown): string => {
  const result = requireText(value, 'claim_evidence_address_invalid', 500);
  if (!ADDRESS_PATTERN.test(result)) invalid('claim_evidence_address_invalid');
  return result;
};

const requireConfidence = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid('claim_evidence_confidence_invalid');
  return value as number;
};

const requireCount = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid('source_reliability_count_invalid');
  return Number(value);
};

const requireLocator = (locator: ClaimEvidenceLocator): ClaimEvidenceLocator => {
  if (!locator || typeof locator !== 'object') invalid('claim_evidence_locator_invalid');
  const range = (start: number, end: number) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) invalid('claim_evidence_locator_invalid');
  };
  const box = (value: [number, number, number, number]) => {
    if (!Array.isArray(value) || value.length !== 4 || value.some((part) => typeof part !== 'number' || !Number.isFinite(part) || part < 0 || part > 1)) invalid('claim_evidence_locator_invalid');
    if (value[2] <= value[0] || value[3] <= value[1]) invalid('claim_evidence_locator_invalid');
    return [...value] as [number, number, number, number];
  };
  if (locator.kind === 'record_field') {
    range(locator.characterStart, locator.characterEnd);
    return { ...locator, field: requireId(locator.field, 'claim_evidence_locator_invalid') };
  }
  if (locator.kind === 'document_page') {
    if (!Number.isSafeInteger(locator.pageNumber) || locator.pageNumber < 1) invalid('claim_evidence_locator_invalid');
    range(locator.characterStart, locator.characterEnd);
    return { ...locator, boundingBox: locator.boundingBox === null ? null : box(locator.boundingBox) };
  }
  if (locator.kind === 'timed_media') {
    range(locator.startMilliseconds, locator.endMilliseconds);
    if (locator.frameNumber !== null && (!Number.isSafeInteger(locator.frameNumber) || locator.frameNumber < 0)) invalid('claim_evidence_locator_invalid');
    return { ...locator };
  }
  if (locator.kind === 'image_region') return { ...locator, boundingBox: box(locator.boundingBox) };
  return invalid('claim_evidence_locator_invalid');
};

const sameBinding = (left: ClaimEvidencePublicationBinding, right: ClaimEvidencePublicationBinding) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

export const buildAtomicEvidenceClaim = (draft: AtomicEvidenceClaimDraft): AtomicEvidenceClaim => {
  const core = {
    recordType: 'case_graph_atomic_claim' as const,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_VERSION,
    binding: requireBinding(draft.binding),
    address: requireAddress(draft.address),
    sourceId: requireId(draft.sourceId, 'claim_evidence_source_invalid'),
    subject: requireText(draft.subject, 'claim_evidence_statement_invalid', 500),
    predicate: requireId(draft.predicate, 'claim_evidence_statement_invalid'),
    object: requireText(draft.object, 'claim_evidence_statement_invalid', 2_000),
    polarity: draft.polarity,
    modality: draft.modality,
    sourceText: requireText(draft.sourceText, 'claim_evidence_source_text_invalid', 8_000),
    sourceTextSha256: relationshipInputSha256(draft.sourceText),
    locator: requireLocator(draft.locator),
    extraction: {
      method: draft.extraction.method,
      version: requireId(draft.extraction.version, 'claim_evidence_extraction_invalid'),
      confidence: requireConfidence(draft.extraction.confidence),
      reviewStatus: draft.extraction.reviewStatus,
    },
    claimDiscipline: CASE_GRAPH_CLAIM_DISCIPLINE,
  };
  if (!['asserted', 'denied'].includes(core.polarity)
    || !['observed', 'reported', 'inferred', 'alleged', 'unknown'].includes(core.modality)
    || !['structured', 'deterministic_rule', 'governed_model', 'manual_review'].includes(core.extraction.method)
    || !['unreviewed', 'reviewed', 'disputed'].includes(core.extraction.reviewStatus)) invalid('claim_evidence_claim_invalid');
  const identity = {
    binding: core.binding, address: core.address, sourceId: core.sourceId,
    subject: core.subject, predicate: core.predicate, object: core.object,
    polarity: core.polarity, modality: core.modality, locator: core.locator,
  };
  const claimId = `claim:${relationshipInputSha256(identity)}`;
  const withoutDigest = { ...core, claimId };
  return { ...withoutDigest, claimDigest: relationshipInputSha256(withoutDigest) };
};

export const buildClaimEvidenceLink = (draft: ClaimEvidenceLinkDraft): ClaimEvidenceLink => {
  const binding = requireBinding(draft.binding);
  const fromClaimId = requireText(draft.fromClaimId, 'claim_evidence_link_invalid', 70);
  const toClaimId = requireText(draft.toClaimId, 'claim_evidence_link_invalid', 70);
  if (!/^claim:[a-f0-9]{64}$/.test(fromClaimId) || !/^claim:[a-f0-9]{64}$/.test(toClaimId) || fromClaimId === toClaimId) invalid('claim_evidence_link_invalid');
  if (!['supports', 'contradicts', 'repeats', 'contextualizes', 'uncertain'].includes(draft.stance)
    || !['independent', 'shared_lineage', 'unknown'].includes(draft.lineage)) invalid('claim_evidence_link_invalid');
  if (draft.stance === 'repeats' && draft.lineage === 'independent') invalid('claim_evidence_repetition_independence_invalid');
  const core = {
    recordType: 'case_graph_claim_link' as const,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_VERSION,
    binding,
    fromClaimId,
    toClaimId,
    stance: draft.stance,
    lineage: draft.lineage,
    rationale: requireText(draft.rationale, 'claim_evidence_link_invalid', 2_000),
    confidence: requireConfidence(draft.confidence),
    determination: {
      method: draft.determination.method,
      version: requireId(draft.determination.version, 'claim_evidence_link_invalid'),
      reviewStatus: draft.determination.reviewStatus,
    },
    claimDiscipline: CASE_GRAPH_CLAIM_DISCIPLINE,
  };
  if (!['deterministic_rule', 'governed_model', 'manual_review'].includes(core.determination.method)
    || !['unreviewed', 'reviewed', 'disputed'].includes(core.determination.reviewStatus)) invalid('claim_evidence_link_invalid');
  const identity = { binding, fromClaimId, toClaimId, stance: core.stance, lineage: core.lineage };
  const linkId = `claim-link:${relationshipInputSha256(identity)}`;
  const withoutDigest = { ...core, linkId };
  return { ...withoutDigest, linkDigest: relationshipInputSha256(withoutDigest) };
};

const normalizeDimension = <T extends string>(
  dimension: ExplainedDimension<T>,
  allowed: readonly T[],
): ExplainedDimension<T> => ({
  value: allowed.includes(dimension.value) ? dimension.value : invalid('source_reliability_dimension_invalid'),
  reasonCodes: [...new Set(dimension.reasonCodes.map((reason) => requireId(reason, 'source_reliability_reason_invalid')))].sort(compareText),
  explanation: requireText(dimension.explanation, 'source_reliability_explanation_invalid', 2_000),
});

const deriveOverall = (dimensions: SourceReliabilityDimensions): SourceReliabilityAssessment['overall'] => {
  const strong = dimensions.sourcePosition.value === 'primary'
    && ['contemporaneous', 'near_contemporary'].includes(dimensions.contemporaneity.value)
    && ['named', 'institutional', 'not_applicable'].includes(dimensions.witnessIdentity.value)
    && dimensions.originality.value === 'original'
    && ['independent', 'not_applicable'].includes(dimensions.independence.value)
    && dimensions.provenance.value === 'complete';
  const seriousGap = dimensions.provenance.value === 'missing'
    || dimensions.originality.value === 'copy'
    || (dimensions.independence.value === 'shared_lineage' && dimensions.corroboration.value === 'shared_lineage_only');
  const unknowns = [
    dimensions.sourcePosition.value,
    dimensions.contemporaneity.value,
    dimensions.witnessIdentity.value,
    dimensions.originality.value,
    dimensions.independence.value,
    dimensions.corroboration.value,
  ].filter((value) => value === 'unknown').length;
  if (strong) return {
    category: 'high', reasonCodes: ['primary_near_event_original_traceable'],
    explanation: 'The source is primary, near the event, original and traceable. This describes provenance quality; it does not verify the claim.',
  };
  if (seriousGap) return {
    category: 'low', reasonCodes: ['material_provenance_or_independence_gap'],
    explanation: 'A material provenance, originality or independence gap limits evidential weight. This does not establish that the claim is false.',
  };
  if (unknowns >= 3) return {
    category: 'indeterminate', reasonCodes: ['insufficient_reliability_metadata'],
    explanation: 'Too many source-quality dimensions are unknown to assign a responsible category.',
  };
  return {
    category: 'medium', reasonCodes: ['mixed_or_partial_source_quality'],
    explanation: 'The source has usable provenance alongside limitations or unresolved dimensions; inspect the dimension explanations.',
  };
};

export const buildSourceReliabilityAssessment = (
  draft: SourceReliabilityAssessmentDraft,
): SourceReliabilityAssessment => {
  const dimensions: SourceReliabilityDimensions = {
    sourcePosition: normalizeDimension(draft.dimensions.sourcePosition, ['primary', 'secondary', 'mixed', 'unknown']),
    contemporaneity: normalizeDimension(draft.dimensions.contemporaneity, ['contemporaneous', 'near_contemporary', 'retrospective', 'unknown']),
    witnessIdentity: normalizeDimension(draft.dimensions.witnessIdentity, ['named', 'anonymous', 'institutional', 'not_applicable', 'unknown']),
    originality: normalizeDimension(draft.dimensions.originality, ['original', 'derived', 'copy', 'unknown']),
    independence: normalizeDimension(draft.dimensions.independence, ['independent', 'shared_lineage', 'not_applicable', 'unknown']),
    provenance: normalizeDimension(draft.dimensions.provenance, ['complete', 'partial', 'missing']),
    corroboration: {
      ...normalizeDimension(draft.dimensions.corroboration, ['none', 'single_independent', 'multiple_independent', 'shared_lineage_only', 'unknown']),
      independentSourceCount: requireCount(draft.dimensions.corroboration.independentSourceCount),
      sharedLineageSourceCount: requireCount(draft.dimensions.corroboration.sharedLineageSourceCount),
    },
  };
  if (dimensions.corroboration.value === 'multiple_independent' && dimensions.corroboration.independentSourceCount < 2) invalid('source_reliability_corroboration_invalid');
  if (dimensions.corroboration.value === 'single_independent' && dimensions.corroboration.independentSourceCount !== 1) invalid('source_reliability_corroboration_invalid');
  if (dimensions.corroboration.value === 'shared_lineage_only'
    && (dimensions.corroboration.independentSourceCount !== 0 || dimensions.corroboration.sharedLineageSourceCount < 1)) invalid('source_reliability_corroboration_invalid');
  const core = {
    recordType: 'case_graph_source_reliability' as const,
    schemaVersion: CASE_GRAPH_SOURCE_RELIABILITY_VERSION,
    binding: requireBinding(draft.binding),
    address: requireAddress(draft.address),
    sourceId: requireId(draft.sourceId, 'source_reliability_source_invalid'),
    sourceLabel: requireText(draft.sourceLabel, 'source_reliability_source_invalid', 500),
    lineageId: requireId(draft.lineageId, 'source_reliability_source_invalid'),
    dimensions,
    overall: deriveOverall(dimensions),
    limitations: [...new Set(draft.limitations.map((item) => requireText(item, 'source_reliability_limitation_invalid', 2_000)))].sort(compareText),
    assessedBy: {
      method: draft.assessedBy.method,
      version: requireId(draft.assessedBy.version, 'source_reliability_assessor_invalid'),
      reviewStatus: draft.assessedBy.reviewStatus,
    },
    claimDiscipline: CASE_GRAPH_CLAIM_DISCIPLINE,
  };
  if (!['deterministic_rule', 'governed_model', 'manual_review'].includes(core.assessedBy.method)
    || !['unreviewed', 'reviewed', 'disputed'].includes(core.assessedBy.reviewStatus)) invalid('source_reliability_assessor_invalid');
  const assessmentId = `source-assessment:${relationshipInputSha256({ binding: core.binding, address: core.address, sourceId: core.sourceId })}`;
  const withoutDigest = { ...core, assessmentId };
  return { ...withoutDigest, assessmentDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyAtomicEvidenceClaim = (value: AtomicEvidenceClaim): AtomicEvidenceClaim => {
  const expected = buildAtomicEvidenceClaim({
    binding: value.binding,
    address: value.address,
    sourceId: value.sourceId,
    subject: value.subject,
    predicate: value.predicate,
    object: value.object,
    polarity: value.polarity,
    modality: value.modality,
    sourceText: value.sourceText,
    locator: value.locator,
    extraction: value.extraction,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_evidence_claim_integrity_failed');
  }
  return expected;
};

export const verifyClaimEvidenceLink = (value: ClaimEvidenceLink): ClaimEvidenceLink => {
  const expected = buildClaimEvidenceLink({
    binding: value.binding,
    fromClaimId: value.fromClaimId,
    toClaimId: value.toClaimId,
    stance: value.stance,
    lineage: value.lineage,
    rationale: value.rationale,
    confidence: value.confidence,
    determination: value.determination,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_evidence_link_integrity_failed');
  }
  return expected;
};

export const verifySourceReliabilityAssessment = (
  value: SourceReliabilityAssessment,
): SourceReliabilityAssessment => {
  const expected = buildSourceReliabilityAssessment({
    binding: value.binding,
    address: value.address,
    sourceId: value.sourceId,
    sourceLabel: value.sourceLabel,
    lineageId: value.lineageId,
    dimensions: value.dimensions,
    limitations: value.limitations,
    assessedBy: value.assessedBy,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('source_reliability_assessment_integrity_failed');
  }
  return expected;
};

export const buildClaimEvidenceGraphArtifact = (params: {
  binding: ClaimEvidencePublicationBinding;
  claims: AtomicEvidenceClaim[];
  links: ClaimEvidenceLink[];
  sourceReliability: SourceReliabilityAssessment[];
}): ClaimEvidenceGraphArtifact => {
  const binding = requireBinding(params.binding);
  const claims = [...params.claims].sort((left, right) => compareText(left.claimId, right.claimId));
  const links = [...params.links].sort((left, right) => compareText(left.linkId, right.linkId));
  const sourceReliability = [...params.sourceReliability]
    .sort((left, right) => compareText(left.assessmentId, right.assessmentId));
  const claimIds = new Set<string>();
  for (const claim of claims) {
    if (!sameBinding(binding, claim.binding) || claimIds.has(claim.claimId)) invalid('claim_evidence_artifact_claim_invalid');
    try { verifyAtomicEvidenceClaim(claim); } catch { invalid('claim_evidence_artifact_claim_invalid'); }
    claimIds.add(claim.claimId);
  }
  const linkIds = new Set<string>();
  for (const link of links) {
    if (!sameBinding(binding, link.binding) || linkIds.has(link.linkId)
      || !claimIds.has(link.fromClaimId) || !claimIds.has(link.toClaimId)) invalid('claim_evidence_artifact_link_invalid');
    try { verifyClaimEvidenceLink(link); } catch { invalid('claim_evidence_artifact_link_invalid'); }
    linkIds.add(link.linkId);
  }
  const assessmentIds = new Set<string>();
  for (const assessment of sourceReliability) {
    if (!sameBinding(binding, assessment.binding) || assessmentIds.has(assessment.assessmentId)) invalid('claim_evidence_artifact_assessment_invalid');
    try { verifySourceReliabilityAssessment(assessment); } catch { invalid('claim_evidence_artifact_assessment_invalid'); }
    assessmentIds.add(assessment.assessmentId);
  }
  const stanceCounts: Record<ClaimEvidenceLink['stance'], number> = {
    supports: 0, contradicts: 0, repeats: 0, contextualizes: 0, uncertain: 0,
  };
  for (const link of links) stanceCounts[link.stance] += 1;
  const withoutDigest = {
    recordType: 'case_graph_claim_evidence_graph' as const,
    schemaVersion: CASE_GRAPH_CLAIM_EVIDENCE_VERSION,
    binding,
    claims,
    links,
    sourceReliability,
    accounting: {
      claimCount: claims.length,
      linkCount: links.length,
      sourceAssessmentCount: sourceReliability.length,
      stanceCounts,
      independentSupportCount: links.filter((link) => link.stance === 'supports' && link.lineage === 'independent').length,
      repeatedOrSharedLineageCount: links.filter((link) => link.stance === 'repeats' || link.lineage === 'shared_lineage').length,
    },
    claimDiscipline: CASE_GRAPH_CLAIM_DISCIPLINE,
  };
  return { ...withoutDigest, artifactDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyClaimEvidenceGraphArtifact = (
  value: ClaimEvidenceGraphArtifact,
): ClaimEvidenceGraphArtifact => {
  const expected = buildClaimEvidenceGraphArtifact({
    binding: value.binding,
    claims: value.claims,
    links: value.links,
    sourceReliability: value.sourceReliability,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_evidence_artifact_integrity_failed');
  }
  return expected;
};
