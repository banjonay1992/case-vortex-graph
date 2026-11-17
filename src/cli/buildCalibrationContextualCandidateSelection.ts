import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  selectCalibrationContextualCandidates,
  serializeCalibrationContextualCandidateSelection,
  type CalibrationContextualCandidateInput,
  type CalibrationContextualCandidateSelection,
} from '../caseGraph/calibrationContextualCandidateSelection';
import {
  decodeContextualRelationshipCalibrationAuditPlan,
  decodeContextualRelationshipCalibrationLineage,
  type ContextualRelationshipCalibrationAuditPlan,
  type ContextualRelationshipCalibrationLineage,
} from '../caseGraph/contextualRelationshipCalibration';
import {
  canonicalizeContextualExplanation,
  contextualExplanationSha256,
} from '../caseGraph/contextualExplanation';
import {
  canonicalizeRelationshipInput,
  decodeRelationshipInputRecord,
  relationshipInputSha256,
  validateRelationshipInputBinding,
  type RelationshipInputRecord,
  type RelationshipInputUniverseBinding,
} from '../caseGraph/relationshipInputSnapshot';
import {
  decodeCalibrationHumanReviewPack,
  type CalibrationHumanReviewContextualCandidate,
  type CalibrationHumanReviewPack,
} from '../caseGraph/calibrationHumanReview';

export const GOVERNED_CONTEXTUAL_CANDIDATE_POOL_MANIFEST_VERSION =
  'case-graph-governed-contextual-candidate-pool-manifest-v1' as const;
export const GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_VERSION =
  'case-graph-governed-contextual-candidate-selection-v1' as const;
export const GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT = 801 as const;
export const GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_SEED =
  'current-contextual-human-review-v1' as const;

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };
const plain = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);
const exact = (value: unknown, keys: readonly string[], code: string): Record<string, unknown> => {
  const record = plain(value) ? value : invalid(code);
  const actual = Object.keys(record).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(code);
  }
  return record;
};
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const canonicalContextBody = (value: unknown) => Buffer.from(
  `${canonicalizeContextualExplanation(value)}\n`,
  'utf8',
);
const canonicalRelationshipBody = (value: unknown) => Buffer.from(
  `${canonicalizeRelationshipInput(value)}\n`,
  'utf8',
);
const sameCanonical = (left: unknown, right: unknown) => (
  canonicalizeContextualExplanation(left) === canonicalizeContextualExplanation(right)
);

export type GovernedContextualCandidatePoolManifest = {
  recordType: 'governed_contextual_candidate_pool_manifest';
  schemaVersion: typeof GOVERNED_CONTEXTUAL_CANDIDATE_POOL_MANIFEST_VERSION;
  binding: RelationshipInputUniverseBinding;
  lineageDigest: string;
  candidatePoolCanonicalSha256: string;
  candidateCount: number;
  manifestDigest: string;
};

export type GovernedContextualCandidateSelection = {
  recordType: 'governed_contextual_candidate_selection';
  schemaVersion: typeof GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_VERSION;
  purpose: 'candidate_selection_only_not_locked_holdout';
  authorizationCeiling: 'not_review_evidence_not_locked_holdout';
  requiredContextualCandidateCount: typeof GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT;
  corpusVersion: string;
  snapshotId: string;
  binding: RelationshipInputUniverseBinding;
  contextualPolicy: ContextualRelationshipCalibrationLineage['contextualPolicy'];
  lineage: {
    lineageDigest: string;
    canonicalSha256: string;
  };
  candidatePool: {
    canonicalSha256: string;
    candidateCount: number;
    manifest: {
      recordType: GovernedContextualCandidatePoolManifest['recordType'];
      schemaVersion: GovernedContextualCandidatePoolManifest['schemaVersion'];
      manifestDigest: string;
      canonicalSha256: string;
    };
  };
  subjectRecords: {
    canonicalSha256: string;
    recordSetSha256: string;
    recordCount: number;
  };
  selection: CalibrationContextualCandidateSelection;
  selectionDocumentSha256: string;
};

const manifestWithoutDigest = (
  manifest: Omit<GovernedContextualCandidatePoolManifest, 'manifestDigest'>,
) => manifest;

