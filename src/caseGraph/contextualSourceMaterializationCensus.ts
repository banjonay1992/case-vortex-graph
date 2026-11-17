import { createHash } from 'node:crypto';

import type { EvidenceUniverseCompletion } from './evidenceUniverseArchive';
import {
  buildRelationshipInputPart,
  type RelationshipInputSnapshotManifest,
} from './relationshipInputArchive';
import type { RelationshipInputMaterializationCompletion } from './relationshipInputMaterializer';
import {
  buildTypedRelationshipRarityIndex,
  decodeTypedRelationshipRarityIndex,
  type TypedRelationshipRarityIndex,
} from './typedRelationshipEngine';
import {
  buildLineage as buildFullCorpusPipelineLineage,
  decodeFullCorpusPipelineLineage,
} from './typedRelationshipPipelineSupport';
import type { FullCorpusPipelineLineage } from './typedRelationshipPipelineTypes';
import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  isCanonicalPreciseTimestamp,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION = 'case-vortex-contextual-source-snapshot-plan-v2' as const;
export const CONTEXTUAL_SOURCE_CENSUS_GOVERNANCE_VERSION = 'case-vortex-contextual-source-census-governance-v2' as const;
export const CONTEXTUAL_SOURCE_CENSUS_VERSION = 'case-vortex-contextual-source-readiness-census-v2' as const;
export const CONTEXTUAL_SOURCE_THRESHOLD_POLICY_VERSION = 'case-vortex-contextual-source-thresholds-v1' as const;
export const CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION = 'case-vortex-contextual-subject-cohort-v1' as const;

export const CONTEXTUAL_SOURCE_FAMILIES = [
  'aircraft_adsb_history', 'satellite_tle_sgp4_history',
  'astronomy_ephemeris_history', 'weather_observation_history',
] as const;
export type ContextualSourceFamily = typeof CONTEXTUAL_SOURCE_FAMILIES[number];

const KINDS_BY_FAMILY = {
  aircraft_adsb_history: 'aircraft', satellite_tle_sgp4_history: 'satellite',
  astronomy_ephemeris_history: 'astronomy', weather_observation_history: 'weather',
} as const;
const THRESHOLD_POLICY = {
  version: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_VERSION,
  families: {
    aircraft_adsb_history: { minimumCoveragePermillion: 900_000, minimumObservationsPerCoveredSubject: 1 },
    satellite_tle_sgp4_history: { minimumCoveragePermillion: 950_000, minimumObservationsPerCoveredSubject: 1 },
    astronomy_ephemeris_history: { minimumCoveragePermillion: 1_000_000, minimumObservationsPerCoveredSubject: 1 },
    weather_observation_history: { minimumCoveragePermillion: 900_000, minimumObservationsPerCoveredSubject: 1 },
  },
} as const;
const SUBJECT_COHORT_POLICY = {
  version: CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
  population: 'all_authenticated_relationship_records',
  eligibility: 'exactly_one_present_iso_event_timestamp_fact',
  ordering: 'address_bytewise_ascending',
} as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: unknown, keys: readonly string[], code: string) => {
  const record = plain(value) ? value : invalid(code);
  const actual = Object.keys(record).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
  return record;
};
const sha = (value: unknown) => createHash('sha256').update(canonicalizeRelationshipInput(value)).digest('hex');
export const CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST = sha(THRESHOLD_POLICY);
export const CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST = sha(SUBJECT_COHORT_POLICY);
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !isCanonicalPreciseTimestamp(value)) invalid(code);
  return value as string;
};
const count = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(code);
  return value as number;
};
const id = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !ID.test(value)) invalid(code);
  return value as string;
};
const digest = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid(code);
  return value as string;
};
const same = (left: unknown, right: unknown) => canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right);
const setDigest = (addresses: readonly string[]) => relationshipInputSha256(addresses);
const safeSum = (values: readonly number[], code: string) => values.reduce((total, value) => {
  const next = total + value;
  if (!Number.isSafeInteger(next)) invalid(code);
  return next;
}, 0);

