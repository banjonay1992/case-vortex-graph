import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_CLAIM_DISCIPLINE,
  buildAtomicEvidenceClaim,
  buildClaimEvidenceGraphArtifact,
  buildClaimEvidenceLink,
  buildSourceReliabilityAssessment,
  type ClaimEvidencePublicationBinding,
  type SourceReliabilityAssessmentDraft,
} from '../../src/caseGraph/claimEvidenceGraph';

const binding: ClaimEvidencePublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const reliabilityDraft = (
  overrides: Partial<SourceReliabilityAssessmentDraft['dimensions']> = {},
): SourceReliabilityAssessmentDraft => ({
  binding,
  address: 'document:roswell-army-air-field-release',
  sourceId: 'us_army_air_forces',
  sourceLabel: 'Roswell Army Air Field',
  lineageId: 'us_army_air_forces',
  dimensions: {
    sourcePosition: { value: 'primary', reasonCodes: ['originating_office'], explanation: 'Issued by the office named in the release.' },
    contemporaneity: { value: 'contemporaneous', reasonCodes: ['same_day_release'], explanation: 'The release was issued during the event period.' },
    witnessIdentity: { value: 'institutional', reasonCodes: ['named_institution'], explanation: 'The statement is attributable to a named institution.' },
    originality: { value: 'original', reasonCodes: ['original_release'], explanation: 'The artefact is the originating release rather than a catalogue copy.' },
    independence: { value: 'independent', reasonCodes: ['originating_lineage'], explanation: 'The source is not derived from another record in this comparison.' },
    provenance: { value: 'complete', reasonCodes: ['traceable_archive_chain'], explanation: 'The publication and archive chain are recorded.' },
    corroboration: {
      value: 'single_independent', reasonCodes: ['one_independent_lineage'], explanation: 'One separate lineage is linked.',
      independentSourceCount: 1, sharedLineageSourceCount: 0,
    },
    ...overrides,
  },
  limitations: ['Institutional attribution does not establish that the event interpretation was correct.'],
  assessedBy: { method: 'manual_review', version: 'ledger-review-v1', reviewStatus: 'reviewed' },
});

