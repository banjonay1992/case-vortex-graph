import {
  buildCaseVortexAssistiveReviewPlan,
  type CaseVortexAssistiveReviewPlan,
} from './assistiveTechnologyReview';
import {
  buildCaseVortexBrowserDeviceMatrixPlan,
  type CaseVortexBrowserDeviceMatrixPlan,
} from './browserDeviceJourneyMatrix';
import {
  CASE_VORTEX_FULL_RUN_GATES,
  CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS,
  type CaseVortexFullRunGate,
  type CaseVortexFullRunPublication,
} from './fullRunReport';
import {
  buildCaseVortexInvestigatorStudyPlan,
  type CaseVortexInvestigatorStudyPlan,
} from './investigatorStudyPlan';
import {
  buildCaseVortexPerformanceMatrixPlan,
  type CaseVortexPerformanceMatrixPlan,
} from './performanceDeviceMatrix';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_AUTHORITATIVE_PROOF_PACKET_VERSION =
  'case-vortex-authoritative-proof-packet-v1' as const;

export type CaseVortexAuthoritativeProofPacket = {
  recordType: 'case_vortex_authoritative_proof_packet';
  schemaVersion: typeof CASE_VORTEX_AUTHORITATIVE_PROOF_PACKET_VERSION;
  packetId: string;
  createdAt: string;
  publication: CaseVortexFullRunPublication;
  expectedRecordCount: number;
  safeguards: {
    currentFrozenPublicationRequired: true;
    fixtureLegacyOrSyntheticEvidenceAllowed: false;
    realHumanReviewRequired: true;
    physicalDeviceEvidenceRequired: true;
    uniqueRetainedArtifactsRequired: true;
    evidenceCreditAtGeneration: 0;
    databaseWritesDuringGeneration: 0;
    storageReadsDuringGeneration: 0;
    storageWritesDuringGeneration: 0;
    lunaCallsDuringGeneration: 0;
    deploymentsDuringGeneration: 0;
  };
  calibrationCeremony: {
    evidenceClassRequired: 'human_reviewed_locked_holdout';
    evidenceOriginRequired: 'governed_locked_holdout_candidates';
    minimumPairLabels: 1001;
    minimumContextualLabels: 801;
    minimumIndependentReviewers: 2;
    separateAdjudicatorRequired: true;
    attestationRequired: true;
    status: 'pending_authoritative_human_review';
    evidenceCredit: 0;
  };
  plans: {
    investigatorStudy: CaseVortexInvestigatorStudyPlan;
    assistiveReview: CaseVortexAssistiveReviewPlan;
    performanceMatrix: CaseVortexPerformanceMatrixPlan;
    browserDeviceMatrix: CaseVortexBrowserDeviceMatrixPlan;
  };
  gateLedger: Array<{
    gate: CaseVortexFullRunGate;
    requiredArtifactType: string | null;
    requiredSchemaVersion: string | null;
    requiredVerifierVersion: string | null;
    status: 'awaiting_authoritative_evidence';
    artifactSha256: null;
    evidenceCredit: 0;
  }>;
  accounting: {
    requiredGateCount: number;
    investigatorQuerySlots: 200;
    sourceReconstructionSlots: 50;
    assistiveTechnologySessions: 2;
    assistiveTechnologyTasks: 24;
    physicalPerformanceRuns: 9;
    browserDeviceProfiles: 7;
    browserDeviceJourneyObservations: 98;
    creditedGates: 0;
  };
  packetSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;

const bounded = (value: unknown, code: string, pattern: RegExp = ID) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(code);
  return value;
};

const canonicalTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40) {
    throw new Error('case_vortex_authoritative_proof_packet_timestamp_invalid');
  }
  try {
    if (new Date(value).toISOString() !== value) throw new Error();
  } catch {
    throw new Error('case_vortex_authoritative_proof_packet_timestamp_invalid');
  }
  return value;
};

const normalizePublication = (value: CaseVortexFullRunPublication): CaseVortexFullRunPublication => ({
  publicationId: bounded(value?.publicationId,
    'case_vortex_authoritative_proof_packet_publication_invalid', UUID),
  corpusVersion: bounded(value?.corpusVersion,
    'case_vortex_authoritative_proof_packet_publication_invalid'),
  manifestSha256: bounded(value?.manifestSha256,
    'case_vortex_authoritative_proof_packet_publication_invalid', SHA256),
});

