import { beforeAll, describe, expect, it } from 'vitest';

import {
  caseGraphPublicManifestSha256,
  decodeCaseGraphPublicManifest,
  encodeCaseGraphPublicManifest,
  getCaseGraphArtifactSetSha256,
} from '../../src/caseGraph/publicationManifest';
import {
  buildPublicationV2Fixture,
  fixtureHash,
  publicationCorpusVersion,
} from './publicationV2TestSupport';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('case graph public manifest v3 lineage contract', () => {
  beforeAll(() => {
    buildPublicationV2Fixture();
  }, 120_000);

  it('round-trips only exact canonical v3 bytes and exposes their deterministic digest', () => {
    const fixture = buildPublicationV2Fixture();
    expect(decodeCaseGraphPublicManifest(fixture.manifestBody, publicationCorpusVersion)).toEqual(fixture.manifest);
    expect(encodeCaseGraphPublicManifest(fixture.manifest)).toEqual(fixture.manifestBody);
    expect(caseGraphPublicManifestSha256(fixture.manifest)).toBe(fixture.manifestSha256);
    expect(caseGraphPublicManifestSha256(fixture.manifestBody)).toBe(fixture.manifestSha256);
    expect(() => decodeCaseGraphPublicManifest(
      Buffer.from(`${JSON.stringify(fixture.manifest)}\n`),
      publicationCorpusVersion,
    )).toThrow('case_graph_public_manifest_non_canonical');
  });

  it('rejects v1, omissions, hidden fields and mixed immutable snapshots', () => {
    const fixture = buildPublicationV2Fixture();
    const legacy = copy(fixture.manifest) as Record<string, unknown>;
    legacy.schemaVersion = 'case-vortex-public-manifest-v1';
    expect(() => decodeCaseGraphPublicManifest(legacy)).toThrow('case_graph_public_manifest_invalid');

    const omitted = copy(fixture.manifest) as unknown as Record<string, unknown>;
    delete omitted.accountingBinding;
    expect(() => decodeCaseGraphPublicManifest(omitted)).toThrow('case_graph_public_manifest_invalid');

    const hidden = copy(fixture.manifest);
    Object.assign(hidden.lineage.calibration, { reviewedBy: 'unbound-operator' });
    expect(() => decodeCaseGraphPublicManifest(hidden)).toThrow('case_graph_public_manifest_invalid');

    const mixed = copy(fixture.manifest);
    mixed.lineage.relationshipInput.binding.snapshotId = '018f47ef-4fb0-7e2a-8b5c-5bd3909f7102';
    expect(() => decodeCaseGraphPublicManifest(mixed)).toThrow('case_graph_public_manifest_relationship_input_binding_mismatch');
  });

  it('rejects tampered graph artifacts, accounting coverage, models and calibration receipts', () => {
    const fixture = buildPublicationV2Fixture();
    const artifact = copy(fixture.manifest);
    artifact.graphShards[0].itemSetSha256 = fixtureHash('f');
    expect(() => decodeCaseGraphPublicManifest(artifact)).toThrow('case_graph_public_manifest_graph_artifact_set_mismatch');

    const coverage = copy(fixture.manifest);
    coverage.accountingBinding.graphAddressLedger.byKind.sighting = 2;
    coverage.accountingBinding.graphAddressLedger.byKind.document = 0;
    expect(() => decodeCaseGraphPublicManifest(coverage)).toThrow(
      'case_vortex_accounting_publication_binding_invalid',
    );

    const model = copy(fixture.manifest);
    (model.models as { relationshipModelId: string }).relationshipModelId = 'different-model';
    expect(() => decodeCaseGraphPublicManifest(model)).toThrow('case_graph_public_manifest_model_invalid');

    const calibration = copy(fixture.manifest);
    calibration.lineage.calibration.set.receiptSha256 = 'missing';
    expect(() => decodeCaseGraphPublicManifest(calibration)).toThrow('case_graph_public_manifest_calibration_invalid');

    const evidence = copy(fixture.manifest);
    evidence.lineage.calibrationEvidence.pair.artifactBodySha256 = fixtureHash('9');
    expect(() => decodeCaseGraphPublicManifest(evidence)).toThrow(
      'case_graph_public_manifest_graph_artifact_set_mismatch',
    );

    const humanReview = copy(fixture.manifest);
    humanReview.lineage.calibrationEvidence.humanReview.bundleDigest = fixtureHash('8');
    expect(() => decodeCaseGraphPublicManifest(humanReview)).toThrow(
      'case_graph_public_manifest_graph_artifact_set_mismatch',
    );

    const contextual = copy(fixture.manifest);
    contextual.lineage.contextualCompletion.completionDigest = fixtureHash('d');
    expect(() => decodeCaseGraphPublicManifest(contextual)).toThrow(
      'case_graph_public_manifest_contextual_completion_invalid',
    );
  });

  it('hashes graph artifacts deterministically independent of caller array order', () => {
    const fixture = buildPublicationV2Fixture();
    const expected = fixture.manifest.lineage.graph.artifactSetSha256;
    expect(getCaseGraphArtifactSetSha256({
      corpusVersion: fixture.manifest.corpusVersion,
      relationshipRun: fixture.manifest.lineage.relationshipRun,
      productionCompatibility: fixture.manifest.lineage.productionCompatibility,
      publicGraph: fixture.manifest.lineage.publicGraph,
      density: fixture.manifest.density,
      calibration: fixture.manifest.lineage.calibration,
      calibrationEvidence: fixture.manifest.lineage.calibrationEvidence,
      contextualCompletion: fixture.manifest.lineage.contextualCompletion,
      graphShards: [...fixture.manifest.graphShards].reverse(),
      graphAddressLedger: fixture.manifest.accountingBinding.graphAddressLedger,
    })).toBe(expected);
  });
});
