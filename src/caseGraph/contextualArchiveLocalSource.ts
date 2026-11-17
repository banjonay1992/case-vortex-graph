import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import {
  decodeGovernedContextualSourcePage,
  decodeGovernedContextualSourceSnapshot,
  type GovernedContextualObservationSource,
  type GovernedContextualSourcePage,
  type GovernedContextualSourceSnapshot,
} from './contextualObservationArchive';
import {
  CONTEXTUAL_SOURCE_FAMILIES,
  decodeContextualSourceSnapshotPlan,
  type ContextualSourceFamily,
  type ContextualSourceSnapshotPlan,
} from './contextualSourceMaterializationCensus';
import {
  canonicalizeRelationshipInput,
  relationshipInputSha256,
} from './relationshipInputSnapshot';

export const CONTEXTUAL_ARCHIVE_LOCAL_SOURCE_MANIFEST_VERSION =
  'case-vortex-contextual-archive-local-source-manifest-v1' as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/u;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_BYTES = 64 * 1024 * 1024;
const fail = (code: string): never => { throw new Error(code); };
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[], code: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
};
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const digest = (value: unknown, code: string) => {
  const normalized = typeof value === 'string' ? value : fail(code);
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
};
const count = (value: unknown, code: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(code);
  return value as number;
};
const cursor = (value: unknown, code: string) => {
  if (value === null) return null;
  const normalized = typeof value === 'string' ? value : fail(code);
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > 512
    || /[\u0000-\u001f\u007f]/u.test(normalized)) fail(code);
  return normalized;
};

export type ContextualArchiveLocalSourcePageReceipt = {
  pageNumber: number;
  cursor: string | null;
  nextCursor: string | null;
  relativePath: string;
  bytes: number;
  canonicalSha256: string;
  rowCount: number;
  pageDigest: string;
};

export type ContextualArchiveLocalSourceManifest = {
  recordType: 'contextual_archive_local_source_manifest';
  schemaVersion: typeof CONTEXTUAL_ARCHIVE_LOCAL_SOURCE_MANIFEST_VERSION;
  sourceFamily: ContextualSourceFamily;
  planDigest: string;
  snapshot: GovernedContextualSourceSnapshot;
  pages: ContextualArchiveLocalSourcePageReceipt[];
  accounting: {
    observedRecordCount: number;
    coveredSubjectCount: number;
    coveredSubjectAddressSetSha256: string;
    sourceRowDigestSetSha256: string;
  };
  sourceContentSha256: string;
  pageSetSha256: string;
  manifestDigest: string;
};

export type StableLocalFile = {
  path: string;
  body: Buffer;
  sha256: string;
};

export type ContextualArchiveLocalSourceDependencies = {
  openFile?: typeof open;
};

export const readStableContextualArchiveLocalFile = async (
  path: string,
  maximumBytes: number,
  code: string,
  dependencies: ContextualArchiveLocalSourceDependencies = {},
): Promise<StableLocalFile> => {
  const resolved = resolve(path);
  const handle = await (dependencies.openFile || open)(
    resolved,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ELOOP') fail(code);
    throw error;
  });
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 2 || before.size > maximumBytes) fail(code);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximumBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, (maximumBytes + 1) - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, total);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > maximumBytes) fail(code);
    const after = await handle.stat();
    if (!after.isFile() || total !== before.size || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      fail(`${code}_changed`);
    }
    const body = Buffer.concat(chunks, total);
    return { path: resolved, body, sha256: sha256(body) };
  } finally {
    await handle.close();
  }
};

const decodePageReceipt = (value: unknown, expectedNumber: number) => {
  const body = plain(value) ? value : fail('contextual_archive_local_source_page_receipt_invalid');
  exact(body, [
    'pageNumber', 'cursor', 'nextCursor', 'relativePath', 'bytes', 'canonicalSha256',
    'rowCount', 'pageDigest',
  ], 'contextual_archive_local_source_page_receipt_invalid');
  const pageNumber = count(body.pageNumber, 'contextual_archive_local_source_page_receipt_invalid');
  const relativePath = typeof body.relativePath === 'string' ? body.relativePath : '';
  if (pageNumber !== expectedNumber || !SAFE_RELATIVE_PATH.test(relativePath)
    || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    fail('contextual_archive_local_source_page_receipt_invalid');
  }
  return {
    pageNumber,
    cursor: cursor(body.cursor, 'contextual_archive_local_source_page_receipt_invalid'),
    nextCursor: cursor(body.nextCursor, 'contextual_archive_local_source_page_receipt_invalid'),
    relativePath,
    bytes: count(body.bytes, 'contextual_archive_local_source_page_receipt_invalid', 2),
    canonicalSha256: digest(body.canonicalSha256, 'contextual_archive_local_source_page_receipt_invalid'),
    rowCount: count(body.rowCount, 'contextual_archive_local_source_page_receipt_invalid'),
    pageDigest: digest(body.pageDigest, 'contextual_archive_local_source_page_receipt_invalid'),
  };
};