export const buildGovernedContextualCandidatePoolManifest = (params: Omit<
  GovernedContextualCandidatePoolManifest,
  'recordType' | 'schemaVersion' | 'manifestDigest'
>): GovernedContextualCandidatePoolManifest => {
  const binding = validateRelationshipInputBinding(params.binding);
  if (!SHA256.test(params.lineageDigest) || !SHA256.test(params.candidatePoolCanonicalSha256)
    || !Number.isSafeInteger(params.candidateCount) || params.candidateCount < GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT) {
    invalid('governed_contextual_candidate_pool_manifest_invalid');
  }
  const body: Omit<GovernedContextualCandidatePoolManifest, 'manifestDigest'> = {
    recordType: 'governed_contextual_candidate_pool_manifest',
    schemaVersion: GOVERNED_CONTEXTUAL_CANDIDATE_POOL_MANIFEST_VERSION,
    binding,
    lineageDigest: params.lineageDigest,
    candidatePoolCanonicalSha256: params.candidatePoolCanonicalSha256,
    candidateCount: params.candidateCount,
  };
  return {
    ...body,
    manifestDigest: contextualExplanationSha256(manifestWithoutDigest(body)),
  };
};

export const decodeGovernedContextualCandidatePoolManifest = (
  input: unknown,
): GovernedContextualCandidatePoolManifest => {
  const manifest = exact(input, [
    'recordType', 'schemaVersion', 'binding', 'lineageDigest', 'candidatePoolCanonicalSha256',
    'candidateCount', 'manifestDigest',
  ], 'governed_contextual_candidate_pool_manifest_invalid');
  const rebuilt = buildGovernedContextualCandidatePoolManifest({
    binding: manifest.binding as RelationshipInputUniverseBinding,
    lineageDigest: String(manifest.lineageDigest),
    candidatePoolCanonicalSha256: String(manifest.candidatePoolCanonicalSha256),
    candidateCount: Number(manifest.candidateCount),
  });
  if (!sameCanonical(manifest, rebuilt)) invalid('governed_contextual_candidate_pool_manifest_invalid');
  return rebuilt;
};

const selectionWithoutDocumentDigest = (
  value: Omit<GovernedContextualCandidateSelection, 'selectionDocumentSha256'>,
) => value;

const decodeSelectionCore = (value: unknown): CalibrationContextualCandidateSelection => {
  const selection = exact(value, [
    'recordType', 'schemaVersion', 'seed', 'targetCount', 'eligibleCount', 'candidates', 'cohortCounts',
    'selectionDigest',
  ], 'governed_contextual_candidate_selection_invalid');
  if (selection.recordType !== 'calibration_contextual_candidate_selection'
    || selection.schemaVersion !== 'case-graph-calibration-contextual-candidate-selection-v1'
    || selection.seed !== GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_SEED
    || selection.targetCount !== GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT
    || !Number.isSafeInteger(selection.eligibleCount)
    || Number(selection.eligibleCount) < GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT
    || !Array.isArray(selection.candidates)
    || selection.candidates.length !== GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT
    || !plain(selection.cohortCounts)
    || typeof selection.selectionDigest !== 'string' || !SHA256.test(selection.selectionDigest)) {
    invalid('governed_contextual_candidate_selection_invalid');
  }
  const withoutDigest = {
    recordType: selection.recordType,
    schemaVersion: selection.schemaVersion,
    seed: selection.seed,
    targetCount: selection.targetCount,
    eligibleCount: selection.eligibleCount,
    candidates: selection.candidates,
    cohortCounts: selection.cohortCounts,
  };
  if (contextualExplanationSha256(withoutDigest) !== selection.selectionDigest) {
    invalid('governed_contextual_candidate_selection_invalid');
  }
  return selection as unknown as CalibrationContextualCandidateSelection;
};

