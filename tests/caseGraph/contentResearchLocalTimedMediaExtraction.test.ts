import { readdir } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { makeCaseGraphContentAsset, makeCaseGraphContentLimitsProfile } from '../../src/caseGraph/contentResearchArchive';
import { extractCaseGraphLocalTimedMedia } from '../../src/caseGraph/contentResearchLocalTimedMediaExtraction';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const d = (value: string) => value.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'local-timed-v1',
  manifestSha256: d('1'), snapshotId: 'snapshot', graphArtifactSetSha256: d('2'),
  relationshipSchemaVersion: 'schema', relationshipPolicyVersion: 'policy', relationshipPolicySha256: d('3'),
  relationshipModelId: 'model', relationshipModelVersion: 'v1', relationshipModelSha256: d('4'),
  calibrationSetSha256: d('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'limits', maxAssetBytes: 100_000, maxDocumentPages: 10, maxImagePixels: 1_000_000,
  maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 100, maxTotalTextBytesPerAsset: 1_000,
  maxChunksPerAsset: 100,
});
const asset = makeCaseGraphContentAsset({
  publication, address: 'video:00000000-0000-4000-8000-000000000010', nodeDigest: d('6'),
  sourceAssetKey: 'canonical-url:https://example.test/video', mediaKind: 'video',
  claimedMimeType: 'application/octet-stream', sniffedMimeType: 'video/mp4', byteLength: 100,
  bytesSha256: d('7'), capturedObjectKey: 'captured/video', capturedObjectSha256: d('7'),
  searchableObjectKey: 'captured/video', searchableBytesSha256: d('7'), pageCount: null,
  imageWidth: null, imageHeight: null, durationMs: 9_000, sourceLocatorDigest: d('8'),
  sourceLineageDigest: d('9'), visibility: 'public', rightsPolicyVersion: 'rights', rightsEvidenceDigest: d('a'),
  safetyPolicyVersion: 'safety', safetyScanDigest: d('b'), redactionPolicyDigest: d('c'),
  redactionStatus: 'not_required', redactionTransformationDigest: null, terminalStatus: 'extracted',
  terminalReason: 'fixture',
});
const extractor = <T extends 'asr' | 'ocr'>(extractorType: T, hash: string) => ({
  extractorType, extractorId: extractorType, extractorVersion: '1', containerDigest: d(hash),
  modelId: 'model', modelRevision: 'pinned', configDigest: d('e'), promptDigest: null,
  humanProvenanceDigest: null, languageDetectorVersion: 'en-v1',
});

describe('bounded local timed-media processor', () => {
  it('uses a preverified Whisper model, bounded argv calls and deterministic keyframes', async () => {
    const runCommand = vi.fn(async ({ binary }: { binary: string }) => ({
      exitCode: 0,
      stdout: binary === 'tesseract'
        ? 'h\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t90\tDATE'
        : '',
      stderr: '',
    }));
    const bundles = await extractCaseGraphLocalTimedMedia({
      asset, limitsProfile, rawBytes: Buffer.from('xxxxftypisom'),
      asrExtractor: extractor('asr', 'd'), frameOcrExtractor: extractor('ocr', 'f'),
      whisperModelName: 'medium.en', whisperModelDirectory: '/models', whisperModelSha256: d('1'),
      verifyModelDigest: async () => d('1'), keyframeCount: 2, runCommand,
      readWhisperJson: async () => ({
        language: 'en', segments: [{ start: 0.5, end: 2, text: 'object overhead', avg_logprob: -0.1 }],
      }),
    });
    expect(bundles.map(({ contract }) => contract.textOrigin).sort()).toEqual(['asr', 'frame_ocr']);
    expect(runCommand.mock.calls.map(([call]) => call.binary)).toEqual([
      'ffmpeg', 'whisper', 'ffmpeg', 'tesseract', 'ffmpeg', 'tesseract',
    ]);
    const whisperCall = runCommand.mock.calls[1][0];
    expect(whisperCall.args).toContain('/models');
    expect(whisperCall.args).not.toContain('--download');
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('uap-timed-extract-'))).toEqual([]);
  });

  it('fails before commands when the pinned model is absent and rejects excessive frame plans', async () => {
    const runCommand = vi.fn();
    const base = {
      asset, limitsProfile, rawBytes: Buffer.from('xxxxftypisom'),
      asrExtractor: extractor('asr', 'd'), frameOcrExtractor: extractor('ocr', 'f'),
      whisperModelName: 'medium.en', whisperModelDirectory: '/models', whisperModelSha256: d('1'), runCommand,
    };
    await expect(extractCaseGraphLocalTimedMedia({
      ...base, verifyModelDigest: async () => d('2'),
    })).rejects.toThrow('case_graph_whisper_model_not_provisioned');
    expect(runCommand).not.toHaveBeenCalled();
    await expect(extractCaseGraphLocalTimedMedia({
      ...base, verifyModelDigest: async () => d('1'), keyframeCount: 13,
    })).rejects.toThrow('case_graph_timed_media_extraction_plan_invalid');
  });
});
