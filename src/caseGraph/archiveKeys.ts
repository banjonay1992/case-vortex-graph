const normalizeCorpusVersion = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(normalized)) {
    throw new Error('case_graph_corpus_version_invalid');
  }
  return normalized;
};

export const getCaseGraphCorpusPrefix = (corpusVersion: string) => (
  `case-vortex/corpora/${normalizeCorpusVersion(corpusVersion)}`
);

export const getCaseGraphFeatureKeys = (corpusVersion: string, partNumber: number) => {
  if (!Number.isSafeInteger(partNumber) || partNumber < 0 || partNumber > 999_999) {
    throw new Error('case_graph_part_number_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/features`;
  const part = String(partNumber).padStart(6, '0');
  return {
    archiveKey: `${prefix}/parts/part-${part}.ndjson.gz`,
    manifestKey: `${prefix}/parts/part-${part}.manifest.json`,
  };
};

export const getCaseGraphFeatureControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/features`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    rarityKey: `${prefix}/rarity.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphPostingFragmentKeys = (
  corpusVersion: string,
  inputPartNumber: number,
  reducerShard: number,
) => {
  if (!Number.isSafeInteger(inputPartNumber) || inputPartNumber < 0 || inputPartNumber > 999_999) {
    throw new Error('case_graph_part_number_invalid');
  }
  if (!Number.isSafeInteger(reducerShard) || reducerShard < 0 || reducerShard > 4095) {
    throw new Error('case_graph_reducer_shard_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/candidates/postings`;
  const part = String(inputPartNumber).padStart(6, '0');
  const shard = String(reducerShard).padStart(4, '0');
  return {
    archiveKey: `${prefix}/shard-${shard}/part-${part}.json.gz`,
    manifestKey: `${prefix}/shard-${shard}/part-${part}.manifest.json`,
  };
};

export const getCaseGraphPostingPartReceiptKey = (corpusVersion: string, inputPartNumber: number) => {
  if (!Number.isSafeInteger(inputPartNumber) || inputPartNumber < 0 || inputPartNumber > 999_999) {
    throw new Error('case_graph_part_number_invalid');
  }
  const part = String(inputPartNumber).padStart(6, '0');
  return `${getCaseGraphCorpusPrefix(corpusVersion)}/candidates/postings/map-parts/part-${part}.manifest.json`;
};

export const getCaseGraphPostingControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/candidates/postings`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphPreliminaryReducerKeys = (corpusVersion: string, reducerShard: number) => {
  if (!Number.isSafeInteger(reducerShard) || reducerShard < 0 || reducerShard > 4095) {
    throw new Error('case_graph_reducer_shard_invalid');
  }
  const prefix = getCaseGraphCorpusPrefix(corpusVersion);
  const shard = String(reducerShard).padStart(4, '0');
  return {
    candidatesKey: `${prefix}/candidates/reduced/shard-${shard}.ndjson.gz`,
    relationshipsKey: `${prefix}/edges/preliminary/shard-${shard}.ndjson.gz`,
    manifestKey: `${prefix}/candidates/reduced/shard-${shard}.manifest.json`,
  };
};

export const getCaseGraphPreliminaryReducerControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/candidates/reduced`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphEdgeRouteFragmentKeys = (
  corpusVersion: string,
  edgeShard: number,
  sourceReducerShard: number,
) => {
  if (!Number.isSafeInteger(edgeShard) || edgeShard < 0 || edgeShard > 4095) {
    throw new Error('case_graph_edge_shard_invalid');
  }
  if (!Number.isSafeInteger(sourceReducerShard) || sourceReducerShard < 0 || sourceReducerShard > 4095) {
    throw new Error('case_graph_reducer_shard_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/edges/routes`;
  const edge = String(edgeShard).padStart(4, '0');
  const reducer = String(sourceReducerShard).padStart(4, '0');
  return {
    archiveKey: `${prefix}/edge-shard-${edge}/from-reducer-${reducer}.ndjson.gz`,
    manifestKey: `${prefix}/edge-shard-${edge}/from-reducer-${reducer}.manifest.json`,
  };
};

export const getCaseGraphEdgeRoutePartReceiptKey = (corpusVersion: string, sourceReducerShard: number) => {
  if (!Number.isSafeInteger(sourceReducerShard) || sourceReducerShard < 0 || sourceReducerShard > 4095) {
    throw new Error('case_graph_reducer_shard_invalid');
  }
  const reducer = String(sourceReducerShard).padStart(4, '0');
  return `${getCaseGraphCorpusPrefix(corpusVersion)}/edges/routes/map-parts/reducer-${reducer}.manifest.json`;
};

export const getCaseGraphEdgeRouteControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/edges/routes`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphFinalEdgeShardKeys = (corpusVersion: string, edgeShard: number) => {
  if (!Number.isSafeInteger(edgeShard) || edgeShard < 0 || edgeShard > 4095) {
    throw new Error('case_graph_edge_shard_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/edges/final`;
  const shard = String(edgeShard).padStart(4, '0');
  return {
    edgesKey: `${prefix}/shard-${shard}.ndjson.gz`,
    degreeContributionsKey: `${prefix}/shard-${shard}.degrees.ndjson.gz`,
    manifestKey: `${prefix}/shard-${shard}.manifest.json`,
  };
};

export const getCaseGraphFinalEdgeControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/edges/final`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphNodeRouteFragmentKeys = (
  corpusVersion: string,
  nodeShard: number,
  inputKind: 'feature' | 'edge',
  inputNumber: number,
) => {
  if (!Number.isSafeInteger(nodeShard) || nodeShard < 0 || nodeShard > 4095) {
    throw new Error('case_graph_node_shard_invalid');
  }
  if (!Number.isSafeInteger(inputNumber) || inputNumber < 0 || inputNumber > 999_999) {
    throw new Error('case_graph_node_route_input_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/nodes/routes`;
  const node = String(nodeShard).padStart(4, '0');
  const input = String(inputNumber).padStart(6, '0');
  const from = inputKind === 'feature' ? `feature-${input}` : `edge-${input}`;
  return {
    archiveKey: `${prefix}/node-shard-${node}/from-${from}.json.gz`,
    manifestKey: `${prefix}/node-shard-${node}/from-${from}.manifest.json`,
  };
};

export const getCaseGraphNodeRoutePartReceiptKey = (
  corpusVersion: string,
  inputKind: 'feature' | 'edge',
  inputNumber: number,
) => {
  if (!Number.isSafeInteger(inputNumber) || inputNumber < 0 || inputNumber > 999_999) {
    throw new Error('case_graph_node_route_input_invalid');
  }
  const input = String(inputNumber).padStart(6, '0');
  return `${getCaseGraphCorpusPrefix(corpusVersion)}/nodes/routes/map-parts/${inputKind}-${input}.manifest.json`;
};

export const getCaseGraphNodeRouteControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/nodes/routes`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphNodeIndexShardKeys = (corpusVersion: string, nodeShard: number) => {
  if (!Number.isSafeInteger(nodeShard) || nodeShard < 0 || nodeShard > 4095) {
    throw new Error('case_graph_node_shard_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/nodes/final`;
  const shard = String(nodeShard).padStart(4, '0');
  return {
    nodesKey: `${prefix}/shard-${shard}.nodes.ndjson.gz`,
    egoIndexKey: `${prefix}/shard-${shard}.ego.ndjson.gz`,
    manifestKey: `${prefix}/shard-${shard}.manifest.json`,
  };
};

export const getCaseGraphNodeIndexControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/nodes/final`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphDensityKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/density`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    archiveKey: `${prefix}/semantic-zoom.json.gz`,
    manifestKey: `${prefix}/semantic-zoom.manifest.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};

export const getCaseGraphPublicationKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/publication`;
  return {
    manifestKey: `${prefix}/public-manifest.json`,
    accountingReceiptKey: `${prefix}/corpus-accounting-receipt.json`,
    pairCalibrationReceiptKey: `${prefix}/pair-calibration-receipt.json`,
    contextualCalibrationReceiptKey: `${prefix}/contextual-calibration-receipt.json`,
    calibrationSetReceiptKey: `${prefix}/calibration-set-receipt.json`,
    humanReviewBundleKey: `${prefix}/calibration-human-review-bundle.json`,
    pairCalibrationArtifactKey: `${prefix}/pair-calibration-artifact.json`,
    pairCalibrationTrustPolicyKey: `${prefix}/pair-calibration-trust-policy.json`,
    contextualCalibrationArtifactKey: `${prefix}/contextual-calibration-artifact.json`,
    contextualCalibrationTrustPolicyKey: `${prefix}/contextual-calibration-trust-policy.json`,
    contextualRelationshipCompletionKey: `${prefix}/contextual-relationship-completion.json`,
    completionManifestKey: `${prefix}/_candidate.complete.manifest.json`,
  };
};

const normalizeResearchPublicationId = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(normalized)) {
    throw new Error('case_graph_research_search_publication_id_invalid');
  }
  return normalized;
};

