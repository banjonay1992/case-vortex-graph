export const CANADIAN_UFO_SURVEY_SOURCE_LINEAGE_POLICY_VERSION = 'case-vortex-canadian-ufo-survey-source-lineage-v1' as const;
export const CANADIAN_UFO_SURVEY_PUBLISHER = 'Ufology Research' as const;
export const CANADIAN_UFO_SURVEY_DATA_URL = 'https://www.canadianuforeport.com/data.html' as const;

export type CanadianUfoSurveyReviewedLineagePolicy = {
  source: 'CANADIAN_UFO_SURVEY';
  lineageId: 'governance:canadian-ufo-survey:mixed-compilation';
  sourcePosition: 'secondary';
  originality: 'derived';
  publisher: typeof CANADIAN_UFO_SURVEY_PUBLISHER;
  evidenceUrl: typeof CANADIAN_UFO_SURVEY_DATA_URL;
  recordLevelSourceReferenceAvailable: true;
  recordLevelOriginatingRecordResolved: false;
  independentCorroborationAllowed: false;
};

const normalize = (value: string) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');

export const resolveCanadianUfoSurveyReviewedLineage = (
  sourceValue: string,
): CanadianUfoSurveyReviewedLineagePolicy | null => {
  if (normalize(sourceValue) !== 'CANADIAN_UFO_SURVEY') return null;
  return {
    source: 'CANADIAN_UFO_SURVEY',
    lineageId: 'governance:canadian-ufo-survey:mixed-compilation',
    sourcePosition: 'secondary',
    originality: 'derived',
    publisher: CANADIAN_UFO_SURVEY_PUBLISHER,
    evidenceUrl: CANADIAN_UFO_SURVEY_DATA_URL,
    recordLevelSourceReferenceAvailable: true,
    recordLevelOriginatingRecordResolved: false,
    independentCorroborationAllowed: false,
  };
};

export const classifyCanadianUfoSurveyReportedSource = (sourceReference: string | null) => {
  const normalizedSourceReference = normalize(sourceReference || '');
  return {
    normalizedSourceReference: normalizedSourceReference || null,
    knownLineageId: normalizedSourceReference === 'NUFORC'
      ? 'governance:nuforc-derived'
      : null,
  };
};