export const buildGovernedContextualCandidateSelection = (params: {
  lineage: ContextualRelationshipCalibrationLineage;
  lineageCanonicalSha256: string;
  candidatePoolCanonicalSha256: string;
  candidatePoolManifest: GovernedContextualCandidatePoolManifest;
  candidatePoolManifestCanonicalSha256: string;
  subjectRecordsCanonicalSha256: string;
  subjectRecordSetSha256: string;
  subjectRecordCount: number;
  selection: CalibrationContextualCandidateSelection;
}): GovernedContextualCandidateSelection => {
  const lineage = decodeContextualRelationshipCalibrationLineage(params.lineage);
  const manifest = decodeGovernedContextualCandidatePoolManifest(params.candidatePoolManifest);
  const selection = decodeSelectionCore(params.selection);
  if (!SHA256.test(params.lineageCanonicalSha256)
    || !SHA256.test(params.candidatePoolCanonicalSha256)
    || !SHA256.test(params.candidatePoolManifestCanonicalSha256)
    || !SHA256.test(params.subjectRecordsCanonicalSha256)
    || !SHA256.test(params.subjectRecordSetSha256)
    || !Number.isSafeInteger(params.subjectRecordCount) || params.subjectRecordCount < 1
    || !sameCanonical(manifest.binding, lineage.binding)
    || manifest.lineageDigest !== lineage.lineageDigest
    || manifest.candidatePoolCanonicalSha256 !== params.candidatePoolCanonicalSha256
    || manifest.candidateCount !== selection.eligibleCount) {
    invalid('governed_contextual_candidate_selection_input_binding_invalid');
  }
  const body: Omit<GovernedContextualCandidateSelection, 'selectionDocumentSha256'> = {
    recordType: 'governed_contextual_candidate_selection',
    schemaVersion: GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_VERSION,
    purpose: 'candidate_selection_only_not_locked_holdout',
    authorizationCeiling: 'not_review_evidence_not_locked_holdout',
    requiredContextualCandidateCount: GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT,
    corpusVersion: lineage.binding.corpusVersion,
    snapshotId: lineage.binding.snapshotId,
    binding: lineage.binding,
    contextualPolicy: lineage.contextualPolicy,
    lineage: {
      lineageDigest: lineage.lineageDigest,
      canonicalSha256: params.lineageCanonicalSha256,
    },
    candidatePool: {
      canonicalSha256: params.candidatePoolCanonicalSha256,
      candidateCount: manifest.candidateCount,
      manifest: {
        recordType: manifest.recordType,
        schemaVersion: manifest.schemaVersion,
        manifestDigest: manifest.manifestDigest,
        canonicalSha256: params.candidatePoolManifestCanonicalSha256,
      },
    },
    subjectRecords: {
      canonicalSha256: params.subjectRecordsCanonicalSha256,
      recordSetSha256: params.subjectRecordSetSha256,
      recordCount: params.subjectRecordCount,
    },
    selection,
  };
  return {
    ...body,
    selectionDocumentSha256: contextualExplanationSha256(selectionWithoutDocumentDigest(body)),
  };
};

export const decodeGovernedContextualCandidateSelection = (
  input: unknown,
): GovernedContextualCandidateSelection => {
  const value = exact(input, [
    'recordType', 'schemaVersion', 'purpose', 'authorizationCeiling', 'requiredContextualCandidateCount',
    'corpusVersion', 'snapshotId', 'binding', 'contextualPolicy', 'lineage', 'candidatePool',
    'subjectRecords', 'selection', 'selectionDocumentSha256',
  ], 'governed_contextual_candidate_selection_invalid');
  if (value.recordType !== 'governed_contextual_candidate_selection'
    || value.schemaVersion !== GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_VERSION
    || value.purpose !== 'candidate_selection_only_not_locked_holdout'
    || value.authorizationCeiling !== 'not_review_evidence_not_locked_holdout'
    || value.requiredContextualCandidateCount !== GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT
    || typeof value.corpusVersion !== 'string' || typeof value.snapshotId !== 'string'
    || typeof value.selectionDocumentSha256 !== 'string' || !SHA256.test(value.selectionDocumentSha256)) {
    invalid('governed_contextual_candidate_selection_invalid');
  }
  const binding = validateRelationshipInputBinding(value.binding);
  const lineage = exact(value.lineage, ['lineageDigest', 'canonicalSha256'], 'governed_contextual_candidate_selection_invalid');
  const candidatePool = exact(value.candidatePool, ['canonicalSha256', 'candidateCount', 'manifest'], 'governed_contextual_candidate_selection_invalid');
  const manifest = exact(candidatePool.manifest, ['recordType', 'schemaVersion', 'manifestDigest', 'canonicalSha256'], 'governed_contextual_candidate_selection_invalid');
  const subjectRecords = exact(value.subjectRecords, ['canonicalSha256', 'recordSetSha256', 'recordCount'], 'governed_contextual_candidate_selection_invalid');
  const hashes = [
    lineage.lineageDigest, lineage.canonicalSha256, candidatePool.canonicalSha256,
    manifest.manifestDigest, manifest.canonicalSha256, subjectRecords.canonicalSha256,
    subjectRecords.recordSetSha256,
  ];
  if (hashes.some((hash) => typeof hash !== 'string' || !SHA256.test(hash))
    || !Number.isSafeInteger(candidatePool.candidateCount)
    || Number(candidatePool.candidateCount) < GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT
    || !Number.isSafeInteger(subjectRecords.recordCount) || Number(subjectRecords.recordCount) < 1
    || manifest.recordType !== 'governed_contextual_candidate_pool_manifest'
    || manifest.schemaVersion !== GOVERNED_CONTEXTUAL_CANDIDATE_POOL_MANIFEST_VERSION
    || value.corpusVersion !== binding.corpusVersion || value.snapshotId !== binding.snapshotId) {
    invalid('governed_contextual_candidate_selection_invalid');
  }
  const selection = decodeSelectionCore(value.selection);
  if (selection.eligibleCount !== candidatePool.candidateCount) {
    invalid('governed_contextual_candidate_selection_invalid');
  }
  const output = value as unknown as GovernedContextualCandidateSelection;
  const { selectionDocumentSha256: _selectionDocumentSha256, ...withoutDigest } = output;
  const canonicalWithoutDigest = {
    ...withoutDigest,
    binding,
    selection,
  } satisfies Omit<GovernedContextualCandidateSelection, 'selectionDocumentSha256'>;
  if (contextualExplanationSha256(selectionWithoutDocumentDigest(canonicalWithoutDigest)) !== output.selectionDocumentSha256) {
    invalid('governed_contextual_candidate_selection_invalid');
  }
  return output;
};

