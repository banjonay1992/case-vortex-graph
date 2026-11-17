import {
  verifyDvidsRetainedByteInspectionReceipt,
  type DvidsRetainedByteInspectionReceipt,
} from './dvidsRetainedContentByteInspection';
import {
  verifyDvidsRetainedContentPreflightReceipt,
  type DvidsRetainedContentPreflightReceipt,
} from './dvidsRetainedContentPreflight';
import {
  caseGraphTimedMediaKeyframeTimes,
} from './contentResearchLocalTimedMediaExtraction';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION =
  'case-vortex-dvids-frame-ocr-review-queue-v1' as const;

export const DVIDS_FRAME_OCR_POLICY = Object.freeze({
  version: 'case-vortex-dvids-frame-ocr-policy-v1',
  keyframesPerVideo: 6,
  frameWidth: 1280,
  ocrLanguage: 'eng',
  maximumCommandOutputBytes: 8_000_000,
  commandTimeoutMs: 10 * 60_000,
  maximumFrameBytes: 32 * 1024 * 1024,
  maximumTextBytesPerFrame: 100_000,
  maximumWordsPerFrame: 20_000,
  objectReadConcurrency: 1,
} as const);

export type DvidsFrameOcrToolchain = {
  ffmpeg: {
    path: string;
    version: string;
    binaryBytes: number;
    binarySha256: string;
  };
  tesseract: {
    path: string;
    version: string;
    binaryBytes: number;
    binarySha256: string;
    trainedDataPath: string;
    trainedDataBytes: number;
    trainedDataSha256: string;
    language: 'eng';
  };
  toolchainDigest: string;
};

export type DvidsFrameOcrResult = {
  address: string;
  archiveKey: string;
  bytesSha256: string;
  keyframeOrdinal: number;
  keyframeMs: number;
  frameBytes: number;
  frameSha256: string;
  frameWidth: number;
  frameHeight: number;
  ocrTsvSha256: string;
  text: string | null;
  textSha256: string | null;
  wordCount: number;
  confidence: number | null;
  extractionStatus: 'text_found' | 'no_text';
};

export type DvidsFrameOcrReviewQueue = {
  recordType: 'dvids_frame_ocr_review_queue';
  schemaVersion: typeof DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    preflightReceiptDigest: string;
    byteInspectionReceiptDigest: string;
    byteInspectionObjectSetSha256: string;
  };
  policy: typeof DVIDS_FRAME_OCR_POLICY & { policyDigest: string };
  toolchain: DvidsFrameOcrToolchain;
  frames: Array<DvidsFrameOcrResult & { frameDigest: string }>;
  reviewItems: Array<{
    address: string;
    keyframeOrdinal: number;
    keyframeMs: number;
    frameDigest: string;
    text: string;
    textSha256: string;
    confidence: number;
    evidenceSemantics: 'machine_frame_ocr';
    reviewStatus: 'unreviewed';
    reviewRequirements: [
      'compare_text_to_exact_frame',
      'preserve_timecode_and_machine_origin',
      'reject_incorrect_or_partial_ocr',
      'do_not_treat_text_as_verified_event_claim',
    ];
    reviewItemDigest: string;
  }>;
  accounting: {
    expectedObjectCount: number;
    processedObjectCount: number;
    expectedFrameCount: number;
    processedFrameCount: number;
    textFrameCount: number;
    emptyFrameCount: number;
    reviewItemCount: number;
    totalTextBytes: number;
    totalWordCount: number;
    reviewedItemCount: 0;
    acceptedClaimCount: 0;
  };
  frameSetSha256: string;
  reviewItemSetSha256: string;
  limitations: string[];
  guarantees: {
    exactByteInspectionBinding: true;
    deterministicKeyframeSchedule: true;
    exactToolAndLanguageModelBytesPinned: true;
    everyPlannedFrameAttempted: true;
    machineOcrKeptUnreviewed: true;
    claimsAuthorized: false;
    storageBodyReads: number;
    storageBodyBytesRead: number;
    temporaryBytesRetained: 0;
    databaseReads: 0;
    databaseWrites: 0;
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
const exactTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('dvids_frame_ocr_built_at_invalid');
  }
  return value;
};
const pathValue = (value: string) => {
  if (typeof value !== 'string' || !value.startsWith('/')
    || Buffer.byteLength(value, 'utf8') > 4_096 || /[\r\n\u0000]/u.test(value)) {
    fail('dvids_frame_ocr_toolchain_invalid');
  }
  return value;
};
const versionValue = (value: string) => {
  if (typeof value !== 'string' || !value.trim()
    || Buffer.byteLength(value, 'utf8') > 1_024 || /[\r\n\u0000]/u.test(value)) {
    fail('dvids_frame_ocr_toolchain_invalid');
  }
  return value;
};
const positive = (value: number, code: string) => {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
};

