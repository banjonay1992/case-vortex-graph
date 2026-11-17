import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  type CaseGraphExternalCorrelationCategory,
} from './externalCorrelation';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_SOURCE_GOVERNANCE_DECISION_VERSION =
  'contextual-source-governance-decision-v1' as const;

export type ContextualSourceAccessConstraint =
  | 'none'
  | 'written_license'
  | 'paid_plan'
  | 'prohibited'
  | 'unclear';

export type ContextualSourceUsageRight = 'allowed' | 'prohibited' | 'unclear';

export type ContextualSourceGovernanceDecision =
  | 'approved'
  | 'requires_written_license'
  | 'requires_paid_plan'
  | 'blocked'
  | 'review_required';

export type ContextualSourceGovernanceEvidence = {
  evidenceId: string;
  evidenceUrl: string;
  observedAt: string;
  evidenceSha256: string;
  summary: string;
};

export type ContextualSourceGovernanceEntryInput = {
  category: CaseGraphExternalCorrelationCategory;
  canonicalSource: string;
  providerId: string;
  requiredContentMode: 'full_ingest' | 'metadata_only' | 'derived_only';
  registry: {
    inspectedAt: string;
    legalStatus: 'approved' | 'review' | 'blocked' | 'restricted' | 'missing';
    allowedContentModes: string[];
  };
  rights: {
    commercialUse: ContextualSourceUsageRight;
    automatedAccess: ContextualSourceUsageRight;
    archivalUse: ContextualSourceUsageRight;
    redistribution: ContextualSourceUsageRight;
    accessConstraint: ContextualSourceAccessConstraint;
    attributionRequired: boolean | null;
  };
  evidence: ContextualSourceGovernanceEvidence[];
  limitations: string[];
};

export type ContextualSourceGovernanceEntry = ContextualSourceGovernanceEntryInput & {
  evidenceSetSha256: string;
  evidenceFresh: boolean;
  decision: ContextualSourceGovernanceDecision;
  usableNow: boolean;
  reasonCodes: string[];
  entryDigest: string;
};

export type ContextualSourceGovernanceDecisionPacket = {
  recordType: 'contextual_source_governance_decision_packet';
  schemaVersion: typeof CONTEXTUAL_SOURCE_GOVERNANCE_DECISION_VERSION;
  referenceAt: string;
  maximumEvidenceAgeDays: number;
  entries: ContextualSourceGovernanceEntry[];
  categoryCoverage: Array<{
    category: CaseGraphExternalCorrelationCategory;
    providerCount: number;
    approvedProviderCount: number;
    decisions: ContextualSourceGovernanceDecision[];
  }>;
  summary: {
    categoryCount: number;
    providerCount: number;
    approvedProviderCount: number;
    readyCategoryCount: number;
    unresolvedCategoryCount: number;
  };
  guarantees: {
    implicitApproval: false;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    lunaCalls: 0;
  };
  packetDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9][a-z0-9._:-]{0,159}$/u;
const SOURCE = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/u;
const MODES = ['full_ingest', 'metadata_only', 'derived_only', 'all'] as const;
const LEGAL_STATUSES = ['approved', 'review', 'blocked', 'restricted', 'missing'] as const;
const RIGHTS = ['allowed', 'prohibited', 'unclear'] as const;
const CONSTRAINTS = ['none', 'written_license', 'paid_plan', 'prohibited', 'unclear'] as const;
const REQUIRED_MODES = ['full_ingest', 'metadata_only', 'derived_only'] as const;

const invalid = (code: string): never => { throw new Error(code); };

const plainObject = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[], code: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
};

const text = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const normalized = (value as string).trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) invalid(code);
  return normalized;
};

const timestamp = (value: unknown, code: string) => {
  const normalized = text(value, 80, code);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) invalid(code);
  return new Date(time).toISOString();
};

const digest = (value: unknown, code: string) => {
  const normalized = text(value, 64, code).toLowerCase();
  if (!SHA256.test(normalized)) invalid(code);
  return normalized;
};

const uniqueStrings = (
  value: unknown,
  maximumItems: number,
  maximumBytes: number,
  code: string,
) => {
  if (!Array.isArray(value) || value.length > maximumItems) invalid(code);
  const normalized = (value as unknown[]).map((item) => text(item, maximumBytes, code));
  if (new Set(normalized).size !== normalized.length) invalid(code);
  return normalized.sort();
};

const normalizeUrl = (value: unknown) => {
  const normalized = text(value, 2_000, 'contextual_source_governance_evidence_url_invalid');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return invalid('contextual_source_governance_evidence_url_invalid');
  }
  if (parsed.protocol !== 'https:') invalid('contextual_source_governance_evidence_url_invalid');
  parsed.hash = '';
  return parsed.toString();
};

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
  code: string,
): T => {
  const normalized = text(value, 80, code) as T;
  if (!values.includes(normalized)) invalid(code);
  return normalized;
};

