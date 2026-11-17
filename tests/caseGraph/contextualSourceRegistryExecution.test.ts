import { describe, expect, it, vi } from 'vitest';

import {
  executeApprovedContextualSourceRegistryChange,
  verifyContextualSourceRegistryExecutionReceipt,
  type ContextualSourceRegistryExecutionClient,
} from '../../src/caseGraph/contextualSourceRegistryExecution';
import {
  buildContextualSourceRegistryApproval,
} from '../../src/caseGraph/contextualSourceRegistryApproval';
import {
  buildContextualSourceGovernanceResearchPacket,
} from '../../src/caseGraph/contextualSourceGovernanceResearchCatalogue';
import {
  buildContextualSourceRegistryProposal,
  contextualSourceRegistryProposalApprovalStatement,
} from '../../src/caseGraph/contextualSourceRegistryProposal';

const fixture = () => {
  const decisionPacket = buildContextualSourceGovernanceResearchPacket({
    referenceAt: '2026-07-27T17:00:00.000Z',
    registryInspectedAt: '2026-07-27T16:59:00.000Z',
    registryRows: [],
  });
  const proposal = buildContextualSourceRegistryProposal({
    decisionPacket,
    createdAt: '2026-07-27T17:05:00.000Z',
  });
  const approval = buildContextualSourceRegistryApproval({
    approvalId: '123e4567-e89b-42d3-a456-426614174000',
    approvedBy: 'owner:nathan',
    approvedAt: '2026-07-27T17:10:00.000Z',
    proposal,
    decisionPacket,
    authorizationStatement: contextualSourceRegistryProposalApprovalStatement(
      proposal.proposalDigest,
    ),
    registryChangeApproved: true,
    providerCallsApproved: false,
    archivalWritesApproved: false,
    publicationActivationApproved: false,
    deploymentApproved: false,
  });
  return { decisionPacket, proposal, approval };
};

const databaseRows = () => [
  {
    canonical_source: 'ADSB_LOL',
    legal_status: 'approved',
    license_type: 'odbl_1_0_attribution_share_alike',
    allowed_content_modes: ['derived_only'],
    evidence_url: 'https://api.adsb.lol/',
    reviewed_at: new Date('2026-07-27T17:10:00.000Z'),
    reviewed_by: 'case-vortex:123e4567-e89b-42d3-a456-426614174000:owner:nathan',
  },
  {
    canonical_source: 'NOAA_NCEI_US_OBSERVATIONS',
    legal_status: 'approved',
    license_type: 'us_government_public_domain_noaa_created_us_only',
    allowed_content_modes: ['derived_only'],
    evidence_url: 'https://sos.noaa.gov/copyright/',
    reviewed_at: '2026-07-27T17:10:00.000Z',
    reviewed_by: 'case-vortex:123e4567-e89b-42d3-a456-426614174000:owner:nathan',
  },
];

const client = (options: {
  activeCount?: number;
  currentRows?: Record<string, unknown>[];
  postRows?: Record<string, unknown>[];
  insertedSources?: string[];
  executedAt?: string;
} = {}) => {
  let currentReads = 0;
  const queries: string[] = [];
  const query = vi.fn(async (
    input: string | { text: string; values?: unknown[] },
  ) => {
    const sql = typeof input === 'string' ? input : input.text;
    queries.push(sql);
    if (sql.includes('registry_present')) {
      return { rows: [{ registry_present: true, publications_present: true }] };
    }
    if (sql.includes('executed_at')) {
      return { rows: [{ executed_at: options.executedAt || '2026-07-27T17:15:00.000Z' }] };
    }
    if (sql.includes('active_count')) {
      return { rows: [{ active_count: options.activeCount ?? 0 }] };
    }
    if (sql.includes('FROM public.uap_source_legal_registry')) {
      currentReads += 1;
      return {
        rows: currentReads === 1
          ? (options.currentRows || [])
          : (options.postRows || databaseRows()),
      };
    }
    if (sql.includes('INSERT INTO public.uap_source_legal_registry')) {
      return {
        rows: (options.insertedSources || [
          'ADSB_LOL',
          'NOAA_NCEI_US_OBSERVATIONS',
        ]).map((canonical_source) => ({ canonical_source })),
      };
    }
    return { rows: [] };
  });
  return {
    queries,
    value: {
      query,
      release: vi.fn(),
    } satisfies ContextualSourceRegistryExecutionClient,
  };
};

describe('approved contextual source registry execution', () => {
  it('atomically inserts and re-verifies only the exact two missing rows', async () => {
    const artifacts = fixture();
    const db = client();
    const receipt = await executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => db.value },
    );
    expect(receipt).toMatchObject({
      approvalDigest: artifacts.approval.approvalDigest,
      proposalDigest: artifacts.proposal.proposalDigest,
      postcondition: {
        insertedRowCount: 2,
        exactRowsVerified: true,
        activePublicationCount: 0,
      },
      guarantees: {
        registryRowsInserted: 2,
        registryRowsUpdated: 0,
        providerCalls: 0,
        storageWrites: 0,
        lunaCalls: 0,
        publicationActivations: 0,
        deployments: 0,
      },
    });
    expect(verifyContextualSourceRegistryExecutionReceipt(
      receipt,
      artifacts.approval,
      artifacts.proposal,
      artifacts.decisionPacket,
    )).toEqual(receipt);
    expect(db.queries[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(db.queries).toContain('COMMIT');
    expect(db.queries).not.toContain('ROLLBACK');
    expect(db.value.release).toHaveBeenCalledOnce();
  });

  it('rolls back before insertion for an active publication or existing row', async () => {
    const artifacts = fixture();
    const active = client({ activeCount: 1 });
    await expect(executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => active.value },
    )).rejects.toThrow('active_publication_present');
    expect(active.queries).toContain('ROLLBACK');
    expect(active.queries.some((sql) => sql.includes('INSERT INTO'))).toBe(false);

    const existing = client({ currentRows: [databaseRows()[0]] });
    await expect(executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => existing.value },
    )).rejects.toThrow('row_no_longer_missing');
    expect(existing.queries).toContain('ROLLBACK');
    expect(existing.queries.some((sql) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('rolls back a partial insert, postcondition drift, or stale approval', async () => {
    const artifacts = fixture();
    const partial = client({ insertedSources: ['ADSB_LOL'] });
    await expect(executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => partial.value },
    )).rejects.toThrow('insert_failed');
    expect(partial.queries).toContain('ROLLBACK');

    const drift = client({
      postRows: databaseRows().map((row, index) => (
        index === 0 ? { ...row, allowed_content_modes: ['full_ingest'] } : row
      )),
    });
    await expect(executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => drift.value },
    )).rejects.toThrow('postcondition_failed');
    expect(drift.queries).toContain('ROLLBACK');

    const stale = client({ executedAt: '2026-07-27T18:10:00.001Z' });
    await expect(executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => stale.value },
    )).rejects.toThrow('approval_stale');
    expect(stale.queries).toContain('ROLLBACK');
    expect(stale.queries.some((sql) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('rejects a re-sealed broadened receipt against the bound artifacts', async () => {
    const artifacts = fixture();
    const db = client();
    const receipt = await executeApprovedContextualSourceRegistryChange(
      artifacts,
      { getClient: async () => db.value },
    );
    expect(() => verifyContextualSourceRegistryExecutionReceipt({
      ...receipt,
      guarantees: { ...receipt.guarantees, providerCalls: 1 },
    }, artifacts.approval, artifacts.proposal, artifacts.decisionPacket))
      .toThrow('contextual_source_registry_execution_receipt_drift');
  });
});
