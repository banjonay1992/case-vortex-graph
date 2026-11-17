import { describe, expect, it, vi } from 'vitest';

import { buildAdsbLolSnapshotArchive } from '../../src/workers/adsbLolSnapshotArchive';
import {
  buildNoaaNceiUsObservationUrl,
  decodeAdsbLolHistoricalArchive,
  decodeNoaaNceiUsObservationResponse,
  fetchGovernedNoaaNceiUsObservations,
} from '../../src/caseGraph/freeContextualProviderObservations';
import { buildContextualSourceGovernanceDecisionPacket } from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';

const row = {
  icao24: 'abc123',
  callsign: 'TEST1',
  origin_country: 'United Kingdom',
  time_position: new Date('2026-07-24T12:00:00.000Z'),
  last_contact: new Date('2026-07-24T12:00:01.000Z'),
  longitude: -0.1,
  latitude: 51.5,
  baro_altitude: 1_000,
  on_ground: false,
  velocity: 80,
  true_track: 180,
  vertical_rate: 0,
  geo_altitude: 1_050,
  squawk: '7000',
  spi: false,
  position_source: 0,
  category: 1,
  snapshot_time: new Date('2026-07-24T12:00:02.000Z'),
  source: 'adsblol',
};

const approvedPacket = () => buildContextualSourceGovernanceDecisionPacket({
  referenceAt: '2026-07-24T00:00:00.000Z',
  maximumEvidenceAgeDays: 30,
  entries: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => ({
    category,
    canonicalSource: category === 'weather'
      ? 'NOAA_NCEI_US_OBSERVATIONS'
      : `FIXTURE_${category.toUpperCase()}`,
    providerId: category === 'weather'
      ? 'noaa-ncei-us-observations'
      : `fixture-${category.replace(/_/g, '-')}`,
    requiredContentMode: 'derived_only',
    registry: {
      inspectedAt: '2026-07-24T00:00:00.000Z',
      legalStatus: category === 'weather' ? 'approved' : 'review',
      allowedContentModes: category === 'weather' ? ['derived_only'] : [],
    },
    rights: {
      commercialUse: category === 'weather' ? 'allowed' : 'unclear',
      automatedAccess: 'allowed',
      archivalUse: category === 'weather' ? 'allowed' : 'unclear',
      redistribution: category === 'weather' ? 'allowed' : 'unclear',
      accessConstraint: 'none',
      attributionRequired: true,
    },
    evidence: [{
      evidenceId: `official-${category.replace(/_/g, '-')}`,
      evidenceUrl: category === 'weather'
        ? 'https://www.ncei.noaa.gov/access/services/data/v1'
        : `https://example.test/${category}`,
      observedAt: '2026-07-24T00:00:00.000Z',
      evidenceSha256: relationshipInputSha256({ category, reviewed: true }),
      summary: category === 'weather'
        ? 'Official NOAA observation API and public-domain review.'
        : `Fixture review for ${category}.`,
    }],
    limitations: category === 'weather'
      ? ['U.S. NOAA-created records only.']
      : ['Not approved in this fixture.'],
  })),
});

