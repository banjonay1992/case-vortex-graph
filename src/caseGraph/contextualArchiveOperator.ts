import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';

import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  archiveGovernedContextualObservations,
  decodeGovernedContextualSourceSnapshot,
  readVerifiedContextualObservationArchive,
  type ContextualRelationshipRecordResolver,
  type GovernedContextualObservationSource,
  type GovernedContextualSourceSnapshot,
} from './contextualObservationArchive';
import {
  CONTEXTUAL_SOURCE_CENSUS_VERSION,
  CONTEXTUAL_SOURCE_FAMILIES,
  CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
  contextualSourceCensusSha256,
  contextualSourceThresholdRequirements,
  decodeContextualSourceSnapshotPlan,
  type ContextualSourceFamily,
  type ContextualSourceReadinessCensus,
  type ContextualSourceSnapshotPlan,
} from './contextualSourceMaterializationCensus';
import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import { buildContextualObservationArchiveGovernanceReceipt } from './contextualObservationArchiveGovernance';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_VERSION =
  'case-vortex-contextual-archive-operator-signed-approval-v2' as const;
export const CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION =
  'case-vortex-contextual-archive-principal-registry-v2' as const;
export const CONTEXTUAL_ARCHIVE_EXECUTION_AUTHORIZATION_VERSION =
  'case-vortex-contextual-archive-execution-authorization-v1' as const;
export const CONTEXTUAL_ARCHIVE_OPERATOR_RECEIPT_VERSION =
  'case-vortex-contextual-archive-operator-receipt-v1' as const;
export const CONTEXTUAL_ARCHIVE_OPERATOR_STAGE = 'archive_and_verify_four_families' as const;
export const CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const fail = (code: string): never => { throw new Error(code); };
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[], code: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
};
const text = (value: unknown, maximum: number, code: string) => {
  const stringValue = typeof value === 'string' ? value : fail(code);
  const normalized = stringValue.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) fail(code);
  return normalized;
};
const identity = (value: unknown, code: string) => {
  const normalized = text(value, 240, code);
  if (!ID.test(normalized)) fail(code);
  return normalized;
};
const publicKeyPem = (value: unknown, code: string): string => {
  const pem = typeof value === 'string' ? value : fail(code);
  if (!pem.length || Buffer.byteLength(pem, 'utf8') > 4096
    || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(pem)) fail(code);
  return pem;
};
const digest = (value: unknown, code: string) => {
  const normalized = text(value, 64, code).toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
};
const timestamp = (value: unknown, code: string) => {
  const normalized = text(value, 40, code);
  try {
    if (new Date(normalized).toISOString() !== normalized) fail(code);
  } catch {
    fail(code);
  }
  return normalized;
};
const same = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);
const countValue = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(code);
  return value as number;
};

export const contextualArchiveOperatorAuthorizationStatement =
  'I explicitly approve conditional immutable R2 archival and immediate read-back verification of only the exact four census-bound contextual source snapshots below. This approves no provider call, database write, Luna call, legacy-score derivation, evidence credit, publication mutation, deployment, overwrite, or deletion.' as const;

export type ContextualArchiveOperatorFamilyBinding = {
  sourceFamily: ContextualSourceFamily;
  planDigest: string;
  planCanonicalSha256: string;
  governancePacketDigest: string;
  governancePacketCanonicalSha256: string;
  canonicalSource: string;
  sourceSnapshotDigest: string;
  localSourceManifestCanonicalSha256: string;
  sourcePageCount: number;
  sourcePageSetSha256: string;
  sourceContentSha256: string;
  observedRecordCount: number;
  coveredSubjectCount: number;
  missingSubjectCount: number;
  coveredSubjectAddressSetSha256: string;
  missingSubjectAddressSetSha256: string;
  coveredSubjectLedgerCanonicalSha256: string;
  missingSubjectLedgerCanonicalSha256: string;
  sourceRowDigestSetSha256: string;
};

export type ContextualArchiveOperatorApprovalPayload = {
  recordType: 'contextual_archive_operator_approval_payload';
  schemaVersion: typeof CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_VERSION;
  approvalId: string;
  approvedBy: string;
  approverKeyId: string;
  trustedRegistryDigest: string;
  approvedAt: string;
  expiresAt: string;
  stage: typeof CONTEXTUAL_ARCHIVE_OPERATOR_STAGE;
  censusDigest: string;
  censusCanonicalSha256: string;
  targetBindingDigest: string;
  thresholdPolicyDigest: string;
  families: ContextualArchiveOperatorFamilyBinding[];
  authorizationStatement: typeof contextualArchiveOperatorAuthorizationStatement;
  conditionalR2WritesApproved: true;
  providerCallsApproved: false;
  databaseWritesApproved: false;
  lunaCallsApproved: false;
  legacyScoreDerivationApproved: false;
  evidenceCreditApproved: false;
  publicationMutationApproved: false;
  deploymentApproved: false;
};

export type ContextualArchiveOperatorApproval = ContextualArchiveOperatorApprovalPayload & {
  signatureAlgorithm: 'ed25519';
  signatureBase64: string;
  approvalSha256: string;
};

export type ContextualArchiveTrustedApproverKeyring = {
  recordType: 'contextual_archive_trusted_principal_registry';
  schemaVersion: typeof CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION;
  keys: ReadonlyArray<{
    keyId: string;
    approverIdentity: string;
    role: 'approver' | 'operator';
    algorithm: 'ed25519';
    publicKeySpkiPem: string;
    validFrom: string;
    validUntil: string;
    status: 'trusted';
  }>;
  keyringDigest: string;
};

export type ContextualArchiveExecutionAuthorizationPayload = {
  recordType: 'contextual_archive_execution_authorization_payload';
  schemaVersion: typeof CONTEXTUAL_ARCHIVE_EXECUTION_AUTHORIZATION_VERSION;
  authorizationId: string;
  nonce: string;
  operatorId: string;
  operatorKeyId: string;
  trustedRegistryDigest: string;
  authorizedAt: string;
  expiresAt: string;
  stage: typeof CONTEXTUAL_ARCHIVE_OPERATOR_STAGE;
  approvalSha256: string;
  censusDigest: string;
  censusCanonicalSha256: string;
  targetBindingDigest: string;
  thresholdPolicyDigest: string;
  families: ContextualArchiveOperatorFamilyBinding[];
};

export type ContextualArchiveExecutionAuthorization = ContextualArchiveExecutionAuthorizationPayload & {
  signatureAlgorithm: 'ed25519';
  signatureBase64: string;
  authorizationSha256: string;
};

export type ContextualArchiveOperatorFamilyInput = ContextualArchiveOperatorFamilyBinding & {
  plan: ContextualSourceSnapshotPlan;
  governancePacket: ContextualSourceGovernanceDecisionPacket;
  snapshot: GovernedContextualSourceSnapshot;
  source: GovernedContextualObservationSource;
  resolveRelationshipRecord: ContextualRelationshipRecordResolver;
  coveredSubjectAddresses: string[];
  missingSubjectAddresses: string[];
  sourceRowDigests: string[];
};

export type ContextualArchiveOperatorReceipt = {
  recordType: 'contextual_archive_operator_receipt';
  schemaVersion: typeof CONTEXTUAL_ARCHIVE_OPERATOR_RECEIPT_VERSION;
  operationId: string;
  operatorId: string;
  createdAt: string;
  stage: typeof CONTEXTUAL_ARCHIVE_OPERATOR_STAGE;
  approvalSha256: string;
  executionAuthorizationSha256: string;
  trustedRegistryDigest: string;
  approverKeyId: string;
  operatorKeyId: string;
  censusDigest: string;
  censusCanonicalSha256: string;
  targetBindingDigest: string;
  thresholdPolicyDigest: string;
  families: Array<ContextualArchiveOperatorFamilyBinding & {
    outcome: 'completed' | 'resumed';
    completionManifestDigest: string;
    archiveSetSha256: string;
    verifiedRowCount: number;
    emittedEdgeCount: number;
    insufficientEvidenceCount: number;
  }>;
  accounting: {
    requiredFamilyCount: 4;
    completedFamilyCount: 4;
    verifiedRowCount: number;
    emittedEdgeCount: number;
    insufficientEvidenceCount: number;
  };
  guarantees: {
    providerCalls: 0;
    providerSpend: 0;
    databaseWrites: 0;
    lunaCalls: 0;
    legacyScoreDerivations: 0;
    evidenceCredit: 0;
    publicationMutations: 0;
    deployments: 0;
    storageWriteMode: 'conditional_no_clobber_only';
    postWriteVerification: true;
  };
  receiptSha256: string;
};

