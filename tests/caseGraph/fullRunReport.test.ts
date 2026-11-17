import { describe, expect, it } from 'vitest';

import {
  CASE_VORTEX_FULL_RUN_GATES,
  CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS,
  CASE_VORTEX_FULL_RUN_REPORT_VERSION,
  buildCaseVortexFullRunReport,
  verifyCaseVortexFullRunReport,
  type CaseVortexFullRunReportInput,
} from '../../src/caseGraph/fullRunReport';

const sha = (character: string) => character.repeat(64);
const publication = {
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  corpusVersion: '2026-07-22-v1',
  manifestSha256: sha('a'),
};

const input = (all = true): CaseVortexFullRunReportInput => ({
  recordType: 'case_vortex_full_run_report_input',
  schemaVersion: CASE_VORTEX_FULL_RUN_REPORT_VERSION,
  runId: 'full-run-2026-07-22',
  generatedAt: '2026-07-22T10:00:00.000Z',
  publication,
  evidence: (all ? CASE_VORTEX_FULL_RUN_GATES : CASE_VORTEX_FULL_RUN_GATES.slice(0, 2)).map((gate, index) => ({
    gate,
    artifactType: CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate]?.artifactType || `${gate}_receipt`,
    schemaVersion: CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate]?.schemaVersion || 'verified-v1',
    artifactSha256: index.toString(16).padStart(64, '0'),
    verifierVersion: CASE_VORTEX_FULL_RUN_REQUIRED_ARTIFACTS[gate]?.verifierVersion
      || 'case-vortex-verifier-v1',
    verifiedAt: '2026-07-22T09:00:00.000Z',
    publication,
  })),
  deployment: { status: 'not_requested' },
});

describe('Case Vortex full-run report', () => {
  it('seals every required local evidence gate but does not infer deployment completion', () => {
    const report = buildCaseVortexFullRunReport(input());
    expect(report.candidateEligible).toBe(true);
    expect(report.objectiveEligible).toBe(false);
    expect(report.missingGates).toEqual([]);
    expect(report.criteria).toHaveLength(CASE_VORTEX_FULL_RUN_GATES.length);
    expect(verifyCaseVortexFullRunReport(report)).toEqual(report);
  });

  it('retains an exact missing-gate ledger for an incomplete candidate', () => {
    const report = buildCaseVortexFullRunReport(input(false));
    expect(report.candidateEligible).toBe(false);
    expect(report.objectiveEligible).toBe(false);
    expect(report.missingGates).toEqual(CASE_VORTEX_FULL_RUN_GATES.slice(2));
  });

  it('requires explicit approval, deployment and live-verification receipts for objective eligibility', () => {
    const candidate = input();
    candidate.deployment = {
      status: 'verified',
      approvalReceiptSha256: sha('b'),
      deploymentReceiptSha256: sha('c'),
      liveVerificationSha256: sha('d'),
      verifiedAt: '2026-07-22T09:30:00.000Z',
      publication,
    };
    const report = buildCaseVortexFullRunReport(candidate);
    expect(report.candidateEligible).toBe(true);
    expect(report.objectiveEligible).toBe(true);
  });

  it('rejects duplicate gates and publication drift', () => {
    const duplicated = input(false);
    duplicated.evidence[1] = { ...duplicated.evidence[0] };
    expect(() => buildCaseVortexFullRunReport(duplicated)).toThrow('case_vortex_full_run_evidence_duplicate');

    const drifted = input(false);
    drifted.evidence[0] = {
      ...drifted.evidence[0],
      publication: { ...publication, manifestSha256: sha('e') },
    };
    expect(() => buildCaseVortexFullRunReport(drifted)).toThrow(
      'case_vortex_full_run_evidence_publication_mismatch',
    );
  });

  it('rejects one retained artifact digest reused as evidence for different gates', () => {
    const reused = input();
    reused.evidence[1] = {
      ...reused.evidence[1],
      artifactSha256: reused.evidence[0]!.artifactSha256,
    };
    expect(() => buildCaseVortexFullRunReport(reused)).toThrow(
      'case_vortex_full_run_evidence_artifact_reused',
    );
  });

  it('rejects generic placeholders for claim quality, human, investigator, physical-performance and browser/device gates', () => {
    for (const gate of [
      'corpus_accounting', 'publication_manifest', 'calibration_human_review', 'claim_counterclaim',
      'investigator_benchmark', 'accessibility_review',
      'performance_matrix', 'supabase_control_plane', 'r2_artifact_replay',
      'security_review', 'operations_monitoring', 'rollback_rehearsal',
      'browser_device_matrix',
    ] as const) {
      const candidate = input();
      const index = candidate.evidence.findIndex((entry) => entry.gate === gate);
      candidate.evidence[index] = {
        ...candidate.evidence[index], artifactType: `${gate}_placeholder`, schemaVersion: 'verified-v1',
      };
      expect(() => buildCaseVortexFullRunReport(candidate))
        .toThrow('case_vortex_full_run_evidence_artifact_contract_invalid');
    }
  });

  it('rejects a generic verifier for artifacts that require authoritative byte verification', () => {
    const candidate = input();
    const index = candidate.evidence.findIndex((entry) => entry.gate === 'investigator_benchmark');
    candidate.evidence[index] = {
      ...candidate.evidence[index], verifierVersion: 'case-vortex-generic-verifier-v1',
    };
    expect(() => buildCaseVortexFullRunReport(candidate))
      .toThrow('case_vortex_full_run_evidence_artifact_contract_invalid');
  });

  it('rejects future-dated evidence and tampered derived fields or digest', () => {
    const future = input(false);
    future.evidence[0] = { ...future.evidence[0], verifiedAt: '2026-07-22T11:00:00.000Z' };
    expect(() => buildCaseVortexFullRunReport(future)).toThrow(
      'case_vortex_full_run_evidence_timestamp_invalid',
    );

    const report = buildCaseVortexFullRunReport(input(false));
    expect(() => verifyCaseVortexFullRunReport({ ...report, candidateEligible: true })).toThrow(
      'case_vortex_full_run_report_derived_fields_invalid',
    );
    expect(() => verifyCaseVortexFullRunReport({ ...report, reportSha256: sha('f') })).toThrow(
      'case_vortex_full_run_report_derived_fields_invalid',
    );
  });
});