export type ContextualTargetRelationshipBinding = {
  universe: RelationshipInputUniverseBinding;
  relationshipInputSnapshotDigest: string;
  relationshipInputRecordSetSha256: string;
  relationshipInputRecordCount: number;
  subjectCohortPolicyVersion: typeof CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION;
  subjectCohortPolicyDigest: string;
  subjectAddressSetSha256: string;
  subjectCount: number;
  requiredCoverageWindow: { start: string; end: string };
};

export type ContextualTargetArtifactReceipts = {
  universeCompletionCanonicalSha256: string;
  relationshipCompletionCanonicalSha256: string;
  relationshipManifestCanonicalSha256: string;
  relationshipRecordsCanonicalSha256: string;
  relationshipRarityCanonicalSha256: string;
  relationshipLineageCanonicalSha256: string;
};

export type ContextualSourceSnapshotPlan = {
  recordType: 'contextual_source_snapshot_plan';
  schemaVersion: typeof CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION;
  sourceFamily: ContextualSourceFamily;
  kind: typeof KINDS_BY_FAMILY[ContextualSourceFamily];
  targetBinding: ContextualTargetRelationshipBinding;
  sourceIdentity: {
    sourceId: string; providerId: string; datasetVersion: string; snapshotId: string;
    contentSha256: string; manifestSha256: string;
  };
  capture: {
    mode: 'immutable_historical_snapshot'; mutable: false; current: false;
    live: false; contentAddressed: true;
  };
  declaredCoverage: {
    start: string; end: string; observedRecordCount: number;
    coveredSubjectLedgerSha256: string; missingSubjectLedgerSha256: string;
  };
  planDigest: string;
};

export type ContextualSourceCensusGovernance = {
  recordType: 'contextual_source_census_governance';
  schemaVersion: typeof CONTEXTUAL_SOURCE_CENSUS_GOVERNANCE_VERSION;
  purpose: 'readiness_census_only';
  authorizationCeiling: 'no_materialization_no_evidence_credit';
  targetBinding: ContextualTargetRelationshipBinding;
  thresholdPolicy: { version: typeof CONTEXTUAL_SOURCE_THRESHOLD_POLICY_VERSION; digest: string };
  requirements: Array<{
    sourceFamily: ContextualSourceFamily; planDigest: string;
    sourceContract: { sourceId: string; providerId: string };
    minimumObservedRecordCount: number; minimumCoveredSubjectCount: number;
    maximumMissingSubjectCount: number;
  }>;
  governanceDigest: string;
};

export type ContextualSourceCoverageLedger = {
  sourceFamily: ContextualSourceFamily;
  coveredAddresses: string[];
  missingAddresses: string[];
  coveredCanonicalSha256: string;
  missingCanonicalSha256: string;
};

export type ContextualSourceReadinessCensus = {
  recordType: 'contextual_source_readiness_census';
  schemaVersion: typeof CONTEXTUAL_SOURCE_CENSUS_VERSION;
  purpose: 'readiness_census_only';
  authorizationCeiling: 'no_materialization_no_evidence_credit';
  targetBinding: ContextualTargetRelationshipBinding;
  targetArtifacts: ContextualTargetArtifactReceipts;
  governance: { governanceDigest: string; canonicalFileSha256: string; thresholdPolicyDigest: string };
  sources: Array<{
    sourceFamily: ContextualSourceFamily; kind: ContextualSourceSnapshotPlan['kind'];
    planDigest: string; canonicalFileSha256: string; snapshotId: string;
    contentSha256: string; manifestSha256: string; coverageStart: string; coverageEnd: string;
    observedRecordCount: number; coveredSubjectCount: number; missingSubjectCount: number;
    coveredSubjectAddressSetSha256: string; missingSubjectAddressSetSha256: string;
    status: 'declared_ready_for_materialization_review';
  }>;
  accounting: {
    requiredFamilyCount: 4; acceptedFamilyCount: 4;
    declaredObservedRecordCount: number; derivedCoveredSubjectCount: number;
    derivedMissingSubjectCount: number;
  };
  guarantees: {
    evidenceCredit: 0; sourceClosure: false; materializationsCreated: 0;
    providerCalls: 0; providerBytesDownloaded: 0; databaseReads: 0; databaseWrites: 0;
    storageReads: 0; storageWrites: 0; lunaCalls: 0; contextualEdgesCreated: 0;
    publicationMutations: 0; deployments: 0;
  };
  censusDigest: string;
};

