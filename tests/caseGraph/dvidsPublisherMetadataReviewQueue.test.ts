import { describe, expect, it } from 'vitest';

import {
  buildDvidsPublisherMetadataReviewQueue,
  verifyDvidsPublisherMetadataReviewQueue,
} from '../../src/caseGraph/dvidsPublisherMetadataReviewQueue';
import {
  buildDvidsRetainedByteInspectionReceipt,
} from '../../src/caseGraph/dvidsRetainedContentByteInspection';
import {
  buildDvidsRetainedContentPreflight,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import { dvidsPreflightFixture } from './dvidsRetainedContentFixtures';

const fixture = () => {
  const base = dvidsPreflightFixture();
  base.objectHeads[0].contentLength = 12;
  const preflight = buildDvidsRetainedContentPreflight({
    builtAt: '2026-07-27T20:10:00.000Z',
    routeReceipt: base.availability.receipt,
    routes: base.availability.routes,
    completion: base.completion,
    universeNodes: [base.dvids],
    rightsSnapshot: base.rightsSnapshot,
    objectHeads: base.objectHeads,
  });
  const admitted = preflight.admitted[0];
  const byteInspection = buildDvidsRetainedByteInspectionReceipt({
    builtAt: '2026-07-27T21:00:00.000Z',
    preflight,
    inspections: [{
      address: admitted.address,
      admissionDigest: admitted.admissionDigest,
      archiveKey: admitted.archiveKey,
      expectedHeadDigest: admitted.objectHead.headDigest,
      expectedEtag: admitted.objectHead.etag,
      declaredContentType: admitted.objectHead.contentType,
      byteLength: 12,
      bytesSha256: '1'.repeat(64),
      sniffedMimeType: 'video/mp4',
      durationMs: 12_345,
      safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
      safetyScanDigest: '2'.repeat(64),
    }],
  });
  const sourceSnapshot = {
    inspectedAt: '2026-07-27T21:05:00.000Z',
    sourceMvccSnapshot: '2:3:',
    transaction: {
      isolation: 'repeatable read' as const,
      readOnly: true as const,
    },
    rows: [{
      id: admitted.address.slice('video:'.length),
      title: 'Official DVIDS title',
      description: 'Publisher supplied description.',
      searchText: 'Official DVIDS title Publisher supplied description.',
      sha256Checksum: '1'.repeat(64),
      updatedAt: admitted.databaseUpdatedAt,
    }],
  };
  return { preflight, byteInspection, sourceSnapshot };
};

describe('DVIDS publisher metadata review queue', () => {
  it('checksum-binds publisher text while keeping every item unreviewed', () => {
    const input = fixture();
    const queue = buildDvidsPublisherMetadataReviewQueue({
      builtAt: '2026-07-27T21:10:00.000Z',
      ...input,
    });
    expect(queue.accounting).toMatchObject({
      expectedObjectCount: 1,
      checksumMatchedRowCount: 1,
      reviewItemCount: 1,
      reviewedItemCount: 0,
      acceptedClaimCount: 0,
    });
    expect(queue.items[0]).toMatchObject({
      reviewStatus: 'unreviewed',
      evidenceSemantics: 'publisher_supplied_metadata',
      title: 'Official DVIDS title',
      description: 'Publisher supplied description.',
    });
    expect(queue.guarantees).toMatchObject({
      exactDatabaseChecksumMatch: true,
      everyItemUnreviewed: true,
      claimsAuthorized: false,
      providerCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
    });
    expect(verifyDvidsPublisherMetadataReviewQueue({
      value: queue,
      preflight: input.preflight,
      byteInspection: input.byteInspection,
    })).toEqual(queue);
  });

  it('fails closed on checksum, update lineage, text, or row omissions', () => {
    const input = fixture();
    const build = (rows: any[]) => buildDvidsPublisherMetadataReviewQueue({
      builtAt: '2026-07-27T21:10:00.000Z',
      preflight: input.preflight,
      byteInspection: input.byteInspection,
      sourceSnapshot: { ...input.sourceSnapshot, rows },
    });
    expect(() => build([]))
      .toThrow('dvids_publisher_review_row_accounting_invalid');
    expect(() => build([{
      ...input.sourceSnapshot.rows[0],
      sha256Checksum: '3'.repeat(64),
    }])).toThrow('dvids_publisher_review_checksum_or_lineage_mismatch');
    expect(() => build([{
      ...input.sourceSnapshot.rows[0],
      updatedAt: '2026-07-27T00:00:00.000Z',
    }])).toThrow('dvids_publisher_review_checksum_or_lineage_mismatch');
    expect(() => build([{
      ...input.sourceSnapshot.rows[0],
      description: '',
    }])).toThrow('dvids_publisher_review_description_invalid');
  });
});
