import {
  ASTRONOMY_ENGINE_CONTEXT_ACCURACY_DEG,
  ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION,
  ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
  buildAstronomyEngineContext,
} from '../services/tracking/astronomyEngineContext';
import {
  verifyContextualSourceGovernanceDecisionPacket,
} from './contextualSourceGovernanceDecision';
import {
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';

export const ASTRONOMY_CALIBRATION_OBSERVATION_ARCHIVE_VERSION =
  'case-vortex-astronomy-calibration-observation-archive-v1' as const;

type SourceMaterial = {
  rawRecord: {
    kind: string;
    recordId: string;
    eventTimestamp: string | null;
    lat: number | null;
    lon: number | null;
  };
  relationshipRecord: RelationshipInputRecord;
};

export type AstronomyCalibrationObservationArchive = {
  recordType: 'astronomy_calibration_observation_archive';
  schemaVersion: typeof ASTRONOMY_CALIBRATION_OBSERVATION_ARCHIVE_VERSION;
  materializedAt: string;
  binding: RelationshipInputUniverseBinding;
  decisionPacketDigest: string;
  decisionEntryDigest: string;
  sourceMaterialsSha256: string;
  source: {
    canonicalSource: 'ASTRONOMY_ENGINE_LOCAL';
    providerId: typeof ASTRONOMY_ENGINE_CONTEXT_PROVIDER;
    datasetVersion: typeof ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION;
    evidenceUrl: 'https://github.com/cosinekitty/astronomy';
    licenseType: 'MIT';
    attributionRequired: true;
    ephemerisAccuracyDeg: typeof ASTRONOMY_ENGINE_CONTEXT_ACCURACY_DEG;
  };
  summary: {
    inputRecordCount: number;
    eligibleSubjectCount: number;
    observationCount: number;
    skippedRecordCount: number;
    skippedByReason: Record<string, number>;
    subjectSkyPositionRecordedCount: 0;
    subjectSkyPositionMissingCount: number;
  };
  records: Array<{
    subjectAddress: string;
    relationshipRecordDigest: string;
    eventTimestamp: string;
    observer: { lat: number; lon: number; altitudeM: 0 };
    subjectSkyPositionStatus: 'not_recorded';
    objects: Array<{
      key: 'sun' | 'moon';
      label: 'Sun' | 'Moon';
      bearingDeg: number;
      elevationDeg: number;
      distanceKm: number;
      illuminationFraction: number;
      visible: boolean;
    }>;
    modelInputSha256: string;
    modelOutputSha256: string;
    recordDigest: string;
  }>;
  recordSetSha256: string;
  archiveDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value as string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const increment = (counts: Record<string, number>, reason: string) => {
  counts[reason] = (counts[reason] || 0) + 1;
};

const observationObjects = (
  context: ReturnType<typeof buildAstronomyEngineContext>,
): AstronomyCalibrationObservationArchive['records'][number]['objects'] => context
  .filter((object) => object.object_key === 'sun' || object.object_key === 'moon')
  .map((object) => {
  if ((object.object_key !== 'sun' && object.object_key !== 'moon')
    || (object.label !== 'Sun' && object.label !== 'Moon')
    || typeof object.bearing_deg !== 'number'
    || typeof object.elevation_deg !== 'number'
    || typeof object.distance_km !== 'number'
    || typeof object.illumination_fraction !== 'number'
    || typeof object.visible !== 'boolean') {
    invalid('astronomy_calibration_observation_output_invalid');
  }
  return {
    key: object.object_key as 'sun' | 'moon',
    label: object.label as 'Sun' | 'Moon',
    bearingDeg: object.bearing_deg as number,
    elevationDeg: object.elevation_deg as number,
    distanceKm: object.distance_km as number,
    illuminationFraction: object.illumination_fraction as number,
    visible: object.visible as boolean,
  };
  });

export const buildAstronomyCalibrationObservationArchive = (params: {
  binding: unknown;
  decisionPacket: unknown;
  sourceMaterials: unknown;
  sourceMaterialsSha256: string;
  materializedAt: string;
}): AstronomyCalibrationObservationArchive => {
  const binding = validateRelationshipInputBinding(params.binding);
  const packet = verifyContextualSourceGovernanceDecisionPacket(params.decisionPacket);
  if (!SHA256.test(params.sourceMaterialsSha256)) {
    invalid('astronomy_calibration_source_materials_digest_invalid');
  }
  const materializedAt = timestamp(
    params.materializedAt,
    'astronomy_calibration_materialized_at_invalid',
  );
  const decisionEntries = packet.entries.filter((entry) => (
    entry.category === 'astronomy'
    && entry.canonicalSource === 'ASTRONOMY_ENGINE_LOCAL'
    && entry.providerId === ASTRONOMY_ENGINE_CONTEXT_PROVIDER
  ));
  if (decisionEntries.length !== 1
    || decisionEntries[0].decision !== 'approved'
    || !decisionEntries[0].usableNow
    || decisionEntries[0].registry.legalStatus !== 'approved'
    || !decisionEntries[0].registry.allowedContentModes.includes('derived_only')) {
    invalid('astronomy_calibration_source_not_approved');
  }
  const sourceMaterials = params.sourceMaterials;
  if (!isPlainObject(sourceMaterials)
    || !Array.isArray(sourceMaterials.records)) {
    invalid('astronomy_calibration_source_materials_invalid');
  }

  const materials = (sourceMaterials as Record<string, unknown>).records as SourceMaterial[];
  const skippedByReason: Record<string, number> = {};
  const records: AstronomyCalibrationObservationArchive['records'] = [];
  for (const material of materials) {
    if (!isPlainObject(material)
      || !isPlainObject(material.rawRecord)
      || !isPlainObject(material.relationshipRecord)) {
      invalid('astronomy_calibration_source_material_invalid');
    }
    const subject = decodeRelationshipInputRecord(material.relationshipRecord, binding);
    const raw = material.rawRecord;
    if (`${raw.kind}:${raw.recordId}` !== subject.address) {
      invalid('astronomy_calibration_subject_identity_mismatch');
    }
    if (typeof raw.eventTimestamp !== 'string') {
      increment(skippedByReason, 'event_timestamp_missing');
      continue;
    }
    const parsedTime = new Date(raw.eventTimestamp);
    if (!Number.isFinite(parsedTime.getTime())
      || parsedTime.toISOString() !== raw.eventTimestamp) {
      increment(skippedByReason, 'event_timestamp_invalid');
      continue;
    }
    if (typeof raw.lat !== 'number' || !Number.isFinite(raw.lat)
      || typeof raw.lon !== 'number' || !Number.isFinite(raw.lon)) {
      increment(skippedByReason, 'observer_coordinates_missing');
      continue;
    }
    const modelInput = {
      subjectAddress: subject.address,
      eventTimestamp: raw.eventTimestamp,
      observer: { lat: raw.lat, lon: raw.lon, altitudeM: 0 as const },
      providerId: ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
      datasetVersion: ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION,
    };
    const objects = observationObjects(buildAstronomyEngineContext({
      lat: raw.lat,
      lon: raw.lon,
      altitudeM: 0,
      capturedAtIso: raw.eventTimestamp,
      headingDeg: null,
    }));
    const core = {
      subjectAddress: subject.address,
      relationshipRecordDigest: subject.recordDigest,
      eventTimestamp: raw.eventTimestamp,
      observer: { lat: raw.lat, lon: raw.lon, altitudeM: 0 as const },
      subjectSkyPositionStatus: 'not_recorded' as const,
      objects,
      modelInputSha256: relationshipInputSha256(modelInput),
      modelOutputSha256: relationshipInputSha256(objects),
    };
    records.push({ ...core, recordDigest: relationshipInputSha256(core) });
  }
  records.sort((left, right) => lexical(left.subjectAddress, right.subjectAddress));
  const recordSetSha256 = relationshipInputSha256(
    records.map(({ subjectAddress, recordDigest }) => `${subjectAddress}:${recordDigest}`),
  );
  const skippedRecordCount = materials.length - records.length;
  const body: Omit<AstronomyCalibrationObservationArchive, 'archiveDigest'> = {
    recordType: 'astronomy_calibration_observation_archive',
    schemaVersion: ASTRONOMY_CALIBRATION_OBSERVATION_ARCHIVE_VERSION,
    materializedAt,
    binding,
    decisionPacketDigest: packet.packetDigest,
    decisionEntryDigest: decisionEntries[0].entryDigest,
    sourceMaterialsSha256: params.sourceMaterialsSha256,
    source: {
      canonicalSource: 'ASTRONOMY_ENGINE_LOCAL',
      providerId: ASTRONOMY_ENGINE_CONTEXT_PROVIDER,
      datasetVersion: ASTRONOMY_ENGINE_CONTEXT_MODEL_VERSION,
      evidenceUrl: 'https://github.com/cosinekitty/astronomy',
      licenseType: 'MIT',
      attributionRequired: true,
      ephemerisAccuracyDeg: ASTRONOMY_ENGINE_CONTEXT_ACCURACY_DEG,
    },
    summary: {
      inputRecordCount: materials.length,
      eligibleSubjectCount: records.length,
      observationCount: records.reduce((sum, record) => sum + record.objects.length, 0),
      skippedRecordCount,
      skippedByReason: Object.fromEntries(
        Object.entries(skippedByReason).sort(([left], [right]) => lexical(left, right)),
      ),
      subjectSkyPositionRecordedCount: 0,
      subjectSkyPositionMissingCount: records.length,
    },
    records,
    recordSetSha256,
  };
  return { ...body, archiveDigest: relationshipInputSha256(body) };
};
