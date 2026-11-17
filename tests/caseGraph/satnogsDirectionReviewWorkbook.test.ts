import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import {
  buildSatnogsDirectionReviewAssignment,
  buildSatnogsDirectionReviewDraft,
} from '../../src/caseGraph/satnogsDirectionHumanReview';
import {
  buildSatnogsDirectionReviewWorkbook,
} from '../../src/caseGraph/satnogsDirectionReviewWorkbook';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const cohortFixture = () => {
  const sourceText = 'Object north </script><script>globalThis.pwned=true</script>';
  const phrase = {
    sourceField: 'summary',
    sourceText,
    sourceTextSha256: relationshipInputSha256(sourceText),
    span: {
      unit: 'utf8_byte', start: 7, end: 12, text: 'north',
      textSha256: relationshipInputSha256('north'),
    },
    normalizedDirection: 'north',
    disposition: 'pending_human_review',
  };
  const candidateCore = {
    candidateId: 'satnogs-contextual:candidate-1',
    address: 'sighting:subject-1',
    source: 'FIXTURE',
    sourceRecordId: 'subject-1',
    canonicalUrl: 'https://example.test/subject-1',
    eventTimestamp: '2026-07-26T00:00:00.000Z',
    lat: 51.5,
    lon: -0.1,
    nodeDigest: 'a'.repeat(64),
    sourceMaterialSha256: 'b'.repeat(64),
    directionPhrases: [phrase],
    satelliteCoverage: {
      compatibleSnapshotCount: 1, compatibleObjectCount: 1,
      compatibleOrbitClasses: ['leo'], minimumEpochAgeDays: 1,
      maximumEpochAgeDays: 1, compatibleSnapshotSetSha256: 'c'.repeat(64),
    },
    selectionRank: 'd'.repeat(64),
  };
  const candidate = {
    ...candidateCore,
    candidateDigest: relationshipInputSha256(candidateCore),
  };
  const body = {
    recordType: 'satnogs_contextual_cohort',
    schemaVersion: 'case-vortex-satnogs-contextual-cohort-v1',
    builtAt: '2026-07-27T13:00:00.000Z',
    seed: 'fixture',
    targetCount: 1,
    binding: {
      corpusVersion: 'corpus-v1',
      snapshotId: '123e4567-e89b-42d3-a456-426614174000',
      universeArchiveVersion: 'evidence-universe-archive-v3',
      universeSchemaVersion: 'evidence-universe-v2',
      universeLayoutVersion: 'evidence-universe-layout-v2',
      universeArchiveSetSha256: 'e'.repeat(64),
      universeRecordCount: 1, universeSightingCount: 1,
      universePartCount: 1, scannedSightingPartCount: 1,
    },
    satnogs: {
      schemaVersion: 'satnogs-db-snapshot-archive-v1',
      archiveDigest: 'f'.repeat(64), archiveFileSha256: '1'.repeat(64),
      snapshotSetSha256: '2'.repeat(64), snapshotCount: 1,
    },
    policy: {},
    summary: {
      scannedSightingCount: 1, completeCoordinateTimeCount: 1,
      satelliteCoverageEligibleCount: 1, directionPhraseEligibleCount: 1,
      selectedCandidateCount: 1, selectedSourceCount: 1,
      selectedDirectionPhraseCount: 1, selectedCompatibleSnapshotCount: 1,
    },
    candidates: [candidate],
    candidateSetSha256: relationshipInputSha256([
      `${candidate.candidateId}:${candidate.candidateDigest}`,
    ]),
    guarantees: {},
  };
  return { ...body, cohortDigest: relationshipInputSha256(body) };
};

describe('SatNOGS direction review workbook', () => {
  it('emits a self-contained offline accessible workbook with no prefilled decisions', () => {
    const assignment = buildSatnogsDirectionReviewAssignment({
      cohort: cohortFixture(),
      createdAt: '2026-07-27T14:00:00.000Z',
    });
    const html = buildSatnogsDirectionReviewWorkbook(assignment);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Independent direction review');
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain('"satelliteCoverage"');
    expect(html).not.toContain('<script src=');
    expect(html).not.toContain('fetch(');
    expect(html).toContain('document.createTextNode');
    expect(html).toContain('textContent = parts[1]');
    expect(html).toContain('decision: null, confidence: null, rationale: null');
    expect(html).not.toContain('</script><script>globalThis.pwned=true</script>');
    expect(html).toContain('\\u003c/script>\\u003cscript>globalThis.pwned=true\\u003c/script>');
    expect(html).toContain('id="review-heading" tabindex="-1"');
    expect(html).toContain('id="progress"');
    expect(html).toContain('id="human-performed"');
    expect(html).toContain('id="import-checkpoint"');
    expect(html).toContain('id="export-checkpoint"');
    expect(html).toContain('Checkpoint shape or assignment binding is invalid.');
    expect(html).toContain('Export completed JSON draft');
  });

  it('imports an exact assignment-bound checkpoint and rejects a substituted binding', async () => {
    const assignment = buildSatnogsDirectionReviewAssignment({
      cohort: cohortFixture(),
      createdAt: '2026-07-27T14:00:00.000Z',
    });
    const html = buildSatnogsDirectionReviewWorkbook(assignment);
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://offline-workbook.test/',
      beforeParse: (window) => {
        Object.defineProperty(window, 'TextEncoder', { value: TextEncoder });
        Object.defineProperty(window, 'TextDecoder', { value: TextDecoder });
      },
    });
    const checkpoint = buildSatnogsDirectionReviewDraft(assignment);
    checkpoint.reviews[0] = {
      ...checkpoint.reviews[0],
      decision: 'object_sky_position_confirmed',
      confidence: 'high',
      rationale: 'The highlighted phrase locates the observed object.',
    };
    const input = dom.window.document.querySelector<HTMLInputElement>('#import-checkpoint');
    if (!input) throw new Error('checkpoint input missing');
    const importValue = async (value: unknown) => {
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{
          size: Buffer.byteLength(JSON.stringify(value)),
          text: async () => JSON.stringify(value),
        }],
      });
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await importValue(checkpoint);
    expect(dom.window.document.querySelector('#progress-text')?.textContent)
      .toBe('1 of 1 reviewed');
    expect(dom.window.document.querySelector('#status')?.textContent)
      .toBe('Checkpoint imported and assignment binding verified.');
    expect((dom.window.document.querySelector('#decision') as HTMLSelectElement).value)
      .toBe('object_sky_position_confirmed');

    await importValue({ ...checkpoint, assignmentDigest: '9'.repeat(64) });
    expect(dom.window.document.querySelector('#status')?.textContent)
      .toBe('Checkpoint shape or assignment binding is invalid.');
    dom.window.close();
  });

  it('rejects a re-sealed or malformed assignment before rendering', () => {
    const assignment = buildSatnogsDirectionReviewAssignment({
      cohort: cohortFixture(),
      createdAt: '2026-07-27T14:00:00.000Z',
    });
    expect(() => buildSatnogsDirectionReviewWorkbook({
      ...assignment,
      itemSetSha256: '9'.repeat(64),
    })).toThrow();
  });
});
