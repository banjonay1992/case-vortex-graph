import { describe, expect, it } from 'vitest';

import {
  buildDvidsPublisherClaimReviewAssignment,
} from '../../src/caseGraph/dvidsPublisherClaimReview';
import {
  buildDvidsPublisherClaimReviewWorkbook,
} from '../../src/caseGraph/dvidsPublisherClaimReviewWorkbook';
import { dvidsPublisherReviewFixture } from './dvidsRetainedContentFixtures';

describe('DVIDS publisher claim review workbook', () => {
  it('renders an offline exact-text selection and attestation surface safely', () => {
    const fixture = dvidsPublisherReviewFixture();
    fixture.queue.items[0].title = '</script><script>alert(1)</script>';
    fixture.queue.items[0].titleSha256 =
      fixture.queue.items[0].titleSha256.replace(/./gu, 'a');
    expect(() => buildDvidsPublisherClaimReviewAssignment({
      queue: fixture.queue,
      createdAt: '2026-07-27T22:00:00.000Z',
    })).toThrow('dvids_publisher_claim_review_queue_invalid');

    const assignment = buildDvidsPublisherClaimReviewAssignment({
      queue: dvidsPublisherReviewFixture().queue,
      createdAt: '2026-07-27T22:00:00.000Z',
    });
    const html = buildDvidsPublisherClaimReviewWorkbook(assignment);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('Add selected quotation');
    expect(html).toContain('noExternalVerificationImplied');
    expect(html).toContain('do not authorize claim segments');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain(assignment.assignmentDigest);
  });
});
