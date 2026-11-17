import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import {
  makeCaseGraphContentAsset,
  makeCaseGraphContentLimitsProfile,
  type CaseGraphContentExtractor,
} from '../../src/caseGraph/contentResearchArchive';
import { extractCaseGraphLocalPdf } from '../../src/caseGraph/contentResearchLocalDocumentExtraction';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'local-pdf-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-local-pdf', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'local-pdf-limits', maxAssetBytes: 10_000, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 100,
  maxTotalTextBytesPerAsset: 1_000, maxChunksPerAsset: 100,
});
const asset = makeCaseGraphContentAsset({
  publication, address: 'document:00000000-0000-4000-8000-000000000010', nodeDigest: digest('6'),
  sourceAssetKey: 'canonical-url:https://example.test/document.pdf', mediaKind: 'document',
  claimedMimeType: 'application/octet-stream', sniffedMimeType: 'application/pdf', byteLength: 100,
  bytesSha256: digest('7'), capturedObjectKey: 'captured/document.bin', capturedObjectSha256: digest('7'),
  searchableObjectKey: 'captured/document.bin', searchableBytesSha256: digest('7'), pageCount: 2,
  imageWidth: null, imageHeight: null, durationMs: null, sourceLocatorDigest: digest('8'),
  sourceLineageDigest: digest('9'), visibility: 'public', rightsPolicyVersion: 'rights-v1',
  rightsEvidenceDigest: digest('a'), safetyPolicyVersion: 'safety-v1', safetyScanDigest: digest('b'),
  redactionPolicyDigest: digest('c'), redactionStatus: 'not_required', redactionTransformationDigest: null,
  terminalStatus: 'extracted', terminalReason: 'fixture',
});
const extractor = (extractorType: 'embedded' | 'ocr', hash: string) => ({
  extractorType, extractorId: `${extractorType}-local`, extractorVersion: '1.0.0',
  containerDigest: digest(hash), modelId: extractorType === 'ocr' ? 'tesseract-eng' : null,
  modelRevision: extractorType === 'ocr' ? '5.x' : null, configDigest: digest('e'), promptDigest: null,
  humanProvenanceDigest: null, languageDetectorVersion: 'fixed-en-v1',
} satisfies CaseGraphContentExtractor & { extractorType: typeof extractorType });

describe('local Poppler and Tesseract PDF adapter', () => {
  it('uses bounded argv calls, OCRs only blank pages and always removes source/render files', async () => {
    let sourcePath = '';
    let renderedPath = '';
    const runCommand = vi.fn(async (request: { binary: string; args: string[] }) => {
      expect(request.args.every((argument) => typeof argument === 'string')).toBe(true);
      if (request.binary === 'pdftotext') {
        sourcePath = request.args.at(-2)!;
        await expect(access(sourcePath)).resolves.toBeUndefined();
        return { exitCode: 0, stdout: request.args[1] === '1' ? 'embedded page one' : '', stderr: '' };
      }
      if (request.binary === 'pdftoppm') {
        renderedPath = `${request.args.at(-1)}.png`;
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return {
        exitCode: 0,
        stdout: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t90\tscanned\n5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t80\tpage',
        stderr: '',
      };
    });
    const bundles = await extractCaseGraphLocalPdf({
      asset, limitsProfile, rawBytes: Buffer.from('%PDF-1.7\nfixture'),
      embeddedExtractor: extractor('embedded', 'd'), ocrExtractor: extractor('ocr', 'f'), runCommand,
    });
    expect(bundles.map(({ contract }) => contract.textOrigin).sort()).toEqual(['embedded_text', 'ocr']);
    expect(bundles.find(({ contract }) => contract.textOrigin === 'ocr')?.chunks[0]).toMatchObject({
      text: 'scanned page', confidence: 0.85,
    });
    expect(runCommand.mock.calls.map(([request]) => request.binary)).toEqual([
      'pdftotext', 'pdftotext', 'pdftoppm', 'tesseract',
    ]);
    await expect(access(sourcePath)).rejects.toThrow();
    await expect(access(renderedPath)).rejects.toThrow();
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('uap-pdf-extract-'))).toEqual([]);
  });

  it('cleans up and rejects a non-zero tool exit', async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: 'bad PDF' }));
    await expect(extractCaseGraphLocalPdf({
      asset, limitsProfile, rawBytes: Buffer.from('%PDF-1.7\nfixture'),
      embeddedExtractor: extractor('embedded', 'd'), ocrExtractor: extractor('ocr', 'f'), runCommand,
    })).rejects.toThrow('case_graph_document_extractor_failed:pdftotext:2');
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('uap-pdf-extract-'))).toEqual([]);
  });
});
