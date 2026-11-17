import { createHash } from 'node:crypto';

import {
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

export const RETAINED_CONTENT_AVAILABILITY_VERSION =
  'case-vortex-retained-content-availability-v1' as const;

export const RETAINED_CONTENT_AVAILABILITY_STATUSES = [
  'retained_archive_object',
  'archive_locator_missing',
  'external_retrieval_required',
  'unresolved_locator',
] as const;

export type RetainedContentAvailabilityStatus =
  typeof RETAINED_CONTENT_AVAILABILITY_STATUSES[number];

type StatusCounts = Record<RetainedContentAvailabilityStatus, number>;
type ContentKind = Exclude<EvidenceUniverseNodeKind, 'sighting'>;

export type RetainedContentAvailabilityRoute = {
  recordType: 'retained_content_availability_route';
  schemaVersion: typeof RETAINED_CONTENT_AVAILABILITY_VERSION;
  ordinal: number;
  address: string;
  nodeDigest: string;
  kind: ContentKind;
  source: string;
  sourceRecordId: string | null;
  locatorSelection: 'canonical_url' | 'preview_url' | 'unresolved';
  locatorUrl: string | null;
  locatorHost: string | null;
  availability: RetainedContentAvailabilityStatus;
  archiveKey: string | null;
  routeDigest: string;
};

export type RetainedContentAvailabilityReceipt = {
  recordType: 'retained_content_availability_receipt';
  schemaVersion: typeof RETAINED_CONTENT_AVAILABILITY_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    universeArchiveSetSha256: string;
    universeRecordCount: number;
    universePartCount: number;
    contentInventoryReceiptDigest: string;
    contentInventorySetSha256: string;
    contentRecordCount: number;
  };
  retainedArchive: {
    publicHost: string;
    listedPrefixes: string[];
    listedObjectCount: number;
    listedObjectKeySetSha256: string;
  };
  parts: Array<{
    ordinal: number;
    kind: EvidenceUniverseNodeKind;
    archiveKey: string;
    archiveSha256: string;
    rowCount: number;
    contentRecordCount: number;
    statusCounts: StatusCounts;
    routeSetSha256: string;
    partReceiptDigest: string;
  }>;
  accounting: {
    scannedRecordCount: number;
    scannedPartCount: number;
    contentRecordCount: number;
    statusCounts: StatusCounts;
    retainedArchiveObjectCount: number;
    externalOrMissingCount: number;
    byKind: Record<ContentKind, StatusCounts>;
    bySource: Array<{
      source: string;
      contentRecordCount: number;
      statusCounts: StatusCounts;
    }>;
    byHost: Array<{
      host: string;
      contentRecordCount: number;
      statusCounts: StatusCounts;
    }>;
  };
  routesFileSha256: string;
  routeSetSha256: string;
  limitations: string[];
  guarantees: {
    allUniversePartsReplayed: true;
    allUniverseRecordsAccounted: true;
    retainedClassificationRequiresExactHostAndObjectKey: true;
    contentBytesRead: 0;
    objectIntegrityProven: false;
    rightsApprovalCreated: 0;
    providerCalls: 0;
    providerBytesDownloaded: 0;
    databaseReads: 0;
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
const emptyStatuses = (): StatusCounts => ({
  retained_archive_object: 0,
  archive_locator_missing: 0,
  external_retrieval_required: 0,
  unresolved_locator: 0,
});
const emptyKinds = (): Record<ContentKind, StatusCounts> => ({
  document: emptyStatuses(),
  photo: emptyStatuses(),
  video: emptyStatuses(),
});
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const exactTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('retained_content_availability_timestamp_invalid');
  }
  return value;
};
const exactHost = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(normalized)
    || normalized.includes('..')) {
    fail('retained_content_availability_host_invalid');
  }
  return normalized;
};
const exactArchiveKey = (url: URL) => {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || url.search || !url.pathname.startsWith('/')) return null;
  const rawSegments = url.pathname.slice(1).split('/');
  if (!rawSegments.length || rawSegments.some((segment) => !segment)) return null;
  const decoded: string[] = [];
  try {
    for (const segment of rawSegments) {
      const value = decodeURIComponent(segment);
      if (!value || value.includes('/') || value.includes('\\')
        || value.includes('\u0000')) return null;
      decoded.push(value);
    }
  } catch {
    return null;
  }
  const key = decoded.join('/');
  return Buffer.byteLength(key, 'utf8') <= 1_024 ? key : null;
};

