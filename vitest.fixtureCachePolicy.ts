const PUBLICATION_V2_FIXTURE_TESTS = [
  'tests/caseGraph/authoritativePublicationManifestEvidence.test.ts',
  'tests/caseGraph/calibrationCandidatePool.test.ts',
  'tests/caseGraph/fullCorpusTypedOrchestration.test.ts',
  'tests/caseGraph/postgresCaseGraphControlPlaneV2.test.ts',
  'tests/caseGraph/postgresResearchSearch.test.ts',
  'tests/caseGraph/publicAccess.test.ts',
  'tests/caseGraph/publicationArchive.test.ts',
  'tests/caseGraph/publicationManifest.test.ts',
  'tests/caseGraph/researchSearchArchive.test.ts',
  'tests/caseGraph/researchToolContract.test.ts',
] as const;

const normalize = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
const testTarget = (value: string) => {
  const normalized = normalize(value);
  const marker = normalized.lastIndexOf('tests/');
  return marker >= 0 ? normalized.slice(marker) : normalized;
};

const isFixtureTarget = (value: string) => {
  const target = testTarget(value).replace(/\/+$/, '');
  return PUBLICATION_V2_FIXTURE_TESTS.some((fixturePath) => {
    const fixture = normalize(fixturePath);
    return target.endsWith(fixture) || fixture.startsWith(`${target}/`);
  });
};

/**
 * The immutable Publication V2 fixture takes more than Vitest's worker RPC
 * heartbeat to construct. Full runs and focused suites that exercise it get a
 * one-time pre-worker cache; unrelated focused tests keep their fast startup.
 */
export const shouldUsePublicationV2FixtureCache = (argv: readonly string[]) => {
  // An exclusion is not a selected test. Treating its following path as a
  // positional filter disabled the shared fixture for broad filtered runs,
  // rebuilding the same large corpus independently in every worker.
  const selectedArguments: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--exclude') { index += 1; continue; }
    if (argv[index].startsWith('--exclude=')) continue;
    selectedArguments.push(argv[index]);
  }
  // Client, Worker and colocated source tests are focused runs too. Ignoring
  // them treats a tiny UI/helper check as a full corpus run and builds a very
  // large fixture unnecessarily on developer machines.
  const requestedTests = selectedArguments.map(testTarget).filter((value) => !value.startsWith('--') && (
    value.startsWith('tests/') || /\.test\.[cm]?[jt]sx?$/.test(value)
    || /^(?:client\/src|src|workers)(?:\/[^.]*)?\/?$/.test(value)
  ));
  return requestedTests.length === 0 || requestedTests.some(isFixtureTarget);
};
