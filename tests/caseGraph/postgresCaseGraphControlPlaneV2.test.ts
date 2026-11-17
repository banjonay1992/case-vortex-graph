import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CaseVortexRepresentedRecord } from '../../src/caseGraph/corpusAccounting';
import {
  caseVortexCorpusAccountingReceiptSha256,
  encodeCaseVortexCorpusAccountingReceipt,
} from '../../src/caseGraph/corpusAccountingIntegration';
import {
  contextualRelationshipCalibrationReceiptSha256,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';
import { canonicalizeRelationshipInput } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildIncrementalGraphPlan,
  incrementalGraphSha256,
  INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
} from '../../src/caseGraph/incrementalGraphPlan';
import {
  serializeTypedRelationshipCalibrationReceipt,
  typedRelationshipCalibrationReceiptSha256,
  type TypedRelationshipCalibrationReceipt,
} from '../../src/caseGraph/typedRelationshipCalibration';
import {
  createPostgresCaseGraphControlPlaneV2,
  validateCaseGraphV2LineageReceipts,
  type CaseGraphV2ActivePublication,
  type CaseGraphV2IncrementalJob,
  type CaseGraphV2LineageReceipts,
  type CaseGraphV2PublicationCandidate,
  type CaseGraphV2Run,
  type PostgresCaseGraphV2QueryClient,
  type PostgresCaseGraphV2QueryResult,
} from '../../src/caseGraph/postgresCaseGraphControlPlaneV2';
import {
  buildPublicationV2ActivationRow,
  buildStructurallyBoundPublicationV2Fixture,
  fixtureHash,
} from './publicationV2TestSupport';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const completionBody = (value: unknown) => Buffer.from(
  `${canonicalizeRelationshipInput(value)}\n`,
  'utf8',
);
const runId = '10000000-0000-4000-8000-000000000001';
const publicationId = '20000000-0000-4000-8000-000000000002';
const queueId = '30000000-0000-4000-8000-000000000003';
const leaseToken = '40000000-0000-4000-8000-000000000004';

vi.setConfig({ testTimeout: 300_000 });

type LineageValidationInput = Parameters<typeof validateCaseGraphV2LineageReceipts>[0];
type PublicationFixture = ReturnType<typeof buildStructurallyBoundPublicationV2Fixture>;

const lineageValidationInput = (
  fixture: PublicationFixture,
  override: Partial<LineageValidationInput> = {},
): LineageValidationInput => ({
  completion: fixture.completion,
  completionBody: fixture.completionBody,
  universeCompletionBody: fixture.universeCompletionBody,
  featureCompletionBody: fixture.featureCompletionBody,
  relationshipInputManifestBody: fixture.relationshipInputManifestBody,
  relationshipCompletionBody: completionBody(fixture.relationship.completion),
  relationshipRunIndexArchiveBody: fixture.relationship.indexArtifact.archiveBody,
  relationshipRunIndexReceiptBody: fixture.relationship.indexArtifact.receiptBody,
  relationshipRunIndexPointerBody: Buffer.from(
    `${canonicalizeRelationshipInput(fixture.relationship.pointer)}\n`,
    'utf8',
  ),
  contextualCompletionBody: fixture.contextualCompletion.artifactBody,
  calibrationSetReceiptBody: fixture.calibration.setReceiptBody,
  pairCalibrationReceiptBody: fixture.calibration.pairReceiptBody,
  contextualCalibrationReceiptBody: fixture.calibration.contextualReceiptBody,
  pairCalibrationArtifactBody: fixture.calibration.pair.artifactBody,
  pairCalibrationTrustPolicyBody: fixture.calibration.pair.trustPolicyBody,
  contextualCalibrationArtifactBody: fixture.calibration.contextual.artifactBody,
  contextualCalibrationTrustPolicyBody: fixture.calibration.contextual.trustPolicyBody,
  manifest: fixture.manifest,
  manifestBody: fixture.manifestBody,
  accountingReceipt: fixture.accountingReceipt,
  accountingReceiptBody: fixture.accountingReceiptBody,
  ...override,
});

type QueryCall = { sql: string; params: unknown[] };

type ActivationReadinessOverride = Partial<{
  migrationPresent: boolean;
  signaturePresent: boolean;
  prospectiveReady: boolean;
  servingReady: boolean;
  activeServingReady: boolean;
}>;

class FakeQueryClient implements PostgresCaseGraphV2QueryClient {
  readonly calls: QueryCall[] = [];
  transactionCount = 0;
  committedMutationCount = 0;
  private pendingMutationCount: number | null = null;

  constructor(
    private readonly respond: (call: QueryCall) => PostgresCaseGraphV2QueryResult | Promise<PostgresCaseGraphV2QueryResult>,
    private readonly activationReadiness: ActivationReadinessOverride = {},
  ) {}

  async query(sql: string, params: unknown[] = []) {
    const placeholderCount = [...sql.matchAll(/\$(\d+)/g)]
      .reduce((maximum, match) => Math.max(maximum, Number(match[1])), 0);
    if (placeholderCount !== params.length) {
      throw new Error(`placeholder/parameter mismatch: $${placeholderCount} for ${params.length} values`);
    }
    const call = { sql, params };
    this.calls.push(call);
    if (sql.includes('first_publication_recovery:migration_0235')) {
      return { rows: [{ present: this.activationReadiness.migrationPresent ?? true }] };
    }
    if (sql.includes('first_publication_recovery:signature')) {
      return { rows: [{
        present: this.activationReadiness.signaturePresent ?? true,
        recovery_function_present: true,
        publication_trigger_singleton: true,
        publication_trigger_enabled: true,
        publication_trigger_before_insert_update_row: true,
        publication_trigger_function: true,
      }] };
    }
    if (sql.includes('prospective_activation_rehearsal')) {
      const receipts = validatedReceipts();
      const prospectiveReady = this.activationReadiness.prospectiveReady ?? true;
      return { rows: [{
        transaction_read_only: false,
        total_publication_count: prospectiveReady ? '1' : '2',
        active_publication_count: '0',
        publication_id: publicationId,
        corpus_version: receipts.manifest.corpusVersion,
        public_manifest_sha256: receipts.publicManifestSha256,
        active: false,
        activated_at: null,
        deactivated_at: null,
        verified_v2: true,
      }] };
    }
    if (sql.includes('candidate_serving_projections:pre_activation')) {
      const ready = this.activationReadiness.servingReady ?? true;
      return { rows: [{
        research_search_verified: ready,
        retained_influence_verified: ready,
        content_search_verified: ready,
        claim_evidence_verified: ready,
        external_correlations_complete: ready,
      }] };
    }
    if (sql.includes('candidate_serving_projections:active_reconciliation')) {
      const ready = this.activationReadiness.activeServingReady ?? true;
      return { rows: [{
        research_search_verified: ready,
        retained_influence_verified: ready,
        content_search_verified: ready,
        claim_evidence_verified: ready,
        external_correlations_complete: ready,
      }] };
    }
    if (/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)
      || sql.includes('activate_uap_case_graph_publication_v2')
      || sql.includes('rollback_uap_case_graph_publication_v1')
      || sql.includes('deactivate_first_uap_case_graph_publication_v1')) {
      if (this.pendingMutationCount === null) this.committedMutationCount += 1;
      else this.pendingMutationCount += 1;
    }
    return this.respond(call);
  }

  async transaction<T>(work: (transaction: FakeQueryClient) => Promise<T>): Promise<T> {
    if (this.pendingMutationCount !== null) throw new Error('nested_fake_transaction_not_supported');
    this.transactionCount += 1;
    this.pendingMutationCount = 0;
    try {
      const result = await work(this);
      this.committedMutationCount += this.pendingMutationCount;
      this.pendingMutationCount = null;
      return result;
    } catch (error) {
      this.pendingMutationCount = null;
      throw error;
    }
  }
}

let cachedValidatedReceipts: CaseGraphV2LineageReceipts | null = null;

const validatedReceipts = (): CaseGraphV2LineageReceipts => {
  if (cachedValidatedReceipts) return cachedValidatedReceipts;
  const fixture = buildStructurallyBoundPublicationV2Fixture();
  cachedValidatedReceipts = validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture));
  return cachedValidatedReceipts;
};

const representedRecords = (): CaseVortexRepresentedRecord[] => {
  const fixture = buildStructurallyBoundPublicationV2Fixture();
  return fixture.relationship.records
    .map((record, index): CaseVortexRepresentedRecord => {
      const separator = record.address.indexOf(':');
      const kind = record.address.slice(0, separator) as CaseVortexRepresentedRecord['kind'];
      const recordId = record.address.slice(separator + 1);
      const digest = (suffix: string) => sha(`${record.address}:${index}:${suffix}`);
      return {
        status: 'represented',
        kind,
        recordId,
        address: record.address,
        universe: { address: record.address, sha256: digest('universe') },
        relationshipInput: {
          address: record.address,
          sha256: digest('relationship-input'),
          disposition: 'processed',
        },
        graph: { address: record.address, sha256: digest('graph') },
        userInterface: { address: record.address, sha256: digest('ui') },
      };
    })
    .sort((left, right) => left.address.localeCompare(right.address));
};

let cachedRepresentedRecordReceipts: CaseGraphV2LineageReceipts | null = null;

