import { describe, expect, it } from 'vitest';

import {
  AFU_BYLAWS_URL,
  AFU_PUBLISHER,
  AFU_REPORT_FILES_URL,
  AFU_ROOT_URL,
  AFU_UFO_SVERIGE_EURO_UFO_INDEX_URL,
  AFU_UFO_SVERIGE_SOURCE_LINEAGE_POLICY_VERSION,
  UFO_SVERIGE_ABOUT_URL,
  UFO_SVERIGE_PRIVACY_URL,
  UFO_SVERIGE_PUBLISHER,
  UFO_SVERIGE_TERMS_URL,
  UAPCHECK_EURO_UFO_INDEX_PUBLISHER,
  resolveAfuUfoSverigeReviewedLineage,
} from '../../src/caseGraph/afuUfoSverigeSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('AFU/UFO-Sverige shared-index lineage', () => {
  it('separates the archive custodian from the stored shared-index origin', () => {
    expect(AFU_UFO_SVERIGE_SOURCE_LINEAGE_POLICY_VERSION)
      .toBe('case-vortex-afu-ufo-sverige-uapcheck-lineage-v1');
    expect(resolveAfuUfoSverigeReviewedLineage('AFU_UFO_SVERIGE')).toEqual({
      source: 'AFU_UFO_SVERIGE',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
      sourcePosition: 'secondary',
      originality: 'derived',
      publisher: UAPCHECK_EURO_UFO_INDEX_PUBLISHER,
      componentOrganisation: UFO_SVERIGE_PUBLISHER,
      archiveCustodian: AFU_PUBLISHER,
      publicationMode: 'metadata_link_only',
      storedLegacyRowsAreSharedIndex: true,
      legacyLabelCombinesDistinctOrganisations: true,
      afuArchiveIsNotTheStoredRowOrigin: true,
      componentOrganisationRequired: true,
      componentOrganisationIsIndependentSource: false,
      publicIndexEventAndGeneralLocationAllowed: true,
      preciseCoordinatesAllowed: false,
      narrativeStorageAllowed: false,
      witnessIdentityStorageAllowed: false,
      mediaStorageAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [
        AFU_ROOT_URL,
        AFU_BYLAWS_URL,
        AFU_REPORT_FILES_URL,
        UFO_SVERIGE_ABOUT_URL,
        UFO_SVERIGE_TERMS_URL,
        UFO_SVERIGE_PRIVACY_URL,
        AFU_UFO_SVERIGE_EURO_UFO_INDEX_URL,
      ],
    });
  });

  it('shares the CISU index lineage and never absorbs unrelated archives', () => {
    expect(resolveCaseGraphSource('UFO_SVERIGE')).toMatchObject({
      id: 'afu_ufo_sverige',
      role: 'aggregator',
      dependencyRisk: 'high',
    });
    expect(caseGraphSourcesShareLineage('AFU_UFO_SVERIGE', 'CISU')).toBe(true);
    expect(resolveAfuUfoSverigeReviewedLineage('BUFORA')).toBeNull();
  });
});