export const serializeGovernedContextualCandidateSelection = (
  selection: GovernedContextualCandidateSelection,
) => `${canonicalizeContextualExplanation(decodeGovernedContextualCandidateSelection(selection))}\n`;

export const assertGovernedContextualSelectionMatchesAuditPlan = (params: {
  selection: GovernedContextualCandidateSelection;
  auditPlan: ContextualRelationshipCalibrationAuditPlan;
  contextualCandidates?: ReadonlyArray<{
    sampleId: CalibrationHumanReviewContextualCandidate['sampleId'];
    sourceGroupId: CalibrationHumanReviewContextualCandidate['sourceGroupId'];
    evaluationDigest: CalibrationHumanReviewContextualCandidate['evaluationDigest'];
    candidate: CalibrationHumanReviewContextualCandidate['candidate'];
    evaluation: CalibrationHumanReviewContextualCandidate['evaluation'];
    sourceSnapshotDigest: CalibrationHumanReviewContextualCandidate['sourceSnapshotDigest'];
    observationArchiveRecordDigest: CalibrationHumanReviewContextualCandidate['observationArchiveRecordDigest'];
  }>;
}) => {
  const selection = decodeGovernedContextualCandidateSelection(params.selection);
  const auditPlan = decodeContextualRelationshipCalibrationAuditPlan(params.auditPlan);
  const expectedMembership = selection.selection.candidates.map((candidate) => ({
    sampleId: candidate.sampleId,
    sourceGroupId: candidate.sourceGroupId,
  })).sort((left, right) => compare(left.sampleId, right.sampleId));
  if (!sameCanonical(expectedMembership, auditPlan.lockedHoldout)) {
    invalid('governed_contextual_candidate_selection_audit_plan_mismatch');
  }
  if (!params.contextualCandidates) return;
  const expectedCandidates = [...selection.selection.candidates]
    .sort((left, right) => compare(left.sampleId, right.sampleId));
  const actualCandidates = [...params.contextualCandidates]
    .sort((left, right) => compare(left.sampleId, right.sampleId));
  if (!sameCanonical(expectedCandidates, actualCandidates)) {
    invalid('governed_contextual_candidate_selection_human_review_pack_mismatch');
  }
};

export const assertGovernedContextualSelectionMatchesHumanReviewPack = (params: {
  selection: GovernedContextualCandidateSelection;
  auditPlan: ContextualRelationshipCalibrationAuditPlan;
  pack: CalibrationHumanReviewPack;
}) => {
  const selection = decodeGovernedContextualCandidateSelection(params.selection);
  const auditPlan = decodeContextualRelationshipCalibrationAuditPlan(params.auditPlan);
  const pack = decodeCalibrationHumanReviewPack(params.pack);
  if (selection.lineage.lineageDigest !== pack.contextualLineage.lineageDigest
    || selection.lineage.canonicalSha256 !== sha256(canonicalContextBody(pack.contextualLineage))
    || selection.corpusVersion !== pack.contextualLineage.binding.corpusVersion
    || selection.snapshotId !== pack.contextualLineage.binding.snapshotId
    || !sameCanonical(selection.binding, pack.contextualLineage.binding)
    || !sameCanonical(selection.contextualPolicy, pack.contextualLineage.contextualPolicy)) {
    invalid('governed_contextual_candidate_selection_human_review_pack_lineage_mismatch');
  }
  if (!sameCanonical(auditPlan, pack.contextualAuditPlan)) {
    invalid('governed_contextual_candidate_selection_human_review_pack_audit_plan_mismatch');
  }
  assertGovernedContextualSelectionMatchesAuditPlan({
    selection,
    auditPlan,
    contextualCandidates: pack.contextualCandidates,
  });
};

type Dependencies = {
  readFileBytes: typeof readFile;
  inspectPath: typeof lstat;
  makeDirectory: typeof mkdir;
  writeFileText: typeof writeFile;
  decodeHumanReviewPack: typeof decodeCalibrationHumanReviewPack;
};

