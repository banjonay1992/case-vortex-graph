import {
  verifyDvidsRetainedByteInspectionReceipt,
  type DvidsRetainedByteInspectionReceipt,
} from './dvidsRetainedContentByteInspection';
import {
  verifyDvidsRetainedContentPreflightReceipt,
  type DvidsRetainedContentPreflightReceipt,
} from './dvidsRetainedContentPreflight';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION =
  'case-vortex-dvids-publisher-metadata-review-queue-v1' as const;

export type DvidsPublisherMetadataRow = {
  id: string;
  title: string;
  description: string;
  searchText: string;
  sha256Checksum: string;
  updatedAt: string;
};

export type DvidsPublisherMetadataSnapshot = {
  inspectedAt: string;
  sourceMvccSnapshot: string;
  transaction: { isolation: 'repeatable read'; readOnly: true };
  rows: DvidsPublisherMetadataRow[];
};

export type DvidsPublisherMetadataReviewQueue = {
  recordType: 'dvids_publisher_metadata_review_queue';
  schemaVersion: typeof DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    preflightReceiptDigest: string;
    byteInspectionReceiptDigest: string;
    byteInspectionObjectSetSha256: string;
  };
  sourceSnapshot: {
    inspectedAt: string;
    sourceMvccSnapshot: string;
    transaction: { isolation: 'repeatable read'; readOnly: true };
    rowSetSha256: string;
  };
  items: Array<{
    address: string;
    archiveKey: string;
    admissionDigest: string;
    bytesSha256: string;
    databaseUpdatedAt: string;
    title: string;
    titleSha256: string;
    description: string;
    descriptionSha256: string;
    searchTextSha256: string;
    reviewStatus: 'unreviewed';
    evidenceSemantics: 'publisher_supplied_metadata';
    reviewRequirements: [
      'separate_atomic_claims',
      'preserve_attribution_and_modality',
      'reject_promotional_or_nonfactual_language',
      'do_not_treat_as_transcript_or_visual_observation',
    ];
    itemDigest: string;
  }>;
  accounting: {
    expectedObjectCount: number;
    checksumMatchedRowCount: number;
    reviewItemCount: number;
    titleBytes: number;
    descriptionBytes: number;
    searchTextBytes: number;
    reviewedItemCount: 0;
    acceptedClaimCount: 0;
  };
  itemSetSha256: string;
  limitations: string[];
  guarantees: {
    exactPreflightAndByteReceiptBinding: true;
    exactDatabaseChecksumMatch: true;
    publisherMetadataKeptDistinctFromMediaContent: true;
    everyItemUnreviewed: true;
    claimsAuthorized: false;
    databaseReads: 2;
    databaseWrites: 0;
    storageReads: 0;
    storageWrites: 0;
    providerCalls: 0;
    providerBytesDownloaded: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  queueDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new Error(code); };
const compareText = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const timestamp = (value: string, code: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
};
const exactTimestamp = (value: string, code: string) => {
  if (timestamp(value, code) !== value) fail(code);
  return value;
};
const text = (value: string, maximumBytes: number, code: string) => {
  if (typeof value !== 'string'
    || !value.trim()
    || value !== value.normalize('NFC')
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || value.includes('\u0000')) {
    fail(code);
  }
  return value;
};
const mvcc = (value: string) => {
  if (!/^\d+:\d+:(?:\d+(?:,\d+)*)?$/u.test(value)) {
    fail('dvids_publisher_review_mvcc_invalid');
  }
  return value;
};