const normalizeResearchManifestSha256 = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('case_graph_research_search_manifest_sha_invalid');
  }
  return normalized;
};

const normalizeResearchSearchShard = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4095) {
    throw new Error('case_graph_research_search_shard_invalid');
  }
  return String(value).padStart(4, '0');
};

/**
 * The completion manifest is publication-specific. Immutable shard blobs are
 * content addressed so an unchanged shard can be reused by a later publication
 * without weakening the publication/manifest binding held by the completion.
 */
export const getCaseGraphResearchSearchControlKeys = (
  corpusVersion: string,
  publicationId: string,
  manifestSha256: string,
) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/research-search/publications/${normalizeResearchPublicationId(publicationId)}/${normalizeResearchManifestSha256(manifestSha256)}`;
  return { manifestKey: `${prefix}/_complete.manifest.json` };
};

/**
 * PostgreSQL is the production serving index. Its immutable completion receipt
 * deliberately has a different key from the experimental JSON-shard manifest
 * so the two formats can never satisfy each other's availability checks.
 */
export const getCaseGraphResearchSearchPostgresReceiptKey = (
  corpusVersion: string,
  publicationId: string,
  manifestSha256: string,
) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/research-search/postgres-v1/publications/${normalizeResearchPublicationId(publicationId)}/${normalizeResearchManifestSha256(manifestSha256)}`;
  return `${prefix}/_complete.receipt.json`;
};

