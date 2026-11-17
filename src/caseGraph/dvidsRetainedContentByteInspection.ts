import {
  verifyDvidsRetainedContentPreflightReceipt,
  type DvidsRetainedContentPreflightReceipt,
} from './dvidsRetainedContentPreflight';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_RETAINED_BYTE_INSPECTION_VERSION =
  'case-vortex-dvids-retained-byte-inspection-v1' as const;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const SHA256 = /^[a-f0-9]{64}$/u;

export type DvidsRetainedByteInspectionLimits = {
  policyVersion: 'case-vortex-dvids-retained-byte-limits-v1';
  profileId: 'dvids-retained-local-inspection-2026-07-27-v1';
  maxObjectBytes: number;
  maxTotalBytes: number;
  maxTimedMediaDurationMs: number;
  maxConcurrentObjectReads: 1;
  perObjectTimeoutMs: number;
  profileSha256: string;
};

export const makeDvidsRetainedByteInspectionLimits =
  (): DvidsRetainedByteInspectionLimits => {
    const body = {
      policyVersion: 'case-vortex-dvids-retained-byte-limits-v1' as const,
      profileId: 'dvids-retained-local-inspection-2026-07-27-v1' as const,
      maxObjectBytes: 384 * MIB,
      maxTotalBytes: 2 * GIB,
      maxTimedMediaDurationMs: 4 * 60 * 60 * 1_000,
      maxConcurrentObjectReads: 1 as const,
      perObjectTimeoutMs: 10 * 60 * 1_000,
    };
    return { ...body, profileSha256: relationshipInputSha256(body) };
  };

export type DvidsRetainedObjectByteInspection = {
  address: string;
  admissionDigest: string;
  archiveKey: string;
  expectedHeadDigest: string;
  expectedEtag: string;
  declaredContentType: string | null;
  byteLength: number;
  bytesSha256: string;
  sniffedMimeType: 'video/mp4' | 'video/webm';
  durationMs: number;
  safetyPolicyVersion: string;
  safetyScanDigest: string;
};

export type DvidsRetainedByteInspectionReceipt = {
  recordType: 'dvids_retained_byte_inspection_receipt';
  schemaVersion: typeof DVIDS_RETAINED_BYTE_INSPECTION_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    preflightReceiptDigest: string;
    admittedSetSha256: string;
    rightsRegistryDigest: string;
    rightsRowSetSha256: string;
  };
  limits: DvidsRetainedByteInspectionLimits;
  objects: Array<DvidsRetainedObjectByteInspection & {
    inspectionDigest: string;
  }>;
  accounting: {
    expectedObjectCount: number;
    inspectedObjectCount: number;
    expectedTotalBytes: number;
    inspectedTotalBytes: number;
    maximumObjectBytes: number;
    maximumDurationMs: number;
    sniffedContentTypes: Array<{
      contentType: 'video/mp4' | 'video/webm';
      objectCount: number;
    }>;
  };
  objectSetSha256: string;
  limitations: string[];
  guarantees: {
    exactPreflightAdmissionBinding: true;
    everyAdmittedObjectInspected: true;
    exactByteLengthProven: true;
    sha256ProvenForEveryObject: true;
    deterministicSignatureSniffingPassed: true;
    boundedFfprobePassed: true;
    singleObjectReadConcurrency: true;
    storageBodyReads: number;
    storageBodyBytesRead: number;
    temporaryBytesRetained: 0;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    providerBytesDownloaded: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  receiptDigest: string;
};

