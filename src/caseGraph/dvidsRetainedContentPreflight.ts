import type {
  EvidenceUniverseCompletion,
} from './evidenceUniverseArchive';
import type {
  EvidenceUniverseNode,
} from './evidenceUniverse';
import type {
  RetainedContentAvailabilityReceipt,
  RetainedContentAvailabilityRoute,
} from './retainedContentAvailabilityInventory';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const DVIDS_RETAINED_CONTENT_PREFLIGHT_VERSION =
  'case-vortex-dvids-retained-content-preflight-v1' as const;

export type DvidsRetainedRightsRow = {
  id: string;
  provider: string;
  sourceId: string;
  canonicalUrl: string;
  mediaKey: string;
  storagePolicy: string;
  playbackPolicy: string;
  rightsStatus: string;
  updatedAt: string;
};

export type DvidsRetainedRightsRegistry = {
  canonicalSource: string;
  legalStatus: string;
  licenseType: string;
  allowedContentModes: string[];
  evidenceUrl: string;
  reviewedAt: string;
};

export type DvidsRetainedRightsSnapshot = {
  inspectedAt: string;
  sourceMvccSnapshot: string;
  transaction: { isolation: 'repeatable read'; readOnly: true };
  registry: DvidsRetainedRightsRegistry;
  rows: DvidsRetainedRightsRow[];
};

export type DvidsRetainedObjectHead = {
  key: string;
  contentLength: number;
  contentType: string | null;
  etag: string;
};

export type DvidsRetainedContentPreflightReceipt = {
  recordType: 'dvids_retained_content_preflight_receipt';
  schemaVersion: typeof DVIDS_RETAINED_CONTENT_PREFLIGHT_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    universeArchiveSetSha256: string;
    routeReceiptDigest: string;
    routeSetSha256: string;
    routesFileSha256: string;
    retainedRouteCount: number;
  };
  rightsSnapshot: {
    inspectedAt: string;
    sourceMvccSnapshot: string;
    transaction: { isolation: 'repeatable read'; readOnly: true };
    registry: DvidsRetainedRightsRegistry & { registryDigest: string };
    rowSetSha256: string;
  };
  admitted: Array<{
    address: string;
    nodeDigest: string;
    routeDigest: string;
    archiveKey: string;
    universeUpdatedAt: string;
    databaseUpdatedAt: string;
    rightsRowDigest: string;
    objectHead: {
      contentLength: number;
      contentType: string | null;
      etag: string;
      headDigest: string;
    };
    admissionDigest: string;
  }>;
  accounting: {
    contentRouteCount: number;
    retainedRouteCount: number;
    externalOnlyRouteCount: number;
    rightsApprovedRetainedCount: number;
    rightsReviewRequiredRetainedCount: number;
    admittedObjectCount: number;
    admittedTotalBytes: number;
    admittedMaximumObjectBytes: number;
    admittedOver64MiBCount: number;
    admittedOver256MiBCount: number;
    admittedContentTypes: Array<{ contentType: string; objectCount: number }>;
  };
  admittedSetSha256: string;
  limitations: string[];
  guarantees: {
    exactUniverseNodeBinding: true;
    exactRouteBinding: true;
    exactDatabaseRowAndRegistryBinding: true;
    rightsAdmissionLimitedToDvidsPublicDomainRows: true;
    objectMetadataOnly: true;
    contentBytesRead: 0;
    objectChecksumProven: false;
    structuralSafetyProven: false;
    extractionApproved: false;
    providerCalls: 0;
    providerBytesDownloaded: 0;
    databaseWrites: 0;
    storageWrites: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  receiptDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const timestamp = (value: string, code: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
};
const exactTimestamp = (value: string, code: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(code);
  }
  return value;
};
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const mvcc = (value: string) => {
  if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/u.test(value)) {
    fail('dvids_retained_preflight_mvcc_invalid');
  }
  return value;
};