const decodeBinding = (value: unknown): ContextualTargetRelationshipBinding => {
  const body = exact(value, [
    'universe', 'relationshipInputSnapshotDigest', 'relationshipInputRecordSetSha256',
    'relationshipInputRecordCount', 'subjectCohortPolicyVersion', 'subjectCohortPolicyDigest',
    'subjectAddressSetSha256', 'subjectCount', 'requiredCoverageWindow',
  ], 'contextual_source_census_target_binding_invalid');
  const window = exact(body.requiredCoverageWindow, ['start', 'end'], 'contextual_source_census_target_binding_invalid');
  const start = timestamp(window.start, 'contextual_source_census_target_binding_invalid');
  const end = timestamp(window.end, 'contextual_source_census_target_binding_invalid');
  if (start > end) invalid('contextual_source_census_target_binding_invalid');
  const universe = validateRelationshipInputBinding(body.universe);
  const recordCount = count(body.relationshipInputRecordCount, 'contextual_source_census_target_binding_invalid', 1);
  const subjectCount = count(body.subjectCount, 'contextual_source_census_target_binding_invalid', 1);
  if (recordCount !== universe.universeRecordCount || subjectCount > recordCount) {
    invalid('contextual_source_census_target_binding_count_mismatch');
  }
  return {
    universe,
    relationshipInputSnapshotDigest: digest(body.relationshipInputSnapshotDigest, 'contextual_source_census_target_binding_invalid'),
    relationshipInputRecordSetSha256: digest(body.relationshipInputRecordSetSha256, 'contextual_source_census_target_binding_invalid'),
    relationshipInputRecordCount: recordCount,
    subjectCohortPolicyVersion: body.subjectCohortPolicyVersion === CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION
      ? CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION : invalid('contextual_source_census_subject_cohort_policy_invalid'),
    subjectCohortPolicyDigest: body.subjectCohortPolicyDigest === CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST
      ? CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST : invalid('contextual_source_census_subject_cohort_policy_invalid'),
    subjectAddressSetSha256: digest(body.subjectAddressSetSha256, 'contextual_source_census_target_binding_invalid'),
    subjectCount,
    requiredCoverageWindow: { start, end },
  };
};

const normalizeAddressLedger = (value: unknown, code: string) => {
  if (!Array.isArray(value) || !value.length) invalid(code);
  const addresses = (value as unknown[]).map((address: unknown) => validateRelationshipInputAddress(address));
  if (addresses.some((address, index) => index > 0 && addresses[index - 1] >= address)) invalid(code);
  return addresses;
};

const eligibleEventTimestamp = (record: RelationshipInputRecord): string | null => {
  const facts = record.facts.filter((fact) => fact.family === 'space_time'
    && fact.predicate === 'event_timestamp'
    && fact.missingness.status === 'present'
    && fact.value?.kind === 'timestamp');
  if (facts.length !== 1) return null;
  const value = facts[0]?.value;
  if (!value || value.kind !== 'timestamp') return null;
  return (value as { timestamp: string }).timestamp;
};