const receiptsForRecords = (
  records: CaseVortexRepresentedRecord[],
  override: Partial<{
    representedAddressSetSha256: string;
    universePointerSetSha256: string;
    relationshipInputPointerSetSha256: string;
    graphPointerSetSha256: string;
    userInterfacePointerSetSha256: string;
  }> = {},
) => {
  const isDefault = Object.keys(override).length === 0;
  if (isDefault && cachedRepresentedRecordReceipts) return cachedRepresentedRecordReceipts;
  const fixture = buildStructurallyBoundPublicationV2Fixture();
  const lines = (field: 'universe' | 'relationshipInput' | 'graph' | 'userInterface') => records
    .map((record) => `${record.address}:${record[field].sha256}\n`).join('');
  const accountingReceipt = {
    ...fixture.accountingReceipt,
    representedAddressSetSha256: sha(records.map((record) => `${record.address}\n`).join('')),
    universePointerSetSha256: sha(lines('universe')),
    relationshipInputPointerSetSha256: sha(lines('relationshipInput')),
    graphPointerSetSha256: sha(lines('graph')),
    userInterfacePointerSetSha256: sha(lines('userInterface')),
    ...override,
  };
  const accountingReceiptBody = encodeCaseVortexCorpusAccountingReceipt(accountingReceipt);
  const completion = {
    ...fixture.completion,
    accounting_receipt_sha256: caseVortexCorpusAccountingReceiptSha256(accountingReceiptBody),
  };
  const receipts = validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
    completion,
    completionBody: completionBody(completion),
    accountingReceipt,
    accountingReceiptBody,
  }));
  if (isDefault) cachedRepresentedRecordReceipts = receipts;
  return receipts;
};

const expectedRun = (receipts: CaseGraphV2LineageReceipts): CaseGraphV2Run => ({
  runId,
  corpusVersion: receipts.manifest.corpusVersion,
  snapshotId: receipts.manifest.lineage.snapshot.snapshotId,
  universeRecordCount: receipts.manifest.lineage.universe.recordCount,
  completionManifestKey: fixtureCompletionKey(),
  completionManifestSha256: receipts.publicationCompletionSha256,
  status: 'completed',
});

const snapshotRows = (receipts: CaseGraphV2LineageReceipts) => (
  ['document', 'photo', 'sighting', 'video'] as const
).map((kind) => ({
  snapshot_id: receipts.manifest.lineage.snapshot.snapshotId,
  snapshot_policy: receipts.manifest.lineage.snapshot.snapshotPolicy,
  source_mvcc_snapshot: receipts.manifest.lineage.snapshot.sourceMvccSnapshot,
  source_snapshot_matches: true,
  materialized_at_matches: true,
  entity_kind: kind,
  capture_policy: kind === 'sighting'
    ? receipts.manifest.lineage.snapshot.capturePolicy
    : 'catalogue-materialized-v1',
  component_status: 'complete',
  component_row_count: String(receipts.accounting.capturedByKind[kind]),
}));

const exactRelationshipAccounting = (receipts: CaseGraphV2LineageReceipts) => ({
  universe_record_count: receipts.relationshipCompletion.universeRecordCount,
  address_kind_counts: receipts.relationshipCompletion.addressKindCounts,
  candidate_pair_count: receipts.relationshipCompletion.candidatePairCount,
  typed_edge_count: receipts.relationshipCompletion.typedEdgeCount,
  typed_edge_type_counts: receipts.relationshipCompletion.typedEdgeTypeCounts,
  skipped_group_count: receipts.relationshipCompletion.skippedGroupCount,
  skipped_estimated_pair_count: receipts.relationshipCompletion.skippedEstimatedPairCount,
  relationship_status_counts: {
    linked: receipts.relationshipCompletion.linkedAddressCount,
    candidate_only: receipts.relationshipCompletion.candidateOnlyAddressCount,
    isolated: receipts.relationshipCompletion.isolatedAddressCount,
  },
  address_ledger_set_sha256: receipts.relationshipCompletion.addressLedgerSetSha256,
});

const fixtureCompletionKey = () => buildStructurallyBoundPublicationV2Fixture().keys.completionKey;

const runRow = (receipts: CaseGraphV2LineageReceipts) => ({
  ...(() => {
    const accounting = exactRelationshipAccounting(receipts);
    return {
      expected_eligible_count: String(accounting.universe_record_count),
      processed_eligible_count: String(accounting.universe_record_count),
      universe_record_count: String(accounting.universe_record_count),
      relationship_input_record_count: String(accounting.universe_record_count),
      candidate_count: String(accounting.candidate_pair_count),
      edge_count: String(accounting.typed_edge_count),
      isolated_case_count: String(accounting.relationship_status_counts.isolated),
      candidate_pair_count: String(accounting.candidate_pair_count),
      typed_edge_count: String(accounting.typed_edge_count),
      skipped_group_count: String(accounting.skipped_group_count),
      skipped_estimated_pair_count: String(accounting.skipped_estimated_pair_count),
      linked_address_count: String(accounting.relationship_status_counts.linked),
      candidate_only_address_count: String(accounting.relationship_status_counts.candidate_only),
      isolated_address_count: String(accounting.relationship_status_counts.isolated),
      sighting_record_count: String(accounting.address_kind_counts.sighting),
      document_record_count: String(accounting.address_kind_counts.document),
      photo_record_count: String(accounting.address_kind_counts.photo),
      video_record_count: String(accounting.address_kind_counts.video),
      typed_edge_type_counts: accounting.typed_edge_type_counts,
      address_ledger_set_sha256: accounting.address_ledger_set_sha256,
      relationship_accounting: accounting,
    };
  })(),
  run_id: runId,
  corpus_version: receipts.manifest.corpusVersion,
  publishability_policy: receipts.manifest.models.publishabilityPolicy,
  feature_schema_version: receipts.manifest.models.auxiliaryFeatureSchemaVersion,
  rarity_version: receipts.manifest.models.rarityVersion,
  candidate_version: receipts.manifest.models.pipelineVersion,
  relationship_policy_version: receipts.manifest.lineage.relationship.policyVersion,
  relationship_policy_sha256: receipts.manifest.lineage.relationship.policySha256,
  relationship_model_id: receipts.manifest.lineage.relationship.modelId,
  relationship_model_version: receipts.manifest.lineage.relationship.modelVersion,
  relationship_model_sha256: receipts.manifest.lineage.relationship.modelSha256,
  relationship_schema_version: receipts.manifest.models.relationshipSchemaVersion,
  status: 'completed',
  lineage_version: 'case-vortex-lineage-v2',
  snapshot_id: receipts.manifest.lineage.snapshot.snapshotId,
  snapshot_policy: receipts.manifest.lineage.snapshot.snapshotPolicy,
  source_mvcc_snapshot: receipts.manifest.lineage.snapshot.sourceMvccSnapshot,
  universe_archive_version: receipts.manifest.lineage.universe.archiveVersion,
  universe_schema_version: receipts.manifest.lineage.universe.schemaVersion,
  universe_layout_version: receipts.manifest.lineage.universe.layoutVersion,
  universe_archive_set_sha256: receipts.manifest.lineage.universe.archiveSetSha256,
  feature_archive_set_sha256: receipts.manifest.lineage.features.archiveSetSha256,
  relationship_input_schema_version: receipts.manifest.lineage.relationshipInput.schemaVersion,
  relationship_input_archive_set_sha256: receipts.manifest.lineage.relationshipInput.archiveSetSha256,
  relationship_input_manifest_digest: receipts.manifest.lineage.relationshipInput.manifestDigest,
  relationship_run_index_digest: receipts.manifest.lineage.relationshipRun.indexDigest,
  relationship_run_artifact_set_sha256: receipts.manifest.lineage.relationshipRun.artifactSetSha256,
  relationship_completion_digest: receipts.manifest.lineage.relationshipRun.completionDigest,
  pair_calibration_id: receipts.manifest.lineage.calibration.pair.receiptId,
  pair_calibration_sha256: receipts.manifest.lineage.calibration.pair.receiptSha256,
  contextual_calibration_id: receipts.manifest.lineage.calibration.contextual.receiptId,
  contextual_calibration_sha256: receipts.manifest.lineage.calibration.contextual.receiptSha256,
  calibration_set_sha256: receipts.manifest.lineage.calibration.set.calibrationSetSha256,
  graph_artifact_set_sha256: receipts.manifest.lineage.graph.artifactSetSha256,
  corpus_accounting_digest: receipts.accountingReceiptSha256,
  r2_prefix: `case-vortex/corpora/${receipts.manifest.corpusVersion}`,
  completion_manifest_key: fixtureCompletionKey(),
  completion_manifest_sha256: receipts.publicationCompletionSha256,
  metadata: {
    controlPlaneVersion: 'case-vortex-lineage-v2',
    publicManifestVersion: receipts.manifest.schemaVersion,
    relationshipPolicyVersion: receipts.manifest.lineage.relationship.policyVersion,
    relationshipPolicySha256: receipts.manifest.lineage.relationship.policySha256,
    relationshipModelId: receipts.manifest.lineage.relationship.modelId,
    relationshipModelVersion: receipts.manifest.lineage.relationship.modelVersion,
    relationshipModelSha256: receipts.manifest.lineage.relationship.modelSha256,
    relationshipSchemaVersion: receipts.manifest.models.relationshipSchemaVersion,
    relationshipCompletionDigest: receipts.manifest.lineage.relationshipRun.completionDigest,
    relationshipRunIndexDigest: receipts.manifest.lineage.relationshipRun.indexDigest,
    relationshipRunArtifactSetSha256: receipts.manifest.lineage.relationshipRun.artifactSetSha256,
    calibrationSetSha256: receipts.manifest.lineage.calibration.set.calibrationSetSha256,
    accountingReceiptSha256: receipts.accountingReceiptSha256,
  },
  source_snapshot_matches: true,
  materialized_at_matches: true,
  excluded_count: '0',
  shard_count: String(
    receipts.manifest.topology.nodeShardCount + receipts.manifest.topology.edgeShardCount + 1,
  ),
});