const expectedRegistry = (registry: DvidsRetainedRightsRegistry) => {
  const allowedContentModes = [...registry.allowedContentModes].sort(lexical);
  if (registry.canonicalSource !== 'DVIDS_MEDIA'
    || registry.legalStatus !== 'approved'
    || registry.licenseType !== 'public_domain_government'
    || canonicalizeRelationshipInput(allowedContentModes)
      !== canonicalizeRelationshipInput(['full_ingest'])
    || registry.evidenceUrl !== 'https://api.dvidshub.net/docs/copyright'
    || exactTimestamp(
      timestamp(registry.reviewedAt, 'dvids_retained_preflight_registry_invalid'),
      'dvids_retained_preflight_registry_invalid',
    ) !== timestamp(
      registry.reviewedAt,
      'dvids_retained_preflight_registry_invalid',
    )) {
    fail('dvids_retained_preflight_registry_not_approved');
  }
  return { ...registry, allowedContentModes };
};

export const buildDvidsRetainedContentPreflight = (params: {
  builtAt: string;
  routeReceipt: RetainedContentAvailabilityReceipt;
  routes: readonly RetainedContentAvailabilityRoute[];
  completion: EvidenceUniverseCompletion;
  universeNodes: readonly EvidenceUniverseNode[];
  rightsSnapshot: DvidsRetainedRightsSnapshot;
  objectHeads: readonly DvidsRetainedObjectHead[];
}): DvidsRetainedContentPreflightReceipt => {
  const builtAt = exactTimestamp(
    params.builtAt,
    'dvids_retained_preflight_built_at_invalid',
  );
  if (params.completion.corpusVersion !== params.routeReceipt.binding.corpusVersion
    || params.completion.expected.snapshotId
      !== params.routeReceipt.binding.snapshotId
    || params.completion.archiveSetSha256
      !== params.routeReceipt.binding.universeArchiveSetSha256
    || params.routes.length !== params.routeReceipt.accounting.contentRecordCount
    || relationshipInputSha256(params.routes.map(
      ({ address, routeDigest }) => ({ address, routeDigest }),
    )) !== params.routeReceipt.routeSetSha256) {
    fail('dvids_retained_preflight_binding_invalid');
  }
  const candidates = params.routes.filter((route) => (
    route.availability === 'retained_archive_object'
    && route.kind === 'video'
    && route.source === 'dvids-uap-related'
  )).sort((left, right) => lexical(left.address, right.address));
  if (!candidates.length) fail('dvids_retained_preflight_candidates_missing');
  const candidateAddresses = new Set(candidates.map(({ address }) => address));
  const nodes = new Map<string, EvidenceUniverseNode>();
  for (const node of params.universeNodes) {
    if (!candidateAddresses.has(node.address) || nodes.has(node.address)) {
      fail('dvids_retained_preflight_universe_nodes_invalid');
    }
    nodes.set(node.address, node);
  }
  const rows = new Map<string, DvidsRetainedRightsRow>();
  for (const row of params.rightsSnapshot.rows) {
    const address = `video:${row.id.toLowerCase()}`;
    if (!candidateAddresses.has(address) || rows.has(address)) {
      fail('dvids_retained_preflight_rights_rows_invalid');
    }
    rows.set(address, row);
  }
  const heads = new Map<string, DvidsRetainedObjectHead>();
  for (const head of params.objectHeads) {
    if (!head.key || heads.has(head.key)
      || !Number.isSafeInteger(head.contentLength) || head.contentLength < 1
      || (head.contentType !== null && (
        typeof head.contentType !== 'string'
        || !head.contentType
        || head.contentType.length > 255
      ))
      || typeof head.etag !== 'string'
      || !head.etag
      || head.etag.length > 1_024
      || /[\r\n]/u.test(head.etag)) {
      fail('dvids_retained_preflight_object_heads_invalid');
    }
    heads.set(head.key, head);
  }
  if (nodes.size !== candidates.length
    || rows.size !== candidates.length
    || heads.size !== candidates.length) {
    fail('dvids_retained_preflight_candidate_accounting_invalid');
  }
  const inspectedAt = exactTimestamp(
    timestamp(
      params.rightsSnapshot.inspectedAt,
      'dvids_retained_preflight_inspected_at_invalid',
    ),
    'dvids_retained_preflight_inspected_at_invalid',
  );
  if (params.rightsSnapshot.transaction.isolation !== 'repeatable read'
    || params.rightsSnapshot.transaction.readOnly !== true) {
    fail('dvids_retained_preflight_transaction_invalid');
  }
  const registry = expectedRegistry(params.rightsSnapshot.registry);
  const registryDigest = relationshipInputSha256(registry);
  const admitted = candidates.map((route) => {
    const node = nodes.get(route.address)!;
    const row = rows.get(route.address)!;
    const archiveKey = route.archiveKey!;
    const head = heads.get(archiveKey)
      ?? fail('dvids_retained_preflight_row_not_approved');
    if (node.kind !== 'video'
      || node.source !== 'dvids-uap-related'
      || relationshipInputSha256(node) !== route.nodeDigest
      || node.canonicalUrl !== route.locatorUrl
      || route.locatorSelection !== 'canonical_url'
      || row.id.toLowerCase() !== route.address.slice('video:'.length)
      || row.provider !== 'dvids'
      || row.sourceId !== 'dvids-uap-related'
      || row.canonicalUrl !== route.locatorUrl
      || row.mediaKey !== archiveKey
      || row.storagePolicy !== 'archivable'
      || row.playbackPolicy !== 'self_hosted'
      || row.rightsStatus !== 'public_domain') {
      fail('dvids_retained_preflight_row_not_approved');
    }
    const databaseUpdatedAt = timestamp(
      row.updatedAt,
      'dvids_retained_preflight_row_invalid',
    );
    const normalizedRow = {
      ...row,
      id: row.id.toLowerCase(),
      updatedAt: databaseUpdatedAt,
    };
    const rightsRowDigest = relationshipInputSha256({
      ...normalizedRow,
      registryDigest,
    });
    const headCore = {
      contentLength: head.contentLength,
      contentType: head.contentType,
      etag: head.etag,
    };
    const objectHead = {
      ...headCore,
      headDigest: relationshipInputSha256({ archiveKey, ...headCore }),
    };
    const core = {
      address: route.address,
      nodeDigest: route.nodeDigest,
      routeDigest: route.routeDigest,
      archiveKey,
      universeUpdatedAt: node.updatedAt,
      databaseUpdatedAt,
      rightsRowDigest,
      objectHead,
    };
    return { ...core, admissionDigest: relationshipInputSha256(core) };
  });
  const admittedTotalBytes = admitted.reduce(
    (sum, item) => sum + item.objectHead.contentLength,
    0,
  );
  if (!Number.isSafeInteger(admittedTotalBytes)) {
    fail('dvids_retained_preflight_byte_accounting_invalid');
  }
  const contentTypes = new Map<string, number>();
  for (const item of admitted) {
    const key = item.objectHead.contentType ?? '(missing)';
    contentTypes.set(key, (contentTypes.get(key) || 0) + 1);
  }
  const retainedRouteCount =
    params.routeReceipt.accounting.retainedArchiveObjectCount;
  const externalOnlyRouteCount =
    params.routeReceipt.accounting.contentRecordCount - retainedRouteCount;
  const rowSetSha256 = relationshipInputSha256(
    [...rows.entries()].sort(([left], [right]) => lexical(left, right)).map(
      ([address, row]) => ({ address, row }),
    ),
  );
  const body: Omit<DvidsRetainedContentPreflightReceipt, 'receiptDigest'> = {
    recordType: 'dvids_retained_content_preflight_receipt',
    schemaVersion: DVIDS_RETAINED_CONTENT_PREFLIGHT_VERSION,
    builtAt,
    binding: {
      corpusVersion: params.completion.corpusVersion,
      snapshotId: params.completion.expected.snapshotId,
      universeArchiveSetSha256: params.completion.archiveSetSha256,
      routeReceiptDigest: params.routeReceipt.receiptDigest,
      routeSetSha256: params.routeReceipt.routeSetSha256,
      routesFileSha256: params.routeReceipt.routesFileSha256,
      retainedRouteCount,
    },
    rightsSnapshot: {
      inspectedAt,
      sourceMvccSnapshot: mvcc(params.rightsSnapshot.sourceMvccSnapshot),
      transaction: { isolation: 'repeatable read', readOnly: true },
      registry: { ...registry, registryDigest },
      rowSetSha256,
    },
    admitted,
    accounting: {
      contentRouteCount: params.routeReceipt.accounting.contentRecordCount,
      retainedRouteCount,
      externalOnlyRouteCount,
      rightsApprovedRetainedCount: admitted.length,
      rightsReviewRequiredRetainedCount: retainedRouteCount - admitted.length,
      admittedObjectCount: admitted.length,
      admittedTotalBytes,
      admittedMaximumObjectBytes: Math.max(
        ...admitted.map((item) => item.objectHead.contentLength),
      ),
      admittedOver64MiBCount: admitted.filter(
        (item) => item.objectHead.contentLength > 64 * 1024 * 1024,
      ).length,
      admittedOver256MiBCount: admitted.filter(
        (item) => item.objectHead.contentLength > 256 * 1024 * 1024,
      ).length,
      admittedContentTypes: [...contentTypes]
        .sort(([left], [right]) => lexical(left, right))
        .map(([contentType, objectCount]) => ({ contentType, objectCount })),
    },
    admittedSetSha256: relationshipInputSha256(admitted.map(
      ({ address, admissionDigest }) => ({ address, admissionDigest }),
    )),
    limitations: [
      'Rights admission is limited to exact DVIDS rows whose immutable-universe node, retained route, live row policy and approved registry entry all agree.',
      'The immutable universe cursor timestamp and live source-row update timestamp are retained separately because media snapshot indexing can advance without mutating the source row.',
      'The remaining retained objects receive no rights approval from this receipt and remain pending per-item or source-specific review.',
      'HEAD metadata proves object existence and declared size/type only; ETag is retained as opaque identity metadata and is not treated as SHA-256.',
      'No object body, byte checksum, structural safety, duration, extraction coverage or claim content is proven.',
      'A separately approved limits profile is required before bounded content reads or extraction.',
    ],
    guarantees: {
      exactUniverseNodeBinding: true,
      exactRouteBinding: true,
      exactDatabaseRowAndRegistryBinding: true,
      rightsAdmissionLimitedToDvidsPublicDomainRows: true,
      objectMetadataOnly: true,
      contentBytesRead: 0,
      objectChecksumProven: false,
      structuralSafetyProven: false,
      extractionApproved: false,
      providerCalls: 0,
      providerBytesDownloaded: 0,
      databaseWrites: 0,
      storageWrites: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, receiptDigest: relationshipInputSha256(body) };
};

export const verifyDvidsRetainedContentPreflightReceipt = (
  value: unknown,
): DvidsRetainedContentPreflightReceipt => {
  if (!isObject(value)
    || value.recordType !== 'dvids_retained_content_preflight_receipt'
    || value.schemaVersion !== DVIDS_RETAINED_CONTENT_PREFLIGHT_VERSION
    || typeof value.receiptDigest !== 'string') {
    fail('dvids_retained_preflight_receipt_invalid');
  }
  const receipt = value as Record<string, unknown>;
  const { receiptDigest, ...body } = receipt;
  if (relationshipInputSha256(body) !== receiptDigest) {
    fail('dvids_retained_preflight_receipt_digest_mismatch');
  }
  return receipt as unknown as DvidsRetainedContentPreflightReceipt;
};
