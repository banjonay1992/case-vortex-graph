import { CASE_VORTEX_RESEARCH_TOOL_NAMES } from '../shared/caseVortexResearchTools';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION = 'case-vortex-browser-device-matrix-v1' as const;

export const CASE_VORTEX_BROWSER_DEVICE_PROFILES = [
  'desktop', 'tablet', 'compact', 'mobile', 'reduced_motion', 'no_webgl', 'low_power',
] as const;
export type CaseVortexBrowserDeviceProfile = typeof CASE_VORTEX_BROWSER_DEVICE_PROFILES[number];

export const CASE_VORTEX_BROWSER_DEVICE_JOURNEYS = [
  'research_entry',
  'luna_question_and_followup',
  'all_record_orb_and_semantic_zoom',
  'claim_graph_and_counterclaim',
  'source_reliability_and_similar_cases',
  'workspace_and_living_dossier',
  'external_correlations_all_domains',
  'precise_locator_modalities',
  'report_download_and_offline_verify',
  'keyboard_focus_and_screenreader_navigator',
  'tool_contract_and_continuation',
  'fail_closed_unavailable_evidence',
  'responsive_containment',
  'return_to_orb_context',
] as const;
export type CaseVortexBrowserDeviceJourney = typeof CASE_VORTEX_BROWSER_DEVICE_JOURNEYS[number];

const SHA256 = /^[a-f0-9]{64}$/u;
const EXTERNAL_DOMAINS = [
  'aircraft', 'satellites', 'balloons', 'astronomy', 'meteors',
  'military_exercises', 'launches', 'maritime', 'weather',
] as const;
const LOCATOR_MODALITIES = ['quotation', 'pdf_page', 'timestamp', 'frame', 'image_region'] as const;

export type CaseVortexBrowserDevicePublication = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
};

export type CaseVortexBrowserDeviceMatrixPlan = {
  recordType: 'case_vortex_browser_device_matrix_plan';
  schemaVersion: typeof CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION;
  planId: string;
  publication: CaseVortexBrowserDevicePublication;
  expectedRecordCount: number;
  requirements: {
    profiles: typeof CASE_VORTEX_BROWSER_DEVICE_PROFILES;
    journeys: typeof CASE_VORTEX_BROWSER_DEVICE_JOURNEYS;
    researchTools: typeof CASE_VORTEX_RESEARCH_TOOL_NAMES;
    externalDomains: typeof EXTERNAL_DOMAINS;
    locatorModalities: typeof LOCATOR_MODALITIES;
    currentPublicationRequired: true;
    fixtureOrLegacyQaAllowed: false;
    zeroRuntimeErrorsRequired: true;
    zeroScopedAccessibilityViolationsRequired: true;
  };
  sessions: Array<{
    profile: CaseVortexBrowserDeviceProfile;
    journeys: Array<{ journey: CaseVortexBrowserDeviceJourney; outcome: null }>;
  }>;
  planSha256: string;
};

