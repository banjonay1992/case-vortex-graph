import { describe, expect, it } from 'vitest';

import {
  CISU_CATALOGUE_URL,
  CISU_PUBLISHER,
  CISU_SOURCE_LINEAGE_POLICY_VERSION,
  EURO_UFO_INDEX_URL,
  resolveCisuReviewedLineage,
} from '../../src/caseGraph/cisuSourceLineage';

describe('CISU and Euro UFO Index source lineage', () => {
  it('treats the legacy CISU label as a shared secondary index', () => {
    expect(CISU_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-cisu-uapcheck-lineage-v1');
    expect(resolveCisuReviewedLineage('cisu')).toEqual({
      source: 'CISU',
      lineageId: 'governance:uapcheck:euro-ufo-index-2024',
      sourcePosition: 'secondary',
      originality: 'derived',
      publisher: CISU_PUBLISHER,
      publicationMode: 'metadata_link_only',
      storedLegacyRowsAreSharedIndex: true,
      componentOrganisationRequired: true,
      componentOrganisationIsIndependentSource: false,
      rawIndexStorageAllowed: false,
      normalizedIndexStorageAllowed: false,
      narrativeStorageAllowed: false,
      independentCorroborationAllowed: false,
      evidenceUrls: [CISU_CATALOGUE_URL, EURO_UFO_INDEX_URL],
    });
  });

  it('does not absorb other contributors merely because they occur in the index', () => {
    expect(resolveCisuReviewedLineage('NUFORC')).toBeNull();
    expect(resolveCisuReviewedLineage('GEIPAN')).toBeNull();
    expect(resolveCisuReviewedLineage('GEP')).toBeNull();
  });
});