const defaults: Dependencies = {
  readFileBytes: readFile,
  inspectPath: lstat,
  makeDirectory: mkdir,
  writeFileText: writeFile,
  decodeHumanReviewPack: decodeCalibrationHumanReviewPack,
};

type StableFile = { body: Buffer; sha256: string };
const stableFile = async (
  path: string,
  flag: string,
  dependencies: Dependencies,
): Promise<StableFile> => {
  const before = await dependencies.inspectPath(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    invalid(`${flag} must be a regular non-symlink file`);
  }
  if (before.size < 1 || before.size > MAX_INPUT_BYTES) invalid(`${flag} file size is invalid`);
  const body = await dependencies.readFileBytes(path);
  if (body.byteLength !== before.size) invalid(`${flag} changed while being read`);
  const after = await dependencies.inspectPath(path);
  if (!after.isFile() || after.isSymbolicLink()
    || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
    invalid(`${flag} changed while being read`);
  }
  return { body, sha256: sha256(body) };
};

const parseCanonicalJson = (file: StableFile, flag: string, canonicalize: (value: unknown) => Buffer) => {
  let value: unknown;
  try { value = JSON.parse(file.body.toString('utf8')); } catch { invalid(`${flag} JSON is invalid`); }
  if (!file.body.equals(canonicalize(value))) invalid(`${flag} JSON is not canonical`);
  return value;
};

const requiredLocalPath = (value: string | undefined, flag: string) => {
  if (!value || !value.trim() || value.includes('\0') || /^https?:\/\//iu.test(value)) {
    invalid(`${flag} must be a local filesystem path`);
  }
  return resolve(value as string);
};

type Parsed = { command: 'build-manifest' | 'build' | 'verify' | 'verify-composition'; flags: Map<string, string> };
const allowedFlags: Record<Parsed['command'], readonly string[]> = {
  'build-manifest': ['--lineage', '--candidate-pool', '--output'],
  build: ['--lineage', '--candidate-pool', '--candidate-pool-manifest', '--subject-records', '--output'],
  verify: ['--lineage', '--candidate-pool', '--candidate-pool-manifest', '--subject-records', '--selection'],
  'verify-composition': [
    '--lineage', '--candidate-pool', '--candidate-pool-manifest', '--subject-records',
    '--selection', '--audit-plan', '--human-review-pack',
  ],
};
const parseArgs = (argv: string[]): Parsed | { usage: string } => {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { usage: calibrationContextualCandidateSelectionUsage };
  }
  const command = argv[0];
  const parsedCommand: Parsed['command'] = command === 'build-manifest' || command === 'build'
    || command === 'verify' || command === 'verify-composition'
    ? command
    : invalid('contextual calibration candidate selection arguments are invalid');
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) invalid('contextual calibration candidate selection arguments are invalid');
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!allowedFlags[parsedCommand].includes(name) || !value || value.startsWith('--') || flags.has(name)) {
      invalid('contextual calibration candidate selection arguments are invalid');
    }
    flags.set(name, value);
  }
  if (flags.size !== allowedFlags[parsedCommand].length
    || allowedFlags[parsedCommand].some((flag) => !flags.has(flag))) {
    invalid('contextual calibration candidate selection arguments are invalid');
  }
  return { command: parsedCommand, flags };
};

const readLineageAndCandidatePool = async (flags: Map<string, string>, dependencies: Dependencies) => {
  const lineagePath = requiredLocalPath(flags.get('--lineage'), '--lineage');
  const candidatePoolPath = requiredLocalPath(flags.get('--candidate-pool'), '--candidate-pool');
  const lineageFile = await stableFile(lineagePath, '--lineage', dependencies);
  const lineage = decodeContextualRelationshipCalibrationLineage(
    parseCanonicalJson(lineageFile, '--lineage', canonicalContextBody),
  );
  const candidatePoolFile = await stableFile(candidatePoolPath, '--candidate-pool', dependencies);
  const candidatePool = parseCanonicalJson(candidatePoolFile, '--candidate-pool', canonicalContextBody);
  const candidatePoolArray = Array.isArray(candidatePool)
    ? candidatePool
    : invalid('--candidate-pool must be an array');
  return { lineage, lineageFile, candidatePool: candidatePoolArray, candidatePoolFile };
};

