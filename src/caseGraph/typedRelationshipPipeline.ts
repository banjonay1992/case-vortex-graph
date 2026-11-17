import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  type RelationshipInputRecord,
} from "./relationshipInputSnapshot";
import {
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  decodeTypedRelationshipEdge,
  decodeTypedRelationshipPairEvaluation,
  decodeTypedRelationshipRarityIndex,
  evaluateTypedRelationshipPair,
  type TypedRelationshipEdge,
  type TypedRelationshipEdgeType,
  type TypedRelationshipPairEvaluation,
  type TypedRelationshipRarityIndex,
} from "./typedRelationshipEngine";
import {
  assertContextualRelationshipCompletionProductionEligible,
  type ContextualRelationshipCompletionArtifact,
} from "./contextualRelationshipCompletion";
import {
  DEFAULT_FULL_CORPUS_POSTING_CAPS,
  FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  FULL_CORPUS_TYPED_EDGE_TYPES,
} from "./typedRelationshipPipelineTypes";
import type {
  FullCorpusAddressKind,
  FullCorpusAddressLedgerShard,
  FullCorpusAddressState,
  FullCorpusCandidateFragment,
  FullCorpusCandidateReason,
  FullCorpusCandidateReasonCode,
  FullCorpusCandidateRoute,
  FullCorpusContextualCompletionReference,
  FullCorpusPairReducerResult,
  FullCorpusPipelineLineage,
  FullCorpusPostingCaps,
  FullCorpusPostingFragment,
  FullCorpusPostingKind,
  FullCorpusPostingMapManifest,
  FullCorpusPostingShardReduction,
  FullCorpusPresenceRecord,
  FullCorpusRelationshipCompletion,
  FullCorpusRelationshipPosting,
  FullCorpusSkippedGroupReceipt,
  FullCorpusSpaceTimeHome as SpaceTimeHome,
} from "./typedRelationshipPipelineTypes";
import {
  addressKind,
  compareText,
  decodeFullCorpusPipelineLineage,
  digestValue,
  emptyEdgeTypeCounts,
  emptyKindCounts,
  fullCorpusRelationshipShard,
  invalid,
  normalizeShardCount,
  pairKeyFor,
  parsePipelineObject,
  rarityRecordSetDigest,
  requireExactKeys,
  SHA256_PATTERN,
  sha256,
} from "./typedRelationshipPipelineSupport";
import {
  fragmentSummary,
  validatePostingFragment,
} from "./typedRelationshipPipelinePostings";

export {
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
} from "./typedRelationshipPipelinePostings";
export {
  FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  FULL_CORPUS_TYPED_EDGE_TYPES,
} from "./typedRelationshipPipelineTypes";
export type {
  FullCorpusAddressKind,
  FullCorpusAddressLedgerShard,
  FullCorpusAddressState,
  FullCorpusCandidateFragment,
  FullCorpusCandidateReason,
  FullCorpusCandidateReasonCode,
  FullCorpusCandidateRoute,
  FullCorpusContextualCompletionReference,
  FullCorpusPairReducerResult,
  FullCorpusPipelineLineage,
  FullCorpusPostingCaps,
  FullCorpusPostingFragment,
  FullCorpusPostingFragmentSummary,
  FullCorpusPostingKind,
  FullCorpusPostingMapManifest,
  FullCorpusPostingShardReduction,
  FullCorpusPresenceRecord,
  FullCorpusRelationshipCompletion,
  FullCorpusRelationshipPosting,
  FullCorpusSkippedGroupReceipt,
} from "./typedRelationshipPipelineTypes";
export {
  decodeFullCorpusPipelineLineage,
  fullCorpusRelationshipShard,
} from "./typedRelationshipPipelineSupport";

