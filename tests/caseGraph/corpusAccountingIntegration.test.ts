import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { getEvidenceUniversePartKeys } from '../../src/caseGraph/archiveKeys';
import { CASE_GRAPH_PUBLIC_MANIFEST_VERSION } from '../../src/caseGraph/publicationManifest';
import {
  EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
  type EvidenceUniverseCompletion,
  type EvidenceUniversePart,
} from '../../src/caseGraph/evidenceUniverseArchive';
import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  accountEvidenceUniverseNodes,
  projectEvidenceUniverseNode,
  type EvidenceUniverseNode,
  type EvidenceUniverseNodeKind,
} from '../../src/caseGraph/evidenceUniverse';
import {
  EVIDENCE_MEDIA_SNAPSHOT_POLICY,
  EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
} from '../../src/caseGraph/postgresEvidenceMediaSource';
import { EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY } from '../../src/caseGraph/postgresEvidenceUniverseSnapshot';
import {
  buildRelationshipInputPart,
  buildRelationshipInputSnapshotManifest,
} from '../../src/caseGraph/relationshipInputArchive';
import {
  canonicalizeRelationshipInput,
  type RelationshipInputUniverseBinding,
} from '../../src/caseGraph/relationshipInputSnapshot';
import { extractRelationshipInputRecord } from '../../src/caseGraph/relationshipInputExtraction';
import {
  buildCaseVortexAccountingPublicationBinding,
  buildCaseVortexAddressLedgerManifest,
  buildCaseVortexAddressLedgerPart,
  buildCaseVortexCorpusAccountingFromArtifacts,
  canonicalizeCaseVortexAccountingArtifact,
  caseVortexAccountingArtifactSha256,
  caseVortexCorpusAccountingReceiptSha256,
  decodeCaseVortexCorpusAccountingReceipt,
  encodeCaseVortexAddressLedgerManifest,
  encodeCaseVortexCorpusAccountingReceipt,
  verifyCaseVortexAddressLedger,
  type CaseVortexAccountingLedgerBinding,
  type CaseVortexAddressLedgerPartSummary,
  type CaseVortexCorpusAccountingArtifactInput,
  type CaseVortexObservationAddressRecord,
  type CaseVortexStageAddressRecord,
} from '../../src/caseGraph/corpusAccountingIntegration';

const corpusVersion = 'full-corpus-accounting-v3';
const snapshotId = '33333333-3333-4333-8333-333333333333';
const generatedAt = '2026-07-17T18:30:00.000Z';
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

const makeNode = (kind: EvidenceUniverseNodeKind, recordId: string): EvidenceUniverseNode => (
  projectEvidenceUniverseNode({
    kind,
    recordId,
    source: kind === 'sighting' ? 'nuforc' : 'uap-files',
    sourceRecordId: `source-${recordId}`,
    title: kind === 'sighting' ? 'Triangle report' : 'Photographic attachment',
    summary: kind === 'sighting'
      ? 'A silent triangle hovered for five minutes.'
      : 'Image attached to the governed sighting record.',
    canonicalUrl: `https://example.test/${kind}/${recordId}`,
    previewUrl: kind === 'photo' ? `https://example.test/previews/${recordId}.jpg` : null,
    eventTimestamp: '2026-07-17T15:00:00.000Z',
    lat: 51.5,
    lon: -0.1,
    location: 'London',
    countryCode: 'GB',
    linkedSightingId: kind === 'photo' ? 's-1' : null,
    updatedAt: '2026-07-17T16:00:00.000Z',
    public: true,
  })
);

