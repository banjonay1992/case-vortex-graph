import {
  makeCaseGraphContentAsset,
  makeCaseGraphContentLimitsProfile,
  type CaseGraphContentExtractor,
} from '../../src/caseGraph/contentResearchArchive';
import type { CaseGraphResearchPublicationBinding } from '../../src/caseGraph/researchToolContract';

const digest = (character: string) => character.repeat(64);
const publication: CaseGraphResearchPublicationBinding = {
  publicationId: '00000000-0000-4000-8000-000000000001', corpusVersion: 'image-test-v1',
  manifestSha256: digest('1'), snapshotId: 'snapshot-image', graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1', relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'), relationshipModelId: 'model', relationshipModelVersion: 'v1',
  relationshipModelSha256: digest('4'), calibrationSetSha256: digest('5'),
};
export const imageLimits = makeCaseGraphContentLimitsProfile({
  profileId: 'image-limits', maxAssetBytes: 100_000, maxDocumentPages: 10,
  maxImagePixels: 1_000_000, maxTimedMediaDurationMs: 60_000, maxChunkTextBytes: 8,
  maxTotalTextBytesPerAsset: 1_000, maxChunksPerAsset: 100,
});
export const imageAsset = makeCaseGraphContentAsset({
  publication, address: 'photo:00000000-0000-4000-8000-000000000010', nodeDigest: digest('6'),
  sourceAssetKey: 'canonical-url:https://example.test/image.jpg', mediaKind: 'image',
  claimedMimeType: 'application/octet-stream', sniffedMimeType: 'image/jpeg', byteLength: 100,
  bytesSha256: digest('7'), capturedObjectKey: 'captured/image.bin', capturedObjectSha256: digest('7'),
  searchableObjectKey: 'captured/image.bin', searchableBytesSha256: digest('7'), pageCount: null,
  imageWidth: 100, imageHeight: 50, durationMs: null, sourceLocatorDigest: digest('8'),
  sourceLineageDigest: digest('9'), visibility: 'public', rightsPolicyVersion: 'rights-v1',
  rightsEvidenceDigest: digest('a'), safetyPolicyVersion: 'safety-v1', safetyScanDigest: digest('b'),
  redactionPolicyDigest: digest('c'), redactionStatus: 'not_required', redactionTransformationDigest: null,
  terminalStatus: 'extracted', terminalReason: 'fixture',
});
export const imageExtractor = <T extends 'metadata' | 'ocr'>(extractorType: T, hash: string) => ({
  extractorType, extractorId: `${extractorType}-image`, extractorVersion: '1.0.0',
  containerDigest: digest(hash), modelId: extractorType === 'ocr' ? 'tesseract-eng' : null,
  modelRevision: extractorType === 'ocr' ? '5.x' : null, configDigest: digest('e'), promptDigest: null,
  humanProvenanceDigest: null, languageDetectorVersion: 'fixed-en-v1',
} satisfies CaseGraphContentExtractor & { extractorType: T });
