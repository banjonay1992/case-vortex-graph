import { describe, expect, it } from 'vitest';

import {
  GEIPAN_CLASSIFICATION_URL,
  GEIPAN_CSV_PUBLICATION_URL,
  GEIPAN_LEGAL_NOTICE_URL,
  GEIPAN_PUBLISHER,
  GEIPAN_SOURCE_LINEAGE_POLICY_VERSION,
  resolveGeipanReviewedLineage,
} from '../../src/caseGraph/geipanSourceLineage';

describe('CNES GEIPAN source lineage', () => {
  it('maps both stored labels to the official mixed-evidence catalogue lineage', () => {
    expect(GEIPAN_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-geipan-source-lineage-v1');
    for (const source of ['GEIPAN', 'fr geipan']) {
      expect(resolveGeipanReviewedLineage(source)).toEqual({
        source: 'GEIPAN',
        lineageId: 'governance:cnes-geipan:official-case-catalogue',
        sourcePosition: 'mixed',
        originality: 'original',
        publisher: GEIPAN_PUBLISHER,
        publicationMode: 'metadata_link_only',
        officialInvestigationAndClassification: true,
        underlyingWitnessClaimsMixed: true,
        classificationIsIdentificationOutcomeNotTruthScore: true,
        rawCatalogueStorageAllowed: false,
        narrativeSummaryStorageAllowed: false,
        witnessMediaStorageAllowed: false,
        independentCorroborationAllowed: false,
        evidenceUrls: [GEIPAN_LEGAL_NOTICE_URL, GEIPAN_CSV_PUBLICATION_URL, GEIPAN_CLASSIFICATION_URL],
      });
    }
  });

  it('does not classify unrelated French sources as GEIPAN', () => {
    expect(resolveGeipanReviewedLineage('GEP')).toBeNull();
  });
});
