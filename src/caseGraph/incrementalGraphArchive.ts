import type {
  CaseGraphArchiveStorage,
  CaseGraphConditionalArchiveStorage,
  CaseGraphVersionedArchiveObject,
} from './archiveTypes';
import {
  advanceIncrementalGraphCheckpoint,
  buildIncrementalGraphActivationIntent,
  canonicalizeIncrementalGraph,
  createIncrementalGraphCheckpoint,
  decodeIncrementalGraphActivationReceipt,
  decodeIncrementalGraphBatchReceipt,
  decodeIncrementalGraphCheckpoint,
  decodeIncrementalGraphPlan,
  type IncrementalGraphActivationReceipt,
  type IncrementalGraphBatchReceipt,
  type IncrementalGraphCheckpoint,
  type IncrementalGraphPlan,
} from './incrementalGraphPlan';

export const INCREMENTAL_GRAPH_ARCHIVE_VERSION = 'case-vortex-incremental-archive-v1' as const;

type UploadOptions = {
  contentType: string;
  cacheControl: string;
  contentLength: number;
};

export type IncrementalGraphArchiveControlKeys = {
  prefix: string;
  planKey: string;
  checkpointKey: string;
  activationReceiptKey: string;
};

export type VerifiedIncrementalGraphArchive = {
  plan: IncrementalGraphPlan;
  checkpoint: IncrementalGraphCheckpoint;
  checkpointVersion: string;
  activationReceipt: IncrementalGraphActivationReceipt | null;
};

function fail(code: string): never {
  throw new Error(code);
}

const jsonBody = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

const requireStorage = (storage: CaseGraphArchiveStorage): CaseGraphConditionalArchiveStorage => {
  const candidate = storage as Partial<CaseGraphConditionalArchiveStorage>;
  if (
    typeof candidate.readObjectVersioned !== 'function'
    || typeof candidate.uploadFileConditional !== 'function'
  ) fail('incremental_graph_archive_conditional_storage_required');
  return storage as CaseGraphConditionalArchiveStorage;
};

const segment = (value: string) => encodeURIComponent(value);

const planDigest = (plan: IncrementalGraphPlan) => {
  const match = /^plan:([a-f0-9]{64})$/.exec(plan.planId);
  if (!match) fail('incremental_graph_archive_plan_id_invalid');
  return match[1];
};

export const getIncrementalGraphArchiveControlKeys = (
  planInput: IncrementalGraphPlan,
): IncrementalGraphArchiveControlKeys => {
  const plan = decodeIncrementalGraphPlan(planInput);
  const prefix = [
    'case-vortex',
    'incremental',
    INCREMENTAL_GRAPH_ARCHIVE_VERSION,
    segment(plan.watermark.target.corpusVersion),
    plan.watermark.target.snapshotId,
    planDigest(plan),
    '',
  ].join('/');
  return {
    prefix,
    planKey: `${prefix}plan.json`,
    checkpointKey: `${prefix}checkpoint.json`,
    activationReceiptKey: `${prefix}activation-receipt.json`,
  };
};

const digestSuffix = (value: string, prefix: string, code: string) => {
  const match = new RegExp(`^${prefix}:([a-f0-9]{64})$`).exec(value);
  if (!match) fail(code);
  return match[1];
};

export const getIncrementalGraphTombstoneKey = (
  planInput: IncrementalGraphPlan,
  tombstoneId: string,
) => {
  const plan = decodeIncrementalGraphPlan(planInput);
  return `${getIncrementalGraphArchiveControlKeys(plan).prefix}tombstones/${digestSuffix(
    tombstoneId,
    'tombstone',
    'incremental_graph_archive_tombstone_id_invalid',
  )}.json`;
};

export const getIncrementalGraphBatchReceiptKey = (
  planInput: IncrementalGraphPlan,
  batchOrdinal: number,
) => {
  const plan = decodeIncrementalGraphPlan(planInput);
  if (!Number.isSafeInteger(batchOrdinal) || batchOrdinal < 0) {
    fail('incremental_graph_archive_batch_ordinal_invalid');
  }
  const batch = plan.batches[batchOrdinal];
  if (!batch) fail('incremental_graph_archive_batch_ordinal_invalid');
  return `${getIncrementalGraphArchiveControlKeys(plan).prefix}batches/${String(batch.ordinal).padStart(8, '0')}-${digestSuffix(
    batch.batchId,
    'batch',
    'incremental_graph_archive_batch_id_invalid',
  )}/receipt.json`;
};

