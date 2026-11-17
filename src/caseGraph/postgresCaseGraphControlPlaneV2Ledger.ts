import { createHash } from 'node:crypto';

import type { CaseVortexRepresentedRecord } from './corpusAccounting';
import { evidenceUniverseAddress, type EvidenceUniverseNodeKind } from './evidenceUniverse';
import type { CaseGraphV2LineageReceipts, CaseGraphV2RecordLedgerInsertResult, CaseGraphV2Run, KindCounts, PostgresCaseGraphV2TransactionClient } from './postgresCaseGraphControlPlaneV2Types';
import { NODE_KINDS } from './postgresCaseGraphControlPlaneV2Types';
import { emptyKindCounts, isRecord, requiredSha, requiredText, safeCount, sameKindCounts } from './postgresCaseGraphControlPlaneV2Shared';
import { queryRows } from './postgresCaseGraphControlPlaneV2Run';

const ERROR_CODE = /^[a-z0-9][a-z0-9._:-]{0,239}$/;

export type LedgerRow = {
  corpusVersion: string;
  address: string;
  entityKind: EvidenceUniverseNodeKind;
  entityId: string;
  universeRecordSha256: string;
  relationshipInputSha256: string;
  graphRecordSha256: string;
  userInterfaceRecordSha256: string;
  relationshipDisposition: 'processed' | 'not_applicable';
  notApplicableReason: string | null;
  lastRunId: string;
};

export const validateRepresentedRecord = (
  value: CaseVortexRepresentedRecord,
  run: CaseGraphV2Run,
): LedgerRow => {
  if (!isRecord(value) || value.status !== 'represented' || !NODE_KINDS.includes(value.kind)) {
    throw new Error('case_graph_v2_record_ledger_row_invalid');
  }
  const address = evidenceUniverseAddress(value.kind, value.recordId);
  if (value.address !== address
    || !isRecord(value.universe) || value.universe.address !== address
    || !isRecord(value.relationshipInput) || value.relationshipInput.address !== address
    || !isRecord(value.graph) || value.graph.address !== address
    || !isRecord(value.userInterface) || value.userInterface.address !== address) {
    throw new Error('case_graph_v2_record_ledger_address_mismatch');
  }
  const disposition = value.relationshipInput.disposition;
  const reason = value.relationshipInput.notApplicableReason ?? null;
  if (!['processed', 'not_applicable'].includes(disposition)
    || (disposition === 'processed' && reason !== null)
    || (disposition === 'not_applicable' && (typeof reason !== 'string' || !ERROR_CODE.test(reason)))) {
    throw new Error('case_graph_v2_record_ledger_disposition_invalid');
  }
  return {
    corpusVersion: run.corpusVersion,
    address,
    entityKind: value.kind,
    entityId: value.recordId,
    universeRecordSha256: requiredSha(value.universe.sha256, 'case_graph_v2_record_ledger_sha_invalid'),
    relationshipInputSha256: requiredSha(value.relationshipInput.sha256, 'case_graph_v2_record_ledger_sha_invalid'),
    graphRecordSha256: requiredSha(value.graph.sha256, 'case_graph_v2_record_ledger_sha_invalid'),
    userInterfaceRecordSha256: requiredSha(value.userInterface.sha256, 'case_graph_v2_record_ledger_sha_invalid'),
    relationshipDisposition: disposition,
    notApplicableReason: reason,
    lastRunId: run.runId,
  };
};

export const asyncValues = async function* <T>(values: Iterable<T> | AsyncIterable<T>): AsyncGenerator<T> {
  if (Symbol.asyncIterator in Object(values)) {
    for await (const value of values as AsyncIterable<T>) yield value;
  } else {
    for (const value of values as Iterable<T>) yield value;
  }
};

export type LedgerAudit = {
  count: number;
  byKind: KindCounts;
  relationshipProcessedCount: number;
  relationshipNotApplicableCount: number;
  representedAddressSetSha256: string;
  universePointerSetSha256: string;
  relationshipInputPointerSetSha256: string;
  graphPointerSetSha256: string;
  userInterfacePointerSetSha256: string;
};

