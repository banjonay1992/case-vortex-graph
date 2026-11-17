import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_SHA256,
  materializeClaimEvidencePostgresBuild,
  verifyClaimEvidencePostgresCompletionReceipt,
} from '../../src/caseGraph/claimEvidencePostgresBuild';
import {
  buildAtomicEvidenceClaim,
  buildClaimEvidenceGraphArtifact,
  buildSourceReliabilityAssessment,
} from '../../src/caseGraph/claimEvidenceGraph';
import type { CaseGraphContentImmutableArchive } from '../../src/caseGraph/contentResearchMaterialization';
import type { CaseGraphClaimEvidencePostgresQuery } from '../../src/caseGraph/postgresClaimEvidence';

const binding = {
  publicationId: '018f6f50-f8d3-7c0a-8b31-111111111111',
  corpusVersion: 'uap-corpus-2026-07-20',
  manifestSha256: 'a'.repeat(64),
  snapshotId: '018f6f50-f8d3-7c0a-8b31-222222222222',
  graphArtifactSetSha256: 'b'.repeat(64),
};
const claim = buildAtomicEvidenceClaim({
  binding, address: 'document:build-fixture', sourceId: 'fixture', subject: 'Witness',
  predicate: 'observed', object: 'a light', polarity: 'asserted', modality: 'reported',
  sourceText: 'Witness reported a light.',
  locator: { kind: 'document_page', pageNumber: 1, characterStart: 0, characterEnd: 25, boundingBox: null },
  extraction: { method: 'manual_review', version: 'review-v1', confidence: 1, reviewStatus: 'reviewed' },
});
const assessment = buildSourceReliabilityAssessment({
  binding, address: claim.address, sourceId: 'fixture', sourceLabel: 'Fixture source', lineageId: 'fixture',
  dimensions: {
    sourcePosition: { value: 'primary', reasonCodes: ['direct'], explanation: 'Direct report.' },
    contemporaneity: { value: 'unknown', reasonCodes: ['unknown'], explanation: 'Date unknown.' },
    witnessIdentity: { value: 'named', reasonCodes: ['named'], explanation: 'Named witness.' },
    originality: { value: 'original', reasonCodes: ['original'], explanation: 'Original record.' },
    independence: { value: 'independent', reasonCodes: ['origin'], explanation: 'Originating lineage.' },
    provenance: { value: 'partial', reasonCodes: ['partial'], explanation: 'Partial chain.' },
    corroboration: { value: 'none', reasonCodes: ['none'], explanation: 'No corroboration.', independentSourceCount: 0, sharedLineageSourceCount: 0 },
  },
  limitations: ['Not a truth score.'],
  assessedBy: { method: 'manual_review', version: 'review-v1', reviewStatus: 'reviewed' },
});
const artifact = buildClaimEvidenceGraphArtifact({ binding, claims: [claim], links: [], sourceReliability: [assessment] });

const memoryArchive = () => {
  const objects = new Map<string, Buffer>();
  const writes: string[] = [];
  const archive: CaseGraphContentImmutableArchive = {
    putIfAbsent: async ({ key, body }) => {
      if (objects.has(key)) return 'exists';
      objects.set(key, Buffer.from(body));
      writes.push(key);
      return 'written';
    },
    readObject: async (key) => objects.get(key) || null,
  };
  return { archive, objects, writes };
};

describe('claim evidence PostgreSQL build orchestration', () => {
  it('pins the build contract to the exact migration bytes', () => {
    const migration = fs.readFileSync(path.join(
      process.cwd(), 'src/db/migrations/0209_case_graph_claim_evidence_ledger_2026_07_20.sql',
    ));
    expect(createHash('sha256').update(migration).digest('hex'))
      .toBe(CASE_GRAPH_CLAIM_EVIDENCE_MIGRATION_SHA256);
  });

  it('archives, ingests, writes a completion receipt, then verifies visibility', async () => {
    const storage = memoryArchive();
    const calls: string[] = [];
    const query: CaseGraphClaimEvidencePostgresQuery = vi.fn(async (sql, params) => {
      calls.push(sql);
      if (sql.includes('create_case_graph_claim_evidence_build')) {
        expect(params.slice(0, 4)).toEqual([
          binding.publicationId, binding.manifestSha256, binding.graphArtifactSetSha256, artifact.artifactDigest,
        ]);
        return { rows: [{ lease_token: '018f6f50-f8d3-7c0a-8b31-333333333333' }] };
      }
      if (sql.includes('ingest_case_graph_atomic_claim_batch')) {
        expect(JSON.parse(String(params[2]))).toEqual([expect.objectContaining({ claim_id: claim.claimId })]);
        return { rows: [{ ingested_count: 1 }] };
      }
      if (sql.includes('ingest_case_graph_source_reliability_batch')) {
        expect(JSON.parse(String(params[2]))).toEqual([expect.objectContaining({ assessment_id: assessment.assessmentId })]);
        return { rows: [{ ingested_count: 1 }] };
      }
      if (sql.includes('verify_case_graph_claim_evidence_build')) return { rows: [{ verify_case_graph_claim_evidence_build: null }] };
      throw new Error('unexpected_query');
    });

    const result = await materializeClaimEvidencePostgresBuild({ artifact, archive: storage.archive, query });
    expect(result.completionReceipt).toMatchObject({
      artifactDigest: artifact.artifactDigest,
      claimCount: 1,
      linkCount: 0,
      sourceAssessmentCount: 1,
    });
    expect(result.completionReceiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.writes.at(-1)).toBe(result.completionReceiptKey);
    expect(calls.at(-1)).toContain('verify_case_graph_claim_evidence_build');
    expect(verifyClaimEvidencePostgresCompletionReceipt({
      value: result.completionReceipt,
      artifact: result.artifact,
      manifest: result.manifest,
      shards: result.shards,
      pointer: result.pointer,
    })).toBeDefined();
  });

  it('records a terminal failure without replacing the originating error', async () => {
    const storage = memoryArchive();
    const query: CaseGraphClaimEvidencePostgresQuery = vi.fn(async (sql) => {
      if (sql.includes('create_case_graph_claim_evidence_build')) {
        return { rows: [{ lease_token: '018f6f50-f8d3-7c0a-8b31-333333333333' }] };
      }
      if (sql.includes('ingest_case_graph_atomic_claim_batch')) throw new Error('database_write_failed');
      if (sql.includes('fail_case_graph_claim_evidence_build')) return { rows: [{ fail_case_graph_claim_evidence_build: null }] };
      throw new Error('unexpected_query');
    });
    await expect(materializeClaimEvidencePostgresBuild({ artifact, archive: storage.archive, query }))
      .rejects.toThrow('database_write_failed');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fail_case_graph_claim_evidence_build'),
      [binding.publicationId, '018f6f50-f8d3-7c0a-8b31-333333333333', 'materialization_failed'],
      expect.any(Object),
    );
  });
});
