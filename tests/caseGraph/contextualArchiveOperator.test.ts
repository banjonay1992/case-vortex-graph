import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CaseGraphConditionalArchiveStorage } from '../../src/caseGraph/archiveTypes';
import {
  buildContextualArchiveOperatorApprovalPayload,
  buildContextualArchiveExecutionAuthorizationPayload,
  CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION,
  CONTEXTUAL_ARCHIVE_PRODUCTION_TRUST_REGISTRY,
  contextualArchiveOperatorAuthorizationStatement,
  runContextualArchiveOperator,
  validateContextualArchiveOperatorInputs,
  verifyContextualArchiveOperatorReceipt,
  verifyContextualArchiveOperatorApproval,
  verifyContextualArchiveExecutionAuthorization,
  verifyContextualArchiveTrustedApproverKeyring,
  type ContextualArchiveOperatorFamilyInput,
  type ContextualArchiveOperatorApprovalPayload,
  type ContextualArchiveTrustedApproverKeyring,
  type ContextualArchiveExecutionAuthorizationPayload,
} from '../../src/caseGraph/contextualArchiveOperator';
import { buildGovernedContextualSourceSnapshot } from '../../src/caseGraph/contextualObservationArchive';
import {
  CONTEXTUAL_SOURCE_CENSUS_GOVERNANCE_VERSION,
  CONTEXTUAL_SOURCE_CENSUS_VERSION,
  CONTEXTUAL_SOURCE_FAMILIES,
  CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION,
  CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST,
  CONTEXTUAL_SOURCE_THRESHOLD_POLICY_VERSION,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
  contextualSourceCensusSha256,
  type ContextualSourceReadinessCensus,
  type ContextualSourceSnapshotPlan,
} from '../../src/caseGraph/contextualSourceMaterializationCensus';
import { buildContextualSourceGovernanceDecisionPacket } from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';
import { EVIDENCE_UNIVERSE_LAYOUT_VERSION, EVIDENCE_UNIVERSE_SCHEMA_VERSION } from '../../src/caseGraph/evidenceUniverse';
import { EVIDENCE_UNIVERSE_ARCHIVE_VERSION } from '../../src/caseGraph/evidenceUniverseArchive';
import { canonicalizeRelationshipInput, relationshipInputSha256, type RelationshipInputUniverseBinding } from '../../src/caseGraph/relationshipInputSnapshot';

const hash = (value: string) => relationshipInputSha256(value);
const kinds = {
  aircraft_adsb_history: 'aircraft',
  satellite_tle_sgp4_history: 'satellite',
  astronomy_ephemeris_history: 'astronomy',
  weather_observation_history: 'weather',
} as const;
const binding: RelationshipInputUniverseBinding = {
  snapshotId: '11111111-1111-4111-8111-111111111111',
  corpusVersion: 'contextual-operator-fixture-v1',
  universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  universeArchiveSetSha256: hash('universe'),
  universeRecordCount: 1,
};
const subjectAddress = 'sighting:00000000-0000-4000-8000-000000000001';
const targetBinding = {
  universe: binding,
  relationshipInputSnapshotDigest: hash('relationship-snapshot'),
  relationshipInputRecordSetSha256: hash('relationship-records'),
  relationshipInputRecordCount: 1,
  subjectCohortPolicyVersion: CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
  subjectCohortPolicyDigest: CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
  subjectAddressSetSha256: relationshipInputSha256([subjectAddress]),
  subjectCount: 1,
  requiredCoverageWindow: {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T01:00:00.000Z',
  },
};

const signApproval = (
  payload: ContextualArchiveOperatorApprovalPayload,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
) => {
  const signatureBase64 = sign(
    null,
    Buffer.from(canonicalizeRelationshipInput(payload), 'utf8'),
    privateKey,
  ).toString('base64');
  const signed = { ...payload, signatureAlgorithm: 'ed25519' as const, signatureBase64 };
  return { ...signed, approvalSha256: relationshipInputSha256(signed) };
};
const signExecution = (
  payload: ContextualArchiveExecutionAuthorizationPayload,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
) => {
  const signatureBase64 = sign(
    null, Buffer.from(canonicalizeRelationshipInput(payload), 'utf8'), privateKey,
  ).toString('base64');
  const signed = { ...payload, signatureAlgorithm: 'ed25519' as const, signatureBase64 };
  return { ...signed, authorizationSha256: relationshipInputSha256(signed) };
};

