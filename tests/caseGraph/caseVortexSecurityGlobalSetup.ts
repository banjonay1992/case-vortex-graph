import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';

import { buildPublicationV2Fixture } from './publicationV2TestSupport';

export default function caseVortexSecurityGlobalSetup() {
  const previousCache = process.env.CASE_VORTEX_PUBLICATION_V2_FIXTURE_CACHE;
  const cacheDirectory = mkdtempSync(join(tmpdir(), 'case-vortex-security-fixture-'));
  const cachePath = join(cacheDirectory, 'publication-v2.v8');
  try {
    writeFileSync(cachePath, serialize(buildPublicationV2Fixture()));
  } catch (error) {
    // Vitest never receives our teardown when setup fails (including ENOSPC).
    // Remove only the temporary directory created by this invocation.
    rmSync(cacheDirectory, { force: true, recursive: true });
    throw error;
  }
  process.env.CASE_VORTEX_PUBLICATION_V2_FIXTURE_CACHE = cachePath;

  return () => {
    // A nested/focused runner may inherit another invocation's valid cache.
    // Restore it only while this invocation still owns the environment value.
    if (process.env.CASE_VORTEX_PUBLICATION_V2_FIXTURE_CACHE === cachePath) {
      if (previousCache === undefined) delete process.env.CASE_VORTEX_PUBLICATION_V2_FIXTURE_CACHE;
      else process.env.CASE_VORTEX_PUBLICATION_V2_FIXTURE_CACHE = previousCache;
    }
    rmSync(cacheDirectory, { force: true, recursive: true });
  };
}
