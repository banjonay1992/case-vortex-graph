import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  type RelationshipInputRecord,
} from "./relationshipInputSnapshot";
import {
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  decodeTypedRelationshipEdge,
  decodeTypedRelationshipPairEvaluation,
  type TypedRelationshipEdge,
  type TypedRelationshipEdgeType,
  type TypedRelationshipPairEvaluation,
} from "./typedRelationshipEngine";
import {
  assertContextualRelationshipCompletionProductionEligible,
  type ContextualRelationshipCompletionArtifact,
} from "./contextualRelationshipCompletion";
import {
  FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  FULL_CORPUS_TYPED_EDGE_TYPES,
} from "./typedRelationshipPipelineTypes";
import type {
  FullCorpusAddressLedgerShard,
  FullCorpusAddressState,
  FullCorpusCandidateFragment,
  FullCorpusContextualCompletionReference,
  FullCorpusPairReducerResult,
  FullCorpusPipelineLineage,
  FullCorpusPostingFragment,
  FullCorpusPostingMapManifest,
  FullCorpusPostingShardReduction,
  FullCorpusRelationshipCompletion,
} from "./typedRelationshipPipelineTypes";
import {
  addressKind,
  compareText,
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
  validateLineage,
} from "./typedRelationshipPipelineSupport";
import { validatePostingFragment } from "./typedRelationshipPipelinePostings";
import { validateCandidateFragment } from "./typedRelationshipPipeline";

const validatePairReducerStructure = (params: {
  reducer: FullCorpusPairReducerResult;
  expectedFragments: readonly FullCorpusCandidateFragment[];
  lineage: FullCorpusPipelineLineage;
  postingMapDigest: string;
  pairShardCount: number;
}) => {
  const fragments = params.expectedFragments.map((fragment) =>
    decodeFullCorpusCandidateFragment(fragment, {
      lineage: params.lineage,
      postingMapDigest: params.postingMapDigest,
      pairShardCount: params.pairShardCount,
    }),
  );
  const expectedPairs = new Map<
    string,
    {
      addresses: [string, string];
      recordDigests: [string, string];
    }
  >();
  for (const fragment of fragments)
    for (const candidate of fragment.candidates) {
      const left = fragment.records[candidate.leftRecordIndex];
      const right = fragment.records[candidate.rightRecordIndex];
      const addresses = [left.address, right.address].sort(compareText) as [
        string,
        string,
      ];
      const recordDigests = [left.recordDigest, right.recordDigest].sort(
        compareText,
      ) as [string, string];
      const pairKey = pairKeyFor(addresses[0], addresses[1]);
      if (
        candidate.pairKey !== pairKey ||
        fullCorpusRelationshipShard(pairKey, params.pairShardCount) !==
          params.reducer.pairShard
      ) {
        invalid(
          "full_corpus_relationship_pair_reducer_candidate_route_mismatch",
        );
      }
      const existing = expectedPairs.get(pairKey);
      if (
        existing &&
        (canonicalizeRelationshipInput(existing.addresses) !==
          canonicalizeRelationshipInput(addresses) ||
          canonicalizeRelationshipInput(existing.recordDigests) !==
            canonicalizeRelationshipInput(recordDigests))
      ) {
        invalid("full_corpus_relationship_pair_reducer_candidate_conflict");
      }
      expectedPairs.set(pairKey, { addresses, recordDigests });
    }
  const evaluations = params.reducer.evaluations.map((evaluation) =>
    decodeTypedRelationshipPairEvaluation(evaluation, params.lineage.binding),
  );
  if (
    evaluations.length !== expectedPairs.size ||
    params.reducer.candidatePairCount !== expectedPairs.size ||
    new Set(evaluations.map((evaluation) => evaluation.evaluationDigest))
      .size !== evaluations.length
  )
    invalid("full_corpus_relationship_pair_reducer_evaluation_count_mismatch");
  const evaluationByPair = new Map<string, TypedRelationshipPairEvaluation>();
  const evaluatedAddresses = new Set<string>();
  for (const evaluation of evaluations) {
    const pairKey = pairKeyFor(
      evaluation.addresses[0],
      evaluation.addresses[1],
    );
    const expected = expectedPairs.get(pairKey);
    if (
      !expected ||
      evaluationByPair.has(pairKey) ||
      fullCorpusRelationshipShard(pairKey, params.pairShardCount) !==
        params.reducer.pairShard ||
      canonicalizeRelationshipInput(evaluation.addresses) !==
        canonicalizeRelationshipInput(expected.addresses) ||
      canonicalizeRelationshipInput(
        [...evaluation.inputRecordDigests].sort(compareText),
      ) !== canonicalizeRelationshipInput(expected.recordDigests)
    ) {
      invalid(
        "full_corpus_relationship_pair_reducer_evaluation_binding_mismatch",
      );
    }
    evaluationByPair.set(pairKey, evaluation);
    evaluatedAddresses.add(evaluation.addresses[0]);
    evaluatedAddresses.add(evaluation.addresses[1]);
  }
  if (
    evaluationByPair.size !== expectedPairs.size ||
    params.reducer.evaluatedAddressCount !== evaluatedAddresses.size
  ) {
    invalid("full_corpus_relationship_pair_reducer_evaluated_address_mismatch");
  }
  const evaluationEdges = evaluations
    .flatMap((evaluation) => evaluation.edges)
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  if (
    new Set(evaluationEdges.map((edge) => edge.edgeId)).size !==
    evaluationEdges.length
  ) {
    invalid("full_corpus_relationship_pair_reducer_duplicate_evaluation_edge");
  }
  const reducerEdges = params.reducer.edges
    .map((edge) => decodeTypedRelationshipEdge(edge, params.lineage.binding))
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  if (
    canonicalizeRelationshipInput(reducerEdges) !==
      canonicalizeRelationshipInput(evaluationEdges) ||
    params.reducer.typedEdgeCount !== reducerEdges.length ||
    params.reducer.rejectedCandidateCount !==
      evaluations.filter((evaluation) => !evaluation.edges.length).length
  )
    invalid("full_corpus_relationship_pair_reducer_edge_accounting_mismatch");
  return { evaluations, edges: reducerEdges, evaluatedAddresses };
};

