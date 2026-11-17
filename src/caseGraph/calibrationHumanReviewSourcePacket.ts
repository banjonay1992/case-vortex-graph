import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseRawRecord,
} from './evidenceUniverse';
import type { CalibrationHumanReviewPack } from './calibrationHumanReview';
import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputRecord,
} from './relationshipInputSnapshot';

export const CALIBRATION_HUMAN_REVIEW_SOURCE_PACKET_VERSION =
  'case-graph-calibration-human-review-source-packet-v1' as const;

export type CalibrationHumanReviewSourceMaterial = {
  address: string;
  node: EvidenceUniverseNode;
  relationshipRecord: RelationshipInputRecord;
  materialDigest: string;
};

export type CalibrationHumanReviewSourcePacket = {
  recordType: 'calibration_human_review_source_packet';
  schemaVersion: typeof CALIBRATION_HUMAN_REVIEW_SOURCE_PACKET_VERSION;
  purpose: 'blinded_source_reconstruction_not_review_evidence';
  packDigest: string;
  lockedInputSha256: string;
  materials: CalibrationHumanReviewSourceMaterial[];
  materialSetSha256: string;
  packetDigest: string;
};

export type CalibrationHumanReviewSourcePacketDraft = {
  records: Array<{
    rawRecord: EvidenceUniverseRawRecord;
    relationshipRecord: unknown;
  }>;
};

export type CalibrationHumanReviewSourceMaterialSet = {
  materials: CalibrationHumanReviewSourceMaterial[];
  materialSetSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };
const object = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as Record<string, unknown>;
};
const exact = (value: unknown, keys: readonly string[], code: string) => {
  const record = object(value, code);
  if (Object.keys(record).sort().join('\0') !== [...keys].sort().join('\0')) invalid(code);
  return record;
};
const parse = (value: unknown, code: string) => {
  if (Buffer.isBuffer(value) || typeof value === 'string') {
    try { return JSON.parse(value.toString()); } catch { invalid(code); }
  }
  return value;
};
const canonicalEqual = (left: unknown, right: unknown) => (
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right)
);

const requiredAddresses = (pack: CalibrationHumanReviewPack) => {
  const addresses = new Set<string>();
  pack.pairCandidates.forEach((candidate) => candidate.evaluation.addresses.forEach((address) => addresses.add(address)));
  pack.contextualCandidates.forEach((candidate) => addresses.add(candidate.candidate.subjectAddress));
  return [...addresses].sort(compare);
};

const expectedPairRecordDigests = (pack: CalibrationHumanReviewPack) => {
  const expected = new Map<string, string>();
  for (const candidate of pack.pairCandidates) {
    candidate.evaluation.addresses.forEach((address, index) => {
      const digest = candidate.evaluation.inputRecordDigests[index];
      const previous = expected.get(address);
      if (previous && previous !== digest) invalid('calibration_human_review_source_record_digest_conflict');
      expected.set(address, digest);
    });
  }
  return expected;
};

const normalizeNode = (value: unknown): EvidenceUniverseNode => {
  const node = object(value, 'calibration_human_review_source_node_invalid') as unknown as EvidenceUniverseNode;
  const rebuilt = projectEvidenceUniverseNode({
    kind: node.kind,
    recordId: node.recordId,
    source: node.source,
    sourceRecordId: node.sourceRecordId,
    title: node.title,
    summary: node.summary,
    canonicalUrl: node.canonicalUrl,
    previewUrl: node.previewUrl,
    eventTimestamp: node.eventTimestamp,
    lat: node.lat,
    lon: node.lon,
    location: node.location,
    countryCode: node.countryCode,
    linkedSightingId: node.linkedSightingId,
    updatedAt: node.updatedAt,
    public: true,
  });
  if (node.schemaVersion !== EVIDENCE_UNIVERSE_SCHEMA_VERSION
    || node.layoutVersion !== EVIDENCE_UNIVERSE_LAYOUT_VERSION
    || !canonicalEqual(node, rebuilt)) invalid('calibration_human_review_source_node_invalid');
  return rebuilt;
};

const materialWithoutDigest = (material: Omit<CalibrationHumanReviewSourceMaterial, 'materialDigest'>) => material;
const packetWithoutDigest = (packet: Omit<CalibrationHumanReviewSourcePacket, 'packetDigest'>) => packet;

const normalizeMaterials = (
  pack: CalibrationHumanReviewPack,
  values: unknown[],
): CalibrationHumanReviewSourceMaterial[] => {
  const expectedAddresses = requiredAddresses(pack);
  const expectedDigests = expectedPairRecordDigests(pack);
  const materials = values.map((value) => {
    const raw = exact(value, ['address', 'node', 'relationshipRecord', 'materialDigest'],
      'calibration_human_review_source_material_invalid');
    const node = normalizeNode(raw.node);
    const relationshipRecord = decodeRelationshipInputRecord(raw.relationshipRecord, pack.pairLineage.binding);
    const address = String(raw.address || '');
    if (address !== node.address || address !== relationshipRecord.address) {
      invalid('calibration_human_review_source_material_address_mismatch');
    }
    const expectedRecordDigest = expectedDigests.get(address);
    if (expectedRecordDigest && relationshipRecord.recordDigest !== expectedRecordDigest) {
      invalid('calibration_human_review_source_record_digest_mismatch');
    }
    const withoutDigest = { address, node, relationshipRecord };
    const materialDigest = relationshipInputSha256(materialWithoutDigest(withoutDigest));
    if (raw.materialDigest !== materialDigest) invalid('calibration_human_review_source_material_digest_mismatch');
    return { ...withoutDigest, materialDigest };
  }).sort((left, right) => compare(left.address, right.address));
  if (new Set(materials.map(({ address }) => address)).size !== materials.length
    || !canonicalEqual(materials.map(({ address }) => address), expectedAddresses)) {
    invalid('calibration_human_review_source_material_set_incomplete');
  }
  return materials;
};