const publicationReceiptRow = (receipts: CaseGraphV2LineageReceipts) => {
  const accounting = exactRelationshipAccounting(receipts);
  return {
    publication_id: publicationId,
    receipt_version: 'case-vortex-publication-receipt-v2',
    snapshot_id: receipts.manifest.lineage.snapshot.snapshotId,
    universe_archive_set_sha256: receipts.manifest.lineage.universe.archiveSetSha256,
    feature_archive_set_sha256: receipts.manifest.lineage.features.archiveSetSha256,
    relationship_input_archive_set_sha256: receipts.manifest.lineage.relationshipInput.archiveSetSha256,
    relationship_input_manifest_digest: receipts.manifest.lineage.relationshipInput.manifestDigest,
    relationship_policy_version: receipts.manifest.lineage.relationship.policyVersion,
    relationship_policy_sha256: receipts.manifest.lineage.relationship.policySha256,
    relationship_model_id: receipts.manifest.lineage.relationship.modelId,
    relationship_model_version: receipts.manifest.lineage.relationship.modelVersion,
    relationship_model_sha256: receipts.manifest.lineage.relationship.modelSha256,
    relationship_schema_version: receipts.manifest.models.relationshipSchemaVersion,
    relationship_run_index_digest: receipts.manifest.lineage.relationshipRun.indexDigest,
    relationship_run_artifact_set_sha256: receipts.manifest.lineage.relationshipRun.artifactSetSha256,
    relationship_completion_digest: receipts.manifest.lineage.relationshipRun.completionDigest,
    pair_calibration_id: receipts.manifest.lineage.calibration.pair.receiptId,
    pair_calibration_sha256: receipts.manifest.lineage.calibration.pair.receiptSha256,
    contextual_calibration_id: receipts.manifest.lineage.calibration.contextual.receiptId,
    contextual_calibration_sha256: receipts.manifest.lineage.calibration.contextual.receiptSha256,
    calibration_set_sha256: receipts.manifest.lineage.calibration.set.calibrationSetSha256,
    graph_artifact_set_sha256: receipts.manifest.lineage.graph.artifactSetSha256,
    corpus_accounting_digest: receipts.accountingReceiptSha256,
    public_manifest_sha256: receipts.publicManifestSha256,
    completion_manifest_key: fixtureCompletionKey(),
    completion_manifest_sha256: receipts.publicationCompletionSha256,
    universe_record_count: String(accounting.universe_record_count),
    sighting_record_count: String(accounting.address_kind_counts.sighting),
    document_record_count: String(accounting.address_kind_counts.document),
    photo_record_count: String(accounting.address_kind_counts.photo),
    video_record_count: String(accounting.address_kind_counts.video),
    relationship_input_record_count: String(receipts.manifest.lineage.relationshipInput.recordCount),
    graph_record_count: String(receipts.manifest.lineage.universe.recordCount),
    user_interface_record_count: String(receipts.manifest.lineage.universe.recordCount),
    represented_record_count: String(receipts.accounting.representedTotal),
    excluded_record_count: String(receipts.accounting.excludedTotal),
    observed_record_count: String(receipts.accounting.observedTotal),
    candidate_pair_count: String(accounting.candidate_pair_count),
    typed_edge_count: String(accounting.typed_edge_count),
    skipped_group_count: String(accounting.skipped_group_count),
    skipped_estimated_pair_count: String(accounting.skipped_estimated_pair_count),
    linked_address_count: String(accounting.relationship_status_counts.linked),
    candidate_only_address_count: String(accounting.relationship_status_counts.candidate_only),
    isolated_address_count: String(accounting.relationship_status_counts.isolated),
    typed_edge_type_counts: accounting.typed_edge_type_counts,
    address_ledger_set_sha256: accounting.address_ledger_set_sha256,
    relationship_accounting: accounting,
  };
};

const activeRow = (receipts: CaseGraphV2LineageReceipts): Record<string, unknown> => {
  const run = runRow(receipts);
  const receipt = publicationReceiptRow(receipts);
  return {
    ...receipt,
    publication_id: publicationId,
    run_id: runId,
    corpus_version: receipts.manifest.corpusVersion,
    run_corpus_version: receipts.manifest.corpusVersion,
    public_manifest_key: receipts.completion.manifest_key,
    publication_manifest_sha256: receipts.publicManifestSha256,
    active: true,
    activated_at: '2026-07-18T13:00:00.000Z',
    deactivated_at: null,
    rollback_of_publication_id: null,
    run_present: true,
    snapshot_present: true,
    receipt_present: true,
    run_status: 'completed',
    lineage_version: 'case-vortex-lineage-v2',
    run_snapshot_id: receipts.manifest.lineage.snapshot.snapshotId,
    snapshot_policy_matches: true,
    snapshot_at_matches: true,
    materialized_at_matches: true,
    mvcc_matches: true,
    run_universe_sha256: receipts.manifest.lineage.universe.archiveSetSha256,
    run_feature_sha256: receipts.manifest.lineage.features.archiveSetSha256,
    run_relationship_input_sha256: receipts.manifest.lineage.relationshipInput.archiveSetSha256,
    run_relationship_manifest_digest: receipts.manifest.lineage.relationshipInput.manifestDigest,
    run_relationship_policy_version: run.relationship_policy_version,
    run_relationship_policy_sha256: run.relationship_policy_sha256,
    run_relationship_model_id: run.relationship_model_id,
    run_relationship_model_version: run.relationship_model_version,
    run_relationship_model_sha256: run.relationship_model_sha256,
    run_relationship_schema_version: run.relationship_schema_version,
    run_relationship_run_index_digest: run.relationship_run_index_digest,
    run_relationship_run_artifact_set_sha256: run.relationship_run_artifact_set_sha256,
    run_relationship_completion_digest: run.relationship_completion_digest,
    run_pair_calibration_id: run.pair_calibration_id,
    run_pair_calibration_sha256: run.pair_calibration_sha256,
    run_contextual_calibration_id: run.contextual_calibration_id,
    run_contextual_calibration_sha256: run.contextual_calibration_sha256,
    run_calibration_set_sha256: run.calibration_set_sha256,
    run_graph_sha256: receipts.manifest.lineage.graph.artifactSetSha256,
    run_accounting_sha256: receipts.accountingReceiptSha256,
    run_completion_manifest_key: run.completion_manifest_key,
    run_completion_manifest_sha256: run.completion_manifest_sha256,
    run_universe_count: run.universe_record_count,
    run_relationship_input_count: run.relationship_input_record_count,
    run_expected_eligible_count: run.expected_eligible_count,
    run_processed_eligible_count: run.processed_eligible_count,
    run_excluded_count: run.excluded_count,
    run_legacy_candidate_count: run.candidate_count,
    run_legacy_edge_count: run.edge_count,
    run_legacy_isolated_count: run.isolated_case_count,
    run_candidate_pair_count: run.candidate_pair_count,
    run_typed_edge_count: run.typed_edge_count,
    run_skipped_group_count: run.skipped_group_count,
    run_skipped_estimated_pair_count: run.skipped_estimated_pair_count,
    run_linked_address_count: run.linked_address_count,
    run_candidate_only_address_count: run.candidate_only_address_count,
    run_isolated_address_count: run.isolated_address_count,
    run_sighting_record_count: run.sighting_record_count,
    run_document_record_count: run.document_record_count,
    run_photo_record_count: run.photo_record_count,
    run_video_record_count: run.video_record_count,
    run_typed_edge_type_counts: run.typed_edge_type_counts,
    run_address_ledger_set_sha256: run.address_ledger_set_sha256,
    run_relationship_accounting: run.relationship_accounting,
    ledger_total: receipt.universe_record_count,
    ledger_sighting: receipt.sighting_record_count,
    ledger_document: receipt.document_record_count,
    ledger_photo: receipt.photo_record_count,
    ledger_video: receipt.video_record_count,
    ledger_processed: String(receipts.accounting.relationshipProcessedTotal),
    ledger_not_applicable: String(receipts.accounting.relationshipNotApplicableTotal),
  };
};

const activationResultRow = (receipts: CaseGraphV2LineageReceipts) => ({
  publication_id: publicationId,
  corpus_version: receipts.manifest.corpusVersion,
  activated_at: '2026-07-18T13:00:00.000Z',
  completion_manifest_key: fixtureCompletionKey(),
  completion_manifest_sha256: receipts.publicationCompletionSha256,
  relationship_completion_digest: receipts.manifest.lineage.relationshipRun.completionDigest,
  relationship_run_index_digest: receipts.manifest.lineage.relationshipRun.indexDigest,
  relationship_run_artifact_set_sha256: receipts.manifest.lineage.relationshipRun.artifactSetSha256,
  pair_calibration_id: receipts.manifest.lineage.calibration.pair.receiptId,
  pair_calibration_sha256: receipts.manifest.lineage.calibration.pair.receiptSha256,
  contextual_calibration_id: receipts.manifest.lineage.calibration.contextual.receiptId,
  contextual_calibration_sha256: receipts.manifest.lineage.calibration.contextual.receiptSha256,
  calibration_set_sha256: receipts.manifest.lineage.calibration.set.calibrationSetSha256,
  relationship_accounting: exactRelationshipAccounting(receipts),
});

const ledgerDbRow = (record: CaseVortexRepresentedRecord, receipts: CaseGraphV2LineageReceipts) => ({
  corpus_version: receipts.manifest.corpusVersion,
  address: record.address,
  entity_kind: record.kind,
  entity_id: record.recordId,
  universe_record_sha256: record.universe.sha256,
  relationship_input_sha256: record.relationshipInput.sha256,
  graph_record_sha256: record.graph.sha256,
  user_interface_record_sha256: record.userInterface.sha256,
  relationship_disposition: record.relationshipInput.disposition,
  not_applicable_reason: record.relationshipInput.notApplicableReason ?? null,
  last_run_id: runId,
});

type IncrementalChangeDraft = Parameters<typeof buildIncrementalGraphPlan>[0]['changes'][number];

