import { describe, expect, it } from 'vitest';

import {
  buildCaseVortexAuthoritativeProofPacket,
  verifyCaseVortexAuthoritativeProofPacket,
} from '../../src/caseGraph/authoritativeProofPacket';
import { CASE_VORTEX_FULL_RUN_GATES } from '../../src/caseGraph/fullRunReport';

const input = {
  packetId: 'proof-2026-07-22',
  createdAt: '2026-07-22T12:00:00.000Z',
  publication: {
    publicationId: '123e4567-e89b-42d3-a456-426614174000',
    corpusVersion: '2026-07-22-v1',
    manifestSha256: 'a'.repeat(64),
  },
  expectedRecordCount: 466_935,
};

describe('Case Vortex authoritative proof packet', () => {
  it('creates one deterministic zero-credit packet bound to one frozen publication', () => {
    const first = buildCaseVortexAuthoritativeProofPacket(input);
    const second = buildCaseVortexAuthoritativeProofPacket(input);

    expect(first).toEqual(second);
    expect(verifyCaseVortexAuthoritativeProofPacket(first)).toEqual(first);
    expect(first.gateLedger).toHaveLength(CASE_VORTEX_FULL_RUN_GATES.length);
    expect(first.gateLedger.every((gate) => gate.evidenceCredit === 0
      && gate.status === 'awaiting_authoritative_evidence'
      && gate.artifactSha256 === null)).toBe(true);
    expect(first.safeguards).toMatchObject({
      fixtureLegacyOrSyntheticEvidenceAllowed: false,
      realHumanReviewRequired: true,
      physicalDeviceEvidenceRequired: true,
      evidenceCreditAtGeneration: 0,
      deploymentsDuringGeneration: 0,
    });
    expect(first.calibrationCeremony).toMatchObject({
      minimumPairLabels: 1001,
      minimumContextualLabels: 801,
      minimumIndependentReviewers: 2,
      separateAdjudicatorRequired: true,
      evidenceCredit: 0,
    });
  });

  it('embeds every real-session plan without crediting any session as completed', () => {
    const packet = buildCaseVortexAuthoritativeProofPacket(input);
    expect(packet.plans.investigatorStudy.slots).toHaveLength(200);
    expect(packet.plans.investigatorStudy.slots.filter((slot) => slot.requiresSourceReconstruction))
      .toHaveLength(50);
    expect(packet.plans.assistiveReview.sessions).toHaveLength(2);
    expect(packet.plans.assistiveReview.sessions.flatMap((session) => session.tasks)).toHaveLength(24);
    expect(packet.plans.performanceMatrix.slots).toHaveLength(9);
    expect(packet.plans.browserDeviceMatrix.sessions).toHaveLength(7);
    expect(packet.plans.browserDeviceMatrix.sessions.flatMap((session) => session.journeys)).toHaveLength(98);
    for (const plan of Object.values(packet.plans)) {
      expect(plan.publication).toEqual(input.publication);
    }
  });

  it('rejects tampered derived fields, simulated credit and publication drift', () => {
    const packet = buildCaseVortexAuthoritativeProofPacket(input);
    expect(() => verifyCaseVortexAuthoritativeProofPacket({
      ...packet,
      gateLedger: packet.gateLedger.map((gate, index) => index === 0
        ? { ...gate, evidenceCredit: 1 as never }
        : gate),
    })).toThrow('case_vortex_authoritative_proof_packet_derived_fields_invalid');
    expect(() => verifyCaseVortexAuthoritativeProofPacket({
      ...packet,
      publication: { ...packet.publication, manifestSha256: 'b'.repeat(64) },
    })).toThrow('case_vortex_authoritative_proof_packet_derived_fields_invalid');
  });

  it('rejects invalid identities, timestamps and record counts', () => {
    expect(() => buildCaseVortexAuthoritativeProofPacket({
      ...input, publication: { ...input.publication, publicationId: 'legacy-fixture' },
    })).toThrow('case_vortex_authoritative_proof_packet_publication_invalid');
    expect(() => buildCaseVortexAuthoritativeProofPacket({ ...input, createdAt: 'yesterday' }))
      .toThrow('case_vortex_authoritative_proof_packet_timestamp_invalid');
    expect(() => buildCaseVortexAuthoritativeProofPacket({ ...input, expectedRecordCount: 0 }))
      .toThrow('case_vortex_authoritative_proof_packet_record_count_invalid');
  });
});
