import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';

import {
  verifyAdsbLolHistoricalAssetPreflight,
  type AdsbLolHistoricalAssetPreflight,
} from './adsbLolHistoricalAssetPreflight';
import {
  verifyAdsbLolHistoricalReleasePlan,
  type AdsbLolHistoricalReleasePlan,
} from './adsbLolHistoricalReleasePlan';
import {
  makeCaseGraphExternalProviderArchiveRecord,
  type CaseGraphExternalProviderArchiveRecord,
} from './providerArchiveExternalCorrelation';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';

export const ADSB_LOL_HISTORICAL_TARGETED_EXTRACTION_VERSION =
  'adsb-lol-historical-targeted-extraction-v1' as const;

const TAR_BLOCK_BYTES = 512;
const MAX_TARGETS = 10_000;
const MAX_TRACE_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_TRACE_INFLATED_BYTES = 128 * 1024 * 1024;
const MAX_TRACE_POINTS = 2_000_000;
const MAX_CANDIDATES_PER_TARGET = 250;
const TRACE_PATH = /(?:^|\/)traces\/[a-f0-9]{2}\/trace_full_(~?[a-f0-9]{6})\.json$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const fail = (code: string): never => { throw new Error(code); };
const compare = (left: string, right: string) => left.localeCompare(right);

const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== 'string') fail(code);
  const normalized = value as string;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) fail(code);
  return normalized;
};

const finite = (
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < minimum || value > maximum) fail(code);
  return value as number;
};

const radians = (degrees: number) => degrees * Math.PI / 180;
const distanceKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6_371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

class AsyncByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private readonly chunks: Buffer[] = [];
  private available = 0;
  private ended = false;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(bytes: number) {
    while (this.available < bytes && !this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      if (!chunk.length) continue;
      this.chunks.push(chunk);
      this.available += chunk.length;
    }
  }

  async read(bytes: number): Promise<Buffer | null> {
    await this.fill(bytes);
    if (!this.available) return null;
    if (this.available < bytes) fail('adsb_lol_tar_truncated');
    const output = Buffer.allocUnsafe(bytes);
    let offset = 0;
    while (offset < bytes) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.length, bytes - offset);
      chunk.copy(output, offset, 0, take);
      offset += take;
      this.available -= take;
      if (take === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
    }
    return output;
  }

  async discard(bytes: number) {
    let remaining = bytes;
    while (remaining) {
      const amount = Math.min(remaining, 1024 * 1024);
      const chunk = await this.read(amount);
      if (!chunk) fail('adsb_lol_tar_truncated');
      remaining -= (chunk as Buffer).length;
    }
  }

  async requireZeroRemainder() {
    for (const chunk of this.chunks) {
      if (chunk.some((value) => value !== 0)) fail('adsb_lol_tar_trailing_data');
    }
    this.chunks.length = 0;
    this.available = 0;
    while (!this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      if (Buffer.from(next.value).some((value) => value !== 0)) {
        fail('adsb_lol_tar_trailing_data');
      }
    }
  }
}

const tarText = (header: Buffer, start: number, length: number) => {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
};

const tarOctal = (header: Buffer, start: number, length: number) => {
  const raw = tarText(header, start, length).trim().replace(/\0/gu, '');
  if (!raw || !/^[0-7]+$/u.test(raw)) fail('adsb_lol_tar_header_invalid');
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail('adsb_lol_tar_header_invalid');
  return value;
};

const verifyTarHeader = (header: Buffer) => {
  const expected = tarOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) fail('adsb_lol_tar_checksum_invalid');
  const name = tarText(header, 0, 100);
  const prefix = tarText(header, 345, 155);
  const path = prefix ? `${prefix}/${name}` : name;
  if (!path || path.includes('\0') || path.startsWith('/') || path.split('/').includes('..')) {
    fail('adsb_lol_tar_path_invalid');
  }
  return {
    path,
    size: tarOctal(header, 124, 12),
    type: String.fromCharCode(header[156] || 48),
  };
};

type TarTraceEntry = { path: string; aircraftIcao: string; body: Buffer };

