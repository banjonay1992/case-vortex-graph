import {
  assertContextualRelationshipCompletionProductionEligible,
  type ContextualRelationshipCompletionEntry,
} from './contextualRelationshipCompletion';
import type { RelationshipInputUniverseBinding } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import type {
  CaseGraphExternalCorrelationAdapterOutcome,
  CaseGraphExternalCorrelationCandidateInput,
  CaseGraphExternalCorrelationProviderAdapter,
} from './externalCorrelationProviderAdapters';

const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const contentAddressedUuid = (sha256: string) => {
  const chars = sha256.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = (8 + (Number.parseInt(chars[16], 16) % 4)).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const entryEvaluation = (entry: ContextualRelationshipCompletionEntry) => (
  entry.status === 'accepted_edge'
    ? entry.typedEdge.receipt.contextualEvaluation || fail('contextual_external_correlation_evaluation_missing')
    : entry.insufficientReceipt.contextualEvaluation
);

const candidateFromEntry = (
  entry: Extract<ContextualRelationshipCompletionEntry, { status: 'accepted_edge' }>,
): CaseGraphExternalCorrelationCandidateInput => {
  const evaluation = entry.typedEdge.receipt.contextualEvaluation
    || fail('contextual_external_correlation_evaluation_missing');
  const reasonCodes = [...new Set([
    'governed_contextual_candidate',
    ...entry.typedEdge.receipt.reasons.map(({ code }) => code),
  ])].sort(compare).slice(0, 24);
  return {
    sourceRecordId: entry.entryId,
    label: `${evaluation.kind} candidate: ${evaluation.contextReferenceId}`,
    observedAt: null,
    measurements: {
      evidence_strength: entry.typedEdge.strength,
      passed_check_count: evaluation.checks.filter(({ status }) => status === 'pass').length,
      failed_check_count: evaluation.failedChecks.length,
    },
    reasonCodes,
    explanation: evaluation.plainEnglish,
    uncertainty: [...new Set(entry.typedEdge.receipt.uncertainty.reasons)].sort(compare).slice(0, 24),
  };
};

/**
 * Adapts one exact source snapshot from the production-eligible contextual
 * completion artifact. Legal approval remains a separate outer gate via
 * createGovernedExternalCorrelationProviderAdapter.
 */
export const createVerifiedContextualExternalCorrelationAdapter = (params: {
  publication: CaseGraphResearchPublicationBinding;
  artifact: unknown;
  expectedBinding: RelationshipInputUniverseBinding;
  expectedCalibration: { receiptId: string; receiptSha256: string };
  sourceSnapshotDigest: string;
  sourceUrl: string | null;
  license: string | null;
}): CaseGraphExternalCorrelationProviderAdapter => {
  const artifact = assertContextualRelationshipCompletionProductionEligible(
    params.artifact,
    params.expectedBinding,
    params.expectedCalibration,
  );
  if (artifact.binding.snapshotId !== params.publication.snapshotId
    || artifact.binding.corpusVersion !== params.publication.corpusVersion) {
    fail('contextual_external_correlation_publication_mismatch');
  }
  const source = artifact.sources.find(({ snapshot }) => snapshot.snapshotDigest === params.sourceSnapshotDigest)
    || fail('contextual_external_correlation_source_missing');
  const entries = artifact.entries.filter((entry) => entry.sourceSnapshotDigest === source.snapshot.snapshotDigest);
  const entriesByAddress = new Map<string, ContextualRelationshipCompletionEntry[]>();
  for (const entry of entries) {
    const current = entriesByAddress.get(entry.address) || [];
    current.push(entry);
    entriesByAddress.set(entry.address, current);
  }
  const externalSource = {
    snapshotId: contentAddressedUuid(source.snapshot.snapshotDigest),
    providerId: source.snapshot.providerId,
    datasetVersion: source.snapshot.datasetVersion,
    coverageStart: source.snapshot.coverageWindow.start,
    coverageEnd: source.snapshot.coverageWindow.end,
    acquiredAt: source.snapshot.materializedAt,
    sourceUrl: params.sourceUrl,
    license: params.license,
    receiptSha256: source.sourceCompletionDigest,
  };
  return {
    category: source.snapshot.kind,
    correlate: async (request): Promise<CaseGraphExternalCorrelationAdapterOutcome> => {
      if (request.signal?.aborted) fail('case_graph_research_aborted');
      if (request.publication.publicationId !== params.publication.publicationId
        || request.publication.manifestSha256 !== params.publication.manifestSha256) {
        fail('contextual_external_correlation_publication_mismatch');
      }
      const addressEntries = (entriesByAddress.get(request.address) || []).sort((left, right) => compare(left.entryId, right.entryId));
      if (!addressEntries.length) return {
        availability: 'unavailable',
        reasonCodes: ['contextual_address_not_assessed'],
        explanation: `The verified ${source.snapshot.kind} snapshot contains no assessment for this record; the category was not ruled out.`,
        source: externalSource,
        candidates: [],
      };
      if (addressEntries.some((entry) => entry.relationshipRecordDigest !== request.nodeDigest)) {
        fail('contextual_external_correlation_node_mismatch');
      }
      const accepted = addressEntries.filter((entry): entry is Extract<ContextualRelationshipCompletionEntry, { status: 'accepted_edge' }> => (
        entry.status === 'accepted_edge'
      ));
      if (accepted.length) return {
        availability: 'available',
        reasonCodes: ['verified_contextual_snapshot_checked'],
        explanation: `${accepted.length} bounded ${source.snapshot.kind} candidate comparison${accepted.length === 1 ? '' : 's'} passed the governed contextual policy; none is a causal identification.`,
        source: externalSource,
        candidates: accepted.slice(0, request.limit).map(candidateFromEntry),
      };
      const evaluation = entryEvaluation(addressEntries[0]);
      return {
        availability: 'insufficient_evidence',
        reasonCodes: [...new Set(['verified_contextual_snapshot_checked', ...evaluation.failedChecks])].sort(compare).slice(0, 24),
        explanation: evaluation.plainEnglish,
        source: externalSource,
        candidates: [],
      };
    },
  };
};