export const inspectLedger = async (
  records: Iterable<CaseVortexRepresentedRecord> | AsyncIterable<CaseVortexRepresentedRecord>,
  run: CaseGraphV2Run,
): Promise<LedgerAudit> => {
  const byKind = emptyKindCounts();
  const addressHash = createHash('sha256');
  const universeHash = createHash('sha256');
  const relationshipHash = createHash('sha256');
  const graphHash = createHash('sha256');
  const userInterfaceHash = createHash('sha256');
  let previousAddress: string | null = null;
  let count = 0;
  let relationshipProcessedCount = 0;
  let relationshipNotApplicableCount = 0;
  for await (const value of asyncValues(records)) {
    const row = validateRepresentedRecord(value, run);
    if (previousAddress !== null && previousAddress >= row.address) {
      throw new Error('case_graph_v2_record_ledger_order_or_duplicate_invalid');
    }
    previousAddress = row.address;
    count += 1;
    if (!Number.isSafeInteger(count)) throw new Error('case_graph_v2_record_ledger_count_invalid');
    byKind[row.entityKind] += 1;
    if (row.relationshipDisposition === 'processed') relationshipProcessedCount += 1;
    else relationshipNotApplicableCount += 1;
    addressHash.update(`${row.address}\n`);
    universeHash.update(`${row.address}:${row.universeRecordSha256}\n`);
    relationshipHash.update(`${row.address}:${row.relationshipInputSha256}\n`);
    graphHash.update(`${row.address}:${row.graphRecordSha256}\n`);
    userInterfaceHash.update(`${row.address}:${row.userInterfaceRecordSha256}\n`);
  }
  return {
    count,
    byKind,
    relationshipProcessedCount,
    relationshipNotApplicableCount,
    representedAddressSetSha256: addressHash.digest('hex'),
    universePointerSetSha256: universeHash.digest('hex'),
    relationshipInputPointerSetSha256: relationshipHash.digest('hex'),
    graphPointerSetSha256: graphHash.digest('hex'),
    userInterfacePointerSetSha256: userInterfaceHash.digest('hex'),
  };
};

export const assertLedgerAudit = (audit: LedgerAudit, receipts: CaseGraphV2LineageReceipts) => {
  const accounting = receipts.accounting;
  if (audit.count !== accounting.representedTotal
    || !sameKindCounts(audit.byKind, accounting.capturedByKind)
    || audit.relationshipProcessedCount !== accounting.relationshipProcessedTotal
    || audit.relationshipNotApplicableCount !== accounting.relationshipNotApplicableTotal
    || audit.representedAddressSetSha256 !== accounting.representedAddressSetSha256
    || audit.universePointerSetSha256 !== accounting.universePointerSetSha256
    || audit.relationshipInputPointerSetSha256 !== accounting.relationshipInputPointerSetSha256
    || audit.graphPointerSetSha256 !== accounting.graphPointerSetSha256
    || audit.userInterfacePointerSetSha256 !== accounting.userInterfacePointerSetSha256) {
    throw new Error('case_graph_v2_record_ledger_receipt_mismatch');
  }
};

export const insertLedgerBatch = async (
  client: PostgresCaseGraphV2TransactionClient,
  rows: LedgerRow[],
  schema: string,
) => {
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 11;
    values.push(
      row.corpusVersion,
      row.address,
      row.entityKind,
      row.entityId,
      row.universeRecordSha256,
      row.relationshipInputSha256,
      row.graphRecordSha256,
      row.userInterfaceRecordSha256,
      row.relationshipDisposition,
      row.notApplicableReason,
      row.lastRunId,
    );
    return `(${Array.from({ length: 11 }, (_item, field) => `$${offset + field + 1}`).join(', ')})`;
  });
  await queryRows(client, `
    INSERT INTO public.uap_case_graph_record_state (
      corpus_version, address, entity_kind, entity_id, universe_record_sha256,
      relationship_input_sha256, graph_record_sha256, user_interface_record_sha256,
      relationship_disposition, not_applicable_reason, last_run_id
    ) VALUES ${tuples.join(', ')}
    ON CONFLICT (corpus_version, address) DO NOTHING
  `, values);
  const stored = await queryRows(client, `
    SELECT
      corpus_version, address, entity_kind, entity_id, universe_record_sha256,
      relationship_input_sha256, graph_record_sha256, user_interface_record_sha256,
      relationship_disposition, not_applicable_reason, last_run_id::text AS last_run_id
    FROM public.uap_case_graph_record_state
    WHERE corpus_version = $1 AND address = ANY($2::text[])
    ORDER BY address COLLATE "C"
  `, [rows[0].corpusVersion, rows.map((row) => row.address)]);
  if (stored.length !== rows.length) throw new Error('case_graph_v2_record_ledger_batch_incomplete');
  for (let index = 0; index < rows.length; index += 1) {
    const expected = rows[index];
    const actual = stored[index];
    for (const [key, value] of Object.entries({
      corpus_version: expected.corpusVersion,
      address: expected.address,
      entity_kind: expected.entityKind,
      entity_id: expected.entityId,
      universe_record_sha256: expected.universeRecordSha256,
      relationship_input_sha256: expected.relationshipInputSha256,
      graph_record_sha256: expected.graphRecordSha256,
      user_interface_record_sha256: expected.userInterfaceRecordSha256,
      relationship_disposition: expected.relationshipDisposition,
      not_applicable_reason: expected.notApplicableReason,
      last_run_id: expected.lastRunId,
    })) {
      if (actual[key] !== value) throw new Error(`case_graph_v2_record_ledger_immutable_conflict:${expected.address}`);
    }
  }
};