const normalizeEvidence = (
  value: unknown,
  referenceAt: string,
  maximumEvidenceAgeDays: number,
) => {
  const raw = plainObject(value, 'contextual_source_governance_evidence_invalid');
  exactKeys(raw, [
    'evidenceId', 'evidenceUrl', 'observedAt', 'evidenceSha256', 'summary',
  ], 'contextual_source_governance_evidence_invalid');
  const observedAt = timestamp(raw.observedAt, 'contextual_source_governance_evidence_time_invalid');
  if (observedAt > referenceAt) invalid('contextual_source_governance_evidence_from_future');
  const ageMs = Date.parse(referenceAt) - Date.parse(observedAt);
  return {
    evidence: {
      evidenceId: text(raw.evidenceId, 160, 'contextual_source_governance_evidence_id_invalid').toLowerCase(),
      evidenceUrl: normalizeUrl(raw.evidenceUrl),
      observedAt,
      evidenceSha256: digest(raw.evidenceSha256, 'contextual_source_governance_evidence_digest_invalid'),
      summary: text(raw.summary, 2_000, 'contextual_source_governance_evidence_summary_invalid'),
    },
    fresh: ageMs <= maximumEvidenceAgeDays * 86_400_000,
  };
};

const deriveDecision = (params: {
  legalStatus: ContextualSourceGovernanceEntryInput['registry']['legalStatus'];
  allowedContentModes: string[];
  requiredContentMode: ContextualSourceGovernanceEntryInput['requiredContentMode'];
  rights: ContextualSourceGovernanceEntryInput['rights'];
  evidenceFresh: boolean;
}) => {
  const reasonCodes = new Set<string>();
  if (params.legalStatus === 'missing') reasonCodes.add('source_registry_missing');
  else if (params.legalStatus !== 'approved') reasonCodes.add(`source_registry_${params.legalStatus}`);
  if (!params.allowedContentModes.includes(params.requiredContentMode)
    && !params.allowedContentModes.includes('all')) reasonCodes.add('required_content_mode_not_approved');
  if (!params.evidenceFresh) reasonCodes.add('source_terms_evidence_stale');

  const rights = [
    params.rights.commercialUse,
    params.rights.automatedAccess,
    params.rights.archivalUse,
    params.rights.redistribution,
  ];
  if (rights.includes('prohibited')) reasonCodes.add('source_terms_prohibit_required_use');
  if (rights.includes('unclear')) reasonCodes.add('source_rights_unclear');
  if (params.rights.accessConstraint !== 'none') {
    reasonCodes.add(`source_access_${params.rights.accessConstraint}`);
  }

  let decision: ContextualSourceGovernanceDecision;
  if (params.legalStatus === 'blocked' || params.legalStatus === 'restricted'
    || params.rights.accessConstraint === 'prohibited' || rights.includes('prohibited')) {
    decision = 'blocked';
  } else if (params.rights.accessConstraint === 'written_license') {
    decision = 'requires_written_license';
  } else if (params.rights.accessConstraint === 'paid_plan') {
    decision = 'requires_paid_plan';
  } else if (params.legalStatus === 'approved'
    && (params.allowedContentModes.includes(params.requiredContentMode)
      || params.allowedContentModes.includes('all'))
    && params.evidenceFresh
    && rights.every((right) => right === 'allowed')
    && params.rights.accessConstraint === 'none') {
    decision = 'approved';
  } else {
    decision = 'review_required';
  }
  if (decision === 'approved') reasonCodes.add('explicit_registry_and_rights_approval');
  return { decision, reasonCodes: [...reasonCodes].sort() };
};

