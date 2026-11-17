import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { makeCaseGraphContentAsset } from '../../src/caseGraph/contentResearchArchive';
import {
  CASE_GRAPH_CONTENT_SOURCE_REPLAY_MAX_BYTES,
  replayCaseGraphContentSourceAsset,
} from '../../src/caseGraph/contentResearchSourceReplay';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'corpus-v3',
  manifestSha256: digest('manifest'),
  snapshotId: 'snapshot-v3',
  graphArtifactSetSha256: digest('graph'),
  relationshipSchemaVersion: 'typed-relationships-v3',
  relationshipPolicyVersion: 'policy-v3',
  relationshipPolicySha256: digest('policy'),
  relationshipModelId: 'model-v3',
  relationshipModelVersion: 'model-v3.1',
  relationshipModelSha256: digest('model'),
  calibrationSetSha256: digest('calibration'),
};
const original = Buffer.from('public source bytes');
const redacted = Buffer.from('public redacted bytes');

const asset = (overrides: Record<string, unknown> = {}) => makeCaseGraphContentAsset({
  publication,
  address: 'document:00000000-0000-4000-8000-000000000010',
  nodeDigest: digest('node'),
  sourceAssetKey: 'source/document.pdf',
  discoveryId: `content-discovery:${digest('discovery')}`,
  discoveryDigest: digest('discovery-record'),
  mediaKind: 'document',
  claimedMimeType: 'application/pdf',
  sniffedMimeType: 'application/pdf',
  byteLength: original.byteLength,
  bytesSha256: digest(original),
  capturedObjectKey: 'case-vortex/content/captured/original.pdf',
  capturedObjectSha256: digest(original),
  searchableObjectKey: 'case-vortex/content/captured/original.pdf',
  searchableBytesSha256: digest(original),
  pageCount: 1,
  imageWidth: null,
  imageHeight: null,
  durationMs: null,
  sourceLocatorDigest: digest('locator'),
  sourceLineageDigest: digest('lineage'),
  visibility: 'public',
  rightsPolicyVersion: 'rights-v1',
  rightsEvidenceDigest: digest('rights'),
  safetyPolicyVersion: 'safety-v1',
  safetyScanDigest: digest('safety'),
  redactionPolicyDigest: digest('redaction-policy'),
  redactionStatus: 'not_required',
  redactionTransformationDigest: null,
  terminalStatus: 'extracted',
  terminalReason: 'extracted',
  ...overrides,
});

describe('publication-bound content source replay', () => {
  it('returns only digest-verified bytes with a reproducible rights receipt', async () => {
    const readObject = vi.fn(async () => original);
    const result = await replayCaseGraphContentSourceAsset({
      asset: asset(), expectedPublication: publication, archive: { readObject },
      replayedAt: '2026-07-21T20:00:00.000Z', maximumBytes: 1_024,
    });
    expect(result.bytes).toEqual(original);
    expect(result.receipt).toMatchObject({
      address: 'document:00000000-0000-4000-8000-000000000010',
      bytesSha256: digest(original),
      servedRepresentation: 'captured_original',
      redactionStatus: 'not_required',
    });
    expect(result.receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(readObject).toHaveBeenCalledWith(
      'case-vortex/content/captured/original.pdf',
      { maxBytes: 1_024, signal: undefined },
    );
  });

  it('serves the rights-preserving searchable representation when redaction was applied', async () => {
    const redactedAsset = asset({
      searchableObjectKey: 'case-vortex/content/searchable/redacted.pdf',
      searchableBytesSha256: digest(redacted),
      redactionStatus: 'applied',
      redactionTransformationDigest: digest('transformation'),
    });
    const result = await replayCaseGraphContentSourceAsset({
      asset: redactedAsset,
      expectedPublication: publication,
      archive: { readObject: async () => redacted },
      replayedAt: '2026-07-21T20:00:00.000Z',
    });
    expect(result.bytes).toEqual(redacted);
    expect(result.receipt).toMatchObject({
      servedRepresentation: 'rights_preserving_redacted',
      redactionStatus: 'applied',
      byteLength: redacted.byteLength,
      bytesSha256: digest(redacted),
    });
  });

  it('fails closed on publication drift, unavailable assets, bounds, aborts and byte tampering', async () => {
    const readObject = vi.fn(async () => Buffer.from('tampered'));
    const common = {
      asset: asset(), expectedPublication: publication, archive: { readObject },
      replayedAt: '2026-07-21T20:00:00.000Z',
    };
    await expect(replayCaseGraphContentSourceAsset({
      ...common,
      expectedPublication: { ...publication, manifestSha256: digest('other') },
    })).rejects.toThrow('case_graph_content_source_replay_publication_mismatch');
    await expect(replayCaseGraphContentSourceAsset({
      ...common, asset: asset({ terminalStatus: 'rights_blocked', terminalReason: 'not licensed',
        byteLength: null, bytesSha256: null, capturedObjectKey: null, capturedObjectSha256: null,
        searchableObjectKey: null, searchableBytesSha256: null, pageCount: null }),
    })).rejects.toThrow('case_graph_content_source_replay_unavailable');
    await expect(replayCaseGraphContentSourceAsset({ ...common, maximumBytes: original.byteLength - 1 }))
      .rejects.toThrow('case_graph_content_source_replay_limit_exceeded');
    await expect(replayCaseGraphContentSourceAsset({ ...common, maximumBytes: CASE_GRAPH_CONTENT_SOURCE_REPLAY_MAX_BYTES + 1 }))
      .rejects.toThrow('case_graph_content_source_replay_limit_exceeded');
    const controller = new AbortController();
    controller.abort();
    await expect(replayCaseGraphContentSourceAsset({ ...common, signal: controller.signal }))
      .rejects.toThrow('case_graph_content_source_replay_aborted');
    await expect(replayCaseGraphContentSourceAsset(common))
      .rejects.toThrow('case_graph_content_source_replay_integrity_failed');
  });
});