const sumSafe = (values: readonly number[]) =>
  values.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next))
      invalid("full_corpus_relationship_accounting_overflow");
    return next;
  }, 0);

const contextualCompletionReference = (
  artifact: ContextualRelationshipCompletionArtifact,
): FullCorpusContextualCompletionReference => ({
  completionId: artifact.completionId,
  completionDigest: artifact.completionDigest,
  artifactDigest: sha256(`${canonicalizeRelationshipInput(artifact)}\n`),
  sourceCompletionSetSha256: artifact.sourceCompletionSetSha256,
  entrySetSha256: artifact.entrySetSha256,
  calibrationReceiptId: artifact.calibrationReceipt.receiptId,
  calibrationReceiptSha256: artifact.calibrationReceipt.receiptSha256,
  sourceSnapshotCount: artifact.accounting.sourceSnapshotCount,
  sourceRecordCount: artifact.accounting.sourceRecordCount,
  acceptedEdgeCount: artifact.accounting.acceptedEdgeCount,
  insufficientEvidenceCount: artifact.accounting.insufficientEvidenceCount,
  zeroObservationState: artifact.zeroObservationState,
});

export const decodeFullCorpusContextualCompletionReference = (
  input: unknown,
): FullCorpusContextualCompletionReference => {
  const value = requireExactKeys(
    input,
    [
      "completionId",
      "completionDigest",
      "artifactDigest",
      "sourceCompletionSetSha256",
      "entrySetSha256",
      "calibrationReceiptId",
      "calibrationReceiptSha256",
      "sourceSnapshotCount",
      "sourceRecordCount",
      "acceptedEdgeCount",
      "insufficientEvidenceCount",
      "zeroObservationState",
    ],
    "full_corpus_relationship_contextual_completion_reference_invalid",
  );
  const reference = value as unknown as FullCorpusContextualCompletionReference;
  if (
    !/^contextual-completion:[a-f0-9]{64}$/.test(
      String(reference.completionId),
    ) ||
    !/^contextual-calibration:[a-f0-9]{64}$/.test(
      String(reference.calibrationReceiptId),
    ) ||
    !SHA256_PATTERN.test(String(reference.completionDigest)) ||
    !SHA256_PATTERN.test(String(reference.artifactDigest)) ||
    !SHA256_PATTERN.test(String(reference.sourceCompletionSetSha256)) ||
    !SHA256_PATTERN.test(String(reference.entrySetSha256)) ||
    !SHA256_PATTERN.test(String(reference.calibrationReceiptSha256)) ||
    !Number.isSafeInteger(reference.sourceSnapshotCount) ||
    reference.sourceSnapshotCount < 4 ||
    !Number.isSafeInteger(reference.sourceRecordCount) ||
    reference.sourceRecordCount < 0 ||
    !Number.isSafeInteger(reference.acceptedEdgeCount) ||
    reference.acceptedEdgeCount < 0 ||
    !Number.isSafeInteger(reference.insufficientEvidenceCount) ||
    reference.insufficientEvidenceCount < 0 ||
    reference.sourceRecordCount !==
      reference.acceptedEdgeCount + reference.insufficientEvidenceCount ||
    typeof reference.zeroObservationState !== "boolean" ||
    reference.zeroObservationState !== (reference.sourceRecordCount === 0)
  )
    invalid("full_corpus_relationship_contextual_completion_reference_invalid");
  return reference;
};

const completionWithoutDigest = (
  value: Omit<FullCorpusRelationshipCompletion, "completionDigest">,
) => value;

