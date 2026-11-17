import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_SOURCE_REGISTRY_VERSION,
  caseGraphSourcesShareLineage,
  resolveCaseGraphSource,
} from '../../src/caseGraph/sourceRegistry';

describe('Case Graph governed source registry', () => {
  it('resolves source aliases to stable families and lineages', () => {
    expect(CASE_GRAPH_SOURCE_REGISTRY_VERSION).toBe('case-graph-sources-v1');
    expect(resolveCaseGraphSource('All-domain Anomaly Resolution Office')).toMatchObject({ id: 'aaro', family: 'official', lineageId: 'aaro' });
    expect(resolveCaseGraphSource('UFOCAT')).toMatchObject({ id: 'cufos_ufocat', family: 'research', role: 'archive' });
    expect(resolveCaseGraphSource('UFO Finder')).toMatchObject({ id: 'ufo_finder', family: 'community', dependencyRisk: 'high' });
    expect(resolveCaseGraphSource('UK Airprox Board')).toMatchObject({
      id: 'uk_airprox', family: 'official', role: 'originator', dependencyRisk: 'medium',
    });
    expect(resolveCaseGraphSource('FR_GEIPAN')).toMatchObject({
      id: 'geipan', family: 'official', role: 'originator', dependencyRisk: 'medium',
    });
    expect(resolveCaseGraphSource('CISUCAT2')).toMatchObject({
      id: 'cisu', family: 'research', role: 'aggregator', dependencyRisk: 'high',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    expect(resolveCaseGraphSource('Project Hessdalen')).toMatchObject({
      id: 'hessdalen', family: 'research', role: 'archive', dependencyRisk: 'medium',
    });
    expect(resolveCaseGraphSource('Revista UFO')).toMatchObject({
      id: 'revista_ufo', family: 'curated', role: 'editorial', dependencyRisk: 'high',
      lineageId: 'governance:revista-ufo:editorial-avistamentos-category',
    });
    expect(resolveCaseGraphSource('British UFO Research Association')).toMatchObject({
      id: 'bufora', family: 'research', role: 'originator', dependencyRisk: 'medium',
      lineageId: 'governance:bufora:published-investigation-reports',
    });
    expect(resolveCaseGraphSource('SUFOI')).toMatchObject({
      id: 'sufoi', role: 'originator', lineageId: 'governance:sufoi:published-observation-catalogue',
    });
    expect(resolveCaseGraphSource('SUFOI_UAPCHECK')).toMatchObject({
      id: 'sufoi_uapcheck', role: 'aggregator', lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    expect(resolveCaseGraphSource('GEP_UAPCHECK')).toMatchObject({
      id: 'gep_uapcheck', role: 'aggregator', lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    expect(resolveCaseGraphSource('BE_UFOM_UAPCHECK')).toMatchObject({
      id: 'be_ufom_uapcheck', role: 'aggregator', lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    expect(resolveCaseGraphSource('COBEPS_UAPCHECK')).toMatchObject({
      id: 'cobeps_uapcheck', role: 'aggregator', lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
    expect(resolveCaseGraphSource('UFOCNS')).toMatchObject({
      id: 'ufocns', family: 'community', role: 'submission_channel', lineageId: 'governance:ufocns:platform-reference',
    });
    expect(resolveCaseGraphSource('NASA ASRS')).toMatchObject({
      id: 'asrs_reportsets', family: 'official', role: 'archive', lineageId: 'governance:nasa-asrs:rotating-report-set',
    });
    expect(resolveCaseGraphSource('CURATED_ARCHIVE')).toMatchObject({
      id: 'curated_archive', family: 'curated', role: 'editorial',
      lineageId: 'governance:uapfiles:retired-curated-reference', dependencyRisk: 'high',
    });
  });

  it('marks aliases of one governed lineage as dependent without guessing across sources', () => {
    expect(caseGraphSourcesShareLineage('CUFOS', 'cufos_ufocat')).toBe(true);
    expect(caseGraphSourcesShareLineage('UK MOD', 'Ministry of Defence')).toBe(true);
    expect(caseGraphSourcesShareLineage('AARO', 'UK MOD')).toBe(false);
    expect(caseGraphSourcesShareLineage('unclassified-a', 'unclassified-a')).toBe(false);
    expect(caseGraphSourcesShareLineage('NUFORC', 'NUFORC_ENHANCED')).toBe(true);
    expect(caseGraphSourcesShareLineage('KAGGLE_WORLDWIDE', 'CORGIS')).toBe(true);
    expect(caseGraphSourcesShareLineage('HF_UFO_CLUSTERED', 'NUFORC')).toBe(false);
    expect(caseGraphSourcesShareLineage('RICH_GELREICH_EBERHART', 'RICH_GELREICH_EBERHART_OPENAI')).toBe(true);
    expect(caseGraphSourcesShareLineage('RICH_GELREICH_EBERHART', 'RICH_GELREICH_HATCH_UDB')).toBe(false);
    expect(caseGraphSourcesShareLineage('RICH_GELREICH_EBERHART', 'EBERHART TIMELINE')).toBe(true);
    expect(caseGraphSourcesShareLineage('RICH_GELREICH_RR0', 'RR0 (GNU FDL)')).toBe(true);
    expect(caseGraphSourcesShareLineage('SKYWATCH', ' skywatch ')).toBe(true);
    expect(caseGraphSourcesShareLineage('SKYWATCH', 'RICH_GELREICH_HATCH_UDB')).toBe(false);
    expect(caseGraphSourcesShareLineage('CANADIAN_UFO_SURVEY', 'canadian ufo survey')).toBe(true);
    expect(caseGraphSourcesShareLineage('CANADIAN_UFO_SURVEY', 'CANADA_GOV')).toBe(false);
    expect(caseGraphSourcesShareLineage('CANADIAN_UFO_SURVEY', 'NUFORC')).toBe(false);
    expect(caseGraphSourcesShareLineage('REDDIT_UFO', 'reddit ufo')).toBe(true);
    expect(caseGraphSourcesShareLineage('REDDIT_UFO', 'UFO_FINDER')).toBe(false);
    expect(caseGraphSourcesShareLineage('UK_AIRPROX', 'uk airprox')).toBe(true);
    expect(caseGraphSourcesShareLineage('UK_AIRPROX', 'UK_MOD')).toBe(false);
    expect(caseGraphSourcesShareLineage('FR_GEIPAN', 'GEIPAN')).toBe(true);
    expect(caseGraphSourcesShareLineage('FR_GEIPAN', 'GEP')).toBe(false);
    expect(caseGraphSourcesShareLineage('CISU', 'CISUCAT2')).toBe(true);
    expect(caseGraphSourcesShareLineage('CISU', 'NUFORC')).toBe(false);
    expect(caseGraphSourcesShareLineage('HESSDALEN', 'Project Hessdalen')).toBe(true);
    expect(caseGraphSourcesShareLineage('HESSDALEN', 'NUFORC')).toBe(false);
    expect(caseGraphSourcesShareLineage('REVISTA_UFO', 'UFO Magazine Brazil')).toBe(true);
    expect(caseGraphSourcesShareLineage('REVISTA_UFO', 'YouTube')).toBe(false);
    expect(caseGraphSourcesShareLineage('BUFORA', 'British UFO Research Association')).toBe(true);
    expect(caseGraphSourcesShareLineage('BUFORA', 'NUFORC')).toBe(false);
    expect(caseGraphSourcesShareLineage('SUFOI_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('SUFOI', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('GEP_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('GEP', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('BE_UFOM_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('BE_UFOM', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('COBEPS_UAPCHECK', 'CISU')).toBe(true);
    expect(caseGraphSourcesShareLineage('COBEPS', 'CISU')).toBe(false);
    expect(caseGraphSourcesShareLineage('CURATED_ARCHIVE', 'CURATED')).toBe(false);
  });

  it('fails open to unknown metadata instead of inventing authority or independence', () => {
    expect(resolveCaseGraphSource('New Archive')).toMatchObject({
      id: 'new_archive', family: 'unknown', dependencyRisk: 'unknown', lineageId: 'unknown:new_archive',
    });
  });
});
