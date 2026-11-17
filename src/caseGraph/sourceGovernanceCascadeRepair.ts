import { createHash } from 'node:crypto';

import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const SOURCE_GOVERNANCE_CASCADE_REPAIR_FILE =
  '0219_source_governance_zero_sighting_cascade_2026_07_27.sql' as const;
export const SOURCE_GOVERNANCE_CASCADE_REPAIR_VERSION = '0219' as const;
export const SOURCE_GOVERNANCE_CASCADE_REPAIR_PLAN_VERSION =
  'case-vortex-source-governance-cascade-repair-plan-v1' as const;
export const SOURCE_GOVERNANCE_CASCADE_REPAIR_SCOPE =
  'repair_zero_sighting_source_governance_cascade_only' as const;
export const SOURCE_GOVERNANCE_CASCADE_REPAIR_AUTHORIZATION_BASIS =
  'user_standing_authorization_2026_07_27' as const;

export type SourceGovernanceCascadeRepairState = {
  serverVersionNum: number;
  app0218Present: boolean;
  supabase0218Present: boolean;
  appRepairPresent: boolean;
  supabaseRepairPresent: boolean;
  functionPresent: boolean;
  zeroSightingGuardPresent: boolean;
  normalizedSourceIndexPresent: boolean;
  normalizedSourceIndexAligned: boolean;
  targetRegistryRowCount: number;
  targetSightingExists: boolean;
  activePublicationCount: number;
};

export type SourceGovernanceCascadeRepairPlan = {
  recordType: 'case_vortex_source_governance_cascade_repair_plan';
  schemaVersion: typeof SOURCE_GOVERNANCE_CASCADE_REPAIR_PLAN_VERSION;
  createdAt: string;
  authorizationBasis: typeof SOURCE_GOVERNANCE_CASCADE_REPAIR_AUTHORIZATION_BASIS;
  observedState: SourceGovernanceCascadeRepairState;
  repair: {
    version: typeof SOURCE_GOVERNANCE_CASCADE_REPAIR_VERSION;
    fileName: typeof SOURCE_GOVERNANCE_CASCADE_REPAIR_FILE;
    sha256: string;
    scope: typeof SOURCE_GOVERNANCE_CASCADE_REPAIR_SCOPE;
    transactionMode: 'single-transaction';
    appTrackerWrite: 1;
    supabaseTrackerWrite: 1;
  };
  boundary: {
    exactObservedStateRequired: true;
    exactMigrationBytesRequired: true;
    targetCanonicalSources: ['ADSB_LOL', 'NOAA_NCEI_US_OBSERVATIONS'];
    targetRegistryRowCount: 0;
    targetSightingExists: false;
    activePublicationCount: 0;
    publicationActivationApproved: false;
    deploymentApproved: false;
  };
  guarantees: {
    triggersDisabled: 0;
    triggersDropped: 0;
    registryRowsWritten: 0;
    providerCalls: 0;
    storageReads: 0;
    storageWrites: 0;
    lunaCalls: 0;
    publicationActivations: 0;
    deployments: 0;
  };
  planSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new Error(code); };

export const sourceGovernanceCascadeRepairRawSha256 = (value: Buffer | string) => (
  createHash('sha256').update(value).digest('hex')
);

const timestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 40) {
    fail('source_governance_cascade_repair_timestamp_invalid');
  }
  try {
    if (new Date(value as string).toISOString() !== value) throw new Error();
  } catch {
    fail('source_governance_cascade_repair_timestamp_invalid');
  }
  return value as string;
};

export const sourceGovernanceCascadeRepairPreStateValid = (
  state: SourceGovernanceCascadeRepairState,
) => (
  Number.isSafeInteger(state.serverVersionNum) && state.serverVersionNum >= 170000
  && state.app0218Present && state.supabase0218Present
  && !state.appRepairPresent && !state.supabaseRepairPresent
  && state.functionPresent && !state.zeroSightingGuardPresent
  && state.normalizedSourceIndexPresent && state.normalizedSourceIndexAligned
  && state.targetRegistryRowCount === 0 && !state.targetSightingExists
  && state.activePublicationCount === 0
);

export const sourceGovernanceCascadeRepairPostStateValid = (
  state: SourceGovernanceCascadeRepairState,
) => (
  Number.isSafeInteger(state.serverVersionNum) && state.serverVersionNum >= 170000
  && state.app0218Present && state.supabase0218Present
  && state.appRepairPresent && state.supabaseRepairPresent
  && state.functionPresent && state.zeroSightingGuardPresent
  && state.normalizedSourceIndexPresent && state.normalizedSourceIndexAligned
  && state.targetRegistryRowCount === 0 && !state.targetSightingExists
  && state.activePublicationCount === 0
);

export const buildSourceGovernanceCascadeRepairPlan = (input: {
  createdAt: string;
  observedState: SourceGovernanceCascadeRepairState;
  migrationSha256: string;
}) => {
  const createdAt = timestamp(input.createdAt);
  if (!SHA256.test(input.migrationSha256)
    || !sourceGovernanceCascadeRepairPreStateValid(input.observedState)) {
    fail('source_governance_cascade_repair_boundary_invalid');
  }
  const body: Omit<SourceGovernanceCascadeRepairPlan, 'planSha256'> = {
    recordType: 'case_vortex_source_governance_cascade_repair_plan',
    schemaVersion: SOURCE_GOVERNANCE_CASCADE_REPAIR_PLAN_VERSION,
    createdAt,
    authorizationBasis: SOURCE_GOVERNANCE_CASCADE_REPAIR_AUTHORIZATION_BASIS,
    observedState: { ...input.observedState },
    repair: {
      version: SOURCE_GOVERNANCE_CASCADE_REPAIR_VERSION,
      fileName: SOURCE_GOVERNANCE_CASCADE_REPAIR_FILE,
      sha256: input.migrationSha256,
      scope: SOURCE_GOVERNANCE_CASCADE_REPAIR_SCOPE,
      transactionMode: 'single-transaction',
      appTrackerWrite: 1,
      supabaseTrackerWrite: 1,
    },
    boundary: {
      exactObservedStateRequired: true,
      exactMigrationBytesRequired: true,
      targetCanonicalSources: ['ADSB_LOL', 'NOAA_NCEI_US_OBSERVATIONS'],
      targetRegistryRowCount: 0,
      targetSightingExists: false,
      activePublicationCount: 0,
      publicationActivationApproved: false,
      deploymentApproved: false,
    },
    guarantees: {
      triggersDisabled: 0,
      triggersDropped: 0,
      registryRowsWritten: 0,
      providerCalls: 0,
      storageReads: 0,
      storageWrites: 0,
      lunaCalls: 0,
      publicationActivations: 0,
      deployments: 0,
    },
  };
  return { ...body, planSha256: relationshipInputSha256(body) };
};

export const verifySourceGovernanceCascadeRepairPlan = (
  value: SourceGovernanceCascadeRepairPlan,
) => {
  const rebuilt = buildSourceGovernanceCascadeRepairPlan({
    createdAt: value.createdAt,
    observedState: value.observedState,
    migrationSha256: value.repair.sha256,
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    fail('source_governance_cascade_repair_plan_tampered');
  }
  return rebuilt;
};
