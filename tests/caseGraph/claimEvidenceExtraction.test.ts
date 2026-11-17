import { describe, expect, it } from 'vitest';

import {
  adjudicateClaimExtractionBatch,
  buildClaimExtractionBatch,
  buildClaimExtractionSourceSegment,
  buildClaimExtractionSourceSegmentFromResearchContent,
  buildConservativeSourceReliabilityAssessment,
  verifyClaimAdjudicationReceipt,
  verifyClaimExtractionBatch,
} from '../../src/caseGraph/claimEvidenceExtraction';
import type { ClaimEvidencePublicationBinding } from '../../src/caseGraph/claimEvidenceGraph';

const binding: ClaimEvidencePublicationBinding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};

const sourceText = 'The witness reported a bright object. The catalogue copied that account.';

const makeSegment = () => buildClaimExtractionSourceSegment({
  binding,
  address: 'document:synthetic-evaluation-page',
  sourceId: 'synthetic_archive',
  sourceLabel: 'Synthetic evaluation archive',
  lineageId: 'synthetic_lineage_a',
  mediaKind: 'document',
  textOrigin: 'embedded_text',
  text: sourceText,
  locatorBase: {
    kind: 'document_page',
    pageNumber: 7,
    characterOffset: 120,
    boundingBox: [0.1, 0.2, 0.9, 0.4],
  },
  provenance: {
    assetDigest: 'c'.repeat(64),
    extractionContractDigest: 'd'.repeat(64),
    extractionReceiptDigest: 'e'.repeat(64),
    extractionPointerDigest: 'f'.repeat(64),
  },
});

const proposalFor = (segmentDigest: string, quoteStart = 0, quoteEnd = 37) => ({
  segmentDigest,
  quoteStart,
  quoteEnd,
  subject: 'the witness',
  predicate: 'reported_observation',
  object: 'a bright object',
  polarity: 'asserted' as const,
  modality: 'reported' as const,
  extraction: {
    method: 'governed_model' as const,
    version: 'luna-claim-extractor-v1',
    confidence: 0.91,
  },
});