export type CaseVortexBrowserDeviceMatrixInput = {
  recordType: 'case_vortex_browser_device_matrix_input';
  schemaVersion: typeof CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION;
  planId: string;
  planSha256: string;
  publication: CaseVortexBrowserDevicePublication;
  expectedRecordCount: number;
  completedAt: string;
  sessions: Array<{
    profile: CaseVortexBrowserDeviceProfile;
    capturedAt: string;
    environment: {
      browserName: string;
      browserVersion: string;
      operatingSystem: string;
      operatingSystemVersion: string;
      viewportWidth: number;
      viewportHeight: number;
      reducedMotion: boolean;
      webglAvailable: boolean;
      lowPowerMode: boolean;
      dataSaverEnabled: boolean;
      deviceMemoryGb: number;
      logicalProcessors: number;
    };
    evidence: {
      traceSha256: string;
      screenshotSha256: string;
      networkHarSha256: string;
      accessibilitySha256: string;
    };
    publicationManifestVerified: boolean;
    addressableRecordCount: number;
    toolNamesObserved: string[];
    unknownToolRejected: boolean;
    externalDomainsObserved: string[];
    locatorModalitiesObserved: string[];
    axeViolationCount: number;
    pageErrorCount: number;
    consoleErrorCount: number;
    failedResponseCount: number;
    horizontalOverflow: boolean;
    journeyOutcomes: Array<{
      journey: CaseVortexBrowserDeviceJourney;
      completed: boolean;
      assertionCount: number;
      failureCount: number;
      receiptSha256: string;
    }>;
  }>;
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
const publication = (value: CaseVortexBrowserDevicePublication) => ({
  publicationId: bounded(value?.publicationId, 'case_vortex_browser_device_publication_invalid', 200),
  corpusVersion: bounded(value?.corpusVersion, 'case_vortex_browser_device_publication_invalid', 200),
  manifestSha256: digest(value?.manifestSha256, 'case_vortex_browser_device_publication_invalid'),
});
const sameOrderedSet = (actual: string[], expected: readonly string[]) => (
  actual.length === expected.length && new Set(actual).size === actual.length
  && expected.every((value) => actual.includes(value))
);

export const buildCaseVortexBrowserDeviceMatrixPlan = (input: {
  planId: string;
  publication: CaseVortexBrowserDevicePublication;
  expectedRecordCount: number;
}): CaseVortexBrowserDeviceMatrixPlan => {
  const withoutDigest = {
    recordType: 'case_vortex_browser_device_matrix_plan' as const,
    schemaVersion: CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION,
    planId: bounded(input.planId, 'case_vortex_browser_device_plan_id_invalid', 200),
    publication: publication(input.publication),
    expectedRecordCount: integer(input.expectedRecordCount,
      'case_vortex_browser_device_record_count_invalid', 1),
    requirements: {
      profiles: CASE_VORTEX_BROWSER_DEVICE_PROFILES,
      journeys: CASE_VORTEX_BROWSER_DEVICE_JOURNEYS,
      researchTools: CASE_VORTEX_RESEARCH_TOOL_NAMES,
      externalDomains: EXTERNAL_DOMAINS,
      locatorModalities: LOCATOR_MODALITIES,
      currentPublicationRequired: true as const,
      fixtureOrLegacyQaAllowed: false as const,
      zeroRuntimeErrorsRequired: true as const,
      zeroScopedAccessibilityViolationsRequired: true as const,
    },
    sessions: CASE_VORTEX_BROWSER_DEVICE_PROFILES.map((profile) => ({
      profile,
      journeys: CASE_VORTEX_BROWSER_DEVICE_JOURNEYS.map((journey) => ({ journey, outcome: null })),
    })),
  };
  return { ...withoutDigest, planSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexBrowserDeviceMatrixPlan = (value: CaseVortexBrowserDeviceMatrixPlan) => {
  if (!value || value.recordType !== 'case_vortex_browser_device_matrix_plan'
    || value.schemaVersion !== CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION
    || !SHA256.test(value.planSha256)) return false;
  const { planSha256, ...withoutDigest } = value;
  return relationshipInputSha256(withoutDigest) === planSha256;
};

const environmentPassesProfile = (
  profile: CaseVortexBrowserDeviceProfile,
  environment: CaseVortexBrowserDeviceMatrixInput['sessions'][number]['environment'],
) => {
  if (profile === 'desktop') return environment.viewportWidth === 1_440 && environment.viewportHeight === 1_000;
  if (profile === 'tablet') return environment.viewportWidth === 900 && environment.viewportHeight === 900;
  if (profile === 'compact') return environment.viewportWidth === 560 && environment.viewportHeight === 900;
  if (profile === 'mobile') return environment.viewportWidth === 390 && environment.viewportHeight === 844;
  if (profile === 'reduced_motion') return environment.viewportWidth === 900
    && environment.viewportHeight === 900 && environment.reducedMotion;
  if (profile === 'no_webgl') return environment.viewportWidth === 560
    && environment.viewportHeight === 900 && !environment.webglAvailable;
  return environment.viewportWidth === 560 && environment.viewportHeight === 900
    && environment.lowPowerMode && environment.dataSaverEnabled
    && environment.deviceMemoryGb <= 2 && environment.logicalProcessors <= 2;
};

export const buildCaseVortexBrowserDeviceMatrixReport = (input: CaseVortexBrowserDeviceMatrixInput) => {
  if (!input || input.recordType !== 'case_vortex_browser_device_matrix_input'
    || input.schemaVersion !== CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION
    || !Array.isArray(input.sessions) || input.sessions.length !== CASE_VORTEX_BROWSER_DEVICE_PROFILES.length) {
    throw new Error('case_vortex_browser_device_input_invalid');
  }
  const normalizedPublication = publication(input.publication);
  const planId = bounded(input.planId, 'case_vortex_browser_device_plan_id_invalid', 200);
  const expectedRecordCount = integer(input.expectedRecordCount,
    'case_vortex_browser_device_record_count_invalid', 1);
  const planSha256 = digest(input.planSha256, 'case_vortex_browser_device_plan_digest_invalid');
  const expectedPlan = buildCaseVortexBrowserDeviceMatrixPlan({
    planId, publication: normalizedPublication, expectedRecordCount,
  });
  if (planSha256 !== expectedPlan.planSha256) throw new Error('case_vortex_browser_device_plan_binding_invalid');
  const completedAt = timestamp(input.completedAt, 'case_vortex_browser_device_completed_at_invalid');
  const profiles = new Set<CaseVortexBrowserDeviceProfile>();
  const artifacts = new Set<string>();
  const journeyReceipts = new Set<string>();
  const normalizedSessions = input.sessions.map((session) => {
    if (!CASE_VORTEX_BROWSER_DEVICE_PROFILES.includes(session.profile) || profiles.has(session.profile)
      || !Array.isArray(session.toolNamesObserved) || !Array.isArray(session.externalDomainsObserved)
      || !Array.isArray(session.locatorModalitiesObserved) || !Array.isArray(session.journeyOutcomes)
      || session.journeyOutcomes.length !== CASE_VORTEX_BROWSER_DEVICE_JOURNEYS.length) {
      throw new Error('case_vortex_browser_device_session_invalid');
    }
    profiles.add(session.profile);
    const capturedAt = timestamp(session.capturedAt, 'case_vortex_browser_device_session_invalid');
    if (capturedAt > completedAt) throw new Error('case_vortex_browser_device_session_invalid');
    const environment = {
      browserName: bounded(session.environment?.browserName, 'case_vortex_browser_device_environment_invalid', 100),
      browserVersion: bounded(session.environment?.browserVersion,
        'case_vortex_browser_device_environment_invalid', 100),
      operatingSystem: bounded(session.environment?.operatingSystem,
        'case_vortex_browser_device_environment_invalid', 100),
      operatingSystemVersion: bounded(session.environment?.operatingSystemVersion,
        'case_vortex_browser_device_environment_invalid', 100),
      viewportWidth: integer(session.environment?.viewportWidth,
        'case_vortex_browser_device_environment_invalid', 240, 10_000),
      viewportHeight: integer(session.environment?.viewportHeight,
        'case_vortex_browser_device_environment_invalid', 240, 10_000),
      reducedMotion: boolean(session.environment?.reducedMotion,
        'case_vortex_browser_device_environment_invalid'),
      webglAvailable: boolean(session.environment?.webglAvailable,
        'case_vortex_browser_device_environment_invalid'),
      lowPowerMode: boolean(session.environment?.lowPowerMode,
        'case_vortex_browser_device_environment_invalid'),
      dataSaverEnabled: boolean(session.environment?.dataSaverEnabled,
        'case_vortex_browser_device_environment_invalid'),
      deviceMemoryGb: finite(session.environment?.deviceMemoryGb,
        'case_vortex_browser_device_environment_invalid', 0.25, 1_024),
      logicalProcessors: integer(session.environment?.logicalProcessors,
        'case_vortex_browser_device_environment_invalid', 1, 1_024),
    };
    const evidence = {
      traceSha256: digest(session.evidence?.traceSha256, 'case_vortex_browser_device_evidence_invalid'),
      screenshotSha256: digest(session.evidence?.screenshotSha256,
        'case_vortex_browser_device_evidence_invalid'),
      networkHarSha256: digest(session.evidence?.networkHarSha256,
        'case_vortex_browser_device_evidence_invalid'),
      accessibilitySha256: digest(session.evidence?.accessibilitySha256,
        'case_vortex_browser_device_evidence_invalid'),
    };
    for (const artifact of Object.values(evidence)) {
      if (artifacts.has(artifact)) throw new Error('case_vortex_browser_device_artifacts_not_unique');
      artifacts.add(artifact);
    }
    const seenJourneys = new Set<CaseVortexBrowserDeviceJourney>();
    const journeyOutcomes = session.journeyOutcomes.map((outcome) => {
      if (!CASE_VORTEX_BROWSER_DEVICE_JOURNEYS.includes(outcome.journey)
        || seenJourneys.has(outcome.journey) || typeof outcome.completed !== 'boolean') {
        throw new Error('case_vortex_browser_device_journey_invalid');
      }
      seenJourneys.add(outcome.journey);
      const receiptSha256 = digest(outcome.receiptSha256,
        'case_vortex_browser_device_journey_invalid');
      if (journeyReceipts.has(receiptSha256)) {
        throw new Error('case_vortex_browser_device_journey_receipts_not_unique');
      }
      journeyReceipts.add(receiptSha256);
      const assertionCount = integer(outcome.assertionCount,
        'case_vortex_browser_device_journey_invalid', 1, 100_000);
      const failureCount = integer(outcome.failureCount,
        'case_vortex_browser_device_journey_invalid', 0, assertionCount);
      return {
        journey: outcome.journey,
        completed: outcome.completed,
        assertionCount,
        failureCount,
        receiptSha256,
        passed: outcome.completed && failureCount === 0,
      };
    });
    const addressableRecordCount = integer(session.addressableRecordCount,
      'case_vortex_browser_device_accounting_invalid', 0);
    const checks = {
      profile_environment: environmentPassesProfile(session.profile, environment),
      publication_manifest: boolean(session.publicationManifestVerified,
        'case_vortex_browser_device_accounting_invalid'),
      complete_addressability: addressableRecordCount === expectedRecordCount,
      complete_tool_contract: sameOrderedSet(session.toolNamesObserved, CASE_VORTEX_RESEARCH_TOOL_NAMES),
      unknown_tool_rejected: boolean(session.unknownToolRejected,
        'case_vortex_browser_device_accounting_invalid'),
      all_external_domains: sameOrderedSet(session.externalDomainsObserved, EXTERNAL_DOMAINS),
      all_locator_modalities: sameOrderedSet(session.locatorModalitiesObserved, LOCATOR_MODALITIES),
      all_journeys: journeyOutcomes.every(({ passed }) => passed),
      zero_accessibility_violations: integer(session.axeViolationCount,
        'case_vortex_browser_device_accounting_invalid') === 0,
      zero_runtime_errors: integer(session.pageErrorCount,
        'case_vortex_browser_device_accounting_invalid') === 0
        && integer(session.consoleErrorCount, 'case_vortex_browser_device_accounting_invalid') === 0
        && integer(session.failedResponseCount, 'case_vortex_browser_device_accounting_invalid') === 0,
      viewport_containment: boolean(session.horizontalOverflow,
        'case_vortex_browser_device_accounting_invalid') === false,
    };
    return {
      profile: session.profile,
      capturedAt,
      environment,
      evidence,
      publicationManifestVerified: session.publicationManifestVerified,
      addressableRecordCount,
      toolNamesObserved: [...session.toolNamesObserved],
      unknownToolRejected: session.unknownToolRejected,
      externalDomainsObserved: [...session.externalDomainsObserved],
      locatorModalitiesObserved: [...session.locatorModalitiesObserved],
      axeViolationCount: session.axeViolationCount,
      pageErrorCount: session.pageErrorCount,
      consoleErrorCount: session.consoleErrorCount,
      failedResponseCount: session.failedResponseCount,
      horizontalOverflow: session.horizontalOverflow,
      journeyOutcomes,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  });
  const failedSessions = normalizedSessions.filter(({ passed }) => !passed);
  const withoutDigest = {
    recordType: 'case_vortex_browser_device_matrix_report' as const,
    schemaVersion: CASE_VORTEX_BROWSER_DEVICE_MATRIX_VERSION,
    planId,
    planSha256,
    publication: normalizedPublication,
    expectedRecordCount,
    completedAt,
    accounting: {
      profileCount: profiles.size,
      sessionCount: normalizedSessions.length,
      journeyObservationCount: normalizedSessions.length * CASE_VORTEX_BROWSER_DEVICE_JOURNEYS.length,
      retainedArtifactCount: artifacts.size,
      retainedJourneyReceiptCount: journeyReceipts.size,
      passedSessionCount: normalizedSessions.length - failedSessions.length,
      failedSessionCount: failedSessions.length,
    },
    sessions: normalizedSessions,
    browserDeviceMatrixPassed: failedSessions.length === 0,
    limitations: [
      'This report proves only the named publication, browsers, operating systems, viewports and retained artifacts.',
      'Fixture, legacy visual-QA and stale-publication sessions cannot satisfy the publication-manifest check.',
      'Physical-device resource and thermal proof is a separate performance-matrix gate.',
    ],
  };
  return { ...withoutDigest, reportSha256: relationshipInputSha256(withoutDigest) };
};