const familyOrder = new Map(CONTEXTUAL_SOURCE_FAMILIES.map((family, index) => [family, index]));
const sortFamilies = <T extends { sourceFamily: ContextualSourceFamily }>(values: readonly T[]) => (
  [...values].sort((left, right) => (familyOrder.get(left.sourceFamily) ?? 99)
    - (familyOrder.get(right.sourceFamily) ?? 99))
);

const decodeCensus = (value: unknown): ContextualSourceReadinessCensus => {
  const body = plain(value) ? value : fail('contextual_archive_operator_census_invalid');
  exact(body, [
    'recordType', 'schemaVersion', 'purpose', 'authorizationCeiling', 'targetBinding',
    'targetArtifacts', 'governance', 'sources', 'accounting', 'guarantees', 'censusDigest',
  ], 'contextual_archive_operator_census_invalid');
  if (body.recordType !== 'contextual_source_readiness_census'
    || body.schemaVersion !== CONTEXTUAL_SOURCE_CENSUS_VERSION
    || body.purpose !== 'readiness_census_only'
    || body.authorizationCeiling !== 'no_materialization_no_evidence_credit'
    || !plain(body.governance)
    || body.governance.thresholdPolicyDigest !== CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST
    || !Array.isArray(body.sources)
    || body.sources.length !== CONTEXTUAL_SOURCE_FAMILIES.length) {
    fail('contextual_archive_operator_census_invalid');
  }
  const claimedDigest = digest(body.censusDigest, 'contextual_archive_operator_census_invalid');
  const { censusDigest: _censusDigest, ...withoutDigest } = body;
  if (contextualSourceCensusSha256(withoutDigest) !== claimedDigest) {
    fail('contextual_archive_operator_census_digest_mismatch');
  }
  const target = plain(body.targetBinding)
    ? body.targetBinding : fail('contextual_archive_operator_census_target_invalid');
  exact(target, [
    'universe', 'relationshipInputSnapshotDigest', 'relationshipInputRecordSetSha256',
    'relationshipInputRecordCount', 'subjectCohortPolicyVersion', 'subjectCohortPolicyDigest',
    'subjectAddressSetSha256', 'subjectCount', 'requiredCoverageWindow',
  ], 'contextual_archive_operator_census_target_invalid');
  const universe = validateRelationshipInputBinding(target.universe);
  const relationshipRecordCount = countValue(
    target.relationshipInputRecordCount,
    'contextual_archive_operator_census_target_invalid',
    1,
  );
  const subjectCount = countValue(target.subjectCount, 'contextual_archive_operator_census_target_invalid', 1);
  const coverageWindow = plain(target.requiredCoverageWindow)
    ? target.requiredCoverageWindow : fail('contextual_archive_operator_census_target_invalid');
  exact(coverageWindow, ['start', 'end'], 'contextual_archive_operator_census_target_invalid');
  const windowStart = timestamp(coverageWindow.start, 'contextual_archive_operator_census_target_invalid');
  const windowEnd = timestamp(coverageWindow.end, 'contextual_archive_operator_census_target_invalid');
  if (relationshipRecordCount !== universe.universeRecordCount || subjectCount > relationshipRecordCount
    || target.subjectCohortPolicyVersion !== CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION
    || target.subjectCohortPolicyDigest !== CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST
    || windowStart > windowEnd) fail('contextual_archive_operator_census_target_invalid');
  [target.relationshipInputSnapshotDigest, target.relationshipInputRecordSetSha256,
    target.subjectAddressSetSha256].forEach((item) => (
    digest(item, 'contextual_archive_operator_census_target_invalid')
  ));

  const targetArtifacts = plain(body.targetArtifacts)
    ? body.targetArtifacts : fail('contextual_archive_operator_census_target_artifacts_invalid');
  exact(targetArtifacts, [
    'universeCompletionCanonicalSha256', 'relationshipCompletionCanonicalSha256',
    'relationshipManifestCanonicalSha256', 'relationshipRecordsCanonicalSha256',
    'relationshipRarityCanonicalSha256', 'relationshipLineageCanonicalSha256',
  ], 'contextual_archive_operator_census_target_artifacts_invalid');
  Object.values(targetArtifacts).forEach((item) => (
    digest(item, 'contextual_archive_operator_census_target_artifacts_invalid')
  ));
  const governance = body.governance as Record<string, unknown>;
  exact(governance, [
    'governanceDigest', 'canonicalFileSha256', 'thresholdPolicyDigest',
  ], 'contextual_archive_operator_census_governance_invalid');
  digest(governance.governanceDigest, 'contextual_archive_operator_census_governance_invalid');
  digest(governance.canonicalFileSha256, 'contextual_archive_operator_census_governance_invalid');
  if (governance.thresholdPolicyDigest !== CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST) {
    fail('contextual_archive_operator_census_governance_invalid');
  }

  const kindByFamily = {
    aircraft_adsb_history: 'aircraft', satellite_tle_sgp4_history: 'satellite',
    astronomy_ephemeris_history: 'astronomy', weather_observation_history: 'weather',
  } as const;
  const requirements = contextualSourceThresholdRequirements(subjectCount);
  const sourceInputs = body.sources as unknown[];
  const sources = sourceInputs.map((value) => {
    const source = plain(value) ? value : fail('contextual_archive_operator_census_source_invalid');
    exact(source, [
      'sourceFamily', 'kind', 'planDigest', 'canonicalFileSha256', 'snapshotId',
      'contentSha256', 'manifestSha256', 'coverageStart', 'coverageEnd',
      'observedRecordCount', 'coveredSubjectCount', 'missingSubjectCount',
      'coveredSubjectAddressSetSha256', 'missingSubjectAddressSetSha256', 'status',
    ], 'contextual_archive_operator_census_source_invalid');
    if (!CONTEXTUAL_SOURCE_FAMILIES.includes(source.sourceFamily as ContextualSourceFamily)) {
      fail('contextual_archive_operator_census_source_invalid');
    }
    const sourceFamily = source.sourceFamily as ContextualSourceFamily;
    const observedRecordCount = countValue(source.observedRecordCount, 'contextual_archive_operator_census_source_invalid');
    const coveredSubjectCount = countValue(source.coveredSubjectCount, 'contextual_archive_operator_census_source_invalid');
    const missingSubjectCount = countValue(source.missingSubjectCount, 'contextual_archive_operator_census_source_invalid');
    const requirement = requirements[sourceFamily];
    if (source.kind !== kindByFamily[sourceFamily]
      || source.status !== 'declared_ready_for_materialization_review'
      || coveredSubjectCount + missingSubjectCount !== subjectCount
      || observedRecordCount < requirement.minimumObservedRecordCount
      || coveredSubjectCount < requirement.minimumCoveredSubjectCount
      || missingSubjectCount > requirement.maximumMissingSubjectCount
      || timestamp(source.coverageStart, 'contextual_archive_operator_census_source_invalid') > windowStart
      || timestamp(source.coverageEnd, 'contextual_archive_operator_census_source_invalid') < windowEnd) {
      fail('contextual_archive_operator_census_source_invalid');
    }
    [source.planDigest, source.canonicalFileSha256, source.contentSha256,
      source.manifestSha256, source.coveredSubjectAddressSetSha256,
      source.missingSubjectAddressSetSha256].forEach((item) => (
      digest(item, 'contextual_archive_operator_census_source_invalid')
    ));
    identity(source.snapshotId, 'contextual_archive_operator_census_source_invalid');
    return source as unknown as ContextualSourceReadinessCensus['sources'][number];
  });
  const sortedSources = sortFamilies(sources);
  if (!same(sortedSources.map(({ sourceFamily }) => sourceFamily), CONTEXTUAL_SOURCE_FAMILIES)
    || ['snapshotId', 'contentSha256', 'manifestSha256'].some((key) => (
      new Set(sortedSources.map((source) => source[key as keyof typeof source])).size !== 4
    ))) fail('contextual_archive_operator_family_set_invalid');

  const accounting = plain(body.accounting)
    ? body.accounting : fail('contextual_archive_operator_census_accounting_invalid');
  exact(accounting, [
    'requiredFamilyCount', 'acceptedFamilyCount', 'declaredObservedRecordCount',
    'derivedCoveredSubjectCount', 'derivedMissingSubjectCount',
  ], 'contextual_archive_operator_census_accounting_invalid');
  const safeSum = (key: 'observedRecordCount' | 'coveredSubjectCount' | 'missingSubjectCount') => (
    sortedSources.reduce((total, source) => {
      const next = total + source[key];
      return Number.isSafeInteger(next) ? next : fail('contextual_archive_operator_census_accounting_invalid');
    }, 0)
  );
  if (accounting.requiredFamilyCount !== 4 || accounting.acceptedFamilyCount !== 4
    || accounting.declaredObservedRecordCount !== safeSum('observedRecordCount')
    || accounting.derivedCoveredSubjectCount !== safeSum('coveredSubjectCount')
    || accounting.derivedMissingSubjectCount !== safeSum('missingSubjectCount')) {
    fail('contextual_archive_operator_census_accounting_invalid');
  }
  const guarantees = plain(body.guarantees)
    ? body.guarantees : fail('contextual_archive_operator_census_guarantees_invalid');
  const expectedGuarantees: ContextualSourceReadinessCensus['guarantees'] = {
    evidenceCredit: 0, sourceClosure: false, materializationsCreated: 0,
    providerCalls: 0, providerBytesDownloaded: 0, databaseReads: 0, databaseWrites: 0,
    storageReads: 0, storageWrites: 0, lunaCalls: 0, contextualEdgesCreated: 0,
    publicationMutations: 0, deployments: 0,
  };
  exact(guarantees, Object.keys(expectedGuarantees), 'contextual_archive_operator_census_guarantees_invalid');
  if (!same(guarantees, expectedGuarantees)) fail('contextual_archive_operator_census_guarantees_invalid');
  return body as unknown as ContextualSourceReadinessCensus;
};

