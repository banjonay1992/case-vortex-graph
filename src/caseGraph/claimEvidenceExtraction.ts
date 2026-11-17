import {
  buildAtomicEvidenceClaim,
  buildSourceReliabilityAssessment,
  type AtomicEvidenceClaim,
  type ClaimEvidenceLocator,
  type ClaimEvidencePublicationBinding,
  type SourceReliabilityAssessment,
  type SourceReliabilityDimensions,
} from './claimEvidenceGraph';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';
import type { CaseGraphResearchContentEntry } from './researchToolContract';
import {
  HIGH_VOLUME_SOURCE_LINEAGE_POLICY_VERSION,
  resolveHighVolumeReviewedLineage,
} from './highVolumeSourceGovernanceReview';
import {
  RICH_GELREICH_SOURCE_LINEAGE_POLICY_VERSION,
  resolveRichGelreichReviewedLineage,
} from './richGelreichSourceLineage';
import {
  SKYWATCH_SOURCE_LINEAGE_POLICY_VERSION,
  resolveSkywatchReviewedLineage,
} from './skywatchSourceLineage';
import {
  CANADIAN_UFO_SURVEY_SOURCE_LINEAGE_POLICY_VERSION,
  resolveCanadianUfoSurveyReviewedLineage,
} from './canadianUfoSurveySourceLineage';
import {
  REDDIT_UFO_SOURCE_LINEAGE_POLICY_VERSION,
  resolveRedditUfoReviewedLineage,
} from './redditUfoSourceLineage';
import {
  UK_AIRPROX_SOURCE_LINEAGE_POLICY_VERSION,
  resolveUkAirproxReviewedLineage,
} from './ukAirproxSourceLineage';
import {
  GEIPAN_SOURCE_LINEAGE_POLICY_VERSION,
  resolveGeipanReviewedLineage,
} from './geipanSourceLineage';
import {
  CISU_SOURCE_LINEAGE_POLICY_VERSION,
  resolveCisuReviewedLineage,
} from './cisuSourceLineage';
import {
  HESSDALEN_SOURCE_LINEAGE_POLICY_VERSION,
  resolveHessdalenReviewedLineage,
} from './hessdalenSourceLineage';
import {
  REVISTA_UFO_SOURCE_LINEAGE_POLICY_VERSION,
  resolveRevistaUfoReviewedLineage,
} from './revistaUfoSourceLineage';
import {
  BUFORA_SOURCE_LINEAGE_POLICY_VERSION,
  resolveBuforaReviewedLineage,
} from './buforaSourceLineage';
import {
  AFU_UFO_SVERIGE_SOURCE_LINEAGE_POLICY_VERSION,
  resolveAfuUfoSverigeReviewedLineage,
} from './afuUfoSverigeSourceLineage';
import {
  SUFOI_SOURCE_LINEAGE_POLICY_VERSION,
  resolveSufoiReviewedLineage,
} from './sufoiSourceLineage';
import {
  GEP_SOURCE_LINEAGE_POLICY_VERSION,
  resolveGepReviewedLineage,
} from './gepSourceLineage';
import {
  BE_UFOM_SOURCE_LINEAGE_POLICY_VERSION,
  resolveBeUfomReviewedLineage,
} from './beUfomSourceLineage';
import {
  COBEPS_SOURCE_LINEAGE_POLICY_VERSION,
  resolveCobepsReviewedLineage,
} from './cobepsSourceLineage';
import {
  UFOCNS_SOURCE_LINEAGE_POLICY_VERSION,
  resolveUfocnsReviewedLineage,
} from './ufocnsSourceLineage';
import {
  ASRS_REPORT_SETS_SOURCE_LINEAGE_POLICY_VERSION,
  resolveAsrsReportSetsReviewedLineage,
} from './asrsReportSetsSourceLineage';
import {
  CURATED_ARCHIVE_SOURCE_LINEAGE_POLICY_VERSION,
  resolveCuratedArchiveReviewedLineage,
} from './curatedArchiveSourceLineage';

