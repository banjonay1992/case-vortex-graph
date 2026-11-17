export const RICH_GELREICH_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-rich-gelreich-source-lineage-v1' as const;
export const RICH_GELREICH_UPSTREAM_REVISION = '6da778b4e714a0bb0b668365172ccfcbf3c96def' as const;
export const RICH_GELREICH_UPSTREAM_REPOSITORY = 'https://github.com/richgel999/ufo_data' as const;

const LINEAGE_BY_SOURCE = {
  ANONYMOUS_PDF_PUBLIC_DOMAIN: 'governance:rich-gelreich:anon-pdf',
  EBERHART_TIMELINE: 'governance:rich-gelreich:eberhart',
  GODELIEVE_VAN_OVERMEIRE: 'governance:rich-gelreich:overmeire',
  PASSPORT_TO_MAGONIA: 'governance:rich-gelreich:magonia',
  RICH_GELREICH_ANCIENT: 'governance:rich-gelreich:ancient',
  RICH_GELREICH_ANON_PDF: 'governance:rich-gelreich:anon-pdf',
  RICH_GELREICH_BB_UNKNOWNS: 'governance:rich-gelreich:blue-book-unknowns',
  RICH_GELREICH_DOLAN: 'governance:rich-gelreich:dolan',
  RICH_GELREICH_EBERHART: 'governance:rich-gelreich:eberhart',
  RICH_GELREICH_EBERHART_OPENAI: 'governance:rich-gelreich:eberhart',
  RICH_GELREICH_HATCH_UDB: 'governance:rich-gelreich:hatch-udb',
  RICH_GELREICH_HOSTILE: 'governance:rich-gelreich:hostile',
  RICH_GELREICH_JOHNSON: 'governance:rich-gelreich:johnson',
  RICH_GELREICH_MAGONIA: 'governance:rich-gelreich:magonia',
  RICH_GELREICH_MAJ2: 'governance:rich-gelreich:maj2',
  RICH_GELREICH_MUT: 'governance:rich-gelreich:mut',
  RICH_GELREICH_NICAP: 'governance:rich-gelreich:nicap',
  RICH_GELREICH_NUCLEAR: 'governance:rich-gelreich:nuclear-tests',
  RICH_GELREICH_OPENAI_RESULTS: 'governance:rich-gelreich:mixed-openai-results',
  RICH_GELREICH_OVERMEIRE: 'governance:rich-gelreich:overmeire',
  RICH_GELREICH_PRE_ROSWELL: 'governance:rich-gelreich:pre-roswell',
  RICH_GELREICH_RR0: 'governance:rich-gelreich:rr0',
  RICH_GELREICH_SCULLY: 'governance:rich-gelreich:scully',
  RICH_GELREICH_TRACE: 'governance:rich-gelreich:trace',
  RICH_GELREICH_UFO_EVIDENCE: 'governance:rich-gelreich:ufo-evidence',
  RR0_GNU_FDL: 'governance:rich-gelreich:rr0',
} as const;

type RichGelreichReviewedSource = keyof typeof LINEAGE_BY_SOURCE;

export type RichGelreichReviewedLineagePolicy = {
  source: RichGelreichReviewedSource;
  lineageId: typeof LINEAGE_BY_SOURCE[RichGelreichReviewedSource];
  sourcePosition: 'secondary';
  originality: 'derived';
  upstreamRepository: typeof RICH_GELREICH_UPSTREAM_REPOSITORY;
  upstreamRevision: typeof RICH_GELREICH_UPSTREAM_REVISION;
  independentCorroborationAllowed: false;
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveRichGelreichReviewedLineage = (
  sourceValue: string,
): RichGelreichReviewedLineagePolicy | null => {
  const source = normalize(sourceValue) as RichGelreichReviewedSource;
  const lineageId = LINEAGE_BY_SOURCE[source];
  if (!lineageId) return null;
  return {
    source,
    lineageId,
    sourcePosition: 'secondary',
    originality: 'derived',
    upstreamRepository: RICH_GELREICH_UPSTREAM_REPOSITORY,
    upstreamRevision: RICH_GELREICH_UPSTREAM_REVISION,
    independentCorroborationAllowed: false,
  };
};