/** Standalone strict decoder for consumers of a signed archive-operator census. */
export const verifyContextualArchiveOperatorCensus = decodeCensus;

const normalizeFamilyBinding = (value: ContextualArchiveOperatorFamilyBinding) => ({
  sourceFamily: CONTEXTUAL_SOURCE_FAMILIES.includes(value.sourceFamily)
    ? value.sourceFamily : fail('contextual_archive_operator_family_invalid'),
  planDigest: digest(value.planDigest, 'contextual_archive_operator_plan_digest_invalid'),
  planCanonicalSha256: digest(value.planCanonicalSha256, 'contextual_archive_operator_plan_file_digest_invalid'),
  governancePacketDigest: digest(value.governancePacketDigest, 'contextual_archive_operator_governance_digest_invalid'),
  governancePacketCanonicalSha256: digest(value.governancePacketCanonicalSha256, 'contextual_archive_operator_governance_file_digest_invalid'),
  canonicalSource: text(value.canonicalSource, 160, 'contextual_archive_operator_canonical_source_invalid').toUpperCase(),
  sourceSnapshotDigest: digest(value.sourceSnapshotDigest, 'contextual_archive_operator_snapshot_digest_invalid'),
  localSourceManifestCanonicalSha256: digest(value.localSourceManifestCanonicalSha256, 'contextual_archive_operator_source_manifest_digest_invalid'),
  sourcePageCount: Number.isSafeInteger(value.sourcePageCount) && value.sourcePageCount > 0
    ? value.sourcePageCount : fail('contextual_archive_operator_source_page_count_invalid'),
  sourcePageSetSha256: digest(value.sourcePageSetSha256, 'contextual_archive_operator_source_page_set_digest_invalid'),
  sourceContentSha256: digest(value.sourceContentSha256, 'contextual_archive_operator_source_content_digest_invalid'),
  observedRecordCount: countValue(value.observedRecordCount, 'contextual_archive_operator_observed_record_count_invalid', 1),
  coveredSubjectCount: countValue(value.coveredSubjectCount, 'contextual_archive_operator_covered_subject_count_invalid', 1),
  missingSubjectCount: countValue(value.missingSubjectCount, 'contextual_archive_operator_missing_subject_count_invalid'),
  coveredSubjectAddressSetSha256: digest(value.coveredSubjectAddressSetSha256, 'contextual_archive_operator_covered_subject_set_invalid'),
  missingSubjectAddressSetSha256: digest(value.missingSubjectAddressSetSha256, 'contextual_archive_operator_missing_subject_set_invalid'),
  coveredSubjectLedgerCanonicalSha256: digest(value.coveredSubjectLedgerCanonicalSha256, 'contextual_archive_operator_covered_ledger_invalid'),
  missingSubjectLedgerCanonicalSha256: digest(value.missingSubjectLedgerCanonicalSha256, 'contextual_archive_operator_missing_ledger_invalid'),
  sourceRowDigestSetSha256: digest(value.sourceRowDigestSetSha256, 'contextual_archive_operator_source_row_set_invalid'),
});

const normalizeFamilies = (values: readonly ContextualArchiveOperatorFamilyBinding[]) => {
  if (values.length !== CONTEXTUAL_SOURCE_FAMILIES.length) fail('contextual_archive_operator_family_set_invalid');
  const normalized = sortFamilies(values.map(normalizeFamilyBinding));
  if (!same(normalized.map(({ sourceFamily }) => sourceFamily), CONTEXTUAL_SOURCE_FAMILIES)) {
    fail('contextual_archive_operator_family_set_invalid');
  }
  return normalized;
};

export const buildContextualArchiveOperatorApprovalPayload = (input: {
  approvalId: string;
  approvedBy: string;
  approverKeyId: string;
  trustedRegistryDigest: string;
  approvedAt: string;
  expiresAt: string;
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyBinding[];
  authorizationStatement: string;
  conditionalR2WritesApproved: boolean;
  providerCallsApproved: boolean;
  databaseWritesApproved: boolean;
  lunaCallsApproved: boolean;
  legacyScoreDerivationApproved: boolean;
  evidenceCreditApproved: boolean;
  publicationMutationApproved: boolean;
  deploymentApproved: boolean;
}): ContextualArchiveOperatorApprovalPayload => {
  const census = decodeCensus(input.census);
  const approvalId = text(input.approvalId, 36, 'contextual_archive_operator_approval_id_invalid').toLowerCase();
  if (!UUID.test(approvalId)) fail('contextual_archive_operator_approval_id_invalid');
  const approvedBy = identity(input.approvedBy, 'contextual_archive_operator_approver_identity_invalid');
  const approverKeyId = identity(input.approverKeyId, 'contextual_archive_operator_approver_key_id_invalid');
  const approvedAt = timestamp(input.approvedAt, 'contextual_archive_operator_approval_time_invalid');
  const expiresAt = timestamp(input.expiresAt, 'contextual_archive_operator_approval_expiry_invalid');
  const lifetime = Date.parse(expiresAt) - Date.parse(approvedAt);
  if (lifetime <= 0 || lifetime > CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_MAX_AGE_MS) {
    fail('contextual_archive_operator_approval_expiry_invalid');
  }
  if (input.authorizationStatement !== contextualArchiveOperatorAuthorizationStatement
    || input.conditionalR2WritesApproved !== true
    || input.providerCallsApproved !== false
    || input.databaseWritesApproved !== false
    || input.lunaCallsApproved !== false
    || input.legacyScoreDerivationApproved !== false
    || input.evidenceCreditApproved !== false
    || input.publicationMutationApproved !== false
    || input.deploymentApproved !== false) {
    fail('contextual_archive_operator_approval_scope_invalid');
  }
  const families = normalizeFamilies(input.families);
  return {
    recordType: 'contextual_archive_operator_approval_payload',
    schemaVersion: CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_VERSION,
    approvalId,
    approvedBy,
    approverKeyId,
    trustedRegistryDigest: digest(
      input.trustedRegistryDigest,
      'contextual_archive_operator_registry_digest_invalid',
    ),
    approvedAt,
    expiresAt,
    stage: CONTEXTUAL_ARCHIVE_OPERATOR_STAGE,
    censusDigest: census.censusDigest,
    censusCanonicalSha256: digest(input.censusCanonicalSha256, 'contextual_archive_operator_census_file_digest_invalid'),
    targetBindingDigest: relationshipInputSha256(census.targetBinding),
    thresholdPolicyDigest: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST,
    families,
    authorizationStatement: contextualArchiveOperatorAuthorizationStatement,
    conditionalR2WritesApproved: true,
    providerCallsApproved: false,
    databaseWritesApproved: false,
    lunaCallsApproved: false,
    legacyScoreDerivationApproved: false,
    evidenceCreditApproved: false,
    publicationMutationApproved: false,
    deploymentApproved: false,
  };
};