const DEFAULT_CAPS = DEFAULT_FULL_CORPUS_POSTING_CAPS;
const validateLineage = decodeFullCorpusPipelineLineage;
const postingCapFor = (
  kind: FullCorpusPostingKind,
  caps: FullCorpusPostingCaps,
) => {
  switch (kind) {
    case "address_identity":
      return caps.addressIdentity;
    case "source_identity":
      return caps.sourceIdentity;
    case "source_record":
      return caps.sourceRecord;
    case "source_lineage":
      return caps.sourceLineage;
    case "duplicate_cluster":
      return caps.duplicateCluster;
    case "matchable_value":
      return caps.matchableValue;
    case "space_time":
      return caps.spaceTime;
    case "duration":
      return caps.duration;
  }
};

const normalizeCaps = (
  input: Partial<FullCorpusPostingCaps> | undefined,
): FullCorpusPostingCaps => {
  const caps = { ...DEFAULT_CAPS, ...input };
  for (const [key, value] of Object.entries(caps)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000) {
      invalid(`full_corpus_relationship_cap_invalid:${key}`);
    }
  }
  return caps;
};

const chooseTwo = (count: number) =>
  count < 2 ? 0 : (count * (count - 1)) / 2;

const skippedReceipt = (params: {
  lineage: FullCorpusPipelineLineage;
  postingShard: number;
  routeKind: FullCorpusPostingKind;
  routeSignature: string;
  postingCount: number;
  distinctAddressCount: number;
  estimatedPairCount: number;
  configuredPostingCap: number;
  configuredPairCap: number;
  reasonCode: FullCorpusSkippedGroupReceipt["reasonCode"];
}): FullCorpusSkippedGroupReceipt => {
  const plainEnglish =
    params.reasonCode === "direct_target_missing"
      ? "A governed direct reference named an address that was not present in the immutable relationship-input universe. The reference was retained as unresolved and no substitute edge was invented."
      : `This route contained ${params.distinctAddressCount} distinct addresses and could expand to ${params.estimatedPairCount} pairs. It was skipped under the explicit posting and pair caps instead of performing an unbounded quadratic expansion.`;
  const withoutId = {
    recordType: "full_corpus_skipped_group_receipt" as const,
    schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage: params.lineage,
    postingShard: params.postingShard,
    routeKind: params.routeKind,
    routeSignature: params.routeSignature,
    postingCount: params.postingCount,
    distinctAddressCount: params.distinctAddressCount,
    estimatedPairCount: params.estimatedPairCount,
    configuredPostingCap: params.configuredPostingCap,
    configuredPairCap: params.configuredPairCap,
    reasonCode: params.reasonCode,
    plainEnglish,
    claimDiscipline: FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
  };
  return { ...withoutId, receiptId: `skip:${digestValue(withoutId)}` };
};

const reasonPlainEnglish: Record<FullCorpusCandidateReasonCode, string> = {
  explicit_cross_reference:
    "A governed record directly cites, derives from, duplicates, or attaches media to the other evidence address.",
  same_source:
    "Both records use the same governed source. This routes a dependency check, not an independence claim.",
  governed_source_assertion:
    "A governed source assertion names the counterparty source and routes the pair for reciprocal dependency review.",
  same_source_record:
    "Both evidence addresses resolve to the same governed source record.",
  same_source_lineage:
    "Both evidence addresses share a governed ingestion or source lineage.",
  same_duplicate_cluster:
    "Both evidence addresses belong to the same governed duplicate cluster.",
  shared_matchable_value:
    "Both records share a governed categorical value and are routed to the typed rarity and policy evaluator.",
  nearby_space_time_bucket:
    "The records occupy neighboring bounded space-time cells and are routed to exact precision-aware evaluation.",
  similar_duration_bucket:
    "The records occupy neighboring logarithmic duration cells and are routed to exact duration evaluation.",
};

type CandidateAccumulator = {
  left: RelationshipInputRecord;
  right: RelationshipInputRecord;
  reasons: Map<string, FullCorpusCandidateReason>;
};

const makeCandidateReason = (
  code: FullCorpusCandidateReasonCode,
  routeSignatureValue: string,
  evidenceIds: readonly string[],
): FullCorpusCandidateReason => {
  const withoutId = {
    code,
    routeSignature: routeSignatureValue,
    evidenceIds: [...new Set(evidenceIds)].sort(compareText),
    plainEnglish: reasonPlainEnglish[code],
  };
  return {
    ...withoutId,
    reasonId: `candidate-reason:${digestValue(withoutId)}`,
  };
};

