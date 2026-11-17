import { describe, expect, it } from 'vitest';

import {
  buildContextualSourceRegistryApproval,
  verifyContextualSourceRegistryApproval,
} from '../../src/caseGraph/contextualSourceRegistryApproval';
import {
  buildContextualSourceGovernanceResearchPacket,
} from '../../src/caseGraph/contextualSourceGovernanceResearchCatalogue';
import {
  buildContextualSourceRegistryProposal,
  contextualSourceRegistryProposalApprovalStatement,
} from '../../src/caseGraph/contextualSourceRegistryProposal';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const packet = () => buildContextualSourceGovernanceResearchPacket({
  referenceAt: '2026-07-27T17:00:00.000Z',
  registryInspectedAt: '2026-07-27T16:59:00.000Z',
  registryRows: [],
});

const fixture = () => {
  const decisionPacket = packet();
  const proposal = buildContextualSourceRegistryProposal({
    decisionPacket,
    createdAt: '2026-07-27T17:05:00.000Z',
  });
  return { decisionPacket, proposal };
};

describe('contextual source registry approval', () => {
  it('binds exact operator authority while keeping every broader action false', () => {
    const { decisionPacket, proposal } = fixture();
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
    expect(verifyContextualSourceRegistryApproval(
      approval,
      proposal,
      decisionPacket,
    )).toEqual(approval);
    expect(approval).toMatchObject({
      proposalDigest: proposal.proposalDigest,
      decisionPacketDigest: decisionPacket.packetDigest,
      registryChangeApproved: true,
      providerCallsApproved: false,
      archivalWritesApproved: false,
      publicationActivationApproved: false,
      deploymentApproved: false,
    });
  });

  it('rejects paraphrased, broadened, or substituted authority', () => {
    const { decisionPacket, proposal } = fixture();
    const input = {
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
    };
    expect(() => buildContextualSourceRegistryApproval({
      ...input,
      authorizationStatement: 'permission given',
    })).toThrow('contextual_source_registry_approval_scope_invalid');
    expect(() => buildContextualSourceRegistryApproval({
      ...input,
      providerCallsApproved: true,
    })).toThrow('contextual_source_registry_approval_scope_invalid');

    const approval = buildContextualSourceRegistryApproval(input);
    const changed = {
      ...approval,
      deploymentApproved: true,
    };
    changed.approvalDigest = relationshipInputSha256(
      Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'approvalDigest')),
    );
    expect(() => verifyContextualSourceRegistryApproval(
      changed,
      proposal,
      decisionPacket,
    )).toThrow('contextual_source_registry_approval_scope_invalid');

    const substitutedPacket = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T17:01:00.000Z',
      registryInspectedAt: '2026-07-27T16:59:00.000Z',
      registryRows: [],
    });
    expect(() => verifyContextualSourceRegistryApproval(
      approval,
      proposal,
      substitutedPacket,
    )).toThrow();
  });
});
