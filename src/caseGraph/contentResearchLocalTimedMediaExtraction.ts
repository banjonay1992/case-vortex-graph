import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  CaseGraphContentAsset,
  CaseGraphContentExtractor,
  CaseGraphContentLimitsProfile,
} from './contentResearchArchive';
import {
  extractCaseGraphTimedMediaContent,
  type CaseGraphAsrSegment,
  type CaseGraphTimedMediaExtractionBundle,
  type CaseGraphVideoFrameText,
} from './contentResearchTimedMediaExtraction';
import {
  runCaseGraphBoundedCommand,
  type CaseGraphContentCommandRunner,
} from './contentResearchLocalStructuralProbe';

export const CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY = Object.freeze({
  version: 'case-graph-local-timed-media-extraction-v1',
  commandTimeoutMs: 10 * 60_000,
  maximumOutputBytes: 8_000_000,
  maximumKeyframes: 12,
  defaultKeyframes: 6,
  frameWidth: 1280,
  ocrLanguage: 'eng',
} as const);

type WhisperJson = {
  language?: unknown;
  segments?: Array<{ start?: unknown; end?: unknown; text?: unknown; avg_logprob?: unknown }>;
};

const sha256File = async (file: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.once('error', reject);
  stream.once('end', () => resolve(hash.digest('hex')));
});

export const caseGraphTimedMediaKeyframeTimes = (
  durationMs: number,
  count: number,
) => Array.from(
  { length: count },
  (_, index) => Math.max(1, Math.min(durationMs - 1, Math.round(durationMs * (index + 1) / (count + 1)))),
);

const parseWhisper = (value: unknown, durationMs: number): CaseGraphAsrSegment[] => {
  const parsed = value as WhisperJson;
  const language = typeof parsed?.language === 'string' && /^[a-z]{2,3}$/.test(parsed.language.toLowerCase())
    ? parsed.language.toLowerCase()
    : 'und';
  if (!Array.isArray(parsed?.segments)) throw new Error('case_graph_whisper_output_invalid');
  return parsed.segments.flatMap((segment) => {
    const startMs = Math.max(0, Math.round(Number(segment.start) * 1_000));
    const endMs = Math.min(durationMs, Math.round(Number(segment.end) * 1_000));
    const text = typeof segment.text === 'string' ? segment.text : '';
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs || !text.trim()) return [];
    const logProbability = Number(segment.avg_logprob);
    const confidence = Number.isFinite(logProbability)
      ? Math.max(0, Math.min(1, Math.exp(logProbability)))
      : 0;
    return [{ startMs, endMs, text, language, confidence, channel: 'mono' }];
  });
};

export const parseCaseGraphFrameOcrTsv = (
  tsv: string,
  keyframeMs: number,
  durationMs: number,
): CaseGraphVideoFrameText | null => {
  const words: string[] = [];
  const confidence: number[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns.length < 12 || !columns.slice(11).join('\t').trim()) continue;
    words.push(columns.slice(11).join('\t'));
    const value = Number(columns[10]);
    if (Number.isFinite(value) && value >= 0) confidence.push(value);
  }
  if (!words.length) return null;
  return {
    startMs: Math.max(0, keyframeMs - 500),
    endMs: Math.min(durationMs, Math.max(keyframeMs + 500, 1)),
    keyframeMs,
    text: words.join(' '),
    language: 'en',
    confidence: confidence.length
      ? Math.max(0, Math.min(1, confidence.reduce((sum, value) => sum + value, 0) / confidence.length / 100))
      : 0,
  };
};

