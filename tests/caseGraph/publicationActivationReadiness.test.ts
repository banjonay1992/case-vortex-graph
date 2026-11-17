import { describe, expect, it } from 'vitest';

import type { CaseGraphV2PublicationCandidate } from '../../src/caseGraph/postgresCaseGraphControlPlaneV2';
import {
  assertCaseVortexCandidateActivationReadiness,
  assertCaseVortexActivePublicationReconciliationReadiness,
  assertCaseVortexCandidateServingProjections,
  assertCaseVortexFirstPublicationRecoveryMigration,
  assertCaseVortexFirstPublicationRecoverySignature,
  assertCaseVortexProspectiveFirstPublicationRecovery,
  CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL,
  CASE_VORTEX_ACTIVE_SERVING_PROJECTIONS_SQL,
  CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_MIGRATION_SQL,
  CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL,
  CASE_VORTEX_PROSPECTIVE_FIRST_PUBLICATION_RECOVERY_SQL,
} from '../../src/caseGraph/publicationActivationReadiness';

const candidate: CaseGraphV2PublicationCandidate = {
  publicationId: '20000000-0000-4000-8000-000000000002',
  runId: '10000000-0000-4000-8000-000000000001',
  corpusVersion: '2026-08-10-v2',
  publicManifestKey: 'case-vortex/publications/2026-08-10-v2/public-manifest.json',
  publicManifestSha256: 'a'.repeat(64),
};

const readyRehearsal = (readOnly: boolean) => ({
  transaction_read_only: readOnly,
  total_publication_count: '1',
  active_publication_count: '0',
  publication_id: candidate.publicationId,
  corpus_version: candidate.corpusVersion,
  public_manifest_sha256: candidate.publicManifestSha256,
  active: false,
  activated_at: null,
  deactivated_at: null,
  verified_v2: true,
});

const readyProjections = {
  research_search_verified: true,
  retained_influence_verified: true,
  content_search_verified: true,
  claim_evidence_verified: true,
  external_correlations_complete: true,
};

const readyRecoverySignature = {
  present: true,
  recovery_function_present: true,
  publication_trigger_singleton: true,
  publication_trigger_enabled: true,
  publication_trigger_before_insert_update_row: true,
  publication_trigger_function: true,
};

