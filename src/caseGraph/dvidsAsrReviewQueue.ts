import {
  verifyDvidsRetainedByteInspectionReceipt,
  type DvidsRetainedByteInspectionReceipt,
} from './dvidsRetainedContentByteInspection';
import {
  verifyDvidsRetainedContentPreflightReceipt,
  type DvidsRetainedContentPreflightReceipt,
} from './dvidsRetainedContentPreflight';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const DVIDS_ASR_REVIEW_QUEUE_VERSION =
  'case-vortex-dvids-asr-review-queue-v2' as const;

export const DVIDS_ASR_POLICY = Object.freeze({
  version: 'case-vortex-dvids-asr-policy-v2',
  language: 'en',
  sampleRateHz: 16_000,
  channels: 1,
  modelName: 'small.en',
  modelSha256:
    'f953ad0fd29cacd07d5a9eda5624af0f6bcf2258be67c92b79389873d91e0872',
  maximumCommandOutputBytes: 8 * 1024 * 1024,
  commandTimeoutMs: 45 * 60_000,
  maximumSegmentsPerObject: 20_000,
  maximumTextBytesPerSegment: 64 * 1024,
  maximumTotalTextBytes: 64 * 1024 * 1024,
  maximumNoSpeechProbability: 0.6,
  objectReadConcurrency: 1,
} as const);

export type DvidsAsrToolchain = {
  ffmpeg: {
    path: string;
    version: string;
    binaryBytes: number;
    binarySha256: string;
  };
  whisper: {
    path: string;
    packageVersion: string;
    launcherBytes: number;
    launcherSha256: string;
    pythonPath: string;
    pythonVersion: string;
    pythonBinaryBytes: number;
    pythonBinarySha256: string;
    packageRoot: string;
    packageSourceFileCount: number;
    packageSourceSetSha256: string;
  };
  model: {
    name: typeof DVIDS_ASR_POLICY.modelName;
    path: string;
    bytes: number;
    sha256: typeof DVIDS_ASR_POLICY.modelSha256;
  };
  toolchainDigest: string;
};

export type DvidsAsrSegment = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  textSha256: string;
  wordCount: number;
  confidence: number;
  noSpeechProbability: number;
};

export type DvidsAsrObjectResult = {
  address: string;
  archiveKey: string;
  bytesSha256: string;
  durationMs: number;
  audioWavSha256: string;
  whisperJsonSha256: string;
  detectedLanguage: string;
  rawSegmentCount: number;
  noSpeechFilteredSegmentCount: number;
  segments: DvidsAsrSegment[];
};

export type DvidsAsrReviewQueue = {
  recordType: 'dvids_asr_review_queue';
  schemaVersion: typeof DVIDS_ASR_REVIEW_QUEUE_VERSION;
  builtAt: string;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    preflightReceiptDigest: string;
    byteInspectionReceiptDigest: string;
    byteInspectionObjectSetSha256: string;
  };
  policy: typeof DVIDS_ASR_POLICY & { policyDigest: string };
  toolchain: DvidsAsrToolchain;
  objects: Array<DvidsAsrObjectResult & { objectResultDigest: string }>;
  reviewItems: Array<{
    address: string;
    segmentOrdinal: number;
    startMs: number;
    endMs: number;
    text: string;
    textSha256: string;
    confidence: number;
    objectResultDigest: string;
    evidenceSemantics: 'machine_asr_unreviewed';
    reviewStatus: 'unreviewed';
    reviewRequirements: [
      'listen_to_exact_checksum_bound_media_interval',
      'correct_or_reject_machine_transcript',
      'preserve_timecode_and_machine_origin',
      'do_not_treat_transcript_as_verified_event_claim',
    ];
    reviewItemDigest: string;
  }>;
  accounting: {
    expectedObjectCount: number;
    processedObjectCount: number;
    objectWithSpeechCount: number;
    objectWithoutSpeechCount: number;
    segmentCount: number;
    rawSegmentCount: number;
    noSpeechFilteredSegmentCount: number;
    totalTextBytes: number;
    totalWordCount: number;
    reviewedSegmentCount: 0;
    acceptedClaimCount: 0;
  };
  objectResultSetSha256: string;
  reviewItemSetSha256: string;
  limitations: string[];
  guarantees: {
    exactByteInspectionBinding: true;
    exactToolAndModelBytesPinned: true;
    everyAdmittedObjectAttempted: true;
    deterministicNoSpeechFilterApplied: true;
    machineAsrKeptUnreviewed: true;
    claimsAuthorized: false;
    storageBodyReads: number;
    storageBodyBytesRead: number;
    temporaryBytesRetained: 0;
    databaseReads: 0;
    databaseWrites: 0;
    storageWrites: 0;
    providerCalls: 0;
    LunaCalls: 0;
    claimSegmentsCreated: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  queueDigest: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const LANGUAGE = /^[a-z]{2,3}$/u;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);
