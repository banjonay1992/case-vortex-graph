import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildCalibrationArtifactsFromHumanReview,
  buildCalibrationHumanReviewAdjudication,
  buildCalibrationHumanReviewAssignment,
  buildCalibrationHumanReviewPack,
  buildCalibrationHumanReviewerSubmission,
  decodeCalibrationHumanReviewBundle,
  decodeCalibrationHumanReviewPack,
  decodeCalibrationHumanReviewerSubmission,
  finalizeCalibrationHumanReview,
  serializeCalibrationHumanReviewAdjudication,
  serializeCalibrationHumanReviewAssignment,
  serializeCalibrationHumanReviewBundle,
  serializeCalibrationHumanReviewPack,
  serializeCalibrationHumanReviewerSubmission,
  type CalibrationHumanReviewAdjudicationDraft,
  type CalibrationHumanReviewPackDraft,
  type CalibrationHumanReviewerSubmissionDraft,
} from '../caseGraph/calibrationHumanReview';
import {
  buildCalibrationHumanReviewSourcePacket,
  calculateCalibrationHumanReviewSourceMaterialSet,
  serializeCalibrationHumanReviewSourcePacket,
  type CalibrationHumanReviewSourcePacketDraft,
} from '../caseGraph/calibrationHumanReviewSourcePacket';
import { canonicalizeContextualExplanation } from '../caseGraph/contextualExplanation';
import { canonicalizeRelationshipInput } from '../caseGraph/relationshipInputSnapshot';
import {
  verifyGovernedContextualHumanReviewComposition,
} from './buildCalibrationContextualCandidateSelection';

const getArg = (name: string, argv: string[]) => {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const getArgs = (name: string, argv: string[]) => argv.flatMap((value, index) => {
  if (value.startsWith(`${name}=`)) return [value.slice(name.length + 1)];
  if (value === name && argv[index + 1]) return [argv[index + 1]];
  return [];
});
const hasFlag = (name: string, argv: string[]) => argv.includes(name);

const requiredPath = (raw: string | undefined, label: string) => {
  const value = String(raw || '').trim();
  if (!value || /^https?:\/\//i.test(value) || value.includes('\0')) {
    throw new Error(`${label} must be a local filesystem path`);
  }
  return resolve(value);
};

const readJson = async <T>(path: string, code: string): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { throw new Error(code); }
};

const writeNew = async (path: string, body: string) => {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`refusing to overwrite existing local review evidence: ${path}`);
    }
    throw error;
  }
};

export const calibrationHumanReviewUsage = `Usage:
  npx tsx src/cli/calibrationHumanReview.ts prepare --draft=<governed-pack-draft.json> --materials=<source-materials.json> --pack-output=<locked-pack.json> --source-packet-output=<source-packet.json> --contextual-lineage=<canonical-contextual-lineage.json> --contextual-candidate-pool=<canonical-unlabelled-contextual-candidate-pool.json> --contextual-candidate-pool-manifest=<canonical-candidate-pool-manifest.json> --contextual-subject-records=<canonical-relationship-input-records.json> --contextual-selection=<verified-governed-contextual-selection.json> --contextual-audit-plan=<canonical-contextual-audit-plan.json>
  npx tsx src/cli/calibrationHumanReview.ts pack --draft=<pack-draft.json> --output=<locked-pack.json>
  npx tsx src/cli/calibrationHumanReview.ts materials --pack=<locked-pack.json> --draft=<source-materials.json> --output=<source-packet.json>
  npx tsx src/cli/calibrationHumanReview.ts assignment --pack=<locked-pack.json> --source-packet=<source-packet.json> --reviewer-id=<id> --output=<worksheet.json> --contextual-lineage=<canonical-contextual-lineage.json> --contextual-candidate-pool=<canonical-unlabelled-contextual-candidate-pool.json> --contextual-candidate-pool-manifest=<canonical-candidate-pool-manifest.json> --contextual-subject-records=<canonical-relationship-input-records.json> --contextual-selection=<verified-governed-contextual-selection.json> --contextual-audit-plan=<canonical-contextual-audit-plan.json>
  npx tsx src/cli/calibrationHumanReview.ts submission --pack=<locked-pack.json> --draft=<completed-review.json> --output=<sealed-submission.json>
  npx tsx src/cli/calibrationHumanReview.ts adjudication --pack=<locked-pack.json> --submission=<sealed.json> --submission=<sealed.json> --draft=<adjudication.json> --output=<sealed-adjudication.json>
  npx tsx src/cli/calibrationHumanReview.ts finalize --pack=<locked-pack.json> --submission=<sealed.json> --submission=<sealed.json> --adjudication=<sealed.json> --output=<evidence-bundle.json>
  npx tsx src/cli/calibrationHumanReview.ts artifacts --bundle=<evidence-bundle.json> --output-dir=<empty-local-directory>

All commands are local-only. Outputs are mode 0600 and immutable by default; an
existing destination is never overwritten. Structural fixtures must declare
synthetic_contract_fixture and can only produce test_only_never_publish trust.
The artifacts command runs the real calibration gates and fails closed if the
human labels are incomplete or do not meet the frozen thresholds.
`;