export const buildFullCorpusRelationshipCompletion = (params: {
  postingMap: FullCorpusPostingMapManifest;
  postingReductions: readonly FullCorpusPostingShardReduction[];
  pairReducers: readonly FullCorpusPairReducerResult[];
  contextualCompletion: ContextualRelationshipCompletionArtifact;
  expectedContextualCalibration: { receiptId: string; receiptSha256: string };
  addressLedgerShardCount?: number;
}): FullCorpusRelationshipCompletion => {
  const postingMap = params.postingMap;
  const lineage = validateLineage(postingMap.lineage);
  if (!params.contextualCompletion || !params.expectedContextualCalibration) {
    invalid("full_corpus_relationship_contextual_completion_required");
  }
  const contextualArtifact =
    assertContextualRelationshipCompletionProductionEligible(
      params.contextualCompletion,
      lineage.binding,
      params.expectedContextualCalibration,
    );
  const contextualCompletion = decodeFullCorpusContextualCompletionReference(
    contextualCompletionReference(contextualArtifact),
  );
  const postingReductions = [...params.postingReductions].sort(
    (left, right) => left.postingShard - right.postingShard,
  );
  if (postingReductions.length !== postingMap.postingShardCount) {
    invalid("full_corpus_relationship_posting_reduction_incomplete");
  }
  const pairShardCount = postingReductions[0]?.pairShardCount;
  if (
    !pairShardCount ||
    postingReductions.some(
      (reduction, index) =>
        reduction.postingShard !== index ||
        reduction.postingShardCount !== postingMap.postingShardCount ||
        reduction.pairShardCount !== pairShardCount ||
        reduction.postingMapDigest !== postingMap.mapDigest ||
        canonicalizeRelationshipInput(reduction.lineage) !==
          canonicalizeRelationshipInput(lineage),
    )
  )
    invalid("full_corpus_relationship_posting_reduction_identity_mismatch");
  for (const reduction of postingReductions) {
    const { reductionDigest, ...withoutDigest } = reduction;
    if (reductionDigest !== digestValue(withoutDigest))
      invalid("full_corpus_relationship_posting_reduction_digest_mismatch");
  }
  const expectedCandidateFragments = postingReductions.flatMap(
    (reduction) => reduction.candidateFragments,
  );
  const pairReducers = [...params.pairReducers].sort(
    (left, right) => left.pairShard - right.pairShard,
  );
  const validatedPairReducers = new Map<
    number,
    ReturnType<typeof validatePairReducerStructure>
  >();
  if (pairReducers.length !== pairShardCount)
    invalid("full_corpus_relationship_pair_reducer_incomplete");
  for (const reducer of pairReducers) {
    if (
      reducer.pairShard !== pairReducers.indexOf(reducer) ||
      reducer.pairShardCount !== pairShardCount ||
      reducer.postingMapDigest !== postingMap.mapDigest ||
      canonicalizeRelationshipInput(reducer.lineage) !==
        canonicalizeRelationshipInput(lineage)
    )
      invalid("full_corpus_relationship_pair_reducer_identity_mismatch");
    const { resultDigest, ...withoutDigest } = reducer;
    if (resultDigest !== digestValue(withoutDigest))
      invalid("full_corpus_relationship_pair_reducer_digest_mismatch");
    const expected = expectedCandidateFragments
      .filter((fragment) => fragment.pairShard === reducer.pairShard)
      .sort(
        (left, right) => left.sourcePostingShard - right.sourcePostingShard,
      );
    const expectedSet = digestValue(
      expected
        .map(
          (fragment) =>
            `${fragment.sourcePostingShard}:${fragment.fragmentDigest}`,
        )
        .join("\n"),
    );
    if (expectedSet !== reducer.candidateFragmentSetSha256) {
      invalid("full_corpus_relationship_pair_reducer_fragment_set_mismatch");
    }
    validatedPairReducers.set(
      reducer.pairShard,
      validatePairReducerStructure({
        reducer,
        expectedFragments: expected,
        lineage,
        postingMapDigest: postingMap.mapDigest,
        pairShardCount,
      }),
    );
  }

  const presenceRecords = postingReductions
    .flatMap((reduction) => reduction.presenceRecords)
    .sort((left, right) => compareText(left.address, right.address));
  if (
    presenceRecords.length !== postingMap.universeRecordCount ||
    new Set(presenceRecords.map((record) => record.address)).size !==
      presenceRecords.length ||
    rarityRecordSetDigest(
      presenceRecords.map((record) => ({
        address: record.address,
        recordDigest: record.recordDigest,
      })),
    ) !== lineage.relationshipInputRecordSetSha256
  )
    invalid("full_corpus_relationship_completion_presence_mismatch");
  const presenceByAddress = new Map(
    presenceRecords.map((record) => [record.address, record]),
  );
  const evaluatedAddresses = new Set<string>();
  const linkedAddresses = new Set<string>();
  const evaluationDigests: string[] = [];
  const edgeIds: string[] = [];
  const globalEvaluationDigests = new Set<string>();
  const globalEdgeIds = new Set<string>();
  for (const reducer of pairReducers) {
    const validated = validatedPairReducers.get(
      reducer.pairShard,
    ) as ReturnType<typeof validatePairReducerStructure>;
    for (const evaluation of validated.evaluations) {
      if (globalEvaluationDigests.has(evaluation.evaluationDigest)) {
        invalid("full_corpus_relationship_duplicate_global_evaluation");
      }
      globalEvaluationDigests.add(evaluation.evaluationDigest);
      evaluationDigests.push(evaluation.evaluationDigest);
      for (const edge of evaluation.edges)
        for (const endpoint of edge.endpoints) {
          if (endpoint.kind === "evidence") linkedAddresses.add(endpoint.id);
        }
    }
    for (const edge of validated.edges) {
      if (globalEdgeIds.has(edge.edgeId))
        invalid("full_corpus_relationship_duplicate_global_edge");
      globalEdgeIds.add(edge.edgeId);
      edgeIds.push(edge.edgeId);
      for (const endpoint of edge.endpoints)
        if (endpoint.kind === "evidence") linkedAddresses.add(endpoint.id);
    }
  }
  for (const entry of contextualArtifact.entries) {
    evaluatedAddresses.add(entry.address);
    if (entry.status !== "accepted_edge") continue;
    const edge = entry.typedEdge;
    if (globalEdgeIds.has(edge.edgeId))
      invalid("full_corpus_relationship_duplicate_global_edge");
    globalEdgeIds.add(edge.edgeId);
    edgeIds.push(edge.edgeId);
    for (const endpoint of edge.endpoints) {
      if (endpoint.kind === "evidence") linkedAddresses.add(endpoint.id);
    }
  }
  for (const fragment of expectedCandidateFragments)
    for (const candidate of fragment.candidates) {
      evaluatedAddresses.add(
        fragment.records[candidate.leftRecordIndex].address,
      );
      evaluatedAddresses.add(
        fragment.records[candidate.rightRecordIndex].address,
      );
    }
  for (const address of [...evaluatedAddresses, ...linkedAddresses]) {
    if (!presenceByAddress.has(address))
      invalid("full_corpus_relationship_completion_unknown_address");
  }
  const states: FullCorpusAddressState[] = presenceRecords.map((record) => ({
    ...record,
    status: linkedAddresses.has(record.address)
      ? "linked"
      : evaluatedAddresses.has(record.address)
        ? "candidate_only"
        : "isolated",
  }));
  const ledgerShardCount = normalizeShardCount(
    params.addressLedgerShardCount ?? 64,
    "full_corpus_relationship_address_ledger_shard_count_invalid",
  );
  const byLedgerShard = new Map<number, FullCorpusAddressState[]>();
  for (const state of states) {
    const shard = fullCorpusRelationshipShard(state.address, ledgerShardCount);
    const list = byLedgerShard.get(shard) || [];
    list.push(state);
    byLedgerShard.set(shard, list);
  }
  const addressLedgerShards: FullCorpusAddressLedgerShard[] = [];
  for (let shard = 0; shard < ledgerShardCount; shard += 1) {
    const shardStates = (byLedgerShard.get(shard) || []).sort((left, right) =>
      compareText(left.address, right.address),
    );
    addressLedgerShards.push({
      shard,
      shardCount: ledgerShardCount,
      states: shardStates,
      stateCount: shardStates.length,
      linkedCount: shardStates.filter((state) => state.status === "linked")
        .length,
      candidateOnlyCount: shardStates.filter(
        (state) => state.status === "candidate_only",
      ).length,
      isolatedCount: shardStates.filter((state) => state.status === "isolated")
        .length,
      stateSetSha256: digestValue(
        shardStates
          .map(
            (state) => `${state.address}:${state.recordDigest}:${state.status}`,
          )
          .join("\n"),
      ),
    });
  }
  const skippedGroups = postingReductions
    .flatMap((reduction) => reduction.skippedGroups)
    .sort((left, right) => compareText(left.receiptId, right.receiptId));
  const addressKindCounts = emptyKindCounts();
  for (const state of states) addressKindCounts[state.kind] += 1;
  const typedEdgeTypeCounts = emptyEdgeTypeCounts();
  for (const validated of validatedPairReducers.values())
    for (const edge of validated.edges) {
      if (!FULL_CORPUS_TYPED_EDGE_TYPES.includes(edge.edgeType)) {
        invalid("full_corpus_relationship_unknown_typed_edge_type");
      }
      typedEdgeTypeCounts[edge.edgeType] += 1;
    }
  for (const entry of contextualArtifact.entries)
    if (entry.status === "accepted_edge") {
      if (!FULL_CORPUS_TYPED_EDGE_TYPES.includes(entry.typedEdge.edgeType)) {
        invalid("full_corpus_relationship_unknown_typed_edge_type");
      }
      typedEdgeTypeCounts[entry.typedEdge.edgeType] += 1;
    }
  const typedEdgeCount = sumSafe([
    ...pairReducers.map((reducer) => reducer.typedEdgeCount),
    contextualCompletion.acceptedEdgeCount,
  ]);
  if (sumSafe(Object.values(typedEdgeTypeCounts)) !== typedEdgeCount) {
    invalid("full_corpus_relationship_typed_edge_type_accounting_mismatch");
  }
  if (
    canonicalizeRelationshipInput(addressKindCounts) !==
    canonicalizeRelationshipInput(postingMap.addressKindCounts)
  ) {
    invalid("full_corpus_relationship_address_kind_accounting_mismatch");
  }
  const postingReductionSetSha256 = digestValue(
    postingReductions
      .map(
        (reduction) => `${reduction.postingShard}:${reduction.reductionDigest}`,
      )
      .join("\n"),
  );
  const pairReducerSetSha256 = digestValue(
    pairReducers
      .map((reducer) => `${reducer.pairShard}:${reducer.resultDigest}`)
      .join("\n"),
  );
  const withoutDigest: Omit<
    FullCorpusRelationshipCompletion,
    "completionDigest"
  > = {
    recordType: "full_corpus_relationship_completion",
    schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    postingMapDigest: postingMap.mapDigest,
    contextualCompletion,
    postingShardCount: postingMap.postingShardCount,
    pairShardCount,
    universeRecordCount: states.length,
    addressKindCounts,
    candidatePairCount: sumSafe(
      pairReducers.map((reducer) => reducer.candidatePairCount),
    ),
    evaluatedAddressCount: evaluatedAddresses.size,
    linkedAddressCount: linkedAddresses.size,
    candidateOnlyAddressCount: states.filter(
      (state) => state.status === "candidate_only",
    ).length,
    isolatedAddressCount: states.filter((state) => state.status === "isolated")
      .length,
    typedEdgeCount,
    typedEdgeTypeCounts,
    skippedGroupCount: skippedGroups.length,
    skippedEstimatedPairCount: sumSafe(
      skippedGroups.map((receipt) => receipt.estimatedPairCount),
    ),
    postingReductionSetSha256,
    pairReducerSetSha256,
    evaluationSetSha256: digestValue(
      evaluationDigests.sort(compareText).join("\n"),
    ),
    edgeSetSha256: digestValue(edgeIds.sort(compareText).join("\n")),
    skippedGroupSetSha256: digestValue(
      skippedGroups.map((receipt) => receipt.receiptId).join("\n"),
    ),
    addressLedgerShards,
    addressLedgerSetSha256: digestValue(
      addressLedgerShards
        .map((shard) => `${shard.shard}:${shard.stateSetSha256}`)
        .join("\n"),
    ),
    claimDiscipline: FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
    plainEnglish: `All ${states.length} immutable evidence addresses were retained: ${linkedAddresses.size} have at least one emitted typed edge, ${states.filter((state) => state.status === "candidate_only").length} were evaluated without an emitted edge, and ${states.filter((state) => state.status === "isolated").length} had no bounded candidate route. Contextual completion contributed ${contextualCompletion.acceptedEdgeCount} governed candidate edges and ${contextualCompletion.insufficientEvidenceCount} explicit insufficient-evidence receipts. ${skippedGroups.length} oversized or unresolved groups remain explicitly receipted and unresolved. ${TYPED_RELATIONSHIP_CLAIM_DISCIPLINE.notice}`,
  };
  return {
    ...withoutDigest,
    completionDigest: digestValue(completionWithoutDigest(withoutDigest)),
  };
};