export const buildCaseVortexAuthoritativeProofPacket = (input: {
  packetId: string;
  createdAt: string;
  publication: CaseVortexFullRunPublication;
  expectedRecordCount: number;
}): CaseVortexAuthoritativeProofPacket => {
  const packetId = bounded(input.packetId, 'case_vortex_authoritative_proof_packet_id_invalid');
  const createdAt = canonicalTimestamp(input.createdAt);
  const publication = normalizePublication(input.publication);
  if (!Number.isSafeInteger(input.expectedRecordCount) || input.expectedRecordCount < 1) {
    throw new Error('case_vortex_authoritative_proof_packet_record_count_invalid');
  }
  const expectedRecordCount = input.expectedRecordCount;
  const plans = {
    investigatorStudy: buildCaseVortexInvestigatorStudyPlan({
      planId: `${packetId}-investigator`,
      publicationId: publication.publicationId,
      corpusVersion: publication.corpusVersion,
      manifestSha256: publication.manifestSha256,
    }),
    assistiveReview: buildCaseVortexAssistiveReviewPlan({
      planId: `${packetId}-assistive`, publication,
    }),
    performanceMatrix: buildCaseVortexPerformanceMatrixPlan({
      planId: `${packetId}-performance`, publication, expectedRecordCount,
    }),
    browserDeviceMatrix: buildCaseVortexBrowserDeviceMatrixPlan({
      planId: `${packetId}-browser-device`, publication, expectedRecordCount,
    }),
  };
  const gateLedger = CASE_VORTEX_FULL_RUN_GATES.map((gate) => ({
    gate,
    requiredArtifactType: CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate]?.artifactType || null,
    requiredSchemaVersion: CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate]?.schemaVersion || null,
    requiredVerifierVersion: CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate]?.verifierVersion || null,
    status: 'awaiting_authoritative_evidence' as const,
    artifactSha256: null,
    evidenceCredit: 0 as const,
  }));
  const withoutDigest: Omit<CaseVortexAuthoritativeProofPacket, 'packetSha256'> = {
    recordType: 'case_vortex_authoritative_proof_packet',
    schemaVersion: CASE_VORTEX_AUTHORITATIVE_PROOF_PACKET_VERSION,
    packetId,
    createdAt,
    publication,
    expectedRecordCount,
    safeguards: {
      currentFrozenPublicationRequired: true,
      fixtureLegacyOrSyntheticEvidenceAllowed: false,
      realHumanReviewRequired: true,
      physicalDeviceEvidenceRequired: true,
      uniqueRetainedArtifactsRequired: true,
      evidenceCreditAtGeneration: 0,
      databaseWritesDuringGeneration: 0,
      storageReadsDuringGeneration: 0,
      storageWritesDuringGeneration: 0,
      lunaCallsDuringGeneration: 0,
      deploymentsDuringGeneration: 0,
    },
    calibrationCeremony: {
      evidenceClassRequired: 'human_reviewed_locked_holdout',
      evidenceOriginRequired: 'governed_locked_holdout_candidates',
      minimumPairLabels: 1001,
      minimumContextualLabels: 801,
      minimumIndependentReviewers: 2,
      separateAdjudicatorRequired: true,
      attestationRequired: true,
      status: 'pending_authoritative_human_review',
      evidenceCredit: 0,
    },
    plans,
    gateLedger,
    accounting: {
      requiredGateCount: CASE_VORTEX_FULL_RUN_GATES.length,
      investigatorQuerySlots: 200,
      sourceReconstructionSlots: 50,
      assistiveTechnologySessions: 2,
      assistiveTechnologyTasks: 24,
      physicalPerformanceRuns: 9,
      browserDeviceProfiles: 7,
      browserDeviceJourneyObservations: 98,
      creditedGates: 0,
    },
  };
  return { ...withoutDigest, packetSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseVortexAuthoritativeProofPacket = (
  value: CaseVortexAuthoritativeProofPacket,
): CaseVortexAuthoritativeProofPacket => {
  if (!value || value.recordType !== 'case_vortex_authoritative_proof_packet'
    || value.schemaVersion !== CASE_VORTEX_AUTHORITATIVE_PROOF_PACKET_VERSION
    || typeof value.packetSha256 !== 'string' || !SHA256.test(value.packetSha256)) {
    throw new Error('case_vortex_authoritative_proof_packet_invalid');
  }
  const rebuilt = buildCaseVortexAuthoritativeProofPacket({
    packetId: value.packetId,
    createdAt: value.createdAt,
    publication: value.publication,
    expectedRecordCount: value.expectedRecordCount,
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    throw new Error('case_vortex_authoritative_proof_packet_derived_fields_invalid');
  }
  return rebuilt;
};