describe('claim-level evidence graph', () => {
  it('creates deterministic atomic claims with an exact navigable source locator', () => {
    const draft = {
      binding,
      address: 'document:roswell-army-air-field-release',
      sourceId: 'us_army_air_forces',
      subject: 'Roswell Army Air Field personnel',
      predicate: 'recovered_object',
      object: 'a flying disc',
      polarity: 'asserted' as const,
      modality: 'reported' as const,
      sourceText: 'The many rumors regarding the flying disc became a reality yesterday.',
      locator: {
        kind: 'document_page' as const,
        pageNumber: 1,
        characterStart: 0,
        characterEnd: 71,
        boundingBox: [0.08, 0.12, 0.91, 0.24] as [number, number, number, number],
      },
      extraction: {
        method: 'manual_review' as const,
        version: 'claim-review-v1',
        confidence: 1,
        reviewStatus: 'reviewed' as const,
      },
    };
    const first = buildAtomicEvidenceClaim(draft);
    const second = buildAtomicEvidenceClaim(draft);
    expect(first).toEqual(second);
    expect(first.claimId).toMatch(/^claim:[a-f0-9]{64}$/);
    expect(first.claimDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.locator).toEqual(expect.objectContaining({ kind: 'document_page', pageNumber: 1 }));
    expect(first.claimDiscipline).toEqual(CASE_GRAPH_CLAIM_DISCIPLINE);
  });

  it('keeps repetition separate from independent corroboration', () => {
    const first = buildAtomicEvidenceClaim({
      binding, address: 'document:source-a', sourceId: 'source_a', subject: 'Witness A',
      predicate: 'observed', object: 'disc', polarity: 'asserted', modality: 'reported',
      sourceText: 'Witness A reported a disc.',
      locator: { kind: 'record_field', field: 'summary', characterStart: 0, characterEnd: 26 },
      extraction: { method: 'manual_review', version: 'claim-review-v1', confidence: 1, reviewStatus: 'reviewed' },
    });
    const copy = buildAtomicEvidenceClaim({
      binding, address: 'document:source-a-copy', sourceId: 'catalogue_copy', subject: 'Witness A',
      predicate: 'observed', object: 'disc', polarity: 'asserted', modality: 'reported',
      sourceText: 'A catalogue repeats that Witness A reported a disc.',
      locator: { kind: 'record_field', field: 'summary', characterStart: 0, characterEnd: 49 },
      extraction: { method: 'manual_review', version: 'claim-review-v1', confidence: 1, reviewStatus: 'reviewed' },
    });
    const repeated = buildClaimEvidenceLink({
      binding, fromClaimId: copy.claimId, toClaimId: first.claimId, stance: 'repeats',
      lineage: 'shared_lineage', rationale: 'The catalogue explicitly attributes the statement to the first record.',
      confidence: 1, determination: { method: 'manual_review', version: 'claim-link-review-v1', reviewStatus: 'reviewed' },
    });
    expect(repeated.stance).toBe('repeats');
    expect(repeated.lineage).toBe('shared_lineage');
    expect(() => buildClaimEvidenceLink({
      ...repeated,
      lineage: 'independent',
    })).toThrow('claim_evidence_repetition_independence_invalid');

    const graph = buildClaimEvidenceGraphArtifact({
      binding, claims: [copy, first], links: [repeated], sourceReliability: [],
    });
    expect(graph.accounting).toMatchObject({
      claimCount: 2, linkCount: 1, independentSupportCount: 0, repeatedOrSharedLineageCount: 1,
    });
  });

  it('derives an explainable source category without treating it as claim truth', () => {
    const assessment = buildSourceReliabilityAssessment(reliabilityDraft());
    expect(assessment.overall).toMatchObject({
      category: 'high', reasonCodes: ['primary_near_event_original_traceable'],
    });
    expect(assessment.overall.explanation).toContain('does not verify the claim');
    expect(assessment.claimDiscipline.reliabilityMeaning).toBe('source_provenance_quality_not_claim_truth');

    const copied = buildSourceReliabilityAssessment(reliabilityDraft({
      originality: { value: 'copy', reasonCodes: ['catalogue_copy'], explanation: 'This is a copy of an upstream report.' },
      independence: { value: 'shared_lineage', reasonCodes: ['same_upstream_report'], explanation: 'The record repeats the same upstream lineage.' },
      corroboration: {
        value: 'shared_lineage_only', reasonCodes: ['no_independent_lineage'], explanation: 'All linked records share one source lineage.',
        independentSourceCount: 0, sharedLineageSourceCount: 3,
      },
    }));
    expect(copied.overall.category).toBe('low');
    expect(copied.overall.explanation).toContain('does not establish that the claim is false');
  });

  it('fails closed on invalid locators, false corroboration counts and tampering', () => {
    expect(() => buildSourceReliabilityAssessment(reliabilityDraft({
      corroboration: {
        value: 'multiple_independent', reasonCodes: ['claimed_multiple'], explanation: 'Invalid fixture.',
        independentSourceCount: 1, sharedLineageSourceCount: 0,
      },
    }))).toThrow('source_reliability_corroboration_invalid');

    expect(() => buildAtomicEvidenceClaim({
      binding, address: 'document:bad-locator', sourceId: 'source', subject: 'a', predicate: 'observed', object: 'b',
      polarity: 'asserted', modality: 'reported', sourceText: 'text',
      locator: { kind: 'image_region', boundingBox: [0.7, 0.2, 0.4, 0.8] },
      extraction: { method: 'governed_model', version: 'extract-v1', confidence: 0.8, reviewStatus: 'unreviewed' },
    })).toThrow('claim_evidence_locator_invalid');

    const claim = buildAtomicEvidenceClaim({
      binding, address: 'document:source-a', sourceId: 'source_a', subject: 'a', predicate: 'observed', object: 'b',
      polarity: 'asserted', modality: 'reported', sourceText: 'a observed b',
      locator: { kind: 'record_field', field: 'summary', characterStart: 0, characterEnd: 12 },
      extraction: { method: 'manual_review', version: 'claim-review-v1', confidence: 1, reviewStatus: 'reviewed' },
    });
    expect(() => buildClaimEvidenceGraphArtifact({
      binding,
      claims: [{ ...claim, object: 'tampered' }],
      links: [],
      sourceReliability: [],
    })).toThrow('claim_evidence_artifact_claim_invalid');
  });
});