const isCanonicalSpaceTimePair = (
  routeToken: string,
  left: FullCorpusRelationshipPosting,
  right: FullCorpusRelationshipPosting,
) => {
  if (!left.spaceTimeHome || !right.spaceTimeHome) return false;
  let route: SpaceTimeHome;
  try {
    route = JSON.parse(routeToken) as SpaceTimeHome;
  } catch {
    return false;
  }
  return (
    route.time ===
      Math.min(left.spaceTimeHome.time, right.spaceTimeHome.time) &&
    route.x === Math.min(left.spaceTimeHome.x, right.spaceTimeHome.x) &&
    route.y === Math.min(left.spaceTimeHome.y, right.spaceTimeHome.y) &&
    route.z === Math.min(left.spaceTimeHome.z, right.spaceTimeHome.z)
  );
};

const isCanonicalDurationPair = (
  routeToken: string,
  left: FullCorpusRelationshipPosting,
  right: FullCorpusRelationshipPosting,
) => {
  if (left.durationHome === null || right.durationHome === null) return false;
  let route: { bucket: number };
  try {
    route = JSON.parse(routeToken) as { bucket: number };
  } catch {
    return false;
  }
  return route.bucket === Math.min(left.durationHome, right.durationHome);
};

const candidateFragmentWithoutDigest = (
  value: Omit<FullCorpusCandidateFragment, "fragmentDigest">,
) => value;

const postingReductionWithoutDigest = (
  value: Omit<FullCorpusPostingShardReduction, "reductionDigest">,
) => value;

