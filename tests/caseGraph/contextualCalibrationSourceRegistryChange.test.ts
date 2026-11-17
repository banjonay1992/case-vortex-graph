import { describe, expect, it, vi } from 'vitest';
import {
  CONTEXTUAL_CALIBRATION_SOURCE_AUTHORIZATION,
  buildContextualCalibrationSourceRegistryPlan,
  executeContextualCalibrationSourceRegistryPlan,
  verifyContextualCalibrationSourceRegistryReceipt,
} from '../../src/caseGraph/contextualCalibrationSourceRegistryChange';
import {
  buildContextualSourceGovernanceResearchPacket,
} from '../../src/caseGraph/contextualSourceGovernanceResearchCatalogue';

const decisionPacket = () => buildContextualSourceGovernanceResearchPacket({
  referenceAt: '2026-07-27T16:46:13.221Z',
  registryInspectedAt: '2026-07-27T16:46:13.132Z',
  registryRows: [],
});

const plan = () => buildContextualCalibrationSourceRegistryPlan({
  decisionPacket: decisionPacket(),
  createdAt: '2026-07-27T17:00:00.000Z',
  approvedBy: 'owner:nathan',
  authorizationStatement: CONTEXTUAL_CALIBRATION_SOURCE_AUTHORIZATION,
});

describe('contextual calibration source registry change', () => {
  it('binds only the two rights-complete derived-only rows and preserves exclusions', () => {
    const value = plan();
    expect(value.changes.map(({ canonicalSource }) => canonicalSource)).toEqual([
      'ASTRONOMY_ENGINE_LOCAL',
      'SATNOGS_DB_API',
    ]);
    expect(value.constraints).toEqual({
      insertOnly: true,
      requireRowsMissing: true,
      requireNoActivePublication: true,
      providerCallsApproved: false,
      archivalWritesApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
    expect(() => buildContextualCalibrationSourceRegistryPlan({
      decisionPacket: decisionPacket(),
      createdAt: '2026-07-27T17:00:00.000Z',
      approvedBy: 'owner:nathan',
      authorizationStatement: 'approved',
    })).toThrow('contextual_calibration_source_registry_authorization_invalid');
  });

  it('executes atomically and verifies the exact postcondition receipt', async () => {
    const value = plan();
    const expectedRows = value.changes.map((change) => ({
      canonical_source: change.canonicalSource,
      legal_status: change.legalStatus,
      license_type: change.licenseType,
      allowed_content_modes: change.allowedContentModes,
      evidence_url: change.evidenceUrl,
      reviewed_at: value.createdAt,
      reviewed_by: `case-vortex:${value.approvedBy}:${value.planDigest.slice(0, 16)}`,
    })).sort((left, right) => left.canonical_source.localeCompare(right.canonical_source));
    const query = vi.fn(async (sql: string | { text: string }) => {
      const text = typeof sql === 'string' ? sql : sql.text;
      if (text.includes('WHERE active = true')) return { rows: [{ active_count: 0 }] };
      if (text.includes('FOR UPDATE')) return { rows: [] };
      if (text.includes('INSERT INTO')) {
        return { rows: expectedRows.map(({ canonical_source }) => ({ canonical_source })) };
      }
      if (text.includes('SELECT canonical_source, legal_status')) {
        return { rows: expectedRows };
      }
      if (text.includes('clock_timestamp')) {
        return { rows: [{ executed_at: '2026-07-27T17:01:00.000Z' }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const receipt = await executeContextualCalibrationSourceRegistryPlan({
      plan: value,
      decisionPacket: decisionPacket(),
    }, {
      getClient: async () => ({ query, release }),
    });

    expect(verifyContextualCalibrationSourceRegistryReceipt(
      receipt,
      value,
      decisionPacket(),
    )).toEqual(receipt);
    expect(receipt.postcondition).toEqual({
      insertedRowCount: 2,
      exactRowsVerified: true,
      activePublicationCount: 0,
    });
    expect(receipt.guarantees).toMatchObject({
      providerCalls: 0,
      archivalWrites: 0,
      publicationActivations: 0,
      deployments: 0,
    });
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back without insertion when an active publication exists', async () => {
    const query = vi.fn(async (sql: string | { text: string }) => {
      const text = typeof sql === 'string' ? sql : sql.text;
      if (text.includes('WHERE active = true')) return { rows: [{ active_count: 1 }] };
      return { rows: [] };
    });
    await expect(executeContextualCalibrationSourceRegistryPlan({
      plan: plan(),
      decisionPacket: decisionPacket(),
    }, {
      getClient: async () => ({ query, release: vi.fn() }),
    })).rejects.toThrow('contextual_calibration_source_registry_active_publication');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
  });
});