const readInputs = async (flags: Map<string, string>, dependencies: Dependencies) => {
  const { lineage, lineageFile, candidatePool, candidatePoolFile } = await readLineageAndCandidatePool(
    flags,
    dependencies,
  );
  const manifestPath = requiredLocalPath(flags.get('--candidate-pool-manifest'), '--candidate-pool-manifest');
  const subjectRecordsPath = requiredLocalPath(flags.get('--subject-records'), '--subject-records');
  const manifestFile = await stableFile(manifestPath, '--candidate-pool-manifest', dependencies);
  const manifest = decodeGovernedContextualCandidatePoolManifest(
    parseCanonicalJson(manifestFile, '--candidate-pool-manifest', canonicalContextBody),
  );
  if (!sameCanonical(manifest.binding, lineage.binding)
    || manifest.lineageDigest !== lineage.lineageDigest
    || manifest.candidatePoolCanonicalSha256 !== candidatePoolFile.sha256
    || manifest.candidateCount !== candidatePool.length) {
    invalid('governed_contextual_candidate_selection_input_binding_invalid');
  }
  const subjectRecordsFile = await stableFile(subjectRecordsPath, '--subject-records', dependencies);
  const rawSubjectRecords = parseCanonicalJson(
    subjectRecordsFile,
    '--subject-records',
    canonicalRelationshipBody,
  );
  const subjectRecordArray = Array.isArray(rawSubjectRecords)
    ? rawSubjectRecords
    : invalid('--subject-records must be an array');
  const subjectRecords = subjectRecordArray.map((record) => (
    decodeRelationshipInputRecord(record, lineage.binding)
  ));
  return {
    lineage,
    lineageFile,
    candidatePool: candidatePool as CalibrationContextualCandidateInput[],
    candidatePoolFile,
    manifest,
    manifestFile,
    subjectRecords,
    subjectRecordsFile,
  };
};

const buildSelection = async (flags: Map<string, string>, dependencies: Dependencies) => {
  const inputs = await readInputs(flags, dependencies);
  const selection = selectCalibrationContextualCandidates({
    lineage: inputs.lineage,
    candidates: inputs.candidatePool,
    subjectRecords: inputs.subjectRecords,
    targetCount: GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT,
    seed: GOVERNED_CONTEXTUAL_CANDIDATE_SELECTION_SEED,
  });
  if (selection.candidates.length !== GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT) {
    invalid('governed_contextual_candidate_selection_incomplete');
  }
  const subjectRecordSetSha256 = relationshipInputSha256([...inputs.subjectRecords].sort((left, right) => (
    compare(left.address, right.address)
  )));
  const document = buildGovernedContextualCandidateSelection({
    lineage: inputs.lineage,
    lineageCanonicalSha256: inputs.lineageFile.sha256,
    candidatePoolCanonicalSha256: inputs.candidatePoolFile.sha256,
    candidatePoolManifest: inputs.manifest,
    candidatePoolManifestCanonicalSha256: inputs.manifestFile.sha256,
    subjectRecordsCanonicalSha256: inputs.subjectRecordsFile.sha256,
    subjectRecordSetSha256,
    subjectRecordCount: inputs.subjectRecords.length,
    selection,
  });
  return { document, body: Buffer.from(serializeGovernedContextualCandidateSelection(document), 'utf8') };
};

export type GovernedContextualSelectionVerificationPaths = {
  lineage: string;
  candidatePool: string;
  candidatePoolManifest: string;
  subjectRecords: string;
  selection: string;
};

const verificationFlags = (paths: GovernedContextualSelectionVerificationPaths) => new Map([
  ['--lineage', requiredLocalPath(paths.lineage, '--lineage')],
  ['--candidate-pool', requiredLocalPath(paths.candidatePool, '--candidate-pool')],
  ['--candidate-pool-manifest', requiredLocalPath(paths.candidatePoolManifest, '--candidate-pool-manifest')],
  ['--subject-records', requiredLocalPath(paths.subjectRecords, '--subject-records')],
  ['--selection', requiredLocalPath(paths.selection, '--selection')],
]);

export const verifyGovernedContextualCandidateSelectionFiles = async (
  paths: GovernedContextualSelectionVerificationPaths,
  dependencies: Dependencies = defaults,
) => {
  const flags = verificationFlags(paths);
  const built = await buildSelection(flags, dependencies);
  const selectionFile = await stableFile(
    requiredLocalPath(flags.get('--selection'), '--selection'),
    '--selection',
    dependencies,
  );
  if (!selectionFile.body.equals(built.body)) {
    invalid('governed_contextual_candidate_selection_bytes_mismatch');
  }
  return {
    document: built.document,
    body: selectionFile.body,
    fileSha256: selectionFile.sha256,
  };
};

export const verifyGovernedContextualHumanReviewComposition = async (params: {
  paths: GovernedContextualSelectionVerificationPaths & { auditPlan: string };
  pack: CalibrationHumanReviewPack;
}, dependencies: Dependencies = defaults) => {
  const verified = await verifyGovernedContextualCandidateSelectionFiles(params.paths, dependencies);
  const auditPlanFile = await stableFile(
    requiredLocalPath(params.paths.auditPlan, '--audit-plan'),
    '--audit-plan',
    dependencies,
  );
  const auditPlan = decodeContextualRelationshipCalibrationAuditPlan(
    parseCanonicalJson(auditPlanFile, '--audit-plan', canonicalContextBody),
  );
  assertGovernedContextualSelectionMatchesHumanReviewPack({
    selection: verified.document,
    auditPlan,
    pack: params.pack,
  });
  return { ...verified, auditPlan, auditPlanFileSha256: auditPlanFile.sha256 };
};