type ContextualSelectionAuthorityPaths = {
  lineage: string;
  candidatePool: string;
  candidatePoolManifest: string;
  subjectRecords: string;
  selection: string;
  auditPlan: string;
};

const contextualSelectionAuthorityPaths = (argv: string[]): ContextualSelectionAuthorityPaths => {
  const input = {
    lineage: getArg('--contextual-lineage', argv),
    candidatePool: getArg('--contextual-candidate-pool', argv),
    candidatePoolManifest: getArg('--contextual-candidate-pool-manifest', argv),
    subjectRecords: getArg('--contextual-subject-records', argv),
    selection: getArg('--contextual-selection', argv),
    auditPlan: getArg('--contextual-audit-plan', argv),
  };
  if (Object.values(input).some((value) => value == null || !String(value).trim())) {
    throw new Error('calibration_human_review_contextual_selection_required');
  }
  return {
    lineage: requiredPath(input.lineage, '--contextual-lineage'),
    candidatePool: requiredPath(input.candidatePool, '--contextual-candidate-pool'),
    candidatePoolManifest: requiredPath(input.candidatePoolManifest, '--contextual-candidate-pool-manifest'),
    subjectRecords: requiredPath(input.subjectRecords, '--contextual-subject-records'),
    selection: requiredPath(input.selection, '--contextual-selection'),
    auditPlan: requiredPath(input.auditPlan, '--contextual-audit-plan'),
  };
};

const assertGovernedContextualSelectionAuthority = async (params: {
  argv: string[];
  pack: ReturnType<typeof decodeCalibrationHumanReviewPack>;
}) => {
  const paths = contextualSelectionAuthorityPaths(params.argv);
  const verification = await verifyGovernedContextualHumanReviewComposition({
    paths,
    pack: params.pack,
  });
  return { paths, verification };
};

const readSubmissions = async (packPath: string, argv: string[]) => {
  const pack = decodeCalibrationHumanReviewPack(await readFile(packPath));
  const paths = getArgs('--submission', argv).map((path) => requiredPath(path, '--submission'));
  if (!paths.length) throw new Error('at least one --submission is required');
  const submissions = await Promise.all(paths.map(async (path) => (
    decodeCalibrationHumanReviewerSubmission(pack, await readFile(path))
  )));
  return { pack, submissions };
};

