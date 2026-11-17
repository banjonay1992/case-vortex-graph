type DbErrorDetails = {
  codes: string[];
  message: string;
};

const getDbErrorDetails = (err: unknown): DbErrorDetails => {
  const codes: string[] = [];
  const messages: string[] = [];

  const visit = (value: unknown, depth = 0) => {
    if (!value || depth > 3) return;
    if (typeof value === 'string') {
      messages.push(value);
      return;
    }
    if (typeof value !== 'object') return;

    const asAny = value as Record<string, unknown>;
    if (typeof asAny.code === 'string' && asAny.code.trim()) {
      codes.push(asAny.code.trim().toUpperCase());
    }
    if (typeof asAny.message === 'string' && asAny.message) {
      messages.push(asAny.message);
    }

    for (const nested of [asAny.details, asAny.hint, asAny.error, asAny.cause, asAny.originalError]) {
      visit(nested, depth + 1);
    }
  };

  visit(err);
  return {
    codes,
    message: messages.join(' ').toLowerCase(),
  };
};

export const isDbQueryReadTimeoutError = (err: unknown): boolean =>
  getDbErrorDetails(err).message.includes('query read timeout');

/**
 * Identifies a broken PostgreSQL session or network connection.
 *
 * Capacity pressure and query cancellation are deliberately excluded. A 57014
 * statement timeout, 53300 connection limit, or local pool wait limit does not
 * mean the other sessions owned by the Pool are unusable.
 */
export const isDbConnectionError = (err: unknown): boolean => {
  const { codes, message } = getDbErrorDetails(err);

  if (codes.some((code) => ['57014', '53300', 'DB_POOL_WAITING_LIMIT'].includes(code))) return false;
  if (message.includes('query read timeout')) return false;
  if (message.includes('timeout exceeded when trying to connect')) return false;
  if (codes.includes('XX000') && message.includes('maxclientsinsessionmode')) return false;

  if (codes.some((code) => code.startsWith('08'))) return true;
  if (codes.some((code) => ['57P01', '57P02', '57P03'].includes(code))) return true;
  if (codes.some((code) => [
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
  ].includes(code))) return true;
  if (codes.includes('XX000') && message.includes('dbhandler exited')) return true;

  return (
    message.includes('connection terminated') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('server closed connection unexpectedly') ||
    message.includes('terminating connection due to administrator command') ||
    message.includes('connection refused') ||
    message.includes('socket hang up') ||
    message.includes('read econnreset') ||
    message.includes('write epipe') ||
    message.includes('dbhandler exited')
  );
};

export const isDbOverloadedError = (err: unknown): boolean => {
  const { codes, message } = getDbErrorDetails(err);

  if (codes.includes('57014')) return true; // statement timeout / query canceled
  if (codes.includes('53300')) return true; // too_many_connections
  if (codes.includes('DB_POOL_WAITING_LIMIT')) return true;
  if (codes.includes('XX000') && message.includes('maxclientsinsessionmode')) return true;

  return (
    message.includes('database pool is saturated') ||
    message.includes('statement timeout') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('max clients reached') ||
    message.includes('maxclientsinsessionmode') ||
    message.includes('too many clients already') ||
    message.includes('remaining connection slots are reserved') ||
    message.includes('query read timeout') ||
    message.includes('terminating connection due to administrator command')
  );
};
