import { createHash } from 'node:crypto';

import {
  CASE_GRAPH_CONTENT_ASSET_TERMINAL_STATUSES,
  verifyCaseGraphContentDiscoveryManifest,
  makeCaseGraphContentAsset,
  type CaseGraphContentAsset,
  type CaseGraphContentAssetTerminalStatus,
  type CaseGraphContentDiscoveryManifest,
  type CaseGraphContentDiscoveryRecord,
  type CaseGraphContentLimitsProfile,
} from './contentResearchArchive';

export const CASE_GRAPH_CONTENT_MATERIALIZATION_POLICY = Object.freeze({
  version: 'case-graph-content-materialization-v1',
  maximumConcurrentAssets: 2,
  maximumSearchableBytesMultiplier: 1,
  objectPrefix: 'case-vortex/content',
} as const);

type ContentFacts = {
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  durationMs: number | null;
};

export type CaseGraphContentRightsDecision = {
  allowed: boolean;
  policyVersion: string;
  evidenceDigest: string;
  reason: string;
};

export type CaseGraphContentProcessedAsset = {
  status: 'ready';
  rawBytes: Buffer;
  searchableBytes: Buffer;
  sniffedMimeType: string;
  facts: ContentFacts;
  safetyPolicyVersion: string;
  safetyScanDigest: string;
  redactionPolicyDigest: string;
  redactionStatus: 'not_required' | 'applied';
  redactionTransformationDigest: string | null;
  terminalReason: string;
} | {
  status: 'terminal';
  terminalStatus: Exclude<CaseGraphContentAssetTerminalStatus, 'extracted' | 'rights_blocked'>;
  terminalReason: string;
  sniffedMimeType: string;
  safetyPolicyVersion: string;
  safetyScanDigest: string | null;
  redactionPolicyDigest: string;
};

export type CaseGraphContentImmutableArchive = {
  putIfAbsent: (params: {
    key: string;
    body: Buffer;
    contentType: string;
    signal?: AbortSignal;
  }) => Promise<'written' | 'exists'>;
  readObject: (key: string, options: { maxBytes: number; signal?: AbortSignal }) => Promise<Buffer | null>;
};

const fail = (code: string): never => { throw new Error(code); };
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const positiveFact = (value: number | null) => value === null
  || (Number.isSafeInteger(value) && value > 0);

const factsAreValid = (
  record: CaseGraphContentDiscoveryRecord,
  facts: ContentFacts,
  limits: CaseGraphContentLimitsProfile,
) => {
  if (!positiveFact(facts.pageCount) || !positiveFact(facts.imageWidth)
    || !positiveFact(facts.imageHeight) || !positiveFact(facts.durationMs)) return false;
  if (record.mediaKind === 'document') {
    return facts.pageCount !== null && facts.pageCount <= limits.maxDocumentPages
      && facts.imageWidth === null && facts.imageHeight === null && facts.durationMs === null;
  }
  if (record.mediaKind === 'image') {
    return facts.pageCount === null && facts.imageWidth !== null && facts.imageHeight !== null
      && facts.durationMs === null
      && facts.imageWidth * facts.imageHeight <= limits.maxImagePixels;
  }
  return facts.pageCount === null && facts.imageWidth === null && facts.imageHeight === null
    && facts.durationMs !== null && facts.durationMs <= limits.maxTimedMediaDurationMs;
};

const objectKey = (manifestSha256: string, role: 'captured' | 'searchable', digest: string) => (
  `${CASE_GRAPH_CONTENT_MATERIALIZATION_POLICY.objectPrefix}/publications/${manifestSha256}/${role}/${digest}.bin`
);

const persistExactBytes = async (params: {
  archive: CaseGraphContentImmutableArchive;
  manifestSha256: string;
  role: 'captured' | 'searchable';
  body: Buffer;
  contentType: string;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) return fail('case_graph_content_materialization_aborted');
  const digest = sha256(params.body);
  const key = objectKey(params.manifestSha256, params.role, digest);
  await params.archive.putIfAbsent({
    key,
    body: params.body,
    contentType: params.contentType,
    signal: params.signal,
  });
  const observed = await params.archive.readObject(key, {
    maxBytes: params.body.byteLength,
    signal: params.signal,
  });
  if (!observed || observed.byteLength !== params.body.byteLength || sha256(observed) !== digest) {
    return fail('case_graph_content_materialization_read_after_write_mismatch');
  }
  return { key, digest };
};