export const runCalibrationHumanReviewCli = async (argv = process.argv.slice(2)) => {
  if (hasFlag('--help', argv) || argv.length === 0) return { usage: calibrationHumanReviewUsage };
  const forbidden = ['--overwrite', '--upload', '--publish', '--deploy', '--write-r2'];
  if (argv.some((value) => forbidden.some((flag) => value === flag || value.startsWith(`${flag}=`)))) {
    throw new Error('remote, overwrite, and publication operations are not implemented');
  }
  const command = argv[0];
  if (command === 'prepare') {
    contextualSelectionAuthorityPaths(argv);
    const draftPath = requiredPath(getArg('--draft', argv), '--draft');
    const materialsPath = requiredPath(getArg('--materials', argv), '--materials');
    const packOutputPath = requiredPath(getArg('--pack-output', argv), '--pack-output');
    const sourcePacketOutputPath = requiredPath(
      getArg('--source-packet-output', argv),
      '--source-packet-output',
    );
    if (packOutputPath === sourcePacketOutputPath) {
      throw new Error('governed pack and source-packet output paths must differ');
    }
    const input = await readJson<
      Omit<CalibrationHumanReviewPackDraft, 'sourceEvidence'> & { sourceId: string }
    >(draftPath, 'governed calibration human-review pack draft is not valid JSON');
    const { sourceId, ...packMaterial } = input;
    const sourceDraft = await readJson<CalibrationHumanReviewSourcePacketDraft>(
      materialsPath,
      'calibration human-review source-material draft is not valid JSON',
    );
    const provisionalPack = buildCalibrationHumanReviewPack({
      ...packMaterial,
      sourceEvidence: {
        evidenceOrigin: 'governed_locked_holdout_candidates',
        sourceId,
        sourceSha256: '0'.repeat(64),
      },
    });
    const { materialSetSha256 } = calculateCalibrationHumanReviewSourceMaterialSet(
      provisionalPack,
      sourceDraft,
    );
    const pack = buildCalibrationHumanReviewPack({
      ...packMaterial,
      sourceEvidence: {
        evidenceOrigin: 'governed_locked_holdout_candidates',
        sourceId,
        sourceSha256: materialSetSha256,
      },
    });
    await assertGovernedContextualSelectionAuthority({ argv, pack });
    const packet = buildCalibrationHumanReviewSourcePacket(pack, sourceDraft);
    let wrotePack = false;
    let wrotePacket = false;
    try {
      await writeNew(packOutputPath, serializeCalibrationHumanReviewPack(pack));
      wrotePack = true;
      await writeNew(
        sourcePacketOutputPath,
        serializeCalibrationHumanReviewSourcePacket(pack, packet),
      );
      wrotePacket = true;
    } catch (error) {
      if (wrotePacket) await rm(sourcePacketOutputPath, { force: true });
      if (wrotePack) await rm(packOutputPath, { force: true });
      throw error;
    }
    return {
      command,
      pack_output: packOutputPath,
      source_packet_output: sourcePacketOutputPath,
      pack_digest: pack.packDigest,
      locked_input_sha256: pack.lockedInputSha256,
      source_packet_digest: packet.packetDigest,
      material_set_sha256: packet.materialSetSha256,
      material_count: packet.materials.length,
      pair_candidate_count: pack.pairCandidates.length,
      contextual_candidate_count: pack.contextualCandidates.length,
      authorization_ceiling: 'production_candidate_after_real_human_review' as const,
      database_reads: 0 as const,
      database_writes: 0 as const,
      storage_reads: 0 as const,
      storage_writes: 0 as const,
      luna_calls: 0 as const,
    };
  }
  if (command === 'pack') {
    const draftPath = requiredPath(getArg('--draft', argv), '--draft');
    const outputPath = requiredPath(getArg('--output', argv), '--output');
    const draft = await readJson<CalibrationHumanReviewPackDraft>(
      draftPath,
      'calibration human-review pack draft is not valid JSON',
    );
    if (draft.sourceEvidence?.evidenceOrigin === 'governed_locked_holdout_candidates') {
      throw new Error('governed calibration packs must be created with prepare and verified contextual selection inputs');
    }
    const pack = buildCalibrationHumanReviewPack(draft);
    await writeNew(outputPath, serializeCalibrationHumanReviewPack(pack));
    return {
      command,
      output: outputPath,
      pack_digest: pack.packDigest,
      locked_input_sha256: pack.lockedInputSha256,
      pair_candidate_count: pack.pairCandidates.length,
      contextual_candidate_count: pack.contextualCandidates.length,
      authorization_ceiling: pack.sourceEvidence.evidenceOrigin === 'synthetic_contract_fixture'
        ? 'test_only_never_publish' : 'production_candidate_after_real_human_review',
    };
  }
  if (command === 'materials') {
    const packPath = requiredPath(getArg('--pack', argv), '--pack');
    const draftPath = requiredPath(getArg('--draft', argv), '--draft');
    const outputPath = requiredPath(getArg('--output', argv), '--output');
    const pack = decodeCalibrationHumanReviewPack(await readFile(packPath));
    const draft = await readJson<CalibrationHumanReviewSourcePacketDraft>(
      draftPath,
      'calibration human-review source-material draft is not valid JSON',
    );
    const packet = buildCalibrationHumanReviewSourcePacket(pack, draft);
    await writeNew(outputPath, serializeCalibrationHumanReviewSourcePacket(pack, packet));
    return {
      command,
      output: outputPath,
      pack_digest: pack.packDigest,
      material_count: packet.materials.length,
      material_set_sha256: packet.materialSetSha256,
      source_packet_digest: packet.packetDigest,
      purpose: packet.purpose,
    };
  }
  if (command === 'assignment') {
    const packPath = requiredPath(getArg('--pack', argv), '--pack');
    const reviewerId = String(getArg('--reviewer-id', argv) || '');
    const outputPath = requiredPath(getArg('--output', argv), '--output');
    const sourcePacketPath = getArg('--source-packet', argv);
    const sourcePacket = sourcePacketPath == null
      ? undefined
      : await readFile(requiredPath(sourcePacketPath, '--source-packet'));
    const pack = decodeCalibrationHumanReviewPack(await readFile(packPath));
    if (pack.sourceEvidence.evidenceOrigin === 'governed_locked_holdout_candidates') {
      await assertGovernedContextualSelectionAuthority({ argv, pack });
    }
    const assignment = buildCalibrationHumanReviewAssignment(
      pack,
      reviewerId,
      sourcePacket,
    );
    await writeNew(outputPath, serializeCalibrationHumanReviewAssignment(assignment));
    return {
      command,
      output: outputPath,
      reviewer_id: reviewerId,
      source_packet_digest: assignment.sourcePacketDigest,
      assignment_digest: assignment.assignmentDigest,
    };
  }
  if (command === 'submission') {
    const packPath = requiredPath(getArg('--pack', argv), '--pack');
    const draftPath = requiredPath(getArg('--draft', argv), '--draft');
    const outputPath = requiredPath(getArg('--output', argv), '--output');
    const pack = decodeCalibrationHumanReviewPack(await readFile(packPath));
    const draft = await readJson<CalibrationHumanReviewerSubmissionDraft>(
      draftPath,
      'calibration human-review submission draft is not valid JSON',
    );
    const submission = buildCalibrationHumanReviewerSubmission(pack, draft);
    await writeNew(outputPath, serializeCalibrationHumanReviewerSubmission(pack, submission));
    return {
      command,
      output: outputPath,
      reviewer_id: submission.reviewerId,
      submission_digest: submission.submissionDigest,
    };
  }
  if (command === 'adjudication') {
    const packPath = requiredPath(getArg('--pack', argv), '--pack');
    const draftPath = requiredPath(getArg('--draft', argv), '--draft');
    const outputPath = requiredPath(getArg('--output', argv), '--output');
    const { pack, submissions } = await readSubmissions(packPath, argv);
    const draft = await readJson<CalibrationHumanReviewAdjudicationDraft>(
      draftPath,
      'calibration human-review adjudication draft is not valid JSON',
    );
    const adjudication = buildCalibrationHumanReviewAdjudication(pack, submissions, draft);
    await writeNew(
      outputPath,
      serializeCalibrationHumanReviewAdjudication(pack, submissions, adjudication),
    );
    return { command, output: outputPath, adjudication_digest: adjudication.adjudicationDigest };
  }
  if (command === 'finalize') {
    const packPath = requiredPath(getArg('--pack', argv), '--pack');
    const adjudicationPath = requiredPath(getArg('--adjudication', argv), '--adjudication');
    const outputPath = requiredPath(getArg('--output', argv), '--output');
    const { pack, submissions } = await readSubmissions(packPath, argv);
    const bundle = finalizeCalibrationHumanReview({
      pack,
      submissions,
      adjudication: await readFile(adjudicationPath),
    });
    await writeNew(outputPath, serializeCalibrationHumanReviewBundle(bundle));
    return {
      command,
      output: outputPath,
      evidence_set_sha256: bundle.evidenceSetSha256,
      bundle_digest: bundle.bundleDigest,
      evidence_class: bundle.evidenceClass,
      authorization_scope: bundle.authorizationScope,
    };
  }
  if (command === 'artifacts') {
    const bundlePath = requiredPath(getArg('--bundle', argv), '--bundle');
    const outputDir = requiredPath(getArg('--output-dir', argv), '--output-dir');
    const bundle = decodeCalibrationHumanReviewBundle(await readFile(bundlePath));
    const { pairArtifact, contextualArtifact } = buildCalibrationArtifactsFromHumanReview(bundle);
    const pairPath = resolve(outputDir, 'pair-calibration-artifact.json');
    const contextualPath = resolve(outputDir, 'contextual-calibration-artifact.json');
    await writeNew(pairPath, `${canonicalizeRelationshipInput(pairArtifact)}\n`);
    try {
      await writeNew(contextualPath, `${canonicalizeContextualExplanation(contextualArtifact)}\n`);
    } catch (error) {
      await rm(pairPath, { force: true });
      throw error;
    }
    return {
      command,
      pair_output: pairPath,
      contextual_output: contextualPath,
      pair_decision: pairArtifact.decision,
      contextual_decision: contextualArtifact.decision,
      pair_receipt_id: pairArtifact.receipt.receiptId,
      contextual_receipt_id: contextualArtifact.receipt.receiptId,
    };
  }
  throw new Error(`unknown calibration human-review command: ${String(command)}`);
};

if (require.main === module) {
  runCalibrationHumanReviewCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