const verifyToolchain = (
  input: DvidsFrameOcrToolchain,
): DvidsFrameOcrToolchain => {
  const body = {
    ffmpeg: {
      path: pathValue(input.ffmpeg.path),
      version: versionValue(input.ffmpeg.version),
      binaryBytes: positive(
        input.ffmpeg.binaryBytes,
        'dvids_frame_ocr_toolchain_invalid',
      ),
      binarySha256: SHA256.test(input.ffmpeg.binarySha256)
        ? input.ffmpeg.binarySha256
        : fail('dvids_frame_ocr_toolchain_invalid'),
    },
    tesseract: {
      path: pathValue(input.tesseract.path),
      version: versionValue(input.tesseract.version),
      binaryBytes: positive(
        input.tesseract.binaryBytes,
        'dvids_frame_ocr_toolchain_invalid',
      ),
      binarySha256: SHA256.test(input.tesseract.binarySha256)
        ? input.tesseract.binarySha256
        : fail('dvids_frame_ocr_toolchain_invalid'),
      trainedDataPath: pathValue(input.tesseract.trainedDataPath),
      trainedDataBytes: positive(
        input.tesseract.trainedDataBytes,
        'dvids_frame_ocr_toolchain_invalid',
      ),
      trainedDataSha256: SHA256.test(input.tesseract.trainedDataSha256)
        ? input.tesseract.trainedDataSha256
        : fail('dvids_frame_ocr_toolchain_invalid'),
      language: input.tesseract.language,
    },
  };
  if (body.tesseract.language !== DVIDS_FRAME_OCR_POLICY.ocrLanguage
    || relationshipInputSha256(body) !== input.toolchainDigest) {
    fail('dvids_frame_ocr_toolchain_invalid');
  }
  return { ...body, toolchainDigest: input.toolchainDigest };
};

