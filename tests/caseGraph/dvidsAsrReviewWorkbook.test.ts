import { describe, expect, it } from 'vitest';

import {
  buildDvidsAsrHumanReviewAssignment,
} from '../../src/caseGraph/dvidsAsrHumanReview';
import {
  buildDvidsAsrReviewWorkbook,
} from '../../src/caseGraph/dvidsAsrReviewWorkbook';
import { dvidsAsrHumanReviewFixture } from './dvidsAsrHumanReviewFixtures';

describe('DVIDS ASR human review workbook', () => {
  it('embeds every recovered interval in a network-disabled complete-draft workbook', () => {
    const fixture = dvidsAsrHumanReviewFixture();
    const assignment = buildDvidsAsrHumanReviewAssignment({
      queue: fixture.queue,
      createdAt: '2026-07-28T00:40:00.000Z',
    });
    const html = buildDvidsAsrReviewWorkbook({
      assignment,
      audioClips: new Map(assignment.items.map((item) => [
        item.itemId,
        fixture.clipBody,
      ])),
    });
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("media-src data:");
    expect(html).toContain('ASR transcript human review');
    expect(html).toContain('reviews=a.items.map');
    expect(html).toContain(assignment.assignmentDigest);
    expect(html.match(/data:audio\/wav;base64,/gu)).toHaveLength(2);
    expect(() => buildDvidsAsrReviewWorkbook({
      assignment,
      audioClips: new Map([[assignment.items[0].itemId, fixture.clipBody]]),
    })).toThrow('dvids_asr_review_workbook_clip_accounting_invalid');
  });
});