describe('Case Vortex candidate activation readiness', () => {
  it('binds every serving projection to the inactive candidate instead of the current active publication', () => {
    expect(CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL).toContain('publication.id = $1::uuid');
    expect(CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL).toContain('publication.active = false');
    expect(CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL).toContain('publication.activated_at IS NULL');
    expect(CASE_VORTEX_CANDIDATE_SERVING_PROJECTIONS_SQL).toContain('case_vortex_retained_influence_builds');
  });

  it('rejects a missing candidate projection before any active switch can be attempted', async () => {
    await expect(assertCaseVortexCandidateServingProjections({
      query: async () => ({ rows: [{ ...readyProjections, content_search_verified: false }] }),
    }, candidate)).rejects.toThrow('case_vortex_candidate_serving_projections_unready');
  });

  it('requires a read-only, sole-inactive-candidate recovery rehearsal', async () => {
    await expect(assertCaseVortexProspectiveFirstPublicationRecovery({
      query: async () => ({ rows: [readyRehearsal(false)] }),
    }, candidate, true)).rejects.toThrow('case_vortex_first_publication_recovery_rehearsal_unready');

    await expect(assertCaseVortexProspectiveFirstPublicationRecovery({
      query: async () => ({ rows: [readyRehearsal(true)] }),
    }, candidate, true)).resolves.toBeUndefined();
    expect(CASE_VORTEX_PROSPECTIVE_FIRST_PUBLICATION_RECOVERY_SQL)
      .toContain("current_setting('transaction_read_only') = 'on'");
  });

  it('requires the 0235 function, constrained privileges, and exact enabled publication trigger', async () => {
    await expect(assertCaseVortexFirstPublicationRecoverySignature({
      query: async () => ({ rows: [{ ...readyRecoverySignature, present: false }] }),
    })).rejects.toThrow('case_vortex_first_publication_recovery_schema_unavailable');
    await expect(assertCaseVortexFirstPublicationRecoverySignature({
      query: async () => ({ rows: [readyRecoverySignature] }),
    })).resolves.toBeUndefined();
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL)
      .toContain('deactivate_first_uap_case_graph_publication_v1(uuid,text,text)');
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL).toContain('pg_catalog.pg_trigger');
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL).toContain("trigger.tgenabled = 'O'");
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL).toContain('trigger.tgtype = 23');
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL).toContain('trigger.tgfoid = pg_catalog.to_regprocedure');
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_SIGNATURE_SQL)
      .toContain("'public.uap_case_graph_publications'");
  });

  it.each([
    ['missing', { publication_trigger_singleton: false }],
    ['dropped', { publication_trigger_singleton: false }],
    ['disabled', { publication_trigger_enabled: false }],
    ['wrong target', { publication_trigger_singleton: false }],
    ['wrong function', { publication_trigger_function: false }],
  ])('fails closed when the publication trigger is %s', async (_state, invalidField) => {
    await expect(assertCaseVortexFirstPublicationRecoverySignature({
      // The catalog query decomposes each exact trigger property; a forged
      // aggregate `present` flag cannot hide an invalid catalog state.
      query: async () => ({ rows: [{ ...readyRecoverySignature, ...invalidField }] }),
    })).rejects.toThrow('case_vortex_first_publication_recovery_schema_unavailable');
  });

  it('requires both migration ledgers to record the exact 0235 artifact', async () => {
    await expect(assertCaseVortexFirstPublicationRecoveryMigration({
      query: async () => ({ rows: [{ present: false }] }),
    })).rejects.toThrow('case_vortex_first_publication_recovery_migration_unavailable');
    await expect(assertCaseVortexFirstPublicationRecoveryMigration({
      query: async () => ({ rows: [{ present: true }] }),
    })).resolves.toBeUndefined();
    expect(CASE_VORTEX_FIRST_PUBLICATION_RECOVERY_MIGRATION_SQL)
      .toContain('0235_case_vortex_first_publication_deactivation_2026_08_10.sql');
  });

  it('checks signature, prospective recovery, then serving projections under the activation lock', async () => {
    const calls: string[] = [];
    await expect(assertCaseVortexCandidateActivationReadiness({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('first_publication_recovery:migration_0235')) return { rows: [{ present: true }] };
        if (sql.includes('first_publication_recovery:signature')) return { rows: [readyRecoverySignature] };
        if (sql.includes('prospective_activation_rehearsal')) return { rows: [readyRehearsal(false)] };
        return { rows: [readyProjections] };
      },
    }, candidate)).resolves.toBeUndefined();
    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain('first_publication_recovery:migration_0235');
    expect(calls[1]).toContain('first_publication_recovery:signature');
    expect(calls[2]).toContain('prospective_activation_rehearsal');
    expect(calls[3]).toContain('candidate_serving_projections:pre_activation');
  });

  it('uses active serving gates—but no prospective first-activation rehearsal—when reconciling a receipt retry', async () => {
    const calls: string[] = [];
    await expect(assertCaseVortexActivePublicationReconciliationReadiness({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('first_publication_recovery:migration_0235')) return { rows: [{ present: true }] };
        if (sql.includes('first_publication_recovery:signature')) return { rows: [readyRecoverySignature] };
        return { rows: [readyProjections] };
      },
    }, candidate)).resolves.toBeUndefined();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('candidate_serving_projections:active_reconciliation');
    expect(CASE_VORTEX_ACTIVE_SERVING_PROJECTIONS_SQL).toContain('publication.active = true');
  });
});