const universeFixture = () => {
  const nodes = [makeNode('sighting', 's-1'), makeNode('photo', 'p-1')];
  const parts: Array<{ part: EvidenceUniversePart; archiveBody: Buffer }> = nodes.map((node) => {
    const raw = Buffer.from(`${JSON.stringify(node)}\n`);
    const archiveBody = gzipSync(raw);
    const keys = getEvidenceUniversePartKeys(corpusVersion, node.kind, 0);
    const part: EvidenceUniversePart = {
      partNumber: 0,
      kind: node.kind,
      rowCount: 1,
      archiveKey: keys.archiveKey,
      manifestKey: keys.manifestKey,
      compressedBytes: archiveBody.length,
      uncompressedBytes: raw.length,
      sha256: sha(archiveBody),
      firstAddress: node.address,
      lastAddress: node.address,
      cursor: node.kind === 'sighting'
        ? { updated_at: node.updatedAt, case_id: node.recordId }
        : { updatedAt: node.updatedAt, recordId: node.recordId },
      accounting: accountEvidenceUniverseNodes([node]),
    };
    return { part, archiveBody };
  });
  // Archive-v3 parts are ordered by the governed kind sequence.
  parts.sort((left, right) => (
    ['sighting', 'document', 'photo', 'video'].indexOf(left.part.kind)
    - ['sighting', 'document', 'photo', 'video'].indexOf(right.part.kind)
  ));
  const byKind = { sighting: 1, document: 0, photo: 1, video: 0 };
  const accounting = accountEvidenceUniverseNodes(nodes);
  const completion: EvidenceUniverseCompletion = {
    recordType: 'evidence_universe_completion',
    archiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    schemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    layoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    corpusVersion,
    expected: {
      snapshotId,
      snapshotAt: '2026-07-17T17:00:00.000Z',
      materializedAt: '2026-07-17T16:59:59.999321Z',
      sourceMvccSnapshot: '100:200:',
      snapshotPolicy: EVIDENCE_UNIVERSE_MATERIALIZED_SNAPSHOT_POLICY,
      capturePolicies: {
        sighting: EVIDENCE_UNIVERSE_SIGHTING_CAPTURE_POLICY,
        document: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        photo: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
        video: EVIDENCE_MEDIA_SNAPSHOT_POLICY,
      },
      byKind,
      total: 2,
      sightingPolicy: 'public-corpus-v3',
      mediaBackfillsComplete: { document: true, photo: true, video: true },
    },
    exportedByKind: byKind,
    cursors: {
      sighting: { updated_at: nodes[0].updatedAt, case_id: nodes[0].recordId },
      document: null,
      photo: { updatedAt: nodes[1].updatedAt, recordId: nodes[1].recordId },
      video: null,
    },
    parts: parts.map(({ part }) => part),
    accounting,
    archiveSetSha256: sha(parts.map(({ part }) => `${part.kind}:${part.partNumber}:${part.sha256}`).join('\n')),
    completedAt: '2026-07-17T18:00:00.000Z',
  };
  return { nodes, parts, completion, completionBody: Buffer.from(`${JSON.stringify(completion)}\n`) };
};

const relationshipFixture = (universe: ReturnType<typeof universeFixture>) => {
  const binding: RelationshipInputUniverseBinding = {
    snapshotId,
    corpusVersion,
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: universe.completion.archiveSetSha256,
    universeRecordCount: universe.nodes.length,
  };
  const records = universe.nodes.map((node) => extractRelationshipInputRecord(node, {
    binding,
    vectorPolicy: {
      modelId: 'uap-narrative-encoder',
      modelVersion: '2026-07-18',
      dimensions: 768,
      normalization: 'l2',
    },
  }));
  const part = buildRelationshipInputPart({ binding, partNumber: 0, records });
  const manifest = buildRelationshipInputSnapshotManifest({
    binding,
    parts: [part.manifest],
    generatedAt,
  });
  return {
    manifest,
    manifestBody: Buffer.from(`${canonicalizeRelationshipInput(manifest)}\n`),
    parts: [{ partNumber: 0, archiveBody: part.archiveBody }],
  };
};

const observationRecords = (): CaseVortexObservationAddressRecord[] => [
  {
    recordType: 'case_vortex_observation_address',
    status: 'captured',
    kind: 'photo',
    recordId: 'p-1',
    address: 'photo:p-1',
  },
  {
    recordType: 'case_vortex_observation_address',
    status: 'captured',
    kind: 'sighting',
    recordId: 's-1',
    address: 'sighting:s-1',
  },
  {
    recordType: 'case_vortex_observation_address',
    status: 'excluded',
    kind: 'video',
    recordId: 'private-v-1',
    address: 'video:private-v-1',
    exclusion: {
      reason: 'not_public',
      policyRule: 'public-corpus-v3',
      evidenceReference: 'governed-observation-ledger/video/private-v-1',
    },
  },
];

