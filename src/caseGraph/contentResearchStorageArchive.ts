import type { CaseGraphContentImmutableArchive } from './contentResearchMaterialization';

export type CaseGraphContentStorageClient = {
  uploadFile: (
    body: Buffer,
    key: string,
    options: {
      contentType: string;
      contentLength: number;
      cacheControl: string;
      ifNoneMatch: '*';
    },
  ) => Promise<string>;
  readObject: (
    key: string,
    options: { maxBytes: number; signal?: AbortSignal },
  ) => Promise<Buffer | null>;
};

const alreadyExists = (error: unknown) => {
  const value = error as { code?: unknown; statusCode?: unknown; name?: unknown };
  return value?.code === 'STORAGE_OBJECT_ALREADY_EXISTS'
    || value?.statusCode === 412
    || value?.name === 'StorageObjectAlreadyExistsError';
};

export const createCaseGraphContentImmutableArchive = (
  storage: CaseGraphContentStorageClient,
): CaseGraphContentImmutableArchive => ({
  putIfAbsent: async ({ key, body, contentType, signal }) => {
    if (signal?.aborted) throw new Error('case_graph_content_materialization_aborted');
    try {
      const writtenKey = await storage.uploadFile(body, key, {
        contentType,
        contentLength: body.byteLength,
        cacheControl: 'private, max-age=31536000, immutable',
        ifNoneMatch: '*',
      });
      if (writtenKey !== key) throw new Error('case_graph_content_materialization_storage_key_mismatch');
      if (signal?.aborted) throw new Error('case_graph_content_materialization_aborted');
      return 'written';
    } catch (error) {
      if (alreadyExists(error)) return 'exists';
      throw error;
    }
  },
  readObject: (key, options) => storage.readObject(key, options),
});
