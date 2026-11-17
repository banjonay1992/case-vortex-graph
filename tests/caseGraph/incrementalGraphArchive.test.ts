import { describe, expect, it } from 'vitest';

import type {
  CaseGraphArchiveWriteCondition,
  CaseGraphConditionalArchiveStorage,
  CaseGraphConditionalWriteResult,
} from '../../src/caseGraph/archiveTypes';
import {
  archiveIncrementalGraphActivationReceipt,
  archiveIncrementalGraphBatchReceipt,
  getIncrementalGraphArchiveControlKeys,
  getIncrementalGraphBatchReceiptKey,
  getIncrementalGraphTombstoneKey,
  initializeIncrementalGraphArchive,
  readVerifiedIncrementalGraphArchive,
} from '../../src/caseGraph/incrementalGraphArchive';
import {
  INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
  buildIncrementalGraphActivationIntent,
  buildIncrementalGraphActivationReceipt,
  buildIncrementalGraphBatchReceipt,
  buildIncrementalGraphPlan,
  type IncrementalGraphActivationReceipt,
  type IncrementalGraphBatchReceipt,
  type IncrementalGraphCheckpoint,
  type IncrementalGraphPlan,
  type IncrementalGraphUniverseBinding,
} from '../../src/caseGraph/incrementalGraphPlan';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
} from '../../src/caseGraph/evidenceUniverse';

type Stored = { body: Buffer; version: string };
type ConditionalHook = (key: string, condition: CaseGraphArchiveWriteCondition) => Promise<void>;

class MemoryConditionalStorage implements CaseGraphConditionalArchiveStorage {
  readonly objects = new Map<string, Stored>();
  readonly throwAfterCommitKeys = new Set<string>();
  readonly wrongVersionReceiptKeys = new Set<string>();
  beforeConditionalWrite: ConditionalHook | null = null;
  private version = 0;

  private nextVersion() {
    this.version += 1;
    return `v${this.version}`;
  }

  async readObject(key: string) {
    const value = this.objects.get(key);
    return value ? Buffer.from(value.body) : null;
  }

  async readObjectVersioned(key: string) {
    const value = this.objects.get(key);
    return value ? { body: Buffer.from(value.body), version: value.version } : null;
  }

  async uploadFile(body: Buffer, key: string) {
    this.objects.set(key, { body: Buffer.from(body), version: this.nextVersion() });
    return key;
  }

  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: { contentType: string; contentEncoding?: string; cacheControl: string; contentLength: number },
    condition: CaseGraphArchiveWriteCondition,
  ): Promise<CaseGraphConditionalWriteResult> {
    await this.beforeConditionalWrite?.(key, condition);
    const existing = this.objects.get(key);
    if ('ifAbsent' in condition ? Boolean(existing) : !existing || existing.version !== condition.ifVersion) {
      return { status: 'precondition_failed' };
    }
    const version = this.nextVersion();
    this.objects.set(key, { body: Buffer.from(body), version });
    if (this.throwAfterCommitKeys.delete(key)) throw new Error(`simulated_lost_ack:${key}`);
    return {
      status: 'written',
      key,
      version: this.wrongVersionReceiptKeys.delete(key) ? `${version}-wrong` : version,
    };
  }

  overwrite(key: string, body: Buffer) {
    this.objects.set(key, { body: Buffer.from(body), version: this.nextVersion() });
  }
}

const sha = (character: string) => character.repeat(64);
const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

const universe = (
  snapshotId: string,
  marker: string,
  recordCount = 10,
): IncrementalGraphUniverseBinding => ({
  snapshotId,
  corpusVersion: 'corpus/archive-v1',
  universeArchiveVersion: INCREMENTAL_GRAPH_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: sha(marker),
  addressSetSha256: sha(marker === 'a' ? 'b' : 'c'),
  recordCount,
});

const base = () => universe('00000000-0000-4000-8000-000000000001', 'a');
const target = () => universe('00000000-0000-4000-8000-000000000002', 'd');

const edge = () => ({
  edgeId: 'edge:alpha-report',
  edgeSha256: sha('e'),
  leftAddress: 'document:report',
  rightAddress: 'sighting:alpha',
});

