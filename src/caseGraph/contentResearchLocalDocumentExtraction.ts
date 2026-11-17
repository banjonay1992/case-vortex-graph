import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  CaseGraphContentAsset,
  CaseGraphContentExtractor,
  CaseGraphContentLimitsProfile,
} from './contentResearchArchive';
import {
  extractCaseGraphDocumentPages,
  type CaseGraphDocumentExtractionBundle,
  type CaseGraphDocumentPageText,
} from './contentResearchDocumentExtraction';
import {
  CASE_GRAPH_LOCAL_STRUCTURAL_PROBE_POLICY,
  runCaseGraphBoundedCommand,
  type CaseGraphContentCommandRunner,
} from './contentResearchLocalStructuralProbe';

export const CASE_GRAPH_LOCAL_DOCUMENT_EXTRACTION_POLICY = Object.freeze({
  version: 'case-graph-local-document-extraction-v1',
  renderDpi: 200,
  ocrLanguage: 'eng',
  timeoutMsPerCommand: 60_000,
  maximumCommandOutputBytes: 4_000_000,
} as const);

const parseTesseractTsv = (tsv: string): CaseGraphDocumentPageText => {
  const words: string[] = [];
  const confidences: number[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const columns = line.split('\t');
    if (columns.length < 12) continue;
    const text = columns.slice(11).join('\t');
    if (!text.trim()) continue;
    words.push(text);
    const confidence = Number(columns[10]);
    if (Number.isFinite(confidence) && confidence >= 0) confidences.push(confidence);
  }
  const confidence = confidences.length
    ? Math.max(0, Math.min(1, confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100))
    : 0;
  return {
    text: words.join(' '),
    language: 'en',
    confidence,
    warnings: ['OCR text has word-order locators only; bounding boxes are not yet retained'],
  };
};

export const extractCaseGraphLocalPdf = async (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  rawBytes: Buffer;
  embeddedExtractor: CaseGraphContentExtractor & { extractorType: 'embedded' };
  ocrExtractor: CaseGraphContentExtractor & { extractorType: 'ocr' };
  runCommand?: CaseGraphContentCommandRunner;
  pdftotextBinary?: string;
  pdftoppmBinary?: string;
  tesseractBinary?: string;
  ocrLanguage?: string;
  signal?: AbortSignal;
}): Promise<CaseGraphDocumentExtractionBundle[]> => {
  if (params.signal?.aborted) throw new Error('case_graph_document_extraction_aborted');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uap-pdf-extract-'));
  const input = path.join(directory, 'document.pdf');
  const runCommand = params.runCommand || runCaseGraphBoundedCommand;
  const run = async (binary: string, args: string[]) => {
    const result = await runCommand({
      binary,
      args,
      timeoutMs: CASE_GRAPH_LOCAL_DOCUMENT_EXTRACTION_POLICY.timeoutMsPerCommand,
      maximumOutputBytes: CASE_GRAPH_LOCAL_DOCUMENT_EXTRACTION_POLICY.maximumCommandOutputBytes,
      signal: params.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(`case_graph_document_extractor_failed:${binary}:${result.exitCode}`);
    }
    return result;
  };
  try {
    await fs.writeFile(input, params.rawBytes, { mode: 0o600, flag: 'wx' });
    return await extractCaseGraphDocumentPages({
      asset: params.asset,
      limitsProfile: params.limitsProfile,
      embeddedExtractor: params.embeddedExtractor,
      ocrExtractor: params.ocrExtractor,
      signal: params.signal,
      extractEmbeddedPage: async (pageNumber) => {
        const result = await run(params.pdftotextBinary || 'pdftotext', [
          '-f', String(pageNumber), '-l', String(pageNumber), '-enc', 'UTF-8', '-layout', input, '-',
        ]);
        return { text: result.stdout, language: 'en', confidence: null };
      },
      extractOcrPage: async (pageNumber) => {
        const prefix = path.join(directory, `ocr-page-${String(pageNumber).padStart(6, '0')}`);
        await run(params.pdftoppmBinary || 'pdftoppm', [
          '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile',
          '-r', String(CASE_GRAPH_LOCAL_DOCUMENT_EXTRACTION_POLICY.renderDpi), '-png', input, prefix,
        ]);
        const result = await run(params.tesseractBinary || 'tesseract', [
          `${prefix}.png`, 'stdout', '-l', params.ocrLanguage
            || CASE_GRAPH_LOCAL_DOCUMENT_EXTRACTION_POLICY.ocrLanguage, 'tsv',
        ]);
        return parseTesseractTsv(result.stdout);
      },
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

export const CASE_GRAPH_CONTENT_TOOL_EXECUTION_BOUNDARY = Object.freeze({
  structuralProbeVersion: CASE_GRAPH_LOCAL_STRUCTURAL_PROBE_POLICY.version,
  documentExtractionVersion: CASE_GRAPH_LOCAL_DOCUMENT_EXTRACTION_POLICY.version,
} as const);