const incrementalPlan = (changes: IncrementalChangeDraft[] = [{
  action: 'insert',
  address: 'sighting:new-case',
  beforeRecordSha256: null,
  afterRecordSha256: fixtureHash('a'),
  priorIncidentEdges: [],
  priorIncidentEdgesComplete: true,
}]) => buildIncrementalGraphPlan({
  baseGeneration: {
    activationId: 'activation:base-1',
    universe: {
      snapshotId: '50000000-0000-4000-8000-000000000005',
      corpusVersion: 'corpus-control-plane-v2',
      universeArchiveVersion: INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
      universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      universeArchiveSetSha256: fixtureHash('1'),
      addressSetSha256: fixtureHash('2'),
      recordCount: 1,
    },
    relationshipInputSetSha256: fixtureHash('3'),
    graphArchiveSetSha256: fixtureHash('4'),
    incidentIndexRootSha256: fixtureHash('5'),
  },
  targetUniverse: {
    snapshotId: '60000000-0000-4000-8000-000000000006',
    corpusVersion: 'corpus-control-plane-v2',
    universeArchiveVersion: INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: fixtureHash('6'),
    addressSetSha256: fixtureHash('7'),
      recordCount: 1
        + changes.filter((change) => change.action === 'insert').length
        - changes.filter((change) => change.action === 'delete').length,
  },
  targetRelationshipInputSetSha256: fixtureHash('8'),
  incidentIndexRootSha256: fixtureHash('5'),
  sourceDiffReceiptSha256: fixtureHash('9'),
  sourceSequence: 1,
  sourceCursor: 'snapshot-diff/1',
  changes,
  thresholds: {
    batchSize: 100,
    maximumChangedRecords: 100,
    maximumChangedFraction: 1,
    maximumInvalidatedEdges: 100,
  },
});

const incrementalArtifactKey = (plan: ReturnType<typeof incrementalPlan>) => (
  `case-vortex/incremental/case-vortex-incremental-archive-v1/`
  + `${plan.watermark.target.corpusVersion}/${plan.watermark.target.snapshotId}/`
  + `${plan.planId.slice('plan:'.length)}/plan.json`
);

const incrementalSnapshotRows = (plan: ReturnType<typeof incrementalPlan>) => [
  { binding: plan.baseGeneration.universe, total: plan.baseGeneration.universe.recordCount },
  { binding: plan.watermark.target, total: plan.watermark.target.recordCount },
].flatMap(({ binding, total }) => (
  ['document', 'photo', 'sighting', 'video'] as const
).map((kind) => ({
  snapshot_id: binding.snapshotId,
  snapshot_policy: 'evidence-universe-materialized-v1',
  source_mvcc_snapshot: '1:2:3,4',
  entity_kind: kind,
  capture_policy: kind === 'sighting'
    ? 'publishable-public-v2-materialized-v1'
    : 'catalogue-materialized-v1',
  component_status: 'complete',
  component_row_count: kind === 'sighting' ? String(total) : '0',
})));

const incrementalPlanDbRow = (plan: ReturnType<typeof incrementalPlan>) => ({
  plan_id: plan.planId,
  plan_sha256: incrementalGraphSha256(plan),
  schema_version: plan.schemaVersion,
  canonical_version: plan.canonicalVersion,
  plan_artifact_key: incrementalArtifactKey(plan),
  from_snapshot_id: plan.baseGeneration.universe.snapshotId,
  to_snapshot_id: plan.watermark.target.snapshotId,
  from_corpus_version: plan.baseGeneration.universe.corpusVersion,
  to_corpus_version: plan.watermark.target.corpusVersion,
  base_activation_id: plan.baseGeneration.activationId,
  base_universe_archive_set_sha256: plan.baseGeneration.universe.universeArchiveSetSha256,
  base_address_set_sha256: plan.baseGeneration.universe.addressSetSha256,
  base_relationship_input_set_sha256: plan.baseGeneration.relationshipInputSetSha256,
  base_graph_archive_set_sha256: plan.baseGeneration.graphArchiveSetSha256,
  target_universe_archive_set_sha256: plan.watermark.target.universeArchiveSetSha256,
  target_address_set_sha256: plan.watermark.target.addressSetSha256,
  target_relationship_input_set_sha256: plan.watermark.targetRelationshipInputSetSha256,
  incident_index_root_sha256: plan.watermark.incidentIndexRootSha256,
  source_diff_receipt_sha256: plan.watermark.sourceDiffReceiptSha256,
  watermark_id: plan.watermark.watermarkId,
  watermark_sequence: String(plan.watermark.sequence),
  previous_watermark_id: plan.watermark.previousWatermarkId,
  source_cursor: plan.watermark.cursor,
  change_set_sha256: plan.watermark.changeSetSha256,
  base_record_count: String(plan.accounting.baseRecordCount),
  target_record_count: String(plan.accounting.targetRecordCount),
  change_count: String(plan.accounting.changeCount),
  insert_count: String(plan.accounting.insertCount),
  update_count: String(plan.accounting.updateCount),
  delete_count: String(plan.accounting.deleteCount),
  batch_count: String(plan.batches.length),
});

const leasedJobRow = (plan = incrementalPlan()) => ({
  id: queueId,
  plan_id: plan.planId,
  plan_sha256: incrementalGraphSha256(plan),
  plan_artifact_key: incrementalArtifactKey(plan),
  watermark_id: plan.watermark.watermarkId,
  to_corpus_version: plan.watermark.target.corpusVersion,
  target_universe_archive_set_sha256: plan.watermark.target.universeArchiveSetSha256,
  target_relationship_input_set_sha256: plan.watermark.targetRelationshipInputSetSha256,
  source_diff_receipt_sha256: plan.watermark.sourceDiffReceiptSha256,
  from_snapshot_id: plan.baseGeneration.universe.snapshotId,
  to_snapshot_id: plan.watermark.target.snapshotId,
  batch_id: plan.batches[0].batchId,
  batch_ordinal: '0',
  change_id: plan.changes[0].changeId,
  change_ordinal: '0',
  address: 'sighting:new-case',
  entity_kind: 'sighting',
  entity_id: 'new-case',
  action: 'insert',
  input_sha256: incrementalGraphSha256(plan.changes[0]),
  status: 'leased',
  attempt_count: '1',
  next_attempt_at: '2026-07-18T12:00:00.000Z',
  lease_token: leaseToken,
  leased_until: '2026-07-18T12:05:00.000Z',
  error_code: null,
});

