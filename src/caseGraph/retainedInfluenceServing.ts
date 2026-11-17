import { getCaseVortexRetainedInfluenceServingBundleKey } from './archiveKeys';
import {
  createPostgresRetainedInfluenceSearchProvider,
  inspectPostgresRetainedInfluenceServing,
  type RetainedInfluencePostgresQuery,
} from './postgresRetainedInfluence';
import {
  verifyRetainedCorpusInfluenceReceipt,
  type RetainedCorpusInfluenceReceipt,
} from './retainedCorpusInfluence';
import type {
  ActiveCaseGraphPublication,
  CaseGraphPublicStorage,
} from './publicAccess';
import type {
  PostgresCaseGraphResearchSearchRuntime,
} from './postgresResearchSearch';
import type {
  EvidenceUniverseSourceCensusReceipt,
} from './postgresEvidenceUniverseSnapshot';
import type {
  SourceGovernanceLedgerReceipt,
} from './postgresSourceGovernanceLedger';
import type { CaseGraphResearchSearchProvider } from './researchToolContract';

export const RETAINED_INFLUENCE_SERVING_BUNDLE_VERSION =
  'case-vortex-retained-influence-serving-bundle-v1' as const;
export const RETAINED_INFLUENCE_SERVING_BUNDLE_MAX_BYTES = 4 * 1024 * 1024;

export type RetainedInfluenceServingBundle = {
  schemaVersion: typeof RETAINED_INFLUENCE_SERVING_BUNDLE_VERSION;
  censusReceipt: EvidenceUniverseSourceCensusReceipt;
  sourceGovernanceReceipt: SourceGovernanceLedgerReceipt;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
};

const fail = (code: string): never => { throw new Error(code); };

export const encodeRetainedInfluenceServingBundle = (
  bundle: RetainedInfluenceServingBundle,
) => Buffer.from(`${JSON.stringify(bundle)}\n`, 'utf8');

export const decodeRetainedInfluenceServingBundle = (
  body: Buffer,
): RetainedInfluenceServingBundle => {
  if (!body.length || body.length > RETAINED_INFLUENCE_SERVING_BUNDLE_MAX_BYTES) {
    return fail('retained_influence_serving_bundle_invalid');
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(body.toString('utf8'));
  } catch {
    return fail('retained_influence_serving_bundle_invalid');
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return fail('retained_influence_serving_bundle_invalid');
  }
  const raw = candidate as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  if (keys.length !== 4
    || keys.some((key, index) => key !== [
      'censusReceipt',
      'influenceReceipt',
      'schemaVersion',
      'sourceGovernanceReceipt',
    ][index])
    || raw.schemaVersion !== RETAINED_INFLUENCE_SERVING_BUNDLE_VERSION) {
    return fail('retained_influence_serving_bundle_invalid');
  }
  const influenceReceipt = verifyRetainedCorpusInfluenceReceipt(
    raw.influenceReceipt,
    raw.censusReceipt,
    raw.sourceGovernanceReceipt,
  );
  const bundle: RetainedInfluenceServingBundle = {
    schemaVersion: RETAINED_INFLUENCE_SERVING_BUNDLE_VERSION,
    censusReceipt: raw.censusReceipt as EvidenceUniverseSourceCensusReceipt,
    sourceGovernanceReceipt: raw.sourceGovernanceReceipt as SourceGovernanceLedgerReceipt,
    influenceReceipt,
  };
  if (!body.equals(encodeRetainedInfluenceServingBundle(bundle))) {
    return fail('retained_influence_serving_bundle_invalid');
  }
  return bundle;
};

export type PreparedRetainedInfluenceServing = {
  verified: true;
  bundleKey: string;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
  provider: CaseGraphResearchSearchProvider;
  accounting: RetainedCorpusInfluenceReceipt['influenceLaneCounts'];
};

export const resolveVerifiedResearchSearchProvider = (
  current: CaseGraphResearchSearchProvider | undefined,
  inspection: unknown,
): CaseGraphResearchSearchProvider => {
  if (!inspection || typeof inspection !== 'object'
    || (inspection as { verified?: unknown }).verified !== true) {
    return fail('case_graph_research_search_unavailable');
  }
  const prepared = (inspection as { provider?: unknown }).provider;
  const provider = current || (typeof prepared === 'function'
    ? prepared as CaseGraphResearchSearchProvider
    : undefined);
  return provider || fail('case_graph_research_search_unavailable');
};

/**
 * Prepare one fail-closed search provider. Evidence search and retained
 * influence must both verify against the same active publication before this
 * returns a provider to a route.
 */
export const prepareRetainedInfluenceServing = async (params: {
  active: ActiveCaseGraphPublication;
  storage: CaseGraphPublicStorage;
  query: RetainedInfluencePostgresQuery;
  evidenceRuntime: PostgresCaseGraphResearchSearchRuntime;
  signal?: AbortSignal;
}): Promise<PreparedRetainedInfluenceServing> => {
  const bundleKey = getCaseVortexRetainedInfluenceServingBundleKey(
    params.active.corpusVersion,
    params.active.publicationId,
    params.active.manifestSha256,
  );
  const [body] = await Promise.all([
    params.storage.readObject(bundleKey, {
      maxBytes: RETAINED_INFLUENCE_SERVING_BUNDLE_MAX_BYTES,
      signal: params.signal,
    }),
    params.evidenceRuntime.preflight(params.active, params.signal),
  ]);
  const bundle = decodeRetainedInfluenceServingBundle(
    body === null ? fail('retained_influence_serving_bundle_missing') : body,
  );
  await inspectPostgresRetainedInfluenceServing({
    active: params.active,
    influenceReceipt: bundle.influenceReceipt,
    query: params.query,
    signal: params.signal,
  });
  return {
    verified: true,
    bundleKey,
    influenceReceipt: bundle.influenceReceipt,
    provider: createPostgresRetainedInfluenceSearchProvider({
      evidenceSearch: params.evidenceRuntime.search,
      influenceReceipt: bundle.influenceReceipt,
      query: params.query,
    }),
    accounting: { ...bundle.influenceReceipt.influenceLaneCounts },
  };
};