const immutableOptions = (body: Buffer): UploadOptions => ({
  contentType: 'application/json',
  cacheControl: 'private, max-age=31536000, immutable',
  contentLength: body.length,
});

const checkpointOptions = (body: Buffer): UploadOptions => ({
  contentType: 'application/json',
  cacheControl: 'private, no-store',
  contentLength: body.length,
});

const readVersioned = async (
  storage: CaseGraphConditionalArchiveStorage,
  key: string,
): Promise<CaseGraphVersionedArchiveObject | null> => {
  const object = await storage.readObjectVersioned(key);
  if (object && (!Buffer.isBuffer(object.body) || !String(object.version || '').trim())) {
    fail(`incremental_graph_archive_object_version_invalid:${key}`);
  }
  return object;
};

const putImmutable = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  key: string;
  body: Buffer;
  conflictCode: string;
}): Promise<'written' | 'reused'> => {
  const reconcile = async () => {
    const existing = await readVersioned(params.storage, params.key);
    if (!existing) return null;
    if (!existing.body.equals(params.body)) fail(`${params.conflictCode}:${params.key}`);
    return 'reused' as const;
  };
  let result;
  try {
    result = await params.storage.uploadFileConditional(
      params.body,
      params.key,
      immutableOptions(params.body),
      { ifAbsent: true },
    );
  } catch (error) {
    try {
      const reconciled = await reconcile();
      if (reconciled) return reconciled;
    } catch (reconcileError) {
      throw reconcileError;
    }
    throw error;
  }
  if (result.status === 'precondition_failed') {
    const reconciled = await reconcile();
    if (reconciled) return reconciled;
    fail(`${params.conflictCode}:${params.key}`);
  }
  if (result.key !== params.key || !String(result.version || '').trim()) {
    const reconciled = await reconcile();
    if (reconciled) return reconciled;
    fail(`incremental_graph_archive_write_receipt_invalid:${params.key}`);
  }
  const stored = await readVersioned(params.storage, params.key);
  if (!stored?.body.equals(params.body) || stored.version !== result.version) {
    fail(`incremental_graph_archive_read_after_write_failed:${params.key}`);
  }
  return 'written';
};

const assertCanonicalBody = (body: Buffer, normalized: unknown, code: string) => {
  if (!body.equals(jsonBody(normalized))) fail(code);
};

const readVerifiedPlan = async (
  storage: CaseGraphConditionalArchiveStorage,
  expectedPlan: IncrementalGraphPlan,
) => {
  const keys = getIncrementalGraphArchiveControlKeys(expectedPlan);
  const object = await readVersioned(storage, keys.planKey);
  if (!object) fail('incremental_graph_archive_plan_missing');
  const { body } = object;
  let storedPlan: IncrementalGraphPlan;
  try {
    storedPlan = decodeIncrementalGraphPlan(body);
  } catch (error) {
    fail(`incremental_graph_archive_plan_corrupt:${error instanceof Error ? error.message : String(error)}`);
  }
  assertCanonicalBody(body, storedPlan, 'incremental_graph_archive_plan_noncanonical');
  if (canonicalizeIncrementalGraph(storedPlan) !== canonicalizeIncrementalGraph(expectedPlan)) {
    fail('incremental_graph_archive_plan_binding_mismatch');
  }
  return storedPlan;
};

const tombstonesFor = (plan: IncrementalGraphPlan) => plan.changes
  .flatMap((change) => change.tombstone ? [change.tombstone] : []);

const verifyTombstones = async (
  storage: CaseGraphConditionalArchiveStorage,
  plan: IncrementalGraphPlan,
) => {
  for (const tombstone of tombstonesFor(plan)) {
    const object = await readVersioned(
      storage,
      getIncrementalGraphTombstoneKey(plan, tombstone.tombstoneId),
    );
    if (!object) fail(`incremental_graph_archive_tombstone_missing:${tombstone.tombstoneId}`);
    const { body } = object;
    if (!body.equals(jsonBody(tombstone))) {
      fail(`incremental_graph_archive_tombstone_corrupt:${tombstone.tombstoneId}`);
    }
  }
};

