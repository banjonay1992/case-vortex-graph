import { setImmediate as scheduleImmediate } from 'node:timers';

import { afterEach } from 'vitest';

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleLog = console.log.bind(console);
const originalConsoleInfo = console.info.bind(console);
const verboseConsole = process.env.VITEST_VERBOSE_CONSOLE === '1';

const serializeConsoleArgs = (args: unknown[]) =>
  args
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message;
      return String(value ?? '');
    })
    .join(' ');

const hasTestOriginError = (args: unknown[]) =>
  args.some((value) => value instanceof Error && typeof value.stack === 'string' && value.stack.includes('/tests/'));

const shouldSilenceConsoleError = (args: unknown[]) => {
  const message = serializeConsoleArgs(args);
  return (
    (!verboseConsole && hasTestOriginError(args)) ||
    message.includes('A suspended resource finished loading inside a test') ||
    message.includes('Not implemented: navigation to another Document') ||
    message.includes('Not implemented: navigation (except hash changes)') ||
    message.startsWith('OpenAI API error:') ||
    message.startsWith('Cloudflare API error:') ||
    message.startsWith('Error fetching ') ||
    message.startsWith('Failed to start channel imports.') ||
    message.startsWith('Unexpected error on idle client') ||
    message.startsWith('[upload ') ||
    message.startsWith('[search] ') ||
    message.startsWith('[public/') ||
    message.startsWith('[system/') ||
    message.startsWith('[hp] ') ||
    message.startsWith('[adminHp] ') ||
    message.startsWith('[adminOps] ') ||
    message.startsWith('[blog] ') ||
    message.startsWith('[roswell] ') ||
    message.startsWith('[reports/street-annotations:') ||
    message.startsWith('[aviation] ') ||
    message.startsWith('[aviation/') ||
    message.startsWith('[overlay] ') ||
    message.startsWith('[bugs] ') ||
    message.startsWith('[correlation] ') ||
    message.startsWith('[news-feed] ') ||
    message.startsWith('[tracking/') ||
    message.startsWith('[reference] ') ||
    message.startsWith('[reference-sites] ') ||
    message.startsWith('[incident-summary] ') ||
    message.startsWith('[alerts] ') ||
    message.startsWith('[analytics] ') ||
    message.startsWith('[discord] ') ||
    message.startsWith('[videos] ') ||
    message.startsWith('[opensky] ') ||
    message.startsWith('[satellites] ') ||
    message.startsWith('[satellite-tle-archive] ') ||
    message.startsWith('[scheduler] ') ||
    message.startsWith('[r2-lifecycle] ') ||
    message.startsWith('[generate-vector-tiles] ') ||
    message.startsWith('Error updating presence:') ||
    message.startsWith('Error processing ') ||
    message.startsWith('Error ingesting ') ||
    message.startsWith('Error inserting ') ||
    message.startsWith('{"route":') ||
    message.startsWith('{"level":')
  );
};

const shouldSilenceConsoleLog = (args: unknown[]) => {
  const message = serializeConsoleArgs(args);
  return (
    !verboseConsole ||
    message.startsWith('[storage] provider=') ||
    message.includes('"msg":"r2_cache_event"')
  );
};

console.error = (...args: Parameters<typeof console.error>) => {
  if (shouldSilenceConsoleError(args)) return;
  originalConsoleError(...args);
};

console.warn = (...args: Parameters<typeof console.warn>) => {
  if (shouldSilenceConsoleError(args)) return;
  originalConsoleWarn(...args);
};

console.log = (...args: Parameters<typeof console.log>) => {
  if (shouldSilenceConsoleLog(args)) return;
  originalConsoleLog(...args);
};

console.info = (...args: Parameters<typeof console.info>) => {
  if (shouldSilenceConsoleLog(args)) return;
  originalConsoleInfo(...args);
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Several corpus tests intentionally perform long synchronous hashing and
// canonicalization passes. Yielding at the test boundary lets Vitest process
// the worker acknowledgement queued by the previous task before another CPU
// pass begins; without this, Vitest 3 can report a false onTaskUpdate timeout
// even though every assertion completed successfully.
afterEach(async () => {
  await new Promise<void>((resolve) => scheduleImmediate(resolve));
});
