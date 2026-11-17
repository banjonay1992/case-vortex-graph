import { createHmac } from 'node:crypto';

import type { ActiveCaseGraphPublication, CaseGraphPublicStorage } from './publicAccess';
import {
  caseGraphResearchPublicationBinding,
  type CaseGraphResearchContentProvider,
} from './researchToolContract';
import {
  preflightCaseGraphContentPostgresProjection,
} from './contentResearchPostgresBuild';
import { createCaseGraphContentResearchCursorCodec } from './contentResearchCursor';
import { createCaseGraphContentResearchProvider } from './contentResearchToolProvider';
import {
  createCaseGraphContentPostgresSearch,
  type CaseGraphContentPostgresQuery,
  type CaseGraphContentServingBinding,
} from './postgresContentResearchSearch';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_TIMEOUT_MS = 30_000;
const fail = (code: string): never => { throw new Error(code); };
const digest = (value: unknown) => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('case_graph_research_content_search_unavailable')
);
const count = (value: unknown) => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0) {
    fail('case_graph_research_content_search_unavailable');
  }
  return Number(numeric);
};

export const resolveCaseGraphContentResearchProvider = (
  fallback: CaseGraphResearchContentProvider | undefined,
  inspection: unknown,
) => {
  if (typeof inspection !== 'object' || inspection === null
    || (inspection as { verified?: unknown }).verified !== true) {
    throw new Error('case_graph_research_content_search_unavailable');
  }
  const preparedProvider = (inspection as { provider?: unknown }).provider;
  const provider = preparedProvider === undefined ? fallback : preparedProvider;
  if (typeof provider !== 'object' || provider === null
    || typeof (provider as CaseGraphResearchContentProvider).search !== 'function'
    || typeof (provider as CaseGraphResearchContentProvider).open !== 'function') {
    throw new Error('case_graph_research_content_search_unavailable');
  }
  return provider as CaseGraphResearchContentProvider;
};

export type PreparedCaseGraphContentResearchServing = Awaited<
  ReturnType<typeof prepareCaseGraphContentResearchServing>
>;

export const prepareCaseGraphContentResearchServing = async (params: {
  active: ActiveCaseGraphPublication;
  query: CaseGraphContentPostgresQuery;
  storage: CaseGraphPublicStorage;
  cursorSecret: string | Buffer;
  signal?: AbortSignal;
}) => {
  if (params.signal?.aborted) fail('case_graph_research_aborted');
  const publication = caseGraphResearchPublicationBinding(params.active);
  const result = await params.query(`
    SELECT accounting_receipt_digest, index_manifest_digest, expected_entry_count
    FROM public.case_graph_content_search_builds
    WHERE publication_id = $1::uuid AND public_manifest_sha256 = $2::text
      AND accounting_receipt_digest = $3::text AND status = 'verified'
    LIMIT 2
  `, [
    publication.publicationId,
    publication.manifestSha256,
    params.active.accountingReceiptSha256,
  ], {
    statementTimeoutMs: MAX_TIMEOUT_MS,
    queryTimeoutMs: MAX_TIMEOUT_MS,
    signal: params.signal,
  });
  if (result.rows.length !== 1) fail('case_graph_research_content_search_unavailable');
  const row = result.rows[0];
  const binding: CaseGraphContentServingBinding = {
    publication,
    accountingReceiptDigest: digest(row.accounting_receipt_digest),
    indexManifestDigest: digest(row.index_manifest_digest),
    expectedEntryCount: count(row.expected_entry_count),
  };
  if (binding.accountingReceiptDigest !== params.active.accountingReceiptSha256) {
    fail('case_graph_research_content_search_unavailable');
  }
  const archive = {
    putIfAbsent: async (): Promise<'written'> => fail('case_graph_research_content_archive_read_only'),
    readObject: (key: string, options: { maxBytes: number; signal?: AbortSignal }) => (
      params.storage.readObject(key, options)
    ),
  };
  const preflight = await preflightCaseGraphContentPostgresProjection({
    binding,
    query: params.query,
    archive,
    signal: params.signal,
  });
  const cursorKey = createHmac('sha256', params.cursorSecret)
    .update('case-graph-content-research-cursor-v1\0')
    .digest();
  const provider = createCaseGraphContentResearchProvider({
    search: createCaseGraphContentPostgresSearch(params.query),
    binding,
    cursorCodec: createCaseGraphContentResearchCursorCodec(cursorKey),
  });
  return { ...preflight, provider };
};
