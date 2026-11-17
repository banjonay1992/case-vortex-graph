import {
  accountRelationshipInputRecords,
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  type RelationshipInputRecord,
} from "./relationshipInputSnapshot";
import {
  decodeRelationshipInputSnapshotManifest,
  type RelationshipInputSnapshotManifest,
} from "./relationshipInputArchive";
import {
  TYPED_RELATIONSHIP_POLICY,
  decodeTypedRelationshipRarityIndex,
  type TypedRelationshipRarityIndex,
} from "./typedRelationshipEngine";
import {
  FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
  type FullCorpusCandidateReasonCode,
  type FullCorpusPipelineLineage,
  type FullCorpusPostingFragment,
  type FullCorpusPostingFragmentSummary,
  type FullCorpusPostingKind,
  type FullCorpusPostingMapManifest,
  type FullCorpusRelationshipPosting,
} from "./typedRelationshipPipelineTypes";
import {
  buildLineage,
  addressKind,
  compareText,
  digestValue,
  emptyKindCounts,
  durationHome,
  ecefHome,
  factIdentity,
  factMayRoute,
  fullCorpusRelationshipShard,
  invalid,
  normalizeShardCount,
  rarityRecordSetDigest,
  recordSetDigest,
  requireExactKeys,
  routeSignature,
  sameAccounting,
  selectedLocations,
  selectedTimestamps,
  validateLineage,
} from "./typedRelationshipPipelineSupport";

type PostingDraft = Omit<
  FullCorpusRelationshipPosting,
  "recordIndex" | "signature"
> & {
  signature: string;
};

const posting = (
  routeKind: FullCorpusPostingKind,
  token: unknown,
  values: Omit<PostingDraft, "signature" | "routeKind" | "routeToken"> & {
    routeToken?: string;
  },
): PostingDraft => ({
  signature: routeSignature(routeKind, token),
  routeKind,
  routeToken: values.routeToken ?? canonicalizeRelationshipInput(token),
  reasonCode: values.reasonCode,
  evidenceIds: [...new Set(values.evidenceIds)].sort(compareText),
  targetAddress: values.targetAddress,
  targetSourceId: values.targetSourceId,
  spaceTimeHome: values.spaceTimeHome,
  durationHome: values.durationHome,
});

