import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexPerformanceMatrixPlan,
  buildCaseVortexPerformanceMatrixReport,
  CASE_VORTEX_PERFORMANCE_MATRIX_VERSION,
  CASE_VORTEX_PERFORMANCE_PROFILES,
  type CaseVortexPerformanceMatrixInput,
  verifyCaseVortexPerformanceMatrixPlan,
} from '../../src/caseGraph/performanceDeviceMatrix';
import { verifyCaseVortexAuthoritativeEvidenceArtifact } from '../../src/caseGraph/authoritativeEvidenceArtifact';

const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: 'corpus-v2', manifestSha256: 'a'.repeat(64),
};
const expectedRecordCount = 466_935;
const plan = () => buildCaseVortexPerformanceMatrixPlan({
  planId: 'physical-matrix-v1', publication, expectedRecordCount,
});
const sha = (value: number) => value.toString(16).padStart(64, '0');

const input = (): CaseVortexPerformanceMatrixInput => {
  const frozenPlan = plan();
  let artifact = 100;
  return {
    recordType: 'case_vortex_performance_matrix_input',
    schemaVersion: CASE_VORTEX_PERFORMANCE_MATRIX_VERSION,
    planId: frozenPlan.planId,
    planSha256: frozenPlan.planSha256,
    publication,
    expectedRecordCount,
    completedAt: '2026-07-22T15:00:00.000Z',
    runs: frozenPlan.slots.map(({ profile, runOrdinal, cacheState }, index) => ({
      profile,
      runOrdinal,
      cacheState,
      capturedAt: `2026-07-22T14:${String(index).padStart(2, '0')}:00.000Z`,
      device: {
        deviceIdHash: sha(10 + CASE_VORTEX_PERFORMANCE_PROFILES.indexOf(profile)),
        deviceName: profile,
        physicalDevice: true,
        browserEmulation: false,
        operatingSystem: profile === 'desktop_physical' ? 'macOS' : 'Android',
        operatingSystemVersion: '1', browserName: 'Chrome', browserVersion: '1',
        viewportWidth: profile === 'desktop_physical' ? 1_440 : 390,
        viewportHeight: profile === 'desktop_physical' ? 1_000 : 844,
        touchPoints: profile === 'desktop_physical' ? 0 : 5,
        physicalMemoryGb: profile === 'low_power_physical' ? 4 : 8,
        logicalProcessors: profile === 'low_power_physical' ? 4 : 8,
        dataSaverEnabled: profile === 'low_power_physical',
        gpuRenderer: 'Retained physical GPU identity',
      },
      evidence: {
        traceSha256: sha(artifact++), screenshotSha256: sha(artifact++),
        addressabilitySha256: sha(artifact++), systemMetricsSha256: sha(artifact++),
      },
      metrics: {
        publicationManifestVerified: true,
        expectedRecordCount,
        addressableRecordCount: expectedRecordCount,
        exhaustiveAddressLookupVerified: true,
        renderedPointCount: 29_062,
        readyMs: 10_000, firstResultMs: 1_000, recordOpenMs: 500, interactionP95Ms: 100,
        frameP95Ms: 20, frameP99Ms: 50, droppedFrameRatio: 0.05,
        maxLongTaskMs: 100, longTaskCount: 2,
        retainedHeapBytes: 100 * 1024 * 1024,
        gpuMemoryBytes: 128 * 1024 * 1024,
        cpuUtilizationP95Percent: 70, gpuUtilizationP95Percent: 60,
        networkTransferredBytes: 40 * 1024 * 1024,
        thermalStateStart: 'nominal', thermalStateEnd: 'fair',
        pageErrorCount: 0, consoleErrorCount: 0,
      },
    })),
  };
};

