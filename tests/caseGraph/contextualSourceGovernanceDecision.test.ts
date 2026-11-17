import { describe, expect, it } from 'vitest';

import {
  buildContextualSourceGovernanceDecisionPacket,
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceEntryInput,
} from '../../src/caseGraph/contextualSourceGovernanceDecision';
import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  type CaseGraphExternalCorrelationCategory,
} from '../../src/caseGraph/externalCorrelation';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const referenceAt = '2026-07-23T12:00:00.000Z';

const entry = (
  category: CaseGraphExternalCorrelationCategory,
  overrides: Partial<ContextualSourceGovernanceEntryInput> = {},
): ContextualSourceGovernanceEntryInput => ({
  category,
  canonicalSource: `SOURCE_${category.toUpperCase()}`,
  providerId: `provider-${category.replace(/_/g, '-')}`,
  requiredContentMode: 'derived_only',
  registry: {
    inspectedAt: '2026-07-23T11:30:00.000Z',
    legalStatus: 'review',
    allowedContentModes: ['metadata_only'],
  },
  rights: {
    commercialUse: 'unclear',
    automatedAccess: 'allowed',
    archivalUse: 'unclear',
    redistribution: 'unclear',
    accessConstraint: 'unclear',
    attributionRequired: null,
  },
  evidence: [{
    evidenceId: `terms-${category.replace(/_/g, '-')}`,
    evidenceUrl: `https://example.test/${category}`,
    observedAt: '2026-07-23T10:00:00.000Z',
    evidenceSha256: relationshipInputSha256({ category, page: 'official-terms' }),
    summary: `Official terms evidence for ${category}.`,
  }],
  limitations: ['A legal-registry approval is still required.'],
  ...overrides,
});

const completeEntries = () => CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => entry(category));

describe('contextual source-governance decision packet', () => {
  it('covers all nine categories deterministically without granting implicit approval', () => {
    const entries = completeEntries();
    entries[0] = entry('aircraft', {
      canonicalSource: 'OPENSKY',
      providerId: 'opensky',
      registry: {
        inspectedAt: '2026-07-23T11:30:00.000Z',
        legalStatus: 'review',
        allowedContentModes: ['metadata_only'],
      },
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'written_license',
        attributionRequired: true,
      },
    });
    entries[1] = entry('satellite', {
      canonicalSource: 'APPROVED_SATELLITE',
      providerId: 'approved-satellite',
      registry: {
        inspectedAt: '2026-07-23T11:30:00.000Z',
        legalStatus: 'approved',
        allowedContentModes: ['derived_only'],
      },
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
    });
    entries[8] = entry('weather', {
      canonicalSource: 'OPEN_METEO',
      providerId: 'open-meteo',
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'paid_plan',
        attributionRequired: true,
      },
    });

    const packet = buildContextualSourceGovernanceDecisionPacket({
      referenceAt,
      maximumEvidenceAgeDays: 30,
      entries: [...entries].reverse(),
    });
    const rebuilt = buildContextualSourceGovernanceDecisionPacket({
      referenceAt,
      maximumEvidenceAgeDays: 30,
      entries,
    });
    expect(packet).toEqual(rebuilt);
    expect(verifyContextualSourceGovernanceDecisionPacket(packet)).toEqual(packet);
    expect(packet.summary).toEqual({
      categoryCount: 9,
      providerCount: 9,
      approvedProviderCount: 1,
      readyCategoryCount: 1,
      unresolvedCategoryCount: 8,
    });
    expect(packet.entries.find(({ category }) => category === 'aircraft')).toMatchObject({
      decision: 'requires_written_license',
      usableNow: false,
      reasonCodes: expect.arrayContaining(['source_access_written_license', 'source_registry_review']),
    });
    expect(packet.entries.find(({ category }) => category === 'satellite')).toMatchObject({
      decision: 'approved',
      usableNow: true,
      reasonCodes: ['explicit_registry_and_rights_approval'],
    });
    expect(packet.entries.find(({ category }) => category === 'weather')).toMatchObject({
      decision: 'requires_paid_plan',
      usableNow: false,
    });
    expect(packet.guarantees).toEqual({
      implicitApproval: false,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      lunaCalls: 0,
    });
  });

  it('keeps stale evidence and unclear rights out of the approved state', () => {
    const entries = completeEntries();
    entries[0] = entry('aircraft', {
      registry: {
        inspectedAt: '2026-07-23T11:30:00.000Z',
        legalStatus: 'approved',
        allowedContentModes: ['derived_only'],
      },
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: false,
      },
      evidence: [{
        evidenceId: 'old-terms',
        evidenceUrl: 'https://example.test/old-terms',
        observedAt: '2026-05-01T00:00:00.000Z',
        evidenceSha256: 'a'.repeat(64),
        summary: 'An old terms snapshot.',
      }],
    });
    const packet = buildContextualSourceGovernanceDecisionPacket({
      referenceAt,
      maximumEvidenceAgeDays: 30,
      entries,
    });
    expect(packet.entries.find(({ category }) => category === 'aircraft')).toMatchObject({
      decision: 'review_required',
      usableNow: false,
      evidenceFresh: false,
      reasonCodes: ['source_terms_evidence_stale'],
    });
  });

  it('rejects incomplete category coverage, duplicate providers and re-sealed tampering', () => {
    expect(() => buildContextualSourceGovernanceDecisionPacket({
      referenceAt,
      maximumEvidenceAgeDays: 30,
      entries: completeEntries().slice(1),
    })).toThrow('contextual_source_governance_category_coverage_incomplete');

    const duplicates = [...completeEntries(), entry('aircraft')];
    expect(() => buildContextualSourceGovernanceDecisionPacket({
      referenceAt,
      maximumEvidenceAgeDays: 30,
      entries: duplicates,
    })).toThrow('contextual_source_governance_entry_duplicate');

    const packet = buildContextualSourceGovernanceDecisionPacket({
      referenceAt,
      maximumEvidenceAgeDays: 30,
      entries: completeEntries(),
    });
    const tampered = structuredClone(packet);
    tampered.entries[0].decision = 'approved';
    tampered.entries[0].usableNow = true;
    expect(() => verifyContextualSourceGovernanceDecisionPacket(tampered))
      .toThrow('contextual_source_governance_entry_digest_mismatch');
  });
});