export const verifyContextualArchiveTrustedApproverKeyring = (
  value: unknown,
): ContextualArchiveTrustedApproverKeyring => {
  const body = plain(value) ? value : fail('contextual_archive_operator_keyring_invalid');
  exact(body, ['recordType', 'schemaVersion', 'keys', 'keyringDigest'], 'contextual_archive_operator_keyring_invalid');
  if (body.recordType !== 'contextual_archive_trusted_principal_registry'
    || body.schemaVersion !== CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION
    || !Array.isArray(body.keys)) fail('contextual_archive_operator_keyring_invalid');
  const keyInputs = body.keys as unknown[];
  const keys: ContextualArchiveTrustedApproverKeyring['keys'] = keyInputs.map((value) => {
    const key = plain(value) ? value : fail('contextual_archive_operator_keyring_invalid');
    exact(key, [
      'keyId', 'approverIdentity', 'role', 'algorithm', 'publicKeySpkiPem',
      'validFrom', 'validUntil', 'status',
    ], 'contextual_archive_operator_keyring_invalid');
    const publicKeySpkiPem = publicKeyPem(
      key.publicKeySpkiPem,
      'contextual_archive_operator_keyring_public_key_invalid',
    );
    const publicKey = (() => {
      try { return createPublicKey(publicKeySpkiPem); }
      catch { return fail('contextual_archive_operator_keyring_public_key_invalid'); }
    })();
    if (publicKey.asymmetricKeyType !== 'ed25519') fail('contextual_archive_operator_keyring_public_key_invalid');
    const validFrom = timestamp(key.validFrom, 'contextual_archive_operator_keyring_time_invalid');
    const validUntil = timestamp(key.validUntil, 'contextual_archive_operator_keyring_time_invalid');
    if (validFrom >= validUntil || !['approver', 'operator'].includes(key.role as string)
      || key.algorithm !== 'ed25519' || key.status !== 'trusted') {
      fail('contextual_archive_operator_keyring_invalid');
    }
    return {
      keyId: identity(key.keyId, 'contextual_archive_operator_keyring_key_id_invalid'),
      approverIdentity: identity(key.approverIdentity, 'contextual_archive_operator_keyring_identity_invalid'),
      role: key.role as 'approver' | 'operator',
      algorithm: 'ed25519' as const,
      publicKeySpkiPem,
      validFrom,
      validUntil,
      status: 'trusted' as const,
    };
  }).sort((left, right) => left.keyId.localeCompare(right.keyId));
  if (new Set(keys.map(({ keyId }) => keyId)).size !== keys.length) {
    fail('contextual_archive_operator_keyring_duplicate_key');
  }
  const publicKeyFingerprints = keys.map(({ publicKeySpkiPem }) => createHash('sha256').update(
    createPublicKey(publicKeySpkiPem).export({ type: 'spki', format: 'der' }),
  ).digest('hex'));
  if (new Set(publicKeyFingerprints).size !== publicKeyFingerprints.length) {
    fail('contextual_archive_operator_keyring_duplicate_public_key');
  }
  const withoutDigest = {
    recordType: 'contextual_archive_trusted_principal_registry' as const,
    schemaVersion: CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION,
    keys,
  };
  if (digest(body.keyringDigest, 'contextual_archive_operator_keyring_digest_invalid')
    !== relationshipInputSha256(withoutDigest)) fail('contextual_archive_operator_keyring_digest_mismatch');
  return { ...withoutDigest, keyringDigest: relationshipInputSha256(withoutDigest) };
};

const productionRegistryBody = Object.freeze({
  recordType: 'contextual_archive_trusted_principal_registry' as const,
  schemaVersion: CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION,
  // Deliberately fail-closed until real public keys are reviewed and checked in.
  keys: Object.freeze([]),
});
export const CONTEXTUAL_ARCHIVE_PRODUCTION_TRUST_REGISTRY: ContextualArchiveTrustedApproverKeyring = Object.freeze({
  ...productionRegistryBody,
  keyringDigest: relationshipInputSha256(productionRegistryBody),
});

const normalizeApprovalPayload = (body: Record<string, unknown>): ContextualArchiveOperatorApprovalPayload => {
  if (body.recordType !== 'contextual_archive_operator_approval_payload'
    || body.schemaVersion !== CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_VERSION
    || body.stage !== CONTEXTUAL_ARCHIVE_OPERATOR_STAGE
    || !Array.isArray(body.families)) fail('contextual_archive_operator_approval_invalid');
  const approvedAt = timestamp(body.approvedAt, 'contextual_archive_operator_approval_time_invalid');
  const expiresAt = timestamp(body.expiresAt, 'contextual_archive_operator_approval_expiry_invalid');
  const lifetime = Date.parse(expiresAt) - Date.parse(approvedAt);
  if (lifetime <= 0 || lifetime > CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_MAX_AGE_MS) {
    fail('contextual_archive_operator_approval_expiry_invalid');
  }
  const approvalId = text(body.approvalId, 36, 'contextual_archive_operator_approval_id_invalid').toLowerCase();
  if (!UUID.test(approvalId)) fail('contextual_archive_operator_approval_id_invalid');
  if (body.authorizationStatement !== contextualArchiveOperatorAuthorizationStatement
    || body.conditionalR2WritesApproved !== true
    || body.providerCallsApproved !== false
    || body.databaseWritesApproved !== false
    || body.lunaCallsApproved !== false
    || body.legacyScoreDerivationApproved !== false
    || body.evidenceCreditApproved !== false
    || body.publicationMutationApproved !== false
    || body.deploymentApproved !== false) fail('contextual_archive_operator_approval_scope_invalid');
  return {
    recordType: 'contextual_archive_operator_approval_payload',
    schemaVersion: CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_VERSION,
    approvalId,
    approvedBy: identity(body.approvedBy, 'contextual_archive_operator_approver_identity_invalid'),
    approverKeyId: identity(body.approverKeyId, 'contextual_archive_operator_approver_key_id_invalid'),
    trustedRegistryDigest: digest(body.trustedRegistryDigest, 'contextual_archive_operator_registry_digest_invalid'),
    approvedAt,
    expiresAt,
    stage: CONTEXTUAL_ARCHIVE_OPERATOR_STAGE,
    censusDigest: digest(body.censusDigest, 'contextual_archive_operator_census_digest_invalid'),
    censusCanonicalSha256: digest(body.censusCanonicalSha256, 'contextual_archive_operator_census_file_digest_invalid'),
    targetBindingDigest: digest(body.targetBindingDigest, 'contextual_archive_operator_target_binding_digest_invalid'),
    thresholdPolicyDigest: digest(body.thresholdPolicyDigest, 'contextual_archive_operator_threshold_policy_digest_invalid'),
    families: normalizeFamilies(body.families as ContextualArchiveOperatorFamilyBinding[]),
    authorizationStatement: contextualArchiveOperatorAuthorizationStatement,
    conditionalR2WritesApproved: true,
    providerCallsApproved: false,
    databaseWritesApproved: false,
    lunaCallsApproved: false,
    legacyScoreDerivationApproved: false,
    evidenceCreditApproved: false,
    publicationMutationApproved: false,
    deploymentApproved: false,
  };
};

