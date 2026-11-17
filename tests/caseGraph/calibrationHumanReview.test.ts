import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT,
  CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION,
  assertAuthoritativeCalibrationHumanReviewDerivedEvidenceBodies,
  assertCalibrationHumanReviewBundleProductionCandidate,
  buildCalibrationArtifactsFromHumanReview,
  buildCalibrationHumanReviewAdjudication,
  buildCalibrationHumanReviewAssignment,
  buildCalibrationHumanReviewPack,
  buildCalibrationHumanReviewerSubmission,
  decodeCalibrationHumanReviewBundle,
  decodeCalibrationHumanReviewPack,
  decodeCalibrationHumanReviewerSubmission,
  finalizeCalibrationHumanReview,
  serializeCalibrationHumanReviewBundle,
  serializeCalibrationHumanReviewPack,
  type CalibrationHumanReviewAdjudicationDraft,
  type CalibrationHumanReviewPack,
  type CalibrationHumanReviewPackDraft,
  type CalibrationHumanReviewerSubmission,
} from '../../src/caseGraph/calibrationHumanReview';
import {
  buildContextualRelationshipCalibrationAuditPlan,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  type EvidenceUniverseRawRecord,
} from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import {
  canonicalizeRelationshipInput,
  buildRelationshipInputRecord,
  relationshipInputSha256,
  type RelationshipInputRecord,
} from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildCalibrationHumanReviewSourcePacket,
  calculateCalibrationHumanReviewSourceMaterialSet,
  decodeCalibrationHumanReviewSourcePacket,
  serializeCalibrationHumanReviewSourcePacket,
  type CalibrationHumanReviewSourcePacket,
} from '../../src/caseGraph/calibrationHumanReviewSourcePacket';
import { buildTypedRelationshipCalibrationAuditPlan } from '../../src/caseGraph/typedRelationshipCalibration';
import { runCalibrationHumanReviewCli } from '../../src/cli/calibrationHumanReview';
import {
  FULL_PRODUCTION_CALIBRATION_FIXTURE_USE,
  buildFullProductionCalibrationTestFixture,
} from './fullProductionCalibrationTestSupport';

const clone = <T>(value: T): T => structuredClone(value);

let draft: CalibrationHumanReviewPackDraft;
let pack: CalibrationHumanReviewPack;
let submissions: CalibrationHumanReviewerSubmission[];
let adjudicationDraft: CalibrationHumanReviewAdjudicationDraft;
let sourceRecords: RelationshipInputRecord[];
let sourcePacket: CalibrationHumanReviewSourcePacket;

const rawRecord = (record: RelationshipInputRecord): EvidenceUniverseRawRecord => {
  const separator = record.address.indexOf(':');
  const kind = record.address.slice(0, separator);
  const recordId = record.address.slice(separator + 1);
  return {
    kind: kind as EvidenceUniverseRawRecord['kind'],
    recordId,
    source: record.source.sourceId,
    sourceRecordId: record.source.sourceRecordId,
    title: `Blinded source ${recordId}`,
    summary: `Governed source material for ${record.address}.`,
    canonicalUrl: null,
    previewUrl: null,
    eventTimestamp: null,
    lat: null,
    lon: null,
    location: null,
    countryCode: null,
    linkedSightingId: null,
    updatedAt: '2026-07-18T09:00:00.000Z',
    public: true,
  };
};

