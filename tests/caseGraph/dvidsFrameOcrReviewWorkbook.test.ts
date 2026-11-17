import { describe, expect, it } from 'vitest';

import {
  buildDvidsFrameOcrReviewAssignment,
} from '../../src/caseGraph/dvidsFrameOcrHumanReview';
import {
  buildDvidsFrameOcrReviewWorkbook,
} from '../../src/caseGraph/dvidsFrameOcrReviewWorkbook';
import { dvidsFrameOcrReviewFixture } from './dvidsRetainedContentFixtures';

describe('DVIDS frame OCR review workbook', () => {
  it('embeds only the exact checksum-bound frame and disables network access', () => {
    const fixture = dvidsFrameOcrReviewFixture();
    const frame = fixture.queue.frames.find(({ text }) => text !== null)!;
    const assignment = buildDvidsFrameOcrReviewAssignment({
      queue: fixture.queue,
      recoveredFrames: [{
        address: frame.address,
        keyframeOrdinal: frame.keyframeOrdinal,
        frameFileName: `frame-${frame.frameSha256}.png`,
        frameBytes: frame.frameBytes,
        frameSha256: frame.frameSha256,
        frameWidth: frame.frameWidth,
        frameHeight: frame.frameHeight,
      }],
      createdAt: '2026-07-27T22:10:00.000Z',
    });
    const html = buildDvidsFrameOcrReviewWorkbook({
      assignment,
      frameBodies: new Map([[
        assignment.items[0].frameFileName,
        fixture.frameBody,
      ]]),
    });
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Frame OCR human review');
    expect(html).toContain(assignment.assignmentDigest);
    expect(() => buildDvidsFrameOcrReviewWorkbook({
      assignment,
      frameBodies: new Map([[
        assignment.items[0].frameFileName,
        Buffer.from('substituted'),
      ]]),
    })).toThrow('dvids_frame_ocr_review_workbook_frame_invalid');
  });
});
