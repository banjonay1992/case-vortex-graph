import { createHash } from "node:crypto";

import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputAccounting,
  type RelationshipInputFact,
  type RelationshipInputRecord,
} from "./relationshipInputSnapshot";
import type { RelationshipInputSnapshotManifest } from "./relationshipInputArchive";
import {
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_MODEL_ID,
  TYPED_RELATIONSHIP_MODEL_SHA256,
  TYPED_RELATIONSHIP_MODEL_VERSION,
  TYPED_RELATIONSHIP_POLICY,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_RARITY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  type TypedRelationshipEdgeType,
  type TypedRelationshipRarityIndex,
} from "./typedRelationshipEngine";
import {
  FULL_CORPUS_ADDRESS_KINDS,
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  FULL_CORPUS_TYPED_EDGE_TYPES,
  type FullCorpusAddressKind,
  type FullCorpusPipelineLineage,
  type FullCorpusPostingKind,
  type FullCorpusSpaceTimeHome,
} from "./typedRelationshipPipelineTypes";

export const MATCHABLE_FAMILIES = [
  "visual",
  "behavioural",
  "sensory",
  "entity",
  "site",
  "narrative_pattern",
] as const;
export const NEGATED_PREDICATE =
  /(^|_)(?:no|not|without|absent|denied|denies|negated|ruled_out)(?:_|$)/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type MatchableFamily = (typeof MATCHABLE_FAMILIES)[number];

export const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const digestValue = (value: unknown) => relationshipInputSha256(value);

export function invalid(code: string): never {
  throw new Error(code);
}

export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const requireExactKeys = (
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    invalid(code);
  return value;
};

export const parsePipelineObject = (
  input: Buffer | string | unknown,
  code: string,
): Record<string, unknown> => {
  let value: unknown = input;
  if (Buffer.isBuffer(input) || typeof input === "string") {
    try {
      value = JSON.parse(
        Buffer.isBuffer(input) ? input.toString("utf8") : input,
      );
    } catch {
      invalid(`${code}_json_invalid`);
    }
  }
  if (!isPlainObject(value)) invalid(`${code}_invalid`);
  return value;
};

export const addressKind = (address: string): FullCorpusAddressKind => {
  const kind = address.slice(0, address.indexOf(":")) as FullCorpusAddressKind;
  if (!FULL_CORPUS_ADDRESS_KINDS.includes(kind))
    invalid("full_corpus_relationship_address_kind_invalid");
  return kind;
};

export const emptyKindCounts = (): Record<FullCorpusAddressKind, number> => ({
  sighting: 0,
  document: 0,
  photo: 0,
  video: 0,
});

export const emptyEdgeTypeCounts = (): Record<
  TypedRelationshipEdgeType,
  number
> =>
  Object.fromEntries(
    FULL_CORPUS_TYPED_EDGE_TYPES.map((edgeType) => [edgeType, 0]),
  ) as Record<TypedRelationshipEdgeType, number>;

export const normalizeShardCount = (value: number, code: string) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) invalid(code);
  return value;
};

export const fullCorpusRelationshipShard = (
  value: string,
  shardCount: number,
) => {
  normalizeShardCount(
    shardCount,
    "full_corpus_relationship_shard_count_invalid",
  );
  return (
    createHash("sha256").update(value).digest().readUInt32BE(0) % shardCount
  );
};

export const pairKeyFor = (left: string, right: string) => {
  const addresses = [left, right].sort(compareText);
  if (addresses[0] === addresses[1])
    invalid("full_corpus_relationship_pair_requires_distinct_addresses");
  return `pair:${digestValue(addresses)}`;
};

export const routeSignature = (kind: FullCorpusPostingKind, token: unknown) =>
  `route:${kind}:${digestValue(token)}`;