export const calibrationContextualCandidateSelectionUsage = `Usage:
  npm run case-graph:calibration:contextual-candidates -- build-manifest \\
    --lineage=<canonical-contextual-lineage.json> \\
    --candidate-pool=<canonical-unlabelled-contextual-candidate-pool.json> \\
    --output=<new-canonical-candidate-pool-manifest.json>
  npm run case-graph:calibration:contextual-candidates -- build \\
    --lineage=<canonical-contextual-lineage.json> \\
    --candidate-pool=<canonical-unlabelled-contextual-candidate-pool.json> \\
    --candidate-pool-manifest=<canonical-candidate-pool-manifest.json> \\
    --subject-records=<canonical-relationship-input-records.json> \\
    --output=<new-governed-selection.json>
  npm run case-graph:calibration:contextual-candidates -- verify \\
    --lineage=<canonical-contextual-lineage.json> \\
    --candidate-pool=<canonical-unlabelled-contextual-candidate-pool.json> \\
    --candidate-pool-manifest=<canonical-candidate-pool-manifest.json> \\
    --subject-records=<canonical-relationship-input-records.json> \\
    --selection=<governed-selection.json>
  npm run case-graph:calibration:contextual-candidates -- verify-composition \\
    --lineage=<canonical-contextual-lineage.json> \\
    --candidate-pool=<canonical-unlabelled-contextual-candidate-pool.json> \\
    --candidate-pool-manifest=<canonical-candidate-pool-manifest.json> \\
    --subject-records=<canonical-relationship-input-records.json> \\
    --selection=<verified-governed-selection.json> \\
    --audit-plan=<contextual-audit-plan.json> \\
    --human-review-pack=<locked-human-review-pack.json>

Builds or verifies exactly 801 deterministic contextual candidates. The output
is a candidate-selection receipt, not a locked holdout or review evidence: it
binds the exact canonical lineage, policy, candidate-pool manifest and bytes,
subject-record set and bytes, corpus and snapshot. No target/seed override,
provider, R2, database, Luna, reviewer, label, attestation, adjudication,
publication or deployment operation is implemented. The verify-composition command is
the required local machine check before review assignments: it proves that the
candidate-only receipt, contextual audit plan, and locked human-review pack
contain the same 801 sample/source-group/evaluation identities.
`;

const result = (params: {
  command: Parsed['command'];
  document: GovernedContextualCandidateSelection;
  selectionFileSha256: string;
  output?: string;
}) => ({
  valid: true as const,
  command: params.command,
  corpus_version: params.document.corpusVersion,
  snapshot_id: params.document.snapshotId,
  required_contextual_candidate_count: GOVERNED_CONTEXTUAL_CANDIDATE_TARGET_COUNT,
  eligible_contextual_candidate_count: params.document.selection.eligibleCount,
  selected_contextual_candidate_count: params.document.selection.candidates.length,
  selection_digest: params.document.selection.selectionDigest,
  selection_document_sha256: params.document.selectionDocumentSha256,
  selection_file_sha256: params.selectionFileSha256,
  lineage_digest: params.document.lineage.lineageDigest,
  lineage_canonical_sha256: params.document.lineage.canonicalSha256,
  candidate_pool_canonical_sha256: params.document.candidatePool.canonicalSha256,
  candidate_pool_manifest_digest: params.document.candidatePool.manifest.manifestDigest,
  subject_record_set_sha256: params.document.subjectRecords.recordSetSha256,
  ...(params.output ? { output: params.output } : {}),
  authorization_ceiling: params.document.authorizationCeiling,
  provider_calls: 0 as const,
  provider_bytes_downloaded: 0 as const,
  database_reads: 0 as const,
  database_writes: 0 as const,
  storage_reads: 0 as const,
  storage_writes: 0 as const,
  luna_calls: 0 as const,
  reviewer_assignments_created: 0 as const,
  labels_created: 0 as const,
  attestations_created: 0 as const,
  adjudications_created: 0 as const,
  publication_mutations: 0 as const,
  deployments: 0 as const,
});

