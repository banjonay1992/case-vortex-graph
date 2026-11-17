import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_PERFORMANCE_MATRIX_VERSION = 'case-vortex-performance-device-matrix-v1' as const;

export const CASE_VORTEX_PERFORMANCE_PROFILES = [
  'desktop_physical',
  'mobile_physical',
  'low_power_physical',
] as const;
export type CaseVortexPerformanceProfile = typeof CASE_VORTEX_PERFORMANCE_PROFILES[number];

export const CASE_VORTEX_PERFORMANCE_BUDGETS = {
  desktop_physical: {
    readyMs: 30_000, firstResultMs: 2_500, recordOpenMs: 1_000, interactionP95Ms: 200,
    frameP95Ms: 34, frameP99Ms: 100, droppedFrameRatio: 0.1, maxLongTaskMs: 200,
  },
  mobile_physical: {
    readyMs: 60_000, firstResultMs: 5_000, recordOpenMs: 2_000, interactionP95Ms: 300,
    frameP95Ms: 50, frameP99Ms: 150, droppedFrameRatio: 0.2, maxLongTaskMs: 300,
  },
  low_power_physical: {
    readyMs: 90_000, firstResultMs: 8_000, recordOpenMs: 3_000, interactionP95Ms: 500,
    frameP95Ms: 67, frameP99Ms: 200, droppedFrameRatio: 0.3, maxLongTaskMs: 500,
  },
} as const;

const MAX_HEAP_BYTES = 256 * 1024 * 1024;
const MAX_GPU_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_NETWORK_BYTES = 256 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export type CaseVortexPerformancePublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexPerformanceMatrixPlan = {
  recordType: 'case_vortex_performance_matrix_plan';
  schemaVersion: typeof CASE_VORTEX_PERFORMANCE_MATRIX_VERSION;
  planId: string;
  publication: CaseVortexPerformancePublication;
  expectedRecordCount: number;
  requirements: {
    profiles: typeof CASE_VORTEX_PERFORMANCE_PROFILES;
    runsPerProfile: 3;
    coldRunsPerProfile: 1;
    physicalHardwareRequired: true;
    browserEmulationAllowed: false;
    exhaustiveAddressabilityRequired: true;
    uniqueRetainedArtifactsRequired: true;
    maximums: {
      heapBytes: number;
      gpuMemoryBytes: number;
      networkBytes: number;
    };
    budgets: typeof CASE_VORTEX_PERFORMANCE_BUDGETS;
  };
  slots: Array<{
    profile: CaseVortexPerformanceProfile;
    runOrdinal: 1 | 2 | 3;
    cacheState: 'cold' | 'warm';
    outcome: null;
  }>;
  planSha256: string;
};

export type CaseVortexPerformanceRunInput = {
  profile: CaseVortexPerformanceProfile;
  runOrdinal: 1 | 2 | 3;
  cacheState: 'cold' | 'warm';
  capturedAt: string;
  device: {
    deviceIdHash: string;
    deviceName: string;
    physicalDevice: boolean;
    browserEmulation: boolean;
    operatingSystem: string;
    operatingSystemVersion: string;
    browserName: string;
    browserVersion: string;
    viewportWidth: number;
    viewportHeight: number;
    touchPoints: number;
    physicalMemoryGb: number;
    logicalProcessors: number;
    dataSaverEnabled: boolean;
    gpuRenderer: string;
  };
  evidence: {
    traceSha256: string;
    screenshotSha256: string;
    addressabilitySha256: string;
    systemMetricsSha256: string;
  };
  metrics: {
    publicationManifestVerified: boolean;
    expectedRecordCount: number;
    addressableRecordCount: number;
    exhaustiveAddressLookupVerified: boolean;
    renderedPointCount: number;
    readyMs: number;
    firstResultMs: number;
    recordOpenMs: number;
    interactionP95Ms: number;
    frameP95Ms: number;
    frameP99Ms: number;
    droppedFrameRatio: number;
    maxLongTaskMs: number;
    longTaskCount: number;
    retainedHeapBytes: number;
    gpuMemoryBytes: number;
    cpuUtilizationP95Percent: number;
    gpuUtilizationP95Percent: number;
    networkTransferredBytes: number;
    thermalStateStart: 'nominal' | 'fair' | 'serious' | 'critical';
    thermalStateEnd: 'nominal' | 'fair' | 'serious' | 'critical';
    pageErrorCount: number;
    consoleErrorCount: number;
  };
};