export const decodeFullCorpusPipelineLineage = (
  lineage: FullCorpusPipelineLineage,
  expected?: FullCorpusPipelineLineage,
): FullCorpusPipelineLineage => {
  requireExactKeys(
    lineage,
    [
      "binding",
      "pipelineVersion",
      "relationshipInputManifestDigest",
      "relationshipInputArchiveSetSha256",
      "relationshipInputRecordSetSha256",
      "rarityIndexDigest",
      "typedRelationshipSchemaVersion",
      "typedRelationshipRarityVersion",
      "typedRelationshipPolicyVersion",
      "typedRelationshipPolicySha256",
      "typedRelationshipModel",
      "typedRelationshipModelSha256",
    ],
    "full_corpus_relationship_lineage_invalid",
  );
  requireExactKeys(
    lineage.binding,
    [
      "snapshotId",
      "corpusVersion",
      "universeArchiveVersion",
      "universeSchemaVersion",
      "universeLayoutVersion",
      "universeArchiveSetSha256",
      "universeRecordCount",
    ],
    "full_corpus_relationship_lineage_binding_invalid",
  );
  const binding = validateRelationshipInputBinding(lineage.binding);
  for (const digest of [
    lineage.relationshipInputManifestDigest,
    lineage.relationshipInputArchiveSetSha256,
    lineage.relationshipInputRecordSetSha256,
    lineage.rarityIndexDigest,
    lineage.typedRelationshipPolicySha256,
    lineage.typedRelationshipModelSha256,
  ])
    if (!SHA256_PATTERN.test(digest))
      invalid("full_corpus_relationship_lineage_digest_invalid");
  requireExactKeys(
    lineage.typedRelationshipModel,
    ["modelId", "modelVersion", "method"],
    "full_corpus_relationship_model_lineage_invalid",
  );
  if (
    lineage.pipelineVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    lineage.typedRelationshipSchemaVersion !==
      TYPED_RELATIONSHIP_SCHEMA_VERSION ||
    lineage.typedRelationshipRarityVersion !==
      TYPED_RELATIONSHIP_RARITY_VERSION ||
    lineage.typedRelationshipPolicyVersion !==
      TYPED_RELATIONSHIP_POLICY_VERSION ||
    lineage.typedRelationshipPolicySha256 !==
      TYPED_RELATIONSHIP_POLICY_SHA256 ||
    lineage.typedRelationshipModel.modelId !== TYPED_RELATIONSHIP_MODEL_ID ||
    lineage.typedRelationshipModel.modelVersion !==
      TYPED_RELATIONSHIP_MODEL_VERSION ||
    lineage.typedRelationshipModel.method !== TYPED_RELATIONSHIP_MODEL.method ||
    canonicalizeRelationshipInput(lineage.typedRelationshipModel) !==
      canonicalizeRelationshipInput(TYPED_RELATIONSHIP_MODEL) ||
    lineage.typedRelationshipModelSha256 !== TYPED_RELATIONSHIP_MODEL_SHA256
  )
    invalid("full_corpus_relationship_policy_lineage_mismatch");
  const normalized: FullCorpusPipelineLineage = { ...lineage, binding };
  if (
    expected &&
    canonicalizeRelationshipInput(normalized) !==
      canonicalizeRelationshipInput(expected)
  ) {
    invalid("full_corpus_relationship_lineage_mismatch");
  }
  return normalized;
};

export const validateLineage = decodeFullCorpusPipelineLineage;

export const buildLineage = (
  manifest: RelationshipInputSnapshotManifest,
  rarity: TypedRelationshipRarityIndex,
): FullCorpusPipelineLineage => ({
  binding: manifest.binding,
  pipelineVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  relationshipInputManifestDigest: manifest.manifestDigest,
  relationshipInputArchiveSetSha256: manifest.archiveSetSha256,
  relationshipInputRecordSetSha256: rarity.recordSetSha256,
  rarityIndexDigest: rarity.indexDigest,
  typedRelationshipSchemaVersion: TYPED_RELATIONSHIP_SCHEMA_VERSION,
  typedRelationshipRarityVersion: TYPED_RELATIONSHIP_RARITY_VERSION,
  typedRelationshipPolicyVersion: TYPED_RELATIONSHIP_POLICY_VERSION,
  typedRelationshipPolicySha256: TYPED_RELATIONSHIP_POLICY_SHA256,
  typedRelationshipModel: TYPED_RELATIONSHIP_MODEL,
  typedRelationshipModelSha256: TYPED_RELATIONSHIP_MODEL_SHA256,
});

