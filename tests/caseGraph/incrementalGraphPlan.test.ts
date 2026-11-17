import { describe, expect, it } from 'vitest';

import {
  buildIncrementalGraphActivationIntent,
  buildIncrementalGraphActivationReceipt,
  buildIncrementalGraphBatchReceipt,
  buildIncrementalGraphPlan,
  canonicalizeIncrementalGraph,
  classifyIncrementalGraphActivationReceipt,
  classifyIncrementalGraphWatermark,
  createIncrementalGraphCheckpoint,
  decodeIncrementalGraphActivationReceipt,
  decodeIncrementalGraphBatchReceipt,
  decodeIncrementalGraphCheckpoint,
  decodeIncrementalGraphPlan,
  incrementalGraphSha256,
  INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
  advanceIncrementalGraphCheckpoint,
  type IncrementalGraphActivationIntent,
  type IncrementalGraphActivationTransaction,
  type IncrementalGraphBatchTransaction,
  type IncrementalGraphChangeDraft,
  type IncrementalGraphGenerationBinding,
  type IncrementalGraphOutputGeneration,
  type IncrementalGraphPlan,
  type IncrementalGraphUniverseBinding,
  type IncrementalGraphWatermark,
} from '../../src/caseGraph/incrementalGraphPlan';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';

const sha = (character: string) => character.repeat(64);

const universe = (
  snapshotId: string,
  recordCount: number,
  marker: string,
): IncrementalGraphUniverseBinding => ({
  snapshotId,
  corpusVersion: 'corpus-2026-07-18',
  universeArchiveVersion: INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: sha(marker),
  addressSetSha256: sha(marker.toUpperCase().toLowerCase() === marker ? marker : marker),
  recordCount,
});

const baseUniverse = () => universe('00000000-0000-4000-8000-000000000001', 4, 'a');
const targetUniverse = () => universe('00000000-0000-4000-8000-000000000002', 4, 'b');

const generation = (
  binding = baseUniverse(),
  incidentIndexRootSha256 = sha('6'),
): IncrementalGraphGenerationBinding => ({
  activationId: 'activation:base-0001',
  universe: binding,
  relationshipInputSetSha256: sha('c'),
  graphArchiveSetSha256: sha('d'),
  incidentIndexRootSha256,
});

const sharedEdge = () => ({
  edgeId: 'edge:shared',
  edgeSha256: sha('e'),
  leftAddress: 'sighting:alpha',
  rightAddress: 'video:retired',
});

const changes = (): IncrementalGraphChangeDraft[] => [
  {
    action: 'update',
    address: 'sighting:alpha',
    beforeRecordSha256: sha('1'),
    afterRecordSha256: sha('2'),
    priorIncidentEdges: [
      sharedEdge(),
      {
        edgeId: 'edge:document-link',
        edgeSha256: sha('f'),
        leftAddress: 'document:report',
        rightAddress: 'sighting:alpha',
      },
    ],
    priorIncidentEdgesComplete: true,
  },
  {
    action: 'insert',
    address: 'photo:new-photo',
    beforeRecordSha256: null,
    afterRecordSha256: sha('3'),
    priorIncidentEdges: [],
    priorIncidentEdgesComplete: true,
  },
  {
    action: 'delete',
    address: 'video:retired',
    beforeRecordSha256: sha('4'),
    afterRecordSha256: null,
    priorIncidentEdges: [sharedEdge()],
    priorIncidentEdgesComplete: true,
  },
];

const plan = (overrides: Partial<Parameters<typeof buildIncrementalGraphPlan>[0]> = {}) => buildIncrementalGraphPlan({
  baseGeneration: generation(),
  targetUniverse: targetUniverse(),
  targetRelationshipInputSetSha256: sha('5'),
  incidentIndexRootSha256: sha('6'),
  sourceDiffReceiptSha256: sha('7'),
  sourceSequence: 1,
  sourceCursor: 'snapshot-diff/0001',
  changes: changes(),
  thresholds: {
    batchSize: 1,
    maximumChangedRecords: 100,
    maximumChangedFraction: 1,
    maximumInvalidatedEdges: 100,
  },
  ...overrides,
});

const batchTransaction = (batchId: string, ordinal: number): IncrementalGraphBatchTransaction => ({
  isolationLevel: 'serializable',
  idempotencyKey: batchId,
  transactionId: `tx:batch-${ordinal}`,
  commitToken: `lsn/${ordinal}`,
  committedAt: `2026-07-18T12:0${ordinal}:00.000Z`,
  commitProofSha256: sha(String(ordinal + 1)),
  committed: true,
});

