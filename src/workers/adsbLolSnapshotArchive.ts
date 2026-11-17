import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';

import type { OpenSkyStateRow } from './openskyWorkerShared';

const ARCHIVE_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;

export type AdsbLolArchiveTileResult = {
  label: string;
  ok: boolean;
  rowCount: number;
  error?: string;
  durationMs: number;
};

type ArchiveLimits = {
  maxRows: number;
  maxUncompressedBytes: number;
  maxCompressedBytes: number;
};

type ArchiveStorage = {
  uploadFile: (
    body: Buffer,
    key: string,
    options: {
      contentType: string;
      contentEncoding?: string;
      cacheControl: string;
      contentLength: number;
    },
  ) => Promise<string>;
  readObject: (key: string) => Promise<Buffer | null>;
};

type BuildArchiveParams = {
  snapshotTime: Date;
  rows: readonly OpenSkyStateRow[];
  tileResults: readonly AdsbLolArchiveTileResult[];
  limits?: Partial<ArchiveLimits>;
};

const parseBoundedInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
};

export const getAdsbLolArchiveLimits = (env: NodeJS.ProcessEnv = process.env): ArchiveLimits => ({
  maxRows: parseBoundedInteger(env.ADSBLOL_ARCHIVE_MAX_ROWS, DEFAULT_MAX_ROWS, 1_000, 500_000),
  maxUncompressedBytes: parseBoundedInteger(
    env.ADSBLOL_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_UNCOMPRESSED_BYTES,
    1024 * 1024,
    512 * 1024 * 1024,
  ),
  maxCompressedBytes: parseBoundedInteger(
    env.ADSBLOL_ARCHIVE_MAX_COMPRESSED_BYTES,
    DEFAULT_MAX_COMPRESSED_BYTES,
    1024 * 1024,
    256 * 1024 * 1024,
  ),
});

export const buildAdsbLolArchiveKeys = (snapshotTime: Date) => {
  const year = snapshotTime.getUTCFullYear();
  const month = String(snapshotTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(snapshotTime.getUTCDate()).padStart(2, '0');
  const timestampMs = snapshotTime.getTime();
  if (!Number.isFinite(timestampMs)) throw new Error('ADSB.lol archive snapshot time is invalid');
  const timestamp = Math.floor(timestampMs / 1000);
  const prefix = `correlation/archive/aircraft/v1/adsblol/${year}/${month}/${day}/states_${timestamp}`;
  return {
    archiveKey: `${prefix}.ndjson.gz`,
    manifestKey: `${prefix}.manifest.json`,
  };
};

export const buildAdsbLolSnapshotArchive = async (params: BuildArchiveParams) => {
  const limits = { ...getAdsbLolArchiveLimits(), ...params.limits };
  if (params.rows.length > limits.maxRows) {
    throw new Error(`ADSB.lol archive row limit exceeded (${params.rows.length} > ${limits.maxRows})`);
  }

  const snapshotIso = params.snapshotTime.toISOString();
  const { archiveKey, manifestKey } = buildAdsbLolArchiveKeys(params.snapshotTime);
  const sortedRows = [...params.rows].sort((left, right) => left.icao24.localeCompare(right.icao24));
  const sortedTileResults = [...params.tileResults].sort((left, right) => left.label.localeCompare(right.label));
  const successCount = sortedTileResults.filter((tile) => tile.ok).length;
  const manifestRecord = {
    record_type: 'manifest',
    schema_version: ARCHIVE_SCHEMA_VERSION,
    provider: 'adsblol',
    source_url: 'https://api.adsb.lol',
    license: 'ODbL-1.0',
    license_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    snapshot_time: snapshotIso,
    row_count: sortedRows.length,
    tile_count: sortedTileResults.length,
    tile_success_count: successCount,
    tile_failure_count: sortedTileResults.length - successCount,
    tile_results: sortedTileResults,
  } as const;

  let uncompressedBytes = 0;
  const toLine = (value: unknown) => {
    const line = `${JSON.stringify(value)}\n`;
    uncompressedBytes += Buffer.byteLength(line, 'utf8');
    if (uncompressedBytes > limits.maxUncompressedBytes) {
      throw new Error(
        `ADSB.lol archive uncompressed byte limit exceeded (${uncompressedBytes} > ${limits.maxUncompressedBytes})`,
      );
    }
    return line;
  };

  async function* archiveLines() {
    yield toLine(manifestRecord);
    for (const row of sortedRows) {
      yield toLine({ record_type: 'state', ...row });
    }
  }

  const compressedChunks: Buffer[] = [];
  let compressedBytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      compressedBytes += buffer.length;
      if (compressedBytes > limits.maxCompressedBytes) {
        callback(new Error(
          `ADSB.lol archive compressed byte limit exceeded (${compressedBytes} > ${limits.maxCompressedBytes})`,
        ));
        return;
      }
      compressedChunks.push(buffer);
      callback();
    },
  });
  await pipeline(Readable.from(archiveLines()), createGzip({ level: 6 }), sink);

  const archiveBody = Buffer.concat(compressedChunks, compressedBytes);
  const archiveSha256 = createHash('sha256').update(archiveBody).digest('hex');
  const manifest = {
    ...manifestRecord,
    archive_key: archiveKey,
    archive_content_type: 'application/x-ndjson',
    archive_content_encoding: 'gzip',
    uncompressed_bytes: uncompressedBytes,
    compressed_bytes: archiveBody.length,
    compressed_sha256: archiveSha256,
  } as const;
  const manifestBody = Buffer.from(`${JSON.stringify(manifest)}\n`);

  return {
    archiveKey,
    manifestKey,
    archiveBody,
    manifestBody,
    manifest,
  };
};

export const uploadAdsbLolSnapshotArchive = async (
  storage: ArchiveStorage,
  params: BuildArchiveParams,
) => {
  const built = await buildAdsbLolSnapshotArchive(params);
  const cacheControl = 'private, max-age=31536000, immutable';
  await storage.uploadFile(built.archiveBody, built.archiveKey, {
    contentType: built.manifest.archive_content_type,
    contentEncoding: built.manifest.archive_content_encoding,
    cacheControl,
    contentLength: built.archiveBody.length,
  });
  await storage.uploadFile(built.manifestBody, built.manifestKey, {
    contentType: 'application/json',
    cacheControl,
    contentLength: built.manifestBody.length,
  });

  const [uploadedArchive, uploadedManifest] = await Promise.all([
    storage.readObject(built.archiveKey),
    storage.readObject(built.manifestKey),
  ]);
  if (!uploadedArchive || !uploadedManifest) {
    throw new Error('ADSB.lol archive read-after-write verification failed: object missing');
  }
  const uploadedSha256 = createHash('sha256').update(uploadedArchive).digest('hex');
  if (
    uploadedArchive.length !== built.manifest.compressed_bytes
    || uploadedSha256 !== built.manifest.compressed_sha256
  ) {
    throw new Error('ADSB.lol archive read-after-write verification failed: checksum mismatch');
  }
  if (!uploadedManifest.equals(built.manifestBody)) {
    throw new Error('ADSB.lol archive read-after-write verification failed: manifest mismatch');
  }
  const archivedLines = gunzipSync(uploadedArchive).toString('utf8').trim().split('\n');
  if (archivedLines.length !== built.manifest.row_count + 1) {
    throw new Error('ADSB.lol archive read-after-write verification failed: row count mismatch');
  }
  return built;
};
