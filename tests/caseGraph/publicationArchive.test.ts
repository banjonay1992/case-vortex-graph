import { beforeAll, describe, expect, it } from 'vitest';

import {
  caseVortexCorpusAccountingReceiptSha256,
  encodeCaseVortexCorpusAccountingReceipt,
} from '../../src/caseGraph/corpusAccountingIntegration';
import {
  buildCaseGraphPublicationCandidate,
  encodeCaseGraphPublicationCandidateCompletion,
  readVerifiedCaseGraphPublicationCandidate,
} from '../../src/caseGraph/publicationArchive';
import { CASE_GRAPH_PUBLIC_MANIFEST_VERSION } from '../../src/caseGraph/publicationManifest';
import {
  buildPublicationV2Fixture,
  buildPublicationV2ActivationRow,
  fixtureHash,
  publicationCorpusVersion,
} from './publicationV2TestSupport';

describe('case graph publication-v2 archive fence', () => {
  beforeAll(() => {
    buildPublicationV2Fixture();
  }, 240_000);

  it('fails before any artifact write when required lineage receipts are absent', async () => {
    let writes = 0;
    await expect(buildCaseGraphPublicationCandidate({
      corpusVersion: publicationCorpusVersion,
      storage: {
        readObject: async () => null,
        uploadFile: async () => { writes += 1; return 'unexpected'; },
      },
    })).rejects.toThrow('case_graph_publication_lineage_receipts_required');
    expect(writes).toBe(0);
  });

  it('emits the exact typed-relationship schema alias at every activation join', () => {
    const fixture = buildPublicationV2Fixture();
    const row = buildPublicationV2ActivationRow(fixture);
    const expected = fixture.manifest.models.relationshipSchemaVersion;
    expect(row.run_relationship_schema_version).toBe(expected);
    expect(row.relationship_schema_version).toBe(expected);
    expect(row.receipt_relationship_schema_version).toBe(expected);
  });

  it('writes and verifies the complete v2 candidate from exact immutable lineage inputs', async () => {
    const fixture = buildPublicationV2Fixture();
    const objects = fixture.objects;
    for (const key of [
      fixture.keys.manifestKey,
      fixture.keys.accountingReceiptKey,
      fixture.keys.calibrationSetReceiptKey,
      fixture.keys.humanReviewBundleKey,
      fixture.keys.pairCalibrationReceiptKey,
      fixture.keys.contextualCalibrationReceiptKey,
      fixture.keys.pairCalibrationArtifactKey,
      fixture.keys.pairCalibrationTrustPolicyKey,
      fixture.keys.contextualCalibrationArtifactKey,
      fixture.keys.contextualCalibrationTrustPolicyKey,
      fixture.keys.contextualRelationshipCompletionKey,
      fixture.keys.completionKey,
    ]) objects.delete(key);
    let version = 0;
    const storage = {
      readObject: async (key: string) => objects.get(key) || null,
      uploadFile: async () => { throw new Error('unconditional_write_not_expected'); },
      readObjectVersioned: async (key: string) => {
        const body = objects.get(key);
        return body ? { body: Buffer.from(body), version: `v${version}` } : null;
      },
      uploadFileConditional: async (body: Buffer, key: string) => {
        if (objects.has(key)) return { status: 'precondition_failed' as const };
        version += 1;
        objects.set(key, Buffer.from(body));
        return { status: 'written' as const, key, version: `v${version}` };
      },
    };
    const result = await buildCaseGraphPublicationCandidate({
      corpusVersion: publicationCorpusVersion,
      storage,
      lineage: {
        generatedAt: fixture.manifest.generatedAt,
        relationshipRun: fixture.relationship.pointer,
        productionCompatibility: fixture.productionCompatibility.pointer,
        publicGraphManifestReceiptKey: fixture.publicGraphManifestArchive.receipt.receiptKey,
        density: fixture.densityArchive.pointer,
        calibration: {
          humanReviewBundleBody: fixture.calibration.bundleBody,
          pairReceiptBody: fixture.calibration.pairReceiptBody,
          contextualReceiptBody: fixture.calibration.contextualReceiptBody,
          pairLineage: fixture.calibration.pairLineage,
          contextualLineage: fixture.calibration.contextualLineage,
          pairArtifactBody: fixture.calibration.pair.artifactBody,
          pairTrustPolicyBody: fixture.calibration.pair.trustPolicyBody,
          contextualArtifactBody: fixture.calibration.contextual.artifactBody,
          contextualTrustPolicyBody: fixture.calibration.contextual.trustPolicyBody,
          pinned: {
            pair: {
              receiptId: fixture.manifest.lineage.calibration.pair.receiptId,
              receiptSha256: fixture.manifest.lineage.calibration.pair.receiptSha256,
              artifactDigest: fixture.manifest.lineage.calibrationEvidence.pair.artifactDigest,
              trustPolicyDigest: fixture.manifest.lineage.calibrationEvidence.pair.trustPolicyDigest,
            },
            contextual: {
              receiptId: fixture.manifest.lineage.calibration.contextual.receiptId,
              receiptSha256: fixture.manifest.lineage.calibration.contextual.receiptSha256,
              artifactDigest: fixture.manifest.lineage.calibrationEvidence.contextual.artifactDigest,
              trustPolicyDigest: fixture.manifest.lineage.calibrationEvidence.contextual.trustPolicyDigest,
            },
          },
        },
        contextualRelationshipCompletionBody: fixture.contextualCompletion.artifactBody,
        accountingBinding: fixture.manifest.accountingBinding,
        accountingReceiptBody: fixture.accountingReceiptBody,
      },
    });
    expect(result.status).toBe('complete');
    expect(result.manifest).toEqual(fixture.manifest);
    expect(result.completion).toEqual(fixture.completion);
    await expect(readVerifiedCaseGraphPublicationCandidate(
      storage,
      publicationCorpusVersion,
    )).resolves.toMatchObject({
      manifest: { schemaVersion: CASE_GRAPH_PUBLIC_MANIFEST_VERSION },
      completion: { schema_version: 2, indexed_case_count: 105 },
    });
  }, 240_000);

  it('reuses only a completion that binds canonical manifest and accounting-receipt bytes', async () => {
    const fixture = buildPublicationV2Fixture();
    const objects = fixture.objects;
    const verified = await readVerifiedCaseGraphPublicationCandidate({
      readObject: async (key) => objects.get(key) || null,
    }, publicationCorpusVersion);
    expect(verified).toMatchObject({
      manifest: { schemaVersion: CASE_GRAPH_PUBLIC_MANIFEST_VERSION },
      accountingReceipt: { complete: true, representedTotal: 105 },
      completion: { schema_version: 2 },
    });

    const v1 = { ...fixture.completion, schema_version: 1 };
    objects.set(fixture.keys.completionKey, Buffer.from(`${JSON.stringify(v1)}\n`));
    await expect(readVerifiedCaseGraphPublicationCandidate({
      readObject: async (key) => objects.get(key) || null,
    }, publicationCorpusVersion)).rejects.toThrow('case_graph_publication_completion_invalid');
  }, 60_000);

  it('fails publication replay when the manifest-bound production compatibility receipt is missing', async () => {
    const fixture = buildPublicationV2Fixture();
    fixture.objects.delete(fixture.productionCompatibility.pointer.archiveKey);
    await expect(readVerifiedCaseGraphPublicationCandidate({
      readObject: async (key) => fixture.objects.get(key) || null,
    }, publicationCorpusVersion)).rejects.toThrow(
      'full_corpus_production_compatibility_archive_missing',
    );
  }, 60_000);

  it('fails publication replay when the sealed human-review bundle bytes are substituted', async () => {
    const fixture = buildPublicationV2Fixture();
    fixture.objects.set(
      fixture.keys.humanReviewBundleKey,
      Buffer.concat([fixture.calibration.bundleBody, Buffer.from(' ')]),
    );
    await expect(readVerifiedCaseGraphPublicationCandidate({
      readObject: async (key) => fixture.objects.get(key) || null,
    }, publicationCorpusVersion)).rejects.toThrow(
      'case_graph_publication_human_review_bundle_checksum_mismatch',
    );
  }, 60_000);

  it('detects receipt substitution even when an attacker updates its completion checksum', async () => {
    const fixture = buildPublicationV2Fixture();
    const changedReceipt = structuredClone(fixture.accountingReceipt);
    changedReceipt.binding.graphPublicationSha256 = fixtureHash('f');
    const changedBody = encodeCaseVortexCorpusAccountingReceipt(changedReceipt);
    const changedCompletion = {
      ...fixture.completion,
      accounting_receipt_sha256: caseVortexCorpusAccountingReceiptSha256(changedBody),
    };
    const objects = fixture.objects;
    objects.set(fixture.keys.accountingReceiptKey, changedBody);
    objects.set(
      fixture.keys.completionKey,
      encodeCaseGraphPublicationCandidateCompletion(changedCompletion),
    );
    await expect(readVerifiedCaseGraphPublicationCandidate({
      readObject: async (key) => objects.get(key) || null,
    }, publicationCorpusVersion)).rejects.toThrow('case_graph_publication_accounting_receipt_binding_mismatch');
  }, 60_000);

  it('rejects semantically valid completion JSON when its exact bytes are noncanonical', async () => {
    const fixture = buildPublicationV2Fixture();
    const objects = fixture.objects;
    objects.set(
      fixture.keys.completionKey,
      Buffer.from(`${JSON.stringify(fixture.completion, null, 2)}\n`, 'utf8'),
    );
    await expect(readVerifiedCaseGraphPublicationCandidate({
      readObject: async (key) => objects.get(key) || null,
    }, publicationCorpusVersion)).rejects.toThrow('case_graph_publication_completion_noncanonical');
  });
});