const makeSubmission = (
  targetPack: CalibrationHumanReviewPack,
  reviewerId: string,
  minute: number,
): CalibrationHumanReviewerSubmission => {
  const pair = targetPack.pairCandidates[0];
  const contextual = targetPack.contextualCandidates[0];
  const pairFixtureLabel = draftPairLabel;
  const contextualFixtureLabel = draftContextualLabel;
  return buildCalibrationHumanReviewerSubmission(targetPack, {
    reviewerId,
    startedAt: `2026-07-18T10:${String(minute).padStart(2, '0')}:00.000Z`,
    submittedAt: `2026-07-18T10:${String(minute + 2).padStart(2, '0')}:00.000Z`,
    pairReviews: [{
      pairKey: pair.pairKey,
      evaluationDigest: pair.evaluationDigest,
      pairOutcome: pairFixtureLabel.pairOutcome,
      edgeAdjudications: pairFixtureLabel.edgeAdjudications,
      hardNegativeCategory: pairFixtureLabel.hardNegativeCategory,
      reviewedAt: `2026-07-18T10:${String(minute + 1).padStart(2, '0')}:00.000Z`,
    }],
    contextualReviews: [{
      sampleId: contextual.sampleId,
      evaluationDigest: contextual.evaluationDigest,
      truthLabel: contextualFixtureLabel.truthLabel,
      hardNegativeCategory: contextualFixtureLabel.hardNegativeCategory,
      rationaleCode: 'fixture_contract_label',
      reviewedAt: `2026-07-18T10:${String(minute + 1).padStart(2, '0')}:00.000Z`,
    }],
  });
};

let draftPairLabel: ReturnType<typeof buildFullProductionCalibrationTestFixture>['pair']['artifact']['labels'][number];
let draftContextualLabel: ReturnType<typeof buildFullProductionCalibrationTestFixture>['contextual']['artifact']['labels'][number];

