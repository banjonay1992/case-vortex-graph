import { describe, expect, it } from 'vitest';

import {
  buildContextualSourceGovernanceResearchPacket,
  CONTEXTUAL_SOURCE_RESEARCH_FINDINGS,
} from '../../src/caseGraph/contextualSourceGovernanceResearchCatalogue';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';

const registryRows = [
  { canonical_source: 'OPENSKY', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
  { canonical_source: 'SONDEHUB_ARCHIVE', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
  { canonical_source: 'NASA_CNEOS_FIREBALL', legal_status: 'review', allowed_content_modes: ['metadata_only'] },
];

describe('contextual source-governance research catalogue', () => {
  it('builds the real nine-domain conservative packet from exact registry rows', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    expect(packet.categoryCoverage.map(({ category }) => category))
      .toEqual([...CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES]);
    expect(packet.entries).toHaveLength(13);
    expect(packet.summary).toEqual({
      categoryCount: 9,
      providerCount: 13,
      approvedProviderCount: 0,
      readyCategoryCount: 0,
      unresolvedCategoryCount: 9,
    });
    expect(packet.entries.find(({ canonicalSource }) => canonicalSource === 'OPENSKY')).toMatchObject({
      canonicalSource: 'OPENSKY',
      decision: 'requires_written_license',
      usableNow: false,
      registry: { legalStatus: 'review', allowedContentModes: ['metadata_only'] },
    });
    expect(packet.entries.find(({ canonicalSource }) => canonicalSource === 'OPEN_METEO')).toMatchObject({
      canonicalSource: 'OPEN_METEO',
      decision: 'requires_paid_plan',
      usableNow: false,
      registry: { legalStatus: 'missing', allowedContentModes: [] },
    });
    expect(packet.entries.every(({ evidenceFresh }) => evidenceFresh)).toBe(true);
    expect(new Set(packet.entries.map(({ evidenceSetSha256 }) => evidenceSetSha256)).size).toBe(13);
  });

  it('rejects ambiguous and unexpected registry rows instead of guessing', () => {
    expect(() => buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows: [...registryRows, registryRows[0]],
    })).toThrow('contextual_source_research_registry_collision');
    expect(() => buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows: [{ canonical_source: 'UNPLANNED', legal_status: 'approved', allowed_content_modes: ['all'] }],
    })).toThrow('contextual_source_research_registry_unexpected_source');
  });

  it('keeps the catalogue identity unique and complete', () => {
    expect(CONTEXTUAL_SOURCE_RESEARCH_FINDINGS).toHaveLength(13);
    expect(new Set(CONTEXTUAL_SOURCE_RESEARCH_FINDINGS.map(({ category }) => category)).size).toBe(9);
    expect(new Set(CONTEXTUAL_SOURCE_RESEARCH_FINDINGS.map(({ canonicalSource }) => canonicalSource)).size).toBe(13);
  });

  it('records operational CelesTrak constraints without converting them into legal approval', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    const satellite = packet.entries.find(({ category }) => category === 'satellite');
    expect(satellite).toMatchObject({
      canonicalSource: 'CELESTRAK',
      decision: 'review_required',
      usableNow: false,
      registry: { legalStatus: 'missing', allowedContentModes: [] },
    });
    expect(satellite?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('stop immediately on a non-200'),
      expect.stringContaining('commercial archive and redistribution rights'),
    ]));
  });

  it('keeps NASA and JPL sources gated while preserving material uncertainty', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    const astronomy = packet.entries.find(
      ({ canonicalSource }) => canonicalSource === 'JPL_HORIZONS',
    );
    const meteor = packet.entries.find(({ category }) => category === 'meteor');

    expect(astronomy).toMatchObject({
      decision: 'review_required',
      usableNow: false,
    });
    expect(astronomy?.evidence.map(({ evidenceUrl }) => evidenceUrl)).toEqual([
      'https://science.data.nasa.gov/about/license',
      'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
    ]);
    expect(meteor).toMatchObject({
      decision: 'review_required',
      usableNow: false,
    });
    expect(meteor?.evidence.map(({ evidenceUrl }) => evidenceUrl)).toEqual([
      'https://cneos.jpl.nasa.gov/fireballs/',
      'https://science.data.nasa.gov/about/license',
    ]);
    expect(meteor?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('incomplete, non-real-time, revisable'),
      expect.stringContaining('cannot rule out a meteor'),
    ]));
    expect(packet.summary.approvedProviderCount).toBe(0);
  });

  it('distinguishes paid launch access from unresolved rights and preserves live-only AIS limits', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    const launch = packet.entries.find(({ category }) => category === 'launch');
    const maritime = packet.entries.find(({ category }) => category === 'maritime');

    expect(launch).toMatchObject({
      canonicalSource: 'ROCKETLAUNCH_LIVE',
      decision: 'requires_paid_plan',
      usableNow: false,
      rights: {
        automatedAccess: 'allowed',
        accessConstraint: 'paid_plan',
      },
    });
    expect(launch?.reasonCodes).toEqual(expect.arrayContaining([
      'source_access_paid_plan',
      'source_rights_unclear',
    ]));
    expect(maritime).toMatchObject({
      canonicalSource: 'AISSTREAM',
      decision: 'review_required',
      usableNow: false,
      rights: {
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
      },
    });
    expect(maritime?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('retention, commercial archive or redistribution rights'),
    ]));
  });

  it('records DVIDS public-use conditions without treating it as complete exercise coverage', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    const military = packet.entries.find(({ category }) => category === 'military_exercise');

    expect(military).toMatchObject({
      canonicalSource: 'DVIDS',
      decision: 'review_required',
      usableNow: false,
      registry: { legalStatus: 'missing' },
    });
    expect(military?.evidence.map(({ evidenceUrl }) => evidenceUrl)).toEqual([
      'https://www.dvidshub.net/',
      'https://www.dvidshub.net/about/copyright',
    ]);
    expect(military?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('item-level rights'),
      expect.stringContaining('cannot rule out a military exercise'),
    ]));
  });

  it('retains rights-clean free alternatives without bypassing the exact registry gate', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    const aircraft = packet.entries.find(({ canonicalSource }) => canonicalSource === 'ADSB_LOL');
    const weather = packet.entries.find(
      ({ canonicalSource }) => canonicalSource === 'NOAA_NCEI_US_OBSERVATIONS',
    );

    expect(aircraft).toMatchObject({
      category: 'aircraft',
      decision: 'review_required',
      usableNow: false,
      registry: { legalStatus: 'missing' },
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
    });
    expect(aircraft?.reasonCodes).not.toContain('source_rights_unclear');
    expect(aircraft?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('cannot rule out an aircraft'),
      expect.stringContaining('share-alike'),
    ]));

    expect(weather).toMatchObject({
      category: 'weather',
      decision: 'review_required',
      usableNow: false,
      registry: { legalStatus: 'missing' },
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
    });
    expect(weather?.reasonCodes).not.toContain('source_rights_unclear');
    expect(weather?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('limited to U.S. NOAA-created'),
      expect.stringContaining('not proof of clear weather'),
    ]));
    expect(packet.categoryCoverage.find(({ category }) => category === 'aircraft'))
      .toMatchObject({ providerCount: 2, approvedProviderCount: 0 });
    expect(packet.categoryCoverage.find(({ category }) => category === 'weather'))
      .toMatchObject({ providerCount: 2, approvedProviderCount: 0 });
  });

  it('adds explicit-license satellite and local astronomy candidates without implicit approval', () => {
    const packet = buildContextualSourceGovernanceResearchPacket({
      referenceAt: '2026-07-27T16:45:00.000Z',
      registryInspectedAt: '2026-07-27T16:44:00.000Z',
      registryRows,
    });
    for (const canonicalSource of ['SATNOGS_DB_API', 'ASTRONOMY_ENGINE_LOCAL']) {
      expect(packet.entries.find((entry) => entry.canonicalSource === canonicalSource))
        .toMatchObject({
          decision: 'review_required',
          usableNow: false,
          registry: { legalStatus: 'missing', allowedContentModes: [] },
          rights: {
            commercialUse: 'allowed',
            automatedAccess: 'allowed',
            archivalUse: 'allowed',
            redistribution: 'allowed',
            accessConstraint: 'none',
            attributionRequired: true,
          },
        });
    }
    expect(packet.entries.find(
      ({ canonicalSource }) => canonicalSource === 'SATNOGS_DB_API',
    )?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('CC BY-SA'),
      expect.stringContaining('cannot rule out a satellite'),
    ]));
    expect(packet.entries.find(
      ({ canonicalSource }) => canonicalSource === 'ASTRONOMY_ENGINE_LOCAL',
    )?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('one-arcminute'),
      expect.stringContaining('never as an identification'),
    ]));
  });
});
