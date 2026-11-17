import { createHash } from 'node:crypto';

import {
  type CaseVortexFullRunPublication,
} from './fullRunReport';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CASE_VORTEX_R2_ARTIFACT_REPLAY_OBSERVATION_VERSION =
  'case-vortex-r2-artifact-replay-observation-v1' as const;
export const CASE_VORTEX_R2_ARTIFACT_REPLAY_MAX_AGE_MS = 60 * 60 * 1_000;
export const CASE_VORTEX_R2_ARTIFACT_REPLAY_OBJECT_COUNT = 13;

export type CaseVortexR2ReplayObject = {
  key: string;
  versionSha256: string;
  bodySha256: string;
  bodyBytes: number;
};

export type CaseVortexR2ArtifactReplayObservation = {
  recordType: 'case_vortex_r2_artifact_replay_observation';
  schemaVersion: typeof CASE_VORTEX_R2_ARTIFACT_REPLAY_OBSERVATION_VERSION;
  observedAt: string;
  publication: CaseVortexFullRunPublication;
  storageProvider: 'cloudflare-r2-s3';
  objects: CaseVortexR2ReplayObject[];
  objectCount: typeof CASE_VORTEX_R2_ARTIFACT_REPLAY_OBJECT_COUNT;
  totalBodyBytes: number;
  objectSetSha256: string;
  guarantees: {
    storageReads: typeof CASE_VORTEX_R2_ARTIFACT_REPLAY_OBJECT_COUNT;
    storageWrites: 0;
    databaseReads: 0;
    databaseWrites: 0;
    lunaCalls: 0;
    publicationActivations: 0;
    deployments: 0;
  };
  observationSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const KEY = /^[\x21-\x7e]{1,1024}$/u;
const fail = (code: string): never => { throw new Error(code); };
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.length > 40) return fail(code);
  try {
    if (new Date(value).toISOString() !== value) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
};
const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
const safeCount = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(code);
  return Number(value);
};
const rawSha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export const r2ReplayObjectFromVersionedBody = (input: {
  key: string;
  version: string;
  body: Buffer;
}): CaseVortexR2ReplayObject => {
  if (!KEY.test(input.key) || typeof input.version !== 'string' || !input.version
    || input.version.length > 1_024 || /[\r\n]/u.test(input.version)
    || !Buffer.isBuffer(input.body) || input.body.byteLength < 2
    || input.body.byteLength > 96 * 1024 * 1024) {
    fail('case_vortex_r2_artifact_replay_object_invalid');
  }
  return {
    key: input.key,
    versionSha256: rawSha256(input.version),
    bodySha256: rawSha256(input.body),
    bodyBytes: input.body.byteLength,
  };
};