const fail = (code: string): never => { throw new Error(code); };
const compareText = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);
const exactTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('dvids_retained_byte_inspection_built_at_invalid');
  }
  return value;
};
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const verifyPreflightAccounting = (
  receipt: DvidsRetainedContentPreflightReceipt,
) => {
  const admitted = [...receipt.admitted].sort(
    (left, right) => compareText(left.address, right.address),
  );
  if (!admitted.length
    || new Set(admitted.map(({ address }) => address)).size !== admitted.length
    || new Set(admitted.map(({ archiveKey }) => archiveKey)).size !== admitted.length
    || admitted.some((item) => (
      relationshipInputSha256({
        address: item.address,
        nodeDigest: item.nodeDigest,
        routeDigest: item.routeDigest,
        archiveKey: item.archiveKey,
        universeUpdatedAt: item.universeUpdatedAt,
        databaseUpdatedAt: item.databaseUpdatedAt,
        rightsRowDigest: item.rightsRowDigest,
        objectHead: item.objectHead,
      }) !== item.admissionDigest
      || relationshipInputSha256({
        archiveKey: item.archiveKey,
        contentLength: item.objectHead.contentLength,
        contentType: item.objectHead.contentType,
        etag: item.objectHead.etag,
      }) !== item.objectHead.headDigest
      || !Number.isSafeInteger(item.objectHead.contentLength)
      || item.objectHead.contentLength < 1
    ))) {
    fail('dvids_retained_byte_inspection_preflight_invalid');
  }
  const total = admitted.reduce(
    (sum, item) => sum + item.objectHead.contentLength,
    0,
  );
  if (!Number.isSafeInteger(total)
    || receipt.accounting.admittedObjectCount !== admitted.length
    || receipt.accounting.rightsApprovedRetainedCount !== admitted.length
    || receipt.accounting.admittedTotalBytes !== total
    || receipt.accounting.admittedMaximumObjectBytes !== Math.max(
      ...admitted.map((item) => item.objectHead.contentLength),
    )
    || relationshipInputSha256(admitted.map(
      ({ address, admissionDigest }) => ({ address, admissionDigest }),
    )) !== receipt.admittedSetSha256) {
    fail('dvids_retained_byte_inspection_preflight_accounting_invalid');
  }
  return admitted;
};

