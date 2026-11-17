import { describe, expect, it } from 'vitest';

import {
  buildDvidsRetainedContentPreflight,
  verifyDvidsRetainedContentPreflightReceipt,
} from '../../src/caseGraph/dvidsRetainedContentPreflight';
import {
  dvidsPreflightFixture,
} from './dvidsRetainedContentFixtures';

describe('DVIDS retained content preflight', () => {
  it('admits only exact rights-complete DVIDS rows and records HEAD limits', () => {
    const fixture = dvidsPreflightFixture();
    const receipt = buildDvidsRetainedContentPreflight({
      builtAt: '2026-07-27T20:10:00.000Z',
      routeReceipt: fixture.availability.receipt,
      routes: fixture.availability.routes,
      completion: fixture.completion,
      universeNodes: [fixture.dvids],
      rightsSnapshot: fixture.rightsSnapshot,
      objectHeads: fixture.objectHeads,
    });
    expect(receipt.accounting).toMatchObject({
      contentRouteCount: 2,
      retainedRouteCount: 2,
      externalOnlyRouteCount: 0,
      rightsApprovedRetainedCount: 1,
      rightsReviewRequiredRetainedCount: 1,
      admittedObjectCount: 1,
      admittedTotalBytes: 300 * 1024 * 1024,
      admittedMaximumObjectBytes: 300 * 1024 * 1024,
      admittedOver64MiBCount: 1,
      admittedOver256MiBCount: 1,
      admittedContentTypes: [{ contentType: 'video/mp4', objectCount: 1 }],
    });
    expect(receipt.guarantees).toMatchObject({
      rightsAdmissionLimitedToDvidsPublicDomainRows: true,
      objectMetadataOnly: true,
      contentBytesRead: 0,
      objectChecksumProven: false,
      extractionApproved: false,
      databaseWrites: 0,
      storageWrites: 0,
      publicationMutations: 0,
      deployments: 0,
    });
    expect(verifyDvidsRetainedContentPreflightReceipt(receipt)).toEqual(receipt);
  });

  it('fails closed on rights, registry, node and object metadata drift', () => {
    const fixture = dvidsPreflightFixture();
    const build = (overrides: Record<string, unknown> = {}) => (
      buildDvidsRetainedContentPreflight({
        builtAt: '2026-07-27T20:10:00.000Z',
        routeReceipt: fixture.availability.receipt,
        routes: fixture.availability.routes,
        completion: fixture.completion,
        universeNodes: [fixture.dvids],
        rightsSnapshot: fixture.rightsSnapshot,
        objectHeads: fixture.objectHeads,
        ...overrides,
      } as any)
    );
    expect(() => build({
      rightsSnapshot: {
        ...fixture.rightsSnapshot,
        rows: [{
          ...fixture.rightsSnapshot.rows[0],
          rightsStatus: 'review_required',
        }],
      },
    })).toThrow('dvids_retained_preflight_row_not_approved');
    expect(() => build({
      rightsSnapshot: {
        ...fixture.rightsSnapshot,
        registry: { ...fixture.rightsSnapshot.registry, legalStatus: 'review' },
      },
    })).toThrow('dvids_retained_preflight_registry_not_approved');
    expect(() => build({ universeNodes: [{ ...fixture.dvids, title: 'drift' }] }))
      .toThrow('dvids_retained_preflight_row_not_approved');
    expect(() => build({ objectHeads: [] }))
      .toThrow('dvids_retained_preflight_candidate_accounting_invalid');
  });
});
