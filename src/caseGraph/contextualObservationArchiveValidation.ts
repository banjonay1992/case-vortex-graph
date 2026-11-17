const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function invalid(code: string): never {
  throw new Error(code);
}

export const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function assertPlainObject(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) invalid(code);
}

export const exactKeys = (value: Record<string, unknown>, expected: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(lexical);
  const wanted = [...expected].sort(lexical);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid(code);
};

export const requireId = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid(code);
  return value;
};

export const requireSha = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(code);
  return value;
};

export const requireCount = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(code);
  return Number(value);
};

export const requireTimestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value;
};

export const requireCursor = (value: unknown, code: string): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.length || value.length > 2_000 || /[\r\n]/.test(value)) invalid(code);
  return value;
};

export const parseInput = (input: Buffer | string | unknown, code: string): unknown => {
  if (!Buffer.isBuffer(input) && typeof input !== 'string') return input;
  try {
    return JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  } catch {
    return invalid(code);
  }
};

export const normalizeWindow = (value: unknown, code: string) => {
  assertPlainObject(value, code);
  exactKeys(value, ['start', 'end'], code);
  const start = requireTimestamp(value.start, code);
  const end = requireTimestamp(value.end, code);
  if (Date.parse(end) < Date.parse(start)) invalid(code);
  return { start, end };
};
