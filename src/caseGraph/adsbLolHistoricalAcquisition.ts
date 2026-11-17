import type { ContextualSourceGovernanceDecisionPacket } from './contextualSourceGovernanceDecision';
import { verifyContextualSourceGovernanceDecisionPacket } from './contextualSourceGovernanceDecision';
import type {
  CaseGraphExternalCorrelationGovernanceInspector,
} from './externalCorrelationProviderAdapters';
import {
  verifyAdsbLolHistoricalAssetPreflight,
  type AdsbLolHistoricalAssetPreflight,
} from './adsbLolHistoricalAssetPreflight';
import {
  verifyAdsbLolHistoricalReleasePlan,
  type AdsbLolHistoricalReleasePlan,
} from './adsbLolHistoricalReleasePlan';
import {
  buildAdsbLolHistoricalProviderRecords,
  extractAdsbLolHistoricalTargets,
  type AdsbLolHistoricalExtractionPublicationNode,
  type AdsbLolHistoricalExtractionTarget,
  type AdsbLolHistoricalTargetedExtraction,
} from './adsbLolHistoricalTargetedExtraction';
import {
  materializeAndPublishFreeContextualProviderArchive,
} from './aircraftWeatherProviderRecords';
import type {
  CaseGraphExternalProviderArchiveRecord,
  CaseGraphExternalProviderArchiveTransaction,
} from './providerArchiveExternalCorrelation';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import { persistAdsbLolHistoricalReplayHistory } from './adsbLolHistoricalReplayHistory';

const fail = (code: string): never => { throw new Error(code); };

export type AdsbLolHistoricalAssetGetResponse = {
  status: number;
  headers: { get: (name: string) => string | null };
  body: (AsyncIterable<Uint8Array> & { cancel?: () => Promise<void> }) | null;
};

export type AdsbLolHistoricalAssetGetFetch = (
  url: string,
  init: {
    method: 'GET';
    redirect: 'manual';
    signal?: AbortSignal;
    headers: {
      accept: 'application/octet-stream';
      'accept-encoding': 'identity';
    };
  },
) => Promise<AdsbLolHistoricalAssetGetResponse>;

type Materialize = typeof materializeAndPublishFreeContextualProviderArchive;
type PersistReplayHistory = typeof persistAdsbLolHistoricalReplayHistory;

export type AdsbLolHistoricalAcquisitionDependencies = {
  verifyDecisionPacket: (
    value: ContextualSourceGovernanceDecisionPacket,
  ) => ContextualSourceGovernanceDecisionPacket;
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  fetchAsset: AdsbLolHistoricalAssetGetFetch;
  materialize: Materialize;
  persistReplayHistory: PersistReplayHistory;
};

const defaultDependencies = (
  params: Pick<
    AdsbLolHistoricalAcquisitionDependencies,
    'inspectGovernance' | 'fetchAsset'
  >,
): AdsbLolHistoricalAcquisitionDependencies => ({
  verifyDecisionPacket: verifyContextualSourceGovernanceDecisionPacket,
  inspectGovernance: params.inspectGovernance,
  fetchAsset: params.fetchAsset,
  materialize: materializeAndPublishFreeContextualProviderArchive,
  persistReplayHistory: persistAdsbLolHistoricalReplayHistory,
});

export type AdsbLolHistoricalAcquisitionResult = {
  extraction: AdsbLolHistoricalTargetedExtraction;
  records: CaseGraphExternalProviderArchiveRecord[];
  materialization: Awaited<ReturnType<Materialize>>;
  replayHistory: Awaited<ReturnType<PersistReplayHistory>>;
  guarantees: {
    providerMethod: 'GET';
    rawArchiveFilesWritten: 0;
    derivedProviderArchiveMaterialized: true;
    replayHistoryPersisted: true;
    publicationActivations: 0;
    deployments: 0;
  };
};

export type AdsbLolHistoricalReplayAcquisitionResult = {
  extraction: AdsbLolHistoricalTargetedExtraction;
  replayHistory: Awaited<ReturnType<PersistReplayHistory>>;
  guarantees: {
    providerMethod: 'GET';
    rawArchiveFilesWritten: 0;
    derivedProviderArchiveMaterialized: false;
    replayHistoryPersisted: true;
    publicationActivations: 0;
    deployments: 0;
  };
};

type ExtractionParams = {
  releasePlan: AdsbLolHistoricalReleasePlan;
  preflight: AdsbLolHistoricalAssetPreflight;
  releaseDate: string;
  targets: AdsbLolHistoricalExtractionTarget[];
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  checkedAt: string;
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  fetchAsset: AdsbLolHistoricalAssetGetFetch;
  signal?: AbortSignal;
  verifyDecisionPacket?: AdsbLolHistoricalAcquisitionDependencies['verifyDecisionPacket'];
};