export const retainedArchiveCandidateKey = (
  node: Pick<EvidenceUniverseNode, 'address' | 'canonicalUrl' | 'previewUrl'>,
  publicHost: string,
) => {
  const locator = selectCaseGraphContentLocator(node);
  if (locator.selected === 'unresolved') return null;
  const rawUrl = locator.sourceAssetKey.slice(
    locator.selected === 'canonical_url'
      ? 'canonical-url:'.length
      : 'preview-url:'.length,
  );
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== exactHost(publicHost)) return null;
  return exactArchiveKey(url);
};

const routeFor = (params: {
  node: EvidenceUniverseNode & { kind: ContentKind };
  ordinal: number;
  publicHost: string;
  archiveKeys: ReadonlySet<string>;
}): RetainedContentAvailabilityRoute => {
  const locator = selectCaseGraphContentLocator(params.node);
  let locatorUrl: string | null = null;
  let locatorHost: string | null = null;
  let availability: RetainedContentAvailabilityStatus = 'unresolved_locator';
  let archiveKey: string | null = null;
  if (locator.selected !== 'unresolved') {
    locatorUrl = locator.sourceAssetKey.slice(
      locator.selected === 'canonical_url'
        ? 'canonical-url:'.length
        : 'preview-url:'.length,
    );
    try {
      const parsed = new URL(locatorUrl);
      locatorHost = parsed.hostname.toLowerCase();
      if (locatorHost === params.publicHost) {
        archiveKey = exactArchiveKey(parsed);
        availability = archiveKey && params.archiveKeys.has(archiveKey)
          ? 'retained_archive_object'
          : 'archive_locator_missing';
      } else {
        availability = 'external_retrieval_required';
      }
    } catch {
      availability = 'external_retrieval_required';
    }
  }
  const core = {
    recordType: 'retained_content_availability_route' as const,
    schemaVersion: RETAINED_CONTENT_AVAILABILITY_VERSION,
    ordinal: params.ordinal,
    address: params.node.address,
    nodeDigest: relationshipInputSha256(params.node),
    kind: params.node.kind,
    source: params.node.source,
    sourceRecordId: params.node.sourceRecordId,
    locatorSelection: locator.selected,
    locatorUrl,
    locatorHost,
    availability,
    archiveKey,
  };
  return { ...core, routeDigest: relationshipInputSha256(core) };
};

const routesBytes = (routes: readonly RetainedContentAvailabilityRoute[]) => (
  Buffer.from(`${routes.map((route) => canonicalizeRelationshipInput(route)).join('\n')}\n`)
);