const packet = () => buildContextualSourceGovernanceDecisionPacket({
  referenceAt: '2026-01-02T00:00:00.000Z',
  maximumEvidenceAgeDays: 30,
  entries: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => ({
    category,
    canonicalSource: `SOURCE_${category.toUpperCase()}`,
    providerId: `provider-${category}`,
    requiredContentMode: 'derived_only' as const,
    registry: {
      inspectedAt: '2026-01-01T00:00:00.000Z',
      legalStatus: 'approved' as const,
      allowedContentModes: ['derived_only'],
    },
    rights: {
      commercialUse: 'allowed' as const,
      automatedAccess: 'allowed' as const,
      archivalUse: 'allowed' as const,
      redistribution: 'allowed' as const,
      accessConstraint: 'none' as const,
      attributionRequired: true,
    },
    evidence: [{
      evidenceId: `terms-${category}`,
      evidenceUrl: `https://example.test/${category}`,
      observedAt: '2026-01-01T00:00:00.000Z',
      evidenceSha256: hash(`terms-${category}`),
      summary: `Approved ${category} fixture terms.`,
    }],
    limitations: [],
  })),
});

const fixture = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { privateKey: operatorPrivateKey, publicKey: operatorPublicKey } = generateKeyPairSync('ed25519');
  const keyringBody = {
    recordType: 'contextual_archive_trusted_principal_registry' as const,
    schemaVersion: CONTEXTUAL_ARCHIVE_APPROVER_KEYRING_VERSION,
    keys: [{
      keyId: 'review-key-1', approverIdentity: 'independent-reviewer', role: 'approver' as const, algorithm: 'ed25519' as const,
      publicKeySpkiPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-02-01T00:00:00.000Z',
      status: 'trusted' as const,
    }, {
      keyId: 'operator-key-1', approverIdentity: 'release-operator', role: 'operator' as const,
      algorithm: 'ed25519' as const,
      publicKeySpkiPem: operatorPublicKey.export({ type: 'spki', format: 'pem' }).toString(),
      validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-02-01T00:00:00.000Z',
      status: 'trusted' as const,
    }],
  };
  keyringBody.keys.sort((left, right) => left.keyId.localeCompare(right.keyId));
  const keyring: ContextualArchiveTrustedApproverKeyring = {
    ...keyringBody,
    keyringDigest: relationshipInputSha256(keyringBody),
  };
  const governancePacket = packet();
  const plans: ContextualSourceSnapshotPlan[] = [];
  const families: ContextualArchiveOperatorFamilyInput[] = CONTEXTUAL_SOURCE_FAMILIES.map((sourceFamily) => {
    const kind = kinds[sourceFamily];
    const contentSha256 = hash(`content-${sourceFamily}`);
    const manifestSha256 = hash(`manifest-${sourceFamily}`);
    const planWithoutDigest: Omit<ContextualSourceSnapshotPlan, 'planDigest'> = {
      recordType: 'contextual_source_snapshot_plan',
      schemaVersion: CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION,
      sourceFamily,
      kind,
      targetBinding,
      sourceIdentity: {
        sourceId: `source:${sourceFamily}`,
        providerId: `provider-${kind}`,
        datasetVersion: `dataset-${kind}-v1`,
        snapshotId: `snapshot:${sourceFamily}:v1`,
        contentSha256,
        manifestSha256,
      },
      capture: {
        mode: 'immutable_historical_snapshot', mutable: false, current: false,
        live: false, contentAddressed: true,
      },
      declaredCoverage: {
        start: '2025-12-31T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z',
        observedRecordCount: 1,
        coveredSubjectLedgerSha256: hash(`covered-ledger-file-${sourceFamily}`),
        missingSubjectLedgerSha256: hash(`missing-ledger-file-${sourceFamily}`),
      },
    };
    const plan = { ...planWithoutDigest, planDigest: contextualSourceCensusSha256(planWithoutDigest) };
    plans.push(plan);
    const snapshot = buildGovernedContextualSourceSnapshot({
      binding,
      kind,
      sourceFamily,
      sourceId: plan.sourceIdentity.sourceId,
      providerId: plan.sourceIdentity.providerId,
      datasetVersion: plan.sourceIdentity.datasetVersion,
      coverageWindow: {
        start: plan.declaredCoverage.start,
        end: plan.declaredCoverage.end,
      },
      materializedAt: '2026-01-03T00:00:00.000Z',
      contentSha256,
    });
    return {
      sourceFamily,
      plan,
      planDigest: plan.planDigest,
      planCanonicalSha256: hash(`plan-file-${sourceFamily}`),
      governancePacket,
      governancePacketDigest: governancePacket.packetDigest,
      governancePacketCanonicalSha256: hash(`governance-file-${sourceFamily}`),
      canonicalSource: `SOURCE_${kind.toUpperCase()}`,
      snapshot,
      sourceSnapshotDigest: snapshot.snapshotDigest,
      localSourceManifestCanonicalSha256: hash(`local-manifest-${sourceFamily}`),
      sourcePageCount: 1,
      sourcePageSetSha256: hash(`page-set-${sourceFamily}`),
      sourceContentSha256: contentSha256,
      observedRecordCount: 1,
      coveredSubjectCount: 1,
      missingSubjectCount: 0,
      coveredSubjectAddressSetSha256: relationshipInputSha256([subjectAddress]),
      missingSubjectAddressSetSha256: relationshipInputSha256([]),
      coveredSubjectLedgerCanonicalSha256: plan.declaredCoverage.coveredSubjectLedgerSha256,
      missingSubjectLedgerCanonicalSha256: plan.declaredCoverage.missingSubjectLedgerSha256,
      sourceRowDigestSetSha256: relationshipInputSha256([hash(`source-row-${sourceFamily}`)]),
      coveredSubjectAddresses: [subjectAddress],
      missingSubjectAddresses: [],
      sourceRowDigests: [hash(`source-row-${sourceFamily}`)],
      source: { inspectSnapshot: async () => snapshot, fetchPage: async () => { throw new Error('unused'); } },
      resolveRelationshipRecord: async () => null,
    };
  });
  const sources = families.map((family) => ({
    sourceFamily: family.sourceFamily,
    kind: family.snapshot.kind,
    planDigest: family.planDigest,
    canonicalFileSha256: family.planCanonicalSha256,
    snapshotId: family.plan.sourceIdentity.snapshotId,
    contentSha256: family.sourceContentSha256,
    manifestSha256: family.plan.sourceIdentity.manifestSha256,
    coverageStart: family.plan.declaredCoverage.start,
    coverageEnd: family.plan.declaredCoverage.end,
    observedRecordCount: 1,
    coveredSubjectCount: 1,
    missingSubjectCount: 0,
    coveredSubjectAddressSetSha256: targetBinding.subjectAddressSetSha256,
    missingSubjectAddressSetSha256: hash([] as never),
    status: 'declared_ready_for_materialization_review' as const,
  }));
  const censusWithoutDigest: Omit<ContextualSourceReadinessCensus, 'censusDigest'> = {
    recordType: 'contextual_source_readiness_census',
    schemaVersion: CONTEXTUAL_SOURCE_CENSUS_VERSION,
    purpose: 'readiness_census_only',
    authorizationCeiling: 'no_materialization_no_evidence_credit',
    targetBinding,
    targetArtifacts: {
      universeCompletionCanonicalSha256: hash('universe-file'),
      relationshipCompletionCanonicalSha256: hash('relationship-completion-file'),
      relationshipManifestCanonicalSha256: hash('relationship-manifest-file'),
      relationshipRecordsCanonicalSha256: hash('relationship-records-file'),
      relationshipRarityCanonicalSha256: hash('rarity-file'),
      relationshipLineageCanonicalSha256: hash('lineage-file'),
    },
    governance: {
      governanceDigest: hash('census-governance'),
      canonicalFileSha256: hash('census-governance-file'),
      thresholdPolicyDigest: CONTEXTUAL_SOURCE_THRESHOLD_POLICY_DIGEST,
    },
    sources,
    accounting: {
      requiredFamilyCount: 4,
      acceptedFamilyCount: 4,
      declaredObservedRecordCount: 4,
      derivedCoveredSubjectCount: 4,
      derivedMissingSubjectCount: 0,
    },
    guarantees: {
      evidenceCredit: 0, sourceClosure: false, materializationsCreated: 0,
      providerCalls: 0, providerBytesDownloaded: 0, databaseReads: 0,
      databaseWrites: 0, storageReads: 0, storageWrites: 0, lunaCalls: 0,
      contextualEdgesCreated: 0, publicationMutations: 0, deployments: 0,
    },
  };
  const census = { ...censusWithoutDigest, censusDigest: contextualSourceCensusSha256(censusWithoutDigest) };
  const censusCanonicalSha256 = hash('census-file');
  const approvalPayload = buildContextualArchiveOperatorApprovalPayload({
    approvalId: '22222222-2222-4222-8222-222222222222',
    approvedBy: 'independent-reviewer',
    approverKeyId: 'review-key-1',
    trustedRegistryDigest: keyring.keyringDigest,
    approvedAt: '2026-01-04T00:00:00.000Z',
    expiresAt: '2026-01-05T00:00:00.000Z',
    census,
    censusCanonicalSha256,
    families,
    authorizationStatement: contextualArchiveOperatorAuthorizationStatement,
    conditionalR2WritesApproved: true,
    providerCallsApproved: false,
    databaseWritesApproved: false,
    lunaCallsApproved: false,
    legacyScoreDerivationApproved: false,
    evidenceCreditApproved: false,
    publicationMutationApproved: false,
    deploymentApproved: false,
  });
  const approval = signApproval(approvalPayload, privateKey);
  const executionPayload = buildContextualArchiveExecutionAuthorizationPayload({
    authorizationId: '44444444-4444-4444-8444-444444444444',
    nonce: 'operator-run-1', operatorId: 'release-operator', operatorKeyId: 'operator-key-1',
    trustedRegistryDigest: keyring.keyringDigest,
    authorizedAt: '2026-01-04T00:30:00.000Z', expiresAt: '2026-01-05T00:00:00.000Z',
    approval, census, censusCanonicalSha256, families,
  });
  const executionAuthorization = signExecution(executionPayload, operatorPrivateKey);
  return {
    census, censusCanonicalSha256, families, approval, keyring, privateKey,
    operatorPrivateKey, executionAuthorization,
  };
};

