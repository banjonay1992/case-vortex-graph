import {
  caseGraphResearchPublicationBinding,
  type CaseGraphResearchSearchCandidates,
  type CaseGraphResearchSearchProvider,
} from './researchToolContract';
import type { ActiveCaseGraphPublication } from './publicAccess';
import type { RetainedCorpusInfluenceReceipt } from './retainedCorpusInfluence';

export const RETAINED_INFLUENCE_POSTGRES_SCHEMA_VERSION =
  'case-vortex-retained-influence-postgres-v1' as const;
export const RETAINED_INFLUENCE_POSTGRES_PROJECTION_POLICY_VERSION =
  'case-vortex-retained-influence-projection-v1' as const;
export const RETAINED_INFLUENCE_POSTGRES_QUERY_TIMEOUT_MS = 10_000;
export const RETAINED_INFLUENCE_POSTGRES_BUILD_TIMEOUT_MS = 15 * 60_000;

const SHA256 = /^[a-f0-9]{64}$/;
const SIGNAL_ID = /^retained-signal:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const fail = (code: string): never => { throw new Error(code); };
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const text = (value: unknown, maximum: number, code: string) => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maximum) {
    return fail(code);
  }
  return value.trim();
};
const digest = (value: unknown, code: string) => {
  const normalized = text(value, 64, code).toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
};
const count = (value: unknown, code: string) => {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) fail(code);
  return Number(parsed);
};

export type RetainedInfluencePostgresSourceManifestEntry = {
  source: string;
  lane: 'discovery_signal' | 'metadata_lead';
  projectionPolicy: 'derived_features_only' | 'metadata_and_source_link_only';
  rowCount: number;
};

export type RetainedInfluencePostgresQueryOptions = {
  statementTimeoutMs: number;
  queryTimeoutMs: number;
  signal?: AbortSignal;
};