const buildRecordPostings = (
  record: RelationshipInputRecord,
  rarity: TypedRelationshipRarityIndex,
): PostingDraft[] => {
  const drafts: PostingDraft[] = [];
  drafts.push(
    posting(
      "address_identity",
      { address: record.address },
      {
        reasonCode: null,
        evidenceIds: [],
        targetAddress: record.address,
        targetSourceId: null,
        spaceTimeHome: null,
        durationHome: null,
      },
    ),
  );
  for (const reference of record.crossReferences)
    drafts.push(
      posting(
        "address_identity",
        { address: reference.targetAddress },
        {
          reasonCode: "explicit_cross_reference",
          evidenceIds: [
            reference.referenceId,
            ...reference.origins.map((origin) => origin.originId),
          ],
          targetAddress: reference.targetAddress,
          targetSourceId: null,
          spaceTimeHome: null,
          durationHome: null,
          routeToken: canonicalizeRelationshipInput({
            address: reference.targetAddress,
          }),
        },
      ),
    );

  drafts.push(
    posting(
      "source_identity",
      { sourceId: record.source.sourceId },
      {
        reasonCode: null,
        evidenceIds: [],
        targetAddress: null,
        targetSourceId: record.source.sourceId,
        spaceTimeHome: null,
        durationHome: null,
      },
    ),
  );
  for (const assertion of record.sourceAssertions)
    drafts.push(
      posting(
        "source_identity",
        { sourceId: assertion.counterpartySourceId },
        {
          reasonCode: "governed_source_assertion",
          evidenceIds: [
            assertion.assertionId,
            ...assertion.origins.map((origin) => origin.originId),
          ],
          targetAddress: null,
          targetSourceId: assertion.counterpartySourceId,
          spaceTimeHome: null,
          durationHome: null,
          routeToken: canonicalizeRelationshipInput({
            sourceId: assertion.counterpartySourceId,
          }),
        },
      ),
    );
  if (record.source.sourceRecordId !== null)
    drafts.push(
      posting(
        "source_record",
        {
          sourceId: record.source.sourceId,
          sourceRecordId: record.source.sourceRecordId,
        },
        {
          reasonCode: "same_source_record",
          evidenceIds: [],
          targetAddress: null,
          targetSourceId: null,
          spaceTimeHome: null,
          durationHome: null,
        },
      ),
    );
  drafts.push(
    posting(
      "source_lineage",
      { lineageId: record.source.lineageId },
      {
        reasonCode: "same_source_lineage",
        evidenceIds: [],
        targetAddress: null,
        targetSourceId: null,
        spaceTimeHome: null,
        durationHome: null,
      },
    ),
  );
  if (record.duplicateLineage)
    drafts.push(
      posting(
        "duplicate_cluster",
        { clusterId: record.duplicateLineage.clusterId },
        {
          reasonCode: "same_duplicate_cluster",
          evidenceIds: [
            record.duplicateLineage.clusterId,
            ...record.duplicateLineage.origins.map((origin) => origin.originId),
          ],
          targetAddress: null,
          targetSourceId: null,
          spaceTimeHome: null,
          durationHome: null,
        },
      ),
    );

  const knownRarityValues = new Set(
    rarity.entries.map((entry) => entry.valueKey),
  );
  for (const fact of record.facts) {
    const identity = factIdentity(fact);
    if (
      !identity ||
      !factMayRoute(fact) ||
      !knownRarityValues.has(identity.valueKey)
    )
      continue;
    drafts.push(
      posting(
        "matchable_value",
        { valueKey: identity.valueKey },
        {
          reasonCode: "shared_matchable_value",
          evidenceIds: [
            fact.factId,
            ...fact.origins.map((origin) => origin.originId),
          ],
          targetAddress: null,
          targetSourceId: null,
          spaceTimeHome: null,
          durationHome: null,
        },
      ),
    );
  }

  for (const timestampFact of selectedTimestamps(record))
    for (const locationFact of selectedLocations(record)) {
      if (
        timestampFact.value?.kind !== "timestamp" ||
        locationFact.value?.kind !== "geo_point"
      )
        continue;
      const home = ecefHome(
        timestampFact.value.timestamp,
        locationFact.value.lat,
        locationFact.value.lon,
      );
      if (!home) continue;
      for (const timeOffset of [0, -1])
        for (const xOffset of [0, -1]) {
          for (const yOffset of [0, -1])
            for (const zOffset of [0, -1]) {
              const route = {
                time: home.time + timeOffset,
                x: home.x + xOffset,
                y: home.y + yOffset,
                z: home.z + zOffset,
              };
              drafts.push(
                posting("space_time", route, {
                  reasonCode: "nearby_space_time_bucket",
                  evidenceIds: [
                    timestampFact.factId,
                    locationFact.factId,
                    ...timestampFact.origins.map((origin) => origin.originId),
                    ...locationFact.origins.map((origin) => origin.originId),
                  ],
                  targetAddress: null,
                  targetSourceId: null,
                  spaceTimeHome: home,
                  durationHome: null,
                }),
              );
            }
        }
    }

  for (const fact of record.facts) {
    if (
      !factMayRoute(fact) ||
      fact.family !== "duration" ||
      fact.value?.kind !== "duration"
    )
      continue;
    if (
      fact.value.seconds <
      TYPED_RELATIONSHIP_POLICY.minimumInformativeDurationSeconds
    )
      continue;
    const home = durationHome(fact.value.seconds);
    for (const route of [home, home - 1])
      drafts.push(
        posting(
          "duration",
          { bucket: route },
          {
            reasonCode: "similar_duration_bucket",
            evidenceIds: [
              fact.factId,
              ...fact.origins.map((origin) => origin.originId),
            ],
            targetAddress: null,
            targetSourceId: null,
            spaceTimeHome: null,
            durationHome: home,
          },
        ),
      );
  }

  const unique = new Map<string, PostingDraft>();
  for (const draft of drafts) {
    const key = canonicalizeRelationshipInput(draft);
    unique.set(key, draft);
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.signature, right.signature) ||
      compareText(left.routeKind, right.routeKind) ||
      compareText(
        canonicalizeRelationshipInput(left),
        canonicalizeRelationshipInput(right),
      ),
  );
};

