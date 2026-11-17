import { describe, expect, it } from 'vitest';

import {
  buildDvidsRetainedByteInspectionReceipt,
  makeDvidsRetainedByteInspectionLimits,
  verifyDvidsRetainedByteInspectionReceipt,
} from '../../src/caseGraph/dvidsRetainedContentByteInspection';
import {
  buildDvidsRetainedContentPreflight,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import { relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { dvidsPreflightFixture } from './dvidsRetainedContentFixtures';

const makeFixture = () => {
  const fixture = dvidsPreflightFixture();
  fixture.objectHeads[0].contentLength = 12;
  const preflight = buildDvidsRetainedContentPreflight({
    builtAt: '2026-07-27T20:10:00.000Z',
    routeReceipt: fixture.availability.receipt,
    routes: fixture.availability.routes,
    completion: fixture.completion,
    universeNodes: [fixture.dvids],
    rightsSnapshot: fixture.rightsSnapshot,
    objectHeads: fixture.objectHeads,
  });
  const admitted = preflight.admitted[0];
  const inspection = {
    address: admitted.address,
    admissionDigest: admitted.admissionDigest,
    archiveKey: admitted.archiveKey,
    expectedHeadDigest: admitted.objectHead.headDigest,
    expectedEtag: admitted.objectHead.etag,
    declaredContentType: admitted.objectHead.contentType,
    byteLength: admitted.objectHead.contentLength,
    bytesSha256: '1'.repeat(64),
    sniffedMimeType: 'video/mp4' as const,
    durationMs: 12_345,
    safetyPolicyVersion: 'case-graph-content-structural-safety-v1',
    safetyScanDigest: '2'.repeat(64),
  };
  return { preflight, inspection };
};

describe('DVIDS retained byte inspection receipt', () => {
  it('binds every admitted object to exact bytes and bounded structure facts', () => {
    const fixture = makeFixture();
    const receipt = buildDvidsRetainedByteInspectionReceipt({
      builtAt: '2026-07-27T21:00:00.000Z',
      preflight: fixture.preflight,
      inspections: [fixture.inspection],
    });
    expect(receipt.accounting).toEqual({
      expectedObjectCount: 1,
      inspectedObjectCount: 1,
      expectedTotalBytes: 12,
      inspectedTotalBytes: 12,
      maximumObjectBytes: 12,
      maximumDurationMs: 12_345,
      sniffedContentTypes: [{ contentType: 'video/mp4', objectCount: 1 }],
    });
    expect(receipt.guarantees).toMatchObject({
      everyAdmittedObjectInspected: true,
      sha256ProvenForEveryObject: true,
      boundedFfprobePassed: true,
      storageBodyReads: 1,
      storageBodyBytesRead: 12,
      providerCalls: 0,
      publicationMutations: 0,
      deployments: 0,
    });
    expect(verifyDvidsRetainedByteInspectionReceipt({
      value: receipt,
      preflight: fixture.preflight,
    })).toEqual(receipt);
  });

  it('fails closed on missing objects, preflight drift and altered limits', () => {
    const fixture = makeFixture();
    const build = (overrides: Record<string, unknown> = {}) => (
      buildDvidsRetainedByteInspectionReceipt({
        builtAt: '2026-07-27T21:00:00.000Z',
        preflight: fixture.preflight,
        inspections: [fixture.inspection],
        ...overrides,
      } as any)
    );
    expect(() => build({ inspections: [] }))
      .toThrow('dvids_retained_byte_inspection_object_accounting_invalid');
    expect(() => build({
      inspections: [{ ...fixture.inspection, byteLength: 11 }],
    })).toThrow('dvids_retained_byte_inspection_object_invalid');
    const limits = makeDvidsRetainedByteInspectionLimits();
    const { profileSha256: _profileSha256, ...alteredLimits } = {
      ...limits,
      maxObjectBytes: limits.maxObjectBytes + 1,
    };
    expect(() => build({
      limits: {
        ...alteredLimits,
        profileSha256: relationshipInputSha256(alteredLimits),
      },
    })).toThrow('dvids_retained_byte_inspection_limits_invalid');
    const {
      receiptDigest: _receiptDigest,
      ...alteredPreflightBody
    } = {
      ...fixture.preflight,
      admittedSetSha256: 'f'.repeat(64),
    };
    expect(() => build({
      preflight: {
        ...alteredPreflightBody,
        receiptDigest: relationshipInputSha256(alteredPreflightBody),
      },
    })).toThrow();
  });
});