/** Content address for immutable archive keys. */
export const fullCorpusRelationshipArtifactSha256 = (value: unknown) =>
  sha256(`${canonicalizeRelationshipInput(value)}\n`);

export const decodeFullCorpusPostingFragment = (
  input: Buffer | string | unknown,
  expectedLineage?: FullCorpusPipelineLineage,
  expectedPostingShardCount?: number,
): FullCorpusPostingFragment => {
  const value = parsePipelineObject(
    input,
    "full_corpus_relationship_posting_fragment",
  ) as unknown as FullCorpusPostingFragment;
  const lineage = validateLineage(value.lineage, expectedLineage);
  const shardCount = expectedPostingShardCount ?? value.postingShardCount;
  const decoded = validatePostingFragment(value, lineage, shardCount);
  if (Buffer.isBuffer(input) || typeof input === "string") {
    const raw = Buffer.isBuffer(input) ? input.toString("utf8") : input;
    const canonical = canonicalizeRelationshipInput(decoded);
    if (raw !== canonical && raw !== `${canonical}\n`)
      invalid("full_corpus_relationship_posting_fragment_noncanonical");
  }
  return decoded;
};

export const decodeFullCorpusCandidateFragment = (
  input: Buffer | string | unknown,
  expected: {
    lineage?: FullCorpusPipelineLineage;
    postingMapDigest?: string;
    pairShardCount?: number;
  } = {},
): FullCorpusCandidateFragment => {
  const value = parsePipelineObject(
    input,
    "full_corpus_relationship_candidate_fragment",
  ) as unknown as FullCorpusCandidateFragment;
  const lineage = validateLineage(value.lineage, expected.lineage);
  const postingMapDigest = expected.postingMapDigest ?? value.postingMapDigest;
  const pairShardCount = expected.pairShardCount ?? value.pairShardCount;
  if (!SHA256_PATTERN.test(postingMapDigest))
    invalid("full_corpus_relationship_candidate_fragment_map_digest_invalid");
  const decoded = validateCandidateFragment(
    value,
    lineage,
    postingMapDigest,
    pairShardCount,
  );
  if (Buffer.isBuffer(input) || typeof input === "string") {
    const raw = Buffer.isBuffer(input) ? input.toString("utf8") : input;
    const canonical = canonicalizeRelationshipInput(decoded);
    if (raw !== canonical && raw !== `${canonical}\n`)
      invalid("full_corpus_relationship_candidate_fragment_noncanonical");
  }
  return decoded;
};