const makePlan = (overrides: Partial<Parameters<typeof buildIncrementalGraphPlan>[0]> = {}) => buildIncrementalGraphPlan({
  baseGeneration: {
    activationId: 'activation:base',
    universe: base(),
    relationshipInputSetSha256: sha('1'),
    graphArchiveSetSha256: sha('2'),
    incidentIndexRootSha256: sha('3'),
  },
  targetUniverse: target(),
  targetRelationshipInputSetSha256: sha('4'),
  incidentIndexRootSha256: sha('3'),
  sourceDiffReceiptSha256: sha('5'),
  sourceSequence: 1,
  sourceCursor: 'archive-diff/0001',
  changes: [
    {
      action: 'update',
      address: 'sighting:alpha',
      beforeRecordSha256: sha('6'),
      afterRecordSha256: sha('7'),
      priorIncidentEdges: [edge()],
      priorIncidentEdgesComplete: true,
    },
    {
      action: 'delete',
      address: 'document:report',
      beforeRecordSha256: sha('8'),
      afterRecordSha256: null,
      priorIncidentEdges: [edge()],
      priorIncidentEdgesComplete: true,
    },
    {
      action: 'insert',
      address: 'photo:new',
      beforeRecordSha256: null,
      afterRecordSha256: sha('9'),
      priorIncidentEdges: [],
      priorIncidentEdgesComplete: true,
    },
  ],
  thresholds: {
    batchSize: 1,
    maximumChangedRecords: 100,
    maximumChangedFraction: 1,
    maximumInvalidatedEdges: 100,
  },
  ...overrides,
});

const makeBatchReceipt = (
  plan: IncrementalGraphPlan,
  ordinal: number,
  transactionId = `tx:batch-${ordinal}`,
): IncrementalGraphBatchReceipt => {
  const batch = plan.batches[ordinal];
  return buildIncrementalGraphBatchReceipt({
    plan,
    batchOrdinal: ordinal,
    appliedChangeSetSha256: batch.changeSetSha256,
    deletedEdgeSetSha256: batch.invalidatedEdgeSetSha256,
    recomputedAddressSetSha256: batch.recomputeAddressSetSha256,
    committedTombstoneSetSha256: batch.tombstoneSetSha256,
    writtenNodeCount: batch.recomputeAddresses.length,
    writtenEdgeCount: ordinal + 1,
    nodeDeltaSetSha256: sha('a'),
    edgeDeltaSetSha256: sha('b'),
    transaction: {
      isolationLevel: 'serializable',
      idempotencyKey: batch.batchId,
      transactionId,
      commitToken: `lsn/batch-${ordinal}`,
      committedAt: `2026-07-18T14:0${ordinal}:00.000Z`,
      commitProofSha256: sha(String(ordinal + 1)),
      committed: true,
    },
  });
};

const applyAll = async (storage: MemoryConditionalStorage, plan: IncrementalGraphPlan) => {
  let checkpoint: IncrementalGraphCheckpoint | null = null;
  for (let ordinal = 0; ordinal < plan.batches.length; ordinal += 1) {
    const result = await archiveIncrementalGraphBatchReceipt({
      storage,
      plan,
      receipt: makeBatchReceipt(plan, ordinal),
    });
    checkpoint = result.checkpoint;
  }
  if (!checkpoint) throw new Error('test_checkpoint_missing');
  return checkpoint;
};

const makeActivationReceipt = (
  plan: IncrementalGraphPlan,
  checkpoint: IncrementalGraphCheckpoint,
  transactionId = 'tx:activation',
): IncrementalGraphActivationReceipt => {
  const intent = buildIncrementalGraphActivationIntent({
    plan,
    checkpoint,
    output: {
      universe: plan.watermark.target,
      relationshipInputSetSha256: plan.watermark.targetRelationshipInputSetSha256,
      graphArchiveSetSha256: sha('c'),
      graphManifestSha256: sha('d'),
      incidentIndexRootSha256: sha('e'),
      nodeAddressSetSha256: plan.watermark.target.addressSetSha256,
      nodeCount: plan.watermark.target.recordCount,
      connectedNodeCount: 2,
      isolatedNodeCount: plan.watermark.target.recordCount - 2,
      edgeCount: 1,
    },
  });
  return buildIncrementalGraphActivationReceipt({
    intent,
    transaction: {
      isolationLevel: 'serializable',
      compareAndSwap: 'active_activation_and_graph_archive',
      idempotencyKey: intent.activationId,
      expectedPreviousActivationId: intent.expectedPreviousActivationId,
      observedPreviousActivationId: intent.expectedPreviousActivationId,
      expectedPreviousGraphArchiveSetSha256: intent.expectedPreviousGraphArchiveSetSha256,
      observedPreviousGraphArchiveSetSha256: intent.expectedPreviousGraphArchiveSetSha256,
      committedActivationId: intent.activationId,
      transactionId,
      commitToken: 'lsn/activation',
      committedAt: '2026-07-18T15:00:00.000Z',
      commitProofSha256: sha('f'),
      committed: true,
    },
  });
};