export const reduceFullCorpusPostingShard = (params: {
  postingMap: FullCorpusPostingMapManifest;
  fragments: readonly FullCorpusPostingFragment[];
  postingShard: number;
  pairShardCount: number;
  caps?: Partial<FullCorpusPostingCaps>;
}): FullCorpusPostingShardReduction => {
  const postingMap = params.postingMap;
  const lineage = validateLineage(postingMap.lineage);
  const { mapDigest: _mapDigest, ...postingMapWithoutMapDigest } = postingMap;
  if (postingMap.mapDigest !== digestValue(postingMapWithoutMapDigest)) {
    invalid("full_corpus_relationship_posting_map_digest_mismatch");
  }
  if (
    !Number.isSafeInteger(params.postingShard) ||
    params.postingShard < 0 ||
    params.postingShard >= postingMap.postingShardCount
  ) {
    invalid("full_corpus_relationship_posting_shard_invalid");
  }
  const pairShardCount = normalizeShardCount(
    params.pairShardCount,
    "full_corpus_relationship_pair_shard_count_invalid",
  );
  const caps = normalizeCaps(params.caps);
  const expectedSummaries = postingMap.fragments
    .filter((summary) => summary.postingShard === params.postingShard)
    .sort((left, right) => left.inputPartNumber - right.inputPartNumber);
  const fragments = params.fragments
    .map((fragment) =>
      validatePostingFragment(fragment, lineage, postingMap.postingShardCount),
    )
    .sort((left, right) => left.inputPartNumber - right.inputPartNumber);
  if (
    canonicalizeRelationshipInput(fragments.map(fragmentSummary)) !==
    canonicalizeRelationshipInput(expectedSummaries)
  ) {
    invalid("full_corpus_relationship_posting_shard_fragment_set_mismatch");
  }
  if (
    fragments.some((fragment) => fragment.postingShard !== params.postingShard)
  ) {
    invalid("full_corpus_relationship_posting_shard_fragment_mismatch");
  }

  type GroupEntry = {
    record: RelationshipInputRecord;
    posting: FullCorpusRelationshipPosting;
  };
  const groups = new Map<string, GroupEntry[]>();
  const presenceRecords: FullCorpusPresenceRecord[] = [];
  for (const fragment of fragments)
    for (const postingValue of fragment.postings) {
      const record = fragment.records[postingValue.recordIndex];
      const group = groups.get(postingValue.signature) || [];
      group.push({ record, posting: postingValue });
      groups.set(postingValue.signature, group);
      if (
        postingValue.routeKind === "address_identity" &&
        postingValue.reasonCode === null
      ) {
        presenceRecords.push({
          address: record.address,
          recordDigest: record.recordDigest,
          kind: addressKind(record.address),
        });
      }
    }
  presenceRecords.sort((left, right) =>
    compareText(left.address, right.address),
  );
  if (
    new Set(presenceRecords.map((record) => record.address)).size !==
    presenceRecords.length
  ) {
    invalid("full_corpus_relationship_duplicate_presence_record");
  }

  const candidates = new Map<string, CandidateAccumulator>();
  const skippedGroups: FullCorpusSkippedGroupReceipt[] = [];
  let candidateRouteCount = 0;
  const addCandidate = (
    left: RelationshipInputRecord,
    right: RelationshipInputRecord,
    reasonCode: FullCorpusCandidateReasonCode,
    signature: string,
    evidenceIds: readonly string[],
  ) => {
    if (left.address === right.address) return;
    const [orderedLeft, orderedRight] =
      compareText(left.address, right.address) < 0
        ? [left, right]
        : [right, left];
    const pairKey = pairKeyFor(orderedLeft.address, orderedRight.address);
    const accumulator = candidates.get(pairKey) || {
      left: orderedLeft,
      right: orderedRight,
      reasons: new Map<string, FullCorpusCandidateReason>(),
    };
    const reason = makeCandidateReason(reasonCode, signature, evidenceIds);
    if (!accumulator.reasons.has(reason.reasonId)) candidateRouteCount += 1;
    accumulator.reasons.set(reason.reasonId, reason);
    if (
      !candidates.has(pairKey) &&
      candidates.size >= caps.maxCandidatePairsPerPostingShard
    ) {
      invalid("full_corpus_relationship_candidate_pair_cap_exceeded");
    }
    candidates.set(pairKey, accumulator);
  };

  for (const [signature, rawEntries] of [...groups.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const entries = [...rawEntries].sort(
      (left, right) =>
        compareText(left.record.address, right.record.address) ||
        compareText(
          canonicalizeRelationshipInput(left.posting),
          canonicalizeRelationshipInput(right.posting),
        ),
    );
    const routeKind = entries[0].posting.routeKind;
    if (
      entries.some(
        (entry) =>
          entry.posting.routeKind !== routeKind ||
          entry.posting.routeToken !== entries[0].posting.routeToken,
      )
    ) {
      invalid("full_corpus_relationship_mixed_posting_group");
    }
    const byAddress = new Map<string, GroupEntry[]>();
    for (const entry of entries) {
      const list = byAddress.get(entry.record.address) || [];
      list.push(entry);
      byAddress.set(entry.record.address, list);
    }
    const distinctAddresses = [...byAddress.keys()].sort(compareText);
    const identityEntries = entries.filter(
      (entry) => entry.posting.reasonCode === null,
    );
    const assertionEntries = entries.filter(
      (entry) => entry.posting.reasonCode === "governed_source_assertion",
    );
    let estimatedPairCount = chooseTwo(distinctAddresses.length);
    if (routeKind === "address_identity") {
      estimatedPairCount =
        identityEntries.length *
        Math.max(0, distinctAddresses.length - identityEntries.length);
    } else if (routeKind === "source_identity") {
      estimatedPairCount =
        chooseTwo(
          new Set(identityEntries.map((entry) => entry.record.address)).size,
        ) +
        assertionEntries.length * identityEntries.length;
    }
    const postingCap = postingCapFor(routeKind, caps);
    if (
      entries.length > postingCap ||
      estimatedPairCount > caps.maxPairsPerGroup
    ) {
      skippedGroups.push(
        skippedReceipt({
          lineage,
          postingShard: params.postingShard,
          routeKind,
          routeSignature: signature,
          postingCount: entries.length,
          distinctAddressCount: distinctAddresses.length,
          estimatedPairCount,
          configuredPostingCap: postingCap,
          configuredPairCap: caps.maxPairsPerGroup,
          reasonCode: "high_frequency_group_skipped",
        }),
      );
      continue;
    }

    if (routeKind === "address_identity") {
      if (
        !identityEntries.length &&
        entries.some(
          (entry) => entry.posting.reasonCode === "explicit_cross_reference",
        )
      ) {
        skippedGroups.push(
          skippedReceipt({
            lineage,
            postingShard: params.postingShard,
            routeKind,
            routeSignature: signature,
            postingCount: entries.length,
            distinctAddressCount: distinctAddresses.length,
            estimatedPairCount: 0,
            configuredPostingCap: postingCap,
            configuredPairCap: caps.maxPairsPerGroup,
            reasonCode: "direct_target_missing",
          }),
        );
        continue;
      }
      for (const identity of identityEntries)
        for (const reference of entries) {
          if (reference.posting.reasonCode !== "explicit_cross_reference")
            continue;
          addCandidate(
            identity.record,
            reference.record,
            "explicit_cross_reference",
            signature,
            reference.posting.evidenceIds,
          );
        }
      continue;
    }

    if (routeKind === "source_identity") {
      const sourceIdentities = [
        ...new Map(
          identityEntries.map((entry) => [entry.record.address, entry]),
        ).values(),
      ];
      for (let left = 0; left < sourceIdentities.length; left += 1)
        for (
          let right = left + 1;
          right < sourceIdentities.length;
          right += 1
        ) {
          addCandidate(
            sourceIdentities[left].record,
            sourceIdentities[right].record,
            "same_source",
            signature,
            [],
          );
        }
      for (const assertion of assertionEntries)
        for (const identity of sourceIdentities) {
          addCandidate(
            assertion.record,
            identity.record,
            "governed_source_assertion",
            signature,
            assertion.posting.evidenceIds,
          );
        }
      continue;
    }

    for (
      let leftIndex = 0;
      leftIndex < distinctAddresses.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < distinctAddresses.length;
        rightIndex += 1
      ) {
        const leftEntries = byAddress.get(
          distinctAddresses[leftIndex],
        ) as GroupEntry[];
        const rightEntries = byAddress.get(
          distinctAddresses[rightIndex],
        ) as GroupEntry[];
        let selected: [GroupEntry, GroupEntry] | null = null;
        for (const left of leftEntries)
          for (const right of rightEntries) {
            const canonical =
              routeKind === "space_time"
                ? isCanonicalSpaceTimePair(
                    left.posting.routeToken,
                    left.posting,
                    right.posting,
                  )
                : routeKind === "duration"
                  ? isCanonicalDurationPair(
                      left.posting.routeToken,
                      left.posting,
                      right.posting,
                    )
                  : true;
            if (
              canonical &&
              (!selected ||
                canonicalizeRelationshipInput([left.posting, right.posting]) <
                  canonicalizeRelationshipInput([
                    selected[0].posting,
                    selected[1].posting,
                  ]))
            ) {
              selected = [left, right];
            }
          }
        if (!selected || !selected[0].posting.reasonCode) continue;
        addCandidate(
          selected[0].record,
          selected[1].record,
          selected[0].posting.reasonCode,
          signature,
          [
            ...selected[0].posting.evidenceIds,
            ...selected[1].posting.evidenceIds,
          ],
        );
      }
    }
  }

  const byPairShard = new Map<number, CandidateAccumulator[]>();
  for (const [pairKey, accumulator] of [...candidates.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const shard = fullCorpusRelationshipShard(pairKey, pairShardCount);
    const list = byPairShard.get(shard) || [];
    list.push(accumulator);
    byPairShard.set(shard, list);
  }
  const candidateFragments = [...byPairShard.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pairShard, accumulators]): FullCorpusCandidateFragment => {
      const records = [
        ...new Map(
          accumulators
            .flatMap((candidate) => [candidate.left, candidate.right])
            .map((record) => [record.address, record]),
        ).values(),
      ].sort((left, right) => compareText(left.address, right.address));
      const indices = new Map(
        records.map((record, index) => [record.address, index]),
      );
      const candidateRoutes = accumulators
        .map((candidate): FullCorpusCandidateRoute => ({
          pairKey: pairKeyFor(candidate.left.address, candidate.right.address),
          leftRecordIndex: indices.get(candidate.left.address) as number,
          rightRecordIndex: indices.get(candidate.right.address) as number,
          reasons: [...candidate.reasons.values()].sort((left, right) =>
            compareText(left.reasonId, right.reasonId),
          ),
        }))
        .sort((left, right) => compareText(left.pairKey, right.pairKey));
      const withoutDigest: Omit<FullCorpusCandidateFragment, "fragmentDigest"> =
        {
          recordType: "full_corpus_relationship_candidate_fragment",
          schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
          lineage,
          postingMapDigest: postingMap.mapDigest,
          sourcePostingShard: params.postingShard,
          pairShard,
          pairShardCount,
          records,
          candidates: candidateRoutes,
        };
      return {
        ...withoutDigest,
        fragmentDigest: digestValue(
          candidateFragmentWithoutDigest(withoutDigest),
        ),
      };
    });
  const withoutDigest: Omit<
    FullCorpusPostingShardReduction,
    "reductionDigest"
  > = {
    recordType: "full_corpus_relationship_posting_shard_reduction",
    schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    postingMapDigest: postingMap.mapDigest,
    postingShard: params.postingShard,
    postingShardCount: postingMap.postingShardCount,
    pairShardCount,
    inputFragmentCount: fragments.length,
    postingCount: entriesCount(fragments),
    postingGroupCount: groups.size,
    candidatePairCount: candidates.size,
    candidateRouteCount,
    presenceRecords,
    skippedGroups: skippedGroups.sort((left, right) =>
      compareText(left.receiptId, right.receiptId),
    ),
    candidateFragments,
  };
  return {
    ...withoutDigest,
    reductionDigest: digestValue(postingReductionWithoutDigest(withoutDigest)),
  };
};

