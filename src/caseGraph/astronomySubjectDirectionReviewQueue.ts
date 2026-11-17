import { createHash } from 'node:crypto';
import type { AstronomyCalibrationObservationArchive } from './astronomyCalibrationObservationArchive';
import {
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
} from './relationshipInputSnapshot';

export const ASTRONOMY_SUBJECT_DIRECTION_REVIEW_QUEUE_VERSION =
  'case-vortex-astronomy-subject-direction-review-queue-v1' as const;

type SourceMaterial = {
  rawRecord: {
    kind: string;
    recordId: string;
    title?: string | null;
    summary?: string | null;
    canonicalUrl?: string | null;
  };
  relationshipRecord: RelationshipInputRecord;
};

export type AstronomySubjectDirectionReviewQueue = {
  recordType: 'astronomy_subject_direction_review_queue';
  schemaVersion: typeof ASTRONOMY_SUBJECT_DIRECTION_REVIEW_QUEUE_VERSION;
  queuedAt: string;
  binding: AstronomyCalibrationObservationArchive['binding'];
  astronomyArchiveDigest: string;
  astronomyRecordSetSha256: string;
  sourceMaterialsSha256: string;
  extraction: {
    method: 'deterministic_candidate_scan';
    version: typeof ASTRONOMY_SUBJECT_DIRECTION_REVIEW_QUEUE_VERSION;
    semantics: 'candidate_phrase_not_sky_position';
  };
  candidates: Array<{
    candidateId: string;
    subjectAddress: string;
    relationshipRecordDigest: string;
    sourceField: 'title' | 'summary';
    sourceUrl: string | null;
    sourceText: string;
    sourceTextSha256: string;
    span: {
      unit: 'utf8_byte';
      start: number;
      end: number;
      text: string;
      textSha256: string;
    };
    normalizedDirection:
      | 'north' | 'northeast' | 'east' | 'southeast'
      | 'south' | 'southwest' | 'west' | 'northwest';
    disposition: 'pending_human_review';
    ambiguityReasons: [
      'may_describe_motion_location_or_viewing_direction',
      'no_automatic_azimuth_or_elevation',
    ];
    candidateDigest: string;
  }>;
  summary: {
    eligibleSubjectCount: number;
    candidateSubjectCount: number;
    candidatePhraseCount: number;
    noCandidateSubjectCount: number;
    admittedSkyPositionCount: 0;
  };
  guarantees: {
    automaticAzimuthAssignments: 0;
    automaticElevationAssignments: 0;
    contextualEdgesCreated: 0;
    humanAdjudicationsCreated: 0;
    providerCalls: 0;
    databaseWrites: 0;
    storageWrites: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  candidateSetSha256: string;
  queueDigest: string;
};

const DIRECTION = /\b(?:north(?:east|west)?|south(?:east|west)?|east|west|ne|nw|se|sw)\b/giu;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SOURCE_MATERIAL_BYTES = 256 * 1024 * 1024;
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const normalizeDirection = (
  value: string,
): AstronomySubjectDirectionReviewQueue['candidates'][number]['normalizedDirection'] => {
  const normalized = value.toLowerCase();
  const aliases: Record<string, ReturnType<typeof normalizeDirection>> = {
    n: 'north',
    north: 'north',
    ne: 'northeast',
    northeast: 'northeast',
    e: 'east',
    east: 'east',
    se: 'southeast',
    southeast: 'southeast',
    s: 'south',
    south: 'south',
    sw: 'southwest',
    southwest: 'southwest',
    w: 'west',
    west: 'west',
    nw: 'northwest',
    northwest: 'northwest',
  };
  return aliases[normalized] || invalid('astronomy_direction_token_invalid');
};

const verifyArchive = (value: unknown): AstronomyCalibrationObservationArchive => {
  if (!isPlainObject(value)
    || value.recordType !== 'astronomy_calibration_observation_archive'
    || !Array.isArray(value.records)
    || typeof value.archiveDigest !== 'string'
    || !SHA256.test(value.archiveDigest)) {
    invalid('astronomy_direction_archive_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { archiveDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== archiveDigest) {
    invalid('astronomy_direction_archive_digest_mismatch');
  }
  return value as unknown as AstronomyCalibrationObservationArchive;
};

const timestamp = (value: unknown) => {
  if (typeof value !== 'string') invalid('astronomy_direction_queued_at_invalid');
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid('astronomy_direction_queued_at_invalid');
  }
  return value as string;
};

export const buildAstronomySubjectDirectionReviewQueue = (params: {
  astronomyArchive: unknown;
  sourceMaterialsBytes: Buffer | string;
  queuedAt: string;
}): AstronomySubjectDirectionReviewQueue => {
  const archive = verifyArchive(params.astronomyArchive);
  const binding = validateRelationshipInputBinding(archive.binding);
  const sourceMaterialsBytes = Buffer.isBuffer(params.sourceMaterialsBytes)
    ? Buffer.from(params.sourceMaterialsBytes)
    : Buffer.from(params.sourceMaterialsBytes, 'utf8');
  if (!sourceMaterialsBytes.length
    || sourceMaterialsBytes.length > MAX_SOURCE_MATERIAL_BYTES
    || createHash('sha256').update(sourceMaterialsBytes).digest('hex')
      !== archive.sourceMaterialsSha256) {
    invalid('astronomy_direction_source_materials_mismatch');
  }
  const sourceText = sourceMaterialsBytes.toString('utf8');
  if (sourceText.includes('\uFFFD')) invalid('astronomy_direction_source_materials_utf8_invalid');
  let sourceMaterialsValue: unknown;
  try {
    sourceMaterialsValue = JSON.parse(sourceText);
  } catch {
    invalid('astronomy_direction_source_materials_json_invalid');
  }
  if (!isPlainObject(sourceMaterialsValue) || !Array.isArray(sourceMaterialsValue.records)) {
    invalid('astronomy_direction_source_materials_invalid');
  }
  const sourceMaterials = sourceMaterialsValue as { records: unknown[] };
  const eligible = new Map(archive.records.map((record) => [
    record.subjectAddress,
    record.relationshipRecordDigest,
  ]));
  if (eligible.size !== archive.records.length) invalid('astronomy_direction_archive_duplicate_subject');
  const candidates: AstronomySubjectDirectionReviewQueue['candidates'] = [];
  const seenSourceAddresses = new Set<string>();

  for (const value of sourceMaterials.records) {
    if (!isPlainObject(value)
      || !isPlainObject(value.rawRecord)
      || !isPlainObject(value.relationshipRecord)) {
      invalid('astronomy_direction_source_material_invalid');
    }
    const material = value as unknown as SourceMaterial;
    const record = decodeRelationshipInputRecord(material.relationshipRecord, binding);
    const address = `${material.rawRecord.kind}:${material.rawRecord.recordId}`;
    if (record.address !== address) invalid('astronomy_direction_subject_identity_mismatch');
    if (seenSourceAddresses.has(address)) invalid('astronomy_direction_duplicate_source_subject');
    seenSourceAddresses.add(address);
    const expectedRecordDigest = eligible.get(address);
    if (!expectedRecordDigest) continue;
    if (record.recordDigest !== expectedRecordDigest) {
      invalid('astronomy_direction_relationship_record_mismatch');
    }

    for (const sourceField of ['title', 'summary'] as const) {
      const sourceText = material.rawRecord[sourceField];
      if (typeof sourceText !== 'string' || !sourceText) continue;
      for (const match of sourceText.matchAll(DIRECTION)) {
        const characterStart = match.index;
        const text = match[0];
        const start = Buffer.byteLength(sourceText.slice(0, characterStart), 'utf8');
        const end = start + Buffer.byteLength(text, 'utf8');
        const core = {
          subjectAddress: address,
          relationshipRecordDigest: record.recordDigest,
          sourceField,
          sourceUrl: typeof material.rawRecord.canonicalUrl === 'string'
            ? material.rawRecord.canonicalUrl
            : null,
          sourceText,
          sourceTextSha256: relationshipInputSha256(sourceText),
          span: {
            unit: 'utf8_byte' as const,
            start,
            end,
            text,
            textSha256: relationshipInputSha256(text),
          },
          normalizedDirection: normalizeDirection(text),
          disposition: 'pending_human_review' as const,
          ambiguityReasons: [
            'may_describe_motion_location_or_viewing_direction',
            'no_automatic_azimuth_or_elevation',
          ] as [
            'may_describe_motion_location_or_viewing_direction',
            'no_automatic_azimuth_or_elevation',
          ],
        };
        const candidateDigest = relationshipInputSha256(core);
        candidates.push({
          candidateId: `astronomy-direction:${candidateDigest}`,
          ...core,
          candidateDigest,
        });
      }
    }
  }
  candidates.sort((left, right) => lexical(left.candidateId, right.candidateId));
  const candidateSubjects = new Set(candidates.map(({ subjectAddress }) => subjectAddress));
  const candidateSetSha256 = relationshipInputSha256(
    candidates.map(({ candidateId, candidateDigest }) => `${candidateId}:${candidateDigest}`),
  );
  const body: Omit<AstronomySubjectDirectionReviewQueue, 'queueDigest'> = {
    recordType: 'astronomy_subject_direction_review_queue',
    schemaVersion: ASTRONOMY_SUBJECT_DIRECTION_REVIEW_QUEUE_VERSION,
    queuedAt: timestamp(params.queuedAt),
    binding,
    astronomyArchiveDigest: archive.archiveDigest,
    astronomyRecordSetSha256: archive.recordSetSha256,
    sourceMaterialsSha256: archive.sourceMaterialsSha256,
    extraction: {
      method: 'deterministic_candidate_scan',
      version: ASTRONOMY_SUBJECT_DIRECTION_REVIEW_QUEUE_VERSION,
      semantics: 'candidate_phrase_not_sky_position',
    },
    candidates,
    summary: {
      eligibleSubjectCount: eligible.size,
      candidateSubjectCount: candidateSubjects.size,
      candidatePhraseCount: candidates.length,
      noCandidateSubjectCount: eligible.size - candidateSubjects.size,
      admittedSkyPositionCount: 0,
    },
    guarantees: {
      automaticAzimuthAssignments: 0,
      automaticElevationAssignments: 0,
      contextualEdgesCreated: 0,
      humanAdjudicationsCreated: 0,
      providerCalls: 0,
      databaseWrites: 0,
      storageWrites: 0,
      publicationMutations: 0,
      deployments: 0,
    },
    candidateSetSha256,
  };
  return { ...body, queueDigest: relationshipInputSha256(body) };
};