export const createRetainedContentAvailabilityScan = (params: {
  completion: EvidenceUniverseCompletion;
  builtAt: string;
  publicArchiveHost: string;
  listedPrefixes: readonly string[];
  listedArchiveKeys: readonly string[];
  contentInventoryReceiptDigest: string;
  contentInventorySetSha256: string;
  contentRecordCount: number;
}) => {
  const builtAt = exactTimestamp(params.builtAt);
  const publicHost = exactHost(params.publicArchiveHost);
  const expectedParts = params.completion.parts;
  if (!expectedParts.length
    || expectedParts.reduce((sum, part) => sum + part.rowCount, 0)
      !== params.completion.expected.total
    || params.contentRecordCount
      !== params.completion.expected.byKind.document
        + params.completion.expected.byKind.photo
        + params.completion.expected.byKind.video
    || !/^[a-f0-9]{64}$/u.test(params.contentInventoryReceiptDigest)
    || !/^[a-f0-9]{64}$/u.test(params.contentInventorySetSha256)) {
    fail('retained_content_availability_input_invalid');
  }
  const listedPrefixes = [...params.listedPrefixes].sort(lexical);
  const archiveKeys = [...params.listedArchiveKeys].sort(lexical);
  if (new Set(listedPrefixes).size !== listedPrefixes.length
    || listedPrefixes.some((prefix) => !prefix || prefix.includes('/') || prefix.includes('\u0000'))
    || new Set(archiveKeys).size !== archiveKeys.length
    || archiveKeys.some((key) => !listedPrefixes.some(
      (prefix) => key === prefix || key.startsWith(`${prefix}/`),
    ))) {
    fail('retained_content_availability_archive_listing_invalid');
  }
  const archiveKeySet = new Set(archiveKeys);
  const seenAddresses = new Set<string>();
  const routes: RetainedContentAvailabilityRoute[] = [];
  const parts: RetainedContentAvailabilityReceipt['parts'] = [];
  const statusCounts = emptyStatuses();
  const byKind = emptyKinds();
  const bySource = new Map<string, { count: number; statuses: StatusCounts }>();
  const byHost = new Map<string, { count: number; statuses: StatusCounts }>();
  let scannedRecordCount = 0;

  return {
    addPart(part: EvidenceUniversePart, nodes: readonly EvidenceUniverseNode[]) {
      const ordinal = parts.length;
      const expected = expectedParts[ordinal];
      if (!expected
        || canonicalizeRelationshipInput(part)
          !== canonicalizeRelationshipInput(expected)
        || nodes.length !== part.rowCount
        || nodes.some((node) => node.kind !== part.kind)) {
        fail('retained_content_availability_part_invalid');
      }
      const partStatuses = emptyStatuses();
      const partRoutes: RetainedContentAvailabilityRoute[] = [];
      for (const node of nodes) {
        if (seenAddresses.has(node.address)) {
          fail('retained_content_availability_address_duplicate');
        }
        seenAddresses.add(node.address);
        scannedRecordCount += 1;
        if (node.kind === 'sighting') continue;
        const route = routeFor({
          node: node as EvidenceUniverseNode & { kind: ContentKind },
          ordinal: routes.length,
          publicHost,
          archiveKeys: archiveKeySet,
        });
        routes.push(route);
        partRoutes.push(route);
        statusCounts[route.availability] += 1;
        partStatuses[route.availability] += 1;
        byKind[route.kind][route.availability] += 1;
        const source = bySource.get(route.source)
          ?? { count: 0, statuses: emptyStatuses() };
        source.count += 1;
        source.statuses[route.availability] += 1;
        bySource.set(route.source, source);
        const hostKey = route.locatorHost ?? '(unresolved)';
        const host = byHost.get(hostKey)
          ?? { count: 0, statuses: emptyStatuses() };
        host.count += 1;
        host.statuses[route.availability] += 1;
        byHost.set(hostKey, host);
      }
      const partCore = {
        ordinal,
        kind: part.kind,
        archiveKey: part.archiveKey,
        archiveSha256: part.sha256,
        rowCount: part.rowCount,
        contentRecordCount: partRoutes.length,
        statusCounts: partStatuses,
        routeSetSha256: relationshipInputSha256(partRoutes.map(
          ({ address, routeDigest }) => ({ address, routeDigest }),
        )),
      };
      parts.push({
        ...partCore,
        partReceiptDigest: relationshipInputSha256(partCore),
      });
    },
    finalize(): {
      routes: RetainedContentAvailabilityRoute[];
      routesBody: Buffer;
      receipt: RetainedContentAvailabilityReceipt;
    } {
      if (parts.length !== expectedParts.length
        || scannedRecordCount !== params.completion.expected.total
        || routes.length !== params.contentRecordCount
        || seenAddresses.size !== scannedRecordCount
        || Object.values(statusCounts).reduce((sum, value) => sum + value, 0)
          !== routes.length) {
        fail('retained_content_availability_accounting_invalid');
      }
      const bodyBytes = routesBytes(routes);
      const routesFileSha256 = createHash('sha256').update(bodyBytes).digest('hex');
      const routeSetSha256 = relationshipInputSha256(routes.map(
        ({ address, routeDigest }) => ({ address, routeDigest }),
      ));
      const body: Omit<RetainedContentAvailabilityReceipt, 'receiptDigest'> = {
        recordType: 'retained_content_availability_receipt',
        schemaVersion: RETAINED_CONTENT_AVAILABILITY_VERSION,
        builtAt,
        binding: {
          corpusVersion: params.completion.corpusVersion,
          snapshotId: params.completion.expected.snapshotId,
          universeArchiveSetSha256: params.completion.archiveSetSha256,
          universeRecordCount: params.completion.expected.total,
          universePartCount: expectedParts.length,
          contentInventoryReceiptDigest: params.contentInventoryReceiptDigest,
          contentInventorySetSha256: params.contentInventorySetSha256,
          contentRecordCount: params.contentRecordCount,
        },
        retainedArchive: {
          publicHost,
          listedPrefixes,
          listedObjectCount: archiveKeys.length,
          listedObjectKeySetSha256: relationshipInputSha256(archiveKeys),
        },
        parts,
        accounting: {
          scannedRecordCount,
          scannedPartCount: parts.length,
          contentRecordCount: routes.length,
          statusCounts,
          retainedArchiveObjectCount: statusCounts.retained_archive_object,
          externalOrMissingCount:
            routes.length - statusCounts.retained_archive_object,
          byKind,
          bySource: [...bySource]
            .sort(([left], [right]) => lexical(left, right))
            .map(([source, value]) => ({
              source,
              contentRecordCount: value.count,
              statusCounts: value.statuses,
            })),
          byHost: [...byHost]
            .sort(([left], [right]) => lexical(left, right))
            .map(([host, value]) => ({
              host,
              contentRecordCount: value.count,
              statusCounts: value.statuses,
            })),
        },
        routesFileSha256,
        routeSetSha256,
        limitations: [
          'A retained route proves only that the exact public-host URL path exists as an object key in the configured archive listing.',
          'Object bytes, byte length, MIME type, checksum, structural safety and extractability are not inspected by this receipt.',
          'Existing storage does not itself establish publication rights; rights review remains a separate fail-closed gate.',
          'External-only and missing routes require a separately approved acquisition or correction before content extraction.',
          'Publication identity, capture limits, extraction, indexing, claim segmentation and human review remain separate gates.',
        ],
        guarantees: {
          allUniversePartsReplayed: true,
          allUniverseRecordsAccounted: true,
          retainedClassificationRequiresExactHostAndObjectKey: true,
          contentBytesRead: 0,
          objectIntegrityProven: false,
          rightsApprovalCreated: 0,
          providerCalls: 0,
          providerBytesDownloaded: 0,
          databaseReads: 0,
          databaseWrites: 0,
          storageWrites: 0,
          LunaCalls: 0,
          claimSegmentsCreated: 0,
          publicationMutations: 0,
          deployments: 0,
        },
      };
      return {
        routes,
        routesBody: bodyBytes,
        receipt: { ...body, receiptDigest: relationshipInputSha256(body) },
      };
    },
  };
};

