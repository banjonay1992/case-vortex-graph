import { describe, expect, it } from 'vitest';

import { contextualExplanationSha256 } from '../../src/caseGraph/contextualExplanation';
import {
  CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY,
  CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256,
  assertContextualRelationshipCompletionProductionEligible,
  buildContextualRelationshipCompletionArtifact,
  decodeContextualRelationshipCompletionArtifact,
  serializeContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionArtifact,
  type ContextualRelationshipSourceCompletionReceipt,
} from '../../src/caseGraph/contextualRelationshipCompletion';
import {
  buildCanonicalContextualCompletionMixedFixture,
  buildCanonicalContextualCompletionZeroFixture,
} from './contextualRelationshipCompletionTestSupport';

const clone = <T>(value: T): T => structuredClone(value);

const rehashCompletion = (
  input: ContextualRelationshipCompletionArtifact,
): ContextualRelationshipCompletionArtifact => {
  const artifact = clone(input);
  const { completionDigest: _completionDigest, completionId: _completionId, ...core } = artifact;
  const completionId = `contextual-completion:${contextualExplanationSha256(core)}`;
  return {
    ...core,
    completionId,
    completionDigest: contextualExplanationSha256({ ...core, completionId }),
  };
};

const rehashSource = (
  input: ContextualRelationshipSourceCompletionReceipt,
): ContextualRelationshipSourceCompletionReceipt => {
  const source = clone(input);
  const { sourceCompletionDigest: _sourceCompletionDigest, ...withoutDigest } = source;
  return {
    ...withoutDigest,
    sourceCompletionDigest: contextualExplanationSha256(withoutDigest),
  };
};

