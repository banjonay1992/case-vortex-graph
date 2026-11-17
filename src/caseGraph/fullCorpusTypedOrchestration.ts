import { createHash } from 'node:crypto';

import { getEvidenceUniverseControlKeys } from './archiveKeys';
import type { CaseGraphConditionalArchiveStorage } from './archiveTypes';
import {
  getAuthoritativeCalibrationHumanReviewEvidence,
  type AuthoritativeCalibrationHumanReviewEvidence,
} from './calibrationHumanReview';
import {
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  decodeContextualRelationshipCalibrationArtifact,
  decodeContextualRelationshipCalibrationTrustPolicy,
} from './contextualRelationshipCalibration';
import {
  assertContextualRelationshipCompletionProductionEligible,
  type ContextualRelationshipCompletionArtifact,
} from './contextualRelationshipCompletion';
import {
  decodeCaseVortexAccountingPublicationBinding,
  decodeCaseVortexCorpusAccountingReceipt,
  type CaseVortexAccountingPublicationBinding,
} from './corpusAccountingIntegration';
import {
  decodeEvidenceUniverseCompletion,
  decodeEvidenceUniverseNodePart,
} from './evidenceUniversePublicAccess';
import type { EvidenceUniverseNode } from './evidenceUniverse';
import {
  assertFullCorpusProductionCompatibility,
  createFullCorpusProductionCompatibilityAccumulator,
  writeFullCorpusProductionCompatibilityReceipt,
  type FullCorpusProductionCompatibilityPointer,
  type FullCorpusProductionCompatibilityReceipt,
} from './fullCorpusProductionCompatibility';
import {
  buildCaseGraphPublicationCandidate,
  type CaseGraphPublicationLineageReceipts,
} from './publicationArchive';
import {
  decodeRelationshipInputPart,
  decodeRelationshipInputPartManifest,
  decodeRelationshipInputSnapshotManifest,
  getRelationshipInputControlKeys,
  type RelationshipInputPartManifest,
  type RelationshipInputPartSummary,
  type RelationshipInputSnapshotManifest,
} from './relationshipInputArchive';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  assertTypedRelationshipCalibrationReceiptProductionEligible,
  decodeTypedRelationshipCalibrationArtifact,
  decodeTypedRelationshipCalibrationTrustPolicy,
} from './typedRelationshipCalibration';
import { buildTypedRelationshipRarityIndex } from './typedRelationshipEngine';
import {
  buildFullCorpusPostingFragments,
  buildFullCorpusPostingMapManifest,
  buildFullCorpusRelationshipCompletion,
  reduceFullCorpusCandidateShard,
  reduceFullCorpusPostingShard,
  type FullCorpusPairReducerResult,
  type FullCorpusPostingCaps,
  type FullCorpusPostingFragment,
  type FullCorpusPostingMapManifest,
  type FullCorpusPostingShardReduction,
  type FullCorpusRelationshipCompletion,
} from './typedRelationshipPipeline';
import {
  archiveFullCorpusRelationshipRun,
  type FullCorpusRelationshipRunIndexPointer,
} from './typedRelationshipPipelineArchive';
import {
  buildFullCorpusPublicGraphArtifacts,
  writeFullCorpusPublicGraphArtifacts,
  type FullCorpusPublicGraphManifest,
  type FullCorpusPublicNode,
} from './typedRelationshipPublicGraph';
import {
  buildFullCorpusPublicDensityArchiveObject,
  buildFullCorpusPublicDensityArtifact,
  decodeFullCorpusPublicDensityArchiveObject,
  type FullCorpusPublicDensityPointer,
} from './typedPublicDensity';

export const FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION =
  'full-corpus-typed-orchestration-request-v2' as const;
export const FULL_CORPUS_TYPED_GRAPH_INPUT_VERSION =
  'full-corpus-typed-graph-input-v1' as const;

export type FullCorpusTypedObjectReference = {
  key: string;
  sha256: string;
};

export type FullCorpusTypedOrchestrationTopology = {
  postingShardCount: number;
  pairShardCount: number;
  addressLedgerShardCount: number;
  renderShardCount: number;
  nodeShardCount: number;
  edgeShardCount: number;
  evaluationShardCount: number;
  egoShardCount: number;
  maxPostingsPerRecord: number;
  maxCandidatePairsPerPairShard: number;
  postingCaps: FullCorpusPostingCaps;
};

export type FullCorpusTypedOrchestrationRequest = {
  recordType: 'full_corpus_typed_orchestration_request';
  schemaVersion: typeof FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION;
  corpusVersion: string;
  calibration: {
    humanReviewBundle: FullCorpusTypedObjectReference;
    pairReceipt: FullCorpusTypedObjectReference;
    pairArtifact: FullCorpusTypedObjectReference;
    pairTrustPolicy: FullCorpusTypedObjectReference;
    contextualReceipt: FullCorpusTypedObjectReference;
    contextualArtifact: FullCorpusTypedObjectReference;
    contextualTrustPolicy: FullCorpusTypedObjectReference;
  };
  contextualRelationshipCompletion: FullCorpusTypedObjectReference;
  topology: FullCorpusTypedOrchestrationTopology;
  publication: null | {
    generatedAt: string;
    accountingBinding: FullCorpusTypedObjectReference;
    accountingReceipt: FullCorpusTypedObjectReference;
  };
  requestDigest: string;
};

export type FullCorpusTypedRelationshipBuild = {
  relationshipInputManifest: RelationshipInputSnapshotManifest;
  records: RelationshipInputRecord[];
  postingFragments: FullCorpusPostingFragment[];
  postingMap: FullCorpusPostingMapManifest;
  postingReductions: FullCorpusPostingShardReduction[];
  pairReducers: FullCorpusPairReducerResult[];
  completion: FullCorpusRelationshipCompletion;
};