const entriesCount = (fragments: readonly FullCorpusPostingFragment[]) =>
  fragments.reduce((sum, fragment) => sum + fragment.postings.length, 0);

export const validateCandidateFragment = (
  fragment: FullCorpusCandidateFragment,
  lineage: FullCorpusPipelineLineage,
  postingMapDigest: string,
  pairShardCount: number,
) => {
  requireExactKeys(
    fragment,
    [
      "recordType",
      "schemaVersion",
      "lineage",
      "postingMapDigest",
      "sourcePostingShard",
      "pairShard",
      "pairShardCount",
      "records",
      "candidates",
      "fragmentDigest",
    ],
    "full_corpus_relationship_candidate_fragment_invalid",
  );
  if (
    fragment.recordType !== "full_corpus_relationship_candidate_fragment" ||
    fragment.schemaVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    fragment.postingMapDigest !== postingMapDigest ||
    fragment.pairShardCount !== pairShardCount ||
    fragment.pairShard < 0 ||
    fragment.pairShard >= pairShardCount ||
    fragment.sourcePostingShard < 0 ||
    !Array.isArray(fragment.records) ||
    !Array.isArray(fragment.candidates)
  )
    invalid("full_corpus_relationship_candidate_fragment_invalid");
  validateLineage(fragment.lineage, lineage);
  const records = fragment.records.map((record) =>
    decodeRelationshipInputRecord(record, lineage.binding),
  );
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].address >= records[index].address)
      invalid("full_corpus_relationship_candidate_record_order_invalid");
  }
  let previous = "";
  for (const candidate of fragment.candidates) {
    requireExactKeys(
      candidate,
      ["pairKey", "leftRecordIndex", "rightRecordIndex", "reasons"],
      "full_corpus_relationship_candidate_route_invalid",
    );
    if (
      !Number.isSafeInteger(candidate.leftRecordIndex) ||
      !Number.isSafeInteger(candidate.rightRecordIndex) ||
      candidate.leftRecordIndex < 0 ||
      candidate.leftRecordIndex >= records.length ||
      candidate.rightRecordIndex < 0 ||
      candidate.rightRecordIndex >= records.length
    )
      invalid("full_corpus_relationship_candidate_record_index_invalid");
    const left = records[candidate.leftRecordIndex];
    const right = records[candidate.rightRecordIndex];
    if (
      compareText(left.address, right.address) >= 0 ||
      candidate.pairKey !== pairKeyFor(left.address, right.address) ||
      fullCorpusRelationshipShard(candidate.pairKey, pairShardCount) !==
        fragment.pairShard ||
      candidate.pairKey <= previous ||
      !candidate.reasons.length
    )
      invalid("full_corpus_relationship_candidate_route_invalid");
    previous = candidate.pairKey;
    for (let index = 0; index < candidate.reasons.length; index += 1) {
      const reason = candidate.reasons[index];
      requireExactKeys(
        reason,
        ["reasonId", "code", "routeSignature", "evidenceIds", "plainEnglish"],
        "full_corpus_relationship_candidate_reason_invalid",
      );
      const { reasonId, ...withoutId } = reason;
      if (
        reasonId !== `candidate-reason:${digestValue(withoutId)}` ||
        !Object.hasOwn(reasonPlainEnglish, reason.code) ||
        reason.plainEnglish !== reasonPlainEnglish[reason.code] ||
        !/^route:[a-z_]+:[a-f0-9]{64}$/.test(reason.routeSignature) ||
        reason.evidenceIds.some(
          (id, evidenceIndex) =>
            typeof id !== "string" ||
            !id.length ||
            (evidenceIndex > 0 && reason.evidenceIds[evidenceIndex - 1] >= id),
        ) ||
        (index && candidate.reasons[index - 1].reasonId >= reasonId)
      )
        invalid("full_corpus_relationship_candidate_reason_invalid");
    }
  }
  const { fragmentDigest, ...withoutDigest } = fragment;
  if (fragmentDigest !== digestValue(withoutDigest))
    invalid("full_corpus_relationship_candidate_fragment_digest_mismatch");
  return { ...fragment, lineage, records };
};

