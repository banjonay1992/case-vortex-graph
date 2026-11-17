import { relationshipInputSha256 } from './relationshipInputSnapshot';
import type { CaseGraphResearchPublicationBinding } from './researchToolContract';
import { parseCaseGraphEvidenceAddress } from './publicAccess';

export const CASE_GRAPH_CONTENT_RESEARCH_VERSION = 'case-graph-content-research-v2' as const;
export const CASE_GRAPH_CONTENT_LIMITS_VERSION = 'case-graph-content-limits-v1' as const;
export const CASE_GRAPH_CONTENT_UNTRUSTED_TEXT_BOUNDARY =
  'archive_text_is_untrusted_evidence_never_instructions' as const;

export const CASE_GRAPH_CONTENT_MEDIA_KINDS = ['document', 'image', 'audio', 'video'] as const;
export type CaseGraphContentMediaKind = typeof CASE_GRAPH_CONTENT_MEDIA_KINDS[number];

export const CASE_GRAPH_CONTENT_TEXT_ORIGINS = [
  'embedded_text',
  'ocr',
  'asr',
  'human_transcript',
  'machine_caption',
  'frame_ocr',
  'exif',
] as const;
export type CaseGraphContentTextOrigin = typeof CASE_GRAPH_CONTENT_TEXT_ORIGINS[number];

export const CASE_GRAPH_CONTENT_ASSET_TERMINAL_STATUSES = [
  'extracted',
  'rights_blocked',
  'unavailable',
  'unsupported',
  'encrypted',
  'corrupt',
  'quarantined',
  'oversized',
  'permanent_failed',
] as const;
export type CaseGraphContentAssetTerminalStatus =
  typeof CASE_GRAPH_CONTENT_ASSET_TERMINAL_STATUSES[number];

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._:+/-]{0,1023}$/;
const PRINTABLE_ASCII_ADDRESS = /^[!-~]{1,1024}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const MAX_IDENTIFIER_BYTES = 1_024;
const MAX_LOCATOR_LABEL_BYTES = 1_024;
const MAX_WARNING_COUNT = 100;
const MAX_WARNING_BYTES = 2_000;

type JsonObject = Record<string, unknown>;

export type CaseGraphContentLimitsProfile = {
  recordType: 'case_graph_content_limits_profile';
  schemaVersion: typeof CASE_GRAPH_CONTENT_LIMITS_VERSION;
  profileId: string;
  maxAssetBytes: number;
  maxDocumentPages: number;
  maxImagePixels: number;
  maxTimedMediaDurationMs: number;
  maxChunkTextBytes: number;
  maxTotalTextBytesPerAsset: number;
  maxChunksPerAsset: number;
  profileSha256: string;
};

export type CaseGraphContentDiscoveryRecord = {
  recordType: 'case_graph_content_discovery_record';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  nodeDigest: string;
  sourceAssetKey: string;
  mediaKind: CaseGraphContentMediaKind;
  claimedMimeType: string;
  sourceLocatorDigest: string;
  sourceLineageDigest: string;
  discoveryId: string;
  discoveryDigest: string;
};

export type CaseGraphContentDiscoveryManifest = {
  recordType: 'case_graph_content_discovery_manifest';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  upstreamEnumerationReceiptSha256: string;
  limitsProfile: CaseGraphContentLimitsProfile;
  limitsApprovalReceiptSha256: string;
  recordCount: number;
  recordSetSha256: string;
  records: CaseGraphContentDiscoveryRecord[];
  manifestDigest: string;
};

export type CaseGraphContentAsset = {
  recordType: 'case_graph_content_asset';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  nodeDigest: string;
  sourceAssetKey: string;
  assetId: string;
  discoveryId: string;
  discoveryDigest: string;
  mediaKind: CaseGraphContentMediaKind;
  claimedMimeType: string;
  sniffedMimeType: string;
  byteLength: number | null;
  bytesSha256: string | null;
  capturedObjectKey: string | null;
  capturedObjectSha256: string | null;
  searchableObjectKey: string | null;
  searchableBytesSha256: string | null;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  durationMs: number | null;
  sourceLocatorDigest: string;
  sourceLineageDigest: string;
  visibility: 'public';
  rightsPolicyVersion: string;
  rightsEvidenceDigest: string;
  safetyPolicyVersion: string;
  safetyScanDigest: string | null;
  redactionPolicyDigest: string;
  redactionStatus: 'not_required' | 'applied';
  redactionTransformationDigest: string | null;
  terminalStatus: CaseGraphContentAssetTerminalStatus;
  terminalReason: string;
  assetDigest: string;
};

export type CaseGraphContentExtractor = {
  extractorType: 'embedded' | 'ocr' | 'asr' | 'caption' | 'metadata' | 'human';
  extractorId: string;
  extractorVersion: string;
  containerDigest: string;
  modelId: string | null;
  modelRevision: string | null;
  configDigest: string;
  promptDigest: string | null;
  humanProvenanceDigest: string | null;
  languageDetectorVersion: string;
};

export type CaseGraphContentExtractionContract = {
  recordType: 'case_graph_content_extraction_contract';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  assetId: string;
  assetDigest: string;
  limitsProfile: CaseGraphContentLimitsProfile;
  extractor: CaseGraphContentExtractor;
  textOrigin: CaseGraphContentTextOrigin;
  contractDigest: string;
};

export type CaseGraphDocumentPageLocator = {
  locatorType: 'document_page';
  pageNumber: number;
  characterStart: number;
  characterEnd: number;
  readingOrder: number;
  boundingBox: [number, number, number, number] | null;
};

export type CaseGraphImageRegionLocator = {
  locatorType: 'image_region';
  regionLabel: string | null;
  boundingBox: [number, number, number, number] | null;
};

export type CaseGraphTimedMediaLocator = {
  locatorType: 'timed_media';
  startMs: number;
  endMs: number;
  keyframeMs: number | null;
  speaker: string | null;
  channel: string | null;
};

export type CaseGraphExifLocator = {
  locatorType: 'exif_field';
  field: string;
};

export type CaseGraphContentLocator =
  | CaseGraphDocumentPageLocator
  | CaseGraphImageRegionLocator
  | CaseGraphTimedMediaLocator
  | CaseGraphExifLocator;

