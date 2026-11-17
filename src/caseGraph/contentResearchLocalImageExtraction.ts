import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  CaseGraphContentAsset,
  CaseGraphContentExtractor,
  CaseGraphContentLimitsProfile,
} from './contentResearchArchive';
import {
  CASE_GRAPH_IMAGE_EXTRACTION_POLICY,
  extractCaseGraphImageContent,
  type CaseGraphImageExtractionBundle,
  type CaseGraphImageMetadataField,
  type CaseGraphImageOcrRegion,
} from './contentResearchImageExtraction';
import {
  runCaseGraphBoundedCommand,
  type CaseGraphContentCommandRunner,
} from './contentResearchLocalStructuralProbe';

export const CASE_GRAPH_LOCAL_IMAGE_EXTRACTION_POLICY = Object.freeze({
  version: 'case-graph-local-image-extraction-v1',
  timeoutMs: 60_000,
  maximumOutputBytes: 4_000_000,
  ocrLanguage: 'eng',
} as const);

type MetadataParser = (body: Buffer) => Promise<Record<string, unknown> | null>;

const printableMetadata = (field: string, value: unknown): CaseGraphImageMetadataField | null => {
  if (!CASE_GRAPH_IMAGE_EXTRACTION_POLICY.publicMetadataFields.includes(field as never)) return null;
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else return null;
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > 16_000) return null;
  return { field, text, language: 'und' };
};

const parseOcrLines = (tsv: string, width: number, height: number): CaseGraphImageOcrRegion[] => {
  const groups = new Map<string, Array<{
    text: string; confidence: number; left: number; top: number; width: number; height: number;
  }>>();
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns.length < 12 || !columns.slice(11).join('\t').trim()) continue;
    const values = columns.slice(6, 11).map(Number);
    if (values.some((value) => !Number.isFinite(value))) continue;
    const [left, top, wordWidth, wordHeight, confidence] = values;
    if (left < 0 || top < 0 || wordWidth <= 0 || wordHeight <= 0 || confidence < 0) continue;
    const key = columns.slice(1, 5).join(':');
    const entries = groups.get(key) || [];
    entries.push({ text: columns.slice(11).join('\t'), confidence, left, top, width: wordWidth, height: wordHeight });
    groups.set(key, entries);
  }
  return [...groups.entries()].map(([regionLabel, words]) => {
    const left = Math.min(...words.map((word) => word.left));
    const top = Math.min(...words.map((word) => word.top));
    const right = Math.min(width, Math.max(...words.map((word) => word.left + word.width)));
    const bottom = Math.min(height, Math.max(...words.map((word) => word.top + word.height)));
    return {
      text: words.map((word) => word.text).join(' '),
      language: 'en',
      confidence: Math.max(0, Math.min(1,
        words.reduce((sum, word) => sum + word.confidence, 0) / words.length / 100)),
      boundingBox: [left / width, top / height, (right - left) / width, (bottom - top) / height],
      regionLabel: `ocr-line:${regionLabel}`,
    } satisfies CaseGraphImageOcrRegion;
  });
};

export const extractCaseGraphLocalImage = async (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  rawBytes: Buffer;
  metadataExtractor: CaseGraphContentExtractor & { extractorType: 'metadata' };
  ocrExtractor: CaseGraphContentExtractor & { extractorType: 'ocr' };
  parseMetadata?: MetadataParser;
  runCommand?: CaseGraphContentCommandRunner;
  tesseractBinary?: string;
  ocrLanguage?: string;
  signal?: AbortSignal;
}): Promise<CaseGraphImageExtractionBundle[]> => {
  if (params.signal?.aborted) throw new Error('case_graph_image_extraction_aborted');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uap-image-extract-'));
  const input = path.join(directory, 'image.bin');
  try {
    await fs.writeFile(input, params.rawBytes, { mode: 0o600, flag: 'wx' });
    const parseMetadata = params.parseMetadata || (async (body: Buffer) => {
      const exifr = await import('exifr');
      return (await exifr.parse(body, {
        pick: [...CASE_GRAPH_IMAGE_EXTRACTION_POLICY.publicMetadataFields],
        translateValues: true,
      })) as Record<string, unknown> | null;
    });
    const parsedMetadata = await parseMetadata(params.rawBytes);
    const metadataFields = Object.entries(parsedMetadata || {})
      .map(([field, value]) => printableMetadata(field, value))
      .filter((value): value is CaseGraphImageMetadataField => value !== null);
    const runCommand = params.runCommand || runCaseGraphBoundedCommand;
    const result = await runCommand({
      binary: params.tesseractBinary || 'tesseract',
      args: [input, 'stdout', '-l', params.ocrLanguage || CASE_GRAPH_LOCAL_IMAGE_EXTRACTION_POLICY.ocrLanguage, 'tsv'],
      timeoutMs: CASE_GRAPH_LOCAL_IMAGE_EXTRACTION_POLICY.timeoutMs,
      maximumOutputBytes: CASE_GRAPH_LOCAL_IMAGE_EXTRACTION_POLICY.maximumOutputBytes,
      signal: params.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(`case_graph_image_extractor_failed:tesseract:${result.exitCode}`);
    }
    return extractCaseGraphImageContent({
      asset: params.asset,
      limitsProfile: params.limitsProfile,
      metadataExtractor: params.metadataExtractor,
      ocrExtractor: params.ocrExtractor,
      metadataFields,
      ocrRegions: parseOcrLines(result.stdout, params.asset.imageWidth!, params.asset.imageHeight!),
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};
