import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { makeCaseGraphContentLimitsProfile } from '../../src/caseGraph/contentResearchArchive';
import { createCaseGraphLocalStructuralProbe } from '../../src/caseGraph/contentResearchLocalStructuralProbe';

const limitsProfile = makeCaseGraphContentLimitsProfile({
  profileId: 'local-probe-limits', maxAssetBytes: 10_000, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 1_000,
  maxTotalTextBytesPerAsset: 10_000, maxChunksPerAsset: 100,
});

describe('bounded local structural probe', () => {
  it('uses an argv-only PDF probe, parses page count and removes private temp files', async () => {
    let observedFile = '';
    const runCommand = vi.fn(async ({ args }: { args: string[] }) => {
      observedFile = args[0];
      await expect(access(observedFile)).resolves.toBeUndefined();
      return { exitCode: 0, stdout: 'Pages:          3\nEncrypted:      no\n', stderr: '' };
    });
    const probe = createCaseGraphLocalStructuralProbe({ runCommand });
    await expect(probe({
      rawBytes: Buffer.from('%PDF-1.7\nfixture'),
      sniffed: { mimeType: 'application/pdf', mediaKind: 'document' }, limitsProfile,
    })).resolves.toEqual({ status: 'ready', pageCount: 3, imageWidth: null, imageHeight: null, durationMs: null });
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      binary: 'pdfinfo', args: [observedFile], timeoutMs: 30_000, maximumOutputBytes: 256_000,
    }));
    await expect(access(observedFile)).rejects.toThrow();
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('uap-content-probe-'))).toEqual([]);
  });

  it('classifies encrypted PDFs and enforces page, pixel and duration limits', async () => {
    const encryptedProbe = createCaseGraphLocalStructuralProbe({
      runCommand: async () => ({ exitCode: 1, stdout: 'Encrypted: yes', stderr: 'password required' }),
    });
    await expect(encryptedProbe({
      rawBytes: Buffer.from('%PDF-1.7\nfixture'),
      sniffed: { mimeType: 'application/pdf', mediaKind: 'document' }, limitsProfile,
    })).resolves.toMatchObject({ status: 'terminal', terminalStatus: 'encrypted' });

    const imageProbe = createCaseGraphLocalStructuralProbe({
      inspectImage: async () => ({ width: 2_000, height: 2_000 }),
    });
    await expect(imageProbe({
      rawBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      sniffed: { mimeType: 'image/jpeg', mediaKind: 'image' }, limitsProfile,
    })).resolves.toMatchObject({ status: 'terminal', terminalStatus: 'oversized' });

    const mediaProbe = createCaseGraphLocalStructuralProbe({
      runCommand: async () => ({ exitCode: 0, stdout: '{"format":{"duration":"61.001"}}', stderr: '' }),
    });
    await expect(mediaProbe({
      rawBytes: Buffer.from('xxxxftypisom'),
      sniffed: { mimeType: 'video/mp4', mediaKind: 'video' }, limitsProfile,
    })).resolves.toMatchObject({ status: 'terminal', terminalStatus: 'oversized' });
  });

  it('reports corrupt parser output and propagates cancellation', async () => {
    const corrupt = createCaseGraphLocalStructuralProbe({
      runCommand: async () => ({ exitCode: 0, stdout: '{}', stderr: '' }),
    });
    await expect(corrupt({
      rawBytes: Buffer.from('xxxxftypisom'),
      sniffed: { mimeType: 'video/mp4', mediaKind: 'video' }, limitsProfile,
    })).resolves.toMatchObject({ status: 'terminal', terminalStatus: 'corrupt' });

    const controller = new AbortController();
    controller.abort();
    const aborted = createCaseGraphLocalStructuralProbe();
    await expect(aborted({
      rawBytes: Buffer.from('%PDF-1.7\nfixture'),
      sniffed: { mimeType: 'application/pdf', mediaKind: 'document' }, limitsProfile,
      signal: controller.signal,
    })).rejects.toThrow('case_graph_structural_probe_aborted');
  });
});