const normalizeEntry = (
  value: unknown,
  referenceAt: string,
  maximumEvidenceAgeDays: number,
): ContextualSourceGovernanceEntry => {
  const raw = plainObject(value, 'contextual_source_governance_entry_invalid');
  const permittedInputKeys = [
    'category', 'canonicalSource', 'providerId', 'requiredContentMode',
    'registry', 'rights', 'evidence', 'limitations',
  ];
  const derivedKeys = ['evidenceSetSha256', 'evidenceFresh', 'decision', 'usableNow', 'reasonCodes', 'entryDigest'];
  const isSealed = derivedKeys.some((key) => Object.hasOwn(raw, key));
  exactKeys(raw, isSealed ? [...permittedInputKeys, ...derivedKeys] : permittedInputKeys,
    'contextual_source_governance_entry_invalid');

  const category = enumValue(
    raw.category,
    CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
    'contextual_source_governance_category_invalid',
  );
  const canonicalSource = text(
    raw.canonicalSource,
    160,
    'contextual_source_governance_source_invalid',
  ).toUpperCase();
  if (!SOURCE.test(canonicalSource)) invalid('contextual_source_governance_source_invalid');
  const providerId = text(raw.providerId, 160, 'contextual_source_governance_provider_invalid').toLowerCase();
  if (!ID.test(providerId)) invalid('contextual_source_governance_provider_invalid');
  const requiredContentMode = enumValue(
    raw.requiredContentMode,
    REQUIRED_MODES,
    'contextual_source_governance_mode_invalid',
  );

  const registryRaw = plainObject(raw.registry, 'contextual_source_governance_registry_invalid');
  exactKeys(registryRaw, ['inspectedAt', 'legalStatus', 'allowedContentModes'],
    'contextual_source_governance_registry_invalid');
  const registry = {
    inspectedAt: timestamp(registryRaw.inspectedAt, 'contextual_source_governance_registry_time_invalid'),
    legalStatus: enumValue(
      registryRaw.legalStatus,
      LEGAL_STATUSES,
      'contextual_source_governance_registry_status_invalid',
    ),
    allowedContentModes: uniqueStrings(
      registryRaw.allowedContentModes,
      16,
      64,
      'contextual_source_governance_registry_modes_invalid',
    ).map((mode) => enumValue(mode, MODES, 'contextual_source_governance_registry_modes_invalid')),
  };
  if (registry.inspectedAt > referenceAt) invalid('contextual_source_governance_registry_from_future');
  if (registry.legalStatus === 'missing' && registry.allowedContentModes.length) {
    invalid('contextual_source_governance_registry_missing_with_modes');
  }

  const rightsRaw = plainObject(raw.rights, 'contextual_source_governance_rights_invalid');
  exactKeys(rightsRaw, [
    'commercialUse', 'automatedAccess', 'archivalUse', 'redistribution',
    'accessConstraint', 'attributionRequired',
  ], 'contextual_source_governance_rights_invalid');
  const rights = {
    commercialUse: enumValue(rightsRaw.commercialUse, RIGHTS, 'contextual_source_governance_rights_invalid'),
    automatedAccess: enumValue(rightsRaw.automatedAccess, RIGHTS, 'contextual_source_governance_rights_invalid'),
    archivalUse: enumValue(rightsRaw.archivalUse, RIGHTS, 'contextual_source_governance_rights_invalid'),
    redistribution: enumValue(rightsRaw.redistribution, RIGHTS, 'contextual_source_governance_rights_invalid'),
    accessConstraint: enumValue(
      rightsRaw.accessConstraint,
      CONSTRAINTS,
      'contextual_source_governance_rights_invalid',
    ),
    attributionRequired: rightsRaw.attributionRequired === null
      ? null
      : typeof rightsRaw.attributionRequired === 'boolean'
        ? rightsRaw.attributionRequired
        : invalid('contextual_source_governance_rights_invalid'),
  };

  if (!Array.isArray(raw.evidence) || raw.evidence.length < 1 || raw.evidence.length > 20) {
    invalid('contextual_source_governance_evidence_invalid');
  }
  const normalizedEvidence = (raw.evidence as unknown[]).map((item) => normalizeEvidence(
    item,
    referenceAt,
    maximumEvidenceAgeDays,
  ));
  const evidence = normalizedEvidence.map(({ evidence: item }) => item)
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  if (new Set(evidence.map(({ evidenceId }) => evidenceId)).size !== evidence.length) {
    invalid('contextual_source_governance_evidence_duplicate');
  }
  const limitations = uniqueStrings(
    raw.limitations,
    30,
    2_000,
    'contextual_source_governance_limitations_invalid',
  );
  const evidenceSetSha256 = relationshipInputSha256(evidence);
  const evidenceFresh = normalizedEvidence.every(({ fresh }) => fresh);
  const { decision, reasonCodes } = deriveDecision({
    legalStatus: registry.legalStatus,
    allowedContentModes: registry.allowedContentModes,
    requiredContentMode,
    rights,
    evidenceFresh,
  });
  const core = {
    category,
    canonicalSource,
    providerId,
    requiredContentMode,
    registry,
    rights,
    evidence,
    limitations,
    evidenceSetSha256,
    evidenceFresh,
    decision,
    usableNow: decision === 'approved',
    reasonCodes,
  };
  const entryDigest = relationshipInputSha256(core);
  if (isSealed && (
    raw.evidenceSetSha256 !== evidenceSetSha256
    || raw.evidenceFresh !== evidenceFresh
    || raw.decision !== decision
    || raw.usableNow !== (decision === 'approved')
    || relationshipInputSha256(raw.reasonCodes) !== relationshipInputSha256(reasonCodes)
    || raw.entryDigest !== entryDigest
  )) invalid('contextual_source_governance_entry_digest_mismatch');
  return { ...core, entryDigest };
};