const stageRecords = (stage: 'graph' | 'user_interface'): CaseVortexStageAddressRecord[] => [
  {
    recordType: 'case_vortex_stage_address',
    stage,
    kind: 'photo',
    recordId: 'p-1',
    address: 'photo:p-1',
    artifact: stage === 'graph'
      ? { graphShard: 0, nodeOffset: 0, isolated: false }
      : { universePart: 1, rowOffset: 0, detailPath: '/explore?address=photo%3Ap-1' },
  },
  {
    recordType: 'case_vortex_stage_address',
    stage,
    kind: 'sighting',
    recordId: 's-1',
    address: 'sighting:s-1',
    artifact: stage === 'graph'
      ? { graphShard: 0, nodeOffset: 1, isolated: false }
      : { universePart: 0, rowOffset: 0, detailPath: '/explore?address=sighting%3As-1' },
  },
];

const fixture = (overrides: {
  graphParts?: CaseVortexStageAddressRecord[][];
  uiParts?: CaseVortexStageAddressRecord[][];
  graphBindingSnapshotId?: string;
} = {}): CaseVortexCorpusAccountingArtifactInput => {
  const universe = universeFixture();
  const relationship = relationshipFixture(universe);
  const ledgerBinding: CaseVortexAccountingLedgerBinding = {
    corpusVersion,
    snapshotId,
    universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
    universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
    universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
    universeArchiveSetSha256: universe.completion.archiveSetSha256,
    universeRecordCount: 2,
    relationshipInputSchemaVersion: relationship.manifest.schemaVersion,
    relationshipInputArchiveSetSha256: relationship.manifest.archiveSetSha256,
    relationshipInputManifestDigest: relationship.manifest.manifestDigest,
    relationshipInputRecordCount: 2,
    policyVersion: 'public-corpus-v3',
  };
  const observationPart = buildCaseVortexAddressLedgerPart({
    stage: 'observation',
    partNumber: 0,
    records: observationRecords(),
  });
  const observationManifest = buildCaseVortexAddressLedgerManifest({
    stage: 'observation',
    binding: ledgerBinding,
    publicationSha256: null,
    parts: [observationPart.summary],
    generatedAt,
  });

  const graphPartRecords = overrides.graphParts || [stageRecords('graph')];
  const graphParts = graphPartRecords.map((records, partNumber) => buildCaseVortexAddressLedgerPart({
    stage: 'graph', partNumber, records,
  }));
  const graphManifest = buildCaseVortexAddressLedgerManifest({
    stage: 'graph',
    binding: { ...ledgerBinding, snapshotId: overrides.graphBindingSnapshotId || ledgerBinding.snapshotId },
    publicationSha256: null,
    parts: graphParts.map((part) => part.summary),
    generatedAt,
  });
  const graphManifestBody = encodeCaseVortexAddressLedgerManifest(graphManifest);
  const accountingBinding = buildCaseVortexAccountingPublicationBinding({
    ledgerBinding: graphManifest.binding,
    graphLedgerManifest: graphManifest,
    graphLedgerManifestBody: graphManifestBody,
  });
  const graphPublicationManifestBody = Buffer.from(`${canonicalizeCaseVortexAccountingArtifact({
    recordType: 'case_vortex_public_manifest',
    schemaVersion: CASE_GRAPH_PUBLIC_MANIFEST_VERSION,
    accountingBinding,
  })}\n`);
  const graphPublicationSha256 = caseVortexAccountingArtifactSha256(graphPublicationManifestBody);

  const uiPartRecords = overrides.uiParts || [stageRecords('user_interface')];
  const uiParts = uiPartRecords.map((records, partNumber) => buildCaseVortexAddressLedgerPart({
    stage: 'user_interface', partNumber, records,
  }));
  const uiManifest = buildCaseVortexAddressLedgerManifest({
    stage: 'user_interface',
    binding: ledgerBinding,
    publicationSha256: graphPublicationSha256,
    parts: uiParts.map((part) => part.summary),
    generatedAt,
  });

  return {
    corpusVersion,
    universe: {
      completionBody: universe.completionBody,
      parts: universe.parts.map(({ part, archiveBody }) => ({
        kind: part.kind,
        partNumber: part.partNumber,
        archiveBody,
      })),
    },
    relationshipInput: {
      snapshotManifestBody: relationship.manifestBody,
      parts: relationship.parts,
    },
    observationLedger: {
      manifestBody: encodeCaseVortexAddressLedgerManifest(observationManifest),
      parts: [{ partNumber: 0, records: observationPart.records }],
    },
    graphPublicationManifestBody,
    graphLedger: {
      manifestBody: graphManifestBody,
      parts: graphParts.map((part, partNumber) => ({ partNumber, records: part.records })),
    },
    userInterfaceLedger: {
      manifestBody: encodeCaseVortexAddressLedgerManifest(uiManifest),
      parts: uiParts.map((part, partNumber) => ({ partNumber, records: part.records })),
    },
  };
};