export const decodeFullCorpusPostingMapManifest = (
  input: Buffer | string | unknown,
  expectedLineage?: FullCorpusPipelineLineage,
): FullCorpusPostingMapManifest => {
  const raw = parsePipelineObject(
    input,
    "full_corpus_relationship_posting_map_manifest",
  );
  requireExactKeys(
    raw,
    [
      "recordType",
      "schemaVersion",
      "lineage",
      "postingShardCount",
      "inputPartCount",
      "universeRecordCount",
      "addressKindCounts",
      "postingCount",
      "fragmentCount",
      "fragments",
      "fragmentSetSha256",
      "mapDigest",
    ],
    "full_corpus_relationship_posting_map_manifest_invalid",
  );
  const value = raw as unknown as FullCorpusPostingMapManifest;
  const lineage = validateLineage(value.lineage, expectedLineage);
  normalizeShardCount(
    value.postingShardCount,
    "full_corpus_relationship_posting_shard_count_invalid",
  );
  for (const count of [
    value.inputPartCount,
    value.universeRecordCount,
    value.postingCount,
    value.fragmentCount,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0)
      invalid("full_corpus_relationship_posting_map_count_invalid");
  }
  requireExactKeys(
    value.addressKindCounts,
    ["sighting", "document", "photo", "video"],
    "full_corpus_relationship_posting_map_kind_counts_invalid",
  );
  if (
    Object.values(value.addressKindCounts).some(
      (count) => !Number.isSafeInteger(count) || count < 0,
    ) ||
    Object.values(value.addressKindCounts).reduce(
      (sum, count) => sum + count,
      0,
    ) !== value.universeRecordCount ||
    value.universeRecordCount !== lineage.binding.universeRecordCount ||
    !Array.isArray(value.fragments) ||
    value.fragmentCount !== value.fragments.length
  )
    invalid("full_corpus_relationship_posting_map_accounting_invalid");
  const summaries = value.fragments
    .map((summary) => {
      requireExactKeys(
        summary,
        [
          "inputPartNumber",
          "postingShard",
          "recordReplicaCount",
          "postingCount",
          "identityCount",
          "fragmentDigest",
        ],
        "full_corpus_relationship_posting_fragment_summary_invalid",
      );
      if (
        !Number.isSafeInteger(summary.inputPartNumber) ||
        summary.inputPartNumber < 0 ||
        summary.inputPartNumber >= value.inputPartCount ||
        !Number.isSafeInteger(summary.postingShard) ||
        summary.postingShard < 0 ||
        summary.postingShard >= value.postingShardCount ||
        !Number.isSafeInteger(summary.recordReplicaCount) ||
        summary.recordReplicaCount < 1 ||
        !Number.isSafeInteger(summary.postingCount) ||
        summary.postingCount < 1 ||
        !Number.isSafeInteger(summary.identityCount) ||
        summary.identityCount < 0 ||
        summary.identityCount > summary.recordReplicaCount ||
        !SHA256_PATTERN.test(summary.fragmentDigest)
      )
        invalid("full_corpus_relationship_posting_fragment_summary_invalid");
      return summary;
    })
    .sort(
      (left, right) =>
        left.inputPartNumber - right.inputPartNumber ||
        left.postingShard - right.postingShard,
    );
  if (
    canonicalizeRelationshipInput(summaries) !==
      canonicalizeRelationshipInput(value.fragments) ||
    new Set(
      summaries.map(
        (summary) => `${summary.inputPartNumber}:${summary.postingShard}`,
      ),
    ).size !== summaries.length ||
    summaries.reduce((sum, summary) => sum + summary.postingCount, 0) !==
      value.postingCount ||
    summaries.reduce((sum, summary) => sum + summary.identityCount, 0) !==
      value.universeRecordCount ||
    value.fragmentSetSha256 !==
      digestValue(
        summaries
          .map(
            (summary) =>
              `${summary.inputPartNumber}:${summary.postingShard}:${summary.fragmentDigest}`,
          )
          .join("\n"),
      )
  )
    invalid("full_corpus_relationship_posting_map_fragment_set_mismatch");
  const { mapDigest, ...withoutDigest } = value;
  if (
    !SHA256_PATTERN.test(mapDigest) ||
    mapDigest !== digestValue(withoutDigest)
  ) {
    invalid("full_corpus_relationship_posting_map_digest_mismatch");
  }
  return { ...value, lineage, fragments: summaries };
};

