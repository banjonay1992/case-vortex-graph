import { resolveHighVolumeReviewedLineage } from './highVolumeSourceGovernanceReview';
import { resolveRichGelreichReviewedLineage } from './richGelreichSourceLineage';
import { resolveSkywatchReviewedLineage } from './skywatchSourceLineage';
import { resolveCanadianUfoSurveyReviewedLineage } from './canadianUfoSurveySourceLineage';
import { resolveRedditUfoReviewedLineage } from './redditUfoSourceLineage';
import { resolveUkAirproxReviewedLineage } from './ukAirproxSourceLineage';
import { resolveGeipanReviewedLineage } from './geipanSourceLineage';
import { resolveCisuReviewedLineage } from './cisuSourceLineage';
import { resolveHessdalenReviewedLineage } from './hessdalenSourceLineage';
import { resolveRevistaUfoReviewedLineage } from './revistaUfoSourceLineage';
import { resolveBuforaReviewedLineage } from './buforaSourceLineage';
import { resolveAfuUfoSverigeReviewedLineage } from './afuUfoSverigeSourceLineage';
import { resolveSufoiReviewedLineage } from './sufoiSourceLineage';
import { resolveGepReviewedLineage } from './gepSourceLineage';
import { resolveBeUfomReviewedLineage } from './beUfomSourceLineage';
import { resolveCobepsReviewedLineage } from './cobepsSourceLineage';
import { resolveUfocnsReviewedLineage } from './ufocnsSourceLineage';
import { resolveAsrsReportSetsReviewedLineage } from './asrsReportSetsSourceLineage';
import { resolveCuratedArchiveReviewedLineage } from './curatedArchiveSourceLineage';

export const CASE_GRAPH_SOURCE_REGISTRY_VERSION = 'case-graph-sources-v1' as const;

export type CaseGraphSourceFamily = 'official' | 'research' | 'community' | 'first_party' | 'curated' | 'unknown';
export type CaseGraphSourceRole = 'originator' | 'archive' | 'aggregator' | 'submission_channel' | 'editorial';
export type CaseGraphDependencyRisk = 'low' | 'medium' | 'high' | 'unknown';