export const CLAIM_EVIDENCE_EXTRACTION_VERSION = 'case-graph-claim-extraction-v1' as const;
export const CLAIM_EVIDENCE_ADJUDICATION_VERSION = 'case-graph-claim-adjudication-v1' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const ADDRESS_PATTERN = /^[a-z][a-z0-9_]*:[^\s]{1,480}$/;
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const invalid = (code: string): never => { throw new Error(code); };

const requireText = (value: unknown, code: string, maximum = 8_000): string => {
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

const requireAddress = (value: unknown): string => {
  const result = requireText(value, 'claim_extraction_address_invalid', 500);
  if (!ADDRESS_PATTERN.test(result)) invalid('claim_extraction_address_invalid');
  return result;
};

const requireConfidence = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid('claim_extraction_confidence_invalid');
  }
  return value as number;
};

const sameBinding = (left: ClaimEvidencePublicationBinding, right: ClaimEvidencePublicationBinding) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

export type ClaimExtractionSourceSegment = {
  recordType: 'case_graph_claim_source_segment';
  schemaVersion: typeof CLAIM_EVIDENCE_EXTRACTION_VERSION;
  binding: ClaimEvidencePublicationBinding;
  address: string;
  sourceId: string;
  sourceLabel: string;
  lineageId: string;
  mediaKind: 'record' | 'document' | 'image' | 'audio' | 'video';
  textOrigin: 'structured' | 'embedded_text' | 'ocr' | 'asr' | 'human_transcript' | 'machine_caption' | 'frame_ocr' | 'exif';
  text: string;
  textSha256: string;
  locatorBase:
    | { kind: 'record_field'; field: string; characterOffset: number }
    | { kind: 'document_page'; pageNumber: number; characterOffset: number; boundingBox: [number, number, number, number] | null }
    | { kind: 'timed_media'; startMilliseconds: number; endMilliseconds: number; frameNumber: number | null }
    | { kind: 'image_region'; boundingBox: [number, number, number, number] };
  provenance: {
    assetDigest: string;
    extractionContractDigest: string;
    extractionReceiptDigest: string;
    extractionPointerDigest: string;
  };
  segmentDigest: string;
};

export type ClaimExtractionSourceSegmentDraft = Omit<
  ClaimExtractionSourceSegment,
  'recordType' | 'schemaVersion' | 'textSha256' | 'segmentDigest'
>;

export type ClaimExtractionProposal = {
  proposalId: string;
  segmentDigest: string;
  quoteStart: number;
  quoteEnd: number;
  subject: string;
  predicate: string;
  object: string;
  polarity: 'asserted' | 'denied';
  modality: 'observed' | 'reported' | 'inferred' | 'alleged' | 'unknown';
  extraction: {
    method: 'structured' | 'deterministic_rule' | 'governed_model';
    version: string;
    confidence: number | null;
  };
  proposalDigest: string;
};

export type ClaimExtractionProposalDraft = Omit<ClaimExtractionProposal, 'proposalId' | 'proposalDigest'>;

export type ClaimExtractionBatch = {
  recordType: 'case_graph_claim_extraction_batch';
  schemaVersion: typeof CLAIM_EVIDENCE_EXTRACTION_VERSION;
  binding: ClaimEvidencePublicationBinding;
  segments: ClaimExtractionSourceSegment[];
  proposals: ClaimExtractionProposal[];
  accounting: { segmentCount: number; proposalCount: number };
  batchDigest: string;
};

export type ClaimAdjudicationDecision = {
  proposalId: string;
  decision: 'accept' | 'reject' | 'dispute' | 'defer';
  rationale: string;
  reviewerId: string;
  reviewedAt: string;
};

export type ClaimAdjudicationReceipt = {
  recordType: 'case_graph_claim_adjudication_receipt';
  schemaVersion: typeof CLAIM_EVIDENCE_ADJUDICATION_VERSION;
  binding: ClaimEvidencePublicationBinding;
  extractionBatchDigest: string;
  decisions: ClaimAdjudicationDecision[];
  claims: AtomicEvidenceClaim[];
  accounting: { accepted: number; rejected: number; disputed: number; deferred: number; total: number };
  receiptDigest: string;
};