export const buildDvidsRetainedByteInspectionReceipt = (params: {
  builtAt: string;
  preflight: DvidsRetainedContentPreflightReceipt;
  limits?: DvidsRetainedByteInspectionLimits;
  inspections: readonly DvidsRetainedObjectByteInspection[];
}): DvidsRetainedByteInspectionReceipt => {
  const preflight = verifyDvidsRetainedContentPreflightReceipt(params.preflight);
  const admitted = verifyPreflightAccounting(preflight);
  const limits = params.limits ?? makeDvidsRetainedByteInspectionLimits();
  if (relationshipInputSha256({
    policyVersion: limits.policyVersion,
    profileId: limits.profileId,
    maxObjectBytes: limits.maxObjectBytes,
    maxTotalBytes: limits.maxTotalBytes,
    maxTimedMediaDurationMs: limits.maxTimedMediaDurationMs,
    maxConcurrentObjectReads: limits.maxConcurrentObjectReads,
    perObjectTimeoutMs: limits.perObjectTimeoutMs,
  }) !== limits.profileSha256
    || relationshipInputSha256(limits)
      !== relationshipInputSha256(makeDvidsRetainedByteInspectionLimits())) {
    fail('dvids_retained_byte_inspection_limits_invalid');
  }
  if (preflight.accounting.admittedMaximumObjectBytes > limits.maxObjectBytes
    || preflight.accounting.admittedTotalBytes > limits.maxTotalBytes) {
    fail('dvids_retained_byte_inspection_preflight_exceeds_limits');
  }
  const expected = new Map(admitted.map((item) => [item.address, item]));
  const observed = new Map<string, DvidsRetainedObjectByteInspection>();
  for (const item of params.inspections) {
    const admission = expected.get(item.address);
    if (!admission || observed.has(item.address)
      || item.admissionDigest !== admission.admissionDigest
      || item.archiveKey !== admission.archiveKey
      || item.expectedHeadDigest !== admission.objectHead.headDigest
      || item.expectedEtag !== admission.objectHead.etag
      || item.declaredContentType !== admission.objectHead.contentType
      || item.byteLength !== admission.objectHead.contentLength
      || item.byteLength > limits.maxObjectBytes
      || !SHA256.test(item.bytesSha256)
      || !['video/mp4', 'video/webm'].includes(item.sniffedMimeType)
      || !Number.isSafeInteger(item.durationMs)
      || item.durationMs < 1
      || item.durationMs > limits.maxTimedMediaDurationMs
      || typeof item.safetyPolicyVersion !== 'string'
      || !item.safetyPolicyVersion
      || !SHA256.test(item.safetyScanDigest)) {
      fail('dvids_retained_byte_inspection_object_invalid');
    }
    observed.set(item.address, { ...item });
  }
  if (observed.size !== expected.size) {
    fail('dvids_retained_byte_inspection_object_accounting_invalid');
  }
  const objects = admitted.map((admission) => {
    const inspection = observed.get(admission.address)!;
    return {
      ...inspection,
      inspectionDigest: relationshipInputSha256(inspection),
    };
  });
  const inspectedTotalBytes = objects.reduce(
    (sum, object) => sum + object.byteLength,
    0,
  );
  if (!Number.isSafeInteger(inspectedTotalBytes)
    || inspectedTotalBytes !== preflight.accounting.admittedTotalBytes) {
    fail('dvids_retained_byte_inspection_byte_accounting_invalid');
  }
  const contentTypes = new Map<'video/mp4' | 'video/webm', number>();
  for (const object of objects) {
    contentTypes.set(
      object.sniffedMimeType,
      (contentTypes.get(object.sniffedMimeType) || 0) + 1,
    );
  }
  const body: Omit<DvidsRetainedByteInspectionReceipt, 'receiptDigest'> = {
    recordType: 'dvids_retained_byte_inspection_receipt',
    schemaVersion: DVIDS_RETAINED_BYTE_INSPECTION_VERSION,
    builtAt: exactTimestamp(params.builtAt),
    binding: {
      corpusVersion: preflight.binding.corpusVersion,
      snapshotId: preflight.binding.snapshotId,
      preflightReceiptDigest: preflight.receiptDigest,
      admittedSetSha256: preflight.admittedSetSha256,
      rightsRegistryDigest:
        preflight.rightsSnapshot.registry.registryDigest,
      rightsRowSetSha256: preflight.rightsSnapshot.rowSetSha256,
    },
    limits,
    objects,
    accounting: {
      expectedObjectCount: admitted.length,
      inspectedObjectCount: objects.length,
      expectedTotalBytes: preflight.accounting.admittedTotalBytes,
      inspectedTotalBytes,
      maximumObjectBytes: Math.max(...objects.map(({ byteLength }) => byteLength)),
      maximumDurationMs: Math.max(...objects.map(({ durationMs }) => durationMs)),
      sniffedContentTypes: [...contentTypes]
        .sort(([left], [right]) => compareText(left, right))
        .map(([contentType, objectCount]) => ({ contentType, objectCount })),
    },
    objectSetSha256: relationshipInputSha256(objects.map(
      ({ address, inspectionDigest }) => ({ address, inspectionDigest }),
    )),
    limitations: [
      'This receipt covers only the 17 DVIDS objects admitted by the bound rights preflight; every other retained object remains review-gated.',
      'SHA-256, deterministic signature sniffing and bounded ffprobe acceptance do not constitute malware clearance or semantic claim extraction.',
      'The inspection profile is a local execution ceiling, not an active-publication limits approval.',
      'No transcript, OCR text, claim segment, content search shard or publication identity is created by this receipt.',
    ],
    guarantees: {
      exactPreflightAdmissionBinding: true,
      everyAdmittedObjectInspected: true,
      exactByteLengthProven: true,
      sha256ProvenForEveryObject: true,
      deterministicSignatureSniffingPassed: true,
      boundedFfprobePassed: true,
      singleObjectReadConcurrency: true,
      storageBodyReads: objects.length,
      storageBodyBytesRead: inspectedTotalBytes,
      temporaryBytesRetained: 0,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      providerBytesDownloaded: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, receiptDigest: relationshipInputSha256(body) };
};

export const verifyDvidsRetainedByteInspectionReceipt = (params: {
  value: unknown;
  preflight: DvidsRetainedContentPreflightReceipt;
}): DvidsRetainedByteInspectionReceipt => {
  if (!isObject(params.value)
    || params.value.recordType !== 'dvids_retained_byte_inspection_receipt'
    || params.value.schemaVersion !== DVIDS_RETAINED_BYTE_INSPECTION_VERSION
    || typeof params.value.builtAt !== 'string'
    || !Array.isArray(params.value.objects)) {
    fail('dvids_retained_byte_inspection_receipt_invalid');
  }
  const value = params.value as unknown as DvidsRetainedByteInspectionReceipt;
  const rebuilt = buildDvidsRetainedByteInspectionReceipt({
    builtAt: value.builtAt,
    preflight: params.preflight,
    limits: value.limits,
    inspections: value.objects.map(({ inspectionDigest: _digest, ...item }) => item),
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    fail('dvids_retained_byte_inspection_receipt_integrity_failed');
  }
  return rebuilt;
};
