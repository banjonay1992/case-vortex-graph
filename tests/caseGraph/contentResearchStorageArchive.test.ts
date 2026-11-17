import { describe, expect, it, vi } from 'vitest';

import { createCaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchStorageArchive';

describe('R2-compatible immutable full-content archive adapter', () => {
  it('uses a conditional private immutable write with exact content length', async () => {
    const uploadFile = vi.fn(async (_body: Buffer, key: string) => key);
    const readObject = vi.fn(async () => null);
    const archive = createCaseGraphContentImmutableArchive({ uploadFile, readObject });
    const body = Buffer.from('governed evidence bytes');
    await expect(archive.putIfAbsent({
      key: 'case-vortex/content/publications/manifest/captured/digest.bin',
      body,
      contentType: 'application/pdf',
    })).resolves.toBe('written');
    expect(uploadFile).toHaveBeenCalledWith(
      body,
      'case-vortex/content/publications/manifest/captured/digest.bin',
      {
        contentType: 'application/pdf',
        contentLength: body.byteLength,
        cacheControl: 'private, max-age=31536000, immutable',
        ifNoneMatch: '*',
      },
    );
  });

  it('treats only an explicit precondition conflict as an idempotent replay', async () => {
    const alreadyExists = Object.assign(new Error('exists'), {
      code: 'STORAGE_OBJECT_ALREADY_EXISTS',
      statusCode: 412,
    });
    const uploadFile = vi.fn(async () => { throw alreadyExists; });
    const archive = createCaseGraphContentImmutableArchive({
      uploadFile,
      readObject: async () => Buffer.from('existing'),
    });
    await expect(archive.putIfAbsent({
      key: 'case-vortex/content/existing.bin',
      body: Buffer.from('existing'),
      contentType: 'application/octet-stream',
    })).resolves.toBe('exists');

    uploadFile.mockRejectedValueOnce(new Error('r2_unavailable'));
    await expect(archive.putIfAbsent({
      key: 'case-vortex/content/new.bin',
      body: Buffer.from('new'),
      contentType: 'application/octet-stream',
    })).rejects.toThrow('r2_unavailable');
  });

  it('aborts before a write starts', async () => {
    const uploadFile = vi.fn(async (_body: Buffer, key: string) => key);
    const archive = createCaseGraphContentImmutableArchive({
      uploadFile,
      readObject: async () => null,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(archive.putIfAbsent({
      key: 'case-vortex/content/aborted.bin',
      body: Buffer.from('aborted'),
      contentType: 'application/octet-stream',
      signal: controller.signal,
    })).rejects.toThrow('case_graph_content_materialization_aborted');
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