export const verifyContextualArchiveOperatorApproval = (params: {
  value: unknown;
  keyring: unknown;
  now: Date;
}): ContextualArchiveOperatorApproval => {
  const { value } = params;
  const body = plain(value) ? value : fail('contextual_archive_operator_approval_invalid');
  const keys = [
    'recordType', 'schemaVersion', 'approvalId', 'approvedBy', 'approverKeyId',
    'trustedRegistryDigest',
    'approvedAt', 'expiresAt', 'stage',
    'censusDigest', 'censusCanonicalSha256', 'targetBindingDigest', 'thresholdPolicyDigest',
    'families', 'authorizationStatement', 'conditionalR2WritesApproved',
    'providerCallsApproved', 'databaseWritesApproved', 'lunaCallsApproved',
    'legacyScoreDerivationApproved', 'evidenceCreditApproved', 'publicationMutationApproved',
    'deploymentApproved', 'signatureAlgorithm', 'signatureBase64', 'approvalSha256',
  ];
  exact(body, keys, 'contextual_archive_operator_approval_invalid');
  const payload = normalizeApprovalPayload(body);
  if (body.signatureAlgorithm !== 'ed25519') fail('contextual_archive_operator_approval_signature_invalid');
  const signatureBase64 = text(body.signatureBase64, 256, 'contextual_archive_operator_approval_signature_invalid');
  if (!BASE64.test(signatureBase64)) fail('contextual_archive_operator_approval_signature_invalid');
  const signedWithoutDigest = { ...payload, signatureAlgorithm: 'ed25519' as const, signatureBase64 };
  if (digest(body.approvalSha256, 'contextual_archive_operator_approval_digest_invalid')
    !== relationshipInputSha256(signedWithoutDigest)) fail('contextual_archive_operator_approval_mismatch');
  const keyring = verifyContextualArchiveTrustedApproverKeyring(params.keyring);
  if (payload.trustedRegistryDigest !== keyring.keyringDigest) {
    fail('contextual_archive_operator_registry_digest_mismatch');
  }
  const trusted = keyring.keys.find(({ keyId }) => keyId === payload.approverKeyId)
    || fail('contextual_archive_operator_approval_key_untrusted');
  if (trusted.role !== 'approver' || trusted.approverIdentity !== payload.approvedBy
    || payload.approvedAt < trusted.validFrom || payload.expiresAt > trusted.validUntil) {
    fail('contextual_archive_operator_approval_key_scope_invalid');
  }
  if (!Number.isFinite(params.now.getTime())
    || params.now.toISOString() < payload.approvedAt || params.now.toISOString() > payload.expiresAt) {
    fail('contextual_archive_operator_approval_stale');
  }
  const signature = Buffer.from(signatureBase64, 'base64');
  if (!verifySignature(
    null,
    Buffer.from(canonicalizeRelationshipInput(payload), 'utf8'),
    createPublicKey(trusted.publicKeySpkiPem),
    signature,
  )) fail('contextual_archive_operator_approval_signature_invalid');
  return { ...signedWithoutDigest, approvalSha256: body.approvalSha256 as string };
};

export const buildContextualArchiveExecutionAuthorizationPayload = (input: {
  authorizationId: string;
  nonce: string;
  operatorId: string;
  operatorKeyId: string;
  trustedRegistryDigest: string;
  authorizedAt: string;
  expiresAt: string;
  approval: ContextualArchiveOperatorApproval;
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyBinding[];
}): ContextualArchiveExecutionAuthorizationPayload => {
  const census = decodeCensus(input.census);
  const authorizationId = text(input.authorizationId, 36, 'contextual_archive_execution_authorization_id_invalid').toLowerCase();
  if (!UUID.test(authorizationId)) fail('contextual_archive_execution_authorization_id_invalid');
  const authorizedAt = timestamp(input.authorizedAt, 'contextual_archive_execution_authorization_time_invalid');
  const expiresAt = timestamp(input.expiresAt, 'contextual_archive_execution_authorization_expiry_invalid');
  const lifetime = Date.parse(expiresAt) - Date.parse(authorizedAt);
  if (lifetime <= 0 || lifetime > CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_MAX_AGE_MS) {
    fail('contextual_archive_execution_authorization_expiry_invalid');
  }
  return {
    recordType: 'contextual_archive_execution_authorization_payload',
    schemaVersion: CONTEXTUAL_ARCHIVE_EXECUTION_AUTHORIZATION_VERSION,
    authorizationId,
    nonce: identity(input.nonce, 'contextual_archive_execution_authorization_nonce_invalid'),
    operatorId: identity(input.operatorId, 'contextual_archive_operator_identity_invalid'),
    operatorKeyId: identity(input.operatorKeyId, 'contextual_archive_operator_key_id_invalid'),
    trustedRegistryDigest: digest(input.trustedRegistryDigest, 'contextual_archive_operator_registry_digest_invalid'),
    authorizedAt,
    expiresAt,
    stage: CONTEXTUAL_ARCHIVE_OPERATOR_STAGE,
    approvalSha256: digest(input.approval.approvalSha256, 'contextual_archive_operator_approval_digest_invalid'),
    censusDigest: census.censusDigest,
    censusCanonicalSha256: digest(input.censusCanonicalSha256, 'contextual_archive_operator_census_file_digest_invalid'),
    targetBindingDigest: relationshipInputSha256(census.targetBinding),
    thresholdPolicyDigest: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST,
    families: normalizeFamilies(input.families),
  };
};

const normalizeExecutionAuthorizationPayload = (
  body: Record<string, unknown>,
): ContextualArchiveExecutionAuthorizationPayload => {
  if (body.recordType !== 'contextual_archive_execution_authorization_payload'
    || body.schemaVersion !== CONTEXTUAL_ARCHIVE_EXECUTION_AUTHORIZATION_VERSION
    || body.stage !== CONTEXTUAL_ARCHIVE_OPERATOR_STAGE || !Array.isArray(body.families)) {
    fail('contextual_archive_execution_authorization_invalid');
  }
  const authorizedAt = timestamp(body.authorizedAt, 'contextual_archive_execution_authorization_time_invalid');
  const expiresAt = timestamp(body.expiresAt, 'contextual_archive_execution_authorization_expiry_invalid');
  const lifetime = Date.parse(expiresAt) - Date.parse(authorizedAt);
  const authorizationId = text(body.authorizationId, 36, 'contextual_archive_execution_authorization_id_invalid').toLowerCase();
  if (!UUID.test(authorizationId) || lifetime <= 0
    || lifetime > CONTEXTUAL_ARCHIVE_OPERATOR_APPROVAL_MAX_AGE_MS) {
    fail('contextual_archive_execution_authorization_expiry_invalid');
  }
  return {
    recordType: 'contextual_archive_execution_authorization_payload',
    schemaVersion: CONTEXTUAL_ARCHIVE_EXECUTION_AUTHORIZATION_VERSION,
    authorizationId,
    nonce: identity(body.nonce, 'contextual_archive_execution_authorization_nonce_invalid'),
    operatorId: identity(body.operatorId, 'contextual_archive_operator_identity_invalid'),
    operatorKeyId: identity(body.operatorKeyId, 'contextual_archive_operator_key_id_invalid'),
    trustedRegistryDigest: digest(body.trustedRegistryDigest, 'contextual_archive_operator_registry_digest_invalid'),
    authorizedAt,
    expiresAt,
    stage: CONTEXTUAL_ARCHIVE_OPERATOR_STAGE,
    approvalSha256: digest(body.approvalSha256, 'contextual_archive_operator_approval_digest_invalid'),
    censusDigest: digest(body.censusDigest, 'contextual_archive_operator_census_digest_invalid'),
    censusCanonicalSha256: digest(body.censusCanonicalSha256, 'contextual_archive_operator_census_file_digest_invalid'),
    targetBindingDigest: digest(body.targetBindingDigest, 'contextual_archive_operator_target_binding_digest_invalid'),
    thresholdPolicyDigest: digest(body.thresholdPolicyDigest, 'contextual_archive_operator_threshold_policy_digest_invalid'),
    families: normalizeFamilies(body.families as ContextualArchiveOperatorFamilyBinding[]),
  };
};

export const verifyContextualArchiveExecutionAuthorization = (params: {
  value: unknown;
  keyring: unknown;
  now: Date;
}): ContextualArchiveExecutionAuthorization => {
  const body = plain(params.value) ? params.value : fail('contextual_archive_execution_authorization_invalid');
  exact(body, [
    'recordType', 'schemaVersion', 'authorizationId', 'nonce', 'operatorId', 'operatorKeyId',
    'trustedRegistryDigest', 'authorizedAt', 'expiresAt', 'stage', 'approvalSha256',
    'censusDigest', 'censusCanonicalSha256', 'targetBindingDigest', 'thresholdPolicyDigest',
    'families', 'signatureAlgorithm', 'signatureBase64', 'authorizationSha256',
  ], 'contextual_archive_execution_authorization_invalid');
  const payload = normalizeExecutionAuthorizationPayload(body);
  if (body.signatureAlgorithm !== 'ed25519') fail('contextual_archive_execution_authorization_signature_invalid');
  const signatureBase64 = text(body.signatureBase64, 256, 'contextual_archive_execution_authorization_signature_invalid');
  if (!BASE64.test(signatureBase64)) fail('contextual_archive_execution_authorization_signature_invalid');
  const signed = { ...payload, signatureAlgorithm: 'ed25519' as const, signatureBase64 };
  if (digest(body.authorizationSha256, 'contextual_archive_execution_authorization_digest_invalid')
    !== relationshipInputSha256(signed)) fail('contextual_archive_execution_authorization_mismatch');
  const registry = verifyContextualArchiveTrustedApproverKeyring(params.keyring);
  if (payload.trustedRegistryDigest !== registry.keyringDigest) {
    fail('contextual_archive_operator_registry_digest_mismatch');
  }
  const trusted = registry.keys.find(({ keyId }) => keyId === payload.operatorKeyId)
    || fail('contextual_archive_execution_authorization_key_untrusted');
  if (trusted.role !== 'operator' || trusted.approverIdentity !== payload.operatorId
    || payload.authorizedAt < trusted.validFrom || payload.expiresAt > trusted.validUntil) {
    fail('contextual_archive_execution_authorization_key_scope_invalid');
  }
  if (!Number.isFinite(params.now.getTime()) || params.now.toISOString() < payload.authorizedAt
    || params.now.toISOString() > payload.expiresAt) fail('contextual_archive_execution_authorization_stale');
  if (!verifySignature(null, Buffer.from(canonicalizeRelationshipInput(payload), 'utf8'),
    createPublicKey(trusted.publicKeySpkiPem), Buffer.from(signatureBase64, 'base64'))) {
    fail('contextual_archive_execution_authorization_signature_invalid');
  }
  return { ...signed, authorizationSha256: body.authorizationSha256 as string };
};