const pathValue = (value: string) => {
  if (typeof value !== 'string' || !value.startsWith('/')
    || Buffer.byteLength(value, 'utf8') > 4_096 || /[\r\n\u0000]/u.test(value)) {
    fail('dvids_asr_toolchain_invalid');
  }
  return value;
};
const versionValue = (value: string) => {
  if (typeof value !== 'string' || !value.trim()
    || Buffer.byteLength(value, 'utf8') > 1_024 || /[\r\n\u0000]/u.test(value)) {
    fail('dvids_asr_toolchain_invalid');
  }
  return value;
};
const positive = (value: number, code: string) => {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
};
const timestamp = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('dvids_asr_built_at_invalid');
  }
  return value;
};

const verifyToolchain = (input: DvidsAsrToolchain): DvidsAsrToolchain => {
  const body = {
    ffmpeg: {
      path: pathValue(input.ffmpeg.path),
      version: versionValue(input.ffmpeg.version),
      binaryBytes: positive(input.ffmpeg.binaryBytes, 'dvids_asr_toolchain_invalid'),
      binarySha256: SHA256.test(input.ffmpeg.binarySha256)
        ? input.ffmpeg.binarySha256
        : fail('dvids_asr_toolchain_invalid'),
    },
    whisper: {
      path: pathValue(input.whisper.path),
      packageVersion: versionValue(input.whisper.packageVersion),
      launcherBytes: positive(
        input.whisper.launcherBytes,
        'dvids_asr_toolchain_invalid',
      ),
      launcherSha256: SHA256.test(input.whisper.launcherSha256)
        ? input.whisper.launcherSha256
        : fail('dvids_asr_toolchain_invalid'),
      pythonPath: pathValue(input.whisper.pythonPath),
      pythonVersion: versionValue(input.whisper.pythonVersion),
      pythonBinaryBytes: positive(
        input.whisper.pythonBinaryBytes,
        'dvids_asr_toolchain_invalid',
      ),
      pythonBinarySha256: SHA256.test(input.whisper.pythonBinarySha256)
        ? input.whisper.pythonBinarySha256
        : fail('dvids_asr_toolchain_invalid'),
      packageRoot: pathValue(input.whisper.packageRoot),
      packageSourceFileCount: positive(
        input.whisper.packageSourceFileCount,
        'dvids_asr_toolchain_invalid',
      ),
      packageSourceSetSha256: SHA256.test(
        input.whisper.packageSourceSetSha256,
      )
        ? input.whisper.packageSourceSetSha256
        : fail('dvids_asr_toolchain_invalid'),
    },
    model: {
      name: input.model.name,
      path: pathValue(input.model.path),
      bytes: positive(input.model.bytes, 'dvids_asr_toolchain_invalid'),
      sha256: input.model.sha256,
    },
  };
  if (body.model.name !== DVIDS_ASR_POLICY.modelName
    || body.model.sha256 !== DVIDS_ASR_POLICY.modelSha256
    || relationshipInputSha256(body) !== input.toolchainDigest) {
    fail('dvids_asr_toolchain_invalid');
  }
  return { ...body, toolchainDigest: input.toolchainDigest };
};