const acquireAdsbLolHistoricalExtraction = async (params: ExtractionParams) => {
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const plan = verifyAdsbLolHistoricalReleasePlan(params.releasePlan);
  const preflight = verifyAdsbLolHistoricalAssetPreflight(params.preflight, plan, params.checkedAt);
  if (!preflight.accounting.executableWithinExactBudget) {
    fail('adsb_lol_acquisition_plan_invalid');
  }
  const selected = preflight.selectedReleases.find(({ date }) => date === params.releaseDate);
  const release = plan.releases.find(({ date }) => date === params.releaseDate);
  if (!selected || !release) fail('adsb_lol_acquisition_release_invalid');
  const selectedRelease = selected as AdsbLolHistoricalAssetPreflight['selectedReleases'][number];
  const decisionPacket = (params.verifyDecisionPacket || verifyContextualSourceGovernanceDecisionPacket)(
    params.decisionPacket,
  );
  const decision = decisionPacket.entries.find((entry) => (
    entry.category === 'aircraft'
    && entry.canonicalSource === 'ADSB_LOL'
    && entry.providerId === 'adsb-lol'
    && entry.requiredContentMode === 'derived_only'
  ));
  const checkedAtMs = Date.parse(params.checkedAt);
  const referenceAtMs = Date.parse(decisionPacket.referenceAt);
  if (!decision?.usableNow || !Number.isFinite(checkedAtMs) || !Number.isFinite(referenceAtMs)
    || checkedAtMs < referenceAtMs
    || checkedAtMs - referenceAtMs > decisionPacket.maximumEvidenceAgeDays * 86_400_000) {
    fail('adsb_lol_acquisition_source_decision_not_approved');
  }
  const governance = await params.inspectGovernance({
    canonicalSource: 'ADSB_LOL',
    category: 'aircraft',
    signal: params.signal,
  });
  if (!governance.present
    || governance.canonicalSource.trim().toUpperCase() !== 'ADSB_LOL'
    || governance.legalStatus.trim().toLowerCase() !== 'approved'
    || !(governance.allowedContentModes || []).map((mode) => mode.toLowerCase())
      .includes('derived_only')) {
    fail('adsb_lol_acquisition_source_registry_not_approved');
  }
  const observations = new Map(
    preflight.observations.map((observation) => [observation.requestedUrl, observation]),
  );
  const assetStreams = selectedRelease.assetUrls.map((assetUrl) => {
    const observation = observations.get(assetUrl);
    if (!observation) fail('adsb_lol_acquisition_asset_set_invalid');
    const expected = observation as AdsbLolHistoricalAssetPreflight['observations'][number];
    return {
      assetUrl,
      chunks: (async function* fetchChunks() {
        if (params.signal?.aborted) fail('case_graph_research_aborted');
        const response = await params.fetchAsset(expected.finalUrl, {
          method: 'GET', redirect: 'manual', signal: params.signal,
          headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
        });
        const rawLength = response.headers.get('content-length');
        const contentEncoding = response.headers.get('content-encoding');
        if (response.status !== 200 || !rawLength || !/^\d+$/u.test(rawLength)
          || Number(rawLength) !== expected.contentLength
          || contentEncoding && contentEncoding.toLowerCase() !== 'identity' || !response.body) {
          await response.body?.cancel?.().catch(() => undefined);
          fail('adsb_lol_acquisition_response_invalid');
        }
        const responseBody = response.body as NonNullable<typeof response.body>;
        let completed = false;
        try {
          for await (const chunk of responseBody) {
            if (params.signal?.aborted) fail('case_graph_research_aborted');
            yield chunk;
          }
          completed = true;
        } finally {
          if (!completed) await responseBody.cancel?.().catch(() => undefined);
        }
      }()),
    };
  });
  const extraction = await extractAdsbLolHistoricalTargets({
    releasePlan: plan,
    preflight,
    releaseDate: params.releaseDate,
    targets: params.targets,
    extractedAt: params.checkedAt,
    assetStreams,
  });
  return {
    plan,
    preflight,
    release: release as AdsbLolHistoricalReleasePlan['releases'][number],
    extraction,
  };
};