export const buildDvidsFrameOcrReviewQueue = (params: {
  builtAt: string;
  preflight: DvidsRetainedContentPreflightReceipt;
  byteInspection: DvidsRetainedByteInspectionReceipt;
  toolchain: DvidsFrameOcrToolchain;
  frames: readonly DvidsFrameOcrResult[];
}): DvidsFrameOcrReviewQueue => {
  const preflight = verifyDvidsRetainedContentPreflightReceipt(
    params.preflight,
  );
  const byteInspection = verifyDvidsRetainedByteInspectionReceipt({
    value: params.byteInspection,
    preflight,
  });
  const toolchain = verifyToolchain(params.toolchain);
  const expectedObjects = new Map(byteInspection.objects.map((object) => [
    object.address,
    object,
  ]));
  const expectedFrameCount = expectedObjects.size
    * DVIDS_FRAME_OCR_POLICY.keyframesPerVideo;
  const seen = new Set<string>();
  const frames = [...params.frames].map((input) => {
    const object = expectedObjects.get(input.address);
    const schedule = object
      ? caseGraphTimedMediaKeyframeTimes(
        object.durationMs,
        DVIDS_FRAME_OCR_POLICY.keyframesPerVideo,
      )
      : [];
    const key = `${input.address}:${input.keyframeOrdinal}`;
    const text = input.text;
    const expectedStatus = text === null ? 'no_text' : 'text_found';
    const expectedTextSha256 = text === null
      ? null
      : relationshipInputSha256(text);
    if (!object || seen.has(key)
      || input.archiveKey !== object.archiveKey
      || input.bytesSha256 !== object.bytesSha256
      || !Number.isSafeInteger(input.keyframeOrdinal)
      || input.keyframeOrdinal < 0
      || input.keyframeOrdinal >= DVIDS_FRAME_OCR_POLICY.keyframesPerVideo
      || input.keyframeMs !== schedule[input.keyframeOrdinal]
      || !SHA256.test(input.frameSha256)
      || !SHA256.test(input.ocrTsvSha256)
      || input.frameBytes < 1
      || input.frameBytes > DVIDS_FRAME_OCR_POLICY.maximumFrameBytes
      || input.frameWidth !== DVIDS_FRAME_OCR_POLICY.frameWidth
      || !Number.isSafeInteger(input.frameHeight)
      || input.frameHeight < 1
      || input.frameHeight > 16_384
      || input.extractionStatus !== expectedStatus
      || input.textSha256 !== expectedTextSha256
      || !Number.isSafeInteger(input.wordCount)
      || input.wordCount < 0
      || input.wordCount > DVIDS_FRAME_OCR_POLICY.maximumWordsPerFrame
      || (text === null && (
        input.wordCount !== 0 || input.confidence !== null
      ))
      || (text !== null && (
        !text.trim()
        || text !== text.normalize('NFC')
        || Buffer.byteLength(text, 'utf8')
          > DVIDS_FRAME_OCR_POLICY.maximumTextBytesPerFrame
        || input.wordCount !== text.trim().split(/\s+/u).length
        || typeof input.confidence !== 'number'
        || !Number.isFinite(input.confidence)
        || input.confidence < 0
        || input.confidence > 1
      ))) {
      fail('dvids_frame_ocr_result_invalid');
    }
    seen.add(key);
    const core = { ...input };
    return { ...core, frameDigest: relationshipInputSha256(core) };
  }).sort((left, right) => (
    compareText(left.address, right.address)
    || left.keyframeOrdinal - right.keyframeOrdinal
  ));
  if (frames.length !== expectedFrameCount) {
    fail('dvids_frame_ocr_frame_accounting_invalid');
  }
  const processedObjects = new Set(frames.map(({ address }) => address));
  if (processedObjects.size !== expectedObjects.size) {
    fail('dvids_frame_ocr_object_accounting_invalid');
  }
  const requirements = [
    'compare_text_to_exact_frame',
    'preserve_timecode_and_machine_origin',
    'reject_incorrect_or_partial_ocr',
    'do_not_treat_text_as_verified_event_claim',
  ] as const;
  const reviewItems = frames
    .filter((frame) => frame.text !== null)
    .map((frame) => {
      const core = {
        address: frame.address,
        keyframeOrdinal: frame.keyframeOrdinal,
        keyframeMs: frame.keyframeMs,
        frameDigest: frame.frameDigest,
        text: frame.text!,
        textSha256: frame.textSha256!,
        confidence: frame.confidence!,
        evidenceSemantics: 'machine_frame_ocr' as const,
        reviewStatus: 'unreviewed' as const,
        reviewRequirements: [...requirements] as [
          'compare_text_to_exact_frame',
          'preserve_timecode_and_machine_origin',
          'reject_incorrect_or_partial_ocr',
          'do_not_treat_text_as_verified_event_claim',
        ],
      };
      return {
        ...core,
        reviewItemDigest: relationshipInputSha256(core),
      };
    });
  const totalTextBytes = reviewItems.reduce(
    (sum, item) => sum + Buffer.byteLength(item.text, 'utf8'),
    0,
  );
  const totalWordCount = reviewItems.reduce(
    (sum, item) => sum + item.text.trim().split(/\s+/u).length,
    0,
  );
  const policy = {
    ...DVIDS_FRAME_OCR_POLICY,
    policyDigest: relationshipInputSha256(DVIDS_FRAME_OCR_POLICY),
  };
  const body: Omit<DvidsFrameOcrReviewQueue, 'queueDigest'> = {
    recordType: 'dvids_frame_ocr_review_queue',
    schemaVersion: DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION,
    builtAt: exactTimestamp(params.builtAt),
    binding: {
      corpusVersion: preflight.binding.corpusVersion,
      snapshotId: preflight.binding.snapshotId,
      preflightReceiptDigest: preflight.receiptDigest,
      byteInspectionReceiptDigest: byteInspection.receiptDigest,
      byteInspectionObjectSetSha256: byteInspection.objectSetSha256,
    },
    policy,
    toolchain,
    frames,
    reviewItems,
    accounting: {
      expectedObjectCount: expectedObjects.size,
      processedObjectCount: processedObjects.size,
      expectedFrameCount,
      processedFrameCount: frames.length,
      textFrameCount: reviewItems.length,
      emptyFrameCount: frames.length - reviewItems.length,
      reviewItemCount: reviewItems.length,
      totalTextBytes,
      totalWordCount,
      reviewedItemCount: 0,
      acceptedClaimCount: 0,
    },
    frameSetSha256: relationshipInputSha256(frames.map(
      ({ address, keyframeOrdinal, frameDigest }) => ({
        address,
        keyframeOrdinal,
        frameDigest,
      }),
    )),
    reviewItemSetSha256: relationshipInputSha256(reviewItems.map(
      ({ address, keyframeOrdinal, reviewItemDigest }) => ({
        address,
        keyframeOrdinal,
        reviewItemDigest,
      }),
    )),
    limitations: [
      'Six evenly spaced deterministic frames are a bounded sampling strategy and do not exhaust visual content.',
      'OCR is machine-derived text tied to an exact frame and timecode; it is not a verified event claim or transcript.',
      'Every text-bearing frame remains unreviewed and authorizes zero claims until separate human adjudication.',
      'Audio and speech remain unprocessed because no pinned local ASR model is provisioned.',
    ],
    guarantees: {
      exactByteInspectionBinding: true,
      deterministicKeyframeSchedule: true,
      exactToolAndLanguageModelBytesPinned: true,
      everyPlannedFrameAttempted: true,
      machineOcrKeptUnreviewed: true,
      claimsAuthorized: false,
      storageBodyReads: expectedObjects.size,
      storageBodyBytesRead: byteInspection.accounting.inspectedTotalBytes,
      temporaryBytesRetained: 0,
      databaseReads: 0,
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
  return { ...body, queueDigest: relationshipInputSha256(body) };
};

export const verifyDvidsFrameOcrReviewQueue = (params: {
  value: unknown;
  preflight: DvidsRetainedContentPreflightReceipt;
  byteInspection: DvidsRetainedByteInspectionReceipt;
}): DvidsFrameOcrReviewQueue => {
  if (!isObject(params.value)
    || params.value.recordType !== 'dvids_frame_ocr_review_queue'
    || params.value.schemaVersion !== DVIDS_FRAME_OCR_REVIEW_QUEUE_VERSION
    || typeof params.value.builtAt !== 'string'
    || !isObject(params.value.toolchain)
    || !Array.isArray(params.value.frames)) {
    fail('dvids_frame_ocr_queue_invalid');
  }
  const value = params.value as unknown as DvidsFrameOcrReviewQueue;
  const rebuilt = buildDvidsFrameOcrReviewQueue({
    builtAt: value.builtAt,
    preflight: params.preflight,
    byteInspection: params.byteInspection,
    toolchain: value.toolchain,
    frames: value.frames.map(({ frameDigest: _digest, ...frame }) => frame),
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    fail('dvids_frame_ocr_queue_integrity_failed');
  }
  return rebuilt;
};