export type FullCorpusTypedGraphReceipt = {
  status: 'complete';
  corpusVersion: string;
  requestDigest: string;
  relationshipRun: FullCorpusRelationshipRunIndexPointer;
  publicGraph: {
    manifestDigest: string;
    manifestReceiptKey: string;
    shardSetSha256: string;
    shardCount: number;
  };
  density: FullCorpusPublicDensityPointer;
  writes: {
    relationship: { written: number; reused: number };
    publicGraph: { written: number; reused: number };
    density: 'written' | 'reused';
    productionCompatibility: 'written' | 'reused';
  };
  accounting: {
    universeRecordCount: number;
    candidatePairCount: number;
    typedEdgeCount: number;
    contextualAcceptedEdgeCount: number;
    contextualInsufficientEvidenceCount: number;
    productionCompatibility: FullCorpusProductionCompatibilityReceipt;
    productionCompatibilityPointer: FullCorpusProductionCompatibilityPointer;
  };
};

type LoadedCalibration = {
  humanReviewBundleBody: Buffer;
  humanReviewEvidence: AuthoritativeCalibrationHumanReviewEvidence;
  pairReceiptBody: Buffer;
  contextualReceiptBody: Buffer;
  pairArtifactBody: Buffer;
  pairTrustPolicyBody: Buffer;
  contextualArtifactBody: Buffer;
  contextualTrustPolicyBody: Buffer;
  pairArtifact: ReturnType<typeof decodeTypedRelationshipCalibrationArtifact>;
  contextualArtifact: ReturnType<typeof decodeContextualRelationshipCalibrationArtifact>;
};

type DecodedCalibrationCacheEntry = Pick<
  LoadedCalibration,
  'pairArtifact' | 'contextualArtifact'
> & {
  pairReceipt: ReturnType<typeof assertTypedRelationshipCalibrationReceiptProductionEligible>;
  contextualReceipt: ReturnType<typeof assertContextualRelationshipCalibrationReceiptProductionEligible>;
};

const DECODED_CALIBRATION_CACHE_MAX = 16;
const decodedCalibrationCache = new Map<string, DecodedCalibrationCacheEntry>();

type LoadedInputs = {
  universeNodes: EvidenceUniverseNode[];
  productionCompatibility: FullCorpusProductionCompatibilityReceipt;
  relationshipInputManifest: RelationshipInputSnapshotManifest;
  relationshipInputParts: Array<{ partNumber: number; records: RelationshipInputRecord[] }>;
  contextualCompletionBody: Buffer;
  contextualCompletion: ContextualRelationshipCompletionArtifact;
  expectedContextualCalibration: { receiptId: string; receiptSha256: string };
  calibration: LoadedCalibration;
};

type ExecutedGraph = {
  receipt: FullCorpusTypedGraphReceipt;
  relationship: FullCorpusTypedRelationshipBuild;
  publicGraphManifest: FullCorpusPublicGraphManifest;
  publicGraphManifestReceiptKey: string;
  density: FullCorpusPublicDensityPointer;
  loaded: LoadedInputs;
};

type LoadedPublicationAccounting = {
  binding: CaseVortexAccountingPublicationBinding;
  receiptBody: Buffer;
};

const SHA256 = /^[a-f0-9]{64}$/;
const CORPUS_VERSION = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const OBJECT_KEYS = ['key', 'sha256'] as const;
const POSTING_CAP_KEYS: Array<keyof FullCorpusPostingCaps> = [
  'addressIdentity',
  'sourceIdentity',
  'sourceRecord',
  'sourceLineage',
  'duplicateCluster',
  'matchableValue',
  'spaceTime',
  'duration',
  'maxPairsPerGroup',
  'maxCandidatePairsPerPostingShard',
];

function invalid(code: string): never {
  throw new Error(code);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exact = (
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> => {
  if (!isPlainObject(value)) invalid(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(code);
  }
  return value;
};

const safeInteger = (value: unknown, minimum: number, maximum: number, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(code);
  return Number(value);
};

const parseJson = (body: Buffer, code: string): unknown => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return invalid(code);
  }
};

const decodeReference = (value: unknown): FullCorpusTypedObjectReference => {
  const reference = exact(value, OBJECT_KEYS, 'full_corpus_typed_orchestration_reference_invalid');
  if (typeof reference.key !== 'string'
    || !reference.key.startsWith('case-vortex/')
    || reference.key.length > 2_048
    || /(?:^|\/)\.\.(?:\/|$)/.test(reference.key)
    || typeof reference.sha256 !== 'string'
    || !SHA256.test(reference.sha256)) {
    invalid('full_corpus_typed_orchestration_reference_invalid');
  }
  return { key: reference.key, sha256: reference.sha256 };
};