const readVerifiedBatchReceipt = async (
  storage: CaseGraphConditionalArchiveStorage,
  plan: IncrementalGraphPlan,
  ordinal: number,
) => {
  const key = getIncrementalGraphBatchReceiptKey(plan, ordinal);
  const object = await readVersioned(storage, key);
  if (!object) fail(`incremental_graph_archive_batch_receipt_missing:${ordinal}`);
  const { body } = object;
  let receipt: IncrementalGraphBatchReceipt;
  try {
    receipt = decodeIncrementalGraphBatchReceipt(body, plan);
  } catch (error) {
    fail(`incremental_graph_archive_batch_receipt_corrupt:${ordinal}:${error instanceof Error ? error.message : String(error)}`);
  }
  assertCanonicalBody(body, receipt, `incremental_graph_archive_batch_receipt_noncanonical:${ordinal}`);
  return receipt;
};

const verifyCheckpointReceipts = async (
  storage: CaseGraphConditionalArchiveStorage,
  plan: IncrementalGraphPlan,
  checkpoint: IncrementalGraphCheckpoint,
) => {
  for (const reference of checkpoint.batchReceipts) {
    const receipt = await readVerifiedBatchReceipt(storage, plan, reference.ordinal);
    if (
      receipt.batchId !== reference.batchId
      || receipt.receiptId !== reference.receiptId
      || receipt.transaction.transactionId !== reference.transactionId
      || receipt.transaction.commitProofSha256 !== reference.commitProofSha256
    ) fail(`incremental_graph_archive_checkpoint_receipt_mismatch:${reference.ordinal}`);
  }
};

const decodeStoredCheckpoint = (
  object: CaseGraphVersionedArchiveObject,
  plan: IncrementalGraphPlan,
) => {
  let checkpoint: IncrementalGraphCheckpoint;
  try {
    checkpoint = decodeIncrementalGraphCheckpoint(object.body, plan);
  } catch (error) {
    fail(`incremental_graph_archive_checkpoint_corrupt:${error instanceof Error ? error.message : String(error)}`);
  }
  assertCanonicalBody(object.body, checkpoint, 'incremental_graph_archive_checkpoint_noncanonical');
  return checkpoint;
};

const readVerifiedCheckpoint = async (
  storage: CaseGraphConditionalArchiveStorage,
  plan: IncrementalGraphPlan,
) => {
  const key = getIncrementalGraphArchiveControlKeys(plan).checkpointKey;
  const object = await readVersioned(storage, key);
  if (!object) fail('incremental_graph_archive_checkpoint_missing');
  const checkpoint = decodeStoredCheckpoint(object, plan);
  await verifyCheckpointReceipts(storage, plan, checkpoint);
  return { checkpoint, version: object.version };
};

const readActivationReceipt = async (
  storage: CaseGraphConditionalArchiveStorage,
  plan: IncrementalGraphPlan,
  checkpoint: IncrementalGraphCheckpoint,
) => {
  const key = getIncrementalGraphArchiveControlKeys(plan).activationReceiptKey;
  const object = await readVersioned(storage, key);
  if (!object) return null;
  const { body } = object;
  let receipt: IncrementalGraphActivationReceipt;
  try {
    receipt = decodeIncrementalGraphActivationReceipt(body, { plan, checkpoint });
  } catch (error) {
    fail(`incremental_graph_archive_activation_receipt_corrupt:${error instanceof Error ? error.message : String(error)}`);
  }
  assertCanonicalBody(body, receipt, 'incremental_graph_archive_activation_receipt_noncanonical');
  return receipt;
};

export const readVerifiedIncrementalGraphArchive = async (params: {
  storage: CaseGraphArchiveStorage;
  plan: IncrementalGraphPlan;
}): Promise<VerifiedIncrementalGraphArchive> => {
  const storage = requireStorage(params.storage);
  const expectedPlan = decodeIncrementalGraphPlan(params.plan);
  const plan = await readVerifiedPlan(storage, expectedPlan);
  await verifyTombstones(storage, plan);
  const { checkpoint, version } = await readVerifiedCheckpoint(storage, plan);
  const activationReceipt = await readActivationReceipt(storage, plan, checkpoint);
  return { plan, checkpoint, checkpointVersion: version, activationReceipt };
};