const postingFragmentWithoutDigest = (
  value: Omit<FullCorpusPostingFragment, "fragmentDigest">,
) => value;

const validatePartRecords = (
  recordsInput: readonly RelationshipInputRecord[],
  inputPartNumber: number,
  manifest: RelationshipInputSnapshotManifest,
) => {
  if (
    !Number.isSafeInteger(inputPartNumber) ||
    inputPartNumber < 0 ||
    inputPartNumber >= manifest.partCount
  ) {
    invalid("full_corpus_relationship_input_part_invalid");
  }
  const summary = manifest.parts[inputPartNumber];
  const records = recordsInput
    .map((record) => decodeRelationshipInputRecord(record, manifest.binding))
    .sort((left, right) => compareText(left.address, right.address));
  if (records.length !== summary.rowCount || !records.length)
    invalid("full_corpus_relationship_part_row_count_mismatch");
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].address >= records[index].address)
      invalid("full_corpus_relationship_part_address_order_invalid");
  }
  if (
    records[0].address !== summary.firstAddress ||
    records.at(-1)?.address !== summary.lastAddress
  ) {
    invalid("full_corpus_relationship_part_address_bounds_mismatch");
  }
  if (recordSetDigest(records) !== summary.recordSetSha256)
    invalid("full_corpus_relationship_part_record_set_mismatch");
  if (
    !sameAccounting(
      accountRelationshipInputRecords(records, manifest.binding),
      summary.accounting,
    )
  ) {
    invalid("full_corpus_relationship_part_accounting_mismatch");
  }
  return records;
};

export const buildFullCorpusPostingFragments = (params: {
  records: readonly RelationshipInputRecord[];
  inputPartNumber: number;
  relationshipInputManifest: RelationshipInputSnapshotManifest;
  rarityIndex: TypedRelationshipRarityIndex;
  postingShardCount: number;
  maxPostingsPerRecord?: number;
}): FullCorpusPostingFragment[] => {
  const manifest = decodeRelationshipInputSnapshotManifest(
    params.relationshipInputManifest,
  );
  const rarity = decodeTypedRelationshipRarityIndex(
    params.rarityIndex,
    manifest.binding,
  );
  const postingShardCount = normalizeShardCount(
    params.postingShardCount,
    "full_corpus_relationship_posting_shard_count_invalid",
  );
  const maxPostingsPerRecord = Math.trunc(params.maxPostingsPerRecord ?? 512);
  if (
    !Number.isSafeInteger(maxPostingsPerRecord) ||
    maxPostingsPerRecord < 8 ||
    maxPostingsPerRecord > 100_000
  ) {
    invalid("full_corpus_relationship_record_posting_cap_invalid");
  }
  const records = validatePartRecords(
    params.records,
    params.inputPartNumber,
    manifest,
  );
  const lineage = buildLineage(manifest, rarity);
  const byShard = new Map<
    number,
    Array<{ record: RelationshipInputRecord; posting: PostingDraft }>
  >();
  for (const record of records) {
    const postings = buildRecordPostings(record, rarity);
    if (postings.length > maxPostingsPerRecord) {
      invalid(
        `full_corpus_relationship_record_posting_limit_exceeded:${record.address}`,
      );
    }
    for (const value of postings) {
      const shard = fullCorpusRelationshipShard(
        value.signature,
        postingShardCount,
      );
      const entries = byShard.get(shard) || [];
      entries.push({ record, posting: value });
      byShard.set(shard, entries);
    }
  }
  return [...byShard.entries()]
    .sort(([left], [right]) => left - right)
    .map(([postingShard, entries]) => {
      const fragmentRecords = [
        ...new Map(
          entries.map((entry) => [entry.record.address, entry.record]),
        ).values(),
      ].sort((left, right) => compareText(left.address, right.address));
      const recordIndices = new Map(
        fragmentRecords.map((record, index) => [record.address, index]),
      );
      const postings = entries
        .map((entry): FullCorpusRelationshipPosting => ({
          ...entry.posting,
          recordIndex: recordIndices.get(entry.record.address) as number,
        }))
        .sort(
          (left, right) =>
            compareText(left.signature, right.signature) ||
            compareText(
              fragmentRecords[left.recordIndex].address,
              fragmentRecords[right.recordIndex].address,
            ) ||
            compareText(
              canonicalizeRelationshipInput(left),
              canonicalizeRelationshipInput(right),
            ),
        );
      const withoutDigest: Omit<FullCorpusPostingFragment, "fragmentDigest"> = {
        recordType: "full_corpus_relationship_posting_fragment",
        schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
        lineage,
        inputPartNumber: params.inputPartNumber,
        postingShard,
        postingShardCount,
        records: fragmentRecords,
        postings,
      };
      return {
        ...withoutDigest,
        fragmentDigest: digestValue(
          postingFragmentWithoutDigest(withoutDigest),
        ),
      };
    });
};