const authenticateRelationshipRecordsAgainstManifest = (
  records: readonly RelationshipInputRecord[],
  manifest: RelationshipInputSnapshotManifest,
) => {
  if (records.length !== manifest.rowCount
    || records.some((record, index) => index > 0 && records[index - 1].address >= record.address)) {
    invalid('contextual_source_census_relationship_record_order_invalid');
  }
  let offset = 0;
  for (const official of manifest.parts) {
    const partRecords = records.slice(offset, offset + official.rowCount);
    if (partRecords.length !== official.rowCount) invalid('contextual_source_census_relationship_part_receipt_mismatch');
    const rebuilt = buildRelationshipInputPart({
      binding: manifest.binding,
      partNumber: official.partNumber,
      records: partRecords,
    }).manifest;
    const {
      recordType: _recordType,
      schemaVersion: _schemaVersion,
      canonicalVersion: _canonicalVersion,
      binding: _binding,
      archiveContentType: _archiveContentType,
      archiveContentEncoding: _archiveContentEncoding,
      claimDiscipline: _claimDiscipline,
      ...rebuiltSummary
    } = rebuilt;
    if (!same(rebuiltSummary, official)) invalid('contextual_source_census_relationship_part_receipt_mismatch');
    offset += official.rowCount;
  }
  if (offset !== records.length) invalid('contextual_source_census_relationship_part_receipt_mismatch');
};

export const deriveContextualTargetRelationshipBinding = (params: {
  universeCompletion: EvidenceUniverseCompletion;
  relationshipCompletion: RelationshipInputMaterializationCompletion;
  relationshipManifest: RelationshipInputSnapshotManifest;
  relationshipRecords: readonly RelationshipInputRecord[];
  relationshipRarity: TypedRelationshipRarityIndex;
  relationshipLineage: FullCorpusPipelineLineage;
}): ContextualTargetRelationshipBinding => {
  const universe = params.universeCompletion;
  const relationship = params.relationshipCompletion;
  const manifest = params.relationshipManifest;
  const binding: RelationshipInputUniverseBinding = validateRelationshipInputBinding({
    snapshotId: universe.expected.snapshotId,
    corpusVersion: universe.corpusVersion,
    universeArchiveVersion: universe.archiveVersion,
    universeSchemaVersion: universe.schemaVersion,
    universeLayoutVersion: universe.layoutVersion,
    universeArchiveSetSha256: universe.archiveSetSha256,
    universeRecordCount: universe.expected.total,
  });
  if (!same(relationship.binding, binding) || !same(manifest.binding, binding)
    || relationship.rowCount !== universe.expected.total || manifest.rowCount !== universe.expected.total
    || relationship.sourceReceipts.universeRecordCount !== universe.expected.total
    || relationship.relationshipSnapshotManifestDigest !== manifest.manifestDigest
    || relationship.relationshipSnapshotManifestSha256.length !== 64
    || relationship.relationshipArchiveSetSha256 !== manifest.archiveSetSha256) {
    invalid('contextual_source_census_target_artifact_binding_mismatch');
  }
  const records = params.relationshipRecords.map((record) => decodeRelationshipInputRecord(record, binding));
  authenticateRelationshipRecordsAgainstManifest(records, manifest);
  const rebuiltRarity = buildTypedRelationshipRarityIndex(records, binding);
  const rarity = decodeTypedRelationshipRarityIndex(params.relationshipRarity, binding);
  if (!same(rebuiltRarity, rarity)) invalid('contextual_source_census_relationship_record_set_mismatch');
  const expectedLineage = buildFullCorpusPipelineLineage(manifest, rarity);
  decodeFullCorpusPipelineLineage(params.relationshipLineage, expectedLineage);
  const cohort = records.map((record) => ({ address: record.address, timestamp: eligibleEventTimestamp(record) }))
    .filter((item): item is { address: string; timestamp: string } => item.timestamp !== null);
  if (!cohort.length) invalid('contextual_source_census_subject_cohort_empty');
  const addresses = cohort.map(({ address }) => address);
  const timestamps = cohort.map(({ timestamp: value }) => value).sort(compare);
  return {
    universe: binding,
    relationshipInputSnapshotDigest: manifest.manifestDigest,
    relationshipInputRecordSetSha256: rarity.recordSetSha256,
    relationshipInputRecordCount: manifest.rowCount,
    subjectCohortPolicyVersion: CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
    subjectCohortPolicyDigest: CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
    subjectAddressSetSha256: setDigest(addresses),
    subjectCount: addresses.length,
    requiredCoverageWindow: { start: timestamps[0], end: timestamps[timestamps.length - 1] },
  };
};

