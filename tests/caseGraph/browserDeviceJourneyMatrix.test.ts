import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexBrowserDeviceMatrixPlan,
  buildCaseVortexBrowserDeviceMatrixReport,
  CASE_VORTEX_BROWSER_DEVICE_JOURNEYS,
  CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION,
  type CaseVortexBrowserDeviceMatrixInput,
  verifyCaseVortexBrowserDeviceMatrixPlan,
} from '../../src/caseGraph/browserDeviceJourneyMatrix';
import { verifyCaseVortexAuthoritativeEvidenceArtifact } from '../../src/caseGraph/authoritativeEvidenceArtifact';
import { CASE_VORTEX_RESEARCH_TOOL_NAMES } from '../../src/shared/caseVortexResearchTools';

const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: 'v2', manifestSha256: 'a'.repeat(64),
};
const count = 466_935;
const sha = (value: number) => value.toString(16).padStart(64, '0');
const plan = () => buildCaseVortexBrowserDeviceMatrixPlan({
  planId: 'browser-matrix-v1', publication, expectedRecordCount: count,
});
const viewport = (profile: string) => {
  if (profile === 'desktop') return [1_440, 1_000];
  if (profile === 'tablet' || profile === 'reduced_motion') return [900, 900];
  if (profile === 'mobile') return [390, 844];
  return [560, 900];
};
const input = (): CaseVortexBrowserDeviceMatrixInput => {
  const frozen = plan();
  let evidence = 200;
  let receipt = 1_000;
  return {
    recordType: 'case_vortex_browser_device_matrix_input',
    schemaVersion: CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION,
    planId: frozen.planId, planSha256: frozen.planSha256, publication,
    expectedRecordCount: count, completedAt: '2026-07-22T20:00:00.000Z',
    sessions: frozen.sessions.map(({ profile }, index) => {
      const [viewportWidth, viewportHeight] = viewport(profile);
      return {
        profile,
        capturedAt: `2026-07-22T19:${String(index).padStart(2, '0')}:00.000Z`,
        environment: {
          browserName: 'Chromium', browserVersion: '1', operatingSystem: 'OS',
          operatingSystemVersion: '1', viewportWidth, viewportHeight,
          reducedMotion: profile === 'reduced_motion',
          webglAvailable: profile !== 'no_webgl', lowPowerMode: profile === 'low_power',
          dataSaverEnabled: profile === 'low_power',
          deviceMemoryGb: profile === 'low_power' ? 2 : 8,
          logicalProcessors: profile === 'low_power' ? 2 : 8,
        },
        evidence: {
          traceSha256: sha(evidence++), screenshotSha256: sha(evidence++),
          networkHarSha256: sha(evidence++), accessibilitySha256: sha(evidence++),
        },
        publicationManifestVerified: true,
        addressableRecordCount: count,
        toolNamesObserved: [...CASE_VORTEX_RESEARCH_TOOL_NAMES],
        unknownToolRejected: true,
        externalDomainsObserved: [
          'aircraft', 'satellites', 'balloons', 'astronomy', 'meteors',
          'military_exercises', 'launches', 'maritime', 'weather',
        ],
        locatorModalitiesObserved: ['quotation', 'pdf_page', 'timestamp', 'frame', 'image_region'],
        axeViolationCount: 0, pageErrorCount: 0, consoleErrorCount: 0,
        failedResponseCount: 0, horizontalOverflow: false,
        journeyOutcomes: CASE_VORTEX_BROWSER_DEVICE_JOURNEYS.map((journey) => ({
          journey, completed: true, assertionCount: 5, failureCount: 0,
          receiptSha256: sha(receipt++),
        })),
      };
    }),
  };
};

