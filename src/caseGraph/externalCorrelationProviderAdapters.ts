import {
  CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES,
  CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
  verifyCaseGraphExternalCorrelationResult,
  type CaseGraphExternalCorrelationAvailability,
  type CaseGraphExternalCorrelationCandidate,
  type CaseGraphExternalCorrelationCategory,
  type CaseGraphExternalCorrelationResult,
  type CaseGraphExternalCorrelationSource,
} from './externalCorrelation';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import {
  publishCaseGraphExternalCorrelationPublication,
  type CaseGraphExternalCorrelationPublicationTransaction,
} from './externalCorrelationPublication';
import {
  verifyContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';

export type CaseGraphExternalCorrelationCandidateInput = Omit<
  CaseGraphExternalCorrelationCandidate,
  'candidateId' | 'candidateDigest' | 'category'
>;

export type CaseGraphExternalCorrelationAdapterOutcome = {
  availability: CaseGraphExternalCorrelationAvailability;
  reasonCodes: string[];
  explanation: string;
  source: CaseGraphExternalCorrelationSource | null;
  candidates: CaseGraphExternalCorrelationCandidateInput[];
};

export type CaseGraphExternalCorrelationProviderAdapter = {
  category: CaseGraphExternalCorrelationCategory;
  correlate: (params: {
    publication: CaseGraphResearchPublicationBinding;
    address: string;
    nodeDigest: string;
    limit: number;
    checkedAt: string;
    signal?: AbortSignal;
  }) => Promise<CaseGraphExternalCorrelationAdapterOutcome>;
};

export type CaseGraphExternalCorrelationGovernanceDecision = {
  present: boolean;
  canonicalSource: string;
  legalStatus: 'approved' | 'review' | 'blocked' | 'restricted' | string;
  allowedContentModes: string[] | null;
};

export type CaseGraphExternalCorrelationGovernanceInspector = (params: {
  canonicalSource: string;
  category: CaseGraphExternalCorrelationCategory;
  signal?: AbortSignal;
}) => Promise<CaseGraphExternalCorrelationGovernanceDecision>;

const unavailable = (reasonCode: string, explanation: string): CaseGraphExternalCorrelationAdapterOutcome => ({
  availability: 'unavailable', reasonCodes: [reasonCode], explanation, source: null, candidates: [],
});

/**
 * Gates a concrete provider adapter against the source legal registry. The
 * wrapper deliberately requires an explicit allowed mode; an empty or missing
 * mode list is not treated as permission for external-correlation publishing.
 */
export const createGovernedExternalCorrelationProviderAdapter = (params: {
  category: CaseGraphExternalCorrelationCategory;
  canonicalSource: string;
  providerId: string;
  allowedContentModes: string[];
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  correlate: CaseGraphExternalCorrelationProviderAdapter['correlate'];
}): CaseGraphExternalCorrelationProviderAdapter => {
  const canonicalSource = params.canonicalSource.trim().toUpperCase();
  const providerId = params.providerId.trim();
  const allowedContentModes = [...new Set(params.allowedContentModes.map((mode) => mode.trim().toLowerCase()))];
  if (!canonicalSource || !providerId || !allowedContentModes.length || allowedContentModes.some((mode) => !mode)) {
    fail('case_graph_external_correlation_governance_plan_invalid');
  }
  return {
    category: params.category,
    correlate: async (request) => {
      if (request.signal?.aborted) fail('case_graph_research_aborted');
      let governance: CaseGraphExternalCorrelationGovernanceDecision;
      try {
        governance = await params.inspectGovernance({
          canonicalSource,
          category: params.category,
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal?.aborted || errorCode(error) === 'case_graph_research_aborted') {
          fail('case_graph_research_aborted');
        }
        return unavailable(
          'source_governance_unavailable',
          `The legal-registry decision for ${canonicalSource} could not be verified; ${params.category.replace(/_/g, ' ')} was not checked or ruled out.`,
        );
      }
      if (!governance.present || governance.canonicalSource.trim().toUpperCase() !== canonicalSource) {
        return unavailable(
          'source_governance_missing',
          `${canonicalSource} has no matching legal-registry decision; ${params.category.replace(/_/g, ' ')} was not checked or ruled out.`,
        );
      }
      if (governance.legalStatus.trim().toLowerCase() !== 'approved') {
        return unavailable(
          'source_governance_not_approved',
          `${canonicalSource} is not approved for governed use; ${params.category.replace(/_/g, ' ')} was not checked or ruled out.`,
        );
      }
      const governedModes = new Set((governance.allowedContentModes || []).map((mode) => mode.trim().toLowerCase()));
      if (!allowedContentModes.some((mode) => governedModes.has(mode))) {
        return unavailable(
          'source_governance_mode_not_approved',
          `${canonicalSource} is not approved for the required content mode; ${params.category.replace(/_/g, ' ')} was not checked or ruled out.`,
        );
      }
      if (request.signal?.aborted) fail('case_graph_research_aborted');
      const outcome = await params.correlate(request);
      if (outcome.source && outcome.source.providerId !== providerId) {
        return unavailable(
          'provider_snapshot_identity_mismatch',
          `The ${canonicalSource} snapshot identity did not match the configured provider; ${params.category.replace(/_/g, ' ')} was not checked or ruled out.`,
        );
      }
      return outcome;
    },
  };
};

/**
 * Adds a reproducible source-research decision in front of the live legal
 * registry gate. Both gates must approve the exact provider, category and
 * content mode before the concrete connector can run.
 */
export const createDecisionPacketGovernedExternalCorrelationProviderAdapter = (params: {
  category: CaseGraphExternalCorrelationCategory;
  canonicalSource: string;
  providerId: string;
  requiredContentMode: 'full_ingest' | 'metadata_only' | 'derived_only';
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  correlate: CaseGraphExternalCorrelationProviderAdapter['correlate'];
}): CaseGraphExternalCorrelationProviderAdapter => {
  const packet = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  const canonicalSource = params.canonicalSource.trim().toUpperCase();
  const providerId = params.providerId.trim().toLowerCase();
  const matches = packet.entries.filter((entry) => (
    entry.category === params.category
    && entry.canonicalSource === canonicalSource
    && entry.providerId === providerId
    && entry.requiredContentMode === params.requiredContentMode
  ));
  if (!canonicalSource || !providerId || matches.length > 1) {
    fail('case_graph_external_correlation_governance_plan_invalid');
  }
  const decision = matches[0] || null;
  const governed = createGovernedExternalCorrelationProviderAdapter({
    category: params.category,
    canonicalSource,
    providerId,
    allowedContentModes: [params.requiredContentMode],
    inspectGovernance: params.inspectGovernance,
    correlate: params.correlate,
  });
  return {
    category: params.category,
    correlate: async (request) => {
      if (request.signal?.aborted) fail('case_graph_research_aborted');
      if (!decision) {
        return unavailable(
          'source_decision_missing',
          `No signed source decision covers ${canonicalSource}/${providerId} for ${params.category.replace(/_/g, ' ')}; the provider was not called.`,
        );
      }
      const checkedAtMs = Date.parse(request.checkedAt);
      const referenceAtMs = Date.parse(packet.referenceAt);
      if (!Number.isFinite(checkedAtMs) || checkedAtMs < referenceAtMs
        || checkedAtMs - referenceAtMs > packet.maximumEvidenceAgeDays * 86_400_000) {
        return unavailable(
          'source_decision_packet_stale',
          `The signed source decision for ${canonicalSource} is outside its review window; the provider was not called.`,
        );
      }
      if (!decision.usableNow) {
        return unavailable(
          `source_decision_${decision.decision}`,
          `${canonicalSource} is ${decision.decision.replace(/_/g, ' ')} (${decision.reasonCodes.join(', ')}); the provider was not called and this category was not ruled out.`,
        );
      }
      return governed.correlate(request);
    },
  };
};

const fail = (code: string): never => { throw new Error(code); };
const errorCode = (error: unknown) => {
  const value = String((error as Error)?.message || error || '').toLowerCase();
  return value === 'case_graph_research_aborted' ? value : 'provider_adapter_failed';
};

export const buildCaseGraphExternalCorrelationResultFromAdapters = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  nodeDigest: string;
  adapters: CaseGraphExternalCorrelationProviderAdapter[];
  limitPerCategory: number;
  checkedAt: string;
  signal?: AbortSignal;
}): Promise<CaseGraphExternalCorrelationResult> => {
  if (!/^[a-f0-9]{64}$/.test(params.nodeDigest)
    || !Number.isSafeInteger(params.limitPerCategory) || params.limitPerCategory < 1
    || params.limitPerCategory > 100
    || !Number.isFinite(Date.parse(params.checkedAt))
    || new Set(params.adapters.map(({ category }) => category)).size !== params.adapters.length
    || params.adapters.some(({ category }) => !CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.includes(category))) {
    fail('case_graph_external_correlation_adapter_plan_invalid');
  }
  const adapters = new Map(params.adapters.map((adapter) => [adapter.category, adapter]));
  const assessments = [];
  for (const category of CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const adapter = adapters.get(category);
    let outcome: CaseGraphExternalCorrelationAdapterOutcome;
    if (!adapter) {
      outcome = {
        availability: 'unavailable', reasonCodes: ['governed_provider_unavailable'],
        explanation: `No governed ${category.replace(/_/g, ' ')} provider snapshot is configured for this publication.`,
        source: null, candidates: [],
      };
    } else {
      try {
        outcome = await adapter.correlate({
          publication: params.publication, address: params.address, nodeDigest: params.nodeDigest,
          limit: params.limitPerCategory, checkedAt: params.checkedAt, signal: params.signal,
        });
      } catch (error) {
        const code = errorCode(error);
        if (code === 'case_graph_research_aborted' || params.signal?.aborted) fail('case_graph_research_aborted');
        outcome = {
          availability: 'unavailable', reasonCodes: [code],
          explanation: `The governed ${category.replace(/_/g, ' ')} adapter failed closed; this category was not ruled out.`,
          source: null, candidates: [],
        };
      }
    }
    const candidates = outcome.candidates.slice(0, params.limitPerCategory).map((candidate) => {
      const core = { category, ...candidate };
      const candidateDigest = relationshipInputSha256(core);
      return { candidateId: `external-correlation:${candidateDigest}`, ...core, candidateDigest };
    });
    const assessmentCore = {
      category,
      availability: outcome.availability,
      reasonCodes: [...new Set(outcome.reasonCodes)].sort(),
      explanation: outcome.explanation,
      source: outcome.source,
      candidates,
      checkedAt: new Date(params.checkedAt).toISOString(),
    };
    assessments.push({ ...assessmentCore, assessmentDigest: relationshipInputSha256(assessmentCore) });
  }
  const core = {
    recordType: 'case_graph_external_correlation_result' as const,
    schemaVersion: CASE_GRAPH_EXTERNAL_CORRELATION_VERSION,
    publication: params.publication,
    address: params.address,
    assessments,
    limitations: [
      'External correlations are candidate comparisons, not identifications, causal explanations, debunking conclusions, or origin assessments.',
      'Unavailable, stale or insufficient provider coverage must not be interpreted as the category having been ruled out.',
    ],
  };
  return verifyCaseGraphExternalCorrelationResult({
    value: { ...core, resultDigest: relationshipInputSha256(core) },
    publication: params.publication,
    address: params.address,
    categories: [...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES],
    limitPerCategory: params.limitPerCategory,
  });
};