export type RetainedInfluencePostgresQuery = (
  sql: string,
  params: readonly unknown[],
  options: RetainedInfluencePostgresQueryOptions,
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export const retainedInfluencePostgresSourceManifest = (
  receipt: RetainedCorpusInfluenceReceipt,
): RetainedInfluencePostgresSourceManifestEntry[] => {
  const manifest = receipt.sources
    .filter(({ influenceLane }) => (
      influenceLane === 'discovery_signal' || influenceLane === 'metadata_lead'
    ))
    .map((source) => ({
      source: source.normalizedSource,
      lane: source.influenceLane as 'discovery_signal' | 'metadata_lead',
      projectionPolicy: source.influenceLane === 'discovery_signal'
        ? 'derived_features_only' as const
        : 'metadata_and_source_link_only' as const,
      rowCount: source.rowCount,
    }))
    .sort((left, right) => compare(left.source, right.source));
  if (!manifest.length
    || new Set(manifest.map(({ source }) => source)).size !== manifest.length
    || manifest.some(({ source, rowCount }) => (
      !/^[A-Z0-9][A-Z0-9._:/-]{0,239}$/.test(source)
      || !Number.isSafeInteger(rowCount) || rowCount < 0
    ))) fail('retained_influence_postgres_manifest_invalid');
  const discovery = manifest
    .filter(({ lane }) => lane === 'discovery_signal')
    .reduce((sum, source) => sum + source.rowCount, 0);
  const metadata = manifest
    .filter(({ lane }) => lane === 'metadata_lead')
    .reduce((sum, source) => sum + source.rowCount, 0);
  if (discovery !== receipt.influenceLaneCounts.discovery_signal
    || metadata !== receipt.influenceLaneCounts.metadata_lead) {
    fail('retained_influence_postgres_manifest_accounting_mismatch');
  }
  return manifest;
};

export type RetainedInfluencePostgresBuildReceipt = {
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
  influenceReceiptSha256: string;
  discoverySignalCount: number;
  metadataLeadCount: number;
  entrySetSha256: string;
  projectionSetSha256: string;
};

export type RetainedInfluencePostgresBuildBinding = {
  publicationId: string;
  corpusVersion: string;
  publicManifestSha256: string;
};

export const buildRetainedInfluencePostgresIndexForBinding = async (params: {
  binding: RetainedInfluencePostgresBuildBinding;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
  query: RetainedInfluencePostgresQuery;
  signal?: AbortSignal;
}): Promise<RetainedInfluencePostgresBuildReceipt> => {
  const publicationId = text(
    params.binding.publicationId,
    36,
    'retained_influence_postgres_build_binding_invalid',
  ).toLowerCase();
  const corpusVersion = text(
    params.binding.corpusVersion,
    120,
    'retained_influence_postgres_build_binding_invalid',
  );
  const publicManifestSha256 = digest(
    params.binding.publicManifestSha256,
    'retained_influence_postgres_build_binding_invalid',
  );
  if (!UUID.test(publicationId)) fail('retained_influence_postgres_build_binding_invalid');
  const manifest = retainedInfluencePostgresSourceManifest(params.influenceReceipt);
  const result = await params.query(
    `SELECT public.build_case_vortex_retained_influence_index(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::jsonb
    ) AS receipt`,
    [
      publicationId,
      publicManifestSha256,
      params.influenceReceipt.receiptSha256,
      params.influenceReceipt.boundCensus.receiptSha256,
      params.influenceReceipt.boundCensus.sourceMvccSnapshot,
      JSON.stringify(manifest),
    ],
    {
      statementTimeoutMs: RETAINED_INFLUENCE_POSTGRES_BUILD_TIMEOUT_MS,
      queryTimeoutMs: RETAINED_INFLUENCE_POSTGRES_BUILD_TIMEOUT_MS + 5_000,
      signal: params.signal,
    },
  );
  if (result.rows.length !== 1 || !isObject(result.rows[0]?.receipt)) {
    return fail('retained_influence_postgres_build_receipt_invalid');
  }
  const raw = result.rows[0].receipt;
  const receipt = {
    publicationId: text(raw.publicationId, 36, 'retained_influence_postgres_build_receipt_invalid')
      .toLowerCase(),
    corpusVersion: text(raw.corpusVersion, 120, 'retained_influence_postgres_build_receipt_invalid'),
    publicManifestSha256: digest(raw.publicManifestSha256, 'retained_influence_postgres_build_receipt_invalid'),
    influenceReceiptSha256: digest(raw.influenceReceiptSha256, 'retained_influence_postgres_build_receipt_invalid'),
    discoverySignalCount: count(raw.discoverySignalCount, 'retained_influence_postgres_build_receipt_invalid'),
    metadataLeadCount: count(raw.metadataLeadCount, 'retained_influence_postgres_build_receipt_invalid'),
    entrySetSha256: digest(raw.entrySetSha256, 'retained_influence_postgres_build_receipt_invalid'),
    projectionSetSha256: digest(raw.projectionSetSha256, 'retained_influence_postgres_build_receipt_invalid'),
  };
  if (!UUID.test(receipt.publicationId)
    || receipt.publicationId !== publicationId
    || receipt.corpusVersion !== corpusVersion
    || receipt.publicManifestSha256 !== publicManifestSha256
    || receipt.influenceReceiptSha256 !== params.influenceReceipt.receiptSha256
    || receipt.discoverySignalCount !== params.influenceReceipt.influenceLaneCounts.discovery_signal
    || receipt.metadataLeadCount !== params.influenceReceipt.influenceLaneCounts.metadata_lead) {
    return fail('retained_influence_postgres_build_receipt_mismatch');
  }
  return receipt;
};

export const buildRetainedInfluencePostgresIndex = async (params: {
  active: ActiveCaseGraphPublication;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
  query: RetainedInfluencePostgresQuery;
  signal?: AbortSignal;
}): Promise<RetainedInfluencePostgresBuildReceipt> => {
  const binding = caseGraphResearchPublicationBinding(params.active);
  return buildRetainedInfluencePostgresIndexForBinding({
    binding: {
      publicationId: binding.publicationId,
      corpusVersion: binding.corpusVersion,
      publicManifestSha256: binding.manifestSha256,
    },
    influenceReceipt: params.influenceReceipt,
    query: params.query,
    signal: params.signal,
  });
};

export type RetainedInfluencePostgresPreflight = {
  verified: true;
  projectionSetSha256: string;
  discoverySignalCount: number;
  metadataLeadCount: number;
};

export const inspectPostgresRetainedInfluenceServing = async (params: {
  active: ActiveCaseGraphPublication;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
  query: RetainedInfluencePostgresQuery;
  signal?: AbortSignal;
}): Promise<RetainedInfluencePostgresPreflight> => {
  const binding = caseGraphResearchPublicationBinding(params.active);
  const result = await params.query(
    `SELECT build.projection_set_sha256, build.indexed_discovery_signal_count,
      build.indexed_metadata_lead_count
    FROM public.case_vortex_retained_influence_builds AS build
    JOIN public.uap_case_graph_publications AS publication
      ON publication.id = build.publication_id
    WHERE build.publication_id = $1::uuid
      AND build.public_manifest_sha256 = $2::text
      AND build.influence_receipt_sha256 = $3::text
      AND build.status = 'verified'
      AND publication.active = true
      AND publication.public_manifest_sha256 = $2::text`,
    [binding.publicationId, binding.manifestSha256, params.influenceReceipt.receiptSha256],
    {
      statementTimeoutMs: 1_500,
      queryTimeoutMs: 2_000,
      signal: params.signal,
    },
  );
  if (result.rows.length !== 1) fail('retained_influence_postgres_unavailable');
  const row = result.rows[0];
  const ready = {
    projectionSetSha256: digest(
      row.projection_set_sha256,
      'retained_influence_postgres_preflight_invalid',
    ),
    discoverySignalCount: count(
      row.indexed_discovery_signal_count,
      'retained_influence_postgres_preflight_invalid',
    ),
    metadataLeadCount: count(
      row.indexed_metadata_lead_count,
      'retained_influence_postgres_preflight_invalid',
    ),
  };
  if (ready.discoverySignalCount !== params.influenceReceipt.influenceLaneCounts.discovery_signal
    || ready.metadataLeadCount !== params.influenceReceipt.influenceLaneCounts.metadata_lead) {
    fail('retained_influence_postgres_preflight_accounting_mismatch');
  }
  return { verified: true, ...ready };
};

export const createPostgresRetainedInfluenceSearchProvider = (params: {
  evidenceSearch: CaseGraphResearchSearchProvider;
  influenceReceipt: RetainedCorpusInfluenceReceipt;
  query: RetainedInfluencePostgresQuery;
}): CaseGraphResearchSearchProvider => async (providerParams) => {
  const evidence = await params.evidenceSearch(providerParams);
  if (providerParams.request.cursor !== null) return evidence;
  const ready = await inspectPostgresRetainedInfluenceServing({
    active: providerParams.active,
    influenceReceipt: params.influenceReceipt,
    query: params.query,
    signal: providerParams.signal,
  });
  const binding = caseGraphResearchPublicationBinding(providerParams.active);
  const result = await params.query(
    `SELECT * FROM public.search_case_vortex_retained_influence(
      $1::uuid,$2::text,$3::text,$4::text,$5::text[],$6::text[],
      $7::timestamptz,$8::timestamptz,$9::integer
    )`,
    [
      binding.publicationId,
      binding.manifestSha256,
      params.influenceReceipt.receiptSha256,
      providerParams.request.query,
      providerParams.request.filters.sources,
      providerParams.request.filters.kinds,
      providerParams.request.filters.eventStart,
      providerParams.request.filters.eventEnd,
      providerParams.request.limit,
    ],
    {
      statementTimeoutMs: RETAINED_INFLUENCE_POSTGRES_QUERY_TIMEOUT_MS,
      queryTimeoutMs: RETAINED_INFLUENCE_POSTGRES_QUERY_TIMEOUT_MS + 1_000,
      signal: providerParams.signal,
    },
  );
  let matchedDiscoverySignalCount = 0;
  let matchedMetadataLeadCount = 0;
  let previousScore = Number.POSITIVE_INFINITY;
  let previousSignalId = '';
  const signals = result.rows.map((row, index) => {
    const code = 'retained_influence_postgres_search_result_invalid';
    const signalId = text(row.signal_id, 90, code);
    const lane = text(row.lane, 40, code);
    const kind = text(row.kind, 40, code);
    const score = Number(row.score);
    const projectionDigest = digest(row.projection_digest, code);
    if (!SIGNAL_ID.test(signalId)
      || !['discovery_signal', 'metadata_lead'].includes(lane)
      || !['sighting', 'document', 'photo', 'video'].includes(kind)
      || !Number.isFinite(score) || score < 0
      || (index > 0 && (
        Math.min(1, score) > previousScore
        || (Math.min(1, score) === previousScore
          && signalId <= previousSignalId)
      ))) fail(code);
    previousScore = Math.min(1, score);
    previousSignalId = signalId;
    const rowDiscoveryCount = count(row.matched_discovery_signal_count, code);
    const rowMetadataCount = count(row.matched_metadata_lead_count, code);
    if (index === 0) {
      matchedDiscoverySignalCount = rowDiscoveryCount;
      matchedMetadataLeadCount = rowMetadataCount;
    } else if (rowDiscoveryCount !== matchedDiscoverySignalCount
      || rowMetadataCount !== matchedMetadataLeadCount) fail(code);
    if (digest(row.influence_receipt_sha256, code) !== params.influenceReceipt.receiptSha256
      || digest(row.index_sha256, code) !== ready.projectionSetSha256) fail(code);
    const eventTimestamp = row.event_timestamp == null
      ? null : text(row.event_timestamp, 80, code);
    if (eventTimestamp && !Number.isFinite(new Date(eventTimestamp).getTime())) fail(code);
    const location = row.generalized_location == null
      ? null : text(row.generalized_location, 500, code);
    return {
      signalId,
      lane: lane as 'discovery_signal' | 'metadata_lead',
      kind: kind as 'sighting' | 'document' | 'photo' | 'video',
      source: text(row.source, 250, code),
      label: lane === 'discovery_signal'
        ? `Derived pattern signal from ${text(row.source, 250, code)}`
        : `${text(row.source, 250, code)} ${kind} research lead`,
      eventTimestamp,
      location,
      score: Math.min(1, score),
      reasonCodes: [
        lane === 'discovery_signal'
          ? 'derived_features_only'
          : 'metadata_and_source_link_only',
        'non_citable_retained_influence',
        'zero_independent_corroboration_credit',
      ].sort(compare),
      projectionDigest,
    };
  });
  const retainedInfluence: NonNullable<
    CaseGraphResearchSearchCandidates['retainedInfluence']
  > = {
    schemaVersion: 'case-vortex-retained-influence-search-v1',
    influenceReceiptSha256: params.influenceReceipt.receiptSha256,
    indexSha256: ready.projectionSetSha256,
    signals,
    accounting: {
      retainedRecordCount: params.influenceReceipt.accounting.retainedRecordCount,
      evidenceRecordCount: params.influenceReceipt.influenceLaneCounts.evidence,
      discoverySignalRecordCount: ready.discoverySignalCount,
      metadataLeadRecordCount: ready.metadataLeadCount,
      coverageGapRecordCount: params.influenceReceipt.influenceLaneCounts.coverage_gap,
      matchedDiscoverySignalCount,
      matchedMetadataLeadCount,
      returnedSignalCount: signals.length,
      truncated: matchedDiscoverySignalCount + matchedMetadataLeadCount > signals.length,
    },
    limitations: [
      'Discovery signals and metadata leads are not evidence and cannot be cited.',
      'Derived or shared-lineage material receives zero independent-corroboration credit.',
      'Coverage-gap records affect uncertainty but expose no restricted or unverified content.',
      'The retained influence index covers every discovery-signal and metadata-lead record.',
      'Query-matched retained influence signals are returned only on the first evidence-results page.',
    ],
  };
  return { ...evidence, retainedInfluence };
};