export const decodeFullCorpusPostingShardReduction = (
  input: Buffer | string | unknown,
  expected: {
    lineage?: FullCorpusPipelineLineage;
    postingMapDigest?: string;
    postingShardCount?: number;
    pairShardCount?: number;
  } = {},
): FullCorpusPostingShardReduction => {
  const raw = parsePipelineObject(
    input,
    "full_corpus_relationship_posting_shard_reduction",
  );
  requireExactKeys(
    raw,
    [
      "recordType",
      "schemaVersion",
      "lineage",
      "postingMapDigest",
      "postingShard",
      "postingShardCount",
      "pairShardCount",
      "inputFragmentCount",
      "postingCount",
      "postingGroupCount",
      "candidatePairCount",
      "candidateRouteCount",
      "presenceRecords",
      "skippedGroups",
      "candidateFragments",
      "reductionDigest",
    ],
    "full_corpus_relationship_posting_shard_reduction_invalid",
  );
  const value = raw as unknown as FullCorpusPostingShardReduction;
  const lineage = validateLineage(value.lineage, expected.lineage);
  if (
    value.recordType !== "full_corpus_relationship_posting_shard_reduction" ||
    value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    value.postingMapDigest !==
      (expected.postingMapDigest ?? value.postingMapDigest) ||
    value.postingShardCount !==
      (expected.postingShardCount ?? value.postingShardCount) ||
    value.pairShardCount !==
      (expected.pairShardCount ?? value.pairShardCount) ||
    !SHA256_PATTERN.test(value.postingMapDigest) ||
    !Number.isSafeInteger(value.postingShard) ||
    value.postingShard < 0 ||
    value.postingShard >= value.postingShardCount
  )
    invalid(
      "full_corpus_relationship_posting_shard_reduction_identity_mismatch",
    );
  normalizeShardCount(
    value.postingShardCount,
    "full_corpus_relationship_posting_shard_count_invalid",
  );
  normalizeShardCount(
    value.pairShardCount,
    "full_corpus_relationship_pair_shard_count_invalid",
  );
  for (const count of [
    value.inputFragmentCount,
    value.postingCount,
    value.postingGroupCount,
    value.candidatePairCount,
    value.candidateRouteCount,
  ])
    if (!Number.isSafeInteger(count) || count < 0) {
      invalid("full_corpus_relationship_posting_shard_reduction_count_invalid");
    }
  if (
    !Array.isArray(value.presenceRecords) ||
    !Array.isArray(value.skippedGroups) ||
    !Array.isArray(value.candidateFragments)
  ) {
    invalid("full_corpus_relationship_posting_shard_reduction_invalid");
  }
  let previousPresence = "";
  const presenceRecords = value.presenceRecords.map((presence) => {
    requireExactKeys(
      presence,
      ["address", "recordDigest", "kind"],
      "full_corpus_relationship_presence_record_invalid",
    );
    if (
      typeof presence.address !== "string" ||
      presence.address <= previousPresence ||
      !SHA256_PATTERN.test(presence.recordDigest) ||
      addressKind(presence.address) !== presence.kind
    ) {
      invalid("full_corpus_relationship_presence_record_invalid");
    }
    previousPresence = presence.address;
    return presence;
  });
  const skippedGroups = value.skippedGroups
    .map((receipt) => {
      requireExactKeys(
        receipt,
        [
          "recordType",
          "schemaVersion",
          "receiptId",
          "lineage",
          "postingShard",
          "routeKind",
          "routeSignature",
          "postingCount",
          "distinctAddressCount",
          "estimatedPairCount",
          "configuredPostingCap",
          "configuredPairCap",
          "reasonCode",
          "plainEnglish",
          "claimDiscipline",
        ],
        "full_corpus_relationship_skipped_group_receipt_invalid",
      );
      validateLineage(receipt.lineage, lineage);
      const expectedEstimatedPairs =
        (receipt.distinctAddressCount * (receipt.distinctAddressCount - 1)) / 2;
      if (
        receipt.recordType !== "full_corpus_skipped_group_receipt" ||
        receipt.schemaVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
        receipt.postingShard !== value.postingShard ||
        ![
          "address_identity",
          "source_identity",
          "source_record",
          "source_lineage",
          "duplicate_cluster",
          "matchable_value",
          "space_time",
          "duration",
        ].includes(receipt.routeKind) ||
        !["high_frequency_group_skipped", "direct_target_missing"].includes(
          receipt.reasonCode,
        ) ||
        !/^route:[a-z_]+:[a-f0-9]{64}$/.test(receipt.routeSignature) ||
        typeof receipt.receiptId !== "string" ||
        !/^skip:[a-f0-9]{64}$/.test(receipt.receiptId) ||
        !Number.isSafeInteger(receipt.postingCount) ||
        receipt.postingCount < 1 ||
        !Number.isSafeInteger(receipt.distinctAddressCount) ||
        receipt.distinctAddressCount < 1 ||
        receipt.distinctAddressCount > receipt.postingCount ||
        !Number.isSafeInteger(receipt.estimatedPairCount) ||
        receipt.estimatedPairCount < 0 ||
        !Number.isSafeInteger(receipt.configuredPostingCap) ||
        receipt.configuredPostingCap < 1 ||
        !Number.isSafeInteger(receipt.configuredPairCap) ||
        receipt.configuredPairCap < 1 ||
        (receipt.reasonCode === "high_frequency_group_skipped" &&
          receipt.estimatedPairCount !== expectedEstimatedPairs) ||
        (receipt.reasonCode === "direct_target_missing" &&
          receipt.estimatedPairCount !== 0) ||
        typeof receipt.plainEnglish !== "string" ||
        !receipt.plainEnglish.length ||
        canonicalizeRelationshipInput(receipt.claimDiscipline) !==
          canonicalizeRelationshipInput(
            FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
          )
      )
        invalid("full_corpus_relationship_skipped_group_receipt_invalid");
      const { receiptId, ...withoutId } = receipt;
      if (receiptId !== `skip:${digestValue(withoutId)}`)
        invalid(
          "full_corpus_relationship_skipped_group_receipt_digest_mismatch",
        );
      return receipt;
    })
    .sort((left, right) => compareText(left.receiptId, right.receiptId));
  if (
    canonicalizeRelationshipInput(skippedGroups) !==
    canonicalizeRelationshipInput(value.skippedGroups)
  ) {
    invalid("full_corpus_relationship_skipped_group_receipt_order_invalid");
  }
  const candidateFragments = value.candidateFragments.map((fragment) =>
    decodeFullCorpusCandidateFragment(fragment, {
      lineage,
      postingMapDigest: value.postingMapDigest,
      pairShardCount: value.pairShardCount,
    }),
  );
  if (
    candidateFragments.some(
      (fragment) => fragment.sourcePostingShard !== value.postingShard,
    ) ||
    new Set(candidateFragments.map((fragment) => fragment.pairShard)).size !==
      candidateFragments.length
  ) {
    invalid(
      "full_corpus_relationship_posting_reduction_candidate_fragment_mismatch",
    );
  }
  const candidatePairKeys = new Set(
    candidateFragments.flatMap((fragment) =>
      fragment.candidates.map((candidate) => candidate.pairKey),
    ),
  );
  const candidateRouteCount = candidateFragments.reduce(
    (sum, fragment) =>
      sum +
      fragment.candidates.reduce(
        (subtotal, candidate) => subtotal + candidate.reasons.length,
        0,
      ),
    0,
  );
  if (
    candidatePairKeys.size !== value.candidatePairCount ||
    candidateRouteCount !== value.candidateRouteCount
  ) {
    invalid(
      "full_corpus_relationship_posting_reduction_candidate_accounting_mismatch",
    );
  }
  const { reductionDigest, ...withoutDigest } = value;
  if (
    !SHA256_PATTERN.test(reductionDigest) ||
    reductionDigest !== digestValue(withoutDigest)
  ) {
    invalid("full_corpus_relationship_posting_reduction_digest_mismatch");
  }
  return {
    ...value,
    lineage,
    presenceRecords,
    skippedGroups,
    candidateFragments,
  };
};