/**
 * The retained-corpus serving bundle contains the three immutable receipts
 * required to prove how every retained row influences research. It is bound to
 * one public publication and kept separate from both evidence-search formats.
 */
export const getCaseVortexRetainedInfluenceServingBundleKey = (
  corpusVersion: string,
  publicationId: string,
  manifestSha256: string,
) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/retained-influence/postgres-v1/publications/${normalizeResearchPublicationId(publicationId)}/${normalizeResearchManifestSha256(manifestSha256)}`;
  return `${prefix}/_complete.bundle.json`;
};

export const getCaseGraphResearchSearchBlobKey = (
  corpusVersion: string,
  kind: 'term' | 'document',
  shard: number,
  compressedSha256: string,
) => {
  if (kind !== 'term' && kind !== 'document') {
    throw new Error('case_graph_research_search_shard_kind_invalid');
  }
  const digest = normalizeResearchManifestSha256(compressedSha256);
  return `${getCaseGraphCorpusPrefix(corpusVersion)}/research-search/blobs/${kind}/shard-${normalizeResearchSearchShard(shard)}-${digest}.json.gz`;
};

export const getEvidenceUniversePartKeys = (
  corpusVersion: string,
  kind: 'sighting' | 'document' | 'photo' | 'video',
  partNumber: number,
) => {
  if (!['sighting', 'document', 'photo', 'video'].includes(kind)) throw new Error('evidence_universe_kind_invalid');
  if (!Number.isSafeInteger(partNumber) || partNumber < 0 || partNumber > 999_999) {
    throw new Error('evidence_universe_part_number_invalid');
  }
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/universe/nodes/${kind}`;
  const part = String(partNumber).padStart(6, '0');
  return {
    archiveKey: `${prefix}/part-${part}.ndjson.gz`,
    manifestKey: `${prefix}/part-${part}.manifest.json`,
  };
};

export const getEvidenceUniverseControlKeys = (corpusVersion: string) => {
  const prefix = `${getCaseGraphCorpusPrefix(corpusVersion)}/universe/nodes`;
  return {
    checkpointKey: `${prefix}/_checkpoint.json`,
    completionManifestKey: `${prefix}/_complete.manifest.json`,
  };
};
