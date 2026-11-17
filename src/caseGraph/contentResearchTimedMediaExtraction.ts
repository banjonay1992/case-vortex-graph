import {
  makeCaseGraphContentChunk,
  makeCaseGraphContentExtractionContract,
  makeCaseGraphContentExtractionReceipt,
  verifyCaseGraphContentAsset,
  verifyCaseGraphContentLimitsProfile,
  type CaseGraphContentAsset,
  type CaseGraphContentChunk,
  type CaseGraphContentExtractionContract,
  type CaseGraphContentExtractionReceipt,
  type CaseGraphContentExtractor,
  type CaseGraphContentLimitsProfile,
} from './contentResearchArchive';

export const CASE_GRAPH_TIMED_MEDIA_EXTRACTION_POLICY = Object.freeze({
  version: 'case-graph-timed-media-extraction-v1',
  maximumSegments: 20_000,
} as const);

export type CaseGraphAsrSegment = {
  startMs: number;
  endMs: number;
  text: string;
  language: string;
  confidence: number;
  speaker?: string | null;
  channel?: string | null;
  warnings?: string[];
};

export type CaseGraphVideoFrameText = {
  startMs: number;
  endMs: number;
  keyframeMs: number;
  text: string;
  language: string;
  confidence: number;
  warnings?: string[];
};

export type CaseGraphTimedMediaExtractionBundle = {
  contract: CaseGraphContentExtractionContract;
  receipt: CaseGraphContentExtractionReceipt;
  chunks: CaseGraphContentChunk[];
};

const splitByBytes = (text: string, maximumBytes: number) => {
  const output: string[] = [];
  let current = '';
  for (const character of text) {
    if (current && Buffer.byteLength(current + character, 'utf8') > maximumBytes) {
      output.push(current);
      current = '';
    }
    if (Buffer.byteLength(character, 'utf8') > maximumBytes) {
      throw new Error('case_graph_timed_media_character_exceeds_chunk_limit');
    }
    current += character;
  }
  if (current) output.push(current);
  return output;
};

const receiptFor = (
  asset: CaseGraphContentAsset,
  contract: CaseGraphContentExtractionContract,
  chunks: CaseGraphContentChunk[],
) => makeCaseGraphContentExtractionReceipt({
  asset,
  contract,
  chunks,
  coverage: {
    coverageType: 'timed_media',
    totalDurationMs: asset.durationMs!,
    processedDurationMs: asset.durationMs!,
  },
});

export const extractCaseGraphTimedMediaContent = (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  asrExtractor: CaseGraphContentExtractor & { extractorType: 'asr' };
  frameOcrExtractor?: CaseGraphContentExtractor & { extractorType: 'ocr' };
  asrSegments: CaseGraphAsrSegment[];
  frameText: CaseGraphVideoFrameText[];
}): CaseGraphTimedMediaExtractionBundle[] => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const limitsProfile = verifyCaseGraphContentLimitsProfile(params.limitsProfile);
  if (!['audio', 'video'].includes(asset.mediaKind) || asset.terminalStatus !== 'extracted'
    || asset.durationMs === null) throw new Error('case_graph_timed_media_asset_not_extractable');
  if (!Array.isArray(params.asrSegments) || !Array.isArray(params.frameText)
    || params.asrSegments.length + params.frameText.length
      > CASE_GRAPH_TIMED_MEDIA_EXTRACTION_POLICY.maximumSegments
    || (asset.mediaKind === 'audio' && params.frameText.length)
    || (params.frameText.length && !params.frameOcrExtractor)) {
    throw new Error('case_graph_timed_media_extraction_input_invalid');
  }
  const asrSegments = [...params.asrSegments]
    .filter(({ text }) => text.trim())
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const frameText = [...params.frameText]
    .filter(({ text }) => text.trim())
    .sort((left, right) => left.keyframeMs - right.keyframeMs || left.startMs - right.startMs);
  const allText = [...asrSegments.map(({ text }) => text), ...frameText.map(({ text }) => text)];
  const totalTextBytes = allText.reduce((total, text) => total + Buffer.byteLength(text, 'utf8'), 0);
  const totalChunks = allText.reduce(
    (total, text) => total + splitByBytes(text, limitsProfile.maxChunkTextBytes).length,
    0,
  );
  if (totalTextBytes > limitsProfile.maxTotalTextBytesPerAsset) {
    throw new Error('case_graph_content_total_text_limit_exceeded');
  }
  if (totalChunks > limitsProfile.maxChunksPerAsset) {
    throw new Error('case_graph_content_chunk_count_invalid');
  }
  const bundles: CaseGraphTimedMediaExtractionBundle[] = [];
  if (asrSegments.length) {
    const contract = makeCaseGraphContentExtractionContract({
      asset, limitsProfile, extractor: params.asrExtractor,
    });
    const chunks: CaseGraphContentChunk[] = [];
    for (const segment of asrSegments) {
      for (const text of splitByBytes(segment.text, limitsProfile.maxChunkTextBytes)) {
        chunks.push(makeCaseGraphContentChunk({
          asset, contract, textOrigin: 'asr', ordinal: chunks.length,
          locator: {
            locatorType: 'timed_media', startMs: segment.startMs, endMs: segment.endMs,
            keyframeMs: null, speaker: segment.speaker || null, channel: segment.channel || null,
          },
          text, language: segment.language, confidence: segment.confidence,
          warnings: segment.warnings,
        }));
      }
    }
    bundles.push({ contract, chunks, receipt: receiptFor(asset, contract, chunks) });
  }
  if (frameText.length) {
    const contract = makeCaseGraphContentExtractionContract({
      asset, limitsProfile, extractor: params.frameOcrExtractor!,
    });
    const chunks: CaseGraphContentChunk[] = [];
    for (const frame of frameText) {
      for (const text of splitByBytes(frame.text, limitsProfile.maxChunkTextBytes)) {
        chunks.push(makeCaseGraphContentChunk({
          asset, contract, textOrigin: 'frame_ocr', ordinal: chunks.length,
          locator: {
            locatorType: 'timed_media', startMs: frame.startMs, endMs: frame.endMs,
            keyframeMs: frame.keyframeMs, speaker: null, channel: null,
          },
          text, language: frame.language, confidence: frame.confidence,
          warnings: frame.warnings,
        }));
      }
    }
    bundles.push({ contract, chunks, receipt: receiptFor(asset, contract, chunks) });
  }
  if (!bundles.length) throw new Error('case_graph_timed_media_has_no_searchable_content');
  return bundles;
};
