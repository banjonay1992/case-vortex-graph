import { describe, expect, it } from 'vitest';

import {
  UK_AIRPROX_COPYRIGHT_URL,
  UK_AIRPROX_PUBLISHER,
  UK_AIRPROX_REPORT_INDEX_URL,
  UK_AIRPROX_SOURCE_LINEAGE_POLICY_VERSION,
  resolveUkAirproxReviewedLineage,
} from '../../src/caseGraph/ukAirproxSourceLineage';

describe('UK Airprox Board source lineage', () => {
  it('separates the official assessment from the underlying reporter claims', () => {
    expect(UK_AIRPROX_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-uk-airprox-source-lineage-v1');
    expect(resolveUkAirproxReviewedLineage(' uk airprox ')).toEqual({
      source: 'UK_AIRPROX',
      lineageId: 'governance:uk-airprox-board:official-air-safety-reports',
      sourcePosition: 'mixed',
      originality: 'original',
      publisher: UK_AIRPROX_PUBLISHER,
      publicationMode: 'metadata_link_only',
      officialInvestigationAndAssessment: true,
      underlyingReporterClaimsMixed: true,
      assignsBlameOrLiability: false,
      independentCorroborationAllowed: false,
      eventTimestampSource: 'official_catalogue_date_and_utc_time',
      legacyDateRepairRequiredForCatalogueYears: ['2017', '2018'],
      evidenceUrls: [UK_AIRPROX_REPORT_INDEX_URL, UK_AIRPROX_COPYRIGHT_URL],
    });
  });

  it('does not classify unrelated official sources as UKAB', () => {
    expect(resolveUkAirproxReviewedLineage('UK_MOD')).toBeNull();
  });
});
