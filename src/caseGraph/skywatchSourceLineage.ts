export const SKYWATCH_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-skywatch-source-lineage-v1' as const;
export const SKYWATCH_UPSTREAM_REVISION = 'ee5f6b6185b6ffc9a6f091aeefea94b6bc3bd581' as const;
export const SKYWATCH_UPSTREAM_REPOSITORY = 'https://github.com/MiChaelinzo/SKYWATCH_UAP_SIGTHINGS' as const;

export const SKYWATCH_EVIDENCE_URLS = [
  `${SKYWATCH_UPSTREAM_REPOSITORY}/tree/${SKYWATCH_UPSTREAM_REVISION}`,
  `${SKYWATCH_UPSTREAM_REPOSITORY}/blob/${SKYWATCH_UPSTREAM_REVISION}/pages/api/getData/index.js`,
  `${SKYWATCH_UPSTREAM_REPOSITORY}/blob/${SKYWATCH_UPSTREAM_REVISION}/pages/api/getData2/index.js`,
  `${SKYWATCH_UPSTREAM_REPOSITORY}/blob/${SKYWATCH_UPSTREAM_REVISION}/pages/api/getData3/index.js`,
] as const;

export type SkywatchReviewedLineagePolicy = {
  source: 'SKYWATCH';
  lineageId: 'governance:skywatch:mixed-aggregator';
  sourcePosition: 'secondary';
  originality: 'derived';
  upstreamRepository: typeof SKYWATCH_UPSTREAM_REPOSITORY;
  upstreamRevision: typeof SKYWATCH_UPSTREAM_REVISION;
  recordLevelUpstreamResolved: false;
  independentCorroborationAllowed: false;
  knownExactIdentityOverlap: {
    source: 'RICH_GELREICH_HATCH_UDB';
    rows: 1_000;
  };
  evidenceUrls: typeof SKYWATCH_EVIDENCE_URLS;
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveSkywatchReviewedLineage = (
  sourceValue: string,
): SkywatchReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'SKYWATCH') return null;
  return {
    source: 'SKYWATCH',
    lineageId: 'governance:skywatch:mixed-aggregator',
    sourcePosition: 'secondary',
    originality: 'derived',
    upstreamRepository: SKYWATCH_UPSTREAM_REPOSITORY,
    upstreamRevision: SKYWATCH_UPSTREAM_REVISION,
    recordLevelUpstreamResolved: false,
    independentCorroborationAllowed: false,
    knownExactIdentityOverlap: {
      source: 'RICH_GELREICH_HATCH_UDB',
      rows: 1_000,
    },
    evidenceUrls: SKYWATCH_EVIDENCE_URLS,
  };
};
