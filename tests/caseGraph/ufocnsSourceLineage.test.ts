import { describe, expect, it } from 'vitest';
import { resolveUfocnsReviewedLineage, UFOCNS_LINEAGE_ID, UFOCNS_SOURCE_LINEAGE_POLICY_VERSION } from '../../src/caseGraph/ufocnsSourceLineage';
import { caseGraphSourcesShareLineage, resolveCaseGraphSource } from '../../src/caseGraph/sourceRegistry';

describe('UFOCNS governed platform lineage', () => {
  it('classifies the mixed forum as a live reference rather than canonical evidence', () => {
    expect(UFOCNS_SOURCE_LINEAGE_POLICY_VERSION).toBe('case-vortex-ufocns-platform-lineage-v1');
    expect(resolveUfocnsReviewedLineage('UFOCNS')).toMatchObject({
      lineageId: UFOCNS_LINEAGE_ID, sourcePosition: 'mixed', originality: 'unknown',
      publicationMode: 'platform_reference_only', eventTimeStatus: 'post_time_not_event_time',
      canonicalContentStorageAllowed: false, independentCorroborationAllowed: false, requiresLiveAvailability: true,
    });
    expect(resolveCaseGraphSource('UFO CNS')).toMatchObject({ id: 'ufocns', family: 'community', role: 'submission_channel', lineageId: UFOCNS_LINEAGE_ID });
    expect(caseGraphSourcesShareLineage('UFOCNS', 'UFO CNS')).toBe(true);
    expect(caseGraphSourcesShareLineage('UFOCNS', 'REDDIT_UFO')).toBe(false);
  });
});