const twoPartyBarrier = (): ConditionalHook => {
  let arrivals = 0;
  let release: (() => void) | null = null;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return async (_key, condition) => {
    if (!('ifVersion' in condition)) return;
    arrivals += 1;
    if (arrivals === 2) release?.();
    await waiting;
  };
};

describe('incremental graph conditional archive', () => {
  it('creates a canonical immutable plan, tombstones, and resumable checkpoint under a snapshot-bound prefix', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    const result = await initializeIncrementalGraphArchive({ storage, plan });
    const keys = getIncrementalGraphArchiveControlKeys(plan);
    const tombstone = plan.changes.find((change) => change.tombstone)?.tombstone;

    expect(result.status).toBe('initialized');
    expect(keys.prefix).toContain('corpus%2Farchive-v1');
    expect(keys.prefix).toContain(plan.watermark.target.snapshotId);
    expect(storage.objects.get(keys.planKey)?.body).toEqual(jsonBody(plan));
    expect(storage.objects.get(keys.checkpointKey)?.body).toEqual(jsonBody(result.checkpoint));
    expect(tombstone).not.toBeNull();
    expect(storage.objects.get(getIncrementalGraphTombstoneKey(plan, tombstone!.tombstoneId))?.body)
      .toEqual(jsonBody(tombstone));

    const verified = await readVerifiedIncrementalGraphArchive({ storage, plan });
    expect(verified.checkpoint.status).toBe('processing');
    expect(verified.activationReceipt).toBeNull();
  });

  it('changes the archive namespace when target bytes, relationship inputs, or the base generation change', () => {
    const original = makePlan();
    const changedTargetArchive = makePlan({
      targetUniverse: {
        ...target(),
        universeArchiveSetSha256: sha('f'),
      },
    });
    const changedTargetInputs = makePlan({ targetRelationshipInputSetSha256: sha('0') });
    const changedBaseGeneration = makePlan({
      baseGeneration: {
        ...original.baseGeneration,
        relationshipInputSetSha256: sha('9'),
      },
    });
    const prefixes = [
      original,
      changedTargetArchive,
      changedTargetInputs,
      changedBaseGeneration,
    ].map((plan) => getIncrementalGraphArchiveControlKeys(plan).prefix);

    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes[0]).toContain(original.watermark.target.snapshotId);
    expect(prefixes[0]).toContain(original.planId.slice('plan:'.length));
  });

  it('reuses an exact initialized archive without replacing immutable bytes or resetting progress', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt: makeBatchReceipt(plan, 0) });
    const checkpointVersion = storage.objects.get(getIncrementalGraphArchiveControlKeys(plan).checkpointKey)?.version;

    const resumed = await initializeIncrementalGraphArchive({ storage, plan });
    expect(resumed.status).toBe('resumed');
    expect(resumed.checkpoint.nextBatchOrdinal).toBe(1);
    expect(storage.objects.get(getIncrementalGraphArchiveControlKeys(plan).checkpointKey)?.version)
      .toBe(checkpointVersion);
  });

  it('reconciles commit-then-throw acknowledgements for the plan, tombstone, and initial checkpoint', async () => {
    const plan = makePlan();
    const keys = getIncrementalGraphArchiveControlKeys(plan);
    const tombstone = plan.changes.find((change) => change.tombstone)?.tombstone;
    if (!tombstone) throw new Error('test_tombstone_missing');
    const targetKeys = [keys.planKey, getIncrementalGraphTombstoneKey(plan, tombstone.tombstoneId), keys.checkpointKey];

    for (const lostAckKey of targetKeys) {
      const storage = new MemoryConditionalStorage();
      storage.throwAfterCommitKeys.add(lostAckKey);
      const initialized = await initializeIncrementalGraphArchive({ storage, plan });
      expect(initialized.checkpoint.planId).toBe(plan.planId);
      expect(storage.objects.has(lostAckKey)).toBe(true);
    }
  });

  it('archives a batch receipt before atomically advancing and revalidates every referenced receipt on resume', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    const receipt = makeBatchReceipt(plan, 0);
    const applied = await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt });

    expect(applied.status).toBe('applied');
    expect(applied.checkpoint.nextBatchOrdinal).toBe(1);
    expect(storage.objects.get(getIncrementalGraphBatchReceiptKey(plan, 0))?.body).toEqual(jsonBody(receipt));
    expect((await readVerifiedIncrementalGraphArchive({ storage, plan })).checkpoint.batchReceipts[0])
      .toMatchObject({ receiptId: receipt.receiptId, transactionId: receipt.transaction.transactionId });
  });

  it('reconciles lost acknowledgements for both immutable batch receipt creation and checkpoint CAS', async () => {
    for (const lostTarget of ['receipt', 'checkpoint'] as const) {
      const storage = new MemoryConditionalStorage();
      const plan = makePlan();
      await initializeIncrementalGraphArchive({ storage, plan });
      const receipt = makeBatchReceipt(plan, 0);
      storage.throwAfterCommitKeys.add(lostTarget === 'receipt'
        ? getIncrementalGraphBatchReceiptKey(plan, 0)
        : getIncrementalGraphArchiveControlKeys(plan).checkpointKey);

      const result = await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt });
      expect(result.checkpoint.nextBatchOrdinal).toBe(1);
      expect(result.checkpoint.batchReceipts[0].receiptId).toBe(receipt.receiptId);
    }
  });

  it('only claims a checkpoint write was applied when its returned version matches the stored CAS version', async () => {
    const plan = makePlan();
    const keys = getIncrementalGraphArchiveControlKeys(plan);

    const initialStorage = new MemoryConditionalStorage();
    initialStorage.wrongVersionReceiptKeys.add(keys.checkpointKey);
    const initialized = await initializeIncrementalGraphArchive({ storage: initialStorage, plan });
    expect(initialized.status).toBe('resumed');
    expect(initialized.checkpoint.nextBatchOrdinal).toBe(0);

    const batchStorage = new MemoryConditionalStorage();
    await initializeIncrementalGraphArchive({ storage: batchStorage, plan });
    batchStorage.wrongVersionReceiptKeys.add(keys.checkpointKey);
    const applied = await archiveIncrementalGraphBatchReceipt({
      storage: batchStorage,
      plan,
      receipt: makeBatchReceipt(plan, 0),
    });
    expect(applied.status).toBe('already_applied');
    expect(applied.checkpoint.nextBatchOrdinal).toBe(1);
  });

  it('leaves a create-only orphan receipt safe to replay after unrelated checkpoint version churn', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    const keys = getIncrementalGraphArchiveControlKeys(plan);
    const receipt = makeBatchReceipt(plan, 0);
    await initializeIncrementalGraphArchive({ storage, plan });
    let churned = false;
    storage.beforeConditionalWrite = async (key, condition) => {
      if (churned || key !== keys.checkpointKey || !('ifVersion' in condition)) return;
      const current = storage.objects.get(key);
      if (!current) throw new Error('test_checkpoint_missing');
      storage.overwrite(key, current.body);
      churned = true;
    };

    await expect(archiveIncrementalGraphBatchReceipt({ storage, plan, receipt }))
      .rejects.toThrow('incremental_graph_archive_checkpoint_write_conflict');
    expect(storage.objects.get(getIncrementalGraphBatchReceiptKey(plan, 0))?.body)
      .toEqual(jsonBody(receipt));
    expect((await readVerifiedIncrementalGraphArchive({ storage, plan })).checkpoint.nextBatchOrdinal)
      .toBe(0);

    storage.beforeConditionalWrite = null;
    const replay = await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt });
    expect(replay.status).toBe('applied');
    expect(replay.checkpoint.nextBatchOrdinal).toBe(1);
  });

  it('allows two exact competing writers to converge through checkpoint CAS without duplicate application', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    const receipt = makeBatchReceipt(plan, 0);
    storage.beforeConditionalWrite = twoPartyBarrier();

    const results = await Promise.all([
      archiveIncrementalGraphBatchReceipt({ storage, plan, receipt }),
      archiveIncrementalGraphBatchReceipt({ storage, plan, receipt }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['already_applied', 'applied']);
    expect((await readVerifiedIncrementalGraphArchive({ storage, plan })).checkpoint.nextBatchOrdinal).toBe(1);
  });

  it('rejects divergent receipts for one deterministic batch and preserves the winning receipt', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    const winning = makeBatchReceipt(plan, 0);
    await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt: winning });

    await expect(archiveIncrementalGraphBatchReceipt({
      storage,
      plan,
      receipt: makeBatchReceipt(plan, 0, 'tx:divergent'),
    })).rejects.toThrow(/incremental_graph_batch_replay_conflict|incremental_graph_archive_batch_receipt_immutable_conflict/);
    expect(storage.objects.get(getIncrementalGraphBatchReceiptKey(plan, 0))?.body).toEqual(jsonBody(winning));
  });

  it('rejects an out-of-order batch without leaving an orphan receipt or changing the checkpoint', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });

    await expect(archiveIncrementalGraphBatchReceipt({
      storage,
      plan,
      receipt: makeBatchReceipt(plan, 1),
    })).rejects.toThrow('incremental_graph_batch_out_of_order');
    expect(storage.objects.has(getIncrementalGraphBatchReceiptKey(plan, 1))).toBe(false);
    expect((await readVerifiedIncrementalGraphArchive({ storage, plan })).checkpoint.nextBatchOrdinal).toBe(0);
  });

  it('fails closed when stored plan, tombstone, checkpoint, or referenced batch bytes are altered', async () => {
    const cases: Array<'plan' | 'tombstone' | 'checkpoint' | 'receipt'> = ['plan', 'tombstone', 'checkpoint', 'receipt'];
    for (const corruption of cases) {
      const storage = new MemoryConditionalStorage();
      const plan = makePlan();
      await initializeIncrementalGraphArchive({ storage, plan });
      if (corruption === 'receipt') {
        await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt: makeBatchReceipt(plan, 0) });
      }
      const keys = getIncrementalGraphArchiveControlKeys(plan);
      const tombstone = plan.changes.find((change) => change.tombstone)?.tombstone;
      const key = corruption === 'plan'
        ? keys.planKey
        : corruption === 'checkpoint'
          ? keys.checkpointKey
          : corruption === 'receipt'
            ? getIncrementalGraphBatchReceiptKey(plan, 0)
            : getIncrementalGraphTombstoneKey(plan, tombstone!.tombstoneId);
      storage.overwrite(key, Buffer.from('{"tampered":true}\n'));
      await expect(readVerifiedIncrementalGraphArchive({ storage, plan })).rejects.toThrow(/corrupt|noncanonical/);
    }
  });

  it('rejects canonical bytes from a different universe snapshot at the expected plan key', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    const other = makePlan({
      targetUniverse: universe('00000000-0000-4000-8000-000000000099', 'f'),
    });
    storage.overwrite(getIncrementalGraphArchiveControlKeys(plan).planKey, jsonBody(other));

    await expect(readVerifiedIncrementalGraphArchive({ storage, plan }))
      .rejects.toThrow('incremental_graph_archive_plan_binding_mismatch');
  });

  it('rejects checkpoints and referenced batch receipts copied from a different snapshot plan', async () => {
    const plan = makePlan();
    const otherPlan = makePlan({
      targetUniverse: universe('00000000-0000-4000-8000-000000000099', 'f'),
    });
    const otherStorage = new MemoryConditionalStorage();
    await initializeIncrementalGraphArchive({ storage: otherStorage, plan: otherPlan });
    await archiveIncrementalGraphBatchReceipt({
      storage: otherStorage,
      plan: otherPlan,
      receipt: makeBatchReceipt(otherPlan, 0),
    });

    for (const mixedObject of ['checkpoint', 'receipt'] as const) {
      const storage = new MemoryConditionalStorage();
      await initializeIncrementalGraphArchive({ storage, plan });
      await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt: makeBatchReceipt(plan, 0) });
      const destinationKey = mixedObject === 'checkpoint'
        ? getIncrementalGraphArchiveControlKeys(plan).checkpointKey
        : getIncrementalGraphBatchReceiptKey(plan, 0);
      const sourceKey = mixedObject === 'checkpoint'
        ? getIncrementalGraphArchiveControlKeys(otherPlan).checkpointKey
        : getIncrementalGraphBatchReceiptKey(otherPlan, 0);
      const otherObject = otherStorage.objects.get(sourceKey);
      if (!otherObject) throw new Error('test_other_snapshot_object_missing');
      storage.overwrite(destinationKey, otherObject.body);

      await expect(readVerifiedIncrementalGraphArchive({ storage, plan }))
        .rejects.toThrow(/binding|mismatch|corrupt/);
    }
  });

  it('rejects semantically valid but noncanonical plan, checkpoint, and referenced receipt bytes', async () => {
    for (const targetObject of ['plan', 'checkpoint', 'receipt'] as const) {
      const storage = new MemoryConditionalStorage();
      const plan = makePlan();
      await initializeIncrementalGraphArchive({ storage, plan });
      const receipt = makeBatchReceipt(plan, 0);
      let checkpoint = (await readVerifiedIncrementalGraphArchive({ storage, plan })).checkpoint;
      if (targetObject === 'receipt') {
        checkpoint = (await archiveIncrementalGraphBatchReceipt({ storage, plan, receipt })).checkpoint;
      }
      const keys = getIncrementalGraphArchiveControlKeys(plan);
      const key = targetObject === 'plan'
        ? keys.planKey
        : targetObject === 'checkpoint'
          ? keys.checkpointKey
          : getIncrementalGraphBatchReceiptKey(plan, 0);
      const value = targetObject === 'plan' ? plan : targetObject === 'checkpoint' ? checkpoint : receipt;
      storage.overwrite(key, Buffer.from(JSON.stringify(value)));
      await expect(readVerifiedIncrementalGraphArchive({ storage, plan }))
        .rejects.toThrow('noncanonical');
    }
  });

  it('archives a completed transactional activation receipt create-only and reconciles exact replay and lost acknowledgement', async () => {
    for (const loseAck of [false, true]) {
      const storage = new MemoryConditionalStorage();
      const plan = makePlan();
      await initializeIncrementalGraphArchive({ storage, plan });
      const checkpoint = await applyAll(storage, plan);
      const receipt = makeActivationReceipt(plan, checkpoint);
      if (loseAck) storage.throwAfterCommitKeys.add(getIncrementalGraphArchiveControlKeys(plan).activationReceiptKey);

      const first = await archiveIncrementalGraphActivationReceipt({ storage, plan, receipt });
      expect(first.status).toBe(loseAck ? 'already_activated' : 'activated');
      const replay = await archiveIncrementalGraphActivationReceipt({ storage, plan, receipt });
      expect(replay.status).toBe('already_activated');
      expect((await readVerifiedIncrementalGraphArchive({ storage, plan })).activationReceipt?.receiptId)
        .toBe(receipt.receiptId);

      const finalBatchReplay = await archiveIncrementalGraphBatchReceipt({
        storage,
        plan,
        receipt: makeBatchReceipt(plan, plan.batches.length - 1),
      });
      expect(finalBatchReplay.status).toBe('already_applied');
    }
  });

  it('lets exact competing activation writers converge on one immutable receipt', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    const checkpoint = await applyAll(storage, plan);
    const receipt = makeActivationReceipt(plan, checkpoint);

    const results = await Promise.all([
      archiveIncrementalGraphActivationReceipt({ storage, plan, receipt }),
      archiveIncrementalGraphActivationReceipt({ storage, plan, receipt }),
    ]);
    expect(results.map((result) => result.status).sort())
      .toEqual(['activated', 'already_activated']);
    expect(storage.objects.get(getIncrementalGraphArchiveControlKeys(plan).activationReceiptKey)?.body)
      .toEqual(jsonBody(receipt));
  });

  it('activates a zero-change snapshot advance without inventing batch receipts', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan({ changes: [] });
    const initialized = await initializeIncrementalGraphArchive({ storage, plan });
    expect(plan.batches).toEqual([]);
    expect(initialized.checkpoint.status).toBe('ready_to_activate');
    expect(initialized.checkpoint.batchReceipts).toEqual([]);
    const receipt = makeActivationReceipt(plan, initialized.checkpoint);

    const activated = await archiveIncrementalGraphActivationReceipt({ storage, plan, receipt });
    expect(activated.status).toBe('activated');
    expect((await readVerifiedIncrementalGraphArchive({ storage, plan })).activationReceipt?.receiptId)
      .toBe(receipt.receiptId);
  });

  it('rejects divergent or mixed-snapshot activation receipts and corrupted stored activation bytes', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan();
    await initializeIncrementalGraphArchive({ storage, plan });
    const checkpoint = await applyAll(storage, plan);
    const winning = makeActivationReceipt(plan, checkpoint);
    await archiveIncrementalGraphActivationReceipt({ storage, plan, receipt: winning });

    await expect(archiveIncrementalGraphActivationReceipt({
      storage,
      plan,
      receipt: makeActivationReceipt(plan, checkpoint, 'tx:activation-divergent'),
    })).rejects.toThrow('incremental_graph_archive_activation_receipt_immutable_conflict');

    const otherPlan = makePlan({
      targetUniverse: universe('00000000-0000-4000-8000-000000000099', 'f'),
    });
    const otherStorage = new MemoryConditionalStorage();
    await initializeIncrementalGraphArchive({ storage: otherStorage, plan: otherPlan });
    const otherCheckpoint = await applyAll(otherStorage, otherPlan);
    await expect(archiveIncrementalGraphActivationReceipt({
      storage,
      plan,
      receipt: makeActivationReceipt(otherPlan, otherCheckpoint),
    })).rejects.toThrow(/snapshot|binding|plan/);

    storage.overwrite(getIncrementalGraphArchiveControlKeys(plan).activationReceiptKey, Buffer.from('{"tampered":true}\n'));
    await expect(readVerifiedIncrementalGraphArchive({ storage, plan }))
      .rejects.toThrow('incremental_graph_archive_activation_receipt_corrupt');
  });

  it('does not publish any archive state when the deterministic thresholds demand a full rebuild', async () => {
    const storage = new MemoryConditionalStorage();
    const plan = makePlan({
      thresholds: {
        batchSize: 1,
        maximumChangedRecords: 1,
        maximumChangedFraction: 1,
        maximumInvalidatedEdges: 100,
      },
    });
    expect(plan.mode).toBe('full_rebuild');
    await expect(initializeIncrementalGraphArchive({ storage, plan }))
      .rejects.toThrow('incremental_graph_archive_full_rebuild_required');
    expect(storage.objects.size).toBe(0);
  });

  it('requires the existing atomic conditional-storage contract', async () => {
    const storage = {
      readObject: async () => null,
      uploadFile: async () => 'unused',
    };
    await expect(initializeIncrementalGraphArchive({ storage, plan: makePlan() }))
      .rejects.toThrow('incremental_graph_archive_conditional_storage_required');
  });

  it('requires non-empty storage versions for every immutable object read by the verifier', async () => {
    for (const targetObject of ['plan', 'tombstone', 'receipt', 'activation'] as const) {
      const storage = new MemoryConditionalStorage();
      const plan = makePlan();
      await initializeIncrementalGraphArchive({ storage, plan });
      const checkpoint = await applyAll(storage, plan);
      const activation = makeActivationReceipt(plan, checkpoint);
      await archiveIncrementalGraphActivationReceipt({ storage, plan, receipt: activation });
      const tombstone = plan.changes.find((change) => change.tombstone)?.tombstone;
      if (!tombstone) throw new Error('test_tombstone_missing');
      const key = targetObject === 'plan'
        ? getIncrementalGraphArchiveControlKeys(plan).planKey
        : targetObject === 'tombstone'
          ? getIncrementalGraphTombstoneKey(plan, tombstone.tombstoneId)
          : targetObject === 'receipt'
            ? getIncrementalGraphBatchReceiptKey(plan, 0)
            : getIncrementalGraphArchiveControlKeys(plan).activationReceiptKey;
      const stored = storage.objects.get(key);
      if (!stored) throw new Error('test_versioned_object_missing');
      storage.objects.set(key, { body: stored.body, version: '' });

      await expect(readVerifiedIncrementalGraphArchive({ storage, plan }))
        .rejects.toThrow(`incremental_graph_archive_object_version_invalid:${key}`);
    }
  });
});