export type CaseVortexPerformanceMatrixInput = {
  recordType: 'case_vortex_performance_matrix_input';
  schemaVersion: typeof CASE_VORTEX_PERFORMANCE_MATRIX_VERSION;
  planId: string;
  planSha256: string;
  publication: CaseVortexPerformancePublication;
  expectedRecordCount: number;
  completedAt: string;
  runs: CaseVortexPerformanceRunInput[];
};

const bounded = (value: unknown, code: string, maximum = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(code);
  return value.trim();
};
const digest = (value: unknown, code: string) => {
  const normalized = bounded(value, code, 64).toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(code);
  return normalized;
};
const integer = (value: unknown, code: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(code);
  }
  return value as number;
};
const finite = (value: unknown, code: string, minimum = 0, maximum = Number.MAX_VALUE) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(code);
  }
  return value;
};
const boolean = (value: unknown, code: string) => {
  if (typeof value !== 'boolean') throw new Error(code);
  return value;
};
const timestamp = (value: unknown, code: string) => {
  const normalized = bounded(value, code, 100);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return new Date(normalized).toISOString();
};
const normalizePublication = (value: CaseVortexPerformancePublication) => ({
  publicationId: bounded(value?.publicationId, 'case_vortex_performance_publication_invalid', 200),
  corpusVersion: bounded(value?.corpusVersion, 'case_vortex_performance_publication_invalid', 200),
  manifestSha256: digest(value?.manifestSha256, 'case_vortex_performance_publication_invalid'),
});