const decodeTopology = (value: unknown): FullCorpusTypedOrchestrationTopology => {
  const topology = exact(value, [
    'postingShardCount', 'pairShardCount', 'addressLedgerShardCount', 'renderShardCount',
    'nodeShardCount', 'edgeShardCount', 'evaluationShardCount', 'egoShardCount',
    'maxPostingsPerRecord', 'maxCandidatePairsPerPairShard', 'postingCaps',
  ], 'full_corpus_typed_orchestration_topology_invalid');
  const caps = exact(topology.postingCaps, POSTING_CAP_KEYS,
    'full_corpus_typed_orchestration_posting_caps_invalid');
  const postingCaps = Object.fromEntries(POSTING_CAP_KEYS.map((key) => [
    key,
    safeInteger(caps[key], 1, 10_000_000, 'full_corpus_typed_orchestration_posting_caps_invalid'),
  ])) as FullCorpusPostingCaps;
  return {
    postingShardCount: safeInteger(topology.postingShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    pairShardCount: safeInteger(topology.pairShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    addressLedgerShardCount: safeInteger(topology.addressLedgerShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    renderShardCount: safeInteger(topology.renderShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    nodeShardCount: safeInteger(topology.nodeShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    edgeShardCount: safeInteger(topology.edgeShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    evaluationShardCount: safeInteger(topology.evaluationShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    egoShardCount: safeInteger(topology.egoShardCount, 1, 4_096,
      'full_corpus_typed_orchestration_topology_invalid'),
    maxPostingsPerRecord: safeInteger(topology.maxPostingsPerRecord, 8, 100_000,
      'full_corpus_typed_orchestration_topology_invalid'),
    maxCandidatePairsPerPairShard: safeInteger(topology.maxCandidatePairsPerPairShard, 1, 10_000_000,
      'full_corpus_typed_orchestration_topology_invalid'),
    postingCaps,
  };
};

const requestWithoutDigest = (
  request: Omit<FullCorpusTypedOrchestrationRequest, 'requestDigest'>,
) => request;

export const decodeFullCorpusTypedOrchestrationRequest = (
  input: Buffer | string | unknown,
): FullCorpusTypedOrchestrationRequest => {
  let value: unknown = input;
  let raw: string | null = null;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    raw = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    try {
      value = JSON.parse(raw);
    } catch {
      invalid('full_corpus_typed_orchestration_request_json_invalid');
    }
  }
  const request = exact(value, [
    'recordType', 'schemaVersion', 'corpusVersion', 'calibration',
    'contextualRelationshipCompletion', 'topology', 'publication', 'requestDigest',
  ], 'full_corpus_typed_orchestration_request_invalid');
  const calibration = exact(request.calibration, [
    'humanReviewBundle', 'pairReceipt', 'pairArtifact', 'pairTrustPolicy', 'contextualReceipt',
    'contextualArtifact', 'contextualTrustPolicy',
  ], 'full_corpus_typed_orchestration_calibration_invalid');
  if (request.recordType !== 'full_corpus_typed_orchestration_request'
    || request.schemaVersion !== FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION
    || typeof request.corpusVersion !== 'string'
    || !CORPUS_VERSION.test(request.corpusVersion)
    || typeof request.requestDigest !== 'string'
    || !SHA256.test(request.requestDigest)) {
    invalid('full_corpus_typed_orchestration_request_invalid');
  }
  let publication: FullCorpusTypedOrchestrationRequest['publication'] = null;
  if (request.publication !== null) {
    const rawPublication = exact(request.publication, [
      'generatedAt', 'accountingBinding', 'accountingReceipt',
    ], 'full_corpus_typed_orchestration_publication_invalid');
    if (typeof rawPublication.generatedAt !== 'string') {
      invalid('full_corpus_typed_orchestration_publication_invalid');
    }
    const generated = new Date(rawPublication.generatedAt);
    if (!Number.isFinite(generated.getTime()) || generated.toISOString() !== rawPublication.generatedAt) {
      invalid('full_corpus_typed_orchestration_publication_invalid');
    }
    publication = {
      generatedAt: rawPublication.generatedAt,
      accountingBinding: decodeReference(rawPublication.accountingBinding),
      accountingReceipt: decodeReference(rawPublication.accountingReceipt),
    };
  }
  const withoutDigest: Omit<FullCorpusTypedOrchestrationRequest, 'requestDigest'> = {
    recordType: 'full_corpus_typed_orchestration_request',
    schemaVersion: FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION,
    corpusVersion: request.corpusVersion,
    calibration: {
      humanReviewBundle: decodeReference(calibration.humanReviewBundle),
      pairReceipt: decodeReference(calibration.pairReceipt),
      pairArtifact: decodeReference(calibration.pairArtifact),
      pairTrustPolicy: decodeReference(calibration.pairTrustPolicy),
      contextualReceipt: decodeReference(calibration.contextualReceipt),
      contextualArtifact: decodeReference(calibration.contextualArtifact),
      contextualTrustPolicy: decodeReference(calibration.contextualTrustPolicy),
    },
    contextualRelationshipCompletion: decodeReference(request.contextualRelationshipCompletion),
    topology: decodeTopology(request.topology),
    publication,
  };
  const decoded: FullCorpusTypedOrchestrationRequest = {
    ...withoutDigest,
    requestDigest: relationshipInputSha256(requestWithoutDigest(withoutDigest)),
  };
  if (decoded.requestDigest !== request.requestDigest) {
    invalid('full_corpus_typed_orchestration_request_digest_mismatch');
  }
  if (raw !== null && raw !== `${canonicalizeRelationshipInput(decoded)}\n`) {
    invalid('full_corpus_typed_orchestration_request_noncanonical');
  }
  return decoded;
};

export const encodeFullCorpusTypedOrchestrationRequest = (
  request: FullCorpusTypedOrchestrationRequest,
) => Buffer.from(`${canonicalizeRelationshipInput(decodeFullCorpusTypedOrchestrationRequest(request))}\n`, 'utf8');

export const buildFullCorpusTypedOrchestrationRequest = (
  request: Omit<FullCorpusTypedOrchestrationRequest, 'recordType' | 'schemaVersion' | 'requestDigest'>,
): FullCorpusTypedOrchestrationRequest => decodeFullCorpusTypedOrchestrationRequest({
  recordType: 'full_corpus_typed_orchestration_request',
  schemaVersion: FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION,
  ...request,
  requestDigest: relationshipInputSha256(requestWithoutDigest({
    recordType: 'full_corpus_typed_orchestration_request',
    schemaVersion: FULL_CORPUS_TYPED_ORCHESTRATION_REQUEST_VERSION,
    ...request,
  })),
});

export const getFullCorpusTypedGraphInputBinding = (
  request: FullCorpusTypedOrchestrationRequest,
) => ({
  schemaVersion: FULL_CORPUS_TYPED_GRAPH_INPUT_VERSION,
  requestDigest: relationshipInputSha256({
    schemaVersion: FULL_CORPUS_TYPED_GRAPH_INPUT_VERSION,
    corpusVersion: request.corpusVersion,
    calibration: request.calibration,
    contextualRelationshipCompletion: request.contextualRelationshipCompletion,
    topology: request.topology,
  }),
});

const rawSha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const readReferencedObject = async (
  storage: CaseGraphConditionalArchiveStorage,
  reference: FullCorpusTypedObjectReference,
) => {
  const body = await storage.readObject(reference.key);
  if (!body) invalid(`full_corpus_typed_orchestration_referenced_object_missing:${reference.key}`);
  if (rawSha256(body) !== reference.sha256) {
    invalid(`full_corpus_typed_orchestration_referenced_object_digest_mismatch:${reference.key}`);
  }
  return body;
};

const relationshipBindingFromUniverse = (
  universe: ReturnType<typeof decodeEvidenceUniverseCompletion>,
): RelationshipInputUniverseBinding => ({
  snapshotId: universe.expected.snapshotId,
  corpusVersion: universe.corpusVersion,
  universeArchiveVersion: universe.archiveVersion,
  universeSchemaVersion: universe.schemaVersion,
  universeLayoutVersion: universe.layoutVersion,
  universeArchiveSetSha256: universe.archiveSetSha256,
  universeRecordCount: universe.expected.total,
});

const partSummary = (manifest: RelationshipInputPartManifest): RelationshipInputPartSummary => ({
  partNumber: manifest.partNumber,
  archiveKey: manifest.archiveKey,
  manifestKey: manifest.manifestKey,
  rowCount: manifest.rowCount,
  firstAddress: manifest.firstAddress,
  lastAddress: manifest.lastAddress,
  uncompressedBytes: manifest.uncompressedBytes,
  compressedBytes: manifest.compressedBytes,
  compressedSha256: manifest.compressedSha256,
  recordSetSha256: manifest.recordSetSha256,
  accounting: manifest.accounting,
});

const loadArchivedInputs = async (
  storage: CaseGraphConditionalArchiveStorage,
  request: FullCorpusTypedOrchestrationRequest,
) => {
  const corpusVersion = request.corpusVersion;
  const universeBody = await storage.readObject(
    getEvidenceUniverseControlKeys(corpusVersion).completionManifestKey,
  );
  if (!universeBody) invalid('full_corpus_typed_orchestration_universe_completion_missing');
  const universe = decodeEvidenceUniverseCompletion(universeBody, corpusVersion);
  const binding = relationshipBindingFromUniverse(universe);
  const relationshipInputBody = await storage.readObject(
    getRelationshipInputControlKeys(binding).completionManifestKey,
  );
  if (!relationshipInputBody) invalid('full_corpus_typed_orchestration_relationship_input_completion_missing');
  const relationshipInputManifest = decodeRelationshipInputSnapshotManifest(
    relationshipInputBody,
    binding,
  );
  const relationshipInputParts: Array<{ partNumber: number; records: RelationshipInputRecord[] }> = [];
  for (const summary of relationshipInputManifest.parts) {
    const [manifestBody, archiveBody] = await Promise.all([
      storage.readObject(summary.manifestKey),
      storage.readObject(summary.archiveKey),
    ]);
    if (!manifestBody || !archiveBody) {
      invalid('full_corpus_typed_orchestration_relationship_input_part_missing');
    }
    const manifest = decodeRelationshipInputPartManifest(manifestBody, binding);
    if (canonicalizeRelationshipInput(partSummary(manifest)) !== canonicalizeRelationshipInput(summary)) {
      invalid('full_corpus_typed_orchestration_relationship_input_part_manifest_mismatch');
    }
    const decoded = decodeRelationshipInputPart(archiveBody, manifest, binding);
    relationshipInputParts.push({ partNumber: summary.partNumber, records: decoded.records });
  }
  const universeNodes: EvidenceUniverseNode[] = [];
  const compatibilityAccumulator = createFullCorpusProductionCompatibilityAccumulator({
    universe: binding,
    orchestrationRequest: getFullCorpusTypedGraphInputBinding(request),
  });
  for (const part of universe.parts) {
    const body = await storage.readObject(part.archiveKey);
    if (!body) invalid('full_corpus_typed_orchestration_universe_part_missing');
    const decoded = decodeEvidenceUniverseNodePart(body, part);
    for (const node of decoded.nodes) {
      compatibilityAccumulator.add(node);
      universeNodes.push(node);
    }
  }
  universeNodes.sort((left, right) => left.address.localeCompare(right.address));
  if (universeNodes.length !== binding.universeRecordCount
    || new Set(universeNodes.map((node) => node.address)).size !== universeNodes.length) {
    invalid('full_corpus_typed_orchestration_universe_accounting_mismatch');
  }
  const productionCompatibility = assertFullCorpusProductionCompatibility(
    compatibilityAccumulator.finish(),
  );
  return {
    binding,
    universeNodes,
    productionCompatibility,
    relationshipInputManifest,
    relationshipInputParts,
  };
};

const loadCalibration = async (
  storage: CaseGraphConditionalArchiveStorage,
  request: FullCorpusTypedOrchestrationRequest,
  binding: RelationshipInputUniverseBinding,
): Promise<LoadedCalibration & {
  pairReceipt: ReturnType<typeof assertTypedRelationshipCalibrationReceiptProductionEligible>;
  contextualReceipt: ReturnType<typeof assertContextualRelationshipCalibrationReceiptProductionEligible>;
}> => {
  const [
    humanReviewBundleBody,
    pairReceiptBody,
    pairArtifactBody,
    pairTrustPolicyBody,
    contextualReceiptBody,
    contextualArtifactBody,
    contextualTrustPolicyBody,
  ] = await Promise.all([
    readReferencedObject(storage, request.calibration.humanReviewBundle),
    readReferencedObject(storage, request.calibration.pairReceipt),
    readReferencedObject(storage, request.calibration.pairArtifact),
    readReferencedObject(storage, request.calibration.pairTrustPolicy),
    readReferencedObject(storage, request.calibration.contextualReceipt),
    readReferencedObject(storage, request.calibration.contextualArtifact),
    readReferencedObject(storage, request.calibration.contextualTrustPolicy),
  ]);
  const humanReviewEvidence = getAuthoritativeCalibrationHumanReviewEvidence({
    bundleBody: humanReviewBundleBody,
    pairReceiptBody,
    pairArtifactBody,
    pairTrustPolicyBody,
    contextualReceiptBody,
    contextualArtifactBody,
    contextualTrustPolicyBody,
  });
  const decodedCacheKey = relationshipInputSha256({
    schemaVersion: 'full-corpus-decoded-calibration-cache-v1',
    binding,
    calibration: request.calibration,
  });
  const cached = decodedCalibrationCache.get(decodedCacheKey);
  if (cached) {
    return {
      humanReviewBundleBody,
      pairReceiptBody,
      contextualReceiptBody,
      pairArtifactBody,
      pairTrustPolicyBody,
      contextualArtifactBody,
      contextualTrustPolicyBody,
      humanReviewEvidence,
      ...cached,
    };
  }
  const pairReceipt = assertTypedRelationshipCalibrationReceiptProductionEligible(pairReceiptBody);
  const contextualReceipt = assertContextualRelationshipCalibrationReceiptProductionEligible(contextualReceiptBody);
  const pairTrustPolicy = decodeTypedRelationshipCalibrationTrustPolicy(
    parseJson(pairTrustPolicyBody, 'full_corpus_typed_orchestration_pair_trust_policy_json_invalid'),
  );
  const contextualTrustPolicy = decodeContextualRelationshipCalibrationTrustPolicy(
    parseJson(contextualTrustPolicyBody, 'full_corpus_typed_orchestration_contextual_trust_policy_json_invalid'),
  );
  const pairArtifact = decodeTypedRelationshipCalibrationArtifact(
    pairArtifactBody,
    binding,
    pairTrustPolicy,
  );
  const contextualArtifact = decodeContextualRelationshipCalibrationArtifact(
    contextualArtifactBody,
    binding,
    contextualTrustPolicy,
  );
  if (pairArtifact.receipt.receiptId !== pairReceipt.receiptId
    || pairArtifact.receipt.receiptSha256 !== pairReceipt.receiptSha256
    || contextualArtifact.receipt.receiptId !== contextualReceipt.receiptId
    || contextualArtifact.receipt.receiptSha256 !== contextualReceipt.receiptSha256) {
    invalid('full_corpus_typed_orchestration_calibration_receipt_artifact_mismatch');
  }
  if (decodedCalibrationCache.size >= DECODED_CALIBRATION_CACHE_MAX) {
    const oldest = decodedCalibrationCache.keys().next().value;
    if (typeof oldest === 'string') decodedCalibrationCache.delete(oldest);
  }
  decodedCalibrationCache.set(decodedCacheKey, {
    pairArtifact,
    contextualArtifact,
    pairReceipt,
    contextualReceipt,
  });
  return {
    humanReviewBundleBody,
    pairReceiptBody,
    contextualReceiptBody,
    pairArtifactBody,
    pairTrustPolicyBody,
    contextualArtifactBody,
    contextualTrustPolicyBody,
    pairArtifact,
    contextualArtifact,
    pairReceipt,
    contextualReceipt,
    humanReviewEvidence,
  };
};

const loadInputs = async (
  storage: CaseGraphConditionalArchiveStorage,
  request: FullCorpusTypedOrchestrationRequest,
): Promise<LoadedInputs> => {
  const archived = await loadArchivedInputs(storage, request);
  const calibration = await loadCalibration(storage, request, archived.binding);
  const contextualCompletionBody = await readReferencedObject(
    storage,
    request.contextualRelationshipCompletion,
  );
  const expectedContextualCalibration = {
    receiptId: calibration.contextualReceipt.receiptId,
    receiptSha256: calibration.contextualReceipt.receiptSha256,
  };
  const contextualCompletion = assertContextualRelationshipCompletionProductionEligible(
    contextualCompletionBody,
    archived.binding,
    expectedContextualCalibration,
  );
  return {
    universeNodes: archived.universeNodes,
    productionCompatibility: archived.productionCompatibility,
    relationshipInputManifest: archived.relationshipInputManifest,
    relationshipInputParts: archived.relationshipInputParts,
    contextualCompletionBody,
    contextualCompletion,
    expectedContextualCalibration,
    calibration,
  };
};

export const buildFullCorpusTypedRelationship = (params: {
  relationshipInputManifest: RelationshipInputSnapshotManifest;
  relationshipInputParts: readonly { partNumber: number; records: readonly RelationshipInputRecord[] }[];
  contextualCompletion: ContextualRelationshipCompletionArtifact;
  expectedContextualCalibration: { receiptId: string; receiptSha256: string };
  topology: FullCorpusTypedOrchestrationTopology;
}): FullCorpusTypedRelationshipBuild => {
  const relationshipInputManifest = decodeRelationshipInputSnapshotManifest(params.relationshipInputManifest);
  const parts = [...params.relationshipInputParts]
    .sort((left, right) => left.partNumber - right.partNumber);
  if (parts.length !== relationshipInputManifest.partCount
    || parts.some((part, index) => part.partNumber !== index)) {
    invalid('full_corpus_typed_orchestration_relationship_input_parts_incomplete');
  }
  const records = parts.flatMap((part) => [...part.records]);
  const rarityIndex = buildTypedRelationshipRarityIndex(records, relationshipInputManifest.binding);
  const postingFragments = parts.flatMap((part) => buildFullCorpusPostingFragments({
    records: part.records,
    inputPartNumber: part.partNumber,
    relationshipInputManifest,
    rarityIndex,
    postingShardCount: params.topology.postingShardCount,
    maxPostingsPerRecord: params.topology.maxPostingsPerRecord,
  }));
  const postingMap = buildFullCorpusPostingMapManifest({
    relationshipInputManifest,
    rarityIndex,
    postingShardCount: params.topology.postingShardCount,
    fragments: postingFragments,
  });
  if (params.contextualCompletion.calibrationReceipt.receiptId
    !== params.expectedContextualCalibration.receiptId
    || params.contextualCompletion.calibrationReceipt.receiptSha256
    !== params.expectedContextualCalibration.receiptSha256) {
    invalid('full_corpus_typed_orchestration_contextual_calibration_mismatch');
  }
  const postingReductions = Array.from(
    { length: params.topology.postingShardCount },
    (_, postingShard) => reduceFullCorpusPostingShard({
      postingMap,
      fragments: postingFragments.filter((fragment) => fragment.postingShard === postingShard),
      postingShard,
      pairShardCount: params.topology.pairShardCount,
      caps: params.topology.postingCaps,
    }),
  );
  const candidateFragments = postingReductions.flatMap((reduction) => reduction.candidateFragments);
  const pairReducers = Array.from(
    { length: params.topology.pairShardCount },
    (_, pairShard) => reduceFullCorpusCandidateShard({
      postingMap,
      rarityIndex,
      fragments: candidateFragments.filter((fragment) => fragment.pairShard === pairShard),
      pairShard,
      pairShardCount: params.topology.pairShardCount,
      maxCandidatePairs: params.topology.maxCandidatePairsPerPairShard,
    }),
  );
  const completion = buildFullCorpusRelationshipCompletion({
    postingMap,
    postingReductions,
    pairReducers,
    contextualCompletion: params.contextualCompletion,
    expectedContextualCalibration: params.expectedContextualCalibration,
    addressLedgerShardCount: params.topology.addressLedgerShardCount,
  });
  return {
    relationshipInputManifest,
    records,
    postingFragments,
    postingMap,
    postingReductions,
    pairReducers,
    completion,
  };
};

const countStatuses = (values: readonly ('written' | 'reused')[]) => ({
  written: values.filter((value) => value === 'written').length,
  reused: values.filter((value) => value === 'reused').length,
});

const writeDensity = async (
  storage: CaseGraphConditionalArchiveStorage,
  archive: ReturnType<typeof buildFullCorpusPublicDensityArchiveObject>,
) => {
  const result = await storage.uploadFileConditional(archive.body, archive.pointer.archiveKey, {
    contentType: 'application/json',
    contentEncoding: 'gzip',
    cacheControl: 'public, max-age=31536000, immutable',
    contentLength: archive.body.length,
  }, { ifAbsent: true });
  if (result.status === 'precondition_failed') {
    const existing = await storage.readObjectVersioned(archive.pointer.archiveKey);
    if (!existing || !existing.body.equals(archive.body)) {
      invalid('full_corpus_typed_orchestration_density_immutable_collision');
    }
  }
  const stored = await storage.readObject(archive.pointer.archiveKey);
  if (!stored) invalid('full_corpus_typed_orchestration_density_read_after_write_missing');
  decodeFullCorpusPublicDensityArchiveObject({ pointer: archive.pointer, body: stored });
  return result.status === 'written' ? 'written' as const : 'reused' as const;
};

const executeGraph = async (
  storage: CaseGraphConditionalArchiveStorage,
  request: FullCorpusTypedOrchestrationRequest,
): Promise<ExecutedGraph> => {
  const loaded = await loadInputs(storage, request);
  const relationship = buildFullCorpusTypedRelationship({
    relationshipInputManifest: loaded.relationshipInputManifest,
    relationshipInputParts: loaded.relationshipInputParts,
    contextualCompletion: loaded.contextualCompletion,
    expectedContextualCalibration: loaded.expectedContextualCalibration,
    topology: request.topology,
  });
  const pairLineage = loaded.calibration.pairArtifact.lineage;
  const rarityIndex = buildTypedRelationshipRarityIndex(
    relationship.records,
    relationship.relationshipInputManifest.binding,
  );
  if (pairLineage.relationshipInput.archiveSetSha256
      !== relationship.relationshipInputManifest.archiveSetSha256
    || pairLineage.relationshipInput.manifestDigest
      !== relationship.relationshipInputManifest.manifestDigest
    || pairLineage.relationshipInput.recordCount !== relationship.records.length
    || pairLineage.relationshipInput.recordSetSha256 !== rarityIndex.recordSetSha256
    || pairLineage.rarity.indexDigest !== rarityIndex.indexDigest
    || pairLineage.rarity.recordSetSha256 !== rarityIndex.recordSetSha256) {
    invalid('full_corpus_typed_orchestration_pair_calibration_lineage_mismatch');
  }
  const productionCompatibilityArchive = await writeFullCorpusProductionCompatibilityReceipt({
    storage,
    receipt: loaded.productionCompatibility,
  });
  const relationshipArchive = await archiveFullCorpusRelationshipRun({
    storage,
    postingFragments: relationship.postingFragments,
    postingMap: relationship.postingMap,
    postingReductions: relationship.postingReductions,
    pairReducers: relationship.pairReducers,
    contextualCompletion: loaded.contextualCompletion,
    expectedContextualCalibration: loaded.expectedContextualCalibration,
    completion: relationship.completion,
  });
  const runArtifactReceipts = await Promise.all(relationshipArchive.index.objects.map(async (entry) => {
    const body = await storage.readObject(entry.receiptKey);
    if (!body) invalid('full_corpus_typed_orchestration_relationship_receipt_missing');
    return body;
  }));
  const publicGraph = buildFullCorpusPublicGraphArtifacts({
    universeNodes: loaded.universeNodes,
    postingFragments: relationship.postingFragments,
    postingMap: relationship.postingMap,
    postingReductions: relationship.postingReductions,
    pairReducers: relationship.pairReducers,
    contextualRelationshipCompletion: loaded.contextualCompletionBody,
    expectedContextualCalibrationReceiptId: loaded.expectedContextualCalibration.receiptId,
    expectedContextualCalibrationReceiptSha256: loaded.expectedContextualCalibration.receiptSha256,
    completion: relationship.completion,
    runIndexPointer: relationshipArchive.indexPointer,
    runIndexArchiveBody: relationshipArchive.indexArtifact.archiveBody,
    runIndexReceipt: relationshipArchive.indexArtifact.receipt,
    runArtifactReceipts,
    renderShardCount: request.topology.renderShardCount,
    nodeShardCount: request.topology.nodeShardCount,
    edgeShardCount: request.topology.edgeShardCount,
    evaluationShardCount: request.topology.evaluationShardCount,
    egoShardCount: request.topology.egoShardCount,
  });
  const publicGraphArchive = await writeFullCorpusPublicGraphArtifacts({ storage, artifacts: publicGraph });
  const publicNodes = publicGraph.shards
    .filter((shard) => shard.shardKind === 'node')
    .flatMap((shard) => shard.items)
    .filter((node): node is FullCorpusPublicNode => (
      'recordType' in node && node.recordType === 'full_corpus_public_node'
    ));
  const densityArtifact = buildFullCorpusPublicDensityArtifact({
    corpusVersion: request.corpusVersion,
    snapshotId: relationship.completion.lineage.binding.snapshotId,
    publicGraphManifestDigest: publicGraph.manifest.manifestDigest,
    nodes: publicNodes.map((node) => ({
      address: node.address,
      kind: node.kind,
      source: node.source,
      eventTimestamp: node.eventTimestamp,
      lat: node.lat,
      lon: node.lon,
      degree: node.degree,
      relationshipStatus: node.relationshipStatus,
    })),
  });
  const densityArchive = buildFullCorpusPublicDensityArchiveObject(densityArtifact);
  const densityStatus = await writeDensity(storage, densityArchive);
  const relationshipStatuses = relationshipArchive.writes.flatMap((write) => [
    write.archiveStatus,
    write.receiptStatus,
  ]);
  const publicGraphStatuses = publicGraphArchive.writes.flatMap((write) => [
    write.archiveStatus,
    write.receiptStatus,
  ]);
  const receipt: FullCorpusTypedGraphReceipt = {
    status: 'complete',
    corpusVersion: request.corpusVersion,
    requestDigest: request.requestDigest,
    relationshipRun: relationshipArchive.indexPointer,
    publicGraph: {
      manifestDigest: publicGraph.manifest.manifestDigest,
      manifestReceiptKey: publicGraphArchive.manifestArtifact.receipt.receiptKey,
      shardSetSha256: publicGraph.manifest.shardSetSha256,
      shardCount: publicGraph.manifest.shards.length,
    },
    density: densityArchive.pointer,
    writes: {
      relationship: countStatuses(relationshipStatuses),
      publicGraph: countStatuses(publicGraphStatuses),
      density: densityStatus,
      productionCompatibility: productionCompatibilityArchive.status,
    },
    accounting: {
      universeRecordCount: relationship.completion.universeRecordCount,
      candidatePairCount: relationship.completion.candidatePairCount,
      typedEdgeCount: relationship.completion.typedEdgeCount,
      contextualAcceptedEdgeCount: relationship.completion.contextualCompletion.acceptedEdgeCount,
      contextualInsufficientEvidenceCount:
        relationship.completion.contextualCompletion.insufficientEvidenceCount,
      productionCompatibility: loaded.productionCompatibility,
      productionCompatibilityPointer: productionCompatibilityArchive.pointer,
    },
  };
  return {
    receipt,
    relationship,
    publicGraphManifest: publicGraph.manifest,
    publicGraphManifestReceiptKey: publicGraphArchive.manifestArtifact.receipt.receiptKey,
    density: densityArchive.pointer,
    loaded,
  };
};

export const readFullCorpusTypedOrchestrationRequest = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
) => {
  if (!key.startsWith('case-vortex/') || key.length > 2_048) {
    invalid('full_corpus_typed_orchestration_request_key_invalid');
  }
  const body = await storage.readObject(key);
  if (!body) invalid('full_corpus_typed_orchestration_request_missing');
  return decodeFullCorpusTypedOrchestrationRequest(body);
};

export const runFullCorpusTypedGraphFromArchiveRequest = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  requestKey: string;
  expectedCorpusVersion?: string;
}) => {
  const request = await readFullCorpusTypedOrchestrationRequest(params.storage, params.requestKey);
  if (params.expectedCorpusVersion && request.corpusVersion !== params.expectedCorpusVersion) {
    invalid('full_corpus_typed_orchestration_request_corpus_mismatch');
  }
  return (await executeGraph(params.storage, request)).receipt;
};

const loadPublicationAccounting = async (
  storage: CaseGraphConditionalArchiveStorage,
  request: FullCorpusTypedOrchestrationRequest,
): Promise<LoadedPublicationAccounting> => {
  if (!request.publication) invalid('full_corpus_typed_orchestration_publication_inputs_required');
  const [accountingBindingBody, accountingReceiptBody] = await Promise.all([
    readReferencedObject(storage, request.publication.accountingBinding),
    readReferencedObject(storage, request.publication.accountingReceipt),
  ]);
  const accountingBinding = decodeCaseVortexAccountingPublicationBinding(
    parseJson(accountingBindingBody, 'full_corpus_typed_orchestration_accounting_binding_json_invalid'),
  );
  decodeCaseVortexCorpusAccountingReceipt(accountingReceiptBody);
  if (accountingBinding.corpusVersion !== request.corpusVersion) {
    invalid('full_corpus_typed_orchestration_accounting_corpus_mismatch');
  }
  return { binding: accountingBinding, receiptBody: accountingReceiptBody };
};

/**
 * Reads and verifies every immutable input needed by the typed graph request
 * without constructing or writing graph artifacts. This is deliberately a
 * full byte-level preflight rather than a metadata-only HEAD check: archive
 * completions, every universe and relationship-input part, production
 * calibration, contextual completion and optional publication accounting all
 * pass through the same decoders used by the write path.
 */
export const preflightFullCorpusTypedOrchestrationRequest = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  requestKey: string;
  expectedCorpusVersion?: string;
}) => {
  const request = await readFullCorpusTypedOrchestrationRequest(params.storage, params.requestKey);
  if (params.expectedCorpusVersion && request.corpusVersion !== params.expectedCorpusVersion) {
    invalid('full_corpus_typed_orchestration_request_corpus_mismatch');
  }
  const loaded = await loadInputs(params.storage, request);
  const publicationAccounting = request.publication
    ? await loadPublicationAccounting(params.storage, request)
    : null;
  return {
    status: 'verified' as const,
    writeEnabled: false as const,
    corpusVersion: request.corpusVersion,
    requestDigest: request.requestDigest,
    graphInputBinding: getFullCorpusTypedGraphInputBinding(request),
    universe: {
      snapshotId: loaded.relationshipInputManifest.binding.snapshotId,
      recordCount: loaded.universeNodes.length,
      archiveSetSha256: loaded.relationshipInputManifest.binding.universeArchiveSetSha256,
      productionCompatibility: loaded.productionCompatibility,
    },
    relationshipInput: {
      partCount: loaded.relationshipInputManifest.partCount,
      recordCount: loaded.relationshipInputManifest.rowCount,
      archiveSetSha256: loaded.relationshipInputManifest.archiveSetSha256,
      manifestDigest: loaded.relationshipInputManifest.manifestDigest,
    },
    calibration: {
      humanReviewBundleDigest: loaded.calibration.humanReviewEvidence.bundleDigest,
      humanReviewEvidenceSetSha256: loaded.calibration.humanReviewEvidence.evidenceSetSha256,
      humanReviewPackDigest: loaded.calibration.humanReviewEvidence.packDigest,
      humanReviewAdjudicationDigest:
        loaded.calibration.humanReviewEvidence.adjudicationDigest,
      pairReceiptId: loaded.calibration.pairArtifact.receipt.receiptId,
      pairReceiptSha256: loaded.calibration.pairArtifact.receipt.receiptSha256,
      contextualReceiptId: loaded.calibration.contextualArtifact.receipt.receiptId,
      contextualReceiptSha256: loaded.calibration.contextualArtifact.receipt.receiptSha256,
    },
    contextualRelationshipCompletion: {
      completionId: loaded.contextualCompletion.completionId,
      completionDigest: loaded.contextualCompletion.completionDigest,
      accounting: loaded.contextualCompletion.accounting,
    },
    publication: request.publication && publicationAccounting ? {
      generatedAt: request.publication.generatedAt,
      accountingBinding: publicationAccounting.binding,
      accountingReceiptSha256: request.publication.accountingReceipt.sha256,
    } : null,
  };
};

const buildPublicationLineage = (
  request: FullCorpusTypedOrchestrationRequest,
  graph: ExecutedGraph,
  accounting: LoadedPublicationAccounting,
): CaseGraphPublicationLineageReceipts => {
  if (!request.publication) invalid('full_corpus_typed_orchestration_publication_inputs_required');
  const pair = graph.loaded.calibration.pairArtifact;
  const contextual = graph.loaded.calibration.contextualArtifact;
  return {
    generatedAt: request.publication.generatedAt,
    relationshipRun: graph.receipt.relationshipRun,
    productionCompatibility: graph.receipt.accounting.productionCompatibilityPointer,
    publicGraphManifestReceiptKey: graph.publicGraphManifestReceiptKey,
    density: graph.density,
    calibration: {
      humanReviewBundleBody: graph.loaded.calibration.humanReviewBundleBody,
      pairReceiptBody: graph.loaded.calibration.pairReceiptBody,
      contextualReceiptBody: graph.loaded.calibration.contextualReceiptBody,
      pairLineage: pair.lineage,
      contextualLineage: contextual.lineage,
      pairArtifactBody: graph.loaded.calibration.pairArtifactBody,
      pairTrustPolicyBody: graph.loaded.calibration.pairTrustPolicyBody,
      contextualArtifactBody: graph.loaded.calibration.contextualArtifactBody,
      contextualTrustPolicyBody: graph.loaded.calibration.contextualTrustPolicyBody,
      pinned: {
        pair: {
          receiptId: pair.receipt.receiptId,
          receiptSha256: pair.receipt.receiptSha256,
          artifactDigest: pair.artifactDigest,
          trustPolicyDigest: pair.trustPolicy.trustPolicyDigest,
        },
        contextual: {
          receiptId: contextual.receipt.receiptId,
          receiptSha256: contextual.receipt.receiptSha256,
          artifactDigest: contextual.artifactDigest,
          trustPolicyDigest: contextual.trustPolicy.trustPolicyDigest,
        },
      },
    },
    contextualRelationshipCompletionBody: graph.loaded.contextualCompletionBody,
    accountingBinding: accounting.binding,
    accountingReceiptBody: accounting.receiptBody,
  };
};

export const runFullCorpusTypedPublicationFromArchiveRequest = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  requestKey: string;
  expectedCorpusVersion?: string;
}) => {
  const request = await readFullCorpusTypedOrchestrationRequest(params.storage, params.requestKey);
  if (params.expectedCorpusVersion && request.corpusVersion !== params.expectedCorpusVersion) {
    invalid('full_corpus_typed_orchestration_request_corpus_mismatch');
  }
  if (!request.publication) invalid('full_corpus_typed_orchestration_publication_inputs_required');
  // Validate and pin every accounting byte before the graph phase is allowed
  // to write immutable artifacts. The final manifest hash binding is checked
  // again inside the publication transaction after graph construction.
  const accounting = await loadPublicationAccounting(params.storage, request);
  const graph = await executeGraph(params.storage, request);
  const lineage = buildPublicationLineage(request, graph, accounting);
  const publication = await buildCaseGraphPublicationCandidate({
    corpusVersion: request.corpusVersion,
    storage: params.storage,
    lineage,
  });
  return { graph: graph.receipt, publication };
};