export type CaseGraphContentChunk = {
  recordType: 'case_graph_content_chunk';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  address: string;
  nodeDigest: string;
  assetId: string;
  assetDigest: string;
  extractionContractDigest: string;
  mediaKind: CaseGraphContentMediaKind;
  textOrigin: CaseGraphContentTextOrigin;
  ordinal: number;
  locator: CaseGraphContentLocator;
  text: string;
  textSha256: string;
  language: string;
  confidence: number | null;
  warnings: string[];
  untrustedText: true;
  securityBoundary: typeof CASE_GRAPH_CONTENT_UNTRUSTED_TEXT_BOUNDARY;
  chunkId: string;
  chunkDigest: string;
};

export type CaseGraphContentExtractionReceipt = {
  recordType: 'case_graph_content_extraction_receipt';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  assetId: string;
  assetDigest: string;
  extractionContractDigest: string;
  chunkCount: number;
  chunkSetSha256: string;
  totalTextBytes: number;
  coverage:
    | { coverageType: 'document'; totalPages: number; processedPages: number[] }
    | { coverageType: 'image'; totalPixels: number; processedPixels: number }
    | { coverageType: 'timed_media'; totalDurationMs: number; processedDurationMs: number };
  warnings: string[];
  receiptDigest: string;
};

export type CaseGraphContentAccountingReceipt = {
  recordType: 'case_graph_content_accounting_receipt';
  schemaVersion: typeof CASE_GRAPH_CONTENT_RESEARCH_VERSION;
  publication: CaseGraphResearchPublicationBinding;
  discoveryManifestDigest: string;
  discoveredAssetCount: number;
  terminalAssetCount: number;
  extractedAssetCount: number;
  excludedAssetCount: number;
  permanentFailureCount: number;
  searchableChunkCount: number;
  terminalStatusCounts: Record<CaseGraphContentAssetTerminalStatus, number>;
  assetSetSha256: string;
  extractionReceiptSetSha256: string;
  chunkSetSha256: string;
  accountingComplete: boolean;
  allDiscoveredContentSearchable: boolean;
  limitations: string[];
  receiptDigest: string;
};

const invalid = (code: string): never => {
  throw new Error(code);
};

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

const hasUnpairedSurrogate = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

const stringValue = (value: unknown, maximumBytes: number, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const result = (value as string).trim();
  if (!result || bytes(result) > maximumBytes || result.includes('\u0000') || hasUnpairedSurrogate(result)) invalid(code);
  return result;
};

const exactTextValue = (value: unknown, maximumBytes: number) => {
  if (typeof value !== 'string') invalid('case_graph_content_chunk_text_invalid');
  const result = value as string;
  if (!result.trim() || bytes(result) > maximumBytes || result.includes('\u0000') || hasUnpairedSurrogate(result)) {
    invalid('case_graph_content_chunk_text_invalid');
  }
  return result;
};

const digestValue = (value: unknown, code: string) => {
  const result = stringValue(value, 64, code).toLowerCase();
  if (!SHA256.test(result)) invalid(code);
  return result;
};

const countValue = (value: unknown, minimum: number, maximum: number, code: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(code);
  return value as number;
};

const confidenceValue = (value: unknown, code: string) => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid(code);
  return value as number;
};

const exactKeys = (value: JsonObject, keys: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(code);
};

const objectValue = (value: unknown, code: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as JsonObject;
};

const publicationValue = (value: unknown): CaseGraphResearchPublicationBinding => {
  const object = objectValue(value, 'case_graph_content_publication_invalid');
  const keys = [
    'publicationId', 'corpusVersion', 'manifestSha256', 'snapshotId',
    'graphArtifactSetSha256', 'relationshipSchemaVersion', 'relationshipPolicyVersion',
    'relationshipPolicySha256', 'relationshipModelId', 'relationshipModelVersion',
    'relationshipModelSha256', 'calibrationSetSha256',
  ] as const;
  exactKeys(object, keys, 'case_graph_content_publication_invalid');
  const publication = Object.fromEntries(keys.map((key) => [key, stringValue(
    object[key], key.toLowerCase().includes('sha256') ? 64 : MAX_IDENTIFIER_BYTES,
    'case_graph_content_publication_invalid',
  )])) as CaseGraphResearchPublicationBinding;
  for (const key of keys.filter((candidate) => candidate.toLowerCase().includes('sha256'))) {
    if (!SHA256.test(publication[key])) invalid('case_graph_content_publication_invalid');
  }
  if (!UUID.test(publication.publicationId)) invalid('case_graph_content_publication_invalid');
  for (const key of keys.filter((candidate) => (
    !candidate.toLowerCase().includes('sha256') && candidate !== 'publicationId'
  ))) {
    if (!SAFE_VERSION.test(publication[key])) invalid('case_graph_content_publication_invalid');
  }
  return publication;
};

const samePublication = (
  left: CaseGraphResearchPublicationBinding,
  right: CaseGraphResearchPublicationBinding,
) => relationshipInputSha256(left) === relationshipInputSha256(right);

const addressValue = (value: unknown) => {
  const address = stringValue(value, 1_024, 'case_graph_content_address_invalid');
  if (!PRINTABLE_ASCII_ADDRESS.test(address) || bytes(address) > 1_024) {
    invalid('case_graph_content_address_invalid');
  }
  try {
    const parsed = parseCaseGraphEvidenceAddress(address);
    if (parsed.address !== address) invalid('case_graph_content_address_invalid');
    return parsed.address;
  } catch {
    return invalid('case_graph_content_address_invalid');
  }
};

const mimeValue = (value: unknown) => {
  const mime = stringValue(value, 255, 'case_graph_content_mime_invalid').toLowerCase();
  if (!MIME.test(mime)) invalid('case_graph_content_mime_invalid');
  return mime;
};

const warningsValue = (value: unknown) => {
  if (!Array.isArray(value) || value.length > MAX_WARNING_COUNT) invalid('case_graph_content_warnings_invalid');
  const result = (value as unknown[]).map((entry) => stringValue(entry, MAX_WARNING_BYTES,
    'case_graph_content_warnings_invalid')).sort(compareText);
  if (new Set(result).size !== result.length) invalid('case_graph_content_warnings_invalid');
  return result;
};

const optionalString = (value: unknown, maximumBytes: number, code: string) => (
  value === null ? null : stringValue(value, maximumBytes, code)
);