export const buildDvidsPublisherMetadataReviewQueue = (params: {
  builtAt: string;
  preflight: DvidsRetainedContentPreflightReceipt;
  byteInspection: DvidsRetainedByteInspectionReceipt;
  sourceSnapshot: DvidsPublisherMetadataSnapshot;
}): DvidsPublisherMetadataReviewQueue => {
  const preflight = verifyDvidsRetainedContentPreflightReceipt(
    params.preflight,
  );
  const byteInspection = verifyDvidsRetainedByteInspectionReceipt({
    value: params.byteInspection,
    preflight,
  });
  if (byteInspection.binding.preflightReceiptDigest !== preflight.receiptDigest
    || byteInspection.accounting.inspectedObjectCount
      !== preflight.accounting.admittedObjectCount) {
    fail('dvids_publisher_review_receipt_binding_invalid');
  }
  if (params.sourceSnapshot.transaction.isolation !== 'repeatable read'
    || params.sourceSnapshot.transaction.readOnly !== true) {
    fail('dvids_publisher_review_transaction_invalid');
  }
  const inspectedAt = exactTimestamp(
    timestamp(
      params.sourceSnapshot.inspectedAt,
      'dvids_publisher_review_inspected_at_invalid',
    ),
    'dvids_publisher_review_inspected_at_invalid',
  );
  const expected = new Map(preflight.admitted.map((item) => [
    item.address,
    {
      admission: item,
      bytes: byteInspection.objects.find(
        (object) => object.address === item.address,
      ),
    },
  ]));
  if ([...expected.values()].some(({ bytes }) => !bytes)) {
    fail('dvids_publisher_review_receipt_binding_invalid');
  }
  const rows = new Map<string, DvidsPublisherMetadataRow>();
  for (const input of params.sourceSnapshot.rows) {
    const id = String(input.id).toLowerCase();
    const address = `video:${id}`;
    if (!expected.has(address) || rows.has(address)
      || !SHA256.test(input.sha256Checksum)) {
      fail('dvids_publisher_review_row_invalid');
    }
    rows.set(address, {
      id,
      title: text(input.title, 20_000, 'dvids_publisher_review_title_invalid'),
      description: text(
        input.description,
        100_000,
        'dvids_publisher_review_description_invalid',
      ),
      searchText: text(
        input.searchText,
        200_000,
        'dvids_publisher_review_search_text_invalid',
      ),
      sha256Checksum: input.sha256Checksum,
      updatedAt: timestamp(
        input.updatedAt,
        'dvids_publisher_review_updated_at_invalid',
      ),
    });
  }
  if (rows.size !== expected.size) {
    fail('dvids_publisher_review_row_accounting_invalid');
  }
  const reviewRequirements = [
    'separate_atomic_claims',
    'preserve_attribution_and_modality',
    'reject_promotional_or_nonfactual_language',
    'do_not_treat_as_transcript_or_visual_observation',
  ] as const;
  const items = [...expected.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([address, value]) => {
      const row = rows.get(address)!;
      const bytes = value.bytes!;
      if (row.sha256Checksum !== bytes.bytesSha256
        || row.updatedAt !== value.admission.databaseUpdatedAt) {
        fail('dvids_publisher_review_checksum_or_lineage_mismatch');
      }
      const core = {
        address,
        archiveKey: value.admission.archiveKey,
        admissionDigest: value.admission.admissionDigest,
        bytesSha256: bytes.bytesSha256,
        databaseUpdatedAt: row.updatedAt,
        title: row.title,
        titleSha256: relationshipInputSha256(row.title),
        description: row.description,
        descriptionSha256: relationshipInputSha256(row.description),
        searchTextSha256: relationshipInputSha256(row.searchText),
        reviewStatus: 'unreviewed' as const,
        evidenceSemantics: 'publisher_supplied_metadata' as const,
        reviewRequirements: [...reviewRequirements] as [
          'separate_atomic_claims',
          'preserve_attribution_and_modality',
          'reject_promotional_or_nonfactual_language',
          'do_not_treat_as_transcript_or_visual_observation',
        ],
      };
      return { ...core, itemDigest: relationshipInputSha256(core) };
    });
  const titleBytes = items.reduce(
    (sum, item) => sum + Buffer.byteLength(item.title, 'utf8'),
    0,
  );
  const descriptionBytes = items.reduce(
    (sum, item) => sum + Buffer.byteLength(item.description, 'utf8'),
    0,
  );
  const searchTextBytes = [...rows.values()].reduce(
    (sum, row) => sum + Buffer.byteLength(row.searchText, 'utf8'),
    0,
  );
  const body: Omit<DvidsPublisherMetadataReviewQueue, 'queueDigest'> = {
    recordType: 'dvids_publisher_metadata_review_queue',
    schemaVersion: DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION,
    builtAt: exactTimestamp(
      params.builtAt,
      'dvids_publisher_review_built_at_invalid',
    ),
    binding: {
      corpusVersion: preflight.binding.corpusVersion,
      snapshotId: preflight.binding.snapshotId,
      preflightReceiptDigest: preflight.receiptDigest,
      byteInspectionReceiptDigest: byteInspection.receiptDigest,
      byteInspectionObjectSetSha256: byteInspection.objectSetSha256,
    },
    sourceSnapshot: {
      inspectedAt,
      sourceMvccSnapshot: mvcc(params.sourceSnapshot.sourceMvccSnapshot),
      transaction: { isolation: 'repeatable read', readOnly: true },
      rowSetSha256: relationshipInputSha256(
        [...rows.entries()].sort(([left], [right]) => compareText(left, right)),
      ),
    },
    items,
    accounting: {
      expectedObjectCount: preflight.accounting.admittedObjectCount,
      checksumMatchedRowCount: items.length,
      reviewItemCount: items.length,
      titleBytes,
      descriptionBytes,
      searchTextBytes,
      reviewedItemCount: 0,
      acceptedClaimCount: 0,
    },
    itemSetSha256: relationshipInputSha256(items.map(
      ({ address, itemDigest }) => ({ address, itemDigest }),
    )),
    limitations: [
      'Queue text is publisher-supplied database metadata checksum-bound to each retained object; it is not a transcript, frame observation or independent verification.',
      'Every item remains unreviewed and authorizes zero claims until a separate human adjudication binds exact item and field digests.',
      'Search text is retained by digest and byte accounting only because it is a derived index field; reviewers receive title and description as the review surface.',
      'Spoken and visual content still require separately pinned local extraction and review.',
    ],
    guarantees: {
      exactPreflightAndByteReceiptBinding: true,
      exactDatabaseChecksumMatch: true,
      publisherMetadataKeptDistinctFromMediaContent: true,
      everyItemUnreviewed: true,
      claimsAuthorized: false,
      databaseReads: 2,
      databaseWrites: 0,
      storageReads: 0,
      storageWrites: 0,
      providerCalls: 0,
      providerBytesDownloaded: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, queueDigest: relationshipInputSha256(body) };
};

export const verifyDvidsPublisherMetadataReviewQueue = (params: {
  value: unknown;
  preflight: DvidsRetainedContentPreflightReceipt;
  byteInspection: DvidsRetainedByteInspectionReceipt;
}): DvidsPublisherMetadataReviewQueue => {
  if (!isObject(params.value)
    || params.value.recordType !== 'dvids_publisher_metadata_review_queue'
    || params.value.schemaVersion
      !== DVIDS_PUBLISHER_METADATA_REVIEW_QUEUE_VERSION
    || typeof params.value.builtAt !== 'string'
    || !isObject(params.value.sourceSnapshot)
    || !Array.isArray(params.value.items)) {
    fail('dvids_publisher_review_queue_invalid');
  }
  const value = params.value as unknown as DvidsPublisherMetadataReviewQueue;
  const rows = value.items.map((item) => ({
    id: item.address.slice('video:'.length),
    title: item.title,
    description: item.description,
    searchText: '',
    sha256Checksum: item.bytesSha256,
    updatedAt: item.databaseUpdatedAt,
  }));
  const storedSearchBytes = value.accounting.searchTextBytes;
  if (!Number.isSafeInteger(storedSearchBytes) || storedSearchBytes < 1) {
    fail('dvids_publisher_review_queue_invalid');
  }
  const { queueDigest, ...body } = value;
  if (relationshipInputSha256(body) !== queueDigest
    || value.items.some((item) => (
      relationshipInputSha256({
        address: item.address,
        archiveKey: item.archiveKey,
        admissionDigest: item.admissionDigest,
        bytesSha256: item.bytesSha256,
        databaseUpdatedAt: item.databaseUpdatedAt,
        title: item.title,
        titleSha256: item.titleSha256,
        description: item.description,
        descriptionSha256: item.descriptionSha256,
        searchTextSha256: item.searchTextSha256,
        reviewStatus: item.reviewStatus,
        evidenceSemantics: item.evidenceSemantics,
        reviewRequirements: item.reviewRequirements,
      }) !== item.itemDigest
      || relationshipInputSha256(item.title) !== item.titleSha256
      || relationshipInputSha256(item.description) !== item.descriptionSha256
    ))
    || rows.length !== value.accounting.reviewItemCount) {
    fail('dvids_publisher_review_queue_integrity_failed');
  }
  verifyDvidsRetainedByteInspectionReceipt({
    value: params.byteInspection,
    preflight: params.preflight,
  });
  if (value.binding.preflightReceiptDigest !== params.preflight.receiptDigest
    || value.binding.byteInspectionReceiptDigest
      !== params.byteInspection.receiptDigest
    || value.binding.byteInspectionObjectSetSha256
      !== params.byteInspection.objectSetSha256) {
    fail('dvids_publisher_review_receipt_binding_invalid');
  }
  return value;
};
