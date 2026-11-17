import { createHash } from 'node:crypto';

import {
  decodeRetainedInfluenceServingBundle,
} from './retainedInfluenceServing';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  buildCaseVortexRollbackRehearsalPlan,
  type CaseVortexRollbackPublication,
} from './rollbackRehearsalReview';

export const CASE_VORTEX_ROLLBACK_PREFLIGHT_VERSION =
  'case-vortex-rollback-rehearsal-preflight-v1' as const;

type MigrationState = 'aligned' | 'missing' | 'tracker_disagreement'
  | 'ledger_schema_drift' | 'untracked_schema';

export type CaseVortexRollbackPreflightPublicationRow = {
  publicationId: string;
  corpusVersion: string;
  manifestSha256: string;
  active: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
  verifiedV2: boolean;
};

export type CaseVortexRollbackPreflightReadiness = {
  serverVersionNum: number;
  transactionReadOnly: boolean;
  observedAt: string;
  migrationStates: Record<'0213' | '0214' | '0215' | '0216' | '0217', MigrationState>;
  publications: CaseVortexRollbackPreflightPublicationRow[];
};

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

const timestamp = (value: string | null) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('case_vortex_rollback_preflight_timestamp_invalid');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('case_vortex_rollback_preflight_timestamp_invalid');
  }
  return parsed.toISOString();
};

const publication = (
  value: CaseVortexRollbackPreflightPublicationRow,
): CaseVortexRollbackPreflightPublicationRow => {
  if (!value || !UUID.test(value.publicationId)
    || !VERSION.test(value.corpusVersion)
    || !SHA256.test(value.manifestSha256)
    || typeof value.active !== 'boolean'
    || typeof value.verifiedV2 !== 'boolean') {
    throw new Error('case_vortex_rollback_preflight_publication_invalid');
  }
  return {
    ...value,
    activatedAt: timestamp(value.activatedAt),
    deactivatedAt: timestamp(value.deactivatedAt),
  };
};

const pairPublication = (
  value: CaseVortexRollbackPreflightPublicationRow,
): CaseVortexRollbackPublication => ({
  publicationId: value.publicationId,
  corpusVersion: value.corpusVersion,
  manifestSha256: value.manifestSha256,
});

export const buildCaseVortexRollbackRehearsalPreflight = (input: {
  bundleBody: Buffer;
  readiness: CaseVortexRollbackPreflightReadiness;
  environmentId: string;
}) => {
  const bundle = decodeRetainedInfluenceServingBundle(input.bundleBody);
  const influence = bundle.influenceReceipt;
  const blockers: string[] = [];
  if (!input.environmentId.trim() || input.environmentId.length > 200
    || !Number.isSafeInteger(input.readiness.serverVersionNum)
    || !input.readiness.observedAt.trim()) {
    throw new Error('case_vortex_rollback_preflight_input_invalid');
  }
  const observedAt = timestamp(input.readiness.observedAt);
  if (!input.readiness.transactionReadOnly) {
    blockers.push('database:transaction_not_read_only');
  }
  if (input.readiness.serverVersionNum < 170_000) {
    blockers.push('database:postgres_17_required');
  }
  for (const version of ['0213', '0214', '0215', '0216', '0217'] as const) {
    const state = input.readiness.migrationStates[version];
    if (!['aligned', 'missing', 'tracker_disagreement', 'ledger_schema_drift', 'untracked_schema']
      .includes(state)) {
      throw new Error('case_vortex_rollback_preflight_migration_state_invalid');
    }
    if (state !== 'aligned') blockers.push(`database:migration_${version}_${state}`);
  }
  if (influence.accounting.silentlyDiscardedRecordCount !== 0
    || influence.accounting.influencedRecordCount
      !== influence.accounting.retainedRecordCount
    || !influence.guarantees.everyRetainedRecordInfluencesAtLeastOneLane) {
    blockers.push('bundle:all_retained_influence_unverified');
  }

  const rows = input.readiness.publications.map(publication);
  if (new Set(rows.map(({ publicationId }) => publicationId)).size !== rows.length) {
    throw new Error('case_vortex_rollback_preflight_publication_duplicate');
  }
  const activePublicationCount = rows.filter(({ active }) => active).length;
  if (activePublicationCount !== 0) blockers.push('database:active_publication_must_be_zero');
  const priorRows = rows.filter((row) => (
    row.verifiedV2 && !row.active && row.activatedAt !== null && row.deactivatedAt !== null
  ));
  const candidateRows = rows.filter((row) => (
    row.verifiedV2 && !row.active && row.activatedAt === null && row.deactivatedAt === null
  ));
  if (priorRows.length !== 1) {
    blockers.push(priorRows.length === 0
      ? 'database:prior_publication_missing'
      : 'database:prior_publication_ambiguous');
  }
  if (candidateRows.length !== 1) {
    blockers.push(candidateRows.length === 0
      ? 'database:candidate_publication_missing'
      : 'database:candidate_publication_ambiguous');
  }
  const pair = priorRows.length === 1 && candidateRows.length === 1
    ? {
        prior: pairPublication(priorRows[0]),
        candidate: pairPublication(candidateRows[0]),
      }
    : null;
  let plan = null;
  if (pair) {
    try {
      plan = buildCaseVortexRollbackRehearsalPlan({
        planId: `rollback-preflight:${pair.candidate.publicationId}:${pair.prior.publicationId}`,
        candidate: pair.candidate,
        prior: pair.prior,
      });
    } catch {
      blockers.push('database:publication_pair_not_distinct');
    }
  }
  const body = {
    recordType: 'case_vortex_rollback_rehearsal_preflight' as const,
    schemaVersion: CASE_VORTEX_ROLLBACK_PREFLIGHT_VERSION,
    observedAt,
    environmentId: input.environmentId.trim(),
    database: {
      serverVersionNum: input.readiness.serverVersionNum,
      transactionReadOnly: input.readiness.transactionReadOnly,
      migrationStates: input.readiness.migrationStates,
      publicationCount: rows.length,
      activePublicationCount,
      verifiedV2PublicationCount: rows.filter(({ verifiedV2 }) => verifiedV2).length,
      eligiblePriorCount: priorRows.length,
      eligibleCandidateCount: candidateRows.length,
    },
    influenceBinding: {
      bundleSha256: sha256(input.bundleBody),
      influenceReceiptSha256: influence.receiptSha256,
      retainedRecordCount: influence.accounting.retainedRecordCount,
      influencedRecordCount: influence.accounting.influencedRecordCount,
      silentlyDiscardedRecordCount: influence.accounting.silentlyDiscardedRecordCount,
      evidenceCount: influence.influenceLaneCounts.evidence,
      discoverySignalCount: influence.influenceLaneCounts.discovery_signal,
      metadataLeadCount: influence.influenceLaneCounts.metadata_lead,
      coverageGapCount: influence.influenceLaneCounts.coverage_gap,
    },
    pair,
    plan,
    readyForR2ReplayAndEphemeralRehearsal: blockers.length === 0 && plan !== null,
    blockers,
    authority: {
      configuredDatabaseMutationApproved: false as const,
      storageWriteApproved: false as const,
      publicationActivationApproved: false as const,
      deploymentApproved: false as const,
    },
    guarantees: {
      databaseReads: 'bounded-read-only' as const,
      databaseWrites: 0 as const,
      storageReads: 0 as const,
      storageWrites: 0 as const,
      lunaCalls: 0 as const,
      publicationMutations: 0 as const,
      deployments: 0 as const,
    },
  };
  return { ...body, preflightSha256: relationshipInputSha256(body) };
};