beforeAll(() => {
  const structural = buildFullProductionCalibrationTestFixture({
    snapshotId: '00000000-0000-4000-8000-000000000a11',
    corpusVersion: 'human-review-workflow-contract-fixture-v1',
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: 'a'.repeat(64),
    universeRecordCount: 105,
  });
  draftPairLabel = structural.pair.artifact.labels[0];
  draftContextualLabel = structural.contextual.artifact.labels[0];
  sourceRecords = [...structural.pair.relationshipInputRecords];
  const pairAddresses = new Set(sourceRecords.map(({ address }) => address));
  for (const contextualLabel of structural.contextual.artifact.labels) {
    const address = contextualLabel.candidate.subjectAddress;
    if (pairAddresses.has(address)) continue;
    const sourceIndex = sourceRecords.length + 1;
    sourceRecords.push(buildRelationshipInputRecord({
      binding: structural.pair.artifact.lineage.binding,
      address,
      source: {
        sourceId: `context-source-${sourceIndex}`,
        sourceRecordId: `context-record-${sourceIndex}`,
        registryVersion: 'source-registry-v2',
        lineageId: `context-lineage-${sourceIndex}`,
        dependencyRisk: 'low',
      },
      facts: [],
      recordMissingness: [],
      duplicateLineage: null,
      crossReferences: [],
      sourceAssertions: [],
      narrativeVector: {
        status: 'missing', modelId: 'narrative-model', modelVersion: 'v2', dimensions: 16,
        normalization: 'l2', inputSha256: null, vectorSha256: null, reason: 'no_narrative',
      },
      governedReferences: [],
    }));
    pairAddresses.add(address);
  }
  const pairAuditPlan = buildTypedRelationshipCalibrationAuditPlan({
    lockedHoldout: [{
      pairKey: draftPairLabel.pairKey,
      sourceGroupId: 'synthetic-pair-group',
    }],
    tuningSet: [{
      pairKey: `pair:${relationshipInputSha256('human-review-disjoint-pair-tuning')}`,
      sourceGroupId: 'synthetic-pair-tuning',
    }],
    labelPolicyVersion: 'pair-label-policy-v1',
    groupingPolicyVersion: 'pair-grouping-policy-v1',
  });
  const contextualAuditPlan = buildContextualRelationshipCalibrationAuditPlan({
    lockedHoldout: [{
      sampleId: draftContextualLabel.sampleId,
      sourceGroupId: 'synthetic-contextual-group',
    }],
    tuningSet: [{
      sampleId: `context-calibration-sample:${relationshipInputSha256('human-review-disjoint-context-tuning')}`,
      sourceGroupId: 'synthetic-contextual-tuning',
    }],
    labelPolicyVersion: 'context-label-policy-v1',
    groupingPolicyVersion: 'context-grouping-policy-v1',
  });
  draft = {
    lockedAt: '2026-07-18T10:00:00.000Z',
    sourceEvidence: {
      evidenceOrigin: 'synthetic_contract_fixture',
      sourceId: 'full-production-calibration-test-support',
      sourceSha256: relationshipInputSha256(FULL_PRODUCTION_CALIBRATION_FIXTURE_USE),
    },
    reviewPolicy: {
      reviewerIds: ['test-reviewer-alpha', 'test-reviewer-beta'],
      adjudicatorId: 'test-adjudicator',
      minimumIndependentReviewers: 2,
      pairReviewerCohortId: 'test-pair-reviewers-v1',
      pairAdjudicationPolicyVersion: 'test-pair-adjudication-v1',
      contextualReviewerCohortId: 'test-context-reviewers-v1',
      contextualAdjudicationPolicyVersion: 'test-context-adjudication-v1',
    },
    pairLineage: structural.pair.artifact.lineage,
    contextualLineage: structural.contextual.artifact.lineage,
    pairAuditPlan,
    contextualAuditPlan,
    pairCandidates: [{
      pairKey: draftPairLabel.pairKey,
      sourceGroupId: 'synthetic-pair-group',
      evaluationDigest: draftPairLabel.evaluation.evaluationDigest,
      evaluation: draftPairLabel.evaluation,
    }],
    contextualCandidates: [{
      sampleId: draftContextualLabel.sampleId,
      sourceGroupId: 'synthetic-contextual-group',
      evaluationDigest: draftContextualLabel.review.evaluationDigest,
      candidate: draftContextualLabel.candidate,
      evaluation: draftContextualLabel.evaluation,
      sourceSnapshotDigest: draftContextualLabel.sourceSnapshotDigest,
      observationArchiveRecordDigest: draftContextualLabel.observationArchiveRecordDigest,
    }],
  };
  pack = buildCalibrationHumanReviewPack(draft);
  const requiredAddresses = new Set([
    ...pack.pairCandidates.flatMap((candidate) => candidate.evaluation.addresses),
    ...pack.contextualCandidates.map((candidate) => candidate.candidate.subjectAddress),
  ]);
  sourcePacket = buildCalibrationHumanReviewSourcePacket(pack, {
    records: sourceRecords.filter((record) => requiredAddresses.has(record.address)).map((relationshipRecord) => ({
      rawRecord: rawRecord(relationshipRecord),
      relationshipRecord,
    })),
  });
  submissions = [
    makeSubmission(pack, 'test-reviewer-alpha', 1),
    makeSubmission(pack, 'test-reviewer-beta', 4),
  ];
  adjudicationDraft = {
    adjudicatorId: 'test-adjudicator',
    startedAt: '2026-07-18T10:07:00.000Z',
    adjudicatedAt: '2026-07-18T10:08:00.000Z',
    pairAdjudications: [{
      pairKey: pack.pairCandidates[0].pairKey,
      evaluationDigest: pack.pairCandidates[0].evaluationDigest,
      pairOutcome: draftPairLabel.pairOutcome,
      edgeAdjudications: draftPairLabel.edgeAdjudications,
      hardNegativeCategory: draftPairLabel.hardNegativeCategory,
      reviewedAt: '2026-07-18T10:08:00.000Z',
      basis: 'unanimous',
      resolutionRationaleCode: 'unanimous_contract_review',
    }],
    contextualAdjudications: [{
      sampleId: pack.contextualCandidates[0].sampleId,
      evaluationDigest: pack.contextualCandidates[0].evaluationDigest,
      truthLabel: draftContextualLabel.truthLabel,
      hardNegativeCategory: draftContextualLabel.hardNegativeCategory,
      rationaleCode: 'fixture_contract_label',
      reviewedAt: '2026-07-18T10:08:00.000Z',
      basis: 'unanimous',
      resolutionRationaleCode: 'unanimous_contract_review',
    }],
    humanReviewAttestation: null,
  };
}, 300_000);