const batchReceipt = (inputPlan: IncrementalGraphPlan, ordinal: number, transactionId?: string) => {
  const batch = inputPlan.batches[ordinal];
  const transaction = batchTransaction(batch.batchId, ordinal);
  if (transactionId) transaction.transactionId = transactionId;
  return buildIncrementalGraphBatchReceipt({
    plan: inputPlan,
    batchOrdinal: ordinal,
    appliedChangeSetSha256: batch.changeSetSha256,
    deletedEdgeSetSha256: batch.invalidatedEdgeSetSha256,
    recomputedAddressSetSha256: batch.recomputeAddressSetSha256,
    committedTombstoneSetSha256: batch.tombstoneSetSha256,
    writtenNodeCount: batch.recomputeAddresses.length,
    writtenEdgeCount: ordinal + 2,
    nodeDeltaSetSha256: sha('8'),
    edgeDeltaSetSha256: sha('9'),
    transaction,
  });
};

const applyAllBatches = (inputPlan: IncrementalGraphPlan) => inputPlan.batches.reduce(
  (checkpoint, _batch, ordinal) => advanceIncrementalGraphCheckpoint({
    plan: inputPlan,
    checkpoint,
    receipt: batchReceipt(inputPlan, ordinal),
  }),
  createIncrementalGraphCheckpoint(inputPlan),
);

const output = (inputPlan: IncrementalGraphPlan): IncrementalGraphOutputGeneration => ({
  universe: inputPlan.watermark.target,
  relationshipInputSetSha256: inputPlan.watermark.targetRelationshipInputSetSha256,
  graphArchiveSetSha256: sha('a'),
  graphManifestSha256: sha('b'),
  incidentIndexRootSha256: sha('d'),
  nodeAddressSetSha256: inputPlan.watermark.target.addressSetSha256,
  nodeCount: inputPlan.watermark.target.recordCount,
  connectedNodeCount: 3,
  isolatedNodeCount: 1,
  edgeCount: 7,
});

const activationTransaction = (intent: IncrementalGraphActivationIntent): IncrementalGraphActivationTransaction => ({
  isolationLevel: 'serializable',
  compareAndSwap: 'active_activation_and_graph_archive',
  idempotencyKey: intent.activationId,
  expectedPreviousActivationId: intent.expectedPreviousActivationId,
  observedPreviousActivationId: intent.expectedPreviousActivationId,
  expectedPreviousGraphArchiveSetSha256: intent.expectedPreviousGraphArchiveSetSha256,
  observedPreviousGraphArchiveSetSha256: intent.expectedPreviousGraphArchiveSetSha256,
  committedActivationId: intent.activationId,
  transactionId: 'tx:activation-0002',
  commitToken: 'lsn/activation-0002',
  committedAt: '2026-07-18T13:00:00.000Z',
  commitProofSha256: sha('c'),
  committed: true,
});

const clone = <T>(value: T): T => structuredClone(value);

const reidentifyWatermark = (watermark: IncrementalGraphWatermark): IncrementalGraphWatermark => {
  const identity = { ...watermark } as Record<string, unknown>;
  delete identity.watermarkId;
  return { ...watermark, watermarkId: `watermark:${incrementalGraphSha256(identity)}` };
};