const storage = {} as CaseGraphConditionalArchiveStorage;
const completion = (family: ContextualArchiveOperatorFamilyInput) => ({
  manifestDigest: hash(`completion-${family.sourceFamily}`),
  archiveSetSha256: hash(`archive-${family.sourceFamily}`),
  sourcePageCount: family.sourcePageCount,
  sourcePageSetSha256: family.sourcePageSetSha256,
  rowCount: family.observedRecordCount,
  emittedEdgeCount: 1,
  insufficientEvidenceCount: 0,
});
const reapprove = (
  current: ReturnType<typeof fixture>,
  families: ContextualArchiveOperatorFamilyInput[],
  census = current.census,
) => signApproval(buildContextualArchiveOperatorApprovalPayload({
  approvalId: current.approval.approvalId,
  approvedBy: current.approval.approvedBy,
  approverKeyId: current.approval.approverKeyId,
  trustedRegistryDigest: current.keyring.keyringDigest,
  approvedAt: current.approval.approvedAt,
  expiresAt: current.approval.expiresAt,
  census,
  censusCanonicalSha256: current.censusCanonicalSha256,
  families,
  authorizationStatement: contextualArchiveOperatorAuthorizationStatement,
  conditionalR2WritesApproved: true,
  providerCallsApproved: false,
  databaseWritesApproved: false,
  lunaCallsApproved: false,
  legacyScoreDerivationApproved: false,
  evidenceCreditApproved: false,
  publicationMutationApproved: false,
  deploymentApproved: false,
}), current.privateKey);
const reauthorize = (
  current: ReturnType<typeof fixture>,
  approval = current.approval,
  families = current.families,
) => signExecution(buildContextualArchiveExecutionAuthorizationPayload({
  authorizationId: current.executionAuthorization.authorizationId,
  nonce: current.executionAuthorization.nonce,
  operatorId: current.executionAuthorization.operatorId,
  operatorKeyId: current.executionAuthorization.operatorKeyId,
  trustedRegistryDigest: current.keyring.keyringDigest,
  authorizedAt: current.executionAuthorization.authorizedAt,
  expiresAt: current.executionAuthorization.expiresAt,
  approval,
  census: current.census,
  censusCanonicalSha256: current.censusCanonicalSha256,
  families,
}), current.operatorPrivateKey);

