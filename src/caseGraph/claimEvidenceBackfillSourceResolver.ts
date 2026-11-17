import type {
  ClaimEvidenceBackfillSourceMetadata,
} from './claimEvidenceFullCorpusBackfill';
import type { CaseGraphResearchContentEntry } from './researchToolContract';
import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import { resolveHighVolumeReviewedLineage } from './highVolumeSourceGovernanceReview';
import { resolveRichGelreichReviewedLineage } from './richGelreichSourceLineage';
import { resolveSkywatchReviewedLineage } from './skywatchSourceLineage';
import { resolveCanadianUfoSurveyReviewedLineage } from './canadianUfoSurveySourceLineage';
import { resolveRedditUfoReviewedLineage } from './redditUfoSourceLineage';
import { resolveUkAirproxReviewedLineage } from './ukAirproxSourceLineage';
import { resolveGeipanReviewedLineage } from './geipanSourceLineage';
import { resolveCisuReviewedLineage } from './cisuSourceLineage';
import { resolveHessdalenReviewedLineage } from './hessdalenSourceLineage';
import { resolveRevistaUfoReviewedLineage } from './revistaUfoSourceLineage';
import { resolveBuforaReviewedLineage } from './buforaSourceLineage';
import { resolveAfuUfoSverigeReviewedLineage } from './afuUfoSverigeSourceLineage';
import { resolveSufoiReviewedLineage } from './sufoiSourceLineage';
import { resolveGepReviewedLineage } from './gepSourceLineage';
import { resolveBeUfomReviewedLineage } from './beUfomSourceLineage';
import { resolveCobepsReviewedLineage } from './cobepsSourceLineage';
import { resolveUfocnsReviewedLineage } from './ufocnsSourceLineage';
import { resolveAsrsReportSetsReviewedLineage } from './asrsReportSetsSourceLineage';
import { resolveCuratedArchiveReviewedLineage } from './curatedArchiveSourceLineage';
import { resolveCaseGraphSource } from './sourceRegistry';

export const CLAIM_EVIDENCE_BACKFILL_SOURCE_RESOLVER_VERSION = 'case-graph-claim-evidence-source-resolver-v20' as const;

const fail = (code: string): never => { throw new Error(code); };

export const createClaimEvidenceBackfillSourceMetadataResolver = (params: {
  relationshipRecords: RelationshipInputRecord[];
  relationshipBinding: RelationshipInputUniverseBinding;
}): ((entry: CaseGraphResearchContentEntry) => ClaimEvidenceBackfillSourceMetadata) => {
  const byAddress = new Map<string, ClaimEvidenceBackfillSourceMetadata>();
  for (const value of params.relationshipRecords) {
    const record = decodeRelationshipInputRecord(value, params.relationshipBinding);
    const governed = resolveCaseGraphSource(record.source.sourceId);
    const reviewedLineage = resolveHighVolumeReviewedLineage(record.source.sourceId)
      ?? resolveRichGelreichReviewedLineage(record.source.sourceId)
      ?? resolveSkywatchReviewedLineage(record.source.sourceId)
      ?? resolveCanadianUfoSurveyReviewedLineage(record.source.sourceId)
      ?? resolveRedditUfoReviewedLineage(record.source.sourceId)
      ?? resolveUkAirproxReviewedLineage(record.source.sourceId)
      ?? resolveGeipanReviewedLineage(record.source.sourceId)
      ?? resolveCisuReviewedLineage(record.source.sourceId)
      ?? resolveHessdalenReviewedLineage(record.source.sourceId)
      ?? resolveRevistaUfoReviewedLineage(record.source.sourceId)
      ?? resolveBuforaReviewedLineage(record.source.sourceId)
      ?? resolveAfuUfoSverigeReviewedLineage(record.source.sourceId)
      ?? resolveSufoiReviewedLineage(record.source.sourceId)
      ?? resolveGepReviewedLineage(record.source.sourceId)
      ?? resolveBeUfomReviewedLineage(record.source.sourceId)
      ?? resolveCobepsReviewedLineage(record.source.sourceId)
      ?? resolveUfocnsReviewedLineage(record.source.sourceId)
      ?? resolveAsrsReportSetsReviewedLineage(record.source.sourceId)
      ?? resolveCuratedArchiveReviewedLineage(record.source.sourceId);
    const metadata = {
      sourceId: record.source.sourceId,
      sourceLabel: governed.label,
      lineageId: reviewedLineage?.lineageId ?? record.source.lineageId,
    };
    const existing = byAddress.get(record.address);
    if (existing && canonicalizeRelationshipInput(existing) !== canonicalizeRelationshipInput(metadata)) {
      fail('claim_backfill_source_resolver_conflict');
    }
    byAddress.set(record.address, metadata);
  }
  return (entry) => {
    const metadata = byAddress.get(entry.address) ?? fail('claim_backfill_source_metadata_missing');
    return { ...metadata };
  };
};