export const decodeFullCorpusPairReducerResult = (
  input: Buffer | string | unknown,
  expected: {
    lineage?: FullCorpusPipelineLineage;
    postingMapDigest?: string;
    pairShardCount?: number;
    fragments?: readonly FullCorpusCandidateFragment[];
  } = {},
): FullCorpusPairReducerResult => {
  const raw = parsePipelineObject(
    input,
    "full_corpus_relationship_pair_reducer_result",
  );
  requireExactKeys(
    raw,
    [
      "recordType",
      "schemaVersion",
      "lineage",
      "postingMapDigest",
      "pairShard",
      "pairShardCount",
      "candidateFragmentSetSha256",
      "candidatePairCount",
      "evaluatedAddressCount",
      "typedEdgeCount",
      "rejectedCandidateCount",
      "evaluations",
      "edges",
      "resultDigest",
    ],
    "full_corpus_relationship_pair_reducer_result_invalid",
  );
  const value = raw as unknown as FullCorpusPairReducerResult;
  const lineage = validateLineage(value.lineage, expected.lineage);
  if (
    value.recordType !== "full_corpus_relationship_pair_reducer_result" ||
    value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    value.postingMapDigest !==
      (expected.postingMapDigest ?? value.postingMapDigest) ||
    value.pairShardCount !==
      (expected.pairShardCount ?? value.pairShardCount) ||
    !SHA256_PATTERN.test(value.postingMapDigest) ||
    !SHA256_PATTERN.test(value.candidateFragmentSetSha256) ||
    !Number.isSafeInteger(value.pairShard) ||
    value.pairShard < 0 ||
    value.pairShard >= value.pairShardCount ||
    !Array.isArray(value.evaluations) ||
    !Array.isArray(value.edges)
  )
    invalid("full_corpus_relationship_pair_reducer_result_invalid");
  const evaluations = value.evaluations.map((evaluation) =>
    decodeTypedRelationshipPairEvaluation(evaluation, lineage.binding),
  );
  const edges = value.edges.map((edge) =>
    decodeTypedRelationshipEdge(edge, lineage.binding),
  );
  const evaluationEdges = evaluations
    .flatMap((evaluation) => evaluation.edges)
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  const sortedEdges = [...edges].sort((left, right) =>
    compareText(left.edgeId, right.edgeId),
  );
  if (
    value.candidatePairCount !== evaluations.length ||
    value.evaluatedAddressCount !==
      new Set(evaluations.flatMap((evaluation) => evaluation.addresses)).size ||
    value.typedEdgeCount !== edges.length ||
    value.rejectedCandidateCount !==
      evaluations.filter((evaluation) => !evaluation.edges.length).length ||
    new Set(evaluations.map((evaluation) => evaluation.evaluationDigest))
      .size !== evaluations.length ||
    new Set(edges.map((edge) => edge.edgeId)).size !== edges.length ||
    canonicalizeRelationshipInput(sortedEdges) !==
      canonicalizeRelationshipInput(evaluationEdges)
  )
    invalid("full_corpus_relationship_pair_reducer_edge_accounting_mismatch");
  const { resultDigest, ...withoutDigest } = value;
  if (
    !SHA256_PATTERN.test(resultDigest) ||
    resultDigest !== digestValue(withoutDigest)
  ) {
    invalid("full_corpus_relationship_pair_reducer_digest_mismatch");
  }
  const decoded = { ...value, lineage, evaluations, edges };
  if (expected.fragments)
    validatePairReducerStructure({
      reducer: decoded,
      expectedFragments: expected.fragments,
      lineage,
      postingMapDigest: value.postingMapDigest,
      pairShardCount: value.pairShardCount,
    });
  return decoded;
};

