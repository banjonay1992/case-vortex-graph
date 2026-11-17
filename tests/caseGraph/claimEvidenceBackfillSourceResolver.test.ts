import { describe, expect, it } from 'vitest';

import { createClaimEvidenceBackfillSourceMetadataResolver } from '../../src/caseGraph/claimEvidenceBackfillSourceResolver';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import {
  buildRelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import type { CaseGraphResearchContentEntry } from '../../src/caseGraph/researchToolContract';

const binding: RelationshipInputUniverseBinding = {
  snapshotId: '00000000-0000-4000-8000-000000000099',
  corpusVersion: 'corpus-v2',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: 'a'.repeat(64),
  universeRecordCount: 2,
};

const record = (sourceId: string, lineageId: string) => buildRelationshipInputRecord({
  binding,
  address: 'document:source-resolver-fixture',
  source: {
    sourceId,
    sourceRecordId: 'source-record-1',
    registryVersion: 'case-graph-sources-v1',
    lineageId,
    dependencyRisk: 'unknown',
  },
  facts: [],
  recordMissingness: [],
  duplicateLineage: null,
  crossReferences: [],
  sourceAssertions: [],
  narrativeVector: {
    status: 'missing', modelId: 'fixture-model', modelVersion: 'v1', dimensions: 8,
    normalization: 'none', inputSha256: null, vectorSha256: null, reason: 'no_narrative',
  },
  governedReferences: [],
});

const entry = (address = 'document:source-resolver-fixture'): CaseGraphResearchContentEntry => ({
  chunkId: `content-chunk:${'1'.repeat(64)}`,
  chunkDigest: '2'.repeat(64),
  address,
  assetId: 'asset:fixture',
  assetDigest: '3'.repeat(64),
  extractionContractDigest: '4'.repeat(64),
  extractionReceiptDigest: '5'.repeat(64),
  extractionPointerDigest: '6'.repeat(64),
  mediaKind: 'document', textOrigin: 'embedded_text',
  locator: { locatorType: 'document_page', pageNumber: 1, characterStart: 0, characterEnd: 4, readingOrder: 0, boundingBox: null },
  text: 'text', language: 'en', confidence: null, scoreMicros: 0,
});

describe('claim backfill source metadata resolver', () => {
  it('uses verified relationship-input provenance and governed labels', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('aaro', 'aaro_original_release')],
      relationshipBinding: binding,
    });

    expect(resolve(entry())).toEqual({
      sourceId: 'aaro',
      sourceLabel: 'AARO',
      lineageId: 'aaro_original_release',
    });
  });

  it('preserves unknown source identity without inventing authority', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('new_archive', 'unknown:new_archive')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'new_archive', sourceLabel: 'new_archive', lineageId: 'unknown:new_archive',
    });
  });

  it('overrides legacy dataset labels with the reviewed upstream lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('nuforc_enhanced', 'unknown:nuforc_enhanced')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'nuforc_enhanced',
      sourceLabel: 'nuforc_enhanced',
      lineageId: 'governance:nuforc-derived',
    });
  });

  it('binds Rich Gelreich transforms to their reviewed component lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('rich_gelreich_eberhart_openai', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'rich_gelreich_eberhart_openai',
      sourceLabel: 'rich_gelreich_eberhart_openai',
      lineageId: 'governance:rich-gelreich:eberhart',
    });
  });

  it('binds SKYWATCH records to the mixed-aggregator lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('skywatch', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'skywatch',
      sourceLabel: 'skywatch',
      lineageId: 'governance:skywatch:mixed-aggregator',
    });
  });

  it('binds Canadian survey records to the civilian mixed-compilation lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('canadian_ufo_survey', 'canada_gov')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'canadian_ufo_survey',
      sourceLabel: 'canadian_ufo_survey',
      lineageId: 'governance:canadian-ufo-survey:mixed-compilation',
    });
  });

  it('binds Reddit leads to the live platform-reference lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('reddit_ufo', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'reddit_ufo',
      sourceLabel: 'reddit_ufo',
      lineageId: 'governance:reddit:platform-reference',
    });
  });

  it('binds UKAB records to the official air-safety report lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('uk_airprox', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'uk_airprox',
      sourceLabel: 'UK Airprox Board',
      lineageId: 'governance:uk-airprox-board:official-air-safety-reports',
    });
  });

  it('binds the legacy FR_GEIPAN label to the official CNES catalogue lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('fr_geipan', 'fr_geipan')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'fr_geipan',
      sourceLabel: 'CNES GEIPAN',
      lineageId: 'governance:cnes-geipan:official-case-catalogue',
    });
  });

  it('binds legacy CISU rows to the shared Euro UFO Index lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('cisu', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'cisu',
      sourceLabel: 'CISU via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
  });

  it('binds Hessdalen observations to the project-registered mixed lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('hessdalen', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'hessdalen',
      sourceLabel: 'Project Hessdalen',
      lineageId: 'governance:project-hessdalen:registered-observations',
    });
  });

  it('binds Revista UFO articles to the secondary editorial lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('revista_ufo', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'revista_ufo',
      sourceLabel: 'Revista UFO',
      lineageId: 'governance:revista-ufo:editorial-avistamentos-category',
    });
  });

  it('binds BUFORA case pages to the published investigation lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('bufora', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'bufora',
      sourceLabel: 'British UFO Research Association',
      lineageId: 'governance:bufora:published-investigation-reports',
    });
  });

  it('binds SUFOI shared-index rows to the same upstream lineage as CISU', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('sufoi_uapcheck', 'unknown:legacy-import')],
      relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'sufoi_uapcheck',
      sourceLabel: 'SUFOI via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
  });

  it('binds GEP shared-index rows to the same upstream lineage as CISU', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('gep_uapcheck', 'unknown:legacy-import')], relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'gep_uapcheck', sourceLabel: 'GEP via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
  });

  it('binds BE-UFOM shared-index rows to the same upstream lineage as CISU', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('be_ufom_uapcheck', 'unknown:legacy-import')], relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'be_ufom_uapcheck', sourceLabel: 'BE-UFOM via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
  });

  it('binds COBEPS shared-index rows to the same upstream lineage as CISU', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('cobeps_uapcheck', 'unknown:legacy-import')], relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'cobeps_uapcheck', sourceLabel: 'COBEPS via Euro UFO Index',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
    });
  });

  it('binds UFOCNS references to their mixed platform lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('ufocns', 'unknown:legacy-import')], relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'ufocns', sourceLabel: 'UFOCNS forum reference',
      lineageId: 'governance:ufocns:platform-reference',
    });
  });
  it('binds NASA ASRS report sets to their rotating archive lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('asrs_reportsets', 'unknown:legacy-import')], relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({ sourceId: 'asrs_reportsets', sourceLabel: 'NASA ASRS report-set reference',
      lineageId: 'governance:nasa-asrs:rotating-report-set' });
  });

  it('binds retired curated cards to an inert editorial lineage', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('curated_archive', 'unknown:legacy-import')], relationshipBinding: binding,
    });
    expect(resolve(entry())).toEqual({
      sourceId: 'curated_archive', sourceLabel: 'Retired UAPFiles curated reference',
      lineageId: 'governance:uapfiles:retired-curated-reference',
    });
  });

  it('fails closed on missing addresses and conflicting verified records', () => {
    const resolve = createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('aaro', 'aaro')],
      relationshipBinding: binding,
    });
    expect(() => resolve(entry('document:not-indexed'))).toThrow('claim_backfill_source_metadata_missing');
    expect(() => createClaimEvidenceBackfillSourceMetadataResolver({
      relationshipRecords: [record('aaro', 'aaro'), record('uk_mod', 'uk_mod')],
      relationshipBinding: binding,
    })).toThrow('claim_backfill_source_resolver_conflict');
  });
});
