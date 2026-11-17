import { describe, expect, it, vi } from 'vitest';

import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceLink,
  type ClaimEvidencePublicationBinding,
} from '../../src/caseGraph/claimEvidenceGraph';
import {
  caseGraphResearchPublicationBinding,
  decodeCaseGraphResearchToolRequest,
  executeCaseGraphResearchTool,
  type CaseGraphResearchClaimEvidenceProvider,
} from '../../src/caseGraph/researchToolContract';
import type {
  ActiveCaseGraphPublication,
  CaseGraphPublicStorage,
} from '../../src/caseGraph/publicAccess';

const active = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-23',
  manifestSha256: 'a'.repeat(64),
  manifest: {
    lineage: {
      snapshot: { snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222' },
      graph: { artifactSetSha256: 'b'.repeat(64) },
      relationship: {
        policyVersion: 'relationship-policy-v1',
        policySha256: 'c'.repeat(64),
        modelId: 'relationship-model',
        modelVersion: 'relationship-model-v1',
        modelSha256: 'd'.repeat(64),
      },
      calibration: { set: { calibrationSetSha256: 'e'.repeat(64) } },
    },
    models: { relationshipSchemaVersion: 'typed-relationship-v1' },
  },
} as unknown as ActiveCaseGraphPublication;

const storage: CaseGraphPublicStorage = {
  readObject: vi.fn(async () => null),
};

const publication = caseGraphResearchPublicationBinding(active);
const binding: ClaimEvidencePublicationBinding = {
  publicationId: publication.publicationId,
  corpusVersion: publication.corpusVersion,
  manifestSha256: publication.manifestSha256,
  snapshotId: publication.snapshotId,
  graphArtifactSetSha256: publication.graphArtifactSetSha256,
};

const witness = buildAtomicEvidenceClaim({
  binding,
  address: 'document:fixture-witness',
  sourceId: 'fixture_witness',
  subject: 'fixture witness',
  predicate: 'observed',
  object: 'unusual material',
  polarity: 'asserted',
  modality: 'reported',
  sourceText: 'The fixture witness reported unusual material.',
  locator: { kind: 'record_field', field: 'summary', characterStart: 0, characterEnd: 46 },
  extraction: { method: 'manual_review', version: 'claim-review-v1', confidence: 1, reviewStatus: 'reviewed' },
});
const official = buildAtomicEvidenceClaim({
  binding,
  address: 'document:fixture-official',
  sourceId: 'fixture_official',
  subject: 'fixture agency',
  predicate: 'explained_as',
  object: 'conventional material',
  polarity: 'asserted',
  modality: 'reported',
  sourceText: 'The fixture agency attributed it to conventional material.',
  locator: { kind: 'record_field', field: 'summary', characterStart: 0, characterEnd: 58 },
  extraction: { method: 'manual_review', version: 'claim-review-v1', confidence: 1, reviewStatus: 'reviewed' },
});
const contradiction = buildClaimEvidenceLink({
  binding,
  fromClaimId: official.claimId,
  toClaimId: witness.claimId,
  stance: 'contradicts',
  lineage: 'independent',
  rationale: 'The official explanation conflicts with the witness interpretation.',
  confidence: 0.9,
  determination: { method: 'manual_review', version: 'claim-link-review-v1', reviewStatus: 'reviewed' },
});

const request = {
  tool: 'analyze_case_claims',
  caseId: 'fixture-case',
  title: 'Fixture claim positions',
  addresses: [witness.address, official.address],
  focalClaimIds: [witness.claimId, official.claimId],
  witnessClaimIds: [witness.claimId],
  officialConclusionClaimIds: [official.claimId],
  unresolvedQuestions: [{
    question: 'What original material can still be examined?',
    relevantClaimIds: [witness.claimId, official.claimId],
    evidenceNeeded: ['Authenticated original material with a documented custody chain.'],
    status: 'open',
  }],
  limitations: ['The fixture compares attributed positions and does not decide event truth.'],
};

const provider = (hasMore = false): CaseGraphResearchClaimEvidenceProvider => ({
  inspectClaims: vi.fn(async ({ address }) => ({
    artifactDigest: '1'.repeat(64),
    completionReceiptSha256: '2'.repeat(64),
    claims: [address === witness.address ? witness : official],
    relatedClaims: [address === witness.address ? official : witness],
    links: [contradiction],
    sourceReliability: [],
    hasMore,
  })),
  inspectSourceReliability: vi.fn(async () => ({
    artifactDigest: '1'.repeat(64),
    completionReceiptSha256: '2'.repeat(64),
    assessments: [],
  })),
});

describe('Case Graph claim-analysis research tool', () => {
  it('builds a bounded verified case analysis only from inspected claim evidence', async () => {
    const claimEvidence = provider();
    const result = await executeCaseGraphResearchTool({
      active,
      storage,
      request,
      claimEvidence,
    });
    expect(result.tool).toBe('analyze_case_claims');
    expect(result.data).toMatchObject({
      sourceArtifactDigest: '1'.repeat(64),
      completionReceiptSha256: '2'.repeat(64),
      analysis: {
        caseId: 'fixture-case',
        witnessClaims: [{ claim: { claimId: witness.claimId } }],
        officialConclusions: [{ claim: { claimId: official.claimId } }],
        contradictions: [{
          link: { linkId: contradiction.linkId },
          independentCorroborationCredit: false,
        }],
        accounting: {
          witnessClaimCount: 1,
          officialConclusionCount: 1,
          contradictionCount: 1,
          independentSupportCount: 0,
          missingReliabilityAssessmentCount: 2,
        },
      },
    });
    expect(result.warnings.join(' ')).toContain('does not decide the event');
    expect(claimEvidence.inspectClaims).toHaveBeenCalledTimes(2);
    expect(storage.readObject).not.toHaveBeenCalled();
  });

  it('rejects invented claim IDs and incomplete provider pages', async () => {
    expect(() => decodeCaseGraphResearchToolRequest({
      ...request,
      witnessClaimIds: ['claim:not-real'],
    })).toThrow('case_graph_research_request_invalid');
    await expect(executeCaseGraphResearchTool({
      active,
      storage,
      request,
      claimEvidence: provider(true),
    })).rejects.toThrow('case_graph_research_claim_analysis_incomplete');
  });
});
