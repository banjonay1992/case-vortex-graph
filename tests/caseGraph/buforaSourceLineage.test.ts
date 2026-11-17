import { describe, expect, it } from 'vitest';

import {
  BUFORA_ABOUT_URL,
  BUFORA_INVESTIGATIONS_URL,
  BUFORA_PHOTO_ANALYSIS_URL,
  BUFORA_PUBLISHER,
  BUFORA_REPORTING_URL,
  BUFORA_REPORTS_URL,
  BUFORA_SOURCE_LINEAGE_POLICY_VERSION,
  resolveBuforaReviewedLineage,
} from '../../src/caseGraph/buforaSourceLineage';

describe('BUFORA investigation source lineage', () => {
  it('separates organisation investigation from underlying witness claims', () => {
    expect(BUFORA_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-bufora-investigation-lineage-v1');
    expect(resolveBuforaReviewedLineage('British UFO Research Association')).toEqual({
      source: 'BUFORA',
      lineageId: 'governance:bufora:published-investigation-reports',
      sourcePosition: 'mixed',
      originality: 'original',
      publisher: BUFORA_PUBLISHER,
      publicationMode: 'metadata_link_only',
      officialOrganisationInvestigation: true,
      underlyingWitnessClaimsMixed: true,
      witnessIdentityStorageAllowed: false,
      narrativeStorageAllowed: false,
      publicCaseDateAndGeneralLocationAllowed: true,
      mediaStorageAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [
        BUFORA_REPORTS_URL,
        BUFORA_REPORTING_URL,
        BUFORA_INVESTIGATIONS_URL,
        BUFORA_PHOTO_ANALYSIS_URL,
        BUFORA_ABOUT_URL,
      ],
    });
  });

  it('does not absorb witnesses or other catalogues', () => {
    expect(resolveBuforaReviewedLineage('NUFORC')).toBeNull();
    expect(resolveBuforaReviewedLineage('Rendlesham witness')).toBeNull();
  });
});