export type CaseGraphExternalCorrelationPublicationNode = {
  address: string;
  nodeDigest: string;
};

export type CaseGraphExternalCorrelationBuildProgress = {
  completed: number;
  total: number;
  address: string;
};

/**
 * Builds the complete nine-category assessment for every published node before
 * opening the publication transaction. A failed or cancelled build therefore
 * cannot leave a partially published correlation set behind.
 */
export const buildAndPublishCaseGraphExternalCorrelations = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  nodes: CaseGraphExternalCorrelationPublicationNode[];
  adapters: CaseGraphExternalCorrelationProviderAdapter[];
  limitPerCategory: number;
  checkedAt: string;
  transaction: CaseGraphExternalCorrelationPublicationTransaction;
  signal?: AbortSignal;
  onProgress?: (progress: CaseGraphExternalCorrelationBuildProgress) => void;
  publish?: typeof publishCaseGraphExternalCorrelationPublication;
}) => {
  if (!params.nodes.length || params.nodes.length > 1_000_000
    || new Set(params.nodes.map(({ address }) => address)).size !== params.nodes.length) {
    fail('case_graph_external_correlation_adapter_plan_invalid');
  }
  const records = [];
  for (const node of params.nodes) {
    if (params.signal?.aborted) fail('case_graph_research_aborted');
    const result = await buildCaseGraphExternalCorrelationResultFromAdapters({
      publication: params.publication,
      address: node.address,
      nodeDigest: node.nodeDigest,
      adapters: params.adapters,
      limitPerCategory: params.limitPerCategory,
      checkedAt: params.checkedAt,
      signal: params.signal,
    });
    records.push({ nodeDigest: node.nodeDigest, result });
    params.onProgress?.({ completed: records.length, total: params.nodes.length, address: node.address });
  }
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  return (params.publish || publishCaseGraphExternalCorrelationPublication)({
    publication: params.publication,
    records,
    limitPerCategory: params.limitPerCategory,
    transaction: params.transaction,
    signal: params.signal,
  });
};