describe('Case Vortex authoritative browser/device journey matrix', () => {
  it('freezes all seven profiles and fourteen complete research journeys', () => {
    const first = plan();
    expect(first).toEqual(plan());
    expect(first.sessions).toHaveLength(7);
    expect(first.sessions.flatMap(({ journeys }) => journeys)).toHaveLength(98);
    expect(first.requirements).toMatchObject({
      currentPublicationRequired: true,
      fixtureOrLegacyQaAllowed: false,
      zeroRuntimeErrorsRequired: true,
      zeroScopedAccessibilityViolationsRequired: true,
    });
    expect(verifyCaseVortexBrowserDeviceMatrixPlan(first)).toBe(true);
    const tampered = structuredClone(first);
    tampered.sessions[0].journeys.pop();
    expect(verifyCaseVortexBrowserDeviceMatrixPlan(tampered)).toBe(false);
  });

  it('seals seven passing sessions with all tools, domains, locators and journeys', () => {
    const first = buildCaseVortexBrowserDeviceMatrixReport(input());
    expect(first).toEqual(buildCaseVortexBrowserDeviceMatrixReport(input()));
    expect(first.browserDeviceMatrixPassed).toBe(true);
    expect(first.accounting).toEqual({
      profileCount: 7, sessionCount: 7, journeyObservationCount: 98,
      retainedArtifactCount: 28, retainedJourneyReceiptCount: 98,
      passedSessionCount: 7, failedSessionCount: 0,
    });
    expect(first.sessions.every(({ passed }) => passed)).toBe(true);
    expect(first.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'browser_device_matrix', artifactBody: Buffer.from(JSON.stringify(first)),
      artifactInputBody: Buffer.from(JSON.stringify(input())),
      publication, verifiedAt: '2026-07-22T20:01:00.000Z',
    })).toMatchObject({ gate: 'browser_device_matrix', publication });
  });

  it('retains incomplete capability, accessibility and runtime observations as failures', () => {
    const review = input();
    review.sessions[0].journeyOutcomes[0].failureCount = 1;
    review.sessions[1].axeViolationCount = 1;
    review.sessions[2].consoleErrorCount = 1;
    review.sessions[3].externalDomainsObserved.pop();
    const report = buildCaseVortexBrowserDeviceMatrixReport(review);
    expect(report.browserDeviceMatrixPassed).toBe(false);
    expect(report.accounting.failedSessionCount).toBe(4);
    expect(report.sessions[0].checks.all_journeys).toBe(false);
    expect(report.sessions[1].checks.zero_accessibility_violations).toBe(false);
    expect(report.sessions[2].checks.zero_runtime_errors).toBe(false);
    expect(report.sessions[3].checks.all_external_domains).toBe(false);
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'browser_device_matrix', artifactBody: Buffer.from(JSON.stringify(report)),
      artifactInputBody: Buffer.from(JSON.stringify(review)),
      publication, verifiedAt: '2026-07-22T20:01:00.000Z',
    })).toThrow('case_vortex_authoritative_browser_device_gate_failed');
  });

  it('rejects stale plan bindings, duplicate profiles and recycled evidence', () => {
    const stale = input();
    stale.planSha256 = 'f'.repeat(64);
    expect(() => buildCaseVortexBrowserDeviceMatrixReport(stale))
      .toThrow('case_vortex_browser_device_plan_binding_invalid');

    const duplicateProfile = input();
    duplicateProfile.sessions[1].profile = duplicateProfile.sessions[0].profile;
    expect(() => buildCaseVortexBrowserDeviceMatrixReport(duplicateProfile))
      .toThrow('case_vortex_browser_device_session_invalid');

    const recycledEvidence = input();
    recycledEvidence.sessions[1].evidence.traceSha256 = recycledEvidence.sessions[0].evidence.traceSha256;
    expect(() => buildCaseVortexBrowserDeviceMatrixReport(recycledEvidence))
      .toThrow('case_vortex_browser_device_artifacts_not_unique');
  });

  it('rejects duplicated journey receipts and malformed profile environments', () => {
    const duplicateReceipt = input();
    duplicateReceipt.sessions[1].journeyOutcomes[0].receiptSha256 =
      duplicateReceipt.sessions[0].journeyOutcomes[0].receiptSha256;
    expect(() => buildCaseVortexBrowserDeviceMatrixReport(duplicateReceipt))
      .toThrow('case_vortex_browser_device_journey_receipts_not_unique');

    const wrongViewport = input();
    wrongViewport.sessions[0].environment.viewportWidth = 1_000;
    const report = buildCaseVortexBrowserDeviceMatrixReport(wrongViewport);
    expect(report.browserDeviceMatrixPassed).toBe(false);
    expect(report.sessions[0].checks.profile_environment).toBe(false);
  });
});