describe('contextual archive aggregate operator', () => {
  it('requires an exact fresh stage-bound approval and rejects a changed receipt', () => {
    const current = fixture();
    expect(verifyContextualArchiveOperatorApproval({
      value: current.approval, keyring: current.keyring, now: new Date('2026-01-04T01:00:00.000Z'),
    })).toEqual(current.approval);
    expect(() => verifyContextualArchiveOperatorApproval({
      value: { ...current.approval, censusCanonicalSha256: hash('different-census-file') },
      keyring: current.keyring, now: new Date('2026-01-04T01:00:00.000Z'),
    })).toThrow('contextual_archive_operator_approval_mismatch');

    const changedWithoutDigest = {
      ...current.census,
      sources: current.census.sources.map((source, index) => index === 0
        ? { ...source, kind: 'weather' as const } : source),
    };
    const { censusDigest: _oldDigest, ...resealedBody } = changedWithoutDigest;
    const resealed = {
      ...resealedBody,
      censusDigest: contextualSourceCensusSha256(resealedBody),
    } as ContextualSourceReadinessCensus;
    expect(() => reapprove(current, current.families, resealed))
      .toThrow('contextual_archive_operator_census_source_invalid');

    expect(() => validateContextualArchiveOperatorInputs({
      census: current.census,
      censusCanonicalSha256: current.censusCanonicalSha256,
      families: current.families.map((family, index) => index === 0
        ? { ...family, canonicalSource: 'WRONG_SOURCE' } : family),
      governanceAt: new Date('2026-01-04T00:00:00.000Z'),
    })).toThrow('contextual_archive_governance_decision_missing');
    expect(() => validateContextualArchiveOperatorInputs({
      census: current.census,
      censusCanonicalSha256: current.censusCanonicalSha256,
      families: current.families,
      governanceAt: new Date('2026-03-15T00:00:00.000Z'),
    })).toThrow('contextual_archive_governance_packet_stale');
    expect(() => verifyContextualArchiveOperatorApproval({
      value: { ...current.approval, conditionalR2WritesApproved: false },
      keyring: current.keyring, now: new Date('2026-01-04T01:00:00.000Z'),
    })).toThrow();
  });

  it('requires a trusted Ed25519 signer and rejects a resealed invalid signature', () => {
    const current = fixture();
    const untrustedBody = {
      ...current.keyring,
      keys: current.keyring.keys.map((key) => key.role === 'approver'
        ? { ...key, keyId: 'untrusted-review-key' } : key)
        .sort((left, right) => left.keyId.localeCompare(right.keyId)),
    };
    const { keyringDigest: _digest, ...untrustedWithoutDigest } = untrustedBody;
    expect(() => verifyContextualArchiveOperatorApproval({
      value: current.approval,
      keyring: { ...untrustedWithoutDigest, keyringDigest: relationshipInputSha256(untrustedWithoutDigest) },
      now: new Date('2026-01-04T01:00:00.000Z'),
    })).toThrow('contextual_archive_operator_registry_digest_mismatch');
    expect(() => verifyContextualArchiveOperatorApproval({
      value: current.approval,
      keyring: CONTEXTUAL_ARCHIVE_PRODUCTION_TRUST_REGISTRY,
      now: new Date('2026-01-04T01:00:00.000Z'),
    })).toThrow('contextual_archive_operator_registry_digest_mismatch');
    expect(verifyContextualArchiveExecutionAuthorization({
      value: current.executionAuthorization,
      keyring: current.keyring,
      now: new Date('2026-01-04T01:00:00.000Z'),
    })).toEqual(current.executionAuthorization);
    const duplicateKeyBody = {
      ...current.keyring,
      keys: current.keyring.keys.map((key) => key.role === 'operator'
        ? { ...key, publicKeySpkiPem: current.keyring.keys.find(({ role }) => role === 'approver')!.publicKeySpkiPem }
        : key),
    };
    const { keyringDigest: _duplicateDigest, ...duplicateKeyWithoutDigest } = duplicateKeyBody;
    expect(() => verifyContextualArchiveTrustedApproverKeyring({
      ...duplicateKeyWithoutDigest,
      keyringDigest: relationshipInputSha256(duplicateKeyWithoutDigest),
    })).toThrow('contextual_archive_operator_keyring_duplicate_public_key');

    const changedSignature = Buffer.from(current.approval.signatureBase64, 'base64');
    changedSignature[0] ^= 1;
    const signedWithoutDigest = {
      ...current.approval,
      signatureBase64: changedSignature.toString('base64'),
    };
    const { approvalSha256: _approvalSha, ...resealed } = signedWithoutDigest;
    expect(() => verifyContextualArchiveOperatorApproval({
      value: { ...resealed, approvalSha256: relationshipInputSha256(resealed) },
      keyring: current.keyring,
      now: new Date('2026-01-04T01:00:00.000Z'),
    })).toThrow('contextual_archive_operator_approval_signature_invalid');
    const forgedOperatorSignature = Buffer.from(current.executionAuthorization.signatureBase64, 'base64');
    forgedOperatorSignature[0] ^= 1;
    const { authorizationSha256: _authorizationSha256, ...forgedExecutionBody } = {
      ...current.executionAuthorization,
      signatureBase64: forgedOperatorSignature.toString('base64'),
    };
    expect(() => verifyContextualArchiveExecutionAuthorization({
      value: {
        ...forgedExecutionBody,
        authorizationSha256: relationshipInputSha256(forgedExecutionBody),
      },
      keyring: current.keyring,
      now: new Date('2026-01-04T01:00:00.000Z'),
    })).toThrow('contextual_archive_execution_authorization_signature_invalid');
  });

  it('completes and verifies exactly four families with zero-credit accounting', async () => {
    const current = fixture();
    const archiveFamily = vi.fn(async ({ source }: any) => {
      const snapshot = await source.inspectSnapshot();
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      return { status: 'completed' as const, snapshot, completion: completion(family) };
    });
    const verifyFamily = vi.fn(async ({ snapshot, onRecord }: any) => {
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      await onRecord({ recordDigest: hash(`record-${family.sourceFamily}`), sourceRowDigest: family.sourceRowDigests[0], address: subjectAddress });
      return { completion: completion(family), verifiedRowCount: 1 };
    });
    const receipt = await runContextualArchiveOperator({
      storage,
      ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      operationId: '33333333-3333-4333-8333-333333333333',
      dependencies: { archiveFamily: archiveFamily as never, verifyFamily: verifyFamily as never },
    });
    expect(archiveFamily).toHaveBeenCalledTimes(4);
    expect(verifyFamily).toHaveBeenCalledTimes(4);
    expect(receipt.accounting).toEqual({
      requiredFamilyCount: 4, completedFamilyCount: 4, verifiedRowCount: 4,
      emittedEdgeCount: 4, insufficientEvidenceCount: 0,
    });
    expect(receipt.guarantees).toMatchObject({
      providerCalls: 0, providerSpend: 0, databaseWrites: 0, lunaCalls: 0,
      legacyScoreDerivations: 0, evidenceCredit: 0, publicationMutations: 0, deployments: 0,
    });
    expect(verifyContextualArchiveOperatorReceipt(receipt)).toEqual(receipt);
    expect(() => verifyContextualArchiveOperatorReceipt({
      ...receipt,
      accounting: { ...receipt.accounting, verifiedRowCount: 3 },
    })).toThrow('contextual_archive_operator_receipt_mismatch');
    const { receiptSha256: _receiptSha256, ...receiptBody } = receipt;
    const impossibleBody = {
      ...receiptBody,
      families: receipt.families.map((family, index) => index === 0
        ? { ...family, emittedEdgeCount: 0 } : family),
      accounting: { ...receipt.accounting, emittedEdgeCount: 3 },
    };
    expect(() => verifyContextualArchiveOperatorReceipt({
      ...impossibleBody, receiptSha256: relationshipInputSha256(impossibleBody),
    })).toThrow('contextual_archive_operator_receipt_invalid');
  });

  it('stops on one family failure and resumes exact earlier families on retry', async () => {
    const current = fixture();
    let first = true;
    const calls: string[] = [];
    const archiveFamily = vi.fn(async ({ source }: any) => {
      const snapshot = await source.inspectSnapshot();
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      calls.push(family.sourceFamily);
      if (first && family.sourceFamily === 'astronomy_ephemeris_history') throw new Error('simulated_interruption');
      const prior = CONTEXTUAL_SOURCE_FAMILIES.indexOf(family.sourceFamily) < 2;
      return { status: (!first && prior ? 'resumed' : 'completed') as 'resumed' | 'completed', snapshot, completion: completion(family) };
    });
    const verifyFamily = vi.fn(async ({ snapshot, onRecord }: any) => {
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      await onRecord({ recordDigest: hash(`record-${family.sourceFamily}`), sourceRowDigest: family.sourceRowDigests[0], address: subjectAddress });
      return { completion: completion(family), verifiedRowCount: 1 };
    });
    const args = {
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      operationId: '33333333-3333-4333-8333-333333333333',
      dependencies: { archiveFamily: archiveFamily as never, verifyFamily: verifyFamily as never },
    };
    await expect(runContextualArchiveOperator(args)).rejects.toThrow(
      'contextual_archive_operator_family_failed:astronomy_ephemeris_history:simulated_interruption',
    );
    expect(calls).toEqual(CONTEXTUAL_SOURCE_FAMILIES.slice(0, 3));
    first = false;
    const receipt = await runContextualArchiveOperator(args);
    expect(receipt.families.map(({ outcome }) => outcome)).toEqual([
      'resumed', 'resumed', 'completed', 'completed',
    ]);
  });

  it('fails closed on post-write verification failure and identity reuse', async () => {
    const current = fixture();
    const archiveFamily = async ({ source }: any) => {
      const snapshot = await source.inspectSnapshot();
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      return { status: 'completed' as const, snapshot, completion: completion(family) };
    };
    await expect(runContextualArchiveOperator({
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: {
        archiveFamily: archiveFamily as never,
        verifyFamily: (async () => { throw new Error('readback_corrupt'); }) as never,
      },
    })).rejects.toThrow('contextual_archive_operator_family_failed:aircraft_adsb_history:readback_corrupt');
    const forgedExecution = signExecution({
      ...buildContextualArchiveExecutionAuthorizationPayload({
        authorizationId: current.executionAuthorization.authorizationId,
        nonce: 'forged-same-principal', operatorId: current.approval.approvedBy,
        operatorKeyId: current.approval.approverKeyId,
        trustedRegistryDigest: current.keyring.keyringDigest,
        authorizedAt: current.executionAuthorization.authorizedAt,
        expiresAt: current.executionAuthorization.expiresAt,
        approval: current.approval, census: current.census,
        censusCanonicalSha256: current.censusCanonicalSha256, families: current.families,
      }),
    }, current.privateKey);
    await expect(runContextualArchiveOperator({
      storage, ...current, executionAuthorization: forgedExecution,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
    })).rejects.toThrow('contextual_archive_execution_authorization_key_scope_invalid');
  });

  it('never credits a newly approved page set to an older resumed archive', async () => {
    const current = fixture();
    const changedFamilies = current.families.map((family, index) => index === 0 ? {
      ...family,
      localSourceManifestCanonicalSha256: hash('changed-local-manifest'),
      sourcePageSetSha256: hash('changed-page-set'),
    } : family);
    const approval = reapprove(current, changedFamilies);
    const executionAuthorization = reauthorize(current, approval, changedFamilies);
    const archiveFamily = async ({ source }: any) => {
      const snapshot = await source.inspectSnapshot();
      const oldFamily = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      return { status: 'resumed' as const, snapshot, completion: completion(oldFamily) };
    };
    const verifyFamily = async ({ snapshot, onRecord }: any) => {
      const oldFamily = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      await onRecord({ recordDigest: hash(`record-${oldFamily.sourceFamily}`), sourceRowDigest: oldFamily.sourceRowDigests[0], address: subjectAddress });
      return { completion: completion(oldFamily), verifiedRowCount: 1 };
    };
    await expect(runContextualArchiveOperator({
      storage,
      census: current.census,
      censusCanonicalSha256: current.censusCanonicalSha256,
      families: changedFamilies,
      approval,
      executionAuthorization,
      keyring: current.keyring,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: { archiveFamily: archiveFamily as never, verifyFamily: verifyFamily as never },
    })).rejects.toThrow(
      'contextual_archive_operator_family_failed:aircraft_adsb_history:contextual_archive_operator_source_page_set_mismatch',
    );
  });

  it('rejects zero archive rows, coverage mismatch, and duplicate records against census accounting', async () => {
    const current = fixture();
    const archiveFamily = async ({ source }: any) => {
      const snapshot = await source.inspectSnapshot();
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      return { status: 'completed' as const, snapshot, completion: completion(family) };
    };
    await expect(runContextualArchiveOperator({
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: {
        archiveFamily: archiveFamily as never,
        verifyFamily: (async ({ snapshot }: any) => {
          const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
          return { completion: { ...completion(family), rowCount: 0 }, verifiedRowCount: 0 };
        }) as never,
      },
    })).rejects.toThrow('contextual_archive_operator_archive_accounting_mismatch');

    await expect(runContextualArchiveOperator({
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: {
        archiveFamily: archiveFamily as never,
        verifyFamily: (async ({ snapshot, onRecord }: any) => {
          const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
          await onRecord({
            recordDigest: hash(`record-${family.sourceFamily}`),
            sourceRowDigest: hash(`different-source-row-${family.sourceFamily}`),
            address: subjectAddress,
          });
          return { completion: completion(family), verifiedRowCount: 1 };
        }) as never,
      },
    })).rejects.toThrow('contextual_archive_operator_archive_accounting_mismatch');

    await expect(runContextualArchiveOperator({
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: {
        archiveFamily: archiveFamily as never,
        verifyFamily: (async ({ snapshot, onRecord }: any) => {
          const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
          await onRecord({ recordDigest: hash('duplicate-record'), sourceRowDigest: family.sourceRowDigests[0], address: subjectAddress });
          await onRecord({ recordDigest: hash('duplicate-record'), sourceRowDigest: family.sourceRowDigests[0], address: subjectAddress });
          return { completion: completion(family), verifiedRowCount: 1 };
        }) as never,
      },
    })).rejects.toThrow('contextual_archive_operator_duplicate_archive_record');

    await expect(runContextualArchiveOperator({
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: {
        archiveFamily: archiveFamily as never,
        verifyFamily: (async ({ snapshot, onRecord }: any) => {
          const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
          await onRecord({ recordDigest: hash(`record-${family.sourceFamily}`), sourceRowDigest: family.sourceRowDigests[0], address: 'sighting:00000000-0000-4000-8000-000000000999' });
          return { completion: completion(family), verifiedRowCount: 1 };
        }) as never,
      },
    })).rejects.toThrow('contextual_archive_operator_archive_accounting_mismatch');
  });

  it('fails closed when four safe family counts overflow their aggregate', async () => {
    const current = fixture();
    const archiveFamily = async ({ source }: any) => {
      const snapshot = await source.inspectSnapshot();
      const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
      return { status: 'completed' as const, snapshot, completion: completion(family) };
    };
    await expect(runContextualArchiveOperator({
      storage, ...current,
      now: () => new Date('2026-01-04T01:00:00.000Z'),
      dependencies: {
        archiveFamily: archiveFamily as never,
        verifyFamily: (async ({ snapshot, onRecord }: any) => {
          const family = current.families.find((item) => item.snapshot.snapshotDigest === snapshot.snapshotDigest)!;
          await onRecord({ recordDigest: hash(`record-${family.sourceFamily}`), sourceRowDigest: family.sourceRowDigests[0], address: subjectAddress });
          return {
            completion: { ...completion(family), emittedEdgeCount: Number.MAX_SAFE_INTEGER },
            verifiedRowCount: 1,
          };
        }) as never,
      },
    })).rejects.toThrow('contextual_archive_operator_receipt_accounting_overflow');
  });
});
