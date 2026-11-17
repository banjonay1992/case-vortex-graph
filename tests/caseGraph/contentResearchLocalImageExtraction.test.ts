import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { extractCaseGraphLocalImage } from '../../src/caseGraph/contentResearchLocalImageExtraction';
import { imageAsset, imageExtractor, imageLimits } from './contentResearchImageFixtures';

describe('local EXIF and image OCR adapter', () => {
  it('allowlists public metadata, produces normalized OCR boxes and removes the private source file', async () => {
    let inputPath = '';
    const runCommand = vi.fn(async (request: { args: string[] }) => {
      inputPath = request.args[0];
      await expect(access(inputPath)).resolves.toBeUndefined();
      return {
        exitCode: 0,
        stdout: [
          'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
          '5\t1\t1\t1\t1\t1\t10\t10\t20\t10\t90\tbright',
          '5\t1\t1\t1\t1\t2\t35\t10\t25\t10\t80\torb',
        ].join('\n'),
        stderr: '',
      };
    });
    const bundles = await extractCaseGraphLocalImage({
      asset: imageAsset, limitsProfile: imageLimits, rawBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      metadataExtractor: imageExtractor('metadata', 'd'), ocrExtractor: imageExtractor('ocr', 'f'),
      parseMetadata: async () => ({ Make: 'Maker', GPSLatitude: 51.5, OwnerName: 'private' }),
      runCommand,
    });
    const metadata = bundles.find(({ contract }) => contract.textOrigin === 'exif')!;
    expect(metadata.chunks.map(({ locator, text }) => [locator, text])).toEqual([
      [{ locatorType: 'exif_field', field: 'Make' }, 'Maker'],
    ]);
    const ocr = bundles.find(({ contract }) => contract.textOrigin === 'frame_ocr')!;
    expect(ocr.chunks[0]).toMatchObject({
      text: 'bright o', confidence: 0.85,
      locator: { locatorType: 'image_region', boundingBox: [0.1, 0.2, 0.5, 0.2] },
    });
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      binary: 'tesseract', timeoutMs: 60_000, maximumOutputBytes: 4_000_000,
    }));
    await expect(access(inputPath)).rejects.toThrow();
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('uap-image-extract-'))).toEqual([]);
  });

  it('cleans up on tool failure and honours cancellation before writing', async () => {
    await expect(extractCaseGraphLocalImage({
      asset: imageAsset, limitsProfile: imageLimits, rawBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      metadataExtractor: imageExtractor('metadata', 'd'), ocrExtractor: imageExtractor('ocr', 'f'),
      parseMetadata: async () => ({}),
      runCommand: async () => ({ exitCode: 2, stdout: '', stderr: 'failure' }),
    })).rejects.toThrow('case_graph_image_extractor_failed:tesseract:2');
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('uap-image-extract-'))).toEqual([]);

    const controller = new AbortController();
    controller.abort();
    await expect(extractCaseGraphLocalImage({
      asset: imageAsset, limitsProfile: imageLimits, rawBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      metadataExtractor: imageExtractor('metadata', 'd'), ocrExtractor: imageExtractor('ocr', 'f'),
      signal: controller.signal,
    })).rejects.toThrow('case_graph_image_extraction_aborted');
  });
});