describe('incremental Case Vortex graph contract', () => {
  it('derives one deterministic plan, change order, batch order, and identity independent of input ordering', () => {
    const first = plan();
    const reorderedChanges = changes().reverse();
    const update = reorderedChanges.find((change) => change.action === 'update');
    update?.priorIncidentEdges.reverse();
    const second = plan({ changes: reorderedChanges });

    expect(second).toEqual(first);
    expect(first.changes.map((change) => change.address)).toEqual([
      'photo:new-photo',
      'sighting:alpha',
      'video:retired',
    ]);
    expect(first.planId).toMatch(/^plan:[a-f0-9]{64}$/);
    expect(first.batches.map((batch) => batch.ordinal)).toEqual([0, 1, 2]);
    expect(decodeIncrementalGraphPlan(JSON.stringify(first))).toEqual(first);
  });

  it('accounts the complete snapshot diff and emits an immutable delete tombstone bound to the target UUID and archive hash', () => {
    const built = plan();
    const deletion = built.changes.find((change) => change.action === 'delete');

    expect(built.accounting).toMatchObject({
      baseRecordCount: 4,
      targetRecordCount: 4,
      unchangedRecordCount: 2,
      changeCount: 3,
      insertCount: 1,
      updateCount: 1,
      deleteCount: 1,
      invalidatedNodeCount: 3,
      invalidatedEdgeCount: 2,
      tombstoneCount: 1,
    });
    expect(deletion?.tombstone).toMatchObject({
      address: 'video:retired',
      deletedRecordSha256: sha('4'),
      targetSnapshotId: targetUniverse().snapshotId,
      targetUniverseArchiveSetSha256: targetUniverse().universeArchiveSetSha256,
      reason: 'absent_from_target_snapshot',
    });
    expect(deletion?.tombstone?.tombstoneId).toMatch(/^tombstone:[a-f0-9]{64}$/);
    expect(built.changes.every((change) => change.priorIncidentEdgesComplete)).toBe(true);
    expect(built.changes.every((change) => /^[a-f0-9]{64}$/.test(change.incidentLookupReceiptSha256))).toBe(true);
  });

  it('deduplicates shared incident edges globally and assigns every invalidation to exactly one deterministic batch', () => {
    const built = plan();
    expect(built.invalidations.edgeIds).toEqual(['edge:document-link', 'edge:shared']);
    expect(built.batches.flatMap((batch) => batch.invalidatedEdgeIds)).toEqual(built.invalidations.edgeIds);
    expect(built.batches.reduce((sum, batch) => sum + batch.invalidatedEdgeIds.length, 0)).toBe(2);
    expect(built.invalidations.recomputeAddresses).toEqual([
      'document:report',
      'photo:new-photo',
      'sighting:alpha',
    ]);
  });

  it('fails closed for invalid insert/update/delete transitions, incomplete target accounting, and non-incident edges', () => {
    const invalidInsert = changes();
    invalidInsert[1].beforeRecordSha256 = sha('0');
    expect(() => plan({ changes: invalidInsert })).toThrow('incremental_graph_change_transition_invalid');

    const invalidUpdate = changes();
    invalidUpdate[0].afterRecordSha256 = invalidUpdate[0].beforeRecordSha256;
    expect(() => plan({ changes: invalidUpdate })).toThrow('incremental_graph_change_transition_invalid');

    expect(() => plan({ targetUniverse: universe(targetUniverse().snapshotId, 5, 'b') }))
      .toThrow('incremental_graph_target_count_mismatch');

    const incompleteLookup = changes();
    (incompleteLookup[0] as { priorIncidentEdgesComplete?: true }).priorIncidentEdgesComplete = undefined;
    expect(() => plan({ changes: incompleteLookup })).toThrow('incremental_graph_incident_lookup_incomplete');

    expect(() => plan({ incidentIndexRootSha256: sha('0') }))
      .toThrow('incremental_graph_incident_index_generation_mismatch');

    const foreignEdge = changes();
    foreignEdge[0].priorIncidentEdges[0] = {
      edgeId: 'edge:foreign',
      edgeSha256: sha('e'),
      leftAddress: 'document:left',
      rightAddress: 'photo:right',
    };
    expect(() => plan({ changes: foreignEdge })).toThrow('incremental_graph_incident_edge_endpoint_invalid');
  });

  it('rejects divergent definitions of the same prior edge instead of mixing graph generations', () => {
    const conflicting = changes();
    const deletion = conflicting.find((change) => change.action === 'delete');
    if (deletion) deletion.priorIncidentEdges[0].edgeSha256 = sha('0');
    expect(() => plan({ changes: conflicting })).toThrow('incremental_graph_incident_edge_conflict');
  });

  it('classifies exact watermark retries as idempotent and rejects a same-sequence cursor or payload conflict', () => {
    const first = plan();
    expect(classifyIncrementalGraphWatermark(first.watermark, clone(first.watermark))).toBe('replay');

    const divergentCursor = plan({ sourceCursor: 'snapshot-diff/divergent' });
    expect(() => classifyIncrementalGraphWatermark(first.watermark, divergentCursor.watermark))
      .toThrow('incremental_graph_same_watermark_conflict');

    const divergentPayload = plan({ sourceDiffReceiptSha256: sha('0') });
    expect(() => classifyIncrementalGraphWatermark(first.watermark, divergentPayload.watermark))
      .toThrow('incremental_graph_same_watermark_conflict');
  });

  it('accepts only an exact next watermark and rejects out-of-order, skipped, or divergent chains', () => {
    const first = plan();
    const nextTarget = universe('00000000-0000-4000-8000-000000000003', 4, 'c');
    const second = buildIncrementalGraphPlan({
      baseGeneration: {
        activationId: 'activation:second-base',
        universe: first.watermark.target,
        relationshipInputSetSha256: first.watermark.targetRelationshipInputSetSha256,
        graphArchiveSetSha256: sha('a'),
        incidentIndexRootSha256: sha('e'),
      },
      targetUniverse: nextTarget,
      targetRelationshipInputSetSha256: sha('d'),
      incidentIndexRootSha256: sha('e'),
      sourceDiffReceiptSha256: sha('f'),
      sourceSequence: 2,
      sourceCursor: 'snapshot-diff/0002',
      previousWatermark: first.watermark,
      changes: [],
    });
    expect(classifyIncrementalGraphWatermark(first.watermark, second.watermark)).toBe('advance');
    expect(() => classifyIncrementalGraphWatermark(second.watermark, first.watermark))
      .toThrow('incremental_graph_watermark_out_of_order');

    const skipped = reidentifyWatermark({ ...second.watermark, sequence: 3 });
    expect(() => classifyIncrementalGraphWatermark(first.watermark, skipped))
      .toThrow('incremental_graph_watermark_gap');

    const wrongChain = reidentifyWatermark({ ...second.watermark, previousWatermarkId: 'watermark:wrong' });
    expect(() => classifyIncrementalGraphWatermark(first.watermark, wrongChain))
      .toThrow('incremental_graph_watermark_chain_mismatch');

    expect(() => buildIncrementalGraphPlan({
      ...({
        baseGeneration: generation(first.watermark.target, sha('e')),
        targetUniverse: nextTarget,
        targetRelationshipInputSetSha256: sha('d'),
        incidentIndexRootSha256: sha('e'),
        sourceDiffReceiptSha256: sha('f'),
        sourceCursor: 'snapshot-diff/0003',
        previousWatermark: first.watermark,
        changes: [],
      }),
      sourceSequence: 3,
    })).toThrow('incremental_graph_watermark_gap');

    expect(() => buildIncrementalGraphPlan({
      baseGeneration: {
        ...generation(first.watermark.target, sha('e')),
        relationshipInputSetSha256: sha('0'),
      },
      targetUniverse: nextTarget,
      targetRelationshipInputSetSha256: sha('d'),
      incidentIndexRootSha256: sha('e'),
      sourceDiffReceiptSha256: sha('f'),
      sourceSequence: 2,
      sourceCursor: 'snapshot-diff/0002',
      previousWatermark: first.watermark,
      changes: [],
    })).toThrow('incremental_graph_relationship_input_chain_mismatch');
  });

  it('falls back to a full rebuild when bounded change, fraction, or edge invalidation thresholds are exceeded', () => {
    const byFraction = plan({
      thresholds: {
        batchSize: 10,
        maximumChangedRecords: 100,
        maximumChangedFraction: 0.5,
        maximumInvalidatedEdges: 100,
      },
    });
    expect(byFraction.mode).toBe('full_rebuild');
    expect(byFraction.fallbackReasons).toContain('changed_record_fraction');
    expect(() => createIncrementalGraphCheckpoint(byFraction)).toThrow('incremental_graph_full_rebuild_required');

    const byCountAndEdges = plan({
      thresholds: {
        batchSize: 10,
        maximumChangedRecords: 2,
        maximumChangedFraction: 1,
        maximumInvalidatedEdges: 1,
      },
    });
    expect(byCountAndEdges.fallbackReasons).toEqual(['changed_record_limit', 'invalidated_edge_limit']);
  });

  it('applies batches in order, persists machine-readable receipts, and resumes safely after every committed batch', () => {
    const built = plan();
    const initial = createIncrementalGraphCheckpoint(built);
    const firstBatch = built.batches[0];
    expect(() => buildIncrementalGraphBatchReceipt({
      plan: built,
      batchOrdinal: 0,
      appliedChangeSetSha256: firstBatch.changeSetSha256,
      deletedEdgeSetSha256: sha('0'),
      recomputedAddressSetSha256: firstBatch.recomputeAddressSetSha256,
      committedTombstoneSetSha256: firstBatch.tombstoneSetSha256,
      writtenNodeCount: 1,
      writtenEdgeCount: 1,
      nodeDeltaSetSha256: sha('8'),
      edgeDeltaSetSha256: sha('9'),
      transaction: batchTransaction(firstBatch.batchId, 0),
    })).toThrow('incremental_graph_deleted_edge_set_mismatch');
    expect(() => advanceIncrementalGraphCheckpoint({
      plan: built,
      checkpoint: initial,
      receipt: batchReceipt(built, 1),
    })).toThrow('incremental_graph_batch_out_of_order');

    const afterFirst = advanceIncrementalGraphCheckpoint({
      plan: built,
      checkpoint: initial,
      receipt: batchReceipt(built, 0),
    });
    expect(afterFirst).toMatchObject({
      status: 'processing',
      nextBatchOrdinal: 1,
      nextChangeOffset: 1,
      appliedChangeCount: 1,
    });
    expect(decodeIncrementalGraphCheckpoint(JSON.stringify(afterFirst), built)).toEqual(afterFirst);

    const complete = applyAllBatches(built);
    expect(complete).toMatchObject({
      status: 'ready_to_activate',
      nextBatchOrdinal: 3,
      nextChangeOffset: 3,
      appliedChangeCount: 3,
      appliedInsertCount: 1,
      appliedUpdateCount: 1,
      appliedDeleteCount: 1,
    });
    expect(complete.batchReceipts).toHaveLength(3);
    expect(complete.checkpointDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('makes a lost-ack batch retry idempotent but rejects a divergent receipt for an already committed batch', () => {
    const built = plan();
    const initial = createIncrementalGraphCheckpoint(built);
    const receipt = batchReceipt(built, 0);
    const committed = advanceIncrementalGraphCheckpoint({ plan: built, checkpoint: initial, receipt });

    expect(advanceIncrementalGraphCheckpoint({ plan: built, checkpoint: committed, receipt })).toEqual(committed);

    const divergent = batchReceipt(built, 0, 'tx:divergent-retry');
    expect(() => advanceIncrementalGraphCheckpoint({ plan: built, checkpoint: committed, receipt: divergent }))
      .toThrow('incremental_graph_batch_replay_conflict');
  });

  it('detects tampered plans, batch receipts, and resume checkpoints even when they remain valid JSON', () => {
    const built = plan();
    const planTamper = clone(built);
    planTamper.accounting.invalidatedEdgeCount += 1;
    expect(() => decodeIncrementalGraphPlan(planTamper)).toThrow('incremental_graph_plan_receipt_mismatch');

    const receipt = batchReceipt(built, 0);
    const receiptTamper = clone(receipt);
    receiptTamper.invalidatedEdgeCount += 1;
    expect(() => decodeIncrementalGraphBatchReceipt(receiptTamper, built))
      .toThrow('incremental_graph_batch_receipt_mismatch');

    const checkpoint = advanceIncrementalGraphCheckpoint({
      plan: built,
      checkpoint: createIncrementalGraphCheckpoint(built),
      receipt,
    });
    const checkpointTamper = clone(checkpoint);
    checkpointTamper.nextChangeOffset += 1;
    expect(() => decodeIncrementalGraphCheckpoint(checkpointTamper, built))
      .toThrow('incremental_graph_checkpoint_receipt_mismatch');
  });

  it('requires complete batch accounting before building an activation intent', () => {
    const built = plan();
    expect(() => buildIncrementalGraphActivationIntent({
      plan: built,
      checkpoint: createIncrementalGraphCheckpoint(built),
      output: output(built),
    })).toThrow('incremental_graph_checkpoint_incomplete');
  });

  it('binds activation to the exact target snapshot, relationship inputs, address set, and node accounting', () => {
    const built = plan();
    const checkpoint = applyAllBatches(built);

    const wrongSnapshot = output(built);
    wrongSnapshot.universe = universe('00000000-0000-4000-8000-000000000099', 4, 'b');
    expect(() => buildIncrementalGraphActivationIntent({ plan: built, checkpoint, output: wrongSnapshot }))
      .toThrow('incremental_graph_output_snapshot_mismatch');

    const wrongInputs = output(built);
    wrongInputs.relationshipInputSetSha256 = sha('0');
    expect(() => buildIncrementalGraphActivationIntent({ plan: built, checkpoint, output: wrongInputs }))
      .toThrow('incremental_graph_output_relationship_input_mismatch');

    const wrongAddressSet = output(built);
    wrongAddressSet.nodeAddressSetSha256 = sha('0');
    expect(() => buildIncrementalGraphActivationIntent({ plan: built, checkpoint, output: wrongAddressSet }))
      .toThrow('incremental_graph_output_address_set_mismatch');

    const wrongCounts = output(built);
    wrongCounts.isolatedNodeCount = 2;
    expect(() => buildIncrementalGraphActivationIntent({ plan: built, checkpoint, output: wrongCounts }))
      .toThrow('incremental_graph_output_accounting_invalid');
  });

  it('emits a serializable compare-and-swap activation receipt and reconciles only an exact replay', () => {
    const built = plan();
    const checkpoint = applyAllBatches(built);
    const intent = buildIncrementalGraphActivationIntent({ plan: built, checkpoint, output: output(built) });
    const transaction = activationTransaction(intent);
    const receipt = buildIncrementalGraphActivationReceipt({ intent, transaction });

    expect(receipt.intent.activationId).toMatch(/^activation:[a-f0-9]{64}$/);
    expect(receipt.receiptId).toMatch(/^activation-receipt:[a-f0-9]{64}$/);
    expect(receipt.transaction).toMatchObject({
      isolationLevel: 'serializable',
      compareAndSwap: 'active_activation_and_graph_archive',
      observedPreviousActivationId: generation().activationId,
      committedActivationId: intent.activationId,
      committed: true,
    });
    expect(decodeIncrementalGraphActivationReceipt(JSON.stringify(receipt), { plan: built, checkpoint })).toEqual(receipt);
    expect(classifyIncrementalGraphActivationReceipt(receipt, clone(receipt))).toBe('replay');

    const staleTransaction = activationTransaction(intent);
    staleTransaction.observedPreviousActivationId = 'activation:someone-else';
    expect(() => buildIncrementalGraphActivationReceipt({ intent, transaction: staleTransaction }))
      .toThrow('incremental_graph_activation_compare_and_swap_invalid');

    const divergentReceipt = buildIncrementalGraphActivationReceipt({
      intent,
      transaction: { ...transaction, transactionId: 'tx:activation-divergent' },
    });
    expect(() => classifyIncrementalGraphActivationReceipt(receipt, divergentReceipt))
      .toThrow('incremental_graph_activation_replay_conflict');

    const wrongIntent = clone(intent);
    wrongIntent.output.relationshipInputSetSha256 = sha('0');
    const identity = { ...wrongIntent } as Record<string, unknown>;
    delete identity.activationId;
    wrongIntent.activationId = `activation:${incrementalGraphSha256(identity)}`;
    const structurallyValidButUnbound = buildIncrementalGraphActivationReceipt({
      intent: wrongIntent,
      transaction: activationTransaction(wrongIntent),
    });
    expect(() => decodeIncrementalGraphActivationReceipt(structurallyValidButUnbound, { plan: built, checkpoint }))
      .toThrow('incremental_graph_output_relationship_input_mismatch');
  });

  it('supports a deterministic zero-change snapshot advance without pretending the UUIDs are interchangeable', () => {
    const zeroTarget = universe('00000000-0000-4000-8000-000000000003', 4, 'f');
    const built = plan({
      targetUniverse: zeroTarget,
      changes: [],
      thresholds: undefined,
    });
    const checkpoint = createIncrementalGraphCheckpoint(built);

    expect(built.accounting).toMatchObject({ changeCount: 0, unchangedRecordCount: 4, targetRecordCount: 4 });
    expect(built.batches).toEqual([]);
    expect(checkpoint.status).toBe('ready_to_activate');
    expect(built.watermark.base.snapshotId).not.toBe(built.watermark.target.snapshotId);
  });

  it('uses byte-stable canonical receipts and rejects non-finite values and altered stable IDs', () => {
    expect(canonicalizeIncrementalGraph({ z: 1, a: { y: true, x: null } }))
      .toBe('{"a":{"x":null,"y":true},"z":1}');
    expect(() => canonicalizeIncrementalGraph({ bad: Number.NaN })).toThrow('incremental_graph_canonical_non_finite');

    const built = plan();
    const tampered = clone(built);
    tampered.changes[0].changeId = `change:${sha('0')}`;
    expect(() => decodeIncrementalGraphPlan(tampered)).toThrow('incremental_graph_change_id_mismatch');
  });
});