export const validatePostingFragment = (
  value: FullCorpusPostingFragment,
  lineage: FullCorpusPipelineLineage,
  postingShardCount: number,
) => {
  requireExactKeys(
    value,
    [
      "recordType",
      "schemaVersion",
      "lineage",
      "inputPartNumber",
      "postingShard",
      "postingShardCount",
      "records",
      "postings",
      "fragmentDigest",
    ],
    "full_corpus_relationship_posting_fragment_invalid",
  );
  if (
    value.recordType !== "full_corpus_relationship_posting_fragment" ||
    value.schemaVersion !== FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION ||
    value.postingShardCount !== postingShardCount ||
    !Number.isSafeInteger(value.inputPartNumber) ||
    value.inputPartNumber < 0 ||
    !Number.isSafeInteger(value.postingShard) ||
    value.postingShard < 0 ||
    value.postingShard >= postingShardCount ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.postings)
  )
    invalid("full_corpus_relationship_posting_fragment_invalid");
  validateLineage(value.lineage, lineage);
  const records = value.records.map((record) =>
    decodeRelationshipInputRecord(record, lineage.binding),
  );
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].address >= records[index].address)
      invalid("full_corpus_relationship_fragment_record_order_invalid");
  }
  let previous = "";
  const used = new Set<number>();
  for (const postingValue of value.postings) {
    requireExactKeys(
      postingValue,
      [
        "signature",
        "routeKind",
        "recordIndex",
        "reasonCode",
        "routeToken",
        "evidenceIds",
        "targetAddress",
        "targetSourceId",
        "spaceTimeHome",
        "durationHome",
      ],
      "full_corpus_relationship_posting_invalid",
    );
    let parsedRouteToken: unknown;
    try {
      parsedRouteToken = JSON.parse(postingValue.routeToken);
    } catch {
      invalid("full_corpus_relationship_posting_route_token_invalid");
    }
    const record = records[postingValue.recordIndex];
    const expectedReason: Partial<
      Record<FullCorpusPostingKind, FullCorpusCandidateReasonCode>
    > = {
      source_record: "same_source_record",
      source_lineage: "same_source_lineage",
      duplicate_cluster: "same_duplicate_cluster",
      matchable_value: "shared_matchable_value",
      space_time: "nearby_space_time_bucket",
      duration: "similar_duration_bucket",
    };
    const semanticShapeValid =
      postingValue.routeKind === "address_identity"
        ? ((postingValue.reasonCode === null &&
            postingValue.targetAddress === record?.address &&
            postingValue.evidenceIds.length === 0) ||
            (postingValue.reasonCode === "explicit_cross_reference" &&
              postingValue.targetAddress !== null)) &&
          postingValue.targetSourceId === null &&
          postingValue.spaceTimeHome === null &&
          postingValue.durationHome === null
        : postingValue.routeKind === "source_identity"
          ? ((postingValue.reasonCode === null &&
              postingValue.targetSourceId === record?.source.sourceId &&
              postingValue.evidenceIds.length === 0) ||
              (postingValue.reasonCode === "governed_source_assertion" &&
                postingValue.targetSourceId !== null)) &&
            postingValue.targetAddress === null &&
            postingValue.spaceTimeHome === null &&
            postingValue.durationHome === null
          : postingValue.reasonCode ===
              expectedReason[postingValue.routeKind] &&
            postingValue.targetAddress === null &&
            postingValue.targetSourceId === null &&
            (postingValue.routeKind === "space_time") ===
              (postingValue.spaceTimeHome !== null) &&
            (postingValue.routeKind === "duration") ===
              (postingValue.durationHome !== null);
    if (postingValue.spaceTimeHome !== null)
      requireExactKeys(
        postingValue.spaceTimeHome,
        ["time", "x", "y", "z"],
        "full_corpus_relationship_posting_space_time_home_invalid",
      );
    if (
      !postingValue ||
      typeof postingValue !== "object" ||
      !Object.values<FullCorpusPostingKind>({
        address_identity: "address_identity",
        source_identity: "source_identity",
        source_record: "source_record",
        source_lineage: "source_lineage",
        duplicate_cluster: "duplicate_cluster",
        matchable_value: "matchable_value",
        space_time: "space_time",
        duration: "duration",
      }).includes(postingValue.routeKind) ||
      !Number.isSafeInteger(postingValue.recordIndex) ||
      postingValue.recordIndex < 0 ||
      postingValue.recordIndex >= records.length ||
      !postingValue.signature.startsWith(`route:${postingValue.routeKind}:`) ||
      canonicalizeRelationshipInput(parsedRouteToken) !==
        postingValue.routeToken ||
      postingValue.signature !==
        routeSignature(postingValue.routeKind, parsedRouteToken) ||
      fullCorpusRelationshipShard(postingValue.signature, postingShardCount) !==
        value.postingShard ||
      !semanticShapeValid ||
      postingValue.evidenceIds.some(
        (id, index) =>
          typeof id !== "string" ||
          !id.length ||
          (index > 0 && postingValue.evidenceIds[index - 1] >= id),
      )
    )
      invalid("full_corpus_relationship_posting_invalid");
    const order = `${postingValue.signature}\0${record.address}\0${canonicalizeRelationshipInput(postingValue)}`;
    if (previous && previous >= order)
      invalid("full_corpus_relationship_posting_order_invalid");
    previous = order;
    used.add(postingValue.recordIndex);
  }
  if (used.size !== records.length)
    invalid("full_corpus_relationship_fragment_unreferenced_record");
  const withoutDigest = { ...value };
  delete (withoutDigest as Partial<FullCorpusPostingFragment>).fragmentDigest;
  if (value.fragmentDigest !== digestValue(withoutDigest))
    invalid("full_corpus_relationship_posting_fragment_digest_mismatch");
  return { ...value, lineage, records };
};

