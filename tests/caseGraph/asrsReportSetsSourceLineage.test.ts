import { describe, expect, it } from 'vitest';
import { ASRS_REPORT_SETS_LINEAGE_ID, ASRS_REPORT_SETS_SOURCE_LINEAGE_POLICY_VERSION, resolveAsrsReportSetsReviewedLineage } from '../../src/caseGraph/asrsReportSetsSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('NASA ASRS report-set lineage', () => {
  it('classifies rotating report sets as contextual official archive records', () => {
    expect(ASRS_REPORT_SETS_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-asrs-report-sets-lineage-v1');
    expect(resolveAsrsReportSetsReviewedLineage('ASRS_REPORTSETS')).toMatchObject({
      lineageId: ASRS_REPORT_SETS_LINEAGE_ID, sourcePosition: 'mixed', originality: 'original',
      publicationMode: 'metadata_link_only_until_immutable_source_receipt',
      recordClass: 'contextual_aviation_safety_report', isSightingRecord: false,
      narrativeStorageRequiresImmutableSourceReceipt: true, independentCorroborationAllowed: false, reportSetIsRotating: true,
    });
    expect(resolveCaseGraphSource('NASA ASRS')).toMatchObject({ id: 'asrs_reportsets', family: 'official', role: 'archive' });
    expect(caseGraphSourcesShareLineage('ASRS', 'ASRS_REPORTSETS')).toBe(true);
    expect(caseGraphSourcesShareLineage('ASRS', 'AARO')).toBe(false);
  });
});
