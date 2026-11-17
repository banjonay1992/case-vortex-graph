import { describe, expect, it } from 'vitest';

import {
  REVISTA_UFO_ABOUT_URL,
  REVISTA_UFO_CATEGORY_URL,
  REVISTA_UFO_PRIVACY_URL,
  REVISTA_UFO_PUBLISHER,
  REVISTA_UFO_SOURCE_LINEAGE_POLICY_VERSION,
  REVISTA_UFO_TERMS_URL,
  resolveRevistaUfoReviewedLineage,
} from '../../src/caseGraph/revistaUfoSourceLineage';

describe('Revista UFO editorial source lineage', () => {
  it('treats the sightings category as secondary editorial references', () => {
    expect(REVISTA_UFO_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-revista-ufo-editorial-lineage-v1');
    expect(resolveRevistaUfoReviewedLineage('revista ufo')).toEqual({
      source: 'REVISTA_UFO',
      lineageId: 'governance:revista-ufo:editorial-avistamentos-category',
      sourcePosition: 'secondary',
      originality: 'derived',
      publisher: REVISTA_UFO_PUBLISHER,
      publicationMode: 'metadata_link_only',
      editorialArticleIsIndependentWitnessSource: false,
      articleContentStorageAllowed: false,
      embeddedMediaStorageAllowed: false,
      inferredEventFieldsAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [
        REVISTA_UFO_CATEGORY_URL,
        REVISTA_UFO_ABOUT_URL,
        REVISTA_UFO_TERMS_URL,
        REVISTA_UFO_PRIVACY_URL,
      ],
    });
  });

  it('does not absorb an underlying publisher or witness source', () => {
    expect(resolveRevistaUfoReviewedLineage('FAB')).toBeNull();
    expect(resolveRevistaUfoReviewedLineage('YouTube')).toBeNull();
    expect(resolveRevistaUfoReviewedLineage('NUFORC')).toBeNull();
  });
});