export const makeCaseGraphContentLimitsProfile = (input: Omit<
  CaseGraphContentLimitsProfile,
  'recordType' | 'schemaVersion' | 'profileSha256'
>): CaseGraphContentLimitsProfile => {
  const withoutDigest = {
    recordType: 'case_graph_content_limits_profile' as const,
    schemaVersion: CASE_GRAPH_CONTENT_LIMITS_VERSION,
    profileId: stringValue(input.profileId, MAX_IDENTIFIER_BYTES, 'case_graph_content_limits_invalid'),
    maxAssetBytes: countValue(input.maxAssetBytes, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_limits_invalid'),
    maxDocumentPages: countValue(input.maxDocumentPages, 1, 1_000_000, 'case_graph_content_limits_invalid'),
    maxImagePixels: countValue(input.maxImagePixels, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_limits_invalid'),
    maxTimedMediaDurationMs: countValue(input.maxTimedMediaDurationMs, 1, Number.MAX_SAFE_INTEGER,
      'case_graph_content_limits_invalid'),
    maxChunkTextBytes: countValue(input.maxChunkTextBytes, 1, 16 * 1024 * 1024,
      'case_graph_content_limits_invalid'),
    maxTotalTextBytesPerAsset: countValue(input.maxTotalTextBytesPerAsset, 1, Number.MAX_SAFE_INTEGER,
      'case_graph_content_limits_invalid'),
    maxChunksPerAsset: countValue(input.maxChunksPerAsset, 1, 10_000_000,
      'case_graph_content_limits_invalid'),
  };
  return { ...withoutDigest, profileSha256: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentLimitsProfile = (value: CaseGraphContentLimitsProfile) => {
  const expected = makeCaseGraphContentLimitsProfile(value);
  if (relationshipInputSha256(value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_limits_integrity_failed');
  }
  return expected;
};

export const makeCaseGraphContentDiscoveryRecord = (input: Omit<
  CaseGraphContentDiscoveryRecord,
  'recordType' | 'schemaVersion' | 'discoveryId' | 'discoveryDigest'
>): CaseGraphContentDiscoveryRecord => {
  const core = {
    publication: publicationValue(input.publication),
    address: addressValue(input.address),
    nodeDigest: digestValue(input.nodeDigest, 'case_graph_content_discovery_invalid'),
    sourceAssetKey: stringValue(input.sourceAssetKey, 4_096, 'case_graph_content_discovery_invalid'),
    mediaKind: input.mediaKind,
    claimedMimeType: mimeValue(input.claimedMimeType),
    sourceLocatorDigest: digestValue(input.sourceLocatorDigest, 'case_graph_content_discovery_invalid'),
    sourceLineageDigest: digestValue(input.sourceLineageDigest, 'case_graph_content_discovery_invalid'),
  };
  if (!CASE_GRAPH_CONTENT_MEDIA_KINDS.includes(core.mediaKind)) {
    invalid('case_graph_content_discovery_invalid');
  }
  const identity = {
    publication: core.publication,
    address: core.address,
    sourceAssetKey: core.sourceAssetKey,
    sourceLocatorDigest: core.sourceLocatorDigest,
    sourceLineageDigest: core.sourceLineageDigest,
  };
  const withoutDigest = {
    recordType: 'case_graph_content_discovery_record' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    ...core,
    discoveryId: `content-discovery:${relationshipInputSha256(identity)}`,
  };
  return { ...withoutDigest, discoveryDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentDiscoveryRecord = (value: CaseGraphContentDiscoveryRecord) => {
  const expected = makeCaseGraphContentDiscoveryRecord(value);
  if (relationshipInputSha256(value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_discovery_integrity_failed');
  }
  return expected;
};

export const makeCaseGraphContentDiscoveryManifest = (params: {
  publication: CaseGraphResearchPublicationBinding;
  upstreamEnumerationReceiptSha256: string;
  limitsProfile: CaseGraphContentLimitsProfile;
  limitsApprovalReceiptSha256: string;
  records: CaseGraphContentDiscoveryRecord[];
}): CaseGraphContentDiscoveryManifest => {
  const publication = publicationValue(params.publication);
  const records = params.records.map(verifyCaseGraphContentDiscoveryRecord)
    .sort((left, right) => compareText(left.discoveryId, right.discoveryId));
  if (new Set(records.map(({ discoveryId }) => discoveryId)).size !== records.length
    || records.some((record) => !samePublication(record.publication, publication))) {
    invalid('case_graph_content_discovery_manifest_record_set_invalid');
  }
  const withoutDigest = {
    recordType: 'case_graph_content_discovery_manifest' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    publication,
    upstreamEnumerationReceiptSha256: digestValue(params.upstreamEnumerationReceiptSha256,
      'case_graph_content_discovery_manifest_invalid'),
    limitsProfile: verifyCaseGraphContentLimitsProfile(params.limitsProfile),
    limitsApprovalReceiptSha256: digestValue(params.limitsApprovalReceiptSha256,
      'case_graph_content_discovery_manifest_invalid'),
    recordCount: records.length,
    recordSetSha256: relationshipInputSha256(records.map(({ discoveryId, discoveryDigest }) => ({
      discoveryId,
      discoveryDigest,
    }))),
    records,
  };
  return { ...withoutDigest, manifestDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentDiscoveryManifest = (value: CaseGraphContentDiscoveryManifest) => {
  const expected = makeCaseGraphContentDiscoveryManifest({
    publication: value.publication,
    upstreamEnumerationReceiptSha256: value.upstreamEnumerationReceiptSha256,
    limitsProfile: value.limitsProfile,
    limitsApprovalReceiptSha256: value.limitsApprovalReceiptSha256,
    records: value.records,
  });
  if (relationshipInputSha256(value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_discovery_manifest_integrity_failed');
  }
  return expected;
};

export const makeCaseGraphContentAsset = (input: Omit<
  CaseGraphContentAsset,
  'recordType' | 'schemaVersion' | 'assetId' | 'assetDigest' | 'discoveryId' | 'discoveryDigest'
>): CaseGraphContentAsset => {
  const publication = publicationValue(input.publication);
  if (!CASE_GRAPH_CONTENT_MEDIA_KINDS.includes(input.mediaKind)) invalid('case_graph_content_asset_kind_invalid');
  if (!CASE_GRAPH_CONTENT_ASSET_TERMINAL_STATUSES.includes(input.terminalStatus)) {
    invalid('case_graph_content_asset_status_invalid');
  }
  const terminalStatus = input.terminalStatus;
  const byteLength = input.byteLength === null ? null : countValue(
    input.byteLength, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_asset_bytes_invalid',
  );
  const bytesSha256 = input.bytesSha256 === null ? null : digestValue(
    input.bytesSha256, 'case_graph_content_asset_bytes_invalid',
  );
  const capturedObjectKey = optionalString(input.capturedObjectKey, 4_096,
    'case_graph_content_asset_object_invalid');
  const capturedObjectSha256 = input.capturedObjectSha256 === null ? null : digestValue(
    input.capturedObjectSha256, 'case_graph_content_asset_object_invalid',
  );
  const searchableObjectKey = optionalString(input.searchableObjectKey, 4_096,
    'case_graph_content_asset_object_invalid');
  const searchableBytesSha256 = input.searchableBytesSha256 === null ? null : digestValue(
    input.searchableBytesSha256, 'case_graph_content_asset_object_invalid',
  );
  const pageCount = input.pageCount === null ? null : countValue(
    input.pageCount, 1, 1_000_000, 'case_graph_content_asset_facts_invalid',
  );
  const imageWidth = input.imageWidth === null ? null : countValue(
    input.imageWidth, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_asset_facts_invalid',
  );
  const imageHeight = input.imageHeight === null ? null : countValue(
    input.imageHeight, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_asset_facts_invalid',
  );
  const durationMs = input.durationMs === null ? null : countValue(
    input.durationMs, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_asset_facts_invalid',
  );
  const safetyScanDigest = input.safetyScanDigest === null ? null : digestValue(
    input.safetyScanDigest, 'case_graph_content_asset_safety_invalid',
  );
  if (terminalStatus === 'extracted' && (
    byteLength === null || bytesSha256 === null || capturedObjectKey === null
    || capturedObjectSha256 === null || searchableObjectKey === null
    || searchableBytesSha256 === null || safetyScanDigest === null
  )) invalid('case_graph_content_asset_extracted_evidence_required');
  if (terminalStatus === 'extracted'
    && ((input.mediaKind === 'document' && pageCount === null)
      || (input.mediaKind === 'image' && (imageWidth === null || imageHeight === null))
      || ((input.mediaKind === 'audio' || input.mediaKind === 'video') && durationMs === null))) {
    invalid('case_graph_content_asset_facts_required');
  }
  if (!['not_required', 'applied'].includes(input.redactionStatus)) {
    invalid('case_graph_content_asset_redaction_invalid');
  }
  const redactionTransformationDigest = input.redactionTransformationDigest === null ? null : digestValue(
    input.redactionTransformationDigest, 'case_graph_content_asset_redaction_invalid',
  );
  if (terminalStatus === 'extracted' && input.redactionStatus === 'not_required'
    && (redactionTransformationDigest !== null
      || bytesSha256 !== capturedObjectSha256
      || bytesSha256 !== searchableBytesSha256
      || capturedObjectKey !== searchableObjectKey)) {
    invalid('case_graph_content_asset_redaction_lineage_invalid');
  }
  if (terminalStatus === 'extracted' && input.redactionStatus === 'applied'
    && (redactionTransformationDigest === null
      || bytesSha256 !== capturedObjectSha256
      || bytesSha256 === searchableBytesSha256
      || capturedObjectKey === searchableObjectKey)) {
    invalid('case_graph_content_asset_redaction_lineage_invalid');
  }
  if (input.visibility !== 'public') invalid('case_graph_content_asset_visibility_invalid');
  const discovery = makeCaseGraphContentDiscoveryRecord({
    publication,
    address: input.address,
    nodeDigest: input.nodeDigest,
    sourceAssetKey: input.sourceAssetKey,
    mediaKind: input.mediaKind,
    claimedMimeType: input.claimedMimeType,
    sourceLocatorDigest: input.sourceLocatorDigest,
    sourceLineageDigest: input.sourceLineageDigest,
  });
  const core = {
    publication,
    address: discovery.address,
    nodeDigest: discovery.nodeDigest,
    sourceAssetKey: discovery.sourceAssetKey,
    discoveryId: discovery.discoveryId,
    discoveryDigest: discovery.discoveryDigest,
    mediaKind: discovery.mediaKind,
    claimedMimeType: discovery.claimedMimeType,
    sniffedMimeType: mimeValue(input.sniffedMimeType),
    byteLength,
    bytesSha256,
    capturedObjectKey,
    capturedObjectSha256,
    searchableObjectKey,
    searchableBytesSha256,
    pageCount,
    imageWidth,
    imageHeight,
    durationMs,
    sourceLocatorDigest: discovery.sourceLocatorDigest,
    sourceLineageDigest: discovery.sourceLineageDigest,
    visibility: 'public' as const,
    rightsPolicyVersion: stringValue(input.rightsPolicyVersion, MAX_IDENTIFIER_BYTES,
      'case_graph_content_asset_rights_invalid'),
    rightsEvidenceDigest: digestValue(input.rightsEvidenceDigest, 'case_graph_content_asset_rights_invalid'),
    safetyPolicyVersion: stringValue(input.safetyPolicyVersion, MAX_IDENTIFIER_BYTES,
      'case_graph_content_asset_safety_invalid'),
    safetyScanDigest,
    redactionPolicyDigest: digestValue(input.redactionPolicyDigest, 'case_graph_content_asset_redaction_invalid'),
    redactionStatus: input.redactionStatus,
    redactionTransformationDigest,
    terminalStatus,
    terminalReason: stringValue(input.terminalReason, 4_096, 'case_graph_content_asset_status_invalid'),
  };
  const withoutDigest = {
    recordType: 'case_graph_content_asset' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    publication,
    address: core.address,
    nodeDigest: core.nodeDigest,
    sourceAssetKey: core.sourceAssetKey,
    assetId: `content-asset:${relationshipInputSha256({
      publication: core.publication,
      discoveryId: core.discoveryId,
      discoveryDigest: core.discoveryDigest,
    })}`,
    discoveryId: core.discoveryId,
    discoveryDigest: core.discoveryDigest,
    mediaKind: core.mediaKind,
    claimedMimeType: core.claimedMimeType,
    sniffedMimeType: core.sniffedMimeType,
    byteLength: core.byteLength,
    bytesSha256: core.bytesSha256,
    capturedObjectKey: core.capturedObjectKey,
    capturedObjectSha256: core.capturedObjectSha256,
    searchableObjectKey: core.searchableObjectKey,
    searchableBytesSha256: core.searchableBytesSha256,
    pageCount: core.pageCount,
    imageWidth: core.imageWidth,
    imageHeight: core.imageHeight,
    durationMs: core.durationMs,
    sourceLocatorDigest: core.sourceLocatorDigest,
    sourceLineageDigest: core.sourceLineageDigest,
    visibility: core.visibility,
    rightsPolicyVersion: core.rightsPolicyVersion,
    rightsEvidenceDigest: core.rightsEvidenceDigest,
    safetyPolicyVersion: core.safetyPolicyVersion,
    safetyScanDigest: core.safetyScanDigest,
    redactionPolicyDigest: core.redactionPolicyDigest,
    redactionStatus: core.redactionStatus,
    redactionTransformationDigest: core.redactionTransformationDigest,
    terminalStatus: core.terminalStatus,
    terminalReason: core.terminalReason,
  };
  return { ...withoutDigest, assetDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentAsset = (value: CaseGraphContentAsset) => {
  const expected = makeCaseGraphContentAsset(value);
  if (relationshipInputSha256(value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_asset_integrity_failed');
  }
  return expected;
};

const extractorValue = (value: CaseGraphContentExtractor): CaseGraphContentExtractor => {
  if (!['embedded', 'ocr', 'asr', 'caption', 'metadata', 'human'].includes(value.extractorType)) {
    invalid('case_graph_content_extractor_invalid');
  }
  const extractor = {
    extractorType: value.extractorType,
    extractorId: stringValue(value.extractorId, MAX_IDENTIFIER_BYTES, 'case_graph_content_extractor_invalid'),
    extractorVersion: stringValue(value.extractorVersion, MAX_IDENTIFIER_BYTES,
      'case_graph_content_extractor_invalid'),
    containerDigest: digestValue(value.containerDigest, 'case_graph_content_extractor_invalid'),
    modelId: optionalString(value.modelId, MAX_IDENTIFIER_BYTES, 'case_graph_content_extractor_invalid'),
    modelRevision: optionalString(value.modelRevision, MAX_IDENTIFIER_BYTES, 'case_graph_content_extractor_invalid'),
    configDigest: digestValue(value.configDigest, 'case_graph_content_extractor_invalid'),
    promptDigest: value.promptDigest === null ? null : digestValue(value.promptDigest,
      'case_graph_content_extractor_invalid'),
    humanProvenanceDigest: value.humanProvenanceDigest === null ? null : digestValue(
      value.humanProvenanceDigest, 'case_graph_content_extractor_invalid',
    ),
    languageDetectorVersion: stringValue(value.languageDetectorVersion, MAX_IDENTIFIER_BYTES,
      'case_graph_content_extractor_invalid'),
  };
  if (extractor.extractorType === 'caption'
    && (!extractor.modelId || !extractor.modelRevision || !extractor.promptDigest)) {
    invalid('case_graph_content_extractor_model_provenance_required');
  }
  if (extractor.extractorType === 'human' && !extractor.humanProvenanceDigest) {
    invalid('case_graph_content_extractor_human_provenance_required');
  }
  if (extractor.extractorType !== 'human' && extractor.humanProvenanceDigest !== null) {
    invalid('case_graph_content_extractor_invalid');
  }
  return extractor;
};

const textOriginForExtractor = (
  asset: CaseGraphContentAsset,
  extractor: CaseGraphContentExtractor,
): CaseGraphContentTextOrigin => {
  switch (extractor.extractorType) {
    case 'embedded':
      if (asset.mediaKind !== 'document') invalid('case_graph_content_extractor_media_mismatch');
      return 'embedded_text';
    case 'ocr':
      if (asset.mediaKind === 'document') return 'ocr';
      if (asset.mediaKind === 'image' || asset.mediaKind === 'video') return 'frame_ocr';
      return invalid('case_graph_content_extractor_media_mismatch');
    case 'asr':
      if (asset.mediaKind !== 'audio' && asset.mediaKind !== 'video') {
        invalid('case_graph_content_extractor_media_mismatch');
      }
      return 'asr';
    case 'caption':
      if (asset.mediaKind !== 'image' && asset.mediaKind !== 'video') {
        invalid('case_graph_content_extractor_media_mismatch');
      }
      return 'machine_caption';
    case 'metadata':
      if (asset.mediaKind !== 'image') invalid('case_graph_content_extractor_media_mismatch');
      return 'exif';
    case 'human':
      if (asset.mediaKind !== 'audio' && asset.mediaKind !== 'video') {
        invalid('case_graph_content_extractor_media_mismatch');
      }
      return 'human_transcript';
    default:
      return invalid('case_graph_content_extractor_invalid');
  }
};

export const makeCaseGraphContentExtractionContract = (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  extractor: CaseGraphContentExtractor;
}): CaseGraphContentExtractionContract => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  if (asset.terminalStatus !== 'extracted') invalid('case_graph_content_asset_not_extractable');
  const limitsProfile = verifyCaseGraphContentLimitsProfile(params.limitsProfile);
  const extractor = extractorValue(params.extractor);
  const withoutDigest = {
    recordType: 'case_graph_content_extraction_contract' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    publication: asset.publication,
    assetId: asset.assetId,
    assetDigest: asset.assetDigest,
    limitsProfile,
    extractor,
    textOrigin: textOriginForExtractor(asset, extractor),
  };
  if (asset.byteLength === null || asset.byteLength > withoutDigest.limitsProfile.maxAssetBytes) {
    invalid('case_graph_content_asset_limit_exceeded');
  }
  if (asset.pageCount !== null && asset.pageCount > limitsProfile.maxDocumentPages) {
    invalid('case_graph_content_asset_limit_exceeded');
  }
  if (asset.imageWidth !== null && asset.imageHeight !== null
    && asset.imageWidth * asset.imageHeight > limitsProfile.maxImagePixels) {
    invalid('case_graph_content_asset_limit_exceeded');
  }
  if (asset.durationMs !== null && asset.durationMs > limitsProfile.maxTimedMediaDurationMs) {
    invalid('case_graph_content_asset_limit_exceeded');
  }
  return { ...withoutDigest, contractDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentExtractionContract = (params: {
  value: CaseGraphContentExtractionContract;
  asset: CaseGraphContentAsset;
}) => {
  const expected = makeCaseGraphContentExtractionContract({
    asset: params.asset,
    limitsProfile: params.value.limitsProfile,
    extractor: params.value.extractor,
  });
  if (relationshipInputSha256(params.value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_extraction_contract_integrity_failed');
  }
  return expected;
};

const boundingBoxValue = (value: unknown): [number, number, number, number] | null => {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 4
    || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    invalid('case_graph_content_locator_invalid');
  }
  const [x, y, width, height] = value as number[];
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    invalid('case_graph_content_locator_invalid');
  }
  return [x, y, width, height];
};

const locatorValue = (value: CaseGraphContentLocator): CaseGraphContentLocator => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('case_graph_content_locator_invalid');
  switch (value.locatorType) {
    case 'document_page':
      return {
        locatorType: 'document_page',
        pageNumber: countValue(value.pageNumber, 1, 1_000_000, 'case_graph_content_locator_invalid'),
        characterStart: countValue(value.characterStart, 0, Number.MAX_SAFE_INTEGER,
          'case_graph_content_locator_invalid'),
        characterEnd: countValue(value.characterEnd, 1, Number.MAX_SAFE_INTEGER,
          'case_graph_content_locator_invalid'),
        readingOrder: countValue(value.readingOrder, 0, Number.MAX_SAFE_INTEGER,
          'case_graph_content_locator_invalid'),
        boundingBox: boundingBoxValue(value.boundingBox),
      };
    case 'image_region':
      return {
        locatorType: 'image_region',
        regionLabel: optionalString(value.regionLabel, MAX_LOCATOR_LABEL_BYTES,
          'case_graph_content_locator_invalid'),
        boundingBox: boundingBoxValue(value.boundingBox),
      };
    case 'timed_media': {
      const startMs = countValue(value.startMs, 0, Number.MAX_SAFE_INTEGER, 'case_graph_content_locator_invalid');
      const endMs = countValue(value.endMs, 1, Number.MAX_SAFE_INTEGER, 'case_graph_content_locator_invalid');
      if (endMs <= startMs) invalid('case_graph_content_locator_invalid');
      const keyframeMs = value.keyframeMs === null ? null : countValue(
        value.keyframeMs, startMs, endMs, 'case_graph_content_locator_invalid',
      );
      return {
        locatorType: 'timed_media',
        startMs,
        endMs,
        keyframeMs,
        speaker: optionalString(value.speaker, MAX_LOCATOR_LABEL_BYTES, 'case_graph_content_locator_invalid'),
        channel: optionalString(value.channel, MAX_LOCATOR_LABEL_BYTES, 'case_graph_content_locator_invalid'),
      };
    }
    case 'exif_field':
      return {
        locatorType: 'exif_field',
        field: stringValue(value.field, MAX_LOCATOR_LABEL_BYTES, 'case_graph_content_locator_invalid'),
      };
    default:
      return invalid('case_graph_content_locator_invalid');
  }
};

const originLocatorCompatible = (
  mediaKind: CaseGraphContentMediaKind,
  origin: CaseGraphContentTextOrigin,
  locator: CaseGraphContentLocator,
) => {
  if ((origin === 'embedded_text' || origin === 'ocr')
    && mediaKind === 'document' && locator.locatorType === 'document_page') return true;
  if ((origin === 'asr' || origin === 'human_transcript')
    && (mediaKind === 'audio' || mediaKind === 'video') && locator.locatorType === 'timed_media') return true;
  if ((origin === 'machine_caption' || origin === 'frame_ocr')
    && mediaKind === 'image' && locator.locatorType === 'image_region') return true;
  if ((origin === 'machine_caption' || origin === 'frame_ocr')
    && mediaKind === 'video' && locator.locatorType === 'timed_media'
    && locator.keyframeMs !== null) return true;
  if (origin === 'exif' && mediaKind === 'image' && locator.locatorType === 'exif_field') return true;
  return false;
};

export const makeCaseGraphContentChunk = (params: {
  asset: CaseGraphContentAsset;
  contract: CaseGraphContentExtractionContract;
  textOrigin: CaseGraphContentTextOrigin;
  ordinal: number;
  locator: CaseGraphContentLocator;
  text: string;
  language: string;
  confidence: number | null;
  warnings?: string[];
}): CaseGraphContentChunk => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const contract = verifyCaseGraphContentExtractionContract({ value: params.contract, asset });
  if (!CASE_GRAPH_CONTENT_TEXT_ORIGINS.includes(params.textOrigin)) invalid('case_graph_content_origin_invalid');
  if (params.textOrigin !== contract.textOrigin) invalid('case_graph_content_extractor_origin_mismatch');
  const locator = locatorValue(params.locator);
  if (!originLocatorCompatible(asset.mediaKind, params.textOrigin, locator)) {
    invalid('case_graph_content_origin_locator_mismatch');
  }
  const text = exactTextValue(params.text, contract.limitsProfile.maxChunkTextBytes);
  const language = stringValue(params.language, 64, 'case_graph_content_chunk_language_invalid').toLowerCase();
  if (!LANGUAGE.test(language)) invalid('case_graph_content_chunk_language_invalid');
  if (locator.locatorType === 'document_page' && locator.characterEnd <= locator.characterStart) {
    invalid('case_graph_content_locator_invalid');
  }
  if (locator.locatorType === 'document_page'
    && (locator.pageNumber > contract.limitsProfile.maxDocumentPages
      || asset.pageCount === null
      || locator.pageNumber > asset.pageCount)) {
    invalid('case_graph_content_locator_limit_exceeded');
  }
  if (locator.locatorType === 'timed_media'
    && (locator.endMs > contract.limitsProfile.maxTimedMediaDurationMs
      || asset.durationMs === null
      || locator.endMs > asset.durationMs)) {
    invalid('case_graph_content_locator_limit_exceeded');
  }
  const confidence = confidenceValue(params.confidence, 'case_graph_content_chunk_confidence_invalid');
  if (['ocr', 'asr', 'machine_caption', 'frame_ocr'].includes(params.textOrigin) && confidence === null) {
    invalid('case_graph_content_chunk_confidence_required');
  }
  const textSha256 = relationshipInputSha256(text);
  const identity = {
    assetDigest: asset.assetDigest,
    extractionContractDigest: contract.contractDigest,
    ordinal: countValue(params.ordinal, 0, contract.limitsProfile.maxChunksPerAsset - 1,
      'case_graph_content_chunk_ordinal_invalid'),
    locator,
    textOrigin: params.textOrigin,
    textSha256,
  };
  const withoutDigest = {
    recordType: 'case_graph_content_chunk' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    publication: asset.publication,
    address: asset.address,
    nodeDigest: asset.nodeDigest,
    assetId: asset.assetId,
    assetDigest: asset.assetDigest,
    extractionContractDigest: contract.contractDigest,
    mediaKind: asset.mediaKind,
    textOrigin: params.textOrigin,
    ordinal: identity.ordinal,
    locator,
    text,
    textSha256,
    language,
    confidence,
    warnings: warningsValue(params.warnings || []),
    untrustedText: true as const,
    securityBoundary: CASE_GRAPH_CONTENT_UNTRUSTED_TEXT_BOUNDARY,
    chunkId: `content-chunk:${relationshipInputSha256(identity)}`,
  };
  return { ...withoutDigest, chunkDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentChunk = (params: {
  value: CaseGraphContentChunk;
  asset: CaseGraphContentAsset;
  contract: CaseGraphContentExtractionContract;
}) => {
  if (!samePublication(params.value.publication, params.asset.publication)) {
    invalid('case_graph_content_chunk_publication_mismatch');
  }
  const expected = makeCaseGraphContentChunk({
    asset: params.asset,
    contract: params.contract,
    textOrigin: params.value.textOrigin,
    ordinal: params.value.ordinal,
    locator: params.value.locator,
    text: params.value.text,
    language: params.value.language,
    confidence: params.value.confidence,
    warnings: params.value.warnings,
  });
  if (relationshipInputSha256(params.value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_chunk_integrity_failed');
  }
  return expected;
};

export const makeCaseGraphContentExtractionReceipt = (params: {
  asset: CaseGraphContentAsset;
  contract: CaseGraphContentExtractionContract;
  chunks: CaseGraphContentChunk[];
  coverage: CaseGraphContentExtractionReceipt['coverage'];
  warnings?: string[];
}): CaseGraphContentExtractionReceipt => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const contract = verifyCaseGraphContentExtractionContract({ value: params.contract, asset });
  if (!Array.isArray(params.chunks) || params.chunks.length < 1
    || params.chunks.length > contract.limitsProfile.maxChunksPerAsset) {
    invalid('case_graph_content_chunk_count_invalid');
  }
  const chunks = params.chunks.map((value) => verifyCaseGraphContentChunk({ value, asset, contract }))
    .sort((left, right) => left.ordinal - right.ordinal || compareText(left.chunkId, right.chunkId));
  if (new Set(chunks.map(({ chunkId }) => chunkId)).size !== chunks.length
    || chunks.some(({ ordinal }, index) => ordinal !== index)) {
    invalid('case_graph_content_chunk_set_invalid');
  }
  const totalTextBytes = chunks.reduce((total, chunk) => total + bytes(chunk.text), 0);
  if (totalTextBytes > contract.limitsProfile.maxTotalTextBytesPerAsset) {
    invalid('case_graph_content_total_text_limit_exceeded');
  }
  let coverage: CaseGraphContentExtractionReceipt['coverage'];
  if (asset.mediaKind === 'document') {
    const documentCoverage = params.coverage.coverageType === 'document'
      ? params.coverage
      : invalid('case_graph_content_coverage_invalid');
    const pageCount = asset.pageCount === null
      ? invalid('case_graph_content_coverage_invalid')
      : asset.pageCount;
    if (documentCoverage.totalPages !== pageCount
      || !Array.isArray(documentCoverage.processedPages)) invalid('case_graph_content_coverage_invalid');
    const processedPages = [...documentCoverage.processedPages];
    if (processedPages.length !== pageCount
      || processedPages.some((page, index) => page !== index + 1)) {
      invalid('case_graph_content_coverage_incomplete');
    }
    coverage = { coverageType: 'document', totalPages: pageCount, processedPages };
  } else if (asset.mediaKind === 'image') {
    const imageCoverage = params.coverage.coverageType === 'image'
      ? params.coverage
      : invalid('case_graph_content_coverage_invalid');
    const imageWidth = asset.imageWidth === null
      ? invalid('case_graph_content_coverage_invalid')
      : asset.imageWidth;
    const imageHeight = asset.imageHeight === null
      ? invalid('case_graph_content_coverage_invalid')
      : asset.imageHeight;
    const totalPixels = imageWidth * imageHeight;
    if (imageCoverage.totalPixels !== totalPixels
      || imageCoverage.processedPixels !== totalPixels) {
      invalid('case_graph_content_coverage_incomplete');
    }
    coverage = { coverageType: 'image', totalPixels, processedPixels: totalPixels };
  } else {
    const timedCoverage = params.coverage.coverageType === 'timed_media'
      ? params.coverage
      : invalid('case_graph_content_coverage_invalid');
    const durationMs = asset.durationMs === null
      ? invalid('case_graph_content_coverage_invalid')
      : asset.durationMs;
    if (timedCoverage.totalDurationMs !== durationMs
      || timedCoverage.processedDurationMs !== durationMs) {
      invalid('case_graph_content_coverage_incomplete');
    }
    coverage = {
      coverageType: 'timed_media',
      totalDurationMs: durationMs,
      processedDurationMs: durationMs,
    };
  }
  const withoutDigest = {
    recordType: 'case_graph_content_extraction_receipt' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    publication: asset.publication,
    assetId: asset.assetId,
    assetDigest: asset.assetDigest,
    extractionContractDigest: contract.contractDigest,
    chunkCount: chunks.length,
    chunkSetSha256: relationshipInputSha256(chunks.map(({ chunkId, chunkDigest }) => ({ chunkId, chunkDigest }))),
    totalTextBytes,
    coverage,
    warnings: warningsValue(params.warnings || []),
  };
  return { ...withoutDigest, receiptDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentExtractionReceipt = (params: {
  value: CaseGraphContentExtractionReceipt;
  asset: CaseGraphContentAsset;
  contract: CaseGraphContentExtractionContract;
  chunks: CaseGraphContentChunk[];
}) => {
  const expected = makeCaseGraphContentExtractionReceipt({
    asset: params.asset,
    contract: params.contract,
    chunks: params.chunks,
    coverage: params.value.coverage,
    warnings: params.value.warnings,
  });
  if (relationshipInputSha256(params.value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_extraction_receipt_integrity_failed');
  }
  return expected;
};

export const makeCaseGraphContentAccountingReceipt = (params: {
  publication: CaseGraphResearchPublicationBinding;
  discoveryManifest: CaseGraphContentDiscoveryManifest;
  assets: CaseGraphContentAsset[];
  extractions: Array<{
    contract: CaseGraphContentExtractionContract;
    receipt: CaseGraphContentExtractionReceipt;
    chunks: CaseGraphContentChunk[];
  }>;
}): CaseGraphContentAccountingReceipt => {
  const publication = publicationValue(params.publication);
  const discoveryManifest = verifyCaseGraphContentDiscoveryManifest(params.discoveryManifest);
  if (!samePublication(discoveryManifest.publication, publication)) {
    invalid('case_graph_content_accounting_publication_mismatch');
  }
  const assets = params.assets.map(verifyCaseGraphContentAsset).sort((left, right) => compareText(left.assetId, right.assetId));
  if (new Set(assets.map(({ assetId }) => assetId)).size !== assets.length
    || new Set(assets.map(({ discoveryId }) => discoveryId)).size !== assets.length
    || assets.some((asset) => !samePublication(asset.publication, publication))) {
    invalid('case_graph_content_accounting_asset_set_invalid');
  }
  const discoveryById = new Map(discoveryManifest.records.map((record) => [record.discoveryId, record]));
  if (discoveryManifest.recordCount !== assets.length
    || assets.some((asset) => {
      const discovered = discoveryById.get(asset.discoveryId);
      return !discovered || discovered.discoveryDigest !== asset.discoveryDigest;
    })) {
    invalid('case_graph_content_accounting_discovered_mismatch');
  }
  const assetsById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const extractionReceipts = params.extractions.map((entry) => {
    const asset = assetsById.get(entry.receipt.assetId);
    if (!asset || asset.terminalStatus !== 'extracted') {
      return invalid('case_graph_content_accounting_extraction_invalid');
    }
    const contract = verifyCaseGraphContentExtractionContract({ value: entry.contract, asset });
    if (contract.limitsProfile.profileSha256 !== discoveryManifest.limitsProfile.profileSha256) {
      return invalid('case_graph_content_accounting_limits_profile_mismatch');
    }
    const receipt = verifyCaseGraphContentExtractionReceipt({
      value: entry.receipt, asset, contract, chunks: entry.chunks,
    });
    return { contract, receipt, chunks: entry.chunks.map((chunk) => verifyCaseGraphContentChunk({
      value: chunk, asset, contract,
    })) };
  }).sort((left, right) => (
    compareText(left.receipt.assetId, right.receipt.assetId)
      || compareText(left.contract.contractDigest, right.contract.contractDigest)
  ));
  const extractionIdentities = extractionReceipts.map(({ receipt, contract }) => (
    `${receipt.assetId}:${contract.contractDigest}`
  ));
  if (new Set(extractionIdentities).size !== extractionReceipts.length) {
    invalid('case_graph_content_accounting_extraction_invalid');
  }
  const extractedAssets = assets.filter(({ terminalStatus }) => terminalStatus === 'extracted');
  const assetsWithExtraction = new Set(extractionReceipts.map(({ receipt }) => receipt.assetId));
  if (extractedAssets.some(({ assetId }) => !assetsWithExtraction.has(assetId))
    || [...assetsWithExtraction].some((assetId) => !extractedAssets.some((asset) => asset.assetId === assetId))) {
    invalid('case_graph_content_accounting_extraction_missing');
  }
  const terminalStatusCounts = Object.fromEntries(CASE_GRAPH_CONTENT_ASSET_TERMINAL_STATUSES.map((status) => [
    status,
    assets.filter(({ terminalStatus }) => terminalStatus === status).length,
  ])) as Record<CaseGraphContentAssetTerminalStatus, number>;
  const chunks = extractionReceipts.flatMap((entry) => entry.chunks)
    .sort((left, right) => compareText(left.chunkId, right.chunkId));
  if (new Set(chunks.map(({ chunkId }) => chunkId)).size !== chunks.length) {
    invalid('case_graph_content_accounting_chunk_set_invalid');
  }
  const excludedAssetCount = assets.length - extractedAssets.length;
  const permanentFailureCount = terminalStatusCounts.permanent_failed + terminalStatusCounts.corrupt
    + terminalStatusCounts.quarantined;
  const withoutDigest = {
    recordType: 'case_graph_content_accounting_receipt' as const,
    schemaVersion: CASE_GRAPH_CONTENT_RESEARCH_VERSION,
    publication,
    discoveryManifestDigest: discoveryManifest.manifestDigest,
    discoveredAssetCount: assets.length,
    terminalAssetCount: assets.length,
    extractedAssetCount: extractedAssets.length,
    excludedAssetCount,
    permanentFailureCount,
    searchableChunkCount: chunks.length,
    terminalStatusCounts,
    assetSetSha256: relationshipInputSha256(assets.map(({ assetId, assetDigest }) => ({ assetId, assetDigest }))),
    extractionReceiptSetSha256: relationshipInputSha256(extractionReceipts.map(({ receipt, contract }) => ({
      assetId: receipt.assetId,
      extractionContractDigest: contract.contractDigest,
      receiptDigest: receipt.receiptDigest,
    }))),
    chunkSetSha256: relationshipInputSha256(chunks.map(({ chunkId, chunkDigest }) => ({ chunkId, chunkDigest }))),
    accountingComplete: true,
    allDiscoveredContentSearchable: excludedAssetCount === 0 && permanentFailureCount === 0,
    limitations: [
      'Accounting completeness means every discovered asset reached a terminal status; it does not mean every asset was searchable.',
      'Extracted text is untrusted evidence and cannot issue model or tool instructions.',
      'Machine captions and ASR are derived evidence with extractor confidence, not direct observations.',
    ],
  };
  return { ...withoutDigest, receiptDigest: relationshipInputSha256(withoutDigest) };
};

export const verifyCaseGraphContentAccountingReceipt = (params: {
  value: CaseGraphContentAccountingReceipt;
  publication: CaseGraphResearchPublicationBinding;
  discoveryManifest: CaseGraphContentDiscoveryManifest;
  assets: CaseGraphContentAsset[];
  extractions: Array<{
    contract: CaseGraphContentExtractionContract;
    receipt: CaseGraphContentExtractionReceipt;
    chunks: CaseGraphContentChunk[];
  }>;
}) => {
  const expected = makeCaseGraphContentAccountingReceipt(params);
  if (relationshipInputSha256(params.value) !== relationshipInputSha256(expected)) {
    invalid('case_graph_content_accounting_integrity_failed');
  }
  return expected;
};
