import { describe, expect, it } from 'vitest';

import {
  HESSDALEN_CURRENT_REPORTS_URL,
  HESSDALEN_MISSION_URL,
  HESSDALEN_OBSERVATIONS_URL,
  HESSDALEN_PUBLISHER,
  HESSDALEN_REPORTING_PRIVACY_URL,
  HESSDALEN_SOURCE_LINEAGE_POLICY_VERSION,
  resolveHessdalenReviewedLineage,
} from '../../src/caseGraph/hessdalenSourceLineage';

describe('Project Hessdalen source lineage', () => {
  it('keeps project registration separate from mixed witness claims', () => {
    expect(HESSDALEN_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-hessdalen-source-lineage-v1');
    expect(resolveHessdalenReviewedLineage('project hessdalen')).toEqual({
      source: 'HESSDALEN',
      lineageId: 'governance:project-hessdalen:registered-observations',
      sourcePosition: 'mixed',
      originality: 'original',
      publisher: HESSDALEN_PUBLISHER,
      publicationMode: 'metadata_link_only',
      officialProjectRegistration: true,
      underlyingWitnessClaimsMixed: true,
      approximateCoordinatesAreEventLocation: false,
      witnessIdentityStorageAllowed: false,
      narrativeStorageAllowed: false,
      mediaStorageAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [
        HESSDALEN_OBSERVATIONS_URL,
        HESSDALEN_CURRENT_REPORTS_URL,
        HESSDALEN_REPORTING_PRIVACY_URL,
        HESSDALEN_MISSION_URL,
      ],
    });
  });

  it('does not classify unrelated Norwegian sources as Hessdalen', () => {
    expect(resolveHessdalenReviewedLineage('NUFORC')).toBeNull();
  });
});
