import {
  CASE_GRAPH_CONTENT_DISCOVERY_POLICY,
  selectCaseGraphContentLocator,
} from './contentResearchDiscovery';
import type {
  EvidenceUniverseCompletion,
  EvidenceUniversePart,
} from './evidenceUniverseArchive';
import type {
  EvidenceUniverseNode,
  EvidenceUniverseNodeKind,
} from './evidenceUniverse';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CONTENT_DISCOVERY_UNIVERSE_INVENTORY_VERSION =
  'case-vortex-content-discovery-universe-inventory-v1' as const;

type LocatorSelection = 'canonical_url' | 'preview_url' | 'unresolved';
type KindCounts = Record<EvidenceUniverseNodeKind, number>;
type LocatorCounts = Record<LocatorSelection, number>;

export type ContentDiscoveryUniverseInventoryReceipt = {
  recordType: 'content_discovery_universe_inventory_receipt';
  schemaVersion: typeof CONTENT_DISCOVERY_UNIVERSE_INVENTORY_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    universeArchiveVersion: string;
    universeSchemaVersion: string;
    universeLayoutVersion: string;
    universeArchiveSetSha256: string;
    universeRecordCount: number;
    universePartCount: number;
  };
  policy: {
    contentDiscoveryPolicyVersion: typeof CASE_GRAPH_CONTENT_DISCOVERY_POLICY.version;
    locatorPrecedence: ['canonical_url', 'preview_url', 'unresolved'];
    unresolvedLocatorPrefix: typeof CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unresolvedLocatorPrefix;
    claimedMimeType: typeof CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unknownClaimedMimeType;
    publicationBinding: 'deferred_until_inactive_candidate_exists';
  };
  parts: Array<{
    ordinal: number;
    partNumber: number;
    kind: EvidenceUniverseNodeKind;
    archiveKey: string;
    archiveSha256: string;
    rowCount: number;
    contentRecordCount: number;
    locatorCounts: LocatorCounts;
    contentRecordSetSha256: string;
    partReceiptDigest: string;
  }>;
  accounting: {
    scannedRecordCount: number;
    scannedPartCount: number;
    contentRecordCount: number;
    nonContentSightingCount: number;
    byKind: KindCounts;
    locatorCounts: LocatorCounts;
    resolvedLocatorCount: number;
    unresolvedLocatorCount: number;
    bySource: Array<{ source: string; recordCount: number }>;
  };
  contentInventorySetSha256: string;
  limitations: string[];
  guarantees: {
    allUniversePartsReplayed: true;
    allUniverseRecordsAccounted: true;
    publicationIdCreated: 0;
    contentBytesRead: 0;
    providerCalls: 0;
    providerBytesDownloaded: 0;
    databaseReads: 0;
    databaseWrites: 0;
    storageWrites: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    claimProposalsCreated: 0;
    humanAdjudicationsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  receiptDigest: string;
};

const emptyKinds = (): KindCounts => ({
  sighting: 0,
  document: 0,
  photo: 0,
  video: 0,
});
const emptyLocators = (): LocatorCounts => ({
  canonical_url: 0,
  preview_url: 0,
  unresolved: 0,
});
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value as string;
};

const inventoryIdentity = (node: EvidenceUniverseNode) => {
  const nodeDigest = relationshipInputSha256(node);
  const locator = selectCaseGraphContentLocator(node);
  const sourceLocatorDigest = relationshipInputSha256({
    policy: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.version,
    selected: locator.selected,
    canonicalUrl: node.canonicalUrl,
    previewUrl: node.previewUrl,
  });
  const sourceLineageDigest = relationshipInputSha256({
    policy: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.version,
    address: node.address,
    nodeDigest,
    source: node.source,
    sourceRecordId: node.sourceRecordId,
    updatedAt: node.updatedAt,
  });
  const identity = {
    address: node.address,
    nodeDigest,
    sourceAssetKey: locator.sourceAssetKey,
    mediaKind: node.kind === 'photo' ? 'image' : node.kind,
    claimedMimeType: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unknownClaimedMimeType,
    sourceLocatorDigest,
    sourceLineageDigest,
  };
  const inventoryId =
    `content-inventory:${relationshipInputSha256(identity)}`;
  return {
    inventoryId,
    inventoryDigest: relationshipInputSha256({ inventoryId, ...identity }),
    locatorSelection: locator.selected,
  };
};