const terminalAsset = (params: {
  record: CaseGraphContentDiscoveryRecord;
  rights: CaseGraphContentRightsDecision;
  terminalStatus: Exclude<CaseGraphContentAssetTerminalStatus, 'extracted'>;
  terminalReason: string;
  sniffedMimeType?: string;
  safetyPolicyVersion: string;
  safetyScanDigest?: string | null;
  redactionPolicyDigest: string;
}) => makeCaseGraphContentAsset({
  ...params.record,
  sniffedMimeType: params.sniffedMimeType || params.record.claimedMimeType,
  byteLength: null,
  bytesSha256: null,
  capturedObjectKey: null,
  capturedObjectSha256: null,
  searchableObjectKey: null,
  searchableBytesSha256: null,
  pageCount: null,
  imageWidth: null,
  imageHeight: null,
  durationMs: null,
  visibility: 'public',
  rightsPolicyVersion: params.rights.policyVersion,
  rightsEvidenceDigest: params.rights.evidenceDigest,
  safetyPolicyVersion: params.safetyPolicyVersion,
  safetyScanDigest: params.safetyScanDigest ?? null,
  redactionPolicyDigest: params.redactionPolicyDigest,
  redactionStatus: 'not_required',
  redactionTransformationDigest: null,
  terminalStatus: params.terminalStatus,
  terminalReason: params.terminalReason,
});