export const verifyRetainedContentAvailabilityReceipt = (params: {
  value: unknown;
  routesBody: Buffer;
}): RetainedContentAvailabilityReceipt => {
  if (!isObject(params.value)
    || params.value.recordType !== 'retained_content_availability_receipt'
    || params.value.schemaVersion !== RETAINED_CONTENT_AVAILABILITY_VERSION
    || typeof params.value.receiptDigest !== 'string'
    || typeof params.value.routesFileSha256 !== 'string') {
    fail('retained_content_availability_receipt_invalid');
  }
  const receipt = params.value as Record<string, unknown>;
  const { receiptDigest, ...body } = receipt;
  if (relationshipInputSha256(body) !== receiptDigest) {
    fail('retained_content_availability_receipt_digest_mismatch');
  }
  const fileDigest = createHash('sha256').update(params.routesBody).digest('hex');
  if (fileDigest !== receipt.routesFileSha256) {
    fail('retained_content_availability_routes_digest_mismatch');
  }
  return receipt as unknown as RetainedContentAvailabilityReceipt;
};

export const decodeRetainedContentAvailabilityRoutes = (params: {
  receipt: RetainedContentAvailabilityReceipt;
  routesBody: Buffer;
}): RetainedContentAvailabilityRoute[] => {
  const receipt = verifyRetainedContentAvailabilityReceipt({
    value: params.receipt,
    routesBody: params.routesBody,
  });
  const text = params.routesBody.toString('utf8');
  if (!text.endsWith('\n')) fail('retained_content_availability_routes_invalid');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== receipt.accounting.contentRecordCount) {
    fail('retained_content_availability_routes_accounting_invalid');
  }
  const routes: RetainedContentAvailabilityRoute[] = [];
  const seen = new Set<string>();
  const statusCounts = emptyStatuses();
  const byKind = emptyKinds();
  const bySource = new Map<string, { count: number; statuses: StatusCounts }>();
  const byHost = new Map<string, { count: number; statuses: StatusCounts }>();
  const expectedKeys = [
    'recordType', 'schemaVersion', 'ordinal', 'address', 'nodeDigest', 'kind',
    'source', 'sourceRecordId', 'locatorSelection', 'locatorUrl', 'locatorHost',
    'availability', 'archiveKey', 'routeDigest',
  ].sort(lexical);
  for (const [ordinal, line] of lines.entries()) {
    if (!line || Buffer.byteLength(line, 'utf8') > 16 * 1024) {
      fail('retained_content_availability_route_invalid');
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      fail('retained_content_availability_route_invalid');
    }
    if (!isObject(value)
      || canonicalizeRelationshipInput(Object.keys(value).sort(lexical))
        !== canonicalizeRelationshipInput(expectedKeys)) {
      fail('retained_content_availability_route_invalid');
    }
    const route = value as unknown as RetainedContentAvailabilityRoute;
    const { routeDigest, ...core } = route;
    if (route.recordType !== 'retained_content_availability_route'
      || route.schemaVersion !== RETAINED_CONTENT_AVAILABILITY_VERSION
      || route.ordinal !== ordinal
      || typeof route.address !== 'string'
      || !route.address
      || seen.has(route.address)
      || typeof route.nodeDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(route.nodeDigest)
      || !['document', 'photo', 'video'].includes(route.kind)
      || typeof route.source !== 'string'
      || !route.source
      || (route.sourceRecordId !== null
        && typeof route.sourceRecordId !== 'string')
      || !['canonical_url', 'preview_url', 'unresolved'].includes(
        route.locatorSelection,
      )
      || !RETAINED_CONTENT_AVAILABILITY_STATUSES.includes(route.availability)
      || typeof routeDigest !== 'string'
      || relationshipInputSha256(core) !== routeDigest) {
      fail('retained_content_availability_route_invalid');
    }
    const archiveStatus = route.availability === 'retained_archive_object'
      || route.availability === 'archive_locator_missing';
    if (
      (route.locatorSelection === 'unresolved'
        && (route.locatorUrl !== null
          || route.locatorHost !== null
          || route.archiveKey !== null
          || route.availability !== 'unresolved_locator'))
      || (route.locatorSelection !== 'unresolved'
        && (typeof route.locatorUrl !== 'string'
          || !route.locatorUrl
          || typeof route.locatorHost !== 'string'
          || !route.locatorHost))
      || (archiveStatus
        && (route.locatorHost !== receipt.retainedArchive.publicHost
          || typeof route.archiveKey !== 'string'
          || !route.archiveKey))
      || (!archiveStatus && route.archiveKey !== null)
    ) {
      fail('retained_content_availability_route_invalid');
    }
    seen.add(route.address);
    routes.push(route);
    statusCounts[route.availability] += 1;
    byKind[route.kind][route.availability] += 1;
    const source = bySource.get(route.source)
      ?? { count: 0, statuses: emptyStatuses() };
    source.count += 1;
    source.statuses[route.availability] += 1;
    bySource.set(route.source, source);
    const hostKey = route.locatorHost ?? '(unresolved)';
    const host = byHost.get(hostKey) ?? { count: 0, statuses: emptyStatuses() };
    host.count += 1;
    host.statuses[route.availability] += 1;
    byHost.set(hostKey, host);
  }
  const routeSetSha256 = relationshipInputSha256(routes.map(
    ({ address, routeDigest }) => ({ address, routeDigest }),
  ));
  const expectedSources = [...bySource]
    .sort(([left], [right]) => lexical(left, right))
    .map(([source, value]) => ({
      source,
      contentRecordCount: value.count,
      statusCounts: value.statuses,
    }));
  const expectedHosts = [...byHost]
    .sort(([left], [right]) => lexical(left, right))
    .map(([host, value]) => ({
      host,
      contentRecordCount: value.count,
      statusCounts: value.statuses,
    }));
  if (routeSetSha256 !== receipt.routeSetSha256
    || canonicalizeRelationshipInput(statusCounts)
      !== canonicalizeRelationshipInput(receipt.accounting.statusCounts)
    || canonicalizeRelationshipInput(byKind)
      !== canonicalizeRelationshipInput(receipt.accounting.byKind)
    || canonicalizeRelationshipInput(expectedSources)
      !== canonicalizeRelationshipInput(receipt.accounting.bySource)
    || canonicalizeRelationshipInput(expectedHosts)
      !== canonicalizeRelationshipInput(receipt.accounting.byHost)) {
    fail('retained_content_availability_routes_accounting_invalid');
  }
  return routes;
};