const ensureInitialCheckpoint = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  plan: IncrementalGraphPlan;
  checkpoint: IncrementalGraphCheckpoint;
}) => {
  const key = getIncrementalGraphArchiveControlKeys(params.plan).checkpointKey;
  const existing = await readVersioned(params.storage, key);
  if (existing) return { status: 'resumed' as const, checkpoint: decodeStoredCheckpoint(existing, params.plan) };
  const body = jsonBody(params.checkpoint);
  let result;
  let writeError: unknown = null;
  try {
    result = await params.storage.uploadFileConditional(
      body,
      key,
      checkpointOptions(body),
      { ifAbsent: true },
    );
  } catch (error) {
    writeError = error;
  }
  let current: CaseGraphVersionedArchiveObject | null = null;
  try {
    current = await readVersioned(params.storage, key);
  } catch {
    if (writeError) throw writeError;
    throw new Error('incremental_graph_archive_checkpoint_read_after_write_failed');
  }
  if (!current) {
    if (writeError) throw writeError;
    fail('incremental_graph_archive_checkpoint_write_failed');
  }
  const checkpoint = decodeStoredCheckpoint(current, params.plan);
  const exactInitial = current.body.equals(body);
  if (
    writeError
    || result?.status === 'precondition_failed'
    || result?.status !== 'written'
    || result.key !== key
    || !String(result.version || '').trim()
    || result.version !== current.version
    || !exactInitial
  ) return { status: 'resumed' as const, checkpoint };
  return { status: 'initialized' as const, checkpoint };
};

export const initializeIncrementalGraphArchive = async (params: {
  storage: CaseGraphArchiveStorage;
  plan: IncrementalGraphPlan;
}) => {
  const storage = requireStorage(params.storage);
  const plan = decodeIncrementalGraphPlan(params.plan);
  if (plan.mode !== 'incremental') fail('incremental_graph_archive_full_rebuild_required');
  const keys = getIncrementalGraphArchiveControlKeys(plan);
  const planBody = jsonBody(plan);
  await putImmutable({
    storage,
    key: keys.planKey,
    body: planBody,
    conflictCode: 'incremental_graph_archive_plan_immutable_conflict',
  });
  for (const tombstone of tombstonesFor(plan)) {
    await putImmutable({
      storage,
      key: getIncrementalGraphTombstoneKey(plan, tombstone.tombstoneId),
      body: jsonBody(tombstone),
      conflictCode: 'incremental_graph_archive_tombstone_immutable_conflict',
    });
  }
  const initial = createIncrementalGraphCheckpoint(plan);
  const ensured = await ensureInitialCheckpoint({ storage, plan, checkpoint: initial });
  const state = await readVerifiedIncrementalGraphArchive({ storage, plan });
  return { status: ensured.status, ...state };
};

const checkpointHasReceipt = (
  checkpoint: IncrementalGraphCheckpoint,
  receipt: IncrementalGraphBatchReceipt,
) => {
  const reference = checkpoint.batchReceipts[receipt.ordinal];
  return Boolean(
    reference
    && reference.batchId === receipt.batchId
    && reference.receiptId === receipt.receiptId
    && reference.transactionId === receipt.transaction.transactionId
    && reference.commitProofSha256 === receipt.transaction.commitProofSha256,
  );
};

const reconcileCheckpointWrite = async (params: {
  storage: CaseGraphConditionalArchiveStorage;
  plan: IncrementalGraphPlan;
  receipt: IncrementalGraphBatchReceipt;
}) => {
  const { checkpoint, version } = await readVerifiedCheckpoint(params.storage, params.plan);
  if (checkpointHasReceipt(checkpoint, params.receipt)) return { checkpoint, version };
  return null;
};

