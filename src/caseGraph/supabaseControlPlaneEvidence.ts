import { getCaseGraphPublicationKeys } from './archiveKeys';
import {
  type CaseVortexFullRunPublication,
} from './fullRunReport';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_SUPABASE_CONTROL_PLANE_OBSERVATION_VERSION =
  'case-vortex-supabase-control-plane-observation-v1' as const;
export const CASE_VORTEX_SUPABASE_CONTROL_PLANE_MAX_AGE_MS = 60 * 60 * 1_000;

export type CaseVortexSupabaseControlPlaneObservationInput = {
  observedAt: string;
  serverVersionNum: number;
  transactionReadOnly: boolean;
  publicationId: string;
  runId: string;
  corpusVersion: string;
  publicManifestKey: string;
  publicManifestSha256: string;
  active: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
  activePublicationCount: number;
  runStatus: string;
  lineageVersion: string;
  runSnapshotId: string;
  runCompletionManifestSha256: string;
  runCorpusAccountingDigest: string;
  runGraphArtifactSetSha256: string;
  receiptVersion: string;
  receiptSnapshotId: string;
  receiptPublicManifestSha256: string;
  receiptCompletionManifestSha256: string;
  receiptCorpusAccountingDigest: string;
  receiptGraphArtifactSetSha256: string;
};

export type CaseVortexSupabaseControlPlaneObservation =
  CaseVortexSupabaseControlPlaneObservationInput & {
    recordType: 'case_vortex_supabase_control_plane_observation';
    schemaVersion: typeof CASE_VORTEX_SUPABASE_CONTROL_PLANE_OBSERVATION_VERSION;
    guarantees: {
      databaseReads: 'one-bounded-read-only-transaction';
      databaseWrites: 0;
      storageReads: 0;
      storageWrites: 0;
      lunaCalls: 0;
      publicationActivations: 0;
      deployments: 0;
    };
    observationSha256: string;
  };

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const fail = (code: string): never => { throw new Error(code); };
const exactTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40) return fail(code);
  try {
    if (new Date(value).toISOString() !== value) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
};
const exactCount = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(code);
  return Number(value);
};
const exactText = (value: unknown, pattern: RegExp, code: string) => {
  if (typeof value !== 'string' || !pattern.test(value)) return fail(code);
  return value;
};

export const buildCaseVortexSupabaseControlPlaneObservation = (
  input: CaseVortexSupabaseControlPlaneObservationInput,
): CaseVortexSupabaseControlPlaneObservation => {
  const observedAt = exactTimestamp(
    input.observedAt,
    'case_vortex_supabase_control_plane_observed_at_invalid',
  );
  const publicationId = exactText(
    input.publicationId,
    UUID,
    'case_vortex_supabase_control_plane_publication_invalid',
  );
  const runId = exactText(
    input.runId,
    UUID,
    'case_vortex_supabase_control_plane_run_invalid',
  );
  const corpusVersion = exactText(
    input.corpusVersion,
    VERSION,
    'case_vortex_supabase_control_plane_corpus_invalid',
  );
  const manifestSha256 = exactText(
    input.publicManifestSha256,
    SHA256,
    'case_vortex_supabase_control_plane_manifest_invalid',
  );
  const digestFields = [
    input.runCompletionManifestSha256,
    input.runCorpusAccountingDigest,
    input.runGraphArtifactSetSha256,
    input.receiptPublicManifestSha256,
    input.receiptCompletionManifestSha256,
    input.receiptCorpusAccountingDigest,
    input.receiptGraphArtifactSetSha256,
  ];
  if (digestFields.some((value) => typeof value !== 'string' || !SHA256.test(value))) {
    fail('case_vortex_supabase_control_plane_lineage_digest_invalid');
  }
  if (!Number.isSafeInteger(input.serverVersionNum) || input.serverVersionNum < 170_000
    || input.transactionReadOnly !== true) {
    fail('case_vortex_supabase_control_plane_database_boundary_invalid');
  }
  const activePublicationCount = exactCount(
    input.activePublicationCount,
    'case_vortex_supabase_control_plane_active_count_invalid',
  );
  if (input.publicManifestKey !== getCaseGraphPublicationKeys(corpusVersion).manifestKey
    || input.active !== false
    || input.activatedAt !== null
    || input.deactivatedAt !== null
    || activePublicationCount !== 0) {
    fail('case_vortex_supabase_control_plane_candidate_state_invalid');
  }
  if (input.runStatus !== 'completed'
    || input.lineageVersion !== 'case-vortex-lineage-v2'
    || input.receiptVersion !== 'case-vortex-publication-receipt-v2'
    || !UUID.test(input.runSnapshotId)
    || input.receiptSnapshotId !== input.runSnapshotId
    || input.receiptPublicManifestSha256 !== manifestSha256
    || input.receiptCompletionManifestSha256 !== input.runCompletionManifestSha256
    || input.receiptCorpusAccountingDigest !== input.runCorpusAccountingDigest
    || input.receiptGraphArtifactSetSha256 !== input.runGraphArtifactSetSha256) {
    fail('case_vortex_supabase_control_plane_verified_v2_lineage_invalid');
  }
  const body = {
    recordType: 'case_vortex_supabase_control_plane_observation' as const,
    schemaVersion: CASE_VORTEX_SUPABASE_CONTROL_PLANE_OBSERVATION_VERSION,
    observedAt,
    serverVersionNum: input.serverVersionNum,
    transactionReadOnly: true,
    publicationId,
    runId,
    corpusVersion,
    publicManifestKey: input.publicManifestKey,
    publicManifestSha256: manifestSha256,
    active: false,
    activatedAt: null,
    deactivatedAt: null,
    activePublicationCount,
    runStatus: 'completed',
    lineageVersion: 'case-vortex-lineage-v2',
    runSnapshotId: input.runSnapshotId,
    runCompletionManifestSha256: input.runCompletionManifestSha256,
    runCorpusAccountingDigest: input.runCorpusAccountingDigest,
    runGraphArtifactSetSha256: input.runGraphArtifactSetSha256,
    receiptVersion: 'case-vortex-publication-receipt-v2',
    receiptSnapshotId: input.receiptSnapshotId,
    receiptPublicManifestSha256: input.receiptPublicManifestSha256,
    receiptCompletionManifestSha256: input.receiptCompletionManifestSha256,
    receiptCorpusAccountingDigest: input.receiptCorpusAccountingDigest,
    receiptGraphArtifactSetSha256: input.receiptGraphArtifactSetSha256,
    guarantees: {
      databaseReads: 'one-bounded-read-only-transaction' as const,
      databaseWrites: 0 as const,
      storageReads: 0 as const,
      storageWrites: 0 as const,
      lunaCalls: 0 as const,
      publicationActivations: 0 as const,
      deployments: 0 as const,
    },
  };
  return { ...body, observationSha256: relationshipInputSha256(body) };
};