const manifestResult = (params: {
  manifest: GovernedContextualCandidatePoolManifest;
  manifestFileSha256: string;
  output: string;
}) => ({
  valid: true as const,
  command: 'build-manifest' as const,
  corpus_version: params.manifest.binding.corpusVersion,
  snapshot_id: params.manifest.binding.snapshotId,
  candidate_pool_canonical_sha256: params.manifest.candidatePoolCanonicalSha256,
  candidate_pool_manifest_digest: params.manifest.manifestDigest,
  candidate_pool_manifest_file_sha256: params.manifestFileSha256,
  candidate_count: params.manifest.candidateCount,
  output: params.output,
  authorization_ceiling: 'candidate_input_contract_only_not_locked_holdout' as const,
  provider_calls: 0 as const,
  provider_bytes_downloaded: 0 as const,
  database_reads: 0 as const,
  database_writes: 0 as const,
  storage_reads: 0 as const,
  storage_writes: 0 as const,
  luna_calls: 0 as const,
  reviewer_assignments_created: 0 as const,
  labels_created: 0 as const,
  attestations_created: 0 as const,
  adjudications_created: 0 as const,
  publication_mutations: 0 as const,
  deployments: 0 as const,
});

export const runBuildCalibrationContextualCandidateSelectionCli = async (
  argv = process.argv.slice(2),
  dependencies: Dependencies = defaults,
) => {
  const parsed = parseArgs(argv);
  if ('usage' in parsed) return parsed;
  if (parsed.command === 'build-manifest') {
    const inputs = await readLineageAndCandidatePool(parsed.flags, dependencies);
    const manifest = buildGovernedContextualCandidatePoolManifest({
      binding: inputs.lineage.binding,
      lineageDigest: inputs.lineage.lineageDigest,
      candidatePoolCanonicalSha256: inputs.candidatePoolFile.sha256,
      candidateCount: inputs.candidatePool.length,
    });
    const body = canonicalContextBody(manifest);
    const output = requiredLocalPath(parsed.flags.get('--output'), '--output');
    await dependencies.makeDirectory(dirname(output), { recursive: true, mode: 0o700 });
    await dependencies.writeFileText(output, body, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    return manifestResult({ manifest, manifestFileSha256: sha256(body), output });
  }
  if (parsed.command === 'verify-composition') {
    const packPath = requiredLocalPath(parsed.flags.get('--human-review-pack'), '--human-review-pack');
    const packFile = await stableFile(packPath, '--human-review-pack', dependencies);
    const pack = dependencies.decodeHumanReviewPack(
      parseCanonicalJson(packFile, '--human-review-pack', canonicalRelationshipBody),
    );
    const verified = await verifyGovernedContextualHumanReviewComposition({
      paths: {
        lineage: requiredLocalPath(parsed.flags.get('--lineage'), '--lineage'),
        candidatePool: requiredLocalPath(parsed.flags.get('--candidate-pool'), '--candidate-pool'),
        candidatePoolManifest: requiredLocalPath(
          parsed.flags.get('--candidate-pool-manifest'),
          '--candidate-pool-manifest',
        ),
        subjectRecords: requiredLocalPath(parsed.flags.get('--subject-records'), '--subject-records'),
        selection: requiredLocalPath(parsed.flags.get('--selection'), '--selection'),
        auditPlan: requiredLocalPath(parsed.flags.get('--audit-plan'), '--audit-plan'),
      },
      pack,
    }, dependencies);
    return result({
      command: parsed.command,
      document: verified.document,
      selectionFileSha256: verified.fileSha256,
    });
  }
  if (parsed.command === 'verify') {
    const verified = await verifyGovernedContextualCandidateSelectionFiles({
      lineage: requiredLocalPath(parsed.flags.get('--lineage'), '--lineage'),
      candidatePool: requiredLocalPath(parsed.flags.get('--candidate-pool'), '--candidate-pool'),
      candidatePoolManifest: requiredLocalPath(
        parsed.flags.get('--candidate-pool-manifest'),
        '--candidate-pool-manifest',
      ),
      subjectRecords: requiredLocalPath(parsed.flags.get('--subject-records'), '--subject-records'),
      selection: requiredLocalPath(parsed.flags.get('--selection'), '--selection'),
    }, dependencies);
    return result({
      command: 'verify',
      document: verified.document,
      selectionFileSha256: verified.fileSha256,
    });
  }
  const built = await buildSelection(parsed.flags, dependencies);
  const output = requiredLocalPath(parsed.flags.get('--output'), '--output');
  await dependencies.makeDirectory(dirname(output), { recursive: true, mode: 0o700 });
  await dependencies.writeFileText(output, built.body, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  return result({
    command: 'build',
    document: built.document,
    selectionFileSha256: sha256(built.body),
    output,
  });
};

if (require.main === module) {
  runBuildCalibrationContextualCandidateSelectionCli()
    .then((value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
