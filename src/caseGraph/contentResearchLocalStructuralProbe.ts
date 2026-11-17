import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type { CaseGraphContentStructuralProbe } from './contentResearchByteInspection';

export const CASE_GRAPH_LOCAL_STRUCTURAL_PROBE_POLICY = Object.freeze({
  version: 'case-graph-local-structural-probe-v1',
  timeoutMs: 30_000,
  maximumOutputBytes: 256_000,
} as const);

export type CaseGraphContentCommandResult = { exitCode: number; stdout: string; stderr: string };
export type CaseGraphContentCommandRunner = (params: {
  binary: string;
  args: string[];
  timeoutMs: number;
  maximumOutputBytes: number;
  signal?: AbortSignal;
}) => Promise<CaseGraphContentCommandResult>;

export const runCaseGraphBoundedCommand: CaseGraphContentCommandRunner = async (params) => new Promise((resolve, reject) => {
  if (params.signal?.aborted) return reject(new Error('case_graph_structural_probe_aborted'));
  const child = spawn(params.binary, params.args, {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let settled = false;
  const finish = (operation: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', abort);
    operation();
  };
  const kill = () => { try { child.kill('SIGKILL'); } catch { /* best effort */ } };
  const abort = () => finish(() => {
    kill();
    reject(new Error('case_graph_structural_probe_aborted'));
  });
  const timer = setTimeout(() => finish(() => {
    kill();
    reject(new Error('case_graph_structural_probe_timeout'));
  }), params.timeoutMs);
  params.signal?.addEventListener('abort', abort, { once: true });
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > params.maximumOutputBytes) {
      finish(() => {
        kill();
        reject(new Error('case_graph_structural_probe_output_limit'));
      });
      return;
    }
    target.push(Buffer.from(chunk));
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.once('error', (error) => finish(() => reject(error)));
  child.once('close', (exitCode) => finish(() => resolve({
    exitCode: exitCode ?? -1,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  })));
});

const suffixFor = (mimeType: string) => ({
  'application/pdf': '.pdf',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
}[mimeType] || '.bin');

const withPrivateTempFile = async <T>(body: Buffer, suffix: string, operation: (file: string) => Promise<T>) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uap-content-probe-'));
  const file = path.join(directory, `asset${suffix}`);
  try {
    await fs.writeFile(file, body, { mode: 0o600, flag: 'wx' });
    return await operation(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

const positiveInteger = (value: unknown) => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
);

export const createCaseGraphLocalStructuralProbe = (options: {
  runCommand?: CaseGraphContentCommandRunner;
  inspectImage?: (body: Buffer, maximumPixels: number) => Promise<{ width?: number; height?: number }>;
  pdfInfoBinary?: string;
  ffprobeBinary?: string;
  timeoutMs?: number;
  maximumOutputBytes?: number;
} = {}): CaseGraphContentStructuralProbe => async (params) => {
  const runCommand = options.runCommand || runCaseGraphBoundedCommand;
  const command = (binary: string, args: string[]) => runCommand({
    binary,
    args,
    timeoutMs: options.timeoutMs ?? CASE_GRAPH_LOCAL_STRUCTURAL_PROBE_POLICY.timeoutMs,
    maximumOutputBytes: options.maximumOutputBytes
      ?? CASE_GRAPH_LOCAL_STRUCTURAL_PROBE_POLICY.maximumOutputBytes,
    signal: params.signal,
  });
  if (params.sniffed.mediaKind === 'image') {
    try {
      const inspectImage = options.inspectImage || (async (body: Buffer, maximumPixels: number) => {
        const { default: sharp } = await import('sharp');
        return sharp(body, { failOn: 'error', limitInputPixels: maximumPixels }).metadata();
      });
      const metadata = await inspectImage(params.rawBytes, params.limitsProfile.maxImagePixels);
      const imageWidth = positiveInteger(metadata.width);
      const imageHeight = positiveInteger(metadata.height);
      if (!imageWidth || !imageHeight) {
        return { status: 'terminal', terminalStatus: 'corrupt', reason: 'image dimensions are unavailable' };
      }
      if (imageWidth * imageHeight > params.limitsProfile.maxImagePixels) {
        return { status: 'terminal', terminalStatus: 'oversized', reason: 'image exceeds approved pixel limit' };
      }
      return { status: 'ready', pageCount: null, imageWidth, imageHeight, durationMs: null };
    } catch (error) {
      if (params.signal?.aborted) throw new Error('case_graph_structural_probe_aborted');
      return {
        status: 'terminal', terminalStatus: 'corrupt',
        reason: `image parser rejected captured bytes: ${(error as Error).message.slice(0, 200)}`,
      };
    }
  }
  return withPrivateTempFile(params.rawBytes, suffixFor(params.sniffed.mimeType), async (file) => {
    if (params.sniffed.mediaKind === 'document') {
      const result = await command(options.pdfInfoBinary || 'pdfinfo', [file]);
      const combined = `${result.stdout}\n${result.stderr}`;
      if (/encrypted:\s*yes/i.test(combined) || /password|encrypted/i.test(result.stderr)) {
        return { status: 'terminal', terminalStatus: 'encrypted', reason: 'PDF requires decryption credentials' };
      }
      if (result.exitCode !== 0) {
        return { status: 'terminal', terminalStatus: 'corrupt', reason: 'pdfinfo rejected captured PDF bytes' };
      }
      const pageMatch = result.stdout.match(/^Pages:\s*(\d+)\s*$/im);
      const pageCount = positiveInteger(pageMatch ? Number(pageMatch[1]) : null);
      if (!pageCount) {
        return { status: 'terminal', terminalStatus: 'corrupt', reason: 'PDF page count is unavailable' };
      }
      if (pageCount > params.limitsProfile.maxDocumentPages) {
        return { status: 'terminal', terminalStatus: 'oversized', reason: 'PDF exceeds approved page limit' };
      }
      return { status: 'ready', pageCount, imageWidth: null, imageHeight: null, durationMs: null };
    }
    const result = await command(options.ffprobeBinary || 'ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file,
    ]);
    if (result.exitCode !== 0) {
      return { status: 'terminal', terminalStatus: 'corrupt', reason: 'ffprobe rejected captured timed media bytes' };
    }
    let durationSeconds: number;
    try {
      durationSeconds = Number(JSON.parse(result.stdout)?.format?.duration);
    } catch {
      durationSeconds = Number.NaN;
    }
    const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.ceil(durationSeconds * 1_000)
      : null;
    if (!durationMs) {
      return { status: 'terminal', terminalStatus: 'corrupt', reason: 'timed media duration is unavailable' };
    }
    if (durationMs > params.limitsProfile.maxTimedMediaDurationMs) {
      return { status: 'terminal', terminalStatus: 'oversized', reason: 'timed media exceeds duration limit' };
    }
    return { status: 'ready', pageCount: null, imageWidth: null, imageHeight: null, durationMs };
  });
};