export const contextualSourceThresholdRequirements = (subjectCount: number) => Object.fromEntries(
  CONTEXTUAL_SOURCE_FAMILIES.map((family) => {
    const policy = THRESHOLD_POLICY.families[family];
    const minimumCoveredSubjectCount = Math.ceil(subjectCount * policy.minimumCoveragePermillion / 1_000_000);
    return [family, {
      minimumObservedRecordCount: minimumCoveredSubjectCount * policy.minimumObservationsPerCoveredSubject,
      minimumCoveredSubjectCount,
      maximumMissingSubjectCount: subjectCount - minimumCoveredSubjectCount,
    }];
  }),
) as Record<ContextualSourceFamily, {
  minimumObservedRecordCount: number; minimumCoveredSubjectCount: number; maximumMissingSubjectCount: number;
}>;

export const decodeContextualSourceSnapshotPlan = (value: unknown): ContextualSourceSnapshotPlan => {
  const body = exact(value, [
    'recordType', 'schemaVersion', 'sourceFamily', 'kind', 'targetBinding', 'sourceIdentity',
    'capture', 'declaredCoverage', 'planDigest',
  ], 'contextual_source_snapshot_plan_invalid');
  if (body.recordType !== 'contextual_source_snapshot_plan' || body.schemaVersion !== CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION
    || !CONTEXTUAL_SOURCE_FAMILIES.includes(body.sourceFamily as ContextualSourceFamily)) invalid('contextual_source_snapshot_plan_invalid');
  const sourceFamily = body.sourceFamily as ContextualSourceFamily;
  if (body.kind !== KINDS_BY_FAMILY[sourceFamily]) invalid('contextual_source_snapshot_plan_family_kind_mismatch');
  const identity = exact(body.sourceIdentity, ['sourceId', 'providerId', 'datasetVersion', 'snapshotId', 'contentSha256', 'manifestSha256'], 'contextual_source_snapshot_plan_identity_invalid');
  const capture = exact(body.capture, ['mode', 'mutable', 'current', 'live', 'contentAddressed'], 'contextual_source_snapshot_plan_capture_invalid');
  if (capture.mode !== 'immutable_historical_snapshot' || capture.mutable !== false || capture.current !== false
    || capture.live !== false || capture.contentAddressed !== true) invalid('contextual_source_snapshot_plan_not_immutable_historical');
  const coverage = exact(body.declaredCoverage, [
    'start', 'end', 'observedRecordCount', 'coveredSubjectLedgerSha256', 'missingSubjectLedgerSha256',
  ], 'contextual_source_snapshot_plan_coverage_invalid');
  const plan: Omit<ContextualSourceSnapshotPlan, 'planDigest'> = {
    recordType: 'contextual_source_snapshot_plan', schemaVersion: CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION,
    sourceFamily, kind: KINDS_BY_FAMILY[sourceFamily], targetBinding: decodeBinding(body.targetBinding),
    sourceIdentity: {
      sourceId: id(identity.sourceId, 'contextual_source_snapshot_plan_identity_invalid'),
      providerId: id(identity.providerId, 'contextual_source_snapshot_plan_identity_invalid'),
      datasetVersion: id(identity.datasetVersion, 'contextual_source_snapshot_plan_identity_invalid'),
      snapshotId: id(identity.snapshotId, 'contextual_source_snapshot_plan_identity_invalid'),
      contentSha256: digest(identity.contentSha256, 'contextual_source_snapshot_plan_identity_invalid'),
      manifestSha256: digest(identity.manifestSha256, 'contextual_source_snapshot_plan_identity_invalid'),
    },
    capture: { mode: 'immutable_historical_snapshot', mutable: false, current: false, live: false, contentAddressed: true },
    declaredCoverage: {
      start: timestamp(coverage.start, 'contextual_source_snapshot_plan_coverage_invalid'),
      end: timestamp(coverage.end, 'contextual_source_snapshot_plan_coverage_invalid'),
      observedRecordCount: count(coverage.observedRecordCount, 'contextual_source_snapshot_plan_coverage_invalid', 1),
      coveredSubjectLedgerSha256: digest(coverage.coveredSubjectLedgerSha256, 'contextual_source_snapshot_plan_coverage_invalid'),
      missingSubjectLedgerSha256: digest(coverage.missingSubjectLedgerSha256, 'contextual_source_snapshot_plan_coverage_invalid'),
    },
  };
  if (plan.declaredCoverage.start > plan.declaredCoverage.end) invalid('contextual_source_snapshot_plan_coverage_invalid');
  if (body.planDigest !== sha(plan)) invalid('contextual_source_snapshot_plan_digest_mismatch');
  return { ...plan, planDigest: body.planDigest as string };
};