export const recordSetDigest = (records: readonly RelationshipInputRecord[]) =>
  digestValue(
    records
      .map((record) => `${record.address}:${record.recordDigest}`)
      .join("\n"),
  );

export const rarityRecordSetDigest = (
  records: readonly { address: string; recordDigest: string }[],
) =>
  digestValue(
    records.map((record) => ({
      address: record.address,
      recordDigest: record.recordDigest,
    })),
  );

export const sameAccounting = (
  left: RelationshipInputAccounting,
  right: RelationshipInputAccounting,
) =>
  canonicalizeRelationshipInput(left) === canonicalizeRelationshipInput(right);

export const factIdentity = (
  fact: RelationshipInputFact,
): {
  family: MatchableFamily;
  valueId: string;
  registryVersion: string;
  valueKey: string;
} | null => {
  if (
    !MATCHABLE_FAMILIES.includes(fact.family as MatchableFamily) ||
    fact.value === null
  )
    return null;
  let valueId: string;
  let registryVersion: string;
  if (fact.value.kind === "term") {
    valueId = fact.value.termId;
    registryVersion = fact.value.vocabularyVersion;
  } else if (fact.value.kind === "governed_reference") {
    valueId = fact.value.governedId;
    registryVersion = fact.value.registryVersion;
  } else if (fact.value.kind === "narrative_pattern") {
    valueId = fact.value.patternId;
    registryVersion = fact.value.registryVersion;
  } else return null;
  const family = fact.family as MatchableFamily;
  return {
    family,
    valueId,
    registryVersion,
    valueKey: `value:${digestValue({ family, valueId, registryVersion })}`,
  };
};

export const factMayRoute = (fact: RelationshipInputFact) =>
  fact.value !== null &&
  fact.confidence !== null &&
  fact.missingness.status === "present" &&
  !NEGATED_PREDICATE.test(fact.predicate.toLowerCase());

export const selectedTimestamps = (record: RelationshipInputRecord) =>
  record.facts.filter(
    (fact) =>
      factMayRoute(fact) &&
      fact.family === "space_time" &&
      fact.value?.kind === "timestamp" &&
      [
        "event_timestamp",
        "event_time",
        "observation_timestamp",
        "occurred_at",
      ].includes(fact.predicate),
  );

export const selectedLocations = (record: RelationshipInputRecord) =>
  record.facts.filter(
    (fact) =>
      factMayRoute(fact) &&
      fact.family === "space_time" &&
      fact.value?.kind === "geo_point" &&
      ["event_location", "observation_location"].includes(fact.predicate),
  );

export const ecefHome = (
  timestamp: string,
  lat: number,
  lon: number,
): FullCorpusSpaceTimeHome | null => {
  const milliseconds = new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return null;
  const radiusKm = 6_371.0088;
  const latRadians = (lat * Math.PI) / 180;
  const lonRadians = (lon * Math.PI) / 180;
  return {
    time: Math.floor(
      milliseconds /
        1_000 /
        TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperSeconds,
    ),
    x: Math.floor(
      (radiusKm * Math.cos(latRadians) * Math.cos(lonRadians)) /
        TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres,
    ),
    y: Math.floor(
      (radiusKm * Math.cos(latRadians) * Math.sin(lonRadians)) /
        TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres,
    ),
    z: Math.floor(
      (radiusKm * Math.sin(latRadians)) /
        TYPED_RELATIONSHIP_POLICY.maximumSpaceTimeUpperKilometres,
    ),
  };
};

export const durationHome = (seconds: number) =>
  Math.floor(
    Math.log(seconds) /
      Math.log(1 / TYPED_RELATIONSHIP_POLICY.minimumDurationSimilarity),
  );