export const buildDvidsAsrReviewQueue = (params: {
  builtAt: string;
  preflight: DvidsRetainedContentPreflightReceipt;
  byteInspection: DvidsRetainedByteInspectionReceipt;
  toolchain: DvidsAsrToolchain;
  results: readonly DvidsAsrObjectResult[];
}): DvidsAsrReviewQueue => {
  const preflight = verifyDvidsRetainedContentPreflightReceipt(params.preflight);
  const byteInspection = verifyDvidsRetainedByteInspectionReceipt({
    value: params.byteInspection,
    preflight,
  });
  const toolchain = verifyToolchain(params.toolchain);
  const expected = new Map(byteInspection.objects.map((object) => [
    object.address,
    object,
  ]));
  const seen = new Set<string>();
  let totalTextBytes = 0;
  let totalWordCount = 0;
  let rawSegmentCount = 0;
  let noSpeechFilteredSegmentCount = 0;
  const objects = [...params.results].map((input) => {
    const object = expected.get(input.address)
      ?? fail('dvids_asr_object_result_invalid');
    if (seen.has(input.address)
      || input.archiveKey !== object.archiveKey
      || input.bytesSha256 !== object.bytesSha256
      || input.durationMs !== object.durationMs
      || !SHA256.test(input.audioWavSha256)
      || !SHA256.test(input.whisperJsonSha256)
      || !LANGUAGE.test(input.detectedLanguage)
      || !Number.isSafeInteger(input.rawSegmentCount)
      || input.rawSegmentCount < 0
      || !Number.isSafeInteger(input.noSpeechFilteredSegmentCount)
      || input.noSpeechFilteredSegmentCount < 0
      || !Array.isArray(input.segments)
      || input.rawSegmentCount
        !== input.noSpeechFilteredSegmentCount + input.segments.length
      || input.segments.length > DVIDS_ASR_POLICY.maximumSegmentsPerObject) {
      fail('dvids_asr_object_result_invalid');
    }
    seen.add(input.address);
    rawSegmentCount += input.rawSegmentCount;
    noSpeechFilteredSegmentCount += input.noSpeechFilteredSegmentCount;
    let priorEnd = 0;
    const segments = input.segments.map((segment, ordinal) => {
      const text = segment.text.normalize('NFC');
      const textBytes = Buffer.byteLength(text, 'utf8');
      const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
      if (segment.ordinal !== ordinal
        || !Number.isSafeInteger(segment.startMs)
        || !Number.isSafeInteger(segment.endMs)
        || segment.startMs < 0
        || segment.startMs < priorEnd
        || segment.endMs <= segment.startMs
        || segment.endMs > object.durationMs
        || !text.trim()
        || text !== segment.text
        || textBytes > DVIDS_ASR_POLICY.maximumTextBytesPerSegment
        || segment.textSha256 !== relationshipInputSha256(text)
        || segment.wordCount !== wordCount
        || typeof segment.confidence !== 'number'
        || !Number.isFinite(segment.confidence)
        || segment.confidence < 0
        || segment.confidence > 1
        || typeof segment.noSpeechProbability !== 'number'
        || !Number.isFinite(segment.noSpeechProbability)
        || segment.noSpeechProbability < 0
        || segment.noSpeechProbability
          > DVIDS_ASR_POLICY.maximumNoSpeechProbability) {
        fail('dvids_asr_segment_invalid');
      }
      priorEnd = segment.endMs;
      totalTextBytes += textBytes;
      totalWordCount += wordCount;
      return { ...segment, text };
    });
    const core = { ...input, segments };
    return {
      ...core,
      objectResultDigest: relationshipInputSha256(core),
    };
  }).sort((left, right) => compare(left.address, right.address));
  if (objects.length !== expected.size
    || totalTextBytes > DVIDS_ASR_POLICY.maximumTotalTextBytes) {
    fail('dvids_asr_object_accounting_invalid');
  }
  const requirements = [
    'listen_to_exact_checksum_bound_media_interval',
    'correct_or_reject_machine_transcript',
    'preserve_timecode_and_machine_origin',
    'do_not_treat_transcript_as_verified_event_claim',
  ] as const;
  const reviewItems = objects.flatMap((object) => object.segments.map(
    (segment) => {
      const core = {
        address: object.address,
        segmentOrdinal: segment.ordinal,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        textSha256: segment.textSha256,
        confidence: segment.confidence,
        objectResultDigest: object.objectResultDigest,
        evidenceSemantics: 'machine_asr_unreviewed' as const,
        reviewStatus: 'unreviewed' as const,
        reviewRequirements: [...requirements] as [
          'listen_to_exact_checksum_bound_media_interval',
          'correct_or_reject_machine_transcript',
          'preserve_timecode_and_machine_origin',
          'do_not_treat_transcript_as_verified_event_claim',
        ],
      };
      return {
        ...core,
        reviewItemDigest: relationshipInputSha256(core),
      };
    },
  ));
  const policy = {
    ...DVIDS_ASR_POLICY,
    policyDigest: relationshipInputSha256(DVIDS_ASR_POLICY),
  };
  const body: Omit<DvidsAsrReviewQueue, 'queueDigest'> = {
    recordType: 'dvids_asr_review_queue',
    schemaVersion: DVIDS_ASR_REVIEW_QUEUE_VERSION,
    builtAt: timestamp(params.builtAt),
    binding: {
      corpusVersion: preflight.binding.corpusVersion,
      snapshotId: preflight.binding.snapshotId,
      preflightReceiptDigest: preflight.receiptDigest,
      byteInspectionReceiptDigest: byteInspection.receiptDigest,
      byteInspectionObjectSetSha256: byteInspection.objectSetSha256,
    },
    policy,
    toolchain,
    objects,
    reviewItems,
    accounting: {
      expectedObjectCount: expected.size,
      processedObjectCount: objects.length,
      objectWithSpeechCount:
        objects.filter(({ segments }) => segments.length > 0).length,
      objectWithoutSpeechCount:
        objects.filter(({ segments }) => segments.length === 0).length,
      segmentCount: reviewItems.length,
      rawSegmentCount,
      noSpeechFilteredSegmentCount,
      totalTextBytes,
      totalWordCount,
      reviewedSegmentCount: 0,
      acceptedClaimCount: 0,
    },
    objectResultSetSha256: relationshipInputSha256(objects.map(
      ({ address, objectResultDigest }) => ({ address, objectResultDigest }),
    )),
    reviewItemSetSha256: relationshipInputSha256(reviewItems.map(
      ({ address, segmentOrdinal, reviewItemDigest }) => ({
        address,
        segmentOrdinal,
        reviewItemDigest,
      }),
    )),
    limitations: [
      'Whisper output is machine-derived speech-to-text and may contain omissions, hallucinations or attribution errors.',
      'Every segment remains unreviewed until a human listens to the exact checksum-bound interval.',
      'A transcript records audible speech; it does not independently verify the event described by a speaker.',
      'The English-only small model can miss or distort non-English speech, names, call signs and technical terms.',
    ],
    guarantees: {
      exactByteInspectionBinding: true,
      exactToolAndModelBytesPinned: true,
      everyAdmittedObjectAttempted: true,
      deterministicNoSpeechFilterApplied: true,
      machineAsrKeptUnreviewed: true,
      claimsAuthorized: false,
      storageBodyReads: expected.size,
      storageBodyBytesRead: byteInspection.accounting.inspectedTotalBytes,
      temporaryBytesRetained: 0,
      databaseReads: 0,
      databaseWrites: 0,
      storageWrites: 0,
      providerCalls: 0,
      LunaCalls: 0,
      claimSegmentsCreated: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, queueDigest: relationshipInputSha256(body) };
};

export const verifyDvidsAsrReviewQueue = (params: {
  value: unknown;
  preflight: DvidsRetainedContentPreflightReceipt;
  byteInspection: DvidsRetainedByteInspectionReceipt;
}) => {
  const value = params.value as DvidsAsrReviewQueue;
  if (!value || value.recordType !== 'dvids_asr_review_queue'
    || value.schemaVersion !== DVIDS_ASR_REVIEW_QUEUE_VERSION
    || !Array.isArray(value.objects)) {
    fail('dvids_asr_queue_invalid');
  }
  const rebuilt = buildDvidsAsrReviewQueue({
    builtAt: value.builtAt,
    preflight: params.preflight,
    byteInspection: params.byteInspection,
    toolchain: value.toolchain,
    results: value.objects.map(({ objectResultDigest: _digest, ...object }) => (
      object
    )),
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(rebuilt)) {
    fail('dvids_asr_queue_integrity_failed');
  }
  return rebuilt;
};