export const decodeFullCorpusRelationshipCompletion = (
  input: Buffer | string | unknown,
  expectedLineage?: FullCorpusPipelineLineage,
): FullCorpusRelationshipCompletion => {
  const raw = parsePipelineObject(input, "full_corpus_relationship_completion");
  requireExactKeys(
    raw,
    [
      "recordType",
      "schemaVersion",
      "lineage",
      "postingMapDigest",
      "postingShardCount",
      "contextualCompletion",
      "pairShardCount",
      "universeRecordCount",
      "addressKindCounts",
      "candidatePairCount",
      "evaluatedAddressCount",
      "linkedAddressCount",
      "candidateOnlyAddressCount",
      "isolatedAddressCount",
      "typedEdgeCount",
      "typedEdgeTypeCounts",
      "skippedGroupCount",
      "skippedEstimatedPairCount",
      "postingReductionSetSha256",
      "pairReducerSetSha256",
      "evaluationSetSha256",
      "edgeSetSha256",
      "skippedGroupSetSha256",
      "addressLedgerShards",
      "addressLedgerSetSha256",
      "claimDiscipline",
      "plainEnglish",
      "completionDigest",
    ],
    "full_corpus_relationship_completion_invalid",
  );
  const value = raw as unknown as FullCorpusRelationshipCompletion;
  const lineage = validateLineage(value.lineage, expectedLineage);
  const contextualCompletion = decodeFullCorpusContextualCompletionReference(
    value.contextualCompletion,
  );
  if (
    value.recordType !== "full_corpus_relationship_completion" ||
    value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    !SHA256_PATTERN.test(value.postingMapDigest) ||
    !Array.isArray(value.addressLedgerShards) ||
    typeof value.plainEnglish !== "string" ||
    !value.plainEnglish.length ||
    canonicalizeRelationshipInput(value.claimDiscipline) !==
      canonicalizeRelationshipInput(
        FULL_CORPUS_RELATIONSHIP_PIPELINE_CLAIM_DISCIPLINE,
      )
  )
    invalid("full_corpus_relationship_completion_invalid");
  normalizeShardCount(
    value.postingShardCount,
    "full_corpus_relationship_posting_shard_count_invalid",
  );
  normalizeShardCount(
    value.pairShardCount,
    "full_corpus_relationship_pair_shard_count_invalid",
  );
  requireExactKeys(
    value.addressKindCounts,
    ["sighting", "document", "photo", "video"],
    "full_corpus_relationship_completion_kind_counts_invalid",
  );
  requireExactKeys(
    value.typedEdgeTypeCounts,
    FULL_CORPUS_TYPED_EDGE_TYPES,
    "full_corpus_relationship_completion_edge_counts_invalid",
  );
  for (const count of [
    value.universeRecordCount,
    value.candidatePairCount,
    value.evaluatedAddressCount,
    value.linkedAddressCount,
    value.candidateOnlyAddressCount,
    value.isolatedAddressCount,
    value.typedEdgeCount,
    value.skippedGroupCount,
    value.skippedEstimatedPairCount,
    ...Object.values(value.addressKindCounts),
    ...Object.values(value.typedEdgeTypeCounts),
  ])
    if (!Number.isSafeInteger(count) || count < 0)
      invalid("full_corpus_relationship_completion_count_invalid");
  const ledgerShards = value.addressLedgerShards
    .map((shard) => {
      requireExactKeys(
        shard,
        [
          "shard",
          "shardCount",
          "states",
          "stateCount",
          "linkedCount",
          "candidateOnlyCount",
          "isolatedCount",
          "stateSetSha256",
        ],
        "full_corpus_relationship_address_ledger_shard_invalid",
      );
      if (
        !Array.isArray(shard.states) ||
        !Number.isSafeInteger(shard.shard) ||
        !Number.isSafeInteger(shard.shardCount) ||
        shard.shard < 0 ||
        shard.shard >= shard.shardCount
      ) {
        invalid("full_corpus_relationship_address_ledger_shard_invalid");
      }
      let previous = "";
      for (const state of shard.states) {
        requireExactKeys(
          state,
          ["address", "recordDigest", "kind", "status"],
          "full_corpus_relationship_address_state_invalid",
        );
        if (
          state.address <= previous ||
          !SHA256_PATTERN.test(state.recordDigest) ||
          addressKind(state.address) !== state.kind ||
          !["linked", "candidate_only", "isolated"].includes(state.status) ||
          fullCorpusRelationshipShard(state.address, shard.shardCount) !==
            shard.shard
        ) {
          invalid("full_corpus_relationship_address_state_invalid");
        }
        previous = state.address;
      }
      if (
        shard.stateCount !== shard.states.length ||
        shard.linkedCount !==
          shard.states.filter((state) => state.status === "linked").length ||
        shard.candidateOnlyCount !==
          shard.states.filter((state) => state.status === "candidate_only")
            .length ||
        shard.isolatedCount !==
          shard.states.filter((state) => state.status === "isolated").length ||
        shard.stateSetSha256 !==
          digestValue(
            shard.states
              .map(
                (state) =>
                  `${state.address}:${state.recordDigest}:${state.status}`,
              )
              .join("\n"),
          )
      )
        invalid(
          "full_corpus_relationship_address_ledger_shard_accounting_mismatch",
        );
      return shard;
    })
    .sort((left, right) => left.shard - right.shard);
  const states = ledgerShards.flatMap((shard) => shard.states);
  if (
    !ledgerShards.length ||
    ledgerShards.length !== ledgerShards[0].shardCount ||
    ledgerShards.some(
      (shard, index) =>
        shard.shard !== index ||
        shard.shardCount !== ledgerShards[0].shardCount,
    ) ||
    states.length !== value.universeRecordCount ||
    new Set(states.map((state) => state.address)).size !== states.length ||
    states.filter((state) => state.status === "linked").length !==
      value.linkedAddressCount ||
    states.filter((state) => state.status === "candidate_only").length !==
      value.candidateOnlyAddressCount ||
    states.filter((state) => state.status === "isolated").length !==
      value.isolatedAddressCount ||
    Object.values(value.addressKindCounts).reduce(
      (sum, count) => sum + count,
      0,
    ) !== value.universeRecordCount ||
    Object.values(value.typedEdgeTypeCounts).reduce(
      (sum, count) => sum + count,
      0,
    ) !== value.typedEdgeCount ||
    value.typedEdgeTypeCounts.contextual_explanation_candidate !==
      contextualCompletion.acceptedEdgeCount ||
    value.addressLedgerSetSha256 !==
      digestValue(
        ledgerShards
          .map((shard) => `${shard.shard}:${shard.stateSetSha256}`)
          .join("\n"),
      )
  )
    invalid("full_corpus_relationship_completion_accounting_mismatch");
  for (const digest of [
    value.postingReductionSetSha256,
    value.pairReducerSetSha256,
    value.evaluationSetSha256,
    value.edgeSetSha256,
    value.skippedGroupSetSha256,
    value.addressLedgerSetSha256,
  ])
    if (!SHA256_PATTERN.test(digest))
      invalid("full_corpus_relationship_completion_digest_invalid");
  const { completionDigest, ...withoutDigest } = value;
  if (
    !SHA256_PATTERN.test(completionDigest) ||
    completionDigest !== digestValue(withoutDigest)
  ) {
    invalid("full_corpus_relationship_completion_digest_mismatch");
  }
  return {
    ...value,
    lineage,
    contextualCompletion,
    addressLedgerShards: ledgerShards,
  };
};
