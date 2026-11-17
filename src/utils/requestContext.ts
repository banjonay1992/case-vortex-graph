import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = {
  requestId: string;
  userId?: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T => {
  return storage.run(context, fn);
};

export const getRequestContext = (): RequestContext | undefined => {
  return storage.getStore();
};

export const setRequestContextUserId = (userId: string | null) => {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.userId = userId;
};