const INPUT_KEYS: ReadonlyArray<keyof CaseVortexSupabaseControlPlaneObservationInput> = [
  'observedAt', 'serverVersionNum', 'transactionReadOnly', 'publicationId', 'runId',
  'corpusVersion', 'publicManifestKey', 'publicManifestSha256', 'active', 'activatedAt',
  'deactivatedAt', 'activePublicationCount', 'runStatus', 'lineageVersion', 'runSnapshotId',
  'runCompletionManifestSha256', 'runCorpusAccountingDigest', 'runGraphArtifactSetSha256',
  'receiptVersion', 'receiptSnapshotId', 'receiptPublicManifestSha256',
  'receiptCompletionManifestSha256', 'receiptCorpusAccountingDigest',
  'receiptGraphArtifactSetSha256',
];

export const verifyCaseVortexSupabaseControlPlaneObservation = (
  value: unknown,
): CaseVortexSupabaseControlPlaneObservation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_supabase_control_plane_observation_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const exactKeys = [
    'recordType', 'schemaVersion', ...INPUT_KEYS, 'guarantees', 'observationSha256',
  ];
  if (Object.keys(candidate).length !== exactKeys.length
    || exactKeys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
    || candidate.recordType !== 'case_vortex_supabase_control_plane_observation'
    || candidate.schemaVersion !== CASE_VORTEX_SUPABASE_CONTROL_PLANE_OBSERVATION_VERSION
    || typeof candidate.observationSha256 !== 'string'
    || !SHA256.test(candidate.observationSha256)) {
    return fail('case_vortex_supabase_control_plane_observation_invalid');
  }
  const rebuiltInput = Object.fromEntries(
    INPUT_KEYS.map((key) => [key, candidate[key]]),
  ) as unknown as CaseVortexSupabaseControlPlaneObservationInput;
  const rebuilt = buildCaseVortexSupabaseControlPlaneObservation(rebuiltInput);
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    fail('case_vortex_supabase_control_plane_observation_derived_fields_invalid');
  }
  return rebuilt;
};

export const verifyFreshCaseVortexSupabaseControlPlaneObservation = (input: {
  observation: unknown;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
}) => {
  const observation = verifyCaseVortexSupabaseControlPlaneObservation(input.observation);
  const verifiedAt = exactTimestamp(
    input.verifiedAt,
    'case_vortex_supabase_control_plane_verified_at_invalid',
  );
  if (observation.publicationId !== input.publication.publicationId
    || observation.corpusVersion !== input.publication.corpusVersion
    || observation.publicManifestSha256 !== input.publication.manifestSha256) {
    fail('case_vortex_supabase_control_plane_publication_mismatch');
  }
  const age = new Date(verifiedAt).getTime() - new Date(observation.observedAt).getTime();
  if (age < 0 || age > CASE_VORTEX_SUPABASE_CONTROL_PLANE_MAX_AGE_MS) {
    fail('case_vortex_supabase_control_plane_observation_stale');
  }
  return observation;
};
