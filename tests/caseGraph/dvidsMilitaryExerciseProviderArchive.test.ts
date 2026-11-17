import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDvidsMilitaryExerciseArchiveRecords,
  buildDvidsMilitaryExerciseReferenceCollection,
  createGovernedDvidsMilitaryExerciseExternalCorrelationAdapter,
  decodeDvidsMilitaryExerciseSearchPage,
  loadPublicationSightingsForDvidsCorrelation,
  materializeAndPublishDvidsMilitaryExerciseArchive,
  type DvidsMilitaryExerciseReference,
} from '../../src/caseGraph/dvidsMilitaryExerciseProviderArchive';
import type { CaseGraphExternalProviderArchiveTransaction } from '../../src/caseGraph/providerArchiveExternalCorrelation';
import {
  buildContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceEntryInput,
} from '../../src/caseGraph/contextualSourceGovernanceDecision';
import { CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES } from '../../src/caseGraph/externalCorrelation';

const digest = (character: string) => character.repeat(64);
const publication = {
  publicationId: '00000000-0000-4000-8000-000000000001',
  corpusVersion: 'dvids-v1',
  manifestSha256: digest('1'),
  snapshotId: 'snapshot-v1',
  graphArtifactSetSha256: digest('2'),
  relationshipSchemaVersion: 'schema-v1',
  relationshipPolicyVersion: 'policy-v1',
  relationshipPolicySha256: digest('3'),
  relationshipModelId: 'model-v1',
  relationshipModelVersion: 'model-v1',
  relationshipModelSha256: digest('4'),
  calibrationSetSha256: digest('5'),
};
const snapshotId = '00000000-0000-4000-8000-000000000099';
const decisionPacket = (
  military: Partial<ContextualSourceGovernanceEntryInput> = {},
) => buildContextualSourceGovernanceDecisionPacket({
  referenceAt: '2026-07-23T09:00:00.000Z',
  maximumEvidenceAgeDays: 30,
  entries: CASE_GRAPH_EXTERNAL_CORRELATION_CATEGORIES.map((category) => ({
    category,
    canonicalSource: category === 'military_exercise'
      ? 'DVIDS'
      : `SOURCE_${category.toUpperCase()}`,
    providerId: category === 'military_exercise'
      ? 'dvids-exercise-reference'
      : `provider-${category.replace(/_/gu, '-')}`,
    requiredContentMode: category === 'military_exercise' ? 'metadata_only' : 'full_ingest',
    registry: {
      inspectedAt: '2026-07-23T08:00:00.000Z',
      legalStatus: 'approved',
      allowedContentModes: category === 'military_exercise' ? ['metadata_only'] : ['full_ingest'],
    },
    rights: {
      commercialUse: 'allowed',
      automatedAccess: 'allowed',
      archivalUse: 'allowed',
      redistribution: 'allowed',
      accessConstraint: 'none',
      attributionRequired: true,
    },
    evidence: [{
      evidenceId: `terms-${category.replace(/_/gu, '-')}`,
      evidenceUrl: `https://example.test/${category}`,
      observedAt: '2026-07-23T07:00:00.000Z',
      evidenceSha256: digest('f'),
      summary: `Approved terms fixture for ${category}.`,
    }],
    limitations: [],
    ...(category === 'military_exercise' ? military : {}),
  })),
});
const nodes = [
  {
    address: 'sighting:case-a',
    nodeDigest: digest('6'),
    eventTimestamp: '2026-07-21T20:00:00.000Z',
    locationLabel: 'Killeen, TX, United States',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
  {
    address: 'sighting:case-b',
    nodeDigest: digest('7'),
    eventTimestamp: '2026-06-01T20:00:00.000Z',
    locationLabel: 'Killeen, Texas, United States',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
  {
    address: 'sighting:case-c',
    nodeDigest: digest('8'),
    eventTimestamp: null,
    locationLabel: 'Killeen, Texas',
    city: 'Killeen',
    region: 'Texas',
    country: 'United States',
  },
];

const searchResult = (overrides: Record<string, unknown> = {}) => ({
  id: '1234567',
  type: 'image',
  title: 'Combined readiness exercise at Fort Cavazos',
  short_description: 'Soldiers conduct a field training exercise near Killeen.',
  keywords: 'readiness, training',
  date: '2026-07-21T18:00:00Z',
  date_published: '2026-07-22T09:00:00Z',
  city: 'Killeen',
  state: 'Texas',
  country: 'United States',
  unit_name: '1st Cavalry Division',
  branch: 'Army',
  url: 'https://www.dvidshub.net/image/1234567/combined-readiness-exercise',
  ...overrides,
});

const capturedPage = (results = [searchResult()]) => ({
  body: JSON.stringify({
    page_info: { total_results: results.length, results_per_page: Math.max(1, results.length) },
    results,
  }),
  acquiredAt: '2026-07-23T10:00:00Z',
  requestUrl: 'https://api.dvidshub.net/search?q=readiness%20exercise&api_key=secret',
});
const decodePage = (results = [searchResult()]) => decodeDvidsMilitaryExerciseSearchPage(
  capturedPage(results),
);
const decodeReferences = (results = [searchResult()]) => decodePage(results).retainedResults;

describe('DVIDS military-exercise provider archive', () => {
  it('strictly decodes exercise-bearing DVIDS search results and records excluded items', () => {
    const body = JSON.stringify({
      page_info: { total_results: 2, results_per_page: 2 },
      results: [
        searchResult(),
        searchResult({
          id: 'news:7654321',
          title: 'Installation change of command',
          short_description: 'A ceremony was held.',
          keywords: 'ceremony',
          url: 'https://www.dvidshub.net/news/7654321/installation-change-command',
        }),
      ],
    });
    const decoded = decodeDvidsMilitaryExerciseSearchPage({
      body,
      acquiredAt: '2026-07-23T10:00:00+00:00',
      requestUrl: 'https://api.dvidshub.net/search?API_KEY=do-not-retain&q=readiness%20exercise',
    });
    expect(decoded).toMatchObject({
      recordType: 'dvids_military_exercise_search_page',
      totalResults: 2,
      resultsPerPage: 2,
      excludedNonExerciseResults: 1,
      retainedResults: [{
        sourceRecordId: 'image:1234567',
        assetType: 'image',
        city: 'Killeen',
        region: 'Texas',
      }],
    });
    expect(decoded.responseSha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(decoded.responseBytes).toBe(Buffer.byteLength(body));
    expect(decoded.requestUrl).toBe(
      'https://api.dvidshub.net/search?q=readiness+exercise',
    );
    expect(decodeReferences([
      searchResult({ id: 'image:1234567', type: undefined }),
    ])[0].sourceRecordId).toBe('image:1234567');
  });

  it('rejects untrusted URLs, duplicate retained IDs, invalid dates and impossible page accounting', () => {
    expect(() => decodeReferences([
      searchResult({ url: 'https://example.com/image/1234567/exercise' }),
    ])).toThrow('dvids_military_reference_url_invalid');
    expect(() => decodeReferences([
      searchResult({
        title: 'Installation ceremony',
        short_description: 'A ceremony was held.',
        keywords: 'ceremony',
        url: 'https://example.com/image/1234567/ceremony',
      }),
    ])).toThrow('dvids_military_reference_url_invalid');
    expect(() => decodeReferences([searchResult(), searchResult()]))
      .toThrow('dvids_military_reference_duplicate_result');
    expect(() => decodeReferences([
      searchResult({ date: '2026-07-21T18:00:00' }),
    ])).toThrow('dvids_military_reference_invalid');
    expect(() => decodeReferences([
      searchResult({ unit_name: { unexpected: true } }),
    ])).toThrow('dvids_military_reference_invalid');
    expect(() => decodeDvidsMilitaryExerciseSearchPage({
      body: JSON.stringify({
        page_info: { total_results: 0, results_per_page: 1 },
        results: [searchResult()],
      }),
      acquiredAt: '2026-07-23T10:00:00Z',
      requestUrl: 'https://api.dvidshub.net/search?q=exercise',
    })).toThrow('dvids_military_reference_response_invalid');
    expect(() => decodeDvidsMilitaryExerciseSearchPage({
      body: JSON.stringify({
        page_info: { total_results: 1, results_per_page: 1 },
        results: [searchResult()],
      }),
      acquiredAt: '2026-07-23T10:00:00Z',
      requestUrl: 'https://example.com/search?q=exercise&API_KEY=must-not-leak',
    })).toThrow('dvids_military_reference_request_url_invalid');
    const page = decodePage();
    expect(() => buildDvidsMilitaryExerciseReferenceCollection([page, page]))
      .toThrow('dvids_military_reference_collection_duplicate_page');
  });

  it('retains bounded named-locality matches without turning media proximity into identification', () => {
    const records = buildDvidsMilitaryExerciseArchiveRecords({
      publication,
      snapshotId,
      nodes,
      references: decodeReferences(),
      maxTimeDeltaDays: 3,
      limitPerAddress: 5,
    });
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      address: 'sighting:case-a',
      availability: 'available',
      reasonCodes: ['dvids_named_locality_time_reference_available'],
      candidates: [{
        sourceRecordId: 'image:1234567',
        measurements: {
          locality_match: 'named_city_and_region',
          unit_name: '1st Cavalry Division',
          branch: 'Army',
        },
      }],
    });
    expect(records[0].candidates[0].explanation).toContain('contextual media, not proof');
    expect(records[0].candidates[0].uncertainty).toEqual(expect.arrayContaining([
      expect.stringContaining('not a complete military-exercise schedule'),
    ]));
    expect(records[1]).toMatchObject({
      address: 'sighting:case-b',
      availability: 'available',
      reasonCodes: ['dvids_bounded_reference_search_no_candidate'],
      candidates: [],
    });
    expect(records[1].explanation).toContain('military activity is not ruled out');
    expect(records[2]).toMatchObject({
      address: 'sighting:case-c',
      availability: 'insufficient_evidence',
      reasonCodes: ['sighting_time_or_named_location_missing'],
      candidates: [],
    });
  });

  it('is deterministic across input order and applies a visible candidate limit', () => {
    const firstReference = decodeReferences()[0];
    const secondReference: DvidsMilitaryExerciseReference = {
      ...firstReference,
      sourceRecordId: 'video:7654321',
      label: 'Night training exercise',
      occurredAt: '2026-07-21T19:00:00.000Z',
      url: 'https://www.dvidshub.net/video/7654321/night-training-exercise',
    };
    const expected = buildDvidsMilitaryExerciseArchiveRecords({
      publication,
      snapshotId,
      nodes: [nodes[0]],
      references: [firstReference, secondReference],
      maxTimeDeltaDays: 3,
      limitPerAddress: 1,
    });
    const reversed = buildDvidsMilitaryExerciseArchiveRecords({
      publication,
      snapshotId,
      nodes: [nodes[0]],
      references: [secondReference, firstReference],
      maxTimeDeltaDays: 3,
      limitPerAddress: 1,
    });
    expect(reversed).toEqual(expected);
    expect(expected[0]).toMatchObject({
      reasonCodes: ['candidate_limit_applied', 'dvids_named_locality_time_reference_available'],
      candidates: [{ sourceRecordId: 'video:7654321' }],
    });
  });

  it('loads only publication-bound sighting time and named-location fields and honors cancellation', async () => {
    const run = vi.fn().mockResolvedValueOnce({ rows: nodes.map((node) => ({
      address: node.address,
      node_digest: node.nodeDigest,
      event_timestamp: node.eventTimestamp,
      location_label: node.locationLabel,
      city: node.city,
      region: node.region,
      country: node.country,
    })) });
    await expect(loadPublicationSightingsForDvidsCorrelation({ publication, run })).resolves.toEqual(nodes);
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("node.address = 'sighting:' || sighting.id::text"),
      [publication.publicationId, '', 5000],
    );

    const controller = new AbortController();
    controller.abort();
    await expect(loadPublicationSightingsForDvidsCorrelation({
      publication,
      run: vi.fn(),
      signal: controller.signal,
    })).rejects.toThrow('case_graph_research_aborted');
  });

  it('uploads and verifies the immutable archive before publishing its database receipt', async () => {
    const page = decodePage();
    const collection = buildDvidsMilitaryExerciseReferenceCollection([page]);
    const references = collection.references;
    const snapshot = {
      snapshotId,
      publication,
      category: 'military_exercise' as const,
      canonicalSource: 'DVIDS',
      contentMode: 'metadata_only' as const,
      providerId: 'dvids-exercise-reference',
      datasetVersion: `dvids-search:${collection.collectionSha256}`,
      coverageStart: '2026-07-18T00:00:00.000Z',
      coverageEnd: '2026-07-23T00:00:00.000Z',
      acquiredAt: '2026-07-23T10:00:00.000Z',
      sourceUrl: 'https://api.dvidshub.net/docs/search_api/',
      license: 'Item-level DVIDS rights review required',
    };
    const expectedRecords = buildDvidsMilitaryExerciseArchiveRecords({
      publication,
      snapshotId,
      nodes,
      references,
      maxTimeDeltaDays: 3,
      limitPerAddress: 5,
    });
    let receiptSha256 = '';
    let recordSetSha256 = '';
    let archiveBody = Buffer.alloc(0);
    const order: string[] = [];
    const transaction: CaseGraphExternalProviderArchiveTransaction = async (work) => {
      order.push('transaction');
      return work(async (sql, params = []) => {
        if (sql.includes('external-provider-archive:existing')) return { rows: [] };
        if (sql.includes('external-provider-archive:governance')) {
          return { rows: [{
            public_manifest_sha256: publication.manifestSha256,
            legal_status: 'approved',
            allowed_content_modes: ['metadata_only'],
          }] };
        }
        if (sql.includes('external-provider-archive:nodes')) {
          return { rows: expectedRecords.map((record) => ({
            address: record.address,
            node_digest: record.nodeDigest,
          })) };
        }
        if (sql.includes('external-provider-archive:finalize')) {
          recordSetSha256 = String(params[2]);
          receiptSha256 = String(params[3]);
        }
        if (sql.includes('external-provider-archive:completion-check')) {
          return { rows: [{
            status: 'complete',
            record_count: String(expectedRecords.length),
            record_set_sha256: recordSetSha256,
            receipt_sha256: receiptSha256,
          }] };
        }
        return { rows: [] };
      });
    };
    const blockedRun = vi.fn(async () => ({ rows: [] }));
    await expect(materializeAndPublishDvidsMilitaryExerciseArchive({
      snapshot: { ...snapshot, datasetVersion: 'unbound-version' },
      collection,
      decisionPacket: decisionPacket(),
      run: blockedRun,
      transaction,
      putArchiveObject: async () => {},
      verifyArchiveObject: async () => ({ sha256: digest('9'), bytes: 1 }),
      maxTimeDeltaDays: 3,
      limitPerAddress: 5,
    })).rejects.toThrow('dvids_military_reference_dataset_version_mismatch');
    expect(blockedRun).not.toHaveBeenCalled();
    expect(order).toEqual([]);

    const tamperedCollection = structuredClone(collection);
    tamperedCollection.references[0].label = 'Tampered label';
    await expect(materializeAndPublishDvidsMilitaryExerciseArchive({
      snapshot,
      collection: tamperedCollection,
      decisionPacket: decisionPacket(),
      run: blockedRun,
      transaction,
      putArchiveObject: async () => {},
      verifyArchiveObject: async () => ({ sha256: digest('9'), bytes: 1 }),
      maxTimeDeltaDays: 3,
      limitPerAddress: 5,
    })).rejects.toThrow('dvids_military_reference_collection_invalid');
    expect(blockedRun).not.toHaveBeenCalled();

    const putBeforeApproval = vi.fn(async () => {});
    await expect(materializeAndPublishDvidsMilitaryExerciseArchive({
      snapshot,
      collection,
      decisionPacket: decisionPacket(),
      run: async (sql) => sql.includes('source-governance')
        ? { rows: [{
          canonical_source: 'DVIDS',
          legal_status: 'review',
          allowed_content_modes: ['metadata_only'],
        }] }
        : { rows: [] },
      transaction,
      putArchiveObject: putBeforeApproval,
      verifyArchiveObject: async () => ({ sha256: digest('9'), bytes: 1 }),
      maxTimeDeltaDays: 3,
      limitPerAddress: 5,
    })).rejects.toThrow('dvids_military_reference_source_governance_not_approved');
    expect(putBeforeApproval).not.toHaveBeenCalled();
    expect(order).toEqual([]);

    const result = await materializeAndPublishDvidsMilitaryExerciseArchive({
      snapshot,
      collection,
      decisionPacket: decisionPacket(),
      run: async (sql) => sql.includes('source-governance')
        ? { rows: [{
          canonical_source: 'DVIDS',
          legal_status: 'approved',
          allowed_content_modes: ['metadata_only'],
        }] }
        : { rows: nodes.map((node) => ({
          address: node.address,
          node_digest: node.nodeDigest,
          event_timestamp: node.eventTimestamp,
          location_label: node.locationLabel,
          city: node.city,
          region: node.region,
          country: node.country,
        })) },
      transaction,
      putArchiveObject: async ({ body }) => {
        order.push('put');
        archiveBody = body;
      },
      verifyArchiveObject: async ({ expectedSha256, expectedBytes }) => {
        order.push('verify');
        return { sha256: expectedSha256, bytes: expectedBytes };
      },
      maxTimeDeltaDays: 3,
      limitPerAddress: 5,
    });
    expect(result).toMatchObject({
      status: 'written',
      receipt: { recordCount: 3, candidateCount: 1 },
    });
    expect(order).toEqual(['put', 'verify', 'transaction']);
    expect(gunzipSync(archiveBody).toString('utf8')).toContain(
      'dvids_bounded_reference_search_no_candidate',
    );
  });

  it('blocks archive reads while the DVIDS source remains review-only', async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('source-governance')) {
        return { rows: [{
          canonical_source: 'DVIDS',
          legal_status: 'review',
          allowed_content_modes: ['metadata_only'],
        }] };
      }
      throw new Error('provider_archive_should_not_be_read');
    });
    const adapter = createGovernedDvidsMilitaryExerciseExternalCorrelationAdapter({
      publication,
      snapshotId,
      run,
    });
    await expect(adapter.correlate({
      publication,
      address: nodes[0].address,
      nodeDigest: nodes[0].nodeDigest,
      limit: 5,
      checkedAt: '2026-07-23T11:00:00.000Z',
    })).resolves.toMatchObject({
      availability: 'unavailable',
      reasonCodes: ['source_governance_not_approved'],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
