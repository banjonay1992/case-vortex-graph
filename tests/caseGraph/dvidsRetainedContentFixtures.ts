import {
  createRetainedContentAvailabilityScan,
} from '../../src/caseGraph/retainedContentAvailabilityInventory';
import {
  projectEvidenceUniverseNode,
} from '../../src/caseGraph/evidenceUniverse';
import {
  relationshipInputSha256,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildDvidsRetainedContentPreflight,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import {
  buildDvidsRetainedByteInspectionReceipt,
} from '../../src/caseGraph/dvidsRetainedContentByteInspection';
import {
  buildDvidsPublisherMetadataReviewQueue,
} from '../../src/caseGraph/dvidsPublisherMetadataReviewQueue';
import {
  buildDvidsFrameOcrReviewQueue,
} from '../../src/caseGraph/dvidsFrameOcrReviewQueue';
import { createHash } from 'node:crypto';

export const dvidsPreflightFixture = () => {
  const host = 'public.example.r2.dev';
  const dvids = projectEvidenceUniverseNode({
    kind: 'video',
    recordId: '123e4567-e89b-42d3-a456-426614174001',
    source: 'dvids-uap-related',
    sourceRecordId: '880273',
    title: 'DVIDS',
    summary: null,
    canonicalUrl: `https://${host}/videos/official/dvids-uap-related/880273.mp4`,
    previewUrl: null,
    eventTimestamp: null,
    lat: null,
    lon: null,
    location: null,
    countryCode: null,
    linkedSightingId: null,
    updatedAt: '2026-03-19T12:00:00.000Z',
    public: true,
  });
  const photo = projectEvidenceUniverseNode({
    kind: 'photo',
    recordId: 'photo-1',
    source: 'nara-archives-images',
    sourceRecordId: 'photo-1',
    title: 'Photo',
    summary: null,
    canonicalUrl: `https://${host}/photos/photo-1.jpg`,
    previewUrl: null,
    eventTimestamp: null,
    lat: null,
    lon: null,
    location: null,
    countryCode: null,
    linkedSightingId: null,
    updatedAt: '2026-03-19T12:00:00.000Z',
    public: true,
  });
  const parts = [
    {
      partNumber: 1,
      kind: 'photo',
      rowCount: 1,
      archiveKey: 'universe/photo.jsonl.gz',
      manifestKey: 'universe/photo.manifest.json',
      compressedBytes: 100,
      uncompressedBytes: 200,
      sha256: relationshipInputSha256('photo-part'),
      firstAddress: photo.address,
      lastAddress: photo.address,
      cursor: { updatedAt: photo.updatedAt, recordId: photo.recordId },
      accounting: {
        total: 1,
        byKind: { sighting: 0, document: 0, photo: 1, video: 0 },
        attachedMedia: 0,
        unresolvedTime: 1,
        unresolvedLocation: 1,
      },
    },
    {
      partNumber: 1,
      kind: 'video',
      rowCount: 1,
      archiveKey: 'universe/video.jsonl.gz',
      manifestKey: 'universe/video.manifest.json',
      compressedBytes: 100,
      uncompressedBytes: 200,
      sha256: relationshipInputSha256('video-part'),
      firstAddress: dvids.address,
      lastAddress: dvids.address,
      cursor: { updatedAt: dvids.updatedAt, recordId: dvids.recordId },
      accounting: {
        total: 1,
        byKind: { sighting: 0, document: 0, photo: 0, video: 1 },
        attachedMedia: 0,
        unresolvedTime: 1,
        unresolvedLocation: 1,
      },
    },
  ];
  const completion = {
    recordType: 'evidence_universe_completion',
    archiveVersion: 'evidence-universe-archive-v3',
    schemaVersion: 'evidence-universe-v2',
    layoutVersion: 'evidence-universe-layout-v2',
    corpusVersion: 'corpus-v1',
    expected: {
      snapshotId: '123e4567-e89b-42d3-a456-426614174000',
      byKind: { sighting: 0, document: 0, photo: 1, video: 1 },
      total: 2,
    },
    parts,
    archiveSetSha256: relationshipInputSha256('archive-set'),
  } as any;
  const scan = createRetainedContentAvailabilityScan({
    completion,
    builtAt: '2026-07-27T20:00:00.000Z',
    publicArchiveHost: host,
    listedPrefixes: ['photos', 'videos'],
    listedArchiveKeys: [
      'photos/photo-1.jpg',
      'videos/official/dvids-uap-related/880273.mp4',
    ],
    contentInventoryReceiptDigest: 'a'.repeat(64),
    contentInventorySetSha256: 'b'.repeat(64),
    contentRecordCount: 2,
  });
  scan.addPart(parts[0] as any, [photo]);
  scan.addPart(parts[1] as any, [dvids]);
  const availability = scan.finalize();
  const rightsSnapshot = {
    inspectedAt: '2026-07-27T20:05:00.000Z',
    sourceMvccSnapshot: '1:2:',
    transaction: {
      isolation: 'repeatable read' as const,
      readOnly: true as const,
    },
    registry: {
      canonicalSource: 'DVIDS_MEDIA',
      legalStatus: 'approved',
      licenseType: 'public_domain_government',
      allowedContentModes: ['full_ingest'],
      evidenceUrl: 'https://api.dvidshub.net/docs/copyright',
      reviewedAt: '2026-03-18T22:57:46.387Z',
    },
    rows: [{
      id: dvids.recordId,
      provider: 'dvids',
      sourceId: 'dvids-uap-related',
      canonicalUrl: dvids.canonicalUrl!,
      mediaKey: 'videos/official/dvids-uap-related/880273.mp4',
      storagePolicy: 'archivable',
      playbackPolicy: 'self_hosted',
      rightsStatus: 'public_domain',
      updatedAt: '2026-03-18T12:00:00.000Z',
    }],
  };
  const objectHeads = [{
    key: 'videos/official/dvids-uap-related/880273.mp4',
    contentLength: 300 * 1024 * 1024,
    contentType: 'video/mp4',
    etag: 'opaque-etag',
  }];
  return {
    dvids,
    photo,
    completion,
    availability,
    rightsSnapshot,
    objectHeads,
  };
};

export const dvidsPublisherReviewFixture = () => {
  const base = dvidsPreflightFixture();
  base.objectHeads[0].contentLength = 12;
  const preflight = buildDvidsRetainedContentPreflight({
    builtAt: '2026-07-27T20:10:00.000Z',
    routeReceipt: base.availability.receipt,
    routes: base.availability.routes,
    completion: base.completion,
    universeNodes: [base.dvids],
    rightsSnapshot: base.rightsSnapshot,
    objectHeads: base.objectHeads,
  });
  const admitted = preflight.admitted[0];
  const byteInspection = buildDvidsRetainedByteInspectionReceipt({
    builtAt: '2026-07-27T21:00:00.000Z',
    preflight,
    inspections: [{
      address: admitted.address,
      admissionDigest: admitted.admissionDigest,
      archiveKey: admitted.archiveKey,
      expectedHeadDigest: admitted.objectHead.headDigest,
      expectedEtag: admitted.objectHead.etag,
      declaredContentType: admitted.objectHead.contentType,
      byteLength: 12,
      bytesSha256: '1'.repeat(64),
      sniffedMimeType: 'video/mp4',
      durationMs: 12_345,
      safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
      safetyScanDigest: '2'.repeat(64),
    }],
  });
  const sourceSnapshot = {
    inspectedAt: '2026-07-27T21:05:00.000Z',
    sourceMvccSnapshot: '2:3:',
    transaction: {
      isolation: 'repeatable read' as const,
      readOnly: true as const,
    },
    rows: [{
      id: admitted.address.slice('video:'.length),
      title: 'Official DVIDS title',
      description: 'Publisher supplied description.',
      searchText: 'Official DVIDS title Publisher supplied description.',
      sha256Checksum: '1'.repeat(64),
      updatedAt: admitted.databaseUpdatedAt,
    }],
  };
  const queue = buildDvidsPublisherMetadataReviewQueue({
    builtAt: '2026-07-27T21:10:00.000Z',
    preflight,
    byteInspection,
    sourceSnapshot,
  });
  return { ...base, preflight, byteInspection, sourceSnapshot, queue };
};

export const dvidsFrameOcrReviewFixture = () => {
  const base = dvidsPreflightFixture();
  const objectBody = Buffer.from('xxxxftypisom');
  base.objectHeads[0].contentLength = objectBody.byteLength;
  const preflight = buildDvidsRetainedContentPreflight({
    builtAt: '2026-07-27T20:10:00.000Z',
    routeReceipt: base.availability.receipt,
    routes: base.availability.routes,
    completion: base.completion,
    universeNodes: [base.dvids],
    rightsSnapshot: base.rightsSnapshot,
    objectHeads: base.objectHeads,
  });
  const admitted = preflight.admitted[0];
  const objectSha256 = createHash('sha256').update(objectBody).digest('hex');
  const byteInspection = buildDvidsRetainedByteInspectionReceipt({
    builtAt: '2026-07-27T21:00:00.000Z',
    preflight,
    inspections: [{
      address: admitted.address,
      admissionDigest: admitted.admissionDigest,
      archiveKey: admitted.archiveKey,
      expectedHeadDigest: admitted.objectHead.headDigest,
      expectedEtag: admitted.objectHead.etag,
      declaredContentType: admitted.objectHead.contentType,
      byteLength: objectBody.byteLength,
      bytesSha256: objectSha256,
      sniffedMimeType: 'video/mp4',
      durationMs: 70_000,
      safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
      safetyScanDigest: '2'.repeat(64),
    }],
  });
  const ffmpegBody = Buffer.from('ffmpeg-binary');
  const tesseractBody = Buffer.from('tesseract-binary');
  const trainedDataBody = Buffer.from('eng-model');
  const frameBody = Buffer.from('png-frame');
  const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
  const toolchainCore = {
    ffmpeg: {
      path: '/tools/ffmpeg',
      version: 'ffmpeg version 8.1.1',
      binaryBytes: ffmpegBody.byteLength,
      binarySha256: hash(ffmpegBody),
    },
    tesseract: {
      path: '/tools/tesseract',
      version: 'tesseract 5.5.2',
      binaryBytes: tesseractBody.byteLength,
      binarySha256: hash(tesseractBody),
      trainedDataPath: '/tessdata/eng.traineddata',
      trainedDataBytes: trainedDataBody.byteLength,
      trainedDataSha256: hash(trainedDataBody),
      language: 'eng' as const,
    },
  };
  const toolchain = {
    ...toolchainCore,
    toolchainDigest: relationshipInputSha256(toolchainCore),
  };
  const keyframeTimes = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000];
  const frames = keyframeTimes.map((keyframeMs, keyframeOrdinal) => {
    const text = keyframeOrdinal === 3 ? 'OFFICIAL DATE' : null;
    return {
      address: admitted.address,
      archiveKey: admitted.archiveKey,
      bytesSha256: objectSha256,
      keyframeOrdinal,
      keyframeMs,
      frameBytes: frameBody.byteLength,
      frameSha256: hash(frameBody),
      frameWidth: 1280,
      frameHeight: 720,
      ocrTsvSha256: String(keyframeOrdinal + 1).repeat(64),
      text,
      textSha256: text === null ? null : relationshipInputSha256(text),
      wordCount: text === null ? 0 : 2,
      confidence: text === null ? null : 0.91,
      extractionStatus: text === null
        ? 'no_text' as const
        : 'text_found' as const,
    };
  });
  const queue = buildDvidsFrameOcrReviewQueue({
    builtAt: '2026-07-27T22:00:00.000Z',
    preflight,
    byteInspection,
    toolchain,
    frames,
  });
  return {
    ...base,
    preflight,
    byteInspection,
    objectBody,
    objectSha256,
    frameBody,
    ffmpegBody,
    tesseractBody,
    trainedDataBody,
    queue,
  };
};