async function* readTraceEntries(
  source: AsyncIterable<Uint8Array>,
  onEntry: () => void,
): AsyncGenerator<TarTraceEntry> {
  const reader = new AsyncByteReader(source);
  let zeroBlocks = 0;
  while (true) {
    const header = await reader.read(TAR_BLOCK_BYTES);
    if (!header) fail('adsb_lol_tar_end_missing');
    const headerBytes = header as Buffer;
    if (headerBytes.every((value) => value === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) {
        await reader.requireZeroRemainder();
        return;
      }
      continue;
    }
    if (zeroBlocks) fail('adsb_lol_tar_end_invalid');
    const entry = verifyTarHeader(headerBytes);
    onEntry();
    const padding = (TAR_BLOCK_BYTES - (entry.size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    const traceMatch = entry.type === '0' ? entry.path.match(TRACE_PATH) : null;
    if (traceMatch) {
      if (entry.size < 2 || entry.size > MAX_TRACE_COMPRESSED_BYTES) {
        fail('adsb_lol_trace_entry_size_invalid');
      }
      const body = await reader.read(entry.size);
      if (!body) fail('adsb_lol_tar_truncated');
      const bodyBytes = body as Buffer;
      if (bodyBytes[0] !== 0x1f || bodyBytes[1] !== 0x8b) {
        fail('adsb_lol_trace_gzip_invalid');
      }
      if (padding) await reader.discard(padding);
      yield { path: entry.path, aircraftIcao: traceMatch[1], body: bodyBytes };
    } else {
      await reader.discard(entry.size + padding);
    }
  }
}

const gunzipBounded = (body: Buffer) => new Promise<Buffer>((resolve, reject) => {
  gunzip(body, { maxOutputLength: MAX_TRACE_INFLATED_BYTES }, (error, output) => {
    if (error) reject(new Error('adsb_lol_trace_gzip_invalid'));
    else resolve(output);
  });
});

type TraceObject = {
  icao: string;
  timestamp: number;
  r?: string;
  t?: string;
  trace: unknown[];
};

const decodeTrace = async (entry: TarTraceEntry): Promise<TraceObject> => {
  let value: unknown;
  try {
    const inflated = await gunzipBounded(entry.body);
    value = JSON.parse(inflated.toString('utf8'));
  } catch {
    fail('adsb_lol_trace_json_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('adsb_lol_trace_json_invalid');
  }
  const trace = value as Partial<TraceObject>;
  if (trace.icao !== entry.aircraftIcao
    || typeof trace.timestamp !== 'number'
    || !Number.isFinite(trace.timestamp)
    || trace.timestamp < 0
    || !Array.isArray(trace.trace)
    || trace.trace.length > MAX_TRACE_POINTS
    || (trace.r !== undefined && (typeof trace.r !== 'string' || trace.r.length > 32))
    || (trace.t !== undefined && (typeof trace.t !== 'string' || trace.t.length > 32))) {
    fail('adsb_lol_trace_json_invalid');
  }
  return trace as TraceObject;
};

export type AdsbLolHistoricalExtractionTarget = {
  address: string;
  eventTimestamp: string;
  latitude: number;
  longitude: number;
  temporalWindowSeconds: number;
  radiusKm: number;
  maximumCandidates: number;
};

export type AdsbLolHistoricalTargetedExtraction = {
  recordType: 'adsb_lol_historical_targeted_extraction';
  schemaVersion: typeof ADSB_LOL_HISTORICAL_TARGETED_EXTRACTION_VERSION;
  releasePlanDigest: string;
  preflightDigest: string;
  releaseDate: string;
  extractedAt: string;
  assets: Array<{
    assetUrl: string;
    exactBytes: number;
    sha256: string;
  }>;
  results: Array<{
    address: string;
    status: 'matched' | 'checked_no_match';
    candidates: Array<{
      aircraftIcao: string;
      registration: string | null;
      aircraftType: string | null;
      callsign: string | null;
      positionAt: string;
      latitude: number;
      longitude: number;
      distanceKm: number;
      temporalDeltaSeconds: number;
      altitudeFeet: number | 'ground' | null;
      groundSpeedKnots: number | null;
      trackDegrees: number | null;
      sourceType: string | null;
      tracePath: string;
      candidateDigest: string;
    }>;
  }>;
  accounting: {
    exactArchiveBytes: number;
    tarEntryCount: number;
    traceEntryCount: number;
    tracePointCount: number;
    targetCount: number;
    matchedTargetCount: number;
    candidateCount: number;
  };
  limitations: string[];
  extractionDigest: string;
};

const normalizeTargets = (
  targets: AdsbLolHistoricalExtractionTarget[],
  releaseDate: string,
) => {
  if (!targets.length || targets.length > MAX_TARGETS
    || new Set(targets.map(({ address }) => address)).size !== targets.length) {
    fail('adsb_lol_extraction_targets_invalid');
  }
  return [...targets].sort((left, right) => compare(left.address, right.address)).map((target) => {
    const eventTimestamp = timestamp(target.eventTimestamp, 'adsb_lol_extraction_target_invalid');
    if (!target.address || target.address.length > 500
      || eventTimestamp.slice(0, 10) !== releaseDate
      || !Number.isSafeInteger(target.temporalWindowSeconds)
      || target.temporalWindowSeconds < 1
      || target.temporalWindowSeconds > 86_400
      || !Number.isFinite(target.radiusKm) || target.radiusKm <= 0 || target.radiusKm > 2_000
      || !Number.isSafeInteger(target.maximumCandidates)
      || target.maximumCandidates < 1
      || target.maximumCandidates > MAX_CANDIDATES_PER_TARGET) {
      fail('adsb_lol_extraction_target_invalid');
    }
    return {
      ...target,
      eventTimestamp,
      latitude: finite(target.latitude, -90, 90, 'adsb_lol_extraction_target_invalid'),
      longitude: finite(target.longitude, -180, 180, 'adsb_lol_extraction_target_invalid'),
    };
  });
};

const extractionCore = (
  value: Omit<AdsbLolHistoricalTargetedExtraction, 'extractionDigest'>,
) => value;

type ExtractionCandidate =
  AdsbLolHistoricalTargetedExtraction['results'][number]['candidates'][number];

const compareCandidate = (left: ExtractionCandidate, right: ExtractionCandidate) => (
  left.distanceKm - right.distanceKm
  || left.temporalDeltaSeconds - right.temporalDeltaSeconds
  || compare(left.aircraftIcao, right.aircraftIcao)
  || compare(left.positionAt, right.positionAt)
);

export const extractAdsbLolHistoricalTargets = async (params: {
  releasePlan: AdsbLolHistoricalReleasePlan;
  preflight: AdsbLolHistoricalAssetPreflight;
  releaseDate: string;
  targets: AdsbLolHistoricalExtractionTarget[];
  extractedAt: string;
  assetStreams: Array<{
    assetUrl: string;
    chunks: AsyncIterable<Uint8Array>;
  }>;
}): Promise<AdsbLolHistoricalTargetedExtraction> => {
  const releasePlan = verifyAdsbLolHistoricalReleasePlan(params.releasePlan);
  const extractedAt = timestamp(params.extractedAt, 'adsb_lol_extraction_time_invalid');
  const preflight = verifyAdsbLolHistoricalAssetPreflight(
    params.preflight,
    releasePlan,
    extractedAt,
  );
  if (!DATE.test(params.releaseDate)) fail('adsb_lol_extraction_release_invalid');
  const selected = preflight.selectedReleases.find(({ date }) => date === params.releaseDate);
  const plannedRelease = releasePlan.releases.find(({ date }) => date === params.releaseDate);
  if (!selected || !preflight.accounting.executableWithinExactBudget) {
    fail('adsb_lol_extraction_release_invalid');
  }
  if (!plannedRelease) fail('adsb_lol_extraction_release_invalid');
  const selectedRelease = selected as AdsbLolHistoricalAssetPreflight['selectedReleases'][number];
  const plannedReleaseValue = plannedRelease as AdsbLolHistoricalReleasePlan['releases'][number];
  const targets = normalizeTargets(params.targets, params.releaseDate);
  if (targets.length !== plannedReleaseValue.addresses.length
    || targets.some(
      ({ address }, index) => address !== plannedReleaseValue.addresses[index],
    )) {
    fail('adsb_lol_extraction_target_set_invalid');
  }
  if (params.assetStreams.length !== selectedRelease.assetUrls.length
    || params.assetStreams.some(
      ({ assetUrl }, index) => assetUrl !== selectedRelease.assetUrls[index],
    )) {
    fail('adsb_lol_extraction_asset_set_invalid');
  }
  const observations = new Map(
    preflight.observations.map((observation) => [observation.requestedUrl, observation]),
  );
  const assets: AdsbLolHistoricalTargetedExtraction['assets'] = [];
  async function* archiveBytes() {
    for (const stream of params.assetStreams) {
      const expected = observations.get(stream.assetUrl);
      if (!expected || !selectedRelease.assetUrls.includes(stream.assetUrl)) {
        fail('adsb_lol_extraction_asset_set_invalid');
      }
      const expectedObservation = expected as AdsbLolHistoricalAssetPreflight['observations'][number];
      const hash = createHash('sha256');
      let exactBytes = 0;
      for await (const chunkValue of stream.chunks) {
        const chunk = Buffer.from(chunkValue);
        exactBytes += chunk.length;
        if (!Number.isSafeInteger(exactBytes)
          || exactBytes > expectedObservation.contentLength) {
          fail('adsb_lol_extraction_asset_bytes_invalid');
        }
        hash.update(chunk);
        yield chunk;
      }
      if (exactBytes !== expectedObservation.contentLength) {
        fail('adsb_lol_extraction_asset_bytes_invalid');
      }
      assets.push({ assetUrl: stream.assetUrl, exactBytes, sha256: hash.digest('hex') });
    }
  }
  const candidates = new Map<string, AdsbLolHistoricalTargetedExtraction['results'][number]['candidates']>(
    targets.map(({ address }) => [address, []]),
  );
  const candidateDigests = new Map<string, Set<string>>(
    targets.map(({ address }) => [address, new Set()]),
  );
  let tarEntryCount = 0;
  let traceEntryCount = 0;
  let tracePointCount = 0;
  for await (const entry of readTraceEntries(archiveBytes(), () => { tarEntryCount += 1; })) {
    traceEntryCount += 1;
    const trace = await decodeTrace(entry);
    for (const rawPoint of trace.trace) {
      tracePointCount += 1;
      if (!Array.isArray(rawPoint) || rawPoint.length < 10) {
        fail('adsb_lol_trace_point_invalid');
      }
      const point = rawPoint as unknown[];
      const offset = finite(point[0], -86_400, 172_800, 'adsb_lol_trace_point_invalid');
      const latitude = finite(point[1], -90, 90, 'adsb_lol_trace_point_invalid');
      const longitude = finite(point[2], -180, 180, 'adsb_lol_trace_point_invalid');
      const positionMs = (trace.timestamp + offset) * 1000;
      if (!Number.isFinite(positionMs)) fail('adsb_lol_trace_point_invalid');
      for (const target of targets) {
        const temporalDeltaSeconds = Math.abs(positionMs - Date.parse(target.eventTimestamp)) / 1000;
        if (temporalDeltaSeconds > target.temporalWindowSeconds) continue;
        const separation = distanceKm(target.latitude, target.longitude, latitude, longitude);
        if (separation > target.radiusKm) continue;
        const details = point[8] && typeof point[8] === 'object' && !Array.isArray(point[8])
          ? point[8] as Record<string, unknown> : null;
        const core = {
          aircraftIcao: trace.icao,
          registration: trace.r || null,
          aircraftType: trace.t || null,
          callsign: typeof details?.flight === 'string' ? details.flight.trim() || null : null,
          positionAt: new Date(positionMs).toISOString(),
          latitude,
          longitude,
          distanceKm: Math.round(separation * 1_000) / 1_000,
          temporalDeltaSeconds: Math.round(temporalDeltaSeconds * 1_000) / 1_000,
          altitudeFeet: typeof point[3] === 'number' || point[3] === 'ground'
            ? point[3] as number | 'ground' : null,
          groundSpeedKnots: typeof point[4] === 'number' && Number.isFinite(point[4])
            ? point[4] : null,
          trackDegrees: typeof point[5] === 'number' && Number.isFinite(point[5])
            ? point[5] : null,
          sourceType: typeof point[9] === 'string' ? point[9] : null,
          tracePath: entry.path,
        };
        const candidate = {
          ...core,
          candidateDigest: relationshipInputSha256(core),
        };
        const digests = candidateDigests.get(target.address)!;
        if (digests.has(candidate.candidateDigest)) continue;
        const targetCandidates = candidates.get(target.address)!;
        targetCandidates.push(candidate);
        digests.add(candidate.candidateDigest);
        if (targetCandidates.length > target.maximumCandidates) {
          targetCandidates.sort(compareCandidate);
          const removed = targetCandidates.pop()!;
          digests.delete(removed.candidateDigest);
        }
      }
    }
  }
  if (assets.length !== selectedRelease.assetUrls.length) {
    fail('adsb_lol_extraction_asset_set_invalid');
  }
  const results = targets.map((target) => {
    const matched = candidates.get(target.address)!;
    matched.sort(compareCandidate);
    const limited = matched.slice(0, target.maximumCandidates);
    return {
      address: target.address,
      status: limited.length ? 'matched' as const : 'checked_no_match' as const,
      candidates: limited,
    };
  });
  const candidateCount = results.reduce((sum, result) => sum + result.candidates.length, 0);
  const accounting = {
    exactArchiveBytes: assets.reduce((sum, asset) => sum + asset.exactBytes, 0),
    tarEntryCount,
    traceEntryCount,
    tracePointCount,
    targetCount: targets.length,
    matchedTargetCount: results.filter(({ status }) => status === 'matched').length,
    candidateCount,
  };
  if (accounting.exactArchiveBytes !== selectedRelease.exactDownloadBytes) {
    fail('adsb_lol_extraction_asset_bytes_invalid');
  }
  const core: Omit<AdsbLolHistoricalTargetedExtraction, 'extractionDigest'> = {
    recordType: 'adsb_lol_historical_targeted_extraction',
    schemaVersion: ADSB_LOL_HISTORICAL_TARGETED_EXTRACTION_VERSION,
    releasePlanDigest: releasePlan.planDigest,
    preflightDigest: preflight.preflightDigest,
    releaseDate: params.releaseDate,
    extractedAt,
    assets,
    results,
    accounting,
    limitations: [
      'Candidates are time-and-distance comparisons, not aircraft identifications or explanations.',
      'A checked-no-match result cannot exclude aircraft because receiver, blocking, outage, MLAT and source-coverage gaps remain.',
      'The archive is streamed across exact selected parts; only bounded per-aircraft gzip entries are inflated in memory.',
      'This extraction grants no R2/database write, publication, activation or deployment authority.',
    ],
  };
  return { ...core, extractionDigest: relationshipInputSha256(extractionCore(core)) };
};

export const verifyAdsbLolHistoricalTargetedExtraction = (params: {
  value: AdsbLolHistoricalTargetedExtraction;
  releasePlan: AdsbLolHistoricalReleasePlan;
  preflight: AdsbLolHistoricalAssetPreflight;
  checkedAt: string;
}) => {
  const plan = verifyAdsbLolHistoricalReleasePlan(params.releasePlan);
  const checkedAt = timestamp(params.checkedAt, 'adsb_lol_extraction_verification_time_invalid');
  const value = structuredClone(params.value);
  const extractedAt = timestamp(value.extractedAt, 'adsb_lol_extraction_invalid');
  const preflight = verifyAdsbLolHistoricalAssetPreflight(params.preflight, plan, extractedAt);
  const selected = preflight.selectedReleases.find(({ date }) => date === value.releaseDate);
  const candidateCount = value.results.reduce(
    (sum, result) => sum + result.candidates.length,
    0,
  );
  const candidatesValid = value.results.every((result, resultIndex) => (
    typeof result.address === 'string'
    && result.address.length > 0
    && (resultIndex === 0 || value.results[resultIndex - 1].address < result.address)
    && result.status === (result.candidates.length ? 'matched' : 'checked_no_match')
    && result.candidates.length <= MAX_CANDIDATES_PER_TARGET
    && new Set(result.candidates.map(({ candidateDigest }) => candidateDigest)).size
      === result.candidates.length
    && result.candidates.every((candidate, candidateIndex) => {
      const { candidateDigest, ...core } = candidate;
      return candidateDigest === relationshipInputSha256(core)
        && (candidateIndex === 0
          || compareCandidate(result.candidates[candidateIndex - 1], candidate) <= 0)
        && /^~?[a-f0-9]{6}$/u.test(candidate.aircraftIcao)
        && timestamp(candidate.positionAt, 'adsb_lol_extraction_invalid') === candidate.positionAt
        && Number.isFinite(candidate.latitude) && candidate.latitude >= -90
        && candidate.latitude <= 90
        && Number.isFinite(candidate.longitude) && candidate.longitude >= -180
        && candidate.longitude <= 180
        && Number.isFinite(candidate.distanceKm) && candidate.distanceKm >= 0
        && Number.isFinite(candidate.temporalDeltaSeconds)
        && candidate.temporalDeltaSeconds >= 0
        && TRACE_PATH.test(candidate.tracePath);
    })
  ));
  const assetsValid = Boolean(selected)
    && value.assets.length === selected?.assetUrls.length
    && value.assets.every((asset, index) => (
      asset.assetUrl === selected?.assetUrls[index]
      && Number.isSafeInteger(asset.exactBytes)
      && asset.exactBytes > 0
      && asset.exactBytes
        === preflight.observations.find(({ requestedUrl }) => requestedUrl === asset.assetUrl)
          ?.contentLength
      && /^[a-f0-9]{64}$/u.test(asset.sha256)
    ));
  const { extractionDigest, ...core } = value;
  if (value.recordType !== 'adsb_lol_historical_targeted_extraction'
    || value.schemaVersion !== ADSB_LOL_HISTORICAL_TARGETED_EXTRACTION_VERSION
    || value.releasePlanDigest !== plan.planDigest
    || value.preflightDigest !== preflight.preflightDigest
    || !DATE.test(value.releaseDate)
    || extractedAt !== value.extractedAt
    || Date.parse(checkedAt) < Date.parse(extractedAt)
    || !assetsValid
    || !candidatesValid
    || value.accounting.exactArchiveBytes
      !== value.assets.reduce((sum, asset) => sum + asset.exactBytes, 0)
    || value.accounting.exactArchiveBytes !== selected?.exactDownloadBytes
    || !Number.isSafeInteger(value.accounting.tarEntryCount)
    || value.accounting.tarEntryCount < value.accounting.traceEntryCount
    || !Number.isSafeInteger(value.accounting.traceEntryCount)
    || value.accounting.traceEntryCount < 0
    || !Number.isSafeInteger(value.accounting.tracePointCount)
    || value.accounting.tracePointCount < 0
    || value.accounting.targetCount !== value.results.length
    || value.accounting.matchedTargetCount
      !== value.results.filter(({ status }) => status === 'matched').length
    || value.accounting.candidateCount !== candidateCount
    || !Array.isArray(value.limitations)
    || !value.limitations.length
    || value.limitations.some((limitation) => typeof limitation !== 'string' || !limitation)
    || extractionDigest !== relationshipInputSha256(extractionCore(core))) {
    fail('adsb_lol_extraction_invalid');
  }
  return value;
};

export type AdsbLolHistoricalExtractionPublicationNode = {
  address: string;
  nodeDigest: string;
};

export const buildAdsbLolHistoricalProviderRecords = (params: {
  publication: CaseGraphResearchPublicationBinding;
  snapshotId: string;
  releasePlan: AdsbLolHistoricalReleasePlan;
  preflight: AdsbLolHistoricalAssetPreflight;
  extraction: AdsbLolHistoricalTargetedExtraction;
  nodes: AdsbLolHistoricalExtractionPublicationNode[];
  checkedAt: string;
}): CaseGraphExternalProviderArchiveRecord[] => {
  const extraction = verifyAdsbLolHistoricalTargetedExtraction({
    value: params.extraction,
    releasePlan: params.releasePlan,
    preflight: params.preflight,
    checkedAt: params.checkedAt,
  });
  if (!params.releasePlan.publication
    || params.publication.publicationId !== params.releasePlan.publication.publicationId
    || params.publication.manifestSha256 !== params.releasePlan.publication.manifestSha256
    || !params.nodes.length
    || params.nodes.length !== extraction.results.length
    || new Set(params.nodes.map(({ address }) => address)).size !== params.nodes.length) {
    fail('adsb_lol_extraction_provider_record_plan_invalid');
  }
  const nodes = [...params.nodes].sort((left, right) => compare(left.address, right.address));
  if (nodes.some((node, index) => (
    node.address !== extraction.results[index].address
    || !/^[a-f0-9]{64}$/u.test(node.nodeDigest)
  ))) {
    fail('adsb_lol_extraction_provider_record_plan_invalid');
  }
  return extraction.results.map((result, index) => {
    const node = nodes[index];
    const candidates = result.candidates.map((candidate) => ({
      sourceRecordId:
        `adsb-lol-history:${extraction.extractionDigest}:${candidate.candidateDigest}`,
      label: candidate.callsign
        ? `${candidate.callsign} (${candidate.aircraftIcao.toUpperCase()})`
        : candidate.registration
          ? `${candidate.registration} (${candidate.aircraftIcao.toUpperCase()})`
          : `Aircraft ${candidate.aircraftIcao.toUpperCase()}`,
      observedAt: candidate.positionAt,
      measurements: {
        distance_km: candidate.distanceKm,
        time_delta_minutes: Math.round(candidate.temporalDeltaSeconds / 60 * 1_000) / 1_000,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        altitude_ft: candidate.altitudeFeet,
        ground_speed_knots: candidate.groundSpeedKnots,
        track_degrees: candidate.trackDegrees,
        aircraft_icao: candidate.aircraftIcao,
        registration: candidate.registration,
        aircraft_type: candidate.aircraftType,
        position_source_type: candidate.sourceType,
        trace_path_sha256: relationshipInputSha256(candidate.tracePath),
      },
      reasonCodes: [
        'archived_adsb_trace_position',
        'bounded_spatiotemporal_match',
        'candidate_not_identification',
      ],
      explanation: `This archived ADSB.lol trace position is ${candidate.distanceKm.toFixed(1)} km and ${(candidate.temporalDeltaSeconds / 60).toFixed(1)} minutes from the report. It is a comparison candidate, not proof that the aircraft caused or explains the sighting.`,
      uncertainty: extraction.limitations,
    }));
    return makeCaseGraphExternalProviderArchiveRecord({
      snapshotId: params.snapshotId,
      publicationId: params.publication.publicationId,
      address: node.address,
      nodeDigest: node.nodeDigest,
      availability: 'available',
      reasonCodes: result.status === 'matched'
        ? [
          'bounded_aircraft_candidates_available',
          'aircraft_receiver_coverage_incomplete',
          'historical_adsb_trace_checked',
        ]
        : [
          'bounded_aircraft_window_checked_no_candidate',
          'aircraft_receiver_coverage_incomplete',
          'historical_adsb_trace_checked',
        ],
      explanation: result.status === 'matched'
        ? `${candidates.length} archived aircraft comparison${candidates.length === 1 ? '' : 's'} met the declared time-and-distance bounds. They are candidates, not identifications or causal conclusions.`
        : 'The complete selected ADSB.lol day archive was checked within the declared time-and-distance bounds and contained no candidate. Receiver, blocking, outage and MLAT gaps mean aircraft are not ruled out.',
      candidates,
    });
  });
};