describe('production corpus-accounting integration', () => {
  it('rejects malformed artifact envelopes with one stable fail-closed diagnostic', async () => {
    await expect(buildCaseVortexCorpusAccountingFromArtifacts({
      corpusVersion,
      universe: null,
    } as unknown as CaseVortexCorpusAccountingArtifactInput))
      .rejects.toThrow('case_vortex_accounting_artifact_input_invalid');
  });

  it('derives every binding and pointer digest from verified artifact contents', async () => {
    const result = await buildCaseVortexCorpusAccountingFromArtifacts(fixture());
    expect(result.receipt).toMatchObject({
      complete: true,
      observedTotal: 3,
      representedTotal: 2,
      excludedTotal: 1,
      relationshipProcessedTotal: 2,
      observedByKind: { sighting: 1, document: 0, photo: 1, video: 1 },
      capturedByKind: { sighting: 1, document: 0, photo: 1, video: 0 },
      excludedByKind: { sighting: 0, document: 0, photo: 0, video: 1 },
    });
    expect(result.input.records.map((record) => record.address)).toEqual([
      'photo:p-1', 'sighting:s-1', 'video:private-v-1',
    ]);
    expect(result.receipt.binding.graphPublicationSha256).toBe(result.graphPublicationSha256);
    expect(result.receiptSha256).toBe(caseVortexCorpusAccountingReceiptSha256(result.receipt));
    expect(decodeCaseVortexCorpusAccountingReceipt(result.receiptBody)).toEqual(result.receipt);
    expect(encodeCaseVortexCorpusAccountingReceipt(result.receipt)).toEqual(result.receiptBody);
  });

  it('fails closed on an omitted UI address even when the smaller UI ledger is internally valid', async () => {
    const onlySighting = stageRecords('user_interface').filter((record) => record.kind === 'sighting');
    await expect(buildCaseVortexCorpusAccountingFromArtifacts(fixture({ uiParts: [onlySighting] })))
      .rejects.toThrow('case_vortex_accounting_ui_address_missing:photo:p-1');
  });

  it('fails closed on duplicate addresses across otherwise valid shards', async () => {
    const photo = stageRecords('graph').filter((record) => record.kind === 'photo');
    await expect(buildCaseVortexCorpusAccountingFromArtifacts(fixture({
      graphParts: [photo, photo],
    }))).rejects.toThrow('case_vortex_accounting_graph_address_duplicate_or_kind_mismatch:photo:p-1');
  });

  it('rejects a graph ledger from another immutable snapshot before reading its records', async () => {
    const input = fixture({ graphBindingSnapshotId: '44444444-4444-4444-8444-444444444444' });
    await expect(buildCaseVortexCorpusAccountingFromArtifacts(input))
      .rejects.toThrow('case_vortex_accounting_graph_ledger_binding_mismatch');
  });

  it('rejects a stage record whose declared kind does not match its canonical address', async () => {
    const input = fixture();
    input.userInterfaceLedger.parts = [{
      partNumber: 0,
      records: stageRecords('user_interface').map((record) => record.address === 'photo:p-1'
        ? { ...record, kind: 'video' as const }
        : record),
    }];
    await expect(buildCaseVortexCorpusAccountingFromArtifacts(input))
      .rejects.toThrow('case_vortex_address_ledger_record_identity_invalid');
  });

  it('rejects ledger receipt tampering and non-canonical stored receipt bytes', async () => {
    const input = fixture();
    const parsed = JSON.parse(input.graphLedger.manifestBody.toString('utf8')) as {
      parts: Array<{ recordSetSha256: string }>;
    };
    parsed.parts[0].recordSetSha256 = 'f'.repeat(64);
    input.graphLedger.manifestBody = Buffer.from(`${canonicalizeCaseVortexAccountingArtifact(parsed)}\n`);
    await expect(buildCaseVortexCorpusAccountingFromArtifacts(input))
      .rejects.toThrow(/case_vortex_address_ledger_manifest_integrity_invalid|case_vortex_accounting_graph_publication_binding_mismatch/);

    const valid = await buildCaseVortexCorpusAccountingFromArtifacts(fixture());
    const pretty = Buffer.from(`${JSON.stringify(valid.receipt, null, 2)}\n`);
    expect(() => decodeCaseVortexCorpusAccountingReceipt(pretty))
      .toThrow('case_vortex_corpus_accounting_receipt_non_canonical');

    const kindTamper = structuredClone(valid.receipt);
    kindTamper.capturedByKind.photo = 0;
    kindTamper.capturedByKind.sighting = 2;
    expect(() => decodeCaseVortexCorpusAccountingReceipt(encodeCaseVortexCorpusAccountingReceipt(kindTamper)))
      .toThrow('case_vortex_corpus_accounting_receipt_invalid');
  });

  it('streams and authenticates a 466,000-address ledger without a monolithic record array', async () => {
    const rowCount = 466_000;
    const rowsPerPart = 10_000;
    const partCount = Math.ceil(rowCount / rowsPerPart);
    const ledgerBinding: CaseVortexAccountingLedgerBinding = {
      corpusVersion: 'scale-466k-v1',
      snapshotId: '55555555-5555-4555-8555-555555555555',
      universeArchiveVersion: EVIDENCE_UNIVERSE_ARCHIVE_VERSION,
      universeSchemaVersion: EVIDENCE_UNIVERSE_SCHEMA_VERSION,
      universeLayoutVersion: EVIDENCE_UNIVERSE_LAYOUT_VERSION,
      universeArchiveSetSha256: 'a'.repeat(64),
      universeRecordCount: rowCount,
      relationshipInputSchemaVersion: 'relationship-input-snapshot-v2',
      relationshipInputArchiveSetSha256: 'b'.repeat(64),
      relationshipInputManifestDigest: 'c'.repeat(64),
      relationshipInputRecordCount: rowCount,
      policyVersion: 'public-corpus-v3',
    };
    const recordsForPart = (partNumber: number): CaseVortexStageAddressRecord[] => {
      const first = partNumber * rowsPerPart;
      const count = Math.min(rowsPerPart, rowCount - first);
      return Array.from({ length: count }, (_, offset) => {
        const numericId = first + offset;
        const recordId = `case-${String(numericId).padStart(6, '0')}`;
        return {
          recordType: 'case_vortex_stage_address',
          stage: 'graph',
          kind: 'sighting',
          recordId,
          address: `sighting:${recordId}`,
          artifact: { shard: partNumber, offset, isolated: numericId % 7 === 0 },
        };
      });
    };
    const summaries: CaseVortexAddressLedgerPartSummary[] = [];
    for (let partNumber = 0; partNumber < partCount; partNumber += 1) {
      summaries.push(buildCaseVortexAddressLedgerPart({
        stage: 'graph',
        partNumber,
        records: recordsForPart(partNumber),
      }).summary);
    }
    const manifest = buildCaseVortexAddressLedgerManifest({
      stage: 'graph',
      binding: ledgerBinding,
      publicationSha256: null,
      parts: summaries,
      generatedAt,
    });
    async function* parts() {
      for (let partNumber = 0; partNumber < partCount; partNumber += 1) {
        yield { partNumber, records: recordsForPart(partNumber) };
      }
    }
    await expect(verifyCaseVortexAddressLedger({
      manifestBody: encodeCaseVortexAddressLedgerManifest(manifest),
      parts: parts(),
    })).resolves.toMatchObject({ recordCount: rowCount, partCount });
  }, 120_000);
});