describe('contextual relationship completion', () => {
  it('builds the canonical four-source zero state without authorizing the synthetic calibration', () => {
    const fixture = buildCanonicalContextualCompletionZeroFixture();
    expect(fixture.artifact).toMatchObject({
      status: 'unvalidated_local_demo',
      zeroObservationState: true,
      contextualIdentity: CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY,
      contextualIdentitySha256: CONTEXTUAL_RELATIONSHIP_COMPLETION_CONTEXTUAL_IDENTITY_SHA256,
      accounting: {
        sourceSnapshotCount: 4,
        sourceKindCount: 4,
        sourceRecordCount: 0,
        acceptedEdgeCount: 0,
        insufficientEvidenceCount: 0,
        uniqueAddressCount: 0,
      },
    });
    expect(Object.values(fixture.artifact.accounting.sourceKindCounts).every((counts) => (
      counts.sourceSnapshotCount === 1
      && counts.sourceRecordCount === 0
      && counts.acceptedEdgeCount === 0
      && counts.insufficientEvidenceCount === 0
    ))).toBe(true);
    expect(fixture.artifact.entries).toEqual([]);
    expect(() => assertContextualRelationshipCompletionProductionEligible(
      fixture.artifact,
      fixture.binding,
      fixture.expectedCalibration,
    )).toThrow(/not_production_eligible/);
  });

  it('accounts for one accepted edge and one explicit insufficient-evidence receipt', () => {
    const fixture = buildCanonicalContextualCompletionMixedFixture();
    expect(fixture.artifact).toMatchObject({
      status: 'unvalidated_local_demo',
      zeroObservationState: false,
      accounting: {
        sourceSnapshotCount: 4,
        sourceKindCount: 4,
        sourceRecordCount: 2,
        acceptedEdgeCount: 1,
        insufficientEvidenceCount: 1,
        uniqueAddressCount: 2,
        addressStatusCounts: { accepted_only: 1, insufficient_only: 1, mixed: 0 },
      },
    });
    expect(fixture.artifact.accounting.sourceKindCounts.aircraft).toEqual({
      sourceSnapshotCount: 1,
      sourceRecordCount: 2,
      acceptedEdgeCount: 1,
      insufficientEvidenceCount: 1,
    });
    const accepted = fixture.artifact.entries.find((entry) => entry.status === 'accepted_edge');
    const insufficient = fixture.artifact.entries.find((entry) => entry.status === 'insufficient_evidence');
    if (!accepted || accepted.status !== 'accepted_edge') throw new Error('accepted_completion_fixture_missing');
    if (!insufficient || insufficient.status !== 'insufficient_evidence') {
      throw new Error('insufficient_completion_fixture_missing');
    }
    expect(accepted.typedEdge.edgeType).toBe('contextual_explanation_candidate');
    expect(accepted.typedEdge.endpoints[0]).toEqual({ kind: 'evidence', id: accepted.address });
    expect(accepted.typedEdge.endpoints[1].kind).toBe('context');
    expect(insufficient.insufficientReceipt).toMatchObject({
      decision: 'insufficient_evidence',
      address: insufficient.address,
      contextualEvaluation: { decision: 'insufficient_evidence', kind: 'aircraft' },
    });
    expect(accepted?.entryId).not.toBe(insufficient?.entryId);
  });

  it('round-trips canonically and binds the exact calibration receipt identity', () => {
    const fixture = buildCanonicalContextualCompletionMixedFixture();
    const encoded = serializeContextualRelationshipCompletionArtifact(
      fixture.artifact,
      fixture.expectedCalibration,
    );
    expect(decodeContextualRelationshipCompletionArtifact(
      encoded,
      fixture.binding,
      fixture.expectedCalibration,
    )).toEqual(fixture.artifact);
    expect(() => decodeContextualRelationshipCompletionArtifact(
      fixture.artifact,
      fixture.binding,
      { ...fixture.expectedCalibration, receiptSha256: 'f'.repeat(64) },
    )).toThrow('contextual_calibration_receipt_expected_identity_mismatch');
  });

  it('independently rebuilds claimed status, accounting, sets, zero state, and policy/model identity', () => {
    const fixture = buildCanonicalContextualCompletionMixedFixture();
    const attempts: ContextualRelationshipCompletionArtifact[] = [];

    const status = clone(fixture.artifact);
    status.status = 'production_eligible_complete';
    attempts.push(rehashCompletion(status));

    const accounting = clone(fixture.artifact);
    accounting.accounting.acceptedEdgeCount = 2;
    accounting.accounting.insufficientEvidenceCount = 0;
    attempts.push(rehashCompletion(accounting));

    const sourceSet = clone(fixture.artifact);
    sourceSet.sourceCompletionSetSha256 = 'f'.repeat(64);
    attempts.push(rehashCompletion(sourceSet));

    const entrySet = clone(fixture.artifact);
    entrySet.entrySetSha256 = 'e'.repeat(64);
    attempts.push(rehashCompletion(entrySet));

    const zeroState = clone(fixture.artifact);
    zeroState.zeroObservationState = true;
    attempts.push(rehashCompletion(zeroState));

    const identity = clone(fixture.artifact);
    (identity.contextualIdentity as unknown as { contextualPolicySha256: string }).contextualPolicySha256 = 'd'.repeat(64);
    identity.contextualIdentitySha256 = contextualExplanationSha256(identity.contextualIdentity);
    attempts.push(rehashCompletion(identity));

    for (const forged of attempts) {
      expect(() => decodeContextualRelationshipCompletionArtifact(
        forged,
        fixture.binding,
        fixture.expectedCalibration,
      )).toThrow('contextual_completion_noncanonical');
    }
  });

  it('rejects missing source kinds, duplicate entries, and source-manifest flat-field replacement', () => {
    const zero = buildCanonicalContextualCompletionZeroFixture();
    expect(() => buildContextualRelationshipCompletionArtifact({
      binding: zero.binding,
      calibrationReceipt: zero.calibrationReceipt,
      sources: zero.sources.filter((source) => source.snapshot.kind !== 'weather'),
      entries: [],
    })).toThrow('contextual_completion_source_coverage_invalid');

    const mixed = buildCanonicalContextualCompletionMixedFixture();
    expect(() => buildContextualRelationshipCompletionArtifact({
      binding: mixed.binding,
      calibrationReceipt: mixed.calibrationReceipt,
      sources: mixed.sources,
      entries: [mixed.entryInputs[0], mixed.entryInputs[0]],
    })).toThrow('contextual_completion_duplicate_entry');

    const sourceTamper = clone(zero.artifact);
    sourceTamper.sources[0].rowCount = 1;
    sourceTamper.sources[0] = rehashSource(sourceTamper.sources[0]);
    sourceTamper.sourceCompletionSetSha256 = contextualExplanationSha256(
      sourceTamper.sources.map((source) => ({
        kind: source.snapshot.kind,
        sourceSnapshotDigest: source.snapshot.snapshotDigest,
        completionManifestDigest: source.completionManifestDigest,
        sourceCompletionDigest: source.sourceCompletionDigest,
      })),
    );
    expect(() => decodeContextualRelationshipCompletionArtifact(
      rehashCompletion(sourceTamper),
      zero.binding,
      zero.expectedCalibration,
    )).toThrow('contextual_completion_source_manifest_mismatch');
  });

  it('rejects nested endpoint, insufficient-receipt, and unknown-field tampering', () => {
    const fixture = buildCanonicalContextualCompletionMixedFixture();
    const acceptedIndex = fixture.artifact.entries.findIndex((entry) => entry.status === 'accepted_edge');
    const insufficientIndex = fixture.artifact.entries.findIndex((entry) => entry.status === 'insufficient_evidence');

    const endpoint = clone(fixture.artifact);
    const accepted = endpoint.entries[acceptedIndex];
    if (accepted.status !== 'accepted_edge') throw new Error('accepted_completion_fixture_missing');
    accepted.typedEdge.endpoints[1].id = 'context-node:aircraft:forged';
    expect(() => decodeContextualRelationshipCompletionArtifact(
      endpoint,
      fixture.binding,
      fixture.expectedCalibration,
    )).toThrow(/typed_relationship_edge_digest_mismatch|contextual_completion_entry_typed_edge_mismatch/);

    const insufficient = clone(fixture.artifact);
    const rejected = insufficient.entries[insufficientIndex];
    if (rejected.status !== 'insufficient_evidence') throw new Error('insufficient_completion_fixture_missing');
    rejected.insufficientReceipt.decision = 'insufficient_evidence';
    rejected.insufficientReceipt.adapterReceiptSha256 = 'f'.repeat(64);
    expect(() => decodeContextualRelationshipCompletionArtifact(
      insufficient,
      fixture.binding,
      fixture.expectedCalibration,
    )).toThrow(/contextual_completion_insufficient_receipt/);

    const unknown = clone(fixture.artifact) as unknown as Record<string, unknown>;
    unknown.unreviewed = true;
    expect(() => decodeContextualRelationshipCompletionArtifact(
      unknown,
      fixture.binding,
      fixture.expectedCalibration,
    )).toThrow('contextual_completion_artifact_invalid');
  });
});