describe('PostgreSQL Case Vortex v2 control plane', () => {
  it('re-decodes structural receipts and rejects a caller-forged lineage hash', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const forged = {
      ...fixture.accountingReceipt,
      binding: { ...fixture.accountingReceipt.binding, graphPublicationSha256: fixtureHash('0') },
    };
    const body = encodeCaseVortexCorpusAccountingReceipt(forged);
    const completion = {
      ...fixture.completion,
      accounting_receipt_sha256: caseVortexCorpusAccountingReceiptSha256(body),
    };
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      completion,
      completionBody: completionBody(completion),
      accountingReceipt: forged,
      accountingReceiptBody: body,
    }))).toThrow('case_graph_v2_lineage_receipt_binding_mismatch');
  });

  it('rejects a feature completion whose archive-set receipt was not structurally recomputed', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const tampered = {
      ...fixture.featureCompletion,
      archive_set_sha256: fixtureHash('f'),
    };
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      featureCompletionBody: Buffer.from(`${JSON.stringify(tampered)}\n`, 'utf8'),
    }))).toThrow('case_graph_completion_integrity_invalid');
  });

  it('rejects a structurally valid universe receipt that is not the publication lineage', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const universeCompletion = structuredClone(fixture.universeCompletion);
    universeCompletion.parts[0].sha256 = fixtureHash('2');
    universeCompletion.archiveSetSha256 = sha(
      universeCompletion.parts.map((part) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n'),
    );
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      universeCompletionBody: Buffer.from(`${JSON.stringify(universeCompletion)}\n`, 'utf8'),
    }))).toThrow('relationship_input_snapshot_binding_mismatch');
  });

  it('rejects a noncanonical full relationship run-index pointer before database access', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const prettyPointer = Buffer.from(JSON.stringify(fixture.relationship.pointer, null, 2), 'utf8');
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      relationshipRunIndexPointerBody: prettyPointer,
    }))).toThrow('case_graph_v2_relationship_run_index_pointer_noncanonical');
  });

  it('rejects caller-tampered candidate accounting instead of accepting a standalone count', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const tampered = {
      ...fixture.relationship.completion,
      candidatePairCount: fixture.relationship.completion.candidatePairCount + 1,
    };
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      relationshipCompletionBody: Buffer.from(
        `${canonicalizeRelationshipInput(tampered)}\n`,
        'utf8',
      ),
    }))).toThrow('full_corpus_relationship_completion_digest_mismatch');
  });

  it('rejects a run-index archive whose immutable receipt no longer authenticates its body', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const tamperedArchive = Buffer.from(fixture.relationship.indexArtifact.archiveBody);
    tamperedArchive[tamperedArchive.length - 1] ^= 0x01;
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      relationshipRunIndexArchiveBody: tamperedArchive,
    }))).toThrow();
  });

  it('rejects a synthetic pair calibration receipt before any database operation', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const { receiptSha256: _receiptSha256, ...productionWithoutSha } = fixture.calibration.pairReceipt;
    const syntheticWithoutSha: Omit<TypedRelationshipCalibrationReceipt, 'receiptSha256'> = {
      ...productionWithoutSha,
      decision: 'contract_gates_passed_test_only',
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
    };
    const synthetic = {
      ...syntheticWithoutSha,
      receiptSha256: typedRelationshipCalibrationReceiptSha256(syntheticWithoutSha),
    };
    const syntheticBody = Buffer.from(serializeTypedRelationshipCalibrationReceipt(synthetic), 'utf8');
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      pairCalibrationReceiptBody: syntheticBody,
    }))).toThrow('typed_relationship_calibration_receipt_not_production_eligible');
  });

  it('rejects a synthetic contextual calibration receipt before any database operation', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const { receiptSha256: _receiptSha256, ...productionWithoutSha } = fixture.calibration.contextualReceipt;
    const syntheticWithoutSha: Omit<ContextualRelationshipCalibrationReceipt, 'receiptSha256'> = {
      ...productionWithoutSha,
      decision: 'contract_gates_passed_test_only',
      evidenceClass: 'synthetic_contract_fixture',
      authorizationScope: 'test_only_never_publish',
    };
    const synthetic = {
      ...syntheticWithoutSha,
      receiptSha256: contextualRelationshipCalibrationReceiptSha256(syntheticWithoutSha),
    };
    const syntheticBody = Buffer.from(
      serializeContextualRelationshipCalibrationReceipt(synthetic),
      'utf8',
    );
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      contextualCalibrationReceiptBody: syntheticBody,
    }))).toThrow('contextual_calibration_receipt_not_production_eligible');
  });

  it('requires the exact canonical publication completion bytes', () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    expect(() => validateCaseGraphV2LineageReceipts(lineageValidationInput(fixture, {
      completionBody: Buffer.from(JSON.stringify(fixture.completion, null, 2), 'utf8'),
    }))).toThrow('case_graph_v2_publication_completion_bytes_mismatch');
  });

  it('rejects SQL identifier injection before any query is possible', () => {
    const client = new FakeQueryClient(() => ({ rows: [] }));
    expect(() => createPostgresCaseGraphControlPlaneV2(client, {
      schema: 'public; DROP TABLE public.uap_case_graph_runs; --',
    })).toThrow('case_graph_v2_sql_identifier_invalid');
    expect(client.calls).toHaveLength(0);
  });

  it('creates or exactly validates a lineage-v2 run from receipt-derived values', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) return { rows: snapshotRows(receipts) };
      if (sql.includes('INSERT INTO public.uap_case_graph_runs')) return { rows: [] };
      if (sql.includes('FROM public.uap_case_graph_runs AS run')) return { rows: [runRow(receipts)] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.createOrValidateRun(receipts)).resolves.toEqual(expectedRun(receipts));
    expect(client.transactionCount).toBe(1);
    const insert = client.calls.find((call) => call.sql.includes('INSERT INTO public.uap_case_graph_runs'));
    expect(insert?.sql).toContain('relationship_policy_version, relationship_model_id');
    expect(insert?.params[5]).toBe(receipts.manifest.lineage.relationship.policyVersion);
    expect(insert?.params[6]).toBe(receipts.manifest.lineage.relationship.modelId);
    expect(insert?.params).toContain(receipts.accountingReceiptSha256);
    expect(insert?.params).toContain(receipts.publicationCompletionSha256);
    expect(insert?.params).toHaveLength(55);
    expect(insert?.params[54]).toBe(receipts.manifest.models.relationshipSchemaVersion);
  });

  it('fails closed on a sealed snapshot count mismatch and never inserts a run', async () => {
    const receipts = validatedReceipts();
    const badRows = snapshotRows(receipts);
    badRows.find((row) => row.entity_kind === 'sighting')!.component_row_count = '1';
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) return { rows: badRows };
      throw new Error('run insert must not be reached');
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.createOrValidateRun(receipts)).rejects.toThrow('case_graph_v2_snapshot_mismatch');
    expect(client.calls.some((call) => call.sql.includes('INSERT INTO public.uap_case_graph_runs'))).toBe(false);
  });

  it('refuses to reuse a corpus run whose stored policy/model lineage differs', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) return { rows: snapshotRows(receipts) };
      if (sql.includes('INSERT INTO public.uap_case_graph_runs')) return { rows: [] };
      if (sql.includes('FROM public.uap_case_graph_runs AS run')) {
        return { rows: [{ ...runRow(receipts), relationship_model_id: 'different-model-v9' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.createOrValidateRun(receipts))
      .rejects.toThrow('case_graph_v2_run_lineage_mismatch:relationship_model_id');
    const runInsert = client.calls.find((call) => call.sql.includes('INSERT INTO public.uap_case_graph_runs'))!;
    expect(runInsert.sql).toContain('ON CONFLICT (corpus_version) DO NOTHING');
    expect(runInsert.sql).not.toMatch(/DO UPDATE/i);
  });

  it('refuses a stored run whose typed relationship schema is not the canonical schema', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) return { rows: snapshotRows(receipts) };
      if (sql.includes('INSERT INTO public.uap_case_graph_runs')) return { rows: [] };
      if (sql.includes('FROM public.uap_case_graph_runs AS run')) {
        return { rows: [{ ...runRow(receipts), relationship_schema_version: 'case-graph-typed-relationship-v1' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.createOrValidateRun(receipts))
      .rejects.toThrow('case_graph_v2_run_lineage_mismatch:relationship_schema_version');
  });

  it('refuses a stored run whose immutable relationship model SHA drifts', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) return { rows: snapshotRows(receipts) };
      if (sql.includes('INSERT INTO public.uap_case_graph_runs')) return { rows: [] };
      if (sql.includes('FROM public.uap_case_graph_runs AS run')) {
        return { rows: [{ ...runRow(receipts), relationship_model_sha256: fixtureHash('0') }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.createOrValidateRun(receipts))
      .rejects.toThrow('case_graph_v2_run_lineage_mismatch:relationship_model_sha256');
  });

  it('validates the complete pointer set before bounded create-only ledger inserts', async () => {
    const records = representedRecords();
    const receipts = receiptsForRecords(records);
    const client = new FakeQueryClient(({ sql, params }) => {
      if (sql.includes('INSERT INTO public.uap_case_graph_record_state')) return { rows: [] };
      if (sql.includes('address = ANY($2::text[])')) {
        const addresses = params[1] as string[];
        return { rows: addresses.map((address) => ledgerDbRow(records.find((record) => record.address === address)!, receipts)) };
      }
      if (sql.includes('COUNT(*)::text AS total')) {
        return { rows: [{
          total: String(records.length),
          sighting: String(records.filter((record) => record.kind === 'sighting').length),
          document: String(records.filter((record) => record.kind === 'document').length),
          photo: String(records.filter((record) => record.kind === 'photo').length),
          video: String(records.filter((record) => record.kind === 'video').length),
          processed: String(records.filter(
            (record) => record.relationshipInput.disposition === 'processed',
          ).length),
          not_applicable: String(records.filter(
            (record) => record.relationshipInput.disposition === 'not_applicable',
          ).length),
          matching_run: String(records.length),
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    let factoryCalls = 0;
    await expect(control.insertAllRecordLedger({
      run: expectedRun(receipts),
      receipts,
      records: () => {
        factoryCalls += 1;
        return records;
      },
      batchSize: 100,
    })).resolves.toMatchObject({
      recordCount: records.length,
      batchCount: 2,
      byKind: { sighting: 102, document: 1, photo: 1, video: 1 },
    });
    expect(factoryCalls).toBe(2);
    const inserts = client.calls.filter((call) => call.sql.includes('INSERT INTO public.uap_case_graph_record_state'));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((call) => call.sql.includes('ON CONFLICT (corpus_version, address) DO NOTHING'))).toBe(true);
    expect(inserts.every((call) => !/DO UPDATE/i.test(call.sql))).toBe(true);
  });

  it('does not write a ledger when a structural pointer set disagrees with its receipt', async () => {
    const records = representedRecords();
    const receipts = receiptsForRecords(records, { graphPointerSetSha256: fixtureHash('0') });
    const client = new FakeQueryClient(() => ({ rows: [] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.insertAllRecordLedger({
      run: expectedRun(receipts), receipts, records: () => records,
    })).rejects.toThrow('case_graph_v2_record_ledger_receipt_mismatch');
    expect(client.calls).toHaveLength(0);
  });

  it('does not write a ledger when a record disposition contradicts processed-only accounting', async () => {
    const records = representedRecords();
    const receipts = receiptsForRecords(records);
    records[0] = {
      ...records[0],
      relationshipInput: {
        ...records[0].relationshipInput,
        disposition: 'not_applicable',
        notApplicableReason: 'missing_relationship_input',
      },
    };
    const client = new FakeQueryClient(() => ({ rows: [] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.insertAllRecordLedger({
      run: expectedRun(receipts), receipts, records: () => records,
    })).rejects.toThrow('case_graph_v2_record_ledger_receipt_mismatch');
    expect(client.calls).toHaveLength(0);
    expect(client.transactionCount).toBe(0);
  });

  it('rolls back the bounded write transaction when the record factory changes after validation', async () => {
    const firstPass = representedRecords();
    const secondPass = representedRecords();
    secondPass[1] = {
      ...secondPass[1],
      graph: { ...secondPass[1].graph, sha256: fixtureHash('9') },
    };
    const receipts = receiptsForRecords(firstPass);
    const client = new FakeQueryClient(({ sql, params }) => {
      if (sql.includes('INSERT INTO public.uap_case_graph_record_state')) return { rows: [] };
      if (sql.includes('address = ANY($2::text[])')) {
        const addresses = params[1] as string[];
        return { rows: addresses.map((address) => ledgerDbRow(secondPass.find((record) => record.address === address)!, receipts)) };
      }
      throw new Error(`query after mismatched second pass: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    let pass = 0;
    await expect(control.insertAllRecordLedger({
      run: expectedRun(receipts),
      receipts,
      records: () => (pass++ === 0 ? firstPass : secondPass),
    })).rejects.toThrow('case_graph_v2_record_ledger_receipt_mismatch');
    expect(client.transactionCount).toBe(1);
    expect(client.calls.some((call) => call.sql.includes('INSERT INTO public.uap_case_graph_record_state'))).toBe(true);
    expect(client.committedMutationCount).toBe(0);
  });

  it('rolls back when a relationship disposition changes between ledger passes', async () => {
    const firstPass = representedRecords();
    const secondPass = representedRecords();
    secondPass[0] = {
      ...secondPass[0],
      relationshipInput: {
        ...secondPass[0].relationshipInput,
        disposition: 'not_applicable',
        notApplicableReason: 'missing_relationship_input',
      },
    };
    const receipts = receiptsForRecords(firstPass);
    const client = new FakeQueryClient(({ sql, params }) => {
      if (sql.includes('INSERT INTO public.uap_case_graph_record_state')) return { rows: [] };
      if (sql.includes('address = ANY($2::text[])')) {
        const addresses = params[1] as string[];
        return { rows: addresses.map((address) => ledgerDbRow(
          secondPass.find((record) => record.address === address)!, receipts,
        )) };
      }
      throw new Error(`query after mismatched second pass: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    let pass = 0;
    await expect(control.insertAllRecordLedger({
      run: expectedRun(receipts),
      receipts,
      records: () => (pass++ === 0 ? firstPass : secondPass),
    })).rejects.toThrow('case_graph_v2_record_ledger_receipt_mismatch');
    expect(client.transactionCount).toBe(1);
    expect(client.calls.some(
      (call) => call.sql.includes('INSERT INTO public.uap_case_graph_record_state'),
    )).toBe(true);
    expect(client.committedMutationCount).toBe(0);
  });

  it('rolls back when the stored ledger aggregate reports a disposition mismatch', async () => {
    const records = representedRecords();
    const receipts = receiptsForRecords(records);
    const client = new FakeQueryClient(({ sql, params }) => {
      if (sql.includes('INSERT INTO public.uap_case_graph_record_state')) return { rows: [] };
      if (sql.includes('address = ANY($2::text[])')) {
        const addresses = params[1] as string[];
        return { rows: addresses.map((address) => ledgerDbRow(
          records.find((record) => record.address === address)!, receipts,
        )) };
      }
      if (sql.includes('COUNT(*)::text AS total')) return { rows: [{
        total: String(records.length),
        sighting: '102',
        document: '1',
        photo: '1',
        video: '1',
        processed: String(records.length - 1),
        not_applicable: '1',
        matching_run: String(records.length),
      }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.insertAllRecordLedger({
      run: expectedRun(receipts), receipts, records: () => records,
    })).rejects.toThrow('case_graph_v2_record_ledger_final_count_mismatch');
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(0);
  });

  it('enqueues a decoded snapshot diff idempotently and reconciles exact stored jobs', async () => {
    const plan = incrementalPlan([
      {
        action: 'insert', address: 'photo:new-photo', beforeRecordSha256: null,
        afterRecordSha256: fixtureHash('b'), priorIncidentEdges: [], priorIncidentEdgesComplete: true,
      },
      {
        action: 'insert', address: 'sighting:new-case', beforeRecordSha256: null,
        afterRecordSha256: fixtureHash('a'), priorIncidentEdges: [], priorIncidentEdgesComplete: true,
      },
    ]);
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) {
        return { rows: incrementalSnapshotRows(plan) };
      }
      if (sql.includes('INSERT INTO public.uap_case_graph_incremental_plans')) return { rows: [] };
      if (sql.includes('FROM public.uap_case_graph_incremental_plans') && sql.includes('WHERE plan_id')) {
        return { rows: [incrementalPlanDbRow(plan)] };
      }
      if (sql.includes('INSERT INTO public.uap_case_graph_incremental_queue')) return { rows: [] };
      if (sql.includes('change_id = ANY($2::text[])')) return { rows: plan.changes.map((change, index) => ({
        plan_id: plan.planId,
        from_snapshot_id: plan.baseGeneration.universe.snapshotId,
        to_snapshot_id: plan.watermark.target.snapshotId,
        batch_id: plan.batches[0].batchId,
        batch_ordinal: '0',
        change_id: change.changeId,
        change_ordinal: String(index),
        address: change.address,
        entity_kind: change.address.split(':')[0],
        entity_id: change.address.split(':')[1],
        action: 'insert',
        input_sha256: incrementalGraphSha256(change),
      })) };
      if (sql.includes('SELECT COUNT(*)::text AS total')) return { rows: [{ total: '2' }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.enqueueSnapshotDiff(plan)).resolves.toMatchObject({
      jobCount: 2,
      planId: plan.planId,
      planSha256: incrementalGraphSha256(plan),
      planArtifactKey: incrementalArtifactKey(plan),
    });
    const insert = client.calls.find((call) => call.sql.includes('INSERT INTO public.uap_case_graph_incremental_queue'));
    expect(insert?.sql).toContain('ON CONFLICT (plan_id, change_id) DO NOTHING');
    expect(insert?.params).toContain(plan.planId);
    expect(insert?.params).toContain(plan.batches[0].batchId);
    expect(insert?.params).toHaveLength(24);
    expect(insert?.params).toContain(incrementalGraphSha256(plan.changes[0]));
    expect(insert?.params).toContain(incrementalGraphSha256(plan.changes[1]));
  });

  it('does not write an incremental plan or queue when either sealed snapshot count mismatches', async () => {
    const plan = incrementalPlan();
    const badRows = incrementalSnapshotRows(plan).map((row) => (
      row.snapshot_id === plan.watermark.target.snapshotId && row.entity_kind === 'sighting'
        ? { ...row, component_row_count: '1' }
        : row
    ));
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('uap_evidence_universe_snapshot_components')) return { rows: badRows };
      throw new Error(`write attempted after snapshot mismatch: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.enqueueSnapshotDiff(plan))
      .rejects.toThrow('case_graph_v2_incremental_snapshot_count_mismatch');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toContain('FOR SHARE OF snapshot, component');
  });

  it('claims only through the v2 lease function and finishes with token and expiry fencing', async () => {
    let finish = false;
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('claim_uap_case_graph_incremental_jobs')) return { rows: [leasedJobRow()] };
      if (sql.includes('UPDATE public.uap_case_graph_incremental_queue')) {
        finish = true;
        return { rows: [{ ...leasedJobRow(), status: 'completed', lease_token: null, leased_until: null }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    const [job] = await control.claimIncrementalJobs({ limit: 1, leaseSeconds: 60 });
    await expect(control.finishIncrementalJob({ job, outcome: { status: 'completed' } }))
      .resolves.toMatchObject({ id: queueId, status: 'completed', leaseToken: null });
    expect(finish).toBe(true);
    const claimSql = client.calls[0].sql;
    expect(claimSql).toContain('claim_uap_case_graph_incremental_jobs');
    const finishSql = client.calls[1].sql;
    expect(finishSql).toContain('lease_token = $2::uuid');
    expect(finishSql).toContain("status = 'leased'");
    expect(finishSql).toContain('leased_until > clock_timestamp()');
  });

  it('rejects a claimed row whose stored error code violates lease-state semantics', async () => {
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('claim_uap_case_graph_incremental_jobs')) {
        return { rows: [{ ...leasedJobRow(), error_code: 'Bad Code' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.claimIncrementalJobs({ limit: 1, leaseSeconds: 60 }))
      .rejects.toThrow('case_graph_v2_incremental_error_code_invalid');
  });

  it('rejects a lost lease fence without attempting an unfenced fallback', async () => {
    const client = new FakeQueryClient(() => ({ rows: [] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    const plan = incrementalPlan();
    const job = {
      id: queueId,
      planId: plan.planId,
      planSha256: incrementalGraphSha256(plan),
      planArtifactKey: incrementalArtifactKey(plan),
      watermarkId: plan.watermark.watermarkId,
      targetCorpusVersion: plan.watermark.target.corpusVersion,
      targetUniverseArchiveSetSha256: plan.watermark.target.universeArchiveSetSha256,
      targetRelationshipInputSetSha256: plan.watermark.targetRelationshipInputSetSha256,
      sourceDiffReceiptSha256: plan.watermark.sourceDiffReceiptSha256,
      fromSnapshotId: plan.baseGeneration.universe.snapshotId,
      toSnapshotId: plan.watermark.target.snapshotId,
      batchId: plan.batches[0].batchId,
      batchOrdinal: 0,
      changeId: plan.changes[0].changeId,
      changeOrdinal: 0,
      address: 'sighting:new-case',
      entityKind: 'sighting',
      entityId: 'new-case',
      action: 'insert',
      inputSha256: fixtureHash('a'),
      status: 'leased',
      attemptCount: 1,
      nextAttemptAt: '2026-07-18T12:00:00.000Z',
      leaseToken,
      leasedUntil: '2026-07-18T12:05:00.000Z',
      errorCode: null,
    } satisfies CaseGraphV2IncrementalJob;
    await expect(control.finishIncrementalJob({ job, outcome: { status: 'completed' } }))
      .rejects.toThrow('case_graph_v2_incremental_lease_fence_lost');
    expect(client.calls).toHaveLength(1);
  });

  it('inserts the publication candidate and immutable receipt in one host transaction', async () => {
    const receipts = validatedReceipts();
    const run = expectedRun(receipts);
    let candidateInsertCount = 0;
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('ledger.total::text AS ledger_total')) return { rows: [{
        ...runRow(receipts),
        ledger_total: String(receipts.relationshipCompletion.universeRecordCount),
        ledger_sighting: String(receipts.relationshipCompletion.addressKindCounts.sighting),
        ledger_document: String(receipts.relationshipCompletion.addressKindCounts.document),
        ledger_photo: String(receipts.relationshipCompletion.addressKindCounts.photo),
        ledger_video: String(receipts.relationshipCompletion.addressKindCounts.video),
        ledger_processed: String(receipts.accounting.relationshipProcessedTotal),
        ledger_not_applicable: String(receipts.accounting.relationshipNotApplicableTotal),
      }] };
      if (sql.includes('INSERT INTO public.uap_case_graph_publications')) {
        candidateInsertCount += 1;
        return { rows: candidateInsertCount === 1 ? [{ publication_id: publicationId }] : [] };
      }
      if (sql.includes('FROM public.uap_case_graph_publications') && sql.includes('ORDER BY id')) return { rows: [{
        publication_id: publicationId,
        run_id: runId,
        corpus_version: run.corpusVersion,
        public_manifest_key: receipts.completion.manifest_key,
        public_manifest_sha256: receipts.publicManifestSha256,
        active: false,
      }] };
      if (sql.includes('INSERT INTO public.uap_case_graph_publication_receipts')) return { rows: [] };
      if (sql.includes('FROM public.uap_case_graph_publication_receipts')) return { rows: [publicationReceiptRow(receipts)] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.insertPublicationCandidate({ run, receipts })).resolves.toEqual({
      publicationId,
      runId,
      corpusVersion: run.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
      registrationStatus: 'created',
    });
    expect(client.transactionCount).toBe(1);
    const candidateInsert = client.calls.find((call) => call.sql.includes('INSERT INTO public.uap_case_graph_publications'))!;
    expect(candidateInsert.sql).toContain('active');
    expect(candidateInsert.sql).toContain('false');
    expect(candidateInsert.sql).not.toMatch(/DO UPDATE/i);
    const publicationLock = client.calls.find((call) => call.sql.includes('pg_advisory_xact_lock'));
    expect(publicationLock).toBeTruthy();
    expect(client.calls.indexOf(publicationLock!)).toBeLessThan(client.calls.indexOf(candidateInsert));
    const receiptInsert = client.calls.find((call) => call.sql.includes('INSERT INTO public.uap_case_graph_publication_receipts'))!;
    expect(receiptInsert.sql).toContain('ON CONFLICT (publication_id) DO NOTHING');
    expect(receiptInsert.params).toHaveLength(47);
    expect(receiptInsert.params[46]).toBe(receipts.manifest.models.relationshipSchemaVersion);
    await expect(control.insertPublicationCandidate({ run, receipts })).resolves.toMatchObject({
      publicationId,
      registrationStatus: 'already_exists',
    });
  });

  it('refuses a publication candidate when ledger dispositions contradict the receipt', async () => {
    const receipts = validatedReceipts();
    const run = expectedRun(receipts);
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('ledger.total::text AS ledger_total')) return { rows: [{
        ...runRow(receipts),
        ledger_total: String(receipts.relationshipCompletion.universeRecordCount),
        ledger_sighting: String(receipts.relationshipCompletion.addressKindCounts.sighting),
        ledger_document: String(receipts.relationshipCompletion.addressKindCounts.document),
        ledger_photo: String(receipts.relationshipCompletion.addressKindCounts.photo),
        ledger_video: String(receipts.relationshipCompletion.addressKindCounts.video),
        ledger_processed: String(receipts.accounting.relationshipProcessedTotal - 1),
        ledger_not_applicable: '1',
      }] };
      throw new Error(`publication write must not be reached: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.insertPublicationCandidate({ run, receipts }))
      .rejects.toThrow('case_graph_v2_publication_run_or_ledger_mismatch');
    expect(client.calls.some(
      (call) => call.sql.includes('INSERT INTO public.uap_case_graph_publications'),
    )).toBe(false);
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(0);
  });

  it('activates only through activate_uap_case_graph_publication_v2 and reconciles the active join', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    let activeReads = 0;
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('WHERE publication.active = true')) {
        activeReads += 1;
        return { rows: activeReads === 1 ? [] : [activeRow(receipts)] };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('activate_uap_case_graph_publication_v2')) {
        return { rows: [activationResultRow(receipts)] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    const result = await control.activatePublication({ candidate, receipts });
    expect(result.status).toBe('activated');
    expect(result.publication).toMatchObject({ publicationId, snapshotId: receipts.manifest.lineage.snapshot.snapshotId });
    const mutatingCalls = client.calls.filter((call) => (
      call.sql.includes('activate_uap_case_graph_publication_v2')
      || /UPDATE\s+public\.uap_case_graph_publications/i.test(call.sql)
    ));
    expect(mutatingCalls).toHaveLength(1);
    expect(mutatingCalls[0].sql).toContain('activate_uap_case_graph_publication_v2');
    expect(mutatingCalls[0].sql).not.toContain('activate_uap_case_graph_publication(');
    expect(mutatingCalls[0].params).toHaveLength(16);
    expect(JSON.parse(mutatingCalls[0].params[15] as string))
      .toEqual(exactRelationshipAccounting(receipts));
    expect(client.calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(1);
  });

  it('owns the mandatory serving gate and aborts before activation when it fails', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('WHERE publication.active = true')) return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('activate_uap_case_graph_publication_v2')) {
        throw new Error('activation must not run after a failed precondition');
      }
      throw new Error(`unexpected query: ${sql}`);
    }, { servingReady: false });
    await expect(createPostgresCaseGraphControlPlaneV2(client).activatePublication({
      candidate,
      receipts,
    })).rejects.toThrow('case_vortex_candidate_serving_projections_unready');
    expect(client.calls.some((call) => call.sql.includes('activate_uap_case_graph_publication_v2'))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(client.committedMutationCount).toBe(0);
  });

  it('reconciles an already-active candidate only after live serving and recovery checks', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('WHERE publication.active = true')) return { rows: [activeRow(receipts)] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('activate_uap_case_graph_publication_v2')) {
        throw new Error('reconciliation must not switch an already-active publication');
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createPostgresCaseGraphControlPlaneV2(client).activatePublication({
      candidate,
      receipts,
    })).resolves.toMatchObject({ status: 'already_active', publication: { publicationId } });
    expect(client.calls.some((call) => call.sql.includes('candidate_serving_projections:active_reconciliation')))
      .toBe(true);
    expect(client.calls.some((call) => call.sql.includes('prospective_activation_rehearsal')))
      .toBe(false);
    expect(client.calls.some((call) => call.sql.includes('activate_uap_case_graph_publication_v2')))
      .toBe(false);
  });

  it('resolves an activation candidate only through its immutable V2 receipt join', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(({ sql, params }) => {
      if (sql.includes('FROM public.uap_case_graph_publications AS publication')
        && sql.includes("receipt.receipt_version = 'case-vortex-publication-receipt-v2'")) {
        expect(params).toEqual([publicationId]);
        return { rows: [{
          publication_id: publicationId,
          run_id: runId,
          corpus_version: receipts.manifest.corpusVersion,
          public_manifest_key: receipts.completion.manifest_key,
          public_manifest_sha256: receipts.publicManifestSha256,
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createPostgresCaseGraphControlPlaneV2(client).readPublicationCandidate({
      publicationId,
      receipts,
    })).resolves.toEqual({
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    });
    expect(client.transactionCount).toBe(0);
  });

  it('deactivates only the exact sole active publication through the first-generation guard', async () => {
    const receipts = validatedReceipts();
    const reasonSha256 = sha('first-publication-emergency-reason');
    let activeReads = 0;
    const client = new FakeQueryClient(({ sql, params }) => {
      if (sql.includes('WHERE publication.active = true')) {
        activeReads += 1;
        return { rows: activeReads === 1 ? [activeRow(receipts)] : [] };
      }
      if (sql.includes('deactivate_first_uap_case_graph_publication_v1')) {
        expect(params).toEqual([publicationId, receipts.publicManifestSha256, reasonSha256]);
        return { rows: [{
          publication_id: publicationId,
          corpus_version: receipts.manifest.corpusVersion,
          public_manifest_sha256: receipts.publicManifestSha256,
          reason_sha256: reasonSha256,
          deactivated_at: '2026-08-10T12:01:00.000Z',
          active_publication_count: '0',
          total_publication_count: '1',
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createPostgresCaseGraphControlPlaneV2(client).deactivateFirstPublication({
      expectedActivePublicationId: publicationId,
      expectedActiveManifestSha256: receipts.publicManifestSha256,
      reasonSha256,
    })).resolves.toMatchObject({
      status: 'deactivated',
      publication: { publicationId },
      reasonSha256,
    });
    const mutation = client.calls.find(({ sql }) => sql.includes('deactivate_first_uap_case_graph_publication_v1'));
    expect(mutation?.sql).toContain('deactivate_first_uap_case_graph_publication_v1');
    expect(client.calls.some(({ sql }) => /UPDATE\s+public\.uap_case_graph_publications/i.test(sql))).toBe(false);
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(1);
  });

  it('rolls back activation when the mutating function returns a malformed acknowledgement', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    let activeReads = 0;
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('WHERE publication.active = true')) {
        activeReads += 1;
        return { rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('activate_uap_case_graph_publication_v2')) {
        return { rows: [{
          ...activationResultRow(receipts),
          completion_manifest_sha256: fixtureHash('0'),
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.activatePublication({ candidate, receipts }))
      .rejects.toThrow('case_graph_v2_publication_activation_result_invalid');
    expect(activeReads).toBe(1);
    expect(client.calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(0);
  });

  it('rolls back a valid activation acknowledgement when the in-transaction active row is invalid', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    let activeReads = 0;
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('WHERE publication.active = true')) {
        activeReads += 1;
        if (activeReads === 1) return { rows: [] };
        return { rows: [{
          ...activeRow(receipts),
          ledger_processed: String(receipts.accounting.relationshipProcessedTotal - 1),
          ledger_not_applicable: '1',
        }] };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('activate_uap_case_graph_publication_v2')) {
        return { rows: [activationResultRow(receipts)] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.activatePublication({ candidate, receipts }))
      .rejects.toThrow('case_graph_v2_active_publication_inconsistent');
    expect(activeReads).toBe(2);
    expect(client.calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(0);
  });

  it('rejects a noncanonical candidate manifest key before reading or mutating the database', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: `${receipts.completion.manifest_key}.forged`,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const client = new FakeQueryClient(() => ({ rows: [] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.activatePublication({ candidate, receipts }))
      .rejects.toThrow('case_graph_v2_publication_activation_candidate_mismatch');
    expect(client.calls).toHaveLength(0);
  });

  it('reconciles an ambiguous activation acknowledgement from the active publication', async () => {
    const receipts = validatedReceipts();
    const candidate: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    let activeReads = 0;
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('WHERE publication.active = true')) {
        activeReads += 1;
        return { rows: activeReads === 1 ? [] : [activeRow(receipts)] };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ locked: '' }] };
      if (sql.includes('activate_uap_case_graph_publication_v2')) {
        throw new Error('connection_lost_after_commit');
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.activatePublication({ candidate, receipts })).resolves.toMatchObject({
      status: 'reconciled',
      publication: { publicationId },
    });
    expect(client.calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('rolls back only through the exact compare-and-swap function and verifies lineage', async () => {
    const receipts = validatedReceipts();
    const expectedActivePublicationId = '50000000-0000-4000-8000-000000000005';
    const targetPublicationId = '60000000-0000-4000-8000-000000000006';
    const targetRunId = '70000000-0000-4000-8000-000000000007';
    const expectedActiveManifestSha256 = sha('active-generation');
    const reasonSha256 = sha('rollback-reason');
    const target: CaseGraphV2PublicationCandidate = {
      publicationId: targetPublicationId,
      runId: targetRunId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const targetActive = {
      ...activeRow(receipts),
      publication_id: targetPublicationId,
      run_id: targetRunId,
      rollback_of_publication_id: expectedActivePublicationId,
    };
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('rollback_uap_case_graph_publication_v1')) {
        return { rows: [{
          previous_publication_id: expectedActivePublicationId,
          target_publication_id: targetPublicationId,
          previous_manifest_sha256: expectedActiveManifestSha256,
          target_manifest_sha256: receipts.publicManifestSha256,
          rolled_back_at: targetActive.activated_at,
          reason_sha256: reasonSha256,
          active_publication_count: '1',
          rollback_of_publication_id: expectedActivePublicationId,
        }] };
      }
      if (sql.includes('WHERE publication.active = true')) return { rows: [targetActive] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const result = await createPostgresCaseGraphControlPlaneV2(client).rollbackPublication({
      expectedActivePublicationId,
      expectedActiveManifestSha256,
      target,
      targetReceipts: receipts,
      reasonSha256,
    });

    expect(result).toMatchObject({
      status: 'rolled_back',
      previousPublicationId: expectedActivePublicationId,
      reasonSha256,
      publication: {
        publicationId: targetPublicationId,
        rollbackOfPublicationId: expectedActivePublicationId,
      },
    });
    const mutation = client.calls.find(({ sql }) => (
      sql.includes('rollback_uap_case_graph_publication_v1')
    ));
    expect(mutation?.params).toEqual([
      expectedActivePublicationId,
      targetPublicationId,
      expectedActiveManifestSha256,
      receipts.publicManifestSha256,
      reasonSha256,
    ]);
    expect(client.calls.some(({ sql }) => (
      /UPDATE\s+public\.uap_case_graph_publications/iu.test(sql)
    ))).toBe(false);
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(1);
  });

  it('rolls back the transaction when the rollback acknowledgement is malformed', async () => {
    const receipts = validatedReceipts();
    const expectedActivePublicationId = '50000000-0000-4000-8000-000000000005';
    const targetPublicationId = '60000000-0000-4000-8000-000000000006';
    const target: CaseGraphV2PublicationCandidate = {
      publicationId: targetPublicationId,
      runId: '70000000-0000-4000-8000-000000000007',
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('rollback_uap_case_graph_publication_v1')) {
        return { rows: [{
          previous_publication_id: expectedActivePublicationId,
          target_publication_id: targetPublicationId,
          previous_manifest_sha256: sha('active-generation'),
          target_manifest_sha256: receipts.publicManifestSha256,
          rolled_back_at: '2026-07-18T13:00:00.000Z',
          reason_sha256: sha('wrong-reason'),
          active_publication_count: '1',
          rollback_of_publication_id: expectedActivePublicationId,
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    await expect(createPostgresCaseGraphControlPlaneV2(client).rollbackPublication({
      expectedActivePublicationId,
      expectedActiveManifestSha256: sha('active-generation'),
      target,
      targetReceipts: receipts,
      reasonSha256: sha('rollback-reason'),
    })).rejects.toThrow('case_graph_v2_publication_rollback_result_invalid');
    expect(client.transactionCount).toBe(1);
    expect(client.committedMutationCount).toBe(0);
  });

  it('reconciles an ambiguous rollback only when the target and rollback lineage are active', async () => {
    const receipts = validatedReceipts();
    const expectedActivePublicationId = '50000000-0000-4000-8000-000000000005';
    const targetPublicationId = '60000000-0000-4000-8000-000000000006';
    const targetRunId = '70000000-0000-4000-8000-000000000007';
    const target: CaseGraphV2PublicationCandidate = {
      publicationId: targetPublicationId,
      runId: targetRunId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const client = new FakeQueryClient(({ sql }) => {
      if (sql.includes('rollback_uap_case_graph_publication_v1')) {
        throw new Error('connection_lost_after_commit');
      }
      if (sql.includes('WHERE publication.active = true')) {
        return { rows: [{
          ...activeRow(receipts),
          publication_id: targetPublicationId,
          run_id: targetRunId,
          rollback_of_publication_id: expectedActivePublicationId,
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createPostgresCaseGraphControlPlaneV2(client).rollbackPublication({
      expectedActivePublicationId,
      expectedActiveManifestSha256: sha('active-generation'),
      target,
      targetReceipts: receipts,
      reasonSha256: sha('rollback-reason'),
    })).resolves.toMatchObject({
      status: 'reconciled',
      previousPublicationId: expectedActivePublicationId,
      publication: {
        publicationId: targetPublicationId,
        rollbackOfPublicationId: expectedActivePublicationId,
      },
    });
  });

  it('rejects a same-generation rollback target before database access', async () => {
    const receipts = validatedReceipts();
    const target: CaseGraphV2PublicationCandidate = {
      publicationId,
      runId,
      corpusVersion: receipts.manifest.corpusVersion,
      publicManifestKey: receipts.completion.manifest_key,
      publicManifestSha256: receipts.publicManifestSha256,
    };
    const client = new FakeQueryClient(() => ({ rows: [] }));
    await expect(createPostgresCaseGraphControlPlaneV2(client).rollbackPublication({
      expectedActivePublicationId: publicationId,
      expectedActiveManifestSha256: sha('active-generation'),
      target,
      targetReceipts: receipts,
      reasonSha256: sha('rollback-reason'),
    })).rejects.toThrow('case_graph_v2_publication_rollback_target_mismatch');
    expect(client.calls).toHaveLength(0);
  });

  it('fails closed when the active publication ledger no longer matches its receipt', async () => {
    const receipts = validatedReceipts();
    const bad = { ...activeRow(receipts), ledger_total: '1' };
    const client = new FakeQueryClient(() => ({ rows: [bad] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.readActivePublication(receipts)).rejects.toThrow('case_graph_v2_active_publication_inconsistent');
  });

  it('fails closed when an active ledger contains a not-applicable relationship disposition', async () => {
    const receipts = validatedReceipts();
    const bad = {
      ...activeRow(receipts),
      ledger_processed: String(receipts.accounting.relationshipProcessedTotal - 1),
      ledger_not_applicable: '1',
    };
    const client = new FakeQueryClient(() => ({ rows: [bad] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.readActivePublication(receipts))
      .rejects.toThrow('case_graph_v2_active_publication_inconsistent');
  });

  it('fails closed when an active publication has no immutable receipt join', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(() => ({ rows: [{ ...activeRow(receipts), receipt_present: false }] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.readActivePublication(receipts))
      .rejects.toThrow('case_graph_v2_active_publication_inconsistent');
  });

  it('fails closed when active run and receipt typed schemas drift', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(() => ({ rows: [{
      ...activeRow(receipts),
      run_relationship_schema_version: 'case-graph-typed-relationship-v1',
    }] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.readActivePublication(receipts))
      .rejects.toThrow('case_graph_v2_active_publication_inconsistent');
  });

  it('returns an internally reconciled active publication without requiring expected receipts', async () => {
    const receipts = validatedReceipts();
    const client = new FakeQueryClient(() => ({ rows: [activeRow(receipts)] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    const active = await control.readActivePublication();
    expect(active).toEqual(expect.objectContaining<Partial<CaseGraphV2ActivePublication>>({
      publicationId,
      accountingReceiptSha256: receipts.accountingReceiptSha256,
      universeRecordCount: receipts.relationshipCompletion.universeRecordCount,
    }));
  });

  it('accepts the shared publication-v2 activation row including all typed-schema aliases', async () => {
    const fixture = buildStructurallyBoundPublicationV2Fixture();
    const receipts = validatedReceipts();
    const row = {
      ...buildPublicationV2ActivationRow(fixture),
      publication_id: publicationId,
    };
    const client = new FakeQueryClient(() => ({ rows: [row] }));
    const control = createPostgresCaseGraphControlPlaneV2(client);
    await expect(control.readActivePublication(receipts)).resolves.toMatchObject({
      publicationId,
      runId,
      completionManifestSha256: receipts.publicationCompletionSha256,
    });
  });
});