export const decodeContextualArchiveLocalSourceManifest = (
  value: unknown,
  planInput: ContextualSourceSnapshotPlan,
): ContextualArchiveLocalSourceManifest => {
  const body = plain(value) ? value : fail('contextual_archive_local_source_manifest_invalid');
  exact(body, [
    'recordType', 'schemaVersion', 'sourceFamily', 'planDigest', 'snapshot',
    'pages', 'accounting', 'sourceContentSha256', 'pageSetSha256', 'manifestDigest',
  ], 'contextual_archive_local_source_manifest_invalid');
  const plan = decodeContextualSourceSnapshotPlan(planInput);
  if (body.recordType !== 'contextual_archive_local_source_manifest'
    || body.schemaVersion !== CONTEXTUAL_ARCHIVE_LOCAL_SOURCE_MANIFEST_VERSION
    || body.sourceFamily !== plan.sourceFamily
    || body.planDigest !== plan.planDigest
    || !Array.isArray(body.pages)
    || body.pages.length < 1) fail('contextual_archive_local_source_manifest_invalid');
  const snapshot = decodeGovernedContextualSourceSnapshot(body.snapshot, plan.targetBinding.universe);
  const pageInputs = body.pages as unknown[];
  const pages: ContextualArchiveLocalSourcePageReceipt[] = pageInputs
    .map((page, index) => decodePageReceipt(page, index));
  if (pages[0]?.cursor !== null || pages[pages.length - 1]?.nextCursor !== null
    || pages.some((page, index) => index > 0 && page.cursor !== pages[index - 1].nextCursor)
    || pages.some((page, index) => index < pages.length - 1 && page.nextCursor === null)
    || new Set(pages.map(({ cursor }) => cursor)).size !== pages.length
    || new Set(pages.map(({ relativePath }) => relativePath)).size !== pages.length
    || new Set(pages.map(({ canonicalSha256 }) => canonicalSha256)).size !== pages.length) {
    fail('contextual_archive_local_source_page_chain_invalid');
  }
  const sourceContentSha256: string = digest(
    body.sourceContentSha256,
    'contextual_archive_local_source_content_digest_invalid',
  );
  const pageSetSha256 = digest(
    body.pageSetSha256,
    'contextual_archive_local_source_page_set_digest_invalid',
  );
  const productionPageSetSha256 = relationshipInputSha256(pages.map((page) => (
    `${page.pageNumber}:${JSON.stringify(page.cursor)}:${JSON.stringify(page.nextCursor)}:${page.rowCount}:${page.pageDigest}`
  )).join('\n'));
  if (pageSetSha256 !== productionPageSetSha256
    || sourceContentSha256 !== plan.sourceIdentity.contentSha256
    || snapshot.contentSha256 !== sourceContentSha256) {
    fail('contextual_archive_local_source_content_digest_mismatch');
  }
  const accountingBody = plain(body.accounting)
    ? body.accounting : fail('contextual_archive_local_source_accounting_invalid');
  exact(accountingBody, [
    'observedRecordCount', 'coveredSubjectCount', 'coveredSubjectAddressSetSha256',
    'sourceRowDigestSetSha256',
  ], 'contextual_archive_local_source_accounting_invalid');
  const accounting = {
    observedRecordCount: count(accountingBody.observedRecordCount, 'contextual_archive_local_source_accounting_invalid', 1),
    coveredSubjectCount: count(accountingBody.coveredSubjectCount, 'contextual_archive_local_source_accounting_invalid', 1),
    coveredSubjectAddressSetSha256: digest(
      accountingBody.coveredSubjectAddressSetSha256,
      'contextual_archive_local_source_accounting_invalid',
    ),
    sourceRowDigestSetSha256: digest(
      accountingBody.sourceRowDigestSetSha256,
      'contextual_archive_local_source_accounting_invalid',
    ),
  };
  if (accounting.coveredSubjectCount > accounting.observedRecordCount) {
    fail('contextual_archive_local_source_accounting_invalid');
  }
  const withoutDigest = {
    recordType: 'contextual_archive_local_source_manifest' as const,
    schemaVersion: CONTEXTUAL_ARCHIVE_LOCAL_SOURCE_MANIFEST_VERSION,
    sourceFamily: plan.sourceFamily,
    planDigest: plan.planDigest,
    snapshot,
    pages,
    accounting,
    sourceContentSha256,
    pageSetSha256,
  };
  if (digest(body.manifestDigest, 'contextual_archive_local_source_manifest_digest_invalid')
    !== relationshipInputSha256(withoutDigest)) {
    fail('contextual_archive_local_source_manifest_digest_mismatch');
  }
  return { ...withoutDigest, manifestDigest: relationshipInputSha256(withoutDigest) };
};