export const acquireAndPersistAdsbLolHistoricalReplayRelease = async (params: ExtractionParams & {
  persistReplayHistory?: PersistReplayHistory;
}): Promise<AdsbLolHistoricalReplayAcquisitionResult> => {
  const acquired = await acquireAdsbLolHistoricalExtraction(params);
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const replayHistory = await (params.persistReplayHistory || persistAdsbLolHistoricalReplayHistory)({
    releasePlan: acquired.plan,
    preflight: acquired.preflight,
    extraction: acquired.extraction,
    checkedAt: params.checkedAt,
  });
  return {
    extraction: acquired.extraction,
    replayHistory,
    guarantees: {
      providerMethod: 'GET',
      rawArchiveFilesWritten: 0,
      derivedProviderArchiveMaterialized: false,
      replayHistoryPersisted: true,
      publicationActivations: 0,
      deployments: 0,
    },
  };
};

export const acquireAndMaterializeAdsbLolHistoricalRelease = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  releasePlan: AdsbLolHistoricalReleasePlan;
  preflight: AdsbLolHistoricalAssetPreflight;
  releaseDate: string;
  targets: AdsbLolHistoricalExtractionTarget[];
  nodes: AdsbLolHistoricalExtractionPublicationNode[];
  decisionPacket: ContextualSourceGovernanceDecisionPacket;
  checkedAt: string;
  inspectGovernance: CaseGraphExternalCorrelationGovernanceInspector;
  fetchAsset: AdsbLolHistoricalAssetGetFetch;
  transaction: CaseGraphExternalProviderArchiveTransaction;
  putArchiveObject: Parameters<Materialize>[0]['putArchiveObject'];
  verifyArchiveObject: Parameters<Materialize>[0]['verifyArchiveObject'];
  signal?: AbortSignal;
  dependencies?: Partial<Pick<
    AdsbLolHistoricalAcquisitionDependencies,
    'verifyDecisionPacket' | 'materialize'
    | 'persistReplayHistory'
  >>;
}): Promise<AdsbLolHistoricalAcquisitionResult> => {
  const dependencies = {
    ...defaultDependencies({
      inspectGovernance: params.inspectGovernance,
      fetchAsset: params.fetchAsset,
    }),
    ...params.dependencies,
  };
  const acquired = await acquireAdsbLolHistoricalExtraction({
    releasePlan: params.releasePlan,
    preflight: params.preflight,
    releaseDate: params.releaseDate,
    targets: params.targets,
    decisionPacket: params.decisionPacket,
    checkedAt: params.checkedAt,
    inspectGovernance: dependencies.inspectGovernance,
    fetchAsset: dependencies.fetchAsset,
    signal: params.signal,
    verifyDecisionPacket: dependencies.verifyDecisionPacket,
  });
  const { plan, preflight, release: plannedRelease, extraction } = acquired;
  if (!plan.publication
    || params.publication.publicationId !== plan.publication.publicationId
    || params.publication.manifestSha256 !== plan.publication.manifestSha256) {
    fail('adsb_lol_acquisition_plan_invalid');
  }
  const records = buildAdsbLolHistoricalProviderRecords({
    publication: params.publication,
    snapshotId: params.snapshotId,
    releasePlan: plan,
    preflight,
    extraction,
    nodes: params.nodes,
    checkedAt: params.checkedAt,
  });
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const start = `${params.releaseDate}T00:00:00.000Z`;
  const end = `${params.releaseDate}T23:59:59.999Z`;
  const materialization = await dependencies.materialize({
    snapshot: {
      snapshotId: params.snapshotId,
      publication: params.publication,
      category: 'aircraft',
      canonicalSource: 'ADSB_LOL',
      contentMode: 'derived_only',
      providerId: 'adsb-lol',
      datasetVersion:
        `historical-trace-v1:${params.releaseDate}:${extraction.extractionDigest.slice(0, 16)}`,
      coverageStart: start,
      coverageEnd: end,
      acquiredAt: params.checkedAt,
      sourceUrl: plannedRelease.releasePageUrl,
      license: 'ODbL-1.0',
    },
    records,
    transaction: params.transaction,
    putArchiveObject: params.putArchiveObject,
    verifyArchiveObject: params.verifyArchiveObject,
    signal: params.signal,
  });
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const replayHistory = await dependencies.persistReplayHistory({
    releasePlan: plan,
    preflight,
    extraction,
    checkedAt: params.checkedAt,
  });
  return {
    extraction,
    records,
    materialization,
    replayHistory,
    guarantees: {
      providerMethod: 'GET',
      rawArchiveFilesWritten: 0,
      derivedProviderArchiveMaterialized: true,
      replayHistoryPersisted: true,
      publicationActivations: 0,
      deployments: 0,
    },
  };
};