export const materializeCaseGraphContentAssets = async (params: {
  discoveryManifest: CaseGraphContentDiscoveryManifest;
  evaluateRights: (
    record: CaseGraphContentDiscoveryRecord,
    signal?: AbortSignal,
  ) => Promise<CaseGraphContentRightsDecision>;
  processAsset: (params: {
    record: CaseGraphContentDiscoveryRecord;
    limitsProfile: CaseGraphContentLimitsProfile;
    signal?: AbortSignal;
  }) => Promise<CaseGraphContentProcessedAsset>;
  archive: CaseGraphContentImmutableArchive;
  fallbackSafetyPolicyVersion: string;
  fallbackRedactionPolicyDigest: string;
  maximumConcurrentAssets?: number;
  signal?: AbortSignal;
  onAssetComplete?: (progress: {
    completedAssets: number;
    totalAssets: number;
    terminalStatus: CaseGraphContentAssetTerminalStatus;
  }) => void;
}): Promise<CaseGraphContentAsset[]> => {
  const manifest = verifyCaseGraphContentDiscoveryManifest(params.discoveryManifest);
  const maximumConcurrentAssets = params.maximumConcurrentAssets
    ?? CASE_GRAPH_CONTENT_MATERIALIZATION_POLICY.maximumConcurrentAssets;
  if (!Number.isSafeInteger(maximumConcurrentAssets) || maximumConcurrentAssets < 1
    || maximumConcurrentAssets > CASE_GRAPH_CONTENT_MATERIALIZATION_POLICY.maximumConcurrentAssets) {
    return fail('case_graph_content_materialization_plan_invalid');
  }
  if (params.signal?.aborted) return fail('case_graph_content_materialization_aborted');

  const assets: CaseGraphContentAsset[] = [];
  let nextRecord = 0;
  let completedAssets = 0;
  const worker = async () => {
    while (nextRecord < manifest.records.length) {
      if (params.signal?.aborted) return fail('case_graph_content_materialization_aborted');
      const record = manifest.records[nextRecord];
      nextRecord += 1;
      const rights = await params.evaluateRights(record, params.signal);
      let asset: CaseGraphContentAsset;
      if (!rights.allowed) {
        asset = terminalAsset({
          record,
          rights,
          terminalStatus: 'rights_blocked',
          terminalReason: rights.reason,
          safetyPolicyVersion: params.fallbackSafetyPolicyVersion,
          redactionPolicyDigest: params.fallbackRedactionPolicyDigest,
        });
      } else if (record.sourceAssetKey.startsWith('unresolved-public-node:')) {
        asset = terminalAsset({
          record,
          rights,
          terminalStatus: 'unavailable',
          terminalReason: 'immutable publication record has no retrievable content locator',
          safetyPolicyVersion: params.fallbackSafetyPolicyVersion,
          redactionPolicyDigest: params.fallbackRedactionPolicyDigest,
        });
      } else {
        const processed = await params.processAsset({
          record,
          limitsProfile: manifest.limitsProfile,
          signal: params.signal,
        });
        if (processed.status === 'terminal') {
          if (!CASE_GRAPH_CONTENT_ASSET_TERMINAL_STATUSES.includes(processed.terminalStatus)) {
            return fail('case_graph_content_materialization_terminal_status_invalid');
          }
          asset = terminalAsset({
            record,
            rights,
            terminalStatus: processed.terminalStatus,
            terminalReason: processed.terminalReason,
            sniffedMimeType: processed.sniffedMimeType,
            safetyPolicyVersion: processed.safetyPolicyVersion,
            safetyScanDigest: processed.safetyScanDigest,
            redactionPolicyDigest: processed.redactionPolicyDigest,
          });
        } else {
          if (!Buffer.isBuffer(processed.rawBytes) || !processed.rawBytes.length
            || processed.rawBytes.byteLength > manifest.limitsProfile.maxAssetBytes
            || !Buffer.isBuffer(processed.searchableBytes) || !processed.searchableBytes.length
            || processed.searchableBytes.byteLength
              > manifest.limitsProfile.maxAssetBytes
                * CASE_GRAPH_CONTENT_MATERIALIZATION_POLICY.maximumSearchableBytesMultiplier
            || !factsAreValid(record, processed.facts, manifest.limitsProfile)) {
            return fail('case_graph_content_materialization_processed_asset_invalid');
          }
          const captured = await persistExactBytes({
            archive: params.archive,
            manifestSha256: manifest.publication.manifestSha256,
            role: 'captured',
            body: processed.rawBytes,
            contentType: processed.sniffedMimeType,
            signal: params.signal,
          });
          const searchable = processed.redactionStatus === 'not_required'
            ? captured
            : await persistExactBytes({
              archive: params.archive,
              manifestSha256: manifest.publication.manifestSha256,
              role: 'searchable',
              body: processed.searchableBytes,
              contentType: processed.sniffedMimeType,
              signal: params.signal,
            });
          asset = makeCaseGraphContentAsset({
            ...record,
            sniffedMimeType: processed.sniffedMimeType,
            byteLength: processed.rawBytes.byteLength,
            bytesSha256: captured.digest,
            capturedObjectKey: captured.key,
            capturedObjectSha256: captured.digest,
            searchableObjectKey: searchable.key,
            searchableBytesSha256: searchable.digest,
            ...processed.facts,
            visibility: 'public',
            rightsPolicyVersion: rights.policyVersion,
            rightsEvidenceDigest: rights.evidenceDigest,
            safetyPolicyVersion: processed.safetyPolicyVersion,
            safetyScanDigest: processed.safetyScanDigest,
            redactionPolicyDigest: processed.redactionPolicyDigest,
            redactionStatus: processed.redactionStatus,
            redactionTransformationDigest: processed.redactionTransformationDigest,
            terminalStatus: 'extracted',
            terminalReason: processed.terminalReason,
          });
        }
      }
      assets.push(asset);
      completedAssets += 1;
      params.onAssetComplete?.({
        completedAssets,
        totalAssets: manifest.recordCount,
        terminalStatus: asset.terminalStatus,
      });
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(maximumConcurrentAssets, manifest.recordCount || 1) },
    () => worker(),
  ));
  if (params.signal?.aborted) return fail('case_graph_content_materialization_aborted');
  if (assets.length !== manifest.recordCount
    || new Set(assets.map(({ discoveryId }) => discoveryId)).size !== manifest.recordCount) {
    return fail('case_graph_content_materialization_accounting_mismatch');
  }
  return assets.sort((left, right) => compareText(left.discoveryId, right.discoveryId));
};