export const buildCaseVortexR2ArtifactReplayObservation = (input: {
  observedAt: string;
  publication: CaseVortexFullRunPublication;
  objects: CaseVortexR2ReplayObject[];
}): CaseVortexR2ArtifactReplayObservation => {
  const observedAt = timestamp(
    input.observedAt,
    'case_vortex_r2_artifact_replay_observed_at_invalid',
  );
  if (!input.publication || !UUID.test(input.publication.publicationId)
    || !VERSION.test(input.publication.corpusVersion)
    || !SHA256.test(input.publication.manifestSha256)) {
    fail('case_vortex_r2_artifact_replay_publication_invalid');
  }
  if (!Array.isArray(input.objects)
    || input.objects.length !== CASE_VORTEX_R2_ARTIFACT_REPLAY_OBJECT_COUNT) {
    fail('case_vortex_r2_artifact_replay_object_count_invalid');
  }
  const objects = input.objects.map((object) => {
    if (!object || !KEY.test(object.key)
      || !SHA256.test(object.versionSha256)
      || !SHA256.test(object.bodySha256)) {
      return fail('case_vortex_r2_artifact_replay_object_invalid');
    }
    return {
      key: object.key,
      versionSha256: object.versionSha256,
      bodySha256: object.bodySha256,
      bodyBytes: safeCount(
        object.bodyBytes,
        'case_vortex_r2_artifact_replay_object_invalid',
      ),
    };
  }).sort((left, right) => compareText(left.key, right.key));
  if (new Set(objects.map(({ key }) => key)).size !== objects.length
    || objects.some(({ bodyBytes }) => bodyBytes < 2 || bodyBytes > 96 * 1024 * 1024)) {
    fail('case_vortex_r2_artifact_replay_object_invalid');
  }
  const totalBodyBytes = objects.reduce((sum, object) => sum + object.bodyBytes, 0);
  if (!Number.isSafeInteger(totalBodyBytes) || totalBodyBytes > 256 * 1024 * 1024) {
    fail('case_vortex_r2_artifact_replay_total_bytes_invalid');
  }
  const objectSetSha256 = relationshipInputSha256(objects);
  const body = {
    recordType: 'case_vortex_r2_artifact_replay_observation' as const,
    schemaVersion: CASE_VORTEX_R2_ARTIFACT_REPLAY_OBSERVATION_VERSION,
    observedAt,
    publication: { ...input.publication },
    storageProvider: 'cloudflare-r2-s3' as const,
    objects,
    objectCount: CASE_VORTEX_R2_ARTIFACT_REPLAY_OBJECT_COUNT as 13,
    totalBodyBytes,
    objectSetSha256,
    guarantees: {
      storageReads: CASE_VORTEX_R2_ARTIFACT_REPLAY_OBJECT_COUNT as 13,
      storageWrites: 0 as const,
      databaseReads: 0 as const,
      databaseWrites: 0 as const,
      lunaCalls: 0 as const,
      publicationActivations: 0 as const,
      deployments: 0 as const,
    },
  };
  return { ...body, observationSha256: relationshipInputSha256(body) };
};

export const verifyCaseVortexR2ArtifactReplayObservation = (
  value: unknown,
): CaseVortexR2ArtifactReplayObservation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('case_vortex_r2_artifact_replay_observation_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    'recordType', 'schemaVersion', 'observedAt', 'publication', 'storageProvider',
    'objects', 'objectCount', 'totalBodyBytes', 'objectSetSha256', 'guarantees',
    'observationSha256',
  ];
  if (Object.keys(candidate).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
    || candidate.recordType !== 'case_vortex_r2_artifact_replay_observation'
    || candidate.schemaVersion !== CASE_VORTEX_R2_ARTIFACT_REPLAY_OBSERVATION_VERSION
    || candidate.storageProvider !== 'cloudflare-r2-s3'
    || typeof candidate.observationSha256 !== 'string'
    || !SHA256.test(candidate.observationSha256)
    || typeof candidate.objectSetSha256 !== 'string'
    || !SHA256.test(candidate.objectSetSha256)) {
    return fail('case_vortex_r2_artifact_replay_observation_invalid');
  }
  const rebuilt = buildCaseVortexR2ArtifactReplayObservation({
    observedAt: candidate.observedAt as string,
    publication: candidate.publication as CaseVortexFullRunPublication,
    objects: candidate.objects as CaseVortexR2ReplayObject[],
  });
  if (relationshipInputSha256(candidate) !== relationshipInputSha256(rebuilt)) {
    fail('case_vortex_r2_artifact_replay_observation_derived_fields_invalid');
  }
  return rebuilt;
};

export const verifyFreshCaseVortexR2ArtifactReplayObservation = (input: {
  observation: unknown;
  publication: CaseVortexFullRunPublication;
  verifiedAt: string;
}) => {
  const observation = verifyCaseVortexR2ArtifactReplayObservation(input.observation);
  const verifiedAt = timestamp(
    input.verifiedAt,
    'case_vortex_r2_artifact_replay_verified_at_invalid',
  );
  if (observation.publication.publicationId !== input.publication.publicationId
    || observation.publication.corpusVersion !== input.publication.corpusVersion
    || observation.publication.manifestSha256 !== input.publication.manifestSha256) {
    fail('case_vortex_r2_artifact_replay_publication_mismatch');
  }
  const age = new Date(verifiedAt).getTime() - new Date(observation.observedAt).getTime();
  if (age < 0 || age > CASE_VORTEX_R2_ARTIFACT_REPLAY_MAX_AGE_MS) {
    fail('case_vortex_r2_artifact_replay_observation_stale');
  }
  return observation;
};
