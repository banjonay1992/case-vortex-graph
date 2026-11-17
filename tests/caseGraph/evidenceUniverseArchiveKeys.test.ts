import { describe, expect, it } from 'vitest';

import { getEvidenceUniverseControlKeys, getEvidenceUniversePartKeys } from '../../src/caseGraph/archiveKeys';

describe('evidence universe archive keys', () => {
  it('uses immutable kind-qualified R2 paths', () => {
    expect(getEvidenceUniversePartKeys('2026-07-17-vortex-v3', 'photo', 12)).toEqual({
      archiveKey: 'case-vortex/corpora/2026-07-17-vortex-v3/universe/nodes/photo/part-000012.ndjson.gz',
      manifestKey: 'case-vortex/corpora/2026-07-17-vortex-v3/universe/nodes/photo/part-000012.manifest.json',
    });
    expect(getEvidenceUniverseControlKeys('2026-07-17-vortex-v3').completionManifestKey)
      .toBe('case-vortex/corpora/2026-07-17-vortex-v3/universe/nodes/_complete.manifest.json');
  });

  it('rejects invalid kinds and part numbers', () => {
    expect(() => getEvidenceUniversePartKeys('v3', 'audio' as any, 0)).toThrow('evidence_universe_kind_invalid');
    expect(() => getEvidenceUniversePartKeys('v3', 'video', -1)).toThrow('evidence_universe_part_number_invalid');
  });
});