export const buildCaseVortexPerformanceMatrixPlan = (input: {
  planId: string;
  publication: CaseVortexPerformancePublication;
  expectedRecordCount: number;
}): CaseVortexPerformanceMatrixPlan => {
  const withoutDigest = {
    recordType: 'case_vortex_performance_matrix_plan' as const,
    schemaVersion: CASE_VORTEX_PERFORMANCE_MATRIX_VERSION,
    planId: bounded(input.planId, 'case_vortex_performance_plan_id_invalid', 200),
    publication: normalizePublication(input.publication),
    expectedRecordCount: integer(input.expectedRecordCount,
      'case_vortex_performance_record_count_invalid', 1),
    requirements: {
      profiles: CASE_VORTEX_PERFORMANCE_PROFILES,
      runsPerProfile: 3 as const,
      coldRunsPerProfile: 1 as const,
      physicalHardwareRequired: true as const,
      browserEmulationAllowed: false as const,
      exhaustiveAddressabilityRequired: true as const,
      uniqueRetainedArtifactsRequired: true as const,
      maximums: {
        heapBytes: MAX_HEAP_BYTES,
        gpuMemoryBytes: MAX_GPU_MEMORY_BYTES,
        networkBytes: MAX_NETWORK_BYTES,
      },
      budgets: CASE_VORTEX_PERFORMANCE_BUDGETS,
    },
    slots: CASE_VORTEX_PERFORMANCE_PROFILES.flatMap((profile) => ([1, 2, 3] as const)
      .map((runOrdinal) => ({
        profile,
        runOrdinal,
        cacheState: runOrdinal === 1 ? 'cold' as const : 'warm' as const,
        outcome: null,
      }))),
  };
  return { ...withoutDigest, planSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexPerformanceMatrixPlan = (value: CaseVortexPerformanceMatrixPlan) => {
  if (!value || value.recordType !== 'case_vortex_performance_matrix_plan'
    || value.schemaVersion !== CASE_VORTEX_PERFORMANCE_MATRIX_VERSION
    || !SHA256.test(value.planSha256)) return false;
  const { planSha256, ...withoutDigest } = value;
  return relationshipInputSha256(withoutDigest) === planSha256;
};

const expectedCacheState = (ordinal: number) => ordinal === 1 ? 'cold' : 'warm';
const runKey = (profile: string, ordinal: number) => `${profile}:${ordinal}`;

export const buildCaseVortexPerformanceMatrixReport = (input: CaseVortexPerformanceMatrixInput) => {
  if (!input || input.recordType !== 'case_vortex_performance_matrix_input'
    || input.schemaVersion !== CASE_VORTEX_PERFORMANCE_MATRIX_VERSION
    || !Array.isArray(input.runs) || input.runs.length !== 9) {
    throw new Error('case_vortex_performance_input_invalid');
  }
  const publication = normalizePublication(input.publication);
  const planId = bounded(input.planId, 'case_vortex_performance_plan_id_invalid', 200);
  const expectedRecordCount = integer(input.expectedRecordCount,
    'case_vortex_performance_record_count_invalid', 1);
  const planSha256 = digest(input.planSha256, 'case_vortex_performance_plan_digest_invalid');
  const expectedPlan = buildCaseVortexPerformanceMatrixPlan({ planId, publication, expectedRecordCount });
  if (expectedPlan.planSha256 !== planSha256) throw new Error('case_vortex_performance_plan_binding_invalid');
  const completedAt = timestamp(input.completedAt, 'case_vortex_performance_completed_at_invalid');
  const runKeys = new Set<string>();
  const deviceByProfile = new Map<CaseVortexPerformanceProfile, string>();
  const profileByDevice = new Map<string, CaseVortexPerformanceProfile>();
  const artifacts = new Set<string>();
  const normalizedRuns = input.runs.map((run) => {
    if (!CASE_VORTEX_PERFORMANCE_PROFILES.includes(run.profile)
      || ![1, 2, 3].includes(run.runOrdinal)
      || run.cacheState !== expectedCacheState(run.runOrdinal)) {
      throw new Error('case_vortex_performance_run_invalid');
    }
    const key = runKey(run.profile, run.runOrdinal);
    if (runKeys.has(key)) throw new Error('case_vortex_performance_run_invalid');
    runKeys.add(key);
    const capturedAt = timestamp(run.capturedAt, 'case_vortex_performance_run_invalid');
    if (capturedAt > completedAt) throw new Error('case_vortex_performance_run_invalid');
    const deviceIdHash = digest(run.device?.deviceIdHash, 'case_vortex_performance_device_invalid');
    const existingDevice = deviceByProfile.get(run.profile);
    if (existingDevice && existingDevice !== deviceIdHash) {
      throw new Error('case_vortex_performance_profile_device_drift');
    }
    const existingProfile = profileByDevice.get(deviceIdHash);
    if (existingProfile && existingProfile !== run.profile) {
      throw new Error('case_vortex_performance_devices_not_distinct');
    }
    deviceByProfile.set(run.profile, deviceIdHash);
    profileByDevice.set(deviceIdHash, run.profile);
    const device = {
      deviceIdHash,
      deviceName: bounded(run.device?.deviceName, 'case_vortex_performance_device_invalid', 200),
      physicalDevice: boolean(run.device?.physicalDevice, 'case_vortex_performance_device_invalid'),
      browserEmulation: boolean(run.device?.browserEmulation, 'case_vortex_performance_device_invalid'),
      operatingSystem: bounded(run.device?.operatingSystem, 'case_vortex_performance_device_invalid', 100),
      operatingSystemVersion: bounded(run.device?.operatingSystemVersion,
        'case_vortex_performance_device_invalid', 100),
      browserName: bounded(run.device?.browserName, 'case_vortex_performance_device_invalid', 100),
      browserVersion: bounded(run.device?.browserVersion, 'case_vortex_performance_device_invalid', 100),
      viewportWidth: integer(run.device?.viewportWidth, 'case_vortex_performance_device_invalid', 240, 10_000),
      viewportHeight: integer(run.device?.viewportHeight, 'case_vortex_performance_device_invalid', 240, 10_000),
      touchPoints: integer(run.device?.touchPoints, 'case_vortex_performance_device_invalid', 0, 100),
      physicalMemoryGb: finite(run.device?.physicalMemoryGb, 'case_vortex_performance_device_invalid', 0.25, 1_024),
      logicalProcessors: integer(run.device?.logicalProcessors, 'case_vortex_performance_device_invalid', 1, 1_024),
      dataSaverEnabled: boolean(run.device?.dataSaverEnabled, 'case_vortex_performance_device_invalid'),
      gpuRenderer: bounded(run.device?.gpuRenderer, 'case_vortex_performance_device_invalid', 300),
    };
    const evidence = {
      traceSha256: digest(run.evidence?.traceSha256, 'case_vortex_performance_evidence_invalid'),
      screenshotSha256: digest(run.evidence?.screenshotSha256, 'case_vortex_performance_evidence_invalid'),
      addressabilitySha256: digest(run.evidence?.addressabilitySha256, 'case_vortex_performance_evidence_invalid'),
      systemMetricsSha256: digest(run.evidence?.systemMetricsSha256, 'case_vortex_performance_evidence_invalid'),
    };
    for (const artifact of Object.values(evidence)) {
      if (artifacts.has(artifact)) throw new Error('case_vortex_performance_artifacts_not_unique');
      artifacts.add(artifact);
    }
    const metrics = {
      publicationManifestVerified: boolean(run.metrics?.publicationManifestVerified,
        'case_vortex_performance_metrics_invalid'),
      expectedRecordCount: integer(run.metrics?.expectedRecordCount,
        'case_vortex_performance_metrics_invalid', 1),
      addressableRecordCount: integer(run.metrics?.addressableRecordCount,
        'case_vortex_performance_metrics_invalid', 0),
      exhaustiveAddressLookupVerified: boolean(run.metrics?.exhaustiveAddressLookupVerified,
        'case_vortex_performance_metrics_invalid'),
      renderedPointCount: integer(run.metrics?.renderedPointCount,
        'case_vortex_performance_metrics_invalid', 1),
      readyMs: finite(run.metrics?.readyMs, 'case_vortex_performance_metrics_invalid'),
      firstResultMs: finite(run.metrics?.firstResultMs, 'case_vortex_performance_metrics_invalid'),
      recordOpenMs: finite(run.metrics?.recordOpenMs, 'case_vortex_performance_metrics_invalid'),
      interactionP95Ms: finite(run.metrics?.interactionP95Ms, 'case_vortex_performance_metrics_invalid'),
      frameP95Ms: finite(run.metrics?.frameP95Ms, 'case_vortex_performance_metrics_invalid'),
      frameP99Ms: finite(run.metrics?.frameP99Ms, 'case_vortex_performance_metrics_invalid'),
      droppedFrameRatio: finite(run.metrics?.droppedFrameRatio,
        'case_vortex_performance_metrics_invalid', 0, 1),
      maxLongTaskMs: finite(run.metrics?.maxLongTaskMs, 'case_vortex_performance_metrics_invalid'),
      longTaskCount: integer(run.metrics?.longTaskCount, 'case_vortex_performance_metrics_invalid'),
      retainedHeapBytes: integer(run.metrics?.retainedHeapBytes, 'case_vortex_performance_metrics_invalid'),
      gpuMemoryBytes: integer(run.metrics?.gpuMemoryBytes, 'case_vortex_performance_metrics_invalid'),
      cpuUtilizationP95Percent: finite(run.metrics?.cpuUtilizationP95Percent,
        'case_vortex_performance_metrics_invalid', 0, 100),
      gpuUtilizationP95Percent: finite(run.metrics?.gpuUtilizationP95Percent,
        'case_vortex_performance_metrics_invalid', 0, 100),
      networkTransferredBytes: integer(run.metrics?.networkTransferredBytes,
        'case_vortex_performance_metrics_invalid'),
      thermalStateStart: run.metrics?.thermalStateStart,
      thermalStateEnd: run.metrics?.thermalStateEnd,
      pageErrorCount: integer(run.metrics?.pageErrorCount, 'case_vortex_performance_metrics_invalid'),
      consoleErrorCount: integer(run.metrics?.consoleErrorCount, 'case_vortex_performance_metrics_invalid'),
    };
    const thermalStates = ['nominal', 'fair', 'serious', 'critical'];
    if (!thermalStates.includes(metrics.thermalStateStart)
      || !thermalStates.includes(metrics.thermalStateEnd)) {
      throw new Error('case_vortex_performance_metrics_invalid');
    }
    const budget = CASE_VORTEX_PERFORMANCE_BUDGETS[run.profile];
    const checks = {
      physical_hardware: device.physicalDevice && !device.browserEmulation,
      profile_hardware: run.profile === 'desktop_physical'
        ? device.viewportWidth >= 1_280 && device.viewportHeight >= 720
        : run.profile === 'mobile_physical'
          ? device.viewportWidth <= 480 && device.touchPoints > 0
          : device.physicalMemoryGb <= 4 && device.logicalProcessors <= 4 && device.dataSaverEnabled,
      publication_manifest: metrics.publicationManifestVerified,
      complete_addressability: metrics.expectedRecordCount === expectedRecordCount
        && metrics.addressableRecordCount === expectedRecordCount
        && metrics.exhaustiveAddressLookupVerified,
      rendered_points_bounded: metrics.renderedPointCount <= expectedRecordCount,
      ready_budget: metrics.readyMs <= budget.readyMs,
      first_result_budget: metrics.firstResultMs <= budget.firstResultMs,
      record_open_budget: metrics.recordOpenMs <= budget.recordOpenMs,
      interaction_budget: metrics.interactionP95Ms <= budget.interactionP95Ms,
      frame_p95_budget: metrics.frameP95Ms <= budget.frameP95Ms,
      frame_p99_budget: metrics.frameP99Ms <= budget.frameP99Ms,
      dropped_frame_budget: metrics.droppedFrameRatio <= budget.droppedFrameRatio,
      long_task_budget: metrics.maxLongTaskMs <= budget.maxLongTaskMs,
      heap_budget: metrics.retainedHeapBytes <= MAX_HEAP_BYTES,
      gpu_memory_budget: metrics.gpuMemoryBytes <= MAX_GPU_MEMORY_BYTES,
      network_budget: metrics.networkTransferredBytes <= MAX_NETWORK_BYTES,
      thermal_budget: metrics.thermalStateStart !== 'critical' && metrics.thermalStateEnd !== 'critical',
      runtime_errors: metrics.pageErrorCount === 0 && metrics.consoleErrorCount === 0,
    };
    return {
      profile: run.profile,
      runOrdinal: run.runOrdinal,
      cacheState: run.cacheState,
      capturedAt,
      device,
      evidence,
      metrics,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  });
  if (runKeys.size !== expectedPlan.slots.length
    || expectedPlan.slots.some((slot) => !runKeys.has(runKey(slot.profile, slot.runOrdinal)))) {
    throw new Error('case_vortex_performance_run_coverage_invalid');
  }
  const failedRuns = normalizedRuns.filter(({ passed }) => !passed);
  const withoutDigest = {
    recordType: 'case_vortex_performance_matrix_report' as const,
    schemaVersion: CASE_VORTEX_PERFORMANCE_MATRIX_VERSION,
    planId,
    planSha256,
    publication,
    expectedRecordCount,
    completedAt,
    accounting: {
      profileCount: deviceByProfile.size,
      runCount: normalizedRuns.length,
      passedRunCount: normalizedRuns.length - failedRuns.length,
      failedRunCount: failedRuns.length,
      retainedArtifactCount: artifacts.size,
    },
    runs: normalizedRuns,
    performanceMatrixPassed: failedRuns.length === 0,
    limitations: [
      'This report proves only the named publication, devices, browser versions, retained artifacts and capture interval.',
      'Synthetic throttling and browser emulation do not count as physical-device evidence.',
      'A new publication or material renderer change requires a new plan and complete rerun.',
    ],
  };
  return { ...withoutDigest, reportSha256: relationshipInputSha256(withoutDigest) };
};