export const assertFreshContextualArchiveOperatorApproval = (params: {
  approval: unknown;
  keyring: unknown;
  now: Date;
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyBinding[];
}) => {
  const approval = verifyContextualArchiveOperatorApproval({
    value: params.approval,
    keyring: params.keyring,
    now: params.now,
  });
  const expectedPayload = buildContextualArchiveOperatorApprovalPayload({
    approvalId: approval.approvalId,
    approvedBy: approval.approvedBy,
    approverKeyId: approval.approverKeyId,
    trustedRegistryDigest: approval.trustedRegistryDigest,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    census: params.census,
    censusCanonicalSha256: params.censusCanonicalSha256,
    families: params.families,
    authorizationStatement: approval.authorizationStatement,
    conditionalR2WritesApproved: approval.conditionalR2WritesApproved,
    providerCallsApproved: approval.providerCallsApproved,
    databaseWritesApproved: approval.databaseWritesApproved,
    lunaCallsApproved: approval.lunaCallsApproved,
    legacyScoreDerivationApproved: approval.legacyScoreDerivationApproved,
    evidenceCreditApproved: approval.evidenceCreditApproved,
    publicationMutationApproved: approval.publicationMutationApproved,
    deploymentApproved: approval.deploymentApproved,
  });
  const { signatureAlgorithm: _algorithm, signatureBase64: _signature,
    approvalSha256: _digest, ...actualPayload } = approval;
  if (!same(actualPayload, expectedPayload)) fail('contextual_archive_operator_approval_binding_mismatch');
  return approval;
};

const assertFreshContextualArchiveExecutionAuthorization = (params: {
  executionAuthorization: unknown;
  keyring: unknown;
  now: Date;
  approval: ContextualArchiveOperatorApproval;
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyBinding[];
}) => {
  const authorization = verifyContextualArchiveExecutionAuthorization({
    value: params.executionAuthorization, keyring: params.keyring, now: params.now,
  });
  const expected = buildContextualArchiveExecutionAuthorizationPayload({
    authorizationId: authorization.authorizationId,
    nonce: authorization.nonce,
    operatorId: authorization.operatorId,
    operatorKeyId: authorization.operatorKeyId,
    trustedRegistryDigest: authorization.trustedRegistryDigest,
    authorizedAt: authorization.authorizedAt,
    expiresAt: authorization.expiresAt,
    approval: params.approval,
    census: params.census,
    censusCanonicalSha256: params.censusCanonicalSha256,
    families: params.families,
  });
  const { signatureAlgorithm: _algorithm, signatureBase64: _signature,
    authorizationSha256: _digest, ...actual } = authorization;
  if (!same(actual, expected)) fail('contextual_archive_execution_authorization_binding_mismatch');
  if (authorization.operatorKeyId === params.approval.approverKeyId
    || authorization.operatorId.toLowerCase() === params.approval.approvedBy.toLowerCase()) {
    fail('contextual_archive_operator_identity_separation_required');
  }
  return authorization;
};

const assertFamilyInputs = (
  census: ContextualSourceReadinessCensus,
  inputs: readonly ContextualArchiveOperatorFamilyInput[],
) => {
  const normalized = normalizeFamilies(inputs);
  return normalized.map((binding) => {
    const input = inputs.find(({ sourceFamily }) => sourceFamily === binding.sourceFamily)
      || fail('contextual_archive_operator_family_set_invalid');
    const plan = decodeContextualSourceSnapshotPlan(input.plan);
    const censusSource = census.sources.find(({ sourceFamily }) => sourceFamily === binding.sourceFamily)
      || fail('contextual_archive_operator_family_set_invalid');
    const packet = verifyContextualSourceGovernanceDecisionPacket(input.governancePacket);
    const snapshot = decodeGovernedContextualSourceSnapshot(input.snapshot, census.targetBinding.universe);
    const normalizeLedger = (values: unknown[], code: string) => {
      const addresses = values.map((value) => validateRelationshipInputAddress(value));
      if (addresses.some((address, index) => index > 0 && addresses[index - 1] >= address)) fail(code);
      return addresses;
    };
    const covered = normalizeLedger(input.coveredSubjectAddresses, 'contextual_archive_operator_covered_ledger_invalid');
    const missing = input.missingSubjectAddresses.length
      ? normalizeLedger(input.missingSubjectAddresses, 'contextual_archive_operator_missing_ledger_invalid') : [];
    const sourceRowDigests = [...input.sourceRowDigests].map((value) => (
      digest(value, 'contextual_archive_operator_source_row_set_invalid')
    )).sort();
    if (new Set(sourceRowDigests).size !== sourceRowDigests.length
      || sourceRowDigests.length !== binding.observedRecordCount
      || relationshipInputSha256(sourceRowDigests) !== binding.sourceRowDigestSetSha256) {
      fail('contextual_archive_operator_source_row_set_mismatch');
    }
    const combined = [...covered, ...missing].sort();
    if (new Set(combined).size !== covered.length + missing.length
      || combined.length !== census.targetBinding.subjectCount
      || relationshipInputSha256(combined) !== census.targetBinding.subjectAddressSetSha256) {
      fail('contextual_archive_operator_coverage_partition_invalid');
    }
    if (plan.sourceFamily !== binding.sourceFamily
      || plan.planDigest !== binding.planDigest
      || !same(plan.targetBinding, census.targetBinding)
      || censusSource.planDigest !== plan.planDigest
      || censusSource.canonicalFileSha256 !== binding.planCanonicalSha256
      || censusSource.kind !== plan.kind
      || censusSource.snapshotId !== plan.sourceIdentity.snapshotId
      || censusSource.contentSha256 !== binding.sourceContentSha256
      || censusSource.contentSha256 !== plan.sourceIdentity.contentSha256
      || censusSource.manifestSha256 !== plan.sourceIdentity.manifestSha256
      || censusSource.coverageStart !== plan.declaredCoverage.start
      || censusSource.coverageEnd !== plan.declaredCoverage.end
      || censusSource.observedRecordCount !== plan.declaredCoverage.observedRecordCount
      || censusSource.observedRecordCount !== binding.observedRecordCount
      || censusSource.coveredSubjectCount !== binding.coveredSubjectCount
      || censusSource.missingSubjectCount !== binding.missingSubjectCount
      || censusSource.coveredSubjectAddressSetSha256 !== binding.coveredSubjectAddressSetSha256
      || censusSource.missingSubjectAddressSetSha256 !== binding.missingSubjectAddressSetSha256
      || binding.coveredSubjectCount !== covered.length
      || binding.missingSubjectCount !== missing.length
      || binding.coveredSubjectAddressSetSha256 !== relationshipInputSha256(covered)
      || binding.missingSubjectAddressSetSha256 !== relationshipInputSha256(missing)
      || binding.coveredSubjectLedgerCanonicalSha256 !== plan.declaredCoverage.coveredSubjectLedgerSha256
      || binding.missingSubjectLedgerCanonicalSha256 !== plan.declaredCoverage.missingSubjectLedgerSha256
      || snapshot.sourceFamily !== plan.sourceFamily
      || snapshot.kind !== plan.kind
      || snapshot.sourceId !== plan.sourceIdentity.sourceId
      || snapshot.providerId !== plan.sourceIdentity.providerId
      || snapshot.datasetVersion !== plan.sourceIdentity.datasetVersion
      || snapshot.contentSha256 !== plan.sourceIdentity.contentSha256
      || snapshot.snapshotDigest !== binding.sourceSnapshotDigest
      || !same(snapshot.coverageWindow, {
        start: plan.declaredCoverage.start,
        end: plan.declaredCoverage.end,
      })
      || packet.packetDigest !== binding.governancePacketDigest) {
      fail(`contextual_archive_operator_family_binding_mismatch:${binding.sourceFamily}`);
    }
    return { ...input, ...binding, plan, governancePacket: packet, snapshot };
  });
};