export const archiveIncrementalGraphBatchReceipt = async (params: {
  storage: CaseGraphArchiveStorage;
  plan: IncrementalGraphPlan;
  receipt: IncrementalGraphBatchReceipt;
}) => {
  const storage = requireStorage(params.storage);
  const state = await readVerifiedIncrementalGraphArchive({ storage, plan: params.plan });
  const plan = state.plan;
  const receipt = decodeIncrementalGraphBatchReceipt(params.receipt, plan);
  if (state.activationReceipt) {
    if (checkpointHasReceipt(state.checkpoint, receipt)) {
      return { status: 'already_applied' as const, checkpoint: state.checkpoint };
    }
    fail('incremental_graph_archive_already_activated');
  }
  const alreadyApplied = checkpointHasReceipt(state.checkpoint, receipt);
  const desired = alreadyApplied
    ? state.checkpoint
    : advanceIncrementalGraphCheckpoint({ plan, checkpoint: state.checkpoint, receipt });
  const receiptKey = getIncrementalGraphBatchReceiptKey(plan, receipt.ordinal);
  await putImmutable({
    storage,
    key: receiptKey,
    body: jsonBody(receipt),
    conflictCode: 'incremental_graph_archive_batch_receipt_immutable_conflict',
  });
  if (alreadyApplied) {
    return { status: 'already_applied' as const, checkpoint: state.checkpoint };
  }
  const key = getIncrementalGraphArchiveControlKeys(plan).checkpointKey;
  const body = jsonBody(desired);
  let result;
  let writeError: unknown = null;
  try {
    result = await storage.uploadFileConditional(
      body,
      key,
      checkpointOptions(body),
      { ifVersion: state.checkpointVersion },
    );
  } catch (error) {
    writeError = error;
  }
  let reconciled: Awaited<ReturnType<typeof reconcileCheckpointWrite>> = null;
  try {
    reconciled = await reconcileCheckpointWrite({ storage, plan, receipt });
  } catch (reconcileError) {
    if (writeError) throw writeError;
    throw reconcileError;
  }
  if (reconciled) {
    const appliedByThisWrite = !writeError
      && result?.status === 'written'
      && result.key === key
      && String(result.version || '').trim()
      && result.version === reconciled.version
      && reconciled.checkpoint.checkpointDigest === desired.checkpointDigest;
    return {
      status: appliedByThisWrite ? 'applied' as const : 'already_applied' as const,
      checkpoint: reconciled.checkpoint,
    };
  }
  if (writeError) throw writeError;
  if (result?.status === 'precondition_failed') fail('incremental_graph_archive_checkpoint_write_conflict');
  fail('incremental_graph_archive_checkpoint_write_failed');
};

export const archiveIncrementalGraphActivationReceipt = async (params: {
  storage: CaseGraphArchiveStorage;
  plan: IncrementalGraphPlan;
  receipt: IncrementalGraphActivationReceipt;
}) => {
  const storage = requireStorage(params.storage);
  const state = await readVerifiedIncrementalGraphArchive({ storage, plan: params.plan });
  const receipt = decodeIncrementalGraphActivationReceipt(params.receipt, {
    plan: state.plan,
    checkpoint: state.checkpoint,
  });
  // Rebuilding the intent is redundant with the decoder but makes the archive
  // boundary explicitly dependent on the current stored checkpoint bytes.
  const expectedIntent = buildIncrementalGraphActivationIntent({
    plan: state.plan,
    checkpoint: state.checkpoint,
    output: receipt.intent.output,
  });
  if (canonicalizeIncrementalGraph(expectedIntent) !== canonicalizeIncrementalGraph(receipt.intent)) {
    fail('incremental_graph_archive_activation_binding_mismatch');
  }
  if (state.activationReceipt) {
    if (canonicalizeIncrementalGraph(state.activationReceipt) !== canonicalizeIncrementalGraph(receipt)) {
      fail('incremental_graph_archive_activation_receipt_immutable_conflict');
    }
    return { status: 'already_activated' as const, receipt: state.activationReceipt };
  }
  const key = getIncrementalGraphArchiveControlKeys(state.plan).activationReceiptKey;
  const result = await putImmutable({
    storage,
    key,
    body: jsonBody(receipt),
    conflictCode: 'incremental_graph_archive_activation_receipt_immutable_conflict',
  });
  const storedObject = await readVersioned(storage, key);
  if (!storedObject) fail('incremental_graph_archive_activation_receipt_missing');
  const stored = decodeIncrementalGraphActivationReceipt(storedObject.body, {
    plan: state.plan,
    checkpoint: state.checkpoint,
  });
  assertCanonicalBody(
    storedObject.body,
    stored,
    'incremental_graph_archive_activation_receipt_noncanonical',
  );
  return { status: result === 'written' ? 'activated' as const : 'already_activated' as const, receipt: stored };
};
