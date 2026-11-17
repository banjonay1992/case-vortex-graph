import { contextualExplanationSha256 } from '../../src/caseGraph/contextualExplanation';
import {
  assertContextualRelationshipCalibrationReceiptProductionEligible,
  decodeContextualRelationshipCalibrationReceipt,
  serializeContextualRelationshipCalibrationReceipt,
  type ContextualRelationshipCalibrationReceipt,
} from '../../src/caseGraph/contextualRelationshipCalibration';
import {
  buildEmptyContextualObservationArchiveCompletionManifest,
  buildGovernedContextualSourceSnapshot,
} from '../../src/caseGraph/contextualObservationArchive';
import {
  assertContextualRelationshipCompletionProductionEligible,
  buildContextualRelationshipCompletionArtifact,
  buildContextualRelationshipSourceCompletionReceipt,
  serializeContextualRelationshipCompletionArtifact,
  type ContextualRelationshipCompletionArtifact,
  type ContextualRelationshipSourceCompletionReceipt,
} from '../../src/caseGraph/contextualRelationshipCompletion';
import type { RelationshipInputUniverseBinding } from '../../src/caseGraph/relationshipInputSnapshot';

const KINDS = ['aircraft', 'satellite', 'astronomy', 'weather'] as const;
const SOURCE_FAMILY = {
  aircraft: 'aircraft_adsb_history',
  satellite: 'satellite_tle_sgp4_history',
  astronomy: 'astronomy_ephemeris_history',
  weather: 'weather_observation_history',
} as const;

const COVERAGE_WINDOW = Object.freeze({
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-01T23:59:59.999Z',
});
const MATERIALIZED_AT = '2026-01-02T00:00:00.000Z';
const COMPLETED_AT = '2026-01-03T00:00:00.000Z';

/**
 * This label is deliberately carried by every returned fixture. The helper only
 * proves structural wiring in tests; it is not evidence that human review or an
 * external trust ceremony actually occurred.
 */
export const STRUCTURAL_CONTEXTUAL_COMPLETION_FIXTURE_USE =
  'local_structural_test_fixture_only_not_review_or_release_evidence' as const;

export type StructuralProductionContextualCompletionFixture = {
  fixtureUse: typeof STRUCTURAL_CONTEXTUAL_COMPLETION_FIXTURE_USE;
  binding: RelationshipInputUniverseBinding;
  calibrationReceipt: ContextualRelationshipCalibrationReceipt;
  calibrationReceiptBody: Buffer;
  expectedCalibration: { receiptId: string; receiptSha256: string };
  sources: ContextualRelationshipSourceCompletionReceipt[];
  artifact: ContextualRelationshipCompletionArtifact;
  artifactBody: Buffer;
};

const exactCanonicalCalibrationReceipt = (params: {
  receipt: ContextualRelationshipCalibrationReceipt;
  body: Buffer | string;
}) => {
  const receipt = assertContextualRelationshipCalibrationReceiptProductionEligible(params.receipt);
  const expectedCalibration = {
    receiptId: receipt.receiptId,
    receiptSha256: receipt.receiptSha256,
  };
  const suppliedBody = Buffer.isBuffer(params.body)
    ? Buffer.from(params.body)
    : Buffer.from(params.body, 'utf8');
  const canonicalBody = Buffer.from(
    serializeContextualRelationshipCalibrationReceipt(receipt),
    'utf8',
  );
  if (!suppliedBody.equals(canonicalBody)) {
    throw new Error('structural_contextual_completion_calibration_body_noncanonical');
  }
  const bodyReceipt = decodeContextualRelationshipCalibrationReceipt(
    suppliedBody,
    expectedCalibration,
  );
  if (serializeContextualRelationshipCalibrationReceipt(bodyReceipt)
    !== serializeContextualRelationshipCalibrationReceipt(receipt)) {
    throw new Error('structural_contextual_completion_calibration_receipt_body_mismatch');
  }
  return { receipt, body: canonicalBody, expectedCalibration };
};

const buildEmptySources = (
  binding: RelationshipInputUniverseBinding,
): ContextualRelationshipSourceCompletionReceipt[] => KINDS.map((kind) => {
  const snapshot = buildGovernedContextualSourceSnapshot({
    binding,
    kind,
    sourceFamily: SOURCE_FAMILY[kind],
    sourceId: `structural-completion-${kind}`,
    providerId: `structural-completion-${kind}-provider`,
    datasetVersion: 'structural-completion-fixture-v1',
    coverageWindow: COVERAGE_WINDOW,
    materializedAt: MATERIALIZED_AT,
    contentSha256: contextualExplanationSha256({
      fixtureUse: STRUCTURAL_CONTEXTUAL_COMPLETION_FIXTURE_USE,
      binding,
      kind,
      state: 'empty_source_snapshot',
    }),
  });
  const completionManifest = buildEmptyContextualObservationArchiveCompletionManifest({
    snapshot,
    completedAt: COMPLETED_AT,
  });
  return buildContextualRelationshipSourceCompletionReceipt({ snapshot, completionManifest });
});

export const buildStructuralTestOnlyProductionContextualCompletion = (params: {
  binding: RelationshipInputUniverseBinding;
  contextualCalibrationReceipt: ContextualRelationshipCalibrationReceipt;
  contextualCalibrationReceiptBody: Buffer | string;
}): StructuralProductionContextualCompletionFixture => {
  const calibration = exactCanonicalCalibrationReceipt({
    receipt: params.contextualCalibrationReceipt,
    body: params.contextualCalibrationReceiptBody,
  });
  const sources = buildEmptySources(params.binding);
  const artifact = buildContextualRelationshipCompletionArtifact({
    binding: params.binding,
    calibrationReceipt: calibration.receipt,
    sources,
    entries: [],
  });
  const verified = assertContextualRelationshipCompletionProductionEligible(
    artifact,
    params.binding,
    calibration.expectedCalibration,
  );
  const artifactBody = Buffer.from(
    serializeContextualRelationshipCompletionArtifact(
      verified,
      calibration.expectedCalibration,
    ),
    'utf8',
  );
  return {
    fixtureUse: STRUCTURAL_CONTEXTUAL_COMPLETION_FIXTURE_USE,
    binding: verified.binding,
    calibrationReceipt: calibration.receipt,
    calibrationReceiptBody: calibration.body,
    expectedCalibration: calibration.expectedCalibration,
    sources: verified.sources,
    artifact: verified,
    artifactBody,
  };
};