const requireBox = (value: [number, number, number, number]): [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4
    || value.some((part) => typeof part !== 'number' || !Number.isFinite(part) || part < 0 || part > 1)
    || value[2] <= value[0] || value[3] <= value[1]) invalid('claim_extraction_locator_invalid');
  return [...value] as [number, number, number, number];
};

const normalizeLocatorBase = (
  value: ClaimExtractionSourceSegmentDraft['locatorBase'],
): ClaimExtractionSourceSegment['locatorBase'] => {
  if (value.kind === 'record_field') {
    if (!Number.isSafeInteger(value.characterOffset) || value.characterOffset < 0) invalid('claim_extraction_locator_invalid');
    return { kind: value.kind, field: requireId(value.field, 'claim_extraction_locator_invalid'), characterOffset: value.characterOffset };
  }
  if (value.kind === 'document_page') {
    if (!Number.isSafeInteger(value.pageNumber) || value.pageNumber < 1
      || !Number.isSafeInteger(value.characterOffset) || value.characterOffset < 0) invalid('claim_extraction_locator_invalid');
    return { ...value, boundingBox: value.boundingBox === null ? null : requireBox(value.boundingBox) };
  }
  if (value.kind === 'timed_media') {
    if (!Number.isSafeInteger(value.startMilliseconds) || !Number.isSafeInteger(value.endMilliseconds)
      || value.startMilliseconds < 0 || value.endMilliseconds <= value.startMilliseconds
      || (value.frameNumber !== null && (!Number.isSafeInteger(value.frameNumber) || value.frameNumber < 0))) {
      invalid('claim_extraction_locator_invalid');
    }
    return { ...value };
  }
  if (value.kind === 'image_region') return { kind: value.kind, boundingBox: requireBox(value.boundingBox) };
  return invalid('claim_extraction_locator_invalid');
};

export const buildClaimExtractionSourceSegment = (
  draft: ClaimExtractionSourceSegmentDraft,
): ClaimExtractionSourceSegment => {
  const text = requireText(draft.text, 'claim_extraction_source_text_invalid', 100_000);
  const withoutDigest = {
    recordType: 'case_graph_claim_source_segment' as const,
    schemaVersion: CLAIM_EVIDENCE_EXTRACTION_VERSION,
    binding: { ...draft.binding },
    address: requireAddress(draft.address),
    sourceId: requireId(draft.sourceId, 'claim_extraction_source_invalid'),
    sourceLabel: requireText(draft.sourceLabel, 'claim_extraction_source_invalid', 500),
    lineageId: requireId(draft.lineageId, 'claim_extraction_source_invalid'),
    mediaKind: draft.mediaKind,
    textOrigin: draft.textOrigin,
    text,
    textSha256: relationshipInputSha256(text),
    locatorBase: normalizeLocatorBase(draft.locatorBase),
    provenance: {
      assetDigest: requireDigest(draft.provenance.assetDigest, 'claim_extraction_provenance_invalid'),
      extractionContractDigest: requireDigest(draft.provenance.extractionContractDigest, 'claim_extraction_provenance_invalid'),
      extractionReceiptDigest: requireDigest(draft.provenance.extractionReceiptDigest, 'claim_extraction_provenance_invalid'),
      extractionPointerDigest: requireDigest(draft.provenance.extractionPointerDigest, 'claim_extraction_provenance_invalid'),
    },
  };
  if (!['record', 'document', 'image', 'audio', 'video'].includes(withoutDigest.mediaKind)
    || !['structured', 'embedded_text', 'ocr', 'asr', 'human_transcript', 'machine_caption', 'frame_ocr', 'exif'].includes(withoutDigest.textOrigin)) {
    invalid('claim_extraction_source_invalid');
  }
  return { ...withoutDigest, segmentDigest: relationshipInputSha256(withoutDigest) };
};

