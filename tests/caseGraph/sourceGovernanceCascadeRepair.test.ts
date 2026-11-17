import { describe, expect, it } from 'vitest';

import {
  buildSourceGovernanceCascadeRepairPlan,
  verifySourceGovernanceCascadeRepairPlan,
  type SourceGovernanceCascadeRepairState,
} from '../../src/caseGraph/sourceGovernanceCascadeRepair';

const preState = (): SourceGovernanceCascadeRepairState => ({
  serverVersionNum: 170006,
  app0218Present: true,
  supabase0218Present: true,
  appRepairPresent: false,
  supabaseRepairPresent: false,
  functionPresent: true,
  zeroSightingGuardPresent: false,
  normalizedSourceIndexPresent: true,
  normalizedSourceIndexAligned: true,
  targetRegistryRowCount: 0,
  targetSightingExists: false,
  activePublicationCount: 0,
});

describe('source-governance cascade repair plan', () => {
  it('seals the exact zero-sighting migration boundary without publication authority', () => {
    const plan = buildSourceGovernanceCascadeRepairPlan({
      createdAt: '2026-07-27T16:30:00.000Z',
      observedState: preState(),
      migrationSha256: 'a'.repeat(64),
    });

    expect(verifySourceGovernanceCascadeRepairPlan(plan)).toEqual(plan);
    expect(plan.boundary).toMatchObject({
      targetCanonicalSources: ['ADSB_LOL', 'NOAA_NCEI_US_OBSERVATIONS'],
      targetRegistryRowCount: 0,
      targetSightingExists: false,
      activePublicationCount: 0,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(plan.guarantees).toMatchObject({
      triggersDisabled: 0,
      registryRowsWritten: 0,
      publicationActivations: 0,
      deployments: 0,
    });
  });

  it('rejects registry, publication, or migration-byte drift', () => {
    expect(() => buildSourceGovernanceCascadeRepairPlan({
      createdAt: '2026-07-27T16:30:00.000Z',
      observedState: { ...preState(), targetRegistryRowCount: 1 },
      migrationSha256: 'a'.repeat(64),
    })).toThrow('source_governance_cascade_repair_boundary_invalid');

    const plan = buildSourceGovernanceCascadeRepairPlan({
      createdAt: '2026-07-27T16:30:00.000Z',
      observedState: preState(),
      migrationSha256: 'a'.repeat(64),
    });
    expect(() => verifySourceGovernanceCascadeRepairPlan({
      ...plan,
      repair: { ...plan.repair, sha256: 'b'.repeat(64) },
    })).toThrow();
  });
});
