import {
  makeCaseGraphContentDiscoveryManifest,
  makeCaseGraphContentDiscoveryRecord,
  type CaseGraphContentDiscoveryManifest,
  type CaseGraphContentDiscoveryRecord,
  type CaseGraphContentLimitsProfile,
  type CaseGraphContentMediaKind,
} from './contentResearchArchive';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { FullCorpusPublicNode } from './typedRelationshipPublicGraph';

export const CASE_GRAPH_CONTENT_DISCOVERY_POLICY = Object.freeze({
  version: 'case-graph-content-public-node-discovery-v1',
  maximumConcurrentShardReads: 4,
  maximumNodeShards: 4_096,
  unresolvedLocatorPrefix: 'unresolved-public-node:',
  unknownClaimedMimeType: 'application/octet-stream',
} as const);

type ContentNodeKind = 'document' | 'photo' | 'video';

const fail = (code: string): never => { throw new Error(code); };

const mediaKindFor = (kind: ContentNodeKind): CaseGraphContentMediaKind => (
  kind === 'photo' ? 'image' : kind
);

export const selectCaseGraphContentLocator = (node: Pick<
  FullCorpusPublicNode,
  'address' | 'canonicalUrl' | 'previewUrl'
>) => {
  const canonicalUrl = node.canonicalUrl?.trim() || null;
  const previewUrl = node.previewUrl?.trim() || null;
  if (canonicalUrl && Buffer.byteLength(`canonical-url:${canonicalUrl}`, 'utf8') <= 4_096) {
    return { sourceAssetKey: `canonical-url:${canonicalUrl}`, selected: 'canonical_url' as const };
  }
  if (previewUrl && Buffer.byteLength(`preview-url:${previewUrl}`, 'utf8') <= 4_096) {
    return { sourceAssetKey: `preview-url:${previewUrl}`, selected: 'preview_url' as const };
  }
  return {
    sourceAssetKey: `${CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unresolvedLocatorPrefix}${node.address}`,
    selected: 'unresolved' as const,
  };
};

const isContentNode = (node: FullCorpusPublicNode): node is FullCorpusPublicNode & { kind: ContentNodeKind } => (
  node.kind === 'document' || node.kind === 'photo' || node.kind === 'video'
);

export const makeCaseGraphContentDiscoveryRecordFromPublicNode = (params: {
  publication: CaseGraphResearchPublicationBinding;
  node: FullCorpusPublicNode;
}): CaseGraphContentDiscoveryRecord | null => {
  const { node } = params;
  if (node.kind === 'sighting') return null;
  if (!isContentNode(node)
    || node.recordType !== 'full_corpus_public_node'
    || !node.address
    || !node.nodeDigest) {
    return fail('case_graph_content_public_node_invalid');
  }
  const locator = selectCaseGraphContentLocator(node);
  return makeCaseGraphContentDiscoveryRecord({
    publication: params.publication,
    address: node.address,
    nodeDigest: node.nodeDigest,
    sourceAssetKey: locator.sourceAssetKey,
    mediaKind: mediaKindFor(node.kind),
    // The public graph does not carry a trusted MIME assertion. Extraction
    // must sniff captured bytes and bind the result into the asset receipt.
    claimedMimeType: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unknownClaimedMimeType,
    sourceLocatorDigest: relationshipInputSha256({
      policy: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.version,
      selected: locator.selected,
      canonicalUrl: node.canonicalUrl,
      previewUrl: node.previewUrl,
    }),
    sourceLineageDigest: relationshipInputSha256({
      policy: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.version,
      address: node.address,
      nodeDigest: node.nodeDigest,
      source: node.source,
      sourceRecordId: node.sourceRecordId,
      updatedAt: node.updatedAt,
    }),
  });
};

export const buildCaseGraphContentDiscoveryManifestFromNodeShards = async (params: {
  publication: CaseGraphResearchPublicationBinding;
  nodeShardCount: number;
  readNodeShard: (shard: number, signal?: AbortSignal) => Promise<readonly FullCorpusPublicNode[]>;
  upstreamEnumerationReceiptSha256: string;
  limitsProfile: CaseGraphContentLimitsProfile;
  limitsApprovalReceiptSha256: string;
  maximumConcurrentReads?: number;
  signal?: AbortSignal;
  onShardComplete?: (progress: { completedShards: number; totalShards: number; discoveredAssets: number }) => void;
}): Promise<CaseGraphContentDiscoveryManifest> => {
  const nodeShardCount = params.nodeShardCount;
  const maximumConcurrentReads = params.maximumConcurrentReads
    ?? CASE_GRAPH_CONTENT_DISCOVERY_POLICY.maximumConcurrentShardReads;
  if (!Number.isSafeInteger(nodeShardCount) || nodeShardCount < 1
    || nodeShardCount > CASE_GRAPH_CONTENT_DISCOVERY_POLICY.maximumNodeShards
    || !Number.isSafeInteger(maximumConcurrentReads) || maximumConcurrentReads < 1
    || maximumConcurrentReads > CASE_GRAPH_CONTENT_DISCOVERY_POLICY.maximumConcurrentShardReads) {
    return fail('case_graph_content_discovery_plan_invalid');
  }
  if (params.signal?.aborted) return fail('case_graph_content_discovery_aborted');

  const records: CaseGraphContentDiscoveryRecord[] = [];
  const seenAddresses = new Set<string>();
  let nextShard = 0;
  let completedShards = 0;
  const worker = async () => {
    while (nextShard < nodeShardCount) {
      if (params.signal?.aborted) return fail('case_graph_content_discovery_aborted');
      const shard = nextShard;
      nextShard += 1;
      const nodes = await params.readNodeShard(shard, params.signal);
      if (!Array.isArray(nodes)) return fail('case_graph_content_discovery_shard_invalid');
      for (const node of nodes) {
        if (seenAddresses.has(node.address)) return fail('case_graph_content_discovery_address_duplicate');
        seenAddresses.add(node.address);
        const record = makeCaseGraphContentDiscoveryRecordFromPublicNode({
          publication: params.publication,
          node,
        });
        if (record) records.push(record);
      }
      completedShards += 1;
      params.onShardComplete?.({
        completedShards,
        totalShards: nodeShardCount,
        discoveredAssets: records.length,
      });
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(nodeShardCount, maximumConcurrentReads) },
    () => worker(),
  ));
  if (params.signal?.aborted) return fail('case_graph_content_discovery_aborted');

  return makeCaseGraphContentDiscoveryManifest({
    publication: params.publication,
    upstreamEnumerationReceiptSha256: params.upstreamEnumerationReceiptSha256,
    limitsProfile: params.limitsProfile,
    limitsApprovalReceiptSha256: params.limitsApprovalReceiptSha256,
    records,
  });
};