const completionBinding = (completion: EvidenceUniverseCompletion) => ({
  corpusVersion: completion.corpusVersion,
  snapshotId: completion.expected.snapshotId,
  universeArchiveVersion: completion.archiveVersion,
  universeSchemaVersion: completion.schemaVersion,
  universeLayoutVersion: completion.layoutVersion,
  universeArchiveSetSha256: completion.archiveSetSha256,
  universeRecordCount: completion.expected.total,
  universePartCount: completion.parts.length,
});

export const createContentDiscoveryUniverseInventoryScan = (params: {
  completion: EvidenceUniverseCompletion;
  builtAt: string;
}) => {
  const builtAt = timestamp(
    params.builtAt,
    'content_discovery_inventory_built_at_invalid',
  );
  const expectedParts = params.completion.parts;
  if (!expectedParts.length
    || params.completion.expected.total < 1
    || expectedParts.reduce((sum, part) => sum + part.rowCount, 0)
      !== params.completion.expected.total) {
    invalid('content_discovery_inventory_completion_invalid');
  }
  const seenAddresses = new Set<string>();
  const byKind = emptyKinds();
  const locatorCounts = emptyLocators();
  const bySource = new Map<string, number>();
  const parts: ContentDiscoveryUniverseInventoryReceipt['parts'] = [];
  let scannedRecordCount = 0;
  let contentRecordCount = 0;

  return {
    addPart(part: EvidenceUniversePart, nodes: readonly EvidenceUniverseNode[]) {
      const ordinal = parts.length;
      const expected = expectedParts[ordinal];
      if (!expected
        || canonicalizeRelationshipInput(part)
          !== canonicalizeRelationshipInput(expected)
        || nodes.length !== part.rowCount
        || nodes.some((node) => node.kind !== part.kind)) {
        invalid('content_discovery_inventory_part_invalid');
      }
      const partLocators = emptyLocators();
      const records: Array<{ inventoryId: string; inventoryDigest: string }> = [];
      for (const node of nodes) {
        if (seenAddresses.has(node.address)) {
          invalid('content_discovery_inventory_address_duplicate');
        }
        seenAddresses.add(node.address);
        scannedRecordCount += 1;
        byKind[node.kind] += 1;
        if (node.kind === 'sighting') continue;
        const identity = inventoryIdentity(node);
        records.push({
          inventoryId: identity.inventoryId,
          inventoryDigest: identity.inventoryDigest,
        });
        partLocators[identity.locatorSelection] += 1;
        locatorCounts[identity.locatorSelection] += 1;
        contentRecordCount += 1;
        bySource.set(node.source, (bySource.get(node.source) || 0) + 1);
      }
      const partCore = {
        ordinal,
        partNumber: part.partNumber,
        kind: part.kind,
        archiveKey: part.archiveKey,
        archiveSha256: part.sha256,
        rowCount: part.rowCount,
        contentRecordCount: records.length,
        locatorCounts: partLocators,
        contentRecordSetSha256: relationshipInputSha256(records),
      };
      parts.push({
        ...partCore,
        partReceiptDigest: relationshipInputSha256(partCore),
      });
    },
    finalize(): ContentDiscoveryUniverseInventoryReceipt {
      if (parts.length !== expectedParts.length
        || scannedRecordCount !== params.completion.expected.total
        || seenAddresses.size !== scannedRecordCount
        || Object.entries(byKind).some(([kind, count]) => (
          count !== params.completion.expected.byKind[kind as EvidenceUniverseNodeKind]
        ))) {
        invalid('content_discovery_inventory_accounting_invalid');
      }
      const expectedContentCount = byKind.document + byKind.photo + byKind.video;
      if (contentRecordCount !== expectedContentCount
        || Object.values(locatorCounts).reduce((sum, count) => sum + count, 0)
          !== contentRecordCount) {
        invalid('content_discovery_inventory_content_accounting_invalid');
      }
      const contentInventorySetSha256 = relationshipInputSha256(parts.map(
        ({ ordinal, contentRecordSetSha256 }) => ({
          ordinal,
          contentRecordSetSha256,
        }),
      ));
      const body: Omit<ContentDiscoveryUniverseInventoryReceipt, 'receiptDigest'> = {
        recordType: 'content_discovery_universe_inventory_receipt',
        schemaVersion: CONTENT_DISCOVERY_UNIVERSE_INVENTORY_VERSION,
        builtAt,
        binding: completionBinding(params.completion),
        policy: {
          contentDiscoveryPolicyVersion: CASE_GRAPH_CONTENT_DISCOVERY_POLICY.version,
          locatorPrecedence: ['canonical_url', 'preview_url', 'unresolved'],
          unresolvedLocatorPrefix:
            CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unresolvedLocatorPrefix,
          claimedMimeType:
            CASE_GRAPH_CONTENT_DISCOVERY_POLICY.unknownClaimedMimeType,
          publicationBinding: 'deferred_until_inactive_candidate_exists',
        },
        parts,
        accounting: {
          scannedRecordCount,
          scannedPartCount: parts.length,
          contentRecordCount,
          nonContentSightingCount: byKind.sighting,
          byKind,
          locatorCounts,
          resolvedLocatorCount:
            locatorCounts.canonical_url + locatorCounts.preview_url,
          unresolvedLocatorCount: locatorCounts.unresolved,
          bySource: [...bySource]
            .sort(([left], [right]) => lexical(left, right))
            .map(([source, recordCount]) => ({ source, recordCount })),
        },
        contentInventorySetSha256,
        limitations: [
          'This receipt enumerates candidate content assets from the immutable universe but does not read or extract any asset bytes.',
          'An unresolved locator remains fully accounted but cannot be captured until governed source resolution exists.',
          'Publication identity, limits approval, byte capture, extraction, content indexing and claim segmentation remain separate fail-closed gates.',
          'Metadata titles and summaries are not substituted for page, image, audio or video content.',
        ],
        guarantees: {
          allUniversePartsReplayed: true,
          allUniverseRecordsAccounted: true,
          publicationIdCreated: 0,
          contentBytesRead: 0,
          providerCalls: 0,
          providerBytesDownloaded: 0,
          databaseReads: 0,
          databaseWrites: 0,
          storageWrites: 0,
          LunaCalls: 0,
          claimSegmentsCreated: 0,
          claimProposalsCreated: 0,
          humanAdjudicationsCreated: 0,
          publicationMutations: 0,
          deployments: 0,
        },
      };
      return { ...body, receiptDigest: relationshipInputSha256(body) };
    },
  };
};

export const verifyContentDiscoveryUniverseInventoryReceipt = (
  value: unknown,
): ContentDiscoveryUniverseInventoryReceipt => {
  if (!isObject(value)
    || value.recordType !== 'content_discovery_universe_inventory_receipt'
    || value.schemaVersion !== CONTENT_DISCOVERY_UNIVERSE_INVENTORY_VERSION
    || typeof value.receiptDigest !== 'string') {
    invalid('content_discovery_inventory_receipt_invalid');
  }
  const receipt = value as Record<string, unknown>;
  const { receiptDigest, ...body } = receipt;
  if (relationshipInputSha256(body) !== receiptDigest) {
    invalid('content_discovery_inventory_receipt_digest_mismatch');
  }
  return receipt as unknown as ContentDiscoveryUniverseInventoryReceipt;
};