describe('Case Vortex physical-device performance matrix', () => {
  it('freezes a deterministic nine-run publication-bound plan', () => {
    const first = plan();
    expect(first).toEqual(plan());
    expect(first.slots).toHaveLength(9);
    expect(first.slots.filter(({ cacheState }) => cacheState === 'cold')).toHaveLength(3);
    expect(first.requirements).toMatchObject({
      runsPerProfile: 3,
      physicalHardwareRequired: true,
      browserEmulationAllowed: false,
      exhaustiveAddressabilityRequired: true,
    });
    expect(verifyCaseVortexPerformanceMatrixPlan(first)).toBe(true);
    const tampered = structuredClone(first);
    tampered.slots[0].cacheState = 'warm';
    expect(verifyCaseVortexPerformanceMatrixPlan(tampered)).toBe(false);
  });

  it('seals nine passing physical runs with complete addressability and retained evidence', () => {
    const first = buildCaseVortexPerformanceMatrixReport(input());
    expect(first).toEqual(buildCaseVortexPerformanceMatrixReport(input()));
    expect(first.performanceMatrixPassed).toBe(true);
    expect(first.accounting).toEqual({
      profileCount: 3, runCount: 9, passedRunCount: 9, failedRunCount: 0,
      retainedArtifactCount: 36,
    });
    expect(first.runs.every(({ passed }) => passed)).toBe(true);
    expect(first.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'performance_matrix', artifactBody: Buffer.from(JSON.stringify(first)),
      artifactInputBody: Buffer.from(JSON.stringify(input())),
      publication, verifiedAt: '2026-07-22T15:01:00.000Z',
    })).toMatchObject({ gate: 'performance_matrix', publication });
  });

  it('retains budget and environment failures without calling them passed', () => {
    const review = input();
    review.runs[0].metrics.frameP95Ms = 200;
    review.runs[3].device.browserEmulation = true;
    review.runs[6].metrics.addressableRecordCount -= 1;
    review.runs[6].metrics.thermalStateEnd = 'critical';
    const report = buildCaseVortexPerformanceMatrixReport(review);

    expect(report.performanceMatrixPassed).toBe(false);
    expect(report.accounting.failedRunCount).toBe(3);
    expect(report.runs[0].checks.frame_p95_budget).toBe(false);
    expect(report.runs[3].checks.physical_hardware).toBe(false);
    expect(report.runs[6].checks).toMatchObject({
      complete_addressability: false,
      thermal_budget: false,
    });
    expect(() => verifyCaseVortexAuthoritativeEvidenceArtifact({
      gate: 'performance_matrix', artifactBody: Buffer.from(JSON.stringify(report)),
      artifactInputBody: Buffer.from(JSON.stringify(review)),
      publication, verifiedAt: '2026-07-22T15:01:00.000Z',
    })).toThrow('case_vortex_authoritative_performance_gate_failed');
  });

  it('rejects plan drift, duplicate/missing slots and recycled artifacts', () => {
    const wrongPlan = input();
    wrongPlan.planSha256 = 'f'.repeat(64);
    expect(() => buildCaseVortexPerformanceMatrixReport(wrongPlan))
      .toThrow('case_vortex_performance_plan_binding_invalid');

    const duplicateSlot = input();
    duplicateSlot.runs[1].runOrdinal = 1;
    duplicateSlot.runs[1].cacheState = 'cold';
    expect(() => buildCaseVortexPerformanceMatrixReport(duplicateSlot))
      .toThrow('case_vortex_performance_run_invalid');

    const recycledArtifact = input();
    recycledArtifact.runs[1].evidence.traceSha256 = recycledArtifact.runs[0].evidence.traceSha256;
    expect(() => buildCaseVortexPerformanceMatrixReport(recycledArtifact))
      .toThrow('case_vortex_performance_artifacts_not_unique');
  });

  it('rejects device drift within a profile and reuse across physical profiles', () => {
    const drift = input();
    drift.runs[1].device.deviceIdHash = sha(999);
    expect(() => buildCaseVortexPerformanceMatrixReport(drift))
      .toThrow('case_vortex_performance_profile_device_drift');

    const reused = input();
    for (const run of reused.runs.filter(({ profile }) => profile === 'mobile_physical')) {
      run.device.deviceIdHash = reused.runs[0].device.deviceIdHash;
    }
    expect(() => buildCaseVortexPerformanceMatrixReport(reused))
      .toThrow('case_vortex_performance_devices_not_distinct');
  });
});