export type CaseGraphSourceDefinition = {
  id: string;
  label: string;
  family: CaseGraphSourceFamily;
  role: CaseGraphSourceRole;
  lineageId: string;
  dependencyRisk: CaseGraphDependencyRisk;
  aliases: readonly string[];
  description: string;
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const CASE_GRAPH_SOURCE_REGISTRY: readonly CaseGraphSourceDefinition[] = [
  {
    id: 'aaro', label: 'AARO', family: 'official', role: 'originator', lineageId: 'aaro', dependencyRisk: 'low',
    aliases: ['aaro', 'all-domain anomaly resolution office', 'all domain anomaly resolution office'],
    description: 'Records released by the US All-domain Anomaly Resolution Office.',
  },
  {
    id: 'uk_mod', label: 'UK Ministry of Defence', family: 'official', role: 'originator', lineageId: 'uk_mod', dependencyRisk: 'low',
    aliases: ['uk mod', 'uk_mod', 'mod uk', 'ministry of defence', 'uk ministry of defence'],
    description: 'Records released by the United Kingdom Ministry of Defence.',
  },
  {
    id: 'uk_airprox', label: 'UK Airprox Board', family: 'official', role: 'originator',
    lineageId: 'governance:uk-airprox-board:official-air-safety-reports', dependencyRisk: 'medium',
    aliases: ['uk airprox', 'uk_airprox', 'uk airprox board', 'airprox board'],
    description: 'Official UK Airprox Board investigation and assessment records; underlying reporter claims remain separately attributable.',
  },
  {
    id: 'geipan', label: 'CNES GEIPAN', family: 'official', role: 'originator',
    lineageId: 'governance:cnes-geipan:official-case-catalogue', dependencyRisk: 'medium',
    aliases: ['geipan', 'fr_geipan', 'fr geipan', 'cnes geipan'],
    description: 'Official CNES GEIPAN case catalogue and classification; underlying witness claims remain separately attributable.',
  },
  {
    id: 'cisu', label: 'CISU via Euro UFO Index', family: 'research', role: 'aggregator',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024', dependencyRisk: 'high',
    aliases: ['cisu', 'cisucat2', 'uapcheck cisu'],
    description: 'Legacy CISU-labelled rows are a shared Euro UFO Index snapshot containing multiple contributing organisations, not direct CISU-only records.',
  },
  {
    id: 'afu_ufo_sverige', label: 'UFO-Sverige via Euro UFO Index', family: 'research', role: 'aggregator',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024', dependencyRisk: 'high',
    aliases: ['afu', 'afu ufo sverige', 'afu_ufo_sverige', 'ufo sverige', 'ufo_sverige'],
    description: 'Legacy AFU/UFO-Sverige-labelled rows are shared Euro UFO Index references, not records originating from AFU holdings and not independent of matching CISU index rows.',
  },
  {
    id: 'sufoi', label: 'SUFOI published observations', family: 'research', role: 'originator',
    lineageId: 'governance:sufoi:published-observation-catalogue', dependencyRisk: 'medium',
    aliases: ['sufoi', 'skandinavisk ufo information'],
    description: 'Sanitised observation metadata published by SUFOI; underlying witness claims remain separately attributable and confidentiality-bound.',
  },
  {
    id: 'sufoi_uapcheck', label: 'SUFOI via Euro UFO Index', family: 'research', role: 'aggregator',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024', dependencyRisk: 'high',
    aliases: ['sufoi uapcheck', 'sufoi_uapcheck', 'sufoi shared index', 'sufoi_shared_index'],
    description: 'SUFOI-labelled references copied from the shared Euro UFO Index; matching CISU rows are repetition, not independent corroboration.',
  },
  {
    id: 'sufoi_editorial_reference', label: 'SUFOI editorial reference', family: 'research', role: 'editorial',
    lineageId: 'governance:sufoi:editorial-website', dependencyRisk: 'high',
    aliases: ['sufoi editorial', 'sufoi_editorial', 'sufoi editorial reference', 'sufoi_editorial_reference'],
    description: 'A link to SUFOI editorial website content, not an individual sighting and not evidence of the article publication date as an event date.',
  },
  {
    id: 'gep', label: 'GEP published case analysis', family: 'research', role: 'originator',
    lineageId: 'governance:gep:published-case-analysis', dependencyRisk: 'medium',
    aliases: ['gep', 'gesellschaft zur erforschung des ufo phanomens'],
    description: 'Public GEP case-analysis metadata; the organisation conclusion and underlying witness account remain separately attributable.',
  },
  {
    id: 'gep_uapcheck', label: 'GEP via Euro UFO Index', family: 'research', role: 'aggregator',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024', dependencyRisk: 'high',
    aliases: ['gep uapcheck', 'gep_uapcheck', 'gep shared index', 'gep_shared_index'],
    description: 'GEP-labelled shared Euro UFO Index references; matching CISU rows are repetition rather than independent corroboration.',
  },
  {
    id: 'gep_publication_archive_reference', label: 'GEP/JUFOF publication archive reference', family: 'research', role: 'archive',
    lineageId: 'governance:afu:gep-jufof-publication-archive', dependencyRisk: 'high',
    aliases: ['gep archive reference', 'gep_archive_reference', 'gep publication archive reference', 'gep_publication_archive_reference'],
    description: 'A link to an AFU-hosted GEP/JUFOF publication directory, not an individual sighting record.',
  },
  {
    id: 'be_ufom', label: 'Belgisch UFO-meldpunt published reports', family: 'research', role: 'originator',
    lineageId: 'governance:be-ufom:published-report-catalogue', dependencyRisk: 'medium',
    aliases: ['be ufom', 'be-ufom', 'be_ufom', 'belgisch ufo meldpunt', 'belgisch ufomeldpunt'],
    description: 'Published report metadata from Belgisch UFO-meldpunt; witness text and the organisation evaluation remain separately attributable.',
  },
  {
    id: 'be_ufom_uapcheck', label: 'BE-UFOM via Euro UFO Index', family: 'research', role: 'aggregator',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024', dependencyRisk: 'high',
    aliases: ['be ufom uapcheck', 'be_ufom_uapcheck', 'be ufom shared index', 'be_ufom_shared_index'],
    description: 'BE-UFOM-labelled shared Euro UFO Index references; matching CISU rows are repetition rather than independent corroboration.',
  },
  {
    id: 'be_ufom_website_reference', label: 'Belgisch UFO-meldpunt website reference', family: 'research', role: 'editorial',
    lineageId: 'governance:be-ufom:website-reference', dependencyRisk: 'high',
    aliases: ['be ufom website reference', 'be_ufom_website_reference', 'be ufom editorial reference'],
    description: 'A link to a Belgisch UFO-meldpunt website page, not an individual sighting and not independent corroboration.',
  },
  {
    id: 'cobeps', label: 'COBEPS published investigations', family: 'research', role: 'originator',
    lineageId: 'governance:cobeps:published-investigation-reports', dependencyRisk: 'medium',
    aliases: ['cobeps', 'comite belge etude phenomenes spatiaux'],
    description: 'Published COBEPS investigation metadata; witness claims and organisation conclusions remain separately attributable.',
  },
  {
    id: 'cobeps_uapcheck', label: 'COBEPS via Euro UFO Index', family: 'research', role: 'aggregator',
    lineageId: 'governance:uapcheck:euro-ufo-index-2024', dependencyRisk: 'high',
    aliases: ['cobeps uapcheck', 'cobeps_uapcheck', 'cobeps shared index', 'cobeps_shared_index'],
    description: 'COBEPS-labelled shared Euro UFO Index references; matching CISU rows are repetition rather than independent corroboration.',
  },
  {
    id: 'cobeps_website_reference', label: 'COBEPS website or publication reference', family: 'research', role: 'editorial',
    lineageId: 'governance:cobeps:website-publication-reference', dependencyRisk: 'high',
    aliases: ['cobeps website reference', 'cobeps_website_reference', 'cobeps publication reference'],
    description: 'A COBEPS website, PDF or partner link reference, not an individual sighting and not independent corroboration.',
  },
  {
    id: 'ufocns', label: 'UFOCNS forum reference', family: 'community', role: 'submission_channel',
    lineageId: 'governance:ufocns:platform-reference', dependencyRisk: 'high',
    aliases: ['ufocns', 'ufo cns', 'ufo研究'],
    description: 'A live reference to mixed user-generated forum content; post time is not event time and copied content is not canonical evidence.',
  },
  {
    id: 'asrs_reportsets', label: 'NASA ASRS report-set reference', family: 'official', role: 'archive',
    lineageId: 'governance:nasa-asrs:rotating-report-set', dependencyRisk: 'high',
    aliases: ['asrs reportsets', 'asrs_reportsets', 'nasa asrs', 'asrs'],
    description: 'De-identified voluntary aviation-safety reports from rotating NASA ASRS topic PDFs; contextual evidence, not verified UAP sightings.',
  },
  {
    id: 'curated_archive', label: 'Retired UAPFiles curated reference', family: 'curated', role: 'editorial',
    lineageId: 'governance:uapfiles:retired-curated-reference', dependencyRisk: 'high',
    aliases: ['curated archive', 'curated_archive', 'retired curated reference'],
    description: 'An inactive former showcase card retained only as an editorial audit reference, not a sighting or independent evidence source.',
  },
  {
    id: 'hessdalen', label: 'Project Hessdalen', family: 'research', role: 'archive',
    lineageId: 'governance:project-hessdalen:registered-observations', dependencyRisk: 'medium',
    aliases: ['hessdalen', 'project hessdalen'],
    description: 'Project-registered observation metadata; underlying witness claims, names, media and exact event positions remain separately governed.',
  },
  {
    id: 'revista_ufo', label: 'Revista UFO', family: 'curated', role: 'editorial',
    lineageId: 'governance:revista-ufo:editorial-avistamentos-category', dependencyRisk: 'high',
    aliases: ['revista ufo', 'revista_ufo', 'ufo magazine brazil'],
    description: 'Editorial article references whose underlying reports and embedded media require upstream attribution and cannot add independent corroboration.',
  },
  {
    id: 'bufora', label: 'British UFO Research Association', family: 'research', role: 'originator',
    lineageId: 'governance:bufora:published-investigation-reports', dependencyRisk: 'medium',
    aliases: ['bufora', 'british ufo research association'],
    description: 'Published BUFORA investigation metadata; organisation findings and underlying witness claims remain separately attributable and confidentiality-bound.',
  },
  {
    id: 'cufos_ufocat', label: 'CUFOS UFOCAT', family: 'research', role: 'archive', lineageId: 'cufos_ufocat', dependencyRisk: 'medium',
    aliases: ['cufos', 'ufocat', 'cufos ufocat', 'cufos_ufocat'],
    description: 'Historical research catalogue maintained through the CUFOS/UFOCAT lineage.',
  },
  {
    id: 'ufo_finder', label: 'UFO Finder', family: 'community', role: 'aggregator', lineageId: 'ufo_finder', dependencyRisk: 'high',
    aliases: ['ufo finder', 'ufo_finder', 'ufofinder'],
    description: 'Community catalogue whose entries may reproduce reports from upstream collections.',
  },
  {
    id: 'user', label: 'UAPFiles first-party report', family: 'first_party', role: 'submission_channel', lineageId: 'uapfiles_user', dependencyRisk: 'medium',
    aliases: ['user', 'user upload', 'first party', 'first_party', 'submitted'],
    description: 'A report submitted directly through UAPFiles; independence remains case-specific.',
  },
  {
    id: 'curated', label: 'UAPFiles curated dossier', family: 'curated', role: 'editorial', lineageId: 'uapfiles_curated', dependencyRisk: 'high',
    aliases: ['curated', 'dossier', 'editorial', 'uapfiles curated'],
    description: 'An editorial record assembled from cited evidence; upstream independence requires record-level proof.',
  },
] as const;

const registryByAlias = new Map<string, CaseGraphSourceDefinition>();
for (const definition of CASE_GRAPH_SOURCE_REGISTRY) {
  for (const alias of [definition.id, ...definition.aliases]) registryByAlias.set(normalize(alias), definition);
}

export const resolveCaseGraphSource = (source: string): CaseGraphSourceDefinition => {
  const key = normalize(source);
  return registryByAlias.get(key) || {
    id: key || 'unknown',
    label: String(source || '').trim() || 'Unknown source',
    family: 'unknown',
    role: 'aggregator',
    lineageId: `unknown:${key || 'source'}`,
    dependencyRisk: 'unknown',
    aliases: key ? [key] : [],
    description: 'This source is not yet classified in the governed Case Vortex source registry.',
  };
};

export const caseGraphSourcesShareLineage = (left: string, right: string) => {
  const leftReviewed = resolveHighVolumeReviewedLineage(left)
    ?? resolveRichGelreichReviewedLineage(left)
    ?? resolveSkywatchReviewedLineage(left)
    ?? resolveCanadianUfoSurveyReviewedLineage(left)
    ?? resolveRedditUfoReviewedLineage(left)
    ?? resolveUkAirproxReviewedLineage(left)
    ?? resolveGeipanReviewedLineage(left)
    ?? resolveCisuReviewedLineage(left)
    ?? resolveHessdalenReviewedLineage(left)
    ?? resolveRevistaUfoReviewedLineage(left)
    ?? resolveBuforaReviewedLineage(left)
    ?? resolveAfuUfoSverigeReviewedLineage(left)
    ?? resolveSufoiReviewedLineage(left)
    ?? resolveGepReviewedLineage(left)
    ?? resolveBeUfomReviewedLineage(left)
    ?? resolveCobepsReviewedLineage(left)
    ?? resolveUfocnsReviewedLineage(left)
    ?? resolveAsrsReportSetsReviewedLineage(left)
    ?? resolveCuratedArchiveReviewedLineage(left);
  const rightReviewed = resolveHighVolumeReviewedLineage(right)
    ?? resolveRichGelreichReviewedLineage(right)
    ?? resolveSkywatchReviewedLineage(right)
    ?? resolveCanadianUfoSurveyReviewedLineage(right)
    ?? resolveRedditUfoReviewedLineage(right)
    ?? resolveUkAirproxReviewedLineage(right)
    ?? resolveGeipanReviewedLineage(right)
    ?? resolveCisuReviewedLineage(right)
    ?? resolveHessdalenReviewedLineage(right)
    ?? resolveRevistaUfoReviewedLineage(right)
    ?? resolveBuforaReviewedLineage(right)
    ?? resolveAfuUfoSverigeReviewedLineage(right)
    ?? resolveSufoiReviewedLineage(right)
    ?? resolveGepReviewedLineage(right)
    ?? resolveBeUfomReviewedLineage(right)
    ?? resolveCobepsReviewedLineage(right)
    ?? resolveUfocnsReviewedLineage(right)
    ?? resolveAsrsReportSetsReviewedLineage(right)
    ?? resolveCuratedArchiveReviewedLineage(right);
  if (leftReviewed && rightReviewed) return leftReviewed.lineageId === rightReviewed.lineageId;
  const leftSource = resolveCaseGraphSource(left);
  const rightSource = resolveCaseGraphSource(right);
  return leftSource.family !== 'unknown'
    && rightSource.family !== 'unknown'
    && leftSource.lineageId === rightSource.lineageId;
};
