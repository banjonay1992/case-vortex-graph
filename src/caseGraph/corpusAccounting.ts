import { createHash } from 'node:crypto';

import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  evidenceUniverseAddress,
  type EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from './evidenceUniverseArchive';
import {
  RELATIONSHIP_INPUT_SNAPSHOT_VERSION,
  validateRelationshipInputBinding,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const CASE_VORTEX_CORPUS_ACCOUNTING_VERSION = 'case-vortex-corpus-accounting-v1' as const;

export const CASE_VORTEX_EXCLUSION_REASONS = [
  'not_public',
  'withdrawn',
  'legal_restriction',
  'unsafe_media',
  'invalid_record',
  'outside_governed_scope',
] as const;

export type CaseVortexExclusionReason = typeof CASE_VORTEX_EXCLUSION_REASONS[number];
export type CaseVortexKindCounts = Record<EvidenceUniverseNodeKind, number>;

export type CaseVortexCorpusBinding = {
  corpusVersion: string;
  snapshotId: string;
  universeArchiveVersion: typeof EVIDENCE_UNIVERSE_ARCHIVE_VERSION;
  universeArchiveSetSha256: string;
  universeSchemaVersion: typeof EVIDENCE_UNIVERSE_SCHEMA_VERSION;
  universeLayoutVersion: typeof EVIDENCE_UNIVERSE_LAYOUT_VERSION;
  universeRecordCount: number;
  relationshipInputSchemaVersion: typeof RELATIONSHIP_INPUT_SNAPSHOT_VERSION;
  relationshipInputBinding: RelationshipInputUniverseBinding;
  relationshipInputArchiveSetSha256: string;
  relationshipInputManifestDigest: string;
  relationshipInputRecordCount: number;
  graphPublicationSha256: string;
  policyVersion: string;
};

type StagePointer = {
  address: string;
  sha256: string;
};

export type CaseVortexRepresentedRecord = {
  status: 'represented';
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  address: string;
  universe: StagePointer;
  relationshipInput: StagePointer & {
    disposition: 'processed' | 'not_applicable';
    notApplicableReason?: string;
  };
  graph: StagePointer;
  userInterface: StagePointer;
  duplicateLineage?: {
    status: 'candidate' | 'confirmed';
    clusterId: string;
    canonicalAddress: string;
    memberRole: 'canonical' | 'duplicate';
  };
};

export type CaseVortexExcludedRecord = {
  status: 'excluded';
  kind: EvidenceUniverseNodeKind;
  recordId: string;
  address: string;
  exclusion: {
    reason: CaseVortexExclusionReason;
    policyRule: string;
    evidenceReference: string;
  };
};

export type CaseVortexCorpusRecord = CaseVortexRepresentedRecord | CaseVortexExcludedRecord;

export type CaseVortexCorpusAccountingInput = {
  binding: CaseVortexCorpusBinding;
  observedByKind: CaseVortexKindCounts;
  capturedByKind: CaseVortexKindCounts;
  records: readonly CaseVortexCorpusRecord[];
};

export type CaseVortexCorpusAccountingIssue = {
  code: string;
  address?: string;
  detail?: string;
};

export type CaseVortexCorpusAccountingReceipt = {
  accountingVersion: typeof CASE_VORTEX_CORPUS_ACCOUNTING_VERSION;
  complete: true;
  binding: CaseVortexCorpusBinding;
  observedByKind: CaseVortexKindCounts;
  capturedByKind: CaseVortexKindCounts;
  excludedByKind: CaseVortexKindCounts;
  observedTotal: number;
  representedTotal: number;
  excludedTotal: number;
  relationshipProcessedTotal: number;
  relationshipNotApplicableTotal: number;
  duplicateCandidateTotal: number;
  duplicateConfirmedTotal: number;
  exclusionsByReason: Record<CaseVortexExclusionReason, number>;
  recordLedgerSha256: string;
  representedAddressSetSha256: string;
  excludedAddressSetSha256: string;
  universePointerSetSha256: string;
  relationshipInputPointerSetSha256: string;
  graphPointerSetSha256: string;
  userInterfacePointerSetSha256: string;
};

export type CaseVortexCorpusAccountingAudit =
  | { status: 'complete'; issues: []; receipt: CaseVortexCorpusAccountingReceipt }
  | { status: 'incomplete'; issues: CaseVortexCorpusAccountingIssue[]; receipt: null };

const KINDS: EvidenceUniverseNodeKind[] = ['sighting', 'document', 'photo', 'video'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const REFERENCE = /^[^\u0000-\u001f\u007f]{1,500}$/;
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

const emptyKindCounts = (): CaseVortexKindCounts => ({ sighting: 0, document: 0, photo: 0, video: 0 });
const emptyReasonCounts = (): Record<CaseVortexExclusionReason, number> => ({
  not_public: 0,
  withdrawn: 0,
  legal_restriction: 0,
  unsafe_media: 0,
  invalid_record: 0,
  outside_governed_scope: 0,
});

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('case_vortex_accounting_non_finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) throw new Error('case_vortex_accounting_non_json_value');
  const entries = Object.entries(value).sort(([left], [right]) => compareText(left, right));
  if (entries.some(([, item]) => item === undefined)) throw new Error('case_vortex_accounting_undefined');
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const total = (counts: CaseVortexKindCounts) => KINDS.reduce((sum, kind) => sum + counts[kind], 0);
const addIssue = (
  issues: CaseVortexCorpusAccountingIssue[],
  code: string,
  address?: string,
  detail?: string,
) => issues.push({ code, ...(address ? { address } : {}), ...(detail ? { detail } : {}) });

const validCount = (value: number) => Number.isSafeInteger(value) && value >= 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => hasOwn(value, key)) && keys.every((key) => allowed.has(key));
};

const validateBinding = (binding: CaseVortexCorpusBinding, issues: CaseVortexCorpusAccountingIssue[]) => {
  if (!exactKeys(binding, [
    'corpusVersion',
    'snapshotId',
    'universeArchiveVersion',
    'universeArchiveSetSha256',
    'universeSchemaVersion',
    'universeLayoutVersion',
    'universeRecordCount',
    'relationshipInputSchemaVersion',
    'relationshipInputBinding',
    'relationshipInputArchiveSetSha256',
    'relationshipInputManifestDigest',
    'relationshipInputRecordCount',
    'graphPublicationSha256',
    'policyVersion',
  ])) {
    addIssue(issues, 'binding_shape_invalid');
    return;
  }
  if (!VERSION.test(binding.corpusVersion)) addIssue(issues, 'binding_corpus_version_invalid');
  if (!UUID.test(binding.snapshotId)) addIssue(issues, 'binding_snapshot_id_invalid');
  if (binding.universeArchiveVersion !== EVIDENCE_UNIVERSE_ARCHIVE_VERSION) addIssue(issues, 'binding_universe_archive_version_invalid');
  if (!SHA256.test(binding.universeArchiveSetSha256)) addIssue(issues, 'binding_universe_sha256_invalid');
  if (!validCount(binding.universeRecordCount)) addIssue(issues, 'binding_universe_record_count_invalid');
  if (binding.relationshipInputSchemaVersion !== RELATIONSHIP_INPUT_SNAPSHOT_VERSION) {
    addIssue(issues, 'binding_relationship_schema_invalid');
  }
  if (!SHA256.test(binding.relationshipInputArchiveSetSha256)) addIssue(issues, 'binding_relationship_sha256_invalid');
  if (!SHA256.test(binding.relationshipInputManifestDigest)) addIssue(issues, 'binding_relationship_manifest_digest_invalid');
  if (!validCount(binding.relationshipInputRecordCount)) addIssue(issues, 'binding_relationship_record_count_invalid');
  if (!SHA256.test(binding.graphPublicationSha256)) addIssue(issues, 'binding_graph_sha256_invalid');
  if (binding.universeSchemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION) addIssue(issues, 'binding_universe_schema_invalid');
  if (binding.universeLayoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION) addIssue(issues, 'binding_universe_layout_invalid');
  if (!VERSION.test(binding.policyVersion)) addIssue(issues, 'binding_policy_version_invalid');
  if (!exactKeys(binding.relationshipInputBinding, [
    'snapshotId',
    'corpusVersion',
    'universeArchiveVersion',
    'universeSchemaVersion',
    'universeLayoutVersion',
    'universeArchiveSetSha256',
    'universeRecordCount',
  ])) {
    addIssue(issues, 'binding_relationship_universe_binding_shape_invalid');
    return;
  }
  try {
    const relationshipBinding = validateRelationshipInputBinding(binding.relationshipInputBinding);
    if (relationshipBinding.snapshotId !== binding.snapshotId) addIssue(issues, 'binding_snapshot_mismatch');
    if (relationshipBinding.corpusVersion !== binding.corpusVersion) addIssue(issues, 'binding_corpus_mismatch');
    if (relationshipBinding.universeArchiveVersion !== binding.universeArchiveVersion) {
      addIssue(issues, 'binding_relationship_universe_archive_version_mismatch');
    }
    if (relationshipBinding.universeArchiveSetSha256 !== binding.universeArchiveSetSha256) {
      addIssue(issues, 'binding_relationship_universe_sha_mismatch');
    }
    if (relationshipBinding.universeSchemaVersion !== binding.universeSchemaVersion) {
      addIssue(issues, 'binding_relationship_universe_schema_mismatch');
    }
    if (relationshipBinding.universeLayoutVersion !== binding.universeLayoutVersion) {
      addIssue(issues, 'binding_relationship_universe_layout_mismatch');
    }
    if (relationshipBinding.universeRecordCount !== binding.universeRecordCount) {
      addIssue(issues, 'binding_relationship_universe_count_mismatch');
    }
  } catch {
    addIssue(issues, 'binding_relationship_universe_binding_invalid');
  }
  if (validCount(binding.universeRecordCount)
    && validCount(binding.relationshipInputRecordCount)
    && binding.relationshipInputRecordCount !== binding.universeRecordCount) {
    addIssue(issues, 'binding_relationship_record_count_mismatch');
  }
};

const validateCounts = (
  observedByKind: CaseVortexKindCounts,
  capturedByKind: CaseVortexKindCounts,
  issues: CaseVortexCorpusAccountingIssue[],
) => {
  if (!exactKeys(observedByKind, KINDS) || !exactKeys(capturedByKind, KINDS)) {
    addIssue(issues, 'kind_counts_shape_invalid');
    return;
  }
  for (const kind of KINDS) {
    if (!validCount(observedByKind[kind])) addIssue(issues, 'observed_count_invalid', undefined, kind);
    if (!validCount(capturedByKind[kind])) addIssue(issues, 'captured_count_invalid', undefined, kind);
    if (validCount(observedByKind[kind]) && validCount(capturedByKind[kind]) && capturedByKind[kind] > observedByKind[kind]) {
      addIssue(issues, 'captured_exceeds_observed', undefined, kind);
    }
  }
};

const pointerValid = (pointer: StagePointer | null | undefined, address: string) => Boolean(
  exactKeys(pointer, ['address', 'sha256'])
  && pointer?.address === address
  && typeof pointer.sha256 === 'string'
  && SHA256.test(pointer.sha256),
);

const relationshipPointerValid = (
  pointer: CaseVortexRepresentedRecord['relationshipInput'] | null | undefined,
  address: string,
) => Boolean(
  exactKeys(pointer, ['address', 'sha256', 'disposition'], ['notApplicableReason'])
  && pointer?.address === address
  && typeof pointer.sha256 === 'string'
  && SHA256.test(pointer.sha256),
);

const parseAddress = (address: unknown) => {
  if (typeof address !== 'string') return null;
  const separator = address.indexOf(':');
  if (separator < 1) return null;
  const kind = address.slice(0, separator) as EvidenceUniverseNodeKind;
  const recordId = address.slice(separator + 1);
  if (!KINDS.includes(kind)) return null;
  try {
    return evidenceUniverseAddress(kind, recordId) === address ? { kind, recordId } : null;
  } catch {
    return null;
  }
};

const normalizeRecordIdentity = (
  record: CaseVortexCorpusRecord,
  issues: CaseVortexCorpusAccountingIssue[],
) => {
  if (!isPlainObject(record)) {
    addIssue(issues, 'record_shape_invalid');
    return null;
  }
  if (!KINDS.includes(record.kind)) {
    addIssue(issues, 'record_kind_invalid', record.address);
    return null;
  }
  let expectedAddress: string;
  try {
    expectedAddress = evidenceUniverseAddress(record.kind, record.recordId);
  } catch {
    addIssue(issues, 'record_id_invalid', record.address);
    return null;
  }
  if (record.address !== expectedAddress) addIssue(issues, 'record_address_invalid', record.address);
  const normalizedRecordId = expectedAddress.slice(record.kind.length + 1);
  if (record.recordId !== normalizedRecordId) addIssue(issues, 'record_id_not_canonical', record.address);
  return expectedAddress;
};

export const auditCaseVortexCorpusAccounting = (
  input: CaseVortexCorpusAccountingInput,
): CaseVortexCorpusAccountingAudit => {
  const issues: CaseVortexCorpusAccountingIssue[] = [];
  if (!isPlainObject(input)) {
    return {
      status: 'incomplete',
      issues: [{ code: 'accounting_input_shape_invalid' }],
      receipt: null,
    };
  }
  if (!exactKeys(input, ['binding', 'observedByKind', 'capturedByKind', 'records'])) {
    addIssue(issues, 'accounting_input_shape_invalid');
  }
  validateBinding(input.binding, issues);
  validateCounts(input.observedByKind, input.capturedByKind, issues);
  if (!isPlainObject(input.binding)
    || !exactKeys(input.observedByKind, KINDS)
    || !exactKeys(input.capturedByKind, KINDS)) {
    return {
      status: 'incomplete',
      issues: issues.sort((left, right) => compareText(canonicalJson(left), canonicalJson(right))),
      receipt: null,
    };
  }
  if (!Array.isArray(input.records)) {
    addIssue(issues, 'records_invalid');
    return { status: 'incomplete', issues, receipt: null };
  }

  const observedActual = emptyKindCounts();
  const representedActual = emptyKindCounts();
  const excludedActual = emptyKindCounts();
  const exclusionsByReason = emptyReasonCounts();
  const addresses = new Map<string, CaseVortexCorpusRecord>();
  const representedAddresses = new Set<string>();
  const duplicateLinks: Array<{
    address: string;
    kind: EvidenceUniverseNodeKind;
    canonicalAddress: string;
    memberRole: 'canonical' | 'duplicate';
    clusterId: string;
    status: 'candidate' | 'confirmed';
  }> = [];
  let relationshipProcessedTotal = 0;
  let relationshipNotApplicableTotal = 0;
  let duplicateCandidateTotal = 0;
  let duplicateConfirmedTotal = 0;

  const records = [...input.records].sort((left, right) => compareText(
    isPlainObject(left) && typeof left.address === 'string' ? left.address : '',
    isPlainObject(right) && typeof right.address === 'string' ? right.address : '',
  ));
  for (const rawRecord of records) {
    if (!isPlainObject(rawRecord)) {
      addIssue(issues, 'record_shape_invalid');
      continue;
    }
    if (rawRecord.status === 'excluded') {
      if (!exactKeys(rawRecord, ['status', 'kind', 'recordId', 'address', 'exclusion'])) {
        addIssue(issues, 'record_shape_invalid', typeof rawRecord.address === 'string' ? rawRecord.address : undefined);
        continue;
      }
    } else if (rawRecord.status === 'represented') {
      if (!exactKeys(rawRecord, [
        'status', 'kind', 'recordId', 'address', 'universe', 'relationshipInput', 'graph', 'userInterface',
      ], ['duplicateLineage'])) {
        addIssue(issues, 'record_shape_invalid', typeof rawRecord.address === 'string' ? rawRecord.address : undefined);
        continue;
      }
    }
    const record = rawRecord as CaseVortexCorpusRecord;
    const address = normalizeRecordIdentity(record, issues);
    if (!address) continue;
    observedActual[record.kind] += 1;
    if (addresses.has(address)) {
      addIssue(issues, 'duplicate_record_accounting', address);
      continue;
    }
    addresses.set(address, record);

    if (record.status === 'excluded') {
      excludedActual[record.kind] += 1;
      if (!record.exclusion || typeof record.exclusion !== 'object') {
        addIssue(issues, 'exclusion_receipt_missing', address);
        continue;
      }
      if (!exactKeys(record.exclusion, ['reason', 'policyRule', 'evidenceReference'])) {
        addIssue(issues, 'exclusion_receipt_shape_invalid', address);
        continue;
      }
      if (!CASE_VORTEX_EXCLUSION_REASONS.includes(record.exclusion.reason)) {
        addIssue(issues, 'exclusion_reason_invalid', address);
      } else {
        exclusionsByReason[record.exclusion.reason] += 1;
      }
      if (!VERSION.test(record.exclusion.policyRule)) addIssue(issues, 'exclusion_policy_rule_invalid', address);
      if (!REFERENCE.test(record.exclusion.evidenceReference)) addIssue(issues, 'exclusion_evidence_reference_invalid', address);
      continue;
    }

    if (record.status !== 'represented') {
      addIssue(issues, 'record_status_invalid', address);
      continue;
    }

    if (hasOwn(record, 'duplicateLineage') && !isPlainObject(record.duplicateLineage)) {
      addIssue(issues, 'duplicate_lineage_shape_invalid', address);
      continue;
    }

    representedActual[record.kind] += 1;
    representedAddresses.add(address);
    if (!pointerValid(record.universe, address)) addIssue(issues, 'universe_pointer_invalid', address);
    const relationshipPointerIsValid = relationshipPointerValid(record.relationshipInput, address);
    if (!relationshipPointerIsValid) addIssue(issues, 'relationship_pointer_invalid', address);
    if (!pointerValid(record.graph, address)) addIssue(issues, 'graph_pointer_invalid', address);
    if (!pointerValid(record.userInterface, address)) addIssue(issues, 'ui_pointer_invalid', address);
    if (!relationshipPointerIsValid) continue;
    if (!['processed', 'not_applicable'].includes(record.relationshipInput.disposition)) {
      addIssue(issues, 'relationship_disposition_invalid', address);
      continue;
    }
    if (record.relationshipInput.disposition === 'processed') {
      relationshipProcessedTotal += 1;
      if (hasOwn(record.relationshipInput, 'notApplicableReason')) {
        addIssue(issues, 'relationship_not_applicable_reason_unexpected', address);
      }
    } else {
      relationshipNotApplicableTotal += 1;
      addIssue(issues, 'relationship_input_not_processed', address);
      if (!record.relationshipInput.notApplicableReason || !REFERENCE.test(record.relationshipInput.notApplicableReason)) {
        addIssue(issues, 'relationship_not_applicable_reason_missing', address);
      }
    }
    if (record.duplicateLineage) {
      const lineage = record.duplicateLineage;
      if (!exactKeys(lineage, ['status', 'clusterId', 'canonicalAddress', 'memberRole'])) {
        addIssue(issues, 'duplicate_lineage_shape_invalid', address);
        continue;
      }
      if (!STABLE_ID.test(lineage.clusterId)) addIssue(issues, 'duplicate_cluster_id_invalid', address);
      if (!['candidate', 'confirmed'].includes(lineage.status)) {
        addIssue(issues, 'duplicate_status_invalid', address);
        continue;
      }
      if (!['canonical', 'duplicate'].includes(lineage.memberRole)) {
        addIssue(issues, 'duplicate_member_role_invalid', address);
        continue;
      }
      const canonicalIdentity = parseAddress(lineage.canonicalAddress);
      if (!canonicalIdentity) addIssue(issues, 'duplicate_canonical_address_invalid', address);
      else if (canonicalIdentity.kind !== record.kind) addIssue(issues, 'duplicate_kind_mismatch', address);
      duplicateLinks.push({
        address,
        kind: record.kind,
        canonicalAddress: lineage.canonicalAddress,
        memberRole: lineage.memberRole,
        clusterId: lineage.clusterId,
        status: lineage.status,
      });
      if (lineage.status === 'candidate') duplicateCandidateTotal += 1;
      if (lineage.status === 'confirmed') duplicateConfirmedTotal += 1;
      if (lineage.memberRole === 'canonical' && lineage.canonicalAddress !== address) {
        addIssue(issues, 'duplicate_canonical_role_invalid', address);
      }
      if (lineage.memberRole === 'duplicate' && lineage.canonicalAddress === address) {
        addIssue(issues, 'duplicate_member_role_invalid', address);
      }
    }
  }

  for (const link of duplicateLinks) {
    const canonical = addresses.get(link.canonicalAddress);
    if (!representedAddresses.has(link.canonicalAddress) || canonical?.status !== 'represented') {
      addIssue(issues, 'duplicate_canonical_address_missing', link.address);
      continue;
    }
    const canonicalLineage = canonical.duplicateLineage;
    if (!canonicalLineage
      || canonicalLineage.memberRole !== 'canonical'
      || canonicalLineage.canonicalAddress !== link.canonicalAddress) {
      addIssue(issues, 'duplicate_canonical_receipt_invalid', link.address);
      continue;
    }
    if (canonical.kind !== link.kind
      || canonicalLineage.clusterId !== link.clusterId
      || canonicalLineage.status !== link.status) {
      addIssue(issues, 'duplicate_lineage_mismatch', link.address);
    }
  }

  const duplicateClusters = new Map<string, typeof duplicateLinks>();
  for (const link of duplicateLinks) {
    const members = duplicateClusters.get(link.clusterId) || [];
    members.push(link);
    duplicateClusters.set(link.clusterId, members);
  }
  for (const [clusterId, members] of duplicateClusters) {
    const canonicalAddresses = new Set(
      members.filter((member) => member.memberRole === 'canonical').map((member) => member.address),
    );
    const referencedCanonicals = new Set(members.map((member) => member.canonicalAddress));
    const statuses = new Set(members.map((member) => member.status));
    const kinds = new Set(members.map((member) => member.kind));
    if (canonicalAddresses.size !== 1
      || referencedCanonicals.size !== 1
      || !canonicalAddresses.has([...referencedCanonicals][0] || '')
      || statuses.size !== 1
      || kinds.size !== 1) {
      addIssue(issues, 'duplicate_cluster_inconsistent', undefined, clusterId);
    }
  }

  for (const kind of KINDS) {
    if (observedActual[kind] !== input.observedByKind[kind]) addIssue(issues, 'observed_count_mismatch', undefined, kind);
    if (representedActual[kind] !== input.capturedByKind[kind]) addIssue(issues, 'represented_count_mismatch', undefined, kind);
    if (excludedActual[kind] !== input.observedByKind[kind] - input.capturedByKind[kind]) {
      addIssue(issues, 'excluded_count_mismatch', undefined, kind);
    }
  }

  const representedCount = total(representedActual);
  if (isPlainObject(input.binding)) {
    if (validCount(input.binding.universeRecordCount as number) && representedCount !== input.binding.universeRecordCount) {
      addIssue(issues, 'universe_record_count_mismatch');
    }
    if (validCount(input.binding.relationshipInputRecordCount as number)
      && representedCount !== input.binding.relationshipInputRecordCount) {
      addIssue(issues, 'relationship_input_record_count_mismatch');
    }
  }
  if (relationshipProcessedTotal !== representedCount) {
    addIssue(issues, 'relationship_processed_count_mismatch');
  }

  if (issues.length > 0) {
    return {
      status: 'incomplete',
      issues: issues.sort((left, right) => compareText(canonicalJson(left), canonicalJson(right))),
      receipt: null,
    };
  }

  const represented = records.filter((record): record is CaseVortexRepresentedRecord => record.status === 'represented');
  const excluded = records.filter((record): record is CaseVortexExcludedRecord => record.status === 'excluded');
  return {
    status: 'complete',
    issues: [],
    receipt: {
      accountingVersion: CASE_VORTEX_CORPUS_ACCOUNTING_VERSION,
      complete: true,
      binding: {
        ...input.binding,
        relationshipInputBinding: { ...input.binding.relationshipInputBinding },
      },
      observedByKind: { ...input.observedByKind },
      capturedByKind: { ...input.capturedByKind },
      excludedByKind: excludedActual,
      observedTotal: total(observedActual),
      representedTotal: total(representedActual),
      excludedTotal: total(excludedActual),
      relationshipProcessedTotal,
      relationshipNotApplicableTotal,
      duplicateCandidateTotal,
      duplicateConfirmedTotal,
      exclusionsByReason,
      recordLedgerSha256: sha256(records.map((record) => `${canonicalJson(record)}\n`).join('')),
      representedAddressSetSha256: sha256(represented.map((record) => `${record.address}\n`).join('')),
      excludedAddressSetSha256: sha256(excluded.map((record) => `${record.address}\n`).join('')),
      universePointerSetSha256: sha256(represented.map((record) => `${record.address}:${record.universe.sha256}\n`).join('')),
      relationshipInputPointerSetSha256: sha256(
        represented.map((record) => `${record.address}:${record.relationshipInput.sha256}\n`).join(''),
      ),
      graphPointerSetSha256: sha256(represented.map((record) => `${record.address}:${record.graph.sha256}\n`).join('')),
      userInterfacePointerSetSha256: sha256(
        represented.map((record) => `${record.address}:${record.userInterface.sha256}\n`).join(''),
      ),
    },
  };
};

export const buildCaseVortexCorpusAccountingReceipt = (
  input: CaseVortexCorpusAccountingInput,
): CaseVortexCorpusAccountingReceipt => {
  const audit = auditCaseVortexCorpusAccounting(input);
  if (audit.status === 'incomplete') {
    throw new Error(`case_vortex_corpus_accounting_incomplete:${audit.issues.map((issue) => issue.code).join(',')}`);
  }
  return audit.receipt;
};