export const validateContextualArchiveOperatorInputs = (params: {
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyInput[];
  governanceAt?: Date;
}) => {
  const census = decodeCensus(params.census);
  const censusCanonicalSha256 = digest(
    params.censusCanonicalSha256,
    'contextual_archive_operator_census_file_digest_invalid',
  );
  const families = assertFamilyInputs(census, params.families);
  if (params.governanceAt) {
    if (!Number.isFinite(params.governanceAt.getTime())) fail('contextual_archive_operator_now_invalid');
    for (const family of families) {
      buildContextualObservationArchiveGovernanceReceipt({
        packet: family.governancePacket,
        snapshot: family.snapshot,
        canonicalSource: family.canonicalSource,
        authorizedAt: params.governanceAt.toISOString(),
      });
    }
  }
  return { census, censusCanonicalSha256, families };
};

export const preflightContextualArchiveOperatorExecution = (params: {
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyInput[];
  approval: unknown;
  keyring: unknown;
  executionAuthorization: unknown;
  now: Date;
}) => {
  const validated = validateContextualArchiveOperatorInputs({
    ...params,
    governanceAt: params.now,
  });
  if (!Number.isFinite(params.now.getTime())) fail('contextual_archive_operator_now_invalid');
  const approval = assertFreshContextualArchiveOperatorApproval({
    approval: params.approval,
    keyring: params.keyring,
    now: params.now,
    ...validated,
  });
  const executionAuthorization = assertFreshContextualArchiveExecutionAuthorization({
    executionAuthorization: params.executionAuthorization,
    keyring: params.keyring,
    now: params.now,
    approval,
    ...validated,
  });
  return { ...validated, approval, executionAuthorization, operatorId: executionAuthorization.operatorId };
};