describe('free contextual provider observations', () => {
  it('decodes and verifies an immutable ADSB.lol archive with explicit coverage limits', async () => {
    const built = await buildAdsbLolSnapshotArchive({
      snapshotTime: row.snapshot_time,
      rows: [row],
      tileResults: [
        { label: 'tile-a', ok: true, rowCount: 1, durationMs: 50 },
        { label: 'tile-b', ok: false, rowCount: 0, durationMs: 60, error: 'timeout' },
      ],
    });
    const decoded = decodeAdsbLolHistoricalArchive({
      archiveBody: built.archiveBody,
      manifestBody: built.manifestBody,
    });
    expect(decoded).toMatchObject({
      providerId: 'adsb-lol',
      rows: [{ icao24: 'abc123', latitude: 51.5, longitude: -0.1 }],
      coverage: {
        snapshotTime: '2026-07-24T12:00:02.000Z',
        coverageFraction: 0.5,
        complete: false,
        failedTileCount: 1,
      },
    });
    expect(decoded.coverage.limitations.join(' ')).toContain('not complete retrospective flight history');
    expect(decoded.coverage.limitations.join(' ')).toContain('does not rule out an aircraft');
  });

  it('rejects ADSB archive corruption before exposing any rows', async () => {
    const built = await buildAdsbLolSnapshotArchive({
      snapshotTime: row.snapshot_time,
      rows: [row],
      tileResults: [{ label: 'tile-a', ok: true, rowCount: 1, durationMs: 50 }],
    });
    const corrupt = Buffer.from(built.archiveBody);
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => decodeAdsbLolHistoricalArchive({
      archiveBody: corrupt,
      manifestBody: built.manifestBody,
    })).toThrow('adsb_lol_archive_checksum_mismatch');
  });

  it('builds a bounded NOAA LCDv2 request and rejects broad or unknown queries', () => {
    const url = new URL(buildNoaaNceiUsObservationUrl({
      start: '2026-07-24T10:00:00Z',
      end: '2026-07-24T12:00:00Z',
      north: 52,
      west: -1,
      south: 51,
      east: 0,
      dataTypes: ['HourlyVisibility', 'HourlySkyConditions'],
    }));
    expect(url.origin + url.pathname).toBe('https://www.ncei.noaa.gov/access/services/data/v1');
    expect(url.searchParams.get('dataset')).toBe('local-climatological-data-v2');
    expect(url.searchParams.get('bbox')).toBe('52,-1,51,0');
    expect(url.searchParams.get('dataTypes')).toBe('HourlySkyConditions,HourlyVisibility');
    expect(() => buildNoaaNceiUsObservationUrl({
      start: '2026-07-20T00:00:00Z',
      end: '2026-07-24T12:00:00Z',
      north: 52, west: -1, south: 51, east: 0,
    })).toThrow('noaa_ncei_query_invalid');
    expect(() => buildNoaaNceiUsObservationUrl({
      start: '2026-07-24T10:00:00Z',
      end: '2026-07-24T12:00:00Z',
      north: 52, west: -1, south: 51, east: 0,
      dataTypes: ['UnreviewedThirdPartyVariable'],
    })).toThrow('noaa_ncei_data_types_invalid');
  });

  it('normalizes U.S. rows, excludes non-U.S. rows and preserves missing variables', () => {
    const result = decodeNoaaNceiUsObservationResponse({
      acquiredAt: '2026-07-24T13:00:00Z',
      sourceUrl: 'https://www.ncei.noaa.gov/access/services/data/v1?fixture=1',
      body: JSON.stringify([
        {
          STATION: 'USW00094846',
          NAME: 'CHICAGO OHARE',
          DATE: '2026-07-24T12:00:00Z',
          LATITUDE: '41.9602',
          LONGITUDE: '-87.9316',
          HourlyVisibility: '16.09',
          HourlySkyConditions: 'FEW:02 250',
        },
        {
          STATION: 'CA000000001',
          NAME: 'CANADIAN FIXTURE',
          DATE: '2026-07-24T12:00:00Z',
          LATITUDE: 49,
          LONGITUDE: -123,
        },
      ]),
    });
    expect(result).toMatchObject({
      providerId: 'noaa-ncei-us-observations',
      excludedNonUsRows: 1,
      observations: [{
        stationId: 'USW00094846',
        observedAt: '2026-07-24T12:00:00.000Z',
        measurements: {
          HourlyVisibility: 16.09,
          HourlySkyConditions: 'FEW:02 250',
          HourlyPrecipitation: null,
        },
      }],
    });
    expect(result.limitations.join(' ')).toContain('2005 onward');
    expect(result.limitations.join(' ')).toContain('not proof of clear weather');
    expect(() => decodeNoaaNceiUsObservationResponse({
      acquiredAt: '2026-07-24T13:00:00Z',
      sourceUrl: 'https://www.ncei.noaa.gov/access/services/data/v1?fixture=1',
      body: JSON.stringify([{
        STATION: 'USW00094846',
        DATE: '2026-07-24T12:00:00',
        LATITUDE: 41.9602,
        LONGITUDE: -87.9316,
      }]),
    })).toThrow('noaa_ncei_response_invalid');
  });

  it('fails closed before network access unless both source decisions approve derived-only use', async () => {
    const fetchImpl = vi.fn();
    const packet = approvedPacket();
    await expect(fetchGovernedNoaaNceiUsObservations({
      query: {
        start: '2026-07-24T10:00:00Z', end: '2026-07-24T12:00:00Z',
        north: 42, west: -89, south: 41, east: -87,
      },
      checkedAt: '2026-07-25T00:00:00Z',
      decisionPacket: packet,
      inspectGovernance: async () => ({
        present: true,
        canonicalSource: 'NOAA_NCEI_US_OBSERVATIONS',
        legalStatus: 'review',
        allowedContentModes: ['derived_only'],
      }),
      fetchImpl,
    })).rejects.toThrow('noaa_ncei_source_registry_not_approved');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches only after both approvals and supports caller cancellation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      STATION: 'USW00094846',
      DATE: '2026-07-24T12:00:00Z',
      LATITUDE: 41.9602,
      LONGITUDE: -87.9316,
      HourlyVisibility: 16,
    }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const base = {
      query: {
        start: '2026-07-24T10:00:00Z', end: '2026-07-24T12:00:00Z',
        north: 42, west: -89, south: 41, east: -87,
      },
      checkedAt: '2026-07-25T00:00:00Z',
      decisionPacket: approvedPacket(),
      inspectGovernance: async () => ({
        present: true,
        canonicalSource: 'NOAA_NCEI_US_OBSERVATIONS',
        legalStatus: 'approved',
        allowedContentModes: ['derived_only'],
      }),
      fetchImpl,
    };
    await expect(fetchGovernedNoaaNceiUsObservations(base)).resolves.toMatchObject({
      observations: [{ stationId: 'USW00094846' }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchGovernedNoaaNceiUsObservations({
      ...base,
      signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