const makePacket = (params: {
  referenceAt: string;
  maximumEvidenceAgeDays: number;
  entries: unknown[];
}): ContextualSourceGovernanceDecisionPacket => {
  const referenceAt = timestamp(params.referenceAt, 'contextual_source_governance_reference_time_invalid');
  if (!Number.isSafeInteger(params.maximumEvidenceAgeDays)
    || params.maximumEvidenceAgeDays < 1 || params.maximumEvidenceAgeDays > 366) {
    invalid('contextual_source_governance_evidence_age_invalid');
  }
  if (!Array.isArray(params.entries) || params.entries.length < 1 || params.entries.length > 100) {
    invalid('contextual_source_governance_entries_invalid');
  }
  const entries = params.entries
    .map((entry) => normalizeEntry(entry, referenceAt, params.maximumEvidenceAgeDays))
    .sort((left, right) => (
      left.category.localeCompare(right.category)
      || left.canonicalSource.localeCompare(right.canonicalSource)
      || left.providerId.localeCompare(right.providerId)
    ));
  const identities = entries.map(({ category, canonicalSource, providerId }) => (
    `${category}:${canonicalSource}:${providerId}`
  ));
  if (new Set(identities).size !== identities.length) {
    invalid('contextual_source_governance_entry_duplicate');
  }
  const presentCategories = new Set(entries.map(({ category }) => category));
  if (CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.some((category) => !presentCategories.has(category))) {
    invalid('contextual_source_governance_category_coverage_incomplete');
  }
  const categoryCoverage = CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => {
    const providers = entries.filter((entry) => entry.category === category);
    return {
      category,
      providerCount: providers.length,
      approvedProviderCount: providers.filter(({ usableNow }) => usableNow).length,
      decisions: [...new Set(providers.map(({ decision }) => decision))].sort(),
    };
  });
  const summary = {
    categoryCount: categoryCoverage.length,
    providerCount: entries.length,
    approvedProviderCount: entries.filter(({ usableNow }) => usableNow).length,
    readyCategoryCount: categoryCoverage.filter(({ approvedProviderCount }) => approvedProviderCount > 0).length,
    unresolvedCategoryCount: categoryCoverage.filter(({ approvedProviderCount }) => approvedProviderCount === 0).length,
  };
  const body = {
    recordType: 'contextual_source_governance_decision_packet' as const,
    schemaVersion: CONTEXTUAL_SOURCE_GOVERNANCE_DECISION_VERSION,
    referenceAt,
    maximumEvidenceAgeDays: params.maximumEvidenceAgeDays,
    entries,
    categoryCoverage,
    summary,
    guarantees: {
      implicitApproval: false as const,
      databaseWrites: 0 as const,
      storageWrites: 0 as const,
      providerCalls: 0 as const,
      lunaCalls: 0 as const,
    },
  };
  return { ...body, packetDigest: relationshipInputSha256(body) };
};

export const buildContextualSourceGovernanceDecisionPacket = (params: {
  referenceAt: string;
  maximumEvidenceAgeDays: number;
  entries: ContextualSourceGovernanceEntryInput[];
}) => makePacket(params);

export const verifyContextualSourceGovernanceDecisionPacket = (
  value: unknown,
): ContextualSourceGovernanceDecisionPacket => {
  const raw = plainObject(value, 'contextual_source_governance_packet_invalid');
  exactKeys(raw, [
    'recordType', 'schemaVersion', 'referenceAt', 'maximumEvidenceAgeDays', 'entries',
    'categoryCoverage', 'summary', 'guarantees', 'packetDigest',
  ], 'contextual_source_governance_packet_invalid');
  if (raw.recordType !== 'contextual_source_governance_decision_packet'
    || raw.schemaVersion !== CONTEXTUAL_SOURCE_GOVERNANCE_DECISION_VERSION
    || !Array.isArray(raw.entries)) invalid('contextual_source_governance_packet_invalid');
  const verified = makePacket({
    referenceAt: String(raw.referenceAt),
    maximumEvidenceAgeDays: Number(raw.maximumEvidenceAgeDays),
    entries: raw.entries as unknown[],
  });
  if (relationshipInputSha256(raw.categoryCoverage) !== relationshipInputSha256(verified.categoryCoverage)
    || relationshipInputSha256(raw.summary) !== relationshipInputSha256(verified.summary)
    || relationshipInputSha256(raw.guarantees) !== relationshipInputSha256(verified.guarantees)
    || raw.packetDigest !== verified.packetDigest) {
    invalid('contextual_source_governance_packet_digest_mismatch');
  }
  return verified;
};