const objectValue = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as Record<string, unknown>;
};

const safeInteger = (value: unknown, minimum: number, code: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

const contentBoxToEdges = (value: unknown): [number, number, number, number] | null => {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 4
    || value.some((part) => typeof part !== 'number' || !Number.isFinite(part))) {
    invalid('claim_extraction_content_locator_invalid');
  }
  const [x, y, width, height] = value as [number, number, number, number];
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    invalid('claim_extraction_content_locator_invalid');
  }
  return [x, y, x + width, y + height];
};

export const buildClaimExtractionSourceSegmentFromResearchContent = (params: {
  binding: ClaimEvidencePublicationBinding;
  entry: CaseGraphResearchContentEntry;
  sourceId: string;
  sourceLabel: string;
  lineageId: string;
}): ClaimExtractionSourceSegment => {
  const entry = params.entry;
  requireDigest(entry.chunkDigest, 'claim_extraction_content_integrity_invalid');
  const locator = objectValue(entry.locator, 'claim_extraction_content_locator_invalid');
  let locatorBase: ClaimExtractionSourceSegmentDraft['locatorBase'] | undefined;
  if (locator.locatorType === 'document_page') {
    locatorBase = {
      kind: 'document_page',
      pageNumber: safeInteger(locator.pageNumber, 1, 'claim_extraction_content_locator_invalid'),
      characterOffset: safeInteger(locator.characterStart, 0, 'claim_extraction_content_locator_invalid'),
      boundingBox: contentBoxToEdges(locator.boundingBox),
    };
  } else if (locator.locatorType === 'timed_media') {
    locatorBase = {
      kind: 'timed_media',
      startMilliseconds: safeInteger(locator.startMs, 0, 'claim_extraction_content_locator_invalid'),
      endMilliseconds: safeInteger(locator.endMs, 1, 'claim_extraction_content_locator_invalid'),
      frameNumber: null,
    };
  } else if (locator.locatorType === 'image_region') {
    const boundingBox = contentBoxToEdges(locator.boundingBox)
      ?? invalid('claim_extraction_precise_image_locator_required');
    locatorBase = { kind: 'image_region', boundingBox };
  } else if (locator.locatorType === 'exif_field') {
    locatorBase = {
      kind: 'record_field',
      field: requireId(locator.field, 'claim_extraction_content_locator_invalid'),
      characterOffset: 0,
    };
  } else {
    invalid('claim_extraction_content_locator_invalid');
  }
  return buildClaimExtractionSourceSegment({
    binding: params.binding,
    address: entry.address,
    sourceId: params.sourceId,
    sourceLabel: params.sourceLabel,
    lineageId: params.lineageId,
    mediaKind: entry.mediaKind,
    textOrigin: entry.textOrigin,
    text: entry.text,
    locatorBase: locatorBase ?? invalid('claim_extraction_content_locator_invalid'),
    provenance: {
      assetDigest: entry.assetDigest,
      extractionContractDigest: entry.extractionContractDigest,
      extractionReceiptDigest: entry.extractionReceiptDigest,
      extractionPointerDigest: entry.extractionPointerDigest,
    },
  });
};

export const verifyClaimExtractionSourceSegment = (value: ClaimExtractionSourceSegment): ClaimExtractionSourceSegment => {
  const expected = buildClaimExtractionSourceSegment(value);
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) invalid('claim_extraction_segment_integrity_failed');
  return expected;
};

