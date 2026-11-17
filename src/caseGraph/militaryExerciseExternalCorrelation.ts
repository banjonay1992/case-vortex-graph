import type { CaseGraphExternalCorrelationProviderAdapter } from './externalCorrelationProviderAdapters';

const fail = (code: string): never => { throw new Error(code); };

/**
 * Military exercise data has no defensible structured provider in the current
 * governed corpus. Keeping an explicit adapter makes the distinction visible
 * in every nine-category assessment without fabricating coverage.
 */
export const createUnavailableMilitaryExerciseExternalCorrelationAdapter = (): CaseGraphExternalCorrelationProviderAdapter => ({
  category: 'military_exercise',
  correlate: async (request) => {
    if (request.signal?.aborted) fail('case_graph_research_aborted');
    return {
      availability: 'unavailable',
      reasonCodes: ['structured_military_exercise_provider_unavailable'],
      explanation: 'No publication-pinned, governed structured military-exercise provider is available. Exercises, restricted activity and training operations were not checked or ruled out.',
      source: null,
      candidates: [],
    };
  },
});