export const decodeContextualSourceCensusGovernance = (value: unknown): ContextualSourceCensusGovernance => {
  const body = exact(value, [
    'recordType', 'schemaVersion', 'purpose', 'authorizationCeiling', 'targetBinding',
    'thresholdPolicy', 'requirements', 'governanceDigest',
  ], 'contextual_source_census_governance_invalid');
  const threshold = exact(body.thresholdPolicy, ['version', 'digest'], 'contextual_source_census_threshold_policy_invalid');
  const rawRequirements = body.requirements;
  if (body.recordType !== 'contextual_source_census_governance' || body.schemaVersion !== CONTEXTUAL_SOURCE_CENSUS_GOVERNANCE_VERSION
    || body.purpose !== 'readiness_census_only' || body.authorizationCeiling !== 'no_materialization_no_evidence_credit'
    || threshold.version !== CONTEXTUAL_SOURCE_THRESHOLD_POLICY_VERSION || threshold.digest !== CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST
    || !Array.isArray(rawRequirements) || rawRequirements.length !== 4) invalid('contextual_source_census_governance_invalid');
  const targetBinding = decodeBinding(body.targetBinding);
  const frozen = contextualSourceThresholdRequirements(targetBinding.subjectCount);
  const requirements = (rawRequirements as unknown[]).map((item) => {
    const requirement = exact(item, [
      'sourceFamily', 'planDigest', 'sourceContract', 'minimumObservedRecordCount',
      'minimumCoveredSubjectCount', 'maximumMissingSubjectCount',
    ], 'contextual_source_census_governance_invalid');
    if (!CONTEXTUAL_SOURCE_FAMILIES.includes(requirement.sourceFamily as ContextualSourceFamily)) invalid('contextual_source_census_governance_family_set_invalid');
    const sourceFamily = requirement.sourceFamily as ContextualSourceFamily;
    const contract = exact(requirement.sourceContract, ['sourceId', 'providerId'], 'contextual_source_census_source_contract_invalid');
    const normalized = {
      sourceFamily,
      planDigest: digest(requirement.planDigest, 'contextual_source_census_governance_invalid'),
      sourceContract: {
        sourceId: id(contract.sourceId, 'contextual_source_census_source_contract_invalid'),
        providerId: id(contract.providerId, 'contextual_source_census_source_contract_invalid'),
      },
      minimumObservedRecordCount: count(requirement.minimumObservedRecordCount, 'contextual_source_census_governance_invalid', 1),
      minimumCoveredSubjectCount: count(requirement.minimumCoveredSubjectCount, 'contextual_source_census_governance_invalid', 1),
      maximumMissingSubjectCount: count(requirement.maximumMissingSubjectCount, 'contextual_source_census_governance_invalid'),
    };
    if (!same({
      minimumObservedRecordCount: normalized.minimumObservedRecordCount,
      minimumCoveredSubjectCount: normalized.minimumCoveredSubjectCount,
      maximumMissingSubjectCount: normalized.maximumMissingSubjectCount,
    }, frozen[sourceFamily])) invalid('contextual_source_census_threshold_policy_mismatch');
    return normalized;
  }).sort((left, right) => compare(left.sourceFamily, right.sourceFamily));
  if (!same(requirements.map(({ sourceFamily }) => sourceFamily), [...CONTEXTUAL_SOURCE_FAMILIES].sort(compare))) invalid('contextual_source_census_governance_family_set_invalid');
  const governance: Omit<ContextualSourceCensusGovernance, 'governanceDigest'> = {
    recordType: 'contextual_source_census_governance', schemaVersion: CONTEXTUAL_SOURCE_CENSUS_GOVERNANCE_VERSION,
    purpose: 'readiness_census_only', authorizationCeiling: 'no_materialization_no_evidence_credit',
    targetBinding, thresholdPolicy: { version: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_VERSION, digest: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST }, requirements,
  };
  if (body.governanceDigest !== sha(governance)) invalid('contextual_source_census_governance_digest_mismatch');
  return { ...governance, governanceDigest: body.governanceDigest as string };
};