export const runContextualArchiveOperator = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  census: ContextualSourceReadinessCensus;
  censusCanonicalSha256: string;
  families: ContextualArchiveOperatorFamilyInput[];
  approval: unknown;
  keyring: unknown;
  executionAuthorization: unknown;
  now: () => Date;
  operationId?: string;
  pageSize?: number;
  dependencies?: {
    archiveFamily?: typeof archiveGovernedContextualObservations;
    verifyFamily?: typeof readVerifiedContextualObservationArchive;
  };
}): Promise<ContextualArchiveOperatorReceipt> => {
  const now = params.now();
  const {
    census, censusCanonicalSha256, families, approval, executionAuthorization, operatorId,
  } = preflightContextualArchiveOperatorExecution({
    census: params.census,
    censusCanonicalSha256: params.censusCanonicalSha256,
    families: params.families,
    approval: params.approval,
    keyring: params.keyring,
    executionAuthorization: params.executionAuthorization,
    now,
  });
  const results: ContextualArchiveOperatorReceipt['families'] = [];
  const archiveFamily = params.dependencies?.archiveFamily || archiveGovernedContextualObservations;
  const verifyFamily = params.dependencies?.verifyFamily || readVerifiedContextualObservationArchive;
  for (const family of families) {
    try {
      const archived = await archiveFamily({
        storage: params.storage,
        source: family.source,
        expectedBinding: census.targetBinding.universe,
        governance: {
          decisionPacket: family.governancePacket,
          canonicalSource: family.canonicalSource,
        },
        ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
        now: () => params.now().toISOString(),
      });
      if (archived.snapshot.snapshotDigest !== family.snapshot.snapshotDigest) {
        fail('contextual_archive_operator_source_snapshot_changed');
      }
      const verifiedAddresses = new Set<string>();
      const verifiedRecordDigests = new Set<string>();
      const verifiedSourceRowDigests = new Set<string>();
      const verified = await verifyFamily({
        storage: params.storage,
        snapshot: family.snapshot,
        expectedBinding: census.targetBinding.universe,
        governance: {
          decisionPacket: family.governancePacket,
          canonicalSource: family.canonicalSource,
        },
        resolveRelationshipRecord: family.resolveRelationshipRecord,
        onRecord: async (record) => {
          if (verifiedRecordDigests.has(record.recordDigest)) {
            fail('contextual_archive_operator_duplicate_archive_record');
          }
          verifiedRecordDigests.add(record.recordDigest);
          if (verifiedSourceRowDigests.has(record.sourceRowDigest)) {
            fail('contextual_archive_operator_duplicate_source_row');
          }
          verifiedSourceRowDigests.add(record.sourceRowDigest);
          verifiedAddresses.add(record.address);
        },
      });
      if (verified.completion.manifestDigest !== archived.completion.manifestDigest) {
        fail('contextual_archive_operator_verification_receipt_mismatch');
      }
      if (verified.completion.sourcePageCount !== family.sourcePageCount
        || verified.completion.sourcePageSetSha256 !== family.sourcePageSetSha256) {
        fail('contextual_archive_operator_source_page_set_mismatch');
      }
      const verifiedCoveredAddresses = [...verifiedAddresses].sort();
      const verifiedSourceRows = [...verifiedSourceRowDigests].sort();
      if (verified.completion.rowCount !== family.observedRecordCount
        || verified.verifiedRowCount !== family.observedRecordCount
        || verifiedRecordDigests.size !== family.observedRecordCount
        || verifiedSourceRows.length !== family.observedRecordCount
        || relationshipInputSha256(verifiedSourceRows) !== family.sourceRowDigestSetSha256
        || verifiedCoveredAddresses.length !== family.coveredSubjectCount
        || relationshipInputSha256(verifiedCoveredAddresses) !== family.coveredSubjectAddressSetSha256) {
        fail('contextual_archive_operator_archive_accounting_mismatch');
      }
      results.push({
        ...normalizeFamilyBinding(family),
        outcome: archived.status,
        completionManifestDigest: verified.completion.manifestDigest,
        archiveSetSha256: verified.completion.archiveSetSha256,
        verifiedRowCount: verified.verifiedRowCount,
        emittedEdgeCount: verified.completion.emittedEdgeCount,
        insufficientEvidenceCount: verified.completion.insufficientEvidenceCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`contextual_archive_operator_family_failed:${family.sourceFamily}:${message}`);
    }
  }
  if (results.length !== 4) fail('contextual_archive_operator_incomplete');
  const sum = (key: 'verifiedRowCount' | 'emittedEdgeCount' | 'insufficientEvidenceCount') => (
    results.reduce((total, result) => {
      const next = total + result[key];
      return Number.isSafeInteger(next) ? next : fail('contextual_archive_operator_receipt_accounting_overflow');
    }, 0)
  );
  const operationId = (params.operationId || randomUUID()).toLowerCase();
  if (!UUID.test(operationId)) fail('contextual_archive_operator_operation_id_invalid');
  const withoutDigest: Omit<ContextualArchiveOperatorReceipt, 'receiptSha256'> = {
    recordType: 'contextual_archive_operator_receipt',
    schemaVersion: CONTEXTUAL_ARCHIVE_OPERATOR_RECEIPT_VERSION,
    operationId,
    operatorId,
    createdAt: timestamp(params.now().toISOString(), 'contextual_archive_operator_receipt_time_invalid'),
    stage: CONTEXTUAL_ARCHIVE_OPERATOR_STAGE,
    approvalSha256: approval.approvalSha256,
    executionAuthorizationSha256: executionAuthorization.authorizationSha256,
    trustedRegistryDigest: approval.trustedRegistryDigest,
    approverKeyId: approval.approverKeyId,
    operatorKeyId: executionAuthorization.operatorKeyId,
    censusDigest: census.censusDigest,
    censusCanonicalSha256,
    targetBindingDigest: relationshipInputSha256(census.targetBinding),
    thresholdPolicyDigest: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST,
    families: results,
    accounting: {
      requiredFamilyCount: 4,
      completedFamilyCount: 4,
      verifiedRowCount: sum('verifiedRowCount'),
      emittedEdgeCount: sum('emittedEdgeCount'),
      insufficientEvidenceCount: sum('insufficientEvidenceCount'),
    },
    guarantees: {
      providerCalls: 0,
      providerSpend: 0,
      databaseWrites: 0,
      lunaCalls: 0,
      legacyScoreDerivations: 0,
      evidenceCredit: 0,
      publicationMutations: 0,
      deployments: 0,
      storageWriteMode: 'conditional_no_clobber_only',
      postWriteVerification: true,
    },
  };
  return { ...withoutDigest, receiptSha256: relationshipInputSha256(withoutDigest) };
};

export const encodeContextualArchiveOperatorArtifact = (value: unknown) => (
  Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8')
);

export const verifyContextualArchiveOperatorReceipt = (
  value: unknown,
): ContextualArchiveOperatorReceipt => {
  const body = plain(value) ? value : fail('contextual_archive_operator_receipt_invalid');
  exact(body, [
    'recordType', 'schemaVersion', 'operationId', 'operatorId', 'createdAt', 'stage',
    'approvalSha256', 'executionAuthorizationSha256', 'trustedRegistryDigest',
    'approverKeyId', 'operatorKeyId', 'censusDigest', 'censusCanonicalSha256', 'targetBindingDigest',
    'thresholdPolicyDigest', 'families', 'accounting', 'guarantees', 'receiptSha256',
  ], 'contextual_archive_operator_receipt_invalid');
  if (body.recordType !== 'contextual_archive_operator_receipt'
    || body.schemaVersion !== CONTEXTUAL_ARCHIVE_OPERATOR_RECEIPT_VERSION
    || body.stage !== CONTEXTUAL_ARCHIVE_OPERATOR_STAGE
    || !UUID.test(text(body.operationId, 36, 'contextual_archive_operator_receipt_invalid').toLowerCase())
    || !Array.isArray(body.families)
    || !plain(body.accounting)
    || !plain(body.guarantees)) fail('contextual_archive_operator_receipt_invalid');
  const accountingBody = plain(body.accounting)
    ? body.accounting : fail('contextual_archive_operator_receipt_invalid');
  const guaranteesBody = plain(body.guarantees)
    ? body.guarantees : fail('contextual_archive_operator_receipt_invalid');
  exact(accountingBody, [
    'requiredFamilyCount', 'completedFamilyCount', 'verifiedRowCount',
    'emittedEdgeCount', 'insufficientEvidenceCount',
  ], 'contextual_archive_operator_receipt_invalid');
  exact(guaranteesBody, [
    'providerCalls', 'providerSpend', 'databaseWrites', 'lunaCalls',
    'legacyScoreDerivations', 'evidenceCredit', 'publicationMutations', 'deployments',
    'storageWriteMode', 'postWriteVerification',
  ], 'contextual_archive_operator_receipt_invalid');
  const familyInputs = body.families as unknown[];
  if (familyInputs.length !== 4) fail('contextual_archive_operator_receipt_invalid');
  const families = sortFamilies(familyInputs.map((value) => {
    const family = plain(value) ? value : fail('contextual_archive_operator_receipt_invalid');
    exact(family, [
      'sourceFamily', 'planDigest', 'planCanonicalSha256', 'governancePacketDigest',
      'governancePacketCanonicalSha256', 'canonicalSource', 'sourceSnapshotDigest',
      'localSourceManifestCanonicalSha256', 'sourcePageCount', 'sourcePageSetSha256',
      'sourceContentSha256', 'observedRecordCount', 'coveredSubjectCount',
      'missingSubjectCount', 'coveredSubjectAddressSetSha256',
      'missingSubjectAddressSetSha256', 'coveredSubjectLedgerCanonicalSha256',
      'missingSubjectLedgerCanonicalSha256', 'sourceRowDigestSetSha256',
      'outcome', 'completionManifestDigest', 'archiveSetSha256', 'verifiedRowCount',
      'emittedEdgeCount', 'insufficientEvidenceCount',
    ], 'contextual_archive_operator_receipt_invalid');
    const binding = normalizeFamilyBinding(family as unknown as ContextualArchiveOperatorFamilyBinding);
    const outcome = family.outcome;
    if (outcome !== 'completed' && outcome !== 'resumed') {
      fail('contextual_archive_operator_receipt_invalid');
    }
    const verifiedRowCount = countReceipt(family.verifiedRowCount);
    const emittedEdgeCount = countReceipt(family.emittedEdgeCount);
    const insufficientEvidenceCount = countReceipt(family.insufficientEvidenceCount);
    const classifiedRowCount = emittedEdgeCount + insufficientEvidenceCount;
    if (!Number.isSafeInteger(classifiedRowCount)
      || verifiedRowCount !== binding.observedRecordCount
      || classifiedRowCount !== verifiedRowCount) {
      fail('contextual_archive_operator_receipt_invalid');
    }
    return {
      ...binding,
      outcome: outcome as 'completed' | 'resumed',
      completionManifestDigest: digest(family.completionManifestDigest, 'contextual_archive_operator_receipt_invalid'),
      archiveSetSha256: digest(family.archiveSetSha256, 'contextual_archive_operator_receipt_invalid'),
      verifiedRowCount,
      emittedEdgeCount,
      insufficientEvidenceCount,
    };
  }));
  if (!same(families.map(({ sourceFamily }) => sourceFamily), CONTEXTUAL_SOURCE_FAMILIES)) {
    fail('contextual_archive_operator_receipt_invalid');
  }
  const sum = (key: 'verifiedRowCount' | 'emittedEdgeCount' | 'insufficientEvidenceCount') => (
    families.reduce((total, family) => {
      const next = total + family[key];
      return Number.isSafeInteger(next) ? next : fail('contextual_archive_operator_receipt_invalid');
    }, 0)
  );
  const accounting = {
    requiredFamilyCount: 4 as const,
    completedFamilyCount: 4 as const,
    verifiedRowCount: sum('verifiedRowCount'),
    emittedEdgeCount: sum('emittedEdgeCount'),
    insufficientEvidenceCount: sum('insufficientEvidenceCount'),
  };
  const guarantees: ContextualArchiveOperatorReceipt['guarantees'] = {
    providerCalls: 0, providerSpend: 0, databaseWrites: 0, lunaCalls: 0,
    legacyScoreDerivations: 0, evidenceCredit: 0, publicationMutations: 0,
    deployments: 0, storageWriteMode: 'conditional_no_clobber_only',
    postWriteVerification: true,
  };
  if (!same(body.accounting, accounting) || !same(body.guarantees, guarantees)) {
    fail('contextual_archive_operator_receipt_mismatch');
  }
  const withoutDigest: Omit<ContextualArchiveOperatorReceipt, 'receiptSha256'> = {
    recordType: 'contextual_archive_operator_receipt',
    schemaVersion: CONTEXTUAL_ARCHIVE_OPERATOR_RECEIPT_VERSION,
    operationId: text(body.operationId, 36, 'contextual_archive_operator_receipt_invalid').toLowerCase(),
    operatorId: identity(body.operatorId, 'contextual_archive_operator_receipt_invalid'),
    createdAt: timestamp(body.createdAt, 'contextual_archive_operator_receipt_invalid'),
    stage: CONTEXTUAL_ARCHIVE_OPERATOR_STAGE,
    approvalSha256: digest(body.approvalSha256, 'contextual_archive_operator_receipt_invalid'),
    executionAuthorizationSha256: digest(body.executionAuthorizationSha256, 'contextual_archive_operator_receipt_invalid'),
    trustedRegistryDigest: digest(body.trustedRegistryDigest, 'contextual_archive_operator_receipt_invalid'),
    approverKeyId: identity(body.approverKeyId, 'contextual_archive_operator_receipt_invalid'),
    operatorKeyId: identity(body.operatorKeyId, 'contextual_archive_operator_receipt_invalid'),
    censusDigest: digest(body.censusDigest, 'contextual_archive_operator_receipt_invalid'),
    censusCanonicalSha256: digest(body.censusCanonicalSha256, 'contextual_archive_operator_receipt_invalid'),
    targetBindingDigest: digest(body.targetBindingDigest, 'contextual_archive_operator_receipt_invalid'),
    thresholdPolicyDigest: digest(body.thresholdPolicyDigest, 'contextual_archive_operator_receipt_invalid'),
    families,
    accounting,
    guarantees,
  };
  if (withoutDigest.approverKeyId === withoutDigest.operatorKeyId) {
    fail('contextual_archive_operator_receipt_invalid');
  }
  if (digest(body.receiptSha256, 'contextual_archive_operator_receipt_invalid')
    !== relationshipInputSha256(withoutDigest)) fail('contextual_archive_operator_receipt_mismatch');
  return { ...withoutDigest, receiptSha256: body.receiptSha256 as string };
};

function countReceipt(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('contextual_archive_operator_receipt_invalid');
  }
  return value as number;
}