const buildProposal = (
  draft: ClaimExtractionProposalDraft,
  segments: ReadonlyMap<string, ClaimExtractionSourceSegment>,
): ClaimExtractionProposal => {
  const segmentDigest = requireDigest(draft.segmentDigest, 'claim_extraction_proposal_invalid');
  const segment = segments.get(segmentDigest) ?? invalid('claim_extraction_segment_missing');
  if (!Number.isSafeInteger(draft.quoteStart) || !Number.isSafeInteger(draft.quoteEnd)
    || draft.quoteStart < 0 || draft.quoteEnd <= draft.quoteStart || draft.quoteEnd > segment.text.length) {
    invalid('claim_extraction_quote_invalid');
  }
  const quote = segment.text.slice(draft.quoteStart, draft.quoteEnd);
  requireText(quote, 'claim_extraction_quote_invalid');
  const core = {
    segmentDigest,
    quoteStart: draft.quoteStart,
    quoteEnd: draft.quoteEnd,
    subject: requireText(draft.subject, 'claim_extraction_statement_invalid', 500),
    predicate: requireId(draft.predicate, 'claim_extraction_statement_invalid'),
    object: requireText(draft.object, 'claim_extraction_statement_invalid', 2_000),
    polarity: draft.polarity,
    modality: draft.modality,
    extraction: {
      method: draft.extraction.method,
      version: requireId(draft.extraction.version, 'claim_extraction_method_invalid'),
      confidence: requireConfidence(draft.extraction.confidence),
    },
  };
  if (!['asserted', 'denied'].includes(core.polarity)
    || !['observed', 'reported', 'inferred', 'alleged', 'unknown'].includes(core.modality)
    || !['structured', 'deterministic_rule', 'governed_model'].includes(core.extraction.method)) {
    invalid('claim_extraction_proposal_invalid');
  }
  const proposalId = `claim-proposal:${relationshipInputSha256(core)}`;
  const withoutDigest = { ...core, proposalId };
  return { ...withoutDigest, proposalDigest: relationshipInputSha256(withoutDigest) };
};