export const extractCaseGraphLocalTimedMedia = async (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  rawBytes: Buffer;
  asrExtractor: CaseGraphContentExtractor & { extractorType: 'asr' };
  frameOcrExtractor?: CaseGraphContentExtractor & { extractorType: 'ocr' };
  whisperModelName: string;
  whisperModelDirectory: string;
  whisperModelSha256: string;
  keyframeCount?: number;
  runCommand?: CaseGraphContentCommandRunner;
  verifyModelDigest?: (file: string) => Promise<string>;
  readWhisperJson?: (file: string) => Promise<unknown>;
  ffmpegBinary?: string;
  whisperBinary?: string;
  tesseractBinary?: string;
  signal?: AbortSignal;
}): Promise<CaseGraphTimedMediaExtractionBundle[]> => {
  if (params.signal?.aborted) throw new Error('case_graph_timed_media_extraction_aborted');
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(params.whisperModelName)
    || !/^[a-f0-9]{64}$/.test(params.whisperModelSha256)) {
    throw new Error('case_graph_whisper_model_pin_invalid');
  }
  const modelFile = path.join(params.whisperModelDirectory, `${params.whisperModelName}.pt`);
  const digest = await (params.verifyModelDigest || sha256File)(modelFile).catch(() => null);
  if (digest !== params.whisperModelSha256) throw new Error('case_graph_whisper_model_not_provisioned');
  const keyframeCount = params.asset.mediaKind === 'video'
    ? params.keyframeCount ?? CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY.defaultKeyframes
    : 0;
  if (!Number.isSafeInteger(keyframeCount) || keyframeCount < 0
    || keyframeCount > CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY.maximumKeyframes
    || (keyframeCount > 0 && !params.frameOcrExtractor)) {
    throw new Error('case_graph_timed_media_extraction_plan_invalid');
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uap-timed-extract-'));
  const input = path.join(directory, 'media.bin');
  const audio = path.join(directory, 'audio.wav');
  const runCommand = params.runCommand || runCaseGraphBoundedCommand;
  const run = async (binary: string, args: string[]) => {
    const result = await runCommand({
      binary, args,
      timeoutMs: CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY.commandTimeoutMs,
      maximumOutputBytes: CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY.maximumOutputBytes,
      signal: params.signal,
    });
    if (result.exitCode !== 0) throw new Error(`case_graph_timed_media_extractor_failed:${binary}:${result.exitCode}`);
    return result;
  };
  try {
    await fs.writeFile(input, params.rawBytes, { mode: 0o600, flag: 'wx' });
    await run(params.ffmpegBinary || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', audio,
    ]);
    await run(params.whisperBinary || 'whisper', [
      audio, '--model', params.whisperModelName, '--model_dir', params.whisperModelDirectory,
      '--output_dir', directory, '--output_format', 'json', '--fp16', 'False', '--verbose', 'False',
    ]);
    const readWhisperJson = params.readWhisperJson || (async (file: string) => (
      JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    ));
    const asrSegments = parseWhisper(await readWhisperJson(path.join(directory, 'audio.json')), params.asset.durationMs!);
    const frameText: CaseGraphVideoFrameText[] = [];
    for (const keyframeMs of caseGraphTimedMediaKeyframeTimes(
      params.asset.durationMs!,
      keyframeCount,
    )) {
      if (params.signal?.aborted) throw new Error('case_graph_timed_media_extraction_aborted');
      const frame = path.join(directory, `frame-${String(keyframeMs).padStart(12, '0')}.png`);
      await run(params.ffmpegBinary || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', (keyframeMs / 1_000).toFixed(3),
        '-i', input, '-frames:v', '1', '-vf', `scale=${CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY.frameWidth}:-2`, frame,
      ]);
      const ocr = await run(params.tesseractBinary || 'tesseract', [
        frame, 'stdout', '-l', CASE_GRAPH_LOCAL_TIMED_MEDIA_POLICY.ocrLanguage, 'tsv',
      ]);
      const parsed = parseCaseGraphFrameOcrTsv(
        ocr.stdout,
        keyframeMs,
        params.asset.durationMs!,
      );
      if (parsed) frameText.push(parsed);
    }
    return extractCaseGraphTimedMediaContent({
      asset: params.asset, limitsProfile: params.limitsProfile,
      asrExtractor: params.asrExtractor, frameOcrExtractor: params.frameOcrExtractor,
      asrSegments, frameText,
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};