const uniqueIdentities = (plans: readonly ContextualSourceSnapshotPlan[], key: keyof ContextualSourceSnapshotPlan['sourceIdentity']) => {
  if (new Set(plans.map((plan) => plan.sourceIdentity[key])).size !== plans.length) invalid(`contextual_source_census_duplicate_source_identity:${key}`);
};

export const buildContextualSourceReadinessCensus = (params: {
  targetBinding: ContextualTargetRelationshipBinding;
  targetArtifacts: ContextualTargetArtifactReceipts;
  governance: ContextualSourceCensusGovernance;
  governanceCanonicalFileSha256: string;
  plans: Array<{ plan: ContextualSourceSnapshotPlan; canonicalFileSha256: string; coverage: ContextualSourceCoverageLedger }>;
}): ContextualSourceReadinessCensus => {
  const targetBinding = decodeBinding(params.targetBinding);
  const governance = decodeContextualSourceCensusGovernance(params.governance);
  if (!same(governance.targetBinding, targetBinding)) invalid('contextual_source_census_target_binding_mismatch');
  Object.values(params.targetArtifacts).forEach((value) => digest(value, 'contextual_source_census_target_artifact_digest_invalid'));
  digest(params.governanceCanonicalFileSha256, 'contextual_source_census_file_digest_invalid');
  if (params.plans.length !== 4) invalid('contextual_source_census_family_set_invalid');
  const plans = params.plans.map(({ plan, canonicalFileSha256, coverage }) => ({
    plan: decodeContextualSourceSnapshotPlan(plan),
    canonicalFileSha256: digest(canonicalFileSha256, 'contextual_source_census_file_digest_invalid'), coverage,
  })).sort((left, right) => compare(left.plan.sourceFamily, right.plan.sourceFamily));
  if (!same(plans.map(({ plan }) => plan.sourceFamily), [...CONTEXTUAL_SOURCE_FAMILIES].sort(compare))) invalid('contextual_source_census_family_set_invalid');
  ['snapshotId', 'contentSha256', 'manifestSha256'].forEach((key) => uniqueIdentities(plans.map(({ plan }) => plan), key as keyof ContextualSourceSnapshotPlan['sourceIdentity']));
  const sources = plans.map(({ plan, canonicalFileSha256, coverage }) => {
    const requirement = governance.requirements.find(({ sourceFamily }) => sourceFamily === plan.sourceFamily) || invalid('contextual_source_census_family_set_invalid');
    if (!same(plan.targetBinding, targetBinding)) invalid('contextual_source_census_target_binding_mismatch');
    if (requirement.planDigest !== plan.planDigest || requirement.sourceContract.sourceId !== plan.sourceIdentity.sourceId
      || requirement.sourceContract.providerId !== plan.sourceIdentity.providerId) invalid('contextual_source_census_plan_binding_mismatch');
    if (coverage.sourceFamily !== plan.sourceFamily) invalid('contextual_source_census_coverage_family_mismatch');
    const covered = normalizeAddressLedger(coverage.coveredAddresses, 'contextual_source_census_covered_ledger_invalid');
    const missing = coverage.missingAddresses.length ? normalizeAddressLedger(coverage.missingAddresses, 'contextual_source_census_missing_ledger_invalid') : [];
    const combined = [...covered, ...missing].sort(compare);
    if (new Set(combined).size !== covered.length + missing.length
      || combined.length !== targetBinding.subjectCount
      || setDigest(combined) !== targetBinding.subjectAddressSetSha256) {
      invalid('contextual_source_census_coverage_partition_invalid');
    }
    if (coverage.coveredCanonicalSha256 !== plan.declaredCoverage.coveredSubjectLedgerSha256
      || coverage.missingCanonicalSha256 !== plan.declaredCoverage.missingSubjectLedgerSha256) invalid('contextual_source_census_coverage_ledger_digest_mismatch');
    const targetWindow = targetBinding.requiredCoverageWindow;
    if (plan.declaredCoverage.start > targetWindow.start || plan.declaredCoverage.end < targetWindow.end
      || plan.declaredCoverage.observedRecordCount < requirement.minimumObservedRecordCount
      || covered.length < requirement.minimumCoveredSubjectCount || missing.length > requirement.maximumMissingSubjectCount) {
      invalid(`contextual_source_census_declared_coverage_insufficient:${plan.sourceFamily}`);
    }
    if (!missing.length && setDigest(covered) !== targetBinding.subjectAddressSetSha256) invalid('contextual_source_census_full_coverage_digest_mismatch');
    return {
      sourceFamily: plan.sourceFamily, kind: plan.kind, planDigest: plan.planDigest, canonicalFileSha256,
      snapshotId: plan.sourceIdentity.snapshotId, contentSha256: plan.sourceIdentity.contentSha256,
      manifestSha256: plan.sourceIdentity.manifestSha256, coverageStart: plan.declaredCoverage.start,
      coverageEnd: plan.declaredCoverage.end, observedRecordCount: plan.declaredCoverage.observedRecordCount,
      coveredSubjectCount: covered.length, missingSubjectCount: missing.length,
      coveredSubjectAddressSetSha256: setDigest(covered), missingSubjectAddressSetSha256: setDigest(missing),
      status: 'declared_ready_for_materialization_review' as const,
    };
  });
  const withoutDigest: Omit<ContextualSourceReadinessCensus, 'censusDigest'> = {
    recordType: 'contextual_source_readiness_census', schemaVersion: CONTEXTUAL_SOURCE_CENSUS_VERSION,
    purpose: 'readiness_census_only', authorizationCeiling: 'no_materialization_no_evidence_credit', targetBinding,
    targetArtifacts: params.targetArtifacts,
    governance: { governanceDigest: governance.governanceDigest, canonicalFileSha256: params.governanceCanonicalFileSha256, thresholdPolicyDigest: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST },
    sources,
    accounting: {
      requiredFamilyCount: 4, acceptedFamilyCount: 4,
      declaredObservedRecordCount: safeSum(sources.map((source) => source.observedRecordCount), 'contextual_source_census_accounting_overflow'),
      derivedCoveredSubjectCount: safeSum(sources.map((source) => source.coveredSubjectCount), 'contextual_source_census_accounting_overflow'),
      derivedMissingSubjectCount: safeSum(sources.map((source) => source.missingSubjectCount), 'contextual_source_census_accounting_overflow'),
    },
    guarantees: {
      evidenceCredit: 0, sourceClosure: false, materializationsCreated: 0, providerCalls: 0,
      providerBytesDownloaded: 0, databaseReads: 0, databaseWrites: 0, storageReads: 0,
      storageWrites: 0, lunaCalls: 0, contextualEdgesCreated: 0, publicationMutations: 0, deployments: 0,
    },
  };
  return { ...withoutDigest, censusDigest: sha(withoutDigest) };
};

export const verifyContextualSourceReadinessCensus = (params: Parameters<typeof buildContextualSourceReadinessCensus>[0] & { census: unknown }) => {
  const expected = buildContextualSourceReadinessCensus(params);
  const actual = exact(params.census, Object.keys(expected), 'contextual_source_census_invalid');
  if (actual.censusDigest !== expected.censusDigest || !same(actual, expected)) invalid('contextual_source_census_mismatch');
  return expected;
};

export const contextualSourceCensusSha256 = sha;
export const contextualSourceAddressSetSha256 = setDigest;