describe('governed claim extraction and adjudication', () => {
  it('pins every proposal to exact source bytes and produces deterministic batches', () => {
    const segment = makeSegment();
    const first = buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [proposalFor(segment.segmentDigest)],
    });
    const second = buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [proposalFor(segment.segmentDigest)],
    });

    expect(first).toEqual(second);
    expect(first.batchDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.proposals[0]?.proposalId).toMatch(/^claim-proposal:[a-f0-9]{64}$/);
    expect(verifyClaimExtractionBatch(first)).toEqual(first);
  });

  it('publishes only accepted or disputed proposals and records every decision', () => {
    const segment = makeSegment();
    const batch = buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [
        proposalFor(segment.segmentDigest),
        {
          ...proposalFor(segment.segmentDigest, 38, sourceText.length),
          subject: 'the catalogue',
          predicate: 'repeated_account',
          object: 'the witness account',
        },
      ],
    });
    const [first, second] = batch.proposals;
    if (!first || !second) throw new Error('fixture_missing');
    const receipt = adjudicateClaimExtractionBatch({
      batch,
      decisions: [
        {
          proposalId: first.proposalId,
          decision: 'accept',
          rationale: 'The statement and attribution are explicit in the quoted span.',
          reviewerId: 'reviewer_fixture_01',
          reviewedAt: '2026-07-20T12:00:00.000Z',
        },
        {
          proposalId: second.proposalId,
          decision: 'reject',
          rationale: 'The wording does not identify the upstream account precisely enough.',
          reviewerId: 'reviewer_fixture_01',
          reviewedAt: '2026-07-20T12:01:00.000Z',
        },
      ],
    });

    expect(receipt.accounting).toEqual({ accepted: 1, rejected: 1, disputed: 0, deferred: 0, total: 2 });
    expect(receipt.claims).toHaveLength(1);
    expect(receipt.claims[0]).toMatchObject({
      sourceText: 'The witness reported a bright object.',
      locator: { kind: 'document_page', pageNumber: 7, characterStart: 120, characterEnd: 157 },
      extraction: { reviewStatus: 'reviewed' },
    });
    expect(verifyClaimAdjudicationReceipt({ batch, receipt })).toEqual(receipt);
  });

  it('fails closed on missing decisions, tampering, invalid spans and unknown source segments', () => {
    const segment = makeSegment();
    const batch = buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [proposalFor(segment.segmentDigest)],
    });

    expect(() => adjudicateClaimExtractionBatch({ batch, decisions: [] }))
      .toThrow('claim_adjudication_incomplete');
    expect(() => verifyClaimExtractionBatch({ ...batch, accounting: { segmentCount: 9, proposalCount: 1 } }))
      .toThrow('claim_extraction_batch_integrity_failed');
    expect(() => buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [proposalFor(segment.segmentDigest, 0, sourceText.length + 1)],
    })).toThrow('claim_extraction_quote_invalid');
    expect(() => buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [proposalFor('9'.repeat(64))],
    })).toThrow('claim_extraction_segment_missing');
  });

  it('keeps deferred model proposals out of the published claim set', () => {
    const segment = makeSegment();
    const batch = buildClaimExtractionBatch({
      binding,
      segments: [segment],
      proposals: [proposalFor(segment.segmentDigest)],
    });
    const proposal = batch.proposals[0]!;
    const receipt = adjudicateClaimExtractionBatch({
      batch,
      decisions: [{
        proposalId: proposal.proposalId,
        decision: 'defer',
        rationale: 'Awaiting an independent human review of attribution and atomicity.',
        reviewerId: 'review_queue_policy_v1',
        reviewedAt: '2026-07-20T12:02:00.000Z',
      }],
    });

    expect(receipt.claims).toEqual([]);
    expect(receipt.accounting).toEqual({ accepted: 0, rejected: 0, disputed: 0, deferred: 1, total: 1 });
  });

  it('defaults reliability to indeterminate until dimensions are evidenced', () => {
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment: makeSegment(),
      assessorVersion: 'source-ledger-bootstrap-v1',
    });

    expect(assessment.overall.category).toBe('indeterminate');
    expect(assessment.dimensions.provenance.value).toBe('partial');
    expect(assessment.assessedBy.reviewStatus).toBe('unreviewed');
    expect(assessment.limitations.join(' ')).toContain('does not determine');
  });

  it('gives reviewed derivative datasets zero independent corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'nuforc_enhanced',
      sourceLabel: 'NUFORC enhanced mirror',
      lineageId: 'governance:nuforc-derived',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.overall.category).toBe('low');
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('prevents this dataset from inflating independent corroboration');
  });

  it('gives reviewed Rich Gelreich transforms zero independent corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'rich_gelreich_eberhart_openai',
      sourceLabel: 'Eberhart AI transform',
      lineageId: 'governance:rich-gelreich:eberhart',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-rich-gelreich-source-lineage-v1');
  });

  it('gives the mixed SKYWATCH aggregator zero independent corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'skywatch',
      sourceLabel: 'SKYWATCH aggregate feed',
      lineageId: 'governance:skywatch:mixed-aggregator',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-skywatch-source-lineage-v1');
  });

  it('gives the Canadian UFO Survey compilation zero independent corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'canadian_ufo_survey',
      sourceLabel: 'Canadian UFO Survey',
      lineageId: 'governance:canadian-ufo-survey:mixed-compilation',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-canadian-ufo-survey-source-lineage-v1');
  });

  it('gives Reddit platform references zero independent corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'reddit_ufo',
      sourceLabel: 'Reddit platform reference',
      lineageId: 'governance:reddit:platform-reference',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'mixed' },
      originality: { value: 'unknown' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-reddit-ufo-source-lineage-v1');
  });

  it('keeps UKAB official assessments distinct from independent corroboration of reporter claims', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'uk_airprox',
      sourceLabel: 'UK Airprox Board',
      lineageId: 'governance:uk-airprox-board:official-air-safety-reports',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'mixed' },
      originality: { value: 'original' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-uk-airprox-source-lineage-v1');
  });

  it('keeps GEIPAN classification authority distinct from independent witness corroboration', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'fr_geipan',
      sourceLabel: 'CNES GEIPAN',
      lineageId: 'governance:cnes-geipan:official-case-catalogue',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'mixed' },
      originality: { value: 'original' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-geipan-source-lineage-v1');
  });

  it('treats legacy CISU rows as a shared secondary index, not independent reports', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'cisu',
      sourceLabel: 'CISU via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-cisu-uapcheck-lineage-v1');
  });

  it('separates Hessdalen project registration from corroboration of witness claims', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'hessdalen',
      sourceLabel: 'Project Hessdalen',
      lineageId: 'governance:project-hessdalen:registered-observations',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'mixed' },
      originality: { value: 'original' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-hessdalen-source-lineage-v1');
  });

  it('treats Revista UFO articles as secondary editorial repetition', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'revista_ufo',
      sourceLabel: 'Revista UFO',
      lineageId: 'governance:revista-ufo:editorial-avistamentos-category',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-revista-ufo-editorial-lineage-v1');
  });

  it('separates BUFORA investigation provenance from witness corroboration', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'bufora',
      sourceLabel: 'British UFO Research Association',
      lineageId: 'governance:bufora:published-investigation-reports',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'mixed' },
      originality: { value: 'original' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-bufora-investigation-lineage-v1');
  });

  it('treats AFU/UFO-Sverige legacy labels as shared Euro UFO Index repetition', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(),
      sourceId: 'afu_ufo_sverige',
      sourceLabel: 'UFO-Sverige via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment,
      assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' },
      originality: { value: 'derived' },
      independence: { value: 'shared_lineage' },
      corroboration: {
        value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
      },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-afu-ufo-sverige-uapcheck-lineage-v1');
  });

  it('gives SUFOI shared-index and editorial references zero corroboration credit', () => {
    for (const sourceId of ['sufoi_uapcheck', 'sufoi_editorial_reference']) {
      const segment = buildClaimExtractionSourceSegment({
        ...makeSegment(),
        sourceId,
        sourceLabel: sourceId,
        lineageId: 'unknown:legacy-import',
      });
      const assessment = buildConservativeSourceReliabilityAssessment({
        segment,
        assessorVersion: 'source-ledger-bootstrap-v2',
      });
      expect(assessment.dimensions).toMatchObject({
        sourcePosition: { value: 'secondary' },
        originality: { value: 'derived' },
        corroboration: {
          value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1,
        },
      });
      expect(assessment.limitations.join(' ')).toContain('case-vortex-sufoi-source-lineage-v1');
    }
  });

  it('gives GEP shared-index and publication-archive references zero corroboration credit', () => {
    for (const sourceId of ['gep_uapcheck', 'gep_publication_archive_reference']) {
      const segment = buildClaimExtractionSourceSegment({
        ...makeSegment(), sourceId, sourceLabel: sourceId, lineageId: 'unknown:legacy-import',
      });
      const assessment = buildConservativeSourceReliabilityAssessment({ segment, assessorVersion: 'source-ledger-bootstrap-v2' });
      expect(assessment.dimensions).toMatchObject({
        sourcePosition: { value: 'secondary' }, originality: { value: 'derived' },
        corroboration: { value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1 },
      });
      expect(assessment.limitations.join(' ')).toContain('case-vortex-gep-source-lineage-v1');
    }
  });

  it('gives BE-UFOM shared-index and website references zero corroboration credit', () => {
    for (const sourceId of ['be_ufom_uapcheck', 'be_ufom_website_reference']) {
      const segment = buildClaimExtractionSourceSegment({
        ...makeSegment(), sourceId, sourceLabel: sourceId, lineageId: 'unknown:legacy-import',
      });
      const assessment = buildConservativeSourceReliabilityAssessment({ segment, assessorVersion: 'source-ledger-bootstrap-v2' });
      expect(assessment.dimensions).toMatchObject({
        sourcePosition: { value: 'secondary' }, originality: { value: 'derived' },
        corroboration: { value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1 },
      });
      expect(assessment.limitations.join(' ')).toContain('case-vortex-be-ufom-source-lineage-v1');
    }
  });

  it('gives COBEPS shared-index and publication references zero corroboration credit', () => {
    for (const sourceId of ['cobeps_uapcheck', 'cobeps_website_reference']) {
      const segment = buildClaimExtractionSourceSegment({
        ...makeSegment(), sourceId, sourceLabel: sourceId, lineageId: 'unknown:legacy-import',
      });
      const assessment = buildConservativeSourceReliabilityAssessment({ segment, assessorVersion: 'source-ledger-bootstrap-v2' });
      expect(assessment.dimensions).toMatchObject({
        sourcePosition: { value: 'secondary' }, originality: { value: 'derived' },
        corroboration: { value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1 },
      });
      expect(assessment.limitations.join(' ')).toContain('case-vortex-cobeps-source-lineage-v1');
    }
  });

  it('gives UFOCNS platform references zero corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(), sourceId: 'ufocns', sourceLabel: 'UFOCNS', lineageId: 'unknown:legacy-import',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({ segment, assessorVersion: 'source-ledger-bootstrap-v2' });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'mixed' }, originality: { value: 'unknown' },
      corroboration: { value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1 },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-ufocns-platform-lineage-v1');
  });
  it('gives NASA ASRS soft-data report references zero corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({ ...makeSegment(), sourceId: 'asrs_reportsets',
      sourceLabel: 'NASA ASRS', lineageId: 'unknown:legacy-import' });
    const assessment = buildConservativeSourceReliabilityAssessment({ segment, assessorVersion: 'source-ledger-bootstrap-v2' });
    expect(assessment.dimensions).toMatchObject({ sourcePosition: { value: 'mixed' }, originality: { value: 'original' },
      corroboration: { value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1 } });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-asrs-report-sets-lineage-v1');
  });

  it('gives retired curated editorial references zero corroboration credit', () => {
    const segment = buildClaimExtractionSourceSegment({
      ...makeSegment(), sourceId: 'curated_archive', sourceLabel: 'Retired curated reference',
      lineageId: 'unknown:legacy-import',
    });
    const assessment = buildConservativeSourceReliabilityAssessment({
      segment, assessorVersion: 'source-ledger-bootstrap-v2',
    });
    expect(assessment.dimensions).toMatchObject({
      sourcePosition: { value: 'secondary' }, originality: { value: 'derived' },
      corroboration: { value: 'shared_lineage_only', independentSourceCount: 0, sharedLineageSourceCount: 1 },
    });
    expect(assessment.limitations.join(' ')).toContain('case-vortex-curated-archive-lineage-v1');
  });

  it('adapts verified content-search entries without losing page, time or region precision', () => {
    const common = {
      chunkId: 'content-chunk:test',
      chunkDigest: '1'.repeat(64),
      address: 'document:governed-content',
      assetId: 'asset:test',
      assetDigest: '2'.repeat(64),
      extractionContractDigest: '3'.repeat(64),
      extractionReceiptDigest: '4'.repeat(64),
      extractionPointerDigest: '5'.repeat(64),
      text: 'Exact governed source text.',
      language: 'en',
      confidence: 0.99,
      scoreMicros: 900_000,
    };
    const page = buildClaimExtractionSourceSegmentFromResearchContent({
      binding,
      sourceId: 'governed_archive',
      sourceLabel: 'Governed archive',
      lineageId: 'governed_archive_original',
      entry: {
        ...common,
        mediaKind: 'document',
        textOrigin: 'ocr',
        locator: {
          locatorType: 'document_page', pageNumber: 8, characterStart: 40,
          characterEnd: 67, readingOrder: 2, boundingBox: [0.1, 0.2, 0.4, 0.3],
        },
      },
    });
    expect(page.locatorBase).toEqual({
      kind: 'document_page', pageNumber: 8, characterOffset: 40,
      boundingBox: [0.1, 0.2, 0.5, 0.5],
    });

    const timed = buildClaimExtractionSourceSegmentFromResearchContent({
      binding,
      sourceId: 'governed_archive',
      sourceLabel: 'Governed archive',
      lineageId: 'governed_archive_original',
      entry: {
        ...common,
        address: 'video:governed-content',
        mediaKind: 'video',
        textOrigin: 'asr',
        locator: { locatorType: 'timed_media', startMs: 1_000, endMs: 3_000, keyframeMs: 2_000 },
      },
    });
    expect(timed.locatorBase).toEqual({
      kind: 'timed_media', startMilliseconds: 1_000, endMilliseconds: 3_000, frameNumber: null,
    });

    expect(() => buildClaimExtractionSourceSegmentFromResearchContent({
      binding,
      sourceId: 'governed_archive',
      sourceLabel: 'Governed archive',
      lineageId: 'governed_archive_original',
      entry: {
        ...common,
        address: 'photo:no-region',
        mediaKind: 'image',
        textOrigin: 'frame_ocr',
        locator: { locatorType: 'image_region', boundingBox: null },
      },
    })).toThrow('claim_extraction_precise_image_locator_required');
  });
});