export const fragmentSummary = (
  fragment: FullCorpusPostingFragment,
): FullCorpusPostingFragmentSummary => ({
  inputPartNumber: fragment.inputPartNumber,
  postingShard: fragment.postingShard,
  recordReplicaCount: fragment.records.length,
  postingCount: fragment.postings.length,
  identityCount: fragment.postings.filter(
    (value) =>
      value.routeKind === "address_identity" && value.reasonCode === null,
  ).length,
  fragmentDigest: fragment.fragmentDigest,
});

const postingMapWithoutDigest = (
  value: Omit<FullCorpusPostingMapManifest, "mapDigest">,
) => value;

export const buildFullCorpusPostingMapManifest = (params: {
  relationshipInputManifest: RelationshipInputSnapshotManifest;
  rarityIndex: TypedRelationshipRarityIndex;
  postingShardCount: number;
  fragments: readonly FullCorpusPostingFragment[];
}): FullCorpusPostingMapManifest => {
  const manifest = decodeRelationshipInputSnapshotManifest(
    params.relationshipInputManifest,
  );
  const rarity = decodeTypedRelationshipRarityIndex(
    params.rarityIndex,
    manifest.binding,
  );
  const postingShardCount = normalizeShardCount(
    params.postingShardCount,
    "full_corpus_relationship_posting_shard_count_invalid",
  );
  const lineage = buildLineage(manifest, rarity);
  const fragments = params.fragments
    .map((fragment) =>
      validatePostingFragment(fragment, lineage, postingShardCount),
    )
    .sort(
      (left, right) =>
        left.inputPartNumber - right.inputPartNumber ||
        left.postingShard - right.postingShard,
    );
  const fragmentIdentities = new Set<string>();
  const identitiesByPart = new Map<number, RelationshipInputRecord[]>();
  for (const fragment of fragments) {
    if (fragment.inputPartNumber >= manifest.partCount)
      invalid("full_corpus_relationship_fragment_part_out_of_range");
    const identity = `${fragment.inputPartNumber}:${fragment.postingShard}`;
    if (fragmentIdentities.has(identity))
      invalid("full_corpus_relationship_duplicate_fragment");
    fragmentIdentities.add(identity);
    for (const marker of fragment.postings.filter(
      (value) =>
        value.routeKind === "address_identity" && value.reasonCode === null,
    )) {
      const record = fragment.records[marker.recordIndex];
      const list = identitiesByPart.get(fragment.inputPartNumber) || [];
      list.push(record);
      identitiesByPart.set(fragment.inputPartNumber, list);
    }
  }
  const allRecords: RelationshipInputRecord[] = [];
  const addressKindCounts = emptyKindCounts();
  for (let partNumber = 0; partNumber < manifest.partCount; partNumber += 1) {
    const records = (identitiesByPart.get(partNumber) || []).sort(
      (left, right) => compareText(left.address, right.address),
    );
    const part = manifest.parts[partNumber];
    if (
      records.length !== part.rowCount ||
      new Set(records.map((record) => record.address)).size !==
        records.length ||
      records[0]?.address !== part.firstAddress ||
      records.at(-1)?.address !== part.lastAddress ||
      recordSetDigest(records) !== part.recordSetSha256 ||
      !sameAccounting(
        accountRelationshipInputRecords(records, manifest.binding),
        part.accounting,
      )
    )
      invalid("full_corpus_relationship_identity_ledger_part_mismatch");
    for (const record of records)
      addressKindCounts[addressKind(record.address)] += 1;
    allRecords.push(...records);
  }
  if (
    allRecords.length !== manifest.binding.universeRecordCount ||
    rarityRecordSetDigest(allRecords) !== rarity.recordSetSha256
  )
    invalid("full_corpus_relationship_identity_ledger_universe_mismatch");
  const summaries = fragments.map(fragmentSummary);
  const fragmentSetSha256 = digestValue(
    summaries
      .map(
        (summary) =>
          `${summary.inputPartNumber}:${summary.postingShard}:${summary.fragmentDigest}`,
      )
      .join("\n"),
  );
  const withoutDigest: Omit<FullCorpusPostingMapManifest, "mapDigest"> = {
    recordType: "full_corpus_relationship_posting_map_manifest",
    schemaVersion: FULL_CORPUS_RELATIONSHIP_PIPELINE_VERSION,
    lineage,
    postingShardCount,
    inputPartCount: manifest.partCount,
    universeRecordCount: manifest.binding.universeRecordCount,
    addressKindCounts,
    postingCount: summaries.reduce(
      (sum, summary) => sum + summary.postingCount,
      0,
    ),
    fragmentCount: summaries.length,
    fragments: summaries,
    fragmentSetSha256,
  };
  return {
    ...withoutDigest,
    mapDigest: digestValue(postingMapWithoutDigest(withoutDigest)),
  };
};