const pairReducerWithoutDigest = (
  value: Omit<FullCorpusPairReducerResult, "resultDigest">,
) => value;

export const reduceFullCorpusCandidateShard = (params: {
  postingMap: FullCorpusPostingMapManifest;
  rarityIndex: TypedRelationshipRarityIndex;
  fragments: readonly FullCorpusCandidateFragment[];
  pairShard: number;
  pairShardCount: number;
  maxCandidatePairs?: number;
}): FullCorpusPairReducerResult => {
  const lineage = validateLineage(params.postingMap.lineage);
  const rarity = decodeTypedRelationshipRarityIndex(
    params.rarityIndex,
    lineage.binding,
  );
  if (
    rarity.indexDigest !== lineage.rarityIndexDigest ||
    rarity.recordSetSha256 !== lineage.relationshipInputRecordSetSha256
  )
    invalid("full_corpus_relationship_rarity_lineage_mismatch");
  const pairShardCount = normalizeShardCount(
    params.pairShardCount,
    "full_corpus_relationship_pair_shard_count_invalid",
  );
  if (
    !Number.isSafeInteger(params.pairShard) ||
    params.pairShard < 0 ||
    params.pairShard >= pairShardCount
  ) {
    invalid("full_corpus_relationship_pair_shard_invalid");
  }
  const maxCandidatePairs = Math.trunc(params.maxCandidatePairs ?? 1_000_000);
  if (
    !Number.isSafeInteger(maxCandidatePairs) ||
    maxCandidatePairs < 1 ||
    maxCandidatePairs > 10_000_000
  ) {
    invalid("full_corpus_relationship_pair_reducer_cap_invalid");
  }
  const fragments = params.fragments
    .map((fragment) =>
      validateCandidateFragment(
        fragment,
        lineage,
        params.postingMap.mapDigest,
        pairShardCount,
      ),
    )
    .sort((left, right) => left.sourcePostingShard - right.sourcePostingShard);
  if (fragments.some((fragment) => fragment.pairShard !== params.pairShard)) {
    invalid("full_corpus_relationship_candidate_pair_shard_mismatch");
  }
  if (
    new Set(fragments.map((fragment) => fragment.sourcePostingShard)).size !==
    fragments.length
  ) {
    invalid("full_corpus_relationship_duplicate_candidate_fragment");
  }
  const records = new Map<string, RelationshipInputRecord>();
  type PairAccumulator = {
    leftAddress: string;
    rightAddress: string;
    reasons: Map<string, FullCorpusCandidateReason>;
  };
  const pairs = new Map<string, PairAccumulator>();
  for (const fragment of fragments)
    for (const candidate of fragment.candidates) {
      const left = fragment.records[candidate.leftRecordIndex];
      const right = fragment.records[candidate.rightRecordIndex];
      for (const record of [left, right]) {
        const existing = records.get(record.address);
        if (existing && existing.recordDigest !== record.recordDigest) {
          invalid("full_corpus_relationship_candidate_record_digest_conflict");
        }
        records.set(record.address, record);
      }
      const accumulator = pairs.get(candidate.pairKey) || {
        leftAddress: left.address,
        rightAddress: right.address,
        reasons: new Map<string, FullCorpusCandidateReason>(),
      };
      if (
        accumulator.leftAddress !== left.address ||
        accumulator.rightAddress !== right.address
      ) {
        invalid("full_corpus_relationship_pair_key_collision");
      }
      for (const reason of candidate.reasons)
        accumulator.reasons.set(reason.reasonId, reason);
      pairs.set(candidate.pairKey, accumulator);
      if (pairs.size > maxCandidatePairs)
        invalid("full_corpus_relationship_pair_reducer_cap_exceeded");
    }
  const evaluations = [...pairs.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, pair]) =>
      evaluateTypedRelationshipPair({
        left: records.get(pair.leftAddress) as RelationshipInputRecord,
        right: records.get(pair.rightAddress) as RelationshipInputRecord,
        rarityIndex: rarity,
        expectedBinding: lineage.binding,
      }),
    );
  const edges = evaluations
    .flatMap((evaluation) => evaluation.edges)
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  if (new Set(edges.map((edge) => edge.edgeId)).size !== edges.length) {
    invalid("full_corpus_relationship_duplicate_typed_edge");
  }
  const candidateFragmentSetSha256 = digestValue(
    fragments
      .map(
        (fragment) =>
          `${fragment.sourcePostingShard}:${fragment.fragmentDigest}`,
      )
      .join("\n"),
  );
  const withoutDigest: Omit<FullCorpusPairReducerResult, "resultDigest"> = {
    recordType: "full_corpus_relationship_pair_reducer_result",
    schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    postingMapDigest: params.postingMap.mapDigest,
    pairShard: params.pairShard,
    pairShardCount,
    candidateFragmentSetSha256,
    candidatePairCount: evaluations.length,
    evaluatedAddressCount: new Set(
      [...pairs.values()].flatMap((pair) => [
        pair.leftAddress,
        pair.rightAddress,
      ]),
    ).size,
    typedEdgeCount: edges.length,
    rejectedCandidateCount: evaluations.filter(
      (evaluation) => !evaluation.edges.length,
    ).length,
    evaluations,
    edges,
  };
  return {
    ...withoutDigest,
    resultDigest: digestValue(pairReducerWithoutDigest(withoutDigest)),
  };
};

const completionWithoutDigest = (
  value: Omit<FullCorpusRelationshipCompletion, "completionDigest">,
) => value;

export {
  buildFullCorpusRelationshipCompletion,
  decodeFullCorpusCandidateFragment,
  decodeFullCorpusContextualCompletionReference,
  decodeFullCorpusPairReducerResult,
  decodeFullCorpusPostingFragment,
  decodeFullCorpusPostingMapManifest,
  decodeFullCorpusPostingShardReduction,
  decodeFullCorpusRelationshipCompletion,
  fullCorpusRelationshipArtifactSha256,
} from "./typedRelationshipPipelineDecoders";