export const calculateCalibrationHumanReviewSourceMaterialSet = (
  pack: CalibrationHumanReviewPack,
  draft: CalibrationHumanReviewSourcePacketDraft,
): CalibrationHumanReviewSourceMaterialSet => {
  if (!Array.isArray(draft.records)) invalid('calibration_human_review_source_packet_draft_invalid');
  const materials = draft.records.map(({ rawRecord, relationshipRecord }) => {
    const node = projectEvidenceUniverseNode(rawRecord);
    if (!rawRecord.public) invalid('calibration_human_review_source_record_not_public');
    const decoded = decodeRelationshipInputRecord(relationshipRecord, pack.pairLineage.binding);
    const base = { address: node.address, node, relationshipRecord: decoded };
    return { ...base, materialDigest: relationshipInputSha256(materialWithoutDigest(base)) };
  });
  const normalizedMaterials = normalizeMaterials(pack, materials);
  return {
    materials: normalizedMaterials,
    materialSetSha256: relationshipInputSha256(
      normalizedMaterials.map(({ materialDigest }) => materialDigest),
    ),
  };
};

export const buildCalibrationHumanReviewSourcePacket = (
  pack: CalibrationHumanReviewPack,
  draft: CalibrationHumanReviewSourcePacketDraft,
): CalibrationHumanReviewSourcePacket => {
  const {
    materials: normalizedMaterials,
    materialSetSha256,
  } = calculateCalibrationHumanReviewSourceMaterialSet(pack, draft);
  if (pack.sourceEvidence.evidenceOrigin === 'governed_locked_holdout_candidates'
    && pack.sourceEvidence.sourceSha256 !== materialSetSha256) {
    invalid('calibration_human_review_governed_source_material_set_unbound');
  }
  const base = {
    recordType: 'calibration_human_review_source_packet' as const,
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SOURCE_PACKET_VERSION,
    purpose: 'blinded_source_reconstruction_not_review_evidence' as const,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    materials: normalizedMaterials,
    materialSetSha256,
  };
  return { ...base, packetDigest: relationshipInputSha256(packetWithoutDigest(base)) };
};

export const decodeCalibrationHumanReviewSourcePacket = (
  pack: CalibrationHumanReviewPack,
  input: unknown,
): CalibrationHumanReviewSourcePacket => {
  const raw = exact(parse(input, 'calibration_human_review_source_packet_json_invalid'), [
    'recordType', 'schemaVersion', 'purpose', 'packDigest', 'lockedInputSha256',
    'materials', 'materialSetSha256', 'packetDigest',
  ], 'calibration_human_review_source_packet_invalid');
  if (raw.recordType !== 'calibration_human_review_source_packet'
    || raw.schemaVersion !== CALIBRATION_HUMAN_REVIEW_SOURCE_PACKET_VERSION
    || raw.purpose !== 'blinded_source_reconstruction_not_review_evidence'
    || raw.packDigest !== pack.packDigest
    || raw.lockedInputSha256 !== pack.lockedInputSha256
    || !Array.isArray(raw.materials)) invalid('calibration_human_review_source_packet_invalid');
  const materials = normalizeMaterials(pack, raw.materials as unknown[]);
  const materialSetSha256 = relationshipInputSha256(materials.map(({ materialDigest }) => materialDigest));
  if (pack.sourceEvidence.evidenceOrigin === 'governed_locked_holdout_candidates'
    && pack.sourceEvidence.sourceSha256 !== materialSetSha256) {
    invalid('calibration_human_review_governed_source_material_set_unbound');
  }
  if (raw.materialSetSha256 !== materialSetSha256 || !SHA256.test(String(raw.materialSetSha256))) {
    invalid('calibration_human_review_source_material_set_digest_mismatch');
  }
  const base = {
    recordType: 'calibration_human_review_source_packet' as const,
    schemaVersion: CALIBRATION_HUMAN_REVIEW_SOURCE_PACKET_VERSION,
    purpose: 'blinded_source_reconstruction_not_review_evidence' as const,
    packDigest: pack.packDigest,
    lockedInputSha256: pack.lockedInputSha256,
    materials,
    materialSetSha256,
  };
  const packetDigest = relationshipInputSha256(packetWithoutDigest(base));
  if (raw.packetDigest !== packetDigest || !SHA256.test(String(raw.packetDigest))) {
    invalid('calibration_human_review_source_packet_digest_mismatch');
  }
  return { ...base, packetDigest };
};

export const serializeCalibrationHumanReviewSourcePacket = (
  pack: CalibrationHumanReviewPack,
  packet: CalibrationHumanReviewSourcePacket,
) => `${canonicalizeRelationshipInput(decodeCalibrationHumanReviewSourcePacket(pack, packet))}\n`;
