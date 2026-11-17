import { describe, expect, it } from 'vitest';

import {
  CANADIAN_UFO_SURVEY_SOURCE_LINEAGE_POLICY_VERSION,
  classifyCanadianUfoSurveyReportedSource,
  resolveCanadianUfoSurveyReviewedLineage,
} from '../../src/caseGraph/canadianUfoSurveySourceLineage';

describe('Canadian UFO Survey reviewed source lineage', () => {
  it('classifies the survey as a civilian mixed secondary compilation', () => {
    expect(CANADIAN_UFO_SURVEY_SOURCE_LINEAGE_POLICY_VERSION)
      .toBe('case-vortex-canadian-ufo-survey-source-lineage-v1');
    expect(resolveCanadianUfoSurveyReviewedLineage(' canadian ufo survey ')).toMatchObject({
      source: 'CANADIAN_UFO_SURVEY',
      lineageId: 'governance:canadian-ufo-survey:mixed-compilation',
      sourcePosition: 'secondary',
      originality: 'derived',
      publisher: 'Ufology Research',
      recordLevelSourceReferenceAvailable: true,
      recordLevelOriginatingRecordResolved: false,
      independentCorroborationAllowed: false,
    });
    expect(resolveCanadianUfoSurveyReviewedLineage('CANADA_GOV')).toBeNull();
  });

  it('retains reported sub-sources without inventing record-level resolution', () => {
    expect(classifyCanadianUfoSurveyReportedSource(' NUFORC ')).toEqual({
      normalizedSourceReference: 'NUFORC',
      knownLineageId: 'governance:nuforc-derived',
    });
    expect(classifyCanadianUfoSurveyReportedSource('HBCCUFO')).toEqual({
      normalizedSourceReference: 'HBCCUFO',
      knownLineageId: null,
    });
    expect(classifyCanadianUfoSurveyReportedSource(null)).toEqual({
      normalizedSourceReference: null,
      knownLineageId: null,
    });
  });
});