describe('calibration human-review evidence workflow', () => {
  it('locks pair and contextual holdouts deterministically and emits non-evidence worksheets', () => {
    expect(buildCalibrationHumanReviewPack(draft)).toEqual(pack);
    expect(buildCalibrationHumanReviewPack({
      ...draft,
      reviewPolicy: {
        ...draft.reviewPolicy,
        reviewerIds: [...draft.reviewPolicy.reviewerIds].reverse(),
      },
    })).toEqual(pack);
    expect(decodeCalibrationHumanReviewPack(serializeCalibrationHumanReviewPack(pack))).toEqual(pack);
    expect(pack).toMatchObject({
      purpose: 'human_review_evidence_collection_not_authorization',
      sourceEvidence: { evidenceOrigin: 'synthetic_contract_fixture' },
      pairCandidates: [{ pairKey: draftPairLabel.pairKey }],
      contextualCandidates: [{ sampleId: draftContextualLabel.sampleId }],
    });
    const assignment = buildCalibrationHumanReviewAssignment(pack, 'test-reviewer-alpha');
    expect(assignment).toMatchObject({
      purpose: 'review_worksheet_not_evidence',
      packDigest: pack.packDigest,
      lockedInputSha256: pack.lockedInputSha256,
      sourcePacketDigest: null,
      pairItems: [{ decisionTemplate: { pairOutcome: null, reviewedAt: null } }],
      contextualItems: [{ decisionTemplate: { truthLabel: null, reviewedAt: null } }],
    });
    expect(() => buildCalibrationHumanReviewAssignment(pack, 'unknown-reviewer'))
      .toThrow('calibration_human_review_assignment_reviewer_not_authorized');
  }, 30_000);

  it('binds complete blinded source materials and requires them for governed review assignments', () => {
    expect(decodeCalibrationHumanReviewSourcePacket(
      pack,
      serializeCalibrationHumanReviewSourcePacket(pack, sourcePacket),
    )).toEqual(sourcePacket);
    const governedPack = buildCalibrationHumanReviewPack({
      ...draft,
      sourceEvidence: {
        ...draft.sourceEvidence,
        evidenceOrigin: 'governed_locked_holdout_candidates',
        sourceSha256: sourcePacket.materialSetSha256,
      },
    });
    const governedPacket = buildCalibrationHumanReviewSourcePacket(governedPack, {
      records: sourcePacket.materials.map((material) => ({
        rawRecord: rawRecord(material.relationshipRecord),
        relationshipRecord: material.relationshipRecord,
      })),
    });
    expect(() => buildCalibrationHumanReviewAssignment(governedPack, 'test-reviewer-alpha'))
      .toThrow('calibration_human_review_governed_assignment_source_packet_required');
    const assignment = buildCalibrationHumanReviewAssignment(
      governedPack,
      'test-reviewer-alpha',
      governedPacket,
    );
    expect(assignment.sourcePacketDigest).toBe(governedPacket.packetDigest);
    expect(assignment.pairItems[0].sourceMaterials).toHaveLength(2);
    expect(assignment.contextualItems[0].subjectMaterial?.address)
      .toBe(governedPack.contextualCandidates[0].candidate.subjectAddress);
    expect(assignment.contextualItems[0].referenceMaterial).toMatchObject({
      reference: governedPack.contextualCandidates[0].candidate.reference,
      uncertainty: governedPack.contextualCandidates[0].candidate.uncertainty,
    });
    expect(JSON.stringify(assignment.pairItems[0])).not.toContain('rejections');
    expect(JSON.stringify(assignment.pairItems[0])).not.toContain('strength');

    const tampered = clone(governedPacket);
    tampered.materials[0].node.title = 'Substituted title';
    expect(() => decodeCalibrationHumanReviewSourcePacket(governedPack, tampered))
      .toThrow('calibration_human_review_source_material_digest_mismatch');
    const resealedDraft = governedPacket.materials.map((material) => ({
      rawRecord: rawRecord(material.relationshipRecord),
      relationshipRecord: material.relationshipRecord,
    }));
    resealedDraft[0].rawRecord.title = 'Substituted and re-sealed title';
    expect(() => buildCalibrationHumanReviewSourcePacket(governedPack, { records: resealedDraft }))
      .toThrow('calibration_human_review_governed_source_material_set_unbound');
  }, 30_000);

  it('calculates the governed source-material binding before the locked pack exists', () => {
    const records = sourcePacket.materials.map((material) => ({
      rawRecord: rawRecord(material.relationshipRecord),
      relationshipRecord: material.relationshipRecord,
    }));
    const provisionalPack = buildCalibrationHumanReviewPack({
      ...draft,
      sourceEvidence: {
        evidenceOrigin: 'governed_locked_holdout_candidates',
        sourceId: 'governed-current-corpus-candidates',
        sourceSha256: '0'.repeat(64),
      },
    });
    const calculated = calculateCalibrationHumanReviewSourceMaterialSet(
      provisionalPack,
      { records },
    );
    expect(calculated.materialSetSha256).toBe(sourcePacket.materialSetSha256);
    expect(calculated.materials.map(({ address }) => address))
      .toEqual(sourcePacket.materials.map(({ address }) => address));
  });

  it('seals complete independent submissions and binds timestamps through adjudication into receipts', () => {
    const adjudication = buildCalibrationHumanReviewAdjudication(pack, submissions, adjudicationDraft);
    const bundle = finalizeCalibrationHumanReview({ pack, submissions, adjudication });
    expect(decodeCalibrationHumanReviewBundle(serializeCalibrationHumanReviewBundle(bundle))).toEqual(bundle);
    expect(bundle).toMatchObject({
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
      pairTrustPolicy: {
        evidenceClass: 'synthetic_contract_fixture',
        authorizationScope: 'test_only_never_publish',
      },
      contextualTrustPolicy: {
        evidenceClass: 'synthetic_contract_fixture',
        authorizationScope: 'test_only_never_publish',
      },
    });
    expect(bundle.pairLabels[0].review.reviewerIds).toEqual([
      'test-reviewer-alpha', 'test-reviewer-beta',
    ]);
    expect(bundle.pairLabels[0].review.sourceObjectSha256).not.toBe(bundle.contextualLabels[0].review.sourceObjectSha256);
    expect(() => assertCalibrationHumanReviewBundleProductionCandidate(bundle))
      .toThrow('calibration_human_review_bundle_not_production_candidate');
    expect(() => buildCalibrationArtifactsFromHumanReview(bundle))
      .toThrow(/typed_relationship_calibration_(mandatory_slice_missing|gate_failed)/);
  }, 30_000);

  it('fails closed on locked-input, submission, coverage, reviewer-set, and chronology tampering', () => {
    const packTamper = clone(pack);
    packTamper.pairCandidates[0].sourceGroupId = 'tampered-source-group';
    expect(() => decodeCalibrationHumanReviewPack(packTamper))
      .toThrow(/calibration_human_review_(pair_holdout_incomplete|locked_input_tampered)/);

    const submissionTamper = clone(submissions[0]);
    submissionTamper.pairReviews[0].reviewedAt = '2026-07-18T10:01:30.000Z';
    expect(() => decodeCalibrationHumanReviewerSubmission(pack, submissionTamper))
      .toThrow('calibration_human_review_submission_digest_mismatch');

    const missing = clone(submissions[0]);
    missing.pairReviews = [];
    expect(() => buildCalibrationHumanReviewerSubmission(pack, {
      reviewerId: missing.reviewerId,
      startedAt: missing.startedAt,
      submittedAt: missing.submittedAt,
      pairReviews: missing.pairReviews,
      contextualReviews: missing.contextualReviews,
    })).toThrow('calibration_human_review_pair_submission_incomplete');

    expect(() => buildCalibrationHumanReviewAdjudication(pack, [submissions[0]], adjudicationDraft))
      .toThrow('calibration_human_review_submission_set_incomplete');

    const early = clone(adjudicationDraft);
    early.startedAt = '2026-07-18T10:05:00.000Z';
    expect(() => buildCalibrationHumanReviewAdjudication(pack, submissions, early))
      .toThrow('calibration_human_review_adjudication_predates_submissions');
  });

  it('forbids human attestation and production authorization for a structural fixture', () => {
    const attempted = clone(adjudicationDraft);
    attempted.humanReviewAttestation = {
      statementVersion: CALIBRATION_HUMAN_REVIEW_ATTESTATION_VERSION,
      statement: CALIBRATION_HUMAN_REVIEW_ATTESTATION_STATEMENT,
      attestedBy: 'test-adjudicator',
      attestedAt: attempted.adjudicatedAt,
      reviewerIds: ['test-reviewer-alpha', 'test-reviewer-beta'],
    };
    expect(() => buildCalibrationHumanReviewAdjudication(pack, submissions, attempted))
      .toThrow('calibration_human_review_fixture_attestation_forbidden');
  });

  it('does not authorize a governed-source declaration without the exact human attestation', () => {
    const governedPack = buildCalibrationHumanReviewPack({
      ...draft,
      sourceEvidence: {
        evidenceOrigin: 'governed_locked_holdout_candidates',
        sourceId: 'test-unattested-governed-declaration',
        sourceSha256: relationshipInputSha256('test-unattested-governed-source'),
      },
    });
    const governedSubmissions = [
      makeSubmission(governedPack, 'test-reviewer-alpha', 1),
      makeSubmission(governedPack, 'test-reviewer-beta', 4),
    ];
    expect(() => buildCalibrationHumanReviewAdjudication(
      governedPack,
      governedSubmissions,
      adjudicationDraft,
    )).toThrow('calibration_human_review_attestation_required');
  });

  it('rejects synthetic review bundles at the authoritative boundary before derivation', () => {
    const bundle = finalizeCalibrationHumanReview({
      pack,
      submissions,
      adjudication: buildCalibrationHumanReviewAdjudication(pack, submissions, adjudicationDraft),
    });
    expect(() => assertAuthoritativeCalibrationHumanReviewDerivedEvidenceBodies({
      bundleBody: Buffer.from(serializeCalibrationHumanReviewBundle(bundle), 'utf8'),
      pairReceiptBody: Buffer.from('{}'),
      pairArtifactBody: Buffer.from('{}'),
      pairTrustPolicyBody: Buffer.from('{}'),
      contextualReceiptBody: Buffer.from('{}'),
      contextualArtifactBody: Buffer.from('{}'),
      contextualTrustPolicyBody: Buffer.from('{}'),
    })).toThrow('calibration_human_review_bundle_not_production_candidate');
  });

  it('requires explicit adjudicator resolution for disagreement and exact unanimous outcomes', () => {
    const conflictingDraft = clone(submissions[1]);
    const pairReview = conflictingDraft.pairReviews[0];
    pairReview.edgeAdjudications = pairReview.edgeAdjudications.map((edge, index) => index === 0
      ? { ...edge, label: edge.label === 'positive' ? 'negative' : 'positive' }
      : edge);
    pairReview.pairOutcome = pairReview.edgeAdjudications.some((edge) => edge.label === 'positive')
      ? 'positive' : 'negative';
    const conflicting = buildCalibrationHumanReviewerSubmission(pack, {
      reviewerId: conflictingDraft.reviewerId,
      startedAt: conflictingDraft.startedAt,
      submittedAt: conflictingDraft.submittedAt,
      pairReviews: conflictingDraft.pairReviews,
      contextualReviews: conflictingDraft.contextualReviews,
    });
    expect(() => buildCalibrationHumanReviewAdjudication(
      pack,
      [submissions[0], conflicting],
      adjudicationDraft,
    )).toThrow('calibration_human_review_adjudication_basis_invalid');

    const resolved = clone(adjudicationDraft);
    resolved.pairAdjudications[0].basis = 'adjudicator_resolution';
    expect(buildCalibrationHumanReviewAdjudication(
      pack,
      [submissions[0], conflicting],
      resolved,
    ).pairAdjudications[0].basis).toBe('adjudicator_resolution');
  });

  it('exports canonical local pack files and refuses overwrite or remote operations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'calibration-review-cli-'));
    try {
      const draftPath = join(directory, 'draft.json');
      const outputPath = join(directory, 'pack.json');
      const materialsDraftPath = join(directory, 'materials-draft.json');
      const materialsPath = join(directory, 'materials.json');
      const assignmentPath = join(directory, 'assignment.json');
      await writeFile(draftPath, `${canonicalizeRelationshipInput(draft)}\n`, 'utf8');
      const result = await runCalibrationHumanReviewCli([
        'pack', `--draft=${draftPath}`, `--output=${outputPath}`,
      ]);
      expect(result).toMatchObject({
        command: 'pack',
        output: outputPath,
        authorization_ceiling: 'test_only_never_publish',
      });
      expect(decodeCalibrationHumanReviewPack(await readFile(outputPath))).toEqual(pack);
      await writeFile(materialsDraftPath, `${canonicalizeRelationshipInput({
        records: sourcePacket.materials.map((material) => ({
          rawRecord: rawRecord(material.relationshipRecord),
          relationshipRecord: material.relationshipRecord,
        })),
      })}\n`, 'utf8');
      expect(await runCalibrationHumanReviewCli([
        'materials', `--pack=${outputPath}`, `--draft=${materialsDraftPath}`, `--output=${materialsPath}`,
      ])).toMatchObject({
        command: 'materials',
        output: materialsPath,
        material_count: sourcePacket.materials.length,
        source_packet_digest: sourcePacket.packetDigest,
      });
      expect(await runCalibrationHumanReviewCli([
        'assignment', `--pack=${outputPath}`, `--source-packet=${materialsPath}`,
        '--reviewer-id=test-reviewer-alpha', `--output=${assignmentPath}`,
      ])).toMatchObject({
        command: 'assignment',
        output: assignmentPath,
        source_packet_digest: sourcePacket.packetDigest,
      });
      const governedDraftPath = join(directory, 'governed-draft.json');
      const governedPackPath = join(directory, 'governed-pack.json');
      const governedPacketPath = join(directory, 'governed-source-packet.json');
      const governedAssignmentPath = join(directory, 'governed-assignment.json');
      const { sourceEvidence: _sourceEvidence, ...governedDraft } = draft;
      await writeFile(governedDraftPath, `${canonicalizeRelationshipInput({
        ...governedDraft,
        sourceId: 'governed-current-corpus-candidates',
        sourceEvidence: {
          evidenceOrigin: 'governed_locked_holdout_candidates',
          sourceId: 'governed-current-corpus-candidates',
          sourceSha256: sourcePacket.materialSetSha256,
        },
      })}\n`, 'utf8');
      await expect(runCalibrationHumanReviewCli([
        'prepare',
        `--draft=${governedDraftPath}`,
        `--materials=${materialsDraftPath}`,
        `--pack-output=${governedPackPath}`,
        `--source-packet-output=${governedPacketPath}`,
      ])).rejects.toThrow('calibration_human_review_contextual_selection_required');
      await expect(runCalibrationHumanReviewCli([
        'pack', `--draft=${governedDraftPath}`, `--output=${governedPackPath}`,
      ])).rejects.toThrow('governed calibration packs must be created with prepare');
      const governedBypassPack = buildCalibrationHumanReviewPack({
        ...draft,
        sourceEvidence: {
          evidenceOrigin: 'governed_locked_holdout_candidates',
          sourceId: 'governed-current-corpus-candidates',
          sourceSha256: sourcePacket.materialSetSha256,
        },
      });
      await writeFile(governedPackPath, serializeCalibrationHumanReviewPack(governedBypassPack), 'utf8');
      await expect(runCalibrationHumanReviewCli([
        'assignment', `--pack=${governedPackPath}`, `--source-packet=${materialsPath}`,
        '--reviewer-id=test-reviewer-alpha', `--output=${governedAssignmentPath}`,
      ])).rejects.toThrow('calibration_human_review_contextual_selection_required');
      await expect(runCalibrationHumanReviewCli([
        'pack', `--draft=${draftPath}`, `--output=${outputPath}`,
      ])).rejects.toThrow('refusing to overwrite existing local review evidence');
      await expect(runCalibrationHumanReviewCli(['pack', '--upload']))
        .rejects.toThrow('remote, overwrite, and publication operations are not implemented');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