export const buildClaimExtractionBatch = (params: {
  binding: ClaimEvidencePublicationBinding;
  segments: ClaimExtractionSourceSegment[];
  proposals: ClaimExtractionProposalDraft[];
}): ClaimExtractionBatch => {
  const segments = params.segments.map(verifyClaimExtractionSourceSegment).sort((left, right) => compareText(left.segmentDigest, right.segmentDigest));
  const byDigest = new Map<string, ClaimExtractionSourceSegment>();
  for (const segment of segments) {
    if (!sameBinding(params.binding, segment.binding) || byDigest.has(segment.segmentDigest)) invalid('claim_extraction_segment_invalid');
    byDigest.set(segment.segmentDigest, segment);
  }
  const proposals = params.proposals.map((proposal) => buildProposal(proposal, byDigest))
    .sort((left, right) => compareText(left.proposalId, right.proposalId));
  if (new Set(proposals.map((proposal) => proposal.proposalId)).size !== proposals.length) invalid('claim_extraction_proposal_duplicate');
  const withoutDigest = {
    recordType: 'case_graph_claim_extraction_batch' as const,
    schemaVersion: CLAIM_EVIDENCE_EXTRACTION_VERSION,
    binding: { ...params.binding },
    segments,
    proposals,
    accounting: { segmentCount: segments.length, proposalCount: proposals.length },
  };
  return { ...withoutDigest, batchDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyClaimExtractionBatch = (value: ClaimExtractionBatch): ClaimExtractionBatch => {
  const expected = buildClaimExtractionBatch({
    binding: value.binding,
    segments: value.segments,
    proposals: value.proposals,
  });
  if (canonicalizeRelationshipInput(value) !== canonicalizeRelationshipInput(expected)) invalid('claim_extraction_batch_integrity_failed');
  return expected;
};

const locatorFor = (
  segment: ClaimExtractionSourceSegment,
  proposal: ClaimExtractionProposal,
): ClaimEvidenceLocator => {
  const base = segment.locatorBase;
  if (base.kind === 'record_field') return {
    kind: base.kind,
    field: base.field,
    characterStart: base.characterOffset + proposal.quoteStart,
    characterEnd: base.characterOffset + proposal.quoteEnd,
  };
  if (base.kind === 'document_page') return {
    kind: base.kind,
    pageNumber: base.pageNumber,
    characterStart: base.characterOffset + proposal.quoteStart,
    characterEnd: base.characterOffset + proposal.quoteEnd,
    boundingBox: base.boundingBox,
  };
  if (base.kind === 'timed_media') return { ...base };
  return { ...base };
};

const requireReviewedAt = (value: string): string => {
  const parsed = Date.parse(value);
  if (!value.endsWith('Z') || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    invalid('claim_adjudication_timestamp_invalid');
  }
  return value;
};

export const adjudicateClaimExtractionBatch = (params: {
  batch: ClaimExtractionBatch;
  decisions: ClaimAdjudicationDecision[];
}): ClaimAdjudicationReceipt => {
  const batch = verifyClaimExtractionBatch(params.batch);
  const proposals = new Map(batch.proposals.map((proposal) => [proposal.proposalId, proposal]));
  const segments = new Map(batch.segments.map((segment) => [segment.segmentDigest, segment]));
  if (params.decisions.length !== proposals.size) invalid('claim_adjudication_incomplete');
  const decisions = params.decisions.map((decision) => ({
    proposalId: requireText(decision.proposalId, 'claim_adjudication_decision_invalid', 80),
    decision: decision.decision,
    rationale: requireText(decision.rationale, 'claim_adjudication_decision_invalid', 2_000),
    reviewerId: requireId(decision.reviewerId, 'claim_adjudication_reviewer_invalid'),
    reviewedAt: requireReviewedAt(decision.reviewedAt),
  })).sort((left, right) => compareText(left.proposalId, right.proposalId));
  if (new Set(decisions.map((decision) => decision.proposalId)).size !== decisions.length
    || decisions.some((decision) => !proposals.has(decision.proposalId)
      || !['accept', 'reject', 'dispute', 'defer'].includes(decision.decision))) invalid('claim_adjudication_decision_invalid');

  const claims: AtomicEvidenceClaim[] = [];
  for (const decision of decisions) {
    if (decision.decision === 'reject' || decision.decision === 'defer') continue;
    const proposal = proposals.get(decision.proposalId) as ClaimExtractionProposal;
    const segment = segments.get(proposal.segmentDigest) as ClaimExtractionSourceSegment;
    claims.push(buildAtomicEvidenceClaim({
      binding: batch.binding,
      address: segment.address,
      sourceId: segment.sourceId,
      subject: proposal.subject,
      predicate: proposal.predicate,
      object: proposal.object,
      polarity: proposal.polarity,
      modality: proposal.modality,
      sourceText: segment.text.slice(proposal.quoteStart, proposal.quoteEnd),
      locator: locatorFor(segment, proposal),
      extraction: {
        method: proposal.extraction.method,
        version: proposal.extraction.version,
        confidence: proposal.extraction.confidence,
        reviewStatus: decision.decision === 'accept' ? 'reviewed' : 'disputed',
      },
    }));
  }
  claims.sort((left, right) => compareText(left.claimId, right.claimId));
  const accounting = {
    accepted: decisions.filter((decision) => decision.decision === 'accept').length,
    rejected: decisions.filter((decision) => decision.decision === 'reject').length,
    disputed: decisions.filter((decision) => decision.decision === 'dispute').length,
    deferred: decisions.filter((decision) => decision.decision === 'defer').length,
    total: decisions.length,
  };
  const withoutDigest = {
    recordType: 'case_graph_claim_adjudication_receipt' as const,
    schemaVersion: CLAIM_EVIDENCE_ADJUDICATION_VERSION,
    binding: batch.binding,
    extractionBatchDigest: batch.batchDigest,
    decisions,
    claims,
    accounting,
  };
  return { ...withoutDigest, receiptDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyClaimAdjudicationReceipt = (params: {
  batch: ClaimExtractionBatch;
  receipt: ClaimAdjudicationReceipt;
}): ClaimAdjudicationReceipt => {
  const expected = adjudicateClaimExtractionBatch({ batch: params.batch, decisions: params.receipt.decisions });
  if (canonicalizeRelationshipInput(params.receipt) !== canonicalizeRelationshipInput(expected)) {
    invalid('claim_adjudication_receipt_integrity_failed');
  }
  return expected;
};

const unknownDimension = <T extends string>(value: T, reason: string, explanation: string) => ({
  value,
  reasonCodes: [reason],
  explanation,
});

export const buildConservativeSourceReliabilityAssessment = (params: {
  segment: ClaimExtractionSourceSegment;
  knownDimensions?: Partial<SourceReliabilityDimensions>;
  limitations?: string[];
  assessorVersion: string;
}): SourceReliabilityAssessment => {
  const segment = verifyClaimExtractionSourceSegment(params.segment);
  const highVolumeLineage = resolveHighVolumeReviewedLineage(segment.sourceId);
  const richGelreichLineage = resolveRichGelreichReviewedLineage(segment.sourceId);
  const skywatchLineage = resolveSkywatchReviewedLineage(segment.sourceId);
  const canadianSurveyLineage = resolveCanadianUfoSurveyReviewedLineage(segment.sourceId);
  const redditLineage = resolveRedditUfoReviewedLineage(segment.sourceId);
  const ukAirproxLineage = resolveUkAirproxReviewedLineage(segment.sourceId);
  const geipanLineage = resolveGeipanReviewedLineage(segment.sourceId);
  const cisuLineage = resolveCisuReviewedLineage(segment.sourceId);
  const hessdalenLineage = resolveHessdalenReviewedLineage(segment.sourceId);
  const revistaUfoLineage = resolveRevistaUfoReviewedLineage(segment.sourceId);
  const buforaLineage = resolveBuforaReviewedLineage(segment.sourceId);
  const afuUfoSverigeLineage = resolveAfuUfoSverigeReviewedLineage(segment.sourceId);
  const sufoiLineage = resolveSufoiReviewedLineage(segment.sourceId);
  const gepLineage = resolveGepReviewedLineage(segment.sourceId);
  const beUfomLineage = resolveBeUfomReviewedLineage(segment.sourceId);
  const cobepsLineage = resolveCobepsReviewedLineage(segment.sourceId);
  const ufocnsLineage = resolveUfocnsReviewedLineage(segment.sourceId);
  const asrsReportSetsLineage = resolveAsrsReportSetsReviewedLineage(segment.sourceId);
  const curatedArchiveLineage = resolveCuratedArchiveReviewedLineage(segment.sourceId);
  const reviewedLineage = highVolumeLineage ?? richGelreichLineage ?? skywatchLineage ?? canadianSurveyLineage ?? redditLineage ?? ukAirproxLineage ?? geipanLineage ?? cisuLineage ?? hessdalenLineage ?? revistaUfoLineage ?? buforaLineage ?? afuUfoSverigeLineage ?? sufoiLineage ?? gepLineage ?? beUfomLineage ?? cobepsLineage ?? ufocnsLineage ?? asrsReportSetsLineage ?? curatedArchiveLineage;
  const reviewedPolicyVersion = highVolumeLineage
    ? HIGH_VOLUME_SOURCE_LINEAGE_POLICY_VERSION
    : richGelreichLineage
      ? RICH_GELREICH_SOURCE_LINEAGE_POLICY_VERSION
      : skywatchLineage
        ? SKYWATCH_SOURCE_LINEAGE_POLICY_VERSION
        : canadianSurveyLineage
          ? CANADIAN_UFO_SURVEY_SOURCE_LINEAGE_POLICY_VERSION
          : redditLineage
            ? REDDIT_UFO_SOURCE_LINEAGE_POLICY_VERSION
            : ukAirproxLineage
              ? UK_AIRPROX_SOURCE_LINEAGE_POLICY_VERSION
              : geipanLineage
                ? GEIPAN_SOURCE_LINEAGE_POLICY_VERSION
                : cisuLineage
                  ? CISU_SOURCE_LINEAGE_POLICY_VERSION
                  : hessdalenLineage
                    ? HESSDALEN_SOURCE_LINEAGE_POLICY_VERSION
                    : revistaUfoLineage
                      ? REVISTA_UFO_SOURCE_LINEAGE_POLICY_VERSION
                      : buforaLineage
                        ? BUFORA_SOURCE_LINEAGE_POLICY_VERSION
                        : afuUfoSverigeLineage
                          ? AFU_UFO_SVERIGE_SOURCE_LINEAGE_POLICY_VERSION
                          : sufoiLineage
                            ? SUFOI_SOURCE_LINEAGE_POLICY_VERSION
                            : gepLineage
                              ? GEP_SOURCE_LINEAGE_POLICY_VERSION
                              : beUfomLineage
                                ? BE_UFOM_SOURCE_LINEAGE_POLICY_VERSION
                                : cobepsLineage
                                  ? COBEPS_SOURCE_LINEAGE_POLICY_VERSION
                                  : ufocnsLineage
                                    ? UFOCNS_SOURCE_LINEAGE_POLICY_VERSION
                                    : asrsReportSetsLineage
                                      ? ASRS_REPORT_SETS_SOURCE_LINEAGE_POLICY_VERSION
                                      : curatedArchiveLineage
                                        ? CURATED_ARCHIVE_SOURCE_LINEAGE_POLICY_VERSION
                                        : null;
  const defaults: SourceReliabilityDimensions = {
    sourcePosition: reviewedLineage
      ? unknownDimension(reviewedLineage.sourcePosition, 'reviewed_source_lineage', 'The source position follows the governed high-volume source review and remains distinct from witness primacy.')
      : unknownDimension('unknown', 'not_established', 'The extracted segment does not establish whether the source is primary or secondary.'),
    contemporaneity: unknownDimension('unknown', 'event_time_not_compared', 'The source date has not been compared with the event date.'),
    witnessIdentity: unknownDimension('unknown', 'identity_not_adjudicated', 'Witness identity has not been adjudicated.'),
    originality: reviewedLineage
      ? unknownDimension(reviewedLineage.originality, 'reviewed_upstream_lineage', reviewedLineage.originality === 'derived'
        ? 'This record is a transformation or aggregation of upstream material rather than a new originating account.'
        : 'The publisher is the origin of this dataset lineage, but the originality of each submitted account remains unadjudicated.')
      : unknownDimension('unknown', 'upstream_original_not_established', 'The extraction chain is known, but the upstream artefact originality is not established.'),
    independence: reviewedLineage
      ? unknownDimension('shared_lineage', 'reviewed_shared_lineage', 'The governed review places this dataset in a shared upstream lineage; a separate dataset label is not independent corroboration.')
      : unknownDimension('unknown', 'lineage_not_compared', 'Independence from other sources has not been established.'),
    provenance: unknownDimension('partial', 'extraction_chain_present', 'The asset and extraction receipts are pinned, but upstream custodial provenance still requires review.'),
    corroboration: reviewedLineage ? {
      ...unknownDimension('shared_lineage_only', 'reviewed_no_independent_credit', 'This dataset can contribute context or repetition analysis but cannot add an independent corroboration vote.'),
      independentSourceCount: 0,
      sharedLineageSourceCount: 1,
    } : {
      ...unknownDimension('unknown', 'corroboration_not_adjudicated', 'No independent corroboration determination has been adjudicated.'),
      independentSourceCount: 0,
      sharedLineageSourceCount: 0,
    },
  };
  return buildSourceReliabilityAssessment({
    binding: segment.binding,
    address: segment.address,
    sourceId: segment.sourceId,
    sourceLabel: segment.sourceLabel,
    lineageId: segment.lineageId,
    dimensions: { ...defaults, ...params.knownDimensions },
    limitations: [
      'This assessment describes source provenance quality and does not determine whether any extracted claim is true.',
      ...(reviewedPolicyVersion ? [
        `Reviewed source-lineage policy ${reviewedPolicyVersion} prevents this dataset from inflating independent corroboration.`,
      ] : []),
      ...(params.limitations ?? []),
    ],
    assessedBy: {
      method: 'deterministic_rule',
      version: requireId(params.assessorVersion, 'source_reliability_assessor_invalid'),
      reviewStatus: 'unreviewed',
    },
  });
};