const parseCanonicalJson = (file: StableLocalFile, code: string) => {
  let value: unknown;
  try {
    value = JSON.parse(file.body.toString('utf8'));
  } catch {
    fail(code);
  }
  const canonical = Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
  if (!canonical.equals(file.body)) fail(`${code}_noncanonical`);
  return value;
};

export const openContextualArchiveLocalSource = async (params: {
  manifestPath: string;
  plan: ContextualSourceSnapshotPlan;
  dependencies?: ContextualArchiveLocalSourceDependencies;
}): Promise<{
  manifest: ContextualArchiveLocalSourceManifest;
  manifestCanonicalSha256: string;
  sourceRowDigests: string[];
  source: GovernedContextualObservationSource;
}> => {
  const manifestFile = await readStableContextualArchiveLocalFile(
    params.manifestPath,
    MAX_MANIFEST_BYTES,
    'contextual_archive_local_source_manifest_file_invalid',
    params.dependencies,
  );
  const manifest = decodeContextualArchiveLocalSourceManifest(
    parseCanonicalJson(manifestFile, 'contextual_archive_local_source_manifest_json_invalid'),
    params.plan,
  );
  const base = dirname(manifestFile.path);
  const byCursor = new Map(manifest.pages.map((page) => [page.cursor, page]));
  const loadPage = async (receipt: ContextualArchiveLocalSourcePageReceipt) => {
    const path = resolve(base, receipt.relativePath);
    if (path !== base && !path.startsWith(`${base}${sep}`)) {
      fail('contextual_archive_local_source_page_path_invalid');
    }
    const file = await readStableContextualArchiveLocalFile(
      path,
      MAX_PAGE_BYTES,
      'contextual_archive_local_source_page_file_invalid',
      params.dependencies,
    );
    if (file.body.byteLength !== receipt.bytes || file.sha256 !== receipt.canonicalSha256) {
      fail('contextual_archive_local_source_page_file_digest_mismatch');
    }
    const page = decodeGovernedContextualSourcePage(
      parseCanonicalJson(file, 'contextual_archive_local_source_page_json_invalid'),
      manifest.snapshot,
      receipt.cursor,
    );
    if (page.nextCursor !== receipt.nextCursor || page.rows.length !== receipt.rowCount
      || page.pageDigest !== receipt.pageDigest) {
      fail('contextual_archive_local_source_page_receipt_mismatch');
    }
    return page;
  };
  // Approval and execution preparation must authenticate every bound local
  // page even when the remote archive is already complete and will resume
  // without invoking fetchPage. Do not cache these reads: execution fetches
  // each page again so replacement after preflight still fails closed.
  let previousSortKey: string | null = null;
  const rowDigests = new Set<string>();
  const addresses = new Set<string>();
  let observedRecordCount = 0;
  for (const receipt of manifest.pages) {
    const page = await loadPage(receipt);
    if (!page.rows.length) fail('contextual_archive_local_source_sparse_page');
    for (const row of page.rows) {
      if (previousSortKey !== null && row.sortKey <= previousSortKey) {
        fail('contextual_archive_local_source_global_order_invalid');
      }
      if (rowDigests.has(row.rowDigest)) fail('contextual_archive_local_source_duplicate_row');
      previousSortKey = row.sortKey;
      rowDigests.add(row.rowDigest);
      addresses.add(row.relationshipRecord.address);
      observedRecordCount += 1;
      if (!Number.isSafeInteger(observedRecordCount)) fail('contextual_archive_local_source_accounting_overflow');
    }
  }
  const coveredAddresses = [...addresses].sort();
  const derivedAccounting = {
    observedRecordCount,
    coveredSubjectCount: coveredAddresses.length,
    coveredSubjectAddressSetSha256: relationshipInputSha256(coveredAddresses),
    sourceRowDigestSetSha256: relationshipInputSha256([...rowDigests].sort()),
  };
  if (canonicalizeRelationshipInput(derivedAccounting)
    !== canonicalizeRelationshipInput(manifest.accounting)) {
    fail('contextual_archive_local_source_accounting_mismatch');
  }
  return {
    manifest,
    manifestCanonicalSha256: manifestFile.sha256,
    sourceRowDigests: [...rowDigests].sort(),
    source: {
      inspectSnapshot: async () => manifest.snapshot,
      fetchPage: async ({ cursor: expectedCursor, limit }) => {
        const receipt = byCursor.get(expectedCursor)
          || fail('contextual_archive_local_source_cursor_missing');
        const page: GovernedContextualSourcePage = await loadPage(receipt);
        if (page.rows.length > limit) fail('contextual_archive_local_source_page_limit_exceeded');
        return page;
      },
    },
  };
};
